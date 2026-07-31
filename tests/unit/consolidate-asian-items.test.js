/**
 * Unit tests for the one-time Asian Paints vendor-item consolidation script
 * (scripts/consolidate-asian-items.js).
 *
 * This script writes to LIVE Zoho Books and real inventory, so the contract
 * locked here is deliberately strict:
 *   - DRY-RUN IS THE DEFAULT and makes ZERO Zoho calls and ZERO DB writes.
 *   - --apply must be explicit.
 *   - Apply-mode ordering is mandatory: createItem -> mirror ->
 *     (increase NEW, decrease OLD per location) -> markItemInactive.
 *     The old item is never deactivated before the adjustments succeeded.
 *   - Adjustment payloads keep the proven routes/stock-migration.js shape,
 *     with BOTH sides on the SAME location_id.
 *   - Resumability: completed items are skipped; a half-done item (log row
 *     already carries new_item_id) is NEVER auto-retried.
 *   - One item failing never aborts the batch.
 *
 * Everything is mocked — no DB, no network.
 */

const script = require('../../scripts/consolidate-asian-items');

const {
    ITEMS, newSkuFor, buildNewItemPayload, buildAdjustmentPair,
    parseArgs, selectItems, consolidateItem, run
} = script;

const OLD_ID = '2032688000000687828';
const OLD_SKU = '00519288237';
const NEW_ID = '9999000000000001';
const ENTRY = { old_item_id: OLD_ID, old_sku: OLD_SKU, category_assigned: 'EXTERIOR EMULSION' };

const OLD_ITEM_ROW = {
    zoho_item_id: OLD_ID,
    zoho_item_name: 'AP APEX AB12 900 ML',
    zoho_sku: OLD_SKU,
    zoho_rate: 512.5,
    zoho_purchase_rate: 400,
    zoho_label_rate: 600,
    zoho_unit: 'nos',
    zoho_description: 'EXTERIOR EMULSION ASIAN 0.9 L',
    zoho_hsn_or_sac: '3209',
    zoho_tax_percentage: 18,
    zoho_brand: 'ASIAN PAINTS',
    zoho_category_name: null,
    zoho_manufacturer: 'ASIAN PAINTS',
    zoho_reorder_level: 3,
    zoho_cf_dpl: 350,
    zoho_status: 'active'
};

const silentLog = () => ({ log: jest.fn(), warn: jest.fn(), error: jest.fn() });

/**
 * Fake pool: routes each SELECT to canned rows and records every query.
 * Anything that is not a SELECT counts as a WRITE.
 */
function makePool({ logRow = null, oldItem = OLD_ITEM_ROW, stock = [] } = {}) {
    const queries = [];
    const pool = {
        queries,
        query: jest.fn(async (sql, params) => {
            queries.push({ sql: sql.replace(/\s+/g, ' ').trim(), params });
            if (/FROM zoho_item_consolidation_log/i.test(sql)) return [logRow ? [logRow] : []];
            if (/FROM zoho_items_map/i.test(sql)) return [oldItem ? [oldItem] : []];
            if (/FROM zoho_location_stock/i.test(sql)) return [stock];
            return [{ affectedRows: 1 }];
        })
    };
    return pool;
}

const writes = pool => pool.queries.filter(q => !/^SELECT/i.test(q.sql));

function makeZoho({ createItemResp = { item: { item_id: NEW_ID } } } = {}) {
    const calls = [];
    return {
        calls,
        createItem: jest.fn(async (p) => { calls.push(['createItem', p]); return createItemResp; }),
        createInventoryAdjustment: jest.fn(async (p) => {
            calls.push(['createInventoryAdjustment', p]);
            return { inventory_adjustment: { inventory_adjustment_id: `ADJ${calls.length}` } };
        }),
        markItemInactive: jest.fn(async (id) => { calls.push(['markItemInactive', id]); return { code: 0 }; }),
        markItemActive: jest.fn(async (id) => { calls.push(['markItemActive', id]); return { code: 0 }; })
    };
}

// ── the embedded 46-item list ────────────────────────────────────────────────

