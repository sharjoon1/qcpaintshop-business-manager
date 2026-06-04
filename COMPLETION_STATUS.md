# COMPLETION_STATUS.md

> Read-only audit of `act.qcpaintshop.com` (QC Paint Shop Business Manager).
> Generated 2026-06-04. **No code was modified to produce this report.**
> All findings below were verified against real source files (file:line cited).

---

## 0. Tech Stack & Architecture (verified)

| Layer | Technology |
|-------|-----------|
| Runtime / Framework | Node.js + **Express 5** (`server.js`, ~4,350 lines / 200KB) |
| Real-time | Socket.IO v4 (`http.createServer` + io) |
| Database | **MySQL / MariaDB** via `mysql2/promise` (`config/database.js`) — pool of 20, session TZ forced to `+00:00` (UTC) |
| Schema | Incremental migrations only (`migrate.js` + `migrations/` — **118 files**, no single schema.sql); `_migrations` table tracks applied (SHA-name unique) |
| Frontend | Static HTML + vanilla JS + Tailwind (JIT build) in `public/` (~100+ pages) |
| Auth | Custom opaque tokens, SHA-256 hashed at rest; bcrypt for passwords; TOTP 2FA (speakeasy) |
| Integrations | Zoho (CRM/Books), Firebase FCM, WhatsApp (whatsapp-web.js), Nodemailer SMTP, Nettyfish SMS, Gemini AI |
| Background jobs | node-cron schedulers started at boot **only if `ZOHO_ORGANIZATION_ID` is set** |

**Wiring:** one pool created in `server.js` → distributed to every route/service via `.setPool(pool)` (`server.js:273-376`). Routes mounted `server.js:394-438`. Global middleware: helmet (CSP), CORS (env whitelist), compression, 3-tier rate limiting, PII gate on `/uploads/aadhar` + `/uploads/documents` (`server.js:249-267`).

---

## 1. Modules that FULLY WORK (production-live)

These are deployed on prod and exercised daily; code is coherent and (mostly) tested.

| Module | Evidence |
|--------|----------|
| **Staff/Admin auth + RBAC** | `middleware/permissionMiddleware.js` — `requireAuth`, `requirePermission(module,action)`, `requireRole`; full-admin bypass `FULL_ADMIN_ROLES`. Parameterized permission lookups. |
| **2FA (TOTP)** | `routes/auth-2fa.js` + `services/totp-service.js`, enforced for admin/manager. |
| **Customer auth** | `services/customer-auth.js` + `middleware/customerAuth.js` — OTP → `customer_sessions` (SHA-256, 30d). Enumeration-safe forgot-password. |
| **Painter auth + loyalty** | `routes/painters.js` (337KB) — `requirePainterAuth`/`requirePainterSession`, points engine, tiers, withdrawals. |
| **DPL Catalog pipeline** | `services/price-list-parser.js` (94KB) → `services/dpl-catalog.js` → `routes/item-master.js`. Well-tested (6 DPL test files), recently shipped (per git log + memory). |
| **Billing / Zoho sync** | `routes/billing.js`, `routes/zoho.js` (303KB), `services/zoho-api.js`. Has tests. |
| **Estimates** | `routes/estimates.js` (59KB) — create/edit/payment/PDF/WhatsApp. **Works but has money-math defects, see §4.** |
| **Idempotency + audit log** | `middleware/idempotency.js` (24h TTL), `services/audit-log.js` → `audit_records` with redaction. |
| **Leads, collections, attendance, salary, stock-check, WhatsApp, AI dashboard** | All mounted, live, referenced in memory as shipped features. |

---

## 2. HALF-FINISHED / has caveats

