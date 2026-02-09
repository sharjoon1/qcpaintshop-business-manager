/**
 * Permission Enforcement Middleware
 * Validates user permissions for protected routes
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10
});

/**
 * Check if user has specific permission
 * @param {string} module - Module name (e.g., 'products', 'customers')
 * @param {string} action - Action name (e.g., 'view', 'add', 'edit', 'delete')
 */
function requirePermission(module, action) {
    return async (req, res, next) => {
        try {
            // Get token from header
            const token = req.headers.authorization?.replace('Bearer ', '');
            
            if (!token) {
                return res.status(401).json({ 
                    success: false, 
                    message: 'Authentication required',
                    code: 'AUTH_REQUIRED'
                });
            }

            // Get user from session
            const [sessions] = await pool.query(
                `SELECT s.*, u.id as user_id, u.username, u.role, u.full_name, u.email
                 FROM user_sessions s 
                 JOIN users u ON s.user_id = u.id 
                 WHERE s.session_token = ? AND s.expires_at > NOW()`,
                [token]
            );

            if (sessions.length === 0) {
                return res.status(401).json({ 
                    success: false, 
                    message: 'Invalid or expired session',
                    code: 'SESSION_EXPIRED'
                });
            }

            const user = sessions[0];

            // Attach user to request for later use
            req.user = {
                id: user.user_id,
                username: user.username,
                role: user.role,
                full_name: user.full_name,
                email: user.email,
                branch_id: user.branch_id || null
            };

            // Admin role has all permissions
            if (user.role === 'admin') {
                return next();
            }

            // Staff role: check if they have permission via role_permissions table
            if (user.role === 'staff') {
                // Try to get role_id from roles table if it exists
                const [roleInfo] = await pool.query(
                    `SELECT id FROM roles WHERE name = 'staff' LIMIT 1`
                );
                
                if (roleInfo.length > 0) {
                    const roleId = roleInfo[0].id;
                    
                    // Check if user has the required permission
                    const [permissions] = await pool.query(
                        `SELECT rp.* 
                         FROM role_permissions rp
                         JOIN permissions p ON rp.permission_id = p.id
                         WHERE rp.role_id = ? 
                         AND p.module = ? 
                         AND p.action = ?`,
                        [roleId, module, action]
                    );

                    if (permissions.length > 0) {
                        return next();
                    }
                }
                
                // Default staff permissions for common actions
                const staffAllowedActions = ['view', 'add'];
                if (staffAllowedActions.includes(action)) {
                    return next();
                }
            }

            // Permission denied
            return res.status(403).json({ 
                success: false, 
                message: `Access denied. Required permission: ${module}.${action}`,
                code: 'PERMISSION_DENIED',
                required_permission: { module, action }
            });

        } catch (error) {
            console.error('Permission check error:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Permission check failed',
                code: 'PERMISSION_CHECK_ERROR'
            });
        }
    };
}

/**
 * Check if user has any of the specified permissions
 * @param {Array} permissions - Array of {module, action} objects
 */
function requireAnyPermission(permissions) {
    return async (req, res, next) => {
        try {
            const token = req.headers.authorization?.replace('Bearer ', '');
            
            if (!token) {
                return res.status(401).json({ 
                    success: false, 
                    message: 'Authentication required',
                    code: 'AUTH_REQUIRED'
                });
            }

            const [sessions] = await pool.query(
                `SELECT s.*, u.id as user_id, u.username, u.role, u.full_name, u.email
                 FROM user_sessions s 
                 JOIN users u ON s.user_id = u.id 
                 WHERE s.session_token = ? AND s.expires_at > NOW()`,
                [token]
            );

            if (sessions.length === 0) {
                return res.status(401).json({ 
                    success: false, 
                    message: 'Invalid or expired session',
                    code: 'SESSION_EXPIRED'
                });
            }

            const user = sessions[0];
            req.user = {
                id: user.user_id,
                username: user.username,
                role: user.role,
                full_name: user.full_name,
                email: user.email
            };

            // Admin has all permissions
            if (user.role === 'admin') {
                return next();
            }

            // Staff role: grant basic permissions, or check permissions table if exists
            if (user.role === 'staff') {
                // Grant view/add permissions by default for staff
                const hasBasicPermission = permissions.some(p => 
                    p.action === 'view' || p.action === 'add'
                );
                
                if (hasBasicPermission) {
                    return next();
                }
            }

            // For more complex permission checks, try role_permissions table
            try {
                const [roleInfo] = await pool.query(
                    `SELECT id FROM roles WHERE name = ? LIMIT 1`,
                    [user.role]
                );
                
                if (roleInfo.length > 0) {
                    const permissionChecks = permissions.map(p => 
                        `(p.module = '${p.module}' AND p.action = '${p.action}')`
                    ).join(' OR ');

                    const [userPermissions] = await pool.query(
                        `SELECT rp.* 
                         FROM role_permissions rp
                         JOIN permissions p ON rp.permission_id = p.id
                         WHERE rp.role_id = ? 
                         AND (${permissionChecks})`,
                        [roleInfo[0].id]
                    );

                    if (userPermissions.length > 0) {
                        return next();
                    }
                }
            } catch (err) {
                // Roles table might not exist, continue
            }

            return res.status(403).json({ 
                success: false, 
                message: 'Access denied. Insufficient permissions',
                code: 'PERMISSION_DENIED',
                required_permissions: permissions
            });

        } catch (error) {
            console.error('Permission check error:', error);
            res.status(500).json({ 
                success: false, 
                message: 'Permission check failed',
                code: 'PERMISSION_CHECK_ERROR'
            });
        }
    };
}

