/**
 * stock_verifications — per-item EOD/weekly/monthly reconciliation log.
 *
 * One row per (item, branch, verify event). Driven by the Reconcile tab on
 * staff/stock-check.html: staff confirms today's transacted items either
 * match the shelf ("matches") or differ ("discrepancy" + physical count).
 *
 * Distinct from stock_check_items because this is lightweight 1-click
 * verification, not an admin-driven assignment with photos.
 */
require('dotenv').config();
const { createPool } = require('../config/database');

(async () => {
    const pool = createPool();
    try {
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
    } catch (err) {
        console.error('Migration failed:', err.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
})();
