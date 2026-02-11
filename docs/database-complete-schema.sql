-- ========================================
-- COMPLETE DATABASE SCHEMA
-- Quality Colours Business Manager
-- Date: 2026-02-10 (Updated)
-- All modules: Auth, Roles, Permissions, Branches,
-- Customers, Leads, Products, Estimates, Attendance,
-- Salary, Activity Tracker, Task Management, Settings
-- Updated with attendance fixes and missing columns
-- ========================================

USE qc_business_manager;

-- ========================================
-- 1. BRANCHES TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS branches (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    code VARCHAR(50) UNIQUE,
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(100) DEFAULT 'Tamil Nadu',
    pincode VARCHAR(20),
    country VARCHAR(100) DEFAULT 'India',
    phone VARCHAR(20),
    email VARCHAR(255),
    manager_id INT NULL,
    latitude DECIMAL(10,8) NULL,
    longitude DECIMAL(11,8) NULL,
    geo_fence_radius INT DEFAULT 500 COMMENT 'Radius in meters',
    is_active BOOLEAN DEFAULT TRUE,
    opening_time TIME DEFAULT '09:00:00',
    closing_time TIME DEFAULT '18:00:00',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_code (code),
    INDEX idx_manager (manager_id),
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default branch
INSERT INTO branches (name, code, address, city, state, pincode, phone, email, geo_fence_radius) VALUES
('Quality Colours - Main Branch', 'QC-MAIN', 'Ramanathapuram', 'Ramanathapuram', 'Tamil Nadu', '623501', '+91 7418831122', 'info@qcpaintshop.com', 500)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- ========================================
-- 2. ROLES TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS roles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50) UNIQUE NOT NULL,
    display_name VARCHAR(100) NOT NULL,
    description TEXT,
    user_type ENUM('staff','customer') NOT NULL DEFAULT 'staff',
    is_system_role BOOLEAN DEFAULT FALSE,
    price_markup_percent DECIMAL(5,2) DEFAULT 0,
    default_discount_percent DECIMAL(5,2) DEFAULT 0,
    status ENUM('active','inactive') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_user_type (user_type),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default roles
INSERT INTO roles (name, display_name, description, user_type, is_system_role) VALUES
('admin', 'Administrator', 'Full system access', 'staff', TRUE),
('manager', 'Branch Manager', 'Branch-level management access', 'staff', TRUE),
('staff', 'Staff', 'Standard staff access', 'staff', TRUE),
('customer', 'Customer', 'Registered customer', 'customer', TRUE),
('guest', 'Guest', 'Unregistered visitor', 'customer', TRUE),
('dealer', 'Dealer', 'Paint dealer/distributor', 'customer', FALSE),
('contractor', 'Contractor', 'Painting contractor', 'customer', FALSE)
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name);

-- ========================================
-- 3. PERMISSIONS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS permissions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    module VARCHAR(50) NOT NULL,
    action VARCHAR(50) NOT NULL,
    display_name VARCHAR(100),
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_module_action (module, action),
    INDEX idx_module (module)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert all permissions for every module
