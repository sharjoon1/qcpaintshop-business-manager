/**
 * STAFF ACTIVITIES MODULE ROUTES
 * Handles daily activity tracking, reporting, and management for staff
 */

const express = require('express');
const router = express.Router();
const { requirePermission, requireAuth } = require('../middleware/permissionMiddleware');

// Database connection (imported from main app)
let pool;

function setPool(dbPool) {
    pool = dbPool;
}

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Validate activity_type enum value
 */
function isValidActivityType(type) {
    const validTypes = [
        'customer_visit', 'store_work', 'delivery', 'meeting',
        'follow_up', 'admin_work', 'training', 'other'
    ];
    return validTypes.includes(type);
}

/**
 * Validate status enum value
 */
function isValidStatus(status) {
    const validStatuses = ['planned', 'in_progress', 'completed', 'cancelled'];
    return validStatuses.includes(status);
}

/**
 * Calculate duration in minutes between two time strings (HH:MM:SS or HH:MM)
 */
function calculateDurationMinutes(startTime, endTime) {
    if (!startTime || !endTime) return null;
    const start = new Date(`1970-01-01T${startTime}`);
    const end = new Date(`1970-01-01T${endTime}`);
    const diffMs = end - start;
    if (diffMs <= 0) return null;
    return Math.floor(diffMs / 1000 / 60);
}

// ========================================
// STAFF ENDPOINTS (requireAuth)
// ========================================

/**
 * GET /api/activities/my-activities
 * Current user's activities for today (or specified date)
 */
router.get('/my-activities', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const date = req.query.date || new Date().toISOString().split('T')[0];

        const [rows] = await pool.query(
            `SELECT sa.*,
                    u.full_name as user_name,
                    b.name as branch_name
             FROM staff_activities sa
             JOIN users u ON sa.user_id = u.id
             LEFT JOIN branches b ON sa.branch_id = b.id
             WHERE sa.user_id = ? AND sa.activity_date = ?
             ORDER BY sa.activity_time ASC, sa.start_time ASC, sa.created_at ASC`,
            [userId, date]
        );

        res.json({
            success: true,
            date: date,
            count: rows.length,
            data: rows
        });

    } catch (error) {
        console.error('Get my activities error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get activities'
        });
    }
});

/**
 * GET /api/activities/stats
 * Activity stats (total today, by type, by user)
 */
router.get('/stats', requireAuth, async (req, res) => {
    try {
        const today = req.query.date || new Date().toISOString().split('T')[0];
        const branchId = req.query.branch_id;
        const isAdmin = req.user.role === 'admin';

        // Total activities today
        let totalQuery = `
            SELECT COUNT(*) as total_today
            FROM staff_activities
            WHERE activity_date = ?
        `;
        const totalParams = [today];

        if (!isAdmin) {
            totalQuery += ' AND user_id = ?';
            totalParams.push(req.user.id);
        } else if (branchId) {
            totalQuery += ' AND branch_id = ?';
            totalParams.push(branchId);
        }

        const [totalRows] = await pool.query(totalQuery, totalParams);

        // Count by type
        let typeQuery = `
            SELECT activity_type, COUNT(*) as count
            FROM staff_activities
            WHERE activity_date = ?
        `;
        const typeParams = [today];

        if (!isAdmin) {
            typeQuery += ' AND user_id = ?';
            typeParams.push(req.user.id);
        } else if (branchId) {
            typeQuery += ' AND branch_id = ?';
            typeParams.push(branchId);
        }

        typeQuery += ' GROUP BY activity_type ORDER BY count DESC';

        const [typeRows] = await pool.query(typeQuery, typeParams);

        // Count by status
        let statusQuery = `
            SELECT status, COUNT(*) as count
            FROM staff_activities
            WHERE activity_date = ?
        `;
        const statusParams = [today];

        if (!isAdmin) {
            statusQuery += ' AND user_id = ?';
            statusParams.push(req.user.id);
        } else if (branchId) {
            statusQuery += ' AND branch_id = ?';
            statusParams.push(branchId);
        }

        statusQuery += ' GROUP BY status ORDER BY count DESC';

        const [statusRows] = await pool.query(statusQuery, statusParams);

        // Count by user (admin only)
        let byUser = [];
        if (isAdmin) {
            let userQuery = `
                SELECT sa.user_id, u.full_name as user_name, COUNT(*) as count,
                       SUM(CASE WHEN sa.status = 'completed' THEN 1 ELSE 0 END) as completed_count
                FROM staff_activities sa
                JOIN users u ON sa.user_id = u.id
                WHERE sa.activity_date = ?
            `;
            const userParams = [today];

            if (branchId) {
                userQuery += ' AND sa.branch_id = ?';
                userParams.push(branchId);
            }

            userQuery += ' GROUP BY sa.user_id, u.full_name ORDER BY count DESC';

            const [userRows] = await pool.query(userQuery, userParams);
            byUser = userRows;
        }

        res.json({
            success: true,
            date: today,
            data: {
                total_today: totalRows[0].total_today,
                by_type: typeRows,
                by_status: statusRows,
                by_user: byUser
            }
        });

    } catch (error) {
        console.error('Get activity stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get activity stats'
        });
    }
});

