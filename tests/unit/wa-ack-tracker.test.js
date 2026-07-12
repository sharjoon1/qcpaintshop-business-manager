/**
 * CM2 — Delivered/Read tracking.
 *
 * Locks:
 *   1. wa-ack-tracker transition matrix (conditional UPDATEs, affectedRows-gated
 *      counters; idempotent + downgrade-proof).
 *   2. engine persistSentMsgId — msg-id persisted in the success UPDATE + ack-race
 *      read-back replays an early receipt.
 *   3. instant-send — a false send return is marked 'failed' (not mislabeled
 *      'sent'); the FINAL message id is persisted.
 *   4. migration idempotency (column + index add, status ENUM 'skipped' append).
 *   5. dashboard content-contract — Delivered/Read tiles + bindings.
 */

const path = require('path');
const fs = require('fs');

const { applyMarketingAck } = require('../../services/wa-ack-tracker');

// ─────────────────────────────────────────────────────────────────────────
//  Stateful fake pool that models one campaign lead + its campaign counters
//  + one instant row, so idempotency/downgrade behavior is actually exercised.
// ─────────────────────────────────────────────────────────────────────────

function makeAckPool({ leadStatus, msgId, instantStatus = null } = {}) {
    const lead = { msgId, status: leadStatus };
    const instant = { msgId, status: instantStatus };
    const campaign = { delivered_count: 0, read_count: 0 };
    const calls = [];

    const pool = {
        calls, lead, instant, campaign,
        query: jest.fn(async (sql, params) => {
            const s = String(sql).replace(/\s+/g, ' ').trim();
            calls.push({ s, params });
            const p0 = params && params[0];

            if (/^UPDATE wa_campaign_leads SET status = 'delivered'/.test(s)) {
                if (lead.msgId === p0 && lead.status === 'sent') { lead.status = 'delivered'; return [{ affectedRows: 1 }]; }
                return [{ affectedRows: 0 }];
            }
            if (/^UPDATE wa_campaign_leads SET status = 'read'/.test(s)) {
                if (lead.msgId === p0 && lead.status === 'delivered') { lead.status = 'read'; return [{ affectedRows: 1 }]; }
                return [{ affectedRows: 0 }];
            }
            if (/delivered_count = c\.delivered_count \+ 1/.test(s)) {
                if (lead.msgId === p0) campaign.delivered_count += 1;
                return [{ affectedRows: 1 }];
            }
            if (/read_count = c\.read_count \+ 1/.test(s)) {
                if (lead.msgId === p0) campaign.read_count += 1;
                return [{ affectedRows: 1 }];
            }
            if (/^UPDATE wa_instant_messages SET status = 'delivered'/.test(s)) {
                if (instant.msgId === p0 && instant.status === 'sent') { instant.status = 'delivered'; return [{ affectedRows: 1 }]; }
                return [{ affectedRows: 0 }];
            }
            if (/^UPDATE wa_instant_messages SET status = 'read'/.test(s)) {
                if (instant.msgId === p0 && instant.status === 'delivered') { instant.status = 'read'; return [{ affectedRows: 1 }]; }
                return [{ affectedRows: 0 }];
            }
            return [{ affectedRows: 0 }];
        }),
    };
    return pool;
}

beforeEach(() => jest.clearAllMocks());

