/**
 * Soft-delete support for the delete/void flow (owner 2026-06-12): deleting a
 * document never hard-removes the money row — it's soft-cancelled (status) +
 * deleted_at stamped, preserving money-path history. Adds deleted_at to
 * billing_invoices and vendor_bills. (Purchase orders reuse their existing
 * 'cancelled' status enum; estimates already cancel via status.)
 *
 * Idempotent (information_schema-guarded). Direct-run supported for prod.
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
        if (!(await columnExists(pool, table, 'deleted_at'))) {
            await pool.query(`ALTER TABLE ${table} ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL`);
            console.log(`  ✓ ${table}.deleted_at added`);
        }
    }
    console.log('  ✓ soft-delete columns ensured');
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
