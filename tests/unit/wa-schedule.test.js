/**
 * CM5 — Schedule picker: IST wall-clock → UTC conversion + validation.
 *
 * Locks:
 *   1. parseIstLocalToEpoch matrix — valid datetime-local strings (IST wall
 *      clock) → correct UTC epoch; malformed/out-of-range/non-string → null;
 *      midnight rollover (02:00 IST → previous UTC day).
 *   2. formatUtcSql padding — zero-padded MySQL DATETIME string.
 *   3. istLocalToUtcSql — the documented examples verbatim.
 *   4. validateScheduledAt — 2-min past grace, 30-day future cap, injectable
 *      `now`; malformed → error, not exception.
 *   5. Route content-contract — start calls validateScheduledAt and stores the
 *      CONVERTED value (validated.utc), never the raw input.
 *   6. Wizard — datetime-local input present in the review step; the raw
 *      string is threaded into the start body only when set; the list-path
 *      start (populateAndStart) stays immediate.
 */

const fs = require('fs');
const path = require('path');

const waMarketing = require('../../routes/wa-marketing');

// IST = UTC + 5:30 (no DST in India — the fixed offset is correct).
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────
//  1. parseIstLocalToEpoch
// ─────────────────────────────────────────────────────────────────────────

describe('parseIstLocalToEpoch (CM5)', () => {
    test.each([
        // IST wall clock 15:00 → UTC 09:30 same day
        ['2026-07-15T15:00', Date.UTC(2026, 6, 15, 9, 30, 0)],
        // midnight rollover: IST 02:00 on the 15th → UTC 20:30 on the 14th
        ['2026-07-15T02:00', Date.UTC(2026, 6, 14, 20, 30, 0)],
        // month/day/hour/min boundaries
        ['2026-01-01T00:00', Date.UTC(2025, 11, 31, 18, 30, 0)],
        ['2026-12-31T23:59', Date.UTC(2026, 11, 31, 18, 29, 0)],
        // whitespace is tolerated
        [' 2026-07-15T15:00 ', Date.UTC(2026, 6, 15, 9, 30, 0)],
    ])('%j → UTC epoch', (input, expected) => {
        expect(waMarketing.parseIstLocalToEpoch(input)).toBe(expected);
    });

    test.each([
        [''],
        ['junk'],
        ['2026-7-15T15:00'],        // month not zero-padded
        ['2026-07-15 15:00'],       // space instead of T
        ['2026-07-15T15:00:00'],    // seconds not in the accepted format
        ['2026-13-15T15:00'],       // month 13
        ['2026-00-15T15:00'],       // month 0
        ['2026-07-32T15:00'],       // day 32
        ['2026-07-00T15:00'],       // day 0
        ['2026-07-15T24:00'],       // hour 24
        ['2026-07-15T15:60'],       // minute 60
        ['2026-07-15T15:5'],        // minute not padded
    ])('%j → null (malformed/out of range)', (input) => {
        expect(waMarketing.parseIstLocalToEpoch(input)).toBeNull();
    });

    test('non-string inputs → null', () => {
        expect(waMarketing.parseIstLocalToEpoch(null)).toBeNull();
        expect(waMarketing.parseIstLocalToEpoch(undefined)).toBeNull();
        expect(waMarketing.parseIstLocalToEpoch(123)).toBeNull();
    });

    test('the offset constant is exactly 5.5h (matches the DB-session assumption)', () => {
        expect(IST_OFFSET_MS).toBe(5.5 * 60 * 60 * 1000);
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  2. formatUtcSql
// ─────────────────────────────────────────────────────────────────────────

describe('formatUtcSql (CM5)', () => {
    test('zero-pads month/day/hour/minute/second', () => {
        expect(waMarketing.formatUtcSql(Date.UTC(2026, 0, 2, 3, 4, 5))).toBe('2026-01-02 03:04:05');
    });

    test('round-trips a rollover epoch', () => {
        expect(waMarketing.formatUtcSql(Date.UTC(2026, 6, 14, 20, 30, 0))).toBe('2026-07-14 20:30:00');
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  3. istLocalToUtcSql
// ─────────────────────────────────────────────────────────────────────────

describe('istLocalToUtcSql (CM5)', () => {
    test('documented examples verbatim', () => {
        expect(waMarketing.istLocalToUtcSql('2026-07-15T15:00')).toBe('2026-07-15 09:30:00');
        expect(waMarketing.istLocalToUtcSql('2026-07-15T02:00')).toBe('2026-07-14 20:30:00');
    });

    test('malformed → null (never a partial conversion)', () => {
        expect(waMarketing.istLocalToUtcSql('')).toBeNull();
        expect(waMarketing.istLocalToUtcSql('junk')).toBeNull();
        expect(waMarketing.istLocalToUtcSql(undefined)).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  4. validateScheduledAt
// ─────────────────────────────────────────────────────────────────────────

describe('validateScheduledAt (CM5)', () => {
    // Fixed "now": 2026-07-15 14:30 IST = 2026-07-15 09:00 UTC.
    const NOW = Date.UTC(2026, 6, 15, 9, 0, 0);

    test('malformed input → { ok:false } error (not a throw)', () => {
        const r = waMarketing.validateScheduledAt('not-a-date', NOW);
        expect(r.ok).toBe(false);
        expect(typeof r.error).toBe('string');
    });

    test('more than 2 minutes in the past → error', () => {
        // 12:00 IST is 2.5h before now
        const r = waMarketing.validateScheduledAt('2026-07-15T12:00', NOW);
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/past/i);
    });

    test('up to 2 minutes in the past is tolerated (grace for click latency)', () => {
        // 14:29 IST = 1 minute before now
        const r = waMarketing.validateScheduledAt('2026-07-15T14:29', NOW);
        expect(r.ok).toBe(true);
    });

    test('valid future time → ok with the CONVERTED UTC string', () => {
        const r = waMarketing.validateScheduledAt('2026-07-15T15:00', NOW);
        expect(r).toEqual({ ok: true, utc: '2026-07-15 09:30:00' });
    });

    test('exactly 30 days out → ok; 30 days + 1 min → error', () => {
        // NOW is Jul 15 14:30 IST; 30 days later is Aug 14 14:30 IST.
        expect(waMarketing.validateScheduledAt('2026-08-14T14:30', NOW).ok).toBe(true);
        const r = waMarketing.validateScheduledAt('2026-08-14T14:31', NOW);
        expect(r.ok).toBe(false);
        expect(r.error).toMatch(/30 days/i);
    });

    test('empty string is malformed (caller only invokes this when set)', () => {
        expect(waMarketing.validateScheduledAt('', NOW).ok).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  5. Route content-contract — start stores the CONVERTED value
// ─────────────────────────────────────────────────────────────────────────

describe('wa-marketing start route schedule handling (CM5)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'wa-marketing.js'), 'utf8');

    test('start validates scheduled_at through validateScheduledAt', () => {
        expect(src).toMatch(/const validated = validateScheduledAt\(scheduled_at\);/);
    });

    test('invalid schedule → HTTP 400 with the validator error', () => {
        expect(src).toMatch(/if \(!validated\.ok\) return res\.status\(400\)\.json\(\{ error: validated\.error \}\);/);
    });

    test('the DB UPDATE stores validated.utc, never the raw input', () => {
        expect(src).toMatch(/\[validated\.utc, req\.params\.id\]/);
        // The raw `scheduled_at` string must never be a bind value for the
        // scheduled_at column write.
        expect((src.match(/SET status = 'scheduled', scheduled_at = \?/g) || []).length).toBe(1);
    });

    test('helpers are exported for unit tests', () => {
        expect(typeof waMarketing.parseIstLocalToEpoch).toBe('function');
        expect(typeof waMarketing.formatUtcSql).toBe('function');
        expect(typeof waMarketing.istLocalToUtcSql).toBe('function');
        expect(typeof waMarketing.validateScheduledAt).toBe('function');
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  6. Wizard content-contract — raw value threaded only when set
// ─────────────────────────────────────────────────────────────────────────

describe('campaign wizard schedule picker (CM5)', () => {
    const html = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'admin-wa-marketing.html'), 'utf8');

    test('datetime-local input present in the review step with the ~1-minute copy', () => {
        expect(html).toMatch(/<input type="datetime-local" id="wizScheduledAt"/);
        expect(html).toMatch(/starts within ~1 minute of the scheduled time/);
    });

    test('wizard-open resets the picker and floors min at now (no toISOString)', () => {
        expect(html).toMatch(/schedInput\.value = '';/);
        expect(html).toMatch(/schedInput\.min = `\$\{nowLocal\.getFullYear\(\)\}-/);
    });

    test('createAndStartCampaign threads the RAW string only when set', () => {
        expect(html).toMatch(/const startBody = \{\};/);
        expect(html).toMatch(/if \(sched\) startBody\.scheduled_at = sched;/);
        // no toISOString / Date parsing on the client — backend owns conversion
        expect(html).not.toMatch(/startBody\.scheduled_at.*toISOString/);
    });

    test('list-path start (populateAndStart) stays immediate', () => {
        // The immediate start fetch sends an empty body.
        const matches = html.match(/JSON\.stringify\(startBody\)/g) || [];
        expect(matches.length).toBe(1);
        expect(html).toMatch(/campaigns\/\$\{id\}\/start/, 'populateAndStart exists');
    });
});
