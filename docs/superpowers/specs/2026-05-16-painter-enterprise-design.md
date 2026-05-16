# QC Painter App — Enterprise Design Redesign

**Date:** 2026-05-16  
**Branch:** `design/painter-app-ux-2026-05`  
**Scope:** Full creative screen-by-screen redesign — 19 screens, 9 goals (A–I)  
**Approach:** Approach B — Creative Screen-by-Screen Redesign  

---

## 1. Design Language

### 1.1 Personality
"Professional Craftsman's Tool" — a premium instrument for working painters, not a consumer app. Feels like a high-quality paint chip card: precise edges, rich color blocks, clear labeling.

### 1.2 Inspiration
Asian Paints Colorxpert Pro, Sherwin-Williams ColorSnap — trade apps used by paint professionals.

### 1.3 Brand Colors (unchanged)
| Token | Value | Usage |
|---|---|---|
| QCGreen | `#1B5E3B` | Hero backgrounds, CTAs, brand moments, accent borders/icons in dark mode |
| QCGold | `#D4A24E` | Earnings, loyalty points, rewards ONLY — never decorative |
| QCForest | `#0D3D23` | Dark CTA variants, hero gradient end |

### 1.4 Design Principles
- **Paint-industry identity** — color swatches, bold pricing, warm gold for earnings
- **Gold = earnings only** — creates Pavlovian reward association; never used decoratively
- **Instant feel** — 200ms max animation, no bounce; painters are on-site and time-pressured
- **WCAG AA everywhere** — all text/background combos meet 4.5:1 minimum, both modes

---

## 2. Color System

### 2.1 Light Mode Tokens
| Token | Value | Usage |
|---|---|---|
| QCBackground | `#FFFFFF` | Screen background |
| QCSurface | `#F9FAFB` | Card/list background |
| QCTextPrimary | `#1A2E20` | Body text, titles |
| QCTextSecondary | `#6B7280` | Labels, captions |
| QCDivider | `#E5E7EB` | Dividers, borders |

### 2.2 Dark Mode Tokens (rebuilt from scratch)
| Token | Value | Usage |
|---|---|---|
| QCBackgroundDark | `#0F1A14` | Screen background (green-tinted near-black) |
| QCSurfaceDark | `#182518` | Card background (level 1) |
| QCSurfaceDark2 | `#1E2E1E` | Elevated card (level 2) |
| QCDividerDark | `#263826` | Dividers |
| QCTextPrimaryDark | `#E8EFE6` | Primary text on dark — WCAG 7:1 vs background |
| QCTextSecondaryDark | `#9DB89E` | Secondary text — WCAG 4.5:1 |
| QCTextDisabledDark | `#4A6B4F` | Disabled text |

**Critical rule:** QCGreen (`#1B5E3B`) is NEVER used as text color on dark backgrounds. It is used only as accent borders, icon tints, and CTA button backgrounds in dark mode.

### 2.3 Semantic Colors (both modes)
| Token | Value | Usage |
|---|---|---|
| StatusPending | `#F59E0B` | Amber — pending/awaiting |
| StatusConfirmed | `#1B5E3B` | Green — confirmed/success |
| StatusPaid | `#3B82F6` | Blue — paid/complete |
| StatusRejected | `#EF4444` | Red — rejected/error |

---

## 3. Typography Scale

| Style | Size | Weight | Usage |
|---|---|---|---|
| heroTitle | 24sp | ExtraBold (800) | Screen hero title |
| sectionHeading | 18sp | Bold (700) | Section headers |
| itemTitle | 15sp | SemiBold (600) | Product/item names |
| bodyText | 13sp | Regular (400) | Body copy, descriptions |
| priceDisplay | 20sp | ExtraBold (800) | Price in QCGreen |
| labelCaps | 11sp | Bold (700), uppercase, 0.08em tracking | Chips, labels |

MD3 line-heights kept as baseline — no bumping above defaults.

---

## 4. Screen Redesign Specifications

