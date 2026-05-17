# QC Paint Shop Business Manager - System Skills & Capabilities

> **Platform**: act.qcpaintshop.com
> **Version**: Web on master HEAD · Staff Android 3.3.9 vc18 (internal) · Painter Android v3.5.0 vc38 (branch design/painter-app-ux-2026-05, APK delivered 2026-05-17, Play Store upload pending)
> **Last Updated**: 2026-05-17
> **Total Codebase**: ~205,000 LOC (web) | 106 frontend pages | Android app (3 flavors: staff / customer / painter)

---

## 1. SYSTEM OVERVIEW

### Description
Quality Colours Business Manager is a **multi-branch paint shop management platform** that handles every aspect of running a paint retail business - from customer walk-ins and AI-powered color visualization, through estimate generation and Zoho Books accounting integration, to staff attendance tracking with geo-fencing, salary management, and real-time team chat.

### Technology Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Node.js + Express.js 5.x |
| **Database** | MySQL 8.x (mysql2/promise) |
| **Real-time** | Socket.io 4.8 |
| **Frontend** | Vanilla HTML/JS + Tailwind CSS |
| **Design System** | Custom CSS (`design-system.css`, 1274 lines) |
| **PDF Generation** | PDFKit 0.17 |
| **Image Processing** | Sharp 0.34 |
| **AI Models** | Google Gemini 2.0 Flash (img2img + business analysis) + Anthropic Claude (fallback) + Pollinations AI Flux (text2img) |
| **Accounting** | Zoho Books API (OAuth 2.0) |
| **SMS Gateway** | NettyFish (DLT-compliant, Indian regulations) |
| **Email** | Nodemailer (SMTP) |
| **Push Notifications** | Web Push (VAPID) + Firebase Cloud Messaging (FCM) |
| **Mobile Apps** | Android (Kotlin, WebView hybrid, 2 flavors) |
| **Process Manager** | PM2 |
| **Server** | Ubuntu Linux (178.104.249.206) |

### Architecture Overview

```
[Android Apps]  [Web Browser]
     |               |
     +-------+-------+
             |
      [Nginx Reverse Proxy]
             |
      [Express.js Server]  <-- Socket.io (real-time)
             |
     +-------+-------+-------+
     |       |       |       |
  [MySQL]  [Zoho]  [AI]   [SMS/Email]
   (DB)    (Books) (Gemini) (NettyFish)
```

**Key Design Patterns**:
- Session-based auth with `user_sessions` table (staff) + OTP-based auth (customers)
- Role-based access control (RBAC) with granular module-level permissions
- Soft-delete pattern (status = 'inactive') for all major entities
- Modular route files with `setPool()` dependency injection
- Background services (sync scheduler, WhatsApp processor)

**Brand Theming** (Mar 7):
| Audience | Primary | Gradient End | Darkest | CSS Variables |
|----------|---------|-------------|---------|---------------|
| **Admin** | `#667eea` | `#764ba2` | `#4338ca` | `design-system.css` `:root` vars |
| **Staff** | `#1B5E3B` | `#154D31` | `#0D3D23` | Inline styles (override CSS vars) |
| **Painter** | `#1B5E3B` | `#D4A24E` (gold) | `#154D31` | Inline styles |
- Staff & Painter share the same dark green primary (`#1B5E3B`)
- `header-v2.html` uses JS role detection to apply green profile icon for staff/manager
- `design-system.css` CSS variables remain purple/indigo for admin; staff pages override with inline styles
- `manifest.json` `theme_color` = `#1B5E3B`
- Android `colors.xml` = `#1B5E3B` primary (shared across all build flavors)

---

## 2. CORE MODULES & FEATURES

### 2.1 Authentication & Authorization

**Staff Authentication**
- Login via mobile number/email/username + password (bcrypt hashed)
- Session tokens (32-byte hex) stored in `user_sessions` table
- Token expiry: 24h default, 720h (30 days) with "Remember Me"
- Password reset via email (temporary password)
- Change password (requires current password verification)
- Automatic session invalidation on password change

**Customer Authentication (OTP)**
- Phone-based OTP login (6-digit, 5-minute expiry)
- OTP stored in `otp_verifications` table (survives server restarts)
- Rate limiting: 5 OTPs per hour per phone
- Validates customer exists in `customers` or `estimate_requests` tables
- SMS delivery via NettyFish gateway (DLT-registered template)

**Staff Registration (Self-Service)**
- Public registration form with OTP verification (SMS + Email)
- Multi-step form: Personal Info -> Address -> Aadhar/PAN KYC -> Bank Details
- PAN number collection (optional, validated format: ABCDE1234F)
- Admin approval workflow with offer letter generation (PDF)
- Offer letter sent via email (SMTP)
- Duplicate phone/username checks
- Admin notification on new registration submission
- Admin notification on registration approval
- Pages: `staff-register.html`, `admin-staff-registrations.html`

**Role-Based Permissions**
- Roles: `admin`, `manager`, `accountant`, `staff`, `customer`
- Module-level permissions: `view`, `add`, `edit`, `delete`, `manage`, `approve`, `assign`
- 15+ permission modules: staff, customers, products, estimates, attendance, salary, leads, tasks, activities, branches, roles, settings, zoho, staff_registrations, categories, brands
- Middleware: `requireAuth`, `requireRole()`, `requirePermission()`, `requireAnyPermission()`
- Pages: `admin-roles.html`, `admin-role-permissions.html`

---

### 2.2 Zoho Books Integration

**OAuth 2.0 Connection**
- Full OAuth flow with authorization code exchange
- Auto-refresh of access tokens
- Manual code exchange endpoint for reliability
- Connection status monitoring
- Disconnect/reconnect capability
- Pages: `admin-zoho-settings.html`, `admin-zoho-dashboard.html`

**Dashboard Financial Filtering**
- Time-period filter pills: Today (default), Yesterday, This Week, This Month, Prev Month, This Year, Custom, All Time
- "Today" is the default view on page load — cards show today's data immediately
- Custom date range picker with validation
- Period comparison mode: shows % change arrows (▲/▼) vs previous equivalent period
- Inverted coloring for "bad" metrics (overdue up = red, outstanding up = red)
- Trend chart: Chart.js line chart with Revenue (purple), Collected (green), Overdue (red dashed)
- Granularity selector: Daily, Weekly, Monthly (auto-selected based on period)
- CSV export of filtered dashboard stats via `/api/zoho/dashboard/export`
- API endpoints: `GET /dashboard?from_date&to_date&compare`, `GET /dashboard/trend?from_date&to_date&granularity`, `GET /dashboard/export?from_date&to_date`
- Backward compatible: no params = all-time (existing behavior)

**Stat Card Drill-Down**
- Click any stat card (Revenue, Outstanding, Overdue, Collected, Total Invoices, Overdue Invoices, Unpaid Invoices) to see individual transactions
- Full-screen slide-in panel (z-index 9998, above header) with table, search, sort, pagination (25 per page)
- Invoice metrics show: Invoice #, Customer, Date, Due Date, Total, Balance, Status, View in Zoho
- Payment metric (Collected) shows: Payment #, Customer, Date, Amount, Mode, Reference, View in Zoho
- **First column clickable for Live Preview**: Invoice # or Payment # opens an in-app detail modal (no redirect)
- Live Preview shows: full transaction details, financial summary, line items (for invoices), related invoice (for payments)
- "View in Zoho" button in preview footer + action column links
- "View in Zoho" links open Zoho Books directly (uses `ZOHO_ORGANIZATION_ID` env var exposed via `/status`)
- CSV export of drilldown data, print-friendly layout
- Search filters by customer name or invoice/payment number
- Column header click sorts, toggle ASC/DESC
- Close via X button, Escape key, or backdrop click
- API endpoints: `GET /dashboard/drilldown?metric&from_date&to_date&search&sort&order&page&limit`, `GET /dashboard/drilldown/export?metric&...`
- API endpoint: `GET /payments/:id` — single payment detail with related invoice info
- Metrics: `revenue`, `outstanding`, `overdue`, `collected`, `total_invoices`, `overdue_invoices`, `unpaid_invoices`

**Data Sync**
- Full sync (items + invoices + customers + payments)
- Individual sync per entity type
- Automated background sync via `sync-scheduler.js` (cron-based)
- Sync log with history tracking
- Rate limiter for Zoho API calls (`zoho-rate-limiter.js`)

**Inventory Management**
- Items: List, search, filter, paginate, detail view, bulk edit, bulk update
- Stock levels: Per-location stock, stock history, stock sync
- Locations/Warehouses: Sync, map to branches
- Inventory adjustments (stock corrections)
- Reorder management: Config per item, reorder alerts, alert acknowledgment/resolution
- Purchase suggestions: AI-calculated, batch processing, category defaults, branch allocations
- Pages: `admin-zoho-items.html`, `admin-zoho-items-edit.html`, `admin-zoho-stock.html`, `admin-zoho-stock-adjust.html`, `admin-zoho-locations.html`, `admin-zoho-reorder.html`, `admin-zoho-purchase-suggestions.html`, `admin-zoho-bulk-jobs.html`

**Financial**
- Invoice list with search, filter, pagination, detail view
- Payment tracking
- Daily transaction summaries per location
- Transaction comparison reports
- Financial reports (sales, top items, customer analysis)
- Pages: `admin-zoho-invoices.html`, `admin-zoho-transactions.html`, `admin-zoho-reports.html`

**WhatsApp Integration**
- Queue-based message system
- Invoice payment reminder automation
- Manual send capability
- Queue management (view, delete, process)
- WhatsApp processor background service (`whatsapp-processor.js`)

---

### 2.3 AI Color Visualization

**Primary: Google Gemini (img2img)**
- Uses Gemini 2.0 Flash model with image generation
- Takes customer's building photo and repaints it with selected colors
- Preserves architectural details, shadows, non-paintable surfaces
- Photorealistic output with proper lighting

**Fallback: Pollinations AI Flux (text2img)**
- Free text-to-image model
- Generates sample building images with selected color schemes
- Used when Gemini is unavailable or quota exceeded
- Automatic fallback between models

**Color System**
- Paint color catalog system (JSON-based brand catalogs)
- Color theory engine: HSL analysis, temperature classification
- Auto-combination generator: 6 preset schemes (2-color and 3-color)
  - Classic Elegance, Warm Harmony, Cool Contemporary
  - Sophisticated Trio, Vibrant Living, Earth & Nature
- Color search by family, temperature, name/code
- Branded visualization footer with color swatches (SVG overlay via Sharp)

**Visualization Features**
- Single-color overlay visualization (soft-light blend)
- Multi-color AI visualization (up to 3 colors)
- Design request management with photo upload
- Visualization history per design request
- AI status check endpoint
- Page: `admin-design-requests.html`

---

### 2.4 Branch Management

**Branch CRUD**
- Create branches with auto-generated shop hours (7 days)
- Branch details: name, code, address, city, state, pincode, phone, email, GST
- Geo-fencing: latitude, longitude, radius (meters)
- Manager assignment from branch staff
- Active/inactive status management
- Page: `admin-branches.html`

**Shop Hours Configuration**
- Per-branch, per-day (Monday-Sunday) configuration
- Fields: is_working_day, open_time, close_time, expected_hours, late_threshold_minutes
- Break time limits (min/max minutes)

**Staff Assignment**
- View staff assigned to each branch
- Manager designation per branch

---

### 2.5 Staff Management

**User/Staff CRUD**
- Create, view, edit, deactivate staff members
- Profile fields: username, email, phone, full_name, role, branch_id, status
- Extended profile: date_of_birth, address (door_no, street, city, state, pincode)
- KYC documents: Aadhar number + proof, PAN number + proof (image/PDF upload)
- KYC status tracking: `incomplete` → `complete` → `verified` (auto-computed)
- KYC auto-computation: checks Aadhar + PAN + bank details, updates status on every profile save
- KYC status badge displayed on profile page and admin staff list
- Emergency contact: name, phone
- Bank details: account_name, bank_name, account_number, IFSC, UPI ID
- Profile picture upload with resize
- Self-profile update endpoint
- PAN proof upload endpoint: `POST /api/upload/pan-proof`
- Admin profile update with email + in-app notification to affected user
- Last login tracking
- Soft-delete (deactivate) with session cleanup
- Staff list shows profile avatar and KYC status column
- Pages: `admin-staff.html`, `admin-profile.html`

---

### 2.6 Customer Management

**Customer CRUD**
- Name, phone, email, address, city, GST number
- Customer type classification (with default discount/markup)
- Branch assignment
- Status management (approved/inactive)
- Search by name, phone, email
- Pages: `admin-customers.html`, `admin-customer-types.html`

**Customer Portal**
- OTP-based login (phone verification)
- Dashboard with estimates and design requests
- Estimate detail view
- Pages: `customer-login.html`, `customer-dashboard.html`, `customer-estimate-view.html`

