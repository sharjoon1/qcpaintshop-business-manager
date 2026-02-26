/**
 * Migration: Add 'cancelled' status to stock_check_assignments
 * Run: node migrations/migrate-stock-check-cancel.js
 */
const pool = require('../config/database');

async function migrate() {
    console.log('Adding cancelled status to stock_check_assignments...');

    await pool.query(`
        ALTER TABLE stock_check_assignments
        MODIFY COLUMN status ENUM('pending','submitted','reviewed','adjusted','cancelled') DEFAULT 'pending'
    `);
    console.log('✓ Added cancelled to status ENUM');

    // Add cancelled_by and cancelled_at columns
    const [cols] = await pool.query(`SHOW COLUMNS FROM stock_check_assignments LIKE 'cancelled_by'`);
    if (cols.length === 0) {
        await pool.query(`
            ALTER TABLE stock_check_assignments
            ADD COLUMN cancelled_by INT NULL DEFAULT NULL,
            ADD COLUMN cancelled_at DATETIME NULL DEFAULT NULL,
            ADD COLUMN cancel_reason VARCHAR(500) NULL DEFAULT NULL
        `);
        console.log('✓ Added cancelled_by, cancelled_at, cancel_reason columns');
    } else {
        console.log('- cancelled columns already exist');
    }

    console.log('Done!');
    process.exit(0);
}

migrate().catch(err => { console.error(err); process.exit(1); });
