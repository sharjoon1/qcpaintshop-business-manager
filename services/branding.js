/**
 * branding.js — shared business-branding lookup.
 * Reads branding fields from the `settings` table. Depends only on a mysql2 pool.
 */
async function getBranding(pool) {
    try {
        const [settings] = await pool.query(
            "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('business_name','business_logo','business_phone','business_email','business_address','business_gst')"
        );
        const obj = {};
        settings.forEach(s => { obj[s.setting_key] = s.setting_value; });
        return obj;
    } catch {
        return {};
    }
}

module.exports = { getBranding };
