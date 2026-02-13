/**
 * Migration: Create roles, permissions, and role_permissions tables
 * Run: node scripts/migrate-roles.js
 */

require('dotenv').config();
const mysql = require('mysql2/promise');

async function migrate() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: 5
    });

    try {
        console.log('Starting roles migration...\n');

        // 1. Create roles table
        await pool.query(`
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
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✅ roles table created');

        // 2. Create permissions table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS permissions (
                id INT PRIMARY KEY AUTO_INCREMENT,
                module VARCHAR(50) NOT NULL,
                action VARCHAR(50) NOT NULL,
                display_name VARCHAR(100),
                description TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_module_action (module, action),
                INDEX idx_module (module)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✅ permissions table created');

        // 3. Create role_permissions table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS role_permissions (
                id INT PRIMARY KEY AUTO_INCREMENT,
                role_id INT NOT NULL,
                permission_id INT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE,
                FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
                UNIQUE KEY unique_role_perm (role_id, permission_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✅ role_permissions table created');

        // 4. Insert default roles
        await pool.query(`
            INSERT INTO roles (name, display_name, description, user_type, is_system_role) VALUES
            ('admin', 'Administrator', 'Full system access', 'staff', TRUE),
            ('manager', 'Branch Manager', 'Branch-level management access', 'staff', TRUE),
            ('staff', 'Staff', 'Standard staff access', 'staff', TRUE),
            ('accountant', 'Accountant', 'Financial and salary management', 'staff', FALSE),
            ('customer', 'Customer', 'Registered customer', 'customer', TRUE),
            ('guest', 'Guest', 'Unregistered visitor', 'customer', TRUE),
            ('dealer', 'Dealer', 'Paint dealer/distributor', 'customer', FALSE),
            ('contractor', 'Contractor', 'Painting contractor', 'customer', FALSE)
            ON DUPLICATE KEY UPDATE display_name = VALUES(display_name)
        `);
        console.log('✅ Default roles inserted');

        // 5. Insert permissions
        await pool.query(`
            INSERT INTO permissions (module, action, display_name) VALUES
            -- Dashboard
            ('dashboard', 'view', 'View Dashboard'),
            -- Staff
            ('staff', 'view', 'View Staff'),
            ('staff', 'add', 'Add Staff'),
            ('staff', 'edit', 'Edit Staff'),
            ('staff', 'delete', 'Delete Staff'),
            -- Customers
            ('customers', 'view', 'View Customers'),
            ('customers', 'add', 'Add Customers'),
            ('customers', 'edit', 'Edit Customers'),
            ('customers', 'delete', 'Delete Customers'),
            -- Leads
            ('leads', 'view', 'View Leads'),
            ('leads', 'add', 'Add Leads'),
            ('leads', 'edit', 'Edit Leads'),
            ('leads', 'delete', 'Delete Leads'),
            -- Brands
            ('brands', 'view', 'View Brands'),
            ('brands', 'add', 'Add Brands'),
            ('brands', 'edit', 'Edit Brands'),
            ('brands', 'delete', 'Delete Brands'),
            -- Categories
            ('categories', 'view', 'View Categories'),
            ('categories', 'add', 'Add Categories'),
            ('categories', 'edit', 'Edit Categories'),
            ('categories', 'delete', 'Delete Categories'),
            -- Products
            ('products', 'view', 'View Products'),
            ('products', 'add', 'Add Products'),
            ('products', 'edit', 'Edit Products'),
            ('products', 'delete', 'Delete Products'),
            -- Estimates
            ('estimates', 'view', 'View Estimates'),
            ('estimates', 'add', 'Create Estimates'),
            ('estimates', 'edit', 'Edit Estimates'),
            ('estimates', 'delete', 'Delete Estimates'),
            ('estimates', 'approve', 'Approve Estimates'),
            -- Attendance
            ('attendance', 'view', 'View Attendance'),
            ('attendance', 'manage', 'Manage Attendance'),
            -- Salary
            ('salary', 'view', 'View Salary'),
            ('salary', 'manage', 'Manage Salary'),
            -- Activities
            ('activities', 'view', 'View Activities'),
            ('activities', 'add', 'Add Activities'),
            ('activities', 'edit', 'Edit Activities'),
            -- Tasks
            ('tasks', 'view', 'View Tasks'),
            ('tasks', 'add', 'Add Tasks'),
            ('tasks', 'edit', 'Edit Tasks'),
            ('tasks', 'delete', 'Delete Tasks'),
            -- Roles
            ('roles', 'view', 'View Roles'),
            ('roles', 'manage', 'Manage Roles'),
            -- Settings
            ('settings', 'view', 'View Settings'),
            ('settings', 'manage', 'Manage Settings'),
            -- Reports
            ('reports', 'view', 'View Reports'),
            ('reports', 'export', 'Export Reports')
            ON DUPLICATE KEY UPDATE display_name = VALUES(display_name)
        `);
        console.log('✅ Permissions inserted');

        // 6. Grant all permissions to admin role
        await pool.query(`
            INSERT IGNORE INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id FROM roles r CROSS JOIN permissions p WHERE r.name = 'admin'
        `);
        console.log('✅ Admin role: all permissions granted');

        // 7. Grant manager permissions
        await pool.query(`
            INSERT IGNORE INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
            WHERE r.name = 'manager'
            AND p.module IN ('dashboard','staff','customers','leads','brands','categories','products','estimates','attendance','salary','activities','tasks','reports')
            AND p.action IN ('view','add','edit','approve')
        `);
        console.log('✅ Manager role: permissions granted');

        // 8. Grant staff basic permissions
        await pool.query(`
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
            )
        `);
        console.log('✅ Staff role: permissions granted');

        // 9. Grant accountant permissions
        await pool.query(`
            INSERT IGNORE INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
            WHERE r.name = 'accountant' AND (
                (p.module = 'dashboard' AND p.action = 'view') OR
                (p.module = 'salary' AND p.action IN ('view','manage')) OR
                (p.module = 'attendance' AND p.action IN ('view','manage')) OR
                (p.module = 'reports' AND p.action IN ('view','export')) OR
                (p.module = 'staff' AND p.action = 'view')
            )
        `);
        console.log('✅ Accountant role: permissions granted');

        // Verify
        const [roleCount] = await pool.query('SELECT COUNT(*) as count FROM roles');
        const [permCount] = await pool.query('SELECT COUNT(*) as count FROM permissions');
        const [rpCount] = await pool.query('SELECT COUNT(*) as count FROM role_permissions');

        console.log(`\n📊 Migration complete:`);
        console.log(`   Roles: ${roleCount[0].count}`);
        console.log(`   Permissions: ${permCount[0].count}`);
        console.log(`   Role-Permission mappings: ${rpCount[0].count}`);

    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

migrate();
