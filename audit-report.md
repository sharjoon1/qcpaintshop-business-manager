========== ACT.QCPAINTSHOP.COM ANALYSIS REPORT ==========
Generated: 2026-04-30T14:13:26Z
Server HEAD: 82ee6ee feat(zoho): DPL match review endpoint + admin page
Branch: master
Total source LOC: 205,394 (*.js + *.html, excludes node_modules / uploads / .git / whatsapp-sessions / .wwebjs_cache / archive)
Files analyzed: 406

## Section 1 — Project Health & State

### Code volume

- `server.js` = **3,982 LOC** — over 2x the refactor threshold. Still hosts ~91 inline `app.METHOD(...)` handlers covering auth, OTP, design-requests, paint catalog/visualization, brands, categories, users, customer-types, products, customer OTP+CRUD, calculate, dashboard stats, plus the late-added DPL match endpoint at L3740 (which is registered AFTER `app.use(errorHandlerMw.globalErrorHandler)` at L3498 — see U-CRITICAL-2).
- Backend total source: **64,840 LOC** (`routes/`, `services/`, `middleware/`, `server.js`).
- Frontend total source: **114,422 LOC** (HTML+JS in `public/`).

**Top 10 longest backend files (>2,000 LOC = refactor candidate):**

| LOC | File |
|----:|------|
| 6,314 | `routes/painters.js` (148 endpoints) |
| 4,800 | `routes/zoho.js` (122 endpoints) |
| 4,175 | `routes/attendance.js` (49 endpoints) |
| 3,982 | `server.js` |
| 2,526 | `routes/leads.js` |
| 2,441 | `services/zoho-api.js` |
| 2,202 | `routes/salary.js` |

**Top frontend pages (>1,500 LOC = component-extraction candidate):**

| LOC | Page |
|----:|------|
| 5,394 | `public/admin-painters.html` |
| 3,754 | `public/staff/dashboard.html` |
| 3,740 | `public/birla-opus-report.html` (one-off generated report) |
| 3,688 | `public/admin-zoho-reorder.html` |
| 3,099 | `public/admin-products.html` |
| 2,892 | `public/admin-zoho-dashboard.html` |
| 2,317 | `public/painter-dashboard.html` |
| 2,283 | `public/admin-zoho-items-edit.html` |
| 2,249 | `public/admin-item-master.html` |
| 2,200 | `public/admin-attendance.html` |
| 2,101 | `public/admin-wa-marketing.html` |
| 2,013 | `public/admin-ai.html` |
| 1,940 | `public/estimate-create-new.html` |
| 1,853 | `public/admin-guides.html` |
| 1,781 | `public/staff/stock-check.html` |
| 1,692 | `public/staff-vendors.html` |
| 1,688 | `public/staff-leads.html` |
| 1,530 | `public/admin-leads.html` |
| 1,467 | `public/components/sidebar-complete.html` |

**Backend totals:** 828 `router.METHOD(...)` endpoints across `routes/*.js` + 91 inline `app.METHOD(...)` in `server.js` ≈ **919 distinct routes**.

### Module inventory (one-line purposes)

**Auth / RBAC / infra**
- `middleware/permissionMiddleware.js` — token→user resolve; `requireAuth`, `requireRole`, `requirePermission`, `requireAnyPermission`, `getUserPermissions`.
- `middleware/branchScope.js` — branch-scoped query helper.
- `middleware/errorHandler.js` — DB error logging, severity assessment, dedup, auto-bug-creation.
- `middleware/rateLimiter.js` — `globalLimiter` (100/min/IP), `authLimiter` (10/min/IP), `otpLimiter` (5/min/phone).
- `middleware/responseTracker.js` — per-route latency stats for monitoring.
- `middleware/validate.js` — Zod request body/query/params validation helpers + reusable schemas.
- `config/database.js` — mysql2/promise pool factory (limit 20).
- `config/uploads.js` — multer destinations for logos/profile/aadhar/products/etc.

**Domain — auth/users/branches**
- `routes/roles.js` — role + permission CRUD.
- `routes/branches.js` — branch CRUD, hours, manager assignment, staff list.
- `routes/staff-registration.js` — public self-registration with OTP, admin approval, offer letter PDF.

**Domain — sales / billing / customers**
- `routes/estimates.js` — estimate CRUD, markup/discount/labor calculation engine.
- `routes/estimate-pdf.js`, `routes/estimate-pdf-generator.js` — PDF rendering (Puppeteer for HTML invoices).
- `routes/estimate-requests.js` — customer-submitted "request an estimate" workflow.
- `routes/billing.js` — billing estimates, invoices, payments, Zoho push, dashboard stats.
- `routes/collections.js` — outstanding invoice management & payment collection tracking.
- `routes/credit-limits.js` — Zoho-customer credit limit governance, violations, requests.
- `routes/share.js` — public share-token endpoints for estimates / design-requests.
- `routes/item-master.js` — Zoho item naming conventions, DPL pricing rules, health checks.
- `routes/vendors.js` — vendor CRUD + bills (AI-scanned), purchase orders, payments, Zoho push.

**Domain — staff ops**
- `routes/attendance.js` — clock in/out, break, prayer, outside-work, geofence, OT approval (4,175 LOC giant).
- `routes/salary.js` — config, monthly run, payments, advances, incentive slabs.
- `routes/salary-pdf-generator.js` — payslip PDFs.
- `routes/activities.js` — staff activity tracking & reporting.
- `routes/activity-feed.js` — notice board feed.
- `routes/activity-tracker.js` — staff "what are you working on now" tracker.
- `routes/staff-daily-work.js` — unified daily-work dashboard API.
- `routes/daily-tasks.js` — mandatory daily checklist with photo proof.
- `routes/tasks.js` — admin-controlled staff task assignment.
- `routes/stock-check.js` — daily physical stock verification assignments.
- `routes/stock-migration.js` — bulk stock movement between locations.

**Domain — leads / marketing**
- `routes/leads.js` — lead pipeline + per-staff isolation.
- `routes/wa-marketing.js` — WhatsApp campaign CRUD.
- `routes/wa-contacts.js` — WhatsApp contacts + groups.
- `routes/whatsapp-chat.js` — chat history viewer.
- `routes/whatsapp-sessions.js` — per-branch WhatsApp QR sessions.
- `routes/painter-marketing.js` — PNTR painter import + daily list + conversion + backfill.

**Domain — painters (loyalty / B2B)**
- `routes/painters.js` — public + painter-auth + admin endpoints (6,314 LOC, 148 endpoints).
- `routes/painter-estimate-pdf-generator.js` — painter quotation PDFs.
- `routes/photos.js` — photo gallery + cleanup cron.

**Domain — Zoho / inventory**
- `routes/zoho.js` — items, invoices, customers, payments, locations, reorder, dashboards (4,800 LOC, 122 endpoints).
- `services/zoho-api.js` — REST client (2,441 LOC).
- `services/zoho-oauth.js` — OAuth 2.0 token lifecycle.
- `services/zoho-rate-limiter.js` — token-bucket throttling for Zoho API.
- `services/zoho-invoice-line-sync.js` — incremental line-item sync cursor.
- `services/sync-scheduler.js` — cron orchestrator for full/incremental Zoho syncs (662 LOC).
- `services/billing-zoho-service.js` — local-billing → Zoho contact/invoice push.
- `services/purchase-suggestion.js` — three-tier PO suggestion service.
- `services/reorder-compute-service.js` — pure-helpers reorder math + alerts.
- `services/reorder-report-service.js`, `services/reorder-report-pdf-generator.js` — daily reorder report.
- `services/vendor-item-mapper.js` — vendor↔item mapping.
- `services/vendor-bill-ai-service.js` — KAI vendor-bill OCR pipeline.
- `services/price-list-parser.js` — DPL PDF parser (1,239 LOC).
- `services/painter-zoho-sync-service.js` — painter↔zoho contact sync.
- `services/painter-points-engine.js` — points calc, slab eval, invoice processing, credit (618 LOC).
- `services/painter-points-backfill-service.js` — historical backfill.
- `services/painter-attendance-service.js` — painter daily check-in / claim ledger.
- `services/painter-card-generator.js` — printable visiting-card image generator (540 LOC).
- `services/painter-notification-service.js` — FCM + in-app for painters.
- `services/painter-marketing-scheduler.js` — daily PNTR cron jobs.
- `services/pntr-import-service.js` — bulk PNTR painter file ingestion.

**AI**
- `services/ai-engine.js` — dual-LLM abstraction (Gemini + Claude/Clawdbot) with failover.
- `services/ai-context-builder.js` — comprehensive business context for chat (805 LOC).
- `services/ai-analyzer.js` — Zoho business analyzer.
- `services/ai-marketing.js` — marketing strategy analyzer.
- `services/ai-staff-analyzer.js` — staff-performance analyzer.
- `services/ai-lead-manager.js` — deterministic + AI lead scoring.
- `services/ai-scheduler.js` — cron orchestrator for AI jobs.
- `services/anomaly-detector.js` — z-score anomaly detection.
- `services/staff-task-generator.js` — Tamil daily-task generator via Clawdbot.
- `services/error-analysis-service.js` — stack-trace parsing + AI fix suggestions.
- `services/error-prevention-service.js` — pattern analysis + integrity validation.
- `services/app-metadata-collector.js` — schema/route/error metadata for the AI App Analyzer.
- `routes/ai.js`, `routes/anomalies.js`, `routes/system.js` (system health + bug reports).

**Notifications / chat / sockets**
- `services/notification-service.js` — in-app + Socket.io + Web Push + FCM.
- `services/fcm-admin.js` — Firebase Admin SDK wrapper.
- `services/email-service.js` — branded SMTP wrapper.
- `services/whatsapp-session-manager.js` — whatsapp-web.js per-branch sessions (738 LOC).
- `services/whatsapp-processor.js` — `whatsapp_followups` queue worker.
- `services/wa-campaign-engine.js` — campaign scheduler + sender.
- `services/lead-auto-assign-scheduler.js` — round-robin daily lead assignment.
- `services/lead-reminder-scheduler.js` — daily followup reminders.
- `services/auto-clockout.js` — auto clock-out + OT prompts.
- `services/attendance-report.js` — daily attendance summary via WhatsApp + in-app (1,207 LOC).
- `services/painter-scheduler.js` — painter cron orchestrator (12+ jobs).
- `services/activity-feed.js`, `services/activity-tracker-service.js` — staff feed + tracker.

