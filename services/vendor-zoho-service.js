/**
 * Vendor (AP) Zoho payment sync service (SP-1 C5).
 *
 * Mirrors the shape of services/billing-zoho-service.js's per-payment engine,
 * but for accounts-payable: it forwards an in-app vendor_payments row to Zoho
 * Books as a vendorpayment. Duplicate-proof by construction (same 2 layers as
 * the AR engine):
 *   - deterministic reference_number `ACT-VP-<vendor_payments.id>`,
 *   - atomic 'SYNCING' claim (a second worker sees affectedRows 0 → in_flight),
 *   - adopt-before-create (a matching Zoho vendorpayment already exists → adopt),
 *   - balance clamp on the bill (NIT-1 ≤ ₹1 zone honored, > ₹1 fails soft),
 *   - mode-fallback retry (a mode-shaped Zoho rejection → retry once as 'others').
 *
 * Owner decisions (2026-07-12): on-account (unapplied) vendor payments ARE
 * pushed — no bills[], no location; a bill-linked payment requires the bill to
 * be pushed first (BILL_NOT_PUSHED); the payment path NEVER creates a Zoho
 * contact (VENDOR_NOT_IN_ZOHO if the vendor is not already in Zoho);
 * `paid_through_account_id` comes from ai_config and is omitted when unset.
 *
 * Exports: { setPool, resolveVendorPaidThroughAccountId, pushVendorPaymentToZoho, syncBillPayments }
 */

const zohoAPI = require('./zoho-api');
const { buildVendorPaymentPayload, loadModeOverrides } = require('./zoho-payment-mapper');

let pool;
function setPool(p) { pool = p; }

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function truncate255(s) { return String(s == null ? '' : s).slice(0, 255); }

/**
 * Resolve the Zoho `paid_through_account_id` for vendor payments from ai_config
 * ('zoho_vendor_paid_through_account_id', seeded by the accountant to a single
 * account for now). Returns null when unset — the payload then omits the field
 * (Zoho allows it). Best-effort: any read error is treated as unset. Mirrors
 * resolveDefaultGstTaxId in routes/vendors.js.
 * @returns {Promise<string|null>}
 */
async function resolveVendorPaidThroughAccountId() {
    try {
        const [rows] = await pool.query(
            "SELECT config_value FROM ai_config WHERE config_key = 'zoho_vendor_paid_through_account_id' LIMIT 1"
        );
        const v = rows.length ? String(rows[0].config_value || '').trim() : '';
        return v || null;
    } catch { return null; }
}

// Release a claimed row back to NULL with the error recorded (idempotent — only
// touches a row this worker still owns via the 'SYNCING' sentinel guard).
async function releaseClaim(paymentId, errMsg) {
    await pool.query(
        "UPDATE vendor_payments SET zoho_payment_id = NULL, zoho_sync_error = ? WHERE id = ? AND zoho_payment_id = 'SYNCING'",
        [truncate255(errMsg), paymentId]
    );
}

/**
 * Push a single local vendor payment to Zoho Books as a vendorpayment.
 *
 * @param {number} paymentId vendor_payments.id
 * @returns {Promise<{zohoPaymentId:string}|{adopted:true, zohoPaymentId:string}|{skipped:string}>}
 * @throws {Error} code VENDOR_NOT_IN_ZOHO / BILL_NOT_PUSHED on a hard refusal;
 *         a generic Error (with the row released) on a Zoho-side failure.
 */