/**
 * GET /api/activities/report/daily
 * Daily activity report (admin: all staff, date filter)
 */
router.get('/report/daily', requirePermission('activities', 'manage'), async (req, res) => {
    try {
        const date = req.query.date || new Date().toISOString().split('T')[0];
        const branchId = req.query.branch_id;

        let query = `
            SELECT sa.*,
                   u.full_name as user_name,
                   u.username,
                   b.name as branch_name
            FROM staff_activities sa
            JOIN users u ON sa.user_id = u.id
            LEFT JOIN branches b ON sa.branch_id = b.id
            WHERE sa.activity_date = ?
        `;
        const params = [date];

        if (branchId) {
            query += ' AND sa.branch_id = ?';
            params.push(branchId);
        }

        query += ' ORDER BY u.full_name, sa.activity_time ASC, sa.start_time ASC';

        const [rows] = await pool.query(query, params);

        // Build per-user summary
        const userSummary = {};
        rows.forEach(row => {
            if (!userSummary[row.user_id]) {
                userSummary[row.user_id] = {
                    user_id: row.user_id,
                    user_name: row.user_name,
                    username: row.username,
                    branch_name: row.branch_name,
                    total_activities: 0,
                    completed: 0,
                    in_progress: 0,
                    planned: 0,
                    cancelled: 0,
                    total_duration_minutes: 0
                };
            }
            const summary = userSummary[row.user_id];
            summary.total_activities++;
            if (row.status === 'completed') summary.completed++;
            else if (row.status === 'in_progress') summary.in_progress++;
            else if (row.status === 'planned') summary.planned++;
            else if (row.status === 'cancelled') summary.cancelled++;
            if (row.duration_minutes) {
                summary.total_duration_minutes += row.duration_minutes;
            }
        });

        res.json({
            success: true,
            date: date,
            total_activities: rows.length,
            user_summary: Object.values(userSummary),
            activities: rows
        });

    } catch (error) {
        console.error('Daily report error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate daily report'
        });
    }
});

/**
 * GET /api/activities/report/user/:userId
 * Specific user's activity report (date range)
 */
