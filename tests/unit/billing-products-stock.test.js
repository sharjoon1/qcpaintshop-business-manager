/**
 * B1a GET /api/billing/products — routes/billing.js.
 *
 * Locks the stock-aware product-picker query:
 *   - the SELECT keeps every pre-B1a key (id, zoho_item_id, item_name, sku,
 *     rate, brand, category, unit) and adds pack_size (pre-aggregated
 *     pack_sizes LEFT JOIN) + stock_on_hand / stock / stock_as_of
 *     (zoho_location_stock LEFT JOIN keyed on the caller's location);
 *   - the location param is bound FIRST (the JOIN ? precedes the WHERE ?s);
 *   - staff resolve their own branch → branches.zoho_location_id →
 *     zoho_locations_map fallback; admin without ?branch_id binds the ''
 *     sentinel and skips the lookups entirely;
 *   - lookup failures never break the search (falls back to '').
 *
 * Handler invoked directly via router stack walk (item-master-search pattern).
 */

const billing = require('../../routes/billing');

const findRoute = (method, path) => billing.router.stack
    .map(l => l.route)
    .find(rt => rt && rt.path === path && rt.methods[method]);
const lastHandler = (route) => route.stack[route.stack.length - 1].handle;

function mockRes() {
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
}

function makePool({ branchLoc = null, mapLoc = null, branchesThrow = false, rows = [] } = {}) {
    const calls = [];
    return {
        calls,
        query: async (sql, params) => {
            const s = String(sql);
            calls.push({ sql: s, params });
            if (/FROM branches WHERE id/.test(s)) {
                if (branchesThrow) throw new Error('branches unavailable');
                return [branchLoc ? [{ zoho_location_id: branchLoc }] : []];
            }
            if (/FROM zoho_locations_map WHERE local_branch_id/.test(s)) {
                return [mapLoc ? [{ zoho_location_id: mapLoc }] : []];
            }
            if (/FROM zoho_items_map/.test(s)) return [rows];
            return [[]];
        }
    };
}

async function runProducts(query, user, poolOpts = {}) {
    const pool = makePool(poolOpts);
    billing.setPool(pool);
    const route = findRoute('get', '/products');
    expect(route).toBeTruthy();
    const res = mockRes();
    await lastHandler(route)({ user, query }, res);
    const dataCall = pool.calls.find(c => /FROM zoho_items_map/.test(c.sql));
    return { pool, res, dataCall };
}

const staffUser = { id: 7, role: 'staff', branch_id: 4 };
const adminUser = { id: 1, role: 'admin', branch_id: null };

beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('GET /products — stock-aware picker query', () => {
    it('SQL contains BOTH new LEFT JOINs (pre-aggregated pack_sizes + zoho_location_stock)', async () => {
        const { res, dataCall } = await runProducts({ search: 'apex' }, staffUser, { branchLoc: 'LOC9' });
        expect(res.statusCode).toBe(200);
        expect(dataCall.sql).toContain('FROM pack_sizes');
        expect(dataCall.sql).toContain('GROUP BY zoho_item_id');
        expect(dataCall.sql).toContain('LEFT JOIN zoho_location_stock');
        expect(dataCall.sql).toContain('zls.zoho_location_id = ?');
        // new select keys
        expect(dataCall.sql).toContain('ps.pack_size');
        expect(dataCall.sql).toContain('zls.stock_on_hand');
        expect(dataCall.sql).toContain('zls.available_for_sale AS stock');
        expect(dataCall.sql).toContain('zls.last_synced_at AS stock_as_of');
        // B1.1 #6: printable item description for the picker + line prefill
        expect(dataCall.sql).toContain('zim.zoho_description AS description');
        // pre-B1a keys unchanged
        expect(dataCall.sql).toContain('zim.zoho_item_name AS item_name');
        expect(dataCall.sql).toContain('zim.zoho_sku AS sku');
        expect(dataCall.sql).toContain('zim.zoho_rate AS rate');
        expect(dataCall.sql).toContain("zim.zoho_status = 'active'");
        expect(dataCall.sql).toContain('LIMIT 50');
    });

    it('staff: own branch resolves via branches.zoho_location_id — bound as the FIRST param', async () => {
        const { pool, dataCall } = await runProducts({ search: 'apex' }, staffUser, { branchLoc: 'LOC9' });
        const br = pool.calls.find(c => /FROM branches WHERE id/.test(c.sql));
        expect(br.params).toEqual([4]); // staff locked to own branch
        expect(dataCall.params).toEqual(['LOC9', '%apex%', '%apex%']);
    });

    it('zoho_locations_map (local_branch_id, active) is the fallback when branches has no mapping', async () => {
        const { pool, dataCall } = await runProducts({}, staffUser, { branchLoc: null, mapLoc: 'LOC-M' });
        const lm = pool.calls.find(c => /FROM zoho_locations_map WHERE local_branch_id/.test(c.sql));
        expect(lm.sql).toContain('is_active = 1');
        expect(lm.params).toEqual([4]);
        expect(dataCall.params).toEqual(['LOC-M']);
    });

    it("admin without ?branch_id binds the '' sentinel and skips the lookups", async () => {
        const { pool, dataCall } = await runProducts({ search: 'apex' }, adminUser);
        expect(pool.calls.some(c => /FROM branches/.test(c.sql))).toBe(false);
        expect(pool.calls.some(c => /local_branch_id/.test(c.sql))).toBe(false);
        expect(dataCall.params).toEqual(['', '%apex%', '%apex%']);
    });

    it('admin WITH ?branch_id resolves that branch', async () => {
        const { pool, dataCall } = await runProducts({ branch_id: '7' }, adminUser, { branchLoc: 'LOC7' });
        const br = pool.calls.find(c => /FROM branches WHERE id/.test(c.sql));
        expect(br.params).toEqual([7]);
        expect(dataCall.params).toEqual(['LOC7']);
    });

    it('search + brand filters keep their clause order AFTER the location param', async () => {
        const { dataCall } = await runProducts({ search: 'shield', brand: 'Birla Opus' }, staffUser, { branchLoc: 'LOC9' });
        expect(dataCall.sql).toContain('zim.zoho_item_name LIKE ? OR zim.zoho_sku LIKE ?');
        expect(dataCall.sql).toContain('zim.zoho_brand = ?');
        expect(dataCall.params).toEqual(['LOC9', '%shield%', '%shield%', 'Birla Opus']);
    });

    it("a location-lookup failure falls back to '' and the search still succeeds", async () => {
        const { res, dataCall } = await runProducts({ search: 'apex' }, staffUser, { branchesThrow: true });
        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(dataCall.params).toEqual(['', '%apex%', '%apex%']);
    });

    it('response keys: backward compatible + the new stock/pack/description keys pass through', async () => {
        const row = {
            id: 1, zoho_item_id: 'Z1', item_name: 'Apex 1L', sku: 'AP1', rate: 400,
            brand: 'Asian', category: 'Emulsion', unit: 'L',
            description: 'Asian Paints Apex Exterior Emulsion 1L White',
            pack_size: '1 L', stock_on_hand: 12, stock: 10, stock_as_of: '2026-08-12 05:00:00',
        };
        const { res } = await runProducts({}, staffUser, { branchLoc: 'LOC9', rows: [row] });
        expect(res.body.success).toBe(true);
        expect(res.body.products).toEqual([row]);
        for (const key of ['id', 'zoho_item_id', 'item_name', 'sku', 'rate', 'brand', 'category', 'unit',
            'description', 'pack_size', 'stock_on_hand', 'stock', 'stock_as_of']) {
            expect(res.body.products[0]).toHaveProperty(key);
        }
    });
});
