/**
 * ATTENDANCE MODULE ROUTES
 * Handles clock in/out, permissions, and attendance management
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const { requirePermission, requireAuth } = require('../middleware/permissionMiddleware');

// Configure multer for photo uploads
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB max
    },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files are allowed'));
        }
    }
});

// Database connection (imported from main app)
let pool;

function setPool(dbPool) {
    pool = dbPool;
}

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Compress and save photo
 */
async function saveAttendancePhoto(buffer, userId, type) {
    const timestamp = Date.now();
    const filename = `${userId}_${type}_${timestamp}.jpg`;
    const relativePath = `uploads/attendance/${type}/${filename}`;
    const fullPath = path.join(__dirname, '..', relativePath);
    
    // Compress image to max 500KB
    await sharp(buffer)
        .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80, progressive: true })
        .toFile(fullPath);
    
    return relativePath;
}

/**
 * Calculate delete_after date (40 days from now)
 */
function getDeleteAfterDate() {
    const date = new Date();
    date.setDate(date.getDate() + 40);
    return date.toISOString().split('T')[0];
}

/**
 * Get shop hours for branch and day
 */
async function getShopHours(branchId, date) {
    const dayOfWeek = new Date(date).toLocaleString('en-US', { weekday: 'long' }).toLowerCase();
    
    const [rows] = await pool.query(
        `SELECT * FROM shop_hours_config 
         WHERE branch_id = ? AND day_of_week = ?`,
        [branchId, dayOfWeek]
    );
    
    return rows[0] || {
        open_time: '08:30:00',
        close_time: '20:30:00',
        expected_hours: dayOfWeek === 'sunday' ? 5.00 : 10.00,
        late_threshold_minutes: 15,
        break_min_minutes: 60,
        break_max_minutes: 120
    };
}

/**
 * Check if time is late
 */
function isLateArrival(clockInTime, openTime, thresholdMinutes) {
    const clockIn = new Date(`1970-01-01T${clockInTime}`);
    const open = new Date(`1970-01-01T${openTime}`);
    const diffMinutes = (clockIn - open) / 1000 / 60;
    
    return diffMinutes > thresholdMinutes;
}

/**
 * Calculate working minutes
 */
function calculateWorkingMinutes(clockInTime, clockOutTime, breakMinutes = 0) {
    const clockIn = new Date(clockInTime);
    const clockOut = new Date(clockOutTime);
    const totalMinutes = (clockOut - clockIn) / 1000 / 60;
    
    return Math.max(0, totalMinutes - breakMinutes);
}

// ========================================
// CLOCK IN/OUT ENDPOINTS
// ========================================

/**
 * POST /api/attendance/clock-in
 * Clock in with photo and GPS
 */
