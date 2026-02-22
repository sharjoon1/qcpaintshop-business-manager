/**
 * Migration: General WhatsApp Session
 * Drops FK constraints on whatsapp_sessions, whatsapp_messages, whatsapp_contacts
 * to allow branch_id = 0 for the company-wide "General WhatsApp" session.
 *
 * Run: node migrations/migrate-general-whatsapp.js
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mysql = require('mysql2/promise');

async function migrate() {
    const pool = await mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: 5
    });

    console.log('[General WhatsApp Migration] Connected to database');

    // 1. Drop FK on whatsapp_sessions.branch_id
    console.log('[1/3] Dropping FK on whatsapp_sessions.branch_id...');
    await dropForeignKey(pool, 'whatsapp_sessions', 'branch_id');

    // 2. Drop FK on whatsapp_messages.branch_id
    console.log('[2/3] Dropping FK on whatsapp_messages.branch_id...');
    await dropForeignKey(pool, 'whatsapp_messages', 'branch_id');

    // 3. Drop FK on whatsapp_contacts.branch_id
    console.log('[3/3] Dropping FK on whatsapp_contacts.branch_id...');
    await dropForeignKey(pool, 'whatsapp_contacts', 'branch_id');

    console.log('\n[General WhatsApp Migration] Complete!');
    console.log('branch_id = 0 is now allowed for the General WhatsApp session.');
    await pool.end();
    process.exit(0);
}

/**
 * Find and drop the FK constraint on a given column.
 * Idempotent — skips if no FK found.
 */
async function dropForeignKey(pool, tableName, columnName) {
    try {
        // Find the FK constraint name from INFORMATION_SCHEMA
        const [rows] = await pool.query(`
            SELECT CONSTRAINT_NAME
            FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = ?
              AND COLUMN_NAME = ?
              AND REFERENCED_TABLE_NAME IS NOT NULL
        `, [tableName, columnName]);

        if (rows.length === 0) {
            console.log(`   ✓ No FK found on ${tableName}.${columnName} (already dropped or never existed)`);
            return;
        }

        for (const row of rows) {
            const fkName = row.CONSTRAINT_NAME;
            try {
                await pool.query(`ALTER TABLE ${tableName} DROP FOREIGN KEY \`${fkName}\``);
                console.log(`   ✓ Dropped FK '${fkName}' on ${tableName}.${columnName}`);
            } catch (err) {
                if (err.code === 'ER_CANT_DROP_FIELD_OR_KEY') {
                    console.log(`   ✓ FK '${fkName}' already dropped`);
                } else {
                    throw err;
                }
            }
        }
    } catch (err) {
        console.error(`   ✗ Error dropping FK on ${tableName}.${columnName}:`, err.message);
    }
}

migrate().catch(err => {
    console.error('[General WhatsApp Migration] FAILED:', err.message);
    process.exit(1);
});
