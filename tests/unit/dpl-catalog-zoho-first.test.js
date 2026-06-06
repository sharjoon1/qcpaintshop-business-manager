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
    { id: 99, zoho_item_id: null, current_dpl: '700', current_rate: '910', product_name: 'A', base_name: 'White', size_tier: '1L', dpl_size_label: '0.9L', canonical_sku: 'WPRC1' },
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

    test('unmatched rows carry a proposal field; matched/shared carry null', () => {
        const { rows } = buildZohoFirstView(zohoItems, catalogEntries);
        const z1 = rows.find(r => r.zoho_item_id === 'Z1'); // matched
        const z2 = rows.find(r => r.zoho_item_id === 'Z2'); // unmatched
        const z4 = rows.find(r => r.zoho_item_id === 'Z4'); // shared
        expect(z1.proposal).toBeNull();
        expect(z4.proposal).toBeNull();
        // Z2 (WPRC1) exactly matches unlinked entry 99 (canonical_sku WPRC1) → non-null proposal.
        expect(z2.proposal).not.toBeNull();
        expect(z2.proposal.reason).toBe('exact-sku');
    });

    test('unlinkedEntries now include size_tier', () => {
        const { unlinkedEntries } = buildZohoFirstView(zohoItems, catalogEntries);
        expect(unlinkedEntries[0]).toHaveProperty('size_tier');
    });

    test('an unmatched Zoho item whose SKU exactly matches an unlinked entry gets that proposal', () => {
        const zItems = [{ zoho_item_id: 'ZX', zoho_item_name: 'BIRLA OPUS X 1L', zoho_sku: 'WPRC1', zoho_cf_dpl: '600', zoho_rate: '780' }];
        const entries = [{ id: 99, zoho_item_id: null, current_dpl: '700', current_rate: '910', product_name: 'X', base_name: 'White', size_tier: '1L', dpl_size_label: '0.9L', canonical_sku: 'WPRC1' }];
        const { rows } = buildZohoFirstView(zItems, entries);
        expect(rows[0].status).toBe('unmatched');
        expect(rows[0].proposal).not.toBeNull();
        expect(rows[0].proposal.entry_id).toBe(99);
        expect(rows[0].proposal.reason).toBe('exact-sku');
    });
});

const { proposeDplForZoho } = require('../../services/dpl-catalog');

