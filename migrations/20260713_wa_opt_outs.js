/**
 * WhatsApp marketing opt-out registry (CM3).
 *
 * A single flat table keyed by the last-10-digit phone key. A row means the
 * number has texted STOP/UNSUBSCRIBE and must be suppressed from ALL marketing
 * sends (campaign engine, instant-send, painter invites, painter marketing
 * admin quick-send). Transactional messages (receipts, OTP, chat replies) are
 * never gated. START/RESUME removes the row (opt back in).
 *
 * Additive + idempotent (house rules): guarded by an information_schema
 * tableExists check so re-running is a no-op. No destructive DDL.
 */

const TABLE = 'wa_opt_outs';

async function tableExists(pool, table) {
    const [rows] = await pool.query(
        `SELECT 1 FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
        [table]
    );
    return rows.length > 0;
}

exports.up = async function up(pool) {
    if (await tableExists(pool, TABLE)) {
        console.log(`  [ok] ${TABLE} already exists`);
        return;
    }

    await pool.query(`
        CREATE TABLE ${TABLE} (
            phone_key    CHAR(10)    NOT NULL,
            opted_out_at DATETIME    NOT NULL,
            source       VARCHAR(30) DEFAULT NULL,
            raw_from     VARCHAR(50) DEFAULT NULL,
            branch_id    INT         DEFAULT NULL,
            PRIMARY KEY (phone_key)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log(`  ✓ ${TABLE} created`);
};

// Exposed for unit tests.
exports.tableExists = tableExists;

// Direct-run support for prod (the pre-2026-04-30 _migrations gap):
//   node migrations/20260713_wa_opt_outs.js
//   then: INSERT IGNORE INTO _migrations (name) VALUES ('20260713_wa_opt_outs.js');
if (require.main === module) {
    (async () => {
        require('dotenv').config();
        const { createPool } = require('../config/database');
        const pool = createPool();
        try {
            await exports.up(pool);
            console.log('Done.');
            process.exit(0);
        } catch (err) {
            console.error('Migration failed:', err.message);
            process.exit(1);
        }
    })();
}
