/**
 * Zoho location + salesperson wiring (owner request 2026-06-12):
 *  - Vendor PO/bill push and sales-invoice push must let the user pick which
 *    Zoho location/branch the document posts to (defaulted from the user's
 *    branch). Add zoho_location_id/name to vendor_purchase_orders, vendor_bills
 *    and billing_invoices.
 *  - Sales-invoice push must carry a (mandatory) Zoho salesperson — the same
 *    concept already used in the painter program. Add zoho_salesperson_id/name
 *    to billing_invoices and a zoho_salespersons master table (synced from
 *    Zoho's /settings/salespersons, mirroring zoho_locations_map).
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

async function addColumn(pool, table, column, ddl) {
    if (!(await tableExists(pool, table))) {
        console.log(`  [skip] ${table} not present in this DB`);
        return;
    }
    if (!(await columnExists(pool, table, column))) {
        await pool.query(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
        console.log(`  ✓ ${table}.${column} added`);
    }
}

exports.up = async function up(pool) {
    // Location columns on the three pushable documents.
    for (const table of ['vendor_purchase_orders', 'vendor_bills', 'billing_invoices']) {
        await addColumn(pool, table, 'zoho_location_id', 'zoho_location_id VARCHAR(50) NULL');
        await addColumn(pool, table, 'zoho_location_name', 'zoho_location_name VARCHAR(255) NULL');
    }

    // Salesperson columns on sales invoices.
    await addColumn(pool, 'billing_invoices', 'zoho_salesperson_id', 'zoho_salesperson_id VARCHAR(50) NULL');
    await addColumn(pool, 'billing_invoices', 'zoho_salesperson_name', 'zoho_salesperson_name VARCHAR(255) NULL');

    // Salesperson master (synced from Zoho /settings/salespersons).
    if (!(await tableExists(pool, 'zoho_salespersons'))) {
        await pool.query(`
            CREATE TABLE zoho_salespersons (
                zoho_salesperson_id VARCHAR(50) NOT NULL,
                salesperson_name VARCHAR(255) NOT NULL,
                salesperson_email VARCHAR(255) NULL,
                is_active TINYINT(1) NOT NULL DEFAULT 1,
                last_synced_at TIMESTAMP NULL DEFAULT current_timestamp(),
                PRIMARY KEY (zoho_salesperson_id),
                KEY idx_active (is_active)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('  ✓ zoho_salespersons table created');
    }

    console.log('  ✓ Zoho location + salesperson schema ensured');
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
