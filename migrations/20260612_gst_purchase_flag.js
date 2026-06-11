/**
 * GST Reports — per-item "purchased with GST bill" flag.
 *
 * zoho_items_map.gst_purchase TINYINT(1) DEFAULT 1. Items the owner marks 0
 * ("purchased without a GST bill") are separated out in the INTERNAL cost
 * analysis report (admin-gst-reports.html). The GST FILING report ignores
 * this flag entirely — filed sales always reflect every invoice.
 *
 * Idempotent (information_schema-guarded; works on dev MySQL + prod MariaDB).
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
        `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'zoho_items_map'`
    );
    if (!tbl.length) {
        console.log('  [skip] zoho_items_map not present in this DB');
        return;
    }
    if (!(await columnExists(pool, 'zoho_items_map', 'gst_purchase'))) {
        await pool.query(
            `ALTER TABLE zoho_items_map ADD COLUMN gst_purchase TINYINT(1) NOT NULL DEFAULT 1`
        );
        console.log('  ✓ zoho_items_map.gst_purchase added');
    }
    console.log('  ✓ gst_purchase flag ensured');
};

// Direct-run support for prod (the pre-2026-04-30 _migrations gap). Run from
// the repo root:
//   node migrations/20260612_gst_purchase_flag.js
//   then: INSERT IGNORE INTO _migrations (name) VALUES ('20260612_gst_purchase_flag.js');
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
