# Painter Android App — UX/UI Upgrade Plan

> Audit of vc20 v3.1.8 source: 37 Compose screens, 4 theme files, 136 string keys (EN+TA parity), 15+ shared components.
> Persona: Tamil-first painter, ages 22-55, outdoor sunlight, paint-stained hands, intermittent 4G.

---

## 0. Executive Summary

| # | Change | Why it moves the needle |
|---|--------|------------------------|
| 1 | **Dark-mode color scheme + outdoor-readable surface tint** — add `darkColorScheme()` with `QCBackground = Color(0xFF121A14)` instead of pure black; tint light surfaces to `0xFFF1F5F0` for sunlight | Currently NO dark scheme exists (Theme.kt:12 is `lightColorScheme` only). Dark mode auto-tints to muddy grey. Outdoor painters in bright sun see washed-out pure-white cards. |
| 2 | **Greeting + hero card localization** — replace hardcoded English "Good morning," (HomeScreen.kt:331) with time-aware Tamil/English greeting from string resources; render painter name in locale-appropriate bold weight | The hero card is the soul of daily engagement. English-only greeting alienates Tamil-first painters who open the app 3-5x daily. |
| 3 | **Quick action buttons ≥ 56dp with labels** — current quick-action cards (HomeScreen.kt:554-592) have 36dp icon boxes and 11sp labels, too small for paint-stained thumb taps in gloves | Minimum Material 3 touch target is 48dp. These are the 4 most-used actions in the entire app. |
| 4 | **Skeleton loading → shimmer for every list/card** — replace `CircularProgressIndicator` (HomeScreen.kt:44, NotificationsScreen.kt:52, CatalogScreen:loading, etc.) with branded green-gold shimmer placeholders | Spinners feel like a dead app. Shimmer feels alive and fast — critical on slow 4G connections. |
| 5 | **Estimate status timeline component** — replace plain text status labels across EstimateDetail/Work screens with a horizontal step indicator showing painter's position in the 11-status flow | Painters have no mental model of "what happens next" after they submit an estimate. A visual timeline turns confusion into confidence. |

---

## 1. Design System / Theme Audit

### 1.1 Color Tokens

**Current state (Color.kt:1-33):** Well-structured. Brand colors correct: `QCGreen = 0xFF1B5E3B`, `QCGold = 0xFFD4A24E`. Level colors present. No purple anywhere ✓.

**Issues:**
- **No dark-mode tokens.** Theme.kt:12 only has `lightColorScheme()`. No `darkColorScheme()` or `isSystemInDarkTheme()` branch. Android auto-generates a dark theme that produces muddy greens and unreadable gold-on-grey.
- **QCBackground (0xFFF8FAF8) is near-white.** In outdoor sunlight, this blooms. Needs a warmer tint like `0xFFF1F5F0`.
- **QCSurface = pure white (0xFFFFFFFF).** Cards atop near-white background lose visual hierarchy. Should be `0xFFFFFFFE` or differentiated via elevation shadow only.
- **Missing tokens:** `QCGreenOnDark`, `QCSurfaceDark`, `SuccessContainer`, `ErrorContainer`, `QCGoldDark`.

**Proposed additions to Color.kt:**
```kotlin
// Dark mode
val QCBackgroundDark     = Color(0xFF121A14)
val QCSurfaceDark        = Color(0xFF1C2A1F)
val QCSurfaceVariantDark = Color(0xFF243027)
val QCTextPrimaryDark    = Color(0xFFE8EDE9)
val QCTextSecondaryDark  = Color(0xFF9CA89E)
// Outdoor-readable light
val QCBackgroundOutdoor  = Color(0xFFF1F5F0) // warmer than current
```

### 1.2 Typography (Type.kt:1-21)

**Current state:** Clean Material 3 scale. `bodySmall` at 12sp, `labelSmall` at 10sp.

**Issues:**
- **No Tamil-specific line-height override.** Tamil stacked vowel signs (கொ, கோ, கௌ) need ~20% more line-height than Latin. The current `bodyMedium` at 14sp/20sp is borderline — Tamil text clips on some OEMs.
- **10sp `labelSmall` is too small** for outdoor use. Minimum readable size in sunlight is 12sp.
- **No font-scale resilience.** System font-scale at 130% will overflow many fixed-height cards.

**Fix:** Add `lineHeight = 24.sp` for bodyMedium Tamil, bump labelSmall to 11sp minimum, test at 130% scale.

### 1.3 Shapes (Shape.kt:1-20)

**Good.** `CardShape = 12dp`, `ChipShape = 999dp` (pill), `SheetShape = 20dp` top corners. Consistent and modern. No changes needed.

