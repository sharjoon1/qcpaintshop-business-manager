# Painter Android v3.0.0 Sub-project 1 (Final): Attendance + Streak Workflow — Design Spec

**Date:** 2026-04-18
**Status:** Approved design, awaiting implementation plan
**Author:** Claude Opus 4.7 + sharjoon1

## Goal

Close the final 30 compile errors on the painter v3.0.0 WIP — all in the attendance/streak workflow — so `./gradlew clean :app:assemblePainterRelease` exits 0 and the APK is shippable. This is the **last** of three sub-projects completing the v3.0.0 data layer.

## Context

- Repo: `D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\qcpaintshop-android`, branch `audit/2026-04-17` (24 commits ahead of master).
- Current compile error count: **30**. Distribution: StreakSheet.kt 15, AttendanceCalendarViewModel.kt 12, HomeScreen.kt 3.
- Previous sub-projects complete: SP3 misc plumbing, SP2 withdrawal.
- Backend endpoint `GET /me/checkin-history?month=YYYY-MM` already exists at `routes/painters.js:872` and returns `{success, checkins: [{date, streak, bonus}]}`.
- Backend `GET /me/dashboard` already returns `longestStreak` at `routes/painters.js:626` but `DashboardData` DTO doesn't yet expose it.

## Error Source Analysis

### StreakSheet.kt (15 errors)
- Lines 21, 34: `Unresolved reference 'CheckinDay'` — DTO not defined.
- Lines 46-80: cascading "Cannot infer type" / "Unresolved reference 'checkedIn'/'date'" errors — all downstream from the missing DTO.
- Uses `java.time.LocalDate`, `java.time.YearMonth`, `DateTimeFormatter`, `TextStyle`. minSdk=24. Without core library desugaring, compile succeeds but runtime crashes on API 24-25.

### AttendanceCalendarViewModel.kt (12 errors)
Code is fully written (file exists, VM is scaffolded). Errors stem from two gaps:
- Line 71: `Unresolved reference 'getCheckinHistory'` — method doesn't exist on `AttendanceApi`.
- Lines 74-92: Unresolved `days`, `checkins`, `streak`, `personalBest`, `date`, `checkedIn` — fields on the missing `CheckinHistoryResponse` and `CheckinDay` types.

### HomeScreen.kt (3 errors)
- Line 245: `state.checkinPersonalBest` — field missing on `HomeUiState`.
- Line 246: `state.checkinDays` — field missing on `HomeUiState`.
- Line 247: `viewModel.fetchCheckinHistory()` — method missing on `HomeViewModel`.

## Architectural Decisions

| Decision | Choice | Why |
|---|---|---|
| CheckinDay `checkedIn` field | Computed `val checkedIn: Boolean get() = date != null` | Backend only returns rows for actual check-ins; absent rows = not checked in. No need to pass an explicit flag over the wire |
| CheckinHistoryResponse shape | `success + checkins + days + streak + personalBest`, all nullable | AttendanceCalendarViewModel uses both `body.days` (future alias) and `body.checkins` (current backend). `streak`/`personalBest` are nullable with `?: 0` fallbacks in VM. Graceful when backend hasn't yet extended |
| `java.time` support on minSdk 24 | Enable AGP coreLibraryDesugaring + `desugar_jdk_libs:2.0.4` dep | Single gradle toggle + dep line; ~1MB APK bloat; zero screen-code changes. AGP-supported since 4.0 |
| `HomeViewModel.fetchCheckinHistory` | Silent VM method (no loading state) | StreakSheet has no loading UI for month transitions; matches simple pattern where list populates asynchronously |
| `checkinPersonalBest` source | `DashboardData.longestStreak` → `HomeUiState.checkinPersonalBest` in `loadAll()` | Backend already returns `longestStreak` on `/me/dashboard`; one new field on DTO + one copy line in loadAll |
| `AttendanceCalendarViewModel` handling | No VM changes — existing code already compiles against the new API/DTO | VM is well-scaffolded; its 12 errors are all downstream consequences of missing API method + DTOs |
| Backend changes | None | Every feature this sub-project implements talks to endpoints that already exist |

## New DTOs

### `data/remote/api/AttendanceApi.kt`

```kotlin
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
```

## Interface additions

### `AttendanceApi` interface

Extend with:
```kotlin
@GET("me/checkin-history")
suspend fun getCheckinHistory(
    @Query("month") month: String,
): Response<CheckinHistoryResponse>
```