**Operational**
- `services/system-health-service.js` — DB / memory / disk / external-service health checks.
- `services/production-monitor.js` — self-healing engine + circuit breaker for Zoho.
- `services/automation-registry.js` — in-memory cron-job registry for the live dashboard.
- `services/color-extractor.js` — image colour extraction.

### Frontend page census

Audience grouping (root-level `public/`):

- **Admin**: 67 pages (`admin-*.html`) — covers attendance, salary, leads, painters, products, Zoho subsystems, AI, monitoring, bug reports, WA, website CMS.
- **Staff (mobile)**: 22 pages — 9 root `staff-*.html` (billing, leads, vendors, etc.) + 13 in `public/staff/` (dashboard.html is the daily-work hub).
- **Painter (mobile)**: 8 pages (`painter-*.html`) — dashboard, profile, attendance, catalog, training, login, register, estimate-create.
- **Customer**: 4 pages (`customer-*.html`) — dashboard, login, requests, estimate-view.
- **Public marketing / utility**: 18+ — `index.html`, `request-estimate.html`, `forgot-password.html`, `register.html`, `privacy-policy.html`, `404.html`, `offline.html`, `share/*.html`, plus PDF previews.
- **Components**: 17 partials in `public/components/` (sidebar-complete.html, header-v2.html, multiple subnav fragments).

Files >1,500 LOC (component-extraction candidates): 18 — listed in "Code volume" above.

### DB schema touchpoints

Distinct tables referenced via `pool.query(... FROM <t>)` or `INSERT INTO <t>` / `UPDATE <t>` (≈170 tables):

`admin_notices`, `admin_notifications`, `ai_analysis_runs`, `ai_business_context`, `ai_config`, `ai_conversations`, `ai_insights`, `ai_lead_scores`, `ai_messages`, `ai_suggestions`, `attendance_daily_reports`, `attendance_permissions`, `attendance_photos`, `billing_estimate_items`, `billing_estimates`, `billing_invoice_items`, `billing_invoices`, `billing_payments`, `branches`, `branch_item_sales`, `brand_reorder_config`, `brands`, `bug_reports`, `categories`, `chat_conversations`, `chat_messages`, `chat_participants`, `chat_read_receipts`, `code_quality_metrics`, `collection_reminders`, `color_design_requests`, `credit_limit_requests`, `credit_limit_violations`, `customer_credit_history`, `customers`, `customer_types`, `daily_task_materials`, `daily_task_responses`, `daily_task_submissions`, `daily_task_templates`, `design_visualizations`, `detected_anomalies`, `dpl_price_history`, `dpl_versions`, `error_logs`, `estimate_items`, `estimate_request_activity`, `estimate_request_photos`, `estimate_request_products`, `estimate_requests`, `estimates`, `estimate_status_history`, `fix_suggestions`, `geofence_violations`, `guide_categories`, `guide_favorites`, `guides`, `guide_versions`, `guide_views`, `incentive_slabs`, `invoice_line_sync_cursor`, `item_naming_rules`, `item_vendor_map`, `lead_conversion_predictions`, `lead_followups`, `leads`, `monthly_salaries`, `notifications`, `otp_verifications`, `outside_work_periods`, `overtime_requests`, `pack_sizes`, `painter_attendance`, `painter_attendance_checkins`, `painter_attendance_ledger`, `painter_attendance_monthly`, `painter_calculations`, `painter_challenge_progress`, `painter_challenges`, `painter_clawback_pending`, `painter_custom_rates`, `painter_daily_assignments`, `painter_daily_checkins`, `painter_earned_badges`, `painter_estimate_items`, `painter_estimates`, `painter_fcm_tokens`, `painter_gallery`, `painter_invoices_processed`, `painter_lead_duplicate_queue`, `painter_lead_followups`, `painter_leads`, `painter_levels`, `painter_location_events`, `painter_marketing_config`, `painter_notifications`, `painter_pntr_import_runs`, `painter_points_transactions`, `painter_point_transactions`, `painter_price_reports`, `painter_product_point_rates`, `painter_product_requests`, `painter_quotation_items`, `painter_quotations`, `painter_referrals`, `painters`, `painter_sessions`, `painter_slab_evaluations`, `painter_special_offers`, `painter_training_categories`, `painter_training_content`, `painter_value_slabs`, `painter_visualization_requests`, `painter_withdrawals`, `painter_zoho_salesperson_map`, `painter_zoho_sync_queue`, `payment_promises`, `permissions`, `prayer_periods`, `production_health_snapshots`, `products`, `push_subscriptions`, `reorder_report_log`, `role_permissions`, `roles`, `settings`, `staff_activity_feed`, `staff_activity_sessions`, `staff_attendance`, `staff_daily_ai_tasks`, `staff_idle_alerts`, `staff_incentives`, `staff_registrations`, `staff_salary_config`, `staff_tasks`, `stock_check_assignments`, `stock_check_items`, `system_health_checks`, `task_updates`, `user_branches`, `users`, `user_sessions`, `vendor_bill_items`, `vendor_bills`, `vendor_mapping_scans`, `vendor_payments`, `vendor_po_items`, `vendor_purchase_orders`, `vendors`, `wa_campaign_leads`, `wa_campaigns`, `wa_contact_group_members`, `wa_contact_groups`, `wa_instant_messages`, `wa_marketing_settings`, `wa_message_templates`, `wa_sending_stats`, `website_features`, `website_gallery`, `website_services`, `website_testimonials`, `whatsapp_contacts`, `whatsapp_followups`, `whatsapp_messages`, `whatsapp_sessions`, `zoho_branch_allocations`, `zoho_bulk_job_items`, `zoho_bulk_jobs`, `zoho_category_defaults`, `zoho_config`, `zoho_customers_map`, `zoho_daily_transaction_details`, `zoho_daily_transactions`, `zoho_financial_reports`, `zoho_invoice_line_items`, `zoho_invoices`, `zoho_items_map`, `zoho_locations_map`, `zoho_location_stock`, `zoho_oauth_tokens`, `zoho_payments`, `zoho_purchase_suggestions`, `zoho_reorder_alerts`, `zoho_reorder_config`, `zoho_stock_history`, `zoho_sync_log`.

**Migration files**: 90 in `migrations/` (88 `migrate-*.js` + 1 SQL dump + `fix-missing-indexes.js` + several `add-*` and `fix-*` repair scripts). No `migrations.json` ledger, no schema-version table — purely filename-based, idempotent-ish migrations.

**Cross-reference findings:**

- Tables present in code with no obvious dedicated migration file (likely created inline in feature migration files): `staff_activity_feed`, `staff_activity_sessions`, `staff_idle_alerts`, `painter_zoho_salesperson_map`, `branch_item_sales`, `code_quality_metrics`, `painter_invoices_processed`, `painter_clawback_pending`. Verify before adding new migrations.
- Naming inconsistency: both `painter_points_transactions` and `painter_point_transactions` are written to (plural vs singular) — see U-CRITICAL-3.
- `migrations/add_missing_indexes.sql` (2 lines) and `migrations/fix-missing-indexes.js` (7 indexes) coexist — combine into a single canonical index migration.
- 264 `INDEX|KEY|ADD INDEX` statements appear across migrations — generally well-indexed for joins, but several hot tables still lack obvious composite indexes (see U7).

### Cron job catalog

All cron schedules use `node-cron` with `timezone: 'Asia/Kolkata'` unless noted. Real-time intervals use `setInterval`.

| Service / file | Schedule | Purpose |
|---|---|---|
| `services/sync-scheduler.js:449` | configurable cron (default 30 min) | Zoho full/incremental sync cycle |
| `services/sync-scheduler.js:470` | daily `cronExpr` from config | Daily Zoho report email |
| `services/auto-clockout.js:613` | `59 21 * * *` | End-of-day auto clock-out + OT prompts |
| `services/auto-clockout.js:604` | `setInterval 5min` | Overtime prompt poll |
| `services/auto-clockout.js:609` | `setInterval 5min` | Geo warning poll |
| `services/ai-scheduler.js:246` | `0 21 * * *` | Zoho daily AI analysis |
| `services/ai-scheduler.js:249` | `30 22 * * *` | Staff daily AI analysis |
| `services/ai-scheduler.js:252` | `0 */6 * * *` | Lead-scoring refresh (4×/day) |
| `services/ai-scheduler.js:255` | `0 8 * * 1` | Weekly Zoho summary (Mondays) |
| `services/ai-scheduler.js:258` | `0 9 * * 1` | Weekly marketing strategy |
| `services/ai-scheduler.js:261` | `0 9 * * *` | Daily Tamil staff tasks generator |
| `services/ai-scheduler.js:264-266` | `0 6 * * *`, `0 12 * * *`, `0 18 * * *` | 3× daily snapshot |
| `services/painter-scheduler.js:302` | `0 6 1 * *` | Monthly slab evaluation |
| `services/painter-scheduler.js:303` | `30 6 1 1,4,7,10 *` | Quarterly slab evaluation |
| `services/painter-scheduler.js:304` | `0 8 * * *` | Painter credit overdue check |
| `services/painter-scheduler.js:307` | `0 0 * * *` | Streak reset |
| `services/painter-scheduler.js:308` | `5 0 * * *` | Daily bonus rotation |
| `services/painter-scheduler.js:309` | `0 7 * * *` | Daily bonus push notification |
| `services/painter-scheduler.js:310` | `0 20 * * *` | Streak reminder |
| `services/painter-scheduler.js:313-316` | `5 0 1 * *`, `0 */6 1-7 * *`, `0 20 7 * *`, `0 2 8 * *` | Painter attendance claim window: open / recompute / remind / forfeit |
| `services/painter-scheduler.js:319` | `30 2 * * *` | Painter location-events prune |
| `services/painter-marketing-scheduler.js:122` | `30 2 * * *` | PNTR daily import dedup |
| `services/painter-marketing-scheduler.js:126` | `0 3 * * *` | PNTR daily list build |
| `services/painter-marketing-scheduler.js:130` | `30 3 * * *` | PNTR conversion check |
| `services/painter-marketing-scheduler.js:134` | `0 6 * * *` | Daily painter list email |
| `services/painter-marketing-scheduler.js:140` | `30 6 * * *` | Daily painter list WhatsApp |
| `services/painter-marketing-scheduler.js:158` | `0 17 * * *` | Evening painter follow-up |
| `services/painter-marketing-scheduler.js:178` | `0 18 * * *` | Painter backfill |
| `services/lead-reminder-scheduler.js:20` | `0 8 * * *` | Lead followup reminders |
| `services/lead-auto-assign-scheduler.js` | `0 8 * * *` (per file) | Round-robin auto-assign of unassigned leads |
| `services/attendance-report.js:1147` | `5 22 * * *` | Daily attendance report |
| `services/attendance-report.js:1173` | `5 18 * * *` | Evening report |
| `services/activity-feed.js:174` | `5 0 * * *` | Activity feed nightly cleanup |
| `services/system-health-service.js:365` | `setInterval 5min` | System health checks |
| `services/production-monitor.js:448-454` | `setInterval 1s/30s/5min` | Event-loop lag, runCheck, persistSnapshot |
| `services/zoho-rate-limiter.js:309` | `setInterval` | Token-bucket refill |
| `routes/photos.js` (`startCleanupCron`) | `0 2 * * *` (per Skills) | Daily photo cleanup at 2 AM IST |
| `server.js:3801` | `setInterval 60s` | Geofence enforcement (location-off + stale geo warning) |
| `server.js:3942` | `setInterval 6h` | Anomaly full-scan |

