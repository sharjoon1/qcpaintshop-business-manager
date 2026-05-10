const { parseBirlaOpusTabular, normalizePackSize } = require('../../services/price-list-parser');

describe('parseBirlaOpusTabular — exports', () => {
    test('parser is exported as a function', () => {
        expect(typeof parseBirlaOpusTabular).toBe('function');
    });
    test('normalizePackSize is exported', () => {
        expect(typeof normalizePackSize).toBe('function');
    });
});

describe('parseBirlaOpusTabular — happy path', () => {
    test('parses a single 6-column tab-separated row', () => {
        const text = '1\tInterior Luxury\tOne Pure Elegance (941001)\tWhite\t1L\t490';
        const out = parseBirlaOpusTabular(text);
        expect(out).toHaveLength(1);
        expect(out[0]).toEqual({
            product: 'One Pure Elegance - White',
            packSize: '1L',
            dpl: 490,
            category: 'Interior Luxury',
            brand: 'Birla Opus',
            baseCode: '941001',
        });
    });

    test('parses 2+ space-separated row when no tabs present', () => {
        const text = '1    Interior Luxury    One Pure Elegance (941001)    White    1L    490';
        const out = parseBirlaOpusTabular(text);
        expect(out).toHaveLength(1);
        expect(out[0].product).toBe('One Pure Elegance - White');
        expect(out[0].dpl).toBe(490);
    });

    test('parses multiple rows', () => {
        const text = [
            '1\tInterior Luxury\tOne Pure Elegance (941001)\tWhite\t1L\t490',
            '2\tInterior Luxury\tOne Pure Elegance (941001)\tWhite\t4L\t1,930',
            '3\tInterior Luxury\tOne Pure Elegance (941001)\tPastel\t1L\t484',
        ].join('\n');
        const out = parseBirlaOpusTabular(text);
        expect(out).toHaveLength(3);
        expect(out[0].packSize).toBe('1L');
        expect(out[1].packSize).toBe('4L');
        expect(out[1].dpl).toBe(1930);
        expect(out[2].product).toBe('One Pure Elegance - Pastel');
    });
});

describe('parseBirlaOpusTabular — shade inheritance', () => {
    test('5-column row inherits shade from previous row of same product', () => {
        const text = [
            '105\tInterior Premium\tCalista Ever Stay (942001)\tWhite\t4L\t864',
            '106\tInterior Premium\tCalista Ever Stay (942001)\t10L\t2,092',
            '107\tInterior Premium\tCalista Ever Stay (942001)\tWhite\t20L\t4,061',
        ].join('\n');
        const out = parseBirlaOpusTabular(text);
        expect(out).toHaveLength(3);
        expect(out[0].product).toBe('Calista Ever Stay - White');
        expect(out[1].product).toBe('Calista Ever Stay - White'); // inherited
        expect(out[1].packSize).toBe('10L');
        expect(out[1].dpl).toBe(2092);
        expect(out[2].product).toBe('Calista Ever Stay - White');
    });

    test('5-column row with no prior shade falls back to product without dash', () => {
        const text = '50\tInterior Premium\tCalista Ever Stay (942001)\t10L\t2,092';
        const out = parseBirlaOpusTabular(text);
        expect(out).toHaveLength(1);
        expect(out[0].product).toBe('Calista Ever Stay');
        expect(out[0].dpl).toBe(2092);
    });

    test('5-column row does NOT inherit shade from a different product', () => {
        const text = [
            '1\tInterior Luxury\tOne Pure Elegance (941001)\tWhite\t1L\t490',
            '2\tInterior Luxury\tCalista Ever Stay (942001)\t10L\t2,092',
        ].join('\n');
        const out = parseBirlaOpusTabular(text);
        expect(out).toHaveLength(2);
        expect(out[0].product).toBe('One Pure Elegance - White');
        expect(out[1].product).toBe('Calista Ever Stay'); // no shade inherited
    });

    test('5-column row only inherits from immediately-previous row of same product', () => {
        const text = [
            '1\tInterior Luxury\tOne Pure Elegance (941001)\tWhite\t1L\t490',
            '2\tInterior Luxury\tCalista Ever Stay (942001)\tPastel\t1L\t223',
            '3\tInterior Luxury\tOne Pure Elegance (941001)\t10L\t4,783',
        ].join('\n');
        const out = parseBirlaOpusTabular(text);
        // Row 3 has previous row product = "Calista Ever Stay", not "One Pure Elegance",
        // so it must NOT inherit "White" (or anything else).
        expect(out).toHaveLength(3);
        expect(out[2].product).toBe('One Pure Elegance');
    });
});

