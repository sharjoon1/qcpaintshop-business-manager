# Painter Native Android App — Full Web Parity Design Spec

**Date:** 2026-04-06
**Status:** Approved
**Scope:** Bring native Android painter app to full feature parity with web painter-dashboard.html and painter-catalog.html, plus implement all "coming soon" placeholder screens.

---

## 1. Navigation Structure (No Change)

**Bottom Nav:** Home | Work | +FAB | Catalog | Profile

- **FAB actions:** New Estimate, New Quotation, Check-in, Calculator
- **Profile hub:** Edit Profile, Points History, Achievements, Gallery, Referrals, Training, Attendance Calendar, Leaderboard, Cards, Settings, WhatsApp Support

---

## 2. Catalog Screen — Major Upgrade

### 2.1 Search + Filter
- **Top bar:** Search input + Filter icon button
- **Filter count badge:** Shows number of active filters on the icon
- **Filter bottom sheet** (on filter icon tap):
  - Brand dropdown (populated from catalog API `brands` response)
  - Category dropdown (populated from catalog API `categories` response)
  - "Points products only" toggle
  - "In stock only" toggle
  - Apply button + Reset link
- Search remains debounced (400ms) text input with voice search (Tamil)

### 2.2 Product Display — Grouped by Product Family
- **2-column grid** layout
- **One card per product family** (NOT per variant/pack size)
- Card shows:
  - Product image (or brand-colored gradient placeholder)
  - Product name (2-line truncate)
  - Brand badge
  - Price range (e.g., "₹250 - ₹4,500") derived from min/max of variants
  - Variant count badge (e.g., "4 sizes")
  - Points badge (if product earns points)
  - Offer badge (multiplier/bonus/discount/free) if active offer exists
  - Stock indicator (In Stock / Low Stock / Out of Stock based on aggregate)
- **Tap card → expand/detail** showing all pack sizes:
  - Each variant row: size name, rate, stock status, regular points, annual points
  - "Create Estimate" button per variant
  - Best active offer highlighted

### 2.3 Offer Banners
- Horizontal scrollable offer cards above product grid
- 4 gradient styles cycling (green-gold, orange-red, green-emerald, gold-green)
- Shows offer type, title, description, end date
- Clickable → scrolls to/highlights relevant products

### 2.4 API
- `GET /api/painters/me/catalog?page=&limit=&brand=&category=&search=&hasPoints=&inStock=`
  - Existing endpoint, `brand` and `category` params already supported
  - May need backend addition: `hasPoints` filter param
- `GET /api/painters/me/catalog/{productId}` — product detail with variants
- `GET /api/painters/me/offers` — active offers

---

## 3. Home/Dashboard Screen — Major Upgrade

### 3.1 Existing Sections (Keep)
- Greeting header with name, level badge, notification bell, profile avatar
- Earnings card (this month)
- Stats row (Regular points, streak, monthly check-ins)
- Check-in status card
- Level progress card (Bronze→Silver→Gold→Diamond)
- Weekly challenge cards
- Briefing card (daily message + tips)
- Badges row (horizontally scrollable)

### 3.2 New Sections to Add

#### 3.2.1 Offer Products Carousel
- Brand-tabbed carousel (horizontal brand tab chips)
- Single product card per slide with auto-scroll + dot indicators
- Offer badges (fire multiplier, bonus points, % OFF, FREE)
- Tap → product detail (navigate to catalog detail or show bottom sheet)
- **API:** `GET /api/painters/me/offer-products`

#### 3.2.2 Recent Estimates
- List of last 10 estimates (estimate number, status badge, date, amount)
- Tap → navigate to estimate detail screen
- "View All" link → Work tab estimates section
- **API:** `GET /api/painters/me/estimates?limit=10`

#### 3.2.3 Recent Transactions
- Transaction list (source, amount +/-, pool badge Regular/Annual, date)
- "View All" link → Points History screen
- **API:** `GET /api/painters/me/points/{pool}?limit=5`

#### 3.2.4 My Cards Section
- Visiting card + ID card thumbnail previews
- Share button per card (native share sheet)
- **API:** `GET /api/painters/me/visiting-card?format=url`, `GET /api/painters/me/id-card?format=url`

#### 3.2.5 Visualization Section
- 2-column gallery grid of completed visualizations
- Pending/in-progress list with status badges
- "Request Visualization" button → opens visualization request form
- **API:** `GET /api/painters/me/visualizations`

#### 3.2.6 Referral Code Section
- Dashed border box showing referral code
- Share button (native share API with referral link + message)
- **API:** Referral code available from dashboard API response

#### 3.2.7 Withdrawal Quick Action
- Part of quick actions row or balance card tap
- Opens withdrawal bottom sheet: pool selector, amount input, available balance display
- **API:** `POST /api/painters/me/withdraw`

