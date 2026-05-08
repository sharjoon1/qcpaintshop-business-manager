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
