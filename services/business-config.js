/**
 * Business / merchant config helper (SVC-037).
 *
 * Reads payment-merchant settings from the ai_config (config_key/config_value)
 * store with safe fallbacks to the historical hard-coded literals, so changing
 * the merchant VPA no longer needs a code deploy and behaviour is unchanged
 * when the keys are absent.
 *
 * Pass the caller's existing pool — no global state, so any route can reuse it:
 *   const { vpa, payee } = await require('../services/business-config').getUpiConfig(pool);
 */

const UPI_DEFAULTS = { vpa: '7418831122@superyes', payee: 'Quality Colours' };

async function getUpiConfig(pool) {
    const out = { ...UPI_DEFAULTS };
    if (!pool) return out;
    try {
        const [rows] = await pool.query(
            "SELECT config_key, config_value FROM ai_config WHERE config_key IN ('business_upi_vpa','business_upi_payee')"
        );
        for (const r of rows) {
            const v = r.config_value;
            if (v == null || String(v).trim() === '') continue;
            if (r.config_key === 'business_upi_vpa') out.vpa = String(v).trim();
            if (r.config_key === 'business_upi_payee') out.payee = String(v).trim();
        }
    } catch (e) {
        // ai_config missing/unavailable — fall back to defaults
    }
    return out;
}

/**
 * Build a upi://pay deep link from a UPI config + amount + note. Payee is
 * URL-encoded; amount is fixed to 2 decimals.
 */
function buildUpiUrl(upi, amount, note) {
    const amt = (parseFloat(amount) || 0).toFixed(2);
    const tn = encodeURIComponent(note || '');
    return `upi://pay?pa=${upi.vpa}&pn=${encodeURIComponent(upi.payee)}&am=${amt}&cu=INR&tn=${tn}`;
}

module.exports = { getUpiConfig, buildUpiUrl, UPI_DEFAULTS };