**Customer Credit Limits (Zoho Customers)**
- Manages credit limits on **`zoho_customers_map`** (Zoho-synced customers, not local `customers` table)
- Uses `zoho_outstanding` (receivables from Zoho) as the "credit used" value — no manual recalculation needed
- Set/update credit limit per Zoho customer with reason tracking
- Real-time credit utilization monitoring (limit, outstanding, available, %)
- Overview dashboard: 6 cards (total customers, total limit, outstanding, available, with limit, over limit), last synced indicator
- **Zoho sync**: Setting/bulk-setting limits auto-syncs to Zoho Books via `updateContact()` (best-effort, response includes `zoho_synced`)
- **Invoice enforcement**: `checkCreditBeforeInvoice(pool, zohoContactId, amount)` — blocks invoicing if no limit set or limit exceeded. Integrated in painter push-to-Zoho. Logs violations.
- **Request workflow**: Staff submit credit limit requests → admin approves/rejects → auto-sets limit + Zoho sync + notifications
- Credit check endpoint for invoice validation (0 limit = BLOCKED, must request limit)
- Bulk update credit limits for multiple customers (with Zoho sync)
- "Sync from Zoho" button — calls `zohoAPI.syncCustomers()` to refresh outstanding amounts
- Branch filter dropdown (from `zoho_customers_map.branch_id`)
- Credit limit change history timeline (uses `zoho_customer_map_id`)
- Credit limit violations log (uses `zoho_customer_map_id`)
- Export CSV with GST, email, phone, branch columns
- Details modal: customer info (phone, email, GST, Zoho ID, last synced), summary cards, outstanding invoices (via `zoho_contact_id`), unused credits, credit history
- **Transaction page badges**: Collections Customers tab + Invoices page show credit utilization badges (green/amber/red/exceeded)
- Utilization color coding: green (<50%), amber (50-80%), red (>80%), critical (exceeded)
- **Permissions**: 3-tier access via `credit_limits.view` / `credit_limits.request` / `credit_limits.manage` (migration: `migrate-credit-limits-permissions.js`)
- Pages: `admin-credit-limits.html` (data-page=`credit-limits`, Leads subnav, uses PermissionManager for UI gating)
- Routes: `routes/credit-limits.js` (14 endpoints, exports `checkCreditBeforeInvoice`, uses `requirePermission` middleware)
- Tables: `zoho_customers_map` (credit_limit columns), `customer_credit_history`, `credit_limit_violations`, `credit_limit_requests` (request workflow)
- Migrations: `migrate-credit-limits.js`, `migrate-credit-limits-zoho.js`, `migrate-credit-limit-requests.js`, `migrate-credit-limits-permissions.js`
- Socket events: `credit_limit_request_new`, `credit_limit_request_resolved` (via `user_${userId}` rooms)
- server.js: `creditLimitRoutes.setIO(io)` at Socket.io init

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/credit-limits/customers` | List Zoho customers with credit info (search, branch, status, sort) |
| GET | `/api/credit-limits/overview/summary` | Dashboard overview stats (6 metrics + last synced) |
| GET | `/api/credit-limits/violations/list` | List credit violations |
| POST | `/api/credit-limits/check` | Check credit availability (zoho_customer_map_id) |
| POST | `/api/credit-limits/bulk-set` | Bulk update limits (+ Zoho sync) |
| POST | `/api/credit-limits/sync` | Sync customers from Zoho (replaces recalculate) |
| POST | `/api/credit-limits/requests` | Submit credit limit request (any auth user) |
| GET | `/api/credit-limits/requests` | List requests (staff=own, admin=all, pending_count) |
| PUT | `/api/credit-limits/requests/:id/approve` | Approve → auto-set limit + Zoho sync + notify |
| PUT | `/api/credit-limits/requests/:id/reject` | Reject with mandatory reason + notify |
| GET | `/api/credit-limits/:id` | Single Zoho customer credit detail + outstanding invoices |
| POST | `/api/credit-limits/:id/set-limit` | Update credit limit (+ Zoho sync) |
| GET | `/api/credit-limits/:id/history` | Credit change history (via zoho_customer_map_id) |

---

### 2.7 Product & Catalog Management

**Products**
- Full CRUD with brand/category association
- Product types: area_wise, unit_wise
- Pack sizes with per-size pricing and Zoho item mapping
- GST percentage configuration
- Area coverage specification
- Guest visibility toggle
- Searchable dropdowns for brand/category
- Image column: thumbnail from Zoho items via `pack_sizes → zoho_items_map` subquery
- Inline Zoho search when adding/editing pack size variants (event delegation, results rendered in-flow)
- Pages: `admin-products.html`, `admin-brands.html`, `admin-categories.html`

**Zoho Product Import** (`admin-products.html?tab=zoho-import`)
- Browse all Zoho Books items with brand/category/rate/stock/HSN
- Sync items from Zoho Books API (`POST /api/zoho/sync/items`)
- Filter by brand, category; search by name/SKU
- Paginated item list with summary cards (total items, brands, last sync time)
- **Push to Estimate Products**: Select items → smart grouping by `extractProductInfo()` → Import Review modal
- **Import Review Modal**: Editable product names, unit_wise/area_wise toggle, force re-import for already-mapped items (amber warning)
- Green tick on already-mapped items (JOINs with products to check active status)
- Subnav: 5th tab "Zoho Import" in `products-subnav.html`

**Bulk Map** (`admin-products.html?tab=bulk-map`)
- Dedicated tab for mapping unmapped pack sizes to Zoho items in bulk
- Summary cards: Total Unmapped | Selected | Ready to Save
- Filter bar: search, brand & category dropdowns
- Each row has inline Zoho item search dropdown
- Sticky "Save All Mappings" action bar
- Endpoints: `GET /api/products/unmapped-pack-sizes`, `POST /api/products/bulk-map`

**Product Image Upload** (Zoho Import tab)
- Image column on Zoho Import table (48x48 clickable thumbnail or "+" placeholder)
- Upload endpoint: `POST /api/products/:itemId/image`
- Stores to `zoho_items_map.image_url`

**Estimate Calculator**
- Area-based paint calculation (auto-mix optimization)
- Size optimization (largest containers first, minimize waste)
- Color cost addition
- Breakdown cost itemization

---

### 2.8 Estimates & Quotations

**Estimate Management**
- Auto-generated estimate numbers (EST + YYYYMMDD + sequence)
- Customer details (name, phone, address)
- Multi-item line items with product association
- Column visibility control (qty, mix, price, breakdown, color, total)
- GST breakdown toggle (18%)
- Status workflow: draft -> sent -> approved -> rejected -> cancelled
- Status history with audit trail
- Notes field
- Pages: `estimates.html`, `estimate-create-new.html`, `estimate-edit.html`, `estimate-view.html`, `estimate-actions.html`, `estimate-settings.html`

**Estimate Create Page — Split-Panel Redesign + Edit Mode (Apr 22)**
- `estimate-create-new.html` fully rebuilt as split-panel: 420px left (customer + product search) + flex-1 right (live estimate items + totals)
- **Mobile layout**: customer search + product search both inline in right panel (no drawer); filter chips + product list up to 55vh; mobile bottom bar: Grand Total + Save only
- Auth: `requireAuth` only — works for both admin and staff (no `zoho.view` needed)
- **3 new endpoints in `routes/estimates.js`** (inserted BEFORE `/:id` wildcard routes):
  - `GET /api/estimates/filter-options` — distinct brands + categories from `zoho_items_map`, 5-min in-memory cache (`_filterCache`/`_filterCacheAt`)
  - `GET /api/estimates/search-customers?q=` — merged Zoho (`zoho_customers_map`) + local (`customers`) deduped, max 10. NOTE: `zoho_customers_map` has NO `zoho_billing_address` — use `'' AS address`
  - `GET /api/estimates/search-products?q=&brand=&category=&page=` — `zoho_items_map LEFT JOIN pack_sizes LEFT JOIN products`, **`GROUP BY zim.zoho_item_id`** required (prevents duplicate rows per pack size), `MAX(p.area_coverage)`, page capped 1–100
- **Area calculator**: greedy `calculatePackCombo(packs, litersNeeded)` largest-first. `_recalcToken[itemId]` cancellation token prevents async race when user types fast. `_pendingAreaMeta` stores `{sqft, coats, mix_info}` between calculate and "Add".
- **XSS-safe customer selection**: `item.dataset.customer = JSON.stringify(c)` + `addEventListener('click')` — NOT onclick attribute (single quotes in names like "O'Brien" break `onclick` attribute JSON)
- **Save payload** (key fields server requires): `item_name`, `item_description` (NOT `description`); `num_coats` (NOT `coats`); `POST /send-whatsapp` requires `{ phone }` JSON body
- **Post-save modal**: WhatsApp button hidden when customer has no phone number; View Estimate → `/estimate-view.html?id=X`
- **Edit mode** (`?id=X` URL param): `estimate-edit.html` is a redirect stub → `estimate-create-new.html?id=X`. `loadEstimate(id)` populates customer card + all items. `saveEstimate()` uses `PUT /api/estimates/:id` when `isEditMode=true`. Banner shows "✏ Editing: EST-XXXX". Button reads "Update Estimate".
- **Per-item UX**: qty stepper (−/+) in estimate item card, editable name + description fields, editable base price. `e.stopPropagation()` required on all interactive buttons inside expandable rows.
- Unit tests: `tests/unit/estimate-search.test.js` (5 tests, `calculatePackCombo`)

**PDF Generation**
- Professional PDF output via PDFKit
- Company branding (logo, address, phone, email, GST)
- "ESTIMATE" header with orange accent
- Itemized table with configurable columns
- GST breakdown (optional)
- Grand total with amount in words
- Notes section
- Footer branding
- Supports Bearer token AND query param token auth

**Share & WhatsApp**
- Token-based public share links (64-char hex, 30-day expiry)
- WhatsApp message generation with pre-formatted text
- View count tracking
- Public view pages: `share/estimate.html`, `share/design-request.html`
- Public PDF download from share links

---

### 2.9 Design Requests (Customer Estimate Requests)

**Estimate Requests Pipeline**
- Customer submission (public form, no auth required)
- Photo upload with Sharp compression (1200px max, 80% JPEG)
- Auto-generated request numbers (CDR-YYYYMMDD-XXXX)
- Admin management: view, filter, status update, notes
- Status workflow: new -> in_progress -> completed -> rejected
- Staff assignment
- Statistics dashboard
- Pages: `request-estimate.html`, `customer-requests.html`, `admin-estimate-requests.html`, `staff-requests.html`

---

### 2.10 Attendance System

**Clock In/Out**
- Photo capture on clock-in and clock-out (mandatory)
- GPS location capture with geo-fence validation
- **Distance tracking**: always computes distance from branch (even when geo-fence is OFF), stored as `clock_in_distance` / `clock_out_distance` in meters
- Multi-branch support: staff can be assigned to multiple branches and clock in at any assigned location
- Per-staff geo-fence toggle: admin can disable geo-fence for individual staff members
- Branch-based geo-fencing (configurable radius per branch)
- Automatic nearest-branch detection on clock-in (uses GPS to match assigned branches)
- Geo-fence violation logging
- **Geo-fence auto clock-out**: staff 300m+ from branch → 5-minute grace period → auto clocked out with notification to BOTH staff AND all admins
- **Server-side geo enforcement**: `geo_warning_started_at`, `last_geo_check_at`, `last_geo_distance` columns on `staff_attendance`. Server checks every 5 min via `checkGeoWarnings()` in `auto-clockout.js` — auto-clocks out staff with expired geo warnings even if client is closed. Client resumes countdown from server timestamp on page reload (prevents refresh exploit).
- **Auto-clockout tracking**: `auto_clockout_type` (geo/max_hours/admin/end_of_day/ot_timeout) and `auto_clockout_distance` columns on attendance record
- **10 PM end-of-day force clock-out**: cron at 21:59 IST auto-clocks out all staff, ends active breaks/prayer/outside work, notifies via Socket.io
- Late detection (configurable threshold per branch, shop opens 08:30 AM)
- Work hours calculation

**Overtime Tracking & Approval System**
- After expected hours (e.g., 10h weekday, 5h Sunday), staff gets OT prompt ONCE (not repeated)
- Modal: "Request OT" (submits for admin approval) or "Clock Out Now", with optional reason textarea
- **15-minute auto-clockout timeout**: If staff doesn't respond to prompt within timeout, auto-clocked-out (`ot_timeout`)
- Server checks every 5 minutes + Socket.io `overtime_prompt` event (sent once, tracked via `ot_prompt_shown_at`)
- Frontend polls `GET /check-overtime-status` every 2 minutes as backup
- **OT Approval Flow**: Staff requests OT → admin approves/rejects → only approved OT counts toward salary
- OT request creates row in `overtime_requests` table (status: pending/approved/rejected/auto_clockout/expired)
- Admin endpoints: `PUT /overtime-request/:id/approve`, `PUT /overtime-request/:id/reject`, `GET /overtime-requests`
- Staff endpoint: `POST /request-overtime` (replaces old `POST /acknowledge-overtime`, which is kept as backward-compat wrapper)
- Socket events: `ot_request_new` (to admin), `ot_approved`/`ot_rejected`/`ot_timeout_clockout` (to staff)
- Staff dashboard badges: yellow "OT PENDING APPROVAL", green "OT APPROVED", red "OT REJECTED - Please Clock Out"
- Admin "OT Requests" tab on attendance page: filters (status/date/branch), review modal, approve/reject buttons
- Admin Live Today: OT badges on working hours column (green "OT" if approved, yellow "OT?" if pending)
- Admin stat card: "OT Pending" count (orange)
- On clock-out: `ot_approved_minutes` set only if approved request exists; `overtime_minutes` always computed
- Force clock-out at 10 PM: pending OT requests → expired; approved → `ot_approved_minutes` calculated
- Salary: uses `ot_approved_minutes` (not raw `overtime_minutes`) for OT pay calculation
- Configurable per branch: `ot_auto_timeout_minutes` (default 15), `ot_approval_required` (default true) in `shop_hours_config`
- Columns on `staff_attendance`: `ot_request_id`, `ot_request_status`, `ot_approved_minutes`, `ot_prompt_shown_at`
- Table: `overtime_requests` (id, user_id, attendance_id, branch_id, request_date, status, reason, approved_minutes, etc.)
- Migration: `migrations/migrate-ot-approval.js` (includes backfill: `overtime_acknowledged=1` → `ot_approved`)
- Pages: `staff/dashboard.html`, `admin-attendance.html`

**Break Management & Enforcement**
- Break start/end with photo proof
- Break duration tracking
- Break time validation against branch config
- Double-submit protection (`breakSubmitting` flag prevents duplicate requests)
- Video readiness check before capture (validates camera stream active)
- **Break geofence exemption**: geofence monitoring is paused during active breaks (no violations, no auto-clockout)
- **Break enforcement system** (configurable per branch):
  - Default allowance: 120min, warning threshold: 90min
  - `break_allowance_minutes` and `break_warning_minutes` stored in `shop_hours_config`
  - Allowance stored on each attendance record at clock-in for consistency
  - Warning toast at 90min total break, red alert at 120min (exceeded)
  - Excess break tracked: `excess_break_minutes`, `break_exceeded`, `effective_working_minutes`
  - Notifications sent to staff + admin when break limit exceeded
  - Staff dashboard shows "Break Left" mini-stat (green/amber/red color coding)
  - Expected clock-out time displayed with excess break adjustment
  - Admin Live Today table shows color-coded break badges (green <90m, amber 90-120m, red >120m)
  - Admin stat card: "Break Exceeded" count
  - Monthly view includes "Excess Break" column
  - `GET /api/attendance/break-status` endpoint for real-time break status
  - Migration: `migrations/migrate-break-enforcement.js`

**Native Geofence Background Service (Android)**
- `GeofenceLocationService.kt`: ForegroundService monitors GPS every 30s natively, independent of WebView
- Reports to `POST /api/attendance/location-report` with lat/lng/accuracy/authToken
- Server checks distance from branch location: 300m+ triggers FCM alert to staff + all admins
- `geo_warning_started_at` set on first violation; after 5min grace → auto-clockout (`auto_clockout_type = 'geo'`)
- `onProviderDisabled` detects GPS turned off → reports to `POST /api/attendance/location-off`
- `location_off_at` column tracks GPS-off time; server cron (60s) auto-clockouts after 2min (`auto_clockout_type = 'location_off'`)
- Skips enforcement during break/outside work/prayer (checks `break_start IS NOT NULL AND break_end IS NULL`, etc.)
- FCM channel `qc_geofence_alerts`: IMPORTANCE_HIGH, alarm sound, bypass DND, vibration `[0,500,200,500,200,500]`
- JS bridge: `QCApp.startGeofenceService(authToken)` called on clock-in, `QCApp.stopGeofenceService()` on clock-out
- Service auto-stops on server `action: "stop_service"` or `"auto_clockout"`, or 401 auth expired
- `ACCESS_BACKGROUND_LOCATION` permission requested on every app launch with rationale dialog

**Outside Work Periods**
- Staff can declare "Going Outside for Work" with a reason (e.g., client meeting, delivery)
- **Geofence exemption**: geofence monitoring is paused during active outside work
- Tracked in `outside_work_periods` table with start/end times, GPS, duration
- Outside work minutes accumulated on attendance record (`outside_work_minutes` column)
- UI: teal-colored button on staff dashboard, pulsing animation when active, elapsed timer
- Endpoints: `POST /outside-work/start`, `POST /outside-work/end`, `GET /outside-work/status`
- Server-side: geo-auto-clockout rejects with `OUTSIDE_WORK` code during active outside work

**Prayer Time Tracking**
- Staff can declare "Go to Prayer" — mirrors outside work pattern exactly
- **Geofence exemption**: geofence monitoring is paused during active prayer
- Tracked in `prayer_periods` table with start/end times, GPS, duration
- Prayer minutes accumulated on attendance record (`prayer_minutes` column)
- UI: green-colored button on staff dashboard, pulsing animation when active, elapsed timer
- **Mutual exclusion**: prayer, break, and outside work are mutually exclusive (can't start one while another is active)
- Auto-ended on clock-out and max-hours auto-clockout
- Endpoints: `POST /prayer/start`, `POST /prayer/end`, `GET /prayer/status`
- Server-side: geo-auto-clockout rejects with `AT_PRAYER` code during active prayer
- **Time Breakdown**: staff dashboard shows 2x2 grid (Shop, Outside, Prayer, Break) + Total Working
  - Shop time = totalWorking - outsideMinutes - prayerMinutes
- Admin timeline shows prayer_start/prayer_end events with green color
- Migration: `migrations/migrate-prayer-and-reports.js`

**Staff Notice Board / Activity Feed**
- Real-time activity feed on staff dashboard showing all staff activities visible to everyone
- Activity types: clock_in, clock_out, break_start/end, outside_start/end, prayer_start/end, lead_created, lead_followup, admin_notice, overtime, stock_check, task_completed
- Admin notices: priority levels (urgent/important/normal), optional expiry, branch targeting
- Filter tabs: All, Attendance, Breaks, Leads
- Real-time updates via Socket.io (`activity_feed_new`, `admin_notice_new` events)
- Auto-refresh every 60 seconds
- Shows last 24 hours of activities
- Tables: `staff_activity_feed`, `admin_notices`
- Service: `services/activity-feed.js` (logActivity, getFeed, getNotices, createNotice)
- Routes: `GET /api/activity-feed` (feed + notices), `POST /api/activity-feed/notices`, `DELETE /api/activity-feed/notices/:id`
- Migration: `migrations/migrate-notice-board.js`

**Daily Attendance Reports (10:05 PM IST)**
- Auto-sends daily attendance summary to all staff + admin PDF at 10:05 PM IST via `node-cron`
- **Delivery**: In-app FCM push notification (always) + WhatsApp (when session available)
- Report includes: clock in/out, time breakdown (Shop, Outside, Prayer, Break), total working, status
- Logged in `attendance_daily_reports` table (unique per user+date, upserts on resend)
- **Admin PDF Report**: Landscape A4 PDF with table of all staff, summary stats, auto-sent to all admin users
- Admin UI: Daily Reports tab in admin-attendance.html with date/branch filter, per-staff Send/Preview, bulk Send All
- Real-time: Socket.io `report_send_progress` and `report_send_complete` events to admin
- Service: `services/attendance-report.js` (generateReport, sendReport, sendAllReports, sendAdminReport, generateAdminPDF, sendLeadAlerts)
- Endpoints: `GET /report/preview`, `POST /report/send`, `POST /report/send-all`, `POST /report/send-admin`, `POST /report/send-lead-alerts`, `GET /report/staff-list`
- Migration: `migrations/migrate-prayer-and-reports.js`

**Lead Alerts (6:05 PM IST)**
- Auto-checks all active staff at 6:05 PM and sends alerts:
  - No leads created today → creation reminder
  - Overdue follow-ups → urgent alert with count
  - Pending follow-ups for today → completion reminder
- Delivery: In-app FCM notification + WhatsApp (when available)
- Service: `sendLeadAlerts()` in `services/attendance-report.js`
- Trigger endpoint: `POST /api/attendance/report/send-lead-alerts`

**Permission Requests**
- Staff can request permissions: late_arrival, early_checkout, extended_break, leave, half_day, re_clockin, outside_work
- Admin approval/rejection workflow with `review_notes` column
- DB columns: `approved_by`, `approved_at`, `rejection_reason`, `review_notes`
- Notification sent to staff on approval/rejection (via `user_id` + `request_type`)
- **Re-clock-in request**: After clock-out, staff can request overtime. Admin approves → `allow_reclockin = 1` → staff clocks in again creating new attendance record
- **Leave balance display**: When staff selects "leave" type, shows current month leave balance (Sunday/Weekday paid leaves used/remaining) with salary deduction warning if exceeding free quota
- Page: `staff/permission-request.html`

**Leave Policy & Balance**
- **Policy**: 1 paid Sunday leave + 1 paid weekday leave per month (same for all staff)
- Leaves beyond free quota are deducted from salary even if admin-approved
- Deduction formula: `excess_leaves × hourly_rate × standard_daily_hours` (same as absence deduction)
- Leave count source: `attendance_permissions` table (type='leave', status='approved'), split by `DAYOFWEEK(request_date)`
- **Endpoint**: `GET /api/attendance/leave-balance` — returns Sunday/weekday used/pending/remaining counts, `total_excess`, `will_be_deducted` flag
- **Staff dashboard card**: Leave Balance card showing Sunday/Weekday indicators (green=remaining, red=used), excess leave warning
- **Staff salary page**: Leave Balance card synced to selected month, leave deduction row in monthly summary

**Admin Features**
- Today's attendance summary (present, absent, late, on-break)
- **Absent staff list**: shows staff who haven't clocked in, with name, branch, phone, email (endpoint: `GET /admin/absent-today`)
- Monthly attendance report per user
- Attendance report with date range filtering
- **Distance column** in Live Today table (shows meters/km from branch)
- Manual attendance marking (admin override)
- Geo-fence toggle per staff (ON/OFF) in staff management
- Multi-branch assignment with primary branch selection
- Geo-fence violation viewer
- **Direct photo viewer**: `GET /api/attendance/record/:id` endpoint fetches single record with all photo paths, distance, GPS info
- Photo viewer shows all 4 types (clock-in, clock-out, break-start, break-end) with timestamps and distance
- **Staff Timeline**: comprehensive chronological view of all events for a staff member on a date (clock-in/out, breaks, outside work, geofence violations, photos, GPS). Endpoint: `GET /admin/staff-timeline`
- "View Timeline" button in Live Today table rows opens the timeline tab pre-filtered
- Pages: `admin-attendance.html`, `admin-geofence-logs.html`, `staff/history.html`, `admin-staff.html`
- Migration: `migrations/migrate-attendance-improvements.js` (run on server for DB schema changes)

---

### 2.11 Salary Management

**Salary Configuration**
- Per-user salary config: monthly_salary, hourly_rate (generated: monthly_salary/260), overtime_multiplier (default 1.5x)
- Work hours: standard_daily_hours (10h), sunday_hours (5h)
- Deductions: enable_late_deduction, late_deduction_per_hour, enable_absence_deduction
- Allowances: transport_allowance, food_allowance, other_allowance
- Effective date range (effective_from, effective_until), is_active flag
- 11 staff configured (Rs 12,000 - Rs 30,000)
- Page: `admin-salary-config.html`

**Monthly Salary Calculation**
- `calculateSalaryForUser(userId, month, calculatedBy)` function in `routes/salary.js`
- Attendance data from `staff_attendance`: present/absent/half_day/on_leave days, standard/sunday/overtime hours
- **Leave deduction**: queries `attendance_permissions` (type='leave', status='approved'), splits Sunday vs weekday leaves
- **Leave policy**: 1 paid Sunday leave + 1 paid weekday leave per month; excess deducted at `hourly_rate × standard_daily_hours`
- Pay components: standard_hours_pay, sunday_hours_pay, overtime_pay (approved OT only)
- Deductions: late_deduction, absence_deduction, **leave_deduction**, other_deduction
- `gross_salary` and `net_salary` are GENERATED ALWAYS AS (STORED) columns
- Individual (`POST /calculate`) and bulk (`POST /calculate-all`) calculation with per-staff error reporting
- Status: draft → calculated → approved → paid
- Notification sent to staff on salary approval
- DB columns: `paid_sunday_leaves`, `paid_weekday_leaves`, `excess_leaves`, `leave_deduction`
- Detail modal shows attendance summary (including paid leaves, excess leaves) and deduction breakdown (including leave deduction)
- Page: `admin-salary-monthly.html`
- Migration: `migrations/migrate-salary-leave-deduction.js`

**Salary Payments**
- Record payments with method (cash, bank_transfer, UPI, cheque)
- Transaction reference tracking
- Partial payment support (multiple payment records per salary)
- Payment status: unpaid → partial → paid
- Notification sent to staff on payment recording
- Page: `admin-salary-payments.html`

**Salary Advances**
- Staff can request advances (with reason)
- Admin approval/rejection workflow
- Notification sent to staff on advance approval/rejection
- Payment recording with recovery month (YYYY-MM)
- Summary statistics (pending amount, approved, rejected, paid)
- Pages: `admin-salary-advances.html`, `staff/salary.html`

**Staff Salary View**
- Staff self-service salary page: config view, monthly summary with month navigation, salary history, payment history
- **Leave balance card**: shows Sunday/Weekday leave usage for selected month, excess leave warning
- **Leave deduction row**: conditional display when leave_deduction > 0, shows excess day count
- Endpoints: `GET /my-config`, `GET /my-monthly`, `GET /my-payments`, `GET /my-advances`, `POST /my-advance-request`
- Page: `staff/salary.html`

**Reports**
- Monthly summary: total payroll, branch breakdown
- Overtime analysis, allowances summary, deductions analysis
- Page: `admin-salary-reports.html`

---

### 2.12 Task Management

**Staff Tasks (Admin-Assigned)**
- Task creation with title, description, priority, due date
- Assignment to individual staff or bulk assignment
- Notification sent to staff on task assignment
- Notification sent to assigner on task completion
- Status workflow: pending -> in_progress -> completed -> cancelled
- Progress tracking (percentage)
- Task updates with notes
- Task rating (admin rates completed tasks)
- Overdue task tracking
- Statistics dashboard
- Pages: `admin-tasks.html`, `staff/tasks.html`

**Daily Tasks (Template-Based)**
- Admin creates daily task templates (role-based)
- Staff see their daily tasks and respond
- Photo proof upload for task completion
- Material usage tracking with photos
- Day submission (marks all tasks complete for the day)
- History and status tracking
- Admin summary view with date filtering
- Pages: `admin-daily-tasks.html`, `staff/daily-tasks.html`

**Staff Daily Work Dashboard (AI Tamil Task Generator)**
- Unified daily work page showing everything a staff member needs after attendance
- Sections: Attendance status, Quick stats, AI Tamil tasks, Leads to follow up, Outstanding customers, Incentive summary
- AI Tamil Task Generator via Clawdbot: personalized tasks in Tamil based on staff's pending leads, overdue followups, branch outstanding, conversion targets
- Cron: 9:00 AM IST daily (`ai-scheduler.js`) generates tasks for all active staff
- Staff can toggle task completion, regenerate tasks on demand
- Fallback tasks generated without AI if Clawdbot unavailable
- Branch outstanding customers: staff see their branch's outstanding with phone call links
- Incentive tracker: this month's conversions, approved/pending amounts
- Table: `staff_daily_ai_tasks` (user_id, task_date, tasks_json, summary, lead_context)
- Config: `staff_daily_tasks_enabled`, `staff_daily_tasks_time`, `staff_daily_tasks_language` in `ai_config`
- Service: `services/staff-task-generator.js` (gatherStaffContext, generateTamilTasks, generateForAllStaff)
- Route: `routes/staff-daily-work.js` (5 endpoints under `/api/staff/daily-work`)
- Page: `staff-daily-work.html` (data-page="daily-work", in staff sidebar under "My Work")
- Endpoints:
  - `GET /api/staff/daily-work` - Full dashboard (attendance + leads + outstanding + incentives + AI tasks)
  - `GET /api/staff/daily-work/tasks` - Today's AI Tamil tasks
  - `POST /api/staff/daily-work/tasks/:index/toggle` - Toggle task completion
  - `POST /api/staff/daily-work/tasks/generate` - Regenerate today's tasks
  - `GET /api/staff/daily-work/outstanding` - Branch outstanding customers (search, sort)

---

### 2.13 Lead Management

**Lead Pipeline (Admin)**
- Full CRUD with search, filter, pagination
- Fields: name, company, email, phone, source, status, priority, value, notes, project_type, property_type, budget, timeline
- Status workflow: new → contacted → interested → quoted → negotiating → won/lost
- Staff assignment with in-app + push + Socket.io notifications
- Follow-up management with scheduled dates, types (call/visit/email/whatsapp/sms/meeting), and notes
- Lead conversion to customer (transaction-based)
- Lead statistics (by status, source, priority, followups today/overdue)
- AI lead scoring (deterministic 0-100 + AI enhancement for top leads)
- WhatsApp nurture campaigns (hot/warm/cold tiers)
- Staff Performance leaderboard tab (conversion rates, followup counts, avg response time, monthly trends)
- Page: `admin-leads.html` (2 tabs: Lead Management, Staff Performance)

**Staff Lead Management (Per-Staff Isolation)**
- Each staff member sees ONLY their own leads (`WHERE assigned_to = userId`)
- Manager sees branch leads; Admin sees all leads
- Staff can create leads (auto-assigned to self), update own leads, change status, log followups
- Mobile-first page with stats cards (Total, New Today, Follow-ups Today, Overdue, Converted)
- Filter tabs: All / Today's / Overdue / New / Hot (AI 80+)
- Lead cards with priority color-coding, quick actions (Call, WhatsApp, View)
- Pipeline/Kanban view toggle (New → Contacted → Interested → Quoted → Negotiating → Won)
- Detail slide-out panel with followup history, status change, AI score
- Socket.io real-time notifications on lead assignment
- 60-second auto-refresh
- Page: `staff-leads.html`
- Permissions: `leads.own.view`, `leads.own.add`, `leads.own.edit` (assigned to staff/manager/admin roles)

**Lead Followup Reminders**
- Daily 8 AM IST cron (`services/lead-reminder-scheduler.js`)
- Notifies staff with leads due today ("You have N follow-ups scheduled for today")
- Notifies staff with overdue followups ("You have N overdue follow-ups")
- Uses notification-service for in-app + push delivery

**API Endpoints** (25 total in `routes/leads.js`):
- Admin: `GET /`, `GET /stats`, `POST /`, `GET /:id`, `PUT /:id`, `DELETE /:id`, `PATCH /:id/status`, `PATCH /:id/assign`, `POST /:id/followup`, `GET /:id/followups`, `GET /:id/score`, `POST /:id/predict`, `POST /:id/convert`
- Staff: `GET /my/stats`, `GET /my/today`, `GET /my/list`, `POST /my/create`, `PUT /my/:id`, `PATCH /my/:id/status`, `POST /my/:id/followup`, `GET /my/:id/followups`
- AI Scoring: `GET /scoring/dashboard`, `POST /scoring/nurture`
- Performance: `GET /performance/leaderboard`, `GET /performance/:userId`

---

### 2.14 Activity Tracker (Mar 8-9)

**Staff Activity Sessions** (`services/activity-tracker-service.js`, `routes/activity-tracker.js`)
- 6 activity types: marketing, outstanding_followup, material_arrangement, material_receiving, attending_customer, shop_maintenance
- Session start/stop with timer, idle detection (15+ min), daily task auto-sync
- Photo upload required for shop_maintenance stop
- Customer note modal for attending_customer
- Auto-end on break/prayer/outside work/clock-out (via `attendance.js`)
- Tables: `staff_activity_sessions`, `staff_idle_alerts`

**Staff Dashboard Integration** (`public/staff/dashboard.html`)
- Activity selector grid (6 buttons) when no active session
- Active session display: "Currently doing" card with live timer + "Go to Page" button (contextual navigation to leads/collections/daily-tasks)
- Notice Board tabs: Main tabs (All / Attendance / Work) with sub-tabs (Clock In-Out, Breaks-Prayer / Leads, Activities)
- Activity feed entries show staff name + activity type with color coding

**Admin Views**
- Admin attendance page: "Activity" column with emoji + type + elapsed time, amber "Idle Xm" badge
- Admin activity monitor page: `admin-activity-monitor.html` with live staff cards + Daily Report tab
- Page: `staff/activities.html` (personal history)

**Daily Activity Report** (Mar 10)
- Automated daily report sent at 10:05 PM IST (with attendance reports) to admin users
- Delivery: PDF + in-app notification + WhatsApp (text summary + PDF attachment)
- Per-staff breakdown: clock in/out, activity-wise durations (MKT/OUT/MAT/RCV/CUS/SHP), total active time, idle time (வேலை செய்யாமல் இருந்த நேரம்), idle %
- Idle calculation: Total Working - Active Activities - Break - Prayer - Outside Work
- WhatsApp summary includes top 3 idle staff with Tamil labels
- Admin panel: "Daily Report" tab in `admin-activity-monitor.html` — date picker, branch filter, summary cards, detailed table, PDF download
- API: `GET /api/activity-tracker/admin/daily-report?date=`, `POST /api/activity-tracker/admin/daily-report/generate-pdf`
- PDF: A4 landscape via PDFKit, saved to `/uploads/reports/activity-report-{date}.pdf`
- Functions in `services/attendance-report.js`: `generateActivityReportData()`, `generateActivityPDF()`, `sendActivityAdminReport()`

---

### 2.15 Chat & Notifications

**Real-time Chat (Socket.io)**
- Direct messaging between staff members
- Group conversations
- Message types: text, image, file, system
- Typing indicators
- Read receipts (per-message and last_read_at)
- User list for starting conversations
- Real-time message delivery via Socket.io rooms
- Page: `chat.html`

**In-App Notifications**
- Real-time delivery via Socket.io
- Mark as read (individual and bulk)
- Unread count badge
- Notification bell in header (`header-v2.html`)
- Notification types across all modules:
  - `task_assigned` - New task assigned to staff
  - `task_completed` - Assigned task completed by staff
  - `permission_approved` / `permission_rejected` - Attendance permission decisions
  - `salary_generated` - Monthly salary approved
  - `salary_paid` - Salary payment recorded
  - `advance_approved` / `advance_rejected` - Salary advance decisions
  - `new_registration` - New staff registration submitted (to admins)
  - `profile_updated` - Admin updated staff profile (+ email notification)
  - `chat_message` - New chat message received
  - `estimate_status` - Estimate status changes

**Push Notifications**
- Web Push via VAPID keys
- **Service Worker** (`sw.js`): `push` event handler displays notifications with vibration, `notificationclick` handler opens deep-linked URLs
- **FCM data-only messages**: `notification-service.js` sends FCM as data-only payload (no `notification` block) to ensure `onMessageReceived()` is always called on Android
- **Android notification channel** has explicit sound URI + `AudioAttributes` for reliable sound on Android 8+
- Push subscription management (subscribe/unsubscribe)
- Auto-cleanup of stale subscriptions (410/404)
- Background notification delivery (non-blocking)

**Notification Click Routing** (Feb 20)
- `handleNotifClick(id, type, dataStr)` in `header-v2.html` routes to correct pages based on notification type
- Previously only handled `conversation_id` (chat) — all other notifications just closed the panel
- Role-aware routing: staff users → staff pages, admin → admin pages (e.g. `stock_check_assigned` → `/staff/stock-check.html` for staff, `/admin-stock-check.html` for admin)
- 20+ notification types mapped: `chat_message`, `stock_check_assigned`/`submitted`, `permission_approved`/`rejected`, `reclockin_request`, `break_exceeded`, `force_clockout`, `geo_auto_clockout`, `geo_auto_clockout_admin`, `task_assigned`/`completed`, `salary_generated`/`paid`, `advance_approved`/`rejected`, `overtime_alert`, `ot_timeout_clockout`, `activity_started`/`activity_ended`
- **OT FCM Push** (Mar 9): Overtime alerts now send FCM push notification (not just Socket.io). TTL set to expire at 10 PM IST so notification auto-dismisses at end of day. Also: OT timeout auto-clockout and 10 PM force-clockout send FCM push to staff.
- **Stale attendance cleanup** (Mar 9): `cleanupStaleAttendance()` in `auto-clockout.js` runs every 5 min, auto-closes attendance records left open from previous days with `end_of_day` type.
- Service worker (`sw.js`) push notification click handler also updated with matching routes
- Notification icons updated: type-specific icons for all 16+ notification types (previously only 6)

---

### 2.16 Settings & Configuration

- Business branding: name, logo, phone, email, address, GST
- Logo upload
- Category-based settings storage
- Public branding endpoint (for authenticated users)
- Admin-only full settings management
- Page: `admin-settings.html`

---

### 2.17 Website Content Management

**Admin-Controlled Public Website**
- All public landing page content is dynamically loaded from database
- Single public API endpoint (`GET /api/website/content`) returns all content in one call
- Admin CRUD for all website sections via `admin-website.html`

**Database Tables**:
- `website_services` - Services with icon, title (EN+Tamil), description, sort_order
- `website_features` - "Why Choose Us" items with icon, color, title (EN+Tamil), description
- `website_testimonials` - Customer testimonials (name, role, text, rating, photo)
- `website_gallery` - Portfolio images (image_url, caption, category, sort_order)

**Settings Keys** (stored in existing `settings` table):
- Hero section: `hero_title`, `hero_title_tamil`, `hero_subtitle`, `hero_subtitle_tamil`, `hero_cta1_text`, `hero_cta1_link`, `hero_cta2_text`, `hero_cta2_link`
- About section: `about_title`, `about_title_tamil`, `about_description`, `about_description_tamil`
- Footer: `footer_tagline`, `footer_tagline_tamil`
- Social: `social_whatsapp`, `social_instagram`, `social_facebook`, `social_youtube`
- Design request: `design_request_response_time`

**Public Landing Page Sections** (all dynamic):
1. Sticky navigation with scroll effect
2. Hero section with animated logo, dynamic CTAs
3. Quick access cards (estimate, customer, staff portals)
4. About Us with company stats
5. Services (from `website_services`)
6. Brands ticker (from existing brands API)
7. Branches with contact details
8. Gallery with category filters + lightbox
9. Testimonials carousel
10. Color design request form with response time badge
11. Why Choose Us features (from `website_features`)
12. Footer with social links, quick links, contact info

**API Routes** (`routes/website.js`):
- `GET /api/website/content` (public) - All content in one call
- `GET /api/website/gallery` (public) - Gallery with category filter
- CRUD: `/api/website/services`, `/api/website/features`, `/api/website/testimonials`, `/api/website/gallery-admin`
- `PUT /api/website/settings` - Bulk settings update
- `POST /api/website/upload` - Image upload (Sharp compression)

**Image Upload**: `public/uploads/website/` (Sharp: 1200x1200, JPEG 80%)
**Migration**: `scripts/migrate-website-content.js`
**Pages**: `index.html` (public), `admin-website.html` (admin)

---

### 2.18 Guide Management System

**Full CRUD Documentation Platform** — Admin creates/manages guides with rich text + full HTML, staff browses/searches/favorites them.

**Database Tables**:
- `guide_categories` - Categories with English + Tamil names, icon, sort_order, is_active
- `guides` - Full guide content: title (EN+TA), slug, content_type (rich_text/full_html), content_en/ta, summary, language (en/ta/both), status (draft/published), visible_to_staff, featured, view_count
- `guide_versions` - Automatic version history on every edit (stores previous content)
- `guide_views` - Per-user view tracking (user_id, guide_id, viewed_at)
- `guide_favorites` - Staff favorite bookmarks (user_id, guide_id)

**Content Types**:
1. **Rich Text** (`rich_text`) — Quill.js editor with visual/HTML toggle, stores delta JSON + rendered HTML
2. **Full HTML** (`full_html`) — Complete standalone HTML documents (like the Tamil attendance guide), rendered in sandboxed iframe with auto-resize

**Admin Features** (`admin-guides.html`):
- 3 tabs: Guides, Categories, Analytics
- Quill.js rich text editor (CDN v1.3.7) with visual ↔ HTML source toggle
- EN + TA content tabs for bilingual guides
- Category management with Tamil names
- Guide enable/disable, featured flag, staff visibility toggle
- Analytics dashboard: total views, active guides, staff reads, popular guides table

**Staff Features** (`staff/guides.html`):
- Category filter chips (horizontal scrollable)
- Search with debounce
- Guide cards with title, Tamil title, summary, language badge, view count, favorite heart
- Full reading view: iframe for full_html, direct rendering for rich_text
- Language toggle for bilingual guides
- Favorites system (toggle heart icon)

**API Routes** (`routes/guides.js`):
- `GET /api/guides/categories` - List categories (auth required)
- `POST /api/guides/categories` - Create category (admin)
- `PUT /api/guides/categories/:id` - Update category (admin)
- `DELETE /api/guides/categories/:id` - Delete category (admin)
- `GET /api/guides` - List guides (filters: category_id, status, language, search, staff_view)
- `GET /api/guides/:id` - Get guide + record view
- `POST /api/guides` - Create guide (admin)
- `PUT /api/guides/:id` - Update guide + save version history (admin)
- `DELETE /api/guides/:id` - Delete guide (admin)
- `POST /api/guides/:id/favorite` - Toggle favorite (auth)
- `GET /api/guides/admin/analytics` - Analytics dashboard data (admin)

**Default Categories** (seeded by migration): Attendance, Salary, Tasks & Work, App Guide, Policies, General
**Migration**: `migrations/migrate-guides-system.js`
**Pages**: `admin-guides.html` (admin), `staff/guides.html` (staff)
**Existing Guide**: Tamil attendance guide (`docs/attendance-guide-tamil.html`) auto-imported as full_html guide

---

### 2.19 Stock Check Assignment System

Admin assigns specific Zoho Books products to branch staff for daily physical stock verification. Staff submits counts with optional photo proof, admin reviews discrepancies, and pushes inventory adjustments back to Zoho Books.

**Admin Features** (`admin-stock-check.html`):
- 4 tabs: Assign, Review, Dashboard, History
- Assign: Select branch + Zoho location (Business/Warehouse) + staff + date, search/add products, auto-suggest (items not checked in 30 days), "show system qty to staff" toggle
- Review: Slide-in panel with system vs reported comparison, color-coded differences, photo thumbnails, push adjustment to Zoho
- Dashboard: Stat cards per branch (pending/submitted/reviewed/adjusted)
- History: Filterable table with status badges, pagination, delete pending, review submitted

**Staff Features** (`staff/stock-check.html`):
- Mobile-first with gradient header, sidebar navigation
- Shows today's assignments with item list
- Per item: name + SKU, system qty (if admin enables), number input, camera button (capture="environment"), notes
- Photo compression via sharp (800x800, JPEG 80%)
- Validates all items have counts before submit
- Post-submit: read-only state with timestamp
- **Real-time notifications**: Socket.io + socket-helper loaded dynamically, listens for `stock_check_assigned` events
- **Auto-refresh**: New assignments auto-appear when admin creates them
- **Visual alert**: Slide-down banner with assignment details, auto-dismiss 8s
- **Unified "Your Work" widget** (`staff/dashboard.html`): Combined stock check assignments + ad-hoc tasks in a single priority-sorted section
  - See "Staff Dashboard → Your Work" section below for full details

**Partial Submission / Batch Submit** (Feb 24):
- Staff can save partial progress on large stock checks (300-1,100+ items)
- **Batch submission**: Staff checks some items → submits batch → admin reviews & pushes to Zoho → staff continues → repeat
- `item_status` column on `stock_check_items`: `pending` → `checked` (saved) → `submitted` (sent to admin) → `adjusted` (pushed to Zoho)
- **Submit Checked Items button**: purple gradient, shows count: "Submit 50 Checked Items" — visible when there are checked-but-unsubmitted items
- **Locked items**: Submitted items get blue badge + disabled inputs; Adjusted items get purple badge + disabled inputs
- Progress bar fills based on (submitted + adjusted) / total: `50 submitted · 20 adjusted · 730 remaining`
- **Filter tabs**: All | Unchecked | Checked | Submitted | Diff — toggle visibility by item status
- **Save Progress button**: green gradient, shows count of unsaved items: "Save Progress (12 new)"
- **Resume flow**: On reload, fetches saved progress via `GET /progress/:id`, pre-fills values, locks submitted/adjusted items, shows resume banner
- Dirty item tracking via `dirtyItems` Set per assignment — only unsaved items sent to server
- Items visually marked as checked (green tint + checkmark) after save
- Default filter switches to "Unchecked" when resuming with partial progress
- **Admin review**: Review tab shows partial submissions with "Partial (50/1000)" badge, filter toggle (Submitted/Adjusted vs All Items), item_status badges per row
- **Admin push**: "Push X Discrepancies to Zoho" only processes `item_status='submitted'` items; after push items become `adjusted`; multiple Zoho adjustment IDs stored comma-separated
- **Fresh stock comparison** (Feb 24): On admin review/push, `difference` is recalculated against **live** `zoho_location_stock.stock_on_hand` (not the stale snapshot from assignment creation). Review panel shows "Orig Sys" (creation-time) and "Current" (live) columns; rows with stock changes since assignment highlighted amber. On push, `stock_check_items.system_qty`/`difference`/`variance_pct` are updated to reflect the actual values used, providing an accurate audit trail.
- Assignment auto-transitions to `status='adjusted'` only when ALL items are adjusted

**Staff Self-Request** (Feb 21):
- Staff can initiate stock checks themselves via "New Request" tab
- Product search with last-checked indicators (color-coded: green = recent, amber = old, red = never checked)
- Staff enters counts + photos + reason, submits directly
- Creates assignment with `request_type='self_requested'` and `status='submitted'`
- Admin sees self-requested items in Review tab with "Self-Requested" badge

**Staff Submission History** (Feb 21):
- "History" tab on staff page showing past submitted/reviewed/adjusted assignments
- Pagination support, detail view for each past submission

**Admin Enhancements** (Feb 21):
- Dashboard tab "Items Needing Check" widget: branch selector, shows products not verified in 30+ days via `/products/suggest`
- Review and History tables show "Self" / "Assigned" request type badges
- Review panel shows self-requested reason if present

**Branch Inventory Table** (Feb 21):
- On Assign tab, selecting a branch/location loads ALL items into a full-featured inventory table
- Columns: Checkbox, Item Name, SKU, Price (₹), Stock Qty, Last Checked (color-coded badge), Add button
- Instant search filtering by name/SKU with result count
- Sort dropdown (12 options): Name, SKU, Stock, Price, Updated, Checked (each asc/desc) — radio-button style
- Checkbox multi-select with Select All + bulk "Add Selected" action with selected count
- Pagination: 50 items/page with page controls, range display (e.g. "1-50 of 234")
- Already-added items grayed out (opacity 0.4), disabled checkbox, "Added" label instead of "Add" button
- Items re-enable when removed from Selected Products
- Clears selection state after assignment creation
- New endpoint: `GET /products/inventory` — returns all items with price (from `zoho_items_map.zoho_rate`) and last_checked
- Product search endpoint with last-checked timestamps used in Assign tab

**Bug Fixes** (Feb 20-21):
- Staff dropdown (`/api/branches/:id/staff`) now filters out `role='customer'` users
- Assign endpoint validates staff role (rejects customer accounts)
- `my-assignments` date uses local server time instead of UTC (fixes midnight timezone drift)
- DATE→string conversion uses local getters instead of `toISOString()` (fixes CET→UTC day shift)
- Added `COLLATE utf8mb4_unicode_ci` to `zoho_locations_map` JOINs in assignments list and review queries (collation mismatch fix)
- Staff `my-assignments` now sorts recent-first (DESC)

**Staff Page Tabs**: 3 tabs — Assignments | History | New Request

**API Endpoints** (`routes/stock-check.js`, 17 endpoints):
- `GET /locations/:branchId` — Zoho locations for a branch (admin)
- `POST /assign` — Create assignment with selected location + role validation (admin)
- `GET /assignments` — List with filters (admin); `?include_partial=1` also includes pending assignments with submitted items
- `GET /assignments/:id` — Detail (staff sees own, admin sees any)
- `DELETE /assignments/:id` — Delete pending (admin)
- `GET /my-assignments` — Staff's assignments by date (default today); `?pending=1` returns all pending/submitted; sorted DESC
- `GET /my-submissions` — Staff's past submitted/reviewed/adjusted assignments with pagination
- `POST /save-progress/:id` — Save partial progress (sets `item_status='checked'`, skips submitted/adjusted items)
- `GET /progress/:id` — Get progress stats + list of checked items with `item_status` for resume
- `POST /submit/:id` — Staff submits checked items as batch (sets `item_status='submitted'`; skips already submitted/adjusted; keeps assignment pending if items remain)
- `POST /self-request` — Staff self-initiates stock check (creates assignment + items with `item_status='submitted'`, `request_type='self_requested'`)
- `GET /review/:id` — Admin review with **live stock comparison**: LEFT JOINs `zoho_location_stock` for each item, returns `current_system_qty`, `live_difference`, `live_variance_pct` alongside original `system_qty`. Summary stats use live values.
- `POST /adjust/:id` — Push submitted items to Zoho using **live stock difference** (JOINs `zoho_location_stock` at push time). **Auto-resolves inactive locations** (e.g. deactivated warehouse) to the active branch location via `zoho_locations_map` lookup; updates assignment record to prevent repeated lookups. Updates `stock_check_items.system_qty`/`difference`/`variance_pct` with actual values used for audit trail. Marks all submitted→adjusted; auto-completes assignment when all items adjusted; stores comma-separated adjustment IDs for multiple pushes.
- `GET /dashboard` — Summary stats per branch
- `GET /products/suggest` — Items not checked in 30+ days (accepts `zoho_location_id`)
- `GET /products/search` — Search products from `zoho_location_stock` with `MAX(submitted_at)` as `last_checked`
- `GET /products/inventory` — All items for a branch location with price (`zoho_items_map.zoho_rate`) and last_checked (client-side filter/sort/paginate)

**Database Tables**: `stock_check_assignments` (includes `zoho_location_id`, `request_type`, `requested_reason` per assignment), `stock_check_items` (includes `item_status ENUM('pending','checked','submitted','adjusted')`)
**Migration**: `migrations/migrate-stock-check.js`, `migrations/migrate-stock-check-enhancements.js` (adds `request_type`, `requested_reason`), `migrations/migrate-stock-check-partial.js` (adds `item_status` column + index + backfill)
**Permission**: `zoho.stock_check`
**Notifications**: `stock_check_assigned` (to staff), `stock_check_submitted` (to admins)
**Photos**: `uploads/stock-check/` (sharp compressed)

---

### 2.20 Stock Migration Tool (Temporary)

One-time migration tool to transfer all stock from Warehouse locations to Business locations in Zoho, then disable warehouse locations.

**Features** (`admin-stock-migration.html`):
- Summary table showing all branches with warehouse/business location pairs
- Per-branch item count and total quantity from `zoho_location_stock`
- Individual "Transfer" button per branch or "Transfer All" bulk action
- Progress bar and real-time transfer log
- "Disable All Warehouse Locations" button (appears after transfers complete)
- Double-confirm safety prompts before destructive actions

**API Endpoints** (`routes/stock-migration.js`, 4 endpoints):
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/zoho/migration/warehouse-stock` | Get stock in all warehouse locations grouped by branch |
| POST | `/api/zoho/migration/transfer` | Create transfer order for one branch |
| POST | `/api/zoho/migration/transfer-all` | Transfer all branches (unused by UI, UI does sequential calls) |
| POST | `/api/zoho/migration/disable-warehouses` | Set `is_active=0` on warehouse locations |

**Zoho API**: Uses Zoho Inventory API (`/inventory/v1/transferorders`) — separate from Books API
**Permission**: `zoho.manage`
**Navigation**: Zoho subnav "Stock Migration" tab (temporary, remove after migration)

---

### 2.21 Collections & Payment Tracking

Centralized tool for managing outstanding invoices, sending payment reminders (WhatsApp, call, visit, email), and tracking promise-to-pay commitments. Now with per-branch filtering and customer-branch assignment.

**Admin Page** (`admin-zoho-collections.html`, data-page: `zoho-collections`, 5 tabs):
1. **Summary** — KPI cards: Total Outstanding, Overdue Amount, Collection Rate (30d), Avg Days Overdue + mini-stats (reminders today, pending/broken promises)
2. **Customers** — Customer-grouped outstanding with search, sort, **Branch column with assign dropdown**, actions (View Invoices, Send Reminder, Add Promise)
3. **Invoices** — Filterable table with bulk select for mass WhatsApp reminders, CSV export
4. **Reminders** — Timeline of all sent reminders (WhatsApp/call/visit/email), filter by type/date, "Log Call/Visit" button
5. **Promises** — Promise-to-pay tracking with status badges, auto-detect broken promises (past due + pending), quick status actions

**Staff Page** (`staff/collections.html`, data-page: `collections`, 4 tabs):
- Summary, Customers, Invoices, History — mobile-first, auto-filtered to staff's branch
- Gradient header with summary strip (Outstanding/Overdue/Customers count)
- Sort pills: Customers (Amount/Oldest Due/Overdue/Name), Invoices (Amount/Most Overdue/Due Date/Newest/Name)
- History tab: Calls/Promises sub-tabs with date+time formatted entries
- Actions: Send WhatsApp, Log Call, Add Promise (bottom-sheet modals)

