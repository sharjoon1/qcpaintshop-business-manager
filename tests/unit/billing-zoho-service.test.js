/**
 * Characterization tests for the Zoho invoice-push money path
 * (services/billing-zoho-service.js pushInvoiceToZoho).
 *
 * Locks the owner requirement (2026-06-12): a salesperson is MANDATORY on every
 * Zoho push; painter invoices default to the painter's mapped Zoho salesperson;
 * an explicit choice wins; the chosen salesperson_id + location_id reach
 * zohoAPI.createInvoice. CLAUDE.md §6 — Zoho push is a money/correctness path.
 */

// Mock the Zoho API so no real HTTP happens; capture the createInvoice payload.
const mockCreateInvoice = jest.fn(async () => ({ invoice: { invoice_id: 'ZINV1', invoice_number: 'INV-0001' } }));
const mockCreateContact = jest.fn(async () => ({ contact: { contact_id: 'NEWCONTACT' } }));
// Returns a real Zoho payment id so the stamp-back characterization is meaningful.
let payIdCounter = 0;
const mockCreatePayment = jest.fn(async () => ({ payment: { payment_id: `ZPAY${++payIdCounter}` } }));
const mockGetDocumentStatus = jest.fn(async () => 'approved');
const mockFinalizeDocument = jest.fn(async (_kind, _id, isAdmin) => ({ state: isAdmin ? 'approved' : 'submitted' }));
// SP-1 C4: forwardInvoicePayments fetches the Zoho invoice ONCE (customer_id /
// status / date / balance) and adopt-checks existing payments before creating.
const mockGetInvoice = jest.fn(async () => ({ invoice: {
    invoice_id: 'ZINV1', customer_id: 'CONT1', status: 'sent', date: '2026-07-12', balance: 100000,
} }));
const mockGetPayments = jest.fn(async () => ({ customerpayments: [] }));
jest.mock('../../services/zoho-api', () => ({
    createInvoice: (...a) => mockCreateInvoice(...a),
    createContact: (...a) => mockCreateContact(...a),
    createPayment: (...a) => mockCreatePayment(...a),
    finalizeDocument: (...a) => mockFinalizeDocument(...a),
    getDocumentStatus: (...a) => mockGetDocumentStatus(...a),
    getInvoice: (...a) => mockGetInvoice(...a),
    getPayments: (...a) => mockGetPayments(...a),
}));

const svc = require('../../services/billing-zoho-service');

// A SQL-substring-dispatching fake pool covering every query pushInvoiceToZoho runs.
// `payments` seeds the SP-1 C4 per-row forwarding candidate SELECT (default: none).
function makePool(invoice, { painterSp = null, discountFlag = null, payments = [] } = {}) {
    return {
        query: async (sql) => {
            const s = String(sql);
            // ai_config flag for the C3 invoice-discount push. discountFlag null →
            // no config row (helper reads empty → disabled, as in prod default).
            if (/FROM ai_config WHERE config_key = 'billing_invoice_discount_push_enabled'/.test(s)) {
                return [discountFlag != null ? [{ config_value: discountFlag }] : []];
            }
            if (/FROM billing_invoices WHERE id/.test(s)) return [[invoice]];
            if (/SELECT zoho_salesperson_id FROM painters/.test(s)) return [painterSp ? [{ zoho_salesperson_id: painterSp }] : []];
            if (/FROM zoho_salespersons/.test(s)) return [[{ salesperson_name: 'Ravi Kumar' }]];
            if (/FROM painter_zoho_salesperson_map/.test(s)) return [[]];
            if (/FROM zoho_locations_map/.test(s)) return [[{ zoho_location_name: 'Main Branch' }]];
            if (/FROM billing_invoice_items/.test(s)) return [[{ zoho_item_id: 'Z1', quantity: 1, unit_price: 1000, line_total: 1000 }]];
            // SP-1 C4: per-row payment-forwarding candidate SELECT.
            if (/FROM billing_payments\s+WHERE invoice_id/.test(s)) return [payments.map(p => ({ ...p }))];
            if (/zoho_contact_id.*FROM painters/.test(s)) return [[{ zoho_contact_id: 'CONT1', zoho_customer_id: null, full_name: 'Ravi Kumar', phone: '9000000000' }]];
            if (/FROM zoho_customers_map/.test(s)) return [[{ zoho_contact_id: 'CONT1' }]];
            if (/^\s*UPDATE/i.test(s)) return [{ affectedRows: 1 }];
            return [[]];
        }
    };
}

