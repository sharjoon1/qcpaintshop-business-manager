/**
 * ACTIVITY TRACKER ROUTES
 * Endpoints for staff activity tracking: start/stop activities, photo upload, admin monitoring.
 */

const express = require('express');
const router = express.Router();
const { requireAuth, requirePermission } = require('../middleware/permissionMiddleware');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const { uploadActivity } = require('../config/uploads');

let pool, io, activityService, notificationService, reportService;
function setPool(p) { pool = p; }
function setIO(socketIO) { io = socketIO; }
function setActivityService(svc) { activityService = svc; }
function setNotificationService(ns) { notificationService = ns; }
function setReportService(rs) { reportService = rs; }

// ── Staff endpoints ──────────────────────────────────────────────────────────

/**
 * POST /start — Start an activity session
 * Body: { type, metadata? }
 */
router.post('/start', requireAuth, async (req, res) => {
    try {
        const { type, metadata } = req.body;
        const userId = req.user.id;
        const branchId = req.user.branch_id;

        // Validate type is required
        if (!type) {
            return res.status(400).json({ success: false, error: 'Activity type is required' });
        }

        // Validate type exists in config
        if (!activityService.ACTIVITY_CONFIG[type]) {
            return res.status(400).json({ success: false, error: `Invalid activity type: ${type}` });
        }

        // attending_customer requires customer_note in metadata
        if (type === 'attending_customer') {
            const meta = metadata || {};
            if (!meta.customer_note) {
                return res.status(400).json({ success: false, error: 'Customer note is required when attending a customer' });
            }
        }

        // Check staff is clocked in today
        const [attendance] = await pool.query(
            `SELECT id FROM staff_attendance WHERE user_id = ? AND date = CURDATE() AND clock_in_time IS NOT NULL AND clock_out_time IS NULL`,
            [userId]
        );

        if (attendance.length === 0) {
            return res.status(400).json({ success: false, error: 'You must be clocked in to start an activity' });
        }

        const result = await activityService.startActivity(userId, branchId, type, metadata || {});

        res.json({
            success: true,
            sessionId: result.sessionId,
            label: result.label,
            redirect: result.redirect,
            startedAt: result.startedAt
        });
    } catch (err) {
        console.error('[ActivityTracker] POST /start error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /stop — Stop current activity
 * Body: { metadata? }
 */
router.post('/stop', requireAuth, async (req, res) => {
    try {
        const { metadata } = req.body;
        const userId = req.user.id;

        const result = await activityService.stopActivity(userId, metadata || {});

        res.json({
            success: true,
            stopped: result.stopped,
            duration: result.duration
        });
    } catch (err) {
        console.error('[ActivityTracker] POST /stop error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /stop-with-photo — Stop shop_maintenance with a photo
 * Multipart: photo file + metadata in body
 */
router.post('/stop-with-photo', requireAuth, (req, res, next) => {
    uploadActivity.single('photo')(req, res, (err) => {
        if (err) {
            const msg = err.code === 'LIMIT_FILE_SIZE' ? 'Photo too large. Max 15MB.' : err.message;
            return res.status(400).json({ success: false, error: msg });
        }
        next();
    });
}, async (req, res) => {
    try {
        const userId = req.user.id;

        if (!req.file) {
            return res.status(400).json({ success: false, error: 'Photo is required' });
        }

        // Compress the photo with sharp
        const originalPath = req.file.path;
        const compressedName = 'c_' + req.file.filename.replace(path.extname(req.file.filename), '.jpg');
        const compressedPath = path.join(req.file.destination, compressedName);

        await sharp(originalPath)
            .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toFile(compressedPath);

        // Delete original, use compressed
        fs.unlinkSync(originalPath);
        const photoUrl = '/uploads/activity/' + compressedName;

        // Parse metadata from body (may come as string in multipart)
        let metadata = {};
        if (req.body.metadata) {
            try {
                metadata = typeof req.body.metadata === 'string' ? JSON.parse(req.body.metadata) : req.body.metadata;
            } catch (e) {
                // ignore parse errors
            }
        }

        const result = await activityService.stopActivity(userId, metadata, [photoUrl]);

        res.json({
            success: true,
            stopped: result.stopped,
            duration: result.duration
        });
    } catch (err) {
        console.error('[ActivityTracker] POST /stop-with-photo error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /current — Get current active session
 */
router.get('/current', requireAuth, async (req, res) => {
    try {
        const session = await activityService.getCurrentSession(req.user.id);

        res.json({
            success: true,
            session,
            config: activityService.ACTIVITY_CONFIG
        });
    } catch (err) {
        console.error('[ActivityTracker] GET /current error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /today — Today's timeline for current user
 */
router.get('/today', requireAuth, async (req, res) => {
    try {
        const timeline = await activityService.getTodayTimeline(req.user.id);

        res.json({
            success: true,
            timeline,
            config: activityService.ACTIVITY_CONFIG
        });
    } catch (err) {
        console.error('[ActivityTracker] GET /today error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── Admin endpoints ──────────────────────────────────────────────────────────

/**
 * GET /admin/live — Active sessions + idle staff
 */
router.get('/admin/live', requireAuth, requirePermission('attendance', 'view'), async (req, res) => {
    try {
        // Get active sessions
        const active = await activityService.getLiveSessions();

        // Get idle staff (clocked in, no active session, NOT on break/outside/prayer)
        const [idle] = await pool.query(`
            SELECT a.user_id, u.full_name, u.branch_id, b.name as branch_name, a.clock_in_time,
                (SELECT MAX(ended_at) FROM staff_activity_sessions WHERE user_id = a.user_id AND DATE(started_at) = CURDATE()) as last_activity_ended
            FROM staff_attendance a
            JOIN users u ON u.id = a.user_id
            LEFT JOIN branches b ON b.id = u.branch_id
            WHERE a.date = CURDATE() AND a.clock_in_time IS NOT NULL AND a.clock_out_time IS NULL
                AND NOT EXISTS (SELECT 1 FROM staff_activity_sessions WHERE user_id = a.user_id AND ended_at IS NULL)
                AND (a.break_start_time IS NULL OR a.break_end_time IS NOT NULL)
                AND NOT EXISTS (SELECT 1 FROM outside_work_periods WHERE user_id = a.user_id AND status = 'active')
                AND NOT EXISTS (SELECT 1 FROM prayer_periods WHERE user_id = a.user_id AND status = 'active')
        `);

        // Calculate idle_minutes for each idle staff member
        const idleWithMinutes = idle.map(staff => {
            const referenceTime = staff.last_activity_ended || staff.clock_in_time;
            const idleMinutes = Math.floor((Date.now() - new Date(referenceTime).getTime()) / 60000);
            return { ...staff, idle_minutes: idleMinutes };
        });

        // Get staff on break/outside work/prayer (clocked in, no active activity session)
        const [onBreakOrAway] = await pool.query(`
            SELECT a.user_id, u.full_name, u.branch_id, b.name as branch_name, a.clock_in_time,
                CASE
                    WHEN a.break_start_time IS NOT NULL AND a.break_end_time IS NULL THEN 'break'
                    WHEN EXISTS (SELECT 1 FROM outside_work_periods WHERE user_id = a.user_id AND status = 'active') THEN 'outside_work'
                    WHEN EXISTS (SELECT 1 FROM prayer_periods WHERE user_id = a.user_id AND status = 'active') THEN 'prayer'
                END as away_type,
                CASE
                    WHEN a.break_start_time IS NOT NULL AND a.break_end_time IS NULL THEN a.break_start_time
                    WHEN EXISTS (SELECT 1 FROM outside_work_periods WHERE user_id = a.user_id AND status = 'active')
                        THEN (SELECT start_time FROM outside_work_periods WHERE user_id = a.user_id AND status = 'active' ORDER BY id DESC LIMIT 1)
                    WHEN EXISTS (SELECT 1 FROM prayer_periods WHERE user_id = a.user_id AND status = 'active')
                        THEN (SELECT start_time FROM prayer_periods WHERE user_id = a.user_id AND status = 'active' ORDER BY id DESC LIMIT 1)
                END as away_since
            FROM staff_attendance a
            JOIN users u ON u.id = a.user_id
            LEFT JOIN branches b ON b.id = u.branch_id
            WHERE a.date = CURDATE() AND a.clock_in_time IS NOT NULL AND a.clock_out_time IS NULL
                AND (
                    (a.break_start_time IS NOT NULL AND a.break_end_time IS NULL)
                    OR EXISTS (SELECT 1 FROM outside_work_periods WHERE user_id = a.user_id AND status = 'active')
                    OR EXISTS (SELECT 1 FROM prayer_periods WHERE user_id = a.user_id AND status = 'active')
                )
        `);

        // Calculate away_minutes
        const awayWithMinutes = onBreakOrAway.map(staff => {
            const awaySince = staff.away_since ? new Date(staff.away_since).getTime() : Date.now();
            const awayMinutes = Math.floor((Date.now() - awaySince) / 60000);
            return { ...staff, away_minutes: awayMinutes };
        });

        res.json({
            success: true,
            active,
            idle: idleWithMinutes,
            on_break_or_away: awayWithMinutes,
            config: activityService.ACTIVITY_CONFIG
        });
    } catch (err) {
        console.error('[ActivityTracker] GET /admin/live error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /admin/staff/:id/timeline — Staff timeline by date
 * Query: date (defaults to today)
 */
router.get('/admin/staff/:id/timeline', requireAuth, requirePermission('attendance', 'view'), async (req, res) => {
    try {
        const staffId = parseInt(req.params.id);
        const date = req.query.date || new Date().toISOString().split('T')[0];

        if (isNaN(staffId)) {
            return res.status(400).json({ success: false, error: 'Invalid staff ID' });
        }

        const timeline = await activityService.getStaffTimeline(staffId, date);

        res.json({
            success: true,
            timeline,
            config: activityService.ACTIVITY_CONFIG
        });
    } catch (err) {
        console.error('[ActivityTracker] GET /admin/staff/:id/timeline error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /admin/summary — Day summary by date and optional branch
 * Query: date, branch_id
 */
router.get('/admin/summary', requireAuth, requirePermission('attendance', 'view'), async (req, res) => {
    try {
        const date = req.query.date || new Date().toISOString().split('T')[0];
        const branchId = req.query.branch_id ? parseInt(req.query.branch_id) : null;

        const summary = await activityService.getDaySummary(date, branchId);

        res.json({
            success: true,
            summary,
            config: activityService.ACTIVITY_CONFIG
        });
    } catch (err) {
        console.error('[ActivityTracker] GET /admin/summary error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /admin/send-reminder/:userId — Send manual idle reminder to a staff member
 */
router.post('/admin/send-reminder/:userId', requireAuth, requirePermission('attendance', 'view'), async (req, res) => {
    try {
        const targetUserId = parseInt(req.params.userId);

        if (isNaN(targetUserId)) {
            return res.status(400).json({ success: false, error: 'Invalid user ID' });
        }

        if (!notificationService) {
            return res.status(500).json({ success: false, error: 'Notification service unavailable' });
        }

        await notificationService.send(targetUserId, {
            type: 'idle_reminder',
            title: 'Activity Reminder',
            body: 'Your manager would like you to select your current activity. Please update your status.',
            data: { type: 'idle_reminder', priority: 'high', sentBy: req.user.id }
        });

        res.json({
            success: true,
            message: 'Reminder sent successfully'
        });
    } catch (err) {
        console.error('[ActivityTracker] POST /admin/send-reminder error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /admin/daily-report — Get daily activity report data for a date
 * Query: date (YYYY-MM-DD), defaults to today
 */
router.get('/admin/daily-report', requireAuth, requirePermission('attendance', 'view'), async (req, res) => {
    try {
        const date = req.query.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

        if (!reportService) {
            return res.status(500).json({ success: false, error: 'Report service not available' });
        }

        const reportData = await reportService.generateActivityReportData(date);

        // Check if PDF exists for this date
        const pdfFilename = `activity-report-${date}.pdf`;
        const pdfPath = path.join(__dirname, '..', 'public', 'uploads', 'reports', pdfFilename);
        const pdfExists = fs.existsSync(pdfPath);

        res.json({
            success: true,
            date,
            report: reportData,
            pdf_url: pdfExists ? `/uploads/reports/${pdfFilename}` : null
        });
    } catch (err) {
        console.error('[ActivityTracker] GET /admin/daily-report error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /admin/daily-report/send-all — Send individual activity reports to all staff
 * Body: { date }
 */
router.post('/admin/daily-report/send-all', requireAuth, requirePermission('attendance', 'view'), async (req, res) => {
    try {
        const date = req.body.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

        if (!reportService) {
            return res.status(500).json({ success: false, error: 'Report service not available' });
        }

        // Send in background, respond immediately
        res.json({ success: true, message: 'Sending activity reports to all staff...', date });

        // Fire and forget
        reportService.sendAllStaffActivityReports(date, req.user.id).then(result => {
            console.log(`[ActivityReport] Manual send-all done: ${result.sent} sent, ${result.failed} failed`);
        }).catch(err => {
            console.error('[ActivityReport] Manual send-all error:', err.message);
        });
    } catch (err) {
        console.error('[ActivityTracker] POST /admin/daily-report/send-all error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /admin/daily-report/generate-pdf — Generate PDF for a specific date
 * Body: { date }
 */
router.post('/admin/daily-report/generate-pdf', requireAuth, requirePermission('attendance', 'view'), async (req, res) => {
    try {
        const date = req.body.date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

        if (!reportService) {
            return res.status(500).json({ success: false, error: 'Report service not available' });
        }

        const pdf = await reportService.generateActivityPDF(date);
        if (!pdf) {
            return res.status(404).json({ success: false, error: 'No activity data for this date' });
        }

        res.json({
            success: true,
            pdf_url: pdf.url,
            filename: pdf.filename,
            staffCount: pdf.staffCount
        });
    } catch (err) {
        console.error('[ActivityTracker] POST /admin/daily-report/generate-pdf error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = { router, setPool, setIO, setActivityService, setNotificationService, setReportService };
