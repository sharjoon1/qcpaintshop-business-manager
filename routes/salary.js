/**
 * SALARY MODULE ROUTES
 * Handles salary configuration, calculation, and payment tracking
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const os = require('os');
const { requirePermission, requireAuth, requireRole } = require('../middleware/permissionMiddleware');
const notificationService = require('../services/notification-service');
const { generateSalarySlipPDF } = require('./salary-pdf-generator');

// WhatsApp session manager (optional - loaded dynamically)
let sessionManager;
try { sessionManager = require('../services/whatsapp-session-manager'); } catch {}

// Database connection (imported from main app)
let pool;

function setPool(dbPool) {
    pool = dbPool;
}

// ========================================
// STAFF SELF-SERVICE ENDPOINTS
// (Must be BEFORE /:id routes to avoid param conflicts)
// ========================================

/**
 * GET /my-config - Staff views own salary configuration
 */
router.get('/my-config', requireAuth, async (req, res) => {
    try {
        const [configs] = await pool.query(`
            SELECT sc.*, b.name as branch_name
            FROM staff_salary_config sc
            JOIN branches b ON sc.branch_id = b.id
            WHERE sc.user_id = ? AND sc.is_active = 1
            ORDER BY sc.effective_from DESC LIMIT 1
        `, [req.user.id]);

        res.json({
            success: true,
            data: configs.length > 0 ? configs[0] : null
        });
    } catch (error) {
        console.error('Error fetching own salary config:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch salary configuration' });
    }
});

/**
 * GET /my-monthly - Staff views own monthly salary history
 */
router.get('/my-monthly', requireAuth, async (req, res) => {
    try {
        const { month } = req.query;
        let query = `
            SELECT ms.*, b.name as branch_name
            FROM monthly_salaries ms
            JOIN branches b ON ms.branch_id = b.id
            WHERE ms.user_id = ?
        `;
        const params = [req.user.id];

        if (month) {
            query += ' AND ms.salary_month = ?';
            params.push(month);
        }

        query += ' ORDER BY ms.salary_month DESC LIMIT 12';

        const [salaries] = await pool.query(query, params);

        res.json({ success: true, data: salaries });
    } catch (error) {
        console.error('Error fetching own monthly salary:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch monthly salary data' });
    }
});

/**
 * GET /my-payments - Staff views own payment history
 */
router.get('/my-payments', requireAuth, async (req, res) => {
    try {
        const [payments] = await pool.query(`
            SELECT sp.*, ms.salary_month, ms.net_salary,
                   payer.full_name as paid_by_name
            FROM salary_payments sp
            JOIN monthly_salaries ms ON sp.monthly_salary_id = ms.id
            LEFT JOIN users payer ON sp.paid_by = payer.id
            WHERE sp.user_id = ?
            ORDER BY sp.payment_date DESC LIMIT 50
        `, [req.user.id]);

        res.json({ success: true, data: payments });
    } catch (error) {
        console.error('Error fetching own payments:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch payment history' });
    }
});

/**
 * GET /my-advances - Staff views own advance history
 */
router.get('/my-advances', requireAuth, async (req, res) => {
    try {
        const [advances] = await pool.query(`
            SELECT sa.*, b.name as branch_name,
                   ab.full_name as approved_by_name,
                   rb.full_name as rejected_by_name
            FROM salary_advances sa
            LEFT JOIN branches b ON sa.branch_id = b.id
            LEFT JOIN users ab ON sa.approved_by = ab.id
            LEFT JOIN users rb ON sa.rejected_by = rb.id
            WHERE sa.user_id = ?
            ORDER BY sa.created_at DESC LIMIT 50
        `, [req.user.id]);

        res.json({ success: true, data: advances });
    } catch (error) {
        console.error('Error fetching own advances:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch advance history' });
    }
});

/**
 * POST /my-advance-request - Staff submits advance request
 */
router.post('/my-advance-request', requireAuth, async (req, res) => {
    try {
        const { amount, reason } = req.body;
        const userId = req.user.id;
        const branchId = req.user.branch_id;

        if (!amount || parseFloat(amount) <= 0) {
            return res.status(400).json({ success: false, message: 'Please enter a valid amount greater than 0' });
        }

        if (!branchId) {
            return res.status(400).json({
                success: false,
                message: 'You are not assigned to a branch. Please contact admin to assign your branch first.'
            });
        }

        // Check for existing pending request
        const [pending] = await pool.query(
            "SELECT id FROM salary_advances WHERE user_id = ? AND status = 'pending'",
            [userId]
        );
        if (pending.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'You already have a pending advance request. Please wait for it to be processed.'
            });
        }

        const [result] = await pool.query(
            `INSERT INTO salary_advances (user_id, branch_id, amount, reason, requested_by, status)
             VALUES (?, ?, ?, ?, ?, 'pending')`,
            [userId, branchId, parseFloat(amount), reason || null, userId]
        );

        res.status(201).json({
            success: true,
            message: 'Advance request submitted successfully',
            data: { id: result.insertId }
        });
    } catch (error) {
        console.error('Error creating advance request:', error);
        res.status(500).json({ success: false, message: 'Failed to submit advance request' });
    }
});

// ========================================
// SALARY CONFIGURATION ROUTES
// ========================================

/**
 * GET all staff salary configurations
 */
router.get('/config', requireRole('admin', 'manager', 'accountant'), requirePermission('salary', 'view'), async (req, res) => {
    try {
        const { branch_id, user_id, is_active } = req.query;
        
        let query = `
            SELECT 
                sc.*,
                u.full_name as staff_name,
                u.email as staff_email,
                u.phone as staff_phone,
                b.name as branch_name,
                creator.full_name as created_by_name
            FROM staff_salary_config sc
            JOIN users u ON sc.user_id = u.id
            JOIN branches b ON sc.branch_id = b.id
            LEFT JOIN users creator ON sc.created_by = creator.id
            WHERE 1=1
        `;
        
        const params = [];
        
        if (branch_id) {
            query += ' AND sc.branch_id = ?';
            params.push(branch_id);
        }
        
        if (user_id) {
            query += ' AND sc.user_id = ?';
            params.push(user_id);
        }
        
        if (is_active !== undefined) {
            query += ' AND sc.is_active = ?';
            params.push(is_active === 'true' ? 1 : 0);
        }
        
        query += ' ORDER BY sc.is_active DESC, sc.effective_from DESC';
        
        const [configs] = await pool.query(query, params);
        
        res.json({
            success: true,
            data: configs
        });
        
    } catch (error) {
        console.error('Error fetching salary configs:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch salary configurations'
        });
    }
});

/**
 * GET single staff salary configuration
 */
router.get('/config/:id', requireRole('admin', 'manager', 'accountant'), requirePermission('salary', 'view'), async (req, res) => {
    try {
        const [configs] = await pool.query(`
            SELECT 
                sc.*,
                u.full_name as staff_name,
                u.email as staff_email,
                b.name as branch_name
            FROM staff_salary_config sc
            JOIN users u ON sc.user_id = u.id
            JOIN branches b ON sc.branch_id = b.id
            WHERE sc.id = ?
        `, [req.params.id]);
        
        if (configs.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Salary configuration not found'
            });
        }
        
        res.json({
            success: true,
            data: configs[0]
        });
        
    } catch (error) {
        console.error('Error fetching salary config:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch salary configuration'
        });
    }
});

/**
 * POST create new salary configuration
 */
router.post('/config', requireAuth, requirePermission('salary', 'manage'), async (req, res) => {
    try {
        const {
            user_id,
            branch_id,
            monthly_salary,
            overtime_multiplier = 1.50,
            standard_daily_hours = 10.00,
            sunday_hours = 5.00,
            enable_late_deduction = 1,
            late_deduction_per_hour = 0,
            enable_absence_deduction = 1,
            transport_allowance = 0,
            food_allowance = 0,
            other_allowance = 0,
            allowance_notes = '',
            effective_from,
            effective_until = null
        } = req.body;
        
        // Validate required fields
        if (!user_id || !branch_id || !monthly_salary || !effective_from) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: user_id, branch_id, monthly_salary, effective_from'
            });
        }
        
        // Check if user exists and is staff
        const [users] = await pool.query(
            'SELECT id, role FROM users WHERE id = ? AND role = ?',
            [user_id, 'staff']
        );
        
        if (users.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'User not found or not a staff member'
            });
        }
        
        // Deactivate previous configs for this user
        await pool.query(
            'UPDATE staff_salary_config SET is_active = 0 WHERE user_id = ? AND is_active = 1',
            [user_id]
        );
        
        // Insert new config
        const [result] = await pool.query(`
            INSERT INTO staff_salary_config (
                user_id, branch_id, monthly_salary, overtime_multiplier,
                standard_daily_hours, sunday_hours,
                enable_late_deduction, late_deduction_per_hour, enable_absence_deduction,
                transport_allowance, food_allowance, other_allowance, allowance_notes,
                effective_from, effective_until, is_active, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        `, [
            user_id, branch_id, monthly_salary, overtime_multiplier,
            standard_daily_hours, sunday_hours,
            enable_late_deduction, late_deduction_per_hour, enable_absence_deduction,
            transport_allowance, food_allowance, other_allowance, allowance_notes,
            effective_from, effective_until, req.user.id
        ]);
        
        res.json({
            success: true,
            message: 'Salary configuration created successfully',
            data: {
                id: result.insertId
            }
        });
        
    } catch (error) {
        console.error('Error creating salary config:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create salary configuration'
        });
    }
});

