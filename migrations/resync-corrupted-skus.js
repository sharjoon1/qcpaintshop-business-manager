/**
 * One-time fix: re-fetch SKUs for items whose local mirror was corrupted by
 * a failed bulk-edit (the optimistic local write set duplicate SKUs across
 * several distinct Zoho items, then the Zoho push rejected the duplicates).
 *
 * Strategy: detect the corruption (same zoho_sku used by 2+ rows in
 * zoho_items_map for ACTIVE items), then for each affected zoho_item_id
 * call Zoho's GET /items/{id} and rewrite zoho_sku from the source of
 * truth. Also restore zoho_item_name + zoho_cf_dpl + zoho_cf_product_name
 * while we're here, since those are equally susceptible to the same bug.
 *
 * Idempotent. Run with:
 *   node migrations/resync-corrupted-skus.js
 *   node migrations/resync-corrupted-skus.js --dry
 *   node migrations/resync-corrupted-skus.js --ids=2032688000001417274,2032688000001417255
 */
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const zoho = require('../services/zoho-api');

const DRY = process.argv.includes('--dry');
const idsArg = process.argv.find(a => a.startsWith('--ids='));

async function main() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'business_manager',
        port: process.env.DB_PORT || 3306,
    });
    zoho.setPool(pool);

    let ids;
    if (idsArg) {
        ids = idsArg.replace('--ids=', '').split(',').map(s => s.trim()).filter(Boolean);
        console.log(`Re-syncing ${ids.length} explicit id(s):`, ids);
    } else {
        // Detect: SKUs used by 2+ ACTIVE items.
        const [groups] = await pool.query(`
            SELECT zoho_sku, GROUP_CONCAT(zoho_item_id) AS ids, COUNT(*) AS n
              FROM zoho_items_map
             WHERE zoho_status = 'active'
               AND zoho_sku IS NOT NULL
               AND zoho_sku <> ''
             GROUP BY zoho_sku
            HAVING n > 1
             ORDER BY n DESC
        `);
        if (!groups.length) {
            console.log('No duplicate-SKU groups found in active items. Nothing to do.');
            await pool.end();
            return;
        }
        console.log(`Found ${groups.length} duplicate-SKU group(s):`);
        groups.forEach(g => console.log(`  · ${g.zoho_sku} → ${g.n} items`));
        ids = groups.flatMap(g => String(g.ids).split(','));
    }

    let fixed = 0, unchanged = 0, missing = 0, errors = 0;
    for (const itemId of ids) {
        let resp;
        try {
            resp = await zoho.getItem(itemId);
        } catch (e) {
            console.log(`  ✗ ${itemId} — Zoho fetch failed: ${e.message}`);
            errors++;
            continue;
        }
        const item = resp && (resp.item || resp.data || resp);
        if (!item || !item.item_id) {
            console.log(`  ? ${itemId} — empty/unknown response`);
            missing++;
            continue;
        }
        // Pull authoritative fields from Zoho. cf_dpl lives under custom_fields[].
        let cfDpl = null;
        if (Array.isArray(item.custom_fields)) {
            const f = item.custom_fields.find(x => x && (x.api_name === 'cf_dpl' || x.label === 'DPL'));
            if (f && f.value != null && f.value !== '') cfDpl = String(f.value);
        }
        let cfProductName = null;
        if (Array.isArray(item.custom_fields)) {
            const f = item.custom_fields.find(x => x && (x.api_name === 'cf_product_name' || x.label === 'Product Name'));
            if (f && f.value != null && f.value !== '') cfProductName = String(f.value);
        }

        const newSku  = String(item.sku  || '').trim();
        const newName = String(item.name || '').trim();
        if (!newSku) { console.log(`  ? ${itemId} — Zoho returned no SKU`); missing++; continue; }

        // Read current local row so we can log the diff.
        const [[cur]] = await pool.query(`SELECT zoho_sku, zoho_item_name, zoho_cf_dpl, zoho_cf_product_name FROM zoho_items_map WHERE zoho_item_id = ?`, [itemId]);
        if (!cur) { console.log(`  ? ${itemId} — not in local mirror`); missing++; continue; }

        const skuChanged  = (cur.zoho_sku  || '') !== newSku;
        const nameChanged = (cur.zoho_item_name || '') !== newName;
        const cfDplChanged = cfDpl != null && (cur.zoho_cf_dpl || '') !== cfDpl;
        const cfProdChanged = cfProductName != null && (cur.zoho_cf_product_name || '') !== cfProductName;
        if (!skuChanged && !nameChanged && !cfDplChanged && !cfProdChanged) {
            console.log(`  · ${itemId} unchanged (${newSku} · ${newName})`);
            unchanged++;
            continue;
        }
        const before = `${cur.zoho_sku} · ${cur.zoho_item_name}`;
        const after  = `${newSku} · ${newName}`;
        console.log(`  → ${itemId} ${before} ➜ ${after}` + (cfDplChanged ? ` [cf_dpl ${cur.zoho_cf_dpl||'∅'}→${cfDpl}]` : ''));

        if (DRY) { fixed++; continue; }
        await pool.query(
            `UPDATE zoho_items_map
                SET zoho_sku = ?,
                    zoho_item_name = ?,
                    zoho_cf_dpl = COALESCE(?, zoho_cf_dpl),
                    zoho_cf_product_name = COALESCE(?, zoho_cf_product_name)
              WHERE zoho_item_id = ?`,
            [newSku, newName, cfDpl, cfProductName, itemId]
        );
        fixed++;
    }

    console.log(`\n${DRY ? '[dry run] ' : ''}Done. fixed=${fixed} unchanged=${unchanged} missing=${missing} errors=${errors}`);
    await pool.end();
}

main().catch(err => { console.error(err); process.exit(1); });
