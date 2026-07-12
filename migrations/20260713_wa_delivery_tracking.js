/**
 * WhatsApp campaign/instant delivery tracking (CM2).
 *
 * Adds the plumbing needed to turn delivery/read receipts (message_ack) into
 * dashboard KPIs:
 *   1. `whatsapp_msg_id VARCHAR(100) NULL` + an index on BOTH
 *      `wa_campaign_leads` and `wa_instant_messages`. The ack handler matches
 *      a receipt to a marketing row by this id; without it, Delivered/Read
 *      counters are permanently 0.
 *   2. Append 'skipped' to `wa_instant_messages.status` ENUM at the END
 *      (needed by CM3's opt-out path; harmless to ship early — no existing row
 *      uses it). `wa_campaign_leads.status` already has 'skipped'.
 *
 * Additive-only, information_schema-guarded, idempotent (house rules — no
 * "IF NOT EXISTS" DDL). End-append of an ENUM value is an INSTANT operation in
 * MariaDB (no table rebuild); adding a NULLable column + secondary index is
 * ALGORITHM=INPLACE.
 */

const MSG_ID_COLUMN = 'whatsapp_msg_id';

// table → index name for the msg-id lookup column.
const MSG_ID_TARGETS = [
    { table: 'wa_campaign_leads', index: 'idx_wcl_msgid' },
    { table: 'wa_instant_messages', index: 'idx_wim_msgid' },
];

/**
 * Parse the value list out of an ENUM COLUMN_TYPE string, e.g.
 *   enum('a','b')  →  ['a','b']. Handles '' escaping. null for non-ENUM.
 */
function parseEnumValues(columnType) {
    if (!columnType) return null;
    const m = /^enum\((.*)\)$/i.exec(String(columnType).trim());
    if (!m) return null;
    const inner = m[1];
    const values = [];
    let i = 0;
    while (i < inner.length) {
        if (inner[i] !== "'") { i++; continue; }
        i++; // opening quote
        let val = '';
        while (i < inner.length) {
            if (inner[i] === "'") {
                if (inner[i + 1] === "'") { val += "'"; i += 2; continue; }
                i++; // closing quote
                break;
            }
            val += inner[i];
            i++;
        }
        values.push(val);
    }
    return values;
}

/** Re-serialise a value list into an enum(...) type string, escaping quotes. */
function buildEnumType(values) {
    return 'enum(' + values.map((v) => `'${String(v).replace(/'/g, "''")}'`).join(',') + ')';
}

async function columnExists(pool, table, column) {
    const [rows] = await pool.query(
        `SELECT 1 FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
    );
    return rows.length > 0;
}

async function indexExists(pool, table, indexName) {
    const [rows] = await pool.query(
        `SELECT 1 FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
        [table, indexName]
    );
    return rows.length > 0;
}

async function readColumn(pool, table, column) {
    const [rows] = await pool.query(
        `SELECT COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
    );
    return rows.length ? rows[0] : null;
}

exports.up = async function up(pool) {
    // 1. whatsapp_msg_id column + index on both marketing tables.
    for (const { table, index } of MSG_ID_TARGETS) {
        if (await columnExists(pool, table, MSG_ID_COLUMN)) {
            console.log(`  [ok] ${table}.${MSG_ID_COLUMN} already present`);
        } else {
            await pool.query(
                `ALTER TABLE ${table} ADD COLUMN ${MSG_ID_COLUMN} VARCHAR(100) NULL`
            );
            console.log(`  ✓ ${table}.${MSG_ID_COLUMN} added`);
        }

        if (await indexExists(pool, table, index)) {
            console.log(`  [ok] ${table}.${index} already present`);
        } else {
            await pool.query(`ALTER TABLE ${table} ADD KEY ${index} (${MSG_ID_COLUMN})`);
            console.log(`  ✓ ${table}.${index} added`);
        }
    }

    // 2. Append 'skipped' to wa_instant_messages.status ENUM at the END.
    const meta = await readColumn(pool, 'wa_instant_messages', 'status');
    if (!meta) {
        console.log('  [skip] wa_instant_messages.status not present in this DB');
    } else {
        const existing = parseEnumValues(meta.COLUMN_TYPE);
        if (!existing) {
            console.log(`  [skip] wa_instant_messages.status is not an ENUM (${meta.COLUMN_TYPE})`);
        } else if (existing.includes('skipped')) {
            console.log('  [ok] wa_instant_messages.status already has skipped');
        } else {
            const target = existing.concat(['skipped']);
            let ddl = `ALTER TABLE wa_instant_messages MODIFY COLUMN status ${buildEnumType(target)}`;
            ddl += meta.IS_NULLABLE === 'YES' ? ' NULL' : ' NOT NULL';
            // MariaDB 10.2+ reports a NULL default as the literal string 'NULL' and wraps
            // string defaults in single quotes; normalise both so we never emit the invalid
            // DEFAULT 'NULL' (broke the CM1 prod run) or double-quote a real default.
            let colDefault = meta.COLUMN_DEFAULT;
            if (colDefault !== null && colDefault !== undefined) {
                const s = String(colDefault);
                if (/^null$/i.test(s)) colDefault = null;
                else if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) colDefault = s.slice(1, -1).replace(/''/g, "'");
            }
            if (colDefault !== null && colDefault !== undefined) {
                ddl += ` DEFAULT '${String(colDefault).replace(/'/g, "''")}'`;
            } else if (meta.IS_NULLABLE === 'YES') {
                ddl += ' DEFAULT NULL';
            }
            await pool.query(ddl);
            console.log('  ✓ wa_instant_messages.status appended: skipped');
        }
    }

    console.log('  ✓ wa delivery tracking ensured');
};

// Exposed for unit tests.
exports.parseEnumValues = parseEnumValues;
exports.buildEnumType = buildEnumType;

// Direct-run support for prod (the pre-2026-04-30 _migrations gap):
//   node migrations/20260713_wa_delivery_tracking.js
//   then: INSERT IGNORE INTO _migrations (name) VALUES ('20260713_wa_delivery_tracking.js');
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