const baseInvoice = {
    id: 1, customer_type: 'customer', customer_id: 7, painter_id: null,
    customer_name: 'Acme', customer_phone: '9000000000',
    grand_total: 1000, amount_paid: 1000, balance_due: 0, payment_status: 'paid',
    zoho_status: 'pending', zoho_salesperson_id: null, zoho_location_id: null,
};

describe('pushInvoiceToZoho — mandatory salesperson', () => {
    beforeEach(() => { mockCreateInvoice.mockClear(); svc.setPointsEngine(null); });

    it('throws SALESPERSON_REQUIRED when no salesperson can be resolved', async () => {
        svc.setPool(makePool({ ...baseInvoice }));
        await expect(svc.pushInvoiceToZoho(1, 99)).rejects.toMatchObject({ code: 'SALESPERSON_REQUIRED' });
        expect(mockCreateInvoice).not.toHaveBeenCalled();
    });

    it('defaults a painter invoice to the painter’s mapped Zoho salesperson', async () => {
        const inv = { ...baseInvoice, customer_type: 'painter', customer_id: null, painter_id: 5 };
        svc.setPool(makePool(inv, { painterSp: 'SP-PAINTER' }));
        const res = await svc.pushInvoiceToZoho(1, 99);
        expect(res.salespersonId).toBe('SP-PAINTER');
        expect(mockCreateInvoice).toHaveBeenCalledTimes(1);
        expect(mockCreateInvoice.mock.calls[0][0].salesperson_id).toBe('SP-PAINTER');
    });

    it('uses an explicitly chosen salesperson over any default and sends it to Zoho', async () => {
        svc.setPool(makePool({ ...baseInvoice }));
        const res = await svc.pushInvoiceToZoho(1, 99, { salespersonId: 'SP-CHOSEN', locationId: 'LOC-1' });
        expect(res.salespersonId).toBe('SP-CHOSEN');
        const payload = mockCreateInvoice.mock.calls[0][0];
        expect(payload.salesperson_id).toBe('SP-CHOSEN');
        expect(payload.location_id).toBe('LOC-1');
    });

    it('omits location_id from the Zoho payload when no location is given', async () => {
        svc.setPool(makePool({ ...baseInvoice }));
        await svc.pushInvoiceToZoho(1, 99, { salespersonId: 'SP-CHOSEN' });
        expect(mockCreateInvoice.mock.calls[0][0]).not.toHaveProperty('location_id');
    });

    it('admin push approves the invoice in Zoho (out of draft, finalized)', async () => {
        svc.setPool(makePool({ ...baseInvoice }));
        const res = await svc.pushInvoiceToZoho(1, 99, { salespersonId: 'SP', isAdmin: true });
        expect(res.zohoState).toBe('approved');
    });

    it('staff push submits the invoice for admin approval (out of draft, pending)', async () => {
        svc.setPool(makePool({ ...baseInvoice }));
        const res = await svc.pushInvoiceToZoho(1, 99, { salespersonId: 'SP', isAdmin: false });
        expect(res.zohoState).toBe('submitted');
    });
});

