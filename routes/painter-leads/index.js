/**
 * Painter Leads Routes — composition root.
 *
 * Mount order is load-bearing (Express matches in registration order):
 * shared (auth) -> api (endpoints, added in Task 3).
 *
 * All endpoints under /api/painter-leads require authentication; individual
 * handlers further enforce permissions via requirePermission. The api
 * sub-router is loaded lazily so this file can be wired in Task 2 before
 * the full endpoint set from Task 3 exists.
 */

const express = require('express');
const { requireAuth } = require('../../middleware/permissionMiddleware');
const shared = require('./shared');

const router = express.Router();

// Every painter-leads endpoint requires an authenticated staff/admin user.
// (Individual routes add requirePermission(module, action) gates.)
router.use(requireAuth);

// Mount the API sub-router when present (Task 3 will create routes/painter-leads/api.js).
// Until then, every request hits the requireAuth gate above and is rejected with 401.
let apiRoutes = null;
try {
    apiRoutes = require('./api');
    if (apiRoutes && apiRoutes.router) {
        router.use(apiRoutes.router);
    }
} catch (err) {
    if (err && err.code !== 'MODULE_NOT_FOUND') {
        // Real load error — surface it instead of silently masking.
        throw err;
    }
    // Module not yet created; intentionally non-fatal during incremental rollout.
}

function setPool(p) {
    shared.setPool(p);
    if (apiRoutes && typeof apiRoutes.setPool === 'function') {
        apiRoutes.setPool(p);
    }
    // Auto-heal permissions on deploy; failures are non-fatal (logged only).
    shared.ensurePainterLeadPermissions(p).catch(err => {
        console.log('[painter-leads] permission seed skipped:', err.message);
    });
}

module.exports = {
    router,
    setPool,
};
