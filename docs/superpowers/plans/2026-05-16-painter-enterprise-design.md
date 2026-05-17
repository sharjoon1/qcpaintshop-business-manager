# Painter Enterprise Design Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Full creative screen-by-screen enterprise redesign of the QC Painter Android app — 19 screens across 9 goals, fixing critical dark mode contrast failures and elevating every screen to modern trade-app quality.

**Architecture:** All color usage migrated from hardcoded `QC*` tokens to `MaterialTheme.colorScheme.*` so light/dark mode switches correctly. Task A patches the two critical dark-mode failures immediately. Tasks B–H redesign each screen creatively. Task I builds and delivers APK v3.5.0.

**Tech Stack:** Kotlin, Jetpack Compose (MD3), Hilt DI, DataStore Preferences, Navigation Compose, Coil image loading

**Android project root:** `D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\qcpaintshop-android\`

**Painter source root (abbreviated as `[painter]`):**
`app/src/painter/java/com/qcpaintshop/painter/`

**Branch:** `design/painter-app-ux-2026-05`

---

## Color Migration Reference

Every screen redesign uses this substitution table. Never hardcode `QC*` colors for backgrounds/text — always use `MaterialTheme.colorScheme.*`:

| Old hardcoded | Replace with |
|---|---|
| `QCBackground` | `MaterialTheme.colorScheme.background` |
| `QCSurface` | `MaterialTheme.colorScheme.surface` |
| `QCSurfaceVariant` | `MaterialTheme.colorScheme.surfaceVariant` |
| `QCTextPrimary` | `MaterialTheme.colorScheme.onSurface` |
| `QCTextSecondary` | `MaterialTheme.colorScheme.onSurfaceVariant` |
| `QCTextTertiary` | `MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)` |
| `QCBorderLight` | `MaterialTheme.colorScheme.outline` |
| Card `containerColor = QCSurface` | `CardDefaults.cardColors()` (default = surface) |

**Keep hardcoded:** `QCGreen` for hero gradients / intentional brand moments, `QCGold` for earnings/points, status colors (`QCError`, `QCWarningAmber`, semantic greens).

---

## File Map

**Modify:**
- `[painter]ui/theme/Theme.kt` — add `onSurfaceVariant` to both color schemes
- `[painter]navigation/AppNavigation.kt` — redesign `NewActionSheet`, add `Onboarding` route + start destination logic
- `[painter]navigation/Routes.kt` — add `Routes.Onboarding`
- `[painter]navigation/BottomNavBar.kt` — migrate hardcoded colors to `colorScheme.*`
- `[painter]data/local/datastore/UserPreferences.kt` — add `ONBOARDING_COMPLETE` key
- `[painter]ui/auth/LoginScreen.kt` — full redesign
- `[painter]ui/auth/AwaitingApprovalScreen.kt` — full redesign
- `[painter]ui/home/HomeScreen.kt` — full redesign
- `[painter]ui/home/components/QuickActionsRow.kt` — full redesign
- `[painter]ui/home/components/StreakSheet.kt` — full redesign
- `[painter]ui/catalog/CatalogScreen.kt` — full redesign
- `[painter]ui/catalog/ProductDetailSheet.kt` — dark mode fix + full redesign
- `[painter]ui/work/WorkScreen.kt` — color migration + card redesign
- `[painter]ui/work/estimates/EstimateCreateScreen.kt` — color migration + sticky search
- `[painter]ui/attendance/CheckInScreen.kt` — full redesign
- `[painter]ui/attendance/AttendanceHistoryScreen.kt` — full redesign
- `[painter]ui/profile/ProfileScreen.kt` — full redesign
- `[painter]ui/profile/EditProfileScreen.kt` — MD3 OutlinedTextField polish
- `[painter]ui/profile/SettingsScreen.kt` — 3-way mode toggle
- `[painter]ui/profile/SettingsViewModel.kt` — clearDarkMode() + 3-way state
- `[painter]ui/profile/AchievementsScreen.kt` — earned/locked visual distinction
- `[painter]ui/profile/PointsHistoryScreen.kt` — tier track + transactions redesign
- `[painter]ui/home/components/WithdrawalSheet.kt` — gold balance + quick chips
- `app/build.gradle.kts` — versionCode/Name painter flavor bump

**Create:**
- `[painter]ui/onboarding/OnboardingScreen.kt` — new 3-page onboarding

---

## Task A: Color Token Foundation + Critical Dark Mode Patches

**Goal:** Fix the two critical dark-mode contrast failures visible in screenshots. Add `onSurfaceVariant` to color schemes. Patch `NewActionSheet` and `BottomNavBar`.

**Files:**
- Modify: `[painter]ui/theme/Theme.kt`
- Modify: `[painter]navigation/AppNavigation.kt` (lines 443–496)
- Modify: `[painter]navigation/BottomNavBar.kt`

- [ ] **Step 1: Add `onSurfaceVariant` to both color schemes in Theme.kt**

Replace the `QCLightScheme` and `QCDarkScheme` definitions in `[painter]ui/theme/Theme.kt`:

```kotlin
private val QCLightScheme = lightColorScheme(
    primary = QCGreen,
    onPrimary = QCSurface,
    primaryContainer = QCGreenContainer,
    onPrimaryContainer = QCGreenDarkest,
    secondary = QCGold,
    onSecondary = QCSurface,
    secondaryContainer = QCGoldContainer,
    background = QCBackground,
    surface = QCSurface,
    surfaceVariant = QCSurfaceVariant,
    onBackground = QCTextPrimary,
    onSurface = QCTextPrimary,
    onSurfaceVariant = QCTextSecondary,
    error = QCError,
    outline = QCBorderLight,
)

private val QCDarkScheme = darkColorScheme(
    primary = QCGreen,
    onPrimary = QCBackgroundDark,
    primaryContainer = QCGreenDarkest,
    onPrimaryContainer = QCGreenContainer,
    secondary = QCGold,
    onSecondary = QCBackgroundDark,
    secondaryContainer = QCGoldLight.copy(alpha = 0.18f),
    background = QCBackgroundDark,
    surface = QCSurfaceDark,
    surfaceVariant = QCSurfaceVariantDark,
    onBackground = QCTextPrimaryDark,
    onSurface = QCTextPrimaryDark,
    onSurfaceVariant = QCTextSecondaryDark,
    error = QCError,
    outline = QCBorderLightDark,
)
```

- [ ] **Step 2: Redesign `NewActionSheet` and `NewActionItem` in AppNavigation.kt**

Replace the `NewActionSheet` and `NewActionItem` composables (starting at line 443):

```kotlin
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NewActionSheet(onDismiss: () -> Unit, onAction: (String) -> Unit) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = MaterialTheme.colorScheme.surface,
        contentColor = MaterialTheme.colorScheme.onSurface,
    ) {
        Column(modifier = Modifier.padding(bottom = 32.dp)) {
            Text(
                text = "Create New",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 12.dp),
            )
            HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.3f))
            Spacer(Modifier.height(8.dp))
            NewActionItem(
                icon = Icons.Rounded.Description,
                title = "New Estimate",
                subtitle = "Create billing estimate for customer",
                onClick = { onAction(Routes.EstimateCreate.route) },
            )
            NewActionItem(
                icon = Icons.Rounded.RequestQuote,
                title = "New Quotation",
                subtitle = "Create contract quotation",
                onClick = { onAction(Routes.QuotationCreate.route) },
            )
            NewActionItem(
                icon = Icons.Rounded.CameraAlt,
                title = "Check-in",
                subtitle = "Mark attendance with selfie",
                onClick = { onAction(Routes.CheckIn.route) },
            )
            NewActionItem(
                icon = Icons.Rounded.Calculate,
                title = "Paint Calculator",
                subtitle = "Calculate paint needed for area",
                onClick = { onAction(Routes.Calculator.route) },
            )
        }
    }
}