// ── SP-1 payment-sync groundwork ──
// Characterizes the CURRENT (pre-SP-1) push behavior on three money paths that
// the plan (docs/superpowers/plans/2026-07-12-sp1-payment-sync.md) changes in
// C3/C4: (a) invoice-level discount is silently dropped from the createInvoice
// payload — the live bug (Zoho total = app total + discount); (b) amount_paid is
// forwarded as ONE aggregate 'Cash' payment and the returned Zoho payment id is
// thrown away (nothing stamped back onto billing_payments); (c) a createPayment
// failure is swallowed — the push still resolves and the invoice is stamped
// 'pushed'. These lock today's shape so the C3/C4 rework is a deliberate change.
describe('pushInvoiceToZoho — push payload / payment forwarding (SP-1 baseline)', () => {
    // Wraps makePool to record every SQL run, so we can assert on which tables
    // are (never) touched while still dispatching real return values.
    function makeCapturePool(invoice, opts = {}) {
        const queries = [];
        const base = makePool(invoice, opts);
        return {
            queries,
            query: async (sql, params) => {
                queries.push({ sql: String(sql), params });
                return base.query(sql, params);
            },
        };
    }

    beforeEach(() => {
        mockCreateInvoice.mockClear();
        mockCreatePayment.mockClear();
        mockFinalizeDocument.mockClear();
        mockGetInvoice.mockClear();
        mockGetPayments.mockClear();
        payIdCounter = 0;
        svc.setPointsEngine(null);
    });

    // SP-1 C3: with the discount-push flag OFF (default), the createInvoice
    // payload is byte-identical to pre-C3 — NO discount keys even when the
    // invoice carries a discount. Locks flag-off = today's behavior.
    it('flag OFF: createInvoice payload has NO discount keys even with discount_amount > 0', async () => {
        // discount_amount arrives as a mysql2 DECIMAL string ("50.00").
        // ai_config flag explicitly disabled ('0').
        svc.setPool(makePool({ ...baseInvoice, discount_amount: '50.00' }, { discountFlag: '0' }));
        await svc.pushInvoiceToZoho(1, 99, { salespersonId: 'SP' });
        expect(mockCreateInvoice).toHaveBeenCalledTimes(1);
        const payload = mockCreateInvoice.mock.calls[0][0];
        expect(payload).not.toHaveProperty('discount');
        expect(payload).not.toHaveProperty('is_discount_before_tax');
        expect(payload).not.toHaveProperty('discount_type');
    });

    // Missing ai_config row (prod default) is treated as disabled — same as '0'.
    it('flag ABSENT (no ai_config row): still no discount keys (fail-safe disabled)', async () => {
        svc.setPool(makePool({ ...baseInvoice, discount_amount: '50.00' }));
        await svc.pushInvoiceToZoho(1, 99, { salespersonId: 'SP' });
        const payload = mockCreateInvoice.mock.calls[0][0];
        expect(payload).not.toHaveProperty('discount');
        expect(payload).not.toHaveProperty('is_discount_before_tax');
        expect(payload).not.toHaveProperty('discount_type');
    });

    // SP-1 C3: flag ON + a real discount → exactly the three discount keys with
    // the correct values (mirrors the proven bill-push block; no discount_account_id).
    it('flag ON + discount 50: payload carries exactly the three discount keys', async () => {
        svc.setPool(makePool({ ...baseInvoice, discount_amount: '50.00' }, { discountFlag: '1' }));
        await svc.pushInvoiceToZoho(1, 99, { salespersonId: 'SP' });
        const payload = mockCreateInvoice.mock.calls[0][0];
        expect(payload.discount).toBe(50);
        expect(payload.is_discount_before_tax).toBe(true);
        expect(payload.discount_type).toBe('entity_level');
        // no purchase-side account id on the sales path
        expect(payload).not.toHaveProperty('discount_account_id');
    });

    // Trimmed '1' (e.g. stored with trailing whitespace) still enables.
    it('flag " 1 " (whitespace): enabled after trim', async () => {
        svc.setPool(makePool({ ...baseInvoice, discount_amount: '50.00' }, { discountFlag: ' 1 ' }));
        await svc.pushInvoiceToZoho(1, 99, { salespersonId: 'SP' });
        expect(mockCreateInvoice.mock.calls[0][0].discount).toBe(50);
    });

    // A non-'1' value (e.g. 'true') is NOT enabled — only the literal '1'.
    it('flag "true" (not the literal 1): disabled, no discount keys', async () => {
        svc.setPool(makePool({ ...baseInvoice, discount_amount: '50.00' }, { discountFlag: 'true' }));
        await svc.pushInvoiceToZoho(1, 99, { salespersonId: 'SP' });
        expect(mockCreateInvoice.mock.calls[0][0]).not.toHaveProperty('discount');
    });

    // SP-1 C3: flag ON but discount is zero → keys ABSENT (only push when > 0).
    it('flag ON + discount 0: no discount keys in the payload', async () => {
        svc.setPool(makePool({ ...baseInvoice, discount_amount: '0.00' }, { discountFlag: '1' }));
        await svc.pushInvoiceToZoho(1, 99, { salespersonId: 'SP' });
        const payload = mockCreateInvoice.mock.calls[0][0];
        expect(payload).not.toHaveProperty('discount');
        expect(payload).not.toHaveProperty('is_discount_before_tax');
        expect(payload).not.toHaveProperty('discount_type');
    });

    // SP-1 C3: draftOnly (admin D1 path) — createInvoice runs, but finalize is
    // SKIPPED (zohoState 'draft'), the push-time payment forward is SKIPPED, and
    // the write-back still stamps zoho_status 'pushed' + zoho_approval_state 'draft'.
    it('draftOnly: finalizeDocument NOT called, createPayment NOT called, stamps zoho_approval_state "draft"', async () => {
        const pool = makeCapturePool({ ...baseInvoice, amount_paid: '500.00' });
        svc.setPool(pool);
        const res = await svc.pushInvoiceToZoho(1, 99, { salespersonId: 'SP', isAdmin: true, draftOnly: true });

        expect(res.zohoState).toBe('draft');
        expect(mockCreateInvoice).toHaveBeenCalledTimes(1);
        expect(mockFinalizeDocument).not.toHaveBeenCalled();
        expect(mockCreatePayment).not.toHaveBeenCalled();

        const upd = pool.queries.find(q => /^\s*UPDATE billing_invoices/i.test(q.sql));
        expect(upd).toBeTruthy();
        expect(upd.params[0]).toBe('pushed');   // zoho_status
        expect(upd.params).toContain('draft');  // zoho_approval_state
    });

    // SP-1 C4: the old single aggregate 'Cash' forward is REPLACED. Each unsynced
    // billing_payments row now becomes its own Zoho customerpayment carrying its
    // true mode + a deterministic reference (ACT-BP-<id>), and the returned Zoho
    // id is STAMPED BACK onto the row (was previously discarded).
    it('push forwards each unsynced payment as its own Zoho customerpayment and stamps the id back', async () => {
        const payments = [
            { id: 11, invoice_id: 1, amount: '300.00', payment_method: 'cash', payment_reference: '', payment_date: '2026-07-12', created_at: '2026-07-12 05:00:00', zoho_payment_id: null, zoho_claimed_at: null },
            { id: 12, invoice_id: 1, amount: '200.00', payment_method: 'upi', payment_reference: 'UPI9', payment_date: '2026-07-12', created_at: '2026-07-12 05:00:00', zoho_payment_id: null, zoho_claimed_at: null },
        ];
        const pool = makeCapturePool({ ...baseInvoice, amount_paid: '500.00' }, { payments });
        svc.setPool(pool);
        await svc.pushInvoiceToZoho(1, 99, { salespersonId: 'SP' });

        // Two rows → two createPayment calls (NOT one aggregate 'Cash').
        expect(mockCreatePayment).toHaveBeenCalledTimes(2);
        const [p1] = mockCreatePayment.mock.calls[0];
        const [p2] = mockCreatePayment.mock.calls[1];
        expect(p1.reference_number).toBe('ACT-BP-11');
        expect(p1.payment_mode).toBe('cash');
        expect(p1.amount).toBe(300);
        expect(p1.customer_id).toBe('CONT1'); // from the Zoho invoice, not resolveZohoContact
        expect(p2.reference_number).toBe('ACT-BP-12');
        expect(p2.payment_mode).toBe('UPI');
        expect(p2.amount).toBe(200);

        // Each success stamps the real Zoho id back onto billing_payments.
        const stamps = pool.queries.filter(q => /UPDATE billing_payments SET zoho_payment_id = \?, zoho_sync_error/i.test(q.sql));
        expect(stamps.length).toBe(2);
        expect(String(stamps[0].params[0])).toMatch(/^ZPAY/);
    });

    // SP-1 C4: a per-payment forward failure is best-effort — it NEVER fails the
    // push (invoice still stamped 'pushed') and the row is released to NULL with
    // the Zoho error recorded for a later re-sync.
    it('a payment-forward failure never fails the push and releases the row with an error', async () => {
        mockCreatePayment.mockRejectedValueOnce(new Error('Zoho customerpayments 500'));
        const payments = [
            { id: 21, invoice_id: 1, amount: '500.00', payment_method: 'cash', payment_reference: '', payment_date: '2026-07-12', created_at: '2026-07-12 05:00:00', zoho_payment_id: null, zoho_claimed_at: null },
        ];
        const pool = makeCapturePool({ ...baseInvoice, amount_paid: '500.00' }, { payments });
        svc.setPool(pool);

        const res = await svc.pushInvoiceToZoho(1, 99, { salespersonId: 'SP' });
        expect(res.zohoInvoiceId).toBe('ZINV1');

        const upd = pool.queries.find(q => /^\s*UPDATE billing_invoices/i.test(q.sql));
        expect(upd).toBeTruthy();
        expect(upd.params[0]).toBe('pushed'); // zoho_status stamped despite payment failure

        const release = pool.queries.find(q => /UPDATE billing_payments SET zoho_payment_id = NULL, zoho_sync_error/i.test(q.sql));
        expect(release).toBeTruthy();
        expect(String(release.params[0])).toMatch(/500/);

        // The failure is surfaced in the push result summary.
        expect(res.paymentSync.failed.length).toBe(1);
    });
});

