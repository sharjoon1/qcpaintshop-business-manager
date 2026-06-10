/**
 * M4 — job_runs catch-up persistence for date-anchored painter crons.
 *
 * Locks (a) the expected-period label math for each catch-up job, and (b) the
 * startup catch-up behavior: a job whose latest expected period has no
 * job_runs marker is re-run with that explicit period and then stamped;
 * jobs with markers are left alone.
 *
 * painter-attendance-service is mocked so the forfeit path never touches the
 * real uploads directory.
 */
jest.mock('../../services/painter-attendance-service', () => ({
    setPool: jest.fn(),
    openMonthlyClaim: jest.fn(async () => ({ opened: 0 })),
    forfeitAndPurge: jest.fn(async () => ({ forfeited: 0, purged: 0 })),
    recomputeClaimable: jest.fn(async () => {}),
    remindUnclaimed: jest.fn(async () => ({ reminded: 0 })),
}));

const scheduler = require('../../services/painter-scheduler');
const attendanceService = require('../../services/painter-attendance-service');

describe('expected period labels (M4)', () => {
    it('monthly jobs evaluate the previous month', () => {
        expect(scheduler.expectedMonthlyLabel(new Date(2026, 5, 10))).toBe('2026-05');
        expect(scheduler.expectedMonthlyLabel(new Date(2026, 0, 15))).toBe('2025-12');
    });

    it('quarterly slabs evaluate the most recently completed quarter', () => {
        expect(scheduler.expectedQuarterlyLabel(new Date(2026, 5, 10))).toBe('2026-Q1');
        expect(scheduler.expectedQuarterlyLabel(new Date(2026, 6, 5))).toBe('2026-Q2');
        expect(scheduler.expectedQuarterlyLabel(new Date(2026, 0, 2))).toBe('2025-Q4');
    });

    it('forfeit is due for the previous month only from the 8th; before that, the month before last', () => {
        expect(scheduler.expectedForfeitLabel(new Date(2026, 5, 10))).toBe('2026-05');
        expect(scheduler.expectedForfeitLabel(new Date(2026, 5, 8))).toBe('2026-05');
        expect(scheduler.expectedForfeitLabel(new Date(2026, 5, 5))).toBe('2026-04');
        expect(scheduler.expectedForfeitLabel(new Date(2026, 0, 3))).toBe('2025-11');
    });
});

describe('runStartupCatchup (M4)', () => {
    function makePool({ markersPresent }) {
        const calls = [];
        return {
            calls,
            query: jest.fn(async (sql, params) => {
                calls.push([sql, params]);
                if (/SELECT 1 FROM job_runs/i.test(sql)) return [markersPresent ? [{ 1: 1 }] : []];
                if (/INSERT IGNORE INTO job_runs/i.test(sql)) return [{ affectedRows: 1 }];
                // painter_system_enabled = '0' → slab evaluations skip themselves
                if (/FROM ai_config/i.test(sql)) return [[{ config_value: '0' }]];
                return [[]];
            }),
            getConnection: jest.fn(),
        };
    }

    beforeEach(() => jest.clearAllMocks());

    it('does nothing when every job already has its marker', async () => {
        const pool = makePool({ markersPresent: true });
        scheduler.setPool(pool);
        await scheduler.runStartupCatchup(new Date(2026, 5, 10));
        const markerChecks = pool.calls.filter(c => /SELECT 1 FROM job_runs/i.test(c[0]));
        expect(markerChecks).toHaveLength(4);
        // nothing else ran: no job executions, no marker writes
        expect(pool.calls).toHaveLength(4);
        expect(attendanceService.openMonthlyClaim).not.toHaveBeenCalled();
        expect(attendanceService.forfeitAndPurge).not.toHaveBeenCalled();
    });

    it('re-runs missed jobs with the explicit period and claims their markers', async () => {
        const pool = makePool({ markersPresent: false });
        scheduler.setPool(pool);
        await scheduler.runStartupCatchup(new Date(2026, 5, 10));

        // attendance jobs ran for their expected periods
        expect(attendanceService.openMonthlyClaim).toHaveBeenCalledWith('2026-05');
        // forfeit month 2026-05, purge month derived as the month before
        expect(attendanceService.forfeitAndPurge).toHaveBeenCalledWith('2026-05', '2026-04');

        const markers = pool.calls
            .filter(c => /INSERT IGNORE INTO job_runs/i.test(c[0]))
            .map(c => c[1]);
        expect(markers).toContainEqual(['painter-attendance-open-claim', '2026-05']);
        expect(markers).toContainEqual(['painter-attendance-forfeit', '2026-05']);
        // slab evaluations skipped (painter system disabled) → NOT claimed,
        // so they stay eligible for catch-up once the system is enabled
        expect(markers.find(m => m[0] === 'painter-monthly-slabs')).toBeUndefined();
        expect(markers.find(m => m[0] === 'painter-quarterly-slabs')).toBeUndefined();
    });

    it('marker claim is a mutex: a concurrent run that lost the INSERT IGNORE race skips the job', async () => {
        const calls = [];
        const pool = {
            calls,
            query: jest.fn(async (sql, params) => {
                calls.push([sql, params]);
                // someone else already claimed this period
                if (/INSERT IGNORE INTO job_runs/i.test(sql)) return [{ affectedRows: 0 }];
                return [[]];
            }),
            getConnection: jest.fn(),
        };
        scheduler.setPool(pool);
        await scheduler.runOpenAttendanceClaim('2026-05');
        expect(attendanceService.openMonthlyClaim).not.toHaveBeenCalled();
    });

    it('does not run a period EARLY: before the cron fire time on the 1st, slab catch-up waits for the cron', async () => {
        const pool = makePool({ markersPresent: false });
        scheduler.setPool(pool);
        // July 1st 03:00 IST — open-claim (00:05) is due, slabs (06:00/06:30) are not
        await scheduler.runStartupCatchup(new Date(2026, 6, 1, 3, 0));

        expect(attendanceService.openMonthlyClaim).toHaveBeenCalledWith('2026-06');
        // forfeit for May was due June 8 — runs
        expect(attendanceService.forfeitAndPurge).toHaveBeenCalledWith('2026-05', '2026-04');
        // slabs: not even their marker lookup runs (skipped before jobRanFor)
        const markerChecks = pool.calls.filter(c => /SELECT 1 FROM job_runs/i.test(c[0])).map(c => c[1][0]);
        expect(markerChecks).not.toContain('painter-monthly-slabs');
        expect(markerChecks).not.toContain('painter-quarterly-slabs');
    });
});
