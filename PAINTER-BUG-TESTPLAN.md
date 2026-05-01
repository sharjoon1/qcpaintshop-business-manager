# Painter System — Bug & Test Plan (web + Android)

> Generated from live source analysis of `routes/painters.js` (6316 lines), 12 service files,
> and 75+ Android Kotlin source files. Scope: vc19 v3.1.7 painter build.

---

## 0. Executive Summary

| # | Risk | Impact | Severity |
|---|------|--------|----------|
| 1 | **Challenge-claim bypasses Points Engine** — raw INSERT + UPDATE skips level multiplier, clawback netting, and `total_earned_regular` reconciliation. Painters earn un-multiplied points that diverge from ledger totals. | Points discrepancy; audit failure | **CRITICAL** |
| 2 | **Location-report uses wrong column `p.name`** — painters table has `full_name`, not `name`. Socket.io emit and /locations/live admin queries silently return `null` name for every painter. | Admin live-map shows "Unknown" for all painters | **HIGH** |
| 3 | **Visualization API response shape drift** — Android `VisualizationsResponse` expects `completed` + `pending` lists, but web returns flat `visualizations` array. Entire Visualizations screen renders empty. | Feature completely broken on Android | **HIGH** |
| 4 | **Estimate number generator is not atomic** — `generateEstimateNumber()` does SELECT-then-INSERT without a lock. Under concurrent estimate creation, duplicate estimate numbers are possible. | Duplicate PE* numbers, Zoho invoice collisions | **HIGH** |
| 5 | **Daily bonus points bypass level multiplier** — `addPoints()` called directly instead of `addPointsWithMultiplier()`. Gold/Diamond painters lose their multiplier on the most visible daily bonus. | Revenue leakage for top-tier painters | **MEDIUM** |

---

## 1. Web Bugs (routes / services)

### BUG-W01: Challenge reward bypasses Points Engine (CRITICAL)
**File:** `routes/painters.js:5449-5461`
**Defect:** Challenge claim does raw SQL:
```js
INSERT INTO painter_point_transactions (painter_id, amount, pool, type, description, reference_id, created_at) VALUES (?, ?, 'regular', 'challenge_reward', ?, ?, NOW())
UPDATE painters SET regular_points = regular_points + ? WHERE id = ?
```
This bypasses: (a) `addPoints()` clawback netting, (b) `addPointsWithMultiplier()` level multiplier, (c) `total_earned_regular` counter update, (d) the `checkLevelUp()` call. It also has no idempotency guard — if the `claimed` UPDATE fails after INSERT, retrying creates duplicates.

**Reproduction:**
```bash
curl -X POST https://act.qcpaintshop.com/api/painters/me/challenges/1/claim \
  -H "X-Painter-Token: $TOKEN"
# Points appear in ledger but total_earned_regular is stale.
# getBalance() will show divergent regular vs totalEarned.
```
**Severity:** CRITICAL — audit-trail breaks for every challenge claim.
**Fix:** Replace raw SQL with `await pointsEngine.addPointsWithMultiplier(req.painter.id, 'regular', challenge.reward_points, 'challenge_reward', ...)`. Wrap claim + point award in a transaction.

---

### BUG-W02: Location report queries use `p.name` instead of `p.full_name` (HIGH)
**File:** `routes/painters.js:5845, 5872, 5889`
**Defect:** Three SQL queries in the location pipeline reference `p.name` on the `painters` table. The column is `full_name`. MySQL returns `NULL` silently.
- L5845: `SELECT p.name, p.level, b.name AS branch FROM painters p` — in location-report Socket.io emit
- L5872: `SELECT ple.painter_id, p.name, p.level, b.name AS branch` — in /locations/live online query
- L5889: Same for offline query

**Reproduction:** Open admin painters → Live Map tab. All painter names show as "Unknown" or null.
**Severity:** HIGH — admin real-time location tracking is blind.
**Fix:** Replace `p.name` with `p.full_name` in all three queries.

---

### BUG-W03: Daily bonus points skip level multiplier (MEDIUM)
**File:** `services/painter-points-engine.js:256`
**Defect:** `addPoints(painterId, 'regular', dailyBonusPoints, 'daily_bonus', ...)` is called directly, while regular and annual points use `addPointsWithMultiplier()`. A Gold painter (1.5x) earns 100 daily bonus → gets 100 instead of 150.
**Severity:** MEDIUM — affects most-engaged painters daily.
**Fix:** Change to `addPointsWithMultiplier()`.

