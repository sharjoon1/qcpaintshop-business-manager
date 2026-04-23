# Painter App — Approval Flow Redesign

**Date:** 2026-04-23
**Scope:** Painter Android app (painter flavor) + backend + admin UI
**Status:** Approved for implementation

## Goal

Branch the painter app's entry flow into three distinct paths based on phone number and approval state:

1. **Registered + Approved** → standard OTP login → full app access
2. **Registered + Pending** → OTP login succeeds, session saved, "Waiting for Approval" screen with a rate-limited "Request Approval" button that tracks painter's interest
3. **Not Registered** → auto-navigate to registration form (phone pre-filled) → on submit, show success screen with link back to login

## User Flow

```
LoginScreen
  ↓ enter phone → tap "Send OTP"
  ↓
POST /send-otp
  ├─ 404 / code=NOT_REGISTERED
  │     → navigate RegisterScreen(phone)
  │     ↓ fill form → submit → RegistrationSuccessScreen
  │     ↓ "Go to Login" button → LoginScreen
  │
  └─ 200 (registered) → OtpScreen → POST /verify-otp
        ├─ status=approved → save session → HomeScreen
        └─ status=pending  → save session → PendingApprovalScreen
              ↓ "Request Approval" button (2-min rate-limit)
              ↓ POST /me/request-approval → counter++
              ↓ button disabled + countdown "Next in 1:43"
```

## Backend Design

### Schema changes

New migration: `migrations/migrate-painter-approval-requests.js`

```sql
ALTER TABLE painters
  ADD COLUMN approval_request_count INT NOT NULL DEFAULT 0,
  ADD COLUMN last_approval_request_at DATETIME NULL;
```

Single-row increment on `painters`. No separate events table.

### Auth middleware split

Current `requirePainterAuth` in `routes/painters.js:141-159` rejects any session where `status != 'approved'` with 403. Behavior:

- **`requirePainterAuth`** (unchanged) — rejects non-approved. All business routes (estimates, products, points, withdrawals, etc.) continue to use this.
- **`requirePainterSession`** (NEW) — validates token + loads painter for any status (`pending` or `approved`). Only used by the small whitelist below.

### Endpoint changes

**`POST /send-otp`** — minor tweak
- Current: 404 if painter not found (plain message)
- New: 404 response body standardised to `{ success: false, code: 'NOT_REGISTERED' }` so Android can reliably distinguish from generic network errors
- No logic change otherwise

**`POST /verify-otp`** — no code change
- Response shape unchanged. Already returns `token` + `painter.status` for all statuses
- Android-side change: save session for `pending` painters too (was skipped before)

**`POST /me/request-approval`** — NEW
- Auth: `requirePainterSession` (pending allowed)
- Logic:
  1. Load current `last_approval_request_at`
  2. If `last_approval_request_at > NOW() - INTERVAL 2 MINUTE`:
     - Return `429 { success: false, code: 'RATE_LIMITED', next_available_at: <ISO>, seconds_remaining: <int> }`
  3. `UPDATE painters SET approval_request_count = approval_request_count + 1, last_approval_request_at = NOW() WHERE id = ?`
  4. Return `200 { success: true, count: <new count>, next_available_at: <NOW+2min ISO> }`
- **No admin notification** per request — counter update only (user preference; avoid noise)

**`POST /me/profile`** — middleware swap
- Already exists. Switch from `requirePainterAuth` to `requirePainterSession` so pending painters can load their profile on the waiting screen (to show name, phone, registered details)

### Whitelist for pending painters

Only these endpoints work with a pending-status session:
- `GET /me/profile`
- `POST /me/request-approval`

All other painter endpoints remain `requirePainterAuth` and reject pending painters with 403.

**Logout:** no backend endpoint needed. The "Use a different number" link on the Android PendingApprovalScreen clears the local DataStore token and navigates to Login. Session row in `painter_sessions` ages out naturally via `expires_at`.

Once admin approves a painter, the DB `status` flips to `'approved'` — the existing session token automatically starts passing `requirePainterAuth` on subsequent requests (no re-login required).

### Backend files touched
- `routes/painters.js` — add `requirePainterSession`, new `/me/request-approval` endpoint, swap middleware on `/me/profile`, standardise `/send-otp` 404 response
- `migrations/migrate-painter-approval-requests.js` — new
- `Skills.md` — documentation

## Android Design

### File structure

Painter flavor auth flow — 5 screens (2 rewrite, 3 modify):

```
app/src/painter/java/com/qcpaintshop/painter/ui/auth/
├── LoginScreen.kt                    MODIFY — handle 404 → Register nav
├── RegisterScreen.kt                 MODIFY — accept phone arg, pre-fill
├── RegistrationSuccessScreen.kt      MODIFY — add "Go to Login" button
├── PendingApprovalScreen.kt          REWRITE — session + request button
└── AuthViewModel.kt                  MODIFY — new state + request method

app/src/painter/java/com/qcpaintshop/painter/
├── data/auth/AuthRepository.kt       MODIFY — save session for pending
├── navigation/Routes.kt              MODIFY — Register route takes phone arg
└── MainActivity.kt                   MODIFY — startup status check
```

### Screen specs