### Test coverage

`tests/unit/` = 22 files, **2,109 LOC**. `tests/integration/` = 1 file (`painter-attendance-flow.test.js`).

Covered: anomaly-detector, billing schemas, brand config, color-extractor, config modules, estimate-search helpers, invoice-line-sync, item-master pricing/health, painter-attendance, painter-location, painter-marketing-scheduler, painter-points-backfill, painter-zoho-sync, pntr-import, production-monitor, rateLimiter, reorder-compute, reorder-report, responseTracker, validate, vendors, admin-notifications.

**Glaring gaps:**
- Zero coverage on the 3 largest route files: `painters.js` (6,314 LOC), `zoho.js` (4,800 LOC), `attendance.js` (4,175 LOC).
- No tests for `routes/leads.js` (per-staff isolation rules), `routes/salary.js` (financial calc), `routes/estimates.js` markup/discount engine (only `estimate-search.test.js`).
- No tests for `services/painter-points-engine.js` (slab eval, invoice processing — financial impact).
- No tests on `services/auto-clockout.js`, `services/attendance-report.js`, `services/sync-scheduler.js`.
- No HTTP-level integration tests (supertest) for any endpoint except painter-attendance flow.
- No tests for permission middleware fall-through behavior.

### Tech-debt smells observed

1. **`server.js` is still a 3,982-LOC monolith** with 91 inline routes. Modules left inline: auth/login (L380), OTP send/verify/resend (L658-L968), forgot-password (L573), customer-OTP (L3074-L3215), settings (L1050-L1112), brands (L1973-L2015), categories (L2021-L2063), users / KYC (L2069-L2423), customer-types (L2429-L2475), products (L2483-L3066), customers (L3221-L3291), calculate (L3301), dashboard stats (L3361), design-requests + AI visualization (L1229-L1967), DPL match report (L3740 — *after* error handler).
2. **Backup files committed**: `server.js.bak.dpl`, `routes/attendance.js.backup`, `routes/attendance.js.OLD`, `middleware/permissionMiddleware.js.backup`, `middleware/permissionMiddleware.js.OLD`, `public/dashboard.html.broken-backup`, `public/estimate-create.html.old`, `public/universal-nav-loader-backup.js`, `public/universal-nav-loader-v3.js`. These should be removed from the working tree.
3. **Tailwind via CDN in production**: 107 HTML pages load `<script src="https://cdn.tailwindcss.com">` — runtime JIT, ~500KB+ download per page, no purge, blocks paint, breaks if CDN goes down. See U6.
4. **2,575 inline `onclick="..."` handlers** (and the equivalent inline `onsubmit`/`onchange`) across the public/ HTML — XSS surface and impossible to add a CSP `script-src` lockdown until removed.
5. **195+ `innerHTML = ...`** template-literal injections in admin/staff pages with user-supplied strings (painter names, lead notes, customer phone) — no DOMPurify, no consistent escape helper. See U10.
6. **Duplicated SMS+email blocks** for OTP send/resend/registration: the NettyFish HTTP GET is open-coded 4 times in `server.js` (L743, L911, L3141, plus customer-OTP). Should live in `services/sms-service.js`.
7. **Duplicated session-resolve query**: the `SELECT ... FROM user_sessions s JOIN users u ...` query appears in `server.js` (L388, L448, L490, L596, L3596) and `middleware/permissionMiddleware.js` (twice). Single helper `resolveSession(token)` would consolidate.
8. **Async routes without `try/catch`** are rare (most have wrappers), but the geofence cron at `server.js:3801-3924` swallows errors with broad catch and JSON.stringify on unknown shapes. The dashboard-stats endpoint (`server.js:3361`) wraps each query in its own try/catch but returns 0 silently — frontend cannot distinguish "0 leads" from "leads table missing".
9. **Loose-`==` comparisons**: 1,270 `==`/`!=` instances vs `===`/`!==`. Most are harmless coercions, but several are in critical paths (e.g. `bid == primaryBranchId` at `server.js:2323`). Eslint rule `eqeqeq` would flag these mechanically.
10. **`var` keyword**: largely already migrated (0 in `routes/painters.js`, 0 in `routes/leads.js`); 8 remain in `public/staff/dashboard.html`, 42 in `public/admin-painters.html` — frontend-side cleanup needed.
11. **No structured logger**: 2,578 `console.log/error/warn` calls. No `pino`/`winston`. PM2 captures stdout but log levels and request IDs are absent. See U13.
12. **Hardcoded UI strings** scattered throughout HTML; only painter pages use `painter-i18n.js`. Staff/admin have no i18n layer despite the user base being primarily Tamil-speaking.
13. **Customer "auth" is fake**: `POST /api/customer/auth/verify-otp` returns a `crypto.randomBytes(32).toString('hex')` token at `server.js:3205` but **never persists it**. The customer-dashboard.html only checks `localStorage.getItem('customer_logged_in')==='true'`. Anyone can set this in their browser. See U-CRITICAL-1.
14. **`forgot-password` overwrites the user's real password** with a 4-byte hex temp value emailed in plaintext (`server.js:592-637`), and invalidates all sessions, on any submission — no time-limited reset token, no second factor. An attacker who knows a staff email and can read SMTP delivery (or simply intercept it) gets full account takeover; even without that, denial-of-service: anyone can reset any staff password by hitting the endpoint repeatedly. See U-CRITICAL-4.
15. **DPL match endpoint registered after error handler**: `server.js:3740` is below `app.use(errorHandlerMw.globalErrorHandler)` at L3498 and below the 404 handler at L3486. It still works because Express matches route handlers in registration order and the 404 only triggers on unmatched, but ordering is brittle. See U-CRITICAL-2.
16. **Indexes**: `migrations/fix-missing-indexes.js` adds 7 indexes; live tables likely still missing composite indexes for common WHERE+ORDER BY patterns (e.g. `staff_attendance(date, user_id)` — already covered? — or `painter_estimates(painter_id, status, created_at)`). See U7.
17. **Hard-deletes on financial sub-rows**: `DELETE FROM billing_estimate_items WHERE estimate_id = ?` (`routes/billing.js:467`) and 17 other hard-deletes. With no audit_log/audit_trail table found anywhere in the codebase, edits to estimates/invoices destroy history irrecoverably. See U18.
18. **No CSRF protection** on state-changing POST/PUT/DELETE endpoints. Bearer-token auth via `Authorization` header mitigates classic CSRF when localStorage is used (cookies aren't sent), but any future cookie auth would be exposed. Acceptable today, but document the assumption.
19. **No request IDs / correlation IDs** — error logs have stack traces but no way to tie a frontend error toast to a backend log line.
20. **No idempotency keys** on `POST /api/estimates`, `POST /api/billing/invoices`, `POST /api/zoho/.../push`. A flaky mobile network can produce duplicate invoices. See U17.
21. **Two `painter_*` table-name spellings** (`painter_points_transactions` vs `painter_point_transactions`) — pick one, migrate the other.
22. **`SELECT *`** appears 100+ times — fine for ad-hoc but exposes columns the frontend doesn't need (e.g. `users.password_hash` was the kind of risk the explicit-column query at L389 sidesteps; the inline customer GETs at L3243 use `SELECT *`).

---

## Section 2 — Upgrade Ideas

### U-CRITICAL — Genuine bugs

#### U-CRITICAL-1. Customer "auth" returns a token that's never persisted — login is purely client-side
- **Category:** Security
- **Severity:** Critical
- **Files:** `server.js:3159-3215` (`/api/customer/auth/verify-otp`), `public/customer-dashboard.html:15`, `public/customer-estimate-view.html`
- **Current behavior:** `verify-otp` generates `token = crypto.randomBytes(32).toString('hex')` and returns it to the client without inserting it into any session table. Customer pages gate themselves with `if (localStorage.getItem('customer_logged_in') !== 'true')` — anyone who manually sets that key in DevTools sees the customer dashboard. Any endpoint the dashboard calls (`/api/estimates/...`, design-requests) either doesn't check auth or relies on URL params like `customer_phone`.
- **Proposed change:** Persist the customer session (new table `customer_sessions(token, customer_id, phone, expires_at)`) and add `requireCustomerAuth` middleware that resolves the token from the `Authorization: Bearer …` header. Update all customer-facing endpoints. On the frontend, store the token (not a boolean) and attach it to every fetch.
- **Why it matters:** Customer estimates contain phone numbers, addresses, prices, painter assignments. Currently any anonymous visitor can browse them by manipulating localStorage and sending the customer's known phone in URL params.
- **Implementation approach:** (1) Migration: create `customer_sessions`. (2) `services/customer-auth.js` — `createSession(customerId, phone)`, `resolveSession(token)`, `revoke(token)`. (3) `middleware/customerAuth.js`. (4) Update `verify-otp` to insert and return token. (5) Audit `customer-dashboard.html`, `customer-requests.html`, `customer-estimate-view.html`, `customer-login.html` for fetch calls and add `Authorization` header.
- **Effort:** Medium (4-6h).
- **Migration risk:** Medium — existing customers will be force-logged-out. Roll out with a banner on the customer dashboard ("Please log in again — session upgraded for security").
- **Test strategy:** Integration test asserting (a) endpoints reject missing token with 401, (b) tampered token rejected, (c) expired token rejected, (d) valid token returns customer's data and only their data.

#### U-CRITICAL-2. DPL-match endpoint registered after the error handler
- **Category:** Reliability
- **Severity:** High
- **Files:** `server.js:3486-3492` (404 handler), `server.js:3498` (error handler), `server.js:3740-3779` (DPL endpoint after both)
- **Current behavior:** Express matches handlers in registration order. The 404 catch-all at L3486 returns 404 only for non-API paths, so the API route at L3740 still resolves — but the ordering is wrong-by-convention and fragile. If anyone changes the 404 to also intercept `/api`, the DPL endpoint silently 404s. Errors thrown inside the L3740 handler will not flow through `globalErrorHandler` because that handler is registered before the route.
- **Proposed change:** Move the DPL handler into `routes/zoho.js` (beside the 4,800-LOC peer endpoints) and mount it under `app.use('/api/zoho', zohoRoutes.router)` at L306. Delete the inline block.
- **Why it matters:** Errors from this endpoint won't be logged to `error_logs` table or auto-bug-reported, defeating the existing error-prevention pipeline.
- **Implementation approach:** Cut L3740-L3778, paste into `routes/zoho.js` as `router.get('/dpl-match-report', requireAuth, async (req, res) => { … })`.
- **Effort:** Small (<30 min).
- **Migration risk:** None.
- **Test strategy:** `curl https://act.qcpaintshop.com/api/zoho/dpl-match-report` before/after returns the same payload; force a thrown error and assert it lands in `error_logs`.

#### U-CRITICAL-3. Two table names: `painter_points_transactions` vs `painter_point_transactions`
- **Category:** Architecture
- **Severity:** High
- **Files:** Both spellings appear in INSERT statements across the codebase (grep proves it). Likely one is the canonical table and the other is a dead reference (or vice-versa).
- **Current behavior:** Some code paths INSERT into `painter_points_transactions` (plural), others into `painter_point_transactions` (singular). Whichever one doesn't exist at runtime throws `ER_NO_SUCH_TABLE` and silently breaks earned-point ledgering for that path.
- **Proposed change:** Run `SHOW TABLES LIKE 'painter_%transactions'` on production to identify which exists. Pick the canonical one (likely the singular `painter_point_transactions` — check `migrations/migrate-painter-app.js`), then rename all INSERT/SELECT references to match. Add a safety migration that creates a VIEW for the wrong-spelled name aliasing the canonical one for any ESP code running in flight.
- **Why it matters:** Points are real money to painters. A silent INSERT failure = an invisible payout discrepancy.
- **Implementation approach:** Grep both spellings, determine canonical via DB inspection, replace all wrong references, add `CREATE OR REPLACE VIEW painter_points_transactions AS SELECT * FROM painter_point_transactions;` so any cached process keeps working during deploy. Remove the view a week later.
- **Effort:** Small (1-2h).
- **Migration risk:** Medium — any failed insert path has been silently dropping points. Run a reconciliation query post-deploy to confirm no orphan rows.
- **Test strategy:** Add a unit test that imports both names from a single source-of-truth constant and asserts equality. Manually invoke each affected endpoint and verify a row appears.

#### U-CRITICAL-4. Forgot-password overwrites real password with 4-byte hex temp, emailed in plaintext
- **Category:** Security
- **Severity:** Critical
- **Files:** `server.js:573-647`
- **Current behavior:** Anyone who hits `POST /api/auth/forgot-password` with a known staff email (a) gets the user's password permanently changed to a random 8-hex-char value, (b) invalidates all of their active sessions (DoS), (c) emails the new password in cleartext (intercepted by an attacker with SMTP visibility = takeover). 4 bytes of `crypto.randomBytes` = 4,294,967,296 possibilities — brute-forcing the login isn't realistic, but the email channel is the leak.
- **Proposed change:** Replace with industry-standard reset flow: generate a single-use signed token (e.g. JWT or `crypto.randomBytes(32)` stored in `password_reset_tokens(token_hash, user_id, expires_at, used_at)`), email a reset link `https://act.qcpaintshop.com/reset-password?token=…`, render a reset-password page where the user picks their own new password. Don't touch `users.password_hash` until the user submits the form and proves token possession.
- **Why it matters:** This is the textbook account-takeover vector. ~15 staff including admin/manager roles handle financial data.
- **Implementation approach:** (1) Migration: `password_reset_tokens` table. (2) `routes/auth.js` (extract auth from server.js while at it — see U1). (3) New page `public/reset-password.html`. (4) Rate-limit per email (already covered by `authLimiter`, but add per-user lockout). (5) Email template uses link, not password.
- **Effort:** Medium (4-6h including the auth-extraction).
- **Migration risk:** None — the new flow is a strict improvement; old flow can be removed immediately.
- **Test strategy:** Manual: request reset for a test account → confirm password unchanged → click link → set new password → log in. Negative tests: token reuse, expired token, mismatched user.

### Architecture / DX

#### U1. Extract the 91 inline routes from server.js into proper route modules
- **Category:** Architecture / DX
- **Severity:** High
- **Files:** `server.js:380-3479` (auth, OTP, settings, brands, categories, users, customer-types, products, customers, calculate, dashboard stats, design-requests, AI viz, paint-colors).
- **Current behavior:** server.js holds endpoints that conceptually belong in `routes/auth.js`, `routes/otp.js`, `routes/settings.js`, `routes/brands.js`, `routes/categories.js`, `routes/users.js`, `routes/products.js`, `routes/customers.js`, `routes/visualization.js`. New devs reading the codebase have no clean entry point — server.js mixes wiring with business logic.
- **Proposed change:** Create the modules above following the existing `routes/*.js` pattern (with `setPool(pool)`). Mount them under `app.use('/api/auth', authRoutes.router)` etc. Reduce `server.js` to ~600 LOC of bootstrap-only.
- **Why it matters:** Half the cognitive cost of the project is parsing where to find an endpoint. A grep on `app.post('/api/auth/login'` is the only way today; route extraction makes IDE go-to-definition work.
- **Implementation approach:** Do it in PRs, one domain at a time. Order: auth+otp first (U-CRITICAL-4 forces this anyway), then customers/products, then dashboard/calculate, then design-requests/visualization. Each PR moves ~10-15 endpoints; verify each page that calls those endpoints still works (run smoke tests against admin-staff.html, admin-products.html, etc.).
- **Effort:** Large (>16h, split across 4-6 PRs).
- **Migration risk:** Low — pure code-organization, no behavior change. Risk is missed copy of a `requireRole`/`requirePermission` middleware.
- **Test strategy:** Add HTTP-level integration tests *before* extraction so behavior is locked in. After extraction, all existing tests still pass.

#### U2. Add ESLint + Prettier + EditorConfig + husky pre-commit hook
- **Category:** DX
- **Severity:** Medium
- **Files:** New `.eslintrc.json`, `.prettierrc`, `.editorconfig`, `.husky/pre-commit`, `package.json` devDependencies.
- **Current behavior:** No linter config detected. Code style varies (mix of single+double quotes, inconsistent indentation in places, 1,270 loose-equality comparisons).
- **Proposed change:** Adopt `eslint:recommended` + `eslint-plugin-node` + Prettier. Rules: `eqeqeq: error`, `no-var: error`, `prefer-const: warn`, `no-unused-vars: warn`, `no-console: off` (until structured logger lands). Husky pre-commit runs `eslint --fix` + `prettier --write` on staged files.
- **Why it matters:** Catches the loose-equality and var-keyword smells mechanically; prevents new ones from sneaking in. Improves PR review focus.
- **Implementation approach:** Install, generate config, run `eslint --fix` once across all source, commit the bulk reformatting separately, then enable pre-commit. Don't enforce on first commit — turn warnings on, fix gradually, then turn errors on a month later.
- **Effort:** Medium (4h initial + reviewing the bulk auto-fix diff).
- **Migration risk:** Low. The bulk-reformat commit will be huge (~50K lines touched) — mark it `chore: lint baseline` and `.git-blame-ignore-revs` it.
- **Test strategy:** `npm test` continues to pass on the lint-baseline commit. Reviewers spot-check the diff for any auto-fix that changed behavior (rare; mostly whitespace/quotes).

#### U3. Consolidate session resolver into a single helper
- **Category:** Architecture / DX
- **Severity:** Medium
- **Files:** `server.js:388, 448, 490, 596, 3596`; `middleware/permissionMiddleware.js:34, 117`.
- **Current behavior:** Same `SELECT s.*, u.id as user_id, u.username, ... FROM user_sessions s JOIN users u ON s.user_id = u.id LEFT JOIN branches b ON u.branch_id = b.id WHERE s.session_token = ? AND s.expires_at > NOW() AND u.status = 'active'` query is duplicated 7 times.
- **Proposed change:** Add `services/auth.js` exposing `async function resolveSession(token)` that returns `{ user, expires_at }` or null. All call sites use it.
- **Why it matters:** A single column-add (e.g. `users.preferred_language`) requires editing 7 places today. Also: the 7 instances drift — some include `branch_name`, some include `profile_image_url`, some don't.
- **Implementation approach:** Create the helper, replace each call site, delete inline SQL.
- **Effort:** Small (2h).
- **Migration risk:** Low — pure refactor; unit-test the helper.
- **Test strategy:** Mock pool, assert the SELECT shape and that expired/inactive sessions return null.

### Performance

#### U4. Add request-level slow-query log + EXPLAIN-on-demand for endpoints >500ms
- **Category:** Observability / Performance
- **Severity:** High
- **Files:** `middleware/responseTracker.js`, new `middleware/slowQueryLogger.js`.
- **Current behavior:** `responseTracker` records latencies but doesn't capture the SQL responsible. Production-monitor measures event-loop lag globally.
- **Proposed change:** Wrap `pool.query` with a tagged version that records query SHA + duration + caller-route in `slow_queries(query_hash, sample_text, route, p95_ms, last_seen, count)`. Endpoints over 500ms log all queries that fired. Expose `/api/monitoring/slow-queries` for the admin monitoring page.
- **Why it matters:** The largest route files (`painters.js`, `zoho.js`, `attendance.js`) are unaudited for N+1. The 60-second geofence cron at `server.js:3801` already runs 5+ queries per active staff per minute and there's no visibility into how it scales past 30 staff.
- **Implementation approach:** Monkey-patch pool.query in a wrapper that timestamps before/after; fire-and-forget INSERT into `slow_queries`. Use AsyncLocalStorage to associate the route. Don't log every query — only when route.duration > threshold OR query.duration > 200ms.
- **Effort:** Medium (6h).
- **Migration risk:** Low — wrapper is opt-in. Be careful AsyncLocalStorage doesn't leak across requests in Express 5.
- **Test strategy:** Hit a known slow endpoint (admin-painters.html load) and verify entries appear; verify normal endpoints don't get logged.

#### U5. Replace `SELECT *` and add explicit columns on hot paths
- **Category:** Performance / Security
- **Severity:** Medium
- **Files:** `server.js:3243` (`SELECT * FROM customers WHERE id = ?`), 100+ other occurrences.
- **Current behavior:** Unnecessary columns travel over the wire. `users` rows include `password_hash` if `SELECT *` is used carelessly.
- **Proposed change:** Audit each `SELECT *` and replace with explicit columns. The login endpoint at `server.js:388` already does it correctly — extend the pattern.
- **Why it matters:** Smaller payloads + protects against accidentally returning sensitive columns when a new column gets added (e.g. if someone adds a `users.salary_advance_balance` column, every `/api/users/:id` call leaks it).
- **Implementation approach:** Grep each `SELECT *`, list the columns the caller actually uses, replace. Start with anything touching `users`, `customers`, `painters`, `zoho_oauth_tokens`.
- **Effort:** Medium (4-8h).
- **Migration risk:** Low if done carefully — risk is forgetting a column. Test by smoke-testing each affected page.
- **Test strategy:** Per-endpoint snapshot test of the response shape.

#### U6. Replace Tailwind CDN with build-time JIT (Tailwind CLI)
- **Category:** Performance
- **Severity:** High
- **Files:** All 107 HTML files containing `<script src="https://cdn.tailwindcss.com"></script>`.
- **Current behavior:** Each page loads ~500KB of Tailwind runtime, then JIT-generates classes in-browser. Blocks paint, repeats on every navigation, breaks if CDN is down.
- **Proposed change:** Add `tailwindcss` as a devDependency, write `tailwind.config.js` with content globs, output a single `public/css/tailwind.css` (~10-30KB after purge). Build it on `npm run build`, replace the script tag with `<link rel="stylesheet" href="/css/tailwind.css">`.
- **Why it matters:** First Contentful Paint on staff/painter mobile pages drops from ~2.5s to ~700ms on a typical OnePlus on 4G. Service-worker can cache it offline.
- **Implementation approach:** (1) `npm i -D tailwindcss postcss autoprefixer`. (2) `npx tailwindcss init`. (3) Configure `content: ['./public/**/*.html', './public/**/*.js']`. (4) Add `npm run build:css` and a watcher script for dev. (5) Sed-replace the CDN tag in all HTML files. (6) Re-test all pages — anything using arbitrary values like `bg-[#1B5E3B]` should still work via JIT, but custom colors not enumerated need `safelist`.
- **Effort:** Medium (6h including QA pass).
- **Migration risk:** Medium — purge can drop classes that only appear in `innerHTML` strings or dynamic JS. Mitigate with safelist regex `/(bg|text|border)-(red|green|gold|gray)-(50|100|...)/`. Roll out staff pages first (smaller surface), then admin.
- **Test strategy:** Visual diff against staging on the 10 highest-traffic pages.

#### U7. Add composite indexes on hot query patterns
- **Category:** Performance
- **Severity:** Medium
- **Files:** New `migrations/add-composite-indexes.js`.
- **Current behavior:** `migrations/fix-missing-indexes.js` adds 7 single-column indexes. Hot query patterns combine columns; some are not covered.
- **Proposed change:** Add the following based on grep evidence (verify with `EXPLAIN` on staging first):
  - `staff_attendance(user_id, date)` — used everywhere (`WHERE user_id = ? AND date = ?`).
  - `painter_estimates(painter_id, status, created_at DESC)` — list/sort.
  - `painter_estimates(status, created_at DESC)` — admin list.
  - `painter_point_transactions(painter_id, created_at DESC)`.
  - `leads(branch_id, status, next_followup_date)` — followup queries at `routes/leads.js:248,400`.
  - `leads(assigned_to, status)` — per-staff isolation.
  - `zoho_invoices(branch_id, invoice_date)` — dashboard filtering.
  - `zoho_payments(branch_id, payment_date)`.
  - `staff_tasks(assigned_to, status, due_date)` — dashboard pending/overdue.
  - `notifications(user_id, read_at, created_at DESC)` — unread feed.
  - `chat_messages(conversation_id, created_at DESC)`.
  - `painter_attendance_checkins(painter_id, checkin_date)`.
- **Why it matters:** With ~hundreds of painters and growing transaction tables, full-table scans become noticeable. EXPLAIN before/after will show.
- **Implementation approach:** Migration uses `ADD INDEX IF NOT EXISTS` pattern (already used in `fix-missing-indexes.js`). Run on staging, capture EXPLAIN output before/after, then deploy.
- **Effort:** Small (2-3h).
- **Migration risk:** Medium on a busy table — ALTER TABLE locks. Run during off-peak (3am IST), use `pt-online-schema-change` if the lock is intolerable. MariaDB 10.11 supports `ALGORITHM=INPLACE, LOCK=NONE` for index adds — specify it.
- **Test strategy:** EXPLAIN the canonical query before/after; run a 1-min load test on the affected page.

#### U8. Add result caching for paint catalog and brands/categories list
- **Category:** Performance
- **Severity:** Low
- **Files:** `server.js:1668-1716`, `server.js:1973`, `server.js:2021`.
- **Current behavior:** Paint catalogs are loaded into memory at startup (`paintCatalogs` object) — fine. But `/api/brands` and `/api/categories` hit MySQL on every request, and these change once a week.
- **Proposed change:** In-memory cache (existing `lru-cache` dep already used in `routes/zoho.js:71`) with 5-min TTL. Invalidate on POST/PUT/DELETE for brands/categories.
- **Why it matters:** Each estimate-create page load fires both queries. Cuts ~30 ms per page load.
- **Implementation approach:** Wrap GETs with a memoization helper; clear the cache key on writes.
- **Effort:** Small (1-2h).
- **Migration risk:** Low. Stale data for ≤5 minutes acceptable.
- **Test strategy:** Add a brand, refresh, see it within 5 min; verify directly after PUT it's invalidated immediately.

### Security

#### U9. Coverage gaps in Zod validation
- **Category:** Security
- **Severity:** High
- **Files:** Currently only `routes/billing.js`, `routes/vendors.js`, `routes/item-master.js`, `routes/painter-marketing.js` use `validate()`. The 800+ other endpoints rely on hand-rolled checks or none.
- **Current behavior:** Per-endpoint defensive checks like `if (!username || !password) return 400`. Type coercion is implicit.
- **Proposed change:** For each route module, define schemas in a co-located `<module>.schemas.js`. Use `validate(schema)` / `validateQuery(schema)` / `validateParams(schema)` middleware. Standard schemas (`paginationSchema`, `idParamSchema`) are already in `middleware/validate.js`.
- **Why it matters:** Today an admin sending `{ branch_id: { $ne: null } }` to a Mongo-flavored injection wouldn't go far (mysql2 doesn't deserialize objects), but type-coercion bugs are the rule, not the exception. Zod gives a single error code (`VALIDATION_ERROR`) with field-level details for the frontend.
- **Implementation approach:** Knock out one route file per PR. Prioritize: `routes/painters.js` (financial), `routes/leads.js` (PII + assignment logic), `routes/attendance.js` (geofence inputs), `routes/salary.js` (financial). Rest of the route files can follow.
- **Effort:** Large (>20h across 6 PRs).
- **Migration risk:** Medium — Zod's `.coerce.number()` differs from `parseInt(x) || 0`; confirm each behavior. Add tests before introducing the schema.
- **Test strategy:** For each schema, test rejection of malformed input (missing field, wrong type, out-of-range). Then a happy-path integration test.