describe('wa-ack-tracker applyMarketingAck — transition matrix (CM2)', () => {
    test('sent → delivered (ack 2): delivered_count bumps once, read untouched', async () => {
        const pool = makeAckPool({ leadStatus: 'sent', msgId: 'M1' });
        await applyMarketingAck(pool, 'M1', 2);
        expect(pool.lead.status).toBe('delivered');
        expect(pool.campaign.delivered_count).toBe(1);
        expect(pool.campaign.read_count).toBe(0);
    });

    test('sent → read (ack 3 skip): bumps BOTH delivered and read once', async () => {
        const pool = makeAckPool({ leadStatus: 'sent', msgId: 'M1' });
        await applyMarketingAck(pool, 'M1', 3);
        expect(pool.lead.status).toBe('read');
        expect(pool.campaign.delivered_count).toBe(1);
        expect(pool.campaign.read_count).toBe(1);
    });

    test('delivered → read (ack 3): bumps read only, not delivered', async () => {
        const pool = makeAckPool({ leadStatus: 'delivered', msgId: 'M1' });
        await applyMarketingAck(pool, 'M1', 3);
        expect(pool.lead.status).toBe('read');
        expect(pool.campaign.delivered_count).toBe(0);
        expect(pool.campaign.read_count).toBe(1);
    });

    test('repeat delivered ack is a no-op', async () => {
        const pool = makeAckPool({ leadStatus: 'delivered', msgId: 'M1' });
        await applyMarketingAck(pool, 'M1', 2);
        expect(pool.campaign.delivered_count).toBe(0);
        expect(pool.campaign.read_count).toBe(0);
        expect(pool.lead.status).toBe('delivered');
    });

    test('repeat read ack is a no-op', async () => {
        const pool = makeAckPool({ leadStatus: 'read', msgId: 'M1' });
        await applyMarketingAck(pool, 'M1', 3);
        expect(pool.campaign.delivered_count).toBe(0);
        expect(pool.campaign.read_count).toBe(0);
        expect(pool.lead.status).toBe('read');
    });

    test('unknown msg id is a no-op', async () => {
        const pool = makeAckPool({ leadStatus: 'sent', msgId: 'KNOWN' });
        await applyMarketingAck(pool, 'UNKNOWN', 3);
        expect(pool.lead.status).toBe('sent');
        expect(pool.campaign.delivered_count).toBe(0);
        expect(pool.campaign.read_count).toBe(0);
    });

    test('late delivered (ack 2) after read is a no-op — downgrade-proof', async () => {
        const pool = makeAckPool({ leadStatus: 'read', msgId: 'M1' });
        await applyMarketingAck(pool, 'M1', 2);
        expect(pool.lead.status).toBe('read');
        expect(pool.campaign.delivered_count).toBe(0);
        expect(pool.campaign.read_count).toBe(0);
    });

    test('ack < 2 does nothing (no queries)', async () => {
        const pool = makeAckPool({ leadStatus: 'sent', msgId: 'M1' });
        await applyMarketingAck(pool, 'M1', 1);
        expect(pool.query).not.toHaveBeenCalled();
    });

    test('missing pool / msgId is a safe no-op', async () => {
        await expect(applyMarketingAck(null, 'M1', 3)).resolves.toBeUndefined();
        const pool = makeAckPool({ leadStatus: 'sent', msgId: 'M1' });
        await applyMarketingAck(pool, '', 3);
        expect(pool.query).not.toHaveBeenCalled();
    });

    test('instant message row is mirrored (delivered→read) but never touches campaign counters', async () => {
        const pool = makeAckPool({ leadStatus: 'read', msgId: 'M1', instantStatus: 'sent' });
        await applyMarketingAck(pool, 'M1', 3);
        expect(pool.instant.status).toBe('read');
        // campaign counters stay 0 (lead was already 'read' — no campaign transition)
        expect(pool.campaign.delivered_count).toBe(0);
        expect(pool.campaign.read_count).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  Engine persistSentMsgId — msg-id persistence + ack-race read-back
// ─────────────────────────────────────────────────────────────────────────

describe('wa-campaign-engine persistSentMsgId (CM2)', () => {
    const engine = require('../../services/wa-campaign-engine');

    function makeEnginePool({ waMsgStatus = null } = {}) {
        const calls = [];
        const pool = {
            calls,
            query: jest.fn(async (sql, params) => {
                const s = String(sql).replace(/\s+/g, ' ').trim();
                calls.push({ s, params });
                if (/^SELECT status FROM whatsapp_messages/i.test(s)) {
                    return [waMsgStatus ? [{ status: waMsgStatus }] : []];
                }
                return [{ affectedRows: 1 }];
            }),
        };
        return pool;
    }

    test('persists whatsapp_msg_id in the success UPDATE + bumps sent_count', async () => {
        const pool = makeEnginePool({ waMsgStatus: null });
        engine.setPool(pool);
        await engine.persistSentMsgId(7, 42, 'hello', 'MSG-1');

        const upd = pool.calls.find(c => /UPDATE wa_campaign_leads SET status = 'sent'/.test(c.s));
        expect(upd).toBeDefined();
        expect(upd.s).toMatch(/whatsapp_msg_id = \?/);
        // params: [resolved_message, whatsapp_msg_id, leadId]
        expect(upd.params).toEqual(['hello', 'MSG-1', 42]);

        const bump = pool.calls.find(c => /UPDATE wa_campaigns SET sent_count = sent_count \+ 1/.test(c.s));
        expect(bump).toBeDefined();
        expect(bump.params).toEqual([7]);
    });

    test('read-back catch-up: an already-delivered receipt replays the delivered ack', async () => {
        const pool = makeEnginePool({ waMsgStatus: 'delivered' });
        engine.setPool(pool);
        await engine.persistSentMsgId(7, 42, 'hi', 'MSG-1');

        // read-back SELECT happened for that msg id
        const sel = pool.calls.find(c => /SELECT status FROM whatsapp_messages/i.test(c.s));
        expect(sel).toBeDefined();
        expect(sel.params).toEqual(['MSG-1']);

        // tracker replayed delivered (its conditional UPDATE ran)
        const delivered = pool.calls.find(c => /UPDATE wa_campaign_leads SET status = 'delivered'/.test(c.s));
        expect(delivered).toBeDefined();
        expect(delivered.params).toEqual(['MSG-1']);
        // but NOT read (status was only 'delivered')
        expect(pool.calls.find(c => /UPDATE wa_campaign_leads SET status = 'read'/.test(c.s))).toBeUndefined();
    });

    test('read-back catch-up: an already-read receipt replays the read ack (ack 3)', async () => {
        const pool = makeEnginePool({ waMsgStatus: 'read' });
        engine.setPool(pool);
        await engine.persistSentMsgId(7, 42, 'hi', 'MSG-1');
        expect(pool.calls.find(c => /UPDATE wa_campaign_leads SET status = 'read'/.test(c.s))).toBeDefined();
    });

    test('no receipt yet (status sent/null) → no read-back replay', async () => {
        const pool = makeEnginePool({ waMsgStatus: null });
        engine.setPool(pool);
        await engine.persistSentMsgId(7, 42, 'hi', 'MSG-1');
        expect(pool.calls.find(c => /UPDATE wa_campaign_leads SET status = 'delivered'/.test(c.s))).toBeUndefined();
    });

    test('null msg id (bare true send) persists NULL and skips the read-back SELECT', async () => {
        const pool = makeEnginePool();
        engine.setPool(pool);
        await engine.persistSentMsgId(7, 42, 'hi', null);

        const upd = pool.calls.find(c => /UPDATE wa_campaign_leads SET status = 'sent'/.test(c.s));
        expect(upd.params).toEqual(['hi', null, 42]);
        expect(pool.calls.find(c => /SELECT status FROM whatsapp_messages/i.test(c.s))).toBeUndefined();
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  Instant-send — false return marks 'failed', message id persisted
// ─────────────────────────────────────────────────────────────────────────

describe('wa-marketing processInstantBatch (CM2)', () => {
    const waMarketing = require('../../routes/wa-marketing');

    function makeInstantPool() {
        const calls = [];
        return {
            calls,
            query: jest.fn(async (sql, params) => {
                calls.push({ s: String(sql).replace(/\s+/g, ' ').trim(), params });
                return [{ affectedRows: 1 }];
            }),
        };
    }

    const RESOLVE_ENGINE = { resolveMessage: (t) => t };

    test('sendMessage returning false marks the row FAILED (was mislabeled sent)', async () => {
        const pool = makeInstantPool();
        waMarketing.setPool(pool);
        waMarketing.setCampaignEngine(RESOLVE_ENGINE);
        waMarketing.setSessionManager({ sendMessage: jest.fn(async () => false) });

        const lead = { id: 5, name: 'A', phone: '9876543210' };
        await waMarketing.processInstantBatch('B1', 1, 'hi', [lead], null, null, null, 99);

        const failed = pool.calls.find(c => /UPDATE wa_instant_messages SET status = 'failed'/.test(c.s));
        expect(failed).toBeDefined();
        const sent = pool.calls.find(c => /UPDATE wa_instant_messages SET status = 'sent'/.test(c.s));
        expect(sent).toBeUndefined();
    });

    test('successful text send persists status=sent + whatsapp_msg_id', async () => {
        const pool = makeInstantPool();
        waMarketing.setPool(pool);
        waMarketing.setCampaignEngine(RESOLVE_ENGINE);
        waMarketing.setSessionManager({
            sendMessage: jest.fn(async () => ({ id: { _serialized: 'TXT-1' } })),
        });

        const lead = { id: 6, name: 'B', phone: '9876543211' };
        await waMarketing.processInstantBatch('B2', 1, 'hi', [lead], null, null, null, 99);

        const sent = pool.calls.find(c => /UPDATE wa_instant_messages SET status = 'sent'/.test(c.s));
        expect(sent).toBeDefined();
        expect(sent.s).toMatch(/whatsapp_msg_id = \?/);
        // params: [whatsapp_msg_id, batch_id, lead_id]
        expect(sent.params).toEqual(['TXT-1', 'B2', 6]);
    });

    test('media + text: persists the FINAL (text) message id, not the media id', async () => {
        const pool = makeInstantPool();
        waMarketing.setPool(pool);
        waMarketing.setCampaignEngine(RESOLVE_ENGINE);
        waMarketing.setSessionManager({
            sendMedia: jest.fn(async () => ({ id: { _serialized: 'MEDIA-1' } })),
            sendMessage: jest.fn(async () => ({ id: { _serialized: 'TEXT-9' } })),
        });

        const lead = { id: 7, name: 'C', phone: '9876543212' };
        await waMarketing.processInstantBatch('B3', 1, 'hello text', [lead], '/uploads/x.jpg', 'image', null, 99);

        const sent = pool.calls.find(c => /UPDATE wa_instant_messages SET status = 'sent'/.test(c.s));
        expect(sent.params).toEqual(['TEXT-9', 'B3', 7]);
    }, 10000);
});

// ─────────────────────────────────────────────────────────────────────────
//  Migration idempotency
// ─────────────────────────────────────────────────────────────────────────

describe('migration 20260713_wa_delivery_tracking (CM2)', () => {
    const migration = require('../../migrations/20260713_wa_delivery_tracking');
    const STATUS_NO_SKIPPED = "enum('pending','sending','sent','delivered','read','failed')";
    const STATUS_WITH_SKIPPED = "enum('pending','sending','sent','delivered','read','failed','skipped')";

    function makeMigPool({ colPresent, idxPresent, statusType, statusDefault = "'pending'" }) {
        const calls = [];
        return {
            calls,
            query: jest.fn(async (sql, params) => {
                const s = String(sql).replace(/\s+/g, ' ').trim();
                calls.push({ s, params });
                const isColumns = /information_schema\.COLUMNS/i.test(s);
                if (isColumns && !/COLUMN_TYPE/.test(s)) return [colPresent ? [{ x: 1 }] : []];   // columnExists
                if (/information_schema\.STATISTICS/i.test(s)) return [idxPresent ? [{ x: 1 }] : []]; // indexExists
                if (isColumns && /COLUMN_TYPE/.test(s)) {
                    return [[{ COLUMN_TYPE: statusType, IS_NULLABLE: 'YES', COLUMN_DEFAULT: statusDefault }]];
                }
                return [[]];
            }),
        };
    }

    test('exports up()', () => {
        expect(typeof migration.up).toBe('function');
    });

    test('fresh DB: adds column + index on both tables, appends skipped at the END', async () => {
        const pool = makeMigPool({ colPresent: false, idxPresent: false, statusType: STATUS_NO_SKIPPED });
        await migration.up(pool);

        const addCols = pool.calls.filter(c => /ADD COLUMN whatsapp_msg_id VARCHAR\(100\) NULL/.test(c.s));
        expect(addCols.length).toBe(2);
        expect(pool.calls.some(c => /ALTER TABLE wa_campaign_leads ADD COLUMN whatsapp_msg_id/.test(c.s))).toBe(true);
        expect(pool.calls.some(c => /ALTER TABLE wa_instant_messages ADD COLUMN whatsapp_msg_id/.test(c.s))).toBe(true);

        const addKeys = pool.calls.filter(c => /ADD KEY idx_w(cl|im)_msgid \(whatsapp_msg_id\)/.test(c.s));
        expect(addKeys.length).toBe(2);

        const modify = pool.calls.find(c => /MODIFY COLUMN status/.test(c.s));
        expect(modify).toBeDefined();
        expect(modify.s).toContain("'failed','skipped')");
        expect(modify.s.endsWith("DEFAULT 'pending'")).toBe(true);
    });

    test('already-applied DB: no ALTER runs', async () => {
        const pool = makeMigPool({ colPresent: true, idxPresent: true, statusType: STATUS_WITH_SKIPPED });
        await migration.up(pool);
        expect(pool.calls.filter(c => /^ALTER TABLE/i.test(c.s)).length).toBe(0);
    });

    test("MariaDB 'NULL' string default never becomes DEFAULT 'NULL'", async () => {
        const pool = makeMigPool({ colPresent: true, idxPresent: true, statusType: STATUS_NO_SKIPPED, statusDefault: 'NULL' });
        await migration.up(pool);
        const modify = pool.calls.find(c => /MODIFY COLUMN status/.test(c.s));
        expect(modify.s).not.toContain("DEFAULT 'NULL'");
    });

    test('parseEnumValues round-trips the status enum', () => {
        expect(migration.parseEnumValues(STATUS_WITH_SKIPPED)).toContain('skipped');
        expect(migration.buildEnumType(['a', 'b'])).toBe("enum('a','b')");
    });
});

// ─────────────────────────────────────────────────────────────────────────
//  Dashboard content-contract — Delivered/Read tiles + bindings
// ─────────────────────────────────────────────────────────────────────────

describe('admin-wa-marketing.html Delivered/Read tiles (CM2)', () => {
    const html = fs.readFileSync(
        path.join(__dirname, '..', '..', 'public', 'admin-wa-marketing.html'),
        'utf8'
    );

    test('Delivered + Read tiles exist in the dashboard grid', () => {
        expect(html).toMatch(/id="statDelivered"/);
        expect(html).toMatch(/id="statRead"/);
        expect(html).toMatch(/>Delivered</);
        expect(html).toMatch(/>Read</);
    });

    test('loadDashboard binds the tiles to the API total_delivered / total_read', () => {
        expect(html).toMatch(/getElementById\('statDelivered'\)[^\n]*total_delivered/);
        expect(html).toMatch(/getElementById\('statRead'\)[^\n]*total_read/);
    });
});