@Composable
private fun NewActionItem(
    icon: ImageVector,
    title: String,
    subtitle: String,
    onClick: () -> Unit,
) {
    Surface(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth(),
        color = Color.Transparent,
    ) {
        Row(
            modifier = Modifier.padding(horizontal = 20.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Surface(
                shape = RoundedCornerShape(12.dp),
                color = QCGreen.copy(alpha = 0.12f),
                modifier = Modifier.size(48.dp),
            ) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(icon, contentDescription = null, tint = QCGreen, modifier = Modifier.size(24.dp))
                }
            }
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    title,
                    style = MaterialTheme.typography.titleSmall,
                    fontWeight = FontWeight.SemiBold,
                    color = MaterialTheme.colorScheme.onSurface,
                )
                Text(
                    subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            Icon(
                Icons.Rounded.ChevronRight,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(20.dp),
            )
        }
    }
}
```

Add these imports to AppNavigation.kt (merge with existing imports):
```kotlin
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.rounded.Calculate
import androidx.compose.material.icons.rounded.CameraAlt
import androidx.compose.material.icons.rounded.ChevronRight
import androidx.compose.material.icons.rounded.Description
import androidx.compose.material.icons.rounded.RequestQuote
import androidx.compose.material3.HorizontalDivider
import androidx.compose.ui.graphics.vector.ImageVector
import com.qcpaintshop.painter.ui.theme.QCGreen
```

- [ ] **Step 3: Fix BottomNavBar hardcoded colors**

In `[painter]navigation/BottomNavBar.kt`, replace:
```kotlin
Surface(
    shadowElevation = 8.dp,
    color = QCSurface,
) {
```
with:
```kotlin
Surface(
    shadowElevation = 8.dp,
    color = MaterialTheme.colorScheme.surface,
) {
```

Also remove `import com.qcpaintshop.painter.ui.theme.QCSurface` if it becomes unused.

- [ ] **Step 4: Compile verify**

```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android"
./gradlew :app:compileDebugKotlinPainter --no-daemon -Dkotlin.daemon.jvm.options="-Xmx3072m" 2>&1 | tail -15
```

Expected: `BUILD SUCCESSFUL`

- [ ] **Step 5: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/ui/theme/Theme.kt
git add app/src/painter/java/com/qcpaintshop/painter/navigation/AppNavigation.kt
git add app/src/painter/java/com/qcpaintshop/painter/navigation/BottomNavBar.kt
git commit -m "fix(dark-mode): onSurfaceVariant token + NewActionSheet contrast + BottomNavBar"
```

---

## Task B: Auth Flow Redesign

**Goal:** Premium entry experience — full-screen green hero login, large OTP boxes, animated approval timeline, new 3-page onboarding.

**Files:**
- Modify: `[painter]ui/auth/LoginScreen.kt`
- Modify: `[painter]ui/auth/AwaitingApprovalScreen.kt`
- Modify: `[painter]data/local/datastore/UserPreferences.kt`
- Modify: `[painter]navigation/Routes.kt`
- Modify: `[painter]navigation/AppNavigation.kt`
- Create: `[painter]ui/onboarding/OnboardingScreen.kt`

- [ ] **Step 1: Add `ONBOARDING_COMPLETE` to UserPreferences.kt**

Add after the `DARK_MODE` key declaration:
```kotlin
private val ONBOARDING_COMPLETE = booleanPreferencesKey("onboarding_complete")
```

Add the flow and setter:
```kotlin
val onboardingComplete: Flow<Boolean> = context.dataStore.data.map { it[ONBOARDING_COMPLETE] ?: false }

suspend fun setOnboardingComplete() {
    context.dataStore.edit { it[ONBOARDING_COMPLETE] = true }
}
```

- [ ] **Step 2: Add `Routes.Onboarding` to Routes.kt**

Add after `Routes.AwaitingApproval`:
```kotlin
data object Onboarding : Routes("onboarding")
```

- [ ] **Step 3: Create OnboardingScreen.kt**

Create `[painter]ui/onboarding/OnboardingScreen.kt`:

```kotlin
package com.qcpaintshop.painter.ui.onboarding

import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.AccountBalanceWallet
import androidx.compose.material.icons.rounded.Assignment
import androidx.compose.material.icons.rounded.Brush
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.qcpaintshop.painter.ui.theme.QCGreen
import com.qcpaintshop.painter.ui.theme.QCGreenDark
import com.qcpaintshop.painter.ui.theme.QCGreenDarkest
import com.qcpaintshop.painter.ui.theme.QCGold
import kotlinx.coroutines.launch

private data class OnboardingPage(
    val icon: ImageVector,
    val title: String,
    val subtitle: String,
    val gradientStart: Color,
    val gradientEnd: Color,
)

private val pages = listOf(
    OnboardingPage(Icons.Rounded.Brush, "Earn Points on Every Sale",
        "Get rewarded with loyalty points for every estimate you create and every sale that goes through.",
        QCGreen, QCGreenDark),
    OnboardingPage(Icons.Rounded.Assignment, "Track All Your Work",
        "View all your estimates, quotations, and customer jobs in one place. Always know your status.",
        QCGreenDark, QCGreenDarkest),
    OnboardingPage(Icons.Rounded.AccountBalanceWallet, "Get Paid Faster",
        "Withdraw your earned points, track attendance, and manage your painter profile — all from your phone.",
        QCGreenDarkest, Color(0xFF0A2E18)),
)

@Composable
fun OnboardingScreen(
    onComplete: () -> Unit,
    viewModel: OnboardingViewModel = hiltViewModel(),
) {
    val pagerState = rememberPagerState(pageCount = { pages.size })
    val scope = rememberCoroutineScope()

    Box(modifier = Modifier.fillMaxSize()) {
        HorizontalPager(state = pagerState, modifier = Modifier.fillMaxSize()) { page ->
            val p = pages[page]
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Brush.linearGradient(listOf(p.gradientStart, p.gradientEnd))),
                contentAlignment = Alignment.Center,
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                    modifier = Modifier.padding(horizontal = 32.dp),
                ) {
                    Surface(
                        shape = CircleShape,
                        color = Color.White.copy(alpha = 0.15f),
                        modifier = Modifier.size(120.dp),
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(p.icon, contentDescription = null, tint = Color.White, modifier = Modifier.size(60.dp))
                        }
                    }
                    Spacer(Modifier.height(40.dp))
                    Text(
                        p.title, color = Color.White, fontSize = 24.sp,
                        fontWeight = FontWeight.ExtraBold, textAlign = TextAlign.Center, lineHeight = 30.sp,
                    )
                    Spacer(Modifier.height(16.dp))
                    Text(
                        p.subtitle, color = Color.White.copy(alpha = 0.80f), fontSize = 15.sp,
                        textAlign = TextAlign.Center, lineHeight = 22.sp,
                    )
                }
            }
        }

        // Skip button
        TextButton(
            onClick = { scope.launch { viewModel.complete(); onComplete() } },
            modifier = Modifier.align(Alignment.TopEnd).padding(top = 48.dp, end = 16.dp),
        ) {
            Text("Skip", color = Color.White.copy(alpha = 0.8f), fontWeight = FontWeight.SemiBold)
        }

        // Bottom controls
        Column(
            modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 48.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // Page dots
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                repeat(pages.size) { index ->
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(4.dp))
                            .background(if (pagerState.currentPage == index) Color.White else Color.White.copy(alpha = 0.4f))
                            .width(if (pagerState.currentPage == index) 24.dp else 8.dp)
                            .height(8.dp)
                    )
                }
            }
            Spacer(Modifier.height(32.dp))
            Button(
                onClick = {
                    if (pagerState.currentPage < pages.size - 1) {
                        scope.launch { pagerState.animateScrollToPage(pagerState.currentPage + 1, animationSpec = tween(300)) }
                    } else {
                        scope.launch { viewModel.complete(); onComplete() }
                    }
                },
                colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = QCGreen),
                shape = RoundedCornerShape(14.dp),
                modifier = Modifier.fillMaxWidth(0.7f).height(52.dp),
            ) {
                Text(
                    if (pagerState.currentPage < pages.size - 1) "Next" else "Get Started",
                    fontWeight = FontWeight.Bold, fontSize = 16.sp,
                )
            }
        }
    }
}
```

- [ ] **Step 4: Create OnboardingViewModel.kt**

Create `[painter]ui/onboarding/OnboardingViewModel.kt`:

```kotlin
package com.qcpaintshop.painter.ui.onboarding

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.qcpaintshop.painter.data.local.datastore.UserPreferences
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class OnboardingViewModel @Inject constructor(
    private val prefs: UserPreferences,
) : ViewModel() {
    fun complete() {
        viewModelScope.launch { prefs.setOnboardingComplete() }
    }
}
```

- [ ] **Step 5: Wire Onboarding in AppNavigation.kt**

In `AppNavigation`, update the `startDestination` logic and add the composable route. Replace:
```kotlin
val startDestination = when (startupState) {
    is StartupState.LoggedIn -> Routes.Home.route
    is StartupState.PendingApproval -> Routes.AwaitingApproval.route
    else -> Routes.Login.route
}
```
with:
```kotlin
val onboardingComplete by mainViewModel.onboardingComplete.collectAsState(initial = true)
val startDestination = when (startupState) {
    is StartupState.LoggedIn -> if (onboardingComplete) Routes.Home.route else Routes.Onboarding.route
    is StartupState.PendingApproval -> Routes.AwaitingApproval.route
    else -> Routes.Login.route
}
```

Expose `onboardingComplete` in `MainViewModel`:
```kotlin
val onboardingComplete: StateFlow<Boolean> = prefs.onboardingComplete.stateIn(viewModelScope, SharingStarted.Eagerly, true)
```

Add the composable in `NavHost` (after the Register composable):
```kotlin
composable(Routes.Onboarding.route) {
    OnboardingScreen(
        onComplete = {
            navController.navigate(Routes.Home.route) {
                popUpTo(Routes.Onboarding.route) { inclusive = true }
            }
        }
    )
}
```

Add import: `import com.qcpaintshop.painter.ui.onboarding.OnboardingScreen`

- [ ] **Step 6: Redesign LoginScreen.kt**

Replace the full content of `[painter]ui/auth/LoginScreen.kt`:

```kotlin
package com.qcpaintshop.painter.ui.auth

import androidx.activity.compose.BackHandler
import androidx.compose.animation.*
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.Brush
import androidx.compose.material.icons.rounded.Phone
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.autofill.AutofillType
import androidx.compose.ui.focus.*
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.qcpaintshop.painter.ui.theme.*

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LoginScreen(
    onLoginSuccess: () -> Unit,
    onRegister: (String?) -> Unit,
    onNavigateToAwaitingApproval: () -> Unit,
    viewModel: LoginViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val keyboard = LocalSoftwareKeyboardController.current
    var phone by remember { mutableStateOf("") }
    var otp by remember { mutableStateOf("") }
    val step = if (uiState.otpSent) 2 else 1

    BackHandler(enabled = step == 2) {
        otp = ""
        viewModel.resetState()
    }

    LaunchedEffect(uiState.loginSuccess) {
        if (uiState.loginSuccess == true) onLoginSuccess()
    }
    LaunchedEffect(uiState.pendingApproval) {
        if (uiState.pendingApproval == true) onNavigateToAwaitingApproval()
    }

    Column(modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)) {
        // ── Hero top half ───────────────────────────────────────────────────
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .weight(0.42f)
                .background(Brush.linearGradient(listOf(QCGreen, QCGreenDarkest))),
            contentAlignment = Alignment.Center,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Surface(shape = CircleShape, color = Color.White.copy(alpha = 0.15f), modifier = Modifier.size(88.dp)) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(Icons.Rounded.Brush, contentDescription = null, tint = Color.White, modifier = Modifier.size(44.dp))
                    }
                }
                Spacer(Modifier.height(16.dp))
                Text("Quality Colours", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
                Text("Painter Partner App", color = Color.White.copy(alpha = 0.75f), fontSize = 14.sp)
            }
        }

        // ── Bottom card ─────────────────────────────────────────────────────
        Surface(
            modifier = Modifier.fillMaxWidth().weight(0.58f),
            shape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp),
            color = MaterialTheme.colorScheme.surface,
        ) {
            Column(modifier = Modifier.padding(horizontal = 24.dp, vertical = 32.dp)) {
                AnimatedContent(targetState = step, label = "loginStep",
                    transitionSpec = { slideInHorizontally { it } togetherWith slideOutHorizontally { -it } }
                ) { currentStep ->
                    when (currentStep) {
                        1 -> PhoneStep(
                            phone = phone,
                            onPhoneChange = { phone = it },
                            isLoading = uiState.isLoading,
                            error = uiState.error,
                            onSend = { keyboard?.hide(); viewModel.sendOtp(phone) },
                            onRegister = { onRegister(phone.ifBlank { null }) },
                        )
                        else -> OtpStep(
                            phone = phone,
                            otp = otp,
                            onOtpChange = { otp = it; if (it.length == 6) { keyboard?.hide(); viewModel.verifyOtp(phone, it) } },
                            isLoading = uiState.isLoading,
                            error = uiState.error,
                            onVerify = { keyboard?.hide(); viewModel.verifyOtp(phone, otp) },
                            onResend = { viewModel.sendOtp(phone) },
                            onBack = { otp = ""; viewModel.resetState() },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun PhoneStep(
    phone: String, onPhoneChange: (String) -> Unit,
    isLoading: Boolean, error: String?,
    onSend: () -> Unit, onRegister: () -> Unit,
) {
    Column {
        Text("Enter your phone number", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
        Text("We'll send an OTP to verify", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp, bottom = 24.dp))
        OutlinedTextField(
            value = phone, onValueChange = { if (it.all { c -> c.isDigit() } && it.length <= 10) onPhoneChange(it) },
            label = { Text("Mobile Number") },
            leadingIcon = { Icon(Icons.Rounded.Phone, contentDescription = null) },
            prefix = { Text("+91 ") },
            modifier = Modifier.fillMaxWidth(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { onSend() }),
            isError = error != null,
            singleLine = true,
            shape = RoundedCornerShape(14.dp),
        )
        if (error != null) {
            Text(error, color = MaterialTheme.colorScheme.error, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp, start = 4.dp))
        }
        Spacer(Modifier.height(24.dp))
        Button(
            onClick = onSend, modifier = Modifier.fillMaxWidth().height(52.dp),
            enabled = phone.length == 10 && !isLoading,
            shape = RoundedCornerShape(14.dp),
            colors = ButtonDefaults.buttonColors(containerColor = QCGreen),
        ) {
            if (isLoading) CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
            else Text("Send OTP", fontWeight = FontWeight.Bold, fontSize = 16.sp)
        }
        Spacer(Modifier.height(16.dp))
        TextButton(onClick = onRegister, modifier = Modifier.fillMaxWidth()) {
            Text("New painter? Register here", color = QCGreen)
        }
    }
}

@Composable
private fun OtpStep(
    phone: String, otp: String, onOtpChange: (String) -> Unit,
    isLoading: Boolean, error: String?,
    onVerify: () -> Unit, onResend: () -> Unit, onBack: () -> Unit,
) {
    Column {
        Text("Verify OTP", fontSize = 20.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
        Text("Sent to +91 $phone", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 4.dp, bottom = 24.dp))
        // OTP input as a single field (6 digits)
        OutlinedTextField(
            value = otp, onValueChange = { if (it.all { c -> c.isDigit() } && it.length <= 6) onOtpChange(it) },
            label = { Text("6-digit OTP") },
            modifier = Modifier.fillMaxWidth(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword, imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { onVerify() }),
            isError = error != null,
            singleLine = true,
            shape = RoundedCornerShape(14.dp),
            textStyle = LocalTextStyle.current.copy(fontSize = 24.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center, letterSpacing = 8.sp),
        )
        if (error != null) {
            Text(error, color = MaterialTheme.colorScheme.error, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp, start = 4.dp))
        }
        Spacer(Modifier.height(24.dp))
        Button(
            onClick = onVerify, modifier = Modifier.fillMaxWidth().height(52.dp),
            enabled = otp.length == 6 && !isLoading,
            shape = RoundedCornerShape(14.dp),
            colors = ButtonDefaults.buttonColors(containerColor = QCGreen),
        ) {
            if (isLoading) CircularProgressIndicator(color = Color.White, strokeWidth = 2.dp, modifier = Modifier.size(22.dp))
            else Text("Verify & Login", fontWeight = FontWeight.Bold, fontSize = 16.sp)
        }
        Spacer(Modifier.height(12.dp))
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            TextButton(onClick = onBack) { Text("← Change number", color = MaterialTheme.colorScheme.onSurfaceVariant) }
            TextButton(onClick = onResend) { Text("Resend OTP", color = QCGreen) }
        }
    }
}
```

- [ ] **Step 7: Redesign AwaitingApprovalScreen.kt**

Replace the full content of `[painter]ui/auth/AwaitingApprovalScreen.kt`:

```kotlin
package com.qcpaintshop.painter.ui.auth

import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.CheckCircle
import androidx.compose.material.icons.rounded.HourglassTop
import androidx.compose.material.icons.rounded.RadioButtonUnchecked
import androidx.compose.material3.*
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.qcpaintshop.painter.ui.theme.*
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AwaitingApprovalScreen(
    onLogout: () -> Unit,
    onApproved: () -> Unit,
    viewModel: AwaitingApprovalViewModel = hiltViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val scope = rememberCoroutineScope()
    var isRefreshing by remember { mutableStateOf(false) }

    LaunchedEffect(uiState.isApproved) { if (uiState.isApproved) onApproved() }

    // Pulsing animation
    val infiniteTransition = rememberInfiniteTransition(label = "pulse")
    val pulseScale by infiniteTransition.animateFloat(
        initialValue = 1f, targetValue = 1.18f, label = "pulseScale",
        animationSpec = infiniteRepeatable(tween(1000, easing = FastOutSlowInEasing), RepeatMode.Reverse),
    )

    PullToRefreshBox(
        isRefreshing = isRefreshing,
        onRefresh = {
            isRefreshing = true
            scope.launch { viewModel.recheckApprovalStatus(); isRefreshing = false }
        },
    ) {
        Column(
            modifier = Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(60.dp))

            // Pulsing status badge
            Box(contentAlignment = Alignment.Center, modifier = Modifier.size(120.dp)) {
                Box(
                    modifier = Modifier.size(120.dp).scale(pulseScale)
                        .background(QCGreen.copy(alpha = 0.12f), CircleShape)
                )
                Box(
                    modifier = Modifier.size(88.dp)
                        .background(QCGreen.copy(alpha = 0.18f), CircleShape)
                )
                Surface(shape = CircleShape, color = QCGreen, modifier = Modifier.size(64.dp)) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(Icons.Rounded.HourglassTop, contentDescription = null, tint = Color.White, modifier = Modifier.size(32.dp))
                    }
                }
            }

            Spacer(Modifier.height(28.dp))
            Text("Application Under Review", fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, color = MaterialTheme.colorScheme.onSurface, textAlign = TextAlign.Center)
            Spacer(Modifier.height(8.dp))
            Text("Our team is reviewing your painter profile. You'll get notified once approved.", fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center, lineHeight = 20.sp)

            Spacer(Modifier.height(40.dp))

            // Timeline card
            Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.surface, shadowElevation = 2.dp, modifier = Modifier.fillMaxWidth()) {
                Column(modifier = Modifier.padding(20.dp)) {
                    TimelineStep(icon = Icons.Rounded.CheckCircle, label = "Registered", sublabel = "Your account is created", isDone = true)
                    TimelineConnector()
                    TimelineStep(icon = Icons.Rounded.HourglassTop, label = "Under Review", sublabel = "Admin is verifying your profile", isCurrent = true)
                    TimelineConnector()
                    TimelineStep(icon = Icons.Rounded.RadioButtonUnchecked, label = "Approved", sublabel = "Full access unlocked", isPending = true)
                }
            }

            Spacer(Modifier.weight(1f))
            Text("Pull down to check status", fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(16.dp))
            OutlinedButton(onClick = onLogout, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(12.dp)) {
                Text("Logout", color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun TimelineStep(icon: ImageVector, label: String, sublabel: String, isDone: Boolean = false, isCurrent: Boolean = false, isPending: Boolean = false) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 4.dp)) {
        Surface(shape = CircleShape,
            color = when { isDone -> QCGreen; isCurrent -> QCGold; else -> MaterialTheme.colorScheme.surfaceVariant },
            modifier = Modifier.size(40.dp),
        ) {
            Box(contentAlignment = Alignment.Center) {
                Icon(icon, contentDescription = null,
                    tint = when { isDone || isCurrent -> Color.White; else -> MaterialTheme.colorScheme.onSurfaceVariant },
                    modifier = Modifier.size(20.dp),
                )
            }
        }
        Spacer(Modifier.width(14.dp))
        Column {
            Text(label, fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
                color = if (isPending) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface)
            Text(sublabel, fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun TimelineConnector() {
    Row {
        Spacer(Modifier.width(19.dp))
        Box(Modifier.width(2.dp).height(16.dp).background(MaterialTheme.colorScheme.outline.copy(alpha = 0.4f)))
    }
}
```

- [ ] **Step 8: Compile verify**

```bash
./gradlew :app:compileDebugKotlinPainter --no-daemon -Dkotlin.daemon.jvm.options="-Xmx3072m" 2>&1 | tail -15
```

Expected: `BUILD SUCCESSFUL`

- [ ] **Step 9: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/ui/auth/
git add app/src/painter/java/com/qcpaintshop/painter/ui/onboarding/
git add app/src/painter/java/com/qcpaintshop/painter/navigation/Routes.kt
git add app/src/painter/java/com/qcpaintshop/painter/navigation/AppNavigation.kt
git add app/src/painter/java/com/qcpaintshop/painter/data/local/datastore/UserPreferences.kt
git commit -m "feat(auth): redesign login/awaiting screens + 3-page onboarding flow"
```

---

## Task C: Home Screen Redesign

**Goal:** Core identity screen — premium hero card with painter name+level+gold points, bold 56dp quick action tiles, and an improved StreakSheet with calendar dots + fire animation.

**Files:**
- Modify: `[painter]ui/home/HomeScreen.kt`
- Modify: `[painter]ui/home/components/QuickActionsRow.kt`
- Modify: `[painter]ui/home/components/StreakSheet.kt`

- [ ] **Step 1: Redesign HeroCard section in HomeScreen.kt**

In `HomeScreen.kt`, find the `HeroCard` composable (or the inline hero section) and replace it with:

```kotlin
@Composable
private fun HeroCard(
    name: String?,
    level: String?,
    branch: String?,
    points: Int,
    greeting: String,
) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .background(
                brush = Brush.linearGradient(listOf(QCGreen, QCGreenDarkest)),
                shape = RoundedCornerShape(bottomStart = 24.dp, bottomEnd = 24.dp),
            )
            .padding(horizontal = 20.dp, vertical = 20.dp),
    ) {
        Column {
            Text(greeting, color = Color.White.copy(alpha = 0.80f), fontSize = 13.sp)
            Text(name ?: "Painter", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.padding(top = 2.dp))
            Spacer(Modifier.height(8.dp))
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                if (!level.isNullOrBlank()) {
                    Surface(shape = RoundedCornerShape(20.dp), color = Color.White.copy(alpha = 0.20f)) {
                        Text(level.replaceFirstChar { it.uppercase() }, color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
                    }
                }
                if (!branch.isNullOrBlank()) {
                    Text("· $branch", color = Color.White.copy(alpha = 0.70f), fontSize = 12.sp)
                }
            }
            Spacer(Modifier.height(14.dp))
            HorizontalDivider(color = Color.White.copy(alpha = 0.20f))
            Spacer(Modifier.height(14.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("★", color = QCGold, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.width(6.dp))
                Text("$points pts", color = QCGold, fontSize = 18.sp, fontWeight = FontWeight.Bold)
                Spacer(Modifier.width(4.dp))
                Text("available", color = Color.White.copy(alpha = 0.65f), fontSize = 12.sp)
            }
        }
    }
}
```

Also update section headers throughout HomeScreen.kt to follow this pattern:
```kotlin
// Section header pattern (replace any inline section title Rows)
Row(
    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
    horizontalArrangement = Arrangement.SpaceBetween,
    verticalAlignment = Alignment.CenterVertically,
) {
    Text(title, fontSize = 15.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
    TextButton(onClick = onSeeAll) { Text("See all", color = QCGreen, fontSize = 12.sp) }
}
```

Replace all hardcoded `.background(QCBackground)` with `.background(MaterialTheme.colorScheme.background)` in HomeScreen.kt.

- [ ] **Step 2: Redesign QuickActionsRow.kt**

Replace the full content of `[painter]ui/home/components/QuickActionsRow.kt`:

```kotlin
package com.qcpaintshop.painter.ui.home.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.qcpaintshop.painter.ui.theme.QCGreen

private data class QuickAction(val icon: ImageVector, val label: String, val route: String)

private val actions = listOf(
    QuickAction(Icons.Rounded.Description, "Estimate", "estimate/create"),
    QuickAction(Icons.Rounded.Palette, "Catalog", "catalog"),
    QuickAction(Icons.Rounded.CameraAlt, "Check-in", "checkin"),
    QuickAction(Icons.Rounded.Person, "Profile", "profile"),
)

@Composable
fun QuickActionsRow(onNavigate: (String) -> Unit) {
    val haptic = LocalHapticFeedback.current
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceAround,
    ) {
        actions.forEach { action ->
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier
                    .clip(RoundedCornerShape(12.dp))
                    .clickable {
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        onNavigate(action.route)
                    }
                    .padding(8.dp),
            ) {
                Surface(shape = CircleShape, color = QCGreen, modifier = Modifier.size(56.dp)) {
                    Box(contentAlignment = Alignment.Center) {
                        Icon(action.icon, contentDescription = action.label, tint = Color.White, modifier = Modifier.size(26.dp))
                    }
                }
                Spacer(Modifier.height(6.dp))
                Text(action.label, fontSize = 11.sp, fontWeight = FontWeight.Medium,
                    color = MaterialTheme.colorScheme.onSurface, textAlign = TextAlign.Center)
            }
        }
    }
}
```

- [ ] **Step 3: Redesign StreakSheet.kt**

Replace the full content of `[painter]ui/home/components/StreakSheet.kt`:

```kotlin
package com.qcpaintshop.painter.ui.home.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.LocalFireDepartment
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.qcpaintshop.painter.ui.theme.QCGold
import com.qcpaintshop.painter.ui.theme.QCGreen
import java.time.LocalDate
import java.time.YearMonth

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun StreakSheet(
    checkinDays: Set<Int>,
    currentStreak: Int,
    onDismiss: () -> Unit,
) {
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = MaterialTheme.colorScheme.surface,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // Streak display
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
                Icon(Icons.Rounded.LocalFireDepartment, contentDescription = null, tint = QCGold, modifier = Modifier.size(36.dp))
                Spacer(Modifier.width(8.dp))
                Text("$currentStreak", fontSize = 40.sp, fontWeight = FontWeight.ExtraBold, color = MaterialTheme.colorScheme.onSurface)
                Spacer(Modifier.width(8.dp))
                Column {
                    Text("day", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Text("streak", fontSize = 13.sp, color = QCGold, fontWeight = FontWeight.Bold)
                }
            }

            Text(
                text = when {
                    currentStreak == 0 -> "Start your streak today!"
                    currentStreak < 7  -> "Keep it going! 🎯"
                    currentStreak < 30 -> "On fire! Don't break it! 🔥"
                    else               -> "Legendary streak! ⭐"
                },
                fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center, modifier = Modifier.padding(vertical = 12.dp),
            )

            HorizontalDivider(color = MaterialTheme.colorScheme.outline.copy(alpha = 0.3f))
            Spacer(Modifier.height(16.dp))

            // Day-of-week header
            val dayLabels = listOf("Su", "Mo", "Tu", "We", "Th", "Fr", "Sa")
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceAround) {
                dayLabels.forEach { d ->
                    Text(d, fontSize = 11.sp, fontWeight = FontWeight.Bold,
                        color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center, modifier = Modifier.weight(1f))
                }
            }
            Spacer(Modifier.height(8.dp))

            // Calendar grid — current month
            val today = LocalDate.now()
            val yearMonth = YearMonth.of(today.year, today.monthValue)
            val firstDayOfWeek = yearMonth.atDay(1).dayOfWeek.value % 7
            val daysInMonth = yearMonth.lengthOfMonth()

            var dayCounter = 1
            var col = firstDayOfWeek
            while (dayCounter <= daysInMonth) {
                Row(modifier = Modifier.fillMaxWidth().padding(vertical = 3.dp), horizontalArrangement = Arrangement.SpaceAround) {
                    for (c in 0..6) {
                        if ((dayCounter == 1 && c < col) || dayCounter > daysInMonth) {
                            Spacer(Modifier.weight(1f))
                        } else {
                            val day = dayCounter
                            val isCheckedIn = day in checkinDays
                            val isFuture = day > today.dayOfMonth
                            val isToday = day == today.dayOfMonth
                            Box(
                                modifier = Modifier.weight(1f).aspectRatio(1f),
                                contentAlignment = Alignment.Center,
                            ) {
                                Box(
                                    modifier = Modifier.size(32.dp).background(
                                        color = when {
                                            isCheckedIn -> QCGreen.copy(alpha = 0.15f)
                                            isToday && !isFuture -> QCGold.copy(alpha = 0.15f)
                                            else -> Color.Transparent
                                        },
                                        shape = CircleShape,
                                    ),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Text(
                                        "$day",
                                        fontSize = 12.sp,
                                        fontWeight = if (isToday) FontWeight.ExtraBold else FontWeight.Normal,
                                        color = when {
                                            isCheckedIn -> QCGreen
                                            isToday -> QCGold
                                            isFuture -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)
                                            else -> MaterialTheme.colorScheme.onSurfaceVariant
                                        },
                                    )
                                }
                                if (isCheckedIn) {
                                    Box(
                                        modifier = Modifier.align(Alignment.BottomCenter).offset(y = 2.dp)
                                            .size(5.dp).background(QCGreen, CircleShape)
                                    )
                                }
                            }
                            dayCounter++
                        }
                        if (dayCounter == 1 && c >= col) col = 0
                    }
                }
                if (dayCounter == 1) dayCounter++
            }
        }
    }
}
```

- [ ] **Step 4: Compile verify**

```bash
./gradlew :app:compileDebugKotlinPainter --no-daemon -Dkotlin.daemon.jvm.options="-Xmx3072m" 2>&1 | tail -15
```

Expected: `BUILD SUCCESSFUL`

- [ ] **Step 5: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/ui/home/
git commit -m "feat(home): redesign hero card, quick actions 56dp, streak calendar sheet"
```

