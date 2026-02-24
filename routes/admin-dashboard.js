/**
 * Admin Live Dashboard Routes
 * GET /api/admin/dashboard/live — real-time monitoring data
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/permissionMiddleware');

let pool = null;
let getOnlineUsers = null;
let automationRegistry = null;

// 5-second in-memory cache
let cachedData = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5000;

function setDependencies({ pool: p, onlineUsers, automationRegistry: ar }) {
    pool = p;
    getOnlineUsers = onlineUsers;
    automationRegistry = ar;
}

/**
 * GET /live — Main live monitoring endpoint
 * Admin/manager only — returns online users, metrics, automations, activity feed
 */
router.get('/live', requireAuth, async (req, res) => {
    try {
        if (!req.user || !['admin', 'manager'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Admin or manager access required' });
        }

        const now = Date.now();
        if (cachedData && (now - cacheTimestamp) < CACHE_TTL) {
            return res.json({ success: true, data: cachedData, cached: true });
        }

        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

        // Run all queries in parallel
        const [
            [staffPresentRows],
            [pendingTaskRows],
            [overdueTaskRows],
            [estimateRows],
            [pendingStockRows],
            [newLeadsRows],
            activityFeed,
            onlineUsersList
        ] = await Promise.all([
            // 1. Staff present today
            pool.query(
                `SELECT COUNT(DISTINCT user_id) as count FROM staff_attendance WHERE date = ?`,
                [todayStr]
            ),
            // 2. Pending tasks
            pool.query(
                `SELECT COUNT(*) as count FROM staff_tasks WHERE status = 'pending'`
            ),
            // 3. Overdue tasks
            pool.query(
                `SELECT COUNT(*) as count FROM staff_tasks WHERE status NOT IN ('completed','cancelled') AND due_date < ?`,
                [todayStr]
            ),
            // 4. Today's estimates (painter estimates)
            pool.query(
                `SELECT COUNT(*) as count, COALESCE(SUM(grand_total), 0) as total_value FROM painter_estimates WHERE DATE(created_at) = ?`,
                [todayStr]
            ),
            // 5. Pending stock checks
            pool.query(
                `SELECT COUNT(*) as count FROM stock_check_assignments WHERE status = 'pending'`
            ),
            // 6. New leads today
            pool.query(
                `SELECT COUNT(*) as count FROM leads WHERE DATE(created_at) = ?`,
                [todayStr]
            ),
            // 7. Activity feed
            getActivityFeed(todayStr),
            // 8. Online users with details
            getOnlineUsersDetails()
        ]);

        // Get automation data
        const automationData = automationRegistry ? {
            summary: automationRegistry.getSummary(),
            jobs: automationRegistry.getAll()
        } : { summary: { total: 0, running: 0, healthy: 0, failed: 0, idle: 0 }, jobs: [] };

        const data = {
            onlineUsers: onlineUsersList,
            metrics: {
                staffPresent: staffPresentRows[0].count,
                staffOnline: onlineUsersList.length,
                pendingTasks: pendingTaskRows[0].count,
                overdueTasks: overdueTaskRows[0].count,
                todayEstimates: estimateRows[0].count,
                todayEstimateValue: Number(estimateRows[0].total_value) || 0,
                pendingStockChecks: pendingStockRows[0].count,
                newLeadsToday: newLeadsRows[0].count
            },
            automations: automationData,
            activityFeed
        };

        cachedData = data;
        cacheTimestamp = now;

        res.json({ success: true, data });
    } catch (err) {
        console.error('[LiveDashboard] Error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to load live dashboard data' });
    }
});

/**
 * Fetch activity feed — last 50 events from today using UNION
 */
