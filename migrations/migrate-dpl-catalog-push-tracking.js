/**
 * Add push-tracking columns to dpl_catalog (remember last push per entry).
 * Idempotent: checks information_schema before each ADD. Kept OUT of the build
 * upsert (_COLS) so rebuilds preserve them.
 * Usage: node migrations/migrate-dpl-catalog-push-tracking.js
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
        const adds = [
            ['pushed_at', 'TIMESTAMP NULL DEFAULT NULL'],
            ['pushed_job_id', 'INT DEFAULT NULL'],
            ['pushed_dpl', 'DECIMAL(12,2) DEFAULT NULL'],
            ['pushed_rate', 'DECIMAL(12,2) DEFAULT NULL'],
        ];
        for (const [col, def] of adds) {
            if (await colExists('dpl_catalog', col)) { console.log('  exists:', col); continue; }
            await pool.query(`ALTER TABLE dpl_catalog ADD COLUMN ${col} ${def}`);
            console.log('  added:', col);
        }
        console.log('dpl_catalog push-tracking migration complete');
        process.exit(0);
    } catch (e) { console.error('migration error:', e.message); process.exit(1); }
})();