---

## Task D: Catalog + ProductDetailSheet Redesign

**Goal:** Paint-chip style product cards, solid filter chips, full dark-mode fix in ProductDetailSheet with alternating price table rows and gold points row.

**Files:**
- Modify: `[painter]ui/catalog/CatalogScreen.kt`
- Modify: `[painter]ui/catalog/ProductDetailSheet.kt`

- [ ] **Step 1: Migrate hardcoded colors in CatalogScreen.kt**

In `CatalogScreen.kt`, apply the color migration table from the reference section at the top of this plan. Specifically:
- Replace `QCBackground` → `MaterialTheme.colorScheme.background` in Column/Box backgrounds
- Replace `QCSurface` → `MaterialTheme.colorScheme.surface` in card colors
- Replace `QCTextSecondary`/`QCTextTertiary` → `MaterialTheme.colorScheme.onSurfaceVariant`
- Replace `QCBorderLight` → `MaterialTheme.colorScheme.outline`

For the filter chips, update the selected/unselected chip design to use solid styling:
```kotlin
// Selected chip
FilterChip(
    selected = isSelected,
    onClick = { /* toggle */ },
    label = { Text(label, fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal) },
    colors = FilterChipDefaults.filterChipColors(
        selectedContainerColor = QCGreen,
        selectedLabelColor = Color.White,
        containerColor = MaterialTheme.colorScheme.surface,
        labelColor = QCGreen,
    ),
    border = FilterChipDefaults.filterChipBorder(
        enabled = true, selected = isSelected,
        selectedBorderColor = QCGreen,
        borderColor = QCGreen.copy(alpha = 0.5f),
        selectedBorderWidth = 0.dp,
        borderWidth = 1.dp,
    ),
    shape = RoundedCornerShape(20.dp),
)
```

