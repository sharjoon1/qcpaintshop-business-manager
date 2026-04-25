# Painter Android — FCM End-to-End Fix

**Date:** 2026-04-25
**Status:** Spec approved, ready for plan
**Source audit:** `qcpaintshop-android/audit-findings/2026-04-25/SUMMARY.md`
**Target:** `qcpaintshop-android` repo, `painter` flavor (`com.qcpaintshop.painter`, versionCode 17)

---

## Context

The painter native Android app (Jetpack Compose + Hilt + DataStore) has push notifications **completely broken**. Five separate findings in the 2026-04-25 audit isolate the root causes:

| ID | Finding | Severity |
|---|---|---|
| PNTR-02 | FCM token never POSTed to backend after login | P0 |
| PNTR-08 | Notification PendingIntent hardcoded to removed `MainActivity` → tap crashes | P0 |
| PNTR-08b | Notification deep-link returns dead web URLs (`/painter-dashboard.html`) for native app | P1 |
| PNTR-08c | `PainterMainActivity.onCreate()` doesn't read intent extras → no per-screen routing | P1 |
| REL-04 | `POST_NOTIFICATIONS` runtime permission not requested → Android 13+ silently drops notifications | P1 |

The backend already supports the painter side: `POST /me/fcm/register`, `DELETE /me/fcm/unregister`, and `painter-notification-service.js` emits ~12 notification types (estimate_*, withdrawal_*, points_earned, new_offer, training_new, attendance_reminder).

The team had set up partial scaffolding (notification preference keys in `UserPreferences`, channel logic gated on `BuildConfig.APP_TYPE == "painter"` in the shared service) but never finished. This spec finishes the work.

