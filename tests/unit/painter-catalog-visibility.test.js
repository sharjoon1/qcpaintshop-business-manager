/**
 * Painter catalog curation visibility — mobile API contract lock.
 *
 * The painter Android app's self-billing product picker (GET /me/estimates/products,
 * POST /me/estimates) and the offer/product-detail surfaces previously ignored the
 * admin catalog curation tables (painter_catalog_*_order / *_overrides) that
 * GET /me/catalog already respects. These tests lock:
 *
 *   1. buildCatalogVisibility (routes/painters/shared.js) — pure SQL-fragment
 *      builder mirroring the inline block that lived in GET /me/catalog.
 *   2. Endpoint characterization — the 3 visibility join params [pid,pid,pid]
 *      are spliced BEFORE all WHERE params at every call site (mysql2 binds ?
 *      in string order), response JSON shapes/keys/status codes unchanged,
 *      and hidden products are rejected at estimate creation with a 400
 *      before any estimate-row INSERT.
 *
 * Pattern: mock pool + direct handler invocation (router stack walk), same as
 * tests/unit/item-master-search.test.js — bypasses requirePainterAuth and the
 * idempotency middleware.
 */

const { buildCatalogVisibility } = require('../../routes/painters/shared');
const painterRoutes = require('../../routes/painters/painter');

// ─────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────

const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

const findRoute = (method, path) => painterRoutes.router.stack
    .map(l => l.route)
    .find(rt => rt && rt.path === path && rt.methods[method]);

const lastHandler = (route) => route.stack[route.stack.length - 1].handle;

function mockRes() {
    const res = { statusCode: 200, body: null };
    res.status = (c) => { res.statusCode = c; return res; };
    res.json = (b) => { res.body = b; return res; };
    return res;
}

/** Fake pool: records every {sql, params}; shifts canned responses in call order. */
function makePool(responses = []) {
    const calls = [];
    const queue = [...responses];
    return {
        calls,
        query: async (sql, params) => {
            calls.push({ sql: String(sql), params });
            const next = queue.shift();
            return next !== undefined ? next : [[]];
        }
    };
}

async function invoke(method, path, req, pool) {
    painterRoutes.setPool(pool);
    const route = findRoute(method, path);
    expect(route).toBeTruthy();
    const res = mockRes();
    await lastHandler(route)(req, res);
    return res;
}

const findCall = (calls, re) => calls.find(c => re.test(norm(c.sql)));

const SIX_TABLES = [
    'painter_catalog_brand_order',
    'painter_catalog_brand_overrides',
    'painter_catalog_category_order',
    'painter_catalog_category_overrides',
    'painter_catalog_product_order',
    'painter_catalog_product_overrides',
];

beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────
//  1. Pure helper
// ─────────────────────────────────────────────────────────────────────────