INSERT INTO permissions (module, action, display_name) VALUES
-- Dashboard
('dashboard', 'view', 'View Dashboard'),
('dashboard', 'view_analytics', 'View Analytics'),
-- Staff Management
('staff', 'view', 'View Staff'),
('staff', 'add', 'Add Staff'),
('staff', 'edit', 'Edit Staff'),
('staff', 'delete', 'Delete Staff'),
-- Customer Management
('customers', 'view', 'View Customers'),
('customers', 'add', 'Add Customer'),
('customers', 'edit', 'Edit Customer'),
('customers', 'delete', 'Delete Customer'),
-- Leads
('leads', 'view', 'View Leads'),
('leads', 'add', 'Add Lead'),
('leads', 'edit', 'Edit Lead'),
('leads', 'delete', 'Delete Lead'),
('leads', 'convert', 'Convert Lead to Customer'),
-- Branches
('branches', 'view', 'View Branches'),
('branches', 'add', 'Add Branch'),
('branches', 'edit', 'Edit Branch'),
('branches', 'delete', 'Delete Branch'),
-- Brands
('brands', 'view', 'View Brands'),
('brands', 'add', 'Add Brand'),
('brands', 'edit', 'Edit Brand'),
('brands', 'delete', 'Delete Brand'),
-- Categories
('categories', 'view', 'View Categories'),
('categories', 'add', 'Add Category'),
('categories', 'edit', 'Edit Category'),
('categories', 'delete', 'Delete Category'),
-- Products
('products', 'view', 'View Products'),
('products', 'add', 'Add Product'),
('products', 'edit', 'Edit Product'),
('products', 'delete', 'Delete Product'),
-- Estimates
('estimates', 'view', 'View Estimates'),
('estimates', 'add', 'Create Estimate'),
('estimates', 'edit', 'Edit Estimate'),
('estimates', 'delete', 'Delete Estimate'),
('estimates', 'approve', 'Approve Estimate'),
-- Attendance
('attendance', 'view', 'View Attendance'),
('attendance', 'manage', 'Manage Attendance'),
('attendance', 'approve', 'Approve Attendance Requests'),
-- Salary
('salary', 'view', 'View Salary'),
('salary', 'manage', 'Manage Salary'),
('salary', 'approve', 'Approve Salary'),
-- Activity Tracker
('activities', 'view', 'View Activities'),
('activities', 'add', 'Add Activity'),
('activities', 'manage', 'Manage Activities'),
-- Task Management
('tasks', 'view', 'View Tasks'),
('tasks', 'add', 'Create Tasks'),
('tasks', 'edit', 'Edit Tasks'),
('tasks', 'delete', 'Delete Tasks'),
('tasks', 'assign', 'Assign Tasks'),
-- Roles & Permissions
('roles', 'view', 'View Roles'),
('roles', 'manage', 'Manage Roles'),
-- Settings
('settings', 'view', 'View Settings'),
('settings', 'manage', 'Manage Settings'),
-- Reports
('reports', 'view', 'View Reports'),
('reports', 'export', 'Export Reports')
ON DUPLICATE KEY UPDATE display_name = VALUES(display_name);

