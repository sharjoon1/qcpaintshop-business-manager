# Painter App Approval Flow — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Branch painter app entry into 3 paths (approved / pending / unregistered) with a rate-limited "Request Approval" button on the pending screen that tracks painter interest.

**Architecture:** Add 2 columns to `painters` table, a new `requirePainterSession` middleware (allows pending), and a `POST /me/request-approval` endpoint (2-min rate limit). Android: always save session token; route based on `status` returned by a new `GET /me/status` endpoint. Admin UI: Interest column in pending tab.

**Tech Stack:** Backend Express + MySQL. Android Jetpack Compose + Hilt + Retrofit. Admin vanilla JS.

**Spec:** [docs/superpowers/specs/2026-04-23-painter-app-approval-flow-design.md](../specs/2026-04-23-painter-app-approval-flow-design.md)

---

## Phase A — Backend (Tasks A1–A5)

### Task A1: Database migration — approval tracking columns

**Files:**
- Create: `migrations/migrate-painter-approval-tracking.js`

- [ ] **Step 1: Create migration file**

Create `migrations/migrate-painter-approval-tracking.js` with this content:

```javascript
/**
 * Migration: Painter Approval Tracking
 *
 * Alters:
 *   - painters: adds approval_request_count (INT, default 0)
 *   - painters: adds last_approval_request_at (DATETIME, nullable)
 *
 * Run: node migrations/migrate-painter-approval-tracking.js
 */

const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function runStep(pool, label, sql, params = []) {
    try {
        await pool.query(sql, params);
        console.log(`   OK  ${label}`);
        return 'ok';
    } catch (err) {
        const code = err.code || '';
        if (['ER_DUP_FIELDNAME', 'ER_DUP_ENTRY'].includes(code)) {
            console.log(`   SKIP ${label} (${code})`);
            return 'skip';
        }
        console.error(`   FAIL ${label} — ${err.message}`);
        return 'fail';
    }
}

async function migrate() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: 5,
    });

    console.log('▶ Painter approval tracking migration');
    await runStep(pool, 'painters.approval_request_count',
        'ALTER TABLE painters ADD COLUMN approval_request_count INT NOT NULL DEFAULT 0');
    await runStep(pool, 'painters.last_approval_request_at',
        'ALTER TABLE painters ADD COLUMN last_approval_request_at DATETIME NULL');
    console.log('✓ Migration complete');
    await pool.end();
}

migrate().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Run the migration**

```bash
node migrations/migrate-painter-approval-tracking.js
```

Expected output:
```
▶ Painter approval tracking migration
   OK  painters.approval_request_count
   OK  painters.last_approval_request_at
