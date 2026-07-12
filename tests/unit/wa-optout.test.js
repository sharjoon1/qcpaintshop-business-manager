/**
 * CM3 — WhatsApp marketing opt-out / STOP suppression.
 *
 * Locks:
 *   1. detectKeyword matrix — exact single-word STOP/START family only, trailing
 *      punctuation tolerated, multi-word bodies never match.
 *   2. phoneKey normalization (10 / 12-digit / formatted → last 10).
 *   3. Send-time enforcement (assertSendAllowed) fires ONLY for marketing
 *      sources; transactional 'estimate' passes even when opted out.
 *   4. Engine skip path — OPTED_OUT marks the lead 'skipped' with NO failed_count
 *      and NO sending-stat bump.
 *   5. Audience exclusion uses NOT EXISTS wa_opt_outs (never NOT IN) in
 *      buildLeadFilterQuery + the manual-populate + instant-send fetch queries.
 *   6. Bilingual replies exist and the Tamil line never opens with வணக்கம்.
 *   7. Migration idempotency (tableExists-guarded CREATE).
 */

const fs = require('fs');
const path = require('path');

const optout = require('../../services/wa-optout-service');

// ─────────────────────────────────────────────────────────────────────────
//  1. detectKeyword matrix
// ─────────────────────────────────────────────────────────────────────────

