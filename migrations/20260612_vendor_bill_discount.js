/**
 * Vendor bill/PO financial model (owner decision 2026-06-12):
 *   subtotal = Σ(qty × DPL)  →  − total discount  →  taxable  →  + GST (18%)  →  grand
 * Adds a single bill-level discount_amount (sum of all the bill's discounts,
 * applied before GST — never item-wise) to vendor_bills and
 * vendor_purchase_orders.
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

async function tableExists(pool, table) {
    const [rows] = await pool.query(
        `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [table]
    );
    return rows.length > 0;
}

exports.up = async function up(pool) {
    for (const table of ['vendor_bills', 'vendor_purchase_orders']) {
        if (!(await tableExists(pool, table))) {
            console.log(`  [skip] ${table} not present in this DB`);
            continue;
        }
        if (!(await columnExists(pool, table, 'discount_amount'))) {
            await pool.query(
                `ALTER TABLE ${table} ADD COLUMN discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER tax_amount`
            );
            console.log(`  ✓ ${table}.discount_amount added`);
        }
    }
    console.log('  ✓ vendor bill/PO discount column ensured');
};

// Direct-run support for prod (the pre-2026-04-30 _migrations gap):
//   node migrations/20260612_vendor_bill_discount.js
//   then: INSERT IGNORE INTO _migrations (name) VALUES ('20260612_vendor_bill_discount.js');
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
