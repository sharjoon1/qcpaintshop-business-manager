const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/permissionMiddleware');

let pool;
function setPool(dbPool) { pool = dbPool; }

// GET /api/notifications - List user's notifications
router.get('/', requireAuth, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        const [notifications] = await pool.query(
            `SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`,
            [req.user.id, limit, offset]
        );

        // Parse data JSON
        notifications.forEach(n => {
            if (n.data && typeof n.data === 'string') {
                try { n.data = JSON.parse(n.data); } catch {}
            }
        });

        const [[{ total }]] = await pool.query(
            'SELECT COUNT(*) as total FROM notifications WHERE user_id = ?',
            [req.user.id]
        );

        res.json({ success: true, data: notifications, total, page, limit });
    } catch (error) {
        console.error('Get notifications error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/notifications/count - Get unread count
router.get('/count', requireAuth, async (req, res) => {
    try {
        const [[{ count }]] = await pool.query(
            'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
            [req.user.id]
        );
        res.json({ success: true, count });
    } catch (error) {
        console.error('Get notification count error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/notifications/:id/read - Mark single notification as read
router.post('/:id/read', requireAuth, async (req, res) => {
    try {
        await pool.query(
            'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?',
            [req.params.id, req.user.id]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Mark notification read error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/notifications/read-all - Mark all as read
router.post('/read-all', requireAuth, async (req, res) => {
    try {
        await pool.query(
            'UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0',
            [req.user.id]
        );
        res.json({ success: true });
    } catch (error) {
        console.error('Mark all read error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/notifications/push/vapid-key - Get VAPID public key for web push
router.get('/push/vapid-key', (req, res) => {
    const key = process.env.VAPID_PUBLIC_KEY;
    if (!key) {
        return res.json({ success: false, message: 'Web push not configured' });
    }
    res.json({ success: true, key });
});

// POST /api/push/subscribe - Register push subscription
router.post('/push/subscribe', requireAuth, async (req, res) => {
    try {
        const { type, endpoint, p256dh, auth_key, fcm_token, device_info } = req.body;

        if (type === 'web') {
            if (!endpoint) return res.status(400).json({ success: false, message: 'endpoint required' });
            await pool.query(
                `INSERT INTO push_subscriptions (user_id, type, endpoint, p256dh, auth_key, device_info)
                 VALUES (?, 'web', ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE user_id = ?, p256dh = ?, auth_key = ?, device_info = ?, updated_at = NOW()`,
                [req.user.id, endpoint, p256dh, auth_key, device_info || null,
                 req.user.id, p256dh, auth_key, device_info || null]
            );
        } else if (type === 'fcm') {
            if (!fcm_token) return res.status(400).json({ success: false, message: 'fcm_token required' });
            await pool.query(
                `INSERT INTO push_subscriptions (user_id, type, fcm_token, device_info)
                 VALUES (?, 'fcm', ?, ?)
                 ON DUPLICATE KEY UPDATE user_id = ?, device_info = ?, updated_at = NOW()`,
                [req.user.id, fcm_token, device_info || null,
                 req.user.id, device_info || null]
            );
        } else {
            return res.status(400).json({ success: false, message: 'type must be web or fcm' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Push subscribe error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// DELETE /api/push/unsubscribe - Remove push subscription
router.delete('/push/unsubscribe', requireAuth, async (req, res) => {
    try {
        const { endpoint, fcm_token } = req.body;
        if (endpoint) {
            await pool.query('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?', [endpoint, req.user.id]);
        } else if (fcm_token) {
            await pool.query('DELETE FROM push_subscriptions WHERE fcm_token = ? AND user_id = ?', [fcm_token, req.user.id]);
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Push unsubscribe error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = { router, setPool };
