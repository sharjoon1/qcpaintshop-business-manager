# Painter Android v3.0.0 Sub-project 2 — Withdrawal Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop the painter v3.0.0 WIP compile error count from 36 to 27 by wiring the withdrawal workflow on `HomeViewModel` — 3 UiState fields, 1 constructor dep, 2 methods, all in a single file.

**Architecture:** Single-file VM extension. Reuses the existing `PointsApi.withdraw()` + `WithdrawRequest` DTO. No new DTOs, no new API methods, no new screens, no backend work.

**Tech Stack:** Kotlin 2.x, Hilt DI, Retrofit 2, Kotlin coroutines + StateFlow. Build via `./gradlew :app:compilePainterReleaseKotlin --no-daemon`.

**Approved spec:** `docs/superpowers/specs/2026-04-18-painter-android-v3-withdrawal-design.md` (commit `45bc352`).

**Target repo/branch:** `D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\qcpaintshop-android` on `audit/2026-04-17` (continues from commit `0563768`).

---

## File Structure

Single file modified:

| File | Change | Net lines |
|---|---|---|
| `app/src/painter/java/com/qcpaintshop/painter/ui/home/HomeViewModel.kt` | +3 `HomeUiState` fields, +1 constructor dep (`PointsApi`), +2 methods (`submitWithdrawal`, `clearWithdrawalMessages`) | +~35 |

No other files. No tests (painter flavor has no harness).

---

## Strategy

Gradle compile is the test. Probe after each task. The one command:

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  ./gradlew :app:compilePainterReleaseKotlin --no-daemon 2>&1 | grep -cE '^e: ' )
```

Starting count: **36**.

---

## Task 1: Add 3 withdrawal fields to HomeUiState

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/ui/home/HomeViewModel.kt` (HomeUiState data class only)

- [ ] **Step 1: Read the existing HomeUiState**

Locate the `data class HomeUiState(` block. Current shape ends with:
```kotlin
    val showWithdrawalSheet: Boolean = false,
    val showStreakSheet: Boolean = false,
    val showLevelPanel: Boolean = false,
)
```
(exact line varies — find by searching for `showLevelPanel`.)

- [ ] **Step 2: Add 3 fields before the closing paren**

Use Edit tool. Find:
```kotlin
    val showWithdrawalSheet: Boolean = false,
    val showStreakSheet: Boolean = false,
    val showLevelPanel: Boolean = false,
)
```

Replace with:
```kotlin
    val showWithdrawalSheet: Boolean = false,
    val showStreakSheet: Boolean = false,
    val showLevelPanel: Boolean = false,

    // Withdrawal workflow
    val withdrawalLoading: Boolean = false,
    val withdrawalError: String? = null,
    val withdrawalSuccess: String? = null,
)
```

- [ ] **Step 3: Compile probe**

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  ./gradlew :app:compilePainterReleaseKotlin --no-daemon 2>&1 | grep -cE '^e: ' )
```

Expected: `33` (36 − 3 unresolved state-field errors in HomeScreen.kt: `withdrawalLoading` at 256, `withdrawalError` at 257, `withdrawalSuccess` at 224/236). The method-related errors (at 230, 258) remain until Task 2.

If the drop is less than 3 or more than 5, investigate — may indicate a second reference we missed or a new field name collision.

- [ ] **Step 4: Commit**

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  git add app/src/painter/java/com/qcpaintshop/painter/ui/home/HomeViewModel.kt && \
  git commit -m "feat(painter): HomeUiState — withdrawalLoading/error/success fields" )
```

---

