# QC Paint Shop Business Manager — Comprehensive Project Report

| | |
|---|---|
| **Project** | Internal business-management platform for Quality Colours (paint retail/dealer) — `https://act.qcpaintshop.com` |
| **Repo** | `sharjoon1/qcpaintshop-business-manager` (GitHub), branch `master`, HEAD `ae58da9` |
| **Report date** | 2026-06-10 |
| **Produced by** | Claude Code — 9 parallel read-only survey agents over the live repo (≈375 tool calls, ~1M tokens of code read) + editorial synthesis. Claims are verified in code with `file:line` citations; where docs and code disagreed, **code was treated as truth** and the drift is recorded in §3. |
| **Contains no secrets** | Only environment-variable *names* appear; no values, tokens, keys, or credentials. |

## Purpose of this document

This report will be handed to an AI assistant that has **no access to the codebase**, so it can author a **master upgrade prompt**. That prompt will then be executed by **Claude Code** running inside the repo (full file access, can run tests, can deploy to production over SSH). Therefore:

- §2 (constraints) and §3 (stale-doc corrections) are **normative** — the master prompt must embed them.
- §4–§12 are the verified current state of every subsystem.
- §13 is the curated upgrade backlog (91 raw findings, deduplicated and themed) to pick scope from.
- §14 lists open questions only the business owner can answer.
- §15 specifies exactly what the master prompt should contain.

**Glossary (used throughout):**
- **DPL** = *Dealer Price List* — a paint brand's wholesale price sheet (PDF/CSV), parsed to drive item pricing.
- **AP** = *Attendance Points* — reward points painters earn from selfie+GPS daily check-ins, claimed monthly.
- **PNTR** = the Zoho Books contact-name prefix marking painter contacts imported into the painter-marketing pipeline.
- **§6 money paths** = the five critical business-logic areas listed in the repo's CLAUDE.md §6 (estimate pricing, painter points, salary, DPL pricing, Zoho sync).

## Table of contents

1. Executive summary
2. Constraints & guardrails (normative)
3. Corrections to stale documentation (do-NOT-re-fix list)
4. Architecture & runtime
5. API surface
6. Business logic & services
7. Database
8. Frontend
9. Auth & security
10. Integrations & background jobs
11. Quality, tests & audit status
12. Android apps & deployment/ops
13. Consolidated upgrade backlog
14. Open questions / owner decisions needed
15. Guidance for authoring the master upgrade prompt

---

## 1. Executive summary

**What it is.** A single Node.js / Express 5 monolith (`server.js`, 4,406 lines, plus 45 mounted routers) serving a no-framework static frontend (159 HTML pages, vanilla JS + Tailwind) and two Android apps (thin WebView wrappers for staff/customer; a full native Jetpack Compose app for painters). It runs the day-to-day operations of a multi-branch paint retail business: staff attendance/salary, leads & collections, estimates & billing, vendor purchasing, a painter loyalty program (points, credit, selfie attendance), an engineer quotation portal, deep Zoho Books synchronization, WhatsApp transactional + marketing messaging, FCM/Web-Push notifications, and an AI analysis layer.

### By the numbers (verified 2026-06-10)

| Metric | Value |
|---|---|
| HTTP endpoints | **~1,026** (926 across 45 routers + 100 inline in `server.js`) |
| Route files / services | 49 (`routes/`) / 65 (`services/`) |
| Frontend pages | 159 HTML (~6.5 MB); largest `admin-dpl.html` 5,490 lines |
| DB tables | ~185–190 (MariaDB 10.11, DB `qc_business_manager`); 120 migration files, **no schema.sql** |
| Auth actors | **4** token systems: staff/admin, customer, painter, engineer (engineer is undocumented in CLAUDE.md) |
| Background jobs | 30+ cron/interval jobs (node-cron, IST timezone), mostly cluster-guarded |
| Tests | 58 files / ~599 cases (jest + 1 DB-integration + 8 Playwright specs); last verified green: 545/545 on 2026-06-08 |
| CI/CD | **None** — husky lint-staged only; deploy is a manual `ssh + git pull + pm2 restart` |
| Audit state | 453-finding triage (2026-06-08): **12/12 P0 fixed & deployed**; +39 bugs found 2026-06-09; ~20 P1/P2 batch commits since; no live remaining-count tracker |

### Strengths

- **SQL discipline**: parameterized queries throughout; the 2026-06 audit found no SQL injection.
- **Auth fundamentals**: opaque 32-byte tokens stored as SHA-256 hashes, bcrypt passwords, optional TOTP, 3-tier rate limiting, RBAC with 560 `requirePermission` call sites, idempotency middleware on 16 financial POSTs, redacting audit log.
- **Best-in-repo engineering** in the DPL (Dealer Price List) pricing pipeline (deterministic `dpl_catalog` mediator, 13+ test files) and the Zoho rate-limiter (token bucket + daily quota + circuit breaker).
- **Active remediation culture**: a 453-finding audit was triaged and the entire P0 class fixed within days; money paths now have characterization tests.

### Weaknesses (the upgrade surface)

- `server.js` still hosts ~100 inline endpoints including the whole auth core; two router files (`painters.js` 338 KB, `zoho.js` 313 KB) carry 30% of the API.
- **No CI, misleading coverage config** (only `middleware/`, `config/`, 1 service are measured), 4 "mirror" test files that test copies instead of production code; auth stack, leads, and Zoho sync core are genuinely untested.
- **A fresh dev DB cannot be bootstrapped from the repo** — core Zoho tables have no DDL anywhere; only 22/119 migrations are runnable by the runner; prod `_migrations` falsely reports ~80 pending.
- Frontend: 4 copy-pasted XSS-escaper variants (9 `innerHTML` pages have none), CSP allows `unsafe-inline`/`unsafe-eval`, 928 KB Tailwind build, multi-thousand-line inline scripts ESLint never sees, JS files have no cache-busting.
- Residual security debt: raw session tokens still dual-written to DB, plaintext OTPs (customer OTP is console-logged in production), no painter logout, no account lockout, query-param token auth on PII files.
- **Operational risk concentration**: all transactional WhatsApp rides unofficial `whatsapp-web.js` (bannable); the sole enabled AI provider is invoked via a hardcoded absolute path on prod; date-anchored money crons (monthly slabs, AP attendance claims) silently skip if the process is down at fire time; Android source for the shipped painter app exists only on an uncommitted local branch with **no git remote**.

### The single most important context for any upgrade

Several behaviors that *look like bugs* are **owner-confirmed intentional policy** (GST-inclusive `gst_amount=0`, single ₹10 line rounding, Sunday OT ×2-in-SQL, 10h standard day), and several documented "known issues" are **already fixed**. An upgrade prompt written from the stale docs would re-break correct money logic — §2 and §3 below exist to prevent exactly that.

---

## 2. Constraints & guardrails (NORMATIVE — embed these in the master prompt)

### 2.1 Owner-confirmed business policies — these are CORRECT behavior, never "fix" them

| Policy | Where | Detail |
|---|---|---|
| **GST is price-INCLUSIVE** | `routes/estimates.js:132` | `gst_amount: 0` is intentional (owner-confirmed 2026-06-04). Zoho-synced prices already include GST. Never add 18% on top in estimates. |
| **Single ₹10 line rounding** | `routes/estimates.js:94-101` | Line total = `ceil(finalPrice×qty/10)×10` rounded **once** from the un-rounded unit price; then `unit = line/qty`. The historical double-rounding bug is FIXED (commit `663e4d4`) and test-locked. |
| **Estimate↔Zoho sub-rupee drift** | NIT-1 | Formally accepted by owner 2026-06-05. Not a defect. |
| **Sunday OT = 2× double-time** | `routes/salary.js:552-553,597` | The SQL `×2` IS the entire premium (owner RT-039). Do NOT also multiply by `overtime_multiplier` (the old 3× bug). |
| **Standard day = always 10h** | `routes/salary.js:617-623` | Absence/leave deductions use `hourlyRate × 10` matching the `/260` basis (owner RT-040). The `standard_daily_hours`/`sunday_hours` config columns are intentionally unused by deduction math. |
| **Painter tiers — NO platinum** | `migrations/migrate-painter-retention.js:42-45` | bronze 0 (1.00×), silver 5,000 (1.20×), gold 25,000 (1.50×), diamond 100,000 (2.00×). |
| **DPL rate formula** | 3 sites, §6(d) | `rate = ceil(DPL × 1.18 × 1.10)` (18% GST × 10% markup, whole rupee); `purchase_rate = DPL`, `cf_dpl = DPL`. |
| **Zoho `cf_*` wrapping** | `services/zoho-api.js:1666-1705` | All item writes MUST go through `createItem`/`updateItem`, which wrap `cf_*` keys into `custom_fields:[{api_name,value}]` — Zoho silently ignores top-level `cf_*`. |
| **Sync clobber protection** | `services/zoho-api.js:1389-1394` | `syncItems` upsert uses `COALESCE` to preserve locally-pushed `cf_dpl`/product-name because Zoho's list API omits custom fields. Keep this. |
| **Birla Opus naming rules** | `services/price-list-parser.js:1303` | ALL CAPS, brand always `BIRLA OPUS`, tier word kept, no duplicate SKU prefix, emulsion variant stripped, enamel color kept. |

### 2.2 Money/correctness paths — characterization test BEFORE any edit

Per CLAUDE.md §6, these five paths require a test that locks current behavior *before* changing anything: estimate pricing engine (`routes/estimates.js:46-135`), painter points engine (`services/painter-points-engine.js`), salary calc (`routes/salary.js:510-690`), DPL pipeline (`price-list-parser.js` → `dpl-catalog.js` → `item-master.js`/`zoho.js`), Zoho sync (`zoho-api.js`). Characterization tests already exist for all five (`tests/unit/estimate-pricing.test.js`, `painter-points-engine.test.js`, `salary-calc.test.js`, 13+ `dpl-*` files) — run them, extend them, never delete them.

### 2.3 Production safety rules

- **Never run destructive SQL against prod** without showing the exact SQL and getting explicit approval. Prefer additive migrations (`ALGORITHM=INPLACE, LOCK=NONE`; MariaDB 10.11).
- **`_migrations` trap**: prod only tracks migrations applied on/after 2026-04-30, so `node migrate.js --status` falsely reports ~80 pending. NEVER blind-run the backlog. New migration = run the file directly, then `INSERT IGNORE` a marker row.
- **DB session timezone is forced to `+00:00` (UTC)** in `config/database.js` while the server clock is IST — this offset is load-bearing; lots of code does explicit IST conversion (`CONVERT_TZ`, `+5.5h`). Don't "simplify" it.
- **One DB pool only** — created in `server.js`, injected via `setPool(pool)`. Never create a second pool.
- Deploy: `ssh hetzner "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && npm install && pm2 restart business-manager"`. `npm install` triggers `postinstall` → Tailwind CSS rebuild + CSS version stamping. Single pm2 fork instance assumed (`services/cluster-guard.js`).
- Secrets live in `.env` (gitignored, verified not in git history). Never hardcode credentials, never paste secret values into chat/commits.

### 2.4 Coding conventions (match existing style)

- SQL: always `?` placeholders; dynamic `SET`/`WHERE` = array of clauses + separate params array (pattern in `routes/estimates.js`).
- **Session-token form is sacred**: tokens are opaque `crypto.randomBytes(32)` hex, stored/compared as `LOWER(SHA2(token,256))` in SQL (Node-side sha256 hex for customer sessions). Any work on token storage (backlog S1/S2) must keep that exact form — never switch hash form without a dual-read migration, or every live session breaks.
- **Tamil user-facing templates** (WhatsApp/FCM/SMS): never open with "வணக்கம்" — owner-mandated; use alternatives (வரவேற்கிறோம், அவர்களே, …). Applies to any template work, including the I1 WhatsApp migration.
- Money: JS floats with `Math.round(x*100)/100`; round-up-to-₹10 helper `r10 = n => Math.ceil(n/10)*10`.
- Frontend XSS: escape before `innerHTML`; **reuse the escaper already defined in the page being edited** (names vary: `escHtml`/`escapeHtml`/`esc`/`escJS`).
- Brand colors: Admin purple `#667eea→#764ba2`; Staff & Painter green `#1B5E3B` + gold `#D4A24E` — **no purple on staff/painter pages** (verified currently clean; keep it that way).
- Errors: throw and let the centralized handler respond; never leak `err.message` on public endpoints.
- New route module = `{router, setPool}` exports + DI entry + mount in `server.js` (§4 has the exact contract).

### 2.5 Workflow rules for the executor (from CLAUDE.md §8-9)

1. Plan-first for any multi-file feature/migration/§6 change — get owner approval before code.
2. Evidence over "done" — show actual test output / command results.
3. Test-first for bug fixes — failing test → fix → passing test.
4. Commits/code/docs in **English**; chat replies to the owner in **Tamil** (technical terms stay English). Commit footer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
5. After substantial changes, update `Skills.md` (currently 3 weeks stale — see §13 theme DOC).

---

## 3. Corrections to stale documentation (do-NOT-re-fix list)

The repo's own docs (CLAUDE.md, Skills.md, COMPLETION_STATUS.md, project memory) contain claims that the 2026-06-10 code survey **disproved**. A master prompt built on those docs would schedule work that is already done — or worse, "fix" intentional behavior. The table below is authoritative as of HEAD `ae58da9`.

| Stale claim (source) | Verified reality (2026-06-10) |
|---|---|
| "Double ₹10 rounding bug in estimates" (CLAUDE.md §6) | **FIXED** 2026-06-04 (commit `663e4d4`), single-round, locked by `tests/unit/estimate-pricing.test.js`. Do not touch. |
| "`gst_amount: 0` hardcoded — may be intentional, confirm" (CLAUDE.md §6) | **CONFIRMED INTENTIONAL** by owner 2026-06-04. GST-inclusive pricing. Closed question. |
| "Salary has basis-inconsistency bugs" (CLAUDE.md §6) | **FIXED** per owner-confirmed RT-039/RT-040 (commit `47147f7`). Current behavior is policy. |
| "estimates/painter-points/auth/leads/zoho-sync untested" (CLAUDE.md §10) | Partially stale: estimate pricing, painter points, salary, DPL now have characterization tests. **Still genuinely untested**: auth stack, leads, Zoho sync core, route handlers. |
| "All background schedulers gated on `ZOHO_ORGANIZATION_ID`" (CLAUDE.md §3) | Only 4 Zoho-dependent services are gated (`server.js:4341-4374`, SVC-001/007 fix); everything else always starts. |
| "Three separate auth systems" (CLAUDE.md §4) | **Four** — `routes/engineers.js` implements a full engineer OTP/token actor (`engineer_sessions`, `X-Engineer-Token`), absent from the docs. |
| "UPI id hardcoded in estimates.js/share.js" (CLAUDE.md §10) | Centralized into `services/business-config.js` (`ai_config` keys `business_upi_vpa`/`business_upi_payee`, commit `9c9a932`); a hardcoded fallback literal remains at `business-config.js:13`. |
| "118 migrations" (CLAUDE.md §2) | 120 files: 119 `.js` + 1 dead `.sql` the runner can never execute. |
| "~105 pages still on Tailwind CDN" (MEMORY) | **0** — CDN migration is complete; 101 pages load the built `/css/tailwind.css`. |
| "37 test files" / "no net_salary column" (COMPLETION_STATUS.md) | 58 test files; `net_salary` IS a `STORED GENERATED` column (`migrations/migrate-staff-incentives.js:80-82`). |
| Skills.md §7 fresh-install path = legacy `scripts/migrate-*.js` | Wrong — the real mechanism is `migrate.js` + `migrations/`. Skills.md is stale since 2026-05-18 (~343 commits behind; the June audit sprint alone is 111 of them). |
| "Zoho Books/CRM sync" (CLAUDE.md §1) | **Books only** — no Zoho CRM API anywhere in code; PNTR import pulls Zoho *Books* contacts. |
| `routes/zoho.js:443-445` comment: "item-master `version_id` latent bug" | Stale comment — `routes/item-master.js:561` uses the correct `dpl_version_id` column. |
| "server.js ~3,400 lines" (MEMORY) | 4,406 lines. |

---

## 4. Architecture & runtime

### Runtime stack

| Layer | Detail |
|---|---|
| Runtime | Node.js (docs claim v24; **no `engines` field or `.nvmrc` in repo** — unpinned) |
| HTTP framework | Express **5** (`express@^5.2.1`), `app.set('trust proxy', 1)` behind nginx/aaPanel |
| Realtime | Socket.IO v4 (`socket.io@^4.8.3`) attached to the same `http.createServer(app)` server (`server.js:3966-3988`) |
| DB | MySQL/MariaDB (prod = MariaDB 10.11 per docs) via `mysql2/promise`, DB `qc_business_manager` |
| Key deps | `helmet@8`, `cors`, `compression`, `express-rate-limit@8`, `multer@2`, `zod@4`, `bcrypt@6`, `speakeasy` (TOTP), `firebase-admin` (FCM), `web-push`, `nodemailer@8`, `whatsapp-web.js` + `puppeteer-core` (headless Chromium in-process!), `sharp`, `pdfkit`, `pdf-parse`, `node-cron`, `lru-cache`, `socket.io` |
| Dev deps | jest 30, @playwright/test, eslint 9 + husky + lint-staged, tailwindcss 3 (JIT, `npm run build:css`, also run by `postinstall`) |
| Entry point | `server.js` — **4,406 lines**, contains ~**100 inline endpoints** (`app.get/post/put/delete`) in addition to 45 mounted routers |
| Process model | Single Node process under **pm2** app name `business-manager` on a Hetzner box at `/www/wwwroot/act.qcpaintshop.com` (deploy = ssh + `git pull` + `npm install` + `pm2 restart business-manager`). No `ecosystem.config.js` in repo. `services/cluster-guard.js` defensively gates all schedulers on `NODE_APP_INSTANCE ∈ {undefined,'','0'}` so a future `pm2 -i N` cluster won't N-plicate crons/FCM/WhatsApp sends (used by 10 scheduler services). |

### Startup order (server.js, top → bottom)

1. `dotenv.config()`, require ~75 route/service modules (`server.js:12-103`).
2. `console.error` is **monkey-patched** to push into `global._appErrorBuffer` (ring of last 100 entries, 500-char messages) for the AI App Analyzer (`server.js:109-118`).
3. Global middleware (order matters — see table below), then `GET /r/:code` painter-referral redirect (`server.js:230`).
4. `createPool()` from `config/database.js` (`server.js:239-240`).
5. PII gate + upload headers + static mounts (`server.js:249-282`).
6. **Dependency-injection block** (`server.js:284-393`): `initPool(pool)` for permission middleware, then ~60 `*.setPool(pool)` calls on route modules and services, plus `setSessionManager`, `setActivityTrackerService`, `setAiEngine`, etc. wiring.
7. `ensureUploadDirs()` from `config/uploads.js` (creates 25 upload dirs).
8. Route mounting (`server.js:406-450`), share-page HTML routes, `/oauth/callback` → `/api/zoho/oauth/callback` redirect.
9. ~3,400 lines of **inline endpoints**: AUTH (login/login-2fa/verify/me/logout/forgot-password ×3/reset, `server.js:471-970`), OTP send/verify/resend + register (973-1341), SETTINGS + logo/profile upload (1343-1444), PUBLIC guest + design-requests + paint-colors/AI visualization (Gemini img2img with Pollinations flux fallback, 1446-2265), BRANDS (2267), CATEGORIES (2315), USERS/staff mgmt + KYC uploads (2363-2733), CUSTOMER TYPES (2735), PRODUCTS incl. Zoho item assignment/bulk-map/import (2787-3376), CUSTOMER AUTH OTP + customer portal `/api/customer/me/*` (3378-3672), CUSTOMERS (3674), calculate-estimate (3754), dashboard stats (3814), `/health`, `/api/test` (DB ping), `/api/status` (3884-3936).
10. 404 handler (non-`/api/` → `public/404.html`, `server.js:3943`), then `errorHandlerMw.globalErrorHandler` (3955).
11. `http.createServer(app)` + Socket.IO with mirrored CORS; `app.set('io', io)`; `onlineUsers` Map; ~20 `*.setIO(io)` calls; anomaly-alert callback (throttled 1/type/hour; critical → WhatsApp to admins) (`server.js:3966-4045`).
12. `server.listen(PORT||3000)` callback: automation-registry wiring → schedulers start (see below).
13. `SIGTERM/SIGINT` → gracefulShutdown (stops health checks/monitor, flushes Zoho rate-limiter counters to DB, `process.exit(0)` — **does NOT close the HTTP server, Socket.IO, or the MySQL pool**). `uncaughtException` → log to DB + exit(1) after 1s; `unhandledRejection` → log only, keeps running (`server.js:4391-4406`).

### Global middleware stack (exact order)

