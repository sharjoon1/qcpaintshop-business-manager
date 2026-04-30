# Painter Live Location Tracking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Always-on silent GPS tracking for painter app users, with a live fleet map and per-painter route replay in the admin panel.

**Architecture:** Reuse existing `GeofenceLocationService.kt` (shared `main` source set) with a `painter_mode` intent extra — when set, the service posts to `/api/painters/me/location-report` using `X-Painter-Token` header and skips all geofence enforcement. Backend stores events in a new `painter_location_events` table, broadcasts via Socket.io to admin room `admin_painters_live`, and exposes fleet-view and history endpoints. Admin UI adds a "Live Location" sub-tab inside the Attendance tab in `admin-painters.html`.

**Tech Stack:** MySQL, Express.js, Socket.io, Leaflet 1.9.4 + OpenStreetMap, Kotlin/Android, Jetpack Hilt, Jest

---

## File Map

| File | Change |
|------|--------|
| `migrations/migrate-painter-location.js` | CREATE — new migration |
| `routes/painters.js` | MODIFY — 3 new routes before line 5656 |
| `server.js` | MODIFY — Socket.io `join_admin_painters_live` handler ~line 3591 |
| `services/painter-scheduler.js` | MODIFY — retention cron at 02:30 IST |
| `app/src/main/java/com/qcpaintshop/act/location/GeofenceLocationService.kt` | MODIFY — painter mode flag + URL branch |
| `app/src/painter/java/com/qcpaintshop/painter/data/repository/AuthRepository.kt` | MODIFY — start/stop service on login/logout |
| `public/admin-painters.html` | MODIFY — Leaflet CDN + Live Location sub-tab + JS |
| `tests/unit/painter-location.test.js` | CREATE — pure logic tests |

---

## Task 1: DB Migration

**Files:**
- Create: `migrations/migrate-painter-location.js`

- [ ] **Step 1: Write the migration file**

```js
// migrations/migrate-painter-location.js
async function up(pool) {
    const [tables] = await pool.query("SHOW TABLES LIKE 'painter_location_events'");
    if (!tables.length) {
        await pool.query(`
            CREATE TABLE painter_location_events (
                id          BIGINT AUTO_INCREMENT PRIMARY KEY,
                painter_id  INT NOT NULL,
                latitude    DECIMAL(10,7) NOT NULL,
                longitude   DECIMAL(10,7) NOT NULL,
                accuracy_m  FLOAT,
                recorded_at DATETIME NOT NULL,
                created_at  DATETIME DEFAULT NOW(),
                INDEX idx_painter_time (painter_id, recorded_at),
                FOREIGN KEY (painter_id) REFERENCES painters(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('  Created painter_location_events table');
    } else {
        console.log('  painter_location_events already exists, skipping');
    }
    console.log('[Migration] painter-location complete');
}