---

### BUG-W04: Estimate number generation race condition (HIGH)
**File:** `routes/painters.js:1133-1149`
**Defect:** `generateEstimateNumber()` does `SELECT ... ORDER BY id DESC LIMIT 1` then uses the result to compute the next sequence number. Two concurrent POST /me/estimates requests can read the same latest number and generate the same estimate_number. No UNIQUE constraint check is documented.
**Severity:** HIGH — duplicate numbers cause downstream Zoho conflicts.
**Fix:** Use `INSERT ... ON DUPLICATE KEY` with a sequence table, or `SELECT ... FOR UPDATE` inside a transaction.

---

### BUG-W05: Referral code collision still possible (LOW)
**File:** `routes/painters.js:201-204`
**Defect:** If the first generated code collides, the retry just appends a random digit: `code + Math.floor(Math.random() * 10)`. This new code is never checked for uniqueness. With ~26³ × 36⁵ ≈ 1B codes the odds are low, but the fix is trivial.
**Fix:** Loop until unique, or use UNIQUE constraint with `INSERT IGNORE` + retry.

---

### BUG-W06: Invoice dedup uses `invoice_id` but estimate-driven invoices use `EST-{id}` (REVIEW)
**File:** `services/painter-points-engine.js:159-162`
**Defect:** The processInvoice dedup key is `invoice.invoice_id`. When called from the push-to-zoho flow (routes/painters.js ~L4830), the invoice_id is the Zoho invoice ID. But the comment in the mission spec mentions `EST-{id}` format. If the push-to-zoho endpoint is called, fails partway, then retried with a new Zoho invoice ID, points would be double-awarded because the dedup key changed.
**Severity:** MEDIUM — depends on operational retry patterns.
**Fix:** Use `EST-{estimate_id}` as the canonical dedup key for estimate-originated invoices.

---

### BUG-W07: Card generator race condition (LOW)
**File:** `routes/painters.js:637-640`
**Defect:** The visiting card endpoint sets `card_generated_at = NOW()` AFTER calling `generateCard()`. If Sharp fails (OOM, corrupt image), the timestamp is never set, so the next request retries — this is actually self-healing. However, if two requests arrive simultaneously, both see `needsRegen = true` and both invoke Sharp concurrently, wasting resources. Not a data-integrity bug.
**Fix:** Use an advisory lock or a `card_generating` flag.

---

### BUG-W08: Attendance check-in double-points (MEDIUM)
**File:** `routes/painters.js:2467-2478`
**Defect:** The check-in endpoint inserts the attendance record with `points_awarded = ?` (the config value) and then calls `pointsEngine.awardAttendancePoints()` which ALSO calls `addPointsWithMultiplier()` and updates `points_awarded` on the same row. The record initially has the un-multiplied value, then gets overwritten with the multiplied value. No data loss, but the flow writes `points_awarded` twice. More critically: `awardAttendancePoints()` has no dedup guard — if called twice for the same attendance ID, points double.
**Fix:** Make `awardAttendancePoints()` check for existing transaction with `reference_id = attendanceId` before awarding.

---

### BUG-W09: No rate limiter on OTP send/verify (MEDIUM)
**File:** `routes/painters.js:253, 320`
**Defect:** `/send-otp` and `/verify-otp` have no rate limiting middleware. The rateLimiter middleware from `middleware/rateLimiter.js` defines OTP-specific limits (5/min/phone) but it's not applied to these routes. An attacker can brute-force the 6-digit OTP (1M combinations) with automated requests.
**Fix:** Apply `rateLimiter.otp` middleware to both endpoints.

---

### BUG-W10: Admin visualization routes after /:id catch-all (MEDIUM)
**File:** `routes/painters.js:6217-6314`
**Defect:** `/admin/visualizations` is defined AFTER `/:id` (line 6052). Express will match `admin` as an `:id` parameter. However, the code at L6056 does `if (isNaN(id)) return res.status(400)`, which would reject "admin" — so requests to `/api/painters/admin/visualizations` return `400 Invalid painter ID` instead of reaching the intended handler.
**Fix:** Move admin visualization routes above the `/:id` route, or into the admin named routes section (before L2816).

