/**
 * Add `not_in_zoho` flag to dpl_catalog (user marks an unmatched entry as
 * "pending creation in Zoho"). Idempotent. Kept OUT of the build upsert (_COLS)
 * so rebuilds preserve it.
 * Usage: node migrations/migrate-dpl-catalog-not-in-zoho.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/database').createPool();

async function colExists(table, col) {
    const [r] = await pool.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1`,
        [table, col]);
    return r.length > 0;
}

(async () => {
    try {
        if (await colExists('dpl_catalog', 'not_in_zoho')) {
            console.log('  exists: not_in_zoho');
        } else {
            await pool.query(`ALTER TABLE dpl_catalog ADD COLUMN not_in_zoho TINYINT(1) NOT NULL DEFAULT 0`);
            console.log('  added: not_in_zoho');
        }
        console.log('dpl_catalog not-in-zoho migration complete');
        process.exit(0);
    } catch (e) { console.error('migration error:', e.message); process.exit(1); }
})();
