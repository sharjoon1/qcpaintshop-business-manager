# QC Paint Shop Business Manager - System Skills & Capabilities

> **Platform**: act.qcpaintshop.com
> **Version**: 3.3.0
> **Last Updated**: 2026-02-17
> **Total Codebase**: ~20,000+ lines (server) | 80+ frontend pages | Android app (2 flavors)

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
| **AI Models** | Google Gemini 2.0 Flash (img2img) + Pollinations AI Flux (text2img) |
| **Accounting** | Zoho Books API (OAuth 2.0) |
| **SMS Gateway** | NettyFish (DLT-compliant, Indian regulations) |
| **Email** | Nodemailer (SMTP) |
| **Push Notifications** | Web Push (VAPID) + Firebase Cloud Messaging (FCM) |
| **Mobile Apps** | Android (Kotlin, WebView hybrid, 2 flavors) |
| **Process Manager** | PM2 |
| **Server** | Ubuntu Linux (161.97.114.189) |

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

---

### 2.7 Product & Catalog Management

**Products**
- Full CRUD with brand/category association
- Product types: area_wise, unit_wise
- Pack sizes with per-size pricing
- GST percentage configuration
- Area coverage specification
- Guest visibility toggle
- Searchable dropdowns for brand/category
- Pages: `admin-products.html`, `admin-brands.html`, `admin-categories.html`

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
- **Auto-clockout tracking**: `auto_clockout_type` (geo/max_hours/admin/end_of_day) and `auto_clockout_distance` columns on attendance record
- **10 PM end-of-day force clock-out**: cron at 21:59 IST auto-clocks out all staff, ends active breaks/prayer/outside work, notifies via Socket.io
- Late detection (configurable threshold per branch, shop opens 08:30 AM)
- Work hours calculation

**Overtime Tracking**
- After expected hours (e.g., 10h weekday, 5h Sunday), staff gets overtime prompt (NOT auto-clocked-out)
- Modal: "Continue Overtime" (acknowledges, enters overtime mode) or "Clock Out Now"
- Server checks every 5 minutes + Socket.io `overtime_prompt` event for real-time notification
- Frontend polls `GET /check-overtime-status` every 2 minutes as backup
- On acknowledge: `overtime_acknowledged = 1`, `overtime_started_at` recorded
- On clock-out: `overtime_minutes = max(0, total_working - expected_hours * 60)` computed and stored
- Force clock-out at 10 PM: `force_clockout` Socket.io event + 10-second countdown modal
- Staff dashboard: amber "OVERTIME MODE" badge when in overtime
- Endpoints: `GET /check-overtime-status`, `POST /acknowledge-overtime`
- Columns: `overtime_minutes`, `overtime_started_at`, `overtime_acknowledged`, `overtime_acknowledged_at`
- Admin timeline: shows overtime minutes in summary stats
- Reports tab: overtime column highlighted in amber
- WhatsApp report: includes overtime line when > 0
- Migration: `migrations/migrate-overtime.js`
- Pages: `staff/clock-in.html`, `staff/clock-out.html`

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

**Daily WhatsApp Attendance Reports**
- Auto-sends daily attendance summary to all staff at 10 PM IST via `node-cron`
- Manual send: admin can send to individual staff or all staff from "Daily Reports" tab
- Report includes: clock in/out, time breakdown (Shop, Outside, Prayer, Break), total working, status
- Sent via WhatsApp session manager (branch session → fallback)
- Logged in `attendance_daily_reports` table (unique per user+date, upserts on resend)
- Admin UI: Daily Reports tab in admin-attendance.html with date/branch filter, per-staff Send/Preview, bulk Send All
- Real-time: Socket.io `report_send_progress` and `report_send_complete` events to admin
- Service: `services/attendance-report.js` (generateReport, sendReport, sendAllReports, 10 PM cron)
- Endpoints: `GET /report/preview`, `POST /report/send`, `POST /report/send-all`, `GET /report/staff-list`
- Migration: `migrations/migrate-prayer-and-reports.js`

**Permission Requests**
- Staff can request permissions: late_arrival, early_checkout, extended_break, leave, half_day, re_clockin, outside_work
- Admin approval/rejection workflow with `review_notes` column
- DB columns: `approved_by`, `approved_at`, `rejection_reason`, `review_notes`
- Notification sent to staff on approval/rejection (via `user_id` + `request_type`)
- **Re-clock-in request**: After clock-out, staff can request overtime. Admin approves → `allow_reclockin = 1` → staff clocks in again creating new attendance record
- Page: `staff/permission-request.html`

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
- Per-user salary config: base_salary, HRA, DA, TA, other allowances
- Deductions: PF, ESI, professional_tax
- Per-day rate calculation
- Overtime rate configuration
- Page: `admin-salary-config.html`

