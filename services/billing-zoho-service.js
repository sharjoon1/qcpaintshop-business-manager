/**
 * Billing Zoho Service
 * Shared service for Zoho contact resolution and invoice push from the billing module.
 *
 * Exports: { setPool, setPointsEngine, resolveZohoContact, pushInvoiceToZoho }
 */

const zohoAPI = require('./zoho-api');
const { logCreditViolation } = require('./credit-violation-log');
const { buildCustomerPaymentPayload, loadModeOverrides } = require('./zoho-payment-mapper');

let pool;
let pointsEngine;

function setPool(p) { pool = p; }
function setPointsEngine(pe) { pointsEngine = pe; }

// Invoice-level discount push is behind an ai_config flag
// ('billing_invoice_discount_push_enabled', default '0') so it can only be
// switched on after the D1 draft verification passes on the real Zoho org —
// flag-off keeps the createInvoice payload byte-identical to today. Best-effort:
// any read error is treated as disabled. Mirrors resolveDefaultGstTaxId in
// routes/vendors.js.
async function isInvoiceDiscountPushEnabled() {
    try {
        const [rows] = await pool.query(
            "SELECT config_value FROM ai_config WHERE config_key = 'billing_invoice_discount_push_enabled' LIMIT 1"
        );
        const v = rows.length ? String(rows[0].config_value || '').trim() : '';
        return v === '1';
    } catch { return false; }
}

// ═══════════════════════════════════════════
// RESOLVE ZOHO CONTACT
// ═══════════════════════════════════════════

/**
 * Resolve or create a Zoho contact for the given customer type.
 * @param {string} customerType - 'painter' or 'customer'
 * @param {Object} opts - { customerId, painterId, customerName, customerPhone }
 * @returns {Promise<string>} zohoContactId
 */
async function resolveZohoContact(customerType, { customerId, painterId, customerName, customerPhone }) {
    // Painter lookup
    if (customerType === 'painter' && painterId) {
        // A painter is synced to Zoho as a CONTACT — but the painter-sync writes
        // that contact id to painters.zoho_customer_id while this billing path
        // historically only read zoho_contact_id. A synced painter (zoho_customer_id
        // set, zoho_contact_id NULL) therefore created a DUPLICATE Zoho contact on
        // the first invoice push. Read BOTH and prefer either existing id.
        const [rows] = await pool.query(
            'SELECT zoho_contact_id, zoho_customer_id, full_name, phone FROM painters WHERE id = ?',
            [painterId]
        );
        if (!rows.length) throw new Error(`Painter ${painterId} not found`);

        const painter = rows[0];
        const existing = painter.zoho_contact_id || painter.zoho_customer_id;
        if (existing) {
            // Backfill zoho_contact_id when only zoho_customer_id was set, so both
            // columns stay consistent for future lookups.
            if (!painter.zoho_contact_id) {
                await pool.query('UPDATE painters SET zoho_contact_id = ? WHERE id = ?', [existing, painterId]);
            }
            return existing;
        }

        // Create contact in Zoho (neither id set)
        const contactName = painter.full_name || customerName || `Painter ${painterId}`;
        const phone = painter.phone || customerPhone;
        const result = await zohoAPI.createContact({
            contact_name: contactName,
            contact_type: 'customer',
            phone: phone
        });

        const contactId = result && result.contact && result.contact.contact_id;
        if (!contactId) throw new Error('Failed to create Zoho contact for painter');

        // Save back to BOTH painter columns so the sync + billing paths agree.
        await pool.query('UPDATE painters SET zoho_contact_id = ?, zoho_customer_id = COALESCE(zoho_customer_id, ?) WHERE id = ?', [contactId, contactId, painterId]);
        return contactId;
    }

    // Customer lookup (column is zoho_contact_id — the old zoho_customer_id
    // name doesn't exist in zoho_customers_map, so every customer-type push
    // died on an Unknown-column SQL error before this fix)
    if (customerType === 'customer' && customerId) {
        const [rows] = await pool.query(
            'SELECT zoho_contact_id FROM zoho_customers_map WHERE id = ?',
            [customerId]
        );
        if (rows.length && rows[0].zoho_contact_id) {
            return rows[0].zoho_contact_id;
        }
    }

    // Fallback: create new contact
    if (!customerName) throw new Error('Customer name required to create Zoho contact');
    const result = await zohoAPI.createContact({
        contact_name: customerName,
        contact_type: 'customer',
        phone: customerPhone || undefined
    });

    const contactId = result && result.contact && result.contact.contact_id;
    if (!contactId) throw new Error('Failed to create Zoho contact');
    return contactId;
}

