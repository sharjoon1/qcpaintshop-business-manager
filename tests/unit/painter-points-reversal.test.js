/**
 * Characterization tests for painter-points reversal on invoice void/delete
 * (services/painter-points-engine.js reverseInvoicePoints). Owner 2026-06-12:
 * voiding a painter invoice must reverse its points; resilient when the painter
 * has already spent them (deduct what's left + queue a clawback for the rest).
 * CLAUDE.md §6 — points are a money/correctness path.
 */
const engine = require('../../services/painter-points-engine');

// Mock pool: pool.query for the engine's direct reads/writes, pool.getConnection
// for deductPoints' transaction. `balances` tracks each painter's pools so the
// FOR UPDATE reads inside deductPoints see live numbers.
function makePool({ claims = [], referrals = [], balances = {} }) {
    const inserts = [];     // painter_point_transactions rows
    const clawbacks = [];   // painter_clawback_pending rows
    const conn = {
        beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
        query: async (sql, params) => {
            if (/FROM painters WHERE id = \? FOR UPDATE/.test(sql)) {
                const b = balances[params[0]] || { regular_points: 0, annual_points: 0 };
                return [[{ regular_points: b.regular_points, annual_points: b.annual_points }]];
            }
            if (/INSERT INTO painter_point_transactions/.test(sql)) { inserts.push(params); return [{ insertId: inserts.length }]; }
            if (/UPDATE painters SET/.test(sql)) {
                // params: [newBalance, amount, painterId] for deductPoints
                const newBal = params[0], pid = params[params.length - 1];
                const pool = /regular_points/.test(sql) ? 'regular_points' : 'annual_points';
                if (balances[pid]) balances[pid][pool] = newBal;
                return [{ affectedRows: 1 }];
            }
            return [[]];
        }
    };
    const pool = {
        inserts, clawbacks, balances,
        getConnection: async () => conn,
        query: async (sql, params) => {
            if (/FROM painter_invoices_processed WHERE invoice_id/.test(sql)) return [claims];
            if (/source = 'referral'/.test(sql)) return [referrals];
            if (/FROM painters WHERE id = \?/.test(sql) && !/FOR UPDATE/.test(sql)) {
                const b = balances[params[0]] || { regular_points: 0, annual_points: 0 };
                return [[{ regular_points: b.regular_points, annual_points: b.annual_points }]];
            }
            if (/INSERT INTO painter_clawback_pending/.test(sql)) { clawbacks.push(params); return [{ insertId: clawbacks.length }]; }
            if (/DELETE FROM painter_invoices_processed/.test(sql)) return [{ affectedRows: claims.length }];
            return [[]];
        }
    };
    return pool;
}

describe('reverseInvoicePoints', () => {
    it('reverses a painter\'s regular + annual award fully when the balance covers it', async () => {
        const pool = makePool({
            claims: [{ painter_id: 5, regular_points: 100, annual_points: 50 }],
            balances: { 5: { regular_points: 1000, annual_points: 500 } },
        });
        engine.setPool(pool);
        const r = await engine.reverseInvoicePoints('ZINV1', 99);
        expect(r.claims).toBe(1);
        expect(r.reversed[0].regular).toEqual({ deducted: 100, clawback: 0 });
        expect(r.reversed[0].annual).toEqual({ deducted: 50, clawback: 0 });
        // two debit ledger rows written (regular + annual)
        expect(pool.inserts.length).toBe(2);
        expect(pool.clawbacks.length).toBe(0);
    });

    it('deducts what is left and queues a clawback for the shortfall (regular pool)', async () => {
        const pool = makePool({
            claims: [{ painter_id: 7, regular_points: 100, annual_points: 0 }],
            balances: { 7: { regular_points: 60, annual_points: 0 } },
        });
        engine.setPool(pool);
        const r = await engine.reverseInvoicePoints('ZINV2', 99);
        expect(r.reversed[0].regular).toEqual({ deducted: 60, clawback: 40 });
        expect(pool.clawbacks.length).toBe(1);          // 40-point pending clawback queued
        expect(Number(pool.clawbacks[0][1])).toBe(40);  // amount
    });

    it('is a no-op when no award claim exists for the invoice', async () => {
        const pool = makePool({ claims: [], balances: {} });
        engine.setPool(pool);
        const r = await engine.reverseInvoicePoints('NONE', 99);
        expect(r.claims).toBe(0);
        expect(pool.inserts.length).toBe(0);
        expect(pool.clawbacks.length).toBe(0);
    });
});
