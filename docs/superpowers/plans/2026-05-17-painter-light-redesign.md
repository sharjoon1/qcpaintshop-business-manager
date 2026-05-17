# Painter App — Full Light-Mode Redesign (v4.0.0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove dark mode entirely and rebuild every screen of the QC Painter Android app against a new shared design system, producing v4.0.0 vc39.

**Architecture:** Goal A replaces the design system foundation (Color.kt, Type.kt, Theme.kt), eliminating all dark-mode tokens and forcing `QCLightScheme` always. Goals B–G rebuild each screen group against the new system. Goal H builds and delivers APK via Telegram. Root cause of dark-background/dark-letter bug: `isSystemInDarkTheme()` was returning true on the painter's phone, activating `QCDarkScheme` which rendered `QCSurfaceDark=#182518` surfaces with `QCGreen=#1B5E3B` icon tints — dark green on dark green-black = invisible.

**Tech Stack:** Kotlin, Jetpack Compose (MD3), Hilt DI, DataStore Preferences, Navigation Compose, Inter font (R.font.inter_*)

**Android project root:** `D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\qcpaintshop-android\`

**Painter source root (abbreviated as `[p]`):**
`app/src/painter/java/com/qcpaintshop/painter/`

**Branch:** `design/painter-app-ux-2026-05`

**Compile check command (fast — use after every Goal):**
```
cd "D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\qcpaintshop-android"
.\gradlew :app:compilePainterReleaseKotlin --no-daemon "-Dkotlin.daemon.jvm.options=-Xmx3072m"
```

---

## Design Token Reference (lock — do not deviate)

| Token | Hex | Role |
|---|---|---|
| `QCGreen` | `#1B5E3B` | Primary: gradients, CTAs, nav active |
| `QCGreenDarkest` | `#0D3D23` | Gradient end |
| `QCGreenLight` | `#2D8A5E` | Success, positive icons |
| `QCGreenContainer` | `#DCFCE7` | Icon containers, selected rows, chips |
| `QCGold` | `#D4A24E` | Points/rewards on green backgrounds |
| `QCGoldDark` | `#B8891F` | Gold text on white/light surfaces |
| `QCGoldContainer` | `#FEF3C7` | Points chip background |
| `QCSurface` | `#FFFFFF` | Cards, sheets, dialogs |
| `QCBackground` | `#F1F4EF` | Screen backgrounds |
| `QCSurfaceVariant` | `#E8EEE9` | Input fields, alt rows |
| `QCBorderLight` | `#E2EBE4` | Card borders, dividers |
| `QCTextPrimary` | `#1A2E20` | Headlines, body |
| `QCTextSecondary` | `#4A6B52` | Subtitles, labels |
| `QCTextTertiary` | `#7A9E82` | Captions, section headers |
| `QCTextDisabled` | `#B0C4B8` | Disabled, placeholders |

**Gradient hero brush (reuse everywhere):**
```kotlin
val heroGradient = Brush.linearGradient(listOf(QCGreen, QCGreenDarkest))
```

**Sheet gradient header (reuse in all bottom sheets):**
```kotlin
Box(
    modifier = Modifier
        .fillMaxWidth()
        .background(Brush.linearGradient(listOf(QCGreen, QCGreenDarkest)), RoundedCornerShape(10.dp))
        .padding(horizontal = 16.dp, vertical = 12.dp)
) {
    Text(sheetTitle, style = MaterialTheme.typography.titleMedium, color = Color.White, fontWeight = FontWeight.Bold)
}
```

**Sheet row item (reuse in all bottom sheets):**
```kotlin
Surface(onClick = onClick, modifier = Modifier.fillMaxWidth().semantics { contentDescription = title }, color = QCBackground, shape = RoundedCornerShape(10.dp)) {
    Row(modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Surface(shape = RoundedCornerShape(10.dp), color = QCGreenContainer, modifier = Modifier.size(38.dp)) {
            Box(contentAlignment = Alignment.Center) { Icon(icon, contentDescription = null, tint = QCGreen, modifier = Modifier.size(20.dp)) }
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = QCTextPrimary)
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = QCTextTertiary)
        }
        Icon(Icons.Rounded.ChevronRight, contentDescription = null, tint = QCGreen, modifier = Modifier.size(18.dp))
    }
}
```

---

## Task A: Design System Foundation

**Files:**
- Modify: `[p]ui/theme/Color.kt`
- Modify: `[p]ui/theme/Type.kt`
- Modify: `[p]ui/theme/Theme.kt`

- [ ] **Step A1: Replace Color.kt with light-only token set**

Replace the entire content of `[p]ui/theme/Color.kt`:

