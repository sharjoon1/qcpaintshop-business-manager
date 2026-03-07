# Geofence Background Location Service — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Native Android background location monitoring that detects geofence exits, location-off cheating, sends immediate FCM alerts to staff+admin, and auto-clocks-out after 5 minutes — all independent of WebView.

**Architecture:** Kotlin ForegroundService with LocationManager GPS updates every 30s. Service started by WebView JS bridge after clock-in, stopped on clock-out. Location reports sent to new server endpoint which checks geofence + triggers FCM. Server-side cron as safety net for stale location reports. A dedicated high-priority "Geofence Alert" notification channel with alarm sound.

**Tech Stack:** Kotlin ForegroundService, Android LocationManager, Express.js endpoint, FCM high-priority push, node-cron server-side enforcement

---

## Overview of Components

1. **Android: `GeofenceLocationService.kt`** — ForegroundService that sends GPS to server every 30s
2. **Android: `LocationOffDetector.kt`** — BroadcastReceiver for `PROVIDERS_CHANGED` to detect GPS off
3. **Android: Manifest + permissions** — `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE_LOCATION`
4. **Android: `MainActivity.kt`** — JS bridge methods to start/stop service, permission flow
5. **Android: Geofence alert notification channel** — `IMPORTANCE_MAX` with alarm sound
6. **Server: `POST /api/attendance/location-report`** — Receives GPS, checks geofence, triggers alerts
7. **Server: `POST /api/attendance/location-off`** — Receives location-disabled signal, starts 2-min timer
8. **Server: Cron job** — Every 60s checks for stale `last_geo_check_at` (>2 min) and auto-clocks-out
9. **Web: `dashboard.html`** — JS bridge calls to start/stop native service on clock-in/out

---

### Task 1: Server — New location-report endpoint

**Files:**
- Modify: `routes/attendance.js` (add after line ~2371, before geofence-violation endpoint)

**Step 1: Add `POST /api/attendance/location-report` endpoint**

This endpoint receives GPS from the native Android service every 30s. It checks geofence, updates tracking columns, and sends FCM alerts when staff exits geofence.