#### U10. XSS hardening — replace innerHTML with safe DOM helpers
- **Category:** Security
- **Severity:** High
- **Files:** 195 `innerHTML = \`...\`` template-literal injections; concentrated in `public/admin-painters.html`, `public/admin-attendance.html`, `public/staff/dashboard.html`, `public/staff-leads.html`, `public/painter-dashboard.html`, `public/admin-design-requests.html`, `public/admin-bug-reports.html`.
- **Current behavior:** User-supplied strings (painter names, lead notes, customer phones) are dropped into HTML strings via template literals without escaping. A painter who registers with `<img src=x onerror=...>` as their full name lands a stored XSS in any admin viewing the painter list.
- **Proposed change:** Two-layer defense. (1) Server-side: HTML-escape outgoing strings in JSON responses for known-text fields (or rely on consumer escaping — but then enforce consumer escaping). (2) Client-side: introduce a tiny `escape(str)` helper in `public/js/dom-utils.js` and a `setSafeHTML(el, parts)` that uses `textContent` for user fields and `innerHTML` only for explicitly-trusted markup. For complex templates, switch to `<template>` cloning + `textContent` assignments.
- **Why it matters:** Stored XSS in admin panels = full takeover, since admins have wallet/zoho permissions. Currently mitigated only by trust in the data sources, but painter self-registration is a public form.
- **Implementation approach:** Create `public/js/dom-utils.js` with `esc(s)` (HTML escape) and `el(tag, attrs, children)` builder. Refactor admin-painters.html (highest risk: public-facing data) first. Add a CSP header `Content-Security-Policy: script-src 'self'; object-src 'none'` once inline event handlers are gone (see U11).
- **Effort:** Large (>16h, can be incremental per page).
- **Migration risk:** Medium — visual regressions possible; do one page at a time with manual QA.
- **Test strategy:** Add a test painter with name `<script>alert(1)</script>` and verify the admin page renders the literal string, not the script.