/**
 * PUT update salary configuration
 */
router.put('/config/:id', requireAuth, requirePermission('salary', 'manage'), async (req, res) => {
    try {
        const updates = req.body;
        const allowedFields = [
            'monthly_salary', 'overtime_multiplier', 'standard_daily_hours', 'sunday_hours',
            'enable_late_deduction', 'late_deduction_per_hour', 'enable_absence_deduction',
            'transport_allowance', 'food_allowance', 'other_allowance', 'allowance_notes',
            'effective_until', 'is_active'
        ];
        
        const setClause = [];
        const values = [];
        
        Object.keys(updates).forEach(key => {
            if (allowedFields.includes(key)) {
                setClause.push(`${key} = ?`);
                values.push(updates[key]);
            }
        });
        
        if (setClause.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No valid fields to update'
            });
        }
        
        values.push(req.params.id);
        
        await pool.query(
            `UPDATE staff_salary_config SET ${setClause.join(', ')} WHERE id = ?`,
            values
        );
        
        res.json({
            success: true,
            message: 'Salary configuration updated successfully'
        });
        
    } catch (error) {
        console.error('Error updating salary config:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update salary configuration'
        });
    }
});

// ========================================
// MONTHLY SALARY CALCULATION ROUTES
// ========================================

/**
 * Calculate salary for a single user/month (inline logic)
 */
