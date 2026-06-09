/**
 * Characterization tests for the painter points engine money logic.
 *
 * Locks the CURRENT behavior of services/painter-points-engine.js — the
 * referral-tier table, the points ledger (addPoints / deductPoints), and the
 * clawback-netting rule — so any future change is a deliberate, visible diff.
 * These are money paths (CLAUDE.md §6): do NOT "fix" an assertion to a new value
 * without changing the engine and getting business sign-off.
 *
 * Pure node test (no DB): `pool` is mocked, including getConnection() for the
 * transactional add/deduct paths.
 */
const engine = require('../../services/painter-points-engine');

function makeConn(painterRow) {
    const calls = [];
    return {
        calls,
        beginTransaction: jest.fn(async () => {}),
        commit: jest.fn(async () => {}),
        rollback: jest.fn(async () => {}),
        release: jest.fn(() => {}),
        query: jest.fn(async (sql) => {
            calls.push([sql]);
            if (/FROM painters WHERE id = \? FOR UPDATE/i.test(sql)) return [[painterRow]];
            if (/INSERT INTO painter_point_transactions/i.test(sql)) return [{ insertId: 1 }];
            if (/UPDATE painters SET/i.test(sql)) return [{ affectedRows: 1 }];
            return [[]];
        }),
    };
}

function makePool({ painterRow = { regular_points: '0', annual_points: '0' }, pending = [] } = {}) {
    const conn = makeConn(painterRow);
    const poolCalls = [];
    return {
        conn,
        poolCalls,
        query: jest.fn(async (sql, params) => {
            poolCalls.push([sql, params]);
            if (/FROM painter_clawback_pending/i.test(sql)) return [pending];
            if (/UPDATE painter_clawback_pending/i.test(sql)) return [{ affectedRows: 1 }];
            return [[]];
        }),
        getConnection: jest.fn(async () => conn),
    };
}

const ledgerInsert = (conn) => conn.calls.find(c => /INSERT INTO painter_point_transactions/i.test(c[0]));

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

    it('clawback FULLY absorbs the credit: returns 0, settles clawback, no ledger/transaction', async () => {
        const pool = makePool({ pending: [{ id: 7, amount: 50 }] });
        engine.setPool(pool);
        const r = await engine.addPoints(1, 'regular', 50, 'test');
        expect(r).toBe(0);
        const settle = pool.poolCalls.find(c => /UPDATE painter_clawback_pending SET settled_at=NOW\(\)/i.test(c[0]));
        expect(settle).toBeTruthy();
        expect(pool.getConnection).not.toHaveBeenCalled(); // returns before opening a txn
    });

    it('clawback PARTIALLY absorbs (pending < credit): settles pending, awards the remainder', async () => {
        const pool = makePool({ painterRow: { regular_points: '0', annual_points: '0' }, pending: [{ id: 8, amount: 30 }] });
        engine.setPool(pool);
        const r = await engine.addPoints(1, 'regular', 50, 'test'); // 30 absorbed, 20 awarded
        expect(r).toBe(20);
        expect(pool.getConnection).toHaveBeenCalled();
    });

    it('clawback LARGER than credit: decrements the pending row, awards nothing', async () => {
        const pool = makePool({ pending: [{ id: 9, amount: 100 }] });
        engine.setPool(pool);
        const r = await engine.addPoints(1, 'regular', 40, 'test'); // 40 absorbed against the 100 pending
        expect(r).toBe(0);
        const dec = pool.poolCalls.find(c => /UPDATE painter_clawback_pending SET amount = amount - \?/i.test(c[0]));
        expect(dec).toBeTruthy();
        expect(dec[1]).toEqual([40, 9]);
    });

    it('annual pool bypasses clawback netting (clawbacks are regular-pool only)', async () => {
        const pool = makePool({ painterRow: { regular_points: '0', annual_points: '200' }, pending: [{ id: 1, amount: 999 }] });
        engine.setPool(pool);
        const newBal = await engine.addPoints(1, 'annual', 50, 'test');
        expect(newBal).toBe(250);
        const touchedClawback = pool.poolCalls.some(c => /painter_clawback_pending/i.test(c[0]));
        expect(touchedClawback).toBe(false);
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