#### U11. Remove inline `onclick=`/`onsubmit=`/`onchange=` handlers (1,955 occurrences)
- **Category:** Security
- **Severity:** Medium
- **Files:** All admin/staff/painter HTML files.
- **Current behavior:** 1,955 inline event handlers. As long as these exist a strict CSP cannot be applied (CSP would need `'unsafe-inline'` for scripts).
- **Proposed change:** Move handlers to delegated event listeners or `data-action="..."` attributes resolved by a single delegated handler.
- **Why it matters:** Inline handlers are the second-largest blocker (after Tailwind CDN) to a strong CSP. Today an XSS that lands a `<img src=x onerror=...>` runs unchecked.
- **Implementation approach:** Per-page refactor. Add a small helper `bindActions(root)` that scans `[data-action]` and dispatches. Migrate progressively — add CSP-report-only header to track remaining inline handlers via the `report-uri`.
- **Effort:** Large (>30h spread across pages).
- **Migration risk:** Medium — easy to break a page's interaction. Page-by-page rollout with QA.
- **Test strategy:** Click every button on each migrated page; add Cypress smoke tests for top flows (estimate-create, painter dashboard, clock-in).

#### U12. Add audit logging for financial endpoints
- **Category:** Security / Compliance
- **Severity:** High
- **Files:** New `migrations/migrate-audit-log.js`, new `services/audit-log.js`, instrument `routes/billing.js`, `routes/salary.js`, `routes/painters.js` (withdrawals, point adjustments), `routes/credit-limits.js`.
- **Current behavior:** No `audit_log`/`audit_trail` table found anywhere. `routes/billing.js:467` hard-deletes invoice line items; `routes/painters.js:2911` hard-deletes custom rates; `routes/leads.js:1894` hard-deletes leads. Once gone, gone.
- **Proposed change:** New table `audit_log(id, ts, user_id, action, entity_type, entity_id, before_json, after_json, ip, user_agent)`. Helper `audit.record(req, action, entity_type, entity_id, before, after)`. Call on every financial CRUD.
- **Why it matters:** "Who changed this estimate price?" and "When was this invoice deleted?" are unanswerable today. With ~15 staff and real money flowing, this is the #1 dispute-resolution gap.
- **Implementation approach:** Migration first, then gradually instrument. Use `JSON.stringify` of the before/after row (with sensitive keys redacted via the existing pattern in `errorHandler.js`). Add admin page `admin-audit-log.html` to browse.
- **Effort:** Medium (8-12h).
- **Migration risk:** Low — purely additive.
- **Test strategy:** Modify an estimate, verify audit row appears; delete one, verify before-image preserved.

