/**
 * BULK IMPORT: All Zoho items → grouped products + pack_sizes
 *
 * Logic:
 * 1. Fetch all active items from zoho_items_map
 * 2. Extract product name (strip SKU code + size) using same logic as frontend
 * 3. Group by (productName + brand)
 * 4. Primer/Emulsion categories → area_wise, others → unit_wise
 * 5. Create brands, categories, products, pack_sizes
 * 6. Map zoho_items_map.local_product_id
 *
 * Usage: node scripts/import-all-zoho-products.js [--dry-run]
 */

require('dotenv').config();
const mysql = require('mysql2/promise');

const DRY_RUN = process.argv.includes('--dry-run');

// ─── Product name extraction (mirrors frontend extractProductInfoJS) ──────────

const UNIT_PATTERN = 'ltr?|litres?|liters?|kg|kgs?|ml|gm?|grams?|pc|pcs?|pieces?|m|meters?|nos|l';
const SKU_REGEX = /^[A-Z]{2,6}\d{1,4}\s+/i;

function extractProductInfo(itemName, cfProductName) {
    if (!itemName) return { productName: itemName, sizeLabel: '' };

    const unitRegex = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(${UNIT_PATTERN})\\b`, 'i');

    // 1. Custom field override
    if (cfProductName && cfProductName.trim()) {
        const sizeMatch = itemName.match(unitRegex);
        return {
            productName: cfProductName.trim(),
            sizeLabel: sizeMatch ? `${sizeMatch[1]} ${sizeMatch[2]}` : ''
        };
    }

    // Strip SKU code prefix (e.g., "IPR01 ", "AF04 ", "E08 ")
    let cleaned = itemName.replace(SKU_REGEX, '').trim();
    if (!cleaned) cleaned = itemName;

    // 2. Suffix pattern: "Product Name 4 Ltr" or "Product Name 10 LT"
    const suffixMatch = cleaned.match(new RegExp(`^(.+?)\\s+(\\d+(?:\\.\\d+)?)\\s*(${UNIT_PATTERN})\\s*$`, 'i'));
    if (suffixMatch) {
        return {
            productName: suffixMatch[1].trim(),
            sizeLabel: `${suffixMatch[2]} ${suffixMatch[3]}`
        };
    }

    // 3. Prefix pattern: "4 Ltr Product Name"
    const prefixMatch = cleaned.match(new RegExp(`^(\\d+(?:\\.\\d+)?)\\s*(${UNIT_PATTERN})\\s+(.+)$`, 'i'));
    if (prefixMatch) {
        return {
            productName: prefixMatch[3].trim(),
            sizeLabel: `${prefixMatch[1]} ${prefixMatch[2]}`
        };
    }

    // 4. Prefix number only: "100 AJAX PAPER"
    const numPrefixMatch = cleaned.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
    if (numPrefixMatch) {
        return {
            productName: numPrefixMatch[2].trim(),
            sizeLabel: numPrefixMatch[1]
        };
    }

    // 5. Fallback: just use the cleaned name
    return { productName: cleaned, sizeLabel: '' };
}

// ─── Unit normalization ──────────────────────────────────────────────────────

function normalizeUnit(zohoUnit) {
    if (!zohoUnit) return 'L';
    const u = zohoUnit.toLowerCase().trim();
    if (/^(ltr?|litres?|liters?|l)$/i.test(u)) return 'L';
    if (/^(kg|kgs?)$/i.test(u)) return 'KG';
    if (/^(ml)$/i.test(u)) return 'L';   // ML → L (size is in ml)
    if (/^(gm?|grams?)$/i.test(u)) return 'KG'; // GM → KG
    if (/^(pc|pcs?|pieces?|nos|qty)$/i.test(u)) return 'PC';
    if (/^(m|meters?)$/i.test(u)) return 'M';
    return 'PC'; // default to PC for unknown units
}

// ─── Parse size from size label ──────────────────────────────────────────────

function parseSize(sizeLabel) {
    if (!sizeLabel) return { size: 1, unitFromLabel: null };
    const match = sizeLabel.match(/^(\d+(?:\.\d+)?)\s*(.*)?$/);
    if (match) {
        const unitStr = (match[2] || '').trim();
        let unitFromLabel = null;
        if (/^(ltr?|lt|litres?|liters?|l)$/i.test(unitStr)) unitFromLabel = 'L';
        else if (/^(kg|kgs?)$/i.test(unitStr)) unitFromLabel = 'KG';
        else if (/^(ml)$/i.test(unitStr)) unitFromLabel = 'L';
        else if (/^(gm?|grams?)$/i.test(unitStr)) unitFromLabel = 'KG';
        else if (/^(pc|pcs?|pieces?|nos)$/i.test(unitStr)) unitFromLabel = 'PC';
        else if (/^(m|meters?)$/i.test(unitStr)) unitFromLabel = 'M';

        let size = parseFloat(match[1]);
        // Convert ML to L (e.g., 500 ML → 0.5 L, 900 ML → 0.9 L)
        if (/^ml$/i.test(unitStr)) {
            size = size / 1000;
        }
        // Convert GM to KG
        if (/^(gm?|grams?)$/i.test(unitStr)) {
            size = size / 1000;
        }

        return { size, unitFromLabel };
    }
    return { size: 1, unitFromLabel: null };
}

// ─── Determine if product is area_wise (primer/emulsion) ─────────────────────

function isAreaWise(productName, categoryName) {
    const combined = `${productName || ''} ${categoryName || ''}`.toLowerCase();
    // Primer keywords
    if (/primer/i.test(combined)) return true;
    // Emulsion keywords
    if (/emul/i.test(combined)) return true;
    // Distemper (wall paint)
    if (/distempar|distemper/i.test(combined)) return true;
    // Known emulsion product ranges (Asian Paints, Berger, Birla Opus)
    // These are wall paints sold by area coverage
    if (/\b(apex|ace\s+shyne|royale|tractor\s+shyne|tractor\s+emul|tractor\s+sparc|tractor\s+suprema|premium\s+emul|apcolite.*shyne|apcolite.*protek|plaster\s*coat)\b/i.test(combined)) return true;
    // Berger/Opus emulsion categories
    if (/\b(berger\s+emulsion|opus\s+emulsion|opus\s+distempar)\b/i.test(combined)) return true;
    // Shyne range = always emulsion
    if (/\bshyne\b/i.test(combined) && !/enamel/i.test(combined)) return true;
    return false;
}

// ─── Simplify category name for local categories ─────────────────────────────

function simplifyCategory(categoryName) {
    if (!categoryName) return 'General';

    // Map Zoho categories to simpler local categories
    const cat = categoryName.toUpperCase();

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

// ─── Normalize brand name ────────────────────────────────────────────────────

function normalizeBrand(zohoBrand) {
    if (!zohoBrand) return 'Generic';
    const b = zohoBrand.trim();
    // Fix known brand name issues
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

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════

(async () => {
    const pool = await mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    console.log(`\n${'='.repeat(60)}`);
    console.log(`  ZOHO → LOCAL PRODUCT IMPORT ${DRY_RUN ? '(DRY RUN)' : '(LIVE)'}`);
    console.log(`${'='.repeat(60)}\n`);

    // 1. Fetch all active Zoho items
    const [zohoItems] = await pool.query(
        `SELECT zoho_item_id, zoho_item_name, zoho_rate, zoho_unit, zoho_brand,
                zoho_category_name, zoho_cf_product_name, local_product_id, image_url
         FROM zoho_items_map WHERE zoho_status = 'active' ORDER BY zoho_item_name`
    );
    console.log(`Fetched ${zohoItems.length} active Zoho items\n`);

    // 2. Extract product info and group
    const groups = new Map(); // key: "productName|||brand" → { items, category, productType }

    for (const item of zohoItems) {
        const { productName, sizeLabel } = extractProductInfo(item.zoho_item_name, item.zoho_cf_product_name);
        const brand = normalizeBrand(item.zoho_brand);
        const category = simplifyCategory(item.zoho_category_name);
        const areaWise = isAreaWise(productName, item.zoho_category_name);

        const groupKey = `${productName.toUpperCase()}|||${brand.toUpperCase()}`;

        if (!groups.has(groupKey)) {
            groups.set(groupKey, {
                productName,
                brand,
                category,
                productType: areaWise ? 'area_wise' : 'unit_wise',
                items: []
            });
        }

        const group = groups.get(groupKey);
        const { size, unitFromLabel } = parseSize(sizeLabel);
        // Prefer unit from size label (e.g., "01 L" → L) over zoho_unit (e.g., "Pcs")
        const unit = unitFromLabel || normalizeUnit(item.zoho_unit);

        group.items.push({
            zoho_item_id: item.zoho_item_id,
            zoho_item_name: item.zoho_item_name,
            sizeLabel,
            size,          // numeric size (ML converted to L, GM to KG)
            sizeDisplay: size.toString(),  // for pack_sizes.size column
            unit,
            rate: item.zoho_rate || 0,
            image_url: item.image_url,
            zoho_category: item.zoho_category_name
        });

        // If any item in group is area_wise, make the whole group area_wise
        if (areaWise) group.productType = 'area_wise';
    }

    console.log(`Grouped into ${groups.size} products\n`);

    // Print summary
    let areaCount = 0, unitCount = 0;
    for (const [, g] of groups) {
        if (g.productType === 'area_wise') areaCount++;
        else unitCount++;
    }
    console.log(`  Area-wise (sqft) products: ${areaCount}`);
    console.log(`  Unit-wise products: ${unitCount}\n`);

    // Show top 20 groups by item count
    const sortedGroups = [...groups.entries()].sort((a, b) => b[1].items.length - a[1].items.length);
    console.log('=== TOP 20 GROUPS (by item count) ===');
    for (const [key, g] of sortedGroups.slice(0, 20)) {
        const sizes = g.items.map(i => i.sizeLabel || '?').join(', ');
        console.log(`  [${g.productType}] ${g.productName} (${g.brand}) - ${g.items.length} sizes: ${sizes.substring(0, 100)}`);
    }

    // Show category distribution
    const catCounts = {};
    for (const [, g] of groups) {
        catCounts[g.category] = (catCounts[g.category] || 0) + 1;
    }
    console.log('\n=== CATEGORY DISTRIBUTION ===');
    Object.entries(catCounts).sort((a, b) => b[1] - a[1]).forEach(([cat, cnt]) => {
        console.log(`  ${cat}: ${cnt} products`);
    });

    if (DRY_RUN) {
        console.log('\n--- DRY RUN COMPLETE. Use without --dry-run to execute. ---\n');

        // Show some sample groups for verification
        console.log('\n=== SAMPLE GROUPS ===\n');
        let shown = 0;
        for (const [key, g] of sortedGroups) {
            if (shown >= 10) break;
            console.log(`Product: "${g.productName}" [${g.brand}] [${g.category}] [${g.productType}]`);
            for (const item of g.items.slice(0, 5)) {
                console.log(`  - ${item.zoho_item_name} → size=${item.size} ${item.unit} @ ₹${item.rate}`);
            }
            if (g.items.length > 5) console.log(`  ... and ${g.items.length - 5} more`);
            console.log();
            shown++;
        }

        await pool.end();
        return;
    }

    // ─── LIVE IMPORT ─────────────────────────────────────────────────────────

    const conn = await pool.getConnection();
    await conn.beginTransaction();

    try {
        // First, deactivate all existing products (clean slate)
        await conn.query("UPDATE products SET status = 'inactive'");
        await conn.query("UPDATE pack_sizes SET is_active = 0");
        await conn.query("UPDATE zoho_items_map SET local_product_id = NULL WHERE zoho_status = 'active'");

        // Cache for brands and categories
        const brandCache = new Map();
        const categoryCache = new Map();

        // Load existing brands
        const [existingBrands] = await conn.query('SELECT id, name FROM brands');
        for (const b of existingBrands) brandCache.set(b.name.toUpperCase(), b.id);

        // Load existing categories
        const [existingCats] = await conn.query('SELECT id, name FROM categories');
        for (const c of existingCats) categoryCache.set(c.name.toUpperCase(), c.id);

        let productsCreated = 0, packSizesCreated = 0, brandsCreated = 0, categoriesCreated = 0;

        for (const [, group] of groups) {
            // Get or create brand
            let brandId;
            const brandKey = group.brand.toUpperCase();
            if (brandCache.has(brandKey)) {
                brandId = brandCache.get(brandKey);
            } else {
                const [br] = await conn.query('INSERT INTO brands (name, status) VALUES (?, ?)', [group.brand, 'active']);
                brandId = br.insertId;
                brandCache.set(brandKey, brandId);
                brandsCreated++;
            }

            // Get or create category
            let categoryId;
            const catKey = group.category.toUpperCase();
            if (categoryCache.has(catKey)) {
                categoryId = categoryCache.get(catKey);
            } else {
                const [cat] = await conn.query('INSERT INTO categories (name, status) VALUES (?, ?)', [group.category, 'active']);
                categoryId = cat.insertId;
                categoryCache.set(catKey, categoryId);
                categoriesCreated++;
            }

            // Create product
            const firstItem = group.items[0];
            const [prod] = await conn.query(
                `INSERT INTO products (name, brand_id, category_id, product_type, base_price, status, is_gst_inclusive)
                 VALUES (?, ?, ?, ?, ?, 'active', 1)`,
                [group.productName, brandId, categoryId, group.productType, firstItem.rate]
            );
            const productId = prod.insertId;
            productsCreated++;

            // Create pack_sizes for each item
            for (const item of group.items) {
                await conn.query(
                    `INSERT INTO pack_sizes (product_id, size, unit, base_price, zoho_item_id, is_active)
                     VALUES (?, ?, ?, ?, ?, 1)`,
                    [productId, item.sizeDisplay, item.unit, item.rate, item.zoho_item_id]
                );
                packSizesCreated++;

                // Map zoho_items_map
                await conn.query(
                    'UPDATE zoho_items_map SET local_product_id = ? WHERE zoho_item_id = ?',
                    [productId, item.zoho_item_id]
                );
            }
        }

        await conn.commit();

        console.log(`\n${'='.repeat(60)}`);
        console.log('  IMPORT COMPLETE');
        console.log(`${'='.repeat(60)}`);
        console.log(`  Products created: ${productsCreated}`);
        console.log(`  Pack sizes created: ${packSizesCreated}`);
        console.log(`  Brands created: ${brandsCreated}`);
        console.log(`  Categories created: ${categoriesCreated}`);
        console.log();

        // Verify
        const [verify] = await conn.query("SELECT COUNT(*) as cnt FROM products WHERE status = 'active'");
        const [verifyPs] = await conn.query("SELECT COUNT(*) as cnt FROM pack_sizes WHERE is_active = 1");
        const [verifyMap] = await conn.query("SELECT COUNT(*) as cnt FROM zoho_items_map WHERE local_product_id IS NOT NULL AND zoho_status = 'active'");
        console.log(`  Active products: ${verify[0].cnt}`);
        console.log(`  Active pack sizes: ${verifyPs[0].cnt}`);
        console.log(`  Mapped Zoho items: ${verifyMap[0].cnt}`);
    } catch (err) {
        await conn.rollback();
        console.error('\n❌ Error, rolled back:', err.message);
        console.error(err.stack);
    } finally {
        conn.release();
        await pool.end();
    }
})();