```javascript
/**
 * POST /api/attendance/location-report
 * Native Android background service reports location every 30s
 * Checks geofence, sends alerts, triggers auto-clockout after 5 min
 */
router.post('/location-report', requireAuth, async (req, res) => {
    try {
        const { latitude, longitude } = req.body;
        const userId = req.user.id;

        if (!latitude || !longitude) {
            return res.status(400).json({ success: false, message: 'Location required' });
        }

        const today = getTodayIST();

        // Get active attendance record
        const [records] = await pool.query(
            `SELECT a.id, a.branch_id, a.geo_warning_started_at, a.clock_in_time,
                    a.break_start_time, a.break_end_time, a.break_duration_minutes,
                    b.latitude AS branch_lat, b.longitude AS branch_lng, b.geo_fence_radius
             FROM staff_attendance a
             JOIN branches b ON a.branch_id = b.id
             WHERE a.user_id = ? AND a.date = ? AND a.clock_out_time IS NULL
             ORDER BY a.id DESC LIMIT 1`,
            [userId, today]
        );

        if (records.length === 0) {
            return res.json({ success: true, action: 'stop_service', message: 'No active attendance' });
        }

        const record = records[0];
        const radius = record.geo_fence_radius || 200;
        const distance = Math.round(calculateDistance(
            parseFloat(latitude), parseFloat(longitude),
            parseFloat(record.branch_lat), parseFloat(record.branch_lng)
        ));

        // Check if on break/outside/prayer — skip enforcement
        if (record.break_start_time && !record.break_end_time) {
            await pool.query(
                `UPDATE staff_attendance SET last_geo_check_at = NOW(), last_geo_distance = ?, geo_warning_started_at = NULL WHERE id = ?`,
                [distance, record.id]
            );
            return res.json({ success: true, action: 'none', status: 'on_break', distance });
        }
        const [activeOW] = await pool.query("SELECT id FROM outside_work_periods WHERE user_id = ? AND status = 'active' LIMIT 1", [userId]);
        if (activeOW.length > 0) {
            await pool.query(
                `UPDATE staff_attendance SET last_geo_check_at = NOW(), last_geo_distance = ?, geo_warning_started_at = NULL WHERE id = ?`,
                [distance, record.id]
            );
            return res.json({ success: true, action: 'none', status: 'outside_work', distance });
        }
        const [activePrayer] = await pool.query("SELECT id FROM prayer_periods WHERE user_id = ? AND status = 'active' LIMIT 1", [userId]);
        if (activePrayer.length > 0) {
            await pool.query(
                `UPDATE staff_attendance SET last_geo_check_at = NOW(), last_geo_distance = ?, geo_warning_started_at = NULL WHERE id = ?`,
                [distance, record.id]
            );
            return res.json({ success: true, action: 'none', status: 'prayer', distance });
        }

        const allowed = distance <= radius;

        if (allowed) {
            // Inside fence — clear warning
            await pool.query(
                `UPDATE staff_attendance SET last_geo_check_at = NOW(), last_geo_distance = ?, geo_warning_started_at = NULL WHERE id = ?`,
                [distance, record.id]
            );
            return res.json({ success: true, action: 'none', status: 'inside', distance, radius });
        }

        // Outside fence
        const now = new Date();

        if (distance >= 300) {
            // 300m+ — serious violation
            if (!record.geo_warning_started_at) {
                // First detection — start grace period, send immediate alert
                await pool.query(
                    `UPDATE staff_attendance SET geo_warning_started_at = ?, last_geo_check_at = ?, last_geo_distance = ? WHERE id = ?`,
                    [now, now, distance, record.id]
                );

                // Send immediate FCM to staff
                const [userInfo] = await pool.query('SELECT full_name FROM users WHERE id = ?', [userId]);
                const staffName = userInfo[0]?.full_name || 'Staff';
                try {
                    await notificationService.send(userId, {
                        type: 'geofence_exit_warning',
                        title: 'Geofence Warning!',
                        body: `You are ${distance}m from branch. Return within 5 minutes or you will be auto-clocked-out!`,
                        data: { type: 'geofence_exit_warning', distance: String(distance), priority: 'high' }
                    });
                } catch(e) {}

                // Send immediate FCM to all admins
                try {
                    const [admins] = await pool.query("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
                    for (const admin of admins) {
                        await notificationService.send(admin.id, {
                            type: 'geofence_exit_admin',
                            title: 'Staff Left Branch Area!',
                            body: `${staffName} is ${distance}m from branch. Auto clock-out in 5 min if not returned.`,
                            data: { type: 'geofence_exit_admin', user_id: String(userId), distance: String(distance), priority: 'high' }
                        }).catch(() => {});
                    }
                } catch(e) {}

                // Log violation
                try {
                    await pool.query(
                        `INSERT INTO geofence_violations (user_id, branch_id, latitude, longitude, distance, radius, violation_type) VALUES (?,?,?,?,?,?,?)`,
                        [userId, record.branch_id, latitude, longitude, distance, radius, 'left_area']
                    );
                } catch(e) {}

                return res.json({ success: true, action: 'warn', status: 'outside_grace', distance, radius, grace_remaining: 300 });
            } else {
                // Grace period ongoing — check if expired
                const warningStart = new Date(record.geo_warning_started_at).getTime();
                const elapsed = now.getTime() - warningStart;
                const graceMs = 5 * 60 * 1000;

                await pool.query(
                    `UPDATE staff_attendance SET last_geo_check_at = ?, last_geo_distance = ? WHERE id = ?`,
                    [now, distance, record.id]
                );

                if (elapsed >= graceMs) {
                    // Grace expired — auto clock out (reuse geo-auto-clockout logic inline)
                    const breakMinutes = record.break_duration_minutes || 0;
                    const workingMinutes = Math.round(((now - new Date(record.clock_in_time)) / 1000 / 60) - breakMinutes);
                    const geoNote = `\n[Auto clock-out: ${distance}m from branch at ${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}]`;

                    await pool.query(
                        `UPDATE staff_attendance
                         SET clock_out_time = ?, total_working_minutes = ?,
                             clock_out_lat = ?, clock_out_lng = ?, clock_out_distance = ?,
                             auto_clockout_type = 'geo', auto_clockout_distance = ?,
                             geo_warning_started_at = NULL,
                             notes = CONCAT(COALESCE(notes, ''), ?)
                         WHERE id = ?`,
                        [now, workingMinutes, latitude, longitude, distance, distance, geoNote, record.id]
                    );

                    // Notify staff
                    const [userInfo2] = await pool.query('SELECT full_name FROM users WHERE id = ?', [userId]);
                    const staffName2 = userInfo2[0]?.full_name || 'Staff';
                    try {
                        await notificationService.send(userId, {
                            type: 'geo_auto_clockout',
                            title: 'Auto Clock-Out!',
                            body: `You were automatically clocked out — ${distance}m from branch for over 5 minutes.`,
                            data: { type: 'geo_auto_clockout', attendance_id: String(record.id), distance: String(distance), priority: 'high' }
                        });
                    } catch(e) {}

                    // Notify admins
                    try {
                        const [admins] = await pool.query("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
                        for (const admin of admins) {
                            await notificationService.send(admin.id, {
                                type: 'geo_auto_clockout_admin',
                                title: 'Staff Auto Clock-Out',
                                body: `${staffName2} auto-clocked-out at ${distance}m from branch.`,
                                data: { type: 'geo_auto_clockout_admin', user_id: String(userId), distance: String(distance), priority: 'high' }
                            }).catch(() => {});
                        }
                    } catch(e) {}

                    return res.json({ success: true, action: 'auto_clockout', status: 'clocked_out', distance });
                }

                const remainSec = Math.ceil((graceMs - elapsed) / 1000);
                return res.json({ success: true, action: 'warn', status: 'outside_grace', distance, radius, grace_remaining: remainSec });
            }
        } else {
            // Outside fence but < 300m — just track, no auto-clockout
            await pool.query(
                `UPDATE staff_attendance SET last_geo_check_at = NOW(), last_geo_distance = ? WHERE id = ?`,
                [distance, record.id]
            );
            return res.json({ success: true, action: 'none', status: 'outside_soft', distance, radius });
        }
    } catch (error) {
        console.error('Location report error:', error);
        res.status(500).json({ success: false, message: 'Failed to process location report' });
    }
});
```

