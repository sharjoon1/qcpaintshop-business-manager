/**
 * Prayer Time Tracking & Daily WhatsApp Reports Migration
 *
 * Run: node migrations/migrate-prayer-and-reports.js
 *
 * Changes:
 * 1. Create prayer_periods table (mirrors outside_work_periods)
 * 2. Add prayer_minutes column to staff_attendance
 * 3. Create attendance_daily_reports table
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

        console.log('Connected to database. Running prayer & reports migration...\n');

        // 1. Create prayer_periods table
        console.log('1. Creating prayer_periods table...');
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS prayer_periods (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    attendance_id INT NOT NULL,
                    user_id INT NOT NULL,
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
            console.log('   OK - prayer_periods table created');
        } catch (err) {
            if (err.code === 'ER_TABLE_EXISTS_ERROR') {
                console.log('   SKIP - table already exists');
            } else {
                console.error('   ERROR:', err.message);
            }
        }

        // 2. Add prayer_minutes column to staff_attendance
        console.log('2. Adding prayer_minutes column to staff_attendance...');
        try {
            await pool.query(`
                ALTER TABLE staff_attendance
                ADD COLUMN prayer_minutes INT DEFAULT 0 AFTER outside_work_minutes
            `);
            console.log('   OK - prayer_minutes added');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
                console.log('   SKIP - column already exists');
            } else {
                console.error('   ERROR:', err.message);
            }
        }

        // 3. Create attendance_daily_reports table
        console.log('3. Creating attendance_daily_reports table...');
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS attendance_daily_reports (
                    id INT PRIMARY KEY AUTO_INCREMENT,
                    user_id INT NOT NULL,
                    branch_id INT NULL,
                    report_date DATE NOT NULL,
                    sent_via ENUM('whatsapp','manual') DEFAULT 'whatsapp',
                    sent_by INT NULL,
                    sent_at DATETIME NOT NULL,
                    report_text TEXT NOT NULL,
                    delivery_status ENUM('sent','failed','pending') DEFAULT 'sent',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                    UNIQUE KEY unique_user_date (user_id, report_date)
                )
            `);
            console.log('   OK - attendance_daily_reports table created');
        } catch (err) {
            if (err.code === 'ER_TABLE_EXISTS_ERROR') {
                console.log('   SKIP - table already exists');
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
