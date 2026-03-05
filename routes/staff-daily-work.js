/**
 * STAFF DAILY WORK ROUTES
 * Unified daily work dashboard API for staff members
 * Aggregates: attendance, leads, outstanding, incentives, AI Tamil tasks
 *
 * Endpoints:
 *   GET  /api/staff/daily-work           - Full daily work dashboard data
 *   GET  /api/staff/daily-work/tasks     - Today's AI Tamil tasks
 *   POST /api/staff/daily-work/tasks/:index/toggle - Toggle task completion
 *   POST /api/staff/daily-work/tasks/generate      - Regenerate today's tasks
 *   GET  /api/staff/daily-work/outstanding         - Branch outstanding customers
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/permissionMiddleware');
const staffTaskGenerator = require('../services/staff-task-generator');

let pool;

function setPool(p) {
    pool = p;
    staffTaskGenerator.setPool(p);
}

// ========================================
// FULL DASHBOARD DATA
// ========================================

router.get('/', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const branchId = req.user.branch_id;

        // Run all queries in parallel
        const [
            attendanceResult,
            leadStatsResult,
            todayLeadsResult,
            outstandingResult,
            incentiveResult,
            aiTasksResult
        ] = await Promise.all([
            // 1. Attendance status today
            pool.query(`
                SELECT id, clock_in_time, clock_out_time, status, total_working_minutes
                FROM staff_attendance
                WHERE user_id = ? AND attendance_date = CURDATE()
                LIMIT 1
            `, [userId]),

            // 2. Lead stats
            pool.query(`
                SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as new_leads,
                    SUM(CASE WHEN status NOT IN ('won','lost','inactive') THEN 1 ELSE 0 END) as active,
                    SUM(CASE WHEN next_followup_date = CURDATE() THEN 1 ELSE 0 END) as followups_today,
                    SUM(CASE WHEN next_followup_date < CURDATE() AND status NOT IN ('won','lost','inactive') THEN 1 ELSE 0 END) as overdue,
                    SUM(CASE WHEN status = 'won' AND MONTH(converted_at) = MONTH(CURDATE()) THEN 1 ELSE 0 END) as converted_this_month,
                    SUM(CASE WHEN DATE(created_at) = CURDATE() THEN 1 ELSE 0 END) as added_today
                FROM leads WHERE assigned_to = ?
            `, [userId]),

            // 3. Today's followup + overdue leads
            pool.query(`
                (SELECT l.id, l.lead_number, l.name, l.phone, l.status, l.priority,
                        l.next_followup_date, l.total_followups, l.estimated_budget,
                        'today' as followup_type
                 FROM leads l
                 WHERE l.assigned_to = ? AND l.next_followup_date = CURDATE()
                   AND l.status NOT IN ('won','lost','inactive')
                 ORDER BY l.priority DESC)
                UNION ALL
                (SELECT l.id, l.lead_number, l.name, l.phone, l.status, l.priority,
                        l.next_followup_date, l.total_followups, l.estimated_budget,
                        'overdue' as followup_type
                 FROM leads l
                 WHERE l.assigned_to = ? AND l.next_followup_date < CURDATE()
                   AND l.status NOT IN ('won','lost','inactive')
                 ORDER BY l.next_followup_date ASC)
                LIMIT 20
            `, [userId, userId]),

            // 4. Branch outstanding customers (top 15)
            branchId ? pool.query(`
                SELECT zcm.zoho_contact_id, zcm.zoho_contact_name as customer_name,
                       zcm.zoho_outstanding as outstanding,
                       zcm.phone, zcm.email,
                       COUNT(zi.id) as invoice_count,
                       MIN(zi.due_date) as oldest_due,
                       DATEDIFF(CURDATE(), MIN(zi.due_date)) as days_overdue
                FROM zoho_customers_map zcm
                LEFT JOIN zoho_invoices zi ON zi.zoho_customer_id = zcm.zoho_contact_id AND zi.balance > 0
                WHERE zcm.branch_id = ? AND zcm.zoho_outstanding > 0
                GROUP BY zcm.zoho_contact_id
                ORDER BY zcm.zoho_outstanding DESC LIMIT 15
            `, [branchId]) : Promise.resolve([[]]),

            // 5. Incentive stats this month
            pool.query(`
                SELECT
                    COUNT(*) as total,
                    COALESCE(SUM(CASE WHEN status = 'approved' THEN amount ELSE 0 END), 0) as approved_amount,
                    COALESCE(SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END), 0) as pending_amount,
                    COALESCE(SUM(amount), 0) as total_amount
                FROM staff_incentives
                WHERE user_id = ? AND incentive_month = DATE_FORMAT(CURDATE(), '%Y-%m')
            `, [userId]),

            // 6. AI Tamil tasks
            staffTaskGenerator.getTodayTasks(userId)
        ]);

        const attendance = attendanceResult[0][0] || null;
        const leadStats = leadStatsResult[0][0];
        const todayLeads = todayLeadsResult[0];
        const outstanding = outstandingResult[0];
        const incentives = incentiveResult[0][0];

        res.json({
            success: true,
            data: {
                attendance: attendance ? {
                    clocked_in: !!attendance.clock_in_time,
                    clocked_out: !!attendance.clock_out_time,
                    clock_in_time: attendance.clock_in_time,
                    status: attendance.status,
                    working_minutes: attendance.total_working_minutes || 0
                } : { clocked_in: false, clocked_out: false },
                leads: {
                    stats: leadStats,
                    today_followups: todayLeads.filter(l => l.followup_type === 'today'),
                    overdue: todayLeads.filter(l => l.followup_type === 'overdue')
                },
                outstanding: outstanding,
                incentives: {
                    conversions: incentives.total || 0,
                    approved: parseFloat(incentives.approved_amount) || 0,
                    pending: parseFloat(incentives.pending_amount) || 0,
                    total: parseFloat(incentives.total_amount) || 0
                },
                ai_tasks: aiTasksResult ? {
                    tasks: JSON.parse(aiTasksResult.tasks_json || '[]'),
                    summary: aiTasksResult.summary,
                    completed: aiTasksResult.completed_count,
                    total: aiTasksResult.total_count,
                    generated_at: aiTasksResult.generated_at
                } : null
            }
        });

    } catch (error) {
        console.error('Staff daily work dashboard error:', error);
        res.status(500).json({ success: false, message: 'Failed to load daily work data' });
    }
});

// ========================================
// AI TAMIL TASKS
// ========================================

router.get('/tasks', requireAuth, async (req, res) => {
    try {
        const result = await staffTaskGenerator.getTodayTasks(req.user.id);
        if (!result) {
            return res.json({ success: true, data: null });
        }
        res.json({
            success: true,
            data: {
                tasks: JSON.parse(result.tasks_json || '[]'),
                summary: result.summary,
                completed: result.completed_count,
                total: result.total_count,
                generated_at: result.generated_at
            }
        });
    } catch (error) {
        console.error('Get AI tasks error:', error);
        res.status(500).json({ success: false, message: 'Failed to load tasks' });
    }
});

router.post('/tasks/:index/toggle', requireAuth, async (req, res) => {
    try {
        const taskIndex = parseInt(req.params.index, 10);
        const result = await staffTaskGenerator.markTaskComplete(req.user.id, taskIndex);
        if (!result) {
            return res.status(404).json({ success: false, message: 'Task not found' });
        }
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Toggle task error:', error);
        res.status(500).json({ success: false, message: 'Failed to update task' });
    }
});

router.post('/tasks/generate', requireAuth, async (req, res) => {
    try {
        const result = await staffTaskGenerator.generateForStaff(req.user.id);
        if (!result) {
            return res.status(404).json({ success: false, message: 'Staff not found' });
        }
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Generate tasks error:', error);
        res.status(500).json({ success: false, message: 'Failed to generate tasks' });
    }
});

// ========================================
// OUTSTANDING CUSTOMERS (Branch)
// ========================================

router.get('/outstanding', requireAuth, async (req, res) => {
    try {
        const branchId = req.user.branch_id;
        if (!branchId) {
            return res.json({ success: true, data: [] });
        }

        const search = req.query.search || '';
        const sort = req.query.sort || 'outstanding';

        let orderBy = 'zcm.zoho_outstanding DESC';
        if (sort === 'oldest') orderBy = 'oldest_due ASC';
        if (sort === 'name') orderBy = 'zcm.zoho_contact_name ASC';

        const searchClause = search ? 'AND zcm.zoho_contact_name LIKE ?' : '';
        const params = search ? [branchId, `%${search}%`] : [branchId];

        const [rows] = await pool.query(`
            SELECT zcm.zoho_contact_id, zcm.zoho_contact_name as customer_name,
                   zcm.zoho_outstanding as outstanding,
                   zcm.phone, zcm.email,
                   COUNT(zi.id) as invoice_count,
                   MIN(zi.due_date) as oldest_due,
                   DATEDIFF(CURDATE(), MIN(zi.due_date)) as days_overdue
            FROM zoho_customers_map zcm
            LEFT JOIN zoho_invoices zi ON zi.zoho_customer_id = zcm.zoho_contact_id AND zi.balance > 0
            WHERE zcm.branch_id = ? AND zcm.zoho_outstanding > 0
            ${searchClause}
            GROUP BY zcm.zoho_contact_id
            ORDER BY ${orderBy}
            LIMIT 50
        `, params);

        const [totals] = await pool.query(`
            SELECT COALESCE(SUM(zoho_outstanding), 0) as total_outstanding,
                   COUNT(*) as customer_count
            FROM zoho_customers_map
            WHERE branch_id = ? AND zoho_outstanding > 0
        `, [branchId]);

        res.json({
            success: true,
            data: {
                customers: rows,
                total_outstanding: parseFloat(totals[0].total_outstanding) || 0,
                customer_count: totals[0].customer_count || 0
            }
        });

    } catch (error) {
        console.error('Staff outstanding error:', error);
        res.status(500).json({ success: false, message: 'Failed to load outstanding data' });
    }
});

module.exports = { router, setPool };
