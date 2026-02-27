# QC Painters — Dedicated Android App Design

**Date:** 2026-02-28
**Status:** Approved

## Overview

Dedicated Android app for painters ("QC Painters") with enhanced features beyond the existing web-based painter system. Same backend (act.qcpaintshop.com), new Android APK with painter-specific branding, plus new web pages and backend modules.

## Architecture

**Approach:** WebView Android App + Enhanced Painter Web Pages (same pattern as QC Staff app)

```
QC Painters App (com.qcpaintshop.painter)
├── Android Shell (Kotlin)
│   ├── WebView → act.qcpaintshop.com/painter-login.html
│   ├── FCM Push Notifications
│   ├── Camera (attendance photos)
│   ├── GPS Location (shop geofence)
│   └── File Downloads (PDF training)
│
├── Web Pages (7 painter pages)
│   ├── painter-login.html (existing)
│   ├── painter-register.html (existing)
│   ├── painter-dashboard.html (redesigned)
│   ├── painter-catalog.html (NEW)
│   ├── painter-training.html (NEW)
│   ├── painter-attendance.html (NEW)
│   └── painter-estimate-create.html (existing, enhanced)
│
└── Backend Additions
    ├── Product image upload (estimate products)
    ├── Special offers system
    ├── Training content (reuse guides)
    ├── Painter attendance with geofence
    ├── FCM notification service
    └── Tamil/English i18n
```

## Module 1: Android App Shell