✓ Migration complete
```

(Second run should show `SKIP ... (ER_DUP_FIELDNAME)` — migration is idempotent.)

- [ ] **Step 3: Verify columns exist**

```bash
node -e "require('dotenv').config(); const mysql=require('mysql2/promise'); (async()=>{const p=mysql.createPool({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME}); const [r]=await p.query('DESCRIBE painters'); console.log(r.filter(x=>x.Field.includes('approval'))); await p.end();})()"
```

Expected: 2 rows — `approval_request_count` and `last_approval_request_at`.

- [ ] **Step 4: Commit**

```bash
git add migrations/migrate-painter-approval-tracking.js
git commit -m "feat(painters): add approval tracking columns migration"
```

---

### Task A2: Add `requirePainterSession` middleware (allows pending)

**Files:**
- Modify: `routes/painters.js:141-159` (add new middleware, keep existing)

- [ ] **Step 1: Add the new middleware immediately after `requirePainterAuth`**

In `routes/painters.js`, find the `requirePainterAuth` function (lines 141-159). Add the following function immediately after it:

```javascript
// Accepts pending or approved painters. Used only by self-service
// endpoints that must work while awaiting approval.
async function requirePainterSession(req, res, next) {
    const token = req.headers['x-painter-token'];
    if (!token) return res.status(401).json({ success: false, message: 'Painter authentication required' });

    try {
        const [sessions] = await pool.query(
            'SELECT ps.painter_id, p.status, p.full_name FROM painter_sessions ps JOIN painters p ON ps.painter_id = p.id WHERE ps.token = ? AND ps.expires_at > NOW()',
            [token]
        );
        if (!sessions.length) return res.status(401).json({ success: false, message: 'Invalid or expired session' });

        req.painter = { id: sessions[0].painter_id, name: sessions[0].full_name, status: sessions[0].status };
        next();
    } catch (error) {
        console.error('Painter session auth error:', error);
        res.status(500).json({ success: false, message: 'Authentication error' });
    }
}
```

Note: unlike `requirePainterAuth`, this does NOT reject on `status !== 'approved'`. It also sets `req.painter.status` so downstream handlers can see it.

- [ ] **Step 2: Smoke test — restart server, verify no syntax errors**

```bash
node -c routes/painters.js
```

Expected: no output (= file is valid JS). If the server is running via pm2/nodemon, restart it.

- [ ] **Step 3: Commit**

```bash
git add routes/painters.js
git commit -m "feat(painters): add requirePainterSession middleware for pending painters"
```

---

### Task A3: Standardise `/send-otp` 404 response with error code

**Files:**
- Modify: `routes/painters.js` around line 237 (inside `/send-otp` handler)

- [ ] **Step 1: Update the 404 response body**

In `routes/painters.js`, find this line inside the `/send-otp` handler (around line 237):

```javascript
if (!painters.length) return res.status(404).json({ success: false, message: 'No painter found with this phone number' });
```

Replace with:

```javascript
if (!painters.length) return res.status(404).json({ success: false, code: 'NOT_REGISTERED', message: 'No painter found with this phone number' });
```

- [ ] **Step 2: Verify with a curl call**

```bash
curl -X POST http://localhost:3000/api/painters/send-otp -H "Content-Type: application/json" -d "{\"phone\":\"0000000000\"}"
```

Expected response body:
```json
{"success":false,"code":"NOT_REGISTERED","message":"No painter found with this phone number"}
```

(If server is on a different port or path, adjust accordingly. If `0000000000` happens to exist in your DB, use another unregistered number.)

- [ ] **Step 3: Commit**

```bash
git add routes/painters.js
git commit -m "feat(painters): add NOT_REGISTERED code to send-otp 404 response"
```

---

### Task A4: New endpoint `POST /me/request-approval`

**Files:**
- Modify: `routes/painters.js` — add new endpoint near other `/me/*` routes

- [ ] **Step 1: Add the endpoint**

In `routes/painters.js`, find the `/me/profile` PUT handler (around line 428). Add this new endpoint BEFORE it:

```javascript
// Painter taps "Request Approval" button on pending screen.
// Rate-limited to once per 2 minutes. Increments counter so admin
// can gauge interest.
router.post('/me/request-approval', requirePainterSession, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT approval_request_count, last_approval_request_at FROM painters WHERE id = ?',
            [req.painter.id]
        );
        if (!rows.length) return res.status(404).json({ success: false, message: 'Painter not found' });

        const painter = rows[0];
        const RATE_LIMIT_SECONDS = 120;

        if (painter.last_approval_request_at) {
            const last = new Date(painter.last_approval_request_at).getTime();
            const elapsed = Math.floor((Date.now() - last) / 1000);
            if (elapsed < RATE_LIMIT_SECONDS) {
                const remaining = RATE_LIMIT_SECONDS - elapsed;
                return res.status(429).json({
                    success: false,
                    code: 'RATE_LIMITED',
                    message: `Please wait ${remaining} seconds before requesting again`,
                    seconds_remaining: remaining,
                    next_available_at: new Date(last + RATE_LIMIT_SECONDS * 1000).toISOString(),
                    count: painter.approval_request_count
                });
            }
        }

        await pool.query(
            'UPDATE painters SET approval_request_count = approval_request_count + 1, last_approval_request_at = NOW() WHERE id = ?',
            [req.painter.id]
        );

        const newCount = painter.approval_request_count + 1;
        const nextAvailable = new Date(Date.now() + RATE_LIMIT_SECONDS * 1000).toISOString();
        console.log(`[Painter Approval Request] painter_id=${req.painter.id} count=${newCount}`);

        res.json({
            success: true,
            message: 'Approval request sent',
            count: newCount,
            next_available_at: nextAvailable,
            seconds_remaining: RATE_LIMIT_SECONDS
        });
    } catch (error) {
        console.error('Request approval error:', error);
        res.status(500).json({ success: false, message: 'Failed to send approval request' });
    }
});
```

- [ ] **Step 2: Smoke test — send a real request**

First generate a pending-painter session token (use existing `/send-otp` + `/verify-otp` with a pending painter). Then:

```bash
# Replace TOKEN with a valid pending-painter session token
curl -X POST http://localhost:3000/api/painters/me/request-approval -H "X-Painter-Token: TOKEN"
```

Expected: `{"success":true, "count":1, "next_available_at":"...", "seconds_remaining":120}`

Immediately call it again:

```bash
curl -X POST http://localhost:3000/api/painters/me/request-approval -H "X-Painter-Token: TOKEN"
```

Expected: HTTP 429 with `{"success":false, "code":"RATE_LIMITED", "seconds_remaining": ~119, ...}`

- [ ] **Step 3: Verify DB**

```bash
node -e "require('dotenv').config(); const mysql=require('mysql2/promise'); (async()=>{const p=mysql.createPool({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME}); const [r]=await p.query('SELECT id, full_name, status, approval_request_count, last_approval_request_at FROM painters WHERE status=\\'pending\\' ORDER BY last_approval_request_at DESC LIMIT 3'); console.log(r); await p.end();})()"
```

Expected: the painter you tested with shows `approval_request_count=1` and a recent `last_approval_request_at`.

- [ ] **Step 4: Commit**

```bash
git add routes/painters.js
git commit -m "feat(painters): add rate-limited /me/request-approval endpoint"
```

---

### Task A5: Add `GET /me/status` endpoint (for Android startup check)

**Files:**
- Modify: `routes/painters.js` — add new endpoint

- [ ] **Step 1: Add the endpoint**

In `routes/painters.js`, immediately after the `/me/request-approval` endpoint you added in Task A4, add:

```javascript
// Lightweight endpoint Android calls on app startup to determine
// which screen to show (Home / PendingApproval / Login).
router.get('/me/status', requirePainterSession, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT id, full_name, phone, profile_photo, level, status, referral_code,
                    approval_request_count, last_approval_request_at
             FROM painters WHERE id = ?`,
            [req.painter.id]
        );
        if (!rows.length) return res.status(404).json({ success: false, message: 'Painter not found' });

        const p = rows[0];
        let seconds_remaining = 0;
        let next_available_at = null;
        if (p.last_approval_request_at) {
            const last = new Date(p.last_approval_request_at).getTime();
            const elapsed = Math.floor((Date.now() - last) / 1000);
            if (elapsed < 120) {
                seconds_remaining = 120 - elapsed;
                next_available_at = new Date(last + 120 * 1000).toISOString();
            }
        }

        res.json({
            success: true,
            painter: {
                id: p.id,
                full_name: p.full_name,
                phone: p.phone,
                profile_photo: p.profile_photo || null,
                level: p.level || null,
                status: p.status,
                referral_code: p.referral_code
            },
            approval: {
                count: p.approval_request_count || 0,
                last_request_at: p.last_approval_request_at,
                seconds_remaining,
                next_available_at
            }
        });
    } catch (error) {
        console.error('Get status error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch status' });
    }
});
```

- [ ] **Step 2: Smoke test**

```bash
curl http://localhost:3000/api/painters/me/status -H "X-Painter-Token: TOKEN"
```

Expected: `{"success":true, "painter":{"id":..., "status":"pending"|"approved", ...}, "approval":{"count":1, ...}}`

- [ ] **Step 3: Commit**

```bash
git add routes/painters.js
git commit -m "feat(painters): add /me/status endpoint for app startup routing"
```

---

## Phase B — Android (Tasks B1–B8)

### Task B1: Update `AuthApi.kt` — new types and endpoints

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/data/auth/AuthApi.kt`

- [ ] **Step 1: Add new response types and endpoints**

Open `app/src/painter/java/com/qcpaintshop/painter/data/auth/AuthApi.kt`. Find the `SendOtpResponse` data class (around line 11) and replace it with:

```kotlin
data class SendOtpResponse(
    val success: Boolean,
    val message: String?,
    val code: String? = null,     // "NOT_REGISTERED" on 404
    val status: String? = null    // painter.status on 200
)
```

Then, after the `RegisterResponse` data class, add these new types:

```kotlin
data class RequestApprovalResponse(
    val success: Boolean,
    val message: String?,
    val code: String? = null,
    val count: Int? = null,
    @SerializedName("seconds_remaining") val secondsRemaining: Int? = null,
    @SerializedName("next_available_at") val nextAvailableAt: String? = null
)

data class StatusResponse(
    val success: Boolean,
    val message: String?,
    val painter: PainterData?,
    val approval: ApprovalInfo?
)

data class ApprovalInfo(
    val count: Int = 0,
    @SerializedName("last_request_at") val lastRequestAt: String? = null,
    @SerializedName("seconds_remaining") val secondsRemaining: Int = 0,
    @SerializedName("next_available_at") val nextAvailableAt: String? = null
)
```

Then, inside the `AuthApi` interface, add these two new methods (after the existing `validateReferral`):

```kotlin
    @POST("me/request-approval")
    suspend fun requestApproval(@Header("X-Painter-Token") token: String): Response<RequestApprovalResponse>

    @GET("me/status")
    suspend fun getStatus(@Header("X-Painter-Token") token: String): Response<StatusResponse>
```

- [ ] **Step 2: Build-verify**

Run a quick Gradle check to make sure the Kotlin compiles:

```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android"
./gradlew :app:compilePainterDebugKotlin
```

Expected: `BUILD SUCCESSFUL`. If it fails, fix imports (likely need `import retrofit2.http.Header` and `import retrofit2.http.GET`).

- [ ] **Step 3: Commit**

```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android"
git add app/src/painter/java/com/qcpaintshop/painter/data/auth/AuthApi.kt
git commit -m "feat(painter-android): add request-approval + status API types"
```

---

### Task B2: Update `Routes.kt` — Register takes phone arg, add AwaitingApproval

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/navigation/Routes.kt`

- [ ] **Step 1: Update Register route to accept phone, add AwaitingApproval route**

In `Routes.kt`, find the `Register` data object (around lines 7-10):

```kotlin
    data object Register : Routes("register?code={code}") {
        fun createRoute(code: String? = null): String =
            if (code.isNullOrBlank()) "register" else "register?code=$code"
    }
```

Replace with:

```kotlin
    data object Register : Routes("register?code={code}&phone={phone}") {
        fun createRoute(code: String? = null, phone: String? = null): String {
            val params = mutableListOf<String>()
            if (!code.isNullOrBlank()) params.add("code=$code")
            if (!phone.isNullOrBlank()) params.add("phone=$phone")
            return if (params.isEmpty()) "register" else "register?${params.joinToString("&")}"
        }
    }
```

Then, after the `Login` line, add:

```kotlin
    data object AwaitingApproval : Routes("awaiting-approval")
```

- [ ] **Step 2: Compile check**

```bash
./gradlew :app:compilePainterDebugKotlin
```

Expected: `BUILD SUCCESSFUL` (though callers of `Routes.Register.createRoute` still work with the old single-arg form).

- [ ] **Step 3: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/navigation/Routes.kt
git commit -m "feat(painter-android): add phone arg to Register route + AwaitingApproval route"
```

---

### Task B3: Update `AuthRepository.kt` — always save session, add new methods

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/data/auth/AuthRepository.kt`

- [ ] **Step 1: Always save session in `verifyOtp` (remove pending skip)**

Find the `verifyOtp` method (around lines 48-72) and replace its body with:

```kotlin
suspend fun verifyOtp(phone: String, otp: String): Result<PainterData> {
    return try {
        val response = authApi.verifyOtp(VerifyOtpRequest(phone, otp))
        val body = response.body()
        if (response.isSuccessful && body?.success == true && body.token != null && body.painter != null) {
            // Always persist — pending painters need a session so they can
            // hit /me/request-approval and /me/status. The session is NOT
            // accepted by requirePainterAuth-guarded endpoints until status
            // flips to "approved" server-side.
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
        } else {
            Result.failure(Exception(body?.message ?: "Invalid OTP"))
        }
    } catch (e: Exception) {
        Result.failure(e)
    }
}
```

- [ ] **Step 2: Update `sendOtp` to surface the 404 `NOT_REGISTERED` code**

Find the existing `sendOtp` method. It currently returns `Result<Unit>` or similar. Replace its body with (use the method's existing signature — if it returns `Result<SendOtpResponse>`, use that; otherwise adapt):

```kotlin
suspend fun sendOtp(phone: String): Result<SendOtpResponse> {
    return try {
        val response = authApi.sendOtp(SendOtpRequest(phone))
        val body = response.body()
        if (response.code() == 404 && body?.code == "NOT_REGISTERED") {
            // Special signal — caller should navigate to registration
            Result.success(SendOtpResponse(success = false, message = null, code = "NOT_REGISTERED"))
        } else if (response.isSuccessful && body?.success == true) {
            Result.success(body)
        } else {
            Result.failure(Exception(body?.message ?: "Failed to send OTP"))
        }
    } catch (e: Exception) {
        Result.failure(e)
    }
}
```

Note: if the method was previously `Result<Unit>`, update the signature here and fix the caller in `AuthViewModel` in Task B4.

- [ ] **Step 3: Add `requestApproval` and `getStatus` methods**

Add these methods to the `AuthRepository` class (place them below `verifyOtp`):

```kotlin
suspend fun requestApproval(): Result<RequestApprovalResponse> {
    return try {
        val token = userPreferences.authToken.first() ?: return Result.failure(Exception("Not logged in"))
        val response = authApi.requestApproval(token)
        val body = response.body()
        if (response.isSuccessful && body?.success == true) {
            Result.success(body)
        } else if (response.code() == 429 && body?.code == "RATE_LIMITED") {
            Result.success(body)  // caller inspects .success to distinguish
        } else {
            Result.failure(Exception(body?.message ?: "Failed"))
        }
    } catch (e: Exception) {
        Result.failure(e)
    }
}

suspend fun getStatus(): Result<StatusResponse> {
    return try {
        val token = userPreferences.authToken.first() ?: return Result.failure(Exception("Not logged in"))
        val response = authApi.getStatus(token)
        val body = response.body()
        if (response.isSuccessful && body != null) {
            Result.success(body)
        } else if (response.code() == 401) {
            userPreferences.clearLogin()
            Result.failure(Exception("Session expired"))
        } else {
            Result.failure(Exception(body?.message ?: "Failed to get status"))
        }
    } catch (e: Exception) {
        Result.failure(e)
    }
}
```

If `userPreferences.authToken` is not a Flow (i.e., no `.first()` needed), use whatever synchronous accessor exists. If no `clearLogin()` method exists, use the existing logout/clear method in `UserPreferences`.

- [ ] **Step 4: Add needed imports**

At the top of `AuthRepository.kt`, ensure these imports exist (add if missing):

```kotlin
import kotlinx.coroutines.flow.first
```

- [ ] **Step 5: Build check**

```bash
./gradlew :app:compilePainterDebugKotlin
```

Expected: `BUILD SUCCESSFUL`. If you hit "unresolved reference: first", check that `userPreferences.authToken` is a `Flow<String?>`. If not, use the existing getter pattern.

- [ ] **Step 6: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/data/auth/AuthRepository.kt
git commit -m "feat(painter-android): always save session, add requestApproval + getStatus"
```

---

### Task B4: Update `AuthViewModel.kt` — new state, new methods

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/ui/auth/AuthViewModel.kt`

- [ ] **Step 1: Extend AuthUiState with needed fields**

Replace the `AuthUiState` data class (around lines 14-23) with:

```kotlin
data class AuthUiState(
    val isLoading: Boolean = false,
    val error: String? = null,
    val otpSent: Boolean = false,
    val isLoggedIn: Boolean = false,
    val isPendingApproval: Boolean = false,
    val painterName: String? = null,
    val isRegistered: Boolean = false,
    val registeredPhone: String? = null,
    val notRegistered: Boolean = false,         // triggers nav to Register
    val approvalRequestCount: Int = 0,
    val approvalSecondsRemaining: Int = 0,
    val approvalRequestSuccess: Boolean = false
)
```

- [ ] **Step 2: Update `sendOtp` to detect NOT_REGISTERED**

Replace the `sendOtp` function (around lines 32-44) with:

```kotlin
fun sendOtp(phone: String) {
    if (phone.length != 10) {
        _uiState.update { it.copy(error = "Enter valid 10-digit number") }
        return
    }
    viewModelScope.launch {
        _uiState.update { it.copy(isLoading = true, error = null, notRegistered = false) }
        authRepository.sendOtp(phone).fold(
            onSuccess = { resp ->
                if (resp.code == "NOT_REGISTERED") {
                    _uiState.update { it.copy(isLoading = false, notRegistered = true) }
                } else {
                    _uiState.update { it.copy(isLoading = false, otpSent = true) }
                }
            },
            onFailure = { e -> _uiState.update { it.copy(isLoading = false, error = e.message) } }
        )
    }
}

fun consumeNotRegistered() {
    _uiState.update { it.copy(notRegistered = false) }
}
```

- [ ] **Step 3: Add `requestApproval` method**

Add these methods to the `AuthViewModel` class:

```kotlin
fun requestApproval() {
    viewModelScope.launch {
        _uiState.update { it.copy(isLoading = true, error = null, approvalRequestSuccess = false) }
        authRepository.requestApproval().fold(
            onSuccess = { resp ->
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        approvalRequestCount = resp.count ?: it.approvalRequestCount,
                        approvalSecondsRemaining = resp.secondsRemaining ?: 0,
                        approvalRequestSuccess = resp.success,
                        error = if (!resp.success) resp.message else null
                    )
                }
            },
            onFailure = { e -> _uiState.update { it.copy(isLoading = false, error = e.message) } }
        )
    }
}

fun loadApprovalStatus() {
    viewModelScope.launch {
        authRepository.getStatus().fold(
            onSuccess = { resp ->
                _uiState.update {
                    it.copy(
                        approvalRequestCount = resp.approval?.count ?: 0,
                        approvalSecondsRemaining = resp.approval?.secondsRemaining ?: 0,
                        painterName = resp.painter?.displayName ?: it.painterName
                    )
                }
            },
            onFailure = { /* silent */ }
        )
    }
}

