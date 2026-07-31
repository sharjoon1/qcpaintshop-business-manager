/**
 * P1 — services/zoho-api.js :: syncItems() and the cf_product_name binding.
 *
 * Zoho's GET /items LIST response (the one syncItems pages through) carries NO
 * custom_fields array; it exposes the custom field as the flat top-level keys
 * `cf_product_name` / `cf_product_name_unformatted`. The extraction only looked at
 * the (absent) custom_fields array, so zoho_cf_product_name bound NULL on every
 * row, and the ON DUPLICATE KEY UPDATE COALESCE then preserved the existing NULL
 * forever — staff could never search items by friendly product name.
 *
 * These tests lock:
 *   - the flat LIST keys are picked up (unformatted preferred)
 *   - the custom_fields ARRAY form still wins when present (per-item detail path)
 *   - zoho_cf_dpl extraction is UNCHANGED — array-only, no flat fallback.
 *     DPL feeds the §6 money path ceil(dpl*1.18*1.10) and is deliberately
 *     OUT OF SCOPE here; this assertion exists to catch an accidental change.
 *   - the COALESCE clobber protection on both cf_* columns stays in the upsert
 *
 * Pure node test: the raw `https` transport is mocked (NO real network), as are
 * zoho-oauth and the rate limiter. Same mocking shape as zoho-api-cf-wrap.test.js.
 */

jest.mock('https');
jest.mock('../../services/zoho-oauth', () => ({
    setPool: jest.fn(),
    getAccessToken: jest.fn(async () => 'test-access-token')
}));
jest.mock('../../services/zoho-rate-limiter', () => ({
    setPool: jest.fn(),
    acquire: jest.fn(() => Promise.resolve())
}));

const https = require('https');
const zohoAPI = require('../../services/zoho-api');

const ORG_ID = 'TESTORG123';
let savedOrgId;

// Bound parameter positions in the zoho_items_map upsert (0-based).
const P_ITEM_ID = 0;
const P_CF_PRODUCT_NAME = 21;
const P_CF_DPL = 22;

/** Runs syncItems over a single LIST page containing `items`; returns the item upserts. */
async function runSyncItems(items) {
    const queries = [];
    zohoAPI.setPool({
        query: async (sql, params) => {
            queries.push({ sql, params });
            if (/INSERT INTO zoho_sync_log/i.test(sql)) return [{ insertId: 1 }];
            return [{}];
        }
    });

    https.request.mockImplementation((options, onResponse) => ({
        on: jest.fn(),
        setTimeout: jest.fn(),
        destroy: jest.fn(),
        write: jest.fn(),
        end: jest.fn(() => {
            const handlers = {};
            onResponse({ on: (event, fn) => { handlers[event] = fn; } });
            handlers.data(JSON.stringify({
                code: 0,
                message: 'success',
                items,
                page_context: { has_more_page: false }
            }));
            handlers.end();
        })
    }));

    const result = await zohoAPI.syncItems(null);
    const upserts = queries.filter(q => /INSERT INTO zoho_items_map/i.test(q.sql));
    return { result, queries, upserts };
}

beforeAll(() => {
    savedOrgId = process.env.ZOHO_ORGANIZATION_ID;
    process.env.ZOHO_ORGANIZATION_ID = ORG_ID;
});

afterAll(() => {
    if (savedOrgId === undefined) delete process.env.ZOHO_ORGANIZATION_ID;
    else process.env.ZOHO_ORGANIZATION_ID = savedOrgId;
});

beforeEach(() => {
    https.request.mockReset();
    jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('syncItems — zoho_cf_product_name extraction', () => {
    it('binds the flat cf_product_name_unformatted key from the LIST response', async () => {
        const { result, upserts } = await runSyncItems([{
            item_id: '9001',
            name: 'IE01 RD1 ROYALE 01 L',
            rate: 500,
            cf_product_name: 'Royale Luxury Emulsion',
            cf_product_name_unformatted: 'Royale Luxury Emulsion'
        }]);

        expect(result).toEqual({ success: true, synced: 1 });
        expect(upserts).toHaveLength(1);
        expect(upserts[0].params[P_ITEM_ID]).toBe('9001');
        expect(upserts[0].params[P_CF_PRODUCT_NAME]).toBe('Royale Luxury Emulsion');
    });

    it('falls back to the flat cf_product_name key when only that one is present', async () => {
        const { upserts } = await runSyncItems([{
            item_id: '9002', name: 'X', cf_product_name: 'Weather Shield'
        }]);
        expect(upserts[0].params[P_CF_PRODUCT_NAME]).toBe('Weather Shield');
    });

    it('prefers the custom_fields ARRAY value over the flat keys (per-item detail path)', async () => {
        const { upserts } = await runSyncItems([{
            item_id: '9003',
            name: 'X',
            custom_fields: [{ api_name: 'cf_product_name', label: 'Product Name', value: 'From Array' }],
            cf_product_name_unformatted: 'From Flat Key'
        }]);
        expect(upserts[0].params[P_CF_PRODUCT_NAME]).toBe('From Array');
    });

    it('matches the custom_fields entry by label as well as api_name', async () => {
        const { upserts } = await runSyncItems([{
            item_id: '9004',
            name: 'X',
            custom_fields: [{ label: 'Product Name', value: 'Matched By Label' }]
        }]);
        expect(upserts[0].params[P_CF_PRODUCT_NAME]).toBe('Matched By Label');
    });

    it('binds NULL when the item carries no product-name custom field at all', async () => {
        const { upserts } = await runSyncItems([{ item_id: '9005', name: 'X' }]);
        expect(upserts[0].params[P_CF_PRODUCT_NAME]).toBeNull();
    });
});

describe('syncItems — zoho_cf_dpl extraction is UNCHANGED (out of scope, §6 money path)', () => {
    it('reads DPL from the custom_fields array only', async () => {
        const { upserts } = await runSyncItems([{
            item_id: '9006',
            name: 'X',
            custom_fields: [{ api_name: 'cf_dpl', label: 'DPL', value: '285' }]
        }]);
        expect(upserts[0].params[P_CF_DPL]).toBe('285');
    });

    it('does NOT pick up a flat cf_dpl key from the LIST response', async () => {
        const { upserts } = await runSyncItems([{
            item_id: '9007', name: 'X', cf_dpl: '999', cf_dpl_unformatted: 999
        }]);
        expect(upserts[0].params[P_CF_DPL]).toBeNull();
    });
});

describe('syncItems — upsert clobber protection (kept)', () => {
    it('still COALESCEs both cf_* columns so a locally-pushed value survives a NULL sync', async () => {
        const { upserts } = await runSyncItems([{ item_id: '9008', name: 'X' }]);
        expect(upserts[0].sql).toMatch(/zoho_cf_product_name = COALESCE\(VALUES\(zoho_cf_product_name\), zoho_cf_product_name\)/);
        expect(upserts[0].sql).toMatch(/zoho_cf_dpl = COALESCE\(VALUES\(zoho_cf_dpl\), zoho_cf_dpl\)/);
        expect(upserts[0].sql).toMatch(/zoho_hsn_or_sac = COALESCE\(VALUES\(zoho_hsn_or_sac\), zoho_hsn_or_sac\)/);
    });
});
