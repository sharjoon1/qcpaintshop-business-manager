/**
 * Zoho payment mapper (SP-1) — a PURE module (no pool stored, no network).
 *
 * Single source of truth for turning an in-app payment row into a Zoho Books
 * customerpayment / vendorpayment payload:
 *   - payment-mode mapping (config-overridable, `credit` never forwarded),
 *   - IST-correct payment dates (server clock is IST, DB session is UTC),
 *   - deterministic reference numbers for duplicate-proofing,
 *   - reversal classification from the stored zoho_payment_id sentinel.
 *
 * Everything is exported so it can be unit-tested directly (precedent:
 * paymentExceedsBalance). mysql2 DECIMAL columns arrive as strings — amounts
 * are coerced with Number() here.
 */

// Local payment_method → Zoho payment_mode. `credit` maps to null = do NOT
// forward to Zoho at all (owner decision 2026-07-12).
const DEFAULT_MODE_MAP = {
    cash: 'cash',
    upi: 'UPI',
    bank_transfer: 'banktransfer',
    cheque: 'check',
    credit: null,
};

/**
 * Map a local payment_method to a Zoho payment_mode.
 * - A known method (incl. an override entry) returns its mapped value; an
 *   explicit null (e.g. `credit`) stays null → caller must NOT forward it.
 * - An unknown method falls back to 'others'.
 * @param {string} method local payment_method
 * @param {Object} [overrides] merged over the defaults (ai_config)
 * @returns {string|null}
 */
function mapPaymentModeToZoho(method, overrides = {}) {
    const merged = { ...DEFAULT_MODE_MAP, ...(overrides || {}) };
    if (Object.prototype.hasOwnProperty.call(merged, method)) {
        return merged[method];
    }
    return 'others';
}

/**
 * Best-effort load of the `zoho_payment_mode_map` JSON override from ai_config.
 * Returns {} on any error (missing key, bad JSON, no table) — never throws.
 * @param {Object} pool mysql2 pool
 * @returns {Promise<Object>}
 */
async function loadModeOverrides(pool) {
    try {
        const [rows] = await pool.query(
            "SELECT config_value FROM ai_config WHERE config_key = 'zoho_payment_mode_map' LIMIT 1"
        );
        if (rows && rows.length && rows[0].config_value) {
            const parsed = JSON.parse(rows[0].config_value);
            if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
                return parsed;
            }
        }
    } catch (e) {
        // best-effort — fall through to {}
    }
    return {};
}

/**
 * Format a date-like value as a yyyy-mm-dd calendar date in Asia/Kolkata.
 * The server clock is IST while the DB session is UTC, so a naive
 * toISOString() would mis-date late-evening payments — always use IST here.
 * @param {Date|string|number} dateLike
 * @returns {string|null}
 */
function istDateString(dateLike) {
    if (dateLike === null || dateLike === undefined || dateLike === '') return null;
    const d = dateLike instanceof Date ? dateLike : new Date(dateLike);
    if (isNaN(d.getTime())) return null;
    // en-CA renders as yyyy-mm-dd.
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).format(d);
}

/**
 * Normalise a stored DATE/DATETIME (string or Date) to a yyyy-mm-dd string.
 * A DATE column carries no time; a plain 'YYYY-MM-DD...' string keeps its own
 * calendar day, while a Date object is rendered in IST.
 */
function toDateString(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'string') return v.slice(0, 10);
    if (v instanceof Date) return istDateString(v);
    return null;
}

/** Build the resolved payment date, clamped to be >= minDate when given. */
function resolvePaymentDate(payment, minDate) {
    let date = toDateString(payment.payment_date) || istDateString(payment.created_at);
    if (minDate && date && date < minDate) date = minDate;
    return date;
}

/** Human-readable description: original local method + any reference. */
function buildDescription(payment) {
    let desc = String(payment.payment_method || '');
    if (payment.payment_reference) {
        desc = desc
            ? `${desc} - ${payment.payment_reference}`
            : String(payment.payment_reference);
    }
    return desc;
}

