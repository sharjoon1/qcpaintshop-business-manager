require('dotenv').config();
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

async function migrate() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: 5,
        multipleStatements: true
    });

    try {
        console.log('Starting Chat, Notifications & Share Links migration...\n');

        const sqlFile = path.join(__dirname, 'migration-chat-notifications-share.sql');
        const sql = fs.readFileSync(sqlFile, 'utf8');

        // Strip comment-only lines, then split by semicolons
        const cleaned = sql.replace(/^--.*$/gm, '');
        const statements = cleaned
            .split(';')
            .map(s => s.trim())
            .filter(s => s.length > 0);

        for (const statement of statements) {
            try {
                await pool.query(statement);
                // Extract table name from CREATE TABLE
                const match = statement.match(/CREATE TABLE IF NOT EXISTS (\w+)/i);
                if (match) {
                    console.log(`  ✅ Table "${match[1]}" ready`);
                }
            } catch (err) {
                // Ignore duplicate key/index errors for idempotency
                if (err.code === 'ER_DUP_KEYNAME' || err.code === 'ER_DUP_FIELDNAME') {
                    console.log(`  ⚠️  Skipped (already exists): ${err.message}`);
                } else {
                    throw err;
                }
            }
        }

        console.log('\n✅ Chat, Notifications & Share Links migration completed!');
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

migrate();
