/**
 * P0 — stock sync self-deadlock (services/sync-scheduler.js :: executeStockSync).
 *
 * executeStockSync acquires the global sync lock ('stockSync'), runs
 * syncItems + syncLocations, then RE-CHECKS the API quota before the heavy
 * per-item stock pull. The re-check used to refuse whenever ANY lock was held —
 * including the caller's own lock, acquired ~20 lines earlier — so
 * zohoAPI.syncLocationStock() was never reached and zoho_location_stock froze
 * (last real refresh on prod: 2026-05-18) while syncItems/syncLocations, which
 * run BEFORE the re-check, stayed fresh daily.
 *
 * These tests drive the real rate limiter (not a mock) so the lock interaction
 * is exercised for real; only the Zoho HTTP layer (services/zoho-api) is mocked.
 */

jest.mock('../../services/zoho-api');

const zohoAPI = require('../../services/zoho-api');
const rateLimiter = require('../../services/zoho-rate-limiter');
const scheduler = require('../../services/sync-scheduler');

function resetLimiter() {
    rateLimiter.reset();
    rateLimiter.pool = null;
    rateLimiter.dailyUsed = 0;
    rateLimiter.dailyPaused = false;
    rateLimiter.dailyDate = rateLimiter._todayStr();
    rateLimiter.callerUsage = {};
    rateLimiter.callLog = [];
    rateLimiter.persistCounter = 0;
    rateLimiter._resetAlerts();
    rateLimiter.activeSyncOp = null;
    rateLimiter.activeSyncStart = null;
}

// zoho_config rows drive getConfig(); [] → every getConfig falls back to its default
// ('stock_sync_enabled' / 'reorder_alerts_enabled' both default to 'true').
const mockPool = { query: jest.fn(async () => [[]]) };

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    resetLimiter();
    zohoAPI.checkReorderAlerts.mockResolvedValue({ created: 0, skipped: 0, auto_resolved: 0 });
    scheduler.setPool(mockPool);
});

afterEach(() => {
    resetLimiter();
    jest.restoreAllMocks();
});

describe('executeStockSync', () => {
    it('reaches syncLocationStock instead of deadlocking on its own sync lock', async () => {
        await scheduler.executeStockSync();

        expect(zohoAPI.syncItems).toHaveBeenCalledTimes(1);
        expect(zohoAPI.syncLocations).toHaveBeenCalledTimes(1);
        expect(zohoAPI.syncLocationStock).toHaveBeenCalledTimes(1);
    });

    it('releases the sync lock when it finishes', async () => {
        await scheduler.executeStockSync();
        expect(rateLimiter.getSyncLockStatus().locked).toBe(false);
    });

    it('still refuses the heavy stock pull when the daily quota is genuinely short', async () => {
        // Under the 9,000 circuit breaker and passes the opening 300-call check
        // (8900 + 300 = 9200), then syncItems burns 500 calls, so the post-items
        // re-check is 9400 + 200 > 9500 and must refuse — even though the caller owns
        // the lock. Owner exemption is not a quota bypass.
        rateLimiter.dailyUsed = 8900;
        zohoAPI.syncItems.mockImplementation(async () => { rateLimiter.dailyUsed += 500; });

        await scheduler.executeStockSync();

        expect(zohoAPI.syncItems).toHaveBeenCalledTimes(1);
        expect(zohoAPI.syncLocationStock).not.toHaveBeenCalled();
    });

    it('skips the whole cycle when another operation already holds the lock', async () => {
        rateLimiter.tryAcquireSyncLock('fullSync');

        await scheduler.executeStockSync();

        expect(zohoAPI.syncItems).not.toHaveBeenCalled();
        expect(zohoAPI.syncLocationStock).not.toHaveBeenCalled();
        expect(rateLimiter.getSyncLockStatus().operation).toBe('fullSync'); // not stolen
    });

    it('skips the whole cycle when the circuit breaker is open', async () => {
        rateLimiter.dailyUsed = 9000; // circuit breaker threshold

        await scheduler.executeStockSync();

        expect(zohoAPI.syncItems).not.toHaveBeenCalled();
        expect(zohoAPI.syncLocationStock).not.toHaveBeenCalled();
    });
});
