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

        console.log('Starting painter ID card migration...');

        // Add id_card_generated_at column to painters
        const [cols] = await pool.query(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'painters' AND COLUMN_NAME = 'id_card_generated_at'"
        );
        if (cols.length === 0) {
            await pool.query("ALTER TABLE painters ADD COLUMN id_card_generated_at TIMESTAMP NULL");
            console.log('Added id_card_generated_at column to painters');
        } else {
            console.log('id_card_generated_at column already exists');
        }

        console.log('Migration complete!');
    } finally {
        if (pool) await pool.end();
        process.exit(0);
    }
}

migrate().catch(err => { console.error('Migration failed:', err); process.exit(1); });
