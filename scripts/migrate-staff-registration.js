/**
 * Migration: Staff Self-Registration System
 * Creates staff_registrations table, updates OTP purposes, adds permissions
 * Run: node scripts/migrate-staff-registration.js
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

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
        console.log('Starting staff registration migration...\n');

        // 1. Create staff_registrations table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS staff_registrations (
                id INT PRIMARY KEY AUTO_INCREMENT,
                full_name VARCHAR(100) NOT NULL,
                email VARCHAR(255) NOT NULL,
                phone VARCHAR(15) NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                date_of_birth DATE NULL,
                door_no VARCHAR(50) NULL,
                street VARCHAR(100) NULL,
                city VARCHAR(100) NULL,
                state VARCHAR(100) DEFAULT 'Tamil Nadu',
                pincode VARCHAR(10) NULL,
                aadhar_number VARCHAR(12) NULL,
                aadhar_proof_url VARCHAR(500) NULL,
                emergency_contact_name VARCHAR(100) NULL,
                emergency_contact_phone VARCHAR(15) NULL,
                phone_verified BOOLEAN DEFAULT FALSE,
                otp_id INT NULL,
                status ENUM('pending','approved','rejected') DEFAULT 'pending',
                assigned_role VARCHAR(50) NULL,
                assigned_branch_id INT NULL,
                approved_by INT NULL,
                approved_at DATETIME NULL,
                rejected_by INT NULL,
                rejected_at DATETIME NULL,
                rejection_reason TEXT NULL,
                offer_letter_url VARCHAR(500) NULL,
                offer_letter_sent BOOLEAN DEFAULT FALSE,
                offer_letter_sent_at DATETIME NULL,
                joining_date DATE NULL,
                monthly_salary DECIMAL(10,2) NULL,
                transport_allowance DECIMAL(10,2) DEFAULT 0,
                food_allowance DECIMAL(10,2) DEFAULT 0,
                other_allowance DECIMAL(10,2) DEFAULT 0,
                created_user_id INT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_status (status),
                INDEX idx_phone (phone),
                INDEX idx_email (email),
                INDEX idx_created_at (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✅ staff_registrations table created');

        // 1b. Add offer_letter_content column if not exists
        try {
            const [olCols] = await pool.query(`
                SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'staff_registrations' AND COLUMN_NAME = 'offer_letter_content'
            `, [process.env.DB_NAME]);

            if (olCols.length === 0) {
                await pool.query('ALTER TABLE staff_registrations ADD COLUMN offer_letter_content TEXT NULL');
                console.log('✅ Added staff_registrations.offer_letter_content column');
            } else {
                console.log('ℹ️  staff_registrations.offer_letter_content already exists');
            }
        } catch(e) {
            console.log('⚠️  Could not add offer_letter_content column:', e.message);
        }

        // 2. Ensure otp_verifications table exists and supports 'Staff Registration'
        await pool.query(`
            CREATE TABLE IF NOT EXISTS otp_verifications (
                id INT PRIMARY KEY AUTO_INCREMENT,
                phone VARCHAR(15) NOT NULL,
                otp VARCHAR(10) NOT NULL,
                purpose VARCHAR(50) NOT NULL,
                verified BOOLEAN DEFAULT FALSE,
                expires_at DATETIME NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_phone_purpose (phone, purpose)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✅ otp_verifications table ensured');

        // If purpose is an ENUM, update it to include 'Staff Registration'
        const [columns] = await pool.query(`
            SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'otp_verifications' AND COLUMN_NAME = 'purpose'
        `, [process.env.DB_NAME]);

        if (columns.length > 0) {
            const currentType = columns[0].COLUMN_TYPE;
            if (currentType.startsWith('enum') && !currentType.includes('Staff Registration')) {
                const matches = currentType.match(/'([^']+)'/g);
                const values = matches ? matches.map(m => m.replace(/'/g, '')) : ['Registration', 'Login', 'Password Reset'];
                values.push('Staff Registration');
                const enumStr = values.map(v => `'${v}'`).join(',');
                await pool.query(`ALTER TABLE otp_verifications MODIFY COLUMN purpose ENUM(${enumStr}) NOT NULL`);
                console.log('✅ otp_verifications.purpose ENUM updated with "Staff Registration"');
            } else {
                console.log('ℹ️  otp_verifications.purpose column OK (VARCHAR or already includes Staff Registration)');
            }
        }

        // 2b. Add personal detail columns to users table (if not already present)
        const personalColumns = [
            { name: 'date_of_birth', def: 'DATE NULL' },
            { name: 'door_no', def: 'VARCHAR(50) NULL' },
            { name: 'street', def: 'VARCHAR(100) NULL' },
            { name: 'city', def: 'VARCHAR(100) NULL' },
            { name: 'state', def: "VARCHAR(100) DEFAULT 'Tamil Nadu'" },
            { name: 'pincode', def: 'VARCHAR(10) NULL' },
            { name: 'aadhar_number', def: 'VARCHAR(12) NULL' },
            { name: 'aadhar_proof_url', def: 'VARCHAR(500) NULL' },
            { name: 'emergency_contact_name', def: 'VARCHAR(100) NULL' },
            { name: 'emergency_contact_phone', def: 'VARCHAR(15) NULL' }
        ];

        for (const col of personalColumns) {
            const [existing] = await pool.query(`
                SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = ?
            `, [process.env.DB_NAME, col.name]);

            if (existing.length === 0) {
                await pool.query(`ALTER TABLE users ADD COLUMN ${col.name} ${col.def}`);
                console.log(`✅ Added users.${col.name} column`);
            } else {
                console.log(`ℹ️  users.${col.name} already exists`);
            }
        }

        // 2c. Ensure staff_salary_config table exists (needed for approval flow)
        await pool.query(`
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
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✅ staff_salary_config table ensured');

        // 3. Insert staff_registrations permissions
        await pool.query(`
            INSERT INTO permissions (module, action, display_name) VALUES
            ('staff_registrations', 'view', 'View Staff Registrations'),
            ('staff_registrations', 'approve', 'Approve/Reject Staff Registrations'),
            ('staff_registrations', 'manage', 'Manage Staff Registrations')
            ON DUPLICATE KEY UPDATE display_name = VALUES(display_name)
        `);
        console.log('✅ Staff registration permissions inserted');

        // 4. Grant permissions to admin role
        await pool.query(`
            INSERT IGNORE INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
            WHERE r.name = 'admin' AND p.module = 'staff_registrations'
        `);
        console.log('✅ Admin role: staff registration permissions granted');

        // 5. Grant view + approve to manager role
        await pool.query(`
            INSERT IGNORE INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
            WHERE r.name = 'manager' AND p.module = 'staff_registrations'
            AND p.action IN ('view', 'approve')
        `);
        console.log('✅ Manager role: staff registration permissions granted');

        // 6. Create upload directories
        const dirs = [
            'public/uploads/aadhar',
            'public/uploads/documents'
        ];
        dirs.forEach(dir => {
            const fullPath = path.join(__dirname, '..', dir);
            if (!fs.existsSync(fullPath)) {
                fs.mkdirSync(fullPath, { recursive: true });
                console.log(`✅ Created directory: ${dir}`);
            } else {
                console.log(`ℹ️  Directory already exists: ${dir}`);
            }
        });

        // Verify
        const [regCount] = await pool.query(`
            SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'staff_registrations'
        `, [process.env.DB_NAME]);

        const [permCount] = await pool.query(
            "SELECT COUNT(*) as count FROM permissions WHERE module = 'staff_registrations'"
        );

        console.log(`\n📊 Migration complete:`);
        console.log(`   staff_registrations table: ${regCount[0].count > 0 ? 'EXISTS' : 'MISSING'}`);
        console.log(`   Staff registration permissions: ${permCount[0].count}`);

    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

migrate();
