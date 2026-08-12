/**
 * B1a location default chain — services/billing-zoho-service.js pushInvoiceToZoho.
 *
 * Locks the resolution order for the Zoho location on a push:
 *   options.locationId → invoice.zoho_location_id →
 *   (invoice.branch_id → branches.zoho_location_id →
 *    zoho_locations_map.local_branch_id active row) → null (payload key omitted).
 * The branch lookups are best-effort (a DB error → null, push still succeeds).
 * Money/correctness path — CLAUDE.md §6. Pre-B1a "no branch default" behavior
 * is locked as step-0 characterization in billing-zoho-service.test.js.
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
 *   branchLoc — branches.zoho_location_id for the invoice's branch (null → no row)
 *   mapLoc    — zoho_locations_map row keyed by local_branch_id (null → no row)
 *   branchesThrow — the branches lookup throws (fail-soft path)
 */
function makePool(invoice, { branchLoc = null, mapLoc = null, branchesThrow = false } = {}) {
    const queries = [];
    return {
        queries,
        query: async (sql, params) => {
            const s = String(sql);
            queries.push({ sql: s, params });
            if (/FROM billing_invoices WHERE id/.test(s)) return [[invoice]];
            if (/FROM zoho_salespersons/.test(s)) return [[{ salesperson_name: 'Ravi Kumar' }]];
            if (/FROM painter_zoho_salesperson_map/.test(s)) return [[]];
            if (/FROM users WHERE id/.test(s)) return [[]];
            if (/SELECT zoho_location_id FROM branches WHERE id/.test(s)) {
                if (branchesThrow) throw new Error('branches table unavailable');
                return [branchLoc ? [{ zoho_location_id: branchLoc }] : []];
            }
            if (/FROM zoho_locations_map WHERE local_branch_id/.test(s)) {
                return [mapLoc ? [{ zoho_location_id: mapLoc }] : []];
            }
            if (/SELECT zoho_location_name FROM zoho_locations_map/.test(s)) {
                return [[{ zoho_location_name: 'Resolved Branch' }]];
            }
            if (/FROM billing_invoice_items/.test(s)) return [[{ zoho_item_id: 'Z1', quantity: 1, unit_price: 1000, line_total: 1000 }]];
            if (/FROM billing_payments\s+WHERE invoice_id/.test(s)) return [[]];
            if (/zoho_contact_id FROM zoho_customers_map WHERE id/.test(s)) return [[{ zoho_contact_id: 'CONT1' }]];
            if (/^\s*UPDATE/i.test(s)) return [{ affectedRows: 1 }];
            return [[]];
        }
    };
}

const baseInvoice = {
    id: 1, customer_type: 'customer', customer_id: 7, painter_id: null,
    customer_name: 'Acme', customer_phone: '9000000000',
    grand_total: 1000, amount_paid: 1000, balance_due: 0, payment_status: 'paid',
    zoho_status: 'pending', zoho_salesperson_id: null, zoho_location_id: null, branch_id: 3,
};

beforeEach(() => {
    mockCreateInvoice.mockClear();
    svc.setPointsEngine(null);
});

describe('pushInvoiceToZoho — location default chain (options > column > branch > map > null)', () => {
    it('explicit options.locationId wins — branch lookups never run', async () => {
        const pool = makePool({ ...baseInvoice, zoho_location_id: 'LOC-COL' }, { branchLoc: 'LOC-BR' });
        svc.setPool(pool);
        const res = await svc.pushInvoiceToZoho(1, 99, { salespersonId: 'SP', locationId: 'LOC-OPT' });
        expect(mockCreateInvoice.mock.calls[0][0].location_id).toBe('LOC-OPT');
        expect(res.locationId).toBe('LOC-OPT');
        expect(pool.queries.some(q => /FROM branches/.test(q.sql))).toBe(false);
    });

    it('invoice.zoho_location_id wins over the branch default', async () => {
        const pool = makePool({ ...baseInvoice, zoho_location_id: 'LOC-COL' }, { branchLoc: 'LOC-BR' });
        svc.setPool(pool);
        const res = await svc.pushInvoiceToZoho(1, 99, { salespersonId: 'SP' });
        expect(mockCreateInvoice.mock.calls[0][0].location_id).toBe('LOC-COL');
        expect(res.locationId).toBe('LOC-COL');
        expect(pool.queries.some(q => /FROM branches/.test(q.sql))).toBe(false);
    });

    it('branches.zoho_location_id fills in when options + column are empty', async () => {
        const pool = makePool({ ...baseInvoice }, { branchLoc: 'LOC-BR' });
        svc.setPool(pool);
        const res = await svc.pushInvoiceToZoho(1, 99, { salespersonId: 'SP' });
        expect(mockCreateInvoice.mock.calls[0][0].location_id).toBe('LOC-BR');
        expect(res.locationId).toBe('LOC-BR');
        // the branch was looked up by the invoice's branch_id
        const br = pool.queries.find(q => /FROM branches/.test(q.sql));
        expect(br.params).toEqual([3]);
    });

    it('zoho_locations_map (local_branch_id, active) is the fallback when branches has no mapping', async () => {
        const pool = makePool({ ...baseInvoice }, { branchLoc: null, mapLoc: 'LOC-MAP' });
        svc.setPool(pool);
        const res = await svc.pushInvoiceToZoho(1, 99, { salespersonId: 'SP' });
        expect(mockCreateInvoice.mock.calls[0][0].location_id).toBe('LOC-MAP');
        expect(res.locationId).toBe('LOC-MAP');
        const lm = pool.queries.find(q => /FROM zoho_locations_map WHERE local_branch_id/.test(q.sql));
        expect(lm.sql).toContain('is_active = 1');
        expect(lm.params).toEqual([3]);
    });

    it('all-null chain omits location_id from the payload (and stamps NULL back)', async () => {
        const pool = makePool({ ...baseInvoice }, { branchLoc: null, mapLoc: null });
        svc.setPool(pool);
        const res = await svc.pushInvoiceToZoho(1, 99, { salespersonId: 'SP' });
        expect(mockCreateInvoice.mock.calls[0][0]).not.toHaveProperty('location_id');
        expect(res.locationId).toBeNull();
        const upd = pool.queries.find(q => /^\s*UPDATE billing_invoices/i.test(q.sql));
        // zoho_location_id param (index 5 of the success UPDATE) is null
        expect(upd.params[5]).toBeNull();
    });

    it('a branch-lookup DB error fails soft — push succeeds without a location', async () => {
        const pool = makePool({ ...baseInvoice }, { branchesThrow: true });
        svc.setPool(pool);
        const res = await svc.pushInvoiceToZoho(1, 99, { salespersonId: 'SP' });
        expect(res.zohoInvoiceId).toBe('ZINV1');
        expect(mockCreateInvoice.mock.calls[0][0]).not.toHaveProperty('location_id');
    });
});