```kotlin
package com.qcpaintshop.painter.ui.theme

import androidx.compose.ui.graphics.Color

// ─── Primary — Forest Green ───────────────────────────────────────────────
val QCGreen           = Color(0xFF1B5E3B)   // Hero gradients, CTAs, nav active
val QCGreenLight      = Color(0xFF2D8A5E)   // Success states, positive icons
val QCGreenDark       = Color(0xFF154D31)   // FAB gradient (keep for BottomNavBar)
val QCGreenDarkest    = Color(0xFF0D3D23)   // Gradient end
val QCGreenContainer  = Color(0xFFDCFCE7)   // Icon containers, selected rows, chips

// ─── Secondary — Gold (points/earnings ONLY) ──────────────────────────────
val QCGold            = Color(0xFFD4A24E)   // On green backgrounds
val QCGoldDark        = Color(0xFFB8891F)   // Gold text on white/light surfaces
val QCGoldContainer   = Color(0xFFFEF3C7)   // Points chip background

// ─── Surfaces & Backgrounds ───────────────────────────────────────────────
val QCSurface         = Color(0xFFFFFFFF)   // Cards, bottom sheets, dialogs
val QCBackground      = Color(0xFFF1F4EF)   // Screen backgrounds
val QCSurfaceVariant  = Color(0xFFE8EEE9)   // Input fields, alternate rows
val QCBorderLight     = Color(0xFFE2EBE4)   // Card borders, dividers

// ─── Text Hierarchy ───────────────────────────────────────────────────────
val QCTextPrimary     = Color(0xFF1A2E20)   // Headlines, body
val QCTextSecondary   = Color(0xFF4A6B52)   // Subtitles, secondary labels
val QCTextTertiary    = Color(0xFF7A9E82)   // Captions, section headers (UPPERCASE)
val QCTextDisabled    = Color(0xFFB0C4B8)   // Disabled states, placeholders

// ─── Semantic ─────────────────────────────────────────────────────────────
val QCSuccess         = QCGreenLight
val QCError           = Color(0xFFDC2626)
val QCWarningAmber    = Color(0xFFD97706)
val QCInfoBlue        = Color(0xFF2563EB)
val QCInfoBlueContainer = Color(0xFFEFF6FF)
val QCOfferOrange     = Color(0xFFE65100)
val QCWarningAmberContainer = Color(0xFFFEF3C7)

// ─── Tier accents (loyalty levels) ────────────────────────────────────────
val LevelBronze       = Color(0xFFB26B2A)
val LevelSilver       = Color(0xFF8C9099)
val LevelGold         = QCGold
val LevelDiamond      = Color(0xFF2D9CDB)

// ─── Backwards-compat aliases ──────────────────────────────────────────────
val QCGreenBlack      = Color(0xFF0A2E18)   // keep — may be referenced in screens
val BronzeColor       = LevelBronze
val SilverColor       = LevelSilver
val GoldColor         = LevelGold
val DiamondColor      = LevelDiamond
val InfoBlue          = QCInfoBlue
val InfoBlueContainer = QCInfoBlueContainer
val WarningAmber      = QCWarningAmber
val WarningAmberContainer = QCWarningAmberContainer
val QCGoldLight       = QCGoldContainer     // alias so existing imports compile
```

- [ ] **Step A2: Update Type.kt — new type scale, keep Inter font**

Replace the `QCTypography` val in `[p]ui/theme/Type.kt` (keep the font family declarations at the top unchanged):

```kotlin
val QCTypography = Typography(
    displayLarge  = TextStyle(color = QCTextPrimary, fontFamily = InterFontFamily, fontWeight = FontWeight.Bold,     fontSize = 32.sp, lineHeight = 40.sp, letterSpacing = (-0.25).sp),
    headlineLarge = TextStyle(color = QCTextPrimary, fontFamily = InterFontFamily, fontWeight = FontWeight.Bold,     fontSize = 26.sp, lineHeight = 34.sp),
    headlineMedium= TextStyle(color = QCTextPrimary, fontFamily = InterFontFamily, fontWeight = FontWeight.SemiBold, fontSize = 22.sp, lineHeight = 30.sp),
    headlineSmall = TextStyle(color = QCTextPrimary, fontFamily = InterFontFamily, fontWeight = FontWeight.SemiBold, fontSize = 20.sp, lineHeight = 28.sp),
    titleLarge    = TextStyle(color = QCTextPrimary, fontFamily = InterFontFamily, fontWeight = FontWeight.SemiBold, fontSize = 18.sp, lineHeight = 24.sp),
    titleMedium   = TextStyle(color = QCTextPrimary, fontFamily = InterFontFamily, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, lineHeight = 22.sp, letterSpacing = 0.15.sp),
    titleSmall    = TextStyle(color = QCTextPrimary, fontFamily = InterFontFamily, fontWeight = FontWeight.Medium,   fontSize = 14.sp, lineHeight = 20.sp),
    bodyLarge     = TextStyle(color = QCTextPrimary, fontFamily = InterFontFamily, fontWeight = FontWeight.Normal,   fontSize = 16.sp, lineHeight = 24.sp, letterSpacing = 0.5.sp),
    bodyMedium    = TextStyle(color = QCTextPrimary, fontFamily = InterFontFamily, fontWeight = FontWeight.Normal,   fontSize = 14.sp, lineHeight = 20.sp, letterSpacing = 0.25.sp),
    bodySmall     = TextStyle(color = QCTextPrimary, fontFamily = InterFontFamily, fontWeight = FontWeight.Normal,   fontSize = 12.sp, lineHeight = 16.sp, letterSpacing = 0.4.sp),
    labelLarge    = TextStyle(color = QCTextPrimary, fontFamily = InterFontFamily, fontWeight = FontWeight.Medium,   fontSize = 14.sp, lineHeight = 20.sp, letterSpacing = 0.1.sp),
    labelMedium   = TextStyle(color = QCTextPrimary, fontFamily = InterFontFamily, fontWeight = FontWeight.Medium,   fontSize = 12.sp, lineHeight = 16.sp),
    labelSmall    = TextStyle(color = QCTextPrimary, fontFamily = InterFontFamily, fontWeight = FontWeight.SemiBold, fontSize = 11.sp, lineHeight = 14.sp, letterSpacing = 0.8.sp),
)
```

- [ ] **Step A3: Replace Theme.kt — remove dark scheme, force light always**

Replace the entire content of `[p]ui/theme/Theme.kt`:

```kotlin
package com.qcpaintshop.painter.ui.theme

import android.app.Activity
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat

private val QCLightScheme = lightColorScheme(
    primary              = QCGreen,
    onPrimary            = QCSurface,
    primaryContainer     = QCGreenContainer,
    onPrimaryContainer   = QCGreenDarkest,
    secondary            = QCGold,
    onSecondary          = QCSurface,
    secondaryContainer   = QCGoldContainer,
    background           = QCBackground,
    surface              = QCSurface,
    surfaceVariant       = QCSurfaceVariant,
    onBackground         = QCTextPrimary,
    onSurface            = QCTextPrimary,
    onSurfaceVariant     = QCTextSecondary,
    outline              = QCBorderLight,
    error                = QCError,
    onError              = QCSurface,
)

@Composable
fun QCPainterTheme(content: @Composable () -> Unit) {
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            @Suppress("DEPRECATION")
            window.statusBarColor = QCGreen.toArgb()
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = false
        }
    }
    MaterialTheme(
        colorScheme = QCLightScheme,
        typography  = QCTypography,
        shapes      = AppShapes,
    ) {
        CompositionLocalProvider(LocalContentColor provides QCTextPrimary) {
            content()
        }
    }
}
```

- [ ] **Step A4: Verify compile — no dark token references remain**

```
cd "D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\qcpaintshop-android"
.\gradlew :app:compilePainterReleaseKotlin --no-daemon "-Dkotlin.daemon.jvm.options=-Xmx3072m" 2>&1 | Select-String -Pattern "error:|warning:" | Select-Object -First 30
```

Expected: 0 errors. If you see `Unresolved reference: QCBackgroundDark` or similar dark tokens in other files, find all usages with:
```
grep -r "QCBackgroundDark\|QCSurfaceDark\|QCTextPrimaryDark\|QCTextSecondaryDark\|QCBorderLightDark\|QCSurfaceVariantDark\|QCTextTertiaryDark" app/src/painter/ --include="*.kt" -l
```
For each file found: replace any dark token with its light equivalent (e.g. `QCSurfaceDark` → `QCSurface`, `QCTextPrimaryDark` → `QCTextPrimary`).

- [ ] **Step A5: Commit**

```
cd "D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\qcpaintshop-android"
git add app/src/painter/java/com/qcpaintshop/painter/ui/theme/Color.kt app/src/painter/java/com/qcpaintshop/painter/ui/theme/Type.kt app/src/painter/java/com/qcpaintshop/painter/ui/theme/Theme.kt
git commit -m "feat(design-system): Goal A — light-only Color/Type/Theme, remove dark scheme"
```

---

## Task B: Navigation & Action Sheet

**Files:**
- Modify: `[p]navigation/AppNavigation.kt` — `NewActionSheet` + `NewActionItem`
- Modify: `[p]navigation/BottomNavBar.kt`

- [ ] **Step B1: Redesign NewActionSheet — add gradient header**

In `[p]navigation/AppNavigation.kt`, replace the `NewActionSheet` composable (the `@Composable fun NewActionSheet(...)` function and the private `NewActionItem` function below it):

```kotlin
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewActionSheet(onDismiss: () -> Unit, onAction: (String) -> Unit) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
    ) {
        Column(modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = 32.dp)) {
            // Gradient header band
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(
                        brush = Brush.linearGradient(listOf(QCGreen, QCGreenDarkest)),
                        shape = RoundedCornerShape(10.dp)
                    )
                    .padding(horizontal = 16.dp, vertical = 12.dp)
            ) {
                Text(
                    text = "Quick Actions",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                )
            }
            Spacer(Modifier.height(12.dp))
            NewActionItem(icon = Icons.Rounded.Description,   title = "New Estimate",      subtitle = "Create billing estimate for customer",   onClick = { onAction(Routes.EstimateCreate.route) })
            Spacer(Modifier.height(6.dp))
            NewActionItem(icon = Icons.Rounded.RequestQuote,  title = "New Quotation",     subtitle = "Create contract quotation",              onClick = { onAction(Routes.QuotationCreate.route) })
            Spacer(Modifier.height(6.dp))
            NewActionItem(icon = Icons.Rounded.CameraAlt,     title = "Check-in",          subtitle = "Mark attendance with selfie",            onClick = { onAction(Routes.CheckIn.route) })
            Spacer(Modifier.height(6.dp))
            NewActionItem(icon = Icons.Rounded.Calculate,     title = "Paint Calculator",  subtitle = "Calculate paint needed for area",        onClick = { onAction(Routes.Calculator.route) })
        }
    }
}

@Composable
private fun NewActionItem(icon: ImageVector, title: String, subtitle: String, onClick: () -> Unit) {
    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().semantics { contentDescription = title },
        color = QCBackground,
        shape = RoundedCornerShape(10.dp),
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Surface(shape = RoundedCornerShape(10.dp), color = QCGreenContainer, modifier = Modifier.size(38.dp)) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(icon, contentDescription = null, tint = QCGreen, modifier = Modifier.size(20.dp))
                }
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(title,    style = MaterialTheme.typography.titleSmall,  fontWeight = FontWeight.SemiBold, color = QCTextPrimary)
                Text(subtitle, style = MaterialTheme.typography.bodySmall,   color = QCTextTertiary)
            }
            Icon(Icons.Rounded.ChevronRight, contentDescription = null, tint = QCGreen, modifier = Modifier.size(18.dp))
        }
    }
}
```

Make sure `Brush` is imported: `import androidx.compose.ui.graphics.Brush`
Make sure `RoundedCornerShape` is imported: `import androidx.compose.foundation.shape.RoundedCornerShape`
Make sure `QCGreenDarkest`, `QCBackground`, `QCGreenContainer`, `QCTextPrimary`, `QCTextTertiary` are imported from the theme.

- [ ] **Step B2: Update BottomNavBar — selected indicator pill**

In `[p]navigation/BottomNavBar.kt`, replace the tab `Column` block (the `else` branch inside `items.forEach`) to add a selected indicator pill:

