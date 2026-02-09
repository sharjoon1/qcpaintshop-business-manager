/**
 * Role & Permission Management API Routes
 * Fixed: Uses shared pool instead of creating separate connection
 */

const express = require('express');
const router = express.Router();
const { requirePermission, requireAuth } = require('../middleware/permissionMiddleware');

let pool;

function setPool(dbPool) {
    pool = dbPool;
}

// ==================== ROLES MANAGEMENT ====================

/**
 * GET /api/roles
 * List all roles
 */
router.get('/', requireAuth, async (req, res) => {
    try {
        const { user_type, status } = req.query;

        let query = 'SELECT * FROM roles WHERE 1=1';
        const params = [];

        if (user_type) {
            query += ' AND user_type = ?';
            params.push(user_type);
        }

        if (status) {
            query += ' AND status = ?';
            params.push(status);
        }

        query += ' ORDER BY user_type, id';

        const [roles] = await pool.query(query, params);

        res.json({
            success: true,
            data: roles,
            total: roles.length
        });
    } catch (error) {
        console.error('Error fetching roles:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch roles',
            message: error.message
        });
    }
});

/**
 * GET /api/roles/permissions/all
 * List all available permissions (must be before /:id)
 */
router.get('/permissions/all', requireAuth, async (req, res) => {
    try {
        const [permissions] = await pool.query('SELECT * FROM permissions ORDER BY module, action');

        res.json({
            success: true,
            data: permissions,
            total: permissions.length
        });
    } catch (error) {
        console.error('Error fetching permissions:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch permissions',
            message: error.message
        });
    }
});

/**
 * GET /api/roles/permissions/by-module
 * List permissions grouped by module
 */
router.get('/permissions/by-module', requireAuth, async (req, res) => {
    try {
        const [permissions] = await pool.query('SELECT * FROM permissions ORDER BY module, action');

        const grouped = {};
        permissions.forEach(perm => {
            if (!grouped[perm.module]) {
                grouped[perm.module] = [];
            }
            grouped[perm.module].push(perm);
        });

        res.json({
            success: true,
            data: grouped
        });
    } catch (error) {
        console.error('Error fetching permissions:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch permissions',
            message: error.message
        });
    }
});

/**
 * GET /api/roles/:id
 * Get role details with permissions
 */
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        const [roles] = await pool.query('SELECT * FROM roles WHERE id = ?', [id]);

        if (roles.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Role not found'
            });
        }

        const [permissions] = await pool.query(`
            SELECT p.*
            FROM permissions p
            JOIN role_permissions rp ON p.id = rp.permission_id
            WHERE rp.role_id = ?
            ORDER BY p.module, p.action
        `, [id]);

        res.json({
            success: true,
            data: {
                ...roles[0],
                permissions: permissions
            }
        });
    } catch (error) {
        console.error('Error fetching role details:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch role details',
            message: error.message
        });
    }
});

/**
 * POST /api/roles
 * Create new role
 */
router.post('/', requirePermission('roles', 'manage'), async (req, res) => {
    try {
        const { name, display_name, description, user_type, status, price_markup_percent, default_discount_percent } = req.body;

        if (!name || !display_name || !user_type) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields',
                required: ['name', 'display_name', 'user_type']
            });
        }

        if (!['staff', 'customer'].includes(user_type)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid user_type. Must be "staff" or "customer"'
            });
        }

        const [existing] = await pool.query('SELECT id FROM roles WHERE name = ?', [name]);
        if (existing.length > 0) {
            return res.status(409).json({
                success: false,
                error: 'Role with this name already exists'
            });
        }

        const [result] = await pool.query(`
            INSERT INTO roles (name, display_name, description, user_type, status, is_system_role, price_markup_percent, default_discount_percent)
            VALUES (?, ?, ?, ?, ?, FALSE, ?, ?)
        `, [
            name,
            display_name,
            description || null,
            user_type,
            status || 'active',
            user_type === 'customer' ? (price_markup_percent || 0) : 0,
            user_type === 'customer' ? (default_discount_percent || 0) : 0
        ]);

        res.status(201).json({
            success: true,
            message: 'Role created successfully',
            data: {
                id: result.insertId,
                name,
                display_name,
                description,
                user_type,
                status: status || 'active'
            }
        });
    } catch (error) {
        console.error('Error creating role:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create role',
            message: error.message
        });
    }
});

/**
 * PUT /api/roles/:id
 * Update role
 */
