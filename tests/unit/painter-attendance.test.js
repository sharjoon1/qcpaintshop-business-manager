const { haversineMeters, computeClaimPct, computeClaimableAp } = require('../../services/painter-attendance-service');

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

describe('computeClaimPct', () => {
    const cfg = { rupeesPerPct: 1000, maxPct: 100 };
    test('zero billed → 0%', () => expect(computeClaimPct(0, cfg)).toBe(0));
    test('₹999 → 0%', () => expect(computeClaimPct(999, cfg)).toBe(0));
    test('₹1,000 → 1%', () => expect(computeClaimPct(1000, cfg)).toBe(1));
    test('₹49,999 → 49%', () => expect(computeClaimPct(49999, cfg)).toBe(49));
    test('₹50,000 → 50%', () => expect(computeClaimPct(50000, cfg)).toBe(50));
    test('₹99,999 → 99%', () => expect(computeClaimPct(99999, cfg)).toBe(99));
    test('₹1,00,000 → 100%', () => expect(computeClaimPct(100000, cfg)).toBe(100));
    test('₹5,00,000 caps at 100%', () => expect(computeClaimPct(500000, cfg)).toBe(100));
});

describe('computeClaimableAp', () => {
    test('2000 AP × 50% → 1000', () => expect(computeClaimableAp(2000, 50)).toBe(1000));
    test('1500 AP × 33% → 495 (floor)', () => expect(computeClaimableAp(1500, 33)).toBe(495));
    test('100 AP × 0% → 0', () => expect(computeClaimableAp(100, 0)).toBe(0));
    test('0 AP × 100% → 0', () => expect(computeClaimableAp(0, 100)).toBe(0));
    test('2000 AP × 100% → 2000', () => expect(computeClaimableAp(2000, 100)).toBe(2000));
});

const service = require('../../services/painter-attendance-service');

describe('findNearbyBranches', () => {
    let mockPool;
    beforeEach(() => {
        mockPool = {
            query: jest.fn().mockResolvedValue([[
                { id: 1, name: 'Chennai Main', latitude: 13.0827, longitude: 80.2707 },
                { id: 2, name: 'T. Nagar', latitude: 13.0418, longitude: 80.2341 }
            ]])
        };
        service.setPool(mockPool);
    });

    test('returns branches within 1km sorted by distance', async () => {
        const results = await service.findNearbyBranches(13.0830, 80.2710, 1000);
        expect(results.length).toBeGreaterThanOrEqual(1);
        expect(results[0].branch_id).toBe(1);
        expect(results[0].distance_meters).toBeLessThan(100);
    });

    test('excludes branches beyond max distance', async () => {
        const results = await service.findNearbyBranches(13.0830, 80.2710, 500);
        expect(results.every(r => r.distance_meters <= 500)).toBe(true);
    });

    test('excludes branches with null GPS', async () => {
        mockPool.query.mockResolvedValue([[
            { id: 1, name: 'Has GPS', latitude: 13.0827, longitude: 80.2707 },
            { id: 2, name: 'No GPS', latitude: null, longitude: null }
        ]]);
        const results = await service.findNearbyBranches(13.0830, 80.2710, 5000);
        expect(results.map(r => r.branch_id)).toEqual([1]);
    });
});
