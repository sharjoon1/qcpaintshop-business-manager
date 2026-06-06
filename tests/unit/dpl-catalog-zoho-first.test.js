const { buildZohoFirstView } = require('../../services/dpl-catalog');

// Active Zoho items (as returned by the by-zoho query — see Task 2).
const zohoItems = [
    { zoho_item_id: 'Z1', zoho_item_name: 'BIRLA OPUS A 4L',  zoho_sku: 'WPRC4',  zoho_cf_dpl: '2050', zoho_rate: '2660', zoho_category_name: 'Interior' },
    { zoho_item_id: 'Z2', zoho_item_name: 'BIRLA OPUS A 1L',  zoho_sku: 'WPRC1',  zoho_cf_dpl: '620',  zoho_rate: '805',  zoho_category_name: 'Interior' },
    { zoho_item_id: 'Z3', zoho_item_name: 'BIRLA OPUS B 10L', zoho_sku: 'ADSS10', zoho_cf_dpl: '4100', zoho_rate: '5322', zoho_category_name: 'Exterior' },
    { zoho_item_id: 'Z4', zoho_item_name: 'BIRLA OPUS C 20L', zoho_sku: 'XYZ20',  zoho_cf_dpl: '8000', zoho_rate: '10380', zoho_category_name: 'Exterior' },
];

// dpl_catalog entries (as returned by getCatalog) — only some carry a zoho_item_id.
const catalogEntries = [
    // matched + changed: new DPL 2180 vs old 2050
    { id: 11, zoho_item_id: 'Z1', current_dpl: '2180', current_rate: '2830', product_name: 'A', base_name: 'White', dpl_size_label: '3.6L', canonical_sku: 'WPRC4' },
    // matched + unchanged: new DPL equals old 4100
    { id: 13, zoho_item_id: 'Z3', current_dpl: '4100', current_rate: '5322', product_name: 'B', base_name: 'Clear', dpl_size_label: '9L', canonical_sku: 'ADSS10' },
    // shared: two entries both link to Z4
    { id: 14, zoho_item_id: 'Z4', current_dpl: '8000', current_rate: '10380', product_name: 'C', base_name: 'White', dpl_size_label: '18L', canonical_sku: 'XYZ20' },
    { id: 15, zoho_item_id: 'Z4', current_dpl: '8100', current_rate: '10510', product_name: 'C', base_name: 'Pastel', dpl_size_label: '18L', canonical_sku: 'XYZ20B' },
    // unlinked (attach candidate): no zoho_item_id
    { id: 99, zoho_item_id: null, current_dpl: '700', current_rate: '910', product_name: 'A', base_name: 'White', dpl_size_label: '0.9L', canonical_sku: 'WPRC1' },
];

describe('buildZohoFirstView', () => {
    const { rows, unlinkedEntries } = buildZohoFirstView(zohoItems, catalogEntries);

    test('returns one row per Zoho item', () => {
        expect(rows).toHaveLength(4);
    });

    test('matched + changed row carries new dpl/rate, diff and changed=true', () => {
        const r = rows.find(x => x.zoho_item_id === 'Z1');
        expect(r.status).toBe('matched');
        expect(r.entry_id).toBe(11);
        expect(r.new_dpl).toBe(2180);
        expect(r.new_rate).toBe(2830);
        expect(r.diff).toBe(130);     // 2180 - 2050
        expect(r.changed).toBe(true);
    });

    test('matched + unchanged row has diff 0 and changed=false', () => {
        const r = rows.find(x => x.zoho_item_id === 'Z3');
        expect(r.status).toBe('matched');
        expect(r.diff).toBe(0);
        expect(r.changed).toBe(false);
    });

    test('unmatched Zoho item has status unmatched and null new values', () => {
        const r = rows.find(x => x.zoho_item_id === 'Z2');
        expect(r.status).toBe('unmatched');
        expect(r.entry_id).toBeNull();
        expect(r.new_dpl).toBeNull();
        expect(r.diff).toBeNull();
        expect(r.changed).toBe(false);
    });

    test('Zoho item linked by >1 entry is shared with shared_count and no entry_id', () => {
        const r = rows.find(x => x.zoho_item_id === 'Z4');
        expect(r.status).toBe('shared');
        expect(r.shared_count).toBe(2);
        expect(r.entry_id).toBeNull();
        expect(r.changed).toBe(false);
    });

    test('rows sorted: unmatched, then changed, then shared, then unchanged', () => {
        expect(rows.map(r => r.zoho_item_id)).toEqual(['Z2', 'Z1', 'Z4', 'Z3']);
    });

    test('same-rank rows tie-break by name with numeric collation', () => {
        // Two unmatched (same rank 0) items; numeric collation must order "1L" before "10L".
        const out = buildZohoFirstView([
            { zoho_item_id: 'B', zoho_item_name: 'BIRLA OPUS A 10L', zoho_sku: 'S10', zoho_cf_dpl: '100', zoho_rate: '130' },
            { zoho_item_id: 'A', zoho_item_name: 'BIRLA OPUS A 1L',  zoho_sku: 'S1',  zoho_cf_dpl: '50',  zoho_rate: '65' },
        ], []);
        expect(out.rows.map(r => r.zoho_item_id)).toEqual(['A', 'B']); // "1L" sorts before "10L" numerically
    });

    test('unlinkedEntries lists only entries without a zoho_item_id', () => {
        expect(unlinkedEntries).toHaveLength(1);
        expect(unlinkedEntries[0]).toMatchObject({
            entry_id: 99, product_name: 'A', base_name: 'White',
            dpl_size_label: '0.9L', current_dpl: 700, canonical_sku: 'WPRC1',
        });
    });

    test('null/non-numeric DPL yields diff null (never NaN)', () => {
        const { rows: r2 } = buildZohoFirstView(
            [{ zoho_item_id: 'Z9', zoho_item_name: 'X', zoho_sku: 'S', zoho_cf_dpl: null, zoho_rate: null }],
            [{ id: 1, zoho_item_id: 'Z9', current_dpl: '500', current_rate: '650' }]
        );
        expect(r2[0].diff).toBeNull();
        expect(Number.isNaN(r2[0].diff)).toBe(false);
    });

    test('handles empty inputs', () => {
        const out = buildZohoFirstView([], []);
        expect(out.rows).toEqual([]);
        expect(out.unlinkedEntries).toEqual([]);
    });
});
