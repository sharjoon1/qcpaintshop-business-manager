const { buildOtherBranchesMap, sortReportRows } = require('../../services/reorder-report-service');

describe('reorder-report helpers', () => {
    test('buildOtherBranchesMap indexes stock per item excluding target branch, positive only, sorted desc', () => {
        const stocks = [
            { zoho_item_id: 'I1', local_branch_id: 1, location_name: 'Main', stock_on_hand: 50 },
            { zoho_item_id: 'I1', local_branch_id: 2, location_name: 'Thangachi', stock_on_hand: 0 },
            { zoho_item_id: 'I1', local_branch_id: 3, location_name: 'Paramakudi', stock_on_hand: 20 },
            { zoho_item_id: 'I2', local_branch_id: 1, location_name: 'Main', stock_on_hand: 5 }
        ];
        const map = buildOtherBranchesMap(stocks, 2);
        // Each entry now also carries their_reorder_level + transferable_qty (for
        // inter-branch transfer suggestions). With no reorder level in the input,
        // transferable_qty === stock_on_hand, and rows sort by transferable desc.
        expect(map.get('I1')).toEqual([
            { branch_id: 1, branch_name: 'Main', stock_on_hand: 50, their_reorder_level: 0, transferable_qty: 50 },
            { branch_id: 3, branch_name: 'Paramakudi', stock_on_hand: 20, their_reorder_level: 0, transferable_qty: 20 }
        ]);
        expect(map.get('I2')).toEqual([
            { branch_id: 1, branch_name: 'Main', stock_on_hand: 5, their_reorder_level: 0, transferable_qty: 5 }
        ]);
    });

    test('sortReportRows sorts by severity desc then days_to_stockout asc', () => {
        const rows = [
            { severity: 'medium', days_to_stockout: 3 },
            { severity: 'critical', days_to_stockout: 10 },
            { severity: 'critical', days_to_stockout: 1 },
            { severity: 'low', days_to_stockout: 0 }
        ];
        const sorted = sortReportRows(rows);
        expect(sorted[0].severity).toBe('critical');
        expect(sorted[0].days_to_stockout).toBe(1);
        expect(sorted[1].severity).toBe('critical');
        expect(sorted[1].days_to_stockout).toBe(10);
        expect(sorted[2].severity).toBe('medium');
        expect(sorted[3].severity).toBe('low');
    });
});