router.post('/clock-in', requireAuth, upload.single('photo'), async (req, res) => {
    try {
        const userId = req.user.id;
        const { latitude, longitude, address, branch_id } = req.body;
        const photo = req.file;
        
        // Validation
        if (!photo) {
            return res.status(400).json({ 
                success: false, 
                message: 'Photo is required for clock in' 
            });
        }
        
        if (!latitude || !longitude) {
            return res.status(400).json({ 
                success: false, 
                message: 'GPS location is required for clock in' 
            });
        }
        
        const branchId = branch_id || req.user.branch_id;
        const today = new Date().toISOString().split('T')[0];
        const now = new Date();
        
        // Check if already clocked in today
        const [existing] = await pool.query(
            'SELECT id FROM staff_attendance WHERE user_id = ? AND date = ?',
            [userId, today]
        );
        
        if (existing.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'You have already clocked in today',
                code: 'ALREADY_CLOCKED_IN'
            });
        }
        
        // Get shop hours
        const shopHours = await getShopHours(branchId, today);
        
        // Check if late
        const currentTime = now.toTimeString().split(' ')[0];
        const late = isLateArrival(currentTime, shopHours.open_time, shopHours.late_threshold_minutes);
        
        // Save photo
        const photoPath = await saveAttendancePhoto(photo.buffer, userId, 'clock-in');
        
        // Create attendance record
        const [result] = await pool.query(
            `INSERT INTO staff_attendance 
             (user_id, branch_id, date, clock_in_time, clock_in_photo, 
              clock_in_lat, clock_in_lng, clock_in_address, 
              is_late, expected_hours, status) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'present')`,
            [userId, branchId, today, now, photoPath, latitude, longitude, 
             address, late ? 1 : 0, shopHours.expected_hours]
        );
        
        const attendanceId = result.insertId;
        
        // Save photo record
        await pool.query(
            `INSERT INTO attendance_photos 
             (attendance_id, user_id, photo_type, file_path, file_size, 
              latitude, longitude, address, captured_at, delete_after) 
             VALUES (?, ?, 'clock_in', ?, ?, ?, ?, ?, ?, ?)`,
            [attendanceId, userId, photoPath, photo.size, latitude, longitude, 
             address, now, getDeleteAfterDate()]
        );
        
        // If late, auto-create permission request
        let permissionId = null;
        if (late) {
            const lateMinutes = Math.floor(
                (new Date(`1970-01-01T${currentTime}`) - new Date(`1970-01-01T${shopHours.open_time}`)) / 1000 / 60
            );
            
            const [permResult] = await pool.query(
                `INSERT INTO attendance_permissions 
                 (user_id, attendance_id, request_type, request_date, 
                  request_time, duration_minutes, reason, requested_by) 
                 VALUES (?, ?, 'late_arrival', ?, ?, ?, 'Auto-generated late arrival', ?)`,
                [userId, attendanceId, today, currentTime, lateMinutes, userId]
            );
            
            permissionId = permResult.insertId;
            
            // Link permission to attendance
            await pool.query(
                'UPDATE staff_attendance SET late_permission_id = ? WHERE id = ?',
                [permissionId, attendanceId]
            );
        }
        
        res.json({
            success: true,
            message: late ? 'Clocked in successfully. Late arrival detected - permission request created.' : 'Clocked in successfully',
            data: {
                attendance_id: attendanceId,
                clock_in_time: now,
                is_late: late,
                shop_open_time: shopHours.open_time,
                expected_hours: shopHours.expected_hours,
                permission_id: permissionId
            }
        });
        
    } catch (error) {
        console.error('Clock in error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to clock in. Please try again.' 
        });
    }
});

/**
 * POST /api/attendance/clock-out
 * Clock out with photo and GPS
 */
router.post('/clock-out', requireAuth, upload.single('photo'), async (req, res) => {
    try {
        const userId = req.user.id;
        const { latitude, longitude, address } = req.body;
        const photo = req.file;
        
        // Validation
        if (!photo) {
            return res.status(400).json({ 
                success: false, 
                message: 'Photo is required for clock out' 
            });
        }
        
        if (!latitude || !longitude) {
            return res.status(400).json({ 
                success: false, 
                message: 'GPS location is required for clock out' 
            });
        }
        
        const today = new Date().toISOString().split('T')[0];
        const now = new Date();
        
        // Get today's attendance
        const [attendance] = await pool.query(
            `SELECT a.*, shc.close_time, shc.expected_hours 
             FROM staff_attendance a
             JOIN shop_hours_config shc ON a.branch_id = shc.branch_id 
                AND shc.day_of_week = LOWER(DAYNAME(a.date))
             WHERE a.user_id = ? AND a.date = ?`,
            [userId, today]
        );
        
        if (attendance.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'No clock in record found for today. Please clock in first.',
                code: 'NOT_CLOCKED_IN'
            });
        }
        
        const record = attendance[0];
        
        if (record.clock_out_time) {
            return res.status(400).json({ 
                success: false, 
                message: 'You have already clocked out today',
                code: 'ALREADY_CLOCKED_OUT'
            });
        }
        
        // Save photo
        const photoPath = await saveAttendancePhoto(photo.buffer, userId, 'clock-out');
        
        // Calculate working minutes
        const workingMinutes = calculateWorkingMinutes(
            record.clock_in_time, 
            now, 
            record.break_duration_minutes || 0
        );
        
        // Check if early checkout
        const currentTime = now.toTimeString().split(' ')[0];
        const closeTime = new Date(`1970-01-01T${record.close_time}`);
        const currentDateTime = new Date(`1970-01-01T${currentTime}`);
        const isEarly = currentDateTime < closeTime;
        
        // Update attendance
        await pool.query(
            `UPDATE staff_attendance 
             SET clock_out_time = ?, clock_out_photo = ?, 
                 clock_out_lat = ?, clock_out_lng = ?, clock_out_address = ?,
                 total_working_minutes = ?, is_early_checkout = ?
             WHERE id = ?`,
            [now, photoPath, latitude, longitude, address, workingMinutes, isEarly ? 1 : 0, record.id]
        );
        
        // Save photo record
        await pool.query(
            `INSERT INTO attendance_photos 
             (attendance_id, user_id, photo_type, file_path, file_size, 
              latitude, longitude, address, captured_at, delete_after) 
             VALUES (?, ?, 'clock_out', ?, ?, ?, ?, ?, ?, ?)`,
            [record.id, userId, photoPath, photo.size, latitude, longitude, 
             address, now, getDeleteAfterDate()]
        );
        
        const workingHours = workingMinutes / 60;
        const expectedMinutes = record.expected_hours * 60;
        const shortage = expectedMinutes - workingMinutes;
        
        res.json({
            success: true,
            message: 'Clocked out successfully',
            data: {
                attendance_id: record.id,
                clock_out_time: now,
                total_working_minutes: workingMinutes,
                total_working_hours: workingHours.toFixed(2),
                expected_hours: record.expected_hours,
                shortage_minutes: Math.max(0, shortage),
                is_complete: workingMinutes >= expectedMinutes,
                is_early_checkout: isEarly
            }
        });
        
    } catch (error) {
        console.error('Clock out error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to clock out. Please try again.' 
        });
    }
});

