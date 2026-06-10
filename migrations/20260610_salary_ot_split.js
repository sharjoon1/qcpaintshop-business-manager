/**
 * Phase 2 (M6) — salary OT display split.
 *
 * monthly_salaries.total_overtime_hours mixes approved weekday OT, unapproved
 * weekday OT and Sunday OT (2x-equivalent), while overtime_pay is computed from
 * APPROVED weekday OT + Sunday OT only — so the displayed hours never reconcile
 * with the paid amount. These two columns let the calc stamp the weekday split
 * so the UI can show approved (paid) vs unapproved (unpaid) hours explicitly.
 *
 * NULL = row calculated before this migration (UI falls back to the old
 * combined display). Display-only: no pay math reads these columns.
 *
 * Idempotent (information_schema existence checks — works on MySQL and MariaDB).
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
        `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'monthly_salaries'`
    );
    if (!tbl.length) {
        console.log('  [skip] monthly_salaries not present in this DB');
        return;
    }
    const wanted = [
        ['approved_overtime_hours', 'total_overtime_hours'],
        ['unapproved_overtime_hours', 'approved_overtime_hours'],
    ];
    for (const [col, after] of wanted) {
        if (await columnExists(pool, 'monthly_salaries', col)) continue;
        await pool.query(
            `ALTER TABLE monthly_salaries ADD COLUMN ${col} DECIMAL(8,2) NULL AFTER ${after}`
        );
        console.log(`  ✓ monthly_salaries.${col} added`);
    }
    console.log('  ✓ monthly_salaries approved/unapproved OT hour columns ensured');
};

// Direct-run support for prod (the pre-2026-04-30 _migrations gap). Usage:
//   node migrations/20260610_salary_ot_split.js
//   then: INSERT IGNORE INTO _migrations (name) VALUES ('20260610_salary_ot_split.js');
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
