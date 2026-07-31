/**
 * Unit tests for the one-time zero-stock Asian Paints vendor-item deactivation
 * script (scripts/deactivate-asian-vendor-items.js).
 *
 * This script writes to LIVE Zoho Books, so the contract locked here is
 * deliberately strict:
 *   - DRY-RUN IS THE DEFAULT and makes ZERO Zoho calls and ZERO DB writes.
 *   - --apply must be explicit and exact.
 *   - The candidate list is read LIVE from zoho_items_map and MUST exclude the
 *     '-OWN' replacement items created by scripts/consolidate-asian-items.js.
 *   - Before every deactivation the script RE-CHECKS stock from
 *     zoho_location_stock. An item that was in the candidate snapshot but has
 *     stock by the time the loop reaches it is SKIPPED, never deactivated.
 *   - Apply-mode ordering is mandatory: markItemInactive (Zoho) THEN the local
 *     mirror UPDATE — the mirror is never flipped for an item Zoho rejected.
 *   - One item failing never aborts the batch.
 *
 * Everything is mocked — no DB, no network.
 */

const script = require('../../scripts/deactivate-asian-vendor-items');

const {
    BRAND, OWN_SUFFIX, CANDIDATE_SQL,
    parseArgs, selectItems, fetchCandidates, getStockTotals, isStockEmpty,
    deactivateItem, run
} = script;

const ID_A = '2032688000000700001';
const ID_B = '2032688000000700002';
const ID_C = '2032688000000700003';

const ITEM_A = { zoho_item_id: ID_A, zoho_item_name: 'AP APCOLITE 1 L', zoho_sku: '00519288237' };
const ITEM_B = { zoho_item_id: ID_B, zoho_item_name: 'AP TRACTOR 4 L', zoho_sku: '00519607214' };
const ITEM_C = { zoho_item_id: ID_C, zoho_item_name: 'AP ROYALE 10 L', zoho_sku: '00519608210' };

const silentLog = () => ({ log: jest.fn(), warn: jest.fn(), error: jest.fn() });

const ZERO = { net: '0.00', gross: '0.00', row_count: 3 };

/**
 * Fake pool: routes each SELECT to canned rows and records every query.
 * Anything that is not a SELECT counts as a WRITE.
 *
 * @param stock  either a canned stock-total row, or a fn(itemId) -> row.
 */
function makePool({ candidates = [ITEM_A], stock = ZERO } = {}) {
    const queries = [];
    const pool = {
        queries,
        query: jest.fn(async (sql, params) => {
            queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
            if (/FROM zoho_location_stock/i.test(sql)) {
                const row = typeof stock === 'function' ? stock(params && params[0]) : stock;
                return [[row]];
            }
            if (/FROM zoho_items_map/i.test(sql)) return [candidates];
            return [{ affectedRows: 1 }];
        })
    };
    return pool;
}

const writes = pool => pool.queries.filter(q => !/^SELECT/i.test(q.sql));

function makeZoho() {
    const calls = [];
    return {
        calls,
        markItemInactive: jest.fn(async (id) => { calls.push(['markItemInactive', id]); return { code: 0 }; }),
        markItemActive: jest.fn(async (id) => { calls.push(['markItemActive', id]); return { code: 0 }; }),
        createItem: jest.fn(async (p) => { calls.push(['createItem', p]); return { item: { item_id: 'X' } }; }),
        createInventoryAdjustment: jest.fn(async (p) => { calls.push(['createInventoryAdjustment', p]); return {}; })
    };
}

// ── the candidate query is the source of truth ───────────────────────────────

