# E2E Test Plan (Playwright)

Status: **scaffolded**. Smoke runs green offline; flow specs are written but
self-skip until a test server + credentials are provided.

## Why the server is not auto-started
`server.js` boots cron schedulers, WhatsApp sessions and Zoho sync at startup.
E2E must run against a **dedicated, already-running** instance backed by a
**test database** — never the production process. The Playwright config does not
launch the app for this reason.

## Prerequisites to run the full flows
1. A test MySQL DB seeded with at least one staff user (and ideally one
   admin-with-2FA, one painter, one customer).
2. App running against that DB, e.g. `TEST_BASE_URL=http://localhost:3100`.
3. Credentials exported as env vars (see `tests/e2e/README.md`).

## Priority flows (by business risk)

| # | Flow | Spec file | Needs |
|---|------|-----------|-------|
| 0 | Login page renders (smoke) | `login.smoke.spec.js` ✅ | nothing (file://) |
| 1 | Staff login — valid → dashboard / 2FA; invalid → error | `login.flow.spec.js` (scaffold ✅) | server + staff creds |
| 2 | Role-based access — staff cannot open admin-only pages; admin can | _todo_ | server + staff & admin creds |
| 3 | Estimate create → save → reopen — line totals & grand total match the pricing engine (guards P0-1/P0-2 end-to-end) | _todo_ | server + product/zoho seed |
| 4 | Estimate record-payment — balance due updates, idempotency holds | _todo_ | server + estimate seed |
| 5 | Painter OTP login (test account `9999999999` / `123456` in non-prod) | _todo_ | server (NODE_ENV≠production) |
| 6 | Customer OTP login + view own estimates/invoices | _todo_ | server + customer seed |

## Sequencing
- Build #1 first (auth is the gate for everything else).
- #3/#4 are the highest-value once auth works — they cover the money paths that
  the Jest characterization tests cover at unit level, end-to-end.
- #2 protects the RBAC model (full-admin bypass + `requirePermission`).

## Commands
```bash
npm run test:e2e            # all e2e (smoke green; flows skip without env)
npm run test:e2e:smoke      # offline smoke only
TEST_BASE_URL=... TEST_STAFF_USER=... TEST_STAFF_PASS=... npm run test:e2e
```