- **Package:** `com.qcpaintshop.painter`
- **App Name:** "QC Painters"
- **Start URL:** `/painter-login.html`
- **Version:** 1.0.0 (versionCode 1)
- **Build:** New flavor in existing Android project (`src/painter/`)
- **Branding:** Paint brush/roller icon, QC brand gradient (#667eea → #764ba2)
- **Native Features:** FCM, Camera, GPS, File Downloads, Deep Links
- **User Agent:** `QCManagerApp/1.0 AppType/painter`
- **Notification Channel:** `qc_painter_notifications`

## Module 2: Product Catalog (painter-catalog.html)

**Purpose:** Browse estimate products with images, points incentives, and special offers.

**Page Layout:**
- Search bar + language toggle header
- Brand filter chips (horizontal scroll)
- Category filter chips
- Special offer banners (scrollable carousel)
- Product grid (2 columns, card layout)
  - Product image (from estimate products)
  - Product name, size
  - Points rate badge
  - Active offer badge (if applicable)
- Product detail page (tap to open):
  - Full-width image gallery
  - Product details (name, brand, category, MRP, sizes)
  - Incentives section: regular points, annual %, active offers
  - "Create Estimate" CTA button

**Data Sources:**
- Products: estimate_products system (categories → brands → products)
- Images: New `image_url` column on estimate products table (admin uploads)
- Points: `painter_product_point_rates` table
- Offers: New `painter_special_offers` table

**Visibility Rules:**
- Painters see only estimate products (NOT Zoho items directly)
- Admin/staff see both estimate products and Zoho items
- Future: mapping between estimate products and Zoho items

## Module 3: Special Offers System

**New Table: `painter_special_offers`**
| Column | Type | Description |
|--------|------|-------------|
| id | INT PK | Auto-increment |
| title | VARCHAR(255) | English title |
| title_ta | VARCHAR(255) | Tamil title |
| description | TEXT | English description |
| description_ta | TEXT | Tamil description |
| offer_type | ENUM | 'multiplier', 'bonus_points', 'free_product', 'discount' |
| multiplier_value | DECIMAL(4,2) | e.g., 2.0 for 2x points |
| bonus_points | DECIMAL(12,2) | Flat bonus points |
| applies_to | ENUM | 'all', 'brand', 'category', 'product' |
| target_id | INT | FK to brand/category/product based on applies_to |
| start_date | DATE | Offer start |
| end_date | DATE | Offer end |
| is_active | TINYINT | 1=active |
| banner_image_url | VARCHAR(500) | Banner image path |
| created_by | INT | Admin user ID |
| created_at | TIMESTAMP | |

**Admin UI:** New tab (Tab 7) in admin-painters.html
- Create/edit offer form with date range, target selection, banner upload
- Preview card showing how painter will see it

**Integration with Points Engine:**
- When processing invoice, check active offers for each product
- Apply multiplier/bonus accordingly
- Log offer_id in transaction for tracking

## Module 4: Training Hub (painter-training.html)

**Reuses existing Guide Management System** (Quill.js editor, categories, analytics)

**Enhancements:**
- New guide category: `painter_training`
- New columns on guides table: `youtube_url`, `pdf_url`, `language` (en/ta)
- Painter-specific content filter (only show painter_training category)

**Page Layout:**
- Category tabs: All, Products, Techniques, Color Guide, Videos
- Featured Videos section (YouTube embeds)
- Guides & Articles section (Quill.js rendered content)
- PDF Downloads (downloadable guides)
- Language toggle (Tamil/English)

**Admin creates content** using existing guide editor in admin panel.

## Module 5: Shop Attendance (painter-attendance.html)

**Purpose:** Painters earn points by visiting your shop. GPS geofence verifies location.

**Flow:**
1. Painter opens attendance page
2. App requests GPS location (via native bridge)
3. Backend checks if within shop geofence (configurable radius, default 100m)
4. If within range → Show "Check In" button
5. Painter takes selfie photo (optional) → Check in
6. Award attendance points (configurable, default 5 pts)
7. Max 1 check-in per day per painter

**Enhanced `painter_attendance` table:**
| New Column | Type | Description |
|-----------|------|-------------|
| check_in_photo_url | VARCHAR(500) | Selfie photo path |
| latitude | DECIMAL(10,8) | GPS lat at check-in |
| longitude | DECIMAL(11,8) | GPS lng at check-in |
| distance_from_shop | INT | Meters from shop center |
| branch_id | INT | Which shop visited |

**Geofence Config (admin, per branch):**
- Shop lat/lng (stored in branches table or `ai_config`)
- Radius: configurable (default 100m)
- Points per visit: configurable
- Daily limit: 1

**Page Layout:**
- Today's status card (checked in / not checked in)
- Check-in button (large, prominent)
- Monthly calendar heatmap (visits marked)
- Monthly stats (visits count, points earned)
- Recent visits list with dates and points

## Module 6: Tamil/English i18n

**Approach:** Client-side language switching with JSON translation files.

**Files:**
- `/public/i18n/painter-en.json` — English translations
- `/public/i18n/painter-ta.json` — Tamil translations
- `/public/js/painter-i18n.js` — Translation loader + switcher

**Usage in HTML:**
```html
<h2 data-i18n="dashboard.welcome">Welcome</h2>
```

**Toggle:** Button in every page header, preference saved in `localStorage['painter_lang']`

**DB Content (offers, training):** Dual columns — `title` + `title_ta`, `description` + `description_ta`

## Module 7: FCM Push Notifications

**Notification Types:**
| Type | Trigger | Message Example |
|------|---------|-----------------|
| points_earned | Invoice processed | "15 points earned from invoice #INV-001" |
| withdrawal_approved | Admin approves | "Withdrawal of 500 points approved" |
| withdrawal_paid | Payment done | "Payment of Rs.500 processed" |
| estimate_approved | Admin approves | "Estimate #PE20260228 approved" |
| estimate_rejected | Admin rejects | "Estimate rejected — see admin notes" |
| new_offer | Admin creates offer | "New: 2x points on Royale products!" |
| training_new | New guide published | "New guide: Interior Painting Techniques" |
| attendance_reminder | Daily 9 AM cron | "Visit the shop today to earn 5 points!" |

**New Table: `painter_fcm_tokens`**
| Column | Type |
|--------|------|
| id | INT PK |
| painter_id | INT FK |
| fcm_token | VARCHAR(500) |
| device_info | VARCHAR(255) |
| is_active | TINYINT |
| created_at | TIMESTAMP |

**Service:** `services/painter-notification-service.js`
- `sendToPainter(painterId, type, title, body, data)`
- `sendToAll(type, title, body, data)` (for offers, training)
- `sendAttendanceReminders()` (daily cron)

**Android Integration:**
- Same FCM setup as staff app
- Painter-specific deep links:
  - points_earned → `/painter-dashboard.html`
  - estimate_* → `/painter-dashboard.html#estimates`
  - new_offer → `/painter-catalog.html`
  - training_new → `/painter-training.html`

## Dashboard Redesign (painter-dashboard.html)

**Enhanced layout with new navigation:**

```
Bottom Navigation Bar (5 tabs):
┌────┬────────┬─────────┬──────────┬─────────┐
│ 🏠 │ 📦     │ 📋      │ 📚       │ 📍      │
│Home│Catalog │Estimate │Training  │Attendance│
└────┴────────┴─────────┴──────────┴─────────┘
```

**Home tab (redesigned dashboard):**
- Balance cards (Regular, Annual, Total Earned, Referrals)
- Active offers carousel (links to catalog)
- Recent transactions
- Quick actions (Withdraw, Estimate, Referral share)

## Product Image Upload (Admin)

**Admin-products.html enhancement:**
- Add image upload button per estimate product
- Images stored: `/uploads/products/{product_id}.jpg`
- New column: `image_url` on estimate products table
- Multer upload config: `uploadProductImage`
- `sharp` for resizing (400x400 thumbnail, 800x800 full)

## Summary of New Tables

1. `painter_special_offers` — Offers/schemes
2. `painter_fcm_tokens` — Push notification tokens

## Summary of Table Modifications

1. `painter_attendance` — +photo_url, +lat/lng, +distance, +branch_id
2. estimate products table — +image_url
3. guides table — +youtube_url, +pdf_url, +language

## API Endpoints (New)

**Catalog:**
- `GET /api/painters/me/catalog` — Products with images, points, offers
- `GET /api/painters/me/catalog/:productId` — Product detail
- `GET /api/painters/me/offers` — Active offers list

**Training:**
- `GET /api/painters/me/training` — Training guides list
- `GET /api/painters/me/training/:id` — Single guide detail

**Attendance:**
- `POST /api/painters/me/attendance/check-in` — GPS + photo check-in
- `POST /api/painters/me/attendance/check-out` — Check out
- `GET /api/painters/me/attendance/today` — Today's status
- `GET /api/painters/me/attendance/monthly` — Monthly calendar data

**Notifications:**
- `POST /api/painters/me/fcm/register` — Register FCM token
- `DELETE /api/painters/me/fcm/unregister` — Remove token

**Admin:**
- CRUD for special offers (in routes/painters.js)
- Product image upload endpoint
- Bulk notification send
