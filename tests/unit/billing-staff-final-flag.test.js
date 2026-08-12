/**
 * B1a staff-final flag — services/billing-zoho-service.js pushInvoiceToZoho.
 *
 * Locks the ai_config flag 'billing_staff_push_finalizes' contract at the
 * finalize point: flag '1' ⇒ a STAFF push reaches zohoAPI.finalizeDocument with
 * the third argument TRUE (Zoho state 'approved' — the quick-sale counter flow
 * finalizes directly); '0'/absent ⇒ FALSE ('submitted', the pre-B1a behavior,
 * also locked as step-0 characterization in billing-zoho-service.test.js);
 * admin pushes always finalize regardless of the flag; draftOnly (admin D1
 * path) bypasses finalize entirely. Money/correctness path — CLAUDE.md §6.
 *
 * Mock-pool + jest.mock('../../services/zoho-api') pattern from
 * tests/unit/billing-zoho-service.test.js.
 */

const mockCreateInvoice = jest.fn(async () => ({ invoice: { invoice_id: 'ZINV1', invoice_number: 'INV-0001' } }));
const mockCreateContact = jest.fn(async () => ({ contact: { contact_id: 'NEWCONTACT' } }));
const mockCreatePayment = jest.fn(async () => ({ payment: { payment_id: 'ZPAY1' } }));
const mockFinalizeDocument = jest.fn(async (_kind, _id, isAdmin) => ({ state: isAdmin ? 'approved' : 'submitted' }));
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

// SQL-substring-dispatching fake pool. `staffFinalFlag` seeds the ai_config
// row for 'billing_staff_push_finalizes' (null → no row = flag absent).
function makePool(invoice, { staffFinalFlag = null } = {}) {
    return {
        query: async (sql) => {
            const s = String(sql);
            if (/FROM ai_config WHERE config_key = 'billing_staff_push_finalizes'/.test(s)) {
                return [staffFinalFlag != null ? [{ config_value: staffFinalFlag }] : []];
            }
            if (/FROM billing_invoices WHERE id/.test(s)) return [[invoice]];
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

const paidInvoice = {
    id: 1, customer_type: 'customer', customer_id: 7, painter_id: null,
    customer_name: 'Acme', customer_phone: '9000000000',
    grand_total: 1000, amount_paid: 1000, balance_due: 0, payment_status: 'paid',
    zoho_status: 'pending', zoho_salesperson_id: null, zoho_location_id: null,
};

describe('pushInvoiceToZoho — billing_staff_push_finalizes flag', () => {
    beforeEach(() => {
        mockCreateInvoice.mockClear();
        mockFinalizeDocument.mockClear();
        svc.setPointsEngine(null);
    });

    it("flag '1': STAFF push finalizes — finalizeDocument(_, _, true) and zohoState 'approved'", async () => {
        svc.setPool(makePool({ ...paidInvoice }, { staffFinalFlag: '1' }));
        const res = await svc.pushInvoiceToZoho(1, 99, { salespersonId: 'SP', isAdmin: false });
        expect(mockFinalizeDocument).toHaveBeenCalledTimes(1);
        expect(mockFinalizeDocument.mock.calls[0]).toEqual(['invoice', 'ZINV1', true]);
        expect(res.zohoState).toBe('approved');
    });

    it("flag '0': staff push only submits — finalizeDocument(_, _, false), zohoState 'submitted'", async () => {
        svc.setPool(makePool({ ...paidInvoice }, { staffFinalFlag: '0' }));
        const res = await svc.pushInvoiceToZoho(1, 99, { salespersonId: 'SP', isAdmin: false });
        expect(mockFinalizeDocument.mock.calls[0][2]).toBe(false);
        expect(res.zohoState).toBe('submitted');
    });

    it('flag ABSENT (no ai_config row): pre-B1a behavior — submitted', async () => {
        svc.setPool(makePool({ ...paidInvoice }));
        const res = await svc.pushInvoiceToZoho(1, 99, { salespersonId: 'SP', isAdmin: false });
        expect(mockFinalizeDocument.mock.calls[0][2]).toBe(false);
        expect(res.zohoState).toBe('submitted');
    });

    it("admin push finalizes even with the flag '0' (isAdmin short-circuits the flag)", async () => {
        svc.setPool(makePool({ ...paidInvoice }, { staffFinalFlag: '0' }));
        const res = await svc.pushInvoiceToZoho(1, 99, { salespersonId: 'SP', isAdmin: true });
        expect(mockFinalizeDocument.mock.calls[0][2]).toBe(true);
        expect(res.zohoState).toBe('approved');
    });

    it("draftOnly bypasses finalize entirely — flag '1' notwithstanding", async () => {
        svc.setPool(makePool({ ...paidInvoice }, { staffFinalFlag: '1' }));
        const res = await svc.pushInvoiceToZoho(1, 99, { salespersonId: 'SP', isAdmin: true, draftOnly: true });
        expect(mockFinalizeDocument).not.toHaveBeenCalled();
        expect(res.zohoState).toBe('draft');
    });
});
