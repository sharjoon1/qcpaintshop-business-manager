# Deep Audit & Fix Report — Web + Admin Panel + Android
**Date:** 2026-08-10
**Scope:** Full-codebase feature audit (Express backend, 170 HTML/JS frontend pages, 67 routes, 71 services) + Android repo (158 Kotlin files, 4 flavors).
**Baseline:** unit tests 86/86 suites · 1674 tests green · lint 0 errors/309 warnings (after fixes).

---

## A. Bugs FIXED (with evidence)

### A1. Runtime crash — Zoho bill attachment push  [MONEY-ADJACENT]
- `services/zoho-api.js::attachBillAttachment` referenced undefined `getBaseUrl()` /
  `getAccessToken()` → `ReferenceError` on EVERY vendor-bill-with-image push to Zoho
  (added in commit `2d1ea8e`, never worked). Fixed → `API_BASE` +
  `zohoOAuth.getAccessToken()`; dynamic `import('node-fetch')` replaced with a top-level
  require (v2.7.0) so Jest can mock it (dynamic import needs `--experimental-vm-modules`,
  which CI doesn't enable).
- Test: `tests/unit/zoho-api-attach-bill.test.js` (2 tests) — URL, bearer header,
  FormData body, Zoho error rejection. Also cleared the 2 `no-undef` lint errors.

### A2. Nine broken frontend → backend endpoint references (pages that always error)
Static cross-check of 1,069 frontend API refs against 1,082 mounted backend endpoints:

| Page | Was calling (404) | Fixed to |
|---|---|---|
| admin-system-hub.html | `/api/monitoring/summary` | `/api/monitoring/overview` |
| admin-salary-hub.html | `/api/salary/reports` | `/api/salary/reports/summary` + `data.summary` shape + field names (`total_gross_salary`/`total_net_salary`/`total_staff`) + month defaults to current |
| admin-work-hub.html | `/api/attendance` | `/api/attendance/report` (+ `full_name`/`clock_in_time`/`day_status` fields) |
| admin-work-hub.html | `/api/daily-tasks` | `/api/daily-tasks/admin/summary` (+ `data.submitted`, `user_name`/`task_date`/`X/Y tasks`) |
| admin-crm-hub.html | `/api/credit-limits` | `/api/credit-limits/customers` (+ `credit_used` field) |
| admin-catalog-hub.html | `/api/item-master` | `/api/item-master/items` (+ `search` param, `data.items`, `zoho_*` fields) |
| admin-geofence-logs.js | `/api/staff?role=staff` | `/api/users?role=staff` (+ bare-array response handling) |
| admin-growth-hub.html | `/api/wa/status`, `/api/whatsapp/status` | `/api/zoho/whatsapp-sessions/admin/status` (+ `data.status`/`data.phone_number`) |

Each fix was verified against the actual backend response shape (not guessed).

### A3. Broken page links (staff nav 404)
- `staff-estimates.html` + `staff-requests.html`: `staff-dashboard.html` → `staff/dashboard.html`;
  `staff-profile.html` → `admin-profile.html` (matches staff/dashboard.html's own profile link).

### A4. Backlog security items (Phase E)
- **E-7** bodyless / no-Content-Type POST → 500 TypeError on OTP/auth handlers
  (`req.body` undefined). Fixed systemically with a `req.body = {}` normalizer middleware in
  `server.js` right after `express.json()` (protects all routes, incl. `routes/auth.js:28`
  login destructure + `routes/painters/public.js:222` + `routes/engineers.js:130/183`).
  Test: `tests/unit/e7-bodyless-request.test.js` (4 tests).
- **E-5** hardcoded UPI VPA fallback (`services/business-config.js`) now env-overridable
  (`BUSINESS_UPI_VPA` / `BUSINESS_UPI_PAYEE`); `ai_config` DB rows still take precedence.
  Existing `business-config.test.js` still passes.
- **E-1** uploads now validate magic bytes, not just mimetype/extension:
  - `config/uploads.js` rewritten — `magicByteStorage` (buffers first 16 bytes of the stream
    and rejects mismatches before writing) for all disk uploads; buffer-based checks for the
    4 memory uploads; DPL PDF uses a dynamic-destination magic-gated storage.
  - New exports: `isImageContent`, `isPdfContent`, `isCsvOrTextContent`, `matchesMagic`,
    `magicByteStorage`. Test: `tests/unit/e1-magic-byte-upload.test.js` (6 tests).
- **E-3** (customer OTP audit) — **already fixed in code** (`CUSTOMER_LOGIN_SUCCESS` /
  `CUSTOMER_LOGIN_FAILED` in `routes/customer-portal.js`); no action needed.
- **E-4** (painter raw token dual-write) — left as-is: the INSERT comment documents it as a
  deliberate rollback-safety dual-write; reads use the hash. Changing it needs an owner call.

### A5. UI permission-gating bug — pending product requests
- `GET /api/item-master/pending-requests` now returns `canApprove`
  (`isFullAdmin(role) || hasRolePermission(role,'products','manage')`); the admin catalog hub
  hides Approve/Reject buttons for staff (they previously saw buttons that always 403'd).
  Exported `hasRolePermission` from `middleware/permissionMiddleware.js`.

### A6. CI gate fix
- `tests/unit/brand-config.test.js` is a **real-DB integration test** sitting in the unit
  folder → `npx jest tests/unit --ci` (the exact CI command) failed on GitHub Actions (no
  MySQL service). Moved to `tests/integration/`. Unit set now fully green.

---

## B. Audited, no change needed (verified safe)

- **ORDER BY interpolation** (9 sites) — all go through whitelist maps
  (`allowedSorts`/`sortMap`/`getSortColumn`/explicit ifs). No SQL injection.
- **SQL template interpolation** (74 sites) — the documented whitelisted dynamic-SET pattern
  with `?` params. No injection.
- **Missing-await scan** (38 flagged) — all inside `Promise.all([...])`; no floating queries.
- **Frontend element-ID mismatches** (39 flagged) — all guarded (`if (!el)`) or injected via
  innerHTML. No broken UI refs.
- **Android ↔ backend API contract: 46/46 Retrofit endpoints match** the mounted painter
  routes. No hardcoded secrets; release cleartext disabled.
- **E-7 root pattern** verified across all OTP handlers.
- **estimate-requests / estimates push-to-Zoho flows** — frontend refs match backend routes.

## C. Findings FLAGGED (need owner decision / systemic — not silently changed)

1. **UTC "today" boundary** — 28 call sites use `new Date().toISOString().split('T')[0]`; the
   DB session is forced UTC, so reads/writes are internally consistent but the business "day"
   rolls at **5:30 AM IST**. Attendance (`getTodayIST`) is the exception (IST-based). Low
   real-world impact; a mass change is risky without per-module tests. Recommend an owner
   decision before touching.
2. **E-2 (session IP/UA never validated)** — systemic change across 4 auth systems; not done
   here. Suggest a follow-up: capture-IP/UA-at-login + alert-on-drift.
3. **Orphaned pages** not linked from any nav: `admin-growth-hub.html`, `birla-opus-report.html`,
   `estimate-edit.html`. Either wire into nav or archive.
4. **Android navigation stubs** (2 TODOs): Convert-to-Quotation and edit-profile-photo actions
   are placeholders in the painter app (`AppNavigation.kt:288`, `ProfileScreen.kt:103`) —
   painter v5 scope, needs Android-side work (no JDK on this machine to build/verify).
5. **`500` handlers leak `err.message`** to clients in many routes (info disclosure, low risk,
   pervasive pattern) — suggest a centralized redaction pass.

## D. Files changed
```
config/uploads.js, services/zoho-api.js, services/business-config.js, server.js,
routes/item-master.js, middleware/permissionMiddleware.js,
public/admin-system-hub.html, admin-salary-hub.html, admin-work-hub.html,
admin-crm-hub.html, admin-catalog-hub.html, admin-growth-hub.html,
js/pages/admin-geofence-logs.js, staff-estimates.html, staff-requests.html
tests/unit/zoho-api-attach-bill.test.js (new), tests/unit/e7-bodyless-request.test.js (new),
tests/unit/e1-magic-byte-upload.test.js (new), tests/integration/brand-config.test.js (moved)
```

## E. How to verify
```bash
npx jest tests/unit          # 86 suites / 1674 tests — green (this is the CI command)
npm run lint                 # 0 errors
# DB-backed (local MySQL required):
npx jest tests/integration   # brand-config + painter flows
```
