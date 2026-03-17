// migrations/migrate-estimate-columns.js
require('dotenv').config();
const mysql = require('mysql2/promise');

async function migrate() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    console.log('Starting estimate columns migration...');

    try {
        await pool.query('ALTER TABLE estimate_items ADD COLUMN image_url VARCHAR(500) DEFAULT NULL AFTER product_id');
        console.log('Added image_url column to estimate_items');
    } catch (e) {
        if (e.code === 'ER_DUP_FIELDNAME') {
            console.log('image_url column already exists');
        } else {
            throw e;
        }
    }

    await pool.end();
    console.log('Migration complete!');
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
