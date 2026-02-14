const express = require('express');
const router = express.Router();
const { generateEstimatePDF } = require('./estimate-pdf-generator');

let pool;
function setPool(dbPool) { pool = dbPool; }

// Auth helper: supports both Authorization header AND ?token= query param (for Android DownloadManager)
async function authenticateRequest(req) {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
    if (!token) return null;
    const [sessions] = await pool.query(
        `SELECT s.*, u.id as user_id, u.username, u.role, u.full_name
         FROM user_sessions s JOIN users u ON s.user_id = u.id
         WHERE s.session_token = ? AND s.expires_at > NOW() AND u.status = 'active'`,
        [token]
    );
    return sessions.length > 0 ? sessions[0] : null;
}

// Helper: get branding settings
async function getBranding() {
    try {
        const [settings] = await pool.query(
            "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('business_name','business_logo','business_phone','business_email','business_address','business_gst')"
        );
        const obj = {};
        settings.forEach(s => { obj[s.setting_key] = s.setting_value; });
        return obj;
    } catch { return {}; }
}

// GET /api/estimates/:id/pdf
router.get('/:id/pdf', async (req, res) => {
    try {
        const user = await authenticateRequest(req);
        if (!user) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }

        const [estimates] = await pool.query('SELECT * FROM estimates WHERE id = ?', [req.params.id]);
        if (estimates.length === 0) {
            return res.status(404).json({ success: false, message: 'Estimate not found' });
        }
        const estimate = estimates[0];

        const [items] = await pool.query(
            `SELECT ei.*, p.name as product_name, p.product_type
             FROM estimate_items ei
             LEFT JOIN products p ON ei.product_id = p.id
             WHERE ei.estimate_id = ? ORDER BY ei.display_order`,
            [req.params.id]
        );

        const branding = await getBranding();

        // Parse column visibility
        let colVis = { show_qty: true, show_mix: true, show_price: true, show_breakdown: true, show_color: true, show_total: true };
        if (estimate.column_visibility) {
            try { colVis = { ...colVis, ...JSON.parse(estimate.column_visibility) }; } catch {}
        }

        generateEstimatePDF(res, estimate, items, branding, colVis);

    } catch (error) {
        console.error('PDF generation error:', error);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'Failed to generate PDF' });
        }
    }
});

module.exports = { router, setPool };