describe('embedded item list', () => {
    it('carries exactly 46 items with unique ids and unique SKUs', () => {
        expect(ITEMS).toHaveLength(46);
        expect(new Set(ITEMS.map(i => i.old_item_id)).size).toBe(46);
        expect(new Set(ITEMS.map(i => i.old_sku)).size).toBe(46);
    });

    it('every entry has an old_item_id, old_sku and a non-empty category_assigned', () => {
        for (const i of ITEMS) {
            expect(typeof i.old_item_id).toBe('string');
            expect(i.old_item_id).toMatch(/^\d{19}$/);
            expect(typeof i.old_sku).toBe('string');
            expect(i.old_sku.length).toBeGreaterThan(0);
            expect(typeof i.category_assigned).toBe('string');
            expect(i.category_assigned.trim().length).toBeGreaterThan(0);
        }
    });

    it('pins the first/last rows and the category set (guards against a silent list edit)', () => {
        expect(ITEMS[0]).toEqual({ old_item_id: '2032688000000687828', old_sku: '00519288237', category_assigned: 'EXTERIOR EMULSION' });
        expect(ITEMS[45]).toEqual({ old_item_id: '2032688000000673956', old_sku: '10909612214', category_assigned: 'EXTERIOR EMULSION' });
        expect(new Set(ITEMS.map(i => i.category_assigned))).toEqual(new Set([
            'EXTERIOR EMULSION', 'ENAMEL', 'PREMIUM EMULSION BW1', 'INTERIOR EMULSION',
            'WOOD POLISH - SEALER, GLOSSY, MAT', 'CONSTRUCTION CHEMICALS'
        ]));
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

    it('only --apply flips to write mode', () => {
        const o = parseArgs(['--apply']);
        expect(o.apply).toBe(true);
        expect(o.dryRun).toBe(false);
    });

    it('does NOT treat a near-miss flag as --apply', () => {
        expect(parseArgs(['--applyy']).apply).toBe(false);
        expect(parseArgs(['apply']).apply).toBe(false);
    });

    it('parses --limit and --only (comma separated)', () => {
        const o = parseArgs(['--apply', '--limit=10', '--only=111,222']);
        expect(o.limit).toBe(10);
        expect(o.only).toEqual(['111', '222']);
    });
});

describe('selectItems', () => {
    it('returns all items with no filters', () => {
        expect(selectItems(ITEMS, {})).toHaveLength(46);
    });
    it('--only selects the single pilot item', () => {
        const sel = selectItems(ITEMS, { only: [OLD_ID] });
        expect(sel).toHaveLength(1);
        expect(sel[0].old_item_id).toBe(OLD_ID);
    });
    it('--limit caps the batch size (batching guardrail)', () => {
        expect(selectItems(ITEMS, { limit: 10 })).toHaveLength(10);
    });
});

// ── payload builders ─────────────────────────────────────────────────────────

describe('buildNewItemPayload', () => {
    it('builds the owner-editable replacement: -OWN sku, ASIAN PAINTS brand, assigned category, copied fields', () => {
        const p = buildNewItemPayload(OLD_ITEM_ROW, ENTRY);
        expect(p).toEqual({
            item_type: 'inventory',
            name: 'AP APEX AB12 900 ML',
            sku: '00519288237-OWN',
            brand: 'ASIAN PAINTS',
            category_name: 'EXTERIOR EMULSION',
            rate: 512.5,
            purchase_rate: 400,
            unit: 'nos',
            description: 'EXTERIOR EMULSION ASIAN 0.9 L',
            hsn_or_sac: '3209',
            tax_percentage: 18
        });
    });

    it('newSkuFor appends exactly one -OWN suffix', () => {
        expect(newSkuFor('00519288237')).toBe('00519288237-OWN');
    });

    it('keeps the old name unchanged (no rename in this pass)', () => {
        const p = buildNewItemPayload({ ...OLD_ITEM_ROW, zoho_item_name: '  SOME NAME  ' }, ENTRY);
        expect(p.name).toBe('SOME NAME');
    });

    it('omits empty optional fields but always sends rate', () => {
        const p = buildNewItemPayload({ zoho_item_name: 'X', zoho_rate: 0 }, ENTRY);
        expect(p.rate).toBe(0);
        expect(p).not.toHaveProperty('unit');
        expect(p).not.toHaveProperty('description');
        expect(p).not.toHaveProperty('hsn_or_sac');
        expect(p).not.toHaveProperty('purchase_rate');
    });
});

describe('buildAdjustmentPair — stock-migration.js proven shape', () => {
    const pair = buildAdjustmentPair({
        newItemId: NEW_ID, oldItemId: OLD_ID, locationId: 'LOC1',
        quantity: 12, oldSku: OLD_SKU, date: '2026-07-31'
    });

    it('increase adds the quantity to the NEW item at that location', () => {
        expect(pair.increase).toEqual({
            date: '2026-07-31',
            reason: `Consolidation IN: ${OLD_SKU}`,
            description: `Asian Paints vendor-item consolidation ${OLD_ID} -> ${NEW_ID}`,
            adjustment_type: 'quantity',
            location_id: 'LOC1',
            line_items: [{ item_id: NEW_ID, location_id: 'LOC1', quantity_adjusted: 12 }]
        });
    });

    it('decrease removes the SAME quantity from the OLD item at the SAME location', () => {
        expect(pair.decrease.adjustment_type).toBe('quantity');
        expect(pair.decrease.location_id).toBe('LOC1');
        expect(pair.decrease.line_items).toEqual([
            { item_id: OLD_ID, location_id: 'LOC1', quantity_adjusted: -12 }
        ]);
        // both sides act on the same location — this is an item-to-item move
        expect(pair.decrease.location_id).toBe(pair.increase.location_id);
        expect(pair.decrease.line_items[0].quantity_adjusted)
            .toBe(-pair.increase.line_items[0].quantity_adjusted);
    });

    it('normalises a negative input quantity (never flips the direction of the pair)', () => {
        const p = buildAdjustmentPair({
            newItemId: NEW_ID, oldItemId: OLD_ID, locationId: 'L', quantity: -5, oldSku: 'S', date: '2026-07-31'
        });
        expect(p.increase.line_items[0].quantity_adjusted).toBe(5);
        expect(p.decrease.line_items[0].quantity_adjusted).toBe(-5);
    });

    it('truncates reason to Zoho\'s 50-char limit', () => {
        const p = buildAdjustmentPair({
            newItemId: NEW_ID, oldItemId: OLD_ID, locationId: 'L',
            quantity: 1, oldSku: 'X'.repeat(80), date: '2026-07-31'
        });
        expect(p.increase.reason.length).toBeLessThanOrEqual(50);
        expect(p.decrease.reason.length).toBeLessThanOrEqual(50);
    });
});

// ── DRY-RUN: the critical guarantee ──────────────────────────────────────────

describe('DRY-RUN mode makes no Zoho calls and no DB writes', () => {
    it('never calls createItem / createInventoryAdjustment / markItemInactive', async () => {
        const pool = makePool({ stock: [{ zoho_location_id: 'LOC1', stock_on_hand: '12' }] });
        const zohoAPI = makeZoho();

        const res = await consolidateItem({ pool, zohoAPI, entry: ENTRY, apply: false, log: silentLog() });

        expect(zohoAPI.createItem).not.toHaveBeenCalled();
        expect(zohoAPI.createInventoryAdjustment).not.toHaveBeenCalled();
        expect(zohoAPI.markItemInactive).not.toHaveBeenCalled();
        expect(zohoAPI.markItemActive).not.toHaveBeenCalled();
        expect(res.status).toBe('planned');
    });

    it('issues SELECTs only — zero INSERT/UPDATE/DELETE', async () => {
        const pool = makePool({ stock: [{ zoho_location_id: 'LOC1', stock_on_hand: '12' }] });
        await consolidateItem({ pool, zohoAPI: makeZoho(), entry: ENTRY, apply: false, log: silentLog() });

        expect(writes(pool)).toEqual([]);
        expect(pool.queries.length).toBeGreaterThan(0);
        for (const q of pool.queries) expect(q.sql).toMatch(/^SELECT/i);
    });

    it('returns the computed plan: new payload + per-location adjustments + total', async () => {
        const pool = makePool({
            stock: [
                { zoho_location_id: 'LOC1', stock_on_hand: '12' },
                { zoho_location_id: 'LOC2', stock_on_hand: '3.5' }
            ]
        });
        const res = await consolidateItem({ pool, zohoAPI: makeZoho(), entry: ENTRY, apply: false, log: silentLog() });

        expect(res.plan.payload.sku).toBe('00519288237-OWN');
        expect(res.plan.payload.category_name).toBe('EXTERIOR EMULSION');
        expect(res.plan.payload.brand).toBe('ASIAN PAINTS');
        expect(res.plan.locations).toEqual([
            { location_id: 'LOC1', quantity: 12 },
            { location_id: 'LOC2', quantity: 3.5 }
        ]);
        expect(res.plan.total_quantity).toBe(15.5);
    });

    it('logs the per-item plan to the console (operator watches this live)', async () => {
        const pool = makePool({ stock: [{ zoho_location_id: 'LOC1', stock_on_hand: '12' }] });
        const log = silentLog();
        await consolidateItem({ pool, zohoAPI: makeZoho(), entry: ENTRY, apply: false, log });

        const printed = log.log.mock.calls.map(c => c[0]).join('\n');
        expect(printed).toContain('PLAN');
        expect(printed).toContain('00519288237-OWN');
        expect(printed).toContain('LOC1');
        expect(printed).toContain('markItemInactive');
    });

    it('handles an item with no stock rows without planning any adjustment', async () => {
        const pool = makePool({ stock: [] });
        const res = await consolidateItem({ pool, zohoAPI: makeZoho(), entry: ENTRY, apply: false, log: silentLog() });
        expect(res.plan.locations).toEqual([]);
        expect(res.plan.total_quantity).toBe(0);
    });

    it('a full dry-run over all 46 items touches Zoho zero times', async () => {
        const pool = makePool({ stock: [{ zoho_location_id: 'LOC1', stock_on_hand: '2' }] });
        const zohoAPI = makeZoho();

        const results = await run({ pool, zohoAPI, apply: false, items: ITEMS, log: silentLog() });

        expect(results).toHaveLength(46);
        expect(results.every(r => r.status === 'planned')).toBe(true);
        expect(zohoAPI.calls).toEqual([]);
        expect(writes(pool)).toEqual([]);
    });
});

// ── APPLY mode ordering ──────────────────────────────────────────────────────

describe('APPLY mode', () => {
    it('follows the mandatory safety order: create -> mirror -> adjust(in,out) -> deactivate', async () => {
        const pool = makePool({ stock: [{ zoho_location_id: 'LOC1', stock_on_hand: '12' }] });
        const zohoAPI = makeZoho();

        const res = await consolidateItem({ pool, zohoAPI, entry: ENTRY, apply: true, log: silentLog() });

        expect(res.status).toBe('completed');
        expect(res.new_item_id).toBe(NEW_ID);

        const order = zohoAPI.calls.map(c => c[0]);
        expect(order).toEqual([
            'createItem',
            'createInventoryAdjustment', // increase NEW
            'createInventoryAdjustment', // decrease OLD
            'markItemInactive'
        ]);

        // increase targets the NEW item, decrease the OLD one, same location
        expect(zohoAPI.calls[1][1].line_items[0]).toEqual({ item_id: NEW_ID, location_id: 'LOC1', quantity_adjusted: 12 });
        expect(zohoAPI.calls[2][1].line_items[0]).toEqual({ item_id: OLD_ID, location_id: 'LOC1', quantity_adjusted: -12 });
        expect(zohoAPI.calls[3][1]).toBe(OLD_ID);

        // mirror INSERT happened before the first adjustment
        const mirrorIdx = pool.queries.findIndex(q => /INSERT INTO zoho_items_map/i.test(q.sql));
        expect(mirrorIdx).toBeGreaterThanOrEqual(0);
    });

    it('mirrors the new item into zoho_items_map with the new sku, brand and category', async () => {
        const pool = makePool({ stock: [] });
        await consolidateItem({ pool, zohoAPI: makeZoho(), entry: ENTRY, apply: true, log: silentLog() });

        const mirror = pool.queries.find(q => /INSERT INTO zoho_items_map/i.test(q.sql));
        expect(mirror).toBeDefined();
        expect(mirror.params[0]).toBe(NEW_ID);
        expect(mirror.params[1]).toBe('AP APEX AB12 900 ML');
        expect(mirror.params[2]).toBe('00519288237-OWN');
        expect(mirror.params).toContain('ASIAN PAINTS');
        expect(mirror.params).toContain('EXTERIOR EMULSION');
    });

    it('flips the OLD row to zoho_status=inactive locally and logs status=completed', async () => {
        const pool = makePool({ stock: [{ zoho_location_id: 'LOC1', stock_on_hand: '4' }] });
        await consolidateItem({ pool, zohoAPI: makeZoho(), entry: ENTRY, apply: true, log: silentLog() });

        const upd = pool.queries.find(q => /UPDATE zoho_items_map SET zoho_status = 'inactive'/i.test(q.sql));
        expect(upd).toBeDefined();
        expect(upd.params).toEqual([OLD_ID]);

        const logIns = pool.queries.find(q => /INSERT INTO zoho_item_consolidation_log/i.test(q.sql));
        expect(logIns).toBeDefined();
        expect(logIns.params[0]).toBe(OLD_ID);
        expect(logIns.params[1]).toBe(NEW_ID);
        expect(logIns.params[6]).toBe('completed');
        expect(JSON.parse(logIns.params[5])).toEqual([
            { location_id: 'LOC1', quantity: 4, increase_adjustment_id: 'ADJ2', decrease_adjustment_id: 'ADJ3' }
        ]);
    });

    it('does one increase+decrease pair per stocked location', async () => {
        const pool = makePool({
            stock: [
                { zoho_location_id: 'LOC1', stock_on_hand: '12' },
                { zoho_location_id: 'LOC2', stock_on_hand: '5' }
            ]
        });
        const zohoAPI = makeZoho();
        await consolidateItem({ pool, zohoAPI, entry: ENTRY, apply: true, log: silentLog() });

        expect(zohoAPI.createInventoryAdjustment).toHaveBeenCalledTimes(4);
        const locs = zohoAPI.createInventoryAdjustment.mock.calls.map(c => c[0].location_id);
        expect(locs).toEqual(['LOC1', 'LOC1', 'LOC2', 'LOC2']);
    });

    it('an item with zero stock still gets created + deactivated, with no adjustments', async () => {
        const pool = makePool({ stock: [] });
        const zohoAPI = makeZoho();
        const res = await consolidateItem({ pool, zohoAPI, entry: ENTRY, apply: true, log: silentLog() });

        expect(zohoAPI.createInventoryAdjustment).not.toHaveBeenCalled();
        expect(zohoAPI.markItemInactive).toHaveBeenCalledWith(OLD_ID);
        expect(res.status).toBe('completed');
    });
});

// ── failure handling ─────────────────────────────────────────────────────────

describe('failure handling — never deactivate on a failed move', () => {
    it('does NOT deactivate the old item when createItem returns no item_id', async () => {
        const pool = makePool({ stock: [{ zoho_location_id: 'LOC1', stock_on_hand: '12' }] });
        const zohoAPI = makeZoho({ createItemResp: { code: 0 } });

        const res = await consolidateItem({ pool, zohoAPI, entry: ENTRY, apply: true, log: silentLog() });

        expect(res.status).toBe('failed');
        expect(zohoAPI.markItemInactive).not.toHaveBeenCalled();
        expect(zohoAPI.createInventoryAdjustment).not.toHaveBeenCalled();

        const logIns = pool.queries.find(q => /INSERT INTO zoho_item_consolidation_log/i.test(q.sql));
        expect(logIns.params[6]).toBe('failed');
    });

    it('does NOT deactivate when the decrease adjustment fails, and records what did move', async () => {
        const pool = makePool({ stock: [{ zoho_location_id: 'LOC1', stock_on_hand: '12' }] });
        const zohoAPI = makeZoho();
        zohoAPI.createInventoryAdjustment
            .mockImplementationOnce(async () => ({ inventory_adjustment: { inventory_adjustment_id: 'ADJ_IN' } }))
            .mockImplementationOnce(async () => { throw new Error('Zoho API error 1002: insufficient stock'); });

        const res = await consolidateItem({ pool, zohoAPI, entry: ENTRY, apply: true, log: silentLog() });

        expect(res.status).toBe('failed');
        expect(res.error).toContain('insufficient stock');
        expect(zohoAPI.markItemInactive).not.toHaveBeenCalled();

        const logIns = pool.queries.find(q => /INSERT INTO zoho_item_consolidation_log/i.test(q.sql));
        expect(logIns.params[1]).toBe(NEW_ID);          // new_item_id recorded for recovery
        expect(logIns.params[6]).toBe('failed');
        expect(String(logIns.params[7])).toContain('insufficient stock');
    });

    it('fails cleanly when the old item is missing from zoho_items_map', async () => {
        const pool = makePool({ oldItem: null });
        const zohoAPI = makeZoho();
        const res = await consolidateItem({ pool, zohoAPI, entry: ENTRY, apply: true, log: silentLog() });

        expect(res.status).toBe('failed');
        expect(res.error).toMatch(/not found/);
        expect(zohoAPI.createItem).not.toHaveBeenCalled();
    });

    it('one failing item does not abort the rest of the batch', async () => {
        const pool = makePool({ stock: [{ zoho_location_id: 'LOC1', stock_on_hand: '1' }] });
        const zohoAPI = makeZoho();
        let n = 0;
        zohoAPI.createItem.mockImplementation(async () => {
            n++;
            if (n === 2) throw new Error('Zoho API error 1001: SKU already exists');
            return { item: { item_id: `NEW${n}` } };
        });

        const results = await run({ pool, zohoAPI, apply: true, items: ITEMS.slice(0, 3), log: silentLog() });

        expect(results.map(r => r.status)).toEqual(['completed', 'failed', 'completed']);
    });
});

// ── resumability ─────────────────────────────────────────────────────────────

describe('resumability', () => {
    it('skips an item already logged as completed (no Zoho calls, no writes)', async () => {
        const pool = makePool({ logRow: { old_item_id: OLD_ID, new_item_id: NEW_ID, status: 'completed' } });
        const zohoAPI = makeZoho();

        const res = await consolidateItem({ pool, zohoAPI, entry: ENTRY, apply: true, log: silentLog() });

        expect(res.status).toBe('skipped');
        expect(zohoAPI.calls).toEqual([]);
        expect(writes(pool)).toEqual([]);
    });

    it('NEVER auto-retries a half-done item (log row has new_item_id but status != completed)', async () => {
        const pool = makePool({ logRow: { old_item_id: OLD_ID, new_item_id: NEW_ID, status: 'failed' } });
        const zohoAPI = makeZoho();

        const res = await consolidateItem({ pool, zohoAPI, entry: ENTRY, apply: true, log: silentLog() });

        expect(res.status).toBe('needs_review');
        expect(res.new_item_id).toBe(NEW_ID);
        expect(zohoAPI.createItem).not.toHaveBeenCalled();
        expect(zohoAPI.createInventoryAdjustment).not.toHaveBeenCalled();
        expect(zohoAPI.markItemInactive).not.toHaveBeenCalled();
        expect(writes(pool)).toEqual([]);
    });

    it('retries an item that failed BEFORE any Zoho item was created', async () => {
        const pool = makePool({
            logRow: { old_item_id: OLD_ID, new_item_id: null, status: 'failed' },
            stock: [{ zoho_location_id: 'LOC1', stock_on_hand: '2' }]
        });
        const zohoAPI = makeZoho();

        const res = await consolidateItem({ pool, zohoAPI, entry: ENTRY, apply: true, log: silentLog() });

        expect(res.status).toBe('completed');
        expect(zohoAPI.createItem).toHaveBeenCalledTimes(1);
    });
});

// ── migration ────────────────────────────────────────────────────────────────

describe('migration 20260731_zoho_item_consolidation_log', () => {
    const migration = require('../../migrations/20260731_zoho_item_consolidation_log');

    function makeMigPool({ exists }) {
        const calls = [];
        return {
            calls,
            query: jest.fn(async (sql, params) => {
                const s = String(sql).replace(/\s+/g, ' ').trim();
                calls.push({ s, params });
                if (/information_schema\.TABLES/i.test(s)) return [exists ? [{ ok: 1 }] : []];
                return [{ affectedRows: 0 }];
            })
        };
    }

    test('exports up()', () => expect(typeof migration.up).toBe('function'));

    test('fresh DB creates the table with the UNIQUE key that makes the script resumable', async () => {
        const pool = makeMigPool({ exists: false });
        await migration.up(pool);

        const create = pool.calls.find(c => /CREATE TABLE zoho_item_consolidation_log/i.test(c.s));
        expect(create).toBeDefined();
        expect(create.s).toMatch(/old_item_id VARCHAR\(50\) NOT NULL/i);
        expect(create.s).toMatch(/UNIQUE KEY uk_old_item_id \(old_item_id\)/i);
        expect(create.s).toMatch(/status ENUM\('pending','completed','failed'\)/i);
    });

    test('already-applied DB: no CREATE runs (idempotent)', async () => {
        const pool = makeMigPool({ exists: true });
        await migration.up(pool);
        expect(pool.calls.some(c => /CREATE TABLE/i.test(c.s))).toBe(false);
    });

    test('is additive only — no DROP/ALTER/TRUNCATE/DELETE anywhere', async () => {
        const pool = makeMigPool({ exists: false });
        await migration.up(pool);
        for (const c of pool.calls) {
            expect(c.s).not.toMatch(/\b(DROP|TRUNCATE|DELETE|ALTER)\b/i);
        }
    });
});