**Step 2: Add `POST /api/attendance/location-off` endpoint**

```javascript
/**
 * POST /api/attendance/location-off
 * Native app reports that GPS was turned off by staff
 * Starts a 2-minute grace period; server cron handles auto-clockout
 */
router.post('/location-off', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const today = getTodayIST();

        const [records] = await pool.query(
            `SELECT a.id FROM staff_attendance a
             WHERE a.user_id = ? AND a.date = ? AND a.clock_out_time IS NULL
             ORDER BY a.id DESC LIMIT 1`,
            [userId, today]
        );

        if (records.length === 0) {
            return res.json({ success: true, message: 'No active attendance' });
        }

        // Set location_off_at timestamp (cron will check this)
        await pool.query(
            `UPDATE staff_attendance SET location_off_at = NOW(), last_geo_check_at = NOW() WHERE id = ?`,
            [records[0].id]
        );

        // Immediate warning to staff
        try {
            await notificationService.send(userId, {
                type: 'location_off_warning',
                title: 'Location Turned Off!',
                body: 'Turn on your location within 2 minutes or you will be auto-clocked-out.',
                data: { type: 'location_off_warning', priority: 'high' }
            });
        } catch(e) {}

        // Notify admins
        try {
            const [userInfo] = await pool.query('SELECT full_name FROM users WHERE id = ?', [userId]);
            const staffName = userInfo[0]?.full_name || 'Staff';
            const [admins] = await pool.query("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
            for (const admin of admins) {
                await notificationService.send(admin.id, {
                    type: 'location_off_admin',
                    title: 'Staff Location Off!',
                    body: `${staffName} turned off location. Auto clock-out in 2 min if not restored.`,
                    data: { type: 'location_off_admin', user_id: String(userId), priority: 'high' }
                }).catch(() => {});
            }
        } catch(e) {}

        res.json({ success: true, message: 'Location-off recorded' });
    } catch (error) {
        console.error('Location-off error:', error);
        res.status(500).json({ success: false, message: 'Failed' });
    }
});
```

**Step 3: Commit**

```bash
git add routes/attendance.js
git commit -m "feat: add location-report and location-off endpoints for native geofence service"
```

---

### Task 2: Server — Migration for `location_off_at` column

**Files:**
- Create: `migrations/migrate-location-off.js`

**Step 1: Create migration**

```javascript
/**
 * Migration: Add location_off_at column to staff_attendance
 * Run: node migrations/migrate-location-off.js
 */
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function migrate() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME,
        port: parseInt(process.env.DB_PORT, 10) || 3306
    });

    console.log('Adding location_off_at column to staff_attendance...');

    const [col] = await pool.query(`SHOW COLUMNS FROM staff_attendance LIKE 'location_off_at'`);
    if (col.length === 0) {
        await pool.query(`ALTER TABLE staff_attendance ADD COLUMN location_off_at DATETIME NULL DEFAULT NULL`);
        console.log('Added location_off_at');
    } else {
        console.log('location_off_at already exists');
    }

    console.log('Done!');
    await pool.end();
    process.exit(0);
}

migrate().catch(err => { console.error('Migration failed:', err); process.exit(1); });
```

**Step 2: Run migration on server**

```bash
ssh root@161.97.114.189 "cd /www/wwwroot/act.qcpaintshop.com && node migrations/migrate-location-off.js"
```

**Step 3: Commit**

```bash
git add migrations/migrate-location-off.js
git commit -m "feat: add location_off_at migration for GPS-off detection"
```

---

### Task 3: Server — Cron for stale location + GPS-off auto-clockout

**Files:**
- Modify: `server.js` (add cron near other scheduled tasks)

