const { computeSyncWindow, aggregateLineItems } = require('../../services/zoho-invoice-line-sync');

describe('invoice-line-sync helpers', () => {
    test('computeSyncWindow returns 90-day window when DB empty', () => {
        const w = computeSyncWindow(null, new Date('2026-04-14T12:00:00Z'));
        expect(w.from).toBe('2026-01-14');
        expect(w.to).toBe('2026-04-13');
    });

    test('computeSyncWindow returns incremental window when lastDate given', () => {
        const w = computeSyncWindow('2026-04-10', new Date('2026-04-14T12:00:00Z'));
        expect(w.from).toBe('2026-04-09');
        expect(w.to).toBe('2026-04-13');
    });

    test('aggregateLineItems sums qty per (branch, item, date)', () => {
        const invoice = {
            invoice_id: 'INV1', invoice_date: '2026-04-10', local_branch_id: 3,
            line_items: [
                { item_id: 'I1', quantity: 2, item_total: 200 },
                { item_id: 'I1', quantity: 3, item_total: 300 },
                { item_id: 'I2', quantity: 1, item_total: 50 }
            ]
        };
        const agg = aggregateLineItems([invoice]);
        expect(agg).toContainEqual({ local_branch_id: 3, zoho_item_id: 'I1', sale_date: '2026-04-10', qty_sold: 5, revenue: 500, invoice_count: 1 });
        expect(agg).toContainEqual({ local_branch_id: 3, zoho_item_id: 'I2', sale_date: '2026-04-10', qty_sold: 1, revenue: 50, invoice_count: 1 });
    });

    test('aggregateLineItems counts invoices once per item even if multiple lines for same item', () => {
        const invoice = {
            invoice_id: 'INV1', invoice_date: '2026-04-10', local_branch_id: 3,
            line_items: [
                { item_id: 'I1', quantity: 1, item_total: 100 },
                { item_id: 'I1', quantity: 1, item_total: 100 }
            ]
        };
        const agg = aggregateLineItems([invoice]);
        expect(agg[0].invoice_count).toBe(1);
        expect(agg[0].qty_sold).toBe(2);
    });
});
