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

        console.log('Adding dpl_updated_at to zoho_items_map...\n');

        const [cols] = await pool.query(`
            SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'zoho_items_map' AND COLUMN_NAME = 'dpl_updated_at'
        `);

        if (cols.length === 0) {
            await pool.query(`
                ALTER TABLE zoho_items_map
                ADD COLUMN dpl_updated_at TIMESTAMP NULL DEFAULT NULL
            `);
            console.log('✅ zoho_items_map.dpl_updated_at added');
        } else {
            console.log('⏭️ zoho_items_map.dpl_updated_at already exists');
        }

        console.log('\n✅ Migration completed!');
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        if (pool) await pool.end();
        process.exit(0);
    }
}

migrate();