**Monthly Salary Calculation**
- Auto-calculation based on attendance data
- Present days, absent days, late days, overtime hours
- Gross salary = base + allowances
- Net salary = gross - deductions - advances
- Adjustments (bonus, penalty, custom)
- Individual and bulk calculation
- Status: calculated -> approved -> paid
- Notification sent to staff on salary approval
- Page: `admin-salary-monthly.html`

**Salary Payments**
- Record payments with method (cash, bank_transfer, UPI, cheque)
- Transaction reference tracking
- Payment status management
- Notification sent to staff on payment recording
- Page: `admin-salary-payments.html`

**Salary Advances**
- Staff can request advances (with reason and repayment plan)
- Admin approval/rejection workflow
- Notification sent to staff on advance approval/rejection
- Payment recording
- Advance deduction in monthly salary
- Summary statistics
- Pages: `admin-salary-advances.html`, `staff/advance-request.html`, `staff/salary.html`

**Reports**
- Monthly summary: total payroll, average salary, department breakdown
- Individual salary history
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

---

### 2.13 Lead Management

**Lead Pipeline**
- Full CRUD with search, filter, pagination
- Fields: name, company, email, phone, source, status, value, notes
- Status workflow: new -> contacted -> qualified -> proposal -> negotiation -> won -> lost
- Staff assignment
- Follow-up management with scheduled dates and notes
- Lead conversion to customer
- Lead statistics (by status, source, value)
- Page: `admin-leads.html`

---

### 2.14 Activity Tracker

**Activity Logging**
- Staff log their daily activities
- Fields: type, title, description, start_time, end_time, status
- Customer/lead association
- My activities view (personal history)
- Statistics: total activities, completion rate, time spent
- Admin reports: daily activity report, user-specific reports
- Page: `staff/activities.html`

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
- 16 notification types mapped: `chat_message`, `stock_check_assigned`/`submitted`, `permission_approved`/`rejected`, `reclockin_request`, `break_exceeded`, `force_clockout`, `geo_auto_clockout`, `geo_auto_clockout_admin`, `task_assigned`/`completed`, `salary_generated`/`paid`, `advance_approved`/`rejected`
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
- **Dashboard widget** (`staff/dashboard.html`): "Stock Check Assignments" card shows all pending/submitted assignments
  - Auto-hides when no assignments, shows count badge for pending
  - Color-coded: red border for overdue, amber for pending, green for submitted
  - "Start" button links to `stock-check.html`
  - Real-time: Socket.io `notification` event with type `stock_check_assigned` triggers toast + auto-refresh

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
- Product search endpoint with last-checked timestamps used in Assign tab

**Bug Fixes** (Feb 20-21):
- Staff dropdown (`/api/branches/:id/staff`) now filters out `role='customer'` users
- Assign endpoint validates staff role (rejects customer accounts)
- `my-assignments` date uses local server time instead of UTC (fixes midnight timezone drift)
- DATE→string conversion uses local getters instead of `toISOString()` (fixes CET→UTC day shift)
- Added `COLLATE utf8mb4_unicode_ci` to `zoho_locations_map` JOINs in assignments list and review queries (collation mismatch fix)
- Staff `my-assignments` now sorts recent-first (DESC)

**Staff Page Tabs**: 3 tabs — Assignments | History | New Request

**API Endpoints** (`routes/stock-check.js`, 14 endpoints):
- `GET /locations/:branchId` — Zoho locations for a branch (admin)
- `POST /assign` — Create assignment with selected location + role validation (admin)
- `GET /assignments` — List with filters (admin)
- `GET /assignments/:id` — Detail (staff sees own, admin sees any)
- `DELETE /assignments/:id` — Delete pending (admin)
- `GET /my-assignments` — Staff's assignments by date (default today); `?pending=1` returns all pending/submitted; sorted DESC
- `GET /my-submissions` — Staff's past submitted/reviewed/adjusted assignments with pagination
- `POST /submit/:id` — Staff submits counts + photos (multipart)
- `POST /self-request` — Staff self-initiates stock check (creates assignment + items, `request_type='self_requested'`)
- `GET /review/:id` — Admin review with comparison + location name
- `POST /adjust/:id` — Push to Zoho as inventory adjustment (uses per-assignment location)
- `GET /dashboard` — Summary stats per branch
- `GET /products/suggest` — Items not checked in 30+ days (accepts `zoho_location_id`)
- `GET /products/search` — Search products from `zoho_location_stock` with `MAX(submitted_at)` as `last_checked`