describe('detectKeyword (CM3)', () => {
    test.each([
        ['STOP', 'stop'],
        ['stop', 'stop'],
        ['Stop', 'stop'],
        ['STOP.', 'stop'],
        ['stop!', 'stop'],
        ['  Stop  ', 'stop'],
        ['UNSUBSCRIBE', 'stop'],
        ['unsubscribe.', 'stop'],
        ['OPTOUT', 'stop'],
        ['UNSUB', 'stop'],
        ['START', 'start'],
        ['start', 'start'],
        ['RESUME', 'start'],
        ['subscribe', 'start'],
        ['SUBSCRIBE!', 'start'],
    ])('%j → %s', (body, expected) => {
        expect(optout.detectKeyword(body)).toBe(expected);
    });

    test.each([
        ['stop by the shop'],      // multi-word — must NOT match
        ['please stop'],
        ['start the work tomorrow'],
        ['stopping'],              // not an exact word
        ['restart'],
        ['hello there'],
        ['unsubscribe me please'],
        [''],
        ['   '],
        [null],
        [undefined],
    ])('%j → null', (body) => {
        expect(optout.detectKeyword(body)).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  2. phoneKey normalization
// ─────────────────────────────────────────────────────────────────────────

describe('phoneKey (CM3)', () => {
    test.each([
        ['9876543210', '9876543210'],
        ['919876543210', '9876543210'],
        ['+91 98765 43210', '9876543210'],
        ['+919876543210', '9876543210'],
        ['0919876543210', '9876543210'],
    ])('%j → %s', (raw, expected) => {
        expect(optout.phoneKey(raw)).toBe(expected);
    });

    test.each([['98765'], [''], [null], [undefined], ['abc']])('%j → null (too few digits)', (raw) => {
        expect(optout.phoneKey(raw)).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  3. Send-time enforcement — marketing sources only
// ─────────────────────────────────────────────────────────────────────────

function makeOptoutPool(optedKeys = []) {
    const set = new Set(optedKeys);
    return {
        query: jest.fn(async (sql, params) => {
            if (/SELECT 1 FROM wa_opt_outs/i.test(String(sql))) {
                return [set.has(params[0]) ? [{ ok: 1 }] : []];
            }
            return [{ affectedRows: 1 }];
        }),
    };
}

describe('assertSendAllowed enforcement (CM3)', () => {
    test.each(optout.MARKETING_SOURCES)('marketing source %s to an opted-out number throws OPTED_OUT', async (src) => {
        const pool = makeOptoutPool(['9876543210']);
        await expect(optout.assertSendAllowed(pool, '919876543210', src))
            .rejects.toMatchObject({ code: 'OPTED_OUT' });
    });

    test("non-marketing source 'estimate' passes even when opted out", async () => {
        const pool = makeOptoutPool(['9876543210']);
        await expect(optout.assertSendAllowed(pool, '9876543210', 'estimate')).resolves.toBeUndefined();
    });

    test("transactional 'optout' confirmation reply is never gated", async () => {
        const pool = makeOptoutPool(['9876543210']);
        await expect(optout.assertSendAllowed(pool, '9876543210', 'optout')).resolves.toBeUndefined();
    });

    test('marketing source to a NOT-opted-out number passes', async () => {
        const pool = makeOptoutPool([]);
        await expect(optout.assertSendAllowed(pool, '9876543210', 'campaign')).resolves.toBeUndefined();
    });

    test('isOptedOut is a safe no-op without a pool', async () => {
        await expect(optout.isOptedOut(null, '9876543210')).resolves.toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  4. Engine skip path — OPTED_OUT → 'skipped', no failed_count / no stat bump
// ─────────────────────────────────────────────────────────────────────────

describe('wa-campaign-engine sendToLead opt-out skip (CM3)', () => {
    const engine = require('../../services/wa-campaign-engine');

    function makeEngineSkipPool() {
        const calls = [];
        return {
            calls,
            query: jest.fn(async (sql, params) => {
                const s = String(sql).replace(/\s+/g, ' ').trim();
                calls.push({ s, params });
                if (/FROM wa_marketing_settings/i.test(s)) {
                    // Minimize delays: getSettingInt uses `parseInt(x) || default`
                    // so a literal '0' falls through to the default — use '1' with
                    // min==max for a deterministic ~1s each (2s total, no sleep RNG).
                    return [[
                        { key: 'seen_delay_min', value: '1' },
                        { key: 'seen_delay_max', value: '1' },
                        { key: 'typing_delay_min', value: '1' },
                        { key: 'typing_delay_max', value: '1' },
                    ]];
                }
                return [{ affectedRows: 1 }];
            }),
        };
    }

    test("OPTED_OUT throw marks the lead 'skipped' and skips failure bookkeeping", async () => {
        const pool = makeEngineSkipPool();
        engine.setPool(pool);
        await engine.loadSettings();
        engine.setSessionManager({
            sendMessage: jest.fn(async () => {
                const e = new Error('opted out');
                e.code = 'OPTED_OUT';
                throw e;
            }),
        });

        const campaign = {
            id: 3, message_type: 'text', message_body: 'hi {name}',
            media_url: null, sent_count: 0, failed_count: 0, total_leads: 1,
        };
        const lead = { id: 88, lead_name: 'X', phone: '9876543210' };
        await engine.sendToLead(campaign, lead, 0);

        // skipped UPDATE present
        expect(pool.calls.some(c => /UPDATE wa_campaign_leads SET status = 'skipped'/.test(c.s))).toBe(true);
        // failed_count UPDATE absent
        expect(pool.calls.some(c => /UPDATE wa_campaigns SET failed_count = failed_count \+ 1/.test(c.s))).toBe(false);
        // sending-stat bump absent
        expect(pool.calls.some(c => /INSERT INTO wa_sending_stats/i.test(c.s))).toBe(false);
        // never marked 'failed'
        expect(pool.calls.some(c => /UPDATE wa_campaign_leads SET status = 'failed'/.test(c.s))).toBe(false);
    }, 15000);
});

// ─────────────────────────────────────────────────────────────────────────
//  5. Audience exclusion — NOT EXISTS wa_opt_outs (never NOT IN)
// ─────────────────────────────────────────────────────────────────────────

describe('audience opt-out exclusion (CM3)', () => {
    const waMarketing = require('../../routes/wa-marketing');

    test('buildLeadFilterQuery excludes opted-out via NOT EXISTS (not NOT IN)', () => {
        const { query } = waMarketing.buildLeadFilterQuery({}, null);
        expect(query).toMatch(/NOT EXISTS \(SELECT 1 FROM wa_opt_outs/);
        expect(query).not.toMatch(/NOT IN/);
    });

    test('countOnly variant also excludes opted-out', () => {
        const { query } = waMarketing.buildLeadFilterQuery({}, null, true);
        expect(query).toMatch(/NOT EXISTS \(SELECT 1 FROM wa_opt_outs/);
    });

    test('manual-populate + instant-send fetch both apply the NOT EXISTS clause', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'wa-marketing.js'), 'utf8');
        const matches = src.match(/NOT EXISTS \(SELECT 1 FROM wa_opt_outs o WHERE o\.phone_key = RIGHT\(REGEXP_REPLACE\(l\.phone/g) || [];
        // manual populate + buildLeadFilterQuery + instant fetch
        expect(matches.length).toBeGreaterThanOrEqual(3);
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  6. Bilingual replies — Tamil never opens with வணக்கம்
// ─────────────────────────────────────────────────────────────────────────

describe('opt-out confirmation replies (CM3)', () => {
    test('Tamil opt-out / opt-in lines do NOT open with வணக்கம்', () => {
        expect(optout.OPT_OUT_REPLY_TA.startsWith('வணக்கம்')).toBe(false);
        expect(optout.OPT_IN_REPLY_TA.startsWith('வணக்கம்')).toBe(false);
    });

    test('replies are bilingual (English + Tamil segments present)', () => {
        expect(optout.OPT_OUT_REPLY).toContain(optout.OPT_OUT_REPLY_EN);
        expect(optout.OPT_OUT_REPLY).toContain(optout.OPT_OUT_REPLY_TA);
        expect(optout.OPT_IN_REPLY).toContain(optout.OPT_IN_REPLY_EN);
        expect(optout.OPT_IN_REPLY).toContain(optout.OPT_IN_REPLY_TA);
    });

    test('inbound handler wires STOP→recordOptOut / START→recordOptIn and replies via source optout', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', '..', 'services', 'whatsapp-session-manager.js'), 'utf8');
        expect(src).toMatch(/detectKeyword\(msg\.body\)/);
        expect(src).toMatch(/recordOptOut\(/);
        expect(src).toMatch(/recordOptIn\(/);
        expect(src).toMatch(/source: 'optout'/);
        // Enforcement wired into both send paths.
        expect((src.match(/assertSendAllowed\(/g) || []).length).toBeGreaterThanOrEqual(2);
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  7. Migration idempotency
// ─────────────────────────────────────────────────────────────────────────

describe('migration 20260713_wa_opt_outs (CM3)', () => {
    const migration = require('../../migrations/20260713_wa_opt_outs');

    function makeMigPool({ exists }) {
        const calls = [];
        return {
            calls,
            query: jest.fn(async (sql, params) => {
                const s = String(sql).replace(/\s+/g, ' ').trim();
                calls.push({ s, params });
                if (/information_schema\.TABLES/i.test(s)) return [exists ? [{ ok: 1 }] : []];
                return [{ affectedRows: 0 }];
            }),
        };
    }

    test('exports up()', () => expect(typeof migration.up).toBe('function'));

    test('fresh DB creates wa_opt_outs with CHAR(10) primary key', async () => {
        const pool = makeMigPool({ exists: false });
        await migration.up(pool);
        const create = pool.calls.find(c => /CREATE TABLE wa_opt_outs/.test(c.s));
        expect(create).toBeDefined();
        expect(create.s).toMatch(/phone_key CHAR\(10\)/i);
        expect(create.s).toMatch(/PRIMARY KEY \(phone_key\)/i);
    });

    test('already-applied DB: no CREATE runs', async () => {
        const pool = makeMigPool({ exists: true });
        await migration.up(pool);
        expect(pool.calls.some(c => /CREATE TABLE/i.test(c.s))).toBe(false);
    });
});
