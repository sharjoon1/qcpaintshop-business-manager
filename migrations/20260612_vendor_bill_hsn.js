/**
 * Vendor bills — per-line HSN (owner requirement 2026-06-12): every bill line
 * must carry the HSN it was matched against before the bill can be submitted
 * or pushed to Zoho.
 *
 * Idempotent (information_schema-guarded).
 */

async function columnExists(pool, table, column) {
    const [rows] = await pool.query(
        `SELECT 1 FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
    );
    return rows.length > 0;
}

exports.up = async function up(pool) {
    const [tbl] = await pool.query(
        `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vendor_bill_items'`
    );
    if (!tbl.length) {
        console.log('  [skip] vendor_bill_items not present in this DB');
        return;
    }
    if (!(await columnExists(pool, 'vendor_bill_items', 'hsn_or_sac'))) {
        await pool.query(
            `ALTER TABLE vendor_bill_items ADD COLUMN hsn_or_sac VARCHAR(20) NULL AFTER line_total`
        );
        console.log('  ✓ vendor_bill_items.hsn_or_sac added');
    }
    console.log('  ✓ vendor bill HSN column ensured');
};

// Direct-run support for prod (the pre-2026-04-30 _migrations gap):
//   node migrations/20260612_vendor_bill_hsn.js
//   then: INSERT IGNORE INTO _migrations (name) VALUES ('20260612_vendor_bill_hsn.js');
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
