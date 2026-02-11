-- ========================================
-- DATABASE UPGRADE SCRIPT
-- Quality Colours Business Manager
-- Run this on EXISTING databases to add
-- missing columns and new tables.
-- Safe to run multiple times (idempotent).
-- ========================================

USE qc_business_manager;

-- ========================================
-- HELPER: Procedure to safely add columns
-- ========================================
DROP PROCEDURE IF EXISTS safe_add_column;
DELIMITER //
CREATE PROCEDURE safe_add_column(
    IN tbl VARCHAR(64),
    IN col VARCHAR(64),
    IN col_def VARCHAR(500)
)
BEGIN
    SET @exists = 0;
    SELECT COUNT(*) INTO @exists
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = tbl
      AND COLUMN_NAME = col;

    IF @exists = 0 THEN
        SET @sql = CONCAT('ALTER TABLE `', tbl, '` ADD COLUMN `', col, '` ', col_def);
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
        SELECT CONCAT('Added column: ', tbl, '.', col) AS upgrade_action;
    END IF;
END//
DELIMITER ;

-- ========================================
-- 1. BRANCHES - Add missing columns
-- ========================================
CALL safe_add_column('branches', 'latitude', 'DECIMAL(10,8) NULL');
CALL safe_add_column('branches', 'longitude', 'DECIMAL(11,8) NULL');
CALL safe_add_column('branches', 'geo_fence_radius_meters', 'INT DEFAULT 200');
CALL safe_add_column('branches', 'open_time', "TIME DEFAULT '08:30:00'");
CALL safe_add_column('branches', 'close_time', "TIME DEFAULT '20:30:00'");

-- ========================================
-- 2. ROLES - Add missing columns
-- ========================================
CALL safe_add_column('roles', 'user_type', "ENUM('staff','customer') NOT NULL DEFAULT 'staff'");
CALL safe_add_column('roles', 'is_system_role', 'BOOLEAN DEFAULT FALSE');
CALL safe_add_column('roles', 'price_markup_percent', 'DECIMAL(5,2) DEFAULT 0');
CALL safe_add_column('roles', 'default_discount_percent', 'DECIMAL(5,2) DEFAULT 0');

-- ========================================
-- 3. SHOP HOURS CONFIG - Add missing columns
-- ========================================
CALL safe_add_column('shop_hours_config', 'is_open', 'BOOLEAN DEFAULT 1 AFTER day_of_week');

-- ========================================
-- 4. CUSTOMERS - Add missing columns
-- ========================================
CALL safe_add_column('customers', 'customer_type_id', 'INT NULL');
CALL safe_add_column('customers', 'branch_id', 'INT NULL');
CALL safe_add_column('customers', 'lead_id', 'INT NULL');
CALL safe_add_column('customers', 'whatsapp_opt_in', 'BOOLEAN DEFAULT 0');
CALL safe_add_column('customers', 'total_purchases', 'DECIMAL(12,2) DEFAULT 0');
CALL safe_add_column('customers', 'notes', 'TEXT NULL');

-- ========================================
-- 5. STAFF ATTENDANCE - Add missing columns
-- ========================================
CALL safe_add_column('staff_attendance', 'clock_in_address', 'TEXT NULL');
CALL safe_add_column('staff_attendance', 'clock_out_address', 'TEXT NULL');
CALL safe_add_column('staff_attendance', 'geo_fence_status', "ENUM('inside','outside','not_checked') DEFAULT 'not_checked'");
CALL safe_add_column('staff_attendance', 'geo_fence_distance', 'INT NULL');
CALL safe_add_column('staff_attendance', 'expected_hours', 'DECIMAL(4,2) DEFAULT 10.00');
CALL safe_add_column('staff_attendance', 'total_working_minutes', 'INT DEFAULT 0');
CALL safe_add_column('staff_attendance', 'total_break_minutes', 'INT DEFAULT 0');
CALL safe_add_column('staff_attendance', 'is_late', 'BOOLEAN DEFAULT 0');
CALL safe_add_column('staff_attendance', 'late_minutes', 'INT DEFAULT 0');

