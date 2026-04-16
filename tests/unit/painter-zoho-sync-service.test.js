// tests/unit/painter-zoho-sync-service.test.js
const service = require('../../services/painter-zoho-sync-service');

function makePool(state) {
    return {
        query: jest.fn(async (sql, params) => {
            if (/FROM painters WHERE id/i.test(sql)) return [state.painters.filter(p => p.id === params[0])];
            if (/FROM branches WHERE id/i.test(sql)) return [state.branches.filter(b => b.id === params[0])];
            if (/FROM zoho_customers_map/i.test(sql)) return [state.custMap];
            if (/FROM painter_zoho_salesperson_map/i.test(sql)) return [state.spMap];
            if (/UPDATE painters/i.test(sql)) { state.updates.push({ sql, params }); return [{ affectedRows: 1 }]; }
            if (/INTO painter_zoho_sync_queue/i.test(sql)) { state.queue.push(params); return [{ insertId: 1 }]; }
            if (/INTO painter_zoho_salesperson_map/i.test(sql)) { return [{ insertId: 1 }]; }
            if (/INTO zoho_customers_map/i.test(sql)) { return [{ insertId: 1 }]; }
            return [[]];
        })
    };
}

describe('syncPainterToZoho', () => {
    test('skips when both IDs already set (idempotent)', async () => {
        const state = {
            painters: [{ id: 1, zoho_customer_id: 'Z1', zoho_salesperson_id: 'S1', phone: '9876543210' }],
            branches: [], custMap: [], spMap: [], updates: [], queue: []
        };
        const zohoApi = { createContact: jest.fn(), createSalesperson: jest.fn() };
        const res = await service.syncPainterToZoho(1, { pool: makePool(state), zohoApi });
        expect(res.skipped).toBe(true);
        expect(zohoApi.createContact).not.toHaveBeenCalled();
        expect(zohoApi.createSalesperson).not.toHaveBeenCalled();
    });

    test('creates Zoho customer + salesperson when missing', async () => {
        const state = {
            painters: [{ id: 2, full_name: 'Karthik', phone: '9876543210', email: null, branch_id: 1 }],
            branches: [{ id: 1, code: 'RMD', name: 'Rmd', zoho_location_id: 'L1' }],
            custMap: [], spMap: [], updates: [], queue: []
        };
        const zohoApi = {
            createContact: jest.fn(async () => ({ contact: { contact_id: 'Z999' } })),
            createSalesperson: jest.fn(async () => ({ salesperson: { salesperson_id: 'S999' } }))
        };
        const pool = makePool(state);
        const res = await service.syncPainterToZoho(2, { pool, zohoApi });
        expect(zohoApi.createContact).toHaveBeenCalled();
        const callArgs = zohoApi.createContact.mock.calls[0][0];
        expect(callArgs.contact_name).toBe('PNTR RMD Karthik');
        expect(zohoApi.createSalesperson).toHaveBeenCalled();
        expect(res.created_customer).toBe('Z999');
        expect(res.created_salesperson).toBe('S999');
    });

    test('queues customer create on Zoho error, no salesperson attempt', async () => {
        const state = {
            painters: [{ id: 3, full_name: 'X', phone: '9876500000', branch_id: 1 }],
            branches: [{ id: 1, code: 'RMD', name: 'Rmd' }],
            custMap: [], spMap: [], updates: [], queue: []
        };
        const zohoApi = {
            createContact: jest.fn(async () => { throw new Error('429 rate limit'); }),
            createSalesperson: jest.fn()
        };
        const res = await service.syncPainterToZoho(3, { pool: makePool(state), zohoApi });
        expect(res.queued).toContain('customer');
        expect(state.queue.length).toBeGreaterThan(0);
        expect(zohoApi.createSalesperson).not.toHaveBeenCalled();
    });
});

describe('retry backoff', () => {
    test('computeNextRetry caps at 1d after 4 attempts', () => {
        expect(service._computeNextRetry(1)).toBe(60 * 60 * 1000);
        expect(service._computeNextRetry(2)).toBe(4 * 60 * 60 * 1000);
        expect(service._computeNextRetry(3)).toBe(12 * 60 * 60 * 1000);
        expect(service._computeNextRetry(4)).toBe(24 * 60 * 60 * 1000);
        expect(service._computeNextRetry(5)).toBe(24 * 60 * 60 * 1000);
    });
});