async function getActivityFeed(todayStr) {
    try {
        const [rows] = await pool.query(`
            SELECT * FROM (
                (SELECT 'clock_in' as type, u.full_name as user_name,
                    CONCAT(u.full_name, ' clocked in', IFNULL(CONCAT(' at ', b.name), '')) as message,
                    sa.clock_in_time as event_time
                FROM staff_attendance sa
                JOIN users u ON sa.user_id = u.id
                LEFT JOIN branches b ON sa.branch_id = b.id
                WHERE sa.date = ? AND sa.clock_in_time IS NOT NULL
                ORDER BY sa.clock_in_time DESC LIMIT 15)

                UNION ALL

                (SELECT 'clock_out' as type, u.full_name as user_name,
                    CONCAT(u.full_name, ' clocked out') as message,
                    sa.clock_out_time as event_time
                FROM staff_attendance sa
                JOIN users u ON sa.user_id = u.id
                WHERE sa.date = ? AND sa.clock_out_time IS NOT NULL
                ORDER BY sa.clock_out_time DESC LIMIT 10)

                UNION ALL

                (SELECT 'stock_submit' as type, u.full_name as user_name,
                    CONCAT(u.full_name, ' submitted stock check') as message,
                    sca.submitted_at as event_time
                FROM stock_check_assignments sca
                JOIN users u ON sca.staff_id = u.id
                WHERE sca.status IN ('submitted','reviewed','adjusted') AND DATE(sca.submitted_at) = ?
                ORDER BY sca.submitted_at DESC LIMIT 10)

                UNION ALL

                (SELECT 'task_complete' as type, u.full_name as user_name,
                    CONCAT(u.full_name, ' completed task: ', LEFT(st.title, 40)) as message,
                    st.updated_at as event_time
                FROM staff_tasks st
                JOIN users u ON st.assigned_to = u.id
                WHERE st.status = 'completed' AND DATE(st.updated_at) = ?
                ORDER BY st.updated_at DESC LIMIT 10)

                UNION ALL

                (SELECT 'estimate' as type, p.name as user_name,
                    CONCAT('New estimate #', pe.estimate_number, ' - ', FORMAT(pe.grand_total, 0)) as message,
                    pe.created_at as event_time
                FROM painter_estimates pe
                JOIN painters p ON pe.painter_id = p.id
                WHERE DATE(pe.created_at) = ?
                ORDER BY pe.created_at DESC LIMIT 5)

                UNION ALL

                (SELECT 'new_lead' as type, COALESCE(l.name, 'Unknown') as user_name,
                    CONCAT('New lead: ', COALESCE(l.name, 'Unknown'), IFNULL(CONCAT(' - ', l.company), '')) as message,
                    l.created_at as event_time
                FROM leads l
                WHERE DATE(l.created_at) = ?
                ORDER BY l.created_at DESC LIMIT 5)
            ) feed
            ORDER BY event_time DESC LIMIT 50
        `, [todayStr, todayStr, todayStr, todayStr, todayStr, todayStr]);

        return rows.map(r => ({
            type: r.type,
            user: r.user_name,
            message: r.message,
            time: r.event_time
        }));
    } catch (err) {
        console.error('[LiveDashboard] Activity feed error:', err.message);
        return [];
    }
}

/**
 * Get online users with their details from DB
 */
async function getOnlineUsersDetails() {
    try {
        const onlineMap = getOnlineUsers ? getOnlineUsers() : new Map();
        const userIds = Array.from(onlineMap.keys());
        if (userIds.length === 0) return [];

        const [users] = await pool.query(
            `SELECT u.id, u.full_name, u.role, b.name as branch_name
             FROM users u
             LEFT JOIN user_branches ub ON u.id = ub.user_id AND ub.is_primary = 1
             LEFT JOIN branches b ON ub.branch_id = b.id
             WHERE u.id IN (?)`,
            [userIds]
        );

        return users.map(u => ({
            id: u.id,
            full_name: u.full_name,
            role: u.role,
            branch_name: u.branch_name || 'No branch'
        }));
    } catch (err) {
        console.error('[LiveDashboard] Online users error:', err.message);
        return [];
    }
}

module.exports = router;
module.exports.setDependencies = setDependencies;
module.exports.router = router;