/**
 * GET /api/attendance/today
 * Get today's attendance status
 */
router.get('/today', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const today = new Date().toISOString().split('T')[0];
        
        const [rows] = await pool.query(
            `SELECT a.*, 
                    u.full_name, u.username,
                    b.name as branch_name,
                    shc.open_time, shc.close_time, shc.expected_hours
             FROM staff_attendance a
             JOIN users u ON a.user_id = u.id
             JOIN branches b ON a.branch_id = b.id
             LEFT JOIN shop_hours_config shc ON a.branch_id = shc.branch_id 
                AND shc.day_of_week = LOWER(DAYNAME(a.date))
             WHERE a.user_id = ? AND a.date = ?`,
            [userId, today]
        );
        
        if (rows.length === 0) {
            // No attendance yet - return shop hours
            const branchId = req.user.branch_id;
            const shopHours = await getShopHours(branchId, today);
            
            return res.json({
                success: true,
                has_clocked_in: false,
                shop_hours: shopHours,
                message: 'No attendance record for today'
            });
        }
        
        const attendance = rows[0];
        
        res.json({
            success: true,
            has_clocked_in: true,
            has_clocked_out: !!attendance.clock_out_time,
            data: attendance
        });
        
    } catch (error) {
        console.error('Get today attendance error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to get attendance' 
        });
    }
});

/**
 * GET /api/attendance/my-history
 * Get user's attendance history
 */
router.get('/my-history', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const { month, year, limit = 30 } = req.query;
        
        let query = `
            SELECT a.*, 
                   b.name as branch_name,
                   CASE 
                       WHEN a.clock_out_time IS NULL THEN 'Ongoing'
                       WHEN a.total_working_minutes >= (a.expected_hours * 60) THEN 'Complete'
                       ELSE 'Incomplete'
                   END as day_status
            FROM staff_attendance a
            JOIN branches b ON a.branch_id = b.id
            WHERE a.user_id = ?
        `;
        
        const params = [userId];
        
        if (month && year) {
            query += ` AND MONTH(a.date) = ? AND YEAR(a.date) = ?`;
            params.push(month, year);
        }
        
        query += ` ORDER BY a.date DESC LIMIT ?`;
        params.push(parseInt(limit));
        
        const [rows] = await pool.query(query, params);
        
        res.json({
            success: true,
            count: rows.length,
            data: rows
        });
        
    } catch (error) {
        console.error('Get history error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to get attendance history' 
        });
    }
});

// ========================================
// BREAK MANAGEMENT ENDPOINTS
// ========================================

/**
 * POST /api/attendance/break-start
 * Start lunch break
 */
