const catalog = require('../../services/dpl-catalog');

describe('slug', () => {
    test('lowercases and strips non-alphanumerics', () => {
        expect(catalog.slug('One Pure Elegance')).toBe('onepureelegance');
        expect(catalog.slug('Base 2')).toBe('base2');
        expect(catalog.slug(null)).toBe('');
    });
});

describe('normalizeSizeTier', () => {
    const cases = [
        ['200ml', '200ml'], ['200 ML', '200ml'],
        ['900ml', '1L'], ['0.9L', '1L'], ['1L', '1L'],
        ['3.6L', '4L'], ['4L', '4L'],
        ['9L', '10L'], ['10L', '10L'],
        ['18L', '20L'], ['20L', '20L'],
        ['25kg', '25kg'],
    ];
    test.each(cases)('normalizeSizeTier(%s) === %s', (input, expected) => {
        expect(catalog.normalizeSizeTier(input)).toBe(expected);
    });
    test('bare number without a unit is returned verbatim (not promoted to litres)', () => {
        expect(catalog.normalizeSizeTier('20')).toBe('20');
    });
});

describe('extractSizeFromZohoName', () => {
    test('takes the last size-with-unit, ignoring leading category codes', () => {
        expect(catalog.extractSizeFromZohoName('EP01 PEWH One Pure Elegance White 1 L', 'PEWH01')).toBe('1L');
        expect(catalog.extractSizeFromZohoName('PE BASE2 ONE PURE ELEGANCE BASE 2 BIRLA OPUS 4L', 'PEBASE2-4L')).toBe('4L');
        expect(catalog.extractSizeFromZohoName('... 200ml', 'X-200ML')).toBe('200ml');
    });
    test('returns empty string when no size present', () => {
        expect(catalog.extractSizeFromZohoName('Some Colorant Tint', 'CLT')).toBe('');
    });
    test('does NOT match a size embedded in a code with no separator', () => {
        expect(catalog.extractSizeFromZohoName('BIRLA OPUS BASE4L WHITE', '')).toBe('');
    });
});

describe('buildMatchKey', () => {
    test('uses product_code when present', () => {
        const k = catalog.buildMatchKey({ brand: 'birlaopus', product_code: '941001', product_name: 'One Pure Elegance', base_name: 'White', size_tier: '1L' });
        expect(k).toBe('birlaopus|941001|white|1l');
    });
    test('same product+base at 900ml and 1L collapse to the SAME key', () => {
        const a = catalog.buildMatchKey({ brand: 'birlaopus', product_code: '941001', base_name: 'Base 2', size_tier: catalog.normalizeSizeTier('900ml') });
        const b = catalog.buildMatchKey({ brand: 'birlaopus', product_code: '941001', base_name: 'Base 2', size_tier: catalog.normalizeSizeTier('1L') });
        expect(a).toBe(b);
        expect(a).toBe('birlaopus|941001|base2|1l');
    });
    test('falls back to product_name slug when no product_code', () => {
        const k = catalog.buildMatchKey({ brand: 'birlaopus', product_code: '', product_name: 'Royale Aspira', base_name: 'White', size_tier: '4L' });
        expect(k).toBe('birlaopus|royaleaspira|white|4l');
    });
});

