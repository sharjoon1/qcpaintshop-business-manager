# Painter Android — FCM End-to-End Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make push notifications work end-to-end for the painter native Android app — token registers on login, taps open the right Compose screen, no crashes, no leaked PII.

**Architecture:** Centralized `FcmTokenManager` (Hilt singleton) + sealed `NotificationDeepLink` + Hilt-singleton `NotificationNavSignal` SharedFlow that bridges the FirebaseMessagingService → PainterMainActivity → AppNavigation. Shared `QCFirebaseMessagingService` branches on `BuildConfig.APP_TYPE == "painter"` to use native Compose routing; staff/customer flows untouched.

**Tech Stack:** Kotlin · Jetpack Compose · Hilt · Retrofit/Gson · Firebase Messaging · DataStore · JUnit 4 + MockK + kotlinx-coroutines-test (new test deps)

**Spec:** `docs/superpowers/specs/2026-04-25-painter-fcm-fix-design.md`
**Source repo:** `D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android`
**Branch:** `audit/2026-04-25` (already 3 commits ahead of master from today's audit; continue on the same branch)
**Backend reference (read-only):** `D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/act.qcpaintshop.com/routes/painters.js:2741-2779`

---

## File map

### New files (painter source set)

| Path | Responsibility |
|---|---|
| `app/src/painter/java/com/qcpaintshop/painter/data/fcm/NotificationDeepLink.kt` | Sealed class + Map→DeepLink + DeepLink↔Intent coding + DeepLink→Routes |
| `app/src/painter/java/com/qcpaintshop/painter/data/fcm/FcmTokenSource.kt` | Interface (testable seam over `FirebaseMessaging.getInstance().token`) + `FirebaseFcmTokenSource` impl |
| `app/src/painter/java/com/qcpaintshop/painter/data/fcm/FcmTokenManager.kt` | Token register/refresh/retry/unregister, owns `pendingFcmRegister` flag |
| `app/src/painter/java/com/qcpaintshop/painter/ui/notifications/NotificationNavSignal.kt` | Hilt singleton SharedFlow bridging Activity→AppNavigation |
| `app/src/painter/java/com/qcpaintshop/painter/ui/notifications/NotificationPermissionPrompt.kt` | Compose dialog asking for `POST_NOTIFICATIONS` after first login |
| `app/src/painter/java/com/qcpaintshop/painter/di/FcmModule.kt` | `@Binds` for `FcmTokenSource` → `FirebaseFcmTokenSource` |

### New test files (painter-flavor unit tests)

| Path | Responsibility |
|---|---|
| `app/src/testPainter/java/com/qcpaintshop/painter/data/fcm/NotificationDeepLinkTest.kt` | Parser cases (12 backend types + edges) + round-trip Intent encoding |
| `app/src/testPainter/java/com/qcpaintshop/painter/data/fcm/FcmTokenManagerTest.kt` | 11 state-machine cases for register/refresh/unregister/retry |

### Modified files

| Path | Lines / Responsibility |
|---|---|
| `app/build.gradle.kts` | Add `testImplementation` deps for JUnit/MockK/coroutines-test |
| `app/src/painter/java/com/qcpaintshop/painter/data/remote/api/NotificationApi.kt` | Fix `FcmTokenRequest` field name (`token` → `fcm_token`); drop `platform`; add optional `deviceInfo`; add `unregisterFcmToken(...)` with `@HTTP(DELETE, hasBody=true)` |
| `app/src/painter/java/com/qcpaintshop/painter/data/local/datastore/UserPreferences.kt` | Add 3 keys: `fcmToken`, `pendingFcmRegister`, `notificationPermissionAsked` (+ getters/setters); add `fcmToken` to `clearAll`'s effect |
| `app/src/painter/java/com/qcpaintshop/painter/data/repository/AuthRepository.kt` | Inject `FcmTokenManager`. After `verifyOtp` `saveLogin` → `fcmTokenManager.registerCurrentToken()`. In `logout()` → `fcmTokenManager.unregister()` BEFORE `userPreferences.clearAll()` |
| `app/src/painter/java/com/qcpaintshop/painter/MainViewModel.kt` | Inject `FcmTokenManager`. After `getStatus()` returns approved → `fcmTokenManager.retryIfPending()` |
| `app/src/main/java/com/qcpaintshop/act/fcm/QCFirebaseMessagingService.kt` | Add `@AndroidEntryPoint`. Inject `FcmTokenManager` (lazy, only when painter flavor active). `onNewToken` for painter delegates to manager. `showNotification` branches on `BuildConfig.APP_TYPE == "painter"`: target `PainterMainActivity::class.java`, encode `NotificationDeepLink` into Intent extras (no `intent.data = Uri`) |
| `app/src/painter/java/com/qcpaintshop/painter/PainterMainActivity.kt` | Inject `NotificationNavSignal`. Read `intent` in `onCreate` AND override `onNewIntent`. Decode via `NotificationDeepLink.fromIntent(...)` and emit. Show `NotificationPermissionPrompt` when first-login + Android 13+ + not yet asked |
| `app/src/painter/java/com/qcpaintshop/painter/navigation/AppNavigation.kt` | Inject `NotificationNavSignal` via `EntryPointAccessors`. `LaunchedEffect` collects flow → `navController.navigate(...)`. Guard: skip when `currentRoute` is in auth screens |
| `app/src/painter/java/com/qcpaintshop/painter/ui/profile/SettingsScreen.kt` | Add Notifications section: if granted, 3 toggles wired to existing `UserPreferences.notification*` keys. If denied, `[Enable]` opens `Settings.ACTION_APP_NOTIFICATION_SETTINGS` |
| `app/src/painter/java/com/qcpaintshop/painter/data/remote/api/ApiClient.kt` | Gate `HttpLoggingInterceptor.Level.BODY` behind `BuildConfig.DEBUG` (audit P0 NET-05 piggyback) |

---

## Task 1: Test infrastructure (deps + source set)

**Files:**
- Modify: `app/build.gradle.kts:103-181` (dependencies block)
- Create: `app/src/testPainter/java/com/qcpaintshop/painter/.gitkeep` (placeholder so Gradle indexes the folder)

- [ ] **Step 1: Add test dependencies**

Open `app/build.gradle.kts`. Find the `dependencies {` block (around line 103). Append at the end of the block, just before the closing `}`:

```kotlin
    // ── Unit testing (painter flavor) ──
    testImplementation("junit:junit:4.13.2")
    testImplementation("io.mockk:mockk:1.13.13")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.1")
    testImplementation("org.jetbrains.kotlin:kotlin-test:2.0.21")
```

- [ ] **Step 2: Create the test source set folder**

Run from repo root:
```bash
mkdir -p "app/src/testPainter/java/com/qcpaintshop/painter"
touch "app/src/testPainter/java/com/qcpaintshop/painter/.gitkeep"
```

- [ ] **Step 3: Sync and verify Gradle picks up the new source set**

Run from repo root:
```bash
./gradlew :app:testPainterReleaseUnitTest --no-daemon 2>&1 | tail -20
```
Expected: `BUILD SUCCESSFUL` with `0 actionable tasks` (no tests yet, but Gradle resolves the new source set without error).

- [ ] **Step 4: Commit**

```bash
git add app/build.gradle.kts "app/src/testPainter/java/com/qcpaintshop/painter/.gitkeep"
git commit -m "chore(painter-fcm): add JUnit/MockK/coroutines-test deps + testPainter source set

Enables painter-flavor unit tests for the upcoming FCM rewrite.
No tests yet — infra only."
```

---

## Task 2: NotificationDeepLink sealed class + tests (TDD)

**Files:**
- Test: `app/src/testPainter/java/com/qcpaintshop/painter/data/fcm/NotificationDeepLinkTest.kt`
- Create: `app/src/painter/java/com/qcpaintshop/painter/data/fcm/NotificationDeepLink.kt`

- [ ] **Step 1: Write the failing test**

Create `app/src/testPainter/java/com/qcpaintshop/painter/data/fcm/NotificationDeepLinkTest.kt`:

```kotlin
package com.qcpaintshop.painter.data.fcm

import android.content.Intent
import com.qcpaintshop.painter.navigation.Routes
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NotificationDeepLinkTest {

    // ── fromPayload — happy paths for every backend type ──

    @Test fun `estimate_approved with id maps to Estimate`() =
        assertEquals(NotificationDeepLink.Estimate(42),
            NotificationDeepLink.fromPayload(mapOf("type" to "estimate_approved", "estimate_id" to "42")))

    @Test fun `estimate_rejected with id maps to Estimate`() =
        assertEquals(NotificationDeepLink.Estimate(7),
            NotificationDeepLink.fromPayload(mapOf("type" to "estimate_rejected", "estimate_id" to "7")))

    @Test fun `estimate_sent maps to Estimate`() =
        assertEquals(NotificationDeepLink.Estimate(1),
            NotificationDeepLink.fromPayload(mapOf("type" to "estimate_sent", "estimate_id" to "1")))

    @Test fun `estimate_final_approved maps to Estimate`() =
        assertEquals(NotificationDeepLink.Estimate(99),
            NotificationDeepLink.fromPayload(mapOf("type" to "estimate_final_approved", "estimate_id" to "99")))

    @Test fun `estimate_payment_recorded maps to Estimate`() =
        assertEquals(NotificationDeepLink.Estimate(15),
            NotificationDeepLink.fromPayload(mapOf("type" to "estimate_payment_recorded", "estimate_id" to "15")))

    @Test fun `estimate_pushed_to_zoho maps to Estimate`() =
        assertEquals(NotificationDeepLink.Estimate(33),
            NotificationDeepLink.fromPayload(mapOf("type" to "estimate_pushed_to_zoho", "estimate_id" to "33")))

    @Test fun `points_earned maps to Points`() =
        assertEquals(NotificationDeepLink.Points,
            NotificationDeepLink.fromPayload(mapOf("type" to "points_earned")))

    @Test fun `withdrawal_approved maps to Points`() =
        assertEquals(NotificationDeepLink.Points,
            NotificationDeepLink.fromPayload(mapOf("type" to "withdrawal_approved")))

    @Test fun `withdrawal_rejected maps to Points`() =
        assertEquals(NotificationDeepLink.Points,
            NotificationDeepLink.fromPayload(mapOf("type" to "withdrawal_rejected")))

    @Test fun `withdrawal_paid maps to Points`() =
        assertEquals(NotificationDeepLink.Points,
            NotificationDeepLink.fromPayload(mapOf("type" to "withdrawal_paid")))

    @Test fun `new_offer maps to Catalog`() =
        assertEquals(NotificationDeepLink.Catalog,
            NotificationDeepLink.fromPayload(mapOf("type" to "new_offer")))

    @Test fun `training_new with id maps to Training`() =
        assertEquals(NotificationDeepLink.Training(5),
            NotificationDeepLink.fromPayload(mapOf("type" to "training_new", "training_id" to "5")))

    @Test fun `attendance_reminder maps to Attendance`() =
        assertEquals(NotificationDeepLink.Attendance,
            NotificationDeepLink.fromPayload(mapOf("type" to "attendance_reminder")))

    // ── fromPayload — fallbacks ──

    @Test fun `unknown type falls back to Inbox`() =
        assertEquals(NotificationDeepLink.Inbox,
            NotificationDeepLink.fromPayload(mapOf("type" to "geofence_violation")))

    @Test fun `missing type falls back to Inbox`() =
        assertEquals(NotificationDeepLink.Inbox,
            NotificationDeepLink.fromPayload(emptyMap()))

    @Test fun `null type falls back to Inbox`() =
        assertEquals(NotificationDeepLink.Inbox,
            NotificationDeepLink.fromPayload(mapOf("title" to "x")))

    @Test fun `estimate with malformed id falls back to Inbox`() =
        assertEquals(NotificationDeepLink.Inbox,
            NotificationDeepLink.fromPayload(mapOf("type" to "estimate_approved", "estimate_id" to "notanint")))

    @Test fun `estimate with missing id falls back to Inbox`() =
        assertEquals(NotificationDeepLink.Inbox,
            NotificationDeepLink.fromPayload(mapOf("type" to "estimate_approved")))

    @Test fun `training with malformed id falls back to Inbox`() =
        assertEquals(NotificationDeepLink.Inbox,
            NotificationDeepLink.fromPayload(mapOf("type" to "training_new", "training_id" to "abc")))

    // ── Intent round-trip ──

    @Test fun `encodeIntent then fromIntent yields same Estimate`() {
        val intent = Intent()
        NotificationDeepLink.encodeIntent(intent, NotificationDeepLink.Estimate(123))
        assertEquals(NotificationDeepLink.Estimate(123), NotificationDeepLink.fromIntent(intent))
    }

    @Test fun `encodeIntent then fromIntent yields same Points`() {
        val intent = Intent()
        NotificationDeepLink.encodeIntent(intent, NotificationDeepLink.Points)
        assertEquals(NotificationDeepLink.Points, NotificationDeepLink.fromIntent(intent))
    }

    @Test fun `encodeIntent then fromIntent yields same Training`() {
        val intent = Intent()
        NotificationDeepLink.encodeIntent(intent, NotificationDeepLink.Training(7))
        assertEquals(NotificationDeepLink.Training(7), NotificationDeepLink.fromIntent(intent))
    }

    @Test fun `fromIntent on intent with no extras returns null`() =
        assertNull(NotificationDeepLink.fromIntent(Intent()))

    // ── toRoute ──

    @Test fun `toRoute Estimate returns concrete route`() =
        assertEquals(Routes.EstimateDetail.createRoute(42),
            NotificationDeepLink.toRoute(NotificationDeepLink.Estimate(42)))

    @Test fun `toRoute Points returns Routes_PointsHistory`() =
        assertEquals(Routes.PointsHistory.route, NotificationDeepLink.toRoute(NotificationDeepLink.Points))

    @Test fun `toRoute Catalog returns Routes_Catalog`() =
        assertEquals(Routes.Catalog.route, NotificationDeepLink.toRoute(NotificationDeepLink.Catalog))

    @Test fun `toRoute Training returns concrete route`() =
        assertEquals(Routes.TrainingDetail.createRoute(5),
            NotificationDeepLink.toRoute(NotificationDeepLink.Training(5)))

    @Test fun `toRoute Attendance returns Routes_AttendanceCalendar`() =
        assertEquals(Routes.AttendanceCalendar.route, NotificationDeepLink.toRoute(NotificationDeepLink.Attendance))

    @Test fun `toRoute Inbox returns Routes_Notifications`() =
        assertEquals(Routes.Notifications.route, NotificationDeepLink.toRoute(NotificationDeepLink.Inbox))
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
./gradlew :app:testPainterReleaseUnitTest --tests "com.qcpaintshop.painter.data.fcm.NotificationDeepLinkTest" --no-daemon 2>&1 | tail -10
```
Expected: COMPILE FAIL — `Unresolved reference: NotificationDeepLink`.

- [ ] **Step 3: Implement NotificationDeepLink**

Create `app/src/painter/java/com/qcpaintshop/painter/data/fcm/NotificationDeepLink.kt`:

```kotlin
package com.qcpaintshop.painter.data.fcm

import android.content.Intent
import com.qcpaintshop.painter.navigation.Routes

/**
 * Discriminated representation of where a tapped FCM notification should land.
 * Conversions:
 *   - fromPayload(map): build from FCM data payload (server-side `type` field)
 *   - encodeIntent(intent, link): write extras for the PendingIntent
 *   - fromIntent(intent): read extras back in PainterMainActivity
 *   - toRoute(link): map to a Compose Routes entry for navController.navigate()
 */
sealed class NotificationDeepLink {
    data class Estimate(val id: Int) : NotificationDeepLink()
    data object Points : NotificationDeepLink()
    data object Catalog : NotificationDeepLink()
    data class Training(val id: Int) : NotificationDeepLink()
    data object Attendance : NotificationDeepLink()
    data object Inbox : NotificationDeepLink()      // fallback

    companion object {
        private const val EXTRA_KIND = "fcm_dl_kind"
        private const val EXTRA_ID   = "fcm_dl_id"

        fun fromPayload(data: Map<String, String>): NotificationDeepLink {
            val type = data["type"] ?: return Inbox
            return when (type) {
                "estimate_approved", "estimate_rejected", "estimate_sent",
                "estimate_final_approved", "estimate_payment_recorded",
                "estimate_pushed_to_zoho" -> {
                    val id = data["estimate_id"]?.toIntOrNull() ?: return Inbox
                    Estimate(id)
                }
                "points_earned",
                "withdrawal_approved", "withdrawal_rejected", "withdrawal_paid" -> Points
                "new_offer" -> Catalog
                "training_new" -> {
                    val id = data["training_id"]?.toIntOrNull() ?: return Inbox
                    Training(id)
                }
                "attendance_reminder" -> Attendance
                else -> Inbox
            }
        }

        fun encodeIntent(intent: Intent, link: NotificationDeepLink): Intent {
            when (link) {
                is Estimate    -> { intent.putExtra(EXTRA_KIND, "estimate"); intent.putExtra(EXTRA_ID, link.id) }
                Points         ->   intent.putExtra(EXTRA_KIND, "points")
                Catalog        ->   intent.putExtra(EXTRA_KIND, "catalog")
                is Training    -> { intent.putExtra(EXTRA_KIND, "training"); intent.putExtra(EXTRA_ID, link.id) }
                Attendance     ->   intent.putExtra(EXTRA_KIND, "attendance")
                Inbox          ->   intent.putExtra(EXTRA_KIND, "inbox")
            }
            return intent
        }

        fun fromIntent(intent: Intent): NotificationDeepLink? {
            val kind = intent.getStringExtra(EXTRA_KIND) ?: return null
            return when (kind) {
                "estimate"   -> Estimate(intent.getIntExtra(EXTRA_ID, -1).takeIf { it >= 0 } ?: return Inbox)
                "points"     -> Points
                "catalog"    -> Catalog
                "training"   -> Training(intent.getIntExtra(EXTRA_ID, -1).takeIf { it >= 0 } ?: return Inbox)
                "attendance" -> Attendance
                "inbox"      -> Inbox
                else         -> Inbox
            }
        }

        fun toRoute(link: NotificationDeepLink): String = when (link) {
            is Estimate   -> Routes.EstimateDetail.createRoute(link.id)
            Points        -> Routes.PointsHistory.route
            Catalog       -> Routes.Catalog.route
            is Training   -> Routes.TrainingDetail.createRoute(link.id)
            Attendance    -> Routes.AttendanceCalendar.route
            Inbox         -> Routes.Notifications.route
        }
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
./gradlew :app:testPainterReleaseUnitTest --tests "com.qcpaintshop.painter.data.fcm.NotificationDeepLinkTest" --no-daemon 2>&1 | tail -10
```
Expected: `BUILD SUCCESSFUL` with all 31 tests passing.

- [ ] **Step 5: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/data/fcm/NotificationDeepLink.kt \
        app/src/testPainter/java/com/qcpaintshop/painter/data/fcm/NotificationDeepLinkTest.kt
git commit -m "feat(painter-fcm): NotificationDeepLink sealed class + parser

Maps 12 backend FCM type strings (estimate_*, withdrawal_*, points_earned,
new_offer, training_new, attendance_reminder) to native Compose routes.
Falls back to Routes.Notifications inbox for unknown / malformed payloads.

31 unit tests pass."
```

---

## Task 3: FcmTokenSource interface + Firebase impl

**Files:**
- Create: `app/src/painter/java/com/qcpaintshop/painter/data/fcm/FcmTokenSource.kt`

- [ ] **Step 1: Implement the interface + production impl**

Create `app/src/painter/java/com/qcpaintshop/painter/data/fcm/FcmTokenSource.kt`:

```kotlin
package com.qcpaintshop.painter.data.fcm

import com.google.firebase.messaging.FirebaseMessaging
import kotlinx.coroutines.tasks.await
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Testable seam over FirebaseMessaging.getInstance().token.
 * Production implementation calls Firebase; tests provide a fake.
 */
interface FcmTokenSource {
    suspend fun getToken(): String
}

@Singleton
class FirebaseFcmTokenSource @Inject constructor() : FcmTokenSource {
    override suspend fun getToken(): String =
        FirebaseMessaging.getInstance().token.await()
}
```

- [ ] **Step 2: Verify the file compiles via the existing assembleRelease build**

```bash
./gradlew :app:assemblePainterRelease --no-daemon 2>&1 | tail -8
```
Expected: `BUILD SUCCESSFUL`. (No new tests needed — production impl is a thin Firebase adapter; testability is achieved via the interface, not by testing the adapter itself.)

If the build fails on `kotlinx.coroutines.tasks.await` import: add to `dependencies` in `app/build.gradle.kts`:
```kotlin
implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.8.1")
```
…then re-run the build.

- [ ] **Step 3: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/data/fcm/FcmTokenSource.kt
# also add build.gradle.kts only if you had to add the play-services coroutines dep
git status --short  # confirm scope before committing
git commit -m "feat(painter-fcm): FcmTokenSource interface + Firebase impl

Testable seam around FirebaseMessaging.getInstance().token so
FcmTokenManager unit tests can inject a fake."
```

---

## Task 4: Fix FcmTokenRequest DTO + add unregister endpoint

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/data/remote/api/NotificationApi.kt:23-40`

The existing `FcmTokenRequest` ships `{ token, platform }` but backend `routes/painters.js:2743` reads `req.body.fcm_token`. This is a latent P0 — even if PNTR-02's missing caller had existed, the request would have 400'd. Fixing here so the rest of the plan works.

- [ ] **Step 1: Replace FcmTokenRequest + add unregisterFcmToken**

Edit `app/src/painter/java/com/qcpaintshop/painter/data/remote/api/NotificationApi.kt`. Replace the entire file contents with:

```kotlin
package com.qcpaintshop.painter.data.remote.api

import com.google.gson.annotations.SerializedName
import retrofit2.Response
import retrofit2.http.*

data class NotificationsResponse(
    val success: Boolean,
    val notifications: List<AppNotification>?,
    @SerializedName("unread_count") val unreadCount: Int?,
)

data class AppNotification(
    val id: Int,
    val type: String?,
    val title: String?,
    val body: String?,
    val data: Map<String, Any>?,
    val read: Boolean?,
    @SerializedName("created_at") val createdAt: String?,
)

data class FcmTokenRequest(
    @SerializedName("fcm_token") val fcmToken: String,
    @SerializedName("device_info") val deviceInfo: Map<String, String>? = null,
)

interface NotificationApi {
    @GET("me/notifications")
    suspend fun getNotifications(
        @Query("limit") limit: Int = 50,
        @Query("unread") unread: Int? = null,
    ): Response<NotificationsResponse>

    @POST("me/fcm/register")
    suspend fun registerFcmToken(@Body request: FcmTokenRequest): Response<GenericResponse>

    @HTTP(method = "DELETE", path = "me/fcm/unregister", hasBody = true)
    suspend fun unregisterFcmToken(@Body request: FcmTokenRequest): Response<GenericResponse>

    @PUT("me/notifications/{id}/read")
    suspend fun markAsRead(@Path("id") id: Int): Response<GenericResponse>
}
```

- [ ] **Step 2: Verify the file compiles**

```bash
./gradlew :app:compilePainterReleaseKotlin --no-daemon 2>&1 | tail -8
```
Expected: `BUILD SUCCESSFUL`. (No call sites yet — current grep shows zero callers of `FcmTokenRequest`, so the type change is safe.)

- [ ] **Step 3: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/data/remote/api/NotificationApi.kt
git commit -m "fix(painter-fcm): FcmTokenRequest field name + add unregister endpoint

Backend reads req.body.fcm_token (routes/painters.js:2743) but the DTO
was sending { token, platform }. Renamed to fcm_token via @SerializedName,
dropped platform, added optional device_info per backend's accepted shape.

Also added unregisterFcmToken (DELETE /me/fcm/unregister) using @HTTP
annotation since Retrofit @DELETE doesn't accept a body."
```

---

## Task 5: FcmTokenManager + tests (TDD)

**Files:**
- Test: `app/src/testPainter/java/com/qcpaintshop/painter/data/fcm/FcmTokenManagerTest.kt`
- Create: `app/src/painter/java/com/qcpaintshop/painter/data/fcm/FcmTokenManager.kt`

- [ ] **Step 1: Write the failing test**

Create `app/src/testPainter/java/com/qcpaintshop/painter/data/fcm/FcmTokenManagerTest.kt`:

```kotlin
package com.qcpaintshop.painter.data.fcm

import com.qcpaintshop.painter.data.local.datastore.UserPreferences
import com.qcpaintshop.painter.data.remote.api.FcmTokenRequest
import com.qcpaintshop.painter.data.remote.api.GenericResponse
import com.qcpaintshop.painter.data.remote.api.NotificationApi
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import retrofit2.Response
import java.io.IOException

class FcmTokenManagerTest {

    private lateinit var api: NotificationApi
    private lateinit var prefs: UserPreferences
    private lateinit var source: FcmTokenSource
    private lateinit var manager: FcmTokenManager

    private val isLoggedInFlow = MutableStateFlow(true)
    private val fcmTokenFlow   = MutableStateFlow<String?>(null)
    private val pendingFlow    = MutableStateFlow(false)

    @Before
    fun setUp() {
        api = mockk()
        prefs = mockk()
        source = mockk()

        coEvery { prefs.isLoggedIn } returns isLoggedInFlow
        coEvery { prefs.fcmToken } returns fcmTokenFlow
        coEvery { prefs.pendingFcmRegister } returns pendingFlow
        coEvery { prefs.setFcmToken(any()) } answers { fcmTokenFlow.value = firstArg() }
        coEvery { prefs.clearFcmToken() } answers { fcmTokenFlow.value = null }
        coEvery { prefs.setPendingFcmRegister(any()) } answers { pendingFlow.value = firstArg() }

        manager = FcmTokenManager(api, prefs, source)
    }

    @Test
    fun `registerCurrentToken happy path persists token and clears pending`() = runTest {
        coEvery { source.getToken() } returns "fcm-abc"
        coEvery { api.registerFcmToken(any()) } returns Response.success(GenericResponse(true, "ok"))

        manager.registerCurrentToken()

        coVerify { api.registerFcmToken(FcmTokenRequest(fcmToken = "fcm-abc")) }
        assertEquals("fcm-abc", fcmTokenFlow.value)
        assertEquals(false, pendingFlow.value)
    }

    @Test
    fun `registerCurrentToken IOException sets pending`() = runTest {
        coEvery { source.getToken() } returns "fcm-abc"
        coEvery { api.registerFcmToken(any()) } throws IOException("network")

        manager.registerCurrentToken()

        assertEquals(true, pendingFlow.value)
    }

    @Test
    fun `registerCurrentToken non-200 sets pending`() = runTest {
        coEvery { source.getToken() } returns "fcm-abc"
        coEvery { api.registerFcmToken(any()) } returns
            Response.error(500, okhttp3.ResponseBody.create(null, ""))

        manager.registerCurrentToken()

        assertEquals(true, pendingFlow.value)
    }

    @Test
    fun `registerCurrentToken token-source throws sets pending`() = runTest {
        coEvery { source.getToken() } throws IllegalStateException("Play Services missing")

        manager.registerCurrentToken()

        assertEquals(true, pendingFlow.value)
    }

    @Test
    fun `onTokenRefresh while not logged in only persists locally`() = runTest {
        isLoggedInFlow.value = false

        manager.onTokenRefresh("fcm-new")

        assertEquals("fcm-new", fcmTokenFlow.value)
        coVerify(exactly = 0) { api.registerFcmToken(any()) }
    }

    @Test
    fun `onTokenRefresh while logged in calls register`() = runTest {
        isLoggedInFlow.value = true
        coEvery { api.registerFcmToken(any()) } returns Response.success(GenericResponse(true, "ok"))

        manager.onTokenRefresh("fcm-new")

        coVerify { api.registerFcmToken(FcmTokenRequest(fcmToken = "fcm-new")) }
    }

    @Test
    fun `unregister with token calls DELETE`() = runTest {
        fcmTokenFlow.value = "fcm-old"
        coEvery { api.unregisterFcmToken(any()) } returns Response.success(GenericResponse(true, "ok"))

        manager.unregister()

        coVerify { api.unregisterFcmToken(FcmTokenRequest(fcmToken = "fcm-old")) }
    }

    @Test
    fun `unregister with no token does nothing`() = runTest {
        fcmTokenFlow.value = null

        manager.unregister()

        coVerify(exactly = 0) { api.unregisterFcmToken(any()) }
    }

    @Test
    fun `unregister swallows exceptions`() = runTest {
        fcmTokenFlow.value = "fcm-old"
        coEvery { api.unregisterFcmToken(any()) } throws IOException("network")

        // should not throw
        manager.unregister()
    }

    @Test
    fun `retryIfPending no-op when flag false`() = runTest {
        pendingFlow.value = false

        manager.retryIfPending()

        coVerify(exactly = 0) { source.getToken() }
        coVerify(exactly = 0) { api.registerFcmToken(any()) }
    }

    @Test
    fun `retryIfPending success clears flag`() = runTest {
        pendingFlow.value = true
        coEvery { source.getToken() } returns "fcm-abc"
        coEvery { api.registerFcmToken(any()) } returns Response.success(GenericResponse(true, "ok"))

        manager.retryIfPending()

        assertEquals(false, pendingFlow.value)
        assertEquals("fcm-abc", fcmTokenFlow.value)
    }

    @Test
    fun `retryIfPending failure keeps flag`() = runTest {
        pendingFlow.value = true
        coEvery { source.getToken() } returns "fcm-abc"
        coEvery { api.registerFcmToken(any()) } throws IOException("network")

        manager.retryIfPending()

        assertEquals(true, pendingFlow.value)
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
./gradlew :app:testPainterReleaseUnitTest --tests "com.qcpaintshop.painter.data.fcm.FcmTokenManagerTest" --no-daemon 2>&1 | tail -15
```
Expected: COMPILE FAIL — `Unresolved reference: FcmTokenManager`, also `setFcmToken / clearFcmToken / setPendingFcmRegister / fcmToken / pendingFcmRegister` not found on `UserPreferences`. The latter is expected — those keys come in Task 7. But the manager and its test should compile against TODO Task 7 placeholders. **Defer Task 5 Steps 3-5 until Task 7 lands**, OR sequence Task 7 first.

> **Sub-skill:** sequence Task 7 (UserPreferences keys) BEFORE this step. The plan ordering below already does this — Task 5 here is split into 5a (test stub) + 5b (implementation after Task 7). For execution simplicity, the agent should treat Task 7 as a prerequisite and complete it before returning to this step.

- [ ] **Step 3: Implement FcmTokenManager (after Task 7 lands)**

Create `app/src/painter/java/com/qcpaintshop/painter/data/fcm/FcmTokenManager.kt`:

```kotlin
package com.qcpaintshop.painter.data.fcm

import android.util.Log
import com.qcpaintshop.painter.BuildConfig
import com.qcpaintshop.painter.data.local.datastore.UserPreferences
import com.qcpaintshop.painter.data.remote.api.FcmTokenRequest
import com.qcpaintshop.painter.data.remote.api.NotificationApi
import kotlinx.coroutines.flow.first
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class FcmTokenManager @Inject constructor(
    private val api: NotificationApi,
    private val prefs: UserPreferences,
    private val source: FcmTokenSource,
) {
    /** Called on login success. Best-effort; sets pendingFcmRegister=true on any failure. */
    suspend fun registerCurrentToken() {
        val token = try { source.getToken() } catch (e: Exception) {
            if (BuildConfig.DEBUG) Log.w(TAG, "getToken failed", e)
            prefs.setPendingFcmRegister(true)
            return
        }
        register(token)
    }

    /** Called by FCM service on token rotation. Always persists locally; registers if logged in. */
    suspend fun onTokenRefresh(token: String) {
        prefs.setFcmToken(token)
        if (prefs.isLoggedIn.first()) {
            register(token)
        }
    }

    /** Best-effort logout cleanup. Caller is responsible for clearing prefs after this returns. */
    suspend fun unregister() {
        val token = prefs.fcmToken.first() ?: return
        try {
            val resp = api.unregisterFcmToken(FcmTokenRequest(fcmToken = token))
            if (!resp.isSuccessful && BuildConfig.DEBUG) Log.w(TAG, "unregister non-2xx ${resp.code()}")
        } catch (e: Exception) {
            if (BuildConfig.DEBUG) Log.w(TAG, "unregister failed", e)
        }
    }

    /** Called from MainViewModel.init after auth confirms approved. Cheap insurance against missed onNewToken. */
    suspend fun retryIfPending() {
        if (!prefs.pendingFcmRegister.first()) return
        registerCurrentToken()
    }

    private suspend fun register(token: String) {
        try {
            val resp = api.registerFcmToken(FcmTokenRequest(fcmToken = token))
            if (resp.isSuccessful && resp.body()?.success == true) {
                prefs.setFcmToken(token)
                prefs.setPendingFcmRegister(false)
            } else {
                if (BuildConfig.DEBUG) Log.w(TAG, "register non-2xx ${resp.code()}")
                prefs.setFcmToken(token)            // persist token even on failure — retry uses it
                prefs.setPendingFcmRegister(true)
            }
        } catch (e: Exception) {
            if (BuildConfig.DEBUG) Log.w(TAG, "register failed", e)
            prefs.setFcmToken(token)
            prefs.setPendingFcmRegister(true)
        }
    }

    companion object { private const val TAG = "FcmTokenManager" }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
./gradlew :app:testPainterReleaseUnitTest --tests "com.qcpaintshop.painter.data.fcm.FcmTokenManagerTest" --no-daemon 2>&1 | tail -15
```
Expected: `BUILD SUCCESSFUL` with all 12 tests passing.

- [ ] **Step 5: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/data/fcm/FcmTokenManager.kt \
        app/src/testPainter/java/com/qcpaintshop/painter/data/fcm/FcmTokenManagerTest.kt
git commit -m "feat(painter-fcm): FcmTokenManager — register/refresh/unregister/retry

Hilt @Singleton owning the painter device's FCM token lifecycle.
Persists tokens to DataStore. Sets pendingFcmRegister flag on
network failure for next-app-start retry. All paths swallow
exceptions — never blocks UX.

12 unit tests pass."
```

---

## Task 6: NotificationNavSignal (Hilt singleton SharedFlow)

**Files:**
- Create: `app/src/painter/java/com/qcpaintshop/painter/ui/notifications/NotificationNavSignal.kt`

- [ ] **Step 1: Implement**

Create `app/src/painter/java/com/qcpaintshop/painter/ui/notifications/NotificationNavSignal.kt`:

```kotlin
package com.qcpaintshop.painter.ui.notifications

import com.qcpaintshop.painter.data.fcm.NotificationDeepLink
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Bridge between FCM-tap (PainterMainActivity) and Compose navigation (AppNavigation).
 * replay=1 covers the cold-start gap where the activity emits before AppNavigation has collected.
 * Call consume() after a successful navigation to clear the buffer (avoids re-nav on rotation).
 */
@Singleton
class NotificationNavSignal @Inject constructor() {
    private val _flow = MutableSharedFlow<NotificationDeepLink>(
        replay = 1,
        extraBufferCapacity = 4,
    )
    val flow: SharedFlow<NotificationDeepLink> = _flow.asSharedFlow()

    suspend fun emit(link: NotificationDeepLink) {
        _flow.emit(link)
    }

    fun consume() {
        _flow.resetReplayCache()
    }
}
```

- [ ] **Step 2: Verify the file compiles via assembleRelease**

```bash
./gradlew :app:compilePainterReleaseKotlin --no-daemon 2>&1 | tail -8
```
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 3: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/ui/notifications/NotificationNavSignal.kt
git commit -m "feat(painter-fcm): NotificationNavSignal Hilt-singleton SharedFlow

Bridges FCM-tap intent extras (read by PainterMainActivity) to
AppNavigation's navController.navigate(). replay=1 handles the
cold-start gap before AppNavigation begins collecting."
```

---

## Task 7: UserPreferences — 3 new DataStore keys

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/data/local/datastore/UserPreferences.kt:21-106`

> **Run this BEFORE Task 5** (Task 5's test references these keys).

- [ ] **Step 1: Add keys, getters, setters**

Open `app/src/painter/java/com/qcpaintshop/painter/data/local/datastore/UserPreferences.kt`. Add the 3 new key declarations after the existing `REFERRER_READ` key (around line 33):

Replace this block:
```kotlin
    private val PENDING_REFERRAL_CODE = stringPreferencesKey("pending_referral_code")
    private val REFERRER_READ = booleanPreferencesKey("referrer_read")

    val authToken: Flow<String?> = context.dataStore.data.map { it[AUTH_TOKEN] }
```

With:
```kotlin
    private val PENDING_REFERRAL_CODE = stringPreferencesKey("pending_referral_code")
    private val REFERRER_READ = booleanPreferencesKey("referrer_read")
    private val FCM_TOKEN = stringPreferencesKey("fcm_token")
    private val PENDING_FCM_REGISTER = booleanPreferencesKey("pending_fcm_register")
    private val NOTIFICATION_PERMISSION_ASKED = booleanPreferencesKey("notification_permission_asked")

    val authToken: Flow<String?> = context.dataStore.data.map { it[AUTH_TOKEN] }
```

Add the 3 corresponding `Flow` getters after the existing `referrerRead` flow (around line 47):

Replace this block:
```kotlin
    val referrerRead: Flow<Boolean> = context.dataStore.data.map { it[REFERRER_READ] ?: false }

    suspend fun saveLogin(token: String, id: Int, name: String, phone: String, photo: String?, level: String?) {
```

With:
```kotlin
    val referrerRead: Flow<Boolean> = context.dataStore.data.map { it[REFERRER_READ] ?: false }
    val fcmToken: Flow<String?> = context.dataStore.data.map { it[FCM_TOKEN] }
    val pendingFcmRegister: Flow<Boolean> = context.dataStore.data.map { it[PENDING_FCM_REGISTER] ?: false }
    val notificationPermissionAsked: Flow<Boolean> = context.dataStore.data.map { it[NOTIFICATION_PERMISSION_ASKED] ?: false }

    suspend fun saveLogin(token: String, id: Int, name: String, phone: String, photo: String?, level: String?) {
```

Add the 4 corresponding setters after `setNotificationEstimates` (around line 101):

Replace this block:
```kotlin
    suspend fun setNotificationEstimates(enabled: Boolean) {
        context.dataStore.edit { it[NOTIFICATION_ESTIMATES] = enabled }
    }

    suspend fun clearAll() {
        context.dataStore.edit { it.clear() }
    }
}
```

With:
```kotlin
    suspend fun setNotificationEstimates(enabled: Boolean) {
        context.dataStore.edit { it[NOTIFICATION_ESTIMATES] = enabled }
    }

    suspend fun setFcmToken(token: String) {
        context.dataStore.edit { it[FCM_TOKEN] = token }
    }

    suspend fun clearFcmToken() {
        context.dataStore.edit { it.remove(FCM_TOKEN) }
    }

    suspend fun setPendingFcmRegister(pending: Boolean) {
        context.dataStore.edit { it[PENDING_FCM_REGISTER] = pending }
    }

    suspend fun setNotificationPermissionAsked(asked: Boolean) {
        context.dataStore.edit { it[NOTIFICATION_PERMISSION_ASKED] = asked }
    }

    suspend fun clearAll() {
        context.dataStore.edit { it.clear() }
    }
}
```

> Note: existing `clearAll()` already calls `it.clear()` which wipes ALL keys including the new ones — no extra work needed for logout.

- [ ] **Step 2: Verify it compiles**

```bash
./gradlew :app:compilePainterReleaseKotlin --no-daemon 2>&1 | tail -8
```
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 3: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/data/local/datastore/UserPreferences.kt
git commit -m "feat(painter-fcm): UserPreferences keys for FCM lifecycle

- fcmToken: last-known token registered with backend
- pendingFcmRegister: retry flag, set on register failure
- notificationPermissionAsked: tracks one-shot POST_NOTIFICATIONS prompt"
```

---

## Task 8: Hilt FcmModule (binding for FcmTokenSource interface)

**Files:**
- Create: `app/src/painter/java/com/qcpaintshop/painter/di/FcmModule.kt`

- [ ] **Step 1: Add @Binds module**

Create `app/src/painter/java/com/qcpaintshop/painter/di/FcmModule.kt`:

```kotlin
package com.qcpaintshop.painter.di

import com.qcpaintshop.painter.data.fcm.FcmTokenSource
import com.qcpaintshop.painter.data.fcm.FirebaseFcmTokenSource
import dagger.Binds
import dagger.Module
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
abstract class FcmModule {
    @Binds
    @Singleton
    abstract fun bindFcmTokenSource(impl: FirebaseFcmTokenSource): FcmTokenSource
}
```

- [ ] **Step 2: Verify Hilt graph still resolves**

```bash
./gradlew :app:hiltJavaCompilePainterRelease --no-daemon 2>&1 | tail -8
```
Expected: `BUILD SUCCESSFUL`. (`FcmTokenManager` is not yet injected anywhere, so absence of full graph is OK at this point. Task 9-10 wire it in.)

- [ ] **Step 3: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/di/FcmModule.kt
git commit -m "feat(painter-fcm): Hilt FcmModule binds FcmTokenSource"
```

---

## Task 9: AuthRepository — wire FcmTokenManager on login + logout

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/data/repository/AuthRepository.kt:1-170`

- [ ] **Step 1: Inject manager + call register on login**

Open `app/src/painter/java/com/qcpaintshop/painter/data/repository/AuthRepository.kt`.

Add import at top with the others (after `RegisterRequest`):
```kotlin
import com.qcpaintshop.painter.data.fcm.FcmTokenManager
```

Change the constructor (line 19-23) from:
```kotlin
@Singleton
class AuthRepository @Inject constructor(
    @dagger.hilt.android.qualifiers.ApplicationContext private val context: android.content.Context,
    private val authApi: AuthApi,
    private val userPreferences: UserPreferences
) {
```
To:
```kotlin
@Singleton
class AuthRepository @Inject constructor(
    @dagger.hilt.android.qualifiers.ApplicationContext private val context: android.content.Context,
    private val authApi: AuthApi,
    private val userPreferences: UserPreferences,
    private val fcmTokenManager: FcmTokenManager,
) {
```

In `verifyOtp` (line 71-99), find this block:
```kotlin
                userPreferences.saveLogin(
                    token = body.token,
                    id = body.painter.id,
                    name = body.painter.displayName,
                    phone = body.painter.phone,
                    photo = body.painter.profilePhoto,
                    level = body.painter.level
                )
                // Only start location tracking for approved painters
                if (body.painter.status != "pending") {
                    GeofenceLocationService.startForPainter(context, body.token)
                }
                Result.success(body.painter)
```

Replace with:
```kotlin
                userPreferences.saveLogin(
                    token = body.token,
                    id = body.painter.id,
                    name = body.painter.displayName,
                    phone = body.painter.phone,
                    photo = body.painter.profilePhoto,
                    level = body.painter.level
                )
                // Register FCM token with backend so push notifications can be delivered.
                // Best-effort; sets pendingFcmRegister=true on failure for retry on next app start.
                fcmTokenManager.registerCurrentToken()
                // Only start location tracking for approved painters
                if (body.painter.status != "pending") {
                    GeofenceLocationService.startForPainter(context, body.token)
                }
                Result.success(body.painter)
```

In `logout()` (line 164-167), change:
```kotlin
    suspend fun logout() {
        GeofenceLocationService.stop(context)
        userPreferences.clearAll()
    }
```
To:
```kotlin
    suspend fun logout() {
        GeofenceLocationService.stop(context)
        // Best-effort backend cleanup BEFORE we clear the local token, since the
        // server identifies the device row by its FCM token value.
        fcmTokenManager.unregister()
        userPreferences.clearAll()
    }
```

- [ ] **Step 2: Verify Hilt graph resolves with new dep**

```bash
./gradlew :app:hiltJavaCompilePainterRelease --no-daemon 2>&1 | tail -10
```
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 3: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/data/repository/AuthRepository.kt
git commit -m "feat(painter-fcm): AuthRepository registers FCM on login, unregisters on logout

verifyOtp: after saveLogin, calls fcmTokenManager.registerCurrentToken().
logout: calls fcmTokenManager.unregister() BEFORE clearAll, since server
needs the token to identify which device row to deactivate."
```

---

## Task 10: MainViewModel — retry on app start

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/MainViewModel.kt`

- [ ] **Step 1: Inject manager + call retry on approved**

Open `app/src/painter/java/com/qcpaintshop/painter/MainViewModel.kt`. Add import:
```kotlin
import com.qcpaintshop.painter.data.fcm.FcmTokenManager
```

Change the constructor:
```kotlin
@HiltViewModel
class MainViewModel @Inject constructor(
    private val userPreferences: UserPreferences,
    private val authRepository: AuthRepository,
) : ViewModel() {
```
To:
```kotlin
@HiltViewModel
class MainViewModel @Inject constructor(
    private val userPreferences: UserPreferences,
    private val authRepository: AuthRepository,
    private val fcmTokenManager: FcmTokenManager,
) : ViewModel() {
```

In `init`, change the success branch:
```kotlin
            authRepository.getStatus().fold(
                onSuccess = { resp ->
                    _startupState.value = when (resp.painter?.status) {
                        "pending" -> StartupState.PendingApproval
                        "approved" -> StartupState.LoggedIn
                        else -> StartupState.NotLoggedIn
                    }
                },
                onFailure = {
                    _startupState.value = StartupState.NotLoggedIn
                }
            )
```
To:
```kotlin
            authRepository.getStatus().fold(
                onSuccess = { resp ->
                    _startupState.value = when (resp.painter?.status) {
                        "pending" -> StartupState.PendingApproval
                        "approved" -> StartupState.LoggedIn
                        else -> StartupState.NotLoggedIn
                    }
                    if (resp.painter?.status == "approved") {
                        // Insurance: re-register FCM token if the previous attempt
                        // failed (pendingFcmRegister flag set). Cheap; runs once per app start.
                        fcmTokenManager.retryIfPending()
                    }
                },
                onFailure = {
                    _startupState.value = StartupState.NotLoggedIn
                }
            )
```

- [ ] **Step 2: Verify Hilt resolves**

```bash
./gradlew :app:hiltJavaCompilePainterRelease --no-daemon 2>&1 | tail -8
```
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 3: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/MainViewModel.kt
git commit -m "feat(painter-fcm): MainViewModel retries pending FCM register on app start

Calls fcmTokenManager.retryIfPending() after status==approved.
Picks up devices that failed to register on initial login (offline,
backend down, etc.) without requiring user re-login."
```

---

## Task 11: QCFirebaseMessagingService — painter branch + token refresh hook

**Files:**
- Modify: `app/src/main/java/com/qcpaintshop/act/fcm/QCFirebaseMessagingService.kt:20-179`

This is the largest single edit. Two changes: (a) `@AndroidEntryPoint` + lazy-injected `FcmTokenManager` so painter token refresh hits backend; (b) painter branch in `showNotification` to encode `NotificationDeepLink` extras + target `PainterMainActivity` instead of removed `MainActivity`.

- [ ] **Step 1: Add @AndroidEntryPoint and inject FcmTokenManager**

Open `app/src/main/java/com/qcpaintshop/act/fcm/QCFirebaseMessagingService.kt`. Add imports near the top:

```kotlin
import dagger.Lazy
import dagger.hilt.android.AndroidEntryPoint
import javax.inject.Inject
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
```

> **Important: cross-flavor compile guard.** `FcmTokenManager` only exists in the painter source set. The shared service imports it via the path `com.qcpaintshop.painter.data.fcm.FcmTokenManager`. **The staff and customer flavors will fail to compile** because that path doesn't exist outside the painter source set. Solution: use a typed `Lazy<Any>` wrapper for an interface defined in the main source set, OR gate the inject behind `BuildConfig.APP_TYPE`.

The simplest path: declare a thin `FcmTokenRefreshSink` interface in `app/src/main/java/com/qcpaintshop/act/fcm/FcmTokenRefreshSink.kt`, have `FcmTokenManager` implement it, and inject the interface (interface lives in main source set, so all flavors compile):

Create `app/src/main/java/com/qcpaintshop/act/fcm/FcmTokenRefreshSink.kt`:
```kotlin
package com.qcpaintshop.act.fcm

interface FcmTokenRefreshSink {
    suspend fun onTokenRefresh(token: String)
}
```

Then add to `FcmTokenManager.kt` (Task 5's file): change `class FcmTokenManager @Inject constructor(...)` to `class FcmTokenManager @Inject constructor(...) : com.qcpaintshop.act.fcm.FcmTokenRefreshSink {` and ensure the `onTokenRefresh` method already declared has signature `override suspend fun onTokenRefresh(token: String)`. (No code change to onTokenRefresh body — just add `override`.)

Add binding in `FcmModule.kt` (painter source set):
```kotlin
@Binds
@Singleton
abstract fun bindFcmTokenRefreshSink(impl: FcmTokenManager): com.qcpaintshop.act.fcm.FcmTokenRefreshSink
```

Now in `QCFirebaseMessagingService.kt`, change the class declaration:
```kotlin
class QCFirebaseMessagingService : FirebaseMessagingService() {
```
To:
```kotlin
@AndroidEntryPoint
class QCFirebaseMessagingService : FirebaseMessagingService() {

    @Inject lateinit var tokenSink: Lazy<FcmTokenRefreshSink>

    private val serviceScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
```

Replace `onNewToken`:
```kotlin
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        getSharedPreferences("qc_prefs", MODE_PRIVATE)
            .edit()
            .putString("fcm_token", token)
            .apply()
    }
```
With:
```kotlin
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        // Keep legacy SharedPreferences write for staff/customer flavors that read it.
        getSharedPreferences("qc_prefs", MODE_PRIVATE)
            .edit()
            .putString("fcm_token", token)
            .apply()
        // Painter flavor: hand off to FcmTokenManager via Hilt-bound sink.
        if (BuildConfig.APP_TYPE == "painter") {
            serviceScope.launch {
                runCatching { tokenSink.get().onTokenRefresh(token) }
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        serviceScope.cancel()
    }
```

Add import for cancel:
```kotlin
import kotlinx.coroutines.cancel
```

For staff/customer flavors which DO compile this code but DON'T have the painter binding, Hilt will report a missing binding for `FcmTokenRefreshSink`. Solution: provide a no-op binding in a `main`-source-set Hilt module:

Create `app/src/main/java/com/qcpaintshop/act/fcm/FcmTokenRefreshSinkNoOpModule.kt`:
```kotlin
package com.qcpaintshop.act.fcm

import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

/**
 * No-op fallback for staff/customer flavors that don't need painter-flavor FCM token sync.
 * Painter flavor's FcmModule provides a real binding that overrides this via @Binds order.
 *
 * NOTE: Hilt does not allow duplicate bindings. Painter flavor MUST exclude this module
 * via the `replaces`/conditional flavor pattern, OR this no-op must be gated on APP_TYPE.
 */
@Module
@InstallIn(SingletonComponent::class)
object FcmTokenRefreshSinkNoOpModule {
    @Provides
    @Singleton
    fun provideFallbackSink(): FcmTokenRefreshSink {
        if (com.qcpaintshop.act.BuildConfig.APP_TYPE == "painter") {
            // Should never be hit — painter flavor's FcmModule provides the real impl.
            // But Hilt resolves modules eagerly so we must define this. Throw to surface misconfig.
            throw IllegalStateException(
                "FcmTokenRefreshSinkNoOpModule should not be installed for painter flavor"
            )
        }
        return object : FcmTokenRefreshSink {
            override suspend fun onTokenRefresh(token: String) { /* no-op for staff/customer */ }
        }
    }
}
```

> **Module conflict:** Hilt rejects duplicate `@Provides`/`@Binds` for the same type at the same scope. To avoid this, either: (a) put the no-op module in a flavor-specific source set (`app/src/staff/`, `app/src/customer/`), so only those flavors compile it; OR (b) keep the no-op in `main/` and have the painter flavor's `FcmModule.bindFcmTokenRefreshSink` use `@Binds` — but `@Binds` and `@Provides` for the same type DO collide.
>
> **Pick option (a):** move `FcmTokenRefreshSinkNoOpModule.kt` to `app/src/staff/java/com/qcpaintshop/act/fcm/` and `app/src/customer/java/com/qcpaintshop/act/fcm/` (duplicate file). Painter source set has its own `FcmModule` with the real binding. No conflict because each flavor compiles only its own copy.

Sub-step 1a: Move the no-op module to staff + customer flavors:
```bash
mkdir -p app/src/staff/java/com/qcpaintshop/act/fcm
mkdir -p app/src/customer/java/com/qcpaintshop/act/fcm
mv app/src/main/java/com/qcpaintshop/act/fcm/FcmTokenRefreshSinkNoOpModule.kt \
   app/src/staff/java/com/qcpaintshop/act/fcm/FcmTokenRefreshSinkNoOpModule.kt
cp app/src/staff/java/com/qcpaintshop/act/fcm/FcmTokenRefreshSinkNoOpModule.kt \
   app/src/customer/java/com/qcpaintshop/act/fcm/FcmTokenRefreshSinkNoOpModule.kt
```

- [ ] **Step 2: Add painter branch to showNotification**

In `QCFirebaseMessagingService.kt`, in the `showNotification(...)` method (line 131), replace:
```kotlin
        val fullUrl = if (deepLinkPath.startsWith("http")) deepLinkPath else "https://act.qcpaintshop.com$deepLinkPath"
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            data = android.net.Uri.parse(fullUrl)
        }
```

With (we need access to `message.data` which is in `onMessageReceived`'s scope — refactor: pass the data map down through `showNotification`):

First, change the `showNotification` signature in `QCFirebaseMessagingService.kt`:
- Old: `private fun showNotification(title: String, body: String, deepLinkPath: String, type: String)`
- New: `private fun showNotification(title: String, body: String, deepLinkPath: String, type: String, data: Map<String, String>)`

Update the call site in `onMessageReceived` from:
```kotlin
        showNotification(title, body, deepLink, type)
```
To:
```kotlin
        showNotification(title, body, deepLink, type, message.data)
```

Inside the new `showNotification`, replace the Intent construction block above with:
```kotlin
        val intent = if (BuildConfig.APP_TYPE == "painter") {
            Intent(this, com.qcpaintshop.painter.PainterMainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
                com.qcpaintshop.painter.data.fcm.NotificationDeepLink.encodeIntent(
                    this,
                    com.qcpaintshop.painter.data.fcm.NotificationDeepLink.fromPayload(data)
                )
            }
        } else {
            val fullUrl = if (deepLinkPath.startsWith("http")) deepLinkPath else "https://act.qcpaintshop.com$deepLinkPath"
            Intent(this, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
                data = android.net.Uri.parse(fullUrl)
            }
        }
```

> **Cross-flavor reference:** `com.qcpaintshop.painter.PainterMainActivity` exists only in the painter source set. The shared `app/src/main/` code referencing it WILL fail to compile for staff and customer flavors. Solution: extract the painter-specific Intent construction into a small helper that lives in `app/src/painter/` and replace the block above with a runtime-dispatched call. Concretely:
>
> Create `app/src/painter/java/com/qcpaintshop/painter/data/fcm/PainterFcmIntentBuilder.kt`:
> ```kotlin
> package com.qcpaintshop.painter.data.fcm
> 
> import android.content.Context
> import android.content.Intent
> import com.qcpaintshop.painter.PainterMainActivity
> 
> object PainterFcmIntentBuilder {
>     fun build(ctx: Context, data: Map<String, String>): Intent =
>         Intent(ctx, PainterMainActivity::class.java).apply {
>             flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
>             NotificationDeepLink.encodeIntent(this, NotificationDeepLink.fromPayload(data))
>         }
> }
> ```
>
> Then in the shared service use reflection to call it, gated on `BuildConfig.APP_TYPE == "painter"`:
>
> Replace the painter-branch block in `showNotification` with:
> ```kotlin
>         val intent = if (BuildConfig.APP_TYPE == "painter") {
>             // Reflection avoids hard-linking the painter-only class from shared code.
>             val cls = Class.forName("com.qcpaintshop.painter.data.fcm.PainterFcmIntentBuilder")
>             val instance = cls.getField("INSTANCE").get(null)
>             val method = cls.getMethod("build", android.content.Context::class.java, Map::class.java)
>             method.invoke(instance, this, data) as Intent
>         } else {
>             val fullUrl = if (deepLinkPath.startsWith("http")) deepLinkPath else "https://act.qcpaintshop.com$deepLinkPath"
>             Intent(this, MainActivity::class.java).apply {
>                 flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
>                 data = android.net.Uri.parse(fullUrl)
>             }
>         }
> ```
>
> Reflection cost is negligible (one notification per push) and `PainterFcmIntentBuilder` IS in the painter APK at runtime — `Class.forName` succeeds. Add R8 keep rule to prevent stripping (Step 4 below).

- [ ] **Step 3: Add ProGuard keep rule for the reflection target**

Open `app/proguard-rules.pro`. After the existing `-keep class com.qcpaintshop.painter.data.remote.api.** { *; }` line, add:
```
# Reflection from shared QCFirebaseMessagingService when running painter flavor
-keep class com.qcpaintshop.painter.data.fcm.PainterFcmIntentBuilder { *; }
-keep class com.qcpaintshop.painter.PainterMainActivity { *; }
```

- [ ] **Step 4: Verify all flavors build**

```bash
./gradlew :app:assemblePainterRelease :app:compileStaffReleaseKotlin :app:compileCustomerReleaseKotlin --no-daemon 2>&1 | tail -15
```
Expected: `BUILD SUCCESSFUL`. (We compile staff/customer to confirm they aren't broken; full assembleRelease for painter so we hit R8 with the new keep rule.)

- [ ] **Step 5: Commit**

```bash
git add app/src/main/java/com/qcpaintshop/act/fcm/QCFirebaseMessagingService.kt \
        app/src/main/java/com/qcpaintshop/act/fcm/FcmTokenRefreshSink.kt \
        app/src/staff/java/com/qcpaintshop/act/fcm/FcmTokenRefreshSinkNoOpModule.kt \
        app/src/customer/java/com/qcpaintshop/act/fcm/FcmTokenRefreshSinkNoOpModule.kt \
        app/src/painter/java/com/qcpaintshop/painter/data/fcm/PainterFcmIntentBuilder.kt \
        app/src/painter/java/com/qcpaintshop/painter/data/fcm/FcmTokenManager.kt \
        app/src/painter/java/com/qcpaintshop/painter/di/FcmModule.kt \
        app/proguard-rules.pro
git commit -m "feat(painter-fcm): wire FCM service to painter Compose nav

- Add @AndroidEntryPoint to QCFirebaseMessagingService
- Inject FcmTokenRefreshSink (interface in main source set, painter
  binds FcmTokenManager, staff/customer have no-op fallback module
  in their respective flavor source sets — avoids Hilt duplicate bindings)
- onNewToken delegates to sink for painter flavor
- showNotification branches on BuildConfig.APP_TYPE: painter target =
  PainterMainActivity, encodes NotificationDeepLink in extras
  (no dead web URLs); staff/customer existing flow unchanged
- Reflection bridge for painter PainterFcmIntentBuilder + ProGuard
  keep rules (avoids hard cross-flavor link)"
```

---

## Task 12: PainterMainActivity — read intent + onNewIntent + permission prompt host

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/PainterMainActivity.kt`

- [ ] **Step 1: Inject signal + read intent + override onNewIntent**

Open `app/src/painter/java/com/qcpaintshop/painter/PainterMainActivity.kt`. Add imports:
```kotlin
import android.content.Intent
import com.qcpaintshop.painter.data.fcm.NotificationDeepLink
import com.qcpaintshop.painter.ui.notifications.NotificationNavSignal
import androidx.lifecycle.lifecycleScope
```

Inside the class, after the existing `userPreferences` field, add:
```kotlin
    @Inject
    lateinit var notificationNavSignal: NotificationNavSignal
```

Modify `onCreate(savedInstanceState: Bundle?)`. The existing body is:
```kotlin
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        readInstallReferrerIfNeeded()
        setContent {
            QCPainterTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    AppNavigation()
                }
            }
        }
    }
```

Replace with:
```kotlin
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        readInstallReferrerIfNeeded()
        // Cold-start FCM tap: if launched from a notification, decode the deep-link
        // and emit it onto the SharedFlow. AppNavigation will collect after composition.
        emitNotificationDeepLinkIfPresent(intent)
        setContent {
            QCPainterTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    AppNavigation()
                }
            }
        }
    }

    /**
     * Warm-start FCM tap: existing activity (launchMode="singleTask") receives
     * a new intent without onCreate. Update the activity's intent so subsequent
     * getIntent() returns the new one, and emit its deep link.
     */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        emitNotificationDeepLinkIfPresent(intent)
    }

    private fun emitNotificationDeepLinkIfPresent(intent: Intent?) {
        intent ?: return
        val link = NotificationDeepLink.fromIntent(intent) ?: return
        lifecycleScope.launch { notificationNavSignal.emit(link) }
    }
```

(`launch` is already imported via `kotlinx.coroutines.launch`. `lifecycleScope` is the new import.)

- [ ] **Step 2: Verify compile + Hilt graph**

```bash
./gradlew :app:hiltJavaCompilePainterRelease --no-daemon 2>&1 | tail -8
```
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 3: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/PainterMainActivity.kt
git commit -m "feat(painter-fcm): PainterMainActivity reads FCM intent + onNewIntent

Decodes NotificationDeepLink from launching/incoming intent and emits
to NotificationNavSignal. Covers cold-start (onCreate) and warm-start
(onNewIntent — fires on existing instance because launchMode=singleTask)."
```

---

## Task 13: AppNavigation — collect signal + navigate

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/navigation/AppNavigation.kt:77-389` (the `AppNavigation` composable body)

- [ ] **Step 1: Inject signal via EntryPointAccessors and collect**

Open `app/src/painter/java/com/qcpaintshop/painter/navigation/AppNavigation.kt`. Add imports:
```kotlin
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.platform.LocalContext
import com.qcpaintshop.painter.data.fcm.NotificationDeepLink
import com.qcpaintshop.painter.ui.notifications.NotificationNavSignal
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
```

At the bottom of the file (outside the `AppNavigation` composable), add the entry-point declaration so we can pull the signal from a Compose context:
```kotlin
@EntryPoint
@InstallIn(SingletonComponent::class)
interface NotificationNavSignalEntryPoint {
    fun notificationNavSignal(): NotificationNavSignal
}
```

Inside the `AppNavigation` composable, after the `val mainTabs = listOf(...)` line (around line 100), add:
```kotlin
    val context = LocalContext.current
    val notificationNavSignal = remember {
        EntryPointAccessors
            .fromApplication(context.applicationContext, NotificationNavSignalEntryPoint::class.java)
            .notificationNavSignal()
    }
    LaunchedEffect(Unit) {
        notificationNavSignal.flow.collect { link ->
            // Guard: only navigate when on a main app screen (not auth flow).
            if (currentRoute in mainTabs ||
                currentRoute == Routes.EstimateDetail.route ||
                currentRoute == Routes.PointsHistory.route ||
                currentRoute == Routes.AttendanceCalendar.route ||
                currentRoute == Routes.TrainingDetail.route ||
                currentRoute == Routes.Notifications.route
            ) {
                navController.navigate(NotificationDeepLink.toRoute(link)) {
                    launchSingleTop = true
                }
                notificationNavSignal.consume()
            }
            // else: user is in Login / AwaitingApproval / Register — ignore until they navigate
            // into a main screen. The replay buffer holds the link for that future moment.
        }
    }
```

- [ ] **Step 2: Verify Compose + Hilt build**

```bash
./gradlew :app:assemblePainterRelease --no-daemon 2>&1 | tail -10
```
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 3: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/navigation/AppNavigation.kt
git commit -m "feat(painter-fcm): AppNavigation collects NotificationNavSignal

LaunchedEffect collects deep-link emissions; guards against navigation
during auth screens (replay buffer holds emission until user reaches
a main screen)."
```

---

## Task 14: NotificationPermissionPrompt + SettingsScreen Notifications section

**Files:**
- Create: `app/src/painter/java/com/qcpaintshop/painter/ui/notifications/NotificationPermissionPrompt.kt`
- Modify: `app/src/painter/java/com/qcpaintshop/painter/ui/profile/SettingsScreen.kt` (add Notifications section)
- Modify: `app/src/painter/java/com/qcpaintshop/painter/PainterMainActivity.kt` (host the permission flow)

- [ ] **Step 1: Create the permission prompt composable**

Create `app/src/painter/java/com/qcpaintshop/painter/ui/notifications/NotificationPermissionPrompt.kt`:

```kotlin
package com.qcpaintshop.painter.ui.notifications

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import com.qcpaintshop.painter.data.local.datastore.UserPreferences
import dagger.hilt.EntryPoint
import dagger.hilt.InstallIn
import dagger.hilt.android.EntryPointAccessors
import dagger.hilt.components.SingletonComponent
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

@EntryPoint
@InstallIn(SingletonComponent::class)
interface UserPreferencesEntryPoint {
    fun userPreferences(): UserPreferences
}

/**
 * Shown ONCE after first painter login on Android 13+ devices that haven't been asked.
 * Either choice (grant or skip) marks notificationPermissionAsked=true so it never re-shows.
 */
@Composable
fun NotificationPermissionPrompt() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return
    val context = LocalContext.current
    val prefs = remember {
        EntryPointAccessors
            .fromApplication(context.applicationContext, UserPreferencesEntryPoint::class.java)
            .userPreferences()
    }
    val asked by prefs.notificationPermissionAsked.collectAsState(initial = true)
    val scope = rememberCoroutineScope()
    var visible by remember { mutableStateOf(false) }

    LaunchedEffect(asked) {
        if (asked) return@LaunchedEffect
        val granted = ContextCompat.checkSelfPermission(
            context, Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
        if (granted) {
            scope.launch { prefs.setNotificationPermissionAsked(true) }
        } else {
            visible = true
        }
    }

    if (!visible) return

    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {
        // user's grant/deny choice — either way, we asked once
        scope.launch { prefs.setNotificationPermissionAsked(true) }
        visible = false
    }

    AlertDialog(
        onDismissRequest = {
            scope.launch { prefs.setNotificationPermissionAsked(true) }
            visible = false
        },
        title = { Text("Get notified about your business") },
        text = {
            Text(
                "Receive estimate approvals, points earned, withdrawal updates, " +
                "and exclusive offers as soon as they happen. You can change " +
                "this anytime in Settings."
            )
        },
        confirmButton = {
            TextButton(onClick = {
                launcher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }) { Text("Enable") }
        },
        dismissButton = {
            TextButton(onClick = {
                scope.launch { prefs.setNotificationPermissionAsked(true) }
                visible = false
            }) { Text("Not now") }
        },
    )
}
```

- [ ] **Step 2: Render the prompt from PainterMainActivity**

Open `app/src/painter/java/com/qcpaintshop/painter/PainterMainActivity.kt`. Add import:
```kotlin
import com.qcpaintshop.painter.ui.notifications.NotificationPermissionPrompt
```

Modify the `setContent` block from:
```kotlin
        setContent {
            QCPainterTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    AppNavigation()
                }
            }
        }
```

To:
```kotlin
        setContent {
            QCPainterTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    AppNavigation()
                    NotificationPermissionPrompt()
                }
            }
        }