describe('CANDIDATE_SQL — live list, and the -OWN exclusion that protects the 46', () => {
    const flat = CANDIDATE_SQL.replace(/\s+/g, ' ').trim();

    it('selects id/name/sku from zoho_items_map for active ASIAN PAINTS items', () => {
        expect(flat).toBe(
            "SELECT zoho_item_id, zoho_item_name, zoho_sku " +
            "FROM zoho_items_map " +
            "WHERE zoho_status='active' AND zoho_brand='ASIAN PAINTS' AND zoho_sku NOT LIKE '%-OWN'"
        );
        expect(BRAND).toBe('ASIAN PAINTS');
        expect(OWN_SUFFIX).toBe('-OWN');
    });

    it("EXCLUDES the '-OWN' replacement items created by the 46-item consolidation", () => {
        // Those replacements are also brand='ASIAN PAINTS' and active, but they
        // are the owner's good items holding the migrated stock. Losing this
        // clause would deactivate them.
        expect(flat).toContain("zoho_sku NOT LIKE '%-OWN'");
    });

    it('is read-only — no INSERT/UPDATE/DELETE/DROP anywhere in the candidate query', () => {
        expect(flat).toMatch(/^SELECT/i);
        expect(flat).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER)\b/i);
    });

    it('hardcodes no item ids — the list comes from the DB at runtime', async () => {
        const pool = makePool({ candidates: [ITEM_A, ITEM_B] });
        const rows = await fetchCandidates(pool);
        expect(rows).toEqual([ITEM_A, ITEM_B]);
        expect(pool.queries).toHaveLength(1);
        expect(pool.queries[0].sql).toMatch(/^SELECT/i);
        expect(writes(pool)).toEqual([]);
    });
});

// ── arg parsing: dry-run is the default ──────────────────────────────────────

describe('parseArgs — dry-run is the default', () => {
    it('defaults to dry-run when no flags are given', () => {
        expect(parseArgs([])).toEqual({ apply: false, dryRun: true, limit: null, only: null });
    });

    it('stays dry-run for --dry-run', () => {
        const o = parseArgs(['--dry-run']);
        expect(o.apply).toBe(false);
        expect(o.dryRun).toBe(true);
    });

    it('only an exact --apply flips to write mode', () => {
        const o = parseArgs(['--apply']);
        expect(o.apply).toBe(true);
        expect(o.dryRun).toBe(false);
    });

    it('does NOT treat a near-miss flag as --apply', () => {
        expect(parseArgs(['--applyy']).apply).toBe(false);
        expect(parseArgs(['apply']).apply).toBe(false);
        expect(parseArgs(['--apply=false']).apply).toBe(false);
        expect(parseArgs(['--apply=true']).apply).toBe(false);
        expect(parseArgs(['-apply']).apply).toBe(false);
        expect(parseArgs(['--APPLY']).apply).toBe(false);
        expect(parseArgs(['--no-apply']).apply).toBe(false);
    });

    it('parses --limit and --only (comma separated)', () => {
        const o = parseArgs(['--apply', '--limit=10', '--only=111,222']);
        expect(o.limit).toBe(10);
        expect(o.only).toEqual(['111', '222']);
    });
});

describe('selectItems', () => {
    const all = [ITEM_A, ITEM_B, ITEM_C];

    it('returns everything with no filters', () => {
        expect(selectItems(all, {})).toHaveLength(3);
        expect(selectItems(all)).toHaveLength(3);
    });

    it('--only selects the single pilot item', () => {
        const sel = selectItems(all, { only: [ID_B] });
        expect(sel).toHaveLength(1);
        expect(sel[0].zoho_item_id).toBe(ID_B);
    });

    it('--only accepts several ids', () => {
        expect(selectItems(all, { only: [ID_A, ID_C] }).map(i => i.zoho_item_id)).toEqual([ID_A, ID_C]);
    });

    it('--limit caps the batch size (batching guardrail)', () => {
        expect(selectItems(all, { limit: 2 })).toHaveLength(2);
        expect(selectItems(all, { limit: 1 })[0].zoho_item_id).toBe(ID_A);
    });

    it('--only and --limit combine', () => {
        expect(selectItems(all, { only: [ID_A, ID_B, ID_C], limit: 2 })).toHaveLength(2);
    });
});

// ── the stock guard ──────────────────────────────────────────────────────────

