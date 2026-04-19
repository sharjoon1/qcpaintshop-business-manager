// Add 'bonus_pct' to painter_special_offers.offer_type enum.
//
// bonus_pct = painter earns (rate × multiplier_value / 100) as extra offer points per unit.
// Scales naturally with pack size — a 5% offer gives ₹16 on 1L (₹323) vs ₹290 on 20L (₹5809).
//
// Idempotent.

require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
    const pool = await mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        connectionLimit: 2,
    });

    try {
        const [[row]] = await pool.query(
            `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'painter_special_offers' AND COLUMN_NAME = 'offer_type'`
        );
        if (!row) {
            console.error('❌ painter_special_offers.offer_type column not found');
            process.exitCode = 1;
            return;
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
    } catch (err) {
        console.error('❌ Migration failed:', err.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
})();