async function pushVendorPaymentToZoho(paymentId) {
    // 1. Load the payment joined to its vendor (zoho_contact_id) and — when
    //    bill-linked — its bill (zoho push state + location). is_fresh_syncing is
    //    computed DB-side (server clock IST, DB session UTC) so the in-flight
    //    guard never trips over the timezone offset.
    const [rows] = await pool.query(
        `SELECT vp.id, vp.vendor_id, vp.bill_id, vp.amount, vp.payment_method,
                vp.payment_reference, vp.payment_date, vp.created_at, vp.zoho_payment_id,
                v.zoho_contact_id AS vendor_zoho_contact_id,
                vb.zoho_status AS bill_zoho_status, vb.zoho_bill_id AS bill_zoho_bill_id,
                vb.zoho_location_id AS bill_zoho_location_id,
                (vp.zoho_payment_id = 'SYNCING' AND vp.zoho_claimed_at >= NOW() - INTERVAL 5 MINUTE) AS is_fresh_syncing
           FROM vendor_payments vp
           JOIN vendors v ON vp.vendor_id = v.id
           LEFT JOIN vendor_bills vb ON vp.bill_id = vb.id
          WHERE vp.id = ? AND vp.deleted_at IS NULL`,
        [paymentId]
    );
    if (!rows.length) throw new Error(`Vendor payment ${paymentId} not found`);
    const p = rows[0];

    // GUARD 1 — already synced (real Zoho id) or LEGACY (pre-SP1, hand-entered):
    // never re-forward.
    const zid = p.zoho_payment_id;
    if (zid && zid !== 'SYNCING') {
        return { skipped: 'already_synced' };
    }
    // GUARD 2 — a fresh 'SYNCING' claim means another worker owns it right now.
    if (Number(p.is_fresh_syncing) === 1) {
        return { skipped: 'in_flight' };
    }

    // GUARD 3 — the vendor must already exist in Zoho. The payment path NEVER
    // creates a contact (owner decision 2026-07-12).
    if (!p.vendor_zoho_contact_id) {
        const err = new Error('Vendor is not linked to a Zoho contact — add the vendor in Zoho first');
        err.code = 'VENDOR_NOT_IN_ZOHO';
        throw err;
    }

    // GUARD 4 — a bill-linked payment can only be applied once the bill itself
    // has been pushed (Zoho refuses a payment against a non-existent bill).
    const billLinked = p.bill_id != null;
    if (billLinked && (p.bill_zoho_status !== 'pushed' || !p.bill_zoho_bill_id)) {
        const err = new Error('The linked bill is not pushed to Zoho yet — push the bill first');
        err.code = 'BILL_NOT_PUSHED';
        throw err;
    }

    // 2. Atomic claim — the WHERE clause is the concurrency lock. A stale
    //    'SYNCING' (> 5 min → crashed worker) is reclaimable via the same path.
    const [claim] = await pool.query(
        `UPDATE vendor_payments SET zoho_payment_id = 'SYNCING', zoho_claimed_at = NOW()
          WHERE id = ? AND (zoho_payment_id IS NULL OR (zoho_payment_id = 'SYNCING' AND zoho_claimed_at < NOW() - INTERVAL 5 MINUTE))`,
        [paymentId]
    );
    if (!claim || !claim.affectedRows) return { skipped: 'in_flight' };

    // 3. Adopt-before-create — a Zoho vendorpayment with our deterministic
    //    reference means a prior run already created it (crash mid-'SYNCING').
    const ref = `ACT-VP-${paymentId}`;
    try {
        const found = await zohoAPI.getVendorPayments({ reference_number: ref });
        const list = (found && (found.vendorpayments || found.payments)) || [];
        const match = list.find(x => x && x.reference_number === ref && x.payment_id);
        if (match) {
            await pool.query(
                "UPDATE vendor_payments SET zoho_payment_id = ?, zoho_sync_error = NULL WHERE id = ? AND zoho_payment_id = 'SYNCING'",
                [match.payment_id, paymentId]
            );
            return { adopted: true, zohoPaymentId: match.payment_id };
        }
    } catch {
        // adopt is best-effort — on a lookup error, fall through to create.
    }

    // 4. Build the payload. On-account (no bill) omits bills + location + clamp
    //    (owner-approved). Bill-linked carries the bill + its location and clamps
    //    the applied amount to the live Zoho balance.
    const modeOverrides = await loadModeOverrides(pool);
    const paidThroughAccountId = await resolveVendorPaidThroughAccountId();
    const payload = buildVendorPaymentPayload({
        zohoVendorId: p.vendor_zoho_contact_id,
        zohoBillId: billLinked ? p.bill_zoho_bill_id : null,
        payment: p,
        paidThroughAccountId,
        locationId: billLinked ? (p.bill_zoho_location_id || null) : null,
        modeOverrides,
    });
    if (!payload) {
        // Defensive: the vendor payment_method enum excludes 'credit', but never
        // leave a claim dangling if the mapper declines to build a payload.
        await pool.query(
            "UPDATE vendor_payments SET zoho_payment_id = NULL WHERE id = ? AND zoho_payment_id = 'SYNCING'",
            [paymentId]
        );
        return { skipped: 'not_forwardable' };
    }

    let clampError = null;
    if (billLinked) {
        // 5. Fetch the Zoho bill ONCE — its status + live balance feed the void
        //    guard and the balance clamp.
        let zbill = null;
        let fetchErrMsg = null;
        try {
            const resp = await zohoAPI.getBill(p.bill_zoho_bill_id);
            zbill = resp && resp.bill;
        } catch (e) {
            fetchErrMsg = (e && e.message) || String(e);
        }
        const status = zbill ? String(zbill.status || '').toLowerCase() : '';
        const missing = !zbill || (fetchErrMsg && /does not exist|1002/i.test(fetchErrMsg));
        if (missing || status === 'void') {
            const reason = missing
                ? 'Zoho bill not found — cannot sync payment'
                : 'Zoho bill is void — cannot record a payment in Zoho';
            await releaseClaim(paymentId, reason);
            throw new Error(reason);
        }

        // Balance clamp (NIT-1 sub-rupee zone honored — never "fix" the drift).
        const amount = Number(p.amount);
        const billBalance = round2(zbill.balance);
        const delta = round2(amount - billBalance);
        if (delta > 1) {
            const msg = `local amount exceeds Zoho bill balance by ${delta} — check discount/void state`;
            await releaseClaim(paymentId, msg);
            throw new Error(msg);
        } else if (delta > 0) {
            // 0 < delta ≤ ₹1 — clamp both the payment amount and what's applied.
            payload.amount = billBalance;
            payload.bills[0].amount_applied = billBalance;
            clampError = `clamped by ${delta}`;
            payload.description = payload.description ? `${payload.description} (${clampError})` : clampError;
        }
    }

    // 6. Create in Zoho + mode-fallback retry (a mode-shaped rejection → retry
    //    ONCE as 'others', keeping the real method visible in the description).
    let created = null;
    let lastErr = null;
    try {
        created = await zohoAPI.createVendorPayment(payload);
    } catch (e) {
        lastErr = e;
        if (/mode/i.test((e && e.message) || '')) {
            try {
                const retry = { ...payload, payment_mode: 'others' };
                if (payload.bills) retry.bills = payload.bills.map(x => ({ ...x }));
                const realMethod = String(p.payment_method || '');
                if (retry.description && retry.description.indexOf(realMethod) === -1) {
                    retry.description = `${realMethod} - ${retry.description}`;
                } else if (!retry.description) {
                    retry.description = realMethod;
                }
                created = await zohoAPI.createVendorPayment(retry);
                lastErr = null;
            } catch (e2) {
                lastErr = e2;
            }
        }
    }

    const zpid = created && (
        (created.vendorpayment && created.vendorpayment.payment_id) ||
        (created.payment && created.payment.payment_id)
    );
    if (zpid) {
        await pool.query(
            "UPDATE vendor_payments SET zoho_payment_id = ?, zoho_sync_error = ? WHERE id = ? AND zoho_payment_id = 'SYNCING'",
            [zpid, clampError, paymentId]
        );
        return { zohoPaymentId: zpid };
    }

    const msg = truncate255((lastErr && lastErr.message) || 'Zoho createVendorPayment failed');
    await releaseClaim(paymentId, msg);
    throw new Error(msg);
}

/**
 * Best-effort sync of a bill's still-unsynced, non-deleted payments to Zoho.
 * Called after a bill is pushed. Never throws — each payment is pushed
 * independently and its outcome tallied.
 * @param {number} billId vendor_bills.id
 * @returns {Promise<{synced:number, failed:number, skipped:number}>}
 */
async function syncBillPayments(billId) {
    const summary = { synced: 0, failed: 0, skipped: 0 };
    const [rows] = await pool.query(
        `SELECT id FROM vendor_payments
          WHERE bill_id = ? AND deleted_at IS NULL AND payment_method != 'credit'
            AND (zoho_payment_id IS NULL OR (zoho_payment_id = 'SYNCING' AND zoho_claimed_at < NOW() - INTERVAL 5 MINUTE))
          ORDER BY id`,
        [billId]
    );
    for (const r of rows) {
        try {
            const result = await pushVendorPaymentToZoho(r.id);
            if (result && result.zohoPaymentId) summary.synced++;
            else summary.skipped++;
        } catch {
            summary.failed++;
        }
    }
    return summary;
}

module.exports = {
    setPool,
    resolveVendorPaidThroughAccountId,
    pushVendorPaymentToZoho,
    syncBillPayments,
};
