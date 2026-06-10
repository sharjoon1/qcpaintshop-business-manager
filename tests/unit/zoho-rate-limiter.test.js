/**
 * Characterization tests for services/zoho-rate-limiter.js (singleton).
 *
 * Locks the CURRENT arithmetic and behavior of the Zoho token-bucket limiter:
 *   - bucket: 80 tokens / 60s window → one token refills every 750ms
 *     (Math.floor proration; lastRefill only advances when ≥1 token is added)
 *   - acquire(): immediate resolve while tokens remain; otherwise queued and
 *     drained one-per-refill-tick by the interval
 *   - daily quota: 10,000/day with a 500-call reserve — normal callers reject
 *     at 9,500; priority:'high' may use the reserve up to 10,000;
 *     skipDailyCheck bypasses the quota entirely
 *   - dailyPaused flips on once dailyUsed reaches dailyLimit - dailyReserve
 *   - isCircuitOpen() at 9,000 (90%)
 *   - canStartHeavyOperation() quota math boundary
 *   - sync lock: exclusive, name-checked release, 30-minute stale auto-release
 *
 * Pure node test: no DB (pool stays null so persistence no-ops), fake timers
 * control both Date.now and the refill interval.
 */

const limiter = require('../../services/zoho-rate-limiter');

// Fixed clock: 10:30 IST — far from the IST midnight daily-reset boundary,
// so advancing minutes inside a test never rolls the day over.
const T0 = new Date('2026-06-11T05:00:00.000Z');

function resetLimiter() {
    limiter.reset(); // restores tokens to max, clears queue + interval
    limiter.pool = null;
    limiter.dailyUsed = 0;
    limiter.dailyPaused = false;
    limiter.dailyDate = limiter._todayStr();
    limiter.callerUsage = {};
    limiter.callLog = [];
    limiter.persistCounter = 0;
    limiter._resetAlerts();
    limiter.activeSyncOp = null;
    limiter.activeSyncStart = null;
}

beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(T0);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
    resetLimiter();
});

afterEach(() => {
    resetLimiter(); // resolve any queued acquires + clear the refill interval
    jest.useRealTimers();
    jest.restoreAllMocks();
});

describe('configuration constants (locked)', () => {
    it('bucket = 80 req / 60s; daily = 10,000 with 500 reserved; circuit breaker at 9,000', () => {
        expect(limiter.maxRequests).toBe(80);
        expect(limiter.windowMs).toBe(60000);
        expect(limiter.dailyLimit).toBe(10000);
        expect(limiter.dailyReserve).toBe(500);
        expect(limiter.circuitBreakerThreshold).toBe(9000);
        expect(limiter.alertThresholds).toEqual([80, 90, 95]);
    });
});

describe('token bucket arithmetic', () => {
    it('each acquire consumes one token and counts toward the daily total', async () => {
        await limiter.acquire('a');
        await limiter.acquire('a');
        await limiter.acquire('b');
        const status = limiter.getStatus();
        expect(status.available_tokens).toBe(77);
        expect(status.daily_used).toBe(3);
    });

    it('refill is floor-prorated: nothing at 749ms elapsed, exactly 1 token at 750ms (80/min)', async () => {
        await limiter.acquire('a'); // 79 left, lastRefill stays at T0 (no tokens added)
        jest.advanceTimersByTime(749);
        expect(limiter.getStatus().available_tokens).toBe(79); // floor(749/60000*80) = 0
        jest.advanceTimersByTime(1); // 750ms total since T0
        expect(limiter.getStatus().available_tokens).toBe(80); // floor(750/60000*80) = 1
    });

    it('refill caps at maxRequests no matter how long it idles', () => {
        jest.advanceTimersByTime(10 * 60 * 1000);
        expect(limiter.getStatus().available_tokens).toBe(80);
    });

    it('exhausting the bucket queues callers; the interval drains ONE per 750ms tick and self-clears when empty', async () => {
        for (let i = 0; i < 80; i++) await limiter.acquire('drain');
        expect(limiter.getStatus().available_tokens).toBe(0);

        const resolved = [false, false];
        limiter.acquire('q1').then(() => { resolved[0] = true; });
        limiter.acquire('q2').then(() => { resolved[1] = true; });
        await Promise.resolve();
        expect(resolved).toEqual([false, false]);
        expect(limiter.queue).toHaveLength(2);
        expect(limiter.refillInterval).not.toBeNull();

        jest.advanceTimersByTime(750); // 1 token refilled → q1 only
        await Promise.resolve();
        expect(resolved).toEqual([true, false]);

        jest.advanceTimersByTime(750); // next token → q2
        await Promise.resolve();
        expect(resolved).toEqual([true, true]);
        expect(limiter.queue).toHaveLength(0);
        expect(limiter.refillInterval).toBeNull(); // interval cleared once drained

        expect(limiter.getStatus().daily_used).toBe(82); // queued calls counted too
    });
});

