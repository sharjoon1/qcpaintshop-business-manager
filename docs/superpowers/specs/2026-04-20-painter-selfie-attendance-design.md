# Painter Selfie Attendance + Attendance Points (AP) System

**Date:** 2026-04-20
**Status:** Design approved, pending implementation plan
**Scope:** Sub-project B of a 4-part painter app upgrade (A: estimate submit bug, B: attendance, C: card redesign, D: home offer filter)

## Problem

1. The existing painter daily check-in (streak-based, no selfie, no location) does not give management any verifiable proof that a painter actually visited a QC branch.
2. Painters currently have no attendance-based incentive tied to their sales performance at that branch.

## Goals

- Painter must physically be at a QC branch (within 300m geofence) to check in.
- Each check-in earns 100 **Attendance Points (AP)**, tracked in a new pool separate from regular/annual points.
- AP earned in a month are only claimable if the painter has generated customer billing that month. Claim percentage scales with monthly billing (₹1,000 = 1%, capped at ₹1,00,000 = 100%).
- Claim is a month-end action — painter has a 7-day window (1st–7th of following month) to claim AP into the regular points pool (where existing withdrawal flow applies). Unclaimed AP forfeit.
- Existing streak-bonus logic is preserved in parallel (not replaced, not merged).
- Server storage is managed: selfies auto-purge after the claim window closes.

## Non-Goals

- Attendance system for staff (staff already have their own attendance module).
- Check-in at non-QC locations (dealer shops, customer sites, etc.).
- Web painter-dashboard claim UI is Phase-2; Phase-1 is Android-first with optional hero-card preview on web.
- Offline check-in / sync-later — check-in requires live network.

## User Flow

### Painter — Daily Check-in

1. Painter arrives at a QC branch.
2. Opens app → Home screen → taps **Check in Today** on Hero card.
3. App requests CAMERA + ACCESS_FINE_LOCATION permissions (if not already granted).
4. Full-screen front-camera preview. Below: dropdown listing QC branches within 1 km (auto-selected to closest).
5. Painter taps **Capture Selfie** → preview → **Submit Attendance**.
6. Backend validates distance, stores selfie, credits 100 AP.
7. App shows snackbar `✓ 100 AP earned` and returns to Home. HeroCard now shows updated AP totals.

### Painter — Month-End Claim

1. On the 1st of each month at 00:05 IST, a cron job closes the previous month and computes each eligible painter's `claim_pct` and `claimable_ap`.
2. Eligible painters receive a push: *"Claim window open! 1,400 AP available (based on ₹45k bills)."*
3. Painter opens Attendance screen → sees **Claim 1,400 AP** button.
4. Taps button → confirmation modal → backend transfers AP into regular points pool.
5. Painter sees updated balance in Points card; can then withdraw via existing flow.
6. On the 7th at 20:00 IST, unclaimed painters get a reminder push.
7. On the 8th at 02:00 IST, any still-unclaimed rows become `forfeited` and the previous month's selfie folder is purged.

### Admin — Daily Monitoring

1. Admin opens `admin-painters.html` → **Attendance** tab.
2. **Today's Check-ins** sub-view shows a live table of recent check-ins with selfie thumbnails.
3. Admin spots a suspicious selfie (wrong person, blurry, not at shop) → clicks **Reject** → enters reason → confirms.
4. System claws back 100 AP. If already claimed, adds `pending_clawback` flag that is settled against the next credit.
5. Painter receives a rejection push.

## Architecture

### Data Model

**Three new tables**, one column addition to `branches`, seven new `ai_config` rows. The existing `painter_daily_checkins` streak table is **retained untouched** and updated in parallel when a new check-in is created.

#### Table: `painter_attendance_checkins`

Daily check-in records (one row per painter per day).

