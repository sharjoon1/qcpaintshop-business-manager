const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const PDFDocument = require('pdfkit');
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('../middleware/permissionMiddleware');

let pool;
function setPool(dbPool) { pool = dbPool; }

// Helper: format currency Indian style
function formatINR(num) {
    const n = parseFloat(num) || 0;
    return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

// ========================================
// AUTHENTICATED ENDPOINTS
// ========================================

// POST /api/share/generate - Create a share token
router.post('/generate', requireAuth, async (req, res) => {
    try {
        const { resource_type, resource_id, expires_in_days } = req.body;

        if (!resource_type || !resource_id) {
            return res.status(400).json({ success: false, message: 'resource_type and resource_id are required' });
        }

        // Validate resource exists
        let tableName;
        if (resource_type === 'estimate') tableName = 'estimates';
        else if (resource_type === 'design-request') tableName = 'estimate_requests';
        else return res.status(400).json({ success: false, message: 'Invalid resource_type. Use: estimate, design-request' });

        const [rows] = await pool.query(`SELECT id FROM ${tableName} WHERE id = ?`, [resource_id]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Resource not found' });
        }

        // Generate unique token
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = expires_in_days
            ? new Date(Date.now() + expires_in_days * 24 * 60 * 60 * 1000)
            : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // Default 30 days

        await pool.query(
            `INSERT INTO share_tokens (token, resource_type, resource_id, created_by, expires_at) VALUES (?, ?, ?, ?, ?)`,
            [token, resource_type, resource_id, req.user.id, expiresAt]
        );

        const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
        const shareUrl = `${baseUrl}/share/${resource_type}/${token}`;

        res.json({
            success: true,
            data: { token, share_url: shareUrl, expires_at: expiresAt }
        });
    } catch (error) {
        console.error('Share generate error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/share/whatsapp - Generate share token + WhatsApp URL
router.post('/whatsapp', requireAuth, async (req, res) => {
    try {
        const { resource_type, resource_id, customer_phone, message_template } = req.body;

        if (!resource_type || !resource_id) {
            return res.status(400).json({ success: false, message: 'resource_type and resource_id required' });
        }

        // Validate resource and get details
        let customerName = 'Customer';
        let resourceLabel = '';
        if (resource_type === 'estimate') {
            const [rows] = await pool.query('SELECT id, estimate_number, customer_name, customer_phone FROM estimates WHERE id = ?', [resource_id]);
            if (rows.length === 0) return res.status(404).json({ success: false, message: 'Estimate not found' });
            customerName = rows[0].customer_name || 'Customer';
            resourceLabel = rows[0].estimate_number;
        } else if (resource_type === 'design-request') {
            const [rows] = await pool.query('SELECT id, customer_name, customer_phone FROM estimate_requests WHERE id = ?', [resource_id]);
            if (rows.length === 0) return res.status(404).json({ success: false, message: 'Design request not found' });
            customerName = rows[0].customer_name || 'Customer';
            resourceLabel = `Design Request #${resource_id}`;
        } else {
            return res.status(400).json({ success: false, message: 'Invalid resource_type' });
        }

        // Generate token
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        await pool.query(
            `INSERT INTO share_tokens (token, resource_type, resource_id, created_by, expires_at) VALUES (?, ?, ?, ?, ?)`,
            [token, resource_type, resource_id, req.user.id, expiresAt]
        );

        const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
        const shareUrl = `${baseUrl}/share/${resource_type}/${token}`;

        // Build WhatsApp message
        const branding = await getBranding();
        const bizName = branding.business_name || 'Quality Colours';
        const defaultMsg = `Dear ${customerName},\n\nPlease find your ${resource_type === 'estimate' ? 'estimate' : 'design request'} (${resourceLabel}) from ${bizName}:\n\n${shareUrl}\n\nThank you!\n${bizName}`;
        const message = message_template || defaultMsg;

        // Format phone for wa.me
        let phone = customer_phone || '';
        phone = phone.replace(/[^0-9]/g, '');
        if (phone.length === 10) phone = '91' + phone;

        const waUrl = phone
            ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
            : `https://wa.me/?text=${encodeURIComponent(message)}`;

        res.json({
            success: true,
            data: { token, share_url: shareUrl, whatsapp_url: waUrl, message }
        });
    } catch (error) {
        console.error('WhatsApp share error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// PUBLIC ENDPOINTS (No Auth)
// ========================================

// GET /api/public/share/:token - Get shared resource data
router.get('/public/:token', async (req, res) => {
    try {
        const [tokens] = await pool.query(
            `SELECT * FROM share_tokens WHERE token = ? AND is_active = 1 AND (expires_at IS NULL OR expires_at > NOW())`,
            [req.params.token]
        );

        if (tokens.length === 0) {
            return res.status(404).json({ success: false, message: 'Link expired or invalid' });
        }

        const shareToken = tokens[0];

        // Increment view count
        await pool.query('UPDATE share_tokens SET view_count = view_count + 1 WHERE id = ?', [shareToken.id]);

        // Fetch resource data
        let data = null;
        if (shareToken.resource_type === 'estimate') {
            const [estimates] = await pool.query('SELECT * FROM estimates WHERE id = ?', [shareToken.resource_id]);
            if (estimates.length === 0) return res.status(404).json({ success: false, message: 'Estimate not found' });
            data = estimates[0];

            const [items] = await pool.query(
                `SELECT ei.*, p.name as product_name FROM estimate_items ei
                 LEFT JOIN products p ON ei.product_id = p.id
                 WHERE ei.estimate_id = ? ORDER BY ei.display_order`,
                [shareToken.resource_id]
            );
            data.items = items;
        } else if (shareToken.resource_type === 'design-request') {
            const [requests] = await pool.query('SELECT * FROM estimate_requests WHERE id = ?', [shareToken.resource_id]);
            if (requests.length === 0) return res.status(404).json({ success: false, message: 'Design request not found' });
            data = requests[0];
        }

        const branding = await getBranding();

        res.json({
            success: true,
            data: {
                resource_type: shareToken.resource_type,
                resource: data,
                branding,
                shared_at: shareToken.created_at,
                expires_at: shareToken.expires_at
            }
        });
    } catch (error) {
        console.error('Public share error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/public/share/:token/pdf - Generate PDF for shared estimate
router.get('/public/:token/pdf', async (req, res) => {
    try {
        const [tokens] = await pool.query(
            `SELECT * FROM share_tokens WHERE token = ? AND is_active = 1 AND (expires_at IS NULL OR expires_at > NOW())`,
            [req.params.token]
        );

        if (tokens.length === 0) {
            return res.status(404).json({ success: false, message: 'Link expired or invalid' });
        }

        const shareToken = tokens[0];
        if (shareToken.resource_type !== 'estimate') {
            return res.status(400).json({ success: false, message: 'PDF generation only available for estimates' });
        }

        const [estimates] = await pool.query('SELECT * FROM estimates WHERE id = ?', [shareToken.resource_id]);
        if (estimates.length === 0) return res.status(404).json({ success: false, message: 'Estimate not found' });
        const estimate = estimates[0];

        const [items] = await pool.query(
            `SELECT ei.*, p.name as product_name FROM estimate_items ei
             LEFT JOIN products p ON ei.product_id = p.id
             WHERE ei.estimate_id = ? ORDER BY ei.display_order`,
            [shareToken.resource_id]
        );

        const branding = await getBranding();

        // Parse column visibility
        let colVis = { show_qty: true, show_mix: true, show_price: true, show_breakdown: true, show_color: true, show_total: true };
        if (estimate.column_visibility) {
            try { colVis = { ...colVis, ...JSON.parse(estimate.column_visibility) }; } catch {}
        }

        // Reuse PDF generation logic from estimate-pdf.js
        const { generateEstimatePDF } = require('./estimate-pdf-generator');
        generateEstimatePDF(res, estimate, items, branding, colVis);

    } catch (error) {
        console.error('Public PDF error:', error);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'Failed to generate PDF' });
        }
    }
});

module.exports = { router, setPool };
