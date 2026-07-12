/**
 * Characterization/lock tests for the new Zoho payment endpoints added in
 * SP-1 C2 (services/zoho-api.js):
 *   - createVendorPayment  → POST   /vendorpayments
 *   - getVendorPayments    → GET    /vendorpayments
 *   - deleteCustomerPayment→ DELETE /customerpayments/{id}
 *   - deleteVendorPayment  → DELETE /vendorpayments/{id}
 *
 * Each must hit the right HTTP method + path and carry organization_id. Uses
 * the raw-`https` mock idiom (no real network), same as zoho-api-cf-wrap.test.js.
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

describe('createVendorPayment → POST /vendorpayments', () => {
    it('POSTs the payload to /vendorpayments with the org id', async () => {
        await zohoAPI.createVendorPayment({ vendor_id: 'V1', amount: 100, payment_mode: 'cash' });

        expect(lastRequest().options.method).toBe('POST');
        expect(lastRequest().options.path).toBe(`/books/v3/vendorpayments?organization_id=${ORG_ID}`);
        expect(lastBody()).toEqual({ vendor_id: 'V1', amount: 100, payment_mode: 'cash' });
    });
});

describe('getVendorPayments → GET /vendorpayments', () => {
    it('GETs /vendorpayments with the org id (no query params)', async () => {
        await zohoAPI.getVendorPayments();

        expect(lastRequest().options.method).toBe('GET');
        expect(lastRequest().options.path).toBe(`/books/v3/vendorpayments?organization_id=${ORG_ID}`);
    });

    it('merges caller query params after organization_id', async () => {
        await zohoAPI.getVendorPayments({ reference_number: 'ACT-VP-7' });

        expect(lastRequest().options.method).toBe('GET');
        expect(lastRequest().options.path).toBe(
            `/books/v3/vendorpayments?organization_id=${ORG_ID}&reference_number=ACT-VP-7`
        );
    });
});

describe('deleteCustomerPayment → DELETE /customerpayments/{id}', () => {
    it('DELETEs the customer payment by id with the org id', async () => {
        await zohoAPI.deleteCustomerPayment('PAY-AR-1');

        expect(lastRequest().options.method).toBe('DELETE');
        expect(lastRequest().options.path).toBe(
            `/books/v3/customerpayments/PAY-AR-1?organization_id=${ORG_ID}`
        );
    });
});

describe('deleteVendorPayment → DELETE /vendorpayments/{id}', () => {
    it('DELETEs the vendor payment by id with the org id', async () => {
        await zohoAPI.deleteVendorPayment('PAY-AP-9');

        expect(lastRequest().options.method).toBe('DELETE');
        expect(lastRequest().options.path).toBe(
            `/books/v3/vendorpayments/PAY-AP-9?organization_id=${ORG_ID}`
        );
    });
});