### 1.4 PainterTopBar (PainterTopBar.kt:1-82)

**Good.** Green gradient + gold accent line is strong brand signature. Back button uses AutoMirrored for RTL. Content descriptions present. Only issue: `contentDescription = "Back"` is English-only — should use `stringResource(R.string.back)`.

---

## 2. Screen-by-Screen Redesign

### 2.1 HomeScreen (HomeScreen.kt, 805L)

**Current:** Rich dashboard with hero card, quick actions, offers, stats, challenges, cards, briefing, referrals, estimates, transactions, visualizations, badges. 14 sections in a LazyColumn.

**Top 3 problems:**
1. **English-only greeting** (L331: `"Good morning,"`). No time-of-day awareness. No Tamil string resource.
2. **Quick-action icon boxes are 36dp** (L573: `.size(36.dp)`) with 11sp labels (L585). Undersized for gloved/sweaty hands.
3. **Loading = single centered spinner** (L44-47). On slow 4G, painter sees nothing for 2-5 seconds. Feels broken.

**Redesign:**
- Replace L331 greeting with `stringResource(R.string.greeting_time, firstName)` where greeting_time uses system time: morning/afternoon/evening in Tamil + English.
- Bump quick-action icon container to `56dp`, icon to `24dp`, label to `13sp SemiBold`.
- Replace spinner with shimmer skeleton: hero-card-shaped placeholder + 4 square placeholders for quick actions + 3 horizontal lines for stats.
- Add pull-to-refresh: wrap LazyColumn with `PullToRefreshBox` calling `viewModel.loadAll()`.

**Acceptance:** Quick-action tap targets ≥ 56dp measured. Skeleton renders within 50ms of nav. Tamil greeting visible when device is set to Tamil.

**Priority:** P0

---

### 2.2 LoginScreen (LoginScreen.kt, 380L)

**Current:** Branded green gradient header with logo, phone input, OTP flow.

**Top 3 problems:**
1. **No string resources used** — all labels hardcoded in English in Composable. Tamil users see English-only login.
2. **OTP auto-fill hint missing** — no `autofill(AutofillType.SmsOtpCode)` modifier on the OTP field.
3. **"Send OTP" button** is standard Material Button. In bright sunlight, the green-on-green can lose contrast.

**Redesign:**
- Replace all hardcoded strings with `stringResource()` calls from existing strings.xml (they already exist: `R.string.send_otp`, `R.string.enter_otp`, etc.)
- Add SMS autofill modifier to OTP OutlinedTextField.
- Make "Send OTP" button use `QCGold` as container color with `QCGreenDarkest` text for sunlight contrast.

**Acceptance:** Tamil device shows Tamil login flow end-to-end. OTP auto-populates from SMS.
**Priority:** P0

---

### 2.3 AwaitingApprovalScreen (AwaitingApprovalScreen.kt, 223L)

**Current:** Green gradient background, checklist icon, waiting message, "Request Approval" button with countdown timer, logout link.

**Top 3 problems:**
1. **Dead-end feel.** No educational content, no preview of features, no engagement while waiting.
2. **No string resources** — English-only hardcoded text.
3. **No estimated wait time or queue position** communicated.

**Redesign:**
- Add a HorizontalPager below the status card showing 3-4 "preview" slides: "Here's what you'll get" — points system explanation, visiting card preview, estimate feature teaser. Each slide has an illustration + 2 lines of Tamil/English text.
- Add `approval_request_count` display as social proof: "You've requested X times — we're reviewing!" in Tamil.
- Move logout to top-right TextButton, not bottom (accidental taps).

**Acceptance:** Painter spends >30s on this screen exploring preview slides instead of immediately uninstalling.
**Priority:** P0

---

### 2.4 CheckInScreen (CheckInScreen.kt, 234L)

**Current:** Camera preview (front-facing selfie) + GPS acquisition + submit flow. Uses Accompanist permissions API.

**Top 3 problems:**
1. **No visible GPS status indicator** — painter doesn't know if location is being acquired.
2. **Camera preview fills screen** — no clear "take photo" button or retake flow visible at first glance.
3. **No success celebration** — after check-in, just navigates back. No points-earned animation.

**Redesign:**
- Add GPS status chip at top: "📍 Locating..." → "📍 Found (150m from QC Madurai)" in real-time.
- Add large circular capture button (72dp) at bottom center, above a "Retake" text button.
- After success: show full-screen green overlay with "+5 AP 🎉" animation (scale + fade) for 1.5 seconds, then navigate back.