router.get('/report/user/:userId', requirePermission('activities', 'manage'), async (req, res) => {
    try {
        const { userId } = req.params;
        const { start_date, end_date } = req.query;

        if (!start_date || !end_date) {
            return res.status(400).json({
                success: false,
                message: 'start_date and end_date query parameters are required'
            });
        }

        // Get user info
        const [users] = await pool.query(
            'SELECT id, full_name, username, email, branch_id FROM users WHERE id = ?',
            [userId]
        );

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const user = users[0];

        // Get activities in date range
        const [rows] = await pool.query(
            `SELECT sa.*,
                    b.name as branch_name
             FROM staff_activities sa
             LEFT JOIN branches b ON sa.branch_id = b.id
             WHERE sa.user_id = ? AND sa.activity_date BETWEEN ? AND ?
             ORDER BY sa.activity_date ASC, sa.activity_time ASC, sa.start_time ASC`,
            [userId, start_date, end_date]
        );

        // Summary statistics
        const summary = {
            total_activities: rows.length,
            completed: rows.filter(r => r.status === 'completed').length,
            in_progress: rows.filter(r => r.status === 'in_progress').length,
            planned: rows.filter(r => r.status === 'planned').length,
            cancelled: rows.filter(r => r.status === 'cancelled').length,
            total_duration_minutes: rows.reduce((sum, r) => sum + (r.duration_minutes || 0), 0),
            by_type: {}
        };

        rows.forEach(r => {
            if (!summary.by_type[r.activity_type]) {
                summary.by_type[r.activity_type] = 0;
            }
            summary.by_type[r.activity_type]++;
        });

        summary.total_duration_hours = (summary.total_duration_minutes / 60).toFixed(2);

        // Group activities by date
        const byDate = {};
        rows.forEach(r => {
            const dateKey = r.activity_date instanceof Date
                ? r.activity_date.toISOString().split('T')[0]
                : String(r.activity_date).split('T')[0];
            if (!byDate[dateKey]) {
                byDate[dateKey] = [];
            }
            byDate[dateKey].push(r);
        });

        res.json({
            success: true,
            user: user,
            date_range: { start_date, end_date },
            summary: summary,
            activities_by_date: byDate,
            activities: rows
        });

    } catch (error) {
        console.error('User report error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to generate user activity report'
        });
    }
});

/**
 * GET /api/activities/:id
 * Single activity detail
 */
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const activityId = req.params.id;
        const userId = req.user.id;
        const isAdmin = req.user.role === 'admin';

        const [rows] = await pool.query(
            `SELECT sa.*,
                    u.full_name as user_name,
                    u.username,
                    b.name as branch_name
             FROM staff_activities sa
             JOIN users u ON sa.user_id = u.id
             LEFT JOIN branches b ON sa.branch_id = b.id
             WHERE sa.id = ?`,
            [activityId]
        );

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Activity not found'
            });
        }

        const activity = rows[0];

        // Staff can only view own activities
        if (!isAdmin && activity.user_id !== userId) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. You can only view your own activities.',
                code: 'PERMISSION_DENIED'
            });
        }

        res.json({
            success: true,
            data: activity
        });

    } catch (error) {
        console.error('Get activity detail error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get activity detail'
        });
    }
});

/**
 * GET /api/activities
 * List activities with filters + pagination
 * Admin sees all, staff sees own
 */
