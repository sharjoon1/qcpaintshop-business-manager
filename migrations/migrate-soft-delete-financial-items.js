/**
 * Soft-delete columns on financial sub-rows (U18)
 *
 * Adds `deleted_at TIMESTAMP NULL DEFAULT NULL` to the four item-tables
 * that today are hard-deleted on every estimate/invoice update. After
 * this migration the application stops issuing DELETE FROM and instead
 * writes UPDATE ... SET deleted_at = NOW(), preserving the historical
 * row for audit and dispute resolution.
 *
 * Read paths gain a `WHERE deleted_at IS NULL` filter (see code).
 *
 * MariaDB 10.11 supports IF NOT EXISTS on ADD COLUMN; we use the
 * INFORMATION_SCHEMA check pattern instead for portability.
 */
const TABLES = [
    'billing_estimate_items',
    'billing_invoice_items',
    'painter_estimate_items',
    'estimate_items',
];

async function hasColumn(pool, table, column) {
    const [rows] = await pool.query(
        `SELECT COUNT(*) AS n
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
    );
    return rows[0].n > 0;
}

async function tableExists(pool, table) {
    const [rows] = await pool.query("SHOW TABLES LIKE ?", [table]);
    return rows.length > 0;
}

async function up(pool) {
    for (const t of TABLES) {
        if (!(await tableExists(pool, t))) {
            console.log(`  ${t} not present — skipping`);
            continue;
        }
        if (await hasColumn(pool, t, 'deleted_at')) {
            console.log(`  ${t}.deleted_at already exists — skipping`);
            continue;
        }
        await pool.query(
            `ALTER TABLE \`${t}\`
             ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL,
             ADD INDEX idx_${t}_deleted_at (deleted_at),
             ALGORITHM=INPLACE, LOCK=NONE`
        );
        console.log(`  Added deleted_at to ${t}`);
    }
}

module.exports = { up };