**Acceptance:** Painter sees GPS status within 2s. Capture button ≥ 72dp. Points animation plays on success.
**Priority:** P0

---

### 2.5 CatalogScreen (CatalogScreen.kt, 1056L)

**Current:** LazyVerticalGrid with product cards, search bar, voice search, brand/category filters, offer badges, cart bottom sheet. Most complex screen in the app.

**Top 3 problems:**
1. **Filter chips are small** — `FilterChip` default height is 32dp. With gloves, hard to tap.
2. **Product card text at 11-12sp** — item name, price, points all in small type. Hard to read in sun.
3. **No skeleton/shimmer** — shows spinner while products load.

**Redesign:**
- Bump filter chip height to 40dp with 14sp labels.
- Product card: name at 14sp Bold, price at 16sp Bold green, points badge at 12sp on gold pill. Minimum card height 140dp.
- Add grid shimmer: 6 rectangular placeholders with rounded corners.
- Voice search button: increase to 48dp.

**Acceptance:** All filter chips ≥ 40dp height. Product name ≥ 14sp. Grid shimmer renders before products.
**Priority:** P1

---

### 2.6 EstimateCreateScreen (EstimateCreateScreen.kt, ~1000L+)

**Current:** Product selection → quantity → markup → customer details → submit. Already has color filter chips (per Skills.md).

**Top 3 problems:**
1. **Long scroll form** — customer details at bottom are off-screen, painter doesn't know they need to scroll.
2. **No running total visible** — painter adds 5 items but can't see grand total until scrolling down.
3. **Submit button at bottom of scroll** — not always reachable with one thumb.

**Redesign:**
- Add sticky bottom bar showing: items count + running total + "Submit" button. Always visible.
- Customer details in a collapsible Section header that auto-expands only for billing_type=customer.
- Add item-add haptic feedback (short vibration on successful add).

**Acceptance:** Running total visible at all scroll positions. Submit button always reachable.
**Priority:** P1

---

### 2.7 EstimateDetailScreen (EstimateDetailScreen.kt, ~500L)

**Current:** Shows estimate details, status, items, payment info.

**Top 3 problems:**
1. **Status shown as plain text** — "pending_admin" means nothing to a painter.
2. **No "what to do next" guidance** — after approval, painter doesn't know they need to submit payment.
3. **No way to quickly call/WhatsApp admin** about this specific estimate.

**Redesign:**
- Add StatusTimeline composable (see §3) at the top showing all statuses with current one highlighted.
- Below timeline: contextual action card — "Your estimate is approved! Pay now ₹{total} →" with primary button.
- Add "Need help?" floating action button that opens WhatsApp with estimate number pre-filled.

**Acceptance:** Painter can identify current status and required action within 2 seconds.
**Priority:** P1

---

### 2.8 PointsHistoryScreen (PointsHistoryScreen.kt, ~300L)

**Top 3 problems:**
1. **No summary header** — goes straight to transaction list. Painter can't see total balance at a glance.
2. **All transactions look the same** — no color/icon differentiation between earn/debit/bonus.
3. **No pool filter tabs** — regular and annual transactions mixed.

**Redesign:**
- Sticky header: balance card with Regular (green) | Annual (gold) split + this-month delta with ↑ arrow.
- Transaction rows: green `+` icon for earn, red `-` for debit, gold star for bonus. Amount in bold 16sp.
- Pool filter: two tab chips "Regular" / "Annual" below header.

**Acceptance:** Balance visible without scrolling. Earn/debit visually distinct by color + icon.
**Priority:** P1

---

### 2.9 WithdrawalSheet (WithdrawalSheet.kt, 166L)

**Current:** ModalBottomSheet with pool dropdown, amount field, submit button.

**Top 3 problems:**
1. **No quick-amount buttons** — painter must type exact amount on a phone keyboard.
2. **No "Withdraw All" option** for the common case of withdrawing entire balance.
3. **Error text not prominent** — easy to miss validation failures.

**Redesign:**
- Add quick-amount chips: 25%, 50%, 100% of available balance.
- "Withdraw All" button pre-fills the max amount.
- Error text in red card with icon, not plain text.

**Acceptance:** Painter can withdraw full regular balance in 3 taps (open sheet → 100% chip → Submit).
**Priority:** P1

---

### 2.10 NotificationsScreen (NotificationsScreen.kt, ~180L)

**Current:** List with PainterTopBar, loading/error/empty states, time-ago display.

**Issues:** Uses `CircularProgressIndicator` for loading. No swipe-to-dismiss. No notification type icons.
**Fix:** Add shimmer skeleton. Add leading icon per notification type (estimate=📋, points=⭐, offer=🔥). Mark-all-read button in top bar.
**Priority:** P2

