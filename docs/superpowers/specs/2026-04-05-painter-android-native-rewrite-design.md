# Painter Android App — Full Native Rewrite

**Date:** 2026-04-05
**Status:** Approved

## Overview

Rewrite the existing WebView-based Painter Android app as a fully native Jetpack Compose application. The current app (v1.4.0, versionCode 5) wraps 8 web pages in a WebView. The new app replaces all web UI with native Android screens while connecting to the same backend API (`act.qcpaintshop.com`).

**Target users:** Painters who are basic to semi-tech savvy (WhatsApp/PhonePe comfort level). UI must be extremely simple, visual, with large touch targets.

## Design Decisions

| Aspect | Decision |
|--------|----------|
| UI Framework | Jetpack Compose + Material 3 |
| Design Style | Modern Card-Based (PhonePe/GPay style) |
| Language | Bilingual Tamil/English with in-app toggle, default Tamil |
| Navigation | 5 Bottom Tabs + Center FAB |
| Offline | Basic — cached data viewable, actions need internet |
| Gamification | Full — leaderboard, badges, levels, challenges, confetti |
| Calculator | Advanced — multi-room, paint type, convert to quotation |
| Gallery | Simple — before/after, categories, WhatsApp share |
| Chat | WhatsApp redirect (no in-app chat) |
| Voice | Search only (Android SpeechRecognizer) |
| Greeting | NO "வணக்கம்" anywhere — direct name + stats |

## Brand Colors

- Primary: `#1B5E3B` (dark forest green)
- Primary Dark: `#154D31`
- Secondary/Accent: `#D4A24E` (gold)
- Background: `#F8FAF8`
- Surface: `#FFFFFF`
- Error: `#EF4444`
- Success: `#10B981`

## Navigation Structure

### 5 Bottom Tabs

```
┌─────────┬─────────┬─────────┬──────────┬─────────┐
│ 🏠      │ 📋      │   ＋    │ 🎨       │ 👤      │
│ முகப்பு  │ வேலை    │  புதிய  │ கேட்டலாக் │ நான்    │
│ Home    │ Work    │  New    │ Catalog  │ Me      │
└─────────┴─────────┴─────────┴──────────┴─────────┘
```

Center FAB (+) opens a bottom sheet with quick actions:
- New Estimate
- New Quotation
- Check-in
- Paint Calculator

## Screens

### Tab 1 — முகப்பு (Home / Dashboard)

**Header:** Painter name + level badge (no greeting text). Profile photo tap → Profile screen.

**Earnings Card:** Large card showing this month's earnings (₹). Tap → detailed earnings breakdown.

**Stats Row:** Three stat chips — Points balance | Daily streak (🔥) | This month check-ins.

**Attendance Check-in:** Prominent button "Check In" with GPS icon. Shows today's status (checked in / not yet). Tap → GPS capture + photo + submit.

**Daily Briefing Card:** AI-generated briefing from `/api/painters/me/briefing`. Today's targets, offers, tips.

**Weekly Challenge Card:** Current active challenge with progress bar. Example: "5 estimates this week — 3/5 done — 50 bonus points".

**Achievements Showcase:** Horizontal scroll of recent badges earned. Tap → full achievements screen.

**Gamification Level Progress:** Progress bar showing current level → next level. Example: "Silver Painter — 1,450/2,000 points to Gold".

### Tab 2 — வேலை (Work)

**Top Tabs:** Estimates | Quotations

**Estimates Tab:**
- Filter chips: All | Draft | Pending | Approved | Paid
- List of estimate cards showing: estimate number, customer name (if any), amount, date, status badge
- Tap → estimate detail screen
- Swipe left → delete (draft only)

**Quotations Tab:**
- Filter chips: All | Draft | Sent | Accepted | Expired
- List of quotation cards showing: quotation number, customer name, type badge (Labour/L+M), amount, date
- Tap → quotation detail screen

### Tab 3 — ＋ புதிய (Center FAB)

Opens a Material 3 bottom sheet with 4 action cards:

1. **New Estimate** → Navigate to estimate creation flow
2. **New Quotation** → Navigate to quotation creation flow
3. **Check-in** → GPS check-in flow
4. **Paint Calculator** → Calculator screen

### Tab 4 — கேட்டலாக் (Catalog)

**Search Bar:** Text input + microphone icon for voice search (Android SpeechRecognizer). Search by product name, brand.

**Offers Banner:** Horizontal carousel of active offers at top. Tap → offer detail.

**Filter Chips:** Brand | Category | In Stock Only (toggle)

**Product Grid:** 2-column grid of product cards.

Each product card:
- Product image
- Product name
- Brand badge
- Pack sizes with prices
- Stock badge (In Stock ✅ / Low ⚠️ / Out of Stock ❌)
- **"Estimate-ல் சேர்" button** — if in stock, adds directly to active estimate
- **"குறைவான விலை?" button** — opens Price Match report form

**Product Not Found:**
- When search returns no results: "இந்த product இல்லை. **சேர்க்க கோரிக்கை விட**" button
- Taps opens form: product name (pre-filled from search), brand, size needed, optional note
- Submit → `POST /api/painters/me/product-requests` → admin notification
- When admin adds product → painter gets push: "நீங்கள் கேட்ட {product} இப்போது available!"

**Smart Suggestions:**
- Out-of-stock product → shows "Alternative: {similar product} — In Stock" card
- Stock available product → shows "Estimate-ல் சேர்க்கவா?" prompt

### Tab 5 — நான் (Me / Profile)

**Profile Header:** Photo, name, phone, level badge, member since date. Edit button → profile edit screen.

**Quick Action Grid (2×3):**
- Visiting Card (generate/share)
- ID Card (generate/share)
- Work Gallery
- Referrals
- Leaderboard
- Training Hub

**Points Section:**
- Regular Pool balance + "Withdraw" button
- Annual Pool balance + withdrawal window info
- Points history (transaction list)

**Settings:**
- Language toggle (தமிழ் ↔ English)
- Notification preferences
- Dark mode toggle (future)
- WhatsApp support button (redirect to company number)
- App version info
- Logout

## New Feature: Contract Quotation System

### Quotation Types

| Type | Pricing Method | Description |
|------|---------------|-------------|
| Labour Only — Salary | Daily or Monthly rate | வேலைக்கு மட்டும், நாள்/மாத சம்பளம் |
| Labour Only — Sqft | ₹ per sq.ft | வேலைக்கு மட்டும், சதுரடி கணக்கு |
| Labour + Material — Sqft | ₹ per sq.ft (all inclusive) | வேலை + material, சதுரடி கணக்கு |
| Labour + Material — Itemized | Product line items + labour | வேலை + material, product-wise விலை |

### Quotation Creation Flow

```
Step 1: Select Type
  └── Labour Only / Labour + Material
  └── Salary / Sqft / Itemized

Step 2: Customer Details
  └── Name, Phone, Address, Location

Step 3: Add Rooms
  └── Room name (Hall, Bedroom 1, Kitchen...)
  └── Dimensions (L × W × H in feet)
  └── Doors count + Windows count (auto-deduct area)
  └── Paint type per room:
      - Primer
      - Putty
      - Emulsion (Interior/Exterior)
      - Texture
      - Waterproofing
  └── Can add multiple rooms

Step 4: Pricing
  (For Salary type)
  └── Rate per day/month, estimated days

  (For Sqft type)
  └── Auto-calculated total sqft from rooms
  └── Rate per sqft (painter enters)
  └── Material cost per sqft (if L+M type)

  (For Itemized type)
  └── Product selection from catalog
  └── Quantity auto-suggested from calculator
  └── Labour charges (lump sum or per day)

Step 5: Preview & Terms
  └── Full quotation preview (looks like PDF)
  └── Terms & conditions (editable defaults)
  └── Validity period (7/15/30 days)

Step 6: Generate & Share
  └── Save as draft or finalize
  └── Generate PDF with painter branding
  └── Share via WhatsApp / other apps
```