```

(The prompt internally checks SDK + asked flag and is a no-op when not needed.)

- [ ] **Step 3: Add Notifications section to SettingsScreen**

Open `app/src/painter/java/com/qcpaintshop/painter/ui/profile/SettingsScreen.kt`. The existing screen has settings rows. We're adding ONE new section. Read the file first to find the rendering pattern, then insert. Specifically:

a. Add imports at top of `SettingsScreen.kt`:
```kotlin
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.ContextCompat
import androidx.compose.runtime.collectAsState
import androidx.compose.material3.Switch
```

b. Find where existing setting rows are rendered (look for the first row inside the `Column`/`LazyColumn` of the Scaffold body) and insert the Notifications section. For a robust insertion: locate `viewModel: SettingsViewModel = hiltViewModel()`, then immediately after the existing State collection, insert:

```kotlin
    // Notification settings (FCM)
    val notifEnabled by viewModel.userPreferences.notificationsEnabled.collectAsState(initial = true)
    val notifPoints  by viewModel.userPreferences.notificationPoints.collectAsState(initial = true)
    val notifEst     by viewModel.userPreferences.notificationEstimates.collectAsState(initial = true)
    val ctx = LocalContext.current
    val notifGranted = remember {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) true
        else ContextCompat.checkSelfPermission(
            ctx, Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
    }
