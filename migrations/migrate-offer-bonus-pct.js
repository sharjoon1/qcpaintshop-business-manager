// Add 'bonus_pct' to painter_special_offers.offer_type enum.
//
// bonus_pct = painter earns (rate × multiplier_value / 100) as extra offer points per unit.
// Scales naturally with pack size — a 5% offer gives ₹16 on 1L (₹323) vs ₹290 on 20L (₹5809).
//
// Idempotent.
//
// Normalized to exports.up(pool) (D2, 2026-06-11) — requiring this file no longer runs it.

exports.up = async function up(pool) {
    const [[row]] = await pool.query(
        `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'painter_special_offers' AND COLUMN_NAME = 'offer_type'`
    );
    if (!row) {
        console.error('❌ painter_special_offers.offer_type column not found');
        throw new Error('painter_special_offers.offer_type column not found');
    }
    if (row.COLUMN_TYPE.includes("'bonus_pct'")) {
        console.log('  ✓ bonus_pct already present in offer_type enum');
        return;
    }
    await pool.query(`
        ALTER TABLE painter_special_offers
        MODIFY COLUMN offer_type ENUM('multiplier','bonus_points','bonus_pct','free_product','discount') DEFAULT 'multiplier'
    `);
    console.log('  ✓ bonus_pct added to offer_type enum');
};

// Direct-run support (legacy usage: node migrations/migrate-offer-bonus-pct.js)
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