router.put('/:id', requirePermission('roles', 'manage'), async (req, res) => {
    try {
        const { id } = req.params;
        const { display_name, description, status, price_markup_percent, default_discount_percent } = req.body;

        const [roles] = await pool.query('SELECT is_system_role FROM roles WHERE id = ?', [id]);
        if (roles.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Role not found'
            });
        }

        const updates = [];
        const params = [];

        if (display_name) {
            updates.push('display_name = ?');
            params.push(display_name);
        }

        if (description !== undefined) {
            updates.push('description = ?');
            params.push(description);
        }

        if (status) {
            updates.push('status = ?');
            params.push(status);
        }

        if (price_markup_percent !== undefined) {
            updates.push('price_markup_percent = ?');
            params.push(price_markup_percent);
        }

        if (default_discount_percent !== undefined) {
            updates.push('default_discount_percent = ?');
            params.push(default_discount_percent);
        }

        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No fields to update'
            });
        }

        params.push(id);

        await pool.query(`UPDATE roles SET ${updates.join(', ')} WHERE id = ?`, params);

        res.json({
            success: true,
            message: 'Role updated successfully'
        });
    } catch (error) {
        console.error('Error updating role:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update role',
            message: error.message
        });
    }
});

/**
 * DELETE /api/roles/:id
 * Delete role (only if not system role)
 */
router.delete('/:id', requirePermission('roles', 'manage'), async (req, res) => {
    try {
        const { id } = req.params;

        const [roles] = await pool.query('SELECT is_system_role FROM roles WHERE id = ?', [id]);
        if (roles.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Role not found'
            });
        }

        if (roles[0].is_system_role) {
            return res.status(403).json({
                success: false,
                error: 'Cannot delete system role'
            });
        }

        // Delete role permissions first, then role
        await pool.query('DELETE FROM role_permissions WHERE role_id = ?', [id]);
        await pool.query('DELETE FROM roles WHERE id = ?', [id]);

        res.json({
            success: true,
            message: 'Role deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting role:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete role',
            message: error.message
        });
    }
});

// ==================== ROLE PERMISSIONS ====================

/**
 * GET /api/roles/:id/permissions
 * Get permissions for a specific role
 */
router.get('/:id/permissions', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        const [permissions] = await pool.query(`
            SELECT p.*
            FROM permissions p
            JOIN role_permissions rp ON p.id = rp.permission_id
            WHERE rp.role_id = ?
            ORDER BY p.module, p.action
        `, [id]);

        res.json({
            success: true,
            data: permissions,
            total: permissions.length
        });
    } catch (error) {
        console.error('Error fetching role permissions:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch role permissions',
            message: error.message
        });
    }
});

/**
 * PUT /api/roles/:id/permissions
 * Update role permissions (replace all)
 */
router.put('/:id/permissions', requirePermission('roles', 'manage'), async (req, res) => {
    try {
        const { id } = req.params;
        const { permission_ids } = req.body;

        if (!Array.isArray(permission_ids)) {
            return res.status(400).json({
                success: false,
                error: 'permission_ids must be an array'
            });
        }

        const [roles] = await pool.query('SELECT id FROM roles WHERE id = ?', [id]);
        if (roles.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Role not found'
            });
        }

        const connection = await pool.getConnection();
        await connection.beginTransaction();

        try {
            await connection.query('DELETE FROM role_permissions WHERE role_id = ?', [id]);

            if (permission_ids.length > 0) {
                const values = permission_ids.map(perm_id => [id, perm_id]);
                await connection.query(
                    'INSERT INTO role_permissions (role_id, permission_id) VALUES ?',
                    [values]
                );
            }

            await connection.commit();
            connection.release();

            res.json({
                success: true,
                message: 'Role permissions updated successfully',
                total_permissions: permission_ids.length
            });
        } catch (error) {
            await connection.rollback();
            connection.release();
            throw error;
        }
    } catch (error) {
        console.error('Error updating role permissions:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update role permissions',
            message: error.message
        });
    }
});

/**
 * POST /api/roles/:id/permissions
 * Add single permission to role
 */
router.post('/:id/permissions', requirePermission('roles', 'manage'), async (req, res) => {
    try {
        const { id } = req.params;
        const { permission_id } = req.body;

        if (!permission_id) {
            return res.status(400).json({
                success: false,
                error: 'permission_id is required'
            });
        }

        await pool.query(
            'INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
            [id, permission_id]
        );

        res.json({
            success: true,
            message: 'Permission added to role'
        });
    } catch (error) {
        console.error('Error adding permission:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to add permission',
            message: error.message
        });
    }
});

/**
 * DELETE /api/roles/:id/permissions/:permission_id
 * Remove permission from role
 */
router.delete('/:id/permissions/:permission_id', requirePermission('roles', 'manage'), async (req, res) => {
    try {
        const { id, permission_id } = req.params;

        await pool.query(
            'DELETE FROM role_permissions WHERE role_id = ? AND permission_id = ?',
            [id, permission_id]
        );

        res.json({
            success: true,
            message: 'Permission removed from role'
        });
    } catch (error) {
        console.error('Error removing permission:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to remove permission',
            message: error.message
        });
    }
});

module.exports = { router, setPool };