| Column | Type | Notes |
|---|---|---|
| `id` | INT PK AUTO_INCREMENT | |
| `painter_id` | INT NOT NULL | FK `painters.id` |
| `branch_id` | INT NOT NULL | FK `branches.id` |
| `checkin_date` | DATE NOT NULL | Local IST date of check-in |
| `checkin_at` | DATETIME NOT NULL | IST timestamp |
| `latitude` | DECIMAL(10,7) | Painter's reported GPS |
| `longitude` | DECIMAL(10,7) | Painter's reported GPS |
| `distance_meters` | INT | Computed haversine to branch center |
| `selfie_path` | VARCHAR(500) | Server path `/uploads/painter-attendance/...` |
| `status` | ENUM('approved','rejected') NOT NULL DEFAULT 'approved' | Auto-approved on create; admin may reject |
| `rejected_at` | DATETIME NULL | |
| `rejected_reason` | VARCHAR(500) NULL | |
| `rejected_by` | INT NULL | FK `users.id` |
| `points_awarded` | INT NOT NULL DEFAULT 100 | Snapshot of config at check-in time |
| `month_key` | CHAR(7) GENERATED ALWAYS AS (DATE_FORMAT(checkin_date, '%Y-%m')) VIRTUAL | Indexed for monthly queries |
| `created_at` | DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP | |

**Constraints:**
- `UNIQUE KEY uk_painter_day (painter_id, checkin_date)` — one check-in per painter per day
- `INDEX idx_month (painter_id, month_key)` — monthly rollup queries
- `INDEX idx_branch_date (branch_id, checkin_date)` — admin today-view queries
- `INDEX idx_status_date (status, checkin_date)` — pending review queries

#### Table: `painter_attendance_monthly`

Per-painter, per-month aggregate + claim state (one row per painter per month).

| Column | Type | Notes |
|---|---|---|
| `id` | INT PK AUTO_INCREMENT | |
| `painter_id` | INT NOT NULL | |
| `month_key` | CHAR(7) NOT NULL | e.g. `2026-04` |
| `total_checkins` | INT NOT NULL DEFAULT 0 | Count of approved check-ins that month |
| `total_ap_earned` | INT NOT NULL DEFAULT 0 | `total_checkins × points_per_day` |
| `monthly_customer_billed` | DECIMAL(12,2) NOT NULL DEFAULT 0 | Recomputed live during claim window |
| `claim_pct` | DECIMAL(5,2) NOT NULL DEFAULT 0 | min(100, billed/1000) |
| `claimable_ap` | INT NOT NULL DEFAULT 0 | floor(total_ap × claim_pct / 100) |
| `ap_claimed` | INT NOT NULL DEFAULT 0 | Actually claimed; ≤ claimable_ap |
| `claim_status` | ENUM('pending','available','claimed','forfeited') NOT NULL DEFAULT 'pending' | |
| `claim_window_opens_at` | DATETIME NULL | Set when cron computes on 1st |
| `claim_window_closes_at` | DATETIME NULL | 7 days after opens_at |
| `claimed_at` | DATETIME NULL | |
| `forfeited_at` | DATETIME NULL | |
| `updated_at` | DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP | |

**Constraints:**
- `UNIQUE KEY uk_painter_month (painter_id, month_key)`
- `INDEX idx_status_month (claim_status, month_key)` — forfeit cron query

#### Table: `painter_attendance_ledger`

Append-only audit trail for all AP movements.

| Column | Type | Notes |
|---|---|---|
| `id` | INT PK AUTO_INCREMENT | |
| `painter_id` | INT NOT NULL | |
| `month_key` | CHAR(7) NOT NULL | |
| `checkin_id` | INT NULL | FK `painter_attendance_checkins.id`; null for claim/forfeit |
| `type` | ENUM('earn','claim','clawback','forfeit') NOT NULL | |
| `ap_delta` | INT NOT NULL | Signed: +100 earn, -N claim/clawback/forfeit |
| `reason` | VARCHAR(500) NULL | |
| `created_at` | DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP | |
| `created_by` | INT NULL | `users.id` for admin actions; null for painter/system |

**Indexes:** `(painter_id, month_key)`, `(type, created_at)`

#### Column addition: `branches.latitude`, `branches.longitude`