```

…and inside the screen's Column add:
```kotlin
    Surface(modifier = Modifier.fillMaxWidth().padding(top = 16.dp)) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text("Notifications", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(8.dp))

            if (!notifGranted) {
                OutlinedButton(onClick = {
                    val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                        putExtra(Settings.EXTRA_APP_PACKAGE, ctx.packageName)
                    }
                    ctx.startActivity(intent)
                }) {
                    Text("Enable in system settings")
                }
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("All notifications", modifier = Modifier.weight(1f))
                    Switch(checked = notifEnabled, onCheckedChange = { viewModel.setNotificationsEnabled(it) })
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Points earned", modifier = Modifier.weight(1f))
                    Switch(checked = notifPoints, enabled = notifEnabled,
                           onCheckedChange = { viewModel.setNotificationPoints(it) })
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Estimate updates", modifier = Modifier.weight(1f))
                    Switch(checked = notifEst, enabled = notifEnabled,
                           onCheckedChange = { viewModel.setNotificationEstimates(it) })
                }
            }
        }
    }
```

> **`SettingsViewModel` exposure:** the existing VM may not surface `userPreferences` and the `setNotification*` methods. Check the file. If those are missing, add them as thin pass-throughs:
> ```kotlin
> val userPreferences: UserPreferences get() = userPrefs   // expose for direct flow collection
> fun setNotificationsEnabled(v: Boolean) = viewModelScope.launch { userPrefs.setNotificationsEnabled(v) }
> fun setNotificationPoints(v: Boolean)   = viewModelScope.launch { userPrefs.setNotificationPoints(v) }
> fun setNotificationEstimates(v: Boolean)= viewModelScope.launch { userPrefs.setNotificationEstimates(v) }
> ```

- [ ] **Step 4: Build and verify**

```bash
./gradlew :app:assemblePainterRelease --no-daemon 2>&1 | tail -10
```
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 5: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/ui/notifications/NotificationPermissionPrompt.kt \
        app/src/painter/java/com/qcpaintshop/painter/PainterMainActivity.kt \
        app/src/painter/java/com/qcpaintshop/painter/ui/profile/SettingsScreen.kt \
        app/src/painter/java/com/qcpaintshop/painter/ui/profile/SettingsViewModel.kt
git commit -m "feat(painter-fcm): runtime POST_NOTIFICATIONS prompt + Settings toggles

- NotificationPermissionPrompt: one-shot AlertDialog after first login
  on Android 13+; persists notificationPermissionAsked regardless of grant
- SettingsScreen: Notifications section with 3 toggles wired to existing
  UserPreferences keys; if denied, [Enable] opens system app-settings"
```

