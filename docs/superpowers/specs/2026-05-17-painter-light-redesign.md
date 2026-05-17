# Painter App — Full Light-Mode Redesign (v4.0.0)

**Date:** 2026-05-17
**Version target:** v4.0.0 vc39 (painter flavor)
**Branch:** `design/painter-app-ux-2026-05`

## Overview

Complete redesign of the QC Painter Android app. Removes dark mode entirely and rebuilds every screen against a new shared design system. Triggered by persistent dark-background + dark-text contrast failures in v3.5.0 vc38 (dark mode surface `#182518` with dark-green icon tints rendered nearly invisible).

**Decision:** Light mode only. No `isSystemInDarkTheme()`. Phone dark mode setting ignored. Simpler codebase, zero contrast failures, one rendering path to test.

---

## Section 1 — Colour Token System

All tokens defined in `Color.kt`. No `*Dark` variants.

### Primary — Forest Green
| Token | Hex | Usage |
|---|---|---|
| `QCGreenDarkest` | `#0D3D23` | Gradient end, deepest shadows |
| `QCGreen` | `#1B5E3B` | Hero gradients, CTAs, nav active, status bar |
| `QCGreenLight` | `#2D8A5E` | Success states, positive icons |
| `QCGreenContainer` | `#DCFCE7` | Chip backgrounds, selected rows, icon containers |

### Secondary — Gold (points/earnings only)
| Token | Hex | Usage |
|---|---|---|
| `QCGold` | `#D4A24E` | Points chips, price display, reward elements |
| `QCGoldDark` | `#B8891F` | Gold text on light backgrounds |
| `QCGoldContainer` | `#FEF3C7` | Points chip background |

### Surfaces & Backgrounds
| Token | Hex | Usage |
|---|---|---|
| `QCSurface` | `#FFFFFF` | Cards, bottom sheets, dialogs |
| `QCBackground` | `#F1F4EF` | Screen backgrounds |
| `QCSurfaceVariant` | `#E8EEE9` | Input fields, alternate rows |
| `QCBorderLight` | `#E2EBE4` | Card borders, dividers, separators |

### Text Hierarchy
| Token | Hex | Usage |
|---|---|---|
| `QCTextPrimary` | `#1A2E20` | Headlines, body text |
| `QCTextSecondary` | `#4A6B52` | Subtitles, secondary labels |
| `QCTextTertiary` | `#7A9E82` | Captions, hints, section headers |
| `QCTextDisabled` | `#B0C4B8` | Disabled states, placeholders |

### Semantic Colors
| Token | Hex | Usage |
|---|---|---|
| `QCError` | `#DC2626` | Errors, destructive actions |
| `QCWarningAmber` | `#D97706` | Warnings |
| `QCSuccess` | `#2D8A5E` | Same as QCGreenLight |
| `QCInfoBlue` | `#2563EB` | Info states, links |

**Material3 mapping (Theme.kt):**
```
primary = QCGreen
onPrimary = QCSurface
background = QCBackground
surface = QCSurface
surfaceVariant = QCSurfaceVariant
onBackground = QCTextPrimary
onSurface = QCTextPrimary
onSurfaceVariant = QCTextSecondary
outline = QCBorderLight
```

---

## Section 2 — Typography System

Font family: **Roboto** (Android system default — no custom font assets).
Premium feel achieved through weight combinations and letter-spacing, not font switching.

| Style | Size | Weight | Letter-spacing | Usage |
|---|---|---|---|---|
| `displayLarge` | 32sp | Bold | -0.25px | App name, splash |
| `headlineLarge` | 26sp | Bold | 0 | Screen greetings |
| `headlineMedium` | 22sp | SemiBold | 0 | Screen titles |
| `titleLarge` | 18sp | SemiBold | 0 | Card titles, sheet headers |
| `titleMedium` | 16sp | SemiBold | 0.15px | List item titles |
| `bodyLarge` | 16sp | Regular | 0.5px | Primary body text |
| `bodyMedium` | 14sp | Regular | 0.25px | Secondary body |
| `labelLarge` | 14sp | Medium | 0.1px | Buttons |
| `labelSmall` | 11sp | SemiBold | 0.8px | UPPERCASE section labels |
| `bodySmall` | 12sp | Regular | 0.4px | Captions, timestamps |

