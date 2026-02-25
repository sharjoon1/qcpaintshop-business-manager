/**
 * Unit tests for Response Time Tracking Middleware
 */
const { getMetrics, recordRequest, reset, BUFFER_SIZE, SLOW_THRESHOLD_MS } = require('../../middleware/responseTracker');

describe('Response Tracker', () => {
    beforeEach(() => {
        reset();
    });

    describe('recordRequest()', () => {
        it('should record a request entry', () => {
            recordRequest({
                path: '/api/test',
                method: 'GET',
                statusCode: 200,
                durationMs: 50,
                timestamp: Date.now()
            });
            const metrics = getMetrics();
            expect(metrics.totalRequests).toBe(1);
        });

        it('should track slow endpoints above threshold', () => {
            recordRequest({
                path: '/api/slow',
                method: 'GET',
                statusCode: 200,
                durationMs: SLOW_THRESHOLD_MS + 100,
                timestamp: Date.now()
            });
            const metrics = getMetrics();
            expect(metrics.slowest.length).toBe(1);
            expect(metrics.slowest[0].path).toBe('GET /api/slow');
        });
    });

    describe('getMetrics()', () => {
        it('should return zero metrics when buffer is empty', () => {
            const metrics = getMetrics();
            expect(metrics.p50).toBe(0);
            expect(metrics.p95).toBe(0);
            expect(metrics.p99).toBe(0);
            expect(metrics.rpm).toBe(0);
            expect(metrics.totalRequests).toBe(0);
        });

        it('should calculate correct percentiles', () => {
            const now = Date.now();
            // Insert 100 requests with predictable durations
            for (let i = 1; i <= 100; i++) {
                recordRequest({
                    path: '/api/test',
                    method: 'GET',
                    statusCode: 200,
                    durationMs: i * 10, // 10, 20, 30, ... 1000
                    timestamp: now
                });
            }
            const metrics = getMetrics();
            expect(metrics.p50).toBeGreaterThanOrEqual(490);
            expect(metrics.p50).toBeLessThanOrEqual(510);
            expect(metrics.p95).toBeGreaterThanOrEqual(940);
            expect(metrics.p99).toBeGreaterThanOrEqual(990);
        });

        it('should calculate error rate from 5xx responses', () => {
            const now = Date.now();
            for (let i = 0; i < 8; i++) {
                recordRequest({ path: '/api/ok', method: 'GET', statusCode: 200, durationMs: 50, timestamp: now });
            }
            for (let i = 0; i < 2; i++) {
                recordRequest({ path: '/api/err', method: 'GET', statusCode: 500, durationMs: 50, timestamp: now });
            }
            const metrics = getMetrics();
            expect(metrics.errorRate).toBe(20); // 2/10 = 20%
        });

        it('should provide status breakdown', () => {
            const now = Date.now();
            recordRequest({ path: '/api/a', method: 'GET', statusCode: 200, durationMs: 10, timestamp: now });
            recordRequest({ path: '/api/b', method: 'GET', statusCode: 404, durationMs: 10, timestamp: now });
            recordRequest({ path: '/api/c', method: 'GET', statusCode: 500, durationMs: 10, timestamp: now });
            const metrics = getMetrics();
            expect(metrics.statusBreakdown['2xx']).toBe(1);
            expect(metrics.statusBreakdown['4xx']).toBe(1);
            expect(metrics.statusBreakdown['5xx']).toBe(1);
        });
    });

    describe('reset()', () => {
        it('should clear all metrics', () => {
            recordRequest({ path: '/api/test', method: 'GET', statusCode: 200, durationMs: 50, timestamp: Date.now() });
            expect(getMetrics().totalRequests).toBe(1);
            reset();
            expect(getMetrics().totalRequests).toBe(0);
        });
    });

    describe('Constants', () => {
        it('should have buffer size of 1000', () => {
            expect(BUFFER_SIZE).toBe(1000);
        });

        it('should have slow threshold of 3000ms', () => {
            expect(SLOW_THRESHOLD_MS).toBe(3000);
        });
    });
});