-- ========================================
-- 6. PERMISSIONS - Insert new permissions
-- ========================================
INSERT IGNORE INTO permissions (module, action, display_name) VALUES
('dashboard', 'view', 'View Dashboard'),
('dashboard', 'view_analytics', 'View Analytics'),
('leads', 'view', 'View Leads'),
('leads', 'add', 'Add Lead'),
('leads', 'edit', 'Edit Lead'),
('leads', 'delete', 'Delete Lead'),
('leads', 'convert', 'Convert Lead to Customer'),
('branches', 'view', 'View Branches'),
('branches', 'add', 'Add Branch'),
('branches', 'edit', 'Edit Branch'),
('branches', 'delete', 'Delete Branch'),
('salary', 'view', 'View Salary'),
('salary', 'manage', 'Manage Salary'),
('salary', 'approve', 'Approve Salary'),
('activities', 'view', 'View Activities'),
('activities', 'add', 'Add Activity'),
('activities', 'manage', 'Manage Activities'),
('tasks', 'view', 'View Tasks'),
('tasks', 'add', 'Create Tasks'),
('tasks', 'edit', 'Edit Tasks'),
('tasks', 'delete', 'Delete Tasks'),
('tasks', 'manage', 'Manage All Tasks'),
('roles', 'view', 'View Roles'),
('roles', 'manage', 'Manage Roles'),
('settings', 'view', 'View Settings'),
('settings', 'manage', 'Manage Settings');

-- ========================================
-- 7. Grant admin role ALL permissions
-- ========================================
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.name = 'admin';

-- ========================================
-- 8. CREATE NEW TABLES (safe - IF NOT EXISTS)
-- ========================================

-- Customer Types
CREATE TABLE IF NOT EXISTS customer_types (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) UNIQUE NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    discount_percent DECIMAL(5,2) DEFAULT 0,
    price_markup_percent DECIMAL(5,2) DEFAULT 0,
    description TEXT,
    status ENUM('active','inactive') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO customer_types (name, display_name, description) VALUES
('retail', 'Retail Customer', 'Walk-in retail customers'),
('dealer', 'Dealer', 'Paint dealers and distributors'),
('contractor', 'Contractor', 'Painting contractors'),
('architect', 'Architect', 'Architects and interior designers'),
('builder', 'Builder', 'Construction builders')
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name);

-- Pack Sizes
CREATE TABLE IF NOT EXISTS pack_sizes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50) NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    volume_liters DECIMAL(10,3) NOT NULL,
    sort_order INT DEFAULT 0,
    is_active BOOLEAN DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO pack_sizes (name, display_name, volume_liters, sort_order) VALUES
('100ml', '100 ml', 0.1, 1),
('200ml', '200 ml', 0.2, 2),
('500ml', '500 ml', 0.5, 3),
('1L', '1 Litre', 1.0, 4),
('4L', '4 Litres', 4.0, 5),
('10L', '10 Litres', 10.0, 6),
('20L', '20 Litres', 20.0, 7)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name);

-- Leads
CREATE TABLE IF NOT EXISTS leads (
    id INT PRIMARY KEY AUTO_INCREMENT,
    lead_number VARCHAR(50) UNIQUE,
    full_name VARCHAR(255) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(255),
    company_name VARCHAR(255),
    lead_source ENUM('walk_in','phone','website','referral','social_media','advertisement','other') DEFAULT 'walk_in',
    lead_type ENUM('hot','warm','cold') DEFAULT 'warm',
    status ENUM('new','contacted','interested','quoted','negotiating','won','lost','inactive') DEFAULT 'new',
    project_type VARCHAR(100),
    property_type VARCHAR(100),
    location TEXT,
    area_sqft DECIMAL(10,2),
    budget_range VARCHAR(100),
    requirements TEXT,
    notes TEXT,
    assigned_to INT NULL,
    branch_id INT NULL,
    converted_customer_id INT NULL,
    next_followup_date DATE NULL,
    last_contacted_at DATETIME NULL,
    lost_reason TEXT,
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id),
    INDEX idx_status (status),
    INDEX idx_phone (phone),
    INDEX idx_assigned (assigned_to),
    INDEX idx_followup (next_followup_date),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Lead Followups