fun tickApprovalCountdown() {
    _uiState.update {
        if (it.approvalSecondsRemaining > 0) it.copy(approvalSecondsRemaining = it.approvalSecondsRemaining - 1)
        else it
    }
}

fun logout() {
    viewModelScope.launch {
        authRepository.logout()  // use existing method; if missing, call userPreferences.clearLogin()
        _uiState.value = AuthUiState()
    }
}
```

If `authRepository.logout()` doesn't exist, add a simple one to `AuthRepository`:
```kotlin
suspend fun logout() { userPreferences.clearLogin() }
```

- [ ] **Step 4: Build check**

```bash
./gradlew :app:compilePainterDebugKotlin
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 5: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/ui/auth/AuthViewModel.kt app/src/painter/java/com/qcpaintshop/painter/data/auth/AuthRepository.kt
git commit -m "feat(painter-android): approval request state + methods in AuthViewModel"
```

---

### Task B5: Update `LoginScreen.kt` — handle NOT_REGISTERED navigation

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/ui/auth/LoginScreen.kt`

- [ ] **Step 1: Add navigation to Register on NOT_REGISTERED**

In `LoginScreen.kt`, find where `uiState` is observed. Most Compose screens have a `LaunchedEffect(uiState.xxx)` watching state changes. Find the existing `LaunchedEffect` blocks that handle `isPendingApproval` / `isLoggedIn`. Add this one alongside:

```kotlin
LaunchedEffect(uiState.notRegistered) {
    if (uiState.notRegistered) {
        viewModel.consumeNotRegistered()
        onNavigateToRegister(phone)   // phone is the local state var
    }
}
```

Also add a handler for pending approval navigation:

```kotlin
LaunchedEffect(uiState.isPendingApproval) {
    if (uiState.isPendingApproval) {
        onNavigateToAwaitingApproval()
    }
}
```

- [ ] **Step 2: Update `LoginScreen` signature**

Find the `LoginScreen` composable signature (likely starts around line 40). The existing signature takes `onNavigateToRegister: () -> Unit` and `onLoggedIn: () -> Unit`. Update to:

```kotlin
@Composable
fun LoginScreen(
    onNavigateToRegister: (phone: String) -> Unit,
    onNavigateToAwaitingApproval: () -> Unit,
    onLoggedIn: () -> Unit,
    viewModel: AuthViewModel = hiltViewModel()
)
```

- [ ] **Step 3: Update `AppNavigation.kt` callers of LoginScreen**

Open `app/src/painter/java/com/qcpaintshop/painter/navigation/AppNavigation.kt`. Find the `composable(Routes.Login.route)` block. Update the `LoginScreen()` call to pass the new callbacks. Find the existing call (something like):