- [ ] **Step 2: Fix dark mode in ProductDetailSheet.kt**

In `ProductDetailSheet.kt`, apply these targeted changes:

**a) Replace all hardcoded `QCGreen` text colors in the sheet content:**
```kotlin
// OLD (any Text with color = QCGreen that is NOT a price/brand-CTA)
color = QCGreen

// NEW — use semantic color
color = MaterialTheme.colorScheme.onSurface      // for primary text
color = MaterialTheme.colorScheme.onSurfaceVariant // for secondary text
```

**b) Fix the price table rows — replace the existing price table with:**
```kotlin
@Composable
private fun PriceTableRow(size: String, rate: String, regularPts: String, annualPts: String, isAlternate: Boolean) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(if (isAlternate) MaterialTheme.colorScheme.surfaceVariant else Color.Transparent)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(size, modifier = Modifier.weight(1.5f), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurface)
        Text(rate, modifier = Modifier.weight(1.5f), fontSize = 13.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
        Text(regularPts, modifier = Modifier.weight(1f), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.End)
        Text(annualPts, modifier = Modifier.weight(1f), fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.End)
    }
}

@Composable
private fun PriceTableHeader() {
    Row(
        modifier = Modifier.fillMaxWidth()
            .background(QCGreen, RoundedCornerShape(topStart = 10.dp, topEnd = 10.dp))
            .padding(horizontal = 16.dp, vertical = 8.dp),
    ) {
        Text("Size",    modifier = Modifier.weight(1.5f), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Color.White)
        Text("Rate",    modifier = Modifier.weight(1.5f), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Color.White)
        Text("Regular", modifier = Modifier.weight(1f),   fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Color.White, textAlign = TextAlign.End)
        Text("Annual",  modifier = Modifier.weight(1f),   fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Color.White, textAlign = TextAlign.End)
    }
}
```

