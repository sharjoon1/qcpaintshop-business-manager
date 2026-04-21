const { extractColor } = require('../../services/color-extractor');

describe('color-extractor', () => {
    test('extracts White from item name', () => {
        expect(extractColor('Ace Exterior White 1L')).toEqual({ colorName: 'White', colorCode: '#FFFFFF' });
    });

    test('extracts Grey case-insensitively', () => {
        expect(extractColor('Bison Guard Grey 4Ltr')).toEqual({ colorName: 'Grey', colorCode: '#9CA3AF' });
    });

    test('returns null when no known color found', () => {
        expect(extractColor('Premium Emulsion 10L')).toBeNull();
    });

    test('matches multi-word color before single word — Off White not White', () => {
        expect(extractColor('Royale Off White 4L')).toEqual({ colorName: 'Off White', colorCode: '#FAF9F6' });
    });

    test('returns null for null input', () => {
        expect(extractColor(null)).toBeNull();
    });

    test('returns null for empty string', () => {
        expect(extractColor('')).toBeNull();
    });

    test('extracts color when SKU prefix present', () => {
        expect(extractColor('AP001 Ace Exterior Ivory 1L')).toEqual({ colorName: 'Ivory', colorCode: '#F5F0E8' });
    });

    test('extracts Sky Blue (multi-word)', () => {
        expect(extractColor('Tractor Emulsion Sky Blue 1L')).toEqual({ colorName: 'Sky Blue', colorCode: '#7DD3FC' });
    });

    test('extracts Terracotta', () => {
        expect(extractColor('Exterior Terracotta 4L')).toEqual({ colorName: 'Terracotta', colorCode: '#C1440E' });
    });

    test('gray is alias for grey same hex', () => {
        const result = extractColor('Waterbase Gray 2L');
        expect(result).not.toBeNull();
        expect(result.colorCode).toBe('#9CA3AF');
    });
});
