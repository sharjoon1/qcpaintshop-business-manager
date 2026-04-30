# Painter Android v3.0.0 Sub-project 1 (Final) — Attendance + Streak Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the final 30 compile errors on the painter v3.0.0 WIP (all in attendance/streak workflow) and produce a clean-building, shippable APK.

**Architecture:** One new API method + 2 DTOs on `AttendanceApi`, one new field on `DashboardData`, 4 additions to `HomeViewModel` (state + dep + method + loadAll mapping), and core-library desugaring enabled in gradle so StreakSheet's `java.time` calls work on minSdk 24. No backend changes. No screen file changes.

**Tech Stack:** Kotlin 2.x, Hilt DI, Retrofit 2, Gson, Jetpack Compose Material3, Gradle 8.11, AGP with core library desugaring. Build via `./gradlew clean :app:assemblePainterRelease --no-daemon`.

**Approved spec:** `docs/superpowers/specs/2026-04-18-painter-android-v3-attendance-streak-design.md` (commit `709d0e8`).

**Target repo/branch:** `D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\qcpaintshop-android` on `audit/2026-04-17` (continues from commit `8570e01`).

---

## File Structure

4 files modified, 4 commits (+ 1 verification task):

| File | Task | Net lines |
|---|---|---|
| `app/src/painter/java/com/qcpaintshop/painter/data/remote/api/AttendanceApi.kt` | Task 1 — + 2 DTOs, + getCheckinHistory method | +25 |
| `app/src/painter/java/com/qcpaintshop/painter/data/remote/api/DashboardApi.kt` | Task 2 — + longestStreak field | +1 |
| `app/src/painter/java/com/qcpaintshop/painter/ui/home/HomeViewModel.kt` | Task 3 — + 2 UiState fields, + attendanceApi dep, + fetchCheckinHistory, + longestStreak mapping in loadAll | +18 |
| `app/build.gradle.kts` | Task 4 — enable coreLibraryDesugaring + dep | +3 |

No screen files modified. Screen code (StreakSheet.kt, AttendanceCalendarViewModel.kt, HomeScreen.kt) already references the symbols this plan provides.

---

## Strategy

Gradle compile is the test. Probe after each task. The one command used throughout:

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  ./gradlew :app:compilePainterReleaseKotlin --no-daemon 2>&1 | grep -cE '^e: ' )
```

Starting count: **30**. Target: **0** by Task 5.

---

## Task 1: Add CheckinDay + CheckinHistoryResponse DTOs + getCheckinHistory method

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/data/remote/api/AttendanceApi.kt`

**Purpose:** StreakSheet and AttendanceCalendarViewModel reference these types and the API method. Adding them resolves 15 + 12 − 3 (3 remaining HomeScreen errors resolve in Task 3) = ~24 errors.

### Step 1: Read the existing file

Current content is short (~22 lines) — one existing DTO (`CheckInRequest`), one response (`TodayAttendanceResponse`), one interface with `checkIn` + `getTodayStatus` methods.

### Step 2: Replace the file with the extended version

Use Edit tool. Find exactly:
```kotlin
package com.qcpaintshop.painter.data.remote.api

import com.google.gson.annotations.SerializedName
import retrofit2.Response
import retrofit2.http.*

data class CheckInRequest(
    val latitude: Double?,
    val longitude: Double?,
)

data class TodayAttendanceResponse(
    val success: Boolean,
    @SerializedName("checked_in") val checkedIn: Boolean?,
    @SerializedName("check_in_time") val checkInTime: String?,
)

interface AttendanceApi {
    @POST("me/attendance/check-in")
    suspend fun checkIn(@Body body: CheckInRequest): Response<GenericResponse>

    @GET("me/attendance/today")
    suspend fun getTodayStatus(): Response<TodayAttendanceResponse>
}
```

