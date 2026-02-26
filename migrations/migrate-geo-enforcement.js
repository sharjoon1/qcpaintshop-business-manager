/**
 * Migration: Add server-side geo-fence enforcement columns to staff_attendance
 * Run: node migrations/migrate-geo-enforcement.js
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

    console.log('Adding geo-fence enforcement columns to staff_attendance...');

    // geo_warning_started_at — set when first 300m+ violation detected
    const [col1] = await pool.query(`SHOW COLUMNS FROM staff_attendance LIKE 'geo_warning_started_at'`);
    if (col1.length === 0) {
        await pool.query(`ALTER TABLE staff_attendance ADD COLUMN geo_warning_started_at DATETIME NULL DEFAULT NULL`);
        console.log('✓ Added geo_warning_started_at');
    } else {
        console.log('- geo_warning_started_at already exists');
    }

    // last_geo_check_at — updated on each geofence-check call
    const [col2] = await pool.query(`SHOW COLUMNS FROM staff_attendance LIKE 'last_geo_check_at'`);
    if (col2.length === 0) {
        await pool.query(`ALTER TABLE staff_attendance ADD COLUMN last_geo_check_at DATETIME NULL DEFAULT NULL`);
        console.log('✓ Added last_geo_check_at');
    } else {
        console.log('- last_geo_check_at already exists');
    }

    // last_geo_distance — last known distance from branch (meters)
    const [col3] = await pool.query(`SHOW COLUMNS FROM staff_attendance LIKE 'last_geo_distance'`);
    if (col3.length === 0) {
        await pool.query(`ALTER TABLE staff_attendance ADD COLUMN last_geo_distance INT NULL DEFAULT NULL`);
        console.log('✓ Added last_geo_distance');
    } else {
        console.log('- last_geo_distance already exists');
    }

    console.log('Done!');
    await pool.end();
    process.exit(0);
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