| Item | Status | Evidence |
|------|--------|----------|
| **GST on estimates** | Hard-coded `gst_amount: 0` — *may be intentional* (Zoho prices are GST-inclusive per painter-code comment) but **undocumented** in admin estimate path. PDF prints "GST @18%" label while amount is ₹0 → confusing. | `routes/estimates.js:128`; `routes/painters.js:~1537` |
| **Painter annual withdrawal window** | Code comment literally says *"Simple check - can be enhanced later"* — withdrawal-window date not actually enforced. | `services/painter-points-engine.js` (requestWithdrawal) |
| **Net salary** | Salary components stored, but no single `net_salary` summary computed. | `routes/salary.js` |
| **Migration tracking** | Prod `_migrations` only tracks Apr 30+ → `--status` falsely reports ~80 pending. Documented workaround exists. | `migrate.js`, memory |
| **CSP** | `'unsafe-inline'` + `'unsafe-eval'` enabled to support legacy inline handlers — flagged as follow-up. | `server.js:~139` |
| **Test coverage** | Only ~15% of critical logic covered. DPL/billing/vendors/config tested; **estimates routes, painter points, auth, leads, zoho sync = zero tests.** `jest.config.js` only collects coverage from middleware/config/anomaly-detector. | `tests/` (37 files) |

---

## 3. MISSING (not implemented)

- **No automated tests** for: estimate CRUD + calc engine, painter points/clawback, auth/login/OTP, lead routing/scoring, Zoho sync. (highest-value money paths are untested)
- **No auth-event audit logging** (login success/failure, permission denials) — `audit-log.js` exists but isn't wired into auth middleware.
- **No session IP/User-Agent validation** — captured on login but never checked on later requests.
- **No deep file-content (magic-byte) validation** on uploads — extension/mimetype only.
- **No CSRF tokens** (acceptable: API is Bearer/custom-header token auth, not cookie-based).
- **No money library / integer-paise storage** — all money is JS float + `Math.round(x*100)/100`.

---

## 4. BUGS & SECURITY RISKS — priority order

### P0 — Financial correctness (verified in code)

| # | Issue | Location | Detail |
|---|-------|----------|--------|
| P0-1 | **Double ₹10 round-up overcharges** | `routes/estimates.js:95-97` | `finalPrice = ceil(unit/10)*10` then `lineTotal = ceil(finalPrice*qty/10)*10`. Unit rounded, then line rounded again → systematic overcharge (e.g. ₹127.50×5 → ₹650 instead of ₹640). |
| P0-2 | **`gst_amount` hard-coded 0 while PDF shows "GST @18%"** | `routes/estimates.js:128` | Either GST is genuinely inclusive (then PDF label is wrong/misleading) or GST is being dropped (revenue + compliance risk). **Intent must be confirmed before any change.** |

### P1 — Correctness / robustness

| # | Issue | Location |
|---|-------|----------|
| P1-1 | Markup/discount `total_pct`/`total_value` divide by `quantity` with no `qty>0` guard → NaN can propagate into totals | `routes/estimates.js:64,67,85,88` |
| P1-2 | Salary hourly rate hard-coded `/260` but deductions use `config.standard_daily_hours` → inconsistent basis if daily hours ≠ 10 | `routes/salary.js:~532,610` |
| P1-3 | Sunday OT counted at 2× in SQL **and** re-multiplied by OT rate → likely overpay | `routes/salary.js:~552` |
| P1-4 | Painter daily-bonus cap uses server-local date, not forced IST → cap breaks if server runs UTC | `services/painter-points-engine.js:~236` |
| P1-5 | Schedulers (geofence auto-clockout, anomaly scan, lead auto-assign) **silently don't start** if `ZOHO_ORGANIZATION_ID` unset | `server.js:~4298` |

### P2 — Security hardening (no active exploit found)