**c) Add a gold points highlight row above the table:**
```kotlin
// Show total points for the most common size (e.g. 20L)
Row(
    modifier = Modifier.fillMaxWidth()
        .background(QCGold.copy(alpha = 0.12f), RoundedCornerShape(10.dp))
        .padding(horizontal = 16.dp, vertical = 10.dp),
    verticalAlignment = Alignment.CenterVertically,
) {
    Text("★", fontSize = 16.sp, color = QCGold, fontWeight = FontWeight.Bold)
    Spacer(Modifier.width(8.dp))
    Text("Earn up to ", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurface)
    Text(
        "${maxPoints} pts",
        fontSize = 14.sp, fontWeight = FontWeight.ExtraBold, color = QCGold,
    )
    Text(" on this product", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurface)
}
```

**d) Fix "In Stock" chip and brand tag — use `MaterialTheme.colorScheme.*` for chip backgrounds**

- [ ] **Step 3: Compile verify**

```bash
./gradlew :app:compileDebugKotlinPainter --no-daemon -Dkotlin.daemon.jvm.options="-Xmx3072m" 2>&1 | tail -15
```

Expected: `BUILD SUCCESSFUL`

- [ ] **Step 4: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/ui/catalog/
git commit -m "feat(catalog): paint-chip cards, solid filter chips, ProductDetailSheet dark mode fix"
```

---

## Task E: Work + Estimates Redesign

**Goal:** Status-color-coded estimate cards, empty state with illustration, EstimateCreateScreen color migration.

**Files:**
- Modify: `[painter]ui/work/WorkScreen.kt`
- Modify: `[painter]ui/work/estimates/EstimateCreateScreen.kt`

- [ ] **Step 1: Migrate WorkScreen.kt hardcoded colors**

In `WorkScreen.kt`, apply the color migration table:
- Replace `QCBackground` → `MaterialTheme.colorScheme.background`
- Replace `QCSurface` in `CardDefaults.cardColors(containerColor = QCSurface)` → remove `containerColor` arg (default is `MaterialTheme.colorScheme.surface`)
- Replace `QCTextSecondary`, `QCTextTertiary` → `MaterialTheme.colorScheme.onSurfaceVariant`
- Replace `QCBorderLight` in `statusBorderColor` default case → `MaterialTheme.colorScheme.outline`
- In `StatusBadge`: Replace `QCTextTertiary.copy(alpha=0.15f) to QCTextSecondary` with `MaterialTheme.colorScheme.surfaceVariant to MaterialTheme.colorScheme.onSurfaceVariant`

- [ ] **Step 2: Add visible empty state to EstimatesList and QuotationsList**

Replace the `EmptyWorkState` composable:
```kotlin
@Composable
private fun EmptyWorkState(
    icon: ImageVector,
    title: String,
    description: String,
    action: String,
    onCreate: () -> Unit,
) {
    Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(32.dp),
        ) {
            Surface(shape = CircleShape, color = QCGreen.copy(alpha = 0.10f), modifier = Modifier.size(96.dp)) {
                Box(contentAlignment = Alignment.Center) {
                    Icon(icon, contentDescription = null, tint = QCGreen, modifier = Modifier.size(44.dp))
                }
            }
            Spacer(Modifier.height(20.dp))
            Text(title, fontSize = 18.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface, textAlign = TextAlign.Center)
            Spacer(Modifier.height(8.dp))
            Text(description, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center, lineHeight = 20.sp)
            Spacer(Modifier.height(24.dp))
            Button(
                onClick = onCreate,
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(containerColor = QCGreen),
            ) {
                Text(action, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}
```

- [ ] **Step 3: Migrate EstimateCreateScreen.kt hardcoded colors**

In `EstimateCreateScreen.kt`, apply the color migration table for all background, surface, text, and border colors. Also verify:
- Search field background uses `MaterialTheme.colorScheme.surface` or `surfaceVariant`
- Product row card colors use `MaterialTheme.colorScheme.surface`
- Text colors use `onSurface` / `onSurfaceVariant`

- [ ] **Step 4: Compile verify**

```bash
./gradlew :app:compileDebugKotlinPainter --no-daemon -Dkotlin.daemon.jvm.options="-Xmx3072m" 2>&1 | tail -15
```

Expected: `BUILD SUCCESSFUL`

- [ ] **Step 5: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/ui/work/
git commit -m "feat(work): color migration, status chips, illustrated empty states"
```

---

## Task F: Attendance Redesign

**Goal:** Hero circular check-in button (120dp), fire+gold streak display, camera capture ring, Tamil month headers with attendance %.

**Files:**
- Modify: `[painter]ui/attendance/CheckInScreen.kt`
- Modify: `[painter]ui/attendance/AttendanceHistoryScreen.kt`

- [ ] **Step 1: Redesign CheckInScreen.kt**

In `CheckInScreen.kt`, replace the capture button and camera overlay with:

```kotlin
// Replace existing capture button Box with:
Box(
    modifier = Modifier
        .size(80.dp)
        .clip(CircleShape)
        .border(4.dp, Color.White.copy(alpha = 0.8f), CircleShape)
        .clickable { capturePhoto() },
    contentAlignment = Alignment.Center,
) {
    Box(
        modifier = Modifier.size(64.dp)
            .background(QCGreen, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Icon(Icons.Rounded.CameraAlt, contentDescription = "Capture", tint = Color.White, modifier = Modifier.size(28.dp))
    }
}

// Location chip overlay (show over camera preview, bottom)
Surface(
    shape = RoundedCornerShape(20.dp),
    color = Color.Black.copy(alpha = 0.65f),
    modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 100.dp),
) {
    Row(
        modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Icon(Icons.Rounded.LocationOn, contentDescription = null, tint = Color.White, modifier = Modifier.size(14.dp))
        Text(locationText ?: "Getting location...", color = Color.White, fontSize = 12.sp)
    }
}
```

Also add success animation overlay when `state.success == true`:
```kotlin
AnimatedVisibility(visible = showSuccess, enter = fadeIn(), exit = fadeOut()) {
    Box(
        modifier = Modifier.fillMaxSize().background(QCGreen.copy(alpha = 0.85f)),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(Icons.Rounded.CheckCircle, contentDescription = null, tint = Color.White, modifier = Modifier.size(80.dp))
            Spacer(Modifier.height(16.dp))
            Text("Checked In!", color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.ExtraBold)
        }
    }
}
```

- [ ] **Step 2: Redesign AttendanceHistoryScreen.kt**

In `AttendanceHistoryScreen.kt`, update the month header to show Tamil month + attendance %:
```kotlin
@Composable
private fun MonthHeader(monthLabel: String, checkedCount: Int, totalDays: Int) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(monthLabel, fontSize = 14.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
        val pct = if (totalDays > 0) (checkedCount * 100 / totalDays) else 0
        Surface(shape = RoundedCornerShape(20.dp),
            color = if (pct >= 80) QCGreen.copy(alpha = 0.12f) else MaterialTheme.colorScheme.surfaceVariant) {
            Text(
                "$checkedCount/$totalDays days · $pct%",
                modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
                color = if (pct >= 80) QCGreen else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
```

Also migrate hardcoded background/text colors to `MaterialTheme.colorScheme.*`.

- [ ] **Step 3: Compile verify**

```bash
./gradlew :app:compileDebugKotlinPainter --no-daemon -Dkotlin.daemon.jvm.options="-Xmx3072m" 2>&1 | tail -15
```

Expected: `BUILD SUCCESSFUL`

- [ ] **Step 4: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/ui/attendance/
git commit -m "feat(attendance): capture ring, location overlay, success animation, Tamil month headers"
```

---

## Task G: Profile + Settings + Achievements

**Goal:** Full-bleed profile header with tier gradient badge and stats, grouped settings with 3-way mode toggle, earned/locked badge visual distinction.

**Files:**
- Modify: `[painter]ui/profile/ProfileScreen.kt`
- Modify: `[painter]ui/profile/EditProfileScreen.kt`
- Modify: `[painter]ui/profile/SettingsScreen.kt`
- Modify: `[painter]ui/profile/SettingsViewModel.kt`
- Modify: `[painter]ui/profile/AchievementsScreen.kt`

- [ ] **Step 1: Add `clearDarkMode()` to UserPreferences.kt**

In `[painter]data/local/datastore/UserPreferences.kt`, add:
```kotlin
suspend fun clearDarkMode() {
    context.dataStore.edit { it.remove(DARK_MODE) }
}
```

- [ ] **Step 2: Update SettingsViewModel.kt for 3-way mode**

In `SettingsViewModel.kt`, replace the dark-mode toggle logic:

```kotlin
// Replace setDarkMode(Boolean) usage with 3-way setter:
enum class DarkModeOption { LIGHT, AUTO, DARK }

fun setDarkModeOption(option: DarkModeOption) {
    viewModelScope.launch {
        when (option) {
            DarkModeOption.LIGHT -> prefs.setDarkMode(false)
            DarkModeOption.DARK  -> prefs.setDarkMode(true)
            DarkModeOption.AUTO  -> prefs.clearDarkMode()
        }
    }
}

// Expose current option as state:
val darkModeOption: StateFlow<DarkModeOption> = prefs.darkMode.map { pref ->
    when (pref) {
        true  -> DarkModeOption.DARK
        false -> DarkModeOption.LIGHT
        null  -> DarkModeOption.AUTO
    }
}.stateIn(viewModelScope, SharingStarted.Eagerly, DarkModeOption.AUTO)
```

- [ ] **Step 3: Update the dark mode UI in SettingsScreen.kt**

Replace the existing Switch-based dark mode row with a 3-way `SegmentedButton`:

```kotlin
@Composable
private fun DarkModeSegmentedControl(
    current: DarkModeOption,
    onSelect: (DarkModeOption) -> Unit,
) {
    val options = listOf(DarkModeOption.LIGHT to "Light", DarkModeOption.AUTO to "Auto", DarkModeOption.DARK to "Dark")
    SingleChoiceSegmentedButtonRow(modifier = Modifier.fillMaxWidth()) {
        options.forEachIndexed { index, (option, label) ->
            SegmentedButton(
                selected = current == option,
                onClick = { onSelect(option) },
                shape = SegmentedButtonDefaults.itemShape(index = index, count = options.size),
            ) {
                Text(label, fontSize = 13.sp)
            }
        }
    }
}
```

In the settings list, replace the dark mode switch row with:
```kotlin
SettingsGroupCard(title = "Appearance") {
    Column(modifier = Modifier.padding(16.dp)) {
        Text("Display Mode", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = MaterialTheme.colorScheme.onSurface)
        Spacer(Modifier.height(10.dp))
        DarkModeSegmentedControl(current = uiState.darkModeOption, onSelect = { viewModel.setDarkModeOption(it) })
    }
}
```

Also wrap each settings section in a grouped card:
```kotlin
@Composable
private fun SettingsGroupCard(title: String, content: @Composable () -> Unit) {
    Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)) {
        Text(title, fontSize = 11.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant,
            letterSpacing = 0.08.sp, modifier = Modifier.padding(start = 4.dp, bottom = 4.dp))
        Surface(shape = RoundedCornerShape(14.dp), color = MaterialTheme.colorScheme.surface, shadowElevation = 1.dp) {
            content()
        }
    }
}
```

- [ ] **Step 4: Redesign ProfileScreen.kt header**

In `ProfileScreen.kt`, replace the existing header card with:

```kotlin
@Composable
private fun ProfileHeader(
    name: String?, level: String?, branch: String?,
    photoUrl: String?, estimateCount: Int, pointsTotal: Int, streak: Int,
    onPhotoClick: () -> Unit,
) {
    val tierBorderColor = when (level?.lowercase()) {
        "bronze"   -> LevelBronze
        "silver"   -> LevelSilver
        "gold"     -> LevelGold
        "diamond"  -> LevelDiamond
        else       -> QCGreen
    }
    Box(
        modifier = Modifier.fillMaxWidth()
            .background(Brush.linearGradient(listOf(QCGreen, QCGreenDarkest))),
    ) {
        Column(modifier = Modifier.padding(20.dp).statusBarsPadding()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                // Photo
                Box(modifier = Modifier.size(72.dp).border(3.dp, tierBorderColor, CircleShape).padding(3.dp)) {
                    AsyncImage(
                        model = photoUrl,
                        contentDescription = "Photo",
                        modifier = Modifier.fillMaxSize().clip(CircleShape).clickable { onPhotoClick() },
                        contentScale = ContentScale.Crop,
                    )
                }
                Spacer(Modifier.width(16.dp))
                // Name + level
                Column {
                    Text(name ?: "Painter", color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.ExtraBold)
                    Spacer(Modifier.height(4.dp))
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        Surface(shape = RoundedCornerShape(20.dp),
                            color = tierBorderColor.copy(alpha = 0.30f), modifier = Modifier.border(1.dp, tierBorderColor, RoundedCornerShape(20.dp))) {
                            Text(level?.replaceFirstChar { it.uppercase() } ?: "Painter",
                                color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold,
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 3.dp))
                        }
                        if (!branch.isNullOrBlank()) {
                            Text("· $branch", color = Color.White.copy(alpha = 0.70f), fontSize = 12.sp)
                        }
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
            HorizontalDivider(color = Color.White.copy(alpha = 0.20f))
            Spacer(Modifier.height(14.dp))
            // Stats row
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceAround) {
                ProfileStat("$estimateCount", "Estimates")
                VerticalDivider(modifier = Modifier.height(32.dp), color = Color.White.copy(alpha = 0.20f))
                ProfileStat("$pointsTotal pts", "Earnings", isGold = true)
                VerticalDivider(modifier = Modifier.height(32.dp), color = Color.White.copy(alpha = 0.20f))
                ProfileStat("$streak", "Day Streak")
            }
        }
    }
}

