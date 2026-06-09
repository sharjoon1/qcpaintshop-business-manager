/**
 * Role & Permission Management API Routes
 * Fixed: Uses shared pool instead of creating separate connection
 */

const express = require('express');
const router = express.Router();
const { requirePermission, requireAuth, isFullAdmin, FULL_ADMIN_ROLES } = require('../middleware/permissionMiddleware');
const audit = require('../services/audit-log');

let pool;

function setPool(dbPool) {
    pool = dbPool;
}

/**
 * Guard against privilege escalation via permission edits (RT-026).
 * A non-full-admin holder of roles.manage must not be able to rewrite the
 * permission set of a system/admin role, nor of their OWN role (which would
 * let them grant themselves every permission). Full admins bypass this.
 * Returns { ok: true, target } when the edit is allowed, otherwise
 * { status, body } describing the response to send.
 */
async function roleEditGuard(req, roleId) {
    const [rows] = await pool.query('SELECT id, name, is_system_role FROM roles WHERE id = ?', [roleId]);
    if (rows.length === 0) {
        return { status: 404, body: { success: false, error: 'Role not found' } };
    }
    const target = rows[0];
    if (isFullAdmin(req.user && req.user.role)) {
        return { ok: true, target };
    }
    const targetName = String(target.name || '').toLowerCase();
    if (target.is_system_role || FULL_ADMIN_ROLES.includes(targetName)) {
        return { status: 403, body: { success: false, error: 'Cannot modify permissions of a system or administrator role', code: 'ROLE_PROTECTED' } };
    }
    if (targetName === String((req.user && req.user.role) || '').toLowerCase()) {
        return { status: 403, body: { success: false, error: 'Cannot modify permissions of your own role', code: 'SELF_ESCALATION_BLOCKED' } };
    }
    return { ok: true, target };
}

// ==================== ROLES MANAGEMENT ====================

/**
 * GET /api/roles
 * List all roles
 */
router.get('/', requirePermission('roles', 'view'), async (req, res) => {
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
router.get('/permissions/all', requirePermission('roles', 'view'), async (req, res) => {
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
router.get('/permissions/by-module', requirePermission('roles', 'view'), async (req, res) => {
    try {
        const [permissions] = await pool.query('SELECT * FROM permissions ORDER BY module, action');

        const grouped = {};
        permissions.forEach(perm => {
            if (!grouped[perm.module]) {
                grouped[perm.module] = [];
            }
            // Auto-generate display_name if missing
            if (!perm.display_name) {
                const action = perm.action.replace(/_/g, ' ');
                perm.display_name = action.charAt(0).toUpperCase() + action.slice(1);
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
router.get('/:id', requirePermission('roles', 'view'), async (req, res) => {
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

        await audit.record(req, {
            action: 'role.create',
            entity_type: 'role',
            entity_id: result.insertId,
            before: null,
            after: { id: result.insertId, name, display_name, user_type, status: status || 'active', price_markup_percent, default_discount_percent }
        });

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

        const [roles] = await pool.query('SELECT * FROM roles WHERE id = ?', [id]);
        if (roles.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Role not found'
            });
        }
        const before = roles[0];

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

        const [afterRows] = await pool.query('SELECT * FROM roles WHERE id = ?', [id]);
        await audit.record(req, {
            action: 'role.update',
            entity_type: 'role',
            entity_id: id,
            before,
            after: afterRows[0],
        });

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

        // Capture full role row + perm count for audit before deletion
        const [beforeRoles] = await pool.query('SELECT * FROM roles WHERE id = ?', [id]);
        const [permCount] = await pool.query('SELECT COUNT(*) AS c FROM role_permissions WHERE role_id = ?', [id]);

        // Delete role permissions first, then role
        await pool.query('DELETE FROM role_permissions WHERE role_id = ?', [id]);
        await pool.query('DELETE FROM roles WHERE id = ?', [id]);

        await audit.record(req, {
            action: 'role.delete',
            entity_type: 'role',
            entity_id: id,
            before: { ...beforeRoles[0], permissions_revoked: permCount[0].c },
            after: null
        });

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
router.get('/:id/permissions', requirePermission('roles', 'view'), async (req, res) => {
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

        const guard = await roleEditGuard(req, id);
        if (!guard.ok) {
            return res.status(guard.status).json(guard.body);
        }

        const [beforePerms] = await pool.query(
            'SELECT permission_id FROM role_permissions WHERE role_id = ?',
            [id]
        );
        const beforeIds = beforePerms.map(r => r.permission_id);

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

            await audit.record(req, {
                action: 'role.permissions.replace',
                entity_type: 'role',
                entity_id: id,
                before: { permission_ids: beforeIds },
                after: { permission_ids },
            });

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

        const guard = await roleEditGuard(req, id);
        if (!guard.ok) {
            return res.status(guard.status).json(guard.body);
        }

        const [r] = await pool.query(
            'INSERT IGNORE INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
            [id, permission_id]
        );

        if (r.affectedRows > 0) {
            await audit.record(req, {
                action: 'role.permissions.grant',
                entity_type: 'role',
                entity_id: id,
                before: null,
                after: { permission_id },
            });
        }

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

        const [r] = await pool.query(
            'DELETE FROM role_permissions WHERE role_id = ? AND permission_id = ?',
            [id, permission_id]
        );

        if (r.affectedRows > 0) {
            await audit.record(req, {
                action: 'role.permissions.revoke',
                entity_type: 'role',
                entity_id: id,
                before: { permission_id },
                after: null,
            });
        }

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
