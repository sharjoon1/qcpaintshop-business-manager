# Staff Activity Tracker Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Real-time staff activity tracking from clock-in to clock-out with idle detection, admin monitoring, and daily task auto-completion.

**Architecture:** Server-driven. Staff starts/stops activities via REST API. Server stores timed sessions in `staff_activity_sessions` table. A 60s cron detects idle staff and sends FCM alerts. Socket.io broadcasts changes to admin monitor. Activity completions auto-mark matching daily tasks.

**Tech Stack:** Express.js routes, MySQL (mysql2/promise), Socket.io, FCM via notification-service, Multer + Sharp for photo uploads, vanilla JS frontend with Tailwind CSS.

**Design doc:** `docs/plans/2026-03-08-staff-activity-tracker-design.md`

---

### Task 1: Database Migration

**Files:**
- Create: `migrations/migrate-activity-tracker.js`

**Context:** Follow the migration pattern from `migrations/migrate-notice-board.js`. Tables use `utf8mb4_unicode_ci` charset. The project uses `mysql2/promise` with env vars `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`.

**Step 1: Create the migration file**

```javascript
// migrations/migrate-activity-tracker.js
const mysql = require('mysql2/promise');
require('dotenv').config();

(async () => {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    console.log('Starting activity tracker migration...');

    // Staff activity sessions
    await pool.query(`
        CREATE TABLE IF NOT EXISTS staff_activity_sessions (
            id INT PRIMARY KEY AUTO_INCREMENT,
            user_id INT NOT NULL,
            branch_id INT NOT NULL,
            activity_type ENUM('marketing','outstanding_followup','material_arrangement','material_receiving','attending_customer','shop_maintenance') NOT NULL,
            started_at DATETIME NOT NULL,
            ended_at DATETIME NULL,
            duration_minutes INT NULL,
            auto_ended TINYINT(1) DEFAULT 0,
            metadata JSON NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_user_started (user_id, started_at),
            INDEX idx_user_ended (user_id, ended_at),
            INDEX idx_branch_started (branch_id, started_at),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('Created staff_activity_sessions table');

    // Staff idle alerts
    await pool.query(`
        CREATE TABLE IF NOT EXISTS staff_idle_alerts (
            id INT PRIMARY KEY AUTO_INCREMENT,
            user_id INT NOT NULL,
            idle_started_at DATETIME NOT NULL,
            alert_sent_at DATETIME NOT NULL,
            responded_at DATETIME NULL,
            idle_minutes INT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_user_alert (user_id, alert_sent_at),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('Created staff_idle_alerts table');

    await pool.end();
    console.log('Activity tracker migration complete!');
})().catch(e => {
    console.error('Migration failed:', e.message);
    process.exit(1);
});
```

**Step 2: Run migration on server**

```bash
ssh root@161.97.114.189 "cd /www/wwwroot/act.qcpaintshop.com && node migrations/migrate-activity-tracker.js"
```

Expected: "Activity tracker migration complete!"

**Step 3: Commit**

```bash
git add migrations/migrate-activity-tracker.js
git commit -m "feat: add activity tracker migration (sessions + idle alerts tables)"
```

---

### Task 2: Activity Tracker Service

**Files:**
- Create: `services/activity-tracker-service.js`

**Context:** This is the core business logic. Follow patterns from `services/activity-feed.js` — export functions + `setPool()`/`setIO()` injection. Use `services/notification-service.js` for FCM via `send(userId, {type, title, body, data})`. Use `services/activity-feed.js` `logActivity()` for activity feed entries.

**Step 1: Create the service**

```javascript
// services/activity-tracker-service.js
const activityFeed = require('./activity-feed');
let pool, io, notificationService;

const ACTIVITY_CONFIG = {
    marketing:              { label: 'Marketing / Lead Work',     redirect: '/staff/leads.html',       icon: 'MKT', color: '#8b5cf6', dailyTaskSection: null },
    outstanding_followup:   { label: 'Outstanding Follow-up',     redirect: '/staff/collections.html', icon: 'OUT', color: '#f59e0b', dailyTaskSection: 'outstanding' },
    material_arrangement:   { label: 'Material Arrangement',      redirect: '/staff/products.html',    icon: 'MAT', color: '#0891b2', dailyTaskSection: null },
    material_receiving:     { label: 'Material Receiving & Billing', redirect: '/staff/daily-tasks.html', icon: 'RCV', color: '#059669', dailyTaskSection: 'material' },
    attending_customer:     { label: 'Attending Customer',        redirect: null,                      icon: 'CUS', color: '#6366f1', dailyTaskSection: 'sales' },
    shop_maintenance:       { label: 'Shop Maintenance',          redirect: null,                      icon: 'SHP', color: '#10b981', dailyTaskSection: 'morning' }
};

function setPool(p) { pool = p; }
function setIO(socketIO) { io = socketIO; }
function setNotificationService(ns) { notificationService = ns; }

// Start a new activity session (auto-ends previous)
async function startActivity(userId, branchId, activityType, metadata = null) {
    if (!ACTIVITY_CONFIG[activityType]) {
        throw new Error('Invalid activity type: ' + activityType);
    }

    // Auto-end any current active session
    const ended = await endActiveSession(userId, true);

    // Clear pending idle alerts
    await pool.query(
        `UPDATE staff_idle_alerts SET responded_at = NOW(), idle_minutes = TIMESTAMPDIFF(MINUTE, idle_started_at, NOW())
         WHERE user_id = ? AND responded_at IS NULL`,
        [userId]
    );

    // Insert new session
    const [result] = await pool.query(
        `INSERT INTO staff_activity_sessions (user_id, branch_id, activity_type, started_at, metadata)
         VALUES (?, ?, ?, NOW(), ?)`,
        [userId, branchId, activityType, metadata ? JSON.stringify(metadata) : null]
    );

    const config = ACTIVITY_CONFIG[activityType];

    // Log to activity feed
    activityFeed.logActivity(userId, branchId, 'activity_started', `Started: ${config.label}`, null, 'all');

    // Broadcast to admin
    if (io) {
        io.emit('activity_tracker_update', {
            userId, branchId, activityType,
            action: 'start',
            label: config.label,
            startedAt: new Date().toISOString()
        });
    }

    return {
        sessionId: result.insertId,
        activityType,
        label: config.label,
        redirect: config.redirect,
        startedAt: new Date().toISOString(),
        previousEnded: ended
    };
}

// Stop current active session
async function stopActivity(userId, metadata = null, photos = null) {
    const [active] = await pool.query(
        `SELECT * FROM staff_activity_sessions WHERE user_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
        [userId]
    );

    if (active.length === 0) {
        return { stopped: false, message: 'No active session' };
    }

    const session = active[0];

    // Merge metadata
    let existingMeta = {};
    try { existingMeta = session.metadata ? (typeof session.metadata === 'string' ? JSON.parse(session.metadata) : session.metadata) : {}; } catch(e) {}
    if (metadata) Object.assign(existingMeta, metadata);
    if (photos) existingMeta.photos = photos;

    // End session
    await pool.query(
        `UPDATE staff_activity_sessions
         SET ended_at = NOW(), duration_minutes = TIMESTAMPDIFF(MINUTE, started_at, NOW()), auto_ended = 0, metadata = ?
         WHERE id = ?`,
        [JSON.stringify(existingMeta), session.id]
    );

    const config = ACTIVITY_CONFIG[session.activity_type];

    // Auto-complete daily task
    await autoCompleteDailyTask(userId, session.activity_type, existingMeta);

    // Log to activity feed
    const duration = Math.round((Date.now() - new Date(session.started_at).getTime()) / 60000);
    activityFeed.logActivity(userId, session.branch_id, 'activity_completed',
        `Completed: ${config.label} (${duration}m)`, null, 'all');

    // Broadcast to admin
    if (io) {
        io.emit('activity_tracker_update', {
            userId, branchId: session.branch_id, activityType: session.activity_type,
            action: 'stop',
            label: config.label,
            durationMinutes: duration
        });
    }

    return { stopped: true, sessionId: session.id, duration };
}

