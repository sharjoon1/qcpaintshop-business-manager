/**
 * B1a POST /api/billing/quick-sale — routes/billing.js.
 *
 * Money path. Locks:
 *   - quickSaleSchema: NO 'credit' payment method, max 4 payments, defaults;
 *   - Σpayments > grandTotal + 0.01 refused 400 PAYMENT_EXCEEDS_TOTAL BEFORE
 *     any transaction (no connection checkout);
 *   - phase-1 transaction: invoice + items + payment rows + shared recalc in
 *     ONE txn; an item-insert throw rolls back, releases, 500s, and writes NO
 *     audit row and NO push;
 *   - phase-2 never changes the 200: Zoho-down ⇒ 200 with zoho.pushed=false and
 *     the failure stamped onto billing_invoices (zoho_push_error /
 *     zoho_push_attempted_at); PUSH_GATE surfaces as zoho.code + a
 *     billing.invoice.zohoPush.refused audit; flag off ⇒ push never called;
 *   - split payments produce N billing_payments INSERTs + the shared recalc;
 *   - totals in the response match calculateTotals exactly;
 *   - payments without billing.payment permission (non-admin) ⇒ 403;
 *   - B1.1 credit gate: an unpaid balance is refused 400 CREDIT_REQUIRED
 *     BEFORE the transaction unless the customer passes the SAME eligibility
 *     the Zoho push gate applies (real checkCreditBeforeInvoice, mock pool);
 *     fully-paid sales never touch the credit system;
 *   - B1.1 description: optional per-item description accepted by the schema
 *     and persisted through the billing_invoice_items INSERT (NULL when absent).
 *
 * Handler invoked directly via router stack walk (item-master-search pattern);
 * middleware (idempotent/requirePermission/validate) is bypassed — the body is
 * pre-parsed through the exported quickSaleSchema exactly as validate() would.
 */

const mockHasRolePermission = jest.fn(async () => true);
jest.mock('../../middleware/permissionMiddleware', () => ({
    requirePermission: () => (req, res, next) => next(),
    isFullAdmin: (role) => ['admin', 'administrator', 'super_admin'].includes(String(role || '').toLowerCase()),
    hasRolePermission: (...a) => mockHasRolePermission(...a),
}));

const mockPush = jest.fn();
const mockFlagOn = jest.fn(async () => false);
jest.mock('../../services/billing-zoho-service', () => ({
    setPool: jest.fn(),
    setPointsEngine: jest.fn(),
    pushInvoiceToZoho: (...a) => mockPush(...a),
    flagOn: (...a) => mockFlagOn(...a),
    readConfigValue: jest.fn(async () => ''),
    resolveZohoContact: jest.fn(),
    forwardInvoicePayments: jest.fn(),
    syncInvoicePaymentsToZoho: jest.fn(),
    syncInvoiceApprovalState: jest.fn(),
    retryUnpushedInvoices: jest.fn(),
}));

const billing = require('../../routes/billing');
const { quickSaleSchema, calculateTotals } = billing;

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

/**
 * Fake pool + transaction connection for the quick-sale flow.
 * `failItemInsert` makes the billing_invoice_items INSERT throw (rollback path).
 *
 * B1.1 credit-gate probes (all pool-level, pre-transaction):
 *   `customerContact` — zoho_customers_map WHERE id → zoho_contact_id
 *                       (default 'ZC-7' so baseBody resolves);
 *   `painterRow`      — painters WHERE id → { zoho_contact_id, zoho_customer_id };
 *   `creditRow`       — the checkCreditBeforeInvoice row (default an eligible
 *                       ₹100,000 limit so pre-B1.1 unpaid-sale locks still hold);
 *                       null ⇒ "not in credit system" ⇒ ineligible.
 */