Find the section with existing cron jobs (search for `node-cron` or `cron.schedule`) and add:

```javascript
// Geofence enforcement cron — every 60 seconds
// Checks for: (1) stale geo reports (>5 min at 300m+), (2) location turned off (>2 min)
cron.schedule('* * * * *', async () => {
    try {
        const today = getTodayIST();

        // 1. Location-off auto-clockout (2 min grace)
        const [locationOffRecords] = await pool.query(
            `SELECT a.id, a.user_id, a.clock_in_time, a.break_duration_minutes, a.branch_id
             FROM staff_attendance a
             WHERE a.date = ? AND a.clock_out_time IS NULL
               AND a.location_off_at IS NOT NULL
               AND TIMESTAMPDIFF(SECOND, a.location_off_at, NOW()) >= 120`,
            [today]
        );

        for (const rec of locationOffRecords) {
            const now = new Date();
            const breakMinutes = rec.break_duration_minutes || 0;
            const workingMinutes = Math.round(((now - new Date(rec.clock_in_time)) / 1000 / 60) - breakMinutes);

            await pool.query(
                `UPDATE staff_attendance
                 SET clock_out_time = ?, total_working_minutes = ?,
                     auto_clockout_type = 'location_off', location_off_at = NULL,
                     geo_warning_started_at = NULL,
                     notes = CONCAT(COALESCE(notes, ''), '\n[Auto clock-out: Location turned off for >2 min]')
                 WHERE id = ?`,
                [now, workingMinutes, rec.id]
            );

            // Notify staff
            try {
                await notificationService.send(rec.user_id, {
                    type: 'geo_auto_clockout',
                    title: 'Auto Clock-Out!',
                    body: 'You were auto-clocked-out because location was turned off for over 2 minutes.',
                    data: { type: 'geo_auto_clockout', reason: 'location_off', priority: 'high' }
                });
            } catch(e) {}

            // Notify admins
            try {
                const [userInfo] = await pool.query('SELECT full_name FROM users WHERE id = ?', [rec.user_id]);
                const staffName = userInfo[0]?.full_name || 'Staff';
                const [admins] = await pool.query("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
                for (const admin of admins) {
                    await notificationService.send(admin.id, {
                        type: 'geo_auto_clockout_admin',
                        title: 'Staff Auto Clock-Out (Location Off)',
                        body: `${staffName} auto-clocked-out — location was off for >2 min.`,
                        data: { type: 'geo_auto_clockout_admin', user_id: String(rec.user_id), reason: 'location_off', priority: 'high' }
                    }).catch(() => {});
                }
            } catch(e) {}

            console.log(`[Geo Cron] Auto-clockout user ${rec.user_id} — location off >2 min`);
        }

        // 2. Stale geo report auto-clockout (no report for >5 min while geo_warning active)
        const [staleRecords] = await pool.query(
            `SELECT a.id, a.user_id, a.clock_in_time, a.break_duration_minutes, a.last_geo_distance
             FROM staff_attendance a
             WHERE a.date = ? AND a.clock_out_time IS NULL
               AND a.geo_warning_started_at IS NOT NULL
               AND TIMESTAMPDIFF(SECOND, a.geo_warning_started_at, NOW()) >= 300`,
            [today]
        );

        for (const rec of staleRecords) {
            // Verify not on break/outside/prayer
            const [activeOW] = await pool.query("SELECT id FROM outside_work_periods WHERE user_id = ? AND status = 'active' LIMIT 1", [rec.user_id]);
            const [activePrayer] = await pool.query("SELECT id FROM prayer_periods WHERE user_id = ? AND status = 'active' LIMIT 1", [rec.user_id]);
            if (activeOW.length > 0 || activePrayer.length > 0) continue;

            const now = new Date();
            const breakMinutes = rec.break_duration_minutes || 0;
            const workingMinutes = Math.round(((now - new Date(rec.clock_in_time)) / 1000 / 60) - breakMinutes);
            const dist = rec.last_geo_distance || 0;

            await pool.query(
                `UPDATE staff_attendance
                 SET clock_out_time = ?, total_working_minutes = ?,
                     auto_clockout_type = 'geo', auto_clockout_distance = ?,
                     geo_warning_started_at = NULL,
                     notes = CONCAT(COALESCE(notes, ''), '\n[Auto clock-out by server: ${dist}m from branch, 5 min grace expired]')
                 WHERE id = ?`,
                [now, workingMinutes, dist, rec.id]
            );

            try {
                await notificationService.send(rec.user_id, {
                    type: 'geo_auto_clockout',
                    title: 'Auto Clock-Out!',
                    body: `Auto-clocked-out — ${dist}m from branch for over 5 minutes.`,
                    data: { type: 'geo_auto_clockout', distance: String(dist), priority: 'high' }
                });
            } catch(e) {}

            try {
                const [userInfo] = await pool.query('SELECT full_name FROM users WHERE id = ?', [rec.user_id]);
                const staffName = userInfo[0]?.full_name || 'Staff';
                const [admins] = await pool.query("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
                for (const admin of admins) {
                    await notificationService.send(admin.id, {
                        type: 'geo_auto_clockout_admin',
                        title: 'Staff Auto Clock-Out (Server)',
                        body: `${staffName} auto-clocked-out — ${dist}m from branch, 5 min expired.`,
                        data: { type: 'geo_auto_clockout_admin', user_id: String(rec.user_id), distance: String(dist), priority: 'high' }
                    }).catch(() => {});
                }
            } catch(e) {}

            console.log(`[Geo Cron] Server auto-clockout user ${rec.user_id} — geo warning expired, ${dist}m`);
        }
    } catch (err) {
        console.error('[Geo Cron] Error:', err.message);
    }
});
```