### Quotation PDF Layout

```
┌────────────────────────────────────┐
│ [Painter Photo]  RAMAN PAINTINGS   │
│ Ph: 98765 43210 | City, State      │
│────────────────────────────────────│
│ QUOTATION                          │
│ No: QT-2026-0042  Date: 05-04-2026│
│────────────────────────────────────│
│ To: Mr. Kumar                      │
│ Ph: 87654 32109                    │
│ Address: 12, Anna Nagar, Chennai   │
│────────────────────────────────────│
│ Type: Labour + Material (Sqft)     │
│────────────────────────────────────│
│ Room        | Sqft | Paint Type    │
│─────────────┼──────┼───────────────│
│ Hall        | 850  | Emulsion      │
│ Bedroom 1   | 420  | Emulsion      │
│ Kitchen     | 280  | Waterproof    │
│ Exterior    | 600  | Exterior Emul │
│─────────────┼──────┼───────────────│
│ Total       | 2150 sqft            │
│────────────────────────────────────│
│ Labour:     ₹ per sqft × 2150     │
│ Material:   ₹ per sqft × 2150     │
│ ───────────────────────────────    │
│ TOTAL:      ₹XX,XXX               │
│────────────────────────────────────│
│ Terms & Conditions:                │
│ 1. 50% advance, 50% on completion │
│ 2. Valid for 15 days               │
│ 3. Excludes scaffolding            │
│────────────────────────────────────│
│ Powered by QC Paint Shop           │
└────────────────────────────────────┘
```

Language selectable: Tamil or English for the PDF output.

## New Feature: Price Match Report

When painter sees a product price in self-billing and knows a lower price elsewhere:

**UI:** "குறைவான விலை கிடைக்கிறதா?" link on each product in estimate/catalog.

**Form fields:**
- Our price (pre-filled, read-only): ₹450
- Lower price found: ₹380
- Shop/Dealer name
- Location/City
- Bill photo proof (camera or gallery upload)
- Optional note

**Backend:** `POST /api/painters/me/price-reports`
- Saves to `painter_price_reports` table
- Notifies admin
- Admin can respond: approve price match / reject with reason
- Painter gets push notification with result

## New Feature: Product Request

When searched product not found in catalog:

**Trigger:** Search returns 0 results → "சேர்க்க கோரிக்கை விட" button appears.

**Form fields:**
- Product name (pre-filled from search query)
- Brand (optional)
- Size/Pack needed (optional)
- Why needed (optional note)

**Backend:** `POST /api/painters/me/product-requests`
- Saves to `painter_product_requests` table
- Notifies admin
- When admin adds product → push notification to requesting painter

## New Feature: Advanced Paint Calculator

### Calculator Flow

```
Step 1: Add Rooms
  └── Room name (preset: Hall, Bedroom, Kitchen, Bathroom, Exterior + Custom)
  └── Shape: Rectangle (default) / L-shape / Custom sqft
  └── Dimensions: Length × Width × Height (feet)
  └── Doors: count × standard size (auto: 21 sqft each)
  └── Windows: count × standard size (auto: 15 sqft each)
  └── Paintable area auto-calculated

Step 2: Select Paint Type per Room
  └── Primer (coats: 1)
  └── Putty (coats: 2)
  └── Emulsion Interior (coats: 2-3)
  └── Emulsion Exterior (coats: 2-3)
  └── Texture (coats: 1)
  └── Waterproofing (coats: 2)
  └── Coverage rate auto-applied per type

Step 3: Results
  └── Room-wise breakdown:
      - Paintable sqft
      - Paint needed per type (liters)
      - Recommended products from catalog (in-stock first)
  └── Total summary:
      - Total area
      - Total paint by type
      - Estimated cost (if products selected)

Step 4: Actions
  └── "Quotation-ஆக மாற்று" → pre-fills quotation with rooms + products
  └── "Estimate-ல் சேர்" → adds products to estimate
  └── "Save" → saves calculation for later
  └── "Share" → summary image via WhatsApp
```