```kotlin
} else {
    val isSelected = currentRoute == item.route
    val iconColor by animateColorAsState(
        if (isSelected) QCGreen else QCTextTertiary,
        label = "tabColor"
    )
    Column(
        modifier = Modifier
            .weight(1f)
            .clickable { onTabSelected(item.route) }
            .padding(vertical = 4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        // Selected indicator pill
        Box(
            modifier = Modifier
                .size(width = 32.dp, height = 3.dp)
                .background(
                    if (isSelected) QCGreen else Color.Transparent,
                    RoundedCornerShape(bottomStart = 3.dp, bottomEnd = 3.dp)
                )
                .offset(y = (-4).dp)
        )
        Icon(
            if (isSelected) item.selectedIcon else item.unselectedIcon,
            contentDescription = stringResource(item.labelResId),
            tint = iconColor,
            modifier = Modifier.size(24.dp),
        )
        Spacer(Modifier.height(2.dp))
        Text(
            text = stringResource(item.labelResId),
            color = iconColor,
            fontSize = 11.sp,
            fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
            maxLines = 1,
        )
    }
}
```

Add import: `import androidx.compose.foundation.shape.RoundedCornerShape`

- [ ] **Step B3: Compile check**

```
.\gradlew :app:compilePainterReleaseKotlin --no-daemon "-Dkotlin.daemon.jvm.options=-Xmx3072m" 2>&1 | Select-String "error:"
```

Expected: 0 errors.

- [ ] **Step B4: Commit**

```
git add app/src/painter/java/com/qcpaintshop/painter/navigation/AppNavigation.kt app/src/painter/java/com/qcpaintshop/painter/navigation/BottomNavBar.kt
git commit -m "feat(design): Goal B — NewActionSheet gradient header + BottomNavBar pill indicator"
```

---

## Task C: Auth & Onboarding

**Files:**
- Modify: `[p]ui/auth/LoginScreen.kt`
- Modify: `[p]ui/auth/AwaitingApprovalScreen.kt`
- Modify: `[p]ui/onboarding/OnboardingScreen.kt`

- [ ] **Step C1: LoginScreen — ensure green status bar context & white panel**

In `[p]ui/auth/LoginScreen.kt`, find the top-level `Scaffold` or `Box` container.
Ensure the screen uses a `Box` split: top portion is a gradient, bottom is white.
The screen already has a gradient hero from the enterprise redesign. Verify these colors are correct (not dark tokens):
- Top gradient: `Brush.linearGradient(listOf(QCGreen, QCGreenDarkest))` with white text
- Bottom panel: `background = QCSurface` (white), rounded top corners `RoundedCornerShape(topStart = 24.dp, topEnd = 24.dp)`
- OTP input border when focused: `QCGreen`
- Verify button: `containerColor = QCGreen`

Search for any remaining `QCBackgroundDark` / `QCSurfaceDark` references and replace with `QCBackground` / `QCSurface`.

- [ ] **Step C2: AwaitingApprovalScreen — verify light colors**

In `[p]ui/auth/AwaitingApprovalScreen.kt`:
- Ensure `Modifier.background(MaterialTheme.colorScheme.background)` on root — already set (line 56 per scan)
- Verify timeline step circles: completed = `QCGreen` fill, pending = `QCBorderLight` fill
- Verify all text uses `QCTextPrimary` / `QCTextSecondary` (not dark tokens)
- Remove any `isSystemInDarkTheme()` calls if present

- [ ] **Step C3: OnboardingScreen — verify gradient pages**

In `[p]ui/onboarding/OnboardingScreen.kt`:
- Each page background: `Brush.linearGradient(listOf(QCGreen, QCGreenDarkest))` — white text (intentional brand screen)
- "Get Started" button: `containerColor = QCGold`, `contentColor = Color.White`
- "Skip" button: `color = Color.White` text button
- Page dots: selected = `Color.White`, unselected = `Color.White.copy(alpha = 0.4f)`

- [ ] **Step C4: Compile check + commit**

```
.\gradlew :app:compilePainterReleaseKotlin --no-daemon "-Dkotlin.daemon.jvm.options=-Xmx3072m" 2>&1 | Select-String "error:"
git add app/src/painter/java/com/qcpaintshop/painter/ui/auth/ app/src/painter/java/com/qcpaintshop/painter/ui/onboarding/
git commit -m "feat(design): Goal C — Auth + Onboarding light-mode verified"
```

---

## Task D: Home Screen

**Files:**
- Modify: `[p]ui/home/HomeScreen.kt`
- Modify: `[p]ui/home/components/QuickActionsRow.kt`
- Modify: `[p]ui/home/components/StreakSheet.kt`
- Modify: `[p]ui/home/components/WithdrawalSheet.kt`

- [ ] **Step D1: HomeScreen — HeroCard gradient + stat cards**

In `[p]ui/home/HomeScreen.kt`:

The HeroCard should use:
```kotlin
Card(
    modifier = Modifier.fillMaxWidth(),
    shape = RoundedCornerShape(16.dp),
    colors = CardDefaults.cardColors(containerColor = Color.Transparent),
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(Brush.linearGradient(listOf(QCGreen, QCGreenDarkest)))
            .padding(20.dp)
    ) {
        Column {
            Text(
                text = "Good morning",
                style = MaterialTheme.typography.bodyMedium,
                color = Color.White.copy(alpha = 0.75f),
            )
            Text(
                text = painterName,         // from ViewModel state
                style = MaterialTheme.typography.headlineMedium,
                color = Color.White,
                fontWeight = FontWeight.Bold,
            )
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                // Tier badge
                Surface(shape = RoundedCornerShape(8.dp), color = QCGoldContainer) {
                    Text(
                        text = tierLabel,   // e.g. "Silver Painter"
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                        style = MaterialTheme.typography.labelSmall,
                        color = QCGoldDark,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
                // Points chip
                Surface(shape = RoundedCornerShape(8.dp), color = Color.White.copy(alpha = 0.15f)) {
                    Text(
                        text = "⭐ $pointsBalance pts",
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                        style = MaterialTheme.typography.labelSmall,
                        color = Color.White,
                        fontWeight = FontWeight.SemiBold,
                    )
                }
            }
        }
    }
}
```

