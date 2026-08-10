/**
 * Painter catalog — main-base support (one base per product).
 *
 * Adds two additive columns:
 *   pack_sizes.base_key       VARCHAR(20) NULL  — tint base of this pack (CS1, CSWT, N, PO, ...)
 *   products.main_base_key    VARCHAR(20) NULL  — base shown in the painter catalog; NULL = all sizes
 *
 * NULL semantics (safe default):
 *   - pack_sizes.base_key IS NULL      → item has no base grouping (enamels/colours/tools)
 *   - products.main_base_key IS NULL   → catalog keeps showing every pack size (current behaviour)
 *
 * Idempotent (information_schema existence checks). Additive only.
 * Normalized to exports.up(pool) — the migrate.js runner executes this.
 */

exports.up = async function up(pool) {
    const [cols] = await pool.query(`
        SELECT TABLE_NAME, COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND ((TABLE_NAME = 'pack_sizes' AND COLUMN_NAME = 'base_key')
            OR (TABLE_NAME = 'products' AND COLUMN_NAME = 'main_base_key'))
    `);
    const existing = new Set(cols.map((r) => `${r.TABLE_NAME}.${r.COLUMN_NAME}`));

    if (!existing.has('pack_sizes.base_key')) {
        await pool.query(`ALTER TABLE pack_sizes ADD COLUMN base_key VARCHAR(20) NULL AFTER unit`);
        console.log('✅ Added pack_sizes.base_key');
    } else {
        console.log('⏭️  pack_sizes.base_key already exists');
    }

    if (!existing.has('products.main_base_key')) {
        await pool.query(`ALTER TABLE products ADD COLUMN main_base_key VARCHAR(20) NULL AFTER product_type`);
        console.log('✅ Added products.main_base_key');
    } else {
        console.log('⏭️  products.main_base_key already exists');
    }
};

// Direct-run support (legacy usage: node migrations/migrate-catalog-base-keys.js)
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
        } finally {
            await pool.end();
        }
    })();
}