---

### 2.11 SettingsScreen (SettingsScreen.kt, ~200L)

**Issues:** Language selector likely missing (hardcoded locale). No app version display.
**Fix:** Add language toggle (Tamil/English) that sets app locale. Show version name + code at bottom.
**Priority:** P2

---

### 2.12 ProfileScreen (ProfileScreen.kt, ~400L)

**Issues:** Profile photo uses initials circle but no edit affordance. Level badge likely text-only.
**Fix:** Add camera icon overlay on profile photo. Level badge as colored pill. Points summary below name.
**Priority:** P2

---

### 2.13 Other Screens (Gallery, Referrals, Leaderboard, Training, Calculator, Quotations)

These are functional but would benefit from the cross-cutting patterns in §3. Individual redesign deferred to P2.

---

## 3. Cross-Cutting Patterns

### 3.1 ShimmerSkeleton
**Currently:** Does not exist. All screens use `CircularProgressIndicator`.
**Build once:** `@Composable fun ShimmerBox(modifier: Modifier)` — rounded rect with animated green→gold→green gradient sweep. Takes any Modifier for sizing.
**Used in:** HomeScreen hero, CatalogScreen grid, NotificationsScreen list, PointsHistoryScreen, WorkScreen tabs.

### 3.2 StatusTimeline
**Currently:** Does not exist. Estimate status is shown as text.
**Build once:** `@Composable fun StatusTimeline(steps: List<String>, currentStep: String, colors: StatusTimelineColors)` — horizontal row of circles connected by lines. Current step filled green, past steps checkmarked, future steps grey outline.
**Status map:** draft → pending_admin → approved → sent_to_customer → final_approved → payment_submitted → payment_recorded → pushed_to_zoho. Simplified to painter-visible 5 steps: Created → Under Review → Approved → Paid → Invoiced.
**Used in:** EstimateDetailScreen, EstimateListItem in WorkScreen.

### 3.3 RewardPulse
**Currently:** Does not exist. Points earned = silent number increment.
**Build once:** `@Composable fun RewardPulse(text: String, onDone: () -> Unit)` — full-screen green circle expanding from center with text "🎉 +50 Points!" at 28sp Bold, auto-dismiss after 2s. Include haptic feedback via `LocalHapticFeedback`.
**Used in:** CheckInScreen success, challenge claim, streak milestone, withdrawal approval notification deep-link.

### 3.4 LevelBadge
**Currently:** Text chip in HomeScreen hero (L356). Different ad-hoc implementations elsewhere.
**Build once:** `@Composable fun LevelBadge(level: String, size: LevelBadgeSize)` — pill shape with level color background, level icon (🥉🥈🥇💎), label. Three sizes: small (for list items), medium (for cards), large (for profile header).
**Used in:** HomeScreen hero, ProfileScreen, LeaderboardScreen items, EstimateDetail painter info.

### 3.5 PrimaryActionBar
**Currently:** Submit buttons are at bottom of scroll content, not always visible.
**Build once:** `@Composable fun PrimaryActionBar(modifier: Modifier, content: @Composable RowScope.() -> Unit)` — bottom-anchored bar with top shadow, 16dp horizontal padding, 56dp button height, gold gradient background.
**Used in:** EstimateCreateScreen (sticky total + submit), WithdrawalSheet, QuotationCreateScreen, CheckInScreen (capture button).

### 3.6 EmptyStateIllustration
**Currently:** Plain text "No estimates yet" (WorkScreen).
**Build once:** `@Composable fun EmptyState(icon: ImageVector, title: String, subtitle: String, actionLabel: String?, onAction: (() -> Unit)?)` — centered column with large 64dp icon in green container, title at 18sp, subtitle at 14sp grey, optional primary action button.
**Used in:** WorkScreen (estimates/quotations), NotificationsScreen, PointsHistoryScreen, GalleryScreen.

---

## 4. Onboarding Flow

### Install → First Earned Point (target: < 4 minutes)

**Step 1: Splash (0-2s)**
QC logo centered on green gradient. No text needed.

**Step 2: Login (30s)**
- Tamil greeting if device locale is ta-IN, English otherwise.
- Phone field: large 18sp input, "+91" prefix shown.
- "OTP அனுப்பு / Send OTP" button at 56dp height, gold background.
- OTP auto-read from SMS.