#### U13. Structured logging via pino + request IDs
- **Category:** Observability
- **Severity:** Medium
- **Files:** All 2,578 `console.log/error/warn` calls.
- **Current behavior:** Plain stdout. Hard to grep by user/request/severity. PM2 captures but no level filtering.
- **Proposed change:** Adopt `pino` + `pino-http` middleware. Each request gets a UUID; logs are JSON. Frontend includes `X-Request-Id` in error toasts so users can quote it. Logs ship to `logs/app.json` with daily rotation.
- **Why it matters:** When a painter complains "my points didn't update", today the only way to investigate is `journalctl -u pm2-* | grep painter-id`. With request IDs and structured logs, tracking a single request across services takes seconds.
- **Implementation approach:** Phase 1: install pino, add `pino-http`, add `req.log` and `app.log`. Phase 2: replace `console.error('foo:', err)` calls with `req.log.error({err}, 'foo')` — can be progressive. Don't bulk-replace; replace as you touch files.
- **Effort:** Medium (6h initial + ongoing).
- **Migration risk:** None.
- **Test strategy:** Verify each log line has `req_id`; force an error and verify the same `req_id` appears in the response header and the log.

### Reliability

#### U14. Circuit breaker for outbound APIs (Zoho, WhatsApp, FCM, Pollinations, Gemini)
- **Category:** Reliability
- **Severity:** Medium
- **Files:** `services/zoho-api.js`, `services/fcm-admin.js`, `server.js:1567` (Pollinations), `server.js:1483` (Gemini).
- **Current behavior:** `services/production-monitor.js:48` already implements a circuit breaker for Zoho. Other outbound calls don't.
- **Proposed change:** Generalize the circuit breaker into `services/circuit-breaker.js` with named breakers (zoho, fcm, gemini, pollinations, whatsapp). Each call wrapped: opens after N consecutive failures, half-open after cooldown. Existing zoho breaker logic moved into the generic helper.
- **Why it matters:** Gemini quota exhaustion currently hangs the visualization endpoint for ~120 s timeout per request. With a breaker, requests fail fast after the first known-bad call.
- **Implementation approach:** Pull out `services/production-monitor.js:48-260` circuit-breaker section into a standalone module; keep production-monitor as a consumer that reports state.
- **Effort:** Medium (4-6h).
- **Migration risk:** Low — breaker defaults to "closed" (passthrough).
- **Test strategy:** Mock external API to fail; verify breaker opens after threshold and rejects fast.

#### U15. Retry-with-backoff for transient DB pool exhaustion
- **Category:** Reliability
- **Severity:** Medium
- **Files:** `config/database.js`, all routes that use `pool.getConnection()`.
- **Current behavior:** Pool limit = 20. Under burst (e.g. ~200 concurrent painter app launches at 9am), `pool.getConnection()` hangs or rejects. No retry layer.
- **Proposed change:** Wrap `pool.query`/`getConnection` with `retry(fn, { retries: 3, minTimeout: 100, factor: 2 })` for ER_CON_COUNT_ERROR and PROTOCOL_CONNECTION_LOST. The existing `production-monitor.js` self-heal already restarts the pool on prolonged failure.
- **Why it matters:** Currently a single deadlock can fail an entire request chain instead of a 200-ms retry succeeding.
- **Implementation approach:** Use `async-retry` (well-tested) or a 30-line homegrown helper. Apply selectively — don't retry idempotent writes without an idempotency key (see U17).
- **Effort:** Small (2-3h).
- **Migration risk:** Low. Risk: retry on a non-idempotent write produces double-execute. Mitigated by U17.
- **Test strategy:** Mock pool to reject first call, succeed second; verify no duplicate insert.

#### U16. Self-Heal `db_pool_test_failed` exponential backoff
- **Category:** Reliability
- **Severity:** Medium
- **Files:** `services/production-monitor.js`, `services/system-health-service.js`.
- **Current behavior:** System-health checks every 5 min unconditionally. On `db_pool_test_failed` it logs and continues, which means another 5-min wait before next attempt. Production-monitor recovery actions are throttled but the throttle parameters are constants.
- **Proposed change:** Add exponential backoff: on first failure retry in 30s, then 60s, 2min, 4min, capped at 5min. Reset to 5min cadence after success.
- **Why it matters:** Faster recovery from transient DB hiccups (the kind that happen during BaoTa backups) without flooding logs during sustained outages.
- **Implementation approach:** Replace `setInterval` in `system-health-service.js:365` with self-rescheduling `setTimeout` whose delay depends on last-result.
- **Effort:** Small (2h).
- **Migration risk:** Low.
- **Test strategy:** Force pool failure; verify log shows 30s/60s/2min/4min retries.

#### U17. Idempotency keys on financial POSTs
- **Category:** Reliability
- **Severity:** Medium
- **Files:** `routes/estimates.js`, `routes/billing.js`, `routes/painters.js` (estimate creation, withdrawal request), `routes/credit-limits.js`.
- **Current behavior:** Mobile apps with flaky networks retry POSTs. A double-tap on "Create Estimate" creates two estimates.
- **Proposed change:** Accept `Idempotency-Key` header. New table `idempotency_records(key_hash, user_id, route, response_status, response_body, expires_at)` with 24h TTL. First request stores response; subsequent same-key returns the stored response.
- **Why it matters:** Prevents duplicate financial entries — a known pain in field-staff usage.
- **Implementation approach:** Express middleware factory `idempotent(scope)`. Frontend generates a UUID per submit-button-click and includes it.
- **Effort:** Medium (6h).
- **Migration risk:** Low — backward-compatible (no key = no caching).
- **Test strategy:** Send the same request with the same key twice; verify second returns identical response and only one row in DB.

#### U18. Soft-delete pattern for financial sub-rows + audit trail
- **Category:** Reliability / Compliance
- **Severity:** Medium
- **Files:** `routes/billing.js:467, 836`, `routes/painters.js:1517, 4197` (estimate items/lines).
- **Current behavior:** Updating an estimate hard-deletes child rows then re-INSERTs. History is gone.
- **Proposed change:** Add `deleted_at TIMESTAMP NULL DEFAULT NULL` to `billing_estimate_items`, `billing_invoice_items`, `painter_estimate_items`, `estimate_items`. Replace `DELETE FROM ...` with `UPDATE ... SET deleted_at = NOW()`. Filter `WHERE deleted_at IS NULL` in reads. Pair with U12 audit log.
- **Why it matters:** Disputes about quantities or prices are unresolvable today.
- **Implementation approach:** Migration adds the column; bulk-update existing rows leaves it NULL. Refactor write paths.
- **Effort:** Medium (4-6h).
- **Migration risk:** Medium — every list query needs the WHERE clause; missing one shows deleted rows. Add a default scope in a query helper.
- **Test strategy:** Update an estimate, verify old row has `deleted_at` set and new rows are added; lists show only active.

### Feature gaps

#### U19. 2FA for admin role (TOTP)
- **Category:** Security / Feature
- **Severity:** High
- **Files:** New `routes/2fa.js`, `migrations/add-2fa-fields.js`, `public/admin-2fa-setup.html`.
- **Current behavior:** Admin login is single-factor (password). Admin can change painter point balances, push invoices to Zoho, edit salary configuration.
- **Proposed change:** Optional but enforced-for-admin TOTP. `users.totp_secret`, `users.totp_enabled`. Login flow asks for code after password. Use `speakeasy` or `otpauth` lib. Backup codes stored hashed.
- **Why it matters:** Single-factor admin auth on a public-facing financial app is below industry minimum.
- **Implementation approach:** Migration + new endpoints (setup/verify/disable) + login-flow change + backup-codes UI.
- **Effort:** Medium (8-12h).
- **Migration risk:** Medium — admin gets locked out if they lose phone. Backup codes + admin-recovery via direct DB access mitigate.
- **Test strategy:** Setup 2FA on a test admin, verify login requires code; verify backup code works once and is then invalid.

#### U20. CSV/Excel export consistency across admin reports
- **Category:** Feature / DX
- **Severity:** Low
- **Files:** Export endpoints scattered across `routes/zoho.js`, `routes/painters.js`, `routes/leads.js`, `routes/salary.js`.
- **Current behavior:** Some pages have CSV export, some don't. Format/column-naming inconsistent.
- **Proposed change:** Shared `services/export.js` with `toCsv(rows, columns)` and `toXlsx(rows, columns, sheetName)` helpers. Standardize Excel via `exceljs`. Every list page gets a consistent "Download CSV" / "Download Excel" button.
- **Why it matters:** Admin currently copies tables manually for analysis. Quick win.
- **Effort:** Medium (6h).
- **Migration risk:** None.
- **Test strategy:** Snapshot test of CSV output against fixed input.

