# Painter Android v3.0.0 Sub-project 2: Withdrawal Workflow — Design Spec

**Date:** 2026-04-18
**Status:** Approved design, awaiting implementation plan
**Author:** Claude Opus 4.7 + sharjoon1

## Goal

Close the 9 HomeScreen.kt compile errors for the withdrawal workflow by wiring `submitWithdrawal`/`clearWithdrawalMessages` on `HomeViewModel` and adding `withdrawalLoading`/`withdrawalError`/`withdrawalSuccess` state on `HomeUiState`. Screen code, UI sheet, and backend endpoint already exist — this spec adds only the VM plumbing.

## Context

- Repo: `D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\qcpaintshop-android`, branch `audit/2026-04-17` (22 commits ahead of master).
- Current compile error count: 36. 9 are in `ui/home/HomeScreen.kt` for withdrawal, the remaining 27 are in Sub-project 1 (attendance/streak).
- Backend `POST /me/withdraw` already exists (`routes/painters.js:544`) and accepts `{pool, amount}` body, returns `{success, message, ...result}`.
- `PointsApi.withdraw()` method + `WithdrawRequest(pool, amount)` DTO already exist (`data/remote/api/PointsApi.kt:23-26, 36-37`).
- `WithdrawalSheet` composable already exists (`ui/home/components/WithdrawalSheet.kt:18-147`); it accepts `regularBalance`, `annualBalance`, `isLoading`, `error`, `onSubmit`, `onDismiss`.

## Contract (from HomeScreen caller code, verified)

HomeScreen.kt reads:
- `state.withdrawalLoading` — Boolean (passed as `isLoading` to WithdrawalSheet)
- `state.withdrawalError` — String? (passed as `error` to WithdrawalSheet)
- `state.withdrawalSuccess` — String? (gated at snackbar `if (state.withdrawalSuccess != null)`; rendered via `Text(state.withdrawalSuccess!!)`)

HomeScreen.kt calls:
- `viewModel.submitWithdrawal(pool, amount)` — via WithdrawalSheet's `onSubmit` lambda
- `viewModel.clearWithdrawalMessages()` — from snackbar OK button
- `viewModel.toggleWithdrawalSheet(false)` — already present

## Architectural Decisions

| Decision | Choice | Why |
|---|---|---|
| DTO | Reuse existing `WithdrawRequest(pool, amount)` | Already defined on `PointsApi`; shape matches backend body exactly |
| API dep | Inject `PointsApi` into `HomeViewModel` constructor | Already `@Provides`-bound in `AppModule.kt` (no new Hilt wiring) |
| Post-success UX | Close sheet + show snackbar + full dashboard reload | Dashboard payload is small; `regularPoints` / `annualPoints` must reflect new balance; matches painter app's other post-action flows (check-in, estimate submit) |
| Post-failure UX | Keep sheet open, show inline error on sheet | User can correct and retry without reopening sheet. WithdrawalSheet's `error` prop already renders inline |
| Error classification | Single `withdrawalError: String?` | WithdrawalSheet renders one error string; no UI value to distinguish network vs validation vs 4xx |
| Reload method | Full `loadAll()` | Simpler than a targeted balance-only refetch; dashboard call is fast and other fields may also be stale |
| Message sources | Prefer backend `body.message` → fall back to exception message → fall back to constant | Gives the backend-level "Insufficient balance" / "Withdrawal requested" strings priority; engineering fallbacks last |

## HomeUiState additions

```kotlin
// Added to existing data class HomeUiState, grouped with other workflow fields:
val withdrawalLoading: Boolean = false
val withdrawalError: String? = null
val withdrawalSuccess: String? = null
```

Defaults keep existing callers unaffected.

## HomeViewModel additions

### Constructor

Adds one param:
```kotlin
@HiltViewModel
class HomeViewModel @Inject constructor(
    private val dashboardRepository: DashboardRepository,
    private val userPreferences: UserPreferences,
    private val catalogApi: CatalogApi,
    private val workApi: WorkApi,
    private val pointsApi: PointsApi,  // NEW
) : ViewModel()
```

### `submitWithdrawal(pool: String, amount: Double)`

```kotlin
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
```

### `clearWithdrawalMessages()`

```kotlin
fun clearWithdrawalMessages() {
    _uiState.update { it.copy(withdrawalSuccess = null, withdrawalError = null) }
}
```

## Imports

`HomeViewModel.kt` already has `import com.qcpaintshop.painter.data.remote.api.*` (covers `PointsApi`, `WithdrawRequest`). No new imports required.

## Files changed (1)

| File | Change | Approx lines |
|---|---|---|
| `ui/home/HomeViewModel.kt` | +3 UiState fields, +1 constructor dep, +2 methods | +~35 |

No other files touched. No tests added (painter flavor has no test harness).

## Success criteria

1. `./gradlew :app:compilePainterReleaseKotlin` drops from 36 → 27.
2. All 9 resolved errors were in `HomeScreen.kt` (withdrawal-related).
3. Remaining 27 errors strictly in Sub-project 1 territory (StreakSheet.kt, AttendanceCalendarViewModel.kt) — no regressions in previously-clean files.

## Testing strategy

- Compile-level: gradle probe is the gate.
- No unit tests. Painter flavor has none; adding a test harness is out of scope per the parent project policy.
- Runtime: user's manual smoke test (deferred to after Sub-project 1 lands). Happy path: open home → withdrawal sheet → enter valid amount → submit → snackbar shows success → sheet closes → regular/annual points reflect new balance.
- Failure path: submit with amount > available → backend responds `{success: false, message: "Insufficient balance"}` → sheet stays open, error shows inline.

## Out of scope

- Withdrawal history — separate feature (painter-android already has a WithdrawalsScreen using the same endpoint pattern).
- Balance split / partial-pool logic — backend handles atomically.
- Sub-project 1 (attendance/streak) — separate spec.

## Terminal State

This spec ends here. Next step: `superpowers:writing-plans`.