Replace with:
```kotlin
package com.qcpaintshop.painter.data.remote.api

import com.google.gson.annotations.SerializedName
import retrofit2.Response
import retrofit2.http.*

data class CheckInRequest(
    val latitude: Double?,
    val longitude: Double?,
)

data class TodayAttendanceResponse(
    val success: Boolean,
    @SerializedName("checked_in") val checkedIn: Boolean?,
    @SerializedName("check_in_time") val checkInTime: String?,
)

data class CheckinDay(
    val date: String?,
    val streak: Int? = null,
    val bonus: Double? = null,
) {
    /** Backend only returns rows for actual check-ins, so a row with a date IS a check-in. */
    val checkedIn: Boolean get() = date != null
}

data class CheckinHistoryResponse(
    val success: Boolean,
    val checkins: List<CheckinDay>? = null,
    val days: List<CheckinDay>? = null,
    val streak: Int? = null,
    val personalBest: Int? = null,
)

interface AttendanceApi {
    @POST("me/attendance/check-in")
    suspend fun checkIn(@Body body: CheckInRequest): Response<GenericResponse>

    @GET("me/attendance/today")
    suspend fun getTodayStatus(): Response<TodayAttendanceResponse>

    @GET("me/checkin-history")
    suspend fun getCheckinHistory(
        @Query("month") month: String,
    ): Response<CheckinHistoryResponse>
}
```

**Notes:**
- `CheckinDay` has a computed `val checkedIn: Boolean get() = date != null`. This matches StreakSheet.kt's `it.checkedIn == true` filter and AttendanceCalendarViewModel.kt's `.filter { it.checkedIn == true }` — every returned row from backend is a check-in.
- `CheckinHistoryResponse` includes both `checkins` AND `days` as nullable lists because AttendanceCalendarViewModel line 74 uses `body.days ?: body.checkins ?: emptyList()`. Backend (`routes/painters.js:872-898`) returns only `checkins`; `days` is an alias slot for future backend extension.
- `streak` and `personalBest` are nullable at the response top level. Backend currently doesn't return them; AttendanceCalendarViewModel has `?: 0` fallbacks on both (lines 86-87).
- `month` path is `YYYY-MM` format. Backend validates this regex at `routes/painters.js:876-878`.

### Step 3: Compile probe

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  ./gradlew :app:compilePainterReleaseKotlin --no-daemon 2>&1 | grep -cE '^e: ' )
```

Expected: significant drop — around `6` (30 − ~24). StreakSheet's 15 errors + AttendanceCalendarViewModel's 12 errors should mostly resolve since both files reference the new types/methods. The remaining errors will be in `HomeScreen.kt` (3 expected) plus possibly a few residual cascades in the two VMs.

If count drops less than 15, investigate — the new DTOs may not match exact screen/VM expectations.

### Step 4: Commit

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  git add app/src/painter/java/com/qcpaintshop/painter/data/remote/api/AttendanceApi.kt && \
  git commit -m "feat(painter): AttendanceApi — CheckinDay + CheckinHistoryResponse DTOs + getCheckinHistory method" )
```

---

## Task 2: Add longestStreak field to DashboardData

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/data/remote/api/DashboardApi.kt`

**Purpose:** `HomeUiState.checkinPersonalBest` (added in Task 3) comes from `dashboard.longestStreak`. Backend `/me/dashboard` already sends `longestStreak: painterLevel[0]?.longest_streak` (verified `routes/painters.js:626`), but the DTO doesn't yet expose it.

### Step 1: Read DashboardApi.kt

Find the closing lines of `DashboardData` — should end with `painterCity: String? = null` (added in SP3-Task 3) followed by `)`.

### Step 2: Insert the field before the closing paren

Use Edit tool. Find exactly:
```kotlin
    val referralCode: String? = null,
    val painterName: String? = null,
    val painterCity: String? = null,
)
```

Replace with:
```kotlin
    val referralCode: String? = null,
    val painterName: String? = null,
    val painterCity: String? = null,
    val longestStreak: Int? = null,
)
```

No `@SerializedName` — backend sends camelCase `longestStreak` verbatim.

### Step 3: Compile probe

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  ./gradlew :app:compilePainterReleaseKotlin --no-daemon 2>&1 | grep -cE '^e: ' )
```

