# QC Paint Shop Business Manager — Complete Project Dossier

> **Generated:** 2026-06-08 · **Repo:** `act.qcpaintshop.com` · **Branch:** master
> **Purpose:** A single, exhaustive, source-grounded reference to the entire QC Paint Shop
> Business Manager platform — produced by reading the real codebase (49 routes, 63 services,
> 118 migrations, 123 pages, ~205K LOC) rather than from memory. Every claim is traceable to a
> file (`path:line`). This document is written to be handed to another AI for deep analysis.

---

## 0. How to use this dossier (for the analyzing AI)

You are reading a faithful, evidence-based map of a large, **production-live** Node.js/Express
business platform. It was assembled by 13 specialist passes over the actual source tree, each
grounding its claims in real files.

**What this document is for.** The owner intends to feed this to a personal AI so that AI can
(a) understand the system completely and (b) help design a better operating prompt / working
brief for **Claude Code** (the agent that maintains this repo). To do that well, pay attention to:

- **§14 "How Claude Code currently operates here"** — the existing conventions, guardrails,
  memory system, and workflow rules Claude already follows. Any "make Claude great" prompt should
  *extend* these, not contradict them.
- **§8 Core Business Logic** and **§12 Defects & Tech Debt** — the money/correctness paths and
  the open risks. These are where mistakes are most expensive and where improvement has the
  highest leverage.
- **§6 Database** and **§2 Architecture** — the load-bearing invariants (single pool, UTC session
  TZ on an IST clock, the `ZOHO_ORGANIZATION_ID` scheduler gate, additive-only migrations).

**How to read it.** Sections 1–13 move from the outside in: business → architecture → security →
API → services → data → UI → core logic → integrations → background jobs → ops → quality →
history. Section 14 is meta (how the maintaining agent works). Section 15 offers concrete
prompt-design hooks.

**Trust level.** Sub-sections cite `file:line`. Where a fact comes from project notes rather than
code (Android apps, deploy host, Telegram delivery), it is labelled as such. Treat the cited code
facts as authoritative as of 2026-06-08; treat counts as "~" because the codebase changes weekly.

---

## Table of contents

1. Executive Summary & Business Domain
2. Architecture & Application Wiring
3. Authentication, Authorization & Security Model
4. API Surface — Routes Catalog
5. Services Layer Catalog
6. Database Schema (derived from migrations)
7. Frontend & UI System
8. Core Business Logic — Money & Correctness Paths
9. External Integrations
10. Background Jobs, Schedulers & Crons
11. Android Apps, Deployment & Operations
12. Testing, Quality, Known Defects & Tech Debt
13. Feature History, Conventions & Roadmap
14. How Claude Code currently operates in this repo (meta)
15. Analysis hooks — designing a "make Claude great" prompt

---

## 1. Executive Summary & Business Domain

**QC Paint Shop Business Manager** (deployed at `act.qcpaintshop.com`) is an internal, production-live, multi-branch business-management platform for **Quality Colours**, a paint retail/dealer business in India. It is not a customer storefront — it is the operational back-office that runs the company: it tracks staff and their pay, manages sales leads and debt collection, generates customer estimates and pushes them as invoices to Zoho Books, runs a points-based loyalty program for painters, ingests dealer price-lists (DPL) and reconciles them against the Zoho item catalog, and layers an AI analytics dashboard, WhatsApp marketing, and inventory reorder intelligence on top. The system description is given in `Skills.md:13`: a "multi-branch paint shop management platform that handles every aspect of running a paint retail business — from customer walk-ins and AI-powered color visualization, through estimate generation and Zoho Books accounting integration, to staff attendance tracking with geo-fencing, salary management, and real-time team chat."

It is a mature, deployed system, not a prototype. Production maturity signals: ~205,000 LOC web (`Skills.md:6`), a ~4,350-line Express 5 entry point (`server.js`), 49 route modules, 63 services, 118 incremental migration scripts (plus one `add_missing_indexes.sql`), and 123 static HTML pages. It runs under PM2 on a Hetzner Ubuntu host (`178.104.249.206`), backed by MySQL/MariaDB (`qc_business_manager`) and Socket.IO for real-time. The accompanying `COMPLETION_STATUS.md` audit (2026-06-04) classifies the core modules — staff/admin auth+RBAC, customer/painter auth, DPL catalog pipeline, billing/Zoho sync, estimates, leads, collections, attendance, salary — as "deployed on prod and exercised daily."

### Distinct actor types

The platform serves **five distinct actor types**, each with its own authentication system, its own session table, and its own set of frontend pages (identifiable by the `public/*.html` filename prefix). The first three auth systems are formalized in `CLAUDE.md` §4; the engineer/dealer program is a fourth painter-pattern clone added later.

