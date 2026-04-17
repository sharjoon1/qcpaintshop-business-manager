# Painter Android App — UI/UX Upgrade (Sub-project B) Design Spec

**Date:** 2026-04-17  
**Status:** Approved  
**Version target:** v3.0.0  
**Approach:** 3 — Theme layer first (Step 1), then targeted screen rewrites (Step 2), then polish (Step 3)  
**Design direction:** Premium Hybrid — Material 3 structure + QC brand colors (green/gold)

---

## Overview

Upgrade the Painter Android app (`com.qcpaintshop.painter`) UI/UX to enterprise-level quality. Three-step delivery:
- **Step 1:** Global theme layer (colors, typography, shapes)
- **Step 2:** 4 high-impact screen rewrites (Home, Catalog, Training, Check-in)
- **Step 3:** Polish remaining screens (Profile, Work, Points History, Edit Profile, Notifications)

Android project: `D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\qcpaintshop-android\`

---

## Step 1 — Theme Layer

### File: `app/src/main/java/com/qcpaintshop/painter/ui/theme/Color.kt`

```kotlin
// Primary greens
val PrimaryGreen = Color(0xFF1B5E3B)
val PrimaryDark  = Color(0xFF0D3D23)
val PrimaryLight = Color(0xFF2D8A5E)
val PrimaryContainer = Color(0xFFDCFCE7)

// Gold accent
val Gold      = Color(0xFFD4A24E)
val GoldLight = Color(0xFFFDE68A)
val GoldContainer = Color(0xFFFEF3C7)

// Surfaces
val SurfaceCard = Color(0xFFFFFFFF)
val BackgroundApp = Color(0xFFF0FDF4)
val SurfaceVariant = Color(0xFFF9FAFB)