describe('getStockTotals / isStockEmpty — the safety guard primitives', () => {
    it('sums stock_on_hand for ONE item, parameterized by item id', async () => {
        const pool = makePool({ stock: { net: '7.50', gross: '7.50', row_count: 2 } });
        const totals = await getStockTotals(pool, ID_A);

        expect(totals).toEqual({ net: 7.5, gross: 7.5, rows: 2 });
        const q = pool.queries[0];
        expect(q.sql).toMatch(/SUM\(stock_on_hand\)/i);
        expect(q.sql).toMatch(/FROM zoho_location_stock/i);
        expect(q.sql).toMatch(/WHERE zoho_item_id = \?/i);
        expect(q.params).toEqual([ID_A]);
    });

    it('treats a genuine all-zero mirror as empty', () => {
        expect(isStockEmpty({ net: 0, gross: 0 })).toBe(true);
    });

    it('treats ANY non-zero sum as "has stock"', () => {
        expect(isStockEmpty({ net: 1, gross: 1 })).toBe(false);
        expect(isStockEmpty({ net: 0.01, gross: 0.01 })).toBe(false);
        expect(isStockEmpty({ net: -3, gross: 3 })).toBe(false);
    });

    it('a net-zero item that still holds real stock (+5 / -5) is NOT treated as empty', () => {
        // Two locations cancelling out is not an empty item — gross catches it.
        expect(isStockEmpty({ net: 0, gross: 10 })).toBe(false);
    });

    it('fails SAFE on an unparseable sum (NaN => has stock)', () => {
        expect(isStockEmpty({ net: NaN, gross: NaN })).toBe(false);
        expect(isStockEmpty({ net: 0, gross: NaN })).toBe(false);
    });
});

// ── DRY-RUN: the critical guarantee ──────────────────────────────────────────

describe('DRY-RUN mode makes no Zoho calls and no DB writes', () => {
    it('never calls markItemInactive (or anything else on the Zoho client)', async () => {
        const pool = makePool();
        const zohoAPI = makeZoho();

        const res = await deactivateItem({ pool, zohoAPI, item: ITEM_A, apply: false, log: silentLog() });

        expect(zohoAPI.calls).toEqual([]);
        expect(zohoAPI.markItemInactive).not.toHaveBeenCalled();
        expect(zohoAPI.markItemActive).not.toHaveBeenCalled();
        expect(zohoAPI.createItem).not.toHaveBeenCalled();
        expect(zohoAPI.createInventoryAdjustment).not.toHaveBeenCalled();
        expect(res.status).toBe('planned');
    });

    it('issues SELECTs only — zero INSERT/UPDATE/DELETE', async () => {
        const pool = makePool();
        await deactivateItem({ pool, zohoAPI: makeZoho(), item: ITEM_A, apply: false, log: silentLog() });

        expect(writes(pool)).toEqual([]);
        expect(pool.queries.length).toBeGreaterThan(0);
        for (const q of pool.queries) expect(q.sql).toMatch(/^SELECT/i);
    });

    it('a full dry-run over the whole batch touches Zoho zero times and writes nothing', async () => {
        const pool = makePool({ candidates: [ITEM_A, ITEM_B, ITEM_C] });
        const zohoAPI = makeZoho();

        const items = await fetchCandidates(pool);
        const results = await run({ pool, zohoAPI, apply: false, items, log: silentLog() });

        expect(results).toHaveLength(3);
        expect(results.every(r => r.status === 'planned')).toBe(true);
        expect(zohoAPI.calls).toEqual([]);
        expect(writes(pool)).toEqual([]);
    });

    it('a hard pool that throws on any non-SELECT survives a dry-run untouched', async () => {
        // Independent proof, not relying on the recorder: any write at all blows up.
        const strictPool = {
            query: jest.fn(async (sql, params) => {
                if (!/^\s*SELECT/i.test(sql)) throw new Error(`DRY-RUN WROTE TO THE DB: ${sql}`);
                if (/FROM zoho_location_stock/i.test(sql)) return [[ZERO]];
                if (/FROM zoho_items_map/i.test(sql)) return [[ITEM_A, ITEM_B]];
                return [[]];
            })
        };
        // Any property access that is then called blows up too.
        const explodingZoho = new Proxy({}, {
            get: (_t, prop) => () => { throw new Error(`DRY-RUN CALLED ZOHO: ${String(prop)}`); }
        });

        const items = await fetchCandidates(strictPool);
        const results = await run({ pool: strictPool, zohoAPI: explodingZoho, apply: false, items, log: silentLog() });

        expect(results.map(r => r.status)).toEqual(['planned', 'planned']);
    });

    it('logs the per-item plan to the console (operator watches this live)', async () => {
        const pool = makePool();
        const log = silentLog();
        await deactivateItem({ pool, zohoAPI: makeZoho(), item: ITEM_A, apply: false, log });

        const printed = log.log.mock.calls.map(c => c[0]).join('\n');
        expect(printed).toContain('PLAN');
        expect(printed).toContain(ID_A);
        expect(printed).toContain('00519288237');
        expect(printed).toContain('AP APCOLITE 1 L');
        expect(printed).toContain('markItemInactive');
    });

    it('dry-run still reports an item that HAS stock as skipped, not planned', async () => {
        const pool = makePool({ stock: { net: '4.00', gross: '4.00', row_count: 1 } });
        const res = await deactivateItem({ pool, zohoAPI: makeZoho(), item: ITEM_A, apply: false, log: silentLog() });
        expect(res.status).toBe('skipped_has_stock');
    });
});