| Actor | What they do | Auth mechanism | Session store | Page prefix (count) |
|-------|--------------|----------------|---------------|---------------------|
| **Admin** | Full system operators/owners. Configure roles, branches, Zoho, AI, pricing, DPL catalog, painter program, reorder rules, WhatsApp, view all dashboards. Bypass all permission checks (`FULL_ADMIN_ROLES`: `admin`/`administrator`/`super_admin`). | `Authorization: Bearer <token>`, password+bcrypt, optional TOTP 2FA | `user_sessions` | `admin-*` (74) |
| **Staff** | Branch employees. Field/desk work: clock in/out (geo-fenced), handle leads, log collection calls, create estimates & invoices (billing), manage vendors, painter marketing calls, daily-work tasks, incentives. Same Bearer/RBAC system as admin but permission-gated per module. | `Authorization: Bearer <token>`, password+bcrypt, optional TOTP | `user_sessions` | `staff-*` (9) |
| **Painter** | Loyalty-program members (the dealer-business's painter customers). Earn/redeem points and AP, browse the product catalog, create self/customer estimates, do selfie+GPS attendance check-ins, request withdrawals, complete training. | `X-Painter-Token` header, phone OTP | `painter_sessions` | `painter-*` (8) |
| **Customer** | End customers (estimate requestors). Request estimates, view their estimates/requests, track status. | `Authorization: Bearer <token>`, phone OTP | `customer_sessions` | `customer-*`, `request-estimate.html`, `estimate-view.html` (~6) |
| **Engineer / dealer** | B2B project-buyer accounts (`routes/engineers.js:10` — "Engineers are B2B project-buyer accounts"). Register/onboard with admin approval + credit, browse catalog, build a cart, raise quotes. Explicitly "mirrors the painter pattern" with its own hashed 30-day session. | `X-Engineer-Token` header, phone OTP | `engineer_sessions` | `engineer-*` (7) |

The admin (`#667eea→#764ba2` purple) and staff/painter (`#1B5E3B` green + `#D4A24E` gold) UIs are visually distinct by brand color, with "no purple in staff/painter pages" enforced as a rule.

### Major functional domains at a glance

Grouping the 49 route modules and 63 services by domain:

- **Staff / attendance / salary** — staff registration & approval (`routes/staff-registration.js`), geo-fenced clock-in/out with auto-clockout (`routes/attendance.js`), hourly-basis salary with Sunday OT and leave deductions (`routes/salary.js`), daily-work tasks and activity tracking (`routes/staff-daily-work.js`, `activity-tracker.js`, `daily-tasks.js`), incentive slabs.
- **Leads & collections** — lead capture, scoring, auto-assignment, nurture (`routes/leads.js`); debt-collection call logging, promises, history (`routes/collections.js`); credit limits synced from Zoho (`routes/credit-limits.js`).
- **Estimates & billing** — the pricing engine and estimate CRUD/payment/PDF/WhatsApp flow (`routes/estimates.js`, the documented money-critical path), full billing software with invoices and Zoho push (`routes/billing.js`, `services/billing-zoho-service.js`), estimate requests from customers (`routes/estimate-requests.js`), PDF generation (`routes/estimate-pdf*.js`).
- **Painter loyalty program** — points engine with regular/annual pools, level multipliers, daily-bonus cap and clawback (`services/painter-points-engine.js`); tiers (bronze 0 / silver 5K / gold 25K / diamond 100K, no platinum); withdrawals; selfie+GPS attendance "AP" earning (`services/painter-attendance-service.js`); live location tracking; the 337KB `routes/painters.js`.
- **DPL price-list catalog + item-master** — dealer price-list PDF parsing (`services/price-list-parser.js`, 94KB) → deterministic `dpl_catalog` mediator (`services/dpl-catalog.js`) → item master with the `ceil(dpl × 1.18 × 1.10)` rate formula (`routes/item-master.js`, `routes/price-list.js`).
- **Zoho Books/CRM sync** — OAuth, item/invoice/customer/payment sync, `cf_*` custom-field handling (`routes/zoho.js` at 303KB, `services/zoho-api.js`), background sync schedulers.
- **WhatsApp marketing & chat** — `whatsapp-web.js`-based sessions, contacts, campaigns, templates, live chat (`routes/wa-marketing.js`, `wa-contacts.js`, `whatsapp-chat.js`, `whatsapp-sessions.js`).
- **AI dashboard** — triple-provider LLM engine (Gemini + Claude + Clawdbot/Kai), automated business analysis, lead scoring, interactive chat, app self-analyzer (`routes/ai.js`, `services/ai-engine.js`).
- **Reorder intelligence** — branch-wise sales-velocity → auto reorder levels → daily report (dashboard + WhatsApp + FCM).
- **Vendor management** — vendor CRUD, purchase bills with AI OCR, POs, vendor payments (`routes/vendors.js`).
- **Cross-cutting / engineer program** — anomaly detection, monitoring, agreements, guides, photos, notifications, branches, roles, system health, and the engineer/dealer B2B program (`routes/engineers.js`).

### Relationship to the Android apps

The web platform is the system of record and back-office. There are **two separate Android codebases** (Kotlin/Compose), built from **3 product flavors** in a sibling repo at `..\qcpaintshop-android\` that is **local-only with no git remote** and **not part of this repository** (`CLAUDE.md` §1):

1. **Staff/Customer app** — flavors `staff` and `customer`, currently v3.3.9 vc18 on Play Store production.
2. **Painter app** — the dedicated `painter` flavor, a fuller native rewrite (v4.0.0+ vc39+), delivered to the user via a Telegram bot during testing; Play Store upload pending.

The apps consume the same Express API (the painter app uses the `X-Painter-Token` painter endpoints; native features like geofence/FCM call the same routes documented here), so this web repo is the authoritative source for all API contracts. Android-specific concerns (build flavors, `BuildConfig`, Robolectric, Play Store publishing) live entirely in that separate repo and the `google-services/` publish scripts, not here.

---

## 2. Architecture & Application Wiring

### 2.1 Runtime topology (stack)

A single Node.js process serves the entire platform. There is no separate API/worker split — HTTP, WebSocket, and all background schedulers run inside one `node server.js` process (managed in production by PM2 as `business-manager`).

| Layer | Technology | Evidence |
|-------|-----------|----------|
| Runtime | Node.js v24 | `CLAUDE.md` §2 |
| HTTP framework | Express 5 | `server.js:12`, `package.json` |
| HTTP server | `http.createServer(app)` (NOT `app.listen`) | `server.js:3923` |
| Realtime | Socket.IO v4 bound to the same HTTP server | `server.js:22, 3926` |
| Database | MySQL / MariaDB 10.11 via `mysql2/promise` | `config/database.js:6` |
| DB name | `qc_business_manager` | `CLAUDE.md` §2 |
| Image processing | `sharp` | `server.js:18` |
| Frontend | static HTML + vanilla JS + Tailwind (JIT) served from `public/` | `server.js:269` |

The reason `http.createServer(app)` is used instead of `app.listen()` is that Socket.IO must attach to the raw HTTP server to share the same port/listener as Express (`server.js:3923-3945`). The single listener is started once at `server.js:4151` (`server.listen(PORT, …)`), `PORT` defaulting to `3000` (`server.js:3922`).

### 2.2 The single connection pool

The entire app shares **exactly one** MySQL pool, created in `config/database.js` and instantiated once in `server.js:240` (`const pool = createPool()`).

Pool configuration (`config/database.js:8-21`):

| Option | Value | Notes |
|--------|-------|-------|
| `connectionLimit` | `20` | hard cap on concurrent connections |
| `waitForConnections` | `true` | callers queue rather than error when pool is exhausted |
| `queueLimit` | `0` | unbounded wait queue |
| `timezone` | `'+00:00'` | controls how **mysql2** serializes/parses JS `Date` ↔ MySQL datetime strings |

**The load-bearing timezone story.** The server's OS clock and MySQL `SYSTEM` timezone are both `Asia/Kolkata` (IST, UTC+5:30) because `/etc/localtime` is Kolkata. Two distinct, easily-confused mechanisms must be aligned:

1. The mysql2 `timezone: '+00:00'` option only affects how the **driver** converts JS `Date` objects to/from datetime strings (`config/database.js:18-20`).
2. MySQL's own `NOW()` / `CURRENT_TIMESTAMP` ignore that option entirely — they follow the **session** `time_zone`. Left at `SYSTEM`, they would return IST.

To reconcile them, every new pooled connection runs `SET SESSION time_zone = '+00:00'` via a `pool.on('connection')` hook (`config/database.js:26-30`). Without this, `NOW()` would return IST while the driver assumes UTC, putting every `DATETIME` insert **5h30m off**. This is why the offset is described as "load-bearing": it makes the database operate entirely in UTC despite an IST host, and application code that needs IST for display (e.g. the geofence cron) explicitly adds `5.5 * 60 * 60 * 1000` ms back (`server.js:4175-4177`).

### 2.3 Dependency-injection wiring — "never create a second pool"

Routes and services do **not** import the pool or create their own. Instead, `server.js` creates the one pool and **pushes** it into every module through a uniform `setPool(pool)` setter. This is the canonical wiring pattern; introducing a second `mysql.createPool()` anywhere would defeat the 20-connection cap and the UTC session hook.

- **Injection block:** `server.js:272-382`. It begins with `initPool(pool)` (which seeds the permission middleware), then `customerAuthService.setPool(pool)`, and proceeds to call `setPool(pool)` on ~60 route and service modules. Some modules receive additional dependencies via sibling setters in the same block, e.g.:
  - `attendanceRoutes.setActivityTrackerService(activityTrackerService)` (`:276`)
  - `billingRoutes.setPointsEngine(require('./services/painter-points-engine'))` (`:332`)
  - `errorHandlerMw.setPool(pool)` + `errorHandlerMw.setErrorAnalysisService(errorAnalysisService)` (`:346-347`)
  - `require('./services/audit-log').setPool(pool)` (`:336`)
  - `rateLimiter.setPool(pool)` to enable DB persistence of Zoho API-call counters (`:290`)
- **Socket.IO injection block:** a second wave of setters runs after `io` is constructed — `notificationService.setIO(io)`, `autoClockout.setIO(io)`, `paintersRoutes.setIO(io)`, etc. (`server.js:3957-3977`), plus `painterNotificationService.setDependencies(pool, io)` (`:3977`) and `adminDashboardRoutes.setDependencies({ pool, onlineUsers, automationRegistry })` (`:3955`).
- **Route mounting block:** `server.js:394-438`. Every router is mounted under `/api/*` as `app.use('/api/<name>', <module>.router)`. Note the module export shape: route files export `{ router, setPool, … }`, so mounts reference `<module>.router` (e.g. `app.use('/api/leads', leadsRoutes.router)` at `:398`). One exception is `twoFARoutes`, mounted as the router object directly: `app.use('/api/2fa', twoFARoutes)` (`:437`). The estimates router is additionally gated: `app.use('/api/estimates', requireAuth, estimateRoutes.router)` (`:409`), while the PDF sub-router shares the same prefix without that gate (`:408`).

**Rule for new code:** a new route/service file must (a) expose a `setPool(pool)` setter, (b) be wired in the `server.js:272-382` injection block, and (c) be mounted in the `server.js:394-438` block — and must **never** call `mysql.createPool()` itself.

### 2.4 Global middleware stack, in order

Middleware is registered top-to-bottom in `server.js`; Express runs it in registration order. The effective chain:

| # | Middleware | Location | Key facts |
|---|-----------|----------|-----------|
| 0 | `app.set('trust proxy', 1)` | `server.js:106` | trusts the first proxy hop (nginx/aaPanel) so `req.ip` and rate-limit keying are correct |
| 0b | `console.error` monkey-patch | `server.js:110-118` | installs the global error buffer (see §2.6) before anything else |
| 1 | **helmet** (security headers + CSP) | `server.js:133-168` | see CSP note below |
| 2 | **compression** (gzip/br) | `server.js:171` | `require('compression')()` |
| 3 | **CORS** | `server.js:187-212` | env allowlist, never `*` (see below) |
| 4 | `express.json({ limit: '10mb' })` | `server.js:213` | JSON body parsing, 10 MB cap |
| 5 | `express.urlencoded({ limit: '10mb', extended: true })` | `server.js:214` | form body parsing |
| 6 | **global rate limiter** on `/api` | `server.js:217` | `app.use('/api', globalLimiter)` |
| 7 | **responseTracker.middleware** | `server.js:220` | per-request timing ring buffer (see §2.7) |
| 8 | applink redirect `GET /r/:code` | `server.js:230-233` | referral short URL → `painter-register.html?ref=…` |
| 9 | **PII upload gate** | `server.js:249-267` | guards `/uploads/aadhar` + `/uploads/documents` BEFORE static |
| 10 | `express.static('public')` | `server.js:269` | serves the SPA-ish static frontend |
| 11 | `express.static('uploads')` at `/uploads` | `server.js:270` | serves user uploads (after the PII gate) |
| 12 | route mounts | `server.js:394-438` | all `/api/*` routers + auth endpoints |
| 13 | static 404 fallback | `server.js:3900-3906` | non-`/api` non-`/socket.io` paths get `public/404.html` |
| 14 | **globalErrorHandler** | `server.js:3912` | terminal error middleware (see §2.5) |

**helmet / CSP (`server.js:133-168`).** Helmet sets standard hardening headers plus an **allowlist-based** Content-Security-Policy. `script-src` and `style-src` deliberately include `'unsafe-inline'` and (for scripts) `'unsafe-eval'` (`server.js:139, 148-150`). The reason, per the in-file comment (`server.js:126-132`): the `public/` pages still contain many inline event handlers and inline `<script>` blocks; dropping `unsafe-inline`/`unsafe-eval` requires migrating those first, so it is a deferred hardening task. Because CSP is allowlist-based, any CDN host not explicitly listed (the file enumerates jsdelivr, cdnjs, unpkg, quilljs, socket.io, googletagmanager, youtube) is blocked by default — notably `cdn.tailwindcss.com` is intentionally absent, forcing pages onto the local JIT build (`public/css/tailwind.css`); a regression to the Tailwind CDN will visibly break rather than silently load.

**CORS (`server.js:174-212`).** Origins come from the `CORS_ORIGIN` env var, comma-split into an allowlist (`server.js:176-177`). It is **fail-safe, never wildcard**: if `CORS_ORIGIN` is unset in production it logs an error and falls back to the single hardcoded `https://act.qcpaintshop.com` (`:179-182`); in development it allows `localhost:3000` / `127.0.0.1:3000` plus private LAN ranges (`192.168.*`, `10.*`, `172.*`) (`:194-207`). Requests with no `Origin` header (server-to-server, Postman, same-origin) are allowed (`:190`). `credentials: true` is set (`:211`). The same origin logic is duplicated for the Socket.IO CORS config (`server.js:3926-3945`).

**3-tier rate limiting (`middleware/rateLimiter.js`).** All three use `express-rate-limit` with a 60-second window and a shared `429`/`RATE_LIMITED` JSON handler:

| Limiter | Window / max | Keying | Applied to |
|---------|--------------|--------|-----------|
| `globalLimiter` | 60s / **100** per IP | default (IP) | `app.use('/api', globalLimiter)` — all API routes (`server.js:217`) |
| `authLimiter` | 60s / **10** per IP | default (IP) | login endpoints: `/api/auth/login` (`:463`), `/api/auth/login-2fa` (`:531`) |
| `otpLimiter` | 60s / **5** | **per phone** (`req.body.phone`), IP fallback disabled (`rateLimiter.js:49-56`) | `/api/otp/send`, `/api/otp/verify`, `/api/otp/resend`, `/api/customer/auth/send-otp`, `/api/customer/auth/verify-otp` (`server.js:935, 1082, 1125, 3341, 3400`) |

All three set `validate: { xForwardedForHeader: false }` because `trust proxy` is already configured (`rateLimiter.js:28, 39, 56`).

**PII upload gate (`server.js:248-267`).** Mounted on the array `['/uploads/aadhar', '/uploads/documents']` and positioned **before** `express.static` so it intercepts direct file URLs. It extracts a Bearer token (or `?token=` query param), hashes it as `LOWER(SHA2(token,256))`, joins `user_sessions`→`users`, and requires the session to be live (`expires_at > NOW()`, `status='active'`) AND the user's role to be in `PII_PRIVILEGED_ROLES = {admin, manager, hr}` (`:248, 259-261`). Anyone else gets `401`/`403`. Owner-can-read-own logic for these files lives in dedicated API routes instead (per the in-file comment, `:244-247`).

**Note on `requestLogger`.** `middleware/requestLogger.js` exists (logs method/path/status/duration, warns on >2s requests) but is **not** wired into `server.js` — the active per-request timing path is `responseTracker.middleware`. Treat `requestLogger` as a dormant module.

### 2.5 Centralized error handling

`middleware/errorHandler.js` is the terminal middleware (`app.use(errorHandlerMw.globalErrorHandler)` at `server.js:3912`, after all routes). On any error it:

- logs `[timestamp] Error in METHOD URL: message` to console (`errorHandler.js:238`) — which feeds the global buffer (§2.6);
- **asynchronously persists** the error to the `error_logs` table via `logError()` (`errorHandler.js:43-129, 241`), with request-body redaction of `password/token/secret/api_key/otp/pin/new_password/current_password` (`:51`), stack-trace parsing for file/line, deduplication by `error_hash`, and auto-bug-creation when an error recurs 20 or 50 times or is `critical`/`high` (`:79-83, 119-121`);
- maps known errors to HTTP codes: `ER_DUP_ENTRY`→409, `ER_NO_REFERENCED_ROW_2`→400, `ECONNREFUSED`→503, `JsonWebTokenError`→401, etc. (`errorHandler.js:252-257`);
- **suppresses stack traces and 5xx messages in production** (`NODE_ENV==='production'` → generic "Internal server error", no `stack` field) (`:259-265`).

Severity (`assessSeverity`, `:14-25`) and type (`classifyError`, `:29-39`) classification escalate auth/payment/zoho routes and DB/connection errors. Uncaught exceptions and unhandled rejections are also routed through `logError` at process level (`server.js:4344-4354`).

### 2.6 Global `console.error` buffer (App Analyzer feed)

At the very top of boot (`server.js:108-118`), `console.error` is monkey-patched: it still calls the original, but also pushes each error into `global._appErrorBuffer` — a capped in-memory ring of the **last 100** entries, each `{ message (≤500 chars), stack, timestamp }`, with the oldest shifted out (`:116`). The wrapping is itself wrapped in `try/catch` so logging can never crash the app (`:117`). This buffer is consumed by the AI App Analyzer (one of `app-metadata-collector.js`'s scanners) to surface recent runtime errors to the AI dashboard without a DB round-trip.

### 2.7 Response-time tracking

`middleware/responseTracker.js` (mounted at `server.js:220`) records only `/api/*` requests (`responseTracker.js:22`). It wraps `res.end` to measure duration via `process.hrtime.bigint()` and stores entries in a **1000-slot ring buffer** (`BUFFER_SIZE = 1000`), tracking slow endpoints (≥3000 ms threshold) keyed by `METHOD path` (`:7-8, 52-60`). `getMetrics()` computes p50/p95/p99/avg, RPM, 5xx error rate, and a status-code breakdown over the last 5 minutes (`:66-121`). These metrics are surfaced through the monitoring routes (`monitoringRoutes.setResponseTracker(responseTracker)`, `server.js:378`) and to the production monitor.

### 2.8 Socket.IO usage (high level)

Socket.IO (`server.js:3926`) is authenticated and room-based:

- **Handshake auth** (`io.use`, `server.js:4005-4029`): the client sends `socket.handshake.auth.token`; the server validates it against `user_sessions` using the same `LOWER(SHA2(token,256))` hash + live-session check as REST, then attaches `socket.user = {id, username, role, full_name}`. Unauthenticated sockets are rejected.
- **Online presence** (`server.js:3951-3952, 4036-4043, 4137-4147`): an in-memory `onlineUsers` Map (`userId → Set<socketId>`) tracks multi-tab connections; transitions emit `user_online`/`user_offline` into the `live_dashboard_admin` room for the admin live dashboard.
- **Rooms** each connection auto-joins `user_${id}` (personal notifications) and every `conversation_${id}` it participates in (`server.js:4046, 4086-4092`). On-demand joins (gated by `isFullAdmin` / role): `whatsapp_admin`, `wa_marketing_admin`, `whatsapp_chat_admin`, `painter_${id}`, `admin_painters_live`, `live_dashboard_admin` (`server.js:4049-4135`).
- **Events emitted/handled** include chat `typing`/`user_typing`, `mark_read`/`message_read` (`:4103-4128`), notification pushes via `notificationService` / `painterNotificationService`, WhatsApp QR/status to `whatsapp_admin`, painter live-location to `admin_painters_live`, and anomaly alerts.
- `io` is shared with routes via `app.set('io', io)` (`:3948`) and via the `setIO(io)` injection wave (`:3957-3975`).

### 2.9 Boot sequence and the scheduler gate

`server.listen(PORT)` (`server.js:4151`) runs the boot callback in this order:

1. Log banner + "Socket.io ready".
2. Hand the `automationRegistry` to every scheduler via `setAutomationRegistry(...)` (`server.js:4157-4164`).
3. **Always-on** background work (independent of Zoho): `autoClockout.start()`, `attendanceReport.start()` (`:4167-4168`), and a **60-second geofence enforcement `setInterval`** (`:4172-4296`) that does location-off auto-clockout (2-min grace), stale geo-warning auto-clockout (5-min at ≥300 m), and activity-tracker idle/max-duration checks. This cron computes IST locally by adding the 5.5h offset (`:4175-4177`), consistent with the UTC DB session (§2.2).
4. **The critical gate (`server.js:4298`):** `if (process.env.ZOHO_ORGANIZATION_ID) { … }`. Only when that env var is set do the following start: `syncScheduler` (Zoho sync), `whatsappProcessor`, `whatsappSessionManager.initializeSessions()`, `waCampaignEngine`, `aiScheduler`, `painterScheduler`, `dataRetentionService`, `leadAutoAssignScheduler`, `systemHealthService.startAutoHealthChecks(300000)` (every 5 min), `productionMonitor.start()` (self-healing), `photosRoutes.startCleanupCron()` (daily 2 AM IST), and an **anomaly full-scan `setInterval` every 6 hours** (`:4299-4320`). If the var is missing, it logs `Zoho not configured … sync/whatsapp skipped` and runs none of them (`:4321-4322`).

**Operational consequence:** `ZOHO_ORGANIZATION_ID` is the master switch for *all* recurring automation, not just Zoho. On any environment where it is unset (a dev box, a misconfigured deploy), the app still serves HTTP and Socket.IO normally, but WhatsApp, AI scheduling, painter/lead automation, data retention, anomaly scans, health checks, and self-healing silently do not run — so "feature X stopped firing" should first be diagnosed by checking this single env var (this matches `CLAUDE.md` §3). The geofence/attendance crons are the exception: they run regardless.

**Shutdown / resilience:** `SIGTERM`/`SIGINT` trigger `gracefulShutdown` (`server.js:4327-4341`), which stops health checks + production monitor and flushes the rate-limiter's buffered API-usage counters to the DB before `process.exit(0)`. `uncaughtException` (`:4344-4349`) and `unhandledRejection` (`:4351-4354`) log a critical/high entry via `errorHandlerMw.logError` before exiting.

### 2.10 `config/` directory

| File | Role |
|------|------|
| `config/database.js` | `createPool()` — the single mysql2 pool factory; 20-conn limit, `timezone:'+00:00'`, and the per-connection `SET SESSION time_zone='+00:00'` hook (§2.2). |
| `config/uploads.js` | Multer storage/limit/filter configs and `ensureUploadDirs()` (called at `server.js:388`). Pre-creates ~26 upload directories (`uploads.js:11-37`). Exposes named uploaders (image-only via `imageFilter`, image+PDF, PDF-only, CSV-only) with per-type size caps. Disk-stored uploaders use `Date.now()-rand` filenames; **memory-stored** ones feed downstream processing — `designRequestUpload`/`uploadPainterVisualization` (sharp compression, 10 MB), `uploadPriceList`/`uploadPriceCsv` (DPL/CSV parsing), `uploadVendorBill` (AI OCR). `uploadDplPdf` writes per-brand subfolders under `uploads/dpl-pdfs/<brand>` (`uploads.js:188-209`). **Caveat:** validation is mimetype/extension-only — no magic-byte check (`CLAUDE.md` §10). |
| `config/data-archival-cron.json` | Declarative config (not loaded by `server.js`) for an **external** monthly OS crontab job — `0 3 1 * *` (1st of month, 3 AM IST) running `node scripts/archive-old-data.js --execute`, archiving `zoho_invoices`/`zoho_payments`/`zoho_stock_history` older than 24 months into `*_archive` tables. |

Per-uploader caps (from `config/uploads.js`): logo 2 MB, offer banner 3 MB, profile/aadhar/product/painter-attendance 5 MB, price CSV 5 MB, design-request/training/painter-visualization/price-list/vendor-bill 10 MB, activity photo 15 MB, DPL PDF 15 MB.

---

## 3. Authentication, Authorization & Security Model

The platform runs **four independent authentication systems**, one per actor class, plus a database-backed **RBAC** layer for staff. They share no session table, no header, and no middleware — each actor type carries a different credential and resolves against a different store. There is no unified "user" abstraction: a single physical person who is both an admin and a painter would hold two unrelated sessions.

### 3.1 The four auth systems at a glance

| Actor | Credential header | Login method | Auth middleware | Session store | Token TTL |
|-------|-------------------|--------------|-----------------|---------------|-----------|
| **Staff / Admin** | `Authorization: Bearer <token>` | username/email/phone + password (bcrypt) + optional TOTP 2FA | `requireAuth` / `requirePermission(module,action)` / `requireRole(...)` / `requireAnyPermission([...])` in `middleware/permissionMiddleware.js` | `user_sessions` | 24 h, or 720 h (30 d) with `remember` |
| **Customer** | `Authorization: Bearer <token>` | phone OTP | `requireCustomerAuth` (`middleware/customerAuth.js` → `services/customer-auth.js`) | `customer_sessions` | 30 d (`SESSION_TTL_DAYS=30`, `services/customer-auth.js:13`) |
| **Painter** | `X-Painter-Token: <token>` | phone OTP | `requirePainterAuth` (approved only) / `requirePainterSession` (pending+approved) in `routes/painters.js` | `painter_sessions` | 30 d (`expires_at = NOW() + INTERVAL 30 DAY`, `routes/painters.js:279`) |
| **Engineer (B2B dealer portal)** | `X-Engineer-Token: <token>` | phone OTP | `requireEngineerAuth` (approved only) / `requireEngineerSession` (any status) in `routes/engineers.js` | `engineer_sessions` | 30 d (`routes/engineers.js:149`) |

The engineer portal is a B2B project-buyer/dealer surface (`public/engineer-login.html`, `public/js/engineer-portal.js`) that **mirrors the painter pattern exactly** — same SHA-256-hashed session token, 30-day session, 10-minute OTP, separate header. It is described in its own header comment as "Mirrors the painter pattern" (`routes/engineers.js:8-10`). Engineer self-service endpoints submit B2B quote/cart requests into the shared `estimate_requests` table tagged `source='engineer_portal'`.

### 3.2 Token format (uniform across all four systems)

Every system uses the **same opaque-token design** — there are no JWTs anywhere:

- **Generation:** `crypto.randomBytes(32).toString('hex')` → a 64-hex-char opaque token (e.g. `server.js:495`, `routes/painters.js:272`, `routes/engineers.js:142`, `services/customer-auth.js:23`).
- **At rest:** stored as a **SHA-256 hash**, never the raw token for lookup purposes. Two hashing idioms coexist but are equivalent:
  - SQL-side: `token_hash = LOWER(SHA2(?, 256))` (staff in `permissionMiddleware.js:51`; painter in `routes/painters.js:153`; engineer in `routes/engineers.js:39`).
  - App-side: `crypto.createHash('sha256').update(token).digest('hex')` (customer in `services/customer-auth.js:16`).
- **Lookup:** the incoming token is hashed and the **hash is compared** — the raw token is never queried. This means a DB leak does not directly yield usable session tokens.

**Legacy raw-token column (migration safety net).** The painter and engineer login paths **dual-write** both the raw token *and* the hash into the session row:

```js
// routes/painters.js:276-281
// Dual-write raw token + hash so a code rollback can still find this row; reads use hash.
const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
await pool.query(
  'INSERT INTO painter_sessions (painter_id, token, token_hash, otp, otp_expires_at, expires_at) VALUES (...)',
  [painter.id, token, tokenHash, otp]);
```

The staff login does the same (`user_sessions.session_token` + `token_hash`, `server.js:500-504`). The plaintext `token`/`session_token` column is **legacy** and exists only so a code rollback to a pre-hashing build can still resolve sessions; all current reads use the hash. It is a latent risk: a DB compromise exposes live raw tokens via that column.

### 3.3 Staff/Admin login flow

`POST /api/auth/login` (`server.js:463`, rate-limited by `authLimiter`):

1. Resolve user by `username OR email OR phone` where `status='active'` (`server.js:471-477`).
2. `bcrypt.compare(password, user.password_hash)` (`server.js:485`). Failures return a **generic `Invalid credentials`** for both unknown-user and bad-password — no user enumeration via this path.
3. **2FA gate:** if `role ∈ {admin, manager}` AND `user.totp_enabled`, the server returns `{ success:true, requires_2fa:true, user_id }` **without issuing a token** (`server.js:491-493`). The client must then call `POST /api/auth/login-2fa` with the TOTP code (`server.js:531`), which re-verifies via `totp-service` before issuing a session.
4. Session insert into `user_sessions` capturing `ip_address` (`req.ip`) and `user_agent` (`req.get('User-Agent')`) (`server.js:502-504`).
5. Session lifetime: `remember ? 720h : 24h`.

Related auth endpoints: `POST /api/auth/logout` (`server.js:703`), `GET /api/auth/verify` (`server.js:585`), `POST /api/auth/register` (`server.js:1226`), and two **enumeration-safe** password-reset flows (see §3.8). `app.set('trust proxy', 1)` (`server.js:106`) makes `req.ip` reflect the nginx/aaPanel client IP.

### 3.4 RBAC: roles, permissions, and the full-admin bypass

Authorization for staff is a three-table model managed via `routes/roles.js` (`{ router, setPool }`, mounted under `/api/roles`):

- **`roles`** — `name`, `display_name`, `user_type` (`'staff'|'customer'`), `status`, `is_system_role`, plus customer pricing fields `price_markup_percent` / `default_discount_percent`. System roles cannot be deleted (`routes/roles.js:329`).
- **`permissions`** — rows keyed by (`module`, `action`) with a `display_name` (e.g. `module='estimates', action='edit'`).
- **`role_permissions`** — join table linking `role_id` → `permission_id`.

**Permission resolution** (`requirePermission(module, action)`, `permissionMiddleware.js:34`):

1. Extract Bearer token; resolve the session by hash joining `user_sessions → users`, requiring `expires_at > NOW()` AND `users.status='active'` (`permissionMiddleware.js:47-53`). Populates `req.user = { id, username, role, full_name, email, branch_id }`.
2. **Full-admin bypass:** if the role is in `FULL_ADMIN_ROLES = ['admin','administrator','super_admin']`, the check short-circuits to `next()` with **no permission lookup** (`permissionMiddleware.js:24-27`, `74-77`). `isFullAdmin()` is case-insensitive. These three roles bypass *all* fine-grained permission and admin-only gates.
3. Otherwise a **parameterized** lookup against `role_permissions ⋈ permissions ⋈ roles` matches `r.name = ? AND p.module = ? AND p.action = ?` (`permissionMiddleware.js:80-89`). Match → `next()`; no match → `403 PERMISSION_DENIED`.

Variants:
- **`requireAuth`** — session-only, no permission check (`permissionMiddleware.js:210`).
- **`requireRole(...roles)`** — role-membership check; if `'admin'` is listed, `administrator` and `super_admin` are auto-added so callers don't have to enumerate aliases (`permissionMiddleware.js:265-272`).
- **`requireAnyPermission([{module,action},...])`** — passes if the role holds *any* listed permission, built as parameterized `(p.module=? AND p.action=?) OR ...` clauses (`permissionMiddleware.js:169-182`).
- **`getUserPermissions(req,res)`** — returns the caller's permission list (full admins get the entire `permissions` table; `is_admin:true`).

All role/permission mutations (`POST/PUT/DELETE /api/roles/*`) are gated by `requirePermission('roles','manage')` and write to the audit log via `audit.record()` (e.g. `role.create`, `role.update`, `role.delete`, `role.permissions.replace/grant/revoke`, `routes/roles.js:203,291,344,446,496,533`). The permission-replace path runs inside a transaction (`getConnection → beginTransaction → commit/rollback`, `routes/roles.js:429-463`).

### 3.5 Customer auth (phone OTP)

- `POST /api/customer/auth/send-otp` (`server.js:3341`, `otpLimiter`) and `POST /api/customer/auth/verify-otp` (`server.js:3400`); on success it calls `customerAuthService.createSession({ customerId, phone, ip, userAgent })` (`server.js:3445`) which mints the opaque token and stores its SHA-256 hash in `customer_sessions` with `expires_at = now + 30d`, plus `ip_address` and a 255-char-truncated `user_agent` (`services/customer-auth.js:19-34`).
- `requireCustomerAuth` (`middleware/customerAuth.js`) strips the `Bearer` prefix, calls `resolveSession(token)` — which checks `token_hash = ? AND revoked_at IS NULL AND expires_at > NOW()` (`services/customer-auth.js:36-45`) — and populates `req.customer = { id, phone }` plus `req.customerToken`.
- Sessions are **revocable**: `revoke(token)` and `revokeAllForPhone(phone)` set `revoked_at = NOW()` (`services/customer-auth.js:47-61`). `POST /api/customer/auth/logout` (`server.js:3462`) uses this. The `/api/customer/me/*` endpoints (requests, estimates, invoices, PDFs) are all behind `requireCustomerAuth`.

### 3.6 Painter & engineer auth (phone OTP + approval gating)

Both follow an identical shape. Key painter flow:

- **Register** `POST /painters/register` (public) → row in `painters` with `status='pending'`, generates a referral code, fire-and-forgets a Zoho customer+salesperson sync, and notifies admins (`routes/painters.js:193`).
- **Send OTP** `POST /painters/send-otp` (`otpLimiter`, `routes/painters.js:258`): 6-digit OTP via `crypto.randomInt(100000, 1000000)`, stored on a fresh `painter_sessions` row with `otp_expires_at = now+10min` and `expires_at = now+30d`. OTP delivered over **SMS (primary) + WhatsApp (secondary)**.
- **Verify OTP** `POST /painters/verify-otp` (`routes/painters.js:316`): matches `otp` within its 10-min window, nulls the OTP, and returns the (already-issued) session token + painter profile.

**Two-tier session middleware** distinguishes account state:
- `requirePainterAuth` — resolves session by hash **and requires `painters.status='approved'`**; otherwise `403 Account is {status}` (`routes/painters.js:147-165`). Used by all functional `/me/*` endpoints.
- `requirePainterSession` — resolves session **regardless of status** (`routes/painters.js:169-186`); used only by onboarding endpoints that must work while pending, e.g. `POST /me/request-approval`, `GET /me/status`.

The engineer system is structurally the same: `requireEngineerAuth` (approved-only) vs `requireEngineerSession` (any status) (`routes/engineers.js:31-73`), 10-min OTP, 30-day session, `X-Engineer-Token` header. Admin engineer management (`/`, `/:id`, `/:id/approve|reject|suspend|reinstate|credit`, custom/default rate tables, hidden-items) is gated by `requirePermission('engineers','view'|'manage')`. Notably, engineer **order submission re-resolves authoritative discounts server-side** so browser-supplied prices can't be tampered with (`routes/engineers.js:648-695`).

### 3.7 Two-factor authentication (TOTP)

- **Service:** `services/totp-service.js` wraps `speakeasy` + `qrcode`. Secrets are 20-byte base32 (`generateSecret`), issuer `"Quality Colours"`, label `"QCPaintShop (<username>)"`. Verification uses `speakeasy.totp.verify` with `window: 1` (±30 s clock drift tolerance) and strips whitespace from the submitted code (`totp-service.js:16-23`).
- **Routes:** `routes/auth-2fa.js` mounted under `/api/2fa`:
  - `GET /api/2fa/setup` (`requireAuth`) — **restricted to roles `admin`/`manager`** (`auth-2fa.js:18-20`); writes `totp_secret` and returns a QR data-URL + manual key.
  - `POST /api/2fa/verify-setup` (`requireAuth`) — confirms a working code, sets `totp_enabled=1`, `totp_verified_at=NOW()`.
  - `POST /api/2fa/validate` — login-time check by `user_id`; returns `{ bypass:true }` if 2FA isn't enabled.
  - `GET /api/2fa/status`, `POST /api/2fa/disable` (self, or any user if caller is `admin`).
- **Enforcement scope:** 2FA is **optional and only meaningful for `admin`/`manager`**. It is enforced *at login only* — the actual gate is in `POST /api/auth/login` (`server.js:491`): a token is withheld until `POST /api/auth/login-2fa` succeeds. There is no per-request 2FA re-check, and staff/customer/painter/engineer (non-admin/manager) roles have no 2FA path at all.

### 3.8 Enumeration-safe password reset

Two reset paths exist for staff, both deliberately non-enumerable:
- `POST /api/auth/forgot-password` (email): responds with the **same generic message before any DB/SMTP work** (`server.js:719-732`), then in `setImmediate` (so response timing can't leak existence) looks up the user, mints a one-time 1-hour token hash into `password_reset_tokens` (with `requested_ip`/`requested_ua`), and emails a reset link only if SMTP is configured.
- `POST /api/auth/forgot-password-mobile`: OTP-driven reset; enforces password policy (≥8 chars, ≥1 uppercase, ≥1 digit, `server.js:811`), re-verifies the OTP against `otp_verifications`, and returns a generic response (`server.js:805`). The corresponding `reset-password` path is `server.js:881`.

### 3.9 Security posture (what's in place)

- **Parameterized SQL everywhere.** Every auth/RBAC query uses `?` placeholders; dynamic `SET`/`WHERE` are built as arrays of `?` clauses + separate params arrays (e.g. role update `routes/roles.js:251-288`, engineer update `routes/engineers.js:268-277`, dynamic permission OR-list `permissionMiddleware.js:169-182`). The permission middleware header comment explicitly notes the SQL-injection fix.
- **Helmet + allowlist CSP** (`server.js:133-168`): `default-src 'self'`, `object-src 'none'`, `frame-ancestors 'self'`, `base-uri 'self'`, `upgrade-insecure-requests`, and an explicit allowlist of CDNs (`cdn.jsdelivr.net`, `cdnjs.cloudflare.com`, `unpkg.com`, `cdn.quilljs.com`, `cdn.socket.io`, googletagmanager, youtube). Allowlist-based, so any non-listed host is blocked by default.
- **Fail-safe CORS** (`server.js:173-199`): origins come from `CORS_ORIGIN` (comma-separated env whitelist); **never falls back to `*`** — in production with no env set it defaults to `https://act.qcpaintshop.com` and logs an error. Requests with no Origin are allowed (server-to-server). `compression()` is applied after.
- **Three-tier rate limiting** (`middleware/rateLimiter.js`): `globalLimiter` 100/min/IP, `authLimiter` 10/min/IP (on every `/api/auth/*` and OTP-issuing login path), `otpLimiter` 5/min keyed by **phone number** (falling back to IP). All return `429 RATE_LIMITED`. `validate.xForwardedForHeader:false` is set because `trust proxy` is already on.
- **Audit logging with redaction** (`services/audit-log.js`): `record(req, {action, entity_type, entity_id, before, after})` writes to **`audit_records`** (not the legacy `audit_log` table). It auto-derives `actor_type` (`customer` if `req.customer`, else `staff` if `req.user`, else `system`), captures `ip`/`user_agent`/`request_url`, and **redacts** keys in `SENSITIVE_KEYS` (`password`, `password_hash`, `token`, `session_token`, `access_token`, `refresh_token`, `otp`, `cf_otp`, `pan_number`, `aadhar_number`) recursively before JSON-serializing. Failures are swallowed so a broken sink never breaks a request. Currently wired into financial/role mutation paths (e.g. all of `routes/roles.js`).
- **Idempotency middleware** (`middleware/idempotency.js`, `idempotent(scope)`, 24 h TTL via `idempotency_records`) wired on financial POSTs including painter ones (`painter.withdraw.create`, `painter.estimate.create`, `painter.estimate.payment`, `routes/painters.js:768,1323,1648`).
- **PII gate** on `/uploads/aadhar` + `/uploads/documents` (`server.js:249-267`).
- **PII minimization in responses:** e.g. `GET /painters/me` deletes `aadhar_number` before returning (`routes/painters.js:423`).

### 3.10 Known security gaps (from COMPLETION_STATUS.md §, verified in code)

| Gap | Detail | Evidence |
|-----|--------|----------|
| **No auth-event audit logging** | `audit-log.js` exists but is **not wired into login/logout/permission-deny paths** — login success/failure and `403 PERMISSION_DENIED` are not recorded. | `COMPLETION_STATUS.md:60`; no `audit.record` call in `server.js:463-528` or `permissionMiddleware.js` |
| **Session IP/UA captured but not validated** | `ip_address`/`user_agent` are stored on every session row but **never compared** on subsequent requests — session resolution checks only `token_hash` + `expires_at` (+status). A stolen token works from any IP/device. | `COMPLETION_STATUS.md:61`; `permissionMiddleware.js:47-53`, `routes/painters.js:153` |
| **No magic-byte upload validation** | Uploads are validated by **extension/mimetype only**; a renamed `.exe`→`.pdf` passes. | `COMPLETION_STATUS.md:62,95`; `routes/wa-marketing.js:~66` |
| **Test-account OTP bypass** | Phone `9999999999` (and `+919999999999` for painters) accepts fixed OTP `123456` — but **only when `NODE_ENV !== 'production'`** (`allowTestBypass`). Production never honors it. | `routes/painters.js:268-271`, `routes/engineers.js:139-141` |
| **No CSRF tokens** | Accepted as low-risk because auth is **Bearer / custom-header token**, not cookie-based — cross-site requests cannot attach the credential. | `COMPLETION_STATUS.md:63` |
| **CSP allows `unsafe-inline` / `unsafe-eval`** | Required by remaining inline-script handlers; tightening is a documented follow-up pending migration of inline handlers. | `server.js:124-148` |
| **Legacy raw-token columns** | `user_sessions.session_token` / `painter_sessions.token` / `engineer_sessions.token` still hold plaintext tokens for rollback safety, widening DB-compromise blast radius. | `server.js:500`, `routes/painters.js:276` |

---

## 4. API Surface — Routes Catalog

All HTTP routing lives in `routes/` and is mounted under `/api/*` in `server.js:394-438`. Each route file exports `{ router, setPool }`; the single MySQL pool is injected via `setPool(pool)` (`server.js:273-376`). Of the 49 files in `routes/`, **45 are Express routers** mounted at the paths below. The remaining **4 are PDF/pricing library modules** (not mounted as routers): `routes/estimate-pdf-generator.js` (`generateEstimatePDF`), `routes/salary-pdf-generator.js` (`generateSalarySlipPDF`), `routes/painter-estimate-pdf-generator.js` (`generatePainterEstimatePDF`), and `routes/product-pricing-helpers.js` (`calculateGSTBreakdown`, `calculateFinalPrice`, `formatPricingDisplay`). They are `require()`d by the routers that render documents (e.g. `estimate-pdf.js`, `salary.js`).

**Auth gates** (see §4 of CLAUDE.md): `requireAuth` = staff Bearer token; `requirePermission(module, action)` = staff token + RBAC; `requireRole(...)` = role allowlist; `requirePainterAuth`/`requirePainterSession` = `X-Painter-Token`; `requireEngineerAuth`/`requireEngineerSession` = engineer token; `requireCustomerAuth` = customer Bearer; rate-limiters `authLimiter`/`otpLimiter`. `/api/estimates` is special: `estimate-pdf.js` mounts first **without** auth (public PDF), then `estimateRoutes.router` mounts **behind a router-level `requireAuth`** (`server.js:408-409`).

### 4.1 Identity & access

| File | Mount | Purpose | Auth gate | Representative endpoints |
|------|-------|---------|-----------|--------------------------|
| `roles.js` | `/api/roles` | RBAC: roles & permission matrix | `requirePermission('roles', view/manage)` | `GET /` list roles · `GET /permissions/by-module` · `POST /` create role · `PUT /:id/permissions` set role perms · `DELETE /:id/permissions/:permission_id` |
| `auth-2fa.js` | `/api/2fa` | TOTP two-factor for staff | `requireAuth` (+ public `/validate` at login) | `GET /setup` issue secret/QR · `POST /verify-setup` enable · `POST /validate` verify code at login · `GET /status` · `POST /disable` |
| `staff-registration.js` | `/api/staff-registration` | Self-registration → admin approval → offer letter, bank details | mixed: `authLimiter` (public), `requirePermission('staff_registrations', view/approve)` | `POST /check-availability` · `POST /register` (Aadhaar upload) · `POST /registrations/:id/approve` · `POST /registrations/:id/send-offer-letter` · `GET /registrations/:id/offer-letter` · `POST /bank-details/:userId` |
| `branches.js` | `/api/branches` | Branch CRUD, working hours, staff & manager | `requirePermission('branches', view/add/edit/delete)` (+ `GET /list` is `requireAuth`) | `GET /` · `POST /` · `PUT /:id` · `GET /:id/hours` + `PUT /:id/hours` · `GET /:id/staff` · `PATCH /:id/manager` |

### 4.2 Staff operations

| File | Mount | Purpose | Auth gate | Representative endpoints |
|------|-------|---------|-----------|--------------------------|
| `attendance.js` | `/api/attendance` | Clock in/out, breaks, geofence auto-clockout, location, overtime, leave, EOD, reports (~50 endpoints) | `requireAuth` (self) + `requirePermission('attendance', view/approve/manage)` (admin) | `POST /clock-in`, `POST /clock-out` (photo) · `GET /today` · `POST /break-start` / `/break-end` · `GET /geofence-check` + `POST /geo-auto-clockout` · `POST /location-report` · `POST /request-overtime` + `PUT /overtime-request/:id/approve` · `POST /report/send-all` |
| `salary.js` | `/api/salary` | Salary configs, monthly calc, payslips, payments, advances, incentives, slabs | `requireSalaryVisibility`/`requireAuth` (self) + `requireRole(admin/manager/accountant)` & `requirePermission('salary', view/manage/approve)` | `GET /my-monthly` · `POST /calculate-all` · `GET /monthly/:id/pdf` (calls `salary-pdf-generator`) · `POST /payments` (idempotent) · `POST /advances` + `PUT /advances/:id/approve` · `POST /incentive-slabs` · `PUT /incentives/bulk-approve` |
| `daily-tasks.js` | `/api/daily-tasks` | Per-staff daily task templates + responses, material/photo uploads, day submit | `requireAuth` (staff) + `requirePermission('tasks', view/add/edit/delete)` (templates) | `GET /today` · `POST /respond/:templateId` · `POST /upload-photo` · `POST /submit-day` · `GET /admin/responses` · `POST /templates` |
| `staff-daily-work.js` | `/api/staff/daily-work` | AI-generated personal daily work checklist + outstanding items | `requireAuth` | `GET /` · `GET /tasks` · `POST /tasks/:index/toggle` · `POST /tasks/generate` · `GET /outstanding` |
| `activity-tracker.js` | `/api/activity-tracker` | Live "what staff is doing now" timer + admin live board | `requireAuth` (self) + `requirePermission('attendance', view)` (admin) | `POST /start`, `POST /stop`, `POST /stop-with-photo` · `GET /current`, `GET /today` · `GET /admin/live` · `GET /admin/staff/:id/timeline` · `POST /admin/daily-report/send-all` |
| `activities.js` | `/api/activities` | Logged CRM/work activities + per-user reports | `requireAuth` + `requirePermission('activities', manage)` | `GET /my-activities` · `GET /stats` · `GET /report/daily` · `POST /` · `PUT /:id` · `DELETE /:id` |
| `activity-feed.js` | `/api/activity-feed` | Company activity feed + admin notice board | `requireAuth` / `requireAdmin` | `GET /` feed · `POST /notices` · `DELETE /notices/:id` |
| `tasks.js` | `/api/tasks` | Assigned task management (assign, status, progress, rating, bulk) | `requireAuth` (self) + `requirePermission('tasks', view/assign)` | `GET /` · `GET /my-tasks` · `GET /overdue` · `POST /` assign · `PATCH /:id/status` · `PATCH /:id/progress` · `PATCH /:id/rate` · `POST /bulk-assign` |

### 4.3 Sales & CRM

| File | Mount | Purpose | Auth gate | Representative endpoints |
|------|-------|---------|-----------|--------------------------|
| `leads.js` | `/api/leads` | Lead pipeline: my-leads, admin leads, scoring, follow-ups, bulk import, conversion | `requirePermission('leads', view/add/edit/delete/convert + own.*)` | `GET /` · `GET /scoring/dashboard` · `GET /my/list` + `POST /my/create` · `POST /my/:id/convert` · `POST /bulk/parse` + `POST /bulk/create` · `PATCH /:id/assign` · `POST /:id/followup` · `GET /:id/score` |
| `collections.js` | `/api/zoho/collections` | Outstanding-invoice collections, WhatsApp reminders, payment promises, pay links | `requirePermission('zoho', collections)` (most) + `requirePermission('collections', view)` (pay) | `GET /summary` · `GET /customers` · `GET /invoices` · `POST /remind` · `POST /promises` + `PUT /promises/:id` · `POST /pay-link` + `POST /pay-verify` · `PUT /customers/:customerId/branch` |
| `estimates.js` | `/api/estimates` | Staff estimate engine (pricing in `routes/estimates.js:46-131`), payments, POs, WhatsApp | router-level `requireAuth` + `requirePermission('estimates', view/add/edit/delete)` & `requirePermission('billing', payment)` | `GET /` · `GET /search-products` · `POST /` create (idempotent) · `PUT /:id` · `PATCH /:id/status` · `POST /:id/record-payment` (idempotent) · `POST /:id/create-po` · `GET /:id/upi-qr` · `POST /:id/send-whatsapp` |
| `estimate-requests.js` | `/api/estimate-requests` | Inbound estimate/quote requests intake + triage | `requireAuth` (+ public `POST /` intake) | `GET /` · `GET /stats/summary` · `POST /` (public) · `PATCH /:id/status` · `PATCH /:id/assign` · `POST /:id/notes` |
| `estimate-pdf.js` | `/api/estimates` (mounted before auth) | Public estimate PDF render | none (token-gated by id) | `GET /:id/pdf` render estimate PDF |
| `share.js` | `/api/share` | Public shareable estimate links + UPI QR + PDF | `requireAuth` (generate) + public token routes | `POST /generate` · `POST /whatsapp` · `GET /public/:token` · `GET /public/:token/upi-qr` · `GET /public/:token/pdf` |
| `credit-limits.js` | `/api/credit-limits` | Customer credit limits, checks, requests, customer creation | `requirePermission('credit_limits', view/manage/request)` | `GET /customers` · `GET /overview/summary` · `POST /check` · `POST /bulk-set` · `POST /requests` (idempotent) + `PUT /requests/:id/approve` · `POST /:customerId/set-limit` |
| `billing.js` | `/api/billing` | Full billing software: estimates → invoices → payments → Zoho push | `requirePermission('billing', estimate/invoice/payment)` & `requirePermission('vendors', ...)` for bills | `POST /estimates` + `POST /estimates/:id/convert` · `POST /invoices` · `PUT /invoices/:id` · `POST /invoices/:id/payment` · `POST /invoices/:id/push-zoho` · `GET /payments` |

### 4.4 Catalog & pricing

| File | Mount | Purpose | Auth gate | Representative endpoints |
|------|-------|---------|-----------|--------------------------|
| `item-master.js` | `/api/item-master` | Item master + DPL import/match/apply, naming rules, price history, health (DPL pricing per CLAUDE.md §6) | `requireAuth` (+ Zod `validate`/`validateQuery`) | `GET /items` · `POST /items/bulk-edit` · `POST /generate-names` · `POST /dpl-versions` (PDF upload) · `POST /dpl-parse` → `POST /dpl-match` → `POST /dpl-apply` · `GET /price-history` · `GET /health-check` |
| `price-list.js` | `/api/price-list` | Customer-facing price-list generator | `requirePermission('zoho', collections)` (`perm`) | `GET /brands` · `GET /items` · `POST /generate` |
| `stock-check.js` | `/api/stock-check` | Branch stock-count assignments, submit/save-progress, reconciliation, adjustments | `requirePermission('zoho', stock_check)` (admin) + `requireAuth` (staff self) | `POST /assign` · `GET /my-assignments` · `POST /save-progress/:id` + `POST /submit/:id` · `GET /review/:id` + `POST /adjust/:id` · `GET /reconciliation/today` · `GET /products/search` |
| `stock-migration.js` | `/api/zoho/migration` | Warehouse↔branch stock transfer & sync | `requirePermission('zoho', manage)` | `POST /sync-stock` · `GET /warehouse-stock` · `POST /transfer` + `POST /transfer-all` · `POST /disable-warehouses` · `DELETE /adjustment/:id` |

### 4.5 Painter program & engineer/dealer portal

| File | Mount | Purpose | Auth gate | Representative endpoints |
|------|-------|---------|-----------|--------------------------|
| `painters.js` | `/api/painters` | Largest router (~337KB): painter OTP auth, profile/cards, points & withdrawals, estimates, catalog, attendance, gamification, location, plus admin painter management & rate config | `requirePainterAuth`/`requirePainterSession` (`/me/*`); `requirePermission('painters', view/manage/points/estimates/marketing_*)` (admin); some public (`/register`, `/send-otp`, `/verify-otp`) | `POST /send-otp` + `POST /verify-otp` · `GET /me/dashboard` · `POST /me/estimates` (idempotent) · `POST /me/withdraw` (idempotent) · `GET /me/catalog` · `POST /me/attendance/checkin` (selfie) · `GET /` admin list · `PUT /:id/approve` · `POST /:id/points/adjust` · `PUT /config/product-rates/grouped` · `GET /locations/live` |
| `painter-marketing.js` | `/api/painter-marketing` | PNTR marketing pool: daily call lists, follow-ups, conversion, bulk import, dedupe queues | `requirePermission('painters', marketing_view/contact/convert/manage)` (+ `requireAuth` staff) | `GET /me/today` · `POST /leads/:id/followup` · `POST /leads/:id/convert` · `POST /admin/import/bulk` + `/incremental` · `GET /admin/queues/duplicates` · `POST /admin/generate-daily-lists` · `POST /admin/backfill/run` |
| `engineers.js` | `/api/engineers` | Engineer/dealer portal: OTP auth, catalog, quotes/orders, admin approval & custom rates | `requireEngineerAuth`/`requireEngineerSession` (`/me/*`); `requirePermission('engineers', view/manage)` (admin); public auth routes | `POST /send-otp` + `POST /verify-otp` · `GET /me/catalog` · `POST /me/quotes` · `POST /me/orders` · `GET /` admin list · `POST /:id/approve` · `POST /admin/default-rates` · `POST /:id/rates` |

### 4.6 Zoho integration

| File | Mount | Purpose | Auth gate | Representative endpoints |
|------|-------|---------|-----------|--------------------------|
| `zoho.js` | `/api/zoho` | Second-largest router (~303KB): OAuth, sync (invoices/customers/payments/items/stock), dashboards, item edits, DPL catalog reconciliation, bulk update jobs, WhatsApp queue, daily transactions | `requirePermission('zoho', view/manage/sync/invoices/reports/whatsapp/bulk_update)` (+ public `GET /oauth/callback`) | `GET /status` · `POST /sync/full` (+ `/invoices`, `/customers`, `/payments`, `/items`, `/stock`) · `GET /oauth/url` + `GET /oauth/callback` · `GET /items` + `PUT /items/zoho-item/:id` + `POST /items/zoho-item/:id/push` · `POST /items/dpl-catalog/:brand/build` → `/apply-prices` → `/push` · `POST /items/bulk-update` + `GET /items/bulk-jobs/:id` · `POST /whatsapp/send` |

> Note: `collections.js` (`/api/zoho/collections`), `whatsapp-sessions.js` (`/api/zoho/whatsapp-sessions`) and `stock-migration.js` (`/api/zoho/migration`) are mounted **under** `/api/zoho` but are documented in their own functional groups above/below.

### 4.7 WhatsApp

| File | Mount | Purpose | Auth gate | Representative endpoints |
|------|-------|---------|-----------|--------------------------|
| `whatsapp-chat.js` | `/api/whatsapp-chat` | Two-way WhatsApp inbox: conversations, send text/media, contacts | `requirePermission('zoho', whatsapp_chat)` (`perm`) | `POST /quick-send` · `GET /conversations` · `GET /conversations/:phone/messages` · `POST /conversations/:phone/send` + `/send-media` · `PUT /conversations/:phone/read` |
| `whatsapp-sessions.js` | `/api/zoho/whatsapp-sessions` | WhatsApp Web session lifecycle (admin global + per-branch QR/connect) | `requirePermission('zoho', whatsapp)` (`perm`) + per-branch `permStaff` | `GET /` · `GET /admin/status` + `POST /admin/connect` + `GET /admin/qr` · `POST /:branchId/connect` + `GET /:branchId/qr` + `GET /:branchId/status` |
| `wa-marketing.js` | `/api/wa-marketing` | WhatsApp bulk campaigns: build, populate, start/pause/resume, templates, instant send | `requirePermission('marketing', view/manage)` (`viewPerm`/`managePerm`) | `POST /campaigns` + `POST /campaigns/:id/populate` + `POST /campaigns/:id/start` · `GET /campaigns/:id/leads` · `POST /templates` · `POST /instant-send` · `GET /dashboard` |
| `wa-contacts.js` | `/api/wa-contacts` | WhatsApp contact groups & contact CRUD + import | `requirePermission('whatsapp', contacts/contacts_manage)` (`contactsPerm`/`managePerm`) | `GET /groups` + `POST /groups` · `POST /groups/:id/members` · `POST /import` · `GET /` + `POST /` + `PUT /:phone` + `DELETE /:phone` |

### 4.8 AI, monitoring & notifications

| File | Mount | Purpose | Auth gate | Representative endpoints |
|------|-------|---------|-----------|--------------------------|
| `ai.js` | `/api/ai` | AI dashboard: chat (Kai/Clawdbot), insights, analysis runs, lead scores, app analyzer, config | `requireAuth` | `GET /dashboard` · `POST /conversations` + `GET /conversations/:id/messages` · `POST /chat` · `GET /insights` + `PUT /insights/:id/read` · `POST /analysis/run` · `GET /lead-scores` · `GET /app-scan` + `POST /app-analyze` (SSE) + `POST /generate-prompt` |
| `anomalies.js` | `/api/anomalies` | Anomaly detection dashboard + scan + status workflow | `requireAuth` + `requirePermission('system', health)` | `GET /dashboard` · `GET /config` + `PUT /config` · `GET /` list · `PUT /:id/status` · `POST /scan` |
| `monitoring.js` | `/api/monitoring` | Production monitoring: overview, errors, perf, DB tables, usage | `requireAuth` (router-level) | `GET /overview` · `GET /errors` · `GET /performance` · `GET /database/tables` · `GET /usage` |
| `system.js` | `/api/system` | System health, error tracking, bug reports, AI fix suggestions, circuit breaker, audit log | `requirePermission('system', view/health)` (+ `requireAuth` for client error log) | `GET /audit-log` · `GET /health` + `POST /health-check` · `GET /errors` + `POST /errors/:id/resolve` · `POST /errors/log-client` · `GET /bugs` + `POST /bugs` · `POST /bugs/:id/fix-suggestions` · `GET /circuit-breaker` |
| `admin-dashboard.js` | `/api/admin/dashboard` | Real-time admin live dashboard snapshot | `requireAuth` | `GET /live` |
| `admin-notifications.js` | `/api/admin-notifications` | Composable broadcast notifications to painters (image, audience count) | `requirePermission('painters', manage)` | `POST /upload-image` · `GET /audience-count` · `GET /` + `POST /` · `GET /:id` |
| `notifications.js` | `/api/notifications` | Per-user in-app notifications + Web-Push (VAPID) subscriptions | `requireAuth` (+ public VAPID key) | `GET /` · `GET /count` · `POST /:id/read` + `POST /read-all` · `GET /push/vapid-key` · `POST /push/subscribe` + `DELETE /push/unsubscribe` |

### 4.9 Vendors & miscellaneous

| File | Mount | Purpose | Auth gate | Representative endpoints |
|------|-------|---------|-----------|--------------------------|
| `vendors.js` | `/api/vendors` | Vendor CRUD, purchase bills (AI OCR scan), purchase orders, vendor payments, Zoho push | `requirePermission('vendors', view/manage/purchase_orders)` (`viewPerm`/`managePerm`/`poPerm`) | `GET /` + `POST /` + `PUT /:id` · `POST /bills/scan` (OCR) + `POST /bills` + `POST /bills/:id/push-zoho` · `POST /purchase-orders` + `POST /purchase-orders/:id/send` · `POST /payments` |
| `agreements.js` | `/api/agreements` | Staff agreement documents: assign, view, acknowledge | `requireAuth` | `GET /my` · `POST /viewed` · `POST /upload` · `GET /admin/staff-list` · `POST /admin/assign-all` · `GET /admin/stats` |
| `guides.js` | `/api/guides` | Internal knowledge-base / how-to guides + categories + favorites | `requireAuth` (read) + `requirePermission('settings', manage/view)` (write) | `GET /categories` + `POST /categories` · `GET /` + `GET /:id` · `POST /` + `PUT /:id` + `DELETE /:id` · `POST /:id/favorite` · `GET /admin/analytics` |
| `photos.js` | `/api/photos` | Uploaded photo gallery browse + cleanup | `requireAuth` + `requirePermission('system', manage)` (cleanup) | `GET /categories` · `GET /list` · `DELETE /cleanup` |
| `website.js` | `/api/website` | Public marketing-site CMS: content, gallery, services, features, testimonials, settings | public `GET /content` & `/gallery`; `requirePermission('settings', manage)` (admin) | `GET /content` (public) · `GET /services` + `POST /services` · `POST /testimonials` · `PUT /settings` · `POST /upload` (image) |
| `chat.js` | `/api/chat` | Internal staff-to-staff direct messaging | `requireAuth` | `GET /conversations` + `POST /conversations` · `GET /conversations/:id/messages` + `POST /conversations/:id/messages` · `POST /conversations/:id/read` · `GET /users` |

### 4.10 Library modules (in `routes/`, not mounted)

| File | Export | Used by |
|------|--------|---------|
| `estimate-pdf-generator.js` | `generateEstimatePDF` (PDFKit coordinate layout) | `server.js:3579`, legacy estimate PDF path |
| `salary-pdf-generator.js` | `generateSalarySlipPDF` | `salary.js` `GET /monthly/:id/pdf` |
| `painter-estimate-pdf-generator.js` | `generatePainterEstimatePDF` (painter green/gold brand) | painter estimate PDF endpoints in `painters.js` |
| `product-pricing-helpers.js` | `calculateGSTBreakdown`, `calculateFinalPrice`, `formatPricingDisplay` | pricing/display in estimate & catalog routes |

---

## 5. Services Layer Catalog

The `services/` directory contains **63 modules** holding the application's business logic. They follow a consistent dependency-injection convention: a single MySQL pool (and where needed the Socket.IO `io` instance, automation registry, or session manager) is injected at boot via `setPool(p)` / `setIO(io)` / `setAutomationRegistry(r)` rather than each module creating its own pool. Cron-based schedulers gate their registration on `cluster-guard.isClusterPrimary()` so background work fires once even under PM2 cluster mode. The groups below are organized by concern.

### 5.1 Zoho integration (7 modules)

| Module | Responsibility | Key exports |
|---|---|---|
| `zoho-api.js` | Zoho Books REST API wrapper (India DC `zohoapis.in/books/v3`). Auto-auths via `zoho-oauth`, throttles via `zoho-rate-limiter`. Covers invoices, payments, contacts, items, reports, locations, bulk-update jobs, daily transactions, reorder alerts, inventory adjustments, transfer orders, bills/POs, expenses, credit notes. `updateItem` wraps `cf_*` keys into `custom_fields:[{api_name,value}]`. | `setPool`, `getInvoices/createInvoice`, `getContacts/createContact/updateContact`, `createSalesperson/listSalespersons`, `getItems/createItem/updateItem`, `getProfitAndLoss/getBalanceSheet`, `fullSync/quickSync/syncInvoices/syncCustomers/syncItems/syncLocations`, `checkReorderAlerts/bulkSetReorderLevels`, `createBill/createPurchaseOrder`, `createTransferOrder`, `getDashboardStats` (`services/zoho-api.js:2498`) |
| `zoho-oauth.js` | OAuth2 token lifecycle stored in `zoho_oauth_tokens` table — auth-code → token, refresh-token auto-refresh (~55 min). | `setPool`, `getAccessToken`, `refreshAccessToken`, `generateTokenFromCode`, `getAuthorizationUrl`, `getTokenStatus`, `revokeToken` (`services/zoho-oauth.js:326`) |
| `zoho-rate-limiter.js` | Token-bucket limiter (80 req/min safe of Zoho's 100/min) + daily usage tracker (10,000/org/day), persisted to DB so counts survive restarts. Exports a singleton instance. | `new ZohoRateLimiter()` singleton (`acquire`, `setPool`, usage stats) (`services/zoho-rate-limiter.js:525`) |
| `zoho-payments-service.js` | Zoho Payments (`payments.zoho.in/api/v1`) payment-link creation + status, with refresh-token handling. Env-driven (`ZOHO_PAYMENTS_*`). | `createPaymentLink`, `getPaymentLinkStatus` (`services/zoho-payments-service.js:115`) |
| `zoho-invoice-line-sync.js` | Reorder-intelligence feed: pulls Zoho invoice line items and aggregates into `branch_item_sales`. | `setPool`, `computeSyncWindow`, `aggregateLineItems`, `getLastSyncedDate`, `syncInvoiceLines` (`services/zoho-invoice-line-sync.js:192`) |
| `billing-zoho-service.js` | Shared contact resolution + invoice push from the staff billing module; awards painter points on push via injected engine. | `setPool`, `setPointsEngine`, `resolveZohoContact`, `pushInvoiceToZoho` (`services/billing-zoho-service.js:215`) |
| `painter-zoho-sync-service.js` | Syncs a painter into Zoho as a customer/salesperson with a retry queue (`painter_zoho_sync_queue`, escalating 1h/4h/12h/24h backoff). | `init`, `syncPainterToZoho`, `retryQueue`, `_computeNextRetry` (`services/painter-zoho-sync-service.js:187`) |

### 5.2 DPL / pricing / catalog (6 modules)

| Module | Responsibility | Key exports |
|---|---|---|
| `price-list-parser.js` | Brand dealer-price-list PDF/CSV parser (Asian, Berger XP/non-XP, Birla Opus, Gem/Astral, JSW, Nippon) → unified `{brand,product,packSize,dpl}`. Holds Birla Opus naming rules, SKU normalization, and `computeProposedFields`/`matchWithZohoItems`. Largest service (~2,048 lines). | `parsePriceList`, `matchWithZohoItems`, `detectBrand`, `parseSkuStructure/packSizeToCode/normalizePackSize`, `buildBirlaName`, `computeProposedFields`, per-brand `parseAsian/parseBirlaOpus/parseBerger/parseGem/parseJSW/parseNippon`, `parseBirlaOpusCsvAuto` (`services/price-list-parser.js:2048`) |
| `dpl-catalog.js` | The deterministic mediator between a brand's DPL and Zoho items (`dpl_catalog` table). Slug-containment + size-tier matching (900ml↔1L, 3.6L↔4L), SKU-stem linking, pinned links, price-apply, push-change building, and the "Zoho-first" reconciliation view. | `setPool`, `normalizeSizeTier`, `buildMatchKey`, `linkEntryToZoho`, `buildCatalogFromDpl`, `applyDplPrices`, `buildPushChanges`, `confirmLink`, `markPushed`, `setNotInZoho`, `buildZohoFirstView`, `proposeDplForZoho`, `computeZohoRate` (`services/dpl-catalog.js:749`) |
| `dpl-coverage.js` | Tiny pure helper computing which Zoho items no DPL row covers (mirrored inline in `admin-dpl.html`). | `computeZohoUncovered` (`services/dpl-coverage.js:29`) |
| `brand-dpl-service.js` | CRUD wrapper over `brand_dpl_lists` (one row per brand, INSERT…ON DUPLICATE KEY UPDATE). | `setPool`, `save`, `get`, `getForMatch` (`services/brand-dpl-service.js:105`) |
| `color-extractor.js` | Maps color names in item text to hex codes via a 30+ entry `COLOR_MAP`; powers product color swatches. | `extractColor`, `COLOR_MAP` (`services/color-extractor.js:52`) |
| `price-list-pdf-generator.js` | PDFKit-based branded customer price-list PDF. Applies the final-price formula and groups rows; brand green `#1B5E3B`. | `computeFinalPrice`, `groupRowsForPdf`, `generatePriceListPdf`, `normalizePackSize` (`services/price-list-pdf-generator.js:199`) |

### 5.3 Painter program (8 modules)

| Module | Responsibility | Key exports |
|---|---|---|
| `painter-points-engine.js` | Core loyalty engine: regular/annual point pools, referral tiers, level multipliers, invoice processing, monthly/quarterly slab evaluation, withdrawals, attendance points, clawback queue. | `setPool`, `getReferralTier`, `getBalance`, `addPoints/deductPoints`, `processInvoice`, `evaluateMonthlySlabs/evaluateQuarterlySlabs`, `requestWithdrawal/processWithdrawal`, `awardAttendancePoints`, `getLevelMultiplier/addPointsWithMultiplier/checkLevelUp`, `queueClawback` (`services/painter-points-engine.js:618`) |
| `painter-points-backfill-service.js` | Backfills loyalty points from historical Zoho invoices (`direct_billing` + `salesperson` attribution), idempotent via `painter_invoices_processed`. | `backfillPainter`, `previewBackfill`, `runBulkBackfill`, `runDailyIncremental`, `_loadRates` (`services/painter-points-backfill-service.js:183`) |
| `painter-notification-service.js` | Painter FCM push + in-app notifications (`painter_notifications`, `painter_fcm_tokens`) + Socket.IO `painter_{id}` rooms; bilingual (Tamil/English). | `setDependencies`, `sendToPainter`, `sendToAll`, `getNotifications`, `markRead`, `getRetentionNotification` (`services/painter-notification-service.js:295`) |
| `painter-attendance-service.js` | Selfie+GPS daily check-in, AP earning, monthly claim based on billing tiers; haversine geofence to nearest branch. | `recordCheckin`, `recomputeMonthly`, `claimMonth`, `rejectCheckin`, `openMonthlyClaim`, `recomputeClaimable`, `remindUnclaimed`, `forfeitAndPurge`, `findNearbyBranches`, `haversineMeters`, `computeClaimPct`, `computeClaimableAp`, `loadConfig`, `setPool` (`services/painter-attendance-service.js:367`) |
| `painter-card-generator.js` | Sharp-based image generator (v9): visiting card (1400×800, painter-facing) + official ID card (800×1200, QC-branded, QR + referral). | `generateCard`, `generateIdCard` (`services/painter-card-generator.js:540`) |
| `painter-marketing-scheduler.js` | PNTR marketing engine: outcome→recycle-day disposition logic, daily call-list generation, lead assignment, cron registration. | `applyOutcome`, `getConfig`, `generateDailyLists`, `assignNewLead`, `registerCron`, `DEFAULT_CFG` (`services/painter-marketing-scheduler.js:234`) |
| `painter-scheduler.js` | Cron orchestrator for the painter system: monthly/quarterly slabs, daily credit-overdue, midnight streak reset (00:00), bonus rotation (00:05), bonus push (7 AM), streak-at-risk reminder (8 PM), attendance claim jobs. Wires the other painter services. | `setPool`, `setAutomationRegistry`, `start/stop`, `runMonthlySlabEvaluation`, `runQuarterlySlabEvaluation`, `runCreditOverdueCheck`, `runStreakReset`, `runDailyBonusRotation/Push`, `runStreakReminder`, `runOpenAttendanceClaim`, `runRecomputeClaimable`, `runRemindUnclaimed`, `runForfeitAndPurge` (`services/painter-scheduler.js:355`) |
| `pntr-import-service.js` | Zoho PNTR-prefixed customer import → painter leads: phone normalization, branch-prefix/salesperson detection (Levenshtein), upsert, bulk + incremental import. | `normalizePhone`, `parseBranchPrefix`, `parseSalespersonPhoneSuffix`, `levenshtein`, `matchSalesperson`, `detectBranch`, `upsertPainterLead`, `processCustomer`, `syncSalespersons`, `runBulkImport`, `runIncrementalImport` (`services/pntr-import-service.js:235`) |

### 5.4 AI (9 modules)

| Module | Responsibility | Key exports |
|---|---|---|
| `ai-engine.js` | Multi-LLM abstraction (Gemini `gemini-2.0-flash`, Claude `claude-sonnet-4-20250514`, Clawdbot/Kai via CLI). Keys from `ai_config` with `.env` fallback. Generate/stream/failover + system-prompt builders + token tracking. | `setPool`, `generate`, `streamToResponse`, `generateWithFailover`, `streamWithFailover`, `getSystemPrompt`, `getChatSystemPrompt`, `getConfig`, `clearConfigCache` (`services/ai-engine.js:651`) |
| `ai-context-builder.js` | Two-tier chat context (Tier 1 quick summary always injected, Tier 2 keyword-triggered deep context) + daily snapshot generation/caching. | `setPool`, `buildChatContext`, `generateDailySnapshot`, `getLatestSnapshot`, `formatINR` (`services/ai-context-builder.js:799`) |
| `ai-analyzer.js` | Collects revenue/collections/overdue/stock from DB, runs Zoho business analysis, stores insights, builds WhatsApp summary. | `setPool`, `collectZohoData`, `runZohoAnalysis`, `buildWhatsAppSummary` (`services/ai-analyzer.js:311`) |
| `ai-staff-analyzer.js` | Collects attendance/breaks/overtime/task data; AI-driven staff performance insights. | `setPool`, `collectStaffData`, `runStaffAnalysis`, `buildWhatsAppSummary` (`services/ai-staff-analyzer.js:306`) |
| `ai-lead-manager.js` | Deterministic 0–100 lead scoring + AI enhancement, auto-assign, stale alerts, conversion prediction, follow-up + nurture suggestions. | `setPool`, `computeScore`, `collectLeadData`, `scoreAllLeads`, `getStalLeads`, `syncScoresToLeads`, `predictConversion`, `generateFollowUpSuggestions`, `triggerNurtureCampaign` (`services/ai-lead-manager.js:511`) |
| `ai-marketing.js` | Aggregates sales by product/brand/segment; generates weekly marketing tips. | `setPool`, `collectMarketingData`, `runMarketingAnalysis` (`services/ai-marketing.js:294`) |
| `ai-scheduler.js` | Cron orchestrator for all AI jobs (Zoho daily/weekly, staff daily, lead scoring, marketing weekly, daily snapshot, staff daily tasks); schedules configurable via `ai_config`. Wires every AI service. | `setPool`, `setSessionManager`, `setIO`, `setAutomationRegistry`, `start/stop`, `runZohoDaily/Weekly`, `runStaffDaily`, `runLeadScoring`, `runMarketingWeekly`, `runDailySnapshot`, `runStaffDailyTasks` (`services/ai-scheduler.js:282`) |
| `ai-prompt-utils.js` | Sanitizes admin/user strings before embedding into LLM prompts (strips C0 controls, code fences, U+2028/2029; length cap). | `sanitizeForPrompt` (`services/ai-prompt-utils.js:25`) |
| `app-metadata-collector.js` | Scans DB schema, route map, recent errors, health, business stats for the AI App Analyzer (5-min cache). | `setPool`, `runFullScan`, `collectDatabaseSchema`, `collectRouteMap`, `collectRecentErrors`, `collectHealthMetrics`, `collectBusinessStats` (`services/app-metadata-collector.js:310`) |

### 5.5 WhatsApp (3 modules)

| Module | Responsibility | Key exports |
|---|---|---|
| `whatsapp-session-manager.js` | Per-branch WhatsApp sessions via `whatsapp-web.js` (optional dep); QR connect, message/media send, status. Emits over Socket.IO. | `GENERAL_ID`, `ADMIN_SESSION_ID`, `setPool`, `setIO`, `connectBranch/disconnectBranch`, `sendMessage/sendMedia`, `getStatus/getQRForBranch/getBranchStatus/isConnected`, `initializeSessions`, `getClient` (`services/whatsapp-session-manager.js:731`) |
| `whatsapp-processor.js` | Processes the `whatsapp_followups` queue every 5 min (cron): dual-mode send (per-branch session or HTTP API fallback), 3-attempt retry, scheduled + template messages. | `setPool`, `setSessionManager`, `setAutomationRegistry`, `start/stop`, `getStatus`, `processQueue`, `queueOverdueReminders` (`services/whatsapp-processor.js:481`) |
| `wa-campaign-engine.js` | Background singleton executing WhatsApp marketing campaigns via setTimeout chain. Anti-block: spin text, variable substitution, zero-width markers, hourly/daily caps (`wa_sending_stats`), 5-day warm-up, auto-pause on failures; emits to `wa_marketing_admin` room. | `setPool`, `setIO`, `setSessionManager`, `start/stop`, `isRunning`, `getEngineStatus`, `loadSettings`, `resolveSpinText`, `substituteVariables`, `appendInvisibleMarker`, `resolveMessage` (`services/wa-campaign-engine.js:508`) |

### 5.6 Notifications & comms (4 modules)

| Module | Responsibility | Key exports |
|---|---|---|
| `notification-service.js` | Multi-channel staff/admin dispatch: in-app, Socket.IO real-time, Web Push, FCM (via `fcm-admin`). | `setPool`, `setIO`, `send`, `sendToMany` (`services/notification-service.js:139`) |
| `fcm-admin.js` | Firebase Admin SDK wrapper using FCM HTTP v1 (replaces legacy API shut off June 2025); surfaces `invalidToken` for stale-token cleanup. | `sendToDevice`, `sendToDevices`, `isInitialized` (`services/fcm-admin.js:173`) |
| `email-service.js` | Shared branded email via nodemailer; no-ops gracefully when `SMTP_HOST`/auth unset (supports local loopback sendmail). | `send` (`services/email-service.js:75`) |
| `sms-service.js` | Single client for Nettyfish RetailSMS gateway; always POSTs so creds never land in logs; no-ops if `SMS_USER`/`SMS_PASSWORD` unset. | `sendSms` (`services/sms-service.js:78`) |

### 5.7 Reorder & inventory (6 modules)

| Module | Responsibility | Key exports |
|---|---|---|
| `reorder-compute-service.js` | Pure formulas + DB compute for reorder intelligence: reorder level = `ceil(avgDaily*(lead+safety))`, quantity, severity; writes `zoho_reorder_alerts`. | `setPool`, `computeReorderLevel`, `computeReorderQuantity`, `computeSeverity`, `computeAll`, `refreshAlerts` (`services/reorder-compute-service.js:166`) |
| `reorder-report-service.js` | Assembles daily reorder reports (per-branch or consolidated) from alerts/items/locations/config; delivery via WhatsApp/FCM/PDF; scope-based recipients. | `setPool`, `sortReportRows`, `buildOtherBranchesMap`, `assembleReport`, `deliverReport`, `runDailyReport`, `getRecipientsForScope`, `sendReportNow`, `periodLabel`, `applyFilters` (`services/reorder-report-service.js:260` + `:442–580`) |
| `reorder-report-pdf-generator.js` | PDFKit reorder report PDF with severity color coding (brand green / danger / warning). | `generateReorderPdf` (`services/reorder-report-pdf-generator.js:138`) |
| `purchase-suggestion.js` | Three-tier PO & reorder-point suggestion system (global level → branch threshold → suggested qty, with low-volume category fallback), matching Kai Bot formulas; batch lifecycle + config CRUD. | `setPool`, `getConfig`, `calculateGlobalReorderLevels`, `calculateBranchAllocations`, `generatePurchaseSuggestions`, `runFullCalculation`, `getSuggestionsByBatch`, `getSuggestionSummary`, `dismissSuggestion/markOrdered`, `bulkDismiss/bulkMarkOrdered`, `updateBranchAllocations`, `updateCategoryDefault/createCategoryDefault/deleteCategoryDefault` (`services/purchase-suggestion.js:583`) |
| `vendor-item-mapper.js` | Builds `item_vendor_map` from Zoho bills, infers primary vendor per item, mirrors `preferred_vendor_id` onto `zoho_items_map`, pushes vendor to Zoho item master. | `setPool`, `scanFromZohoBills`, `inferPrimaries`, `pushPreferredVendorToZoho`, `pushAll`, `setManualPrimary`, `applyBrandVendor` (`services/vendor-item-mapper.js:379`) |
| `vendor-bill-ai-service.js` | OCRs vendor bill images via KAI (Clawdbot), extracts items, matches to Zoho products, verifies staff entries. | `setPool`, `scanBillImage`, `matchProductsToZoho`, `verifyBillItems` (`services/vendor-bill-ai-service.js:251`) |

### 5.8 Schedulers & background (9 modules)

| Module | Responsibility | Key exports |
|---|---|---|
| `sync-scheduler.js` | Zoho ⇆ MySQL auto-sync orchestrator (configurable interval from `zoho_config`, daily full sync, retry); also triggers invoice-line sync + reorder compute/report. | `setPool`, `setAutomationRegistry`, `start/stop/restart`, `getStatus`, `executeSyncCycle`, `loadConfig` (`services/sync-scheduler.js:668`) |
| `auto-clockout.js` | Overtime prompt + auto-clock-out (5-min checks; 10 PM IST force clock-out all); geofence warnings; stale-attendance cleanup. | `setPool`, `setIO`, `setAutomationRegistry`, `setActivityTrackerService`, `start`, `checkOvertimePrompts`, `checkGeoWarnings`, `forceClockoutAll`, `endActivePeriods`, `cleanupStaleAttendance` (`services/auto-clockout.js:654`) |
| `lead-auto-assign-scheduler.js` | Round-robin assigns unassigned leads to branch staff daily (8 AM IST), notifies assignees. | `setPool`, `setAutomationRegistry`, `setIO`, `start/stop`, `runAutoAssign` (`services/lead-auto-assign-scheduler.js:194`) |
| `lead-reminder-scheduler.js` | Daily 8 AM IST notifications for due/overdue lead follow-ups. | `init` (`services/lead-reminder-scheduler.js:87`) |
| `staff-task-generator.js` | Uses Clawdbot to generate personalized daily Tamil tasks per staff (analyzes pending leads, overdue follow-ups, branch outstanding, conversion targets). | `setPool`, `generateForStaff`, `generateForAllStaff`, `getTodayTasks`, `markTaskComplete` (`services/staff-task-generator.js:333`) |
| `data-retention-service.js` | Daily 03:30 IST purge of stale rows (audit_records 90d, resolved error_logs 90d, activity feed 30d, read notifications 60d, otp 7d); per-table failures non-fatal. | `setPool`, `setAutomationRegistry`, `start/stop`, `runRetentionPurge` (`services/data-retention-service.js:96`) |
| `cluster-guard.js` | Returns whether the current process is the cluster primary (`NODE_APP_INSTANCE` 0/undefined) so schedulers register once under PM2. | `isClusterPrimary` (`services/cluster-guard.js:22`) |
| `production-monitor.js` | Continuous health monitoring + self-healing: memory/event-loop checks, circuit breaker for external APIs, metrics history, periodic snapshots; can alert via WhatsApp/notifications. | `setPool`, `setIO`, `setSessionManager`, `setNotificationService`, `setResponseTracker`, `start/stop`, `getStatus`, `getMetricsHistory`, `getCircuitState`, `canCallApi`, `recordApiFailure/recordApiSuccess`, `checkMemory`, `checkEventLoop`, `DEFAULTS` (`services/production-monitor.js:482`) |
| `automation-registry.js` | In-memory (no DB) registry of all cron/scheduled jobs for the live admin dashboard — status, last-run/completed timestamps. | `register`, `markRunning`, `markCompleted`, `markFailed`, `getAll`, `getStatus`, `getSummary` (`services/automation-registry.js:114`) |

### 5.9 Monitoring & health (8 modules)

| Module | Responsibility | Key exports |
|---|---|---|
| `system-health-service.js` | Comprehensive health checks: database, memory, disk, filesystem, external services, DB integrity; optional auto-check interval. | `setPool`, `performHealthCheck`, `checkDatabase`, `checkMemory`, `checkDiskSpace`, `checkFileSystem`, `checkExternalServices`, `checkDatabaseIntegrity`, `startAutoHealthChecks`, `stopAutoHealthChecks` (`services/system-health-service.js:399`) |
| `anomaly-detector.js` | Z-score statistical anomaly detection across revenue, attendance, stock, collections, API usage; alert callback for critical/high. | `setPool`, `setAlertCallback`, `runFullScan`, `getDashboardStats`, `getConfig`, `calculateZScore`, `calculateStats`, `getSeverityFromZScore` (`services/anomaly-detector.js:568`) |
| `error-prevention-service.js` | Error-pattern analysis, data-integrity validation, code-quality checks, prevention reports. | `setPool`, `analyzeErrorPatterns`, `validateDataIntegrity`, `performCodeQualityCheck`, `generatePreventionReport` (`services/error-prevention-service.js:385`) |
| `error-analysis-service.js` | Stack-trace parsing, error hashing/deduplication, trend & per-module analysis, AI fix suggestions, auto-create bug from error. | `setPool`, `setAiEngine`, `parseStackTrace`, `computeErrorHash`, `deduplicateError`, `analyzeErrorTrends`, `analyzeByModule`, `generateFixSuggestion`, `generateBugFix`, `getErrorSummary`, `autoCreateBugFromError` (`services/error-analysis-service.js:568`) |
| `activity-tracker-service.js` | Staff "what are you working on" tracking: session start/stop, idle + max-duration detection, daily timelines, live monitoring. | `ACTIVITY_CONFIG`, `setPool`, `setIO`, `setNotificationService`, `startActivity/stopActivity`, `endActiveSession`, `getCurrentSession`, `getTodayTimeline`, `getLiveSessions`, `getStaffTimeline`, `getDaySummary`, `checkIdleStaff`, `checkMaxDuration` (`services/activity-tracker-service.js:505`) |
| `activity-feed.js` | Logs staff activities and serves the notice-board feed (icon/color configs, Socket.IO broadcast). | `setPool`, `setIO`, `logActivity`, `getFeed`, `getNotices`, `createNotice`, `cleanupOldFeed` (`services/activity-feed.js:178`) |
| `attendance-report.js` | Daily 10:05 PM IST attendance summaries via WhatsApp + in-app + admin PDF; also activity reports and lead alerts. | `setPool`, `setIO`, `setSessionManager`, `setAutomationRegistry`, `start`, `generateReport`, `sendReport/sendAllReports/sendAdminReport`, `generateAdminPDF`, `sendLeadAlerts`, `generateActivityReportData/PDF`, `sendActivityAdminReport`, `sendStaffActivityReport/sendAllStaffActivityReports` (`services/attendance-report.js:1196`) |
| _(production-monitor & anomaly are cross-listed here but cataloged in §5.8 / above)_ | — | — |

### 5.10 Cross-cutting (4 modules)

| Module | Responsibility | Key exports |
|---|---|---|
| `audit-log.js` | Writes redacted before/after audit entries to `audit_records`; failures are swallowed so a broken sink never breaks the request. | `setPool`, `record`, `query` (`services/audit-log.js:100`) |
| `customer-auth.js` | Server-persisted, expirable, revocable customer sessions (SHA-256 hashed token, 30-day TTL) backing `requireCustomerAuth` and `/api/customer/me/*`. | `setPool`, `createSession`, `resolveSession`, `revoke`, `revokeAllForPhone` (`services/customer-auth.js:63`) |
| `totp-service.js` | TOTP 2FA via `speakeasy` (base32 secret, QR data-URL, ±1 window verify) for admin/staff. | `generateSecret`, `generateQRCode`, `verifyToken` (`services/totp-service.js:25`) |
| `branding.js` | Reads business-branding fields (`business_name/logo/phone/email/address/gst`) from the `settings` table; returns `{}` on error. | `getBranding` (`services/branding.js:18`) |

**Coverage note:** all 63 files in `services/` are cataloged above. `production-monitor.js` and `anomaly-detector.js` straddle the schedulers/background and monitoring concerns; each is described once (production-monitor in §5.8, anomaly-detector in §5.9) and cross-referenced to avoid duplication.

---

## 6. Database Schema (derived from migrations)

There is **no `schema.sql`**. The live schema (`qc_business_manager`, MySQL/MariaDB 10.11, InnoDB, `utf8mb4_unicode_ci`) is the cumulative result of three layers:

1. **Legacy bootstrap scripts** (now in `archive/`) that created the original ~17 "working" tables — `users`, `user_sessions`, `branches`, `settings`, `roles`, `permissions`, `role_permissions`, `customers`, `brands`, `categories`, `products`, `pack_sizes`, `leads`, `lead_followups`, the `staff_attendance`/`shop_hours_config`/`attendance_photos`/`attendance_permissions` set, `estimates`/`estimate_items`/`estimate_settings`/`estimate_status_history`, the salary set, and `audit_log`. Evidence: `archive/migrations/setup-database.js`, `archive/old-schemas/database-complete-schema.sql`, `archive/migrations/fix-attendance-tables.js`. The stale `docs/DATABASE-README.md` (Feb 10 2026, "17 tables") documents only this layer and must **not** be trusted as current.
2. **118 incremental migration files** in `migrations/`, applied by `migrate.js`, which add every feature table since.
3. **Externally-bootstrapped Zoho tables** — `zoho_items_map`, `zoho_customers_map`, `zoho_invoices`, `zoho_payments`, `zoho_salespersons` (and similar). These are read/written all over the codebase (`routes/zoho.js`, `services/zoho-api.js`, `services/painter-points-engine.js`, `routes/billing.js`, indexed by `migrate-composite-indexes.js`) but are **never created by any `CREATE TABLE` in the repo** — they are provisioned by the Zoho sync layer outside the migration runner. Treat them as existing on prod but absent from a clean `node migrate.js` install. (`zoho_expenses`/`zoho_credit_notes` are the exception — created by `migrations/20260515_add_zoho_expenses_creditnotes.js`.)

### 6.1 Migration model (`migrate.js`)

| Command | Behavior |
|---|---|
| `node migrate.js` | Runs every file in `migrations/` (sorted) not already in `_migrations`. Records each success via `INSERT INTO _migrations (name)`. Stops on first failure (no out-of-order application). |
| `node migrate.js --status` | Lists each file as `applied`/`PENDING` plus an `Applied At` timestamp. |
| `node migrate.js --mark-existing` | `INSERT`s every pending filename into `_migrations` **without running it** — used to register self-contained scripts already applied by hand. |

Tracking table (`migrate.js:42`): `_migrations(id PK AUTO_INCREMENT, name VARCHAR(255) UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`.

**Two migration file conventions** (`migrate.js:140-174`):
- **Pattern 1 (runner-managed):** export `async function up(pool)` (or `module.exports = async (pool) => …`). The runner injects the shared pool and records success. Examples: `migrate-dpl-catalog.js`, `migrate-composite-indexes.js`, `migrate-soft-delete-financial-items.js`.
- **Pattern 2 (self-contained):** the file creates its own pool, runs side effects, and calls `process.exit()`. The runner **refuses** to `require()` these (it would kill the process) — it detects `process.exit(` with no `up` export and aborts (`migrate.js:146-155`). These must be run manually then registered with `--mark-existing`. Examples: `fix-collation-standardize.js`, `migrate-session-token-hash.js`, `fix-missing-indexes.js`.

**Production gotcha (load-bearing):** prod's `_migrations` table only began tracking from **Apr 30 2026**, so the ~80 older self-contained migrations are not recorded. `--status` therefore **over-reports ~80 as PENDING** on prod even though they are applied. Workaround for any new migration on prod: run it directly, then `INSERT IGNORE` a marker row into `_migrations` (do **not** blindly re-run "pending" pre-Apr-30 files).

### 6.2 Load-bearing schema conventions

- **Session timezone forced to UTC.** The pool sets session TZ `+00:00` (`config/database.js`), while the server clock is IST. All `TIMESTAMP`/`DATETIME` values are stored and read as **UTC** — every date comparison and cron boundary depends on this offset.
- **Collation standardization** — `fix-collation-standardize.js` converted ~52 `utf8mb4_general_ci` tables to `utf8mb4_unicode_ci` (79 were already correct → ~131 tables existed at that point) and set the DB default, fixing "Illegal mix of collations" on UNION/JOIN.
- **Soft-delete on financial sub-rows** — `migrate-soft-delete-financial-items.js` adds `deleted_at TIMESTAMP NULL` + index to exactly four item tables: `billing_estimate_items`, `billing_invoice_items`, `painter_estimate_items`, `estimate_items`. Write paths now `UPDATE … SET deleted_at = NOW()`; read paths filter `WHERE deleted_at IS NULL`.
- **Composite indexes** — `migrate-composite-indexes.js` adds 12 multi-column indexes on hot paths (e.g. `staff_attendance(user_id,date)`, `painter_estimates(painter_id,status,created_at DESC)`, `leads(branch_id,status,next_followup_date)`, `zoho_invoices(local_branch_id,invoice_date)`, `ai_messages(conversation_id,created_at DESC)`), all `ALGORITHM=INPLACE LOCK=NONE` with idempotent skip-if-exists guards.
- **Token hashing** — `migrate-session-token-hash.js` adds `token_hash CHAR(64)` (= `LOWER(SHA2(token,256))`) + index to `user_sessions` and `painter_sessions`, backfilling live sessions; the raw token columns are left in place for rollback.
- Migrations universally guard with `SHOW TABLES LIKE` / `INFORMATION_SCHEMA` checks so they are safe to re-run, and prefer `ALGORITHM=INPLACE LOCK=NONE` for additive ALTERs.

### 6.3 Table catalog (grouped by domain)

All tables below are created by `migrations/*.js` unless marked **[legacy]** (archive bootstrap) or **[external]** (Zoho sync, not in repo).

#### Identity, sessions & access control
| Table | Purpose / key columns & quirks |
|---|---|
| `users` **[legacy]** | Staff/admin accounts; bcrypt password, `role`, `branch_id`. `migrate-otp-password-reset-enum.js` extends an enum; `20260518_add_totp_to_users.js` adds TOTP secret/enabled columns. |
| `user_sessions` **[legacy]** | Bearer-token staff sessions. `token_hash CHAR(64)` (SHA-256) added by `migrate-session-token-hash.js`; lookups compare the hash. |
| `customer_sessions` | Customer OTP/Bearer sessions; SHA-256 hashed token, 30-day expiry (`migrate-customer-sessions.js`). |
| `painter_sessions` | Painter `X-Painter-Token` sessions, 30-day, multi-device; `token_hash` added by session-hash migration (`migrate-painters.js`). |
| `engineer_sessions` | Engineer auth sessions (`migrate-engineers.js`). |
| `roles`, `permissions`, `role_permissions` **[legacy]** | RBAC backing `requirePermission(module,action)`. `admin`/`administrator`/`super_admin` bypass checks in code. Permission-seed migrations: `migrate-credit-limits-permissions.js`, `migrate-pntr-marketing-permissions.js`, `migrate-staff-leads-permissions.js`. |
| `password_reset_tokens` | Token-based forgot-password (`migrate-password-reset-tokens.js`). |
| `otp_verifications` **[legacy]** | OTP store for phone verification. |

#### Staff operations (attendance, salary, activity, tasks)
| Table | Purpose |
|---|---|
| `staff_attendance` **[legacy]** | Daily clock-in/out; `DAYOFWEEK(date)-1` logic requires `shop_hours_config.day_of_week` be TINYINT (not ENUM). |
| `shop_hours_config`, `attendance_photos`, `attendance_permissions` **[legacy]** | Working hours/day, selfie verification, late/early-leave requests. |
| `outside_work_periods` | Outside-shop work tracking (`migrate-attendance-improvements.js`). |
| `overtime_requests` | OT request/approval (`migrate-ot-approval.js`, `migrate-overtime.js`). |
| `prayer_periods`, `attendance_daily_reports` | Prayer-break windows + daily attendance report rollups (`migrate-prayer-and-reports.js`). |
| `staff_salary_config`, `monthly_salaries`, `salary_payments`, `salary_adjustments`, `staff_leave_balance` **[legacy]** | Salary engine (hourly basis, Sunday OT, leave deductions). `migrate-salary-leave-deduction.js`, `migrate-salary-visibility.js` extend. |
| `staff_activities` **[legacy]**, `staff_activity_sessions`, `staff_idle_alerts` | Activity tracker + idle-time alerts (`migrate-activity-tracker.js`). |
| `staff_tasks`, `task_updates` **[legacy]** | Task management. |
| `staff_daily_ai_tasks` | AI-generated daily Tamil tasks (`migrate-staff-daily-work.js`). |
| `staff_activity_feed`, `admin_notices` | Notice board / activity feed (`migrate-notice-board.js`). |
| `staff_incentives`, `incentive_slabs` | Amount-tier incentives (`migrate-staff-incentives.js`, `migrate-incentive-slabs.js`). |
| `guide_categories`, `guides`, `guide_versions`, `guide_views`, `guide_favorites` | Staff knowledge-base guides (`migrate-guides-system.js`). |

#### Leads & collections
| Table | Purpose |
|---|---|
| `leads`, `lead_followups` **[legacy]** | CRM leads + follow-ups. `migrate-lead-type.js`, `migrate-lead-auto-assign.js`, `migrate-staff-assign-enum.js` extend. |
| `lead_conversion_predictions` | AI lead-scoring output (`migrate-lead-scoring-upgrade.js`). |
| `collection_reminders`, `payment_promises` | Collections call/promise tracking (`migrate-collections.js`). |
| `promise_reminders` is handled via `migrate-promise-reminders.js`. |

#### Estimates & billing (financial)
| Table | Purpose / quirks |
|---|---|
| `estimates`, `estimate_items` **[legacy]** | Core quotations + line items. **`estimate_items` is one of the 4 soft-delete tables** (`deleted_at`). Pricing engine quirks: double ₹10 rounding, `gst_amount=0` (GST is inclusive — intentional). `migrate-estimate-columns.js`, `migrate-estimate-enhancements.js`, `migrate-estimate-discount.js`, `migrate-estimate-payment-po.js` extend. |
| `estimate_settings`, `estimate_status_history` **[legacy]** | Estimate config + status timeline. |
| `estimate_requests`, `estimate_request_photos`, `estimate_request_products`, `estimate_request_activity` **[legacy]** | Customer-submitted estimate requests + media/activity. |
| `billing_estimates`, `billing_estimate_items`, `billing_invoices`, `billing_invoice_items`, `billing_payments` | Full billing software (`migrate-billing.js`). `billing_estimate_items` + `billing_invoice_items` are **soft-delete** tables. `migrate-invoice-branch.js` adds `local_branch_id`. |
| `payment_links`, `payment_promises` | Payment-link records (`20260518_add_payment_links.js`, `20260519_update_payment_links.js`). |
| `credit_limit_requests`, `customer_credit_history`, `credit_limit_violations` | Zoho-synced credit limits + violation log (`migrate-credit-limits.js`, `migrate-credit-limits-zoho.js`, `migrate-credit-limit-requests.js`). |

#### Catalog (products, pack sizes, item master, DPL)
| Table | Purpose / quirks |
|---|---|
| `products`, `brands`, `categories` **[legacy]** | Product catalog. |
| `pack_sizes` **[legacy]** | Per-product sizes. `migrate-pack-sizes-zoho-mapping.js` adds Zoho item-id mapping; `migrate-pack-sizes-color.js` adds `color_name`/`color_code`. |
| `item_naming_rules` | Brand naming-convention rules (e.g. Birla Opus ALL-CAPS) (`migrate-item-master.js`). |
| `dpl_versions`, `dpl_price_history` | DPL price-list version + per-item price history (`migrate-item-master.js`); `add-dpl-updated-at.js` stamps `dpl_updated_at`. |
| `dpl_catalog` | **Deterministic DPL↔Zoho mediator.** One row per canonical `(brand,product,base,size_tier)` keyed by `match_key UNIQUE`; size stored as canonical tier (200ml/1L/4L/10L/20L) in `size_tier` with original in `dpl_size_label`; `zoho_item_id` is the pinned push target; `link_status ENUM('confirmed','review','needs_creating')`. (`migrate-dpl-catalog.js`). Extended by `migrate-dpl-catalog-push-tracking.js`, `migrate-dpl-catalog-not-in-zoho.js`. Rate formula: `ceil(dpl * 1.18 * 1.10)`. |
| `brand_dpl_lists` | Uploaded per-brand DPL price lists (`migrate-brand-dpl-lists.js`). |
| `engineers`, `engineer_default_rates`, `engineer_custom_rates`, `engineer_hidden_items` | Engineer module + catalog/rate overrides (`migrate-engineers.js`, `migrate-engineer-rates.js`, `migrate-engineer-catalog.js`). |

#### Painter loyalty program
| Table | Purpose |
|---|---|
| `painters` | Painter accounts (OTP auth, tier, points). |
| `painter_point_transactions` | Points ledger (regular vs annual pools); name fixed via engine `addPoints`. |
| `painter_referrals`, `painter_product_point_rates`, `painter_value_slabs`, `painter_slab_evaluations` | Referrals + points-rate config + value slabs. |
| `painter_withdrawals` | Points withdrawal requests/approvals. |
| `painter_attendance`, `painter_invoices_processed` | Legacy attendance + processed-invoice dedup (`migrate-painters.js`). |
| `painter_daily_checkins`, `painter_levels` | Retention check-ins + tier definitions (bronze 0 / silver 5K / gold 25K / diamond 100K, no platinum) (`migrate-painter-retention.js`); `migrate-painter-levels-update.js` adjusts. |
| `painter_estimates`, `painter_estimate_items`, `painter_estimate_sequence` | Painter-created estimates (+ per-painter numbering). `painter_estimate_items` is a **soft-delete** table. |
| `painter_quotations`, `painter_quotation_items` | Painter quotations (`migrate-painter-quotations.js`). |
| `painter_attendance_checkins`, `painter_attendance_monthly`, `painter_attendance_ledger`, `painter_clawback_pending` | Selfie+GPS AP attendance system + clawback (`migrate-painter-attendance.js`). |
| `painter_badges`, `painter_earned_badges`, `painter_challenges`, `painter_challenge_progress` | Gamification (`migrate-painter-gamification.js`). |
| `painter_special_offers`, `painter_fcm_tokens` (field **must** be `fcm_token`), `painter_notifications`, `painter_training_categories`, `painter_training_content` | Offers, push tokens, notifications, training (`migrate-painter-app.js`). |
| `painter_price_reports`, `painter_product_requests`, `painter_gallery`, `painter_calculations` | Price-match reports, product requests, gallery, calculators (`migrate-painter-gallery-pricematch.js`). |
| `painter_visualization_requests` | AI color visualization requests (`migrate-painter-premium.js`). |
| `painter_location_events` | Live GPS reports (25s rate-limit, Socket.io) (`migrate-painter-location.js`). |
| `painter_custom_rates` | Per-painter custom rates (`migrate-painter-custom-rates.js`); `migrate-painter-cart-markup.js`, `migrate-painter-saved-direct.js`, `migrate-offer-bonus-pct.js` extend pricing. |
| `painter_catalog_brand_order` / `category_order` / `product_order` / `brand_overrides` / `category_overrides` / `product_overrides` | Painter catalog ordering + overrides (`migrate-painter-catalog.js`). |
| **PNTR marketing:** `painter_leads`, `painter_lead_followups`, `painter_daily_assignments`, `painter_marketing_config`, `painter_zoho_salesperson_map`, `painter_pntr_import_runs`, `painter_lead_duplicate_queue`, `painter_zoho_sync_queue` | Zoho PNTR import → daily staff calls → conversion → salesperson mapping → points backfill (`migrate-pntr-painter-marketing.js`); `migrate-painter-lead-incentive.js` adds incentive cols. |
| `painter_approval_tracking` columns via `migrate-painter-approval-tracking.js`; `migrate-painter-id-card.js` adds ID-card fields. |

#### Zoho integration
| Table | Purpose / source |
|---|---|
| `zoho_items_map` **[external]** | Local↔Zoho item mapping; carries `cf_dpl`, `dpl_updated_at`, `dpl_disposition` (`add-zoho-dpl-disposition.js`). DPL-disposition triage (Done/Later/Reopen). |
| `zoho_customers_map` **[external]** | Local↔Zoho customer mapping (no `zoho_billing_address` column — use `'' AS address`). |
| `zoho_invoices` **[external]** | Synced invoices; `local_branch_id` added by `migrate-invoice-branch.js`, `salesperson_id`/name by `migrate-zoho-invoices-salesperson.js`. Indexed `(local_branch_id, invoice_date)`. |
| `zoho_payments` **[external]** | Synced payments; indexed `(local_branch_id, payment_date)`. |
| `zoho_expenses`, `zoho_credit_notes` | Synced expenses + credit notes (`20260515_add_zoho_expenses_creditnotes.js`). |
| Backfill: `backfill-zoho-cf-dpl-from-jobs.js`, `resync-corrupted-skus.js` repair `cf_dpl`/SKU data. |

#### WhatsApp module
| Table | Purpose |
|---|---|
| `whatsapp_sessions`, `whatsapp_messages`, `whatsapp_contacts` | Chat sessions/messages/contacts (`migrate-whatsapp-sessions.js`, `migrate-whatsapp-chat.js`); `fix-whatsapp-phone-length.js` widens phone column. |
| `wa_campaigns`, `wa_campaign_leads`, `wa_message_templates`, `wa_sending_stats`, `wa_marketing_settings` | Marketing campaigns + templates + throttle stats (`migrate-wa-marketing.js`); `migrate-wa-campaign-send-from.js` adds sender. |
| `wa_contact_groups`, `wa_contact_group_members` | Contact grouping (`migrate-wa-contact-groups.js`). |
| `wa_instant_messages` | Quick-send queue (`migrate-wa-instant-messages.js`). |
| `pntr` WA templates seeded by `migrate-pntr-wa-templates.js`; idempotency by `migrate-whatsapp-idempotency.js`. General integration: `migrate-general-whatsapp.js`, `migrate-general-wa-integration.js`. |

#### AI system
| Table | Purpose |
|---|---|
| `ai_conversations`, `ai_messages` (+`context_summary`) | Chat threads/messages; indexed `(conversation_id, created_at DESC)` (`migrate-ai-tables.js`). |
| `ai_analysis_runs`, `ai_insights` | Scheduled analysis runs + insights (+`updated_at` via `add-updated-at-to-ai-*.js`). |
| `ai_lead_scores`, `ai_config`, `ai_business_context`, `ai_suggestions` | Lead scores, config keys (`painter_*_rate`, `reorder_*`, provider `*_enabled`), business context, suggestions (`migrate-ai-tables.js`, `migrate-ai-assistant-upgrade.js`). `migrate-clawdbot-primary.js` flips Clawdbot/Kai to sole active provider. |

#### Reorder intelligence
| Table | Purpose |
|---|---|
| `branch_item_sales`, `brand_reorder_config`, `invoice_line_sync_cursor`, `reorder_report_log` | Branch sales velocity, brand lead/safety config, sync cursor, daily report log (`migrate-reorder-intelligence.js`). |
| `reorder_snoozes` | Per-item snooze (`migrate-reorder-snooze.js`). |

#### Vendors & purchasing
| Table | Purpose |
|---|---|
| `vendors`, `vendor_bills`, `vendor_bill_items`, `vendor_purchase_orders`, `vendor_po_items`, `vendor_payments` | Vendor CRUD + bills (AI OCR) + POs + payments (`migrate-vendors.js`); `migrate-vendor-dedupe.js` dedupes. |
| `item_vendor_map`, `vendor_mapping_scans` | Item↔vendor mapping + scan runs (`migrate-vendor-item-mapping.js`). |

#### Stock check
| Table | Purpose |
|---|---|
| `stock_check_assignments`, `stock_check_items` | Stock-check tasks + counted items (`migrate-stock-check.js`); `migrate-stock-check-enhancements.js`, `-partial.js`, `-cancel.js` extend. |
| `stock_verifications` | Stock verification records (`migrate-stock-verifications.js`). |

#### Notifications, geofence & monitoring
| Table | Purpose |
|---|---|
| `notifications` **[legacy/derived]** | User notification feed; indexed `(user_id, read_at, created_at DESC)`. |
| `admin_notifications` | Admin-targeted notifications (`migrate-admin-notifications.js`). |
| Geofence/location: `migrate-geo-enforcement.js`, `migrate-location-off.js`, `migrate-break-enforcement.js` add enforcement columns. |
| `detected_anomalies` | Anomaly-detection scan output (`migrate-anomaly-detection.js`). |
| `production_health_snapshots` | 6AM/12PM/6PM IST health snapshots (`migrate-production-monitor.js`). |
| `error_logs`, `system_health_checks`, `code_quality_metrics` | Error tracking + health + quality (`migrate-error-prevention.js`). |
| `bug_reports`, `fix_suggestions` | Bug tracker + AI fix suggestions (`migrate-bug-reports.js`). |

#### Cross-cutting
| Table | Purpose |
|---|---|
| `audit_records` | Redacting audit log written by `services/audit-log.js::record()` — **note: NOT `audit_log`** (the legacy `audit_log` table is kept untouched) (`migrate-audit-log.js`). |
| `idempotency_records` | 24h-TTL idempotency keys for ~11 financial POSTs (`migrate-idempotency.js`). |
| `_migrations` | Migration tracking (created by `migrate.js`). |
| `settings`, `branches`, `customer_types`, `customers` **[legacy]** | Core config, branch list, customer-type lookup, customers. |

**Notable count discrepancy / quirks to flag for any consumer:** (a) `archive/` SQL/JS files contain duplicate, *outdated* `CREATE TABLE` definitions — always trust `migrations/` over `archive/` and over `docs/DATABASE-README.md`; (b) the `branch_id` column on estimates is historically all-NULL (use NULL-allowance isolation, not equality); (c) the four soft-delete tables and the externally-created `zoho_*` tables are the two biggest gotchas when reasoning about a fresh-install vs production schema.

---

## 7. Frontend & UI System

The frontend is **static HTML served by Express from `public/`** — no SPA framework, no build step for the markup, no client-side router. Each "page" is a standalone `.html` file with inline `<script>` blocks that call the `/api/*` backend via `fetch`. Cross-page concerns (auth, real-time, toasts, skeletons, idempotency, sharing) live in 14 shared helpers under `public/js/`. Styling is **Tailwind (built locally, no longer CDN) + a hand-written design system + page-local `<style>` blocks**. There are ~123 top-level HTML pages plus `public/staff/` (14 pages), `public/share/` (3 public share pages), and `public/components/` (17 nav fragments).

### 7.1 Page map by actor / area

There is no server-side templating — the actor a page belongs to is encoded purely in its filename prefix and the localStorage token it reads. `public/index.html` is a static **portal splash** (`index.html:199-225`) with four cards (Staff & Admin → `/login.html`, Painter → `/painter-login.html`, Customer → `/customer-login.html`, Engineer → `/engineer-login.html`); its inline script (`index.html:234-281`) is session-aware — if a token (`auth_token` / `painter_token` / `customer_token` / `engineer_token`) exists it rewrites the card to "Go to Dashboard" and routes admin/staff roles differently (`/dashboard.html` vs `/staff/dashboard.html`).

**Auth / account pages**

| Page | Actor | Notes |
|------|-------|-------|
| `login.html` | Staff/Admin | password + bcrypt, optional TOTP; writes `auth_token` + `user` |
| `register.html`, `staff-register.html`, `admin-staff-registrations.html` | Staff | self-registration + admin approval queue |
| `forgot-password.html`, `reset-password.html` | Staff | token-based reset (U-CRITICAL-4) |
| `painter-login.html`, `painter-register.html` | Painter | phone OTP → `painter_token` |
| `engineer-login.html`, `engineer-register.html` | Engineer | phone OTP → `engineer_token` (X-Engineer-Token) |
| `customer-login.html` | Customer | phone OTP → `customer_token` |

**Admin console (`admin-*.html`, ~75 pages)** — the largest cluster, grouped by functional area (sidebar is `components/sidebar-complete.html`, subnavs mapped in `universal-nav-loader.js:44+`):

| Cluster | Pages |
|---------|-------|
| Dashboards & monitoring | `dashboard.html`, `admin-dashboard.html`, `admin-live-dashboard.html`, `admin-monitoring.html`, `admin-system-health.html`, `admin-activity-monitor.html`, `admin-anomalies.html`, `admin-reports.html`, `admin-ai.html` |
| Painters | `admin-painters.html`, `admin-painter-catalog.html`, `admin-design-requests.html`, `admin-photos.html`, `admin-geofence-logs.html`, `admin-bug-reports.html` |
| Leads / CRM | `admin-leads.html`, `admin-lead-scoring.html`, `admin-customers.html`, `admin-customer-types.html`, `admin-credit-limits.html`, `admin-estimate-requests.html` |
| Collections | `admin-zoho-collections.html` |
| Salary suite | `admin-salary-config.html`, `admin-salary-monthly.html`, `admin-salary-payments.html`, `admin-salary-advances.html`, `admin-salary-incentives.html`, `admin-salary-reports.html` |
| Attendance/HR | `admin-attendance.html`, `admin-tasks.html`, `admin-daily-tasks.html`, `admin-staff.html`, `admin-staff-registrations.html`, `admin-agreements.html`, `admin-guides.html` |
| Zoho suite | `admin-zoho-dashboard.html`, `-invoices`, `-collections`, `-salesorders`, `-expenses`, `-transactions`, `-stock`, `-stock-adjust`, `-reorder`, `-purchase-suggestions`, `-items`, `-items-edit`, `-locations`, `-bulk-jobs`, `-reports`, `-settings` |
| WhatsApp suite | `admin-wa-dashboard.html`, `-contacts`, `-marketing`, `-templates`, `-settings`, `-admin-login`, `admin-whatsapp-chat.html`, `admin-whatsapp-sessions.html` |
| Item-master / DPL | `admin-item-master.html`, `admin-dpl.html`, `admin-dpl-match.html`, `admin-products.html`, `admin-brands.html`, `admin-categories.html`, `admin-price-list-generator.html`, `birla-opus-report.html` |
| Stock | `admin-stock-check.html`, `admin-stock-migration.html` |
| Branches / RBAC | `admin-branches.html`, `admin-roles.html`, `admin-role-permissions.html`, `admin-settings.html`, `admin-profile.html`, `admin-website.html` |
| Engineers | `admin-engineers.html`, `admin-engineer-catalog.html` |

**Staff pages** — split between flat `staff-*.html` (feature consoles) and a nested `public/staff/` directory (daily-work portal):
- Flat: `staff-billing.html`, `staff-estimates.html`, `staff-leads.html`, `staff-vendors.html`, `staff-incentives.html`, `staff-painter-marketing.html`, `staff-requests.html`, `staff-daily-work.html`.
- `public/staff/`: `dashboard.html`, `clock-in.html`, `clock-out.html`, `attendance/activities.html`, `tasks.html`, `daily-tasks.html`, `collections.html`, `stock-check.html`, `salary.html`, `advance-request.html`, `permission-request.html`, `history.html`, `agreement.html`, `guides.html`.

**Painter portal** — `painter-dashboard.html` (note: in `validateSession`'s public-path allowlist, `auth-helper.js:138`), `painter-catalog.html`, `painter-profile.html`, `painter-attendance.html`, `painter-training.html`, `painter-estimate-create.html`. Painter pages are bilingual (see `painter-i18n.js`).

**Engineer portal** — `engineer-dashboard.html`, `engineer-catalog.html`, `engineer-cart.html`, `engineer-new-quote.html`, `engineer-profile.html` (shared logic in `engineer-portal.js` + `engineer-portal.css`).

**Customer-facing / public** — `customer-dashboard.html`, `customer-requests.html`, `customer-estimate-view.html`, `request-estimate.html`, `payment.html`, `payment-receipt.html`, `estimate-view.html`, `estimate-actions.html`, `estimate-print.html`, `estimate-create-new.html`, `estimate-edit.html` (redirects to `estimate-create-new.html?id=`), `estimate-settings.html`, `estimates.html`, `privacy-policy.html`. Public share links live under `public/share/`: `estimate.html`, `painter-estimate.html`, `design-request.html` (these are excluded from `validateSession` via the `/share/` path prefix check, `auth-helper.js:139`).

**PWA / system pages** — `offline.html` (SW network-first fallback target), `404.html`, `manifest.json`, `sw.js`. `chat.html` is the AI chat surface.

### 7.2 Shared JS helpers (`public/js/`, 14 files)

| File | Exports / purpose |
|------|-------------------|
| `auth-helper.js` | Core staff/admin auth. `getAuthHeaders()` (Bearer from `localStorage.auth_token`), `isAuthenticated()`, `getCurrentUser()` (parses `localStorage.user`), `logout({reason})` (clears tokens, double-logout guard `window.__qcLoggingOut`), `apiRequest()` (auto-401 → `logout('expired')`), `checkAuthOrRedirect()`, `validateSession()` (fire-and-forget `GET /api/auth/me`; tolerates network errors so offline doesn't log out; skips on public paths), role helpers `FULL_ADMIN_ROLES=['admin','administrator','super_admin']` / `ADMIN_LEVEL_ROLES` (+manager/branch_manager), `isAndroidApp()` (UA contains `QCManagerApp`), and **service-worker registration** `registerServiceWorker()` → `/sw.js` + web-push subscribe (VAPID key from `/api/notifications/push/vapid-key`, skipped inside Android WebView). |
| `permissions.js` | `PermissionManager` class — loads `GET /api/auth/permissions`, caches `permissions`/`is_admin`/`role` in `localStorage.user_permissions`, used to show/hide UI by `module.action`. |
| `qc-ui.js` | UI primitives (pairs with `qc-ui.css`): `qcToast(msg,{variant,duration})`, `qcConfirm()→Promise<bool>`, `qcAlert()`, `qcSheet({title,html})→{close}`, `qcChip({label,variant})→html`. Has its own `escapeHTML()` and an `admin:true` flag that switches primary button to purple (`qc-btn-primary-admin`). Replaces native `alert`/`confirm`. |
| `ui-skeletons.js` | Loading shimmer + empty states (pairs with `skeletons.css`): `qcSkeletonRows(n)`, `qcSkeletonCards(n)`, `qcSkeletonStats(n)`, `qcEmptyState({icon,title,message,ctaText,ctaHref})` with inline SVG icon set. |
| `idempotency-fetch.js` | `qcIdempotencyKey()` (UUID via `crypto.randomUUID` + fallback) and `qcWithIdempotency(key,headers)` → adds `Idempotency-Key` header for the 11 financial POSTs (server replays within 24h via `Idempotent-Replay`). One UUID per submit click. |
| `socket-helper.js` | Socket.IO client (`initSocket()`), idempotent-load guarded (`window._qcSocketHelperLoaded`), auths via `{ auth:{ token } }` from `auth_token`, exposes `window.qcSocket`, reconnect 10× / 2s, `websocket`+`polling`; on `Invalid session`/`Authentication required` triggers re-auth. |
| `mobile-init.js` | Injected by `universal-nav-loader.js`, runs once post-DOMContentLoaded. DOM auto-fixer for mobile: `wrapTables()` (wraps bare `<table>` in `.mob-table-wrap` for horizontal scroll), `fixInlineWidths()` (strips hardcoded px widths < 640px), `labelTableCells()`, keyboard input offset, overflow detection. |
| `share-pdf.js` | `qcSharePdf({pdfUrl,headers,filename,shareTitle,shareText,getFallbackUrl})` — fetches a PDF blob and shares via Web Share API (phone's own WhatsApp); falls back to download + `wa.me` text link on desktop/old WebViews. Uses `qcToast` for errors. |
| `wa-quick-send.js` | `WaQuickSend.open({to,toName,message,context,recipientType})` reusable WhatsApp send modal for admin pages; `POST /api/whatsapp-chat/quick-send`; ships canned `TEMPLATES` (collections/leads, staff vs direct) with `{placeholder}` interpolation. |
| `stock-filters.js` | `StockFilterManager` class — multi-select Brand/Category + Stock-status/Last-checked filter panel with chips & badge count, drives both server query params and client predicates; options from `/api/zoho/stock/filter-options` (pairs with `stock-filters.css`). |
| `error-prevention.js` | Global client error capture — `window.onerror`/unhandledrejection → `POST /api/system/errors/log-client`, rate-limited to 10/min, only when authenticated. |
| `painter-i18n.js` | Lightweight i18n for painter pages. Loads `/i18n/painter-{lang}.json` (`painter-ta.json` / `painter-en.json`), **defaults to Tamil (`'ta'`)**, persists `localStorage.painter_lang`, applies via `[data-i18n]` attributes (handles input placeholders), exposes `t(dotKey)`. |
| `engineer-portal.js` | Engineer session layer — `X-Engineer-Token` auth header, `ENG_KEYS` localStorage set (`engineer_token`, `engineer_id`, etc.), `clearSession()`, `handleAuthFail()` (401/403 → `/engineer-login.html`), `logout()`; base `/api/engineers` (pairs with `engineer-portal.css`). |
| `dpl-duplicate-detect.js` | Pure, dual-mode (browser `window.computeDuplicateInfo` + jest `require`) — flags when one Zoho item is confirmed against ≥2 DPL catalog entries, classifying each as `best`/`wrong`/`ambiguous` using server-computed `sku_base_match` (Birla base codes: white=WT, pastel=1, mid=2, clear=99, yellow=5, red=6). |

Also notable: `public/universal-nav-loader.js` (v3.0) — chooses sidebar by role (`sidebar-complete.html` for admin-level, else `staff-sidebar.html`), loads `header-v2.html`, the correct subnav by `data-page` (`SUBNAV_MAP`), and injects `mobile-init.js`; retry 3×/1s. `public/app.js` and `public/estimates.js` are additional page bundles.

### 7.3 Design system & CSS pipeline

- **`public/css/design-system.css`** (~1274 lines, v2.0.0) — the token layer. `:root` CSS custom properties: `--color-primary:#6366f1` (indigo) and shades, secondary purple `#8b5cf6`, accent green `#10b981`, warning amber, danger red, info blue, full gray scale, and gradients incl. `--gradient-secondary: linear-gradient(135deg,#667eea 0%,#764ba2 100%)` (the admin gradient). Loads Inter via Google Fonts `@import`.
- **Tailwind JIT pipeline** — `src/tailwind-input.css` is just the three `@tailwind base/components/utilities` directives; `npm run build:css` compiles it to **`public/css/tailwind.css`** (~951KB). `tailwind.config.js` scans `./public/**/*.html` + `./public/**/*.js`, defines theme colors `qcgreen` (`#1B5E3B`/dark `#154D31`/darker `#0D3D23`), `qcgold:#D4A24E`, and `admin` (`primary #667eea`, `secondary #764ba2`, `accent #6366F1`), and a large **`safelist`** of regex patterns + brand arbitrary values (`bg-[#1B5E3B]`, `bg-[#667eea]`, etc.) so classes built in JS `innerHTML` strings aren't tree-shaken.
- **CDN → built-CSS migration is effectively complete.** All 117 pages link `<link rel="stylesheet" href="/css/tailwind.css">` (`admin-dashboard.html:14`); there are **zero** `cdn.tailwindcss.com` references left in `public/` (the one `tailwindcss.com` hit is the generated comment header inside `tailwind.css`). (Note: this is more advanced than CLAUDE.md/MEMORY.md's "105 still on CDN" — those docs are stale.)
- **Companion CSS files**: `qc-ui.css` (toast/modal/sheet/chip — header documents brand split: admin `#6366F1`/`#4F46E5`, staff & painter `#1B5E3B`/`#154D31`), `skeletons.css`, `stock-filters.css`, `zoho-common.css`, `engineer-portal.css`, `painter-dark.css` (painter dark mode), `mobile.css`. Several pages (e.g. `index.html`) additionally define local `:root` tokens in inline `<style>` (`--qc-green`, `--qc-gold`, `--qc-cream`, serif `Playfair Display`, Tamil `Noto Serif Tamil`).

### 7.4 Brand color rules (load-bearing)

- **Admin:** purple gradient **`#667eea → #764ba2`** + accent **`#6366F1`**.
- **Staff & Painter:** forest green **`#1B5E3B`** (+ dark `#154D31`, darker `#0D3D23`) and gold **`#D4A24E`**. Body bg `#f0fdf4` (staff).
- **NO purple anywhere in staff or painter pages.** `qc-ui.js`/`qc-ui.css` gate purple behind an explicit `admin:true` flag (`qc-btn-primary-admin`); the default primary is green.
- `manifest.json` `theme_color` and the global `<meta name="theme-color">` are **`#1B5E3B`** (green), matching the Android native status bar.

### 7.5 The `.hidden` responsive gotcha (regression-prone)

`design-system.css:9-16` deliberately scopes Tailwind's `.hidden`:
```css
.hidden:not([class*="sm:"]):not([class*="md:"]):not([class*="lg:"]):not([class*="xl:"]) {
    display: none !important;
}
```
Rationale: the old CDN build emitted `.hidden { display:none !important }`, but the local build does not, so a plain `.hidden` could lose to component `display` rules. Forcing `!important` for *plain* hides while **excluding** responsive variants is what makes patterns like `hidden sm:block` / `hidden md:flex` work — an unscoped `!important .hidden` would defeat Tailwind's responsive show-utilities and keep elements hidden at every breakpoint (this exact bug previously blanked desktop layouts). There is **no CSS cache-busting**, so a hard refresh is required after any CSS deploy.

### 7.6 Frontend XSS convention

Always **escape user-controlled values before `innerHTML`**. The helper exists in ~78 of the HTML pages but its **name is inconsistent** (`esc` / `escHtml` / `escapeHtml` / `escapeHTML`, plus `escJS()` for safe `onclick` attribute embedding, and `qc-ui.js`'s own internal `escapeHTML`). Convention: **reuse whichever helper the page you're editing already defines** rather than introducing a new one.

### 7.7 Client-side auth & PWA

- **Auth state lives entirely in `localStorage`**, keyed per actor: staff/admin `auth_token` + `user` (JSON); painter `painter_token`; engineer `engineer_token` (+ `engineer_*` profile keys); customer `customer_token`. Tokens go out as `Authorization: Bearer …` (staff/customer) or `X-Engineer-Token` / `X-Painter-Token` headers. No cookies/CSRF — purely header-based bearer auth.
- **401 handling** is reactive (`apiRequest` → `logout('expired')`) plus a proactive `validateSession()` on protected pages; network failures are tolerated to stay offline-friendly.
- **Service worker** (`public/sw.js`, cache `qc-manager-v2`) is intentionally minimal: it caches only `/offline.html` at install, serves **network-first** for navigation requests (falling back to `offline.html`), and **never caches API or assets** ("keeps the app always live"). It also handles `push` events to render web-push notifications (icon `/icons/icon-192x192.png`). Registered by `auth-helper.js:registerServiceWorker()`, which subscribes to web push unless running inside the Android WebView.

---

## 8. Core Business Logic — Money & Correctness Paths

These are the high-stakes engines where an error costs real money or breaks invoice/Zoho consistency. Each subsection gives the algorithm, the exact formulas, the data read/written, known defects/decisions, and `file:line` evidence. **Treat every one of these as "write a characterization test before you touch it"** (per `CLAUDE.md` §6).

---

### 8.1 Estimate pricing engine — `routes/estimates.js`

Two pure functions drive all estimate money math: `calculateItemPricing(item)` (per-line) at `routes/estimates.js:46-112` and `calculateEstimateTotals(items)` (whole-estimate) at `routes/estimates.js:114-135`.

#### 8.1.1 `calculateItemPricing` — per-line algorithm

1. **Base price** (`:47`): `basePrice = parseFloat(item.base_price) || parseFloat(item.unit_price) || 0`. Falls back to `unit_price` if no explicit base.
2. **Quantity** (`:48`): `quantity = parseFloat(item.quantity) || 1` (defaults to 1, never 0 here).
3. **Markup** (`:54-71`) — applied to base price, four modes via `item.markup_type` / `item.markup_value`:

   | `markup_type` | formula (`mv = markup_value`) | line |
   |---|---|---|
   | `price_pct` | `markupAmount = basePrice * mv / 100` | `:58` |
   | `price_value` | `markupAmount = mv` | `:61` |
   | `total_pct` | `markupAmount = (basePrice * quantity) * mv / 100 / quantity` | `:64` |
   | `total_value` | `markupAmount = mv / quantity` | `:67` |

   Then `priceAfterMarkup = basePrice + markupAmount` (`:70`).
4. **Discount** (`:75-92`) — applied to `priceAfterMarkup`, same four modes via `item.discount_type` / `item.discount_value`:

   | `discount_type` | formula (`dv = discount_value`) | line |
   |---|---|---|
   | `price_pct` | `discountAmount = priceAfterMarkup * dv / 100` | `:79` |
   | `price_value` | `discountAmount = dv` | `:82` |
   | `total_pct` | `discountAmount = (priceAfterMarkup * quantity) * dv / 100 / quantity` | `:85` |
   | `total_value` | `discountAmount = dv / quantity` | `:88` |

   Then `finalPrice = priceAfterMarkup - discountAmount` (`:91`).
5. **Round-up-to-₹10 (SINGLE round) + unit derivation** (`:98-101`) — the load-bearing block:
   ```js
   const r10 = n => Math.ceil(n / 10) * 10;
   const safeQty = quantity > 0 ? quantity : 1;
   const lineTotal = r10(finalPrice * safeQty);          // round the LINE once
   const unitPrice = Math.round((lineTotal / safeQty) * 100) / 100;  // derive unit
   ```
   The payable **line total** is rounded up to the nearest ₹10 **exactly once**, from the un-rounded unit price, and `unit_price` is then derived as `line_total / qty` so the invoice is internally consistent (`unit_price × qty === line_total`).
6. **Return shape** (`:103-111`): `{ base_price: r10(basePrice), markup_amount, price_after_markup, discount_amount, final_price: unitPrice, unit_price: unitPrice, line_total: lineTotal }`. Note `base_price` is itself rounded up to ₹10 in the return; `markup_amount`/`price_after_markup`/`discount_amount` are 2-decimal-rounded.

#### 8.1.2 The historical DOUBLE-round bug (fixed 2026-06-04)

The old code rounded the **unit price** up to ₹10 and then rounded the **line total** up to ₹10 again, systematically overcharging. `COMPLETION_STATUS.md:74` (P0-1) gives the worked example: `₹127.50 × 5 → ₹650 instead of ₹640`. The fix (commit referenced as `663e4d4`, owner-confirmed 2026-06-04) collapsed this to a **single line-level round**, then derives `unit_price` from the rounded line (the comment at `:94-97` documents exactly this). Locked by `tests/unit/estimate-pricing.test.js`. **Do not reintroduce per-unit rounding.**

#### 8.1.3 Divide-by-quantity NaN risk (latent, partially guarded)

`calculateItemPricing` guards the line/unit division with `safeQty = quantity > 0 ? quantity : 1` (`:99`), so the unit-price derivation cannot divide by zero. **However the markup/discount `total_*` modes (`:64,67,85,88`) still divide by the raw `quantity`** (not `safeQty`). With `quantity = 0`, `:48` already coerces it to `1` (because `0 || 1 → 1`), so in practice `quantity` is never 0 inside this function — the NaN risk is theoretical here but would resurface if any caller passed quantity through a different path. Treat the `total_*` divisors as the fragile spot.

#### 8.1.4 `calculateEstimateTotals` — whole-estimate algorithm (`:114-135`)

- Iterates items; `item_type === 'labor'` lines accumulate into `total_labor` (`:118-119`); everything else accumulates `subtotal += line_total`, plus `total_markup` / `total_discount` **multiplied back out by quantity** (`:121-123`, because the per-line amounts are per-unit).
- Returns (`:127-134`): `subtotal`, `total_markup`, `total_discount`, `total_labor`, **`gst_amount: 0` (hard-coded, `:132`)**, and `grand_total = round((subtotal + totalLabor) * 100) / 100` (`:133`). **GST is not added to the grand total** — see 8.2.

---

### 8.2 GST policy — OWNER-CONFIRMED, do NOT "re-fix"

These are **settled business decisions**, not bugs. They are documented in the user's persistent memory (`project_estimate_gst_rounding_policy.md`) and `COMPLETION_STATUS.md:107-124`.

1. **GST is INCLUSIVE → `gst_amount = 0` is CORRECT.** Estimate/Zoho prices already include 18% GST. Therefore `gst_amount: 0` in `calculateEstimateTotals` (`routes/estimates.js:132`) is **intentional and correct** — do **not** add 18% on top of the subtotal. Owner-confirmed 2026-06-04. The estimate PDF now prints "(Prices inclusive of GST @18%)" instead of a misleading "GST @18%: ₹0" row; any remaining "GST @18%" label is **cosmetic**. `COMPLETION_STATUS.md:48` and `:75` (P0-2) flagged this as "intent must be confirmed before change" — that confirmation has happened; the matter is closed.
2. **NIT-1: estimate ↔ Zoho sub-rupee line drift is ACCEPTED.** The estimate stores a ₹10-rounded `line_total` and a derived `unit_price = line_total/qty` (2-decimal). The Zoho push (`services/billing-zoho-service.js:140-144`) sends `{ item_id, quantity, rate: unit_price }`, and **Zoho recomputes the line as `rate × qty`**. So the Zoho invoice line can differ from the estimate line by up to ~₹1 (drift ≈ `qty × 0.005`; worked example `base 1 × qty 199` → estimate ₹200, Zoho ₹200.99). This was **surfaced, not caused**, by the 2026-06-04 single-round fix (the old double-round only "reconciled" because it overcharged to a whole-₹10 unit). **Decision (owner, 2026-06-05): accept as a known limitation.** **Zoho is the system-of-record** for the actual invoice/GST. Painter points are unaffected — they use the stored `item_total`/`line_total`, not the Zoho-recomputed value. Do not "fix" without an audit requirement plus verification on a real Zoho draft invoice.

---

### 8.3 Painter points engine — `services/painter-points-engine.js`

The most stateful money path. Manages two point pools, level multipliers, daily-bonus caps, clawbacks, referrals, slabs, credit auto-debit, and withdrawals. Single shared `pool` injected via `setPool` (`:6-8`).

#### 8.3.1 Two point pools

Every painter has `regular_points` and `annual_points` (cached on the `painters` row) plus `total_earned_*` / `total_redeemed_*` counters (`getBalance`, `:25-39`). All movements go through:
- **`addPoints`** (`:41-101`) — clawback netting (regular only, see 8.3.4), then a `FOR UPDATE`-locked transaction that inserts a `painter_point_transactions` ledger row (`type='earn'`) and updates the cached `{pool}_points` + `total_earned_{pool}` (`:79-91`). Returns new balance.
- **`deductPoints`** (`:103-138`) — symmetric; inserts ledger row with **negative** `amount` (`:120`, `type='debit'`), throws on insufficient balance (`:113`), updates `total_redeemed_{pool}`.

Note the dynamic column interpolation `${pointPool}_points` / `total_earned_${pointPool}` (`:75,86-89`) — `pointPool` is always an internal literal `'regular'`/`'annual'`, never user input, so it is safe.

#### 8.3.2 Invoice processing — where points are earned (`processInvoice`, `:157-310`)

- **Idempotency / dedup**: claims the invoice via `INSERT IGNORE INTO painter_invoices_processed` against `UNIQUE (painter_id, invoice_id, attribution_type)` (`:164-173`). If `affectedRows === 0`, bails with `alreadyProcessed: true`. This replaced a read-then-insert race that double-awarded points. Points are awarded on **confirm-payment** of an estimate, with the invoice keyed as `EST-{id}` so re-confirming the same estimate is a no-op.
- **Per-line points** (`:187-206`), driven by `painter_product_point_rates` (active rows, indexed by `item_id`, `:177-181`):
  - **Regular** (customer billing only, `:194-198`): `regPts = regular_points_per_unit × quantity`. Self-billing skips regular points.
  - **Annual** (both billing types, if `annual_eligible`, `:202-205`): `annPts = item_total × (annual_pct / 100)`.
  - Both totals 2-decimal rounded (`:209-210`).
- **Level multiplier applied at award time** via `addPointsWithMultiplier` (`:255-261`) — see 8.3.3.

#### 8.3.3 Tier/level system and multipliers

Tiers live in `painter_levels` (seeded by `migrations/migrate-painter-retention.js:41-46`). **Four tiers, NO platinum:**

| Level | `min_points` (lifetime) | `multiplier` | badge color |
|---|---|---|---|
| bronze | 0 | 1.00 | `#CD7F32` |
| silver | 5,000 | 1.20 | `#9CA3AF` |
| gold | 25,000 | 1.50 | `#D4A24E` |
| diamond | 100,000 | 2.00 | `#3B82F6` |

- `getLevelMultiplier` joins `painters.current_level → painter_levels.multiplier`, default `1.0` (`:557-565`).
- `addPointsWithMultiplier` (`:567-585`): `adjustedAmount = round(baseAmount × multiplier × 100)/100`, calls `addPoints`, then `checkLevelUp`.
- `checkLevelUp` (`:587-609`): **lifetime = `total_earned_regular + total_earned_annual`** (`:595`), finds the highest `painter_levels` row with `min_points <= lifetime` (`:597-600`); on change updates `current_level` and **nulls `card_generated_at` / `id_card_generated_at`** to force card regeneration (`:605`), then fires a level-up push notification.

#### 8.3.4 Clawback (`:44-65`, `queueClawback` `:611-616`)

Pending clawbacks live in `painter_clawback_pending` (unsettled = `settled_at IS NULL`). On any **regular** `addPoints`, incoming credit is first netted against oldest-first pending clawbacks (`:46-64`): fully-absorbed rows are stamped `settled_at=NOW()`, partial rows decremented. If the entire credit is absorbed, `addPoints` returns `0` and no ledger row is written. Annual credits are never netted against clawbacks.

#### 8.3.5 Daily-bonus cap — and the server-local-date vs IST bug

`processInvoice` (`:212-251`) supports a "daily bonus product" multiplier read from `ai_config` keys `painter_daily_bonus_product_id`, `painter_daily_bonus_multiplier` (default 2), `painter_daily_bonus_cap` (default 500). If a line item maps to the bonus product, `bonusExtra = round(totalRegularPoints × (multiplier-1) × 100)/100`, then capped by how much daily bonus is already earned today (`:243-244`: `remaining = max(0, cap - alreadyEarned)`; `dailyBonusPoints = min(bonusExtra, remaining)`).

**Known defect — "today" is computed from the SERVER-LOCAL date, not true IST**, despite the comment claiming otherwise (`:234-236`):
```js
// Use IST date to match server-stored dates  ← comment
const now = new Date();
const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1)...}-${String(now.getDate())...}`;
```
`getFullYear/getMonth/getDate` return the **server process local time**. The server clock is IST (per `CLAUDE.md` §2: "server clock is IST"), so today this happens to be correct, but the value is **not** derived from a real IST conversion — it is brittle to any TZ change on the host, and `DATE(created_at)` comparisons (`:239`) depend on rows being stored in IST too. The DB session is forced to `+00:00` (UTC) in `config/database.js`, so the alignment between `created_at` storage and this local-date string is implicit, not enforced.

#### 8.3.6 Referrals, slabs, credit auto-debit

- **Referral tier** `getReferralTier(totalBills)` (`:14-19`): `≥10 → 2.0`, `≥5 → 1.5`, `≥3 → 1.0`, else `0.5` (percent of invoice total). Awarded to the referrer's **regular** pool on each processed invoice (`:269-293`).
- **Value slabs** `evaluateMonthlySlabs` / `evaluateQuarterlySlabs` → `_evaluateSlabs` (`:316-399`): sums `painter_invoices_processed.invoice_total` over the period, matches highest `painter_value_slabs` band, awards `bonus_points` to the **annual** pool, records in `painter_slab_evaluations` (one per painter/period — re-run safe via the existing-check at `:356-360`).
- **Credit auto-debit** `checkOverdueCredits` (`:405-462`): for painters with `credit_enabled=1 AND credit_used>0`, finds oldest unpaid self-billing invoice; if `days_overdue > painter_credit_overdue_days` (default 30), debits `credit_used` first from **regular** then from **annual** points.

#### 8.3.7 Withdrawals — annual window NOT enforced

`requestWithdrawal` (`:468-489`) checks available balance, inserts a `pending` row into `painter_withdrawals`. For **annual** withdrawals it reads `ai_config` keys `painter_annual_withdrawal_month` / `painter_annual_withdrawal_day` (`:476-481`) but the block contains only the comment **`// Simple check - can be enhanced later`** — **the annual withdrawal window is currently NOT enforced**; any annual withdrawal request is accepted regardless of date. `processWithdrawal` (`:491-515`) deducts points on approve/paid and updates status. Attendance points (`awardAttendancePoints`, `:521-541`) are idempotency-guarded by `(source='attendance', reference_id=attendanceId)`.

---

### 8.4 Salary calculation — `routes/salary.js`

Core engine: `calculateSalaryForUser(userId, month, calculatedBy)` (`:510-679`). Reads `staff_salary_config` (`:517-525`), `staff_attendance` (`:538-559`), `attendance_permissions` (`:564-572`), `staff_incentives` (`:619-624`); upserts `monthly_salaries` (`:629-674`).

#### 8.4.1 Hourly-rate basis — the `/260` vs `standard_daily_hours` inconsistency

```js
const hourlyRate = parseFloat(config.monthly_salary) / 260;  // 26 days * 10 hours  (:532)
```
The hourly rate is hard-coded to a **26-day × 10-hour = 260-hour** month. But **deductions use `config.standard_daily_hours`** (a configurable column, default 10.00 per `:381`):
- absence deduction: `absent_days × hourlyRate × config.standard_daily_hours` (`:610`)
- leave deduction: `excessLeaves × hourlyRate × config.standard_daily_hours` (`:614`)

If any config sets `standard_daily_hours ≠ 10`, **earnings (via `/260`) and deductions (via the config value) use different day-length assumptions** → an inconsistent basis. This is `COMPLETION_STATUS.md:82` (P1-2). The `/260` literal is the canonical earning divisor; the config value only bites in deductions.

#### 8.4.2 Sunday OT — counted at 2× in SQL then re-multiplied (likely overpay)

Sunday handling: 1 actual Sunday hour = 2 equivalent hours, 5 actual hours (300 min) = 1 day. The attendance aggregate computes Sunday overtime as **already doubled**:
```sql
SUM(CASE WHEN DAYOFWEEK(date)=1 AND status IN ('present','half_day') AND total_working_minutes > 300
    THEN (total_working_minutes - 300) * 2 ELSE 0 END) / 60  AS sunday_overtime_hours   (:552-553)
```
Then in JS that already-2× value is **multiplied again by the overtime multiplier**:
```js
const sundayOvertimePay = parseFloat(att.sunday_overtime_hours) * hourlyRate * overtimeMultiplier;  (:593)
```
So Sunday OT effectively pays `actualHours × 2 × overtimeMultiplier` — **likely an overpay** (the 2× and the OT multiplier compound). This is `COMPLETION_STATUS.md:83` (P1-3). Weekday OT does not have this issue (`approved_overtime_hours × hourlyRate × multiplier`, `:592`).

#### 8.4.3 Pay components, leaves, deductions

- **Standard pay**: `standard_hours × hourlyRate` where `standard_hours = LEAST(total_working_minutes, 600)/60` capped at a 10-hour weekday (`:546-547,589`).
- **Sunday pay**: `(sunday_hours / 5) × dailyRate`, `dailyRate = hourlyRate × 10` (`:586-590`).
- **Leave policy** (`:578-583`): 1 free paid Sunday leave + 1 free paid weekday leave/month; `excessLeaves` beyond quota are deducted at `hourlyRate × standard_daily_hours` (`:614`).
- **Late deduction**: `late_days × late_deduction_per_hour`, only if `enable_late_deduction` (`:603-606`).
- **Incentive**: sum of `staff_incentives` where `status='approved'` for the month (`:619-625`).

#### 8.4.4 No `net_salary` in JS — it's a STORED GENERATED column

`calculateSalaryForUser` writes the components (`standard_hours_pay`, `sunday_hours_pay`, `overtime_pay`, allowances, deductions, `incentive_amount`) but **never computes a net total in JS**. `gross_salary` and `net_salary` are **MySQL `GENERATED ALWAYS ... STORED`** columns (`migrations/migrate-staff-incentives.js:67-82`):
```sql
gross_salary = standard_hours_pay + sunday_hours_pay + overtime_pay + total_allowances + incentive_amount
net_salary   = ... (gross terms) ... - total_deductions
```
Consequently the adjustments endpoint (`:1203-1242`) only updates the component columns and `total_allowances` / `total_deductions`; gross/net "update automatically" (comment `:1225`). The trade-off `COMPLETION_STATUS.md` notes: there is no single hand-computed net-salary summary in the application code — the authoritative net is the DB-generated column, so any reasoning about take-home must read `monthly_salaries.net_salary`, not re-derive it.

---

### 8.5 DPL pricing pipeline — parse → match → propose → catalog → push

The "DPL" (Dealer Price List) pipeline converts a manufacturer PDF/CSV into proposed Zoho item names/SKUs/rates. Flow: `services/price-list-parser.js` → `services/dpl-catalog.js` → `routes/item-master.js` / `routes/zoho.js`.

#### 8.5.1 The rate formula (single source of truth)

**Selling rate = `ceil(dpl × 1.18 × 1.10)`** — 18% GST × 10% markup, rounded up to a whole rupee. Verified in **three** places, all identical:
- `services/price-list-parser.js:1007` — `computeProposedFields`: `proposedRate = dpl > 0 ? Math.ceil(dpl * 1.18 * 1.10) : null`.
- `services/dpl-catalog.js:285,343,376,742-746` — `current_rate`, `new_rate`, `buildPushChanges` fallback, and `dplToRate`: `Math.ceil(d * 1.18 * 1.10)`.
- `routes/item-master.js:45-46` — `calculateSalesPrice(dpl) = Math.ceil(dpl * 1.298)` — **the same factor pre-multiplied** (`1.18 × 1.10 = 1.298`). Numerically identical but written differently; both compute the same rupee. (Be aware of this shorthand when grepping — the literal `1.298` is the DPL markup factor.)

#### 8.5.2 Parse — `parseBirlaOpus` emits `_prices` arrays (`:134-251`)

PDF text extraction **loses column alignment** (empty cells vanish), so the parser does NOT guess which price belongs to which pack size. Instead it emits one group row per product/base carrying **all numeric prices as a `_prices` array** plus `baseCode` and `category` (`:228,234-245`):
```js
results.push({ brand: 'Birla Opus', product: `${currentProduct} - ${baseName}`, _prices: prices, baseCode: dataMatch[1], category: fullCat });
```

#### 8.5.3 Match — `matchWithZohoItems` rate-anchored expansion + size-tier equivalence (`:1557-…`)

- **Brand scoping** (`:1561-1593`): Zoho candidates are filtered to the PDF's brand set (name-keyword fallback for items lacking a brand column); items with neither a brand column nor a brand keyword are dropped to prevent cross-brand leaks.
- **Family index** (`:1599-1612`): Zoho items grouped by product-name abbreviation (`extractProductAbbrev`) → list of `{packCode, rate, finish}`. Abbrev-keying beats SKU-token keying because Zoho SKUs collide across families.
- **Rate-anchored assignment** (`:1707-1749`) — the core of "unknown column alignment": sort the family members **ascending by Zoho rate** (fallback ascending pack size if rates are 0), sort the PDF `_prices` ascending, then zip smallest-price→smallest-rate. Guards:
  - **Skip mismatched small Zoho sizes** (`:1717-1724`): if the PDF's minimum price > 2× the smallest family member's rate, skip that member.
  - **Surplus prices dropped at the SMALL end** (`:1726-1734`): when the PDF has more prices than Zoho has sizes, drop the **smallest** excess prices (Zoho catalogs typically lack 200ml SKUs) so the largest prices align to the largest sizes; the dropped small prices go to `unmatched` with a reason (`:1750-1756`).
- **Keyword-overlap fallback** (`:1640-1696`): when the abbrev index yields no family, a strict scan requiring ≥60% of distinguishing keywords to hit, category-gated, base-variant-gated, with a "clear winner must beat runner-up by ≥1" rule (`:1688-1694`). Rows matched this way are flagged `_fuzzy`.
- **Size-tier equivalence (900ml↔1L etc.)** lives in `dpl-catalog.js` `normalizeSizeTier` (`:18-40`): ml `800–1050 → '1L'`; litres `0.8–1.05 → '1L'`, plus `4L↔3.6L`, `10L↔9L`, `20L↔18L`; **200ml is its own tier**. `SIZE_CODE = { '1L':'01', '4L':'04', '10L':'10', '20L':'20' }` (`:71`). Matching is by **tier**, so a DPL off-size (e.g. White 3.6L → tier 4L) links to the Zoho 4L SKU (`:186-187`).

#### 8.5.4 Propose — `computeProposedFields` / `buildBirlaName` (`:1005-1056`, `:1303-1323`)

`computeProposedFields` returns `{ proposed_rate, proposed_name, proposed_sku, proposed_description, current_* }`. **The Zoho SKU is preserved verbatim** (`proposedSku = currentSku.toUpperCase()`, `:1027-1029`) — auto-deriving SKUs from prefix+packCode broke ml-pack SKUs and was reverted.

`buildBirlaName({ sku, pdfProduct, category, packFormatted })` (`:1303-1323`) assembles **`{SKU} {body} BIRLA OPUS {pack}`**. Birla Opus naming rules (also in user memory `feedback_birla_opus_naming_rules`):
- **ALL CAPS**, brand always literally **`BIRLA OPUS`** (`:1306`).
- **Enamel category** (`isEnamelCategory`): body = `{product} ENAMEL {color}` — the **color is kept** (`:1309-1314`).
- **Emulsion / default**: body = product name with the **emulsion variant stripped** (`extractEmulsionProductName`, `:1316-1318`).
- **Duplicate SKU prefix stripped** from the body via `stripDuplicateSkuPrefix` (`:1311,1318`).
- Whitespace runs collapsed (`:1322`).

#### 8.5.5 Catalog mediator — `services/dpl-catalog.js`

Replaces fuzzy on-every-run matching with a **persistent `dpl_catalog`** keyed by `match_key = slug(brand)|product_code|slug(base_name)|slug(size_tier)` (`buildMatchKey`, `:55-59`).
- `buildCatalogFromDpl` (`:270-330`): normalizes rows, computes `current_rate` via the formula (`:285`), links to Zoho (`linkEntryToZoho`), and for linked entries computes canonical name/sku/desc by reusing `computeProposedFields` (`:299-311`). **Preserves prior user decisions** — entries with `link_reason='user-confirmed'` or a non-null `pushed_at` are carried over as `confirmed/100` so a rebuild never silently reverts (`:313-326`).
- `applyDplPrices` (`:334-366`): re-keys a fresh DPL upload to the existing pinned catalog (no fuzzy matching), computing `old_dpl/old_rate` vs `new_dpl/new_rate` deltas; returns `{ updated, newNeedsLinking, noDplThisTime }`.
- `buildPushChanges(entry, zohoCurrent)` (`:373-388`): builds the per-item push payload. **Prices always pushed** (`cf_dpl: dpl, purchase_rate: dpl, rate`); name/sku/description/category pushed **only when canonical is non-empty AND differs** from current Zoho (avoids needless writes + SKU-collision churn). Returns `null` if no DPL.

#### 8.5.6 Zoho-first reconciliation flow

The newer UI (admin-dpl.html "Zoho-first" tab, shipped to prod 2026-06-07, HEAD `2c5e56c`) presents **one row per active Zoho item**, auto-proposes a DPL match, and supports ✓Accept / ✏Edit / ⬆Push / 🔄Re-pick. Unmatched Zoho items get a **disposition** (`dpl_disposition` column: ✅Done = manual-DPL→push→mark / 🕒Later / ↩Reopen) so the reconciliation is exhaustive. The push goes through the bulk-edit handler in `routes/zoho.js` (deferred SKU mirror — see 8.6).

---

### 8.6 Zoho sync correctness rule — `cf_*` MUST be wrapped

**Zoho Books silently ignores top-level custom-field keys.** Any `cf_*` key (e.g. `cf_dpl`) must be sent inside `custom_fields: [{ api_name, value }]` or the write is dropped with no error. Both `services/zoho-api.js` write paths handle this transparently:

- **`updateItem(itemId, data)`** (`:1690-1705`): collects all `cf_*` keys, merges them into any existing `payload.custom_fields` (de-duplicating by `api_name` via a `Map`), deletes the top-level keys, then `apiPut`s (`:1693-1704`).
- **`createItem(data)`** (`:1666-1681`): identical wrapping logic before `apiPost`.

Evidence of why this matters historically: `MEMORY.md` "Zoho Items DPL Fixes (Apr 14)" — `cf_dpl` pushes were **silently ignored** until `updateItem` was taught to wrap `cf_*`.

**Deferred SKU mirror (related correctness rule):** in the bulk-update worker (`processBulkJob`, `:1782-1814`), `zoho_items_map.zoho_sku` is written **only after Zoho confirms** the update (`:1806-1811`). Writing the SKU optimistically (before confirmation) previously caused "duplicate-SKU corruption" — a partial bulk job left multiple local rows sharing one SKU, which the DPL proposer then re-pushed and Zoho rejected with "error 1001". Keep SKU mirroring post-confirm.

---

### 8.7 Cross-cutting money invariants (quick reference)

| Invariant | Where | Rule |
|---|---|---|
| Line rounds to ₹10 **once** | `estimates.js:98-101` | `lineTotal = ceil(finalPrice×qty/10)×10`; `unitPrice = lineTotal/qty` |
| GST inclusive → `gst_amount=0` | `estimates.js:132` | Do NOT add 18%; PDF "GST" label cosmetic (owner-confirmed) |
| Estimate↔Zoho ~₹1 drift | `billing-zoho-service.js:140-144` | Accepted; Zoho is system-of-record |
| DPL rate | `price-list-parser.js:1007`, `dpl-catalog.js:285/343/742`, `item-master.js:46` | `ceil(dpl × 1.18 × 1.10)` (= `ceil(dpl × 1.298)`) |
| Painter tiers | `migrate-painter-retention.js:42-45` | bronze 0 / silver 5K / gold 25K / diamond 100K; mult 1.0/1.2/1.5/2.0; **no platinum** |
| Points dedup | `painter-points-engine.js:164-173` | `EST-{id}` invoice key + `UNIQUE(painter_id,invoice_id,attribution_type)` |
| Salary net | `migrate-staff-incentives.js:80-82` | `net_salary` is a STORED GENERATED column; never hand-computed in JS |
| Zoho custom fields | `zoho-api.js:1690-1705` | wrap `cf_*` into `custom_fields:[{api_name,value}]` |

**Known defects (NOT yet decided/fixed):** daily-bonus uses server-local date despite "IST" comment (`painter-points-engine.js:234-236`); annual withdrawal window unenforced (`:476-481`); salary `/260` vs `standard_daily_hours` basis mismatch (`salary.js:532` vs `:610,614`); Sunday OT 2×-then-multiplier overpay (`salary.js:552-553,593`). The two estimate items (gst=0, NIT-1 drift) are **decided, not defects** — see 8.2.

---

## 9. External Integrations

This platform talks to seven external systems plus several local generation libraries. Every integration follows the same wiring convention: a service module in `services/`, initialized once in `server.js` via `setPool(pool)` (and sometimes `setIO(io)`), with credentials read from `process.env` (loaded from `.env`, which is gitignored). **All Zoho-coupled background work and WhatsApp processing only start if `ZOHO_ORGANIZATION_ID` is set** (`server.js:4298`); otherwise the server logs `Zoho not configured ... sync/whatsapp skipped` (`server.js:4322`) and runs as a bare web app.

### 9.0 Integration map (at a glance)

| System | Direction | Primary service file(s) | Transport | Gated by `ZOHO_ORGANIZATION_ID`? |
|--------|-----------|-------------------------|-----------|----------------------------------|
| Zoho Books (invoices/items/contacts/payments) | Bidirectional | `services/zoho-api.js`, `services/zoho-oauth.js`, `services/zoho-rate-limiter.js` | HTTPS REST (`zohoapis.in`) | Schedulers yes; ad-hoc calls no |
| Zoho Books billing push / invoice-line pull | Outbound + inbound | `services/billing-zoho-service.js`, `services/zoho-invoice-line-sync.js` | via `zoho-api.js` | — |
| Painter → Zoho customer/salesperson | Outbound | `services/painter-zoho-sync-service.js` | via `zoho-api.js` | — |
| Zoho Payments (payment links / split settlement) | Outbound | `services/zoho-payments-service.js` | HTTPS REST (`payments.zoho.in`) | No (separate OAuth) |
| WhatsApp (whatsapp-web.js) | Bidirectional | `services/whatsapp-session-manager.js`, `services/whatsapp-processor.js`, `services/wa-campaign-engine.js` | Headless Chromium / WhatsApp Web | Yes (`server.js:4302-4304`) |
| AI providers (Gemini / Claude / Clawdbot-Kai) | Outbound | `services/ai-engine.js` | HTTPS + local CLI helper | No (but AI scheduler is gated) |
| Firebase Cloud Messaging | Outbound | `services/fcm-admin.js`, `services/notification-service.js` | firebase-admin SDK (FCM v1) | No |
| Email (SMTP) / SMS (Nettyfish) / Web Push (VAPID) | Outbound | `services/email-service.js`, `services/sms-service.js`, `services/notification-service.js` | nodemailer / HTTPS / web-push | No |
| Telegram APK delivery bot | Outbound (operational, not app runtime) | none in repo | Telegram Bot API | N/A |

---

### 9.1 Zoho Books (CRM + Books)

Zoho is the system of record for invoicing, items, contacts and payments. The integration is anchored on the **India datacenter** (`.in` domains, hardcoded — see gotchas).

**OAuth refresh-token flow — `services/zoho-oauth.js`**
- Endpoints hardcoded: `ZOHO_ACCOUNTS_URL = 'https://accounts.zoho.in'`, token path `/oauth/v2/token` (`zoho-oauth.js:22-23`). Uses native `https` (no axios).
- `getAccessToken()` (`zoho-oauth.js:36`) is the single method every other Zoho service calls. It reads the cached token from the `zoho_oauth_tokens` table keyed by `organization_id`; if it expires within 5 minutes it auto-refreshes (`zoho-oauth.js:54-60`). Tokens are stored with a **55-minute safety expiry** (`expires_in - 300`, `zoho-oauth.js:104`).
- First-run bootstrap: if no row exists, it generates an access token from `ZOHO_REFRESH_TOKEN` in `.env` (`zoho-oauth.js:64-70`).
- Other exports: `generateTokenFromCode(authCode)` (initial setup from authorization code), `getAuthorizationUrl()` (scope `ZohoBooks.fullaccess.all`, `access_type=offline`, `prompt=consent`), `getTokenStatus()` (admin dashboard), `revokeToken()` (`zoho-oauth.js:201-279`).
- **Env vars:** `ZOHO_ORGANIZATION_ID`, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_REDIRECT_URI` (defaults to `https://act.qcpaintshop.com/oauth/callback`).

**Rate limiter + usage tracker — `services/zoho-rate-limiter.js`** (singleton, `module.exports = new ZohoRateLimiter()`)
- Token-bucket limiter: **80 req/min** safe ceiling against Zoho's 100/min wall (`zoho-rate-limiter.js:20`).
- Daily quota tracking against Zoho's **10,000 calls/org/day**, with a **500-call reserve** for high-priority/manual ops (`dailyReserve`, `zoho-rate-limiter.js:36`). High-priority callers can dip into the reserve (`acquire(caller, { priority: 'high' })`, `:289`).
- **Circuit breaker** at 9,000 calls (90%) suppresses non-critical operations (`isCircuitOpen()`, `:325`). Alert thresholds at 80/90/95% (`:55`).
- Daily count is **persisted to the `zoho_config` table** (keys `api_daily_count`, `api_daily_date`, `api_daily_callers`) so it survives restarts (`_persistDailyToDB`, `:237`). Date math uses IST (`Asia/Kolkata`) to match Zoho's datacenter (`_todayStr`, `:74`).
- **Sync lock** (`tryAcquireSyncLock`/`releaseSyncLock`, `:336-361`) prevents two heavy syncs overlapping; stale locks auto-release after 30 minutes.
- Powers the API Usage Monitor via `getUsageStats()` / `getStatus()`.

**Main API client — `services/zoho-api.js`** (~2,560 lines)
- Base: `API_BASE = 'https://www.zohoapis.in/books/v3'` (`zoho-api.js:21`). All calls route through internal `apiGet/apiPost/apiPut/apiDelete`, which call `rateLimiter.acquire()` first (so 100% of calls are tracked) and inject `Authorization: Zoho-oauthtoken <token>` from `zohoOAuth.getAccessToken()`. Every request appends `organization_id` from `process.env.ZOHO_ORGANIZATION_ID`.
- Surface (from `module.exports`, `zoho-api.js:2498`): **Invoices** (`getInvoices/getInvoice/createInvoice/getOverdueInvoices/getUnpaidInvoices`), **Payments** (`getPayments/getPayment/createPayment`), **Contacts** (`getContacts/getContact/createContact/updateContact/createSalesperson/listSalespersons/getCustomerBalance`), **Items** (`getItems/getItem/createItem/updateItem`), **Reports** (P&L, balance sheet, sales-by-customer/item, receivables, aging), **Sync** (`syncInvoices/syncCustomers/syncPayments/syncItems/syncLocations/syncLocationStock/fullSync/quickSync`), **Dashboard/Locations/Bulk-Updates/Daily-Transactions/Reorder-Alerts**.
- **Custom-field gotcha (critical, §6 of CLAUDE.md):** `createItem`/`updateItem` (`zoho-api.js:1666`, `:1690`) auto-transform any top-level `cf_*` key into Zoho's required `custom_fields: [{ api_name, value }]` envelope and de-dupe by `api_name` (`:1672-1699`). Code that pushes DPL pricing sets `cf_dpl` / `cf_product_name` and relies on this wrapping — sending `cf_*` raw would be silently ignored by Zoho.
- Sync de-dup note: Zoho's `GET /items` list endpoint omits `custom_fields`, so `syncItems` uses `COALESCE` to avoid clobbering previously-pushed cf values (`zoho-api.js:1389-1392`).

**Billing push — `services/billing-zoho-service.js`** (`exports: setPool, setPointsEngine, resolveZohoContact, pushInvoiceToZoho`)
- `resolveZohoContact(customerType, {...})` resolves or lazily creates a Zoho contact for a `'painter'` or `'customer'`, caching `zoho_contact_id` back into `painters` / `zoho_customers_map` (`billing-zoho-service.js:26-60`).
- `pushInvoiceToZoho(...)` is the billing-module path that builds the Zoho invoice and (via the injected points engine) awards painter loyalty points on confirmed payment.

**Invoice-line sync — `services/zoho-invoice-line-sync.js`** (Reorder Intelligence, Task 4)
- Pulls Zoho invoice line items and aggregates them into `branch_item_sales` keyed by `(branch × item × date)` (`aggregateLineItems`, `:44`). `computeSyncWindow` defaults to a 90-day window; a cursor table de-dups already-synced invoices (`:33-37`).

**Painter → Zoho sync — `services/painter-zoho-sync-service.js`** (`exports: init, syncPainterToZoho, retryQueue, _computeNextRetry`)
- `init({ pool, zohoApi })` dependency-injects the Zoho client. `syncPainterToZoho(painterId)` creates a Zoho **customer** (name pattern `PNTR <branchCode> <full_name>`, `:60`) and a matching **salesperson**, linking back to `painters.zoho_customer_id` / `zoho_salesperson_id`; skips if already synced (`:33-35`). It first tries to link an existing `PNTR`-tagged contact by phone before creating (`:48-57`).
- Failures are queued in `painter_zoho_sync_queue` with exponential backoff (1h → 4h → 12h → 24h, `_computeNextRetry`, `:10-13`), retried by `retryQueue`.

**Zoho Payments / split settlement — `services/zoho-payments-service.js`** (`exports: createPaymentLink, getPaymentLinkStatus`)
- **Separate OAuth and host** from Books: `BASE = 'https://payments.zoho.in/api/v1'`, token URL `https://accounts.zoho.in/oauth/v2/token` (`zoho-payments-service.js:3-4`). It does its own in-memory token cache + 401-triggered refresh (`_refreshToken`, `_call` retry at `:73`).
- `createPaymentLink({ amount, description, customer, expiryHours=48 })` POSTs `/accounts/<id>/paymentlinks` with INR currency and an IST `+05:30` expiry timestamp (`:81-101`). `getPaymentLinkStatus(link_id)` polls payment status.
- **Env vars (distinct prefix):** `ZOHO_PAYMENTS_ACCESS_TOKEN`, `ZOHO_PAYMENTS_CLIENT_ID`, `ZOHO_PAYMENTS_CLIENT_SECRET`, `ZOHO_PAYMENTS_REFRESH_TOKEN`, `ZOHO_PAYMENTS_ACCOUNT_ID`. Throws "Zoho Payments not configured" if account-id/refresh-token are unset (`:82-83`).

**Zoho gotchas**
- **`.in` datacenter is hardcoded** in three places (`zoho-oauth.js`, `zoho-api.js`, `zoho-payments-service.js`) — not env-driven.
- Schedulers (`syncScheduler`, `aiScheduler`, `painterScheduler`, etc.) only start when `ZOHO_ORGANIZATION_ID` is set (`server.js:4298-4320`).
- The legacy UPI flow (see §9.8) bypasses Zoho Payments entirely with a hardcoded UPI id.

---

### 9.2 WhatsApp (whatsapp-web.js)

WhatsApp uses **whatsapp-web.js v1.26.1** (`package.json:53`), an unofficial library driving a headless WhatsApp Web session via Chromium — there is **no official WhatsApp Business API**. The dependency is treated as optional: each service guards the `require` so the server still boots without it.

**Session manager — `services/whatsapp-session-manager.js`** (`setPool`, `setIO`, `initializeSessions`, `connectBranch`, …)
- **Multi-session, per-branch.** A `Map` keyed by `branch_id` holds `{ client, status, qr, phoneNumber }` (`:50-51`). Two sentinel ids: `GENERAL_ID = 0` (company-wide) and `ADMIN_SESSION_ID = -1` (admin's personal WhatsApp) (`:31-32`).
- **QR login:** `connectBranch(branchId, userId)` spins up a `Client` with `LocalAuth`, persists status to DB (`connecting → qr_pending → connected`), and emits the QR over Socket.IO for the admin to scan. Session auth lives on disk under `whatsapp-sessions/session-<label>/`; stale Chromium lock files (`SingletonLock/Cookie/Socket`) are cleaned on connect to survive PM2 SIGKILL restarts (`:86-90`).
- `require('whatsapp-web.js')` is wrapped in try/catch: if missing, session management is disabled with a warn (`:20-29`).

**Inbound + outbound processor — `services/whatsapp-processor.js`** (`setPool`, `setSessionManager`, `setAutomationRegistry`, `start`)
- Cron-driven queue worker (node-cron) that drains `whatsapp_followups` every 5 minutes, **batch size 10**, **max 3 retries** (`:32-33`). Dual-mode delivery: per-branch whatsapp-web.js session if connected, else an HTTP API fallback (`:6-7`). Built-in message templates (e.g. `payment_reminder`, `:49`). Cluster-safe via `isClusterPrimary()` (`:23`).

**Campaign engine — `services/wa-campaign-engine.js`** (`setPool`, `setIO`, `setSessionManager`, `start`)
- Background singleton executing marketing blasts using a `setTimeout` chain (not cron) for precise inter-message delays. **Anti-block features:** spin-text `[Hi|Hello|Hey]`, variable substitution (`{name}`, `{company}`, `{city}`), zero-width invisible markers for message uniqueness, hourly/daily caps via `wa_sending_stats`, a 5-day warm-up ramp, randomized delays, and auto-pause on consecutive failures (`:6-16`). Settings load from the `wa_marketing_settings` table (`loadSettings`, `:38`). Emits `wa_campaign_*` events to the `wa_marketing_admin` Socket.IO room.

**Admin module pages** (standalone WhatsApp module in the sidebar): `public/admin-wa-dashboard.html`, `admin-wa-contacts.html`, `admin-wa-marketing.html`, `admin-wa-templates.html`, `admin-wa-settings.html`, `admin-wa-admin-login.html`, plus the chat/sessions pair `admin-whatsapp-chat.html` and `admin-whatsapp-sessions.html`.

**WhatsApp gotchas**
- Started only under the `ZOHO_ORGANIZATION_ID` gate (`server.js:4302-4304`) — on a Zoho-less env, WhatsApp processing/sessions/campaigns never run.
- All three services are cluster-guarded so only the PM2 primary processes the queue.
- Per project memory: WhatsApp Tamil templates must **never use the greeting "வணக்கம்"**; the AI chat prompt enforces this too (`ai-engine.js:142-144`).

---

### 9.3 AI providers (triple: Gemini / Claude / Clawdbot-Kai)

**`services/ai-engine.js`** is a provider-abstraction layer exposing `generate`, `streamToResponse`, `generateWithFailover`, `streamWithFailover`, `getSystemPrompt`, `getChatSystemPrompt`, `getConfig`, `clearConfigCache` (`:651-661`).

| Provider | Transport | Default model | Base / mechanism |
|----------|-----------|---------------|------------------|
| **Gemini** | HTTPS | `gemini-2.0-flash` (`:21`) | `generativelanguage.googleapis.com` (`:20`) |
| **Claude** | HTTPS | `claude-sonnet-4-20250514` (`:24`) | `api.anthropic.com`, anthropic-version `2023-06-01` (`:23-25`) |
| **Clawdbot (Kai)** | Local CLI helper | controlled externally (Sonnet 4.5) | `node scripts/clawdbot-call.mjs <tmpfile>` over the gateway WebSocket (`:482-491`) |

- **Config-driven, DB-first.** `getConfig()` reads the **`ai_config`** table (`config_key`/`config_value`), cached 30s (`:154-169`). Keys observed: `primary_provider`, `fallback_provider`, `max_tokens_per_request`, `temperature`, `gemini_api_key`, `anthropic_api_key`, `gemini_model`, `claude_model`, and per-provider enable flags `gemini_enabled` / `claude_enabled` / `clawdbot_enabled`.
- **API keys:** `getApiKey()` prefers `ai_config` then falls back to env — `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` (`:182-187`). Gemini model can also come from `AI_GEMINI_MODEL` (`:207`).
- **Provider gating:** `isProviderEnabled(p)` treats a provider as enabled unless its flag is explicitly `'false'`/`'0'` (`:195-199`). Per project memory, **Clawdbot/Kai is currently the sole active provider** (Gemini and Claude disabled via `*_enabled` flags); the default config when DB is unreachable hardcodes `primary_provider: 'clawdbot'` (`:158`, `:167`).
- **Clawdbot specifics:** the prompt is written to a temp file (kernel `ARG_MAX` workaround) and passed to `scripts/clawdbot-call.mjs`, which talks to the local clawdbot gateway WebSocket; 300s timeout, 5 MB max buffer (`:487-491`). **No per-call model parameter** — the model is set in clawdbot's global config (`~/.clawdbot/clawdbot.json`, currently `anthropic/claude-sonnet-4-5`, `:516-517`). Clawdbot has no real streaming, so `clawdbotStreamToResponse` simulates SSE by emitting ~100-char chunks (`:533-547`). Result parsing reads `json.result.payloads[0].text` and usage/model from `agentMeta` (`:503-507`).
- **Failover:** `generateWithFailover` builds an ordered chain `primary → fallback → remaining`, de-dups, drops disabled providers, and tries each until one succeeds (`:579-610`). Throws "No AI providers enabled" if `ai_config` flags disable everything.
- **System prompts:** `BUSINESS_SYSTEM_PROMPT` (insights JSON shape) and `CHAT_SYSTEM_PROMPT` (the "QC Manager" persona, explicitly **READ-ONLY** — must not claim it executed DB/WhatsApp writes, `:120-131`). `getChatSystemPrompt(extraContext)` appends live business context (`:647-649`).
- Three AI providers (Gemini/Claude/SMTP) are also surfaced in `services/system-health-service.js` health checks (`:257-276`).

---

### 9.4 Firebase Cloud Messaging (push)

**`services/fcm-admin.js`** — thin wrapper over **firebase-admin v13** (`package.json:38`) using the **FCM HTTP v1 API** (the legacy `fcm.googleapis.com/fcm/send` was shut down by Google June 2025, `:4-6`).
- **Self-initializes on require** from a service-account JSON at `FIREBASE_SERVICE_ACCOUNT_PATH`; if unset, logs a warn and disables push (`:21-26`). Credentials via `admin.credential.cert(serviceAccount)` (`:32-34`).
- `sendToDevice(token, { title, body, data, ttlSeconds })` — single send; **detects stale tokens** (`registration-token-not-registered` / `invalid-registration-token` / `invalid-argument`) and returns `{ invalidToken: true }` so callers can delete them (`:88-96`). Android channel `qc_notifications`, high priority.
- `sendToDevices(tokens, { title, body, imageUrl, type, offerUrl })` — multicast up to **500 tokens** via `sendEachForMulticast`; returns `invalidTokens[]` for cleanup; admin channel `qc_admin_channel` (`:116-171`).
- `isInitialized()` exported for health checks.

**Token storage gotcha:** painter device tokens live in `painter_fcm_tokens`, and the column **must** be named `fcm_token` (`routes/painters.js:2771-2799`); the register endpoint rejects requests missing `fcm_token`. (Staff/admin tokens are stored separately.)

**`services/notification-service.js`** is the orchestrator — `send(userId, {...})` (1) inserts into the `notifications` table, (2) emits a `notification` event to the `user_<id>` Socket.IO room, then (3) fans out to **Web Push + FCM** asynchronously (`:35-55`). Deep-link routing for 30+ notification types is handled here / on the client.

---

### 9.5 Email — SMTP (nodemailer)

**`services/email-service.js`** — branded transactional email via **nodemailer v8** (`package.json:44`). `send(to, subject, bodyHtml, attachments)`; no-ops if `SMTP_HOST` is unset (`:13`, `:43-45`).
- **Env vars:** `SMTP_HOST`, `SMTP_PORT` (default 587), `SMTP_SECURE` (`true` → TLS, also auto-on for port 465), `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM_NAME` (default "Quality Colours"), `MAIL_FROM` (falls back to `SMTP_USER`).
- Gotcha: when `SMTP_USER` is unset (local sendmail loopback) the auth block is dropped entirely to avoid nodemailer's "Missing credentials" CRAM-MD5 failure (`:14-25`); TLS `rejectUnauthorized: false`.

### 9.6 SMS — Nettyfish RetailSMS

**`services/sms-service.js`** — single `sendSms({ number, text, label })` to the **Nettyfish RetailSMS** gateway (`retailsms.nettyfish.com` POST `/api/mt/SendSMS`, `:19-20`). Always POSTs (creds in the body, never query string, to keep them out of logs — `:1-13`). No-op if `SMS_USER`/`SMS_PASSWORD` missing (`:33-37`).
- **Env vars:** `SMS_USER`, `SMS_PASSWORD`, `SMS_SENDER_ID` (default `QUALTQ`). Sends transactional route (`channel: 'Trans'`, `route: '4'`); message text must match a **DLT-approved template** (Indian TRAI requirement). Used for customer/painter OTP.

### 9.7 Web Push (browser, VAPID)

Configured inside `services/notification-service.js` (`:21-28`): `webPush.setVapidDetails(mailto:..., VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)` — **web-push v3.6.7** (`package.json:52`). Only activates when both VAPID keys are present.
- **Env vars:** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL` (default `info@qcpaintshop.com`). The public key is also exposed to the frontend for subscription.

---

### 9.8 PDF / QR / image generation (local libraries)

Not network integrations but the document-generation backbone. From `package.json`:

| Library | Version | Use |
|---------|---------|-----|
| **pdfkit** | `^0.17.2` | Estimate / receipt / salary / reorder / painter-card PDFs (green/gold branded) |
| **puppeteer-core** | `^24.39.1` | HTML→PDF rendering where pdfkit is insufficient |
| **qrcode** | `^1.5.4` | UPI payment QR codes on estimates/receipts |
| **sharp** | `^0.34.5` | Painter visiting/ID card + brand placeholder image generation (`services/painter-card-generator.js`, uses `APP_ORIGIN`) |

**Hardcoded UPI gotcha (config debt, §10 of CLAUDE.md):** the UPI id **`7418831122@superyes`** ("Quality Colours") is hardcoded in `routes/estimates.js:383` and `:450` (and `routes/share.js`, `public/estimate-print.html`) to build `upi://pay?pa=7418831122@superyes...` links/QRs. This is a static merchant UPI, **independent of the Zoho Payments integration (§9.1)** and should be moved to config.

### 9.9 Telegram APK delivery bot (operational, not app runtime)

Per CLAUDE.md / project memory, built Android APKs are auto-delivered to the user via the Telegram bot **`@qualitycoloursbot`**, chat id **930726256**. This is a developer-workflow integration used during Android release testing — there is **no Telegram client code in this repo's runtime** (`grep` for the bot/chat id matches only `.gitignore`, `Skills.md`, and `LAUNCH-BLOCKERS.md`, never `services/` or `routes/`). It is invoked from the Android build tooling, not the Express server.

---

### 9.10 Full integration env-var reference

| Group | Variables |
|-------|-----------|
| Zoho Books | `ZOHO_ORGANIZATION_ID`, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_REDIRECT_URI` |
| Zoho Payments | `ZOHO_PAYMENTS_ACCESS_TOKEN`, `ZOHO_PAYMENTS_CLIENT_ID`, `ZOHO_PAYMENTS_CLIENT_SECRET`, `ZOHO_PAYMENTS_REFRESH_TOKEN`, `ZOHO_PAYMENTS_ACCOUNT_ID` |
| AI | `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, `AI_GEMINI_MODEL` (most AI config lives in the `ai_config` DB table, not env) |
| FCM | `FIREBASE_SERVICE_ACCOUNT_PATH` (path to service-account JSON) |
| Email (SMTP) | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM_NAME`, `MAIL_FROM` |
| SMS (Nettyfish) | `SMS_USER`, `SMS_PASSWORD`, `SMS_SENDER_ID` |
| Web Push | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL` |
| App/runtime (referenced by integrations) | `APP_ORIGIN`, `APP_BASE_URL` / `APP_PUBLIC_URL`, `CORS_ORIGIN`, `NODE_ENV`, `PORT` |

All secrets are kept in `.env` (gitignored, verified not in git history per CLAUDE.md §8.5). WhatsApp has no API key — its "credential" is the on-disk session under `whatsapp-sessions/`. Clawdbot/Kai has no env key — it authenticates through the local gateway config `~/.clawdbot/clawdbot.json`. The Telegram bot token is stored outside this repo (project memory), not in `.env`.

---

## 10. Background Jobs, Schedulers & Crons

> **CRITICAL — the master gate.** All Zoho-dependent schedulers are started inside a single `if (process.env.ZOHO_ORGANIZATION_ID) { ... }` block at `server.js:4298`. **If `ZOHO_ORGANIZATION_ID` is unset, these jobs are silently never registered** — the server logs `Zoho not configured (ZOHO_ORGANIZATION_ID missing) - sync/whatsapp skipped` (`server.js:4322`) and continues running. This is the single most common reason a job "doesn't run". The jobs in this gated block are: `sync-scheduler`, `whatsapp-processor`, `whatsapp-session-manager`, `wa-campaign-engine`, `ai-scheduler`, `painter-scheduler` (which in turn registers `painter-marketing-scheduler`), `data-retention-service`, `lead-auto-assign-scheduler`, `system-health` auto-checks, `production-monitor`, photo-cleanup cron, and the anomaly-detection `setInterval` (`server.js:4299-4320`).
>
> **NOT gated** (always started, even without Zoho): `autoClockout.start()` and `attendanceReport.start()` (`server.js:4167-4168`), the 60-second geofence-enforcement `setInterval` (`server.js:4172`, registered just before the gate), the `lead-reminder-scheduler` cron (registered at module init via `leadReminderScheduler.init()`, `server.js:338`), and the `activity-feed` cleanup cron (registered at `require()` time as a top-level statement, `services/activity-feed.js:173-176`).

**Implementation notes**
- Library: **`node-cron`**. Almost every `cron.schedule(...)` call passes `{ timezone: 'Asia/Kolkata' }`, so cron expressions are interpreted in IST regardless of the server's clock.
- `setInterval`/`setTimeout`-based loops (production-monitor, system-health, photo-cleanup, geofence, anomaly, wa-campaign-engine, auto-clockout 5-min checks) have **no timezone wrapper**; where IST is needed they compute it manually as `Date.now() + 5.5*60*60*1000` (e.g. `routes/photos.js:220`, `server.js:4175`).
- **Cluster-primary guard:** `services/cluster-guard.js` exports `isClusterPrimary()` → true when `NODE_APP_INSTANCE` is `undefined`/`''`/`'0'`. Several `start()` functions early-return if not primary (auto-clockout, attendance-report, ai-scheduler, painter-scheduler, data-retention, production-monitor, wa-campaign-engine). Today the app runs as a single process so this is always true; the guard exists so a future `pm2 ... --instances N` won't double-fire FCM/WhatsApp/points.
- `painter-marketing-scheduler` is **not** referenced from `server.js` — it is wired only via `painterScheduler.registerCron(...)` at `services/painter-scheduler.js:341`, so it inherits both the Zoho gate and the painter-scheduler lifecycle.

### Cron-based jobs (node-cron, all `Asia/Kolkata`)

| Job | File | Schedule (IST) — cron | What it does | Outputs |
|---|---|---|---|---|
| Zoho quick sync | `services/sync-scheduler.js:464` | configurable, default every 60 min (`*/60 * * * *`; from `sync_interval_minutes`) | Sync customers/invoices/payments from Zoho (no stock) | DB tables |
| Daily financial report | `services/sync-scheduler.js:485` | `daily_report_time` default 09:00, **only if `daily_report_enabled=true` (default false)** | Auto P&L + receivables report | WhatsApp/dashboard |
| Zoho stock sync | `services/sync-scheduler.js:511` | `0 2,6,12,18 * * *` (off-peak, default 4h); `0 3,9,15,21` if 6h interval | Heavy stock-level sync from Zoho | DB |
| Bulk job processor | `services/sync-scheduler.js:520` | `*/5 * * * *` (every 5 min) | Process pending Zoho bulk import/export jobs | DB |
| Invoice line-item sync | `services/sync-scheduler.js:527` | `0 2 * * *` (02:00) | Pull Zoho invoice lines into `branch_item_sales` (feeds reorder) | DB |
| **Reorder level compute** | `services/sync-scheduler.js:534` → `reorder-compute-service` | `30 2 * * *` (02:30) | Compute auto reorder levels from 60-day sales velocity | DB |
| **Daily reorder report** | `services/sync-scheduler.js:541` → `reorder-report-service` | `0 7 * * *` (07:00) | Generate & deliver per-branch + consolidated reorder report | WhatsApp/FCM/dashboard |
| AI Zoho daily analysis | `services/ai-scheduler.js:252` | `0 21 * * *` (21:00 / 9 PM) | Daily Zoho business analysis | dashboard + WhatsApp |
| AI staff daily analysis | `services/ai-scheduler.js:255` | `30 22 * * *` (22:30 / 10:30 PM) | Daily staff performance analysis | dashboard |
| AI lead scoring | `services/ai-scheduler.js:258` | `0 */6 * * *` (every 6h) | Score/rank all leads | `ai_lead_scores`, dashboard |
| AI Zoho weekly | `services/ai-scheduler.js:261` | `0 8 * * 1` (Mon 08:00) | Weekly Zoho trend analysis | dashboard |
| AI marketing tips | `services/ai-scheduler.js:264` | `0 9 * * 1` (Mon 09:00) | Weekly marketing insights | WhatsApp + dashboard |
| **Staff daily Tamil tasks** | `services/ai-scheduler.js:267` → `services/staff-task-generator.js` (`generateForAllStaff`) | `0 9 * * *` (09:00) | Generate personalized Tamil daily tasks per staff via Clawdbot (skips if `staff_daily_tasks_enabled != '1'`) | DB, staff dashboard |
| AI daily snapshots ×3 | `services/ai-scheduler.js:270-272` | `0 6`, `0 12`, `0 18 * * *` (06:00 / 12:00 / 18:00) | Capture daily business-data snapshot (skips if `daily_snapshot_enabled != '1'`) | DB context |
| Painter monthly slabs | `services/painter-scheduler.js:308` | `0 6 1 * *` (1st, 06:00) | Monthly incentive-slab evaluation | DB, FCM |
| Painter quarterly slabs | `services/painter-scheduler.js:309` | `30 6 1 1,4,7,10 *` (Jan/Apr/Jul/Oct 1st, 06:30) | Quarterly slab evaluation | DB, FCM |
| Painter credit-overdue check | `services/painter-scheduler.js:310` | `0 8 * * *` (08:00) | Daily painter credit-overdue check | FCM/notifications |
| Painter streak reset | `services/painter-scheduler.js:313` | `0 0 * * *` (midnight) | Reset streaks for inactive painters | DB |
| Painter bonus rotation | `services/painter-scheduler.js:314` | `5 0 * * *` (00:05) | Rotate daily-bonus product | DB |
| Painter daily-bonus push | `services/painter-scheduler.js:315` | `0 7 * * *` (07:00) | Push today's bonus-product notification | FCM |
| Painter streak reminder | `services/painter-scheduler.js:316` | `0 20 * * *` (20:00) | Streak-at-risk reminder | FCM |
| Painter attendance: open claim | `services/painter-scheduler.js:319` | `5 0 1 * *` (1st, 00:05) | Open monthly attendance-AP claim window | DB |
| Painter attendance: recompute | `services/painter-scheduler.js:320` | `0 */6 1-7 * *` (every 6h, days 1–7) | Recompute claimable AP during window | DB |
| Painter attendance: remind | `services/painter-scheduler.js:321` | `0 20 7 * *` (7th, 20:00) | Day-before reminder for unclaimed AP | FCM |
| Painter attendance: forfeit + purge | `services/painter-scheduler.js:322` | `0 2 8 * *` (8th, 02:00) | Forfeit unclaimed AP + purge old selfie images | DB, files |
| Painter location prune | `services/painter-scheduler.js:325` | `30 2 * * *` (02:30) | Delete `painter_location_events` older than 30 days | DB |
| PNTR incremental import | `services/painter-marketing-scheduler.js:146` | `30 2 * * *` (02:30) | Incremental PNTR painter import from Zoho | DB |
| PNTR Zoho retry queue | `services/painter-marketing-scheduler.js:150` | `0 3 * * *` (03:00) | Retry failed painter→Zoho syncs | Zoho, DB |
| PNTR points backfill | `services/painter-marketing-scheduler.js:157` | `45 3 * * *` (03:45, moved off 03:30 to avoid retention purge) | Daily incremental annual-points backfill | DB |
| PNTR daily list generation | `services/painter-marketing-scheduler.js:161` | `0 6 * * *` (06:00) | Build per-staff daily painter-call lists | `painter_daily_assignments` |
| PNTR "list ready" push | `services/painter-marketing-scheduler.js:167` | `30 6 * * *` (06:30) | Notify staff today's list is ready | FCM |
| PNTR <50% reminder | `services/painter-marketing-scheduler.js:185` | `0 17 * * *` (17:00) | Remind staff under 50% complete | FCM |
| PNTR manager WA alert | `services/painter-marketing-scheduler.js:205` | `0 18 * * *` (18:00) | WhatsApp branch managers about staff under 30% | WhatsApp |
| Lead auto-assign | `services/lead-auto-assign-scheduler.js:184` | `0 8 * * *` (08:00) | Auto-assign unassigned leads to branch staff | DB, FCM |
| Lead follow-up reminders | `services/lead-reminder-scheduler.js:20` (**not Zoho-gated**) | `0 8 * * *` (08:00) | Notify staff of due/overdue lead follow-ups | FCM |
| Data-retention purge | `services/data-retention-service.js:88` | `30 3 * * *` (03:30) | Purge stale `audit_records`, `error_logs`, `staff_activity_feed`, `notifications`, `otp_verifications` | DB |
| Force clock-out all staff | `services/auto-clockout.js:641` | `59 21 * * *` (21:59 / ~10 PM) | Force clock-out every still-active staff before nightly reports | DB, FCM |
| Daily attendance report | `services/attendance-report.js:1153` (**not Zoho-gated**) | `5 22 * * *` (22:05 / 10:05 PM) | Per-staff attendance reports + admin PDF; then per-staff + admin activity reports | WhatsApp, PDF |
| Daily lead alerts | `services/attendance-report.js:1179` | `5 18 * * *` (18:05 / 6:05 PM) | Lead-creation + follow-up alerts | WhatsApp/FCM |
| Activity-feed cleanup | `services/activity-feed.js:174` (**top-level at require, ungated**) | `5 0 * * *` (00:05) | Delete old `staff_activity_feed` rows | DB |

### Interval / timer-based jobs (`setInterval` / `setTimeout`)

| Job | File | Interval | What it does | Notes |
|---|---|---|---|---|
| Geofence enforcement | `server.js:4172` | every **60 s** | (1) location-off >2 min auto-clockout, (2) geo-warning >5 min at 300m+ auto-clockout; also runs `activityTracker.checkIdleStaff()` + `checkMaxDuration()` | Always started (just before the Zoho gate); writes `staff_attendance`, sends FCM to staff + admins |
| Overtime-prompt check | `services/auto-clockout.js:632` | every **5 min** | Check for OT prompts; reentrancy-guarded | FCM |
| Geo-fence warning check | `services/auto-clockout.js:637` | every **5 min** | Server-side geo-fence auto-clockout warnings; reentrancy-guarded | FCM, DB |
| Anomaly detection scan | `server.js:4314` → `services/anomaly-detector.js` (`runFullScan`) | every **6 h** (`6*60*60*1000`) | Full anomaly scan, inserts new anomalies | DB; Zoho-gated |
| Production monitor — health check | `services/production-monitor.js:465` | every **60 s** (`checkIntervalMs`) | Main health-check loop + self-healing; first run after 10 s | Zoho-gated; cluster-primary only |
| Production monitor — event-loop lag | `services/production-monitor.js:462` | every **1 s** | Measure event-loop lag | — |
| Production monitor — snapshot persist | `services/production-monitor.js:468` | every **5 min** (`snapshotIntervalMs`) | Persist metrics snapshot | DB |
| **Self-heal DB pool test (backoff)** | `services/production-monitor.js:186` (`healDbPool`) | invoked from the 60 s check loop, but gated by backoff | Only acts after **≥3 consecutive DB failures**; skips if a failure was tested **<5 min** ago (`< 300000`, line 191) or a success was recorded **<1 min** ago (`< 60000`, line 192); then opens a fresh pool, runs `SELECT 1`, records `db_pool_test` / `db_pool_test_failed` | Matches the documented "5 min after fail / 1 min after success" backoff |
| System-health auto-checks | `services/system-health-service.js:365` (`startAutoHealthChecks`) | every **5 min** (300000, passed from `server.js:4310`) | `performHealthCheck()`; logs CRITICAL | Zoho-gated |
| Photo cleanup | `routes/photos.js:219` (`startCleanupCron`) | polls every **5 min**, fires when IST hour==2 & minute<5 (i.e. ~02:00 IST daily) | Daily photo cleanup `runCleanup()` | files; Zoho-gated (`server.js:4312`) |
| WhatsApp queue processor | `services/whatsapp-processor.js:448` | `*/5 * * * *` (cron, every 5 min) | Process the WhatsApp send queue | WhatsApp; Zoho-gated |
| WA campaign engine poll | `services/wa-campaign-engine.js:219` (`schedulePoll`) | self-rescheduling `setTimeout`, default **30 s** (`engine_poll_interval`) | Activate scheduled campaigns + drip-send running campaigns | WhatsApp; Zoho-gated, cluster-primary only |
| Zoho rate-limiter refill | `services/zoho-rate-limiter.js:309` | token-bucket refill `setInterval` | Refill Zoho API token bucket | internal throttling |

### Schedule clusters worth knowing (overlap windows)
- **Nightly DB-heavy chain (IST):** 02:00 invoice-line sync → 02:30 reorder-compute / location-prune / PNTR-import → 03:00 PNTR retry → 03:30 data-retention purge → 03:45 PNTR backfill (deliberately offset off 03:30). The 02:00 stock-sync also lands in this window.
- **08:00 IST contention:** lead auto-assign, lead follow-up reminders, and painter credit-overdue check all fire at `0 8 * * *`.
- **00:05 IST:** painter streak reset (00:00) → bonus rotation + activity-feed cleanup + monthly attendance open-claim (00:05).
- **Evening reports:** 18:05 lead alerts, 21:59 force clock-out, 22:05 attendance/activity reports, 22:30 AI staff analysis — staged so clock-out precedes the reports.

---

## 11. Android Apps, Deployment & Operations

This section covers the operational and mobile context. Much of it lives outside this repo's runtime code — in `CLAUDE.md`, the per-project memory notes, the sibling Android repo, and the sibling `google-services/` tooling directory. Each fact below is labeled by source: **[code]** = verified by opening a file in this or a sibling repo; **[CLAUDE.md]** = from the checked-in project guide; **[memory]** = from the user's auto-memory notes (which may lag the actual repo state).

### 11.1 Repository layout (three sibling directories)

The web app and the mobile/publishing assets live in **separate directories under a common parent** `D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\` **[code — verified by directory listing]**:

| Directory | Purpose | Git | 
|-----------|---------|-----|
| `act.qcpaintshop.com\` | This repo — Express/Node web app + REST API + Socket.IO + FCM sender | GitHub remote `origin` |
| `qcpaintshop-android\` | The Android app (Jetpack Compose, all flavors in one Gradle module) | **No git remote — local only** [CLAUDE.md §1, memory] |
| `google-services\` | Play Store publishing scripts, service-account keys, store assets, screenshots, generated icons, prior `.aab` artifacts | (assets dir, not a code repo) |

This repo's GitHub remote is `https://github.com/sharjoon1/qcpaintshop-business-manager.git`, branch **`master`** **[code — `git remote -v`]**. CLAUDE.md/memory describe the canonical SSH form `git@github.com:sharjoon1/qcpaintshop-business-manager` **[CLAUDE.md, memory]**; the working clone currently uses an HTTPS PAT remote. The Android repo and `google-services/` are **not** in this repo and never pushed.

### 11.2 The Android apps (single Gradle module, product flavors)

A single Android Studio project (`qcpaintshop-android\`) builds **three flavors** off one `flavorDimensions += "app"` dimension, plus `debug`/`release` build types. From `qcpaintshop-android\app\build.gradle.kts` **[code]**:

| Flavor | `applicationId` | `START_PATH` (BuildConfig) | `APP_TYPE` | Distribution status |
|--------|-----------------|----------------------------|-----------|---------------------|
| `staff` | `com.qcpaintshop.staff` | `/login.html` | `staff` | Play Store production |
| `customer` | `com.qcpaintshop.customer` | `/customer-login.html` | `customer` | bundled with staff line |
| `painter` | `com.qcpaintshop.painter` | `/painter-login.html` | `painter` | Play Store upload pending |

Versioning (current, from `build.gradle.kts` **[code]**, which is **newer than the memory notes**):
- **Default (`staff`/`customer`) `versionCode = 19`, `versionName = "3.4.0"`** [code]. Memory records the last *published* state as **v3.3.9 vc18 on Play Store production** (promoted 2026-05-14) [memory] — i.e. vc19/3.4.0 is built but the published baseline in notes is vc18.
- **`painter` overrides `versionCode = 43`, `versionName = "4.1.2"`** [code]. Memory references **v4.1.0 vc41** (APK delivered to Telegram 2026-05-18, **Play Store upload pending**) and **v4.0.0 vc39** as prior milestones [memory]. So the painter flavor has advanced to vc43/4.1.2 in the repo since the last memory snapshot.

Architecture **[memory, CLAUDE.md]**: native **Jetpack Compose** apps (full Compose rewrite at v2.0; v4.0.0 was a light redesign, v4.1.0 added dark mode/timeline/autosave). The apps are thin clients over this server — they consume the **REST API** under `/api/*`, **Socket.IO** for live updates, and **FCM** for push. The `debug` build type uses `applicationIdSuffix = ".debug"` (so debug installs sit side-by-side).

How the apps authenticate against this server **[code, CLAUDE.md §4]**:
- **Staff/Customer:** `Authorization: Bearer <token>` (staff → `user_sessions`; customer phone-OTP → `customer_sessions`).
- **Painter app:** uses the **`X-Painter-Token`** header, not Bearer. Verified in `routes/painters.js:148` / `:170` (`req.headers['x-painter-token']`). Painter sessions are stored in `painter_sessions` (30-day expiry, multi-device) [memory].
- **FCM token registration (painter):** `POST` into `painter_fcm_tokens` with the field named **`fcm_token`** — `routes/painters.js:2771-2780` (`INSERT INTO painter_fcm_tokens (painter_id, fcm_token, device_info, is_active)`). The exact field name `fcm_token` is load-bearing [code; reinforced in memory].

### 11.3 Pre-release audit skill (painter app)

Before **every** painter APK upload there is a dedicated skill: **`painter-android-audit`** [skill registry, memory]. It runs static analysis, an APK build-verification step, and a backend cross-check against this server's `routes/painters.js` (to catch endpoint/contract drift), then auto-fixes P0/P1 findings and proposes P2 quality fixes. Known gotcha from memory: the **Phase-1 baseline must build clean first** (`./gradlew clean` or `--no-build-cache`) because the Gradle Kotlin cache hides real errors [memory: `feedback_audit_skill_baseline.md`].

### 11.4 Play Store publishing

Publishing is driven by Node scripts in the sibling `google-services\` directory using the Google Play Developer API (`googleapis` → `androidpublisher` v3) **[code]**:

| Script | Package | Default track | Source |
|--------|---------|---------------|--------|
| `publish-to-play.js` | `com.qcpaintshop.staff` | `internal` (arg overridable) | `google-services\publish-to-play.js:10-13` |
| `publish-painter.js` | `com.qcpaintshop.painter` | `internal` (arg overridable) | `google-services\publish-painter.js:10-13` |
| `promote-to-track.js` | (track promotion helper) | — | present in `google-services\` |
| `inspect-tracks.js` | (read current track state) | — | present in `google-services\` |

Both publish scripts: `node publish-<x>.js [track]` where `track ∈ {internal (default), alpha, beta, production}` **[code]**; they authenticate via a service-account **`play-api-key.json`** in `google-services\`, scope `https://www.googleapis.com/auth/androidpublisher`, then run the edits → upload bundle → assign to track flow (`edits.tracks.update`) **[code, `publish-painter.js:42-88`]**.

Accounts & test creds **[memory, CLAUDE.md/MEMORY]**:
- **Play Console:** `qualitycolours1@gmail.com`
- **Firebase:** `sharjoon1@gmail.com` (separate account, linked)
- **Play service-account key:** `google-services\play-api-key.json` [also confirmed by `KEY_FILE` in both scripts, code]
- **Play Store review/test account:** `playstore-reviewer@qcpaintshop.com` / `ReviewTest@2026`
- First publish of each package required the manual Play Console UI; subsequent releases go through the API scripts above [memory].

Supporting files present in `google-services\` **[code — dir listing]**: per-flavor `google-services.json` files (`com.qcpaintshop.customer-…`, `com.qcpaintshop.staff-google-services-staff.json`, debug variants), `firebase-service-account.json`, prior release bundles (`QCStaff-v3.x.x-release.aab`), store graphics (`QCStaff-icon-512x512.png`, feature graphic 1024×500), screenshot capture scripts (`capture-staff-screenshots.js`, `capture-painter-screenshots.js`), `check-16kb.js` (16 KB page-size compliance check), and icon generators.

Play Store gotchas to respect [memory: `reference_play_store_publishing.md`]: **versionCode must be unique across all history** (even an uncommitted/burned upload consumes it); release notes max **500 chars**; `changesNotSentForReview` is deprecated.

### 11.5 Telegram APK auto-delivery

**Standing operational rule [memory: `feedback_apk_telegram_auto_delivery.md`]:** every successfully built APK is sent **proactively** to Telegram **`@qualitycoloursbot`**, chat ID **`930726256`** — without waiting for the user to ask. The bot token is stored and reused; only re-ask if Telegram returns 401 [memory: `reference_telegram_apk_delivery.md`]. (This is a workflow/operational convention, not server code.)

### 11.6 Web deployment (production)

Production runs at **`act.qcpaintshop.com`** on a **Hetzner** box, fronted by **nginx / aaPanel** [CLAUDE.md, code comment]. The Express app trusts exactly one proxy hop: `app.set('trust proxy', 1)` with the comment `// Trust first proxy (nginx/aaPanel)` (`server.js:106`) **[code]** — load-bearing for correct client-IP and rate-limit behavior behind nginx.

Process manager: **pm2**, process name **`business-manager`** [CLAUDE.md]. The server binds `server.listen(PORT, …)` where `PORT` comes from env (default `3000`) (`server.js:4151`, `.env.example:15`) **[code]**.

**Deploy command (single SSH line)** [CLAUDE.md §7, memory]:
```bash
ssh hetzner "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && npm install && pm2 restart business-manager"
```
- App root on the box: `/www/wwwroot/act.qcpaintshop.com` (aaPanel default web root).
- Deploy = pull `master` → `npm install` → `pm2 restart business-manager`. There is no build step required server-side except CSS (`npm run build:css`) when Tailwind output changed.

Runtime stack [CLAUDE.md, code]: **Node.js v24**, **Express 5**, Socket.IO v4 via `http.createServer`; **MariaDB 10.11** behind `mysql2/promise` (pool of 20, `config/database.js`). The MySQL session timezone is forced to `+00:00` on every connection (`config/database.js:26-30`) because the host clock / `/etc/localtime` is IST — without it `NOW()` would be 5h30m off **[code]**.

### 11.7 Secrets & environment variables

All secrets live in **`.env`** (gitignored; `.env.example` is the committed template, and CLAUDE.md/§8.5 states it was verified absent from git history) **[CLAUDE.md, code]**. The following env-var **names** are referenced across active code (`config/`, `services/`, `middleware/`, `routes/`, `server.js`, `migrate.js`) — gathered by grepping `process.env.*`; **values are intentionally not shown** **[code]**:

| Group | Keys |
|-------|------|
| Server | `PORT`, `NODE_ENV`, `CORS_ORIGIN`, `NODE_APP_INSTANCE` |
| Base URLs | `APP_BASE_URL`, `APP_ORIGIN`, `APP_PUBLIC_URL`, `BASE_URL` |
| Database | `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` |
| SMTP / email | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`, `MAIL_FROM_NAME` |
| SMS (Nettyfish) | `SMS_USER`, `SMS_PASSWORD`, `SMS_SENDER_ID` |
| Zoho Books/CRM | `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_REDIRECT_URI`, **`ZOHO_ORGANIZATION_ID`** |
| Zoho Payments (split-settlement) | `ZOHO_PAYMENTS_CLIENT_ID`, `ZOHO_PAYMENTS_CLIENT_SECRET`, `ZOHO_PAYMENTS_REFRESH_TOKEN`, `ZOHO_PAYMENTS_ACCESS_TOKEN`, `ZOHO_PAYMENTS_ACCOUNT_ID` |
| AI (Gemini/Anthropic) | `GEMINI_API_KEY`, `GEMINI_MODEL`, `AI_GEMINI_MODEL`, `ANTHROPIC_API_KEY` |
| Push — FCM (server→app) | `FIREBASE_SERVICE_ACCOUNT_PATH` (path to a Firebase admin JSON; if unset, FCM push is disabled — `services/fcm-admin.js:21-24`) |
| Push — Web Push / VAPID | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL` |
| Uploads (template only) | `UPLOAD_DIR`, `MAX_FILE_SIZE_MB` |

Notes:
- **`.env.example` only documents a subset** (server, DB, SMTP, SMS, uploads) — the Zoho, AI, FCM/VAPID, and base-URL keys are used in code but absent from the template **[code: compare `.env.example` vs the grep above]**. An external reader should treat the grep list as authoritative for "what the runtime expects."
- **`ZOHO_ORGANIZATION_ID` is a master switch:** all background schedulers (Zoho sync, geofence auto-clockout, anomaly scan, lead auto-assign, painter/AI/WhatsApp processors) only start if it is set (`server.js:~4298`, CLAUDE.md §3). On a dev box without it, "nothing runs in the background" — by design.
- **FCM is optional at boot:** `services/fcm-admin.js:21-24` warns and disables push (rather than crashing) when `FIREBASE_SERVICE_ACCOUNT_PATH` is unset. The same service account underpins push to all three Android flavors.

### 11.8 Production migration operations

Schema is **incremental-only** — `migrations/` (118 files per CLAUDE.md) applied by `node migrate.js` (`--status`, `--mark-existing` flags) **[CLAUDE.md §2, memory]**. There is **no single `schema.sql`**; tables are learned by reading migrations.

Two production-specific operational hazards [CLAUDE.md §7, memory: `reference_prod_migrations_gap.md`]:

1. **The `_migrations` tracking gap.** On prod the `_migrations` table **only tracks migrations from ~Apr 30 2026 onward**, so `node migrate.js --status` **falsely over-reports ~80 PENDING** (every pre-Apr-30 migration looks unrun). Workaround: for a pre-existing migration, **mark it** (INSERT IGNORE the marker row / `--mark-existing`) rather than blindly re-running it; for genuinely new migrations, run the SQL directly and insert the tracking row.
2. **Additive-migration safety.** Prefer additive (online) schema changes; on MariaDB 10.11 use **`ALGORITHM=INPLACE LOCK=NONE`** where the operation supports it (e.g. the U7 batch added 9 composite indexes on prod this way) [CLAUDE.md §7, memory]. **Never run destructive SQL against production without first showing the exact SQL and getting explicit approval** (CLAUDE.md §7/§8.4).

### 11.9 Quick operational reference

| Concern | Value | Source |
|---------|-------|--------|
| Prod host | Hetzner box, nginx/aaPanel front | CLAUDE.md / code comment |
| App root on server | `/www/wwwroot/act.qcpaintshop.com` | CLAUDE.md |
| Process manager / name | pm2 / `business-manager` | CLAUDE.md |
| Trust-proxy hops | `1` (`server.js:106`) | code |
| DB | MariaDB 10.11, `qc_business_manager`, pool 20, session TZ `+00:00` | code / CLAUDE.md |
| Node | v24 | CLAUDE.md |
| Deploy | `git pull origin master && npm install && pm2 restart business-manager` | CLAUDE.md |
| Web push | VAPID keys (web) + FCM service account (Android) | code |
| APK delivery | Telegram `@qualitycoloursbot`, chat `930726256` (proactive) | memory |
| Play publish | `publish-to-play.js` (staff) / `publish-painter.js` (painter), `play-api-key.json`, tracks internal/alpha/beta/production | code / memory |

**Source-discrepancy flag for the reader:** the repo's `build.gradle.kts` (staff vc19/3.4.0, painter vc43/4.1.2) is **ahead of** the version numbers in the project memory notes (staff vc18/3.3.9 published; painter vc41/4.1.0 referenced). Where exact current versions matter, trust `qcpaintshop-android\app\build.gradle.kts` [code] over the memory snapshot.

---

## 12. Testing, Quality, Known Defects & Tech Debt

This section is an honest, evidence-grounded quality assessment of `act.qcpaintshop.com`. It combines the live test inventory with the read-only defect register from `COMPLETION_STATUS.md` (generated 2026-06-04, §2–§4), and notes where the *current* code has since moved past the audited state (verified file:line).

### 12.1 Test inventory (≈49 files)

Three runners, kept deliberately separate so they never collide:

| Layer | Runner | Location | Match pattern | Notes |
|-------|--------|----------|---------------|-------|
| Unit | Jest 30 | `tests/unit/*.test.js` | `**/tests/**/*.test.js` (`jest.config.js:3`) | `testEnvironment: node`, `testTimeout: 10000` |
| Integration | Jest 30 | `tests/integration/*.test.js` | same | Only one file: `painter-attendance-flow.test.js` |
| E2E | Playwright 1.60 | `tests/e2e/*.spec.js` | `**/*.spec.js` (`playwright.config.js:14`) | Chromium only; **does not auto-start the server** (booting `server.js` would start crons/WhatsApp/Zoho) — flow specs self-skip if `TEST_BASE_URL`/`TEST_STAFF_USER`/`TEST_STAFF_PASS` are unset |

**What IS covered.** The well-tested surface is concentrated in DPL/catalog, billing-adjacent services, and cross-cutting middleware:

- **DPL / catalog pipeline (heaviest coverage — ~10 files):** `dpl-naming`, `dpl-tabular-parser`, `dpl-csv-parser`, `dpl-csv-match`, `dpl-csv-long`, `dpl-coverage`, `dpl-price-size`, `dpl-catalog`, `dpl-catalog-endpoints`, `dpl-catalog-zoho-first`, `dpl-duplicate-detect`, `dpl-sku-base-match`, plus `brand-dpl-service`, `price-list-route`, `price-list-pdf-generator`.
- **Money/feature services:** `billing`, `vendors`, `item-master`, `reorder-compute`, `reorder-report`, `invoice-line-sync`, `estimate-pricing`, `estimate-search`.
- **Painter subsystem (NOT points):** `painter-attendance`, `painter-attendance-flow` (integration), `painter-location`, `painter-zoho-sync-service`, `painter-points-backfill-service`, `painter-marketing-scheduler`, `pntr-import-service`.
- **Cross-cutting / infra:** `idempotency`, `validate`, `rateLimiter`, `responseTracker`, `anomaly-detector`, `production-monitor`, `admin-notifications`, `color-extractor`, `branding`, `brand-config`, `config`.
- **E2E (Playwright):** `login.flow.spec.js` + `login.smoke.spec.js` (auth flow + smoke), `hidden-responsive.spec.js` (the `.hidden`/`sm:block` regression guard), and DPL render/UI specs `admin-dpl-render`, `admin-dpl-zoho-first`, `dpl-catalog-table`, `dpl-duplicate-badges`, `dpl-table-compact` (each with a static fixture HTML under `tests/e2e/fixtures/`).

`tests/unit/estimate-pricing.test.js` is explicitly a **characterization test** (`estimate-pricing.test.js:1-11`): it locks current behavior of `calculateItemPricing`/`calculateEstimateTotals` and labels any assertion that encodes a known defect, so future "fixes" surface as deliberate diffs rather than accidents.

### 12.2 Coverage reality (~15%)

Coverage is structurally narrow by design. `jest.config.js:4-8` only collects coverage from three places:

```js
collectCoverageFrom: ['middleware/**/*.js', 'config/**/*.js', 'services/anomaly-detector.js']
```

So `npm run test:coverage` reports near-100% on the instrumented slice while the **highest-value money paths are entirely untested** (`COMPLETION_STATUS.md:53,59`):

| High-value path | Test status |
|---|---|
| Estimate CRUD + calc engine **end-to-end** (route handlers, DB writes) | ❌ none (only the pure `calculateItemPricing` function is unit-tested in isolation) |
| Painter points engine / clawback / withdrawal | ❌ none |
| Auth / login / OTP (staff, customer, painter) | ❌ none beyond the Playwright login smoke |
| Lead routing / scoring | ❌ none |
| Zoho sync (CRM/Books push/pull) | ❌ none |

### 12.3 Tooling

| Tool | Version | Config | npm script |
|---|---|---|---|
| Jest | 30.2 | `jest.config.js` | `npm test`, `test:watch`, `test:coverage` |
| Playwright | 1.60 | `playwright.config.js` | `test:e2e`, `test:e2e:smoke` |
| ESLint | 9.39 (flat config) | `eslint.config.js` | `lint`, `lint:fix` |
| husky + lint-staged | 9.1 / 17.0 | `package.json:23-25` (`*.{js,mjs}` → `eslint --fix`); `prepare: husky` | runs on commit |
| Tailwind | 3.4 (JIT) | `tailwind.config.js` | `build:css`, `watch:css`; also `postinstall` (non-fatal) |

ESLint is intentionally lax for a ~70k-LOC codebase (`eslint.config.js:1`): style/hygiene rules are **warnings** (`no-unused-vars`, `no-empty` with `allowEmptyCatch`, `no-useless-escape`, `no-async-promise-executor`), but genuine-bug rules stay **errors** (`no-undef`, `no-unreachable`, `no-dupe-keys`, `no-dupe-args`, `no-func-assign`, `no-cond-assign`, `use-isnan`, `valid-typeof`). `public/**` (browser JS), `docs/`, `bmad/`, `archive/`, `coverage/` are ignored; test files relax `no-unused-vars` to off.

### 12.4 Defect / risk register (prioritized)

Reproduced from `COMPLETION_STATUS.md:68-105`, with **current-code verification** appended where the state has changed since the 2026-06-04 audit.

| ID | Sev | Issue | Location | Current state (verified) |
|----|-----|-------|----------|--------------------------|
| **P0-1** | P0 | Double ₹10 round-up overcharged customers (unit rounded, then line rounded again) | `routes/estimates.js:94-101` | **FIXED** — now single-round: `lineTotal = r10(finalPrice * safeQty)` once, then `unitPrice = round(lineTotal/safeQty)` (`estimates.js:98-101`). Locked by `estimate-pricing.test.js`. |
| **P0-2** | P0 | `gst_amount` hard-coded `0` while PDF prints "GST @18%" | `routes/estimates.js:132` | **CONFIRMED INTENTIONAL** — Zoho prices are GST-inclusive; `gst_amount: 0` is correct, do **not** add 18% (owner-confirmed 2026-06-04, per CLAUDE.md §6 + memory). Still present at `estimates.js:132`. |
| **P1-1** | P1 | `total_pct`/`total_value` markup/discount divide by `quantity` with no `qty>0` guard → NaN can propagate | `routes/estimates.js:64,67,85,88` | **MITIGATED** — `safeQty = quantity > 0 ? quantity : 1` guards the line/unit math (`estimates.js:99`); the per-branch divisors at 64/67/85/88 still use raw `quantity`. |
| **P1-2** | P1 | Salary hourly rate hard-coded `/260` but deductions use `config.standard_daily_hours` → inconsistent basis when daily hours ≠ 10 | `routes/salary.js:~532,610` | Open. |
| **P1-3** | P1 | Sunday OT counted 2× in SQL **and** re-multiplied by OT rate → likely overpay | `routes/salary.js:~552` | Open. |
| **P1-4** | P1 | Painter daily-bonus cap uses server-local date, not forced IST → cap breaks if server runs UTC | `services/painter-points-engine.js:~236` | Open. (Server clock is IST per CLAUDE.md, masking it in prod, but DB session TZ is UTC — latent.) |
| **P1-5** | P1 | Schedulers (geofence auto-clockout, anomaly scan, lead auto-assign, sync, painter/AI/WhatsApp) **silently don't start** if `ZOHO_ORGANIZATION_ID` unset | `server.js:~4298` | Open — by design but a footgun; "why isn't the cron running?" almost always traces here. |
| **P2-1** | P2 | Secrets (DB pwd, Zoho secret/refresh token, Gemini key, SMTP/SMS pwd) live in `.env` | `.env` | `.env` is **NOT git-tracked and NOT in history** (verified `git ls-files`/`git log --all -- .env`, `.gitignore:1`). Risk is local-disk/backup exposure, not a committed leak. |
| **P2-2** | P2 | Hardcoded business UPI id `7418831122@superyes` | `routes/estimates.js`, `routes/share.js` | Open — should move to config for rotation. |
| **P2-3** | P2 | Painter test-account OTP bypass (`123456` for `9999999999`/`+919999999999`) gated on non-prod | `routes/painters.js:270-271` | **PRESENT** — `isTestAccount` → `otp = '123456'`; safe only if `NODE_ENV` is correctly `production` (single misconfig = auth bypass). |
| **P2-4** | P2 | `painter_sessions` legacy stores raw `token` alongside `token_hash` | `migrations/migrate-painters.js` | Open — reads use the hash; raw column is redundant exposure. |
| **P2-5** | P2 | Upload filter trusts extension/mimetype, no magic-byte check | `routes/wa-marketing.js:~66` + others | Open — renamed `.exe`→`.pdf` passes; mitigate + serve `Content-Disposition: attachment`. |
| **P2-6** | P2 | `Math.random()` for temp PDF filenames | `routes/estimates.js` (several) | Open — low impact; prefer `crypto.randomBytes`. |
| **P2-7** | P2 | No per-request rate-limit on authenticated token validation (login itself is limited) | `middleware/permissionMiddleware.js` | Open — 256-bit token space, low practical risk. |

### 12.5 Confirmed GOOD (no action needed)

From `COMPLETION_STATUS.md:99-105`:

- **No SQL injection** — all sampled queries (estimates, painters, leads, zoho, stock-check) use `?` placeholders; dynamic `SET`/`WHERE` build placeholder lists with separate `params` arrays.
- Passwords hashed with **bcrypt(10)**; auth tokens are `crypto.randomBytes(32)` stored as `LOWER(SHA2(token,256))` (hashed at rest).
- **Stack traces suppressed in production** (`middleware/errorHandler.js`).
- **Rate limiting** — global 100/min, auth 10/min, OTP 5/min.
- **helmet + CORS** with env-whitelisted origins (no `*`).

### 12.6 Known accepted limitations (explicitly NOT fixing)

- **NIT-1 — Zoho sub-rupee line-total drift.** The estimate stores a ₹10-rounded line total and a derived `unit_price = line_total/qty` (2-decimal); the Zoho push (`services/billing-zoho-service.js:140-144`) sends `{ item_id, quantity, rate: unit_price }` and **Zoho recomputes line = rate × qty**, so the Zoho invoice line can differ from the estimate line by up to ~₹1 (drift ≈ `qty × 0.005`). This was *surfaced* (not caused) by the 2026-06-04 single-round fix. **Owner decision 2026-06-05: accept.** Zoho is system-of-record for the actual invoice/GST; painter points are unaffected (they use the stored `line_total`, not the Zoho-recomputed value). Revisit only if penny-exact parity becomes an audit requirement — and any fix must be validated on a real Zoho draft invoice first.
- **CSP `'unsafe-inline'` + `'unsafe-eval'`** are enabled (`server.js:~139`) to support legacy inline event handlers across ~100 static pages. Flagged as a long-term follow-up, not a blocker.
- **No money library / no integer-paise storage.** All money is JS float with `Math.round(x*100)/100` and `r10 = n => Math.ceil(n/10)*10` rounding. Accepted given Zoho is the financial system-of-record; the codebase compensates with disciplined 2-decimal rounding rather than a decimal/BigInt money type.

### 12.7 Structurally missing (not implemented)

From `COMPLETION_STATUS.md:57-64`: no auth-event audit logging (login success/failure, permission denials are not wired into `services/audit-log.js`); session IP/User-Agent captured on login but never validated on later requests; no CSRF tokens (acceptable — Bearer/custom-header token auth, not cookie-based); and the untested money paths in §12.2 above.

---

## 13. Feature History, Conventions & Roadmap

This section gives the project's trajectory (how it was built), the working conventions every contributor must follow, the production-safety rules, the documentation system that keeps the codebase legible, and the current/in-flight state of the platform.

### 13.1 Condensed chronological feature history (Feb 2026 → Jun 2026)

The platform was built **fast and broad** — roughly four months from first features to the current HEAD, with a tight loop of *spec → plan → implement → ship → audit*. The strongest evidence of dating is the `docs/superpowers/specs/` + `docs/superpowers/plans/` pairs, which are named `YYYY-MM-DD-<feature>-design.md` (spec) and `YYYY-MM-DD-<feature>.md` (plan). The waves below cite those filenames; finer per-feature detail lives in `MEMORY.md`'s "Recent Features" index and in `Skills.md` (the comprehensive living doc).

#### February 2026 — Foundations (auth, accounting, AI, loyalty, estimates)
The first wave laid every load-bearing subsystem at once. Evidenced by `docs/plans/2026-02-27-staff-lead-management-{design,plan}.md`, `docs/plans/2026-02-28-painter-dedicated-app-{design,plan}.md`, `docs/plans/2026-02-28-estimate-catalog-{design,plan}.md`, `docs/plans/2026-02-28-painter-premium-features-{design,plan}.md`, and the BMAD docs (`bmad/PRD.md`, `bmad/architecture.md`, `bmad/user-stories.md`).

| Area | What shipped |
|---|---|
| Auth + RBAC | Staff session auth (`user_sessions`), granular module/action permissions (`middleware/permissionMiddleware.js`), customer OTP auth, painter OTP auth |
| Painter loyalty + OTP | Loyalty points engine, referrals, credit, OTP login (`services/painter-points-engine.js`) |
| AI Business Intelligence | Triple-provider engine (Gemini + Claude + Clawdbot/Kai), automated analysis + interactive chat (`services/ai-engine.js`, `routes/ai.js`, `admin-ai.html`) |
| Estimates | Estimate → payment → Zoho invoice flow, self/customer billing |
| Stock check | Batch submission, save-progress, fresh-stock comparison |
| Credit limits | Zoho-synced limits, credit check before invoicing, staff request workflow |
| AI dashboards | KPI cards, Chart.js, branch scorecards, 60s live monitor; AI lead scoring; system health/error-prevention; bug reports |
| BMAD Sprints 1–3 | Rate limiting, LRU cache, modular route extraction, anomaly detection, production monitor, circuit breaker, 58 tests |

#### March 2026 — Staff operations hardening + theme
Evidenced by `docs/plans/2026-03-01-salary-fix-leave-policy-{design,plan}.md`, `docs/plans/2026-03-03-card-estimate-upgrade-{design,plan}.md`, `docs/plans/2026-03-07-geofence-background-service.md`, `docs/plans/2026-03-08-staff-activity-tracker-{design,plan}.md`, `docs/superpowers/plans/2026-03-10-daily-activity-report.md`, `docs/superpowers/specs/2026-03-13-painter-retention-design.md`, and the `2026-03-17`/`2026-03-19` estimate spec/plan pairs.

- **Staff dark-green theme** (Mar 7): 26+ pages rebranded `#1B5E3B`/`#154D31`, removing purple from staff/painter surfaces.
- **Collections enhancements** + **product grouping** (SKU-code stripping for cleaner merges) + painter points auto-award on confirm-payment.
- **Geofence background location** (Mar 7–8): native Android foreground service, GPS 30s, 300m→FCM alert, 5min→auto-clockout.
- **Salary fixes** (leave policy), **staff activity tracker**, **incentive slabs** + dormant-lead re-engagement, **estimate/visiting card v6**, daily activity report, **painter retention system** design.

#### April 2026 — The big breadth month (billing, WhatsApp, native Android, DPL, marketing)
By far the densest wave — over 30 spec/plan pairs dated `2026-04-*`. Highlights with evidence:

| Feature | Spec/Plan evidence |
|---|---|
| Staff billing + vendor mgmt (AI OCR via "KAI") | `2026-04-01-staff-billing-vendor-management-design.md`, `2026-04-01-staff-billing-system.md`, `2026-04-01-vendor-management.md` |
| WhatsApp module (standalone sidebar, 8 pages) | `2026-04-03-whatsapp-module-design.md`, `2026-04-03-admin-whatsapp-integration-design.md` |
| Painter native Android rewrite (v2 Compose → v3 full parity) | `2026-04-05-painter-android-native-rewrite-design.md`, `2026-04-06-painter-native-app-full-parity-design.md`, `2026-04-17/18` v3 data-layer/withdrawal/attendance-streak/misc-plumbing plans, `2026-04-23-painter-app-approval-flow.md`, `2026-04-25-painter-fcm-fix.md` |
| Item Master + DPL import | `2026-04-07-item-master-management-{design,plan}.md` |
| Estimate payment / receipt / vendor PO | `2026-04-08-estimate-payment-receipt-po.md` |
| Zoho bug fixes (cf_dpl push, sidebar, auth) | `2026-04-14-zoho-bugs-sidebar-auth-{design,plan}.md` |
| Reorder intelligence (velocity → auto reorder levels) | `2026-04-14-reorder-intelligence-{design,plan}.md` |
| PNTR painter marketing (Zoho import → daily calls → conversion) | `2026-04-16-pntr-painter-marketing-{design,plan}.md`, `2026-04-17-leads-painter-program-integration.md`, `2026-04-17-painter-marketing-all-leads-panel.md` |
| Admin FCM notifications | `2026-04-20-admin-fcm-notifications-{design,plan}.md` |
| Painter selfie attendance + AP | `2026-04-20-painter-selfie-attendance-{design,plan}.md` |
| Admin Painters UI redesign (10 flat tabs → 2-level nav) | `2026-04-21-admin-painters-ui-redesign.md` |
| Admin Products UX + Color variants B1 (web) / B2 (Android) | `2026-04-21-admin-products-ux-{design,plan}.md`, `2026-04-21-color-variants-b1/b2-{design,plan}.md` |
| Estimate-create redesign + points/offers | `2026-04-22-estimate-create-redesign-{design,plan}.md`, `2026-04-22-estimate-create-points-offers-{design,plan}.md` |
| Painter live location tracking (fleet map + replay) | `2026-04-22-painter-live-location-tracking-{design,plan}.md` |
| Staff/Admin mobile UX audit | `2026-04-17-staff-admin-mobile-ux-{design,plan}.md` |
| **Audit-driven Reliability & Perf Sprint** (Apr 30 → May 1) | `docs/audits/audit-20260430.md` — 11 items: customer Bearer auth + `customer_sessions`, DPL endpoint relocation, painter-point name fix, token forgot-password, Tailwind JIT pipeline, 12 composite indexes, `audit_records` + redacting `record()`, `idempotent()` middleware, `deleted_at` soft-delete on financial tables, skeleton/toast UI primitives, self-heal backoff |

#### May 2026 — DPL extraction overhaul + painter app v4 redesign
Evidenced by the `2026-05-08` through `2026-05-28` spec/plan pairs.

- **DPL extraction overhaul** (`2026-05-08-birla-opus-dpl-naming`, `2026-05-08-dpl-price-size-mapping`, `2026-05-10-dpl-paste-text-mode`, `2026-05-10-brand-dpl-storage`, `2026-05-10-dpl-coverage-views`, `2026-05-11-fix-brand-modal-enhancements`, `2026-05-20-birlaopus-dpl-csv-import`, `2026-05-28-dpl-zoho-mobile-cards`): Birla Opus ALL-CAPS naming rules, price↔pack-size mapping, brand-scoped DPL storage (`brand_dpl_lists`).
- **Painter app v4** (`2026-05-16-painter-enterprise-design`, `2026-05-17-painter-light-redesign`): full enterprise redesign, dark mode, timeline, autosave → **v4.1.0 vc41**.
- **Public landing redesign** (`2026-05-12`) and **home portal splash** (`2026-05-27`).

#### June 2026 — DPL Catalog deterministic mediator → Zoho-first reconciliation (current HEAD)
The most recent wave, evidenced by ~25 `2026-06-*` spec/plan pairs and the recent git log (HEAD `2c5e56c`).

- **DPL Catalog (deterministic item-master mediator)**: replaces fuzzy DPL→Zoho matching with a persistent `dpl_catalog` (size-tier equivalence 900ml↔1L, SKU-reconstruct linker, pinned links, price-diff + bulk-edit push). Plans `2026-06-02-dpl-catalog-1-data-model-service`, `2026-06-03-dpl-catalog-2-endpoints`, `-2b-review-ui`, `-3-apply-push`, plus reconcile/brand-scope/colorant-map/entry-edit/push-tracking/orphan-cleanup/not-in-zoho follow-ons.
- **DPL duplicate-link detection + compact table** (`2026-06-05-dpl-catalog-duplicate-link-detection-design.md`).
- **DPL Zoho-first reconciliation tab** (`2026-06-06`/`2026-06-07` series: `zoho-first-dpl-reconciliation`, `-cards-autopropose-filters`, `-edit-push`, `-parity`, `-full-parity`, `-unmatched-disposition`): one row per active Zoho item, mobile cards, auto-proposed DPL + ✓Accept, filter chips, SKU-conflict warnings, and unmatched-item **disposition** (Done/Later/Reopen via `dpl_disposition`). This is the current HEAD work — recent commits `2c5e56c`, `9ce76f8`, `5083733`, `b73df99`, `3024041`.

### 13.2 Coding conventions (CLAUDE.md §5)

Match the surrounding file's style rather than introducing new patterns. Concretely:

- **SQL — always parameterized.** Use `?` placeholders; never interpolate user input into SQL strings. For dynamic `SET`/`WHERE`, build an array of `?` clauses and a separate `params` array (canonical example: `routes/estimates.js`).
- **Money — JS floats, rounded to 2 decimals.** `Math.round(x*100)/100`. Round-up to nearest ₹10 via `r10 = n => Math.ceil(n/10)*10`. Known defects exist (double ₹10 rounding, `gst_amount: 0`) — these are **owner-confirmed intentional** for the estimate engine (GST is inclusive; line single-rounds to ₹10, then unit = line/qty). Do not "re-fix" without a characterization test.
- **DPL rate formula:** `ceil(dpl * 1.18 * 1.10)` (18% GST × 10% markup), in `services/price-list-parser.js` → `services/dpl-catalog.js` → `routes/item-master.js`. The newer price-list generator uses the equivalent `Math.ceil(dpl * (1 + markup/100) * 1.18)`.
- **Frontend XSS — escape before `innerHTML`.** Helper names are inconsistent across pages (`escHtml` / `escapeHtml` / `esc`); reuse whichever already exists in the page you're editing.
- **Errors — centralized handler** that suppresses stack traces in production; console errors are buffered into `global._appErrorBuffer`.
- **Async throughout** with `async/await` + `mysql2/promise`.
- **Brand colors:** Admin `#667eea→#764ba2`; Staff & Painter share `#1B5E3B` green + gold `#D4A24E`. **No purple in staff/painter pages.**
- **`cf_*` Zoho custom fields** must be wrapped into `custom_fields:[{api_name,value}]` on update (`services/zoho-api.js`).
- **Pool injection:** one pool created in `server.js`, injected via each route module's `setPool(pool)`. Never create a second pool.

### 13.3 Production-safety rules (CLAUDE.md §7)

- **Never run destructive SQL against production** without first showing the exact SQL and getting explicit approval. Prefer **additive migrations** (`ALGORITHM=INPLACE LOCK=NONE` where possible — the prod DB is MariaDB 10.11).
- **The `_migrations` Apr-30 gap:** prod's `_migrations` table only tracks migrations from Apr 30 2026 onward, so `node migrate.js --status` **over-reports pending** (falsely shows ~80 pending). Workaround: run a genuinely new migration directly, then `INSERT IGNORE` a marker row — mark pre-existing migrations rather than blindly re-running them.
- **Don't touch production data** without showing the exact query for approval.
- **Secrets** live in `.env` (gitignored, verified absent from git history). Never hardcode credentials or paste secret values into chat/commits.
- **Deploy command:** `ssh hetzner "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && npm install && pm2 restart business-manager"`.

### 13.4 Workflow rules (CLAUDE.md §8)

1. **Plan first for big work** — any multi-file feature, migration, or change to the §6 critical-logic paths requires a plan + owner approval before code.
2. **Evidence over "done"** — show actual test output / command result / curl response, never just claim success.
3. **Test-first for bug fixes** — reproduce with a failing test, fix, then show it passing.
4. **No production-data changes** without showing the exact query.
5. **Secrets stay in `.env`.**
6. **Communication:** owner-facing replies in Tamil (technical terms in English); commits/code-comments/docs in English; every commit ends with the footer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

### 13.5 Documentation system

The project keeps several distinct, complementary documentation surfaces:

| Surface | Role |
|---|---|
| `Skills.md` (~287 KB) | The **comprehensive living system doc** — full module-by-module capability map. Update it after every substantial change. Grep/read selectively; do not load whole. |
| `COMPLETION_STATUS.md` | The latest **read-only audit** of what's actually built (the basis CLAUDE.md was derived from). |
| `CLAUDE.md` | Distilled, verified working guidance for contributors (stack, wiring, auth, conventions, critical-logic, safety, workflow). |
| `docs/superpowers/specs/` + `docs/superpowers/plans/` | **Per-feature design + plan pairs**, dated `YYYY-MM-DD-<feature>`. Specs capture intent/design; plans are step-by-step, checkbox-driven, TDD-structured, with explicit commit commands. This is the primary trail of *when* and *how* each feature was built. |
| `docs/plans/` | Earlier (Feb–Mar) design/plan pairs before the `superpowers/` convention. |
| `docs/audits/` | Point-in-time audits (e.g. `audit-20260430.md` driving the Apr 30 reliability sprint). |
| `bmad/` | Up-front product artifacts: `PRD.md` (scope/personas/metrics), `user-stories.md` (epics + acceptance criteria), `architecture.md` (system + proposed improvements), tracked per the BMAD method (Analysis/Planning/Architecture complete; Implementation tracked per-story). |
| `MEMORY.md` | Cross-conversation memory index: feedback/preferences, references, and a "Recent Features" chronology pointing to per-topic files. |

The plan files are written for agentic execution — they reference the `superpowers:subagent-driven-development` / `superpowers:executing-plans` sub-skills and use `- [ ]` checkboxes per step, with literal test/commit commands inline (see `2026-05-21-customer-price-list-generator.md` for a representative TDD plan: failing test → minimal impl → passing test → commit).

### 13.6 Current version line & in-flight work

**Shipped / current versions:**
- **Web:** deployed to production at `act.qcpaintshop.com`, on `master` HEAD (`2c5e56c`, the DPL Zoho-first reconciliation work, deployed 2026-06-07). 545 tests green on the latest DPL work, pending owner verify.
- **Android Staff/Customer:** v3.3.9 vc18 on Play Store **production** (Skills.md header notes v3.4.0 vc19 in internal track).
- **Android Painter:** v4.1.0 vc41 APK built/delivered (10.32 MB, to Telegram chat 930726256); **Play Store upload pending** — use `google-services/publish-painter.js`. The painter app lives on local-only branch `design/painter-app-ux-2026-05` (no git remote).

**In-flight (uncommitted) plans** — present in the working tree but not yet committed, indicating active/queued work:
1. `docs/superpowers/plans/2026-05-19-mobile-responsiveness.md` — a 24-page mobile-responsiveness overhaul (360–430px, no horizontal scroll). Introduces a global `public/css/mobile.css` + `public/js/mobile-init.js` auto-fixer injected via `universal-nav-loader.js`, then per-page P1→P4 fixes (card-table layouts, bottom-sheet modals, 44px tap targets, FABs).
2. `docs/superpowers/plans/2026-05-21-customer-price-list-generator.md` — **v1** of a branded PDF price-list generator: `services/price-list-pdf-generator.js` (`computeFinalPrice`, `groupRowsForPdf`, `generatePriceListPdf`), `routes/price-list.js` (`GET /brands`, `POST /generate`, mounted at `/api/price-list`), `public/admin-price-list-generator.html`. Reads from `brand_dpl_lists.parsed_rows`, applies GST + custom markup, supports download + WhatsApp send via `whatsapp-session-manager.sendMedia`.
3. `docs/superpowers/plans/2026-05-21-price-list-generator-v2.md` — **v2** enhancement: individual product selection (category accordion + search), negative markup %, a Category column in the PDF, embedded Noto Sans TTF for correct ₹ glyph rendering, `GET /items` endpoint, and `POST /generate` accepting an explicit `items[]` payload.

Also present uncommitted: `docs/audits/admin-dpl-hotfix.patch` (an admin-DPL hotfix patch staged for review).

The trajectory is unmistakable: after building the full operational platform (Feb–Apr), the team converged in May–June on **two themes** — perfecting the DPL→Zoho catalog/pricing pipeline (the business's hardest correctness problem) and finishing the mobile/native polish — with mobile-responsiveness and the customer price-list generator as the next features queued but not yet landed.

---

## 14. How Claude Code currently operates in this repo (meta)

This section is not about the application — it is about **the AI agent (Claude Code) that builds and
maintains it**, captured so a prompt-designer can improve how that agent works. It is drawn from the
checked-in `CLAUDE.md`, the persistent memory index (`MEMORY.md`), and the installed skill set.

### 14.1 The standing operating contract (`CLAUDE.md`)

`CLAUDE.md` is a project-root file that **overrides default agent behavior**. Its load-bearing rules:

- **Plan-first for big work.** Any multi-file feature, migration, or change to a money/correctness
  path requires entering plan mode and getting owner approval *before* writing code.
- **Evidence over "done".** The agent must not claim something works — it must show the actual test
  output / command result / curl response. ("Don't tell me it passes; show me the green run.")
- **Test-first for bug fixes.** Reproduce the bug with a failing test, fix, then show it pass.
- **Production-data safety.** Never run destructive SQL on prod without showing the exact SQL and
  getting explicit approval; prefer additive migrations (`ALGORITHM=INPLACE LOCK=NONE`, MariaDB 10.11).
- **Secrets discipline.** Secrets live only in `.env` (gitignored, verified absent from history);
  never hardcode, never paste secret values into chat or commits.
- **§6 "DO NOT change without a test first"** explicitly fences the estimate pricing engine, painter
  points engine, salary calc, DPL pricing, and Zoho `cf_*` handling as characterization-test-gated.

### 14.2 Communication style

- **Replies to the owner are in Tamil**, with technical terms (file names, code, commands, SQL) kept
  in English. Lead with the answer; be concise.
- **Commits, code comments, and docs stay in English.**
- Commit footer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

### 14.3 Coding conventions the agent must match

- Parameterized SQL only (`?` placeholders); dynamic `SET`/`WHERE` built as a placeholder array +
  separate params array. Never interpolate user input into SQL.
- Money: JS floats rounded to 2 decimals; round-up-to-₹10 via `r10 = n => Math.ceil(n/10)*10`.
- Escape before `innerHTML`; reuse the page's existing escape helper (names vary: `escHtml`/`escapeHtml`/`esc`).
- One shared DB pool, injected via `setPool(pool)`; never create a second pool.
- Brand colors are rules, not suggestions: Admin purple `#667eea→#764ba2`; Staff & Painter green
  `#1B5E3B` + gold `#D4A24E`; **no purple in staff/painter pages**.
- Match the surrounding file's style rather than introducing new patterns.

### 14.4 Persistent memory system

The agent maintains a file-based memory under
`~/.claude/projects/<project>/memory/` — one fact per file (frontmatter `type:` of
user/feedback/project/reference), indexed by a one-line pointer in `MEMORY.md` loaded each session.
This is how cross-session knowledge persists (e.g. confirmed business decisions like the
GST-inclusive policy, the Birla Opus naming rules, painter tier thresholds, the prod `_migrations`
gap workaround, Telegram APK delivery). A prompt-designer should treat memory as the agent's
long-term store and design prompts that **write durable decisions back into it**.

### 14.5 Skill / workflow tooling available to the agent

- **Superpowers skills**: brainstorming, writing-plans, executing-plans, test-driven-development,
  systematic-debugging, requesting/receiving-code-review, verification-before-completion,
  using-git-worktrees, subagent/parallel dispatch. These encode rigorous process (TDD, evidence,
  plan-gated work).
- **Project-specific skills**: `painter-android-audit` (pre-release gate for the painter APK),
  `buybmat-*` and `buybmat-zoho-payments` (sibling Quality Colours platforms), `deep-research`,
  `code-review`/`security-review`, `/run`, `/verify`.
- **Multi-agent orchestration ("ultracode")**: the agent can fan out deterministic workflows of
  many subagents for exhaustive review/research/migration — as was used to generate *this* dossier.

### 14.6 Documentation discipline

`Skills.md` (287KB) is the living comprehensive system doc and is updated after substantial
changes; `COMPLETION_STATUS.md` is the latest read-only audit; `docs/superpowers/{specs,plans}`
hold per-feature design+plan pairs; `bmad/` holds PRD/architecture/sprint docs. A good operating
prompt keeps these in sync.

---

## 15. Analysis hooks — designing a "make Claude great" prompt

Concrete leverage points an analyzing AI can turn into instructions for the maintaining agent.
These are derived from the defects, gaps, and decisions documented above.

**Highest-leverage correctness work (see §8, §12):**
- Backfill **characterization tests** for the untested money paths — estimate calc engine, painter
  points/clawback, salary OT/leave, auth/OTP — *before* any refactor. Today coverage is ~15% and the
  highest-value paths are untested.
- Force **IST date handling** everywhere a "daily" boundary matters (painter daily-bonus cap, salary
  day counting) since the DB session is UTC and the server clock is IST — a latent class of bugs.
- Add a `qty > 0` guard in estimate pricing to kill NaN propagation.

**Operational hardening (see §2, §11, §12):**
- Make the `ZOHO_ORGANIZATION_ID` scheduler gate **loud** — log a startup warning when schedulers are
  skipped, so "it didn't run" is never silent.
- Externalize the hardcoded UPI id and add magic-byte upload validation.
- Wire auth-event audit logging (login success/fail, permission denials) into the existing
  `audit-log.js` helper.

**Process / prompt-design recommendations:**
- Preserve the **plan-first + evidence-first + test-first** triad — it is the spine of how this repo
  stays stable. A "make Claude great" prompt should reinforce, not relax, these.
- Encode the **settled business decisions** (GST-inclusive ⇒ `gst_amount=0` is correct; NIT-1 Zoho
  sub-rupee drift accepted; single ₹10 round-up) so the agent never re-litigates them.
- Keep the **Tamil-reply / English-artifacts** split and the **memory write-back** habit explicit.
- Lean on **ultracode multi-agent workflows** for audits, broad refactors, and research — the repo is
  large enough that single-pass reading misses things (this dossier is proof-of-pattern).

---


---

*End of dossier. Generated 2026-06-08 by a 13-agent grounded survey of the live codebase.
Counts and `file:line` references reflect the repository state on that date; re-verify before acting
on any specific line number, as the codebase changes weekly.*
