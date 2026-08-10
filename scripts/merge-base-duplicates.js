/**
 * Merge base-prefixed duplicate products into their family product.
 *
 * The Aug-2026 name restores produced one-card-per-base duplicates for the
 * multi-base Birla families (e.g. "TF2 ONE TRUE FLEX", "PEM13", "NSSWT",
 * "CS6 STYLE COLOR SMART" alongside TRUE FLEX / PURE ELEGANCE / NEO STAR
 * SHINE / COLOR SMART). The owner wants ONE product per series (main base +
 * all its sizes) — CS1 and CSS1 stay separate products, but base-code variants
 * of the SAME series merge into the family product.
 *
 * Two matching rules (same brand + product_type):
 *   A) substring:  duplicate's dominant series CONTAINS the family's series
 *                  ("TF2 ONE TRUE FLEX" ⊃ "ONE TRUE FLEX")
 *   B) prefix:     duplicate's leading code-prefix (letters) STARTS WITH the
 *                  family's base prefix (longest match) — covers code-only
 *                  names like PEM13/PEWT (family PURE ELEGANCE, prefix PE).
 *
 * Mechanics identical to consolidate-catalog-products.js: move pack_sizes
 * (ids preserved), re-point zoho_items_map.local_product_id, keep visible
 * state, remove dup catalog rows, deactivate dups, recompute main_base_key.
 *
 * Usage: node scripts/merge-base-duplicates.js [--dry-run]
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
    console.log(`  MERGE BASE-DUPLICATE PRODUCTS ${DRY_RUN ? '(DRY RUN)' : '(LIVE)'}`);
    console.log(`${'='.repeat(64)}\n`);

    const rows = await q(`
        SELECT p.id pid, p.name pname, p.product_type, p.main_base_key,
               ps.id psid, ps.base_key, zim.zoho_item_name, zim.zoho_brand
        FROM products p
        JOIN pack_sizes ps ON ps.product_id = p.id AND ps.is_active = 1
        JOIN zoho_items_map zim ON zim.zoho_item_id = ps.zoho_item_id
        WHERE p.status = 'active' AND p.product_type = 'area_wise'`);

    const byPid = {};
    for (const r of rows) (byPid[r.pid] = byPid[r.pid] || []).push(r);

    // dominant series + base prefix per product
    const prodInfo = new Map();
    for (const r of rows) {
        if (!prodInfo.has(r.pid)) prodInfo.set(r.pid, { series: null, count: 0, bases: [], name: r.pname, brand: r.zoho_brand, type: r.product_type });
        const pi = prodInfo.get(r.pid);
        const { series } = parseBase(r.zoho_item_name, null, r.zoho_brand);
        if (series && series === (pi.series || series)) { pi.count++; pi.series = series; }
        if (r.base_key) pi.bases.push(r.base_key);
    }
    // normalize: series = the most common series among packs
    for (const [pid, pi] of prodInfo) {
        const total = (byPid[pid] || []).length;
        if (pi.count < Math.max(1, Math.ceil(total * 0.5))) pi.series = null;
        pi.mainBase = pi.main_base_key || pickMainBase(pi.bases, pi.brand);
    }

    // family products: have a main base (multi-base series)
    const families = [];
    for (const [pid, pi] of prodInfo) {
        if (pi.mainBase) families.push({ pid, ...pi });
    }

    // A duplicate is ONLY a base-code-prefixed name: "PEM13", "TF2 ONE TRUE FLEX",
    // "CS6 STYLE COLOR SMART", "TFWT", "BR FLEXO EMULSION", "W1 ANTIDUST EMULSION".
    // Legit separate products ("COLOR SMART SHINE", "ANTIDUST EMULSION",
    // "WALMASTA GLOW", "CALISTA NEO STAR SHINE") never match.
    const BASE_CODE_NAME = /^[A-Z]{2,8}([0-9]{1,3}|WT)([ .-]|$)/i;
    const BERGER_CODE_NAME = /^[A-Z]{2,8}(BR|IV|RD|W1|N1|N2|P1|PO|Y|WT)\b/i;
    const isBaseCodeName = (nm) => BASE_CODE_NAME.test(nm) || BERGER_CODE_NAME.test(nm);

    // plan merges
    const plans = [];
    const merged = new Set();
    for (const [pid, pi] of prodInfo) {
        if (!pi.series || merged.has(pid)) continue;
        if (!isBaseCodeName(pi.name)) continue; // only base-code-prefixed duplicates merge
        const brand = (pi.brand || '').trim().toUpperCase();
        const type = pi.type;
        let target = null;
        // rule A: series containment — pick the LONGEST family series contained
        // ("CSS6 STYLE COLOR SMART SHINE" ⊃ "STYLE COLOR SMART SHINE" (#1172), not
        // just "STYLE COLOR SMART" (#1171) — SHINE stays a separate product).
        for (const fam of families) {
            if (fam.pid === pid || merged.has(fam.pid)) continue;
            if ((fam.brand || '').trim().toUpperCase() !== brand || fam.type !== type) continue;
            if (pi.series !== fam.series && pi.series.includes(fam.series)) {
                if (!target || fam.series.length > target.series.length) target = fam;
            }
        }
        // rule B: code prefix (longest match) — code-only names like PEM13/PEWT/TFWT
        if (!target) {
            const prefix = String(pi.name).replace(/[^A-Za-z]/g, '');
            let best = null, bestLen = 0;
            for (const fam of families) {
                if (fam.pid === pid || merged.has(fam.pid)) continue;
                if ((fam.brand || '').trim().toUpperCase() !== brand || fam.type !== type) continue;
                const famPrefix = String(fam.mainBase || fam.name).replace(/[^A-Za-z]/g, '');
                if (famPrefix.length >= 2 && prefix.startsWith(famPrefix) && famPrefix.length > bestLen) {
                    best = fam; bestLen = famPrefix.length;
                }
            }
            if (best && prefix.length > bestLen) target = best;
        }
        if (target) {
            plans.push({ dup: { pid, name: pi.name, series: pi.series }, fam: { pid: target.pid, name: target.name, series: target.series } });
            merged.add(pid);
        }
    }

    console.log(`Merge plans: ${plans.length}`);
    for (const p of plans.slice(0, 50)) {
        console.log(`  #${p.dup.pid} "${p.dup.name.slice(0, 34)}"  ->  #${p.fam.pid} "${p.fam.name.slice(0, 34)}"`);
    }
    if (plans.length > 50) console.log(`  ... and ${plans.length - 50} more`);
    console.log(`\nWould merge ${plans.length} duplicate products (${plans.reduce((s, p) => s + (byPid[p.dup.pid] || []).length, 0)} packs moved).`);

    if (!DRY_RUN && plans.length) {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            let movedPacks = 0, deactivated = 0;
            for (const p of plans) {
                const keeperId = p.fam.pid;
                const dupeId = p.dup.pid;
                const [mv] = await conn.query('UPDATE pack_sizes SET product_id = ? WHERE product_id = ?', [keeperId, dupeId]);
                movedPacks += mv.affectedRows;
                await conn.query('UPDATE zoho_items_map SET local_product_id = ? WHERE local_product_id = ?', [keeperId, dupeId]);
                const [vis] = await conn.query('SELECT COUNT(*) c FROM painter_catalog_product_order WHERE product_id = ? AND is_hidden = 0', [dupeId]);
                if (vis[0].c > 0) {
                    await conn.query(`INSERT INTO painter_catalog_product_order (product_id, sort_order, is_hidden) VALUES (?, 999, 0) ON DUPLICATE KEY UPDATE is_hidden = 0`, [keeperId]);
                }
                await conn.query('DELETE FROM painter_catalog_product_order WHERE product_id = ?', [dupeId]);
                const [up] = await conn.query("UPDATE products SET status = 'inactive' WHERE id = ?", [dupeId]);
                deactivated += up.affectedRows;
                // recompute main for keeper (brand-aware)
                const [packs] = await conn.query(
                    `SELECT ps.base_key FROM pack_sizes ps JOIN zoho_items_map zim ON zim.zoho_item_id = ps.zoho_item_id
                     WHERE ps.product_id = ? AND ps.is_active = 1`, [keeperId]);
                const fam = families.find(f => f.pid === keeperId);
                const main = pickMainBase(packs.map(x => x.base_key), fam ? fam.brand : null);
                await conn.query('UPDATE products SET main_base_key = ? WHERE id = ?', [main, keeperId]);
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
