# Plan — Extract auth + OTP + customer-auth from server.js

**Goal.** Move ~1,100 LOC of route handlers currently inlined in `server.js` into three dedicated route modules so server.js drops below 3,500 LOC and the auth surface gets a stable home.

**Why not done in the same session.** A subtle break in this code locks every user out. I can't run the server, jest, or hit the auth flow in WSL (sharp native-binary mismatch). This plan moves the analysis work off your plate so the actual edits can be done in a single short Windows session with the dev server running.

**Tech assumed.** Express 4, mysql2/promise pool exported via `setPool()` (same pattern as every other route module — see `routes/leads.js`, `routes/zoho.js`).

---

## What's moving

The full list of endpoints currently inlined in `server.js`. Line numbers from HEAD at the time of writing — re-grep after pulling.

### `routes/auth.js` — new module (~510 LOC, target)

| server.js line | Endpoint |
|---:|---|
| 462 | POST `/api/auth/login` |
| 530 | POST `/api/auth/login-2fa` |
| 584 | GET `/api/auth/verify` |
| 626 | GET `/api/auth/me` |
| 702 | POST `/api/auth/logout` |
| 718 | POST `/api/auth/forgot-password` |
| 804 | POST `/api/auth/forgot-password-mobile` |
| 857 | GET `/api/auth/validate-reset-token` |
| 880 | POST `/api/auth/reset-password` |
| 927 | GET `/api/auth/permissions` |
| 1267 | POST `/api/auth/register` |

End of slice: just after `app.post('/api/auth/register', ...)` closes. Confirm by grep.

### `routes/otp.js` — new module (~330 LOC, target)

| server.js line | Endpoint |
|---:|---|
| 934 | POST `/api/otp/send` |
| 1107 | POST `/api/otp/verify` |
| 1150 | POST `/api/otp/resend` |

### `routes/customer-auth.js` — new module (~250 LOC, target)

| server.js line | Endpoint |
|---:|---|
| 3382 | POST `/api/customer/auth/send-otp` |
| 3467 | POST `/api/customer/auth/verify-otp` |
| 3529 | POST `/api/customer/auth/logout` |
| 3540 | GET `/api/customer/auth/me` |

---

## Dependencies the handlers reach for

Confirmed by grep on the source slices. Every dependency is already a require() at the top of server.js — the new modules will require them the same way.

- `mysql2/promise` pool (via `setPool` injection)
- `bcrypt`
- `crypto`
- `jsonwebtoken` — only if your auth uses JWTs; current code uses opaque session tokens hashed in DB, so probably not needed
- `nodemailer` (or the `email-service`) for forgot-password email
- `authLimiter`, `otpLimiter` from `middleware/rateLimiter`
- `requirePermission`, `requireAuth`, `requireRole`, `getUserPermissions`, `isFullAdmin` from `middleware/permissionMiddleware`
- `requireCustomerAuth` from `middleware/customerAuth`
- `customerAuthService` from `services/customer-auth`
- `notificationService` from `services/notification-service`
- `audit` from `services/audit-log`
- SMS sender utility (currently inlined in `server.js` around the forgot-password-mobile + customer OTP handlers — verify before moving and either extract to `services/sms-service.js` first, or move as a private helper inside the route module)

**Important:** before moving, grep server.js for the symbol `sendSms` or whatever the local helper is named near line ~1130 and ~3400. If it's inlined, hoist it once into `services/sms-service.js` as a prep commit so both `routes/otp.js` and `routes/customer-auth.js` can require it. Avoid duplicating it in both modules.

---

## Module shape (template — copy from existing modules)

```js
// routes/auth.js
const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { authLimiter } = require('../middleware/rateLimiter');
const { requirePermission, requireAuth, requireRole, getUserPermissions, isFullAdmin } = require('../middleware/permissionMiddleware');
const emailService = require('../services/email-service');
const audit = require('../services/audit-log');

let pool;
function setPool(dbPool) { pool = dbPool; }

// ── POST /login ───────────────────────────────────────────────────────────────
router.post('/login', authLimiter, async (req, res) => { /* ... verbatim from server.js ... */ });

// ── POST /login-2fa ──────────────────────────────────────────────────────────
router.post('/login-2fa', authLimiter, async (req, res) => { /* ... */ });

// ... etc.

module.exports = { router, setPool };
```

**Path rewrite.** Strip the `/api/auth` prefix from every route definition — the mount in server.js adds it back. So `app.post('/api/auth/login', ...)` becomes `router.post('/login', ...)`.

Same for `/api/otp/*` → mount `app.use('/api/otp', otpRoutes.router)` and rewrite to `router.post('/send', ...)` etc.

Same for `/api/customer/auth/*` → mount `app.use('/api/customer/auth', customerAuthRoutes.router)` and rewrite to `router.post('/send-otp', ...)` etc.

