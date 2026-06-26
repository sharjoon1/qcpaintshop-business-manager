# QC Painter v5.0 — Phase 1 (Design Tokens + Premium Home) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the Quiet-Luxury premium refresh of the painter Home screen + design tokens (a v5.0 vc44 APK), without touching billing/points logic (Phases 2–4).

**Architecture:** Additive token + component work in the painter flavor only. New pure helpers (BriefingSegment, VariantSelector) are TDD'd as JVM tests in `app/src/testPainter/`. Visual composables are built and verified via `assemblePainterDebug`. Existing Home composables are restyled in place (no feature removal).

**Tech Stack:** Kotlin, Jetpack Compose (Material 3), Hilt, junit + mockk + kotlin-test (JVM), Robolectric 4.13 (sdk=34 pin).

## Global Constraints (painter Android — from spec + codebase)

- Painter flavor only: `app/src/painter/java/com/qcpaintshop/painter/`. Never touch staff/customer/main flavors.
- **Brand colours locked:** `QCGreen #1B5E3B`, `QCGold #D4A24E` (gold = earnings only). AP accent = existing `QCOfferOrange #E65100`.
- **Outdoor contrast:** depth via gradients + soft shadows only — **no blur/glassmorphism.**
- **Light-only:** `android:forceDarkAllowed=false` stays. No dark scheme.
- **BuildConfig namespace:** use `com.qcpaintshop.act.BuildConfig` in painter (not `com.qcpaintshop.painter.BuildConfig`) — see project memory.
- **Robolectric ceiling:** JVM tests that need Android run under `app/src/testPainter/` with `resources/robolectric.properties` `sdk=34` (app targetSdk=35 > Robolectric 4.13 cap). Pure-logic tests need no Robolectric.
- **Baseline must be clean:** before Phase-1 baseline build, run `./gradlew :app:assemblePainterDebug --no-build-cache` (or `clean`) — Gradle Kotlin build cache can hide real errors (project memory).
- **Do not bump versionCode in this plan** (release gating is a separate step / the painter-android-audit skill). Current painter = vc43 / 4.1.2.
- Tamil strings via `stringResource`; greetings must not use வணக்கம் (project memory).
- Money uses `Math.round(x*100)/100`; tabular figures (`fontFeatureSettings = "tnum"`) on all numeric displays.

---

## File Structure

**Create:**
- `app/src/painter/.../ui/theme/Gradients.kt` — hero gradient brush + scrim brushes + `Modifier.qcHeroBackground()` / `Modifier.qcSoftShadow()`.
- `app/src/painter/.../ui/home/BriefingSegment.kt` — pure `briefingSegment(hour: Int): BriefingSegment` mapper.
- `app/src/painter/.../ui/components/VariantSelector.kt` — pure `VariantSelectorState` + `VariantPriceChipRow` composable.
- `app/src/testPainter/java/com/qcpaintshop/painter/ui/home/BriefingSegmentTest.kt`
- `app/src/testPainter/java/com/qcpaintshop/painter/ui/components/VariantSelectorTest.kt`

**Modify:**
- `app/src/painter/.../ui/theme/Color.kt` — add scrim + depth-tint aliases.
- `app/src/painter/.../ui/theme/Type.kt` — add `tnum` fontFeatureSettings to numeric styles.
- `app/src/painter/.../ui/theme/Shape.kt` — `SheetShape` 20→28dp.
- `app/src/painter/.../ui/theme/Elevations.kt` — add `heroElevation`.
- `app/src/painter/.../ui/home/components/BalanceCards.kt` — add 3rd **AP** tile; restyle into continuous-header tiles.
- `app/src/painter/.../ui/home/components/BriefingCard.kt` — use `BriefingSegment` to drive the time-aware headline.
- `app/src/painter/.../ui/home/HomeScreen.kt` — continuous green header; insert a **Catalog carousel** using `VariantPriceChipRow`.
- `app/src/painter/.../ui/home/HomeViewModel.kt` + `HomeUiState` — expose `attendancePoints` / `claimableApPreview` from the existing dashboard response (verify field; see Task 4).