@Composable
private fun ProfileStat(value: String, label: String, isGold: Boolean = false) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, color = if (isGold) QCGold else Color.White, fontSize = 16.sp, fontWeight = FontWeight.ExtraBold)
        Text(label, color = Color.White.copy(alpha = 0.70f), fontSize = 11.sp)
    }
}
```

- [ ] **Step 5: Redesign AchievementsScreen.kt earned/locked distinction**

In `AchievementsScreen.kt`, find the badge rendering composable and replace it with:

```kotlin
@Composable
private fun BadgeCard(badge: BadgeData, isEarned: Boolean) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.padding(8.dp),
    ) {
        Box(contentAlignment = Alignment.Center) {
            Surface(
                shape = RoundedCornerShape(16.dp),
                color = if (isEarned) QCGreen.copy(alpha = 0.12f) else MaterialTheme.colorScheme.surfaceVariant,
                modifier = Modifier.size(72.dp),
            ) {
                Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
                    // Badge icon — use badge.iconRes if available, else a placeholder icon
                    Icon(
                        imageVector = Icons.Rounded.EmojiEvents,
                        contentDescription = badge.nameEn,
                        tint = if (isEarned) QCGold else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f),
                        modifier = Modifier.size(36.dp)
                    )
                }
            }
            if (!isEarned) {
                // Lock overlay
                Box(
                    modifier = Modifier.size(72.dp).background(Color.Black.copy(alpha = 0.30f), RoundedCornerShape(16.dp)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(Icons.Rounded.Lock, contentDescription = "Locked", tint = Color.White, modifier = Modifier.size(22.dp))
                }
            }
            if (isEarned) {
                // Gold glow shadow done via border
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = Color.Transparent,
                    border = BorderStroke(2.dp, QCGold.copy(alpha = 0.6f)),
                    modifier = Modifier.size(72.dp),
                ) {}
            }
        }
        Spacer(Modifier.height(6.dp))
        Text(
            badge.nameEn, fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
            textAlign = TextAlign.Center, maxLines = 2,
            color = if (isEarned) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
        )
        if (!isEarned) {
            Spacer(Modifier.height(4.dp))
            LinearProgressIndicator(
                progress = { badge.progressPercent / 100f },
                modifier = Modifier.width(64.dp).height(3.dp).clip(RoundedCornerShape(2.dp)),
                color = QCGreen,
                trackColor = MaterialTheme.colorScheme.outline.copy(alpha = 0.3f),
            )
        }
    }
}
```

- [ ] **Step 6: Compile verify**

```bash
./gradlew :app:compileDebugKotlinPainter --no-daemon -Dkotlin.daemon.jvm.options="-Xmx3072m" 2>&1 | tail -15
```

Expected: `BUILD SUCCESSFUL`

- [ ] **Step 7: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/ui/profile/
git add app/src/painter/java/com/qcpaintshop/painter/data/local/datastore/UserPreferences.kt
git commit -m "feat(profile): tier-badge header, grouped settings, 3-way mode toggle, badge earned/locked grid"
```

