/**
 * TASK MANAGEMENT MODULE ROUTES
 * Handles admin-controlled staff task assignment, tracking, updates, and rating
 */

const express = require('express');
const router = express.Router();
const { requirePermission, requireAuth } = require('../middleware/permissionMiddleware');
const notificationService = require('../services/notification-service');

// Database connection (imported from main app)
let pool;

function setPool(dbPool) {
    pool = dbPool;
}

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Generate task number in format TASK-YYYYMMDD-XXXX
 */
async function generateTaskNumber() {
    const today = new Date();
    const dateStr = today.toISOString().split('T')[0].replace(/-/g, '');
    const prefix = `TASK-${dateStr}`;

    const [rows] = await pool.query(
        `SELECT task_number FROM staff_tasks
         WHERE task_number LIKE ?
         ORDER BY task_number DESC LIMIT 1`,
        [`${prefix}-%`]
    );

    let sequence = 1;
    if (rows.length > 0) {
        const lastSequence = parseInt(rows[0].task_number.split('-').pop(), 10);
        sequence = lastSequence + 1;
    }

    return `${prefix}-${String(sequence).padStart(4, '0')}`;
}

/**
 * Auto-mark overdue tasks
 * Updates tasks that are past due_date and not in a terminal status
 */
async function markOverdueTasks() {
    const today = new Date().toISOString().split('T')[0];

    await pool.query(
        `UPDATE staff_tasks
         SET status = 'overdue', updated_at = NOW()
         WHERE due_date < ?
           AND status NOT IN ('completed', 'cancelled', 'overdue')`,
        [today]
    );
}

// ========================================
// LIST & QUERY ENDPOINTS
// ========================================

/**
 * GET /api/tasks
 * List tasks with filters and pagination
 */
router.get('/', requirePermission('tasks', 'view'), async (req, res) => {
    try {
        // Auto-mark overdue tasks before listing
        await markOverdueTasks();

        const {
            assigned_to,
            status,
            priority,
            due_date,
            branch_id,
            category,
            task_type,
            search,
            page = 1,
            limit = 20,
            sort_by = 'created_at',
            sort_order = 'DESC'
        } = req.query;

        const offset = (parseInt(page) - 1) * parseInt(limit);

        let query = `
            SELECT
                t.*,
                assigned.full_name as assigned_to_name,
                assigned.username as assigned_to_username,
                assigner.full_name as assigned_by_name,
                b.name as branch_name
            FROM staff_tasks t
            LEFT JOIN users assigned ON t.assigned_to = assigned.id
            LEFT JOIN users assigner ON t.assigned_by = assigner.id
            LEFT JOIN branches b ON t.branch_id = b.id
            WHERE 1=1
        `;

        let countQuery = `
            SELECT COUNT(*) as total
            FROM staff_tasks t
            WHERE 1=1
        `;

        const params = [];
        const countParams = [];

        if (assigned_to) {
            const filter = ' AND t.assigned_to = ?';
            query += filter;
            countQuery += filter;
            params.push(assigned_to);
            countParams.push(assigned_to);
        }

        if (status) {
            const filter = ' AND t.status = ?';
            query += filter;
            countQuery += filter;
            params.push(status);
            countParams.push(status);
        }

        if (priority) {
            const filter = ' AND t.priority = ?';
            query += filter;
            countQuery += filter;
            params.push(priority);
            countParams.push(priority);
        }

        if (due_date) {
            const filter = ' AND t.due_date = ?';
            query += filter;
            countQuery += filter;
            params.push(due_date);
            countParams.push(due_date);
        }

        if (branch_id) {
            const filter = ' AND t.branch_id = ?';
            query += filter;
            countQuery += filter;
            params.push(branch_id);
            countParams.push(branch_id);
        }

        if (category) {
            const filter = ' AND t.category = ?';
            query += filter;
            countQuery += filter;
            params.push(category);
            countParams.push(category);
        }

        if (task_type) {
            const filter = ' AND t.task_type = ?';
            query += filter;
            countQuery += filter;
            params.push(task_type);
            countParams.push(task_type);
        }

        if (search) {
            const filter = ' AND (t.title LIKE ? OR t.description LIKE ? OR t.task_number LIKE ?)';
            query += filter;
            countQuery += filter;
            const searchVal = `%${search}%`;
            params.push(searchVal, searchVal, searchVal);
            countParams.push(searchVal, searchVal, searchVal);
        }

        // Validate sort column to prevent SQL injection
        const allowedSortColumns = ['created_at', 'due_date', 'priority', 'status', 'title', 'updated_at'];
        const safeSortBy = allowedSortColumns.includes(sort_by) ? sort_by : 'created_at';
        const safeSortOrder = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        query += ` ORDER BY t.${safeSortBy} ${safeSortOrder} LIMIT ? OFFSET ?`;
        params.push(parseInt(limit), offset);

        const [tasks] = await pool.query(query, params);
        const [countResult] = await pool.query(countQuery, countParams);

        const total = countResult[0].total;
        const totalPages = Math.ceil(total / parseInt(limit));

        res.json({
            success: true,
            data: tasks,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: total,
                total_pages: totalPages
            }
        });

    } catch (error) {
        console.error('Error fetching tasks:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch tasks'
        });
    }
});

