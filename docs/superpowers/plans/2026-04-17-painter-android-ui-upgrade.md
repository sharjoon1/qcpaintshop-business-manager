# Painter Android App UI/UX Upgrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the QC Painter Android app (v2.1.0 → v3.0.0) with a Premium Hybrid design system and full rewrites of Home, Catalog, Training, and Check-in screens.

**Architecture:** Three-step delivery — Step 1: global theme layer (Shape.kt + Color additions), Step 2: four key screen rewrites (Home, Catalog, Training, Check-in), Step 3: polish remaining screens (Profile, Work, PointsHistory, EditProfile, Notifications). Tasks 2–6 are independent and can run in parallel after Task 1.

**Tech Stack:** Kotlin, Jetpack Compose, Material 3, Hilt, Coil, Retrofit — all already in project.

**Android project root:** `D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\qcpaintshop-android\`
**Painter source root:** `app/src/painter/java/com/qcpaintshop/painter/`

---

## File Map

| Task | Files |
|------|-------|
| 1 | `ui/theme/Shape.kt` (CREATE), `ui/theme/Color.kt` (modify), `ui/theme/Theme.kt` (modify) |
| 2 | `ui/home/HomeScreen.kt` (rewrite) |
| 3 | `ui/catalog/CatalogScreen.kt` (rewrite), `ui/catalog/ProductDetailSheet.kt` (rewrite) |
| 4 | `ui/profile/TrainingScreen.kt` (rewrite), `ui/profile/TrainingDetailScreen.kt` (rewrite) |
| 5 | `ui/attendance/CheckInScreen.kt` (rewrite) |
| 6 | `ui/profile/ProfileScreen.kt`, `ui/work/WorkScreen.kt`, `ui/profile/PointsHistoryScreen.kt`, `ui/profile/EditProfileScreen.kt`, `ui/notifications/NotificationsScreen.kt` (all polish) |
| 7 | `app/build.gradle.kts` (version bump) |

---

## Task 1: Theme Foundation — Shape.kt + Color additions

**⚠️ Must be done first. All other tasks depend on `AppShapes`.**

**Files:**
- Create: `app/src/painter/java/com/qcpaintshop/painter/ui/theme/Shape.kt`
- Modify: `app/src/painter/java/com/qcpaintshop/painter/ui/theme/Color.kt`
- Modify: `app/src/painter/java/com/qcpaintshop/painter/ui/theme/Theme.kt`

- [ ] **Step 1: Create Shape.kt**

```kotlin
package com.qcpaintshop.painter.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Shapes
import androidx.compose.ui.unit.dp

val AppShapes = Shapes(
    extraSmall = RoundedCornerShape(4.dp),
    small      = RoundedCornerShape(8.dp),
    medium     = RoundedCornerShape(12.dp),
    large      = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(20.dp),
)