### Goal A — Color Token Foundation (Day 1)

**Files:** `ui/theme/Color.kt`, `ui/theme/Theme.kt`, `ui/catalog/ProductDetailSheet.kt`, `ui/work/CreateNewSheet.kt`

**Deliverables:**
- Add all QCSurfaceDark2, QCDividerDark, QCTextPrimaryDark, QCTextSecondaryDark, QCTextDisabledDark tokens to Color.kt
- Update Theme.kt darkColorScheme to use new tokens for background, surface, onSurface, onSurfaceVariant
- ProductDetailSheet: replace all QCGreen text references with `MaterialTheme.colorScheme.onSurface` (resolves to QCTextPrimaryDark in dark)
- ProductDetailSheet price table: alternating row tint using QCSurfaceDark2, price column bold, points row gold highlight with ★ icon
- CreateNewSheet: use `MaterialTheme.colorScheme.surface` for sheet background (elevated surface in dark = lighter than background), menu item text uses `onSurface`

**Acceptance:** Screenshots 1, 2, 3 issues from user report are fully resolved. All dark mode text passes WCAG 4.5:1.

---

### Goal B — Auth Flow Redesign (Day 1–2)

**Files:** `ui/auth/LoginScreen.kt`, `ui/auth/AwaitingApprovalScreen.kt`, `ui/onboarding/OnboardingScreen.kt` (new)

**LoginScreen:**
- Full-screen QCGreen hero top half with brand wordmark + paint-brush icon (use `Icons.Rounded.Brush` or similar Material icon at 80dp white; no external asset required)
- Bottom sheet white/surface panel for input
- Phone input: outlined field, 48dp height, `+91` prefix chip
- OTP step: 6× 56dp digit boxes, gold focus ring (`QCGold` border 2dp when focused)
- Step transition: horizontal slide (300ms) with fade
- Back gesture on OTP step returns to phone entry

**AwaitingApprovalScreen:**
- Pulsing animation ring (QCGreen, 3s repeat) around status icon
- Timeline row: 3 steps — "Registered ✓" → "Under Review ●" → "Approved ○"
- Active step label in QCGreen, future steps in QCTextSecondary
- PullToRefreshBox with visible spinner

**OnboardingScreen (new — shown only on first login after approval):**
- 3 pages: "Earn Points on Every Sale" / "Track All Your Work" / "Get Paid Faster"
- Each page: full-screen gradient background, centered Material icon (80dp white — page 1: `Brush`, page 2: `Assignment`, page 3: `AccountBalanceWallet`), bold white title 22sp, subtitle 14sp white 80% opacity
- Page indicator dots at bottom, "Skip" text button top-right
- Stored preference: `onboarding_complete` DataStore key → never show again after dismissed

---

### Goal C — Home Screen Redesign (Day 2–3)

**Files:** `ui/home/HomeScreen.kt`, `ui/home/components/HeroCard.kt`, `ui/home/components/QuickActionsRow.kt`, `ui/home/components/StreakSheet.kt`

**HeroCard:**
- Gradient background: `#1B5E3B` → `#0D3D23` (135°)
- Row 1: Painter photo (40dp circle) + greeting text + time greeting (Tamil)
- Row 2: Painter name 20sp ExtraBold white
- Row 3: Level badge chip (tier color) + branch name
- Row 4: Gold points strip — "★ 4,250 pts" in QCGold 18sp Bold
- Rounded bottom corners 20dp

**QuickActionsRow:**
- 4 actions: New Estimate, Catalog, Check In, Profile
- Each: 56dp icon tile (QCGreen filled circle) + label below 11sp
- Tap: scale animation 0.95× (100ms) + haptic

**Sections:**
- "Active Offers": horizontal scroll, paint-chip style cards (color block top + details below)
- All section headers: 15sp Bold left + "See all →" 12sp QCGreen right, vertically centered