**Step 2: Commit**

```bash
git add server.js
git commit -m "feat: add geofence enforcement cron (location-off + stale geo auto-clockout)"
```

---

### Task 4: Android — Geofence alert notification channel

**Files:**
- Modify: `qcpaintshop-android/app/src/main/java/com/qcpaintshop/act/fcm/QCFirebaseMessagingService.kt`

**Step 1: Add a high-priority geofence alert channel**

Add a second channel `qc_geofence_alerts` with `IMPORTANCE_MAX` and alarm sound. Route geofence notification types to this channel.

In `createNotificationChannel()`, after the existing channel creation, add:

```kotlin
// Geofence alert channel — alarm-level urgency
val alarmSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
    ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
val geoChannel = NotificationChannel(
    "qc_geofence_alerts",
    "Geofence Alerts",
    NotificationManager.IMPORTANCE_HIGH
).apply {
    description = "Urgent alerts when you leave the branch area"
    enableLights(true)
    enableVibration(true)
    vibrationPattern = longArrayOf(0, 500, 200, 500, 200, 500)
    setSound(alarmSound, audioAttributes)
    setBypassDnd(true)
}
notificationManager.createNotificationChannel(geoChannel)
```

In `showNotification()`, route geofence types to the alert channel:

```kotlin
val isGeofenceAlert = type in listOf(
    "geofence_exit_warning", "geo_auto_clockout", "location_off_warning",
    "geofence_exit_admin", "geo_auto_clockout_admin", "location_off_admin"
)
val channelId = if (isGeofenceAlert) "qc_geofence_alerts" else CHANNEL_ID
```

Also change the notification builder to use `channelId` variable and add full-screen intent behavior for geofence alerts:

```kotlin
val builder = NotificationCompat.Builder(this, channelId)
    .setSmallIcon(R.drawable.ic_notification)
    .setContentTitle(title)
    .setContentText(body)
    .setAutoCancel(true)
    .setSound(if (isGeofenceAlert) alarmSound else defaultSound)
    .setContentIntent(pendingIntent)
    .setPriority(if (isGeofenceAlert) NotificationCompat.PRIORITY_MAX else NotificationCompat.PRIORITY_HIGH)

if (isGeofenceAlert) {
    builder.setVibrate(longArrayOf(0, 500, 200, 500, 200, 500))
    builder.setCategory(NotificationCompat.CATEGORY_ALARM)
}
```

Store `type` as class member by extracting it in `onMessageReceived` and passing to `showNotification`.

**Step 2: Commit**

```bash
git add qcpaintshop-android/app/src/main/java/com/qcpaintshop/act/fcm/QCFirebaseMessagingService.kt
git commit -m "feat: add geofence alert notification channel with alarm sound and vibration"
```

---

### Task 5: Android — GeofenceLocationService (ForegroundService)

**Files:**
- Create: `qcpaintshop-android/app/src/main/java/com/qcpaintshop/act/location/GeofenceLocationService.kt`

**Step 1: Create the ForegroundService**