## Task 2: Add PointsApi dep + submitWithdrawal + clearWithdrawalMessages

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/ui/home/HomeViewModel.kt` (constructor + methods)

- [ ] **Step 1: Read the current constructor**

Current form (approximately):
```kotlin
@HiltViewModel
class HomeViewModel @Inject constructor(
    private val dashboardRepository: DashboardRepository,
    private val userPreferences: UserPreferences,
    private val catalogApi: CatalogApi,
    private val workApi: WorkApi,
) : ViewModel() {
```

- [ ] **Step 2: Add PointsApi to constructor**

Use Edit tool. Find the exact 6-line block above and replace with:

```kotlin
@HiltViewModel
class HomeViewModel @Inject constructor(
    private val dashboardRepository: DashboardRepository,
    private val userPreferences: UserPreferences,
    private val catalogApi: CatalogApi,
    private val workApi: WorkApi,
    private val pointsApi: PointsApi,
) : ViewModel() {
```

No new imports needed — `PointsApi` lives in `com.qcpaintshop.painter.data.remote.api.*` which is already wildcard-imported at the top of the file. Similarly `WithdrawRequest` (used in Step 3) comes from the same wildcard import.

Hilt already binds `PointsApi` via `@Provides fun providePointsApi(...)` in `di/AppModule.kt` — no module change needed.

- [ ] **Step 3: Add the 2 new methods before `calculateLevel`**

Locate the existing `private fun calculateLevel(level: String, points: Int): Triple<String, Float, Int>` method. Insert the two new methods immediately before it.

Use Edit tool. Find:
```kotlin
    fun toggleLevelPanel(show: Boolean) {
        _uiState.update { it.copy(showLevelPanel = show) }
    }

    private fun calculateLevel(level: String, points: Int): Triple<String, Float, Int> {
```

Replace with:
```kotlin
    fun toggleLevelPanel(show: Boolean) {
        _uiState.update { it.copy(showLevelPanel = show) }
    }

    fun submitWithdrawal(pool: String, amount: Double) {
        viewModelScope.launch {
            _uiState.update {
                it.copy(
                    withdrawalLoading = true,
                    withdrawalError = null,
                    withdrawalSuccess = null,
                )
            }
            try {
                val resp = pointsApi.withdraw(WithdrawRequest(pool, amount))
                val body = resp.body()
                if (resp.isSuccessful && body?.success == true) {
                    _uiState.update {
                        it.copy(
                            withdrawalLoading = false,
                            withdrawalSuccess = body.message ?: "Withdrawal requested",
                            showWithdrawalSheet = false,
                        )
                    }
                    loadAll()
                } else {
                    _uiState.update {
                        it.copy(
                            withdrawalLoading = false,
                            withdrawalError = body?.message ?: "Withdrawal failed",
                        )
                    }
                }
            } catch (e: Exception) {
                _uiState.update {
                    it.copy(
                        withdrawalLoading = false,
                        withdrawalError = e.message ?: "Network error",
                    )
                }
            }
        }
    }

    fun clearWithdrawalMessages() {
        _uiState.update { it.copy(withdrawalSuccess = null, withdrawalError = null) }
    }

    private fun calculateLevel(level: String, points: Int): Triple<String, Float, Int> {
```

**Notes:**
- `WithdrawRequest(pool, amount)` — existing data class in `PointsApi.kt:23-26`, takes `(val pool: String, val amount: Double)`.
- `pointsApi.withdraw(...)` — existing method in `PointsApi.kt:36-37`, returns `Response<GenericResponse>`.
- `GenericResponse` has `val success: Boolean` and `val message: String?` — we read both.
- After success, `showWithdrawalSheet = false` closes the sheet, and `loadAll()` refreshes dashboard balances.

- [ ] **Step 4: Compile probe**

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  ./gradlew :app:compilePainterReleaseKotlin --no-daemon 2>&1 | grep -cE '^e: ' )
```

Expected: `27` (33 − 6 errors: `clearWithdrawalMessages` at 230, `submitWithdrawal` at 258, and 4 cascading references that resolved once the methods exist). Target for this sub-project is 27.

- [ ] **Step 5: Commit**

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  git add app/src/painter/java/com/qcpaintshop/painter/ui/home/HomeViewModel.kt && \
  git commit -m "feat(painter): HomeViewModel — submitWithdrawal + clearWithdrawalMessages wired to PointsApi" )
```

---

## Task 3: Verification

**Files:** none

- [ ] **Step 1: Confirm total drop to 27**

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  ./gradlew :app:compilePainterReleaseKotlin --no-daemon 2>&1 | grep -cE '^e: ' )
```

Expected: **27**.

- [ ] **Step 2: Confirm all 9 HomeScreen withdrawal errors resolved**

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  ./gradlew :app:compilePainterReleaseKotlin --no-daemon 2>&1 | grep -E '^e: ' | \
    grep -c 'HomeScreen.kt' )
```

Expected: `0`. No HomeScreen.kt errors remain.

- [ ] **Step 3: Confirm remaining errors are strictly Sub-project 1**

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  ./gradlew :app:compilePainterReleaseKotlin --no-daemon 2>&1 | grep -E '^e: ' | \
    sed -E 's|.+painter/java/com/qcpaintshop/painter/||; s|\.kt:.*|.kt|' | \
    sort | uniq -c | sort -rn )
```

Expected exactly (or very close to):
```
   15 ui/home/components/StreakSheet.kt
   12 ui/profile/AttendanceCalendarViewModel.kt
```

If any other file shows up (HomeScreen.kt, HomeViewModel.kt, or any CatalogApi/DashboardApi file), investigate — a regression was introduced.

- [ ] **Step 4: Confirm 2 new commits landed**

```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  git log --oneline audit/2026-04-17 ^master | head -5
```

Expected (top two):
```
<sha> feat(painter): HomeViewModel — submitWithdrawal + clearWithdrawalMessages wired to PointsApi
<sha> feat(painter): HomeUiState — withdrawalLoading/error/success fields
0563768 fix(painter): ProductDetailSheet — use .let to avoid smart-cast on computed offer.value
```

- [ ] **Step 5: No commit** — verification only.

---

## Self-review

**Spec coverage:**

| Spec element | Plan task |
|---|---|
| HomeUiState 3 fields (withdrawalLoading/Error/Success) | Task 1 |
| HomeViewModel constructor: +PointsApi dep | Task 2 Step 2 |
| `submitWithdrawal(pool, amount)` with loading/success/error branches + sheet close + loadAll | Task 2 Step 3 |
| `clearWithdrawalMessages()` nulling both messages | Task 2 Step 3 |
| No new DTOs — reuse `WithdrawRequest` | Task 2 notes |
| No new API methods — reuse `pointsApi.withdraw()` | Task 2 notes |
| Success criteria: 36 → 27 errors | Task 3 |
| Post-success UX: sheet closes + snackbar via existing `withdrawalSuccess` observer + full dashboard reload | Task 2 Step 3 |
| Post-failure UX: sheet stays open, error shown inline | Task 2 Step 3 (no `showWithdrawalSheet` mutation in error branches) |

All spec elements mapped. No gaps.

**Placeholder scan:** No TBD/TODO. Every Step shows exact old_string/new_string for Edits, exact commands, exact expected counts.

**Type consistency:**
- `withdrawalLoading: Boolean` — Task 1 defines, Task 2 references via `_uiState.copy(withdrawalLoading = ...)`. Consistent.
- `withdrawalError: String?`, `withdrawalSuccess: String?` — same. Consistent.
- `pointsApi: PointsApi` — Task 2 Step 2 declares, Step 3 uses. Consistent.
- `WithdrawRequest(pool, amount)` — verified in spec notes. Constructor order matches existing PointsApi.kt definition `(val pool: String, val amount: Double)`.
- `body.success`, `body.message` — uses `GenericResponse` which already has these fields (verified in CatalogApi.kt). Consistent.
- `loadAll()` — existing public method on HomeViewModel (same file). Consistent.
- `showWithdrawalSheet` — existing HomeUiState Boolean field (added in earlier data-layer sub-project). Consistent.

Expected error-count progression: 36 → 33 (Task 1) → 27 (Task 2). Sum: −3 + −6 = −9 total, matches target.

---

## Summary

2 code tasks + 1 verification task. Single file. 2 commits. ~35 net lines. Target: 36 → 27 compile errors.

After Task 3, only Sub-project 1 (attendance/streak, 27 errors) remains before the full painter v3.0.0 APK ships.