#### 3.2.8 Streak Calendar (on streak tap)
- Bottom sheet with monthly calendar grid
- Check-in days highlighted green
- Current streak + personal best display
- **API:** `GET /api/painters/me/checkin-history?month={YYYY-MM}`

#### 3.2.9 Level Panel (on level badge tap)
- Expandable panel showing 4 tier levels
- Bronze/Silver/Gold/Diamond with thresholds, multipliers, perks
- Current tier highlighted

### 3.3 Dashboard Section Order (top to bottom)
1. Greeting header
2. Morning briefing card (points earned, daily bonus, progress)
3. Balance cards (2x2 grid: Regular, Annual, Total Earned, Referrals)
4. Offer products carousel
5. My Cards section
6. Quick actions (Estimate, Withdraw, Card, Refer, Visualize)
7. Referral code section
8. Recent estimates
9. Recent transactions
10. Visualizations
11. Bottom padding for nav

---

## 4. New Screens to Implement

### 4.1 Points History Screen
- **Route:** `profile/points`
- **Top tabs:** Regular | Annual (toggle between pools)
- **Balance card:** Current balance for selected pool
- **Filter chips:** All | Earned | Spent | Withdrawn
- **Transaction list:** Date, source description, amount (+green/-red), running context
- **Pagination:** Infinite scroll, 50 per page
- **API:** `GET /api/painters/me/points/{pool}?limit=50&page=`

### 4.2 Cards Screen
- **Route:** `profile/cards`
- **Two sections:** Visiting Card + ID Card
- **Each section:**
  - Card image loaded via Coil from server URL
  - Share button → native share sheet (image + text message)
  - Download button → save to device MediaStore/gallery
- **API:** `GET /api/painters/me/visiting-card?format=url`, `GET /api/painters/me/id-card?format=url`

### 4.3 Visualization Request Screen
- **Route:** accessible from dashboard visualization section
- **Gallery grid:** Completed visualizations (tap → full screen view)
- **Pending list:** In-progress visualizations with status badges
- **Request form** (bottom sheet or new screen):
  - Photo picker: Camera + Gallery chooser
  - Brand text input
  - Color name text input
  - Color code input with hex color picker
  - Notes textarea
  - Submit button
- **API:** `GET /api/painters/me/visualizations`, `POST /api/painters/me/visualizations` (multipart/form-data)

### 4.4 Referrals Screen
- **Route:** `profile/referrals`
- **Header:** Referral code + share button
- **Stats:** Total referrals count, earnings from referrals
- **List:** Successful referrals (painter name, date, status, earnings)
- **API:** `GET /api/painters/me/referrals`

### 4.5 Gallery Screen
- **Route:** `profile/gallery`
- **Grid layout:** 3-column photo grid
- **Sources:** Completed visualizations + any uploaded work photos
- **Tap:** Full-screen image viewer with pinch-to-zoom
- **API:** `GET /api/painters/me/visualizations` (completed ones)

### 4.6 Training Screen
- **Route:** `profile/training`
- **List UI:** Title, thumbnail, type badge (Video/Article), duration
- **Tap:** Opens training detail screen (content rendered based on type)
- **Empty state:** Friendly message when no training content available
- **API:** `GET /api/painters/me/training`

### 4.7 Training Detail Screen
- **Route:** `profile/training/{id}`
- **Video:** Embedded video player or external link
- **Article:** WebView or rich text display
- **API:** Training detail from list response or `GET /api/painters/me/training/{id}`

### 4.8 Attendance Calendar Screen
- **Route:** `profile/attendance` (also reachable from FAB Check-in)
- **Streak display:** Current streak count with fire emoji
- **Monthly stats:** X/30 days checked in this month
- **Calendar grid:** Monthly view, month navigation (< >)
  - Green dot/fill on check-in days
  - Today highlighted differently
- **Check-in button:** If not checked in today, show prominent button (links to CheckInScreen)
- **API:** `GET /api/painters/me/checkin-history?month={YYYY-MM}`

### 4.9 Edit Profile Screen
- **Route:** `profile/edit`
- **Fields:**
  - Profile photo (camera + gallery picker, circular crop)
  - Full name (text input)
  - Phone (display only, not editable)
  - City (text input)
- **Save button** → updates profile, triggers card regeneration
- **API:** `PUT /api/painters/me/profile` (multipart for photo)

### 4.10 Notifications Screen
- **Route:** from bell icon (anywhere)
- **List:** All notifications (read = grey, unread = white/bold)
- **Each item:** Icon by type, title, body, time ago
- **Tap → deep link** to relevant screen based on notification type
- **Mark as read** on view
- **API:** `GET /api/painters/me/notifications?limit=50`