**Branch Filtering** (Mar 9 — Invoice-level): All collection endpoints (summary, customers, invoices, export) now filter by `zi.local_branch_id` (invoice's branch), NOT `zcm.branch_id` (customer's branch). This ensures invoices are shown based on which branch created them. Payment rate query still uses customer branch as fallback (payments don't have branch). Migration: `migrate-invoice-branch.js` added `zoho_location_id` + `local_branch_id` to `zoho_invoices`. Zoho sync (`syncInvoices()`) populates via `zoho_locations_map` lookup.

**Customer-Branch Assignment**: Admin can assign customers to branches via dropdown in Customers tab, or bulk assign via API.

**WhatsApp Integration**: Dual-write to `whatsapp_followups` (operational queue, `message_type: 'custom'`) + `collection_reminders` (audit log). Uses `custom` type so staff's composed message is sent as-is (NOT `payment_reminder` which triggers a template). Dual-mode sending: per-branch session (whatsapp-web.js) → fallback to HTTP API.

**API Endpoints** (`routes/collections.js`, 12 endpoints):
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/zoho/collections/summary` | Dashboard KPI stats |
| GET | `/api/zoho/collections/customers` | Customer-wise outstanding (search, sort, paginate) |
| GET | `/api/zoho/collections/invoices` | Filterable invoice list |
| POST | `/api/zoho/collections/remind` | Send WhatsApp reminders (individual/bulk) |
| POST | `/api/zoho/collections/remind/log` | Log non-WhatsApp reminder (call/visit/email) |
| GET | `/api/zoho/collections/reminders` | Reminder history |
| GET | `/api/zoho/collections/promises` | List promises |
| POST | `/api/zoho/collections/promises` | Create promise-to-pay |
| PUT | `/api/zoho/collections/promises/:id` | Update promise status |
| GET | `/api/zoho/collections/export` | CSV export |
| PUT | `/api/zoho/collections/customers/:id/branch` | Assign customer to branch |
| POST | `/api/zoho/collections/customers/assign-branch` | Bulk assign customers to branch |

**Tables**: `collection_reminders`, `payment_promises` (both have `branch_id` column)
**Migration**: `migrations/migrate-collections.js`, `migrations/migrate-whatsapp-sessions.js` (adds `branch_id` columns)
**Permission**: `zoho.collections`
**Navigation**: Zoho subnav "Collections" tab, Staff sidebar "Collections" entry

### 2.22a Per-Branch WhatsApp Sessions

Each branch can connect its own WhatsApp number via `whatsapp-web.js`. Messages from Collections are routed through the branch's connected session.

**Admin Page** (`admin-whatsapp-sessions.html`, data-page: `zoho-whatsapp-sessions`):
- Branch cards grid showing: name, status dot (green/yellow/red), phone number, connected since
- QR code display area (rendered via `qrcode-generator` library)
- Connect / Disconnect / Test Send buttons
- Real-time updates via Socket.io (`whatsapp_qr`, `whatsapp_status` events)

**Service** (`services/whatsapp-session-manager.js`):
- Map of `branch_id → { client, status, qr, phoneNumber }`
- `connectBranch(branchId, userId)` — creates Client with LocalAuth, Chromium args
- `disconnectBranch(branchId)` — logout + destroy
- `sendMessage(branchId, phone, message)` — format `91XXXXXXXXXX@c.us`
- `initializeSessions()` — auto-reconnect previously connected sessions (staggered 3s)
- Socket.io emits to `whatsapp_admin` room for QR + status updates

**Dual-Mode Sending** (`services/whatsapp-processor.js`):
- If message has `branch_id` AND branch session is connected → send via local session
- Otherwise → fallback to HTTP API
- Zero breaking changes to messages without `branch_id`

**API Endpoints** (`routes/whatsapp-sessions.js`, 6 endpoints):
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/zoho/whatsapp-sessions/` | List all branch sessions with status |
| POST | `/api/zoho/whatsapp-sessions/:branchId/connect` | Start connection, trigger QR |
| POST | `/api/zoho/whatsapp-sessions/:branchId/disconnect` | Disconnect branch |
| GET | `/api/zoho/whatsapp-sessions/:branchId/qr` | Get current QR (fallback for missed Socket event) |
| GET | `/api/zoho/whatsapp-sessions/:branchId/status` | Get specific branch status |
| POST | `/api/zoho/whatsapp-sessions/:branchId/test` | Send test message |

**Table**: `whatsapp_sessions` (branch_id UNIQUE, status enum, phone_number, connected/disconnected timestamps)
**Migration**: `migrations/migrate-whatsapp-sessions.js`
**Permission**: `zoho.whatsapp_sessions`
**Navigation**: Zoho subnav "WhatsApp" tab (before Settings)
**Session storage**: `./whatsapp-sessions/` (gitignored, survives deploys)
**RAM**: ~300-500MB per branch session (Chromium). Max recommended: 4 branches + 1 General.

### 2.22b General WhatsApp (Company-wide Session)

A company-wide WhatsApp session that uses `branch_id = 0` as a sentinel value. Works as a fallback when a branch's own session is disconnected.

**Architecture**:
- `GENERAL_ID = 0` constant exported from `whatsapp-session-manager.js`
- FK constraints dropped on `whatsapp_sessions`, `whatsapp_messages`, `whatsapp_contacts`, `wa_campaigns`, `wa_campaign_leads` to allow `branch_id = 0`
- General session stored in the same `sessions` Map with key `0`

**Fallback Logic** (in `sendMessage()` / `sendMedia()`):
1. Try target branch session first
2. If disconnected and `branchId !== 0`, try General session (`sessions.get(0)`)
3. If General also disconnected, return `false`
4. Messages sent via fallback are recorded with `branch_id = 0` (General)
5. ALL callers (campaigns, reports, chat replies, processors) automatically benefit from fallback

**Processor Fix** (`whatsapp-processor.js`):
- JS truthiness bug fixed: `!0 === true` and `0 && x === 0` prevented `branch_id = 0` routing
- Now uses `== null` / `!= null` checks instead of falsy checks

**Admin Sessions Page** (`admin-whatsapp-sessions.html`):
- Dedicated "General WhatsApp" card at top with green company-wide badge
- Same connect/disconnect/QR/test flow using branchId=0 API endpoints
- Branch sessions grid shown below with "Branch Sessions" label
- Socket.io events for branchId=0 update the General card independently

**Admin Chat Page** (`admin-whatsapp-chat.html`):
- Branch filter dropdown: "All Accounts" (default) → "General WhatsApp" → branch options
- Account badge on each conversation: green "General" or gray branch name
- Chat header shows "via General WhatsApp" or "via [branch name]"
- Conversations query uses `LEFT JOIN` + `CASE WHEN branch_id = 0 THEN 'General'`

**API Changes**:
- `GET /api/zoho/whatsapp-sessions/` now returns `{ data: [...branches], general: {...} }`
- All `:branchId` endpoints work with `0` (connect, disconnect, QR, status, test)
- Chat conversations query changed from `JOIN` to `LEFT JOIN` for branch_id=0 support

**Marketing Integration** (`wa-marketing.js` + `admin-wa-marketing.html`):
- "General WhatsApp (Company)" appears as first option in campaign branch dropdown and instant send dropdown
- Campaign list/detail/dashboard queries show "General WhatsApp" label for `branch_id = 0`
- Validation uses `== null` checks to allow `branch_id = 0` to pass

**Collections Integration** (`collections.js` + `admin-zoho-collections.html`):
- Reminder modal has "Send via" dropdown: General WhatsApp (default for admin) or Auto (Branch / General fallback)
- `session_type: 'general'` in POST /remind → forces `branch_id = 0` routing
- `session_type: 'auto'` or absent → existing 4-tier branch resolution with session manager fallback
- **6 reminder templates**: English/Tamil x Polite/Overdue/Urgent — auto-selects based on days overdue (>30=urgent, >0=overdue, else=polite)
- Template selector dropdown with `onchange="applyReminderTemplate()"` + editable textarea
- Bulk remind uses selected template for all messages

**Socket Fix** (`socket-helper.js` + `admin-wa-marketing.html`):
- `qcSocket` exposed on `window` object (`window.qcSocket = qcSocket`) for cross-script access
- Marketing page socket listeners fixed: was polling `window.socket` which never existed

**Migrations**:
- `migrations/migrate-general-whatsapp.js` (drops FK on sessions/messages/contacts)
- `migrations/migrate-general-wa-integration.js` (drops FK on wa_campaigns/wa_campaign_leads/wa_instant_messages/wa_sending_stats)

---

### 2.22 Dashboard & Reports

**Admin Dashboard**
- Total users, customers, products, estimates
- Today's attendance count
- Lead statistics (total, new)
- Task statistics (pending, overdue)
- Monthly estimates (count, total value)
- 9 Quick-action buttons: All Modules (toggles sidebar), Chat, Leads & CRM, Branches & Staff, HR & Attendance, Salary & Payroll, Products & Inventory, Sales & Estimates, Zoho Books
- Page: `admin-dashboard.html`

**Staff Dashboard**
- Personalized greeting with user's first name ("Hi, John")
- Profile avatar display (photo or initials fallback)
- Personal attendance status (timer, clock in/out, breaks, prayer, outside work)
- Daily Tasks checklist widget (progress bar, Open Daily Tasks button)
- **"Your Work" unified section** — combines stock check assignments + ad-hoc tasks in one priority-sorted view:
  - Filter tabs: All | Stock Checks | Tasks | Completed (with counts)
  - Red badge showing urgent item count (new + overdue)
  - **9-level priority sort**: NEW stock check (red pulse) → Overdue SC → NEW task (red pulse) → In-progress SC → Overdue task → In-progress task → Pending SC (blue) → Pending task (gray) → Completed (green, 24h only)
  - Stock check cards 20% larger than task cards (17px padding, 15px title)
  - Progress bars for in-progress stock checks (fetched via `GET /progress/:id`)
  - "NEW" badge with pulse animation for items created < 5 minutes ago
  - Real-time: Socket.io listens for `stock_check_assigned` + `task_assigned` → toast + auto-refresh
  - Auto-refresh every 60 seconds
  - APIs: `GET /api/stock-check/my-assignments?pending=1` (includes `location_name` via zlm JOIN), `GET /api/tasks/my-tasks?limit=20`, `GET /api/stock-check/progress/:id`
- Quick action buttons (History, Permission, Activities, Stock Check)
- Bank Details section (view/edit)
- Page: `staff/dashboard.html`

### 2.23 AI Business Intelligence System

**Architecture**: Triple AI provider system (Google Gemini + Anthropic Claude + Clawdbot/Kai) with automatic failover chain and config-driven provider enablement. Currently **Clawdbot is the sole active provider** (Gemini/Claude disabled via `ai_config` flags). Daily/weekly automated analysis of business data with WhatsApp delivery. Interactive chat interface for natural language business queries.

**Services (7 files)**:
| File | Purpose |
|------|---------|
| `services/ai-engine.js` | Triple LLM abstraction (Gemini + Claude + Clawdbot) with `isProviderEnabled()` config filter — `generate()`, `streamToResponse()`, `generateWithFailover()`, `streamWithFailover()`, `getChatSystemPrompt()` |
| `services/ai-context-builder.js` | **Comprehensive business context for chat** — Tier 1 quick summary + Tier 2 deep category-specific context + daily snapshot generation |
| `services/ai-analyzer.js` | Zoho business analysis (revenue, collections, overdue, branch performance, stock alerts) |
| `services/ai-staff-analyzer.js` | Staff performance (attendance, breaks, overtime, late arrivals, weekly trends) |
| `services/ai-lead-manager.js` | Deterministic lead scoring (0-100) + AI enhancement, stale lead detection |
| `services/ai-marketing.js` | Marketing strategy (brand/category trends, customer segments, slow-moving stock) |
| `services/ai-scheduler.js` | Cron orchestrator for all automated analysis jobs + daily snapshot crons |

**Routes**: `routes/ai.js` — 15+ endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/ai/conversations` | List user's chat conversations |
| POST | `/api/ai/conversations` | Create new conversation |
| DELETE | `/api/ai/conversations/:id` | Delete conversation |
| GET | `/api/ai/conversations/:id/messages` | Get conversation messages |
| POST | `/api/ai/chat` | SSE streaming chat with business context injection |
| GET | `/api/ai/insights` | List insights (filter by category, severity) |
| GET | `/api/ai/insights/summary` | Unread counts by category/severity |
| PUT | `/api/ai/insights/:id/read` | Mark insight as read |
| PUT | `/api/ai/insights/:id/dismiss` | Dismiss insight |
| POST | `/api/ai/insights/read-all` | Mark all insights as read |
| GET | `/api/ai/analysis-runs` | List analysis run history |
| POST | `/api/ai/analysis/run` | Manually trigger analysis |
| GET | `/api/ai/lead-scores` | Get scored leads list |
| GET | `/api/ai/lead-scores/:leadId` | Single lead score + breakdown |
| GET | `/api/ai/config` | Get AI configuration |
| PUT | `/api/ai/config` | Update AI configuration |
| GET | `/api/ai/stats` | Usage stats (tokens, runs, costs) |
| GET | `/api/ai/suggestions` | List AI suggestions (filter by category, status) |
| GET | `/api/ai/suggestions/summary` | Suggestion counts by status |
| PUT | `/api/ai/suggestions/:id` | Update suggestion status |
| POST | `/api/ai/context/refresh` | Manually refresh daily business snapshot |

**Database (8 tables)**:
- `ai_conversations` — Chat sessions per user
- `ai_messages` — Messages within conversations (user/assistant/system, `context_summary` for debug)
- `ai_analysis_runs` — Automated analysis execution log
- `ai_insights` — Extracted insights with category, severity, actions
- `ai_lead_scores` — Deterministic + AI lead scores with breakdown
- `lead_conversion_predictions` — AI conversion probability, timeline, confidence, factors (JSON)
- `ai_config` — Key-value configuration for schedules, providers, thresholds, provider enable flags (`gemini_enabled`, `claude_enabled`, `clawdbot_enabled`)
- `ai_business_context` — Cached daily business snapshots (generated at 6AM/12PM/6PM IST)
- `ai_suggestions` — AI improvement recommendations with category, priority, status tracking

**Automated Schedules** (all configurable via ai_config):
- Zoho daily analysis: 9 PM IST (revenue, collections, overdue, stock)
- Staff daily analysis: 10:30 PM IST (attendance, performance, breaks, OT)
- Lead scoring: Every 6 hours (deterministic + AI recommendations)
- Weekly Zoho analysis: Monday 8 AM IST
- Weekly marketing tips: Monday 9 AM IST
- **Daily business snapshots: 6 AM, 12 PM, 6 PM IST** (cached context for chat)

**Chat Features (Assistant Manager — upgraded Feb 23, trained Mar 9)**:
- **Dedicated CHAT_SYSTEM_PROMPT**: Full "QC Business Manager" persona — data-first, comparative, proactive, actionable
- **READ-ONLY limitations** (Mar 9): Prompt explicitly states AI cannot create assignments, send messages, or modify DB. Must provide plans and say "ask admin/Claude Code to execute"
- **Stock check domain knowledge** (Mar 9): Staff-branch mapping rules, adjusted items exclusion, assignment flow
- **WhatsApp style**: No greetings ("வணக்கம்"), direct professional tone
- **Two-tier context system** (`ai-context-builder.js`):
  - Tier 1: Quick summary always injected (~50ms) — today's revenue vs yesterday, collections, overdue, staff, leads, stock
  - Tier 2: Category-specific deep context triggered by keyword matching (8 categories):
    - Revenue: branch breakdown, top 5 customers, monthly/weekly comparison
    - Collections: collection rate, overdue aging brackets (1-30/31-60/61-90/90+), top 10 debtors, payment promises
    - Staff: currently clocked-in, absent list, late arrivals, break excess, pending OT, completed shifts
    - Leads: status funnel, stale leads, today's follow-ups, top AI-scored leads
    - Inventory: out-of-stock items, below reorder level, **per-branch stock check progress** (adjusted/remaining counts), **staff-branch mapping**, **current assignment details**
    - WhatsApp: recent campaign stats
    - Insights: unread critical/warning alerts
    - General: loads ALL categories above
- **Daily snapshot caching** in `ai_business_context` table — used as fallback when no specific category detected
- SSE streaming responses with real-time token display
- Conversation history with per-user isolation
- Provider toggle (Gemini/Claude) per session
- **12 quick prompt buttons** (Health Check, Revenue Analysis, Collection Report, Staff Report, etc.)
- **Suggestions tab** (4th tab): filter by category/status, priority badges, inline status updates
- Chat-specific config: `chat_max_tokens` (default 8192), `chat_temperature` (default 0.5)
- Context summary saved in `ai_messages.context_summary` for debugging

**Lead Scoring Formula** (deterministic, 0-100):
- Budget: 0-25 pts | Status: 0-20 pts | Recency: 0-20 pts
- Engagement: 0-15 pts | Source: 0-10 pts | Responsiveness: 0-10 pts
- Scores denormalized to `leads.lead_score` + `leads.lead_score_updated_at` for fast sort/filter

**AI Lead Scoring Dashboard** (Feb 23):
- **Page**: `admin-lead-scoring.html` (`data-page="lead-scoring"`)
- **Navigation**: Leads subnav → "AI Scoring" tab
- **Features**: Score overview cards (avg/hot/warm/cold/predicted), distribution bar, nurture campaign buttons, top 20 scored leads table, lead detail slide-out panel
- **Detail panel**: Large score ring, 6-component breakdown bars, conversion prediction card, AI follow-up suggestions, recent followups
- **Conversion predictions**: AI-powered probability/timeline/confidence/factors → stored in `lead_conversion_predictions`
- **Follow-up suggestions**: AI-generated actionable suggestions (type, title, message, timing, priority, reasoning)
- **Nurture campaigns**: Trigger WhatsApp campaigns by tier (hot/warm/cold) via General WA (branch_id=0)
- **Endpoints** (in `routes/leads.js`):
  - `GET /api/leads/scoring/dashboard` — distribution + top leads + predictions + last run
  - `POST /api/leads/scoring/nurture` — trigger WA nurture by tier
  - `GET /api/leads/:id/score` — score + breakdown + prediction + suggestions
  - `POST /api/leads/:id/predict` — generate conversion prediction
- **Backend** (`services/ai-lead-manager.js`): `syncScoresToLeads()`, `predictConversion(leadId)`, `generateFollowUpSuggestions(leadId)`, `triggerNurtureCampaign(leadIds, type, userId)`
- **Config**: `lead_nurture_enabled`, `lead_prediction_enabled` in `ai_config`
- **Migration**: `migrations/migrate-lead-scoring-upgrade.js`

**WhatsApp Delivery**: Analysis summaries sent via General WhatsApp (branch_id=0) to configured recipients.

**Page**: `admin-ai.html` (6 tabs: Dashboard, Chat, Insights, Suggestions, Settings, App Analyzer)
- **Permission**: `system.ai`
- **Navigation**: System sub-nav → AI tab
- **Migrations**: `migrations/migrate-ai-tables.js` (initial), `migrations/migrate-ai-assistant-upgrade.js` (Assistant Manager upgrade)

#### AI Dashboard (Tab 1)
Visual business command center with real-time KPIs, charts, and branch scorecards — all powered by existing Zoho-synced data.

**Endpoint**: `GET /api/ai/dashboard` — single combined endpoint with 10s in-memory cache, runs 14 parallel SQL queries:
- KPIs: today/yesterday revenue (`zoho_invoices`), month revenue, today collections (`zoho_payments`), overdue with ageing buckets, staff present (`staff_attendance`), active leads, stock alerts (`zoho_location_stock`)
- Revenue Trend: 30-day line chart from `zoho_daily_transactions` (revenue + collections)
- Branch Scorecard: from `zoho_daily_transactions` grouped by `zoho_location_id` — month/last month revenue, collections, collection rate %, plus stock per branch from `zoho_location_stock` JOIN `zoho_locations_map`
- Top 10 unread insights + Top 5 new suggestions

**Frontend Components**:
- Quick AI Query Bar: input + 6 quick-query chips → switches to Chat tab and sends message via `sendMessage()`
- 6 KPI Cards: Today Revenue (vs yesterday %), Month Revenue (vs last month %), Collections, Overdue (with ageing), Staff (present/total), Stock Alerts (out + low)
- Insights Panel: top 10 unread, severity-coded, click to mark read, "View All" → Insights tab
- Branch Scorecard Table: branch name, month revenue, change %, collections, collection rate %, stock items, out-of-stock count
- Chart.js Charts (CDN `chart.js@4.4.7`): Revenue Trend (30-day line) and Branch Comparison (horizontal bar) with tab switcher
- Auto-refresh every 60 seconds

**Currency**: INR lakhs notation via `formatINR()` — ₹1.07L, ₹22.7Cr etc.

#### App Analyzer (Tab 6)
AI-powered application self-analysis that scans database schema, routes, errors, health metrics, and business stats, then uses the AI engine to detect issues, suggest upgrades, and generate ready-to-paste Claude Code prompts.

**Service**: `services/app-metadata-collector.js` — 5 scanners + orchestrator
- `collectDatabaseSchema()` — SHOW TABLES → DESCRIBE/SHOW INDEX/COUNT for each, auto-detects missing indexes on `*_id` cols, missing `updated_at`, empty/large tables
- `collectRouteMap()` — reads `server.js` + `routes/*.js`, regex-extracts `router.(get|post|put|delete)` patterns with mount prefixes
- `collectRecentErrors()` — reads `global._appErrorBuffer` (last 100 console.error calls) + PM2 error log, deduplicates by message
- `collectHealthMetrics()` — process.memoryUsage(), uptime, os stats, DB connection test
- `collectBusinessStats()` — entity counts (users, branches, painters, etc.), top 10 largest tables
- `runFullScan()` — runs all 5 in parallel (Promise.allSettled), 5-minute cache

**Endpoints** (in `routes/ai.js`):
- `GET /api/ai/app-scan` — runs full scan, returns structured JSON
- `POST /api/ai/app-analyze` — SSE streaming AI deep analysis of scan data, focus filter (all/database/routes/errors/performance)
- `POST /api/ai/generate-prompt` — generates implementation prompts: type=fix (from scan issue), type=upgrade (business-aware suggestions), type=custom (plain-language → technical prompt)

**Server.js changes**: imports `app-metadata-collector`, `setPool()`, `setCollector()` to ai routes, global `_appErrorBuffer` (wraps console.error, caps at 100 entries)

**Frontend** (4 sections in Tab 5):
- Section A: Scan Control — "Scan Application" button + timestamp
- Section B: Scan Results — 5 collapsible panels (Database, Routes, Errors, Health, Business) with "Generate Fix" buttons per issue
- Section C: AI Deep Analysis — focus area selector, SSE streaming output with copy-prompt buttons on code blocks, "Upgrade Suggestions" button
- Section D: Custom Prompt Builder — textarea for plain-language input → AI generates technical Claude Code prompt with "Copy" button

#### System Health & Error Prevention (Feb 23)

Comprehensive error tracking, system health monitoring, data integrity validation, and prevention recommendations.

**Tables**: `error_logs`, `system_health_checks`, `code_quality_metrics`
- `error_logs`: Categorized errors (database/api/frontend/validation/auth/integration) with severity, stack traces, request context, resolution tracking
- `system_health_checks`: Periodic check results (database, memory, disk, file_system, external_services) with status and details JSON
- `code_quality_metrics`: File-level complexity scores, LOC, issues

**Middleware**: `middleware/errorHandler.js` (upgraded)
- `globalErrorHandler` — Express error middleware, logs to DB, classifies errors, sanitizes for production
- `asyncWrapper` / `asyncHandler` — Promise-catching route wrapper
- `validateRequest(schema)` — Declarative request validation with field rules
- `logError(error, req, context)` — Log any error to `error_logs` table
- `logClientError` — Handler for frontend error reports
- Backward-compatible: exports both old names (`errorHandler`, `asyncHandler`) and new

**Services**:
- `services/system-health-service.js` — `performHealthCheck()` (5 checks: DB, memory, disk, filesystem, external services), `checkDatabaseIntegrity()`, `startAutoHealthChecks(intervalMs)` (default 5 min)
- `services/error-prevention-service.js` — `analyzeErrorPatterns()`, `validateDataIntegrity()` (orphan checks, consistency checks), `performCodeQualityCheck()` (routes/services/middleware scanning), `generatePreventionReport()`

**Routes**: `routes/system.js` (mounted at `/api/system`)
- `GET /health` — Full health check (auth required)
- `POST /health-check` — Trigger manual check (system.health permission)
- `GET /health/history` — Historical health checks
- `GET /errors` — Error logs with filtering (type, severity, status, search, pagination)
- `GET /errors/stats` — Error statistics (by type/severity, hourly trend, top endpoints, resolution rate)
- `POST /errors/:id/resolve` — Mark resolved with notes
- `POST /errors/:id/ignore` — Mark ignored
- `POST /errors/log-client` — Client-side error logging (auth only)
- `GET /prevention-report` — Full prevention report
- `POST /validate-integrity` — Run data integrity validation
- `GET /code-quality` — Code quality scan
- `GET /db-integrity` — Database integrity check

**Client-side**: `public/js/error-prevention.js` (auto-loaded by universal-nav-loader)
- Global `window.onerror` + `unhandledrejection` handlers → send to backend
- Fetch interceptor: logs 5xx API errors automatically
- Rate-limited: max 10 errors/minute to prevent flooding
- `window.showErrorToast(msg)` / `window.showSuccessToast(msg)` helpers
- `window.validateFormData(form, rules)` — client-side form validation with field highlighting

**Page**: `admin-system-health.html` (`data-page="system-health"`)
- **Navigation**: System sub-nav → "System Health" tab
- **Permission**: `system.health`
- 5 tabs: Error Logs (filterable table + summary), Error Stats (by type/severity/endpoints/resolution), Data Integrity (validation runner), Prevention (report with recommendations), Services (external service status)
- Overall status banner (healthy/warning/critical), 5 health status cards
- Error detail modal with stack trace, request body, resolution actions

**Server.js changes**: imports `system routes`, `errorHandler`, `systemHealthService`; global error handler replaced; `uncaughtException`/`unhandledRejection` handlers added; auto health checks on startup (5 min interval); graceful shutdown stops health checks

**Config**: `error_logging_enabled`, `health_check_interval_ms`, `error_alert_threshold_critical`, `error_alert_threshold_high`, `auto_health_check_enabled`

**Migration**: `migrations/migrate-error-prevention.js`

#### System Monitoring Dashboard (Mar 6)

Comprehensive system monitoring dashboard with real-time health metrics, error tracking, integration status, background jobs, and business metrics.

**Route**: `routes/monitoring.js` (mounted at `/api/monitoring`)
- `GET /overview` — Full system overview (system info, DB stats, PM2, errors, integrations, jobs, business metrics, top issues)
- `GET /errors` — Filtered error list (type, severity, pagination)
- `GET /performance` — API response times + health snapshots
- `GET /database/tables` — Table sizes and row counts
- `GET /usage` — Feature usage analytics (active users, top pages, API call stats)

**Dependencies**: `setPool`, `setAutomationRegistry`, `setResponseTracker`, `setProductionMonitor`

**Page**: `admin-monitoring.html` (`data-page="monitoring"`)
- **Navigation**: System sub-nav → "Monitor" tab
- Sections: System Health (4 cards: uptime, memory, CPU, disk), Integration Status (3 cards: Zoho, WhatsApp, FCM), Business Metrics (6 mini cards), Background Jobs + Performance (2-col), Recent Errors table, Quick Actions bar, DB Tables modal
- Auto-refresh every 30 seconds with toggle
- Color-coded status indicators (green/amber/red)
- Progress bars for memory/CPU usage
- Responsive grid layout

#### Bug Reports & Error Analysis System (Feb 23)

Extends the error prevention system with bug tracking, AI-powered fix suggestions, error deduplication, and trend analysis.

**New Tables**: `bug_reports`, `fix_suggestions`
- `bug_reports`: Bug tracking with title, description, steps_to_reproduce, expected/actual behavior, module, priority (critical/high/medium/low), status workflow (open→investigating→in_progress→fixed→closed|wont_fix), assignment, related_error_id, error_hash
- `fix_suggestions`: Fix suggestions linked to errors or bug reports, with suggestion_type (code_fix/config_change/data_fix/infrastructure/monitoring), confidence score, complexity, AI-generated flag, status (pending/approved/applied/rejected)

**Enhanced `error_logs` columns**: `frequency_count` (dedup counter), `error_hash` (SHA256 for dedup), `file_path`, `line_number`, `function_name` (parsed from stack trace), `branch_id`, `last_occurrence`

**Middleware enhancement**: `errorHandler.js`
- `setErrorAnalysisService(svc)` — Connects analysis service for stack trace parsing and deduplication
- `logError()` now: parses stack traces, computes error hash, deduplicates (increments frequency_count within 24h window instead of creating new rows), auto-escalates severity for frequent errors (20+→high, 50+→critical)

**Service**: `services/error-analysis-service.js`
- `parseStackTrace(stack)` — Extracts file_path, line_number, function_name from first non-node_modules frame
- `computeErrorHash(msg, type, url, filePath)` — Normalizes dynamic values (timestamps, IDs) before hashing
- `deduplicateError({error_hash})` — Checks existing in 24h window, increments or returns false
- `analyzeErrorTrends({days, module})` — Daily counts, frequent errors, by-module breakdown, new vs recurring, resolution metrics
- `analyzeByModule(moduleName)` — Module-specific error analysis with endpoint grouping
- `generateFixSuggestion(errorId)` — AI-powered fix suggestion generation via `ai-engine.generateWithFailover()`
- `generateBugFix(bugReportId)` — AI fix suggestions for bug reports
- `getErrorSummary()` — Quick summary for dashboard (errors 24h + bugs + fixes)
- `autoCreateBugFromError(errorId)` — Auto-creates bug report from chronic errors

**Routes** (added to `routes/system.js`):
- `GET /errors/analysis` — Error trend analysis (days, module params)
- `GET /errors/analysis/:module` — Module-specific analysis
- `GET /errors/summary` — Dashboard summary (errors + bugs + fixes)
- `POST /errors/:id/fix-suggestions` — Generate AI fix suggestions for error
- `POST /errors/:id/create-bug` — Auto-create bug from error
- `GET /bugs` — List bug reports (filter: status, priority, module, assigned_to, search, pagination)
- `GET /bugs/:id` — Bug detail with fix suggestions and related error
- `POST /bugs` — Create bug report
- `PUT /bugs/:id` — Update bug (status, assignment, resolution, fix_commit)
- `DELETE /bugs/:id` — Delete bug + its fix suggestions
- `POST /bugs/:id/fix-suggestions` — Generate AI fix for bug
- `GET /fix-suggestions` — List fix suggestions (filter: status, type, ai_only)
- `PUT /fix-suggestions/:id` — Update fix status (pending/approved/applied/rejected)

**Page**: `admin-bug-reports.html` (`data-page="bug-reports"`)
- **Navigation**: System sub-nav → "Bug Reports" tab
- **Permission**: `system.health`
- 3 tabs: Bug Reports (filterable table + slide-out detail), Fix Suggestions (list with confidence bars), Error Analysis (trend charts, module bars, frequent errors table)
- Summary cards: Total/Open/In Progress/Fixed/Critical/Errors 24h
- Create Bug modal, status update workflow, AI fix generation buttons
- Error Analysis: daily trend bars, by-module horizontal bars, new vs recurring cards, resolution metrics, frequent errors with "Create Bug" action

**Config**: `bug_tracking_enabled`, `auto_fix_suggestions`, `error_dedup_window_hours`, `fix_suggestion_confidence_threshold`

**Migration**: `migrations/migrate-bug-reports.js`

---

## 3. MOBILE APPS (Android)

### Architecture
- **Type**: Hybrid WebView app (Kotlin + WebView loading web app)
- **Build System**: Gradle 8.11.1, compileSdk 35, minSdk 24
- **Two Product Flavors**:
  - `staff` (com.qcpaintshop.staff) -> loads `/login.html`
  - `customer` (com.qcpaintshop.customer) -> loads `/customer-login.html`

### Features
- WebView with JavaScript enabled (DOM storage, file access)
- `QCApp` JavaScript interface: `getAppType()`, `getFCMToken()`, `isAndroidApp()`
- Firebase Cloud Messaging push notifications (`QCFirebaseMessagingService.kt`)
- Deep link support
- Tablet-optimized zoom (screen width >= 600dp)
- File upload support (camera + file picker)
- Network connectivity detection
- Splash screen
- Release signing (JKS keystore)

### Source Files
- `MainActivity.kt` - Main WebView activity (530 lines)
- `Constants.kt` - URLs and config from BuildConfig
- `QCWebViewClient.kt` - WebView client handling
- `QCWebChromeClient.kt` - Chrome client for file uploads
- `QCFirebaseMessagingService.kt` - FCM handler with deep linking
- `NetworkMonitor.kt` - Network connectivity detection

### Play Store Readiness
- **Release signing**: `qcpaintshop-release.jks` keystore configured
- **ProGuard/R8**: Code obfuscation + resource shrinking enabled
- **Network security**: HTTPS-only in production, cleartext disabled
- **In-App Updates**: Google Play In-App Updates library (v2.1.0)
- **Deep Linking**: App Links with `autoVerify="true"` for `act.qcpaintshop.com`
- **Privacy Policy**: `public/privacy-policy.html` (effective 2026-02-12)

### Play Store Assets (`google-services/` folder)

| Asset | File | Dimensions |
|-------|------|-----------|
| App Icon | `QCStaff-icon-512x512.png` | 512x512 |
| Feature Graphic | `QCStaff-feature-graphic-1024x500.png` | 1024x500 |
| Screenshot 1 - Login | `01-login.png` | 1080x1920 |
| Screenshot 2 - Dashboard | `02-dashboard.png` | 1080x1920 |
| Screenshot 3 - Attendance | `03-attendance.png` | 1080x1920 |
| Screenshot 4 - Tasks | `04-tasks.png` | 1080x1920 |
| Screenshot 5 - Salary | `05-salary.png` | 1080x1920 |
| Screenshot 6 - Chat | `06-chat.png` | 1080x1920 |
| Release AAB v3.2.0 | `QCStaff-v3.2.0-release.aab` | 2.8 MB |

---

## 4. TECHNICAL CAPABILITIES

### 4.1 API Integrations

| Service | Purpose | Protocol |
|---------|---------|----------|
| **Zoho Books** | Accounting (items, invoices, stock, customers) | REST + OAuth 2.0 |
| **Google Gemini** | AI image-to-image color visualization | REST (API key) |
| **Pollinations AI** | AI text-to-image visualization (fallback) | REST (free) |
| **NettyFish SMS** | OTP delivery (DLT-compliant) | HTTP GET |
| **SMTP** | Email (password reset, OTP, offer letters) | SMTP/TLS |
| **Firebase FCM** | Android push notifications | HTTPS (server key) |
| **Web Push** | Browser push notifications | VAPID |

### 4.2 Database Tables (~65+)

**Core**: `users`, `user_sessions`, `branches`, `customers`, `customer_types`, `settings`
**Products**: `products`, `brands`, `categories`, `pack_sizes`
**Estimates**: `estimates`, `estimate_items`, `estimate_status_history`, `estimate_requests`
**Attendance**: `staff_attendance`, `attendance_breaks`, `permission_requests`, `shop_hours_config`, `geofence_violations`, `user_branches`, `outside_work_periods`, `prayer_periods`, `attendance_photos`, `attendance_daily_reports`
**Salary**: `salary_config`, `monthly_salary`, `salary_payments`, `salary_advances`
**Tasks**: `staff_tasks`, `task_updates`, `daily_task_templates`, `daily_task_responses`, `daily_task_materials`
**Leads**: `leads`, `lead_followups`
**Activities**: `staff_activities`
**Auth**: `otp_verifications`, `roles`, `role_permissions`, `permissions`, `staff_registrations`
**Zoho**: `zoho_items`, `zoho_invoices`, `zoho_customers`, `zoho_payments`, `zoho_locations`, `zoho_stock`, `zoho_stock_history`, `zoho_sync_log`, `zoho_config`, `zoho_whatsapp_queue`, `reorder_config`, `reorder_alerts`, `purchase_suggestions`, `bulk_update_jobs`, `inventory_adjustments`
**Chat**: `chat_conversations`, `chat_participants`, `chat_messages`, `chat_read_receipts`
**Notifications**: `notifications`, `push_subscriptions`
**Share**: `share_tokens`
**Design**: `color_design_requests`, `design_visualizations`
**Website**: `website_services`, `website_features`, `website_testimonials`, `website_gallery`
**Stock Check**: `stock_check_assignments`, `stock_check_items`
**Collections**: `collection_reminders`, `payment_promises`
**AI**: `ai_conversations`, `ai_messages`, `ai_analysis_runs`, `ai_insights`, `ai_lead_scores`, `ai_config`

### 4.3 File Upload System

| Upload Type | Directory | Max Size | Formats |
|-------------|-----------|----------|---------|
| Business Logo | `uploads/logos/` | 2 MB | Images |
| Profile Picture | `uploads/profiles/` | 5 MB | Images |
| Aadhar Proof | `uploads/aadhar/` | 5 MB | Images, PDF |
| PAN Proof | `uploads/aadhar/` | 5 MB | Images, PDF |
| Design Requests | `uploads/design-requests/` | 10 MB | Images (compressed to 1200px) |
| Clock-In Photos | `uploads/attendance/clock-in/` | 5 MB | Images |
| Clock-Out Photos | `uploads/attendance/clock-out/` | 5 MB | Images |
| Break Photos | `uploads/attendance/break/` | 5 MB | Images |
| Daily Task Photos | `uploads/daily-tasks/` | 5 MB | Images |
| AI Visualizations | `uploads/visualizations/` | Generated | JPEG |
| Documents | `uploads/documents/` | - | Various |
| Website Content | `uploads/website/` | 10 MB | Images (compressed to 1200px) |
| Stock Check Photos | `uploads/stock-check/` | 10 MB | Images (compressed to 800px JPEG 80%) |

### 4.4 Real-time Features (Socket.io)

- **Authentication**: Session token validation middleware
- **User Rooms**: `user_{userId}` for personal notifications
- **Conversation Rooms**: `conversation_{id}` for chat
- **Events**:
  - `notification` - Push notification to user
  - `new_message` - Chat message delivery
  - `user_typing` / `typing` - Typing indicators
  - `message_read` / `mark_read` - Read receipts
  - `join_conversation` - Dynamic room joining

### 4.5 Background Services

| Service | File | Function |
|---------|------|----------|
| **Sync Scheduler** | `services/sync-scheduler.js` | Cron-based Zoho data sync |
| **WhatsApp Processor** | `services/whatsapp-processor.js` | Queue-based WhatsApp message sending (dual-mode: branch session + HTTP API) |
| **WhatsApp Session Manager** | `services/whatsapp-session-manager.js` | Per-branch whatsapp-web.js lifecycle, QR via Socket.io, auto-reconnect |
| **Zoho OAuth** | `services/zoho-oauth.js` | Token management and auto-refresh |
| **Zoho API** | `services/zoho-api.js` | API client with rate limiting |
| **Rate Limiter** | `services/zoho-rate-limiter.js` | Zoho API throttling |
| **Purchase Suggestions** | `services/purchase-suggestion.js` | Reorder calculation engine |
| **Notification Service** | `services/notification-service.js` | Multi-channel notification dispatch |
| **Email Service** | `services/email-service.js` | Shared branded email sending (SMTP/Nodemailer) |
| **AI Engine** | `services/ai-engine.js` | Triple LLM abstraction (Gemini + Claude + Clawdbot/Kai) with 3-provider failover chain and streaming |
| **AI Analyzer** | `services/ai-analyzer.js` | Zoho business data analysis (revenue, collections, overdue) |
| **AI Staff Analyzer** | `services/ai-staff-analyzer.js` | Staff performance analysis (attendance, breaks, OT) |
| **AI Lead Manager** | `services/ai-lead-manager.js` | Lead scoring (deterministic + AI) and stale lead detection |
| **AI Marketing** | `services/ai-marketing.js` | Marketing strategy and product trend analysis |
| **AI Scheduler** | `services/ai-scheduler.js` | Cron orchestrator for all automated AI analysis jobs |
| **Lead Reminder Scheduler** | `services/lead-reminder-scheduler.js` | Daily 8 AM IST reminders for due/overdue lead followups |

---

## 5. FRONTEND PAGES INVENTORY

### Public Pages (No Auth)
| Page | File | Purpose |
|------|------|---------|
| Landing | `index.html` | Professional corporate landing page (fully dynamic) |
| Login | `login.html` | Staff login |
| Register | `register.html` | User registration with OTP |
| Forgot Password | `forgot-password.html` | Password reset via email |
| Staff Register | `staff-register.html` | Staff self-registration |
| Request Estimate | `request-estimate.html` | Public estimate request form |
| Customer Login | `customer-login.html` | Customer OTP login |
| Privacy Policy | `privacy-policy.html` | Legal |
| Offline | `offline.html` | PWA offline page |
| Share: Estimate | `share/estimate.html` | Public shared estimate view |
| Share: Design | `share/design-request.html` | Public shared design request |
| Attendance Guide (Tamil) | `docs/attendance-guide-tamil.html` | Comprehensive Tamil attendance & salary guide |

### Staff Pages
| Page | File | Purpose |
|------|------|---------|
| Staff Dashboard | `staff/dashboard.html` | Personal dashboard |
| Clock In | `staff/clock-in.html` | Attendance clock-in with photo/GPS |
| Clock Out | `staff/clock-out.html` | Attendance clock-out with photo/GPS |
| Daily Tasks | `staff/daily-tasks.html` | Template-based daily tasks |
| My Tasks | `staff/tasks.html` | Assigned task management |
| Activities | `staff/activities.html` | Activity logging |
| Attendance History | `staff/history.html` | Personal attendance records |
| Permission Request | `staff/permission-request.html` | Leave/permission requests |
| Salary | `staff/salary.html` | Salary info & payslips |
| Advance Request | `staff/advance-request.html` | Salary advance requests |
| Staff Estimates | `staff-estimates.html` | Staff estimate management |
| Staff Requests | `staff-requests.html` | Staff-facing requests |
| Customer Requests | `customer-requests.html` | Design request handling |
| Guides & Help | `staff/guides.html` | Browse/search guides, favorites, reading view |
| Stock Check | `staff/stock-check.html` | Submit physical stock counts with photos |
| My Leads | `staff-leads.html` | Per-staff lead management, followups, pipeline view, WhatsApp/Call actions |

### Admin Pages
| Page | File | Purpose |
|------|------|---------|
| Admin Dashboard | `admin-dashboard.html` | Business overview |
| Live Monitor | `admin-live-dashboard.html` | Real-time monitoring (online staff, automations, activity feed) |
| Staff Management | `admin-staff.html` | User/staff CRUD |
| Branches | `admin-branches.html` | Branch management |
| Customers | `admin-customers.html` | Customer CRUD |
| Customer Types | `admin-customer-types.html` | Customer classification |
| Products | `admin-products.html` | Product catalog + Bulk Map (?tab=bulk-map) + Zoho Import (?tab=zoho-import) |
| Brands | `admin-brands.html` | Brand management |
| Categories | `admin-categories.html` | Category management |
| Roles | `admin-roles.html` | Role management |
| Role Permissions | `admin-role-permissions.html` | Permission assignment |
| Attendance | `admin-attendance.html` | Attendance reports |
| Geofence Logs | `admin-geofence-logs.html` | Geo-fence violations |
| Tasks | `admin-tasks.html` | Task assignment |
| Daily Tasks | `admin-daily-tasks.html` | Daily task templates |
| Leads | `admin-leads.html` | Lead pipeline + Staff Performance leaderboard (2 tabs) |
| Design Requests | `admin-design-requests.html` | AI visualization |
| Estimate Requests | `admin-estimate-requests.html` | Request management |
| Staff Registrations | `admin-staff-registrations.html` | Registration approvals |
| Salary Config | `admin-salary-config.html` | Salary setup |
| Monthly Salary | `admin-salary-monthly.html` | Salary calculation |
| Salary Payments | `admin-salary-payments.html` | Payment recording |
| Salary Advances | `admin-salary-advances.html` | Advance management |
| Salary Reports | `admin-salary-reports.html` | Payroll reports |
| Reports | `admin-reports.html` | Business reports |
| Settings | `admin-settings.html` | System settings |
| Website Management | `admin-website.html` | Public website content CRUD (hero, services, features, testimonials, gallery, social) |
| Profile | `admin-profile.html` | Admin profile |
| Guides | `admin-guides.html` | Guide CRUD, categories, analytics (Quill.js editor) |
| AI Dashboard | `admin-ai.html` | AI dashboard, chat, insights, suggestions, settings, app analyzer (6 tabs) |

### Zoho Pages
| Page | File | Purpose |
|------|------|---------|
| Zoho Dashboard | `admin-zoho-dashboard.html` | Financial overview with time-period filtering, trend chart, comparison, stat card drilldown |
| Zoho Settings | `admin-zoho-settings.html` | OAuth & config |
| Zoho Items | `admin-zoho-items.html` | Item catalog |
| Zoho Items Edit | `admin-zoho-items-edit.html` | Bulk item editing |
| Zoho Stock | `admin-zoho-stock.html` | Stock levels |
| Zoho Stock Adjust | `admin-zoho-stock-adjust.html` | Inventory adjustments |
| Zoho Stock Check | `admin-stock-check.html` | Daily stock verification assignments (Assign/Review/Dashboard/History) |
| Zoho Invoices | `admin-zoho-invoices.html` | Invoice viewer |
| Zoho Locations | `admin-zoho-locations.html` | Warehouse mapping |
| Zoho Transactions | `admin-zoho-transactions.html` | Daily transactions |
| Zoho Reports | `admin-zoho-reports.html` | Financial reports |
| Zoho Reorder | `admin-zoho-reorder.html` | Reorder alerts |
| Zoho Purchases | `admin-zoho-purchase-suggestions.html` | Purchase planning |
| Zoho Bulk Jobs | `admin-zoho-bulk-jobs.html` | Bulk operation status |
| Zoho Stock Migration | `admin-stock-migration.html` | Bulk warehouse→business stock transfer (temporary migration tool) |
| Zoho Collections | `admin-zoho-collections.html` | Outstanding invoice management with branch filter, payment reminders, promise tracking (5 tabs) |
| WhatsApp Sessions | `admin-whatsapp-sessions.html` | Per-branch WhatsApp connection management with QR codes |
| Staff Collections | `staff/collections.html` | Mobile-first collections for staff (3 tabs, auto-filtered to branch) |

### Estimate Pages
| Page | File | Purpose |
|------|------|---------|
| Estimates List | `estimates.html` | All estimates |
| Create Estimate | `estimate-create-new.html` | New estimate |
| Edit Estimate | `estimate-edit.html` | Edit estimate |
| View Estimate | `estimate-view.html` | Estimate detail |
| Estimate Actions | `estimate-actions.html` | Status management |
| Estimate Settings | `estimate-settings.html` | Default config |

### Customer Portal Pages
| Page | File | Purpose |
|------|------|---------|
| Customer Login | `customer-login.html` | OTP login |
| Customer Dashboard | `customer-dashboard.html` | Overview |
| Estimate View | `customer-estimate-view.html` | View received estimates |

### Shared Components
| Component | File | Purpose |
|-----------|------|---------|
| Header | `components/header-v2.html` | Top nav with notification bell |
| Sidebar | `components/sidebar-complete.html` | Full navigation sidebar |
| Staff Sidebar | `components/staff-sidebar.html` | Staff-only sidebar (permission-filtered, see §8 Feb 20 changelog) |
| Dashboard Actions | `components/dashboard-quick-actions.html` | Quick action buttons |
| Staff Actions | `components/staff-quick-actions.html` | Staff quick actions |
| Attendance Subnav | `components/attendance-subnav.html` | Attendance + admin HR section nav |
| Zoho Subnav | `components/zoho-subnav.html` | Zoho section nav |
| Leads Subnav | `components/leads-subnav.html` | Leads & CRM section nav |
| Branches Subnav | `components/branches-subnav.html` | Branches & Staff section nav |
| Salary Subnav | `components/salary-subnav.html` | Salary & Payroll section nav |
| Sales Subnav | `components/sales-subnav.html` | Sales & Estimates section nav |
| Products Subnav | `components/products-subnav.html` | Products & Inventory section nav (Products, Categories, Brands, Bulk Map, Zoho Import) |
| System Subnav | `components/system-subnav.html` | System (Reports, Settings, Profile, Website, Guides) section nav |

### JavaScript Files
| File | Purpose |
|------|---------|
| `css/zoho-common.css` | Shared toast notification + skeleton loading CSS for all Zoho pages |
| `js/auth-helper.js` | Auth token management, SW registration, `isAndroidApp()`, global `getAuthHeaders()`, `apiRequest()`, `apiFetch()` |
| `js/socket-helper.js` | Socket.io client helper |
| `estimates.js` | Estimate page logic |
| `universal-nav-loader.js` | Dynamic nav component loader |

---

## 6. API ENDPOINT SUMMARY

### Total API Endpoints: **200+**

| Module | Mount Path | Endpoints | Route File |
|--------|-----------|-----------|------------|
| Auth | `/api/auth/*` | 7 | `server.js` |
| OTP | `/api/otp/*` | 3 | `server.js` |
| Customer Auth | `/api/customer/auth/*` | 2 | `server.js` |
| Users/Staff | `/api/users/*` | 7 | `server.js` |
| Settings | `/api/settings/*` | 5 | `server.js` |
| Brands | `/api/brands` | 4 | `server.js` |
| Categories | `/api/categories` | 4 | `server.js` |
| Products | `/api/products` | 9 | `server.js` |
| Customers | `/api/customers` | 5 | `server.js` |
| Customer Types | `/api/customer-types` | 4 | `server.js` |
| Estimates | `/api/estimates` | 8 | `server.js` |
| Design Requests | `/api/design-requests` | 5 | `server.js` |
| Paint Colors | `/api/paint-colors/*` | 3 | `server.js` |
| AI Visualization | `/api/design-requests/:id/*` | 3 | `server.js` |
| AI Status | `/api/ai-status` | 1 | `server.js` |
| Dashboard | `/api/dashboard/*` | 1 | `server.js` |
| Public | `/api/public/*`, `/api/guest/*` | 6 | `server.js` |
| Attendance | `/api/attendance/*` | 18 | `routes/attendance.js` |
| Salary | `/api/salary/*` | 30 | `routes/salary.js` |
| Branches | `/api/branches/*` | 10 | `routes/branches.js` |
| Roles | `/api/roles/*` | 10 | `routes/roles.js` |
| Leads | `/api/leads/*` | 28 | `routes/leads.js` |
| Tasks | `/api/tasks/*` | 12 | `routes/tasks.js` |
| Daily Tasks | `/api/daily-tasks/*` | 15 | `routes/daily-tasks.js` |
| Activities | `/api/activities/*` | 9 | `routes/activities.js` |
| Est. Requests | `/api/estimate-requests/*` | 7 | `routes/estimate-requests.js` |
| Staff Reg | `/api/staff-registration/*` | 14 | `routes/staff-registration.js` |
| Zoho | `/api/zoho/*` | 60+ | `routes/zoho.js` |
| Chat | `/api/chat/*` | 6 | `routes/chat.js` |
| Notifications | `/api/notifications/*` | 6 | `routes/notifications.js` |
| Estimate PDF | `/api/estimates/:id/pdf` | 1 | `routes/estimate-pdf.js` |
| Share | `/api/share/*` | 4 | `routes/share.js` |
| Guides | `/api/guides/*` | 11 | `routes/guides.js` |
| Stock Check | `/api/stock-check/*` | 14 | `routes/stock-check.js` |
| Stock Migration | `/api/zoho/migration/*` | 4 | `routes/stock-migration.js` |
| Collections | `/api/zoho/collections/*` | 12 | `routes/collections.js` |
| WhatsApp Sessions | `/api/zoho/whatsapp-sessions/*` | 6 | `routes/whatsapp-sessions.js` |
| Uploads | `/api/upload/*` | 4 | `server.js` |
| Health | `/health`, `/api/test` | 2 | `server.js` |

---

## 7. DEPLOYMENT & CONFIGURATION

### Server Details
| Field | Value |
|-------|-------|
| **IP** | 178.104.249.206 |
| **OS** | Ubuntu Linux |
| **Web Server** | Nginx (reverse proxy) |
| **App Port** | 3001 |
| **PM2 Process** | `business-manager` |
| **App Path** | `/www/wwwroot/act.qcpaintshop.com/` |
| **Domain** | act.qcpaintshop.com (HTTPS) |
| **Git Remote** | github.com/sharjoon1/qcpaintshop-business-manager |

### Deployment Workflow
```bash
# Local: merge and push
git checkout master && git merge development && git push origin master

# Server: pull and restart
ssh hetzner
cd /www/wwwroot/act.qcpaintshop.com
git pull origin master
npm install  # if new dependencies
pm2 restart business-manager
```

### Environment Variables

**Database**
- `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`

**Server**
- `PORT` (default: 3000)
- `NODE_ENV` (production/development)
- `BASE_URL` (e.g., https://act.qcpaintshop.com)
- `CORS_ORIGIN` (comma-separated allowed origins)

**Email (SMTP)**
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`
- `MAIL_FROM`, `MAIL_FROM_NAME`

**SMS (NettyFish)**
- `SMS_USER`, `SMS_PASSWORD`, `SMS_SENDER_ID`

**AI Models**
- `GEMINI_API_KEY`, `GEMINI_MODEL` (default: gemini-2.0-flash-exp)

**Zoho Books**
- `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REDIRECT_URI`
- `ZOHO_ORGANIZATION_ID`

**Push Notifications**
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL`
- `FIREBASE_SERVER_KEY`

### Migration Scripts
Run migrations in order for fresh installations:
```bash
node scripts/migrate-roles.js
node scripts/migrate-tasks.js
node scripts/migrate-staff-registration.js
node scripts/migrate-bank-details.js
node scripts/migrate-salary-advances.js
node scripts/migrate-daily-tasks.js
node scripts/migrate-design-requests.js
node scripts/migrate-visualizations.js
node scripts/migrate-geofence-break-photos.js
node scripts/migrate-zoho-tables.js
node scripts/migrate-zoho-features.js
node scripts/migrate-items-expand.js
node scripts/migrate-purchase-suggestions.js
node scripts/migrate-chat-notifications-share.js
node scripts/migrate-staff-upgrade.js
node scripts/migrate-login-attendance-update.js  # Geo-fence toggle, multi-branch, distance columns, review_notes
```

### Utility Scripts
```bash
node scripts/generate-screenshots.js      # Generate 6 Play Store screenshots (1080x1920)
node scripts/generate-feature-graphic.js   # Generate Play Store feature graphic (1024x500)
```

### Play Store Release Commands (from qcpaintshop-android/)
```bash
# Build release AAB
./gradlew bundleStaffRelease
# Build release APK (for direct install)
./gradlew assembleStaffRelease

# Upload to Play Store (tracks: internal, alpha, beta, production)
node upload-to-play.js ../google-services/QCStaff-vX.X.X-release.aab internal
# Promote between tracks
node promote-release.js internal production
```

---

## 8. RECENT UPDATES & CHANGELOG

### 2026-04-14/15 - Reorder Intelligence (Branch-wise Sales → Auto Reorder → Daily Report)

Full spec + plan under `docs/superpowers/specs/` + `docs/superpowers/plans/`. Detailed memory at `memory/project_reorder_intelligence.md`.

**Data model** — 4 new tables via `migrations/migrate-reorder-intelligence.js`:
- `branch_item_sales` (per branch × item × date aggregates, additive upsert, unique key on triple)
- `brand_reorder_config` (per-brand lead + safety days, seeded `__default__` 7+5)
- `invoice_line_sync_cursor` (resumable sync state)
- `reorder_report_log` (daily report audit)
- Extended `zoho_reorder_config`: `source` ENUM('manual','auto'), `avg_daily_sales`, `computed_at`
- Added unique key `uq_item_loc` on `zoho_reorder_alerts`; extended `zoho_sync_log.sync_type` ENUM with `'reorder_compute'`

**Services** — 4 new in `services/`:
- `zoho-invoice-line-sync.js` — pulls invoice line items from Zoho, aggregates nightly. Cursor de-dups; marked AFTER successful upsert (no data-loss window). Configurable `backfillDays` (1-730).
- `reorder-compute-service.js` — 60-day velocity × brand lead+safety → reorder level. Hybrid: preloads manual rows as Set, skips them. Writes run-log to `zoho_sync_log` with try/finally for failed-run tracking.
- `reorder-report-service.js` — assembles alerts + suggested items (sales-velocity items without config yet). Attaches per-branch `avg_daily_sales` to each `other_branches` entry via velocity-map query. Delivery via WhatsApp + FCM + dashboard, idempotent via `reorder_report_log`.
- `reorder-report-pdf-generator.js` — A4 PDFKit, green/gold branding, severity-colored cards grouped by branch.

**Scheduler** (via `automation-registry`): `invoice-line-sync` 02:00, `reorder-compute` 02:30, `reorder-report` 07:00 IST daily.

**UI** — extended `public/admin-zoho-reorder.html` from 2 tabs → 5 tabs: Alerts, Configuration (enhanced with source badge + avg/day + computed columns + "Reset Selected → Auto"), Brand Config (new; dropdown sourced from `/brands/available`), Daily Report (new; Date/Branch/Min avg/day/Search/Sort filters, card layout on mobile), Sales Analysis (new; CSV export). Back-fill banner with configurable days input + concurrency guard + polling fallback (socket-helper not loaded on this page).

**Key endpoints**: `POST /api/zoho/reorder/backfill-sales` (body: `{days}`), `GET /sales-sync-status`, `POST /compute-now`, `CRUD /brands`, `GET /brands/available`, `POST /config/reset-to-auto`, `POST /run-report`, `GET /report`, `GET /report/pdf` (accepts `?token=` query param via shim — WebView-friendly), `GET /sales-analysis`. All under `requirePermission('zoho', 'reorder')`.

**Config keys** (`ai_config`): `reorder_sales_window_days` 60, `reorder_min_sales_for_auto` 1, `reorder_invoice_sync_time` 02:00, `reorder_compute_time` 02:30, `reorder_report_time` 07:00, `reorder_report_recipients` [] (JSON user IDs), `reorder_report_whatsapp_enabled` 0 (disabled by default), `reorder_report_fcm_enabled` 0, `reorder_report_pdf_enabled` 1.

**Delivery routing**: branch-wise (manager gets own branch alerts) + consolidated (admin+purchase). WhatsApp via `whatsapp-session-manager.sendMessage/sendMedia` (branchId=0 general session). FCM via `notification-service.send(userId, {ttlSeconds:86400})`.

**Tests**: 15 new passing Jest tests across 4 files (`brand-config`, `invoice-line-sync`, `reorder-compute`, `reorder-report`).

---

### 2026-04-14 - Zoho Items DPL Fixes

- **cf_dpl push to Zoho** was silently ignored. Fix: `services/zoho-api.js::updateItem` now auto-wraps any `cf_*` key into `custom_fields: [{api_name, value}]` before PUT. All callers unchanged.
- **% Adjust** on `admin-zoho-items-edit.html` now ceils to whole rupee (`Math.ceil(source * (1 + pct/100))`) — no paise.
- **New readonly columns** on the edit page: "DPL→Rate %" (live computed markup) and "DPL Updated" (date). Backend adds `zoho_items_map.dpl_updated_at` column stamped on bulk-edit + apply-price-list. Migration: `migrations/add-dpl-updated-at.js`.

---

### 2026-02-28 - Staff Lead Management System (Per-Staff Isolation)

**Staff Lead Page** — `public/staff-leads.html` (1,412 lines): Mobile-first lead management for individual staff:
- Stats cards (Total, New Today, Follow-ups Today, Overdue, Converted), filter tabs (All/Today/Overdue/New/Hot)
- Lead cards with priority color-coding, status badges, AI score, quick actions (Call/WhatsApp/View)
- Pipeline/Kanban toggle view (6 status columns: New → Contacted → Interested → Quoted → Negotiating → Won)
- Add/Edit lead modal, Lead detail slide-out with followup history + status change + AI recommendation
- Socket.io real-time `lead_assigned` notifications, 60s auto-refresh, debounced search

**Data Isolation** — Role-based auto-filtering in `routes/leads.js`:
- Staff: `WHERE assigned_to = userId` (own leads only)
- Manager: `WHERE branch_id = userBranchId` (branch leads)
- Admin: no filter (all leads)
- Ownership verification via `checkLeadOwnership()` on all `/my/:id/*` endpoints (403 if not owner)

**10 New API Endpoints** — Staff: `/my/stats`, `/my/today`, `/my/list`, `/my/create`, `/my/:id` (PUT), `/my/:id/status` (PATCH), `/my/:id/followup` (POST), `/my/:id/followups` (GET). Admin: `/performance/leaderboard`, `/performance/:userId`

**Staff Performance Leaderboard** — New "Staff Performance" tab in `admin-leads.html`:
- Ranked table: conversion rate, followup count, avg response time (hours), active/overdue lead counts
- Date range + branch filters, click-to-expand detail (status/source breakdown, monthly trend, recent followups)

**Assignment Notifications** — Enhanced `PATCH /:id/assign`:
- In-app notification via `notification-service.send()` + Socket.io real-time `lead_assigned` event
- Staff receives "New lead assigned: {name} ({lead_number})" with push notification

**Daily Followup Reminders** — `services/lead-reminder-scheduler.js`:
- Cron at 8 AM IST, sends notifications for today's followups and overdue followups per staff
- Uses `notification-service.send()` (in-app + push)

**Permissions** — `migrations/migrate-staff-leads-permissions.js`:
- `leads.own.view`, `leads.own.add`, `leads.own.edit` — auto-assigned to staff, manager, admin roles
- Existing `leads.view/edit/delete/convert` remain for admin-level access

**Navigation** — "My Leads" entry added to staff sidebar (My Work section), `data-page="my-leads"`

**Files**: `staff-leads.html` (new), `lead-reminder-scheduler.js` (new), `migrate-staff-leads-permissions.js` (new), `routes/leads.js` (+758 lines), `admin-leads.html` (+214 lines), `staff-sidebar.html` (+5 lines), `server.js` (+3 lines)

### 2026-02-26 - Server-Side Geo-Fence Enforcement
- **Problem**: Client-side geo-fence monitoring reset on page refresh/app close — staff could exploit by refreshing
- **Solution**: Server-side tracking + enforcement in `services/auto-clockout.js`
- 3 new columns on `staff_attendance`: `geo_warning_started_at`, `last_geo_check_at`, `last_geo_distance`
- `GET /geofence-check` now writes geo state to DB + returns `geo_warning_started_at` in response
- `checkGeoWarnings()` runs every 5 min — finds expired geo warnings (>5 min), verifies not on break/prayer/outside-work, auto-clocks out
- Client resumes countdown from server timestamp on page reload (no more refresh exploit)
- Registered as `auto-clockout-geo-enforce` automation
- **Migration**: `migrations/migrate-geo-enforcement.js`

### 2026-02-25 - BMAD Sprint 3: Production Monitoring & Self-Healing

**Production Monitor** — `services/production-monitor.js`: Real-time health monitoring with self-healing:
- Monitors: memory (heap %, RSS), event loop lag, DB pool stats, API response times, Socket.io connections
- Self-healing: `healMemoryPressure()` (clears caches, forces GC), `healDbPool()` (tests new connection), `healStaleSessions()` (removes expired sessions >72h)
- Circuit breaker for Zoho API: `canCallApi()`, `recordApiFailure()`, `recordApiSuccess()` — closed→open (5 failures)→half-open (5min)→closed (success)
- Alert dispatch: WhatsApp + in-app notifications for critical anomalies, 1hr throttle per alert type
- Health snapshots persisted to `production_health_snapshots` table every 5 minutes
- Safety caps: max 10 healing actions/hour to prevent runaway recovery loops

**Response Time Tracker** — `middleware/responseTracker.js`: Ring buffer (1000 entries) API response tracking:
- Hooks `res.end` for `/api/` routes, tracks duration via `process.hrtime.bigint()`
- Metrics: p50, p95, p99, avg, RPM, errorRate, statusBreakdown (2xx/3xx/4xx/5xx), slowest endpoints (>3s)

**Production Metrics API** — 3 endpoints in `routes/system.js`:
- `GET /api/system/production-metrics` — real-time health (memory, event loop, DB, response times, circuit breaker)
- `GET /api/system/production-metrics/history` — historical snapshots (max 7 days, query params: hours, limit)
- `GET /api/system/circuit-breaker` — Zoho API circuit breaker state

**Anomaly Alert Integration** — `services/anomaly-detector.js`: Added `setAlertCallback()` — critical/high anomalies trigger WhatsApp alerts to admins + in-app notifications via production monitor

**Migration** — `migrations/migrate-production-monitor.js`: `production_health_snapshots` table (15 metric columns, 3 indexes), 5 `ai_config` entries

**Tests** — 58 unit tests (all passing) across 6 suites: +20 new tests (production-monitor: 11, responseTracker: 9)

### 2026-02-25 - BMAD Sprint 2: Anomaly Detection & Automated Testing

**Anomaly Detection System** — Z-score based statistical anomaly detection across 5 business domains:
- `services/anomaly-detector.js` — Core detection engine: revenue (daily vs 30-day avg), attendance (unusual clock-in times, missing clock-outs), stock (large quantity changes), collections (overdue invoices), API errors (error rate spikes, repeated errors)
- `routes/anomalies.js` — API: `GET /dashboard`, `GET /` (filtered list), `GET /:id`, `PUT /:id/status`, `POST /scan`, `GET/PUT /config`. Permission: `system.health`
- `public/admin-anomalies.html` — Dashboard page (data-page=`anomalies`): 4 summary cards, Chart.js trend/category charts, filter pills, severity-bordered anomaly list, detail slide-out with status workflow
- `migrations/migrate-anomaly-detection.js` — `detected_anomalies` table (7 indexes), 10 `ai_config` entries
- Scheduled scan every 6 hours, deduplication (24h window), auto-resolve (30 days)

**Automated Testing** — Jest framework, 38 unit tests (all passing):
- Tests: anomaly-detector (17), validate (12), rateLimiter (3), config (6)
- npm scripts: `npm test`, `npm run test:watch`, `npm run test:coverage`

### 2026-02-25 - BMAD Sprint 1: Technical Foundation
Implemented foundational infrastructure improvements as part of the BMAD (Breakthrough Method for Agile AI-Driven Development) initiative:

1. **API Rate Limiting** — `middleware/rateLimiter.js`: Three-tier rate limiting using `express-rate-limit`. Global (100 req/min per IP on `/api`), Auth (10 req/min on login/forgot-password), OTP (5 req/min per phone number). Wired into `server.js` on auth and OTP endpoints.

2. **LRU Cache Fix** — `routes/zoho.js`: Replaced unbounded `_apiCache` plain object (memory leak risk) with `lru-cache` (max 500 entries, 5-min TTL auto-eviction). `getCached()`, `setCache()`, `clearCache()` API preserved.

3. **Server.js Modular Extraction** — Extracted database config to `config/database.js` and upload configs to `config/uploads.js`. Removes ~100 lines of boilerplate from server.js (3,499 → 3,400 lines). `multer` and `mysql2` imports removed from server.js.

4. **Zod Validation Middleware** — `middleware/validate.js`: `validate(schema)`, `validateQuery(schema)`, `validateParams(schema)` middleware. Common schemas: `paginationSchema`, `idParamSchema`, `dateRangeSchema`, `branchFilterSchema`. Returns structured `VALIDATION_ERROR` responses.

5. **Migration Runner** — `migrate.js`: Database migration tracking with `_migrations` table. Commands: `node migrate.js` (run pending), `--status` (show state), `--mark-existing` (mark all applied). npm scripts: `npm run migrate`, `npm run migrate:status`.

6. **BMAD Planning Docs** — `bmad/` directory: PRD (`bmad/PRD.md`), user stories (`bmad/user-stories.md`), architecture (`bmad/architecture.md`), sprint tracker (`bmad/README.md`).

### 2026-02-24 - Credit Limit System Enhancement (4 Features)
1. **F1: Transaction Page Badges** — Collections Customers tab and Invoices page now show credit utilization badges (green/amber/red/exceeded). Backend: JOINs `zcm.credit_limit` + computed `credit_utilization` in `routes/collections.js` and `routes/zoho.js`. Frontend: `creditBadge()` helper on both pages.
2. **F2: Zoho Sync on Limit Changes** — `updateContact()` added to `services/zoho-api.js`. Setting/bulk-setting limits auto-syncs to Zoho Books (best-effort). Response includes `zoho_synced` flag.
3. **F3: Invoice Restriction** — `checkCreditBeforeInvoice(pool, zohoContactId, amount)` exported from `routes/credit-limits.js`. Blocks invoicing if no limit set or exceeded. Integrated before painter push-to-Zoho. Logs violations to `credit_limit_violations`.
4. **F4: Request Workflow** — `credit_limit_requests` table (migration: `migrate-credit-limit-requests.js`). 4 endpoints: POST/GET requests, PUT approve/reject. Approve auto-sets limit + Zoho sync + notification. Socket events: `credit_limit_request_new/resolved`. Frontend: Requests button with badge, request/approve/reject modals in `admin-credit-limits.html`.

### 2026-02-24 - Customer Credit Limits → Zoho Customers Migration
Migrated credit limit management from local `customers` table to **`zoho_customers_map`** (Zoho-synced customers):
- **Database**: Added `credit_limit`, `credit_limit_updated_at`, `credit_limit_updated_by` to `zoho_customers_map`; added `zoho_customer_map_id` to `customer_credit_history` and `credit_limit_violations`
- **Backend**: `routes/credit-limits.js` — fully rewritten, all queries use `zoho_customers_map`. Uses `zoho_outstanding` as credit_used. Imports `zoho-api.js` for sync. `/recalculate` replaced by `/sync` (calls `zohoAPI.syncCustomers()`)
- **Frontend**: `admin-credit-limits.html` — rebuilt with 6 overview cards, branch filter, "Sync from Zoho" button, GST/email columns, enhanced details modal (Zoho contact ID, unused credits, last synced), CSV export with GST/email
- **Migration**: `migrations/migrate-credit-limits-zoho.js` (ALTERs `zoho_customers_map`, adds `zoho_customer_map_id` to history/violations, migrates existing data)
- **Route ordering**: Named routes before `/:customerId` params maintained

### 2026-02-24 - AI Dashboard Upgrade (Phase 1)
Rebuilt `admin-ai.html` Tab 1 from Chat into a visual AI Dashboard with:
- New `GET /api/ai/dashboard` endpoint (10s cache, 14 parallel SQL queries)
- 6 KPI cards: Today Revenue, Month Revenue, Collections, Overdue, Staff, Stock Alerts
- Chart.js (CDN v4.4.7) with Revenue Trend (30-day line) and Branch Comparison (horizontal bar)
- Branch Performance scorecard table with revenue change %, collection rate %
- Insights panel (top 10 unread, severity-coded)
- Quick AI Query bar → switches to Chat tab
- Chat moved to Tab 2, App Analyzer to Tab 6
- Auto-refresh every 60 seconds
- Files: `routes/ai.js` (new endpoint), `public/admin-ai.html` (rebuilt Tab 1)

### 2026-02-24 - Live Admin Dashboard (Phase 1)
Real-time monitoring dashboard for admin/managers with 4 panels:
- **Status Bar**: Green/amber/red system health based on automation failures
- **Metrics Row**: Staff present, online, pending/overdue tasks, today's estimates, pending stock checks, new leads (10s auto-refresh)
- **Staff Monitor**: Online users with role badges via Socket.io (real-time connect/disconnect events)
- **Automation Panel**: 18 registered cron jobs across 6 services with status (idle/running/healthy/failed), run counts, last duration
- **Activity Feed**: Last 50 events today (clock-ins, stock submissions, task completions, estimates, leads)
- **Files**: `services/automation-registry.js` (in-memory Map), `routes/admin-dashboard.js` (`GET /api/admin/dashboard/live`), `public/admin-live-dashboard.html`
- **Server.js**: `onlineUsers` Map tracks connected sockets, `live_dashboard_admin` room for instant updates
- **Scheduler integration**: All 6 scheduler services (sync, ai, painter, auto-clockout, attendance-report, whatsapp-processor) register jobs and report status
- **Sidebar**: "Live Monitor" link in Dashboard section (admin/manager only)

### 2026-02-23 - App Analysis Bug Fixes (6 Critical + 2 Warning)
Based on AI App Analyzer report, fixed critical production errors:
- **`ai-analyzer.js`**: Fixed `payment_amount` → `amount` column name (4 occurrences) — zoho_payments table uses `amount`
- **`ai-staff-analyzer.js`**: Fixed `u.name` → `u.full_name` (8 occurrences) — users table uses `full_name`
- **`ai-context-builder.js`**: Fixed `whatsapp_campaigns` → `wa_campaigns` table name; fixed `total_recipients` → `total_leads` column alias
- **`routes/attendance.js`** + **`services/auto-clockout.js`**: Fixed `notificationService.sendNotification()` → `notificationService.send()` (4 calls), also fixed `message` param → `body` to match actual API signature
- **`services/whatsapp-session-manager.js`**: Added `sanitizePhone()` helper — strips non-numeric chars except leading +, applied at all 3 insert points (incoming msg, outbound record, session connect)
- **Migration**: `migrations/fix-app-analysis-issues-v2.js` — widens phone columns VARCHAR(50)→VARCHAR(100), adds 15 FK indexes, adds 6 `updated_at` columns
- Previous v1 migration (`fix-app-analysis-issues.js`) already handled: user role enum (added manager/accountant), 10 FK indexes, 13 updated_at columns

### 2026-02-24 - Clawdbot as Sole AI Provider
- Gemini disabled (`gemini_enabled=false`) — quota exhausted (429 errors)
- Claude API disabled (`claude_enabled=false`) — budget resets Mar 1
- Clawdbot set as sole active provider (`clawdbot_enabled=true`, `primary_provider=clawdbot`, `fallback_provider=clawdbot`)
- New `isProviderEnabled()` helper in `ai-engine.js` — checks `*_enabled` flags in `ai_config`
- `generateWithFailover()` and `streamWithFailover()` now filter disabled providers before failover loop
- Default fallbacks in `getConfig()` changed from gemini/claude to clawdbot
- **Fully reversible**: `UPDATE ai_config SET config_value = 'true' WHERE config_key = 'gemini_enabled'` re-enables any provider
- Migration: `migrations/migrate-clawdbot-primary.js`

### 2026-02-23 - Clawdbot (Kai) AI Provider Integration
- Third AI provider added: Clawdbot via Gateway Bridge Pattern (WebSocket on ws://127.0.0.1:18789)
- Gateway bridge script `scripts/clawdbot-call.mjs` bypasses Linux ARG_MAX limits
- 3-provider failover chain: primary → fallback → remaining (deduplicated)
- Simulated SSE streaming (100-char chunks) since Clawdbot returns full response
- Nginx `/api/ai/` location block: `proxy_read_timeout 300s`, `proxy_buffering off`
- Timeout chain: agent 280s → gateway 290s → execFile 300s → Nginx 300s
- Full guide: `docs/clawdbot-integration-guide.md` (v2.0)

### 2026-02-23 - AI App Analyzer (Tab 5)
- New `services/app-metadata-collector.js` with 5 scanners (database schema, route map, errors, health, business stats) + `runFullScan()` orchestrator with 5-min cache
- 3 new endpoints in `routes/ai.js`: `GET /app-scan`, `POST /app-analyze` (SSE), `POST /generate-prompt`
- Tab 1 "Dashboard" in `admin-ai.html`: KPI cards, Chart.js revenue trend + branch comparison, branch scorecards, insights panel, quick AI query bar
- Tab 6 "App Analyzer" in `admin-ai.html`: scan control, collapsible results panels, AI deep analysis with streaming, custom prompt builder
- Global error buffer in `server.js` (wraps `console.error`, caps at 100 entries) for error collection
- "Generate Fix" buttons on detected issues, "Upgrade Suggestions" for business-aware improvements, "Copy" buttons on all code blocks

### 2026-02-23 - AI Assistant Manager Upgrade
- Upgraded AI Chat to full "QC Assistant Manager" with dedicated persona and comprehensive business context
- New `services/ai-context-builder.js`: Two-tier context system (Tier 1 quick summary always injected, Tier 2 deep context keyword-triggered with 8 categories)
- New `CHAT_SYSTEM_PROMPT` in ai-engine.js: data-first, comparative, proactive, confident Assistant Manager personality
- New tables: `ai_business_context` (daily snapshots), `ai_suggestions` (AI improvement recommendations)
- Daily snapshot crons (6 AM, 12 PM, 6 PM IST) for cached business context
- New endpoints: suggestions CRUD (list/update/summary), context refresh
- Chat-specific config: `chat_max_tokens` (8192), `chat_temperature` (0.5), `daily_snapshot_enabled`
- UI: 12 categorized quick prompts, new Suggestions tab with category/status filters, improved welcome text
- Migration: `migrations/migrate-ai-assistant-upgrade.js`

### 2026-02-23 - AI Business Intelligence System (initial)
- Full AI-powered business automation with dual provider (Gemini + Claude) and automatic failover
- 6 new services: ai-engine, ai-analyzer, ai-staff-analyzer, ai-lead-manager, ai-marketing, ai-scheduler
- Interactive AI chat with SSE streaming, conversation history, business context auto-injection
- Automated analysis: Zoho daily (9 PM), staff daily (10:30 PM), lead scoring (6h), marketing (weekly Mon 9 AM)
- Structured insights extraction with category, severity, actions — stored in ai_insights table
- Lead scoring: deterministic formula (0-100) + AI enhancement for top leads
- WhatsApp delivery of analysis summaries to configurable recipients via General WhatsApp
- Admin dashboard: 3-tab UI (Chat, Insights, Settings) with real-time Socket.io updates
- 6 new tables: ai_conversations, ai_messages, ai_analysis_runs, ai_insights, ai_lead_scores, ai_config
- 15+ API endpoints including SSE streaming chat
- Migration: `migrations/migrate-ai-tables.js`
- Routes: `routes/ai.js`, Page: `admin-ai.html`, Permission: `system.ai`
- Navigation: System sub-nav → AI tab, SUBNAV_MAP entry added

### 2026-02-20 - Outstanding Invoice Collections System
- Centralized tool to manage outstanding invoices, send WhatsApp payment reminders, and track collection efforts
- 5-tab admin page: Summary (KPI dashboard), Customers (grouped outstanding), Invoices (filterable with bulk select), Reminders (timeline), Promises (tracking)
- WhatsApp reminders: individual & bulk send, dual-write to `whatsapp_followups` + `collection_reminders`
- Non-WhatsApp reminder logging: call, visit, email with notes
- Promise-to-pay tracking: create/edit/mark as kept/broken/partial, auto-detect broken (past due + pending)
- CSV export of outstanding invoices
- 2 new tables: `collection_reminders`, `payment_promises`; Migration: `migrate-collections.js`
- Route: `routes/collections.js` (10 endpoints), permission: `zoho.collections`
- Page: `admin-zoho-collections.html`, Zoho subnav tab: "Collections"
- Customer search with debounced typeahead for log and promise modals

### 2026-02-20 - Branch WhatsApp Sessions & Branch-Filtered Collections
- Per-branch WhatsApp connections via `whatsapp-web.js` — each branch scans QR to connect their own number
- Admin WhatsApp setup page: branch cards with QR display, connect/disconnect, test message, real-time Socket.io updates
- Dual-mode sending in `whatsapp-processor.js`: branch session → HTTP API fallback (zero breaking changes)
- Branch-filtered collections: admin branch dropdown, staff auto-filtered by `req.user.branch_id`
- Customer-branch assignment: admin assigns customers to branches (dropdown in Customers tab, bulk assign API)
- Staff collections page: mobile-first (3 tabs), auto-filtered to branch, bottom-sheet modals
- New table: `whatsapp_sessions`; new columns: `branch_id` on 4 tables
- New service: `services/whatsapp-session-manager.js` (LocalAuth, auto-reconnect, Socket.io QR/status)
- New route: `routes/whatsapp-sessions.js` (6 endpoints), permission: `zoho.whatsapp_sessions`
- Modified: `routes/collections.js` (+2 endpoints, branch filtering on all 10 existing), `admin-zoho-collections.html`, `whatsapp-processor.js`, `server.js`, `zoho-subnav.html`, `staff-sidebar.html`, `.gitignore`
- New pages: `admin-whatsapp-sessions.html`, `staff/collections.html`
- Migration: `migrate-whatsapp-sessions.js`

### 2026-02-20 - Warehouse Location Filtering (Post-Migration)
- All Zoho queries now filter by `is_active = 1` to exclude disabled warehouse locations
- **API**: `GET /api/zoho/locations` returns only active locations by default (`?include_inactive=1` for management page)
- **Server queries filtered**: stock dashboard, stock/:itemId, stock history, daily transactions, reorder configs, reorder alerts, alert summary
- **Functions filtered**: `getLocationStockDashboard()`, `checkReorderAlerts()`, `getReorderDashboard()` in zoho-api.js
- **Locations page**: `admin-zoho-locations.html` passes `?include_inactive=1` to show all locations for management
- Pattern: `AND (lm.is_active = 1 OR lm.is_active IS NULL)` — LEFT JOIN safe, allows items without location mapping

### 2026-02-20 - Bulk Stock Migration Tool
- One-time migration tool to transfer all stock from Warehouse → Business locations
- Uses paired inventory adjustments (+qty at business, -qty at warehouse) via Zoho Books API
- Transfer Orders not used due to OAuth scope limitation (Books only, not Inventory)
- Key learning: `location_id` must be in each line item, not just root level
- Route: `routes/stock-migration.js` (6 endpoints), permission: `zoho.manage`
- Page: `admin-stock-migration.html`, Zoho subnav tab: "Stock Migration"
- No migration needed — reads existing `zoho_location_stock` + `zoho_locations_map` tables

### 2026-02-20 - Stock Check Assignment System
- Admin assigns Zoho products to branch staff for daily physical stock verification
- Staff submits counts with optional photo proof (camera capture, sharp-compressed)
- Admin reviews discrepancies in slide-in panel with comparison table
- Push inventory adjustments to Zoho Books via `createInventoryAdjustment()` API
- Auto-suggest items not checked in 30+ days
- Dashboard with per-branch stats, history with filters and pagination
- Notifications: assigned → staff, submitted → admins
- Per-assignment Zoho location selection (Business vs Warehouse) for accurate stock adjustments
- Tables: `stock_check_assignments` (with `zoho_location_id`), `stock_check_items`; Migration: `migrate-stock-check.js`
- Pages: `admin-stock-check.html` (4 tabs), `staff/stock-check.html` (mobile-first)
- Route: `routes/stock-check.js` (11 endpoints), permission: `zoho.stock_check`

### v2.0.0 (2026-02-09) - Major Platform Rebuild
- Complete server rebuild with all modules integrated
- Express.js 5.x upgrade
- CORS security hardening (no wildcard)
- Permission middleware across all endpoints

### 2026-02-10 - Zoho Books Integration
- Full OAuth 2.0 connection flow
- Items, invoices, customers, payments sync
- Stock management with location tracking
- Reorder alerts and purchase suggestions
- WhatsApp payment reminders

### 2026-02-12 - Chat, Notifications & Share
- Real-time chat (Socket.io) with direct and group conversations
- In-app + push notification system (Web Push + FCM)
- Share links with WhatsApp integration
- Estimate PDF generation
- 7 new database tables

### 2026-02-13 - Customer Portal & Android Apps
- Customer OTP login (SMS via NettyFish)
- Customer dashboard and estimate viewer
- Android app (Kotlin WebView, 2 flavors)
- Firebase Cloud Messaging integration

### 2026-02-14 - Production Deployment & Fixes
- Server deployment to production
- DLT SMS template compliance (single verified template)
- SMTP hostname fix for SSL certificate matching
- Customer OTP rewritten to use database (was in-memory Map)
- Foreign key constraint fix (customer sessions)
- ENUM purpose column fix for otp_verifications

### 2026-02-15 - Branch Management Fixes
- Added missing `state`, `pincode`, `email`, `gst_number` columns to branches table
- Fixed `day_of_week` ENUM mismatch in shop_hours_config (integers -> day names)
- Branch creation with auto-generated shop hours now working

### 2026-02-15 - Staff Upgrade: PAN/KYC, Email Service & Notifications
- PAN card number + proof upload added to users & staff_registrations
- KYC status tracking (incomplete/complete/verified) with auto-computation
- KYC status badge on profile page and admin staff list
- Shared email service extracted (`services/email-service.js`)
- Notifications added across all modules: tasks, attendance permissions, salary, advances, registrations, profile updates
- Staff dashboard: personalized greeting + profile avatar
- Admin attendance: break start/end photo display
- Admin staff list: profile avatars + KYC status column
- Play Store assets generated: 6 screenshots, feature graphic, 512x512 icon
- Release AAB v3.2.0 built for Play Store submission

### v3.3.7 (2026-03-08) - Geofence Background Location Service
- **Native Android GeofenceLocationService**: `ForegroundService` with `FOREGROUND_SERVICE_TYPE_LOCATION`, monitors GPS every 30s via `LocationManager`, independent of WebView
- **Server endpoints**: `POST /api/attendance/location-report` (receives GPS, checks 300m geofence, sends FCM alerts, 5min grace→auto-clockout), `POST /api/attendance/location-off` (GPS-off detection, sets `location_off_at`)
- **Server geofence cron**: Every 60s checks `location_off_at` > 2min and `geo_warning_started_at` > 5min → auto-clockout with FCM push
- **FCM geofence channel**: `qc_geofence_alerts` with `IMPORTANCE_HIGH`, alarm sound, bypass DND, vibration pattern
- **JS bridge**: `QCApp.startGeofenceService(authToken)` on clock-in, `QCApp.stopGeofenceService()` on clock-out
- **Permission flow**: `ACCESS_BACKGROUND_LOCATION` requested on app launch with rationale dialog (Android Q+)
- **Migration**: `migrate-location-off.js` adds `location_off_at DATETIME NULL` to `staff_attendance`
- **Staff dark green theme**: All 26+ staff pages rebranded to `#1B5E3B`/`#154D31`
- **Incentive slab system**: Amount-based tiers with FCM notifications on all status changes
- **Version**: versionCode 15, Android AAB built, Play Store publish pending Background Location declaration

### Android App v3.2.2 (2026-02-15) - Play Store Submission
- **Two flavors**: QC Staff (`com.qcpaintshop.staff`) + QC Customer (`com.qcpaintshop.customer`)
- compileSdk 35, targetSdk 35, minSdk 24
- Firebase Cloud Messaging for push notifications
- In-App Updates (Google Play Core)
- Deep linking with App Links verification
- Release signing with JKS keystore
- ProGuard/R8 minification enabled
- Privacy policy at `/privacy-policy.html`
- Play Store assets ready in `google-services/` folder
- **Google Play Developer API** integrated for automated uploads
  - Service account: `qualitycolours1@gmail.com` (Play Console)
  - Firebase: `sharjoon1@gmail.com` (separate, linked as editor)
  - Upload script: `qcpaintshop-android/upload-to-play.js`
  - Promote script: `qcpaintshop-android/promote-release.js`
  - Service account key: `google-services/play-api-key.json`
- Store listing: `google-services/store-listing.txt` (descriptions, release notes, category)
- **v3.2.2 (versionCode 7)** submitted to Play Store production — in review

### v3.3.0 (2026-02-16) - Attendance Fixes & Web Push
- **Break photo ENUM fix**: Added `break_start`/`break_end` to `attendance_photos.photo_type` ENUM (was causing break photo insert failure with "Data truncated")
- **Approve/Reject SQL fix**: Reverted `approved_by`/`approved_at` back to `reviewed_by`/`reviewed_at` (matches actual DB schema)
- **Web Push subscription**: Auth-helper now auto-subscribes to Web Push on login (non-Android browsers)
- **VAPID key endpoint**: `GET /api/notifications/push/vapid-key` returns public key for browser push subscription
- **VAPID keys**: Generated and deployed to production `.env`
- **Service Worker**: Push + notificationclick handlers for displaying browser notifications with deep-link routing
- **FCM data-only messages**: Changed FCM payload to data-only (ensures `onMessageReceived()` always fires on Android)
- **Android notification sound**: Added sound URI + AudioAttributes on notification channel
- **Distance tracking**: Clock-in/out distance always computed and stored (regardless of geo-fence setting)
- **Admin photo viewer**: Direct endpoint `GET /api/attendance/record/:id` for reliable photo loading
- **Break double-submit prevention**: `breakSubmitting` flag + button disable during submission
- Android app v3.3.0 (versionCode 8) built and uploaded to Play Store internal track
- Migration: `scripts/migrate-fix-break-enum.js` (ENUM fix + VAPID key generation)
- Migration: `scripts/migrate-login-attendance-update.js` (distance columns + review_notes)
- **Auto clock-out scheduler** (`services/auto-clockout.js`): OT check + geo enforce every 5 min, 10 PM force clock-out. `checkGeoWarnings()` finds staff with `geo_warning_started_at` > 5 min, verifies no break/prayer/outside-work, auto-clocks out. 3 automations registered.
- **Admin forced clock-out**: `POST /api/attendance/admin/force-clockout` + "Clock Out" button in Live Today table for staff still clocked in
- Notifies staff on forced clock-out
- **Break photo preview fix**: Moved `breakPreview` img out of camera container into separate `breakPhotoPreview` div (matches clock-in pattern)
- **Geo-fence auto clock-out**: `POST /api/attendance/geo-auto-clockout` — when staff moves 300m+ from branch, auto clocks out, ends active break, notifies. Frontend trigger in `startGeoFenceMonitoring()` with `geoAutoClockoutTriggered` flag to prevent duplicates
- **Re-clock-in request system**: Staff can request to clock in again after clock-out (for overtime). `POST /api/attendance/permission/request-reclockin` creates `re_clockin` permission. Admin approves → sets `allow_reclockin = 1` on attendance record → staff can create new attendance record. `/api/attendance/today` returns `reclockin_status` for UI state management
- Migration: `scripts/migrate-reclockin.js` (adds `allow_reclockin` column to `staff_attendance`)
- **IST Timezone**: All attendance date calculations use IST (UTC+5:30) via `getTodayIST()` and `getNowIST()` helpers in `routes/attendance.js` and `services/auto-clockout.js`. Calendar day runs 12:00 AM to 11:59:59 PM IST.
- **Dynamic login logo**: `public/login.html` loads company logo from `/api/public/site-info` (set via admin panel)
- **Staff salary navigation**: Salary tab added to bottom nav on all staff pages (dashboard, history, permission-request). Backend salary routes (`/api/salary/my-config`, `/my-monthly`, `/my-payments`) use `requireAuth` only — no role restriction.

### 2026-02-17 - Attendance Improvements & Guide Management System
- **6 Attendance Improvements**: Permission request dropdown fix, absent staff list, outside work periods, break geofence exemption, 5-min grace period auto-clockout, staff timeline tab
- **Break Time Enforcement**: Configurable break allowance (default 120min), warning at 90min, excess tracked, admin notifications, color-coded badges in Live Today
- **Tamil Attendance Guide**: Comprehensive 1446-line Tamil document covering all attendance features with salary calculation examples
- **Guide Management System**: Full CRUD platform for documentation
  - Admin: Quill.js rich text editor, categories, analytics (views, reads, popular guides)
  - Staff: Category browsing, search, favorites, reading view with iframe for full HTML guides
  - 5 database tables, 11 API endpoints, 6 default categories seeded
  - Existing Tamil guide auto-imported into system
  - Navigation: System subnav + staff sidebar integration
- Migration: `migrations/migrate-attendance-improvements.js`, `migrations/migrate-break-enforcement.js`, `migrations/migrate-guides-system.js`

### 2026-02-18 - Zoho Dashboard Enhancements & Module Cleanup
- **Zoho Dashboard Time-Based Filtering**: Period pills, comparison arrows, Chart.js trend chart, CSV export
- **Zoho Dashboard Stat Card Drilldown**: Click KPI cards for transaction details, live invoice/payment preview, search/sort/export
- **Zoho Module Cleanup** (all 13 pages):
  - Created shared `css/zoho-common.css` (toast + skeleton CSS)
  - Removed duplicate `getAuthHeaders()` from 10 pages (now uses global from `auth-helper.js`)
  - Removed duplicate `apiFetch()` from 3 pages (locations/settings use `zohoFetch()` wrapper, purchase-suggestions uses global `apiFetch()`)
  - Fixed dashboard double `/api/zoho/status` API call (merged into `loadConnectionStatus()`)
  - Fixed reports page auth bug (template-literal sending empty `Authorization: ""` header)
  - Converted 2 Pattern-B toast pages (locations, settings) to standard single-element toast
  - Removed inline toast CSS from 9 pages, skeleton CSS from 7 pages
  - Fixed HTML structure: removed `data-page` from invoices `<html>` tag, added `bg-gray-50` to bulk-jobs `<body>`

### 2026-02-20 - Zoho Stock Check, Collections, WhatsApp Sessions, Stock Migration
- **Stock Check Assignment System**: Admin assigns products to staff for daily physical stock verification with photo proof
- **Bulk Stock Migration Tool**: One-time warehouse → business location stock transfer with paired inventory adjustments
- **Warehouse Location Filtering**: All Zoho queries filter by `is_active = 1` to exclude disabled warehouses
- **Collections & Payment Tracking**: Outstanding invoice management, WhatsApp reminders, promise-to-pay, branch filtering
- **Per-Branch WhatsApp Sessions**: Each branch connects own WhatsApp number via whatsapp-web.js + QR scan
- Migrations: `migrate-stock-check.js`, `migrate-collections.js`, `migrate-whatsapp-sessions.js`

### 2026-02-20 - WhatsApp Marketing Campaign System
- **WA Campaign Engine**: Background singleton for automated bulk WhatsApp messaging to leads
  - Anti-block: spin text `[Hi|Hello]`, variable substitution `{name}/{company}`, invisible markers (zero-width chars)
  - Rate limiting: hourly/daily caps via `wa_sending_stats`, warm-up mode (20→50→100→150→200/day)
  - Auto-pause on 3+ consecutive failures, random delays (30-90s default)
  - Recovery: resumes `running` campaigns on server restart
  - Socket.io events: `wa_campaign_progress/paused/completed/started` → `wa_marketing_admin` room
- **Campaign Management**: Full CRUD, 5-step creation wizard (info → message → audience → anti-block → review)
  - Audience builder: query leads by status/source/priority/city/date/branch, Fisher-Yates shuffle
  - Template picker with variable toolbar, spin text helpers, live message preview
  - Campaign lifecycle: draft → populate → start/schedule → running → pause/resume → completed/cancelled
- **Message Templates**: Category-based (greeting/promotion/followup/announcement/festival/custom), usage tracking
- **Dashboard**: 4 stat cards, campaign performance bar chart, hourly sending volume line chart, engine status indicator
- **Settings**: Configurable delays, rate limits, warm-up schedule, invisible markers toggle, engine poll interval
- **Media Support**: `sendMedia()` added to session manager — images with captions, documents
- **5 Tables**: `wa_campaigns`, `wa_campaign_leads`, `wa_message_templates`, `wa_sending_stats`, `wa_marketing_settings`
- **Instant Send Feature** (separate from campaigns — for quick ad-hoc messaging):
  - "Instant Send" tab with full lead browser (search, status, source, branch filters), checkboxes, select all/clear
  - Instant message composer modal: WhatsApp session picker, template selector, variable/spin text toolbar, media upload, live preview
  - Real-time progress modal via Socket.io: per-lead sent/failed status, progress bar, summary stats
  - Anti-block: 5-15s random delays, spin text, variable substitution, invisible markers
  - Recent history section with batch grouping, status badges, pagination
  - Background async processing: `processInstantBatch()` sends one by one with delays, emits `wa_instant_progress`/`wa_instant_complete`
  - New table: `wa_instant_messages` (batch_id, lead_id, message_template, message_content, status, media, timestamps)
  - New endpoints: `POST /instant-send`, `GET /instant-history`, `GET /whatsapp-sessions`
  - Migration: `migrations/migrate-wa-instant-messages.js`
- **27 API Endpoints**: `/api/wa-marketing/*` — campaigns CRUD, templates, dashboard, leads preview, settings, media upload, instant send, history, sessions
- **2 Permissions**: `marketing.view`, `marketing.manage` (auto-assigned to admin role)
- **Navigation**: Marketing sidebar section, `marketing-subnav.html`, `marketing-` prefix detection in nav loader
- **6 Tables**: `wa_campaigns`, `wa_campaign_leads`, `wa_message_templates`, `wa_sending_stats`, `wa_marketing_settings`, `wa_instant_messages`
- Migrations: `migrate-wa-marketing.js`, `migrate-wa-instant-messages.js`
- Files: `services/wa-campaign-engine.js`, `routes/wa-marketing.js`, `public/admin-wa-marketing.html`, `public/components/marketing-subnav.html`

### 2026-02-20 - Stock Check Bug Fixes
- **Staff dropdown customer leak**: `/api/branches/:id/staff` returned ALL active users (including `role='customer'`); fixed with `AND u.role != 'customer'`
- **Assign endpoint role validation**: `POST /api/stock-check/assign` now validates staff_id has non-customer role before creating assignment
- **UTC date bug**: `my-assignments` used `toISOString().split('T')[0]` (UTC date); on CET server, midnight→1AM returns previous day; fixed to use local date getters
- **DATE→string CET drift**: `toISOString()` on mysql2 DATE objects (local midnight) converts to previous day in UTC; fixed to use `getFullYear()/getMonth()/getDate()`

### 2026-02-25 - Staff Sidebar Redesign & Permission Fixes
- **Complete staff sidebar rewrite** (`staff-sidebar.html`): Redesigned to match admin sidebar's premium light design (white bg, SVG stroke icons, Inter font, icon-rail collapse on desktop, hover-to-preview, click-to-pin)
- **Permission filtering**: Only Credit Limits uses `data-requires="credit_limits.view"` — core staff items (attendance, estimates, stock, collections, salary) always visible
- **Fresh permissions**: `filterSidebarByPermissions()` now always fetches from `/api/auth/permissions` API (no stale 1-hour cache)
- **Desktop icon rail**: 60px collapsed / 256px expanded, localStorage key `staffSidebarCollapsed` (separate from admin's `sidebarCollapsed`)

### 2026-02-25 - Staff Navigation Unification (Bottom-Nav Removal)
- **Removed hardcoded bottom-nav** from 6 staff pages: `dashboard.html`, `history.html`, `permission-request.html`, `daily-tasks.html`, `salary.html`, `advance-request.html`
- Removed `.bottom-nav` CSS, `.nav-item` CSS, bottom-nav HTML blocks, and `padding-bottom: 80px` from body on all 6 pages
- **Added mobile quick-access bar** (`.qc-mobile-quickbar`) to `staff-sidebar.html` — visible on mobile only (<768px), hidden on desktop
- Quick bar has 5 items: Dashboard, Attendance (clock-in), Stock Check, Collections, Menu (opens sidebar)
- Active page highlighting via `data-qb-page` attribute + `highlightQuickbar()` function
- `body { padding-bottom: 64px !important; }` on mobile to prevent content overlap with quick bar
- **Result**: Consistent navigation across all 12 staff pages — sidebar on desktop, quick-bar + sidebar on mobile

### 2026-02-25 - Comprehensive Site Analysis & Bug Fixes
**Production Bug Fixes (7 total):**
- **LiveDashboard activity feed**: `p.name` → `p.full_name` in `routes/admin-dashboard.js` (painters table uses `full_name`)
- **LiveDashboard UNION collation**: Added `COLLATE utf8mb4_unicode_ci` to all string columns in the 6-table UNION ALL query (mixed table collations caused "Illegal mix of collations" error every 10s)
- **Socket duplicate load**: `socket-helper.js` wrapped in `window._qcSocketHelperLoaded` idempotent guard, `let` → `var` (prevented `Identifier 'qcSocket' has already been declared` error, freq: 21)
- **SQL injection risk**: Replaced `pool.escape()` with parameterized query in `routes/credit-limits.js` (pending count query)
- **Undefined function**: `apiRequest()` → `apiFetch()` in `admin-zoho-collections.html` (loadBranches function was broken)
- **AI staff_daily failure**: `otr.requested_minutes` → `otr.expected_minutes` in `services/ai-staff-analyzer.js` (overtime_requests column name mismatch)
- **AI zoho_daily failure**: `item_name` → `zoho_item_name` in `services/ai-analyzer.js` and `services/ai-marketing.js` (zoho_items_map column name)

**Database Optimizations:**
- **Collation standardization**: Converted all 52 `utf8mb4_general_ci` tables to `utf8mb4_unicode_ci` (migration: `fix-collation-standardize.js`). Database default also set. Eliminates all future UNION/JOIN collation errors.
- **Missing indexes added** (migration: `fix-missing-indexes.js`): `staff_tasks.created_at`, `ai_messages.created_at`, `stock_check_assignments.submitted_at`, `painter_estimates.created_at`

**AI System Audit Results:**
- Clawdbot gateway running (port 18789), Sonnet 4.5 model active
- Lead scoring: fully operational (runs every 6 hours, all completing successfully)
- Staff daily analysis: NOW FIXED (was failing due to column name error)
- Zoho daily analysis: NOW FIXED (was failing due to column name error)
- Daily snapshots generating at 6PM IST
- 42 AI config entries properly configured

### 2026-02-25 - WhatsApp Attendance Report Fix
- **Root cause**: `whatsapp-web.js` npm package was not installed on production server — the session manager gracefully degrades (try/catch on require) so no crash, but all message sends silently fail
- **Fix**: Installed `chromium` (headless browser dependency), `whatsapp-web.js`, and `qrcode` packages on production server
- **Added to package.json**: `"whatsapp-web.js": "^1.26.1"` and `"qrcode": "^1.5.4"` as explicit dependencies
- **Verified**: WhatsApp General session (branch 0) authenticates and connects on server restart, phone: 916385574463
- **Cron**: `[AttendanceReport] 10:05 PM IST cron scheduled` — confirmed active after restart
- **History**: All `attendance_daily_reports` entries had `delivery_status = 'failed'` prior to fix

### 2026-02-20 - Permission-Based Staff Sidebar Filtering (superseded by Feb 25 redesign)
- Original implementation — see 2026-02-25 entry for current state

### 2026-02-21 - Stock Check Enhancements
- **Collation fix**: Added `COLLATE utf8mb4_unicode_ci` to `zoho_locations_map` JOINs in assignments list and review queries
- **Sort order**: Staff `my-assignments` now sorts recent-first (DESC)
- **Staff submission history**: New `GET /my-submissions` endpoint + History tab on staff page (past submitted/reviewed/adjusted, pagination, detail view)
- **Staff self-request**: New `POST /self-request` endpoint + New Request tab — staff search products, enter counts + photos + reason, submit directly (`request_type='self_requested'`, `status='submitted'`). Admin sees "Self-Requested" badge in Review tab.
- **Product search with last-checked**: New `GET /products/search` endpoint returns products from `zoho_location_stock` with `MAX(submitted_at)` as `last_checked`. Color-coded badges: green (recent), amber (old), red (never checked). Used in admin Assign tab and staff New Request tab.
- **Admin dashboard suggestion widget**: "Items Needing Check" section with branch selector, products not verified in 30+ days via `/products/suggest`
- **Request type badges**: Admin Review and History tables show "Self" / "Assigned" type column; review panel shows self-requested reason
- **Staff page tabs**: 3 tabs — Assignments | History | New Request
- Migration: `migrate-stock-check-enhancements.js` (adds `request_type ENUM('admin_assigned','self_requested')` + `requested_reason TEXT` to `stock_check_assignments`)

### 2026-02-21 - Assignable Role Filtering
- **Assignment dropdowns now show only assignable roles** (staff, sales_staff, branch_manager)
  - Backend: `/api/users?assignable=1` query param filters to assignable roles + active status
  - Backend: `/api/branches/:id/staff` tightened from `role != 'customer'` to `role IN ('staff', 'sales_staff', 'branch_manager')`
  - Backend: Server-side validation in `POST /api/stock-check/assign` and `POST /api/tasks` + `/bulk-assign` rejects non-assignable roles
  - Frontend: `admin-stock-check.html`, `admin-tasks.html`, `admin-daily-tasks.html`, `admin-leads.html` updated to use `?assignable=1`
  - Roles excluded from assignment: admin, customer, guest, dealer, contractor, accountant

### 2026-02-21 - Admin Page Access Control
- **All 45 admin pages now redirect non-admin users to staff dashboard**
  - Added `requireAdminOrRedirect()` to `auth-helper.js` — checks role is `admin`, `manager`, or `super_admin`; redirects staff/others to `/staff/dashboard.html`
  - Replaced `checkAuthOrRedirect()` with `requireAdminOrRedirect()` on all 45 admin pages
  - Exception: `admin-profile.html` kept with `checkAuthOrRedirect()` (staff use it for "My Profile")
  - `zoho-subnav.html` now hides entire subnav for non-admin users (early return if not admin/manager)
  - Defense in depth: server-side `requirePermission()` middleware was already blocking API calls; this adds client-side page-level redirect
  - Previously: staff could navigate directly to any admin page URL and see the full admin UI (API calls would fail with 403, but the page/subnav still rendered)

### 2026-02-21 - Advanced Stock Filters & Sort
- **Shared filter system** across 3 stock management pages: `admin-zoho-stock.html`, `admin-zoho-stock-adjust.html`, `admin-stock-check.html`
- Reusable `StockFilterManager` class (`public/js/stock-filters.js`) + shared styles (`public/css/stock-filters.css`)
- **Filters**: Brand (multi-select), Category (multi-select), Stock Status (in_stock/low_stock/out_of_stock), Last Checked (stock-check only: never/7d/30d)
- **Sort options added**: Brand (A-Z/Z-A), Category (A-Z/Z-A) on all 3 pages
- **Filter UI**: Collapsible panel with toggle button + badge count, searchable multi-select dropdowns, removable chips
- **Architecture**: Server-side filtering (stock + stock-adjust pages via API params), client-side filtering (stock-check page via JS predicate)
- **New endpoint**: `GET /api/zoho/stock/filter-options` — returns distinct brands + categories from `zoho_items_map`
- **Modified endpoints**: `GET /api/zoho/stock` (via `getLocationStockDashboard()`), `GET /api/zoho/stock/by-location`, `GET /api/stock-check/products/inventory`
- Brand/Category displayed as subtle gray text under item name in all table rows + mobile cards
- No migration needed — uses existing `zoho_brand` and `zoho_category_name` columns in `zoho_items_map`

### 2026-02-22 - General WhatsApp (Company-wide Session)
- **General WhatsApp session**: Company-wide session using `branch_id = 0` sentinel value
- **Fallback logic**: `sendMessage()`/`sendMedia()` automatically fall back to General session when a branch is disconnected — all callers benefit without code changes
- **Admin Sessions page**: Dedicated "General WhatsApp" card with green company-wide badge above branch cards
- **Admin Chat page**: "General WhatsApp" filter option, account badges (green=General, gray=branch), "via" label in chat header
- **Schema changes**: FK constraints dropped on `whatsapp_sessions`, `whatsapp_messages`, `whatsapp_contacts` to allow `branch_id = 0`
- **Session restore**: `initializeSessions()` uses `LEFT JOIN` to restore General session on server restart
- Migration: `migrations/migrate-general-whatsapp.js`
- Modified: `services/whatsapp-session-manager.js`, `routes/whatsapp-sessions.js`, `routes/whatsapp-chat.js`, `admin-whatsapp-sessions.html`, `admin-whatsapp-chat.html`

### 2026-02-22 - WhatsApp Chat History (Admin Panel)
- **Incoming message capture**: `client.on('message')` in session manager stores all incoming WhatsApp messages (text, images, video, audio, documents, stickers, location, contacts)
- **Delivery receipts**: `client.on('message_ack')` updates message status (sent → delivered → read) in real-time
- **Outbound message recording**: `sendMessage()` and `sendMedia()` now record all outbound messages into `whatsapp_messages` with source tracking (admin_reply, campaign, instant, followup, system)
- **Chat UI**: Full WhatsApp-style admin chat page (`admin-whatsapp-chat.html`) with conversation list + message area
  - Branch filter, search, conversation list with avatars, unread badges, pinned contacts
  - WhatsApp-style message bubbles (green=outgoing, white=incoming), date separators
  - Status indicators: ✓ sent, ✓✓ delivered, ✓✓ (blue) read, ✕ failed
  - Media support: inline images (click lightbox), video/audio players, document download links
  - Reply bar with text input + file attachment (multer upload) + send button
  - Contact management: pin, mute, edit saved name
  - Infinite scroll up for older messages (cursor pagination)
  - Mobile responsive: single-panel mode with back button
- **Real-time updates**: Socket.io room `whatsapp_chat_admin` for incoming messages, outbound confirmations, delivery receipts
- **Media storage**: Incoming media saved to `uploads/whatsapp/`, served at `/uploads/whatsapp/`
- **2 Tables**: `whatsapp_messages` (BIGINT PK, branch_id, phone, direction, type, body, media, status, source), `whatsapp_contacts` (denormalized for fast conversation list: unread_count, is_pinned, is_muted, last_message_at)
- **8 API Endpoints**: `GET /conversations`, `GET /conversations/:phone/messages`, `POST /conversations/:phone/send`, `POST /conversations/:phone/send-media`, `PUT /conversations/:phone/read`, `PUT /contacts/:phone`, `GET /search`, `GET /stats`
- **Permission**: `zoho.whatsapp_chat` (auto-assigned to admin role)
- **Backfill**: Migration backfills historical outbound messages from `wa_instant_messages`, `wa_campaign_leads`, `whatsapp_followups`
- **Backward compatible**: Existing `sendMessage()`/`sendMedia()` callers unaffected (metadata param is optional, return value still truthy on success)
- Routes: `routes/whatsapp-chat.js`, Migration: `migrations/migrate-whatsapp-chat.js`
- Navigation: Added "WA Chat" entry to `zoho-subnav.html`

### Feb 22, 2026 — General WhatsApp: Collections & Marketing Integration
- **Fixed**: JS truthiness bug in `whatsapp-processor.js` (`!0 === true`) that prevented `branch_id = 0` from routing through the message queue
- **Marketing**: "General WhatsApp (Company)" option in campaign branch dropdown and instant send; campaign queries show proper label
- **Collections**: "Send via" dropdown in reminder modal (Auto / General WhatsApp); `session_type` param on POST /remind
- **Migration**: `migrate-general-wa-integration.js` drops FK constraints on `wa_campaigns` and `wa_campaign_leads`

### Feb 24, 2026 — Stock Check Partial Submission UI
- **Added**: `POST /save-progress/:id` — saves partial progress (sets `item_status='checked'`), returns `{saved, total, checked, remaining, progress_pct}`
- **Added**: `GET /progress/:id` — returns progress stats + list of already-checked items with `item_status` for resume
- **Enhanced**: `staff/stock-check.html` — animated progress bar, filter tabs (All/Unchecked/Checked/Diff), "Save Progress (N new)" button, resume banner, dirty item tracking
- **Total stock-check endpoints**: 15 → 17

### Feb 24, 2026 — Fresh Stock Comparison on Admin Review/Push
- **Problem**: `system_qty` is captured at assignment creation; with partial submissions over multiple days, stock changes (sales/purchases) make the original snapshot stale
- **Solution**: Admin review and push endpoints now JOIN `zoho_location_stock` for live `stock_on_hand` at review/push time
- **Backend** (`routes/stock-check.js`):
  - `GET /review/:id`: LEFT JOINs `zoho_location_stock`, returns `current_system_qty`, `live_difference`, `live_variance_pct` per item; summary stats use live values
  - `POST /adjust/:id`: Fetches all submitted items with live stock JOIN, splits by live difference, builds Zoho payload with fresh values. After push, updates `stock_check_items.system_qty`/`difference`/`variance_pct` with actual values used (audit trail)
- **Admin UI** (`admin-stock-check.html`):
  - Review table: "Orig Sys" column (gray, creation snapshot) + "Current" column (bold, live stock)
  - Rows where stock changed since assignment highlighted with amber background + warning icon
  - Diff/Var% columns use live calculations

### Feb 24, 2026 — Stock Check Batch (Partial) Submission
- **Major feature**: Staff can submit checked items in batches — admin reviews & pushes each batch to Zoho while staff continues checking remaining items
- **Flow**: check some → submit batch → admin pushes → check more → submit → push → repeat until done
- **Migration**: `migrate-stock-check-partial.js` — adds `item_status ENUM('pending','checked','submitted','adjusted')` to `stock_check_items` + index + backfill
- **Backend changes** (`routes/stock-check.js`):
  - `save-progress`: sets `item_status='checked'`, skips submitted/adjusted items
  - `submit`: partial batch support — only submits items with `item_status IN ('pending','checked')`, keeps assignment pending if items remain
  - `adjust`: only pushes `item_status='submitted'` items to Zoho, marks all submitted→adjusted, stores comma-separated adjustment IDs for multiple pushes, auto-completes assignment when all items adjusted
  - `assignments`: `?include_partial=1` includes pending assignments with submitted items in review list; adds `submitted_count` subquery
  - `review`: summary includes `submittedCount`, `adjustedCount`, `pushableCount`
  - `progress`: returns `submitted_count`, `adjusted_count`, and `item_status` per item
  - `self-request`: sets `item_status='submitted'` on created items
- **Staff UI** (`staff/stock-check.html`):
  - "Submit X Checked Items" button (replaces "Submit Final Check") — visible when checked-but-unsubmitted items exist
  - Submitted items: blue badge + disabled inputs; Adjusted items: purple badge + disabled inputs
  - Progress bar: fills based on (submitted + adjusted) / total
  - Filter tabs: All | Unchecked | Checked | Submitted | Diff
  - Resume: locks submitted/adjusted items on reload
- **Admin UI** (`admin-stock-check.html`):
  - Review tab: shows partial submissions with "Partial" badge, submitted/total column
  - Review panel: 6 stat cards (Total/Submitted/Adjusted/Match/Discrepancy/Pending), filter toggle (Submitted/Adjusted vs All Items), item_status badge per row
  - Push button: "Push X Discrepancies to Zoho" (only submitted items); refreshes panel after push instead of closing
  - Waiting state: shows "Waiting for staff to submit more items" when no submitted items left

### Mar 11, 2026 — Bulk Zoho Product Import + Stock Check Warehouse Fix + Product Images + Emulsion Base Cleanup
- **Bulk product import**: `scripts/import-all-zoho-products.js` — imports all 1848 active Zoho items as 995 grouped products with pack_sizes. Smart grouping by extracted product name + brand (strips SKU codes, extracts sizes). Primer/emulsion products (378) → `area_wise`, others (617) → `unit_wise`. ML→L and GM→KG conversion. All items mapped to local products.
- **Stock check warehouse fix**: Updated `branches.zoho_location_id` from inactive warehouse locations to active branch locations. Updated 8 pending assignments (#79-86) and 7817 item `system_qty` values. Added auto-resolve fallback in `POST /api/stock-check/adjust/:id` — if assignment location is inactive, resolves to active location for same branch via `zoho_locations_map`.
- **Product image matching**: `scripts/match-product-images.js` — keyword-based matching of 97 local product images to DB products (59 matched). Compresses with Sharp (800x800 JPEG 85%). Updates `products.image_url` and `zoho_items_map.image_url`. Added `image_url VARCHAR(500)` column to `products` table.
- **Brand CDN image download**: `scripts/download-product-images.js` — downloads real product images from brand CDNs: Birla Opus (144/154, `assets.birlaopus.com`), Berger Paints (103/133, `images.bergerpaints.com`), Astral Paints (19/19, `admin.astralpaints.com`). Total 266 products got real brand images. Smart name-matching with category fallbacks (CST enamels→sparkle gloss, colorants→style color fresh, etc.). Sharp 800x800 JPEG 85% compression.
- **Brand placeholder images**: `scripts/generate-brand-placeholders.js` — generates SVG→JPEG branded placeholders for remaining products without real images. Brand-specific colors (Asian Paints red, Berger blue, Birla Opus dark, etc.).
- **Emulsion base cleanup**: `scripts/cleanup-emulsion-bases.js` — deactivated 123 extra color base products from 36 emulsion groups. Parses base codes (PB1/PB2/PB5/PBWT/CS/EW/NS/TL etc.), groups by core name + brand, keeps only first base (WT=0 priority, then lowest number). Renamed 179 products to remove base code prefix. Active products: 995→872, area_wise: 378→255.

### Mar 9, 2026 — Collections Enhancements + Product Grouping + Painter Points & Notifications
- **Staff collections**: Gradient header with summary strip, sort pills for Customers/Invoices tabs, History tab with Calls/Promises sub-tabs
- **Product import grouping**: SKU code stripping in `extractProductInfoJS()`, manual merge UI with checkboxes
- **Painter points auto-award**: Points awarded at confirm-payment (dedup via `EST-{id}`), push-to-zoho skips re-award
- **Points history UI**: Painter bottom sheet with transactions + inline withdraw. Admin detail modal with All/Regular/Annual filters.
- **Painter notifications**: Push notifications for withdrawal approval/rejection, 6 estimate status changes, points earned. Android FCM token registration for painter auth.
- **One-time script**: `scripts/award-pending-points.js` awarded points for existing paid estimates

### Mar 3, 2026 — Grouped Product Rates in Painter Admin Tab 3
- **Replaced**: Tab 3 "Rates & Slabs" now shows products grouped by `products` table (matching painter catalog view) instead of 1822 individual Zoho items. Shows variant count, price range, and aggregate rates per product.
- **Added**: Expand/collapse per product — lazy-loads individual variants with per-variant rate overrides. "Mixed" badge when variants have differing rates.
- **Added**: Unmapped items section — collapsible list of items in `painter_product_point_rates` not linked to any active product, with link to Zoho Import page.
- **Added**: 3 new endpoints: `GET /config/product-rates/grouped` (products + unmapped + filters + summary), `GET /config/product-rates/grouped/:productId` (variants), `PUT /config/product-rates/grouped` (fans out product-level rates to all variants, respects per-variant overrides).
- **Save behavior**: Product-level save fans out to all variants via INSERT ON DUPLICATE KEY UPDATE. Per-variant overrides (when expanded and changed) saved independently. Unmapped items saved separately.
- **No DB schema changes** — grouping is purely UI + backend fan-out. `painter_product_point_rates` table stays per-item. Legacy endpoints preserved.

### Mar 3, 2026 — Painter Catalog: Points Breakdown & Hide Stock Count
- **Changed**: Stock display in `painter-catalog.html` — removed numeric counts and "Low Stock" state from all 3 locations (card badge, detail panel, variant rows). Only shows "In Stock" (green) / "Out of Stock" (red).
- **Added**: "Your Earnings" section in product detail panel — 2-column breakdown per variant: Customer Billing (Regular pts + Annual pts) vs Self Billing (0 + Annual pts). Shows annual % of MRP. Variants without rates show "Points not configured".
- **Changed**: Points badges simplified — card badge shows "earns pts" instead of specific number, variant rows show "★ earns pts". Full breakdown available in detail panel.
- **No backend changes** — all data (`points_per_unit`, `annual_eligible`, `annual_pct`) already returned by `GET /me/catalog/:productId`.

### Mar 2, 2026 — Product Import Pipeline & Estimate Product Management
- **Added**: Zoho → Estimate Product import flow: select items → smart grouping (`extractProductInfo()`) → Import Review modal → create products + pack_sizes. SKU code stripping (`/^[A-Z]{2,6}\d{1,4}\s+/i`) ensures items with different SKU prefixes group correctly. Manual merge UI (checkboxes + "Merge Selected") as fallback.
- **Added**: Import Review modal with editable product names, unit_wise/area_wise toggle per group
- **Added**: Force re-import for already-mapped items (amber warning, deletes old pack_size mappings)
- **Added**: Bulk Map tab (`?tab=bulk-map`) — map unmapped pack sizes to Zoho items in bulk
- **Added**: "Bulk Map" 5th tab in `products-subnav.html`
- **Added**: Image column on Products tab (thumbnail from `pack_sizes → zoho_items_map.image_url` subquery)
- **Added**: Product image upload on Zoho Import tab (clickable thumbnail / "+" placeholder)
- **Added**: `POST /api/products/import-from-zoho` — accepts `{ groups, force }` format with explicit group names
- **Added**: `GET /api/products/unmapped-pack-sizes`, `POST /api/products/bulk-map` endpoints
- **Added**: `POST /api/products/:itemId/image` endpoint for admin image upload
- **Fixed**: Green tick persisting after product deletion — `mapped-zoho-ids` now JOINs with products to check `status = 'active'`
- **Fixed**: Product delete now also deactivates pack_sizes (`is_active = 0`)
- **Fixed**: Race condition in Zoho Import tab — `loadZohoMappedIds().then(() => loadZohoItems())` instead of parallel
- **Fixed**: Zoho search dropdown in variant editor — replaced position:fixed dropdown (clipped by modal overflow) with inline results rendered in document flow using event delegation
- **Fixed**: Orphaned pack_sizes cleanup (5 rows with active pack_sizes on inactive products)

### Mar 3, 2026 — Card v6, Estimate Discount Workflow, Professional Estimate View
- **Card v6**: Bigger logo (250px visiting, 180px ID) with white semi-transparent circle backdrop for visibility. Text shadow on painter name, wider gold underline, bigger phone pill (460px), letter-spacing improvements on all text. ID card header text repositioned for larger logo, referral box gold border.
- **Share Loading Spinner**: Full-screen overlay with gold spinner appears when share buttons clicked, auto-removes on completion/error/10s timeout.
- **Professional Estimate View**: Billing-software-style modal on painter dashboard with QC branding header, bordered items table, discount/total summary. Status-based action buttons: Request Discount, Record Payment, Share via WhatsApp.
- **Discount Request Workflow**: New statuses `discount_requested` and `final_approved`. Painter requests discount on approved customer estimate → admin applies % discount → final_approved → painter records payment → admin pushes to Zoho.
- **Admin % Markup**: Items table shows `zoho_description` (from zoho_items_map JOIN). Per-item % markup with bidirectional calculation (% ↔ price). Bulk % markup input applies to all items. Both absolute price and percentage markup supported.
- **Admin Discount Management**: For `discount_requested` status: amber notification, discount % input with live preview, "Apply Discount & Approve" or "Approve Without Discount" buttons.
- **New Backend Endpoints**: `POST /estimates/:id/discount` (admin apply discount), `POST /estimates/:id/approve-final` (admin skip discount), `POST /me/estimates/:id/request-discount` (painter), `POST /me/estimates/:id/payment` (painter payment).
- **Zoho Push Update**: Uses `final_grand_total` (post-discount) when discount applied. Discounted rates per item = `markup_unit_price * (1 - discount_pct/100)`.
- **DB Migration**: `migrate-estimate-discount.js` — 7 new columns (discount_percentage, discount_amount, final_grand_total, discount_requested_at, discount_notes, discount_approved_by, discount_approved_at) + expanded status ENUM.
- **Earlier (same day)**: Header logo, offer carousel, catalog earnings fix, GST removal, offer creation fix. See [feature-history.md] for details.
- **Dashboard API**: `GET /me/dashboard` returns `businessLogo`, parallelizes 6 queries with `Promise.all`
- **Migrations**: `migrate-painter-id-card.js`, `migrate-estimate-discount.js`

### Feb 28, 2026 — Painter Premium Features
- **Profile Photo Upload**: PUT /me/profile-photo endpoint with Sharp resize (400x400 JPEG). Card cache invalidation on profile changes.
- **Visiting Card Generator**: `services/painter-card-generator.js` — Sharp composite PNG (1050x600) with gradient header, circular photo, QR code, branding. GET /me/visiting-card with caching.
- **Color Visualization System**: `painter_visualization_requests` table. Painter submits photo+color → admin processes → painter notified. 5 new endpoints (2 painter + 3 admin).
- **Dashboard Redesign**: Avatar header, visiting card section with download/share, visualization gallery, 5-item quick actions scroll.
- **Profile Page**: New `painter-profile.html` with avatar upload, editable fields, dirty tracking.
- **Admin Visualization Tab**: Tab 10 in admin-painters.html — queue table, status filter, upload result, reject with notes.
- **Android Painter App v1.2.0**: Green/gold colors (no purple), referral auto-fill. APK + AAB built.
- **Cleanup**: Removed debug logging from admin-products.html, fixed purple → emerald on filter buttons.

### Feb 23, 2026 — Zoho Product Import & Painter Rates Fix
- **Fixed**: Painter Rates "Sync from Zoho" was querying non-existent `zoho_items_cache` table — changed to `zoho_items_map`
- **Enhanced**: GET `/api/painters/config/product-rates` now JOINs `zoho_items_map` for brand/MRP/stock info, supports `?search`, `?brand`, `?category` filtering
- **Enhanced**: POST `/api/painters/config/product-rates/sync` returns detailed response with `synced`, `skipped`, `total`, `brands[]`
- **Added**: Painter Rates tab: search/filter bar, Brand + MRP columns, 2-step sync (Zoho cache → rates table), progress indicator
- **Added**: Zoho Import tab on `admin-products.html?tab=zoho-import` — browse all Zoho items with brand/category/rate/stock/HSN, sync trigger, pagination
- **Added**: "Zoho Import" 4th tab in `products-subnav.html`

### Feb 23, 2026 — Zoho Bulk Edit Bug Fix & Module Analysis
- **Fixed**: Bulk edit item names showing "--" in job status — `pushChangesToZoho()` searched current page's `items` array; items from other pages weren't found
  - Frontend: `setDirty()` now stores `_itemName` in `dirtyItems` Map; `pushChangesToZoho()` uses stored name
  - Backend: POST `/api/zoho/items/bulk-edit` queries `zoho_items_map` for names when `item_name` is empty
- **Fixed**: Daily transaction details never updated on re-generate (`insertId` returns 0 on ON DUPLICATE KEY UPDATE)
  - `zoho-api.js`: Falls back to SELECT lookup for existing row ID when `insertId` is 0
- **Fixed**: Inventory adjustment cache not invalidated — `clearCache('inv_adjustments_')` called after POST
- **Added**: `clearCache(prefix)` utility function for targeted cache invalidation in `routes/zoho.js`
- **Analysis**: Comprehensive review of all 60+ Zoho endpoints across 4 files (zoho.js, zoho-api.js, rate-limiter, sync-scheduler)

---

## 9. PAINTER MANAGEMENT SYSTEM

### Overview
Loyalty program for painters who buy or recommend Quality Colours paint products. Painters earn points through billing, referrals, attendance, and volume slabs. Points split into **Regular** (withdraw anytime) and **Annual** (once per year) pools.

### Database Tables (11)
- `painters` — Core profile (full_name, phone, referral_code, credit, cached point balances, profile_photo, card_generated_at)
- `painter_sessions` — OTP-based authentication tokens
- `painter_point_transactions` — Ledger (source of truth for all point movements)
- `painter_referrals` — Referrer→referred pairs with tier tracking
- `painter_product_point_rates` — Per-product point config (regular pts/unit, annual %, eligibility)
- `painter_value_slabs` — Monthly/quarterly volume thresholds → bonus points
- `painter_withdrawals` — Redemption requests (pending→approved→paid)
- `painter_attendance` — Store visits, training, events
- `painter_invoices_processed` — Tracks which Zoho invoices are already processed
- `painter_slab_evaluations` — Tracks monthly/quarterly slab evaluation results
- `painter_visualization_requests` — Color visualization requests (painter submits photo → admin processes → painter receives result). Status: pending→in_progress→completed/rejected

### Points System
- **Self-billing**: Only annual points (annual_pct% of line total for eligible items)
- **Customer billing**: Regular points (per-unit rate) + annual points (if eligible)
- **Referral tiers**: 1-2 bills → 0.5%, 3-4 → 1%, 5-9 → 1.5%, 10+ → 2% (→ Regular pool)
- **Attendance**: Configurable points per visit (default 5 → Regular pool)
- **Value slabs**: Monthly/quarterly purchase volume → bonus points (→ Annual pool)
- **Credit**: Self-billing painters get credit limits with auto-debit on overdue

### Key Files
- `migrations/migrate-painters.js` — 10 tables + settings seeds + permissions
- `migrations/migrate-painter-premium.js` — painter_visualization_requests table + card_generated_at column
- `services/painter-points-engine.js` — Core points logic (invoice processing, slabs, credit, withdrawals)
- `services/painter-card-generator.js` — Sharp-based card generator: visiting card (1050x600 landscape) + ID card (600x900 portrait). Shared helpers: loadCompanyLogo, loadProfilePhoto, escapeSvg
- `routes/painters.js` — ~50 API endpoints (public + painter-auth + admin)
- `public/admin-painters.html` — Admin 10-tab page (Painters, Points, Rates, Withdrawals, Reports, Estimates, Offers, Training, Catalog, Visualizations)
- `public/painter-register.html` — Multi-step self-registration (phone OTP → details → referral). Auto-fills `?ref=` code from URL.
- `public/painter-login.html` — OTP-based painter login
- `public/painter-dashboard.html` — Premium dashboard (logo+avatar header, stats, brand-tabbed offer products, dual card section (visiting+ID), quick actions, referrals, estimates, transactions, visualizations). Clickable balance cards → bottom sheet with transaction history + inline withdraw (regular) or withdrawal window info (annual).
- `public/painter-profile.html` — Profile editing page with avatar photo upload, editable fields, dirty tracking
- `public/painter-catalog.html` — Product catalog for painters. Stock shown as "In Stock"/"Out of Stock" only (no numeric counts). Detail panel shows "Your Earnings" breakdown (Customer Billing vs Self Billing points per variant). Rates from `painter_product_point_rates` table (admin-configurable in Tab 3).
- `public/components/painters-subnav.html` — Module sub-navigation
- `config/uploads.js` — uploadPainterVisualization (memory storage, 10MB, images only)

### API Endpoints
- **Public**: POST register, send-otp, verify-otp | GET validate-referral/:code
- **Painter-Auth** (X-Painter-Token header): GET/PUT /me, PUT /me/profile-photo, GET /me/visiting-card(?format=url), GET /me/id-card(?format=url), /me/points/:pool, /me/referrals, /me/withdrawals, /me/invoices, /me/attendance, /me/dashboard (incl. businessLogo), GET /me/offer-products (brand-grouped), POST/GET /me/visualizations | POST /me/withdraw | GET /me/catalog(?search, ?brand, ?category, ?page), GET /me/catalog/:productId (variants with points_per_unit, annual_eligible, annual_pct)
- **Admin**: GET / (list), GET /:id, PUT /:id, PUT /:id/approve, PUT /:id/credit
- **Admin Visualizations**: GET /admin/visualizations(?status=), PUT /admin/visualizations/:id, POST /admin/visualizations/:id/upload-result
- **Points**: GET/POST /:id/points/adjust, POST /invoice/process, GET /invoice/search
- **Config**: GET /config/product-rates/grouped (products grouped with variant counts, price ranges, mixed-rate flags, unmapped items, filter dropdowns), GET /config/product-rates/grouped/:productId (lazy-load variants), PUT /config/product-rates/grouped (fan-out product rates to variants + per-variant overrides + unmapped), POST /config/product-rates/sync (reads from `zoho_items_map`), CRUD /config/slabs | Legacy: GET/PUT /config/product-rates
- **Withdrawals**: GET /withdrawals, PUT /withdrawals/:id (sends push notification on approval/rejection)
- **Reports**: GET /reports/summary, GET /reports/top-earners, GET /referrals, GET /attendance

### Permissions
- `painters.view` — View painter list and details
- `painters.manage` — Approve, edit, manage painters
- `painters.points` — Adjust points, process invoices, manage withdrawals

### Settings (ai_config table)
- `painter_annual_withdrawal_month` / `painter_annual_withdrawal_day` — Annual withdrawal window
- `painter_credit_overdue_days` — Days before auto-debit (default 30)
- `painter_attendance_points` — Points per attendance (default 5)
- `painter_referral_enabled` / `painter_system_enabled` — Feature toggles

### Scheduled Jobs (`services/painter-scheduler.js`)
- **Monthly slab evaluation**: 1st of month, 6:00 AM IST — evaluates previous month's purchase volumes
- **Quarterly slab evaluation**: 1st of Jan/Apr/Jul/Oct, 6:30 AM IST — evaluates previous quarter
- **Daily credit overdue check**: 8:00 AM IST — auto-debits points for overdue credit

### Navigation
- Sidebar: Painters section with "Painter Program" link (admin only)
- Subnav: 6 tabs mapped via `PAINTERS_SUBNAV_PATH` in `universal-nav-loader.js`
- Painter pages (register, login, dashboard, estimate-create) excluded from admin nav loading

### Staff Billing System
Full billing module for staff to create estimates, direct invoices, collect payments, and push to Zoho Books — for both customers and painters.

**Tables:** `billing_estimates`, `billing_estimate_items`, `billing_invoices`, `billing_invoice_items`, `billing_payments`

**Routes:** `routes/billing.js` — mounted at `/api/billing`
- Estimates: POST/GET/PUT/DELETE `/estimates`, POST `/estimates/:id/send`, POST `/estimates/:id/convert`
- Invoices: POST/GET/PUT `/invoices`, POST `/invoices/:id/payment`, POST `/invoices/:id/push-zoho`
- Payments: GET `/payments`
- Products: GET `/products` (searches zoho_items_map)
- Stats: GET `/stats` (dashboard aggregates)

**Services:** `services/billing-zoho-service.js` — `resolveZohoContact()`, `pushInvoiceToZoho()` (contact resolution, credit check, Zoho invoice creation, painter points, payment sync)

**Permissions:** `billing.estimate`, `billing.invoice`, `billing.payment`, `billing.zoho_push`. Staff gets estimate+invoice+payment; manager/admin gets zoho_push too.

**Page:** `public/staff-billing.html` — 3 tabs (Estimates, Invoices, Payments), create/edit modal with product search, payment modal, branch-filtered

**Flows:**
- Estimate-first: Create estimate → Send → Convert to invoice → Collect payment → Push to Zoho
- Direct invoice: Create invoice → Collect payment → Push to Zoho
- Payment options: Full (cash sale), Partial (track balance), Credit (push without payment)
- Painter billing: auto-awards points via painter-points-engine on Zoho push

**Number format:** `BE-YYYYMMDD-001` (estimates), `BI-YYYYMMDD-001` (invoices)

**Config keys:** `billing_enabled`, `billing_estimate_prefix`, `billing_invoice_prefix`, `billing_gst_inclusive` (in `ai_config`)

**Migration:** `node migrations/migrate-billing.js`

### Vendor Management System
Full vendor management module — vendor CRUD, purchase bills with AI verification, purchase orders, vendor payments, Zoho integration.

**Tables:** `vendors`, `vendor_bills`, `vendor_bill_items`, `vendor_purchase_orders`, `vendor_po_items`, `vendor_payments`

**Routes:** `routes/vendors.js` — mounted at `/api/vendors`
- Vendors: GET/POST/PUT `/`, GET `/:id`, POST `/sync-zoho`
- Bills: POST `/bills/scan` (AI), GET/POST `/bills`, GET `/bills/:id`, PUT `/bills/:id/items`, POST `/bills/:id/verify`, POST `/bills/:id/submit`, POST `/bills/:id/push-zoho`
- POs: GET/POST `/purchase-orders`, PUT `/purchase-orders/:id`, POST `/purchase-orders/:id/send`, POST `/purchase-orders/:id/push-zoho`
- Payments: GET/POST `/payments`

**Services:**
- `services/vendor-bill-ai-service.js` — `scanBillImage()` (OCR via KAI/Clawdbot with base64 image), `matchProductsToZoho()` (fuzzy product matching with vendor history priority), `verifyBillItems()` (staff vs AI comparison)

**Permissions:** `vendors.view`, `vendors.manage`, `vendors.purchase_orders`. Staff gets view only; manager/admin gets all.

**Page:** `public/staff-vendors.html` — 4 tabs (Vendors, Bills, Purchase Orders, Payments)

**AI Bill Flow:** Upload photo → KAI OCR extract → fuzzy match to zoho_items_map (vendor history priority) → staff edits → AI verify (compare entry vs scan) → submit

**Zoho API:** `zoho-api.js` exports `createBill()`, `getBills()`, `createPurchaseOrder()`, `getPurchaseOrders()` for vendor integration

**Config keys:** `vendor_management_enabled`, `vendor_ai_scan_enabled`, `vendor_po_prefix` (in `ai_config`)

**Migration:** `node migrations/migrate-vendors.js`

### Painter Estimate System
Painters create estimates for paint purchases; admin reviews, records payment, pushes to Zoho as invoice, and awards points.

#### Two Billing Flows
1. **Self-Billing** — painter sees dealer prices (zoho_rate), submits → admin approves → painter submits payment → admin confirms → push to Zoho → annual points only
2. **Customer-Billing** — painter does NOT see prices, submits → admin sets markup prices → shares with customer (WhatsApp link) → painter submits payment → admin confirms → push to Zoho → regular + annual points

#### Database Tables
- `painter_estimates` — estimate_number (PE+YYYYMMDD+4seq), painter_id, billing_type (self/customer), customer fields, cost totals, markup totals, status workflow, payment fields, Zoho fields, points, share_token
- `painter_estimate_items` — line items with zoho_item_id, unit_price (server-side from zoho_rate), markup prices (admin-set)
- Status flow: `draft` → `pending_admin` → `approved` / `admin_review` → `sent_to_customer` → `discount_requested` → `final_approved` → `payment_submitted` → `payment_recorded` → `pushed_to_zoho` | `rejected` | `cancelled`
- **Payment flow**: Painter submits → `payment_submitted` (pending confirmation). Admin confirms → `payment_recorded` (shows "Paid" on painter panel). Admin can also record payment directly → `payment_recorded`.
- **Balance due**: When total > payment_amount, balance shown in admin + painter views. Push-to-Zoho blocked. Painter can submit additional payment from `payment_recorded` status.
- **All prices GST-inclusive** — no separate GST line in UI or PDF

#### Endpoints
**Painter-Auth** (`/me/estimates/*`):
- `GET /me/estimates/products` — product list (?billing_type=self shows prices)
- `GET /me/estimates` — list own estimates
- `POST /me/estimates` — create (draft or submit)
- `GET /me/estimates/:id` — view single
- `PUT /me/estimates/:id` — update draft
- `POST /me/estimates/:id/submit` — submit draft
- `POST /me/estimates/:id/request-discount` — request discount (customer billing)
- `POST /me/estimates/:id/payment` — submit payment (→ `payment_submitted`, pending admin confirmation; also works from `payment_recorded` for balance payments)
- `GET /me/estimates/:id/pdf` — download estimate PDF (non-draft)
- `DELETE /me/estimates/:id` — cancel draft

**Admin** (`/estimates/*`):
- `GET /estimates` — list all (filter: status, billing_type, painter)
- `GET /estimates/products?search=` — search products for edit items (BEFORE /:id)
- `GET /estimates/:id` — detail with painter info
- `PUT /estimates/:id/items` — edit items (admin_review/approved/sent_to_customer/final_approved/payment_submitted/payment_recorded); customer billing: clears markup, resets to admin_review; self billing: keeps status; payment fields always preserved
- `GET /estimates/:id/pdf` — download estimate PDF (non-draft)
- `PUT /estimates/:id/review` — approve/reject
- `POST /estimates/:id/markup` — set markup prices (customer-billing)
- `POST /estimates/:id/share` — generate share token + WhatsApp link
- `POST /estimates/:id/discount` — apply discount to customer estimate
- `POST /estimates/:id/approve-final` — approve without discount
- `POST /estimates/:id/confirm-payment` — confirm painter-submitted payment (`payment_submitted` → `payment_recorded`)
- `POST /estimates/:id/payment` — record payment directly (admin, goes straight to `payment_recorded`; also accepts `payment_submitted` status)
- `POST /estimates/:id/push-zoho` — create Zoho invoice + award points (blocked when balance > 0)

**Public**: `GET /estimates/share/:token` — shared estimate data (no auth)

#### PDF Generator
- `routes/painter-estimate-pdf-generator.js` — PDFKit-based, painter brand colors (green `#1B5E3B` + gold `#D4A24E`)
- Columns: #, Product, Brand, Qty, Rate, Amount
- Customer billing: shows markup prices; Self billing: shows cost prices
- Discount line shown when discount applied; footer: "Quality Colours — Your Trusted Paint Partner"

#### Pages
- `painter-estimate-create.html` — 3-step builder (billing type → customer details → product picker + cart)
- `painter-dashboard.html` — "Create Estimate" button + "My Estimates" section
- `admin-painters.html` — Tab 6 "Estimates" with filter bar (incl. Payment Submitted/Confirmed filters), table, detail modal with: Edit Items button (all statuses), PDF download, Confirm Payment for payment_submitted, balance due display, status-dependent actions
- `share/painter-estimate.html` — public customer view with print button

#### Key Implementation Details
- `unit_price` always set SERVER-SIDE from `zoho_items_map.zoho_rate` (never trusts client)
- All prices GST-inclusive — no separate GST calculation, `gst_amount = 0`, `markup_gst_amount = 0`
- **Points awarded at confirm-payment** (not push-to-zoho): `pointsEngine.processInvoice()` called with `invoice_id: EST-{id}` for dedup. Push-to-zoho checks `points_awarded > 0` and skips re-award.
- Push-to-Zoho resolves contact (painter's zoho_contact_id or creates new), creates invoice
- Share tokens expire after 7 days
- Balance due = `effectiveTotal - payment_amount`, calculated dynamically (no extra column)
- `effectiveTotal` = `final_grand_total || markup_grand_total || grand_total`
- Painter payment adds to existing `payment_amount` (for balance payments)
- Permission: `painters.estimates`
- Migration: `node migrations/migrate-painter-estimates.js`

### Painter Premium Features (Feb 28, 2026)
Profile avatar, server-generated visiting card, color visualization system, and premium dashboard redesign.

#### Profile Photo
- `PUT /me/profile-photo` — multer upload → sharp resize 400x400 → JPEG 80% → saves as `painter_{id}.jpg`
- Updates `painters.profile_photo` column, sets `card_generated_at = NULL` (invalidates card cache)
- `PUT /me` also sets `card_generated_at = NULL` when profile fields change

#### Visiting Card Generator
- `services/painter-card-generator.js` — Sharp composite: visiting card (1050x600) + ID card (600x900). Company logo from settings, circular photo (180px, or initials fallback), QR code, gradient header/footer
- Visiting card: `painter_{id}.png`, ID card: `painter_id_{id}.png`, both in `public/uploads/painter-cards/`
- QR code links to `{ORIGIN}/painter-register.html?ref={referral_code}`
- `GET /me/visiting-card` returns PNG image (or `?format=url` for JSON URL)
- `GET /me/id-card` returns ID card PNG (or `?format=url` for JSON URL)
- Cache: regenerates when `card_generated_at` is NULL or stale vs `updated_at`

#### Color Visualization System
- **Table**: `painter_visualization_requests` (painter_id, photo_path, brand, color_name, color_code, color_hex, notes, status, visualization_path, admin_notes, processed_by, created_at, completed_at)
- **Painter**: `POST /me/visualizations` (photo + color info), `GET /me/visualizations` (list)
- **Admin**: `GET /admin/visualizations(?status=)`, `PUT /admin/visualizations/:id` (status/notes), `POST /admin/visualizations/:id/upload-result` (upload processed image)
- Notifications sent to painter on completion/rejection via `painter-notification-service`

#### Dashboard Redesign
- Header: circular avatar linking to `/painter-profile.html`, initials fallback
- Quick actions: 5-item horizontal scroll (Estimate, Withdraw, Card, Refer, Visualize)
- Visiting Card section: card thumbnail, Download + Share buttons (Web Share API with file)
- Visualization Gallery: completed grid (2-col) + pending list with status badges
- Request Visualization modal: photo upload + brand/color/hex picker + notes

#### Admin Tab
- Tab 10 "Visualizations" in `admin-painters.html`: status filter, 3 stat cards, queue table
- Actions: Start processing, Upload result, Reject with notes

#### Android Painter App
- Package: `com.qcpaintshop.painter`, v1.2.0 (versionCode 3)
- Colors: green/gold (#1B5E3B/#D4A24E), NO purple
- Publish script: `google-services/publish-painter.js`
- Play Console registration still pending (first upload must be manual)

#### Migration
- `node migrations/migrate-painter-premium.js` — creates `painter_visualization_requests` table, adds `card_generated_at` column

### Painter Retention System (Mar 14, 2026)
4-tier level system, daily streaks with milestone bonuses, morning briefing card, and daily bonus cap.

#### Level System
- **4 tiers**: Bronze (0pts, 1x), Silver (5K, 1.2x), Gold (25K, 1.5x), Diamond (100K, 2x)
- Config stored in `painter_levels` table (seeded by migration)
- Level multiplier applied via `addPointsWithMultiplier()` to: invoice points, attendance points, streak bonuses
- NOT applied to: referral points (own tier scaling), slab bonuses, admin adjustments
- Level-up auto-detected by `checkLevelUp()` inside `addPointsWithMultiplier()` — sends FCM notification, invalidates card cache
- `painters` table columns: `current_level` (default 'bronze'), `level_updated_at`

#### Streak System
- **Daily check-in**: `PUT /me/daily-streak` — idempotent (INSERT IGNORE into `painter_daily_checkins`)
- `painter_daily_checkins` table: composite PK (`painter_id` + `checkin_date`)
- Streak calculated from consecutive days in `painter_daily_checkins` (walking backwards from today)
- `painters` columns: `current_streak`, `longest_streak`, `last_checkin_date`
- **Milestones**: 3 days (50 pts), 7 days (150 pts), 14 days (300 pts), 30 days (1000 pts) — awarded via `addPointsWithMultiplier()`
- **Streak reset**: Cron at midnight IST resets `current_streak = 0` for painters who missed yesterday
- **Streak reminder**: Cron at 8 PM IST sends FCM to painters with active streak who haven't checked in today (controlled by `painter_streak_reminder_enabled` config)
- Frontend: `sessionStorage` guard prevents duplicate API calls; streak calendar bottom sheet shows monthly check-ins

#### Morning Briefing Card
- `GET /me/briefing` — returns earnings since `last_briefing_at`, estimate/withdrawal updates, daily bonus product info, level progress
- Updates `painters.last_briefing_at` on each call
- `painters` column: `last_briefing_at` (DATETIME)
- Frontend: gradient-bordered card at top of dashboard with earned amount, daily bonus product countdown, progress bar to next level

#### Daily Bonus Product
- Rotation: Cron at 00:05 IST picks random active product, 50/50 chance of 2x or 3x multiplier
- Push notification: Cron at 7 AM IST sends bonus product info to all painters
- **Cap enforcement**: `painter_daily_bonus_cap` config (default 500 pts) — checked in `processInvoice()` against today's bonus earnings
- Config keys: `painter_daily_bonus_product_id`, `painter_daily_bonus_multiplier`, `painter_daily_bonus_cap`

#### Check-in History
- `GET /me/checkin-history?month=YYYY-MM` — returns array of check-in dates for the given month
- Used by streak calendar bottom sheet in painter dashboard

#### Card Generator Updates
- `levelBadge(x, y, level)` function renders SVG rect + circle + text (no emoji)
- Both visiting card and ID card display current level badge
- Level-up invalidates card cache (`card_generated_at = NULL`, `id_card_generated_at = NULL`)

#### Scheduler Jobs (painter-scheduler.js)
- `runStreakReset`: 00:00 IST — reset streaks for painters who missed yesterday
- `runDailyBonusRotation`: 00:05 IST — pick random bonus product
- `runDailyBonusPush`: 07:00 IST — send bonus product FCM notification
- `runStreakReminder`: 20:00 IST — remind at-risk streaks (if `painter_streak_reminder_enabled`)

#### Notification Types
- `streak_milestone` — awarded at 3/7/14/30 day milestones (English + Tamil)
- `streak_at_risk` — 8 PM reminder for unchecked painters with active streak
- `level_up` — fired from `addPointsWithMultiplier()` on level change
- `daily_bonus` — 7 AM product of the day notification

#### Admin View
- `admin-painters.html`: Level (color-coded badge) and Streak columns added to painter table
- Detail view: Level and Streak stat cards replace Experience/Status cards

#### Migration
- `node migrations/migrate-painter-retention.js` — creates `painter_daily_checkins` table, `painter_levels` table (seeded), adds 5 columns to `painters`, expands `source` ENUM, seeds 4 `ai_config` keys, backfills levels

---

### Staff & Admin Mobile UX Upgrade (Apr 17 2026)

5 pages made fully mobile-friendly + Painter Program nomination flow added to staff:

- **`staff-painter-marketing.html`** — Full rewrite: Tailwind + staff sidebar nav + action-first cards (Call/WA/Log 3-col grid) + interested→convert strip. Replaced fixed 720px container.
- **`staff-leads.html`** — Paint roller SVG button on each lead card → nomination modal → `POST /api/painter-marketing/staff/leads/from-lead`. On success: toast + card updates to `✓ Painter` badge without reload.
- **`admin-leads.html`** — Mobile card view (`md:hidden`) alongside existing table (`hidden md:block`). Nomination modal now bottom-sheet on mobile.
- **`admin-painters.html`** — Marketing/All Leads subtab: mobile card list + `#mktLeadPanel` becomes bottom-sheet on mobile via CSS (`@media max-width:767px`).
- **`staff-billing.html`** — Items tables in detail panels wrapped with `overflow-x-auto`.
- **Backend** — `POST /api/painter-marketing/staff/leads/from-lead` (`requireAuth`). Normalizes phone, guards branch ownership, saves notes, returns `painter_lead_id`. Migration: `migrations/migrate-staff-assign-enum.js` adds `staff_assign` to `branch_detected_via` ENUM.

---

### PNTR Painter Marketing System (Apr 2026)

Bridge between Zoho Books PNTR-prefixed painter customers and the Painter Loyalty Program. Bulk-import painter customers from Zoho → branch-wise marketing pool → daily staff assignments → outcome tracking → convert interested leads into formal painters → universal Zoho customer + sales-person sync → annual points backfill for Dec 2025+ invoices (direct billing + salesperson attribution).

#### New Tables (7)
- `painter_leads` — Marketing pool (one per Zoho PNTR customer). Status: `new/in_progress/interested/converted/active_painter/not_interested/unreachable/wrong_number/duplicate/snoozed`.
- `painter_lead_followups` — Per-call/WA/visit log with outcome enum.
- `painter_daily_assignments` — Today's list snapshot per staff (sticky owner + daily quota).
- `painter_marketing_config` — Per-branch or per-user quota + recycle-day overrides.
- `painter_zoho_salesperson_map` — Zoho Sales Person → painter linkage with match_confidence.
- `painter_pntr_import_runs` — Audit log for bulk/incremental imports.
- `painter_lead_duplicate_queue` — Scenario 3 review.
- `painter_zoho_sync_queue` — Failed Zoho creates retry with exponential backoff.

#### ALTERs
- `painters` gained: `zoho_customer_id`, `zoho_salesperson_id`, `created_via` ENUM, `activated_at`, `source_lead_id`. **Activation semantics**: `status='approved' AND activated_at IS NULL` = pending activation (no points), `activated_at IS NOT NULL` = fully active.
- `painter_invoices_processed` gained: `attribution_type` ENUM(`direct_billing`,`salesperson`,`painter_estimate`), `source_invoice_date`, `zoho_invoice_id`. UNIQUE key upgraded to `(painter_id, invoice_id, attribution_type)` — same invoice CAN award points twice if painter is BOTH customer AND salesperson on it.
- `zoho_invoices` gained: `zoho_salesperson_id`, `zoho_salesperson_name` — captured on every sync via `services/zoho-api.js::syncInvoices`.

#### Services
- `services/pntr-import-service.js` — Phone normalizer, branch-prefix parser, salesperson fuzzy matcher (exact_phone/exact_name/fuzzy_name via Levenshtein<3), bulk + incremental Zoho customer scan.
- `services/painter-zoho-sync-service.js` — Universal `syncPainterToZoho(painterId)` hook (idempotent). Creates Zoho customer `PNTR {branchCode} {fullName}` + salesperson `{fullName} {phone}`. On failure queues in `painter_zoho_sync_queue` with retry 1h→4h→12h→24h, gives up at 5 attempts.
- `services/painter-marketing-scheduler.js` — Outcome→status mapper, daily list picker (rollover + quota), load-balanced new-lead assignment, 7 IST cron registrations.
- `services/painter-points-backfill-service.js` — Direct + salesperson scan against `zoho_invoices`. Idempotent via `painter_invoices_processed` composite unique. Rates from `ai_config` keys: `painter_self_billing_annual_rate`, `painter_customer_billing_regular_rate`, `painter_customer_billing_annual_rate` (default 0.005 each).

#### Routes
- `routes/painter-marketing.js` mounted at `/api/painter-marketing/*`.
  - Staff: `GET /me/today`, `GET /me/painters`, `POST /leads/:id/followup`, `POST /leads/:id/convert` (now creates `staff_incentives` with `source='painter_convert'` on success)
  - Admin (original): `POST /admin/import/{bulk,incremental}`, `GET /admin/import/runs`, queues (`unassigned`, `duplicates`, `salesperson-unmatched`), `GET+POST /admin/config`, `POST /admin/generate-daily-lists`, `POST /admin/backfill/{preview,run}`, `GET /admin/performance`.
  - Admin (Apr 17 additions): `GET /admin/leads` (all painter_leads with branch/status/search filter + source_lead_id + source_lead_name), `PUT /admin/leads/:id/assign` (manual branch+staff or auto), `GET /admin/leads/:id/history`, `GET /admin/branches/:branch_id/staff`, `POST /admin/leads/:id/send-wa` (system WA session), `POST /admin/leads/from-lead` (nominate customer lead as painter_lead, source_lead_id FK).
- `routes/painters.js` additions:
  - `/register` INSERT now fires `syncPainterToZoho()` (fire-and-forget) for all 3 paths.
  - `POST /:id/activate` — dual-auth (painter self via `x-painter-token` matching id, OR admin via `painters.manage`). Sets `activated_at`, updates lead status to `active_painter`, chains Zoho sync → backfill.

#### Permissions (4 new, module=`painters`)
- `marketing_view` — Staff see their daily list
- `marketing_contact` — Log followups
- `marketing_manage` — Admin config, queues, imports, backfill
- `marketing_convert` — Convert lead → painter

Default grants: manager gets all 4, staff gets view/contact/convert. Run `node migrations/migrate-pntr-marketing-permissions.js` to seed.

#### Crons (7, all IST — registered from `painter-scheduler.js::start()`)
| Time | Job |
|------|-----|
| 02:30 | Incremental PNTR Zoho customer sync |
| 03:00 | `painter_zoho_sync_queue` retry |
| 03:30 | Daily points backfill for new invoices |
| 06:00 | Generate daily painter-call lists per staff |
| 06:30 | FCM push "Today's calls ready" |
| 17:00 | FCM reminder for < 50% completion |
| 18:00 | WhatsApp alert to branch manager if any staff < 30% |

#### UI Pages
- `public/admin-painters.html` — "📣 Marketing" tab now has 8 sub-tabs: **All Leads** (new, Apr 17 — branch/status/search filter table, row-click slide panel, manual assign, WA send, contact history), Branch Unassigned, Duplicate Phone, Salesperson Unmatched, Import Runs, Performance, Points Backfill, Config. Slide panel z-index=10000 (above universal-nav 9999).
- `public/admin-leads.html` — Now has "🎨 Painter" button on every lead row (Apr 17). Click → modal → branch select → POST /admin/leads/from-lead → nominates as painter_lead. Already-nominated leads show "✓ Painter" badge. `escapeHtml()` is the XSS function (NOT `mktEsc`).
- `public/staff-painter-marketing.html` — Staff page (today's list + outcome modal + "Convert" on interested leads). Added to `public/components/staff-sidebar.html` under "My Work".
- `public/painter-login.html` — After OTP verify, fires `/api/painters/:id/activate` (painter's own id, or `?ref=` override) to trigger backfill.

#### Migrations
- `migrations/migrate-zoho-invoices-salesperson.js` — adds `zoho_salesperson_id/_name + index` on `zoho_invoices`
- `migrations/migrate-pntr-painter-marketing.js` — all 7 tables + 2 ALTERs (painters, painter_invoices_processed)
- `migrations/migrate-pntr-marketing-permissions.js` — 4 permissions + role grants
- `migrations/migrate-pntr-wa-templates.js` — seeds `ai_config` rate keys (0.005) + Tamil WA templates (marketing prospecting + activation invite)
- `migrations/migrate-painter-lead-incentive.js` — (Apr 17) ALTER `staff_incentives.source` ENUM to add `'painter_convert'`

#### Leads ↔ Painter Program Integration (Apr 17)
- `painter_leads.source_lead_id` FK → `leads.id` — already existed, now populated when staff nominates via admin-leads.html
- `leads.lead_type = 'painter'` — set when lead is nominated
- `staff_incentives.source = 'painter_convert'` — fired by `POST /leads/:id/convert` if `painter_lead.assigned_to` exists and `incentive_enabled=true`
- Incentive amount: `incentive_per_conversion` ai_config (default ₹500), auto-approve if `incentive_auto_approve=true`
- Source badge in All Leads: `l.source_lead_id` → "📋 Customer Lead" blue pill in Marketing All Leads table

#### WhatsApp Templates (in `ai_config`, Tamil — no வணக்கம் per project rule)
- `painter_marketing_wa_template` — outbound prospecting message with `{painter_name}`, `{branch_name}`, `{staff_phone}` placeholders
- `painter_activation_wa_template` — sent after Path A conversion with activation link `https://act.qcpaintshop.com/painter-onboard?ref={painter_id}`

#### Tests
- 22 tests in `tests/unit/pntr-import-service.test.js` (phone normalizer, branch parser, fuzzy matcher, pipeline w/ 4 scenarios)
- 4 tests in `tests/unit/painter-zoho-sync-service.test.js` (idempotency, create, queue-on-error, backoff schedule)
- 7 tests in `tests/unit/painter-marketing-scheduler.test.js` (every outcome branch)
- 4 tests in `tests/unit/painter-points-backfill-service.test.js` (skip-not-activated, direct, salesperson, idempotent)

---

## 10. KNOWN ISSUES & ROADMAP

### Known Issues
- Customer auth token not stored in DB (localStorage only - no server-side validation)
- Pollinations AI kontext model moved to paid-only (using flux text-to-image as fallback)
- No automated test suite

### Potential Enhancements
- [ ] Invoice generation (not just estimates)
- [ ] Payment collection tracking
- [ ] Customer notification system (SMS/WhatsApp for estimate updates)
- [ ] Multi-language support
- [ ] Automated backup system
- [ ] API rate limiting for public endpoints
- [ ] Audit trail for all admin actions
- [ ] Progressive Web App (Service Worker caching)
- [ ] Customer feedback/rating system

---

### Incentive Slab System (Mar 6, 2026)
- **`incentive_slabs` table**: Amount-based tiers (`min_amount`, `max_amount` => `incentive_amount`). Default: 10K-30K=>200, 30K-60K=>400, 60K+=>600
- **Auto-incentive on payment**: Both push-to-zoho and confirm-payment endpoints now use slab lookup (fallback to flat `incentive_per_conversion`)
- **Multiple incentives per lead**: Different estimates create separate incentives (dedup by `lead_id + estimate_id`)
- **New columns on `staff_incentives`**: `estimate_id`, `estimate_amount`, `source` (auto_estimate/manual_request/admin_added), `invoice_reference`
- **Manual request flow**: Staff submits `POST /api/salary/incentives/request` with amount + invoice_reference => slab lookup => pending approval
- **Slab CRUD**: `GET/POST/PUT/DELETE /api/salary/incentive-slabs` (admin)
- **Re-engagement system**: `GET /api/leads/re-engage` lists dormant converted leads (no activity > X days), `POST /api/leads/:id/re-engage` resets to 'interested'
- **New leads columns**: `re_engaged_at`, `re_engage_count`
- **Config keys**: `incentive_slab_enabled`, `incentive_reengagement_days` (default 90)
- **Notifications**: All incentive status changes trigger FCM push notifications:
  - `incentive_earned` → staff when auto-incentive created (confirm-payment or push-to-zoho)
  - `incentive_approved` → staff when admin approves (single or bulk)
  - `incentive_rejected` → staff when admin rejects (includes rejection notes)
  - `incentive_request` → admins when staff submits manual request
- **Phone lookup**: `GET /api/leads/my/check-phone?phone=` checks painters table + existing leads, shows badge in staff lead form
- **Staff dormant leads**: Separate `/my/re-engage` endpoints with `leads.own.view`/`leads.own.edit` permissions
- **UI**: Slabs config section on `admin-salary-incentives.html`, "Request" button on `staff-incentives.html`, "Dormant" tab on `staff-leads.html` and `admin-leads.html`
- **Migration**: `migrations/migrate-incentive-slabs.js`

### Staff Panel Green Theme (Mar 7, 2026)
- **Theme overhaul**: All 20+ staff pages rebranded from indigo/purple (`#667eea`/`#764ba2`) to green/teal (`#16a34a`/`#0d9488`)
- **Color mapping**: `indigo-*` Tailwind → `green-*`, `purple-*` → `teal-*`
- **Dashboard redesign**: Full-width gradient header bar (green→teal) with avatar, greeting, date. Body background: `#f0fdf4` (green-50)
- **Files updated**: `staff/dashboard.html`, `staff-daily-work.html`, `staff-leads.html`, `staff-incentives.html`, `staff-requests.html`, `staff-estimates.html`, `staff-register.html`, all `staff/*.html` subpages, `components/staff-sidebar.html`
- **Notification deep links**: Added `incentive_earned/approved/rejected/request` types to `header-v2.html`, `sw.js`, and Android `QCFirebaseMessagingService.kt`
- **Android FCM**: Already green-themed (`#1B5E3B`), FCM working (server logs confirm delivery). Token refreshes on app open.

### Painter Native Android App v2.0.0 (Apr 5, 2026)
- **Full native rewrite**: Jetpack Compose + Material 3, replacing WebView wrapper
- **Architecture**: Hilt DI, Retrofit + OkHttp, Room DB, DataStore, MVVM, Compose Navigation
- **Navigation**: 5-tab bottom nav (Home | Work | +New FAB | Catalog | Me)
- **12 Working Screens**: Login/Register (OTP), Dashboard, Work (Estimates+Quotations), Estimate Create (multi-step), Quotation Create (5-step), Catalog, Profile, Check-in (GPS), Calculator, Leaderboard, Achievements, Settings
- **New features**:
  - **Contract Quotation System**: 4 types (Labour-Salary, Labour-Sqft, L+Material-Sqft, L+Material-Itemized), room-wise breakdown, PDF with painter branding
  - **Paint Calculator**: Multi-room, 6 paint types, coverage rates, convert-to-quotation
  - **Gamification**: Levels (Bronze→Diamond), 10 badges, weekly challenges, monthly leaderboard
  - **Price Match Reports**: Competitor price reporting with bill proof photo
  - **Product Requests**: Request out-of-catalog products, notification on availability
  - **Work Gallery**: Before/after work photos with categories
  - **Voice Search**: Tamil/English via Android SpeechRecognizer
- **Design**: Modern card-based (PhonePe/GPay style), QCGreen #1B5E3B + QCGold #D4A24E
- **Language**: Bilingual Tamil/English with in-app toggle (130+ strings)
- **Backend**: 25 new API endpoints, 10 new database tables, 3 migrations

### Painter Native Android App v2.1.0 (Apr 6, 2026) — Full Web Parity
- **Upgrade**: All 5 placeholder screens implemented + 10 new screens + major upgrades to Catalog & Dashboard
- **22+ Working Screens**: 0 placeholders remaining
- **Catalog upgrade**:
  - Filter bottom sheet: Brand dropdown, Category dropdown, "Points products only" toggle, "In stock only" toggle
  - Filter count badge on filter icon
  - Product family grouping (one card per product family, expandable for pack size variants)
  - Offer banners horizontal carousel (4 gradient styles)
  - Product detail bottom sheet with variant earnings breakdown (size, rate, regular pts, annual pts)
- **Dashboard upgrade (12 new sections)**:
  - Balance cards (2x2: Regular Points, Annual Points, Total Earned, Referrals)
  - Offer products carousel (brand tabs + HorizontalPager auto-scroll + dot indicators)
  - My Cards section (visiting + ID card thumbnails + share)
  - Quick actions row (Estimate, Withdraw, Card, Refer, Visualize)
  - Referral code section (dashed border + share via native intent)
  - Recent estimates list (last 10, tap → detail)
  - Recent transactions list (source, amount, pool badge)
  - Visualization gallery + pending list + request button
  - Withdrawal bottom sheet (pool dropdown, amount input, balance display)
  - Streak calendar bottom sheet (monthly grid, green dots, month nav)
  - Level panel (Bronze/Silver/Gold/Diamond expandable)
- **New profile screens**:
  - **Points History**: Regular/Annual tab toggle, balance card, filter chips (All/Earned/Spent/Withdrawn), infinite scroll
  - **Cards**: Visiting + ID card images (Coil), Share (native intent) + Download (MediaStore gallery)
  - **Visualizations**: Completed gallery (2-col grid) + pending list + request form (camera+gallery, brand, color name, hex picker, notes)
  - **Referrals**: Code display + share + stats + referral list with status badges
  - **Gallery**: 3-column grid of visualization images + fullscreen viewer
  - **Training**: Generic list (title, type badge Video/Article, duration) + detail screen (WebView/external)
  - **Attendance Calendar**: Streak count, monthly stats, calendar grid (green=checked in, blue border=today), check-in button
  - **Edit Profile**: Circular photo picker (camera+gallery), name/city fields, save → multipart upload
- **Detail screens**:
  - **Estimate Detail**: Items table, totals (subtotal/markup/discount/grand total/payment/balance), status-based actions (Request Discount, Submit Payment, Download PDF)
  - **Quotation Detail**: Room breakdown with dimensions, items, labour/material totals, terms
  - **Product Detail**: Full screen with image, offers, variant list
- **Notifications + FCM**:
  - Notification list screen (read/unread styling, type-based emoji icons, time ago, pull-to-refresh)
  - FCM push → native deep link routing: estimate→detail, points→history, offer→catalog, viz→gallery, training→list
  - Token registration on OTP verify (AuthViewModel → NotificationApi.registerFcmToken)
  - Deep link handling via MainViewModel.pendingDeepLink + PainterMainActivity.onNewIntent
- **Backend**: Added `hasPoints` and `inStock` query params to `GET /api/painters/me/catalog`
- **DI**: 17 API interfaces (added PointsApi, CardsApi, VisualizationApi, ReferralApi, NotificationApi, ProfileApi)
- **Key new files**: `ui/catalog/FilterBottomSheet.kt`, `ui/catalog/ProductDetailSheet.kt`, `ui/home/components/` (11 files), `ui/profile/` (16 new files), `ui/work/estimates/EstimateDetailScreen.kt`, `ui/work/quotations/QuotationDetailScreen.kt`, `ui/notifications/NotificationsScreen.kt`, `utils/TimeUtils.kt`, `utils/NotificationBadge.kt`
- **APK**: `app/build/outputs/apk/painter/release/app-painter-release.apk` (8.7MB)

### Painter App Bug Fixes & Enhancements (Apr 6-7, 12 builds)
- **Loyalty levels**: Bronze 0/1x → Silver 3,000/1.2x → Gold 5,000/1.5x → Diamond 10,000/2x. Migration: `migrate-painter-levels-update.js`
- **Card design v8**: Enterprise redesign — photo-first visiting card (1400×800), QR-dominant ID card (800×1200), level-colored accents
- **Card share**: Image + marketing text + referral link. Fullscreen viewer on tap. Download to gallery
- **Estimate create UI**: Compact single-row header (back arrow + step dots on green bar), inline filter chips (Search/Brand/Category/Points), collapsed product cards (tap to expand variants), self billing shows prices, customer billing hides prices
- **Catalog filters**: Inline chips (Search/Brand/Category/Points) matching estimate style. Points chip filters to products with regular_points > 0
- **Variant sort**: Numeric order (1L→4L→10L→20L) via `CAST(ps.size AS DECIMAL)`
- **Points in estimate**: `regular_points` and `annual_points` shown per variant from `painter_product_point_rates`
- **Catalog product detail**: Fixed size/points display (field name mapping: `product_id`, `pack_size`→`size`, `points_per_unit`→`regular_points`). Fixed variant.id type (String not Int for zoho_item_id)
- **Backend**: `hasPoints` filter on `/me/estimates/products`, points data in pack_sizes response, dashboard returns `painterCity`

### Zoho Price-Adjust, Sidebar Accordion, Login-After-Logout fix (Apr 14, 2026)
- **Zoho Price-Adjust**: `% Adjust` on `admin-zoho-items-edit.html` now supports source→target dropdowns (default DPL→Rate, formula `source × (1 + pct/100)`); admin sidebar converted to click-to-expand accordion with full subnav parity (Zoho/WhatsApp/Painters/System sections now list every page from their horizontal subnav); `auth-helper.js` added proactive `validateSession()` against `/api/auth/me` so stale sessions no longer leave the user on a non-functional dashboard — expired sessions redirect to `/login.html?reason=expired` with a toast. Files: `public/admin-zoho-items-edit.html`, `public/components/sidebar-complete.html`, `public/universal-nav-loader.js`, `public/js/auth-helper.js`, `public/login.html`. Spec: `docs/superpowers/specs/2026-04-14-zoho-bugs-sidebar-auth-design.md`.

### Painter Native Android App v3.0.0 → v3.1.0 (Apr 17–18, 2026) — Cart + Customer Estimate + PDF

**v3.0.0 data-layer completion** (Apr 17-18, branch `audit/2026-04-17`):
- 261 compile errors → 0. `./gradlew clean :app:assemblePainterRelease` → BUILD SUCCESSFUL (8m 21s), 8.68 MB.
- DTOs added: `BalanceData`, `ProductDetail`, `ProductVariant`, `ProductOffer`, `OfferProduct`, `ProductDetailResponse`, `OfferProductsResponse`, `CheckinDay`, `SubmitWithdrawalRequest`.
- API methods: `getProductDetail`, `getOfferProducts`, `getCheckinHistory`, `submitWithdrawal`, `clearWithdrawalMessages`.
- `CatalogViewModel`: full rewrite with filters, pagination, product-detail sheet, `activeFilterCount`.
- `HomeViewModel`: injected `catalogApi + workApi`, loads offer products + recent estimates; setter-style toggle methods.
- `Routes.kt`: restored `Notifications`, `Cards`, `Visualizations` routes; added `CustomerEstimate`, `EstimatePdfPreview`.
- `DashboardData.referralCode` field added; `coreLibraryDesugaring` enabled for `java.time` on minSdk 24.
- 9 new API `@Provides` in `AppModule.kt`.

**v3.1.0 feature additions** (Apr 18, 7 APK builds):
- **Multi-product Cart** (`CartStore.kt`): `@Singleton`, DataStore JSON persistence (Gson), `CartItem` DTO (productId/packSizeId/name/brand/size/unit/imageUrl/rate/mrp/regularPoints/annualPoints/qty). Methods: add/updateQty/remove/clear. `CatalogScreen`: Gold ExtendedFAB with badge (bottom=88dp), `CartBottomSheet` + `CartRow`, snackbar at bottom=160dp (above FAB). "+" on product variant → add to cart.
- **Customer Estimate two-path flow** (`CustomerEstimateScreen.kt` + `CustomerEstimateViewModel.kt`):
  - Tab 1 "Ask Quality Colours" (default) — submit to admin with no markup (admin sets later).
  - Tab 2 "I'll Price It" — markup slider 0→MRP-cap per item, labour_charge field, always hide_qc_branding=true. Amber ⚠ warning when MRP not set.
  - Success: AlertDialog with "Open" (→EstimateDetail) + "Done" (pop to Catalog).
  - `CustomerPricingMode.ASK_QC / PRICE_MYSELF` enum.
- **`saved_direct` workflow**: New status on `painter_estimates`. Painter creates private estimate → shares PDF with customer → taps "Submit to Quality Colours" (gold button on EstimateDetail). `showSubmitDialog` AlertDialog: Customer billing | Self billing radio → `POST /me/estimates/:id/submit-to-admin` → `pending_admin`. Migration: `migrate-painter-saved-direct.js` (adds `saved_direct` to status enum).
- **Admin "Approve Base Only"** (`admin-painters.html`): `approveAsSelf(estId)` fn + button on `pending_admin`/`admin_review` customer estimates. `POST /estimates/:id/approve-as-self` strips markup, sets billing_type='self', status='approved' → annual points only.
- **In-app PDF preview** (`PdfPreviewScreen.kt`): `PdfPreviewViewModel` downloads PDF → `PdfRenderer` → list of Bitmaps (2× DPI). `LazyColumn` of `Image`. Share icon in PainterTopBar. Route: `Routes.EstimatePdfPreview`.
- **Share + Save PDF** (`EstimateDetailScreen.kt`): PDF row has Preview / Share / Save buttons. `sharePdf()` in VM: downloads to `cacheDir/shared/`, FileProvider URI, `ACTION_SEND` chooser. `inline` param on backend for in-app preview.
- **NotoSans ₹ fix**: `public/fonts/NotoSans-Regular.ttf` + `NotoSans-Bold.ttf` (550KB each). `painter-estimate-pdf-generator.js` registers as 'Body'/'Body-Bold', uses throughout. `hasNoto` guard for missing-font safety.
- **PDF hide_qc_branding**: When `hide_qc_branding=1`, PDF shows painter name/phone/city as header; suppresses QC logo, footer, company details. Labour charge line in summary.
- **MRP in catalog/estimates**: Backend `GET /me/catalog` + `/me/estimates/products` return `CAST(zim.zoho_label_rate AS DECIMAL) AS mrp`. `PackSize.mrp` added to DTO. Catalog shows "MRP ₹X" badge. Markup slider capped at `(mrp - rate) / rate * 100`.
- **Admin MRP column** (`admin-zoho-items-edit.html`): `label_rate` column (key='label_rate', zohoField='label_rate', visible=true). `routes/zoho.js` FIELD_MAP: `label_rate: 'zoho_label_rate'`.
- **AppLink referral share**: `assetlinks.json` at `public/.well-known/` with both `com.qcpaintshop.painter` + `com.qcpaintshop.act` SHA256. `AndroidManifest.xml`: `autoVerify=true` intent-filter for `https://act.qcpaintshop.com/r/*`. Share text uses `https://act.qcpaintshop.com/r/{code}`. `server.js` GET `/r/:code` → redirect to `/painter-register.html?ref={code}`.
- **Hero offer carousel** on Home: Reordered to Hero → Quick Actions → **Offer Carousel** → Stats. `OfferProductCard` 220dp hero, 150dp image panel, "Your price" 20sp green, ⭐ points pill.
- **Shared PainterTopBar** (`PainterTopBar.kt`): Gradient TopAppBar (`QCGreenLight→QCGreen→QCGreenDarkest`) + 2dp QCGold accent. Used across all 20 sub-screens.
- **Black ActionBar fix**: `android:theme="@style/Theme.QCManager"` on PainterMainActivity (was inheriting Splash theme without `installSplashScreen()`).
- **Offer carousel date fix**: Changed `end_date >= NOW()` → `DATE(end_date) >= DATE(?)` so whole-day dates don't expire at midnight.
- **Empty items fix**: `EstimateDetailResponse` now includes top-level `items: List<EstimateDetailItem>?`; VM merges into `estimate.items`.
- **Camera crash fix** (`EditProfileScreen.kt`): `cameraPermissionLauncher.launch(CAMERA)` before TakePicture on Android 6+.
- **Profile photo fix**: `ProfileUpdateResponse.photoUrl` field; VM saves to `UserPreferences` immediately after save.
- **Backend migrations**: `migrate-painter-cart-markup.js` (adds `hide_qc_branding`, `labour_charge`, `pricing_mode` to `painter_estimates`), `migrate-painter-saved-direct.js`.
- **`pdf-parse`** moved from devDependencies → dependencies (was causing MODULE_NOT_FOUND 502 on prod after `npm install --omit=dev`).
- **nginx vhost note**: Actual nginx binary is `/www/server/nginx/sbin/nginx -c /www/server/nginx/conf/nginx.conf`. Config at `/www/server/nginx/conf/vhost/act.qcpaintshop.com.conf` (NOT the aaPanel path `/www/server/panel/vhost/nginx/`).
- **Deployment**: All backend changes pushed and live at commit `8cb7524`. versionCode still 12, versionName 3.1.0 — Play Store upload pending smoke test.

### Painter Attendance AP System (Apr 20, 2026)

Full selfie-checkin + Annual Points earning system for painters. Deployed on master.

**4 new DB tables** (`migrations/migrate-painter-attendance.js`):
- `painter_attendance_checkins`: `painter_id, branch_id, checkin_date, checkin_at, selfie_url, lat, lng, status ENUM('pending','approved','rejected'), ap_awarded`. UNIQUE `(painter_id, checkin_date)`.
- `painter_attendance_monthly`: `painter_id, month_key, total_checkins, customer_billed_total, claim_pct, claimable_ap, ap_claimed, claim_status ENUM('pending','available','claimed','forfeited'), claim_window_opens_at, claim_window_closes_at, claimed_at`.
- `painter_attendance_ledger`: `painter_id, checkin_id, type ENUM('earn','claim','clawback','forfeit'), ap_delta`.
- `painter_attendance_clawback_pending`: holds pending clawbacks when AP balance insufficient.

**Service** (`services/painter-attendance-service.js`):
- `findNearbyBranches(lat, lng)` — haversine sort, returns branches within radius (default 1km, configurable). Branches with NULL GPS logged but skipped.
- `recordCheckin(painterId, branchId, selfieUrl, lat, lng)` — transactional: INSERT checkin, award `attendance_ap_per_checkin` AP to annual ledger, upsert monthly row. Duplicate guard via UNIQUE key.
- `claimMonth(painterId, monthKey)` — moves `claimable_ap` → actual annual points. Sets `claim_status='claimed'`.
- `openMonthlyClaim(monthKey)` — runs 1st of month 00:05 IST: computes `claim_pct` from customer bills, sets `claim_status='available'`, 7-day window, notifies painters.
- `recomputeClaimable(monthKey)` — runs every 6h on days 1-7: refreshes claimable AP if new customer bills arrive.
- `claimPct` formula: based on `customer_billed_total` tier thresholds in `ai_config` (`attendance_claim_pct_*` keys).

**Crons** (`services/painter-scheduler.js`):
- `0 5 0 1 * *` IST (00:05 on 1st): `openMonthlyClaim(prevMonth)`
- `0 0 */6 1-7 * *` IST (every 6h, days 1-7): `recomputeClaimable(currentMonth)`

**Routes** (`routes/painters.js`):
- `GET /me/attendance/nearby-branches?lat=&lng=` — painter auth, returns sorted nearby branches with distance.
- `POST /me/attendance/checkin` — painter auth, multipart (selfie image), lat/lng body. Calls `recordCheckin()`.
- `GET /me/attendance/month?month=YYYY-MM` — painter auth, returns monthly summary + claimable AP.
- `GET /me/attendance/history` — painter auth, paginated checkin history.
- `POST /me/attendance/claim` — painter auth, calls `claimMonth()`.
- `GET /attendance` (admin) — today's checkins with branch/date filter, reject action.
- `GET /attendance/monthly` (admin) — monthly summary across all painters, AP earned, claim status.
- `GET /attendance/:painterId/calendar` (admin) — monthly calendar for one painter.
- `POST /attendance/:checkInId/reject` (admin) — reject + clawback AP with message.
- `GET /attendance/nearby-branches?lat=&lng=&radius=` (admin, larger radius).

**Admin UI** (`public/admin-painters.html` — Attendance tab):
- Sub-tab "Today": date+branch filter, table of checkins with selfie thumbnail, approve/reject.
- Sub-tab "Monthly Summary": AP earned per painter, claim%, claimed status.

**Painter dashboard** (`public/painter-dashboard.html`):
- AP hero card: this-month check-ins, AP earned, claim preview %. When `claim_status='available'` → Claim button → `POST /api/me/attendance/claim`.

**Android** (`qcpaintshop-android`, painter flavor — `ui/attendance/`):
- `CheckInScreen.kt`: CameraX selfie capture (front camera) + GPS branch detection. Multipart upload.
- `AttendanceHistoryScreen.kt`: current-month card (check-ins, AP, Claim button), scrollable history rows.
- `AttendanceViewModel.kt`: Hilt-injected, loads month summary + history via `AttendanceApi`.
- `HomeScreen.kt` HeroCard: AP row with claim/checkin CTA. `HomeViewModel` extended.
- `AttendanceApi.kt`: 5 new endpoints (nearby, checkin, month, history, claim), `CheckinRequest`, `MonthSummary`, `CheckinRecord` DTOs.
- Route: `Routes.AttendanceHistory` → `AppNavigation`.

**Config keys** (`ai_config`):
- `attendance_ap_per_checkin`: AP earned per day (e.g. 100)
- `attendance_checkin_radius_km`: GPS tolerance (default 1.0)
- `attendance_claim_pct_tier1_bills`, `_pct1`, `_tier2_bills`, `_pct2` etc.
- `attendance_claim_window_days`: window length (default 7)

**Tests**: `tests/integration/painter-attendance-flow.test.js` — full checkin pipeline, duplicate guard, temp painter + afterAll cleanup.

**Key gotchas**:
- `DATE_FORMAT` generated column dropped for MariaDB compat — use `DATE(checkin_at)` instead.
- `branches` table must have `lat`/`lng` columns set for nearby detection; NULL GPS branches are skipped.
- `painter-attendance-service.setPool(p)` called in `painter-scheduler.setPool()` so pool is shared.
- Selfie upload uses `uploadProfile` multer config (already has memory storage).

---

### Admin FCM Notifications to Painters (Apr 20, 2026)

Admin can broadcast rich push notifications (image + custom MP3 sound) to filtered painter audiences.

**DB**: `migrations/migrate-admin-notifications.js` — `admin_notifications` table: `id, title, body, image_url, type, offer_url, audience_filter (JSON), sent_count, created_by, created_at`.

**Backend** (`routes/admin-notifications.js`):
- `POST /upload-image` — multer memory storage, saves to `public/uploads/admin-notif-images/`, returns URL.
- `POST /audience-count` — query builder returns painter count matching filter (brand, category, level, location).
- `GET /` — list past notifications with send stats.
- `POST /send` — resolves audience FCM tokens, calls `sendToDevices()` in 500-token batches, records to DB.
- `GET /:id` — get one notification detail.

**FCM** (`services/fcm-admin.js`): `sendToDevices(tokens, {title, body, imageUrl, type, offerUrl})` — uses `sendEachForMulticast` with 500-token batch cap enforced. Sends to `qc_admin_channel` on Android.

**Android** (painter flavor):
- `qc_admin_channel`: `NotificationChannel` with custom MP3 sound + offer tap routing.
- Guarded by `APP_TYPE` check so staff app doesn't register painter-only channel.
- Offer tap: notification `data.type === 'offer'` routes to Catalog screen with offer filter.

**Key gotcha**: painter `status` column is `'approved'` (NOT `'active'`). Audience query filters `WHERE p.status = 'approved'`.

---

### Admin Products UX — Mobile + Assign-to-Existing (Apr 21, 2026)

Two improvements to `public/admin-products.html`.

**1. Inline Assign to Existing Product** (from Zoho Import tab):
- New endpoint: `POST /api/products/assign-zoho-item` in `server.js`. Creates `pack_sizes` row + zoho mapping atomically. Validates product exists (active), zoho_item_id not already mapped. Accepts `product_id, zoho_item_id, size, unit, price` (+ `color_name, color_code` from B1 extension).
- JS utilities: `openAssignDropdown(zohoItemId, itemName, size, unit, price, anchorEl)` — floating div with product search input. `debounceAssignSearch` → `doAssignSearch` (hits `GET /api/products?search=&limit=8&status=active`). `confirmAssignZohoItem` — confirms + calls endpoint + refreshes view.
- `openGroupAssignDropdown(groupItems, anchorEl)` — assigns all unmapped items in a group at once.
- `extractSizeFromName(name)` / `extractUnitFromName(name)` — regex extracts `\d+\s*(L|KG|...)` from Zoho item names.
- Both flat view and grouped view show "Assign ▾" button on unmapped items.
- `escJS()` helper added — escapes single-quotes in JS onclick/oninput inline strings to prevent injection.

**2. Mobile-responsive layouts**:
- **Products tab**: `@media (max-width:767px)` hides `.products-table-wrap`, shows `.products-mobile-list` (card per product). Filter bottom drawer (`#filterDrawer`). Active filter chips. Mobile search + Filter ▾ + + Add buttons.
- **Zoho Import tab**: Hides `.zoho-table-wrap`, shows `.zoho-mobile-list`. Accordion grouped cards (yellow=unmapped, green=mapped). Collapse/expand per group. Mobile filter drawer (`#zohoFilterDrawer`). `toggleMobileGroup(gi)` + `selectAndImportGroup(ids)`.

---

### Color Variants B1 — Web (Apr 21, 2026)

Adds color/shade support to the product catalog.

**DB**: `migrations/migrate-pack-sizes-color.js` — adds `color_name VARCHAR(100) NULL` + `color_code VARCHAR(20) NULL` to `pack_sizes`.

**Service** (`services/color-extractor.js`): `extractColor(itemName)` → `{colorName, colorCode}` or null. 30+ color entries in `COLOR_MAP`. Multi-word colors (e.g. "Off White", "Sky Blue") matched before single-word via length-sorted key iteration. Regex: `(?:^|\s)colorKey(?:\s|$)` case-insensitive. Tests: `tests/unit/color-extractor.test.js` (10 tests).

**Backend**: `assign-zoho-item` endpoint extended to accept `color_name`, `color_code`. `PUT /api/products/:id` pack_size INSERT includes color columns. Both validate: `color_code` must match `/^#[0-9A-Fa-f]{3,8}$/`.

**Admin UI** (`public/admin-products.html`):
- Product edit modal: each pack size row shows color text input + `<input type="color">` circle picker + preview dot.
- Zoho Import assign flow: client-side `CLIENT_COLOR_MAP` + `extractColorFromItemName()` pre-fills color when item name contains a known color word. Confirm dialog includes color name: `"Add 1L White @ ₹280 to 'Product'"`.
- `doAssignSearch()` and `confirmAssignZohoItem()` signatures extended with `colorName`, `colorCode` params.

---

### Color Variants B2 — Android (Apr 21, 2026)

Surfaces color data in the Android painter app.

**Backend** (`routes/painters.js`): Both catalog list (`GET /me/catalog`) and product detail (`GET /me/products/:id`) now include `color_name` + `color_code` per pack size in response.

**Android data models**:
- `PackSize.colorName / colorCode` (`@SerializedName` mapped) — nullable String with default null.
- `ProductVariant.colorName / colorCode` — same.
- `CartItem.colorName / colorCode` — added to cart persistence model.

**CatalogScreen** (`ui/catalog/CatalogScreen.kt`):
- `parseColorSafe(hex)` — `runCatching { Color(android.graphics.Color.parseColor(hex)) }.getOrDefault(Color.LightGray)`.
- `ProductFamilyCard`: `distinctColors` list from `allVariants`. `selectedColorName` state (persisted in ViewModel via `setProductColor()`). `variants` filtered by selected color. Color swatch strip: row of 18dp circles, up to 5 + overflow count. Tap swatch → filter variants.
- Color state persisted in `CatalogViewModel` (`selectedColors: Map<Int, String>`) so it survives scroll-off-screen recomposition.
- `CartRow` subtitle: color dot (10dp circle) + `"ColorName · 1L"` format when color present.

**ProductDetailSheet** (`ui/catalog/ProductDetailSheet.kt`):
- `parseColorSafe` added.
- Color filter `LazyRow` inserted above variants table: "All" pill + one chip per color. `selectedColor` state. Filters variants list. Chip style: `Surface` with `QCGreenContainer` background when selected.

**EstimateCreateScreen** (`ui/work/estimates/EstimateCreateScreen.kt`):
- `CartItemRow` subtitle: color dot (10dp, `CircleShape`) + `"ColorName · 1L"` when `colorCode` / `colorName` present.
- **Color filter strip in expanded ProductCard (Apr 22)**: same design as `ProductDetailSheet`. `selectedColor` state (`String?`, null = All). `distinctColors` derived from pack sizes. `LazyRow` below divider with "All" chip + per-color chips (dot + name). Filters `sizes` list passed to `PackSizeRow`. Only shown when `hasColors == true`. `LazyRow` import added.

**CatalogViewModel**: `addToCart()` passes `colorName = packSize.colorName, colorCode = packSize.colorCode` to `CartItem`.

---

### Android Location Tracking — Painter Mode (Apr 21–22, 2026)

Extends `GeofenceLocationService` in the painter flavor to report painter GPS to the server.

**Changes** (`qcpaintshop-android`, painter flavor):
- `GeofenceLocationService`: When running as painter (detected via `APP_TYPE` or painter token presence), uses `X-Painter-Token` header and posts to `POST /api/painters/me/location-report` instead of the staff endpoint. Skips geofence enforcement (no clockout logic for painters — location only).
- `AuthViewModel` / login flow: `startGeofenceLocationService()` called on painter OTP verify. `stopGeofenceLocationService()` on logout.
- Service handles both staff auth (Bearer token) and painter auth (X-Painter-Token) via `APP_TYPE` check.

---

### Admin Painters UI/UX Redesign (Apr 21, 2026)

Complete overhaul of `public/admin-painters.html` from 10 flat tabs to a 2-level group+subtab nav.

**Nav architecture**: 4 group pills (People, Finance, Catalog & Comms, Location) each with 2-4 sub-tabs. `switchGroup(group)` shows/hides group pill bar and activates first tab. `switchTab(tabId)` is ID-based (no positional indexing). URL hash stores `?tab=<tabId>` for 14 tab IDs.

**Mobile-first changes per group**:
- **People → Painters tab**: Hybrid layout — mobile cards (flex, avatar initials, name/city/level badge, status chip, action button) below 768px; desktop keeps existing table. `renderPaintersMobile()` toggled by `window.innerWidth`.
- **Finance group**: Withdrawal tab → mobile cards with amount, status badge, request date, "View" action. Summary strip: pending count + pending amount. Sort label corrected to "Sort ▾".
- **Finance → Billing tab**: Responsive table with hidden columns on mobile (`data-mobile-hide` CSS).
- **Finance → Estimates tab**: Mobile cards — painter name, amount, status chip, date. Desktop table unchanged.
- **Catalog → Catalog tab**: Responsive table, horizontal scroll on mobile.
- **Catalog → Comms tab**: Responsive table, horizontal scroll on mobile.
- **Catalog → Offers tab**: Float-action-button (`+` FAB bottom-right) visible ONLY when offers tab is active (`tabChanged` hook shows/hides it). `#offers-fab` CSS class. Pool filter TODO noted in comment (painter_leads has no branch_id).
- **Location → Attendance tab**: Attendance summary strip (total clockins today, avg hours). Leaflet fleet map + route replay (see Location Tracking section below).

**Key learnings**:
- `switchTab()` refactored to ID-based lookup (`document.getElementById(tabId + '-tab')`) — old positional index approach broke when tab order changed.
- Finance badge count (`loadWithdrawals`) fixed — was referencing wrong element ID after rename.
- Offers FAB visibility: use a `tabChanged` custom event or inline show/hide in `switchTab` based on `tabId === 'offers'`.

---

### Painter Live Location Tracking (Apr 21–22, 2026)

Full location pipeline: painter app → backend → admin fleet map.

**DB**: `migrations/migrate-painter-location.js` — `painter_location_events` table: `id, painter_id (FK painters), lat DECIMAL(10,8), lng DECIMAL(11,8), accuracy FLOAT, recorded_at DATETIME, created_at DATETIME`. Index on `(painter_id, recorded_at)`. Nightly cron deletes rows older than 30 days.

**Backend** (`routes/painters.js`):
- `POST /me/location-report` — painter auth, 25s per-painter rate-limit (prevents GPS spam), validates lat/lng/accuracy, inserts `painter_location_events`, emits `painter:location` on Socket.io `admin-location` room. Body: `{ lat, lng, accuracy }`.
- `GET /locations/live` — admin auth (`painters.view`), returns all painters with their latest location event in the last 2 minutes (online) or last known (offline). Response: `{ online: [...], offline: [...] }`. Each entry: `id, full_name, lat, lng, accuracy, recorded_at, status`.
- `GET /:id/locations/history` — admin auth, query params `date` (IST date string, defaults today), returns time-ordered events for route replay. Includes `totalRouteMeters` (sum of haversine distances between consecutive points).

**Socket.io**: Server joins socket to `admin-location` room on `join-admin-location` event (requires valid session token check). Painter location pushes go to `admin-location` room via `io.to('admin-location').emit('painter:location', { painterId, lat, lng, accuracy, recorded_at })`.

**Nightly cron** (`services/painter-scheduler.js`): `0 2 * * *` IST — `DELETE FROM painter_location_events WHERE recorded_at < DATE_SUB(NOW(), INTERVAL 30 DAY)`.

**Unit tests** (`tests/unit/painter-location.test.js`): 7 tests covering IST date helper (today/custom/format) + haversine `totalRouteMeters` (zero points, one point, two points, multi-point, null coords).

**Admin UI** (`public/admin-painters.html` — Location → Attendance tab):
- **Fleet map** (Leaflet.js CDN, `leaflet@1.9.4`): Shows all painters on map. Online painters = green marker (circle), offline = grey. Popup: name, status (XSS-escaped with `escH()`), last seen time. Auto-refresh every 30s. `initFleetMap()` / `refreshFleetMap()`.
- **Route replay**: Date picker + painter selector dropdown (populated from `/locations/live`). "Load Route" fetches `/locations/history?date=YYYY-MM-DD`, draws polyline on map, shows distance. `loadRouteReplay()`.
- Map div: `id="fleet-map"`, fixed height 400px, initialized lazily on tab show.

**Key learnings**:
- XSS escape `loc.status` in fleet map popup — status comes from DB but must be escaped. `escH(loc.status)` not `loc.status` directly.
- Leaflet needs explicit height on container div, and `map.invalidateSize()` after tab becomes visible (map renders 0px otherwise).
- Socket.io `join-admin-location` event: authenticate via session token before joining room to prevent unauthorized fleet tracking.
- Rate-limiting painter location reports: use per-painter key (`painter:loc:<painterId>`) in the rate limiter store, not global IP — painters share IPs on mobile networks.

---

---

### Painter Android Bug Fixes — v3.1.4 + v3.1.5 (Apr 22, 2026)

#### admin-products.html null reference fix
`addPackSize()` called `document.getElementById('newPackUnit').value = 'L'` after the chip-UI replacement removed that `<select>`. Fixed by replacing the null-reference line with `document.getElementById('gstBreakdownPreview').style.display = 'none'`.

#### pack_sizes.unit ENUM→VARCHAR migration
Production DB had `unit ENUM('L','KG','M','PC')`. Custom units like "NUMBER" caused "Data truncated for column 'unit'" error. Fix: `ALTER TABLE pack_sizes MODIFY COLUMN unit VARCHAR(20) DEFAULT 'L'`. Server code: `String(pack.unit || 'L').toUpperCase().substring(0, 10)` — no ENUM sanitization.

#### zoho_item_id preservation on product save
`PUT /api/products/:id` DELETE+reinserts all pack_sizes. Without a snapshot, re-inserted rows have `zoho_item_id = NULL`, making them invisible to painter catalog (`WHERE ps.zoho_item_id IS NOT NULL`). Fix: snapshot `{size → zoho_item_id}` before DELETE, restore on re-insert via `savedZohoMap[parseFloat(pack.size)]`.

#### EstimateCreate brand/category filter (v3.1.4)
**Problem**: Filter selected brand name string → server `WHERE b.id = 'Asian Paints'` → MySQL coerced to 0 → no matches.

**Fix**: `EstimateCreateViewModel.loadProducts()` sends `brand = state.selectedBrand?.id?.toString()`. Server:
```javascript
const brandId = parseInt(brand, 10);
if (!isNaN(brandId) && brandId > 0) { where += ' AND b.id = ?'; params.push(brandId); }
else { where += ' AND b.name = ?'; params.push(brand); }
```
Same pattern for category. `FilterOption(id, name)` — always use ID for server queries.

#### EstimateCreate color variants (v3.1.5)
`GET /me/estimates/products` was not returning color info. Three-part fix:

1. **Server** (`routes/painters.js`): Add `ps.color_name, ps.color_code` to SELECT; include in `pack_sizes.push()`.
2. **ViewModel**: `addToCart` passes `colorCode = packSize.colorCode, colorName = packSize.colorName` to `CartItem`.
3. **Screen**: `PackSizeRow` shows 12dp color dot + `"ColorName · 1L"` label matching Catalog style.

### Audit-Driven Reliability & Perf Sprint (Apr 30 – May 1, 2026)

Triggered by an external code-audit report covering the act.qcpaintshop.com codebase. Audit identified 4 U-CRITICAL bugs + 24 U-items (upgrades) + 12 D-items (design/UX). 11 items shipped over two days; remainder queued.

#### U-CRITICAL-1: Customer auth tokens now persisted server-side (`27572ca`)
The previous customer flow stored only `customer_logged_in=true` in localStorage, which any browser tab could fake. Replaced with proper Bearer-token sessions:
- `migrations/migrate-customer-sessions.js` creates `customer_sessions(id, token_hash CHAR(64) UNIQUE, customer_id, phone, expires_at, revoked_at, ip_address, user_agent, created_at)` — SHA-256 hashed token, 30-day TTL.
- `services/customer-auth.js` exports `createSession`, `resolveSession`, `revoke`, `revokeAllForPhone`.
- `middleware/customerAuth.js`: `requireCustomerAuth` reads Bearer header, populates `req.customer = { id, phone }`.
- `server.js`: `/api/customer/auth/verify-otp` calls `createSession` and returns the raw token; new endpoints `/api/customer/auth/logout`, `/api/customer/auth/me`, `/api/customer/me/requests`, `/api/customer/me/requests/:id`, `/api/customer/me/estimates/:id` all derive phone from session.
- `public/customer-dashboard.html` migrated to send `Authorization: Bearer <token>` and call `/api/customer/me/*`. **Pending**: migrate `customer-requests.html`, `customer-estimate-view.html`, `customer-login.html` to the same pattern.

#### U-CRITICAL-2: DPL-match endpoint moved into routes/zoho.js (`5f1dd92`)
Previously registered at `server.js:3740` AFTER the `globalErrorHandler`, so any throw inside the handler bypassed the standard error-response shape. Moved to `routes/zoho.js` as `router.get('/dpl-match-report', requireAuth, …)` so errors flow through the global handler.

#### U-CRITICAL-3: Painter points table-name collision fixed (`bf22da9`)
`services/painter-points-backfill-service.js` had 3 raw `INSERT INTO painter_points_transactions` (plural). Actual table is `painter_point_transactions` (singular) — those INSERTs were silently failing on the production schema. Replaced all three with `pointsEngine.addPoints(painterId, 'annual', …, 'invoice_backfill', \`ZINV-…-direct\`, …)` so the canonical engine dedupes via the engine's own checks. Updated 4 jest tests to mock `painter-points-engine` and assert `addPoints.mock.calls`. All pass.

#### U-CRITICAL-4: Token-based forgot-password flow (`5e283c5`)
Previous flow overwrote the user's real password with a 4-byte hex temp value and emailed it in plaintext — anyone with email access permanently owned the account. Replaced with industry standard:
- `migrations/migrate-password-reset-tokens.js` creates `password_reset_tokens(id, user_id, token_hash CHAR(64) UNIQUE, expires_at, used_at, requested_ip, requested_ua, created_at)`.
- `POST /api/auth/forgot-password` issues a SHA-256 hashed token (raw token only in email link), 1h expiry, generic response (no user-existence leak).
- `GET /api/auth/validate-reset-token?token=…` checks expiry/used_at.
- `POST /api/auth/reset-password` is transactional: bcrypt new password, mark `used_at`, invalidate all `user_sessions` for that user.
- `public/reset-password.html` reads `?token=` from URL, validates, then accepts new password. Existing `forgot-password.html` rewired to the new endpoint.

#### U6: Tailwind JIT build pipeline (`3eae6f3`)
Replaced the `<script src="https://cdn.tailwindcss.com">` runtime tag (CSP-hostile, slow first paint, 3+MB unminified JS) with a build-time CLI. `tailwind.config.js` content globs `./public/**/*.html`, `./public/**/*.js` plus a generous safelist regex for the dynamic class strings built in JS `innerHTML` blocks. `src/tailwind-input.css` has `@tailwind base/components/utilities`. `npm run build:css` produces `public/css/tailwind.css` (~951KB minified). `npm run watch:css` for dev. **Migrated 2 demo pages** (`forgot-password.html`, `reset-password.html`) to `<link rel="stylesheet" href="/css/tailwind.css">`. **Pending**: migrate the remaining 105 HTML pages page-by-page, then prune the safelist.

#### U12: Audit log infrastructure (`4c1e3c4`, renamed `d3ef92a`)
- `migrations/migrate-audit-log.js` creates `audit_records` table (renamed from `audit_log` to avoid colliding with a pre-existing legacy table that has 4 rows from Feb 2026 with a totally different schema; legacy untouched).
- Schema: `id, ts, user_id, actor_type, action, entity_type, entity_id, before_json LONGTEXT, after_json LONGTEXT, ip, user_agent, request_url`.
- `services/audit-log.js` exports `record(req, {action, entity_type, entity_id, before, after})` with `SENSITIVE_KEYS` redaction (password_hash, otp, *_token, secret, etc.) and swallow-on-error so audit failures never block the user-facing path. `query(filters)` for admin browsing.
- `routes/billing.js` records `billing.estimate.cancel` on DELETE. `routes/system.js` exposes `GET /api/system/audit-log` (admin-only, queryable).
- **Pending**: instrument painter withdrawal approve/reject (`routes/painters.js`), salary payments (`routes/salary.js`), credit-limit state changes, billing PUT estimate/invoice items (added in U18).

#### U17: Idempotency keys on financial POSTs (`95f7234`)
Mobile clients on flaky networks would retry POSTs and create duplicate estimates/invoices/payments. Added:
- `migrations/migrate-idempotency.js` creates `idempotency_records(id, key_hash CHAR(64) UNIQUE, scope, user_id, actor_type, response_status, response_body LONGTEXT, request_url, created_at, expires_at)` — 24h TTL.
- `middleware/idempotency.js` exports `idempotent(scope)` factory. Reads `Idempotency-Key` header (≤128 ASCII), stores SHA-256(scope + ':' + key) so different routes can use the same client UUID without collision. Wraps `res.json()` to capture first 2xx/4xx response. **5xx is NOT stored** so transient errors remain retriable. Backward-compatible: no header = no caching.
- `public/js/idempotency-fetch.js` provides `qcIdempotencyKey()` UUID generator + `qcWithIdempotency(key, headers)` helper. One UUID per submit-button click; reuse on retry.
- Wired into 11 financial POSTs:
  - `routes/billing.js`: POST `/estimates`, `/invoices`, `/invoices/:id/payment`
  - `routes/painters.js`: POST `/me/withdraw`, `/me/estimates`, `/me/estimates/:id/payment`
  - `routes/estimates.js`: POST `/`, `/:id/record-payment`
  - `routes/vendors.js`: POST `/payments`
  - `routes/salary.js`: POST `/payments`
  - `routes/credit-limits.js`: POST `/requests`
- `tests/unit/idempotency.test.js`: 6 jest tests (passthrough, malformed key, replay, store on first hit, skip-on-5xx, scope isolation). All pass.

#### U18: Soft-delete on financial sub-rows (`50aa975`)
Updating an estimate or invoice used to hard-DELETE the existing line items then re-INSERT — history was destroyed irrecoverably. Now soft-delete:
- `migrations/migrate-soft-delete-financial-items.js` adds `deleted_at TIMESTAMP NULL` + `idx_<table>_deleted_at` to `billing_estimate_items`, `billing_invoice_items`, `painter_estimate_items`, `estimate_items`. Uses `ALGORITHM=INPLACE LOCK=NONE` on MariaDB 10.11.
- 6 write paths converted: `routes/billing.js` PUT `/estimates/:id` and PUT `/invoices/:id`, `routes/painters.js` (self-billing edit + admin markup), `routes/estimates.js` PUT `/:id` (parent DELETE handler unchanged because FK ON DELETE CASCADE handles items).
- 22 read paths gain `WHERE deleted_at IS NULL` filter across `routes/billing.js`, `routes/painters.js`, `routes/estimates.js`, `routes/share.js`, `server.js` (customer estimate detail), `services/billing-zoho-service.js` (Zoho push).
- Pairs with U12: billing PUT `/estimates` and PUT `/invoices` now record before/after item arrays via `auditLog.record()`. Disputes about quantities or prices are now resolvable.

#### U7: Composite indexes on hot query patterns (`61341f5`)
`migrations/fix-missing-indexes.js` (Feb 2026) added 7 single-column indexes; this adds the 12 composite indexes the audit identified as still missing. Each index matches a specific WHERE/ORDER pattern in code:
- `staff_attendance(user_id, date)` — used everywhere
- `painter_estimates(painter_id, status, created_at DESC)` — painter dashboard list
- `painter_estimates(status, created_at DESC)` — admin list
- `painter_point_transactions(painter_id, created_at DESC)` — running balance / history paging
- `leads(branch_id, status, next_followup_date)` — followup queue
- `leads(assigned_to, status)` — per-staff isolation
- `zoho_invoices(local_branch_id, invoice_date)` — branch dashboard
- `zoho_payments(local_branch_id, payment_date)` — branch dashboard (skipped on prod — `local_branch_id` column missing, schema drift)
- `staff_tasks(assigned_to, status, due_date)` — pending/overdue widgets
- `notifications(user_id, read_at, created_at DESC)` — unread feed
- `ai_messages(conversation_id, created_at DESC)` — chat paging
- `painter_attendance_checkins(painter_id, checkin_date)`

Migration uses `ALGORITHM=INPLACE LOCK=NONE` with fallback to default for engines that reject it. Each index is gated on table+column existence (`INFORMATION_SCHEMA.STATISTICS`, `INFORMATION_SCHEMA.COLUMNS`) so the migration is idempotent and safe across schema drift. **Prod result: 9/12 added** (3 skipped — already present from earlier work or pre-existing schema drift). EXPLAIN confirms `painter_estimates` queries now use `idx_pe_painter_status_created` with covering index ("Using index").

#### D5: Skeleton loaders + empty-state primitives (`0f82d32`)
- `public/css/skeletons.css` — `.qc-skel-shimmer` keyframes + base classes.
- `public/js/ui-skeletons.js` — `qcSkeletonRows(target, count)`, `qcSkeletonCards(target, count)`, `qcSkeletonStats(target, count)`, `qcEmptyState(target, {icon, title, subtitle, action})`. Designed for incremental adoption — pages can swap in skeletons with one helper call.

#### D6: qc-ui primitives — toast, modal, sheet, chip (`76727c6`)
- `public/css/qc-ui.css` — animations, brand-aware buttons.
- `public/js/qc-ui.js` — `qcToast(msg, {type, duration})`, `qcConfirm({title, message, confirmText, danger})` (Promise-based), `qcAlert`, `qcSheet({title, contentHTML, actions})`, `qcChip(label, options)`. Replaces ad-hoc `alert()`/`confirm()` calls scattered across the codebase.

#### Self-Heal db_pool_test backoff (`706dad6` — preventive, before audit)
`services/production-monitor.js` `healDbPool()` was retrying every 60s on `Access denied`-class failures, flooding `pm2 logs`. Added `state.lastDbPoolTestFailureAt` and `lastDbPoolTestSuccessAt` with 5-min cooldown after failure + 1-min after success.

#### Operational findings worth carrying forward
- **Prod `_migrations` tracking gap**: only Apr 30+ entries logged. Older migrations physically applied but unlogged. `node migrate.js --status` shows ~80 PENDING falsely. Workaround: run new migrations via `node -e "…m.up(p)…"` then `INSERT IGNORE INTO _migrations`. **Long-term fix**: build `node migrate.js --mark-existing-from-schema` that introspects `INFORMATION_SCHEMA` and back-fills the tracker. See [reference_prod_migrations_gap.md](memory/reference_prod_migrations_gap.md).
- **Schema drift discovered**: `zoho_payments.local_branch_id` is missing on prod (present on `zoho_invoices`). Audit assumed both have it. Worth adding for symmetric branch filtering.
- **Pre-existing `audit_log` legacy table** has totally different schema (table_name/record_id/old_value/new_value/ip_address/timestamp from Feb 2026, 4 rows). New table renamed to `audit_records` to avoid conflict.

#### Queued for next session

Recommended next batch:
- **U10** XSS hardening — replace `innerHTML` with safe DOM helpers (partial sweep already done across 10+ pages with `esc()` helper).
- **U13** Structured logging via pino + request IDs — would massively speed up Hetzner debugging.
- **U2** ESLint + Prettier + EditorConfig + husky pre-commit hook — DX foundation, catches bugs before commit.

Other open U-items: U1 (extract 91 inline routes from server.js), U3 (consolidate session resolver), U4/U5 (slow-query log + SELECT * cleanup), U8 (catalog/brand result cache), U9 (Zod coverage), U11 (remove inline event handlers), U14 (circuit breaker), U15/U16 (DB pool backoff polish), U19 (admin TOTP 2FA), U20 (CSV/Excel export shared service), U21–U24 (UX polish + TS migration).

Open D-items: D1 admin dashboard refresh, D2 mobile clock-in flow, D3 painter polish, D4 estimate-create wizard, D7 onboarding, D8 card preview, D9 sidebar, D10 dark mode, D11 saved views, D12 mobile bottom nav.

---

### 2026-05-08 → 2026-05-09 — DPL Extraction Overhaul (Birla Opus)

Two-spec brainstorm → plan → subagent-driven-development cycle fixing Birla Opus DPL upload accuracy. All shipped to production and smoke-tested against the Feb 2026 BirlaOpus-DPL PDF.

**Specs**: `docs/superpowers/specs/2026-05-08-birla-opus-dpl-naming-design.md`, `docs/superpowers/specs/2026-05-08-dpl-price-size-mapping-design.md`
**Plans**: same dates under `docs/superpowers/plans/`

#### Spec 1 — Birla Opus naming (commits 96b7914 → dd2efff, 9 commits)

**Bug**: `computeProposedFields` produced `ESWT01 ESWT EVER STAY BIRLA OPUS 01 L` (duplicate WT prefix) and lost colors for enamels because variant suffix splitter was shared with emulsion. Also: `proposed_sku = skuPrefix + packCode` mangled ml-pack SKUs (`CME500` → `CME550M`).

**Fix**: 5 new helpers (`isEmulsionCategory`, `isEnamelCategory`, `extractEmulsionProductName`, `extractEnamelProductAndColor`, `stripDuplicateSkuPrefix`) + `buildBirlaName` template builder in `services/price-list-parser.js`. `computeProposedFields` Birla Opus branch rewired to call `buildBirlaName`. Task 9 (`dd2efff`) preserved `currentSku` verbatim as `proposedSku` (drops legacy auto-correct that mangled ml-pack SKUs); description prefix now derived via `stripPackSuffixForDescription`.

**UI** (commit 9340f68): `admin-dpl.html::renderProposedNameCell` — Proposed Name cell now always renders an editable input; "same" badge appears beside it when equal to current name (gray border) instead of replacing the input with `— same` placeholder.

**Naming rules** (canonical, see `feedback_birla_opus_naming_rules.md` in user memory):
- ALL CAPS, brand always `BIRLA OPUS`, tier word kept (STYLE/CALISTA/ONE), pack zero-padded (`01 L`/`200 ML`).
- Emulsion: `{SKU} {PRODUCT_VARIANT_STRIPPED} BIRLA OPUS {PACK}`. Variant (White/Pastel/Mid Tone/Clear/Yellow/Red) stripped — base info encoded in SKU's middle digit.
- Enamel: `{SKU} {PRODUCT_BEFORE_DASH} ENAMEL {COLOR} BIRLA OPUS {PACK}`. Color preserved.
- Other Birla categories (Primer/Wood/Construction/Colorant) → DEFERRED, currently fall through to emulsion format.

**Tests**: `tests/unit/dpl-naming.test.js` (45 tests including 5 ml-pack proposed_sku regression checks).

#### Spec 2 — DPL price→size mapping (commits 1f024a1 → 0abb922, 4 commits)

**Bug**: `routes/zoho.js` AI parse job was flattening `parseBirlaOpus` `_prices` arrays via `TYPICAL_PACKS[i+2]` shifted-index hack, producing wrong sizes (`1L/4L/9L/10L` for any 4-price row). This bypassed the rate-anchored expansion in `matchWithZohoItems` (lines 1100-1254) that uses Zoho catalog rates as ground truth.

**Fix** (`eb1bee3`): Strategy A in `routes/zoho.js` (~lines 5025-5181) preserves `_prices` arrays. Two-pool merge (Pool A: traditional with `_prices` always wins; Pool B: AI flat rows for products NOT in `tradProductSet`). Sanitize handles both shapes. `itemsOut` now built from `matchResult.matched + matchResult.unmatched` (post-expansion individual rows). Removed `mergedMap`/`matchedByKey`/`TYPICAL_PACKS` constants.

**Telemetry fix** (`877f52c`): caught by review — dangling `matchedByKey.size` reference in success-job telemetry would have made every successful AI parse job land as `status='error'`. Replaced with `matchResult.matched.length`.

**Overflow handling** (`0abb922`): caught by smoke test — when PDF has more prices than Zoho family slots, the surplus is at the SMALL end (PDF lists 200ml that Zoho doesn't catalog as separate SKU). `matchWithZohoItems` rate-anchored block now drops the smallest excess prices to `unmatched` (with `_reject_reason: "Extra small price in PDF row — Zoho family has N sizes, PDF row has M (likely a smaller size missing from Zoho catalog)"`) and aligns the remaining largest prices ascending to the family.

**Smoke-test results on production** (Feb 2026 PDF, real Zoho catalog):
- One Pure Elegance Pastel: `1L=₹484, 4L=₹1,902, 10L=₹4,740, 20L=₹9,390` ✓ (₹104 / 200ml unmatched, no SKU in catalog)
- One Pure Elegance Mid Tone: `1L=₹477, 4L=₹1,881, 10L=₹4,661, 20L=₹9,233` ✓
- One Pure Elegance Clear: `1L=₹418, 4L=₹1,643` ✓
- One Pure Elegance White: 0 matched (no WT-base SKUs in catalog → 4 rows go to NEW ITEM workflow as expected)

**Tests**: `tests/unit/dpl-price-size.test.js` (7 tests pinning rate-anchored expansion + overflow drop).

#### Quick wins (`3fdc935`, `24ef197`)

- **DPL > rate × 1.5 advisory warning** in `matchWithZohoItems`: catches AI mislabeling where a larger pack's price lands on a smaller-pack SKU (e.g. `AWMT01L` getting 5L's ₹792 DPL vs rate ₹212 = 3.7×). Counterpart of existing `DPL < rate × 0.25` warning. Both add to `out._warning` and surface as the ⚠ icon already wired in `admin-dpl.html`.
- **`admin-zoho-items-edit.html`**: flipped existing `dpl_updated_at` column to `visible: true` by default. Data already stamped by the `/dpl-apply` path.
- **Stats counts fix**: `totalExtracted` now counts `itemsOut.length` (post-expansion total = matched + unmatched) instead of `cleanItems.length` (input products, one per `_prices` array). Also exposes `needsReview` explicitly. Old code produced negative `Needs Review` because `cleanItems.length - matched.length` went < 0 when `_prices` expansion produced more matched rows than input items.

#### Deferred (next session candidates)

1. Non-emulsion Birla products (Allwood Melamine Thinner / Primer / Putty / Construction Chemicals / Wood Polish) — AI mislabels sizes because `parseBirlaOpus` only catches emulsion-shaped rows. Fix path: extend traditional parser to non-emulsion families OR teach AI prompt about sparse-column patterns per category.
2. Other brands DPL extraction (Asian / Berger / Gem / JSW / Nippon) — each has its own brand-specific parser, all weaker than Birla Opus.
3. Surface "no DPL update available" rows for Zoho SKUs whose size isn't in PDF (e.g., `ADSS10` 10L Salt Seal — Zoho doesn't have that SKU but if it did, PDF doesn't list 10L for Salt Seal so currently silent).
4. `stripPackSuffixForDescription` greedy regex on 99-base SKUs (`TL9920` → `TL9` instead of `TL`) — affects only `proposed_description` advisory field. Final reviewer flagged as follow-up not blocker.

### Birla Opus colorant matcher fixes (2026-05-13)

Series of 3 commits that hardened `services/price-list-parser.js::matchWithZohoItems` against the all-letter OPCL-family colorant SKUs (OPCLWT, OPCLBL, OPCLOR, OPCLMG, OPCLVI, OPCLGR, OPCLINY, OPCLINR, OPCLRO, OPCLYO, OPCLEXR, OPCLEXY, OPCLEXHR, OPCLEXHDY, OPCLSWT). These SKUs lack digits, so `parseSkuStructure` returns null and they fall out of `zohoBySku` → Strategy 0 misses → keyword-fallback (Strategy 2) decides → wrong items win on order or HD/non-HD confusion.

- **`0707c97`** — `cleanZohoName(name, sku)` now drops the leading token when it equals the item SKU verbatim (catches all-letter SKUs the digit pattern misses + long compound SKUs like `CSTDOR01` that exceed the {1,4}-letter prefix limit). Strategy 2 gets an exact-name bonus (+100) when `entry.cleaned === pdfProductBase`, so `EXT. YELLOW` beats `EXT. HD YELLOW` and `WHITE` (OPCLWT cleaned) beats `AP APEX ULTIMA BR WHITE`.
- **`bfea973`** — Strategy 0b also picks exact-name on multi-hit. Without this, "Black" → pdfAbbrev "B" still tied between OPCLBL (cleaned `BLACK`) and K2 BITUCOAT (cleaned `BITUCOAT`) and the first-encountered won. `hits[]` now holds family entries (with `.cleaned`) instead of bare zi objects so the exact-name comparison runs without recomputing cleanZohoName.
- **`45d198a`** — Hard brand scope: items with empty `brand` AND no BIRLA/OPUS/ASIAN/BERGER/NIPPON/JSW keyword in their name are now dropped from scope when the PDF brand is asserted. The previous "truly unknown brand — keep" hedge let 197 legacy items (K2 BITUCOAT, AP APEX, GERMAN YELLOW OXIDE, etc.) bleed into Birla Opus matching. Behaviour change: when no genuine brand-scoped match exists (e.g. "Blue COLORANT" with no OPCL-blue in catalog), the row now lands in `unmatched` instead of confidently picking a wrong cross-brand item.

Tests: 5 colorant matcher tests + 1 Black-vs-BITUCOAT + 1 Blue-no-match in `tests/unit/dpl-price-size.test.js`. Full suite: 97/97 passing.

### admin-dpl: inline brand+category editor for Zoho-uncovered rows (2026-05-13)

`ecd2323` + `9f09462`. The "Zoho uncovered" view (DPL paste step 2, View dropdown → "Zoho uncovered (N)") was read-only. Now each uncovered row has:

- Checkbox + Brand `<select>` + Category `<select>` (inline edit, no modal).
- Auto-suggestion when brand/category is empty — heuristics in `suggestUncovBrand` / `suggestUncovCat` mirror the matcher's brand-fallback (`BIRLA/OPUS → BIRLA OPUS`, `COLORANT/ENAMEL/EMULSION/PRIMER/PUTTY/STAINER/…` → matching category). Suggested values render with a yellow tint, edited values with an amber border.
- "Push N selected to Zoho" button in the warning banner — pushes via existing `/api/zoho/items/bulk-edit`, which optimistically stamps `zoho_brand` + `zoho_category_name` on the local mirror so the next DPL paste's matcher correctly scopes these items. The Zoho-side update is queued in the bulk-job worker.
- Dropdowns populated from the full distinct-brand and distinct-category list (`GET /api/zoho/stock/filter-options`) — not just the PDF's brand-scoped subset — so admin can assign any catalog brand/category to an uncovered row. Cached as `aiAllBrands` / `aiAllCategories`; merged into `aiZohoBrands` / `aiZohoCategories` on Step-2 entry.

State persists on `aiData._uncovEdits` keyed by `zoho_item_id`. After a successful push the local mirror is patched in-place so the changed indicator clears without a full reload.

### Phase 1-3 shipping roadmap (2026-05-13)

User session goal: drive web + both Android flavors to "production-ready, Play-Store-published, no known P0/P1 issues" bar. See memory `project_phase1_shipping_2026_05` for the full roadmap state.

**Phase 1 (ship-blockers) — Done except E2E:**
- Staff v3.3.9 vc18 → Play Store internal track + Telegram chat 930726256 (APK).
- Painter v3.3.0 vc32 → Play Store internal track + Telegram chat 930726256 (APK).
- Web security hardening (OTP, SMS HTTPS, otpLimiter, token hashing, helmet, setImmediate forgot-password) — verified already shipped pre-2026-05.

**Pending (user-side):** device E2E on real Android (both APKs in Telegram). After pass, promote internal → production: `node publish-to-play.js production` + `node publish-painter.js production`.

**Phase 2 (web hygiene sprint):** Tailwind CDN → JIT migration on 104 pages, mobile/a11y, audit-log coverage extension, U10/U13/U2 queued audit items, 89 PENDING migrations.

**Phase 3 (painter Android Epsilon B-L):** 11 remaining screen redesigns per `qcpaintshop-android/PAINTER-UX-AUDIT-2026-05-01.md`. Ship in 3 chunks via Telegram + version bumps.

**Phase 4-6 (deferred):** customer portal invoices, anomaly notification badge, bug-reports AI fix loop, painter visualization auto-trigger, 2FA admin, DPL other-brand parsers, design-system token migration, print/PDF CDN migration.

### Play Store publishing — gotchas hit 2026-05-13

1. Version code must be unique across the package's history on Play Store; uncommitted uploads also burn the version code. Bumped staff vc17 → vc18 after a "Version code 17 has already been used" rejection. See memory `reference_play_store_publishing`.
2. `changesNotSentForReview: true` is now rejected by the Play API. Removed from `google-services/publish-to-play.js`. (`publish-painter.js` never had it.)
3. Release notes max 500 chars per language. Painter notes initially landed at 556 chars and got rejected; trimmed in `publish-painter.js`.

---

*This document should be updated whenever new features are added or existing ones are enhanced.*
*Last Updated: 2026-05-13 | Version: 3.3.9 vc18 (Staff internal), 3.3.0 vc32 (Painter internal) | Maintained by: Development Team*
