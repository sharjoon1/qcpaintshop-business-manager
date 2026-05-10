const { computeZohoUncovered } = require('../../services/dpl-coverage');

describe('computeZohoUncovered', () => {
    test('exported as a function', () => {
        expect(typeof computeZohoUncovered).toBe('function');
    });

    test('returns empty array for empty inputs', () => {
        expect(computeZohoUncovered([], [])).toEqual([]);
        expect(computeZohoUncovered(null, null)).toEqual([]);
        expect(computeZohoUncovered(undefined, undefined)).toEqual([]);
    });

    test('returns full zohoItems list when no items are matched', () => {
        const zohoItems = [
            { zoho_item_id: 'A', name: 'Item A' },
            { zoho_item_id: 'B', name: 'Item B' },
        ];
        const items = [
            { product: 'P1', dpl: 100 }, // no auto_match
            { product: 'P2', dpl: 200 }, // no auto_match
        ];
        expect(computeZohoUncovered(items, zohoItems)).toEqual(zohoItems);
    });

    test('returns empty array when every zoho item is matched', () => {
        const zohoItems = [
            { zoho_item_id: 'A', name: 'Item A' },
            { zoho_item_id: 'B', name: 'Item B' },
        ];
        const items = [
            { product: 'P1', dpl: 100, auto_match: { zoho_item_id: 'A' } },
            { product: 'P2', dpl: 200, auto_match: { zoho_item_id: 'B' } },
        ];
        expect(computeZohoUncovered(items, zohoItems)).toEqual([]);
    });

    test('returns only the unmatched subset', () => {
        const zohoItems = [
            { zoho_item_id: 'A', name: 'Item A' },
            { zoho_item_id: 'B', name: 'Item B' },
            { zoho_item_id: 'C', name: 'Item C' },
        ];
        const items = [
            { product: 'P1', dpl: 100, auto_match: { zoho_item_id: 'A' } },
            { product: 'P3', dpl: 300, auto_match: { zoho_item_id: 'C' } },
        ];
        const out = computeZohoUncovered(items, zohoItems);
        expect(out).toHaveLength(1);
        expect(out[0].zoho_item_id).toBe('B');
    });

    test('auto_match without zoho_item_id does not count as a match', () => {
        const zohoItems = [
            { zoho_item_id: 'A', name: 'Item A' },
        ];
        const items = [
            { product: 'P1', dpl: 100, auto_match: { warning: 'no id', zoho_item_id: null } },
        ];
        expect(computeZohoUncovered(items, zohoItems)).toEqual(zohoItems);
    });

    test('multiple items pointing to the same zoho_item_id still count as one match', () => {
        const zohoItems = [
            { zoho_item_id: 'A', name: 'Item A' },
            { zoho_item_id: 'B', name: 'Item B' },
        ];
        const items = [
            { product: 'P1a', dpl: 100, auto_match: { zoho_item_id: 'A' } },
            { product: 'P1b', dpl: 110, auto_match: { zoho_item_id: 'A' } },
            { product: 'P1c', dpl: 120, auto_match: { zoho_item_id: 'A' } },
        ];
        const out = computeZohoUncovered(items, zohoItems);
        expect(out).toHaveLength(1);
        expect(out[0].zoho_item_id).toBe('B');
    });
});