### Coverage Rates (per liter, per coat)

| Paint Type | Coverage (sqft/L) |
|-----------|-------------------|
| Primer | 100-120 |
| Putty | 25-35 |
| Interior Emulsion | 100-120 |
| Exterior Emulsion | 80-100 |
| Texture | 20-40 |
| Waterproofing | 50-60 |

These are configurable from admin settings (stored in `ai_config` with `paint_coverage_` prefix).

## Gamification System

### Levels

| Level | Points Range | Badge Color |
|-------|-------------|-------------|
| Bronze Painter | 0 – 500 | 🟤 Bronze |
| Silver Painter | 501 – 2,000 | ⚪ Silver |
| Gold Painter | 2,001 – 5,000 | 🟡 Gold |
| Diamond Painter | 5,001+ | 💎 Blue |

### Badges (unlock conditions)

- **First Step** — First check-in completed
- **Estimate Pro** — 10 estimates submitted
- **Quotation Master** — 5 quotations sent to customers
- **Streak King** — 30-day check-in streak
- **Calculator Guru** — Used calculator 10 times
- **Referral Star** — 3 successful referrals
- **Gallery Artist** — 5 work photos uploaded
- **Top Earner** — Earned ₹50,000+ in a month
- **Loyal Painter** — 6 months active membership
- **Price Scout** — 3 price match reports submitted

### Weekly Challenges (rotated by admin/system)

Examples:
- "Submit 5 estimates this week — earn 50 bonus points"
- "Check in every day this week — earn 30 bonus points"
- "Upload 2 work photos — earn 20 bonus points"
- "Refer 1 new painter — earn 100 bonus points"

### Leaderboard

- Monthly reset
- Branch-wise + Overall rankings
- Shows: rank, painter name, photo, points, level badge
- Top 3 highlighted with medal icons (🥇🥈🥉)

## Tech Stack

### Dependencies

```kotlin
// Core
androidx.core:core-ktx:1.15.0
androidx.lifecycle:lifecycle-runtime-compose:2.8.0
androidx.activity:activity-compose:1.9.0

// Compose
androidx.compose:compose-bom:2024.12.01
androidx.compose.material3:material3
androidx.compose.ui:ui
androidx.compose.ui:ui-tooling-preview

// Navigation
androidx.navigation:navigation-compose:2.8.0

// Networking
com.squareup.retrofit2:retrofit:2.11.0
com.squareup.retrofit2:converter-gson:2.11.0
com.squareup.okhttp3:okhttp:4.12.0
com.squareup.okhttp3:logging-interceptor:4.12.0

// Local DB
androidx.room:room-runtime:2.6.1
androidx.room:room-ktx:2.6.1
androidx.room:room-compiler:2.6.1 (ksp)

// DI
com.google.dagger:hilt-android:2.51
com.google.dagger:hilt-android-compiler:2.51 (ksp)
androidx.hilt:hilt-navigation-compose:1.2.0

// Image Loading
io.coil-kt:coil-compose:2.7.0

// Firebase
com.google.firebase:firebase-bom:33.7.0
com.google.firebase:firebase-messaging-ktx

// Location
com.google.android.gms:play-services-location:21.3.0

// Animations
com.airbnb.android:lottie-compose:6.4.0

// PDF Generation
com.itextpdf:itext7-core:8.0.0

// In-App Update
com.google.android.play:app-update-ktx:2.1.0

// Splash
androidx.core:core-splashscreen:1.0.1

// DataStore (preferences)
androidx.datastore:datastore-preferences:1.1.0
```

### Architecture

