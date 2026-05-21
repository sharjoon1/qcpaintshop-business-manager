const { computeFinalPrice, groupRowsForPdf } = require('../../services/price-list-pdf-generator');

describe('computeFinalPrice', () => {
    test('DPL 100, markup 10% → 130', () => {
        // 100 * 1.10 * 1.18 = 129.8 → ceil = 130
        expect(computeFinalPrice(100, 10)).toBe(130);
    });
    test('DPL 500, markup 10% → 649', () => {
        // 500 * 1.10 * 1.18 = 649.0 → ceil = 649
        expect(computeFinalPrice(500, 10)).toBe(649);
    });
    test('DPL 1200, markup 15% → 1629', () => {
        // 1200 * 1.15 * 1.18 = 1628.4 → ceil = 1629
        expect(computeFinalPrice(1200, 15)).toBe(1629);
    });
    test('DPL 250, markup 0% → 295', () => {
        // 250 * 1.00 * 1.18 = 295 → ceil = 295
        expect(computeFinalPrice(250, 0)).toBe(295);
    });
    test('handles string inputs', () => {
        expect(computeFinalPrice('500', '10')).toBe(649);
    });
    test('handles zero DPL', () => {
        expect(computeFinalPrice(0, 10)).toBe(0);
    });
    test('rounds UP (ceil not round) — DPL 101, markup 0% → 120', () => {
        // 101 * 1.00 * 1.18 = 119.18 → ceil = 120, round = 119
        expect(computeFinalPrice(101, 0)).toBe(120);
    });
});

describe('groupRowsForPdf', () => {
    const rows = [
        { product: 'One Pure Elegance', packSize: '4L', category: 'Interior', colourName: 'White', finalPrice: 2245 },
        { product: 'One Pure Elegance', packSize: '1L', category: 'Interior', colourName: 'White', finalPrice: 649 },
        { product: 'Exterior Plus', packSize: '10L', category: 'Exterior', colourName: 'Tintable', finalPrice: 1800 },
    ];

    test('returns brandLabel in result', () => {
        const result = groupRowsForPdf(rows, 'Birla Opus');
        expect(result.brandLabel).toBe('Birla Opus');
    });

    test('returns flat items array (no categories)', () => {
        const result = groupRowsForPdf(rows, 'Birla Opus');
        expect(Array.isArray(result.items)).toBe(true);
        expect(result.items).toHaveLength(3);
        expect(result).not.toHaveProperty('categories');
    });

    test('items sorted: category asc, then productName, then packSize', () => {
        const result = groupRowsForPdf(rows, 'Birla Opus');
        expect(result.items[0].category).toBe('Exterior');
        expect(result.items[1].category).toBe('Interior');
        expect(result.items[2].category).toBe('Interior');
        expect(result.items[1].packSize).toBe('1L');
        expect(result.items[2].packSize).toBe('4L');
    });

    test('item shape: productName, category, colourName, packSize, finalPrice', () => {
        const result = groupRowsForPdf(rows, 'Birla Opus');
        const item = result.items[1]; // Interior 1L
        expect(item).toMatchObject({
            productName: 'One Pure Elegance',
            category:    'Interior',
            colourName:  'White',
            packSize:    '1L',
            finalPrice:  649,
        });
    });

    test('rows without category default to "Other"', () => {
        const r = groupRowsForPdf([{ product: 'X', packSize: '1L', finalPrice: 100 }], 'Brand');
        expect(r.items[0].category).toBe('Other');
    });

    test('handles empty rows array', () => {
        const result = groupRowsForPdf([], 'Brand');
        expect(result.items).toHaveLength(0);
    });
});

describe('generatePriceListPdf', () => {
    test('returns a Buffer starting with PDF magic bytes', async () => {
        const { generatePriceListPdf } = require('../../services/price-list-pdf-generator');
        const groups = [{
            brandLabel: 'Test Brand',
            categories: [{
                label: 'Interior',
                items: [
                    { productName: 'Test Product', colourName: 'White', packSize: '1L', finalPrice: 649 },
                    { productName: 'Test Product', colourName: 'White', packSize: '4L', finalPrice: 2245 },
                ],
            }],
        }];
        const buffer = await generatePriceListPdf(groups, {
            customerName: 'Test Customer',
            markupPercent: 10,
            effectiveDate: '2026-05-21',
        });
        expect(Buffer.isBuffer(buffer)).toBe(true);
        expect(buffer.length).toBeGreaterThan(100);
        expect(buffer.slice(0, 4).toString('ascii')).toBe('%PDF');
    }, 10000);
});