// The push gate (owner policy 2026-06-12) blocks an unpaid invoice when the
// customer has no eligible credit. When it blocks it must LEAVE AN AUDIT TRAIL
// in credit_limit_violations (queued follow-up) so admins can see refused pushes.
describe('pushInvoiceToZoho — credit gate logs a violation row', () => {
    // Pool that returns a real credit row (limit < balance → over limit) and
    // captures every INSERT so we can assert the violation was logged.
    function gatePool(invoice, creditRow) {
        const inserts = [];
        return {
            inserts,
            query: async (sql, params) => {
                const s = String(sql);
                if (/^\s*INSERT INTO credit_limit_violations/i.test(s)) { inserts.push({ sql: s, params }); return [{ insertId: 1 }]; }
                if (/FROM billing_invoices WHERE id/.test(s)) return [[invoice]];
                if (/FROM zoho_salespersons/.test(s)) return [[{ salesperson_name: 'Ravi Kumar' }]];
                if (/FROM painter_zoho_salesperson_map/.test(s)) return [[]];
                if (/FROM zoho_locations_map/.test(s)) return [[]];
                if (/FROM billing_invoice_items/.test(s)) return [[{ zoho_item_id: 'Z1', quantity: 1, unit_price: 1000, line_total: 1000 }]];
                // resolveZohoContact: SELECT zoho_contact_id FROM zoho_customers_map WHERE id = ?
                if (/zoho_contact_id FROM zoho_customers_map WHERE id/.test(s)) return [[{ zoho_contact_id: 'CONT1' }]];
                // checkCreditBeforeInvoice: SELECT id, zoho_contact_name, credit_limit, zoho_outstanding ...
                if (/credit_limit, zoho_outstanding\s+FROM zoho_customers_map/.test(s)) return [[creditRow]];
                if (/FROM credit_limit_requests/.test(s)) return [[]];
                if (/^\s*UPDATE/i.test(s)) return [{ affectedRows: 1 }];
                return [[]];
            }
        };
    }

    const unpaidInvoice = {
        id: 9, customer_type: 'customer', customer_id: 7, painter_id: null,
        customer_name: 'Acme', customer_phone: '9000000000', invoice_number: 'INV-0009',
        grand_total: 5000, amount_paid: 0, balance_due: 5000, payment_status: 'unpaid',
        zoho_status: 'pending', zoho_salesperson_id: 'SP', zoho_location_id: null, branch_id: 3,
    };

    beforeEach(() => { svc.setPointsEngine(null); });

    it('logs a credit_limit_violations row (with the real columns) when the gate blocks', async () => {
        // limit 10000, outstanding 8000 → available 2000 < 5000 balance → blocked
        const pool = gatePool({ ...unpaidInvoice },
            { id: 42, zoho_contact_name: 'Acme', credit_limit: 10000, zoho_outstanding: 8000 });
        svc.setPool(pool);
        await expect(svc.pushInvoiceToZoho(9, 55, { salespersonId: 'SP' }))
            .rejects.toMatchObject({ code: 'PUSH_GATE' });
        expect(pool.inserts.length).toBe(1);
        const p = pool.inserts[0].params;
        // [customer_id, zoho_customer_map_id, invoice_number, attempted_amount,
        //  credit_limit, credit_used, available_credit, staff_id, branch_id, action_taken]
        expect(p[0]).toBe(7);            // customer_id
        expect(p[1]).toBe(42);           // zoho_customer_map_id
        expect(p[2]).toBe('INV-0009');   // invoice_number
        expect(p[3]).toBe(5000);         // attempted_amount (balance due)
        expect(p[4]).toBe(10000);        // credit_limit
        expect(p[5]).toBe(8000);         // credit_used (outstanding)
        expect(p[6]).toBe(2000);         // available_credit
        expect(p[7]).toBe(55);           // staff_id (userId)
        expect(p[8]).toBe(3);            // branch_id
        expect(p[9]).toBe('blocked');    // action_taken
    });

    it('does NOT log a violation when the invoice is fully paid (gate not reached)', async () => {
        const pool = gatePool({ ...unpaidInvoice, amount_paid: 5000, balance_due: 0, payment_status: 'paid' },
            { id: 42, zoho_contact_name: 'Acme', credit_limit: 0, zoho_outstanding: 0 });
        svc.setPool(pool);
        await svc.pushInvoiceToZoho(9, 55, { salespersonId: 'SP' });
        expect(pool.inserts.length).toBe(0);
    });
});

