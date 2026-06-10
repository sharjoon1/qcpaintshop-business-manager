/**
 * Customer Portal Routes
 * /api/customer/auth/* and /api/customer/me/* — mounted at /api so paths keep
 * their original shape.
 * A1: extracted verbatim from server.js (pure mechanical move, no logic changes).
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { otpLimiter } = require('../middleware/rateLimiter');
const { hashOtp, otpMatches, MAX_OTP_ATTEMPTS } = require('../services/otp-utils');
const customerAuthService = require('../services/customer-auth');
const { requireCustomerAuth } = require('../middleware/customerAuth');
const smsService = require('../services/sms-service');

let pool = null;
function setPool(p) {
    pool = p;
}

// ========================================
// CUSTOMER AUTH (OTP)
// ========================================

// Customer OTP uses DB (otp_verifications table) so OTPs survive server restarts

router.post('/customer/auth/send-otp', otpLimiter, async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone || !/^[6-9]\d{9}$/.test(phone)) {
            return res.status(400).json({ success: false, message: 'Valid 10-digit phone required' });
        }

        // Check if customer exists (by phone in customers or estimate_requests)
        const [customers] = await pool.query(
            'SELECT id, name FROM customers WHERE phone = ? LIMIT 1',
            [phone]
        );
        const [requests] = await pool.query(
            'SELECT id, customer_name FROM estimate_requests WHERE phone = ? LIMIT 1',
            [phone]
        );

        if (customers.length === 0 && requests.length === 0) {
            return res.status(404).json({ success: false, message: 'No account found with this phone number. Please submit an estimate request first.' });
        }

        // Rate limit: max 5 OTPs per hour
        const [rateCheck] = await pool.query(
            'SELECT COUNT(*) as count FROM otp_verifications WHERE phone = ? AND purpose = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)',
            [phone, 'login']
        );
        if (rateCheck[0].count >= 5) {
            return res.status(429).json({ success: false, message: 'Too many OTP requests. Try again after some time.' });
        }

        // Invalidate old OTPs
        await pool.query(
            'UPDATE otp_verifications SET verified = 1 WHERE phone = ? AND purpose = ? AND verified = 0',
            [phone, 'login']
        );

        // Generate 6-digit OTP; store only its hash (S2). The console.log that
        // printed every customer OTP to prod pm2 logs is removed (Q-B10: owner
        // confirmed no support workflow reads it).
        const otp = String(crypto.randomInt(100000, 1000000));
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
        await pool.query(
            'INSERT INTO otp_verifications (phone, otp, purpose, expires_at) VALUES (?, ?, ?, ?)',
            [phone, hashOtp(otp), 'login', expiresAt]
        );

        {
            const message = `Your verification OTP for Quality Colours registration is ${otp}. Please enter this code at https://qcpaintshop.com/ to complete setup. - QUALITY COLOURS.`;
            smsService.sendSms({ number: '91' + phone, text: message, label: 'Customer SMS' });
        }

        res.json({ success: true, message: 'OTP sent successfully' });
    } catch (error) {
        console.error('Send OTP error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/customer/auth/verify-otp', otpLimiter, async (req, res) => {
    try {
        const { phone, otp } = req.body;
        if (!phone || !otp) {
            return res.status(400).json({ success: false, message: 'Phone and OTP required' });
        }

        // Find the latest unverified OTP from DB
        const [otpRows] = await pool.query(
            'SELECT id, otp, attempts, expires_at FROM otp_verifications WHERE phone = ? AND purpose = ? AND verified = 0 ORDER BY id DESC LIMIT 1',
            [phone, 'login']
        );

        if (otpRows.length === 0) {
            return res.status(400).json({ success: false, message: 'OTP expired. Please request a new one.' });
        }

        const stored = otpRows[0];

        if (new Date() > new Date(stored.expires_at)) {
            await pool.query('UPDATE otp_verifications SET verified = 1 WHERE id = ?', [stored.id]);
            return res.status(400).json({ success: false, message: 'OTP expired. Please request a new one.' });
        }

        // S2: hashed compare + wrong-guess cap per issued code.
        if (stored.attempts >= MAX_OTP_ATTEMPTS) {
            await pool.query('UPDATE otp_verifications SET verified = 1 WHERE id = ?', [stored.id]);
            return res.status(400).json({ success: false, message: 'Too many wrong attempts. Request a new OTP.' });
        }
        if (!otpMatches(stored.otp, otp)) {
            await pool.query('UPDATE otp_verifications SET attempts = attempts + 1 WHERE id = ?', [stored.id]);
            // S4: audit failed customer login
            require('../services/audit-log').record(req, {
                action: 'CUSTOMER_LOGIN_FAILED', entity_type: 'customer', entity_id: null,
                after: { phone, reason: 'wrong_otp' }
            });
            return res.status(400).json({ success: false, message: 'Invalid OTP. Please try again.' });
        }

        // Mark OTP as verified
        await pool.query('UPDATE otp_verifications SET verified = 1 WHERE id = ?', [stored.id]);

        // Find customer
        let customerName = 'Customer';
        let customerId = null;
        const [customers] = await pool.query('SELECT id, name FROM customers WHERE phone = ? LIMIT 1', [phone]);
        if (customers.length > 0) {
            customerName = customers[0].name;
            customerId = customers[0].id;
        } else {
            const [requests] = await pool.query('SELECT id, customer_name FROM estimate_requests WHERE phone = ? LIMIT 1', [phone]);
            if (requests.length > 0) {
                customerName = requests[0].customer_name;
            }
        }

        const token = await customerAuthService.createSession({
            customerId,
            phone,
            ip: req.ip,
            userAgent: req.get('User-Agent')
        });

        // S4: audit successful customer login
        require('../services/audit-log').record(req, {
            action: 'CUSTOMER_LOGIN_SUCCESS', entity_type: 'customer', entity_id: customerId,
            after: { phone }
        });

        res.json({
            success: true,
            data: { name: customerName, customer_id: customerId, phone, token }
        });
    } catch (error) {
        console.error('Verify OTP error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/customer/auth/logout', async (req, res) => {
    try {
        const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
        if (token) await customerAuthService.revoke(token);
        res.json({ success: true });
    } catch (error) {
        console.error('Customer logout error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

router.get('/customer/auth/me', requireCustomerAuth, async (req, res) => {
    try {
        let name = 'Customer';
        if (req.customer.id) {
            const [c] = await pool.query('SELECT name FROM customers WHERE id = ? LIMIT 1', [req.customer.id]);
            if (c.length) name = c[0].name;
        } else {
            const [er] = await pool.query('SELECT customer_name FROM estimate_requests WHERE phone = ? ORDER BY id DESC LIMIT 1', [req.customer.phone]);
            if (er.length) name = er[0].customer_name;
        }
        res.json({ success: true, data: { name, customer_id: req.customer.id, phone: req.customer.phone } });
    } catch (error) {
        console.error('Customer me error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Customer-scoped endpoints — only return rows whose phone matches the
// authenticated customer's phone (derived from their session, never trusted
// from query string).
router.get('/customer/me/requests', requireCustomerAuth, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const [rows] = await pool.query(
            `SELECT er.id, er.request_number, er.customer_name, er.phone, er.status, er.priority,
                    er.project_type, er.property_type, er.area_sqft,
                    er.created_at, er.updated_at, COUNT(erp.id) AS photo_count
             FROM estimate_requests er
             LEFT JOIN estimate_request_photos erp ON er.id = erp.request_id
             WHERE er.phone = ?
             GROUP BY er.id
             ORDER BY er.created_at DESC
             LIMIT ?`,
            [req.customer.phone, limit]
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Customer requests error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

router.get('/customer/me/requests/:id', requireCustomerAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT er.* FROM estimate_requests er WHERE er.id = ? AND er.phone = ? LIMIT 1`,
            [req.params.id, req.customer.phone]
        );
        if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
        const [photos] = await pool.query(
            'SELECT id, photo_url, caption FROM estimate_request_photos WHERE request_id = ?',
            [req.params.id]
        );
        res.json({ success: true, data: { ...rows[0], photos } });
    } catch (error) {
        console.error('Customer request detail error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

router.get('/customer/me/estimates/:id', requireCustomerAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT e.* FROM estimates e
             LEFT JOIN customers c ON e.customer_id = c.id
             WHERE e.id = ? AND (c.phone = ? OR e.customer_phone = ?)
             LIMIT 1`,
            [req.params.id, req.customer.phone, req.customer.phone]
        );
        if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
        const [items] = await pool.query(
            'SELECT * FROM estimate_items WHERE estimate_id = ? AND deleted_at IS NULL',
            [req.params.id]
        );
        res.json({ success: true, data: { ...rows[0], items } });
    } catch (error) {
        console.error('Customer estimate detail error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Customer portal — PDF of the authenticated customer's own estimate.
// Same ownership match as GET /api/customer/me/estimates/:id, then reuse the
// shared PDFKit generator (same one the public share PDF uses).
router.get('/customer/me/estimates/:id/pdf', requireCustomerAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT e.* FROM estimates e
             LEFT JOIN customers c ON e.customer_id = c.id
             WHERE e.id = ? AND (c.phone = ? OR e.customer_phone = ?)
             LIMIT 1`,
            [req.params.id, req.customer.phone, req.customer.phone]
        );
        if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
        const estimate = rows[0];
        const [items] = await pool.query(
            `SELECT ei.*, p.name as product_name FROM estimate_items ei
             LEFT JOIN products p ON ei.product_id = p.id
             WHERE ei.estimate_id = ? AND ei.deleted_at IS NULL ORDER BY ei.display_order, ei.id`,
            [req.params.id]
        );
        const { getBranding } = require('../services/branding');
        const branding = await getBranding(pool);
        let colVis = { show_qty: true, show_mix: true, show_price: true, show_breakdown: true, show_color: true, show_total: true };
        if (estimate.column_visibility) {
            try { colVis = { ...colVis, ...JSON.parse(estimate.column_visibility) }; } catch {}
        }
        const { generateEstimatePDF } = require('./estimate-pdf-generator');
        generateEstimatePDF(res, estimate, items, branding, colVis);
    } catch (error) {
        console.error('Customer estimate PDF error:', error);
        if (!res.headersSent) res.status(500).json({ success: false, message: 'Failed to generate PDF' });
    }
});

// Customer portal — Zoho invoices for the authenticated customer.
// Match path: req.customer.phone → zoho_customers_map.zoho_phone →
// zoho_contact_id → zoho_invoices.zoho_customer_id. Matches against the
// last 10 digits so +91-prefixed and bare phone numbers both line up
// (the rest of the app already stores both forms inconsistently).
router.get('/customer/me/invoices', requireCustomerAuth, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        const [rows] = await pool.query(
            `SELECT zi.id, zi.zoho_invoice_id, zi.invoice_number, zi.invoice_date,
                    zi.due_date, zi.total, zi.balance, zi.status, zi.customer_name
             FROM zoho_invoices zi
             JOIN zoho_customers_map zcm ON zi.zoho_customer_id = zcm.zoho_contact_id
             WHERE RIGHT(zcm.zoho_phone, 10) = RIGHT(?, 10)
             ORDER BY zi.invoice_date DESC, zi.id DESC
             LIMIT ?`,
            [req.customer.phone, limit]
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Customer invoices list error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

router.get('/customer/me/invoices/:id', requireCustomerAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT zi.*
             FROM zoho_invoices zi
             JOIN zoho_customers_map zcm ON zi.zoho_customer_id = zcm.zoho_contact_id
             WHERE zi.id = ? AND RIGHT(zcm.zoho_phone, 10) = RIGHT(?, 10)
             LIMIT 1`,
            [req.params.id, req.customer.phone]
        );
        if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
        res.json({ success: true, data: rows[0] });
    } catch (error) {
        console.error('Customer invoice detail error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = {
    router,
    setPool
};