function makeQuickSalePool({
    failItemInsert = false,
    customerContact = 'ZC-7',
    painterRow = null,
    creditRow = { id: 7, zoho_contact_name: 'Regular', credit_limit: 100000, zoho_outstanding: 0 },
} = {}) {
    const calls = [];    // pool-level queries (generateNumber, credit gate, audit, error stamp)
    const txCalls = [];  // connection-level queries inside the transaction
    const counters = { begins: 0, commits: 0, rollbacks: 0, releases: 0, connections: 0 };
    let invoiceInsertParams = null;
    let paymentInsertSeq = 0;
    const paymentAmounts = [];
    const itemInserts = [];   // B1.1: params of each billing_invoice_items INSERT

    const connection = {
        beginTransaction: async () => { counters.begins++; },
        commit: async () => { counters.commits++; },
        rollback: async () => { counters.rollbacks++; },
        release: () => { counters.releases++; },
        execute: async (sql, params) => {
            const s = String(sql);
            txCalls.push({ sql: s, params });
            if (/INSERT INTO billing_invoices/.test(s)) {
                invoiceInsertParams = params;
                return [{ insertId: 501 }];
            }
            if (/INSERT INTO billing_invoice_items/.test(s)) {
                if (failItemInsert) throw new Error('item insert boom');
                itemInserts.push({ sql: s, params });
                return [{ insertId: 1 }];
            }
            if (/INSERT INTO billing_payments/.test(s)) {
                paymentAmounts.push(Number(params[1]));
                return [{ insertId: 900 + (++paymentInsertSeq) }];
            }
            return [{ affectedRows: 1 }];
        },
        query: async (sql, params) => {
            const s = String(sql);
            txCalls.push({ sql: s, params });
            if (/SUM\(amount\)/.test(s)) {
                return [[{ total_paid: paymentAmounts.reduce((a, b) => a + b, 0) }]];
            }
            if (/SELECT grand_total FROM billing_invoices/.test(s)) {
                // grand_total as stored by the invoice INSERT (param index 9)
                return [[{ grand_total: invoiceInsertParams ? invoiceInsertParams[9] : 0 }]];
            }
            if (/^\s*UPDATE billing_invoices/i.test(s)) return [{ affectedRows: 1 }];
            return [[]];
        },
    };

    return {
        calls, txCalls, counters, itemInserts,
        getConnection: async () => { counters.connections++; return connection; },
        query: async (sql, params) => {
            const s = String(sql);
            calls.push({ sql: s, params });
            if (/SELECT invoice_number FROM billing_invoices/.test(s)) return [[]]; // generateNumber
            // B1.1 credit gate — contact resolution (read-only)
            if (/SELECT zoho_contact_id FROM zoho_customers_map WHERE id/.test(s)) {
                return [customerContact ? [{ zoho_contact_id: customerContact }] : []];
            }
            if (/SELECT zoho_contact_id, zoho_customer_id FROM painters WHERE id/.test(s)) {
                return [painterRow ? [painterRow] : []];
            }
            // B1.1 credit gate — the REAL checkCreditBeforeInvoice queries
            if (/credit_limit, zoho_outstanding/.test(s)) {
                return [creditRow ? [creditRow] : []];
            }
            if (/FROM credit_limit_requests/.test(s)) return [[]];
            if (/INSERT INTO audit_records/i.test(s)) return [{ insertId: 1 }];
            if (/UPDATE billing_invoices SET zoho_push_error/.test(s)) return [{ affectedRows: 1 }];
            return [[]];
        },
    };
}

const baseBody = {
    customer_type: 'customer',
    customer_id: 7, // mapped customer (B1.1: the credit gate resolves via zoho_customers_map)
    customer_name: 'Regular Customer',
    items: [
        { zoho_item_id: 'Z1', item_name: 'Apex 1L', quantity: 2, unit_price: 400 },
        { zoho_item_id: 'Z2', item_name: 'Tractor 4L', quantity: 1, unit_price: 200 },
    ],
    discount_amount: 0, // grand total 1000
};

