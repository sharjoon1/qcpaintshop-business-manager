/**
 * ONE-TIME: deactivate the ZERO-STOCK Asian Paints vendor items (~130).
 *
 * Asian Paints pushes items straight into the owner's Zoho Books org. Those
 * vendor-owned items are category-locked — the owner cannot fix their category.
 * They are dead clutter in the item list.
 *
 * The 46 vendor items that still HELD STOCK were handled separately by
 * scripts/consolidate-asian-items.js (create an owner-editable "-OWN"
 * replacement, move the stock across with paired inventory adjustments, then
 * deactivate the old item). THIS script covers the much simpler remainder:
 * vendor items with NO stock anywhere. Nothing needs to be created, nothing
 * needs to move — they are simply marked inactive in Zoho and in the local
 * mirror.
 *
 * How it works:
 *   1. Read the candidate list LIVE from zoho_items_map at runtime (no
 *      hardcoded id list — the local mirror shifts as syncs run).
 *   2. Per item, DEFENSIVELY re-check that stock really is zero by summing
 *      zoho_location_stock for that item. Non-zero => SKIP, never deactivate.
 *      The list SELECT is a snapshot; by the time the loop reaches item #90 a
 *      sync may have landed stock on it. This guard is load-bearing.
 *   3. Only then markItemInactive() in Zoho, and on success set the local
 *      mirror's zoho_status='inactive'.
 *
 * Safety:
 *   - DRY-RUN IS THE DEFAULT. Zero Zoho calls and zero DB writes (SELECTs only)
 *     unless --apply is passed explicitly.
 *   - One item's failure never aborts the batch.
 *   - No new item is created and no stock is adjusted anywhere in this script.
 *
 * WHY NO AUDIT-LOG TABLE (unlike the 46-item consolidation):
 *   That script created a new Zoho item and moved real stock — both
 *   non-idempotent, so a half-finished item MUST NOT be auto-retried, which
 *   required zoho_item_consolidation_log to remember new_item_id/state. Here the
 *   only mutation is "mark inactive", which is idempotent (re-marking an already
 *   inactive item is a no-op) and there is nothing to un-do or hand-recover. The
 *   local mirror column IS the durable record: zoho_items_map.zoho_status flips
 *   to 'inactive', and because the candidate query filters on
 *   zoho_status='active' a re-run naturally skips everything already done. A
 *   dedicated table would add DDL and no recoverable information, so this script
 *   logs per item to the console and prints an end-of-run summary instead.
 *
 * Usage:
 *   node scripts/deactivate-asian-vendor-items.js                        # dry-run (default)
 *   node scripts/deactivate-asian-vendor-items.js --dry-run              # same
 *   node scripts/deactivate-asian-vendor-items.js --only=<id> --apply    # 1-item pilot
 *   node scripts/deactivate-asian-vendor-items.js --limit=10 --apply     # batch of 10
 *   node scripts/deactivate-asian-vendor-items.js --apply                # everything
 *
 * NOTE: --apply writes to live Zoho Books. Run the dry-run first, then the
 * 1-item pilot, then batches.
 */

const BRAND = 'ASIAN PAINTS';
const OWN_SUFFIX = '-OWN';

/**
 * Candidate list — the agreed source of truth, used verbatim.
 *
 * The `zoho_sku NOT LIKE '%-OWN'` exclusion is CRITICAL: the 46 replacement
 * items created by scripts/consolidate-asian-items.js are also
 * brand='ASIAN PAINTS' and active, but they are the owner's good items holding
 * the migrated stock. They must NEVER be touched by this script.
 *
 * All values here are hardcoded constants — no user input is interpolated
 * (CLAUDE.md §5); the only runtime-varying value in this script (item id) is
 * passed as a `?` parameter everywhere it is used.
 */
const CANDIDATE_SQL = `
  SELECT zoho_item_id, zoho_item_name, zoho_sku
  FROM zoho_items_map
  WHERE zoho_status='active' AND zoho_brand='ASIAN PAINTS' AND zoho_sku NOT LIKE '%-OWN'
`;

/** Decimal(12,2) sums come back as strings; compare with a tolerance, not ===. */
const QTY_EPSILON = 1e-9;

// ── pure helpers (unit-tested) ───────────────────────────────────────────────

