/**
 * POST /api/zoho/items/normalize/apply — job creation + SKU-integrity guards.
 *
 * History (characterization → fix): this endpoint used to hand-roll its own
 * zoho_bulk_jobs / zoho_bulk_job_items INSERTs and then optimistically write
 * BOTH zoho_item_name AND zoho_sku into the local zoho_items_map mirror, with
 * no duplicate-SKU check at all. The pre-fix behavior locked by an earlier
 * revision of this file was:
 *   - job filter_criteria {mode:'normalize_names'}, update_fields {source:'normalize'}
 *   - mirror UPDATE ... SET zoho_item_name = ?, zoho_sku = ? (optimistic SKU write)
 *   - a batch proposing the SAME SKU for two different items → 200 (accepted)
 *   - no cross-check against SKUs already held by another active item
 * That is the exact corruption mode migrations/resync-corrupted-skus.js exists
 * to repair, so the endpoint is now a thin adapter over createBulkEditJob(),
 * which owns both guards and the deferred (post-Zoho-confirm) SKU mirror write.
 *
 * The request shape ({items:[{zoho_item_id,new_name,new_sku?}]}) and the success
 * response shape ({success,data:{job_id,total_items},message}) are unchanged —
 * public/admin-zoho-items-edit.html's Normalize modal depends on them.
 *
 * Handlers are invoked directly (router stack walk), bypassing auth middleware —
 * same module-level loading pattern as zoho-items-hsn.test.js.
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

/**
 * @param heldRows rows the local mirror returns for the "SKU already held by a
 *        different active item" cross-check inside createBulkEditJob().
 */
function runApply(body, heldRows = []) {
    const calls = [];
    itemsModule.setPool({ query: async (sql, params) => {
        calls.push({ sql, params });
        if (/INSERT INTO zoho_bulk_jobs/i.test(sql)) return [{ insertId: 4242 }];
        if (/^\s*SELECT/i.test(sql) && /FROM zoho_items_map/i.test(sql)) return [heldRows];
        return [{}];
    } });
    const route = findRoute('post', '/items/normalize/apply');
    expect(route).toBeTruthy();
    const res = mockRes();
    return lastHandler(route)({ user: { id: 9 }, body }, res).then(() => ({ calls, res }));
}

const mirrorUpdates = (calls) => calls.filter(c => /UPDATE zoho_items_map SET/i.test(c.sql));

describe('POST /items/normalize/apply — input validation (unchanged contract)', () => {
    test('missing items array → 400', async () => {
        const { res } = await runApply({});
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ success: false, message: 'items array required' });
    });

    test('item without new_name → 400', async () => {
        const { res } = await runApply({ items: [{ zoho_item_id: '1' }] });
        expect(res.statusCode).toBe(400);
        expect(res.body.message).toBe('Each item must have zoho_item_id and new_name');
    });
});