| # | Middleware | Notes |
|---|---|---|
| 1 | `helmet` (`server.js:133-168`) | CSP allowlist: `script-src` includes **`'unsafe-inline'` + `'unsafe-eval'`** + 7 CDNs; `connect-src 'self' wss: https:`; `frame-ancestors 'self'`; comment admits stricter CSP blocked on migrating inline handlers |
| 2 | `compression()` | gzip/br |
| 3 | `cors` (`server.js:187-212`) | Whitelist from `CORS_ORIGIN` (comma-separated); prod fallback hardcodes `https://act.qcpaintshop.com` if unset (with console.error); dev allows localhost + private-LAN IPs; never `*`; `credentials: true` |
| 4 | `express.json` / `urlencoded` | both `limit: '10mb'` |
| 5 | `globalLimiter` on `/api` | 100 req/min/IP (`middleware/rateLimiter.js`); **in-memory store** — resets on restart, not shareable across instances |
| 6 | `responseTracker.middleware` | in-memory ring buffer (1000 entries), p50/p95/p99 + slow-endpoint (≥3s) tracking for `/api/monitoring` dashboard |
| 7 | PII gate `['/uploads/aadhar','/uploads/documents']` (`server.js:249-267`) | DB session lookup, only roles `admin/manager/hr`; accepts token via `Authorization` header **or `?token=` query param** (query tokens leak into proxy logs) |
| 8 | `/uploads` header shim (`server.js:275-279`) | `Content-Disposition: attachment` + `nosniff` so uploaded HTML/SVG can't execute in-origin |
| 9 | `express.static('public')` + `/uploads` static | static after gates |
| — | `errorHandlerMw.globalErrorHandler` | mounted last (`server.js:3955`) |

Per-route limiters: `authLimiter` (10/min) on login/2FA/forgot/reset (`server.js:475-923`, `routes/staff-registration.js`); `otpLimiter` (5/min, keyed by phone) on all OTP endpoints incl. painter/engineer/customer OTP and 2FA validate; `leadSubmitLimiter` (8/hour/phone) on public estimate-request POST.

### Request flow & auth

nginx → Express (trust proxy 1) → middleware 1-9 above → router. **Auth is NOT global**: each route module applies `requireAuth` / `requirePermission(module,action)` / `requireRole` (`middleware/permissionMiddleware.js`) per endpoint, except `/api/estimates` which gets `requireAuth` at mount (`server.js:421` — note `/api/estimates` is mounted **twice**: `estimatePdfRoutes.router` unauthenticated-at-mount first, then `requireAuth, estimateRoutes.router`). All four staff-auth middlewares run the identical SQL `SELECT ... FROM user_sessions s JOIN users u ... WHERE s.token_hash = LOWER(SHA2(?,256)) AND s.expires_at > NOW() AND u.status='active'` — **one DB session lookup per request, no caching**. `admin/administrator/super_admin` (`FULL_ADMIN_ROLES`) bypass permission checks. Separate `requireCustomerAuth` (`middleware/customerAuth.js` → `services/customer-auth.js`) and painter auth (inside `routes/painters.js`, `X-Painter-Token`).

### Wiring a new route module (the contract)

1. `routes/foo.js` exports `{ router, setPool }` (optionally `setIO`, `setSessionManager`).
2. `require` it at top of server.js; add `fooRoutes.setPool(pool)` in the DI block (~lines 284-393); mount `app.use('/api/foo', fooRoutes.router)` (~406-450); if realtime, add `fooRoutes.setIO(io)` after Socket.IO init (~4000-4018). Never create a second pool.
3. Exception: `routes/admin-dashboard.js` uses `setDependencies({pool, onlineUsers, automationRegistry})` (`server.js:3998`); `routes/auth-2fa.js` exports the router directly with `setPool` attached (`app.use('/api/2fa', twoFARoutes)`).
4. 49 files in `routes/`; 45 modules mounted across 45 mounts (the two `/api/estimates` mounts are two different modules); 4 are non-mounted helpers (`estimate-pdf-generator.js`, `painter-estimate-pdf-generator.js`, `salary-pdf-generator.js`, `product-pricing-helpers.js`).

### Database pool (`config/database.js`)

Single `mysql2/promise` pool: env `DB_HOST/DB_USER/DB_PASSWORD/DB_NAME/DB_PORT(3306)`, `connectionLimit: 20`, `timezone: '+00:00'` **plus** a `pool.on('connection')` hook running `SET SESSION time_zone = '+00:00'` — the server's `/etc/localtime` is Asia/Kolkata so MySQL's SYSTEM tz is IST; without the session override `NOW()` and DATETIME writes would be +5:30 off. This UTC forcing is **load-bearing**: lots of code converts to IST explicitly (e.g. the geofence cron computes `now + 5.5h` manually, `server.js:4218`).

### Socket.IO

- Auth middleware (`io.use`, `server.js:4048-4072`) validates **staff sessions only** (same `user_sessions` SHA2 lookup) — painters/customers never connect directly.
- Rooms: `user_{id}` (notifications), `whatsapp_admin`, `wa_marketing_admin`, `whatsapp_chat_admin` (gated by `isFullAdmin`), `painter_{id}` + `admin_painters_live` (**join events have no role check** beyond having a staff session), `conversation_{id}` (chat, auto-joined from `chat_participants`), `live_dashboard_admin` (admin/manager roles; powers online-user presence via `onlineUsers` Map).
- Routes access io via injected `setIO(io)` or `app.get('io')`.

### Background schedulers (started in `server.listen` callback, `server.js:4194-4375`)

| Always started (NOT Zoho-gated) | Zoho-gated (`if (process.env.ZOHO_ORGANIZATION_ID)`) |
|---|---|
| `autoClockout`, `attendanceReport`, inline 60s geofence-enforcement `setInterval` (location-off >2min and geo-warning >5min auto-clockout, ~125 inline lines), `aiScheduler`, `painterScheduler` (PNTR Zoho crons internally guarded), `dataRetentionService`, `leadAutoAssignScheduler`, `systemHealthService` (5 min), `productionMonitor` (self-healing), `photosRoutes.startCleanupCron()`, anomaly full scan every 6h | `syncScheduler`, `whatsappProcessor`, `whatsappSessionManager.initializeSessions()`, `waCampaignEngine` — skip logged loudly |

**Doc drift:** CLAUDE.md §3 still says all schedulers are gated on `ZOHO_ORGANIZATION_ID`; code comment at `server.js:4341-4345` (SVC-001/007 fix) shows only the 4 Zoho services are gated now. Also one OS-level cron lives **outside the app**: `config/data-archival-cron.json` documents a monthly crontab entry running `scripts/archive-old-data.js` (archives `zoho_invoices/zoho_payments/zoho_stock_history` >24 months).

### Error handling (`middleware/errorHandler.js`)

`globalErrorHandler` maps known errors (Zod/`ER_DUP_ENTRY`→409, `ECONNREFUSED`→503, JWT names→401...), suppresses message+stack only for ≥500 in production. `logError` writes to `error_logs` with sensitive-key redaction, stack-trace parsing, hash dedup via `errorAnalysisService`, and **auto-creates bug reports** for critical/high severity and at 20/50 occurrence thresholds (gated by `ai_config.bug_tracking_enabled`), optionally generating AI fix suggestions. `uncaughtException`/`unhandledRejection` also feed it. Console errors additionally land in `global._appErrorBuffer` via the monkey-patch.

### middleware/ inventory

| File | Purpose |
|---|---|
| `permissionMiddleware.js` | Staff auth: `requireAuth`, `requirePermission(module,action)` (RBAC via `roles`/`permissions`/`role_permissions`), `requireAnyPermission`, `requireRole`, `getUserPermissions`, `FULL_ADMIN_ROLES` bypass; audits PERMISSION_DENIED |
| `customerAuth.js` | `requireCustomerAuth` Bearer gate → `req.customer = {id, phone}` from `customer_sessions` |
| `errorHandler.js` | Global handler + DB error logging/dedup/auto-bug + `asyncWrapper` + legacy `validateRequest` |
| `rateLimiter.js` | `globalLimiter` 100/min, `authLimiter` 10/min, `otpLimiter` 5/min (phone-keyed), `leadSubmitLimiter` 8/hr (in-memory stores) |
| `idempotency.js` | `idempotent(scope)` factory; `Idempotency-Key` header → `idempotency_records` (SHA-256 scope:key, 24h TTL); replays 2xx/4xx, never stores 5xx |
| `validate.js` | Zod `validate/validateQuery/validateParams` + shared pagination/id/date-range/branch schemas |
| `branchScope.js` | `req.branchScope.branchId` — managers scoped to own `users.branch_id`, admins null |
| `responseTracker.js` | In-memory p50/p95/p99 + slow-endpoint metrics for monitoring dashboard |
| `requestLogger.js` | **Dead code** — defined, never imported anywhere |

### Environment variable names read by the app (values gitignored in `.env`)

