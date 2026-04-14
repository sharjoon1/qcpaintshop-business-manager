const { computeReorderLevel, computeSeverity, computeReorderQuantity } = require('../../services/reorder-compute-service');

describe('reorder-compute pure helpers', () => {
    test('computeReorderLevel multiplies avg sales by (lead + safety) and ceils', () => {
        expect(computeReorderLevel(2.5, 7, 5)).toBe(30);
        expect(computeReorderLevel(1, 3, 3)).toBe(6);
        expect(computeReorderLevel(0.5, 10, 5)).toBe(8);
    });

    test('computeReorderQuantity returns 15-day replenish pack (ceiled)', () => {
        expect(computeReorderQuantity(2)).toBe(30);
        expect(computeReorderQuantity(0.5)).toBe(8);
    });

    test('computeSeverity tiers by stock/reorder ratio', () => {
        expect(computeSeverity(2, 10)).toBe('critical');
        expect(computeSeverity(4, 10)).toBe('high');
        expect(computeSeverity(6, 10)).toBe('medium');
        expect(computeSeverity(9, 10)).toBe('low');
        expect(computeSeverity(15, 10)).toBe(null);
    });

    test('computeSeverity returns null when reorder level is 0 or negative', () => {
        expect(computeSeverity(5, 0)).toBe(null);
        expect(computeSeverity(5, -1)).toBe(null);
    });
});