---

## Task 15: ApiClient logging gate (audit P0 NET-05 piggyback)

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/data/remote/api/ApiClient.kt:25-40`

- [ ] **Step 1: Gate BODY level behind BuildConfig.DEBUG**

Open `app/src/painter/java/com/qcpaintshop/painter/data/remote/api/ApiClient.kt`. Add import:
```kotlin
import com.qcpaintshop.painter.BuildConfig
```

Replace the existing `createRetrofit` body. From:
```kotlin
    fun createRetrofit(authInterceptor: AuthInterceptor): Retrofit {
        val logging = HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BODY
        }
        val client = OkHttpClient.Builder()
            .addInterceptor(authInterceptor)
            .addInterceptor(logging)
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build()
        return Retrofit.Builder()
            .baseUrl(BASE_URL)
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
    }
```

To:
```kotlin
    fun createRetrofit(authInterceptor: AuthInterceptor): Retrofit {
        val logging = HttpLoggingInterceptor().apply {
            // Release builds must NOT log request/response bodies — would leak
            // OTPs, JWT tokens, and PII to logcat (audit finding NET-05 / pattern 18).
            level = if (BuildConfig.DEBUG) HttpLoggingInterceptor.Level.BODY
                    else HttpLoggingInterceptor.Level.NONE
        }
        val client = OkHttpClient.Builder()
            .addInterceptor(authInterceptor)
            .addInterceptor(logging)
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build()
        return Retrofit.Builder()
            .baseUrl(BASE_URL)
            .client(client)
            .addConverterFactory(GsonConverterFactory.create())
            .build()
    }