router.get('/', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const isAdmin = req.user.role === 'admin';
        const {
            user_id,
            date,
            start_date,
            end_date,
            activity_type,
            branch_id,
            status,
            page = 1,
            limit = 50
        } = req.query;

        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
        const offset = (pageNum - 1) * limitNum;

        let query = `
            SELECT sa.*,
                   u.full_name as user_name,
                   u.username,
                   b.name as branch_name
            FROM staff_activities sa
            JOIN users u ON sa.user_id = u.id
            LEFT JOIN branches b ON sa.branch_id = b.id
            WHERE 1=1
        `;

        let countQuery = `
            SELECT COUNT(*) as total
            FROM staff_activities sa
            WHERE 1=1
        `;

        const params = [];
        const countParams = [];

        // Staff sees only own activities
        if (!isAdmin) {
            query += ' AND sa.user_id = ?';
            countQuery += ' AND sa.user_id = ?';
            params.push(userId);
            countParams.push(userId);
        } else if (user_id) {
            query += ' AND sa.user_id = ?';
            countQuery += ' AND sa.user_id = ?';
            params.push(user_id);
            countParams.push(user_id);
        }

        // Single date filter
        if (date) {
            query += ' AND sa.activity_date = ?';
            countQuery += ' AND sa.activity_date = ?';
            params.push(date);
            countParams.push(date);
        }

        // Date range filter
        if (start_date && end_date) {
            query += ' AND sa.activity_date BETWEEN ? AND ?';
            countQuery += ' AND sa.activity_date BETWEEN ? AND ?';
            params.push(start_date, end_date);
            countParams.push(start_date, end_date);
        }

        // Activity type filter
        if (activity_type) {
            query += ' AND sa.activity_type = ?';
            countQuery += ' AND sa.activity_type = ?';
            params.push(activity_type);
            countParams.push(activity_type);
        }

        // Branch filter
        if (branch_id) {
            query += ' AND sa.branch_id = ?';
            countQuery += ' AND sa.branch_id = ?';
            params.push(branch_id);
            countParams.push(branch_id);
        }

        // Status filter
        if (status) {
            query += ' AND sa.status = ?';
            countQuery += ' AND sa.status = ?';
            params.push(status);
            countParams.push(status);
        }

        query += ' ORDER BY sa.activity_date DESC, sa.activity_time DESC, sa.created_at DESC';
        query += ' LIMIT ? OFFSET ?';
        params.push(limitNum, offset);

        const [rows] = await pool.query(query, params);
        const [countRows] = await pool.query(countQuery, countParams);

        const total = countRows[0].total;
        const totalPages = Math.ceil(total / limitNum);

        res.json({
            success: true,
            data: rows,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: total,
                total_pages: totalPages,
                has_next: pageNum < totalPages,
                has_prev: pageNum > 1
            }
        });

    } catch (error) {
        console.error('List activities error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to list activities'
        });
    }
});

// ========================================
// CREATE / UPDATE / DELETE ENDPOINTS
// ========================================

/**
 * POST /api/activities
 * Create activity (staff logs their activity with geo location)
 */