async function calculateSalaryForUser(userId, month, calculatedBy) {
    const fromDate = `${month}-01`;
    // Get last day of month (use local getters, NOT toISOString which converts to UTC and loses a day in IST)
    const lastDay = new Date(parseInt(month.split('-')[0]), parseInt(month.split('-')[1]), 0);
    const toDate = `${lastDay.getFullYear()}-${String(lastDay.getMonth() + 1).padStart(2, '0')}-${String(lastDay.getDate()).padStart(2, '0')}`;

    // Get active salary config (config effective_from must be <= month end, effective_until must be >= month start or NULL)
    const [configs] = await pool.query(
        `SELECT * FROM staff_salary_config
         WHERE user_id = ? AND is_active = 1
           AND effective_from <= ?
           AND (effective_until IS NULL OR effective_until >= ?)
         ORDER BY effective_from DESC
         LIMIT 1`,
        [userId, toDate, fromDate]
    );

    if (configs.length === 0) {
        throw new Error('No active salary configuration found for this user');
    }

    const config = configs[0];
    const hourlyRate = parseFloat(config.monthly_salary) / 260; // 26 days * 10 hours
    const overtimeMultiplier = parseFloat(config.overtime_multiplier);

    // Get attendance data for the month
    // NOTE: status IN ('present','half_day') ensures half-day worked hours are counted for salary
    // Sunday: 1 actual hr = 2 equivalent hrs, 5 actual hrs (300 min) = 1 day, then OT rule
    const [attendanceRows] = await pool.query(
        `SELECT
            COUNT(*) as total_days,
            SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END) as present_days,
            SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END) as absent_days,
            SUM(CASE WHEN status = 'half_day' THEN 1 ELSE 0 END) as half_days,
            SUM(CASE WHEN status = 'on_leave' THEN 1 ELSE 0 END) as leaves,
            SUM(CASE WHEN DAYOFWEEK(date) = 1 AND status IN ('present','half_day') THEN 1 ELSE 0 END) as sundays_worked,
            COALESCE(SUM(CASE WHEN DAYOFWEEK(date) != 1 AND status IN ('present','half_day')
                THEN LEAST(total_working_minutes, 600) ELSE 0 END) / 60, 0) as standard_hours,
            COALESCE(SUM(CASE WHEN DAYOFWEEK(date) = 1 AND status IN ('present','half_day')
                THEN LEAST(total_working_minutes, 300) ELSE 0 END) / 60, 0) as sunday_hours,
            COALESCE(SUM(CASE WHEN DAYOFWEEK(date) != 1 AND status IN ('present','half_day') AND total_working_minutes > 600
                THEN (total_working_minutes - 600) ELSE 0 END) / 60, 0) as overtime_hours,
            COALESCE(SUM(CASE WHEN DAYOFWEEK(date) = 1 AND status IN ('present','half_day') AND total_working_minutes > 300
                THEN (total_working_minutes - 300) * 2 ELSE 0 END) / 60, 0) as sunday_overtime_hours,
            COALESCE(SUM(CASE WHEN status IN ('present','half_day') THEN ot_approved_minutes ELSE 0 END) / 60, 0) as approved_overtime_hours,
            COALESCE(SUM(CASE WHEN is_late = 1 THEN 1 ELSE 0 END), 0) as late_days
         FROM staff_attendance
         WHERE user_id = ? AND date BETWEEN ? AND ?`,
        [userId, fromDate, toDate]
    );

    const att = attendanceRows[0];

    // Get approved leave count from attendance_permissions
    const [leaveRows] = await pool.query(
        `SELECT
            COALESCE(SUM(CASE WHEN DAYOFWEEK(request_date) = 1 THEN 1 ELSE 0 END), 0) as sunday_leaves,
            COALESCE(SUM(CASE WHEN DAYOFWEEK(request_date) != 1 THEN 1 ELSE 0 END), 0) as weekday_leaves
         FROM attendance_permissions
         WHERE user_id = ? AND request_type = 'leave' AND status = 'approved'
           AND request_date BETWEEN ? AND ?`,
        [userId, fromDate, toDate]
    );

    const leaveData = leaveRows[0];
    const sundayLeaves = parseInt(leaveData.sunday_leaves) || 0;
    const weekdayLeaves = parseInt(leaveData.weekday_leaves) || 0;

    // Leave policy: 1 paid Sunday leave + 1 paid weekday leave per month
    const FREE_SUNDAY_LEAVES = 1;
    const FREE_WEEKDAY_LEAVES = 1;
    const paidSundayLeaves = Math.min(sundayLeaves, FREE_SUNDAY_LEAVES);
    const paidWeekdayLeaves = Math.min(weekdayLeaves, FREE_WEEKDAY_LEAVES);
    const excessLeaves = Math.max(0, sundayLeaves - FREE_SUNDAY_LEAVES) + Math.max(0, weekdayLeaves - FREE_WEEKDAY_LEAVES);

    // Calculate pay components (Sunday: 1hr=2hrs equiv, 5 actual hrs=1 day, Weekday: 10 hrs=1 day)
    const WEEKDAY_HOURS_PER_DAY = 10;
    const SUNDAY_HOURS_PER_DAY = 5;
    const dailyRate = hourlyRate * WEEKDAY_HOURS_PER_DAY; // daily rate based on 10-hr day
    const standardHoursPay = parseFloat(att.standard_hours) * hourlyRate;
    const sundayHoursPay = (parseFloat(att.sunday_hours) / SUNDAY_HOURS_PER_DAY) * dailyRate;
    // Weekday approved OT + Sunday OT (auto-paid, already in equivalent hours)
    const weekdayOvertimePay = parseFloat(att.approved_overtime_hours) * hourlyRate * overtimeMultiplier;
    const sundayOvertimePay = parseFloat(att.sunday_overtime_hours) * hourlyRate * overtimeMultiplier;
    const overtimePay = weekdayOvertimePay + sundayOvertimePay;

    // Allowances from config
    const transportAllowance = parseFloat(config.transport_allowance) || 0;
    const foodAllowance = parseFloat(config.food_allowance) || 0;
    const otherAllowance = parseFloat(config.other_allowance) || 0;
    const totalAllowances = transportAllowance + foodAllowance + otherAllowance;

    // Deductions
    let lateDeduction = 0;
    if (config.enable_late_deduction && config.late_deduction_per_hour > 0) {
        lateDeduction = parseInt(att.late_days) * parseFloat(config.late_deduction_per_hour);
    }

    let absenceDeduction = 0;
    if (config.enable_absence_deduction && parseInt(att.absent_days) > 0) {
        absenceDeduction = parseInt(att.absent_days) * hourlyRate * parseFloat(config.standard_daily_hours);
    }

    // Leave deduction: excess leaves beyond free quota
    const leaveDeduction = excessLeaves * hourlyRate * parseFloat(config.standard_daily_hours);

    const totalDeductions = lateDeduction + absenceDeduction + leaveDeduction;

    // Incentive: sum of approved incentives for this staff+month
    const [incentiveRows] = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) as total_incentive
         FROM staff_incentives
         WHERE user_id = ? AND incentive_month = ? AND status = 'approved'`,
        [userId, month]
    );
    const incentiveAmount = parseFloat(incentiveRows[0].total_incentive) || 0;

    // Check if salary record exists
    const [existing] = await pool.query(
        'SELECT id FROM monthly_salaries WHERE user_id = ? AND salary_month = ?',
        [userId, month]
    );

    let salaryId;
    if (existing.length > 0) {
        salaryId = existing[0].id;
        await pool.query(
            `UPDATE monthly_salaries SET
                branch_id = ?, from_date = ?, to_date = ?, base_salary = ?,
                total_working_days = ?, total_present_days = ?, total_absent_days = ?,
                total_half_days = ?, total_sundays_worked = ?, total_leaves = ?,
                paid_sunday_leaves = ?, paid_weekday_leaves = ?, excess_leaves = ?,
                total_standard_hours = ?, total_sunday_hours = ?, total_overtime_hours = ?,
                total_worked_hours = ?,
                standard_hours_pay = ?, sunday_hours_pay = ?, overtime_pay = ?,
                transport_allowance = ?, food_allowance = ?, other_allowance = ?,
                total_allowances = ?, incentive_amount = ?,
                late_deduction = ?, absence_deduction = ?, leave_deduction = ?,
                total_deductions = ?,
                status = 'calculated', calculation_date = NOW(), calculated_by = ?
             WHERE id = ?`,
            [
                config.branch_id, fromDate, toDate, config.monthly_salary,
                parseInt(att.total_days), parseInt(att.present_days), parseInt(att.absent_days),
                parseInt(att.half_days), parseInt(att.sundays_worked), parseInt(att.leaves),
                paidSundayLeaves, paidWeekdayLeaves, excessLeaves,
                parseFloat(att.standard_hours), parseFloat(att.sunday_hours),
                parseFloat(att.overtime_hours) + parseFloat(att.sunday_overtime_hours),
                parseFloat(att.standard_hours) + parseFloat(att.sunday_hours) + parseFloat(att.overtime_hours) + parseFloat(att.sunday_overtime_hours),
                standardHoursPay, sundayHoursPay, overtimePay,
                transportAllowance, foodAllowance, otherAllowance, totalAllowances, incentiveAmount,
                lateDeduction, absenceDeduction, leaveDeduction,
                totalDeductions,
                calculatedBy, salaryId
            ]
        );
    } else {
        const [result] = await pool.query(
            `INSERT INTO monthly_salaries (
                user_id, branch_id, salary_month, from_date, to_date, base_salary,
                total_working_days, total_present_days, total_absent_days,
                total_half_days, total_sundays_worked, total_leaves,
                paid_sunday_leaves, paid_weekday_leaves, excess_leaves,
                total_standard_hours, total_sunday_hours, total_overtime_hours, total_worked_hours,
                standard_hours_pay, sunday_hours_pay, overtime_pay,
                transport_allowance, food_allowance, other_allowance, total_allowances,
                incentive_amount,
                late_deduction, absence_deduction, leave_deduction, total_deductions,
                status, calculation_date, calculated_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'calculated', NOW(), ?)`,
            [
                userId, config.branch_id, month, fromDate, toDate, config.monthly_salary,
                parseInt(att.total_days), parseInt(att.present_days), parseInt(att.absent_days),
                parseInt(att.half_days), parseInt(att.sundays_worked), parseInt(att.leaves),
                paidSundayLeaves, paidWeekdayLeaves, excessLeaves,
                parseFloat(att.standard_hours), parseFloat(att.sunday_hours),
                parseFloat(att.overtime_hours) + parseFloat(att.sunday_overtime_hours),
                parseFloat(att.standard_hours) + parseFloat(att.sunday_hours) + parseFloat(att.overtime_hours) + parseFloat(att.sunday_overtime_hours),
                standardHoursPay, sundayHoursPay, overtimePay,
                transportAllowance, foodAllowance, otherAllowance, totalAllowances,
                incentiveAmount,
                lateDeduction, absenceDeduction, leaveDeduction, totalDeductions,
                calculatedBy
            ]
        );
        salaryId = result.insertId;
    }

    return { salary_id: salaryId, message: 'Salary calculated successfully' };
}

/**
 * POST calculate monthly salary for a staff member
 */
router.post('/calculate', requireAuth, requirePermission('salary', 'manage'), async (req, res) => {
    try {
        const { user_id, month } = req.body; // month format: YYYY-MM

        if (!user_id || !month) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: user_id, month'
            });
        }

        if (!/^\d{4}-\d{2}$/.test(month)) {
            return res.status(400).json({
                success: false,
                message: 'Month must be in YYYY-MM format'
            });
        }

        const result = await calculateSalaryForUser(user_id, month, req.user.id);

        res.json({
            success: true,
            message: 'Salary calculated successfully',
            data: result
        });

    } catch (error) {
        console.error('Error calculating salary:', error);
        res.status(500).json({
            success: false,
            message: error.message === 'No active salary configuration found for this user'
                ? error.message : 'Failed to calculate salary'
        });
    }
});

/**
 * POST calculate salaries for all staff in a month
 */
router.post('/calculate-all', requireAuth, requirePermission('salary', 'manage'), async (req, res) => {
    try {
        const { month, branch_id } = req.body;

        if (!month) {
            return res.status(400).json({
                success: false,
                message: 'Missing required field: month'
            });
        }

        if (!/^\d{4}-\d{2}$/.test(month)) {
            return res.status(400).json({
                success: false,
                message: 'Month must be in YYYY-MM format'
            });
        }

        // Get all active staff
        let query = `
            SELECT DISTINCT sc.user_id
            FROM staff_salary_config sc
            WHERE sc.is_active = 1
        `;

        const params = [];
        if (branch_id) {
            query += ' AND sc.branch_id = ?';
            params.push(branch_id);
        }

        const [staff] = await pool.query(query, params);

        const results = [];
        for (const s of staff) {
            try {
                const result = await calculateSalaryForUser(s.user_id, month, req.user.id);
                results.push({
                    user_id: s.user_id,
                    success: true,
                    data: result
                });
            } catch (err) {
                console.error(`Salary calc failed for user ${s.user_id}:`, err.message);
                results.push({
                    user_id: s.user_id,
                    success: false,
                    error: err.message
                });
            }
        }

        res.json({
            success: true,
            message: `Calculated salaries for ${results.length} staff members`,
            data: results
        });

    } catch (error) {
        console.error('Error calculating all salaries:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to calculate salaries'
        });
    }
});

/**
 * GET monthly salaries
 */
router.get('/monthly', requireRole('admin', 'manager', 'accountant'), requirePermission('salary', 'view'), async (req, res) => {
    try {
        const { month, branch_id, user_id, status, payment_status } = req.query;
        
        let query = `
            SELECT 
                ms.*,
                u.full_name as staff_name,
                u.email as staff_email,
                b.name as branch_name,
                approver.full_name as approved_by_name,
                calculator.full_name as calculated_by_name
            FROM monthly_salaries ms
            JOIN users u ON ms.user_id = u.id
            JOIN branches b ON ms.branch_id = b.id
            LEFT JOIN users approver ON ms.approved_by = approver.id
            LEFT JOIN users calculator ON ms.calculated_by = calculator.id
            WHERE 1=1
        `;
        
        const params = [];
        
        if (month) {
            query += ' AND ms.salary_month = ?';
            params.push(month);
        }
        
        if (branch_id) {
            query += ' AND ms.branch_id = ?';
            params.push(branch_id);
        }
        
        if (user_id) {
            query += ' AND ms.user_id = ?';
            params.push(user_id);
        }
        
        if (status) {
            query += ' AND ms.status = ?';
            params.push(status);
        }
        
        if (payment_status) {
            query += ' AND ms.payment_status = ?';
            params.push(payment_status);
        }
        
        query += ' ORDER BY ms.salary_month DESC, ms.branch_id, u.full_name';
        
        const [salaries] = await pool.query(query, params);
        
        res.json({
            success: true,
            data: salaries
        });
        
    } catch (error) {
        console.error('Error fetching monthly salaries:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch monthly salaries'
        });
    }
});

/**
 * GET single monthly salary details
 */
router.get('/monthly/:id', requireRole('admin', 'manager', 'accountant'), requirePermission('salary', 'view'), async (req, res) => {
    try {
        const [salaries] = await pool.query(`
            SELECT 
                ms.*,
                u.full_name as staff_name,
                u.email as staff_email,
                u.phone as staff_phone,
                b.name as branch_name,
                sc.monthly_salary as configured_salary,
                sc.overtime_multiplier
            FROM monthly_salaries ms
            JOIN users u ON ms.user_id = u.id
            JOIN branches b ON ms.branch_id = b.id
            LEFT JOIN staff_salary_config sc ON ms.user_id = sc.user_id 
                AND sc.is_active = 1
            WHERE ms.id = ?
        `, [req.params.id]);
        
        if (salaries.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Monthly salary record not found'
            });
        }
        
        // Get attendance details for this month
        const [attendance] = await pool.query(`
            SELECT 
                date,
                clock_in_time,
                clock_out_time,
                total_working_minutes,
                ROUND(total_working_minutes / 60, 2) as hours_worked,
                status,
                is_late,
                is_early_checkout,
                DAYOFWEEK(date) as day_of_week
            FROM staff_attendance
            WHERE user_id = ?
              AND date BETWEEN ? AND ?
            ORDER BY date
        `, [salaries[0].user_id, salaries[0].from_date, salaries[0].to_date]);
        
        res.json({
            success: true,
            data: {
                salary: salaries[0],
                attendance: attendance
            }
        });
        
    } catch (error) {
        console.error('Error fetching monthly salary:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch monthly salary'
        });
    }
});

/**
 * Helper: get branding settings
 */
async function getBranding() {
    try {
        const [settings] = await pool.query(
            "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('business_name','business_logo','business_phone','business_email','business_address','business_gst')"
        );
        const obj = {};
        settings.forEach(s => { obj[s.setting_key] = s.setting_value; });
        return obj;
    } catch { return {}; }
}

/**
 * Helper: auth from token header OR query param (for PDF download links)
 */
async function authenticateRequest(req) {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
    if (!token) return null;
    const [sessions] = await pool.query(
        `SELECT s.*, u.id as user_id, u.username, u.role, u.full_name
         FROM user_sessions s JOIN users u ON s.user_id = u.id
         WHERE s.session_token = ? AND s.expires_at > NOW() AND u.status = 'active'`,
        [token]
    );
    return sessions.length > 0 ? sessions[0] : null;
}

/**
 * Helper: get salary data for PDF generation
 */
async function getSalaryForPdf(salaryId) {
    const [salaries] = await pool.query(`
        SELECT ms.*, u.full_name as staff_name, u.email as staff_email, u.phone as staff_phone,
               b.name as branch_name, sc.overtime_multiplier
        FROM monthly_salaries ms
        JOIN users u ON ms.user_id = u.id
        JOIN branches b ON ms.branch_id = b.id
        LEFT JOIN staff_salary_config sc ON ms.user_id = sc.user_id AND sc.is_active = 1
        WHERE ms.id = ?
    `, [salaryId]);
    return salaries.length > 0 ? salaries[0] : null;
}

/**
 * GET /monthly/:id/pdf - Download salary slip as PDF
 */
router.get('/monthly/:id/pdf', async (req, res) => {
    try {
        const user = await authenticateRequest(req);
        if (!user) return res.status(401).json({ success: false, message: 'Authentication required' });

        const salary = await getSalaryForPdf(req.params.id);
        if (!salary) return res.status(404).json({ success: false, message: 'Salary record not found' });

        const branding = await getBranding();
        const filename = `Salary-${salary.staff_name}-${salary.salary_month}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        generateSalarySlipPDF({ salary, branding }, res);
    } catch (error) {
        console.error('Salary PDF error:', error);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'Failed to generate PDF' });
        }
    }
});