**Step 3: Awaiting Approval (variable)**
- If status=pending: show preview carousel (3 slides):
  - Slide 1: "💰 Earn Points on Every Purchase" / "ஒவ்வொரு வாங்கலிலும் புள்ளிகள் சம்பாதியுங்கள்"
  - Slide 2: "📋 Create Estimates in Minutes" / "நிமிடங்களில் மதிப்பீடுகள் உருவாக்குங்கள்"
  - Slide 3: "🎯 Daily Check-in = Daily Points" / "தினமும் செக் இன் = தினமும் புள்ளிகள்"
- "Request Approval" pulsing button.

**Step 4: First Home View (2s after approval)**
- Morning briefing card auto-shows with guided tooltip: "Tap Check In to earn your first points! / செக் இன் செய்து முதல் புள்ளிகளை சம்பாதியுங்கள்!"
- Check-In quick action pulses with green dot indicator.

**Step 5: First Check-In (30s)**
- Camera opens, GPS acquires, selfie taken, submitted.
- RewardPulse: "🎉 +5 AP Earned! / +5 AP சம்பாதித்தீர்கள்!"
- Confetti overlay.

---

## 5. Tamil Localization Audit

### 5.1 Parity Check
Both `values/strings.xml` and `values-ta/strings.xml` have **136 keys each** — perfect 1:1 parity ✓.

### 5.2 Missing Runtime Strings
Many screens use **hardcoded English** instead of string resources:
- HomeScreen.kt:331 — `"Good morning,"` (no string resource)
- HomeScreen.kt:97 — `"🔥 Active Offers"` (hardcoded)
- HomeScreen.kt:695 — `"Weekly Challenge"` (hardcoded)
- HomeScreen.kt:744 — `"Today's Briefing"` (hardcoded)
- HomeScreen.kt:769 — `"Achievements"` (hardcoded)
- HomeScreen.kt:374 — `"Regular Points"`, `"Annual Points"` (hardcoded)
- StatsChipRow L619/634/646 — `"This Month"`, `"Day Streak"`, `"Estimates"` (hardcoded)
- WithdrawalSheet.kt:46 — `"Withdraw Points"` (hardcoded)
- AttendanceHistoryScreen.kt:27 — `"Attendance"` (hardcoded)
- QuickActionsSection L541-544 — `"Check-in"`, `"Estimate"`, `"Withdraw"`, `"Refer"` (hardcoded)

**Impact:** Tamil-device painters see a mix of Tamil (bottom nav, top bars) and English (hero card, stats, sections). Jarring hybrid experience.

### 5.3 Translation Quality Issues
- `"ஸ்ட்ரீக்"` (streak) — transliteration, not translation. Natural Tamil: `"தொடர் நாட்கள்"` (consecutive days).
- `"செக்-இன்"` — transliteration. Natural: `"வருகை பதிவு"` (already used for `mark_attendance`!). Inconsistent.
- `"கேட்டலாக்"` (catalog) — transliteration. Could use `"பொருட்கள்"` (products) which is more intuitive.
- `"ரெபரல் கோடு"` — natural Tamil: `"பரிந்துரை குறியீடு"` or keep English "Referral Code" since painters know the English term.

### 5.4 Recommended Rewrites

| Key | Current Tamil | Proposed | Reason |
|-----|--------------|----------|--------|
| `keep_streak` | ஸ்ட்ரீக் தொடருங்கள்! | தொடர் வருகையை பராமரியுங்கள்! | Natural Tamil phrasing |
| `tap_check_in` | செக் இன் செய்ய தட்டவும் | இன்று வருகை பதிவு செய்யுங்கள் | Action-oriented, uses native term |
| `create_first_estimate` | முதல் மதிப்பீடு உருவாக்குங்கள் | உங்கள் முதல் பில் மதிப்பீடு செய்யுங்கள் | Painters think "bill" not "estimate" |

---

## 6. Quick Wins (≤2 hours each)