```kotlin
composable(Routes.Login.route) {
    LoginScreen(
        onNavigateToRegister = { navController.navigate(Routes.Register.createRoute()) },
        onLoggedIn = { navController.navigate(Routes.Home.route) { popUpTo(Routes.Login.route) { inclusive = true } } }
    )
}
```

Replace with:

```kotlin
composable(Routes.Login.route) {
    LoginScreen(
        onNavigateToRegister = { phone ->
            navController.navigate(Routes.Register.createRoute(phone = phone))
        },
        onNavigateToAwaitingApproval = {
            navController.navigate(Routes.AwaitingApproval.route) {
                popUpTo(Routes.Login.route) { inclusive = true }
            }
        },
        onLoggedIn = {
            navController.navigate(Routes.Home.route) {
                popUpTo(Routes.Login.route) { inclusive = true }
            }
        }
    )
}
```

- [ ] **Step 4: Add the AwaitingApproval composable route**

In the same `AppNavigation.kt` file, in the `NavHost` block, add a new composable after the Login route:

```kotlin
composable(Routes.AwaitingApproval.route) {
    AwaitingApprovalScreen(
        onLogout = {
            navController.navigate(Routes.Login.route) {
                popUpTo(0) { inclusive = true }
            }
        },
        onApproved = {
            navController.navigate(Routes.Home.route) {
                popUpTo(0) { inclusive = true }
            }
        }
    )
}
```

`AwaitingApprovalScreen` will be created in Task B6.

- [ ] **Step 5: Add required import at top of AppNavigation.kt**

```kotlin
import com.qcpaintshop.painter.ui.auth.AwaitingApprovalScreen
```

- [ ] **Step 6: Build check (will fail until B6 creates AwaitingApprovalScreen)**

Skip the build check at this point — B6 must complete first. Instead, just verify Kotlin syntax visually.

- [ ] **Step 7: Commit (include partial state — will be completed in B6)**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/ui/auth/LoginScreen.kt app/src/painter/java/com/qcpaintshop/painter/navigation/AppNavigation.kt
git commit -m "feat(painter-android): route NOT_REGISTERED to Register, pending to AwaitingApproval"
```

---

### Task B6: Create `AwaitingApprovalScreen.kt` with request button + countdown

**Files:**
- Create: `app/src/painter/java/com/qcpaintshop/painter/ui/auth/AwaitingApprovalScreen.kt`

- [ ] **Step 1: Create the new screen file**

Create `app/src/painter/java/com/qcpaintshop/painter/ui/auth/AwaitingApprovalScreen.kt` with:

```kotlin
package com.qcpaintshop.painter.ui.auth

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Send
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.hilt.navigation.compose.hiltViewModel
import com.qcpaintshop.painter.ui.theme.*
import kotlinx.coroutines.delay

@Composable
fun AwaitingApprovalScreen(
    onLogout: () -> Unit,
    onApproved: () -> Unit,
    viewModel: AuthViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()

    // Fetch current approval status + painter name on first load
    LaunchedEffect(Unit) {
        viewModel.loadApprovalStatus()
    }

    // Tick countdown every 1s while > 0
    LaunchedEffect(uiState.approvalSecondsRemaining) {
        if (uiState.approvalSecondsRemaining > 0) {
            delay(1000L)
            viewModel.tickApprovalCountdown()
        }
    }

    // Poll status every 30s to detect admin approval → auto-navigate to Home
    LaunchedEffect(Unit) {
        while (true) {
            delay(30_000L)
            viewModel.loadApprovalStatus()
        }
    }

    // If status flipped to approved (isLoggedIn became true via some path) → go home
    LaunchedEffect(uiState.isLoggedIn) {
        if (uiState.isLoggedIn) onApproved()
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(QCBackground),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(220.dp)
                .background(Brush.verticalGradient(listOf(QCGreen, QCGreenDark))),
            contentAlignment = Alignment.Center,
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(
                    imageVector = Icons.Default.CheckCircle,
                    contentDescription = null,
                    modifier = Modifier.size(64.dp),
                    tint = QCSurface,
                )
                Spacer(Modifier.height(12.dp))
                Text(
                    "Waiting for Admin Approval",
                    fontSize = 22.sp,
                    fontWeight = FontWeight.Bold,
                    color = QCSurface,
                    textAlign = TextAlign.Center,
                )
            }
        }

        Card(
            modifier = Modifier
                .fillMaxWidth()
                .offset(y = (-24).dp)
                .padding(horizontal = 24.dp),
            shape = RoundedCornerShape(20.dp),
            colors = CardDefaults.cardColors(containerColor = QCSurface),
            elevation = CardDefaults.cardElevation(defaultElevation = 4.dp),
        ) {
            Column(
                modifier = Modifier.padding(28.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                if (!uiState.painterName.isNullOrBlank()) {
                    Text(
                        "Hello, ${uiState.painterName}",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.SemiBold,
                    )
                    Spacer(Modifier.height(8.dp))
                }
                Text(
                    "Your account is under review.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = QCTextSecondary,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    "Tap the button below to notify admin of your interest. Admin will see each request and activate accounts faster for interested painters.",
                    style = MaterialTheme.typography.bodySmall,
                    color = QCTextTertiary,
                    textAlign = TextAlign.Center,
                )
                Spacer(Modifier.height(24.dp))

                val countdown = uiState.approvalSecondsRemaining
                val isDisabled = countdown > 0 || uiState.isLoading
                val buttonText = when {
                    uiState.isLoading -> "Sending..."
                    countdown > 0 -> "Next request in ${formatCountdown(countdown)}"
                    else -> "Request Approval"
                }

                Button(
                    onClick = { viewModel.requestApproval() },
                    enabled = !isDisabled,
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(52.dp),
                    shape = RoundedCornerShape(14.dp),
                    colors = ButtonDefaults.buttonColors(
                        containerColor = QCGreen,
                        disabledContainerColor = QCTextTertiary
                    ),
                ) {
                    if (!isDisabled) {
                        Icon(Icons.Default.Send, contentDescription = null, modifier = Modifier.size(20.dp))
                        Spacer(Modifier.width(8.dp))
                    }
                    Text(buttonText, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                }

                AnimatedVisibility(visible = uiState.approvalRequestCount > 0) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Spacer(Modifier.height(16.dp))
                        Text(
                            "Requests sent: ${uiState.approvalRequestCount}",
                            style = MaterialTheme.typography.bodyMedium,
                            color = QCGold,
                            fontWeight = FontWeight.SemiBold,
                        )
                    }
                }

                if (uiState.approvalRequestSuccess) {
                    Spacer(Modifier.height(12.dp))
                    Text(
                        "✓ Request sent! Admin has been notified.",
                        style = MaterialTheme.typography.bodySmall,
                        color = QCGreen,
                    )
                }

                uiState.error?.let { err ->
                    Spacer(Modifier.height(12.dp))
                    Text(err, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
                }

                Spacer(Modifier.height(28.dp))
                Text(
                    "Use a different number",
                    style = MaterialTheme.typography.bodySmall,
                    color = QCTextSecondary,
                    textDecoration = TextDecoration.Underline,
                    modifier = Modifier.clickable {
                        viewModel.logout()
                        onLogout()
                    },
                )
            }
        }
    }
}

