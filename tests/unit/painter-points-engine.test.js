/**
 * Characterization tests for the painter points engine money logic.
 *
 * Locks the CURRENT behavior of services/painter-points-engine.js — the
 * referral-tier table, the points ledger (addPoints / deductPoints), the
 * clawback-netting rule, and the invoice-retry idempotency guards — so any
 * future change is a deliberate, visible diff.
 * These are money paths (CLAUDE.md §6): do NOT "fix" an assertion to a new value
 * without changing the engine and getting business sign-off.
 *
 * Clawback policy locked here (M2 / owner answer Q-B2, DECISIONS.md 2026-06-10):
 * netting runs INSIDE the award transaction, the full earn is always a visible
 * ledger row, and absorbed amounts get their own 'clawback' debit row whose id
 * is linked back via painter_clawback_pending.settled_ledger_id. The cached
 * balance nets the clawback; total_earned counts the full earn.
 *
 * Pure node test (no DB): `pool` is mocked, including getConnection() for the
 * transactional add/deduct paths.
 */
const engine = require('../../services/painter-points-engine');

function makeConn(painterRow, pending = []) {
    const calls = [];
    let nextLedgerId = 100; // 1st ledger INSERT → 100, 2nd → 101, ...
    return {
        calls,
        beginTransaction: jest.fn(async () => {}),
        commit: jest.fn(async () => {}),
        rollback: jest.fn(async () => {}),
        release: jest.fn(() => {}),
        query: jest.fn(async (sql, params) => {
            calls.push([sql, params]);
            if (/FROM painters WHERE id = \? FOR UPDATE/i.test(sql)) return [[painterRow]];
            if (/FROM painter_clawback_pending/i.test(sql)) return [pending];
            if (/INSERT INTO painter_point_transactions/i.test(sql)) return [{ insertId: nextLedgerId++ }];
            if (/UPDATE/i.test(sql)) return [{ affectedRows: 1 }];
            return [[]];
        }),
    };
}

function makePool({ painterRow = { regular_points: '0', annual_points: '0' }, pending = [] } = {}) {
    const conn = makeConn(painterRow, pending);
    const poolCalls = [];
    return {
        conn,
        poolCalls,
        query: jest.fn(async (sql, params) => {
            poolCalls.push([sql, params]);
            return [[]];
        }),
        getConnection: jest.fn(async () => conn),
    };
}

const ledgerInserts = (conn) => conn.calls.filter(c => /INSERT INTO painter_point_transactions/i.test(c[0]));
const ledgerInsert = (conn) => ledgerInserts(conn)[0];

describe('getReferralTier (locks referral bonus tiers)', () => {
    it.each([
        [0, 0.5], [1, 0.5], [2, 0.5],
        [3, 1.0], [4, 1.0],
        [5, 1.5], [9, 1.5],
        [10, 2.0], [100, 2.0],
    ])('totalBills=%i → tier %f', (bills, tier) => {
        expect(engine.getReferralTier(bills)).toBe(tier);
    });
});