// ── APPLY mode ───────────────────────────────────────────────────────────────

describe('APPLY mode', () => {
    it('deactivates in Zoho FIRST, then flips the local mirror', async () => {
        const pool = makePool();
        const zohoAPI = makeZoho();

        const res = await deactivateItem({ pool, zohoAPI, item: ITEM_A, apply: true, log: silentLog() });

        expect(res.status).toBe('deactivated');
        expect(zohoAPI.calls).toEqual([['markItemInactive', ID_A]]);

        const upd = writes(pool);
        expect(upd).toHaveLength(1);
        expect(upd[0].sql).toBe("UPDATE zoho_items_map SET zoho_status = 'inactive' WHERE zoho_item_id = ?");
        expect(upd[0].params).toEqual([ID_A]);

        // ordering: the stock re-check SELECT came before the Zoho call, and the
        // UPDATE is the LAST query issued.
        expect(pool.queries[0].sql).toMatch(/FROM zoho_location_stock/i);
        expect(pool.queries[pool.queries.length - 1].sql).toMatch(/^UPDATE/i);
    });

    it('creates nothing and adjusts no stock — this script only deactivates', async () => {
        const pool = makePool({ candidates: [ITEM_A, ITEM_B] });
        const zohoAPI = makeZoho();

        const items = await fetchCandidates(pool);
        await run({ pool, zohoAPI, apply: true, items, log: silentLog() });

        expect(zohoAPI.createItem).not.toHaveBeenCalled();
        expect(zohoAPI.createInventoryAdjustment).not.toHaveBeenCalled();
        expect(zohoAPI.markItemActive).not.toHaveBeenCalled();
        expect(zohoAPI.calls.map(c => c[0])).toEqual(['markItemInactive', 'markItemInactive']);
        // only the two mirror UPDATEs — no INSERTs into any table
        expect(writes(pool).every(q => /^UPDATE zoho_items_map/i.test(q.sql))).toBe(true);
        expect(writes(pool)).toHaveLength(2);
    });

    it('the mirror UPDATE is parameterized and scoped to one item id', async () => {
        const pool = makePool();
        await deactivateItem({ pool, zohoAPI: makeZoho(), item: ITEM_A, apply: true, log: silentLog() });

        const upd = writes(pool)[0];
        expect(upd.sql).toContain('WHERE zoho_item_id = ?');
        expect(upd.sql).not.toContain(ID_A);           // id is bound, never interpolated
        expect(upd.params).toEqual([ID_A]);
    });

    it('processes every candidate in the batch', async () => {
        const pool = makePool({ candidates: [ITEM_A, ITEM_B, ITEM_C] });
        const zohoAPI = makeZoho();

        const items = await fetchCandidates(pool);
        const results = await run({ pool, zohoAPI, apply: true, items, log: silentLog() });

        expect(results.map(r => r.status)).toEqual(['deactivated', 'deactivated', 'deactivated']);
        expect(zohoAPI.markItemInactive.mock.calls.map(c => c[0])).toEqual([ID_A, ID_B, ID_C]);
    });

    it('honours a 1-item --only pilot', async () => {
        const pool = makePool({ candidates: [ITEM_A, ITEM_B, ITEM_C] });
        const zohoAPI = makeZoho();

        const items = selectItems(await fetchCandidates(pool), parseArgs(['--apply', `--only=${ID_B}`]));
        await run({ pool, zohoAPI, apply: true, items, log: silentLog() });

        expect(zohoAPI.markItemInactive).toHaveBeenCalledTimes(1);
        expect(zohoAPI.markItemInactive).toHaveBeenCalledWith(ID_B);
    });
});

// ── the defensive stock re-check (the load-bearing safety guard) ─────────────