- **DB:** `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_PORT`
- **Core:** `NODE_ENV`, `PORT`, `CORS_ORIGIN`, `NODE_APP_INSTANCE` (pm2 cluster guard), `SESSION_SECRET` (zoho-oauth state)
- **Zoho Books/CRM:** `ZOHO_ORGANIZATION_ID` (also the scheduler gate), `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_REDIRECT_URI`
- **Zoho Payments:** `ZOHO_PAYMENTS_CLIENT_ID`, `ZOHO_PAYMENTS_CLIENT_SECRET`, `ZOHO_PAYMENTS_REFRESH_TOKEN`, `ZOHO_PAYMENTS_ACCESS_TOKEN`, `ZOHO_PAYMENTS_ACCOUNT_ID`
- **AI:** `GEMINI_API_KEY`, `GEMINI_MODEL`, `AI_GEMINI_MODEL`, `ANTHROPIC_API_KEY` (note: Gemini/Claude currently disabled via `ai_config` DB flags; Clawdbot/Kai gateway is sole active provider)
- **Email:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_INSECURE_TLS`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`, `MAIL_FROM_NAME`
- **SMS/Push:** `SMS_USER`, `SMS_PASSWORD`, `SMS_SENDER_ID`, `FIREBASE_SERVICE_ACCOUNT_PATH`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL`
- **Base URLs (4 inconsistent vars):** `APP_ORIGIN` (painter-card-generator), `APP_PUBLIC_URL` (forgot-password links), `APP_BASE_URL` (admin-notifications), `BASE_URL` (share links); `routes/estimates.js` falls back to `PORT`-built localhost URLs
- **Test affordance:** `ALLOW_TEST_OTP` (`routes/painters.js`)

### Other doc-vs-code drift found

- `migrations/` now has **120** files (CLAUDE.md says 118).
- server.js is 4,406 lines (CLAUDE.md "~4,350"); CLAUDE.md's setPool/mount line refs (273-376 / 394-438) have shifted to ~284-393 / ~406-450.
- MEMORY.md "server.js ~3,400 lines" is stale.


---

## 5. API surface

### Overview

- **926 HTTP endpoints** defined across 45 router modules in `routes/` + **100 endpoints** defined inline in `server.js` = **~1,026 Express endpoints total** (counted via `router.get|post|put|delete|patch` and `app.<method>('/...')` occurrences). Plus a Socket.IO v4 server on the same `http.createServer` (real-time chat/notifications/location), not counted above.
- All routers are mounted in `server.js:406-450`; pool injection happens at `server.js:284-393` via `setPool(pool)` per module.
- 4 files in `routes/` are **helpers, not routers** (0 endpoints): `estimate-pdf-generator.js`, `painter-estimate-pdf-generator.js`, `salary-pdf-generator.js`, `product-pricing-helpers.js`.
- Global middleware before all routes: helmet, CORS env whitelist, compression, global rate limit 100/min, `authLimiter` 10/min and `otpLimiter` 5/min on sensitive endpoints, PII gate on `/uploads/aadhar|documents` (`server.js:242-267`), forced `Content-Disposition: attachment` on all `/uploads` (`server.js:275-279`).

### Route module inventory (mount path from server.js:406-450)

Auth legend: `auth`=requireAuth, `perm`=requirePermission, `role`=requireRole, `painter`=requirePainterAuth/requirePainterSession, `engineer`=requireEngineerAuth/requireEngineerSession (defined in-file), `manual`=hand-rolled token check inside handler.

| Route file | Mount path | Purpose | Endpoints | Auth |
|---|---|---|---|---|
| activities.js | /api/activities | Staff daily activity tracking & reporting | 9 | auth + perm |
| activity-feed.js | /api/activity-feed | Staff notice board / activity feed | 3 | auth; notices CRUD = role(admin,super_admin) |
| activity-tracker.js | /api/activity-tracker | Activity start/stop, photo upload, admin monitoring | 12 | auth + perm |
| admin-dashboard.js | /api/admin/dashboard | Real-time admin live dashboard (`/live`) | 1 | auth |
| admin-notifications.js | /api/admin-notifications | Admin notification config/dispatch | 5 | perm |
| agreements.js | /api/agreements | Staff employment agreements (view/sign/upload) | 6 | auth + role |
| ai.js | /api/ai | AI chat (SSE), insights, config, lead scoring, app analyzer | 25 | auth + perm |
| anomalies.js | /api/anomalies | Anomaly detection view/manage/trigger | 7 | auth + perm |
| attendance.js | /api/attendance | Clock in/out, leave/permission, geofence, reports (largest staff module, 168KB) | 51 | auth + perm |
| auth-2fa.js | /api/2fa | TOTP setup/validate/disable | 5 | auth; `POST /validate` public pre-login (otpLimiter) |
| billing.js | /api/billing | Billing estimates/invoices/payments/Zoho push | 17 | perm('billing',\*) — multi-line defs; 3 POSTs also `idempotent()` |
| branches.js | /api/branches | Branch CRUD, shop hours, manager assignment | 10 | perm |
| chat.js | /api/chat | Internal staff chat conversations | 6 | auth |
| collections.js | /api/zoho/collections | Outstanding invoices, reminders, promises, payment links | 18 | perm('zoho','collections'/'collections','view'); **1 public**: `GET /pay-order/:link_id` (collections.js:1011) |
| credit-limits.js | /api/credit-limits | Zoho customer credit limits + staff request workflow | 14 | perm + role |
| daily-tasks.js | /api/daily-tasks | Daily mandatory checklists with photo proof | 15 | auth + perm |
| engineers.js | /api/engineers | Engineer program: OTP auth, quotes, catalog, orders, projects | 33 | **mixed**: 3 public (register/send-otp/verify-otp), engineer-token routes, admin perm routes |
| estimate-pdf.js | /api/estimates (mounted *before* auth, server.js:420) | Puppeteer PDF render of estimate | 1 | manual (Bearer **or `?token` query**) + branch isolation (estimate-pdf.js:57-74) |
| estimate-requests.js | /api/estimate-requests | Public estimate-request/lead form + staff management | 8 | **1 public** `POST /` (leadSubmitLimiter); rest auth |
| estimates.js | /api/estimates | Estimate CRUD + pricing engine (§6 critical) + payment confirm | 18 | `requireAuth` at mount (server.js:421) + per-route perm |
| guides.js | /api/guides | Guides/documentation CRUD, categories, favorites, analytics | 11 | auth + perm |
| item-master.js | /api/item-master | Item naming, DPL pricing, health checks for Zoho items | 17 | auth (1 perm) |
| leads.js | /api/leads | Lead management, followups, conversion, auto-assignment (94KB) | 33 | perm |
| monitoring.js | /api/monitoring | System health/integrations/business monitoring dashboard | 5 | `router.use(requireRole(['admin','super_admin']))` (monitoring.js:12) |
| notifications.js | /api/notifications | User notifications + web-push subscribe | 7 | auth; `GET /push/vapid-key` public (public VAPID key — OK) |
| painter-marketing.js | /api/painter-marketing | PNTR import, daily call lists, conversion, backfill | 26 | perm |
| painters.js | /api/painters | Painter loyalty platform — public+painter+admin lifecycle (338KB, biggest file) | **156** | **mixed**: 70 painter-token uses, 39 auth, 59 perm; 7 public (see below); `POST /:id/activate` manual dual-auth in-handler (painters.js:6032) |
| photos.js | /api/photos | Admin photo gallery browse + cleanup cron | 3 | auth + perm |
| price-list.js | /api/price-list | Customer price-list generator (brands/items/generate) | 3 | perm('zoho','manage') via `perm` const |
| roles.js | /api/roles | Role & permission management | 11 | perm |
| salary.js | /api/salary | Salary config/calc/payments, PDF slips, WhatsApp send (§6 critical) | 43 | perm + role; `GET /monthly/:id/pdf` manual token w/ owner-or-privileged gate (salary.js:999-1012) |
| share.js | /api/share | Estimate share links | 5 | mixed: 2 auth (`/generate`, `/whatsapp`) + **3 public token endpoints** (`/public/:token`, `/upi-qr`, `/pdf`) |
| staff-daily-work.js | /api/staff/daily-work | Unified staff daily-work dashboard | 5 | auth |
| staff-registration.js | /api/staff-registration | Staff self-registration + admin review + offer letters | 15 | mixed: 2 public (`/check-availability`, `/register`, authLimiter) + auth/perm; offer-letter manual token incl. `?token` (staff-registration.js:560) |
| stock-check.js | /api/stock-check | Daily physical stock verification assignments (88KB) | 27 | auth + perm |
| stock-migration.js | /api/zoho/migration | Bulk warehouse→business stock transfer | 6 | perm |
| system.js | /api/system | System health, error tracking, bug reports, audit-log read | 29 | perm (+auth) |
| tasks.js | /api/tasks | Admin-assigned staff tasks, tracking, rating | 13 | auth + perm |
| vendors.js | /api/vendors | Vendor CRUD, bills + AI OCR scan, POs, payments, Zoho push | 20 | perm('vendors', view/manage/purchase_orders) via consts (vendors.js:128-130) + idempotent |
| wa-contacts.js | /api/wa-contacts | WhatsApp contact & group management | 12 | `router.use(requireAuth)` (wa-contacts.js:27) + perm |
| wa-marketing.js | /api/wa-marketing | WhatsApp marketing campaigns/templates/instant-send | 27 | perm('marketing', view/manage) via consts (wa-marketing.js:51-52) |
| website.js | /api/website | Public landing-page content + admin CMS CRUD | 20 | mixed: **2 public** (`GET /content`, `GET /gallery`) + perm |
| whatsapp-chat.js | /api/whatsapp-chat | WhatsApp chat history viewer + send | 9 | perm('zoho','whatsapp_chat') via `perm` const |
| whatsapp-sessions.js | /api/zoho/whatsapp-sessions | Per-branch WhatsApp session connect/QR/status | 11 | perm('zoho','whatsapp_sessions') + branch-staff variant |
| zoho.js | /api/zoho | Zoho Books admin integration: items, customers, invoices, sync, DPL catalog (313KB) | **148** | perm (147 routes) + 1 auth; **1 public**: `GET /oauth/callback` (zoho.js:1660) |

Note: `/api/zoho` (zoho.js) is mounted **before** the nested mounts `/api/zoho/migration`, `/api/zoho/collections`, `/api/zoho/whatsapp-sessions` — Express gives zoho.js first match, so any future zoho.js route named `/migration/*` etc. would shadow those modules.

### Endpoints defined directly in server.js (100 total)

| Group | Endpoints | Auth |
|---|---|---|
| Staff auth | `POST /api/auth/login`, `/login-2fa`, `/logout`, `/forgot-password`, `/forgot-password-mobile`, `/reset-password`; `GET /api/auth/verify`, `/me`, `/validate-reset-token`, `/permissions` | public by design; authLimiter on login/forgot/reset |
| Registration | `POST /api/auth/register` (server.js:1268) | public, OTP-gated — **no authLimiter** (global 100/min only) |
| OTP | `POST /api/otp/send|verify|resend` | public, otpLimiter |
| Customer portal | `POST /api/customer/auth/send-otp|verify-otp|logout`; `GET /api/customer/auth/me`, `/api/customer/me/requests[...]`, `/estimates/:id[/pdf]`, `/invoices[...]` (11 endpoints) | otpLimiter (login) + requireCustomerAuth |
| Settings/uploads | `/api/settings*` (5), `POST /api/upload/logo|profile|aadhar|pan-proof` | perm('settings','manage') / auth |
| Catalog CRUD | `/api/brands` (4), `/api/categories` (4), `/api/customer-types` (4) | auth reads, perm writes |
| Users | `GET/POST/PUT/DELETE /api/users*`, `change-password`, `profile/me` (8) | perm('staff',\*) / auth |
| Products | ~20 endpoints: CRUD, units, `zoho-items-search`, `catalog-stats`, `unmapped-pack-sizes`, `bulk-map`, `assign-zoho-item`, `mapped-zoho-ids`, `import-from-zoho`, image upload, `bulk-delete` | auth reads, perm('products',\*) writes |
| Customers | CRUD (5) | auth/perm('customers',\*) |
| Design requests | admin list/stats/update + `visualize`/`auto-visualize`/`visualizations`, paint-colors (3) | role(admin,manager) / auth |
| Guest/public | `GET /api/guest/brands|categories|products`; `GET /api/public/site-info|branches|brands`; **`POST /api/public/design-requests`** (anonymous photo upload, server.js:1526) | **none** (public by design) |
| Misc | `POST /api/calculate`, `GET /api/dashboard/stats`, `GET /api/ai-status` | auth / role |
| Ops/public | `GET /health`, `GET /api/test` (runs `SELECT 1`, leaks `err.message`), `GET /api/status` (lists module map) | **none** |
| Non-API | `GET /r/:code` (painter referral redirect, server.js:230), `GET /share/estimate|painter-estimate|design-request/:token` (HTML, server.js:453-461), `GET /oauth/callback` (Zoho redirect, server.js:464) | **none** (by design) |

### Public / unauthenticated endpoint inventory (complete)

**Share/public-link style (token-in-URL, by design):**
- `GET /api/share/public/:token`, `.../upi-qr`, `.../pdf` (share.js:149,204,235) — customer estimate share incl. UPI QR + PDF
- `GET /api/painters/estimates/share/:token` (painters.js:369) — painter estimate share
- `GET /share/estimate/:token`, `/share/painter-estimate/:token`, `/share/design-request/:token` — static HTML shells for the above
- `GET /api/zoho/collections/pay-order/:link_id` (collections.js:1011) — payment-link lookup for payment.html (exposes invoice number, customer name, amount keyed by Zoho payment-link id)
- `GET /r/:code` — painter referral short-link redirect

**Anonymous-write (public forms):**
- `POST /api/public/design-requests` (server.js:1526) — anonymous photo upload (multer `designRequestUpload`), only global rate limit
- `POST /api/estimate-requests/` (estimate-requests.js:222) — public lead form, custom `leadSubmitLimiter`
- `POST /api/staff-registration/register` + `/check-availability` (authLimiter)
- `POST /api/painters/register`, `POST /api/engineers/register`
- `POST /api/auth/register` — **no endpoint-specific limiter**

**Anonymous-read (info endpoints):**
- `/api/guest/brands|categories|products`, `/api/public/site-info|branches|brands`
- `GET /api/website/content`, `GET /api/website/gallery` (website.js:47,79)
- `GET /api/painters/validate-referral/:code` (painters.js:355), `GET /api/painters/config/coverage-rates` (painters.js:5651)
- `GET /api/notifications/push/vapid-key` (public key)
- `GET /health`, `GET /api/test`, `GET /api/status`
- `GET /api/zoho/oauth/callback` + `/oauth/callback` (OAuth)
- OTP login flows: `/api/otp/*`, `/api/customer/auth/send-otp|verify-otp`, `/api/painters/send-otp|verify-otp`, `/api/engineers/send-otp|verify-otp`, `/api/2fa/validate` (all otpLimiter/authLimiter)

### Discrepancies vs docs

- **CLAUDE.md §4 documents three auth systems; the code has four.** `routes/engineers.js` implements an independent engineer actor: `engineer_sessions` table, `requireEngineerAuth`/`requireEngineerSession` defined in-file (engineers.js:31,55), own OTP flow — not in the CLAUDE.md auth table.
- At least 4 places re-implement manual session-token verification instead of using `requireAuth` (because they need `?token=` query support for `window.open` downloads or dual painter/admin auth): estimate-pdf.js:25-60, salary.js:999, staff-registration.js:560, painters.js:6032.
- `/api/estimates` is mounted twice (server.js:420-421): `estimate-pdf.js` first **without** mount-level auth (does its own), then `estimates.js` behind `requireAuth` — easy to misread as an unauthenticated PDF route; it is not.
- MEMORY.md says server.js is ~3,400 lines; it is 4,406 (CLAUDE.md's "~4,350" is approximately right) and still hosts 100 inline endpoints — products, users, customers, settings, design-requests, customer portal, and the whole auth core are NOT in `routes/`.


---

## 6. Business logic & services

### services/ inventory (65 files)

| File (lines) | Purpose |
|---|---|
| `activity-feed.js` (164) | Staff activity logging + notice-board feed (Socket.io) |
| `activity-tracker-service.js` (434) | Staff work-session tracking: start/stop, idle detection, live monitor |
| `ai-analyzer.js` (272) | Zoho business analyzer — collects revenue/collections/stock, AI insights |
| `ai-context-builder.js` (703) | 2-tier AI chat context (quick summary + keyword-triggered deep context) |
| `ai-engine.js` (571) | LLM abstraction: Gemini + Claude + Clawdbot(Kai via CLI); generate/stream/failover; keys from `ai_config` |
| `ai-lead-manager.js` (443) | Deterministic 0-100 lead scoring + AI enhancement, stale-lead alerts |
| `ai-marketing.js` (265) | Sales aggregation → weekly AI marketing tips |
| `ai-prompt-utils.js` (24) | `sanitizeForPrompt()` — strips control chars/code fences from user strings |
| `ai-scheduler.js` (246) | Cron orchestrator for all AI analysis jobs (schedules from `ai_config`) |
| `ai-staff-analyzer.js` (269) | Staff performance AI insights from attendance/OT/tasks |
| `anomaly-detector.js` (528) | Z-score anomaly detection: revenue/attendance/stock/collections/API |
| `app-metadata-collector.js` (269) | Scans DB schema/routes/errors for AI App Analyzer context |
| `attendance-report.js` (1052) | Daily attendance summary → WhatsApp + PDF, 22:05 IST cron |
| `audit-log.js` (94) | `record(req,{action,entity,before,after})` with redaction → `audit_records` |
| `auto-clockout.js` (579) | OT prompt + timeout auto-clockout (5-min loop) + 22:00 IST force clockout |
| `automation-registry.js` (110) | In-memory registry of all cron jobs for live dashboard |
| `billing-zoho-service.js` (187) | Zoho contact resolution + invoice push from billing; triggers points engine |
| `brand-dpl-service.js` (96) | `brand_dpl_lists` CRUD (one saved DPL row per brand) |
| `branding.js` (17) | Business branding lookup from `settings` table |
| `business-config.js` (40) | UPI/merchant config from `ai_config` with hardcoded fallbacks |
| `cluster-guard.js` (21) | `isClusterPrimary()` — only PM2 instance 0 registers crons |
| `color-extractor.js` (48) | Color-name → hex map (30+ colors) for pack-size variants |
| `customer-auth.js` (52) | Customer session create/resolve/revoke (SHA-256 tokens, 30d) |
| `data-retention-service.js` (84) | 03:30 IST purge: audit 90d, errors 90d, feed 30d, notifications 60d, OTP 7d |
| `dpl-catalog.js` (756) | **DPL↔Zoho persistent mediator** — deterministic linker, Zoho-first view (see §d) |
| `dpl-coverage.js` (27) | Unmatched-Zoho-items helper for paste/match flow (duplicated in admin-dpl.html) |
| `email-service.js` (72) | Branded nodemailer wrapper |
| `error-analysis-service.js` (496) | Stack-trace parsing, dedup, trend analysis, AI fix suggestions |
| `error-prevention-service.js` (333) | Pattern analysis, data-integrity validation, prevention reports |
| `fcm-admin.js` (155) | Firebase Admin SDK wrapper (FCM HTTP v1), invalid-token detection |
| `html-sanitizer.js` (77) | Guide rich-text sanitizer (write path + backfill share rules) |
| `lead-auto-assign-scheduler.js` (168) | 08:00 IST round-robin assignment of unassigned leads |
| `lead-reminder-scheduler.js` (83) | 08:00 IST due/overdue follow-up notifications |
| `notification-service.js` (122) | Multi-channel dispatch: in-app + Socket.io + Web Push + FCM |
| `painter-attendance-service.js` (328) | Selfie+GPS check-in, AP earning, monthly claim; queues clawback on reject |
| `painter-card-generator.js` (446) | Sharp-based visiting card (1400×800) + ID card (800×1200) v9 |
| `painter-marketing-scheduler.js` (229) | PNTR daily call-quota crons, outcome recycle windows |
| `painter-notification-service.js` (269) | Painter FCM + in-app + Socket.io rooms (`painter_{id}`) |
| `painter-points-backfill-service.js` (177) | Historical Zoho invoice points backfill (direct + salesperson), idempotent |
| `painter-points-engine.js` (642) | **Points engine** (see §b) |
| `painter-scheduler.js` (325) | Painter crons: monthly slab (1st 06:00), quarterly slab, credit overdue (08:00), streak reset, daily-bonus rotation (00:05) |
| `painter-zoho-sync-service.js` (178) | Painter→Zoho customer/salesperson sync with retry backoff (1h/4h/12h/24h) |
| `pntr-import-service.js` (233) | Zoho PNTR contact import → painter_leads (phone normalization, branch prefix) |
| `price-list-parser.js` (~2070) | **Brand DPL PDF/CSV parsers + proposed-fields engine** (see §d) |
| `price-list-pdf-generator.js` (174) | Customer price-list PDF (brand green, Noto Sans, pack normalization) |
| `production-monitor.js` (428) | Self-healing monitor: db pool test w/ backoff, memory, recovery actions |
| `purchase-suggestion.js` (530) | 3-tier PO suggestion formulas (global reorder, branch threshold, qty) |
| `reorder-compute-service.js` (152) | Auto reorder levels from 60-day velocity → `zoho_reorder_alerts` |
| `reorder-report-pdf-generator.js` (117) | Daily reorder report PDF |
| `reorder-report-service.js` (521) | Assembles per-branch/consolidated reorder reports |
| `sms-service.js` (70) | Nettyfish SMS client (POST only; no-ops if env creds missing) |
| `staff-task-generator.js` (282) | Clawdbot-generated personalized Tamil daily tasks per staff |
| `sync-scheduler.js` (591) | **Zoho background sync crons** (see §e) |
| `system-health-service.js` (346) | DB/memory/disk/API/external health checks |
| `totp-service.js` (21) | speakeasy TOTP secret + QR for staff 2FA |
| `vendor-bill-ai-service.js` (213) | Bill image OCR via Kai, item extraction + Zoho matching |
| `vendor-item-mapper.js` (347) | Scans Zoho bills → `item_vendor_map`, infers primary vendor, pushes to Zoho |
| `wa-campaign-engine.js` (449) | WhatsApp campaign executor: spin-text, warm-up, hourly/daily caps |
| `whatsapp-processor.js` (425) | `whatsapp_followups` queue processor (5-min cron, 3 retries) |
| `whatsapp-session-manager.js` (649) | Per-branch whatsapp-web.js sessions (QR pairing, message routing) |
| `zoho-api.js` (2,583) | **Zoho Books REST wrapper** — all sync + CRUD (see §e) |
| `zoho-invoice-line-sync.js` (176) | Invoice line items → `branch_item_sales` (reorder intelligence) |
| `zoho-oauth.js` (332) | OAuth2 token store/refresh in `zoho_oauth_tokens` (see §e) |
| `zoho-payments-service.js` (104) | Zoho Payments API client (separate token, payments.zoho.in) |
| `zoho-rate-limiter.js` (460) | Token bucket 80 req/min + 10k/day quota + circuit breaker + sync lock |

All services use the `setPool(pool)` injection pattern from `server.js` (no second pool).

### (a) Estimate pricing engine — `routes/estimates.js:46-135`

`calculateItemPricing(item)` (`routes/estimates.js:46-112`): `base_price` → markup → discount → single ₹10 round.
- **Markup** (4 types, lines 54-71): `price_pct` (% of unit), `price_value` (₹/unit), `total_pct` (% of line ÷ qty), `total_value` (₹ line ÷ qty). `priceAfterMarkup = base + markupAmount`.
- **Discount** (lines 75-92): same 4 types, applied **on price_after_markup**.
- **Rounding — owner-confirmed INTENTIONAL policy** (lines 94-101): the payable line total is rounded up to the nearest ₹10 exactly **once** from the *un-rounded* unit price: `lineTotal = ceil(finalPrice*qty/10)*10`; then `unitPrice = round2(lineTotal/qty)` so `unit × qty === line_total`. The old double-rounding overcharge described in CLAUDE.md §6 is **already fixed**; locked by `tests/unit/estimate-pricing.test.js`. Returned `base_price` is also ₹10-ceiled for display (line 104).

`calculateEstimateTotals(items)` (`routes/estimates.js:114-135`): `subtotal` = Σ product `line_total`; labor lines accumulate separately into `total_labor`; `grand_total = subtotal + total_labor`; `total_markup`/`total_discount` = per-unit amounts × qty.
- **`gst_amount: 0` (line 132) is INTENTIONAL, not a bug**: prices synced from Zoho are GST-**inclusive** (owner-confirmed 2026-06-04). Any upgrade must NOT add 18% on top.

Branch isolation: `estimateBranchAllowed` (lines 20-26) — admins/managers see all; NULL `branch_id` (legacy rows) accessible to all staff. Financial POSTs wrapped with `idempotent(scope)` middleware. UPI VPA now read via `services/business-config.js` (fallback to historical literal).

### (b) Painter points engine — `services/painter-points-engine.js` (642 lines)

- **Two pools**: `regular` and `annual`, cached on `painters.{regular,annual}_points` + lifetime `total_earned_*` / `total_redeemed_*` columns; every movement double-entried into `painter_point_transactions` ledger (`addPoints` :41-101, `deductPoints` :103-138, both in row-locked transactions with `FOR UPDATE`).
- **Invoice processing** `processInvoice` (:157-314): atomically claims via `INSERT IGNORE` on UNIQUE `(painter_id, invoice_id, attribution_type)` in `painter_invoices_processed` (anti-double-award race fix, :164-174). Customer billing → `regular_points_per_unit × qty` (regular pool); self billing → no regular; both → `annual_pct% × line_total` for `annual_eligible` items (:194-205). Callers: `routes/painters.js:3453,4615,4883`, `services/billing-zoho-service.js:175`, backfill service.
- **Daily bonus** (:212-271): config `painter_daily_bonus_product_id` / `_multiplier` (default 2) / `_cap` (default 500) in `ai_config`. Extra = `regular × (multiplier−1)`, capped per **IST calendar day** via `CONVERT_TZ(created_at,'+00:00','+05:30')` (:240-244, the DB session is UTC). Bonus also gets the level multiplier (:268-271).
- **Level multipliers** `addPointsWithMultiplier` (:571-589): multiplier from `painter_levels` table; level-up check on lifetime earned (regular+annual) (:591-613, resets card images). **Authoritative tiers** (`migrations/migrate-painter-retention.js:42-45`): bronze 0 → 1.00×, silver 5,000 → 1.20×, gold 25,000 → 1.50×, diamond 100,000 → 2.00×. **There is NO platinum tier.**
- **Clawback** (:615-620 + :44-65): `queueClawback` inserts `painter_clawback_pending` (used by `painter-attendance-service.js:213` on rejected check-ins); future **regular**-pool credits are netted against pending clawbacks *before* the award transaction — absorbed amounts produce **no ledger entry** (transparency gap).
- **Referrals** (:14-19, :273-297): referrer earns % of referred painter's invoice total into regular pool — 0.5% base, 1.0% ≥3 bills, 1.5% ≥5, 2.0% ≥10.
- **Slabs** (:320-403): monthly/quarterly purchase-total slabs award **annual** points; idempotent per `(painter, period_type, period_label)` via `painter_slab_evaluations`. Run by `painter-scheduler.js` crons.
- **Credit** `checkOverdueCredits` (:409-466): if oldest self-billing invoice > `painter_credit_overdue_days` (default 30), auto-debits `credit_used` from regular then annual pool. Note: query does not filter by paid/unpaid status and `credit_used` is not reset after debit.
- Tests exist: `tests/unit/painter-points-engine.test.js`.

### (c) Salary calculation — `routes/salary.js:510-690`

- **Basis**: `hourlyRate = monthly_salary / 260` (26 days × 10h) — `routes/salary.js:532`. `dailyRate = hourlyRate × 10` (:588).
- **Weekday**: paid minutes capped at 600/day (`LEAST(total_working_minutes,600)`, :546-547); computed OT = minutes beyond 600 (:550-551) but **pay uses only `ot_approved_minutes`** × `overtime_multiplier` (config, default 1.5) (:554, :596). Unapproved weekday OT is reported in `total_overtime_hours` but unpaid.
- **Sunday — owner-confirmed policy (RT-039, 2026-06-09)**: standard capped at 300 min = 1 full day (`sunday_hours/5 × dailyRate`, :548-549, :590 — i.e., Sunday hours effectively pay 2× hourly). Sunday OT minutes beyond 300 are **doubled in SQL** (`(mins-300)*2`, :552-553) and then paid at plain `hourlyRate` (:597) — **the SQL ×2 IS the entire 2× double-time premium; it must NOT be multiplied again by `overtime_multiplier`** (the old bug paid 3× = 2×1.5).
- **Deductions — owner-confirmed policy (RT-040)**: a standard day is **always 10h** matching the /260 basis; absence = `absent_days × hourlyRate × 10` (:617-620); leave policy = 1 free Sunday + 1 free weekday leave/month, excess × `hourlyRate × 10` (:579-583, :623). The `staff_salary_config.standard_daily_hours`/`sunday_hours` columns (defaults at :377-379) are no longer used by the deduction math but still exist/editable.
- Late deduction per `late_days × late_deduction_per_hour` when enabled (:607-610); incentives summed from approved `staff_incentives` (:628-634). Upsert into salary records via `ON DUPLICATE KEY UPDATE` (:642-677). Month boundaries computed with local getters, not `toISOString` (IST-safe, :512-514). Tests: `tests/unit/salary-calc.test.js`.

### (d) DPL pricing pipeline — parser → dpl_catalog → routes

**Rate formula (canonical, 3 places, all identical)**: `ceil(DPL × 1.18 × 1.10)` (18% GST × 10% markup, whole rupee) — `services/price-list-parser.js:1007` (`computeProposedFields`), `services/dpl-catalog.js:744-747` (`computeZohoRate`, also inline :285, :343, :376), `routes/item-master.js:45-49` (`calculateSalesPrice`). On apply, `purchase_rate = DPL`, `cf_dpl = DPL`, `rate = formula`.

**`services/price-list-parser.js`** (~2070 lines): brand PDF parsers → unified `{brand, product, packSize, dpl, baseCode?, category?}` — `parseAsian:58`, `parseBirlaOpus:134`, `parseBirlaOpusTabular:265`, `parseBerger:363`, `parseGem:479`, `parseJSW:566`, `parseNippon:645`; dispatcher `parsePriceList:792`; Birla CSV parsers `:1359/:1480/:1544`; `matchWithZohoItems:1557` (rate-anchored fuzzy expansion — the legacy pre-catalog path); `buildBirlaName:1303` (ALL-CAPS naming rules); `computeProposedFields:1005`.

**`services/dpl-catalog.js`** — persistent per-brand mediator table `dpl_catalog`, replacing fuzzy matching:
- `normalizeSizeTier` (:20-41): **size-tier equivalence** 900ml/0.9L→1L, 3.6L→4L, 9L→10L, 18L→20L; other sizes verbatim.
- Linker `linkEntryToZoho` (:188-239), strategies in priority order: SM curated colorant `PRODUCT_CODE_SKU` map (:108-113, conf 95) → S0 exact canonical SKU (conf 100) → **S1 SKU-reconstruction** (DPL `baseCode` stem + per-tier size code `{1L:'01',4L:'04',10L:'10',20L:'20'}` == Zoho SKU; conf 95, validated 245 clean/0 ambiguous) → S2 name-tokens+tier (conf 70, `review` only) → `needs_creating`. Ambiguity never guesses.
- Rebuild `buildCatalogFromDpl` (:270-330) **preserves pinned links** (`link_reason='user-confirmed'` or `pushed_at` set) across rebuilds; `deleteOrphans` (:393-400) self-cleans but no-ops on empty keep-set; `unlinkMarked` (:547-555) keeps user "not-in-Zoho" marks.
- `applyDplPrices` (:334-366): re-keys a new DPL onto pinned entries by `match_key` → `{updated, newNeedsLinking, noDplThisTime}` diff buckets, local-only price update.
- `buildPushChanges` (:373-388): always pushes `cf_dpl`/`purchase_rate`/`rate`; name/sku/description/category only when canonical differs from current Zoho (avoids SKU-collision churn).
- **Zoho-first reconciliation view** `buildZohoFirstView` (:575-683): inverts to one row per active Zoho item; statuses `unmatched`/`matched(changed)`/`shared`/`matched(unchanged)`; carries pushed-state, `sku_conflict`, `dpl_disposition`; reverse matcher `proposeDplForZoho` (:696-740) auto-proposes the best unlinked DPL entry (same S0/S1/S2, never ambiguous). Pure functions — unit-tested in `tests/unit/dpl-catalog*.test.js` (5 files) + ~10 more `dpl-*` test files.

**`routes/zoho.js` catalog endpoints** (all `requirePermission('zoho','manage')`): build `:125`, read `:161`, **by-zoho** `:223` (Zoho-first tab), confirm-link `:268`, edit canonicals `:284`, not-in-zoho `:304`, apply-prices `:320`, **push** `:356` (filters unconfirmed/no-DPL, excludes duplicate-SKU holders and already-pushed-unchanged, creates a `zoho_bulk_jobs` bulk-edit job, stamps `markPushed`), single-item edit/push `:475/:517`, **disposition** `:558` (`pending`/`done`/`later` on `zoho_items_map.dpl_disposition`, audit-logged). Brand support is gated to **`birlaopus` only** (`BRAND_DISPLAY_NAMES`, `routes/zoho.js:92-94`); Zoho candidate scope via brand/name LIKE (`:112-114`). `routes/item-master.js` keeps the older 5-tab DPL flow (dpl-parse/dpl-match/dpl-apply `:502-590`, versions, price history, NotebookLM query).

### (e) Zoho sync — `services/zoho-api.js`, `zoho-oauth.js`, `zoho-rate-limiter.js`, `sync-scheduler.js`, `routes/zoho.js`

- **cf_* wrapping (load-bearing)**: Zoho ignores top-level `cf_*` keys; `updateItem` (`zoho-api.js:1690-1705`) and `createItem` (`:1666-1681`) transform any `cf_*` payload key into `custom_fields:[{api_name,value}]` before PUT/POST. Any new item-write path must go through these.
- **Sync clobber protection**: Zoho's GET /items *list* endpoint omits `custom_fields`, so `syncItems`' upsert uses `COALESCE(VALUES(zoho_cf_dpl), zoho_cf_dpl)` (and same for `zoho_cf_product_name`) to preserve locally-pushed values (`zoho-api.js:1389-1394`).
- **Token refresh** (`zoho-oauth.js:77-133`): refresh-token grant against accounts.zoho.in; stores in `zoho_oauth_tokens` with expiry = `expires_in − 300s`; bootstrap fallback to `ZOHO_REFRESH_TOKEN` env (:64-71).
- **Rate limiting** (`zoho-rate-limiter.js:19-61`): token bucket 80/min (Zoho hard limit 100), daily quota 10,000 with 500-call reserve, circuit breaker opens at 9,000, in-process **sync lock** prevents overlapping heavy ops, daily count persisted to DB every 25 calls.
- **Scheduler** (`sync-scheduler.js`, all crons `Asia/Kolkata`, guarded by `isClusterPrimary()` :430): quick sync (customers+invoices+payments, ~8-15 calls) every `sync_interval_minutes` from `zoho_config` (default 60, :443); heavy stock sync at 02/06/12/18 IST (:502 — items → locations → location stock → reorder alerts → expenses/credit-notes 90d window, :196-240); bulk-job processor every 5 min (:520, drives the DPL push jobs in `zoho_bulk_jobs`); invoice-line sync 02:00 (:527); reorder compute 02:30 (:534); reorder report 07:00 (:541); optional daily P&L report. Each cycle checks: enabled flag, in-flight `zoho_sync_log` row, quota headroom (`canStartHeavyOperation`), circuit breaker, sync lock (:98-129).
- **Startup gating** (`server.js:4341-4374`): only Zoho-dependent services (sync-scheduler, whatsapp-processor/sessions, wa-campaign-engine) are gated on `ZOHO_ORGANIZATION_ID`; AI/painter/retention/lead/health schedulers now always start (SVC-001/007 fix) with a loud skip warning otherwise.

### Doc-drift found (code is truth)

| Claim | Reality |
|---|---|
| CLAUDE.md §6: estimates have "double ₹10 rounding (line 95-97)" | Fixed — single-round, `routes/estimates.js:94-101`, test-locked |
| CLAUDE.md §10: "estimates/painter-points… untested" | `tests/unit/estimate-pricing.test.js`, `painter-points-engine.test.js`, `salary-calc.test.js`, ~15 `dpl-*` test files exist (49 unit test files total) |
| CLAUDE.md §3: "Background schedulers only start if ZOHO_ORGANIZATION_ID" | Only Zoho-dependent ones gated now (`server.js:4341-4374`) |
| `routes/zoho.js:443-445` comment: item-master uses `version_id` → "Unknown column" latent bug | `routes/item-master.js:561` actually inserts the correct `dpl_version_id` column (value sourced from `item.version_id`); comment is stale |
| MEMORY: painter-points-engine = 550 lines | 642 lines |


---

## 7. Database

### How the schema is managed

There is **no schema.sql**. The live DB (`qc_business_manager`, MariaDB 10.11) is the product of three layers:

1. **Legacy bootstrap (pre-Feb 2026, now in `archive/`)** — core tables (`users`, `user_sessions`, `branches`, `settings`, `brands`, `categories`, `products`, `customers`, `estimates`, `estimate_items`, `estimate_settings`, `estimate_status_history`, `audit_log`, `leads`, `lead_followups`, `pack_sizes`, `staff_attendance`, `attendance_photos`, `attendance_permissions`, `shop_hours_config`, salary tables, `otp_verifications`, `staff_tasks`, …). DDL only exists in `archive/old-schemas/*.sql` and `archive/migrations/setup-database.js` — these files are NOT runnable migrations.
2. **Incremental migrations** — `migrations/` contains **120 files: 119 `.js` + 1 dead `.sql`** (`add_missing_indexes.sql`; `migrate.js:60` filters `.js` only, so it can never run). CLAUDE.md/COMPLETION_STATUS.md still say "118 files" — doc drift.
3. **Tables with NO DDL anywhere in the repo** — the core Zoho sync tables (`zoho_items_map`, `zoho_customers_map`, `zoho_invoices`, `zoho_payments`, `zoho_daily_transactions`) were created manually on prod. (`roles`/`permissions`/`role_permissions` DDL *does* exist in `docs/database-complete-schema.sql:49,79,169` — a partial 26-table snapshot from Feb 2026.) The Zoho tables' shape is only recoverable from INSERT/SELECT statements in code (e.g. `services/zoho-api.js:336-341` for `zoho_invoices`, `:437-441` for `zoho_customers_map`, `:513-518` for `zoho_payments`; `routes/zoho.js:2459-2464` for `zoho_items_map`) and from many ALTERs in migrations. **A fresh dev DB cannot be bootstrapped from the repo today.**

`scripts/empty-tables-report.json` (a prod snapshot dated 2026-03-06) recorded **146 tables**; ~50+ tables have been added since (DPL catalog, reorder, PNTR marketing, painter AP attendance, engineers, payment_links, zoho_expenses…), so the current count is likely 190+.

### migrate.js runner (`migrate.js`, 224 lines)

| Command | Behavior |
|---|---|
| `node migrate.js` | Runs pending `.js` files alphabetically; records each in `_migrations (id, name UNIQUE, applied_at)`; **stops on first failure** |
| `node migrate.js --status` | Lists applied vs pending per file |
| `node migrate.js --mark-existing` | INSERTs every untracked filename into `_migrations` without running it |

Two file patterns coexist:
- **`exports.up(pool)` pattern** — only **22 of 119** files (all recent: `migrate-dpl-catalog.js`, `migrate-idempotency.js`, `migrate-audit-log.js`, `migrate-customer-sessions.js`, `migrate-composite-indexes.js`, `migrate-soft-delete-financial-items.js`, date-prefixed `20260515_*`/`20260518_*`/`20260519_*`, …). These are the only ones the runner can actually execute.
- **Self-contained scripts** — **86 files** create their own pool and call `process.exit()`. Since commit `c1f2f2f` (2026-05-22) `migrate.js:139-155` pre-scans the source and **refuses** to `require()` them (they must be run directly: `node migrations/<file>.js`, then marked).
- **Hazard: 11 files match NEITHER pattern** (no exports, no `process.exit`): `fix-collation-standardize.js`, `fix-missing-indexes.js`, `migrate-credit-limit-requests.js`, `migrate-lead-type.js`, `migrate-offer-bonus-pct.js`, `migrate-otp-password-reset-enum.js`, `migrate-pack-sizes-color.js`, `migrate-painter-cart-markup.js`, `migrate-painter-custom-rates.js`, `migrate-painter-saved-direct.js`, `migrate-stock-verifications.js`. The runner `require()`s them — **their top-level `migrate()` side-effects execute immediately** — then logs "REFUSING … No up() export", counts them failed, and their private pools never close. The migration runs but is never recorded.

Migration file naming spans 3 generations: `migrate-<feature>.js`, `fix-*`/`add-*`/`backfill-*`/`resync-*`, and (since May 2026) date-prefixed `YYYYMMDD_name.js`.

### Prod `_migrations` tracking gap

Prod's `_migrations` table only has rows for migrations applied **on/after 2026-04-30** (everything earlier was run manually pre-runner). Therefore `node migrate.js --status` on prod **falsely reports ~80 PENDING**. Documented workaround (memory + CLAUDE.md §7): for genuinely new migrations, run the file directly then `INSERT IGNORE` a marker row; never blind-run the "pending" backlog (most are non-idempotent in aggregate and `--mark-existing` would also mark genuinely-new files).

### Table inventory by domain (~185 known tables)

| Domain | Tables | DDL source |
|---|---|---|
| **Staff / attendance / salary** | `users`, `user_sessions`, `branches`, `settings`, `staff_attendance`, `attendance_photos`, `attendance_permissions`, `shop_hours_config`, `outside_work_periods`, `prayer_periods`, `attendance_daily_reports`, `overtime_requests`, `staff_salary_config`, `monthly_salaries`, `salary_payments`, `salary_adjustments`, `staff_leave_balance`, `staff_incentives`, `incentive_slabs`, `staff_activities`, `staff_tasks`, `task_updates`, `staff_activity_sessions`, `staff_idle_alerts`, `staff_activity_feed`, `admin_notices`, `staff_daily_ai_tasks`, `otp_verifications`, `password_reset_tokens` | archive + `migrate-ot-approval/overtime/prayer-and-reports/activity-tracker/notice-board/staff-*` |
| **Leads / collections / credit** | `leads`, `lead_followups`, `collection_reminders`, `payment_promises`, `lead_conversion_predictions`, `ai_lead_scores`, `credit_limit_requests`, `customer_credit_history`, `credit_limit_violations` | archive `database-upgrade.sql` + `migrate-collections/credit-limit*/lead-scoring-upgrade` |
| **Estimates / billing / payments** | `customers`, `customer_types`, `estimates`, `estimate_items`, `estimate_settings`, `estimate_status_history`, `estimate_requests`(+photos/products/activity), `billing_estimates`, `billing_estimate_items`, `billing_invoices`, `billing_invoice_items`, `billing_payments`, `payment_links` | archive + `migrate-billing.js`, `20260518_add_payment_links.js`, many ALTERs (`migrate-estimate-enhancements/discount/payment-po/columns`) |
| **Vendors / purchasing** | `vendors`, `vendor_bills`, `vendor_bill_items`, `vendor_payments`, `vendor_purchase_orders`, `vendor_po_items`, `item_vendor_map`, `vendor_mapping_scans` | `migrate-vendors.js`, `migrate-vendor-item-mapping.js` |
| **Painter loyalty / app** (45+ tables) | `painters`, `painter_sessions`, `painter_point_transactions`, `painter_referrals`, `painter_product_point_rates`, `painter_value_slabs`, `painter_withdrawals`, `painter_attendance`, `painter_invoices_processed`, `painter_slab_evaluations`, `painter_levels`, `painter_daily_checkins`, `painter_estimates`, `painter_estimate_items`, `painter_estimate_sequence`, `painter_quotations`(+items), `painter_custom_rates`, 6× `painter_catalog_*`, `painter_special_offers`, `painter_fcm_tokens`, `painter_notifications`, `painter_training_*`(2), `painter_gallery`, `painter_price_reports`, `painter_product_requests`, `painter_calculations`, `painter_badges`, `painter_earned_badges`, `painter_challenges`, `painter_challenge_progress`, `painter_visualization_requests`, `painter_location_events` | `migrate-painters.js` + 15 follow-ups |
| **Painter AP attendance** | `painter_attendance_checkins`, `painter_attendance_monthly`, `painter_attendance_ledger`, `painter_clawback_pending` | `migrate-painter-attendance.js` |
| **PNTR painter marketing** | `painter_leads`, `painter_lead_followups`, `painter_daily_assignments`, `painter_marketing_config`, `painter_zoho_salesperson_map`, `painter_pntr_import_runs`, `painter_lead_duplicate_queue`, `painter_zoho_sync_queue` | `migrate-pntr-painter-marketing.js` |
| **Engineers** (4th session-bearing actor, added 2026-05-12, NOT in CLAUDE.md §4 auth table) | `engineers`, `engineer_sessions`, `engineer_custom_rates`, `engineer_default_rates`, `engineer_hidden_items` | `migrate-engineers.js`, `migrate-engineer-rates/catalog.js`; used in `routes/engineers.js` |
| **Products / item-master / DPL** | `brands`, `categories`, `products`, `pack_sizes` (+`color_name`/`color_code`, zoho mapping), `item_naming_rules`, `dpl_versions`, `dpl_price_history`, `dpl_catalog`, `brand_dpl_lists` | archive + `migrate-item-master.js`, `migrate-dpl-catalog*.js`, `migrate-brand-dpl-lists.js` |
| **Reorder / stock** | `branch_item_sales`, `brand_reorder_config`, `invoice_line_sync_cursor`, `reorder_report_log`, `reorder_snoozes`, `stock_check_assignments`, `stock_check_items`, `stock_verifications` | `migrate-reorder-intelligence.js`, `migrate-stock-check*.js` |
| **Zoho sync maps** | `zoho_items_map`★, `zoho_customers_map`★, `zoho_invoices`★, `zoho_payments`★, `zoho_daily_transactions`★, `zoho_expenses`, `zoho_credit_notes` (★ = no DDL in repo) | manual on prod + `20260515_add_zoho_expenses_creditnotes.js` |
| **WhatsApp** | `whatsapp_messages`, `whatsapp_contacts`, `whatsapp_sessions`, `wa_campaigns`, `wa_campaign_leads`, `wa_message_templates`, `wa_sending_stats`, `wa_marketing_settings`, `wa_contact_groups`, `wa_contact_group_members`, `wa_instant_messages` | `migrate-whatsapp-*/wa-*.js` |
| **AI / config** | `ai_config` (de-facto app-wide KV config — billing/painter/reorder keys all live here, not just AI), `ai_conversations`, `ai_messages`, `ai_analysis_runs`, `ai_insights`, `ai_business_context`, `ai_suggestions` | `migrate-ai-tables.js`, `migrate-ai-assistant-upgrade.js` |
| **System / infra** | `_migrations`, `idempotency_records`, `audit_records` (new) **and** legacy `audit_log` (both exist), `customer_sessions`, `error_logs`, `system_health_checks`, `code_quality_metrics`, `bug_reports`, `fix_suggestions`, `detected_anomalies`, `production_health_snapshots`, `admin_notifications`, `notifications`, `guides`/`guide_categories`/`guide_versions`/`guide_views`/`guide_favorites` | `migrate.js:40-48`, `migrate-idempotency/audit-log/customer-sessions/error-prevention/bug-reports/anomaly-detection/production-monitor/guides-system` |

### Central tables — key columns & relationships

- **`users`** (archive/migrations/setup-database.js:223) — `username` UNIQUE, `password_hash` (bcrypt), `role ENUM('admin','manager','staff','customer','guest')`, `branch_id`, `status`. TOTP columns added by `20260518_add_totp_to_users.js`. Roles beyond the ENUM (e.g. `super_admin`) handled in app code.
- **`user_sessions`** (archive …:334) — `user_id` FK CASCADE, `session_token` VARCHAR(255) UNIQUE **(raw, legacy)**, `token_hash` CHAR(64) added + backfilled `LOWER(SHA2(token,256))` by `migrations/migrate-session-token-hash.js` (raw column deliberately left for rollback — still present), `ip_address`, `user_agent`, `expires_at`, `last_activity`.
- **`customer_sessions`** (`migrate-customer-sessions.js`) — hash-only design: `token_hash` CHAR(64) UNIQUE, `customer_id` NULL, `phone`, `expires_at`, `revoked_at` (soft-revoke), `ip_address`, `user_agent`.
- **`painters`** (`migrate-painters.js:21-59`) — `phone` UNIQUE, `referral_code` UNIQUE, `referred_by`, `status ENUM(pending/approved/suspended/rejected)`, credit fields (`credit_enabled/limit/used/overdue_days`), **denormalized point balances** (`regular_points`, `annual_points`, `total_earned_*`, `total_redeemed_*`) that must stay consistent with the ledger, `zoho_contact_id`. Later ALTERs add branch, level, profile, salesperson sync fields.
- **`painter_point_transactions`** (`migrate-painters.js:83-100`) — append-only ledger: `pool ENUM('regular','annual')`, `type ENUM(earn/redeem/debit/adjustment/expired)`, `amount`, **`balance_after`**, `source ENUM(self_billing/customer_billing/referral/attendance/monthly_slab/quarterly_slab/withdrawal/credit_debit/admin_adjustment)`, `reference_id/type`, FK→painters CASCADE. Composite idx `(painter_id, created_at DESC)` added in audit sprint.
- **`painter_sessions`** (`migrate-painters.js:66-77`) — `token` VARCHAR(255) UNIQUE **(raw, legacy — flagged P2-4)** + `token_hash` CHAR(64) (same hash migration), `otp`/`otp_expires_at`, 30-day `expires_at`, FK CASCADE.
- **`painter_estimates`** (`migrate-painter-estimates.js:21-62`) — `billing_type ENUM('self','customer')`, dual money columns (`subtotal/gst_amount/grand_total` + `markup_*` triplet), 9-state `status` ENUM ending `pushed_to_zoho`, payment fields, `zoho_invoice_id/number`, `points_awarded` + `regular/annual_points_awarded`, `share_token`(+expiry). Child `painter_estimate_items` has `zoho_item_id`, `unit_price`/`markup_unit_price`, FK CASCADE, **`deleted_at`** (soft delete).
- **`estimates`** (archive DDL + heavy ALTERs) — base: `estimate_number` UNIQUE, customer denorm fields, `subtotal/gst_amount/discount_amount/grand_total`, `status`. `migrate-estimate-enhancements.js:43-50` added `total_markup/total_discount/total_labor/admin_notes/branch_id` (branch_id is **all-NULL in prod** — isolation uses NULL-allowance); `migrate-estimate-payment-po.js` added `payment_status/method/reference/amount/recorded_by/at`, `billing_invoice_id`. `estimate_items` gained `item_type ENUM('product','labor')`, `zoho_item_id`, `item_name`, `brand`, … and `deleted_at`.
- **`billing_invoices`** (`migrate-billing.js:72-104`) — `invoice_number` UNIQUE, `branch_id` NOT NULL, `customer_type ENUM('customer','painter')`, `source ENUM('direct','estimate')`, `amount_paid`/`balance_due`, `payment_status ENUM(unpaid/partial/paid)`, `zoho_status ENUM(pending/pushed/failed)` + `zoho_invoice_id`. Children `billing_invoice_items`/`billing_payments` FK CASCADE; `billing_payments.payment_method ENUM(cash/upi/bank_transfer/cheque/credit)`. Sibling `billing_estimates` → `converted_to_invoice_id`.
- **`dpl_catalog`** (`migrate-dpl-catalog.js`) — DPL↔Zoho mediator: one row per canonical `(brand, product, base, size_tier)` identified by single `match_key` UNIQUE; `zoho_item_id` = pinned push target; `canonical_name/sku/description`, `current_dpl/current_rate`, `link_status ENUM('confirmed','review','needs_creating')` + `link_confidence/reason`; push tracking `pushed_at/pushed_job_id/pushed_dpl/pushed_rate` (`migrate-dpl-catalog-push-tracking.js`); `not_in_zoho` flag (`migrate-dpl-catalog-not-in-zoho.js`).
- **`zoho_items_map`** (no DDL; columns from `routes/zoho.js:2459+` and ALTERs) — `zoho_item_id` key, `zoho_item_name/sku/rate/purchase_rate/label_rate/unit/description/hsn_or_sac/tax_percentage/brand/category_name/manufacturer/reorder_level/stock_on_hand/cf_dpl/status`, `last_synced_at`, plus migration-added `image_url`, `dpl_updated_at`, `preferred_vendor_id`, `last_purchase_rate`, `vendor_pushed_at`, `dpl_disposition/_at/_by` (`add-zoho-dpl-disposition.js`).
- **`leads`** (archive `database-upgrade.sql:172-206`) — `lead_number` UNIQUE, `lead_source`/`lead_type ENUM(hot/warm/cold)`/8-state `status` ENUM, `assigned_to`/`branch_id`/`created_by` FKs→users/branches, `next_followup_date`, `converted_customer_id`. Child `lead_followups` FK CASCADE.
- **`painter_leads`** (`migrate-pntr-painter-marketing.js:11-40`) — `phone` UNIQUE, `zoho_customer_id`, 10-state `status`, recycling fields (`next_eligible_date`, `total_attempts`), `branch_detected_via` ENUM. **No FKs** on `painter_id/branch_id/assigned_to`.
- **`painter_attendance_checkins`** (`migrate-painter-attendance.js`) — `UNIQUE (painter_id, checkin_date)` (one per day), GPS `latitude/longitude` + `distance_meters`, `selfie_path`, `points_awarded` default 100, `month_key CHAR(7)`; rollup `painter_attendance_monthly` UNIQUE `(painter_id, month_key)` with claim window/status, append-only `painter_attendance_ledger` (`earn/claim/clawback/forfeit`), `painter_clawback_pending`.
- **`idempotency_records`** (`migrate-idempotency.js`) — `key_hash` CHAR(64) UNIQUE (SHA-256 of scope+key), `scope`, stored `response_status/response_body`, `expires_at` (24h TTL), indexes on scope/expires_at/user_id.
- **`audit_records`** (`migrate-audit-log.js`) — BIGINT PK, `actor_type`, `action`, `entity_type/entity_id`, `before_json/after_json` LONGTEXT, `ip/user_agent/request_url`; indexes on ts/entity/user/action. Legacy `audit_log` table still exists untouched.

### Soft delete (audit sprint U18)

`migrations/migrate-soft-delete-financial-items.js` added `deleted_at TIMESTAMP NULL` + `idx_<table>_deleted_at` (ALGORITHM=INPLACE, LOCK=NONE) to exactly 4 financial item tables: **`billing_estimate_items`, `billing_invoice_items`, `painter_estimate_items`, `estimate_items`**. App code stopped issuing `DELETE FROM` on these (6 write paths converted, 22 read paths filter `deleted_at IS NULL`). No other tables use soft delete; parents (estimates/invoices) are NOT soft-deleted.

### Index migrations

- **`migrate-composite-indexes.js` (U7, audit sprint)** — 12 composite indexes, each tied to a hot query: `staff_attendance(user_id,date)`, `painter_estimates(painter_id,status,created_at DESC)` + `(status,created_at DESC)`, `painter_point_transactions(painter_id,created_at DESC)`, `leads(branch_id,status,next_followup_date)` + `(assigned_to,status)`, `zoho_invoices(local_branch_id,invoice_date)`, `zoho_payments(local_branch_id,payment_date)`, `staff_tasks(assigned_to,status,due_date)`, `notifications(user_id,read_at,created_at DESC)`, `ai_messages(conversation_id,created_at DESC)`, `painter_attendance_checkins(painter_id,checkin_date)`. Defensive: skips missing tables/columns/existing names; INPLACE/LOCK=NONE with fallback. Memory records **9 of 12 actually added on prod**.
- **`fix-missing-indexes.js`** — 7 earlier single-column indexes (`zoho_daily_transactions.transaction_type`, `zoho_invoices.zoho_contact_id`, `zoho_payments.zoho_contact_id`, `staff_tasks.created_at`, `ai_messages.created_at`, `stock_check_assignments.submitted_at`, `painter_estimates.created_at`). One of the 11 "NEITHER-pattern" files.

### Conventions & drift notes

- Engine/charset: mostly `ENGINE=InnoDB CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`, but several tables omit COLLATE (`painter_attendance_*`, `zoho_expenses`, `zoho_credit_notes`, `payment_links`, `whatsapp_messages` uses `CHARACTER SET` form) and earliest painter tables omit ENGINE/CHARSET entirely. `fix-collation-standardize.js` exists but newer migrations regressed.
- FK discipline is inconsistent: painter core + billing items use FKs; PNTR marketing, reorder, and most `zoho_*` tables have none (joins by VARCHAR Zoho IDs).
- Money is `DECIMAL(12,2)` (line items `DECIMAL(10,2)` unit prices); points are `DECIMAL(12,2)` except AP attendance which uses INT points.
- Two KV config stores: legacy `settings` and `ai_config` (`config_key`/`config_value`) — all new feature config seeds into `ai_config` regardless of domain.
- Session timezone forced to `+00:00` in `config/database.js` while server clock is IST — `DATE`/`TIMESTAMP` semantics depend on this; `month_key CHAR(7)` / `checkin_date DATE` columns are IST-derived in app code.


---

## 8. Frontend

### Page inventory (159 HTML files, ~6.5 MB total)

`public/` is a no-framework frontend: every page is a self-contained HTML file with inline `<style>` and inline `<script>` (often thousands of lines). Zero hits for React/Vue/Alpine. 123 pages at `public/` root + 36 in subdirectories.

| Group | Count | Notes |
|---|---|---|
| `admin-*` | 74 | Largest group; purple brand |
| Staff | 23 | 9 root `staff-*.html` + 14 in `public/staff/` (dashboard, clock-in/out, collections, stock-check, salary, tasks…) |
| `painter-*` | 8 | login, register, dashboard, catalog, estimate-create, profile, attendance, training |
| `engineer-*` | 7 | A 4th actor portal (login, register, dashboard, catalog, cart, new-quote, profile) — only actor whose page JS/CSS is externalized (`public/js/engineer-portal.js` 16.3KB, `public/css/engineer-portal.css` 18.1KB). Not covered in CLAUDE.md §4 auth table |
| Estimates | 7 | `estimates.html`, `estimate-{create-new,edit,view,print,actions,settings}.html` (`estimate-edit.html` is a redirect shim to `estimate-create-new.html?id=`) |
| `customer-*` | 4 | dashboard, estimate-view, login, requests |
| `public/share/` | 3 | tokenized public shares: estimate, painter-estimate, design-request |
| `public/components/` | 17 | HTML fragments injected at runtime: `sidebar-complete.html` 79.6KB, `staff-sidebar.html` 48.7KB, `header-v2.html` 32.2KB, 12 subnavs, 2 quick-action panels |
| `public/docs/` | 2 | attendance-guide-tamil (84.7KB), wa-marketing-guide |
| Other root | 14 | 404, index, login, dashboard, chat, forgot/reset-password, register, request-estimate, payment, payment-receipt, privacy-policy, offline, birla-opus-report |

**Largest pages** (file size; complexity proxy): `admin-dpl.html` 333.6KB / 5,490 lines; `admin-painters.html` 322.3KB / ~5,000 lines; `admin-zoho-reorder.html` 201.4KB; `staff/dashboard.html` 197.8KB / 3,477 lines; `admin-products.html` 196.7KB / 2,910 lines; `admin-zoho-items-edit.html` 180.8KB; `painter-dashboard.html` 151.4KB / 2,278 lines; `birla-opus-report.html` 134.8KB (plus a 2.6MB PDF sitting in `public/`); `admin-zoho-dashboard.html` 132.9KB; `admin-ai.html` 125.7KB.

### Shared assets — usage measured by include-count across all 160 pages

| Asset | Size | Pages | Purpose |
|---|---|---|---|
| `public/js/auth-helper.js` | 11.3KB | **91** | Staff/admin auth: localStorage Bearer token, `apiRequest`/`apiFetch` with 401 auto-logout, role gates (`requireAdminOrRedirect`, `requireFullAdminOrRedirect`, `FULL_ADMIN_ROLES`), fire-and-forget `validateSession()` → `/api/auth/me`, **auto-registers `/sw.js` + Web-Push VAPID subscribe on every load** (`auth-helper.js:177-264`) |
| `public/universal-nav-loader.js` | 18.9KB | **88** | Runtime `fetch()`+`innerHTML` injection of header/sidebar/subnav fragments; role-based sidebar pick (admin vs staff) from localStorage; 3× retry; `data-page`→subnav map |
| `public/css/design-system.css` | 30.5KB / **1,388 lines** | 77 | CSS variables + components (docs claim 1,274 lines — file has grown since) |
| `public/css/tailwind.css` | **928KB** | 101 | Built utility CSS (see pipeline below) |
| `public/js/qc-ui.js` + `css/qc-ui.css` | 6.6+5.2KB | **0** | `qcToast/qcConfirm/qcAlert/qcSheet/qcChip` primitives — **documented as shipped but no page includes them**; only `share-pdf.js` references `qcToast` behind a `window.qcToast` guard falling back to `alert()` |
| `public/js/ui-skeletons.js` + `css/skeletons.css` | 4.7+2KB | **1** (`admin-leads.html`) | Skeleton/empty-state helpers — never rolled out |
| `public/js/idempotency-fetch.js` | 1.5KB | **2** (`estimate-create-new.html`, `estimates.html`) | `qcIdempotencyKey()` UUID per submit; server has 16 idempotent financial POSTs but only estimates send the header |
| `public/js/share-pdf.js` | 3.6KB | 3 | Web Share API PDF→WhatsApp with download+wa.me fallback; sanitizes fallback URL to http(s) |
| `public/js/wa-quick-send.js` | 21.3KB | 2 | WhatsApp quick-send modal (collections/leads) |
| `public/js/stock-filters.js` + css | 20.2+6.8KB | 3 | Stock pages filter UI |
| `public/js/painter-i18n.js` + `public/i18n/painter-{en,ta}.json` | 2KB | 5 | Painter EN/Tamil i18n (painter pages only) |
| `public/css/painter-dark.css` | 2.6KB | 5 | Painter dark mode |
| `public/js/purify.min.js` (DOMPurify) | 21KB | **1** (`staff/guides.html`) | HTML sanitizer — present but unused elsewhere |
| `public/js/mobile-init.js` + `css/mobile.css` | 4+5.7KB | **0** | Dead code |
| `public/js/error-prevention.js` | 7.9KB | **0** | Dead code |
| `public/js/socket-helper.js` | 2.3KB | 4 | Socket.IO wiring (socket.io referenced in 11 pages total) |
| `public/js/permissions.js` | 7.1KB | 2 | Client-side permission gating |
| `public/app.js`, `public/estimates.js` | 20.9 / 24.9KB | root-level legacy page scripts | |
| `public/sw.js` + `manifest.json` | 6.2KB | — | PWA (below) |

### Tailwind pipeline — CDN migration is COMPLETE (docs are stale)

- `npm run build:css` = `tailwindcss -i ./src/tailwind-input.css -o ./public/css/tailwind.css --minify && node scripts/stamp-css-version.js`; also runs on `postinstall`. `src/tailwind-input.css` is just the 3 `@tailwind` directives.
- `tailwind.config.js` scans `public/**/*.{html,js}` and carries a **very broad regex safelist** (every color×shade for bg/text/border, all spacing/sizing/grid/font scales) — the main reason the output is 928KB. Brand tokens defined: `qcgreen` (#1B5E3B/#154D31/#0D3D23), `qcgold` (#D4A24E), `admin.{primary #667eea, secondary #764ba2, accent #6366F1}`.
- **Recursive grep for `cdn.tailwindcss.com`: 0 pages.** 101 root pages load `/css/tailwind.css`; 22 load neither (6 `admin-salary-*`, 7 `engineer-*`, plus 404/index/offline/payment/privacy-policy/register/staff-register/birla-opus-report/estimate-edit — these use design-system.css or own styles). MEMORY/docs claims of "105 still on CDN" describe a pre-migration state.
- **CSS cache-busting exists**: `scripts/stamp-css-version.js` appends `?v=<8-char content hash>` to every local `/css/*.css` link (117 pages stamped, idempotent, CRLF-normalized). **JS files get no version stamping** — `/js/*.js` links are unversioned, so the documented WebView/browser stale-cache problem still applies to JS.

### XSS escaping — four copy-pasted helper variants, no shared module

105 of 123 root pages build DOM via `.innerHTML`. Each page defines its own escaper inline; counts of pages defining each variant: `escHtml` **34**, `escapeHtml` **21**, `esc()` **~38**, `escJS` **1** (`admin-products.html`, for onclick attrs). **31 pages define no inline escaper, and 9 of those still use `innerHTML`**: admin-profile, admin-salary-config, admin-stock-check, admin-wa-admin-login, admin-wa-settings, customer-login, forgot-password, painter-login, painter-profile. (Some may only inject static/numeric strings — each needs review. The 4 engineer-* pages define no inline escaper but escape via the shared `EP.escapeHTML` in `public/js/engineer-portal.js`.) DOMPurify is vendored but loaded by exactly one page.

### Brand color enforcement — verified clean

Rule: admin = purple `#667eea→#764ba2` (+`#6366F1` accent); staff & painter = green `#1B5E3B` (gradient `#154D31`, darkest `#0D3D23`) + gold `#D4A24E`, **no purple**. Grep of all root `staff-*`/`painter-*` pages for `667eea|764ba2`: **0 hits** — rule currently holds. Colors are duplicated in three places: tailwind.config.js theme, design-system.css CSS vars, and countless inline styles.

### Service worker / PWA

- Registration is a side effect of loading `auth-helper.js` (`registerServiceWorker()` self-invokes at `auth-helper.js:264`) — effectively 91 pages; `painter-dashboard.html` has its own additional SW reference.
- `public/sw.js` is intentionally minimal: pre-caches only `/offline.html`, network-first for navigations with offline fallback, **no asset/API caching**; handles Web Push display + a ~45-entry `notificationclick` deep-link routing table (`sw.js:93-152`, types → staff/admin pages).
- Web Push: VAPID key fetched from `/api/notifications/push/vapid-key`, subscription POSTed to `/api/notifications/push/subscribe`; skipped inside Android WebView (UA contains `QCManagerApp`).

### Mobile responsiveness state

- Viewport meta on 122/123 root pages (missing: `birla-opus-report.html`).
- 67 root pages have `@media` queries; 74 use Tailwind responsive prefixes (`sm:`/`md:`/`lg:`). House pattern on admin pages: hybrid table↔card layouts + bottom-sheet modals.
- Active remediation in flight: recent commits (`ae58da9` admin-products mobile Bulk-Map/card/FAB) and an untracked plan `docs/superpowers/plans/2026-05-19-mobile-responsiveness.md`. Coverage is uneven — newer pages (painters, products, leads, estimate-create) are mobile-first; older salary/wa-admin/zoho pages less so.

### Runtime third-party dependencies (still CDN-loaded at runtime)

cdnjs.cloudflare 9 pages, jsdelivr 7, unpkg 2, fonts.googleapis 11, Chart.js 6, Leaflet 1 (admin fleet map), qrcode/html5-qrcode 2, Font Awesome 6. None self-hosted, no SRI attributes observed — pages partially break offline despite the PWA shell.


---

## 9. Auth & security

### Overview — four token systems, one shape

All auth is **opaque bearer tokens** = `crypto.randomBytes(32).toString('hex')` (64 hex chars). Lookups are by hash: `WHERE token_hash = LOWER(SHA2(?, 256))` (staff/painter/engineer, in SQL) or Node-side `sha256(token)` hex (customer). There are no JWTs, no cookies, no server sessions — clients keep the token in localStorage and send it on every request. CLAUDE.md documents **three** systems; the code actually has **four** (engineers portal is undocumented).

| Actor | Header | Credential | Middleware | Store | TTL | Revocation |
|---|---|---|---|---|---|---|
| Staff/Admin | `Authorization: Bearer` | username/email/phone + bcrypt(cost 10) password; optional TOTP for admin/manager | `requireAuth` / `requirePermission(module,action)` / `requireAnyPermission` / `requireRole` — `middleware/permissionMiddleware.js` | `user_sessions` | 24h, or 720h with `remember` (`server.js:520`) | logout deletes row (`server.js:744-755`); password reset kills all sessions (`server.js:953`) |
| Customer | `Authorization: Bearer` | phone OTP (6-digit, 5-min, `otp_verifications`) | `requireCustomerAuth` — `middleware/customerAuth.js` → `services/customer-auth.js` | `customer_sessions` | 30 days | `revoked_at` soft-revoke; logout endpoint `server.js:3504` |
| Painter | `X-Painter-Token` | phone OTP (6-digit, 10-min, stored **in the session row itself**) | `requirePainterAuth` (status='approved' only, `routes/painters.js:147-165`) vs `requirePainterSession` (pending+approved, `:169-186`) | `painter_sessions` | 30 days | **none — no logout endpoint exists**; expired rows purged only at next send-otp (`routes/painters.js:276`) |
| Engineer (undocumented) | `X-Engineer-Token` | phone OTP, mirrors painter | `requireEngineerAuth` / `requireEngineerSession` — `routes/engineers.js:31-65` | `engineer_sessions` | 30 days | logout endpoint exists (`routes/engineers.js:215-218`) |

Login flows worth knowing:
- **Staff login** (`server.js:475-556`): bcrypt compare → if role ∈ {admin,manager} and `users.totp_enabled` → returns `{requires_2fa:true, user_id}`; client completes via `POST /api/auth/login-2fa` (`server.js:559-623`, speakeasy TOTP, window=1). Both paths write `LOGIN_SUCCESS`/`LOGIN_FAILED` audit events (SYS-009).
- **Painter OTP** (`routes/painters.js:258-352`): the 30-day session token is generated at **send-otp** time and inserted alongside the plaintext OTP; verify-otp matches `p.phone + ps.otp`, nulls the OTP, and returns the **raw token read back from the DB**. Play-Store test-OTP bypass is fail-closed: requires `NODE_ENV!=='production'` **and** `ALLOW_TEST_OTP==='true'` (`:271`, fixed in e86c8a2/KN-P2-3).
- **Customer OTP** (`server.js:3383-3502`): own 5/hour-per-phone DB rate check on top of `otpLimiter`; session created only after verify via `customerAuthService.createSession` — `customer_sessions` is the only store that is **hash-only** (no raw token column).
- **Password reset**: email-token flow (sha256-hashed single-use token, 1h, `FOR UPDATE` transactional consume + delete all user sessions, `server.js:923-967`) and a mobile-OTP flow (`server.js:847-897`); both return enumeration-safe generic responses.

### Permission model (staff only)

- Tables: `roles`, `permissions` (unique `(module, action)`), `role_permissions` — DDL in `docs/database-complete-schema.sql:49,79,169`; managed via `routes/roles.js` (grant/revoke/replace are audit-logged). Permissions are exposed to the client at `GET /api/auth/permissions`.
- `requirePermission(module, action)` resolves the session **and** the permission with 2 fresh DB queries per request — no caching anywhere.
- `FULL_ADMIN_ROLES = ['admin','administrator','super_admin']` (`middleware/permissionMiddleware.js:25`) bypass all fine-grained checks; `requireRole('admin', ...)` auto-expands to include the aliases (`:278-285`).
- Scale: **560 `requirePermission(...)` call sites** across `routes/*` + `server.js`. Module distribution: zoho 171, painters 88, system 37, salary 33, leads 33, settings 30, attendance 24, engineers 20, billing 20, tasks 14, credit_limits 14, roles 11, staff_registrations 10, branches 9, estimates 8, products 8, customers 7, others ≤4.
- Denied attempts are audited as `PERMISSION_DENIED` (`permissionMiddleware.js:97,197`).

### Security posture (verified in code)

- **Rate limiting** (`middleware/rateLimiter.js`, express-rate-limit, **in-memory store**): `globalLimiter` 100/min on all `/api` (`server.js:217`); `authLimiter` 10/min on login/login-2fa/forgot-password×2/reset-password + staff-registration; `otpLimiter` 5/min keyed on `req.body.phone` (falls back to IP) on all OTP endpoints across all four actors plus `POST /api/2fa/validate`; `leadSubmitLimiter` 8/hour-per-phone on the public estimate-request POST (`routes/estimate-requests.js:222`). `app.set('trust proxy', 1)` (`server.js:106`).
- **Helmet CSP** (`server.js:133-168`): `default-src 'self'`; `script-src` includes **`'unsafe-inline'` + `'unsafe-eval'`** + 6 CDN hosts; `script-src-attr 'unsafe-inline'`; `style-src 'unsafe-inline'`; `connect-src 'self' wss: https:` (any HTTPS host — exfiltration unconstrained); `img-src https:`; `frame-ancestors 'self'`, `object-src 'none'`. Comment at `server.js:124-132` acknowledges tightening is blocked on migrating inline handlers.
- **CORS** (`server.js:174-212`): comma-separated `CORS_ORIGIN` env whitelist; if unset in production, hard-defaults to `https://act.qcpaintshop.com` (never `*`); dev mode additionally allows private-range IPs; `credentials: true`.
- **PII static-file gate** (`server.js:248-267`): `/uploads/aadhar` + `/uploads/documents` require a staff Bearer (header **or `?token=` query param**) with role ∈ `{'admin','manager','hr'}`. Note: this raw Set does **not** include `administrator`/`super_admin` — a super_admin gets 403 here, inconsistent with `FULL_ADMIN_ROLES`.
- **Upload serving** (`server.js:275-279`): everything under `/uploads` gets `Content-Disposition: attachment` + `X-Content-Type-Options: nosniff` (KN-P2-5) so spoofed HTML/SVG can't execute in-origin on direct navigation.
- **Idempotency** (`middleware/idempotency.js`): `idempotent(scope)` keyed on SHA-256(scope:Idempotency-Key), 24h TTL in `idempotency_records`, replays 2xx/4xx, never stores 5xx. Wired on **16 financial POSTs**: billing×4, vendors×3, painters×3 (withdraw/estimate-create/payment), estimates×2, salary, credit-limits, stock-check adjust, painter broadcast.
- **Audit logging** (`services/audit-log.js` → `audit_records`): redacts `password/token/otp/pan_number/aadhar_number/...` keys; records actor type, before/after JSON, IP, UA, URL; queryable via admin-only `GET /api/system/audit-log` (`routes/system.js:27`). Covered actions: staff `LOGIN_SUCCESS`/`LOGIN_FAILED` (incl. bad 2FA), `PERMISSION_DENIED`, estimate/salary/role/painter/billing mutations.

### Verified gaps (doc claims checked against code, + new findings)

| Claim / finding | Status | Evidence |
|---|---|---|
| "No auth-event audit logging" (CLAUDE.md §10) | **STALE — partially fixed.** Staff logins/failures + permission denials are audited (SYS-009, commit 1b50afc). Customer/painter/engineer OTP logins are **not** audited at all. | `server.js:492-534`, `routes/painters.js:318-352` (no `audit.record`) |
| Raw session tokens at rest | **CONFIRMED.** `user_sessions.session_token` and `painter_sessions.token` are still **dual-written raw** ("rollback insurance", flagged for later drop on 2026-05-01, never dropped). DB read = live tokens for staff and painters. `customer_sessions` is hash-only. | `server.js:522-526`, `routes/painters.js:278-283`, `migrations/migrate-session-token-hash.js:8-11` |
| OTPs stored plaintext; customer OTP logged unconditionally | **CONFIRMED.** `otp_verifications.otp`, `painter_sessions.otp`, `engineer_sessions.otp` all plaintext. Painter OTP console log is dev-gated (`painters.js:286-288`) but the customer OTP is `console.log`ged **in production too** (`server.js:3428`). No per-OTP attempt counter — brute-force control is only the 5/min-per-phone limiter. | `server.js:3420-3428` |
| Uploads: extension/mimetype only, no magic-byte sniff | **CONFIRMED.** All 14 multer configs in `config/uploads.js` filter on client-supplied `file.mimetype` / filename extension; no `file-type`-style buffer sniffing anywhere in `config|routes|services|middleware`. Mitigated by attachment+nosniff serving. | `config/uploads.js:59-65` etc. |
| Session IP/UA captured but never validated | **CONFIRMED.** Stored at insert into `user_sessions`/`customer_sessions`; no middleware compares them on subsequent requests; no anomaly alerting. | `server.js:524-525`, `middleware/permissionMiddleware.js` |
| Hardcoded UPI id in `routes/estimates.js`/`routes/share.js` | **STALE — mostly fixed** (commit 9c9a932). Both routes now call `businessConfig.getUpiConfig(pool)` (config keys `business_upi_vpa`/`business_upi_payee` in `ai_config`), but a phone-number-based VPA literal remains as the hardcoded **fallback default** at `services/business-config.js:13`. | `routes/estimates.js:384`, `routes/share.js:116`, `services/business-config.js:13` |
| TOTP weaknesses | `users.totp_secret` stored plaintext base32; `POST /api/2fa/disable` needs only a valid session (no password/TOTP re-confirmation; admin can disable anyone's); `POST /api/2fa/validate` is an unauthenticated token oracle taking arbitrary `user_id` (rate-limited 5/min/IP; also leaks whether 2FA is enabled via `bypass:true`). 2FA is opt-in, not enforced, and only available to admin/manager roles. | `routes/auth-2fa.js:25,57-75,90-102` |
| Painter sessions irrevocable | No painter logout endpoint; a stolen `X-Painter-Token` is valid for 30 days with no user- or admin-facing kill switch (contrast: engineers have logout). | `routes/painters.js` (grep: no logout route) |
| PII gate accepts `?token=` query param | Bearer token can land in nginx/access logs and browser history. | `server.js:251` |
| No account lockout | Repeated bad passwords are audited but never lock the account; only the 10/min IP limiter throttles. Rate-limit store is per-process memory (resets on pm2 restart; not shared if clustered). | `server.js:502-510`, `middleware/rateLimiter.js` |

### Recent security-remediation commit series (git log, 2026-06-08 → 06-10)

A 453-finding platform audit (docs committed in `7c25d2d`) drove a priority-tagged remediation train, all on `master`:

- **fix(p0) — 2026-06-08** (4): `748f0f7` restored missing auth on admin customer-type delete + PAN validation; `e943fac` closed customer-requests **IDOR** by moving endpoints behind customer auth scoping; `82af9ce` engineer-portal pending accounts no longer 403-logout-loop; `68d75b9` non-Zoho schedulers start without `ZOHO_ORGANIZATION_ID`. Companion: `2baca20` XSS escaping across 15 pages; `5c047be` characterization tests locking painter-points money logic.
- **fix(p1) — 06-08/06-09** (~16): authorization tightening (`d6ea658` admin client gates + photos permission, `3e9425d` AI config/scan behind new `system.ai` permission, `1b50afc` **priv-esc + Zoho OAuth CSRF + PII token leaks + audit-log additions**); XSS (`72900a6` 11 pages, `468c68c` attribute/JS-context via `data-*` + event delegation, `48e95f3`+`0f82cf6` stored-XSS in guides); rate limiting (`4cf3049` 2FA validate + public lead submit); idempotency on Zoho-push/stock-adjust (`19e9821`); UPI VPA → config (`9c9a932`); upload-serving hardening (`1eb5223`); money-logic fixes (`5bc5a07` IST bonus cap, `47147f7` salary OT).
- **fix(p2) — 06-09** (~7): `e86c8a2` security batch (SMTP TLS cert validation, painter **OTP-backdoor fail-closed**, broadcast idempotency, CSV/CSS injection, admin gates); `19db3cb` XSS sweep across 24 pages; `5391213`/`ed370bf` CSS cache-busting.
- **Product/Inventory phases — 06-09/06-10**: `578d695` (incl. **NotebookLM RCE** fix), `2e6f7b8` branch isolation + stock-check IDOR, `68e3632` items-tab contract, `ae58da9` mobile permission gating.

Pattern: the platform was retrofitted from "auth on happy path" to systematic authorization, XSS, idempotency, and audit coverage over three days; the residual gaps in the table above are what that sweep did **not** reach.


---

## 10. Integrations & background jobs

### Integration inventory (verified in code)

| Integration | Provider/Library | Key files | Credentials (env names) |
|---|---|---|---|
| Zoho Books | REST v3, India DC (`zohoapis.in`) via raw `https` | `services/zoho-oauth.js`, `services/zoho-api.js` (2,583 lines), `services/zoho-rate-limiter.js`, `routes/zoho.js` (~150 endpoints, 313KB) | `ZOHO_ORGANIZATION_ID`, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_REDIRECT_URI` |
| Zoho Payments | `payments.zoho.in/api/v1` (payment links) | `services/zoho-payments-service.js`; used only by `routes/collections.js:966,989` | `ZOHO_PAYMENTS_CLIENT_ID/SECRET/REFRESH_TOKEN/ACCESS_TOKEN` |
| WhatsApp | **whatsapp-web.js ^1.26.1** (unofficial Puppeteer WhatsApp-Web automation; optional dep — server runs without it) + generic HTTP-API fallback | `services/whatsapp-session-manager.js`, `whatsapp-processor.js`, `wa-campaign-engine.js`; routes `whatsapp-sessions.js`, `whatsapp-chat.js`, `wa-marketing.js`, `wa-contacts.js` | none (QR login; sessions persisted in `whatsapp-sessions/` via LocalAuth). Fallback `whatsapp_api_url`/`whatsapp_api_key` rows in `zoho_config` table |
| FCM push | firebase-admin ^13.7.0, HTTP v1 | `services/fcm-admin.js` (self-inits on require), `notification-service.js`, `painter-notification-service.js` | `FIREBASE_SERVICE_ACCOUNT_PATH` |
| Web Push | web-push (VAPID) | `services/notification-service.js:22-28` | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL` |
| AI (triple provider) | Gemini (raw https), Claude (raw https), Clawdbot/Kai (CLI→gateway WebSocket) | `services/ai-engine.js`, `ai-context-builder.js`, `ai-analyzer.js`, `ai-staff-analyzer.js`, `ai-lead-manager.js`, `ai-marketing.js`, `staff-task-generator.js`, `vendor-bill-ai-service.js`, `scripts/clawdbot-call.mjs`; `routes/ai.js` (25 endpoints, `/api/ai`) | `GEMINI_API_KEY`, Claude key — both also overridable from `ai_config` DB table |
| Gemini image gen | `@google/generative-ai` SDK (only use of the SDK) | `server.js:1777-1810` `generateAutoViz` — painter color-visualization photo repaint, `responseModalities:['TEXT','IMAGE']` | `GEMINI_API_KEY`, `GEMINI_MODEL` (default `gemini-2.0-flash-exp`) |
| NotebookLM | external `notebooklm` CLI on prod PATH | `routes/item-master.js:596-622` `POST /dpl-notebooklm` — `execFile('notebooklm',['use',id])` then `['ask',query]` (no shell, RCE-fixed); `dpl_versions.notebooklm_notebook_id` | none in repo |
| Email | nodemailer, supports loopback sendmail (no auth) | `services/email-service.js` | `SMTP_HOST/PORT/SECURE/USER/PASSWORD`, `SMTP_INSECURE_TLS`, `MAIL_FROM`, `MAIL_FROM_NAME` |
| SMS (OTP) | Nettyfish RetailSMS (`retailsms.nettyfish.com/api/mt/SendSMS`), POST-only so creds stay out of URLs | `services/sms-service.js` | `SMS_USER`, `SMS_PASSWORD`, `SMS_SENDER_ID` (default `QUALTQ`) |
| UPI payments | `upi://pay` deep links + `qrcode` lib | `services/business-config.js` (VPA default hardcoded at line 13, overridable via `ai_config` keys `business_upi_vpa`/`business_upi_payee`), `routes/estimates.js:370` `/:id/upi-qr`, `routes/share.js:204` public QR | n/a (VPA is public-facing) |

**Not present:** no Zoho **CRM** API anywhere (CLAUDE.md §1 "Zoho Books/CRM sync" is Books-only; "PNTR import" pulls Zoho *Books* contacts). No Telegram code in this repo (Telegram APK delivery is a dev workflow, not product code). No Razorpay/Stripe.

### Zoho Books details
- **OAuth** (`services/zoho-oauth.js`): tokens in `zoho_oauth_tokens` table, auto-refresh when <5 min left (`getAccessToken`), bootstrap from `ZOHO_REFRESH_TOKEN`. Callback CSRF protected by stateless HMAC-signed `state` (`generateOAuthState`/`verifyOAuthState`, zoho-oauth.js:203-244). Scope `ZohoBooks.fullaccess.all`. Access+refresh tokens stored **plaintext** in DB.
- **Entities synced into local `zoho_*_map` tables** (`services/zoho-api.js`): invoices, customers/contacts (+salespersons), payments, items, locations, per-location stock, expenses, credit notes; read-through for bills, POs, sales orders, inventory adjustments, transfer orders, reports (P&L, balance sheet, receivables, aging, sales-by-X). `quickSync` = customers+invoices+payments (~15 calls); `fullSync` and `syncLocationStock` are heavy (~300 calls). `updateItem` wraps `cf_*` keys into `custom_fields:[{api_name,value}]` (zoho-api.js:1690).
- **Outbound pushes**: estimates→invoices (`routes/painters.js` push-to-zoho + confirm-payment, `services/billing-zoho-service.js` `pushInvoiceToZoho`), credit limits→contact `credit_limit` (`routes/credit-limits.js:24-40`, with `zoho_outstanding` as credit-used and `checkCreditBeforeInvoice` gate), painter→Zoho customer+salesperson with retry queue `painter_zoho_sync_queue` and 1h/4h/12h/24h backoff (`services/painter-zoho-sync-service.js`), DPL catalog price pushes + item bulk edits (`routes/zoho.js` `/items/dpl-catalog/:brand/push`, `/items/bulk-edit`).
- **Rate limiting** (`services/zoho-rate-limiter.js`): token bucket 80/min (Zoho cap 100/min), daily quota 10,000 with 500-call reserve, circuit breaker stops non-critical work at 9,000, per-caller usage log (last 2,000 calls), counter persisted to DB every 25 calls, global sync-lock prevents overlapping heavy syncs. Alert thresholds 80/90/95%.

### WhatsApp details
- Per-branch sessions via QR; sentinel ids `0` = company "General", `-1` = admin personal (`whatsapp-session-manager.js:31-32`). Chromium `Singleton*` lock cleanup after PM2 kill (line 86-91).
- `whatsapp-processor.js`: drains `whatsapp_followups` queue every 5 min, batch 10, max 3 retries, hardcoded message templates (payment reminder, overdue, thank-you, reorder alert). Dual-mode: session → HTTP API fallback.
- `wa-campaign-engine.js`: marketing campaigns on a setTimeout chain with anti-block measures — spin-text `[Hi|Hello]`, variable substitution, zero-width-space uniqueness markers, hourly/daily caps in `wa_sending_stats`, 5-day warm-up, auto-pause on consecutive failures; Socket.IO progress events.
- 8 admin pages: `admin-wa-dashboard/-marketing/-templates/-contacts/-settings/-admin-login.html`, `admin-whatsapp-chat.html`, `admin-whatsapp-sessions.html`.
- Business flows send documents directly: estimate PDF + UPI caption via admin session falling back to General (`routes/estimates.js:447-473`).

### Notifications (3 parallel stacks)
1. **Staff**: `notification-service.js` — DB `notifications` insert → Socket.IO `user_{id}` → Web Push + FCM via `push_subscriptions` (type `web`|`fcm`), stale-token pruning on 410/404/invalid.
2. **Painter**: `painter-notification-service.js` — `painter_notifications` (bilingual `title_ta`/`body_ta`) → Socket.IO `painter_{id}` → FCM via `painter_fcm_tokens`.
3. **fcm-admin.js**: single send uses Android channel `qc_notifications`; multicast (≤500) uses `qc_admin_channel` + sound `app_notification` — inconsistent channels.

### AI system details
- `ai-engine.js` providers: Gemini (default `gemini-2.0-flash`), Claude (default `claude-sonnet-4-20250514`), Clawdbot. **Failover chain** primary→fallback→rest, filtered by `ai_config` flags `gemini_enabled`/`claude_enabled`/`clawdbot_enabled`; default primary `clawdbot` (per MEMORY: sole enabled provider, running Sonnet 4.5 via gateway config — model not controllable per-call). Clawdbot path: prompt → temp file → `execFile('node', [scripts/clawdbot-call.mjs, file])` → gateway WebSocket, 280s timeout, 5MB buffer. **`clawdbot-call.mjs:8` imports from an absolute prod path** `/www/server/nvm/versions/node/v22.20.0/lib/node_modules/clawdbot/...` — non-portable. Clawdbot "streaming" is fake (full response then flush).
- Two embedded personas: `BUSINESS_SYSTEM_PROMPT` (JSON insights) and `CHAT_SYSTEM_PROMPT` ("QC Manager", explicitly READ-ONLY with anti-hallucination write rules).
- `ai-context-builder.js`: Tier-1 quick summary always injected; Tier-2 keyword-triggered category contexts (revenue/collections/staff/leads/inventory/whatsapp); daily snapshot caching.
- `vendor-bill-ai-service.js`: vendor-bill image OCR by passing base64 image inline in the prompt through ai-engine (works only because Clawdbot/Claude accept it; brittle contract).
- `routes/ai.js` (`/api/ai`): chat (streamed), conversations, insights CRUD, analysis runs, lead-scores, config, suggestions, app-scan/app-analyze, generate-prompt → feeds `admin-ai.html` dashboard.

### Background jobs — complete inventory
All cron jobs use `node-cron ^4.2.1` with `timezone: 'Asia/Kolkata'` (times below are IST). Most schedulers gate on `isClusterPrimary()` (`services/cluster-guard.js` — `NODE_APP_INSTANCE` undefined/0; app currently single-process).

**Startup gating — CLAUDE.md §3 has drifted.** Since fix SVC-001/007, non-Zoho schedulers start **unconditionally** in the `server.listen` callback (`server.js:4341-4360`). Only these require `ZOHO_ORGANIZATION_ID` (`server.js:4363-4374`): sync-scheduler, whatsapp-processor, whatsapp-session init, wa-campaign-engine — plus the PNTR marketing crons registered inside `painterScheduler.start()` (`painter-scheduler.js:344-354`).

| Job | Schedule (IST) | File:Line | Purpose |
|---|---|---|---|
| Geofence enforcement + activity-tracker idle/max-duration | every 60s `setInterval` | `server.js:4215-4338` | location-off >2min and geo-warning >5min auto-clockout; FCM to staff+admins |
| Anomaly full scan | every 6h `setInterval` | `server.js:4354` | Z-score anomalies (revenue/attendance/stock/collections/API usage), `anomaly-detector.js` |
| System health check | every 5 min | `server.js:4350`, `system-health-service.js:362` | DB/error/integrity checks |
| Production monitor | check 60s, lag probe 1s, snapshot 5 min | `production-monitor.js:462-468` | self-healing: clear Zoho LRU cache, force GC, db-pool test (backoff), stale-session cleanup (72h), Zoho circuit breaker (5 fails/5-min reset), cap 10 actions/hr |
| Photo cleanup | daily ~02:00 (5-min poll loop) | `routes/photos.js:219-228` | delete aged photos per category retention |
| AI: Zoho daily / staff daily / lead scoring / Zoho weekly / marketing weekly / staff Tamil tasks / snapshots | 21:00 / 22:30 / every 6h / Mon 08:00 / Mon 09:00 / 09:00 / 06:00+12:00+18:00 | `ai-scheduler.js:252-272` | each individually gated by `ai_config` enable flags |
| Painter: monthly slabs / quarterly slabs / credit-overdue / streak reset / bonus rotation / bonus push / streak reminder | 1st 06:00 / 1 Jan-Apr-Jul-Oct 06:30 / 08:00 / 00:00 / 00:05 / 07:00 / 20:00 | `painter-scheduler.js:308-316` | loyalty engine |
| Painter attendance AP: open claim / recompute / remind / forfeit+purge / location prune | 1st 00:05 / every 6h days 1-7 / 7th 20:00 / 8th 02:00 / 02:30 (30-day retention) | `painter-scheduler.js:319-336` | monthly AP claim lifecycle |
| Data retention purge | 03:30 | `data-retention-service.js:88` | audit_records 90d, resolved error_logs 90d, staff_activity_feed 30d, read notifications 60d, otp_verifications 7d |
| Lead auto-assign | 08:00 | `lead-auto-assign-scheduler.js:184` | assign unassigned leads to branch staff |
| Lead follow-up reminders | 08:00 | `lead-reminder-scheduler.js:27` (init at `server.js:350`, outside the start block) | due + overdue follow-up pushes |
| Auto-clockout: OT prompts / geo warnings / force clock-out | every 5 min ×2 (reentrancy-guarded `setInterval`) / 21:59 | `auto-clockout.js:632-650` | overtime prompts, geo enforcement, 10 PM force-out |
| Attendance + activity reports / lead alerts | 22:05 / 18:05 | `attendance-report.js:1153,1179` | staff reports + admin PDF; lead creation/follow-up alerts |
| Activity feed cleanup | 00:05 — **registered at module require, no cluster guard, no registry** | `activity-feed.js:173-176` | purge same-day-older feed rows |
| **Zoho-gated:** quick sync (customers+invoices+payments) | configurable, default every 60 min (`zoho_config.sync_interval_minutes`) | `sync-scheduler.js:464` | guarded by quota check, circuit breaker, sync lock |
| Stock sync (items+locations+stock, heavy) | 02:00, 06:00, 12:00, 18:00 (default) | `sync-scheduler.js:511` | configurable via `stock_sync_interval_hours` |
| Daily financial report | configurable (default 09:00, **disabled by default**) | `sync-scheduler.js:485` | P&L + receivables |
| Bulk job processor | every 5 min | `sync-scheduler.js:520` | pending Zoho bulk item edit jobs |
| Invoice line sync → reorder compute → reorder report | 02:00 → 02:30 → 07:00 | `sync-scheduler.js:527-545` | `branch_item_sales` aggregation (90d window+cursor), auto reorder levels, branch report via dashboard+WhatsApp+FCM |
| WhatsApp queue processor | every 5 min | `whatsapp-processor.js:448` | drain `whatsapp_followups` |
| PNTR marketing (Zoho-gated, inside painter-scheduler) | 02:30 import / 03:00 sync-retry / 03:45 backfill / 06:00 list gen / 06:30 FCM / 17:00 reminder / 18:00 manager WA | `painter-marketing-scheduler.js:146-229` | painter lead pipeline; 03:45 deliberately offset from 03:30 retention purge (comment at :154) |

An **automation registry** (`services/automation-registry.js`) receives `register/markRunning/markCompleted/markFailed` from most schedulers and feeds the monitoring UI; the `server.js` inline intervals, activity-feed cron, and photo cleanup are *not* registered in it. None of the jobs have persistence/catch-up: a restart that straddles a date-anchored cron (e.g. slab eval on the 1st, AP forfeit on the 8th) silently skips it.

### Doc-vs-code discrepancies found
1. CLAUDE.md §3 "Background schedulers only start if ZOHO_ORGANIZATION_ID is set" — outdated; only 4 Zoho services are gated now (`server.js:4341-4374`).
2. CLAUDE.md §10 "UPI id hardcoded in routes/estimates.js / routes/share.js" — now centralized as an overridable default in `services/business-config.js:13`.
3. `painter-notification-service.js` header comment says "legacy HTTP API" but it uses `fcm-admin` (HTTP v1).
4. Comment at `painter-scheduler.js:340` says PNTR registers "4 IST crons"; `painter-marketing-scheduler.registerCron` actually registers 7.
5. "Zoho CRM" appears in docs; no CRM API integration exists in code.


---

## 11. Quality, tests & audit status

### Test suite structure & counts (static analysis, suite not run)

Three runner-separated tiers under `tests/` (Jest matches `**/tests/**/*.test.js`; Playwright matches `tests/e2e/*.spec.js` — deliberately non-colliding, see `playwright.config.js:1-14`):

| Tier | Files | `describe(` | `it(`/`test(` (string-named, line-anchored grep) | Notes |
|---|---|---|---|---|
| `tests/unit/` | 49 | ~150 | ~581 | Pure-node; DB pool mocked where needed |
| `tests/integration/` | 1 (`painter-attendance-flow.test.js`) | 1 | 2 | **Hits a real MySQL DB** from `.env` (`DB_NAME qc_business_manager`), inserts/deletes a test painter |
| `tests/e2e/` (Playwright) | 8 `.spec.js` | 6 | 16 | No auto server start; flow specs **self-skip** without `TEST_BASE_URL` + creds (`E2E-PLAN.md`: only the offline login smoke is unconditionally green) |

- Totals: **58 test files, ~599 named test cases** (`it.each`/`test.each` expand further at runtime). The 2026-06-08 triage doc recorded the baseline as **`npm test` 545/545 green**; ~38 more cases were added since (remediation sprint).
- `package.json` scripts: `test` (jest), `test:watch`, `test:coverage`, `test:e2e`, `test:e2e:smoke`, `lint`/`lint:fix` (eslint), `prepare` (husky). Husky pre-commit = `npx lint-staged` (eslint --fix on staged `*.js/mjs`) — **tests are NOT run on commit, and there is no CI at all** (`.github/workflows/` does not exist despite a GitHub remote).
- `jest.config.js:4-8`: `collectCoverageFrom` is **only `middleware/**`, `config/**`, `services/anomaly-detector.js`** — `npm run test:coverage` structurally under-measures; routes/ and 64 of 65 services are invisible to the coverage report. No coverage thresholds.
- `eslint.config.js`: flat config v9, deliberately lax ("70k-LOC codebase — tighten over time"); most rules are warnings, real-bug rules (`no-undef`, `no-dupe-keys`…) are errors. **`public/**` (the entire ~100-page frontend JS) is ignored by ESLint** (`eslint.config.js:30`). Triage baseline: 0 errors / 294 warnings.

### What is actually covered vs not

Covered by tests that exercise the **real production module** (require path verified):

| Area | Test file(s) → target |
|---|---|
| Estimate pricing engine (§6 money path) | `tests/unit/estimate-pricing.test.js` → `routes/estimates.js` `calculateItemPricing`/`calculateEstimateTotals` — explicit *characterization* tests locking known-defect behavior |
| Painter points engine (§6) | `tests/unit/painter-points-engine.test.js` → `services/painter-points-engine.js` (referral tiers, addPoints/deductPoints ledger, clawback netting; mocked pool incl. transactions) + `painter-points-backfill-service.test.js` |
| Salary calc (§6) | `tests/unit/salary-calc.test.js` → `routes/salary.js` `calculateSalaryForUser` — only RT-039/RT-040 components (Sunday OT, deduction basis) |
| DPL pipeline (§6) | 13+ files (`dpl-naming`, `dpl-tabular-parser`, `dpl-csv-*`, `dpl-catalog*`, `dpl-coverage`, `dpl-price-size`, `brand-dpl-service`, `dpl-sku-base-match`, `dpl-duplicate-detect`) → `services/price-list-parser.js`, `services/dpl-catalog.js`, DPL endpoints in `routes/zoho.js`. Best-tested area of the codebase |
| Item master | `item-master.test.js` (34 cases) + `item-master-sales-price.test.js` → `routes/item-master.js` |
| Middleware | `idempotency`, `rateLimiter`, `validate`, `responseTracker` tests → real modules |
| Config | `config.test.js` → `config/database.js`, `config/uploads.js` |
| Services misc | anomaly-detector, production-monitor, html-sanitizer, zoho-oauth-state, zoho-invoice-line-sync (helpers only), business-config, branding, color-extractor, painter-attendance, painter-marketing-scheduler, pntr-import, painter-zoho-sync-service, reorder-compute/report, price-list-pdf-generator |
| Routes misc | admin-notifications, price-list, wa-marketing (upload filter only) |
| Frontend JS (rare) | `engineer-portal-auth.test.js` → `public/js/engineer-portal.js`; `dpl-duplicate-detect.test.js` → `public/js/dpl-duplicate-detect.js` |

**Mirror-test caveat (false confidence):** `billing.test.js` and `vendors.test.js` test **inline re-declared copies** of the Zod schemas ("Schemas (inline, matching routes/billing.js)" — `tests/unit/billing.test.js:6`), and `estimate-search.test.js` / `painter-location.test.js` duplicate pure helper functions inline. None of these import the production module, so they cannot catch drift in `routes/billing.js` / `routes/vendors.js` etc.

**NOT covered (verified — no test file requires these):** staff auth + RBAC (`middleware/permissionMiddleware.js` — ironically inside the coverage collection set but has zero tests), customer auth (`middleware/customerAuth.js`, `services/customer-auth.js`), painter auth/route handlers (`routes/painters.js`, 337KB), leads (no `leads` reference anywhere in `tests/`), collections, core Zoho sync (`services/zoho-api.js`, `routes/zoho.js` beyond DPL endpoints, `services/billing-zoho-service.js`), estimates route handlers (CRUD/payment/PDF/WhatsApp — only the two pure pricing functions are tested), attendance routes, WhatsApp, `server.js` bootstrap. Rough module coverage: **~7 of 49 route files and ~20 of 65 service files have any real-module test.** Note: CLAUDE.md §10's claim that "estimates/painter-points… untested" is now **outdated** — characterization tests exist since the June sprint; leads/zoho-core/auth flows remain genuinely untested.

### COMPLETION_STATUS.md (read-only audit, 2026-06-04)

139-line audit at repo root. Key conclusions: stack/wiring verified (Express 5, one injected pool, 118 migrations, 3 auth systems); production-live module list; P0-1 double ₹10 rounding (since fixed 2026-06-04, commit `663e4d4`, regression-locked in triage as KN-P0-1 RESOLVED) and P0-2 `gst_amount:0` (owner-confirmed intentional — GST-inclusive pricing); P1-1..5 (NaN guard, salary basis, Sunday OT, IST bonus cap, Zoho-gated schedulers — the salary+bonus ones since fixed per commits `47147f7`, `5bc5a07`); P2-1..7 hardening list; "Confirmed GOOD": no SQLi found, bcrypt+SHA-256 tokens, rate limiting; NIT-1 estimate↔Zoho sub-rupee drift formally **accepted** by owner 2026-06-05. **Known drift in this doc:** says "tests/ (37 files)" (now 58) and "no single net_salary computed" — the 2026-06-08 triage explicitly flags that as **stale** (`net_salary` IS a `STORED GENERATED` column, `migrations/migrate-staff-incentives.js:80-82`).

### Audit corpus & remediation state

| Doc | Date | Tracked? | Content |
|---|---|---|---|
| `docs/audit/2026-06-08-triage.md` (220KB) | 2026-06-08 | yes | **Master triage: 453 findings = 12 P0 + 106 P1 + 335 P2**; by category: correctness 254 (Phase 1), ui-ux 173 (Phase 2), android 26 (Phase 3). Baseline 545/545 tests, lint 0 err/294 warn |
| `docs/audit/2026-06-08-surface-inventory.md` (103KB) | yes | 2026-06-08 | Companion 13-agent surface survey |
| `docs/audit/2026-06-09-product-inventory-analysis.md` (56KB) | yes | 2026-06-09 | **Newer deep-dive, findings beyond the 453: 39 confirmed bugs (10 P0 / 29 P1) + 35 UI/UX**, incl. data-loss save bug, dead Items tab (frontend↔Zod-schema contract mismatches), broken DPL apply |
| `docs/audits/audit-20260430.md` (=root `audit-report.md`, identical 82,827 bytes) | 2026-04-30 | yes | Earlier audit sprint source |
| Root: `AUDIT-2026-05-01.md`, `LAUNCH-BLOCKERS.md`, `QC-PROJECT-DOSSIER.md` (236KB, 2026-06-08), `E2E-PLAN.md` | various | yes | Historical audit/dossier docs |

Remediation progress (verified in git): **111 commits since 2026-06-04**; all **12 Phase-1 P0s fixed**, last P0 commit `68d75b9` ("non-Zoho schedulers start without ZOHO_ORGANIZATION_ID") dated 2026-06-08 — deployed to prod same day per project memory (deploy itself not verifiable from repo). Since then ~20 `fix(p0|p1|p2)` batch commits through 2026-06-10 closing dozens of finding IDs (RT-*, KN-*, PAGE-*, SVC-*, SYS-007) plus product-inventory Phases A/B1/B2/C1 (`c6835f1`→`ae58da9`). **There is no live "remaining findings" tracker** — the triage doc is a static snapshot (only KN-P0-1 was pre-marked RESOLVED); progress lives only in commit messages. Doc-derived math at triage time: Phase-1 non-P0 = 242; total P1+P2 across all phases = 441. (Project memory's "252 P1/P2 remain" matches neither figure exactly and appears to be an informal estimate.)

**Untracked files (git status):** `docs/audits/admin-dpl-hotfix.patch` + 3 plan docs (`docs/superpowers/plans/2026-05-19-mobile-responsiveness.md`, `2026-05-21-customer-price-list-generator.md`, `2026-05-21-price-list-generator-v2.md`). `docs/audits/*.pdf|*.txt|*.json` (DPL source artifacts incl. 3MB PDF, 830KB JSON) are deliberately gitignored (`.gitignore:80-86`).

### Documentation currency

- **`Skills.md` is stale**: 3,137 lines / 294KB, self-declared "Last Updated: 2026-05-18" (line 5 and footer line 3741), last git touch `bfba500` 2026-05-18. HEAD is 2026-06-10 — the entire June audit-remediation sprint (111 commits), the DPL catalog go-live, and the Zoho-first reconciliation tab are absent, despite CLAUDE.md mandating updates "after substantial changes".
- `COMPLETION_STATUS.md` (2026-06-04) has the two stale claims noted above; CLAUDE.md §10 test-gap list is partially outdated.

### Quality scorecard

| Area | State | Evidence |
|---|---|---|
| Unit tests — DPL/item-master/pricing engines | 🟢 Good | 13+ DPL files, characterization tests on all §6 money functions (`estimate-pricing`, `painter-points-engine`, `salary-calc` tests) |
| Unit tests — auth, leads, Zoho core, route handlers | 🔴 Absent | No test requires `permissionMiddleware`, `customerAuth`, `routes/painters.js`, `zoho-api.js`, leads |
| Test honesty | 🟡 Mixed | 4 "mirror" test files assert inline copies, not production code (`billing.test.js:6`) |
| Coverage measurement | 🔴 Misleading | `jest.config.js:4-8` collects from 3 paths only; no thresholds |
| E2E | 🟡 Scaffolded | 8 Playwright specs; only offline smoke runs unconditionally; flows #2-#6 in `E2E-PLAN.md` are todo |
| CI | 🔴 None | No `.github/workflows/`; pre-commit = lint-staged only |
| Lint | 🟡 Lax by design | 0 errors / 294 warnings; `public/**` frontend JS fully unlinted |
| Audit discovery | 🟢 Strong | 453-finding triage + 39-bug product-inventory follow-up, evidence-cited per finding |
| Audit remediation | 🟢 Active / 🟡 untracked | 12/12 P0 fixed (last `68d75b9`, 2026-06-08); ~20 P1/P2 batches since; **no live remaining-count board** |
| Docs currency | 🟡 Drifting | Skills.md 3+ weeks stale; COMPLETION_STATUS has 2 known-stale claims |


---

## 12. Android apps & deployment/ops

### Android app — repo layout

Sibling repo `..\qcpaintshop-android\` (relative to web repo root). **Local-only git repo with NO remote** (`git remote -v` is empty). Branches: `master`, `audit/2026-04-17`, `audit/2026-04-26`, and the currently checked-out `design/painter-app-ux-2026-05`. Working tree has **17 uncommitted modified files** (incl. `app/build.gradle.kts`, `MainActivity.kt`, ~10 painter UI files, `gradle.properties`); last commit 2026-05-17 (`4170297`). Single Gradle module `app`.

### Tech stack (from `qcpaintshop-android/build.gradle.kts` + `app/build.gradle.kts`)

- AGP 8.7.3, Kotlin 2.1.0 (+ compose plugin), KSP, Hilt 2.54, Java 17, core-library desugaring.
- `compileSdk=35`, `targetSdk=35`, `minSdk=24`. Compose BOM 2024.12.01 (Material3), Navigation-Compose, Retrofit 2.11/OkHttp 4.12, Room 2.6.1, DataStore, security-crypto (encrypted token), CameraX **1.4.0** (comment in gradle: required for 16KB-aligned native libs per Nov 2025 Play policy), play-services-location, FCM (firebase-bom 33.7.0), Play In-App Updates, Install Referrer (deferred deep-link referral codes), Coil, Lottie, iText7 (PDF). Release builds: R8 minify + shrinkResources; signing reads `KEYSTORE_PASSWORD`/`KEY_PASSWORD`/`KEY_ALIAS` from `local.properties` or env (keystore `app/qcpaintshop-release.jks`).

### Flavors & versions (dimension `app`, namespace `com.qcpaintshop.act` for all)

| Flavor | applicationId | Start path | master branch | design branch HEAD | Working tree (uncommitted) | Docs claim (prod) |
|---|---|---|---|---|---|---|
| staff | `com.qcpaintshop.staff` | `/login.html` | vc17 / 3.3.9 | **vc18 / 3.3.9** | vc19 / 3.4.0 | v3.3.9 vc18 on Play production (2026-05-14) ✓ matches HEAD |
| customer | `com.qcpaintshop.customer` | `/customer-login.html` | inherits defaultConfig (same as staff) | inherits | inherits | — |
| painter | `com.qcpaintshop.painter` | `/painter-login.html` | vc20 / 3.1.8 | **vc39 / 4.0.0** (commit `f8a4c27`) | **vc43 / 4.1.2** | v4.0.0 vc39 built 2026-05-18; Play upload pending |

Key drift: `master` is far behind for painter (3.1.8 vs 4.x); the entire v4 redesign lives only on `design/painter-app-ux-2026-05`, and the v4.1.x bumps (through vc43/4.1.2) are **uncommitted**. BuildConfig package is the namespace `com.qcpaintshop.act` for all flavors (per-flavor `START_PATH`/`APP_TYPE` buildConfigFields).

### Architecture per flavor

- **staff/customer = thin WebView wrappers.** `app/src/main` (10 .kt files): `MainActivity.kt` (621 lines, WebView host loading `https://act.qcpaintshop.com` + flavor start path, host allowlist in `util/Constants.kt` — act.qcpaintshop.com, qcpaintshop.com, tailwind/socket.io/google-fonts CDNs), `QCWebViewClient`/`QCWebChromeClient`, `QCFirebaseMessagingService` + `FcmTokenRefreshSink`, `NetworkMonitor`, `LocationDisclosureActivity` (Play prominent-disclosure screen), `GeofenceLocationService` + `GeofenceBroadcastReceiver`. Flavor source sets `staff/`/`customer/` contain only launcher icons + a no-op Hilt module each (1 .kt).
- **FCM token injection**: `MainActivity.injectFCMToken()` (line 443) runs JS in the WebView reading `localStorage` `auth_token`/`customer_token` (Bearer) or `painter_token` (sent as `X-Painter-Token` header) and POSTs the FCM token to the backend — one wrapper serves all three auth systems.
- **GeofenceLocationService** (`app/src/main/.../location/`): foreground service `foregroundServiceType="location"`, 30s GPS interval. Staff mode reports for geofence auto-clockout; painter mode (`startForPainter`) posts to `/api/painters/me/location-report` with `X-Painter-Token`, no enforcement. Manifest declares `ACCESS_BACKGROUND_LOCATION` + `FOREGROUND_SERVICE_LOCATION`; `READ_MEDIA_*`/storage perms explicitly removed via `tools:node="remove"`.
- **painter = full native Compose app**: `app/src/painter` has **129 .kt files, 31 `*Screen.kt`, 28 `*ViewModel.kt`** in clean layers (`data/{fcm,local,remote,repository}`, `di`, `navigation`, `ui/*`). Screens include Login/Register/Onboarding/AwaitingApproval, Home, Catalog + ProductDetail, EstimateCreate/Detail, QuotationCreate/Detail, CheckIn (CameraX selfie — `ui/attendance/CheckInScreen.kt` uses `androidx.camera.core` + camera/fine-location runtime permissions), AttendanceHistory/Calendar, PointsHistory, Leaderboard, Referrals, Cards, Gallery, Training, Calculator, Visualization, PdfPreview, Achievements, Settings. `AuthInterceptor` sets `X-Painter-Token` via `header()` (not `addHeader` — duplicate-header comment documents a real Node-side "tok, tok" bug).
- **Tests**: only `app/src/testPainter` — 2 unit test files (`FcmTokenManagerTest`, `NotificationDeepLinkTest`) + `robolectric.properties` pinning `sdk=34` (Robolectric 4.13 ceiling vs targetSdk 35). No instrumentation tests; staff/customer untested.

### Play Store publish tooling (`..\google-services\`)

Node scripts using `googleapis` androidpublisher v3 with a service-account key file (`play-api-key.json` sits in this folder alongside `firebase-service-account.json` and per-package `google-services.json` files — plain directory, not a git repo as far as observed):

| Script | What it does |
|---|---|
| `publish-to-play.js [track]` | Uploads `app-staff-release.aab` (from gradle `bundleStaffRelease` output path) for `com.qcpaintshop.staff` → edit → upload bundle → assign track (default `internal`) → commit. Release notes **hardcoded** (currently v3.3.9 text). Comment notes `changesNotSentForReview` was removed (Play API now rejects it). |
| `publish-painter.js [track]` | Same flow for `com.qcpaintshop.painter`. Release notes hardcoded to stale **v3.3.0** text and success log prints "v1.4.0" — copy-paste drift. |
| `promote-to-track.js <pkg> <vc> <track> [--notes f]` | Promotes an already-uploaded versionCode to another track without re-upload (Play burns versionCodes even on uncommitted uploads). |
| `inspect-tracks.js <pkg>` | Reads all track states for a package. |
| `check-16kb.js <dir>` | Verifies `.so` LOAD segments are 16KB-aligned (`p_align >= 0x4000`) — Play production-track requirement. |
| `capture-staff-screenshots.js` / `capture-painter-screenshots.js`, `generate-painter-icons.js` | Store-listing asset generation. Folder also holds historical staff AABs (v3.1.0–v3.3.6) and icon/feature-graphic PNGs. |

### Web deployment & ops

- **Prod**: `https://act.qcpaintshop.com`, Hetzner VPS (Ubuntu), aaPanel-managed nginx reverse proxy → Node app on port 3001, app path `/www/wwwroot/act.qcpaintshop.com/`, PM2 process name `business-manager` (Skills.md §7, lines 1884-1909). nginx vhost gotcha recorded at Skills.md:3280 — live config is `/www/server/nginx/conf/vhost/act.qcpaintshop.com.conf`, not the aaPanel panel path.
- **Deploy is fully manual**: `ssh hetzner "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && npm install && pm2 restart business-manager"` (CLAUDE.md §7). No CI/CD anywhere — web repo has **no `.github/workflows`, no `ecosystem.config.js`, no Procfile, no deploy script**. `package.json` `postinstall` runs `npm run build:css` (Tailwind + `scripts/stamp-css-version.js`), so CSS rebuilds as a side effect of `npm install` on the server; failure is swallowed non-fatally.
- **PM2 single instance assumed**: `services/cluster-guard.js` gates background schedulers on `NODE_APP_INSTANCE ∈ {undefined,'',0}` — defensive against a future `--instances N` switch that would double-fire crons (FCM/WhatsApp/points). Schedulers additionally only start when `ZOHO_ORGANIZATION_ID` is set (`server.js`).
- **Env surface** (names only, Skills.md:1911-1938): `DB_*`, `PORT`, `NODE_ENV`, `BASE_URL`, `CORS_ORIGIN`, `SMTP_*`/`MAIL_*`, `SMS_*` (NettyFish), `GEMINI_API_KEY`/`GEMINI_MODEL`, `ZOHO_*`, `VAPID_*`, `FIREBASE_SERVER_KEY`. `.env` gitignored. — NOTE: this is Skills.md's stale list; `FIREBASE_SERVER_KEY` is not read by any code (the actual var is `FIREBASE_SERVICE_ACCOUNT_PATH`); the code-verified env list is in §4.
- **Docs drift**: Skills.md §7 still lists 16 legacy `scripts/migrate-*.js` files as the fresh-install migration path, but the actual mechanism is `migrate.js` + `migrations/` (120 files; see §7); prod `_migrations` only tracks Apr 30 2026+ so `--status` over-reports pending. Skills.md also still says server.js ~3,400 lines (actually 4,406).


---


## 13. Consolidated upgrade backlog

91 raw opportunities were collected across the 9 survey areas; duplicates merged, grouped into 10 themes. **Impact** = business/risk value; **Effort**: S < 1 day, M = 1–3 days, L = 1–2 weeks, XL = multi-week. Items marked ⚠ touch §2.2 money paths (characterization test first). Note: theme-DOC IDs (DOC1–DOC4) are backlog items, distinct from the P0/P1/P2 *finding-priority* labels used in §11.

### Recommended top 10 (editorial priority)

1. **I1 — De-risk transactional WhatsApp** (unofficial `whatsapp-web.js` carries payment reminders, estimate PDFs, manager alerts; a WhatsApp ban halts business messaging).
2. **S1+S2 — Credential hygiene**: drop raw session-token columns; hash OTPs; stop console-logging customer OTPs in prod; painter logout endpoint.
3. **T1+T5 — CI + honest coverage**: GitHub Actions running jest+eslint; widen `collectCoverageFrom`. Cheap, unlocks everything else safely.
4. **D1+D2+D3 — Schema reproducibility**: commit `mysqldump --no-data` snapshot; normalize migrations to `up()`; backfill prod `_migrations`. Currently a fresh dev/test DB is impossible.
5. **M1+M2+M3 ⚠ — Painter money-path bugs**: invoice-claim row can permanently swallow points on mid-failure; clawback netting bypasses ledger; credit overdue can re-debit and never resets `credit_used`.
6. **M4 — Cron catch-up persistence** for date-anchored money jobs (monthly slabs, AP claim/forfeit) that silently skip on restart.
7. **A1 — Extract the ~100 inline `server.js` endpoints** (auth core, products, customer portal) into route modules.
8. **F1+F2 — Frontend safety**: one shared escaper module + cover the 9 unprotected `innerHTML` pages; add JS cache-busting (CSS already has it).
9. **I2 — Fix `scripts/clawdbot-call.mjs` hardcoded absolute path** — sole enabled AI provider breaks on any Node upgrade/server move.
10. **R1 — Android source safety**: give `qcpaintshop-android` a git remote, commit the 17 dirty files, merge the design branch (shipped painter v4.x exists only as uncommitted local work).

### Theme S — Security hardening

| # | Item | Impact | Effort |
|---|---|---|---|
| S1 | Drop raw token columns `user_sessions.session_token` + `painter_sessions.token`; stop dual-writing (`server.js:522-526`, `painters.js:278-283`) | high | M |
| S2 | Hash OTPs at rest; per-OTP attempt counter; remove unconditional prod customer-OTP `console.log` (`server.js:3428`) | high | S |
| S3 | Painter logout/revocation endpoint + admin "revoke all sessions" (engineers already has the pattern, `engineers.js:215`) | med | S |
| S4 | Extend auth-event audit logging to customer/painter/engineer logins (staff-only today) | med | S |
| S5 | PII upload gate: use `FULL_ADMIN_ROLES` (super_admin currently 403s) and drop `?token=` query auth (`server.js:248-267`) | med | S |
| S6 | 2FA hardening: re-auth on `/api/2fa/disable`, encrypt `totp_secret`, remove/harden the unauthenticated `/api/2fa/validate` oracle | med | M |
| S7 | Magic-byte (file-type) validation in all 14 multer configs (`config/uploads.js`) | med | M |
| S8 | Account lockout / progressive delay on repeated `LOGIN_FAILED` | med | M |
| S9 | CSP roadmap: drop `unsafe-inline`/`unsafe-eval`, narrow `connect-src https:` (blocked on migrating inline handlers — pairs with F5) | high | XL |
| S10 | `authLimiter` on `POST /api/auth/register`; dedicated limiter on anonymous `POST /api/public/design-requests` upload | med | S |
| S11 | Role checks on Socket.IO `painter_{id}`/`admin_painters_live` room joins (`server.js:4118-4127`) | low | S |
| S12 | Engineer actor: move middleware to `middleware/`, document in CLAUDE.md, consider shared OTP-session module with painters | med | M |
| S13 | Encrypt Zoho OAuth tokens at rest (`zoho_oauth_tokens` plaintext, `ZohoBooks.fullaccess.all` scope) + refresh retry | med | M |
| S14 | Move Play/Firebase service-account JSON keys out of the plain `google-services/` folder to env-injected paths | high | S |

### Theme M — Money-path correctness ⚠ (all need characterization tests first)

| # | Item | Impact | Effort |
|---|---|---|---|
| M1 | `processInvoice` claim row inserted **before** awarding (`painter-points-engine.js:164-174`) — mid-function failure permanently swallows points with no retry. Add compensating delete or status column | high | M |
| M2 | Clawback netting runs outside the transaction and writes **no ledger entry** for absorbed points (`:44-65`) — invisible to painter, race-prone | med | M |
| M3 | `checkOverdueCredits` (`:409-466`) ignores invoice paid-status and never resets `credit_used` → possible repeat auto-debits (owner decision Q-B1 needed) | high | M |
| M4 | Catch-up persistence (`job_runs` table + startup check) for date-anchored crons: monthly/quarterly slabs, AP open/forfeit | high | M |
| M5 | Scheduled drift-check: ledger SUM vs denormalized `painters.regular_points/annual_points` | high | M |
| M6 | Salary display: split approved vs unapproved OT; remove/lock dead `standard_daily_hours`/`sunday_hours` config fields | med | S |
| M7 | `calculateItemPricing` returns ₹10-ceiled `base_price` for display while math uses the un-rounded base — stored row disagrees with input (`estimates.js:104`) | low | S |
| M8 | `executeDailyReport` uses UTC `toISOString` dates on an IST business — off-by-one before 05:30 IST (`sync-scheduler.js:311,336`) | low | S |
| M9 | Slab evaluation may double-count invoices that have both direct + salesperson attribution rows in `painter_invoices_processed` (`painter-points-engine.js:345-403`) — fix basis per owner answer to Q-B3 | high | M |

### Theme A — Architecture & tech debt

| # | Item | Impact | Effort |
|---|---|---|---|
| A1 | Extract ~100 inline `server.js` endpoints (auth 471-1341, products 2787-3376, customer portal 3378-3672, paint-colors/viz 1649-2265) into route modules | high | L |
| A2 | LRU cache (30-60s TTL, keyed on token hash) for session+permission lookups — hottest query in the app, 0 caching today; also dedupe 4 copy-pasted lookups | med | M |
| A3 | Real graceful shutdown: `server.close()`, `io.close()`, `pool.end()` (today in-flight requests die on every deploy) | med | S |
| A4 | Consolidate 4 base-URL env vars (`APP_ORIGIN`/`APP_PUBLIC_URL`/`APP_BASE_URL`/`BASE_URL`) into one | med | S |
| A5 | Structured logging (pino) replacing the `console.error` monkey-patch; delete dead `middleware/requestLogger.js` (queued as U13 in audit sprint) | med | M |
| A6 | Pin Node (`engines` + `.nvmrc`) and commit `ecosystem.config.js` | med | S |
| A7 | Registry-driven DI to replace 120 hand-maintained `setPool`/`setIO` lines | med | M |
| A8 | Split `painters.js` (156 endpoints) and `zoho.js` (148) into public/actor/admin sub-routers | med | L |
| A9 | Mount `/api/zoho/migration|collections|whatsapp-sessions` BEFORE `/api/zoho` to remove the shadowing foot-gun | low | S |
| A10 | Shared `requireAuthAllowQueryToken` middleware replacing 4 hand-rolled token checks (estimate-pdf, salary PDF, offer letter, painter activate) | med | M |
| A11 | Stop leaking `err.message` on public endpoints (`/api/test`, collections pay-order handlers) | low | S |
| A12 | Generate an OpenAPI spec from the route table (~1,026 endpoints, zero spec today) | high | L |

### Theme T — Testing & CI

| # | Item | Impact | Effort |
|---|---|---|---|
| T1 | GitHub Actions: jest + eslint + build:css on push/PR (repo has a remote but no `.github/workflows/`) | high | S |
| T2 | Replace 4 "mirror" tests (billing, vendors, estimate-search, painter-location) with real-module imports | high | M |
| T3 | Test the auth stack: `permissionMiddleware`, `customerAuth`, painter OTP/session resolution — source of several P0s, zero tests | high | M |
| T4 | Cover Zoho sync core (`zoho-api.js` cf_* wrapping, rate-limiter math) and leads paths | high | L |
| T5 | Widen `jest.config.js` `collectCoverageFrom` to `routes/**` + `services/**`; add thresholds later | med | S |
| T6 | Stand up E2E server + implement flows #2-#6 of `E2E-PLAN.md` (RBAC, estimate, painter/customer OTP) | med | L |
| T7 | Lint `public/js/**` (ESLint currently ignores the entire frontend — where most audit P0s lived) | med | M |
| T8 | Live remediation tracker: map fix-commit finding IDs (RT-*/KN-*/PAGE-*/SVC-*) against the 453-finding triage board | med | S |
| T9 | Android: Repository/ViewModel tests for estimate/points flows (2 unit test files today for 129 .kt files) | med | L |

### Theme F — Frontend

| # | Item | Impact | Effort |
|---|---|---|---|
| F1 | One shared escaper module (or standardized DOMPurify — already vendored); review/cover the 9 escaper-less `innerHTML` pages | high | M |
| F2 | Extend `scripts/stamp-css-version.js` to also stamp `/js/*.js` links (WebView stale-cache problem persists for JS) | high | S |
| F3 | Wire-or-delete dead assets: `qc-ui.js` (0 includes), `ui-skeletons.js` (1), `mobile-init.js`/`error-prevention.js` (0) | med | M |
| F4 | Slim the Tailwind regex safelist — 928 KB build served on 101 pages, likely <200 KB after audit. Caution: the safelist guards class strings composed dynamically in inline scripts that Tailwind's scan can't see; purge in stages with cross-page visual verification (precedent: a `design-system.css` `.hidden` change once silently broke all `hidden sm:block` toggles) | med | M |
| F5 | Externalize JS from mega-pages (`admin-dpl` ~5.5K lines, `admin-painters` ~5K, `staff/dashboard` ~3.5K) — prerequisite for S9 CSP and T7 linting | med | XL |
| F6 | Self-host CDN libraries (Chart.js, Leaflet, fonts; 0 SRI today) | med | M |
| F7 | Roll out `idempotency-fetch.js` beyond 2 estimate pages to billing/vendor/salary forms (server already supports 16 scopes) | med | S |

### Theme I — Integrations & jobs

| # | Item | Impact | Effort |
|---|---|---|---|
| I1 | Migrate transactional WhatsApp (reminders, PDFs, alerts) to WhatsApp Business Cloud API; keep wwjs for marketing only | high | XL |
| I2 | Fix `scripts/clawdbot-call.mjs:8` absolute prod path (env var or `require.resolve`) — sole enabled AI provider | high | S |
| I3 | Bring stray jobs under cluster-guard + automation registry (activity-feed cron, server.js inline intervals, photos cleanup) | med | M |
| I4 | Replace `photos.js` 5-min polling pseudo-cron with `cron.schedule` | low | S |
| I5 | Unify FCM Android channels (`qc_notifications` vs `qc_admin_channel` inconsistency drops notifications) | med | S |
| I6 | Harden or replace the `notebooklm` CLI dependency (unversioned, racy `use`→`ask`, opaque failures) | med | M |
| I7 | De-conflict the 02:00–03:45 IST batch window (7 heavy jobs overlap on DB + Zoho quota) | med | M |
| I8 | Batch notification fan-out (FCM multicast supports 500/batch; current loop is serial per user) | low | M |
| I9 | Cache nodemailer transporter; surface email failures instead of swallowing to `false` | low | S |

### Theme D — Database & schema hygiene

| # | Item | Impact | Effort |
|---|---|---|---|
| D1 | Commit canonical schema snapshot (`mysqldump --no-data`), regenerate per release — core Zoho tables have NO DDL in repo | high | M |
| D2 | Normalize all migrations to `exports.up(pool)`; especially fix the 11 "neither-pattern" files whose side effects run on `require()` yet get reported as failed | high | L |
| D3 | One-time audited backfill of prod `_migrations` so `--status` becomes trustworthy | high | S |
| D4 | Consolidate dual audit tables (legacy `audit_log` vs `audit_records`) | med | M |
| D5 | Standardize charset/collation/ENGINE (mixed collations risk index-miss joins on VARCHAR Zoho IDs) | med | M |
| D6 | Add FKs/indexes to PNTR marketing + reorder tables (orphan rows possible today) | med | M |
| D7 | Owner decision: backfill `estimates.branch_id` (all-NULL) to enable strict branch isolation | med | M |
| D8 | Retention policy for unbounded append-only tables (`painter_point_transactions`, `whatsapp_messages`, `painter_location_events`, …) | med | M |
| D9 | Delete or convert dead `migrations/add_missing_indexes.sql` | low | S |

### Theme R — Release engineering

| # | Item | Impact | Effort |
|---|---|---|---|
| R1 | Android repo: add git remote, commit 17 dirty files, merge `design/painter-app-ux-2026-05` into `master` (painter master is stuck at v3.1.8) | high | S |
| R2 | Parameterize Play publish scripts (release notes hardcoded to wrong versions in `publish-painter.js`) | med | S |
| R3 | Web deploy script or CI/CD: pull → install → restart → `/health` smoke check → report HEAD; rollback path | high | M |
| R4 | Gradle version catalog + per-flavor version-bump script (Play versionCodes burn even on failed uploads) | low | M |

### Theme X — Business features

| # | Item | Impact | Effort |
|---|---|---|---|
| X1 | Extend `dpl_catalog` mediator beyond Birla Opus (parsers for Asian/Berger/Gem/JSW/Nippon exist; linker strategy S1 — SKU-reconstruction, see §6(d) — needs per-brand SKU stem rules) | med | L |
| X2 | Batch `dpl_catalog` write paths (currently 1 query/row; rebuild = hundreds of round-trips) | low | S |
| X3 | Batch slab evaluation (N+1: 3 queries per painter per monthly cron) | low | M |

### Theme DOC — Documentation & process

| # | Item | Impact | Effort |
|---|---|---|---|
| DOC1 | Update CLAUDE.md §3/§4/§6/§10 per §3 of this report — **prevents dangerous re-fixes**; do this FIRST | high | S |
| DOC2 | Refresh Skills.md (3 weeks / ~343 commits stale) + COMPLETION_STATUS corrections | med | S |
| DOC3 | Commit-or-discard the 4 untracked files (`admin-dpl-hotfix.patch`, 3 plan docs) | low | S |
| DOC4 | Remove stale bug comments (`routes/zoho.js:443-445`) | low | S |

---

## 14. Open questions / owner decisions needed

The survey collected 69 open questions; the ones below materially affect upgrade planning. The master prompt should instruct the executor to **ask the owner before** starting any phase that depends on them.

### Business-policy decisions

| # | Question | Blocks |
|---|---|---|
| Q-B1 | Painter credit: should `checkOverdueCredits` consider only UNPAID self-billing invoices, and should `credit_used` be reduced after the auto-debit? (Current code can re-debit daily.) | M3 |
| Q-B2 | Should clawback-absorbed points appear in the painter-facing ledger? (Currently netted invisibly.) | M2 |
| Q-B3 | Slab evaluation sums BOTH attribution rows (direct + salesperson) for the same invoice — is the intended slab basis total purchases or self-billing only? Double-counting is possible. | M9 |
| Q-B4 | Is unapproved weekday OT (>10h computed, not approved) intentionally unpaid forever, or pending an approval-backfill feature? | M6 |
| Q-B5 | Will `dpl_catalog` be extended to Asian/Berger/Gem/JSW/Nippon, or do those brands stay on the legacy fuzzy flow? | X1 |
| Q-B6 | The 29 white / 24 clear non-standard SKU links flagged in the DPL duplicate audit are still pending owner review — any linker change must not re-link them blindly. | X1 |
| Q-B7 | Should 2FA become mandatory for admin/manager (currently opt-in)? | S6 |
| Q-B8 | Should `estimates.branch_id` (all-NULL on prod) be backfilled to enable strict branch isolation? | D7 |
| Q-B9 | Is the engineers portal live in production (it's "Phase 1" in code and absent from docs)? Determines how much security investment it gets now. | S12 |
| Q-B10 | Is the customer-OTP `console.log` in prod relied on operationally (support reading OTPs from pm2 logs)? Removing it changes a workflow. | S2 |

### Production facts not verifiable from the repo

| # | Question |
|---|---|
| Q-P1 | Actual prod Node version, pm2 mode/instances, MariaDB version, nginx/aaPanel proxy config (TLS, body limits), `CORS_ORIGIN` set or fallback? |
| Q-P2 | Exact prod schema of the no-DDL tables (`zoho_items_map`, `zoho_customers_map`, `zoho_invoices`, `zoho_payments`, `zoho_daily_transactions`) — needed before D1. |
| Q-P3 | Current open P1/P2 count — triage froze at 106 P1 + 335 P2; ~20 fix batches landed since; no tracker decrements (memory's "252 remain" matches no document). |
| Q-P4 | Which `ai_config` provider flags are enabled in prod right now (memory says Clawdbot-only)? Is the `notebooklm` CLI still installed? Is Zoho Payments live? Are VAPID keys configured? |
| Q-P5 | Is the OS-level monthly archival crontab (`config/data-archival-cron.json` → `scripts/archive-old-data.js`) actually installed on prod? |
| Q-P6 | Painter Android: working tree shows vc43/4.1.2 uncommitted, memory says vc41 was last built — were vc42/43 ever built/shipped, and has ANY v4.x reached Play yet? Staff defaultConfig bumped to vc19/3.4.0 uncommitted — planned release? |
| Q-P7 | Is the `whatsapp_api_url`/`whatsapp_api_key` HTTP fallback configured in prod, and which gateway is it? |
| Q-P8 | Prod values of `zoho_config.sync_interval_minutes` / `stock_sync_interval_hours` — needed to budget the 10k/day Zoho quota in any sync change. |

### Intent clarifications (ask before "cleaning up")

- Are `/api/guest/*`, `POST /api/calculate`, and `GET /api/2fa/validate` still consumed by any client, or dead code candidates?
- Are `qc-ui.js`, `ui-skeletons.js`, `mobile-init.js`, `error-prevention.js` intentionally retired or shipped-but-never-wired? (0–1 includes each.)
- Is `birla-opus-report.html` + the 2.6 MB PDF in `public/` a permanent public artifact or a one-off to gate/remove?
- Is the geofence logic duplication (server.js 60s inline interval AND auto-clockout 5-min checks) a deliberate warning-vs-enforcement split or legacy overlap?
- Is `QC-PROJECT-DOSSIER.md` (236 KB, 2026-06-08) superseded by this report?

---

## 15. Guidance for authoring the master upgrade prompt

You (the reader of this report) are expected to produce a **master prompt** that the owner will hand to **Claude Code** for execution. This section tells you what that prompt must contain and what the executor can do.

### 15.1 Executor capabilities & environment

- Claude Code runs on the owner's **Windows 11 dev machine**, repo at `D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\act.qcpaintshop.com` (Android sibling at `..\qcpaintshop-android`).
- It can: read/edit any file, run `npm test` / `npm run lint` / `npm run build:css` locally, run git (remote `origin` on GitHub), and deploy to prod via `ssh hetzner "... pm2 restart business-manager"`.
- It can query the prod DB read-only when asked, but must show any write SQL for approval first (§2.3).
- It replies to the owner in **Tamil**; all code/commits/docs in English.
- It has this report, the repo, and the repo's CLAUDE.md available. Where CLAUDE.md conflicts with §3 of this report, **this report wins** (it is newer and code-verified) — but the prompt should also schedule P1 (fix CLAUDE.md) early so the conflict disappears.

### 15.2 What the master prompt MUST contain

1. **Scope selection** — an explicit list of backlog items (use the §13 IDs: S1, M3, T1, …). Do not say "improve security"; say "implement S1, S2, S3, S5". If you propose items not in §13, ground them in §4–§12 facts.
2. **Phasing with verification gates.** Recommended shape:
   - *Phase 0 — Safety net*: DOC1 (CLAUDE.md corrections), T1 (CI), T5 (coverage visibility), R1 (Android repo remote). Cheap, removes the most dangerous failure modes.
   - *Phase 1 — Quick security wins*: S2 (precondition: owner answer to Q-B10), S3, S4, S5, S10, I2, F2 (all S-effort).
   - *Phase 2 — Money-path fixes* ⚠: M1, M2, M3, M4, M5, M9 — preconditions: Q-B1 (for M3), Q-B2 (for M2), Q-B3 (for M9); every item requires a characterization test before edit and failing-test→fix→passing-test evidence.
   - *Phase 3 — Structural*: A1, A2, D1-D3, T2-T4, F1.
   - *Phase 4+ — Large bets* (each its own approved plan): I1 (WhatsApp), S9+F5 (CSP), A8, A12, X1.
   Per phase: goal, exact backlog IDs, acceptance criteria, the verification command(s) whose output proves completion (`npm test`, specific curl checks, etc.), and a "STOP — get owner approval" gate before the next phase.
3. **The §2 constraints verbatim** (or by unambiguous reference) — especially the owner-confirmed policy table and the do-not-re-fix list from §3. Instruct the executor to NEVER "fix" `gst_amount=0`, the single ₹10 rounding, the Sunday-OT ×2, the 10h standard day, or the UTC session timezone.
4. **Open-question handling** — for any phase touching a §14 question, the prompt must direct the executor to ask the owner and wait, not assume.
5. **Process rules** — plan mode before multi-file work; test-first for bug fixes; show evidence; commit message conventions incl. footer; never run destructive prod SQL without showing it; deploy only when the owner asks, then verify `/health` and report the new HEAD.
6. **Definition of done per item** — e.g., for S1: "migration drops both raw columns (additive-safe: stop writes first, deploy, then drop), `npm test` green, no code path reads `session_token`, grep proof included."

### 15.3 What the master prompt must NOT do

- Do not schedule already-done work (§3 list: Tailwind CDN migration, double-rounding fix, salary OT fix, UPI centralization, scheduler-gating fix).
- Do not propose framework rewrites (React/Vue migration, TypeScript conversion, microservices split) — out of scope unless the owner explicitly asks; the codebase's convention is vanilla JS + incremental improvement.
- Do not bundle more than ~5–8 backlog items per phase; the executor works best with small verifiable batches matching the existing `fix(p0)/fix(p1)/fix(p2)` commit cadence.
- Do not instruct blind runs of `node migrate.js` on prod (§2.3 `_migrations` trap).
- Do not touch the painter Android `master` branch assumptions — the live painter app code is on `design/painter-app-ux-2026-05` (see §12).

### 15.4 Suggested master-prompt skeleton

```
ROLE: You are the executor for the QC Paint Shop upgrade. The project report
(docs/PROJECT-REPORT-2026-06-10.md) is the source of truth; its §2 constraints
and §3 corrections are binding.

PHASE <n>: <name>
  Items: <backlog IDs with one-line restatement>
  Preconditions: <owner answers needed, e.g. Q-B1>
  For each item:
    - Plan briefly, then implement test-first.
    - Acceptance: <specific command + expected output>
  Phase gate: run `npm test` (expect ≥ current green count), `npm run lint`
  (0 errors), summarize diffs, STOP for owner approval before Phase <n+1>.

DEPLOYMENT: only on explicit owner instruction; afterwards verify
https://act.qcpaintshop.com/health and report deployed HEAD.

LANGUAGE: report to the owner in Tamil; code/commits/docs in English.
```

*End of report.*