CREATE TABLE IF NOT EXISTS lead_followups (
    id INT PRIMARY KEY AUTO_INCREMENT,
    lead_id INT NOT NULL,
    user_id INT NOT NULL,
    followup_type ENUM('call','visit','email','whatsapp','meeting','other') NOT NULL,
    notes TEXT NOT NULL,
    next_followup_date DATE NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id),
    INDEX idx_lead (lead_id),
    INDEX idx_next_followup (next_followup_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Attendance Photos
CREATE TABLE IF NOT EXISTS attendance_photos (
    id INT PRIMARY KEY AUTO_INCREMENT,
    attendance_id INT NOT NULL,
    user_id INT NOT NULL,
    photo_type ENUM('clock_in','clock_out','break') NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_size INT DEFAULT 0,
    latitude DECIMAL(10,8) NULL,
    longitude DECIMAL(11,8) NULL,
    address TEXT NULL,
    captured_at DATETIME NOT NULL,
    delete_after DATE NULL,
    is_deleted BOOLEAN DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (attendance_id) REFERENCES staff_attendance(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_attendance (attendance_id),
    INDEX idx_user (user_id),
    INDEX idx_delete_after (delete_after)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Attendance Permissions/Requests
CREATE TABLE IF NOT EXISTS attendance_permissions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    attendance_id INT NULL,
    request_type ENUM('late_arrival','early_checkout','extended_break','leave','half_day') NOT NULL,
    request_date DATE NOT NULL,
    request_time TIME NULL,
    duration_minutes INT NULL,
    reason TEXT NOT NULL,
    status ENUM('pending','approved','rejected') DEFAULT 'pending',
    requested_by INT NOT NULL,
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    reviewed_by INT NULL,
    reviewed_at DATETIME NULL,
    review_notes TEXT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (attendance_id) REFERENCES staff_attendance(id) ON DELETE SET NULL,
    FOREIGN KEY (requested_by) REFERENCES users(id),
    FOREIGN KEY (reviewed_by) REFERENCES users(id),
    INDEX idx_user (user_id),
    INDEX idx_status (status),
    INDEX idx_date (request_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Estimate Requests
CREATE TABLE IF NOT EXISTS estimate_requests (
    id INT PRIMARY KEY AUTO_INCREMENT,
    request_number VARCHAR(50) UNIQUE NOT NULL,
    customer_name VARCHAR(255) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    email VARCHAR(255),
    project_type VARCHAR(50) DEFAULT 'interior',
    property_type VARCHAR(50) DEFAULT 'house',
    location TEXT,
    area_sqft DECIMAL(10,2) DEFAULT 0,
    rooms INT NULL,
    preferred_brand VARCHAR(100),
    timeline VARCHAR(100),
    budget_range VARCHAR(100),
    additional_notes TEXT,
    products_json JSON NULL,
    request_method VARCHAR(50) DEFAULT 'simple',
    status ENUM('new','contacted','quote_sent','accepted','rejected','converted','expired') DEFAULT 'new',
    priority ENUM('low','medium','high','urgent') DEFAULT 'medium',
    assigned_to_user_id INT NULL,
    assigned_at DATETIME NULL,
    estimate_id INT NULL,
    contacted_at DATETIME NULL,
    quote_sent_at DATETIME NULL,
    source VARCHAR(50) DEFAULT 'website',
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (assigned_to_user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_status (status),
    INDEX idx_phone (phone),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Estimate Request Photos
CREATE TABLE IF NOT EXISTS estimate_request_photos (
    id INT PRIMARY KEY AUTO_INCREMENT,
    request_id INT NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    file_name VARCHAR(255),
    file_size INT DEFAULT 0,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (request_id) REFERENCES estimate_requests(id) ON DELETE CASCADE,
    INDEX idx_request (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Estimate Request Products
CREATE TABLE IF NOT EXISTS estimate_request_products (
    id INT PRIMARY KEY AUTO_INCREMENT,
    request_id INT NOT NULL,
    product_id INT NULL,
    product_name VARCHAR(255),
    calculation_type VARCHAR(50),
    pack_size VARCHAR(50),
    quantity DECIMAL(10,2),
    area_sqft DECIMAL(10,2),
    coats INT DEFAULT 1,
    raw_data JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (request_id) REFERENCES estimate_requests(id) ON DELETE CASCADE,
    INDEX idx_request (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Estimate Request Activity
CREATE TABLE IF NOT EXISTS estimate_request_activity (
    id INT PRIMARY KEY AUTO_INCREMENT,
    request_id INT NOT NULL,
    user_id INT NULL,
    action VARCHAR(50) NOT NULL,
    old_value TEXT NULL,
    new_value TEXT NULL,
    notes TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (request_id) REFERENCES estimate_requests(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_request (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Staff Daily Activities
CREATE TABLE IF NOT EXISTS staff_activities (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    branch_id INT NULL,
    activity_date DATE NOT NULL,
    activity_time TIME NOT NULL,
    activity_type ENUM('customer_visit','store_work','delivery','meeting','follow_up','admin_work','training','other') NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    customer_name VARCHAR(255),
    customer_phone VARCHAR(20),
    location TEXT,
    latitude DECIMAL(10,8) NULL,
    longitude DECIMAL(11,8) NULL,
    start_time TIME NULL,
    end_time TIME NULL,
    duration_minutes INT NULL,
    outcome TEXT,
    status ENUM('planned','in_progress','completed','cancelled') DEFAULT 'completed',
    photo_url VARCHAR(500),
    document_url VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
    INDEX idx_user_date (user_id, activity_date),
    INDEX idx_branch_date (branch_id, activity_date),
    INDEX idx_type (activity_type),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Staff Tasks
CREATE TABLE IF NOT EXISTS staff_tasks (
    id INT PRIMARY KEY AUTO_INCREMENT,
    task_number VARCHAR(50) UNIQUE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    task_type ENUM('daily','weekly','monthly','one_time','recurring') DEFAULT 'daily',
    priority ENUM('low','medium','high','urgent') DEFAULT 'medium',
    category VARCHAR(100),
    assigned_to INT NOT NULL,
    assigned_by INT NOT NULL,
    branch_id INT NULL,
    due_date DATE NOT NULL,
    due_time TIME NULL,
    start_date DATE NULL,
    estimated_hours DECIMAL(4,2) NULL,
    status ENUM('pending','in_progress','completed','overdue','cancelled','on_hold') DEFAULT 'pending',
    completion_percentage INT DEFAULT 0,
    completed_at DATETIME NULL,
    actual_hours DECIMAL(4,2) NULL,
    staff_notes TEXT,
    admin_notes TEXT,
    rating INT NULL CHECK (rating BETWEEN 1 AND 5),
    rating_notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (assigned_by) REFERENCES users(id),
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
    INDEX idx_assigned_to (assigned_to),
    INDEX idx_assigned_by (assigned_by),
    INDEX idx_status (status),
    INDEX idx_due_date (due_date),
    INDEX idx_priority (priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Task Updates
CREATE TABLE IF NOT EXISTS task_updates (
    id INT PRIMARY KEY AUTO_INCREMENT,
    task_id INT NOT NULL,
    user_id INT NOT NULL,
    update_type ENUM('status_change','comment','progress','photo','attachment') NOT NULL,
    old_status VARCHAR(50),
    new_status VARCHAR(50),
    comment TEXT,
    photo_url VARCHAR(500),
    progress_percentage INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES staff_tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_task (task_id),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Staff Salary Config
CREATE TABLE IF NOT EXISTS staff_salary_config (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    branch_id INT NOT NULL,
    monthly_salary DECIMAL(10,2) NOT NULL,
    hourly_rate DECIMAL(10,2) GENERATED ALWAYS AS (monthly_salary / 260) STORED,
    overtime_multiplier DECIMAL(3,2) DEFAULT 1.50,
    standard_daily_hours DECIMAL(4,2) DEFAULT 10.00,
    sunday_hours DECIMAL(4,2) DEFAULT 5.00,
    enable_late_deduction BOOLEAN DEFAULT 1,
    late_deduction_per_hour DECIMAL(10,2) DEFAULT 0,
    enable_absence_deduction BOOLEAN DEFAULT 1,
    transport_allowance DECIMAL(10,2) DEFAULT 0,
    food_allowance DECIMAL(10,2) DEFAULT 0,
    other_allowance DECIMAL(10,2) DEFAULT 0,
    allowance_notes TEXT,
    effective_from DATE NOT NULL,
    effective_until DATE NULL,
    is_active BOOLEAN DEFAULT 1,
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

-- Monthly Salaries
CREATE TABLE IF NOT EXISTS monthly_salaries (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    branch_id INT NOT NULL,
    salary_month VARCHAR(7) NOT NULL,
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    total_working_days INT DEFAULT 0,
    total_present_days INT DEFAULT 0,
    total_absent_days INT DEFAULT 0,
    total_half_days INT DEFAULT 0,
    total_sundays_worked INT DEFAULT 0,
    total_leaves INT DEFAULT 0,
    total_standard_hours DECIMAL(10,2) DEFAULT 0,
    total_sunday_hours DECIMAL(10,2) DEFAULT 0,
    total_overtime_hours DECIMAL(10,2) DEFAULT 0,
    total_worked_hours DECIMAL(10,2) DEFAULT 0,
    base_salary DECIMAL(10,2) NOT NULL,
    standard_hours_pay DECIMAL(10,2) DEFAULT 0,
    sunday_hours_pay DECIMAL(10,2) DEFAULT 0,
    overtime_pay DECIMAL(10,2) DEFAULT 0,
    transport_allowance DECIMAL(10,2) DEFAULT 0,
    food_allowance DECIMAL(10,2) DEFAULT 0,
    other_allowance DECIMAL(10,2) DEFAULT 0,
    total_allowances DECIMAL(10,2) DEFAULT 0,
    late_deduction DECIMAL(10,2) DEFAULT 0,
    absence_deduction DECIMAL(10,2) DEFAULT 0,
    other_deduction DECIMAL(10,2) DEFAULT 0,
    deduction_notes TEXT,
    total_deductions DECIMAL(10,2) DEFAULT 0,
    gross_salary DECIMAL(10,2) GENERATED ALWAYS AS (
        standard_hours_pay + sunday_hours_pay + overtime_pay + total_allowances
    ) STORED,
    net_salary DECIMAL(10,2) GENERATED ALWAYS AS (
        standard_hours_pay + sunday_hours_pay + overtime_pay + total_allowances - total_deductions
    ) STORED,
    status ENUM('draft', 'calculated', 'approved', 'paid') DEFAULT 'draft',
    calculation_date TIMESTAMP NULL,
    approved_by INT NULL,
    approved_at TIMESTAMP NULL,
    payment_status ENUM('unpaid', 'partial', 'paid') DEFAULT 'unpaid',
    paid_amount DECIMAL(10,2) DEFAULT 0,
    payment_date DATE NULL,
    payment_method VARCHAR(50) NULL,
    payment_reference VARCHAR(100) NULL,
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
    INDEX idx_payment_status (payment_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Salary Payments
CREATE TABLE IF NOT EXISTS salary_payments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    monthly_salary_id INT NOT NULL,
    user_id INT NOT NULL,
    payment_date DATE NOT NULL,
    amount_paid DECIMAL(10,2) NOT NULL,
    payment_method ENUM('cash', 'bank_transfer', 'upi', 'cheque', 'other') NOT NULL,
    payment_reference VARCHAR(100),
    bank_name VARCHAR(100),
    account_number VARCHAR(50),
    transaction_id VARCHAR(100),
    receipt_number VARCHAR(50),
    receipt_photo VARCHAR(500),
    is_verified BOOLEAN DEFAULT 0,
    verified_by INT NULL,
    verified_at TIMESTAMP NULL,
    paid_by INT NOT NULL,
    paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notes TEXT,
    FOREIGN KEY (monthly_salary_id) REFERENCES monthly_salaries(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (paid_by) REFERENCES users(id),
    FOREIGN KEY (verified_by) REFERENCES users(id),
    INDEX idx_monthly_salary (monthly_salary_id),
    INDEX idx_user (user_id),
    INDEX idx_payment_date (payment_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Salary Adjustments
CREATE TABLE IF NOT EXISTS salary_adjustments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    monthly_salary_id INT NOT NULL,
    user_id INT NOT NULL,
    adjustment_type ENUM('bonus', 'penalty', 'advance', 'loan_recovery', 'other') NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    description TEXT NOT NULL,
    is_applied BOOLEAN DEFAULT 1,
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (monthly_salary_id) REFERENCES monthly_salaries(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (created_by) REFERENCES users(id),
    INDEX idx_monthly_salary_adj (monthly_salary_id),
    INDEX idx_user_adj (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Staff Leave Balance
CREATE TABLE IF NOT EXISTS staff_leave_balance (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    year INT NOT NULL,
    total_annual_leaves INT DEFAULT 12,
    total_sick_leaves INT DEFAULT 6,
    total_casual_leaves INT DEFAULT 6,
    used_annual_leaves INT DEFAULT 0,
    used_sick_leaves INT DEFAULT 0,
    used_casual_leaves INT DEFAULT 0,
    remaining_annual_leaves INT GENERATED ALWAYS AS (total_annual_leaves - used_annual_leaves) STORED,
    remaining_sick_leaves INT GENERATED ALWAYS AS (total_sick_leaves - used_sick_leaves) STORED,
    remaining_casual_leaves INT GENERATED ALWAYS AS (total_casual_leaves - used_casual_leaves) STORED,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_user_year (user_id, year),
    INDEX idx_year (year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- OTP Verifications (if missing)
CREATE TABLE IF NOT EXISTS otp_verifications (
    id INT PRIMARY KEY AUTO_INCREMENT,
    phone VARCHAR(20) NOT NULL,
    otp_code VARCHAR(10) NOT NULL,
    purpose ENUM('login','register','reset_password') DEFAULT 'login',
    is_verified BOOLEAN DEFAULT FALSE,
    attempts INT DEFAULT 0,
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_phone (phone),
    INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Settings (if missing)
CREATE TABLE IF NOT EXISTS settings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value TEXT,
    setting_type ENUM('string','number','boolean','json') DEFAULT 'string',
    description TEXT,
    is_public BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 9. INSERT DEFAULT DATA
-- ========================================

-- Shop hours for branch 1 (safe - ON DUPLICATE KEY)
INSERT INTO shop_hours_config (branch_id, day_of_week, is_open, open_time, close_time, expected_hours, late_threshold_minutes, break_min_minutes, break_max_minutes)
SELECT 1, day, 1,
    CASE WHEN day = 'sunday' THEN '09:00:00' ELSE '08:30:00' END,
    CASE WHEN day = 'sunday' THEN '14:00:00' ELSE '20:30:00' END,
    CASE WHEN day = 'sunday' THEN 5.00 ELSE 10.00 END,
    15, 60, 120
FROM (SELECT 'monday' AS day UNION SELECT 'tuesday' UNION SELECT 'wednesday' UNION SELECT 'thursday' UNION SELECT 'friday' UNION SELECT 'saturday' UNION SELECT 'sunday') days
ON DUPLICATE KEY UPDATE open_time = VALUES(open_time);

-- Default settings
INSERT INTO settings (setting_key, setting_value, setting_type, description, is_public) VALUES
('company_name', 'Quality Colours', 'string', 'Company display name', TRUE),
('company_phone', '', 'string', 'Company contact phone', TRUE),
('company_email', '', 'string', 'Company contact email', TRUE),
('company_address', '', 'string', 'Company address', TRUE),
('gst_number', '', 'string', 'GST registration number', FALSE),
('estimate_prefix', 'QC', 'string', 'Estimate number prefix', FALSE),
('estimate_validity_days', '30', 'number', 'Estimate validity in days', FALSE),
('photo_retention_days', '40', 'number', 'Attendance photo retention days', FALSE),
('geo_fence_enabled', 'true', 'boolean', 'Enable geo-fencing for attendance', FALSE),
('default_geo_fence_radius', '200', 'number', 'Default geo-fence radius in meters', FALSE)
ON DUPLICATE KEY UPDATE setting_key = setting_key;

-- ========================================
-- CLEANUP
-- ========================================
DROP PROCEDURE IF EXISTS safe_add_column;

SELECT '✅ Database upgrade completed successfully!' AS result;