describe('addPoints', () => {
    it('no-ops for non-positive amounts (returns undefined, touches nothing)', async () => {
        const pool = makePool();
        engine.setPool(pool);
        await expect(engine.addPoints(1, 'regular', 0, 'test')).resolves.toBeUndefined();
        await expect(engine.addPoints(1, 'regular', -5, 'test')).resolves.toBeUndefined();
        expect(pool.getConnection).not.toHaveBeenCalled();
    });

    it('plain credit: adds to balance, writes an "earn" ledger row, commits', async () => {
        const pool = makePool({ painterRow: { regular_points: '100', annual_points: '0' } });
        engine.setPool(pool);
        const newBal = await engine.addPoints(1, 'regular', 50, 'test', null, null, 'desc', null);
        expect(newBal).toBe(150);
        const ins = ledgerInsert(pool.conn);
        expect(ins).toBeTruthy();
        expect(pool.conn.commit).toHaveBeenCalled();
    });

    it('clawback FULLY absorbs the credit: net balance 0, visible earn + clawback ledger rows, pending settled with ledger link', async () => {
        const pool = makePool({ pending: [{ id: 7, amount: 50 }] });
        engine.setPool(pool);
        const r = await engine.addPoints(1, 'regular', 50, 'test');
        expect(r).toBe(0);
        const inserts = ledgerInserts(pool.conn);
        expect(inserts).toHaveLength(2);
        // earn row: full amount, balance_after BEFORE netting
        expect(inserts[0][1].slice(0, 4)).toEqual([1, 'regular', 50, 50]);
        // clawback debit row: -absorbed, balance_after AFTER netting
        expect(inserts[1][1].slice(0, 3)).toEqual([1, -50, 0]);
        // pending row settles linked to the DEBIT ledger entry (id 101), not the earn
        const settle = pool.conn.calls.find(c => /UPDATE painter_clawback_pending SET settled_at=NOW\(\), settled_ledger_id=\?/i.test(c[0]));
        expect(settle).toBeTruthy();
        expect(settle[1]).toEqual([101, [7]]);
        // cached balance nets the clawback; total_earned counts the FULL earn
        const balUpd = pool.conn.calls.find(c => /UPDATE painters SET regular_points/i.test(c[0]));
        expect(balUpd[1]).toEqual([0, 50, 1]);
        expect(pool.conn.commit).toHaveBeenCalled();
    });

    it('clawback PARTIALLY absorbs (pending < credit): settles pending, nets the remainder into the balance', async () => {
        const pool = makePool({ painterRow: { regular_points: '0', annual_points: '0' }, pending: [{ id: 8, amount: 30 }] });
        engine.setPool(pool);
        const r = await engine.addPoints(1, 'regular', 50, 'test'); // 30 absorbed, 20 kept
        expect(r).toBe(20);
        const inserts = ledgerInserts(pool.conn);
        expect(inserts).toHaveLength(2);
        expect(inserts[0][1].slice(0, 4)).toEqual([1, 'regular', 50, 50]); // full earn
        expect(inserts[1][1].slice(0, 3)).toEqual([1, -30, 20]);           // clawback debit
        const balUpd = pool.conn.calls.find(c => /UPDATE painters SET regular_points/i.test(c[0]));
        expect(balUpd[1]).toEqual([20, 50, 1]);
    });

    it('clawback LARGER than credit: decrements the pending row, net balance gains nothing', async () => {
        const pool = makePool({ pending: [{ id: 9, amount: 100 }] });
        engine.setPool(pool);
        const r = await engine.addPoints(1, 'regular', 40, 'test'); // 40 absorbed against the 100 pending
        expect(r).toBe(0);
        const inserts = ledgerInserts(pool.conn);
        expect(inserts).toHaveLength(2);
        expect(inserts[1][1].slice(0, 3)).toEqual([1, -40, 0]); // clawback debit for the absorbed part
        // partially-consumed pending row is decremented, NOT settled
        const dec = pool.conn.calls.find(c => /UPDATE painter_clawback_pending SET amount = amount - \?/i.test(c[0]));
        expect(dec).toBeTruthy();
        expect(dec[1]).toEqual([40, 9]);
        const settled = pool.conn.calls.find(c => /SET settled_at=NOW\(\)/i.test(c[0]));
        expect(settled).toBeUndefined();
        const balUpd = pool.conn.calls.find(c => /UPDATE painters SET regular_points/i.test(c[0]));
        expect(balUpd[1]).toEqual([0, 40, 1]);
    });

    it('annual pool bypasses clawback netting (clawbacks are regular-pool only)', async () => {
        const pool = makePool({ painterRow: { regular_points: '0', annual_points: '200' }, pending: [{ id: 1, amount: 999 }] });
        engine.setPool(pool);
        const newBal = await engine.addPoints(1, 'annual', 50, 'test');
        expect(newBal).toBe(250);
        const touchedClawback = [...pool.poolCalls, ...pool.conn.calls].some(c => /painter_clawback_pending/i.test(c[0]));
        expect(touchedClawback).toBe(false);
        expect(ledgerInserts(pool.conn)).toHaveLength(1); // earn row only, no clawback debit
    });
});

describe('deductPoints', () => {
    it('deducts and writes a negative ("debit") ledger row', async () => {
        const pool = makePool({ painterRow: { regular_points: '100', annual_points: '0' } });
        engine.setPool(pool);
        const newBal = await engine.deductPoints(1, 'regular', 30, 'withdrawal');
        expect(newBal).toBe(70);
        expect(pool.conn.commit).toHaveBeenCalled();
    });

    it('throws and rolls back on insufficient balance', async () => {
        const pool = makePool({ painterRow: { regular_points: '10', annual_points: '0' } });
        engine.setPool(pool);
        await expect(engine.deductPoints(1, 'regular', 50, 'withdrawal')).rejects.toThrow(/Insufficient/);
        expect(pool.conn.rollback).toHaveBeenCalled();
        expect(pool.conn.commit).not.toHaveBeenCalled();
    });
});