**StreakSheet:**
- 7-column calendar grid (Sun–Sat), dots: green=checked-in, amber=missed, empty=future
- Fire emoji + streak count 28sp ExtraBold + "day streak" label in QCGold
- Motivational copy based on streak number (0: "Start your streak today!", 1–6: "Keep it going!", 7+: "On fire!")

---

### Goal D — Catalog + Product Redesign (Day 3–4)

**Files:** `ui/catalog/CatalogScreen.kt`, `ui/catalog/ProductDetailSheet.kt`, `ui/catalog/components/ProductCard.kt`

**CatalogScreen:**
- Search bar: rounded 12dp, 48dp height, search icon left, clear ✕ right
- Filter chips row: horizontal scroll, solid pill design — unselected: outlined QCGreen, selected: QCGreen filled white text
- Layout toggle: list (default) / 2-column grid icon in toolbar
- Product cards (list): color swatch circle 36dp left + product name bold + brand chip + price right + "In Stock" green chip

**ProductCard (grid mode):**
- Paint-chip style: color block header 60dp height (swatch color or QCGreen gradient) + white body
- Product name 13sp SemiBold, brand 11sp secondary, price 15sp ExtraBold QCGreen

**ProductDetailSheet (dark mode fully fixed):**
- Sheet background: `MaterialTheme.colorScheme.surface` (QCSurfaceDark in dark)
- All text: `MaterialTheme.colorScheme.onSurface` and `onSurfaceVariant`
- Brand: logo-style chip (QCSurface2 bg, QCTextSecondary text)
- Category: colored tag pill
- Price table: alternating rows (surface / surface2), header row QCGreen bg white text, price column 15sp Bold
- Points row: gold `#D4A24E` background tint, ★ icon, gold text

---

### Goal E — Work + Estimates Redesign (Day 4–5)

**Files:** `ui/work/WorkScreen.kt`, `ui/work/CreateNewSheet.kt`, `ui/work/estimates/EstimateCreateScreen.kt`, `ui/work/estimates/EstimateDetailScreen.kt`

**WorkScreen:**
- Estimate list cards: left border 4dp status color (pending=amber, confirmed=green, paid=blue)
- Status chip top-right of card: colored bg, bold text
- Customer name 15sp Bold, estimate total 16sp ExtraBold QCGreen
- Empty state: paint roller illustration + "Create your first estimate" + CTA button

**CreateNewSheet (dark mode fixed):**
- `ModalBottomSheet` with `containerColor = MaterialTheme.colorScheme.surface`
- Menu items: 48dp icon (QCGreen tint) left + title `onSurface` text + chevron right
- Items: New Estimate, New Quotation, Mark Attendance, Paint Calculator
- Divider between items: `QCDivider` / `QCDividerDark`

**EstimateCreateScreen:**
- Sticky top bar: search field + active filter count badge
- Filter chips: Brand, Category, Points-only toggle
- Cart section: collapsible card with item count badge, shows subtotal
- Product rows: color swatch dot + name + size chip + price + "Add" button

---

### Goal F — Attendance Redesign (Day 5)

**Files:** `ui/attendance/AttendanceScreen.kt`, `ui/attendance/CheckInScreen.kt`, `ui/attendance/AttendanceHistoryScreen.kt`

**AttendanceScreen:**
- Hero section: 120dp circular check-in button — QCGreen fill, white camera icon 40dp, shadow elevation
- Already checked-in state: green checkmark animation + "Checked in at 9:04 AM"
- Streak display: 🔥 emoji + streak number 28sp ExtraBold + "day streak" QCGold label
- Monthly mini-calendar: 7-column grid, dots below each day (green/amber/none)

**CheckInScreen (camera):**
- Camera preview full-screen
- Capture button: 72dp white outer ring, QCGreen inner circle 56dp
- Location chip overlay bottom: GPS coordinates or "Getting location..."
- Success animation: full-screen QCGreen overlay with animated ✓ (500ms) then auto-navigate

