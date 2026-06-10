/**
 * Adds color_name / color_code columns to pack_sizes (idempotent via
 * information_schema existence checks).
 * Normalized to exports.up(pool) (D2, 2026-06-11) — requiring this file no longer runs it.
 */

exports.up = async function up(pool) {
    console.log('Adding color columns to pack_sizes...\n');

    const [colorNameCol] = await pool.query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pack_sizes' AND COLUMN_NAME = 'color_name'
    `);

    if (colorNameCol.length === 0) {
        await pool.query(`ALTER TABLE pack_sizes ADD COLUMN color_name VARCHAR(100) NULL`);
        console.log('✅ Added color_name to pack_sizes');
    } else {
        console.log('⏭️  color_name already exists');
    }

    const [colorCodeCol] = await pool.query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pack_sizes' AND COLUMN_NAME = 'color_code'
    `);

    if (colorCodeCol.length === 0) {
        await pool.query(`ALTER TABLE pack_sizes ADD COLUMN color_code VARCHAR(20) NULL`);
        console.log('✅ Added color_code to pack_sizes');
    } else {
        console.log('⏭️  color_code already exists');
    }

    console.log('\n✅ Migration complete.');
};

// Direct-run support (legacy usage: node migrations/migrate-pack-sizes-color.js)
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