/**
 * POST /monthly/:id/send-whatsapp - Send salary slip PDF via WhatsApp
 */
router.post('/monthly/:id/send-whatsapp', requireAuth, requirePermission('salary', 'manage'), async (req, res) => {
    try {
        if (!sessionManager) {
            return res.status(400).json({ success: false, message: 'WhatsApp not available' });
        }

        const salary = await getSalaryForPdf(req.params.id);
        if (!salary) return res.status(404).json({ success: false, message: 'Salary record not found' });

        if (!salary.staff_phone) {
            return res.status(400).json({ success: false, message: 'Staff has no phone number' });
        }

        const branding = await getBranding();

        // Generate PDF to temp file
        const tmpFile = path.join(os.tmpdir(), `salary-${salary.id}-${Date.now()}.pdf`);
        const writeStream = fs.createWriteStream(tmpFile);

        await new Promise((resolve, reject) => {
            writeStream.on('finish', resolve);
            writeStream.on('error', reject);
            generateSalarySlipPDF({ salary, branding }, writeStream);
        });

        // Send via WhatsApp
        const filename = `Salary-${salary.staff_name}-${salary.salary_month}.pdf`;
        const caption = `Salary Slip - ${salary.salary_month}\nName: ${salary.staff_name}\nNet Salary: ₹${parseFloat(salary.net_salary || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

        const result = await sessionManager.sendMedia(
            salary.branch_id || 0,
            salary.staff_phone,
            { type: 'document', mediaPath: tmpFile, filename, caption },
            { source: 'salary_slip', sent_by: req.user.id }
        );

        // Clean up temp file
        fs.unlink(tmpFile, () => {});

        if (result) {
            res.json({ success: true, message: 'Salary slip sent via WhatsApp' });
        } else {
            res.status(400).json({ success: false, message: 'WhatsApp session not connected' });
        }
    } catch (error) {
        console.error('WhatsApp salary send error:', error);
        res.status(500).json({ success: false, message: 'Failed to send via WhatsApp' });
    }
});

/**
 * POST /bulk/send-whatsapp - Send salary slips to multiple staff via WhatsApp
 */
router.post('/bulk/send-whatsapp', requireAuth, requirePermission('salary', 'manage'), async (req, res) => {
    try {
        if (!sessionManager) {
            return res.status(400).json({ success: false, message: 'WhatsApp not available' });
        }

        const { salary_ids } = req.body;
        if (!Array.isArray(salary_ids) || salary_ids.length === 0) {
            return res.status(400).json({ success: false, message: 'No salary records selected' });
        }

        const branding = await getBranding();
        const results = [];

        for (const salaryId of salary_ids) {
            try {
                const salary = await getSalaryForPdf(salaryId);
                if (!salary) {
                    results.push({ id: salaryId, success: false, reason: 'Not found' });
                    continue;
                }
                if (!salary.staff_phone) {
                    results.push({ id: salaryId, name: salary.staff_name, success: false, reason: 'No phone number' });
                    continue;
                }

                // Generate PDF to temp file
                const tmpFile = path.join(os.tmpdir(), `salary-${salary.id}-${Date.now()}.pdf`);
                const writeStream = fs.createWriteStream(tmpFile);
                await new Promise((resolve, reject) => {
                    writeStream.on('finish', resolve);
                    writeStream.on('error', reject);
                    generateSalarySlipPDF({ salary, branding }, writeStream);
                });

                const filename = `Salary-${salary.staff_name}-${salary.salary_month}.pdf`;
                const caption = `Salary Slip - ${salary.salary_month}\nName: ${salary.staff_name}\nNet Salary: ₹${parseFloat(salary.net_salary || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

                const sent = await sessionManager.sendMedia(
                    salary.branch_id || 0,
                    salary.staff_phone,
                    { type: 'document', mediaPath: tmpFile, filename, caption },
                    { source: 'salary_slip_bulk', sent_by: req.user.id }
                );

                fs.unlink(tmpFile, () => {});

                results.push({ id: salaryId, name: salary.staff_name, success: !!sent, reason: sent ? null : 'WhatsApp session not connected' });
            } catch (err) {
                results.push({ id: salaryId, success: false, reason: err.message });
            }
        }

        const sent = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;

        res.json({
            success: true,
            message: `Sent ${sent}/${salary_ids.length} salary slips`,
            data: { sent, failed, total: salary_ids.length, details: results }
        });
    } catch (error) {
        console.error('Bulk WhatsApp salary send error:', error);
        res.status(500).json({ success: false, message: 'Failed to send bulk WhatsApp' });
    }
});

/**
 * PUT approve monthly salary
 */
