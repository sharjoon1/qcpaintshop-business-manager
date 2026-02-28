# Painter App Premium Features — Design Document

**Date:** 2026-02-28
**Status:** Approved

## Problem

1. Dashboard looks generic — needs premium feel befitting QC's brand
2. No profile avatar — painters can't personalize their identity
3. No visiting card — painters need professional cards to share with customers
4. No color visualization — painters need to request visualizations for customer homes/buildings
5. Referral sharing is text-only — no visual branding attached

## Brand Colors

- **Primary (backgrounds/headers):** #1B5E3B (green)
- **Secondary (buttons/accents):** #D4A24E (gold)
- **NO purple anywhere**

---

## 1. Profile System

### 1.1 Avatar Upload

**Endpoint:** `PUT /api/painters/me/profile-photo`
- Auth: `X-Painter-Token` header
- Multer: use existing `uploadProfile` config (5MB, images only)
- Sharp: resize to 400x400, JPEG 80% quality
- Storage: `public/uploads/profiles/painter_{id}.jpg`
- Updates `painters.profile_photo` column (already exists, currently unused)
- Response: `{ success: true, photo_url: '/uploads/profiles/painter_{id}.jpg?v={timestamp}' }`

**Default Avatar:** When no photo set, show colored circle with first letter of name (CSS-only, no image generation needed).

### 1.2 Profile Page

**New page:** `painter-profile.html`
- Accessible from dashboard header avatar tap or "Edit Profile" link
- Displays: avatar (with camera overlay to change), full name, phone (read-only), city, experience, specialization, referral code (read-only), email, address
- Editable fields submit to existing `PUT /api/painters/me` endpoint
- Photo upload via new endpoint above

---

## 2. Server-Generated Visiting Card

### 2.1 Card Design (Sharp PNG)

**Dimensions:** 1050 x 600 px (business card ratio)

**Layout:**
```
┌──────────────────────────────────────────────┐
│ ███ Green-to-Gold gradient header bar ██████ │
│ QC PAINTERS                    Quality Colours│
├──────────────────────────────────────────────┤
│                                              │
│  ┌──────┐   Syed Mohamed                    │
│  │Photo │   Interior & Exterior Specialist   │
│  │      │   12 years experience              │
│  └──────┘                                    │
│                                              │
│  📞 +91 98765 43210        ┌────────┐        │
│  📍 Chennai                │ QR Code│        │
│                            │        │        │
│  Ref: SYEMFH1C             └────────┘        │
│                                              │
├──────────────────────────────────────────────┤
│ Quality Colours — Your Trusted Paint Partner │
└──────────────────────────────────────────────┘
```

### 2.2 Generation Endpoint

**Endpoint:** `GET /api/painters/me/visiting-card`
- Auth: `X-Painter-Token`
- Generates PNG using Sharp (composite layers: background, photo, text overlays, QR code)
- QR code: uses `qrcode` npm package → links to `{origin}/painter-register.html?ref={CODE}`
- **Caching:** saves to `public/uploads/painter-cards/painter_{id}.png`
- **Cache invalidation:** regenerate when profile_photo, full_name, city, experience_years, or specialization changes (set a `card_dirty` flag on profile update, regenerate on next GET)
- Returns: PNG image (`Content-Type: image/png`)

### 2.3 Dashboard Integration

- "My Visiting Card" section shows card thumbnail
- "Share" button triggers 3-tier fallback:
  1. `navigator.share({ files: [cardBlob] })` — native share with image
  2. Download PNG + copy link to clipboard
  3. WhatsApp bottom sheet with card download link

### 2.4 Referral Share Enhancement

When painter shares referral code, the share text includes a link to download/view their visiting card:
```
Join Quality Colours Painter Loyalty Program!

Referred by: Syed Mohamed (12 yrs experience)
Use code: SYEMFH1C

Register: {origin}/painter-register.html?ref=SYEMFH1C
```

---

## 3. Color Visualization System (Painter-Specific)

### 3.1 Database

**New table:** `painter_visualization_requests`
```sql
CREATE TABLE painter_visualization_requests (
    id INT AUTO_INCREMENT PRIMARY KEY,
    painter_id INT NOT NULL,
    photo_path VARCHAR(500) NOT NULL,
    brand VARCHAR(100),
    color_name VARCHAR(100),
    color_code VARCHAR(50),
    color_hex VARCHAR(7),
    notes TEXT,
    status ENUM('pending','in_progress','completed','rejected') DEFAULT 'pending',
    visualization_path VARCHAR(500),
    admin_notes TEXT,
    processed_by INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP NULL,
    FOREIGN KEY (painter_id) REFERENCES painters(id),
    INDEX idx_painter (painter_id),
    INDEX idx_status (status)
);
```

