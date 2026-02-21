/**
 * Stock Check Enhancements Migration
 *
 * Run: node migrations/migrate-stock-check-enhancements.js
 *
 * Changes:
 * 1. Add request_type column to stock_check_assignments (admin_assigned / self_requested)
 * 2. Add requested_reason column to stock_check_assignments
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

        console.log('Connected. Running stock check enhancements migration...\n');

        // 1. Add request_type column
        console.log('1. Adding request_type column...');
        try {
            await pool.query(`
                ALTER TABLE stock_check_assignments
                ADD COLUMN request_type ENUM('admin_assigned','self_requested') DEFAULT 'admin_assigned' AFTER status
            `);
            console.log('   OK - request_type added');
        } catch (err) {
            if (err.code === 'ER_DUP_FIELDNAME' || err.message.includes('Duplicate column')) {
                console.log('   SKIP - column already exists');
            } else {
                console.error('   ERROR:', err.message);
            }
        }

        // 2. Add requested_reason column
        console.log('2. Adding requested_reason column...');
        try {
            await pool.query(`
                ALTER TABLE stock_check_assignments
                ADD COLUMN requested_reason TEXT NULL AFTER notes
            `);
            console.log('   OK - requested_reason added');
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