**Rules:**
- Section labels: `labelSmall` + `text-transform: uppercase` + `color = QCTextTertiary`
- Price display on white/light surface: `titleLarge` weight Bold + `color = QCGoldDark (#B8891F)` — not `QCGold` (2.7:1 contrast fails on white)
- Price display on gradient (green bg): `titleLarge` weight Bold + `color = QCGold (#D4A24E)` — gold reads clearly on dark green
- Price unit (e.g. `/litre`): `bodySmall` + `color = QCTextTertiary`

---

## Section 3 — Component Library

### Buttons
- **Primary:** `background = Brush.linearGradient(QCGreen → QCGreenDarkest)`, white text, `elevation = 4dp`, `cornerRadius = 10dp`
- **Outlined:** `border = 1.5dp QCGreen`, `color = QCGreen`, transparent bg
- **Text:** No border/bg, `color = QCGreen`
- **Gold (points):** `background = Brush.linearGradient(QCGold → QCGoldDark)`, white text
- **Tonal:** `background = QCGreenContainer`, `color = QCGreen`
- **Disabled:** `background = QCBorderLight`, `color = QCTextDisabled`

### Cards
- **Standard:** `background = QCSurface`, `border = 1dp QCBorderLight`, `elevation = 1dp`, `cornerRadius = 14dp`, `shadow color = QCGreen 7%`
- **Hero (gradient):** `background = Brush.linearGradient(QCGreen → QCGreenDarkest)`, white text, no border
- **Product:** Standard card + brand label in `QCTextTertiary labelSmall`, price in `QCGold`
- **Stat:** Standard card + large number in `QCTextPrimary headlineMedium`, trend in `QCGreenLight`

### Bottom Sheets
All `ModalBottomSheet` MUST set `containerColor = MaterialTheme.colorScheme.surface`.

Structure:
1. **Drag handle:** `width=36dp height=4dp background=QCBorderLight`
2. **Gradient header band:** `Brush.linearGradient(QCGreen → QCGreenDarkest)`, `cornerRadius=10dp`, white title + optional subtitle
3. **Row items:** `background = QCBackground`, `cornerRadius = 10dp`, `QCGreenContainer` icon containers (38×38dp, `cornerRadius=10dp`), green chevron `›`

### Chips & Tags
- **Selected filter chip:** `background = QCGreen`, white text
- **Unselected filter chip:** `background = QCSurface`, `border = 1dp QCBorderLight`, `color = QCTextSecondary`
- **Points chip:** `background = QCGoldContainer`, `border = 1dp QCGold 40%`, `color = QCGoldDark`
- **In Stock:** `background = QCGreenContainer`, `color = QCGreenLight`
- **Out of Stock:** `background = #FEE2E2`, `color = QCError`
- **Status (Pending/Info):** `background = #DBEAFE`, `color = QCInfoBlue`

### Input Fields
- **Normal:** `border = 1.5dp QCBorderLight`, `cornerRadius = 10dp`, `background = QCSurface`
- **Focused:** `border = 1.5dp QCGreen`, `focusedBorderColor = QCGreen`, outer glow `QCGreen 8%`
- **Label:** floated above, `color = QCGreen` when focused
- **Placeholder:** `color = QCTextDisabled`

### List Rows (size/price tables)
- **Normal row:** `background = QCSurface`, bottom divider `QCBorderLight 1dp`
- **Selected row:** `background = QCGreenContainer`, `border = 1dp QCGreen 40%`, text `color = QCGreen`

---

## Section 4 — Screen Redesign Plan

