# CLAUDE.md — QC Paint Shop Business Manager

Guidance for Claude Code when working in this repository. Derived from a real
read-only audit (see `COMPLETION_STATUS.md`). Only documents things verified in
the actual codebase.

---

## 1. Project overview

Internal business-management platform for a paint retail/dealer business
(`act.qcpaintshop.com`). Handles staff/attendance/salary, leads & collections,
estimates & billing, a painter loyalty program, Zoho Books/CRM sync, WhatsApp
marketing, and an AI dashboard. There is also a separate **Android app** repo at
`..\qcpaintshop-android\` (local only, no git remote) — not in this repo.

## 2. Tech stack & key paths

- **Runtime:** Node.js v24, **Express 5**, Socket.IO v4 (`http.createServer`).
- **DB:** MySQL/MariaDB via `mysql2/promise`. DB name: `qc_business_manager`.
  Pool (20 conns) created in `config/database.js`; **session timezone forced to
  `+00:00` (UTC)** — the server clock is IST, so this offset is load-bearing.
- **Frontend:** static HTML + vanilla JS + Tailwind (JIT) in `public/`.
- **Entry point:** `server.js` (~4,350 lines). Routes in `routes/`, business
  logic in `services/`, cross-cutting in `middleware/`, env in `config/`.
- **Schema:** incremental only — `migrations/` (118 files) run by `migrate.js`.
  There is **no single schema.sql**; read migrations to learn tables.
- **Docs:** `Skills.md` is the comprehensive living system doc — update it after
  substantial changes. `COMPLETION_STATUS.md` is the latest audit.

### Common commands
```bash
npm start                 # node server.js
npm test                  # jest (tests/unit + tests/integration)
npm run test:coverage     # coverage (currently only middleware/config/anomaly)
node migrate.js --status  # NOTE: prod _migrations only tracks Apr 30+ → over-reports pending
node migrate.js           # run pending migrations
npm run lint              # eslint
npm run build:css         # tailwind → public/css/tailwind.css
```

## 3. How the app is wired

- One pool is created in `server.js` and injected everywhere via
  `routeModule.setPool(pool)` (`server.js:273-376`). New route files must follow
  this pattern — do **not** create a second pool.
- Routes mounted at `server.js:394-438` under `/api/*`.
- Global middleware: helmet (CSP currently allows `unsafe-inline`/`unsafe-eval`),
  CORS (env whitelist via `CORS_ORIGIN`, no `*`), compression, 3-tier rate
  limiting (global 100/min, auth 10/min, OTP 5/min), PII gate on
  `/uploads/aadhar` + `/uploads/documents` (`server.js:249-267`).
- **Background schedulers** (sync, geofence auto-clockout, anomaly scan, lead
  auto-assign, painter/AI/WhatsApp) only start if **`ZOHO_ORGANIZATION_ID`** is
  set (`server.js:~4298`). Keep this in mind when something "doesn't run".

## 4. Auth model (three separate systems)

| Actor | Header / flow | Middleware | Store |
|-------|---------------|------------|-------|
| Staff/Admin | `Authorization: Bearer <token>`, password+bcrypt, optional TOTP | `requireAuth`, `requirePermission(module,action)`, `requireRole` in `middleware/permissionMiddleware.js` | `user_sessions` |
| Customer | Bearer, phone OTP | `requireCustomerAuth` (`middleware/customerAuth.js`) | `customer_sessions` |
| Painter | `X-Painter-Token`, phone OTP | `requirePainterAuth` (approved) / `requirePainterSession` (pending+approved) in `routes/painters.js` | `painter_sessions` |

- Tokens are opaque `crypto.randomBytes(32)`, stored as `LOWER(SHA2(token,256))`.
  Lookups compare the hash — keep that exact form.
- `admin` / `administrator` / `super_admin` bypass all permission checks
  (`FULL_ADMIN_ROLES`).

## 5. Coding conventions (match existing style)

- **SQL:** always parameterized with `?` placeholders. For dynamic `SET`/`WHERE`,
  build an array of `?` clauses + a separate `params` array (see
  `routes/estimates.js`). **Never** interpolate user input into SQL strings.
- **Money:** native JS floats with `Math.round(x*100)/100`; money rounded up to
  ₹10 via `r10 = n => Math.ceil(n/10)*10`. (Known defects — see §6.)
- **Frontend XSS:** escape before `innerHTML`. Helpers exist but names are
  inconsistent (`escHtml` / `escapeHtml` / `esc`) — reuse the one already in the
  page you're editing.
- **Errors:** centralized handler suppresses stack traces in production; console
  errors are buffered into `global._appErrorBuffer`.
- **Brand colors:** Admin `#667eea→#764ba2`; Staff & Painter `#1B5E3B` green +
  gold `#D4A24E`. **No purple** in staff/painter pages.
- Async/await + `mysql2/promise` throughout. Keep new code consistent with the
  surrounding file rather than introducing new patterns.

## 6. Critical business logic — DO NOT change without a test first

These are money/correctness paths. Write a characterization test that locks the
current behavior **before** editing, then change deliberately.

- **Estimate pricing engine** — `routes/estimates.js:46-131`
  (`calculateItemPricing`, `calculateEstimateTotals`). Known issues:
  double ₹10 rounding (line 95-97) and `gst_amount: 0` hardcoded (line 128).
  **The GST=0 may be intentional (Zoho prices are GST-inclusive) — confirm
  business intent before "fixing".**
- **Painter points engine** — `services/painter-points-engine.js` (regular vs
  annual pools, level multipliers, daily-bonus cap, clawback). Tier thresholds:
  bronze 0 / silver 5K / gold 25K / diamond 100K (no platinum).
- **Salary calc** — `routes/salary.js` (hourly-rate basis, Sunday OT, leave
  deductions). Has basis-inconsistency bugs noted in the audit.
- **DPL pricing** — `services/price-list-parser.js` → `services/dpl-catalog.js`
  → `routes/item-master.js`. Rate formula: `ceil(dpl * 1.18 * 1.10)`
  (18% GST × 10% markup).
- **Zoho sync** — `services/zoho-api.js`, `routes/zoho.js`. `cf_*` custom fields
  must be wrapped into `custom_fields:[{api_name,value}]` on update.

## 7. Production DB safety

- **Never run destructive SQL against production without showing the exact SQL
  first and getting explicit approval.** Prefer additive migrations
  (`ALGORITHM=INPLACE LOCK=NONE` where possible, MariaDB 10.11).
- Prod `_migrations` only tracks Apr 30 2026+; `--status` over-reports pending.
  For a pre-existing migration, mark it rather than re-running blindly.
- Deploy: `ssh hetzner "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && npm install && pm2 restart business-manager"`.

## 8. Workflow rules

1. **Plan first for big work.** For any multi-file feature, migration, or change
   to §6 logic: enter plan mode and get my approval before writing code.
2. **Evidence over "done".** Don't claim something works — show the actual test
   output / command result / curl response that proves it.
3. **Test-first for bug fixes.** Reproduce the bug with a failing test, then fix,
   then show the test passing.
4. **Don't touch production data** without showing the exact query for approval.
5. Keep secrets in `.env` (gitignored — verified not in git/history). Never
   hardcode credentials; never paste secret values into chat or commits.

## 9. Communication

- Reply to me in **Tamil**, with technical terms in English (file names, code,
  commands, SQL stay English). Be concise — lead with the answer.
- Commits, code comments, and docs stay in **English**.
- Commit message footer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`

## 10. Known gaps (see COMPLETION_STATUS.md for full list)

- ~15% test coverage; estimates/painter-points/auth/leads/zoho-sync untested.
- No auth-event audit logging; session IP/UA captured but never validated.
- Uploads validated by extension/mimetype only (no magic-byte check).
- UPI id hardcoded in `routes/estimates.js` / `routes/share.js`.