Ensure screen `Scaffold`/root uses `containerColor = MaterialTheme.colorScheme.background`.

Stat cards row (today earnings, month total) — use standard card pattern:
```kotlin
Card(
    modifier = Modifier.weight(1f),
    shape = RoundedCornerShape(12.dp),
    colors = CardDefaults.cardColors(containerColor = QCSurface),
    border = BorderStroke(1.dp, QCBorderLight),
    elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
) {
    Column(modifier = Modifier.padding(14.dp)) {
        Text(label, style = MaterialTheme.typography.bodySmall, color = QCTextTertiary)
        Text(amount, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, color = QCTextPrimary)
        Text(trend, style = MaterialTheme.typography.bodySmall, color = QCGreenLight)
    }
}
```

- [ ] **Step D2: QuickActionsRow — DCFCE7 icon containers**

In `[p]ui/home/components/QuickActionsRow.kt`, each action item card:
```kotlin
Card(
    onClick = onClick,
    modifier = Modifier.weight(1f).aspectRatio(1f),
    shape = RoundedCornerShape(14.dp),
    colors = CardDefaults.cardColors(containerColor = QCSurface),
    border = BorderStroke(1.dp, QCBorderLight),
    elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
) {
    Column(
        modifier = Modifier.fillMaxSize().padding(12.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Surface(shape = RoundedCornerShape(10.dp), color = QCGreenContainer, modifier = Modifier.size(44.dp)) {
            Box(contentAlignment = Alignment.Center) {
                Icon(icon, contentDescription = null, tint = QCGreen, modifier = Modifier.size(22.dp))
            }
        }
        Spacer(Modifier.height(8.dp))
        Text(label, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = QCTextPrimary, textAlign = TextAlign.Center)
    }
}
```

- [ ] **Step D3: StreakSheet — add gradient header**

In `[p]ui/home/components/StreakSheet.kt`, the `ModalBottomSheet` already has `containerColor = MaterialTheme.colorScheme.surface`. Add gradient header band inside the sheet Column, before the calendar content:

```kotlin
// Add inside the sheet Column, replace any plain Text title:
Box(
    modifier = Modifier
        .fillMaxWidth()
        .padding(horizontal = 16.dp)
        .background(Brush.linearGradient(listOf(QCGreen, QCGreenDarkest)), RoundedCornerShape(10.dp))
        .padding(horizontal = 16.dp, vertical = 12.dp)
) {
    Row(horizontalArrangement = Arrangement.SpaceBetween, modifier = Modifier.fillMaxWidth()) {
        Text("Attendance Streak", style = MaterialTheme.typography.titleMedium, color = Color.White, fontWeight = FontWeight.Bold)
        Text("🔥 $streakCount days", style = MaterialTheme.typography.titleSmall, color = QCGold, fontWeight = FontWeight.Bold)
    }
}
```

Calendar checked days: `QCGreen` filled circle with white number.
Calendar unchecked days: `QCSurfaceVariant` circle with `QCTextTertiary` number.

- [ ] **Step D4: WithdrawalSheet — add gradient header + gold balance**

In `[p]ui/home/components/WithdrawalSheet.kt`, the `ModalBottomSheet` already has `containerColor = MaterialTheme.colorScheme.surface`. Add gradient header:

```kotlin
// Replace any plain title Text with:
Box(
    modifier = Modifier
        .fillMaxWidth()
        .padding(horizontal = 16.dp)
        .background(Brush.linearGradient(listOf(QCGreen, QCGreenDarkest)), RoundedCornerShape(10.dp))
        .padding(16.dp)
) {
    Column {
        Text("Withdraw Points", style = MaterialTheme.typography.titleMedium, color = Color.White, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(4.dp))
        Text(
            text = "₹${availableBalance}",
            style = MaterialTheme.typography.headlineMedium,
            color = QCGold,
            fontWeight = FontWeight.Bold,
        )
        Text("available balance", style = MaterialTheme.typography.bodySmall, color = Color.White.copy(alpha = 0.7f))
    }
}
```

Amount quick-select chips: `background = QCGreenContainer`, `color = QCGreen`, selected: `background = QCGreen`, `color = Color.White`.

Submit button: `containerColor = QCGreen`, gradient brush.

- [ ] **Step D5: Compile check + commit**

```
.\gradlew :app:compilePainterReleaseKotlin --no-daemon "-Dkotlin.daemon.jvm.options=-Xmx3072m" 2>&1 | Select-String "error:"
git add app/src/painter/java/com/qcpaintshop/painter/ui/home/
git commit -m "feat(design): Goal D — Home HeroCard gradient + QuickActions + Streak + Withdrawal sheets"
```

---

## Task E: Catalog & Product Detail ★ Critical Fixes

**Files:**
- Modify: `[p]ui/catalog/CatalogScreen.kt`
- Modify: `[p]ui/catalog/ProductDetailSheet.kt`

- [ ] **Step E1: CatalogScreen — fix 4 missing containerColors**

In `[p]ui/catalog/CatalogScreen.kt`:

**Fix 1 — AlertDialog (line 446):** Add `containerColor = MaterialTheme.colorScheme.surface`:
```kotlin
AlertDialog(
    containerColor = MaterialTheme.colorScheme.surface,
    onDismissRequest = { ... },
    // rest unchanged
```

