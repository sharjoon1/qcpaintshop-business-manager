const {
    parseBirlaOpusCsvLong,
    parseBirlaOpusCsvAuto,
    parseBirlaOpusCsv,
} = require('../../services/price-list-parser');

const LONG = [
    'Category,SubCategory,Product,ProductCode,BaseCode,BaseName,ProdBaseCode,Unit,Price_excl_GST',
    'Interior,Luxury,One Pure Elegance,941001,9900,White,PE White,1L,520',
    'Interior,Luxury,One Pure Elegance,941001,9900,White,PE White,200 ML,110',
    'Interior,Luxury,One Pure Elegance,941001,9901,Pastel,PE 1,1L,514',
    'Interior,Luxury,One Pure Elegance,941001,9901,Pastel,PE 1,1L,514',
].join('\n');

const WIDE = [
    'Category,Segment,Product Name,Product Code,Base Code (SKU),Base / Colour Name,1L,4L',
    'Interior,Luxury,One Pure Elegance,941001,PE White,9900 - White,520,2050',
].join('\n');

describe('parseBirlaOpusCsvLong', () => {
    const rows = parseBirlaOpusCsvLong(Buffer.from(LONG), '2026-06-03');

    test('emits one row per data line with mapped fields', () => {
        expect(rows.length).toBe(4);
        const r = rows[0];
        expect(r.productCode).toBe('941001');
        expect(r.baseCode).toBe('PE White');
        expect(r.colourCode).toBe('9900');
        expect(r.colourName).toBe('White');
        expect(r.productName).toBe('One Pure Elegance');
        expect(r.product).toBe('One Pure Elegance - White');
        expect(r.packSize).toBe('1L');
        expect(r.dpl).toBe(520);
        expect(r.brand).toBe('Birla Opus');
        expect(r.category).toBe('Interior');
        expect(r.segment).toBe('Luxury');
    });

    test('normalizes "200 ML" to canonical "200ML"', () => {
        const ml = rows.find(r => r.dpl === 110);
        expect(ml.packSize).toBe('200ML');
    });

    test('keeps duplicate (product,base,size) rows (dedup handled downstream)', () => {
        expect(rows.filter(r => r.baseCode === 'PE 1').length).toBe(2);
    });

    test('builds proposed name/sku/description', () => {
        const r = rows[0];
        expect(typeof r._proposedName).toBe('string');
        expect(r._proposedZohoSku.length).toBeGreaterThan(0);
        expect(typeof r._proposedDescription).toBe('string');
    });

    test('returns [] when a required header is missing', () => {
        const bad = 'Category,SubCategory,Product,ProductCode\nInterior,Luxury,X,1\n';
        expect(parseBirlaOpusCsvLong(Buffer.from(bad), '2026-06-03')).toEqual([]);
    });
});

describe('parseBirlaOpusCsvAuto', () => {
    test('routes a long-format header to the long parser', () => {
        const rows = parseBirlaOpusCsvAuto(Buffer.from(LONG), '2026-06-03');
        expect(rows.length).toBe(4);
        expect(rows[0].baseCode).toBe('PE White');
    });

    test('routes a wide-format header to the wide parser', () => {
        const rows = parseBirlaOpusCsvAuto(Buffer.from(WIDE), '2026-06-03');
        expect(rows.length).toBe(2);
        expect(rows[0].baseCode).toBe('PE White');
    });

    test('empty buffer returns []', () => {
        expect(parseBirlaOpusCsvAuto(Buffer.from(''), '2026-06-03')).toEqual([]);
    });
});