**Hidden additional defect surfaced during spec self-review:** the existing `FcmTokenRequest` DTO in `NotificationApi.kt` ships `{ token, platform }` but the backend reads `req.body.fcm_token` (per `routes/painters.js:2743`). Even if someone HAD wired up the missing `registerFcmToken(...)` caller, the request would have been rejected 400 "fcm_token is required". This adds a sub-task to fix the DTO field name; otherwise PNTR-02 stays broken silently. (Worth adding to the audit's `known-bug-patterns.md` as a new pattern: "Backend DTO field-name mismatch — Android sends camelCase or wrong snake_case key vs what server reads.")

## Goals

1. After painter login, the FCM token is POSTed to backend reliably.
2. Tapping any notification opens the correct native Compose screen — never crashes.
3. Token rotation, app start, and logout all keep the backend's view of the device's token in sync.
4. Android 13+ painters get a clean one-shot permission prompt with a Settings escape hatch.

## Non-goals

- Notification action buttons (Mark Read / View) — backend supports `PUT /me/notifications/:id/read` but no UI today.
- Sticky / grouped notifications.
- Per-category subscription toggles beyond what's already declared in `UserPreferences`.
- Loyalty level rewrite (PNTR-04, separate spec).
- Keystore credentials migration (SEC-01, separate spec).
- BODY-level logging gate (NET-05, separate spec — but will share the PR since it touches `ApiClient.kt`).

---

## Architecture

```
                    ┌────────────────────────────────────────────────┐
                    │           Backend (act.qcpaintshop.com)        │
                    │  POST /me/fcm/register   DELETE /me/fcm/unregister │
                    └──────────────────────▲─────────────────────────┘
                                           │
                          ┌────────────────┴────────────┐
                          │  FcmTokenManager (@Singleton) │
                          │  register / refresh / unregister │
                          │  retryIfPending()            │
                          └─┬──────────┬───────────┬─────┘
                            │          │           │
       ┌────────────────────┘          │           └──────────────────┐
       │                               │                              │
┌──────▼──────┐                ┌───────▼─────────┐             ┌──────▼─────────┐
│ AuthRepo    │                │ MainViewModel   │             │ QCFirebaseSvc   │
│ verifyOtp() │                │ init { retry }  │             │ onNewToken      │
│ logout()    │                │                 │             │                 │
└─────────────┘                └─────────────────┘             └────────┬────────┘
                                                                        │ push received
                                                                        ▼
                              ┌──────────────────────────────────────────────────┐
                              │  NotificationDeepLink (sealed class, painter src) │
                              │  Estimate(id) | Points | Catalog |                │
                              │  Training(id) | Attendance | Inbox                │
                              └────┬────────────────────────────────────────┬────┘
                                   │ encodeIntent extras                    │ parse
                                   ▼                                        │
                         ┌────────────────────┐                  ┌─────────▼──────────┐
                         │  Notification UI    │ tap →           │ PainterMainActivity │
                         │  (PendingIntent →   ├──────────────►  │ onCreate / onNew    │
                         │  PainterMainActivity)│                 │ Intent → emit       │
                         └────────────────────┘                  └─────────┬──────────┘
                                                                            │
                                                                            ▼
                                                            ┌──────────────────────────┐
                                                            │ NotificationNavSignal     │
                                                            │ MutableSharedFlow<DeepLink>│
                                                            │ replay = 1                │
                                                            └─────────────┬─────────────┘
                                                                          │ collect
                                                                          ▼
                                                            ┌──────────────────────────┐
                                                            │ AppNavigation             │
                                                            │ navController.navigate()  │
                                                            └──────────────────────────┘
```

**Two pure-Kotlin testable units:** `FcmTokenManager`, `NotificationDeepLink`.
**One Compose-aware glue:** `NotificationNavSignal` (Hilt singleton SharedFlow).
**Edits to existing files:** `QCFirebaseMessagingService` (BuildConfig branch), `AuthRepository`, `MainViewModel`, `PainterMainActivity`, `UserPreferences`, `AppNavigation`, `SettingsScreen`.

Painter source set takes the new files. Staff/customer flows untouched.

---

## Components

### New files (painter source set, `app/src/painter/java/com/qcpaintshop/painter/`)

#### `data/fcm/FcmTokenManager.kt` (Hilt `@Singleton`)
```
class FcmTokenManager @Inject constructor(
    notificationApi: NotificationApi,
    userPrefs: UserPreferences,
    fcmTokenSource: FcmTokenSource,        // wrapper around FirebaseMessaging
)
  suspend fun registerCurrentToken()       // called on login
  suspend fun onTokenRefresh(token: String)// called by FCM service
  suspend fun unregister()                 // called on logout, fire-and-forget
  suspend fun retryIfPending()             // called on app start
```
Internal: gets token via `fcmTokenSource.getToken()`, persists `fcmToken` in DataStore, sets/clears `pendingFcmRegister` flag, swallows network errors with `Log.w`. No retry loop — next natural moment retries.

#### `data/fcm/FcmTokenSource.kt` (interface + production impl)
Production: thin wrapper `FirebaseMessaging.getInstance().token.await()`.
Test: in-memory implementation returning a canned token.
Reason: makes `FcmTokenManager` testable without Firebase running.

#### `data/fcm/NotificationDeepLink.kt` (sealed class)
```
sealed class NotificationDeepLink {
  data class Estimate(val id: Int) : NotificationDeepLink()
  data object Points : NotificationDeepLink()
  data object Catalog : NotificationDeepLink()
  data class Training(val id: Int) : NotificationDeepLink()
  data object Attendance : NotificationDeepLink()
  data object Inbox : NotificationDeepLink()    // fallback
}
companion object {
  fun fromPayload(data: Map<String, String>): NotificationDeepLink
  fun fromIntent(intent: Intent): NotificationDeepLink?
  fun encodeIntent(builder: Intent, link: NotificationDeepLink): Intent
  fun toRoute(link: NotificationDeepLink): String   // returns Routes.X.route
}
```
The 12 backend `type` strings map to 6 deep-link variants per Q2 in the brainstorm: estimate_* → Estimate; points_earned + withdrawal_* → Points; new_offer → Catalog; training_new → Training; attendance_reminder → Attendance; everything else → Inbox.

#### `ui/notifications/NotificationNavSignal.kt` (Hilt `@Singleton`)
```
class NotificationNavSignal @Inject constructor() {
  private val _flow = MutableSharedFlow<NotificationDeepLink>(replay = 1)
  val flow: SharedFlow<NotificationDeepLink> = _flow.asSharedFlow()
  suspend fun emit(link: NotificationDeepLink) { _flow.emit(link) }
  fun consume()  // resets replay buffer to avoid re-nav on rotation
}
```

#### `ui/notifications/NotificationPermissionPrompt.kt` (Compose dialog)
Small dialog shown after `verifyOtp` success. `[Enable]` invokes `ActivityResultContracts.RequestPermission` for `Manifest.permission.POST_NOTIFICATIONS`. Either choice persists `notificationPermissionAsked = true`.

### Edits

| File | Edit |
|---|---|
| `data/local/datastore/UserPreferences.kt` | Add 3 keys: `fcmToken`, `pendingFcmRegister`, `notificationPermissionAsked` |
| `data/repository/AuthRepository.kt` | Inject `FcmTokenManager`. After verifyOtp success → `registerCurrentToken()`. In `logout()` → `unregister()` BEFORE `clearAll()` |
| `MainViewModel.kt` | Inject `FcmTokenManager`. In init after status==approved → `retryIfPending()` |
| `PainterMainActivity.kt` | Inject `NotificationNavSignal`. Read intent in onCreate AND override onNewIntent. Show `NotificationPermissionPrompt` if just-logged-in & not asked |
| `navigation/AppNavigation.kt` | Collect `NotificationNavSignal.flow`, navigate via `navController`. Guard: only navigate when currentRoute is in main tabs (not auth screens) |
| `app/src/main/.../QCFirebaseMessagingService.kt` | Add `@AndroidEntryPoint` + inject `FcmTokenManager`. `onNewToken` for painter delegates to manager. `showNotification` branches on `BuildConfig.APP_TYPE == "painter"`: target = `PainterMainActivity::class.java`, encode `NotificationDeepLink` into Intent extras |
| `data/remote/api/NotificationApi.kt` | (1) **Fix `FcmTokenRequest` DTO field name** — currently `val token: String, val platform: String` but backend reads `req.body.fcm_token`. Change to `@SerializedName("fcm_token") val fcmToken: String, @SerializedName("device_info") val deviceInfo: Map<String, String>? = null`. Drop `platform`. (2) Add `@HTTP(method="DELETE", path="me/fcm/unregister", hasBody=true) suspend fun unregisterFcmToken(@Body req: FcmTokenRequest): Response<GenericResponse>` (Retrofit needs `@HTTP` to send a DELETE body) |
| `ui/profile/SettingsScreen.kt` | Add Notifications section. If granted: 3 toggles wired to existing `UserPreferences.notification*` keys. If denied: "Enable" CTA opens `Settings.ACTION_APP_NOTIFICATION_SETTINGS` |
| `data/remote/api/ApiClient.kt` | (PR-shared with NET-05) Gate `HttpLoggingInterceptor.Level.BODY` behind `BuildConfig.DEBUG` |

DI wiring — `@Inject constructor` on `FcmTokenManager`, `NotificationNavSignal`, `FcmTokenSource` (impl). Hilt resolves them via `@Inject constructor` — no `@Provides` methods needed in `AppModule`.

---

## Data flow (6 paths)

### Path A — Login → token registered (non-blocking)
1. `AuthRepository.verifyOtp` succeeds → persists authToken
2. Calls `fcmTokenManager.registerCurrentToken()` (not awaited; uses outer scope)
3. Manager: `fcmTokenSource.getToken()` → `notificationApi.registerFcmToken(...)` → on 200 persist token + clear pending; on failure set `pendingFcmRegister = true`
4. Login UI navigates to Home regardless of FCM result
5. `PainterMainActivity` evaluates `POST_NOTIFICATIONS`; if not granted and not yet asked → shows `NotificationPermissionPrompt`

### Path B — Push received → notification displayed
1. FCM → `QCFirebaseMessagingService.onMessageReceived(message)`
2. Service builds NotificationCompat (existing channel logic untouched)
3. PendingIntent target = `if (BuildConfig.APP_TYPE == "painter") PainterMainActivity::class.java else MainActivity::class.java`
4. Painter branch: `NotificationDeepLink.encodeIntent(intent, fromPayload(message.data))` (string extras only — no `intent.data = Uri`)
5. Staff/customer branch: existing `intent.data = Uri.parse(fullWebUrl)` flow

### Path C — Tap → Compose navigation
1. PendingIntent fires → `PainterMainActivity` started (cold) or `onNewIntent` (warm; `launchMode="singleTask"` is already set in painter manifest ✓)
2. Activity reads intent: `NotificationDeepLink.fromIntent(intent) ?: return`
3. `lifecycleScope.launch { notificationNavSignal.emit(link) }`
4. `AppNavigation` has `LaunchedEffect(Unit) { signal.flow.collect { ... } }`
5. Collector navigates: `navController.navigate(NotificationDeepLink.toRoute(link)) { launchSingleTop = true }`, then `signal.consume()`
6. Guard in collector: if `currentRoute` is in auth screens (Login, AwaitingApproval, Register) → skip navigation; preserved emission picked up after login

### Path D — FCM token rotation (background)
1. Firebase rotates token → `QCFirebaseMessagingService.onNewToken(newToken)`
2. Service delegates: `fcmTokenManager.onTokenRefresh(newToken)`
3. Manager: if not logged in → just persist locally; if logged in → POST. Token persisted even on POST failure (retry path uses it).

### Path E — App start retry
1. `MainViewModel.init` → `authRepository.getStatus()`
2. If approved → `fcmTokenManager.retryIfPending()`
3. If `pendingFcmRegister` flag set: fetch current token → POST → on success clear flag; on failure leave flag set for next start

### Path F — Logout
1. `AuthRepository.logout()`:
   a. `fcmTokenManager.unregister()` — best-effort; reads stored token, DELETE /me/fcm/unregister with body `{token}`
   b. `userPreferences.clearAll()` clears authToken, fcmToken, pendingFcmRegister, etc.
2. UI navigates to `Routes.Login`

**Idempotence:** backend `POST /me/fcm/register` upserts on `(painter_id, token)` unique key — same-token re-registration is a no-op. Path E that races with a successful Path A does no harm.

---

## Error handling

| # | Failure | Where | Handling |
|---|---|---|---|
| 1 | `fcmTokenSource.getToken()` throws (Play Services missing) | Manager.registerCurrentToken | catch → `Log.w` → setPendingFcmRegister(true) → return. App functional. |
| 2 | `POST /me/fcm/register` 5xx / network timeout | Manager | setPendingFcmRegister(true). Path E retries on next start. No user-facing error. |
| 3 | `POST /me/fcm/register` 401 | Manager | existing `AuthInterceptor` 401 flow clears auth token → next `getStatus()` routes to Login. Don't double-handle. |
| 4 | `DELETE /me/fcm/unregister` fails | Manager.unregister | swallow + `Log.w`. Backend has 30-day stale-token sweep. Logout proceeds. |
| 5 | `NotificationDeepLink.fromPayload` can't parse `type` | service | fallback `Inbox` (`Routes.Notifications`) |
| 6 | `fromPayload` reads `estimate_id` but it's not Int | service | fallback `Inbox` |
| 7 | `fromIntent(intent)` returns null on tap (legacy notification) | Activity | no emit; default startDestination. No crash. |
| 8 | Tap during cold start before `AppNavigation` collects | NotificationNavSignal | `replay=1` buffers; LaunchedEffect picks it up; `consume()` after |
| 9 | Tap with currentRoute already on target | Collector | `launchSingleTop=true` makes navigate a no-op |
| 10 | Tap while logged out (rare race) | Collector guard | skip; emission preserved; user navigates after re-auth |
| 11 | `POST_NOTIFICATIONS` denied | Permission prompt | persist `notificationPermissionAsked=true`; SettingsScreen escape hatch |
| 12 | Geofence-typed notification reaches painter (defensive) | service | `Inbox` fallback; no crash |
| 13 | `ActivityNotFoundException` (defensive) | OS-level | shouldn't fire after fix; if it does, build misconfiguration |
| 14 | Hilt missing `@AndroidEntryPoint` on service | service | Dagger MissingBinding fails build at Phase 1; caught by audit |
| 15 | DataStore IOException | UserPreferences | DataStore handles; we don't catch; next read returns last good value |

**Cross-cutting decisions:**
- Never block UX on FCM operations.
- Never crash on bad payloads — always fall back to `Inbox`.
- Single retry mechanism — `pendingFcmRegister` flag + `MainViewModel.init` retry. No exponential backoff.
- All `Log.w(tag, throwable)` calls gated behind `BuildConfig.DEBUG` (ties to NET-05).

---

## Testing

### Unit tests

**`NotificationDeepLinkTest.kt`** — round-trip tests for all 12 backend types + edge cases (null type, malformed estimate_id, empty map, unknown type). Plus `toRoute` checks each variant's route exists in `Routes` (guards against route renames).

**`FcmTokenManagerTest.kt`** — mocked `NotificationApi` + fake `UserPreferences` + fake `FcmTokenSource`. Covers: register happy path, register IOException, register 5xx, onTokenRefresh-while-logged-out, onTokenRefresh-while-logged-in, unregister happy path, unregister no-token, unregister-throws, retryIfPending-flag-false, retryIfPending-success-clears-flag, retryIfPending-failure-keeps-flag.

### Integration tests

**`FcmEndToEndTest.kt`** — launch `PainterMainActivity` with intent containing `Estimate(42)` extras. Espresso verifies `EstimateDetail` UI rendered with id=42. MockWebServer asserts `POST /me/fcm/register` called once.

**`LogoutFlowTest.kt`** — set up logged-in state with stored `fcmToken="abc"`. Trigger logout. Assert MockWebServer received `DELETE /me/fcm/unregister` with body `{"fcm_token":"abc"}` (matches backend field name). Assert UserPreferences post-logout has no fcmToken.

### Manual / device E2E (12-item checklist in PR)

Fresh install → login → notification arrives → tap navigates correctly. Repeat per notification type. Permission denial path. Multi-device support. Logout unregisters. Airplane-mode retry path. Play Services missing graceful fallback.

### Test infra additions

- `FcmTokenSource` interface (already listed in Components) — sole new test seam
- Robolectric for `NotificationDeepLinkTest` (no Android dependency on parser)
- Existing `app/build.gradle.kts` has Hilt + Compose; no new test deps

---

## Risks & open questions

**Resolved during brainstorm:**
- Withdrawal notifications → `Routes.PointsHistory` (no dedicated screen needed)
- `new_offer` → `Routes.Catalog` (no offer-detail screen needed)
- Permission prompt at first login (not first launch, not first push)
- Token registration timing covers all 4 moments (login, refresh, app start, logout)

**Remaining risks:**
- Multi-device test (#9 in E2E) requires two physical devices — confirm test plan before PR
- Firebase test push tooling needs Firebase Console access — confirm reviewer has it
- `assetlinks.json` for App Links is a separate audit P1 (PNTR-05). Not blocking FCM but reviewer should verify.

---

## Implementation milestones (for the plan-writing skill)

1. New types: `FcmTokenSource`, `NotificationDeepLink`, `FcmTokenManager`, `NotificationNavSignal` + their unit tests
2. UserPreferences key additions
3. NotificationApi.unregisterFcmToken endpoint
4. AuthRepository wiring (verifyOtp + logout)
5. MainViewModel retry wiring
6. PainterMainActivity intent reading + `onNewIntent` override + permission prompt host
7. AppNavigation signal collector + navigate
8. QCFirebaseMessagingService painter branch (BuildConfig + DeepLink encode + activity class)
9. SettingsScreen notification section
10. ApiClient logging gate (NET-05 piggyback)
11. Integration tests (Hilt + MockWebServer) for end-to-end flow + logout
12. PR-time E2E manual checklist

Each milestone is independently testable and committable. Total estimate: 3-5 dev days.