/**
 * Parse argv into options. Dry-run is the default; --apply must be EXACTLY
 * `--apply` (same strict convention as scripts/consolidate-asian-items.js:222 —
 * `--apply=false`, `--applyy` and a bare `apply` all stay in dry-run).
 */
function parseArgs(argv) {
    const apply = argv.includes('--apply');
    let limit = null;
    let only = null;
    for (const arg of argv) {
        const m = /^--limit=(\d+)$/.exec(arg);
        if (m) limit = parseInt(m[1], 10);
        const o = /^--only=(.+)$/.exec(arg);
        if (o) only = o[1].split(',').map(s => s.trim()).filter(Boolean);
    }
    return { apply, dryRun: !apply, limit, only };
}

/** Apply --only / --limit to the rows fetched from the DB. */
function selectItems(items, { only, limit } = {}) {
    let list = items;
    if (only && only.length) list = list.filter(i => only.includes(String(i.zoho_item_id)));
    if (limit) list = list.slice(0, limit);
    return list;
}

// ── db helpers ───────────────────────────────────────────────────────────────

/** Live candidate list — never a hardcoded id array. */
async function fetchCandidates(pool) {
    const [rows] = await pool.query(CANDIDATE_SQL);
    return rows;
}

/**
 * Defensive per-item stock re-check against the local mirror.
 *
 * Returns { net, gross, rows }:
 *   net   = SUM(stock_on_hand)      — the spec'd guard
 *   gross = SUM(ABS(stock_on_hand)) — also reported so that a location holding
 *           +5 that is cancelled out by another holding -5 (net 0, but real
 *           stock sitting somewhere) is NOT mistaken for "empty". Skipping is
 *           always the safe direction; the operator sees both numbers in the log.
 *   rows  = number of zoho_location_stock rows for this item. 0 rows means the
 *           mirror has no location data at all for the item — reported so a
 *           silent "no data" is never confused with a verified zero.
 */
async function getStockTotals(pool, itemId) {
    const [rows] = await pool.query(
        `SELECT COALESCE(SUM(stock_on_hand), 0) AS net,
                COALESCE(SUM(ABS(stock_on_hand)), 0) AS gross,
                COUNT(*) AS row_count
           FROM zoho_location_stock
          WHERE zoho_item_id = ?`,
        [itemId]
    );
    const r = rows[0] || {};
    return {
        net: parseFloat(r.net),
        gross: parseFloat(r.gross),
        rows: parseInt(r.row_count, 10) || 0
    };
}

/**
 * True only when the mirror positively shows zero stock everywhere.
 * NaN (unparseable sum) is treated as "has stock" — fail safe, never deactivate.
 */
function isStockEmpty({ net, gross }) {
    if (!Number.isFinite(net) || !Number.isFinite(gross)) return false;
    return Math.abs(net) <= QTY_EPSILON && Math.abs(gross) <= QTY_EPSILON;
}

// ── per-item worker ──────────────────────────────────────────────────────────

/**
 * Deactivate ONE vendor item.
 * @returns {Promise<{zoho_item_id, status, stock?, error?}>}
 *          status: 'planned' | 'deactivated' | 'skipped_has_stock' | 'failed'
 */