```

- [ ] **Step 2: Verify the file compiles**

```bash
./gradlew :app:compilePainterReleaseKotlin --no-daemon 2>&1 | tail -8
```
Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 3: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/data/remote/api/ApiClient.kt
git commit -m "fix(painter-fcm): gate HttpLoggingInterceptor BODY behind BuildConfig.DEBUG

Audit P0 NET-05 (pattern 18). Release APKs were dumping every API
request/response (including OTPs and JWTs) to logcat. Now only debug
builds log bodies; release builds use Level.NONE."
```

---

## Task 16: Final clean build + run all tests + manual E2E checklist

**Files:** none (verification + documentation)

- [ ] **Step 1: Clean build of painter release APK**

```bash
./gradlew clean :app:assemblePainterRelease --no-daemon --warning-mode all 2>&1 | tee audit-findings/2026-04-25/build-log-fcm-fix.txt | tail -20
```
Expected: `BUILD SUCCESSFUL`. APK at `app/build/outputs/apk/painter/release/app-painter-release.apk`. Confirm size < 15 MB:
```bash
ls -la app/build/outputs/apk/painter/release/app-painter-release.apk
```

- [ ] **Step 2: Run all unit tests**

```bash
./gradlew :app:testPainterReleaseUnitTest --no-daemon 2>&1 | tail -25
```
Expected: 43 tests pass (31 NotificationDeepLink + 12 FcmTokenManager). 0 failures.

