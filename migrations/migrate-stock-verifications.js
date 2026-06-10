/**
 * stock_verifications — per-item EOD/weekly/monthly reconciliation log.
 *
 * One row per (item, branch, verify event). Driven by the Reconcile tab on
 * staff/stock-check.html: staff confirms today's transacted items either
 * match the shelf ("matches") or differ ("discrepancy" + physical count).
 *
 * Distinct from stock_check_items because this is lightweight 1-click
 * verification, not an admin-driven assignment with photos.
 *
 * Normalized to exports.up(pool) (D2, 2026-06-11) — requiring this file no longer runs it.
 */

exports.up = async function up(pool) {
    console.log('Creating stock_verifications table...');
    await pool.query(`
            CREATE TABLE IF NOT EXISTS stock_verifications (
                id INT PRIMARY KEY AUTO_INCREMENT,
                zoho_item_id VARCHAR(50) NOT NULL,
                zoho_location_id VARCHAR(50) NOT NULL,
                branch_id INT,
                verified_by INT NOT NULL,
                verified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                system_stock DECIMAL(12,2),
                physical_stock DECIMAL(12,2),
                match_status ENUM('matches','discrepancy') NOT NULL,
                discrepancy DECIMAL(12,2) DEFAULT 0,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_item_loc (zoho_item_id, zoho_location_id),
                INDEX idx_verified_at (verified_at),
                INDEX idx_branch (branch_id),
                INDEX idx_verified_by (verified_by)
            )
        `);
    console.log('✓ stock_verifications created (or already existed)');
};

// Direct-run support (legacy usage: node migrations/migrate-stock-verifications.js)
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
