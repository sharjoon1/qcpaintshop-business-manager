/**
 * B1a failed-push retry loop — services/billing-zoho-service.js
 * retryUnpushedInvoices (driven by the 15-min sync-scheduler cron).
 *
 * Locks:
 *   - candidate SELECT shape: deleted_at IS NULL, zoho_status='pending',
 *     zoho_push_error IS NOT NULL, ≥15-min cool-down on zoho_push_attempted_at,
 *     oldest-attempt-first, LIMIT bound as a param (default 5);
 *   - each retry pushes as STAFF (isAdmin:false) under the original creator;
 *   - a successful push's UPDATE clears the stamp (zoho_push_error = NULL);
 *   - a failed retry re-stamps zoho_push_error + zoho_push_attempted_at=NOW()
 *     and never throws;
 *   - every attempt writes a system audit row (req=null → user_id NULL,
 *     actor_type 'system', action billing.invoice.zohoPush.retry).
 * Money/correctness path — CLAUDE.md §6.
 */

const mockCreateInvoice = jest.fn(async () => ({ invoice: { invoice_id: 'ZINV1', invoice_number: 'INV-0001' } }));
const mockCreateContact = jest.fn(async () => ({ contact: { contact_id: 'NEWCONTACT' } }));
const mockCreatePayment = jest.fn(async () => ({ payment: { payment_id: 'ZPAY1' } }));
const mockFinalizeDocument = jest.fn(async (_k, _i, isAdmin) => ({ state: isAdmin ? 'approved' : 'submitted' }));
const mockGetInvoice = jest.fn(async () => ({ invoice: { invoice_id: 'ZINV1', customer_id: 'CONT1', status: 'sent', date: '2026-08-12', balance: 1000 } }));
const mockGetPayments = jest.fn(async () => ({ customerpayments: [] }));
jest.mock('../../services/zoho-api', () => ({
    createInvoice: (...a) => mockCreateInvoice(...a),
    createContact: (...a) => mockCreateContact(...a),
    createPayment: (...a) => mockCreatePayment(...a),
    finalizeDocument: (...a) => mockFinalizeDocument(...a),
    getDocumentStatus: jest.fn(),
    getInvoice: (...a) => mockGetInvoice(...a),
    getPayments: (...a) => mockGetPayments(...a),
}));

const svc = require('../../services/billing-zoho-service');
const audit = require('../../services/audit-log');

// Capture pool. `candidates` seeds the retry SELECT; `invoices` maps
// billing_invoices.id → row for the per-push invoice load (absent id → the
// push throws "Invoice N not found", exercising the failure re-stamp).
function makeRetryPool({ candidates = [], invoices = {} } = {}) {
    const queries = [];
    return {
        queries,
        query: async (sql, params) => {
            const s = String(sql);
            queries.push({ sql: s, params });
            if (/INSERT INTO audit_records/i.test(s)) return [{ insertId: 1 }];
            if (/SELECT id, created_by FROM billing_invoices/.test(s)) return [candidates.map(c => ({ ...c }))];
            if (/FROM billing_invoices WHERE id/.test(s)) {
                const row = invoices[params[0]];
                return [row ? [{ ...row }] : []];
            }
            if (/FROM zoho_salespersons/.test(s)) return [[{ salesperson_name: 'Ravi Kumar' }]];
            if (/FROM painter_zoho_salesperson_map/.test(s)) return [[]];
            if (/FROM branches/.test(s)) return [[]];
            if (/FROM users WHERE id/.test(s)) return [[]];
            if (/FROM zoho_locations_map/.test(s)) return [[]];
            if (/FROM billing_invoice_items/.test(s)) return [[{ zoho_item_id: 'Z1', quantity: 1, unit_price: 1000, line_total: 1000 }]];
            if (/FROM billing_payments\s+WHERE invoice_id/.test(s)) return [[]];
            if (/zoho_contact_id FROM zoho_customers_map WHERE id/.test(s)) return [[{ zoho_contact_id: 'CONT1' }]];
            if (/^\s*UPDATE/i.test(s)) return [{ affectedRows: 1 }];
            return [[]];
        }
    };
}

const pushableInvoice = {
    id: 11, customer_type: 'customer', customer_id: 7, painter_id: null,
    customer_name: 'Acme', customer_phone: '9000000000',
    grand_total: 1000, amount_paid: 1000, balance_due: 0, payment_status: 'paid',
    zoho_status: 'pending', zoho_salesperson_id: 'SP-COL', zoho_location_id: null,
};