// End active session (internal helper, used by auto-end triggers)
async function endActiveSession(userId, autoEnded = true) {
    const [active] = await pool.query(
        `SELECT id, activity_type, branch_id, started_at, metadata FROM staff_activity_sessions
         WHERE user_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
        [userId]
    );

    if (active.length === 0) return false;

    const session = active[0];
    await pool.query(
        `UPDATE staff_activity_sessions
         SET ended_at = NOW(), duration_minutes = TIMESTAMPDIFF(MINUTE, started_at, NOW()), auto_ended = ?
         WHERE id = ?`,
        [autoEnded ? 1 : 0, session.id]
    );

    // Auto-complete daily task
    let meta = {};
    try { meta = session.metadata ? (typeof session.metadata === 'string' ? JSON.parse(session.metadata) : session.metadata) : {}; } catch(e) {}
    await autoCompleteDailyTask(userId, session.activity_type, meta);

    if (io) {
        const config = ACTIVITY_CONFIG[session.activity_type];
        io.emit('activity_tracker_update', {
            userId, branchId: session.branch_id, activityType: session.activity_type,
            action: 'auto_ended',
            label: config.label
        });
    }

    return true;
}

// Get current active session for a user
async function getCurrentSession(userId) {
    const [rows] = await pool.query(
        `SELECT s.*, u.full_name, u.branch_id
         FROM staff_activity_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.user_id = ? AND s.ended_at IS NULL
         ORDER BY s.started_at DESC LIMIT 1`,
        [userId]
    );
    return rows.length > 0 ? rows[0] : null;
}

// Get today's timeline for a user
async function getTodayTimeline(userId) {
    const [rows] = await pool.query(
        `SELECT * FROM staff_activity_sessions
         WHERE user_id = ? AND DATE(started_at) = CURDATE()
         ORDER BY started_at ASC`,
        [userId]
    );
    return rows;
}

// Admin: get all live active sessions
async function getLiveSessions() {
    const [rows] = await pool.query(
        `SELECT s.*, u.full_name, u.branch_id as user_branch_id,
                b.name as branch_name,
                TIMESTAMPDIFF(MINUTE, s.started_at, NOW()) as elapsed_minutes
         FROM staff_activity_sessions s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN branches b ON b.id = u.branch_id
         WHERE s.ended_at IS NULL
         ORDER BY s.started_at ASC`
    );
    return rows;
}

// Admin: get staff timeline for a specific date
async function getStaffTimeline(staffId, date) {
    const [rows] = await pool.query(
        `SELECT * FROM staff_activity_sessions
         WHERE user_id = ? AND DATE(started_at) = ?
         ORDER BY started_at ASC`,
        [staffId, date]
    );
    return rows;
}

// Admin: get day summary (time per activity per staff)
async function getDaySummary(date, branchId) {
    let sql = `
        SELECT s.user_id, u.full_name, u.branch_id, b.name as branch_name,
               s.activity_type,
               SUM(COALESCE(s.duration_minutes, TIMESTAMPDIFF(MINUTE, s.started_at, NOW()))) as total_minutes,
               COUNT(*) as session_count
        FROM staff_activity_sessions s
        JOIN users u ON u.id = s.user_id
        LEFT JOIN branches b ON b.id = u.branch_id
        WHERE DATE(s.started_at) = ?
    `;
    const params = [date];
    if (branchId) {
        sql += ' AND u.branch_id = ?';
        params.push(branchId);
    }
    sql += ' GROUP BY s.user_id, s.activity_type ORDER BY u.full_name, s.activity_type';
    const [rows] = await pool.query(sql, params);
    return rows;
}

// Auto-complete matching daily task
async function autoCompleteDailyTask(userId, activityType, metadata) {
    const config = ACTIVITY_CONFIG[activityType];
    if (!config || !config.dailyTaskSection) return;

    // Check conditions
    if (activityType === 'marketing' && !(metadata.calls_made > 0)) return;
    if (activityType === 'outstanding_followup' && !(metadata.amount_collected > 0)) return;
    if (activityType === 'shop_maintenance' && !(metadata.photos && metadata.photos.length > 0)) return;

    const today = new Date().toISOString().split('T')[0];

    // Find matching template by section
    const [templates] = await pool.query(
        `SELECT id FROM daily_task_templates WHERE section = ? AND is_active = 1 LIMIT 1`,
        [config.dailyTaskSection]
    );
    if (templates.length === 0) return;

    const templateId = templates[0].id;

    // Don't overwrite existing manual response
    const [existing] = await pool.query(
        `SELECT id FROM daily_task_responses WHERE user_id = ? AND task_date = ? AND template_id = ?`,
        [userId, today, templateId]
    );
    if (existing.length > 0) return;

    // Auto-insert response
    const details = {};
    if (activityType === 'outstanding_followup') {
        details.who_followed = 'Auto-tracked via activity';
        details.status = `Collected: ${metadata.amount_collected}`;
    }
    if (activityType === 'marketing') {
        details.who_called = 'Auto-tracked via activity';
        details.status = `${metadata.calls_made} calls made`;
    }

    const photos = metadata.photos ? JSON.stringify(metadata.photos) : null;

    await pool.query(
        `INSERT INTO daily_task_responses (user_id, task_date, template_id, answer, details, photos)
         VALUES (?, ?, ?, 'yes', ?, ?)`,
        [userId, today, templateId, JSON.stringify(details), photos]
    );

    console.log(`[ActivityTracker] Auto-completed daily task: section=${config.dailyTaskSection} for user=${userId}`);
}

// Idle detection — called by cron every 60s
async function checkIdleStaff() {
    if (!pool) return;
    try {
        // Find clocked-in staff with no active activity session
        // Exclude staff on break, outside work, or prayer
        const [idleStaff] = await pool.query(`
            SELECT a.user_id, a.clock_in_time, u.full_name, u.branch_id,
                   (SELECT MAX(ended_at) FROM staff_activity_sessions
                    WHERE user_id = a.user_id AND DATE(started_at) = CURDATE()) as last_activity_ended,
                   (SELECT MAX(alert_sent_at) FROM staff_idle_alerts
                    WHERE user_id = a.user_id AND DATE(alert_sent_at) = CURDATE()) as last_alert
            FROM staff_attendance a
            JOIN users u ON u.id = a.user_id
            WHERE a.date = CURDATE()
              AND a.clock_in_time IS NOT NULL
              AND a.clock_out_time IS NULL
              AND NOT EXISTS (
                  SELECT 1 FROM staff_activity_sessions
                  WHERE user_id = a.user_id AND ended_at IS NULL
              )
              AND a.break_start IS NULL OR a.break_end IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM outside_work_periods
                  WHERE user_id = a.user_id AND DATE(started_at) = CURDATE() AND ended_at IS NULL
              )
              AND NOT EXISTS (
                  SELECT 1 FROM prayer_periods
                  WHERE user_id = a.user_id AND DATE(started_at) = CURDATE() AND ended_at IS NULL
              )
        `);

        for (const staff of idleStaff) {
            const idleSince = staff.last_activity_ended || staff.clock_in_time;
            const idleMinutes = Math.round((Date.now() - new Date(idleSince).getTime()) / 60000);

            // 15+ min idle, no alert in last 30 min
            if (idleMinutes >= 15) {
                const lastAlertAge = staff.last_alert
                    ? Math.round((Date.now() - new Date(staff.last_alert).getTime()) / 60000)
                    : 999;

                if (lastAlertAge >= 30) {
                    // Send FCM to staff
                    if (notificationService) {
                        await notificationService.send(staff.user_id, {
                            type: 'activity_idle_reminder',
                            title: 'What are you doing?',
                            body: `You've been idle for ${idleMinutes} minutes. Please select your current activity.`,
                            data: { type: 'activity_idle_reminder', priority: 'normal' }
                        });
                    }

                    // Record alert
                    await pool.query(
                        `INSERT INTO staff_idle_alerts (user_id, idle_started_at, alert_sent_at)
                         VALUES (?, ?, NOW())`,
                        [staff.user_id, idleSince]
                    );

                    // Broadcast to admin
                    if (io) {
                        io.emit('activity_tracker_idle', {
                            userId: staff.user_id,
                            fullName: staff.full_name,
                            branchId: staff.branch_id,
                            idleMinutes
                        });
                    }

                    console.log(`[ActivityTracker] Idle alert sent: ${staff.full_name} idle ${idleMinutes}m`);
                }

                // 30+ min idle, alert admins too
                if (idleMinutes >= 30 && lastAlertAge >= 30) {
                    const [admins] = await pool.query(
                        `SELECT id FROM users WHERE role = 'admin' AND status = 'active'`
                    );
                    for (const admin of admins) {
                        if (notificationService) {
                            await notificationService.send(admin.id, {
                                type: 'staff_idle_admin_alert',
                                title: 'Staff Idle Alert',
                                body: `${staff.full_name} has been idle for ${idleMinutes} minutes.`,
                                data: { type: 'staff_idle_admin_alert', staffId: String(staff.user_id), priority: 'normal' }
                            });
                        }
                    }
                }
            }
        }
    } catch (error) {
        console.error('[ActivityTracker] Idle check error:', error.message);
    }
}