### 3.2 Painter Side

**Endpoints:**
- `POST /api/painters/me/visualizations` — submit request (photo upload + brand/color/notes)
- `GET /api/painters/me/visualizations` — list my requests (with status, pagination)
- `GET /api/painters/me/visualizations/:id` — get single request detail

**UI:** Section in dashboard showing:
- "Request Visualization" button → opens upload form (photo + brand/color selector + notes)
- Gallery of completed visualizations (tap to view full, share)
- Pending requests with status badges

### 3.3 Admin Side

**Tab 8 "Visualizations"** in `admin-painters.html`:
- Queue table: pending requests sorted by date
- Each row: painter name, photo thumbnail, requested color, date, status
- Click to open: view photo, use existing Sharp visualization tool, upload result
- Mark complete → notification sent to painter
- Reject with reason → notification sent

**Admin Endpoints:**
- `GET /api/painters/admin/visualizations` — list all requests (filterable by status)
- `PUT /api/painters/admin/visualizations/:id` — update status, upload result
- `POST /api/painters/admin/visualizations/:id/process` — generate visualization using Sharp

### 3.4 Visualization Processing

Reuse existing Sharp color-overlay logic from design requests:
1. Load painter's uploaded photo
2. Apply color overlay (soft-light blend)
3. Add footer: painter name, color code, color name, QC branding
4. Save to `public/uploads/painter-visualizations/viz_{id}.png`
5. Update `visualization_path`, set status=completed

---

## 4. Dashboard Redesign

### 4.1 Header

```html
<!-- Gradient header with profile -->
<div class="header" style="background: linear-gradient(135deg, #1B5E3B, #D4A24E)">
    <div class="flex items-center gap-3">
        <!-- Avatar (tap to go to profile page) -->
        <a href="/painter-profile.html">
            <div class="avatar-circle"><!-- photo or initials --></div>
        </a>
        <div>
            <p class="text-sm opacity-80">Welcome back,</p>
            <h1 class="text-xl font-bold">Syed Mohamed</h1>
            <span class="tier-badge">Member</span>
        </div>
    </div>
    <div class="flex items-center gap-3">
        <!-- Lang toggle, Notification bell, Logout -->
    </div>
</div>
```

### 4.2 Stats Grid (2x2)

Same data as current but elevated:
- Each card has a subtle icon (wallet, trophy, coins, people)
- Regular Points: green (#1B5E3B)
- Annual Points: gold (#D4A24E)
- Total Earned: emerald
- Referrals: blue

### 4.3 Quick Actions (horizontal scroll)

5 action buttons in scrollable row:
1. **Estimate** — `/painter-estimate-create.html`
2. **Withdraw** — opens modal
3. **Visiting Card** — downloads/shares card
4. **Refer** — share referral
5. **Visualize** — opens visualization request

### 4.4 Content Sections (order)

1. **Active Offers** carousel (existing, keep as-is)
2. **My Visiting Card** — card thumbnail + share button
3. **Visualization Gallery** — completed visualizations grid (2 per row, empty state with CTA)
4. **My Estimates** — recent estimates list (existing)
5. **Referral Code** box with share (existing, enhanced)
6. **Recent Transactions** (existing)

### 4.5 Bottom Nav

Same 5 tabs, unchanged: Home, Catalog, Estimate, Training, Attendance

---

## 5. NPM Dependencies

- `qrcode` — QR code generation for visiting card (lightweight, no external API)
- `sharp` — already installed, used for all image generation

## 6. File Summary

| File | Action | Purpose |
|------|--------|---------|
| `migrations/migrate-painter-premium.js` | Create | Add visualization_requests table |
| `routes/painters.js` | Modify | Add profile-photo, visiting-card, visualization endpoints |
| `services/painter-card-generator.js` | Create | Sharp-based visiting card PNG generation |
| `public/painter-dashboard.html` | Modify | Full redesign with new sections |
| `public/painter-profile.html` | Create | Profile edit page with avatar upload |
| `public/admin-painters.html` | Modify | Add Tab 8 for visualization queue |
| `server.js` | Modify | Wire card dirty flag on profile update |