#### U21. Search-as-you-type with debouncing on admin lists
- **Category:** UX / Performance
- **Severity:** Low
- **Files:** `public/admin-painters.html`, `public/admin-customers.html`, `public/admin-products.html`, `public/admin-leads.html`.
- **Current behavior:** Most search inputs trigger on Enter or button-click only. The few that fire on input have no debounce — type fast, fire 6 requests.
- **Proposed change:** Add a shared `debounce(fn, ms)` helper, wire all search inputs to fire 300ms after typing stops. Show a small spinner.
- **Effort:** Small (3h).
- **Migration risk:** None.
- **Test strategy:** Type rapidly, verify only one request after pause.

#### U22. Bulk-actions toolbar on admin list pages
- **Category:** Feature
- **Severity:** Low
- **Files:** `public/admin-painters.html`, `public/admin-staff.html`, `public/admin-customers.html`, `public/admin-leads.html`.
- **Current behavior:** Today actions are per-row only. Bulk-deactivate, bulk-assign-branch, bulk-export require iteration.
- **Proposed change:** Add a checkbox column + sticky toolbar that appears when ≥1 row is selected, with Activate / Deactivate / Assign Branch / Export.
- **Effort:** Medium (6h).
- **Migration risk:** Low — server-side bulk endpoints already exist for some entities (`/api/products/bulk-delete`, `/api/products/bulk-map`).
- **Test strategy:** Select rows, dispatch action, verify all rows updated.

#### U23. Time-zone aware reports + date display
- **Category:** Reliability
- **Severity:** Low (latent)
- **Files:** All places that build `today` via `new Date().toISOString().split('T')[0]` — e.g. `server.js:3363, 3805`.
- **Current behavior:** UTC-derived "today" diverges from IST after 18:30 UTC. Geofence cron at L3804 already corrects with manual offset; dashboard at L3363 does not.
- **Proposed change:** Helper `dates.todayIST()` (Asia/Kolkata) used everywhere. Or use a lib (`date-fns-tz`).
- **Why it matters:** Late-evening dashboards miss today's records.
- **Effort:** Small (2-3h).
- **Migration risk:** Low.
- **Test strategy:** Set system clock to 23:00 IST, verify `todayIST()` returns the IST date, not the UTC date.

#### U24. JSDoc → optional TypeScript migration for services/
- **Category:** DX
- **Severity:** Low
- **Files:** All `services/*.js`.
- **Current behavior:** JSDoc varies in completeness. No type-checking.
- **Proposed change:** Run `tsc --noEmit --allowJs --checkJs` over `services/`, fix the JSDoc errors, then optionally migrate file-by-file to `.ts`. Don't introduce a build step yet — `node --experimental-strip-types` (Node 22+) or `tsx` for dev.
- **Why it matters:** Catches a class of bugs (typo in column name, missing await) that linting can't.
- **Effort:** Large (>20h, can be incremental).
- **Migration risk:** Low if done as `--checkJs` first; medium if rewriting to `.ts`.
- **Test strategy:** `tsc --noEmit` clean.

---

## Section 3 — Design Ideas

#### D1. Admin dashboard — KPI hierarchy + density refresh
- **Audience:** Admin
- **Pages affected:** `public/admin-dashboard.html`, `public/admin-live-dashboard.html`.
- **Current pain:** Stat cards (admin-dashboard.html) are 1.75rem-bold numbers with thin labels and a 4px left border accent (purple-ish). They read uniformly — no visual hierarchy between "Total Customers" (vanity metric) and "Overdue Tasks" (action-required). Admins scan and miss alerts.
- **Proposed UX:** Three-tier hierarchy:
  1. **Action-required band** at top: full-width row of red/amber tiles only when count > 0 (overdue tasks, overdue followups, anomalies, location-off staff). Each tile has a "Resolve →" button that deep-links.
  2. **Today's Pulse** — 4 large tiles (revenue, collected, new leads, attendance present/total). Big numbers (3rem), trend sparkline (Chart.js), tap shows drill-down.
  3. **Reference stats** — small grid of secondary metrics (total customers, products) at 60% opacity until hovered.
- **Visual treatment:** Headlines use `font-size: 2.5rem; font-weight: 800; letter-spacing: -0.02em; color: #1f2937`. Sparklines 32px tall, colour-matched to KPI. Card padding `20px 24px`, border-radius `14px`, shadow `0 1px 3px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.04)` (Linear-style two-tone). Action-required tiles use `background: linear-gradient(135deg, #FEF2F2 0%, #FFFFFF 60%); border-left: 4px solid #DC2626`.
- **Mobile considerations:** <600px: tiles stack vertically; trend sparkline hides; tap-target ≥44px.
- **Effort:** Medium.
- **Inspirations:** Linear inbox; Stripe Dashboard hero stats; Cash App Money page hierarchy.
- **Accessibility:** Numbers + label both readable in screen-reader order; trend direction also stated as `aria-label="Revenue up 12% vs last week"`. Contrast ≥7:1 on action band.

#### D2. Staff mobile clock-in flow — bottom sheet, single primary action
- **Audience:** Staff
- **Pages affected:** `public/staff/dashboard.html`, `public/staff/clock-in.html`, `public/staff/clock-out.html`.
- **Current pain:** `staff/dashboard.html` is 3,754 LOC mixing clock-in, attendance status, geofence, break, prayer, outside-work, daily tasks. The mobile screen is overloaded; the green/amber/red gradient buttons compete for attention.
- **Proposed UX:** Reduce to a single hero card showing current state (Clocked In since 09:14 — 3h 22m elapsed) and one primary action (Clock Out). Secondary actions (Take Break, Outside Work, Prayer) live in a bottom sheet that slides up from a "Actions" button. Keep status pill (geofence ok / warning) at the top.
- **Visual treatment:** Hero card 200px tall, white background, large clock state text (`font-size: 1.625rem; font-weight: 700`). Primary action button full-width below, `padding: 18px 24px; border-radius: 14px; background: linear-gradient(135deg, #1B5E3B 0%, #154D31 100%); box-shadow: 0 4px 12px rgba(27,94,59,.35); font-size: 1.0625rem; font-weight: 600`. Bottom sheet uses iOS-style drag handle (`width: 36px; height: 4px; background: #D1D5DB; border-radius: 2px`).
- **Mobile considerations:** Bottom sheet covers <85vh, has a drag-to-dismiss; safe-area inset on iOS; tap-targets ≥48dp.
- **Effort:** Medium.
- **Inspirations:** Cash App "Cash Card" hero; Stripe Atlas mobile flow; iOS Health "Today" card.
- **Accessibility:** Sheet is a focus trap; ESC closes; backdrop announced "press Escape to close".

#### D3. Painter dashboard polish — premium feel with the gold accent
- **Audience:** Painter
- **Pages affected:** `public/painter-dashboard.html`, `public/painter-profile.html`, `public/painter-points-history.html`.
- **Current pain:** `painter-dashboard.html` already has a beautiful dark-green-and-gold offer carousel (gradient `#0d2818 → #1a3a2a → #1B5E3B` with `#D4A24E` accents). But surrounding sections (stats, transaction list) use generic white cards that feel disconnected from the premium offer band. Painters don't perceive their loyalty status.
- **Proposed UX:** Apply the dark-green-and-gold treatment to the points/level header (top hero card) so it reads as the painter's "membership card". Show level (Bronze/Silver/Gold) with a tasteful badge and progress to next tier. Below: a 3-up stat row in white with hairline borders. Recent transactions stay clean white but with gold-tinted "Earned" pills and red-tinted "Debit" pills.
- **Visual treatment:** Hero card `background: radial-gradient(120% 120% at 0% 0%, #1B5E3B 0%, #0D3D23 100%); padding: 24px 20px; border-radius: 18px; box-shadow: 0 12px 32px rgba(13,40,24,.25)`. Level badge `padding: 4px 12px; border-radius: 999px; background: rgba(212,162,78,.16); color: #D4A24E; font-weight: 600; font-size: 0.75rem; letter-spacing: 0.06em; text-transform: uppercase`. Progress bar `height: 6px; background: rgba(255,255,255,.12); fill: linear-gradient(90deg, #D4A24E 0%, #B8860B 100%)`. Transaction list: row `padding: 14px 0; border-bottom: 1px solid #F1F5F9`.
- **Mobile considerations:** Hero hugs viewport top with safe-area; level badge stays visible while scrolling via sticky.
- **Effort:** Medium.
- **Inspirations:** Apple Wallet pass; American Express card UI; Sephora Beauty Insider tier UI.
- **Accessibility:** Gold `#D4A24E` on dark green meets WCAG AA at 16px+ bold; pure-text level uses white `#FFFFFF` for safety.

#### D4. Estimate-create — wizard + sticky summary
- **Audience:** Staff (also painter via `painter-estimate-create.html`)
- **Pages affected:** `public/estimate-create-new.html` (1,940 LOC).
- **Current pain:** Single long form with brand/customer/product picker, area-mode/unit-mode toggle, color variants, markup/discount, labor, GST. Cognitive overload; users miss fields and submit incomplete estimates.
- **Proposed UX:** 4-step wizard with sticky summary panel (right on desktop, bottom-sheet on mobile):
  1. Customer & branch
  2. Products & quantities
  3. Pricing (markup, discount, labor)
  4. Review & send
  Summary panel updates live, shows running total.
- **Visual treatment:** Step indicator top: 4 circles with hairline connectors, active circle filled `#1B5E3B`, completed gets a checkmark. Form section uses generous spacing (`padding: 24px; gap: 20px`). Summary panel `background: #F9FAFB; border-radius: 12px; padding: 20px; position: sticky; top: 16px`. Currency formatted with thousands separator and Indian comma grouping (`₹1,23,456.00`).
- **Mobile considerations:** Wizard becomes full-screen per step; "Next" button fixed bottom; summary slides up via tap on the `Total: ₹X` strip.
- **Effort:** Large.
- **Inspirations:** Stripe Checkout multi-step; Shopify product-create; Notion form-builder.
- **Accessibility:** Step indicator has `aria-current="step"`; form errors announced to screen readers; tab order matches visual order.

#### D5. Empty states + skeleton loaders
- **Audience:** All
- **Pages affected:** Every list page.
- **Current pain:** During loading, list pages show "Loading..." text or nothing. After load with no data, lists are blank ("No customers found"). Both look broken.
- **Proposed UX:**
  - **Skeleton loaders:** 3-5 placeholder rows with shimmer animation, matching the real row layout (avatar + 2 lines of text). Replace `<div>Loading...</div>` patterns.
  - **Empty states:** Friendly illustration (use Heroicons or a single SVG), heading ("No painters yet"), one-line subtext ("Add your first painter to start tracking points"), and a primary CTA button ("Add Painter").
