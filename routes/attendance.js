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
 * Get today's date in IST (UTC+5:30) as YYYY-MM-DD string
 */
function getTodayIST() {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(now.getTime() + istOffset);
    return istDate.toISOString().split('T')[0];
}

/**
 * Get current IST Date object
 */
function getNowIST() {
    return new Date(new Date().getTime() + (5.5 * 60 * 60 * 1000));
}

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
        break_max_minutes: 120,
        break_allowance_minutes: 120,
        break_warning_minutes: 90
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

        const today = getTodayIST();
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
            'SELECT id, clock_out_time, allow_reclockin, total_working_minutes, expected_hours FROM staff_attendance WHERE user_id = ? AND date = ? ORDER BY id DESC LIMIT 1',
            [userId, today]
        );

        let isReclockin = false;
        let previousRecordId = null;
        let previousWorkedMinutes = 0;

        if (existing.length > 0) {
            const lastRecord = existing[0];

            if (lastRecord.clock_out_time) {
                // Clocked out - check if re-clock-in is allowed
                let reclockinAllowed = lastRecord.allow_reclockin === 1;

                // Fallback: check permissions table if flag not set
                if (!reclockinAllowed) {
                    const [approvedPerm] = await pool.query(
                        `SELECT id FROM attendance_permissions
                         WHERE user_id = ? AND request_type = 're_clockin' AND request_date = ? AND status = 'approved'
                         ORDER BY id DESC LIMIT 1`,
                        [userId, today]
                    );
                    reclockinAllowed = approvedPerm.length > 0;
                }

                if (reclockinAllowed) {
                    isReclockin = true;
                    previousRecordId = lastRecord.id;
                    previousWorkedMinutes = lastRecord.total_working_minutes || 0;
                    // Continue to create new record below
                } else {
                    return res.status(400).json({
                        success: false,
                        message: 'You have already clocked out today. Request re-clock-in first.',
                        code: 'ALREADY_CLOCKED_OUT'
                    });
                }
            } else {
                return res.status(400).json({
                    success: false,
                    message: 'You have already clocked in today',
                    code: 'ALREADY_CLOCKED_IN'
                });
            }
        }

        // Get shop hours
        const shopHours = await getShopHours(branchId, today);

        // Check if late (skip for re-clock-in)
        const currentTime = now.toTimeString().split(' ')[0];
        const late = isReclockin ? false : isLateArrival(currentTime, shopHours.open_time, shopHours.late_threshold_minutes);

        // Determine if this re-clock-in counts as overtime
        const expectedMinutes = parseFloat(shopHours.expected_hours) * 60;
        const isOvertime = isReclockin && previousWorkedMinutes >= expectedMinutes;

        // Save photo
        const photoPath = await saveAttendancePhoto(photo.buffer, userId, 'clock-in');

        // Create attendance record (include break_allowance_minutes from shop hours)
        const breakAllowanceForRecord = shopHours.break_allowance_minutes || 120;
        const [result] = await pool.query(
            `INSERT INTO staff_attendance
             (user_id, branch_id, date, clock_in_time, clock_in_photo,
              clock_in_lat, clock_in_lng, clock_in_address,
              is_late, expected_hours, status, clock_in_distance, is_reclockin, is_overtime,
              break_allowance_minutes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'present', ?, ?, ?, ?)`,
            [userId, branchId, today, now, photoPath, latitude, longitude,
             address, late ? 1 : 0, shopHours.expected_hours, clockInDistance,
             isReclockin ? 1 : 0, isOvertime ? 1 : 0, breakAllowanceForRecord]
        );

        // Reset allow_reclockin flag AFTER successful record creation
        if (isReclockin && previousRecordId) {
            await pool.query(
                'UPDATE staff_attendance SET allow_reclockin = 0 WHERE id = ?',
                [previousRecordId]
            );
        }
        
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

        const today = getTodayIST();
        const now = new Date();

        // Get today's attendance
        const [attendance] = await pool.query(
            `SELECT a.*, shc.close_time, shc.expected_hours
             FROM staff_attendance a
             JOIN shop_hours_config shc ON a.branch_id = shc.branch_id
                AND shc.day_of_week = LOWER(DAYNAME(a.date))
             WHERE a.user_id = ? AND a.date = ?
             ORDER BY a.id DESC LIMIT 1`,
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

        // Calculate break enforcement data
        const breakAllowance = record.break_allowance_minutes || 120;
        const totalBreak = record.break_duration_minutes || 0;
        const excessBreak = Math.max(0, totalBreak - breakAllowance);
        const breakExceeded = excessBreak > 0 ? 1 : 0;
        // effective_working_minutes = same as workingMinutes since calculateWorkingMinutes already deducts ALL break
        const effectiveWorking = workingMinutes;

        // Auto-end active prayer period on clock-out
        const [activePrayerClockout] = await pool.query(
            "SELECT * FROM prayer_periods WHERE user_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1",
            [userId]
        );
        if (activePrayerClockout.length > 0) {
            const pp = activePrayerClockout[0];
            const prayerDur = Math.round((now - new Date(pp.start_time)) / 1000 / 60);
            await pool.query(
                `UPDATE prayer_periods SET end_time = ?, duration_minutes = ?, status = 'ended' WHERE id = ?`,
                [now, prayerDur, pp.id]
            );
            await pool.query(
                'UPDATE staff_attendance SET prayer_minutes = prayer_minutes + ? WHERE id = ?',
                [prayerDur, pp.attendance_id]
            );
        }

        // Auto-end active outside work period on clock-out
        const [activeOWClockout] = await pool.query(
            "SELECT * FROM outside_work_periods WHERE user_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1",
            [userId]
        );
        if (activeOWClockout.length > 0) {
            const ow = activeOWClockout[0];
            const owDur = Math.round((now - new Date(ow.start_time)) / 1000 / 60);
            await pool.query(
                `UPDATE outside_work_periods SET end_time = ?, duration_minutes = ?, status = 'ended' WHERE id = ?`,
                [now, owDur, ow.id]
            );
            await pool.query(
                'UPDATE staff_attendance SET outside_work_minutes = outside_work_minutes + ? WHERE id = ?',
                [owDur, ow.attendance_id]
            );
        }

        // Check if early checkout
        const currentTime = now.toTimeString().split(' ')[0];
        const closeTime = new Date(`1970-01-01T${record.close_time}`);
        const currentDateTime = new Date(`1970-01-01T${currentTime}`);
        const isEarly = currentDateTime < closeTime;

        // Calculate overtime
        const expectedMinutes = (record.expected_hours || 10) * 60;
        const overtimeMinutes = Math.max(0, workingMinutes - expectedMinutes);

        // Update attendance with break enforcement data + overtime
        await pool.query(
            `UPDATE staff_attendance
             SET clock_out_time = ?, clock_out_photo = ?,
                 clock_out_lat = ?, clock_out_lng = ?, clock_out_address = ?,
                 total_working_minutes = ?, is_early_checkout = ?, clock_out_distance = ?,
                 excess_break_minutes = ?, break_exceeded = ?, effective_working_minutes = ?,
                 overtime_minutes = ?
             WHERE id = ?`,
            [now, photoPath, latitude, longitude, address, workingMinutes, isEarly ? 1 : 0, clockOutDistance,
             excessBreak, breakExceeded, effectiveWorking, overtimeMinutes, record.id]
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
        const today = getTodayIST();
        
        const [rows] = await pool.query(
            `SELECT a.*,
                    u.full_name, u.username,
                    b.name as branch_name,
                    shc.open_time, shc.close_time, shc.expected_hours,
                    shc.break_allowance_minutes as shop_break_allowance,
                    shc.break_warning_minutes as shop_break_warning
             FROM staff_attendance a
             JOIN users u ON a.user_id = u.id
             JOIN branches b ON a.branch_id = b.id
             LEFT JOIN shop_hours_config shc ON a.branch_id = shc.branch_id
                AND shc.day_of_week = LOWER(DAYNAME(a.date))
             WHERE a.user_id = ? AND a.date = ?
             ORDER BY a.id DESC LIMIT 1`,
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

        // Check for pending re-clockin request and total day minutes
        let reclockinStatus = null;
        let dayTotalMinutes = 0;
        if (attendance.clock_out_time) {
            const [reclockin] = await pool.query(
                `SELECT status FROM attendance_permissions
                 WHERE user_id = ? AND request_type = 're_clockin' AND request_date = ?
                 ORDER BY id DESC LIMIT 1`,
                [userId, today]
            );
            if (reclockin.length > 0) {
                reclockinStatus = reclockin[0].status;
            }

            // Sum total working minutes across all records today
            const [dayTotal] = await pool.query(
                'SELECT COALESCE(SUM(total_working_minutes), 0) as total FROM staff_attendance WHERE user_id = ? AND date = ?',
                [userId, today]
            );
            dayTotalMinutes = dayTotal[0].total;
        }

        // Check for active outside work period
        let outsideWork = null;
        if (!attendance.clock_out_time) {
            const [owRows] = await pool.query(
                "SELECT * FROM outside_work_periods WHERE user_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1",
                [userId]
            );
            if (owRows.length > 0) {
                outsideWork = owRows[0];
            }
        }

        // Check for active prayer period
        let prayer = null;
        if (!attendance.clock_out_time) {
            const [pRows] = await pool.query(
                "SELECT * FROM prayer_periods WHERE user_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1",
                [userId]
            );
            if (pRows.length > 0) {
                prayer = pRows[0];
            }
        }

        // Build break policy info
        const breakAllowance = attendance.break_allowance_minutes || attendance.shop_break_allowance || 120;
        const breakWarning = attendance.shop_break_warning || 90;
        const breakUsed = attendance.break_duration_minutes || 0;

        res.json({
            success: true,
            has_clocked_in: true,
            has_clocked_out: !!attendance.clock_out_time,
            reclockin_status: reclockinStatus,
            day_total_minutes: dayTotalMinutes,
            outside_work: outsideWork,
            prayer: prayer,
            overtime: {
                acknowledged: !!attendance.overtime_acknowledged,
                started_at: attendance.overtime_started_at,
                minutes: attendance.overtime_minutes || 0
            },
            break_policy: {
                allowance: breakAllowance,
                warning: breakWarning,
                used: breakUsed,
                remaining: Math.max(0, breakAllowance - breakUsed),
                exceeded: breakUsed > breakAllowance,
                excess: Math.max(0, breakUsed - breakAllowance)
            },
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
        const today = getTodayIST();
        const now = new Date();

        if (!photo) {
            return res.status(400).json({ success: false, message: 'Photo is required for break start' });
        }
        if (!latitude || !longitude || !validateGPS(latitude, longitude)) {
            return res.status(400).json({ success: false, message: 'Valid GPS location is required' });
        }

        // Get today's latest attendance (ORDER BY id DESC for re-clockin support)
        const [attendance] = await pool.query(
            'SELECT * FROM staff_attendance WHERE user_id = ? AND date = ? AND clock_out_time IS NULL ORDER BY id DESC LIMIT 1',
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

        if (record.break_start_time && !record.break_end_time) {
            return res.status(400).json({
                success: false,
                message: 'Break already started',
                code: 'BREAK_ALREADY_STARTED'
            });
        }

        // If previous break was completed, accumulate duration and reset for new break
        let previousBreakMinutes = 0;
        if (record.break_start_time && record.break_end_time) {
            previousBreakMinutes = record.break_duration_minutes || 0;
        }

        // Save break photo
        const photoPath = await saveAttendancePhoto(photo.buffer, userId, 'break');

        // Update attendance with break start + photo + GPS (reset end fields for new break)
        await pool.query(
            `UPDATE staff_attendance SET break_start_time = ?,
             break_start_photo = ?, break_start_lat = ?, break_start_lng = ?,
             break_end_time = NULL, break_end_photo = NULL, break_end_lat = NULL, break_end_lng = NULL,
             break_duration_minutes = ?
             WHERE id = ?`,
            [now, photoPath, latitude, longitude, previousBreakMinutes, record.id]
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
        const today = getTodayIST();
        const now = new Date();

        if (!photo) {
            return res.status(400).json({ success: false, message: 'Photo is required for break end' });
        }
        if (!latitude || !longitude || !validateGPS(latitude, longitude)) {
            return res.status(400).json({ success: false, message: 'Valid GPS location is required' });
        }

        // Get today's latest active attendance with shop hours (ORDER BY id DESC for re-clockin support)
        const [attendance] = await pool.query(
            `SELECT a.*, shc.break_min_minutes, shc.break_max_minutes
             FROM staff_attendance a
             JOIN shop_hours_config shc ON a.branch_id = shc.branch_id
                AND shc.day_of_week = LOWER(DAYNAME(a.date))
             WHERE a.user_id = ? AND a.date = ? AND a.clock_out_time IS NULL
             ORDER BY a.id DESC LIMIT 1`,
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

        // Calculate break duration (accumulate with previous breaks)
        const breakStart = new Date(record.break_start_time);
        const thisBreakMinutes = Math.floor((now - breakStart) / 1000 / 60);
        const previousBreakMinutes = record.break_duration_minutes || 0;
        const breakDuration = previousBreakMinutes + thisBreakMinutes;

        // Check break enforcement
        const shopHours = await getShopHours(record.branch_id, today);
        const breakAllowance = record.break_allowance_minutes || shopHours.break_allowance_minutes || 120;
        const breakWarningAt = shopHours.break_warning_minutes || 90;

        const warnings = [];
        if (breakDuration < record.break_min_minutes) {
            warnings.push(`Break was shorter than minimum ${record.break_min_minutes} minutes`);
        }

        let excessMinutes = 0;
        let breakExceeded = 0;
        let breakWarningSent = record.break_warning_sent || 0;

        if (breakDuration > breakAllowance) {
            excessMinutes = breakDuration - breakAllowance;
            breakExceeded = 1;
            warnings.push(`Break exceeded allowance by ${excessMinutes} minutes — excess will be deducted from working hours`);

            // Notify staff
            try {
                await notificationService.send(userId, {
                    type: 'break_exceeded',
                    title: 'Break Limit Exceeded',
                    body: `Your break exceeded the ${breakAllowance}min allowance by ${excessMinutes}min. Excess time will be deducted from working hours.`,
                    data: { type: 'break_exceeded', excess_minutes: excessMinutes }
                });
            } catch (e) { console.error('Break exceed notification (staff) error:', e.message); }

            // Notify admins
            try {
                const [admins] = await pool.query("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
                const [staffUser] = await pool.query('SELECT full_name FROM users WHERE id = ?', [userId]);
                const staffName = staffUser.length > 0 ? staffUser[0].full_name : 'Staff';
                for (const admin of admins) {
                    await notificationService.send(admin.id, {
                        type: 'break_exceeded',
                        title: 'Break Allowance Exceeded',
                        body: `${staffName} exceeded break allowance by ${excessMinutes}min (total: ${breakDuration}min).`,
                        data: { type: 'break_exceeded', staff_name: staffName, excess_minutes: excessMinutes }
                    }).catch(() => {});
                }
            } catch (e) { console.error('Break exceed notification (admin) error:', e.message); }
        } else if (breakDuration >= breakWarningAt && !breakWarningSent) {
            breakWarningSent = 1;
            warnings.push(`Break warning: ${breakAllowance - breakDuration} minutes remaining`);
        }

        // Save break photo
        const photoPath = await saveAttendancePhoto(photo.buffer, userId, 'break');

        // Update attendance with break end + photo + GPS + enforcement data
        await pool.query(
            `UPDATE staff_attendance
             SET break_end_time = ?, break_duration_minutes = ?,
             break_end_photo = ?, break_end_lat = ?, break_end_lng = ?,
             excess_break_minutes = ?, break_exceeded = ?, break_warning_sent = ?
             WHERE id = ?`,
            [now, breakDuration, photoPath, latitude, longitude,
             excessMinutes, breakExceeded, breakWarningSent, record.id]
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

/**
 * GET /api/attendance/break-status
 * Real-time break status for dashboard
 */
router.get('/break-status', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const today = getTodayIST();

        const [rows] = await pool.query(
            `SELECT a.break_duration_minutes, a.break_start_time, a.break_end_time,
                    a.break_allowance_minutes, a.break_warning_sent, a.break_exceeded,
                    a.excess_break_minutes,
                    COALESCE(shc.break_allowance_minutes, 120) as shop_break_allowance,
                    COALESCE(shc.break_warning_minutes, 90) as shop_break_warning
             FROM staff_attendance a
             LEFT JOIN shop_hours_config shc ON a.branch_id = shc.branch_id
                AND shc.day_of_week = LOWER(DAYNAME(a.date))
             WHERE a.user_id = ? AND a.date = ? AND a.clock_out_time IS NULL
             ORDER BY a.id DESC LIMIT 1`,
            [userId, today]
        );

        if (rows.length === 0) {
            return res.json({ success: true, data: null });
        }

        const record = rows[0];
        const allowance = record.break_allowance_minutes || record.shop_break_allowance || 120;
        const warningAt = record.shop_break_warning || 90;
        let totalUsed = record.break_duration_minutes || 0;

        // If currently on break, add elapsed break time
        if (record.break_start_time && !record.break_end_time) {
            const breakStart = new Date(record.break_start_time);
            const now = new Date();
            totalUsed += Math.floor((now - breakStart) / 1000 / 60);
        }

        res.json({
            success: true,
            data: {
                allowance: allowance,
                warning_at: warningAt,
                total_used: totalUsed,
                remaining: Math.max(0, allowance - totalUsed),
                is_exceeded: totalUsed > allowance,
                excess_minutes: Math.max(0, totalUsed - allowance),
                on_break: !!(record.break_start_time && !record.break_end_time)
            }
        });

    } catch (error) {
        console.error('Break status error:', error);
        res.status(500).json({ success: false, message: 'Failed to get break status' });
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
        
        const validTypes = ['late_arrival', 'early_checkout', 'early_leave', 'extended_break', 'leave', 'half_day', 're_clockin', 'outside_work'];
        if (!validTypes.includes(request_type)) {
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
 * POST /api/attendance/permission/request-reclockin
 * Submit a re-clock-in request (for overtime after clock-out)
 */
router.post('/permission/request-reclockin', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const { reason } = req.body;
        const today = getTodayIST();

        if (!reason || !reason.trim()) {
            return res.status(400).json({ success: false, message: 'Reason is required' });
        }

        // Check for existing clocked-out record today
        const [attendance] = await pool.query(
            'SELECT id FROM staff_attendance WHERE user_id = ? AND date = ? AND clock_out_time IS NOT NULL ORDER BY id DESC LIMIT 1',
            [userId, today]
        );

        if (attendance.length === 0) {
            return res.status(400).json({ success: false, message: 'No clocked-out record found for today' });
        }

        const attendanceId = attendance[0].id;

        // Check for existing pending re-clockin request
        const [existing] = await pool.query(
            `SELECT id FROM attendance_permissions
             WHERE user_id = ? AND request_type = 're_clockin' AND request_date = ? AND status = 'pending'`,
            [userId, today]
        );

        if (existing.length > 0) {
            return res.status(400).json({ success: false, message: 'You already have a pending re-clock-in request' });
        }

        // Create re-clockin permission request
        const [result] = await pool.query(
            `INSERT INTO attendance_permissions
             (user_id, attendance_id, request_type, request_date, reason, requested_by, status)
             VALUES (?, ?, 're_clockin', ?, ?, ?, 'pending')`,
            [userId, attendanceId, today, reason.trim(), userId]
        );

        // Notify admins
        try {
            const [admins] = await pool.query(
                `SELECT id FROM users WHERE role = 'admin' AND status = 'active'`
            );
            const staffName = req.user.full_name || req.user.username || 'Staff';
            for (const admin of admins) {
                await notificationService.send(admin.id, {
                    type: 'reclockin_request',
                    title: 'Re-Clock-In Request',
                    body: `${staffName} is requesting to clock in again for overtime.`,
                    data: { type: 'reclockin_request', permission_id: result.insertId }
                }).catch(() => {});
            }
        } catch (notifErr) {
            console.error('Re-clockin notification error:', notifErr.message);
        }

        res.json({
            success: true,
            message: 'Re-clock-in request submitted',
            data: { permission_id: result.insertId, status: 'pending' }
        });

    } catch (error) {
        console.error('Re-clockin request error:', error);
        res.status(500).json({ success: false, message: 'Failed to submit re-clock-in request' });
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

        // Handle re-clockin approval: set allow_reclockin flag
        if (permission.request_type === 're_clockin' && permission.attendance_id) {
            await pool.query(
                'UPDATE staff_attendance SET allow_reclockin = 1 WHERE id = ?',
                [permission.attendance_id]
            );
        }

        // If attendance exists, update working minutes (for non-reclockin types)
        if (permission.attendance_id && permission.duration_minutes && permission.request_type !== 're_clockin') {
            const currentMinutes = permission.total_working_minutes || 0;
            const newMinutes = currentMinutes + permission.duration_minutes;

            await pool.query(
                'UPDATE staff_attendance SET total_working_minutes = ? WHERE id = ?',
                [newMinutes, permission.attendance_id]
            );
        }

        // Notify requesting staff
        const notifBody = permission.request_type === 're_clockin'
            ? 'Your re-clock-in request has been approved! You can now clock in again.'
            : `Your ${(permission.request_type || 'attendance').replace(/_/g, ' ')} permission request has been approved.`;
        try {
            await notificationService.send(permission.user_id, {
                type: 'permission_approved', title: 'Permission Approved',
                body: notifBody,
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
        const reportDate = date || getTodayIST();
        
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
        const today = getTodayIST();

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
                SUM(CASE WHEN clock_out_time IS NULL THEN 1 ELSE 0 END) as not_clocked_out,
                SUM(CASE WHEN break_exceeded = 1 THEN 1 ELSE 0 END) as break_exceeded
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
                pending_permissions: permRows[0].pending || 0,
                break_exceeded: stats.break_exceeded || 0
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
 * POST /api/attendance/geo-auto-clockout
 * Auto clock-out staff who are 300m+ from branch
 */
router.post('/geo-auto-clockout', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const branchId = req.user.branch_id;
        const { latitude, longitude } = req.body;

        if (!latitude || !longitude) {
            return res.status(400).json({ success: false, message: 'Location required' });
        }

        const today = getTodayIST();

        // Get today's active attendance record
        const [records] = await pool.query(
            `SELECT a.*, b.latitude as branch_lat, b.longitude as branch_lng
             FROM staff_attendance a
             JOIN branches b ON a.branch_id = b.id
             WHERE a.user_id = ? AND a.date = ? AND a.clock_out_time IS NULL
             ORDER BY a.id DESC LIMIT 1`,
            [userId, today]
        );

        if (records.length === 0) {
            return res.status(400).json({ success: false, message: 'No active clock-in record found' });
        }

        const record = records[0];

        // Reject if on break
        if (record.break_start_time && !record.break_end_time) {
            return res.status(400).json({
                success: false,
                message: 'Staff is on break',
                code: 'ON_BREAK'
            });
        }

        // Reject if outside work period is active
        const [activeOW] = await pool.query(
            "SELECT id FROM outside_work_periods WHERE user_id = ? AND status = 'active' LIMIT 1",
            [userId]
        );
        if (activeOW.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Staff is on authorized outside work',
                code: 'OUTSIDE_WORK'
            });
        }

        // Reject if prayer period is active
        const [activePrayerGeo] = await pool.query(
            "SELECT id FROM prayer_periods WHERE user_id = ? AND status = 'active' LIMIT 1",
            [userId]
        );
        if (activePrayerGeo.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Staff is at prayer',
                code: 'AT_PRAYER'
            });
        }

        // Calculate distance from branch
        const distance = Math.round(calculateDistance(
            parseFloat(latitude), parseFloat(longitude),
            parseFloat(record.branch_lat), parseFloat(record.branch_lng)
        ));

        if (distance < 300) {
            return res.status(400).json({
                success: false,
                message: 'Still within branch area',
                distance
            });
        }

        const now = new Date();

        // End active break if any (safety)
        await pool.query(
            `UPDATE staff_attendance
             SET break_end_time = ?,
                 break_duration_minutes = TIMESTAMPDIFF(MINUTE, break_start_time, ?)
             WHERE id = ? AND break_start_time IS NOT NULL AND break_end_time IS NULL`,
            [now, now, record.id]
        );

        // Re-fetch break duration after ending break
        const [updated] = await pool.query(
            'SELECT break_duration_minutes FROM staff_attendance WHERE id = ?',
            [record.id]
        );
        const breakMinutes = (updated[0] && updated[0].break_duration_minutes) || record.break_duration_minutes || 0;

        // Calculate working minutes
        const workingMinutes = Math.round(((now - new Date(record.clock_in_time)) / 1000 / 60) - breakMinutes);
        const geoNote = `\n[Auto clock-out: ${distance}m from branch at ${now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}]`;

        // Clock out with auto_clockout tracking
        await pool.query(
            `UPDATE staff_attendance
             SET clock_out_time = ?, total_working_minutes = ?,
                 clock_out_lat = ?, clock_out_lng = ?, clock_out_distance = ?,
                 auto_clockout_type = 'geo', auto_clockout_distance = ?,
                 notes = CONCAT(COALESCE(notes, ''), ?)
             WHERE id = ?`,
            [now, workingMinutes, latitude, longitude, distance, distance, geoNote, record.id]
        );

        // Notify staff
        try {
            await notificationService.send(userId, {
                type: 'geo_auto_clockout',
                title: 'Auto Clock-Out',
                body: `You were automatically clocked out because you are ${distance}m from your branch.`,
                data: { type: 'geo_auto_clockout', attendance_id: record.id, distance }
            });
        } catch (notifErr) {
            console.error('Geo auto clockout notification error:', notifErr.message);
        }

        // Notify ALL active admins
        try {
            const [userInfo] = await pool.query('SELECT full_name FROM users WHERE id = ?', [userId]);
            const staffName = userInfo.length > 0 ? userInfo[0].full_name : 'Staff';
            const [admins] = await pool.query("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
            for (const admin of admins) {
                await notificationService.send(admin.id, {
                    type: 'geo_auto_clockout_admin',
                    title: 'Staff Auto Clock-Out',
                    body: `${staffName} was auto-clocked-out at ${distance}m from branch.`,
                    data: { type: 'geo_auto_clockout_admin', attendance_id: record.id, user_id: userId, distance }
                }).catch(() => {});
            }
        } catch (notifErr) {
            console.error('Admin geo clockout notification error:', notifErr.message);
        }

        res.json({
            success: true,
            message: `Auto clocked out - ${distance}m from branch`,
            data: {
                attendance_id: record.id,
                clock_out_time: now,
                distance,
                total_working_minutes: workingMinutes
            }
        });

    } catch (error) {
        console.error('Geo auto clockout error:', error);
        res.status(500).json({ success: false, message: 'Failed to auto clock out' });
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

// ========================================
// ABSENT STAFF ENDPOINT
// ========================================

/**
 * GET /api/attendance/admin/absent-today
 * Get list of staff who have NOT clocked in on a given date
 */
router.get('/admin/absent-today', requirePermission('attendance', 'view'), async (req, res) => {
    try {
        const { date, branch_id } = req.query;
        const targetDate = date || getTodayIST();

        let query = `
            SELECT u.id, u.full_name, u.phone, u.email, b.name as branch_name
            FROM users u
            LEFT JOIN branches b ON u.branch_id = b.id
            LEFT JOIN staff_attendance sa ON u.id = sa.user_id AND sa.date = ?
            WHERE u.role = 'staff' AND u.status = 'active'
              AND sa.id IS NULL
        `;
        const params = [targetDate];

        if (branch_id) {
            query += ' AND u.branch_id = ?';
            params.push(branch_id);
        }

        query += ' ORDER BY b.name, u.full_name';

        const [rows] = await pool.query(query, params);

        res.json({
            success: true,
            date: targetDate,
            count: rows.length,
            data: rows
        });
    } catch (error) {
        console.error('Absent today error:', error);
        res.status(500).json({ success: false, message: 'Failed to get absent staff' });
    }
});

// ========================================
// OUTSIDE WORK ENDPOINTS
// ========================================

/**
 * POST /api/attendance/outside-work/start
 * Start an outside work period (geofence exemption)
 */
router.post('/outside-work/start', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const { reason, latitude, longitude } = req.body;
        const today = getTodayIST();

        if (!reason || !reason.trim()) {
            return res.status(400).json({ success: false, message: 'Reason is required' });
        }

        // Must be clocked in
        const [attendance] = await pool.query(
            'SELECT * FROM staff_attendance WHERE user_id = ? AND date = ? AND clock_out_time IS NULL ORDER BY id DESC LIMIT 1',
            [userId, today]
        );

        if (attendance.length === 0) {
            return res.status(400).json({ success: false, message: 'You must be clocked in to start outside work' });
        }

        const record = attendance[0];

        // Must not be on break
        if (record.break_start_time && !record.break_end_time) {
            return res.status(400).json({ success: false, message: 'Please end your break before starting outside work' });
        }

        // Must not have active outside work period
        const [activeOW] = await pool.query(
            "SELECT id FROM outside_work_periods WHERE user_id = ? AND status = 'active' LIMIT 1",
            [userId]
        );

        if (activeOW.length > 0) {
            return res.status(400).json({ success: false, message: 'You already have an active outside work period' });
        }

        // Must not have active prayer period
        const [activePrayerOW] = await pool.query(
            "SELECT id FROM prayer_periods WHERE user_id = ? AND status = 'active' LIMIT 1",
            [userId]
        );
        if (activePrayerOW.length > 0) {
            return res.status(400).json({ success: false, message: 'Please end your prayer time before starting outside work' });
        }

        const now = new Date();
        const [result] = await pool.query(
            `INSERT INTO outside_work_periods (attendance_id, user_id, reason, start_time, start_lat, start_lng)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [record.id, userId, reason.trim(), now, latitude || null, longitude || null]
        );

        res.json({
            success: true,
            message: 'Outside work period started. Geofence monitoring paused.',
            data: { id: result.insertId, start_time: now, reason: reason.trim() }
        });

    } catch (error) {
        console.error('Outside work start error:', error);
        res.status(500).json({ success: false, message: 'Failed to start outside work' });
    }
});

/**
 * POST /api/attendance/outside-work/end
 * End an active outside work period
 */
router.post('/outside-work/end', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const { latitude, longitude } = req.body;

        const [active] = await pool.query(
            "SELECT * FROM outside_work_periods WHERE user_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1",
            [userId]
        );

        if (active.length === 0) {
            return res.status(400).json({ success: false, message: 'No active outside work period found' });
        }

        const period = active[0];
        const now = new Date();
        const durationMinutes = Math.round((now - new Date(period.start_time)) / 1000 / 60);

        // Update the period
        await pool.query(
            `UPDATE outside_work_periods
             SET end_time = ?, end_lat = ?, end_lng = ?, duration_minutes = ?, status = 'ended'
             WHERE id = ?`,
            [now, latitude || null, longitude || null, durationMinutes, period.id]
        );

        // Accumulate outside work minutes on attendance record
        await pool.query(
            'UPDATE staff_attendance SET outside_work_minutes = outside_work_minutes + ? WHERE id = ?',
            [durationMinutes, period.attendance_id]
        );

        res.json({
            success: true,
            message: `Outside work ended. Duration: ${durationMinutes} minutes. Geofence monitoring resumed.`,
            data: { id: period.id, duration_minutes: durationMinutes, end_time: now }
        });

    } catch (error) {
        console.error('Outside work end error:', error);
        res.status(500).json({ success: false, message: 'Failed to end outside work' });
    }
});

/**
 * GET /api/attendance/outside-work/status
 * Get current active outside work period
 */
router.get('/outside-work/status', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;

        const [active] = await pool.query(
            "SELECT * FROM outside_work_periods WHERE user_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1",
            [userId]
        );

        res.json({
            success: true,
            active: active.length > 0,
            data: active.length > 0 ? active[0] : null
        });

    } catch (error) {
        console.error('Outside work status error:', error);
        res.status(500).json({ success: false, message: 'Failed to get outside work status' });
    }
});

// ========================================
// ADMIN STAFF TIMELINE ENDPOINT
// ========================================

/**
 * GET /api/attendance/admin/staff-timeline
 * Comprehensive chronological timeline for a staff member on a given date
 */
router.get('/admin/staff-timeline', requirePermission('attendance', 'view'), async (req, res) => {
    try {
        const { user_id, date } = req.query;

        if (!user_id || !date) {
            return res.status(400).json({ success: false, message: 'user_id and date are required' });
        }

        // Get attendance records for user on this date
        const [attendanceRows] = await pool.query(
            `SELECT a.*, u.full_name, b.name as branch_name, b.latitude as branch_lat, b.longitude as branch_lng
             FROM staff_attendance a
             JOIN users u ON a.user_id = u.id
             JOIN branches b ON a.branch_id = b.id
             WHERE a.user_id = ? AND a.date = ?
             ORDER BY a.id ASC`,
            [user_id, date]
        );

        if (attendanceRows.length === 0) {
            return res.json({
                success: true,
                data: { staff_name: null, date, events: [], summary: null }
            });
        }

        const staffName = attendanceRows[0].full_name;
        const branchName = attendanceRows[0].branch_name;
        const events = [];

        for (const att of attendanceRows) {
            // Clock in
            if (att.clock_in_time) {
                events.push({
                    type: 'clock_in',
                    time: att.clock_in_time,
                    photo: att.clock_in_photo,
                    lat: att.clock_in_lat,
                    lng: att.clock_in_lng,
                    distance: att.clock_in_distance,
                    address: att.clock_in_address,
                    is_late: !!att.is_late,
                    is_reclockin: !!att.is_reclockin
                });
            }

            // Break start
            if (att.break_start_time) {
                events.push({
                    type: 'break_start',
                    time: att.break_start_time,
                    photo: att.break_start_photo,
                    lat: att.break_start_lat,
                    lng: att.break_start_lng
                });
            }

            // Break end
            if (att.break_end_time) {
                events.push({
                    type: 'break_end',
                    time: att.break_end_time,
                    photo: att.break_end_photo,
                    lat: att.break_end_lat,
                    lng: att.break_end_lng,
                    duration: att.break_duration_minutes
                });
            }

            // Clock out
            if (att.clock_out_time) {
                events.push({
                    type: att.auto_clockout_type ? `auto_clockout_${att.auto_clockout_type}` : 'clock_out',
                    time: att.clock_out_time,
                    photo: att.clock_out_photo,
                    lat: att.clock_out_lat,
                    lng: att.clock_out_lng,
                    distance: att.clock_out_distance,
                    address: att.clock_out_address,
                    auto_clockout_type: att.auto_clockout_type,
                    auto_clockout_distance: att.auto_clockout_distance
                });
            }
        }

        // Get outside work periods
        const attIds = attendanceRows.map(a => a.id);
        if (attIds.length > 0) {
            const [outsideWork] = await pool.query(
                `SELECT * FROM outside_work_periods WHERE attendance_id IN (?) ORDER BY start_time ASC`,
                [attIds]
            );

            for (const ow of outsideWork) {
                events.push({
                    type: 'outside_work_start',
                    time: ow.start_time,
                    lat: ow.start_lat,
                    lng: ow.start_lng,
                    reason: ow.reason
                });
                if (ow.end_time) {
                    events.push({
                        type: 'outside_work_end',
                        time: ow.end_time,
                        lat: ow.end_lat,
                        lng: ow.end_lng,
                        duration: ow.duration_minutes,
                        reason: ow.reason
                    });
                }
            }
        }

        // Get prayer periods
        if (attIds.length > 0) {
            const [prayerPeriods] = await pool.query(
                `SELECT * FROM prayer_periods WHERE attendance_id IN (?) ORDER BY start_time ASC`,
                [attIds]
            );

            for (const pp of prayerPeriods) {
                events.push({
                    type: 'prayer_start',
                    time: pp.start_time,
                    lat: pp.start_lat,
                    lng: pp.start_lng
                });
                if (pp.end_time) {
                    events.push({
                        type: 'prayer_end',
                        time: pp.end_time,
                        lat: pp.end_lat,
                        lng: pp.end_lng,
                        duration: pp.duration_minutes
                    });
                }
            }
        }

        // Get geofence violations
        const [violations] = await pool.query(
            `SELECT * FROM geofence_violations WHERE user_id = ? AND DATE(created_at) = ? ORDER BY created_at ASC`,
            [user_id, date]
        );

        for (const v of violations) {
            events.push({
                type: 'geofence_violation',
                time: v.created_at,
                lat: v.latitude,
                lng: v.longitude,
                distance: v.distance_from_fence,
                violation_type: v.violation_type
            });
        }

        // Get attendance photos
        const [photos] = await pool.query(
            `SELECT * FROM attendance_photos WHERE user_id = ? AND DATE(captured_at) = ? ORDER BY captured_at ASC`,
            [user_id, date]
        );

        // Sort events chronologically
        events.sort((a, b) => new Date(a.time) - new Date(b.time));

        // Compute summary
        const totalWorkingMinutes = attendanceRows.reduce((sum, a) => sum + (a.total_working_minutes || 0), 0);
        const totalBreakMinutes = attendanceRows.reduce((sum, a) => sum + (a.break_duration_minutes || 0), 0);
        const totalOutsideMinutes = attendanceRows.reduce((sum, a) => sum + (a.outside_work_minutes || 0), 0);
        const totalPrayerMinutes = attendanceRows.reduce((sum, a) => sum + (a.prayer_minutes || 0), 0);
        const violationCount = violations.length;

        res.json({
            success: true,
            data: {
                staff_name: staffName,
                branch_name: branchName,
                date,
                events,
                photos: photos.map(p => ({
                    id: p.id,
                    type: p.photo_type,
                    path: p.file_path,
                    time: p.captured_at,
                    lat: p.latitude,
                    lng: p.longitude
                })),
                summary: {
                    total_working_minutes: totalWorkingMinutes,
                    total_break_minutes: totalBreakMinutes,
                    total_outside_minutes: totalOutsideMinutes,
                    total_prayer_minutes: totalPrayerMinutes,
                    total_overtime_minutes: attendanceRows.reduce((sum, a) => sum + (a.overtime_minutes || 0), 0),
                    violation_count: violationCount,
                    records_count: attendanceRows.length
                }
            }
        });

    } catch (error) {
        console.error('Staff timeline error:', error);
        res.status(500).json({ success: false, message: 'Failed to get staff timeline' });
    }
});

// ========================================
// PRAYER TIME TRACKING ENDPOINTS
// ========================================

/**
 * POST /api/attendance/prayer/start
 * Start a prayer period (geofence exemption, mirrors outside work)
 */
router.post('/prayer/start', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const { latitude, longitude } = req.body;
        const today = getTodayIST();

        // Must be clocked in
        const [attendance] = await pool.query(
            'SELECT * FROM staff_attendance WHERE user_id = ? AND date = ? AND clock_out_time IS NULL ORDER BY id DESC LIMIT 1',
            [userId, today]
        );

        if (attendance.length === 0) {
            return res.status(400).json({ success: false, message: 'You must be clocked in to start prayer' });
        }

        const record = attendance[0];

        // Must not be on break
        if (record.break_start_time && !record.break_end_time) {
            return res.status(400).json({ success: false, message: 'Please end your break before starting prayer' });
        }

        // Must not have active outside work period
        const [activeOW] = await pool.query(
            "SELECT id FROM outside_work_periods WHERE user_id = ? AND status = 'active' LIMIT 1",
            [userId]
        );
        if (activeOW.length > 0) {
            return res.status(400).json({ success: false, message: 'Please end outside work before starting prayer' });
        }

        // Must not have active prayer period
        const [activePrayer] = await pool.query(
            "SELECT id FROM prayer_periods WHERE user_id = ? AND status = 'active' LIMIT 1",
            [userId]
        );
        if (activePrayer.length > 0) {
            return res.status(400).json({ success: false, message: 'You already have an active prayer period' });
        }

        const now = new Date();
        const [result] = await pool.query(
            `INSERT INTO prayer_periods (attendance_id, user_id, start_time, start_lat, start_lng)
             VALUES (?, ?, ?, ?, ?)`,
            [record.id, userId, now, latitude || null, longitude || null]
        );

        res.json({
            success: true,
            message: 'Prayer time started. Geofence monitoring paused.',
            data: { id: result.insertId, start_time: now }
        });

    } catch (error) {
        console.error('Prayer start error:', error);
        res.status(500).json({ success: false, message: 'Failed to start prayer' });
    }
});

/**
 * POST /api/attendance/prayer/end
 * End an active prayer period
 */
router.post('/prayer/end', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const { latitude, longitude } = req.body;

        const [active] = await pool.query(
            "SELECT * FROM prayer_periods WHERE user_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1",
            [userId]
        );

        if (active.length === 0) {
            return res.status(400).json({ success: false, message: 'No active prayer period found' });
        }

        const period = active[0];
        const now = new Date();
        const durationMinutes = Math.round((now - new Date(period.start_time)) / 1000 / 60);

        // Update the period
        await pool.query(
            `UPDATE prayer_periods
             SET end_time = ?, end_lat = ?, end_lng = ?, duration_minutes = ?, status = 'ended'
             WHERE id = ?`,
            [now, latitude || null, longitude || null, durationMinutes, period.id]
        );

        // Accumulate prayer minutes on attendance record
        await pool.query(
            'UPDATE staff_attendance SET prayer_minutes = prayer_minutes + ? WHERE id = ?',
            [durationMinutes, period.attendance_id]
        );

        res.json({
            success: true,
            message: `Prayer ended. Duration: ${durationMinutes} minutes. Geofence monitoring resumed.`,
            data: { id: period.id, duration_minutes: durationMinutes, end_time: now }
        });

    } catch (error) {
        console.error('Prayer end error:', error);
        res.status(500).json({ success: false, message: 'Failed to end prayer' });
    }
});

/**
 * GET /api/attendance/prayer/status
 * Get current active prayer period
 */
router.get('/prayer/status', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;

        const [active] = await pool.query(
            "SELECT * FROM prayer_periods WHERE user_id = ? AND status = 'active' ORDER BY id DESC LIMIT 1",
            [userId]
        );

        res.json({
            success: true,
            active: active.length > 0,
            data: active.length > 0 ? active[0] : null
        });

    } catch (error) {
        console.error('Prayer status error:', error);
        res.status(500).json({ success: false, message: 'Failed to get prayer status' });
    }
});

// ========================================
// OVERTIME TRACKING ENDPOINTS
// ========================================

/**
 * GET /api/attendance/check-overtime-status
 * Check if staff needs overtime prompt or force clock-out
 */
router.get('/check-overtime-status', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const today = getTodayIST();

        const [attendance] = await pool.query(
            `SELECT a.*, shc.expected_hours as config_expected_hours
             FROM staff_attendance a
             LEFT JOIN shop_hours_config shc ON a.branch_id = shc.branch_id
                AND shc.day_of_week = LOWER(DAYNAME(a.date))
             WHERE a.user_id = ? AND a.date = ? AND a.clock_out_time IS NULL
             ORDER BY a.id DESC LIMIT 1`,
            [userId, today]
        );

        if (attendance.length === 0) {
            return res.json({ success: true, needsOvertimePrompt: false, reason: 'not_clocked_in' });
        }

        const att = attendance[0];
        const now = new Date();
        const clockIn = new Date(att.clock_in_time);
        const elapsedMinutes = (now - clockIn) / 1000 / 60;
        const breakMinutes = att.break_duration_minutes || 0;
        const workingMinutes = Math.round(elapsedMinutes - breakMinutes);
        const expectedMinutes = (att.expected_hours || att.config_expected_hours || 10) * 60;

        // Check if working time exceeded expected hours
        if (workingMinutes >= expectedMinutes && !att.overtime_acknowledged) {
            return res.json({
                success: true,
                needsOvertimePrompt: true,
                working_minutes: workingMinutes,
                expected_minutes: expectedMinutes,
                overtime_minutes: workingMinutes - expectedMinutes,
                message: `Working time exceeded ${Math.round(expectedMinutes / 60)} hours`
            });
        }

        res.json({
            success: true,
            needsOvertimePrompt: false,
            working_minutes: workingMinutes,
            expected_minutes: expectedMinutes,
            overtime_acknowledged: !!att.overtime_acknowledged,
            overtime_started_at: att.overtime_started_at
        });
    } catch (error) {
        console.error('Check overtime error:', error);
        res.status(500).json({ success: false, message: 'Failed to check overtime status' });
    }
});

/**
 * POST /api/attendance/acknowledge-overtime
 * Staff confirms they want to continue working overtime
 */
router.post('/acknowledge-overtime', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const today = getTodayIST();
        const now = new Date();

        const [result] = await pool.query(
            `UPDATE staff_attendance
             SET overtime_acknowledged = 1,
                 overtime_acknowledged_at = ?,
                 overtime_started_at = ?
             WHERE user_id = ? AND date = ? AND clock_out_time IS NULL`,
            [now, now, userId, today]
        );

        if (result.affectedRows === 0) {
            return res.status(400).json({ success: false, message: 'No active attendance found' });
        }

        res.json({
            success: true,
            message: 'Overtime acknowledged. Continue working.',
            overtime_started_at: now
        });
    } catch (error) {
        console.error('Acknowledge overtime error:', error);
        res.status(500).json({ success: false, message: 'Failed to acknowledge overtime' });
    }
});

// ========================================
// DAILY ATTENDANCE REPORT ENDPOINTS
// ========================================

let attendanceReportService = null;
function setReportService(service) { attendanceReportService = service; }

/**
 * GET /api/attendance/report/preview
 * Preview the report text for a staff member on a date
 */
router.get('/report/preview', requirePermission('attendance.view'), async (req, res) => {
    try {
        const { user_id, date } = req.query;
        if (!user_id || !date) {
            return res.status(400).json({ success: false, message: 'user_id and date are required' });
        }

        if (!attendanceReportService) {
            return res.status(500).json({ success: false, message: 'Report service not available' });
        }

        const report = await attendanceReportService.generateReport(parseInt(user_id), date);
        if (!report) {
            return res.status(404).json({ success: false, message: 'No attendance data found for this date' });
        }

        res.json({ success: true, data: report });

    } catch (error) {
        console.error('Report preview error:', error);
        res.status(500).json({ success: false, message: 'Failed to generate report preview' });
    }
});

/**
 * POST /api/attendance/report/send
 * Send report to a single staff member via WhatsApp
 */
router.post('/report/send', requirePermission('attendance.manage'), async (req, res) => {
    try {
        const { user_id, date } = req.body;
        if (!user_id || !date) {
            return res.status(400).json({ success: false, message: 'user_id and date are required' });
        }

        if (!attendanceReportService) {
            return res.status(500).json({ success: false, message: 'Report service not available' });
        }

        const result = await attendanceReportService.sendReport(parseInt(user_id), date, req.user.id);
        res.json(result);

    } catch (error) {
        console.error('Report send error:', error);
        res.status(500).json({ success: false, message: 'Failed to send report' });
    }
});

/**
 * POST /api/attendance/report/send-all
 * Send reports to all staff for a date
 */
router.post('/report/send-all', requirePermission('attendance.manage'), async (req, res) => {
    try {
        const { date } = req.body;
        if (!date) {
            return res.status(400).json({ success: false, message: 'date is required' });
        }

        if (!attendanceReportService) {
            return res.status(500).json({ success: false, message: 'Report service not available' });
        }

        // Run in background, respond immediately
        attendanceReportService.sendAllReports(date, req.user.id);
        res.json({ success: true, message: 'Reports are being sent in the background. You will see progress updates.' });

    } catch (error) {
        console.error('Report send-all error:', error);
        res.status(500).json({ success: false, message: 'Failed to start sending reports' });
    }
});

/**
 * GET /api/attendance/report/staff-list
 * Get staff list with attendance data for report sending
 */
router.get('/report/staff-list', requirePermission('attendance.view'), async (req, res) => {
    try {
        const { date, branch_id } = req.query;
        if (!date) {
            return res.status(400).json({ success: false, message: 'date is required' });
        }

        let query = `
            SELECT a.id, a.user_id, a.clock_in_time, a.clock_out_time,
                   a.total_working_minutes, a.break_duration_minutes,
                   a.outside_work_minutes, a.prayer_minutes, a.overtime_minutes, a.branch_id,
                   u.full_name, u.phone, u.email,
                   b.name as branch_name,
                   dr.id as report_id, dr.sent_at, dr.delivery_status
            FROM staff_attendance a
            JOIN users u ON a.user_id = u.id
            JOIN branches b ON a.branch_id = b.id
            LEFT JOIN attendance_daily_reports dr ON dr.user_id = a.user_id AND dr.report_date = ?
            WHERE a.date = ? AND u.role != 'customer'
        `;
        const params = [date, date];

        if (branch_id) {
            query += ' AND a.branch_id = ?';
            params.push(parseInt(branch_id));
        }

        query += ' ORDER BY b.name, u.full_name';

        const [rows] = await pool.query(query, params);

        res.json({ success: true, data: rows });

    } catch (error) {
        console.error('Report staff list error:', error);
        res.status(500).json({ success: false, message: 'Failed to get staff list' });
    }
});

module.exports = {
    router,
    setPool,
    setReportService
};
