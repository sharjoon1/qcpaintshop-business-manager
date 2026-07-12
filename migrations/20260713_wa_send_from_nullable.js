/**
 * Make wa_campaigns.send_from_branch_id NULLable with DEFAULT NULL (CM4).
 *
 * The column was added by migrate-wa-campaign-send-from.js as `INT DEFAULT 0`,
 * and every route dropped the field on write — so EVERY existing row is an
 * unintentional 0. In the send-from-honored engine, 0 means "General WhatsApp
 * session". If we ship the honoring code without nulling those 0s, the deploy
 * would silently reroute every existing/running campaign to the General session
 * instead of its own branch. So the backfill (`SET send_from_branch_id = NULL`)
 * is MANDATORY and runs in the same pass as the MODIFY.
 *
 * NULL now means "inherit the campaign's own branch_id at send time"; 0 =
 * General, -1 = Admin, > 0 = a specific branch.
 *
 * Idempotent + additive:
 *   - column missing        → ADD it as INT NULL DEFAULT NULL (fresh DB; brand
 *                             new column is all-NULL, no backfill needed).
 *   - present, not yet NULL-default → MODIFY to INT NULL DEFAULT NULL + backfill.
 *   - already NULL-default  → no-op.
 * The backfill only runs in the same run as the MODIFY (i.e. before any real
 * value could exist), never on a re-run — the already-migrated branch skips it.
 *
 * information_schema-guarded (house rules — no "IF NOT EXISTS" DDL). MODIFY of a
 * default/nullability is ALGORITHM=INPLACE (no rebuild) on MariaDB 10.11.
 */

const TABLE = 'wa_campaigns';
const COLUMN = 'send_from_branch_id';

async function readColumn(pool, table, column) {
    const [rows] = await pool.query(
        `SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
    );
    return rows.length ? rows[0] : null;
}

/**
 * True when COLUMN_DEFAULT represents SQL NULL. MariaDB 10.2+ reports a NULL
 * default as the literal string 'NULL' (and may quote string defaults); MySQL
 * returns SQL NULL. Normalize every shape.
 */
function isNullDefault(colDefault) {
    if (colDefault === null || colDefault === undefined) return true;
    let s = String(colDefault);
    if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) s = s.slice(1, -1);
    return /^null$/i.test(s);
}

exports.up = async function up(pool) {
    const meta = await readColumn(pool, TABLE, COLUMN);

    if (!meta) {
        // Fresh DB (base migrate-wa-campaign-send-from.js never ran here): add the
        // column already in its desired end state. No backfill — it's all NULL.
        await pool.query(
            `ALTER TABLE ${TABLE} ADD COLUMN ${COLUMN} INT NULL DEFAULT NULL AFTER branch_id`
        );
        console.log(`  ✓ ${TABLE}.${COLUMN} added as INT NULL DEFAULT NULL`);
        console.log('  ✓ wa_campaigns send_from_branch_id nullable ensured');
        return;
    }

    if (meta.IS_NULLABLE === 'YES' && isNullDefault(meta.COLUMN_DEFAULT)) {
        console.log(`  [ok] ${TABLE}.${COLUMN} already NULLable with DEFAULT NULL`);
        return;
    }

    // Just made nullable this run → the backfill is safe (no intentional value
    // can exist yet). NULL out the unintentional DEFAULT-0s from before the fix.
    await pool.query(`ALTER TABLE ${TABLE} MODIFY COLUMN ${COLUMN} INT NULL DEFAULT NULL`);
    console.log(`  ✓ ${TABLE}.${COLUMN} → INT NULL DEFAULT NULL`);

    const [r] = await pool.query(`UPDATE ${TABLE} SET ${COLUMN} = NULL`);
    console.log(`  ✓ backfilled ${r && r.affectedRows != null ? r.affectedRows : '?'} row(s) send_from_branch_id → NULL`);
    console.log('  ✓ wa_campaigns send_from_branch_id nullable ensured');
};

// Exposed for unit tests.
exports.isNullDefault = isNullDefault;

// Direct-run support for prod (the pre-2026-04-30 _migrations gap):
//   node migrations/20260713_wa_send_from_nullable.js
//   then: INSERT IGNORE INTO _migrations (name) VALUES ('20260713_wa_send_from_nullable.js');
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
