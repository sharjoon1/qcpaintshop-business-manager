/**
 * Zoho approval-state sync-back (owner queued 2026-06-12): when a bill/invoice is
 * pushed to Zoho it is taken out of draft — staff push → "submitted" (lands in the
 * admin's Zoho approval queue), admin push → "approved". That finalize-state was
 * computed but thrown away (response only) — so an admin approving a submitted doc
 * IN ZOHO was never reflected locally. Persist it in a dedicated column (the
 * existing zoho_status enum only carries pending/pushed/failed and can't hold the
 * Zoho lifecycle state) so the push paths can stamp it and an on-demand sync can
 * refresh it from Zoho's own status field.
 *
 * Adds zoho_approval_state VARCHAR(20) to billing_invoices and vendor_bills.
 * Idempotent (information_schema-guarded). Direct-run supported for prod
 * (pre-Apr-30 _migrations gap convention: run directly + INSERT IGNORE marker).
 */

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

exports.up = async function up(pool) {
    for (const table of ['billing_invoices', 'vendor_bills']) {
        if (!(await tableExists(pool, table))) {
            console.log(`  [skip] ${table} not present in this DB`);
            continue;
        }
        if (!(await columnExists(pool, table, 'zoho_approval_state'))) {
            await pool.query(`ALTER TABLE ${table} ADD COLUMN zoho_approval_state VARCHAR(20) DEFAULT NULL`);
            console.log(`  ✓ ${table}.zoho_approval_state added`);
        } else {
            console.log(`  [skip] ${table}.zoho_approval_state already present`);
        }
    }
    console.log('  ✓ zoho_approval_state columns ensured');
};

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
