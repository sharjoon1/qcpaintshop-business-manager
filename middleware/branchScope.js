/**
 * Branch-scope middleware for non-admin branch managers.
 *
 * Adds req.branchScope = { branchId: null | number }.
 * - Admins/superadmins: branchId = null (no filter)
 * - Managers: branchId = their branch (via branches.manager_id = users.id)
 * - Others: branchId = null
 *
 * Usage: router.get('/path', requirePermission(...), branchScope, handler)
 */
let pool;
function setPool(p) { pool = p; }

async function branchScope(req, res, next) {
    try {
        if (!req.user) { req.branchScope = { branchId: null }; return next(); }
        const role = (req.user.role || '').toLowerCase();
        if (role === 'admin' || role === 'superadmin') {
            req.branchScope = { branchId: null };
            return next();
        }
        if (role === 'manager') {
            const [rows] = await pool.query(
                `SELECT id FROM branches WHERE manager_id = ? AND is_active = 1 LIMIT 1`,
                [req.user.id]
            );
            req.branchScope = { branchId: rows[0]?.id || null };
            return next();
        }
        req.branchScope = { branchId: null };
        next();
    } catch (e) {
        console.error('[branchScope]', e);
        req.branchScope = { branchId: null };
        next();
    }
}

module.exports = { setPool, branchScope };