Expected: unchanged from Task 1 (no consumer references `d.longestStreak` yet — Task 3 wires it). If count changed, investigate.

### Step 4: Commit

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  git add app/src/painter/java/com/qcpaintshop/painter/data/remote/api/DashboardApi.kt && \
  git commit -m "feat(painter): DashboardData.longestStreak field from /me/dashboard" )
```

---

## Task 3: Extend HomeViewModel with checkin state + method

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/ui/home/HomeViewModel.kt`

**Purpose:** Close the 3 HomeScreen.kt errors (`checkinPersonalBest`, `checkinDays`, `fetchCheckinHistory`). Four sub-changes: 2 UiState fields, 1 constructor dep (`AttendanceApi`), 1 loadAll mapping line (`longestStreak → checkinPersonalBest`), 1 new method (`fetchCheckinHistory`).

### Step 1: Add 2 fields to HomeUiState

Use Edit tool. Find exactly (the tail of the `data class HomeUiState(` block — the 3 withdrawal fields added in SP2 are followed by the closing paren):
```kotlin
    // Withdrawal workflow
    val withdrawalLoading: Boolean = false,
    val withdrawalError: String? = null,
    val withdrawalSuccess: String? = null,
)
```

Replace with:
```kotlin
    // Withdrawal workflow
    val withdrawalLoading: Boolean = false,
    val withdrawalError: String? = null,
    val withdrawalSuccess: String? = null,

    // Attendance / streak history
    val checkinDays: List<CheckinDay> = emptyList(),
    val checkinPersonalBest: Int = 0,
)
```

`CheckinDay` is accessible via the existing wildcard import `import com.qcpaintshop.painter.data.remote.api.*` (no new import needed).

### Step 2: Add AttendanceApi to constructor

Find exactly:
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

Replace with:
```kotlin
@HiltViewModel
class HomeViewModel @Inject constructor(
    private val dashboardRepository: DashboardRepository,
    private val userPreferences: UserPreferences,
    private val catalogApi: CatalogApi,
    private val workApi: WorkApi,
    private val pointsApi: PointsApi,
    private val attendanceApi: AttendanceApi,
) : ViewModel() {
```

Hilt already binds `AttendanceApi` (used by `AttendanceCalendarViewModel`) — no `AppModule.kt` change needed.

### Step 3: Wire longestStreak → checkinPersonalBest in loadAll

Find the dashboard success block. It currently contains a large `_uiState.update { it.copy(...) }` with many `dashboard.X → state.Y` mappings. The last mapping is likely `referralCode = d.referralCode,` (or similar). Locate the line:

```kotlin
                            referralCode = d.referralCode,
                        )
                    }
                },
```

Replace with:
```kotlin
                            referralCode = d.referralCode,
                            checkinPersonalBest = d.longestStreak ?: 0,
                        )
                    }
                },
```

### Step 4: Add fetchCheckinHistory method

Locate the existing `submitWithdrawal` / `clearWithdrawalMessages` / `toggle*` methods. Place `fetchCheckinHistory` right before the private `calculateLevel` method.

Find exactly:
```kotlin
    fun clearWithdrawalMessages() {
        _uiState.update { it.copy(withdrawalSuccess = null, withdrawalError = null) }
    }

    private fun calculateLevel(level: String, points: Int): Triple<String, Float, Int> {
```

Replace with:
```kotlin
    fun clearWithdrawalMessages() {
        _uiState.update { it.copy(withdrawalSuccess = null, withdrawalError = null) }
    }

    fun fetchCheckinHistory(month: String) {
        viewModelScope.launch {
            try {
                val resp = attendanceApi.getCheckinHistory(month)
                val days = resp.body()?.checkins ?: resp.body()?.days ?: emptyList()
                _uiState.update { it.copy(checkinDays = days) }
            } catch (_: Exception) {}
        }
    }

    private fun calculateLevel(level: String, points: Int): Triple<String, Float, Int> {
```