### Goal A — Design System Foundation (3 files)
**`Color.kt`**
- Replace entire file with new light-only token set (no `*Dark` tokens)
- Add `QCTextSecondary = #4A6B52`, `QCTextTertiary = #7A9E82`, `QCTextDisabled = #B0C4B8`
- Add `QCGoldDark = #B8891F`

**`Type.kt`**
- New 10-style type scale (displayLarge through bodySmall)
- UPPERCASE label style via `letterSpacing = 0.8.sp`

**`Theme.kt`**
- Remove `QCDarkScheme` entirely
- Remove `isSystemInDarkTheme()` logic
- `QCTheme` always applies `QCLightScheme`
- Update `onSurfaceVariant = QCTextSecondary` in `QCLightScheme`
- Status bar: always `QCGreen`, light icons

---

### Goal B — Navigation & Action Sheet (2 files)
**`AppNavigation.kt` — NewActionSheet**
- Keep `containerColor = MaterialTheme.colorScheme.surface`
- Add gradient header band: `Brush.linearGradient(QCGreen, QCGreenDarkest)`, title "Quick Actions"
- Row items: `background = QCBackground`, `QCGreenContainer` icon containers, chevron `color = QCGreen`
- Dividers: `QCBorderLight`

**`BottomNavBar.kt`**
- `containerColor = QCSurface`, top border `QCBorderLight 1dp`
- Selected: label `color = QCGreen`, icon tint `QCGreen`, indicator pill `background = QCGreenContainer`
- Unselected: `color = QCTextTertiary`
- Center FAB: gradient `QCGreen → QCGreenDarkest`, shadow `QCGreen 35%`

---

### Goal C — Auth & Onboarding (3 files)
**`LoginScreen.kt`**
- Top 45%: gradient `QCGreen → QCGreenDarkest`, QC logo white, tagline
- Bottom 55%: `QCSurface`, round top corners
- Phone input: outlined with green focus
- OTP boxes: 6 individual `QCSurface` boxes, green border when focused/filled
- Verify button: Primary gradient button

**`AwaitingApprovalScreen.kt`**
- Background `QCBackground`
- White card with timeline steps (Registered → Under Review → Approved)
- Completed steps: `QCGreen` circle, pending: `QCBorderLight`
- Pulsing ring: `QCGreen` animated

**`OnboardingScreen.kt`**
- 3 pages: full gradient `QCGreen → QCGreenDarkest`
- White illustrated icons, white text
- Page dots: white filled/outlined
- Skip: white text button, Get Started: `QCGold` gradient button

---