---

### BUG-W11: Leaderboard uses `total_lifetime_points` and `pt.points` columns (LOW)
**File:** `routes/painters.js:5371-5381`
**Defect:** Query references `p.total_lifetime_points` and `pt.points` — neither column name matches the actual schema (`total_earned_regular` / `total_earned_annual` and `amount` in painter_point_transactions). These are likely stale column references. The query would return 0 for everything or fail.
**Fix:** Replace with correct column names: `(p.total_earned_regular + p.total_earned_annual) as total_lifetime_points` and `pt.amount`.

---

### BUG-W12: Test account OTP hardcoded and logged (LOW)
**File:** `routes/painters.js:264-265, 276`
**Defect:** Phone `9999999999` always gets OTP `123456`. The OTP is also logged to console: `console.log([Painter OTP] Phone: ${phone}, OTP: ${otp})`. In production, this leaks OTPs to server logs.
**Fix:** Remove console.log of OTP in production, or guard with `if (process.env.NODE_ENV !== 'production')`.

---

## 2. Web UX / Design Issues (admin-painters.html, painter-*.html)

*(HTML files were not directly read in this analysis pass due to delegation limits. Issues below are inferred from route analysis.)*

### UX-W01: Admin live-map shows "Unknown" for all painters
**File:** `routes/painters.js:5845` → emitted via Socket.io
**Issue:** Due to BUG-W02, the admin painters live-tracking map (tab 10) shows all painters as "Unknown".
**Fix:** Fix the SQL column reference.

### UX-W02: Admin visualization management returns 400
**File:** Routes ordering (BUG-W10)
**Issue:** Admin clicking the Visualizations tab gets "Invalid painter ID" because Express matches `/admin/visualizations` as `/:id`.
**Fix:** Reorder routes.

---

## 3. Android Bugs

### BUG-A01: Visualization response shape mismatch (HIGH)
**File:** `app/src/painter/java/com/qcpaintshop/painter/data/remote/api/VisualizationApi.kt:9-13`
**Defect:** `VisualizationsResponse` declares:
```kotlin
data class VisualizationsResponse(
    val success: Boolean,
    val completed: List<Visualization>?,
    val pending: List<Visualization>?,
)
```
But the web endpoint `GET /me/visualizations` (routes/painters.js:722-735) returns:
```json
{ "success": true, "visualizations": [...] }
```
No `completed`/`pending` split — just a flat `visualizations` array. Gson silently maps both fields to `null`. The entire VisualizationScreen shows empty.
**Severity:** HIGH — feature completely non-functional.
**Fix (Android):** Change response model to match web:
```kotlin
data class VisualizationsResponse(
    val success: Boolean,
    val visualizations: List<Visualization>?,
)
```
Then split by `status` in the ViewModel.

---

### BUG-A02: TodayAttendanceResponse field mismatch (MEDIUM)
**File:** `app/src/painter/java/com/qcpaintshop/painter/data/remote/api/AttendanceApi.kt:9-13`
**Defect:** Android expects `checked_in` (snake_case via @SerializedName) and `check_in_time`. Web endpoint `GET /me/attendance/today` (L2370-2387) returns:
```json
{ "success": true, "checkedIn": true, "attendance": { ... } }
```
`checkedIn` is camelCase (no @SerializedName match). `check_in_time` doesn't exist — it's inside `attendance.check_in_at`. The `checkedIn` field will always be null in the Kotlin model.
**Fix (Android):** Match web response shape or add SerializedName for both casings.

---

### BUG-A03: AttendanceApi.checkin() contract drift (MEDIUM)
**File:** `app/src/painter/java/com/qcpaintshop/painter/data/remote/api/AttendanceApi.kt:41-45`
**Defect:** `AttendanceCheckinResponse` expects `{ checkin_id, ap_earned, month_key }`. But the web `POST /me/attendance/check-in` (L2467-2490) returns:
```json
{ "success": true, "message": "...", "attendance": { "id": ..., "branch": ..., "distance": ..., "points": ..., "check_in_at": ... } }
```
Completely different shape — nested under `attendance`, different field names.
**Fix:** Align the Kotlin response model with actual web response, or create a wrapper.

