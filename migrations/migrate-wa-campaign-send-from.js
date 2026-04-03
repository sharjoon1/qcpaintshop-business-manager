/**
 * Migration: Add send_from_branch_id to wa_campaigns
 * Allows campaigns to specify which WhatsApp session to send from
 *
 * Run: node migrations/migrate-wa-campaign-send-from.js
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

    console.log('[WA Campaign Send-From Migration] Connected to database');

    // Check if column already exists
    const [cols] = await pool.query(`
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'wa_campaigns' AND COLUMN_NAME = 'send_from_branch_id'
    `, [process.env.DB_NAME]);

    if (cols.length > 0) {
        console.log('   Column send_from_branch_id already exists, skipping.');
    } else {
        console.log('[1/1] Adding send_from_branch_id column to wa_campaigns...');
        await pool.query(`
            ALTER TABLE wa_campaigns ADD COLUMN send_from_branch_id INT DEFAULT 0 AFTER branch_id
        `);
        console.log('   ✓ send_from_branch_id column added');
    }

    console.log('\n[WA Campaign Send-From Migration] Complete!');
    await pool.end();
    process.exit(0);
}

migrate().catch(err => {
    console.error('[WA Campaign Send-From Migration] FAILED:', err.message);
    process.exit(1);
});
