/**
 * Locks the daily-report date basis (M8): report ranges use the HOST'S local
 * calendar day, not the UTC day. The prod server clock is IST, so
 * toISOString() (UTC) rolled the date back to "yesterday" whenever the report
 * cron fired between 00:00 and 05:30 IST.
 *
 * The assertions build Dates from LOCAL components, so they hold on any
 * host timezone (dev IST, CI UTC).
 */
const { localDateStr } = require('../../services/sync-scheduler');

describe('sync-scheduler localDateStr (M8)', () => {
    it('returns the local calendar date, zero-padded', () => {
        expect(localDateStr(new Date(2026, 5, 10, 1, 30))).toBe('2026-06-10');
        expect(localDateStr(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
    });

    it('early-morning local times stay on the local day (the UTC bug this replaces)', () => {
        // 00:05 local — toISOString() on an IST host would say the previous day.
        const justAfterMidnight = new Date(2026, 5, 10, 0, 5);
        expect(localDateStr(justAfterMidnight)).toBe('2026-06-10');
    });
});
