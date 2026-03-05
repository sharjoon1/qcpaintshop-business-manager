/**
 * STAFF ACTIVITY FEED SERVICE
 * Logs staff activities and serves the notice board feed
 */

let pool;
let io;

function setPool(dbPool) { pool = dbPool; }
function setIO(socketIO) { io = socketIO; }

// Activity type configs: icon + color
const ACTIVITY_ICONS = {
    clock_in:       { icon: 'IN',  color: '#10b981' },
    clock_out:      { icon: 'OUT', color: '#ef4444' },
    break_start:    { icon: 'BRK', color: '#f59e0b' },
    break_end:      { icon: 'BRK', color: '#f59e0b' },
    outside_start:  { icon: 'OUT', color: '#0891b2' },
    outside_end:    { icon: 'BCK', color: '#0891b2' },
    prayer_start:   { icon: 'PRA', color: '#059669' },
    prayer_end:     { icon: 'PRA', color: '#059669' },
    lead_created:   { icon: 'NEW', color: '#8b5cf6' },
    lead_followup:  { icon: 'FUP', color: '#6366f1' },
    task_completed: { icon: 'TSK', color: '#667eea' },
    admin_notice:   { icon: 'ADM', color: '#dc2626' },
    overtime:       { icon: 'OT',  color: '#7c3aed' },
    stock_check:    { icon: 'STK', color: '#059669' }
};

/**
 * Log an activity to the feed
 */
async function logActivity(userId, branchId, type, title, description = null, visibleTo = 'all') {
    if (!pool) return;
    try {
        const config = ACTIVITY_ICONS[type] || { icon: null, color: '#667eea' };
        await pool.query(
            `INSERT INTO staff_activity_feed (user_id, branch_id, activity_type, title, description, icon, color, visible_to)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [userId, branchId, type, title, description, config.icon, config.color, visibleTo]
        );

        // Broadcast via Socket.io for real-time updates
        if (io) {
            const [users] = await pool.query('SELECT full_name FROM users WHERE id = ?', [userId]);
            const staffName = users[0]?.full_name || 'Staff';

            const feedItem = {
                user_id: userId,
                branch_id: branchId,
                activity_type: type,
                title,
                description,
                icon: config.icon,
                color: config.color,
                visible_to: visibleTo,
                full_name: staffName,
                created_at: new Date().toISOString()
            };

            // Emit to all staff in the same branch + admins
            io.emit('activity_feed_new', feedItem);
        }
    } catch (e) {
        console.error('[ActivityFeed] logActivity error:', e.message);
    }
}

/**
 * Get activity feed for display
 */
async function getFeed(branchId = null, limit = 30) {
    if (!pool) return [];
    try {
        let query = `
            SELECT f.*, u.full_name
            FROM staff_activity_feed f
            JOIN users u ON f.user_id = u.id
            WHERE f.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
        `;
        const params = [];

        if (branchId !== null) {
            query += ` AND (f.visible_to = 'all' OR (f.visible_to = 'branch' AND f.branch_id = ?))`;
            params.push(branchId);
        }

        query += ` ORDER BY f.created_at DESC LIMIT ?`;
        params.push(limit);

        const [rows] = await pool.query(query, params);
        return rows;
    } catch (e) {
        console.error('[ActivityFeed] getFeed error:', e.message);
        return [];
    }
}

/**
 * Get active admin notices
 */
async function getNotices(branchId = null) {
    if (!pool) return [];
    try {
        let query = `
            SELECT n.*, u.full_name as posted_by_name
            FROM admin_notices n
            JOIN users u ON n.posted_by = u.id
            WHERE n.is_active = 1
              AND (n.expires_at IS NULL OR n.expires_at > NOW())
        `;
        const params = [];

        if (branchId !== null) {
            query += ` AND (n.target = 'all' OR (n.target = 'branch' AND n.target_branch_id = ?))`;
            params.push(branchId);
        }

        query += ` ORDER BY FIELD(n.priority, 'urgent', 'important', 'normal'), n.created_at DESC LIMIT 10`;

        const [rows] = await pool.query(query, params);
        return rows;
    } catch (e) {
        console.error('[ActivityFeed] getNotices error:', e.message);
        return [];
    }
}

/**
 * Create an admin notice
 */
async function createNotice(postedBy, title, message, priority = 'normal', target = 'all', targetBranchId = null, expiresAt = null) {
    if (!pool) return null;
    try {
        const [result] = await pool.query(
            `INSERT INTO admin_notices (posted_by, title, message, priority, target, target_branch_id, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [postedBy, title, message, priority, target, targetBranchId, expiresAt]
        );

        // Also log as activity
        await logActivity(postedBy, targetBranchId, 'admin_notice', title, message, target === 'all' ? 'all' : 'branch');

        if (io) {
            io.emit('admin_notice_new', { id: result.insertId, title, message, priority });
        }

        return result.insertId;
    } catch (e) {
        console.error('[ActivityFeed] createNotice error:', e.message);
        return null;
    }
}

module.exports = {
    setPool,
    setIO,
    logActivity,
    getFeed,
    getNotices,
    createNotice
};
