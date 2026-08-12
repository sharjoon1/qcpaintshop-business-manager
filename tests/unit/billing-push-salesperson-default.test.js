/**
 * B1a salesperson default chain — services/billing-zoho-service.js pushInvoiceToZoho.
 *
 * Locks the resolution order (salesperson stays MANDATORY — owner 2026-06-12):
 *   options.salespersonId → invoice.zoho_salesperson_id →
 *   painter's mapped salesperson (painter invoices) →
 *   pushing user's users.zoho_salesperson_id →
 *   ai_config 'billing_default_salesperson_id' →
 *   throw SALESPERSON_REQUIRED (terminal error preserved).
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

/**
 * Capture pool with per-probe seeds:
 *   painterSp — painters.zoho_salesperson_id (painter invoices)
 *   userSp    — users.zoho_salesperson_id for the pushing user
 *   cfgSp     — ai_config 'billing_default_salesperson_id' value (null → no row)
 */
function makePool(invoice, { painterSp = null, userSp = null, cfgSp = null } = {}) {
    const queries = [];
    return {
        queries,
        query: async (sql, params) => {
            const s = String(sql);
            queries.push({ sql: s, params });
            if (/FROM ai_config WHERE config_key = 'billing_default_salesperson_id'/.test(s)) {
                return [cfgSp != null ? [{ config_value: cfgSp }] : []];
            }
            if (/FROM billing_invoices WHERE id/.test(s)) return [[invoice]];
            if (/SELECT zoho_salesperson_id FROM painters/.test(s)) return [painterSp ? [{ zoho_salesperson_id: painterSp }] : []];
            if (/SELECT zoho_salesperson_id FROM users WHERE id/.test(s)) return [userSp ? [{ zoho_salesperson_id: userSp }] : []];
            if (/FROM zoho_salespersons/.test(s)) return [[{ salesperson_name: 'Ravi Kumar' }]];
            if (/FROM painter_zoho_salesperson_map/.test(s)) return [[]];
            if (/FROM branches/.test(s)) return [[]];
            if (/FROM zoho_locations_map/.test(s)) return [[]];
            if (/FROM billing_invoice_items/.test(s)) return [[{ zoho_item_id: 'Z1', quantity: 1, unit_price: 1000, line_total: 1000 }]];
            if (/FROM billing_payments\s+WHERE invoice_id/.test(s)) return [[]];
            if (/zoho_contact_id.*FROM painters/.test(s)) return [[{ zoho_contact_id: 'CONT1', zoho_customer_id: null, full_name: 'Ravi', phone: '9' }]];
            if (/zoho_contact_id FROM zoho_customers_map WHERE id/.test(s)) return [[{ zoho_contact_id: 'CONT1' }]];
            if (/^\s*UPDATE/i.test(s)) return [{ affectedRows: 1 }];
            return [[]];
        }
    };
}

const customerInvoice = {
    id: 1, customer_type: 'customer', customer_id: 7, painter_id: null,
    customer_name: 'Acme', customer_phone: '9000000000',
    grand_total: 1000, amount_paid: 1000, balance_due: 0, payment_status: 'paid',
    zoho_status: 'pending', zoho_salesperson_id: null, zoho_location_id: null,
};

beforeEach(() => {
    mockCreateInvoice.mockClear();
    svc.setPointsEngine(null);
});

describe('pushInvoiceToZoho — salesperson default chain', () => {
    it("pushing user's users.zoho_salesperson_id fills in (queried by the userId param)", async () => {
        const pool = makePool({ ...customerInvoice }, { userSp: 'SP-USER' });
        svc.setPool(pool);
        const res = await svc.pushInvoiceToZoho(1, 99);
        expect(res.salespersonId).toBe('SP-USER');
        expect(mockCreateInvoice.mock.calls[0][0].salesperson_id).toBe('SP-USER');
        const uq = pool.queries.find(q => /FROM users WHERE id/.test(q.sql));
        expect(uq.params).toEqual([99]); // the pushing user, not the invoice creator
    });

    it("ai_config 'billing_default_salesperson_id' is the last resort before the throw", async () => {
        const pool = makePool({ ...customerInvoice }, { userSp: null, cfgSp: 'SP-CFG' });
        svc.setPool(pool);
        const res = await svc.pushInvoiceToZoho(1, 99);
        expect(res.salespersonId).toBe('SP-CFG');
        expect(mockCreateInvoice.mock.calls[0][0].salesperson_id).toBe('SP-CFG');
    });

    it('painter mapping wins over BOTH the user column and the config default', async () => {
        const painterInvoice = { ...customerInvoice, customer_type: 'painter', customer_id: null, painter_id: 5 };
        const pool = makePool(painterInvoice, { painterSp: 'SP-PAINTER', userSp: 'SP-USER', cfgSp: 'SP-CFG' });
        svc.setPool(pool);
        const res = await svc.pushInvoiceToZoho(1, 99);
        expect(res.salespersonId).toBe('SP-PAINTER');
        expect(mockCreateInvoice.mock.calls[0][0].salesperson_id).toBe('SP-PAINTER');
    });

    it('an explicitly chosen salesperson wins over every default', async () => {
        const pool = makePool({ ...customerInvoice, zoho_salesperson_id: 'SP-COL' },
            { userSp: 'SP-USER', cfgSp: 'SP-CFG' });
        svc.setPool(pool);
        const res = await svc.pushInvoiceToZoho(1, 99, { salespersonId: 'SP-CHOSEN' });
        expect(res.salespersonId).toBe('SP-CHOSEN');
        expect(pool.queries.some(q => /FROM users WHERE id/.test(q.sql))).toBe(false);
    });

    it('invoice column wins over the user/config defaults', async () => {
        const pool = makePool({ ...customerInvoice, zoho_salesperson_id: 'SP-COL' },
            { userSp: 'SP-USER', cfgSp: 'SP-CFG' });
        svc.setPool(pool);
        const res = await svc.pushInvoiceToZoho(1, 99);
        expect(res.salespersonId).toBe('SP-COL');
    });

    it('empty config value ("") does NOT satisfy the requirement — terminal SALESPERSON_REQUIRED preserved', async () => {
        const pool = makePool({ ...customerInvoice }, { userSp: null, cfgSp: '' });
        svc.setPool(pool);
        await expect(svc.pushInvoiceToZoho(1, 99)).rejects.toMatchObject({ code: 'SALESPERSON_REQUIRED' });
        expect(mockCreateInvoice).not.toHaveBeenCalled();
    });

    it('whole chain empty ⇒ SALESPERSON_REQUIRED, nothing sent to Zoho', async () => {
        const pool = makePool({ ...customerInvoice });
        svc.setPool(pool);
        await expect(svc.pushInvoiceToZoho(1, 99)).rejects.toMatchObject({ code: 'SALESPERSON_REQUIRED' });
        expect(mockCreateInvoice).not.toHaveBeenCalled();
    });
});