---

## Task H: Loyalty + Points + Withdrawal Redesign

**Goal:** Horizontal tier progress track (Bronze→Silver→Gold→Diamond), gold-accented points transactions, large gold balance display with quick-amount chips.

**Files:**
- Modify: `[painter]ui/profile/PointsHistoryScreen.kt`
- Modify: `[painter]ui/home/components/WithdrawalSheet.kt`

- [ ] **Step 1: Add tier progress track to PointsHistoryScreen.kt**

At the top of `PointsHistoryScreen.kt` content, add the tier track composable:

```kotlin
@Composable
private fun TierProgressTrack(currentPoints: Int) {
    val tiers = listOf("Bronze" to 0, "Silver" to 5_000, "Gold" to 25_000, "Diamond" to 100_000)
    val tierColors = listOf(LevelBronze, LevelSilver, LevelGold, LevelDiamond)

    // Find current tier index
    val currentTierIndex = tiers.indexOfLast { (_, threshold) -> currentPoints >= threshold }.coerceAtLeast(0)
    val nextTier = tiers.getOrNull(currentTierIndex + 1)
    val progressToNext = if (nextTier != null) {
        val (_, nextThreshold) = nextTier
        val (_, currentThreshold) = tiers[currentTierIndex]
        ((currentPoints - currentThreshold).toFloat() / (nextThreshold - currentThreshold)).coerceIn(0f, 1f)
    } else 1f

    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
            Text("Loyalty Tier", fontSize = 14.sp, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurface)
            Surface(shape = RoundedCornerShape(20.dp), color = tierColors[currentTierIndex].copy(alpha = 0.15f)) {
                Text(tiers[currentTierIndex].first, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                    fontSize = 11.sp, fontWeight = FontWeight.Bold, color = tierColors[currentTierIndex])
            }
        }
        Spacer(Modifier.height(12.dp))
        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            tiers.forEachIndexed { index, (name, _) ->
                val isFilled = index <= currentTierIndex
                val isCurrent = index == currentTierIndex
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Box(
                        modifier = Modifier.size(if (isCurrent) 24.dp else 18.dp)
                            .background(if (isFilled) tierColors[index] else MaterialTheme.colorScheme.outline.copy(alpha = 0.3f), CircleShape),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (isCurrent) {
                            Icon(Icons.Rounded.Star, contentDescription = null, tint = Color.White, modifier = Modifier.size(12.dp))
                        }
                    }
                    Spacer(Modifier.height(4.dp))
                    Text(name, fontSize = 9.sp, color = if (isFilled) tierColors[index] else MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (index < tiers.size - 1) {
                    Box(modifier = Modifier.weight(1f).height(3.dp).padding(horizontal = 2.dp)
                        .background(if (index < currentTierIndex) tierColors[index] else if (index == currentTierIndex) QCGreen else MaterialTheme.colorScheme.outline.copy(alpha = 0.3f), RoundedCornerShape(2.dp)))
                }
            }
        }
        if (nextTier != null) {
            Spacer(Modifier.height(8.dp))
            Text("${NumberFormat.getNumberInstance().format(nextTier.second - currentPoints)} pts to ${nextTier.first}",
                fontSize = 11.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}
```