async function deactivateItem({ pool, zohoAPI, item, apply, log = console }) {
    const id = String(item.zoho_item_id);
    const tag = `[${id} ${item.zoho_sku || '(no sku)'}]`;
    const name = item.zoho_item_name || '(no name)';

    // (0) belt-and-braces on the list filter: a '-OWN' replacement item must
    //     never reach this code path even if the candidate list came from
    //     somewhere else (e.g. a hand-passed --only).
    if (String(item.zoho_sku || '').toUpperCase().endsWith(OWN_SUFFIX)) {
        const msg = 'refusing to touch a -OWN replacement item';
        log.error(`${tag} FAIL — ${msg} ("${name}")`);
        return { zoho_item_id: id, status: 'failed', error: msg };
    }

    // (1) defensive live re-check — the candidate SELECT is only a snapshot.
    let stock;
    try {
        stock = await getStockTotals(pool, id);
    } catch (err) {
        log.error(`${tag} FAIL — stock re-check failed: ${err.message}`);
        return { zoho_item_id: id, status: 'failed', error: `stock re-check failed: ${err.message}` };
    }

    if (!isStockEmpty(stock)) {
        log.warn(`${tag} SKIP — HAS STOCK (net=${stock.net}, gross=${stock.gross}, ${stock.rows} location row(s)) "${name}". NOT deactivated.`);
        return { zoho_item_id: id, status: 'skipped_has_stock', stock };
    }

    // (2) dry-run: print the plan only. No Zoho calls, no DB writes at all.
    if (!apply) {
        log.log(`${tag} PLAN "${name}" — stock 0 across ${stock.rows} location row(s); would markItemInactive(${id}) + set local zoho_status='inactive'`);
        return { zoho_item_id: id, status: 'planned', stock };
    }

    // (3) apply
    try {
        await zohoAPI.markItemInactive(id);
        log.log(`${tag} Zoho: marked inactive "${name}"`);

        await pool.query(
            `UPDATE zoho_items_map SET zoho_status = 'inactive' WHERE zoho_item_id = ?`,
            [id]
        );
        log.log(`${tag} DONE — local mirror zoho_status='inactive'`);

        return { zoho_item_id: id, status: 'deactivated', stock };
    } catch (err) {
        // Never abort the batch on one item.
        log.error(`${tag} FAILED — ${err.message}`);
        return { zoho_item_id: id, status: 'failed', stock, error: err.message };
    }
}

// ── runner ───────────────────────────────────────────────────────────────────

async function run({ pool, zohoAPI, apply = false, items, log = console }) {
    log.log(`\n=== Asian Paints zero-stock vendor-item deactivation — ${apply ? 'APPLY (writes to Zoho)' : 'DRY-RUN (no writes)'} ===`);
    log.log(`Items in this run: ${items.length}\n`);

    const results = [];
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        log.log(`--- (${i + 1}/${items.length}) ${item.zoho_item_id} ${item.zoho_sku || '(no sku)'} — ${item.zoho_item_name || '(no name)'}`);
        const res = await deactivateItem({ pool, zohoAPI, item, apply, log });
        results.push(res);
    }

    const count = s => results.filter(r => r.status === s).length;
    log.log(`\n=== Summary (${apply ? 'APPLY' : 'DRY-RUN'}) ===`);
    log.log(`  planned:           ${count('planned')}`);
    log.log(`  deactivated:       ${count('deactivated')}`);
    log.log(`  skipped_has_stock: ${count('skipped_has_stock')}`);
    log.log(`  failed:            ${count('failed')}`);
    for (const r of results.filter(r => r.status === 'skipped_has_stock')) {
        log.log(`    SKIPPED (stock) ${r.zoho_item_id}: net=${r.stock.net} gross=${r.stock.gross}`);
    }
    for (const r of results.filter(r => r.status === 'failed')) {
        log.log(`    FAILED ${r.zoho_item_id}: ${r.error}`);
    }
    if (!apply) log.log('\nDry-run only — nothing was written. Re-run with --apply to execute.');

    return results;
}

module.exports = {
    BRAND,
    OWN_SUFFIX,
    CANDIDATE_SQL,
    QTY_EPSILON,
    parseArgs,
    selectItems,
    fetchCandidates,
    getStockTotals,
    isStockEmpty,
    deactivateItem,
    run
};

if (require.main === module) {
    (async () => {
        require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
        const opts = parseArgs(process.argv.slice(2));
        const { createPool } = require('../config/database');
        const zohoAPI = require('../services/zoho-api');
        const pool = createPool();
        zohoAPI.setPool(pool);

        let failures = 0;
        try {
            const candidates = await fetchCandidates(pool);
            console.log(`Candidates in zoho_items_map (active, ${BRAND}, non-${OWN_SUFFIX}): ${candidates.length}`);
            const items = selectItems(candidates, opts);
            if (items.length === 0) {
                console.error('No items selected — check --only/--limit.');
                await pool.end();
                process.exit(1);
            }
            const results = await run({ pool, zohoAPI, apply: opts.apply, items });
            failures = results.filter(r => r.status === 'failed').length;
        } catch (err) {
            console.error('Deactivation run error:', err.message);
            failures = 1;
        } finally {
            await pool.end();
        }
        process.exit(failures > 0 ? 1 : 0);
    })();
}
