# Painter Live Location Tracking — Design Spec

## Overview

Always-on silent background location tracking for painters. Admin gets a live fleet map (all painters' current positions) and a route replay view (individual painter's breadcrumb trail for any day in the last 30 days). No painter-facing UI changes.

---

## 1. Approach

Reuse the existing `GeofenceLocationService` (shared `main` source set) with a painter-mode flag. When the service detects a painter auth token it reports to a new `/api/painters/location-report` endpoint and skips all geofence enforcement logic. Backend stores events in a new table, pushes live updates via Socket.io, and exposes REST endpoints for fleet view and route replay. Admin map uses Leaflet + OpenStreetMap.

---

## 2. Data Layer

### Table: `painter_location_events`

```sql
CREATE TABLE painter_location_events (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  painter_id   INT NOT NULL,
  latitude     DECIMAL(10,7) NOT NULL,
  longitude    DECIMAL(10,7) NOT NULL,
  accuracy_m   FLOAT,
  recorded_at  DATETIME NOT NULL,
  created_at   DATETIME DEFAULT NOW(),
  INDEX idx_painter_time (painter_id, recorded_at)
);
```

- `recorded_at` — device timestamp (what the app reports)
- `accuracy_m` — GPS accuracy radius in metres (informational)
- Index drives both live-query and replay-query efficiently

### Retention

Nightly cron at 02:30 IST in `painter-scheduler.js`:
```sql
DELETE FROM painter_location_events WHERE recorded_at < NOW() - INTERVAL 30 DAY
```

### Storage estimate

30s interval × 8h × 30 days × 100 painters ≈ 2.9M rows/month at ~50 bytes/row ≈ 145 MB. Well within MySQL comfort zone.

---

## 3. Android Changes

**File**: `app/src/main/java/com/qcpaintshop/act/location/GeofenceLocationService.kt`

### Painter-mode detection

On service start, read `SharedPreferences` for `painter_auth_token`. If present → `isPainterMode = true`. Staff token present → staff mode. Modes are mutually exclusive in practice (separate app flavors).

### Painter-mode reporting

When `isPainterMode = true`:
- POST location to `/api/painters/location-report` instead of `/api/attendance/location-report`
- Skip all geofence enforcement: 300m check, auto-clockout timer, location-off timer — single early-return guard per enforcement block
- Payload unchanged: `{ latitude, longitude, accuracy }`

### Service lifecycle

- Painter OTP login success → `startForegroundService(GeofenceLocationService)`
- Painter logout → `stopService(GeofenceLocationService)`
- These calls are added to the painter flavor's existing login/logout handlers:
  - Login: `app/src/painter/java/com/qcpaintshop/painter/ui/auth/LoginViewModel.kt` (on successful OTP verify)
  - Logout: `app/src/painter/java/com/qcpaintshop/painter/ui/profile/ProfileScreen.kt` (on logout button tap)

### No new permissions or files

`ACCESS_FINE_LOCATION` + `FOREGROUND_SERVICE` already declared in manifest. Painter flavor inherits them. The existing "QC Attendance Active" low-priority persistent notification is reused (silent, no sound/vibration).

---

## 4. Backend API

All new routes added to `routes/painters.js`.

### POST `/api/painters/location-report`

- Auth: `requirePainterAuth`
- Body: `{ latitude, longitude, accuracy }`
- Rate limit: max 1 insert per 25s per painter — enforced by querying `MAX(recorded_at)` for that painter before inserting; if last row is within 25s, skip insert and return 200 OK silently
- Action: INSERT into `painter_location_events`, then emit Socket.io event to admin room

```js
io.to('admin_painters_live').emit('painter_location_update', {
  painterId, name, latitude, longitude, accuracy, recordedAt
});
```

### GET `/api/painters/locations/live`

- Auth: `requireAuth` (admin)
- Returns one row per painter: latest ping within last 5 minutes + painter name, level, branch
- Painters with no ping in last 5 min included with `status: 'offline'`

### GET `/api/painters/:id/locations/history`

- Auth: `requireAuth` (admin)
- Query param: `date=YYYY-MM-DD` (defaults to today IST)
- Returns: `[{ latitude, longitude, accuracy_m, recorded_at }]` ordered chronologically
- Scoped to that painter's full day (midnight→midnight IST)

### Socket.io

Admin browser emits `join_admin_painters_live` when the Live Fleet Map panel becomes visible (on tab switch to Attendance Live + Live Fleet Map toggle). Server handler: `socket.on('join_admin_painters_live', () => socket.join('admin_painters_live'))`. Server emits `painter_location_update` to that room on each valid POST. No polling required for live view.

---

## 5. Admin UI

**Location**: `admin-painters.html` → Comms 📣 → Attendance Live sub-tab

Leaflet loaded via CDN in `<head>`:
```html
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
```

### Toggle pills

```
[ Live Fleet Map ]  [ Route Replay ]
```

Switches between two panels inside the Attendance Live tab.

### Live Fleet Map panel

- Leaflet map: `height: 500px` desktop / `height: 320px` mobile
- Painter pins: circle markers, colour-coded by level using existing `LEVEL_COLORS` (`Gold: #D4A24E`, `Silver: #9CA3AF`, `Bronze: #92400E`, `Default: #6366F1`)
- Popup on pin click: painter name, level, branch, last seen timestamp
- Offline painters (>5 min since last ping): grey faded marker
- Branch filter pill: `All Branches ▾`
- Socket.io `painter_location_update` moves pin in-place — no full reload
- "Last updated: Xs ago" counter in map top-right corner

### Route Replay panel

- Painter select dropdown (populated from existing painter list)
- Date picker (defaults to today)
- `Load Route` button → calls `GET /api/painters/:id/locations/history`
- Polyline drawn connecting all points in chronological order
- Start marker: green, End marker: red, intermediate points: small blue circles
- Timeline scrubber below map: drag to animate a marker along the route
- Stats below scrubber: point count + total distance (haversine sum, km)

---

## 6. Shared Patterns

- **Haversine**: reuse `haversineMeters()` already in `painter-attendance-service.js` for total distance calculation
- **IST date handling**: use local getters (not `toISOString()`) for midnight boundary queries
- **Auth guard**: `requirePainterAuth` for the report endpoint; `requireAuth` for admin read endpoints
- **Route ordering**: named routes (`locations/live`) declared before `/:id` param routes in `painters.js`

---

## 7. Out of Scope

- Painter-facing location history screen
- Geofence enforcement for painters (observational only)
- Location data older than 30 days
- Push notifications based on painter location
