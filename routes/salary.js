/**
 * SALARY MODULE ROUTES
 * Handles salary configuration, calculation, and payment tracking
 */

const express = require('express');
const router = express.Router();
const { requirePermission, requireAuth } = require('../middleware/permissionMiddleware');

// Database connection (imported from main app)
let pool;

function setPool(dbPool) {
    pool = dbPool;
}

// ========================================
// SALARY CONFIGURATION ROUTES
// ========================================

/**
 * GET all staff salary configurations
 */
router.get('/config', requireAuth, requirePermission('salary', 'view'), async (req, res) => {
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
            message: 'Failed to fetch salary configurations',
            error: error.message
        });
    }
});

/**
 * GET single staff salary configuration
 */
router.get('/config/:id', requireAuth, requirePermission('salary', 'view'), async (req, res) => {
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
            message: 'Failed to fetch salary configuration',
            error: error.message
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
            message: 'Failed to create salary configuration',
            error: error.message
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
            message: 'Failed to update salary configuration',
            error: error.message
        });
    }
});

// ========================================
// MONTHLY SALARY CALCULATION ROUTES
// ========================================

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
        
        // Set current user ID for the procedure
        await pool.query('SET @current_user_id = ?', [req.user.id]);
        
        // Call stored procedure
        const [results] = await pool.query(
            'CALL calculate_monthly_salary(?, ?)',
            [user_id, month]
        );
        
        res.json({
            success: true,
            message: 'Salary calculated successfully',
            data: results[0][0]
        });
        
    } catch (error) {
        console.error('Error calculating salary:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to calculate salary',
            error: error.message
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
        
        // Set current user ID
        await pool.query('SET @current_user_id = ?', [req.user.id]);
        
        const results = [];
        for (const s of staff) {
            try {
                const [result] = await pool.query(
                    'CALL calculate_monthly_salary(?, ?)',
                    [s.user_id, month]
                );
                results.push({
                    user_id: s.user_id,
                    success: true,
                    data: result[0][0]
                });
            } catch (error) {
                results.push({
                    user_id: s.user_id,
                    success: false,
                    error: error.message
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
            message: 'Failed to calculate salaries',
            error: error.message
        });
    }
});

/**
 * GET monthly salaries
 */
router.get('/monthly', requireAuth, requirePermission('salary', 'view'), async (req, res) => {
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
            message: 'Failed to fetch monthly salaries',
            error: error.message
        });
    }
});

/**
 * GET single monthly salary details
 */
router.get('/monthly/:id', requireAuth, requirePermission('salary', 'view'), async (req, res) => {
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
            message: 'Failed to fetch monthly salary',
            error: error.message
        });
    }
});

/**
 * PUT approve monthly salary
 */
router.put('/monthly/:id/approve', requireAuth, requirePermission('salary', 'approve'), async (req, res) => {
    try {
        const { notes } = req.body;
        
        await pool.query(`
            UPDATE monthly_salaries 
            SET status = 'approved',
                approved_by = ?,
                approved_at = NOW(),
                notes = CONCAT(COALESCE(notes, ''), '\n\nApproval: ', ?)
            WHERE id = ?
        `, [req.user.id, notes || 'Approved', req.params.id]);
        
        res.json({
            success: true,
            message: 'Salary approved successfully'
        });
        
    } catch (error) {
        console.error('Error approving salary:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to approve salary',
            error: error.message
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
        updates.push('total_deductions = late_deduction + absence_deduction + other_deduction');
        
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
            message: 'Failed to update adjustments',
            error: error.message
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
            message: 'Failed to record payment',
            error: error.message
        });
    }
});

/**
 * GET payment history
 */
router.get('/payments', requireAuth, requirePermission('salary', 'view'), async (req, res) => {
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
            message: 'Failed to fetch payments',
            error: error.message
        });
    }
});

// ========================================
// REPORTS & ANALYTICS
// ========================================

/**
 * GET salary summary by month
 */
router.get('/reports/summary', requireAuth, requirePermission('salary', 'view'), async (req, res) => {
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
            message: 'Failed to fetch salary summary',
            error: error.message
        });
    }
});

module.exports = {
    router,
    setPool
};
