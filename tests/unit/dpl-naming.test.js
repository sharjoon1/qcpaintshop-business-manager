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