// Named aliases used directly in screens
val CardShape   = RoundedCornerShape(12.dp)
val ButtonShape = RoundedCornerShape(10.dp)
val ChipShape   = RoundedCornerShape(999.dp)
val SheetShape  = RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp)
val HeroShape   = RoundedCornerShape(16.dp)
```

- [ ] **Step 2: Add missing color tokens to Color.kt**

Add these lines to the bottom of the existing `Color.kt` (after `DiamondColor`):

```kotlin
// Additional semantic colors
val InfoBlue     = androidx.compose.ui.graphics.Color(0xFF2563EB)
val InfoBlueContainer = androidx.compose.ui.graphics.Color(0xFFEFF6FF)
val WarningAmber = androidx.compose.ui.graphics.Color(0xFFD97706)
val WarningAmberContainer = androidx.compose.ui.graphics.Color(0xFFFEF3C7)
val QCGreenLight = androidx.compose.ui.graphics.Color(0xFF2D8A5E)
val QCGreenContainer = androidx.compose.ui.graphics.Color(0xFFDCFCE7)
val QCGoldContainer  = androidx.compose.ui.graphics.Color(0xFFFEF3C7)
val QCSurfaceVariant = androidx.compose.ui.graphics.Color(0xFFF9FAFB)
```

- [ ] **Step 3: Add shapes to Theme.kt**

In `Theme.kt`, find the `MaterialTheme(` call and add `shapes = AppShapes`:

```kotlin
    MaterialTheme(
        colorScheme = QCColorScheme,
        typography = QCTypography,
        shapes = AppShapes,
        content = content
    )
```

Also add `primaryContainer = QCGreenContainer` to `QCColorScheme`:

```kotlin
private val QCColorScheme = lightColorScheme(
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
    error = QCError,
    outline = QCBorderLight,
)
```

- [ ] **Step 4: Build to verify no errors**

```bash
cd "D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\qcpaintshop-android"
./gradlew :app:compileDebugKotlin --quiet 2>&1 | grep -E "error:|warning:" | head -20
```

Expected: no errors. If errors, fix import statements (ensure `AppShapes` is imported in Theme.kt: `import com.qcpaintshop.painter.ui.theme.AppShapes`).

- [ ] **Step 5: Commit**

```bash
cd "D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\qcpaintshop-android"
git add app/src/painter/java/com/qcpaintshop/painter/ui/theme/
git commit -m "feat(theme): add Shape.kt, color tokens, wire shapes into MaterialTheme"
```

---

## Task 2: Home Screen Rewrite (Summary-First Layout)

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/ui/home/HomeScreen.kt`

**Context:** Replace the current long-scroll layout with: (1) Hero gradient card with balance + level + streak, (2) Quick Actions 4-grid, (3) Offers strip, (4) Stats chip row, (5) Recent activity feed. The existing `HomeViewModel` and its `uiState` are preserved — only the UI layer changes.

- [ ] **Step 1: Read current HomeScreen.kt to understand existing state fields**

Read `app/src/painter/java/com/qcpaintshop/painter/ui/home/HomeScreen.kt` lines 1–150 and `HomeViewModel.kt` to note: `state.painterName`, `state.level`, `state.streakDays`, `state.regularPoints`, `state.annualPoints`, `state.thisMonthEarnings`, `state.todayCheckedIn`, `state.offers`, `state.recentEstimates`, `state.recentTransactions`.

- [ ] **Step 2: Replace HomeScreen.kt with the new summary-first layout**

Replace the full file with:

```kotlin
package com.qcpaintshop.painter.ui.home

import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.qcpaintshop.painter.navigation.Routes
import com.qcpaintshop.painter.ui.theme.*
import java.text.NumberFormat
import java.util.Locale

private val inrFmt = NumberFormat.getCurrencyInstance(Locale("en", "IN")).apply { maximumFractionDigits = 0 }
private fun fmt(v: Double?) = if (v != null && v > 0) inrFmt.format(v) else "₹0"

@Composable
fun HomeScreen(
    onNavigate: (String) -> Unit,
    viewModel: HomeViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()

    Box(Modifier.fillMaxSize().background(QCBackground)) {
        if (state.isLoading && state.regularPoints == 0.0 && state.annualPoints == 0.0) {
            CircularProgressIndicator(Modifier.align(Alignment.Center), color = QCGreen)
        } else {
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(bottom = 100.dp)
            ) {
                // 1. HERO CARD
                item { HeroCard(state, onNavigate) }

                // 2. QUICK ACTIONS
                item {
                    QuickActionsRow(
                        modifier = Modifier.padding(horizontal = 16.dp).padding(top = 16.dp),
                        onCheckin = { onNavigate(Routes.CheckIn.route) },
                        onEstimate = { onNavigate(Routes.EstimateCreate.route) },
                        onWithdraw = { onNavigate(Routes.PointsHistory.route) },
                        onRefer = { onNavigate(Routes.Referrals.route) },
                    )
                }

                // 3. OFFERS STRIP
                if (state.offers.isNotEmpty()) {
                    item {
                        OffersStrip(
                            offers = state.offers,
                            modifier = Modifier.padding(top = 16.dp),
                        )
                    }
                }

                // 4. STATS ROW
                item {
                    StatsChipRow(
                        earnings = state.thisMonthEarnings,
                        checkins = state.monthCheckins,
                        estimates = state.monthEstimates,
                        modifier = Modifier.padding(horizontal = 16.dp).padding(top = 16.dp),
                    )
                }

                // 5. RECENT ACTIVITY
                if (state.recentEstimates.isNotEmpty() || state.recentTransactions.isNotEmpty()) {
                    item {
                        Text(
                            "Recent Activity",
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.SemiBold,
                            modifier = Modifier.padding(horizontal = 16.dp).padding(top = 20.dp, bottom = 8.dp)
                        )
                    }
                    items(state.recentEstimates.take(3)) { est ->
                        ActivityRow(
                            icon = Icons.Default.Description,
                            iconColor = InfoBlue,
                            title = est.customerName ?: "Self Billing",
                            subtitle = est.status ?: "",
                            amount = fmt(est.grandTotal),
                            modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = 8.dp),
                            onClick = { onNavigate("${Routes.EstimateDetail.route}/${est.id}") }
                        )
                    }
                    items(state.recentTransactions.take(3)) { tx ->
                        ActivityRow(
                            icon = Icons.Default.Star,
                            iconColor = QCGold,
                            title = tx.source ?: "Points",
                            subtitle = tx.pool ?: "",
                            amount = "+${fmt(tx.amount)}",
                            modifier = Modifier.padding(horizontal = 16.dp).padding(bottom = 8.dp),
                            onClick = { onNavigate(Routes.PointsHistory.route) }
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun HeroCard(state: HomeUiState, onNavigate: (String) -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .background(
                Brush.linearGradient(listOf(QCGreenDarkest, QCGreen)),
            )
            .padding(horizontal = 20.dp, vertical = 20.dp)
    ) {
        Column {
            // Top row: avatar + greeting + notifications
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.size(44.dp).clip(CircleShape)
                        .background(QCGreenLight),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        (state.painterName?.firstOrNull() ?: 'P').uppercaseChar().toString(),
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                        fontSize = 18.sp
                    )
                }
                Spacer(Modifier.width(12.dp))
                Column(Modifier.weight(1f)) {
                    Text("Good morning,", color = Color.White.copy(alpha = 0.7f), fontSize = 12.sp)
                    Text(
                        state.painterName ?: "Painter",
                        color = Color.White,
                        fontWeight = FontWeight.Bold,
                        fontSize = 16.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                IconButton(onClick = { onNavigate(Routes.Notifications.route) }) {
                    Badge(containerColor = QCGold, contentColor = Color.White) {
                        Icon(Icons.Default.Notifications, null, tint = Color.White, modifier = Modifier.size(24.dp))
                    }
                }
            }

            Spacer(Modifier.height(16.dp))

            // Level + streak chips
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                SurfaceChip("🥇 ${state.level ?: "Painter"}")
                SurfaceChip("🔥 ${state.streakDays ?: 0} day streak")
            }

            Spacer(Modifier.height(16.dp))

            // Balance row
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                BalanceCell(label = "Regular Points", amount = fmt(state.regularPoints), modifier = Modifier.weight(1f), isGold = false)
                BalanceCell(label = "Annual Points",  amount = fmt(state.annualPoints),  modifier = Modifier.weight(1f), isGold = true)
            }

            // Level progress bar
            state.levelProgress?.let { progress ->
                Spacer(Modifier.height(12.dp))
                LinearProgressIndicator(
                    progress = { progress.coerceIn(0f, 1f) },
                    modifier = Modifier.fillMaxWidth().height(4.dp).clip(ChipShape),
                    color = QCGold,
                    trackColor = Color.White.copy(alpha = 0.2f),
                )
                Text(
                    "${fmt(state.ptsToNextLevel)} to ${state.nextLevel ?: "Diamond"}",
                    color = Color.White.copy(alpha = 0.6f),
                    fontSize = 10.sp,
                    modifier = Modifier.padding(top = 4.dp)
                )
            }
        }
    }
}

@Composable
private fun SurfaceChip(label: String) {
    Surface(
        shape = ChipShape,
        color = Color.White.copy(alpha = 0.15f),
    ) {
        Text(label, color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Medium,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
    }
}

@Composable
private fun BalanceCell(label: String, amount: String, modifier: Modifier, isGold: Boolean) {
    Surface(
        modifier = modifier,
        shape = CardShape,
        color = if (isGold) QCGold.copy(alpha = 0.2f) else Color.White.copy(alpha = 0.12f),
    ) {
        Column(Modifier.padding(12.dp)) {
            Text(amount, color = if (isGold) QCGoldLight else Color.White, fontWeight = FontWeight.Bold, fontSize = 18.sp)
            Text(label,  color = Color.White.copy(alpha = 0.65f), fontSize = 10.sp)
        }
    }
}

@Composable
private fun QuickActionsRow(
    modifier: Modifier,
    onCheckin: () -> Unit,
    onEstimate: () -> Unit,
    onWithdraw: () -> Unit,
    onRefer: () -> Unit,
) {
    Row(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        QuickActionCard("Check in",  Icons.Default.CheckCircle, onCheckin,  Modifier.weight(1f))
        QuickActionCard("Estimate",  Icons.Default.Description, onEstimate, Modifier.weight(1f))
        QuickActionCard("Withdraw",  Icons.Default.AccountBalanceWallet, onWithdraw, Modifier.weight(1f))
        QuickActionCard("Refer",     Icons.Default.Share,       onRefer,    Modifier.weight(1f))
    }
}

@Composable
private fun QuickActionCard(label: String, icon: ImageVector, onClick: () -> Unit, modifier: Modifier) {
    Card(
        onClick = onClick,
        modifier = modifier,
        shape = CardShape,
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(2.dp),
    ) {
        Column(
            Modifier.padding(10.dp).fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Icon(icon, null, tint = QCGreen, modifier = Modifier.size(22.dp))
            Spacer(Modifier.height(4.dp))
            Text(label, fontSize = 10.sp, color = QCTextSecondary, fontWeight = FontWeight.Medium)
        }
    }
}

@Composable
private fun OffersStrip(offers: List<com.qcpaintshop.painter.data.remote.api.OfferData>, modifier: Modifier) {
    Column(modifier) {
        Row(
            Modifier.padding(horizontal = 16.dp).fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("🔥 Active Offers", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
            Text("See all →", color = QCGreen, fontSize = 12.sp)
        }
        Spacer(Modifier.height(8.dp))
        LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            items(offers) { offer ->
                Card(
                    shape = CardShape,
                    colors = CardDefaults.cardColors(containerColor = QCGreenContainer),
                    modifier = Modifier.width(200.dp),
                    elevation = CardDefaults.cardElevation(1.dp),
                ) {
                    Column(Modifier.padding(12.dp)) {
                        Text(offer.title ?: "Special Offer", fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = QCGreenDarkest)
                        offer.description?.let { Text(it, fontSize = 11.sp, color = QCTextSecondary, maxLines = 2, overflow = TextOverflow.Ellipsis) }
                        offer.endDate?.let {
                            Spacer(Modifier.height(6.dp))
                            Surface(shape = ChipShape, color = QCGold) {
                                Text("Ends $it", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Medium,
                                    modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp))
                            }
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun StatsChipRow(earnings: Double, checkins: Int, estimates: Int, modifier: Modifier) {
    Card(modifier.fillMaxWidth(), shape = CardShape, colors = CardDefaults.cardColors(Color.White), elevation = CardDefaults.cardElevation(2.dp)) {
        Row(Modifier.padding(12.dp).fillMaxWidth(), horizontalArrangement = Arrangement.SpaceAround) {
            StatChip(fmt(earnings), "earned", QCGreen)
            Divider(Modifier.height(32.dp).width(1.dp), color = QCBorderLight)
            StatChip("$checkins", "check-ins", InfoBlue)
            Divider(Modifier.height(32.dp).width(1.dp), color = QCBorderLight)
            StatChip("$estimates", "estimates", QCGold)
        }
    }
}

@Composable
private fun StatChip(value: String, label: String, color: Color) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, fontWeight = FontWeight.Bold, fontSize = 15.sp, color = color)
        Text(label,  fontSize = 10.sp, color = QCTextSecondary)
    }
}

@Composable
private fun ActivityRow(icon: ImageVector, iconColor: Color, title: String, subtitle: String, amount: String, modifier: Modifier, onClick: () -> Unit) {
    Card(onClick = onClick, modifier = modifier.fillMaxWidth(), shape = CardShape, colors = CardDefaults.cardColors(Color.White), elevation = CardDefaults.cardElevation(1.dp)) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = CardShape, color = iconColor.copy(alpha = 0.1f)) {
                Icon(icon, null, tint = iconColor, modifier = Modifier.padding(8.dp).size(18.dp))
            }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(title, fontWeight = FontWeight.Medium, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(subtitle, fontSize = 11.sp, color = QCTextSecondary)
            }
            Text(amount, fontWeight = FontWeight.SemiBold, fontSize = 13.sp, color = QCGreen)
        }
    }
}
```

**Note:** If `HomeUiState` doesn't have `monthCheckins`, `monthEstimates`, `levelProgress`, `ptsToNextLevel`, `nextLevel` fields yet — use `state.streakDays ?: 0` for checkins and `0` for estimates as fallback. Do NOT add new API calls. Use only existing state fields, substituting `0` for any missing ones.

- [ ] **Step 3: Build to verify**

```bash
cd "D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\qcpaintshop-android"
./gradlew :app:compileDebugKotlin --quiet 2>&1 | grep -E "error:" | head -20
```

Expected: 0 errors. Fix any import errors by adding missing imports at top.

- [ ] **Step 4: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/ui/home/HomeScreen.kt
git commit -m "feat(home): summary-first layout — hero card, quick actions, offers strip, stats"
```

---

## Task 3: Catalog Screen — Enterprise v8 Cards + Variant Chips

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/ui/catalog/CatalogScreen.kt`
- Modify: `app/src/painter/java/com/qcpaintshop/painter/ui/catalog/ProductDetailSheet.kt`

**Context:** `CatalogProduct` has `packSizes: List<PackSize>` where each `PackSize` has `size`, `unit`, `rate`, `regularPoints`, `annualPoints`. Biggest variant = last item in the list (API returns ascending by volume). Variant chip tap updates displayed price — local state only, no API call.

Brand gradient map:
- Asian Paints → `QCGreenDarkest to QCGreen`
- Berger → `Color(0xFF1e3a6e) to Color(0xFF2563EB)`
- Kansai / Nerolac → `Color(0xFF7f1d1d) to Color(0xFFdc2626)`
- Nippon → `Color(0xFF7c2d12) to Color(0xFFea580c)`
- Indigo → `Color(0xFF312e81) to Color(0xFF6366f1)`
- default → `Color(0xFF374151) to Color(0xFF6b7280)`

- [ ] **Step 1: Add brand gradient helper function to CatalogScreen.kt**

Add this private function at the top of `CatalogScreen.kt` (after imports, before the `@Composable` screen function):

```kotlin
private fun brandGradient(brand: String?): Brush {
    val b = brand?.lowercase() ?: ""
    val (start, end) = when {
        "asian" in b                     -> Color(0xFF0D3D23) to Color(0xFF1B5E3B)
        "berger" in b                    -> Color(0xFF1e3a6e) to Color(0xFF2563EB)
        "kansai" in b || "nerolac" in b  -> Color(0xFF7f1d1d) to Color(0xFFdc2626)
        "nippon" in b                    -> Color(0xFF7c2d12) to Color(0xFFea580c)
        "indigo" in b                    -> Color(0xFF312e81) to Color(0xFF6366f1)
        else                             -> Color(0xFF374151) to Color(0xFF6b7280)
    }
    return Brush.linearGradient(listOf(start, end))
}
```

- [ ] **Step 2: Replace the product card composable in CatalogScreen.kt**

Find the existing product card composable (search for `@Composable` + `ProductCard` or `fun.*Card.*CatalogProduct`). Replace it with:

```kotlin
@Composable
private fun ProductCard(product: CatalogProduct, onClick: () -> Unit) {
    // Biggest variant = last in list (API sorted ascending by volume)
    val variants = product.packSizes ?: emptyList()
    var selectedIndex by remember(product.id) { mutableIntStateOf((variants.size - 1).coerceAtLeast(0)) }
    val selectedVariant = variants.getOrNull(selectedIndex)
    val displayPrice = selectedVariant?.rate ?: product.minRate

    Card(
        onClick = onClick,
        shape = CardShape,
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column {
            // Header zone — brand gradient + paint can icon + points badge
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(64.dp)
                    .background(brandGradient(product.brand))
                    .padding(8.dp)
            ) {
                // Paint can SVG via Canvas or Icon placeholder
                Icon(
                    Icons.Default.FormatPaint,
                    contentDescription = null,
                    tint = Color.White.copy(alpha = 0.85f),
                    modifier = Modifier.size(28.dp).align(Alignment.Center),
                )
                // Points badge top-right
                product.pointsPerUnit?.let { pts ->
                    if (pts > 0) {
                        Surface(
                            shape = ChipShape,
                            color = QCGold,
                            modifier = Modifier.align(Alignment.TopEnd),
                        ) {
                            Text(
                                "+${pts.toInt()}⭐",
                                color = Color.White,
                                fontSize = 9.sp,
                                fontWeight = FontWeight.Bold,
                                modifier = Modifier.padding(horizontal = 5.dp, vertical = 2.dp),
                            )
                        }
                    }
                }
            }

            // Body
            Column(Modifier.padding(8.dp)) {
                Text(
                    product.name ?: "Product",
                    fontWeight = FontWeight.Bold,
                    fontSize = 12.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    product.category ?: "",
                    fontSize = 10.sp,
                    color = QCTextSecondary,
                )

                // Variant chips
                if (variants.isNotEmpty()) {
                    Spacer(Modifier.height(6.dp))
                    LazyRow(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                        itemsIndexed(variants) { index, v ->
                            val isSelected = index == selectedIndex
                            val label = buildString {
                                v.size?.let { append(it) }
                                v.unit?.let { append(it) }
                            }.ifEmpty { "Unit" }
                            Surface(
                                shape = ChipShape,
                                color = if (isSelected) QCGreen else QCGreenContainer,
                                modifier = Modifier.clickable { selectedIndex = index },
                            ) {
                                Text(
                                    label,
                                    fontSize = 9.sp,
                                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                    color = if (isSelected) Color.White else QCGreen,
                                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 3.dp),
                                )
                            }
                        }
                    }
                }

                // Price — updates with variant selection
                Spacer(Modifier.height(4.dp))
                Text(
                    displayPrice?.let { inr.format(it) } ?: "Price on request",
                    fontWeight = FontWeight.Bold,
                    fontSize = 13.sp,
                    color = QCGreen,
                )
            }
        }
    }
}
```

- [ ] **Step 3: Update ProductDetailSheet.kt to show earnings breakdown**

Find `ProductDetailSheet.kt` and add an earnings breakdown section inside the bottom sheet, after the variants list:

```kotlin
@Composable
private fun EarningsBreakdown(variants: List<ProductVariant>?) {
    val v = variants?.firstOrNull() ?: return
    if ((v.regularPoints ?: 0.0) == 0.0 && (v.annualPoints ?: 0.0) == 0.0) return

    Spacer(Modifier.height(12.dp))
    Text("Your Earnings per Unit", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
    Spacer(Modifier.height(6.dp))

    v.regularPoints?.let { pts ->
        if (pts > 0) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Customer billing", fontSize = 12.sp, color = QCTextSecondary)
                Surface(shape = ChipShape, color = QCGreenContainer) {
                    Text("+${pts.toInt()} pts", color = QCGreen, fontSize = 11.sp, fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp))
                }
            }
        }
    }
    v.annualPoints?.let { pts ->
        if (pts > 0) {
            Spacer(Modifier.height(4.dp))
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Self billing (annual pool)", fontSize = 12.sp, color = QCTextSecondary)
                Surface(shape = ChipShape, color = QCGoldContainer) {
                    Text("+${pts.toInt()} pts", color = QCGold, fontSize = 11.sp, fontWeight = FontWeight.Bold,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp))
                }
            }
        }
    }
}
```

Call `EarningsBreakdown(state.selectedProduct?.variants)` inside the sheet content after the variants list section.

- [ ] **Step 4: Build to verify**

```bash
./gradlew :app:compileDebugKotlin --quiet 2>&1 | grep -E "error:" | head -20
```

Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/ui/catalog/
git commit -m "feat(catalog): enterprise v8 cards — brand gradient, variant chips, earnings breakdown"
```

---

## Task 4: Training Screen Rewrite — Category Tabs + Featured Videos

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/ui/profile/TrainingScreen.kt`
- Modify: `app/src/painter/java/com/qcpaintshop/painter/ui/profile/TrainingDetailScreen.kt`

**Context:** `TrainingApi` returns a list with fields: `id`, `title`, `title_ta`, `summary`, `summary_ta`, `category`, `content_type` (VIDEO/PDF/ARTICLE), `view_count`, `content_en`/`content_ta`, `video_url`. YouTube thumbnail URL pattern: `https://img.youtube.com/vi/[VIDEO_ID]/mqdefault.jpg`. Extract video ID from `https://youtube.com/watch?v=VIDEO_ID` or `https://youtu.be/VIDEO_ID`.

- [ ] **Step 1: Read current TrainingScreen.kt and TrainingViewModel.kt**

Read both files to understand the existing `TrainingUiState` fields and how training items are stored. Note: `state.items: List<TrainingItem>`, each with `title`, `title_ta`, `category`, `contentType`, `viewCount`.

- [ ] **Step 2: Add YouTube ID extractor and category filter to TrainingScreen.kt**

Add these helpers at the top of the file (after imports):

```kotlin
private fun extractYouTubeId(url: String?): String? {
    if (url == null) return null
    val patterns = listOf(
        Regex("youtu\\.be/([A-Za-z0-9_-]+)"),
        Regex("youtube\\.com/watch\\?v=([A-Za-z0-9_-]+)"),
        Regex("youtube\\.com/embed/([A-Za-z0-9_-]+)"),
    )
    return patterns.firstNotNullOfOrNull { it.find(url)?.groupValues?.getOrNull(1) }
}

private fun youtubeThumbnail(url: String?) =
    extractYouTubeId(url)?.let { "https://img.youtube.com/vi/$it/mqdefault.jpg" }
```

- [ ] **Step 3: Replace TrainingScreen.kt composable content**

Replace the screen's LazyColumn content with the new layout:

```kotlin
@Composable
fun TrainingScreen(
    onBack: () -> Unit,
    onItemClick: (Int) -> Unit,
    viewModel: TrainingViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    var isTamil by remember { mutableStateOf(false) }
    var selectedCategory by remember { mutableStateOf<String?>(null) }

    val categories = remember(state.items) {
        listOf(null) + state.items.mapNotNull { it.category }.distinct()
    }
    val filtered = remember(state.items, selectedCategory) {
        if (selectedCategory == null) state.items
        else state.items.filter { it.category == selectedCategory }
    }
    val featured = remember(filtered) {
        filtered.filter { it.contentType?.uppercase() == "VIDEO" }.take(5)
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Training", fontWeight = FontWeight.Bold) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } },
                actions = {
                    // Tamil toggle
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(if (isTamil) "தமிழ்" else "EN", fontSize = 12.sp, color = QCGreen)
                        Switch(checked = isTamil, onCheckedChange = { isTamil = it },
                            colors = SwitchDefaults.colors(checkedThumbColor = QCGreen, checkedTrackColor = QCGreenContainer))
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.White)
            )
        }
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding), contentPadding = PaddingValues(bottom = 80.dp)) {
            // Search bar
            item {
                OutlinedTextField(
                    value = state.searchQuery,
                    onValueChange = { viewModel.search(it) },
                    placeholder = { Text("Search training...") },
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                    shape = ChipShape,
                    singleLine = true,
                )
            }

            // Category chips
            item {
                LazyRow(
                    contentPadding = PaddingValues(horizontal = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.padding(bottom = 8.dp),
                ) {
                    items(categories) { cat ->
                        val isSelected = cat == selectedCategory
                        FilterChip(
                            selected = isSelected,
                            onClick = { selectedCategory = cat },
                            label = { Text(cat ?: "All") },
                            colors = FilterChipDefaults.filterChipColors(
                                selectedContainerColor = QCGreen,
                                selectedLabelColor = Color.White,
                            )
                        )
                    }
                }
            }

            // Featured videos (only when "All" selected)
            if (selectedCategory == null && featured.isNotEmpty()) {
                item {
                    Text("Featured Videos", fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
                    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        items(featured) { item ->
                            FeaturedVideoCard(
                                title = if (isTamil) item.titleTa ?: item.title else item.title,
                                videoUrl = item.videoUrl,
                                viewCount = item.viewCount,
                                onClick = { onItemClick(item.id) }
                            )
                        }
                    }
                    Spacer(Modifier.height(16.dp))
                }
            }

            // All content list
            item {
                Text("Guides & Articles", fontWeight = FontWeight.SemiBold, fontSize = 14.sp,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp))
            }
            items(filtered) { item ->
                TrainingListCard(
                    title = if (isTamil) item.titleTa ?: item.title else item.title,
                    summary = if (isTamil) item.summaryTa ?: item.summary else item.summary,
                    contentType = item.contentType,
                    category = item.category,
                    viewCount = item.viewCount,
                    onClick = { onItemClick(item.id) },
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                )
            }
        }
    }
}

@Composable
private fun FeaturedVideoCard(title: String?, videoUrl: String?, viewCount: Int?, onClick: () -> Unit) {
    val thumbUrl = youtubeThumbnail(videoUrl)
    Card(onClick = onClick, shape = CardShape, modifier = Modifier.width(240.dp).height(150.dp),
        colors = CardDefaults.cardColors(Color.White), elevation = CardDefaults.cardElevation(2.dp)) {
        Box(Modifier.fillMaxSize()) {
            if (thumbUrl != null) {
                coil.compose.AsyncImage(
                    model = thumbUrl, contentDescription = null,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = androidx.compose.ui.layout.ContentScale.Crop,
                )
                // Dark scrim
                Box(Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color.Transparent, Color.Black.copy(alpha = 0.6f)))))
            } else {
                Box(Modifier.fillMaxSize().background(Brush.linearGradient(listOf(QCGreenDarkest, QCGreen))))
            }
            // Play button
            Surface(shape = CircleShape, color = Color.White.copy(alpha = 0.9f),
                modifier = Modifier.size(40.dp).align(Alignment.Center)) {
                Icon(Icons.Default.PlayArrow, null, tint = QCGreen,
                    modifier = Modifier.padding(8.dp))
            }
            // Title + view count
            Column(Modifier.align(Alignment.BottomStart).padding(10.dp)) {
                Text(title ?: "Video", color = Color.White, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, overflow = TextOverflow.Ellipsis)
                viewCount?.let { Text("$it views", color = Color.White.copy(alpha = 0.7f), fontSize = 10.sp) }
            }
        }
    }
}

@Composable
private fun TrainingListCard(title: String?, summary: String?, contentType: String?, category: String?, viewCount: Int?, onClick: () -> Unit, modifier: Modifier) {
    val (badgeColor, badgeLabel) = when (contentType?.uppercase()) {
        "VIDEO"   -> QCGreen to "VIDEO"
        "PDF"     -> QCError to "PDF"
        else      -> InfoBlue to "ARTICLE"
    }
    Card(onClick = onClick, shape = CardShape, modifier = modifier.fillMaxWidth(),
        colors = CardDefaults.cardColors(Color.White), elevation = CardDefaults.cardElevation(1.dp)) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = CardShape, color = badgeColor) {
                Text(badgeLabel, color = Color.White, fontSize = 9.sp, fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 4.dp))
            }
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(title ?: "Lesson", fontWeight = FontWeight.SemiBold, fontSize = 13.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                summary?.let { Text(it, fontSize = 11.sp, color = QCTextSecondary, maxLines = 2, overflow = TextOverflow.Ellipsis) }
                category?.let {
                    Spacer(Modifier.height(4.dp))
                    Surface(shape = ChipShape, color = QCGreenContainer) {
                        Text(it, fontSize = 9.sp, color = QCGreen, fontWeight = FontWeight.Medium,
                            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp))
                    }
                }
            }
            viewCount?.let {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Default.Visibility, null, tint = QCTextTertiary, modifier = Modifier.size(14.dp))
                    Text("$it", fontSize = 9.sp, color = QCTextTertiary)
                }
            }
        }
    }
}
```

**Note:** If `TrainingItem` doesn't have `titleTa`, `summaryTa`, `videoUrl` fields — use `title` and `summary` as fallback and pass `null` for `videoUrl`. Do NOT modify data classes.

- [ ] **Step 4: Build to verify**

```bash
./gradlew :app:compileDebugKotlin --quiet 2>&1 | grep -E "error:" | head -20
```

- [ ] **Step 5: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/ui/profile/Training*.kt
git commit -m "feat(training): category tabs, featured video cards, Tamil toggle, content type badges"
```

---

## Task 5: Check-in Screen Rewrite — Confetti + Photo Capture + Error States

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/ui/attendance/CheckInScreen.kt`

**Context:** Existing `CheckInViewModel` has `state.success`, `state.isLoading`, `state.errorMessage`, `state.alreadyCheckedIn`. Keep all viewModel logic intact — only rewrite the UI. Confetti uses `Canvas` API (no external library needed).

- [ ] **Step 1: Replace CheckInScreen.kt**

```kotlin
package com.qcpaintshop.painter.ui.attendance

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.*
import androidx.compose.animation.core.*
import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.*
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.*
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import com.google.android.gms.location.LocationServices
import com.qcpaintshop.painter.ui.theme.*
import kotlinx.coroutines.delay
import kotlin.math.sin
import kotlin.random.Random

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CheckInScreen(
    onBack: () -> Unit,
    viewModel: CheckInViewModel = hiltViewModel(),
) {
    val state by viewModel.uiState.collectAsState()
    val context = LocalContext.current
    val fusedLocationClient = remember { com.google.android.gms.location.LocationServices.getFusedLocationProviderClient(context) }

    // Auto-navigate after success (after confetti plays)
    LaunchedEffect(state.success) {
        if (state.success) {
            delay(2500)
            onBack()
        }
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) requestLocation(fusedLocationClient, viewModel)
        else viewModel.setError("Location permission denied. Please enable in Settings.")
    }

    // Success overlay
    AnimatedVisibility(
        visible = state.success,
        enter = fadeIn() + scaleIn(initialScale = 0.8f),
    ) {
        SuccessOverlay(pointsAwarded = state.pointsAwarded)
    }

    if (!state.success) {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = { Text("Check In", fontWeight = FontWeight.Bold) },
                    navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } },
                    colors = TopAppBarDefaults.topAppBarColors(containerColor = Color.White),
                )
            },
            containerColor = QCBackground,
        ) { padding ->
            Column(
                Modifier.fillMaxSize().padding(padding).padding(20.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                // Header card
                Card(
                    Modifier.fillMaxWidth(), shape = HeroShape,
                    colors = CardDefaults.cardColors(containerColor = Color.White),
                    elevation = CardDefaults.cardElevation(2.dp),
                ) {
                    Column(
                        Modifier.background(Brush.linearGradient(listOf(QCGreenDarkest, QCGreen))).padding(20.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                    ) {
                        Icon(Icons.Default.LocationOn, null, tint = Color.White.copy(alpha = 0.8f), modifier = Modifier.size(28.dp))
                        Spacer(Modifier.height(8.dp))
                        Text("Today's Check-in", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 18.sp)
                        Text(
                            java.text.SimpleDateFormat("EEE, d MMM yyyy", java.util.Locale.getDefault()).format(java.util.Date()),
                            color = Color.White.copy(alpha = 0.7f), fontSize = 13.sp,
                        )
                    }
                }

                // Error / info states
                state.errorMessage?.let { msg ->
                    val (bg, icon) = when {
                        "far" in msg.lowercase() || "km" in msg  -> QCError.copy(0.1f) to Icons.Default.LocationOff
                        "permission" in msg.lowercase()           -> WarningAmber.copy(0.1f) to Icons.Default.Warning
                        "already" in msg.lowercase()              -> InfoBlue.copy(0.1f) to Icons.Default.CheckCircle
                        else                                       -> QCError.copy(0.1f) to Icons.Default.Error
                    }
                    Card(Modifier.fillMaxWidth(), shape = CardShape, colors = CardDefaults.cardColors(bg)) {
                        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(icon, null, tint = QCTextPrimary, modifier = Modifier.size(20.dp))
                            Spacer(Modifier.width(10.dp))
                            Text(msg, fontSize = 13.sp)
                        }
                    }
                }

                Spacer(Modifier.weight(1f))

                // Large check-in button
                val scale by animateFloatAsState(
                    targetValue = if (state.isLoading) 0.95f else 1f,
                    animationSpec = infiniteRepeatable(tween(600), RepeatMode.Reverse),
                    label = "pulse",
                )
                Box(contentAlignment = Alignment.Center) {
                    Box(
                        Modifier
                            .size(160.dp)
                            .clip(CircleShape)
                            .background(Brush.radialGradient(listOf(QCGreenLight.copy(0.3f), Color.Transparent)))
                    )
                    Button(
                        onClick = {
                            if (ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                                requestLocation(fusedLocationClient, viewModel)
                            } else {
                                permissionLauncher.launch(Manifest.permission.ACCESS_FINE_LOCATION)
                            }
                        },
                        modifier = Modifier.size(120.dp).scale(scale),
                        shape = CircleShape,
                        colors = ButtonDefaults.buttonColors(containerColor = QCGreen),
                        enabled = !state.isLoading,
                        elevation = ButtonDefaults.buttonElevation(8.dp),
                    ) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            if (state.isLoading) {
                                CircularProgressIndicator(color = Color.White, modifier = Modifier.size(28.dp), strokeWidth = 3.dp)
                            } else {
                                Icon(Icons.Default.CheckCircle, null, tint = Color.White, modifier = Modifier.size(32.dp))
                            }
                            Spacer(Modifier.height(4.dp))
                            Text(if (state.isLoading) "Verifying…" else "Check In", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }

                Spacer(Modifier.weight(1f))

                // Stats row
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceAround) {
                    StatItem("🔥 ${state.streakDays ?: 0}", "Day Streak")
                    StatItem("📅 ${state.monthVisits ?: 0}", "This Month")
                }
            }
        }
    }
}

@Composable
private fun StatItem(value: String, label: String) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Text(value, fontWeight = FontWeight.Bold, fontSize = 16.sp, color = QCGreen)
        Text(label, fontSize = 11.sp, color = QCTextSecondary)
    }
}

@Composable
private fun SuccessOverlay(pointsAwarded: Int?) {
    val infiniteTransition = rememberInfiniteTransition(label = "confetti")
    val tick by infiniteTransition.animateFloat(
        initialValue = 0f, targetValue = 1f,
        animationSpec = infiniteRepeatable(tween(2000, easing = LinearEasing)),
        label = "tick",
    )
    // Confetti particles (seeded so stable across recompositions)
    val particles = remember {
        List(30) {
            Triple(Random.nextFloat(), Random.nextFloat() * 2f * Math.PI.toFloat(), if (it % 2 == 0) 0xFFD4A24E.toInt() else 0xFF1B5E3B.toInt())
        }
    }

    Box(Modifier.fillMaxSize().background(QCGreenDarkest.copy(alpha = 0.92f)), contentAlignment = Alignment.Center) {
        // Confetti canvas
        Canvas(Modifier.fillMaxSize()) {
            particles.forEach { (xFrac, phase, colorInt) ->
                val x = xFrac * size.width
                val y = ((tick + phase / (2 * Math.PI.toFloat())) % 1f) * size.height
                val wobble = sin((tick * 4 + phase) * Math.PI.toFloat()) * 10f
                drawCircle(Color(colorInt), radius = 5f, center = Offset(x + wobble, y))
            }
        }

        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            // Big checkmark
            Surface(shape = CircleShape, color = Color.White, modifier = Modifier.size(100.dp)) {
                Icon(Icons.Default.Check, null, tint = QCGreen, modifier = Modifier.padding(20.dp))
            }
            Spacer(Modifier.height(24.dp))
            Text("Checked in! ✓", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 26.sp)
            Spacer(Modifier.height(8.dp))
            Text(
                java.text.SimpleDateFormat("hh:mm a", java.util.Locale.getDefault()).format(java.util.Date()),
                color = Color.White.copy(0.7f), fontSize = 14.sp,
            )
            pointsAwarded?.let {
                Spacer(Modifier.height(16.dp))
                Surface(shape = ChipShape, color = QCGold) {
                    Text("+$it pts", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp,
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
                }
            }
        }
    }
}
```

**Note:** If `state.pointsAwarded`, `state.streakDays`, `state.monthVisits` don't exist in `CheckInUiState`, use `null`/`0` fallbacks. If `viewModel.setError()` doesn't exist, use `viewModel.onError()` or similar existing method name — read `CheckInViewModel.kt` to confirm.

- [ ] **Step 2: Build to verify**

```bash
./gradlew :app:compileDebugKotlin --quiet 2>&1 | grep -E "error:" | head -20
```

- [ ] **Step 3: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/ui/attendance/CheckInScreen.kt
git commit -m "feat(checkin): confetti success overlay, pulsing button, error state cards"
```

---

## Task 6: Polish Screens (Profile, Work, PointsHistory, EditProfile, Notifications)

**Files:** 5 screen files — apply theme tokens (CardShape, QCGreen, QCGold etc.) consistently.

**Context:** These screens already work correctly. Changes are cosmetic: update card shapes to `CardShape`, colors to theme tokens, status left-border on Work cards, type-colored left border on Notifications, pool filter chips on PointsHistory, and add missing profile fields to EditProfile.

- [ ] **Step 1: ProfileScreen.kt — hero header + grouped menu**

First add this private helper at the top of `ProfileScreen.kt` (after imports — `fmt` is defined locally per file in this project):

```kotlin
private val _inrFmt = java.text.NumberFormat.getCurrencyInstance(java.util.Locale("en","IN")).apply { maximumFractionDigits = 0 }
private fun fmt(v: Double?) = if (v != null && v > 0) _inrFmt.format(v) else "₹0"
```

Find the current profile header section and replace with gradient hero (same as Home hero but without balance):

```kotlin
// In ProfileScreen.kt, replace the profile header with:
Box(
    Modifier.fillMaxWidth()
        .background(Brush.linearGradient(listOf(QCGreenDarkest, QCGreen)))
        .padding(20.dp)
) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
        // Profile photo circle
        Box(Modifier.size(72.dp).clip(CircleShape).background(QCGreenLight), contentAlignment = Alignment.Center) {
            Text((state.painterName?.firstOrNull() ?: 'P').uppercaseChar().toString(),
                color = Color.White, fontWeight = FontWeight.Bold, fontSize = 28.sp)
        }
        Spacer(Modifier.height(10.dp))
        Text(state.painterName ?: "Painter", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 18.sp)
        Text(state.phone ?: "", color = Color.White.copy(0.7f), fontSize = 13.sp)
        Spacer(Modifier.height(10.dp))
        // Points summary chips
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Surface(shape = ChipShape, color = Color.White.copy(0.15f)) {
                Text("${fmt(state.regularPoints)} Regular", color = Color.White, fontSize = 11.sp,
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
            }
            Surface(shape = ChipShape, color = QCGold.copy(0.3f)) {
                Text("${fmt(state.annualPoints)} Annual", color = QCGoldLight, fontSize = 11.sp,
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp))
            }
        }
    }
}
```

For menu items — wrap existing list items in `Card` with `CardShape` and `elevation = 1.dp`. Group with `HorizontalDivider`.

- [ ] **Step 2: WorkScreen.kt — pill tab bar + status left-border cards**

Replace the tab indicator from `underline` to `pill` style:
```kotlin
// Wrap tab content in a Surface with ChipShape:
Surface(shape = ChipShape, color = QCSurfaceVariant, modifier = Modifier.padding(horizontal = 16.dp)) {
    TabRow(selectedTabIndex = selectedTab, containerColor = Color.Transparent, indicator = {}) {
        // tabs with custom selected state
    }
}
```

For each estimate card — add left border using status color:
```kotlin
val statusColor = when (estimate.status?.lowercase()) {
    "approved", "pushed_to_zoho" -> QCGreen
    "rejected"                   -> QCError
    "payment_submitted", "payment_recorded" -> QCGold
    else                         -> QCTextTertiary
}
Card(shape = CardShape, ...) {
    Row {
        Box(Modifier.width(4.dp).fillMaxHeight().background(statusColor))
        // rest of card content
    }
}
```

- [ ] **Step 3: PointsHistoryScreen.kt — pool filter chips + grouped by month**

Add filter chip row at the top:
```kotlin
var poolFilter by remember { mutableStateOf<String?>(null) }
LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
    val options = listOf(null to "All", "regular" to "Regular", "annual" to "Annual")
    items(options) { (value, label) ->
        FilterChip(
            selected = poolFilter == value,
            onClick = { poolFilter = value },
            label = { Text(label) },
            colors = FilterChipDefaults.filterChipColors(selectedContainerColor = QCGreen, selectedLabelColor = Color.White),
        )
    }
}
```

Each transaction row — color the amount green for credit, red for debit:
```kotlin
val amtColor = if ((tx.amount ?: 0.0) >= 0) QCGreen else QCError
Text("${if ((tx.amount ?: 0.0) >= 0) "+" else ""}${fmt(tx.amount)}", color = amtColor, fontWeight = FontWeight.SemiBold)
```

- [ ] **Step 4: EditProfileScreen.kt — add missing fields**

After existing fields (name, email), add:

```kotlin
// Specialization dropdown
var specExpanded by remember { mutableStateOf(false) }
val specOptions = listOf("Both", "Interior", "Exterior", "Industrial")
ExposedDropdownMenuBox(expanded = specExpanded, onExpandedChange = { specExpanded = it }) {
    OutlinedTextField(
        value = state.specialization ?: "Both",
        onValueChange = {},
        readOnly = true,
        label = { Text("Specialization") },
        trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(specExpanded) },
        modifier = Modifier.fillMaxWidth().menuAnchor(),
        shape = CardShape,
    )
    ExposedDropdownMenu(expanded = specExpanded, onDismissRequest = { specExpanded = false }) {
        specOptions.forEach { opt ->
            DropdownMenuItem(text = { Text(opt) }, onClick = {
                viewModel.updateSpecialization(opt)
                specExpanded = false
            })
        }
    }
}
Spacer(Modifier.height(12.dp))

