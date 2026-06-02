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