// Semantic (unchanged)
val ErrorRed  = Color(0xFFDC2626)
val SuccessGreen = Color(0xFF16A34A)
val WarningAmber = Color(0xFFD97706)
val InfoBlue  = Color(0xFF2563EB)
```

### File: `ui/theme/Type.kt`
- Font: **Poppins** via Google Fonts (`fonts/poppins_*.ttf` or `downloadableFonts`)
- Display/Headline: weight 700
- Body: weight 400
- Label/Caption: weight 500

### File: `ui/theme/Shape.kt`
```kotlin
val CardShape    = RoundedCornerShape(12.dp)
val ButtonShape  = RoundedCornerShape(10.dp)
val ChipShape    = RoundedCornerShape(999.dp)
val SheetShape   = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp)
val HeroShape    = RoundedCornerShape(16.dp)
```

### File: `ui/theme/Theme.kt`
- `MaterialTheme` with `colorScheme` mapped to above colors
- Card elevation: `2.dp`, shadow `0.08f alpha`
- Bottom navigation background: white, indicator: `PrimaryContainer`

---

## Step 2A — Home Screen Rewrite

### File: `ui/home/HomeScreen.kt`

**Layout (LazyColumn, top to bottom):**

### 1. Hero Card
Full-width, `HeroShape`, gradient brush `(PrimaryDark → PrimaryGreen)`:
- **Row 1:** Profile photo (40dp circle, `CircleShape`) + "Good morning, [firstName]" (16sp 700) + NotificationBell icon (badge count)
- **Row 2:** Level badge pill (`Gold` bg, white text: "🥇 Gold Painter") + Streak chip ("🔥 12 days")
- **Row 3:** 2-column balance grid inside card:
  - Left: Regular pts — white text, label "Regular Points"
  - Right: Annual pts — `GoldLight` text, label "Annual Points"
- **Bottom:** `LinearProgressIndicator` (white, 4dp height) showing progress to next level, with label "X pts to [next level]"

### 2. Quick Actions Row
4 equal-width white cards (`CardShape`, elevation 2dp), horizontal, no scroll:
- **Check-in** — paint can SVG + "Check in"
- **Estimate** — document SVG + "Estimate"
- **Withdraw** — wallet SVG + "Withdraw"
- **Refer** — share SVG + "Refer"

Each card: icon (24dp, `PrimaryGreen`) + label (10sp, gray). Tap → navigate to respective screen.

### 3. Offers Strip
- Heading row: "🔥 Active Offers" + "See all →" link
- `LazyRow` of offer cards (200×80dp, `CardShape`):
  - Brand name (bold) + bonus description + `Gold` end-date chip
  - Background: brand-color tint

### 4. This Month Stats
Single full-width card, 3-chip row:
- `₹[amount] earned` (green) · `[n] check-ins` (blue) · `[n] estimates` (purple)

### 5. Recent Activity Feed
- Heading: "Recent Activity" + "See all →"
- Last 5 items (estimates + points transactions), grouped by date with sticky date labels
- Each row: type icon + description + amount/status + time ago

### 6. Bottom padding: `80.dp` (FAB clearance)

### FAB (Center, Bottom Nav)
- `FloatingActionButton`, `PrimaryGreen`, paint can SVG icon (24dp, white)
- Tap → `ModalBottomSheet` with 4 action rows:
  - ✅ Check-in | 📝 New Estimate | 📋 New Quotation | 🧮 Calculator

---

## Step 2B — Catalog Screen Rewrite

### Files: `ui/catalog/CatalogScreen.kt`, `ui/catalog/ProductDetailSheet.kt`

### Search Bar
Full-width `OutlinedTextField`, `ChipShape`, mic icon end slot (Tamil voice search via `SpeechRecognizer`).

### Filter Chips
`LazyRow`, horizontal scroll:
- Brand chips + Category chips separated by vertical divider
- Selected chip: `PrimaryGreen` bg, white text
- Unselected: white bg, gray border

### Product Grid
`LazyVerticalGrid(columns = Fixed(2))`, `8.dp` spacing

**Enterprise Card v8** per product:
```
┌────────────────────────┐
│  [brand-gradient bg]   │ ← 60dp height
│    [paint can SVG]     │   gradient auto from brand:
│           [+42⭐ gold] │   Asian Paints=green, Berger=blue,
│                        │   Kansai=red, Nippon=orange
├────────────────────────┤
│ Product Name (bold)    │
│ Category (gray 10sp)   │
│ [4L] [10L] ●[20L]     │ ← chips, biggest pre-selected
│ ₹2,200                 │ ← updates on chip tap
└────────────────────────┘
```

**Variant chip behavior:**
- Biggest volume variant selected by default on load
- Chip tap → update displayed price (local state, no API call)
- Selected chip: `PrimaryGreen` bg; unselected: `PrimaryContainer` bg

**Tap card** → `ProductDetailSheet` (modal bottom sheet, `SheetShape`)

### Product Detail Sheet
- **Header:** brand-gradient full-width strip (120dp) with paint can SVG + product name overlay
- **Variants section:** `LazyRow` of size+price chips, all selectable
- **Earnings breakdown** (2 rows):
  - Customer billing: `X pts per unit` (regular pool)
  - Self billing: `Y pts per unit` (annual pool only)
- **Active offer** (if any): gold card with offer description + end date
- **Actions row:** "Add to Estimate" (`PrimaryGreen` filled) + "Request Product" (outline)

---

## Step 2C — Training Screen Rewrite

### Files: `ui/profile/TrainingScreen.kt`, `ui/profile/TrainingDetailScreen.kt`

### Search Bar
Full-width, 300ms debounce.

### Category Chips
`LazyRow` of category chips (loaded from API). "All" first, always.
Selected chip: `PrimaryGreen`. Chips: All · Product Knowledge · Painting Techniques · Safety · Business Tips

### Featured Videos Section (All category only)
- Heading: "Featured Videos"
- `LazyRow` of video cards (240×140dp):
  - YouTube thumbnail (`https://img.youtube.com/vi/[id]/mqdefault.jpg`) via `Coil`
  - White play button overlay (40dp circle)
  - Title (12sp, 2-line clamp) at bottom with dark gradient scrim
  - View count badge (top-right)

### Guides & Articles List
`LazyColumn` of cards:
- Left badge: VIDEO (green) / PDF (red) / ARTICLE (blue) — 8sp uppercase label
- Center: title (13sp 600) + summary (11sp gray, 2-line clamp) + category chip
- Right: view count (10sp gray)

### Tamil Toggle
`Switch` or chip in top bar: EN ↔ தமிழ் — switches `title` vs `title_ta`, `summary` vs `summary_ta` throughout.

### Detail Screen
- VIDEO: `AndroidView` wrapping YouTube `WebView` (`https://www.youtube.com/embed/[id]`)
- PDF: `LaunchEffect` → `Intent(ACTION_VIEW, pdfUrl)` using system viewer
- ARTICLE: `HtmlText` composable for rich text + image

---

## Step 2D — Check-in Screen Rewrite

### File: `ui/attendance/CheckInScreen.kt`

### Pre check-in State
- Header card: dark green gradient, "Today's Check-in" + date
- Location status card (white):
  - `CircularProgressIndicator` while acquiring GPS
  - "📍 Ready" when location acquired
  - Distance to nearest branch shown (e.g. "0.3km from QC Main Branch")
- Large circular button (80dp): `PrimaryGreen` gradient + paint can SVG (32dp, white)
- Stats row below: "🔥 [n] day streak · [n] check-ins this month"

### Loading State
- Button: pulsing `animateFloat` scale (0.95↔1.0, 600ms)
- "Verifying location…" `AnimatedVisibility` text