describe('POST /items/normalize/apply — routes through createBulkEditJob', () => {
    test('creates the shared per-item-edit job, payload carries name + sku', async () => {
        const { calls, res } = await runApply({
            items: [{ zoho_item_id: '111', new_name: 'NEW NAME', new_sku: 'SKU-A' }]
        });
        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({
            success: true,
            data: { job_id: 4242, total_items: 1 },
            message: 'Bulk rename job #4242 created with 1 items — track progress on the Bulk Jobs page'
        });

        const jobInsert = calls.find(c => /INSERT INTO zoho_bulk_jobs/i.test(c.sql));
        expect(jobInsert).toBeTruthy();
        // Shared job shape from createBulkEditJob (was {mode:'normalize_names'} pre-fix).
        expect(JSON.parse(jobInsert.params[0])).toEqual({ mode: 'per_item_edit', item_count: 1 });
        expect(JSON.parse(jobInsert.params[1])).toEqual({ mode: 'per_item' });
        expect(jobInsert.params[2]).toBe(1);
        expect(jobInsert.params[3]).toBe(9);

        const jobItemInsert = calls.find(c => /INSERT INTO zoho_bulk_job_items/i.test(c.sql));
        expect(jobItemInsert.params.slice(0, 3)).toEqual([4242, '111', 'NEW NAME']);
        expect(JSON.parse(jobItemInsert.params[3])).toEqual({ name: 'NEW NAME', sku: 'SKU-A' });
    });

    test('the endpoint no longer hand-rolls job SQL of its own', async () => {
        const { calls } = await runApply({
            items: [{ zoho_item_id: '111', new_name: 'NEW NAME', new_sku: 'SKU-A' }]
        });
        // Exactly one job + one job-item INSERT, both issued by createBulkEditJob.
        expect(calls.filter(c => /INSERT INTO zoho_bulk_jobs/i.test(c.sql))).toHaveLength(1);
        expect(calls.filter(c => /INSERT INTO zoho_bulk_job_items/i.test(c.sql))).toHaveLength(1);
    });

    test('local mirror gets the NAME only — SKU is withheld until Zoho confirms', async () => {
        const { calls } = await runApply({
            items: [{ zoho_item_id: '111', new_name: 'NEW NAME', new_sku: 'SKU-A' }]
        });
        const mirror = mirrorUpdates(calls);
        expect(mirror).toHaveLength(1);
        expect(mirror[0].sql).toContain('zoho_item_name');
        expect(mirror[0].sql).not.toContain('zoho_sku');
        expect(mirror[0].params).toEqual(['NEW NAME', '111']);
    });

    test('rename without a new_sku still queues the name change', async () => {
        const { calls, res } = await runApply({
            items: [{ zoho_item_id: '111', new_name: 'NEW NAME' }]
        });
        expect(res.statusCode).toBe(200);
        const jobItemInsert = calls.find(c => /INSERT INTO zoho_bulk_job_items/i.test(c.sql));
        expect(JSON.parse(jobItemInsert.params[3])).toEqual({ name: 'NEW NAME' });
        expect(mirrorUpdates(calls)[0].params).toEqual(['NEW NAME', '111']);
    });
});

describe('POST /items/normalize/apply — SKU-integrity guards (inherited from createBulkEditJob)', () => {
    test('same SKU on two items in one batch → 400 DUPLICATE_SKUS_IN_BATCH, nothing written', async () => {
        const { calls, res } = await runApply({
            items: [
                { zoho_item_id: '111', new_name: 'WHITE 20L', new_sku: 'OPCL01' },
                { zoho_item_id: '222', new_name: 'ORANGE 20L', new_sku: 'OPCL01' }
            ]
        });
        expect(res.statusCode).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.code).toBe('DUPLICATE_SKUS_IN_BATCH');
        expect(res.body.duplicates[0].map(d => d.zoho_item_id)).toEqual(['111', '222']);
        expect(calls.filter(c => /INSERT INTO zoho_bulk_jobs/i.test(c.sql))).toHaveLength(0);
        expect(mirrorUpdates(calls)).toHaveLength(0);
    });

    test('duplicate detection is case-insensitive', async () => {
        const { res } = await runApply({
            items: [
                { zoho_item_id: '111', new_name: 'WHITE 20L', new_sku: 'opcl01' },
                { zoho_item_id: '222', new_name: 'ORANGE 20L', new_sku: 'OPCL01' }
            ]
        });
        expect(res.statusCode).toBe(400);
        expect(res.body.code).toBe('DUPLICATE_SKUS_IN_BATCH');
    });

    test('SKU already held by a DIFFERENT active item → 400 SKU_HELD_BY_OTHER_ITEM, nothing written', async () => {
        const { calls, res } = await runApply(
            { items: [{ zoho_item_id: '111', new_name: 'WHITE 20L', new_sku: 'OPCL01' }] },
            [{ zoho_item_id: '999', zoho_sku: 'OPCL01', zoho_item_name: 'ORANGE 20L' }]
        );
        expect(res.statusCode).toBe(400);
        expect(res.body.code).toBe('SKU_HELD_BY_OTHER_ITEM');
        expect(res.body.conflicts[0].already_held_by).toEqual({ zoho_item_id: '999', item_name: 'ORANGE 20L' });
        expect(calls.filter(c => /INSERT INTO zoho_bulk_jobs/i.test(c.sql))).toHaveLength(0);
        expect(mirrorUpdates(calls)).toHaveLength(0);
    });

    test('an item keeping its OWN existing SKU is not a conflict', async () => {
        const { res } = await runApply(
            { items: [{ zoho_item_id: '111', new_name: 'WHITE 20L', new_sku: 'OPCL01' }] },
            [{ zoho_item_id: '111', zoho_sku: 'OPCL01', zoho_item_name: 'WHITE 20 LTR' }]
        );
        expect(res.statusCode).toBe(200);
        expect(res.body.data).toEqual({ job_id: 4242, total_items: 1 });
    });
});