// ═══════════════════════════════════════════
// PUSH INVOICE TO ZOHO
// ═══════════════════════════════════════════

/**
 * Push a billing invoice to Zoho Books.
 * @param {number} invoiceId - billing_invoices.id
 * @param {number} userId - admin/staff user performing the push
 * @returns {Promise<{ zohoInvoiceId, zohoInvoiceNumber, pointsResult }>}
 */
async function pushInvoiceToZoho(invoiceId, userId, options = {}) {
    // 1. Load invoice
    const [invoices] = await pool.query(
        'SELECT * FROM billing_invoices WHERE id = ?',
        [invoiceId]
    );
    if (!invoices.length) throw new Error(`Invoice ${invoiceId} not found`);
    const invoice = invoices[0];

    if (invoice.zoho_status === 'pushed') {
        throw new Error(`Invoice ${invoiceId} already pushed to Zoho`);
    }

    // Salesperson (owner requirement 2026-06-12: mandatory on every Zoho push —
    // Zoho's org makes the field required). Priority: the explicitly chosen one,
    // else the value already on the invoice, else — for painter invoices — the
    // painter's mapped Zoho salesperson (the painter-program concept reused
    // here). Resolve the display name from the local salesperson master.
    let salespersonId = options.salespersonId || invoice.zoho_salesperson_id || null;
    let salespersonName = null;
    if (!salespersonId && invoice.customer_type === 'painter' && invoice.painter_id) {
        const [pr] = await pool.query('SELECT zoho_salesperson_id FROM painters WHERE id = ?', [invoice.painter_id]);
        if (pr.length && pr[0].zoho_salesperson_id) salespersonId = pr[0].zoho_salesperson_id;
    }
    if (!salespersonId) {
        const err = new Error('A salesperson is required to push this invoice to Zoho. Pick one and try again.');
        err.code = 'SALESPERSON_REQUIRED';
        throw err;
    }
    try {
        const [sp] = await pool.query('SELECT salesperson_name FROM zoho_salespersons WHERE zoho_salesperson_id = ? LIMIT 1', [salespersonId]);
        if (sp.length) salespersonName = sp[0].salesperson_name;
        if (!salespersonName) {
            const [spm] = await pool.query('SELECT zoho_salesperson_name FROM painter_zoho_salesperson_map WHERE zoho_salesperson_id = ? LIMIT 1', [salespersonId]);
            if (spm.length) salespersonName = spm[0].zoho_salesperson_name;
        }
    } catch { /* name is best-effort */ }

    // Location/branch to post the invoice to (owner request 2026-06-12).
    let locationId = options.locationId || invoice.zoho_location_id || null;
    let locationName = null;
    if (locationId) {
        try {
            const [loc] = await pool.query('SELECT zoho_location_name FROM zoho_locations_map WHERE zoho_location_id = ? LIMIT 1', [locationId]);
            if (loc.length) locationName = loc[0].zoho_location_name;
        } catch { /* name is best-effort */ }
    }

    // 2. Load items
    const [items] = await pool.query(
        'SELECT * FROM billing_invoice_items WHERE invoice_id = ? AND deleted_at IS NULL',
        [invoiceId]
    );
    if (!items.length) throw new Error(`Invoice ${invoiceId} has no items`);

    // 3. Resolve Zoho contact
    const zohoContactId = await resolveZohoContact(invoice.customer_type, {
        customerId: invoice.customer_id,
        painterId: invoice.painter_id,
        customerName: invoice.customer_name,
        customerPhone: invoice.customer_phone
    });

    // 4. Push eligibility gate (owner policy 2026-06-12): an invoice may be
    // pushed ONLY when it is fully PAID, or the customer has enough available
    // credit limit to cover the outstanding balance. (Earlier the credit check
    // was "non-blocking" and customers outside the credit system passed —
    // unpaid zero-credit invoices could be pushed.)
    const balanceDue = parseFloat(invoice.balance_due != null
        ? invoice.balance_due
        : (invoice.grand_total - (invoice.amount_paid || 0))) || 0;
    if (invoice.payment_status !== 'paid' && balanceDue > 0.01) {
        let credit = { allowed: false, reason: 'Customer is not in the credit system' };
        try {
            const { checkCreditBeforeInvoice } = require('../routes/credit-limits');
            const result = await checkCreditBeforeInvoice(pool, zohoContactId, balanceDue);
            if (result) credit = result;
        } catch (err) {
            credit = { allowed: false, reason: 'Credit check failed: ' + err.message };
        }
        // checkCreditBeforeInvoice returns allowed:true for customers NOT in
        // the credit system (permissive default other callers rely on). For
        // the push gate, eligibility requires an actual evaluated limit —
        // detected structurally by the credit_limit field being present.
        const creditEligible = credit.allowed === true && credit.credit_limit != null;
        if (!creditEligible) {
            // Leave an audit trail of the refused push (owner queued follow-up).
            // Best-effort — a logging failure must never mask the gate decision.
            try {
                await logCreditViolation(pool, {
                    customerId: invoice.customer_id,
                    zohoCustomerMapId: credit.zoho_customer_map_id,
                    invoiceNumber: invoice.invoice_number,
                    attemptedAmount: balanceDue,
                    creditLimit: credit.credit_limit,
                    creditUsed: credit.outstanding,
                    availableCredit: credit.available,
                    staffId: userId,
                    branchId: invoice.branch_id,
                    actionTaken: 'blocked',
                });
            } catch (logErr) {
                console.error('[billing-zoho] credit violation log failed:', logErr.message);
            }
            const gateErr = new Error(
                `Invoice is not paid (balance ₹${balanceDue.toFixed(2)}) and the customer has no eligible credit — ${credit.reason}. ` +
                'Record the payment first, or set a credit limit for this customer.'
            );
            gateErr.code = 'PUSH_GATE';
            throw gateErr;
        }
    }

    // 5. Create Zoho invoice
    const now = new Date();
    const invoiceDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    const lineItems = items.map(item => ({
        item_id: item.zoho_item_id,
        quantity: parseFloat(item.quantity),
        rate: parseFloat(item.unit_price)
    }));

    // Invoice-level discount (owner model): applied before tax so Zoho computes
    // GST on (subtotal − discount), matching the printed invoice — mirrors the
    // proven bill-push block (routes/vendors.js). Behind the ai_config flag; when
    // off (default) or discount is zero the payload is byte-identical to today.
    // No discount_account_id here: sales-side discounts don't require one (that
    // is a purchase-side concept; if the sales org later demands it, ai_config
    // 'zoho_sales_discount_account_id' is the ready slot per the plan).
    const discountPushEnabled = await isInvoiceDiscountPushEnabled();
    const invDiscount = parseFloat(invoice.discount_amount) || 0;

    const zohoResult = await zohoAPI.createInvoice({
        customer_id: zohoContactId,
        date: invoiceDate,
        line_items: lineItems,
        salesperson_id: salespersonId,
        ...(locationId ? { location_id: locationId } : {}),
        ...(discountPushEnabled && invDiscount > 0 ? {
            discount: invDiscount,
            is_discount_before_tax: true,
            discount_type: 'entity_level'
        } : {})
    });

    const zohoInvoice = zohoResult && zohoResult.invoice;
    if (!zohoInvoice || !zohoInvoice.invoice_id) {
        throw new Error('Failed to create Zoho invoice');
    }

    const zohoInvoiceId = zohoInvoice.invoice_id;
    const zohoInvoiceNumber = zohoInvoice.invoice_number;

    // Take it OUT OF DRAFT (owner 2026-06-12): a staff push is submitted for the
    // admin's Zoho approval; an admin push is approved directly. Done before
    // recording any payment (Zoho won't accept a payment on a draft invoice).
    // draftOnly (admin-only, for the D1 discount draft check): leave the invoice
    // as a Zoho draft — skip finalize AND the push-time payment forwarding. A
    // draft has zero GST impact and is hard-deletable in Zoho.
    let finalizeState = 'draft';
    if (!options.draftOnly) {
        finalizeState = (await zohoAPI.finalizeDocument('invoice', zohoInvoiceId, !!options.isAdmin)).state;
    }

    // 6. Award painter points if applicable
    let pointsResult = null;
    if (invoice.customer_type === 'painter' && invoice.painter_id && pointsEngine) {
        try {
            const invoiceForPoints = {
                invoice_id: zohoInvoiceId,
                invoice_number: zohoInvoiceNumber,
                zoho_invoice_id: zohoInvoiceId, // explicit Zoho link for the credit overdue check (M3)
                date: invoiceDate,
                total: parseFloat(invoice.grand_total),
                line_items: items.map(item => ({
                    item_id: item.zoho_item_id,
                    quantity: parseFloat(item.quantity),
                    item_total: parseFloat(item.line_total)
                }))
            };
            pointsResult = await pointsEngine.processInvoice(
                invoice.painter_id,
                invoiceForPoints,
                'self',
                userId
            );
        } catch (err) {
            console.error('[billing-zoho] Points award error:', err.message);
        }
    }

    // 7. Forward per-row payments to Zoho through the shared sync engine (one
    // code path, one mutex). Replaces the old single aggregate 'Cash' payment:
    // each local billing_payments row now becomes its own Zoho customerpayment
    // with a deterministic reference (ACT-BP-<id>) and its true mode/date, and
    // the returned Zoho id is stamped back onto the row (duplicate-proofing).
    // Best-effort — a payment-sync failure NEVER fails the push. Skipped for
    // draft-only pushes (a Zoho draft can't take payments; D1 reverses it
    // manually). Staff pushes land 'submitted' → the engine leaves the rows
    // pending and the approval sync-back re-fires them once approved.
    let paymentSync = null;
    if (!options.draftOnly) {
        try {
            paymentSync = await forwardInvoicePayments({ invoiceId, zohoInvoiceId });
        } catch (err) {
            console.error('[billing-zoho] payment forwarding error:', err.message);
        }
    }

    // 8. Update billing_invoices (also stamp the salesperson + location used)
    await pool.query(
        `UPDATE billing_invoices
         SET zoho_status = ?, zoho_invoice_id = ?, zoho_invoice_number = ?,
             zoho_salesperson_id = ?, zoho_salesperson_name = ?,
             zoho_location_id = ?, zoho_location_name = ?, zoho_approval_state = ?
         WHERE id = ?`,
        ['pushed', zohoInvoiceId, zohoInvoiceNumber, salespersonId, salespersonName, locationId, locationName, finalizeState, invoiceId]
    );

    // 9. Return result
    return { zohoInvoiceId, zohoInvoiceNumber, salespersonId, salespersonName, locationId, locationName, zohoState: finalizeState, pointsResult, paymentSync };
}