| # | Issue | Location | Note |
|---|-------|----------|------|
| P2-1 | **Secrets live in `.env`** (DB pwd, Zoho secret/refresh token, Gemini key, SMTP/SMS pwd) | `.env` | **CORRECTION to sub-agent claim: `.env` is NOT git-tracked and NOT in git history** (verified `git ls-files`, `git log --all -- .env` = empty; `.gitignore:1`). Risk is *local-disk / backup exposure*, not a committed leak. Still: rotate if ever shared. |
| P2-2 | Hardcoded business UPI id `7418831122@superyes` | `routes/estimates.js`, `routes/share.js` | Semi-public, but should live in config for rotation. |
| P2-3 | Painter test-account OTP bypass (`123456` for `9999999999`) gated on `NODE_ENV!=='production'` | `routes/painters.js:268-271` | Safe *iff* prod env is correct; single misconfig = auth bypass. |
| P2-4 | `painter_sessions` legacy stores raw `token` column alongside `token_hash` | `migrations/migrate-painters.js` | Reads use hash; raw column is redundant exposure. |
| P2-5 | Upload filter trusts extension/mimetype, no magic-byte check | `routes/wa-marketing.js:~66`, others | Renamed `.exe`→`.pdf` passes. Mitigate + serve `Content-Disposition: attachment`. |
| P2-6 | `Math.random()` for temp PDF filenames | `routes/estimates.js` (several) | Low impact; prefer `crypto.randomBytes`. |
| P2-7 | No rate-limit on authenticated API token validation (login is limited) | `middleware/permissionMiddleware.js` | Token space huge (256-bit), low practical risk. |

### Confirmed GOOD (no action)

- **No SQL injection** — all sampled queries (estimates, painters, leads, zoho, stock-check) use `?` placeholders; dynamic `SET`/`WHERE` build placeholder lists with separate params arrays.
- Passwords bcrypt(10); tokens `crypto.randomBytes(32)` + SHA-256 at rest.
- Stack traces suppressed in production (`middleware/errorHandler.js`).
- Rate limiting: global 100/min, auth 10/min, OTP 5/min.
- helmet + CORS env-whitelist (no `*`).

### Known limitations — accepted, NOT fixing

- **NIT-1: Estimate ↔ Zoho line-total sub-rupee drift.** The estimate stores a
  line total rounded up to ₹10 and a derived `unit_price = line_total/qty`
  (2-decimal). The Zoho push (`services/billing-zoho-service.js:140-144`) sends
  `{ item_id, quantity, rate: unit_price }` and **Zoho recomputes the line as
  rate × qty**, so the Zoho-invoiced line can differ from the estimate line by
  up to ~₹1 (drift ≈ `qty × 0.005`; e.g. `base 1 × qty 199` → estimate ₹200,
  Zoho ₹200.99). Surfaced (not caused) by the 2026-06-04 single-round pricing
  fix — the old code only "reconciled" with Zoho because it overcharged the
  customer to a whole-₹10 unit price. **Decision (owner, 2026-06-05): accept as
  a known limitation.** Zoho is the system-of-record for the actual invoice/GST;
  a code fix would change live invoicing for a sub-rupee cosmetic delta and is
  entangled with the Zoho org's price-precision / line-discount / tax-inclusive
  configuration (unverifiable offline). Revisit only if penny-exact estimate↔Zoho
  parity becomes an audit requirement; any fix MUST be verified on a real Zoho
  draft invoice before deploy. Painter points are unaffected (they use the stored
  `item_total`/`line_total`, not the Zoho-recomputed value).

---

## 5. Top recommendations (sequenced)

1. **Confirm GST intent** (P0-2) with the business — this gates whether estimates math is "wrong" or just mislabeled. Don't touch until confirmed.
2. **Write characterization tests** around `calculateItemPricing`/`calculateEstimateTotals` *before* fixing P0-1 double-rounding (lock current behavior, then change deliberately).
3. Add `qty>0` guard (P1-1) — cheap NaN-prevention.
4. Externalize UPI id + add magic-byte upload validation (P2-2, P2-5).
5. Backfill tests for the untested money paths (estimates, painter points) — biggest risk-reduction per hour.

---

*Sources: live read of `server.js`, `routes/estimates.js`, `routes/salary.js`, `services/painter-points-engine.js`, `services/dpl-catalog.js`, `config/database.js`, `middleware/*`, `migrate.js`, `tests/`, plus `git ls-files`/`git log` verification. Pre-existing `AUDIT-2026-05-01.md` and `LAUNCH-BLOCKERS.md` also present in repo.*
