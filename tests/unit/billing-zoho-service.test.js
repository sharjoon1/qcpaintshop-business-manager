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
jest.mock('../../services/zoho-api', () => ({
    createInvoice: (...a) => mockCreateInvoice(...a),
    createContact: jest.fn(async () => ({ contact: { contact_id: 'CONT1' } })),
    createPayment: jest.fn(async () => ({})),
    finalizeDocument: jest.fn(async (_kind, _id, isAdmin) => ({ state: isAdmin ? 'approved' : 'submitted' })),
}));

const svc = require('../../services/billing-zoho-service');

// A SQL-substring-dispatching fake pool covering every query pushInvoiceToZoho runs.
function makePool(invoice, { painterSp = null } = {}) {
    return {
        query: async (sql) => {
            const s = String(sql);
            if (/FROM billing_invoices WHERE id/.test(s)) return [[invoice]];
            if (/SELECT zoho_salesperson_id FROM painters/.test(s)) return [painterSp ? [{ zoho_salesperson_id: painterSp }] : []];
            if (/FROM zoho_salespersons/.test(s)) return [[{ salesperson_name: 'Ravi Kumar' }]];
            if (/FROM painter_zoho_salesperson_map/.test(s)) return [[]];
            if (/FROM zoho_locations_map/.test(s)) return [[{ zoho_location_name: 'Main Branch' }]];
            if (/FROM billing_invoice_items/.test(s)) return [[{ zoho_item_id: 'Z1', quantity: 1, unit_price: 1000, line_total: 1000 }]];
            if (/zoho_contact_id, full_name, phone FROM painters/.test(s)) return [[{ zoho_contact_id: 'CONT1', full_name: 'Ravi Kumar', phone: '9000000000' }]];
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
