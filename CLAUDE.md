# CLAUDE.md — QC Paint Shop Business Manager

Guidance for Claude Code when working in this repository. Derived from a real
read-only audit (see `COMPLETION_STATUS.md`). Only documents things verified in
the actual codebase.

---

## 1. Project overview

Internal business-management platform for a paint retail/dealer business
(`act.qcpaintshop.com`). Handles staff/attendance/salary, leads & collections,
estimates & billing, a painter loyalty program, an engineer quotation portal,
Zoho Books sync (Books only — there is no Zoho CRM integration), WhatsApp
marketing, and an AI dashboard. There is also a separate **Android app** repo at
`..\qcpaintshop-android\` (sibling git repo) — not in this repo.

## 2. Tech stack & key paths

- **Runtime:** Node.js v24, **Express 5**, Socket.IO v4 (`http.createServer`).
- **DB:** MySQL/MariaDB via `mysql2/promise`. DB name: `qc_business_manager`.
  Pool (20 conns) created in `config/database.js`; **session timezone forced to
  `+00:00` (UTC)** — the server clock is IST, so this offset is load-bearing.
- **Frontend:** static HTML + vanilla JS + Tailwind (JIT) in `public/`.
- **Entry point:** `server.js` (~4,400 lines). Routes in `routes/`, business
  logic in `services/`, cross-cutting in `middleware/`, env in `config/`.
- **Schema:** incremental only — `migrations/` (120 files: 119 `.js` + 1 dead
  `.sql` the runner never executes) run by `migrate.js`. There is **no single
  schema.sql**; read migrations to learn tables (core `zoho_*` map tables have
  no DDL in the repo at all — created manually on prod).
- **Docs:** `Skills.md` is the comprehensive living system doc — update it after
  substantial changes. `docs/PROJECT-REPORT-2026-06-10.md` is the latest
  comprehensive code-verified survey; `COMPLETION_STATUS.md` is an older audit.

### Common commands
```bash
npm start                 # node server.js
npm test                  # jest (tests/unit + tests/integration)
npm run test:coverage     # coverage (middleware/config/routes/services)
node migrate.js --status  # NOTE: prod _migrations only tracks Apr 30+ → over-reports pending
node migrate.js           # run pending migrations
npm run lint              # eslint
npm run build:css         # tailwind → public/css/tailwind.css
```

## 3. How the app is wired

- One pool is created in `server.js` and injected everywhere via
  `routeModule.setPool(pool)` (`server.js:~284-393`). New route files must follow
  this pattern — do **not** create a second pool.
- Routes mounted at `server.js:~406-450` under `/api/*`.
- Global middleware: helmet (CSP currently allows `unsafe-inline`/`unsafe-eval`),
  CORS (env whitelist via `CORS_ORIGIN`, no `*`), compression, 3-tier rate
  limiting (global 100/min, auth 10/min, OTP 5/min), PII gate on
  `/uploads/aadhar` + `/uploads/documents` (`server.js:249-267`).
- **Background schedulers:** only the Zoho-dependent services (sync scheduler,
  WhatsApp processor + session init, campaign engine, PNTR marketing crons)
  require **`ZOHO_ORGANIZATION_ID`** (`server.js:~4341-4374`, SVC-001/007 fix);
  everything else (AI, painter, retention, lead auto-assign, health, monitor)
  always starts. All schedulers gate on `isClusterPrimary()`
  (`services/cluster-guard.js` — single pm2 fork instance assumed).

## 4. Auth model (four separate systems)

| Actor | Header / flow | Middleware | Store |
|-------|---------------|------------|-------|
| Staff/Admin | `Authorization: Bearer <token>`, password+bcrypt, optional TOTP | `requireAuth`, `requirePermission(module,action)`, `requireRole` in `middleware/permissionMiddleware.js` | `user_sessions` |
| Customer | Bearer, phone OTP | `requireCustomerAuth` (`middleware/customerAuth.js`) | `customer_sessions` |
| Painter | `X-Painter-Token`, phone OTP | `requirePainterAuth` (approved) / `requirePainterSession` (pending+approved) in `routes/painters.js` | `painter_sessions` |
| Engineer | `X-Engineer-Token`, phone OTP | `requireEngineerAuth` / `requireEngineerSession` defined in `routes/engineers.js` | `engineer_sessions` |

- Tokens are opaque `crypto.randomBytes(32)`, stored as `LOWER(SHA2(token,256))`.
  Lookups compare the hash — keep that exact form.
- `admin` / `administrator` / `super_admin` bypass all permission checks
  (`FULL_ADMIN_ROLES`).

## 5. Coding conventions (match existing style)

- **SQL:** always parameterized with `?` placeholders. For dynamic `SET`/`WHERE`,
  build an array of `?` clauses + a separate `params` array (see
  `routes/estimates.js`). **Never** interpolate user input into SQL strings.
- **Money:** native JS floats with `Math.round(x*100)/100`; money rounded up to
  ₹10 via `r10 = n => Math.ceil(n/10)*10`. (Owner-confirmed policies — see §6.)
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

- **Estimate pricing engine** — `routes/estimates.js:46-135`
  (`calculateItemPricing`, `calculateEstimateTotals`). Owner-confirmed policies
  (2026-06-04): **GST is price-inclusive — `gst_amount: 0` is correct, never add
  18% on top**; line totals **single-round** up to ₹10 then `unit = line/qty`
  (the historical double-rounding bug was fixed in `663e4d4` and is locked by
  `tests/unit/estimate-pricing.test.js` — do not re-"fix"). Estimate↔Zoho
  sub-rupee drift is formally accepted (NIT-1).
- **Painter points engine** — `services/painter-points-engine.js` (regular vs
  annual pools, level multipliers, daily-bonus cap, clawback). Tier thresholds:
  bronze 0 / silver 5K / gold 25K / diamond 100K (no platinum).
- **Salary calc** — `routes/salary.js`. Owner-confirmed policies (RT-039/RT-040,
  commit `47147f7`): **Sunday OT ×2 in SQL is the entire double-time premium**
  (never also apply `overtime_multiplier`); **a standard day is always 10h** on
  the `/260` hourly basis for absence/leave deductions
  (`standard_daily_hours`/`sunday_hours` config columns are intentionally unused
  by the deduction math). Locked by `tests/unit/salary-calc.test.js`.
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

## 10. Known gaps (see docs/PROJECT-REPORT-2026-06-10.md §13 for the full backlog)

- Money paths have characterization tests (estimate-pricing, painter-points,
  salary, DPL); the **auth stack, leads, and Zoho sync core remain untested**.
- Staff logins/failures + permission denials are audited (SYS-009); customer/
  painter/engineer OTP logins are **not** audited. Session IP/UA captured but
  never validated.
- Uploads validated by extension/mimetype only (no magic-byte check).
- UPI VPA centralized in `services/business-config.js` (`ai_config` keys
  `business_upi_vpa`/`business_upi_payee`); a hardcoded fallback literal remains.
- Raw session tokens still dual-written (`user_sessions.session_token`,
  `painter_sessions.token`); painters have no logout endpoint.
