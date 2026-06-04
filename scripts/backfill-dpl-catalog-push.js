/**
 * One-time: backfill dpl_catalog push state from historical item_update bulk jobs.
 * Each job_item payload carries the exact cf_dpl/rate pushed; match by zoho_item_id,
 * most-recent job wins. Run AFTER orphan cleanup so only current entries are stamped.
 *
 * Usage:
 *   node scripts/backfill-dpl-catalog-push.js [brand]          # dry-run (default birlaopus)
 *   node scripts/backfill-dpl-catalog-push.js [brand] --apply  # write
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/database').createPool();

(async () => {
    const brand = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'birlaopus';
    const apply = process.argv.includes('--apply');
    try {
        const [entries] = await pool.query(
            'SELECT id, zoho_item_id FROM dpl_catalog WHERE brand = ? AND zoho_item_id IS NOT NULL', [brand]);

        const [rows] = await pool.query(
            `SELECT j.id AS job_id, j.created_at, ji.zoho_item_id, ji.payload
             FROM zoho_bulk_job_items ji JOIN zoho_bulk_jobs j ON ji.job_id = j.id
             WHERE j.job_type = 'item_update' ORDER BY j.id ASC`);

        const latestByZid = new Map(); // zoho_item_id -> { job_id, created_at, dpl, rate }
        for (const r of rows) {
            let pl = r.payload;
            try { pl = typeof pl === 'string' ? JSON.parse(pl) : pl; } catch (e) { continue; }
            if (!pl || pl.cf_dpl == null || isNaN(Number(pl.cf_dpl))) continue;
            latestByZid.set(String(r.zoho_item_id), {
                job_id: r.job_id, created_at: r.created_at,
                dpl: Number(pl.cf_dpl), rate: pl.rate != null ? Number(pl.rate) : null,
            });
        }

        let stamped = 0; const samples = [];
        for (const e of entries) {
            const rec = latestByZid.get(String(e.zoho_item_id));
            if (!rec) continue;
            stamped++;
            if (samples.length < 15) samples.push({ id: e.id, job: rec.job_id, dpl: rec.dpl, rate: rec.rate });
            if (apply) {
                await pool.query(
                    'UPDATE dpl_catalog SET pushed_at = ?, pushed_job_id = ?, pushed_dpl = ?, pushed_rate = ? WHERE id = ?',
                    [rec.created_at, rec.job_id, rec.dpl, rec.rate, e.id]);
            }
        }

        console.log(`brand=${brand} linked=${entries.length} matched=${stamped} ${apply ? 'STAMPED' : '(DRY-RUN — pass --apply)'}`);
        console.table(samples);
        process.exit(0);
    } catch (err) { console.error('backfill error:', err.message); process.exit(1); }
})();
