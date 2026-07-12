/**
 * CM4 — Send-from session honored.
 *
 * Locks:
 *   1. parseSendFrom matrix — '' / null / undefined → null; numeric strings/ints
 *      parse; junk → NaN (caller rejects).
 *   2. validateSendFrom — null/0/-1 always pass; junk (NaN) fails; a positive id
 *      is validated against ACTIVE branches only.
 *   3. Engine processCampaign — the WhatsApp session, the hourly/daily limit
 *      reads, the send call, AND incrementSendingStat all key on
 *      send_from_branch_id when set (-1) and on branch_id when it is NULL.
 *   4. Route INSERT column-list content-contract (create + duplicate + PUT).
 *   5. Migration idempotency (MODIFY + mandatory NULL backfill; skip once
 *      already NULL-default; ADD on a fresh DB with no backfill).
 */

const fs = require('fs');
const path = require('path');

const waMarketing = require('../../routes/wa-marketing');
const engine = require('../../services/wa-campaign-engine');

// ─────────────────────────────────────────────────────────────────────────
//  1. parseSendFrom matrix
// ─────────────────────────────────────────────────────────────────────────

describe('parseSendFrom (CM4)', () => {
    test.each([
        ['', null],
        [null, null],
        [undefined, null],
    ])('%j → null (inherit branch)', (input, expected) => {
        expect(waMarketing.parseSendFrom(input)).toBe(expected);
    });

    test.each([
        [0, 0],
        ['0', 0],
        [-1, -1],
        ['-1', -1],
        [3, 3],
        ['3', 3],
    ])('%j → %s', (input, expected) => {
        expect(waMarketing.parseSendFrom(input)).toBe(expected);
    });

    test.each([['junk'], ['abc'], ['xyz']])('%j → NaN (invalid)', (input) => {
        expect(Number.isNaN(waMarketing.parseSendFrom(input))).toBe(true);
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  2. validateSendFrom
// ─────────────────────────────────────────────────────────────────────────

describe('validateSendFrom (CM4)', () => {
    function makeBranchPool(activeIds = []) {
        const set = new Set(activeIds);
        return {
            query: jest.fn(async (sql, params) => {
                if (/FROM branches WHERE id = \? AND status = 'active'/i.test(String(sql))) {
                    return [set.has(params[0]) ? [{ id: params[0] }] : []];
                }
                return [[]];
            }),
        };
    }

    test('null / 0 / -1 always pass without hitting the DB', async () => {
        const pool = makeBranchPool([]);
        waMarketing.setPool(pool);
        expect(await waMarketing.validateSendFrom(null)).toBe(true);
        expect(await waMarketing.validateSendFrom(0)).toBe(true);
        expect(await waMarketing.validateSendFrom(-1)).toBe(true);
        expect(pool.query).not.toHaveBeenCalled();
    });

    test('NaN (junk) is invalid', async () => {
        const pool = makeBranchPool([]);
        waMarketing.setPool(pool);
        expect(await waMarketing.validateSendFrom(NaN)).toBe(false);
        expect(pool.query).not.toHaveBeenCalled();
    });

    test('a positive id is validated against ACTIVE branches only', async () => {
        const pool = makeBranchPool([3]);
        waMarketing.setPool(pool);
        expect(await waMarketing.validateSendFrom(3)).toBe(true);   // active
        expect(await waMarketing.validateSendFrom(999)).toBe(false); // not active/missing
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  3. Engine processCampaign — session/limits/stats key on the sending session
// ─────────────────────────────────────────────────────────────────────────

describe('wa-campaign-engine processCampaign send-from routing (CM4)', () => {
    function makeEnginePool() {
        const calls = [];
        const pool = {
            calls,
            query: jest.fn(async (sql, params) => {
                const s = String(sql).replace(/\s+/g, ' ').trim();
                calls.push({ s, params });

                if (/FROM wa_marketing_settings/i.test(s)) {
                    // Minimal, deterministic delays (min==max==1s each → ~2s/lead).
                    return [[
                        { key: 'seen_delay_min', value: '1' },
                        { key: 'seen_delay_max', value: '1' },
                        { key: 'typing_delay_min', value: '1' },
                        { key: 'typing_delay_max', value: '1' },
                    ]];
                }
                // getHourlySent (has stat_hour)
                if (/FROM wa_sending_stats WHERE branch_id = \? AND stat_date = CURDATE\(\) AND stat_hour = \?/i.test(s)) {
                    return [[{ count: 0 }]];
                }
                // getDailySent (no stat_hour — ends at CURDATE())
                if (/FROM wa_sending_stats WHERE branch_id = \? AND stat_date = CURDATE\(\)$/i.test(s)) {
                    return [[{ count: 0 }]];
                }
                // next pending lead
                if (/FROM wa_campaign_leads wcl/i.test(s) && /status = 'pending'/.test(s)) {
                    return [[{
                        id: 101, lead_name: 'A', phone: '9876543210',
                        company: null, city: null, email: null, source: null,
                        lead_status: null, branch_name: null,
                    }]];
                }
                // consecutive-failure check (return one 'sent' → no auto-pause)
                if (/SELECT status FROM wa_campaign_leads WHERE campaign_id = \? AND status IN \('sent','failed'\)/i.test(s)) {
                    return [[{ status: 'sent' }]];
                }
                // ack read-back
                if (/SELECT status FROM whatsapp_messages/i.test(s)) {
                    return [[]];
                }
                return [{ affectedRows: 1 }];
            }),
        };
        return pool;
    }

    async function runWith(sendFrom) {
        const pool = makeEnginePool();
        engine.setPool(pool);
        await engine.loadSettings();
        const isConnected = jest.fn(() => true);
        const sendMessage = jest.fn(async () => ({ id: { _serialized: 'MID-1' } }));
        engine.setSessionManager({ isConnected, sendMessage });

        const campaign = {
            id: 9, branch_id: 5, send_from_branch_id: sendFrom,
            message_type: 'text', message_body: 'hi {name}', media_url: null,
            hourly_limit: 30, daily_limit: 200, warm_up_enabled: 0,
            min_delay_seconds: 30, max_delay_seconds: 90,
            sent_count: 0, failed_count: 0, total_leads: 1,
        };
        await engine.processCampaign(campaign);
        return { pool, isConnected, sendMessage };
    }

    function assertAllUse(expected, { pool, isConnected, sendMessage }) {
        // WhatsApp connection check
        expect(isConnected).toHaveBeenCalledWith(expected);
        // send call
        expect(sendMessage.mock.calls[0][0]).toBe(expected);
        // hourly limit read
        const hourly = pool.calls.find(c => /AND stat_hour = \?/.test(c.s) && /wa_sending_stats/.test(c.s));
        expect(hourly.params[0]).toBe(expected);
        // daily limit read
        const daily = pool.calls.find(c => /FROM wa_sending_stats WHERE branch_id = \? AND stat_date = CURDATE\(\)$/.test(c.s));
        expect(daily.params[0]).toBe(expected);
        // sending-stat write
        const stat = pool.calls.find(c => /INSERT INTO wa_sending_stats/i.test(c.s));
        expect(stat.params[0]).toBe(expected);
    }

    test('send_from = -1 → session, limits AND stats all key on -1 (not branch_id 5)', async () => {
        const ctx = await runWith(-1);
        assertAllUse(-1, ctx);
    }, 15000);

    test('send_from = NULL → everything inherits branch_id 5', async () => {
        const ctx = await runWith(null);
        assertAllUse(5, ctx);
    }, 15000);

    test('send_from = 0 (General) → everything keys on 0, not branch_id', async () => {
        const ctx = await runWith(0);
        assertAllUse(0, ctx);
    }, 15000);
});

// ─────────────────────────────────────────────────────────────────────────
//  4. Route INSERT column-list content-contract
// ─────────────────────────────────────────────────────────────────────────

describe('wa-marketing routes persist send_from_branch_id (CM4)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'wa-marketing.js'), 'utf8');

    test('create + duplicate INSERTs list send_from_branch_id right after branch_id', () => {
        const matches = src.match(/INSERT INTO wa_campaigns \(name, description, branch_id, send_from_branch_id,/g) || [];
        expect(matches.length).toBe(2); // create + duplicate
    });

    test('PUT update pushes a send_from_branch_id = ? assignment', () => {
        expect(src).toMatch(/updates\.push\('send_from_branch_id = \?'\)/);
    });

    test('create/PUT reject an invalid send-from with 400', () => {
        expect((src.match(/Invalid send-from session/g) || []).length).toBeGreaterThanOrEqual(2);
    });

    test('helpers are exported', () => {
        expect(typeof waMarketing.parseSendFrom).toBe('function');
        expect(typeof waMarketing.validateSendFrom).toBe('function');
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  5. Migration idempotency
// ─────────────────────────────────────────────────────────────────────────

describe('migration 20260713_wa_send_from_nullable (CM4)', () => {
    const migration = require('../../migrations/20260713_wa_send_from_nullable');

    function makeMigPool({ column }) {
        const calls = [];
        return {
            calls,
            query: jest.fn(async (sql, params) => {
                const s = String(sql).replace(/\s+/g, ' ').trim();
                calls.push({ s, params });
                if (/information_schema\.COLUMNS/i.test(s)) return [column ? [column] : []];
                return [{ affectedRows: 4 }];
            }),
        };
    }

    test('exports up()', () => expect(typeof migration.up).toBe('function'));

    test('present as INT DEFAULT 0 → MODIFY to NULL DEFAULT NULL + mandatory backfill', async () => {
        const pool = makeMigPool({ column: { COLUMN_TYPE: 'int(11)', IS_NULLABLE: 'YES', COLUMN_DEFAULT: '0' } });
        await migration.up(pool);
        expect(pool.calls.some(c => /MODIFY COLUMN send_from_branch_id INT NULL DEFAULT NULL/.test(c.s))).toBe(true);
        expect(pool.calls.some(c => /UPDATE wa_campaigns SET send_from_branch_id = NULL/.test(c.s))).toBe(true);
    });

    test('already NULLable with DEFAULT NULL → no MODIFY, no backfill', async () => {
        const pool = makeMigPool({ column: { COLUMN_TYPE: 'int(11)', IS_NULLABLE: 'YES', COLUMN_DEFAULT: null } });
        await migration.up(pool);
        expect(pool.calls.some(c => /MODIFY COLUMN/.test(c.s))).toBe(false);
        expect(pool.calls.some(c => /UPDATE wa_campaigns SET send_from_branch_id = NULL/.test(c.s))).toBe(false);
    });

    test("MariaDB 'NULL' string default is treated as already migrated", async () => {
        const pool = makeMigPool({ column: { COLUMN_TYPE: 'int(11)', IS_NULLABLE: 'YES', COLUMN_DEFAULT: 'NULL' } });
        await migration.up(pool);
        expect(pool.calls.some(c => /MODIFY COLUMN/.test(c.s))).toBe(false);
        expect(pool.calls.some(c => /UPDATE wa_campaigns SET/.test(c.s))).toBe(false);
    });

    test('missing column (fresh DB) → ADD COLUMN NULL DEFAULT NULL, no backfill', async () => {
        const pool = makeMigPool({ column: null });
        await migration.up(pool);
        expect(pool.calls.some(c => /ADD COLUMN send_from_branch_id INT NULL DEFAULT NULL/.test(c.s))).toBe(true);
        expect(pool.calls.some(c => /UPDATE wa_campaigns SET send_from_branch_id = NULL/.test(c.s))).toBe(false);
    });

    test('isNullDefault normalizes null, string NULL and quoted NULL', () => {
        expect(migration.isNullDefault(null)).toBe(true);
        expect(migration.isNullDefault('NULL')).toBe(true);
        expect(migration.isNullDefault("'NULL'")).toBe(true);
        expect(migration.isNullDefault('0')).toBe(false);
        expect(migration.isNullDefault("'0'")).toBe(false);
    });
});