describe('buildCatalogVisibility (pure helper)', () => {
    it('binds the painter id three times, in join order', () => {
        expect(buildCatalogVisibility(7).params).toEqual([7, 7, 7]);
    });

    it('falls back to 0 for falsy painter ids (no painter → global flags only)', () => {
        expect(buildCatalogVisibility(undefined).params).toEqual([0, 0, 0]);
        expect(buildCatalogVisibility(null).params).toEqual([0, 0, 0]);
        expect(buildCatalogVisibility(0).params).toEqual([0, 0, 0]);
    });

    it('joins name all six painter_catalog_* tables and contain exactly 3 placeholders', () => {
        const vis = buildCatalogVisibility(7);
        for (const t of SIX_TABLES) {
            expect(vis.joins).toContain(t);
        }
        expect((vis.joins.match(/\?/g) || []).length).toBe(3);
    });

    it('where starts with " AND ", has three COALESCE(...)=0 checks and no placeholders', () => {
        const vis = buildCatalogVisibility(7);
        expect(vis.where.startsWith(' AND ')).toBe(true);
        expect((norm(vis.where).match(/COALESCE\([^)]+\) = 0/g) || []).length).toBe(3);
        expect(vis.where).not.toContain('?');
        // where is exactly the visibleExpr with an AND prefix
        expect(vis.where).toBe(` AND ${vis.visibleExpr}`);
    });

    it('per-painter override beats global at every level (override listed before global)', () => {
        const where = norm(buildCatalogVisibility(7).where);
        expect(where).toContain('COALESCE(bo.is_hidden, gb.is_hidden, 0) = 0');
        expect(where).toContain('COALESCE(co.is_hidden, gc.is_hidden, 0) = 0');
        expect(where).toContain('COALESCE(ppo.is_hidden, gp.is_hidden, 0) = 0');
    });

    it('TRIMs both sides of the brand key against the zim alias', () => {
        const joins = norm(buildCatalogVisibility(7).joins);
        expect(joins).toContain('TRIM(gb.brand) = TRIM(zim.zoho_brand)');
        expect(joins).toContain('TRIM(gc.category) = TRIM(zim.zoho_category_name)');
    });

    it('productAlias option rewires the product-level joins (pv)', () => {
        const joins = norm(buildCatalogVisibility(7, { productAlias: 'pv' }).joins);
        expect(joins).toContain('gp.product_id = pv.id');
        expect(joins).toContain('ppo.product_id = pv.id');
    });

    it('zimAlias option rewires the brand/category joins', () => {
        const joins = norm(buildCatalogVisibility(7, { zimAlias: 'z9' }).joins);
        expect(joins).toContain('TRIM(z9.zoho_brand)');
        expect(joins).toContain('TRIM(z9.zoho_category_name)');
        expect(joins).not.toContain('zim.');
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  2. Endpoint characterization (mock pool, direct handler invocation)
// ─────────────────────────────────────────────────────────────────────────

describe('GET /me/estimates/products — estimate builder picker respects curation', () => {
    it('filters the main query; 3 visibility params BEFORE search/brand params', async () => {
        const pool = makePool();
        const res = await invoke('get', '/me/estimates/products',
            { painter: { id: 7 }, query: { search: 'x', brand: '3' } }, pool);

        expect(res.statusCode).toBe(200);

        const main = findCall(pool.calls, /FROM products p LEFT JOIN brands b/);
        expect(main).toBeTruthy();
        expect(main.sql).toContain('painter_catalog_product_overrides');
        expect(norm(main.sql)).toContain('COALESCE(ppo.is_hidden, gp.is_hidden, 0) = 0');
        // visibility params spliced BEFORE the pre-existing dynamic WHERE params
        expect(main.params).toEqual([7, 7, 7, '%x%', '%x%', 3]);
    });

    it('brands + categories dropdowns only list rows that survive the same filter', async () => {
        const pool = makePool();
        await invoke('get', '/me/estimates/products',
            { painter: { id: 7 }, query: {} }, pool);

        const brands = findCall(pool.calls, /FROM brands b/);
        const categories = findCall(pool.calls, /FROM categories c/);
        expect(brands).toBeTruthy();
        expect(categories).toBeTruthy();
        for (const call of [brands, categories]) {
            expect(call.sql).toContain('painter_catalog_product_overrides');
            expect(norm(call.sql)).toContain('COALESCE(ppo.is_hidden, gp.is_hidden, 0) = 0');
            expect(call.params).toEqual([7, 7, 7]);
        }
        expect(norm(brands.sql)).toContain('SELECT DISTINCT b.id, b.name FROM brands b');
        expect(norm(categories.sql)).toContain('SELECT DISTINCT c.id, c.name FROM categories c');
    });

    it('response body keys stay exactly {success, products, brands, categories}', async () => {
        const pool = makePool();
        const res = await invoke('get', '/me/estimates/products',
            { painter: { id: 7 }, query: {} }, pool);
        expect(res.statusCode).toBe(200);
        expect(Object.keys(res.body)).toEqual(['success', 'products', 'brands', 'categories']);
        expect(res.body.success).toBe(true);
    });
});

describe('POST /me/estimates — hidden products rejected at creation', () => {
    const cannedRow = (isVisible) => ({
        pack_size_id: 5, zoho_item_id: 'ZI-1', size: '10', unit: 'L',
        base_price: 100, product_id: 1,
        product_name: 'Tractor Emulsion', product_type: 'paint',
        zoho_item_name: 'TE 10L', zoho_brand: 'Asian', zoho_category_name: 'Emulsion',
        zoho_rate: 500, zoho_label_rate: 600,
        is_visible: isVisible,
    });

    const reqBody = {
        billing_type: 'self',
        items: [{ pack_size_id: 5, quantity: 2 }],
        submit: true,
    };

    it('validation query selects is_visible via the shared joins, vis params before packSizeIds', async () => {
        const pool = makePool([[[cannedRow(1)]], [{}], [[{ last_seq: 12 }]], [{ insertId: 99 }], [{}]]);
        await invoke('post', '/me/estimates', { painter: { id: 7 }, body: reqBody }, pool);

        const validation = findCall(pool.calls, /FROM pack_sizes ps INNER JOIN products p/);
        expect(validation).toBeTruthy();
        expect(validation.sql).toContain('AS is_visible');
        expect(validation.sql).toContain('painter_catalog_product_overrides');
        expect(validation.params).toEqual([7, 7, 7, [5]]);
    });

    it('is_visible:0 → 400 "not available", and no estimate rows are written', async () => {
        const pool = makePool([[[cannedRow(0)]]]);
        const res = await invoke('post', '/me/estimates', { painter: { id: 7 }, body: reqBody }, pool);

        expect(res.statusCode).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.message).toMatch(/not available/i);
        // No partial estimate writes. (The painter_estimate_sequence counter bump is
        // pre-existing behavior shared with the "Product not found" 400 path.)
        expect(pool.calls.some(c => c.sql.includes('INSERT INTO painter_estimates'))).toBe(false);
        expect(pool.calls.some(c => c.sql.includes('INSERT INTO painter_estimate_items'))).toBe(false);
    });

    it('is_visible:1 → proceeds to the estimate INSERT (existing success shape)', async () => {
        const pool = makePool([[[cannedRow(1)]], [{}], [[{ last_seq: 12 }]], [{ insertId: 99 }], [{}]]);
        const res = await invoke('post', '/me/estimates', { painter: { id: 7 }, body: reqBody }, pool);

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.estimateId).toBe(99);
        expect(pool.calls.some(c => c.sql.includes('INSERT INTO painter_estimates'))).toBe(true);
        expect(pool.calls.some(c => c.sql.includes('INSERT INTO painter_estimate_items'))).toBe(true);
    });
});

describe('GET /me/catalog/:productId — hidden variants excluded (fully hidden → 404)', () => {
    it('variants query carries the joins with productAlias pv; empty result hits the existing 404', async () => {
        const pool = makePool([[[{ id: 42, name: 'Apex', product_type: 'paint' }]], [[]]]);
        const res = await invoke('get', '/me/catalog/:productId',
            { painter: { id: 7 }, params: { productId: '42' }, query: {} }, pool);

        expect(res.statusCode).toBe(404);
        expect(res.body).toEqual({ success: false, message: 'No variants found' });

        // product-existence query untouched (no curation joins, single param)
        const prodCall = pool.calls[0];
        expect(prodCall.sql).not.toContain('painter_catalog');
        expect(prodCall.params).toEqual(['42']);

        const variants = findCall(pool.calls, /FROM pack_sizes ps INNER JOIN products pv/);
        expect(variants).toBeTruthy();
        expect(norm(variants.sql)).toContain('ppo.product_id = pv.id');
        expect(norm(variants.sql)).toContain('gp.product_id = pv.id');
        expect(norm(variants.sql)).toContain('COALESCE(ppo.is_hidden, gp.is_hidden, 0) = 0');
        expect(variants.params).toEqual([7, 7, 7, '42']);
    });
});

describe('GET /me/offer-products — offer box respects curation', () => {
    it('products query carries the filter; vis params first (no extra offer params for applies_to=all)', async () => {
        const offerRow = {
            id: 1, title: 'Mega', offer_type: 'bonus_points', bonus_points: '5',
            multiplier_value: null, applies_to: 'all', target_id: null, banner_image_url: null,
        };
        const pool = makePool([[[offerRow]]]);
        const res = await invoke('get', '/me/offer-products',
            { painter: { id: 7 }, query: {} }, pool);

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);

        const products = findCall(pool.calls, /FROM products p INNER JOIN pack_sizes ps/);
        expect(products).toBeTruthy();
        expect(products.sql).toContain('painter_catalog_product_overrides');
        expect(norm(products.sql)).toContain('COALESCE(ppo.is_hidden, gp.is_hidden, 0) = 0');
        expect(norm(products.sql)).toContain("WHERE p.status = 'active' AND (COALESCE");
        expect(products.params).toEqual([7, 7, 7]);
    });
});

