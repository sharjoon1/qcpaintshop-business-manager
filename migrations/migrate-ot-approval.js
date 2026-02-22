/**
 * OT Approval System Migration
 *
 * Run: node migrations/migrate-ot-approval.js
 *
 * Changes:
 * 1. Create overtime_requests table
 * 2. Add ot_request_id, ot_request_status, ot_approved_minutes, ot_prompt_shown_at to staff_attendance
 * 3. Update auto_clockout_type ENUM to include 'ot_timeout'
 * 4. Add ot_auto_timeout_minutes, ot_approval_required to shop_hours_config
 * 5. Backfill historical data (overtime_acknowledged=1 → ot_approved)
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

        console.log('Connected to database. Running OT Approval migration...\n');

        // 1. Create overtime_requests table
        console.log('1. Creating overtime_requests table...');
        try {
            await pool.query(`
                CREATE TABLE overtime_requests (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    user_id INT NOT NULL,
                    attendance_id INT NOT NULL,
                    branch_id INT NOT NULL,
                    request_date DATE NOT NULL,
                    requested_at DATETIME NOT NULL,
                    expected_minutes INT NOT NULL,
                    working_minutes_at_request INT NOT NULL,
                    status ENUM('pending','approved','rejected','auto_clockout','expired') DEFAULT 'pending',
                    reviewed_by INT NULL,
                    reviewed_at DATETIME NULL,
                    review_notes TEXT NULL,
                    approved_minutes INT DEFAULT 0,
                    reason VARCHAR(500) NULL,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    INDEX idx_user_date (user_id, request_date),
                    INDEX idx_status (status),
                    INDEX idx_attendance (attendance_id)
                )
            `);
            console.log('   OK - overtime_requests table created');
        } catch (err) {
            if (err.code === 'ER_TABLE_EXISTS_ERROR' || err.message.includes('already exists')) {
                console.log('   SKIP - table already exists');
            } else {
                throw err;
            }
        }

        // 2. Add ot_request_id to staff_attendance
        console.log('2. Adding ot_request_id column...');
        try {
            await pool.query(`
                ALTER TABLE staff_attendance
                ADD COLUMN ot_request_id INT NULL AFTER overtime_acknowledged_at
            `);
            console.log('   OK - ot_request_id added');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
                console.log('   SKIP - column already exists');
            } else {
                throw err;
            }
        }

        // 3. Add ot_request_status to staff_attendance
        console.log('3. Adding ot_request_status column...');
        try {
            await pool.query(`
                ALTER TABLE staff_attendance
                ADD COLUMN ot_request_status ENUM('none','pending','approved','rejected') DEFAULT 'none' AFTER ot_request_id
            `);
            console.log('   OK - ot_request_status added');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
                console.log('   SKIP - column already exists');
            } else {
                throw err;
            }
        }

        // 4. Add ot_approved_minutes to staff_attendance
        console.log('4. Adding ot_approved_minutes column...');
        try {
            await pool.query(`
                ALTER TABLE staff_attendance
                ADD COLUMN ot_approved_minutes INT DEFAULT 0 AFTER ot_request_status
            `);
            console.log('   OK - ot_approved_minutes added');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
                console.log('   SKIP - column already exists');
            } else {
                throw err;
            }
        }

        // 5. Add ot_prompt_shown_at to staff_attendance
        console.log('5. Adding ot_prompt_shown_at column...');
        try {
            await pool.query(`
                ALTER TABLE staff_attendance
                ADD COLUMN ot_prompt_shown_at DATETIME NULL AFTER ot_approved_minutes
            `);
            console.log('   OK - ot_prompt_shown_at added');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
                console.log('   SKIP - column already exists');
            } else {
                throw err;
            }
        }

        // 6. Update auto_clockout_type ENUM to include 'ot_timeout'
        console.log('6. Updating auto_clockout_type ENUM...');
        try {
            await pool.query(`
                ALTER TABLE staff_attendance
                MODIFY COLUMN auto_clockout_type ENUM('geo','max_hours','admin','end_of_day','ot_timeout') NULL
            `);
            console.log('   OK - auto_clockout_type ENUM updated');
        } catch (err) {
            console.log('   WARN -', err.message);
        }

        // 7. Add ot_auto_timeout_minutes to shop_hours_config
        console.log('7. Adding ot_auto_timeout_minutes to shop_hours_config...');
        try {
            await pool.query(`
                ALTER TABLE shop_hours_config
                ADD COLUMN ot_auto_timeout_minutes INT DEFAULT 15
            `);
            console.log('   OK - ot_auto_timeout_minutes added');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
                console.log('   SKIP - column already exists');
            } else {
                throw err;
            }
        }

        // 8. Add ot_approval_required to shop_hours_config
        console.log('8. Adding ot_approval_required to shop_hours_config...');
        try {
            await pool.query(`
                ALTER TABLE shop_hours_config
                ADD COLUMN ot_approval_required TINYINT(1) DEFAULT 1
            `);
            console.log('   OK - ot_approval_required added');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
                console.log('   SKIP - column already exists');
            } else {
                throw err;
            }
        }

        // 9. Backfill historical data: overtime_acknowledged=1 → approved
        console.log('9. Backfilling historical overtime data...');
        try {
            const [result] = await pool.query(`
                UPDATE staff_attendance
                SET ot_request_status = 'approved',
                    ot_approved_minutes = overtime_minutes
                WHERE overtime_acknowledged = 1
                  AND overtime_minutes > 0
                  AND ot_request_status = 'none'
            `);
            console.log(`   OK - ${result.affectedRows} records backfilled`);
        } catch (err) {
            console.log('   WARN -', err.message);
        }

        console.log('\n✅ OT Approval migration completed successfully!');

    } catch (error) {
        console.error('\n❌ Migration failed:', error.message);
        process.exit(1);
    } finally {
        if (pool) await pool.end();
    }
}

migrate();