beforeEach(() => {
    mockCreateInvoice.mockClear();
    mockFinalizeDocument.mockClear();
    svc.setPointsEngine(null);
    jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('retryUnpushedInvoices — candidate SELECT shape', () => {
    it('selects stamped-pending invoices only, oldest attempt first, limit as a param (default 5)', async () => {
        const pool = makeRetryPool();
        svc.setPool(pool);
        audit.setPool(pool);
        const summary = await svc.retryUnpushedInvoices();
        expect(summary).toEqual({ attempted: 0, pushed: 0, failed: 0 });

        const sel = pool.queries.find(q => /SELECT id, created_by FROM billing_invoices/.test(q.sql));
        expect(sel).toBeTruthy();
        expect(sel.sql).toContain('deleted_at IS NULL');
        expect(sel.sql).toContain("zoho_status = 'pending'");
        expect(sel.sql).toContain('zoho_push_error IS NOT NULL');
        expect(sel.sql).toContain('zoho_push_attempted_at < NOW() - INTERVAL 15 MINUTE');
        expect(sel.sql).toContain('ORDER BY zoho_push_attempted_at ASC');
        expect(sel.sql).toContain('LIMIT ?');
        expect(sel.params).toEqual([5]);
    });

    it('honors an explicit limit', async () => {
        const pool = makeRetryPool();
        svc.setPool(pool);
        audit.setPool(pool);
        await svc.retryUnpushedInvoices({ limit: 2 });
        const sel = pool.queries.find(q => /SELECT id, created_by FROM billing_invoices/.test(q.sql));
        expect(sel.params).toEqual([2]);
    });
});

describe('retryUnpushedInvoices — success path', () => {
    it('pushes as STAFF under the creator; the success UPDATE clears zoho_push_error', async () => {
        const pool = makeRetryPool({
            candidates: [{ id: 11, created_by: 42 }],
            invoices: { 11: { ...pushableInvoice } },
        });
        svc.setPool(pool);
        audit.setPool(pool);

        const summary = await svc.retryUnpushedInvoices({ limit: 5 });
        expect(summary).toEqual({ attempted: 1, pushed: 1, failed: 0 });

        // staff retry: finalize third arg false (flag absent in this pool)
        expect(mockFinalizeDocument.mock.calls[0][2]).toBe(false);

        const upd = pool.queries.find(q => /UPDATE billing_invoices\s+SET zoho_status = \?/i.test(q.sql));
        expect(upd).toBeTruthy();
        expect(upd.sql).toContain('zoho_push_error = NULL');
        expect(upd.params[0]).toBe('pushed');

        // system audit row: user_id NULL, actor_type 'system', retry action
        const auditIns = pool.queries.find(q => /INSERT INTO audit_records/i.test(q.sql));
        expect(auditIns).toBeTruthy();
        expect(auditIns.params[0]).toBeNull();          // user_id
        expect(auditIns.params[1]).toBe('system');      // actor_type
        expect(auditIns.params[2]).toBe('billing.invoice.zohoPush.retry');
    });
});

describe('retryUnpushedInvoices — failure path', () => {
    it('re-stamps zoho_push_error + zoho_push_attempted_at=NOW() and never throws', async () => {
        // Candidate 13 has no invoice row → pushInvoiceToZoho throws
        // "Invoice 13 not found" and the loop must absorb + re-stamp it.
        const pool = makeRetryPool({ candidates: [{ id: 13, created_by: 42 }], invoices: {} });
        svc.setPool(pool);
        audit.setPool(pool);

        const summary = await svc.retryUnpushedInvoices({ limit: 5 });
        expect(summary).toEqual({ attempted: 1, pushed: 0, failed: 1 });

        const stamp = pool.queries.find(q => /UPDATE billing_invoices SET zoho_push_error = \?, zoho_push_attempted_at = NOW\(\)/.test(q.sql));
        expect(stamp).toBeTruthy();
        expect(String(stamp.params[0])).toMatch(/not found/i);
        expect(stamp.params[1]).toBe(13);

        const auditIns = pool.queries.find(q => /INSERT INTO audit_records/i.test(q.sql));
        expect(auditIns.params[1]).toBe('system');
        expect(auditIns.params[2]).toBe('billing.invoice.zohoPush.retry');
        expect(String(auditIns.params[6])).toContain('"ok":false'); // after_json
    });

    it('one bad row does not stop the batch — the next candidate still pushes', async () => {
        const pool = makeRetryPool({
            candidates: [{ id: 13, created_by: 42 }, { id: 11, created_by: 42 }],
            invoices: { 11: { ...pushableInvoice } },
        });
        svc.setPool(pool);
        audit.setPool(pool);

        const summary = await svc.retryUnpushedInvoices({ limit: 5 });
        expect(summary).toEqual({ attempted: 2, pushed: 1, failed: 1 });
        expect(mockCreateInvoice).toHaveBeenCalledTimes(1);
    });
});
