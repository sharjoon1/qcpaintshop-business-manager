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

        console.log('Starting pack_sizes Zoho mapping migration...');

        const [cols] = await pool.query(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pack_sizes' AND COLUMN_NAME = 'zoho_item_id'"
        );

        if (cols.length === 0) {
            await pool.query("ALTER TABLE pack_sizes ADD COLUMN zoho_item_id VARCHAR(100) NULL AFTER base_price");
            await pool.query("ALTER TABLE pack_sizes ADD INDEX idx_zoho_item (zoho_item_id)");
            console.log('Added zoho_item_id column to pack_sizes');
        } else {
            console.log('zoho_item_id column already exists');
        }

        console.log('Migration complete!');
    } finally {
        if (pool) await pool.end();
        process.exit(0);
    }
}

migrate().catch(err => { console.error('Migration failed:', err); process.exit(1); });