---

### Task 1: Design tokens — gradients, scrims, depth, tabular figures

**Files:**
- Create: `app/src/painter/java/com/qcpaintshop/painter/ui/theme/Gradients.kt`
- Modify: `app/src/painter/java/com/qcpaintshop/painter/ui/theme/Color.kt`, `Type.kt`, `Shape.kt`, `Elevations.kt`
- Test: build verification (JVM token test where meaningful)

**Interfaces:**
- Produces: `val QCHeroGradient: Brush`, `fun Modifier.qcHeroBackground(): Modifier`, `fun Modifier.qcSoftShadow(elevationDp: Int): Modifier`, `val QCSurfaceRaised/QCSurfaceSunken: Color`, `Elevations.heroElevation`.

- [ ] **Step 1: Add scrim + depth-tint colours to Color.kt**

Append after the Surfaces block (Color.kt ~L19):
```kotlin
// v5 hero depth tints (aliases — light-only, outdoor-safe; no blur)
val QCSurfaceRaised  = QCSurface        // white cards
val QCSurfaceSunken  = QCBackground      // recessed screen bg behind cards
val QCHeroScrimGreen = Color(0x33000000) // bottom-up dark scrim for text over photography
val QCHeroScrimDark  = Color(0x99000000)
```

- [ ] **Step 2: Create Gradients.kt with hero brush + modifiers**

`app/src/painter/java/com/qcpaintshop/painter/ui/theme/Gradients.kt`:
```kotlin
package com.qcpaintshop.painter.ui.theme

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

/** Quiet-luxury hero gradient: multi-stop green with gold + green radial glows. */
val QCHeroGradient = Brush.linearGradient(
    colors = listOf(Color(0xFF1F6B44), QCGreen, Color(0xFF14482D), QCGreenDarkest),
)

/** Green-tinted soft shadow (no blur layer — keeps outdoor contrast). */
fun Modifier.qcSoftShadow(elevationDp: Int = 8): Modifier =
    this.shadow(elevation = elevationDp.dp, shape = HeroShape, clip = false)
        .shadow(elevation = (elevationDp / 2).dp, shape = HeroShape, clip = false)
```
(Note: `qcHeroBackground` is applied as `Modifier.background(QCHeroGradient)` at call sites; no wrapper needed — YAGNI.)

- [ ] **Step 3: Tabular figures on numeric Typography styles**

In Type.kt, add `fontFeatureSettings = "tnum"` to the styles used for money/points: `displayLarge`, `headlineLarge`, `titleLarge`, `titleMedium`. Example change on `displayLarge`:
```kotlin
displayLarge = TextStyle(color = QCTextPrimary, fontFamily = InterFontFamily,
    fontWeight = FontWeight.Bold, fontSize = 32.sp, lineHeight = 40.sp,
    letterSpacing = (-0.25).sp, fontFeatureSettings = "tnum"),
```
Repeat the `fontFeatureSettings = "tnum"` addition on the 4 listed styles only.

- [ ] **Step 4: SheetShape 20→28dp; heroElevation token**

In Shape.kt: `val SheetShape = RoundedCornerShape(topStart = 28.dp, topEnd = 28.dp)`.
In Elevations.kt add inside `object Elevations`: `val hero = 10.dp`.

- [ ] **Step 5: Build-verify (compile is the gate for token work)**

Run: `./gradlew :app:assemblePainterDebug` (run `:app:clean` first if cache is stale).
Expected: BUILD SUCCESSFUL. If `e: Unresolved reference: Brush/shadow` → add the imports shown above.