No loading state (StreakSheet has no loading UI for month transitions).

### Step 5: Compile probe

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  ./gradlew :app:compilePainterReleaseKotlin --no-daemon 2>&1 | grep -cE '^e: ' )
```

Expected: **0** Kotlin compile errors. All 30 targets resolved if:
- Task 1 cleared StreakSheet (15) and AttendanceCalendarViewModel (12)
- Task 3 cleared the 3 HomeScreen errors (`checkinPersonalBest`, `checkinDays`, `fetchCheckinHistory`)

If count is > 0, inspect remaining — they may be cascading type inference issues or a missed reference. Report any errors via the `^e: ` output head.

### Step 6: Commit

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  git add app/src/painter/java/com/qcpaintshop/painter/ui/home/HomeViewModel.kt && \
  git commit -m "feat(painter): HomeViewModel — checkinDays/checkinPersonalBest state + fetchCheckinHistory + longestStreak mapping" )
```

---

## Task 4: Enable core library desugaring for java.time on minSdk 24

**Files:**
- Modify: `app/build.gradle.kts`

**Purpose:** StreakSheet.kt imports `java.time.LocalDate`, `java.time.YearMonth`, `DateTimeFormatter`, `TextStyle`. `minSdk = 24`. Without desugaring these would `NoClassDefFoundError` at runtime on Android 7.0/7.1. After Tasks 1-3 compile succeeds, this task prevents the runtime crash.

### Step 1: Add isCoreLibraryDesugaringEnabled to compileOptions

Use Edit tool. Find exactly (at lines ~74-77):
```kotlin
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
```

Replace with:
```kotlin
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        isCoreLibraryDesugaringEnabled = true
    }
```

### Step 2: Add desugar_jdk_libs dependency

Use Edit tool. Find exactly (last lines of the `dependencies { }` block):
```kotlin
    // ── iText PDF ──
    implementation("com.itextpdf:itext7-core:8.0.4")
}
```

Replace with:
```kotlin
    // ── iText PDF ──
    implementation("com.itextpdf:itext7-core:8.0.4")

    // ── Core library desugaring (enables java.time on minSdk 24) ──
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.0.4")
}
```

### Step 3: Compile probe

Run a quick Kotlin compile to confirm no new errors introduced:
```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  ./gradlew :app:compilePainterReleaseKotlin --no-daemon 2>&1 | grep -cE '^e: ' )
```

Expected: `0`. Gradle may print a banner about desugaring being applied — that's informational, not an error.

### Step 4: Commit

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  git add app/build.gradle.kts && \
  git commit -m "build(painter): enable coreLibraryDesugaring for java.time on minSdk 24" )
```

---

## Task 5: Final verification — clean APK build

**Files:** none modified

**Purpose:** Run the full assemble gate. This is the final compile + dex + resource-merge + APK pack gate for painter v3.0.0.

### Step 1: Kotlin compile probe (should be 0)

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  ./gradlew :app:compilePainterReleaseKotlin --no-daemon 2>&1 | grep -cE '^e: ' )
```

Expected: `0`.