### 4.11 Estimate Detail Screen
- **Route:** `estimate/{id}` (already defined, composable missing)
- **Content:** Estimate number, date, status badge, customer details
- **Items list:** Product name, quantity, rate, amount per item
- **Totals:** Subtotal, markup/discount, grand total, payment amount, balance due
- **Actions based on status:**
  - Request Discount button
  - Submit Payment button (with amount input)
  - Download PDF button
- **API:** `GET /api/painters/me/estimates/{id}`, `POST .../request-discount`, `POST .../payment`, `GET .../pdf`

### 4.12 Quotation Detail Screen
- **Route:** `quotation/{id}` (already defined, composable missing)
- **Content:** Quotation number, type, status, customer details
- **Room breakdown:** Room name, dimensions, area, items
- **Totals:** Labour, material, grand total
- **API:** `GET /api/painters/me/quotations/{id}`

---

## 5. FCM Push Notifications + Deep Links

### 5.1 FCM Setup
- Register FCM token on login: `POST /api/painters/me/fcm/register`
- Handle token refresh
- Background + foreground notification handling

### 5.2 Deep Link Routing
| Notification Type | Navigate To |
|---|---|
| Estimate status change (approved/rejected/sent/final_approved) | Estimate detail screen |
| Payment recorded/pushed to Zoho | Estimate detail screen |
| Points earned | Points History screen |
| Withdrawal approved/rejected | Points History screen |
| Offer/bonus product | Dashboard offers or Catalog |
| Visualization completed | Dashboard visualizations |
| General announcement | Notifications list |

---

## 6. API Summary — All Endpoints Used

All endpoints already exist in `routes/painters.js`. No new backend work except possibly:
- Add `hasPoints` query param to catalog endpoint (minor)

| Endpoint | Method | Screen |
|---|---|---|
| `me/dashboard` | GET | Home |
| `me/briefing` | GET | Home |
| `me/gamification` | GET | Home |
| `me/offer-products` | GET | Home |
| `me/catalog` | GET | Catalog |
| `me/catalog/{id}` | GET | Catalog detail |
| `me/offers` | GET | Catalog |
| `me/estimates` | GET | Home, Work |
| `me/estimates/{id}` | GET | Estimate detail |
| `me/estimates/{id}/request-discount` | POST | Estimate detail |
| `me/estimates/{id}/payment` | POST | Estimate detail |
| `me/estimates/{id}/pdf` | GET | Estimate detail |
| `me/quotations` | GET | Work |
| `me/quotations/{id}` | GET | Quotation detail |
| `me/estimates` | POST | Estimate create |
| `me/quotations` | POST | Quotation create |
| `me/estimates/products` | GET | Estimate create |
| `me/points/{pool}` | GET | Points History, Home |
| `me/withdraw` | POST | Withdrawal |
| `me/referrals` | GET | Referrals |
| `me/visiting-card` | GET | Cards, Home |
| `me/id-card` | GET | Cards, Home |
| `me/visualizations` | GET | Home, Gallery |
| `me/visualizations` | POST | Visualization request |
| `me/notifications` | GET | Notifications |
| `me/fcm/register` | POST | On login |
| `me/daily-streak` | PUT | Home |
| `me/checkin-history` | GET | Attendance Calendar, Home |
| `me/attendance/check-in` | POST | Check-in |
| `me/attendance/today` | GET | Check-in |
| `me/training` | GET | Training |
| `me/leaderboard` | GET | Leaderboard |
| `me/profile` | PUT | Edit Profile |
| `me/product-requests` | POST | Catalog |

---

## 7. Tech Stack (Existing)
- Jetpack Compose (UI)
- Hilt (DI)
- Retrofit (HTTP)
- Coil (Images)
- Material 3
- Coroutines + Flow
- DataStore (Preferences)
- Firebase Cloud Messaging (Push)

---

## 8. Design Decisions Summary

| Decision | Choice | Reason |
|---|---|---|
| Navigation | Keep native 4-tab + FAB | FAB valuable for quick actions, Profile as hub |
| Catalog filters | Filter bottom sheet | Clean UI, scalable, native pattern |
| Product grouping | By product family | One card per product, expand for variants |
| Cards | View + Share + Download | Practical for offline sharing, no edit needed |
| Visualization photo | Camera + Gallery | Painters need both options |
| Points History | Dedicated screen with tabs | Clear pool separation, filter support |
| Training | Generic list UI | Content format TBD, flexible display |
| Attendance Calendar | Simple calendar + streak | Incentive-based, not mandatory tracking |
| Notifications | List + FCM push + deep links | Full notification experience even when app closed |
