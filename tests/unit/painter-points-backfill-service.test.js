// tests/unit/painter-points-backfill-service.test.js
jest.mock('../../services/painter-points-engine', () => ({
    setPool: jest.fn(),
    addPoints: jest.fn(async () => 0)
}));
const pointsEngine = require('../../services/painter-points-engine');
const backfill = require('../../services/painter-points-backfill-service');

function makePool(state) {
    return {
        query: jest.fn(async (sql, params) => {
            if (/FROM painters WHERE id = \?/i.test(sql)) return [state.painters.filter(p => p.id === params[0])];
            if (/FROM zoho_invoices zi/i.test(sql) && /zoho_customer_id = \?/i.test(sql)) return [state.directInvoices];
            if (/FROM zoho_invoices.*zoho_salesperson_id = \?/i.test(sql)) return [state.spInvoices];
            if (/FROM painter_invoices_processed/i.test(sql)) return [state.processed];
            if (/INSERT (IGNORE )?INTO painter_invoices_processed/i.test(sql)) { state.processedInserts.push(params); return [{ insertId: 1 }]; }
            return [[]];
        })
    };
}

beforeEach(() => {
    pointsEngine.addPoints.mockClear();
});

describe('backfillPainter', () => {
    test('skipped when painter not activated', async () => {
        const state = {
            painters: [{ id: 1, activated_at: null, zoho_customer_id: 'Z1' }],
            directInvoices: [], spInvoices: [], processed: [],
            pointsInserts: [], processedInserts: []
        };
        const res = await backfill.backfillPainter(1, '2025-12-01', { pool: makePool(state) });
        expect(res.skipped).toBe('not_activated');
    });

    test('direct billing awards annual pool only', async () => {
        const state = {
            painters: [{ id: 2, activated_at: new Date(), zoho_customer_id: 'Z2', zoho_salesperson_id: null, user_id: 20 }],
            directInvoices: [{ zoho_invoice_id: 'INV1', total: 10000, invoice_date: '2026-01-15', status: 'paid' }],
            spInvoices: [],
            processed: [],
            pointsInserts: [], processedInserts: []
        };
        const rates = { selfAnnual: 0.005, custRegular: 0.005, custAnnual: 0.005 };
        const res = await backfill.backfillPainter(2, '2025-12-01', { pool: makePool(state), rates });
        expect(res.direct_points_awarded).toBe(50);
        expect(pointsEngine.addPoints).toHaveBeenCalledTimes(1);
        const [, pool] = pointsEngine.addPoints.mock.calls[0];
        expect(pool).toBe('annual');
    });

    test('salesperson billing awards regular + annual', async () => {
        const state = {
            painters: [{ id: 3, activated_at: new Date(), zoho_customer_id: null, zoho_salesperson_id: 'S3', user_id: 30 }],
            directInvoices: [],
            spInvoices: [{ zoho_invoice_id: 'INV9', total: 20000, invoice_date: '2026-02-01', status: 'paid' }],
            processed: [],
            pointsInserts: [], processedInserts: []
        };
        const rates = { selfAnnual: 0.005, custRegular: 0.005, custAnnual: 0.005 };
        const res = await backfill.backfillPainter(3, '2025-12-01', { pool: makePool(state), rates });
        expect(pointsEngine.addPoints).toHaveBeenCalledTimes(2);
        expect(res.salesperson_points_awarded).toBe(200);
    });

    test('already-processed invoice skipped (idempotent)', async () => {
        const state = {
            painters: [{ id: 4, activated_at: new Date(), zoho_customer_id: 'Z4', zoho_salesperson_id: null }],
            directInvoices: [],
            spInvoices: [],
            processed: [],
            pointsInserts: [], processedInserts: []
        };
        const res = await backfill.backfillPainter(4, '2025-12-01', { pool: makePool(state), rates: { selfAnnual: 0.005, custRegular: 0.005, custAnnual: 0.005 } });
        expect(res.direct_points_awarded).toBe(0);
        expect(pointsEngine.addPoints).not.toHaveBeenCalled();
    });
});