**Fix 2 — ProductDetailLoadingSheet (line 911):** Add `containerColor`:
```kotlin
ModalBottomSheet(
    containerColor = MaterialTheme.colorScheme.surface,
    onDismissRequest = { ... },
    // rest unchanged
```

**Fix 3 — ProductRequestSheet (line 935):** Add `containerColor`:
```kotlin
ModalBottomSheet(
    containerColor = MaterialTheme.colorScheme.surface,
    onDismissRequest = { ... },
    // rest unchanged
```

**Fix 4 — CartBottomSheet (line 973):** Add `containerColor`:
```kotlin
ModalBottomSheet(
    containerColor = MaterialTheme.colorScheme.surface,
    onDismissRequest = { ... },
    // rest unchanged
```

Also update brand filter chips to use the standard chip pattern:
- Selected chip: `FilterChip(selected = true, colors = FilterChipDefaults.filterChipColors(selectedContainerColor = QCGreen, selectedLabelColor = Color.White, selectedLeadingIconColor = Color.White))`
- Unselected chip: `FilterChip(selected = false, colors = FilterChipDefaults.filterChipColors(containerColor = QCSurface, labelColor = QCTextSecondary, iconColor = QCTextTertiary), border = FilterChipDefaults.filterChipBorder(borderColor = QCBorderLight, selectedBorderColor = QCGreen))`

- [ ] **Step E2: ProductDetailSheet — add containerColor + gradient header**

In `[p]ui/catalog/ProductDetailSheet.kt`, line 63:

```kotlin
ModalBottomSheet(
    onDismissRequest = onDismiss,
    containerColor = MaterialTheme.colorScheme.surface,   // ← ADD THIS
    sheetState = sheetState,
) {
```

Then find the product header section (product name, brand, price). Replace it with a gradient header:

```kotlin
// Gradient header — place at top of sheet content, before size table
Box(
    modifier = Modifier
        .fillMaxWidth()
        .background(Brush.linearGradient(listOf(QCGreen, QCGreenDarkest)))
        .padding(20.dp)
) {
    Column {
        Text(
            text = product.brandName.uppercase(),
            style = MaterialTheme.typography.labelSmall,
            color = Color.White.copy(alpha = 0.65f),
            letterSpacing = 1.sp,
        )
        Spacer(Modifier.height(4.dp))
        Text(
            text = product.name,
            style = MaterialTheme.typography.titleLarge,
            color = Color.White,
            fontWeight = FontWeight.Bold,
        )
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            // Price
            Text(
                text = "₹${lowestPrice}",
                style = MaterialTheme.typography.headlineSmall,
                color = QCGold,
                fontWeight = FontWeight.Bold,
            )
            // Points chip
            if (pointsValue > 0) {
                Surface(shape = RoundedCornerShape(8.dp), color = QCGoldContainer.copy(alpha = 0.2f)) {
                    Text(
                        text = "⭐ $pointsValue pts",
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                        style = MaterialTheme.typography.labelSmall,
                        color = QCGold,
                    )
                }
            }
            // Stock chip
            Surface(shape = RoundedCornerShape(8.dp), color = if (inStock) QCGreenContainer.copy(alpha = 0.3f) else Color(0xFFFEE2E2).copy(alpha = 0.3f)) {
                Text(
                    text = if (inStock) "✓ In Stock" else "Out of Stock",
                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
                    style = MaterialTheme.typography.labelSmall,
                    color = if (inStock) Color.White else Color.White.copy(alpha = 0.8f),
                )
            }
        }
    }
}
```

Size table rows (below gradient header):
- Normal row: `Modifier.background(QCSurface)`, amount `color = QCGoldDark` (on white surface)
- Selected row: `Modifier.background(QCGreenContainer)`, amount `color = QCGreen`

"Add to Estimate" button at bottom: `containerColor = QCGreen`, full width, `Brush.linearGradient` background.

Price text in the size table uses `QCGoldDark` (not `QCGold`) because it's on a white surface — `#B8891F` passes contrast on white.

- [ ] **Step E3: Compile check + commit**

```
.\gradlew :app:compilePainterReleaseKotlin --no-daemon "-Dkotlin.daemon.jvm.options=-Xmx3072m" 2>&1 | Select-String "error:"
git add app/src/painter/java/com/qcpaintshop/painter/ui/catalog/
git commit -m "feat(design): Goal E — CatalogScreen 4x containerColor fix + ProductDetailSheet gradient header"
```

---

## Task F: Work & Attendance

**Files:**
- Modify: `[p]ui/work/WorkScreen.kt`
- Modify: `[p]ui/work/estimates/EstimateCreateScreen.kt`
- Modify: `[p]ui/attendance/CheckInScreen.kt`
- Modify: `[p]ui/attendance/AttendanceHistoryScreen.kt`

- [ ] **Step F1: WorkScreen — premium estimate cards**

In `[p]ui/work/WorkScreen.kt`:

Estimate list item card:
```kotlin
Card(
    onClick = { onEstimateClick(estimate.id) },
    modifier = Modifier.fillMaxWidth(),
    shape = RoundedCornerShape(14.dp),
    colors = CardDefaults.cardColors(containerColor = QCSurface),
    border = BorderStroke(1.dp, QCBorderLight),
    elevation = CardDefaults.cardElevation(defaultElevation = 1.dp),
) {
    Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(modifier = Modifier.weight(1f)) {
            Text(estimate.customerName, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold, color = QCTextPrimary)
            Text(estimate.id, style = MaterialTheme.typography.bodySmall, color = QCTextTertiary)
        }
        Column(horizontalAlignment = Alignment.End) {
            Text("₹${estimate.amount}", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = QCGoldDark)
            Spacer(Modifier.height(4.dp))
            StatusChip(estimate.status)
        }
    }
}
```