---

### BUG-A04: Robolectric properties ✓ (CONFIRMED OK)
**File:** `app/src/testPainter/resources/robolectric.properties:2`
**Status:** Contains `sdk=34` as required. No bug.

---

### BUG-A05: Cold-start does NOT block on network ✓ (CONFIRMED OK)
**File:** `app/src/painter/java/com/qcpaintshop/painter/MainViewModel.kt:36-90`
**Status:** Phase 1 reads from DataStore (local), Phase 2 does background refresh. Network failures are silently ignored. Correctly implemented.

---

### BUG-A06: BuildConfig import uses namespace ✓ (CONFIRMED OK)
**File:** `app/src/painter/java/com/qcpaintshop/painter/data/remote/api/ApiClient.kt:3`
**Status:** `import com.qcpaintshop.act.BuildConfig` — correct. Namespace is `com.qcpaintshop.act`, not the painter applicationId `com.qcpaintshop.painter`.

---

### BUG-A07: AuthInterceptor correctly sends X-Painter-Token ✓ (CONFIRMED OK)
**File:** `app/src/painter/java/com/qcpaintshop/painter/data/remote/interceptor/AuthInterceptor.kt:19`
**Status:** `addHeader("X-Painter-Token", token)` — matches backend requirement.

---

### BUG-A08: FCM token field name matches backend ✓ (CONFIRMED OK)
**File:** `NotificationApi.kt:24` → `@SerializedName("fcm_token") val fcmToken`
**Web:** `routes/painters.js:2745` → `const { fcm_token, device_info } = req.body`
**Status:** Matches correctly.

---

### BUG-A09: Logging interceptor leaks in release → FIXED ✓
**File:** `ApiClient.kt:29-31`
**Status:** Already guards with `if (BuildConfig.DEBUG) Level.BODY else Level.NONE`. OK.

---

### BUG-A10: Hardcoded base URL (LOW)
**File:** `ApiClient.kt:12-13`
**Defect:** `BASE_URL = "https://act.qcpaintshop.com/api/painters/"` is hardcoded. No staging/dev URL support without rebuilding.
**Severity:** LOW — acceptable for single-environment app, but blocks QA on staging.
**Fix:** Read from `BuildConfig.BASE_URL` set per buildType.

---

### BUG-A11: WorkApi.getEstimates uses `page` but web expects `offset` (LOW)
**File:** `WorkApi.kt:35` → `@Query("page") page: Int = 1`
**Web:** `routes/painters.js:1311` → `const { status, limit = 50, offset = 0 } = req.query`
**Defect:** Web parses `offset` from query. Android sends `page` which is ignored by web — web defaults to `offset=0`, so pagination never advances.
**Fix (Android):** Change to `@Query("offset") offset: Int = 0`.

---

### BUG-A12: POST_NOTIFICATIONS permission request (REVIEW)
**File:** `app/src/painter/java/com/qcpaintshop/painter/ui/notifications/NotificationPermissionPrompt.kt`
**Status:** File exists, confirming the prompt is implemented. Would need runtime test on API 33+ to verify timing.

---

### BUG-A13: Missing `GenericResponse` definition (REVIEW)
**File:** Referenced in `NotificationApi.kt:36`, `VisualizationApi.kt:38`, etc.
**Status:** Not defined in any file read. Likely defined in a common file not in the scan. If missing, build would fail — so it must exist somewhere.

---

## 4. Android Test Plan (manual + automated)

### 4.1 Cold Start

| # | Setup | Steps | Expected | Failure |
|---|-------|-------|----------|---------|
| CS-1 | Fresh install, no login | Launch app | Login screen in <1s | Spinner >3s or crash |
| CS-2 | Logged-in, airplane mode | Force-stop, launch | Home screen from cache. No logout. | Login screen or error dialog |
| CS-3 | Logged-in, token expired on server | Launch with WiFi | Home screen initially (cache), then silently transitions if server returns 401 | Crash or immediate logout |
| CS-4 | Pending-approval painter | Launch | AwaitingApproval screen, not Home | Shows Home with empty data |

### 4.2 OTP Login

