/**
 * HSN management on the Zoho items list (backend for admin-zoho-items-edit.html).
 *
 * Locks:
 *  - GET /items aliases zoho_hsn_or_sac AS hsn_or_sac in the SELECT
 *  - GET /items?missingHsn=1 narrows to items with NULL/blank local HSN
 *  - POST /items/bulk-edit carries an hsn_or_sac change into the job payload
 *    AND the local zoho_items_map mirror (zoho_hsn_or_sac)
 *
 * Handlers are invoked directly (router stack walk), bypassing auth middleware —
 * same module-level loading pattern as dpl-catalog-endpoints.test.js.
 */
const itemsModule = require('../../routes/zoho/items');

const findRoute = (method, path) => itemsModule.router.stack
    .map(l => l.route)
    .find(rt => rt && rt.path === path && rt.methods[method]);

const lastHandler = (route) => route.stack[route.stack.length - 1].handle;

function mockRes() {
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
}

describe('GET /items — HSN support', () => {
    const runList = async (query) => {
        const calls = [];
        itemsModule.setPool({ query: async (sql, params) => {
            calls.push({ sql, params });
            if (/COUNT\(\*\)/i.test(sql)) return [[{ total: 0 }]];
            return [[]];
        } });
        const route = findRoute('get', '/items');
        expect(route).toBeTruthy();
        const res = mockRes();
        await lastHandler(route)({ query }, res);
        return { calls, res };
    };

    test('SELECT aliases zoho_hsn_or_sac as hsn_or_sac', async () => {
        const { calls, res } = await runList({});
        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        const dataSql = calls[1].sql;
        expect(dataSql).toMatch(/zim\.zoho_hsn_or_sac as hsn_or_sac/i);
    });

    test('missingHsn=1 adds blank-HSN WHERE to both COUNT and data queries', async () => {
        const { calls, res } = await runList({ missingHsn: '1', page: '1', limit: '50' });
        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(calls[0].sql).toContain("COALESCE(zim.zoho_hsn_or_sac, '') = ''");
        expect(calls[1].sql).toContain("COALESCE(zim.zoho_hsn_or_sac, '') = ''");
    });

    test('missingHsn absent → no HSN clause', async () => {
        const { calls } = await runList({});
        calls.forEach(c => expect(c.sql).not.toContain('COALESCE(zim.zoho_hsn_or_sac'));
    });
});

describe('POST /items/bulk-edit — hsn_or_sac change field', () => {
    test('hsn_or_sac flows into the job payload and the local mirror UPDATE', async () => {
        const calls = [];
        itemsModule.setPool({ query: async (sql, params) => {
            calls.push({ sql, params });
            if (/INSERT INTO zoho_bulk_jobs/i.test(sql)) return [{ insertId: 77 }];
            return [{}];
        } });
        const route = findRoute('post', '/items/bulk-edit');
        expect(route).toBeTruthy();
        const res = mockRes();
        await lastHandler(route)({
            user: { id: 1 },
            body: { items: [{ zoho_item_id: '111', item_name: 'X', changes: { hsn_or_sac: '32081090' } }] }
        }, res);
        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);

        const jobItemInsert = calls.find(c => /INSERT INTO zoho_bulk_job_items/i.test(c.sql));
        expect(jobItemInsert).toBeTruthy();
        expect(JSON.parse(jobItemInsert.params[3])).toEqual({ hsn_or_sac: '32081090' });

        const localUpdate = calls.find(c => /UPDATE zoho_items_map SET/i.test(c.sql) && c.sql.includes('zoho_hsn_or_sac'));
        expect(localUpdate).toBeTruthy();
        expect(localUpdate.params).toEqual(['32081090', '111']);
    });
});