- **Visual treatment:** Skeleton: `background: linear-gradient(90deg, #F3F4F6 0%, #E5E7EB 50%, #F3F4F6 100%); background-size: 200% 100%; animation: shimmer 1.4s infinite`. Empty state container max-width 400px, centered, `padding: 48px 24px`. Heading `font-size: 1.125rem; font-weight: 600; color: #111827`. Subtext `color: #6B7280; font-size: 0.875rem; line-height: 1.5`. CTA `background: #1B5E3B; color: white; padding: 10px 20px; border-radius: 8px`.
- **Mobile considerations:** Empty-state illustration max 120px to leave room for content.
- **Effort:** Medium (one shared component used 30+ times).
- **Inspirations:** Linear empty states; Notion blank-database; Shadcn UI skeleton.
- **Accessibility:** Skeletons have `aria-busy="true"`; empty state has heading + descriptive text + clear CTA.

#### D6. Toast / sheet / modal / table component extraction
- **Audience:** All
- **Pages affected:** All HTML pages.
- **Current pain:** Each page implements its own toast (or uses `alert()`), modal, and table. Inconsistent look, duplicated CSS. ~3000 LOC of repeated component code across pages.
- **Proposed UX:** Build a tiny vanilla-JS component library at `public/components/ui.js` exposing:
  - `toast(message, { variant, duration })`
  - `modal({ title, body, primary, secondary })` returning a Promise
  - `sheet({ title, body })` (mobile bottom-sheet)
  - `table(container, { columns, rows, actions, sort, filter })`
  - `chip({ label, variant, removable })`
  - `statCard({ label, value, trend, icon })`
  - `filterBar({ filters, onChange })`
  - `sidebarNav({ items, current })`
- **Visual treatment:** Toast slides in from top-right (or top-center on mobile), `min-width: 280px; max-width: 420px; padding: 12px 16px; border-radius: 10px; background: #1F2937; color: white; box-shadow: 0 10px 30px rgba(0,0,0,.25)`. Variants: success (green-left-stripe), error (red), info (blue), warning (amber). Auto-dismiss 4s, swipe-to-dismiss on mobile.
- **Mobile considerations:** Toast moves to top-center with safe-area top inset; sheet replaces modal on <600px.
- **Effort:** Large initial (12-16h), savings compound across every future page.
- **Inspirations:** Shadcn UI; Sonner (toast); Material 3 components; Vercel UI.
- **Accessibility:** Toast `role="status"` (or `role="alert"` for errors); modal is focus-trap with ESC dismiss; sheet announces title.

#### D7. Onboarding for new staff users — first-run tour
- **Audience:** Staff
- **Pages affected:** `public/staff/dashboard.html`, all top-level staff pages.
- **Current pain:** New staff (12 in last quarter) get no in-app guidance. They learn by asking other staff.
- **Proposed UX:** First login triggers a 4-step tour: (1) "This is your daily dashboard", (2) "Tap here to clock in", (3) "Daily tasks live here", (4) "Reach out to admin via Notice Board". Use an overlay with a spotlight on the highlighted element + tooltip card. Skippable; remembered via `users.onboarding_completed_at`.
- **Visual treatment:** Backdrop `rgba(15,23,42,.6); backdrop-filter: blur(2px)`. Tooltip card max-width 320px, `padding: 20px; background: white; border-radius: 14px; box-shadow: 0 20px 50px rgba(0,0,0,.25)`. Spotlight uses CSS clip-path. Step counter "1 of 4" subtle at top.
- **Mobile considerations:** Tooltip flips above/below the highlighted element based on viewport space; never overlaps it.
- **Effort:** Medium.
- **Inspirations:** Notion first-run; Linear onboarding; Intro.js patterns.
- **Accessibility:** ESC and a "Skip tour" link always reachable; focus ring visible on tooltip CTA.

#### D8. Painter card / visiting card preview improvements
- **Audience:** Painter / Admin
- **Pages affected:** `public/painter-profile.html`, `services/painter-card-generator.js`.
- **Current pain:** The 1400×800 generated visiting card is great for print but the preview on the painter profile is a flat image, hard to read on phone.
- **Proposed UX:** Re-render the card as a CSS component (not just a static image) for in-app preview, allowing zoom/pan on mobile. Provide "Download as PNG" (fetches the existing server-generated image) and "Send via WhatsApp" button.
- **Visual treatment:** Use a perspective-tilt effect on hover (desktop) — `transform: perspective(1000px) rotateY(-4deg) rotateX(2deg)`. Card has `border-radius: 14px; box-shadow: 0 20px 60px rgba(0,0,0,.25)`. On tap, removes tilt and goes full-width.
- **Mobile considerations:** Tilt disabled <600px; card scales to 95vw.
- **Effort:** Small.
- **Inspirations:** Stripe card design; Apple Wallet card flip animation.
- **Accessibility:** Card has `role="img"` and an `aria-label` with the painter's name + level.

#### D9. Sidebar nav — collapsible groups + favorites
- **Audience:** Admin
- **Pages affected:** `public/components/sidebar-complete.html` (1,467 LOC).
- **Current pain:** ~67 admin pages flat in a sidebar = scroll fatigue. Users hunt for the same 5 pages daily.
- **Proposed UX:** Group items by domain (Sales / Painters / Zoho / Staff / WhatsApp / System). Each group collapsible (saved to localStorage). Add a "Favorites" section pinned at the top — star icon next to each item, click adds to favorites. Recently visited shown below favorites.
- **Visual treatment:** Section header `font-size: 0.6875rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #6B7280; padding: 12px 16px 6px`. Active item `background: linear-gradient(90deg, #EEF2FF 0%, transparent 100%); border-left: 3px solid #6366F1; color: #4338CA; font-weight: 600`. Hover `background: #F9FAFB`. Star icon 16×16, hollow when not favorited.
- **Mobile considerations:** Sidebar is already off-canvas on mobile; favorites section appears at top when drawer opens.
- **Effort:** Medium.
- **Inspirations:** Linear sidebar; Notion sidebar; VS Code activity bar.
- **Accessibility:** Group headers are buttons with `aria-expanded`; arrow keys navigate items.

#### D10. Dark-mode feasibility study + admin opt-in
- **Audience:** Admin (start), then Staff/Painter
- **Pages affected:** `public/css/design-system.css`, all HTML.
- **Current pain:** Long admin sessions (audit-the-numbers nights) on bright white background cause eye strain.
- **Proposed UX:** Add `[data-theme="dark"]` selectors to `design-system.css` overriding the `:root` tokens. Admin profile dropdown gets a Light/Dark/System toggle. Persist to `users.preferred_theme`.
- **Visual treatment:** Dark palette: surface `#0F172A`, elevated `#1E293B`, hairline `#334155`, primary text `#F8FAFC`, secondary `#94A3B8`, accent (admin) keeps `#818CF8` bumped up for contrast. Staff/painter dark uses `#0D3D23` deep, `#154D31` elevated.
- **Mobile considerations:** Respects `prefers-color-scheme: dark` by default; saved override wins.
- **Effort:** Large (page-by-page audit needed because of inline styles).
- **Migration risk:** Medium — every page that hardcodes hex needs review. Start with admin-dashboard, admin-leads, admin-painters as feasibility check.
- **Inspirations:** Linear; Notion; Stripe Dashboard.
- **Accessibility:** All tokens validated to WCAG AA contrast in dark mode; toggle keyboard accessible.

#### D11. Filter chips + saved-views on admin lists
- **Audience:** Admin
- **Pages affected:** `public/admin-leads.html`, `public/admin-painters.html`, `public/admin-zoho-invoices.html`.
- **Current pain:** Filtering uses select dropdowns and a search box — clearing them all takes multiple clicks. No way to save a filter combo for repeated use.
- **Proposed UX:** Filters become removable chips at the top. "+ Add filter" opens a popover with available facets. Save current filter set as a named view (stored in `user_saved_views`).
- **Visual treatment:** Chip `background: #EEF2FF; color: #4338CA; padding: 4px 10px; border-radius: 999px; font-size: 0.8125rem; font-weight: 500; gap: 6px (with × icon)`. Saved-view dropdown above chips with checkmark on active view.
- **Mobile considerations:** Chips wrap on overflow; "+ Add filter" becomes a sheet on tap.
- **Effort:** Medium.
- **Inspirations:** Linear filters; GitHub issues filter bar.
- **Accessibility:** Each chip has remove button with `aria-label="Remove filter: status=active"`.

#### D12. Bottom navigation for staff/painter mobile (replace hamburger)
- **Audience:** Staff / Painter
- **Pages affected:** Staff and painter mobile pages.
- **Current pain:** Hamburger menu hides primary navigation behind one tap. Mobile-first audience uses Android Chrome.
- **Proposed UX:** Bottom tab bar (5 items max) for main destinations: Home, Leads, Activities, Notice Board, Profile. Active tab has filled icon + colored label.
- **Visual treatment:** Tab bar `position: fixed; bottom: 0; height: 60px (+ safe-area-inset-bottom); background: white; border-top: 1px solid #E5E7EB; box-shadow: 0 -2px 8px rgba(0,0,0,.05)`. Active label `color: #1B5E3B; font-size: 0.6875rem; font-weight: 600`. Active icon scales `1.05` and fills.
- **Mobile considerations:** Hide on scroll-down (transition `transform 200ms cubic-bezier(.4,0,.2,1)`), show on scroll-up. iOS safe-area-inset-bottom respected.
- **Effort:** Medium.
- **Inspirations:** Cash App; Instagram; Material 3 navigation bar.
- **Accessibility:** Each tab `role="tab"`, container `role="tablist"`; visible focus ring.

========== END REPORT ==========

INSTRUCTIONS FOR LOCAL CLAUDE CODE RECEIVING THIS:
- All paths in this report are relative to /www/wwwroot/act.qcpaintshop.com/ which maps locally to D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\act.qcpaintshop.com\
- Do NOT auto-implement everything. Wait for the user to pick: "implement U4, U7, U12 and D2, D5".
- For each picked item, follow normal local→commit→push→ssh deploy flow per the project's deploy boilerplate.
- Server HEAD captured above — if local master has drifted further by the time of implementation, rebase or note the drift.
