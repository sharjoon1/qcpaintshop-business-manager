/**
 * One-time: repair drifted canonical fields. For each LINKED catalog entry whose
 * canonical_sku no longer equals the recomputed (linked-item) sku, rewrite the
 * canonical name/sku/description from the current linked Zoho item.
 *
 * Usage:
 *   node scripts/reconcile-dpl-catalog.js [brand]            # dry-run (default brand birlaopus)
 *   node scripts/reconcile-dpl-catalog.js [brand] --apply    # write changes
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/database').createPool();
const svc = require('../services/dpl-catalog');
svc.setPool(pool);

(async () => {
    const brand = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'birlaopus';
    const apply = process.argv.includes('--apply');
    try {
        const [entries] = await pool.query(
            'SELECT * FROM dpl_catalog WHERE brand = ? AND zoho_item_id IS NOT NULL', [brand]);
        const zids = [...new Set(entries.map(e => String(e.zoho_item_id)))];
        const zById = new Map();
        if (zids.length) {
            const [z] = await pool.query(
                `SELECT zoho_item_id, zoho_sku, zoho_description, zoho_category_name
                 FROM zoho_items_map WHERE zoho_item_id IN (${zids.map(() => '?').join(',')})`, zids);
            z.forEach(r => zById.set(String(r.zoho_item_id), r));
        }
        let drifted = 0, fixed = 0; const samples = [];
        for (const e of entries) {
            const z = zById.get(String(e.zoho_item_id));
            if (!z) continue;
            let c;
            try { c = svc.reconcileCanonical(e, z); } catch (err) { console.error('row', e.id, 'failed:', err.message); continue; }
            const cur = String(e.canonical_sku || '').toUpperCase();
            const want = String(c.canonical_sku || '').toUpperCase();
            if (cur === want) continue;
            drifted++;
            if (samples.length < 15) samples.push({ id: e.id, item: `${e.product_name} ${e.base_name}`.trim(), from: e.canonical_sku, to: c.canonical_sku });
            if (apply) {
                await pool.query(
                    'UPDATE dpl_catalog SET canonical_name = ?, canonical_sku = ?, canonical_description = ? WHERE id = ?',
                    [c.canonical_name, c.canonical_sku, c.canonical_description, e.id]);
                fixed++;
            }
        }
        console.log(`brand=${brand} linked=${entries.length} drifted=${drifted} ${apply ? ('fixed=' + fixed) : '(DRY-RUN — pass --apply to write)'}`);
        console.table(samples);
        process.exit(0);
    } catch (err) { console.error('reconcile error:', err.message); process.exit(1); }
})();