Conditional migration: if columns absent, add `DECIMAL(10,7) NULL`. Admin branch-edit UI must expose these for geofencing to work. Branches with NULL coordinates are excluded from `branches-nearby` lookup and cannot accept check-ins.

#### Config keys (in `ai_config`)

| Key | Default | Meaning |
|---|---|---|
| `painter_attendance_enabled` | `1` | Master switch |
| `painter_attendance_points_per_day` | `100` | AP credited per check-in |
| `painter_attendance_claim_rupees_per_pct` | `1000` | ₹1,000 of customer billing = 1% claim |
| `painter_attendance_claim_max_pct` | `100` | Cap at 100% |
| `painter_attendance_geofence_meters` | `300` | Max distance from branch center |
| `painter_attendance_claim_window_days` | `7` | Claim allowed 1st–7th of next month |
| `painter_attendance_image_retention_days` | `8` | Selfies purged on 8th of next month |

### Services

**`services/painter-attendance-service.js` (new)**

Responsibilities:
- `validateCheckin({painter_id, branch_id, lat, lng})` — geofence + duplicate check
- `haversineMeters(lat1, lng1, lat2, lng2)`
- `recordCheckin({painter_id, branch_id, lat, lng, selfie_path})` — txn: insert checkin + ledger + upsert monthly
- `recomputeMonthly(painter_id, month_key)` — sum check-ins, recompute AP/claim fields
- `computeClaimable(painter_id, month_key)` — fetch customer billing, apply formula
- `claimMonth(painter_id, month_key)` — txn: ledger debit + credit regular pool via `painter-points-engine` + update monthly status
- `rejectCheckin(checkin_id, reason, admin_user_id)` — txn: mark rejected + clawback ledger + recompute monthly; if month already claimed, add `pending_clawback` flag via a `painter_clawback_pending` helper (or subtract from regular pool if `>= 100` balance)
- `openClaimWindowForMonth(month_key)` — cron entry: iterate painters, compute claimable, set status
- `closeClaimWindowForMonth(month_key)` — cron entry: forfeit unclaimed, purge selfies from folder

**`services/painter-attendance-service.js` integration points:**
- Reuses `painter-points-engine.creditPoints(painter_id, ap, 'regular', reason)` for claim credit.
- Reuses `painter-notification-service.sendToPainter()` for all FCM pushes.
- Customer billing query: `SELECT SUM(total) FROM painter_estimates WHERE painter_id=? AND billing_type='customer' AND status IN ('pushed_to_zoho','payment_recorded') AND DATE_FORMAT(created_at, '%Y-%m')=?`.

### API Endpoints

All under existing `routes/painters.js` (painter auth via `X-Painter-Token`) and `routes/painters.js` (admin auth via `requirePermission('painters','manage')`).

**Painter endpoints:**

| Method | Path | Request | Response |
|---|---|---|---|
| `GET` | `/api/me/attendance/branches-nearby?lat=&lng=` | query params | `[{branch_id, name, distance_meters}]` within 1km |
| `POST` | `/api/me/attendance/checkin` | multipart: `selfie` file + `branch_id`, `latitude`, `longitude` | `{checkin_id, ap_earned, month_total_ap, streak_days}` |
| `GET` | `/api/me/attendance/month?month=YYYY-MM` | query | `{checkins:[...], total_ap, monthly_billed_preview, claimable_ap_preview, claim_status, claim_window}` |
| `GET` | `/api/me/attendance/history` | none | `[{month_key, total_checkins, total_ap, claimable, claimed, status}, ...]` (last 12 months) |
| `POST` | `/api/me/attendance/claim` | `{month_key}` | `{claimed_ap, new_regular_balance}` |