// ═══════════════════════════════════════════
// PER-PAYMENT ZOHO SYNC ENGINE (SP-1 C4)
// ═══════════════════════════════════════════

// Zoho invoice statuses on which we may record a payment. Anything outside this
// set that is NOT void/draft is treated as "awaiting approval" (pending).
const GOOD_INVOICE_STATUSES = new Set([
    'approved', 'sent', 'open', 'overdue', 'partially_paid', 'paid',
]);

function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
function truncate255(s) { return String(s == null ? '' : s).slice(0, 255); }

/**
 * Forward an invoice's unsynced local payments to Zoho Books as individual
 * customerpayments. Idempotent + duplicate-proof by construction:
 *   - deterministic reference_number `ACT-BP-<billing_payments.id>`,
 *   - atomic 'SYNCING' claim (a second worker sees affectedRows 0 and skips),
 *   - adopt-before-create (a matching Zoho payment already exists → stamp it),
 *   - balance clamp (NIT-1 ≤ ₹1 zone honored, > ₹1 fails soft),
 *   - mode-fallback retry (a mode-shaped Zoho rejection → retry once as 'others').
 * A per-row Zoho failure is recorded on the row and never throws.
 *
 * @param {Object} args
 * @param {number} args.invoiceId  billing_invoices.id
 * @param {string} args.zohoInvoiceId Zoho invoice id to apply payments against
 * @returns {Promise<{synced:number, adopted:number, skipped:number, pending:number, failed:Array<{payment_id:number, message:string}>}>}
 */
