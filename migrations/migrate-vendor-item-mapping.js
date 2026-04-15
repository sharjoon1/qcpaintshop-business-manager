/**
 * Vendor ↔ Item mapping — tables for auto-inferred preferred vendors.
 *
 * `item_vendor_map` is the full history: one row per (item × vendor) with
 * aggregate bill stats (count, latest rate, latest bill date). The
 * scanner re-populates it on each run.
 *
 * `zoho_items_map` gets two new columns:
 *  - preferred_vendor_id → local vendors.id that's flagged as primary
 *  - last_purchase_rate → rate from the most recent bill (used to pre-fill PO)
 *
 * Idempotent — safe to re-run.
 */
const mysql = require('mysql2/promise');
require('dotenv').config();

async function run() {
    const pool = await mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: 3
    });

    try {
        console.log('[migrate-vendor-item-mapping] START');

        // 1) item_vendor_map — history table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS item_vendor_map (
                zoho_item_id VARCHAR(50) NOT NULL,
                vendor_id INT NOT NULL,
                bill_count INT NOT NULL DEFAULT 0,
                total_qty DECIMAL(14, 3) NOT NULL DEFAULT 0,
                last_bill_date DATE NULL,
                last_bill_rate DECIMAL(14, 2) NULL,
                first_bill_date DATE NULL,
                is_primary TINYINT(1) NOT NULL DEFAULT 0,
                source ENUM('auto','manual') NOT NULL DEFAULT 'auto',
                pushed_to_zoho TINYINT(1) NOT NULL DEFAULT 0,
                pushed_at DATETIME NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (zoho_item_id, vendor_id),
                KEY idx_item (zoho_item_id),
                KEY idx_vendor (vendor_id),
                KEY idx_primary (zoho_item_id, is_primary)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✓ item_vendor_map created');

        // 2) zoho_items_map extra columns
        const [cols] = await pool.query(
            `SELECT COLUMN_NAME FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'zoho_items_map'`
        );
        const have = new Set(cols.map(c => c.COLUMN_NAME));

        if (!have.has('preferred_vendor_id')) {
            await pool.query(
                `ALTER TABLE zoho_items_map
                 ADD COLUMN preferred_vendor_id INT NULL AFTER zoho_brand,
                 ADD KEY idx_preferred_vendor (preferred_vendor_id)`
            );
            console.log('✓ zoho_items_map.preferred_vendor_id added');
        } else {
            console.log('· zoho_items_map.preferred_vendor_id already present');
        }

        if (!have.has('last_purchase_rate')) {
            await pool.query(
                `ALTER TABLE zoho_items_map
                 ADD COLUMN last_purchase_rate DECIMAL(14, 2) NULL AFTER preferred_vendor_id`
            );
            console.log('✓ zoho_items_map.last_purchase_rate added');
        } else {
            console.log('· zoho_items_map.last_purchase_rate already present');
        }

        if (!have.has('vendor_pushed_at')) {
            await pool.query(
                `ALTER TABLE zoho_items_map
                 ADD COLUMN vendor_pushed_at DATETIME NULL AFTER last_purchase_rate`
            );
            console.log('✓ zoho_items_map.vendor_pushed_at added');
        } else {
            console.log('· zoho_items_map.vendor_pushed_at already present');
        }

        // 3) vendor_purchase_orders — source tracking column (so PO-from-alert is distinguishable)
        const [poCols] = await pool.query(
            `SELECT COLUMN_NAME FROM information_schema.columns
             WHERE table_schema = DATABASE() AND table_name = 'vendor_purchase_orders'`
        );
        const poHave = new Set(poCols.map(c => c.COLUMN_NAME));
        if (!poHave.has('source')) {
            await pool.query(
                `ALTER TABLE vendor_purchase_orders
                 ADD COLUMN source VARCHAR(30) NOT NULL DEFAULT 'manual' AFTER status,
                 ADD KEY idx_source (source)`
            );
            console.log('✓ vendor_purchase_orders.source added');
        } else {
            console.log('· vendor_purchase_orders.source already present');
        }
        if (!poHave.has('source_reference')) {
            await pool.query(
                `ALTER TABLE vendor_purchase_orders
                 ADD COLUMN source_reference VARCHAR(80) NULL AFTER source`
            );
            console.log('✓ vendor_purchase_orders.source_reference added');
        } else {
            console.log('· vendor_purchase_orders.source_reference already present');
        }

        // 4) scan log
        await pool.query(`
            CREATE TABLE IF NOT EXISTS vendor_mapping_scans (
                id INT AUTO_INCREMENT PRIMARY KEY,
                started_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                completed_at DATETIME NULL,
                months_back INT NOT NULL,
                bills_fetched INT NOT NULL DEFAULT 0,
                items_mapped INT NOT NULL DEFAULT 0,
                status ENUM('running','completed','failed') NOT NULL DEFAULT 'running',
                error_message TEXT NULL,
                triggered_by INT NULL,
                KEY idx_status (status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        console.log('✓ vendor_mapping_scans created');

        console.log('[migrate-vendor-item-mapping] DONE');
    } catch (e) {
        console.error('[migrate-vendor-item-mapping] FAIL', e);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    run().then(() => process.exit(process.exitCode || 0));
}

module.exports = { run };
