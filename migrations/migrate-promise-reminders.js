/**
 * Migration: Promise-to-Pay WhatsApp Reminder Support
 * - Adds customer_phone to payment_promises (needed to send WA)
 * - Adds wa_reminder_sent_at column (track last reminder sent time)
 * - Adds follow_up_staff_id column (who did the follow-up — may differ from created_by)
 * Run: node migrations/migrate-promise-reminders.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mysql = require('mysql2/promise');

async function migrate() {
    const pool = await mysql.createPool({
        host: process.env.DB_HOST, user: process.env.DB_USER,
        password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
        waitForConnections: true, connectionLimit: 5
    });

    console.log('[Promise Reminders Migration] Connected');

    // 1. Add customer_phone to payment_promises
    await addColumnIfMissing(pool, 'payment_promises', 'customer_phone',
        'VARCHAR(20) DEFAULT NULL AFTER customer_name');
    console.log('✓ payment_promises.customer_phone');

    // 2. Add wa_reminder_sent_at (tracks when last WA reminder was dispatched)
    await addColumnIfMissing(pool, 'payment_promises', 'wa_reminder_sent_at',
        'DATETIME DEFAULT NULL AFTER follow_up_date');
    console.log('✓ payment_promises.wa_reminder_sent_at');

    // 3. Add follow_up_staff_id (person who did the actual follow-up, may differ from created_by)
    await addColumnIfMissing(pool, 'payment_promises', 'follow_up_staff_id',
        'INT DEFAULT NULL AFTER created_by');
    console.log('✓ payment_promises.follow_up_staff_id');

    // 4. Add index on promise_date for cron query performance
    try {
        await pool.query('ALTER TABLE payment_promises ADD INDEX idx_pp_promise_date (promise_date)');
        console.log('✓ index idx_pp_promise_date');
    } catch(e) {
        if (e.code === 'ER_DUP_KEYNAME') console.log('  (idx_pp_promise_date already exists)');
        else throw e;
    }

    await pool.end();
    console.log('[Promise Reminders Migration] Done');
    process.exit(0);
}

async function addColumnIfMissing(pool, table, column, definition) {
    const [rows] = await pool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
    );
    if (rows.length > 0) { console.log(`  (${table}.${column} already exists)`); return; }
    await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

migrate().catch(e => { console.error(e); process.exit(1); });
