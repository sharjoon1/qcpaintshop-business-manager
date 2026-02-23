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

        console.log('Fixing WhatsApp phone number field sizes...\n');

        // Tables with phone columns that need widening from VARCHAR(20) to VARCHAR(50)
        const alterations = [
            { table: 'whatsapp_sessions', column: 'phone_number', nullable: true },
            { table: 'whatsapp_messages', column: 'phone_number', nullable: false },
            { table: 'whatsapp_contacts', column: 'phone_number', nullable: false },
            { table: 'whatsapp_followups', column: 'phone', nullable: false }
        ];

        for (const { table, column, nullable } of alterations) {
            // Check if table exists
            const [tables] = await pool.query(`
                SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
            `, [table]);

            if (tables.length === 0) {
                console.log(`⏭️  Table ${table} does not exist, skipping`);
                continue;
            }

            // Check current column size
            const [cols] = await pool.query(`
                SELECT CHARACTER_MAXIMUM_LENGTH FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?
            `, [table, column]);

            if (cols.length === 0) {
                console.log(`⏭️  ${table}.${column} does not exist, skipping`);
                continue;
            }

            const currentSize = cols[0].CHARACTER_MAXIMUM_LENGTH;
            if (currentSize >= 50) {
                console.log(`⏭️  ${table}.${column} already VARCHAR(${currentSize}), no change needed`);
                continue;
            }

            const nullClause = nullable ? 'NULL' : 'NOT NULL';
            await pool.query(`ALTER TABLE ${table} MODIFY COLUMN ${column} VARCHAR(50) ${nullClause}`);
            console.log(`✅ ${table}.${column} widened from VARCHAR(${currentSize}) to VARCHAR(50)`);
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