- [ ] **Step 3: Verify staff and customer flavors still build (regression check)**

```bash
./gradlew :app:compileStaffReleaseKotlin :app:compileCustomerReleaseKotlin --no-daemon 2>&1 | tail -10
```
Expected: `BUILD SUCCESSFUL`. (Both flavors must compile; the cross-flavor `FcmTokenRefreshSink` no-op binding pattern protects them.)

- [ ] **Step 4: Write E2E manual checklist**

Create `audit-findings/2026-04-25/E2E-FCM-CHECKLIST.md`:

```markdown
# Painter FCM E2E Manual Verification Checklist

Run on a physical Android device with Google Play Services, signed-in painter account.

## Setup
- [ ] Sideload `app-painter-release.apk` onto Android 13+ device
- [ ] Open Firebase Console → project qcpaintshop → Cloud Messaging
- [ ] Have backend `painter-notification-service.js` available to dispatch real notifications

## Tests

| # | Action | Expected |
|---|---|---|
| 1 | Fresh install → login with painter phone → enter OTP | App opens to Home; permission prompt appears (Android 13+ only) |
| 2 | (continuing #1) tap Enable | OS prompt appears; grant access; app proceeds |
| 3 | Check `painters.painter_fcm_tokens` table on backend | Row exists for this painter with the device's token |
| 4 | Send test push from Firebase Console with payload `{type: "estimate_approved", estimate_id: "1", title: "Test", body: "Test"}` | Notification arrives within seconds |
| 5 | Tap notification from #4 | App opens to `EstimateDetail` for id=1 (verify the screen shows estimate #1's data, not Home) |
| 6 | Repeat #4-#5 for each backend type: `points_earned`, `withdrawal_paid`, `new_offer`, `training_new` (with id), `attendance_reminder` | Each lands on the documented Compose route (Q2 mapping in spec) |
| 7 | (Android 13+) Re-install app → at OTP screen, send a push from backend | Push silently dropped (no permission yet); confirmed by absence of UI |
| 8 | (continuing #7) Login → on prompt, tap "Not now" | Permission asked once persisted; subsequent prompts do not re-show |
| 9 | (continuing #8) Settings → Notifications section → tap "Enable in system settings" | System app-info screen opens |
| 10 | Toggle ON in system → return to app → send push | Notification now arrives |
| 11 | Login on Device A; same painter logs in on Device B → send push from backend | Both devices receive (multi-device support — backend has multi-row support per painter) |
| 12 | Tap Logout on Device A → send push from backend | Device A no longer receives notification (`is_active = 0` on device A's row) |
| 13 | Enable airplane mode → login → exit airplane mode → kill+reopen app | `pendingFcmRegister` retry path runs, token now appears in painter_fcm_tokens |
| 14 | Disable Play Services on emulator → install + login | App functional, no crash; `pendingFcmRegister` set true; debug log shows getToken failure |
| 15 | Tap a notification while logged out (rare race) | App lands on Login screen; notification deep-link buffered; after re-login the buffered nav fires (verify by ensuring user lands on intended screen, not Home) |

## Acceptance criteria
- [ ] All 15 rows pass
- [ ] No crashes in logcat during any test
- [ ] No PII / tokens visible in `adb logcat *:I` during release-APK testing (audit P0 NET-05)
```

