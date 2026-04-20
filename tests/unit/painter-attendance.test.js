const { haversineMeters } = require('../../services/painter-attendance-service');

describe('haversineMeters', () => {
    test('returns 0 for identical points', () => {
        expect(haversineMeters(13.0827, 80.2707, 13.0827, 80.2707)).toBe(0);
    });
    test('computes ~900m correctly (Chennai landmark test)', () => {
        const d = haversineMeters(13.0504, 80.2826, 13.0579, 80.2830);
        expect(d).toBeGreaterThan(800);
        expect(d).toBeLessThan(1000);
    });
    test('computes ~1km correctly', () => {
        const d = haversineMeters(13.0827, 80.2707, 13.0917, 80.2707);
        expect(d).toBeGreaterThan(900);
        expect(d).toBeLessThan(1100);
    });
    test('rounds to integer meters', () => {
        const d = haversineMeters(13.0827, 80.2707, 13.0827001, 80.2707001);
        expect(Number.isInteger(d)).toBe(true);
    });
});