```kotlin
package com.qcpaintshop.act.location

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationCompat
import com.qcpaintshop.act.MainActivity
import com.qcpaintshop.act.R
import com.qcpaintshop.act.util.Constants
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

class GeofenceLocationService : Service() {

    companion object {
        private const val TAG = "GeoFenceService"
        private const val CHANNEL_ID = "qc_location_service"
        private const val NOTIFICATION_ID = 9001
        private const val LOCATION_INTERVAL = 30_000L // 30 seconds
        private const val LOCATION_MIN_DISTANCE = 10f // 10 meters

        fun start(context: Context, authToken: String) {
            val intent = Intent(context, GeofenceLocationService::class.java).apply {
                putExtra("auth_token", authToken)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, GeofenceLocationService::class.java))
        }
    }

    private var authToken: String? = null
    private var locationManager: LocationManager? = null
    private var isRunning = false

    private val locationListener = object : LocationListener {
        override fun onLocationChanged(location: Location) {
            reportLocation(location.latitude, location.longitude)
        }
        override fun onProviderDisabled(provider: String) {
            Log.w(TAG, "Location provider disabled: $provider")
            reportLocationOff()
        }
        override fun onProviderEnabled(provider: String) {
            Log.i(TAG, "Location provider enabled: $provider")
            // Clear location_off on server by sending a location report
        }
        @Deprecated("Deprecated in API") override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        authToken = intent?.getStringExtra("auth_token")
            ?: getSharedPreferences("qc_prefs", MODE_PRIVATE).getString("auth_token", null)

        if (authToken == null) {
            Log.e(TAG, "No auth token, stopping service")
            stopSelf()
            return START_NOT_STICKY
        }

        // Save token for restart
        getSharedPreferences("qc_prefs", MODE_PRIVATE).edit()
            .putString("auth_token", authToken)
            .putBoolean("geo_service_active", true)
            .apply()

        if (!isRunning) {
            createNotificationChannel()
            val notification = buildForegroundNotification("Monitoring your location...")
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
            startLocationUpdates()
            isRunning = true
        }

        return START_STICKY
    }

    private fun startLocationUpdates() {
        locationManager = getSystemService(Context.LOCATION_SERVICE) as LocationManager

        try {
            // Try GPS first, fall back to network
            val provider = if (locationManager!!.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                LocationManager.GPS_PROVIDER
            } else if (locationManager!!.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                LocationManager.NETWORK_PROVIDER
            } else {
                reportLocationOff()
                return
            }

            locationManager!!.requestLocationUpdates(
                provider, LOCATION_INTERVAL, LOCATION_MIN_DISTANCE, locationListener
            )
            Log.i(TAG, "Location updates started on $provider")
        } catch (e: SecurityException) {
            Log.e(TAG, "Location permission denied: ${e.message}")
            stopSelf()
        }
    }

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
                    // Check if server says to stop service (no active attendance)
                    if (response.contains("\"action\":\"stop_service\"") || response.contains("\"action\":\"auto_clockout\"")) {
                        Log.i(TAG, "Server says stop: $response")
                        getSharedPreferences("qc_prefs", MODE_PRIVATE).edit()
                            .putBoolean("geo_service_active", false).apply()
                        stopSelf()
                    }
                } else if (code == 401) {
                    Log.w(TAG, "Auth expired, stopping service")
                    stopSelf()
                }
                conn.disconnect()
            } catch (e: Exception) {
                Log.e(TAG, "Location report failed: ${e.message}")
            }
        }
    }

    private fun reportLocationOff() {
        val token = authToken ?: return
        thread {
            try {
                val url = URL("${Constants.BASE_URL}/api/attendance/location-off")
                val conn = url.openConnection() as HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Authorization", "Bearer $token")
                conn.setRequestProperty("Content-Type", "application/json")
                conn.doOutput = true
                conn.connectTimeout = 10_000
                conn.readTimeout = 10_000
                OutputStreamWriter(conn.outputStream).use { it.write("{}") }
                conn.responseCode // trigger request
                conn.disconnect()
                Log.i(TAG, "Location-off reported to server")
            } catch (e: Exception) {
                Log.e(TAG, "Location-off report failed: ${e.message}")
            }
        }
    }

    private fun buildForegroundNotification(text: String): Notification {
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
        }
        val pendingIntent = PendingIntent.getActivity(
            this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        return NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle("QC Attendance Active")
            .setContentText(text)
            .setOngoing(true)
            .setContentIntent(pendingIntent)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .build()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                CHANNEL_ID,
                "Location Tracking",
                NotificationManager.IMPORTANCE_LOW
            ).apply {
                description = "Ongoing notification while attendance tracking is active"
            }
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.createNotificationChannel(channel)
        }
    }

    override fun onDestroy() {
        locationManager?.removeUpdates(locationListener)
        isRunning = false
        getSharedPreferences("qc_prefs", MODE_PRIVATE).edit()
            .putBoolean("geo_service_active", false).apply()
        Log.i(TAG, "GeofenceLocationService stopped")
        super.onDestroy()
    }
}
```

**Step 2: Commit**

```bash
git add qcpaintshop-android/app/src/main/java/com/qcpaintshop/act/location/GeofenceLocationService.kt
git commit -m "feat: add GeofenceLocationService foreground service for background GPS"
```

---

### Task 6: Android — Manifest permissions + service registration

**Files:**
- Modify: `qcpaintshop-android/app/src/main/AndroidManifest.xml`

**Step 1: Add permissions and service**