describe('daily quota + reserve', () => {
    it('normal-priority acquire rejects once dailyUsed hits dailyLimit - dailyReserve (9,500)', async () => {
        limiter.dailyUsed = 9500;
        await expect(limiter.acquire('sync')).rejects.toThrow(/daily quota exhausted: 9500\/10000/);
    });

    it("priority:'high' may use the 500-call reserve, but rejects at the hard 10,000 limit", async () => {
        limiter.dailyUsed = 9500;
        await expect(limiter.acquire('urgent', { priority: 'high' })).resolves.toBeUndefined();
        limiter.dailyUsed = 10000;
        await expect(limiter.acquire('urgent', { priority: 'high' })).rejects.toThrow(/daily quota exhausted/);
    });

    it('skipDailyCheck bypasses the quota even past the hard limit', async () => {
        limiter.dailyUsed = 10000;
        await expect(limiter.acquire('override', { skipDailyCheck: true })).resolves.toBeUndefined();
    });

    it('dailyPaused flips on when a recorded call reaches 9,500', async () => {
        limiter.dailyUsed = 9498;
        await limiter.acquire('a');
        expect(limiter.dailyPaused).toBe(false); // 9499 — still under
        await limiter.acquire('a');
        expect(limiter.dailyPaused).toBe(true);  // 9500 — paused
    });

    it('alert thresholds fire once each at 80/90/95% of the daily limit', async () => {
        limiter.dailyUsed = 7999;
        await limiter.acquire('a'); // → 8000 = 80%
        expect(limiter.alertsTriggered).toEqual({ 80: true, 90: false, 95: false });
    });

    it('getStatus reports rounded daily percentage and remaining', () => {
        limiter.dailyUsed = 1234;
        const status = limiter.getStatus();
        expect(status.daily_percentage).toBe(12); // round(12.34)
        expect(status.daily_remaining).toBe(8766);
    });
});

describe('circuit breaker', () => {
    it('opens at exactly 9,000 daily calls (90%)', () => {
        limiter.dailyUsed = 8999;
        expect(limiter.isCircuitOpen()).toBe(false);
        limiter.dailyUsed = 9000;
        expect(limiter.isCircuitOpen()).toBe(true);
    });
});

describe('canStartHeavyOperation quota math', () => {
    it('boundary: used + estimated may reach exactly dailyLimit - reserve (9,500), one more is refused', () => {
        limiter.dailyUsed = 9000;
        expect(limiter.canStartHeavyOperation(500)).toEqual({ safe: true, reason: 'OK' });
        const refused = limiter.canStartHeavyOperation(501);
        expect(refused.safe).toBe(false);
        expect(refused.reason).toMatch(/Not enough quota: 500 calls remaining, need ~501/);
    });

    it('refuses while dailyPaused or while another sync op holds the lock', () => {
        limiter.dailyPaused = true;
        expect(limiter.canStartHeavyOperation(10).safe).toBe(false);
        limiter.dailyPaused = false;
        limiter.tryAcquireSyncLock('fullSync');
        const r = limiter.canStartHeavyOperation(10);
        expect(r.safe).toBe(false);
        expect(r.reason).toMatch(/Another operation in progress: fullSync/);
    });
});

describe('sync lock', () => {
    it('is exclusive and only releases for the matching operation name', () => {
        expect(limiter.tryAcquireSyncLock('syncItems')).toBe(true);
        expect(limiter.tryAcquireSyncLock('syncInvoices')).toBe(false);
        limiter.releaseSyncLock('someoneElse'); // wrong name → still locked
        expect(limiter.getSyncLockStatus().locked).toBe(true);
        limiter.releaseSyncLock('syncItems');
        expect(limiter.getSyncLockStatus().locked).toBe(false);
    });

    it('auto-releases a stale lock strictly older than 30 minutes', () => {
        expect(limiter.tryAcquireSyncLock('hungOp')).toBe(true);
        jest.advanceTimersByTime(30 * 60 * 1000); // exactly 30min → NOT stale (strict >)
        expect(limiter.tryAcquireSyncLock('next')).toBe(false);
        jest.advanceTimersByTime(1); // 30min + 1ms → stale, stolen
        expect(limiter.tryAcquireSyncLock('next')).toBe(true);
        expect(limiter.getSyncLockStatus().operation).toBe('next');
    });
});
