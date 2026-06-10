/**
 * Migration: Add lead_type column to leads table
 * Tracks what a lead was converted to: customer, painter, or engineer
 * Normalized to exports.up(pool) (D2, 2026-06-11) — requiring this file no longer runs it.
 */

require('dotenv').config();

exports.up = async function up(pool) {
    console.log('Adding lead_type column to leads table...');

    // Check if column already exists
    const [cols] = await pool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'leads' AND COLUMN_NAME = 'lead_type'`,
        [process.env.DB_NAME]
    );

    if (cols.length === 0) {
        await pool.query(`
            ALTER TABLE leads
            ADD COLUMN lead_type ENUM('customer', 'painter', 'engineer') DEFAULT NULL
            AFTER customer_id
        `);
        console.log('Added lead_type column');
    } else {
        console.log('lead_type column already exists');
    }

    console.log('Migration complete!');
};

// Direct-run support (legacy usage: node migrations/migrate-lead-type.js)
if (require.main === module) {
    (async () => {
        require('dotenv').config();
        const mysql = require('mysql2/promise');
        const pool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'business_manager',
            port: parseInt(process.env.DB_PORT, 10) || 3306
        });
        try {
            await exports.up(pool);
            console.log('Done.');
            process.exit(0);
        } catch (err) {
            console.error('Migration failed:', err.message);
            process.exit(1);
        }
    })();
}
