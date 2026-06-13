/**
 * logCreditViolation writes an audit row to credit_limit_violations using the
 * REAL prod columns. Regression guard: routes/painters/admin.js previously
 * inserted nonexistent columns (violation_type, invoice_amount) and omitted the
 * NOT NULL customer_id/attempted_amount → the INSERT threw on prod and the
 * (swallowed) failure meant painter-side credit violations were never recorded.
 */
const { logCreditViolation } = require('../../services/credit-violation-log');

const REAL_COLUMNS = [
    'customer_id', 'zoho_customer_map_id', 'invoice_number', 'attempted_amount',
    'credit_limit', 'credit_used', 'available_credit', 'staff_id', 'branch_id', 'action_taken'
];

function capturePool() {
    const calls = [];
    return { calls, query: async (sql, params) => { calls.push({ sql: String(sql), params }); return [{ insertId: 1 }]; } };
}

describe('logCreditViolation', () => {
    it('inserts using only the real prod columns (no violation_type / invoice_amount)', async () => {
        const pool = capturePool();
        await logCreditViolation(pool, {
            customerId: 7, zohoCustomerMapId: 42, invoiceNumber: 'INV-9',
            attemptedAmount: 5000, creditLimit: 10000, creditUsed: 8000,
            availableCredit: 2000, staffId: 55, branchId: 3, actionTaken: 'blocked'
        });
        const { sql, params } = pool.calls[0];
        expect(sql).toMatch(/INSERT INTO credit_limit_violations/);
        expect(sql).not.toMatch(/violation_type/);
        expect(sql).not.toMatch(/invoice_amount/);
        for (const col of REAL_COLUMNS) expect(sql).toContain(col);
        expect(params).toEqual([7, 42, 'INV-9', 5000, 10000, 8000, 2000, 55, 3, 'blocked']);
    });

    it('coerces missing optionals to safe defaults (customer_id 0, action blocked, nulls)', async () => {
        const pool = capturePool();
        await logCreditViolation(pool, { attemptedAmount: 1200, creditLimit: 0 });
        expect(pool.calls[0].params).toEqual([0, null, null, 1200, 0, 0, 0, null, null, 'blocked']);
    });
});