describe('processInvoice retry safety (M1)', () => {
    function makeInvoicePool(overrides = {}) {
        const calls = [];
        const conn = makeConn({ regular_points: '0', annual_points: '0' });
        return {
            calls,
            conn,
            query: jest.fn(async (sql, params) => {
                calls.push([sql, params]);
                if (/INSERT IGNORE INTO painter_invoices_processed/i.test(sql)) return [{ affectedRows: 1, insertId: 42 }];
                if (/DELETE FROM painter_invoices_processed/i.test(sql)) return [{ affectedRows: 1 }];
                for (const [pattern, result] of overrides.handlers || []) {
                    if (pattern.test(sql)) {
                        if (result instanceof Error) throw result;
                        return result;
                    }
                }
                return [[]];
            }),
            getConnection: jest.fn(async () => conn),
        };
    }

    it('releases the claim row (compensating DELETE) when awarding fails, and rethrows', async () => {
        const pool = makeInvoicePool({
            handlers: [[/FROM painter_product_point_rates/i, new Error('db gone')]],
        });
        engine.setPool(pool);
        await expect(engine.processInvoice(1, { invoice_id: 'INV9', total: 100, line_items: [] }, 'customer', null))
            .rejects.toThrow('db gone');
        const del = pool.calls.find(c => /DELETE FROM painter_invoices_processed WHERE id = \?/i.test(c[0]));
        expect(del).toBeTruthy();
        expect(del[1]).toEqual([42]); // the claim row inserted by THIS attempt
    });

    it('stamps the Zoho invoice link on the claim row when the caller provides it (M3)', async () => {
        const pool = makeInvoicePool({});
        engine.setPool(pool);
        await engine.processInvoice(1, { invoice_id: 'EST-5', zoho_invoice_id: 'Z-777', total: 100, line_items: [] }, 'self', null);
        const claim = pool.calls.find(c => /INSERT IGNORE INTO painter_invoices_processed/i.test(c[0]));
        expect(claim[0]).toMatch(/zoho_invoice_id/i);
        expect(claim[1]).toContain('Z-777');
        // and stays NULL when absent (confirm-payment path — paid by definition)
        const pool2 = makeInvoicePool({});
        engine.setPool(pool2);
        await engine.processInvoice(1, { invoice_id: 'EST-6', total: 100, line_items: [] }, 'self', null);
        const claim2 = pool2.calls.find(c => /INSERT IGNORE INTO painter_invoices_processed/i.test(c[0]));
        expect(claim2[1]).toContain(null);
    });

    it('skips an award whose earn ledger row already exists (idempotent retry)', async () => {
        const pool = makeInvoicePool({
            handlers: [
                [/FROM painter_product_point_rates/i,
                    [[{ item_id: 'ITM1', regular_points_per_unit: '10', annual_eligible: 0, annual_pct: 0 }]]],
                // guard: an 'earn' row from the previous (partially-committed) attempt
                [/SELECT id FROM painter_point_transactions[\s\S]*type = 'earn' LIMIT 1/i, [[{ id: 5 }]]],
            ],
        });
        engine.setPool(pool);
        const r = await engine.processInvoice(1, {
            invoice_id: 'INV1', total: 1000,
            line_items: [{ item_id: 'ITM1', quantity: 1, item_total: 1000 }],
        }, 'customer', null);
        expect(r.success).toBe(true);
        expect(pool.getConnection).not.toHaveBeenCalled(); // no addPoints ran — nothing double-awarded
        // claim row still updated with the recomputed totals
        const upd = pool.calls.find(c => /UPDATE painter_invoices_processed\s+SET regular_points/i.test(c[0]));
        expect(upd).toBeTruthy();
        expect(upd[1]).toEqual([10, 0, 0, 42]);
    });

    it('guards the referral award AND the total_bills tier bump together on retry', async () => {
        const pool = makeInvoicePool({
            handlers: [
                [/FROM painter_referrals/i, [[{ id: 3, referrer_id: 2, total_bills: 4, status: 'active' }]]],
                [/SELECT id FROM painter_point_transactions[\s\S]*type = 'earn' LIMIT 1/i, [[{ id: 6 }]]],
            ],
        });
        engine.setPool(pool);
        const r = await engine.processInvoice(1, { invoice_id: 'INV2', total: 500, line_items: [] }, 'customer', null);
        expect(r.success).toBe(true);
        expect(r.referralPoints).toBe(0);
        const refUpd = pool.calls.find(c => /UPDATE painter_referrals/i.test(c[0]));
        expect(refUpd).toBeUndefined(); // tier counter NOT bumped twice
        expect(pool.getConnection).not.toHaveBeenCalled();
    });
});

