# Remaining Audit Findings — Live Remediation Tracker

> **Generated:** 2026-06-10 (backlog item T8). This is the live tracker for the 2026-06-08/09 audit findings.
> Update it after every fix batch, or regenerate from scratch (method below).

## Sources

- `docs/audit/2026-06-08-triage.md` — 453 findings (12 P0 / 106 P1 / 335 P2). IDs: `PAGE-xxx`, `RT-xxx`, `SVC-xxx`, `SYS-xxx`, `KN-*`.
- `docs/audit/2026-06-09-product-inventory-analysis.md` — 74 findings (10 P0 / 29 P1 bugs + 35 UX, where UX-1..3 are P1 and UX-4..35 are P2). IDs: `P0-x`, `P1-x`, `UX-x` (scoped to that doc only).

## How this was generated / how to regenerate

1. Extract every finding ID + priority + title from both audit docs (triage doc: `## 3. Master triage` list; product-inventory doc: `### <ID> [tag] <title>` headings).
2. Pull the commit history:
   ```bash
   git log --since=2026-06-01 --pretty=format:"%h %s"
   git log --since=2026-06-01 --pretty=format:"%h%n%B---"   # full bodies
   ```
3. A finding is **FIXED (hash)** when its ID is named in a commit subject/body (incl. slash shorthand like `PAGE-135/140/142`).
   It is **LIKELY FIXED (hash — verify)** when a commit body unambiguously *describes* the finding without naming its ID
   (the Product/Inventory phase commits `c6835f1`/`578d695`/`2e6f7b8`/`68e3632`/`ae58da9` use their own A1-A13/phase numbering, never the doc IDs).
   Everything else is **OPEN**. ID mentions in a "deferred" context do NOT count as fixed (see SYS-001).

## Reconciliation & honesty notes

- Triage doc parse reconciles **exactly**: 453 findings = 12 P0 + 106 P1 + 335 P2, no duplicate IDs. Matches the doc's own summary matrix.
- Product-inventory doc reconciles with its own header: 74 = 10 P0 + 29 P1 + 35 UX (3 UX at P1, 32 at P2).
- The two docs were **not deduplicated against each other** — some product-inventory findings may overlap triage findings (e.g. purple-brand or mobile-table items). Counted separately, as the docs do.
- `KN-P0-1`, `RT-061`, `SYS-011` were already resolved *when the triage doc was written* (their own titles say so); they are counted FIXED, not as new work.
- `PAGE-006`/`PAGE-264` describe the same bug (both fixed by 748f0f7); `PAGE-034`/`PAGE-035` are two facets of the same page. The doc counts them separately, so this tracker does too.
- `SYS-001` (native alert/confirm migration) is OPEN: commit 43df35a explicitly records it as "deferred per decision — 660 call sites".
- "LIKELY FIXED" rows need human/code verification before being moved to FIXED — the mapping is by commit-body description, not by ID.

## Summary

| Priority | Total | Fixed | Likely fixed (verify) | Open |
|---|---|---|---|---|
| **P0** | 22 | 12 | 4 | 6 |
| **P1** | 138 | 56 | 22 | 60 |
| **P2** | 367 | 48 | 1 | 318 |
| **Total** | **527** | **116** | **27** | **384** |

Per source doc:

| Doc | Priority | Total | Fixed | Likely | Open |
|---|---|---|---|---|---|
| 2026-06-08-triage | P0 | 12 | 12 | 0 | 0 |
| 2026-06-08-triage | P1 | 106 | 56 | 7 | 43 |
| 2026-06-08-triage | P2 | 335 | 48 | 0 | 287 |
| 2026-06-09-product-inventory | P0 | 10 | 0 | 4 | 6 |
| 2026-06-09-product-inventory | P1 | 32 | 0 | 15 | 17 |
| 2026-06-09-product-inventory | P2 | 32 | 0 | 1 | 31 |

---

## P0 — OPEN (6)

### From `2026-06-09-product-inventory-analysis.md` (6)

| ID | Title | File / area | Note |
|---|---|---|---|
| P0-5 | Price Calculator 'Apply & Sync', Health 'Sync Purchase' & 'Recalculate Sales' send new_dpl but dpl-apply requires `dpl` → 400 | `public/admin-item-master.html:1660,2185,2191,2217,2223 vs routes/item-master.js:86-93 (dplApplySchema) + 532 (validate(dplApplySchema))` | follow-up promised in 68e3632 (Price Calc apply-sync) |
| P0-6 | Auto-Generate Names / Auto-fix Name Format send zoho_item_ids but generate-names requires `brand` → 400 | `public/admin-item-master.html:1048 (generateNamesSelected) & 2148 (bulkFixNameFormat) vs routes/item-master.js:81-84 (generateNamesSchema) + 387 (validate(generateNamesSchema))` | follow-up promised in 68e3632 (Auto-Generate Names) |
| P0-7 | Health Check tab reads summary.total_*/issues[type] arrays but API returns totalItems/issuesByType counts + items[] — entire tab shows 0 / empty | `public/admin-item-master.html:2028-2102 (renderHealthResults) & 2012-2015 vs routes/item-master.js:740-748 (health-check response)` | follow-up promised in 68e3632 (Health tab) |
| P0-8 | DPL PDF parse→match flow is broken: route response shape does not match what the frontend reads | `routes/item-master.js:493-529 (dpl-parse, dpl-match) vs public/admin-item-master.html:1276-1295` | follow-up promised in 68e3632 (DPL PDF parse) |
| P0-9 | DPL apply (core money mutation) rejected by its own zod schema — frontend sends `new_dpl`, schema requires `dpl` | `routes/item-master.js:86-93 (dplApplySchema) + 532-548 (dpl-apply) vs public/admin-item-master.html:1660,1674-1680` | follow-up promised in 68e3632 (dpl-apply contract) |
| P0-10 | Concurrent /adjust/:id pushes duplicate Zoho inventory adjustments (real-money double-counting) | `routes/stock-check.js:870-1012 — POST /adjust/:id handler` | explicitly deferred in 2e6f7b8 (needs concurrency design + prod verify) |

## P1 — OPEN (60)

### From `2026-06-08-triage.md` (43)