**Database Tables**: `stock_check_assignments` (includes `zoho_location_id`, `request_type`, `requested_reason` per assignment), `stock_check_items`
**Migration**: `migrations/migrate-stock-check.js`, `migrations/migrate-stock-check-enhancements.js` (adds `request_type ENUM('admin_assigned','self_requested')` + `requested_reason TEXT`)
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

**Staff Page** (`staff/collections.html`, data-page: `collections`, 3 tabs):
- Summary, Customers, Invoices — mobile-first, auto-filtered to staff's branch
- Actions: Send WhatsApp, Log Call, Add Promise (bottom-sheet modals)

**Branch Filtering**: Admin sees branch dropdown filter at top; staff auto-filtered by `req.user.branch_id`. All 12 endpoints respect branch filtering via `getBranchFilter()` helper.

**Customer-Branch Assignment**: Admin can assign customers to branches via dropdown in Customers tab, or bulk assign via API.

**WhatsApp Integration**: Dual-write to `whatsapp_followups` (operational queue) + `collection_reminders` (audit log). Dual-mode sending: per-branch session (whatsapp-web.js) → fallback to HTTP API.

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
**RAM**: ~300-500MB per branch session (Chromium). Max recommended: 4 branches.

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
- Personal attendance status
- Assigned tasks
- Quick action buttons
- Page: `staff/dashboard.html`, `dashboard.html`

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

### 4.2 Database Tables (~59+)

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

### Admin Pages
| Page | File | Purpose |
|------|------|---------|
| Admin Dashboard | `admin-dashboard.html` | Business overview |
| Staff Management | `admin-staff.html` | User/staff CRUD |
| Branches | `admin-branches.html` | Branch management |
| Customers | `admin-customers.html` | Customer CRUD |
| Customer Types | `admin-customer-types.html` | Customer classification |
| Products | `admin-products.html` | Product catalog |
| Brands | `admin-brands.html` | Brand management |
| Categories | `admin-categories.html` | Category management |
| Roles | `admin-roles.html` | Role management |
| Role Permissions | `admin-role-permissions.html` | Permission assignment |
| Attendance | `admin-attendance.html` | Attendance reports |
| Geofence Logs | `admin-geofence-logs.html` | Geo-fence violations |
| Tasks | `admin-tasks.html` | Task assignment |
| Daily Tasks | `admin-daily-tasks.html` | Daily task templates |
| Leads | `admin-leads.html` | Lead pipeline |
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
| Products Subnav | `components/products-subnav.html` | Products & Inventory section nav |
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
| Products | `/api/products` | 5 | `server.js` |
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
| Salary | `/api/salary/*` | 25 | `routes/salary.js` |
| Branches | `/api/branches/*` | 10 | `routes/branches.js` |
| Roles | `/api/roles/*` | 10 | `routes/roles.js` |
| Leads | `/api/leads/*` | 10 | `routes/leads.js` |
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
| **IP** | 161.97.114.189 |
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
ssh root@161.97.114.189
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
- **Auto clock-out scheduler** (`services/auto-clockout.js`): Runs every 15 min, clocks out staff after 10h (weekdays) or 5h (Sunday), ends active breaks, notifies via Socket.io
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

### 2026-02-20 - Permission-Based Staff Sidebar Filtering
- **Permission-based sidebar filtering**: Staff sidebar (`staff-sidebar.html`) filters nav items by user permissions
  - `data-requires="module.action"` attribute on 7 gated items (estimates.view, attendance.view×4, zoho.stock_check, zoho.collections)
  - `filterSidebarByPermissions()` reads cached `user_permissions` from localStorage (1-hour TTL), fetches `/api/auth/permissions` if expired
  - Admin bypass: `is_admin === true` shows all items
  - Empty sections auto-hidden when all child nav items are permission-gated and hidden
  - Always-visible items: My Dashboard, Main Dashboard, My Requests, Guides & Help, My Profile

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

---

## 9. KNOWN ISSUES & ROADMAP

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

*This document should be updated whenever new features are added or existing ones are enhanced.*
*Last Updated: 2026-02-16 | Version: 3.3.0 | Maintained by: Development Team*