```
app/src/main/java/com/qcpaintshop/painter/
├── QCPainterApp.kt                    # Application class (Hilt)
├── MainActivity.kt                     # Single activity, Compose host
├── navigation/
│   ├── AppNavigation.kt               # NavHost + route definitions
│   ├── BottomNavBar.kt                # 5-tab bottom bar + FAB
│   └── Routes.kt                      # Sealed class of routes
├── data/
│   ├── remote/
│   │   ├── api/
│   │   │   ├── AuthApi.kt            # OTP login/register
│   │   │   ├── DashboardApi.kt       # Dashboard + briefing
│   │   │   ├── EstimateApi.kt        # Estimates CRUD
│   │   │   ├── QuotationApi.kt       # Quotations CRUD (new)
│   │   │   ├── CatalogApi.kt         # Products + offers
│   │   │   ├── AttendanceApi.kt      # Check-in/history
│   │   │   ├── ProfileApi.kt         # Profile + cards
│   │   │   ├── PointsApi.kt          # Points + withdrawals
│   │   │   ├── GamificationApi.kt    # Badges, leaderboard, challenges
│   │   │   ├── TrainingApi.kt        # Training content
│   │   │   ├── NotificationApi.kt    # FCM + notifications
│   │   │   └── PriceReportApi.kt     # Price match + product requests
│   │   ├── interceptor/
│   │   │   └── AuthInterceptor.kt    # Adds X-Painter-Token header
│   │   └── dto/                       # API response models
│   ├── local/
│   │   ├── db/
│   │   │   ├── PainterDatabase.kt    # Room database
│   │   │   ├── dao/                   # DAOs for cached entities
│   │   │   └── entity/               # Room entities
│   │   └── datastore/
│   │       └── UserPreferences.kt    # Auth token, language, settings
│   └── repository/
│       ├── AuthRepository.kt
│       ├── DashboardRepository.kt
│       ├── EstimateRepository.kt
│       ├── QuotationRepository.kt
│       ├── CatalogRepository.kt
│       ├── AttendanceRepository.kt
│       ├── ProfileRepository.kt
│       ├── PointsRepository.kt
│       ├── GamificationRepository.kt
│       └── TrainingRepository.kt
├── domain/
│   └── model/                         # Domain models
├── ui/
│   ├── theme/
│   │   ├── Color.kt
│   │   ├── Type.kt
│   │   ├── Theme.kt
│   │   └── Shape.kt
│   ├── components/                    # Reusable composables
│   │   ├── QCCard.kt
│   │   ├── QCButton.kt
│   │   ├── QCTopBar.kt
│   │   ├── StatusBadge.kt
│   │   ├── PointsDisplay.kt
│   │   ├── LevelBadge.kt
│   │   ├── StreakCounter.kt
│   │   ├── ProductCard.kt
│   │   ├── EmptyState.kt
│   │   ├── LoadingState.kt
│   │   ├── OfflineOverlay.kt
│   │   ├── ConfettiAnimation.kt
│   │   └── VoiceSearchButton.kt
│   ├── auth/
│   │   ├── LoginScreen.kt
│   │   ├── RegisterScreen.kt
│   │   ├── OtpScreen.kt
│   │   └── AuthViewModel.kt
│   ├── home/
│   │   ├── HomeScreen.kt
│   │   ├── HomeViewModel.kt
│   │   └── components/
│   │       ├── EarningsCard.kt
│   │       ├── StatsRow.kt
│   │       ├── CheckInCard.kt
│   │       ├── BriefingCard.kt
│   │       ├── WeeklyChallengeCard.kt
│   │       ├── AchievementsRow.kt
│   │       └── LevelProgress.kt
│   ├── work/
│   │   ├── WorkScreen.kt
│   │   ├── WorkViewModel.kt
│   │   ├── estimates/
│   │   │   ├── EstimateListScreen.kt
│   │   │   ├── EstimateDetailScreen.kt
│   │   │   ├── EstimateCreateScreen.kt
│   │   │   └── EstimateViewModel.kt
│   │   └── quotations/
│   │       ├── QuotationListScreen.kt
│   │       ├── QuotationDetailScreen.kt
│   │       ├── QuotationCreateScreen.kt
│   │       ├── QuotationPreviewScreen.kt
│   │       ├── QuotationViewModel.kt
│   │       └── QuotationPdfGenerator.kt
│   ├── catalog/
│   │   ├── CatalogScreen.kt
│   │   ├── CatalogViewModel.kt
│   │   ├── ProductDetailScreen.kt
│   │   ├── ProductRequestSheet.kt
│   │   └── PriceMatchSheet.kt
│   ├── profile/
│   │   ├── ProfileScreen.kt
│   │   ├── ProfileViewModel.kt
│   │   ├── EditProfileScreen.kt
│   │   ├── GalleryScreen.kt
│   │   ├── ReferralScreen.kt
│   │   ├── LeaderboardScreen.kt
│   │   ├── AchievementsScreen.kt
│   │   ├── SettingsScreen.kt
│   │   └── TrainingScreen.kt
│   ├── calculator/
│   │   ├── CalculatorScreen.kt
│   │   ├── CalculatorViewModel.kt
│   │   ├── RoomInputSheet.kt
│   │   └── CalculatorResultScreen.kt
│   └── attendance/
│       ├── CheckInScreen.kt
│       ├── AttendanceCalendarScreen.kt
│       └── AttendanceViewModel.kt
├── service/
│   ├── QCFirebaseMessagingService.kt  # FCM (existing, adapted)
│   ├── GeofenceLocationService.kt     # Location service (existing, adapted)
│   └── NetworkMonitor.kt             # Connectivity (existing, adapted)
├── util/
│   ├── Constants.kt
│   ├── Extensions.kt
│   ├── DateUtils.kt
│   └── CurrencyFormatter.kt
└── di/
    ├── AppModule.kt                   # Hilt module: Retrofit, Room, DataStore
    └── RepositoryModule.kt            # Hilt bindings for repositories
```

