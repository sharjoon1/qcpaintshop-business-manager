/**
 * Migration: Add location_off_at column to staff_attendance
 * Run: node migrations/migrate-location-off.js
 */
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function migrate() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME,
        port: parseInt(process.env.DB_PORT, 10) || 3306
    });

    console.log('Adding location_off_at column to staff_attendance...');

    const [col] = await pool.query(`SHOW COLUMNS FROM staff_attendance LIKE 'location_off_at'`);
    if (col.length === 0) {
        await pool.query(`ALTER TABLE staff_attendance ADD COLUMN location_off_at DATETIME NULL DEFAULT NULL`);
        console.log('Added location_off_at');
    } else {
        console.log('location_off_at already exists');
    }

    // Also ensure auto_clockout_type supports 'location_off' value
    // It's a VARCHAR so no enum change needed

    console.log('Done!');
    await pool.end();
    process.exit(0);
}

migrate().catch(err => { console.error('Migration failed:', err); process.exit(1); });