// Approval sync-back (owner queued 2026-06-12): the finalize-state reached at push
// must be PERSISTED (it was previously response-only), and a later sync must pull
// Zoho's current status back into billing_invoices.zoho_approval_state.
describe('pushInvoiceToZoho — persists the Zoho approval state', () => {
    function capturePool(invoice) {
        const updates = [];
        return {
            updates,
            query: async (sql, params) => {
                const s = String(sql);
                if (/^\s*UPDATE billing_invoices/i.test(s)) { updates.push({ sql: s, params }); return [{ affectedRows: 1 }]; }
                if (/FROM billing_invoices WHERE id/.test(s)) return [[invoice]];
                if (/FROM zoho_salespersons/.test(s)) return [[{ salesperson_name: 'Ravi' }]];
                if (/FROM painter_zoho_salesperson_map/.test(s)) return [[]];
                if (/FROM zoho_locations_map/.test(s)) return [[]];
                if (/FROM billing_invoice_items/.test(s)) return [[{ zoho_item_id: 'Z1', quantity: 1, unit_price: 1000, line_total: 1000 }]];
                if (/zoho_contact_id FROM zoho_customers_map WHERE id/.test(s)) return [[{ zoho_contact_id: 'CONT1' }]];
                return [[]];
            }
        };
    }
    beforeEach(() => svc.setPointsEngine(null));

    it('stamps zoho_approval_state = finalize state on an admin push (approved)', async () => {
        const pool = capturePool({ ...baseInvoice });
        svc.setPool(pool);
        await svc.pushInvoiceToZoho(1, 99, { salespersonId: 'SP', isAdmin: true });
        const upd = pool.updates.find(u => /zoho_approval_state/.test(u.sql));
        expect(upd).toBeTruthy();
        expect(upd.params).toContain('approved');
    });

    it('stamps "submitted" on a staff push', async () => {
        const pool = capturePool({ ...baseInvoice });
        svc.setPool(pool);
        await svc.pushInvoiceToZoho(1, 99, { salespersonId: 'SP', isAdmin: false });
        const upd = pool.updates.find(u => /zoho_approval_state/.test(u.sql));
        expect(upd.params).toContain('submitted');
    });
});