-- ========================================
-- 4. ROLE PERMISSIONS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS role_permissions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    role_id INT NOT NULL,
    permission_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
    UNIQUE KEY unique_role_perm (role_id, permission_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Grant all permissions to admin role
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name = 'admin';

-- Grant manager permissions
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'manager' AND p.module IN ('dashboard','staff','customers','leads','brands','categories','products','estimates','attendance','salary','activities','tasks','reports')
AND p.action IN ('view','add','edit','approve');

-- Grant staff basic permissions
INSERT IGNORE INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.name = 'staff' AND (
    (p.module = 'dashboard' AND p.action = 'view') OR
    (p.module = 'customers' AND p.action IN ('view','add')) OR
    (p.module = 'products' AND p.action = 'view') OR
    (p.module = 'estimates' AND p.action IN ('view','add','edit')) OR
    (p.module = 'attendance' AND p.action = 'view') OR
    (p.module = 'activities' AND p.action IN ('view','add')) OR
    (p.module = 'tasks' AND p.action = 'view')
);

-- ========================================
-- 5. USERS TABLE (add branch FK if missing)
-- ========================================
-- Already created via database-updates-phase1.sql, just add FK
-- ALTER TABLE users ADD CONSTRAINT fk_users_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL;

-- ========================================
-- 6. OTP VERIFICATIONS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS otp_verifications (
    id INT PRIMARY KEY AUTO_INCREMENT,
    phone VARCHAR(20) NOT NULL,
    otp VARCHAR(10) NOT NULL,
    purpose ENUM('Registration','Login','Password Reset') NOT NULL,
    verified BOOLEAN DEFAULT 0,
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_phone_purpose (phone, purpose),
    INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 7. SETTINGS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS settings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    setting_key VARCHAR(100) NOT NULL UNIQUE,
    setting_value TEXT,
    category VARCHAR(50) DEFAULT 'general',
    description TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_key (setting_key),
    INDEX idx_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Default settings
INSERT INTO settings (setting_key, setting_value, category, description) VALUES
('business_name', 'Quality Colours (குவாலிட்டி கலர்ஸ்)', 'business', 'Business name'),
('business_type', 'both', 'business', 'Business type: retail, wholesale, or both'),
('business_address', 'Ramanathapuram, Tamil Nadu, India', 'business', 'Business address'),
('business_phone', '+91 7418831122', 'business', 'Business phone number'),
('business_email', 'info@qcpaintshop.com', 'business', 'Business email'),
('business_logo', NULL, 'business', 'Business logo URL'),
('gst_number', NULL, 'tax', 'GST Number (GSTIN)'),
('pan_number', NULL, 'tax', 'PAN Number'),
('enable_gst', 'true', 'tax', 'Enable GST in estimates'),
('cgst_rate', '9', 'tax', 'CGST rate percentage'),
('sgst_rate', '9', 'tax', 'SGST rate percentage'),
('igst_rate', '18', 'tax', 'IGST rate percentage'),
('estimate_prefix', 'EST', 'estimate', 'Estimate number prefix'),
('estimate_validity', '30', 'estimate', 'Estimate validity in days'),
('estimate_terms', '1. All prices are subject to change without prior notice.\n2. This estimate is valid for 30 days from the date of issue.\n3. Payment terms: As per agreement.\n4. Delivery time: As per discussion.\n5. For any queries, please contact us.', 'estimate', 'Terms and conditions'),
('show_brand_logo', 'true', 'estimate', 'Show brand logos in estimates'),
('currency_symbol', '₹', 'general', 'Currency symbol'),
('date_format', 'DD/MM/YYYY', 'general', 'Date format')
ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value);

-- ========================================
-- 8. CUSTOMER TYPES TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS customer_types (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    default_discount DECIMAL(5,2) DEFAULT 0,
    status ENUM('active','inactive') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO customer_types (name, description, default_discount) VALUES
('Retail', 'Individual/retail customer', 0),
('Dealer', 'Paint dealer', 5),
('Contractor', 'Painting contractor', 10),
('Wholesale', 'Bulk buyer', 15)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- ========================================
-- 9. PACK SIZES TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS pack_sizes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    product_id INT NOT NULL,
    size DECIMAL(10,2) NOT NULL,
    unit VARCHAR(10) DEFAULT 'L',
    base_price DECIMAL(10,2) NOT NULL,
    is_active BOOLEAN DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    INDEX idx_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 10. LEADS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS leads (
    id INT PRIMARY KEY AUTO_INCREMENT,
    lead_number VARCHAR(50) UNIQUE,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    email VARCHAR(255),
    company VARCHAR(255),
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    pincode VARCHAR(10),

    -- Lead Details
    source ENUM('website','walk_in','referral','social_media','phone_call','advertisement','other') DEFAULT 'walk_in',
    project_type ENUM('interior','exterior','both','commercial','industrial') DEFAULT 'interior',
    property_type ENUM('house','apartment','villa','office','shop','factory','other') DEFAULT 'house',
    estimated_area_sqft DECIMAL(10,2),
    estimated_budget DECIMAL(12,2),
    preferred_brand VARCHAR(100),
    timeline VARCHAR(100),
    notes TEXT,

    -- Status & Assignment
    status ENUM('new','contacted','interested','quoted','negotiating','won','lost','inactive') DEFAULT 'new',
    priority ENUM('low','medium','high','urgent') DEFAULT 'medium',
    assigned_to INT NULL,
    branch_id INT NULL,

    -- Conversion
    customer_id INT NULL,
    converted_at DATETIME NULL,
    lost_reason TEXT NULL,

    -- Tracking
    last_contact_date DATE NULL,
    next_followup_date DATE NULL,
    total_followups INT DEFAULT 0,

    -- Metadata
    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,

    INDEX idx_status (status),
    INDEX idx_priority (priority),
    INDEX idx_assigned (assigned_to),
    INDEX idx_phone (phone),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 11. LEAD FOLLOWUPS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS lead_followups (
    id INT PRIMARY KEY AUTO_INCREMENT,
    lead_id INT NOT NULL,
    user_id INT NOT NULL,
    followup_type ENUM('call','visit','email','whatsapp','sms','meeting','other') NOT NULL,
    notes TEXT NOT NULL,
    outcome ENUM('interested','not_interested','callback','no_response','converted','other') DEFAULT 'callback',
    next_followup_date DATE NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_lead (lead_id),
    INDEX idx_date (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 12. SHOP HOURS CONFIG TABLE
-- CRITICAL: day_of_week must be TINYINT (0-6) not ENUM!
-- This enables DAYOFWEEK(date) - 1 matching in attendance queries
-- ========================================
CREATE TABLE IF NOT EXISTS shop_hours_config (
    id INT PRIMARY KEY AUTO_INCREMENT,
    branch_id INT NOT NULL,
    day_of_week TINYINT NOT NULL COMMENT '0=Sunday, 1=Monday, 2=Tuesday, 3=Wednesday, 4=Thursday, 5=Friday, 6=Saturday',
    is_working_day BOOLEAN DEFAULT TRUE,
    open_time TIME NOT NULL,
    close_time TIME NOT NULL,
    expected_hours DECIMAL(4,2) DEFAULT 8.00,
    late_threshold_minutes INT DEFAULT 15,
    early_leave_threshold_minutes INT DEFAULT 15,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_branch_day (branch_id, day_of_week),
    INDEX idx_branch (branch_id),
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default shop hours for main branch
-- Monday-Saturday (days 1-6): 9 AM - 6 PM
INSERT INTO shop_hours_config (branch_id, day_of_week, is_working_day, open_time, close_time, expected_hours, late_threshold_minutes)
VALUES
(1, 1, TRUE, '09:00:00', '18:00:00', 8.00, 15),  -- Monday
(1, 2, TRUE, '09:00:00', '18:00:00', 8.00, 15),  -- Tuesday
(1, 3, TRUE, '09:00:00', '18:00:00', 8.00, 15),  -- Wednesday
(1, 4, TRUE, '09:00:00', '18:00:00', 8.00, 15),  -- Thursday
(1, 5, TRUE, '09:00:00', '18:00:00', 8.00, 15),  -- Friday
(1, 6, TRUE, '09:00:00', '18:00:00', 8.00, 15),  -- Saturday
(1, 0, FALSE, '09:00:00', '18:00:00', 0, 15)     -- Sunday (closed)
ON DUPLICATE KEY UPDATE open_time = VALUES(open_time);

-- ========================================
-- 13. STAFF ATTENDANCE TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS staff_attendance (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    branch_id INT NOT NULL,
    date DATE NOT NULL,

    -- Clock In
    clock_in_time DATETIME NULL,
    clock_in_photo VARCHAR(500) NULL,
    clock_in_lat DECIMAL(10,8) NULL,
    clock_in_lng DECIMAL(11,8) NULL,
    clock_in_address TEXT NULL,

    -- Clock Out
    clock_out_time DATETIME NULL,
    clock_out_photo VARCHAR(500) NULL,
    clock_out_lat DECIMAL(10,8) NULL,
    clock_out_lng DECIMAL(11,8) NULL,
    clock_out_address TEXT NULL,

    -- Break
    break_start_time DATETIME NULL,
    break_end_time DATETIME NULL,
    break_duration_minutes INT DEFAULT 0,

    -- Working Summary
    total_working_minutes INT DEFAULT 0,
    expected_hours DECIMAL(4,2) DEFAULT 10.00,
    is_late BOOLEAN DEFAULT 0,
    is_early_checkout BOOLEAN DEFAULT 0,
    late_permission_id INT NULL,

    -- Status
    status ENUM('present','absent','half_day','on_leave','holiday','week_off') DEFAULT 'present',
    notes TEXT NULL,

    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (branch_id) REFERENCES branches(id),

    UNIQUE KEY unique_user_date (user_id, date),
    INDEX idx_date (date),
    INDEX idx_branch_date (branch_id, date),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 14. ATTENDANCE PHOTOS TABLE
-- ========================================
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

-- ========================================
-- 15. ATTENDANCE PERMISSIONS TABLE
-- ========================================
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

-- ========================================
-- 16. ESTIMATE REQUESTS TABLE
-- ========================================
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

    -- Status & Assignment
    status ENUM('new','contacted','quote_sent','accepted','rejected','converted','expired') DEFAULT 'new',
    priority ENUM('low','medium','high','urgent') DEFAULT 'medium',
    assigned_to_user_id INT NULL,
    assigned_at DATETIME NULL,
    estimate_id INT NULL,

    -- Tracking
    contacted_at DATETIME NULL,
    quote_sent_at DATETIME NULL,
    source VARCHAR(50) DEFAULT 'website',
    ip_address VARCHAR(45),
    user_agent TEXT,

    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (assigned_to_user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_status (status),
    INDEX idx_phone (phone),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 17. ESTIMATE REQUEST PHOTOS TABLE
-- ========================================
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

-- ========================================
-- 18. ESTIMATE REQUEST PRODUCTS TABLE
-- ========================================
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

-- ========================================
-- 19. ESTIMATE REQUEST ACTIVITY TABLE
-- ========================================
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

-- ========================================
-- 20. STAFF DAILY ACTIVITY TRACKER
-- ========================================
CREATE TABLE IF NOT EXISTS staff_activities (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    branch_id INT NULL,
    activity_date DATE NOT NULL,
    activity_time TIME NOT NULL,

    -- Activity Details
    activity_type ENUM('customer_visit','store_work','delivery','meeting','follow_up','admin_work','training','other') NOT NULL,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    customer_name VARCHAR(255),
    customer_phone VARCHAR(20),
    location TEXT,
    latitude DECIMAL(10,8) NULL,
    longitude DECIMAL(11,8) NULL,

    -- Duration
    start_time TIME NULL,
    end_time TIME NULL,
    duration_minutes INT NULL,

    -- Outcome
    outcome TEXT,
    status ENUM('planned','in_progress','completed','cancelled') DEFAULT 'completed',

    -- Photo/Document
    photo_url VARCHAR(500),
    document_url VARCHAR(500),

    -- Metadata
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,

    INDEX idx_user_date (user_id, activity_date),
    INDEX idx_branch_date (branch_id, activity_date),
    INDEX idx_type (activity_type),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 21. STAFF TASK MANAGEMENT (Admin Controlled)
-- ========================================
CREATE TABLE IF NOT EXISTS staff_tasks (
    id INT PRIMARY KEY AUTO_INCREMENT,
    task_number VARCHAR(50) UNIQUE,

    -- Task Details
    title VARCHAR(255) NOT NULL,
    description TEXT,
    task_type ENUM('daily','weekly','monthly','one_time','recurring') DEFAULT 'daily',
    priority ENUM('low','medium','high','urgent') DEFAULT 'medium',
    category VARCHAR(100),

    -- Assignment
    assigned_to INT NOT NULL,
    assigned_by INT NOT NULL,
    branch_id INT NULL,

    -- Schedule
    due_date DATE NOT NULL,
    due_time TIME NULL,
    start_date DATE NULL,
    estimated_hours DECIMAL(4,2) NULL,

    -- Status
    status ENUM('pending','in_progress','completed','overdue','cancelled','on_hold') DEFAULT 'pending',
    completion_percentage INT DEFAULT 0,
    completed_at DATETIME NULL,

    -- Tracking
    actual_hours DECIMAL(4,2) NULL,
    staff_notes TEXT,
    admin_notes TEXT,

    -- Rating (admin rates after completion)
    rating INT NULL CHECK (rating BETWEEN 1 AND 5),
    rating_notes TEXT,

    -- Metadata
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

-- ========================================
-- 22. TASK UPDATES/COMMENTS
-- ========================================
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

-- ========================================
-- 23. ADD customers.customer_type_id IF MISSING
-- ========================================
-- ALTER TABLE customers ADD COLUMN IF NOT EXISTS customer_type_id INT NULL AFTER gst_number;
-- ALTER TABLE customers ADD COLUMN IF NOT EXISTS branch_id INT NULL AFTER customer_type_id;
-- ALTER TABLE customers ADD COLUMN IF NOT EXISTS lead_id INT NULL AFTER branch_id;
-- ALTER TABLE customers ADD COLUMN IF NOT EXISTS whatsapp_opt_in BOOLEAN DEFAULT 0;
-- ALTER TABLE customers ADD COLUMN IF NOT EXISTS total_purchases DECIMAL(12,2) DEFAULT 0;
-- ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes TEXT NULL;

-- ========================================
-- 24. STAFF SALARY CONFIGURATION
-- ========================================

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

-- ========================================
-- 25. MONTHLY SALARY CALCULATIONS
-- ========================================

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

-- ========================================
-- 26. SALARY PAYMENTS
-- ========================================

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

-- ========================================
-- 27. SALARY ADJUSTMENTS
-- ========================================

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

-- ========================================
-- 28. STAFF LEAVE BALANCE
-- ========================================

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

-- ========================================
-- SUCCESS MESSAGE
-- ========================================
SELECT 'Complete database schema created successfully!' as message;