describe('checkOverdueCredits (M3/Q-B1)', () => {
    function makeCreditPool({ painter, oldestRows = [], connRow }) {
        const conn = makeConn(connRow || { regular_points: '0', annual_points: '0' });
        const calls = [];
        return {
            calls,
            conn,
            query: jest.fn(async (sql, params) => {
                calls.push([sql, params]);
                if (/painter_credit_overdue_days/i.test(sql)) return [[{ config_value: '30' }]];
                if (/FROM painters WHERE credit_enabled = 1/i.test(sql)) return [painter ? [painter] : []];
                if (/FROM painter_invoices_processed pip/i.test(sql)) return [oldestRows];
                return [{ affectedRows: 1 }];
            }),
            getConnection: jest.fn(async () => conn),
        };
    }

    it('counts ONLY unpaid self-billing invoices (joined to zoho_invoices balance) and clears stale overdue days', async () => {
        const pool = makeCreditPool({
            painter: { id: 1, credit_used: '500', regular_points: '100', annual_points: '50' },
            oldestRows: [], // everything paid
        });
        engine.setPool(pool);
        const r = await engine.checkOverdueCredits();
        expect(r.processed).toBe(0);
        const overdueSel = pool.calls.find(c => /FROM painter_invoices_processed pip/i.test(c[0]));
        // Zoho link resolves via zoho_invoice_id where stamped, else invoice_id
        // (the billing module passes the raw Zoho id AS invoice_id)
        expect(overdueSel[0]).toMatch(/ON zi\.zoho_invoice_id = COALESCE\(NULLIF\(pip\.zoho_invoice_id, ''\), pip\.invoice_id\)/i);
        expect(overdueSel[0]).toMatch(/pip\.billing_type = 'self'/i);
        expect(overdueSel[0]).toMatch(/zi\.balance > 0/i);
        // stale counter cleared, and no points were touched
        const reset = pool.calls.find(c => /SET credit_overdue_days = 0/i.test(c[0]));
        expect(reset).toBeTruthy();
        expect(pool.getConnection).not.toHaveBeenCalled();
    });

    it('auto-debit reduces credit_used by the amount actually debited (no repeat daily re-debits)', async () => {
        const pool = makeCreditPool({
            painter: { id: 1, credit_used: '500', regular_points: '100', annual_points: '50' },
            oldestRows: [{ invoice_date: '2026-04-01', days_overdue: 45 }],
            connRow: { regular_points: '100', annual_points: '50' },
        });
        engine.setPool(pool);
        const r = await engine.checkOverdueCredits();
        expect(r.processed).toBe(1);
        // 100 regular + 50 annual debited = 150 of the 500 exposure
        const cu = pool.calls.find(c => /SET credit_used = GREATEST\(0, credit_used - \?\)/i.test(c[0]));
        expect(cu).toBeTruthy();
        expect(cu[1]).toEqual([150, 1]);
    });

    it('within the grace window: records overdue days but debits nothing', async () => {
        const pool = makeCreditPool({
            painter: { id: 1, credit_used: '500', regular_points: '100', annual_points: '50' },
            oldestRows: [{ invoice_date: '2026-06-01', days_overdue: 9 }],
        });
        engine.setPool(pool);
        const r = await engine.checkOverdueCredits();
        expect(r.processed).toBe(0);
        const upd = pool.calls.find(c => /SET credit_overdue_days = \? WHERE/i.test(c[0]));
        expect(upd[1]).toEqual([9, 1]);
        expect(pool.getConnection).not.toHaveBeenCalled();
        const cu = pool.calls.find(c => /SET credit_used = GREATEST/i.test(c[0]));
        expect(cu).toBeUndefined();
    });
});