describe('syncInvoiceApprovalState', () => {
    beforeEach(() => mockGetDocumentStatus.mockClear());

    it('reads Zoho status and writes it to zoho_approval_state', async () => {
        const updates = [];
        svc.setPool({
            query: async (sql, params) => {
                const s = String(sql);
                if (/SELECT zoho_invoice_id FROM billing_invoices/.test(s)) return [[{ zoho_invoice_id: 'ZINV1' }]];
                if (/^\s*UPDATE billing_invoices/i.test(s)) { updates.push(params); return [{ affectedRows: 1 }]; }
                return [[]];
            }
        });
        mockGetDocumentStatus.mockResolvedValueOnce('approved');
        const state = await svc.syncInvoiceApprovalState(1);
        expect(state).toBe('approved');
        expect(mockGetDocumentStatus).toHaveBeenCalledWith('invoice', 'ZINV1');
        expect(updates[0]).toEqual(['approved', 1]);
    });

    it('returns null and does not call Zoho for an invoice not yet pushed', async () => {
        svc.setPool({
            query: async (sql) => {
                if (/SELECT zoho_invoice_id FROM billing_invoices/.test(String(sql))) return [[{ zoho_invoice_id: null }]];
                return [[]];
            }
        });
        const state = await svc.syncInvoiceApprovalState(1);
        expect(state).toBeNull();
        expect(mockGetDocumentStatus).not.toHaveBeenCalled();
    });
});