async function forwardInvoicePayments({ invoiceId, zohoInvoiceId }) {
    const summary = { synced: 0, adopted: 0, skipped: 0, pending: 0, failed: [] };

    // Candidate rows: never-synced or stale-'SYNCING' (>5 min → crashed worker),
    // excluding credit-method and already-stamped (real id / 'LEGACY') rows.
    const candidateSql =
        `SELECT id, invoice_id, amount, payment_method, payment_reference, payment_date, created_at,
                zoho_payment_id, zoho_claimed_at
           FROM billing_payments
          WHERE invoice_id = ? AND deleted_at IS NULL AND payment_method != 'credit'
            AND (zoho_payment_id IS NULL OR (zoho_payment_id = 'SYNCING' AND zoho_claimed_at < NOW() - INTERVAL 5 MINUTE))
          ORDER BY id`;
    const [candidates] = await pool.query(candidateSql, [invoiceId]);

    // Fetch the Zoho invoice ONCE — feeds the customer_id / status / date /
    // balance guards without a second round-trip. A fetch failure is treated as
    // "invoice unavailable" (fail-soft) rather than thrown.
    let zohoInvoice = null;
    let fetchErrMsg = null;
    try {
        const resp = await zohoAPI.getInvoice(zohoInvoiceId);
        zohoInvoice = resp && resp.invoice;
    } catch (e) {
        fetchErrMsg = (e && e.message) || String(e);
    }

    const status = zohoInvoice ? String(zohoInvoice.status || '').toLowerCase() : '';
    const missing = !zohoInvoice || (fetchErrMsg && /does not exist|1002/i.test(fetchErrMsg));

    // GUARD 1 — invoice missing / void / draft: cannot record a payment. These
    // candidate rows were never claimed, so just record the error (leave
    // zoho_payment_id NULL) and report them as failed.
    if (missing || status === 'void' || status === 'draft') {
        const reason = missing
            ? 'Zoho invoice not found — cannot sync payments'
            : `Zoho invoice is ${status} — cannot record a payment in Zoho`;
        for (const row of candidates) {
            await pool.query(
                'UPDATE billing_payments SET zoho_payment_id = NULL, zoho_sync_error = ? WHERE id = ?',
                [truncate255(reason), row.id]
            );
            summary.failed.push({ payment_id: row.id, message: reason });
        }
        return summary;
    }

    // GUARD 2 — awaiting approval (any status outside the good set): leave the
    // rows NULL, marked awaiting approval. The approval sync-back re-fires them.
    if (!GOOD_INVOICE_STATUSES.has(status)) {
        for (const row of candidates) {
            await pool.query(
                'UPDATE billing_payments SET zoho_sync_error = ? WHERE id = ?',
                ['awaiting Zoho approval', row.id]
            );
            summary.pending++;
        }
        return summary;
    }

    // Proceed: use the Zoho invoice's own customer + date + live balance.
    const customerId = zohoInvoice.customer_id;
    const minDate = zohoInvoice.date;
    let localBalance = Number(zohoInvoice.balance);
    const modeOverrides = await loadModeOverrides(pool);

    for (const row of candidates) {
        // (i) atomic claim — the WHERE clause is the concurrency lock.
        const [claim] = await pool.query(
            `UPDATE billing_payments SET zoho_payment_id = 'SYNCING', zoho_claimed_at = NOW()
              WHERE id = ? AND (zoho_payment_id IS NULL OR (zoho_payment_id = 'SYNCING' AND zoho_claimed_at < NOW() - INTERVAL 5 MINUTE))`,
            [row.id]
        );
        if (!claim || !claim.affectedRows) { summary.skipped++; continue; }

        // (ii) adopt-before-create — a Zoho payment with our deterministic
        // reference means a prior run already created it (crash mid-'SYNCING').
        const ref = `ACT-BP-${row.id}`;
        try {
            const found = await zohoAPI.getPayments({ reference_number: ref });
            const list = (found && (found.customerpayments || found.payments)) || [];
            const match = list.find(p => p && p.reference_number === ref && p.payment_id);
            if (match) {
                await pool.query(
                    "UPDATE billing_payments SET zoho_payment_id = ?, zoho_sync_error = NULL WHERE id = ? AND zoho_payment_id = 'SYNCING'",
                    [match.payment_id, row.id]
                );
                summary.adopted++;
                continue;
            }
        } catch {
            // adopt is best-effort — on a lookup error, fall through to create.
        }

        // (iii) build payload + balance clamp (NIT-1 sub-rupee zone honored,
        // never "fix" the drift itself).
        const payload = buildCustomerPaymentPayload({
            zohoContactId: customerId,
            zohoInvoiceId,
            payment: row,
            modeOverrides,
            minDate,
        });
        if (!payload) {
            // Defensive: credit is already filtered in SQL, but never leave a
            // claim dangling if the mapper declines to build a payload.
            await pool.query(
                "UPDATE billing_payments SET zoho_payment_id = NULL WHERE id = ? AND zoho_payment_id = 'SYNCING'",
                [row.id]
            );
            summary.skipped++;
            continue;
        }

        const amount = Number(row.amount);
        const delta = round2(amount - localBalance);
        let clampError = null;
        if (delta > 1) {
            const msg = `local amount exceeds Zoho balance by ${delta} — check discount/void state`;
            await pool.query(
                "UPDATE billing_payments SET zoho_payment_id = NULL, zoho_sync_error = ? WHERE id = ? AND zoho_payment_id = 'SYNCING'",
                [truncate255(msg), row.id]
            );
            summary.failed.push({ payment_id: row.id, message: msg });
            continue;
        } else if (delta > 0) {
            // 0 < delta ≤ ₹1 — clamp the applied amount to Zoho's balance.
            payload.amount = localBalance;
            payload.invoices[0].amount_applied = localBalance;
            clampError = `clamped by ${delta}`;
            payload.description = payload.description ? `${payload.description} (${clampError})` : clampError;
        }

        // (iv) create in Zoho + mode-fallback retry.
        let created = null;
        let lastErr = null;
        try {
            created = await zohoAPI.createPayment(payload);
        } catch (e) {
            lastErr = e;
            if (/mode/i.test((e && e.message) || '')) {
                // A mode-shaped rejection → retry ONCE as 'others', keeping the
                // real method visible in the description for the accountant.
                try {
                    const retry = { ...payload, payment_mode: 'others', invoices: payload.invoices.map(x => ({ ...x })) };
                    const realMethod = String(row.payment_method || '');
                    if (retry.description && retry.description.indexOf(realMethod) === -1) {
                        retry.description = `${realMethod} - ${retry.description}`;
                    } else if (!retry.description) {
                        retry.description = realMethod;
                    }
                    created = await zohoAPI.createPayment(retry);
                    lastErr = null;
                } catch (e2) {
                    lastErr = e2;
                }
            }
        }

        const zpid = created && created.payment && created.payment.payment_id;
        if (zpid) {
            await pool.query(
                "UPDATE billing_payments SET zoho_payment_id = ?, zoho_sync_error = ? WHERE id = ? AND zoho_payment_id = 'SYNCING'",
                [zpid, clampError, row.id]
            );
            localBalance = round2(localBalance - Number(payload.invoices[0].amount_applied));
            summary.synced++;
        } else {
            const msg = truncate255((lastErr && lastErr.message) || 'Zoho createPayment failed');
            await pool.query(
                "UPDATE billing_payments SET zoho_payment_id = NULL, zoho_sync_error = ? WHERE id = ? AND zoho_payment_id = 'SYNCING'",
                [msg, row.id]
            );
            summary.failed.push({ payment_id: row.id, message: msg });
        }
    }

    // D5 fix: refresh the customer's outstanding balance immediately after a
    // successful payment sync, instead of waiting for the hourly syncCustomers.
    // Otherwise a customer who paid minutes ago still reads as fully outstanding
    // and credit "used" stays stale (billing and credit views disagree).
    if (summary.synced > 0 && zohoInvoice && zohoInvoice.customer_id) {
        try {
            const contactResp = await zohoAPI.getContact(zohoInvoice.customer_id);
            const contact = contactResp && (contactResp.contact || contactResp.data);
            const outstanding = contact && Number(contact.outstanding_receivable_amount);
            if (outstanding !== null && outstanding !== undefined && !isNaN(outstanding)) {
                await pool.query(
                    `UPDATE zoho_customers_map
                     SET zoho_outstanding = ?, last_synced_at = NOW()
                     WHERE zoho_contact_id = ?`,
                    [outstanding, zohoInvoice.customer_id]
                );
            }
        } catch (refreshErr) {
            console.warn('[billing-zoho] outstanding refresh skipped:', refreshErr.message);
        }
    }

    return summary;
}

