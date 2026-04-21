const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function migrate() {
    let pool;
    try {
        pool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'business_manager',
            port: process.env.DB_PORT || 3306
        });

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
    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    } finally {
        if (pool) await pool.end();
        process.exit(0);
    }
}

migrate();
