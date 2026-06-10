/**
 * Permission Enforcement Middleware
 * Validates user permissions for protected routes
 * Fixed: SQL injection, variable reference errors, pool sharing
 */

let pool;
const crypto = require('crypto');
const audit = require('../services/audit-log');

/**
 * Initialize middleware with shared database pool
 */
function initPool(dbPool) {
    pool = dbPool;
}

// ── A2: short-TTL LRU cache for the hottest queries in the app ──────────────
// The staff session lookup runs on EVERY authenticated request (it was
// copy-pasted in 4 middlewares — now shared via resolveStaffSession), and the
// role-permission check right behind it. Entries live ≤45s; revocation paths
// (logout, password reset, user deactivation, role-permission edits) call the
// invalidate*/clear* hooks below so a killed session or changed permission
// dies immediately, not at TTL.
// Keys are sha256(token) hex — the same value as the SQL's
// LOWER(SHA2(?,256)) — so raw tokens are never held in memory.
const AUTH_CACHE_TTL_MS = 45 * 1000;
const AUTH_CACHE_MAX = 500;
const sessionCache = new Map(); // sha256(token) -> { value: user, expiresAt }
const permCache = new Map();    // `${role}|${module}.${action}` -> { value: boolean, expiresAt }

function cacheGet(map, key) {
    const entry = map.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
        map.delete(key);
        return undefined;
    }
    // refresh recency (Map preserves insertion order → first key is oldest)
    map.delete(key);
    map.set(key, entry);
    return entry.value;
}

function cacheSet(map, key, value) {
    if (map.size >= AUTH_CACHE_MAX) {
        map.delete(map.keys().next().value);
    }
    map.set(key, { value, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });
}

