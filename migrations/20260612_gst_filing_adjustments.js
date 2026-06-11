/**
 * GST Reports — carry-forward of missed B2B invoices.
 *
 * GSTR-1 permits reporting an invoice missed in its own period in a later
 * month's return. gst_filing_adjustments records that owner decision: the
 * invoice then appears ONLY in its filed_in_month on the filing report
 * (clearly marked "carried forward"), never double-counted in both months.
 *
 * Idempotent.
 */

exports.up = async function up(pool) {
    await pool.query(
        `CREATE TABLE IF NOT EXISTS gst_filing_adjustments (
            zoho_invoice_id VARCHAR(50) NOT NULL,
            original_month CHAR(7) NOT NULL,
            filed_in_month CHAR(7) NOT NULL,
            note VARCHAR(255) NULL,
            created_by INT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (zoho_invoice_id),
            KEY idx_filed_in (filed_in_month)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
    );
    console.log('  ✓ gst_filing_adjustments table ensured');
};

// Direct-run support for prod (the pre-2026-04-30 _migrations gap). Run from
// the repo root:
//   node migrations/20260612_gst_filing_adjustments.js
//   then: INSERT IGNORE INTO _migrations (name) VALUES ('20260612_gst_filing_adjustments.js');
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
