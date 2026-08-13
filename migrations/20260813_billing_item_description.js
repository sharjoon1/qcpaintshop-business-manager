/**
 * B1.1 owner feedback #6 — printable per-line item description.
 *
 * Additive-only and information_schema-guarded (dev MySQL vs prod MariaDB —
 * deliberately NO "IF NOT EXISTS" clauses) so the migration is safe to re-run.
 * Pattern: migrations/20260812_billing_quick_sale.js.
 *
 *   billing_invoice_items.description — printable line description, prefilled
 *     from zoho_items_map.zoho_description (fallback item_name) in the UI and
 *     editable per line. Print templates render description when present,
 *     else item_name (never both). NULL for all pre-existing rows.
 *
 * billing_invoice_items is a repo-owned table (created by
 * migrations/migrate-billing.js) — NOT one of the no-DDL Zoho map tables.
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

async function addColumn(pool, table, column, ddl) {
    if (!(await columnExists(pool, table, column))) {
        await pool.query(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
        console.log(`  ✓ ${table}.${column} added`);
    }
}

exports.up = async function up(pool) {
    if (await tableExists(pool, 'billing_invoice_items')) {
        await addColumn(pool, 'billing_invoice_items', 'description',
            'description TEXT NULL');
        console.log('  ✓ billing_invoice_items.description ensured');
    } else {
        console.log('  [skip] billing_invoice_items not present in this DB');
    }

    console.log('  ✓ billing item-description foundations ensured');
};

// Direct-run support for prod (the pre-2026-04-30 _migrations gap):
//   node migrations/20260813_billing_item_description.js
//   then: INSERT IGNORE INTO _migrations (name) VALUES ('20260813_billing_item_description.js');
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
