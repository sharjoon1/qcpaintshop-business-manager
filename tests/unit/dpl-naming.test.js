const {
    isEmulsionCategory,
    isEnamelCategory,
    extractEmulsionProductName,
    extractEnamelProductAndColor,
    stripDuplicateSkuPrefix,
    buildBirlaName,
    computeProposedFields,
} = require('../../services/price-list-parser');

describe('Birla Opus DPL naming — scaffold', () => {
    test('all helpers are exported', () => {
        expect(typeof isEmulsionCategory).toBe('function');
        expect(typeof isEnamelCategory).toBe('function');
        expect(typeof extractEmulsionProductName).toBe('function');
        expect(typeof extractEnamelProductAndColor).toBe('function');
        expect(typeof stripDuplicateSkuPrefix).toBe('function');
        expect(typeof buildBirlaName).toBe('function');
    });
});

describe('isEmulsionCategory', () => {
    test('matches Interior Emulsion', () => {
        expect(isEmulsionCategory('INTERIOR EMULSION')).toBe(true);
    });
    test('matches Exterior Emulsion (case-insensitive)', () => {
        expect(isEmulsionCategory('Exterior Emulsion')).toBe(true);
    });
    test('rejects Enamel', () => {
        expect(isEmulsionCategory('ENAMEL')).toBe(false);
    });
    test('rejects null and empty', () => {
        expect(isEmulsionCategory(null)).toBe(false);
        expect(isEmulsionCategory('')).toBe(false);
    });
});

describe('isEnamelCategory', () => {
    test('matches ENAMEL', () => {
        expect(isEnamelCategory('ENAMEL')).toBe(true);
    });
    test('rejects Interior Emulsion', () => {
        expect(isEnamelCategory('INTERIOR EMULSION')).toBe(false);
    });
    test('rejects null', () => {
        expect(isEnamelCategory(null)).toBe(false);
    });
});

describe('extractEmulsionProductName', () => {
    test('strips variant suffix and uppercases', () => {
        expect(extractEmulsionProductName('Ever Stay - White')).toBe('EVER STAY');
    });
    test('handles Pastel variant', () => {
        expect(extractEmulsionProductName('Calista Ever Clear - Pastel')).toBe('CALISTA EVER CLEAR');
    });
    test('keeps tier word ONE', () => {
        expect(extractEmulsionProductName('One Pure Elegance - Mid Tone')).toBe('ONE PURE ELEGANCE');
    });
    test('returns name unchanged when no separator', () => {
        expect(extractEmulsionProductName('Style Color Fresh')).toBe('STYLE COLOR FRESH');
    });
    test('skips ANNEXURE prefix and uses meaningful part', () => {
        expect(extractEmulsionProductName('Annexure - Calista Sparkle PU')).toBe('CALISTA SPARKLE PU');
    });
    test('handles empty', () => {
        expect(extractEmulsionProductName('')).toBe('');
        expect(extractEmulsionProductName(null)).toBe('');
    });
});

describe('extractEnamelProductAndColor', () => {
    test('splits product and color on dash', () => {
        expect(extractEnamelProductAndColor('Calista Sparkle - Blue')).toEqual({
            productName: 'CALISTA SPARKLE',
            color: 'BLUE',
        });
    });
    test('handles multi-word color', () => {
        expect(extractEnamelProductAndColor('Calista Sparkle - Deep Orange')).toEqual({
            productName: 'CALISTA SPARKLE',
            color: 'DEEP ORANGE',
        });
    });
    test('color empty when no separator', () => {
        expect(extractEnamelProductAndColor('Cover Max')).toEqual({
            productName: 'COVER MAX',
            color: '',
        });
    });
    test('handles empty', () => {
        expect(extractEnamelProductAndColor('')).toEqual({ productName: '', color: '' });
        expect(extractEnamelProductAndColor(null)).toEqual({ productName: '', color: '' });
    });
});
