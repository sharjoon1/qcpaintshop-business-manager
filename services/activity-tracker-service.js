/**
 * STAFF ACTIVITY TRACKER SERVICE
 * Core business logic for tracking what staff are working on throughout the day.
 * Handles session start/stop, idle detection, daily task auto-completion, and live monitoring.
 */

const activityFeed = require('./activity-feed');

let pool;
let io;
let notificationService;

function setPool(dbPool) { pool = dbPool; }
function setIO(socketIO) { io = socketIO; }
function setNotificationService(ns) { notificationService = ns; }

// ── Activity type configuration ──────────────────────────────────────────────
const ACTIVITY_CONFIG = {
    marketing:            { label: 'Marketing / Lead Work',        redirect: '/staff-leads.html',        icon: 'MKT', color: '#8b5cf6', dailyTaskSection: 'marketing' },
    outstanding_followup: { label: 'Outstanding Follow-up',        redirect: '/staff/collections.html', icon: 'OUT', color: '#f59e0b', dailyTaskSection: 'outstanding' },
    material_arrangement: { label: 'Material Arrangement',         redirect: null,                      icon: 'MAT', color: '#0891b2', dailyTaskSection: null },
    material_receiving:   { label: 'Material Receiving & Billing', redirect: '/staff/daily-tasks.html', icon: 'RCV', color: '#059669', dailyTaskSection: 'material' },
    attending_customer:   { label: 'Attending Customer',           redirect: null,                      icon: 'CUS', color: '#6366f1', dailyTaskSection: 'sales' },
    shop_maintenance:     { label: 'Shop Maintenance',             redirect: null,                      icon: 'SHP', color: '#10b981', dailyTaskSection: 'morning' }
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function parseMeta(m) {
    if (!m) return {};
    try { return typeof m === 'string' ? JSON.parse(m) : m; } catch (e) { return {}; }
}

function broadcast(userId, branchId, activityType, action, extra = {}) {
    if (!io) return;
    const config = ACTIVITY_CONFIG[activityType] || {};
    io.emit('activity_tracker_update', {
        userId,
        branchId,
        activityType,
        action,
        label: config.label || activityType,
        ...extra
    });
}

// ── Core functions ───────────────────────────────────────────────────────────

/**
 * Start an activity session. Auto-ends any previous active session.
 */
async function startActivity(userId, branchId, activityType, metadata = {}) {
    if (!pool) throw new Error('Pool not initialized');

    const config = ACTIVITY_CONFIG[activityType];
    if (!config) throw new Error(`Unknown activity type: ${activityType}`);

    // Auto-end any active session first
    const previousEnded = await endActiveSession(userId, true);

    // Clear recent idle alerts for this user (they're now active)
    await pool.query(
        `UPDATE staff_idle_alerts SET responded_at = NOW() WHERE user_id = ? AND responded_at IS NULL`,
        [userId]
    );

    // Insert new session
    const meta = parseMeta(metadata);
    const [result] = await pool.query(
        `INSERT INTO staff_activity_sessions (user_id, branch_id, activity_type, started_at, metadata)
         VALUES (?, ?, ?, NOW(), ?)`,
        [userId, branchId, activityType, JSON.stringify(meta)]
    );

    // Log to activity feed
    activityFeed.logActivity(userId, branchId, 'activity_started', `Started: ${config.label}`, null, 'all');

    // Broadcast
    broadcast(userId, branchId, activityType, 'started');

    return {
        sessionId: result.insertId,
        activityType,
        label: config.label,
        redirect: config.redirect,
        startedAt: new Date(),
        previousEnded
    };
}

/**
 * Stop the current active session for a user.
 */
async function stopActivity(userId, metadata = {}, photos = null) {
    if (!pool) throw new Error('Pool not initialized');

    // Find active session
    const [sessions] = await pool.query(
        `SELECT * FROM staff_activity_sessions WHERE user_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
        [userId]
    );

    if (sessions.length === 0) {
        return { stopped: false, sessionId: null, duration: 0 };
    }

    const session = sessions[0];
    const existingMeta = parseMeta(session.metadata);
    const newMeta = parseMeta(metadata);

    // Merge metadata: existing + new + photos
    const mergedMeta = { ...existingMeta, ...newMeta };
    if (photos && photos.length > 0) {
        mergedMeta.photos = [...(existingMeta.photos || []), ...photos];
    }

    // End the session
    await pool.query(
        `UPDATE staff_activity_sessions
         SET ended_at = NOW(),
             duration_minutes = TIMESTAMPDIFF(MINUTE, started_at, NOW()),
             metadata = ?,
             auto_ended = 0
         WHERE id = ?`,
        [JSON.stringify(mergedMeta), session.id]
    );

    // Get the duration
    const [updated] = await pool.query(
        `SELECT duration_minutes FROM staff_activity_sessions WHERE id = ?`,
        [session.id]
    );
    const duration = updated[0]?.duration_minutes || 0;

    // Auto-complete daily task if applicable
    await autoCompleteDailyTask(userId, session.activity_type, mergedMeta);

    // Log to activity feed
    const config = ACTIVITY_CONFIG[session.activity_type] || {};
    activityFeed.logActivity(
        userId, session.branch_id,
        'activity_ended',
        `Ended: ${config.label || session.activity_type} (${duration} min)`,
        null, 'all'
    );

    // Broadcast
    broadcast(userId, session.branch_id, session.activity_type, 'stopped', { duration });

    return { stopped: true, sessionId: session.id, duration };
}

/**
 * End the active session for a user (internal helper, used by startActivity and external callers).
 */
async function endActiveSession(userId, autoEnded = true) {
    if (!pool) return false;

    const [sessions] = await pool.query(
        `SELECT * FROM staff_activity_sessions WHERE user_id = ? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`,
        [userId]
    );

    if (sessions.length === 0) return false;

    const session = sessions[0];

    await pool.query(
        `UPDATE staff_activity_sessions
         SET ended_at = NOW(),
             duration_minutes = TIMESTAMPDIFF(MINUTE, started_at, NOW()),
             auto_ended = ?
         WHERE id = ?`,
        [autoEnded ? 1 : 0, session.id]
    );

    // Auto-complete daily task
    const meta = parseMeta(session.metadata);
    await autoCompleteDailyTask(userId, session.activity_type, meta);

    // Broadcast
    broadcast(userId, session.branch_id, session.activity_type, autoEnded ? 'auto_ended' : 'ended');

    return true;
}

/**
 * Get the current active session for a user.
 */
async function getCurrentSession(userId) {
    if (!pool) return null;

    const [rows] = await pool.query(
        `SELECT s.*, u.full_name,
                TIMESTAMPDIFF(MINUTE, s.started_at, NOW()) AS elapsed_minutes
         FROM staff_activity_sessions s
         JOIN users u ON s.user_id = u.id
         WHERE s.user_id = ? AND s.ended_at IS NULL
         ORDER BY s.started_at DESC LIMIT 1`,
        [userId]
    );

    return rows.length > 0 ? rows[0] : null;
}

/**
 * Get today's activity timeline for a user.
 */
async function getTodayTimeline(userId) {
    if (!pool) return [];

    const [rows] = await pool.query(
        `SELECT s.*,
                TIMESTAMPDIFF(MINUTE, s.started_at, COALESCE(s.ended_at, NOW())) AS elapsed_minutes
         FROM staff_activity_sessions s
         WHERE s.user_id = ? AND DATE(s.started_at) = CURDATE()
         ORDER BY s.started_at`,
        [userId]
    );

    return rows;
}

/**
 * Get all currently active (live) sessions across all staff.
 */
async function getLiveSessions() {
    if (!pool) return [];

    const [rows] = await pool.query(
        `SELECT s.*, u.full_name, u.branch_id AS user_branch_id,
                b.name AS branch_name,
                TIMESTAMPDIFF(MINUTE, s.started_at, NOW()) AS elapsed_minutes
         FROM staff_activity_sessions s
         JOIN users u ON s.user_id = u.id
         LEFT JOIN branches b ON s.branch_id = b.id
         WHERE s.ended_at IS NULL
         ORDER BY s.started_at DESC`
    );

    return rows;
}

/**
 * Get activity timeline for a specific staff member on a specific date.
 */
async function getStaffTimeline(staffId, date) {
    if (!pool) return [];

    const [rows] = await pool.query(
        `SELECT s.*,
                TIMESTAMPDIFF(MINUTE, s.started_at, COALESCE(s.ended_at, NOW())) AS elapsed_minutes
         FROM staff_activity_sessions s
         WHERE s.user_id = ? AND DATE(s.started_at) = ?
         ORDER BY s.started_at`,
        [staffId, date]
    );

    return rows;
}

/**
 * Get day summary: grouped by user + activity type with total duration.
 */
async function getDaySummary(date, branchId = null) {
    if (!pool) return [];

    let query = `
        SELECT s.user_id, u.full_name, s.activity_type,
               COUNT(*) AS session_count,
               SUM(COALESCE(s.duration_minutes, TIMESTAMPDIFF(MINUTE, s.started_at, NOW()))) AS total_minutes
        FROM staff_activity_sessions s
        JOIN users u ON s.user_id = u.id
        WHERE DATE(s.started_at) = ?
    `;
    const params = [date];

    if (branchId != null) {
        query += ` AND s.branch_id = ?`;
        params.push(branchId);
    }

    query += ` GROUP BY s.user_id, u.full_name, s.activity_type ORDER BY u.full_name, s.activity_type`;

    const [rows] = await pool.query(query, params);
    return rows;
}

// ── Private: auto-complete daily task ────────────────────────────────────────

/**
 * Maps activity completion to daily task responses.
 * Only inserts if no existing response for today + user + template.
 */
async function autoCompleteDailyTask(userId, activityType, metadata = {}) {
    if (!pool) return;

    const config = ACTIVITY_CONFIG[activityType];
    if (!config || !config.dailyTaskSection) return;

    const meta = parseMeta(metadata);

    // Condition checks per activity type
    if (activityType === 'outstanding_followup' && (!meta.amount_collected || meta.amount_collected <= 0)) return;
    if (activityType === 'shop_maintenance' && (!meta.photos || meta.photos.length === 0)) return;

    try {
        // Find matching template by section
        const [templates] = await pool.query(
            `SELECT id FROM daily_task_templates WHERE section = ? AND is_active = TRUE LIMIT 1`,
            [config.dailyTaskSection]
        );

        if (templates.length === 0) return;

        const templateId = templates[0].id;
        const today = new Date();
        const taskDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

        // Only insert if no existing response
        const [existing] = await pool.query(
            `SELECT id FROM daily_task_responses WHERE user_id = ? AND task_date = ? AND template_id = ?`,
            [userId, taskDate, templateId]
        );

        if (existing.length > 0) return; // Already responded, don't overwrite

        await pool.query(
            `INSERT INTO daily_task_responses (user_id, task_date, template_id, answer, details)
             VALUES (?, ?, ?, 'yes', ?)
             ON DUPLICATE KEY UPDATE answer = answer`,
            [userId, taskDate, templateId, JSON.stringify({ auto_completed: true, from_activity: activityType, metadata: meta })]
        );

        console.log(`[ActivityTracker] Auto-completed daily task (section=${config.dailyTaskSection}) for user ${userId}`);
    } catch (e) {
        console.error('[ActivityTracker] autoCompleteDailyTask error:', e.message);
    }
}

// ── Idle staff detection (called by cron every 60s) ──────────────────────────

/**
 * Check for idle staff: clocked in but no active activity session.
 * 15min idle → alert staff. 30min idle → alert admins too.
 */
async function checkIdleStaff() {
    if (!pool) return;

    try {
        // Find clocked-in staff with no active session, not on break/outside/prayer
        const [idleStaff] = await pool.query(`
            SELECT a.user_id, a.branch_id, a.clock_in_time, u.full_name,
                (SELECT MAX(s.ended_at) FROM staff_activity_sessions s
                 WHERE s.user_id = a.user_id AND DATE(s.started_at) = CURDATE()
                ) AS last_activity_ended,
                (SELECT MAX(ia.alert_sent_at) FROM staff_idle_alerts ia
                 WHERE ia.user_id = a.user_id AND DATE(ia.alert_sent_at) = CURDATE()
                ) AS last_alert_sent
            FROM staff_attendance a
            JOIN users u ON a.user_id = u.id
            WHERE a.date = CURDATE()
              AND a.clock_out_time IS NULL
              AND (a.break_start_time IS NULL OR a.break_end_time IS NOT NULL)
              AND NOT EXISTS (
                  SELECT 1 FROM staff_activity_sessions s2
                  WHERE s2.user_id = a.user_id AND s2.ended_at IS NULL
              )
              AND NOT EXISTS (
                  SELECT 1 FROM outside_work_periods ow
                  WHERE ow.user_id = a.user_id AND ow.status = 'active'
              )
              AND NOT EXISTS (
                  SELECT 1 FROM prayer_periods pp
                  WHERE pp.user_id = a.user_id AND pp.status = 'active'
              )
        `);

        for (const staff of idleStaff) {
            // Calculate idle minutes from last activity end or clock-in
            const referenceTime = staff.last_activity_ended || staff.clock_in_time;
            const idleMinutes = Math.floor((Date.now() - new Date(referenceTime).getTime()) / 60000);

            // Check if we recently sent an alert (within 30 min)
            if (staff.last_alert_sent) {
                const minutesSinceAlert = Math.floor((Date.now() - new Date(staff.last_alert_sent).getTime()) / 60000);
                if (minutesSinceAlert < 30) continue;
            }

            if (idleMinutes >= 15) {
                // Record the alert
                await pool.query(
                    `INSERT INTO staff_idle_alerts (user_id, idle_started_at, alert_sent_at, idle_minutes)
                     VALUES (?, ?, NOW(), ?)`,
                    [staff.user_id, referenceTime, idleMinutes]
                );

                // Send FCM to the staff member
                if (notificationService) {
                    await notificationService.send(staff.user_id, {
                        type: 'idle_alert',
                        title: 'What are you working on?',
                        body: `You've been idle for ${idleMinutes} minutes. Please select your current activity.`,
                        data: { type: 'idle_alert', priority: 'high' }
                    });
                }

                // If 30+ min idle, also notify all active admins
                if (idleMinutes >= 30) {
                    const [admins] = await pool.query(
                        `SELECT id FROM users WHERE role IN ('admin', 'super_admin') AND status = 'active'`
                    );

                    for (const admin of admins) {
                        if (notificationService) {
                            await notificationService.send(admin.id, {
                                type: 'staff_idle_alert',
                                title: `Staff Idle: ${staff.full_name}`,
                                body: `${staff.full_name} has been idle for ${idleMinutes} minutes with no activity selected.`,
                                data: { type: 'staff_idle_alert', userId: staff.user_id, priority: 'medium' }
                            });
                        }
                    }
                }

                // Broadcast for live dashboards
                broadcast(staff.user_id, staff.branch_id, 'idle', 'idle_alert', {
                    idleMinutes,
                    staffName: staff.full_name
                });

                console.log(`[ActivityTracker] Idle alert: ${staff.full_name} idle ${idleMinutes}min`);
            }
        }
    } catch (e) {
        console.error('[ActivityTracker] checkIdleStaff error:', e.message);
    }
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
    ACTIVITY_CONFIG,
    setPool,
    setIO,
    setNotificationService,
    startActivity,
    stopActivity,
    endActiveSession,
    getCurrentSession,
    getTodayTimeline,
    getLiveSessions,
    getStaffTimeline,
    getDaySummary,
    checkIdleStaff
};