Status chip helper:
```kotlin
@Composable
private fun StatusChip(status: String) {
    val (bg, fg) = when (status.lowercase()) {
        "approved"  -> QCGreenContainer to QCGreenLight
        "pending"   -> Color(0xFFDBEAFE) to QCInfoBlue
        "rejected"  -> Color(0xFFFEE2E2) to QCError
        else        -> QCSurfaceVariant to QCTextTertiary
    }
    Surface(shape = RoundedCornerShape(20.dp), color = bg) {
        Text(status, modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp), style = MaterialTheme.typography.labelSmall, color = fg, fontWeight = FontWeight.SemiBold)
    }
}
```

Screen background: `containerColor = MaterialTheme.colorScheme.background` on Scaffold.

- [ ] **Step F2: EstimateCreateScreen — fix AlertDialog + search focus**

In `[p]ui/work/estimates/EstimateCreateScreen.kt`, line 220:

```kotlin
AlertDialog(
    containerColor = MaterialTheme.colorScheme.surface,   // ← ADD THIS
    onDismissRequest = { ... },
    // rest unchanged
```

Search OutlinedTextField: ensure `colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = QCGreen, focusedLabelColor = QCGreen, cursorColor = QCGreen)`.

Selected product rows: `Modifier.background(QCGreenContainer)` when selected.

- [ ] **Step F3: CheckInScreen — verify light-mode capture ring**

In `[p]ui/attendance/CheckInScreen.kt`:

The camera preview area intentionally uses dark backgrounds (camera feed) — white text on camera is correct. Do NOT change text colors in the camera preview overlay.

Outside the camera preview area, verify:
- Location chip: `background = QCGreenContainer`, `color = QCGreen`
- Capture button ring: `QCGreen` animated border
- Success overlay: `background = Brush.linearGradient(listOf(QCGreen, QCGreenDarkest))`, white checkmark icon and text

Remove any `if (isDark)` branch or `isSystemInDarkTheme()` calls.

- [ ] **Step F4: AttendanceHistoryScreen — month headers + AP badge**

In `[p]ui/attendance/AttendanceHistoryScreen.kt`:

Month header:
```kotlin
Text(
    text = monthLabel.uppercase(),
    style = MaterialTheme.typography.labelSmall,
    color = QCTextTertiary,
    letterSpacing = 1.sp,
    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
)
```

AP earned badge:
```kotlin
Surface(shape = RoundedCornerShape(8.dp), color = QCGoldContainer) {
    Text(
        text = "+${apEarned} AP",
        modifier = Modifier.padding(horizontal = 8.dp, vertical = 3.dp),
        style = MaterialTheme.typography.labelSmall,
        color = QCGoldDark,
        fontWeight = FontWeight.SemiBold,
    )
}
```

- [ ] **Step F5: Compile check + commit**

```
.\gradlew :app:compilePainterReleaseKotlin --no-daemon "-Dkotlin.daemon.jvm.options=-Xmx3072m" 2>&1 | Select-String "error:"
git add app/src/painter/java/com/qcpaintshop/painter/ui/work/ app/src/painter/java/com/qcpaintshop/painter/ui/attendance/
git commit -m "feat(design): Goal F — Work cards + EstimateCreate fix + CheckIn + AttendanceHistory"
```

---

## Task G: Profile, Settings & Points

**Files:**
- Modify: `[p]ui/profile/ProfileScreen.kt`
- Modify: `[p]ui/profile/EditProfileScreen.kt`
- Modify: `[p]ui/profile/SettingsScreen.kt`
- Modify: `[p]ui/profile/AchievementsScreen.kt`
- Modify: `[p]ui/profile/PointsHistoryScreen.kt`

- [ ] **Step G1: ProfileScreen — gradient hero header + icon containers**

In `[p]ui/profile/ProfileScreen.kt`, hero header section:

```kotlin
Box(
    modifier = Modifier
        .fillMaxWidth()
        .background(Brush.linearGradient(listOf(QCGreen, QCGreenDarkest)))
        .padding(top = 48.dp, bottom = 24.dp, start = 20.dp, end = 20.dp)
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
        // Profile photo with green border ring
        Box {
            AsyncImage(model = photoUrl, contentDescription = "Profile photo",
                modifier = Modifier.size(80.dp).clip(CircleShape).border(3.dp, QCGold, CircleShape),
                contentScale = ContentScale.Crop)
        }
        Spacer(Modifier.height(12.dp))
        Text(painterName, style = MaterialTheme.typography.titleLarge, color = Color.White, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(4.dp))
        // Tier badge
        Surface(shape = RoundedCornerShape(8.dp), color = QCGoldContainer) {
            Text(tierLabel, modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
                style = MaterialTheme.typography.labelSmall, color = QCGoldDark, fontWeight = FontWeight.SemiBold)
        }
    }
}
```

Menu items use `QCGreenContainer` icon containers (38dp, `RoundedCornerShape(10.dp)`), `QCGreen` icon tint, `QCBorderLight` dividers.

- [ ] **Step G2: EditProfileScreen — fix AlertDialog + green focus**

In `[p]ui/profile/EditProfileScreen.kt`, line 404:

```kotlin
AlertDialog(
    containerColor = MaterialTheme.colorScheme.surface,   // ← ADD THIS
    onDismissRequest = { ... },
    // rest unchanged
```

All `OutlinedTextField`: `colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = QCGreen, focusedLabelColor = QCGreen, cursorColor = QCGreen)`.

Save button: `containerColor = QCGreen`.

- [ ] **Step G3: SettingsScreen — remove dark mode toggle**

