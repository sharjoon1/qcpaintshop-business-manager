/**
 * Audit + resume log for the one-time Asian Paints vendor-item consolidation
 * (scripts/consolidate-asian-items.js).
 *
 * Vendor-pushed "ASIAN PAINTS" items are category-locked for the owner. For the
 * 46 of them that still hold stock we create an owner-editable replacement item,
 * move the stock across with paired inventory adjustments, then deactivate the
 * old vendor item. One row per OLD item records what happened, so a partially
 * failed run can be re-run safely (completed rows are skipped) and any half-done
 * item is recoverable by hand from stock_migrated_json.
 *
 * Additive + idempotent (house rules): guarded by an information_schema
 * tableExists check so re-running is a no-op. No destructive DDL. This is a NEW
 * table only — it does not touch zoho_items_map / zoho_location_stock or any
 * other no-DDL Zoho map table.
 */

const TABLE = 'zoho_item_consolidation_log';

async function tableExists(pool, table) {
    const [rows] = await pool.query(
        `SELECT 1 FROM information_schema.TABLES
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? LIMIT 1`,
        [table]
    );
    return rows.length > 0;
}

exports.up = async function up(pool) {
    if (await tableExists(pool, TABLE)) {
        console.log(`  [ok] ${TABLE} already exists`);
        return;
    }

    await pool.query(`
        CREATE TABLE ${TABLE} (
            id                  INT AUTO_INCREMENT PRIMARY KEY,
            old_item_id         VARCHAR(50)  NOT NULL,
            new_item_id         VARCHAR(50)  DEFAULT NULL,
            old_sku             VARCHAR(100) DEFAULT NULL,
            new_sku             VARCHAR(100) DEFAULT NULL,
            category_assigned   VARCHAR(100) DEFAULT NULL,
            stock_migrated_json TEXT         DEFAULT NULL,
            status              ENUM('pending','completed','failed') NOT NULL DEFAULT 'pending',
            error_message       TEXT         DEFAULT NULL,
            created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
            completed_at        DATETIME     DEFAULT NULL,
            UNIQUE KEY uk_old_item_id (old_item_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    console.log(`  ✓ ${TABLE} created`);
};

// Exposed for unit tests.
exports.tableExists = tableExists;
exports.TABLE = TABLE;

// Direct-run support for prod (the pre-2026-04-30 _migrations gap):
//   node migrations/20260731_zoho_item_consolidation_log.js
//   then: INSERT IGNORE INTO _migrations (name) VALUES ('20260731_zoho_item_consolidation_log.js');
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
