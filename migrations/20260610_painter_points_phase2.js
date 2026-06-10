/**
 * Phase 2 (M1/M2/M3/M4) — painter points engine correctness support.
 *
 * 1. Appends every runtime-used source value to painter_point_transactions.source.
 *    LATENT BUG: the original ENUM (migrate-painters.js) lists 9 values, but code
 *    has long inserted 7 more — 'daily_bonus' (processInvoice, since Mar 2026),
 *    'streak_bonus', 'challenge_reward', 'attendance_claim', 'attendance_clawback'
 *    (AP system), 'invoice_backfill' (PNTR backfill), and now 'clawback' (M2's
 *    visible clawback-settlement entries). Under strict sql_mode those inserts
 *    THROW (and, pre-M1, permanently swallowed the invoice's points); under
 *    non-strict they were silently stored as '' — breaking the daily-bonus cap
 *    query and the attendance idempotency guard (both filter on source).
 *    Preserves the column's existing NULL-ability (originally NOT NULL).
 * 2. Repairs rows corrupted to source='' by the non-strict path, keyed on
 *    reference_type (each runtime source uses a distinct reference_type).
 * 3. Backfills painter_invoices_processed.zoho_invoice_id from painter_estimates
 *    for credit-flow estimate rows (pushed to Zoho without a locally recorded
 *    payment) so the M3 unpaid-credit check can see their Zoho balance.
 *    Locally-paid estimates (payment_recorded_at set) are deliberately left
 *    unlinked — they are paid by definition, whatever their Zoho-side balance.
 * 4. Creates job_runs — period-stamped success markers for date-anchored crons
 *    so a restart that straddles a fire time can catch up (M4).
 *
 * Idempotent; ENUM append is an in-place metadata change on MariaDB.
 */

const RUNTIME_SOURCES = [
    'daily_bonus', 'clawback', 'streak_bonus', 'challenge_reward',
    'attendance_claim', 'attendance_clawback', 'invoice_backfill'
];

// reference_type → correct source, for repairing rows stored as '' by the
// pre-fix non-strict insert path. Unambiguous: each of these reference types
// is written by exactly one award/debit site.
const EMPTY_SOURCE_REPAIRS = [
    ['streak', 'streak_bonus'],
    ['challenge', 'challenge_reward'],
    ['attendance_monthly', 'attendance_claim'],
    ['attendance_checkin', 'attendance_clawback'],
    ['zoho_invoice', 'invoice_backfill'],
];

async function columnInfo(pool, table, column) {
    const [rows] = await pool.query(
        `SELECT COLUMN_TYPE, IS_NULLABLE FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
    );
    return rows.length ? { type: String(rows[0].COLUMN_TYPE), nullable: rows[0].IS_NULLABLE === 'YES' } : null;
}

async function tableExists(pool, table) {
    const [rows] = await pool.query(
        `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [table]
    );
    return rows.length > 0;
}

exports.up = async function up(pool) {
    // 1. source ENUM additions
    const col = await columnInfo(pool, 'painter_point_transactions', 'source');
    if (!col) {
        console.log('  [skip] painter_point_transactions.source not found');
    } else {
        const values = (col.type.match(/'([^']*)'/g) || []).map(v => v.slice(1, -1));
        const missing = RUNTIME_SOURCES.filter(v => !values.includes(v));
        if (missing.length) {
            const newValues = [...values, ...missing].map(v => `'${v}'`).join(',');
            const nullSql = col.nullable ? 'DEFAULT NULL' : 'NOT NULL';
            await pool.query(
                `ALTER TABLE painter_point_transactions MODIFY COLUMN source ENUM(${newValues}) ${nullSql}`
            );
            console.log(`  ✓ painter_point_transactions.source += ${missing.join(', ')}`);
        }

        // 2. Repair rows corrupted by the pre-fix non-strict insert path.
        const [bonusFix] = await pool.query(
            `UPDATE painter_point_transactions SET source = 'daily_bonus'
             WHERE source = '' AND reference_type = 'invoice' AND description LIKE 'Daily bonus%'`
        );
        if (bonusFix.affectedRows) console.log(`  ✓ repaired ${bonusFix.affectedRows} corrupted daily_bonus row(s)`);
        for (const [refType, source] of EMPTY_SOURCE_REPAIRS) {
            const [fixed] = await pool.query(
                `UPDATE painter_point_transactions SET source = ? WHERE source = '' AND reference_type = ?`,
                [source, refType]
            );
            if (fixed.affectedRows) console.log(`  ✓ repaired ${fixed.affectedRows} corrupted ${source} row(s)`);
        }
    }

    // 3. Link credit-flow estimate rows to their Zoho invoice (M3)
    if (await tableExists(pool, 'painter_invoices_processed') && await tableExists(pool, 'painter_estimates')) {
        const [linked] = await pool.query(
            `UPDATE painter_invoices_processed pip
             JOIN painter_estimates pe
               ON pip.invoice_id = CONCAT('EST-', pe.id) AND pip.painter_id = pe.painter_id
             SET pip.zoho_invoice_id = pe.zoho_invoice_id
             WHERE (pip.zoho_invoice_id IS NULL OR pip.zoho_invoice_id = '')
               AND pe.zoho_invoice_id IS NOT NULL
               AND pe.payment_recorded_at IS NULL`
        );
        if (linked.affectedRows) console.log(`  ✓ linked ${linked.affectedRows} credit-flow estimate row(s) to Zoho invoices`);
    } else {
        console.log('  [skip] painter_invoices_processed / painter_estimates not present in this DB');
    }

    // 4. job_runs
    await pool.query(
        `CREATE TABLE IF NOT EXISTS job_runs (
            job_name VARCHAR(64) NOT NULL,
            period_label VARCHAR(32) NOT NULL,
            ran_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (job_name, period_label)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );
    console.log('  ✓ job_runs table ensured');
};

// Direct-run support for prod (the pre-2026-04-30 _migrations gap). Run from
// the repo root (dotenv resolves .env against the working directory):
//   node migrations/20260610_painter_points_phase2.js
//   then: INSERT IGNORE INTO _migrations (name) VALUES ('20260610_painter_points_phase2.js');
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