/**
 * Sync a single local invoice's payments to Zoho. Throws code
 * INVOICE_NOT_PUSHED unless the invoice is pushed (zoho_status='pushed' with a
 * zoho_invoice_id); otherwise delegates to forwardInvoicePayments.
 * @param {number} invoiceId billing_invoices.id
 */
async function syncInvoicePaymentsToZoho(invoiceId) {
    const [rows] = await pool.query(
        'SELECT id, zoho_status, zoho_invoice_id FROM billing_invoices WHERE id = ? AND deleted_at IS NULL',
        [invoiceId]
    );
    if (!rows.length || rows[0].zoho_status !== 'pushed' || !rows[0].zoho_invoice_id) {
        const err = new Error('Invoice is not pushed to Zoho yet');
        err.code = 'INVOICE_NOT_PUSHED';
        throw err;
    }
    return forwardInvoicePayments({ invoiceId, zohoInvoiceId: rows[0].zoho_invoice_id });
}

/**
 * Approval sync-back: pull a pushed invoice's CURRENT Zoho lifecycle status and
 * store it locally, so an admin approving a staff-submitted invoice in Zoho's own
 * UI is reflected here. No-op (returns null) for invoices not yet pushed to Zoho.
 * @param {number} invoiceId - billing_invoices.id
 * @returns {Promise<string|null>} the refreshed Zoho status, or null
 */
