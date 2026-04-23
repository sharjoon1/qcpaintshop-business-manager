/**
 * CLEANUP EMULSION BASES
 * For emulsion (area_wise) products, multiple color bases exist (PB1, PB2, PB5, etc.)
 * Keep only the first base (base 1/WT) and deactivate all others.
 *
 * Usage: node scripts/cleanup-emulsion-bases.js [--dry-run]
 */

require('dotenv').config();
const mysql = require('mysql2/promise');

const DRY_RUN = process.argv.includes('--dry-run');

// Extract base code and core product name from product name
// e.g., "PB1 STYLE POWER BRIGHT OPUS" → { baseCode: "PB1", baseName: "STYLE POWER BRIGHT OPUS", baseNum: 1 }
// e.g., "PBWT STYLE POWER BRIGHT OPUS" → { baseCode: "PBWT", baseName: "STYLE POWER BRIGHT OPUS", baseNum: 0 }
// e.g., "W1 SMOOTH EMULSION BERGER" → { baseCode: "W1", baseName: "SMOOTH EMULSION BERGER", baseNum: 1 }
function parseBaseName(name) {
    // Match: 1-5 uppercase letters + optional digits at start of name
    const match = name.match(/^([A-Z]{1,5}\d{0,3})\s+(.+)$/);
    if (!match) return { baseCode: null, baseName: name, baseNum: 999, sortKey: name };

    const baseCode = match[1];
    const baseName = match[2];

    // Extract base number from code
    const numMatch = baseCode.match(/(\d+)$/);
    let baseNum;
    if (numMatch) {
        baseNum = parseInt(numMatch[1]);
    } else if (/WT$/i.test(baseCode)) {
        baseNum = 0; // White base = first priority
    } else {
        // Letter-only bases (BR, IV, PO, Y, etc.) — give them high number
        baseNum = 500;
    }

    return { baseCode, baseName, baseNum, sortKey: baseName };
}

(async () => {
    const pool = await mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    console.log(`\n${'='.repeat(60)}`);
    console.log(`  EMULSION BASE CLEANUP ${DRY_RUN ? '(DRY RUN)' : '(LIVE)'}`);
    console.log(`${'='.repeat(60)}\n`);

    // Get all active area_wise products
    const [products] = await pool.query(`
        SELECT p.id, p.name, b.name as brand_name, c.name as category_name,
            COUNT(ps.id) as pack_count
        FROM products p
        LEFT JOIN brands b ON b.id = p.brand_id
        LEFT JOIN categories c ON c.id = p.category_id
        LEFT JOIN pack_sizes ps ON ps.product_id = p.id AND ps.is_active = 1
        WHERE p.status = 'active' AND p.product_type = 'area_wise'
        GROUP BY p.id
        ORDER BY p.name
    `);

    console.log(`Total area_wise products: ${products.length}\n`);

    // Group by base name + brand
    const groups = new Map();
    for (const p of products) {
        const parsed = parseBaseName(p.name);
        const key = `${parsed.baseName}|||${p.brand_name}`;

        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push({
            ...p,
            ...parsed
        });
    }

    // Process groups - keep only first base
    let toDeactivate = [];
    let toKeep = [];

    for (const [key, items] of groups) {
        if (items.length <= 1) {
            toKeep.push(items[0]);
            continue;
        }

        // Sort by baseNum (lowest first, WT=0 is highest priority)
        items.sort((a, b) => a.baseNum - b.baseNum);

        // Keep the first one (lowest base number)
        const keeper = items[0];
        toKeep.push(keeper);

        // Mark rest for deactivation
        for (let i = 1; i < items.length; i++) {
            toDeactivate.push(items[i]);
        }

        console.log(`[${keeper.brand_name}] ${keeper.baseName}`);
        console.log(`  KEEP: ${keeper.name} (base ${keeper.baseNum}, ${keeper.pack_count} packs)`);
        for (let i = 1; i < items.length; i++) {
            console.log(`  REMOVE: ${items[i].name} (base ${items[i].baseNum}, ${items[i].pack_count} packs)`);
        }
        console.log();
    }

    console.log(`${'='.repeat(60)}`);
    console.log(`Products to KEEP: ${toKeep.length}`);
    console.log(`Products to DEACTIVATE: ${toDeactivate.length}`);
    console.log(`${'='.repeat(60)}\n`);

    if (DRY_RUN) {
        console.log('--- DRY RUN COMPLETE ---\n');
        await pool.end();
        return;
    }

    // Deactivate products and their pack_sizes
    if (toDeactivate.length > 0) {
        const ids = toDeactivate.map(p => p.id);

        // Deactivate products
        await pool.query(
            `UPDATE products SET status = 'inactive' WHERE id IN (${ids.join(',')})`,
        );

        // Deactivate pack_sizes
        await pool.query(
            `UPDATE pack_sizes SET is_active = 0 WHERE product_id IN (${ids.join(',')})`,
        );

        // Unmap zoho_items_map
        await pool.query(
            `UPDATE zoho_items_map SET local_product_id = NULL
             WHERE zoho_item_id IN (SELECT zoho_item_id FROM pack_sizes WHERE product_id IN (${ids.join(',')}))`,
        );

        console.log(`Deactivated ${ids.length} products and their pack_sizes`);
    }

    // Also rename kept products to remove base code prefix
    let renamed = 0;
    for (const p of toKeep) {
        if (p.baseCode && p.baseName !== p.name) {
            await pool.query('UPDATE products SET name = ? WHERE id = ?', [p.baseName, p.id]);
            renamed++;
        }
    }
    console.log(`Renamed ${renamed} products (removed base code prefix)`);

    // Verify
    const [verify] = await pool.query("SELECT COUNT(*) as cnt FROM products WHERE status = 'active' AND product_type = 'area_wise'");
    const [verifyAll] = await pool.query("SELECT COUNT(*) as cnt FROM products WHERE status = 'active'");
    console.log(`\nActive area_wise products: ${verify[0].cnt}`);
    console.log(`Total active products: ${verifyAll[0].cnt}`);

    await pool.end();
})();