// A painter is BOTH a Zoho contact (zoho_customer_id from the painter sync) AND
// historically resolveZohoContact only read painters.zoho_contact_id — so a
// synced painter (zoho_customer_id set, zoho_contact_id NULL) made the first
// invoice push CREATE A DUPLICATE Zoho contact. Lock the COALESCE fix.
describe('resolveZohoContact — painter duplicate-contact guard', () => {
    function painterPool(painterRow) {
        const updates = [];
        const pool = {
            updates,
            query: async (sql, params) => {
                if (/FROM painters WHERE id/.test(sql)) return [painterRow ? [painterRow] : []];
                if (/^\s*UPDATE painters/i.test(sql)) { updates.push({ sql, params }); return [{ affectedRows: 1 }]; }
                return [[]];
            }
        };
        return pool;
    }
    beforeEach(() => mockCreateContact.mockClear());

    it('returns the existing zoho_contact_id without creating a contact', async () => {
        svc.setPool(painterPool({ zoho_contact_id: 'C-EXISTING', zoho_customer_id: null, full_name: 'Ravi', phone: '9' }));
        const id = await svc.resolveZohoContact('painter', { painterId: 5 });
        expect(id).toBe('C-EXISTING');
        expect(mockCreateContact).not.toHaveBeenCalled();
    });

    it('falls back to zoho_customer_id (synced painter) — NO duplicate contact created', async () => {
        svc.setPool(painterPool({ zoho_contact_id: null, zoho_customer_id: 'C-SYNCED', full_name: 'Ravi', phone: '9' }));
        const id = await svc.resolveZohoContact('painter', { painterId: 5 });
        expect(id).toBe('C-SYNCED');
        expect(mockCreateContact).not.toHaveBeenCalled();
    });

    it('creates a contact only when BOTH ids are missing', async () => {
        const pool = painterPool({ zoho_contact_id: null, zoho_customer_id: null, full_name: 'Ravi', phone: '9' });
        svc.setPool(pool);
        const id = await svc.resolveZohoContact('painter', { painterId: 5 });
        expect(mockCreateContact).toHaveBeenCalledTimes(1);
        expect(id).toBe('NEWCONTACT');
        // the new id is written back to the painter
        expect(pool.updates.length).toBeGreaterThan(0);
    });
});