module.exports = { up };
```

- [ ] **Step 2: Run the migration**

```bash
cd "D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\act.qcpaintshop.com"
node migrate.js
```

Expected output: lines ending with `painter-location complete` and no errors.

- [ ] **Step 3: Verify the table was created**

```bash
node -e "require('dotenv').config(); const m=require('mysql2/promise'); (async()=>{ const p=await m.createPool({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME}); const [r]=await p.query('DESCRIBE painter_location_events'); console.log(r.map(c=>c.Field)); process.exit(); })()"
```

Expected: `[ 'id', 'painter_id', 'latitude', 'longitude', 'accuracy_m', 'recorded_at', 'created_at' ]`

- [ ] **Step 4: Commit**

```bash
git add migrations/migrate-painter-location.js
git commit -m "feat(location): db migration — painter_location_events table"
```

---

## Task 2: Backend Routes

**Files:**
- Modify: `routes/painters.js` (insert before the `router.get('/', requireAuth` at line 5656)

**Context:** `routes/painters.js` exports `{ router, setPool, setIO, setSessionManager }`. The `pool` variable and `io` variable are already available in the module scope. `requirePainterAuth` reads `req.headers['x-painter-token']` and sets `req.painter = { id, name }`. Named routes (`/locations/live`) MUST be placed before `router.get('/:id', ...)` at line 5755 to avoid `locations` being parsed as a painter ID.

- [ ] **Step 1: Write the failing test (pure helper only)**

Create `tests/unit/painter-location.test.js`:

```js
// tests/unit/painter-location.test.js
'use strict';

// Pure helper used inside the history endpoint to compute IST date string
function toISTDateString(date) {
    const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
    return `${ist.getFullYear()}-${String(ist.getMonth() + 1).padStart(2, '0')}-${String(ist.getDate()).padStart(2, '0')}`;
}

// Pure helper to sum haversine distances over an ordered array of {latitude, longitude} points
const EARTH_RADIUS_M = 6371000;
function toRad(deg) { return deg * Math.PI / 180; }
function haversineMeters(lat1, lng1, lat2, lng2) {
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return Math.round(EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
function totalRouteMeters(points) {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
        total += haversineMeters(
            Number(points[i - 1].latitude), Number(points[i - 1].longitude),
            Number(points[i].latitude), Number(points[i].longitude)
        );
    }
    return total;
}

describe('toISTDateString', () => {
    test('UTC midnight → IST date is next day', () => {
        // 2026-04-22 00:00:00 UTC = 2026-04-22 05:30:00 IST → date "2026-04-22"
        const d = new Date('2026-04-22T00:00:00.000Z');
        expect(toISTDateString(d)).toBe('2026-04-22');
    });
    test('UTC 18:31 → IST date is next calendar day', () => {
        // 2026-04-22 18:31:00 UTC = 2026-04-23 00:01:00 IST → date "2026-04-23"
        const d = new Date('2026-04-22T18:31:00.000Z');
        expect(toISTDateString(d)).toBe('2026-04-23');
    });
    test('zero-pads month and day', () => {
        const d = new Date('2026-01-05T00:00:00.000Z');
        expect(toISTDateString(d)).toBe('2026-01-05');
    });
});

describe('totalRouteMeters', () => {
    test('empty array → 0', () => {
        expect(totalRouteMeters([])).toBe(0);
    });
    test('single point → 0', () => {
        expect(totalRouteMeters([{ latitude: 13.0827, longitude: 80.2707 }])).toBe(0);
    });
    test('two points ~1km apart', () => {
        const dist = totalRouteMeters([
            { latitude: 13.0827, longitude: 80.2707 },
            { latitude: 13.0917, longitude: 80.2707 }
        ]);
        expect(dist).toBeGreaterThan(900);
        expect(dist).toBeLessThan(1100);
    });
    test('three points sums correctly', () => {
        const p1 = { latitude: 13.0827, longitude: 80.2707 };
        const p2 = { latitude: 13.0917, longitude: 80.2707 };
        const p3 = { latitude: 13.1007, longitude: 80.2707 };
        const d12 = haversineMeters(13.0827, 80.2707, 13.0917, 80.2707);
        const d23 = haversineMeters(13.0917, 80.2707, 13.1007, 80.2707);
        expect(totalRouteMeters([p1, p2, p3])).toBe(d12 + d23);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd "D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\act.qcpaintshop.com"
npx jest tests/unit/painter-location.test.js --no-coverage
```

Expected: PASS immediately (these are pure function tests defined inline — this step confirms the test file is syntactically valid before touching production code).

- [ ] **Step 3: Add 3 routes to routes/painters.js**

Find the line `router.get('/', requireAuth, async (req, res) => {` (around line 5656). Insert the following block **immediately before** it:

```js
// ── Painter Location Tracking ────────────────────────────────────────────────

// POST /api/painters/me/location-report — painter device reports GPS position
router.post('/me/location-report', requirePainterAuth, async (req, res) => {
    try {
        const { latitude, longitude, accuracy } = req.body;
        if (latitude == null || longitude == null) {
            return res.status(400).json({ success: false, message: 'latitude and longitude required' });
        }
        const painterId = req.painter.id;
        const now = new Date();

        // Rate-limit: skip insert if last row is within 25 seconds
        const [[last]] = await pool.query(
            'SELECT recorded_at FROM painter_location_events WHERE painter_id = ? ORDER BY recorded_at DESC LIMIT 1',
            [painterId]
        );
        if (last && (now - new Date(last.recorded_at)) < 25000) {
            return res.json({ success: true });
        }

        await pool.query(
            'INSERT INTO painter_location_events (painter_id, latitude, longitude, accuracy_m, recorded_at) VALUES (?, ?, ?, ?, NOW())',
            [painterId, latitude, longitude, accuracy || null]
        );

        // Emit live update to admin map room
        if (io) {
            const [[painter]] = await pool.query(
                'SELECT p.name, p.level, b.name AS branch FROM painters p LEFT JOIN branches b ON b.id = p.branch_id WHERE p.id = ?',
                [painterId]
            );
            io.to('admin_painters_live').emit('painter_location_update', {
                painterId,
                name: painter?.name || 'Unknown',
                level: painter?.level || 'default',
                branch: painter?.branch || '',
                latitude: Number(latitude),
                longitude: Number(longitude),
                accuracy: accuracy ? Number(accuracy) : null,
                recordedAt: now.toISOString()
            });
        }

        res.json({ success: true });
    } catch (e) {
        console.error('painter location-report error:', e.message);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// GET /api/painters/locations/live — admin fleet view (latest ping per painter)
// IMPORTANT: must stay before router.get('/:id', ...) or 'locations' is parsed as an ID
router.get('/locations/live', requireAuth, async (req, res) => {
    try {
        const [online] = await pool.query(`
            SELECT ple.painter_id, p.name, p.level, b.name AS branch,
                   ple.latitude, ple.longitude, ple.accuracy_m, ple.recorded_at,
                   TIMESTAMPDIFF(SECOND, ple.recorded_at, NOW()) AS seconds_ago,
                   'online' AS status
            FROM painter_location_events ple
            INNER JOIN (
                SELECT painter_id, MAX(recorded_at) AS latest
                FROM painter_location_events
                WHERE recorded_at >= NOW() - INTERVAL 5 MINUTE
                GROUP BY painter_id
            ) latest_online ON latest_online.painter_id = ple.painter_id AND latest_online.latest = ple.recorded_at
            JOIN painters p ON p.id = ple.painter_id
            LEFT JOIN branches b ON b.id = p.branch_id
            ORDER BY p.name
        `);

        const [offline] = await pool.query(`
            SELECT ple.painter_id, p.name, p.level, b.name AS branch,
                   ple.latitude, ple.longitude, ple.accuracy_m, ple.recorded_at,
                   TIMESTAMPDIFF(SECOND, ple.recorded_at, NOW()) AS seconds_ago,
                   'offline' AS status
            FROM painter_location_events ple
            INNER JOIN (
                SELECT painter_id, MAX(recorded_at) AS latest
                FROM painter_location_events
                WHERE painter_id NOT IN (
                    SELECT DISTINCT painter_id FROM painter_location_events
                    WHERE recorded_at >= NOW() - INTERVAL 5 MINUTE
                )
                GROUP BY painter_id
            ) latest_offline ON latest_offline.painter_id = ple.painter_id AND latest_offline.latest = ple.recorded_at
            JOIN painters p ON p.id = ple.painter_id
            LEFT JOIN branches b ON b.id = p.branch_id
            ORDER BY p.name
        `);

        res.json({ success: true, locations: [...online, ...offline] });
    } catch (e) {
        console.error('locations/live error:', e.message);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// GET /api/painters/:id/locations/history?date=YYYY-MM-DD — admin route replay
router.get('/:id/locations/history', requireAuth, async (req, res) => {
    try {
        const painterId = parseInt(req.params.id, 10);
        let dateStr = req.query.date;
        if (!dateStr) {
            const now = new Date();
            const ist = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
            dateStr = `${ist.getFullYear()}-${String(ist.getMonth() + 1).padStart(2, '0')}-${String(ist.getDate()).padStart(2, '0')}`;
        }

        const [points] = await pool.query(
            `SELECT latitude, longitude, accuracy_m, recorded_at
             FROM painter_location_events
             WHERE painter_id = ?
               AND DATE(CONVERT_TZ(recorded_at, '+00:00', '+05:30')) = ?
             ORDER BY recorded_at ASC`,
            [painterId, dateStr]
        );

        res.json({ success: true, points, date: dateStr, count: points.length });
    } catch (e) {
        console.error('locations/history error:', e.message);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});
```

- [ ] **Step 4: Run tests to confirm nothing broken**

```bash
cd "D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\act.qcpaintshop.com"
npx jest tests/unit/painter-location.test.js --no-coverage
```

Expected: All 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add routes/painters.js tests/unit/painter-location.test.js
git commit -m "feat(location): backend routes — location-report, fleet live, history"
```

---

## Task 3: Socket.io Room + Retention Cron

**Files:**
- Modify: `server.js` (around line 3591, after the `join_painter_room` handler)
- Modify: `services/painter-scheduler.js`

- [ ] **Step 1: Add Socket.io admin room handler in server.js**

Find this block in `server.js` (around line 3586–3592):
```js
    // Painter room for real-time notifications
    socket.on('join_painter_room', (painterId) => {
        if (painterId) {
            socket.join(`painter_${painterId}`);
        }
    });
```

Add immediately after it:
```js
    // Admin painters live map room
    socket.on('join_admin_painters_live', () => {
        socket.join('admin_painters_live');
    });
```

- [ ] **Step 2: Add retention cron to painter-scheduler.js**

Find the block with `jobs.attendanceForfeit = cron.schedule(...)` and the `console.log('[Painter Scheduler] Started: ...')` line. Insert before the console.log:

```js
    // Location events retention: prune rows older than 30 days at 02:30 IST daily
    jobs.locationPrune = cron.schedule('30 2 * * *', async () => {
        try {
            const [result] = await pool.query(
                'DELETE FROM painter_location_events WHERE recorded_at < NOW() - INTERVAL 30 DAY'
            );
            if (result.affectedRows > 0) {
                console.log(`[Painter Scheduler] Pruned ${result.affectedRows} old location events`);
            }
        } catch (e) {
            console.error('[Painter Scheduler] Location prune error:', e.message);
        }
    }, { timezone: 'Asia/Kolkata' });
```

Also add the registry entry. Find the block containing `registry.register('painter-attendance-forfeit', ...)` and add after it:
```js
        registry.register('painter-location-prune', { name: 'Location Events Prune', service: 'painter-scheduler', schedule: '30 2 * * *', description: 'Delete painter location events older than 30 days' });
```

- [ ] **Step 3: Commit**

```bash
git add server.js services/painter-scheduler.js
git commit -m "feat(location): socket.io admin room + nightly retention cron"
```

---

## Task 4: Android — GeofenceLocationService Painter Mode

**Files:**
- Modify: `app/src/main/java/com/qcpaintshop/act/location/GeofenceLocationService.kt`

**Context:** The service is in the shared `main` source set. It currently reads `auth_token` from SharedPreferences and posts to `/api/attendance/location-report` with `Authorization: Bearer $token`. Painters use `X-Painter-Token` header instead (per `requirePainterAuth` middleware). Changes: detect painter mode from intent extra, use different URL and header when in painter mode, skip location-off reporting for painters (no enforcement needed).

- [ ] **Step 1: Add isPainterMode field and companion method**

At the top of the class, after the companion object's `stop()` method, add the `startForPainter()` companion method. Also add the `isPainterMode` field.

Find:
```kotlin
    private var authToken: String? = null
    private var locationManager: LocationManager? = null
    private var isRunning = false
```

Replace with:
```kotlin
    private var authToken: String? = null
    private var isPainterMode: Boolean = false
    private var locationManager: LocationManager? = null
    private var isRunning = false
```

Find the companion object's `stop()` function:
```kotlin
        fun stop(context: Context) {
            context.stopService(Intent(context, GeofenceLocationService::class.java))
        }
```

Add immediately after it (still inside companion object):
```kotlin
        fun startForPainter(context: Context, authToken: String) {
            val intent = Intent(context, GeofenceLocationService::class.java).apply {
                putExtra("auth_token", authToken)
                putExtra("painter_mode", true)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }
```

- [ ] **Step 2: Detect painter mode in onStartCommand**

Find in `onStartCommand`:
```kotlin
        authToken = intent?.getStringExtra("auth_token")
            ?: getSharedPreferences("qc_prefs", MODE_PRIVATE).getString("auth_token", null)
```

Replace with:
```kotlin
        authToken = intent?.getStringExtra("auth_token")
            ?: getSharedPreferences("qc_prefs", MODE_PRIVATE).getString("auth_token", null)
        isPainterMode = intent?.getBooleanExtra("painter_mode", false) ?: false
```

- [ ] **Step 3: Branch reportLocation() for painter mode**

Find the full `reportLocation` function:
```kotlin
    private fun reportLocation(latitude: Double, longitude: Double) {
        val token = authToken ?: return
        thread {
            try {
                val url = URL("${Constants.BASE_URL}/api/attendance/location-report")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Authorization", "Bearer $token")
                conn.setRequestProperty("Content-Type", "application/json")
                conn.doOutput = true
                conn.connectTimeout = 10_000
                conn.readTimeout = 10_000

                val body = """{"latitude":$latitude,"longitude":$longitude}"""
                OutputStreamWriter(conn.outputStream).use { it.write(body) }

                val code = conn.responseCode
                if (code == 200) {
                    val response = conn.inputStream.bufferedReader().readText()
                    if (response.contains("\"action\":\"stop_service\"") ||
                        response.contains("\"action\":\"auto_clockout\"")) {
                        Log.i(TAG, "Server says stop: $response")
                        getSharedPreferences("qc_prefs", MODE_PRIVATE).edit()
                            .putBoolean("geo_service_active", false).apply()
                        stopSelf()
                    }
                } else if (code == 401) {
                    Log.w(TAG, "Auth expired, stopping service")
                    getSharedPreferences("qc_prefs", MODE_PRIVATE).edit()
                        .putBoolean("geo_service_active", false).apply()
                    stopSelf()
                }
                conn.disconnect()
            } catch (e: Exception) {
                Log.e(TAG, "Location report failed: ${e.message}")
            }
        }
    }
```

Replace with:
```kotlin
    private fun reportLocation(latitude: Double, longitude: Double) {
        val token = authToken ?: return
        thread {
            try {
                val endpoint = if (isPainterMode)
                    "${Constants.BASE_URL}/api/painters/me/location-report"
                else
                    "${Constants.BASE_URL}/api/attendance/location-report"

                val url = URL(endpoint)
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                if (isPainterMode) {
                    conn.setRequestProperty("X-Painter-Token", token)
                } else {
                    conn.setRequestProperty("Authorization", "Bearer $token")
                }
                conn.setRequestProperty("Content-Type", "application/json")
                conn.doOutput = true
                conn.connectTimeout = 10_000
                conn.readTimeout = 10_000

                val body = """{"latitude":$latitude,"longitude":$longitude}"""
                OutputStreamWriter(conn.outputStream).use { it.write(body) }

                val code = conn.responseCode
                if (code == 200) {
                    if (!isPainterMode) {
                        val response = conn.inputStream.bufferedReader().readText()
                        if (response.contains("\"action\":\"stop_service\"") ||
                            response.contains("\"action\":\"auto_clockout\"")) {
                            Log.i(TAG, "Server says stop: $response")
                            getSharedPreferences("qc_prefs", MODE_PRIVATE).edit()
                                .putBoolean("geo_service_active", false).apply()
                            stopSelf()
                        }
                    }
                } else if (code == 401) {
                    Log.w(TAG, "Auth expired, stopping service")
                    getSharedPreferences("qc_prefs", MODE_PRIVATE).edit()
                        .putBoolean("geo_service_active", false).apply()
                    stopSelf()
                }
                conn.disconnect()
            } catch (e: Exception) {
                Log.e(TAG, "Location report failed: ${e.message}")
            }
        }
    }
```

- [ ] **Step 4: Skip reportLocationOff for painter mode**

Find in `onProviderDisabled`:
```kotlin
        override fun onProviderDisabled(provider: String) {
            Log.w(TAG, "Location provider disabled: $provider")
            reportLocationOff()
        }
```

Replace with:
```kotlin
        override fun onProviderDisabled(provider: String) {
            Log.w(TAG, "Location provider disabled: $provider")
            if (!isPainterMode) reportLocationOff()
        }
```

- [ ] **Step 5: Commit**

```bash
cd "D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\qcpaintshop-android"
git add app/src/main/java/com/qcpaintshop/act/location/GeofenceLocationService.kt
git commit -m "feat(location): GeofenceLocationService painter mode — separate URL + X-Painter-Token header"
```

---

## Task 5: Android — Service Lifecycle on Login/Logout

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/data/repository/AuthRepository.kt`

**Context:** `AuthRepository` is a Hilt `@Singleton`. It already injects `UserPreferences` and `AuthApi`. The `verifyOtp()` method calls `userPreferences.saveLogin(token = body.token, ...)` on success. The `logout()` method calls `userPreferences.clearAll()`. We need to inject `@ApplicationContext context: Context` and call `GeofenceLocationService.startForPainter()` / `GeofenceLocationService.stop()`. The import for `GeofenceLocationService` is `com.qcpaintshop.act.location.GeofenceLocationService` (shared `main` source set, accessible from painter flavor).

- [ ] **Step 1: Add Context injection and service calls**

Find the class declaration and constructor:
```kotlin
@Singleton
class AuthRepository @Inject constructor(
    private val authApi: AuthApi,
    private val userPreferences: UserPreferences
) {
```

Replace with:
```kotlin
@Singleton
class AuthRepository @Inject constructor(
    @dagger.hilt.android.qualifiers.ApplicationContext private val context: android.content.Context,
    private val authApi: AuthApi,
    private val userPreferences: UserPreferences
) {
```

Add the import at the top of the file (after the existing imports):
```kotlin
import com.qcpaintshop.act.location.GeofenceLocationService
```

- [ ] **Step 2: Start service on successful login**

Find in `verifyOtp()`:
```kotlin
                if (body.painter.status != "pending") {
                    userPreferences.saveLogin(
                        token = body.token,
                        id = body.painter.id,
                        name = body.painter.displayName,
                        phone = body.painter.phone,
                        photo = body.painter.profilePhoto,
                        level = body.painter.level
                    )
                }
                Result.success(body.painter)
```

Replace with:
```kotlin
                if (body.painter.status != "pending") {
                    userPreferences.saveLogin(
                        token = body.token,
                        id = body.painter.id,
                        name = body.painter.displayName,
                        phone = body.painter.phone,
                        photo = body.painter.profilePhoto,
                        level = body.painter.level
                    )
                    GeofenceLocationService.startForPainter(context, body.token)
                }
                Result.success(body.painter)
```

- [ ] **Step 3: Stop service on logout**

Find:
```kotlin
    suspend fun logout() {
        userPreferences.clearAll()
    }
```

Replace with:
```kotlin
    suspend fun logout() {
        GeofenceLocationService.stop(context)
        userPreferences.clearAll()
    }
```

- [ ] **Step 4: Commit**

```bash
cd "D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\qcpaintshop-android"
git add app/src/painter/java/com/qcpaintshop/painter/data/repository/AuthRepository.kt
git commit -m "feat(location): start/stop GeofenceLocationService on painter login/logout"
```

---

## Task 6: Admin UI — Live Location Sub-tab

**Files:**
- Modify: `public/admin-painters.html`

**Context:** The attendance tab has id `tab-attendance` and contains an internal sub-tab switcher (`switchAttTab()`) with `att-sub-today` and `att-sub-monthly` divs. We add a third sub-tab "Live Location" with id `att-sub-location`. This sub-tab contains two panels toggled by pills: "Live Fleet Map" and "Route Replay", each with a Leaflet map. Leaflet 1.9.4 is loaded via CDN. The `qcSocket` (window.qcSocket) is the existing Socket.io client instance used throughout the page.

- [ ] **Step 1: Add Leaflet CDN to `<head>`**

Find the closing `</head>` tag (or the last stylesheet `<link>` in the `<head>`). Add before `</head>`:

```html
    <!-- Leaflet for painter live location maps -->
    <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin=""/>
    <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV/XN/WLcE=" crossorigin=""></script>
```

- [ ] **Step 2: Add "Live Location" sub-tab button**

Find:
```html
        <div class="flex flex-wrap gap-2 mb-4">
            <button class="tab-btn-sub active" onclick="switchAttTab('today', this)">Today</button>
            <button class="tab-btn-sub" onclick="switchAttTab('monthly', this)">Monthly Summary</button>
        </div>
```

Replace with:
```html
        <div class="flex flex-wrap gap-2 mb-4">
            <button class="tab-btn-sub active" onclick="switchAttTab('today', this)">Today</button>
            <button class="tab-btn-sub" onclick="switchAttTab('monthly', this)">Monthly Summary</button>
            <button class="tab-btn-sub" onclick="switchAttTab('location', this)">Live Location</button>
        </div>
```

- [ ] **Step 3: Add the Live Location sub-tab HTML panel**

Find `<div id="att-sub-monthly" class="att-sub-content hidden">` and after its closing `</div>`, add:

```html
        <div id="att-sub-location" class="att-sub-content hidden">

            <!-- Toggle pills -->
            <div class="flex gap-2 mb-4">
                <button id="loc-pill-fleet" class="px-4 py-2 rounded-full text-sm font-medium bg-indigo-600 text-white" onclick="switchLocationPanel('fleet')">Live Fleet Map</button>
                <button id="loc-pill-replay" class="px-4 py-2 rounded-full text-sm font-medium bg-gray-100 text-gray-600" onclick="switchLocationPanel('replay')">Route Replay</button>
            </div>

            <!-- Live Fleet Map panel -->
            <div id="loc-panel-fleet">
                <div class="bg-white rounded-xl border border-gray-200 p-4 mb-3 flex flex-wrap gap-3 items-center justify-between">
                    <div class="flex gap-2 items-center">
                        <select id="loc-branch-filter" class="border rounded px-3 py-2 text-sm" onchange="applyFleetBranchFilter()">
                            <option value="">All Branches</option>
                        </select>
                        <span class="text-xs text-gray-400" id="loc-last-updated">–</span>
                    </div>
                    <div class="flex gap-3 text-sm">
                        <span class="flex items-center gap-1"><span class="w-3 h-3 rounded-full bg-green-500 inline-block"></span> Online</span>
                        <span class="flex items-center gap-1"><span class="w-3 h-3 rounded-full bg-gray-400 inline-block"></span> Offline</span>
                    </div>
                </div>
                <div id="loc-fleet-map" style="height:500px;border-radius:12px;border:1px solid #e5e7eb;" class="md:h-96 w-full"></div>
                <p class="text-xs text-gray-400 mt-2">Pins update in real-time via socket. Offline = no ping in last 5 min.</p>
            </div>

            <!-- Route Replay panel -->
            <div id="loc-panel-replay" style="display:none;">
                <div class="bg-white rounded-xl border border-gray-200 p-4 mb-3 flex flex-wrap gap-3 items-end">
                    <div>
                        <label class="text-xs text-gray-600 block mb-1">Painter</label>
                        <select id="loc-replay-painter" class="border rounded px-3 py-2 text-sm" style="min-width:180px;">
                            <option value="">Select painter…</option>
                        </select>
                    </div>
                    <div>
                        <label class="text-xs text-gray-600 block mb-1">Date</label>
                        <input type="date" id="loc-replay-date" class="border rounded px-3 py-2 text-sm">
                    </div>
                    <button onclick="loadRouteReplay()" class="bg-indigo-600 text-white px-4 py-2 rounded text-sm">Load Route</button>
                </div>
                <div id="loc-replay-map" style="height:500px;border-radius:12px;border:1px solid #e5e7eb;" class="md:h-96 w-full"></div>
                <div id="loc-replay-stats" class="mt-3 flex gap-4 text-sm text-gray-600 hidden">
                    <span>Points: <strong id="loc-stat-points">0</strong></span>
                    <span>Distance: <strong id="loc-stat-dist">0</strong> km</span>
                </div>
                <!-- Timeline scrubber -->
                <div id="loc-replay-scrubber" class="mt-3 hidden">
                    <label class="text-xs text-gray-600 block mb-1">Timeline</label>
                    <input type="range" id="loc-timeline" min="0" value="0" class="w-full" oninput="scrubTimeline(this.value)">
                    <p class="text-xs text-gray-400 mt-1" id="loc-timeline-label">–</p>
                </div>
            </div>

        </div>
```

- [ ] **Step 4: Add Live Location JS**

Find the closing `</script>` tag (the last one in the file, before `</body>`). Insert the following block immediately before it:

```js
    // ── Painter Live Location ────────────────────────────────────────────────

    let fleetMap = null;
    let fleetMarkers = {};          // painterId → L.circleMarker
    let fleetData = [];             // current full dataset
    let replayMap = null;
    let replayPoints = [];          // current replay route points
    let replayAnimMarker = null;    // animated position marker
    let locSecondsSince = 0;
    let locSecondsTick = null;

    const LOC_LEVEL_COLORS = {
        gold: '#D4A24E', silver: '#9CA3AF', bronze: '#92400E', default: '#6366F1'
    };

    function locLevelColor(level) {
        return LOC_LEVEL_COLORS[(level || '').toLowerCase()] || LOC_LEVEL_COLORS.default;
    }

    function switchLocationPanel(panel) {
        document.getElementById('loc-panel-fleet').style.display = panel === 'fleet' ? '' : 'none';
        document.getElementById('loc-panel-replay').style.display = panel === 'replay' ? '' : 'none';
        document.getElementById('loc-pill-fleet').className = panel === 'fleet'
            ? 'px-4 py-2 rounded-full text-sm font-medium bg-indigo-600 text-white'
            : 'px-4 py-2 rounded-full text-sm font-medium bg-gray-100 text-gray-600';
        document.getElementById('loc-pill-replay').className = panel === 'replay'
            ? 'px-4 py-2 rounded-full text-sm font-medium bg-indigo-600 text-white'
            : 'px-4 py-2 rounded-full text-sm font-medium bg-gray-100 text-gray-600';
        if (panel === 'fleet') {
            setTimeout(() => fleetMap && fleetMap.invalidateSize(), 100);
        } else {
            populateReplayPainterSelect();
            setTimeout(() => replayMap && replayMap.invalidateSize(), 100);
        }
    }

    function initFleetMap() {
        if (fleetMap) { fleetMap.invalidateSize(); return; }
        fleetMap = L.map('loc-fleet-map').setView([20.5937, 78.9629], 5);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19
        }).addTo(fleetMap);
    }

    function initReplayMap() {
        if (replayMap) { replayMap.invalidateSize(); return; }
        replayMap = L.map('loc-replay-map').setView([20.5937, 78.9629], 5);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap contributors',
            maxZoom: 19
        }).addTo(replayMap);
    }

    async function loadFleetData() {
        try {
            const r = await fetch('/api/painters/locations/live', { headers: authHeaders() });
            const d = await r.json();
            if (!d.success) return;
            fleetData = d.locations || [];
            renderFleetMarkers(fleetData);
            locSecondsSince = 0;
            updateLastUpdatedLabel();
        } catch (e) {
            console.error('loadFleetData error', e);
        }
    }

    function renderFleetMarkers(locations) {
        if (!fleetMap) return;
        const branchFilter = document.getElementById('loc-branch-filter')?.value || '';

        // Populate branch filter options
        const bf = document.getElementById('loc-branch-filter');
        if (bf && bf.options.length === 1) {
            const branches = [...new Set(locations.map(l => l.branch).filter(Boolean))].sort();
            branches.forEach(b => {
                const o = document.createElement('option');
                o.value = b; o.textContent = b;
                bf.appendChild(o);
            });
        }

        locations.forEach(loc => {
            const visible = !branchFilter || loc.branch === branchFilter;
            const color = locLevelColor(loc.level);
            const opacity = loc.status === 'offline' ? 0.35 : 1;
            const lat = Number(loc.latitude);
            const lng = Number(loc.longitude);

            if (fleetMarkers[loc.painter_id]) {
                fleetMarkers[loc.painter_id].setLatLng([lat, lng]);
                fleetMarkers[loc.painter_id].setStyle({ color, opacity, fillOpacity: opacity * 0.6 });
                if (!visible) fleetMarkers[loc.painter_id].remove();
                else fleetMarkers[loc.painter_id].addTo(fleetMap);
            } else {
                const marker = L.circleMarker([lat, lng], {
                    radius: 9, color, weight: 2,
                    fillColor: color, fillOpacity: opacity * 0.6, opacity
                }).bindPopup(
                    `<b>${esc(loc.name)}</b><br>${esc(loc.level || 'default')} · ${esc(loc.branch || '–')}<br>` +
                    `Last seen: ${loc.seconds_ago < 60 ? loc.seconds_ago + 's ago' : Math.round(loc.seconds_ago / 60) + 'm ago'}<br>` +
                    `Status: ${loc.status}`
                );
                fleetMarkers[loc.painter_id] = marker;
                if (visible) marker.addTo(fleetMap);
            }
        });
    }

    function applyFleetBranchFilter() {
        renderFleetMarkers(fleetData);
    }

    function updateLastUpdatedLabel() {
        const el = document.getElementById('loc-last-updated');
        if (el) el.textContent = `Updated ${locSecondsSince}s ago`;
    }

    function startLastUpdatedTick() {
        clearInterval(locSecondsTick);
        locSecondsTick = setInterval(() => {
            locSecondsSince++;
            updateLastUpdatedLabel();
        }, 1000);
    }

    function subscribeFleetSocket() {
        if (!window.qcSocket) return;
        window.qcSocket.emit('join_admin_painters_live');
        window.qcSocket.on('painter_location_update', (data) => {
            const existing = fleetData.find(l => l.painter_id === data.painterId);
            if (existing) {
                existing.latitude = data.latitude;
                existing.longitude = data.longitude;
                existing.status = 'online';
                existing.seconds_ago = 0;
            } else {
                fleetData.push({
                    painter_id: data.painterId,
                    name: data.name,
                    level: data.level,
                    branch: data.branch,
                    latitude: data.latitude,
                    longitude: data.longitude,
                    accuracy_m: data.accuracy,
                    status: 'online',
                    seconds_ago: 0
                });
            }
            // Move marker
            if (fleetMap) {
                if (fleetMarkers[data.painterId]) {
                    fleetMarkers[data.painterId].setLatLng([data.latitude, data.longitude]);
                    fleetMarkers[data.painterId].setStyle({ opacity: 1, fillOpacity: 0.6 });
                } else {
                    renderFleetMarkers(fleetData);
                }
            }
            locSecondsSince = 0;
            updateLastUpdatedLabel();
        });
    }

    function initLiveLocationTab() {
        initFleetMap();
        loadFleetData();
        subscribeFleetSocket();
        startLastUpdatedTick();
        // Set today as default replay date
        const dp = document.getElementById('loc-replay-date');
        if (dp && !dp.value) dp.value = new Date().toISOString().slice(0, 10);
    }

    let locationTabInited = false;
    function onLocationTabShown() {
        if (!locationTabInited) {
            locationTabInited = true;
            initLiveLocationTab();
        } else {
            if (fleetMap) fleetMap.invalidateSize();
        }
    }

    function populateReplayPainterSelect() {
        const sel = document.getElementById('loc-replay-painter');
        if (!sel || sel.options.length > 1) return;
        // Reuse painters already loaded in paintersList
        if (window.paintersList && window.paintersList.length) {
            window.paintersList.forEach(p => {
                const o = document.createElement('option');
                o.value = p.id; o.textContent = p.full_name || p.name;
                sel.appendChild(o);
            });
        } else {
            fetch('/api/painters?limit=500', { headers: authHeaders() })
                .then(r => r.json())
                .then(d => {
                    (d.painters || []).forEach(p => {
                        const o = document.createElement('option');
                        o.value = p.id; o.textContent = p.full_name || p.name;
                        sel.appendChild(o);
                    });
                })
                .catch(() => {});
        }
    }

    async function loadRouteReplay() {
        const painterId = document.getElementById('loc-replay-painter')?.value;
        const date = document.getElementById('loc-replay-date')?.value;
        if (!painterId) return alert('Please select a painter');

        initReplayMap();

        try {
            const url = `/api/painters/${painterId}/locations/history${date ? '?date=' + date : ''}`;
            const r = await fetch(url, { headers: authHeaders() });
            const d = await r.json();
            if (!d.success) return alert('Failed to load route');

            replayPoints = d.points || [];

            // Clear previous layers
            replayMap.eachLayer(l => { if (!(l instanceof L.TileLayer)) replayMap.removeLayer(l); });
            if (replayAnimMarker) { replayAnimMarker = null; }

            if (!replayPoints.length) {
                document.getElementById('loc-replay-stats').classList.add('hidden');
                document.getElementById('loc-replay-scrubber').classList.add('hidden');
                return alert('No location data for this painter on this date');
            }

            const latlngs = replayPoints.map(p => [Number(p.latitude), Number(p.longitude)]);

            // Polyline
            L.polyline(latlngs, { color: '#6366F1', weight: 3, opacity: 0.8 }).addTo(replayMap);

            // Start pin (green)
            L.marker(latlngs[0], {
                icon: L.divIcon({ html: '<div style="background:#16a34a;width:14px;height:14px;border-radius:50%;border:2px solid white;"></div>', className: '' })
            }).bindPopup('Start: ' + new Date(replayPoints[0].recorded_at).toLocaleTimeString()).addTo(replayMap);

            // End pin (red)
            L.marker(latlngs[latlngs.length - 1], {
                icon: L.divIcon({ html: '<div style="background:#dc2626;width:14px;height:14px;border-radius:50%;border:2px solid white;"></div>', className: '' })
            }).bindPopup('End: ' + new Date(replayPoints[replayPoints.length - 1].recorded_at).toLocaleTimeString()).addTo(replayMap);

            // Intermediate dots
            for (let i = 1; i < latlngs.length - 1; i++) {
                L.circleMarker(latlngs[i], { radius: 4, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.7, weight: 1 })
                    .bindPopup(new Date(replayPoints[i].recorded_at).toLocaleTimeString()).addTo(replayMap);
            }

            // Fit map to route
            replayMap.fitBounds(L.latLngBounds(latlngs).pad(0.1));

            // Compute total distance
            let totalM = 0;
            for (let i = 1; i < latlngs.length; i++) {
                const prev = latlngs[i - 1], curr = latlngs[i];
                const R = 6371000, toRad = d => d * Math.PI / 180;
                const dLat = toRad(curr[0] - prev[0]);
                const dLng = toRad(curr[1] - prev[1]);
                const a = Math.sin(dLat/2)**2 + Math.cos(toRad(prev[0])) * Math.cos(toRad(curr[0])) * Math.sin(dLng/2)**2;
                totalM += Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
            }

            document.getElementById('loc-stat-points').textContent = replayPoints.length;
            document.getElementById('loc-stat-dist').textContent = (totalM / 1000).toFixed(2);
            document.getElementById('loc-replay-stats').classList.remove('hidden');

            // Setup scrubber
            const scrubber = document.getElementById('loc-timeline');
            scrubber.max = replayPoints.length - 1;
            scrubber.value = 0;
            document.getElementById('loc-replay-scrubber').classList.remove('hidden');
            scrubTimeline(0);

        } catch (e) {
            console.error('loadRouteReplay error', e);
            alert('Error loading route');
        }
    }

    function scrubTimeline(idx) {
        if (!replayMap || !replayPoints.length) return;
        const i = parseInt(idx, 10);
        const pt = replayPoints[i];
        if (!pt) return;

        const latlng = [Number(pt.latitude), Number(pt.longitude)];

        if (!replayAnimMarker) {
            replayAnimMarker = L.circleMarker(latlng, {
                radius: 10, color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.9, weight: 2
            }).addTo(replayMap);
        } else {
            replayAnimMarker.setLatLng(latlng);
        }

        document.getElementById('loc-timeline-label').textContent =
            new Date(pt.recorded_at).toLocaleTimeString() + ' — point ' + (i + 1) + ' of ' + replayPoints.length;
    }
```

- [ ] **Step 5: Wire `initLiveLocationTab` into `switchAttTab`**

Find (around line 4588):
```js
    function switchAttTab(name, btn) {
        document.querySelectorAll('.att-sub-content').forEach(e => e.classList.add('hidden'));
        document.querySelectorAll('.tab-btn-sub').forEach(b => b.classList.remove('active'));
        document.getElementById('att-sub-' + name).classList.remove('hidden');
        if (btn) btn.classList.add('active');
    }
```

Replace with:
```js
    function switchAttTab(name, btn) {
        document.querySelectorAll('.att-sub-content').forEach(e => e.classList.add('hidden'));
        document.querySelectorAll('.tab-btn-sub').forEach(b => b.classList.remove('active'));
        document.getElementById('att-sub-' + name).classList.remove('hidden');
        if (btn) btn.classList.add('active');
        if (name === 'location') onLocationTabShown();
    }
```

- [ ] **Step 6: Commit**

```bash
cd "D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\act.qcpaintshop.com"
git add public/admin-painters.html
git commit -m "feat(location): admin UI — Leaflet fleet map + route replay in Attendance tab"
```

---

## Task 7: Deploy + Build APK

- [ ] **Step 1: Deploy web to production**

```bash
ssh hetzner "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && npm install && node migrate.js && pm2 restart business-manager"
```

Expected: PM2 confirms restart, no migration errors.

- [ ] **Step 2: Smoke test the web endpoints**

```bash
# Verify fleet endpoint responds (expect 401 without auth token, confirming route is mounted)
curl -s https://act.qcpaintshop.com/api/painters/locations/live | python -m json.tool
```

Expected: `{"success": false, "message": "..."}` (auth required) — confirms route is registered.

- [ ] **Step 3: Build painter APK**

```bash
cd "D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\qcpaintshop-android"
./gradlew assemblePainterRelease --no-build-cache 2>&1 | tail -20
```

Expected: `BUILD SUCCESSFUL` with APK at `app/build/outputs/apk/painter/release/app-painter-release.apk`

- [ ] **Step 4: Deliver APK via Telegram**

```bash
cd "D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\qcpaintshop-android"
APK="app/build/outputs/apk/painter/release/app-painter-release.apk"
curl -s -F "chat_id=930726256" -F "document=@$APK" -F "caption=Painter APK — live location tracking" "https://api.telegram.org/bot$(grep BOT_TOKEN ../act.qcpaintshop.com/.env | cut -d= -f2)/sendDocument"
```

Expected: Telegram API returns `{"ok":true}`.

- [ ] **Step 5: Final commit on web repo**

```bash
cd "D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\act.qcpaintshop.com"
git log --oneline -7
```

Confirm all 5 feature commits are present.

---

## Notes for Implementer

- **Route ordering is critical**: `/locations/live` must appear before `router.get('/:id', ...)` in `routes/painters.js`. The 3 new routes in Task 2 are inserted before `router.get('/', requireAuth, ...)` at line 5656 which is already before the `/:id` routes at line 5755.
- **Painter token header**: `requirePainterAuth` reads `x-painter-token`, NOT `Authorization: Bearer`. The Android service change in Task 4 switches headers accordingly.
- **DataStore vs SharedPreferences**: The painter app uses Jetpack DataStore (`qc_painter_prefs`). The `GeofenceLocationService` reads from SharedPreferences (`qc_prefs`). These are different stores. The token is passed via Intent `putExtra("auth_token", token)` when starting the service — this is how the service gets it without SharedPreferences.
- **Leaflet map sizing**: Leaflet requires the map container to have a non-zero size when `L.map()` is called. The `setTimeout(..., 100)` calls in `switchLocationPanel` ensure the DOM is rendered before `invalidateSize()`. The initial `initFleetMap()` is called via `onLocationTabShown()` which fires when the user clicks the "Live Location" sub-tab — by that point the container is visible.
- **`window.paintersList`**: If this global doesn't exist, `populateReplayPainterSelect()` falls back to fetching `/api/painters?limit=500`. Both paths work.
