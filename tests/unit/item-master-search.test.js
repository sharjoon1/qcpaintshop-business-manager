/**
 * P1 (staff-facing half) — GET /api/item-master/items search clause.
 *
 * Items are named in Zoho's terse SKU-ish convention ("IE01 RD1 ROYALE 01 L"),
 * while the friendly name lives in the cf_product_name custom field
 * (zoho_items_map.zoho_cf_product_name, now actually populated by syncItems —
 * see zoho-items-cf-product-name.test.js). The list endpoint already SELECTs
 * that column but did not search it, so staff could not find an item by the
 * name they actually use.
 *
 * Locks the CURRENT filter/pagination behavior of the handler and the widened
 * search clause. Handlers are invoked directly (router stack walk), bypassing
 * auth + validateQuery — same pattern as zoho-items-hsn.test.js.
 */
const itemMaster = require('../../routes/item-master');

const findRoute = (method, path) => itemMaster.router.stack
    .map(l => l.route)
    .find(rt => rt && rt.path === path && rt.methods[method]);

const lastHandler = (route) => route.stack[route.stack.length - 1].handle;

function mockRes() {
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
}

/** Calls GET /items with `query`; returns every pool.query() made. */
async function runList(query) {
    const calls = [];
    itemMaster.setPool({
        query: async (sql, params) => {
            calls.push({ sql, params });
            if (/COUNT\(\*\)/i.test(sql)) return [[{ total: 0 }]];
            return [[]];
        }
    });
    const route = findRoute('get', '/items');
    expect(route).toBeTruthy();
    const res = mockRes();
    await lastHandler(route)({ query }, res);
    return { calls, res, countCall: calls[0], dataCall: calls[1] };
}

beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('GET /items — search clause', () => {
    it('searches item name, SKU, description AND the friendly cf_product_name', async () => {
        const { res, countCall, dataCall } = await runList({ search: 'royale' });

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);

        const expected = '(zoho_item_name LIKE ? OR zoho_sku LIKE ? OR zoho_description LIKE ? OR zoho_cf_product_name LIKE ?)';
        expect(countCall.sql).toContain(expected);
        expect(dataCall.sql).toContain(expected);

        // one bound %term% per LIKE, same clause on both queries
        expect(countCall.params).toEqual(['%royale%', '%royale%', '%royale%', '%royale%']);
        // the data query appends LIMIT/OFFSET after the same params
        expect(dataCall.params).toEqual(['%royale%', '%royale%', '%royale%', '%royale%', 50, 0]);
    });

    it('omits the search clause entirely when no search term is given', async () => {
        const { countCall, dataCall } = await runList({});
        expect(countCall.sql).not.toContain('LIKE');
        expect(dataCall.sql).not.toContain('LIKE');
        expect(countCall.params).toEqual([]);
        expect(dataCall.params).toEqual([50, 0]);
    });

    it('still returns zoho_cf_product_name in the SELECT so the UI can show it', async () => {
        const { dataCall } = await runList({});
        expect(dataCall.sql).toContain('zoho_cf_product_name');
    });

    it('combines search with the brand/category filters, params in clause order', async () => {
        const { countCall } = await runList({ brand: 'Birla Opus', category: 'Emulsion', search: 'shield' });
        expect(countCall.sql).toContain('zoho_brand = ?');
        expect(countCall.sql).toContain('zoho_category_name = ?');
        expect(countCall.params).toEqual([
            'Birla Opus', 'Emulsion', '%shield%', '%shield%', '%shield%', '%shield%'
        ]);
    });

    it('keeps the status filters unparameterized and unchanged', async () => {
        const missingDpl = await runList({ status: 'missing_dpl' });
        expect(missingDpl.countCall.sql).toContain('(zoho_cf_dpl IS NULL OR zoho_cf_dpl = 0)');
        expect(missingDpl.countCall.params).toEqual([]);

        const noSku = await runList({ status: 'no_sku' });
        expect(noSku.countCall.sql).toContain("(zoho_sku IS NULL OR zoho_sku = '')");
    });

    it('whitelists the sort column and falls back to zoho_item_name', async () => {
        const injected = await runList({ sort: 'zoho_rate; DROP TABLE zoho_items_map', order: 'desc' });
        expect(injected.dataCall.sql).toContain('ORDER BY zoho_item_name DESC');
        expect(injected.dataCall.sql).not.toContain('DROP TABLE');

        const allowed = await runList({ sort: 'zoho_cf_dpl' });
        expect(allowed.dataCall.sql).toContain('ORDER BY zoho_cf_dpl ASC');
    });
});