| ID | Title | File / area | Note |
|---|---|---|---|
| SYS-004 | Five+ inconsistent escape-helper names with per-page reimplementations; ~55 pages set innerHTML from template literals | `(systemic ×90)` |  |
| PAGE-145 | Salary basis uses base_salary/260 — matches known salary-calc inconsistency | `public/admin-salary-monthly.html` |  |
| PAGE-036 | Unescaped server data injected into innerHTML (stored XSS) | `public/customer-requests.html` |  |
| KN-P1-1 | Markup/discount total_pct/total_value divide by quantity with no qty>0 guard → NaN | `routes/estimates.js:64,67,85,88` |  |
| RT-036 | Geofence auto-clockout scheduler silently disabled if ZOHO_ORGANIZATION_ID unset | `routes/routes/attendance.js.js` | possibly covered by 68d75b9 (scheduler de-gating) but its body does not name the geofence auto-clockout cron - verify before closing |
| RT-016 | Backfill run mutates historical points (Dec 2025+) without idempotency | `routes/routes/painter-marketing.js.js` |  |
| RT-042 | GET /registrations/:id/offer-letter has NO auth gate | `routes/routes/staff-registration.js.js` | possibly addressed alongside 1b50afc (PAGE-116 authenticated blob fetch) - verify the route itself now enforces auth |
| KN-TESTDEBT | High-value money/auth paths UNTESTED (estimate calc, painter points/clawback, salary OT/leave, auth/OTP, leads, Zoho sync) | `tests/ (gaps)` |  |
| SYS-001 | Native browser dialogs (alert/confirm) used app-wide instead of qc-ui primitives — qcToast/qcConfirm/qcAlert effectively dead | `(systemic ×90)` | explicitly DEFERRED per decision in 43df35a body (660 native alert/confirm call sites) |
| PAGE-175 | Native confirm() guards money-critical actions (bulk-set, Zoho sync) | `public/admin-credit-limits.html` |  |
| PAGE-167 | Native alert()/confirm() for all CRUD feedback | `public/admin-customer-types.html` |  |
| PAGE-162 | Native alert()/confirm() for all CRUD feedback | `public/admin-customers.html` |  |
| PAGE-155 | Native alert()/confirm() everywhere instead of qc-ui toast/confirm | `public/admin-leads.html` |  |
| PAGE-179 | 119 native alert()/confirm() calls across the entire console (no qc-ui) | `public/admin-painters.html` |  |
| PAGE-153 | Does not load the design system; mixed orange + purple inline theme | `public/admin-salary-reports.html` |  |
| PAGE-233 | Pervasive native alert()/confirm() for all CRUD feedback and deletes | `public/admin-wa-contacts.html` |  |
| PAGE-025 | Purple brand throughout a staff-facing page (brand violation) | `public/chat.html` |  |
| PAGE-012 | Full purple theme on customer auth entry | `public/customer-login.html` |  |
| PAGE-016 | Native confirm()/alert() instead of qc-ui primitives | `public/dashboard.html` |  |
| PAGE-311 | Brand: primary 'Submit Order Request' and savings/discount colors mixed blue/green | `public/engineer-cart.html` |  |
| PAGE-308 | Brand: catalog uses blue throughout (add buttons, focus rings, cart count, price-now disc color is green but actions blue) | `public/engineer-catalog.html` |  |
| PAGE-304 | Brand: blue primary CTAs + blue active rail item on a green/gold portal | `public/engineer-dashboard.html` |  |
| PAGE-298 | BRAND VIOLATION: engineer portal primary color is blue (#2563EB), not green+gold | `public/engineer-login.html` |  |
| PAGE-313 | Brand: 'Submit Quotation Request' primary button + accent links render blue | `public/engineer-new-quote.html` |  |
| PAGE-316 | Brand: blue primary Save button and blue badge/status accents | `public/engineer-profile.html` |  |
| PAGE-300 | Brand: primary 'Submit Application' button renders blue, not green/gold | `public/engineer-register.html` |  |
| PAGE-044 | Brand violation: purple on a staff page | `public/estimate-actions.html` |  |
| PAGE-047 | Brand violation: purple primary color throughout a staff page | `public/estimate-create-new.html` |  |
| PAGE-054 | Brand violation: purple toggles/buttons on a staff page | `public/estimate-settings.html` |  |
| PAGE-057 | Brand violation: purple document header/totals on a staff page | `public/estimate-view.html` |  |
| PAGE-058 | Native prompt()/alert() for receipt/reference/PO phone entry | `public/estimate-view.html` |  |
| PAGE-061 | Brand violation: purple chips/spinners/modal header on a staff page | `public/estimates.html` |  |
| PAGE-001 | 2FA modal uses indigo/purple instead of brand green+gold | `public/login.html` |  |
| PAGE-283 | Variant-count uses indigo text on a green/gold painter page (brand violation) | `public/painter-catalog.html` |  |
| PAGE-279 | Native alert()/confirm() for withdrawal and AP-claim flows | `public/painter-dashboard.html` |  |
| PAGE-293 | Page is English-only on a bilingual portal (no i18n, zero data-i18n) | `public/painter-estimate-create.html` |  |
| PAGE-003 | Full purple theme (#667eea/#764ba2) on an auth-entry page | `public/register.html` |  |
| PAGE-248 | Purple brand violation on staff page (status-converted pill) | `public/staff-billing.html` |  |
| PAGE-261 | Purple brand violation on staff page (badge-converted) | `public/staff-painter-marketing.html` |  |
| PAGE-268 | Purple brand violation on staff page (status-quote_sent) | `public/staff-requests.html` |  |
| PAGE-271 | Purple brand violation on staff page (.ai-badge) | `public/staff-vendors.html` |  |
| SYS-005 | Service worker registers unconditionally inside the Android WebView (no isAndroidApp() guard) | `(systemic ×106)` |  |
| PAGE-067 | No viewport meta — not mobile responsive | `public/birla-opus-report.html` |  |

### From `2026-06-09-product-inventory-analysis.md` (17)

| ID | Title | File / area | Note |
|---|---|---|---|
| P1-2 | Price History timeline/CSV read item_name/sku/brand/version_label but API returns zoho_* + version_brand → rows blank | `public/admin-item-master.html:1781-1782,1815,1840-1841,1885,1952-1954 vs routes/item-master.js:661-663 (SELECT)` | follow-up promised in 68e3632 (Price History tab) |
| P1-3 | Per-item price timeline drill-down reads data.data.history but /price-history/:itemId returns data as a flat array → always 'No history' | `public/admin-item-master.html:1880 (loadItemTimeline) vs routes/item-master.js:700 (res.json({ success:true, data: rows }))` | follow-up promised in 68e3632 (Price History tab) |
| P1-6 | Price History date filter ignored — frontend sends start_date/end_date, API reads from_date/to_date | `public/admin-item-master.html:1745-1746 (loadPriceHistory) vs routes/item-master.js:106-112 (priceHistoryQuerySchema) + 625 (handler reads from_date/to_date)` | follow-up promised in 68e3632 (Price History tab) |
| P1-7 | Entire AI command bar / KAI bulk-edit subsystem is unreachable — markup removed but ~500 lines of JS + CSS remain | `admin-zoho-items-edit.html:1783 runAiCommand() (also setAiCommand:1232, tryDeterministicBulkUpdate:1583, tryDescriptionFromName:1415, applyBulkUpdate:1736, applyDescFromName:1533); CSS refs at :96-98` | product decision needed (doc tag: product-decision) |
| P1-13 | Product search dropdown builds onclick from un-sanitized name/SKU and renders name unescaped | `public/admin-stock-check.html:770-773 (searchProducts)` | deferred in c6835f1 (needs data-attr refactor) |
| P1-14 | init() and several fetches have no try/catch — a failed branch/inventory/dashboard load throws and leaves 'Loading...' forever | `public/admin-stock-check.html:685-715 (init), 720-750 (loadBranchData), 1169-1208 (loadReviewList), 1452-1484 (loadDashboard), 1486-1513 (loadSuggestions)` | deferred in c6835f1 (A11 try/catch) |
| P1-15 | Item detail "Stock by Location" table never renders (array vs object mismatch) | `public/admin-zoho-stock.html:872 (renderDetailContent) + :612 (loadItemDetail)` |  |
| P1-16 | Single-branch transfer ignores the in-progress lock → concurrent/duplicate Zoho inventory adjustments | `public/admin-stock-migration.html:402-442 (transferBranch)` | explicitly deferred in 2e6f7b8 |
| P1-17 | Item names break onclick handlers / allow JS injection (escapeHtml does not escape single quotes) | `admin-zoho-reorder.html:1844 selectItem dropdown render; also :1212/1215 (renderAlerts PO+Snooze), :1844 (searchItems), :3667 (loadSnoozedItems unsnooze) — every onclick="fn('...')" built with escapeHtml` |  |
| P1-19 | Painter detail variant rows ('Available Sizes') do nothing — pass undefined item_id and use a query param the estimate page ignores | `public/painter-catalog.html:752 (variant row onclick) + :814-817 (createEstimateWith)` |  |
| P1-21 | POST /naming-rules omits NOT NULL `category` column → INSERT fails under strict SQL mode | `routes/item-master.js:359-373 (POST /naming-rules); table def migrations/migrate-item-master.js:8-21` | explicitly deferred in 2e6f7b8 |
| P1-23 | dpl-apply: price-history INSERT and item UPDATE not transactional, and no idempotency on a financial POST | `routes/item-master.js:532-581 (POST /dpl-apply)` | explicitly deferred in 2e6f7b8 |
| P1-26 | /self-request inserts NaN difference and unvalidated item_ids — corrupts data and later pushes phantom Zoho adjustments | `routes/stock-check.js:746-774 — POST /self-request item loop` | explicitly deferred in 2e6f7b8 |
| P1-27 | 9205 retry-minus-one matches Zoho error by raw item_name — wrong/partial-name match silently drops the wrong line or loops | `routes/stock-check.js:990-1000 — adjust handler insufficient-stock retry` |  |
| P1-29 | Per-line-item location_id bypasses branch-isolation check on inventory adjustments | `routes/zoho.js:2261-2287 POST /inventory-adjustments` | explicitly deferred in 2e6f7b8 |
| UX-1 | Zoho-uncovered view renders blank on mobile (card renderer never reached) | `public/admin-dpl.html:4400-4404 (renderAiTable) + dead renderZohoUncoveredCards at :4218` |  |
| UX-2 | Edit slide-panel is fixed 400px wide with no breakpoint — overflows viewport on phones <400px | `public/admin-item-master.html:39 (.slide-panel CSS)` |  |

## P2 — OPEN (318)

### From `2026-06-08-triage.md` (287)

| ID | Title | File / area | Note |
|---|---|---|---|
| KN-P2-1 | Secrets live in .env (verified NOT git-tracked / NOT in history) | `.env` |  |
| SYS-003 | Inline event handlers (onclick=) used at massive scale — incompatible with a CSP that drops 'unsafe-inline' | `(systemic ×141)` |  |
| SYS-010 | Session IP/User-Agent captured at login but never validated on session resolution | `(systemic ×3)` |  |
| KN-LINT | 294 ESLint warnings (0 errors) — mostly no-unused-vars | `eslint (whole repo)` |  |
| SVC-033 | execFile to Clawdbot CLI is an external-process dependency | `integration:AI integration (ai-engine, triple-provider)` |  |
| SVC-034 | Disabled silently if service-account path unset | `integration:FCM integration (fcm-admin)` |  |
| SVC-036 | Web Push silently disabled if VAPID keys unset | `integration:Web Push + multi-channel dispatch (notification-service)` |  |
| SVC-031 | whatsapp-web.js is an optional dependency — silently disabled | `integration:WhatsApp integration (whatsapp-session-manager + whatsapp-processor + wa-campaign-engine)` |  |
| SVC-032 | WhatsApp tied to Zoho gate | `integration:WhatsApp integration (whatsapp-session-manager + whatsapp-processor + wa-campaign-engine)` |  |
| SVC-028 | Org id read from env per-call, refresh token persisted from .env | `integration:Zoho Books integration (zoho-api + zoho-oauth + zoho-rate-limiter + zoho-invoice-line-sync + billing-zoho-service)` |  |
| SVC-029 | Rate limiter daily date keyed to IST string | `integration:Zoho Books integration (zoho-api + zoho-oauth + zoho-rate-limiter + zoho-invoice-line-sync + billing-zoho-service)` |  |
| SVC-030 | Module-level token cache only, no DB persistence | `integration:Zoho Payments integration (zoho-payments-service)` |  |
| KN-P2-7 | No rate-limit on authenticated token validation (login is limited) | `middleware/permissionMiddleware.js` |  |
| KN-P2-4 | painter_sessions stores legacy raw token column alongside token_hash | `migrations/migrate-painters.js` |  |
| PAGE-130 | Page defines its own getAuthHeaders() duplicating the global helper | `public/admin-branches.html` |  |
| PAGE-177 | openApproveModal/openRejectModal build onclick with unescaped name in single-quoted JS string | `public/admin-credit-limits.html` |  |
| PAGE-123 | Photo URLs interpolated into onclick attribute without quote-safety | `public/admin-daily-tasks.html` |  |
| PAGE-168 | openDetail refetches full list (limit=100) to find one request instead of the existing GET-by-id | `public/admin-design-requests.html` |  |
| PAGE-188 | Phone hardcodes '+91 ' prefix in table + modal | `public/admin-engineers.html` |  |
| PAGE-172 | filterByStatus relies on global event.target — breaks if invoked without a click | `public/admin-estimate-requests.html` |  |
| PAGE-106 | Header injected via fetch into innerHTML (header-v2.html) | `public/admin-guides.html` |  |
| PAGE-194 | Touches §6 critical DPL pricing path with no client-side guardrails | `public/admin-item-master.html` |  |
| PAGE-072 | role-badge class uses raw u.role without normalization/escape | `public/admin-live-dashboard.html` |  |
| PAGE-074 | Job last_error, error message and table names injected without HTML-escaping | `public/admin-monitoring.html` |  |
| PAGE-182 | Estimate total scraped from DOM via brittle querySelector | `public/admin-painters.html` |  |
| PAGE-108 | Category pill onclick uses unescaped key in single quotes | `public/admin-photos.html` |  |
| PAGE-193 | Local getAuthHeaders duplicates the global helper | `public/admin-products.html` |  |
| PAGE-090 | Profile image only saved if other profile fields also save — and image upload errors are swallowed | `public/admin-profile.html` |  |
| PAGE-150 | Pay-Now deep link parameter likely mismatched with target page | `public/admin-salary-payments.html` |  |
| PAGE-088 | System Information values are hardcoded fictional data | `public/admin-settings.html` |  |
| PAGE-076 | switchTab() relies on global event.target — breaks if invoked without a click event | `public/admin-system-health.html` |  |
| PAGE-078 | showErrorDetail fetches by id via free-text search param — can mis-resolve to wrong error | `public/admin-system-health.html` |  |
| PAGE-239 | Reads token from localStorage + manual Bearer header instead of auth-helper | `public/admin-wa-admin-login.html` |  |
| PAGE-240 | QR polling depends on window.qcSocket but socket.io script not loaded on this page | `public/admin-wa-admin-login.html` |  |
| PAGE-234 | escAttr mismatched escaping for double-quoted onclick attributes | `public/admin-wa-contacts.html` |  |
| PAGE-237 | Reads auth token from localStorage directly instead of getAuthHeaders() | `public/admin-wa-settings.html` |  |
| PAGE-236 | escAttr backslash-escapes quotes inside a double-quoted onclick — a " in template name breaks the handler / attribute | `public/admin-wa-templates.html` |  |
| PAGE-112 | Image values (image_url) interpolated into <img src> via esc() only | `public/admin-website.html` |  |
| PAGE-245 | Branch sessions have no initial QR poll — QR only arrives via socket or a manual refetch on already-pending state | `public/admin-whatsapp-sessions.html` |  |
| PAGE-210 | bulk-update sends raw rate to Zoho with only client-side validation | `public/admin-zoho-items.html` |  |
| PAGE-230 | WhatsApp API key sent as empty string on save when field left blank | `public/admin-zoho-settings.html` |  |
| PAGE-222 | escapeHtml(locationId) passed through single-quoted onclick handler | `public/admin-zoho-transactions.html` |  |
| PAGE-069 | Stale hardcoded snapshot (483 products, 'Apr 2026') with no live source | `public/birla-opus-report.html` |  |
| PAGE-029 | Customer identity is faked with a hardcoded phone fallback | `public/customer-dashboard.html` |  |
| PAGE-033 | esc() omits quotes; weaker than other pages | `public/customer-estimate-view.html` |  |
| PAGE-013 | resendOTP swallows errors and never surfaces failure | `public/customer-login.html` |  |
| PAGE-303 | Account snapshot shows hardcoded 'Outstanding Balance ₹ 0.00' and static Loyalty Tier | `public/engineer-dashboard.html` |  |
| PAGE-312 | Requestor fields hydrated from localStorage before /me refresh — shows stale/blank name if storage cleared | `public/engineer-new-quote.html` |  |
| PAGE-315 | GSTIN saved with no 15-char format validation | `public/engineer-profile.html` |  |
| PAGE-299 | GSTIN collected but never validated client-side (and no district/pincode despite backend support) | `public/engineer-register.html` |  |
| PAGE-049 | Entire page body is dead code behind an unconditional redirect | `public/estimate-edit.html` |  |
| PAGE-053 | Branding details written to innerHTML | `public/estimate-print.html` |  |
| PAGE-056 | GST 'breakdown @18%' option may mislead vs GST-inclusive policy | `public/estimate-settings.html` |  |
| PAGE-009 | Enumeration-safe stub path can produce a dead-end reset | `public/forgot-password.html` |  |
| PAGE-010 | otpSentMsg uses innerHTML with interpolated mobile | `public/forgot-password.html` |  |
| PAGE-002 | 2FA finally-block can re-enable the rate-limit lockout button | `public/login.html` |  |
| PAGE-288 | Success-card field name mismatch -> branch/points blank or fallback | `public/painter-attendance.html` |  |
| PAGE-284 | Self-billing earnings hard-coded 'Regular: 0 pts' in detail panel | `public/painter-catalog.html` |  |
| PAGE-281 | Annual withdrawal-window 'open' check is client-side date math only | `public/painter-dashboard.html` |  |
| PAGE-277 | New-user path keys off res.status===404 but send-otp success branch returns first | `public/painter-register.html` |  |
| PAGE-291 | Featured filter shows all when no items flagged is_featured (logic ambiguity) | `public/painter-training.html` |  |
| PAGE-292 | notifBadge uses data.unread_count but also computes unused local unread | `public/painter-training.html` |  |
| PAGE-024 | Effective/Last-Updated date stale (Feb 12 2025) while policy claims continuous data practices | `public/privacy-policy.html` |  |
| PAGE-263 | Raw error.message from a thrown fetch shown in list area; non-JSON error not handled | `public/staff-painter-marketing.html` |  |
| PAGE-266 | OTP / availability error messages rendered via showAlert innerHTML from server fields | `public/staff-register.html` |  |
| KN-P2-6 | Weak RNG (JS pseudo-random) for temp filenames | `routes/estimates.js (temp PDF names)` |  |
| KN-P2-2 | Hardcoded UPI id 7418831122@superyes | `routes/estimates.js, routes/share.js` |  |
| RT-023 | Upload accepts documents with extension/mimetype validation only | `routes/routes/agreements.js.js` |  |
| RT-009 | POST /chat to LLM with user-supplied prompt — prompt-injection / cost surface | `routes/routes/ai.js.js` |  |
| RT-011 | Anomaly list/detail readable by any authenticated user | `routes/routes/anomalies.js.js` |  |
| RT-037 | Clock-in/out photo uploads validated by mimetype only | `routes/routes/attendance.js.js` |  |
| RT-033 | Money is JS float with Math.round(x*100)/100 (no integer paise) | `routes/routes/billing.js.js` |  |
| RT-005 | GET /list only requireAuth (branch list leaks to any staff) | `routes/routes/branches.js.js` |  |
| RT-002 | No per-conversation membership re-check assumed | `routes/routes/chat.js.js` |  |
| RT-025 | :customerId routes declared after specific paths — collision risk | `routes/routes/credit-limits.js.js` |  |
| RT-047 | Photo uploads validated by mimetype only | `routes/routes/daily-tasks.js.js` |  |
| RT-048 | Engineer order/quote creation lacks idempotency | `routes/routes/engineers.js.js` |  |
| RT-049 | Engineer credit limit set via requirePermission only | `routes/routes/engineers.js.js` |  |
| RT-054 | Accepts auth token via query string (?token=) | `routes/routes/estimate-pdf.js.js` |  |
| RT-055 | Launches a Puppeteer browser per request | `routes/routes/estimate-pdf.js.js` |  |
| RT-063 | Hardcoded UPI id + Math.random temp PDF filenames | `routes/routes/estimates.js.js` |  |
| RT-058 | DPL pricing engine gated by requireAuth only (no granular permission) | `routes/routes/item-master.js.js` |  |
| RT-059 | DPL PDF/price-list uploads validated by mimetype only | `routes/routes/item-master.js.js` |  |
| RT-034 | Convert flow writes customer + estimate without idempotency | `routes/routes/leads.js.js` |  |
| RT-035 | Bulk parse/create — confirm parameterization + row caps | `routes/routes/leads.js.js` |  |
| RT-012 | execSync used for host metrics (df, pm2) | `routes/routes/monitoring.js.js` |  |
| RT-003 | VAPID public key endpoint is unauthenticated | `routes/routes/notifications.js.js` |  |
| RT-015 | POST /staff/leads/from-lead gated by bare requireAuth | `routes/routes/painter-marketing.js.js` |  |
| RT-051 | painter_sessions dual-writes raw token alongside token_hash | `routes/routes/painters.js.js` |  |
| RT-052 | Painter estimate uses gst_amount=0 path (inclusive) — label risk in PDF | `routes/routes/painters.js.js` |  |
| RT-038 | Generated price list exposes DPL-derived pricing — confirm intended audience | `routes/routes/price-list.js.js` |  |
| RT-001 | Misfiled as a route under routes/ | `routes/routes/product-pricing-helpers.js.js` |  |
| RT-041 | No single net_salary summary computed | `routes/routes/salary.js.js` |  |
| RT-056 | Hardcoded UPI id on public pay surface | `routes/routes/share.js.js` |  |
| RT-057 | Public token: verify expiry + revocation | `routes/routes/share.js.js` |  |
| RT-043 | Public Aadhaar upload validated by extension/mimetype only | `routes/routes/staff-registration.js.js` |  |
| RT-028 | save-progress/submit/self-request accept upload.any() | `routes/routes/stock-check.js.js` |  |
| RT-004 | Bulk transfer-all is a high-blast-radius write with no idempotency | `routes/routes/stock-migration.js.js` |  |
| RT-018 | POST /errors/log-client accepts client-supplied error payloads | `routes/routes/system.js.js` |  |
| RT-024 | PATCH /:id/status & /progress only requireAuth (no assignee binding shown) | `routes/routes/tasks.js.js` |  |
| RT-020 | Bill scan OCR upload trusts file type | `routes/routes/vendors.js.js` |  |
| RT-014 | Bulk /import has no row-cap / dedup guard visible | `routes/routes/wa-contacts.js.js` |  |
| RT-006 | Upload filter trusts extension/mimetype (no magic-byte check) | `routes/routes/wa-marketing.js.js` |  |
| RT-007 | Instant-send / start campaign are bulk-send with no idempotency | `routes/routes/wa-marketing.js.js` |  |
| RT-045 | Public content endpoints — ensure no admin-only fields leak | `routes/routes/website.js.js` |  |
| RT-044 | send-media upload no magic-byte validation | `routes/routes/whatsapp-chat.js.js` |  |
| RT-031 | QR endpoints expose WhatsApp login QR to permission holders | `routes/routes/whatsapp-sessions.js.js` |  |
| RT-065 | cf_* custom-field push must wrap into custom_fields[] (regression-prone) | `routes/routes/zoho.js.js` |  |
| RT-066 | Bulk sync / push endpoints lack idempotency | `routes/routes/zoho.js.js` |  |
| SVC-005 | getStalLeads typo could be a latent bug | `scheduler:ai-scheduler.js` |  |
| SVC-006 | All AI jobs depend on a single Clawdbot CLI provider | `scheduler:ai-scheduler.js` |  |
| SVC-014 | PDF links hardcode production domain | `scheduler:attendance-report.js` |  |
| SVC-012 | Overlapping geo enforcement with server.js 60s cron | `scheduler:auto-clockout.js` |  |
| SVC-013 | Stale-record cleanup hardcodes 10 PM IST / 10h fallback | `scheduler:auto-clockout.js` |  |
| SVC-022 | DELETE windows use NOW() (UTC) but cron is IST | `scheduler:data-retention-service.js` |  |
| SVC-018 | Collides at 8 AM with lead-reminder-scheduler and painter credit-check | `scheduler:lead-auto-assign-scheduler.js` |  |
| SVC-010 | Comment says 03:30 backfill but code is 03:45 (and log says 03:30) | `scheduler:painter-marketing-scheduler.js` |  |
| SVC-011 | Lead recycle date math is UTC-based via addDays(setUTCDate) | `scheduler:painter-marketing-scheduler.js` |  |
| SVC-008 | Slab/quarter date math uses server-local Date, not IST-safe | `scheduler:painter-scheduler.js` |  |
| SVC-009 | Two cron jobs collide at 02:30 IST | `scheduler:painter-scheduler.js` |  |
| SVC-024 | DB pool used% computed against hardcoded 20 | `scheduler:production-monitor.js` |  |
| SVC-002 | Geofence enforcement duplicated between auto-clockout.js and server.js | `scheduler:server.js scheduler bootstrap (ZOHO_ORGANIZATION_ID gate)` |  |
| SVC-003 | calculateNextRun is a rough approximation, not real cron parsing | `scheduler:sync-scheduler.js` |  |
| SVC-004 | Quota/circuit-breaker skips are silent for the operator | `scheduler:sync-scheduler.js` |  |
| SVC-027 | lead-reminder-scheduler bypasses this guard | `service:cluster-guard.js` |  |
| SVC-041 | Audit failures swallowed by design | `service:customer-auth.js + totp-service.js + audit-log.js` |  |
| SVC-038 | Money path with sparse tests (per CLAUDE.md) | `service:painter-points-engine.js` |  |
| SVC-039 | Most brand parsers beyond Birla Opus are incomplete | `service:price-list-parser.js + dpl-catalog.js` |  |
| SVC-020 | zoho_sync_log direction misuse documented in header | `service:reorder-compute-service.js` |  |
| SVC-026 | Auto health checks only run with Zoho configured | `service:system-health-service.js` |  |
| SVC-040 | Reads whole image into memory synchronously | `service:vendor-bill-ai-service.js` |  |
| KN-IPUA | Session IP/User-Agent captured but never validated (DECISION NEEDED) | `session middleware` |  |
| SYS-008 | Raw <table> markup without any horizontal-scroll affordance on 11 data pages (mobile/WebView overflow) | `(systemic ×11)` |  |
| SYS-002 | Loading skeletons / empty-state helpers (ui-skeletons.js) built but adopted on only 1 page | `(systemic ×158)` |  |
| PAGE-020 | Off-brand blue theme (#2563eb) — not green/gold or admin purple | `public/404.html` |  |
| PAGE-021 | 'Go to Dashboard' link assumes admin dashboard regardless of actor | `public/404.html` |  |
| PAGE-099 | Send reminder / send-to-all use native alert() and confirm() | `public/admin-activity-monitor.html` |  |
| PAGE-101 | assign-all uses native alert() for success feedback | `public/admin-agreements.html` |  |
| PAGE-082 | Delete conversation uses native confirm() | `public/admin-ai.html` |  |
| PAGE-079 | Resolve anomaly uses native prompt() | `public/admin-anomalies.html` |  |
| PAGE-120 | Native prompt()/confirm() for force clock-out reason and bulk WhatsApp | `public/admin-attendance.html` |  |
| PAGE-129 | Native alert()/confirm() throughout | `public/admin-branches.html` |  |
| PAGE-199 | Native alert()/confirm() for all feedback | `public/admin-brands.html` |  |
| PAGE-093 | Create bug + status/delete actions use native alert()/confirm() | `public/admin-bug-reports.html` |  |
| PAGE-094 | Insight/analysis blocks build Tailwind classes from interpolated severity ('bg-${color}-50') | `public/admin-bug-reports.html` |  |
| PAGE-095 | steps_to_reproduce placeholder shows literal \n escape sequences | `public/admin-bug-reports.html` |  |
| PAGE-202 | Native alert()/confirm() for all feedback | `public/admin-categories.html` |  |
| PAGE-176 | checkPagePermissions uses native alert() before redirect | `public/admin-credit-limits.html` |  |
| PAGE-178 | Utilization 'over_80' bucket also catches exceeded; util capped at 150 but bar uses min(util,100) | `public/admin-credit-limits.html` |  |
| PAGE-164 | No loading skeleton / empty-state for table; relies on alert on load failure | `public/admin-customers.html` |  |
| PAGE-125 | Native alert() on template save/delete | `public/admin-daily-tasks.html` |  |
| PAGE-070 | Notice posting uses native alert() instead of qc-ui toast/confirm | `public/admin-dashboard.html` |  |
| PAGE-169 | Native alert() for several error paths and 'no photo' guard | `public/admin-design-requests.html` |  |
| PAGE-195 | Native confirm() gates every Zoho push / unlink (money path) | `public/admin-dpl.html` |  |
| PAGE-189 | Native confirm() for delete-rate / restore-item | `public/admin-engineer-catalog.html` |  |
| PAGE-190 | loadHidden() never auto-invoked until tab clicked; initial load only does rates | `public/admin-engineer-catalog.html` |  |
| PAGE-191 | Default-rate add onclick handlers are fine but item-picker results have no empty/loading skeleton | `public/admin-engineer-catalog.html` |  |
| PAGE-186 | Native confirm() for destructive actions (suspend/delete/remove-rate) | `public/admin-engineers.html` |  |
| PAGE-187 | Brand: engineer admin page is purple while companion engineer-catalog matches | `public/admin-engineers.html` |  |
| PAGE-173 | Native alert() for all detail/status feedback + 30s full reload | `public/admin-estimate-requests.html` |  |
| PAGE-122 | No empty/loading skeleton component; plain text only | `public/admin-geofence-logs.html` |  |
| PAGE-105 | All destructive guide/category actions use native confirm() | `public/admin-guides.html` |  |
| PAGE-159 | Native confirm() for nurture campaign trigger | `public/admin-lead-scoring.html` |  |
| PAGE-160 | Custom inline showToast instead of shared qc-ui primitives | `public/admin-lead-scoring.html` |  |
| PAGE-161 | No loading skeleton / empty-state polish on overview cards | `public/admin-lead-scoring.html` |  |
| PAGE-075 | Refresh button + integration cards use the admin purple gradient — correct for admin, but partial-load cards have no skeleton/empty state for failed overview | `public/admin-monitoring.html` |  |
| PAGE-184 | Drag reorder is not keyboard/touch-accessible and has no mobile fallback for global order | `public/admin-painter-catalog.html` |  |
| PAGE-185 | Different nav-mount convention than sibling admin pages | `public/admin-painter-catalog.html` |  |
| PAGE-180 | Brand inconsistency: admin-painters uses purple/indigo while sibling admin-painter-catalog uses green | `public/admin-painters.html` |  |
| PAGE-109 | Manual cleanup uses native confirm()/alert() for a destructive bulk-delete | `public/admin-photos.html` |  |
| PAGE-204 | Native alert() for WhatsApp send + error feedback | `public/admin-price-list-generator.html` |  |
| PAGE-192 | Native alert()/confirm() throughout instead of qc-ui primitives | `public/admin-products.html` |  |
| PAGE-091 | Disable 2FA uses native confirm() | `public/admin-profile.html` |  |
| PAGE-092 | Aadhar/PAN proof preview shows a data: URL of a KYC document inline | `public/admin-profile.html` |  |
| PAGE-085 | Duplicate/late auth check after page already rendered | `public/admin-reports.html` |  |
| PAGE-134 | Brand-correct toast already present — but no skeleton on permission load | `public/admin-role-permissions.html` |  |
| PAGE-132 | Native alert() for all load/save feedback | `public/admin-roles.html` |  |
| PAGE-143 | Native alert() for all feedback | `public/admin-salary-advances.html` |  |
| PAGE-138 | Native alert() for save feedback | `public/admin-salary-config.html` |  |
| PAGE-141 | Native alert()/confirm()/prompt() for all actions | `public/admin-salary-incentives.html` |  |
| PAGE-151 | Native alert() on missing-month | `public/admin-salary-payments.html` |  |
| PAGE-087 | All save flows use native alert() for success/error | `public/admin-settings.html` |  |
| PAGE-089 | Tax & Estimate tabs save but never re-load their values from server on tab open | `public/admin-settings.html` |  |
| PAGE-117 | Pervasive native alert()/confirm() for all feedback | `public/admin-staff-registrations.html` |  |
| PAGE-115 | Native alert()/confirm() instead of qc-ui primitives | `public/admin-staff.html` |  |
| PAGE-206 | Native confirm()/alert() for Zoho stock-push (mutates stock levels) | `public/admin-stock-check.html` |  |
| PAGE-207 | Several .sc-table data tables not wrapped for horizontal scroll | `public/admin-stock-check.html` |  |
| PAGE-209 | Native confirm() for irreversible warehouse-disable | `public/admin-stock-migration.html` |  |
| PAGE-077 | Error resolve uses native prompt() for resolution notes | `public/admin-system-health.html` |  |
| PAGE-126 | Native confirm() for task deletion | `public/admin-tasks.html` |  |
| PAGE-127 | Search filter fires a network request on every keyup (no debounce) | `public/admin-tasks.html` |  |
| PAGE-238 | Native confirm() for disconnect | `public/admin-wa-admin-login.html` |  |
| PAGE-232 | Unpinned Chart.js CDN (chart.js latest) — supply-chain / breaking-change risk | `public/admin-wa-dashboard.html` |  |
| PAGE-235 | Native confirm() for start/cancel/delete campaign and instant-blast | `public/admin-wa-marketing.html` |  |
| PAGE-111 | Feature color used to build Tailwind class bg-${f.color}-500 — JIT-purged, dots render colorless | `public/admin-website.html` |  |
| PAGE-113 | Delete actions across all sections use native confirm() | `public/admin-website.html` |  |
| PAGE-242 | Native prompt() for media caption and contact rename | `public/admin-whatsapp-chat.html` |  |
| PAGE-244 | Native confirm() for branch disconnect | `public/admin-whatsapp-sessions.html` |  |
| PAGE-231 | Strong reference implementation — custom confirm dialog, skeleton, empty state, escaping, bounded polling; no defects | `public/admin-zoho-bulk-jobs.html` |  |
| PAGE-220 | Native confirm() for bulk-reminder / promise destructive flows | `public/admin-zoho-collections.html` |  |
| PAGE-224 | Missing loading skeleton; raw 'Loading...' text on a data table | `public/admin-zoho-expenses.html` |  |
| PAGE-219 | Native alert() on invoice-detail load failure | `public/admin-zoho-invoices.html` |  |
| PAGE-211 | Native confirm() gates name/rate/inactive pushes to Zoho (money + canonical data) | `public/admin-zoho-items-edit.html` |  |
| PAGE-228 | Well-built reference page (skeleton, empty state, escapeHtml, toast) — no significant issues | `public/admin-zoho-locations.html` |  |
| PAGE-214 | Single native confirm() amid otherwise toast-based UI | `public/admin-zoho-purchase-suggestions.html` |  |
| PAGE-215 | 17 native alert()/confirm() including PO-create and vendor-mapping bulk push | `public/admin-zoho-reorder.html` |  |
| PAGE-226 | Native alert() for empty CSV export | `public/admin-zoho-salesorders.html` |  |
| PAGE-229 | Native confirm() for disconnect-Zoho (destructive integration action) | `public/admin-zoho-settings.html` |  |
| PAGE-213 | Native confirm() for Zoho inventory-adjustment push and clear-all | `public/admin-zoho-stock-adjust.html` |  |
| PAGE-212 | Clean read-mostly page — no significant defects found | `public/admin-zoho-stock.html` |  |
| PAGE-068 | Brand violation: blue/purple theme on a staff reference page | `public/birla-opus-report.html` |  |
| PAGE-027 | No loading skeleton / project empty-state on conversation & message lists | `public/chat.html` |  |
| PAGE-030 | No loading skeleton / consistent empty-state primitives; bespoke spinners | `public/customer-dashboard.html` |  |
| PAGE-031 | Native alert() used instead of qc-ui toast/confirm | `public/customer-estimate-view.html` |  |
| PAGE-032 | downloadCustomerPDF() does not actually download a PDF — it triggers print | `public/customer-estimate-view.html` |  |
| PAGE-037 | Native alert()/confirm() instead of qc-ui | `public/customer-requests.html` |  |
| PAGE-017 | Purple admin theme bleeding into shared quick-action/notice styling | `public/dashboard.html` |  |
| PAGE-018 | No loading skeleton / proper empty-state component on data views | `public/dashboard.html` |  |
| PAGE-309 | Native confirm() for 'Clear All' instead of styled confirm | `public/engineer-cart.html` |  |
| PAGE-306 | Native confirm() used for 'Clear cart' instead of qcConfirm / EP.toast pattern | `public/engineer-catalog.html` |  |
| PAGE-045 | Native alert()/confirm() instead of qc-ui | `public/estimate-actions.html` |  |
| PAGE-048 | Native alert() for validation/error feedback | `public/estimate-create-new.html` |  |
| PAGE-051 | Brand violation: purple gradient as the document's primary color | `public/estimate-print.html` |  |
| PAGE-052 | Native prompt()/alert() for WhatsApp send | `public/estimate-print.html` |  |
| PAGE-055 | Native alert()/confirm() instead of qc-ui | `public/estimate-settings.html` |  |
| PAGE-060 | Inconsistent toast/confirm — bespoke modals + alert() mixed | `public/estimate-view.html` |  |
| PAGE-062 | <title> says 'Admin Dashboard' on the Estimates page | `public/estimates.html` |  |
| PAGE-014 | Loads Google Fonts from CDN (3 families) — external dependency on entry page | `public/index.html` |  |
| PAGE-022 | Purple theme (#667eea/#764ba2) on the offline fallback | `public/offline.html` |  |
| PAGE-285 | Notification bell navigates via hash to dashboard instead of in-page panel | `public/painter-catalog.html` |  |
| PAGE-296 | Native alert()/confirm() for submit + clear-cart instead of qc-ui/showToast | `public/painter-estimate-create.html` |  |
| PAGE-297 | Self-billing estimated-points left as TODO (incomplete value to painter) | `public/painter-estimate-create.html` |  |
| PAGE-274 | No bilingual support on a portal that is otherwise EN/TA | `public/painter-login.html` |  |
| PAGE-275 | No dark-mode styling (auth gradient stays light) | `public/painter-login.html` |  |
| PAGE-286 | onbeforeunload returns a custom string (deprecated/ignored) for unsaved-changes guard | `public/painter-profile.html` |  |
| PAGE-287 | Save button text reset hard-codes English 'Save Changes' after save | `public/painter-profile.html` |  |
| PAGE-276 | Native alert() used for validation and submit errors instead of qc-ui | `public/painter-register.html` |  |
| PAGE-278 | No bilingual support / no dark mode on registration | `public/painter-register.html` |  |
| PAGE-290 | Article body is HTML-escaped, so admin rich-text renders as raw tags | `public/painter-training.html` |  |
| PAGE-064 | Brand violation: purple gradient as receipt identity | `public/payment-receipt.html` |  |
| PAGE-063 | No CDN tailwind / no built CSS — but fine (self-contained inline styles) | `public/payment.html` |  |
| PAGE-023 | Purple theme on public legal page | `public/privacy-policy.html` |  |
| PAGE-004 | Uses CSS .hidden display:none !important inside page (no Tailwind/built CSS) | `public/register.html` |  |
| PAGE-039 | Native alert() for all validation and submit feedback | `public/request-estimate.html` |  |
| PAGE-041 | Products table not wrapped well for phone width (6-col table) | `public/request-estimate.html` |  |
| PAGE-011 | Password strength not validated client-side before submit | `public/reset-password.html` |  |
| PAGE-247 | Native confirm() for convert / cancel / push-to-Zoho instead of qcConfirm | `public/staff-billing.html` |  |
| PAGE-249 | qc-ui.js / ui-skeletons.js not loaded though primitives expected | `public/staff-billing.html` |  |
| PAGE-252 | Dead/placeholder page — only a 'Go to Estimates' link, no data | `public/staff-estimates.html` |  |
| PAGE-253 | Brand teal button instead of staff green | `public/staff-estimates.html` |  |
| PAGE-255 | Native alert() for validation and submit feedback instead of qc-ui toast | `public/staff-incentives.html` |  |
| PAGE-259 | Native confirm()/alert() in dormant re-engage and convert flows | `public/staff-leads.html` |  |
| PAGE-262 | Native confirm()/alert() for convert and outcome save | `public/staff-painter-marketing.html` |  |
| PAGE-008 | Does not load shared CSS or qc-ui primitives | `public/staff-register.html` |  |
| PAGE-269 | Native alert() for all errors and status-update feedback | `public/staff-requests.html` |  |
| PAGE-270 | Legacy purple-gradient header/desktop nav diverges from newer staff shell | `public/staff-requests.html` |  |
| PAGE-272 | Native confirm() for push-to-Zoho and PO send/push | `public/staff-vendors.html` |  |
| KN-P0-2 | PDF prints "GST @18%" label while gst_amount=0 (cosmetic mismatch) | `routes/estimates.js / estimate PDF` |  |
| RT-060 | Prints GST line while gst_amount=0 | `routes/routes/estimate-pdf-generator.js.js` |  |
| RT-017 | PDF prints GST label while estimate gst_amount=0 | `routes/routes/painter-estimate-pdf-generator.js.js` |  |
| SVC-017 | First scan only fires after 6h, no run-on-boot | `scheduler:anomaly-detector.js` |  |
| SVC-015 | Serial WhatsApp sends with 1s sleep can run long | `scheduler:attendance-report.js` |  |
| SVC-025 | Stale-session cleanup gated on Math.random()<0.1 | `scheduler:production-monitor.js` |  |
| SVC-042 | State is per-process and lost on restart | `service:automation-registry.js` |  |
| SYS-006 | WebView detection is fragmented and inconsistently applied across share/print/SW flows | `(systemic ×24)` |  |
| PAGE-098 | PDF export and report download open via window.open with no isAndroidApp() branch | `public/admin-activity-monitor.html` |  |
| PAGE-083 | Chart.js CDN dependency on the AI KPI dashboard tab | `public/admin-ai.html` |  |
| PAGE-081 | Chart.js loaded from CDN — fails offline / in locked-down WebView | `public/admin-anomalies.html` |  |
| PAGE-119 | Photo viewer uses window.open without isAndroidApp() branch | `public/admin-attendance.html` |  |
| PAGE-170 | AI Visualizer is desktop-download oriented; no isAndroidApp() branch | `public/admin-design-requests.html` |  |
| PAGE-104 | Quill loaded from CDN with no local fallback | `public/admin-guides.html` |  |
| PAGE-183 | SortableJS loaded from jsdelivr CDN with no SRI / local fallback | `public/admin-painter-catalog.html` |  |
| PAGE-181 | Leaflet loaded from unpkg CDN (offline/WebView fragility, supply-chain) | `public/admin-painters.html` |  |
| PAGE-205 | PDF download via blob+a.click() has no Android-WebView branch | `public/admin-price-list-generator.html` |  |
| PAGE-147 | PDF/WhatsApp/print flows have no isAndroidApp() branch | `public/admin-salary-monthly.html` |  |
| PAGE-154 | window.print() report has no isAndroidApp() branch | `public/admin-salary-reports.html` |  |
| PAGE-243 | prompt()-based caption/rename degrade in Android WebView (no isAndroidApp branch) | `public/admin-whatsapp-chat.html` |  |
| PAGE-218 | window.print() with no isAndroidApp() branch | `public/admin-zoho-dashboard.html` |  |
| PAGE-216 | PDF report download via window.location.href (no Android-WebView branch) | `public/admin-zoho-reorder.html` |  |
| PAGE-019 | checkAuthOrRedirect + role gate run before auth-helper SW is account-aware; no isAndroidApp guard for any web-push | `public/dashboard.html` |  |
| PAGE-289 | GPS check-in has no isAndroidApp/native-permission branch | `public/painter-attendance.html` |  |
| PAGE-280 | Service worker registered unconditionally (no isAndroidApp/WebView guard) | `public/painter-dashboard.html` |  |
| PAGE-065 | Native alert() for missing id; no Android-share branch | `public/payment-receipt.html` |  |
| PAGE-251 | Date rendered with ta-IN locale may show empty/garbled weekday on some WebViews | `public/staff-daily-work.html` |  |
| PAGE-256 | Request-incentive modal is a centered dialog, not a mobile bottom-sheet | `public/staff-incentives.html` |  |
| PAGE-265 | Aadhar image preview uses FileReader without isAndroidApp / size guard | `public/staff-register.html` |  |
| PAGE-273 | AI bill scan posts a photo with no client size/type guard for camera uploads | `public/staff-vendors.html` |  |

### From `2026-06-09-product-inventory-analysis.md` (31)

| ID | Title | File / area | Note |
|---|---|---|---|
| UX-4 | buildZohoFirstView runs the reverse matcher per unmatched item against all unlinked entries (O(unmatched × unlinked)) | `services/dpl-catalog.js:651-653 inside buildZohoFirstView() (served by routes/zoho.js:223 GET /items/dpl-catalog/:brand/by-zoho)` |  |
| UX-5 | Reorder report rebuilds the full other-branches map once per row (O(rows × stockRows)) | `services/reorder-report-service.js:177 and :222 inside assembleReport()` |  |
| UX-6 | Per-item N+1 Zoho API calls in /adjust and per-item UPDATE loops — slow, and amplifies the double-push race window | `routes/stock-check.js:923-939 (live fetch loop) and 1018-1053 (two sequential per-item UPDATE loops)` |  |
| UX-7 | dpl-apply runs per-item sequential queries (2 round-trips × up to 500 items) with no batching | `routes/item-master.js:537-574 (for loop over items, awaiting 3 queries each: SELECT, INSERT, UPDATE)` |  |
| UX-8 | Engineer product-detail modal: 7-column price table has no horizontal scroll wrapper — overflows / clips on phones | `public/engineer-catalog.html:319-347 (body.innerHTML = ... <table class="ep-table">) inside #dBody (.cat-modal-body)` |  |
| UX-9 | Dynamically rendered catalog (grid, chips, stock badges) never gets translated — breaks the default Tamil experience | `public/painter-catalog.html:401/498/509 (render*) vs only :792 calls applyTranslations; painter-i18n.js:4 default 'ta'` |  |
| UX-10 | Backfill socket progress handlers are registered but never cleaned up if the sync never emits 'done' | `admin-zoho-reorder.html:2158-2174 triggerBackfill socket branch` |  |
| UX-11 | Reset-to-Auto, bulk snooze, and several confirmations use native confirm()/alert() — inconsistent with the qc-ui toast/confirm primitives used elsewhere | `admin-zoho-reorder.html:1543 (confirm reset), :2073/2080/2084 (deleteBrand confirm/alert), :2598/2624/2630 (loadSalesAnalysis alert), :2709 (scan confirm), :2868/2920 (push confirm), :3080 (apply-brand confirm)` |  |
| UX-12 | Daily Report filter bar packs 9 controls in a single flex-wrap row — cramped/unusable on small screens | `admin-zoho-reorder.html:578-623 (<div class="flex gap-3 items-end mb-4 flex-wrap"> with Date, Branch, Period, Min avg, Search(flex-1 min-w-[160px]), Sort, Load, Download PDF, Send WhatsApp, Re-run)` |  |
| UX-13 | Active-config toggle in Config table is purely cosmetic until Save is clicked (silent data risk) | `admin-zoho-reorder.html:1592-1597 toggleConfigActive + :1520 onclick + :1602 saveConfig` |  |
| UX-14 | Reorder-check button label reverts to "Check Reorder" but initial/responsive label is "Check" | `admin-zoho-reorder.html:180 (initial span text "Check") vs :1411 (finally sets text to 'Check Reorder')` |  |
| UX-15 | Detail panel max-height:600px can clip the location/history content on desktop | `public/admin-zoho-stock.html:89-92 (.detail-panel.open)` |  |
| UX-16 | Stat card label says "Pending" but is hard-wired to the branch count, never decrements as transfers complete | `public/admin-stock-migration.html:320 (renderSummary) + :388-400 (setBranchStatus)` |  |
| UX-17 | Assign tab has no loading/empty state for branch list and no error if branches fail to load | `public/admin-stock-check.html:188-190, 685-695 (init)` |  |
| UX-18 | Photo modal has duplicate/conflicting inline display style (display:none AND display:none via two declarations) | `public/admin-stock-check.html:481-483 (#photoModal)` |  |
| UX-19 | Review list and History tables are not wrapped in an overflow-x scroll container — 11-column tables overflow the card on narrow screens | `public/admin-stock-check.html:1180-1207 (loadReviewList table) and 1541-1572 (loadHistory table)` |  |
| UX-20 | Mobile card CSS targets table[id*="stock"] but the inventory table id is invTable / sc-table — the 639px card layout never applies | `public/admin-stock-check.html:99-126 (@media max-width:639px) vs 280 (id="invTable"), 359/412/1181/1266/1471/1501 (class="sc-table")` |  |
| UX-21 | 'Available' column header looks like data column but is non-sortable while neighbors are sortable | `public/admin-zoho-stock-adjust.html:163-164` |  |
| UX-22 | Per-brand summary cards use flex-1 with no wrap/min-width — squeeze on narrow desktop | `public/admin-dpl-match.html:85 + renderSummary :181/:198` |  |
| UX-23 | Mobile cards on DPL match page are not actually rendered (display hidden, no responsive show) | `public/admin-dpl-match.html:126 + CSS :43-48` |  |
| UX-24 | 'Total Decrease' renders as '-0' when there are no decreases | `public/admin-zoho-stock-adjust.html:454-455 (updateSummary)` |  |
| UX-25 | Summary cards mix global (all-location) adjustment totals with single-location 'Items Shown' | `public/admin-zoho-stock-adjust.html:446-456 (updateSummary)` |  |
| UX-26 | Edit modals (#zfEditModal, #catEditModal, #catPickerModal) don't close on backdrop click | `public/admin-dpl.html:473 (#zfEditModal), 510 (#catPickerModal), 527 (#catEditModal) vs :458 (#zfAttachModal has backdrop close) and :2865 (zohoPicker backdrop close)` |  |
| UX-27 | No loading state while catalog / Zoho-first / brand-DPL data fetches | `public/admin-dpl.html:1280-1317 (loadBrandDplState), 1621-1642 (loadZohoFirst), 2192-2213 (loadCatalog)` |  |
| UX-28 | Green (#1B5E3B) push buttons break admin brand palette | `public/admin-dpl.html:1038, 3410, 3518-3521, 3704-3707, 4223, 4236 (push-to-Zoho buttons) vs admin theme-color #667eea at :6` |  |
| UX-29 | Mobile cards iterate full `items` while desktop table honours column filters via getFilteredItems() — divergent visible sets | `admin-zoho-items-edit.html:976 renderCards() (items.forEach) vs :853 renderTable() (getFilteredItems())` |  |
| UX-30 | Pagination per-page select and jump-to-page input use purple-500 focus ring, off the indigo brand used everywhere else | `admin-zoho-items-edit.html:313 (#perPageSelect focus:border-purple-500), :1074 (jump input focus:border-purple-500)` |  |
| UX-31 | Several top-toolbar buttons lack qc-mobile-btn class → ~26px touch targets on phones | `admin-zoho-items-edit.html:162 (% Adjust), :208 (Inactive), :214 (Columns), :236 (Sync), :240 (View Items)` |  |
| UX-32 | Price Calculator: 'Apply Selected to Price Calculator' from DPL Import never sets the brand dropdown or dpl_version_id, leaving inconsistent state | `public/admin-item-master.html:1400-1425 (applyMatchedToPriceCalc) & 1674-1675 (applyPriceChanges uses priceCalcDplVersionId, never set)` |  |
| UX-33 | Health Check uses purple text/border buttons — violates admin brand (purple is reserved; admin accents are indigo #667eea/#764ba2) | `public/admin-item-master.html:373 (#btnRecalcSales) & 843 (renderBrandBadge purple option)` |  |
| UX-34 | Bulk actions bar overlaps last table rows / pagination on mobile (fixed bottom bar, no body padding) | `public/admin-item-master.html:43-44 (.bulk-bar) & 517-527 (#bulkBar) & 156 (#paginationBar)` |  |

## Likely fixed — needs verification (27)

Mapped by commit-body description (the commit does not name the finding ID). Verify in code, then promote to the Fixed appendix.

| ID | Pri | Title | Commit | Mapping rationale |
|---|---|---|---|---|
| RT-053 | P1 | Daily-bonus cap uses server-local date not forced IST | 5bc5a07 | same defect as KN-P1-4 (named in 5bc5a07): daily-bonus cap now counts by IST day - verify |
| KN-P1-2 | P1 | Salary hourly basis inconsistency (/260 hardcode vs config.standard_daily_hours) | 47147f7 | same defect as RT-040 (named in 47147f7): deduction basis fixed to 10h standard day, owner-confirmed policy - verify |
| KN-P1-3 | P1 | Sunday OT counted 2× in SQL then re-multiplied by OT rate → overpay | 47147f7 | same defect as RT-039 (named in 47147f7): Sunday OT x2-in-SQL is the premium, no re-multiplication - verify |
| SVC-016 | P1 | 6h scan only runs when Zoho configured | 68d75b9 | 68d75b9 body (SVC-001/007) lists the 6-hourly anomaly scan among schedulers un-gated from Zoho - verify |
| SVC-021 | P1 | Log purge never runs without Zoho configured | 68d75b9 | 68d75b9 body (SVC-001/007) lists dataRetentionService among schedulers un-gated from Zoho - verify |
| SVC-023 | P1 | Self-healing + health monitoring off without Zoho | 68d75b9 | 68d75b9 body (SVC-001/007) lists productionMonitor (self-healing) + systemHealth - verify |
| RT-050 | P1 | Fixed-OTP test bypass (123456 for 9999999999) gated only by NODE_ENV | e86c8a2 | same fixed-OTP backdoor as KN-P2-3, which e86c8a2 names and fail-closes - verify routes/painters.js send-otp |
| P0-1 | P0 | Edit Review modal saves the WRONG pack sizes — reads global `packSizes` instead of `editReviewProduct.pack_sizes` | 578d695 | Phase B1: Edit-Review Save read global packSizes (data-loss) |
| P0-2 | P0 | Stored XSS — desktop products table interpolates product.name / brand_name / category_name into innerHTML unescaped | c6835f1 | Phase A (A1): desktop products table escHtml on name/brand/category |
| P0-3 | P0 | Items table reads unprefixed field names but API returns raw zoho_* columns — every row renders blank | 68e3632 | Phase C1: Items tab reads zoho_* field names |
| P0-4 | P0 | Edit panel + Bulk Edit save: payload field names don't match bulkEditSchema; all edits silently dropped, but UI reports success | 68e3632 | Phase C1: edit panel + bulk edit send bulkEditSchema shape; zoho_brand/zoho_category_name added |
| P1-1 | P1 | 'Complete'/'DPL Set' status filter sends status=complete which itemsQuerySchema rejects → 400, broken filter | 68e3632 | Phase C1: status filter Complete -> dpl_set + schema/WHERE added |
| P1-4 | P1 | Pagination reads pag.totalPages but API returns pag.pages → pager stuck on page 1 | 68e3632 | Phase C1: renderPagination reads pagination.pages |
| P1-5 | P1 | 'Brands' summary card renders the brand-name array joined as a string instead of a count | 68e3632 | Phase C1: Brands card shows brands.length |
| P1-8 | P1 | Zoho-first 'Push updated DPL' button stays permanently disabled after a failed push | c6835f1 | Phase A (A6): push button re-enables in finally |
| P1-9 | P1 | esc() does not escape double-quotes — attribute injection in title= for Zoho item name | c6835f1 | Phase A (A7/A8): quote-safe esc() on admin-dpl-match |
| P1-10 | P1 | Brand <option value> built with quote-unsafe esc() — attribute injection | c6835f1 | Phase A (A7/A8): quote-safe esc() on admin-dpl-match |
| P1-11 | P1 | Review panel renders Zoho item name, SKU, notes and photo_url unescaped into innerHTML | c6835f1 | Phase A (A9/A10): admin-stock-check escDiscHtml everywhere |
| P1-12 | P1 | Review list, history, dashboard, suggestions and reconcile-branch-mirror interpolate server strings without escaping | c6835f1 | Phase A (A9/A10): admin-stock-check escDiscHtml everywhere |
| P1-18 | P1 | Painter offer 'multiplier' badge/label is always blank — code reads offer.bonus_multiplier but the field is multiplier_value | c6835f1 | Phase A (A12): offer badge reads multiplier_value |
| P1-20 | P1 | Command injection / RCE via NotebookLM endpoint (notebook_id unescaped, query only escapes double-quotes) | 578d695 | Phase B1: NotebookLM exec -> execFile (RCE closed) |
| P1-22 | P1 | Sales-price formula divergence: route uses ceil(dpl*1.298), parser uses ceil(dpl*1.18*1.10) — ₹1 mismatch on ~21 DPL values | 578d695 | Phase B1: calculateSalesPrice aligned to ceil(dpl*1.18*1.10) + characterization test |
| P1-24 | P1 | Idempotency middleware runs before auth on /adjust/:id — replayed key returns success without a valid session | c6835f1 | Phase A (A13): idempotent() moved after auth gate on 4 routes |
| P1-25 | P1 | IDOR: non-'staff' assignable roles can read any assignment's detail (system_qty, photos, notes) | 2e6f7b8 | Phase B2: assignment detail IDOR ownership check |
| P1-28 | P1 | Branch isolation silently disabled — branchScope queries wrong column (manager_id) so managers always see consolidated/all-branch reorder data | 2e6f7b8 | Phase B2: branchScope manager_id -> users.branch_id |
| UX-3 | P1 | Bulk Map tab is unusable below 640px — the mapping input column is hidden by a global table CSS rule, with no mobile card fallback | ae58da9 | Bulk Map global table CSS scoped to #productsTable |
| UX-35 | P2 | Mobile product card Edit/Delete buttons (and FAB) lack permission gating present on desktop | ae58da9 | mobile card/FAB data-permission gating added |

---

## Appendix — Fixed (116)

### P0 (12)

- **KN-P0-1** — 663e4d4 — pre-resolved 2026-06-04 (single-round); triage doc title says RESOLVED
- **PAGE-006** — 748f0f7
- **PAGE-034** — e943fac
- **PAGE-035** — e943fac
- **PAGE-165** — 748f0f7
- **PAGE-171** — 2baca20
- **PAGE-264** — 748f0f7
- **PAGE-267** — 2baca20
- **PAGE-301** — 82af9ce
- **PAGE-305** — 82af9ce
- **SVC-001** — 68d75b9
- **SVC-007** — 68d75b9

### P1 (56)

- **KN-AUDIT** — 1b50afc
- **KN-P1-4** — 5bc5a07
- **KN-P1-5** — 9c9a932
- **KN-P2-5** — 1eb5223
- **PAGE-015** — 72900a6
- **PAGE-028** — 1b50afc
- **PAGE-042** — dd6e08b
- **PAGE-043** — 72900a6
- **PAGE-059** — 72900a6
- **PAGE-073** — d6ea658
- **PAGE-084** — dd6e08b
- **PAGE-086** — dd6e08b
- **PAGE-096** — d6ea658
- **PAGE-097** — 468c68c
- **PAGE-103** — 0f82cf6, 48e95f3
- **PAGE-116** — 1b50afc
- **PAGE-135** — 43df35a
- **PAGE-139** — 72900a6
- **PAGE-140** — 43df35a
- **PAGE-142** — 43df35a
- **PAGE-144** — 1b50afc
- **PAGE-146** — 43df35a
- **PAGE-148** — 72900a6
- **PAGE-149** — 43df35a
- **PAGE-156** — 72900a6
- **PAGE-163** — dd6e08b
- **PAGE-166** — 72900a6
- **PAGE-198** — 72900a6
- **PAGE-200** — 72900a6
- **PAGE-201** — 9c9a932, 72900a6
- **PAGE-203** — d6ea658
- **PAGE-241** — 468c68c
- **PAGE-246** — 468c68c
- **PAGE-254** — 72900a6
- **PAGE-257** — 6089b59
- **PAGE-258** — 72900a6
- **PAGE-294** — 6089b59
- **PAGE-302** — 1b50afc
- **PAGE-314** — 6c95f37
- **RT-008** — 3e9425d
- **RT-013** — d6ea658
- **RT-019** — 19e9821
- **RT-022** — 1b50afc
- **RT-026** — 1b50afc
- **RT-027** — 19e9821
- **RT-029** — 4cf3049
- **RT-030** — 4cf3049
- **RT-032** — 19e9821
- **RT-039** — 47147f7
- **RT-040** — 47147f7
- **RT-062** — 9c9a932
- **RT-064** — 1b50afc
- **SVC-019** — 6089b59
- **SVC-037** — 9c9a932
- **SYS-007** — ed370bf, 5391213
- **SYS-009** — 1b50afc

### P2 (48)

- **KN-P2-3** — e86c8a2
- **PAGE-005** — 19db3cb
- **PAGE-007** — 19db3cb
- **PAGE-026** — f72df49
- **PAGE-038** — 19db3cb
- **PAGE-040** — 19db3cb
- **PAGE-046** — f72df49
- **PAGE-050** — df1f28d, f72df49
- **PAGE-066** — df1f28d, f72df49
- **PAGE-071** — f72df49
- **PAGE-080** — 19db3cb
- **PAGE-100** — 19db3cb
- **PAGE-102** — e86c8a2
- **PAGE-107** — 19db3cb
- **PAGE-110** — e86c8a2
- **PAGE-114** — 19db3cb
- **PAGE-118** — 19db3cb
- **PAGE-121** — 19db3cb
- **PAGE-124** — 19db3cb
- **PAGE-128** — 19db3cb
- **PAGE-131** — 19db3cb
- **PAGE-133** — 19db3cb
- **PAGE-136** — 19db3cb
- **PAGE-137** — f72df49
- **PAGE-152** — 43df35a, 19db3cb
- **PAGE-157** — 19db3cb
- **PAGE-158** — f72df49
- **PAGE-174** — f72df49
- **PAGE-196** — 19db3cb
- **PAGE-197** — e86c8a2
- **PAGE-208** — 19db3cb
- **PAGE-217** — 19db3cb
- **PAGE-221** — f72df49
- **PAGE-223** — 19db3cb
- **PAGE-225** — 19db3cb
- **PAGE-227** — 19db3cb
- **PAGE-250** — 19db3cb
- **PAGE-260** — 19db3cb
- **PAGE-282** — f72df49
- **PAGE-295** — 19db3cb
- **PAGE-307** — e86c8a2
- **PAGE-310** — f72df49
- **RT-010** — e86c8a2
- **RT-021** — e86c8a2
- **RT-046** — e86c8a2
- **RT-061** — 663e4d4 — pre-resolved (single-round + qty guard); triage doc title says FIXED
- **SVC-035** — e86c8a2
- **SYS-011** — (pre-audit) — positive/clearing finding - "No action needed" per the doc itself

---

*All fixed IDs above come from the 2026-06-08-triage doc (the product-inventory doc has no ID-named fix commits yet — see Likely fixed). Commit hashes are from `master`.*

