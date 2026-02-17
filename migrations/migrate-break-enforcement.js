/**
 * Break Enforcement Migration
 *
 * Run: node migrations/migrate-break-enforcement.js
 *
 * Changes:
 * 1. Add break_allowance_minutes, break_warning_minutes to shop_hours_config
 * 2. Add break_allowance_minutes, break_warning_sent, excess_break_minutes,
 *    break_exceeded, effective_working_minutes to staff_attendance
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

        console.log('Connected to database. Running break enforcement migration...\n');

        // 1. Add break policy columns to shop_hours_config
        console.log('1. Adding break_allowance_minutes to shop_hours_config...');
        try {
            await pool.query(`
                ALTER TABLE shop_hours_config
                ADD COLUMN break_allowance_minutes INT DEFAULT 120
            `);
            console.log('   OK - break_allowance_minutes added');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate')) {
                console.log('   SKIP - break_allowance_minutes already exists');
            } else {
                console.error('   ERROR:', err.message);
            }
        }

        console.log('2. Adding break_warning_minutes to shop_hours_config...');
        try {
            await pool.query(`
                ALTER TABLE shop_hours_config
                ADD COLUMN break_warning_minutes INT DEFAULT 90
            `);
            console.log('   OK - break_warning_minutes added');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate')) {
                console.log('   SKIP - break_warning_minutes already exists');
            } else {
                console.error('   ERROR:', err.message);
            }
        }

        // 2. Add break enforcement columns to staff_attendance
        console.log('3. Adding break_allowance_minutes to staff_attendance...');
        try {
            await pool.query(`
                ALTER TABLE staff_attendance
                ADD COLUMN break_allowance_minutes INT DEFAULT 120
            `);
            console.log('   OK - break_allowance_minutes added');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate')) {
                console.log('   SKIP - break_allowance_minutes already exists');
            } else {
                console.error('   ERROR:', err.message);
            }
        }

        console.log('4. Adding break_warning_sent to staff_attendance...');
        try {
            await pool.query(`
                ALTER TABLE staff_attendance
                ADD COLUMN break_warning_sent TINYINT(1) DEFAULT 0
            `);
            console.log('   OK - break_warning_sent added');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate')) {
                console.log('   SKIP - break_warning_sent already exists');
            } else {
                console.error('   ERROR:', err.message);
            }
        }

        console.log('5. Adding excess_break_minutes to staff_attendance...');
        try {
            await pool.query(`
                ALTER TABLE staff_attendance
                ADD COLUMN excess_break_minutes INT DEFAULT 0
            `);
            console.log('   OK - excess_break_minutes added');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate')) {
                console.log('   SKIP - excess_break_minutes already exists');
            } else {
                console.error('   ERROR:', err.message);
            }
        }

        console.log('6. Adding break_exceeded to staff_attendance...');
        try {
            await pool.query(`
                ALTER TABLE staff_attendance
                ADD COLUMN break_exceeded TINYINT(1) DEFAULT 0
            `);
            console.log('   OK - break_exceeded added');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate')) {
                console.log('   SKIP - break_exceeded already exists');
            } else {
                console.error('   ERROR:', err.message);
            }
        }

        console.log('7. Adding effective_working_minutes to staff_attendance...');
        try {
            await pool.query(`
                ALTER TABLE staff_attendance
                ADD COLUMN effective_working_minutes INT DEFAULT NULL
            `);
            console.log('   OK - effective_working_minutes added');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate')) {
                console.log('   SKIP - effective_working_minutes already exists');
            } else {
                console.error('   ERROR:', err.message);
            }
        }

        console.log('\n--- Migration complete! ---');
        console.log('New shop_hours_config columns: break_allowance_minutes (120), break_warning_minutes (90)');
        console.log('New staff_attendance columns: break_allowance_minutes, break_warning_sent, excess_break_minutes, break_exceeded, effective_working_minutes');

    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        if (pool) await pool.end();
        process.exit(0);
    }
}

migrate();
