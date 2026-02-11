/**
 * BRANCH MANAGEMENT ROUTES
 * Handles branch CRUD, shop hours configuration, staff listing, and manager assignment
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
// BRANCH LIST (for dropdowns - any authenticated user)
// ========================================

/**
 * GET /api/branches/list
 * Simple list of active branches for dropdowns (any authenticated user)
 */
router.get('/list', requireAuth, async (req, res) => {
    try {
        const [branches] = await pool.query(
            'SELECT id, name, code, city FROM branches WHERE status = ? ORDER BY name ASC',
            ['active']
        );
        res.json({ success: true, data: branches });
    } catch (error) {
        console.error('Error fetching branches list:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch branches' });
    }
});

// ========================================
// BRANCH CRUD ENDPOINTS
// ========================================

/**
 * GET /api/branches
 * List all branches with optional filters (requires branches:view permission)
 * Query params: status (active/inactive), city
 */
router.get('/', requirePermission('branches', 'view'), async (req, res) => {
    try {
        const { status, city } = req.query;

        let query = `
            SELECT b.*,
                   u.full_name as manager_name,
                   u.email as manager_email
            FROM branches b
            LEFT JOIN users u ON b.manager_user_id = u.id
            WHERE 1=1
        `;
        const params = [];

        if (status) {
            query += ' AND b.status = ?';
            params.push(status);
        }

        if (city) {
            query += ' AND b.city = ?';
            params.push(city);
        }

        query += ' ORDER BY b.name ASC';

        const [branches] = await pool.query(query, params);

        res.json({
            success: true,
            data: branches,
            total: branches.length
        });
    } catch (error) {
        console.error('Error fetching branches:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch branches',
            message: error.message
        });
    }
});

/**
 * GET /api/branches/:id
 * Get single branch with shop hours config
 */
router.get('/:id', requirePermission('branches', 'view'), async (req, res) => {
    try {
        const { id } = req.params;

        const [branches] = await pool.query(
            `SELECT b.*,
                    u.full_name as manager_name,
                    u.email as manager_email
             FROM branches b
             LEFT JOIN users u ON b.manager_user_id = u.id
             WHERE b.id = ?`,
            [id]
        );

        if (branches.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Branch not found'
            });
        }

        // Get shop hours config
        const [shopHours] = await pool.query(
            `SELECT * FROM shop_hours_config
             WHERE branch_id = ?
             ORDER BY day_of_week ASC`,
            [id]
        );

        res.json({
            success: true,
            data: {
                ...branches[0],
                shop_hours: shopHours
            }
        });
    } catch (error) {
        console.error('Error fetching branch details:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch branch details',
            message: error.message
        });
    }
});

/**
 * POST /api/branches
 * Create new branch + auto-create shop_hours_config for 7 days
 */
