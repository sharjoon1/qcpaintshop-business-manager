/**
 * Painter catalog — base backfill + incremental all-brands import.
 *
 * Three idempotent passes (all additive, NO deletes/deactivates):
 *
 *  A) base_key backfill  — derive pack_sizes.base_key for existing active packs
 *                          from their zoho item (SKU / normalized name, brand-aware).
 *  B) main_base_key      — set products.main_base_key where NULL (default = base
 *                          with most pack sizes; WT / lowest base number on ties).
 *  C) incremental import — create products + pack_sizes for ACTIVE Zoho items not
 *                          yet in pack_sizes (all brands). Items whose series maps
 *                          to an existing product merge into it; otherwise a new
 *                          product is created (status 'active', but INSERTed into
 *                          painter_catalog_product_order as is_hidden=1 so it stays
 *                          out of the painter catalog until the owner enables it).
 *
 * Usage:
 *   node scripts/backfill-catalog-bases.js --dry-run   # read-only report
 *   node scripts/backfill-catalog-bases.js             # live
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const { parseBase, pickMainBase, isSeriesConfident } = require('../services/catalog-base');

const DRY_RUN = process.argv.includes('--dry-run');

// ── helpers (mirror scripts/import-all-zoho-products.js) ─────────────────────
const UNIT_PATTERN = 'ltr?|litres?|liters?|kg|kgs?|ml|gm?|grams?|pc|pcs?|pieces?|m|meters?|nos|l';

function normalizeUnit(zohoUnit) {
    if (!zohoUnit) return 'L';
    const u = String(zohoUnit).toLowerCase().trim();
    if (/^(ltr?|litres?|liters?|l)$/i.test(u)) return 'L';
    if (/^(kg|kgs?)$/i.test(u)) return 'KG';
    if (/^(ml)$/i.test(u)) return 'L';
    if (/^(gm?|grams?)$/i.test(u)) return 'KG';
    if (/^(pc|pcs?|pieces?|nos|qty)$/i.test(u)) return 'PC';
    if (/^(m|meters?)$/i.test(u)) return 'M';
    return 'PC';
}

function parseSizeLabel(sizeLabel) {
    if (!sizeLabel) return { size: 1, unit: null };
    const m = String(sizeLabel).match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
    if (!m) return { size: 1, unit: null };
    const u = (m[2] || '').trim().toLowerCase();
    let unit = null;
    if (/^(l|ltr?|lt|litres?|liters?)$/i.test(u)) unit = 'L';
    else if (/^(kg|kgs?)$/i.test(u)) unit = 'KG';
    else if (/^ml$/i.test(u)) unit = 'L';
    else if (/^(gm?|grams?)$/i.test(u)) unit = 'KG';
    else if (/^(pc|pcs?|pieces?|nos)$/i.test(u)) unit = 'PC';
    return { size: parseFloat(m[1]), unit };
}

function extractSizeLabel(name) {
    const m = String(name || '').match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${UNIT_PATTERN})\\b`, 'i'));
    return m ? `${m[1]} ${m[2]}` : '';
}

function simplifyCategory(categoryName) {
    if (!categoryName) return 'General';
    const cat = String(categoryName).toUpperCase();
    if (/EMUL/i.test(cat)) return 'Emulsions';
    if (/PRIMER/i.test(cat)) return 'Primers';
    if (/ENAMEL/i.test(cat)) return 'Enamels';
    if (/TOOLS|BRUSH|ROLLER|BLADE|PAPER/i.test(cat)) return 'Tools & Accessories';
    if (/MARINE/i.test(cat)) return 'Marine Paints';
    if (/STAINER|COLORANT|COLOURANT/i.test(cat)) return 'Stainers & Colorants';
    if (/WOOD.*POLISH|SEALER|MELAM/i.test(cat)) return 'Wood Finishes';
    if (/PUTTY|WALLCARE/i.test(cat)) return 'Wall Putty & Care';
    if (/CONSTRUCTION|WATERPROOF|DAMP|CRACK|HYDROLOC/i.test(cat)) return 'Waterproofing & Construction';
    if (/FLOOR/i.test(cat)) return 'Floor Coatings';
    if (/SPRAY/i.test(cat)) return 'Spray Paints';
    if (/DISTEMPAR/i.test(cat)) return 'Distempers';
    if (/HAMMER/i.test(cat)) return 'Specialty Paints';
    if (/ACCESSORIES/i.test(cat)) return 'Tools & Accessories';
    if (/PU.*CLEAR|POLYURETHANE/i.test(cat)) return 'Wood Finishes';
    if (/SHYNE|ROYALE|APEX|ACE|TRACTOR|PREMIUM|APCOLITE|PROTEK/i.test(cat)) return 'Emulsions';
    return 'General';
}

function normalizeBrand(zohoBrand) {
    if (!zohoBrand) return 'Generic';
    const b = String(zohoBrand).trim();
    if (/^ASIAN\s*PAINT/i.test(b)) return 'Asian Paints';
    if (/^BERGER/i.test(b)) return 'Berger Paints';
    if (/^BIRLA/i.test(b)) return 'Birla Opus';
    if (/^NIPPON/i.test(b)) return 'Nippon';
    if (/^SHALIMAR/i.test(b)) return 'Shalimar Paints';
    if (/^AKZONOBEL/i.test(b)) return 'AkzoNobel';
    if (/^ADDISON/i.test(b)) return 'Addisons';
    if (/^CUMI/i.test(b)) return 'Cumi';
    if (/^CRIZON/i.test(b)) return 'Crizon';
    if (/^ASTRAL/i.test(b)) return 'Astral Paints';
    if (/^GENERIC$/i.test(b)) return 'Generic';
    return b;
}

function isAreaWise(productName, categoryName) {
    const combined = `${productName || ''} ${categoryName || ''}`.toLowerCase();
    if (/primer/i.test(combined)) return true;
    if (/emul/i.test(combined)) return true;
    if (/distempar|distemper/i.test(combined)) return true;
    if (/\b(apex|ace\s+shyne|royale|tractor\s+shyne|tractor\s+emul|tractor\s+sparc|tractor\s+suprema|premium\s+emul|apcolite.*shyne|apcolite.*protek|plaster\s*coat)\b/i.test(combined)) return true;
    if (/\b(berger\s+emulsion|opus\s+emulsion|opus\s+distempar)\b/i.test(combined)) return true;
    if (/\bshyne\b/i.test(combined) && !/enamel/i.test(combined)) return true;
    return false;
}

// ── main ─────────────────────────────────────────────────────────────────────
(async () => {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'business_manager',
        port: parseInt(process.env.DB_PORT, 10) || 3306
    });

    console.log(`\n${'='.repeat(64)}`);
    console.log(`  CATALOG BASE BACKFILL + ALL-BRANDS INCREMENTAL IMPORT ${DRY_RUN ? '(DRY RUN)' : '(LIVE)'}`);
    console.log(`${'='.repeat(64)}\n`);

    // 1) Active Zoho items
    const [zohoItems] = await pool.query(
        `SELECT zoho_item_id, zoho_item_name, zoho_rate, zoho_unit, zoho_brand,
                zoho_category_name, local_product_id
         FROM zoho_items_map WHERE zoho_status = 'active' OR zoho_status IS NULL`
    );
    console.log(`Active Zoho items: ${zohoItems.length}`);

    // 2) Existing pack_sizes (all, so we can tell mapped from unmapped)
    const [packs] = await pool.query(
        `SELECT ps.id, ps.product_id, ps.zoho_item_id, ps.is_active
         FROM pack_sizes ps WHERE ps.zoho_item_id IS NOT NULL`
    );
    const mappedItemIds = new Set(packs.map((p) => p.zoho_item_id));
    console.log(`Existing pack_sizes with zoho_item_id: ${packs.length}`);

    // 3) Existing products
    const [products] = await pool.query(
        `SELECT p.id, p.name, p.status, p.product_type, p.brand_id, p.category_id,
                b.name AS brand_name, c.name AS category_name
         FROM products p LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN categories c ON c.id = p.category_id`
    );
    const productById = new Map(products.map((p) => [p.id, p]));

    // 4) Brand / category caches
    const [brandRows] = await pool.query('SELECT id, name FROM brands');
    const brandId = new Map(brandRows.map((r) => [r.name.toUpperCase(), r.id]));
    const [catRows] = await pool.query('SELECT id, name FROM categories');
    const catId = new Map(catRows.map((r) => [r.name.toUpperCase(), r.id]));

    // 5) Series → product map (existing products keyed by the series of their packs)
    const itemInfo = new Map(); // zoho_item_id -> {series, baseKey, brand, category}
    for (const it of zohoItems) {
        const { series, baseKey } = parseBase(it.zoho_item_name, null, it.zoho_brand);
        itemInfo.set(it.zoho_item_id, {
            series,
            baseKey,
            brand: normalizeBrand(it.zoho_brand),
            category: simplifyCategory(it.zoho_category_name),
        });
    }
    // For existing packs: map (series|||brand|||category) -> productId (most common)
    const seriesToProduct = new Map();
    const seriesCount = new Map();
    for (const p of packs) {
        const info = itemInfo.get(p.zoho_item_id);
        if (!info || !info.series) continue;
        const prod = productById.get(p.product_id);
        if (!prod || prod.status !== 'active') continue;
        const key = `${info.series}|||${info.brand}|||${info.category}`;
        const cur = seriesCount.get(key) || 0;
        seriesCount.set(key, cur + 1);
        if (!seriesToProduct.has(key) || seriesCount.get(key) > seriesToProduct.get(key).count) {
            seriesToProduct.set(key, { product_id: p.product_id, count: seriesCount.get(key) });
        }
    }
    console.log(`Series keys with existing product coverage: ${seriesToProduct.size}`);

    // ── PASS A: base_key backfill ────────────────────────────────────────────
    let aUpdated = 0, aSkipped = 0;
    for (const p of packs) {
        if (!p.is_active) continue;
        const prod = productById.get(p.product_id);
        if (!prod || prod.product_type !== 'area_wise') { aSkipped++; continue; } // enamels/colours stay flat
        const info = itemInfo.get(p.zoho_item_id);
        if (!info || !info.baseKey) { aSkipped++; continue; }
        if (DRY_RUN) { aUpdated++; continue; }
        const [r] = await pool.query(
            'UPDATE pack_sizes SET base_key = ? WHERE id = ? AND base_key IS NULL', [info.baseKey, p.id]);
        if (r.affectedRows) aUpdated++; else aSkipped++;
    }
    console.log(`\n[PASS A] base_key backfill: ${aUpdated} packs updated, ${aSkipped} no-base/dup`);

    // ── PASS C: incremental import for unmapped items ───────────────────────
    let cCreated = 0, cMerged = 0, cSkipped = 0;
    const createdProductIds = [];
    const newPackRows = []; // {product_id, size, unit, base_price, zoho_item_id, base_key}
    const newMappings = []; // {zoho_item_id, product_id}
    const pendingProductCreates = []; // {name, brand_id, category_id, product_type, base_price, area_coverage}

    const itemToProduct = new Map(); // resolved product for unmapped item (this run)
    for (const it of zohoItems) {
        const id = it.zoho_item_id;
        if (mappedItemIds.has(id)) continue; // already imported
        const info = itemInfo.get(id);
        if (!info || !isSeriesConfident(info.series, it.zoho_brand)) { cSkipped++; continue; }

        // resolve product
        let productId = itemToProduct.get(id);
        if (!productId && it.local_product_id && productById.has(it.local_product_id)) {
            productId = it.local_product_id; // item was manually mapped to an existing product
        }
        if (!productId && info.series) {
            const key = `${info.series}|||${info.brand}|||${info.category}`;
            const hit = seriesToProduct.get(key);
            if (hit) productId = hit.product_id;
        }
        if (!productId) {
            // need a new product — brand/category lookup or create
            let bid = brandId.get(info.brand.toUpperCase());
            if (!bid) {
                if (!DRY_RUN) {
                    const [br] = await pool.query('INSERT INTO brands (name, status) VALUES (?, ?)', [info.brand, 'active']);
                    bid = br.insertId;
                    brandId.set(info.brand.toUpperCase(), bid);
                } else {
                    bid = -1; // placeholder in dry-run
                }
            }
            let cid = catId.get(info.category.toUpperCase());
            if (!cid) {
                if (!DRY_RUN) {
                    const [cr] = await pool.query('INSERT INTO categories (name, status) VALUES (?, ?)', [info.category, 'active']);
                    cid = cr.insertId;
                    catId.set(info.category.toUpperCase(), cid);
                } else {
                    cid = -1;
                }
            }
            const areaWise = isAreaWise(info.series, it.zoho_category_name);
            const pname = info.series;
            if (!DRY_RUN) {
                const [pr] = await pool.query(
                    `INSERT INTO products (name, brand_id, category_id, product_type, base_price, status, is_gst_inclusive)
                     VALUES (?, ?, ?, ?, ?, 'active', 1)`,
                    [pname, bid, cid, areaWise ? 'area_wise' : 'unit_wise', it.zoho_rate || 0]
                );
                productId = pr.insertId;
                // keep new products OUT of the painter catalog until the owner enables them
                await pool.query(
                    `INSERT INTO painter_catalog_product_order (product_id, sort_order, is_hidden)
                     VALUES (?, 999, 1)`, [productId]);
                createdProductIds.push(productId);
            } else {
                productId = -(pendingProductCreates.length + 1); // negative placeholder
                pendingProductCreates.push({ name: pname, areaWise });
            }
            cCreated++;
        } else {
            cMerged++;
        }

        // Remember this resolution so later items of the same series merge too
        if (productId && info.series) {
            const key = `${info.series}|||${info.brand}|||${info.category}`;
            const cur = seriesToProduct.get(key);
            if (!cur || cur.product_id !== productId) {
                seriesToProduct.set(key, { product_id: productId, count: (cur ? cur.count : 0) + 1 });
            }
        }

        // pack_size row — base_key only makes sense for area_wise (emulsion) products
        const areaWiseProd = productById.has(productId)
            ? productById.get(productId).product_type === 'area_wise'
            : isAreaWise(info.series, it.zoho_category_name);
        const baseKeyForPack = areaWiseProd ? info.baseKey : null;
        const sizeLabel = extractSizeLabel(it.zoho_item_name);
        const { size, unit } = parseSizeLabel(sizeLabel);
        const finalUnit = unit || normalizeUnit(it.zoho_unit);
        if (!DRY_RUN) {
            await pool.query(
                `INSERT INTO pack_sizes (product_id, size, unit, base_price, zoho_item_id, is_active, base_key)
                 VALUES (?, ?, ?, ?, ?, 1, ?)`,
                [productId, size, finalUnit, it.zoho_rate || 0, id, baseKeyForPack]
            );
            await pool.query('UPDATE zoho_items_map SET local_product_id = ? WHERE zoho_item_id = ?', [productId, id]);
        } else {
            newPackRows.push({ product_id: productId, size, unit: finalUnit, base_price: it.zoho_rate || 0, zoho_item_id: id, base_key: baseKeyForPack });
            newMappings.push({ zoho_item_id: id, product_id: productId });
        }
    }

    console.log(`\n[PASS C] incremental import: ${cCreated} new products, ${cMerged} merged into existing, ${cSkipped} skipped (no series)`);
    if (DRY_RUN) {
        console.log(`  (dry-run placeholders — new products would be: ${pendingProductCreates.length}, new packs: ${newPackRows.length})`);
    }

    // ── PASS B (final): main_base_key defaults over the COMPLETE pack set ───
    // Live: re-read pack_sizes so newly imported (merged) packs are included.
    // Dry-run: combine the snapshot packs with the planned new packs.
    const finalPacks = DRY_RUN
        ? packs.concat(newPackRows.map((np) => ({ product_id: np.product_id, zoho_item_id: np.zoho_item_id, is_active: 1 })))
        : (await pool.query('SELECT id, product_id, zoho_item_id, is_active FROM pack_sizes'))[0];
    const activeProducts = (DRY_RUN ? products : (await pool.query(`SELECT * FROM products`))[0])
        .filter((p) => p.status === 'active');
    let bSet = 0, bSkip = 0;
    for (const prod of activeProducts) {
        if (prod.product_type !== 'area_wise') { bSkip++; continue; } // enamels/colours stay flat
        const allPacks = finalPacks.filter((p) => p.product_id === prod.id);
        const keys = allPacks.map((p) => (itemInfo.get(p.zoho_item_id) || {}).baseKey);
        const main = pickMainBase(keys);
        if (!main) { bSkip++; continue; }
        if (DRY_RUN) { bSet++; continue; }
        const [r] = await pool.query(
            'UPDATE products SET main_base_key = ? WHERE id = ?', [main, prod.id]);
        if (r.affectedRows) bSet++; else bSkip++;
    }
    console.log(`[PASS B] main_base_key defaults (final): ${bSet} products set, ${bSkip} single/no-base`);

    if (DRY_RUN && process.argv.includes('--sample')) {
        console.log(`\n=== SAMPLE MERGE TARGETS (top 25 by series) ===`);
        const mergeBySeries = new Map(); // series -> { product, count }
        for (const it of zohoItems) {
            const id = it.zoho_item_id;
            if (mappedItemIds.has(id)) continue;
            const info = itemInfo.get(id);
            if (!info || !isSeriesConfident(info.series, it.zoho_brand)) continue;
            let productId = it.local_product_id && productById.has(it.local_product_id) ? it.local_product_id : null;
            if (!productId) {
                const key = `${info.series}|||${info.brand}|||${info.category}`;
                const hit = seriesToProduct.get(key);
                if (hit) productId = hit.product_id;
            }
            if (!productId) continue;
            const prod = productById.get(productId);
            if (!mergeBySeries.has(info.series)) mergeBySeries.set(info.series, { product: prod ? prod.name : ('#' + productId), count: 0 });
            mergeBySeries.get(info.series).count++;
        }
        const sorted = [...mergeBySeries.entries()].sort((a, b) => b[1].count - a[1].count);
        for (const [series, { product, count }] of sorted.slice(0, 25)) {
            console.log(`  ${String(series).padEnd(42)} -> "${String(product).slice(0, 38)}"  x${count}`);
        }
        console.log(`\n=== SAMPLE NEW PRODUCT SERIES (top 25) ===`);
        for (const g of pendingProductCreates.slice(0, 25)) {
            console.log(`  ${String(g.name).slice(0, 70)}  [${g.areaWise ? 'area_wise' : 'unit_wise'}]`);
        }
    }

    console.log(`\n${'='.repeat(64)}`);
    console.log(`  DONE ${DRY_RUN ? '(DRY RUN — no writes)' : '(LIVE)'}`);
    console.log(`${'='.repeat(64)}\n`);
    await pool.end();
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