| # | Setup | Steps | Expected | Failure |
|---|-------|-------|----------|---------|
| OTP-1 | Registered phone | Enter phone → Send OTP → Enter correct OTP | Token stored, navigate to Home or AwaitingApproval | Error toast or stuck |
| OTP-2 | Unregistered phone | Enter phone → Send OTP | "Not registered" error with Register link | Generic error |
| OTP-3 | Wrong OTP 3x | Enter wrong OTP three times | Clear error message. Not locked out (no server-side limit currently!) | Crash or no feedback |
| OTP-4 | Play Store test: 9999999999 | Use test phone | OTP 123456 works | Rejected |

### 4.3 FCM Notifications (11 types)

| # | Type | Expected Screen | Verification |
|---|------|----------------|--------------|
| FCM-1 | `estimate_approved` | EstimateDetail(id) | Tapping notification opens correct estimate |
| FCM-2 | `estimate_rejected` | EstimateDetail(id) | Shows rejection notes |
| FCM-3 | `estimate_sent` | EstimateDetail(id) | Status shows "Sent to Customer" |
| FCM-4 | `payment_confirmed` | EstimateDetail(id) | Payment badge visible |
| FCM-5 | `estimate_invoiced` | EstimateDetail(id) | Zoho invoice number shown |
| FCM-6 | `points_earned` | PointsHistory | Balance updated |
| FCM-7 | `withdrawal_approved` | PointsHistory | Status = approved |
| FCM-8 | `new_offer` | Catalog | Offer carousel visible |
| FCM-9 | `attendance_reminder` | CheckIn screen | Check-in button enabled |
| FCM-10 | `streak_milestone` | Home | Streak count + bonus shown |
| FCM-11 | `training_new` | TrainingDetail(id) or Inbox (if no training_id) | Content loads |

### 4.4 Location Reporting

| # | Setup | Steps | Expected | Failure |
|---|-------|-------|----------|---------|
| LOC-1 | Location ON | Login → stay on Home 1 min | Admin live map shows painter position | Nothing on map (BUG-W02) |
| LOC-2 | Location OFF | Deny permission | App works normally, no crash | Crash or loop |
| LOC-3 | Rate limit | Send location rapidly | Server accepts max 1/25s | All accepted (resource waste) |

### 4.5 Attendance Check-in

| # | Setup | Steps | Expected | Failure |
|---|-------|-------|----------|---------|
| ATT-1 | Within geofence (500m) | Tap Check In, take selfie | Success, points shown | Error or wrong branch |
| ATT-2 | Outside geofence | Tap Check In | "Too far" with distance | Allowed in |
| ATT-3 | Already checked in today | Tap Check In again | "Already checked in" | Double check-in |
| ATT-4 | Camera denied | Tap Check In | Graceful fallback or prompt | Crash |

### 4.6 Estimate Create / Discount / Payment

| # | Setup | Steps | Expected | Failure |
|---|-------|-------|----------|---------|
| EST-1 | Self billing | Add products → Submit | Status = pending_admin | Draft or error |
| EST-2 | Customer direct | Add products + markup → Submit | Status = saved_direct | Goes to pending_admin |
| EST-3 | Request discount | On approved estimate → Request Discount | Status → discount_requested | Stays approved |
| EST-4 | Submit payment | On approved/final_approved → Pay | Status → payment_submitted | Error |
| EST-5 | Idempotency | Double-tap Submit | Only one estimate created | Duplicate |
| EST-6 | Color filter chips | Open estimate create → filter by color | Products filter by color_name/color_code | No filter chips or crash |

### 4.7 Points Withdrawal

| # | Setup | Steps | Expected | Failure |
|---|-------|-------|----------|---------|
| WD-1 | Has regular points | Request withdrawal from regular pool | Success, pending status | Error |
| WD-2 | Annual pool outside window | Request withdrawal | Error: "Annual withdrawal not open" | Allowed |
| WD-3 | Idempotency | Double-tap Withdraw | Only one withdrawal created | Duplicate |

### 4.8 Color Visualization Request

| # | Setup | Steps | Expected | Failure |
|---|-------|-------|----------|---------|
| VIZ-1 | Take room photo | Upload + select color | "Request submitted" | Error |
| VIZ-2 | View completed viz | After admin completes | Shows original + result | **Empty list (BUG-A01)** |

### 4.9 Visiting Card / ID Card