describe('GET /me/catalog — refactor to shared helper is behavior-preserving', () => {
    it('count + products queries keep the same joins/filter with vis params first', async () => {
        const pool = makePool([[[{ total: 0 }]]]);
        const res = await invoke('get', '/me/catalog',
            { painter: { id: 7 }, query: {} }, pool);

        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(Object.keys(res.body)).toEqual(['success', 'products', 'offers', 'brands', 'categories', 'pagination']);

        const count = findCall(pool.calls, /SELECT COUNT\(DISTINCT p\.id\) as total/);
        expect(count).toBeTruthy();
        for (const t of SIX_TABLES) expect(count.sql).toContain(t);
        expect(count.params).toEqual([7, 7, 7]);

        const products = findCall(pool.calls, /SELECT p\.id as product_id/);
        expect(products).toBeTruthy();
        for (const t of SIX_TABLES) expect(products.sql).toContain(t);
        expect(norm(products.sql)).toContain('MAX(COALESCE(bo.sort_order, gb.sort_order, 999)) as _brand_sort');
        expect(norm(products.sql)).toContain("WHERE p.status = 'active' AND (COALESCE");
        // vis params first, then LIMIT/OFFSET (default 50/0)
        expect(products.params).toEqual([7, 7, 7, 50, 0]);

        // brand/category chips section stays as-is (single painter-id param, product-level only)
        const chips = pool.calls.filter(c => /SELECT DISTINCT zim\.zoho_brand as brand|SELECT DISTINCT zim\.zoho_category_name as category/.test(norm(c.sql)));
        expect(chips.length).toBe(2);
        for (const chip of chips) {
            expect(chip.params).toEqual([7]);
            expect(chip.sql).not.toContain('painter_catalog_brand_order');
        }
    });
});