### Goal D — Home Screen (4 files)
**`HomeScreen.kt`**
- HeroCard: gradient, painter name + tier badge + points chip
- QuickActionsRow: 2×2 or 4-column grid of white cards
- Stats row: 2 stat cards (Today's earnings, Month total)
- Background: `QCBackground`

**`QuickActionsRow.kt`**
- White card `14dp` radius, green border `QCBorderLight`
- Icon container: `QCGreenContainer` 48×48dp, `QCGreen` icon tint
- Label: `titleMedium QCTextPrimary`

**`StreakSheet.kt`**
- `containerColor = QCSurface` ✓ (keep)
- Add gradient header band
- Checked days: `QCGreen` filled circle, white number
- Unchecked: `QCSurfaceVariant`
- Streak counter: `QCGold` bold

**`WithdrawalSheet.kt`**
- `containerColor = QCSurface` ✓ (keep)
- Add gradient header band
- Balance: `QCGold` large display
- Quick chips: tonal green
- Submit: primary gradient button

---

### Goal E — Catalog & Product Detail (2 files) ★ CRITICAL FIXES
**`CatalogScreen.kt`**
- Add `containerColor = MaterialTheme.colorScheme.surface` to: `ProductDetailLoadingSheet` (line 911), `ProductRequestSheet` (line 935), `CartBottomSheet` (line 973)
- Add `containerColor = MaterialTheme.colorScheme.surface` to `AlertDialog` (line 446)
- Brand filter chips: selected=`QCGreen`, unselected=bordered
- Product cards: standard card pattern, `QCGold` price, `QCGreenLight` points
- Search bar: green focus state

**`ProductDetailSheet.kt`**
- Add `containerColor = MaterialTheme.colorScheme.surface` (line 63) ★
- Gradient header: product image thumbnail + brand label + name + `QCGold` price + points chip + stock chip
- Size table: normal rows + `QCGreenContainer` selected row
- Add to Estimate: primary gradient button, full width, sticky bottom

---

### Goal F — Work & Attendance (4 files)
**`WorkScreen.kt`**
- `QCBackground` screen background ✓
- Premium estimate cards (standard card pattern)
- Status chips: approved=`QCGreenContainer`, pending=`#DBEAFE`, rejected=`#FEE2E2`
- Amount: `QCGold titleLarge`
- Empty state: green illustrated icon + `bodyLarge QCTextSecondary`

**`EstimateCreateScreen.kt`**
- Add `containerColor = MaterialTheme.colorScheme.surface` to `AlertDialog` (line 220)
- Search: green focused input
- Selected product rows: `QCGreenContainer`
- Quantity stepper: `QCGreen` buttons

**`CheckInScreen.kt`**
- Capture ring: `QCGreen` animated border (intentional, camera context)
- Location chip: `QCGreenContainer` text `QCGreen`
- Success overlay: gradient `QCGreen → QCGreenDarkest`, white checkmark

**`AttendanceHistoryScreen.kt`**
- Month headers: `labelSmall UPPERCASE QCTextTertiary`
- Attendance cards: standard card
- AP earned badge: `QCGoldContainer` + `QCGoldDark`

---

### Goal G — Profile, Settings & Points (5 files)
**`ProfileScreen.kt`**
- Gradient hero header: photo + name + tier badge chip (`QCGoldContainer`)
- Stats row: 3 stat cards below hero (estimates, points, AP)
- Menu items: `QCGreenContainer` icon containers, `QCBorderLight` dividers

**`EditProfileScreen.kt`**
- Add `containerColor = MaterialTheme.colorScheme.surface` to `AlertDialog` (line 404)
- All fields: green focused OutlinedTextField
- Save: primary gradient button

**`SettingsScreen.kt`**
- **Remove dark mode toggle section entirely**
- Keep: Language, Notifications, About, Logout
- Logout: `QCError` text button

**`AchievementsScreen.kt`**
- Earned: `QCGreenContainer` badge, `QCGreen` trophy icon, full opacity
- Locked: `QCSurfaceVariant` badge, `QCTextDisabled` icon, 50% opacity
- Progress bar: `QCGreen` fill, `QCBorderLight` track

**`PointsHistoryScreen.kt`**
- Balance card: gradient hero
- Tier progress track: 4-stop `QCGreen` line
- Transaction rows: earned=`QCGreenLight` amount, redeemed=`QCError` amount
- Filter tabs: selected=`QCGreen`, unselected=`QCTextTertiary`

---

### Goal H — Build & Deliver
- `build.gradle.kts`: `versionCode = 39`, `versionName = "4.0.0"`, painter flavor
- Build: `.\gradlew assemblePainterRelease --no-daemon`
- Deliver: APK → Telegram chat `930726256` via `@qualitycoloursbot`

---

## Non-Goals
- Staff or customer app flavor — not touched
- Web portal — not touched
- New screens or features — zero scope creep
- Custom font assets — Roboto only
- Dynamic Color (Material You) — not used

## File Count Summary
| Goal | Files |
|---|---|
| A — Design System | 3 |
| B — Navigation | 2 |
| C — Auth | 3 |
| D — Home | 4 |
| E — Catalog ★ | 2 |
| F — Work & Attendance | 4 |
| G — Profile | 5 |
| H — Build | 1 |
| **Total** | **24** |