/**
 * GET /api/tasks/my-tasks
 * Get current user's assigned tasks
 */
router.get('/my-tasks', requireAuth, async (req, res) => {
    try {
        // Auto-mark overdue tasks
        await markOverdueTasks();

        const userId = req.user.id;
        const { status, priority, limit = 50 } = req.query;

        let query = `
            SELECT
                t.*,
                assigner.full_name as assigned_by_name,
                b.name as branch_name
            FROM staff_tasks t
            LEFT JOIN users assigner ON t.assigned_by = assigner.id
            LEFT JOIN branches b ON t.branch_id = b.id
            WHERE t.assigned_to = ?
        `;

        const params = [userId];

        if (status) {
            query += ' AND t.status = ?';
            params.push(status);
        }

        if (priority) {
            query += ' AND t.priority = ?';
            params.push(priority);
        }

        query += ' ORDER BY FIELD(t.priority, "urgent", "high", "medium", "low"), t.due_date ASC LIMIT ?';
        params.push(parseInt(limit));

        const [tasks] = await pool.query(query, params);

        res.json({
            success: true,
            count: tasks.length,
            data: tasks
        });

    } catch (error) {
        console.error('Error fetching my tasks:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch your tasks'
        });
    }
});

/**
 * GET /api/tasks/stats
 * Task statistics (total, pending, in_progress, completed, overdue counts)
 */