router.put('/monthly/:id/approve', requireAuth, requirePermission('salary', 'approve'), async (req, res) => {
    try {
        const { notes } = req.body;

        // Get salary record before update to know which user
        const [salaryRec] = await pool.query('SELECT user_id FROM monthly_salaries WHERE id = ?', [req.params.id]);

        await pool.query(`
            UPDATE monthly_salaries
            SET status = 'approved',
                approved_by = ?,
                approved_at = NOW(),
                notes = CONCAT(COALESCE(notes, ''), '\n\nApproval: ', ?)
            WHERE id = ?
        `, [req.user.id, notes || 'Approved', req.params.id]);

        // Notify user salary approved
        if (salaryRec.length > 0) {
            try {
                await notificationService.send(salaryRec[0].user_id, {
                    type: 'salary_generated', title: 'Salary Approved',
                    body: 'Your monthly salary has been approved.',
                    data: { type: 'salary_generated', monthly_salary_id: parseInt(req.params.id) }
                });
            } catch (notifErr) { console.error('Salary approve notification error:', notifErr.message); }
        }

        res.json({
            success: true,
            message: 'Salary approved successfully'
        });
        
    } catch (error) {
        console.error('Error approving salary:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to approve salary'
        });
    }
});

/**
 * PUT update manual deductions/allowances
 */
router.put('/monthly/:id/adjustments', requireAuth, requirePermission('salary', 'manage'), async (req, res) => {
    try {
        const { other_deduction, deduction_notes, other_allowance } = req.body;
        
        const updates = [];
        const values = [];
        
        if (other_deduction !== undefined) {
            updates.push('other_deduction = ?');
            values.push(other_deduction);
        }
        
        if (deduction_notes !== undefined) {
            updates.push('deduction_notes = ?');
            values.push(deduction_notes);
        }
        
        if (other_allowance !== undefined) {
            updates.push('other_allowance = ?');
            values.push(other_allowance);
        }
        
        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No adjustments provided'
            });
        }
        
        // Recalculate totals
        updates.push('total_allowances = transport_allowance + food_allowance + other_allowance');
        updates.push('total_deductions = late_deduction + absence_deduction + leave_deduction + other_deduction');
        
        values.push(req.params.id);
        
        await pool.query(
            `UPDATE monthly_salaries SET ${updates.join(', ')} WHERE id = ?`,
            values
        );
        
        res.json({
            success: true,
            message: 'Adjustments updated successfully'
        });
        
    } catch (error) {
        console.error('Error updating adjustments:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update adjustments'
        });
    }
});

// ========================================
// PAYMENT TRACKING ROUTES
// ========================================

/**
 * POST record salary payment
 */
router.post('/payments', requireAuth, requirePermission('salary', 'manage'), async (req, res) => {
    try {
        const {
            monthly_salary_id,
            user_id,
            payment_date,
            amount_paid,
            payment_method,
            payment_reference,
            bank_name,
            account_number,
            transaction_id,
            receipt_number,
            notes
        } = req.body;
        
        if (!monthly_salary_id || !user_id || !payment_date || !amount_paid || !payment_method) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields'
            });
        }
        
        // Insert payment record
        const [result] = await pool.query(`
            INSERT INTO salary_payments (
                monthly_salary_id, user_id, payment_date, amount_paid, payment_method,
                payment_reference, bank_name, account_number, transaction_id,
                receipt_number, paid_by, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            monthly_salary_id, user_id, payment_date, amount_paid, payment_method,
            payment_reference, bank_name, account_number, transaction_id,
            receipt_number, req.user.id, notes
        ]);
        
        // Update monthly salary payment status
        const [currentSalary] = await pool.query(
            'SELECT net_salary, paid_amount FROM monthly_salaries WHERE id = ?',
            [monthly_salary_id]
        );
        
        const totalPaid = parseFloat(currentSalary[0].paid_amount) + parseFloat(amount_paid);
        const netSalary = parseFloat(currentSalary[0].net_salary);
        
        let paymentStatus = 'partial';
        if (totalPaid >= netSalary) {
            paymentStatus = 'paid';
        }
        
        await pool.query(`
            UPDATE monthly_salaries 
            SET paid_amount = ?,
                payment_status = ?,
                payment_date = ?,
                payment_method = ?,
                payment_reference = ?,
                status = CASE WHEN status = 'calculated' THEN 'approved' ELSE status END
            WHERE id = ?
        `, [totalPaid, paymentStatus, payment_date, payment_method, payment_reference, monthly_salary_id]);
        
        // Notify user of payment
        try {
            await notificationService.send(user_id, {
                type: 'salary_paid', title: 'Salary Payment Received',
                body: `Payment of ₹${parseFloat(amount_paid).toLocaleString('en-IN')} has been recorded.`,
                data: { type: 'salary_paid', payment_id: result.insertId, amount: amount_paid }
            });
        } catch (notifErr) { console.error('Payment notification error:', notifErr.message); }

        res.json({
            success: true,
            message: 'Payment recorded successfully',
            data: {
                id: result.insertId,
                total_paid: totalPaid,
                payment_status: paymentStatus
            }
        });

    } catch (error) {
        console.error('Error recording payment:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to record payment'
        });
    }
});

/**
 * GET payment history
 */
router.get('/payments', requireRole('admin', 'manager', 'accountant'), requirePermission('salary', 'view'), async (req, res) => {
    try {
        const { user_id, month, payment_method } = req.query;
        
        let query = `
            SELECT 
                sp.*,
                u.full_name as staff_name,
                ms.salary_month,
                ms.net_salary,
                payer.full_name as paid_by_name,
                verifier.full_name as verified_by_name
            FROM salary_payments sp
            JOIN users u ON sp.user_id = u.id
            JOIN monthly_salaries ms ON sp.monthly_salary_id = ms.id
            LEFT JOIN users payer ON sp.paid_by = payer.id
            LEFT JOIN users verifier ON sp.verified_by = verifier.id
            WHERE 1=1
        `;
        
        const params = [];
        
        if (user_id) {
            query += ' AND sp.user_id = ?';
            params.push(user_id);
        }
        
        if (month) {
            query += ' AND ms.salary_month = ?';
            params.push(month);
        }
        
        if (payment_method) {
            query += ' AND sp.payment_method = ?';
            params.push(payment_method);
        }
        
        query += ' ORDER BY sp.payment_date DESC, sp.paid_at DESC';
        
        const [payments] = await pool.query(query, params);
        
        res.json({
            success: true,
            data: payments
        });
        
    } catch (error) {
        console.error('Error fetching payments:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch payments'
        });
    }
});

// ========================================
// REPORTS & ANALYTICS
// ========================================

/**
 * GET salary summary by month
 */
router.get('/reports/summary', requireRole('admin', 'manager', 'accountant'), requirePermission('salary', 'view'), async (req, res) => {
    try {
        const { month, branch_id } = req.query;
        
        if (!month) {
            return res.status(400).json({
                success: false,
                message: 'Month parameter is required'
            });
        }
        
        let query = `
            SELECT 
                COUNT(*) as total_staff,
                SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_count,
                SUM(CASE WHEN payment_status = 'unpaid' THEN 1 ELSE 0 END) as unpaid_count,
                SUM(base_salary) as total_base_salary,
                SUM(gross_salary) as total_gross_salary,
                SUM(net_salary) as total_net_salary,
                SUM(paid_amount) as total_paid,
                SUM(net_salary - paid_amount) as total_pending,
                SUM(total_overtime_hours) as total_overtime_hours,
                SUM(overtime_pay) as total_overtime_pay,
                SUM(total_allowances) as total_allowances,
                SUM(total_deductions) as total_deductions
            FROM monthly_salaries
            WHERE salary_month = ?
        `;
        
        const params = [month];
        
        if (branch_id) {
            query += ' AND branch_id = ?';
            params.push(branch_id);
        }
        
        const [summary] = await pool.query(query, params);
        
        // Get branch-wise breakdown
        let branchQuery = `
            SELECT 
                b.id as branch_id,
                b.name as branch_name,
                COUNT(*) as staff_count,
                SUM(net_salary) as total_salary,
                SUM(paid_amount) as total_paid,
                SUM(net_salary - paid_amount) as pending
            FROM monthly_salaries ms
            JOIN branches b ON ms.branch_id = b.id
            WHERE ms.salary_month = ?
        `;
        
        const branchParams = [month];
        
        if (branch_id) {
            branchQuery += ' AND ms.branch_id = ?';
            branchParams.push(branch_id);
        }
        
        branchQuery += ' GROUP BY b.id ORDER BY b.name';
        
        const [branchBreakdown] = await pool.query(branchQuery, branchParams);
        
        res.json({
            success: true,
            data: {
                summary: summary[0],
                branch_breakdown: branchBreakdown
            }
        });
        
    } catch (error) {
        console.error('Error fetching salary summary:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch salary summary'
        });
    }
});

// ========================================
// SALARY ADVANCE ROUTES
// ========================================

/**
 * GET salary advances list with filters
 */
router.get('/advances', requireRole('admin', 'manager', 'accountant'), requirePermission('salary', 'view'), async (req, res) => {
    try {
        const { status, user_id, branch_id, page = 1, limit = 50 } = req.query;
        const offset = (page - 1) * limit;

        let query = `
            SELECT
                sa.*,
                u.full_name as user_name,
                b.name as branch_name,
                ab.full_name as approved_by_name,
                rb.full_name as rejected_by_name,
                pb.full_name as paid_by_name,
                rq.full_name as requested_by_name
            FROM salary_advances sa
            JOIN users u ON sa.user_id = u.id
            LEFT JOIN branches b ON sa.branch_id = b.id
            LEFT JOIN users ab ON sa.approved_by = ab.id
            LEFT JOIN users rb ON sa.rejected_by = rb.id
            LEFT JOIN users pb ON sa.paid_by = pb.id
            LEFT JOIN users rq ON sa.requested_by = rq.id
            WHERE 1=1
        `;
        let countQuery = `SELECT COUNT(*) as total FROM salary_advances sa WHERE 1=1`;
        const params = [];
        const countParams = [];

        if (status) {
            query += ' AND sa.status = ?';
            countQuery += ' AND sa.status = ?';
            params.push(status);
            countParams.push(status);
        }
        if (user_id) {
            query += ' AND sa.user_id = ?';
            countQuery += ' AND sa.user_id = ?';
            params.push(user_id);
            countParams.push(user_id);
        }
        if (branch_id) {
            query += ' AND sa.branch_id = ?';
            countQuery += ' AND sa.branch_id = ?';
            params.push(branch_id);
            countParams.push(branch_id);
        }

        query += ' ORDER BY sa.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        const [advances] = await pool.query(query, params);
        const [countResult] = await pool.query(countQuery, countParams);

        res.json({
            success: true,
            data: advances,
            total: countResult[0].total,
            page: parseInt(page),
            limit: parseInt(limit)
        });
    } catch (error) {
        console.error('Error fetching advances:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch advances' });
    }
});

/**
 * GET salary advances summary (dashboard cards)
 * NOTE: Must be registered BEFORE /advances/:id
 */
router.get('/advances/summary', requireRole('admin', 'manager', 'accountant'), requirePermission('salary', 'view'), async (req, res) => {
    try {
        const { branch_id } = req.query;

        let query = `
            SELECT
                COUNT(*) as total_requests,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
                SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END) as pending_amount,
                SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved_count,
                SUM(CASE WHEN status = 'approved' THEN amount ELSE 0 END) as approved_amount,
                SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_count,
                SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) as paid_amount,
                SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_count
            FROM salary_advances
            WHERE 1=1
        `;
        const params = [];

        if (branch_id) {
            query += ' AND branch_id = ?';
            params.push(branch_id);
        }

        const [summary] = await pool.query(query, params);

        res.json({
            success: true,
            data: summary[0]
        });
    } catch (error) {
        console.error('Error fetching advance summary:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch advance summary' });
    }
});

/**
 * GET single salary advance
 */
router.get('/advances/:id', requireRole('admin', 'manager', 'accountant'), requirePermission('salary', 'view'), async (req, res) => {
    try {
        const [advances] = await pool.query(`
            SELECT
                sa.*,
                u.full_name as user_name,
                b.name as branch_name,
                ab.full_name as approved_by_name,
                rb.full_name as rejected_by_name,
                pb.full_name as paid_by_name,
                rq.full_name as requested_by_name
            FROM salary_advances sa
            JOIN users u ON sa.user_id = u.id
            LEFT JOIN branches b ON sa.branch_id = b.id
            LEFT JOIN users ab ON sa.approved_by = ab.id
            LEFT JOIN users rb ON sa.rejected_by = rb.id
            LEFT JOIN users pb ON sa.paid_by = pb.id
            LEFT JOIN users rq ON sa.requested_by = rq.id
            WHERE sa.id = ?
        `, [req.params.id]);

        if (advances.length === 0) {
            return res.status(404).json({ success: false, message: 'Advance not found' });
        }

        res.json({ success: true, data: advances[0] });
    } catch (error) {
        console.error('Error fetching advance:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch advance' });
    }
});

/**
 * POST create new salary advance
 */
router.post('/advances', requireAuth, requirePermission('salary', 'manage'), async (req, res) => {
    try {
        const { user_id, branch_id, amount, reason, notes } = req.body;

        if (!user_id || !branch_id || !amount) {
            return res.status(400).json({ success: false, message: 'user_id, branch_id, and amount are required' });
        }

        const [result] = await pool.query(
            `INSERT INTO salary_advances (user_id, branch_id, amount, reason, notes, requested_by, status)
             VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
            [user_id, branch_id, amount, reason || null, notes || null, req.user.id]
        );

        res.status(201).json({
            success: true,
            message: 'Advance request created',
            data: { id: result.insertId }
        });
    } catch (error) {
        console.error('Error creating advance:', error);
        res.status(500).json({ success: false, message: 'Failed to create advance' });
    }
});

