/**
 * Widen painter_lead_followups ENUMs so the new painter-leads followup endpoint
 * (routes/painter-leads/api.js) stops throwing STRICT_TRANS_TABLES 500s on prod.
 *
 * The 2026-07-12 followup page offers outcomes ('interested','callback',
 * 'no_response','converted','unreachable','other') and type 'sms' that are NOT
 * in the shipped ENUMs (migrate-pntr-painter-marketing.js). Under
 * STRICT_TRANS_TABLES those inserts fail inside the endpoint's transaction.
 *
 * Strategy: read the CURRENT ENUM definition from information_schema, preserve
 * the existing values in their existing order, and APPEND the missing new
 * values at the end. End-append of ENUM values is an INSTANT operation in
 * MariaDB (no table rebuild). NULLability/defaults are preserved from the live
 * column. Idempotent: when the new values are already present, no ALTER runs.
 *
 * Additive-only, information_schema-guarded (house rules — no "IF NOT EXISTS").
 */

const TABLE = 'painter_lead_followups';

// column → new values that must exist (appended at the end if absent).
const TARGETS = [
    { column: 'outcome', newValues: ['interested', 'callback', 'no_response', 'converted', 'unreachable', 'other'] },
    { column: 'followup_type', newValues: ['sms'] },
];

/**
 * Parse the value list out of an ENUM COLUMN_TYPE string, e.g.
 *   enum('call','whatsapp','visit')  →  ['call','whatsapp','visit']
 * Handles MySQL's '' escaping inside a value. Returns null for non-ENUM types.
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
    for (const { column, newValues } of TARGETS) {
        const meta = await readColumn(pool, TABLE, column);
        if (!meta) {
            console.log(`  [skip] ${TABLE}.${column} not present in this DB`);
            continue;
        }

        const existing = parseEnumValues(meta.COLUMN_TYPE);
        if (!existing) {
            console.log(`  [skip] ${TABLE}.${column} is not an ENUM (${meta.COLUMN_TYPE})`);
            continue;
        }

        const missing = newValues.filter((v) => !existing.includes(v));
        if (missing.length === 0) {
            console.log(`  [ok] ${TABLE}.${column} already has all values (${existing.length})`);
            continue;
        }

        // Preserve existing values + order; append the missing new ones at the end.
        const target = existing.concat(missing);
        let ddl = `ALTER TABLE ${TABLE} MODIFY COLUMN ${column} ${buildEnumType(target)}`;
        ddl += meta.IS_NULLABLE === 'YES' ? ' NULL' : ' NOT NULL';
        // MariaDB 10.2+ reports a NULL default as the SQL literal string 'NULL' and wraps
        // string defaults in single quotes; MySQL returns SQL NULL / bare values. Normalize
        // both so we never emit DEFAULT 'NULL' (invalid enum member — broke the first prod run).
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
        console.log(`  ✓ ${TABLE}.${column} appended: ${missing.join(', ')}`);
    }
    console.log('  ✓ painter_lead_followups ENUMs ensured');
};

// Exposed for unit tests.
exports.parseEnumValues = parseEnumValues;
exports.buildEnumType = buildEnumType;

// Direct-run support for prod (the pre-2026-04-30 _migrations gap):
//   node migrations/20260713_painter_followup_enums.js
//   then: INSERT IGNORE INTO _migrations (name) VALUES ('20260713_painter_followup_enums.js');
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