### Step 2: Full clean assemble

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  ./gradlew clean :app:assemblePainterRelease --no-daemon --warning-mode all 2>&1 | tail -60 )
```

Expected: ends with `BUILD SUCCESSFUL`. No `FAILED` task. No `^e: ` lines.

If R8/ProGuard complains about desugared classes, check the relevant keep rules; typically `desugar_jdk_libs` is ProGuard-friendly out of the box and no extra rules are needed.

### Step 3: Confirm APK is produced

```bash
ls -l "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android/app/build/outputs/apk/painter/release/"
```

Expected: at least one `.apk` file (naming pattern like `app-painter-release.apk` or similar). Note the file size (typical painter APK ~12-15 MB; +1 MB from desugaring is acceptable).

### Step 4: Confirm 4 new commits above SP2 commits

```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  git log --oneline audit/2026-04-17 ^master | head -10
```

Expected (top four):
```
<sha> build(painter): enable coreLibraryDesugaring for java.time on minSdk 24
<sha> feat(painter): HomeViewModel — checkinDays/checkinPersonalBest state + fetchCheckinHistory + longestStreak mapping
<sha> feat(painter): DashboardData.longestStreak field from /me/dashboard
<sha> feat(painter): AttendanceApi — CheckinDay + CheckinHistoryResponse DTOs + getCheckinHistory method
8570e01 feat(painter): HomeViewModel — submitWithdrawal + clearWithdrawalMessages wired to PointsApi
```

### Step 5: No commit

Verification task only. After this task completes, painter v3.0.0 is shippable.

---

## Self-review

**Spec coverage:**

| Spec element | Plan task |
|---|---|
| `CheckinDay` DTO with computed `checkedIn` | Task 1 Step 2 |
| `CheckinHistoryResponse` with all 5 nullable fields | Task 1 Step 2 |
| `getCheckinHistory(month)` API method | Task 1 Step 2 |
| `DashboardData.longestStreak` field | Task 2 |
| `HomeUiState.checkinDays` + `checkinPersonalBest` | Task 3 Step 1 |
| `HomeViewModel` constructor gains `attendanceApi` | Task 3 Step 2 |
| `loadAll()` maps `d.longestStreak → checkinPersonalBest` | Task 3 Step 3 |
| `fetchCheckinHistory(month)` method on HomeViewModel | Task 3 Step 4 |
| Gradle `isCoreLibraryDesugaringEnabled = true` | Task 4 Step 1 |
| `coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.0.4")` dep | Task 4 Step 2 |
| Success criterion: 0 Kotlin errors | Task 3 Step 5, Task 5 Step 1 |
| Success criterion: full clean assemble succeeds | Task 5 Step 2 |
| Success criterion: APK produced | Task 5 Step 3 |

All spec elements mapped. No gaps.

**Placeholder scan:** No TBD/TODO/"similar-to". Every step has exact old_string/new_string for Edits, exact commands, exact expected outputs.

**Type consistency:**
- `CheckinDay` — defined Task 1, referenced in Task 3 Step 1 (`List<CheckinDay>`). Consistent.
- `CheckinHistoryResponse` — defined Task 1 with `checkins`/`days`/`streak`/`personalBest` fields. Task 3 Step 4 uses `resp.body()?.checkins ?: resp.body()?.days ?: emptyList()` — matches exactly.
- `DashboardData.longestStreak: Int?` — defined Task 2 as nullable, used Task 3 Step 3 with `?: 0` fallback. Consistent.
- `AttendanceApi.getCheckinHistory(month)` — defined Task 1 with `@Query("month") month: String` param. Task 3 Step 4 calls `attendanceApi.getCheckinHistory(month)` — matches.
- `attendanceApi: AttendanceApi` constructor dep — Task 3 Step 2 declares, Step 4 uses. Consistent.
- `checkinDays: List<CheckinDay>` — Task 3 Step 1 default `emptyList()`, Step 4 sets via `it.copy(checkinDays = days)`. Consistent.
- `checkinPersonalBest: Int` — Task 3 Step 1 default `0`, Step 3 sets `d.longestStreak ?: 0`. Consistent.

Expected error-count progression: 30 → ~6 (Task 1) → ~6 (Task 2, no consumer) → 0 (Task 3) → 0 (Task 4, no new errors). Final: 0.

**Scope check:** 4 code tasks + 1 verification task. Tight single sub-project. No cross-task coupling beyond the simple dependency chain (Task 3 needs Task 1's DTOs; Task 5 verifies the whole chain).

---

## Summary

4 code tasks + 1 verification task, 4 commits, 4 files, ~47 net lines. After Task 5 completes, painter v3.0.0 APK is **shippable**. This is the final sub-project closing the 261 → 0 compile-error journey.

After this plan executes:
- Branch `audit/2026-04-17` has 28 commits ahead of master
- APK builds clean from scratch
- Next steps (out-of-plan): manual smoke test, version bump, Play Store upload