describe('slab evaluation dedup (M9/Q-B3)', () => {
    it('counts each underlying invoice once per painter per period (dedupe across attribution rows)', async () => {
        const conn = makeConn({ regular_points: '0', annual_points: '0' });
        const calls = [];
        const pool = {
            query: jest.fn(async (sql, params) => {
                calls.push([sql, params]);
                if (/FROM painter_value_slabs/i.test(sql)) {
                    return [[{ id: 1, min_amount: '1000', max_amount: null, bonus_points: '100', label: 'L1' }]];
                }
                if (/FROM painters WHERE status/i.test(sql)) return [[{ id: 7 }]];
                if (/FROM painter_slab_evaluations/i.test(sql)) return [[]];
                if (/SUM\(t\.invoice_total\)/i.test(sql)) return [[{ total: 5000 }]];
                return [{ affectedRows: 1 }];
            }),
            getConnection: jest.fn(async () => conn),
        };
        engine.setPool(pool);
        const r = await engine.evaluateMonthlySlabs('2026-05');
        expect(r.evaluated).toBe(1);
        const totalsQ = calls.find(c => /SUM\(t\.invoice_total\)/i.test(c[0]));
        expect(totalsQ).toBeTruthy();
        // dual-attribution rows share zoho_invoice_id; EST-* rows fall back to invoice_id
        expect(totalsQ[0]).toMatch(/GROUP BY COALESCE\(NULLIF\(zoho_invoice_id, ''\), invoice_id\)/i);
        expect(totalsQ[0]).toMatch(/MAX\(invoice_total\)/i);
        expect(totalsQ[1]).toEqual([7, '2026-05-01', '2026-05-31']);
    });
});

describe('checkPointsDrift (M5)', () => {
    it('reports painters whose cached balances disagree with the ledger SUM', async () => {
        const drifted = [{ id: 3, full_name: 'X', regular_points: '120', annual_points: '0', ledger_regular: 100, ledger_annual: 0 }];
        const pool = { query: jest.fn(async (sql) => /SUM\(CASE WHEN pool = 'regular'/i.test(sql) ? [drifted] : [[]]) };
        engine.setPool(pool);
        const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const r = await engine.checkPointsDrift();
        errSpy.mockRestore();
        expect(r.drifted).toBe(1);
        expect(r.painters[0].id).toBe(3);
        const sql = pool.query.mock.calls[0][0];
        expect(sql).toMatch(/ABS\(x\.regular_points - x\.ledger_regular\) > 0\.01/i);
        expect(sql).toMatch(/ABS\(x\.annual_points - x\.ledger_annual\) > 0\.01/i);
    });
});

describe('processInvoice daily-bonus cap (KN-P1-4)', () => {
    // Drives processInvoice down the daily-bonus path and captures the cap query.
    function makeBonusPool(captured) {
        const conn = makeConn({ regular_points: '0', annual_points: '0' });
        return {
            conn,
            query: jest.fn(async (sql, params) => {
                if (/INSERT IGNORE INTO painter_invoices_processed/i.test(sql)) return [{ affectedRows: 1, insertId: 1 }];
                if (/FROM painter_product_point_rates/i.test(sql)) {
                    return [[{ item_id: 'ITM1', regular_points_per_unit: '10', annual_eligible: 0, annual_pct: 0 }]];
                }
                if (/FROM ai_config/i.test(sql)) {
                    return [[
                        { config_key: 'painter_daily_bonus_product_id', config_value: 'PROD-BONUS' },
                        { config_key: 'painter_daily_bonus_multiplier', config_value: '2' },
                        { config_key: 'painter_daily_bonus_cap', config_value: '500' },
                    ]];
                }
                if (/FROM zoho_items_map/i.test(sql)) return [[{ product_id: 'PROD-BONUS' }]];
                if (/COALESCE\(SUM\(amount\)/i.test(sql) && /daily_bonus/i.test(sql)) {
                    captured.sql = sql;
                    captured.params = params;
                    return [[{ total: 0 }]];
                }
                return [[]];
            }),
            getConnection: jest.fn(async () => conn),
        };
    }

    it("counts today's daily-bonus rows by the painter's IST day (converts created_at to +05:30)", async () => {
        const captured = {};
        engine.setPool(makeBonusPool(captured));
        await engine.processInvoice(1, {
            invoice_id: 'INV1', invoice_number: 'INV-1', total: 1000,
            line_items: [{ item_id: 'ITM1', quantity: 1, item_total: 1000 }],
        }, 'customer', null);

        expect(captured.sql).toBeTruthy();
        // created_at is stored in UTC (DB session is forced to +00:00). A bare
        // DATE(created_at) leaks the per-day cap across the IST midnight boundary
        // (00:00–05:30 IST rows fall under the previous UTC date). The fix converts
        // created_at to IST before truncating to a calendar date.
        expect(captured.sql).toMatch(/CONVERT_TZ\(\s*created_at\s*,\s*'\+00:00'\s*,\s*'\+05:30'\s*\)/i);
    });
});
