// tests/unit/painter-location.test.js
'use strict';

// Pure helper used inside the history endpoint to compute IST date string
function toISTDateString(date) {
    const ist = new Date(date.getTime() + 5.5 * 60 * 60 * 1000);
    return `${ist.getFullYear()}-${String(ist.getMonth() + 1).padStart(2, '0')}-${String(ist.getDate()).padStart(2, '0')}`;
}

// Pure helper to sum haversine distances over an ordered array of {latitude, longitude} points
const EARTH_RADIUS_M = 6371000;
function toRad(deg) { return deg * Math.PI / 180; }
function haversineMeters(lat1, lng1, lat2, lng2) {
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    return Math.round(EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}
function totalRouteMeters(points) {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
        total += haversineMeters(
            Number(points[i - 1].latitude), Number(points[i - 1].longitude),
            Number(points[i].latitude), Number(points[i].longitude)
        );
    }
    return total;
}

describe('toISTDateString', () => {
    test('UTC midnight → IST date is same day', () => {
        // 2026-04-22 00:00:00 UTC = 2026-04-22 05:30:00 IST → date "2026-04-22"
        const d = new Date('2026-04-22T00:00:00.000Z');
        expect(toISTDateString(d)).toBe('2026-04-22');
    });
    test('UTC 18:31 → IST date is next calendar day', () => {
        // 2026-04-22 18:31:00 UTC = 2026-04-23 00:01:00 IST → date "2026-04-23"
        const d = new Date('2026-04-22T18:31:00.000Z');
        expect(toISTDateString(d)).toBe('2026-04-23');
    });
    test('zero-pads month and day', () => {
        const d = new Date('2026-01-05T00:00:00.000Z');
        expect(toISTDateString(d)).toBe('2026-01-05');
    });
});

describe('totalRouteMeters', () => {
    test('empty array → 0', () => {
        expect(totalRouteMeters([])).toBe(0);
    });
    test('single point → 0', () => {
        expect(totalRouteMeters([{ latitude: 13.0827, longitude: 80.2707 }])).toBe(0);
    });
    test('two points ~1km apart', () => {
        const dist = totalRouteMeters([
            { latitude: 13.0827, longitude: 80.2707 },
            { latitude: 13.0917, longitude: 80.2707 }
        ]);
        expect(dist).toBeGreaterThan(900);
        expect(dist).toBeLessThan(1100);
    });
    test('three points sums correctly', () => {
        const p1 = { latitude: 13.0827, longitude: 80.2707 };
        const p2 = { latitude: 13.0917, longitude: 80.2707 };
        const p3 = { latitude: 13.1007, longitude: 80.2707 };
        const d12 = haversineMeters(13.0827, 80.2707, 13.0917, 80.2707);
        const d23 = haversineMeters(13.0917, 80.2707, 13.1007, 80.2707);
        expect(totalRouteMeters([p1, p2, p3])).toBe(d12 + d23);
    });
});