module.exports = {
    ACTIVITY_CONFIG,
    setPool, setIO, setNotificationService,
    startActivity, stopActivity, endActiveSession,
    getCurrentSession, getTodayTimeline,
    getLiveSessions, getStaffTimeline, getDaySummary,
    checkIdleStaff
};
```

**Step 2: Commit**

```bash
git add services/activity-tracker-service.js
git commit -m "feat: add activity tracker service with idle detection and daily task sync"
```

---

### Task 3: Activity Tracker Routes + Photo Upload

**Files:**
- Create: `routes/activity-tracker.js`
- Modify: `config/uploads.js` — add upload dir + multer config for activity photos

**Context:** Routes follow the pattern: export `router` + `setPool()`/`setIO()`. Auth via `requireAuth` middleware from `middleware/permissionMiddleware.js`. Photos use disk storage via `config/uploads.js` helper `createDiskStorage()`. Sharp is available globally for compression.

**Step 1: Add upload directory and multer config to config/uploads.js**

Add `'public/uploads/activity'` to the `uploadDirs` array (after `'public/uploads/daily-tasks'` on line 20).

Add after line 135 (before `module.exports`):

```javascript
// Activity tracker photo upload (5MB, images only)
const uploadActivity = multer({
    storage: createDiskStorage('public/uploads/activity/', 'activity'),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: imageFilter
});
```

Add `uploadActivity` to the `module.exports` object.

**Step 2: Create the routes file**

```javascript
// routes/activity-tracker.js
const express = require('express');
const router = express.Router();
const { requireAuth, requirePermission } = require('../middleware/permissionMiddleware');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

let pool, io, activityService;
const { uploadActivity } = require('../config/uploads');

function setPool(p) { pool = p; }
function setIO(socketIO) { io = socketIO; }
function setActivityService(svc) { activityService = svc; }