### API Connection

All API calls go to `https://act.qcpaintshop.com/api/painters/`. Authentication via `X-Painter-Token` header (stored in DataStore after OTP login).

### New Backend Endpoints Needed

```
# Quotations
POST   /api/painters/me/quotations              # Create quotation
GET    /api/painters/me/quotations              # List quotations
GET    /api/painters/me/quotations/:id          # Get quotation detail
PUT    /api/painters/me/quotations/:id          # Update quotation
DELETE /api/painters/me/quotations/:id          # Delete quotation
GET    /api/painters/me/quotations/:id/pdf      # Generate PDF

# Price Match Reports
POST   /api/painters/me/price-reports           # Submit price report
GET    /api/painters/me/price-reports           # List my reports

# Product Requests
POST   /api/painters/me/product-requests        # Request new product
GET    /api/painters/me/product-requests        # List my requests

# Gamification
GET    /api/painters/me/gamification            # Level, badges, challenges
GET    /api/painters/me/leaderboard             # Monthly leaderboard
POST   /api/painters/me/challenges/:id/claim    # Claim challenge reward

# Calculator
GET    /api/painters/config/coverage-rates      # Paint coverage config
POST   /api/painters/me/calculations            # Save calculation
GET    /api/painters/me/calculations            # List saved calculations

# Gallery
POST   /api/painters/me/gallery                 # Upload work photo
GET    /api/painters/me/gallery                 # List photos
DELETE /api/painters/me/gallery/:id             # Delete photo
```

### New Database Tables