Also migrate all hardcoded colors in `PointsHistoryScreen.kt` to `MaterialTheme.colorScheme.*`. For transaction rows, use gold color for earned (`+`) transactions:
```kotlin
val amountColor = if (transaction.type == "credit") QCGold else MaterialTheme.colorScheme.error
val amountPrefix = if (transaction.type == "credit") "+" else "-"
Text("$amountPrefix${transaction.points} pts", color = amountColor, fontWeight = FontWeight.Bold, fontSize = 15.sp)
```

- [ ] **Step 2: Redesign WithdrawalSheet.kt**

In `[painter]ui/home/components/WithdrawalSheet.kt`, replace the main content:

```kotlin
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WithdrawalSheet(
    availablePoints: Int,
    onDismiss: () -> Unit,
    onWithdraw: (Int) -> Unit,
) {
    var amount by remember { mutableStateOf("") }
    val quickAmounts = listOf(500, 1000, 2000)

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        containerColor = MaterialTheme.colorScheme.surface,
    ) {
        Column(
            modifier = Modifier.fillMaxWidth().padding(horizontal = 24.dp).padding(bottom = 40.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            // Gold balance display
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("★", color = QCGold, fontSize = 32.sp, fontWeight = FontWeight.ExtraBold)
                Spacer(Modifier.width(8.dp))
                Text("$availablePoints pts", color = QCGold, fontSize = 28.sp, fontWeight = FontWeight.ExtraBold)
            }
            Text("available to withdraw", fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(24.dp))

            // Amount input
            OutlinedTextField(
                value = amount,
                onValueChange = { if (it.all { c -> c.isDigit() } && (it.isEmpty() || it.toInt() <= availablePoints)) amount = it },
                label = { Text("Enter amount (₹)") },
                modifier = Modifier.fillMaxWidth(),
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                singleLine = true,
                shape = RoundedCornerShape(14.dp),
                textStyle = LocalTextStyle.current.copy(fontSize = 22.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center),
            )
            Spacer(Modifier.height(14.dp))

            // Quick amount chips
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                quickAmounts.forEach { quickAmt ->
                    FilterChip(
                        selected = amount == quickAmt.toString(),
                        onClick = { amount = quickAmt.toString() },
                        label = { Text("₹$quickAmt", fontWeight = FontWeight.SemiBold) },
                        shape = RoundedCornerShape(20.dp),
                        colors = FilterChipDefaults.filterChipColors(
                            selectedContainerColor = QCGold,
                            selectedLabelColor = Color.White,
                        ),
                    )
                }
            }
            Spacer(Modifier.height(24.dp))

            Button(
                onClick = { amount.toIntOrNull()?.let { onWithdraw(it) } },
                enabled = amount.toIntOrNull()?.let { it in 1..availablePoints } == true,
                modifier = Modifier.fillMaxWidth().height(52.dp),
                shape = RoundedCornerShape(14.dp),
                colors = ButtonDefaults.buttonColors(containerColor = QCGreen),
            ) {
                Text("Withdraw ₹${amount.ifEmpty { "0" }}", fontWeight = FontWeight.Bold, fontSize = 16.sp)
            }
        }
    }
}
```

- [ ] **Step 3: Compile verify**

```bash
./gradlew :app:compileDebugKotlinPainter --no-daemon -Dkotlin.daemon.jvm.options="-Xmx3072m" 2>&1 | tail -15
```

Expected: `BUILD SUCCESSFUL`

- [ ] **Step 4: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/ui/profile/PointsHistoryScreen.kt
git add app/src/painter/java/com/qcpaintshop/painter/ui/home/components/WithdrawalSheet.kt
git commit -m "feat(loyalty): tier progress track, gold transaction rows, withdrawal quick chips"
```

---

## Task I: Final Polish + Version Bump + APK Build

**Goal:** Cross-screen consistency pass, version bump to v3.5.0 vc38, build painter APK, deliver to Telegram.

**Files:**
- Modify: `app/build.gradle.kts`

- [ ] **Step 1: Cross-screen color consistency check**

Search for any remaining hardcoded `QCBackground`, `QCSurface` (not in brand-intentional contexts), and `QCTextSecondary`/`QCTextTertiary` used as text colors in screen composables:

```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android"
grep -rn "color = QCTextSecondary\|color = QCTextTertiary\|\.background(QCBackground)\|\.background(QCSurface)" \
  app/src/painter/java/com/qcpaintshop/painter/ui/ \
  --include="*.kt" | grep -v "Color.kt\|Theme.kt"
```

For each hit, apply the color migration table. Re-run until zero results.

- [ ] **Step 2: Bump version in `app/build.gradle.kts`**

In the painter flavor block, change:
```kotlin
// Find the painter productFlavors block and update:
productFlavors {
    // ...
    create("painter") {
        // ...
        versionCode = 37       // OLD
        versionName = "3.4.0"  // OLD
    }
}
```
to:
```kotlin
create("painter") {
    // ...
    versionCode = 38
    versionName = "3.5.0"
}
```

- [ ] **Step 3: Full release build**

```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android"
./gradlew assemblePainterRelease --no-daemon \
  -Dkotlin.daemon.jvm.options="-Xmx3072m -XX:MaxMetaspaceSize=512m -XX:+UseSerialGC" \
  2>&1 | tail -20
```

Expected: `BUILD SUCCESSFUL`

APK location: `app/build/outputs/apk/painter/release/app-painter-release.apk`

- [ ] **Step 4: Deliver APK to Telegram**

```bash
APK_PATH="app/build/outputs/apk/painter/release/app-painter-release.apk"
BOT_TOKEN="$(cat D:/QUALITY\ COLOURS/DEVELOPMENT/qcpaintshop.com/google-services/.telegram-bot-token 2>/dev/null || echo $TELEGRAM_BOT_TOKEN)"
curl -s -F chat_id=930726256 \
     -F document=@"$APK_PATH" \
     -F caption="QC Painter v3.5.0 (vc38) — Enterprise Design Redesign 🎨 19 screens, dark mode fixed, Goals A-I complete." \
     "https://api.telegram.org/bot${BOT_TOKEN}/sendDocument"
```

If bot token env var is not available, read it from `D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/google-services/` directory or the memory reference `reference_telegram_apk_delivery.md`.

- [ ] **Step 5: Final commit**

```bash
git add app/build.gradle.kts
git commit -m "release(painter): v3.5.0 vc38 — enterprise design redesign complete"
```