| # | Setup | Steps | Expected | Failure |
|---|-------|-------|----------|---------|
| CARD-1 | Profile complete | Open Cards → Visiting Card | Card image loads with name/phone/city | Blank or error |
| CARD-2 | Profile changed | Edit name → reopen Cards | Regenerated card with new name | Old card cached |

### 4.10 Offline Degradation

| Screen | Expected Behavior |
|--------|------------------|
| Home | Shows cached dashboard data, stale badge |
| Catalog | Shows error toast, empty product list |
| Estimate Create | Products fail to load, "No internet" message |
| Points History | "Failed to load" with retry button |
| Check-in | Location works locally but submission fails with "No internet" |
| Notifications | Shows cached notifications |
| Settings | All local, works offline |

### 4.11 Dark Mode & RTL

| # | Test | Expected |
|---|------|----------|
| DM-1 | Enable dark mode in system settings | All screens readable, no white-on-white |
| DM-2 | Force RTL in developer options | Layout mirrors correctly, no text truncation |

### 4.12 Automated Test Commands

```bash
# Unit tests (includes FCM deep-link tests, token manager tests)
./gradlew testPainterDebugUnitTest

# Build verification
./gradlew assemblePainterDebug

# Lint
./gradlew lintPainterDebug
```

---

## 5. Ready-to-Execute Prompt

````
You are fixing the QC Painter system. Git branch: fix/painter-bugs-2026-05.
Apply these changes in order. DO NOT skip any step.

## WEB FIXES (in /www/wwwroot/act.qcpaintshop.com/)

### Task 1: Fix challenge claim to use Points Engine
File: routes/painters.js
Lines: 5449-5468
Change: Replace raw SQL INSERT + UPDATE with:
```js
// Award points to regular pool via engine (applies level multiplier, clawback netting, level-up check)
await pointsEngine.addPointsWithMultiplier(
    req.painter.id, 'regular', challenge.reward_points, 'challenge_reward',
    `challenge-${challengeId}`, 'challenge', `Challenge reward: ${challenge.title}`, null
);
```
Remove the raw INSERT INTO painter_point_transactions and the UPDATE painters SET regular_points lines.
Wrap the claimed check + point award in a transaction.
Acceptance: `getBalance()` total_earned_regular includes challenge rewards. Level multiplier applies.

### Task 2: Fix location pipeline column name
File: routes/painters.js
Lines: 5845, 5872, 5889
Change: Replace `p.name` with `p.full_name` in all three SQL queries.
Acceptance: Admin live map shows painter names instead of "Unknown".

### Task 3: Fix daily bonus to use level multiplier
File: services/painter-points-engine.js
Line: 256
Change: Replace `await addPoints(...)` with `await addPointsWithMultiplier(...)` for daily_bonus.
Acceptance: Gold painter (1.5x) gets 150 daily bonus instead of 100.

### Task 4: Make estimate number generation atomic
File: routes/painters.js
Lines: 1133-1149
Change: Wrap in a transaction with SELECT ... FOR UPDATE, or use an auto-increment sequence table:
```sql
CREATE TABLE IF NOT EXISTS painter_estimate_sequence (
    date_prefix VARCHAR(12) PRIMARY KEY,
    last_seq INT NOT NULL DEFAULT 0
);
-- In generateEstimateNumber():
INSERT INTO painter_estimate_sequence (date_prefix, last_seq) VALUES (?, 1)
  ON DUPLICATE KEY UPDATE last_seq = last_seq + 1;
SELECT last_seq FROM painter_estimate_sequence WHERE date_prefix = ?;
```
Acceptance: 100 concurrent estimate creates produce 100 unique numbers.

### Task 5: Fix admin visualization route ordering
File: routes/painters.js
Lines: 6216-6314
Change: Move the three admin visualization routes (GET /admin/visualizations, PUT /admin/visualizations/:id, POST /admin/visualizations/:id/upload-result) to BEFORE the /:id route (before line 5985).
Acceptance: `GET /api/painters/admin/visualizations` returns visualization list, not "Invalid painter ID".

### Task 6: Add rate limiting to OTP endpoints
File: routes/painters.js
Lines: 253, 320
Change: Import rateLimiter and add OTP rate limit:
```js
const { otpRateLimit } = require('../middleware/rateLimiter');
router.post('/send-otp', otpRateLimit, async (req, res) => { ... });
router.post('/verify-otp', otpRateLimit, async (req, res) => { ... });
```
Acceptance: 6th OTP request within 1 minute returns 429.

