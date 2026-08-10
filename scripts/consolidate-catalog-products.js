/**
 * Consolidate products split by the incremental catalog import.
 *
 * The 2026-08-10 backfill's Pass C created a new product per pack size when a
 * series had no pre-existing product in seriesToProduct (the map was not
 * updated during the run). Result: one family split into several 1-pack
 * products (e.g. "STYLE COLOR FRESH" 1L / 4L / 10L / 20L as separate rows).
 *
 * SAFE repair rule: within a (series, brand, product_type) group, only members
 * with the EXACT SAME NAME are merged (those are unambiguous size-splits of one
 * family). Mixed-name groups (pre-existing product groupings like "MELAMINE
 * GLOSSY" vs "MELAMINE SEALER", or the old "STYLE COLOR FRESH OPUS" product)
 * are left untouched — the owner can curate those in the UI.
 *
 * Mechanics:
 *   - pack_sizes rows are MOVED (product_id updated, ids preserved) so any
 *     historical pack_size_id reference survives;
 *   - duplicate products are deactivated (status='inactive', reversible) and
 *     their painter_catalog_product_order rows removed;
 *   - zoho_items_map.local_product_id re-pointed; main_base_key recomputed for
 *     area_wise keepers over the final pack set.
 *
 * Usage: node scripts/consolidate-catalog-products.js [--dry-run]
 */

require('dotenv').config();
const mysql = require('mysql2/promise');
const { parseBase, pickMainBase } = require('../services/catalog-base');

const DRY_RUN = process.argv.includes('--dry-run');

(async () => {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'business_manager',
        port: parseInt(process.env.DB_PORT, 10) || 3306
    });
    const q = async (sql, p) => (await pool.query(sql, p))[0];

    console.log(`\n${'='.repeat(64)}`);
    console.log(`  CATALOG PRODUCT CONSOLIDATION ${DRY_RUN ? '(DRY RUN)' : '(LIVE)'}`);
    console.log(`${'='.repeat(64)}\n`);

    const rows = await q(`
        SELECT p.id pid, p.name pname, p.product_type,
               ps.id psid, zim.zoho_item_name, zim.zoho_brand
        FROM products p
        JOIN pack_sizes ps ON ps.product_id = p.id AND ps.is_active = 1
        JOIN zoho_items_map zim ON zim.zoho_item_id = ps.zoho_item_id
        WHERE p.status = 'active'`);
    console.log(`Active products with packs: ${new Set(rows.map(r => r.pid)).size}`);

    // dominant series per product (majority of its packs)
    const byPid = {};
    for (const r of rows) (byPid[r.pid] = byPid[r.pid] || []).push(r);
    const seriesOf = new Map();
    for (const r of rows) {
        const { series } = parseBase(r.zoho_item_name, null, r.zoho_brand);
        if (!series) continue;
        if (!seriesOf.has(r.pid)) seriesOf.set(r.pid, { series, n: 0 });
        if (seriesOf.get(r.pid).series === series) seriesOf.get(r.pid).n++;
    }

    // groups: (series|||brand|||type) -> [{pid, name, packs}]
    const groups = new Map();
    for (const r of rows) {
        const s = seriesOf.get(r.pid);
        if (!s) continue;
        if (s.n < Math.max(1, Math.ceil((byPid[r.pid] || []).length * 0.5))) continue;
        const key = `${s.series}|||${(r.zoho_brand || '').trim().toUpperCase()}|||${r.product_type}`;
        if (!groups.has(key)) groups.set(key, []);
        const arr = groups.get(key);
        if (!arr.find(x => x.pid === r.pid)) arr.push({ pid: r.pid, name: r.pname, packs: 0 });
        arr.find(x => x.pid === r.pid).packs++;
    }

    // plan: same-name subgroups with >1 member
    const plans = [];
    for (const [gkey, members] of groups) {
        if (members.length < 2) continue;
        const byName = new Map();
        for (const m of members) {
            const nm = m.name.trim().toUpperCase();
            if (!byName.has(nm)) byName.set(nm, []);
            byName.get(nm).push(m);
        }
        for (const [, same] of byName) {
            if (same.length < 2) continue;
            const keeper = same.slice().sort((a, b) => b.packs - a.packs || a.pid - b.pid)[0];
            const mergeInto = same.filter(m => m.pid !== keeper.pid);
            plans.push({ gkey, keeper, mergeInto });
        }
    }

    console.log(`Consolidation plans: ${plans.length}`);
    for (const p of plans.slice(0, 40)) {
        const [series] = p.gkey.split('|||');
        console.log(`  ${JSON.stringify(series).padEnd(40)} keep #${p.keeper.pid} "${p.keeper.name.slice(0, 34)}"(${p.keeper.packs})  <- ${p.mergeInto.map(m => `#${m.pid}`).join(', ')}`);
    }
    if (plans.length > 40) console.log(`  ... and ${plans.length - 40} more`);
    const dupeCount = plans.reduce((s, p) => s + p.mergeInto.length, 0);
    const packCount = plans.reduce((s, p) => s + p.mergeInto.reduce((a, m) => a + m.packs, 0), 0);
    console.log(`\nWould move ${packCount} packs and deactivate ${dupeCount} duplicate products.`);

    if (!DRY_RUN && plans.length) {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            let movedPacks = 0, deactivated = 0;
            for (const p of plans) {
                const keeperId = p.keeper.pid;
                const dupeIds = p.mergeInto.map(m => m.pid);
                const ph = dupeIds.map(() => '?').join(',');
                const [mv] = await conn.query(
                    `UPDATE pack_sizes SET product_id = ? WHERE product_id IN (${ph})`, [keeperId, ...dupeIds]);
                movedPacks += mv.affectedRows;
                await conn.query(
                    `UPDATE zoho_items_map SET local_product_id = ? WHERE local_product_id IN (${ph})`, [keeperId, ...dupeIds]);
                const [vis] = await conn.query(
                    `SELECT COUNT(*) c FROM painter_catalog_product_order WHERE product_id IN (${ph}) AND is_hidden = 0`, dupeIds);
                if (vis[0].c > 0) {
                    await conn.query(
                        `INSERT INTO painter_catalog_product_order (product_id, sort_order, is_hidden)
                         VALUES (?, 999, 0) ON DUPLICATE KEY UPDATE is_hidden = 0`, [keeperId]);
                }
                await conn.query(`DELETE FROM painter_catalog_product_order WHERE product_id IN (${ph})`, dupeIds);
                const [up] = await conn.query(`UPDATE products SET status = 'inactive' WHERE id IN (${ph})`, dupeIds);
                deactivated += up.affectedRows;
                if (p.keeper.type === 'area_wise') {
                    const [packs] = await conn.query(
                        `SELECT ps.base_key FROM pack_sizes ps JOIN zoho_items_map zim ON zim.zoho_item_id = ps.zoho_item_id
                         WHERE ps.product_id = ? AND ps.is_active = 1`, [keeperId]);
                    const main = pickMainBase(packs.map(x => x.base_key));
                    await conn.query('UPDATE products SET main_base_key = ? WHERE id = ?', [main, keeperId]);
                }
            }
            await conn.commit();
            console.log(`\nLIVE: ${movedPacks} packs moved, ${deactivated} duplicate products deactivated.`);
        } catch (e) {
            await conn.rollback();
            throw e;
        } finally {
            conn.release();
        }
    }

    console.log(`\n${'='.repeat(64)}`);
    console.log(`  DONE ${DRY_RUN ? '(DRY RUN — no writes)' : '(LIVE)'}`);
    console.log(`${'='.repeat(64)}\n`);
    await pool.end();
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