/**
 * Require authentication only (no specific permission)
 */
async function requireAuth(req, res, next) {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                message: 'Authentication required',
                code: 'AUTH_REQUIRED'
            });
        }

        const [sessions] = await pool.query(
            `SELECT s.*, u.id as user_id, u.username, u.role, u.full_name, u.email
             FROM user_sessions s 
             JOIN users u ON s.user_id = u.id 
             WHERE s.session_token = ? AND s.expires_at > NOW()`,
            [token]
        );

        if (sessions.length === 0) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid or expired session',
                code: 'SESSION_EXPIRED'
            });
        }

        const user = sessions[0];
        req.user = {
            id: user.user_id,
            username: user.username,
            role: user.role,
            full_name: user.full_name,
            email: user.email
        };

        next();

    } catch (error) {
        console.error('Auth check error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Authentication check failed',
            code: 'AUTH_CHECK_ERROR'
        });
    }
}

/**
 * Get all permissions for the current user
 */
async function getUserPermissions(req, res) {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        
        if (!token) {
            return res.status(401).json({ 
                success: false, 
                message: 'Authentication required' 
            });
        }

        const [sessions] = await pool.query(
            `SELECT s.*, u.id as user_id, u.role, u.full_name
             FROM user_sessions s 
             JOIN users u ON s.user_id = u.id 
             WHERE s.session_token = ? AND s.expires_at > NOW()`,
            [token]
        );

        if (sessions.length === 0) {
            return res.status(401).json({ 
                success: false, 
                message: 'Invalid or expired session' 
            });
        }

        const user = sessions[0];

        // Admin has all permissions
        if (user.role === 'admin') {
            // Try to get all permissions from permissions table if it exists
            try {
                const [allPermissions] = await pool.query(
                    'SELECT module, action, display_name FROM permissions ORDER BY module, action'
                );
                
                return res.json({
                    success: true,
                    role: user.role,
                    is_admin: true,
                    permissions: allPermissions
                });
            } catch (err) {
                // Permissions table might not exist, return admin with all access
                return res.json({
                    success: true,
                    role: user.role,
                    is_admin: true,
                    permissions: []
                });
            }
        }

        // Get user's specific permissions from role_permissions if it exists
        try {
            const [roleInfo] = await pool.query(
                `SELECT id FROM roles WHERE name = ? LIMIT 1`,
                [user.role]
            );
            
            if (roleInfo.length > 0) {
                const [permissions] = await pool.query(
                    `SELECT p.module, p.action, p.display_name
                     FROM role_permissions rp
                     JOIN permissions p ON rp.permission_id = p.id
                     WHERE rp.role_id = ?
                     ORDER BY p.module, p.action`,
                    [roleInfo[0].id]
                );

                return res.json({
                    success: true,
                    role: user.role,
                    is_admin: false,
                    permissions: permissions
                });
            }
        } catch (err) {
            // Role/permissions tables might not exist
        }

        res.json({
            success: true,
            role: user.role,
            is_admin: false,
            permissions: permissions
        });

    } catch (error) {
        console.error('Get permissions error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to retrieve permissions' 
        });
    }
}

module.exports = {
    requirePermission,
    requireAnyPermission,
    requireAuth,
    getUserPermissions
};
