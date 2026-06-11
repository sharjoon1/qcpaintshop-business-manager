/**
 * Painter Management Routes — composition root (A8a split of routes/painters.js).
 * Public, Painter-Auth, and Admin endpoints for the painter loyalty system.
 *
 * Mount order is load-bearing (Express matches in registration order):
 * public -> painter -> admin, with original relative order kept inside each
 * sub-router (verified by scripts/check-route-shadowing.js).
 *
 * Module API is identical to the old routes/painters.js single file —
 * server.js and the unit tests require('./routes/painters') unchanged.
 */

const express = require('express');
const shared = require('./shared');
const middleware = require('./middleware');
const publicRoutes = require('./public');
const painterRoutes = require('./painter');
const adminRoutes = require('./admin');

const router = express.Router();
router.use(publicRoutes.router);
router.use(painterRoutes.router);
router.use(adminRoutes.router);

function setPool(p) {
    shared.setPool(p); // keeps the original fan-out (points engine, zoho, attendance, idempotency)
    middleware.setPool(p);
    publicRoutes.setPool(p);
    painterRoutes.setPool(p);
    adminRoutes.setPool(p);
}

function setIO(ioInstance) {
    shared.setIO(ioInstance);
    painterRoutes.setIO(ioInstance);
}

function setSessionManager(sm) {
    shared.setSessionManager(sm);
    publicRoutes.setSessionManager(sm);
    adminRoutes.setSessionManager(sm);
}

// requirePainterAuth/requirePainterSession exported for unit testing only
// (tests/unit/auth-middleware.test.js) — routes still use them directly.
// toISTDateString exported for unit testing only (tests/unit/painter-location.test.js).
module.exports = {
    router,
    setPool,
    setIO,
    setSessionManager,
    requirePainterAuth: middleware.requirePainterAuth,
    requirePainterSession: middleware.requirePainterSession,
    toISTDateString: shared.toISTDateString,
};