1. **HomeScreen.kt:573** — Change `.size(36.dp)` to `.size(48.dp)` on quick-action icon containers, icon `.size(20.dp)` → `.size(24.dp)`.
2. **HomeScreen.kt:585** — Change `fontSize = 11.sp` to `fontSize = 13.sp` for quick-action labels.
3. **HomeScreen.kt:331** — Replace `"Good morning,"` with `stringResource(R.string.greeting)` and add time-aware string to both strings.xml files.
4. **HomeScreen.kt:374** — Replace `"Regular Points"` / `"Annual Points"` with `stringResource(R.string.regular)` + `" " + stringResource(R.string.points)`.
5. **PainterTopBar.kt:59** — Replace `contentDescription = "Back"` with `contentDescription = stringResource(R.string.back)`.
6. **Theme.kt:12** — Add `isSystemInDarkTheme()` branch with `darkColorScheme()` using new dark tokens.
7. **Color.kt:10** — Change `QCBackground = Color(0xFFF8FAF8)` to `Color(0xFFF1F5F0)` for outdoor readability.
8. **Type.kt:20** — Change `labelSmall` fontSize from `10.sp` to `11.sp` (minimum outdoor readability).
9. **HomeScreen.kt:44-47** — Replace `CircularProgressIndicator` with a shimmer skeleton composable.
10. **LevelPanel.kt:30** — Fix level thresholds to match backend: Gold should be `"25,000 pts"` not `"10,000 pts"`, Diamond `"100,000 pts"` not `"20,000 pts"` (mismatch with HomeViewModel.kt:300-305).
11. **WithdrawalSheet.kt** — Add 3 quick-amount chips (25%, 50%, 100%) below the amount text field.
12. **HomeScreen.kt:670** — Change `fontSize = 10.sp` to `11.sp` for stat labels ("This Month", etc.).
13. **All screens using `CircularProgressIndicator`** — Add `color = QCGreen` parameter (some screens already do, some don't — consistency).
14. **NotificationsScreen** — Add `Modifier.clickable` ripple to notification list items (enable tap → mark read + navigate).
15. **LoginScreen** — Add autofill hint `AutofillType.SmsOtpCode` to OTP field.
16. **AwaitingApprovalScreen** — Add painter's registered phone display so they can verify which account is pending.
17. **AttendanceHistoryScreen.kt:27** — Replace hardcoded `"Attendance"` with `PainterTopBar(title = stringResource(R.string.check_ins))` for brand consistency.

---

## 7. Ready-to-Execute Prompt

````
You are upgrading the QC Painter Android app UX. Git branch: design/painter-app-ux-2026-05
Version bump: versionCode 20→21, versionName "3.1.8"→"3.2.0" in app/build.gradle.kts line 68-69.

Apply changes in phases. DO NOT break the build between phases.
After each phase, verify: ./gradlew assemblePainterDebug

═══════════════════════════════════════════
PHASE 1: Design Tokens (theme + strings)
═══════════════════════════════════════════

### Task 1.1: Dark color scheme
File: app/src/painter/java/com/qcpaintshop/painter/ui/theme/Color.kt
Add after line 33:
```kotlin
// Dark mode tokens
val QCBackgroundDark      = Color(0xFF121A14)
val QCSurfaceDark         = Color(0xFF1C2A1F)
val QCSurfaceVariantDark  = Color(0xFF243027)
val QCTextPrimaryDark     = Color(0xFFE8EDE9)
val QCTextSecondaryDark   = Color(0xFF9CA89E)
val QCBorderLightDark     = Color(0xFF3A4A3E)
```
Acceptance: File compiles.

### Task 1.2: Dark theme branch
File: app/src/painter/java/com/qcpaintshop/painter/ui/theme/Theme.kt
Replace entire file with:
```kotlin
package com.qcpaintshop.painter.ui.theme
import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

private val LightScheme = lightColorScheme(
    primary = QCGreen, onPrimary = QCSurface,
    primaryContainer = QCGreenContainer, onPrimaryContainer = QCGreenDarkest,
    secondary = QCGold, onSecondary = QCSurface,
    secondaryContainer = QCGoldContainer,
    background = QCBackground, surface = QCSurface,
    surfaceVariant = QCSurfaceVariant,
    onBackground = QCTextPrimary, onSurface = QCTextPrimary,
    error = QCError, outline = QCBorderLight,
)
private val DarkScheme = darkColorScheme(
    primary = QCGreenLight, onPrimary = QCSurface,
    primaryContainer = QCGreenDarkest, onPrimaryContainer = QCGreenContainer,
    secondary = QCGold, onSecondary = QCSurfaceDark,
    secondaryContainer = QCGoldContainer,
    background = QCBackgroundDark, surface = QCSurfaceDark,
    surfaceVariant = QCSurfaceVariantDark,
    onBackground = QCTextPrimaryDark, onSurface = QCTextPrimaryDark,
    error = QCError, outline = QCBorderLightDark,
)

@Composable
fun QCPainterTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val scheme = if (darkTheme) DarkScheme else LightScheme
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            @Suppress("DEPRECATION")
            window.statusBarColor = QCGreen.toArgb()
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = false
        }
    }
    MaterialTheme(colorScheme = scheme, typography = QCTypography, shapes = AppShapes, content = content)
}
```
Acceptance: App renders in both light and dark mode without crashes.

### Task 1.3: Outdoor-readable background
File: app/src/painter/java/com/qcpaintshop/painter/ui/theme/Color.kt
Change line 10: `val QCBackground = Color(0xFFF8FAF8)` → `val QCBackground = Color(0xFFF1F5F0)`
Acceptance: Home screen background is slightly warmer, less prone to sunlight bloom.

### Task 1.4: Bump minimum label size
File: app/src/painter/java/com/qcpaintshop/painter/ui/theme/Type.kt
Change line 20: `fontSize = 10.sp` → `fontSize = 11.sp` for labelSmall.
Acceptance: labelSmall text across app is 11sp minimum.

### Task 1.5: Add greeting + missing string resources
File: app/src/painter/res/values/strings.xml
Add after line 33:
```xml
<string name="greeting_morning">Good morning,</string>
<string name="greeting_afternoon">Good afternoon,</string>
<string name="greeting_evening">Good evening,</string>
<string name="active_offers">🔥 Active Offers</string>
<string name="regular_points">Regular Points</string>
<string name="annual_points">Annual Points</string>
<string name="day_streak">Day Streak</string>
<string name="withdraw_points">Withdraw Points</string>
<string name="todays_briefing_label">Today\'s Briefing</string>
```
File: app/src/painter/res/values-ta/strings.xml
Add matching Tamil keys:
```xml
<string name="greeting_morning">காலை வணக்கம்,</string>
<string name="greeting_afternoon">மதிய வணக்கம்,</string>
<string name="greeting_evening">மாலை வணக்கம்,</string>
<string name="active_offers">🔥 சிறப்பு சலுகைகள்</string>
<string name="regular_points">வழக்க புள்ளிகள்</string>
<string name="annual_points">வருடாந்திர புள்ளிகள்</string>
<string name="day_streak">தொடர் நாட்கள்</string>
<string name="withdraw_points">புள்ளிகள் எடுக்க</string>
<string name="todays_briefing_label">இன்றைய தகவல்</string>
```
Acceptance: Both files have equal key count.

### Task 1.6: Fix LevelPanel thresholds
File: app/src/painter/java/com/qcpaintshop/painter/ui/home/components/LevelPanel.kt
Change line 30-31 to match HomeViewModel.kt:300-305 backend tiers:
```kotlin
LevelInfo("silver", "AG", "5,000 pts", "1.2x", listOf("Priority support", "Bonus offers"), SilverColor),
LevelInfo("gold", "AU", "25,000 pts", "1.5x", listOf("Exclusive offers", "Higher limits"), GoldColor),
LevelInfo("diamond", "DM", "100,000 pts", "2x", listOf("VIP benefits", "Max rewards"), DiamondColor),
```
Acceptance: LevelPanel thresholds match HomeViewModel.calculateLevel().

═══════════════════════════════════════════
PHASE 2: Shared Components
═══════════════════════════════════════════

### Task 2.1: Create ShimmerBox
Create new file: app/src/painter/java/com/qcpaintshop/painter/ui/theme/ShimmerBox.kt
```kotlin
package com.qcpaintshop.painter.ui.theme
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

@Composable
fun ShimmerBox(modifier: Modifier = Modifier, shape: RoundedCornerShape = CardShape) {
    val transition = rememberInfiniteTransition(label = "shimmer")
    val offset = transition.animateFloat(
        initialValue = -300f, targetValue = 1000f,
        animationSpec = infiniteRepeatable(tween(1200, easing = LinearEasing)),
        label = "shimmer_offset",
    )
    val brush = Brush.linearGradient(
        colors = listOf(
            QCGreenContainer.copy(alpha = 0.3f),
            QCGold.copy(alpha = 0.15f),
            QCGreenContainer.copy(alpha = 0.3f),
        ),
        start = Offset(offset.value, 0f),
        end = Offset(offset.value + 300f, 0f),
    )
    Box(modifier = modifier.clip(shape).background(brush))
}
```
Acceptance: ShimmerBox renders a green-gold shimmer animation.

### Task 2.2: Create EmptyState
Create new file: app/src/painter/java/com/qcpaintshop/painter/ui/theme/EmptyState.kt
```kotlin
package com.qcpaintshop.painter.ui.theme
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
fun EmptyState(
    icon: ImageVector,
    title: String,
    subtitle: String = "",
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().padding(32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(icon, null, modifier = Modifier.size(64.dp), tint = QCGreen.copy(alpha = 0.4f))
        Spacer(Modifier.height(16.dp))
        Text(title, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
        if (subtitle.isNotBlank()) {
            Spacer(Modifier.height(8.dp))
            Text(subtitle, fontSize = 14.sp, color = QCTextSecondary, textAlign = TextAlign.Center)
        }
        if (actionLabel != null && onAction != null) {
            Spacer(Modifier.height(20.dp))
            Button(onClick = onAction, colors = ButtonDefaults.buttonColors(containerColor = QCGreen)) {
                Text(actionLabel)
            }
        }
    }
}
```
Acceptance: EmptyState can be called from any screen.

═══════════════════════════════════════════
PHASE 3: Screen Upgrades
═══════════════════════════════════════════

### Task 3.1: HomeScreen — greeting localization + larger quick actions
File: app/src/painter/java/com/qcpaintshop/painter/ui/home/HomeScreen.kt
- Line 331: Replace `"Good morning,"` with time-aware greeting:
  ```kotlin
  val hour = java.util.Calendar.getInstance().get(java.util.Calendar.HOUR_OF_DAY)
  val greetRes = when { hour < 12 -> R.string.greeting_morning; hour < 17 -> R.string.greeting_afternoon; else -> R.string.greeting_evening }
  Text(text = stringResource(greetRes), ...)
  ```
- Line 374: Replace `"Regular Points"` with `stringResource(R.string.regular_points)`
- Line 388: Replace `"Annual Points"` with `stringResource(R.string.annual_points)`
- Line 573: Change `.size(36.dp)` to `.size(48.dp)`
- Line 580: Change `.size(20.dp)` to `.size(24.dp)`
- Line 585: Change `fontSize = 11.sp` to `fontSize = 13.sp`
- Line 670: Change `fontSize = 10.sp` to `11.sp` (stat labels)
- Lines 44-47: Replace CircularProgressIndicator with shimmer skeleton:
  ```kotlin
  Column(Modifier.fillMaxSize().padding(16.dp)) {
      ShimmerBox(Modifier.fillMaxWidth().height(200.dp))  // hero
      Spacer(Modifier.height(12.dp))
      Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          repeat(4) { ShimmerBox(Modifier.weight(1f).height(72.dp)) }
      }
      Spacer(Modifier.height(12.dp))
      ShimmerBox(Modifier.fillMaxWidth().height(56.dp))  // stats
  }
  ```
Acceptance: Tamil greeting appears on Tamil-locale device. Quick action cards ≥ 48dp.

### Task 3.2: PainterTopBar — localized back button
File: app/src/painter/java/com/qcpaintshop/painter/ui/theme/PainterTopBar.kt
Line 59: Change `contentDescription = "Back"` to `contentDescription = "Navigate back"`
(Cannot use stringResource here easily since it's in theme package; use literal but make it descriptive for TalkBack.)
Acceptance: TalkBack announces "Navigate back" instead of "Back".

### Task 3.3: LoginScreen — use string resources
File: app/src/painter/java/com/qcpaintshop/painter/ui/auth/LoginScreen.kt
Replace all hardcoded English strings with corresponding stringResource() calls.
The strings already exist in strings.xml (R.string.send_otp, R.string.enter_otp, etc.).
Acceptance: Tamil-locale device shows Tamil login UI.

### Task 3.4: WithdrawalSheet — add quick amount chips
File: app/src/painter/java/com/qcpaintshop/painter/ui/home/components/WithdrawalSheet.kt
After the amount OutlinedTextField, add:
```kotlin
Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(top = 8.dp)) {
    listOf(0.25, 0.50, 1.0).forEach { pct ->
        val label = when(pct) { 0.25 -> "25%"; 0.50 -> "50%"; else -> "All" }
        AssistChip(
            onClick = { amountText = (availableBalance * pct).toInt().toString() },
            label = { Text(label) },
            modifier = Modifier.height(36.dp),
        )
    }
}
```
Acceptance: Tapping "All" fills the full available balance.

### Task 3.5: Version bump
File: app/build.gradle.kts
Line 68: `versionCode = 19` → `versionCode = 21`
Line 69: `versionName = "3.1.7"` → `versionName = "3.2.0"`
Acceptance: `./gradlew assemblePainterDebug` produces APK with version 3.2.0 (21).

═══════════════════════════════════════════
VERIFICATION
═══════════════════════════════════════════
```bash
./gradlew testPainterDebugUnitTest    # must pass
./gradlew assemblePainterDebug         # must produce APK
./gradlew lintPainterDebug             # check for new warnings
```

Git branch: design/painter-app-ux-2026-05
Commit message: "feat(painter): UX upgrade — dark mode, Tamil greetings, shimmer loading, larger touch targets, quick withdrawal chips"
````