- [ ] **Step 6: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/ui/theme/
git commit -m "feat(painter v5): design tokens — hero gradient, scrims, tabular figures, hero elevation"
```

---

### Task 2: VariantSelector — pure helper + chip-row composable (TDD)

A reusable selector: given a list of `PackSize` variants and a selected index, exposes the selected price + points; UI is chips → single selected price (spec §6.2/6.4).

**Files:**
- Create: `app/src/painter/java/com/qcpaintshop/painter/ui/components/VariantSelector.kt`
- Test: `app/src/testPainter/java/com/qcpaintshop/painter/ui/components/VariantSelectorTest.kt`

**Interfaces:**
- Produces: `class VariantSelectorState(variants: List<PackSize>)` with `selectedIndex: Int`, `selected: PackSize?`, `select(index: Int)`, `selectedPrice: Double?`, `selectedPoints: Double?`; `@Composable fun VariantPriceChipRow(state: VariantSelectorState, modifier: Modifier)`.

- [ ] **Step 1: Write the failing test (pure JVM, kotlin-test)**

`app/src/testPainter/java/com/qcpaintshop/painter/ui/components/VariantSelectorTest.kt`:
```kotlin
package com.qcpaintshop.painter.ui.components

import com.qcpaintshop.painter.data.remote.api.PackSize
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class VariantSelectorTest {
    private fun ps(id: Int, size: String, rate: Double, reg: Double, ann: Double) =
        PackSize(packSizeId = id, size = size, unit = "L", rate = rate, stock = 1.0,
            mrp = rate * 1.2, regularPoints = reg, annualPoints = ann)

    private val variants = listOf(
        ps(1, "1", 650.0, 130.0, 13.0),
        ps(2, "4", 1890.0, 378.0, 38.0),
        ps(3, "10", 3990.0, 798.0, 80.0),
    )

    @Test fun selects_first_by_default_and_exposes_price_points() {
        val s = VariantSelectorState(variants)
        assertEquals(0, s.selectedIndex)
        assertEquals(650.0, s.selectedPrice)
        assertEquals(130.0, s.selectedPoints)
    }

    @Test fun selecting_index_updates_price_and_points() {
        val s = VariantSelectorState(variants)
        s.select(2)
        assertEquals(2, s.selectedIndex)
        assertEquals(3990.0, s.selectedPrice)
        assertEquals(798.0, s.selectedPoints)
    }

    @Test fun empty_variants_yield_null_selected() {
        val s = VariantSelectorState(emptyList())
        assertNull(s.selected)
        assertNull(s.selectedPrice)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew :app:testPainterUnitTest --tests "com.qcpaintshop.painter.ui.components.VariantSelectorTest"`
Expected: FAIL (VariantSelectorState unresolved).

- [ ] **Step 3: Implement VariantSelectorState + VariantPriceChipRow**

`app/src/painter/java/com/qcpaintshop/painter/ui/components/VariantSelector.kt`:
```kotlin
package com.qcpaintshop.painter.ui.components

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.qcpaintshop.painter.data.remote.api.PackSize
import com.qcpaintshop.painter.ui.theme.QCGreen
import com.qcpaintshop.painter.ui.theme.QCSurfaceVariant

/** Pure selection state over a product's pack-size variants. */
class VariantSelectorState(val variants: List<PackSize>) {
    var selectedIndex: Int by mutableStateOf(if (variants.isEmpty()) -1 else 0)
        private set

    val selected: PackSize? get() = variants.getOrNull(selectedIndex)
    val selectedPrice: Double? get() = selected?.rate
    val selectedPoints: Double? get() = selected?.regularPoints

    fun select(index: Int) {
        if (index in variants.indices) selectedIndex = index
    }
}

/** Chips → single selected price row. The displayed price reflects only the selected variant. */
@Composable
fun VariantPriceChipRow(state: VariantSelectorState, modifier: Modifier = Modifier) {
    Row(modifier) {
        state.variants.forEachIndexed { i, v ->
            val sel = i == state.selectedIndex
            Surface(
                shape = RoundedCornerShape(8.dp),
                color = if (sel) QCGreen else QCSurfaceVariant,
                onClick = { state.select(i) },
                modifier = Modifier.padding(end = 6.dp),
            ) {
                Text(
                    text = "${v.size ?: ""}${v.unit ?: ""}",
                    color = if (sel) QCSurfaceVariant else QCGreen,
                    modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp),
                )
            }
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./gradlew :app:testPainterUnitTest --tests "com.qcpaintshop.painter.ui.components.VariantSelectorTest"`
Expected: 3 tests PASS.

- [ ] **Step 5: Build-verify the composable compiles**

Run: `./gradlew :app:assemblePainterDebug`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 6: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/ui/components/VariantSelector.kt \
        app/src/testPainter/java/com/qcpaintshop/painter/ui/components/VariantSelectorTest.kt
git commit -m "feat(painter v5): VariantSelector — variant chips drive a single selected price (TDD)"
```

---

### Task 3: BriefingSegment time-aware mapper + BriefingCard refresh (TDD)

The Daily Briefing card headline changes by time of day (spec §4).

**Files:**
- Create: `app/src/painter/java/com/qcpaintshop/painter/ui/home/BriefingSegment.kt`
- Modify: `app/src/painter/java/com/qcpaintshop/painter/ui/home/components/BriefingCard.kt` (use the mapper for the headline)
- Test: `app/src/testPainter/java/com/qcpaintshop/painter/ui/home/BriefingSegmentTest.kt`

**Interfaces:**
- Produces: `enum class BriefingSegment { Morning, Midday, Evening, Night }`, `fun briefingSegment(hour24: Int): BriefingSegment`.

- [ ] **Step 1: Write the failing test**

`app/src/testPainter/java/com/qcpaintshop/painter/ui/home/BriefingSegmentTest.kt`:
```kotlin
package com.qcpaintshop.painter.ui.home

import com.qcpaintshop.painter.ui.home.BriefingSegment.*
import kotlin.test.Test
import kotlin.test.assertEquals

class BriefingSegmentTest {
    @Test fun morning_is_5_to_11() {
        listOf(5, 8, 10, 11).forEach { assertEquals(Morning, briefingSegment(it), "hour=$it") }
    }
    @Test fun midday_is_12_to_16() {
        listOf(12, 14, 16).forEach { assertEquals(Midday, briefingSegment(it), "hour=$it") }
    }
    @Test fun evening_is_17_to_21() {
        listOf(17, 19, 21).forEach { assertEquals(Evening, briefingSegment(it), "hour=$it") }
    }
    @Test fun night_wraps_late_and_early() {
        listOf(0, 2, 4, 22, 23).forEach { assertEquals(Night, briefingSegment(it), "hour=$it") }
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./gradlew :app:testPainterUnitTest --tests "com.qcpaintshop.painter.ui.home.BriefingSegmentTest"`
Expected: FAIL (unresolved).

- [ ] **Step 3: Implement the mapper**

`app/src/painter/java/com/qcpaintshop/painter/ui/home/BriefingSegment.kt`:
```kotlin
package com.qcpaintshop.painter.ui.home

enum class BriefingSegment { Morning, Midday, Evening, Night }

/** Maps an hour (0–23, server/IST local) to a Daily-Briefing time segment. */
fun briefingSegment(hour24: Int): BriefingSegment = when (hour24) {
    in 5..11   -> BriefingSegment.Morning
    in 12..16  -> BriefingSegment.Midday
    in 17..21  -> BriefingSegment.Evening
    else       -> BriefingSegment.Night
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./gradlew :app:testPainterUnitTest --tests "com.qcpaintshop.painter.ui.home.BriefingSegmentTest"`
Expected: 4 tests PASS.

- [ ] **Step 5: Wire BriefingCard headline to the segment**

In `BriefingCard.kt`, derive the headline from `briefingSegment(LocalTime.now().hour)` and existing briefing data:
- Morning → "☀️ Check in to extend your streak" (or `briefing.message` if present)
- Midday → "⏰ ${briefing.dailyBonus?.hoursLeft ?: 4}h left on today's 2× bonus"
- Evening → "💰 Today you earned ₹${earnedToday} / +${ptsToday} pts"
- Night → show `briefing.message` default

Keep all existing briefing fields rendered (bonus, tips, estimate/withdrawal updates) — only the headline becomes segment-driven. Use `QCHeroGradient`/tabular figures where numbers appear.

- [ ] **Step 6: Build-verify**

Run: `./gradlew :app:assemblePainterDebug`
Expected: BUILD SUCCESSFUL.

- [ ] **Step 7: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/ui/home/ \
        app/src/testPainter/java/com/qcpaintshop/painter/ui/home/BriefingSegmentTest.kt
git commit -m "feat(painter v5): Daily-Briefing time-segment mapper + segment-driven headline (TDD)"
```

---

### Task 4: Home hero — continuous green header + Regular/Annual/AP point tiles

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/ui/home/HomeScreen.kt`, `HomeViewModel.kt` (+ `HomeUiState`), `ui/home/components/BalanceCards.kt`
- Test: build + smoke (visual)

**Interfaces:**
- Consumes: `QCHeroGradient`, `qcSoftShadow`, tabular-figure Type styles (Task 1).
- Produces: `HomeUiState.attendancePoints: Int?` and `HomeUiState.claimableApPreview: Int?` (wired from the existing dashboard response field).

- [ ] **Step 1: Verify the dashboard AP field name**

Read `HomeViewModel.kt` + the dashboard response data class (search `claimable_ap` / `attendance`). Confirm the field that carries AP / claimable preview. If named `claimable_ap_preview`, use it; otherwise use the verified name. (Do not assume — read first.)

- [ ] **Step 2: Expose AP in HomeUiState + HomeViewModel**

Add to `HomeUiState`: `val attendancePoints: Int = 0`, `val claimableApPreview: Int = 0`. Populate both in `HomeViewModel.loadDashboard()` from the dashboard response field found in Step 1 (default 0 if absent — graceful).

- [ ] **Step 3: Make the hero a continuous green header (no seam)**

In `HomeScreen.kt`, replace the floating `HeroCard` block (the section that currently sits with side padding on `QCBackground`) with a single full-bleed `Box(Modifier.background(QCHeroGradient))` whose rounded bottom corners (`RoundedCornerShape(bottomStart=26.dp, bottomEnd=26.dp)`) curve into the content. Status-bar green is already set by `QCPainterTheme`. Move the greeting/avatar/level INSIDE this header so there is no light strip between status bar and hero.

- [ ] **Step 4: Three point tiles — Regular / Annual / AP**

Update `BalanceCards` (currently Regular/Annual/lifetime) to render three tiles in a row:
- REGULAR (gold) — `regularPoints`
- ANNUAL (gold) — `annualPoints`
- AP (apricot = `QCOfferOrange`) — `attendancePoints`, sub-label "claim ₹{claimableApPreview} this month"
Lifetime + ₹earned stays as the caption row beneath. Use tabular figures. Place `BalanceCards` inside the green header (on-dark variant — use `QCGold`/`QCOfferOrange` text + translucent tile backgrounds `Color(0x1A000000)`).

- [ ] **Step 5: Build-verify + manual smoke**

Run: `./gradlew :app:assemblePainterDebug`
Expected: BUILD SUCCESSFUL.
Smoke (engineer): install debug APK, open Home — header is one continuous green block (no seam), 3 point tiles show with AP in apricot, gold numbers are tabular-aligned. (Owner does the live check later.)

- [ ] **Step 6: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/ui/home/
git commit -m "feat(painter v5): continuous green hero header + Regular/Annual/AP point tiles"
```

---

### Task 5: Home — Catalog carousel (variant chips) + Offers refresh

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/ui/home/HomeScreen.kt`
- Create: `app/src/painter/java/com/qcpaintshop/painter/ui/home/components/CatalogCarousel.kt`
- Consumes: `VariantSelectorState` / `VariantPriceChipRow` (Task 2)
- Test: build + smoke

- [ ] **Step 1: Create CatalogCarousel composable**

`CatalogCarousel.kt`: a horizontally-scrolling row of product cards. Each card takes a product (name, brand, a list of `PackSize` variants, a colour-swatch brush derived from `PackSize.colorCode`). Each card holds its own `remember { VariantSelectorState(packSizes) }`, renders the swatch, name, brand, a `VariantPriceChipRow`, and a single price line `₹${state.selectedPrice}` + `+${state.selectedPoints} pts`. Use the existing paint-colour swatch approach (swatch background from `colorCode`).

- [ ] **Step 2: Wire catalog products into HomeViewModel**

Confirm the dashboard (or a catalog endpoint already called on Home) returns a small set of featured products with their `PackSize` list. Expose as `HomeUiState.catalogProducts: List<ProductSummary>` (verify the existing model; reuse, don't duplicate). If no such field exists, derive the carousel from the top items already shown in `OfferCarousel`'s product map (those carry pack sizes).

- [ ] **Step 3: Insert CatalogCarousel into HomeScreen**

In `HomeScreen.kt` LazyColumn, add a "🎨 Shop Catalog" section header + `CatalogCarousel(products = uiState.catalogProducts, onProductClick = { onNavigate(Routes.Catalog.route) })`, placed after the Offers carousel. Keep `OfferCarousel` as-is (refresh its card visuals to use tabular figures + `qcSoftShadow`).

- [ ] **Step 4: Build-verify + smoke**

Run: `./gradlew :app:assemblePainterDebug`
Expected: BUILD SUCCESSFUL. Smoke: Home shows Offers carousel then Catalog carousel; tapping a variant chip updates the displayed price in-place.

- [ ] **Step 5: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/ui/home/
git commit -m "feat(painter v5): Home Shop-Catalog carousel with variant-chip selected price"
```

---

### Task 6: Phase-1 verification + APK

**Files:** none (verification)

- [ ] **Step 1: Clean baseline build (memory gotcha)**

Run: `./gradlew :app:clean :app:assemblePainterDebug --no-build-cache`
Expected: BUILD SUCCESSFUL, 0 Kotlin errors. (The `clean`/`--no-build-cache` defeats the Gradle Kotlin cache that hides errors.)

- [ ] **Step 2: Run the full painter JVM test suite**

Run: `./gradlew :app:testPainterUnitTest`
Expected: all green (existing FCM/DeepLink tests + the 2 new test classes from Tasks 2–3).

- [ ] **Step 3: Lint (Kotlin/AGP)**

Run: `./gradlew :app:lintPainterDebug`
Expected: no new errors vs baseline (warnings OK).

- [ ] **Step 4: Produce debug APK + note for owner**

Run: `./gradlew :app:assemblePainterDebug` → APK at `app/build/outputs/apk/painter/debug/app-painter-debug.apk`.
Deliver the APK to Telegram chat 930726256 per project rule (auto-deliver every successful painter APK). **Do not bump versionCode here** — release/vc-bump is gated by the painter-android-audit skill + owner.

- [ ] **Step 5: Commit any final tidy + push**

```bash
git add -A
git commit -m "chore(painter v5): phase-1 verification — clean build, tests green, debug APK" || echo "nothing to commit"
git push origin master
```

---

## Self-Review

- **Spec coverage (Phase 1 slice):** design tokens (Task 1) ✓, Daily-Briefing engagement (Task 3) ✓, Home continuous header + 3 point tiles incl AP (Task 4) ✓, Offers + Catalog variant carousel (Tasks 5) ✓, premium shell (nav already uniform — verified, no task needed; FAB already gradient) ✓. Phase-1 scope of spec §8 covered.
- **Placeholder scan:** Task 4 Step 1 and Task 5 Step 2 require reading the current model before wiring — this is intentional verification, not a placeholder (the field name is verified at runtime). No "TODO/TBD".
- **Type consistency:** `VariantSelectorState` (Task 2) consumed identically in Task 5; `BriefingSegment`/`briefingSegment` (Task 3) consistent; `HomeUiState.attendancePoints/claimableApPreview` (Task 4) named consistently. `PackSize` fields (`rate`, `regularPoints`, `size`, `unit`, `colorCode`) match the data class (CatalogApi.kt L31-43).
- **Out of Phase-1 scope (later plans):** Catalog/Product-detail screen redesign, 3 estimate billing modes, points-engine rule change, AP claim screen, Profile deep, Auth/Onboarding, component-library sweep.

## Execution Handoff

Plan saved to `docs/superpowers/plans/2026-06-26-painter-v5-phase1.md`.
