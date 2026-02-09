-- ========================================
-- SALARY MODULE DATABASE SCHEMA
-- Quality Colours Business Manager
-- Date: 2026-02-08
-- ========================================

USE qc_business_manager;

-- ========================================
-- 1. STAFF SALARY CONFIGURATION
-- ========================================

CREATE TABLE IF NOT EXISTS staff_salary_config (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    branch_id INT NOT NULL,
    
    -- Salary Details
    monthly_salary DECIMAL(10,2) NOT NULL,
    hourly_rate DECIMAL(10,2) GENERATED ALWAYS AS (monthly_salary / 260) STORED, -- 26 working days * 10 hours
    overtime_multiplier DECIMAL(3,2) DEFAULT 1.50,
    
    -- Work Hours
    standard_daily_hours DECIMAL(4,2) DEFAULT 10.00,
    sunday_hours DECIMAL(4,2) DEFAULT 5.00,
    
    -- Deductions
    enable_late_deduction BOOLEAN DEFAULT 1,
    late_deduction_per_hour DECIMAL(10,2) DEFAULT 0,
    enable_absence_deduction BOOLEAN DEFAULT 1,
    
    -- Allowances
    transport_allowance DECIMAL(10,2) DEFAULT 0,
    food_allowance DECIMAL(10,2) DEFAULT 0,
    other_allowance DECIMAL(10,2) DEFAULT 0,
    allowance_notes TEXT,
    
    -- Status
    effective_from DATE NOT NULL,
    effective_until DATE NULL,
    is_active BOOLEAN DEFAULT 1,
    
    -- Metadata
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (branch_id) REFERENCES branches(id),
    FOREIGN KEY (created_by) REFERENCES users(id),
    
    INDEX idx_user_active (user_id, is_active),
    INDEX idx_branch (branch_id),
    INDEX idx_effective_dates (effective_from, effective_until)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 2. MONTHLY SALARY CALCULATIONS
-- ========================================

CREATE TABLE IF NOT EXISTS monthly_salaries (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    branch_id INT NOT NULL,
    
    -- Period
    salary_month VARCHAR(7) NOT NULL, -- YYYY-MM format
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    
    -- Attendance Summary
    total_working_days INT DEFAULT 0,
    total_present_days INT DEFAULT 0,
    total_absent_days INT DEFAULT 0,
    total_half_days INT DEFAULT 0,
    total_sundays_worked INT DEFAULT 0,
    total_leaves INT DEFAULT 0,
    
    -- Hours Summary
    total_standard_hours DECIMAL(10,2) DEFAULT 0, -- Regular hours worked
    total_sunday_hours DECIMAL(10,2) DEFAULT 0,   -- Sunday hours
    total_overtime_hours DECIMAL(10,2) DEFAULT 0, -- Overtime hours
    total_worked_hours DECIMAL(10,2) DEFAULT 0,   -- Sum of all hours
    
    -- Salary Calculation
    base_salary DECIMAL(10,2) NOT NULL,           -- From config
    standard_hours_pay DECIMAL(10,2) DEFAULT 0,   -- Regular hours * hourly_rate
    sunday_hours_pay DECIMAL(10,2) DEFAULT 0,     -- Sunday hours * hourly_rate
    overtime_pay DECIMAL(10,2) DEFAULT 0,         -- Overtime * hourly_rate * 1.5
    
    -- Allowances
    transport_allowance DECIMAL(10,2) DEFAULT 0,
    food_allowance DECIMAL(10,2) DEFAULT 0,
    other_allowance DECIMAL(10,2) DEFAULT 0,
    total_allowances DECIMAL(10,2) DEFAULT 0,
    
    -- Deductions
    late_deduction DECIMAL(10,2) DEFAULT 0,
    absence_deduction DECIMAL(10,2) DEFAULT 0,
    other_deduction DECIMAL(10,2) DEFAULT 0,
    deduction_notes TEXT,
    total_deductions DECIMAL(10,2) DEFAULT 0,
    
    -- Final Calculation
    gross_salary DECIMAL(10,2) GENERATED ALWAYS AS (
        standard_hours_pay + sunday_hours_pay + overtime_pay + total_allowances
    ) STORED,
    net_salary DECIMAL(10,2) GENERATED ALWAYS AS (
        standard_hours_pay + sunday_hours_pay + overtime_pay + total_allowances - total_deductions
    ) STORED,
    
    -- Status
    status ENUM('draft', 'calculated', 'approved', 'paid') DEFAULT 'draft',
    calculation_date TIMESTAMP NULL,
    approved_by INT NULL,
    approved_at TIMESTAMP NULL,
    
    -- Payment
    payment_status ENUM('unpaid', 'partial', 'paid') DEFAULT 'unpaid',
    paid_amount DECIMAL(10,2) DEFAULT 0,
    payment_date DATE NULL,
    payment_method VARCHAR(50) NULL,
    payment_reference VARCHAR(100) NULL,
    
    -- Metadata
    calculated_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    notes TEXT,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (branch_id) REFERENCES branches(id),
    FOREIGN KEY (approved_by) REFERENCES users(id),
    FOREIGN KEY (calculated_by) REFERENCES users(id),
    
    UNIQUE KEY unique_user_month (user_id, salary_month),
    INDEX idx_salary_month (salary_month),
    INDEX idx_branch_month (branch_id, salary_month),
    INDEX idx_status (status),
    INDEX idx_payment_status (payment_status),
    INDEX idx_payment_date (payment_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 3. SALARY PAYMENT TRACKING
-- ========================================

CREATE TABLE IF NOT EXISTS salary_payments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    monthly_salary_id INT NOT NULL,
    user_id INT NOT NULL,
    
    -- Payment Details
    payment_date DATE NOT NULL,
    amount_paid DECIMAL(10,2) NOT NULL,
    payment_method ENUM('cash', 'bank_transfer', 'upi', 'cheque', 'other') NOT NULL,
    payment_reference VARCHAR(100),
    
    -- Bank Details (if applicable)
    bank_name VARCHAR(100),
    account_number VARCHAR(50),
    transaction_id VARCHAR(100),
    
    -- Receipt
    receipt_number VARCHAR(50),
    receipt_photo VARCHAR(500),
    
    -- Status
    is_verified BOOLEAN DEFAULT 0,
    verified_by INT NULL,
    verified_at TIMESTAMP NULL,
    
    -- Metadata
    paid_by INT NOT NULL,
    paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    
    FOREIGN KEY (monthly_salary_id) REFERENCES monthly_salaries(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (paid_by) REFERENCES users(id),
    FOREIGN KEY (verified_by) REFERENCES users(id),
    
    INDEX idx_monthly_salary (monthly_salary_id),
    INDEX idx_user (user_id),
    INDEX idx_payment_date (payment_date),
    INDEX idx_payment_method (payment_method)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 4. SALARY ADJUSTMENT LOGS
-- ========================================

CREATE TABLE IF NOT EXISTS salary_adjustments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    monthly_salary_id INT NOT NULL,
    user_id INT NOT NULL,
    
    -- Adjustment Details
    adjustment_type ENUM('bonus', 'penalty', 'advance', 'loan_recovery', 'other') NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    description TEXT NOT NULL,
    
    -- Status
    is_applied BOOLEAN DEFAULT 1,
    
    -- Metadata
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    FOREIGN KEY (monthly_salary_id) REFERENCES monthly_salaries(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (created_by) REFERENCES users(id),
    
    INDEX idx_monthly_salary (monthly_salary_id),
    INDEX idx_user (user_id),
    INDEX idx_type (adjustment_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 5. LEAVE BALANCE TRACKING
-- ========================================

CREATE TABLE IF NOT EXISTS staff_leave_balance (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    year INT NOT NULL,
    
    -- Leave Quotas
    total_annual_leaves INT DEFAULT 12,
    total_sick_leaves INT DEFAULT 6,
    total_casual_leaves INT DEFAULT 6,
    
    -- Used Leaves
    used_annual_leaves INT DEFAULT 0,
    used_sick_leaves INT DEFAULT 0,
    used_casual_leaves INT DEFAULT 0,
    
    -- Remaining
    remaining_annual_leaves INT GENERATED ALWAYS AS (total_annual_leaves - used_annual_leaves) STORED,
    remaining_sick_leaves INT GENERATED ALWAYS AS (total_sick_leaves - used_sick_leaves) STORED,
    remaining_casual_leaves INT GENERATED ALWAYS AS (total_casual_leaves - used_casual_leaves) STORED,
    
    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_year (user_id, year),
    INDEX idx_year (year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 6. INSERT DEFAULT SALARY CONFIGS
-- ========================================

-- This will be done via admin panel
-- Sample insert for reference:
/*
INSERT INTO staff_salary_config (user_id, branch_id, monthly_salary, effective_from, created_by)
VALUES (
    2,  -- staff user_id
    1,  -- branch_id
    15000.00,  -- monthly salary
    '2026-02-01',  -- effective from
    1   -- created by admin
);
*/

-- ========================================
-- 7. STORED PROCEDURE: CALCULATE MONTHLY SALARY
-- ========================================

DELIMITER //

CREATE PROCEDURE IF NOT EXISTS calculate_monthly_salary(
    IN p_user_id INT,
    IN p_month VARCHAR(7)  -- Format: YYYY-MM
)
BEGIN
    DECLARE v_salary_id INT;
    DECLARE v_branch_id INT;
    DECLARE v_base_salary DECIMAL(10,2);
    DECLARE v_hourly_rate DECIMAL(10,2);
    DECLARE v_overtime_multiplier DECIMAL(3,2);
    DECLARE v_from_date DATE;
    DECLARE v_to_date DATE;
    
    -- Calculate date range
    SET v_from_date = CONCAT(p_month, '-01');
    SET v_to_date = LAST_DAY(v_from_date);
    
    -- Get salary config
    SELECT 
        sc.branch_id,
        sc.monthly_salary,
        sc.hourly_rate,
        sc.overtime_multiplier
    INTO 
        v_branch_id,
        v_base_salary,
        v_hourly_rate,
        v_overtime_multiplier
    FROM staff_salary_config sc
    WHERE sc.user_id = p_user_id
      AND sc.is_active = 1
      AND v_from_date >= sc.effective_from
      AND (sc.effective_until IS NULL OR v_to_date <= sc.effective_until)
    LIMIT 1;
    
    -- Check if salary record exists
    SELECT id INTO v_salary_id 
    FROM monthly_salaries 
    WHERE user_id = p_user_id AND salary_month = p_month;
    
    -- Create or update salary record
    IF v_salary_id IS NULL THEN
        INSERT INTO monthly_salaries (
            user_id, branch_id, salary_month, from_date, to_date, base_salary, calculated_by
        ) VALUES (
            p_user_id, v_branch_id, p_month, v_from_date, v_to_date, v_base_salary, @current_user_id
        );
        SET v_salary_id = LAST_INSERT_ID();
    END IF;
    
    -- Calculate attendance summary
    UPDATE monthly_salaries ms
    SET
        -- Attendance counts
        total_present_days = (
            SELECT COUNT(*) FROM staff_attendance 
            WHERE user_id = p_user_id 
              AND date BETWEEN v_from_date AND v_to_date
              AND status = 'present'
        ),
        total_absent_days = (
            SELECT COUNT(*) FROM staff_attendance 
            WHERE user_id = p_user_id 
              AND date BETWEEN v_from_date AND v_to_date
              AND status = 'absent'
        ),
        total_half_days = (
            SELECT COUNT(*) FROM staff_attendance 
            WHERE user_id = p_user_id 
              AND date BETWEEN v_from_date AND v_to_date
              AND status = 'half_day'
        ),
        
        -- Sunday work count
        total_sundays_worked = (
            SELECT COUNT(*) FROM staff_attendance 
            WHERE user_id = p_user_id 
              AND date BETWEEN v_from_date AND v_to_date
              AND DAYOFWEEK(date) = 1  -- Sunday
              AND status = 'present'
        ),
        
        -- Standard hours (non-Sunday working days)
        total_standard_hours = (
            SELECT COALESCE(SUM(total_working_minutes) / 60, 0)
            FROM staff_attendance 
            WHERE user_id = p_user_id 
              AND date BETWEEN v_from_date AND v_to_date
              AND DAYOFWEEK(date) != 1  -- Not Sunday
              AND status = 'present'
              AND total_working_minutes <= 600  -- Up to 10 hours
        ),
        
        -- Sunday hours
        total_sunday_hours = (
            SELECT COALESCE(SUM(total_working_minutes) / 60, 0)
            FROM staff_attendance 
            WHERE user_id = p_user_id 
              AND date BETWEEN v_from_date AND v_to_date
              AND DAYOFWEEK(date) = 1  -- Sunday
              AND status = 'present'
        ),
        
        -- Overtime hours (work beyond 10 hours on regular days)
        total_overtime_hours = (
            SELECT COALESCE(SUM(GREATEST(total_working_minutes - 600, 0)) / 60, 0)
            FROM staff_attendance 
            WHERE user_id = p_user_id 
              AND date BETWEEN v_from_date AND v_to_date
              AND DAYOFWEEK(date) != 1  -- Not Sunday
              AND status = 'present'
              AND total_working_minutes > 600  -- More than 10 hours
        ),
        
        -- Calculate pay
        standard_hours_pay = total_standard_hours * v_hourly_rate,
        sunday_hours_pay = total_sunday_hours * v_hourly_rate,
        overtime_pay = total_overtime_hours * v_hourly_rate * v_overtime_multiplier,
        
        -- Update status
        status = 'calculated',
        calculation_date = NOW()
        
    WHERE id = v_salary_id;
    
    SELECT v_salary_id AS salary_id, 'Salary calculated successfully' AS message;
END //

DELIMITER ;

-- ========================================
-- 8. GRANT EXECUTE PERMISSIONS
-- ========================================

GRANT EXECUTE ON PROCEDURE qc_business_manager.calculate_monthly_salary TO 'qc_admin'@'localhost';
FLUSH PRIVILEGES;

-- ========================================
-- SUCCESS MESSAGE
-- ========================================

SELECT '✅ Salary Module Database Setup Complete!' as message,
       'Tables: staff_salary_config, monthly_salaries, salary_payments, salary_adjustments, staff_leave_balance' as tables_created,
       'Next: Build admin interfaces' as next_step;
