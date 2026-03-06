/**
 * STAFF ACTIVITY FEED & NOTICE BOARD ROUTES
 * Endpoints for the staff notice board / activity feed
 */
const express = require('express');
const router = express.Router();
const activityFeed = require('../services/activity-feed');
const { requireAuth, requireRole } = require('../middleware/permissionMiddleware');

let pool;
function setPool(p) {
    pool = p;
    activityFeed.setPool(p);
}
function setIO(socketIO) {
    activityFeed.setIO(socketIO);
}

const requireAdmin = requireRole(['admin', 'super_admin']);

/**
 * GET /api/activity-feed
 * Get activity feed for staff notice board (last 24h)
 */
router.get('/', requireAuth, async (req, res) => {
    try {
        const branchId = req.user.branch_id || null;
        const feed = await activityFeed.getFeed(branchId, 50);
        const notices = await activityFeed.getNotices(branchId);
        res.json({ success: true, feed, notices });
    } catch (e) {
        console.error('[ActivityFeed Route] GET / error:', e.message);
        res.status(500).json({ success: false, message: 'Failed to load feed' });
    }
});

/**
 * POST /api/activity-feed/notices
 * Admin creates a notice
 */
router.post('/notices', requireAdmin, async (req, res) => {
    try {
        const { title, message, priority, target, target_branch_id, expires_at } = req.body;
        if (!title || !message) {
            return res.status(400).json({ success: false, message: 'Title and message required' });
        }
        const id = await activityFeed.createNotice(
            req.user.id, title, message,
            priority || 'normal',
            target || 'all',
            target_branch_id || null,
            expires_at || null
        );
        res.json({ success: true, notice_id: id });
    } catch (e) {
        console.error('[ActivityFeed Route] POST /notices error:', e.message);
        res.status(500).json({ success: false, message: 'Failed to create notice' });
    }
});

/**
 * DELETE /api/activity-feed/notices/:id
 * Admin deactivates a notice
 */
router.delete('/notices/:id', requireAdmin, async (req, res) => {
    try {
        await pool.query('UPDATE admin_notices SET is_active = 0 WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Failed to delete notice' });
    }
});

module.exports = { router, setPool, setIO };
