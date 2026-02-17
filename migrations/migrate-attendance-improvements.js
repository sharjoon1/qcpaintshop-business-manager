/**
 * Attendance Module Improvements Migration
 *
 * Run: node migrations/migrate-attendance-improvements.js
 *
 * Changes:
 * 1. Fix attendance_permissions ENUM to include all used types
 * 2. Create outside_work_periods table
 * 3. Add outside_work_minutes, auto_clockout_type, auto_clockout_distance to staff_attendance
 */

const mysql = require('mysql2/promise');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

async function migrate() {
    let pool;
    try {
        pool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'business_manager',
            port: process.env.DB_PORT || 3306
        });

        console.log('Connected to database. Running attendance improvements migration...\n');

        // 1. Fix attendance_permissions ENUM to include all used types
        console.log('1. Updating attendance_permissions request_type ENUM...');
        try {
            await pool.query(`
                ALTER TABLE attendance_permissions
                MODIFY COLUMN request_type ENUM(
                    'late_arrival','early_checkout','early_leave','extended_break',
                    'leave','half_day','re_clockin','outside_work'
                ) NOT NULL
            `);
            console.log('   OK - request_type ENUM updated');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate')) {
                console.log('   SKIP - already updated');
            } else {
                console.error('   ERROR:', err.message);
            }
        }

        // 2. Create outside_work_periods table
        console.log('2. Creating outside_work_periods table...');
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS outside_work_periods (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    attendance_id INT NOT NULL,
                    user_id INT NOT NULL,
                    reason TEXT NOT NULL,
                    start_time DATETIME NOT NULL,
                    start_lat DECIMAL(10,8) NULL,
                    start_lng DECIMAL(11,8) NULL,
                    end_time DATETIME NULL,
                    end_lat DECIMAL(10,8) NULL,
                    end_lng DECIMAL(11,8) NULL,
                    duration_minutes INT NULL,
                    status ENUM('active','ended') DEFAULT 'active',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (attendance_id) REFERENCES staff_attendance(id) ON DELETE CASCADE,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                    INDEX idx_user_date (user_id, start_time),
                    INDEX idx_status (status)
                )
            `);
            console.log('   OK - outside_work_periods table created');
        } catch (err) {
            if (err.code === 'ER_TABLE_EXISTS_ERROR') {
                console.log('   SKIP - table already exists');
            } else {
                console.error('   ERROR:', err.message);
            }
        }

        // 3. Add columns to staff_attendance
        console.log('3. Adding outside_work_minutes column to staff_attendance...');
        try {
            await pool.query(`
                ALTER TABLE staff_attendance
                ADD COLUMN outside_work_minutes INT DEFAULT 0 AFTER break_duration_minutes
            `);
            console.log('   OK - outside_work_minutes added');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
                console.log('   SKIP - column already exists');
            } else {
                console.error('   ERROR:', err.message);
            }
        }

        console.log('4. Adding auto_clockout_type column to staff_attendance...');
        try {
            await pool.query(`
                ALTER TABLE staff_attendance
                ADD COLUMN auto_clockout_type ENUM('geo','max_hours','admin') NULL
            `);
            console.log('   OK - auto_clockout_type added');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
                console.log('   SKIP - column already exists');
            } else {
                console.error('   ERROR:', err.message);
            }
        }

        console.log('5. Adding auto_clockout_distance column to staff_attendance...');
        try {
            await pool.query(`
                ALTER TABLE staff_attendance
                ADD COLUMN auto_clockout_distance INT NULL
            `);
            console.log('   OK - auto_clockout_distance added');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
                console.log('   SKIP - column already exists');
            } else {
                console.error('   ERROR:', err.message);
            }
        }

        console.log('\nMigration complete!');

    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    } finally {
        if (pool) await pool.end();
    }
}

migrate();