```sql
-- Quotations
CREATE TABLE painter_quotations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  painter_id INT NOT NULL,
  quotation_number VARCHAR(20) NOT NULL,
  quotation_type ENUM('labour_salary','labour_sqft','labour_material_sqft','labour_material_itemized') NOT NULL,
  customer_name VARCHAR(200),
  customer_phone VARCHAR(20),
  customer_address TEXT,
  rooms_data JSON,
  labour_rate DECIMAL(10,2),
  labour_rate_type ENUM('daily','monthly','per_sqft') DEFAULT 'per_sqft',
  material_cost_per_sqft DECIMAL(10,2),
  total_sqft DECIMAL(10,2),
  labour_total DECIMAL(10,2),
  material_total DECIMAL(10,2),
  grand_total DECIMAL(10,2),
  terms_conditions TEXT,
  validity_days INT DEFAULT 15,
  language ENUM('ta','en') DEFAULT 'ta',
  status ENUM('draft','sent','accepted','rejected','expired') DEFAULT 'draft',
  pdf_url VARCHAR(500),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (painter_id) REFERENCES painters(id),
  INDEX idx_painter_status (painter_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Quotation line items (for itemized type)
CREATE TABLE painter_quotation_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  quotation_id INT NOT NULL,
  zoho_item_id VARCHAR(50),
  item_name VARCHAR(300),
  brand VARCHAR(100),
  quantity DECIMAL(10,2),
  unit_price DECIMAL(10,2),
  line_total DECIMAL(10,2),
  display_order INT DEFAULT 0,
  FOREIGN KEY (quotation_id) REFERENCES painter_quotations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Price match reports
CREATE TABLE painter_price_reports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  painter_id INT NOT NULL,
  zoho_item_id VARCHAR(50),
  product_name VARCHAR(300),
  our_price DECIMAL(10,2),
  reported_price DECIMAL(10,2),
  shop_name VARCHAR(200),
  shop_location VARCHAR(300),
  proof_photo_url VARCHAR(500),
  note TEXT,
  status ENUM('pending','approved','rejected') DEFAULT 'pending',
  admin_response TEXT,
  matched_price DECIMAL(10,2),
  reviewed_by INT,
  reviewed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (painter_id) REFERENCES painters(id),
  INDEX idx_painter (painter_id),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Product requests
CREATE TABLE painter_product_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  painter_id INT NOT NULL,
  product_name VARCHAR(300) NOT NULL,
  brand VARCHAR(100),
  size_needed VARCHAR(100),
  note TEXT,
  status ENUM('pending','added','rejected') DEFAULT 'pending',
  added_product_id INT,
  reviewed_by INT,
  reviewed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (painter_id) REFERENCES painters(id),
  INDEX idx_painter (painter_id),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Gamification badges
CREATE TABLE painter_badges (
  id INT AUTO_INCREMENT PRIMARY KEY,
  badge_key VARCHAR(50) NOT NULL UNIQUE,
  name_en VARCHAR(100) NOT NULL,
  name_ta VARCHAR(100) NOT NULL,
  description_en VARCHAR(300),
  description_ta VARCHAR(300),
  icon VARCHAR(50),
  unlock_condition VARCHAR(200),
  category VARCHAR(50) DEFAULT 'general',
  sort_order INT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Painter earned badges
CREATE TABLE painter_earned_badges (
  id INT AUTO_INCREMENT PRIMARY KEY,
  painter_id INT NOT NULL,
  badge_id INT NOT NULL,
  earned_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY unique_painter_badge (painter_id, badge_id),
  FOREIGN KEY (painter_id) REFERENCES painters(id),
  FOREIGN KEY (badge_id) REFERENCES painter_badges(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Weekly challenges
CREATE TABLE painter_challenges (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title_en VARCHAR(200) NOT NULL,
  title_ta VARCHAR(200) NOT NULL,
  description_en TEXT,
  description_ta TEXT,
  challenge_type VARCHAR(50),
  target_count INT NOT NULL,
  reward_points INT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Painter challenge progress
CREATE TABLE painter_challenge_progress (
  id INT AUTO_INCREMENT PRIMARY KEY,
  painter_id INT NOT NULL,
  challenge_id INT NOT NULL,
  current_count INT DEFAULT 0,
  completed TINYINT(1) DEFAULT 0,
  claimed TINYINT(1) DEFAULT 0,
  completed_at TIMESTAMP NULL,
  claimed_at TIMESTAMP NULL,
  UNIQUE KEY unique_painter_challenge (painter_id, challenge_id),
  FOREIGN KEY (painter_id) REFERENCES painters(id),
  FOREIGN KEY (challenge_id) REFERENCES painter_challenges(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Painter gallery (work showcase)
CREATE TABLE painter_gallery (
  id INT AUTO_INCREMENT PRIMARY KEY,
  painter_id INT NOT NULL,
  photo_url VARCHAR(500) NOT NULL,
  category ENUM('interior','exterior','texture','waterproofing','other') DEFAULT 'interior',
  description VARCHAR(500),
  is_before TINYINT(1) DEFAULT 0,
  pair_id INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (painter_id) REFERENCES painters(id),
  INDEX idx_painter (painter_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Saved calculations
CREATE TABLE painter_calculations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  painter_id INT NOT NULL,
  calculation_data JSON NOT NULL,
  total_sqft DECIMAL(10,2),
  total_paint_liters DECIMAL(10,2),
  estimated_cost DECIMAL(10,2),
  converted_to VARCHAR(20),
  converted_id INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (painter_id) REFERENCES painters(id),
  INDEX idx_painter (painter_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add level/gamification columns to painters table
ALTER TABLE painters
  ADD COLUMN level VARCHAR(20) DEFAULT 'bronze',
  ADD COLUMN total_lifetime_points INT DEFAULT 0;
```