/**
 * PUT approve salary advance
 */
router.put('/advances/:id/approve', requireAuth, requirePermission('salary', 'approve'), async (req, res) => {
    try {
        const { id } = req.params;
        const { notes } = req.body;

        const [advance] = await pool.query('SELECT * FROM salary_advances WHERE id = ?', [id]);
        if (advance.length === 0) {
            return res.status(404).json({ success: false, message: 'Advance not found' });
        }
        if (advance[0].status !== 'pending') {
            return res.status(400).json({ success: false, message: 'Only pending advances can be approved' });
        }

        await pool.query(
            `UPDATE salary_advances SET status = 'approved', approved_by = ?, approved_at = NOW(), notes = COALESCE(?, notes) WHERE id = ?`,
            [req.user.id, notes || null, id]
        );

        // Notify requesting user
        try {
            await notificationService.send(advance[0].user_id, {
                type: 'advance_approved', title: 'Advance Approved',
                body: `Your salary advance request of ₹${parseFloat(advance[0].amount).toLocaleString('en-IN')} has been approved.`,
                data: { type: 'advance_approved', advance_id: parseInt(id) }
            });
        } catch (notifErr) { console.error('Advance approve notification error:', notifErr.message); }

        res.json({ success: true, message: 'Advance approved' });
    } catch (error) {
        console.error('Error approving advance:', error);
        res.status(500).json({ success: false, message: 'Failed to approve advance' });
    }
});

/**
 * PUT reject salary advance
 */
router.put('/advances/:id/reject', requireAuth, requirePermission('salary', 'approve'), async (req, res) => {
    try {
        const { id } = req.params;
        const { rejection_reason } = req.body;

        if (!rejection_reason) {
            return res.status(400).json({ success: false, message: 'Rejection reason is required' });
        }

        const [advance] = await pool.query('SELECT * FROM salary_advances WHERE id = ?', [id]);
        if (advance.length === 0) {
            return res.status(404).json({ success: false, message: 'Advance not found' });
        }
        if (advance[0].status !== 'pending') {
            return res.status(400).json({ success: false, message: 'Only pending advances can be rejected' });
        }

        await pool.query(
            `UPDATE salary_advances SET status = 'rejected', rejected_by = ?, rejected_at = NOW(), rejection_reason = ? WHERE id = ?`,
            [req.user.id, rejection_reason, id]
        );

        // Notify requesting user
        try {
            await notificationService.send(advance[0].user_id, {
                type: 'advance_rejected', title: 'Advance Rejected',
                body: `Your salary advance request has been rejected. Reason: ${rejection_reason}`,
                data: { type: 'advance_rejected', advance_id: parseInt(id) }
            });
        } catch (notifErr) { console.error('Advance reject notification error:', notifErr.message); }

        res.json({ success: true, message: 'Advance rejected' });
    } catch (error) {
        console.error('Error rejecting advance:', error);
        res.status(500).json({ success: false, message: 'Failed to reject advance' });
    }
});

/**
 * PUT record advance payment
 */