// Experience years
OutlinedTextField(
    value = state.experienceYears?.toString() ?: "",
    onValueChange = { viewModel.updateExperience(it.toIntOrNull()) },
    label = { Text("Experience (years)") },
    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
    modifier = Modifier.fillMaxWidth(),
    shape = CardShape,
)
Spacer(Modifier.height(12.dp))

// District
OutlinedTextField(
    value = state.district ?: "",
    onValueChange = { viewModel.updateDistrict(it) },
    label = { Text("District") },
    modifier = Modifier.fillMaxWidth(),
    shape = CardShape,
)
Spacer(Modifier.height(12.dp))

// Pincode
OutlinedTextField(
    value = state.pincode ?: "",
    onValueChange = { if (it.length <= 6) viewModel.updatePincode(it) },
    label = { Text("Pincode") },
    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
    modifier = Modifier.fillMaxWidth(),
    shape = CardShape,
)
```

**Note:** If `viewModel.updateSpecialization()`, `updateExperience()`, `updateDistrict()`, `updatePincode()` methods don't exist — read `EditProfileViewModel.kt` and use the existing update pattern (e.g., `viewModel.updateField("specialization", opt)`). If the state doesn't have these fields, use `remember { mutableStateOf("") }` local state and include in the save payload.

- [ ] **Step 5: NotificationsScreen.kt — type-colored left border**

For each notification card, add left border based on type:
```kotlin
val borderColor = when {
    notif.type?.contains("point", ignoreCase = true) == true   -> QCGreen
    notif.type?.contains("offer", ignoreCase = true) == true   -> QCGold
    notif.type?.contains("estimate", ignoreCase = true) == true -> InfoBlue
    notif.type?.contains("withdraw", ignoreCase = true) == true -> WarningAmber
    else -> QCBorderLight
}
Card(shape = CardShape, colors = CardDefaults.cardColors(if (notif.isRead == true) QCSurfaceVariant else Color.White)) {
    Row {
        Box(Modifier.width(4.dp).fillMaxHeight().background(borderColor))
        Column(Modifier.padding(12.dp).weight(1f)) {
            Text(notif.title ?: "", fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
            Text(notif.body ?: "", fontSize = 12.sp, color = QCTextSecondary, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
    }
}
```

- [ ] **Step 6: Build all to verify**

```bash
./gradlew :app:compileDebugKotlin --quiet 2>&1 | grep -E "error:" | head -20
```

Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/ui/profile/ \
        app/src/painter/java/com/qcpaintshop/painter/ui/work/ \
        app/src/painter/java/com/qcpaintshop/painter/ui/notifications/
git commit -m "feat(polish): profile hero, work status borders, points filter, edit profile fields, notification borders"
```

---

## Task 7: Version Bump

**Files:**
- Modify: `app/build.gradle.kts`

- [ ] **Step 1: Update version in build.gradle.kts**

Find the `versionCode` and `versionName` lines in `app/build.gradle.kts` and update:

```kotlin
versionCode = 12
versionName = "3.0.0"
```

- [ ] **Step 2: Build release APK to verify**

```bash
cd "D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\qcpaintshop-android"
./gradlew :app:assemblePainterRelease 2>&1 | tail -10
```

Expected: `BUILD SUCCESSFUL`

- [ ] **Step 3: Commit**

```bash
git add app/build.gradle.kts
git commit -m "chore: bump painter app to v3.0.0 (versionCode 12)"
```

---

## Execution Order

Tasks **1 must complete first**. Then **2, 3, 4, 5, 6 can all run in parallel** (different files). Task **7 last** after all screens compile.