async function syncInvoiceApprovalState(invoiceId) {
    const [rows] = await pool.query(
        'SELECT zoho_invoice_id FROM billing_invoices WHERE id = ?',
        [invoiceId]
    );
    if (!rows.length || !rows[0].zoho_invoice_id) return null;
    const zohoInvoiceId = rows[0].zoho_invoice_id;
    const state = await zohoAPI.getDocumentStatus('invoice', zohoInvoiceId);
    if (state) {
        await pool.query('UPDATE billing_invoices SET zoho_approval_state = ? WHERE id = ?', [state, invoiceId]);
        // Once an invoice reaches an approved/live state, any payments that were
        // left pending at push time (staff submission → awaiting approval) can
        // now flow to Zoho. Best-effort — never let this fail the status sync.
        if (['approved', 'sent', 'open'].includes(String(state).toLowerCase())) {
            try {
                await forwardInvoicePayments({ invoiceId, zohoInvoiceId });
            } catch (err) {
                console.error('[billing-zoho] approval re-fire payment sync error:', err.message);
            }
        }
    }
    return state;
}

module.exports = {
    setPool, setPointsEngine, resolveZohoContact, pushInvoiceToZoho,
    syncInvoiceApprovalState, forwardInvoicePayments, syncInvoicePaymentsToZoho,
};
