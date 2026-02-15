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
const notificationService = require('../services/notification-service');

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
    const dir = path.join(__dirname, '..', 'uploads', 'attendance', type);
    const relativePath = `uploads/attendance/${type}/${filename}`;
    const fullPath = path.join(dir, filename);

    // Ensure directory exists
    await fs.mkdir(dir, { recursive: true });

    // Compress image to max 500KB
    await sharp(buffer)
        .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 80, progressive: true })
        .toFile(fullPath);

    return relativePath;
}

/**
 * Validate GPS coordinates
 */
function validateGPS(latitude, longitude) {
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    if (isNaN(lat) || isNaN(lng)) return false;
    if (lat < -90 || lat > 90) return false;
    if (lng < -180 || lng > 180) return false;
    return true;
}

/**
 * Calculate distance between two GPS points (Haversine formula)
 * Returns distance in meters
 */
function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000; // Earth radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Check if user is within branch geo-fence
 */
async function checkGeoFence(branchId, latitude, longitude) {
    const [branches] = await pool.query(
        'SELECT latitude, longitude, geo_fence_radius FROM branches WHERE id = ?',
        [branchId]
    );

    if (branches.length === 0 || !branches[0].latitude || !branches[0].longitude) {
        // Branch has no geo-fence configured, allow
        return { allowed: true, distance: null };
    }

    const branch = branches[0];
    const radius = branch.geo_fence_radius || 500; // default 500m
    const distance = calculateDistance(
        parseFloat(latitude), parseFloat(longitude),
        parseFloat(branch.latitude), parseFloat(branch.longitude)
    );

    return {
        allowed: distance <= radius,
        distance: Math.round(distance),
        radius: radius
    };
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

        if (!validateGPS(latitude, longitude)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid GPS coordinates'
            });
        }

        const today = new Date().toISOString().split('T')[0];
        const now = new Date();

        // Check if user has geo-fence enabled
        const [userRows] = await pool.query(
            'SELECT geo_fence_enabled FROM users WHERE id = ?', [userId]
        );
        const geoFenceEnabled = userRows.length > 0 ? userRows[0].geo_fence_enabled : true;

        // Get all assigned branches for multi-branch support
        const [assignedBranches] = await pool.query(
            `SELECT ub.branch_id, ub.is_primary, b.name, b.latitude, b.longitude, b.geo_fence_radius
             FROM user_branches ub
             JOIN branches b ON ub.branch_id = b.id
             WHERE ub.user_id = ?`,
            [userId]
        );

        let effectiveBranchId = branch_id || req.user.branch_id;

        // Multi-branch geo-fence check
        if (geoFenceEnabled && assignedBranches.length > 0) {
            let closestBranch = null;
            let closestDistance = Infinity;

            for (const branch of assignedBranches) {
                if (!branch.latitude || !branch.longitude) continue;
                const dist = calculateDistance(
                    parseFloat(latitude), parseFloat(longitude),
                    parseFloat(branch.latitude), parseFloat(branch.longitude)
                );
                const radius = branch.geo_fence_radius || 500;
                if (dist <= radius) {
                    // Within this branch's fence - use nearest match
                    if (dist < closestDistance) {
                        closestDistance = dist;
                        closestBranch = branch;
                    }
                }
            }

            if (closestBranch) {
                effectiveBranchId = closestBranch.branch_id;
            } else {
                // Not within any assigned branch fence
                const primaryBranch = assignedBranches.find(b => b.is_primary) || assignedBranches[0];
                const geoCheck = await checkGeoFence(primaryBranch.branch_id, latitude, longitude);
                return res.status(400).json({
                    success: false,
                    message: `You are ${geoCheck.distance}m away from the nearest branch. Must be within the geo-fence to clock in.`,
                    code: 'OUTSIDE_GEOFENCE',
                    distance: geoCheck.distance,
                    radius: geoCheck.radius
                });
            }
        } else if (geoFenceEnabled) {
            // Fallback: single branch check (no user_branches rows)
            const geoCheck = await checkGeoFence(effectiveBranchId, latitude, longitude);
            if (!geoCheck.allowed) {
                return res.status(400).json({
                    success: false,
                    message: `You are ${geoCheck.distance}m away from the branch. Must be within ${geoCheck.radius}m to clock in.`,
                    code: 'OUTSIDE_GEOFENCE',
                    distance: geoCheck.distance,
                    radius: geoCheck.radius
                });
            }
        }
        // If geo_fence_enabled is false, skip geo-fence check entirely

        const branchId = effectiveBranchId;

        // Always compute distance from branch for reporting
        let clockInDistance = null;
        const [branchGeo] = await pool.query(
            'SELECT latitude, longitude FROM branches WHERE id = ?',
            [branchId]
        );
        if (branchGeo.length > 0 && branchGeo[0].latitude && branchGeo[0].longitude) {
            clockInDistance = Math.round(calculateDistance(
                parseFloat(latitude), parseFloat(longitude),
                parseFloat(branchGeo[0].latitude), parseFloat(branchGeo[0].longitude)
            ));
        }

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
              is_late, expected_hours, status, clock_in_distance)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'present', ?)`,
            [userId, branchId, today, now, photoPath, latitude, longitude,
             address, late ? 1 : 0, shopHours.expected_hours, clockInDistance]
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
        console.error('❌ Clock in error:', error);
        console.error('Error stack:', error.stack);
        console.error('Error details:', {
            message: error.message,
            code: error.code,
            errno: error.errno,
            sqlMessage: error.sqlMessage
        });

        // Return more detailed error for debugging
        res.status(500).json({
            success: false,
            message: error.sqlMessage || error.message || 'Failed to clock in. Please try again.',
            error_code: error.code,
            error_type: error.name
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

        if (!validateGPS(latitude, longitude)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid GPS coordinates'
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

        // Check if user has geo-fence enabled
        const [userGeoRows] = await pool.query(
            'SELECT geo_fence_enabled FROM users WHERE id = ?', [userId]
        );
        const geoFenceEnabledOut = userGeoRows.length > 0 ? userGeoRows[0].geo_fence_enabled : true;

        if (geoFenceEnabledOut) {
            // Check geo-fence against clock-in branch
            const geoCheck = await checkGeoFence(record.branch_id, latitude, longitude);
            if (!geoCheck.allowed) {
                return res.status(400).json({
                    success: false,
                    message: `You are ${geoCheck.distance}m away from the branch. Must be within ${geoCheck.radius}m to clock out.`,
                    code: 'OUTSIDE_GEOFENCE',
                    distance: geoCheck.distance,
                    radius: geoCheck.radius
                });
            }
        }

        // Compute distance from branch for reporting
        let clockOutDistance = null;
        const [branchGeoOut] = await pool.query(
            'SELECT latitude, longitude FROM branches WHERE id = ?',
            [record.branch_id]
        );
        if (branchGeoOut.length > 0 && branchGeoOut[0].latitude && branchGeoOut[0].longitude) {
            clockOutDistance = Math.round(calculateDistance(
                parseFloat(latitude), parseFloat(longitude),
                parseFloat(branchGeoOut[0].latitude), parseFloat(branchGeoOut[0].longitude)
            ));
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
                 total_working_minutes = ?, is_early_checkout = ?, clock_out_distance = ?
             WHERE id = ?`,
            [now, photoPath, latitude, longitude, address, workingMinutes, isEarly ? 1 : 0, clockOutDistance, record.id]
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
        console.error('❌ Clock out error:', error);
        console.error('Error stack:', error.stack);
        console.error('Error details:', {
            message: error.message,
            code: error.code,
            errno: error.errno,
            sqlMessage: error.sqlMessage
        });

        // Return more detailed error for debugging
        res.status(500).json({
            success: false,
            message: error.sqlMessage || error.message || 'Failed to clock out. Please try again.',
            error_code: error.code,
            error_type: error.name
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
 * Start lunch break with photo and GPS
 */
router.post('/break-start', requireAuth, upload.single('photo'), async (req, res) => {
    try {
        const userId = req.user.id;
        const { latitude, longitude } = req.body;
        const photo = req.file;
        const today = new Date().toISOString().split('T')[0];
        const now = new Date();

        if (!photo) {
            return res.status(400).json({ success: false, message: 'Photo is required for break start' });
        }
        if (!latitude || !longitude || !validateGPS(latitude, longitude)) {
            return res.status(400).json({ success: false, message: 'Valid GPS location is required' });
        }

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

        // Save break photo
        const photoPath = await saveAttendancePhoto(photo.buffer, userId, 'break');

        // Update attendance with break start + photo + GPS
        await pool.query(
            `UPDATE staff_attendance SET break_start_time = ?,
             break_start_photo = ?, break_start_lat = ?, break_start_lng = ?
             WHERE id = ?`,
            [now, photoPath, latitude, longitude, record.id]
        );

        // Save photo record
        await pool.query(
            `INSERT INTO attendance_photos
             (attendance_id, user_id, photo_type, file_path, file_size,
              latitude, longitude, captured_at, delete_after)
             VALUES (?, ?, 'break_start', ?, ?, ?, ?, ?, ?)`,
            [record.id, userId, photoPath, photo.size, latitude, longitude, now, getDeleteAfterDate()]
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
 * End lunch break with photo and GPS
 */
router.post('/break-end', requireAuth, upload.single('photo'), async (req, res) => {
    try {
        const userId = req.user.id;
        const { latitude, longitude } = req.body;
        const photo = req.file;
        const today = new Date().toISOString().split('T')[0];
        const now = new Date();

        if (!photo) {
            return res.status(400).json({ success: false, message: 'Photo is required for break end' });
        }
        if (!latitude || !longitude || !validateGPS(latitude, longitude)) {
            return res.status(400).json({ success: false, message: 'Valid GPS location is required' });
        }

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
        const breakDuration = Math.floor((now - breakStart) / 1000 / 60);

        // Check if break is too short or too long
        const warnings = [];
        if (breakDuration < record.break_min_minutes) {
            warnings.push(`Break was shorter than minimum ${record.break_min_minutes} minutes`);
        }
        if (breakDuration > record.break_max_minutes) {
            warnings.push(`Break exceeded maximum ${record.break_max_minutes} minutes`);
        }

        // Save break photo
        const photoPath = await saveAttendancePhoto(photo.buffer, userId, 'break');

        // Update attendance with break end + photo + GPS
        await pool.query(
            `UPDATE staff_attendance
             SET break_end_time = ?, break_duration_minutes = ?,
             break_end_photo = ?, break_end_lat = ?, break_end_lng = ?
             WHERE id = ?`,
            [now, breakDuration, photoPath, latitude, longitude, record.id]
        );

        // Save photo record
        await pool.query(
            `INSERT INTO attendance_photos
             (attendance_id, user_id, photo_type, file_path, file_size,
              latitude, longitude, captured_at, delete_after)
             VALUES (?, ?, 'break_end', ?, ?, ?, ?, ?, ?)`,
            [record.id, userId, photoPath, photo.size, latitude, longitude, now, getDeleteAfterDate()]
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
 * GET /api/attendance/permission/all
 * Get all permission requests with optional status filter (for admin/manager)
 */
router.get('/permission/all', requirePermission('attendance', 'approve'), async (req, res) => {
    try {
        const { status, branch_id, limit = 100 } = req.query;

        let query = `
            SELECT ap.*,
                   u.full_name as user_name,
                   u.username,
                   b.name as branch_name,
                   reviewer.full_name as reviewed_by_name
            FROM attendance_permissions ap
            JOIN users u ON ap.user_id = u.id
            LEFT JOIN staff_attendance sa ON ap.attendance_id = sa.id
            LEFT JOIN branches b ON sa.branch_id = b.id
            LEFT JOIN users reviewer ON ap.reviewed_by = reviewer.id
            WHERE 1=1
        `;

        const params = [];

        if (status) {
            query += ' AND ap.status = ?';
            params.push(status);
        }

        if (branch_id) {
            query += ' AND sa.branch_id = ?';
            params.push(branch_id);
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
        console.error('Get all permissions error:', error);
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

        // Notify requesting staff
        try {
            await notificationService.send(permission.user_id, {
                type: 'permission_approved', title: 'Permission Approved',
                body: `Your ${permission.request_type || 'attendance'} permission request has been approved.`,
                data: { type: 'permission_approved', permission_id: parseInt(permissionId) }
            });
        } catch (notifErr) { console.error('Permission approve notification error:', notifErr.message); }

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
             SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, rejection_reason = ?, review_notes = ?
             WHERE id = ?`,
            [reviewerId, now, review_notes, review_notes, permissionId]
        );

        // No working minutes adjustment for rejection

        // Notify requesting staff
        try {
            await notificationService.send(permission.user_id, {
                type: 'permission_rejected', title: 'Permission Rejected',
                body: `Your ${permission.request_type || 'attendance'} permission request was rejected. Reason: ${review_notes}`,
                data: { type: 'permission_rejected', permission_id: parseInt(permissionId) }
            });
        } catch (notifErr) { console.error('Permission reject notification error:', notifErr.message); }

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
            const adminNote = '\n[Admin override by ID ' + adminId + ']: ';
            await pool.query(
                `UPDATE staff_attendance
                 SET status = ?, notes = CONCAT(COALESCE(notes, ''), ?, ?)
                 WHERE id = ?`,
                [status, adminNote, notes || 'Status changed', existing[0].id]
            );

            return res.json({
                success: true,
                message: 'Attendance updated successfully',
                data: { attendance_id: existing[0].id }
            });
        }

        // Create new record
        const manualNote = 'Manually marked by admin (ID: ' + adminId + '). ' + (notes || '');
        const [result] = await pool.query(
            `INSERT INTO staff_attendance
             (user_id, branch_id, date, status, expected_hours, notes)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [user_id, branchId, date, status, shopHours.expected_hours, manualNote]
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

/**
 * POST /api/attendance/admin/force-clockout
 * Admin: Force clock out a staff member
 */
router.post('/admin/force-clockout', requirePermission('attendance', 'manage'), async (req, res) => {
    try {
        const adminId = req.user.id;
        const { attendance_id, notes } = req.body;

        if (!attendance_id) {
            return res.status(400).json({ success: false, message: 'attendance_id is required' });
        }

        // Get the attendance record
        const [records] = await pool.query(
            `SELECT a.*, u.full_name FROM staff_attendance a
             JOIN users u ON a.user_id = u.id WHERE a.id = ?`,
            [attendance_id]
        );

        if (records.length === 0) {
            return res.status(404).json({ success: false, message: 'Attendance record not found' });
        }

        const record = records[0];

        if (record.clock_out_time) {
            return res.status(400).json({ success: false, message: 'Staff already clocked out' });
        }

        const now = new Date();
        const breakMinutes = record.break_duration_minutes || 0;
        const workingMinutes = Math.round(((now - new Date(record.clock_in_time)) / 1000 / 60) - breakMinutes);
        const adminNote = `\n[Forced clock-out by admin ID:${adminId}]${notes ? ' ' + notes : ''}`;

        // End active break if any
        await pool.query(
            `UPDATE staff_attendance
             SET break_end_time = ?,
                 break_duration_minutes = TIMESTAMPDIFF(MINUTE, break_start_time, ?)
             WHERE id = ? AND break_start_time IS NOT NULL AND break_end_time IS NULL`,
            [now, now, attendance_id]
        );

        // Clock out
        await pool.query(
            `UPDATE staff_attendance
             SET clock_out_time = ?, total_working_minutes = ?,
                 notes = CONCAT(COALESCE(notes, ''), ?)
             WHERE id = ?`,
            [now, workingMinutes, adminNote, attendance_id]
        );

        // Notify the staff member
        try {
            const notificationService = require('../services/notification-service');
            await notificationService.send(record.user_id, {
                type: 'force_clockout',
                title: 'Clocked Out by Admin',
                body: `You have been clocked out by admin.${notes ? ' Reason: ' + notes : ''}`,
                data: { type: 'force_clockout', attendance_id: parseInt(attendance_id) }
            });
        } catch (notifErr) {
            console.error('Force clockout notification error:', notifErr.message);
        }

        res.json({
            success: true,
            message: `${record.full_name} has been clocked out`,
            data: {
                attendance_id,
                clock_out_time: now,
                total_working_minutes: workingMinutes
            }
        });

    } catch (error) {
        console.error('Force clockout error:', error);
        res.status(500).json({ success: false, message: 'Failed to force clock out' });
    }
});

/**
 * GET /api/attendance/admin/today-summary
 * Consolidated stats for admin dashboard
 */
router.get('/admin/today-summary', requirePermission('attendance', 'view'), async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];

        // Get total active staff
        const [staffRows] = await pool.query(
            "SELECT COUNT(*) as total FROM users WHERE role = 'staff' AND status = 'active'"
        );
        const totalStaff = staffRows[0].total;

        // Get today's attendance stats
        const [attendanceRows] = await pool.query(
            `SELECT
                COUNT(*) as present,
                SUM(CASE WHEN is_late = 1 THEN 1 ELSE 0 END) as late,
                SUM(CASE WHEN break_start_time IS NOT NULL AND break_end_time IS NULL THEN 1 ELSE 0 END) as on_break,
                SUM(CASE WHEN clock_out_time IS NULL THEN 1 ELSE 0 END) as not_clocked_out
             FROM staff_attendance
             WHERE date = ? AND status = 'present'`,
            [today]
        );

        const stats = attendanceRows[0];
        const present = stats.present || 0;

        // Get pending permission count
        const [permRows] = await pool.query(
            "SELECT COUNT(*) as pending FROM attendance_permissions WHERE status = 'pending'"
        );

        res.json({
            success: true,
            data: {
                total_staff: totalStaff,
                present: present,
                absent: Math.max(0, totalStaff - present),
                late: stats.late || 0,
                on_break: stats.on_break || 0,
                not_clocked_out: stats.not_clocked_out || 0,
                pending_permissions: permRows[0].pending || 0
            }
        });

    } catch (error) {
        console.error('Admin today summary error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get attendance summary'
        });
    }
});

// ========================================
// GEO-FENCE MONITORING ENDPOINTS
// ========================================

/**
 * GET /api/attendance/geofence-check
 * Check if current location is within branch geo-fence
 */
router.get('/geofence-check', requireAuth, async (req, res) => {
    try {
        const { latitude, longitude } = req.query;
        if (!latitude || !longitude || !validateGPS(latitude, longitude)) {
            return res.status(400).json({ success: false, message: 'Valid GPS coordinates required' });
        }

        // Check if user has geo-fence enabled
        const [userGeoRows] = await pool.query(
            'SELECT geo_fence_enabled FROM users WHERE id = ?', [req.user.id]
        );
        const geoFenceEnabled = userGeoRows.length > 0 ? userGeoRows[0].geo_fence_enabled : true;

        if (!geoFenceEnabled) {
            return res.json({
                success: true,
                data: { allowed: true, distance: null, radius: null, geo_fence_disabled: true }
            });
        }

        // Check against all assigned branches
        const [assignedBranches] = await pool.query(
            `SELECT ub.branch_id, b.name, b.latitude, b.longitude, b.geo_fence_radius
             FROM user_branches ub
             JOIN branches b ON ub.branch_id = b.id
             WHERE ub.user_id = ?`,
            [req.user.id]
        );

        if (assignedBranches.length > 0) {
            let bestResult = { allowed: false, distance: Infinity, radius: 0 };
            for (const branch of assignedBranches) {
                const result = await checkGeoFence(branch.branch_id, latitude, longitude);
                if (result.allowed) {
                    return res.json({ success: true, data: { allowed: true, distance: result.distance, radius: result.radius, branch_name: branch.name } });
                }
                if (result.distance !== null && result.distance < bestResult.distance) {
                    bestResult = { ...result, branch_name: branch.name };
                }
            }
            return res.json({ success: true, data: bestResult });
        }

        // Fallback: single branch
        const branchId = req.user.branch_id;
        const result = await checkGeoFence(branchId, latitude, longitude);

        res.json({
            success: true,
            data: {
                allowed: result.allowed,
                distance: result.distance,
                radius: result.radius
            }
        });
    } catch (error) {
        console.error('Geofence check error:', error);
        res.status(500).json({ success: false, message: 'Failed to check geofence' });
    }
});

/**
 * POST /api/attendance/geofence-violation
 * Log a geofence violation (rate-limited: max 1 per 5 minutes per user)
 */
router.post('/geofence-violation', requireAuth, async (req, res) => {
    try {
        const { latitude, longitude, distance, radius, violation_type } = req.body;
        const userId = req.user.id;
        const branchId = req.user.branch_id;

        if (!latitude || !longitude) {
            return res.status(400).json({ success: false, message: 'Location required' });
        }

        // Rate limit: max 1 violation per 5 minutes per user
        const [recent] = await pool.query(
            `SELECT id FROM geofence_violations
             WHERE user_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 5 MINUTE)
             LIMIT 1`,
            [userId]
        );

        if (recent.length > 0) {
            return res.json({ success: true, message: 'Violation already logged recently', data: { rate_limited: true } });
        }

        const [result] = await pool.query(
            `INSERT INTO geofence_violations
             (user_id, branch_id, latitude, longitude, distance_from_fence, fence_radius, violation_type)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [userId, branchId, latitude, longitude, distance || 0, radius || 0, violation_type || 'left_area']
        );

        res.json({
            success: true,
            message: 'Violation logged',
            data: { id: result.insertId }
        });
    } catch (error) {
        console.error('Geofence violation log error:', error);
        res.status(500).json({ success: false, message: 'Failed to log violation' });
    }
});

/**
 * GET /api/attendance/geofence-violations
 * Admin view of geofence violations
 */
router.get('/geofence-violations', requirePermission('attendance', 'view'), async (req, res) => {
    try {
        const { user_id, branch_id, from_date, to_date, limit = 100 } = req.query;

        let query = `
            SELECT gv.*,
                   u.full_name as staff_name,
                   u.username,
                   b.name as branch_name
            FROM geofence_violations gv
            JOIN users u ON gv.user_id = u.id
            JOIN branches b ON gv.branch_id = b.id
            WHERE 1=1
        `;
        const params = [];

        if (user_id) {
            query += ' AND gv.user_id = ?';
            params.push(user_id);
        }
        if (branch_id) {
            query += ' AND gv.branch_id = ?';
            params.push(branch_id);
        }
        if (from_date) {
            query += ' AND DATE(gv.created_at) >= ?';
            params.push(from_date);
        }
        if (to_date) {
            query += ' AND DATE(gv.created_at) <= ?';
            params.push(to_date);
        }

        query += ' ORDER BY gv.created_at DESC LIMIT ?';
        params.push(parseInt(limit));

        const [violations] = await pool.query(query, params);

        res.json({
            success: true,
            count: violations.length,
            data: violations
        });
    } catch (error) {
        console.error('Geofence violations list error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch violations' });
    }
});

/**
 * GET /api/attendance/record/:id
 * Get a single attendance record with full details (for admin photo viewer)
 */
router.get('/record/:id', requirePermission('attendance', 'view'), async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT a.*,
                    u.full_name, u.username,
                    b.name as branch_name
             FROM staff_attendance a
             JOIN users u ON a.user_id = u.id
             JOIN branches b ON a.branch_id = b.id
             WHERE a.id = ?`,
            [req.params.id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Attendance record not found' });
        }

        res.json({ success: true, data: rows[0] });
    } catch (error) {
        console.error('Get attendance record error:', error);
        res.status(500).json({ success: false, message: 'Failed to get attendance record' });
    }
});

module.exports = {
    router,
    setPool
};