router.post('/break-start', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const today = new Date().toISOString().split('T')[0];
        const now = new Date();
        
        // Get today's attendance
        const [attendance] = await pool.query(
            'SELECT * FROM staff_attendance WHERE user_id = ? AND date = ?',
            [userId, today]
        );
        
        if (attendance.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Please clock in first before starting break',
                code: 'NOT_CLOCKED_IN'
            });
        }
        
        const record = attendance[0];
        
        if (record.break_start_time) {
            return res.status(400).json({ 
                success: false, 
                message: 'Break already started',
                code: 'BREAK_ALREADY_STARTED'
            });
        }
        
        // Update attendance with break start
        await pool.query(
            'UPDATE staff_attendance SET break_start_time = ? WHERE id = ?',
            [now, record.id]
        );
        
        res.json({
            success: true,
            message: 'Break started successfully',
            data: {
                attendance_id: record.id,
                break_start_time: now
            }
        });
        
    } catch (error) {
        console.error('Break start error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to start break' 
        });
    }
});

/**
 * POST /api/attendance/break-end
 * End lunch break
 */
router.post('/break-end', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const today = new Date().toISOString().split('T')[0];
        const now = new Date();
        
        // Get today's attendance with shop hours
        const [attendance] = await pool.query(
            `SELECT a.*, shc.break_min_minutes, shc.break_max_minutes
             FROM staff_attendance a
             JOIN shop_hours_config shc ON a.branch_id = shc.branch_id 
                AND shc.day_of_week = LOWER(DAYNAME(a.date))
             WHERE a.user_id = ? AND a.date = ?`,
            [userId, today]
        );
        
        if (attendance.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'No attendance record found',
                code: 'NOT_CLOCKED_IN'
            });
        }
        
        const record = attendance[0];
        
        if (!record.break_start_time) {
            return res.status(400).json({ 
                success: false, 
                message: 'Break has not been started yet',
                code: 'BREAK_NOT_STARTED'
            });
        }
        
        if (record.break_end_time) {
            return res.status(400).json({ 
                success: false, 
                message: 'Break already ended',
                code: 'BREAK_ALREADY_ENDED'
            });
        }
        
        // Calculate break duration
        const breakStart = new Date(record.break_start_time);
        const breakDuration = Math.floor((now - breakStart) / 1000 / 60); // minutes
        
        // Check if break is too short or too long
        const warnings = [];
        if (breakDuration < record.break_min_minutes) {
            warnings.push(`Break was shorter than minimum ${record.break_min_minutes} minutes`);
        }
        if (breakDuration > record.break_max_minutes) {
            warnings.push(`Break exceeded maximum ${record.break_max_minutes} minutes`);
        }
        
        // Update attendance
        await pool.query(
            `UPDATE staff_attendance 
             SET break_end_time = ?, break_duration_minutes = ? 
             WHERE id = ?`,
            [now, breakDuration, record.id]
        );
        
        res.json({
            success: true,
            message: 'Break ended successfully',
            warnings: warnings,
            data: {
                attendance_id: record.id,
                break_start_time: record.break_start_time,
                break_end_time: now,
                break_duration_minutes: breakDuration,
                break_duration_hours: (breakDuration / 60).toFixed(2)
            }
        });
        
    } catch (error) {
        console.error('Break end error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to end break' 
        });
    }
});

// ========================================
// PERMISSION ENDPOINTS
// ========================================

/**
 * POST /api/attendance/permission/request
 * Submit permission request
 */
