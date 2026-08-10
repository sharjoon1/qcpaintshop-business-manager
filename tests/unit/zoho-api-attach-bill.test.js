/**
 * Characterization test for services/zoho-api.js::attachBillAttachment
 * (Vendor Bill → Zoho Books attachment upload).
 *
 * Locks the CURRENT behavior:
 *   - builds URL  `${API_BASE}/bills/{billId}/attachment?organization_id=...`
 *   - sends `Authorization: Zoho-oauthtoken <token>` from zoho-oauth
 *   - sends the file as multipart FormData (raw fetch — apiPost is JSON-only)
 *   - a Zoho error payload (code !== 0) rejects with that message
 *
 * Regression guard: this function previously referenced undefined
 * `getBaseUrl()` / `getAccessToken()` → ReferenceError on every call
 * (lint no-undef). This test pins the corrected behavior.
 */

jest.mock('node-fetch');
jest.mock('../../services/zoho-oauth', () => ({
    setPool: jest.fn(),
    getAccessToken: jest.fn(async () => 'test-access-token')
}));
jest.mock('../../services/zoho-rate-limiter', () => ({
    setPool: jest.fn(),
    acquire: jest.fn(() => Promise.resolve())
}));

const fetchMock = require('node-fetch');
const zohoAPI = require('../../services/zoho-api');

const ORG_ID = 'TESTORG123';
const API_BASE = 'https://www.zohoapis.in/books/v3';

let savedOrgId;

beforeAll(() => {
    savedOrgId = process.env.ZOHO_ORGANIZATION_ID;
    process.env.ZOHO_ORGANIZATION_ID = ORG_ID;
});

afterAll(() => {
    if (savedOrgId === undefined) delete process.env.ZOHO_ORGANIZATION_ID;
    else process.env.ZOHO_ORGANIZATION_ID = savedOrgId;
});

beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
        json: async () => ({ code: 0, message: 'success' })
    });
});

describe('attachBillAttachment', () => {
    it('POSTs multipart to /bills/{id}/attachment with oauth bearer + org id', async () => {
        const billId = '1234567890';
        const filePath = require('path').join(__dirname, 'fixtures', 'dummy.txt');

        // Create the dummy file so fs.createReadStream works
        require('fs').mkdirSync(require('path').join(__dirname, 'fixtures'), { recursive: true });
        require('fs').writeFileSync(filePath, 'dummy');

        await zohoAPI.attachBillAttachment(billId, filePath);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, opts] = fetchMock.mock.calls[0];
        expect(url).toBe(`${API_BASE}/bills/${billId}/attachment?organization_id=${ORG_ID}`);
        expect(opts.method).toBe('POST');
        expect(opts.headers.Authorization).toBe('Zoho-oauthtoken test-access-token');
        expect(opts.body.constructor.name).toBe('FormData');
    });

    it('rejects when Zoho returns an error code', async () => {
        fetchMock.mockResolvedValue({
            json: async () => ({ code: 1001, message: 'Bill not found' })
        });
        const filePath = require('path').join(__dirname, 'fixtures', 'dummy.txt');
        await expect(zohoAPI.attachBillAttachment('missing-bill', filePath))
            .rejects.toThrow('Bill not found');
    });
});
