/**
 * Unit tests for Anomaly Detector service
 * Tests statistical functions and severity classification
 */
const { calculateZScore, calculateStats, getSeverityFromZScore } = require('../../services/anomaly-detector');

describe('Anomaly Detector', () => {
    describe('calculateZScore()', () => {
        it('should return correct Z-score', () => {
            expect(calculateZScore(10, 5, 2)).toBeCloseTo(2.5);
        });

        it('should return 0 when stdDev is 0', () => {
            expect(calculateZScore(10, 5, 0)).toBe(0);
        });

        it('should return negative Z-score for below-mean values', () => {
            expect(calculateZScore(1, 5, 2)).toBeCloseTo(-2.0);
        });

        it('should return 0 when value equals mean', () => {
            expect(calculateZScore(5, 5, 2)).toBe(0);
        });
    });

    describe('calculateStats()', () => {
        it('should calculate correct mean', () => {
            const stats = calculateStats([2, 4, 6, 8, 10]);
            expect(stats.mean).toBe(6);
        });

        it('should calculate correct stdDev', () => {
            const stats = calculateStats([2, 4, 6, 8, 10]);
            expect(stats.stdDev).toBeCloseTo(2.828, 2);
        });

        it('should handle empty array', () => {
            const stats = calculateStats([]);
            expect(stats.mean).toBe(0);
            expect(stats.stdDev).toBe(0);
        });

        it('should handle single value', () => {
            const stats = calculateStats([5]);
            expect(stats.mean).toBe(5);
            expect(stats.stdDev).toBe(0);
        });

        it('should return correct min and max', () => {
            const stats = calculateStats([3, 1, 4, 1, 5, 9, 2, 6]);
            expect(stats.min).toBe(1);
            expect(stats.max).toBe(9);
        });

        it('should handle identical values', () => {
            const stats = calculateStats([7, 7, 7, 7]);
            expect(stats.mean).toBe(7);
            expect(stats.stdDev).toBe(0);
        });
    });

    describe('getSeverityFromZScore()', () => {
        it('should return critical for z >= 4', () => {
            expect(getSeverityFromZScore(4.5)).toBe('critical');
            expect(getSeverityFromZScore(-4.5)).toBe('critical');
        });

        it('should return high for z >= 3', () => {
            expect(getSeverityFromZScore(3.5)).toBe('high');
            expect(getSeverityFromZScore(-3.5)).toBe('high');
        });

        it('should return medium for z >= 2', () => {
            expect(getSeverityFromZScore(2.5)).toBe('medium');
            expect(getSeverityFromZScore(-2.5)).toBe('medium');
        });

        it('should return low for z < 2', () => {
            expect(getSeverityFromZScore(1.5)).toBe('low');
            expect(getSeverityFromZScore(0)).toBe('low');
        });

        it('should use custom thresholds', () => {
            expect(getSeverityFromZScore(2.5, { high: 2, critical: 3 })).toBe('high');
            expect(getSeverityFromZScore(3.5, { high: 2, critical: 3 })).toBe('critical');
        });
    });

    describe('Integration: Z-score anomaly detection flow', () => {
        it('should detect revenue anomaly with Z-score > threshold', () => {
            // Simulate 30 days of normal revenue: avg ~10000, stddev ~1000
            const normalDays = Array.from({ length: 29 }, () => 10000 + (Math.random() - 0.5) * 2000);
            const stats = calculateStats(normalDays);
            
            // Simulate a big drop day
            const anomalyValue = 4000;
            const zScore = calculateZScore(anomalyValue, stats.mean, stats.stdDev);
            
            // Should trigger detection (z-score should be well below -2)
            expect(Math.abs(zScore)).toBeGreaterThan(2);
            const severity = getSeverityFromZScore(zScore);
            expect(['medium', 'high', 'critical']).toContain(severity);
        });

        it('should NOT flag normal values as anomalies', () => {
            const values = [100, 105, 98, 102, 101, 99, 103];
            const stats = calculateStats(values);
            
            const normalValue = 101;
            const zScore = calculateZScore(normalValue, stats.mean, stats.stdDev);
            expect(Math.abs(zScore)).toBeLessThan(2);
        });
    });
});
