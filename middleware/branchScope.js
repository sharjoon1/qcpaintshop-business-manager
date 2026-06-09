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
            // Managers are scoped to their assigned branch (users.branch_id, already on
            // req.user). The previous `branches.manager_id` lookup matched no such column,
            // so branchScope silently returned null and managers saw ALL-branch data —
            // branch isolation was off. Use the manager's own branch_id.
            req.branchScope = { branchId: req.user.branch_id || null };
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
