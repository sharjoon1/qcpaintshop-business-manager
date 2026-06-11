/**
 * PO → Bill conversion linkage (owner flow 2026-06-12): a vendor_bill created
 * from a purchase order carries the PO id so conversion is one-shot (the
 * convert endpoint refuses a second bill for the same PO) and traceable.
 * The PO side reuses the existing status enum ('received' = converted).
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

async function indexExists(pool, table, index) {
    const [rows] = await pool.query(
        `SELECT 1 FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
        [table, index]
    );
    return rows.length > 0;
}

exports.up = async function up(pool) {
    const [tbl] = await pool.query(
        `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'vendor_bills'`
    );
    if (!tbl.length) {
        console.log('  [skip] vendor_bills not present in this DB');
        return;
    }
    if (!(await columnExists(pool, 'vendor_bills', 'po_id'))) {
        await pool.query(
            `ALTER TABLE vendor_bills ADD COLUMN po_id INT NULL AFTER vendor_id`
        );
        console.log('  ✓ vendor_bills.po_id added');
    }
    if (!(await indexExists(pool, 'vendor_bills', 'idx_po_id'))) {
        await pool.query(
            `ALTER TABLE vendor_bills ADD INDEX idx_po_id (po_id)`
        );
        console.log('  ✓ vendor_bills idx_po_id added');
    }
    console.log('  ✓ vendor PO→bill link ensured');
};

// Direct-run support for prod (the pre-2026-04-30 _migrations gap):
//   node migrations/20260612_vendor_po_bill_link.js
//   then: INSERT IGNORE INTO _migrations (name) VALUES ('20260612_vendor_po_bill_link.js');
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