function tokenCacheKey(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Resolve a staff Bearer token to the req.user shape (or null).
 * Single source of truth for the session lookup; cached ≤45s.
 * Misses are NOT cached — an invalid token re-hits the DB (rate limiters
 * bound that), so a just-created session is never blocked by a stale miss.
 */
async function resolveStaffSession(token) {
    const key = tokenCacheKey(token);
    const cached = cacheGet(sessionCache, key);
    if (cached) return cached;

    const [sessions] = await pool.query(
        `SELECT s.*, u.id as user_id, u.username, u.role, u.full_name, u.email, u.branch_id
         FROM user_sessions s
         JOIN users u ON s.user_id = u.id
         WHERE s.token_hash = LOWER(SHA2(?, 256)) AND s.expires_at > NOW() AND u.status = 'active'`,
        [token]
    );
    if (sessions.length === 0) return null;

    const u = sessions[0];
    const user = {
        id: u.user_id,
        username: u.username,
        role: u.role,
        full_name: u.full_name,
        email: u.email,
        branch_id: u.branch_id || null
    };
    cacheSet(sessionCache, key, user);
    return user;
}

/**
 * Cached role→permission check (both grants and denials cached ≤45s;
 * role-permission edits call clearPermissionCache()).
 */
async function hasRolePermission(role, module, action) {
    const key = `${role}|${module}.${action}`;
    const cached = cacheGet(permCache, key);
    if (cached !== undefined) return cached;

    const [permissions] = await pool.query(
        `SELECT rp.id
         FROM role_permissions rp
         JOIN permissions p ON rp.permission_id = p.id
         JOIN roles r ON rp.role_id = r.id
         WHERE r.name = ?
         AND p.module = ?
         AND p.action = ?`,
        [role, module, action]
    );
    const allowed = permissions.length > 0;
    cacheSet(permCache, key, allowed);
    return allowed;
}

/** Drop one session from the cache (logout). */
function invalidateSessionToken(token) {
    if (token) sessionCache.delete(tokenCacheKey(token));
}

/** Drop every cached session of a user (password reset, deactivation). */
function invalidateUser(userId) {
    for (const [key, entry] of sessionCache) {
        if (entry.value && entry.value.id === userId) sessionCache.delete(key);
    }
}

/** Drop all cached role-permission verdicts (role-permission edits). */
function clearPermissionCache() {
    permCache.clear();
}

/** Test hook + emergency reset. */
function clearAuthCache() {
    sessionCache.clear();
    permCache.clear();
}

/**
 * Roles that are treated as full administrators across the app.
 * - 'admin' is the canonical name in the users.role ENUM.
 * - 'administrator' is an alias used in some UIs / legacy data.
 * - 'super_admin' is the highest tier (also full admin).
 * Any of these passes admin-only / requireAdmin gates and bypasses
 * fine-grained permission checks.
 */
const FULL_ADMIN_ROLES = ['admin', 'administrator', 'super_admin'];
function isFullAdmin(role) {
    return !!role && FULL_ADMIN_ROLES.includes(String(role).toLowerCase());
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

            const user = await resolveStaffSession(token);
            if (!user) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid or expired session',
                    code: 'SESSION_EXPIRED'
                });
            }

            req.user = user;

            // Admin / administrator / super_admin always have all permissions
            if (isFullAdmin(user.role)) {
                return next();
            }

            if (await hasRolePermission(user.role, module, action)) {
                return next();
            }

            // SYS-009: audit the denied access attempt (req.user is populated here)
            audit.record(req, {
                action: 'PERMISSION_DENIED', entity_type: 'permission',
                entity_id: `${module}.${action}`,
                after: { role: req.user && req.user.role, module, action }
            });
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

            const user = await resolveStaffSession(token);
            if (!user) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid or expired session',
                    code: 'SESSION_EXPIRED'
                });
            }

            req.user = user;

            // Admin / administrator / super_admin always have all permissions
            if (isFullAdmin(user.role)) {
                return next();
            }

            // Any one matching permission passes (per-pair, so each verdict
            // lands in the shared cache instead of one throwaway OR query)
            for (const p of permissionsNeeded || []) {
                if (await hasRolePermission(user.role, p.module, p.action)) {
                    return next();
                }
            }

            // SYS-009: audit the denied access attempt (req.user is populated here)
            audit.record(req, {
                action: 'PERMISSION_DENIED', entity_type: 'permission',
                entity_id: (permissionsNeeded || []).map(p => `${p.module}.${p.action}`).join(','),
                after: { role: req.user && req.user.role, required: permissionsNeeded }
            });
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

        const user = await resolveStaffSession(token);
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired session',
                code: 'SESSION_EXPIRED'
            });
        }

        req.user = user;
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
 * Require specific role(s).
 * If 'admin' appears in the list, 'administrator' and 'super_admin' are also accepted
 * (they are aliases / higher tiers of the admin role).
 */
function requireRole(...roles) {
    let flatRoles = roles.flat().map(r => String(r).toLowerCase());
    if (flatRoles.includes('admin')) {
        // Auto-include admin aliases so callers don't have to remember to list them
        for (const alias of FULL_ADMIN_ROLES) {
            if (!flatRoles.includes(alias)) flatRoles.push(alias);
        }
    }
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

            const user = await resolveStaffSession(token);
            if (!user) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid or expired session',
                    code: 'SESSION_EXPIRED'
                });
            }

            req.user = user;

            if (!flatRoles.includes(String(user.role || '').toLowerCase())) {
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

        // Shared resolver (A2). Note: unlike the old inline lookup here, this
        // also requires u.status = 'active' — an intentional tightening so a
        // deactivated user can't list permissions.
        const user = await resolveStaffSession(token);
        if (!user) {
            return res.status(401).json({
                success: false,
                message: 'Invalid or expired session'
            });
        }

        // Admin / administrator / super_admin have all permissions
        if (isFullAdmin(user.role)) {
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
    getUserPermissions,
    isFullAdmin,
    FULL_ADMIN_ROLES,
    // A2 cache hooks
    resolveStaffSession,
    invalidateSessionToken,
    invalidateUser,
    clearPermissionCache,
    clearAuthCache
};