router.get('/stats', requirePermission('tasks', 'view'), async (req, res) => {
    try {
        // Auto-mark overdue tasks
        await markOverdueTasks();

        const { branch_id, assigned_to } = req.query;

        let whereClause = 'WHERE 1=1';
        const params = [];

        if (branch_id) {
            whereClause += ' AND t.branch_id = ?';
            params.push(branch_id);
        }

        if (assigned_to) {
            whereClause += ' AND t.assigned_to = ?';
            params.push(assigned_to);
        }

        const [stats] = await pool.query(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN t.status = 'pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
                SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN t.status = 'overdue' THEN 1 ELSE 0 END) as overdue,
                SUM(CASE WHEN t.status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
                SUM(CASE WHEN t.status = 'on_hold' THEN 1 ELSE 0 END) as on_hold,
                SUM(CASE WHEN t.priority = 'urgent' AND t.status NOT IN ('completed', 'cancelled') THEN 1 ELSE 0 END) as urgent_active,
                AVG(CASE WHEN t.status = 'completed' THEN t.rating ELSE NULL END) as avg_rating,
                AVG(CASE WHEN t.status = 'completed' THEN t.actual_hours ELSE NULL END) as avg_completion_hours
            FROM staff_tasks t
            ${whereClause}
        `, params);

        res.json({
            success: true,
            data: stats[0]
        });

    } catch (error) {
        console.error('Error fetching task stats:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch task statistics'
        });
    }
});

/**
 * GET /api/tasks/overdue
 * Get all overdue tasks (due_date < today AND status not completed/cancelled)
 */
router.get('/overdue', requirePermission('tasks', 'view'), async (req, res) => {
    try {
        // Auto-mark overdue tasks
        await markOverdueTasks();

        const { branch_id, assigned_to } = req.query;
        const today = new Date().toISOString().split('T')[0];

        let query = `
            SELECT
                t.*,
                assigned.full_name as assigned_to_name,
                assigned.username as assigned_to_username,
                assigner.full_name as assigned_by_name,
                b.name as branch_name,
                DATEDIFF(?, t.due_date) as days_overdue
            FROM staff_tasks t
            LEFT JOIN users assigned ON t.assigned_to = assigned.id
            LEFT JOIN users assigner ON t.assigned_by = assigner.id
            LEFT JOIN branches b ON t.branch_id = b.id
            WHERE t.due_date < ?
              AND t.status NOT IN ('completed', 'cancelled')
        `;

        const params = [today, today];

        if (branch_id) {
            query += ' AND t.branch_id = ?';
            params.push(branch_id);
        }

        if (assigned_to) {
            query += ' AND t.assigned_to = ?';
            params.push(assigned_to);
        }

        query += ' ORDER BY t.due_date ASC';

        const [tasks] = await pool.query(query, params);

        res.json({
            success: true,
            count: tasks.length,
            data: tasks
        });

    } catch (error) {
        console.error('Error fetching overdue tasks:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch overdue tasks'
        });
    }
});

// ========================================
// SINGLE TASK ENDPOINTS
// ========================================

/**
 * GET /api/tasks/:id
 * Get single task with all updates/comments
 */
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const taskId = req.params.id;

        const [tasks] = await pool.query(`
            SELECT
                t.*,
                assigned.full_name as assigned_to_name,
                assigned.username as assigned_to_username,
                assigned.email as assigned_to_email,
                assigner.full_name as assigned_by_name,
                b.name as branch_name
            FROM staff_tasks t
            LEFT JOIN users assigned ON t.assigned_to = assigned.id
            LEFT JOIN users assigner ON t.assigned_by = assigner.id
            LEFT JOIN branches b ON t.branch_id = b.id
            WHERE t.id = ?
        `, [taskId]);

        if (tasks.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Task not found'
            });
        }

        // Get all updates/comments for this task
        const [updates] = await pool.query(`
            SELECT
                tu.*,
                u.full_name as user_name,
                u.username,
                u.role as user_role
            FROM task_updates tu
            JOIN users u ON tu.user_id = u.id
            WHERE tu.task_id = ?
            ORDER BY tu.created_at ASC
        `, [taskId]);

        res.json({
            success: true,
            data: {
                task: tasks[0],
                updates: updates
            }
        });

    } catch (error) {
        console.error('Error fetching task:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch task details'
        });
    }
});

// ========================================
// CREATE / UPDATE / DELETE ENDPOINTS
// ========================================

/**
 * POST /api/tasks
 * Create task (admin assigns to staff)
 */
router.post('/', requirePermission('tasks', 'assign'), async (req, res) => {
    try {
        const {
            title,
            description,
            task_type = 'one_time',
            priority = 'medium',
            category,
            assigned_to,
            branch_id,
            due_date,
            due_time,
            start_date,
            estimated_hours,
            admin_notes
        } = req.body;

        // Validation
        if (!title || !assigned_to || !due_date) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: title, assigned_to, due_date'
            });
        }

        // Validate enums
        const validTaskTypes = ['daily', 'weekly', 'monthly', 'one_time', 'recurring'];
        if (!validTaskTypes.includes(task_type)) {
            return res.status(400).json({
                success: false,
                message: `Invalid task_type. Must be one of: ${validTaskTypes.join(', ')}`
            });
        }

        const validPriorities = ['low', 'medium', 'high', 'urgent'];
        if (!validPriorities.includes(priority)) {
            return res.status(400).json({
                success: false,
                message: `Invalid priority. Must be one of: ${validPriorities.join(', ')}`
            });
        }

        // Verify assigned user exists
        const [users] = await pool.query(
            'SELECT id, full_name, branch_id FROM users WHERE id = ? AND status = ?',
            [assigned_to, 'active']
        );

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Assigned user not found or inactive'
            });
        }

        // Generate task number
        const taskNumber = await generateTaskNumber();
        const taskBranchId = branch_id || users[0].branch_id;

        const [result] = await pool.query(`
            INSERT INTO staff_tasks (
                task_number, title, description, task_type, priority, category,
                assigned_to, assigned_by, branch_id, due_date, due_time,
                start_date, estimated_hours, status, completion_percentage,
                admin_notes, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, NOW(), NOW())
        `, [
            taskNumber, title, description || null, task_type, priority, category || null,
            assigned_to, req.user.id, taskBranchId, due_date, due_time || null,
            start_date || null, estimated_hours || null,
            admin_notes || null
        ]);

        // Create initial task update entry
        await pool.query(`
            INSERT INTO task_updates (task_id, user_id, update_type, new_status, comment, created_at)
            VALUES (?, ?, 'status_change', 'pending', 'Task created and assigned', NOW())
        `, [result.insertId, req.user.id]);

        // Notify assigned user
        try {
            await notificationService.send(assigned_to, {
                type: 'task_assigned', title: 'New Task Assigned',
                body: `You have been assigned: ${title}`,
                data: { type: 'task_assigned', task_id: result.insertId, task_number: taskNumber }
            });
        } catch (notifErr) { console.error('Task notification error:', notifErr.message); }

        res.status(201).json({
            success: true,
            message: 'Task created and assigned successfully',
            data: {
                id: result.insertId,
                task_number: taskNumber,
                assigned_to: assigned_to,
                assigned_to_name: users[0].full_name,
                status: 'pending'
            }
        });

    } catch (error) {
        console.error('Error creating task:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create task'
        });
    }
});

/**
 * PUT /api/tasks/:id
 * Update task (admin)
 */
router.put('/:id', requirePermission('tasks', 'assign'), async (req, res) => {
    try {
        const taskId = req.params.id;

        // Verify task exists
        const [existing] = await pool.query(
            'SELECT * FROM staff_tasks WHERE id = ?',
            [taskId]
        );

        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Task not found'
            });
        }

        const allowedFields = [
            'title', 'description', 'task_type', 'priority', 'category',
            'assigned_to', 'branch_id', 'due_date', 'due_time', 'start_date',
            'estimated_hours', 'status', 'admin_notes'
        ];

        const updates = req.body;
        const setClause = [];
        const values = [];

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

        // Always update the updated_at timestamp
        setClause.push('updated_at = NOW()');

        values.push(taskId);

        await pool.query(
            `UPDATE staff_tasks SET ${setClause.join(', ')} WHERE id = ?`,
            values
        );

        // Log status change if status was updated
        if (updates.status && updates.status !== existing[0].status) {
            await pool.query(`
                INSERT INTO task_updates (task_id, user_id, update_type, old_status, new_status, comment, created_at)
                VALUES (?, ?, 'status_change', ?, ?, 'Task updated by admin', NOW())
            `, [taskId, req.user.id, existing[0].status, updates.status]);
        }

        res.json({
            success: true,
            message: 'Task updated successfully'
        });

    } catch (error) {
        console.error('Error updating task:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update task'
        });
    }
});

/**
 * DELETE /api/tasks/:id
 * Delete task (admin)
 */
router.delete('/:id', requirePermission('tasks', 'assign'), async (req, res) => {
    try {
        const taskId = req.params.id;

        // Verify task exists
        const [existing] = await pool.query(
            'SELECT id, task_number, status FROM staff_tasks WHERE id = ?',
            [taskId]
        );

        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Task not found'
            });
        }

        // Delete associated updates first
        await pool.query('DELETE FROM task_updates WHERE task_id = ?', [taskId]);

        // Delete the task
        await pool.query('DELETE FROM staff_tasks WHERE id = ?', [taskId]);

        res.json({
            success: true,
            message: 'Task deleted successfully',
            data: {
                id: taskId,
                task_number: existing[0].task_number
            }
        });

    } catch (error) {
        console.error('Error deleting task:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete task'
        });
    }
});

// ========================================
// STATUS & PROGRESS ENDPOINTS
// ========================================

/**
 * PATCH /api/tasks/:id/status
 * Update task status (staff can update own task status)
 */
router.patch('/:id/status', requireAuth, async (req, res) => {
    try {
        const taskId = req.params.id;
        const userId = req.user.id;
        const { status, staff_notes } = req.body;

        if (!status) {
            return res.status(400).json({
                success: false,
                message: 'Status is required'
            });
        }

        const validStatuses = ['pending', 'in_progress', 'completed', 'on_hold'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: `Invalid status. Staff can set: ${validStatuses.join(', ')}`
            });
        }

        // Get the task
        const [tasks] = await pool.query(
            'SELECT * FROM staff_tasks WHERE id = ?',
            [taskId]
        );

        if (tasks.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Task not found'
            });
        }

        const task = tasks[0];

        // Staff can only update their own tasks (admin can update any)
        if (req.user.role !== 'admin' && task.assigned_to !== userId) {
            return res.status(403).json({
                success: false,
                message: 'You can only update status of tasks assigned to you'
            });
        }

        const oldStatus = task.status;
        const updateFields = {
            status: status,
            updated_at: new Date()
        };

        // If completing, set completed_at and 100%
        if (status === 'completed') {
            updateFields.completed_at = new Date();
            updateFields.completion_percentage = 100;
        }

        // If staff notes provided, update them
        if (staff_notes) {
            updateFields.staff_notes = staff_notes;
        }

        const setClause = Object.keys(updateFields).map(k => `${k} = ?`).join(', ');
        const values = Object.values(updateFields);
        values.push(taskId);

        await pool.query(
            `UPDATE staff_tasks SET ${setClause} WHERE id = ?`,
            values
        );

        // Log the status change
        await pool.query(`
            INSERT INTO task_updates (task_id, user_id, update_type, old_status, new_status, comment, created_at)
            VALUES (?, ?, 'status_change', ?, ?, ?, NOW())
        `, [taskId, userId, oldStatus, status, staff_notes || `Status changed to ${status}`]);

        // Notify assigner when task is completed
        if (status === 'completed' && task.assigned_by && task.assigned_by !== userId) {
            try {
                const [assignedUser] = await pool.query('SELECT full_name FROM users WHERE id = ?', [task.assigned_to]);
                const staffName = assignedUser.length > 0 ? assignedUser[0].full_name : 'Staff';
                await notificationService.send(task.assigned_by, {
                    type: 'task_completed', title: 'Task Completed',
                    body: `${staffName} has completed: ${task.title}`,
                    data: { type: 'task_completed', task_id: taskId, task_number: task.task_number }
                });
            } catch (notifErr) { console.error('Task completion notification error:', notifErr.message); }
        }

        res.json({
            success: true,
            message: `Task status updated to ${status}`,
            data: {
                id: taskId,
                old_status: oldStatus,
                new_status: status,
                completed_at: status === 'completed' ? updateFields.completed_at : null
            }
        });

    } catch (error) {
        console.error('Error updating task status:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update task status'
        });
    }
});

/**
 * POST /api/tasks/:id/update
 * Add update/comment to task (staff or admin)
 */
router.post('/:id/update', requireAuth, async (req, res) => {
    try {
        const taskId = req.params.id;
        const userId = req.user.id;
        const { update_type = 'comment', comment, photo_url, progress_percentage } = req.body;

        // Validate update_type
        const validTypes = ['status_change', 'comment', 'progress', 'photo', 'attachment'];
        if (!validTypes.includes(update_type)) {
            return res.status(400).json({
                success: false,
                message: `Invalid update_type. Must be one of: ${validTypes.join(', ')}`
            });
        }

        // Require at least comment or photo_url
        if (!comment && !photo_url) {
            return res.status(400).json({
                success: false,
                message: 'Comment or photo_url is required'
            });
        }

        // Verify task exists
        const [tasks] = await pool.query(
            'SELECT id, assigned_to FROM staff_tasks WHERE id = ?',
            [taskId]
        );

        if (tasks.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Task not found'
            });
        }

        // Staff can only comment on their own tasks (admin can comment on any)
        if (req.user.role !== 'admin' && tasks[0].assigned_to !== userId) {
            return res.status(403).json({
                success: false,
                message: 'You can only add updates to tasks assigned to you'
            });
        }

        const [result] = await pool.query(`
            INSERT INTO task_updates (task_id, user_id, update_type, comment, photo_url, progress_percentage, created_at)
            VALUES (?, ?, ?, ?, ?, ?, NOW())
        `, [taskId, userId, update_type, comment || null, photo_url || null, progress_percentage || null]);

        // If progress_percentage provided, update the task's completion_percentage
        if (progress_percentage !== undefined && progress_percentage !== null) {
            await pool.query(
                'UPDATE staff_tasks SET completion_percentage = ?, updated_at = NOW() WHERE id = ?',
                [progress_percentage, taskId]
            );
        }

        // Update the task's updated_at timestamp
        await pool.query(
            'UPDATE staff_tasks SET updated_at = NOW() WHERE id = ?',
            [taskId]
        );

        res.status(201).json({
            success: true,
            message: 'Update added successfully',
            data: {
                id: result.insertId,
                task_id: taskId,
                update_type: update_type
            }
        });

    } catch (error) {
        console.error('Error adding task update:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add task update'
        });
    }
});

/**
 * PATCH /api/tasks/:id/progress
 * Update task completion percentage
 */
router.patch('/:id/progress', requireAuth, async (req, res) => {
    try {
        const taskId = req.params.id;
        const userId = req.user.id;
        const { completion_percentage, staff_notes } = req.body;

        if (completion_percentage === undefined || completion_percentage === null) {
            return res.status(400).json({
                success: false,
                message: 'completion_percentage is required'
            });
        }

        const percentage = parseInt(completion_percentage);
        if (isNaN(percentage) || percentage < 0 || percentage > 100) {
            return res.status(400).json({
                success: false,
                message: 'completion_percentage must be between 0 and 100'
            });
        }

        // Verify task exists
        const [tasks] = await pool.query(
            'SELECT * FROM staff_tasks WHERE id = ?',
            [taskId]
        );

        if (tasks.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Task not found'
            });
        }

        const task = tasks[0];

        // Staff can only update their own tasks (admin can update any)
        if (req.user.role !== 'admin' && task.assigned_to !== userId) {
            return res.status(403).json({
                success: false,
                message: 'You can only update progress of tasks assigned to you'
            });
        }

        const updateData = {
            completion_percentage: percentage,
            updated_at: new Date()
        };

        // Auto-complete if 100%
        if (percentage === 100 && task.status !== 'completed') {
            updateData.status = 'completed';
            updateData.completed_at = new Date();
        }

        // Auto-set to in_progress if progress > 0 and still pending
        if (percentage > 0 && percentage < 100 && task.status === 'pending') {
            updateData.status = 'in_progress';
        }

        if (staff_notes) {
            updateData.staff_notes = staff_notes;
        }

        const setClause = Object.keys(updateData).map(k => `${k} = ?`).join(', ');
        const values = Object.values(updateData);
        values.push(taskId);

        await pool.query(
            `UPDATE staff_tasks SET ${setClause} WHERE id = ?`,
            values
        );

        // Log progress update
        await pool.query(`
            INSERT INTO task_updates (task_id, user_id, update_type, progress_percentage, comment, created_at)
            VALUES (?, ?, 'progress', ?, ?, NOW())
        `, [taskId, userId, percentage, staff_notes || `Progress updated to ${percentage}%`]);

        // If auto-completed, also log status change
        if (percentage === 100 && task.status !== 'completed') {
            await pool.query(`
                INSERT INTO task_updates (task_id, user_id, update_type, old_status, new_status, comment, created_at)
                VALUES (?, ?, 'status_change', ?, 'completed', 'Auto-completed at 100% progress', NOW())
            `, [taskId, userId, task.status]);
        }

        res.json({
            success: true,
            message: `Progress updated to ${percentage}%`,
            data: {
                id: taskId,
                completion_percentage: percentage,
                status: updateData.status || task.status,
                auto_completed: percentage === 100 && task.status !== 'completed'
            }
        });

    } catch (error) {
        console.error('Error updating task progress:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update task progress'
        });
    }
});

// ========================================
// RATING ENDPOINT
// ========================================

/**
 * PATCH /api/tasks/:id/rate
 * Admin rates a completed task (1-5)
 */
router.patch('/:id/rate', requirePermission('tasks', 'assign'), async (req, res) => {
    try {
        const taskId = req.params.id;
        const { rating, rating_notes } = req.body;

        if (!rating) {
            return res.status(400).json({
                success: false,
                message: 'Rating is required'
            });
        }

        const ratingValue = parseInt(rating);
        if (isNaN(ratingValue) || ratingValue < 1 || ratingValue > 5) {
            return res.status(400).json({
                success: false,
                message: 'Rating must be between 1 and 5'
            });
        }

        // Verify task exists and is completed
        const [tasks] = await pool.query(
            'SELECT id, status, task_number FROM staff_tasks WHERE id = ?',
            [taskId]
        );

        if (tasks.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Task not found'
            });
        }

        if (tasks[0].status !== 'completed') {
            return res.status(400).json({
                success: false,
                message: 'Only completed tasks can be rated'
            });
        }

        await pool.query(
            'UPDATE staff_tasks SET rating = ?, rating_notes = ?, updated_at = NOW() WHERE id = ?',
            [ratingValue, rating_notes || null, taskId]
        );

        // Log rating update
        await pool.query(`
            INSERT INTO task_updates (task_id, user_id, update_type, comment, created_at)
            VALUES (?, ?, 'comment', ?, NOW())
        `, [taskId, req.user.id, `Task rated ${ratingValue}/5${rating_notes ? ': ' + rating_notes : ''}`]);

        res.json({
            success: true,
            message: `Task rated ${ratingValue}/5 successfully`,
            data: {
                id: taskId,
                task_number: tasks[0].task_number,
                rating: ratingValue,
                rating_notes: rating_notes || null
            }
        });

    } catch (error) {
        console.error('Error rating task:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to rate task'
        });
    }
});

// ========================================
// BULK OPERATIONS
// ========================================

/**
 * POST /api/tasks/bulk-assign
 * Bulk assign tasks to multiple staff members
 * Body: { tasks: [{ assigned_to, title, description, due_date, priority, category, task_type }] }
 */
router.post('/bulk-assign', requirePermission('tasks', 'assign'), async (req, res) => {
    try {
        const { tasks } = req.body;

        if (!tasks || !Array.isArray(tasks) || tasks.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Tasks array is required and must not be empty'
            });
        }

        // Validate each task
        for (let i = 0; i < tasks.length; i++) {
            const task = tasks[i];
            if (!task.assigned_to || !task.title || !task.due_date) {
                return res.status(400).json({
                    success: false,
                    message: `Task at index ${i} is missing required fields: assigned_to, title, due_date`
                });
            }
        }

        const results = [];
        const errors = [];

        for (const task of tasks) {
            try {
                // Verify assigned user exists
                const [users] = await pool.query(
                    'SELECT id, full_name, branch_id FROM users WHERE id = ? AND status = ?',
                    [task.assigned_to, 'active']
                );

                if (users.length === 0) {
                    errors.push({
                        assigned_to: task.assigned_to,
                        title: task.title,
                        error: 'Assigned user not found or inactive'
                    });
                    continue;
                }

                const taskNumber = await generateTaskNumber();
                const taskBranchId = task.branch_id || users[0].branch_id;

                const [result] = await pool.query(`
                    INSERT INTO staff_tasks (
                        task_number, title, description, task_type, priority, category,
                        assigned_to, assigned_by, branch_id, due_date, due_time,
                        start_date, estimated_hours, status, completion_percentage,
                        admin_notes, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, NOW(), NOW())
                `, [
                    taskNumber,
                    task.title,
                    task.description || null,
                    task.task_type || 'one_time',
                    task.priority || 'medium',
                    task.category || null,
                    task.assigned_to,
                    req.user.id,
                    taskBranchId,
                    task.due_date,
                    task.due_time || null,
                    task.start_date || null,
                    task.estimated_hours || null,
                    task.admin_notes || null
                ]);

                // Create initial task update entry
                await pool.query(`
                    INSERT INTO task_updates (task_id, user_id, update_type, new_status, comment, created_at)
                    VALUES (?, ?, 'status_change', 'pending', 'Task created via bulk assignment', NOW())
                `, [result.insertId, req.user.id]);

                // Notify assigned user
                try {
                    await notificationService.send(task.assigned_to, {
                        type: 'task_assigned', title: 'New Task Assigned',
                        body: `You have been assigned: ${task.title}`,
                        data: { type: 'task_assigned', task_id: result.insertId, task_number: taskNumber }
                    });
                } catch (notifErr) { console.error('Bulk task notification error:', notifErr.message); }

                results.push({
                    id: result.insertId,
                    task_number: taskNumber,
                    assigned_to: task.assigned_to,
                    assigned_to_name: users[0].full_name,
                    title: task.title,
                    status: 'pending'
                });

            } catch (taskError) {
                errors.push({
                    assigned_to: task.assigned_to,
                    title: task.title,
                    error: taskError.message
                });
            }
        }

        res.status(201).json({
            success: true,
            message: `${results.length} task(s) created successfully${errors.length > 0 ? `, ${errors.length} failed` : ''}`,
            data: {
                created: results,
                failed: errors,
                total_requested: tasks.length,
                total_created: results.length,
                total_failed: errors.length
            }
        });

    } catch (error) {
        console.error('Error bulk assigning tasks:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to bulk assign tasks'
        });
    }
});

module.exports = {
    router,
    setPool
};