router.post('/permission/request', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const { request_type, request_date, request_time, duration_minutes, reason } = req.body;
        
        // Validation
        if (!request_type || !request_date || !reason) {
            return res.status(400).json({ 
                success: false, 
                message: 'Request type, date, and reason are required' 
            });
        }
        
        if (!['late_arrival', 'early_checkout', 'extended_break'].includes(request_type)) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid request type' 
            });
        }
        
        // Get attendance record for the date (if exists)
        const [attendance] = await pool.query(
            'SELECT id FROM staff_attendance WHERE user_id = ? AND date = ?',
            [userId, request_date]
        );
        
        const attendanceId = attendance.length > 0 ? attendance[0].id : null;
        
        // Create permission request
        const [result] = await pool.query(
            `INSERT INTO attendance_permissions 
             (user_id, attendance_id, request_type, request_date, 
              request_time, duration_minutes, reason, requested_by, status) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [userId, attendanceId, request_type, request_date, 
             request_time, duration_minutes, reason, userId]
        );
        
        res.json({
            success: true,
            message: 'Permission request submitted successfully',
            data: {
                permission_id: result.insertId,
                request_type,
                request_date,
                status: 'pending'
            }
        });
        
    } catch (error) {
        console.error('Permission request error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to submit permission request' 
        });
    }
});

/**
 * GET /api/attendance/permission/my-requests
 * Get user's permission requests
 */
router.get('/permission/my-requests', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const { status, limit = 50 } = req.query;
        
        let query = `
            SELECT ap.*, 
                   reviewer.full_name as reviewed_by_name
            FROM attendance_permissions ap
            LEFT JOIN users reviewer ON ap.reviewed_by = reviewer.id
            WHERE ap.user_id = ?
        `;
        
        const params = [userId];
        
        if (status) {
            query += ' AND ap.status = ?';
            params.push(status);
        }
        
        query += ' ORDER BY ap.requested_at DESC LIMIT ?';
        params.push(parseInt(limit));
        
        const [rows] = await pool.query(query, params);
        
        res.json({
            success: true,
            count: rows.length,
            data: rows
        });
        
    } catch (error) {
        console.error('Get permissions error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to get permission requests' 
        });
    }
});

/**
 * GET /api/attendance/permission/pending
 * Get pending permission requests (for admin/manager)
 */
router.get('/permission/pending', requirePermission('attendance', 'approve'), async (req, res) => {
    try {
        const { branch_id } = req.query;
        
        let query = `
            SELECT ap.*, 
                   u.full_name as user_name,
                   u.username,
                   b.name as branch_name
            FROM attendance_permissions ap
            JOIN users u ON ap.user_id = u.id
            LEFT JOIN staff_attendance sa ON ap.attendance_id = sa.id
            LEFT JOIN branches b ON sa.branch_id = b.id
            WHERE ap.status = 'pending'
        `;
        
        const params = [];
        
        if (branch_id) {
            query += ' AND sa.branch_id = ?';
            params.push(branch_id);
        }
        
        query += ' ORDER BY ap.requested_at ASC';
        
        const [rows] = await pool.query(query, params);
        
        res.json({
            success: true,
            count: rows.length,
            data: rows
        });
        
    } catch (error) {
        console.error('Get pending permissions error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to get pending permissions' 
        });
    }
});

/**
 * PUT /api/attendance/permission/:id/approve
 * Approve permission request
 */
router.put('/permission/:id/approve', requirePermission('attendance', 'approve'), async (req, res) => {
    try {
        const permissionId = req.params.id;
        const reviewerId = req.user.id;
        const { review_notes } = req.body;
        
        // Get permission request
        const [permissions] = await pool.query(
            `SELECT ap.*, sa.total_working_minutes, sa.expected_hours
             FROM attendance_permissions ap
             LEFT JOIN staff_attendance sa ON ap.attendance_id = sa.id
             WHERE ap.id = ?`,
            [permissionId]
        );
        
        if (permissions.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Permission request not found' 
            });
        }
        
        const permission = permissions[0];
        
        if (permission.status !== 'pending') {
            return res.status(400).json({ 
                success: false, 
                message: `Permission already ${permission.status}` 
            });
        }
        
        const now = new Date();
        
        // Update permission status
        await pool.query(
            `UPDATE attendance_permissions 
             SET status = 'approved', reviewed_by = ?, reviewed_at = ?, review_notes = ?
             WHERE id = ?`,
            [reviewerId, now, review_notes, permissionId]
        );
        
        // If attendance exists, update working minutes
        if (permission.attendance_id && permission.duration_minutes) {
            const currentMinutes = permission.total_working_minutes || 0;
            const newMinutes = currentMinutes + permission.duration_minutes;
            
            await pool.query(
                'UPDATE staff_attendance SET total_working_minutes = ? WHERE id = ?',
                [newMinutes, permission.attendance_id]
            );
        }
        
        res.json({
            success: true,
            message: 'Permission approved successfully',
            data: {
                permission_id: permissionId,
                approved_by: reviewerId,
                approved_at: now
            }
        });
        
    } catch (error) {
        console.error('Approve permission error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to approve permission' 
        });
    }
});

/**
 * PUT /api/attendance/permission/:id/reject
 * Reject permission request
 */
router.put('/permission/:id/reject', requirePermission('attendance', 'approve'), async (req, res) => {
    try {
        const permissionId = req.params.id;
        const reviewerId = req.user.id;
        const { review_notes } = req.body;
        
        if (!review_notes) {
            return res.status(400).json({ 
                success: false, 
                message: 'Review notes are required when rejecting' 
            });
        }
        
        // Get permission request
        const [permissions] = await pool.query(
            'SELECT * FROM attendance_permissions WHERE id = ?',
            [permissionId]
        );
        
        if (permissions.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Permission request not found' 
            });
        }
        
        const permission = permissions[0];
        
        if (permission.status !== 'pending') {
            return res.status(400).json({ 
                success: false, 
                message: `Permission already ${permission.status}` 
            });
        }
        
        const now = new Date();
        
        // Update permission status
        await pool.query(
            `UPDATE attendance_permissions 
             SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, review_notes = ?
             WHERE id = ?`,
            [reviewerId, now, review_notes, permissionId]
        );
        
        // No working minutes adjustment for rejection
        
        res.json({
            success: true,
            message: 'Permission rejected',
            data: {
                permission_id: permissionId,
                rejected_by: reviewerId,
                rejected_at: now,
                reason: review_notes
            }
        });
        
    } catch (error) {
        console.error('Reject permission error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to reject permission' 
        });
    }
});

// ========================================
// PHOTO & REPORTING ENDPOINTS
// ========================================

/**
 * GET /api/attendance/photo/:id
 * Get attendance photo (with permission check)
 */
router.get('/photo/:id', requireAuth, async (req, res) => {
    try {
        const photoId = req.params.id;
        const userId = req.user.id;
        const userRole = req.user.role;        
        // Get photo record
        const [photos] = await pool.query(
            'SELECT * FROM attendance_photos WHERE id = ?',
            [photoId]
        );
        
        if (photos.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'Photo not found' 
            });
        }
        
        const photo = photos[0];
        
        // Permission check: own photo or admin
        if (photo.user_id !== userId && userRole !== 'admin') {
            return res.status(403).json({ 
                success: false, 
                message: 'Access denied' 
            });
        }
        
        // Check if deleted
        if (photo.is_deleted) {
            return res.status(410).json({ 
                success: false, 
                message: 'Photo has been deleted (40-day retention period expired)' 
            });
        }
        
        // Send file
        const path = require('path');
        const filePath = path.join(__dirname, '..', photo.file_path);
        
        res.sendFile(filePath, (err) => {
            if (err) {
                console.error('Send photo error:', err);
                res.status(404).json({ 
                    success: false, 
                    message: 'Photo file not found' 
                });
            }
        });
        
    } catch (error) {
        console.error('Get photo error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to retrieve photo' 
        });
    }
});

/**
 * GET /api/attendance/user/:userId/month/:month
 * Get user's monthly attendance
 */
router.get('/user/:userId/month/:month', requirePermission('attendance', 'view'), async (req, res) => {
    try {
        const { userId, month } = req.params; // month format: YYYY-MM
        
        const [rows] = await pool.query(
            `SELECT a.*,
                    b.name as branch_name,
                    DAYNAME(a.date) as day_name,
                    CASE 
                        WHEN a.clock_out_time IS NULL THEN 'Ongoing'
                        WHEN a.total_working_minutes >= (a.expected_hours * 60) THEN 'Complete'
                        ELSE 'Incomplete'
                    END as day_status
             FROM staff_attendance a
             JOIN branches b ON a.branch_id = b.id
             WHERE a.user_id = ? AND DATE_FORMAT(a.date, '%Y-%m') = ?
             ORDER BY a.date ASC`,
            [userId, month]
        );
        
        // Calculate summary
        const summary = {
            total_days: rows.length,
            present_days: rows.filter(r => r.status === 'present').length,
            late_days: rows.filter(r => r.is_late).length,
            early_checkout_days: rows.filter(r => r.is_early_checkout).length,
            total_working_minutes: rows.reduce((sum, r) => sum + (r.total_working_minutes || 0), 0),
            total_expected_minutes: rows.reduce((sum, r) => sum + (r.expected_hours * 60), 0)
        };
        
        summary.total_working_hours = (summary.total_working_minutes / 60).toFixed(2);
        summary.total_expected_hours = (summary.total_expected_minutes / 60).toFixed(2);
        summary.shortage_minutes = Math.max(0, summary.total_expected_minutes - summary.total_working_minutes);
        
        res.json({
            success: true,
            month: month,
            summary: summary,
            attendance: rows
        });
        
    } catch (error) {
        console.error('Get monthly attendance error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to get monthly attendance' 
        });
    }
});

/**
 * GET /api/attendance/report
 * Generate attendance report
 */
router.get('/report', requirePermission('attendance', 'view'), async (req, res) => {
    try {
        const { date, branch_id, status } = req.query;
        const reportDate = date || new Date().toISOString().split('T')[0];
        
        let query = `
            SELECT a.*, 
                   u.full_name, u.username,
                   b.name as branch_name,
                   CASE 
                       WHEN a.clock_out_time IS NULL THEN 'Ongoing'
                       WHEN a.total_working_minutes >= (a.expected_hours * 60) THEN 'Complete'
                       ELSE 'Incomplete'
                   END as day_status
            FROM staff_attendance a
            JOIN users u ON a.user_id = u.id
            JOIN branches b ON a.branch_id = b.id
            WHERE a.date = ?
        `;
        
        const params = [reportDate];
        
        if (branch_id) {
            query += ' AND a.branch_id = ?';
            params.push(branch_id);
        }
        
        if (status) {
            query += ' AND a.status = ?';
            params.push(status);
        }
        
        query += ' ORDER BY b.name, u.full_name';
        
        const [rows] = await pool.query(query, params);
        
        // Generate summary
        const summary = {
            date: reportDate,
            total_staff: rows.length,
            present: rows.filter(r => r.status === 'present').length,
            absent: rows.filter(r => r.status === 'absent').length,
            on_leave: rows.filter(r => r.status === 'on_leave').length,
            late_arrivals: rows.filter(r => r.is_late).length,
            early_checkouts: rows.filter(r => r.is_early_checkout).length,
            not_clocked_out: rows.filter(r => !r.clock_out_time).length
        };
        
        res.json({
            success: true,
            date: reportDate,
            summary: summary,
            attendance: rows
        });
        
    } catch (error) {
        console.error('Generate report error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to generate report' 
        });
    }
});

/**
 * POST /api/attendance/admin/mark
 * Admin: Manually mark attendance
 */
router.post('/admin/mark', requirePermission('attendance', 'manage'), async (req, res) => {
    try {
        const adminId = req.user.id;
        const { user_id, date, status, notes } = req.body;
        
        // Validation
        if (!user_id || !date || !status) {
            return res.status(400).json({ 
                success: false, 
                message: 'User ID, date, and status are required' 
            });
        }
        
        // Get user's branch
        const [users] = await pool.query(
            'SELECT branch_id FROM users WHERE id = ?',
            [user_id]
        );
        
        if (users.length === 0) {
            return res.status(404).json({ 
                success: false, 
                message: 'User not found' 
            });
        }
        
        const branchId = users[0].branch_id;
        
        // Get shop hours
        const shopHours = await getShopHours(branchId, date);
        
        // Check if already exists
        const [existing] = await pool.query(
            'SELECT id FROM staff_attendance WHERE user_id = ? AND date = ?',
            [user_id, date]
        );
        
        if (existing.length > 0) {
            // Update existing
            await pool.query(
                `UPDATE staff_attendance 
                 SET status = ?, notes = CONCAT(COALESCE(notes, ''), '\n[Admin override by ID ${adminId}]: ', ?)
                 WHERE id = ?`,
                [status, notes || 'Status changed', existing[0].id]
            );
            
            return res.json({
                success: true,
                message: 'Attendance updated successfully',
                data: { attendance_id: existing[0].id }
            });
        }
        
        // Create new record
        const [result] = await pool.query(
            `INSERT INTO staff_attendance 
             (user_id, branch_id, date, status, expected_hours, notes) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [user_id, branchId, date, status, shopHours.expected_hours, 
             `Manually marked by admin (ID: ${adminId}). ${notes || ''}`]
        );
        
        res.json({
            success: true,
            message: 'Attendance marked successfully',
            data: { attendance_id: result.insertId }
        });
        
    } catch (error) {
        console.error('Admin mark attendance error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to mark attendance' 
        });
    }
});

module.exports = {
    router,
    setPool
};