**AttendanceHistoryScreen:**
- Month headers: "May 2026 — மே" bold + attendance % chip right ("22/23 days — 96%")
- Each row: date left + time bold + AP earned chip right + selfie thumbnail 36dp circle

---

### Goal G — Profile + Settings + Achievements (Day 5–6)

**Files:** `ui/profile/ProfileScreen.kt`, `ui/profile/EditProfileScreen.kt`, `ui/profile/SettingsScreen.kt`, `ui/profile/AchievementsScreen.kt`

**ProfileScreen:**
- Full-bleed header card: QCGreen gradient, painter photo 72dp circle (white border 3dp) left
- Name 18sp Bold white, level+branch subtitle white 70% opacity right of photo
- Tier badge below name: gradient border (bronze=#CD7F32 / silver=#C0C0C0 / gold=#D4A24E / diamond=#B9F2FF)
- Stats row inside header: "Estimates | Earnings | Streak" — numbers Bold gold, labels white small
- Menu items below: icon + label + value/chevron

**EditProfileScreen:**
- Photo: circular crop preview 100dp, "Change Photo" overlay on tap
- Fields: MD3 OutlinedTextField with floating labels
- Unsaved changes banner: sticky bottom with "Save" and "Discard" buttons

**SettingsScreen:**
- Grouped sections with headers: Appearance / Notifications / Account / About
- Dark mode: 3-way segmented control — "Light | Auto | Dark" (replaces switch)
- Each group in a rounded card, dividers between items

**AchievementsScreen:**
- Badge grid 3 columns
- Earned: full color icon + gold glow shadow + unlock date below
- Locked: grayscale + 50% opacity + lock icon overlay center
- Under each locked badge: linear progress bar (QCGreen) showing completion %

---

### Goal H — Loyalty + Points + Withdrawal (Day 6)

**Files:** `ui/profile/LoyaltyScreen.kt`, `ui/profile/PointsHistoryScreen.kt`, `ui/profile/WithdrawalScreen.kt`

**LoyaltyScreen:**
- Tier progress track: horizontal bar with 4 nodes (Bronze 0 → Silver 5K → Gold 25K → Diamond 100K)
- Current position: filled QCGreen up to current tier, node glow for active tier
- Points needed to next tier shown below track
- Benefits list per tier: checkmark rows

**PointsHistoryScreen:**
- Grouped by month with sticky month headers
- Transaction rows: + (gold) or - (red) amount large left, description right, date small
- Regular vs Annual tagged with chip

**WithdrawalScreen:**
- Large gold balance display top: "★ 4,250 pts available" 28sp ExtraBold QCGold
- Amount input: large centered input 32sp
- Quick chips row: ₹500 / ₹1,000 / ₹2,000 (tap to fill)
- Confirm button: QCGreen, disabled until amount valid

---

### Goal I — Final Polish + APK Build (Day 7)

**Deliverables:**
- Cross-screen consistency pass: spacing, typography, color usage
- WCAG contrast audit: all screens both modes — automated check where possible
- versionCode 38, versionName "3.5.0" in painter flavor
- `assemblePainterRelease` build with `-Xmx3072m -XX:+UseSerialGC --no-daemon`
- APK delivered to Telegram chat 930726256 via @qualitycoloursbot

---

## 5. Architecture Notes

- All color usage via `MaterialTheme.colorScheme.*` — never hardcoded hex in composables
- Dark mode: `darkColorScheme { background = QCBackgroundDark; surface = QCSurfaceDark; onSurface = QCTextPrimaryDark; onSurfaceVariant = QCTextSecondaryDark }`
- Animations: `tween(200)` easing for all transitions, no `spring()` bounce
- New OnboardingScreen: standalone Composable, NavGraph entry `onboarding`, navigates to `home` on completion
- DataStore key `onboarding_complete: Boolean` added to UserPreferences.kt

## 6. Out of Scope

- Web painter pages (separate project)
- Backend API changes
- Staff / Customer app flavors
- Play Store submission (separate step after testing)