private fun formatCountdown(seconds: Int): String {
    val m = seconds / 60
    val s = seconds % 60
    return "%d:%02d".format(m, s)
}
```

- [ ] **Step 2: Add missing import for `clickable`**

Make sure `androidx.compose.foundation.clickable` is imported. Add at the top if missing:

```kotlin
import androidx.compose.foundation.clickable
```

- [ ] **Step 3: Build check**

```bash
./gradlew :app:compilePainterDebugKotlin
```

Expected: `BUILD SUCCESSFUL`. Fix any unresolved theme color references (check `ui/theme/Color.kt` for actual names — may be `QCGreen` / `QCGreenDark` / `QCGold` / `QCSurface` / `QCBackground` / `QCTextSecondary` / `QCTextTertiary`, confirmed from existing code).

- [ ] **Step 4: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/ui/auth/AwaitingApprovalScreen.kt
git commit -m "feat(painter-android): add AwaitingApprovalScreen with request button + countdown"
```

---

### Task B7: Update `RegisterScreen.kt` — accept phone arg, pre-fill, update success screen

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/ui/auth/RegisterScreen.kt`
- Modify: `app/src/painter/java/com/qcpaintshop/painter/navigation/AppNavigation.kt`

- [ ] **Step 1: Update RegisterScreen to accept phone arg**

In `RegisterScreen.kt`, find the `RegisterScreen` composable signature (usually around line 60-70). Update it to accept a `prefillPhone: String? = null` parameter:

```kotlin
@Composable
fun RegisterScreen(
    prefillPhone: String? = null,
    prefillCode: String? = null,
    onNavigateToLogin: () -> Unit,
    viewModel: AuthViewModel = hiltViewModel()
) {
    var phone by rememberSaveable { mutableStateOf(prefillPhone ?: "") }
    // ... rest of the existing state
```

(Existing code uses `var phone by remember { mutableStateOf("") }`. Change to `rememberSaveable` and default to `prefillPhone ?: ""`.)

- [ ] **Step 2: Lock the phone field when pre-filled**

Find the `OutlinedTextField` for phone (around lines 127-140). Update it to:

```kotlin
OutlinedTextField(
    value = phone,
    onValueChange = {
        if (prefillPhone == null && it.length <= 10 && it.all { c -> c.isDigit() }) phone = it
    },
    label = { Text("Phone Number *") },
    leadingIcon = { Icon(Icons.Default.Phone, null) },
    prefix = { Text("+91 ") },
    enabled = prefillPhone == null,
    readOnly = prefillPhone != null,
    modifier = Modifier.fillMaxWidth(),
    shape = RoundedCornerShape(12.dp),
    singleLine = true,
    keyboardOptions = KeyboardOptions(
        keyboardType = KeyboardType.Number,
        imeAction = ImeAction.Next
    ),
)
```

- [ ] **Step 3: Update `RegistrationSuccessScreen` button text and action**

Find the `RegistrationSuccessScreen` composable (around lines 201-287). Update the button's `onClick` to the new `onGoToLogin` callback (it already passes `onGoToLogin` — good). Make sure the `RegistrationSuccessScreen` is invoked from `RegisterScreen` with:

```kotlin
if (uiState.isRegistered) {
    RegistrationSuccessScreen(onGoToLogin = onNavigateToLogin)
    return
}
```

(If the existing code has equivalent logic with different naming, keep it — just ensure it ends up calling `onNavigateToLogin` on button tap.)

- [ ] **Step 4: Update `AppNavigation.kt` to pass phone from nav args**

In `AppNavigation.kt`, find the `composable(Routes.Register.route)` block. Update to extract the `phone` nav argument:

```kotlin
composable(
    route = Routes.Register.route,
    arguments = listOf(
        navArgument("code") { type = NavType.StringType; nullable = true; defaultValue = null },
        navArgument("phone") { type = NavType.StringType; nullable = true; defaultValue = null }
    )
) { backStackEntry ->
    val code = backStackEntry.arguments?.getString("code")
    val phone = backStackEntry.arguments?.getString("phone")
    RegisterScreen(
        prefillPhone = phone,
        prefillCode = code,
        onNavigateToLogin = {
            navController.navigate(Routes.Login.route) {
                popUpTo(Routes.Register.route) { inclusive = true }
            }
        }
    )
}
```

Add import if needed:
```kotlin
import androidx.navigation.navArgument
import androidx.navigation.NavType
```

- [ ] **Step 5: Build check**

```bash
./gradlew :app:compilePainterDebugKotlin
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 6: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/ui/auth/RegisterScreen.kt app/src/painter/java/com/qcpaintshop/painter/navigation/AppNavigation.kt
git commit -m "feat(painter-android): RegisterScreen accepts phone arg + locks field"
```

---

### Task B8: Update `AppNavigation.kt` — startup status check

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/navigation/AppNavigation.kt`
- Modify: `app/src/painter/java/com/qcpaintshop/painter/MainViewModel.kt` (or wherever `isLoggedIn` lives)

- [ ] **Step 1: Find MainViewModel and update startup state to handle 3 states**

Open `MainViewModel.kt` (use `Grep` for `isLoggedIn` inside `app/src/painter/` if not at expected path). The file currently exposes `isLoggedIn: StateFlow<Boolean?>`. Add a new state that also captures pending:

```kotlin
sealed class StartupState {
    object Loading : StartupState()
    object NotLoggedIn : StartupState()
    object PendingApproval : StartupState()
    object LoggedIn : StartupState()
}
```

Then add a new StateFlow in the class:

```kotlin
private val _startupState = MutableStateFlow<StartupState>(StartupState.Loading)
val startupState: StateFlow<StartupState> = _startupState.asStateFlow()

init {
    viewModelScope.launch {
        val token = userPreferences.authToken.first()
        if (token.isNullOrBlank()) {
            _startupState.value = StartupState.NotLoggedIn
            return@launch
        }
        // Have a token — verify with server which screen to show
        authRepository.getStatus().fold(
            onSuccess = { resp ->
                _startupState.value = when (resp.painter?.status) {
                    "pending" -> StartupState.PendingApproval
                    "approved" -> StartupState.LoggedIn
                    else -> StartupState.NotLoggedIn
                }
            },
            onFailure = {
                // 401 clears token inside repository; fall through to NotLoggedIn
                _startupState.value = StartupState.NotLoggedIn
            }
        )
    }
}
```

Replace the existing `init` block that sets `_isLoggedIn`. If `MainViewModel` uses constructor-injection, ensure `authRepository` is injected:

```kotlin
@HiltViewModel
class MainViewModel @Inject constructor(
    private val userPreferences: UserPreferences,
    private val authRepository: AuthRepository
) : ViewModel() { ... }
```

- [ ] **Step 2: Update `AppNavigation` to route based on `startupState`**

In `AppNavigation.kt`, replace the `isLoggedIn` branching (around lines 76-89) with:

```kotlin
@Composable
fun AppNavigation(mainViewModel: MainViewModel = hiltViewModel()) {
    val startupState by mainViewModel.startupState.collectAsState()

    if (startupState is StartupState.Loading) {
        Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
            CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
        }
        return
    }

    val startDestination = when (startupState) {
        is StartupState.LoggedIn -> Routes.Home.route
        is StartupState.PendingApproval -> Routes.AwaitingApproval.route
        else -> Routes.Login.route
    }

    // ... existing NavHost below with startDestination
```

Add import:
```kotlin
import com.qcpaintshop.painter.StartupState
```

(Adjust the import path to wherever `StartupState` lives.)

- [ ] **Step 3: Build check**

```bash
./gradlew :app:compilePainterDebugKotlin
```

Expected: `BUILD SUCCESSFUL`.

- [ ] **Step 4: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/MainViewModel.kt app/src/painter/java/com/qcpaintshop/painter/navigation/AppNavigation.kt
git commit -m "feat(painter-android): startup status check routes approved/pending/login"
```

---

## Phase C — Admin UI (Task C1)

### Task C1: Admin painters page — Interest column + sort pill

**Files:**
- Modify: `public/admin-painters.html` — around lines 1558-1662 (`loadPainters`, `renderPaintersTable`)

- [ ] **Step 1: Add "Sort by Interest" pill to the UI**

In `admin-painters.html`, find the filter bar with existing sort/status/search controls. Near the existing `painterSortFilter` select (search for `painterSortFilter` if it exists; otherwise near `painterStatusFilter`), add a new option:

```html
<!-- inside the existing <select id="painterSortFilter"> -->
<option value="interest">Sort by Interest</option>
```

If `painterSortFilter` doesn't exist yet, add a new select next to `painterStatusFilter`:

```html
<select id="painterSortFilter" onchange="loadPainters(1)">
    <option value="">Sort: Recent</option>
    <option value="interest">Sort: Interest (pending)</option>
</select>
```

- [ ] **Step 2: Handle `sort=interest` on backend**

Back in `routes/painters.js`, find the admin list endpoint (line 5826). Replace the query-building section with a sort-aware version. Find this line:

```javascript
query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
```

Replace with:

```javascript
const sort = req.query.sort || '';
if (sort === 'interest') {
    query += ' ORDER BY approval_request_count DESC, last_approval_request_at DESC, created_at DESC LIMIT ? OFFSET ?';
} else {
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
}
```

The existing `SELECT *` already returns the new columns — no SELECT change needed.

- [ ] **Step 3: Update mobile card rendering to show Interest**

In `admin-painters.html`, inside `renderPaintersTable`, find the mobile-card section that renders each `p`. Inside the pending-status branch (where buttons Approve/Reject are shown), ADD before the actions div:

```javascript
${p.status === 'pending' && (p.approval_request_count||0) > 0 ? `
    <div class="painter-card-meta" style="margin-top:6px;">
        <span style="background:${interestBadgeColor(p.approval_request_count)};color:#fff;padding:2px 8px;border-radius:10px;font-weight:600;">
            🔔 ${p.approval_request_count} request${p.approval_request_count === 1 ? '' : 's'}
        </span>
        ${p.last_approval_request_at ? `<span style="color:#64748b;"> · Last ${relativeTime(p.last_approval_request_at)}</span>` : ''}
    </div>
` : ''}
```

Find where `renderPaintersTable` is defined and add these two helpers INSIDE the same `<script>` block (once, somewhere near the top of the script):

```javascript
function interestBadgeColor(n) {
    if (n >= 6) return '#dc2626';   // red — high interest
    if (n >= 3) return '#f59e0b';   // amber
    if (n >= 1) return '#3b82f6';   // blue
    return '#94a3b8';                // gray
}

function relativeTime(iso) {
    const now = Date.now();
    const then = new Date(iso).getTime();
    const diff = Math.max(0, Math.floor((now - then) / 1000));
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
    return `${Math.floor(diff/86400)}d ago`;
}
```

- [ ] **Step 4: Update desktop table rendering**

In the same `renderPaintersTable`, find the desktop table row template. The existing template has 10 columns. We'll show the Interest badge inside the Actions column (to avoid rebuilding table headers), appending it:

Find the pending action cell:

```javascript
${p.status === 'pending' ? `
    <button onclick="event.stopPropagation();approvePainter(${p.id},'approve')" class="btn-sm btn-success mr-1">Approve</button>
    <button onclick="event.stopPropagation();approvePainter(${p.id},'reject')" class="btn-sm btn-danger">Reject</button>
` : `<button onclick="event.stopPropagation();showPainterDetail(${p.id})" class="btn-sm btn-outline">View</button>`}
```

Replace with:

```javascript
${p.status === 'pending' ? `
    <button onclick="event.stopPropagation();approvePainter(${p.id},'approve')" class="btn-sm btn-success mr-1">Approve</button>
    <button onclick="event.stopPropagation();approvePainter(${p.id},'reject')" class="btn-sm btn-danger">Reject</button>
    ${(p.approval_request_count||0) > 0 ? `<div style="margin-top:4px;font-size:11px;"><span style="background:${interestBadgeColor(p.approval_request_count)};color:#fff;padding:1px 6px;border-radius:8px;">🔔 ${p.approval_request_count}</span>${p.last_approval_request_at?` <span style="color:#64748b;">${relativeTime(p.last_approval_request_at)}</span>`:''}</div>`:''}
` : `<button onclick="event.stopPropagation();showPainterDetail(${p.id})" class="btn-sm btn-outline">View</button>`}
```

- [ ] **Step 5: Smoke test the page**

- Restart the server (if using nodemon, it restarts automatically)
- Open `http://localhost:3000/admin-painters.html` (log in as admin)
- Filter status = `pending`
- Verify: painters with `approval_request_count > 0` show the badge; sort pill has the Interest option and sorts correctly

- [ ] **Step 6: Commit**

```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/act.qcpaintshop.com"
git add public/admin-painters.html routes/painters.js
git commit -m "feat(admin): show approval request interest on pending painters"
```

---

## Phase D — Test, Build, Deliver (Tasks D1–D3)

### Task D1: End-to-end smoke test

- [ ] **Step 1: Backend sanity — all endpoints respond**

With the server running locally:

```bash
# send-otp with unregistered phone
curl -X POST http://localhost:3000/api/painters/send-otp -H "Content-Type: application/json" -d '{"phone":"0000000001"}'
# Expected: 404 with code:"NOT_REGISTERED"

# me/status with no token
curl http://localhost:3000/api/painters/me/status
# Expected: 401

# me/status with invalid token
curl http://localhost:3000/api/painters/me/status -H "X-Painter-Token: bogus"
# Expected: 401
```

- [ ] **Step 2: DB sanity — new columns work end-to-end**

Pick a pending painter in DB, get a valid session token, then:

```bash
curl -X POST http://localhost:3000/api/painters/me/request-approval -H "X-Painter-Token: <TOKEN>"
# Expected: 200 with count:1
```

Verify count in DB:
```sql
SELECT id, full_name, approval_request_count, last_approval_request_at
  FROM painters WHERE id = <PAINTER_ID>;
```

- [ ] **Step 3: Admin page smoke test**

Open `admin-painters.html` with status filter = `pending`. Confirm:
- Painter with `approval_request_count > 0` shows interest badge (color varies by count)
- "Sort by Interest" option appears and reorders list by count DESC

- [ ] **Step 4: No commit needed** (this task is verification-only)

---

### Task D2: Run painter-android-audit skill

- [ ] **Step 1: Invoke the audit skill**

Invoke the `painter-android-audit` skill (project-level) to run static analysis, APK build verification, and backend cross-check. The skill handles its own baseline cleanup. Follow any P0/P1 findings it reports and fix them before proceeding.

If the skill produces P2 findings, surface them to the user for go/no-go decision — don't auto-fix.

---

### Task D3: Build painter APK and deliver via Telegram

**Files:**
- Uses: existing release signing config in `qcpaintshop-android`

- [ ] **Step 1: Build the painter flavor release APK**

```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android"
./gradlew :app:assemblePainterRelease
```

Expected: APK at `app/build/outputs/apk/painter/release/app-painter-release.apk`.

- [ ] **Step 2: Verify APK size and install-ability**

```bash
ls -lh app/build/outputs/apk/painter/release/
```

Expected: APK file present, reasonable size (~20–40 MB). Note the actual filename — it may be `app-painter-release.apk` or `app-painter-release-unsigned.apk` depending on signing config. If unsigned, run the sign step from existing release docs (check `qcpaintshop-android/RELEASE.md` or similar).

- [ ] **Step 3: Send APK via Telegram bot**

Use the Telegram bot credentials:
- Bot: `@qualitycoloursbot`
- Bot token: `6151083158:AAGlvK-tiU_akQyAMBTP5Kz5xQu-yZQVwPo`
- Chat ID: `930726256`

Send command:

```bash
APK_PATH="app/build/outputs/apk/painter/release/app-painter-release.apk"
curl -F "chat_id=930726256" \
     -F "document=@${APK_PATH}" \
     -F "caption=🎨 Painter APK — approval flow redesign ($(date +%Y-%m-%d))" \
     "https://api.telegram.org/bot6151083158:AAGlvK-tiU_akQyAMBTP5Kz5xQu-yZQVwPo/sendDocument"
```

Expected: `{"ok":true, "result":{"message_id":..., "document":{"file_name":"app-painter-release.apk",...}}}` — APK arrives in the `@sharjoon1` chat.

- [ ] **Step 4: Final commit (if any uncommitted changes remain)**

```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/act.qcpaintshop.com"
git status
# If anything uncommitted:
git add -A
git commit -m "chore: finalize painter approval flow delivery"
```

---

## Completion Criteria

- [ ] Migration applied on dev DB — new columns visible
- [ ] All backend endpoints return expected shapes (D1)
- [ ] Android app compiles `:app:assemblePainterDebug` successfully
- [ ] `AwaitingApprovalScreen` renders countdown + counter updates on tap
- [ ] Admin pending-tab shows interest badge + sort option works
- [ ] Painter APK built and delivered to Telegram
- [ ] All commits on `master` branch of `act.qcpaintshop.com` and `qcpaintshop-android`
