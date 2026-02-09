/**
 * Permission Enforcement Middleware
 * Validates user permissions for protected routes
 * Fixed: SQL injection, variable reference errors, pool sharing
 */

let pool;

/**
 * Initialize middleware with shared database pool
 */
function initPool(dbPool) {
    pool = dbPool;
}

/**
 * Check if user has specific permission
 * @param {string} module - Module name (e.g., 'products', 'customers')
 * @param {string} action - Action name (e.g., 'view', 'add', 'edit', 'delete')
 */
function requirePermission(module, action) {
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
                `SELECT s.*, u.id as user_id, u.username, u.role, u.full_name, u.email, u.branch_id
                 FROM user_sessions s
                 JOIN users u ON s.user_id = u.id
                 WHERE s.session_token = ? AND s.expires_at > NOW() AND u.status = 'active'`,
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
                email: user.email,
                branch_id: user.branch_id || null
            };

            // Admin role has all permissions
            if (user.role === 'admin') {
                return next();
            }

            // Check role_permissions table using parameterized queries
            try {
                const [permissions] = await pool.query(
                    `SELECT rp.id
                     FROM role_permissions rp
                     JOIN permissions p ON rp.permission_id = p.id
                     JOIN roles r ON rp.role_id = r.id
                     WHERE r.name = ?
                     AND p.module = ?
                     AND p.action = ?`,
                    [user.role, module, action]
                );

                if (permissions.length > 0) {
                    return next();
                }
            } catch (err) {
                // Tables might not exist yet - fall through to default check
            }

            // Default staff permissions for basic actions
            if (user.role === 'staff' && ['view', 'add'].includes(action)) {
                return next();
            }

            // Manager gets most permissions except delete/manage
            if (user.role === 'manager' && ['view', 'add', 'edit', 'approve'].includes(action)) {
                return next();
            }

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
 * @param {Array} permissionsNeeded - Array of {module, action} objects
 */
function requireAnyPermission(permissionsNeeded) {
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
                `SELECT s.*, u.id as user_id, u.username, u.role, u.full_name, u.email, u.branch_id
                 FROM user_sessions s
                 JOIN users u ON s.user_id = u.id
                 WHERE s.session_token = ? AND s.expires_at > NOW() AND u.status = 'active'`,
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
                email: user.email,
                branch_id: user.branch_id || null
            };

            // Admin has all permissions
            if (user.role === 'admin') {
                return next();
            }

            // Check role_permissions using parameterized queries (FIXED: no SQL injection)
            try {
                const [roleInfo] = await pool.query(
                    'SELECT id FROM roles WHERE name = ? LIMIT 1',
                    [user.role]
                );

                if (roleInfo.length > 0) {
                    // Build parameterized query for multiple permission checks
                    const placeholders = permissionsNeeded.map(() => '(p.module = ? AND p.action = ?)').join(' OR ');
                    const params = [roleInfo[0].id];
                    permissionsNeeded.forEach(p => {
                        params.push(p.module, p.action);
                    });

                    const [userPermissions] = await pool.query(
                        `SELECT rp.id
                         FROM role_permissions rp
                         JOIN permissions p ON rp.permission_id = p.id
                         WHERE rp.role_id = ?
                         AND (${placeholders})`,
                        params
                    );

                    if (userPermissions.length > 0) {
                        return next();
                    }
                }
            } catch (err) {
                // Tables might not exist
            }

            // Default: staff view/add
            if (user.role === 'staff') {
                const hasBasicPermission = permissionsNeeded.some(p =>
                    p.action === 'view' || p.action === 'add'
                );
                if (hasBasicPermission) {
                    return next();
                }
            }

            return res.status(403).json({
                success: false,
                message: 'Access denied. Insufficient permissions',
                code: 'PERMISSION_DENIED',
                required_permissions: permissionsNeeded
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
            `SELECT s.*, u.id as user_id, u.username, u.role, u.full_name, u.email, u.branch_id
             FROM user_sessions s
             JOIN users u ON s.user_id = u.id
             WHERE s.session_token = ? AND s.expires_at > NOW() AND u.status = 'active'`,
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
            branch_id: user.branch_id || null,
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
 * Require specific role(s)
 */
function requireRole(...roles) {
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
                `SELECT s.*, u.id as user_id, u.username, u.role, u.full_name, u.email, u.branch_id
                 FROM user_sessions s
                 JOIN users u ON s.user_id = u.id
                 WHERE s.session_token = ? AND s.expires_at > NOW() AND u.status = 'active'`,
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
                email: user.email,
                branch_id: user.branch_id || null
            };

            if (!roles.includes(user.role)) {
                return res.status(403).json({
                    success: false,
                    message: `Access denied. Required role: ${roles.join(' or ')}`,
                    code: 'ROLE_DENIED'
                });
            }

            next();

        } catch (error) {
            console.error('Role check error:', error);
            res.status(500).json({
                success: false,
                message: 'Role check failed',
                code: 'ROLE_CHECK_ERROR'
            });
        }
    };
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
                return res.json({
                    success: true,
                    role: user.role,
                    is_admin: true,
                    permissions: []
                });
            }
        }

        // Get user's permissions from role_permissions
        let userPermissions = [];
        try {
            const [roleInfo] = await pool.query(
                'SELECT id FROM roles WHERE name = ? LIMIT 1',
                [user.role]
            );

            if (roleInfo.length > 0) {
                const [perms] = await pool.query(
                    `SELECT p.module, p.action, p.display_name
                     FROM role_permissions rp
                     JOIN permissions p ON rp.permission_id = p.id
                     WHERE rp.role_id = ?
                     ORDER BY p.module, p.action`,
                    [roleInfo[0].id]
                );
                userPermissions = perms;
            }
        } catch (err) {
            // Tables might not exist
        }

        res.json({
            success: true,
            role: user.role,
            is_admin: false,
            permissions: userPermissions
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
    initPool,
    requirePermission,
    requireAnyPermission,
    requireAuth,
    requireRole,
    getUserPermissions
};
