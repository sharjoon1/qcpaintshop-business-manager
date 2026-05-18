const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/permissionMiddleware');
const totpService = require('../services/totp-service');

let pool;
function setPool(p) { pool = p; }

// GET /api/2fa/setup — generate secret + QR for current user
router.get('/setup', requireAuth, async (req, res) => {
    try {
        const [users] = await pool.query(
            'SELECT id, username, role, totp_enabled FROM users WHERE id = ?',
            [req.user.id]
        );
        const user = users[0];
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });
        if (!['admin', 'manager'].includes(user.role)) {
            return res.status(403).json({ success: false, error: '2FA is only required for admin and manager roles' });
        }
        if (user.totp_enabled) return res.json({ success: true, already_enabled: true });

        const secret = totpService.generateSecret(user.username);
        await pool.query('UPDATE users SET totp_secret = ? WHERE id = ?', [secret.base32, user.id]);
        const qrDataUrl = await totpService.generateQRCode(secret.otpauth_url);
        res.json({ success: true, qr: qrDataUrl, manual_key: secret.base32 });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// POST /api/2fa/verify-setup — confirm the user scanned and has a working token
router.post('/verify-setup', requireAuth, async (req, res) => {
    try {
        const { token } = req.body;
        if (!token) return res.status(400).json({ success: false, error: 'Token required' });
        const [users] = await pool.query('SELECT totp_secret FROM users WHERE id = ?', [req.user.id]);
        const user = users[0];
        if (!user?.totp_secret) {
            return res.status(400).json({ success: false, error: 'No secret found. Start setup again.' });
        }

        const valid = totpService.verifyToken(user.totp_secret, token);
        if (!valid) {
            return res.status(400).json({ success: false, error: 'Invalid token. Check your authenticator app.' });
        }

        await pool.query(
            'UPDATE users SET totp_enabled = 1, totp_verified_at = NOW() WHERE id = ?',
            [req.user.id]
        );
        res.json({ success: true, message: '2FA enabled successfully' });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// POST /api/2fa/validate — called at login for admin/manager after password check
router.post('/validate', async (req, res) => {
    try {
        const { user_id, token } = req.body;
        if (!user_id || !token) {
            return res.status(400).json({ success: false, error: 'user_id and token required' });
        }
        const [users] = await pool.query(
            "SELECT totp_secret, totp_enabled FROM users WHERE id = ? AND role IN ('admin','manager')",
            [user_id]
        );
        const user = users[0];
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });
        if (!user.totp_enabled) return res.json({ success: true, bypass: true });

        const valid = totpService.verifyToken(user.totp_secret, token);
        if (!valid) return res.status(401).json({ success: false, error: 'Invalid 2FA token' });
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// GET /api/2fa/status — check if 2FA is enabled for current user
router.get('/status', requireAuth, async (req, res) => {
    try {
        const [users] = await pool.query(
            'SELECT totp_enabled, totp_verified_at FROM users WHERE id = ?',
            [req.user.id]
        );
        const user = users[0];
        res.json({ success: true, totp_enabled: !!user?.totp_enabled, verified_at: user?.totp_verified_at || null });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// POST /api/2fa/disable — admin can disable 2FA for any user; users can disable their own
router.post('/disable', requireAuth, async (req, res) => {
    try {
        const targetId = req.body.user_id || req.user.id;
        if (String(targetId) !== String(req.user.id) && req.user.role !== 'admin') {
            return res.status(403).json({ success: false, error: 'Admin only for other users' });
        }
        await pool.query(
            'UPDATE users SET totp_enabled = 0, totp_secret = NULL WHERE id = ?',
            [targetId]
        );
        res.json({ success: true });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = router;
module.exports.setPool = setPool;
