# QC Paint Shop Business Manager - System Skills & Capabilities

> **Platform**: act.qcpaintshop.com
> **Version**: 3.3.0
> **Last Updated**: 2026-02-15
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
- Late detection (configurable threshold per branch, shop opens 08:30 AM)
- Work hours calculation
- Pages: `staff/clock-in.html`, `staff/clock-out.html`

**Break Management**
- Break start/end with photo proof
- Break duration tracking
- Break time validation against branch config
- Double-submit protection (`breakSubmitting` flag prevents duplicate requests)
- Video readiness check before capture (validates camera stream active)

**Permission Requests**
- Staff can request permissions (leave/early departure)
- Admin approval/rejection workflow with `review_notes` column
- DB columns: `approved_by`, `approved_at`, `rejection_reason`, `review_notes`
- Notification sent to staff on approval/rejection (via `user_id` + `request_type`)
- Page: `staff/permission-request.html`

**Admin Features**
- Today's attendance summary (present, absent, late, on-break)
- Monthly attendance report per user
- Attendance report with date range filtering
- **Distance column** in Live Today table (shows meters/km from branch)
- Manual attendance marking (admin override)
- Geo-fence toggle per staff (ON/OFF) in staff management
- Multi-branch assignment with primary branch selection
- Geo-fence violation viewer
- **Direct photo viewer**: `GET /api/attendance/record/:id` endpoint fetches single record with all photo paths, distance, GPS info
- Photo viewer shows all 4 types (clock-in, clock-out, break-start, break-end) with timestamps and distance
- Pages: `admin-attendance.html`, `admin-geofence-logs.html`, `staff/history.html`, `admin-staff.html`

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

---

### 2.16 Settings & Configuration

- Business branding: name, logo, phone, email, address, GST
- Logo upload
- Category-based settings storage
- Public branding endpoint (for authenticated users)
- Admin-only full settings management
- Page: `admin-settings.html`

---

### 2.17 Dashboard & Reports

**Admin Dashboard**
- Total users, customers, products, estimates
- Today's attendance count
- Lead statistics (total, new)
- Task statistics (pending, overdue)
- Monthly estimates (count, total value)
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

### 4.2 Database Tables (~55+)

**Core**: `users`, `user_sessions`, `branches`, `customers`, `customer_types`, `settings`
**Products**: `products`, `brands`, `categories`, `pack_sizes`
**Estimates**: `estimates`, `estimate_items`, `estimate_status_history`, `estimate_requests`
**Attendance**: `staff_attendance`, `attendance_breaks`, `permission_requests`, `shop_hours_config`, `geofence_violations`, `user_branches`
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
| **WhatsApp Processor** | `services/whatsapp-processor.js` | Queue-based WhatsApp message sending |
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
| Landing | `index.html` | Landing / redirect |
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
| Profile | `admin-profile.html` | Admin profile |

### Zoho Pages
| Page | File | Purpose |
|------|------|---------|
| Zoho Dashboard | `admin-zoho-dashboard.html` | Sync overview |
| Zoho Settings | `admin-zoho-settings.html` | OAuth & config |
| Zoho Items | `admin-zoho-items.html` | Item catalog |
| Zoho Items Edit | `admin-zoho-items-edit.html` | Bulk item editing |
| Zoho Stock | `admin-zoho-stock.html` | Stock levels |
| Zoho Stock Adjust | `admin-zoho-stock-adjust.html` | Inventory adjustments |
| Zoho Invoices | `admin-zoho-invoices.html` | Invoice viewer |
| Zoho Locations | `admin-zoho-locations.html` | Warehouse mapping |
| Zoho Transactions | `admin-zoho-transactions.html` | Daily transactions |
| Zoho Reports | `admin-zoho-reports.html` | Financial reports |
| Zoho Reorder | `admin-zoho-reorder.html` | Reorder alerts |
| Zoho Purchases | `admin-zoho-purchase-suggestions.html` | Purchase planning |
| Zoho Bulk Jobs | `admin-zoho-bulk-jobs.html` | Bulk operation status |

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
| Staff Sidebar | `components/staff-sidebar.html` | Staff-only sidebar |
| Dashboard Actions | `components/dashboard-quick-actions.html` | Quick action buttons |
| Staff Actions | `components/staff-quick-actions.html` | Staff quick actions |
| Attendance Subnav | `components/attendance-subnav.html` | Attendance section nav |
| Zoho Subnav | `components/zoho-subnav.html` | Zoho section nav |

### JavaScript Files
| File | Purpose |
|------|---------|
| `js/auth-helper.js` | Auth token management, SW registration, `isAndroidApp()` |
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