### Offline Strategy (Room DB)

Cache these entities locally for offline viewing:
- Painter profile
- Dashboard summary
- Estimates list (last 50)
- Quotations list (last 50)
- Product catalog (full, synced daily)
- Points balance
- Badges earned
- Training content list

**Sync strategy:** Pull on app open + pull-to-refresh. No offline writes — show "Internet required" toast for create/submit actions.

### Localization

Two `strings.xml` files:
- `values/strings.xml` — English (fallback)
- `values-ta/strings.xml` — Tamil

Language toggle stored in DataStore. App recreates activity on language change.

Key string examples:
```xml
<!-- English -->
<string name="tab_home">Home</string>
<string name="tab_work">Work</string>
<string name="tab_new">New</string>
<string name="tab_catalog">Catalog</string>
<string name="tab_me">Me</string>
<string name="check_in">Check In</string>
<string name="points">Points</string>
<string name="lower_price_found">Found a lower price?</string>
<string name="request_product">Request to add</string>
<string name="add_to_estimate">Add to Estimate</string>

<!-- Tamil -->
<string name="tab_home">முகப்பு</string>
<string name="tab_work">வேலை</string>
<string name="tab_new">புதிய</string>
<string name="tab_catalog">கேட்டலாக்</string>
<string name="tab_me">நான்</string>
<string name="check_in">செக் இன்</string>
<string name="points">புள்ளிகள்</string>
<string name="lower_price_found">குறைவான விலை கிடைக்கிறதா?</string>
<string name="request_product">சேர்க்க கோரிக்கை</string>
<string name="add_to_estimate">Estimate-ல் சேர்</string>
```

## Build Configuration

- **App ID:** `com.qcpaintshop.painter` (unchanged)
- **Min SDK:** 24 (Android 7.0)
- **Target SDK:** 35 (Android 15)
- **Version:** 2.0.0 (versionCode 10)
- **Signing:** Existing `qcpaintshop-release.jks`

No product flavors needed — this is a standalone painter app (no staff/customer variants).

## Migration Path

1. Build new app in separate module/project
2. Keep same app ID (`com.qcpaintshop.painter`)
3. Increment versionCode (10)
4. Existing painters auto-update via Play Store
5. Backend remains same — new endpoints added alongside existing ones

## File List

### New Files (Android — ~80 files)
All under `app/src/main/java/com/qcpaintshop/painter/` as listed in Architecture section above.

### New Files (Backend)
1. `migrations/migrate-painter-quotations.js`
2. `migrations/migrate-painter-gamification.js`
3. `migrations/migrate-painter-gallery-pricematch.js`
4. Routes added to existing `routes/painters.js`

### Modified Files (Backend)
1. `routes/painters.js` — Add quotation, price-report, product-request, gamification, gallery, calculator endpoints
2. `services/painter-points-engine.js` — Add badge checking, level calculation, challenge progress tracking
3. `services/painter-notification-service.js` — Add notifications for price match response, product availability, challenge completion, level-up