router.put('/advances/:id/pay', requireAuth, requirePermission('salary', 'manage'), async (req, res) => {
    try {
        const { id } = req.params;
        const { payment_method, payment_reference, payment_date, recovery_month } = req.body;

        const [advance] = await pool.query('SELECT * FROM salary_advances WHERE id = ?', [id]);
        if (advance.length === 0) {
            return res.status(404).json({ success: false, message: 'Advance not found' });
        }
        if (advance[0].status !== 'approved') {
            return res.status(400).json({ success: false, message: 'Only approved advances can be paid' });
        }

        await pool.query(
            `UPDATE salary_advances
             SET status = 'paid', payment_date = ?, payment_method = ?, payment_reference = ?,
                 paid_by = ?, recovery_month = ?
             WHERE id = ?`,
            [payment_date || new Date().toISOString().split('T')[0], payment_method || null, payment_reference || null, req.user.id, recovery_month || null, id]
        );

        res.json({ success: true, message: 'Advance payment recorded' });
    } catch (error) {
        console.error('Error recording payment:', error);
        res.status(500).json({ success: false, message: 'Failed to record payment' });
    }
});

// ========================================
// INCENTIVE SLAB ROUTES
// ========================================

/**
 * GET /incentive-slabs - List all incentive slabs
 */
router.get('/incentive-slabs', requireAuth, async (req, res) => {
    try {
        const [slabs] = await pool.query('SELECT * FROM incentive_slabs ORDER BY min_amount ASC');
        res.json({ success: true, data: slabs });
    } catch (error) {
        console.error('Error fetching incentive slabs:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch slabs' });
    }
});

/**
 * POST /incentive-slabs - Create a new slab
 */
router.post('/incentive-slabs', requireRole('admin', 'super_admin'), requirePermission('salary', 'manage'), async (req, res) => {
    try {
        const { min_amount, max_amount, incentive_amount } = req.body;
        if (!min_amount || !max_amount || !incentive_amount) {
            return res.status(400).json({ success: false, message: 'min_amount, max_amount, and incentive_amount are required' });
        }
        if (parseFloat(min_amount) >= parseFloat(max_amount)) {
            return res.status(400).json({ success: false, message: 'min_amount must be less than max_amount' });
        }

        const [result] = await pool.query(
            'INSERT INTO incentive_slabs (min_amount, max_amount, incentive_amount) VALUES (?, ?, ?)',
            [min_amount, max_amount, incentive_amount]
        );
        res.status(201).json({ success: true, message: 'Slab created', data: { id: result.insertId } });
    } catch (error) {
        console.error('Error creating slab:', error);
        res.status(500).json({ success: false, message: 'Failed to create slab' });
    }
});

/**
 * PUT /incentive-slabs/:id - Update a slab
 */
router.put('/incentive-slabs/:id', requireRole('admin', 'super_admin'), requirePermission('salary', 'manage'), async (req, res) => {
    try {
        const { min_amount, max_amount, incentive_amount, is_active } = req.body;
        const updates = [];
        const params = [];

        if (min_amount !== undefined) { updates.push('min_amount = ?'); params.push(min_amount); }
        if (max_amount !== undefined) { updates.push('max_amount = ?'); params.push(max_amount); }
        if (incentive_amount !== undefined) { updates.push('incentive_amount = ?'); params.push(incentive_amount); }
        if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, message: 'No fields to update' });
        }

        params.push(req.params.id);
        const [result] = await pool.query(
            `UPDATE incentive_slabs SET ${updates.join(', ')} WHERE id = ?`, params
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Slab not found' });
        }
        res.json({ success: true, message: 'Slab updated' });
    } catch (error) {
        console.error('Error updating slab:', error);
        res.status(500).json({ success: false, message: 'Failed to update slab' });
    }
});

/**
 * DELETE /incentive-slabs/:id - Delete a slab
 */
router.delete('/incentive-slabs/:id', requireRole('admin', 'super_admin'), requirePermission('salary', 'manage'), async (req, res) => {
    try {
        const [result] = await pool.query('DELETE FROM incentive_slabs WHERE id = ?', [req.params.id]);
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Slab not found' });
        }
        res.json({ success: true, message: 'Slab deleted' });
    } catch (error) {
        console.error('Error deleting slab:', error);
        res.status(500).json({ success: false, message: 'Failed to delete slab' });
    }
});

// ========================================
// STAFF INCENTIVE ROUTES
// ========================================

/**
 * GET /incentives - List incentives (admin: all, staff: own)
 */
router.get('/incentives', requireAuth, async (req, res) => {
    try {
        const { month, user_id, status: filterStatus } = req.query;
        const isAdmin = ['admin', 'super_admin', 'manager'].includes(req.user.role);

        let query = `
            SELECT si.*, u.full_name as staff_name, l.name as lead_name, l.phone as lead_phone,
                   ab.full_name as approved_by_name,
                   pe.estimate_number
            FROM staff_incentives si
            JOIN users u ON si.user_id = u.id
            LEFT JOIN leads l ON si.lead_id = l.id
            LEFT JOIN users ab ON si.approved_by = ab.id
            LEFT JOIN painter_estimates pe ON si.estimate_id = pe.id
            WHERE 1=1
        `;
        const params = [];

        if (!isAdmin) {
            query += ' AND si.user_id = ?';
            params.push(req.user.id);
        } else if (user_id) {
            query += ' AND si.user_id = ?';
            params.push(user_id);
        }

        if (month) {
            query += ' AND si.incentive_month = ?';
            params.push(month);
        }

        if (filterStatus) {
            query += ' AND si.status = ?';
            params.push(filterStatus);
        }

        query += ' ORDER BY si.created_at DESC';

        const [incentives] = await pool.query(query, params);

        // Summary
        const approved = incentives.filter(i => i.status === 'approved');
        const pending = incentives.filter(i => i.status === 'pending');

        res.json({
            success: true,
            data: incentives,
            summary: {
                total: incentives.length,
                pending_count: pending.length,
                pending_amount: pending.reduce((s, i) => s + parseFloat(i.amount), 0),
                approved_count: approved.length,
                approved_amount: approved.reduce((s, i) => s + parseFloat(i.amount), 0)
            }
        });
    } catch (error) {
        console.error('Error fetching incentives:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch incentives' });
    }
});

/**
 * GET /incentives/summary - Monthly incentive summary per staff
 */
router.get('/incentives/summary', requireRole('admin', 'manager'), requirePermission('salary', 'view'), async (req, res) => {
    try {
        const { month } = req.query;
        if (!month) return res.status(400).json({ success: false, message: 'month parameter required (YYYY-MM)' });

        const [summary] = await pool.query(`
            SELECT si.user_id, u.full_name as staff_name,
                   COUNT(*) as total_conversions,
                   SUM(CASE WHEN si.status = 'approved' THEN si.amount ELSE 0 END) as approved_amount,
                   SUM(CASE WHEN si.status = 'pending' THEN si.amount ELSE 0 END) as pending_amount,
                   SUM(CASE WHEN si.lead_type = 'customer' THEN 1 ELSE 0 END) as customer_count,
                   SUM(CASE WHEN si.lead_type = 'painter' THEN 1 ELSE 0 END) as painter_count,
                   SUM(CASE WHEN si.lead_type = 'engineer' THEN 1 ELSE 0 END) as engineer_count
            FROM staff_incentives si
            JOIN users u ON si.user_id = u.id
            WHERE si.incentive_month = ?
            GROUP BY si.user_id
            ORDER BY approved_amount DESC
        `, [month]);

        res.json({ success: true, data: summary });
    } catch (error) {
        console.error('Error fetching incentive summary:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch incentive summary' });
    }
});

/**
 * POST /incentives - Create incentive (auto-created on lead conversion or manual)
 */
