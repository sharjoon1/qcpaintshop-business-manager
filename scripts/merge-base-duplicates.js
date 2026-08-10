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

    // ── Berger family merge ─────────────────────────────────────────────────
    // Owner policy: Berger family duplicates ("ANTIDUST EMULSION", "SMOOTH
    // EMULSION", "WALMASTA EXT EMULSION", "WALMASTA GLOW", "RANGOLI R MATT
    // EMULSION", "BR FLEXO EMULSION", ...) merge into one product per family,
    // while Birla SHINE families stay separate.
    const BASE_SUFFIX = /(BR|IV|RD|W1|N1|N2|P1|PO|Y|WT|N)$/i;
    const GENERIC_CODES = new Set(['BS', 'EPR']); // Berger size-code BS01, primer size-code EPR01
    const familyCodeOf = (pid) => {
        const codes = new Map();
        for (const r of byPid[pid] || []) {
            const seg = String(r.zoho_item_name || '').split(' - ')[0].trim();
            let letters = seg.replace(/[^A-Za-z]/g, '');
            if (/[LMGKS]$/.test(letters) && letters.length > 3) letters = letters.slice(0, -1); // unit letter
            if (letters.length > 1) letters = letters.replace(BASE_SUFFIX, '');
            if (letters.length >= 2 && !GENERIC_CODES.has(letters)) codes.set(letters, (codes.get(letters) || 0) + 1);
        }
        const top = [...codes.entries()].sort((a, b) => b[1] - a[1])[0];
        return top ? top[0] : null;
    };
    const bergerMembers = [];
    for (const [pid, pi] of prodInfo) {
        const b = (pi.brand || '').trim().toUpperCase();
        if (b.indexOf('BERGER') === -1 || pi.type !== 'area_wise') continue;
        const key = String(pi.name)
            .replace(/^(BR|IV|RD|W1|N1?|N2|P1|PO|Y|WT)\s+/i, '')
            .replace(/\s+(EXT\s+)?(GLOW\s+)?(R MATT\s+)?EMULSION$/i, '')
            .replace(/\s+GLOW$/i, '')
            .trim();
        if (!key || key.length < 3) continue;
        bergerMembers.push({ pid, name: pi.name, packs: (byPid[pid] || []).length, key, code: familyCodeOf(pid) });
    }
    const bergerPlans = [];
    const nameGroups = new Map();
    for (const m of bergerMembers) {
        if (!nameGroups.has(m.key)) nameGroups.set(m.key, []);
        nameGroups.get(m.key).push(m);
    }
    for (const [key, members] of nameGroups) {
        if (members.length < 2) continue;
        // code guard: members must share a common family-code prefix, else the
        // name collided across real families (both Feb products named "EMULSION"
        // but one is FLEXO, the other BISON)
        const codes = members.map((m) => m.code).filter(Boolean);
        const common = (a, b) => { const min = Math.min(a.length, b.length); let i = 0; while (i < min && a[i] === b[i]) i++; return a.slice(0, i); };
        let commonCode = codes[0] || null;
        for (const code of codes) { commonCode = common(commonCode, code); if (!commonCode) break; }
        if (!commonCode || commonCode.length < 2) continue;
        const keeper = members.slice().sort((a, b) =>
            a.name.length - b.name.length || b.packs - a.packs || a.pid - b.pid)[0];
        for (const m of members) {
            if (m.pid !== keeper.pid && !merged.has(m.pid)) {
                bergerPlans.push({ dup: { pid: m.pid, name: m.name }, fam: { pid: keeper.pid, name: keeper.name, series: key }, code: commonCode });
                merged.add(m.pid);
            }
        }
    }
    // code-based grouping for the leftovers (name collision like "EMULSION" ->
    // FLEXO/BISON, "GLOW EMULSION" -> BISON GLOW). Only EMULSION-named or
    // base-code-prefixed members — primer products share generic EPR codes and
    // must never merge via code.
    const codeGroups = new Map();
    for (const m of bergerMembers) {
        if (merged.has(m.pid) || !m.code) continue;
        if (!/EMULSION/i.test(m.name) && !/^(BR|IV|RD|W1|N1?|N2|P1|PO|Y|WT)\s+/i.test(m.name)) continue;
        if (!codeGroups.has(m.code)) codeGroups.set(m.code, []);
        codeGroups.get(m.code).push(m);
    }
    for (const [code, members] of codeGroups) {
        if (members.length < 2) continue;
        const keeper = members.slice().sort((a, b) =>
            a.name.length - b.name.length || b.packs - a.packs || a.pid - b.pid)[0];
        for (const m of members) {
            if (m.pid !== keeper.pid && !merged.has(m.pid)) {
                bergerPlans.push({ dup: { pid: m.pid, name: m.name }, fam: { pid: keeper.pid, name: keeper.name, series: code }, code });
                merged.add(m.pid);
            }
        }
    }
    console.log(`Berger family merge plans: ${bergerPlans.length}`);
    for (const p of bergerPlans.slice(0, 40)) {
        console.log(`  #${p.dup.pid} "${p.dup.name.slice(0, 34)}"  ->  #${p.fam.pid} "${p.fam.name.slice(0, 34)}"  [${p.fam.series}]`);
    }
    if (bergerPlans.length > 40) console.log(`  ... and ${bergerPlans.length - 40} more`);

    console.log(`\nTotal merge plans (base-code + Berger family): ${plans.length + bergerPlans.length}`);
    const allPlans = plans.concat(bergerPlans);
    console.log(`Would merge ${allPlans.length} duplicate products (${allPlans.reduce((s, p) => s + (byPid[p.dup.pid] || []).length, 0)} packs moved).`);

    if (!DRY_RUN && allPlans.length) {
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            let movedPacks = 0, deactivated = 0;
            for (const p of allPlans) {
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
    } else if (!DRY_RUN) {
        console.log(`\nLIVE: nothing to merge.`);
    }

    console.log(`\n${'='.repeat(64)}`);
    console.log(`  DONE ${DRY_RUN ? '(DRY RUN — no writes)' : '(LIVE)'}`);
    console.log(`${'='.repeat(64)}\n`);
    await pool.end();
})().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
