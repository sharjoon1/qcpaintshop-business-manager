/**
 * Characterization tests for the Zoho item cf_* custom-field wrapping
 * (CLAUDE.md §6: Zoho sync — cf_* custom fields MUST be wrapped into
 * custom_fields: [{ api_name, value }] on item create/update).
 *
 * Locks the CURRENT behavior of services/zoho-api.js::updateItem and its
 * sibling createItem:
 *   - any top-level cf_* key is moved into custom_fields:[{api_name,value}]
 *   - non-cf keys pass through at the top level untouched
 *   - a payload with NO cf_* keys is sent as-is (no custom_fields key added)
 *   - an existing custom_fields array is merged, with top-level cf_* keys
 *     overriding entries that share the same api_name (insertion order kept)
 *   - the caller's data object is never mutated (the function copies it)
 *
 * Pure node test: the raw `https` transport the module uses is mocked
 * (NO real network), as are zoho-oauth and the rate limiter.
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

/** Every https.request made: { options, body } (body = raw JSON written). */
let requests;
const lastRequest = () => requests[requests.length - 1];
const lastBody = () => JSON.parse(lastRequest().body);

beforeAll(() => {
    savedOrgId = process.env.ZOHO_ORGANIZATION_ID;
    process.env.ZOHO_ORGANIZATION_ID = ORG_ID;
});

afterAll(() => {
    if (savedOrgId === undefined) delete process.env.ZOHO_ORGANIZATION_ID;
    else process.env.ZOHO_ORGANIZATION_ID = savedOrgId;
});

beforeEach(() => {
    requests = [];
    https.request.mockReset();
    https.request.mockImplementation((options, onResponse) => {
        const call = { options, body: '' };
        requests.push(call);
        return {
            on: jest.fn(),
            setTimeout: jest.fn(),
            destroy: jest.fn(),
            write: jest.fn((chunk) => { call.body += chunk; }),
            end: jest.fn(() => {
                const handlers = {};
                onResponse({ on: (event, fn) => { handlers[event] = fn; } });
                handlers.data(JSON.stringify({ code: 0, message: 'success' }));
                handlers.end();
            })
        };
    });
});

describe('updateItem cf_* wrapping', () => {
    it('wraps a single cf_* key into custom_fields:[{api_name,value}] and removes the top-level key', async () => {
        await zohoAPI.updateItem('9000001', { rate: 100, cf_dpl: '550' });

        const body = lastBody();
        expect(body.custom_fields).toEqual([{ api_name: 'cf_dpl', value: '550' }]);
        expect(body).not.toHaveProperty('cf_dpl');
        // non-cf key passes through untouched
        expect(body.rate).toBe(100);
        // PUT to the item endpoint with the org id
        expect(lastRequest().options.method).toBe('PUT');
        expect(lastRequest().options.path).toBe(`/books/v3/items/9000001?organization_id=${ORG_ID}`);
    });

    it('wraps multiple cf_* keys (key order preserved, value types preserved) and leaves non-cf keys alone', async () => {
        await zohoAPI.updateItem('9000002', {
            name: 'BIRLA OPUS ONE TRUE LOOK 1L',
            rate: 423,
            cf_dpl: 326.05,
            cf_product_name: 'ONE TRUE LOOK'
        });

        const body = lastBody();
        expect(body.custom_fields).toEqual([
            { api_name: 'cf_dpl', value: 326.05 },
            { api_name: 'cf_product_name', value: 'ONE TRUE LOOK' }
        ]);
        expect(body).not.toHaveProperty('cf_dpl');
        expect(body).not.toHaveProperty('cf_product_name');
        expect(body.name).toBe('BIRLA OPUS ONE TRUE LOOK 1L');
        expect(body.rate).toBe(423);
    });

    it('sends NO custom_fields key at all when the payload has no cf_* keys', async () => {
        await zohoAPI.updateItem('9000003', { rate: 250, description: 'plain update' });

        const body = lastBody();
        expect(Object.prototype.hasOwnProperty.call(body, 'custom_fields')).toBe(false);
        expect(body).toEqual({ rate: 250, description: 'plain update' });
    });

    it('merges into an existing custom_fields array; a top-level cf_* key OVERRIDES the entry with the same api_name (in place)', async () => {
        await zohoAPI.updateItem('9000004', {
            custom_fields: [
                { api_name: 'cf_other', value: 'keep-me' },
                { api_name: 'cf_dpl', value: 'stale' }
            ],
            cf_dpl: 'fresh'
        });

        const body = lastBody();
        // existing entries keep their position; cf_dpl is overridden, cf_other kept
        expect(body.custom_fields).toEqual([
            { api_name: 'cf_other', value: 'keep-me' },
            { api_name: 'cf_dpl', value: 'fresh' }
        ]);
        expect(body).not.toHaveProperty('cf_dpl');
    });

    it('does not mutate the caller\'s data object', async () => {
        const data = { rate: 99, cf_dpl: '111' };
        await zohoAPI.updateItem('9000005', data);

        expect(data).toEqual({ rate: 99, cf_dpl: '111' });
        expect(data).not.toHaveProperty('custom_fields');
    });
});

describe('createItem cf_* wrapping (sibling of updateItem — same rule)', () => {
    it('wraps cf_* keys the same way and POSTs to /items', async () => {
        await zohoAPI.createItem({ name: 'NEW ITEM', rate: 10, cf_dpl: '7.5' });

        const body = lastBody();
        expect(body.custom_fields).toEqual([{ api_name: 'cf_dpl', value: '7.5' }]);
        expect(body).not.toHaveProperty('cf_dpl');
        expect(body.name).toBe('NEW ITEM');
        expect(lastRequest().options.method).toBe('POST');
        expect(lastRequest().options.path).toBe(`/books/v3/items?organization_id=${ORG_ID}`);
    });

    it('sends NO custom_fields key when creating without cf_* keys', async () => {
        await zohoAPI.createItem({ name: 'PLAIN ITEM', rate: 20 });

        const body = lastBody();
        expect(Object.prototype.hasOwnProperty.call(body, 'custom_fields')).toBe(false);
        expect(body).toEqual({ name: 'PLAIN ITEM', rate: 20 });
    });
});
