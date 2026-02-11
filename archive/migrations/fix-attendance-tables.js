const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'qc_admin',
    password: process.env.DB_PASSWORD || 'QC@dm1n2026!Secure',
    database: process.env.DB_NAME || 'qc_business_manager',
    multipleStatements: true
};

async function fixAttendanceTables() {
    let connection;

    try {
        console.log('🔌 Connecting to database...');
        connection = await mysql.createConnection(dbConfig);
        console.log('✅ Connected to database\n');

        // Create staff_attendance table
        console.log('📊 Creating staff_attendance table...');
        await connection.query(`
            CREATE TABLE IF NOT EXISTS staff_attendance (
                id INT PRIMARY KEY AUTO_INCREMENT,
                user_id INT NOT NULL,
                branch_id INT NOT NULL,
                date DATE NOT NULL,
                clock_in_time DATETIME,
                clock_out_time DATETIME,
                clock_in_photo VARCHAR(255),
                clock_out_photo VARCHAR(255),
                clock_in_lat DECIMAL(10, 8),
                clock_in_lng DECIMAL(11, 8),
                clock_out_lat DECIMAL(10, 8),
                clock_out_lng DECIMAL(11, 8),
                clock_in_address TEXT,
                clock_out_address TEXT,
                is_late BOOLEAN DEFAULT FALSE,
                late_permission_id INT,
                expected_hours DECIMAL(4, 2) DEFAULT 8.00,
                actual_hours DECIMAL(4, 2),
                status ENUM('present', 'absent', 'half_day', 'leave') DEFAULT 'present',
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_user_date (user_id, date),
                INDEX idx_branch (branch_id),
                INDEX idx_date (date),
                UNIQUE KEY unique_user_date (user_id, date)
            )
        `);
        console.log('  ✓ staff_attendance table created');

        // Create attendance_photos table
        console.log('\n📸 Creating attendance_photos table...');
        await connection.query(`
            CREATE TABLE IF NOT EXISTS attendance_photos (
                id INT PRIMARY KEY AUTO_INCREMENT,
                attendance_id INT NOT NULL,
                user_id INT NOT NULL,
                photo_type ENUM('clock_in', 'clock_out') NOT NULL,
                file_path VARCHAR(255) NOT NULL,
                file_size INT,
                latitude DECIMAL(10, 8),
                longitude DECIMAL(11, 8),
                address TEXT,
                captured_at DATETIME NOT NULL,
                delete_after DATE,
                deleted BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_attendance (attendance_id),
                INDEX idx_user (user_id),
                INDEX idx_delete (delete_after, deleted)
            )
        `);
        console.log('  ✓ attendance_photos table created');

        // Create attendance_permissions table
        console.log('\n📝 Creating attendance_permissions table...');
        await connection.query(`
            CREATE TABLE IF NOT EXISTS attendance_permissions (
                id INT PRIMARY KEY AUTO_INCREMENT,
                user_id INT NOT NULL,
                attendance_id INT,
                request_type ENUM('late_arrival', 'early_leave', 'leave', 'half_day') NOT NULL,
                request_date DATE NOT NULL,
                request_time TIME,
                duration_minutes INT,
                reason TEXT NOT NULL,
                status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
                requested_by INT NOT NULL,
                approved_by INT,
                approved_at DATETIME,
                rejection_reason TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_user (user_id),
                INDEX idx_status (status),
                INDEX idx_date (request_date)
            )
        `);
        console.log('  ✓ attendance_permissions table created');

        // Create shop_hours_config table
        console.log('\n⏰ Creating shop_hours_config table...');
        await connection.query(`
            CREATE TABLE IF NOT EXISTS shop_hours_config (
                id INT PRIMARY KEY AUTO_INCREMENT,
                branch_id INT NOT NULL,
                day_of_week TINYINT NOT NULL COMMENT '0=Sunday, 6=Saturday',
                is_working_day BOOLEAN DEFAULT TRUE,
                open_time TIME NOT NULL,
                close_time TIME NOT NULL,
                expected_hours DECIMAL(4, 2) DEFAULT 8.00,
                late_threshold_minutes INT DEFAULT 15,
                early_leave_threshold_minutes INT DEFAULT 15,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY unique_branch_day (branch_id, day_of_week),
                INDEX idx_branch (branch_id)
            )
        `);
        console.log('  ✓ shop_hours_config table created');

        // Check if default shop hours exist
        const [existingHours] = await connection.query(
            'SELECT COUNT(*) as count FROM shop_hours_config'
        );

        if (existingHours[0].count === 0) {
            console.log('\n⚙️ Inserting default shop hours...');

            // Get first branch ID
            const [branches] = await connection.query('SELECT id FROM branches LIMIT 1');
            const branchId = branches.length > 0 ? branches[0].id : 1;

            // Insert default hours (Mon-Sat, 9 AM - 6 PM)
            for (let day = 1; day <= 6; day++) {
                await connection.query(
                    `INSERT INTO shop_hours_config
                     (branch_id, day_of_week, is_working_day, open_time, close_time, expected_hours, late_threshold_minutes)
                     VALUES (?, ?, TRUE, '09:00:00', '18:00:00', 8.00, 15)`,
                    [branchId, day]
                );
            }

            // Sunday closed
            await connection.query(
                `INSERT INTO shop_hours_config
                 (branch_id, day_of_week, is_working_day, open_time, close_time, expected_hours)
                 VALUES (?, 0, FALSE, '09:00:00', '18:00:00', 0)`,
                [branchId]
            );

            console.log(`  ✓ Inserted default shop hours for branch ${branchId}`);
        } else {
            console.log('\n⚙️ Shop hours already configured');
        }

        // Create uploads directory
        console.log('\n📁 Creating uploads directory...');
        const fs = require('fs');
        const path = require('path');

        const uploadsDir = path.join(__dirname, 'uploads', 'attendance');
        if (!fs.existsSync(uploadsDir)) {
            fs.mkdirSync(uploadsDir, { recursive: true });
            console.log('  ✓ Created: ' + uploadsDir);
        } else {
            console.log('  ✓ Already exists: ' + uploadsDir);
        }

        console.log('\n🎉 All attendance tables fixed successfully!');
        console.log('\n📋 Next steps:');
        console.log('  1. Restart the server: npm start');
        console.log('  2. Try clocking in again');
        console.log('  3. If it still fails, check server logs for detailed error');

    } catch (error) {
        console.error('❌ Error fixing tables:', error.message);
        console.error(error);
        process.exit(1);
    } finally {
        if (connection) {
            await connection.end();
            console.log('\n🔌 Database connection closed');
        }
    }
}

// Run the fix
fixAttendanceTables();