describe('stock re-check before deactivation — the safety guard', () => {
    it('an item in the candidate list that HAS stock at re-check time is SKIPPED, not deactivated', async () => {
        // The candidate SELECT is only a snapshot. By the time the loop reaches
        // this item a sync has landed stock on it — it must NOT be deactivated.
        const pool = makePool({
            candidates: [ITEM_A],
            stock: { net: '12.00', gross: '12.00', row_count: 2 }
        });
        const zohoAPI = makeZoho();

        const items = await fetchCandidates(pool);
        expect(items).toEqual([ITEM_A]);                       // it IS in the candidate list

        const results = await run({ pool, zohoAPI, apply: true, items, log: silentLog() });

        expect(results[0].status).toBe('skipped_has_stock');
        expect(results[0].stock).toEqual({ net: 12, gross: 12, rows: 2 });
        expect(zohoAPI.markItemInactive).not.toHaveBeenCalled();  // no Zoho deactivation
        expect(writes(pool)).toEqual([]);                          // no local mirror flip
    });

    it('skips ONLY the stocked item and still deactivates the rest of the batch', async () => {
        const pool = makePool({
            candidates: [ITEM_A, ITEM_B, ITEM_C],
            stock: id => (id === ID_B
                ? { net: '3.00', gross: '3.00', row_count: 1 }
                : ZERO)
        });
        const zohoAPI = makeZoho();

        const items = await fetchCandidates(pool);
        const results = await run({ pool, zohoAPI, apply: true, items, log: silentLog() });

        expect(results.map(r => r.status)).toEqual(['deactivated', 'skipped_has_stock', 'deactivated']);
        expect(zohoAPI.markItemInactive.mock.calls.map(c => c[0])).toEqual([ID_A, ID_C]);
        expect(writes(pool).map(q => q.params[0])).toEqual([ID_A, ID_C]);
    });

    it('skips an item whose stock nets to zero but is still physically held (+5 / -5)', async () => {
        const pool = makePool({ stock: { net: '0.00', gross: '10.00', row_count: 2 } });
        const zohoAPI = makeZoho();

        const res = await deactivateItem({ pool, zohoAPI, item: ITEM_A, apply: true, log: silentLog() });

        expect(res.status).toBe('skipped_has_stock');
        expect(zohoAPI.markItemInactive).not.toHaveBeenCalled();
    });

    it('skips on negative stock too (never assumes negative means empty)', async () => {
        const pool = makePool({ stock: { net: '-2.00', gross: '2.00', row_count: 1 } });
        const zohoAPI = makeZoho();

        const res = await deactivateItem({ pool, zohoAPI, item: ITEM_A, apply: true, log: silentLog() });

        expect(res.status).toBe('skipped_has_stock');
        expect(zohoAPI.markItemInactive).not.toHaveBeenCalled();
    });

    it('the re-check runs BEFORE the Zoho call, every time', async () => {
        const order = [];
        const pool = {
            query: jest.fn(async (sql) => {
                order.push(/FROM zoho_location_stock/i.test(sql) ? 'stock-check' : 'other-sql');
                if (/FROM zoho_location_stock/i.test(sql)) return [[ZERO]];
                return [{ affectedRows: 1 }];
            })
        };
        const zohoAPI = {
            markItemInactive: jest.fn(async () => { order.push('zoho'); return { code: 0 }; })
        };

        await deactivateItem({ pool, zohoAPI, item: ITEM_A, apply: true, log: silentLog() });

        expect(order).toEqual(['stock-check', 'zoho', 'other-sql']);
    });

    it('a failing stock re-check does NOT deactivate — it fails the item safely', async () => {
        const pool = {
            query: jest.fn(async (sql) => {
                if (/FROM zoho_location_stock/i.test(sql)) throw new Error('DB down');
                return [{ affectedRows: 1 }];
            })
        };
        const zohoAPI = makeZoho();

        const res = await deactivateItem({ pool, zohoAPI, item: ITEM_A, apply: true, log: silentLog() });

        expect(res.status).toBe('failed');
        expect(res.error).toMatch(/stock re-check failed/);
        expect(zohoAPI.markItemInactive).not.toHaveBeenCalled();
    });

    it('refuses to touch a -OWN replacement item even if one is passed in by hand', async () => {
        const pool = makePool();
        const zohoAPI = makeZoho();
        const own = { zoho_item_id: ID_A, zoho_item_name: 'AP APCOLITE 1 L -OWN', zoho_sku: '00519288237-OWN' };

        const res = await deactivateItem({ pool, zohoAPI, item: own, apply: true, log: silentLog() });

        expect(res.status).toBe('failed');
        expect(res.error).toMatch(/-OWN/);
        expect(zohoAPI.markItemInactive).not.toHaveBeenCalled();
        expect(writes(pool)).toEqual([]);
    });
});