In `[p]ui/profile/SettingsScreen.kt`, find and delete the dark mode toggle section. This is typically a `Row` or `ListItem` containing a `Switch` with a label like "Dark Mode", "Night Mode", or referencing `isSystemInDarkTheme` / `darkTheme`.

Keep: Language, Notifications, About, Logout.

Logout item: `color = QCError` on the text/icon.

If `SettingsViewModel.kt` has `clearDarkMode()` or a dark mode state, delete that function and its usages in SettingsScreen.

- [ ] **Step G4: AchievementsScreen — earned/locked visual states**

In `[p]ui/profile/AchievementsScreen.kt`:

Earned achievement:
```kotlin
Card(
    shape = RoundedCornerShape(14.dp),
    colors = CardDefaults.cardColors(containerColor = QCSurface),
    border = BorderStroke(1.dp, QCGreenContainer),
) {
    Column(modifier = Modifier.padding(16.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Surface(shape = CircleShape, color = QCGreenContainer, modifier = Modifier.size(56.dp)) {
            Box(contentAlignment = Alignment.Center) {
                Icon(achievementIcon, contentDescription = null, tint = QCGreen, modifier = Modifier.size(28.dp))
            }
        }
        // title + desc below
    }
}
```

Locked achievement: same structure but `color = QCSurfaceVariant` for the icon circle, `tint = QCTextDisabled`, `alpha = 0.5f` on the card.

Progress bar: `LinearProgressIndicator(progress = progress, color = QCGreen, trackColor = QCBorderLight)`.

- [ ] **Step G5: PointsHistoryScreen — gradient balance card + gold transactions**

In `[p]ui/profile/PointsHistoryScreen.kt`:

Balance card (already has gradient from enterprise redesign — verify using light tokens):
```kotlin
Box(
    modifier = Modifier
        .fillMaxWidth()
        .background(Brush.linearGradient(listOf(QCGreen, QCGreenDarkest)))
        .padding(20.dp)
) {
    Column {
        Text("Your Balance", style = MaterialTheme.typography.bodyMedium, color = Color.White.copy(alpha = 0.75f))
        Text("₹${balance}", style = MaterialTheme.typography.displayLarge, color = QCGold, fontWeight = FontWeight.Bold)
        Text("${pointsBalance} points", style = MaterialTheme.typography.bodyLarge, color = Color.White.copy(alpha = 0.85f))
    }
}
```

Transaction row:
- Earned: amount `color = QCGreenLight`, prefix "+"
- Redeemed: amount `color = QCError`, prefix "-"

Screen background: `Modifier.background(MaterialTheme.colorScheme.background)`.

Filter tabs (All / Regular / Annual): selected `color = QCGreen` with `QCGreenContainer` background indicator, unselected `color = QCTextTertiary`.

- [ ] **Step G6: Compile check + commit**

```
.\gradlew :app:compilePainterReleaseKotlin --no-daemon "-Dkotlin.daemon.jvm.options=-Xmx3072m" 2>&1 | Select-String "error:"
git add app/src/painter/java/com/qcpaintshop/painter/ui/profile/
git commit -m "feat(design): Goal G — Profile gradient + EditProfile fix + remove dark toggle + Achievements + Points"
```

---

## Task H: Build & Deliver v4.0.0 vc39

**Files:**
- Modify: `app/build.gradle.kts` — painter flavor versionCode/Name

- [ ] **Step H1: Bump version**

In `app/build.gradle.kts`, find the `painter` flavor block and update:

```kotlin
// painter flavor — find these two lines and change:
versionCode = 39
versionName = "4.0.0"
```

- [ ] **Step H2: Full release build**

```
cd "D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\qcpaintshop-android"
.\gradlew assemblePainterRelease --no-daemon "-Dkotlin.daemon.jvm.options=-Xmx3072m -XX:MaxMetaspaceSize=512m -XX:+UseSerialGC"
```

Expected: `BUILD SUCCESSFUL`. APK at:
`app/build/outputs/apk/painter/release/app-painter-release.apk`

- [ ] **Step H3: Commit version bump**

```
git add app/build.gradle.kts
git commit -m "chore(release): bump painter to v4.0.0 vc39 — light-mode redesign"
```

- [ ] **Step H4: Deliver APK to Telegram**

```
cd "D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\google-services"
node publish-painter.js --apk-only
```

If `publish-painter.js` doesn't support `--apk-only`, send directly via curl:

```powershell
$token = "YOUR_BOT_TOKEN"   # from reference_telegram_apk_delivery.md
$chatId = "930726256"
$apkPath = "D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\qcpaintshop-android\app\build\outputs\apk\painter\release\app-painter-release.apk"
curl -F "chat_id=$chatId" -F "document=@$apkPath" -F "caption=Painter v4.0.0 vc39 — Full light-mode redesign 🎨" "https://api.telegram.org/bot$token/sendDocument"
```

Expected: Telegram message with APK in chat 930726256.

---

## Self-Review Checklist

After implementing all goals, verify:

- [ ] `grep -r "isSystemInDarkTheme\|QCDarkScheme\|QCBackgroundDark\|QCSurfaceDark\|QCTextPrimaryDark\|QCTextSecondaryDark" app/src/painter/ --include="*.kt"` → 0 results
- [ ] All `ModalBottomSheet` in painter source have `containerColor = MaterialTheme.colorScheme.surface`
- [ ] All `AlertDialog` in painter source have `containerColor = MaterialTheme.colorScheme.surface`
- [ ] `QCGold` only used on gradient (green) backgrounds; `QCGoldDark` used for gold text on white
- [ ] `SettingsScreen` has no dark mode toggle
- [ ] Build succeeds with 0 errors
- [ ] APK delivered to Telegram chat 930726256