router.post('/', requirePermission('branches', 'add'), async (req, res) => {
    try {
        const {
            name, code, address, city, state, pincode, phone, email,
            manager_user_id, latitude, longitude, geo_fence_radius_meters,
            open_time, close_time, status
        } = req.body;

        // Validation
        if (!name || !code) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields',
                required: ['name', 'code']
            });
        }

        // Check if branch code already exists
        const [existing] = await pool.query(
            'SELECT id FROM branches WHERE code = ?',
            [code]
        );

        if (existing.length > 0) {
            return res.status(409).json({
                success: false,
                error: 'Branch with this code already exists'
            });
        }

        // Start transaction
        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            // Create branch - use columns that exist after migration
            const [result] = await connection.query(
                `INSERT INTO branches
                 (name, code, address, city, state, pincode, phone, email,
                  manager_user_id, latitude, longitude, geo_fence_radius_meters,
                  open_time, close_time, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    name, code,
                    address || null, city || null, state || null, pincode || null,
                    phone || null, email || null,
                    manager_user_id || null,
                    latitude || null, longitude || null,
                    geo_fence_radius_meters || 100,
                    open_time || '08:30:00', close_time || '20:30:00',
                    status || 'active'
                ]
            );

            const branchId = result.insertId;

            // Auto-create shop_hours_config for all 7 days
            // day_of_week: 0=Sunday, 1=Monday ... 6=Saturday (TINYINT)
            const defaultOpenTime = open_time || '08:30:00';
            const defaultCloseTime = close_time || '20:30:00';

            const dayValues = [
                [branchId, 1, 1, defaultOpenTime, defaultCloseTime, 10.00, 15],  // Monday
                [branchId, 2, 1, defaultOpenTime, defaultCloseTime, 10.00, 15],  // Tuesday
                [branchId, 3, 1, defaultOpenTime, defaultCloseTime, 10.00, 15],  // Wednesday
                [branchId, 4, 1, defaultOpenTime, defaultCloseTime, 10.00, 15],  // Thursday
                [branchId, 5, 1, defaultOpenTime, defaultCloseTime, 10.00, 15],  // Friday
                [branchId, 6, 1, defaultOpenTime, defaultCloseTime, 10.00, 15],  // Saturday
                [branchId, 0, 0, defaultOpenTime, defaultCloseTime, 0, 15]       // Sunday (closed)
            ];

            await connection.query(
                `INSERT INTO shop_hours_config
                 (branch_id, day_of_week, is_working_day, open_time, close_time,
                  expected_hours, late_threshold_minutes)
                 VALUES ?`,
                [dayValues]
            );

            await connection.commit();
            connection.release();

            res.status(201).json({
                success: true,
                message: 'Branch created successfully with default shop hours',
                data: {
                    id: branchId,
                    name,
                    code,
                    status: status || 'active'
                }
            });
        } catch (error) {
            await connection.rollback();
            connection.release();
            throw error;
        }
    } catch (error) {
        console.error('Error creating branch:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create branch',
            message: error.message
        });
    }
});

/**
 * PUT /api/branches/:id
 * Update branch
 */
router.put('/:id', requirePermission('branches', 'edit'), async (req, res) => {
    try {
        const { id } = req.params;
        const {
            name, code, address, city, state, pincode, phone, email,
            manager_user_id, latitude, longitude, geo_fence_radius_meters,
            open_time, close_time, status
        } = req.body;

        // Check if branch exists
        const [branches] = await pool.query('SELECT id FROM branches WHERE id = ?', [id]);
        if (branches.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Branch not found'
            });
        }

        // If code is being updated, check uniqueness
        if (code) {
            const [existing] = await pool.query(
                'SELECT id FROM branches WHERE code = ? AND id != ?',
                [code, id]
            );
            if (existing.length > 0) {
                return res.status(409).json({
                    success: false,
                    error: 'Another branch with this code already exists'
                });
            }
        }

        // Build dynamic update
        const updates = [];
        const params = [];

        if (name !== undefined) { updates.push('name = ?'); params.push(name); }
        if (code !== undefined) { updates.push('code = ?'); params.push(code); }
        if (address !== undefined) { updates.push('address = ?'); params.push(address); }
        if (city !== undefined) { updates.push('city = ?'); params.push(city); }
        if (state !== undefined) { updates.push('state = ?'); params.push(state); }
        if (pincode !== undefined) { updates.push('pincode = ?'); params.push(pincode); }
        if (phone !== undefined) { updates.push('phone = ?'); params.push(phone); }
        if (email !== undefined) { updates.push('email = ?'); params.push(email); }
        if (manager_user_id !== undefined) { updates.push('manager_user_id = ?'); params.push(manager_user_id); }
        if (latitude !== undefined) { updates.push('latitude = ?'); params.push(latitude); }
        if (longitude !== undefined) { updates.push('longitude = ?'); params.push(longitude); }
        if (geo_fence_radius_meters !== undefined) { updates.push('geo_fence_radius_meters = ?'); params.push(geo_fence_radius_meters); }
        if (open_time !== undefined) { updates.push('open_time = ?'); params.push(open_time); }
        if (close_time !== undefined) { updates.push('close_time = ?'); params.push(close_time); }
        if (status !== undefined) { updates.push('status = ?'); params.push(status); }

        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No fields to update'
            });
        }

        params.push(id);

        await pool.query(
            `UPDATE branches SET ${updates.join(', ')}, updated_at = NOW() WHERE id = ?`,
            params
        );

        res.json({
            success: true,
            message: 'Branch updated successfully'
        });
    } catch (error) {
        console.error('Error updating branch:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update branch',
            message: error.message
        });
    }
});

/**
 * DELETE /api/branches/:id
 * Soft delete branch (set status=inactive)
 */
router.delete('/:id', requirePermission('branches', 'delete'), async (req, res) => {
    try {
        const { id } = req.params;

        // Check if branch exists
        const [branches] = await pool.query('SELECT id, status FROM branches WHERE id = ?', [id]);
        if (branches.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Branch not found'
            });
        }

        if (branches[0].status === 'inactive') {
            return res.status(400).json({
                success: false,
                error: 'Branch is already inactive'
            });
        }

        await pool.query(
            'UPDATE branches SET status = ?, updated_at = NOW() WHERE id = ?',
            ['inactive', id]
        );

        res.json({
            success: true,
            message: 'Branch deactivated successfully'
        });
    } catch (error) {
        console.error('Error deactivating branch:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to deactivate branch',
            message: error.message
        });
    }
});

// ========================================
// SHOP HOURS CONFIGURATION ENDPOINTS
// ========================================

/**
 * GET /api/branches/:id/hours
 * Get shop hours for a branch
 */
router.get('/:id/hours', requirePermission('branches', 'view'), async (req, res) => {
    try {
        const { id } = req.params;

        // Check if branch exists
        const [branches] = await pool.query('SELECT id, name FROM branches WHERE id = ?', [id]);
        if (branches.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Branch not found'
            });
        }

        const [hours] = await pool.query(
            `SELECT * FROM shop_hours_config
             WHERE branch_id = ?
             ORDER BY day_of_week ASC`,
            [id]
        );

        res.json({
            success: true,
            data: {
                branch_id: parseInt(id),
                branch_name: branches[0].name,
                hours: hours
            }
        });
    } catch (error) {
        console.error('Error fetching shop hours:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch shop hours',
            message: error.message
        });
    }
});

/**
 * PUT /api/branches/:id/hours
 * Update shop hours (receives array of 7 day configs)
 * Body: { hours: [{ day_of_week, is_open, open_time, close_time, expected_hours, late_threshold_minutes, break_min_minutes, break_max_minutes }, ...] }
 */
router.put('/:id/hours', requirePermission('branches', 'edit'), async (req, res) => {
    try {
        const { id } = req.params;
        const { hours } = req.body;

        // Validation
        if (!Array.isArray(hours) || hours.length !== 7) {
            return res.status(400).json({
                success: false,
                error: 'hours must be an array of exactly 7 day configurations'
            });
        }

        // Check if branch exists
        const [branches] = await pool.query('SELECT id FROM branches WHERE id = ?', [id]);
        if (branches.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Branch not found'
            });
        }

        // Start transaction
        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            // Delete existing hours
            await connection.query('DELETE FROM shop_hours_config WHERE branch_id = ?', [id]);

            // Insert new hours
            const values = hours.map(h => [
                id,
                h.day_of_week,
                h.is_working_day !== undefined ? h.is_working_day : (h.is_open !== undefined ? h.is_open : 1),
                h.open_time || '08:30:00',
                h.close_time || '20:30:00',
                h.expected_hours !== undefined ? h.expected_hours : 10.00,
                h.late_threshold_minutes !== undefined ? h.late_threshold_minutes : 15
            ]);

            await connection.query(
                `INSERT INTO shop_hours_config
                 (branch_id, day_of_week, is_working_day, open_time, close_time,
                  expected_hours, late_threshold_minutes)
                 VALUES ?`,
                [values]
            );

            await connection.commit();
            connection.release();

            res.json({
                success: true,
                message: 'Shop hours updated successfully',
                total_days: hours.length
            });
        } catch (error) {
            await connection.rollback();
            connection.release();
            throw error;
        }
    } catch (error) {
        console.error('Error updating shop hours:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update shop hours',
            message: error.message
        });
    }
});

// ========================================
// STAFF & MANAGER ENDPOINTS
// ========================================

/**
 * GET /api/branches/:id/staff
 * Get all staff assigned to a branch
 */
router.get('/:id/staff', requirePermission('branches', 'view'), async (req, res) => {
    try {
        const { id } = req.params;

        // Check if branch exists
        const [branches] = await pool.query('SELECT id, name FROM branches WHERE id = ?', [id]);
        if (branches.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Branch not found'
            });
        }

        const [staff] = await pool.query(
            `SELECT u.id, u.username, u.full_name, u.email, u.phone,
                    u.role, u.status, u.created_at,
                    CASE WHEN b.manager_user_id = u.id THEN 1 ELSE 0 END as is_manager
             FROM users u
             LEFT JOIN branches b ON b.id = u.branch_id AND b.manager_user_id = u.id
             WHERE u.branch_id = ? AND u.status = 'active'
             ORDER BY is_manager DESC, u.full_name ASC`,
            [id]
        );

        res.json({
            success: true,
            data: {
                branch_id: parseInt(id),
                branch_name: branches[0].name,
                staff: staff,
                total: staff.length
            }
        });
    } catch (error) {
        console.error('Error fetching branch staff:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch branch staff',
            message: error.message
        });
    }
});

/**
 * PATCH /api/branches/:id/manager
 * Set branch manager
 * Body: { manager_user_id: <user_id> }
 */
router.patch('/:id/manager', requirePermission('branches', 'edit'), async (req, res) => {
    try {
        const { id } = req.params;
        const { manager_user_id } = req.body;

        if (!manager_user_id) {
            return res.status(400).json({
                success: false,
                error: 'manager_user_id is required'
            });
        }

        // Check if branch exists
        const [branches] = await pool.query('SELECT id, name FROM branches WHERE id = ?', [id]);
        if (branches.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Branch not found'
            });
        }

        // Check if user exists and belongs to this branch
        const [users] = await pool.query(
            'SELECT id, full_name, branch_id, status FROM users WHERE id = ?',
            [manager_user_id]
        );

        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        if (users[0].status !== 'active') {
            return res.status(400).json({
                success: false,
                error: 'Cannot assign inactive user as manager'
            });
        }

        if (users[0].branch_id && users[0].branch_id !== parseInt(id)) {
            return res.status(400).json({
                success: false,
                error: 'User is assigned to a different branch'
            });
        }

        await pool.query(
            'UPDATE branches SET manager_user_id = ?, updated_at = NOW() WHERE id = ?',
            [manager_user_id, id]
        );

        res.json({
            success: true,
            message: 'Branch manager updated successfully',
            data: {
                branch_id: parseInt(id),
                branch_name: branches[0].name,
                manager_user_id: manager_user_id,
                manager_name: users[0].full_name
            }
        });
    } catch (error) {
        console.error('Error setting branch manager:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to set branch manager',
            message: error.message
        });
    }
});

module.exports = {
    router,
    setPool
};
