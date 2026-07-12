/**
 * Payment → Zoho sync foundations (SP-1 C2).
 *
 * Adds the per-payment Zoho-state columns the AR/AP payment-sync engine needs,
 * without changing any existing flow. Everything is additive and
 * information_schema-guarded (dev MySQL vs prod MariaDB — deliberately NO
 * "IF NOT EXISTS" clauses) so the migration is safe to re-run.
 *
 * billing_payments (AR): payment_date, zoho_payment_id, zoho_sync_error,
 *   zoho_claimed_at, deleted_at.
 * vendor_payments  (AP): zoho_sync_error, zoho_claimed_at, deleted_at
 *   (payment_date + zoho_payment_id already exist on this table).
 *
 * zoho_claimed_at is the atomic-claim timestamp used to reclaim stale
 * 'SYNCING' rows after a crash mid-forward.
 *
 * Backfills (idempotent — guarded by IS-NULL / sentinel conditions):
 *   - billing_payments.payment_date ← IST calendar date of created_at.
 *   - LEGACY sentinels on pre-cutoff rows so the new sync never double-pays
 *     history: old AR payments rode the push-time aggregate 'Cash' forward and
 *     old AP payments were hand-entered in Zoho by the accountant. Payments on
 *     not-yet-pushed invoices stay NULL and are covered by the new per-row
 *     push-time forwarding (no regression).
 */

// LEGACY cutoff: rows created before this date are treated as already handled.
// adjust to the actual prod deploy date before running on prod
const CUTOFF = '2026-07-13';

async function columnExists(pool, table, column) {
    const [rows] = await pool.query(
        `SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
    );
    return rows.length > 0;
}

async function tableExists(pool, table) {
    const [rows] = await pool.query(
        `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [table]
    );
    return rows.length > 0;
}

async function addColumn(pool, table, column, ddl) {
    if (!(await columnExists(pool, table, column))) {
        await pool.query(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
        console.log(`  ✓ ${table}.${column} added`);
    }
}

exports.up = async function up(pool) {
    // ── billing_payments (AR) ──
    if (await tableExists(pool, 'billing_payments')) {
        await addColumn(pool, 'billing_payments', 'payment_date',
            'payment_date DATE NULL AFTER payment_reference');
        await addColumn(pool, 'billing_payments', 'zoho_payment_id',
            'zoho_payment_id VARCHAR(50) NULL AFTER notes');
        await addColumn(pool, 'billing_payments', 'zoho_sync_error',
            'zoho_sync_error VARCHAR(255) NULL AFTER zoho_payment_id');
        await addColumn(pool, 'billing_payments', 'zoho_claimed_at',
            'zoho_claimed_at DATETIME NULL AFTER zoho_sync_error');
        await addColumn(pool, 'billing_payments', 'deleted_at',
            'deleted_at DATETIME NULL AFTER created_at');

        // Backfill payment_date from the IST calendar date of created_at.
        // Offset-based CONVERT_TZ (no named zone) → no mysql tz tables required.
        await pool.query(
            `UPDATE billing_payments
                SET payment_date = DATE(CONVERT_TZ(created_at, '+00:00', '+05:30'))
              WHERE payment_date IS NULL`
        );

        // LEGACY sentinel: pre-cutoff payments on already-pushed invoices were
        // covered by the old push-time aggregate — never re-forward them.
        if (await tableExists(pool, 'billing_invoices')) {
            await pool.query(
                `UPDATE billing_payments bp
                   JOIN billing_invoices bi ON bi.id = bp.invoice_id
                    SET bp.zoho_payment_id = 'LEGACY'
                  WHERE bi.zoho_status = 'pushed'
                    AND bp.zoho_payment_id IS NULL
                    AND bp.created_at < ?`,
                [CUTOFF]
            );
        }
        console.log('  ✓ billing_payments zoho-sync columns ensured');
    } else {
        console.log('  [skip] billing_payments not present in this DB');
    }

    // ── vendor_payments (AP) ── payment_date + zoho_payment_id already exist.
    if (await tableExists(pool, 'vendor_payments')) {
        await addColumn(pool, 'vendor_payments', 'zoho_sync_error',
            'zoho_sync_error VARCHAR(255) NULL AFTER zoho_payment_id');
        await addColumn(pool, 'vendor_payments', 'zoho_claimed_at',
            'zoho_claimed_at DATETIME NULL AFTER zoho_sync_error');
        await addColumn(pool, 'vendor_payments', 'deleted_at',
            'deleted_at DATETIME NULL AFTER created_at');

        // LEGACY sentinel: pre-cutoff AP payments were hand-entered in Zoho.
        await pool.query(
            `UPDATE vendor_payments
                SET zoho_payment_id = 'LEGACY'
              WHERE zoho_payment_id IS NULL
                AND created_at < ?`,
            [CUTOFF]
        );
        console.log('  ✓ vendor_payments zoho-sync columns ensured');
    } else {
        console.log('  [skip] vendor_payments not present in this DB');
    }

    console.log('  ✓ payment → Zoho sync columns ensured');
};

// Direct-run support for prod (the pre-2026-04-30 _migrations gap):
//   node migrations/20260712_payment_zoho_sync.js
//   then: INSERT IGNORE INTO _migrations (name) VALUES ('20260712_payment_zoho_sync.js');
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