**Admin endpoints:**

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/painters/attendance/today?branch_id=&date=` | Today's check-ins, filterable |
| `GET` | `/api/painters/attendance/monthly?month=YYYY-MM&branch_id=` | Monthly summary across painters |
| `GET` | `/api/painters/:id/attendance/calendar?month=YYYY-MM` | Per-painter calendar |
| `POST` | `/api/painters/:painterId/attendance/:checkinId/reject` | `{reason}` → clawback |

### Cron Jobs (`painter-scheduler.js` additions, IST)

| Name | Schedule | Action |
|---|---|---|
| `openMonthlyAttendanceClaim` | `5 0 1 * *` | For prev month: compute billing + claim_pct + claimable_ap per painter; set status=`available`; push notif |
| `recomputeClaimableDuringWindow` | `0 */6 1-7 * *` | During 1st–7th, every 6h: recompute `monthly_customer_billed` + `claimable_ap` for `status='available'` rows (catches late-recorded payments) |
| `remindUnclaimedAttendance` | `0 20 7 * *` | 7th 20:00 IST: push to painters with `status='available'` + `claimable_ap>0` |
| `closeAttendanceClaimWindow` | `0 2 8 * *` | 8th 02:00 IST: unclaimed → `forfeited`; purge selfies from prev-month folders |

### Android UI (painter flavor)

**Files affected** (`qcpaintshop-android/app/src/painter/java/com/qcpaintshop/painter/...`):

- `ui/attendance/CheckInScreen.kt` — **rewrite**: CameraX preview + GPS + branch dropdown + selfie capture
- `ui/attendance/CheckInViewModel.kt` — **rewrite**: permission handling, location fetch, multipart upload
- `ui/attendance/AttendanceHistoryScreen.kt` — **new**: tabs (This Month / History), claim button
- `ui/attendance/AttendanceViewModel.kt` — **new**: monthly data + claim action
- `ui/attendance/AttendanceCalendarScreen.kt` — existing, refactor or delete (consolidate into HistoryScreen)
- `ui/home/HomeScreen.kt` — update HeroCard: add AP row + "Check in Today" CTA + conditional claim button
- `ui/home/HomeViewModel.kt` — fetch attendance summary alongside existing home data
- `network/AttendanceApi.kt` — **new**: Retrofit interface for 5 painter endpoints
- `AndroidManifest.xml` — ensure CAMERA, ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION permissions (runtime-requested)
- `build.gradle` (app) — CameraX deps if not already present; Accompanist Permissions for runtime permission UI

**Image capture:**
- CameraX front-facing preview
- JPEG compression to target ~500 KB (quality 80)
- Multipart POST to `/api/me/attendance/checkin`

### Admin Web UI (`public/admin-painters.html`)

**New tab: "Attendance"** (after existing tabs; position 11).

Sub-views:
1. **Today's Check-ins** (default) — branch/date filters, table with thumbnails, reject action, auto-refresh 60s.
2. **Monthly Summary** — month + branch filter, per-painter rollup, CSV export.
3. **Per-Painter Calendar** (drill-in from Today or Monthly rows) — 30-day grid, click cell → modal with full-size selfie + map pin + reject.

**Endpoints wired:** Four admin endpoints listed above. Permission: `painters.manage`.

### Web Painter Dashboard (`public/painter-dashboard.html`)

Phase-1 addition: Hero card AP summary row + claim button + month summary (read-only). Full history screen deferred to Phase-2.

### Notifications (`painter-notification-service.js`)

New FCM types (and Socket.io fallbacks):

| Type | When |
|---|---|
| `attendance_checkin_confirmed` | After successful check-in |
| `attendance_claim_window_open` | 1st 00:05 IST cron |
| `attendance_claim_reminder` | 7th 20:00 IST cron |
| `attendance_claimed_success` | After painter claims |
| `attendance_rejected` | After admin rejects |
| `attendance_forfeited` | 8th cron (summary) |

Deep-link routing: payload includes `target: 'attendance'` → app opens `AttendanceHistoryScreen`.

### Storage

- Path: `public/uploads/painter-attendance/{painter_id}/{YYYY-MM-DD}.jpg`
- Multer config: new `uploadPainterAttendance` in `config/uploads.js`. Limit 5 MB; accept `image/*`; single file field `selfie`.
- Folder creation: per painter, on first check-in of month.
- Purge: on 8th of month, `rm -rf uploads/painter-attendance/*/YYYY-MM-*` for `YYYY-MM` = prev-prev month (keeps current + claim-window month).

## Clawback Semantics

When admin rejects a check-in:

| Case | Action |
|---|---|
| Month not yet closed (`claim_status='pending'`) | Decrement `total_checkins`, `total_ap_earned`. Insert `clawback` ledger row. |
| Month in claim window (`claim_status='available'`) | Same as above + recompute `claimable_ap`. If painter already claimed partial, treat remaining as available. |
| Month already claimed (`claim_status='claimed'`) | If painter's regular balance ≥ 100, debit immediately via `painter-points-engine.debitPoints()`. Else insert `painter_clawback_pending` row (**new table**: `id, painter_id, amount, reason, created_at, settled_at, settled_ledger_id`). The existing `painter-points-engine.creditPoints()` is extended to check this table on every credit and net out pending clawback first. |
| Month forfeited | Still insert clawback ledger row for audit; no point impact. |

## Error Handling

| Condition | HTTP | Payload |
|---|---|---|
| Already checked in today | 409 | `{code:'ALREADY_CHECKED_IN', existing_checkin:{...}}` |
| Outside geofence | 400 | `{code:'OUTSIDE_GEOFENCE', distance_meters, closest_branch:{id,name,distance}}` |
| Selfie missing/too large | 400 | `{code:'SELFIE_REQUIRED'|'SELFIE_TOO_LARGE'}` |
| Branch inactive/not found | 400 | `{code:'BRANCH_INACTIVE'}` |
| Claim outside window | 400 | `{code:'CLAIM_WINDOW_CLOSED', window:{opens,closes}}` |
| No claimable AP | 400 | `{code:'NO_CLAIMABLE_AP'}` |
| Already claimed | 409 | `{code:'ALREADY_CLAIMED', claimed_at}` |

## Testing Strategy

**Unit tests** (`tests/painter-attendance.test.js`):
- Haversine distance correctness (known coordinate pairs)
- `claim_pct` table: `0→0, 999→0, 1000→1, 49_999→49, 50_000→50, 99_999→99, 100_000→100, 500_000→100`
- `claimable_ap = floor(total_ap × claim_pct / 100)`: `(2000 AP, 50%)→1000`, `(1500 AP, 33%)→495`
- Ledger double-entry sum per (painter, month) = current monthly row state

**Integration tests:**
- Happy path: check-in → monthly close → claim → regular pool credit
- Geofence rejection with closest-branch suggestion
- Duplicate check-in same day → 409
- Admin reject before claim → monthly totals decremented
- Admin reject after claim → clawback pending
- Forfeit cron on 8th → unclaimed → forfeited; images purged

**Regression:** existing `painter_daily_checkins` streak bonus continues to fire correctly on new check-ins.

## Migration

**`migrations/migrate-painter-attendance.js`:**
1. Create `painter_attendance_checkins`, `painter_attendance_monthly`, `painter_attendance_ledger`, `painter_clawback_pending` tables.
2. Add `branches.latitude`, `branches.longitude` columns if absent (conditional).
3. Insert seven `ai_config` rows (idempotent, `INSERT IGNORE`).
4. Ensure `uploads/painter-attendance/` directory exists.
5. Log branches missing GPS coords for admin follow-up.

## Rollout

1. Deploy backend + migration. Branches without GPS are silently excluded from geofence lookups; admin sets them via branch-edit UI.
2. Enable feature with `painter_attendance_enabled = 0` initially.
3. Android APK build + Play Store release (v3.x.0 bump).
4. Flip `painter_attendance_enabled = 1` once app is live.
5. Internal smoke test at one branch with one painter end-to-end before broadcasting.

## Open Questions / Future Work

- **Phase-2 web dashboard parity** — full attendance history screen on `painter-dashboard.html`.
- **Offline queue** — not in scope for Phase-1; painter must be online to check in.
- **Selfie face-matching** — future enhancement to auto-flag mismatched faces against painter profile photo.
- **Multi-branch check-in** — currently 1/day regardless of branch. A painter visiting two branches in one day will only get 100 AP.
- **Branch GPS backfill** — admin UX to set branch coordinates needs separate small task if not already present.