router.post('/', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            branch_id,
            activity_date,
            activity_time,
            activity_type,
            title,
            description,
            customer_name,
            customer_phone,
            location,
            latitude,
            longitude,
            start_time,
            end_time,
            outcome,
            status = 'planned',
            photo_url,
            document_url
        } = req.body;

        // Validation
        if (!activity_type || !title) {
            return res.status(400).json({
                success: false,
                message: 'activity_type and title are required'
            });
        }

        if (!isValidActivityType(activity_type)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid activity_type. Allowed values: customer_visit, store_work, delivery, meeting, follow_up, admin_work, training, other'
            });
        }

        if (status && !isValidStatus(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status. Allowed values: planned, in_progress, completed, cancelled'
            });
        }

        const activityDate = activity_date || new Date().toISOString().split('T')[0];
        const activityTime = activity_time || new Date().toTimeString().split(' ')[0];
        const branchId = branch_id || req.user.branch_id;

        // Calculate duration if start_time and end_time provided
        let durationMinutes = null;
        if (start_time && end_time) {
            durationMinutes = calculateDurationMinutes(start_time, end_time);
        }

        const [result] = await pool.query(
            `INSERT INTO staff_activities
             (user_id, branch_id, activity_date, activity_time, activity_type,
              title, description, customer_name, customer_phone, location,
              latitude, longitude, start_time, end_time, duration_minutes,
              outcome, status, photo_url, document_url)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                userId, branchId, activityDate, activityTime, activity_type,
                title, description || null, customer_name || null, customer_phone || null, location || null,
                latitude || null, longitude || null, start_time || null, end_time || null, durationMinutes,
                outcome || null, status, photo_url || null, document_url || null
            ]
        );

        // Fetch the created record
        const [created] = await pool.query(
            'SELECT * FROM staff_activities WHERE id = ?',
            [result.insertId]
        );

        res.status(201).json({
            success: true,
            message: 'Activity created successfully',
            data: created[0]
        });

    } catch (error) {
        console.error('Create activity error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create activity'
        });
    }
});

/**
 * PUT /api/activities/:id
 * Update activity (only own, or admin)
 */
router.put('/:id', requireAuth, async (req, res) => {
    try {
        const activityId = req.params.id;
        const userId = req.user.id;
        const isAdmin = req.user.role === 'admin';

        // Check if activity exists
        const [existing] = await pool.query(
            'SELECT * FROM staff_activities WHERE id = ?',
            [activityId]
        );

        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Activity not found'
            });
        }

        const activity = existing[0];

        // Staff can only update their own activities
        if (!isAdmin && activity.user_id !== userId) {
            return res.status(403).json({
                success: false,
                message: 'Access denied. You can only update your own activities.',
                code: 'PERMISSION_DENIED'
            });
        }

        const allowedFields = [
            'branch_id', 'activity_date', 'activity_time', 'activity_type',
            'title', 'description', 'customer_name', 'customer_phone',
            'location', 'latitude', 'longitude', 'start_time', 'end_time',
            'outcome', 'status', 'photo_url', 'document_url'
        ];

        const updates = req.body;
        const setClause = [];
        const values = [];

        // Validate activity_type if provided
        if (updates.activity_type && !isValidActivityType(updates.activity_type)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid activity_type. Allowed values: customer_visit, store_work, delivery, meeting, follow_up, admin_work, training, other'
            });
        }

        // Validate status if provided
        if (updates.status && !isValidStatus(updates.status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid status. Allowed values: planned, in_progress, completed, cancelled'
            });
        }

        Object.keys(updates).forEach(key => {
            if (allowedFields.includes(key)) {
                setClause.push(`${key} = ?`);
                values.push(updates[key]);
            }
        });

        if (setClause.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No valid fields to update'
            });
        }

        // Recalculate duration if start_time or end_time changed
        const newStartTime = updates.start_time !== undefined ? updates.start_time : activity.start_time;
        const newEndTime = updates.end_time !== undefined ? updates.end_time : activity.end_time;

        if (newStartTime && newEndTime) {
            const durationMinutes = calculateDurationMinutes(
                typeof newStartTime === 'string' ? newStartTime : String(newStartTime),
                typeof newEndTime === 'string' ? newEndTime : String(newEndTime)
            );
            if (durationMinutes !== null) {
                setClause.push('duration_minutes = ?');
                values.push(durationMinutes);
            }
        }

        // Always update updated_at
        setClause.push('updated_at = NOW()');

        values.push(activityId);

        await pool.query(
            `UPDATE staff_activities SET ${setClause.join(', ')} WHERE id = ?`,
            values
        );

        // Fetch updated record
        const [updated] = await pool.query(
            'SELECT * FROM staff_activities WHERE id = ?',
            [activityId]
        );

        res.json({
            success: true,
            message: 'Activity updated successfully',
            data: updated[0]
        });

    } catch (error) {
        console.error('Update activity error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update activity'
        });
    }
});

/**
 * DELETE /api/activities/:id
 * Delete activity (admin only)
 */
router.delete('/:id', requirePermission('activities', 'manage'), async (req, res) => {
    try {
        const activityId = req.params.id;

        // Check if activity exists
        const [existing] = await pool.query(
            'SELECT id, title, user_id FROM staff_activities WHERE id = ?',
            [activityId]
        );

        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Activity not found'
            });
        }

        await pool.query('DELETE FROM staff_activities WHERE id = ?', [activityId]);

        res.json({
            success: true,
            message: 'Activity deleted successfully',
            data: {
                deleted_id: parseInt(activityId),
                title: existing[0].title
            }
        });

    } catch (error) {
        console.error('Delete activity error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete activity'
        });
    }
});

module.exports = {
    router,
    setPool
};
