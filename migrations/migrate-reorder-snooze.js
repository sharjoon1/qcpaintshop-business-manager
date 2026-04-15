/**
 * Reorder snooze — let admin mark an (item × location) as "not needed now"
 * so it drops out of the Alerts list and Daily Report until either
 * `snoozed_until` passes or the row is explicitly removed.
 *
 * snoozed_until NULL = snoozed forever (until manually un-snoozed).
 * Dedicated table so the flag survives cron recomputation of
 * zoho_reorder_alerts / zoho_reorder_config.
 */
const mysql = require('mysql2/promise');
require('dotenv').config();

async function run() {
    const pool = await mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        waitForConnections: true, connectionLimit: 3
    });
    try {
        console.log('[migrate-reorder-snooze] START');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS reorder_snoozes (
                zoho_item_id     VARCHAR(50) NOT NULL,
                zoho_location_id VARCHAR(50) NOT NULL,
                snoozed_until    DATETIME    NULL,
                notes            TEXT        NULL,
                snoozed_by       INT         NULL,
                created_at       DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at       DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (zoho_item_id, zoho_location_id),
                KEY idx_until (snoozed_until)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✓ reorder_snoozes created');
        console.log('[migrate-reorder-snooze] DONE');
    } catch (e) {
        console.error('[migrate-reorder-snooze] FAIL', e);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

if (require.main === module) run().then(() => process.exit(process.exitCode || 0));
module.exports = { run };