router.post('/incentives', requireAuth, requirePermission('salary', 'manage'), async (req, res) => {
    try {
        const { user_id, lead_id, lead_type, amount, notes, incentive_month } = req.body;

        if (!user_id || !lead_type || !amount) {
            return res.status(400).json({ success: false, message: 'user_id, lead_type, and amount are required' });
        }

        // Determine month (default: current month)
        const now = new Date();
        const month = incentive_month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        // Check for duplicate (same user + lead)
        if (lead_id) {
            const [existing] = await pool.query(
                'SELECT id FROM staff_incentives WHERE user_id = ? AND lead_id = ?',
                [user_id, lead_id]
            );
            if (existing.length > 0) {
                return res.status(400).json({ success: false, message: 'Incentive already exists for this lead conversion' });
            }
        }

        const [result] = await pool.query(
            `INSERT INTO staff_incentives (user_id, lead_id, customer_id, lead_type, incentive_month, amount, notes, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [user_id, lead_id || null, null, lead_type, month, amount, notes || null]
        );

        res.status(201).json({
            success: true,
            message: 'Incentive created',
            data: { id: result.insertId }
        });
    } catch (error) {
        console.error('Error creating incentive:', error);
        res.status(500).json({ success: false, message: 'Failed to create incentive' });
    }
});

/**
 * PUT /incentives/:id/approve - Approve an incentive
 */
router.put('/incentives/:id/approve', requireRole('admin', 'manager'), requirePermission('salary', 'manage'), async (req, res) => {
    try {
        const [incentive] = await pool.query('SELECT * FROM staff_incentives WHERE id = ?', [req.params.id]);
        if (incentive.length === 0) {
            return res.status(404).json({ success: false, message: 'Incentive not found' });
        }
        if (incentive[0].status !== 'pending') {
            return res.status(400).json({ success: false, message: 'Only pending incentives can be approved' });
        }

        await pool.query(
            'UPDATE staff_incentives SET status = ?, approved_by = ?, approved_at = NOW() WHERE id = ?',
            ['approved', req.user.id, req.params.id]
        );

        // Notify staff
        try {
            await notificationService.send(incentive[0].user_id, {
                type: 'incentive_approved',
                title: 'Incentive Approved!',
                body: `Your ₹${parseFloat(incentive[0].amount).toLocaleString('en-IN')} incentive has been approved`,
                data: { page: 'my-incentives' }
            });
        } catch (nErr) { console.error('Incentive approve notification error:', nErr.message); }

        res.json({ success: true, message: 'Incentive approved' });
    } catch (error) {
        console.error('Error approving incentive:', error);
        res.status(500).json({ success: false, message: 'Failed to approve incentive' });
    }
});

/**
 * PUT /incentives/:id/reject - Reject an incentive
 */
router.put('/incentives/:id/reject', requireRole('admin', 'manager'), requirePermission('salary', 'manage'), async (req, res) => {
    try {
        const { notes } = req.body;
        const [incentive] = await pool.query('SELECT * FROM staff_incentives WHERE id = ?', [req.params.id]);
        if (incentive.length === 0) {
            return res.status(404).json({ success: false, message: 'Incentive not found' });
        }
        if (incentive[0].status !== 'pending') {
            return res.status(400).json({ success: false, message: 'Only pending incentives can be rejected' });
        }

        await pool.query(
            'UPDATE staff_incentives SET status = ?, notes = CONCAT(COALESCE(notes, ""), ?), approved_by = ?, approved_at = NOW() WHERE id = ?',
            ['rejected', notes ? `\nRejected: ${notes}` : '', req.user.id, req.params.id]
        );

        // Notify staff
        try {
            await notificationService.send(incentive[0].user_id, {
                type: 'incentive_rejected',
                title: 'Incentive Rejected',
                body: `Your ₹${parseFloat(incentive[0].amount).toLocaleString('en-IN')} incentive was rejected${notes ? ': ' + notes : ''}`,
                data: { page: 'my-incentives' }
            });
        } catch (nErr) { console.error('Incentive reject notification error:', nErr.message); }

        res.json({ success: true, message: 'Incentive rejected' });
    } catch (error) {
        console.error('Error rejecting incentive:', error);
        res.status(500).json({ success: false, message: 'Failed to reject incentive' });
    }
});

/**
 * PUT /incentives/bulk-approve - Approve all pending incentives for a month
 */
router.put('/incentives/bulk-approve', requireRole('admin', 'manager'), requirePermission('salary', 'manage'), async (req, res) => {
    try {
        const { month } = req.body;
        if (!month) return res.status(400).json({ success: false, message: 'month is required' });

        // Get pending incentives before approving (for notifications)
        const [pendingIncentives] = await pool.query(
            `SELECT user_id, SUM(amount) as total_amount, COUNT(*) as cnt FROM staff_incentives
             WHERE incentive_month = ? AND status = 'pending' GROUP BY user_id`,
            [month]
        );

        const [result] = await pool.query(
            `UPDATE staff_incentives SET status = 'approved', approved_by = ?, approved_at = NOW()
             WHERE incentive_month = ? AND status = 'pending'`,
            [req.user.id, month]
        );

        // Notify each staff
        for (const pi of pendingIncentives) {
            try {
                await notificationService.send(pi.user_id, {
                    type: 'incentive_approved',
                    title: 'Incentives Approved!',
                    body: `${pi.cnt} incentive(s) totaling ₹${parseFloat(pi.total_amount).toLocaleString('en-IN')} approved for ${month}`,
                    data: { page: 'my-incentives' }
                });
            } catch (nErr) { console.error('Bulk approve notification error:', nErr.message); }
        }

        res.json({ success: true, message: `${result.affectedRows} incentives approved`, count: result.affectedRows });
    } catch (error) {
        console.error('Error bulk approving incentives:', error);
        res.status(500).json({ success: false, message: 'Failed to bulk approve' });
    }
});

/**
 * DELETE /incentives/:id - Delete incentive (admin only, pending only)
 */
router.delete('/incentives/:id', requireRole('admin'), requirePermission('salary', 'manage'), async (req, res) => {
    try {
        const [incentive] = await pool.query('SELECT * FROM staff_incentives WHERE id = ?', [req.params.id]);
        if (incentive.length === 0) {
            return res.status(404).json({ success: false, message: 'Incentive not found' });
        }
        if (incentive[0].status !== 'pending') {
            return res.status(400).json({ success: false, message: 'Only pending incentives can be deleted' });
        }

        await pool.query('DELETE FROM staff_incentives WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Incentive deleted' });
    } catch (error) {
        console.error('Error deleting incentive:', error);
        res.status(500).json({ success: false, message: 'Failed to delete incentive' });
    }
});

/**
 * POST /incentives/request - Staff requests incentive for direct Zoho billing
 */
router.post('/incentives/request', requireAuth, async (req, res) => {
    try {
        const { lead_id, amount, invoice_reference, notes } = req.body;

        if (!amount || parseFloat(amount) <= 0) {
            return res.status(400).json({ success: false, message: 'Valid amount is required' });
        }
        if (!invoice_reference) {
            return res.status(400).json({ success: false, message: 'Invoice reference is required' });
        }

        // Look up slab-based incentive amount if slab system is enabled
        let incentiveAmount = parseFloat(amount);
        const [slabEnabled] = await pool.query(
            "SELECT config_value FROM ai_config WHERE config_key = 'incentive_slab_enabled'"
        );
        const useSlabs = !slabEnabled.length || slabEnabled[0].config_value === 'true';

        if (useSlabs) {
            const [slabs] = await pool.query(
                'SELECT incentive_amount FROM incentive_slabs WHERE is_active = 1 AND min_amount <= ? AND max_amount >= ? LIMIT 1',
                [incentiveAmount, incentiveAmount]
            );
            if (slabs.length > 0) {
                incentiveAmount = parseFloat(slabs[0].incentive_amount);
            } else {
                return res.status(400).json({ success: false, message: 'No incentive slab matches this amount. Contact admin.' });
            }
        }

        // Resolve lead info if provided
        let leadType = 'customer';
        let customerId = null;
        if (lead_id) {
            const [leads] = await pool.query('SELECT lead_type, customer_id FROM leads WHERE id = ?', [lead_id]);
            if (leads.length > 0) {
                leadType = leads[0].lead_type || 'customer';
                customerId = leads[0].customer_id;
            }
        }

        const now = new Date();
        const incentiveMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        const [result] = await pool.query(
            `INSERT INTO staff_incentives (user_id, lead_id, customer_id, lead_type, incentive_month, amount, estimate_amount, source, invoice_reference, status, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'manual_request', ?, 'pending', ?)`,
            [req.user.id, lead_id || null, customerId, leadType, incentiveMonth, incentiveAmount, parseFloat(amount), invoice_reference, notes || `Manual request: Invoice ${invoice_reference}`]
        );

        res.status(201).json({
            success: true,
            message: `Incentive request submitted (₹${incentiveAmount})`,
            data: { id: result.insertId, incentive_amount: incentiveAmount }
        });

        // Notify admins about the manual incentive request
        try {
            const [admins] = await pool.query("SELECT id FROM users WHERE role IN ('admin','super_admin') AND status = 'active'");
            for (const admin of admins) {
                await notificationService.send(admin.id, {
                    type: 'incentive_request',
                    title: 'New Incentive Request',
                    body: `${req.user.full_name || 'Staff'} requested ₹${incentiveAmount} incentive (Invoice: ${invoice_reference})`,
                    data: { page: 'salary-incentives' }
                });
            }
        } catch (notifErr) {
            console.error('Error sending incentive request notification:', notifErr);
        }
    } catch (error) {
        console.error('Error requesting incentive:', error);
        res.status(500).json({ success: false, message: 'Failed to submit incentive request' });
    }
});

module.exports = {
    router,
    setPool
};