/**
 * Build a Zoho customerpayment payload for an AR (billing) payment.
 * Returns null when the mode maps to null (e.g. `credit`) — do not forward.
 * @param {Object} args
 * @param {string} args.zohoContactId Zoho customer_id
 * @param {string} args.zohoInvoiceId Zoho invoice_id to apply against
 * @param {Object} args.payment billing_payments row
 * @param {Object} [args.modeOverrides] ai_config override map
 * @param {string} [args.minDate] Zoho invoice date (yyyy-mm-dd) lower bound
 * @returns {Object|null}
 */
function buildCustomerPaymentPayload({ zohoContactId, zohoInvoiceId, payment, modeOverrides = {}, minDate = null }) {
    const mode = mapPaymentModeToZoho(payment.payment_method, modeOverrides);
    if (mode === null) return null;

    const amount = Number(payment.amount);
    return {
        customer_id: zohoContactId,
        payment_mode: mode,
        amount,
        date: resolvePaymentDate(payment, minDate),
        reference_number: `ACT-BP-${payment.id}`,
        description: buildDescription(payment),
        invoices: [{ invoice_id: zohoInvoiceId, amount_applied: amount }],
    };
}

/**
 * Build a Zoho vendorpayment payload for an AP (vendor) payment.
 * Returns null when the mode maps to null — do not forward.
 * On-account (no zohoBillId) omits `bills`; `paid_through_account_id` and
 * `location_id` are only included when provided (owner decision 2026-07-12).
 * @param {Object} args
 * @param {string} args.zohoVendorId Zoho vendor_id
 * @param {string} [args.zohoBillId] Zoho bill_id when bill-linked
 * @param {Object} args.payment vendor_payments row
 * @param {string} [args.paidThroughAccountId]
 * @param {string} [args.locationId]
 * @param {Object} [args.modeOverrides]
 * @returns {Object|null}
 */
function buildVendorPaymentPayload({ zohoVendorId, zohoBillId = null, payment, paidThroughAccountId = null, locationId = null, modeOverrides = {} }) {
    const mode = mapPaymentModeToZoho(payment.payment_method, modeOverrides);
    if (mode === null) return null;

    const amount = Number(payment.amount);
    const payload = {
        vendor_id: zohoVendorId,
        payment_mode: mode,
        amount,
        date: resolvePaymentDate(payment, null),
        reference_number: `ACT-VP-${payment.id}`,
        description: buildDescription(payment),
    };
    if (zohoBillId) {
        payload.bills = [{ bill_id: zohoBillId, amount_applied: amount }];
    }
    if (paidThroughAccountId) payload.paid_through_account_id = paidThroughAccountId;
    if (locationId) payload.location_id = locationId;
    return payload;
}

/**
 * Classify what a reversal must do, based on the stored zoho_payment_id.
 * - real id       → 'zoho_delete_required' (call deleteCustomer/VendorPayment)
 * - 'LEGACY'      → 'legacy_manual' (pre-SP1, adjust in Zoho by hand)
 * - 'SYNCING'     → 'in_flight' (a forward is mid-flight)
 * - null / empty  → 'local_only' (never reached Zoho)
 * @param {string|null} zohoPaymentId
 * @returns {'zoho_delete_required'|'legacy_manual'|'in_flight'|'local_only'}
 */
function classifyPaymentReversal(zohoPaymentId) {
    if (!zohoPaymentId) return 'local_only';
    if (zohoPaymentId === 'LEGACY') return 'legacy_manual';
    if (zohoPaymentId === 'SYNCING') return 'in_flight';
    return 'zoho_delete_required';
}

module.exports = {
    DEFAULT_MODE_MAP,
    mapPaymentModeToZoho,
    loadModeOverrides,
    istDateString,
    buildCustomerPaymentPayload,
    buildVendorPaymentPayload,
    classifyPaymentReversal,
};