describe('proposeDplForZoho', () => {
    // Unlinked DPL catalog entries (subset of getCatalog with zoho_item_id == null),
    // already carrying size_tier (added in Task 2).
    const unlinked = [
        // entry 1 has NO canonical SKU on purpose, so the S1 test exercises
        // reconstruction (not exact-SKU). Its base 'White' + tier '4L' is what matches.
        { entry_id: 1, product_name: 'Weather Shield', base_name: 'White', size_tier: '4L',  dpl_size_label: '3.6L', current_dpl: 2180, canonical_sku: '' },
        { entry_id: 2, product_name: 'Weather Shield', base_name: 'Clear', size_tier: '10L', dpl_size_label: '9L',   current_dpl: 4100, canonical_sku: 'PBS9910' },
        { entry_id: 3, product_name: 'Pure Elegance',  base_name: 'White', size_tier: '1L',  dpl_size_label: '0.9L', current_dpl: 700,  canonical_sku: 'PE WT 01' },
    ];

    test('S0 exact canonical SKU → high / exact-sku', () => {
        const p = proposeDplForZoho(
            { zoho_item_id: 'Z', zoho_item_name: 'BIRLA OPUS WEATHER SHIELD 10 L', zoho_sku: 'PBS9910' },
            unlinked
        );
        expect(p).not.toBeNull();
        expect(p.entry_id).toBe(2);
        expect(p.confidence).toBe('high');
        expect(p.reason).toBe('exact-sku');
        expect(p.current_dpl).toBe(4100);
        expect(p.dpl_size_label).toBe('9L');
    });

    test('S1 SKU reconstruct (base_name + tier) → high / sku-reconstruct', () => {
        // Zoho SKU 'PBSWT04' → stem 'pbswt', tier '4L'; entry 1 base 'White'→'wt' ends the stem.
        const p = proposeDplForZoho(
            { zoho_item_id: 'Z', zoho_item_name: 'BIRLA OPUS WEATHER SHIELD 4 L', zoho_sku: 'PBSWT04' },
            unlinked
        );
        expect(p).not.toBeNull();
        expect(p.entry_id).toBe(1);
        expect(p.confidence).toBe('high');
        expect(p.reason).toBe('sku-reconstruct');
    });

    test('S1 ambiguous (two entries reconstruct to same stem+tier) → null', () => {
        const dup = [
            { entry_id: 10, product_name: 'A', base_name: 'White', size_tier: '4L', dpl_size_label: '3.6L', current_dpl: 100, canonical_sku: 'X1' },
            { entry_id: 11, product_name: 'B', base_name: 'White', size_tier: '4L', dpl_size_label: '3.6L', current_dpl: 200, canonical_sku: 'X2' },
        ];
        const p = proposeDplForZoho(
            { zoho_item_id: 'Z', zoho_item_name: 'BIRLA OPUS 4 L', zoho_sku: 'PBSWT04' },
            dup
        );
        expect(p).toBeNull();
    });

    test('S2 name + tier (SKU not a clean Birla stem) → low / product+tier-only', () => {
        // SKU 'RANDOM' yields no stem; name tokens "weather shield" + tier 10L match entry 2.
        const p = proposeDplForZoho(
            { zoho_item_id: 'Z', zoho_item_name: 'WEATHER SHIELD 10 L', zoho_sku: 'RANDOM' },
            unlinked
        );
        expect(p).not.toBeNull();
        expect(p.entry_id).toBe(2);
        expect(p.confidence).toBe('low');
        expect(p.reason).toBe('product+tier-only');
    });

    test('S2 ambiguous (two entries match name+tier) → null', () => {
        const dup = [
            { entry_id: 20, product_name: 'Weather Shield', base_name: 'White', size_tier: '10L', dpl_size_label: '9L', current_dpl: 100, canonical_sku: 'A' },
            { entry_id: 21, product_name: 'Weather Shield', base_name: 'Clear', size_tier: '10L', dpl_size_label: '9L', current_dpl: 200, canonical_sku: 'B' },
        ];
        const p = proposeDplForZoho(
            { zoho_item_id: 'Z', zoho_item_name: 'WEATHER SHIELD 10 L', zoho_sku: 'RANDOM' },
            dup
        );
        expect(p).toBeNull();
    });

    test('no candidate → null', () => {
        const p = proposeDplForZoho(
            { zoho_item_id: 'Z', zoho_item_name: 'SOMETHING ELSE 20 L', zoho_sku: 'NOPE' },
            unlinked
        );
        expect(p).toBeNull();
    });

    test('blank SKU falls through to S2 by name+tier', () => {
        const p = proposeDplForZoho(
            { zoho_item_id: 'Z', zoho_item_name: 'PURE ELEGANCE 1 L', zoho_sku: '' },
            unlinked
        );
        expect(p).not.toBeNull();
        expect(p.entry_id).toBe(3);
        expect(p.reason).toBe('product+tier-only');
    });

    test('handles empty / missing inputs', () => {
        expect(proposeDplForZoho({}, [])).toBeNull();
        expect(proposeDplForZoho(null, null)).toBeNull();
    });
});

const { computeZohoRate } = require('../../services/dpl-catalog');

describe('computeZohoRate', () => {
    test('DPL 100 → 130 (ceil(100*1.18*1.10))', () => {
        expect(computeZohoRate(100)).toBe(130); // 129.8 → 130
    });
    test('DPL 500 → 649', () => {
        expect(computeZohoRate(500)).toBe(649); // 649.0 → 649
    });
    test('accepts numeric strings', () => {
        expect(computeZohoRate('500')).toBe(649);
    });
    test('DPL 0 → 0', () => {
        expect(computeZohoRate(0)).toBe(0);
    });
    test('null / non-numeric → 0', () => {
        expect(computeZohoRate(null)).toBe(0);
        expect(computeZohoRate('abc')).toBe(0);
        expect(computeZohoRate(undefined)).toBe(0);
    });
    test('negative → 0', () => {
        expect(computeZohoRate(-50)).toBe(0);
    });
});
