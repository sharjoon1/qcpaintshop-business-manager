// Adds cart/markup/branding columns to painter_estimates.
// Safe to run multiple times — checks INFORMATION_SCHEMA before each ADD.
//
// Usage: node migrations/migrate-painter-cart-markup.js
// Normalized to exports.up(pool) (D2, 2026-06-11) — requiring this file no longer runs it.

async function columnExists(pool, table, col) {
    const [rows] = await pool.query(
        `SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ? LIMIT 1`,
        [table, col]
    );
    return rows.length > 0;
}

exports.up = async function up(pool) {
    const table = 'painter_estimates';
    const adds = [
        ['hide_qc_branding', "TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Customer PDF strips QC logo/name/UPI/footer when 1'"],
        ['labour_charge',    "DECIMAL(12,2) NOT NULL DEFAULT 0 COMMENT 'Flat labour line added to total on customer estimates'"],
        ['pricing_mode',     "ENUM('direct','request_qc_price') NOT NULL DEFAULT 'direct' COMMENT 'direct = painter sets own markup; request_qc_price = QC admin sets final'"],
    ];

    for (const [col, spec] of adds) {
        if (await columnExists(pool, table, col)) {
            console.log(`  ✓ ${table}.${col} already exists`);
            continue;
        }
        await pool.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${col}\` ${spec}`);
        console.log(`  + added ${table}.${col}`);
    }

    console.log('\n✅ migrate-painter-cart-markup completed');
};

// Direct-run support (legacy usage: node migrations/migrate-painter-cart-markup.js)
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