**LoginScreen (MODIFY)**
- On "Send OTP" tap, `AuthViewModel.sendOtp(phone)` calls `POST /send-otp`
  - `200 success` → navigate to OTP input (current behavior)
  - `404` / `code: NOT_REGISTERED` → `navController.navigate(Routes.Register(phone))`
  - Network error → toast, stay on screen
- No visual change; only navigation branching

**RegisterScreen (MODIFY)**
- New nav argument: `phone: String`
- Phone field pre-filled and **locked** (read-only) — painter already confirmed it in login
- On submit → existing `POST /register` → navigate to `RegistrationSuccessScreen`
- Other fields unchanged

**RegistrationSuccessScreen (MODIFY)**
- Current: static "Account Pending Approval" text
- Add a prominent **"Go to Login"** button (primary green, full-width) at the bottom
- Click: `navController.popBackStack(Routes.Login, inclusive = false)` — clears register stack, returns to login

**PendingApprovalScreen (REWRITE)**
- Shown when `verify-otp` returns `status=pending` (session now saved)
- Layout:
  - Title: **"Waiting for Admin Approval"**
  - Subtitle: painter's name + phone (loaded from `/me/profile`)
  - Body: "Your account is under review. Tap the button below to notify admin of your interest."
  - **"Request Approval"** button (green, full-width, prominent)
    - Enabled state: "Request Approval" with icon
    - Disabled state (within 2-min window): "Next request in 1:43" with live countdown ticking every 1s
    - Tap → `POST /me/request-approval`
      - `200` → toast "Request sent!" + counter display updates ("Requests sent: 7") + start 2-min countdown
      - `429` → sync countdown using `seconds_remaining` from response (handles app reinstall / cross-device)
  - Counter display: "Requests sent: N" shown below button
  - Bottom small text link: **"Use a different number"** — clears session + navigates to Login
- Countdown: `rememberSaveable { mutableStateOf(nextAvailableAtEpoch) }` + `LaunchedEffect` with `delay(1000)` ticker. Survives config change + process death.

**AuthViewModel changes**
- Remove "don't save session if pending" logic. Save always.
- `isPendingApproval` state stays, drives navigation post-OTP to `PendingApprovalScreen` vs `Home`
- New method `requestApproval()` — calls endpoint, returns `Result<RequestApprovalResponse>` with `count` and `next_available_at`

**AuthRepository changes**
- Current: saves session token only if `status != 'pending'`
- New: always save session token; let navigation layer decide destination based on status

### App startup behavior (MainActivity)

Current: if token exists in DataStore → navigate to Home. This breaks for pending painters now that sessions are saved (they'd see a broken Home with 403s).

New startup flow:
1. If no token → Login
2. If token exists → call `GET /me/profile`
   - `200` + `status=approved` → Home
   - `200` + `status=pending` → PendingApprovalScreen
   - `401` (expired/invalid) → clear token → Login
3. During the `/me/profile` call, show existing splash/loading UI (no new spinner)

### Android files touched
- `LoginScreen.kt`, `RegisterScreen.kt`, `RegistrationSuccessScreen.kt`, `PendingApprovalScreen.kt` (rewrite), `AuthViewModel.kt`, `AuthRepository.kt`, `Routes.kt`, `MainActivity.kt`

## Admin UI Design

### Location
`public/admin-painters.html` — **Pending Approvals** tab (under Painters group nav)

### Changes

Add **Interest** column to both mobile card and desktop table views in the pending list:

```
Name          Phone         City      Registered    Interest             Actions
John Painter  +91 9876...   Chennai   2 days ago    🔔 7 requests        [Approve] [Reject]
                                                    Last: 3h ago
Mary Painter  +91 9999...   Salem     1 hour ago    — (no requests)      [Approve] [Reject]
```

**Interest column rendering:**
- 0 requests: `—` (muted gray)
- 1-2: blue badge `🔔 N requests`
- 3-5: amber badge
- 6+: red badge (high-interest signal)
- Secondary line: `Last: Xh ago` (relative time from `last_approval_request_at`; hidden if count=0)

### Sort option
Add **"Sort by Interest"** pill in the pending tab. Query: `ORDER BY approval_request_count DESC, last_approval_request_at DESC`.

### API change
Existing admin list endpoint — `GET /admin/painters?status=pending` — extend SELECT to include `approval_request_count` and `last_approval_request_at`. No new endpoint.

### Admin files touched
- `public/admin-painters.html` — Interest column in pending tab + sort pill
- `routes/painters.js` — admin list SELECT includes new columns

## Testing

- **Backend unit tests** — rate-limit logic (2-min window), counter increment, middleware gating (pending painter can hit `/me/request-approval` but not `/me/estimates`)
- **Manual Android test flows**:
  1. Fresh install, unregistered phone → registration → success → login → pending screen
  2. Registered pending painter → login → pending screen → tap Request Approval → counter increments, button disables, countdown ticks
  3. Registered approved painter → login → home, full app
  4. Pending painter — admin approves in DB → next API call / re-open app → lands on home (no re-login)
  5. Rate limit — tap button twice quickly → second tap shows 429 countdown synced correctly
- **Admin UI** — sort by interest, badge colors at 0/2/4/7 counts

## Non-goals

- No push notification to admin on each approval request (counter update only; user preference)
- No rejection flow (admin just keeps status as pending; no separate "rejected" state this iteration)
- No email/SMS notification to painter on approval — existing FCM notification flow handles it