// POST /start — start a new activity
router.post('/start', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const { type, metadata } = req.body;

        if (!type) {
            return res.status(400).json({ success: false, error: 'Activity type is required' });
        }

        // For attending_customer, require customer_note
        if (type === 'attending_customer' && (!metadata || !metadata.customer_note)) {
            return res.status(400).json({ success: false, error: 'Customer note is required for attending customer' });
        }

        // Check staff is clocked in
        const [attendance] = await pool.query(
            `SELECT id, branch_id FROM staff_attendance
             WHERE user_id = ? AND date = CURDATE() AND clock_in_time IS NOT NULL AND clock_out_time IS NULL`,
            [userId]
        );
        if (attendance.length === 0) {
            return res.status(400).json({ success: false, error: 'You must be clocked in to start an activity' });
        }

        const branchId = req.user.branch_id || attendance[0].branch_id;
        const result = await activityService.startActivity(userId, branchId, type, metadata);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('[ActivityTracker] Start error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /stop — stop current activity
router.post('/stop', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const { metadata } = req.body;

        // Check if shop_maintenance — photos handled separately via /stop-with-photo
        const result = await activityService.stopActivity(userId, metadata);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('[ActivityTracker] Stop error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /stop-with-photo — stop shop_maintenance with required photo
router.post('/stop-with-photo', requireAuth, uploadActivity.single('photo'), async (req, res) => {
    try {
        const userId = req.user.id;

        if (!req.file) {
            return res.status(400).json({ success: false, error: 'Photo is required for shop maintenance' });
        }

        // Compress with sharp
        const originalPath = req.file.path;
        const compressedName = 'c_' + req.file.filename.replace(path.extname(req.file.filename), '.jpg');
        const compressedPath = path.join(req.file.destination, compressedName);

        await sharp(originalPath)
            .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toFile(compressedPath);

        fs.unlinkSync(originalPath);
        const photoUrl = `/uploads/activity/${compressedName}`;

        const metadata = req.body.metadata ? JSON.parse(req.body.metadata) : {};
        const result = await activityService.stopActivity(userId, metadata, [photoUrl]);
        res.json({ success: true, ...result, photo_url: photoUrl });
    } catch (error) {
        console.error('[ActivityTracker] Stop-with-photo error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /current — get active session
router.get('/current', requireAuth, async (req, res) => {
    try {
        const session = await activityService.getCurrentSession(req.user.id);
        res.json({ success: true, session, config: activityService.ACTIVITY_CONFIG });
    } catch (error) {
        console.error('[ActivityTracker] Current error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /today — today's timeline
router.get('/today', requireAuth, async (req, res) => {
    try {
        const timeline = await activityService.getTodayTimeline(req.user.id);
        res.json({ success: true, timeline, config: activityService.ACTIVITY_CONFIG });
    } catch (error) {
        console.error('[ActivityTracker] Today error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /admin/live — all active sessions (admin only)
router.get('/admin/live', requireAuth, requirePermission('attendance', 'view'), async (req, res) => {
    try {
        const sessions = await activityService.getLiveSessions();

        // Also get idle staff (clocked in, no active session)
        const [idleStaff] = await pool.query(`
            SELECT a.user_id, u.full_name, u.branch_id, b.name as branch_name,
                   a.clock_in_time,
                   (SELECT MAX(ended_at) FROM staff_activity_sessions
                    WHERE user_id = a.user_id AND DATE(started_at) = CURDATE()) as last_activity_ended
            FROM staff_attendance a
            JOIN users u ON u.id = a.user_id
            LEFT JOIN branches b ON b.id = u.branch_id
            WHERE a.date = CURDATE()
              AND a.clock_in_time IS NOT NULL
              AND a.clock_out_time IS NULL
              AND NOT EXISTS (
                  SELECT 1 FROM staff_activity_sessions
                  WHERE user_id = a.user_id AND ended_at IS NULL
              )
        `);

        const idle = idleStaff.map(s => {
            const idleSince = s.last_activity_ended || s.clock_in_time;
            return {
                ...s,
                idle_since: idleSince,
                idle_minutes: Math.round((Date.now() - new Date(idleSince).getTime()) / 60000)
            };
        });

        res.json({ success: true, active: sessions, idle, config: activityService.ACTIVITY_CONFIG });
    } catch (error) {
        console.error('[ActivityTracker] Admin live error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /admin/staff/:id/timeline — staff member's day timeline
router.get('/admin/staff/:id/timeline', requireAuth, requirePermission('attendance', 'view'), async (req, res) => {
    try {
        const staffId = parseInt(req.params.id);
        const date = req.query.date || new Date().toISOString().split('T')[0];
        const timeline = await activityService.getStaffTimeline(staffId, date);
        res.json({ success: true, timeline, config: activityService.ACTIVITY_CONFIG });
    } catch (error) {
        console.error('[ActivityTracker] Staff timeline error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// GET /admin/summary — day summary
router.get('/admin/summary', requireAuth, requirePermission('attendance', 'view'), async (req, res) => {
    try {
        const date = req.query.date || new Date().toISOString().split('T')[0];
        const branchId = req.query.branch_id || null;
        const summary = await activityService.getDaySummary(date, branchId);
        res.json({ success: true, summary, config: activityService.ACTIVITY_CONFIG });
    } catch (error) {
        console.error('[ActivityTracker] Summary error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// POST /admin/send-reminder/:userId — admin sends manual reminder to idle staff
router.post('/admin/send-reminder/:userId', requireAuth, requirePermission('attendance', 'view'), async (req, res) => {
    try {
        const targetUserId = parseInt(req.params.userId);
        if (activityService.notificationService) {
            // Use the injected notification service through the module
        }
        // Direct notification send
        const notificationService = require('../services/notification-service');
        await notificationService.send(targetUserId, {
            type: 'activity_admin_reminder',
            title: 'Activity Reminder',
            body: 'Admin is checking — please update your current activity.',
            data: { type: 'activity_admin_reminder', priority: 'normal' }
        });
        res.json({ success: true, message: 'Reminder sent' });
    } catch (error) {
        console.error('[ActivityTracker] Send reminder error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = { router, setPool, setIO, setActivityService };
```

**Step 3: Commit**

```bash
git add routes/activity-tracker.js config/uploads.js
git commit -m "feat: add activity tracker routes with photo upload and admin endpoints"
```

---

### Task 4: Wire Up in server.js

**Files:**
- Modify: `server.js`

**Context:** Routes are mounted via `app.use('/api/activity-tracker', ...)`. Services get pool/IO injected. The geofence cron already runs every 60s — add idle detection to the same interval.

**Step 1: Import and inject the service + routes**

Find where other services are imported (around lines 60-80) and add:

```javascript
const activityTrackerService = require('./services/activity-tracker-service');
```

Find where other routes are imported (around lines 90-120) and add:

```javascript
const activityTrackerRoutes = require('./routes/activity-tracker');
```

Find where `setPool` is called on services (around lines 167-200) and add:

```javascript
activityTrackerService.setPool(pool);
activityTrackerService.setNotificationService(notificationService);
```

Find where `setIO` is called on services (after Socket.io setup, around lines 3580-3600) and add:

```javascript
activityTrackerService.setIO(io);
activityTrackerRoutes.setIO(io);
```

Find where `setPool` is called on routes (around lines 200-230) and add:

```javascript
activityTrackerRoutes.setPool(pool);
activityTrackerRoutes.setActivityService(activityTrackerService);
```

Find where routes are mounted (around lines 249-280) and add:

```javascript
app.use('/api/activity-tracker', activityTrackerRoutes.router);
```

**Step 2: Add idle detection to the geofence cron**

Find the geofence cron `setInterval` (around line 3717). At the END of the interval callback (just before the closing `}` of the interval function), add:

```javascript
        // Activity tracker idle detection
        try {
            await activityTrackerService.checkIdleStaff();
        } catch (err) {
            console.error('[ActivityTracker Cron] Idle check error:', err.message);
        }
```

**Step 3: Auto-end activity on attendance events**

Find the clock-out endpoint in `routes/attendance.js` (search for `clock_out_time`). Before the clock-out UPDATE query, add:

```javascript
// Auto-end any active activity session
const activityTrackerService = require('../services/activity-tracker-service');
await activityTrackerService.endActiveSession(userId, true);
```

Similarly for break-start, outside-work-start, and prayer-start — add `endActiveSession(userId, true)` before those respective updates. This auto-ends the activity when staff starts a break/outside/prayer.

**Step 4: Commit**

```bash
git add server.js routes/attendance.js
git commit -m "feat: wire up activity tracker service, routes, and cron in server.js"
```

---

### Task 5: Staff Dashboard — Activity Selector UI

**Files:**
- Modify: `public/staff/dashboard.html`

**Context:** The dashboard uses vanilla JS with Tailwind CSS. Staff brand colors: `#1B5E3B` primary, `#154D31` gradient. After clock-in, `showClockedInState(data)` is called. The existing daily tasks card is around lines 771-795. Activity selector should appear prominently ABOVE the daily tasks card when clocked in.

**Step 1: Add the Activity Selector HTML**

Insert after the attendance controls section (after the time breakdown card, before the daily tasks card). Add this HTML block:

```html
<!-- Activity Tracker Card -->
<div id="activityTrackerCard" style="display:none;" class="mb-4">
    <!-- Activity Selector (shown when no active activity) -->
    <div id="activitySelector" class="bg-white rounded-2xl shadow-lg border border-green-100 p-4">
        <h3 class="text-base font-bold text-gray-800 mb-3" id="activityPrompt">What are you going to do now?</h3>
        <div class="grid grid-cols-2 gap-3" id="activityButtons">
            <button onclick="startActivity('marketing')" class="activity-btn flex flex-col items-center gap-1 p-3 rounded-xl border-2 border-gray-200 hover:border-green-500 hover:bg-green-50 transition-all">
                <span class="text-2xl">📢</span>
                <span class="text-xs font-semibold text-gray-700">Marketing<br>Lead Work</span>
            </button>
            <button onclick="startActivity('outstanding_followup')" class="activity-btn flex flex-col items-center gap-1 p-3 rounded-xl border-2 border-gray-200 hover:border-green-500 hover:bg-green-50 transition-all">
                <span class="text-2xl">💰</span>
                <span class="text-xs font-semibold text-gray-700">Outstanding<br>Follow-up</span>
            </button>
            <button onclick="startActivity('material_arrangement')" class="activity-btn flex flex-col items-center gap-1 p-3 rounded-xl border-2 border-gray-200 hover:border-green-500 hover:bg-green-50 transition-all">
                <span class="text-2xl">📦</span>
                <span class="text-xs font-semibold text-gray-700">Material<br>Arrangement</span>
            </button>
            <button onclick="startActivity('material_receiving')" class="activity-btn flex flex-col items-center gap-1 p-3 rounded-xl border-2 border-gray-200 hover:border-green-500 hover:bg-green-50 transition-all">
                <span class="text-2xl">🚛</span>
                <span class="text-xs font-semibold text-gray-700">Material<br>Receiving</span>
            </button>
            <button onclick="promptAttendingCustomer()" class="activity-btn flex flex-col items-center gap-1 p-3 rounded-xl border-2 border-gray-200 hover:border-green-500 hover:bg-green-50 transition-all">
                <span class="text-2xl">🤝</span>
                <span class="text-xs font-semibold text-gray-700">Attending<br>Customer</span>
            </button>
            <button onclick="startActivity('shop_maintenance')" class="activity-btn flex flex-col items-center gap-1 p-3 rounded-xl border-2 border-gray-200 hover:border-green-500 hover:bg-green-50 transition-all">
                <span class="text-2xl">🧹</span>
                <span class="text-xs font-semibold text-gray-700">Shop<br>Maintenance</span>
            </button>
        </div>
    </div>

    <!-- Active Activity Display (shown when activity is running) -->
    <div id="activeActivityCard" style="display:none;" class="bg-gradient-to-r from-green-800 to-green-900 rounded-2xl shadow-lg p-4 text-white">
        <div class="flex items-center justify-between mb-2">
            <div>
                <div class="text-xs text-green-200">Currently doing</div>
                <div class="text-lg font-bold" id="activeActivityLabel">—</div>
            </div>
            <div class="text-right">
                <div class="text-2xl font-mono font-bold" id="activeActivityTimer">00:00:00</div>
                <div class="text-xs text-green-200" id="activeActivityStarted">Started --:--</div>
            </div>
        </div>
        <div class="flex gap-2 mt-3">
            <button onclick="showActivitySelector()" class="flex-1 py-2 px-3 bg-white/20 hover:bg-white/30 rounded-lg text-sm font-semibold transition-all">Switch Activity</button>
            <button onclick="stopCurrentActivity()" id="stopActivityBtn" class="flex-1 py-2 px-3 bg-red-500/80 hover:bg-red-500 rounded-lg text-sm font-semibold transition-all">Stop</button>
        </div>
    </div>

    <!-- Today's Activity Timeline -->
    <div id="activityTimeline" class="mt-3 bg-white rounded-2xl shadow border border-green-100 p-4" style="display:none;">
        <h4 class="text-sm font-bold text-gray-700 mb-2">Today's Timeline</h4>
        <div id="activityTimelineBody" class="space-y-2 text-sm"></div>
    </div>
</div>

<!-- Customer Note Modal -->
<div id="customerNoteModal" style="display:none;" class="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl p-5 w-full max-w-sm">
        <h3 class="text-base font-bold text-gray-800 mb-3">Customer Details</h3>
        <input type="text" id="customerNoteInput" placeholder="Customer name or brief note" maxlength="200"
            class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:border-green-500 focus:ring-1 focus:ring-green-500 outline-none">
        <div class="flex gap-2 mt-4">
            <button onclick="closeCustomerModal()" class="flex-1 py-2 border border-gray-300 rounded-lg text-sm font-semibold text-gray-600">Cancel</button>
            <button onclick="confirmAttendingCustomer()" class="flex-1 py-2 bg-green-700 text-white rounded-lg text-sm font-semibold">Start</button>
        </div>
    </div>
</div>

<!-- Shop Maintenance Photo Modal -->
<div id="maintenancePhotoModal" style="display:none;" class="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center p-4">
    <div class="bg-white rounded-2xl p-5 w-full max-w-sm">
        <h3 class="text-base font-bold text-gray-800 mb-3">Upload Proof Photo</h3>
        <p class="text-sm text-gray-500 mb-3">Take a photo to complete shop maintenance</p>
        <input type="file" id="maintenancePhotoInput" accept="image/*" capture="environment"
            class="w-full text-sm border border-gray-300 rounded-lg p-2">
        <div class="flex gap-2 mt-4">
            <button onclick="closeMaintenanceModal()" class="flex-1 py-2 border border-gray-300 rounded-lg text-sm font-semibold text-gray-600">Cancel</button>
            <button onclick="confirmMaintenanceStop()" id="confirmMaintenanceBtn" class="flex-1 py-2 bg-green-700 text-white rounded-lg text-sm font-semibold">Complete</button>
        </div>
    </div>
</div>
```

**Step 2: Add the Activity Tracker JavaScript**

Add this script block before the closing `</body>` tag (or in the existing `<script>` block):

```javascript
// === Activity Tracker ===
let activityTimerInterval = null;
let currentActivity = null;

async function loadCurrentActivity() {
    try {
        const token = localStorage.getItem('auth_token');
        const res = await fetch('/api/activity-tracker/current', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await res.json();
        if (data.success && data.session) {
            currentActivity = data.session;
            showActiveActivity(data.session);
        } else {
            currentActivity = null;
            showActivitySelector();
        }
        document.getElementById('activityTrackerCard').style.display = 'block';
        loadActivityTimeline();
    } catch (e) {
        console.error('Load activity error:', e);
    }
}

function showActiveActivity(session) {
    document.getElementById('activitySelector').style.display = 'none';
    document.getElementById('activeActivityCard').style.display = 'block';

    const config = {
        marketing: 'Marketing / Lead Work',
        outstanding_followup: 'Outstanding Follow-up',
        material_arrangement: 'Material Arrangement',
        material_receiving: 'Material Receiving & Billing',
        attending_customer: 'Attending Customer',
        shop_maintenance: 'Shop Maintenance'
    };

    document.getElementById('activeActivityLabel').textContent = config[session.activity_type] || session.activity_type;
    const startTime = new Date(session.started_at);
    document.getElementById('activeActivityStarted').textContent = 'Started ' + startTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

    // Start timer
    clearInterval(activityTimerInterval);
    activityTimerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime.getTime()) / 1000);
        const h = String(Math.floor(elapsed / 3600)).padStart(2, '0');
        const m = String(Math.floor((elapsed % 3600) / 60)).padStart(2, '0');
        const s = String(elapsed % 60).padStart(2, '0');
        document.getElementById('activeActivityTimer').textContent = `${h}:${m}:${s}`;
    }, 1000);
}

function showActivitySelector() {
    document.getElementById('activeActivityCard').style.display = 'none';
    document.getElementById('activitySelector').style.display = 'block';
    clearInterval(activityTimerInterval);
}

async function startActivity(type, metadata) {
    try {
        const token = localStorage.getItem('auth_token');
        const res = await fetch('/api/activity-tracker/start', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, metadata })
        });
        const data = await res.json();
        if (data.success) {
            currentActivity = { activity_type: type, started_at: data.startedAt };
            showActiveActivity(currentActivity);
            loadActivityTimeline();
            if (data.redirect) {
                // Navigate after short delay so user sees the transition
                setTimeout(() => { window.location.href = data.redirect; }, 300);
            }
        } else {
            alert(data.error || 'Failed to start activity');
        }
    } catch (e) {
        console.error('Start activity error:', e);
        alert('Failed to start activity');
    }
}

function promptAttendingCustomer() {
    document.getElementById('customerNoteModal').style.display = 'flex';
    document.getElementById('customerNoteInput').value = '';
    document.getElementById('customerNoteInput').focus();
}

function closeCustomerModal() {
    document.getElementById('customerNoteModal').style.display = 'none';
}

function confirmAttendingCustomer() {
    const note = document.getElementById('customerNoteInput').value.trim();
    if (!note) { alert('Please enter customer details'); return; }
    closeCustomerModal();
    startActivity('attending_customer', { customer_note: note });
}

async function stopCurrentActivity() {
    if (!currentActivity) return;

    // Shop maintenance requires photo
    if (currentActivity.activity_type === 'shop_maintenance') {
        document.getElementById('maintenancePhotoModal').style.display = 'flex';
        return;
    }

    try {
        const token = localStorage.getItem('auth_token');
        const res = await fetch('/api/activity-tracker/stop', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        const data = await res.json();
        if (data.success) {
            currentActivity = null;
            showActivitySelector();
            loadActivityTimeline();
        }
    } catch (e) {
        console.error('Stop activity error:', e);
    }
}

function closeMaintenanceModal() {
    document.getElementById('maintenancePhotoModal').style.display = 'none';
}

async function confirmMaintenanceStop() {
    const fileInput = document.getElementById('maintenancePhotoInput');
    if (!fileInput.files || !fileInput.files[0]) {
        alert('Please take a photo first');
        return;
    }

    const btn = document.getElementById('confirmMaintenanceBtn');
    btn.disabled = true;
    btn.textContent = 'Uploading...';

    try {
        const token = localStorage.getItem('auth_token');
        const formData = new FormData();
        formData.append('photo', fileInput.files[0]);

        const res = await fetch('/api/activity-tracker/stop-with-photo', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token },
            body: formData
        });
        const data = await res.json();
        if (data.success) {
            closeMaintenanceModal();
            currentActivity = null;
            showActivitySelector();
            loadActivityTimeline();
        } else {
            alert(data.error || 'Failed to complete');
        }
    } catch (e) {
        console.error('Maintenance stop error:', e);
        alert('Failed to upload photo');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Complete';
    }
}

async function loadActivityTimeline() {
    try {
        const token = localStorage.getItem('auth_token');
        const res = await fetch('/api/activity-tracker/today', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await res.json();
        if (!data.success || !data.timeline || data.timeline.length === 0) {
            document.getElementById('activityTimeline').style.display = 'none';
            return;
        }

        const labels = {
            marketing: '📢 Marketing', outstanding_followup: '💰 Outstanding',
            material_arrangement: '📦 Material Arrange', material_receiving: '🚛 Material Receiving',
            attending_customer: '🤝 Customer', shop_maintenance: '🧹 Maintenance'
        };

        const html = data.timeline.map(s => {
            const start = new Date(s.started_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            const label = labels[s.activity_type] || s.activity_type;
            let meta = '';
            try {
                const m = typeof s.metadata === 'string' ? JSON.parse(s.metadata || '{}') : (s.metadata || {});
                if (m.customer_note) meta = `<div class="text-xs text-gray-400">"${m.customer_note}"</div>`;
                if (m.photos) meta += '<span class="text-xs text-green-600">📷</span>';
            } catch(e) {}

            if (s.ended_at) {
                return `<div class="flex items-start gap-2">
                    <div class="text-xs text-gray-400 w-14 shrink-0">${start}</div>
                    <div class="w-2 h-2 rounded-full bg-green-500 mt-1.5 shrink-0"></div>
                    <div>
                        <div class="font-medium text-gray-700">${label} <span class="text-gray-400">(${s.duration_minutes || 0}m)</span></div>
                        ${meta}
                    </div>
                </div>`;
            } else {
                return `<div class="flex items-start gap-2">
                    <div class="text-xs text-gray-400 w-14 shrink-0">${start}</div>
                    <div class="w-2 h-2 rounded-full bg-green-500 mt-1.5 shrink-0 animate-pulse"></div>
                    <div>
                        <div class="font-medium text-green-700">${label} <span class="text-green-500 text-xs">(active)</span></div>
                        ${meta}
                    </div>
                </div>`;
            }
        }).join('');

        document.getElementById('activityTimelineBody').innerHTML = html;
        document.getElementById('activityTimeline').style.display = 'block';
    } catch (e) {
        console.error('Load timeline error:', e);
    }
}

// Call loadCurrentActivity when clocked-in state is shown
// Add to showClockedInState(): loadCurrentActivity();
// Add to showClockedOutState(): document.getElementById('activityTrackerCard').style.display = 'none';

// After break/prayer/outside ends, show selector again
// Add to break-end/prayer-end/outside-end handlers:
// document.getElementById('activityPrompt').textContent = "You're back! What are you going to do now?";
// showActivitySelector();
// loadCurrentActivity();
```

**Step 3: Hook into existing attendance states**

In `showClockedInState(data)` function, add at the end:
```javascript
loadCurrentActivity();
```

In `showClockedOutState(data)` function, add:
```javascript
document.getElementById('activityTrackerCard').style.display = 'none';
clearInterval(activityTimerInterval);
```

In break-end, prayer-end, outside-end success handlers, add:
```javascript
document.getElementById('activityPrompt').textContent = "You're back! What are you going to do now?";
loadCurrentActivity();
```

**Step 4: Commit**

```bash
git add public/staff/dashboard.html
git commit -m "feat: add activity selector UI, timer, timeline, and modals to staff dashboard"
```

---

### Task 6: Admin Activity Monitor Page

**Files:**
- Create: `public/admin-activity-monitor.html`

**Context:** Admin pages use the design system from `public/css/design-system.css`, `universal-nav-loader.js` for navigation, admin brand colors (`#667eea`/`#764ba2`). Follow pattern from `admin-attendance.html` for layout and auth. Socket.io for live updates.

**Step 1: Create the admin activity monitor page**

Create `public/admin-activity-monitor.html` with:
- Navigation via `universal-nav-loader.js` with `data-page="attendance"`
- Summary cards row: Active count, Idle count, On Break count, per-activity-type counts
- Staff cards grid: each card shows name, branch, current activity with icon, elapsed time, key metadata
- Idle staff cards with amber border and "Send Reminder" button
- Day summary section with per-staff time breakdown table
- Socket.io listeners for `activity_tracker_update` and `activity_tracker_idle`
- 30s auto-refresh fallback via `setInterval(loadLiveData, 30000)`
- Date picker and branch filter
- `getAuthHeaders()` pattern for API calls
- `escapeHtml()` for XSS prevention

Key functions:
- `loadLiveData()` — fetches `/api/activity-tracker/admin/live`, renders active + idle cards
- `loadDaySummary()` — fetches `/api/activity-tracker/admin/summary?date=...`, renders table
- `sendReminder(userId)` — POST to `/api/activity-tracker/admin/send-reminder/:userId`
- `viewStaffTimeline(userId)` — modal/slideout showing `/api/activity-tracker/admin/staff/:id/timeline`
- Socket.io: `socket.on('activity_tracker_update', ...)` updates card in-place
- Socket.io: `socket.on('activity_tracker_idle', ...)` adds/updates idle card

Page must include `<script src="/socket.io/socket.io.js"></script>` and connect with auth token.

Staff cards layout:
```html
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4" id="staffCardsGrid">
    <!-- Active staff card -->
    <div class="bg-white rounded-xl border-l-4 border-green-500 p-4 shadow-sm">
        <div class="flex justify-between items-start">
            <div>
                <div class="font-bold text-gray-800">Rajesh</div>
                <div class="text-xs text-gray-400">Main Branch</div>
            </div>
            <div class="text-right">
                <div class="text-sm font-mono font-bold text-green-600">45m</div>
            </div>
        </div>
        <div class="mt-2 flex items-center gap-2">
            <span class="text-lg">📢</span>
            <span class="text-sm font-semibold text-green-700">Marketing / Lead Work</span>
        </div>
    </div>

    <!-- Idle staff card -->
    <div class="bg-white rounded-xl border-l-4 border-amber-500 p-4 shadow-sm">
        <div class="flex justify-between items-start">
            <div>
                <div class="font-bold text-gray-800">Priya</div>
                <div class="text-xs text-gray-400">Main Branch</div>
            </div>
            <div class="text-right">
                <span class="bg-amber-100 text-amber-700 text-xs font-bold px-2 py-0.5 rounded-full">IDLE 18m</span>
            </div>
        </div>
        <div class="mt-2">
            <button onclick="sendReminder(userId)" class="text-xs bg-amber-500 text-white px-3 py-1 rounded-lg hover:bg-amber-600">Send Reminder</button>
        </div>
    </div>
</div>
```

**Full page is standard admin layout — implement based on above spec. Use admin brand colors for header, green for active activity, amber for idle.**

**Step 2: Add to navigation**

In `server.js`, find the `SUBNAV_MAP` or nav configuration and add a link to `admin-activity-monitor.html` under the Attendance section. The nav link text should be "Activity Monitor".

**Step 3: Commit**

```bash
git add public/admin-activity-monitor.html
git commit -m "feat: add admin activity monitor page with live staff cards and idle alerts"
```

---

### Task 7: Admin Attendance Page — Activity Column

**Files:**
- Modify: `public/admin-attendance.html`

**Context:** The attendance table renders staff rows with columns: Name, Branch, Clock In, Clock Out, Break, Working, Distance, Status, Late, Actions. Add a "Current Activity" column after "Status".

**Step 1: Modify the table**

In the table header `<thead>`, add after the Status column:
```html
<th>Current Activity</th>
```

In the `loadLiveAttendance()` function where rows are rendered, fetch activity data. Two approaches:
- **Option A (simple):** After loading attendance, make a second fetch to `/api/activity-tracker/admin/live` and merge by `user_id`
- **Option B (backend):** Modify the attendance report endpoint to LEFT JOIN with active sessions

Use Option A for simplicity. After `tbody.innerHTML = rows.map(...)`:

```javascript
// Fetch active activities and merge
try {
    const actRes = await fetch('/api/activity-tracker/admin/live', { headers: getAuthHeaders() });
    const actData = await actRes.json();
    if (actData.success) {
        const activeMap = {};
        (actData.active || []).forEach(s => { activeMap[s.user_id] = s; });
        const idleMap = {};
        (actData.idle || []).forEach(s => { idleMap[s.user_id] = s; });

        const activityIcons = {
            marketing: '📢', outstanding_followup: '💰', material_arrangement: '📦',
            material_receiving: '🚛', attending_customer: '🤝', shop_maintenance: '🧹'
        };

        rows.forEach((r, i) => {
            const cell = tbody.rows[i]?.querySelector('.activity-cell');
            if (!cell) return;
            if (activeMap[r.user_id]) {
                const a = activeMap[r.user_id];
                cell.innerHTML = `<span class="text-green-600 font-semibold">${activityIcons[a.activity_type] || ''} ${a.elapsed_minutes}m</span>`;
            } else if (idleMap[r.user_id] && !r.clock_out_time) {
                const idle = idleMap[r.user_id];
                cell.innerHTML = idle.idle_minutes >= 15
                    ? `<span class="text-amber-600 font-semibold">⚠️ Idle ${idle.idle_minutes}m</span>`
                    : `<span class="text-gray-400">—</span>`;
            } else {
                cell.innerHTML = '<span class="text-gray-400">—</span>';
            }
        });
    }
} catch(e) { console.error('Activity merge error:', e); }
```

Add `class="activity-cell"` to the activity `<td>` in the row template.

**Step 2: Commit**

```bash
git add public/admin-attendance.html
git commit -m "feat: add current activity column to admin attendance table"
```

---

### Task 8: Auto-End on Break/Outside/Prayer + Activity Feed Icons

**Files:**
- Modify: `routes/attendance.js` — add `endActiveSession` calls
- Modify: `services/activity-feed.js` — add new activity icons

**Context:** When staff starts a break, outside work, or prayer, their active activity session must auto-end. The `endActiveSession` function is in `services/activity-tracker-service.js`. Also add `activity_started` and `activity_completed` icons to the activity feed config.

**Step 1: Add endActiveSession calls in attendance.js**

In the break-start handler (search for `break_start` in attendance.js), add before the break_start UPDATE:
```javascript
const activityTrackerService = require('../services/activity-tracker-service');
await activityTrackerService.endActiveSession(userId, true);
```

Repeat for:
- Outside work start handler (search for `outside_work_periods`)
- Prayer start handler (search for `prayer_periods`)
- Clock-out handler (if not done in Task 4)
- Max-hours auto-clockout (in server.js cron)

**Step 2: Add activity feed icons**

In `services/activity-feed.js`, add to the `ACTIVITY_ICONS` object:
```javascript
activity_started:   { icon: 'ACT', color: '#1B5E3B' },
activity_completed: { icon: 'DON', color: '#059669' },
```

**Step 3: Commit**

```bash
git add routes/attendance.js services/activity-feed.js
git commit -m "feat: auto-end activity on break/outside/prayer + activity feed icons"
```

---

### Task 9: Deploy and Test

**Step 1: Push to origin**

```bash
git push origin master
```

**Step 2: Deploy to production**

```bash
ssh root@161.97.114.189 "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && node migrations/migrate-activity-tracker.js && npm install && pm2 restart business-manager"
```

**Step 3: Verify**

1. Login as staff on mobile
2. Clock in → verify "What are you going to do now?" card appears
3. Tap "Marketing" → verify timer starts, navigates to leads page
4. Return to dashboard → verify active timer shows
5. Tap "Switch Activity" → verify previous ends, new starts
6. Tap "Attending Customer" → verify customer note modal appears
7. Tap "Shop Maintenance" → start → "Stop" → verify photo modal appears
8. Login as admin → check admin-attendance.html for activity column
9. Navigate to Activity Monitor page → verify live cards
10. Wait 15 minutes with no activity → verify FCM idle alert arrives

**Step 4: Commit any fixes**

```bash
git commit -m "fix: activity tracker deployment fixes"
```