### Success State (full-screen `AnimatedVisibility` overlay)
- Background: dark green semi-transparent
- Center: large ✅ checkmark (`animateFloat` scale in, 300ms spring)
- Confetti: 30 particles (green + gold `Canvas`-drawn circles, fall animation, 2s duration)
- "Checked in! ✓" heading (24sp 700, white)
- Location name + time (14sp, white 70%)
- `+10 pts` gold pill badge
- Auto-dismiss after 2.5s → `popBackStack()`

### Photo Capture (after success)
`ModalBottomSheet` auto-shown after success overlay:
- "Add a work photo?" heading (optional)
- Camera button + Gallery button (side by side)
- "Skip" `TextButton`

### Error States
- Too far: `Card(ErrorRed tint)` — "You're [X.X]km away. Must be within 500m of branch."
- Permission denied: `Card(WarningAmber tint)` — rationale + "Open Settings" button
- Already checked in: `Card(InfoBlue tint)` — "Already checked in today at [time]"

---

## Step 3 — Polish Screens

### Profile Screen (`ui/profile/ProfileScreen.kt`)
- Hero: full-width gradient card (same as home hero), photo + name + level + points summary
- Menu groups with `HorizontalDivider`:
  - **Cards & Identity:** My Cards, My Referrals
  - **Earnings:** Points History, Withdraw, Leaderboard
  - **Learning:** Training, Achievements
  - **Account:** Attendance Calendar, Edit Profile, Settings
  - **Danger zone:** Logout (red text)
- Each menu row: leading icon (`PrimaryGreen`, 20dp) + label + trailing chevron

### Work Screen (`ui/work/WorkScreen.kt`)
- Tab bar: pill-style toggle (Estimates | Quotations), `PrimaryGreen` active
- Estimate card: left border `4.dp` in status color + estimate number + customer name + amount (bold) + status badge
- Empty state: paint can SVG illustration + message + "Create" button

### Points History (`ui/profile/PointsHistoryScreen.kt`)
- Top: 2 large summary cards — Regular (green) | Annual (gold)
- Filter chips: All · Regular · Annual
- `LazyColumn` grouped by month (sticky `stickyHeader`):
  - Each row: source label + `+₹X` (green) or `−₹X` (red) + date + running balance (gray)

### Edit Profile (`ui/profile/EditProfileScreen.kt`)
- Add missing fields: **Specialization** `DropdownMenuBox` (Both/Interior/Exterior/Industrial), **Experience** `OutlinedTextField` (years), **District** text field, **Pincode** text field (6-digit numeric)
- Profile photo: current image + camera icon overlay (`FloatingActionButton` small, bottom-right of photo)

### Notifications (`ui/notifications/NotificationsScreen.kt`)
- Left border per type: `PrimaryGreen`=points, `Gold`=offer, `InfoBlue`=estimate, `ErrorRed`=alert
- Unread: white bg; Read: `SurfaceVariant` bg
- Deep link routing: tap → navigate by `notification.data.url` type

---

## Brand Colors for Product Gradient (Catalog)

| Brand | Gradient |
|-------|---------|
| Asian Paints | `0xFF0D3D23 → 0xFF1B5E3B` (QC green) |
| Berger | `0xFF1e3a6e → 0xFF2563eb` (blue) |
| Kansai Nerolac | `0xFF7f1d1d → 0xFFdc2626` (red) |
| Nippon | `0xFF7c2d12 → 0xFFea580c` (orange) |
| Indigo | `0xFF312e81 → 0xFF6366f1` (indigo) |
| Default | `0xFF374151 → 0xFF6b7280` (gray) |

---

## Version Bump
- `versionName = "3.0.0"`, `versionCode = 12`
- Update `buildConfig` string `APP_VERSION`

---

## Files Changed Summary

| Step | Files |
|------|-------|
| 1 | `ui/theme/Color.kt`, `ui/theme/Type.kt`, `ui/theme/Shape.kt`, `ui/theme/Theme.kt` |
| 2A | `ui/home/HomeScreen.kt`, `HomeViewModel.kt` |
| 2B | `ui/catalog/CatalogScreen.kt`, `ui/catalog/ProductDetailSheet.kt`, `CatalogViewModel.kt` |
| 2C | `ui/profile/TrainingScreen.kt`, `TrainingDetailScreen.kt`, `TrainingViewModel.kt` |
| 2D | `ui/attendance/CheckInScreen.kt`, `CheckInViewModel.kt` |
| 3 | `ui/profile/ProfileScreen.kt`, `ui/work/WorkScreen.kt`, `ui/profile/PointsHistoryScreen.kt`, `ui/profile/EditProfileScreen.kt`, `ui/notifications/NotificationsScreen.kt` |

---

## Out of Scope (Sub-project A — next phase)
- Missing feature screens (Offer Products page, Attendance photo+stats, Price reporting, Gallery delete)
- New API endpoints
- Play Store publish (Sub-project C)
