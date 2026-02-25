/**
 * Unit tests for Production Monitor & Self-Healing Service
 */
const { checkMemory, checkEventLoop, DEFAULTS, canCallApi, recordApiFailure, recordApiSuccess, getCircuitState } = require('../../services/production-monitor');

describe('Production Monitor', () => {
    describe('checkMemory()', () => {
        it('should return memory metrics with status', () => {
            const result = checkMemory();
            expect(result).toHaveProperty('status');
            expect(result).toHaveProperty('heapUsedMB');
            expect(result).toHaveProperty('heapTotalMB');
            expect(result).toHaveProperty('rssMB');
            expect(result).toHaveProperty('heapPct');
            expect(result).toHaveProperty('systemFreeMB');
            expect(result).toHaveProperty('systemTotalMB');
            expect(['healthy', 'warning', 'critical']).toContain(result.status);
        });

        it('should return valid percentage values', () => {
            const result = checkMemory();
            expect(result.heapPct).toBeGreaterThanOrEqual(0);
            expect(result.heapPct).toBeLessThanOrEqual(100);
            expect(result.systemUsedPct).toBeGreaterThanOrEqual(0);
            expect(result.systemUsedPct).toBeLessThanOrEqual(100);
        });

        it('should return positive MB values', () => {
            const result = checkMemory();
            expect(result.heapUsedMB).toBeGreaterThan(0);
            expect(result.heapTotalMB).toBeGreaterThan(0);
            expect(result.rssMB).toBeGreaterThan(0);
        });
    });

    describe('checkEventLoop()', () => {
        it('should return event loop metrics with status', () => {
            const result = checkEventLoop();
            expect(result).toHaveProperty('status');
            expect(result).toHaveProperty('lagMs');
            expect(['healthy', 'warning', 'critical']).toContain(result.status);
        });

        it('should return non-negative lag', () => {
            const result = checkEventLoop();
            expect(result.lagMs).toBeGreaterThanOrEqual(0);
        });
    });

    describe('DEFAULTS', () => {
        it('should have required threshold values', () => {
            expect(DEFAULTS.memoryWarningPct).toBe(80);
            expect(DEFAULTS.memoryCriticalPct).toBe(90);
            expect(DEFAULTS.eventLoopLagWarnMs).toBe(100);
            expect(DEFAULTS.eventLoopLagCriticalMs).toBe(500);
            expect(DEFAULTS.dbPoolWarnPct).toBe(80);
            expect(DEFAULTS.maxHealingActionsPerHour).toBe(10);
            expect(DEFAULTS.alertCooldownMinutes).toBe(60);
        });
    });

    describe('Circuit Breaker', () => {
        beforeEach(() => {
            // Reset circuit breaker state
            const cb = getCircuitState();
            cb.state = 'closed';
            cb.failures = 0;
            cb.lastFailure = null;
            cb.openedAt = null;
        });

        it('should start in closed state', () => {
            expect(canCallApi()).toBe(true);
            expect(getCircuitState().state).toBe('closed');
        });

        it('should open after threshold failures', () => {
            for (let i = 0; i < 5; i++) {
                recordApiFailure();
            }
            expect(getCircuitState().state).toBe('open');
            expect(canCallApi()).toBe(false);
        });

        it('should transition to half-open after reset period', () => {
            for (let i = 0; i < 5; i++) {
                recordApiFailure();
            }
            // Simulate reset period passed
            const cb = getCircuitState();
            cb.openedAt = Date.now() - 400000; // 400s ago, threshold is 300s
            expect(canCallApi()).toBe(true);
            expect(cb.state).toBe('half-open');
        });

        it('should close on success after half-open', () => {
            const cb = getCircuitState();
            cb.state = 'half-open';
            recordApiSuccess();
            expect(cb.state).toBe('closed');
            expect(cb.failures).toBe(0);
        });

        it('should decrement failures on success in closed state', () => {
            recordApiFailure();
            recordApiFailure();
            expect(getCircuitState().failures).toBe(2);
            recordApiSuccess();
            expect(getCircuitState().failures).toBe(1);
        });
    });
});
