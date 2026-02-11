-- ========================================
-- WORKING DATABASE SCHEMA
-- Quality Colours Business Manager
-- Date: 2026-02-10
-- This reflects the ACTUAL tables currently in the database
-- Based on database analysis: 17 active tables
-- ========================================

USE qc_business_manager;

-- ========================================
-- 1. USERS TABLE
-- ========================================
-- Note: Assuming standard structure based on authentication system
CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(100) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE,
    phone VARCHAR(20) UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    role VARCHAR(50) DEFAULT 'staff',
    status ENUM('active','inactive','suspended') DEFAULT 'active',
    branch_id INT NULL,
    profile_image_url VARCHAR(500),
    is_active BOOLEAN DEFAULT TRUE,
    email_verified BOOLEAN DEFAULT FALSE,
    phone_verified BOOLEAN DEFAULT FALSE,
    last_login DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_username (username),
    INDEX idx_email (email),
    INDEX idx_phone (phone),
    INDEX idx_role (role),
    INDEX idx_branch (branch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 2. USER SESSIONS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS user_sessions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    token VARCHAR(255) UNIQUE,
    session_token VARCHAR(255) UNIQUE,
    ip_address VARCHAR(45),
    user_agent TEXT,
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_token (token),
    INDEX idx_session_token (session_token),
    INDEX idx_user (user_id),
    INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 3. BRANCHES TABLE
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
    manager_user_id INT NULL,
    latitude DECIMAL(10,8) NULL,
    longitude DECIMAL(11,8) NULL,
    geo_fence_radius INT DEFAULT 500 COMMENT 'Radius in meters',
    geo_fence_radius_meters INT DEFAULT 100,
    is_active BOOLEAN DEFAULT TRUE,
    opening_time TIME DEFAULT '09:00:00',
    closing_time TIME DEFAULT '18:00:00',
    open_time TIME DEFAULT '08:30:00',
    close_time TIME DEFAULT '20:30:00',
    status ENUM('active','inactive') DEFAULT 'active',
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
-- 4. SETTINGS TABLE
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
-- 5. BRANDS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS brands (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    logo_url VARCHAR(500),
    description TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    status ENUM('active','inactive') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_name (name),
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 6. CATEGORIES TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS categories (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    parent_id INT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    status ENUM('active','inactive') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (parent_id) REFERENCES categories(id) ON DELETE SET NULL,
    INDEX idx_name (name),
    INDEX idx_parent (parent_id),
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 7. PRODUCTS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS products (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    sku VARCHAR(100) UNIQUE,
    brand_id INT NULL,
    category_id INT NULL,
    description TEXT,
    product_type ENUM('unit_wise','area_wise') DEFAULT 'unit_wise',
    base_price DECIMAL(10,2) DEFAULT 0,
    gst_percentage DECIMAL(5,2) DEFAULT 18.00,
    available_sizes TEXT NULL,
    area_coverage DECIMAL(10,2) NULL COMMENT 'Sq ft coverage per liter/kg for area_wise products',
    coverage_per_liter DECIMAL(10,2) COMMENT 'Square feet coverage per liter (legacy)',
    unit VARCHAR(20) DEFAULT 'L',
    stock_quantity DECIMAL(10,2) DEFAULT 0,
    min_stock_level DECIMAL(10,2) DEFAULT 0,
    is_active BOOLEAN DEFAULT TRUE,
    status ENUM('active','inactive') DEFAULT 'active',
    image_url VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
    INDEX idx_sku (sku),
    INDEX idx_name (name),
    INDEX idx_brand (brand_id),
    INDEX idx_category (category_id),
    INDEX idx_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 8. CUSTOMERS TABLE
-- ========================================
-- ========================================
-- 7b. CUSTOMER TYPES TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS customer_types (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    default_discount DECIMAL(5,2) DEFAULT 0,
    price_markup DECIMAL(5,2) DEFAULT 0,
    status ENUM('active','inactive') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Default customer types
INSERT INTO customer_types (name, description, default_discount, price_markup) VALUES
('Retail', 'Individual/retail customer', 0, 0),
('Dealer', 'Paint dealer', 5, 0),
('Contractor', 'Painting contractor', 10, 0),
('Wholesale', 'Bulk buyer', 15, 0)
ON DUPLICATE KEY UPDATE name = VALUES(name);

-- ========================================
-- 7c. PACK SIZES TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS pack_sizes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    product_id INT NOT NULL,
    size DECIMAL(10,2) NOT NULL,
    unit VARCHAR(10) DEFAULT 'L',
    base_price DECIMAL(10,2) NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    INDEX idx_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customers (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    phone VARCHAR(20),
    email VARCHAR(255),
    company VARCHAR(255),
    gst_number VARCHAR(50),
    address TEXT,
    city VARCHAR(100),
    state VARCHAR(100),
    pincode VARCHAR(20),
    customer_type VARCHAR(50) DEFAULT 'retail',
    customer_type_id INT NULL,
    branch_id INT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    notes TEXT,
    status ENUM('pending','approved','inactive') DEFAULT 'approved',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
    FOREIGN KEY (customer_type_id) REFERENCES customer_types(id) ON DELETE SET NULL,
    INDEX idx_phone (phone),
    INDEX idx_email (email),
    INDEX idx_name (name),
    INDEX idx_branch (branch_id),
    INDEX idx_type (customer_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 9. ESTIMATES TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS estimates (
    id INT PRIMARY KEY AUTO_INCREMENT,
    estimate_number VARCHAR(50) UNIQUE NOT NULL,
    customer_id INT NOT NULL,
    branch_id INT NULL,
    created_by INT NOT NULL,
    estimate_date DATE NOT NULL,
    valid_until DATE,
    status ENUM('draft','sent','accepted','rejected','expired') DEFAULT 'draft',
    subtotal DECIMAL(12,2) DEFAULT 0,
    discount_percent DECIMAL(5,2) DEFAULT 0,
    discount_amount DECIMAL(12,2) DEFAULT 0,
    tax_amount DECIMAL(12,2) DEFAULT 0,
    total_amount DECIMAL(12,2) DEFAULT 0,
    notes TEXT,
    terms_conditions TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT,
    FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES users(id),
    INDEX idx_estimate_number (estimate_number),
    INDEX idx_customer (customer_id),
    INDEX idx_status (status),
    INDEX idx_date (estimate_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 10. ESTIMATE ITEMS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS estimate_items (
    id INT PRIMARY KEY AUTO_INCREMENT,
    estimate_id INT NOT NULL,
    product_id INT NULL,
    product_name VARCHAR(255) NOT NULL,
    description TEXT,
    quantity DECIMAL(10,2) NOT NULL,
    unit VARCHAR(20) DEFAULT 'L',
    unit_price DECIMAL(10,2) NOT NULL,
    total_price DECIMAL(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (estimate_id) REFERENCES estimates(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
    INDEX idx_estimate (estimate_id),
    INDEX idx_product (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 11. ESTIMATE SETTINGS TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS estimate_settings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    setting_key VARCHAR(100) UNIQUE NOT NULL,
    setting_value TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 12. ESTIMATE STATUS HISTORY TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS estimate_status_history (
    id INT PRIMARY KEY AUTO_INCREMENT,
    estimate_id INT NOT NULL,
    old_status VARCHAR(50),
    new_status VARCHAR(50) NOT NULL,
    changed_by INT NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (estimate_id) REFERENCES estimates(id) ON DELETE CASCADE,
    FOREIGN KEY (changed_by) REFERENCES users(id),
    INDEX idx_estimate (estimate_id),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 13. SHOP HOURS CONFIG TABLE
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
-- 14. STAFF ATTENDANCE TABLE
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
    expected_hours DECIMAL(4,2) DEFAULT 8.00,
    is_late BOOLEAN DEFAULT FALSE,
    is_early_checkout BOOLEAN DEFAULT FALSE,
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
-- 15. ATTENDANCE PHOTOS TABLE
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
    is_deleted BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (attendance_id) REFERENCES staff_attendance(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_attendance (attendance_id),
    INDEX idx_user (user_id),
    INDEX idx_delete_after (delete_after)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- 16. ATTENDANCE PERMISSIONS TABLE
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
-- 17. AUDIT LOG TABLE
-- ========================================
CREATE TABLE IF NOT EXISTS audit_log (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NULL,
    table_name VARCHAR(100) NOT NULL,
    record_id INT NOT NULL,
    action ENUM('INSERT','UPDATE','DELETE') NOT NULL,
    old_values JSON NULL,
    new_values JSON NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX idx_user (user_id),
    INDEX idx_table (table_name),
    INDEX idx_action (action),
    INDEX idx_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- SUCCESS MESSAGE
-- ========================================
SELECT 'Working database schema created successfully!' as message,
       '17 tables total' as info,
       'All core features: Users, Products, Estimates, Attendance' as modules;