After existing location permissions (line 16), add:
```xml
<uses-permission android:name="android.permission.ACCESS_BACKGROUND_LOCATION" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
<uses-permission android:name="android.permission.FOREGROUND_SERVICE_LOCATION" />
```

Inside `<application>`, after the FCM service (after line 71), add:
```xml
<!-- Geofence Background Location Service -->
<service
    android:name=".location.GeofenceLocationService"
    android:exported="false"
    android:foregroundServiceType="location" />
```

**Step 2: Commit**

```bash
git add qcpaintshop-android/app/src/main/AndroidManifest.xml
git commit -m "feat: add background location permission and GeofenceLocationService to manifest"
```

---

### Task 7: Android — MainActivity JS bridge + permission flow

**Files:**
- Modify: `qcpaintshop-android/app/src/main/java/com/qcpaintshop/act/MainActivity.kt`

**Step 1: Add JS bridge methods to QCAppInterface**

Inside the `QCAppInterface` inner class, add:

```kotlin
@JavascriptInterface
fun startGeofenceService(authToken: String) {
    runOnUiThread {
        // Check background location permission first
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            if (ContextCompat.checkSelfPermission(this@MainActivity,
                    Manifest.permission.ACCESS_BACKGROUND_LOCATION) != PackageManager.PERMISSION_GRANTED) {
                // Store token for after permission grant
                getSharedPreferences("qc_prefs", MODE_PRIVATE).edit()
                    .putString("pending_geo_token", authToken).apply()
                requestBackgroundLocationPermission()
                return@runOnUiThread
            }
        }
        GeofenceLocationService.start(this@MainActivity, authToken)
    }
}

@JavascriptInterface
fun stopGeofenceService() {
    runOnUiThread {
        GeofenceLocationService.stop(this@MainActivity)
    }
}

@JavascriptInterface
fun isGeofenceServiceRunning(): Boolean {
    return getSharedPreferences("qc_prefs", MODE_PRIVATE)
        .getBoolean("geo_service_active", false)
}
```

**Step 2: Add background location permission request method to MainActivity**

```kotlin
private fun requestBackgroundLocationPermission() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        // Must already have ACCESS_FINE_LOCATION before requesting BACKGROUND
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this,
                arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION),
                Constants.REQUEST_LOCATION)
            return
        }
        AlertDialog.Builder(this)
            .setTitle("Background Location Required")
            .setMessage("To monitor attendance while the app is in background, please select \"Allow all the time\" for location access.")
            .setPositiveButton("Grant") { _, _ ->
                ActivityCompat.requestPermissions(this,
                    arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION),
                    REQUEST_BACKGROUND_LOCATION)
            }
            .setNegativeButton("Cancel", null)
            .show()
    }
}
```

Add constant to `Constants.kt`:
```kotlin
const val REQUEST_BACKGROUND_LOCATION = 1006
```

**Step 3: Handle permission result in `onRequestPermissionsResult`**

Add a new `when` branch:
```kotlin
Constants.REQUEST_BACKGROUND_LOCATION -> {
    if (grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
        // Permission granted — start service with saved token
        val token = getSharedPreferences("qc_prefs", MODE_PRIVATE)
            .getString("pending_geo_token", null)
        if (token != null) {
            GeofenceLocationService.start(this, token)
            getSharedPreferences("qc_prefs", MODE_PRIVATE).edit()
                .remove("pending_geo_token").apply()
        }
    } else {
        Toast.makeText(this, "Background location needed for attendance", Toast.LENGTH_LONG).show()
    }
}
```

**Step 4: Add import at top of MainActivity.kt**
```kotlin
import com.qcpaintshop.act.location.GeofenceLocationService
```

**Step 5: Update `requestStartupPermissions` to remove the one-time gate**

Change the prefs check to always request on every launch (remove the `permissions_requested` guard) since we need to ensure background location is granted:

```kotlin
private fun requestStartupPermissions() {
    val permissions = mutableListOf(
        Manifest.permission.CAMERA,
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.ACCESS_COARSE_LOCATION
    )
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        permissions.add(Manifest.permission.POST_NOTIFICATIONS)
    }
    val needed = permissions.filter {
        ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
    }.toTypedArray()
    if (needed.isNotEmpty()) {
        ActivityCompat.requestPermissions(this, needed, Constants.REQUEST_STARTUP_PERMISSIONS)
    }
}
```

**Step 6: Commit**

```bash
git add qcpaintshop-android/app/src/main/java/com/qcpaintshop/act/MainActivity.kt
git add qcpaintshop-android/app/src/main/java/com/qcpaintshop/act/util/Constants.kt
git commit -m "feat: add JS bridge for geofence service start/stop + background location permission"
```

---

### Task 8: Web — Dashboard JS bridge calls