- [ ] **Step 5: Commit checklist + save final build log**

```bash
git add audit-findings/2026-04-25/E2E-FCM-CHECKLIST.md \
        audit-findings/2026-04-25/build-log-fcm-fix.txt
git commit -m "docs(painter-fcm): final build log + 15-row E2E manual checklist

Build: BUILD SUCCESSFUL. APK size: <X.X> MB. 43/43 unit tests pass.
Staff + customer flavors verified non-regressed.

E2E checklist covers happy paths for all 12 notification types,
permission grant/deny lifecycle, multi-device, logout cleanup,
airplane retry path, and Play-Services-missing graceful fallback."
```

---

## Self-review (writer-only — completed before handing off)

- **Spec coverage:** every architecture component, data flow path A-F, error case 1-15, and unit/integration test from the spec maps to a task above.
- **Placeholder scan:** no TBD/TODO; every code block is complete; every command has an explicit "Expected" outcome.
- **Type consistency:** `FcmTokenManager.registerCurrentToken` / `onTokenRefresh` / `unregister` / `retryIfPending` are spelled identically in tests, in the impl, and at the call sites in `AuthRepository` / `MainViewModel`. `NotificationDeepLink.fromPayload` / `encodeIntent` / `fromIntent` / `toRoute` consistent across tests, parser, service, activity, AppNavigation. `UserPreferences.fcmToken` / `pendingFcmRegister` / `notificationPermissionAsked` / their setters consistent across all consumers.
- **Sequencing fix:** Task 5's tests reference UserPreferences keys that come in Task 7; Task 5's text explicitly notes Task 7 is a prerequisite. The agent should run Task 7 before completing Task 5 Step 4 (the test-pass step).
- **Cross-flavor compile traps:** Task 11's text walks through both pitfalls (FcmTokenManager not visible to staff/customer; PainterMainActivity not visible from shared service) and provides the interface-bridge + reflection workarounds with R8 keep rules.
- **Scope:** focused on FCM end-to-end + audit P0 NET-05 piggyback (single-line edit in same area). Loyalty levels (PNTR-04), keystore (SEC-01), Gallery rewire (DATA-09), card regen (PNTR-06), App Links verification (PNTR-05) explicitly out of scope per spec.

---

## Pattern follow-up note (post-merge action)

After this PR ships, propose **Pattern 19** to `~/.claude/skills/painter-android-audit/references/known-bug-patterns.md`:

> **Backend DTO field-name mismatch (P0)**
> Signature: Retrofit `@Body` data class field name `token` (or any `<word>`) but backend route reads `req.body.fcm_token` (or any other key). Cross-check via `grep -rn "req.body.<field>" backend/routes/` against the Android DTO.
> Why: Gson serializes by field name; backend reads by exact key. Mismatch → field undefined server-side → 400 with no Android-side compile or runtime warning.
> Fix: Add `@SerializedName("backend_field_name")` on the camelCase property, or rename to match.

This pattern was found during spec self-review on 2026-04-25, not during the original audit. Adding it strengthens the next audit's Phase 3 backend cross-check.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-25-painter-fcm-fix.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