describe('linkEntryToZoho', () => {
    const zoho = [
        { zoho_item_id: 'Z1', name: 'EP01 PEWH One Pure Elegance White 1 L', sku: 'PEWH01' },
        { zoho_item_id: 'Z2', name: 'EP01 PEB2 One Pure Elegance Base 2 1 L', sku: 'PEB201' },
        { zoho_item_id: 'Z3', name: 'EP04 PEWH One Pure Elegance White 4 L', sku: 'PEWH04' },
    ];
    test('S1 exact canonical SKU wins', () => {
        const r = catalog.linkEntryToZoho({ product_name: 'One Pure Elegance', base_name: 'White', size_tier: '1L', canonical_sku: 'PEWH01' }, zoho);
        expect(r.zoho_item_id).toBe('Z1');
        expect(r.link_reason).toBe('exact-sku');
        expect(r.link_confidence).toBe(100);
    });
    test('S2 product+base+size-tier links a DPL 900ml base to the Zoho 1L item', () => {
        const entry = { product_name: 'One Pure Elegance', base_name: 'Base 2', size_tier: catalog.normalizeSizeTier('900ml') };
        const r = catalog.linkEntryToZoho(entry, zoho);
        expect(r.zoho_item_id).toBe('Z2');
        expect(r.link_reason).toBe('product+base+tier');
        expect(r.link_status).toBe('confirmed');
    });
    test('White 1L links to Z1, not the 4L Z3', () => {
        const r = catalog.linkEntryToZoho({ product_name: 'One Pure Elegance', base_name: 'White', size_tier: '1L' }, zoho);
        expect(r.zoho_item_id).toBe('Z1');
    });
    test('no product match → needs_creating', () => {
        const r = catalog.linkEntryToZoho({ product_name: 'Nonexistent Product', base_name: 'White', size_tier: '20L' }, zoho);
        expect(r.zoho_item_id).toBe(null);
        expect(r.link_status).toBe('needs_creating');
    });

    test('Base 2 confirms to the Base 2 item, NOT Base 20 (token boundary)', () => {
        const z = [
            { zoho_item_id: 'ZB2', name: 'EP01 PEB2 One Pure Elegance Base 2 1 L', sku: 'PEB201' },
            { zoho_item_id: 'ZB20', name: 'EP01 PEB20 One Pure Elegance Base 20 1 L', sku: 'PEB2001' },
        ];
        const r = catalog.linkEntryToZoho({ product_name: 'One Pure Elegance', base_name: 'Base 2', size_tier: '1L' }, z);
        expect(r.zoho_item_id).toBe('ZB2');
        expect(r.link_status).toBe('confirmed');
    });

    test('Base 2 against ONLY a Base 20 item does NOT wrongly confirm (falls to review)', () => {
        const z = [{ zoho_item_id: 'ZB20', name: 'EP01 PEB20 One Pure Elegance Base 20 1 L', sku: 'PEB2001' }];
        const r = catalog.linkEntryToZoho({ product_name: 'One Pure Elegance', base_name: 'Base 2', size_tier: '1L' }, z);
        expect(r.link_status).not.toBe('confirmed');
    });
});

describe('buildCatalogFromDpl', () => {
    const zoho = [
        { zoho_item_id: 'Z1', name: 'EP01 PEWH One Pure Elegance White 1 L', sku: 'PEWH01', description: '', category: 'Interior Luxury' },
        { zoho_item_id: 'Z2', name: 'EP01 PEB2 One Pure Elegance Base 2 1 L', sku: 'PEB201', description: '', category: 'Interior Luxury' },
    ];
    const rows = [
        { product: 'One Pure Elegance - White', packSize: '1L', dpl: 490, category: 'Interior Luxury', brand: 'Birla Opus', baseCode: '941001' },
        { product: 'One Pure Elegance - Base 2', packSize: '900ml', dpl: 520, category: 'Interior Luxury', brand: 'Birla Opus', baseCode: '941001' },
    ];

    test('one entry per row with tier, match_key, current price, link', () => {
        const entries = catalog.buildCatalogFromDpl('birlaopus', rows, zoho);
        expect(entries).toHaveLength(2);
        const white = entries.find(e => e.base_name === 'White');
        expect(white.size_tier).toBe('1L');
        expect(white.dpl_size_label).toBe('1L');
        expect(white.current_dpl).toBe(490);
        expect(white.current_rate).toBe(Math.ceil(490 * 1.18 * 1.10));
        expect(white.match_key).toBe('birlaopus|941001|white|1l');
        expect(white.zoho_item_id).toBe('Z1');
        expect(white.link_status).toBe('confirmed');
    });

    test('a DPL 900ml base normalizes to tier 1L and links to the Zoho 1L item', () => {
        const entries = catalog.buildCatalogFromDpl('birlaopus', rows, zoho);
        const base2 = entries.find(e => e.base_name === 'Base 2');
        expect(base2.size_tier).toBe('1L');
        expect(base2.dpl_size_label).toBe('900ml');
        expect(base2.zoho_item_id).toBe('Z2');
        expect(base2.link_status).toBe('confirmed');
    });
});

describe('migrate-dpl-catalog', () => {
    test('exports up() and creates the table idempotently', async () => {
        const mig = require('../../migrations/migrate-dpl-catalog');
        expect(typeof mig.up).toBe('function');

        const queries = [];
        const pool = {
            query: async (sql) => {
                queries.push(sql);
                if (/SHOW TABLES LIKE/.test(sql)) return [[]]; // table absent
                return [{}];
            }
        };
        await mig.up(pool);
        expect(queries.some(q => /CREATE TABLE dpl_catalog/.test(q))).toBe(true);
        expect(queries.some(q => /match_key/.test(q) && /UNIQUE/.test(q))).toBe(true);
    });

    test('up() skips creation when the table already exists', async () => {
        const mig = require('../../migrations/migrate-dpl-catalog');
        const queries = [];
        const pool = {
            query: async (sql) => {
                queries.push(sql);
                if (/SHOW TABLES LIKE/.test(sql)) return [[{ t: 'dpl_catalog' }]]; // present
                return [{}];
            }
        };
        await mig.up(pool);
        expect(queries.some(q => /CREATE TABLE/.test(q))).toBe(false);
    });
});