---

## Server.js wiring

Add three requires near the top with the other route modules:

```js
const authRoutes = require('./routes/auth');
const otpRoutes = require('./routes/otp');
const customerAuthRoutes = require('./routes/customer-auth');
```

Add three `setPool` calls in the init block (around line 240+ where the other `setPool`s live):

```js
authRoutes.setPool(pool);
otpRoutes.setPool(pool);
customerAuthRoutes.setPool(pool);
```

Add three mounts in the routing block (near line 436, alongside the existing mounts):

```js
app.use('/api/auth', authRoutes.router);
app.use('/api/otp', otpRoutes.router);
app.use('/api/customer/auth', customerAuthRoutes.router);
```

Then delete the inlined handler bodies in server.js.

---

## Three commits, not one

Don't try to land all three modules in a single commit — each is independently verifiable, and a single bad commit locks the world out.

### Commit 1 — `routes/auth.js`

1. Create file with the template above.
2. Cut handlers from `server.js` (lines 462–928 + 1267–end-of-register) and paste into the new file, rewriting paths.
3. Wire `setPool` + mount in server.js.
4. Delete the old inlined handlers in server.js.
5. `node --check server.js routes/auth.js`
6. Start the dev server.
7. **Smoke test from a browser:** POST `/api/auth/login`, GET `/api/auth/me`, POST `/api/auth/logout`. Each should respond identically to before. If any fails, `git restore` and re-read the cut/paste.
8. Commit. Push to a branch and pull on staging before main.

### Commit 2 — `routes/otp.js`

Same procedure. Cut lines 934–1265. Smoke-test send/verify/resend.

If `sendSms` was inlined: do the `services/sms-service.js` extraction as a separate prep commit first.

### Commit 3 — `routes/customer-auth.js`

Same procedure. Cut lines 3382–3633. Smoke-test customer login flow end-to-end (send-otp, verify-otp, /me, logout).

---

## Snags to watch for

- **`req.user` middleware ordering.** `requireAuth` populates `req.user`. If you forgot to apply it on a route that uses `req.user.id`, the handler throws. Most of these handlers do their own session lookup (look for `authenticateRequest()` patterns) — preserve that. Don't sprinkle `requireAuth` on a handler that does its own auth.
- **Token-via-query-param.** `/api/auth/validate-reset-token` and the offer-letter download accept the token in `?token=`. Keep this — some flows depend on `<a href>` and `window.open` which can't set headers.
- **`audit.log()` calls.** Several handlers call `audit.log(...)` for compliance. Move these verbatim with their context (some take `req.ip`, `req.headers['user-agent']`, etc.).
- **Shared helper variables.** If any of these handlers reference a top-of-file `const` in server.js that isn't already required externally (e.g. `const SOMETHING = require(...)`), move that require into the new module too.
- **2FA flow.** `POST /api/auth/login` returns `{ requires_2fa: true, temp_token: ... }` for users with 2FA enabled. The temp_token must be valid only for `/api/auth/login-2fa`. Both handlers live in `routes/auth.js`, so this stays cohesive.
- **`customerAuthService.setPool(pool)`** is already called in server.js — don't remove it just because you moved the customer-auth routes. The service is still used elsewhere.
- **Don't touch `app.post('/api/auth/permissions', getUserPermissions)`.** That handler is just `getUserPermissions` directly from the middleware module — it has no body. Keep the line in server.js OR move it cleanly via `router.get('/permissions', getUserPermissions)`.

---

## When NOT to do this

- During a deploy freeze.
- If `tests/` has no auth-flow coverage (it doesn't — see `tests/unit/` and grep for `auth` test files; the only relevant one is for the password reset token, not the login flow).
- If you're about to ship a feature touching auth.

Otherwise this is a high-value, low-novelty refactor — moves load-bearing code to a discoverable place without changing behavior. After all three land, `server.js` should be ~3,250 LOC and the team gets clean seams for the next round of audit work (the same pattern unlocks extracting `products`, `users`, `design-requests`, etc., listed in the architecture audit).

---

## Followup tasks unblocked by this

Once auth/OTP/customer-auth are out:

- Extract `routes/products.js` (server.js L2760–3349, ~590 LOC).
- Extract `routes/design-requests.js` (server.js L1494–1890, ~400 LOC).
- Extract `routes/users.js` (server.js L2334–2705, ~370 LOC).
- Extract `routes/customer-self.js` (server.js L3636–3714, ~80 LOC — depends on customer-auth being out first).

Server.js would then drop from 4,356 LOC to about 1,900 — almost entirely the socket.io setup, paint-catalog static reads, calculate endpoint, and the wiring block. From there the composition-root cleanup (the 19 setIO calls and 45 setter functions called out in the architecture audit) becomes straightforward.
