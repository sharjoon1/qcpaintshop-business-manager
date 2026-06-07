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

        const columns = [
            ['dpl_disposition',    "VARCHAR(16) NOT NULL DEFAULT 'pending'"],
            ['dpl_disposition_at', 'DATETIME NULL DEFAULT NULL'],
            ['dpl_disposition_by', 'INT NULL DEFAULT NULL'],
        ];

        for (const [name, ddl] of columns) {
            const [cols] = await pool.query(`
                SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'zoho_items_map' AND COLUMN_NAME = ?
            `, [name]);
            if (cols.length === 0) {
                await pool.query(
                    `ALTER TABLE zoho_items_map ADD COLUMN ${name} ${ddl}, ALGORITHM=INPLACE, LOCK=NONE`
                );
                console.log(`✅ zoho_items_map.${name} added`);
            } else {
                console.log(`⏭️ zoho_items_map.${name} already exists`);
            }
        }

        console.log('\n✅ Migration completed!');
    } catch (error) {
        console.error('Migration failed:', error);
        process.exitCode = 1;
    } finally {
        if (pool) await pool.end();
        process.exit(process.exitCode || 0);
    }
}

migrate();