async function runQuickSale(body, { role = 'staff', branchId = 4, poolOpts = {} } = {}) {
    const pool = makeQuickSalePool(poolOpts);
    billing.setPool(pool);
    const route = findRoute('post', '/quick-sale');
    expect(route).toBeTruthy();
    const res = mockRes();
    const req = {
        user: { id: 42, role, branch_id: branchId },
        body: quickSaleSchema.parse(body), // exactly what validate() would hand over
        params: {}, query: {},
        ip: '127.0.0.1',
        get: () => 'jest',
        originalUrl: '/api/billing/quick-sale',
    };
    await lastHandler(route)(req, res);
    return { pool, res };
}

beforeEach(() => {
    mockPush.mockReset();
    mockFlagOn.mockReset().mockResolvedValue(false);
    mockHasRolePermission.mockReset().mockResolvedValue(true);
    jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('quickSaleSchema', () => {
    it("rejects the 'credit' payment method (quick sale records money actually received)", () => {
        const r = quickSaleSchema.safeParse({
            ...baseBody,
            payments: [{ amount: 100, payment_method: 'credit' }],
        });
        expect(r.success).toBe(false);
    });

    it('rejects more than 4 split payments', () => {
        const r = quickSaleSchema.safeParse({
            ...baseBody,
            payments: Array.from({ length: 5 }, () => ({ amount: 10, payment_method: 'cash' })),
        });
        expect(r.success).toBe(false);
    });

    it('applies defaults: payments [], discount 0, reference/date optional, ids nullable', () => {
        const r = quickSaleSchema.safeParse({
            customer_type: 'customer', customer_name: 'X',
            items: [{ zoho_item_id: 'Z1', item_name: 'A', quantity: 1, unit_price: 10 }],
        });
        expect(r.success).toBe(true);
        expect(r.data.payments).toEqual([]);
        expect(r.data.discount_amount).toBe(0);
        expect(r.data.customer_id === undefined || r.data.customer_id === null).toBe(true);
    });

    it('rejects a malformed payment_date and a zero amount', () => {
        expect(quickSaleSchema.safeParse({
            ...baseBody, payments: [{ amount: 100, payment_method: 'cash', payment_date: '12-08-2026' }],
        }).success).toBe(false);
        expect(quickSaleSchema.safeParse({
            ...baseBody, payments: [{ amount: 0, payment_method: 'cash' }],
        }).success).toBe(false);
    });
});

describe('POST /quick-sale — guards (pre-transaction)', () => {
    it('Σpayments > grandTotal + 0.01 ⇒ 400 PAYMENT_EXCEEDS_TOTAL, no connection checked out', async () => {
        const { pool, res } = await runQuickSale({
            ...baseBody,
            payments: [{ amount: 600, payment_method: 'cash' }, { amount: 500, payment_method: 'upi' }],
        });
        expect(res.statusCode).toBe(400);
        expect(res.body.code).toBe('PAYMENT_EXCEEDS_TOTAL');
        expect(pool.counters.connections).toBe(0);
        expect(pool.txCalls.length).toBe(0);
    });

    it('payments without the billing.payment permission (non-admin) ⇒ 403', async () => {
        mockHasRolePermission.mockResolvedValue(false);
        const { pool, res } = await runQuickSale({
            ...baseBody, payments: [{ amount: 100, payment_method: 'cash' }],
        }, { role: 'staff' });
        expect(res.statusCode).toBe(403);
        expect(mockHasRolePermission).toHaveBeenCalledWith('staff', 'billing', 'payment');
        expect(pool.counters.connections).toBe(0);
    });

    it('a full admin never hits the role-permission lookup', async () => {
        const { res } = await runQuickSale({
            ...baseBody, payments: [{ amount: 100, payment_method: 'cash' }],
        }, { role: 'admin' });
        expect(res.statusCode).toBe(200);
        expect(mockHasRolePermission).not.toHaveBeenCalled();
    });

    it('no branch on the user ⇒ 400 (same guard as POST /invoices)', async () => {
        const { res } = await runQuickSale(baseBody, { branchId: null });
        expect(res.statusCode).toBe(400);
        expect(res.body.message).toMatch(/no branch assigned/i);
    });
});

describe('POST /quick-sale — phase 1 (one transaction)', () => {
    it('an item-insert throw rolls back, releases, 500s — NO audit row, NO push', async () => {
        const { pool, res } = await runQuickSale(baseBody, { poolOpts: { failItemInsert: true } });
        expect(res.statusCode).toBe(500);
        expect(pool.counters.rollbacks).toBe(1);
        expect(pool.counters.commits).toBe(0);
        expect(pool.counters.releases).toBe(1);
        expect(pool.calls.some(c => /INSERT INTO audit_records/i.test(c.sql))).toBe(false);
        expect(mockPush).not.toHaveBeenCalled();
    });

    it('split payments: N billing_payments INSERTs (IST-default date, received_by=user) + shared recalc', async () => {
        const { pool, res } = await runQuickSale({
            ...baseBody,
            payments: [
                { amount: 300, payment_method: 'cash' },
                { amount: 200, payment_method: 'upi', payment_reference: 'UPI9', payment_date: '2026-08-10' },
            ],
        });
        expect(res.statusCode).toBe(200);

        const payIns = pool.txCalls.filter(c => /INSERT INTO billing_payments/.test(c.sql));
        expect(payIns.length).toBe(2);
        // [invoice_id, amount, method, reference, date, received_by] (notes literal '')
        expect(payIns[0].params[0]).toBe(501);
        expect(payIns[0].params[1]).toBe(300);
        expect(payIns[0].params[2]).toBe('cash');
        expect(String(payIns[0].params[4])).toMatch(/^\d{4}-\d{2}-\d{2}$/); // IST today default
        expect(payIns[0].params[5]).toBe(42); // received_by
        expect(payIns[1].params[2]).toBe('upi');
        expect(payIns[1].params[3]).toBe('UPI9');
        expect(payIns[1].params[4]).toBe('2026-08-10'); // explicit back-date honored

        // shared recalc rewrote the header from the live SUM
        const recalc = pool.txCalls.find(c => /UPDATE billing_invoices SET\s+amount_paid/i.test(c.sql));
        expect(recalc).toBeTruthy();
        expect(recalc.params).toEqual([500, 500, 'partial', 501]);

        expect(res.body.payments).toEqual([
            { id: 901, amount: 300, payment_method: 'cash' },
            { id: 902, amount: 200, payment_method: 'upi' },
        ]);
        expect(res.body.invoice.amount_paid).toBe(500);
        expect(res.body.invoice.balance_due).toBe(500);
        expect(res.body.invoice.payment_status).toBe('partial');
        expect(res.body.print_url).toBe('/billing-receipt.html?id=501');
    });

    it('response totals match calculateTotals exactly (discount applied)', async () => {
        const body = { ...baseBody, discount_amount: 50 };
        const expected = calculateTotals(body.items, 50);
        const { pool, res } = await runQuickSale(body);
        expect(res.body.invoice.subtotal).toBe(expected.subtotal);
        expect(res.body.invoice.grand_total).toBe(expected.grandTotal);
        // and the same numbers were stored (INSERT params 7=subtotal, 9=grand_total)
        const inv = pool.txCalls.find(c => /INSERT INTO billing_invoices/.test(c.sql));
        expect(inv.params[7]).toBe(expected.subtotal);
        expect(inv.params[9]).toBe(expected.grandTotal);
        // source='direct' is literal SQL; branch + creator stamped from req.user
        expect(inv.sql).toContain("'direct'");
        expect(inv.params[12]).toBe(4);  // branch_id
        expect(inv.params[13]).toBe(42); // created_by
    });

    it('stamps salesperson_id / zoho_location_id from the body onto the invoice row', async () => {
        const { pool } = await runQuickSale({
            ...baseBody, salesperson_id: 'SP-9', zoho_location_id: 'LOC-9',
        });
        const inv = pool.txCalls.find(c => /INSERT INTO billing_invoices/.test(c.sql));
        expect(inv.params[14]).toBe('SP-9');
        expect(inv.params[15]).toBe('LOC-9');
    });
});

describe('POST /quick-sale — phase 2 (after commit, never changes the 200)', () => {
    it('flag off ⇒ push never called, zoho.attempted=false, audit quicksale.create still lands', async () => {
        mockFlagOn.mockResolvedValue(false);
        const { pool, res } = await runQuickSale(baseBody);
        expect(res.statusCode).toBe(200);
        expect(mockPush).not.toHaveBeenCalled();
        expect(res.body.zoho).toEqual({ attempted: false, pushed: false, code: null, error: null });
        const audits = pool.calls.filter(c => /INSERT INTO audit_records/i.test(c.sql));
        expect(audits.length).toBe(1);
        expect(audits[0].params[2]).toBe('billing.quicksale.create');
    });

    it('flag on + push OK ⇒ zoho.pushed with ids/state/names + zohoPush audit', async () => {
        mockFlagOn.mockResolvedValue(true);
        mockPush.mockResolvedValue({
            zohoInvoiceId: 'ZINV1', zohoInvoiceNumber: 'INV-0001', zohoState: 'approved',
            salespersonName: 'Ravi', locationName: 'Main', paymentSync: null, pointsResult: null,
        });
        const { pool, res } = await runQuickSale(baseBody, { role: 'admin' });
        expect(res.statusCode).toBe(200);
        expect(mockPush).toHaveBeenCalledWith(501, 42, { isAdmin: true });
        expect(res.body.zoho).toMatchObject({
            attempted: true, pushed: true, code: null, error: null,
            zoho_invoice_id: 'ZINV1', zoho_invoice_number: 'INV-0001',
            zoho_state: 'approved', salesperson_name: 'Ravi', location_name: 'Main',
        });
        const actions = pool.calls.filter(c => /INSERT INTO audit_records/i.test(c.sql)).map(c => c.params[2]);
        expect(actions).toEqual(['billing.quicksale.create', 'billing.invoice.zohoPush']);
    });

    it('staff quick-sale pushes with isAdmin:false', async () => {
        mockFlagOn.mockResolvedValue(true);
        mockPush.mockResolvedValue({ zohoInvoiceId: 'Z', zohoInvoiceNumber: 'N', zohoState: 'submitted' });
        await runQuickSale(baseBody, { role: 'staff' });
        expect(mockPush).toHaveBeenCalledWith(501, 42, { isAdmin: false });
    });

    it('Zoho down ⇒ STILL 200; zoho.pushed=false and the failure is stamped for the retry cron', async () => {
        mockFlagOn.mockResolvedValue(true);
        mockPush.mockRejectedValue(new Error('Zoho 500'));
        const { pool, res } = await runQuickSale(baseBody);
        expect(res.statusCode).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.zoho.attempted).toBe(true);
        expect(res.body.zoho.pushed).toBe(false);
        expect(res.body.zoho.code).toBe('PUSH_FAILED');
        expect(res.body.zoho.error).toBe('Zoho 500');
        const stamp = pool.calls.find(c => /UPDATE billing_invoices SET zoho_push_error = \?, zoho_push_attempted_at = NOW\(\)/.test(c.sql));
        expect(stamp).toBeTruthy();
        expect(stamp.params).toEqual(['Zoho 500', 501]);
    });

    it('PUSH_GATE ⇒ 200 + zoho.code PUSH_GATE + a zohoPush.refused audit', async () => {
        mockFlagOn.mockResolvedValue(true);
        const gateErr = new Error('unpaid, no credit');
        gateErr.code = 'PUSH_GATE';
        mockPush.mockRejectedValue(gateErr);
        const { pool, res } = await runQuickSale(baseBody);
        expect(res.statusCode).toBe(200);
        expect(res.body.zoho.code).toBe('PUSH_GATE');
        const actions = pool.calls.filter(c => /INSERT INTO audit_records/i.test(c.sql)).map(c => c.params[2]);
        expect(actions).toContain('billing.invoice.zohoPush.refused');
        // the stamp lands too — the retry cron will pick this invoice up
        expect(pool.calls.some(c => /UPDATE billing_invoices SET zoho_push_error/.test(c.sql))).toBe(true);
    });
});

// ═══════════════════════════════════════════
// B1.1 — create-time credit gate (owner feedback #5)
// ═══════════════════════════════════════════
describe('POST /quick-sale — B1.1 credit gate (pre-transaction)', () => {
    it('unpaid + customer NOT in the credit system ⇒ 400 CREDIT_REQUIRED, no txn, no insert, no audit, no push', async () => {
        const { pool, res } = await runQuickSale(baseBody, { poolOpts: { creditRow: null } });
        expect(res.statusCode).toBe(400);
        expect(res.body.code).toBe('CREDIT_REQUIRED');
        expect(res.body.success).toBe(false);
        // owner-specified single Tamil sentence
        expect(res.body.message).toContain('credit limit இல்லை');
        expect(res.body.message).toContain('முழு பணம்');
        expect(pool.counters.connections).toBe(0);
        expect(pool.txCalls.length).toBe(0);
        expect(pool.calls.some(c => /INSERT INTO audit_records/i.test(c.sql))).toBe(false);
        expect(mockPush).not.toHaveBeenCalled();
    });

    it('unpaid + limit 0 (no limit set) ⇒ 400 with the checkCreditBeforeInvoice reason surfaced', async () => {
        const { res } = await runQuickSale(baseBody, {
            poolOpts: { creditRow: { id: 7, zoho_contact_name: 'Regular', credit_limit: 0, zoho_outstanding: 0 } },
        });
        expect(res.statusCode).toBe(400);
        expect(res.body.code).toBe('CREDIT_REQUIRED');
        expect(res.body.reason).toMatch(/No credit limit set/i);
        expect(res.body.credit).toEqual({ limit: 0, available: 0 });
    });

    it('unpaid + available < balance ⇒ 400 (limit exceeded)', async () => {
        const { res } = await runQuickSale(baseBody, {
            poolOpts: { creditRow: { id: 7, zoho_contact_name: 'Regular', credit_limit: 500, zoho_outstanding: 0 } },
        });
        expect(res.statusCode).toBe(400);
        expect(res.body.code).toBe('CREDIT_REQUIRED');
        expect(res.body.reason).toMatch(/exceeded/i);
        expect(res.body.credit).toEqual({ limit: 500, available: 500 });
    });

    it('unpaid + eligible credit ⇒ 200 and the sale is recorded (payments:[] credit sale)', async () => {
        const { pool, res } = await runQuickSale(baseBody); // default pool: ₹100,000 limit
        expect(res.statusCode).toBe(200);
        expect(res.body.invoice.payment_status).toBe('unpaid');
        expect(pool.counters.commits).toBe(1);
        // the gate ran against the REAL checkCreditBeforeInvoice query
        expect(pool.calls.some(c => /credit_limit, zoho_outstanding/.test(c.sql))).toBe(true);
    });

    it('partial payment: the gate evaluates the UNPAID BALANCE, not the grand total', async () => {
        // grand 1000, paid 600 ⇒ balance 400; limit 500 covers 400 but not 1000.
        const { pool, res } = await runQuickSale({
            ...baseBody, payments: [{ amount: 600, payment_method: 'cash' }],
        }, {
            poolOpts: { creditRow: { id: 7, zoho_contact_name: 'Regular', credit_limit: 500, zoho_outstanding: 0 } },
        });
        expect(res.statusCode).toBe(200);
        const check = pool.calls.find(c => /credit_limit, zoho_outstanding/.test(c.sql));
        expect(check).toBeTruthy();
        expect(res.body.invoice.balance_due).toBe(400);
    });

    it('fully paid ⇒ 200 and the credit system is NEVER queried', async () => {
        const { pool, res } = await runQuickSale({
            ...baseBody, payments: [{ amount: 1000, payment_method: 'cash' }],
        }, { poolOpts: { creditRow: null } }); // ineligible row proves the gate was skipped
        expect(res.statusCode).toBe(200);
        expect(res.body.invoice.payment_status).toBe('paid');
        expect(pool.calls.some(c => /zoho_customers_map/.test(c.sql))).toBe(false);
        expect(pool.calls.some(c => /FROM painters/.test(c.sql))).toBe(false);
    });

    it('walk-in customer (no customer_id) + unpaid ⇒ 400 (no mapping ⇒ not in the credit system)', async () => {
        const body = { ...baseBody };
        delete body.customer_id;
        const { pool, res } = await runQuickSale(body);
        expect(res.statusCode).toBe(400);
        expect(res.body.code).toBe('CREDIT_REQUIRED');
        // without an id there is nothing to resolve — no probe fired
        expect(pool.calls.some(c => /zoho_customers_map/.test(c.sql))).toBe(false);
    });

    it('painter (zoho_contact_id mapped) + eligible ⇒ 200 — same gate as customers', async () => {
        const { pool, res } = await runQuickSale({
            ...baseBody, customer_type: 'painter', customer_id: null, painter_id: 3, customer_name: 'Painter Guna',
        }, { poolOpts: { painterRow: { zoho_contact_id: 'ZP-1', zoho_customer_id: null } } });
        expect(res.statusCode).toBe(200);
        const probe = pool.calls.find(c => /SELECT zoho_contact_id, zoho_customer_id FROM painters WHERE id/.test(c.sql));
        expect(probe.params).toEqual([3]);
        const check = pool.calls.find(c => /credit_limit, zoho_outstanding/.test(c.sql));
        expect(check.params[0]).toBe('ZP-1');
    });

    it('painter with ONLY zoho_customer_id still resolves (both-column read, mirrors resolveZohoContact)', async () => {
        const { pool, res } = await runQuickSale({
            ...baseBody, customer_type: 'painter', customer_id: null, painter_id: 3, customer_name: 'Painter Guna',
        }, { poolOpts: { painterRow: { zoho_contact_id: null, zoho_customer_id: 'ZP-2' } } });
        expect(res.statusCode).toBe(200);
        const check = pool.calls.find(c => /credit_limit, zoho_outstanding/.test(c.sql));
        expect(check.params[0]).toBe('ZP-2');
    });

    it('painter with NO Zoho mapping + unpaid ⇒ 400 CREDIT_REQUIRED', async () => {
        const { res } = await runQuickSale({
            ...baseBody, customer_type: 'painter', customer_id: null, painter_id: 3, customer_name: 'Painter Guna',
        }, { poolOpts: { painterRow: { zoho_contact_id: null, zoho_customer_id: null } } });
        expect(res.statusCode).toBe(400);
        expect(res.body.code).toBe('CREDIT_REQUIRED');
    });
});

// ═══════════════════════════════════════════
// B1.1 — per-item description (owner feedback #6)
// ═══════════════════════════════════════════
describe('POST /quick-sale — B1.1 item description', () => {
    it('quickSaleSchema accepts an optional per-item description (and its absence)', () => {
        const r = quickSaleSchema.safeParse({
            ...baseBody,
            items: [
                { zoho_item_id: 'Z1', item_name: 'Apex 1L', quantity: 1, unit_price: 100, description: 'Asian Paints Apex Exterior 1L White' },
                { zoho_item_id: 'Z2', item_name: 'Tractor 4L', quantity: 1, unit_price: 100 },
            ],
        });
        expect(r.success).toBe(true);
        expect(r.data.items[0].description).toBe('Asian Paints Apex Exterior 1L White');
        expect(r.data.items[1].description).toBeUndefined();
    });

    it('description persists through the item INSERT; absent ⇒ NULL', async () => {
        const { pool, res } = await runQuickSale({
            ...baseBody,
            items: [
                { zoho_item_id: 'Z1', item_name: 'Apex 1L', quantity: 2, unit_price: 400, description: 'Asian Paints Apex Exterior 1L White' },
                { zoho_item_id: 'Z2', item_name: 'Tractor 4L', quantity: 1, unit_price: 200 },
            ],
            payments: [{ amount: 1000, payment_method: 'cash' }],
        });
        expect(res.statusCode).toBe(200);
        expect(pool.itemInserts.length).toBe(2);
        // column list carries description; param order [invoice_id, zoho_item_id,
        // item_name, pack_size, quantity, unit_price, line_total, description]
        expect(pool.itemInserts[0].sql).toContain('description');
        expect(pool.itemInserts[0].params[7]).toBe('Asian Paints Apex Exterior 1L White');
        expect(pool.itemInserts[1].params[7]).toBeNull();
    });
});

// ═══════════════════════════════════════════
// B1.1 — GET /credit-check (the UI pre-check; same evaluation as the gate)
// ═══════════════════════════════════════════
describe('GET /credit-check — B1.1 pre-check endpoint', () => {
    async function runCreditCheck(query, poolOpts = {}) {
        const pool = makeQuickSalePool(poolOpts);
        billing.setPool(pool);
        const route = findRoute('get', '/credit-check');
        expect(route).toBeTruthy();
        const res = mockRes();
        await lastHandler(route)({ user: { id: 42, role: 'staff', branch_id: 4 }, query }, res);
        return { pool, res };
    }

    it('eligible customer ⇒ eligible:true with limit/available', async () => {
        const { res } = await runCreditCheck({ customer_type: 'customer', customer_id: '7', amount: '500' });
        expect(res.statusCode).toBe(200);
        expect(res.body).toMatchObject({ success: true, eligible: true, limit: 100000, available: 100000 });
    });

    it('mapped contact but no credit row ⇒ ineligible ("not in credit system" is NOT eligible — push-gate semantics)', async () => {
        const { res } = await runCreditCheck(
            { customer_type: 'customer', customer_id: '7', amount: '500' },
            { creditRow: null }
        );
        expect(res.body).toMatchObject({ success: true, eligible: false, limit: null, available: null });
        expect(res.body.reason).toMatch(/not in credit system/i);
    });

    it('limit 0 ⇒ ineligible with the no-limit reason', async () => {
        const { res } = await runCreditCheck(
            { customer_type: 'customer', customer_id: '7', amount: '500' },
            { creditRow: { id: 7, zoho_contact_name: 'Regular', credit_limit: 0, zoho_outstanding: 0 } }
        );
        expect(res.body).toMatchObject({ success: true, eligible: false, limit: 0, available: 0 });
        expect(res.body.reason).toMatch(/No credit limit set/i);
    });

    it('over the limit ⇒ ineligible, available reported', async () => {
        const { res } = await runCreditCheck(
            { customer_type: 'customer', customer_id: '7', amount: '5000' },
            { creditRow: { id: 7, zoho_contact_name: 'Regular', credit_limit: 10000, zoho_outstanding: 8000 } }
        );
        expect(res.body).toMatchObject({ success: true, eligible: false, limit: 10000, available: 2000 });
        expect(res.body.reason).toMatch(/exceeded/i);
    });

    it('unmapped customer id ⇒ ineligible without ever running the credit query', async () => {
        const { pool, res } = await runCreditCheck(
            { customer_type: 'customer', customer_id: '7', amount: '500' },
            { customerContact: null }
        );
        expect(res.body).toMatchObject({ success: true, eligible: false });
        expect(res.body.reason).toMatch(/not in the credit system/i);
        expect(pool.calls.some(c => /credit_limit, zoho_outstanding/.test(c.sql))).toBe(false);
    });

    it('painter path resolves via painters (both contact columns)', async () => {
        const { pool, res } = await runCreditCheck(
            { customer_type: 'painter', painter_id: '3', amount: '400' },
            { painterRow: { zoho_contact_id: null, zoho_customer_id: 'ZP-2' } }
        );
        expect(res.body).toMatchObject({ success: true, eligible: true });
        const check = pool.calls.find(c => /credit_limit, zoho_outstanding/.test(c.sql));
        expect(check.params).toEqual(['ZP-2']);
    });
});