// ── failure handling ─────────────────────────────────────────────────────────

describe('failure handling — one item never aborts the batch', () => {
    it('does NOT flip the local mirror when the Zoho call fails', async () => {
        const pool = makePool();
        const zohoAPI = makeZoho();
        zohoAPI.markItemInactive.mockImplementation(async () => { throw new Error('Zoho API error 1002: not allowed'); });

        const res = await deactivateItem({ pool, zohoAPI, item: ITEM_A, apply: true, log: silentLog() });

        expect(res.status).toBe('failed');
        expect(res.error).toContain('not allowed');
        expect(writes(pool)).toEqual([]);
    });

    it('one failing item does not abort the rest of the batch', async () => {
        const pool = makePool({ candidates: [ITEM_A, ITEM_B, ITEM_C] });
        const zohoAPI = makeZoho();
        let n = 0;
        zohoAPI.markItemInactive.mockImplementation(async (id) => {
            n++;
            if (n === 2) throw new Error('Zoho API error 1002: item cannot be marked inactive');
            zohoAPI.calls.push(['markItemInactive', id]);
            return { code: 0 };
        });

        const items = await fetchCandidates(pool);
        const results = await run({ pool, zohoAPI, apply: true, items, log: silentLog() });

        expect(results.map(r => r.status)).toEqual(['deactivated', 'failed', 'deactivated']);
        expect(writes(pool).map(q => q.params[0])).toEqual([ID_A, ID_C]);
    });

    it('a failing mirror UPDATE is reported as failed, not silently swallowed', async () => {
        const pool = {
            query: jest.fn(async (sql) => {
                if (/FROM zoho_location_stock/i.test(sql)) return [[ZERO]];
                throw new Error('deadlock');
            })
        };
        const zohoAPI = makeZoho();

        const res = await deactivateItem({ pool, zohoAPI, item: ITEM_A, apply: true, log: silentLog() });

        expect(res.status).toBe('failed');
        expect(res.error).toContain('deadlock');
        expect(zohoAPI.markItemInactive).toHaveBeenCalledWith(ID_A);
    });
});

// ── summary output ───────────────────────────────────────────────────────────

describe('run() summary', () => {
    it('prints planned/deactivated/skipped_has_stock/failed counts', async () => {
        const pool = makePool({
            candidates: [ITEM_A, ITEM_B, ITEM_C],
            stock: id => (id === ID_C ? { net: '1.00', gross: '1.00', row_count: 1 } : ZERO)
        });
        const zohoAPI = makeZoho();
        zohoAPI.markItemInactive.mockImplementation(async (id) => {
            if (id === ID_B) throw new Error('boom');
            zohoAPI.calls.push(['markItemInactive', id]);
            return { code: 0 };
        });
        const log = silentLog();

        const items = await fetchCandidates(pool);
        const results = await run({ pool, zohoAPI, apply: true, items, log });

        expect(results.map(r => r.status)).toEqual(['deactivated', 'failed', 'skipped_has_stock']);

        const printed = log.log.mock.calls.map(c => c[0]).join('\n');
        expect(printed).toContain('deactivated:       1');
        expect(printed).toContain('skipped_has_stock: 1');
        expect(printed).toContain('failed:            1');
        expect(printed).toContain(`FAILED ${ID_B}: boom`);
        expect(printed).toContain(`SKIPPED (stock) ${ID_C}`);
    });

    it('says loudly which mode it ran in', async () => {
        const dry = silentLog();
        await run({ pool: makePool(), zohoAPI: makeZoho(), apply: false, items: [ITEM_A], log: dry });
        const dryOut = dry.log.mock.calls.map(c => c[0]).join('\n');
        expect(dryOut).toContain('DRY-RUN (no writes)');
        expect(dryOut).toContain('Re-run with --apply to execute.');

        const wet = silentLog();
        await run({ pool: makePool(), zohoAPI: makeZoho(), apply: true, items: [ITEM_A], log: wet });
        const wetOut = wet.log.mock.calls.map(c => c[0]).join('\n');
        expect(wetOut).toContain('APPLY (writes to Zoho)');
        expect(wetOut).not.toContain('Re-run with --apply to execute.');
    });
});