describe('parseBirlaOpusTabular — price parsing', () => {
    test('strips comma thousands separator', () => {
        const text = '1\tInterior Luxury\tOne Pure Elegance (941001)\tWhite\t4L\t1,930';
        const out = parseBirlaOpusTabular(text);
        expect(out[0].dpl).toBe(1930);
    });

    test('rejects rows with zero or negative price', () => {
        const text = '1\tInterior Luxury\tOne Pure Elegance (941001)\tWhite\t1L\t0';
        const out = parseBirlaOpusTabular(text);
        expect(out).toHaveLength(0);
    });

    test('rejects rows with non-numeric price', () => {
        const text = '1\tInterior Luxury\tOne Pure Elegance (941001)\tWhite\t1L\tTBD';
        const out = parseBirlaOpusTabular(text);
        expect(out).toHaveLength(0);
    });

    test('rejects malformed prices with multiple decimal points', () => {
        const text = '1\tInterior Luxury\tOne Pure Elegance (941001)\tWhite\t1L\t490.00.00';
        expect(parseBirlaOpusTabular(text)).toHaveLength(0);
    });

    test('rejects prices with trailing non-numeric characters', () => {
        const text = '1\tInterior Luxury\tOne Pure Elegance (941001)\tWhite\t1L\t490abc';
        expect(parseBirlaOpusTabular(text)).toHaveLength(0);
    });

    test('rejects negative prices explicitly', () => {
        const text = '1\tInterior Luxury\tOne Pure Elegance (941001)\tWhite\t1L\t-50';
        expect(parseBirlaOpusTabular(text)).toHaveLength(0);
    });

    test('accepts decimal prices like 123.50', () => {
        const text = '1\tInterior Luxury\tOne Pure Elegance (941001)\tWhite\t1L\t123.50';
        const out = parseBirlaOpusTabular(text);
        expect(out).toHaveLength(1);
        expect(out[0].dpl).toBeCloseTo(123.50);
    });
});

describe('parseBirlaOpusTabular — header and trailer skipping', () => {
    test('skips the column-header row', () => {
        const text = [
            'S.No\tProduct Category\tProduct Name\tBase/Color Shade\tPack Size\tPrice (Excl. GST)',
            '1\tInterior Luxury\tOne Pure Elegance (941001)\tWhite\t1L\t490',
        ].join('\n');
        const out = parseBirlaOpusTabular(text);
        expect(out).toHaveLength(1);
        expect(out[0].dpl).toBe(490);
    });

    test('terminates at "Terms and Conditions" line', () => {
        const text = [
            '1\tInterior Luxury\tOne Pure Elegance (941001)\tWhite\t1L\t490',
            '',
            'Terms and Conditions- Dealer Price List for Retail Dealers',
            '1. This Dealer Price List is proprietary...',
            '2\tInterior Luxury\tOne Pure Elegance (941001)\tWhite\t4L\t1,930',
        ].join('\n');
        const out = parseBirlaOpusTabular(text);
        expect(out).toHaveLength(1);
        expect(out[0].dpl).toBe(490);
    });
});

describe('parseBirlaOpusTabular — edge cases', () => {
    test('returns empty array for empty input', () => {
        expect(parseBirlaOpusTabular('')).toEqual([]);
        expect(parseBirlaOpusTabular(null)).toEqual([]);
        expect(parseBirlaOpusTabular(undefined)).toEqual([]);
        expect(parseBirlaOpusTabular('   \n\n  \n')).toEqual([]);
    });

    test('tolerates trailing whitespace on rows', () => {
        const text = '1\tInterior Luxury\tOne Pure Elegance (941001)\tWhite\t1L\t490   \t  ';
        const out = parseBirlaOpusTabular(text);
        expect(out).toHaveLength(1);
        expect(out[0].dpl).toBe(490);
    });

    test('"No Base/Others" shade produces product without dash-shade suffix', () => {
        const text = '369\tExterior Luxury\tOne Explore 15 Texture (930001)\tNo Base/Others\t25KG\t976';
        const out = parseBirlaOpusTabular(text);
        expect(out).toHaveLength(1);
        expect(out[0].product).toBe('One Explore 15 Texture');
        expect(out[0].packSize).toBe('25kg');
    });

    test('parses product without (NNNNNN) SKU code (baseCode empty)', () => {
        const text = '87\tInterior Luxury\tOne Pure Legend\tPastel\t200ml\t126';
        const out = parseBirlaOpusTabular(text);
        expect(out).toHaveLength(1);
        expect(out[0].product).toBe('One Pure Legend - Pastel');
        expect(out[0].baseCode).toBe('');
    });
});

describe('normalizePackSize', () => {
    test('1L stays 1L', () => {
        expect(normalizePackSize('1L')).toBe('1L');
    });
    test('25KG → 25kg', () => {
        expect(normalizePackSize('25KG')).toBe('25kg');
    });
    test('200ml stays 200ml', () => {
        expect(normalizePackSize('200ml')).toBe('200ml');
    });
    test('200ML → 200ml', () => {
        expect(normalizePackSize('200ML')).toBe('200ml');
    });
    test('0.9L stays 0.9L', () => {
        expect(normalizePackSize('0.9L')).toBe('0.9L');
    });
    test('0.5kg stays 0.5kg', () => {
        expect(normalizePackSize('0.5kg')).toBe('0.5kg');
    });
    test('whitespace tolerated', () => {
        expect(normalizePackSize(' 4L ')).toBe('4L');
    });
    test('non-numeric pack passes through unchanged', () => {
        expect(normalizePackSize('Per Unit')).toBe('Per Unit');
        expect(normalizePackSize('Sheet')).toBe('Sheet');
        expect(normalizePackSize('9"x11"')).toBe('9"x11"');
    });
    test('empty/null returns empty string', () => {
        expect(normalizePackSize('')).toBe('');
        expect(normalizePackSize(null)).toBe('');
        expect(normalizePackSize(undefined)).toBe('');
    });
});