Backend contract: `month` must be `YYYY-MM` format (`routes/painters.js:876-878` validates this regex-style).

## Existing DTO extension

### `DashboardApi.kt::DashboardData`

Add one field:
```kotlin
val longestStreak: Int? = null
```

No `@SerializedName` — backend sends camelCase `longestStreak` (verified `routes/painters.js:626`).

## ViewModel contracts

### `HomeUiState`

Add 2 fields:
```kotlin
val checkinDays: List<CheckinDay> = emptyList(),
val checkinPersonalBest: Int = 0,
```

### `HomeViewModel` constructor

Add one injected dep:
```kotlin
private val attendanceApi: AttendanceApi,
```

Hilt already binds `AttendanceApi` (used by `AttendanceCalendarViewModel` and others). No module change.

### `HomeViewModel.loadAll()` dashboard mapping

In the dashboard success block, add one line to the `_uiState.update { it.copy(...) }`:
```kotlin
checkinPersonalBest = d.longestStreak ?: 0,
```

Positioned alongside the other dashboard-derived fields (`checkinStreak`, `thisMonthCheckins`, etc.).

### `HomeViewModel.fetchCheckinHistory(month: String)`

New public method:
```kotlin
fun fetchCheckinHistory(month: String) {
    viewModelScope.launch {
        try {
            val resp = attendanceApi.getCheckinHistory(month)
            val days = resp.body()?.checkins ?: resp.body()?.days ?: emptyList()
            _uiState.update { it.copy(checkinDays = days) }
        } catch (_: Exception) {}
    }
}
```

No explicit loading state. Month transitions are silent — empty state shows briefly between months.

## Gradle build config

### `app/build.gradle.kts`

Two changes inside `android { ... }` block:

```kotlin
android {
    // ... existing config ...
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
        isCoreLibraryDesugaringEnabled = true  // NEW
    }
}

dependencies {
    // ... existing deps ...
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.0.4")  // NEW
}
```

(If `compileOptions` block doesn't exist, create it. If `sourceCompatibility`/`targetCompatibility` are already present, just add `isCoreLibraryDesugaringEnabled`.)

Result: `java.time.LocalDate`, `java.time.YearMonth`, `DateTimeFormatter`, `TextStyle` work natively on minSdk 24 without crash.

## Files changed (4)

| File | Change | Approx lines |
|---|---|---|
| `data/remote/api/AttendanceApi.kt` | + 2 DTOs, + 1 interface method | +25 |
| `data/remote/api/DashboardApi.kt` | + 1 field on DashboardData | +1 |
| `ui/home/HomeViewModel.kt` | + 2 UiState fields, + constructor dep, + 1 method, + 1 loadAll line | +18 |
| `app/build.gradle.kts` | + desugaring toggle + dep | +3 |

No screen files modified. No backend changes.

## Success criteria

1. `./gradlew :app:compilePainterReleaseKotlin --no-daemon` exits 0 with **0 errors**. Total drops from 30 → 0.
2. `./gradlew clean :app:assemblePainterRelease --no-daemon --warning-mode all` exits 0. Full APK builds.
3. Painter v3.0.0 is **ready to ship** — last blocker between the WIP and Play Store upload.

## Testing strategy

- **Compile-level:** gradle is the gate. Two probes — Kotlin-only compile for speed iteration, full clean assemble for final check.
- **No unit tests:** painter flavor has no harness; adding one is out of scope.
- **Runtime smoke test (user-run):** after APK installs, open home → open streak sheet → verify calendar renders, dots appear on checked-in days, month chevrons trigger reload. Also open Attendance Calendar screen from profile → verify month navigation works.
- **Regression:** confirm other v2.1-era features (estimate create, check-in, product catalog) still compile and work. Check-in flow already tested in SP2 reload path.

## Out of scope

- Backend extension of `/me/checkin-history` to include top-level `streak`/`personalBest` — MVP ships with zeros on the Attendance Calendar screen's streak panel. Home screen's streak panel still shows correct values via `state.checkinStreak` from dashboard.
- Attendance calendar screen redesign — existing Calendar-based VM is fine.
- Visual polish on StreakSheet — screen code already exists.
- Full-branch merge to master — user's call after APK is validated.

## Terminal State

This is the final spec before the painter v3.0.0 APK ships. Next step: `superpowers:writing-plans` generates the implementation plan.