### Task 7: Fix leaderboard column names
File: routes/painters.js
Lines: 5371-5381
Change: Replace `p.total_lifetime_points` with `(COALESCE(p.total_earned_regular,0) + COALESCE(p.total_earned_annual,0))` and `pt.points` with `pt.amount`.
Acceptance: Leaderboard shows actual point totals.

### Task 8: Remove OTP console.log in production
File: routes/painters.js
Line: 276
Change: Wrap in `if (process.env.NODE_ENV !== 'production')` or remove entirely.
Acceptance: OTPs not visible in PM2 logs.

### Task 9: Add attendance points dedup guard
File: services/painter-points-engine.js, function awardAttendancePoints
Change: Before awarding, check:
```js
const [existing] = await pool.query(
    "SELECT id FROM painter_point_transactions WHERE source='attendance' AND reference_id=? AND painter_id=?",
    [String(attendanceId), painterId]
);
if (existing.length) return 0; // already awarded
```
Acceptance: Calling awardAttendancePoints twice for same ID awards points only once.

## ANDROID FIXES (in the painter-android-src)

### Task 10: Fix VisualizationsResponse shape
File: app/src/painter/java/com/qcpaintshop/painter/data/remote/api/VisualizationApi.kt
Change: Replace VisualizationsResponse:
```kotlin
data class VisualizationsResponse(
    val success: Boolean,
    val visualizations: List<Visualization>?,
)
```
Update VisualizationViewModel to split by status locally:
```kotlin
val completed = visualizations.filter { it.status == "completed" }
val pending = visualizations.filter { it.status != "completed" }
```
Acceptance: Visualization screen shows submitted and completed items.

### Task 11: Fix TodayAttendanceResponse shape
File: app/src/painter/java/com/qcpaintshop/painter/data/remote/api/AttendanceApi.kt
Change: Match actual web response:
```kotlin
data class TodayAttendanceResponse(
    val success: Boolean,
    val checkedIn: Boolean?,   // camelCase matches backend
    val attendance: AttendanceRecord?,
)
data class AttendanceRecord(
    val id: Int?,
    val branch: String?,
    val distance: Int?,
    val points: Int?,
    @SerializedName("check_in_at") val checkInAt: String?,
)
```
Acceptance: CheckIn screen correctly shows "Already checked in" state.

### Task 12: Fix AttendanceCheckinResponse shape
File: app/src/painter/java/com/qcpaintshop/painter/data/remote/api/AttendanceApi.kt
Change: Match actual web POST response:
```kotlin
data class AttendanceCheckinResponse(
    val success: Boolean,
    val message: String?,
    val attendance: AttendanceCheckInData?,
)
data class AttendanceCheckInData(
    val id: Int?,
    val branch: String?,
    val distance: Int?,
    val points: Int?,
    @SerializedName("check_in_at") val checkInAt: String?,
)
```
Acceptance: After check-in, success message shows branch name and points.

### Task 13: Fix WorkApi pagination parameter
File: app/src/painter/java/com/qcpaintshop/painter/data/remote/api/WorkApi.kt
Line: 35
Change: Replace `@Query("page") page: Int = 1` with `@Query("offset") offset: Int = 0`.
Update WorkViewModel to compute offset from page: `offset = (page - 1) * limit`.
Acceptance: Scrolling past first 20 estimates loads more.

## VERIFICATION

```bash
# Android
./gradlew testPainterDebugUnitTest   # Must pass all FCM deep-link tests
./gradlew assemblePainterDebug        # Must compile clean

# Web (manual)
curl -s https://act.qcpaintshop.com/api/painters/admin/visualizations \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq .success
# Expected: true (not "Invalid painter ID")

curl -s https://act.qcpaintshop.com/api/painters/locations/live \
  -H "Authorization: Bearer $ADMIN_TOKEN" | jq '.locations[0].name'
# Expected: painter's full_name (not null)
```

Git branch: `fix/painter-bugs-2026-05`
Commit message: "fix: painter system bugs — challenge points, location names, viz API, estimate dedup, attendance, leaderboard"
````
