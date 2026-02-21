/**
 * Overtime Tracking Migration
 *
 * Run: node migrations/migrate-overtime.js
 *
 * Changes:
 * 1. Add overtime_minutes column to staff_attendance
 * 2. Add overtime_started_at column to staff_attendance
 * 3. Add overtime_acknowledged column to staff_attendance
 * 4. Add overtime_acknowledged_at column to staff_attendance
 * 5. Update auto_clockout_type ENUM to include 'end_of_day'
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

        console.log('Connected to database. Running overtime migration...\n');

        // 1. Add overtime_minutes
        console.log('1. Adding overtime_minutes column...');
        try {
            await pool.query(`
                ALTER TABLE staff_attendance
                ADD COLUMN overtime_minutes INT DEFAULT 0 AFTER prayer_minutes
            `);
            console.log('   OK - overtime_minutes added');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
                console.log('   SKIP - column already exists');
            } else {
                console.error('   ERROR:', err.message);
            }
        }

        // 2. Add overtime_started_at
        console.log('2. Adding overtime_started_at column...');
        try {
            await pool.query(`
                ALTER TABLE staff_attendance
                ADD COLUMN overtime_started_at DATETIME NULL AFTER overtime_minutes
            `);
            console.log('   OK - overtime_started_at added');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
                console.log('   SKIP - column already exists');
            } else {
                console.error('   ERROR:', err.message);
            }
        }

        // 3. Add overtime_acknowledged
        console.log('3. Adding overtime_acknowledged column...');
        try {
            await pool.query(`
                ALTER TABLE staff_attendance
                ADD COLUMN overtime_acknowledged TINYINT(1) DEFAULT 0 AFTER overtime_started_at
            `);
            console.log('   OK - overtime_acknowledged added');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
                console.log('   SKIP - column already exists');
            } else {
                console.error('   ERROR:', err.message);
            }
        }

        // 4. Add overtime_acknowledged_at
        console.log('4. Adding overtime_acknowledged_at column...');
        try {
            await pool.query(`
                ALTER TABLE staff_attendance
                ADD COLUMN overtime_acknowledged_at DATETIME NULL AFTER overtime_acknowledged
            `);
            console.log('   OK - overtime_acknowledged_at added');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
                console.log('   SKIP - column already exists');
            } else {
                console.error('   ERROR:', err.message);
            }
        }

        // 5. Update auto_clockout_type ENUM to include 'end_of_day'
        console.log('5. Updating auto_clockout_type ENUM...');
        try {
            await pool.query(`
                ALTER TABLE staff_attendance
                MODIFY COLUMN auto_clockout_type ENUM('geo','max_hours','admin','end_of_day') NULL
            `);
            console.log('   OK - auto_clockout_type ENUM updated');
        } catch (err) {
            console.error('   ERROR:', err.message);
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