**Files:**
- Modify: `public/staff/dashboard.html`

**Step 1: Start native service on clock-in detection**

In the `showClockedInState()` function (or wherever clock-in state is rendered), add after `startTimer()`:

```javascript
// Start native Android geofence service if in app
if (typeof QCApp !== 'undefined' && QCApp.isAndroidApp && QCApp.isAndroidApp()) {
    try {
        var authToken = localStorage.getItem('auth_token');
        if (authToken && QCApp.startGeofenceService) {
            QCApp.startGeofenceService(authToken);
            console.log('Native geofence service started');
        }
    } catch(e) { console.log('Geofence service start error:', e); }
}
```

**Step 2: Stop native service on clock-out detection**

In the `showClockedOutState()` function (where Day Complete is shown), add:

```javascript
// Stop native Android geofence service
if (typeof QCApp !== 'undefined' && QCApp.isAndroidApp && QCApp.isAndroidApp()) {
    try {
        if (QCApp.stopGeofenceService) QCApp.stopGeofenceService();
    } catch(e) {}
}
```

**Step 3: Also stop on auto-clockout response in `triggerGeoAutoClockout()`**

Already calls `stopGeoFenceMonitoring()` — add native stop there too.

**Step 4: Commit**

```bash
git add public/staff/dashboard.html
git commit -m "feat: start/stop native geofence service on clock-in/out via JS bridge"
```

---

### Task 9: Android — Update FCM deep links for new notification types

**Files:**
- Modify: `qcpaintshop-android/app/src/main/java/com/qcpaintshop/act/fcm/QCFirebaseMessagingService.kt`

**Step 1: Add new types to deep link router**

In `getDeepLinkPath()` staff routes, add:
```kotlin
"geofence_exit_warning", "location_off_warning" -> "/staff/dashboard.html"
"geofence_exit_admin", "location_off_admin" -> "/admin-attendance.html"
```

**Step 2: Commit**

```bash
git add qcpaintshop-android/app/src/main/java/com/qcpaintshop/act/fcm/QCFirebaseMessagingService.kt
git commit -m "feat: add deep link routes for geofence + location-off notification types"
```

---

### Task 10: Build, version bump, and deploy

**Files:**
- Modify: `qcpaintshop-android/app/build.gradle.kts` — bump staff versionCode 14->15, versionName 3.3.6->3.3.7

**Step 1: Bump version**

```kotlin
versionCode = 15
versionName = "3.3.7"
```

**Step 2: Build staff AAB**

```bash
cd qcpaintshop-android
./gradlew bundleStaffRelease
```

**Step 3: Deploy server changes**

```bash
ssh root@161.97.114.189 "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && node migrations/migrate-location-off.js && pm2 restart business-manager"
```

**Step 4: Publish to Play Store**

```bash
cd google-services
node publish-to-play.js ../qcpaintshop-android/app/build/outputs/bundle/staffRelease/app-staff-release.aab production
```

**Step 5: Update `google-services/publish-to-play.js` release notes**

**Step 6: Commit all**

```bash
git add -A
git commit -m "feat: geofence background service v3.3.7 — native GPS monitoring, location-off detection, auto-clockout"
```

---

## Summary of All New Files

| File | Type | Purpose |
|------|------|---------|
| `location/GeofenceLocationService.kt` | Create | ForegroundService — GPS every 30s |
| `migrations/migrate-location-off.js` | Create | Add `location_off_at` column |
| `routes/attendance.js` | Modify | Add `location-report` + `location-off` endpoints |
| `server.js` | Modify | Add geofence enforcement cron |
| `AndroidManifest.xml` | Modify | Add permissions + service |
| `MainActivity.kt` | Modify | JS bridge + permission flow |
| `Constants.kt` | Modify | Add REQUEST_BACKGROUND_LOCATION |
| `QCFirebaseMessagingService.kt` | Modify | Geofence alert channel + deep links |
| `public/staff/dashboard.html` | Modify | JS bridge calls on clock-in/out |
| `build.gradle.kts` | Modify | Version bump |

## Flow Summary

```
Staff clocks in → WebView JS calls QCApp.startGeofenceService(token)
  → Android ForegroundService starts with persistent notification
  → GPS location sent to /api/attendance/location-report every 30s
    → Server checks geofence distance
    → If >300m: immediate FCM push to staff + admins
    → If >300m for 5 min: auto clock-out + FCM push
  → If staff turns OFF GPS:
    → onProviderDisabled → POST /api/attendance/location-off
    → Server starts 2-min timer (cron checks every 60s)
    → If GPS not restored in 2 min: auto clock-out + FCM push
Staff clocks out → WebView JS calls QCApp.stopGeofenceService()
  → ForegroundService stops
```
