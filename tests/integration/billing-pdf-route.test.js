/**
 * Behavioral test for routes/billing-pdf.js (Batch B1b — cashier print pipeline).
 *
 * Locks the deliberate contract of the NEW route (structural clone of
 * routes/estimate-pdf.js):
 *   - ?token= / Authorization auth against user_sessions (hash form untouched)
 *   - 401 / 404 / 403 gate order (auth → invoice exists+not-deleted → branch)
 *   - branch gate: full admins pass, staff need branch match, NULL branch passes
 *   - receipt=1 → billing-receipt.html + #receiptContent + Receipt-<n>.pdf
 *   - default    → billing-invoice-print.html + #printContent + Invoice-<n>.pdf
 *
 * Puppeteer is mocked (no Chromium needed); MySQL is faked via setPool — this
 * suite runs DB-free like the other UI/contract tests in this folder.
 */

// Mock BEFORE requiring the route (it lazy-requires these inside the handler).
jest.mock('puppeteer', () => ({
    executablePath: () => '/fake/chromium'
}));

const pageCalls = { gotoUrl: null, waitSelector: null };
jest.mock('puppeteer-core', () => ({
    launch: jest.fn(async () => ({
        newPage: async () => ({
            goto: async (url) => { pageCalls.gotoUrl = url; },
            waitForSelector: async (sel) => { pageCalls.waitSelector = sel; },
            pdf: async () => Buffer.from('%PDF-1.4 fake')
        }),
        close: async () => {}
    }))
}));

const express = require('express');
const billingPdf = require('../../routes/billing-pdf');

// ── fake pool: dispatch on SQL text ──
const VALID_TOKEN = 'good-token';
const ADMIN_TOKEN = 'admin-token';
// staff user in branch 2; admin user in branch 1
const sessions = {
    [VALID_TOKEN]: { user_id: 10, username: 'staff1', role: 'staff', full_name: 'Staff One', branch_id: 2 },
    [ADMIN_TOKEN]: { user_id: 1, username: 'admin1', role: 'admin', full_name: 'Admin One', branch_id: 1 }
};
// invoice fixtures by id
let invoices = {};

const fakePool = {
    query: async (sql, params) => {
        if (sql.includes('FROM user_sessions')) {
            const token = params[0];
            const s = sessions[token];
            return [s ? [s] : []];
        }
        if (sql.includes('FROM billing_invoices')) {
            const inv = invoices[String(params[0])];
            return [inv ? [inv] : []];
        }
        throw new Error('Unexpected SQL in fake pool: ' + sql);
    }
};

let server;
let baseUrl;

beforeAll((done) => {
    billingPdf.setPool(fakePool);
    const app = express();
    app.use('/api/billing', billingPdf.router);
    server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        done();
    });
});

afterAll((done) => {
    // fetch keeps sockets alive — drop them so close() can complete.
    if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    server.close(() => done());
});

beforeEach(() => {
    pageCalls.gotoUrl = null;
    pageCalls.waitSelector = null;
    invoices = {
        '5': { invoice_number: 'BI-0005', branch_id: 2 },   // staff's own branch
        '6': { invoice_number: 'BI-0006', branch_id: 3 },   // other branch
        '7': { invoice_number: 'BI-0007', branch_id: null } // unassigned branch
    };
});

describe('module shape', () => {
    test('exports { router, setPool } like estimate-pdf.js', () => {
        expect(typeof billingPdf.setPool).toBe('function');
        expect(typeof billingPdf.router).toBe('function'); // express routers are callable
    });
});

describe('auth + branch gates (run before Puppeteer)', () => {
    test('401 without any token', async () => {
        const res = await fetch(`${baseUrl}/api/billing/invoices/5/pdf`);
        expect(res.status).toBe(401);
    });

    test('401 with an unknown token', async () => {
        const res = await fetch(`${baseUrl}/api/billing/invoices/5/pdf?token=bogus`);
        expect(res.status).toBe(401);
    });

    test('404 when the invoice does not exist (or is soft-deleted)', async () => {
        const res = await fetch(`${baseUrl}/api/billing/invoices/999/pdf?token=${VALID_TOKEN}`);
        expect(res.status).toBe(404);
    });

    test("403 when staff requests another branch's invoice", async () => {
        const res = await fetch(`${baseUrl}/api/billing/invoices/6/pdf?token=${VALID_TOKEN}`);
        expect(res.status).toBe(403);
    });

    test('staff pass on own-branch invoice (200 PDF)', async () => {
        const res = await fetch(`${baseUrl}/api/billing/invoices/5/pdf?token=${VALID_TOKEN}`);
        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toContain('application/pdf');
    });

    test('staff pass on NULL-branch invoice', async () => {
        const res = await fetch(`${baseUrl}/api/billing/invoices/7/pdf?token=${VALID_TOKEN}`);
        expect(res.status).toBe(200);
    });

    test("admin passes on another branch's invoice", async () => {
        const res = await fetch(`${baseUrl}/api/billing/invoices/6/pdf?token=${ADMIN_TOKEN}`);
        expect(res.status).toBe(200);
    });

    test('Authorization: Bearer header works like ?token=', async () => {
        const res = await fetch(`${baseUrl}/api/billing/invoices/5/pdf`, {
            headers: { Authorization: `Bearer ${VALID_TOKEN}` }
        });
        expect(res.status).toBe(200);
    });
});

describe('render targets + filenames', () => {
    test('default mode renders billing-invoice-print.html, waits #printContent, names Invoice-<n>.pdf', async () => {
        const res = await fetch(`${baseUrl}/api/billing/invoices/5/pdf?token=${VALID_TOKEN}`);
        expect(res.status).toBe(200);
        expect(pageCalls.gotoUrl).toContain('/billing-invoice-print.html?id=5&mode=pdf&token=');
        expect(pageCalls.waitSelector).toBe('#printContent');
        expect(res.headers.get('content-disposition')).toContain('Invoice-BI-0005.pdf');
    });

    test('?receipt=1 renders billing-receipt.html, waits #receiptContent, names Receipt-<n>.pdf', async () => {
        const res = await fetch(`${baseUrl}/api/billing/invoices/5/pdf?receipt=1&token=${VALID_TOKEN}`);
        expect(res.status).toBe(200);
        expect(pageCalls.gotoUrl).toContain('/billing-receipt.html?id=5&mode=pdf&token=');
        expect(pageCalls.waitSelector).toBe('#receiptContent');
        expect(res.headers.get('content-disposition')).toContain('Receipt-BI-0005.pdf');
    });
});
