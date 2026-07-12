/**
 * SP-1 C6 — admin payment reversal + shared recalc helpers (AR + AP).
 *
 * Money/correctness path. Characterization-first: the recalc helpers are a
 * faithful copy of the pre-C6 inline record-payment settlement math, extracted
 * so record AND reverse share one tested path. Locks:
 *   - recalc transitions (paid / partial / unpaid-on-zero), both AR + AP,
 *   - the re-SUM SQL excludes soft-deleted rows (deleted_at IS NULL),
 *   - the delete-refusal COUNT now carries deleted_at IS NULL (a fully-reversed
 *     invoice/bill counts 0 live payments → deletable again),
 *   - the reversal decision matrix (classifyPaymentReversal drives it):
 *       · local_only (NULL)        → zero Zoho calls, soft-delete proceeds,
 *       · legacy_manual ('LEGACY')  → zero Zoho calls, note flagged, proceeds,
 *       · zoho_delete_required real → deleteCustomer/VendorPayment then proceed,
 *       · 1002 / "does not exist"   → tolerated, local delete proceeds,
 *       · any other Zoho error      → throws ZOHO_DELETE_FAILED, NO local UPDATE,
 *       · in_flight ('SYNCING')     → throws SYNC_IN_FLIGHT, nothing touched,
 *   - zero pointsEngine interaction (mocked, asserted never called).
 *
 * Uses the SQL-substring-dispatching fake pool (template:
 * tests/unit/billing-payment-sync.test.js), with getConnection() for the
 * transaction, + jest.mock of ../../services/zoho-api. Route money-logic is
 * tested via its exported pure functions — NO supertest (paymentExceedsBalance
 * precedent). mysql2 DECIMALs arrive as strings.
 */

const mockDeleteCustomerPayment = jest.fn();
const mockDeleteVendorPayment = jest.fn();
jest.mock('../../services/zoho-api', () => ({
    deleteCustomerPayment: (...a) => mockDeleteCustomerPayment(...a),
    deleteVendorPayment: (...a) => mockDeleteVendorPayment(...a),
}));

const billing = require('../../routes/billing');
const vendors = require('../../routes/vendors');

// ── Fake pools ──────────────────────────────────────────────────────────────
// Both pool-level and connection-level queries share one `dispatch` so every
// query (incl. those issued inside the reversal transaction) lands in `calls`.

function makeArPool({ payment, sum = 0, grandTotal = 1000, count = 0 } = {}) {
    const calls = [];
    const dispatch = async (sql, params) => {
        const s = String(sql);
        calls.push({ sql: s, params });
        if (/SELECT \* FROM billing_payments WHERE id = \? AND deleted_at IS NULL/.test(s)) return [payment ? [payment] : []];
        if (/SUM\(amount\)[\s\S]*FROM billing_payments WHERE invoice_id/.test(s)) return [[{ total_paid: sum }]];
        if (/SELECT grand_total FROM billing_invoices/.test(s)) return [[{ grand_total: grandTotal }]];
        if (/COUNT\(\*\)[\s\S]*FROM billing_payments WHERE invoice_id/.test(s)) return [[{ c: count }]];
        return [{ affectedRows: 1 }];
    };
    const connection = {
        beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {},
        release: () => {}, query: dispatch,
    };
    return { calls, query: dispatch, getConnection: async () => connection };
}

function makeApPool({ payment, sum = 0, grandTotal = 1000, count = 0, billExists = true } = {}) {
    const calls = [];
    const dispatch = async (sql, params) => {
        const s = String(sql);
        calls.push({ sql: s, params });
        if (/SELECT \* FROM vendor_payments WHERE id = \? AND deleted_at IS NULL/.test(s)) return [payment ? [payment] : []];
        if (/SUM\(amount\)[\s\S]*FROM vendor_payments WHERE bill_id/.test(s)) return [[{ total_paid: sum }]];
        if (/SELECT grand_total FROM vendor_bills/.test(s)) return [billExists ? [{ grand_total: grandTotal }] : []];
        if (/COUNT\(\*\)[\s\S]*FROM vendor_payments WHERE bill_id/.test(s)) return [[{ c: count }]];
        return [{ affectedRows: 1 }];
    };
    const connection = {
        beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {},
        release: () => {}, query: dispatch,
    };
    return { calls, query: dispatch, getConnection: async () => connection };
}

const arRow = (o = {}) => ({ id: 5, invoice_id: 7, amount: '100.00', payment_method: 'cash', zoho_payment_id: null, ...o });
const apRow = (o = {}) => ({ id: 9, vendor_id: 3, bill_id: null, amount: '500.00', payment_method: 'cash', zoho_payment_id: null, ...o });

const hasSoftDelete = (calls, table) => calls.some(c => new RegExp(`UPDATE ${table} SET deleted_at = NOW\\(\\)`).test(c.sql));

beforeEach(() => {
    mockDeleteCustomerPayment.mockReset();
    mockDeleteVendorPayment.mockReset();
    mockDeleteCustomerPayment.mockResolvedValue({});
    mockDeleteVendorPayment.mockResolvedValue({});
});

// ─────────────────────────────────────────────────────────────────────────────
// AR recalc — recalcInvoicePaymentTotals
// ─────────────────────────────────────────────────────────────────────────────
describe('recalcInvoicePaymentTotals (AR) — re-SUM transitions', () => {
    it('full payment → paid, balance 0', async () => {
        const pool = makeArPool({ sum: 1000, grandTotal: 1000 });
        const r = await billing.recalcInvoicePaymentTotals(pool, 7);
        expect(r).toEqual({ totalPaid: 1000, balanceDue: 0, paymentStatus: 'paid' });
    });

    it('partial payment → partial with remaining balance', async () => {
        const pool = makeArPool({ sum: 400, grandTotal: 1000 });
        const r = await billing.recalcInvoicePaymentTotals(pool, 7);
        expect(r).toEqual({ totalPaid: 400, balanceDue: 600, paymentStatus: 'partial' });
    });

    it('re-SUM to 0 (full reversal) → unpaid, full balance (NEW C6 case)', async () => {
        const pool = makeArPool({ sum: 0, grandTotal: 1000 });
        const r = await billing.recalcInvoicePaymentTotals(pool, 7);
        expect(r).toEqual({ totalPaid: 0, balanceDue: 1000, paymentStatus: 'unpaid' });
    });

    it('keeps the 1-paisa tolerance (₹0.01 residue still paid)', async () => {
        const pool = makeArPool({ sum: 999.99, grandTotal: 1000 });
        const r = await billing.recalcInvoicePaymentTotals(pool, 7);
        expect(r.paymentStatus).toBe('paid');
    });

    it('the re-SUM excludes soft-deleted rows (deleted_at IS NULL in the SUM SQL)', async () => {
        const pool = makeArPool({ sum: 0, grandTotal: 1000 });
        await billing.recalcInvoicePaymentTotals(pool, 7);
        const sumCall = pool.calls.find(c => /SUM\(amount\)[\s\S]*FROM billing_payments WHERE invoice_id/.test(c.sql));
        expect(sumCall.sql).toMatch(/deleted_at IS NULL/);
    });

    it('writes amount_paid / balance_due / payment_status back to the header', async () => {
        const pool = makeArPool({ sum: 400, grandTotal: 1000 });
        await billing.recalcInvoicePaymentTotals(pool, 7);
        const upd = pool.calls.find(c => /UPDATE billing_invoices SET/.test(c.sql) && /amount_paid = \?/.test(c.sql));
        expect(upd.params).toEqual([400, 600, 'partial', 7]);
    });
});

describe('countLiveInvoicePayments (AR delete-refusal) — carries deleted_at IS NULL', () => {
    it('the COUNT SQL filters soft-deleted rows and returns the live count', async () => {
        const pool = makeArPool({ count: 2 });
        const n = await billing.countLiveInvoicePayments(pool, 7);
        expect(n).toBe(2);
        const c = pool.calls.find(x => /COUNT\(\*\)[\s\S]*FROM billing_payments WHERE invoice_id/.test(x.sql));
        expect(c.sql).toMatch(/deleted_at IS NULL/);
    });

    it('a fully-reversed invoice counts 0 live payments → deletable again', async () => {
        const pool = makeArPool({ count: 0 });
        expect(await billing.countLiveInvoicePayments(pool, 7)).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// AR reversal — reverseInvoicePayment
// ─────────────────────────────────────────────────────────────────────────────
describe('reverseInvoicePayment (AR) — decision matrix', () => {
    it('local_only (NULL id): zero Zoho calls, soft-delete + recalc proceed', async () => {
        const pool = makeArPool({ payment: arRow({ zoho_payment_id: null }), sum: 0, grandTotal: 1000 });
        billing.setPool(pool);
        const r = await billing.reverseInvoicePayment(5);
        expect(mockDeleteCustomerPayment).not.toHaveBeenCalled();
        expect(r.zohoDeleted).toBe(false);
        expect(r.legacyManual).toBe(false);
        expect(hasSoftDelete(pool.calls, 'billing_payments')).toBe(true);
        expect(r.recalced.paymentStatus).toBe('unpaid');
    });

    it("LEGACY: zero Zoho calls, legacyManual flagged, soft-delete proceeds", async () => {
        const pool = makeArPool({ payment: arRow({ zoho_payment_id: 'LEGACY' }), sum: 0, grandTotal: 1000 });
        billing.setPool(pool);
        const r = await billing.reverseInvoicePayment(5);
        expect(mockDeleteCustomerPayment).not.toHaveBeenCalled();
        expect(r.legacyManual).toBe(true);
        expect(r.zohoDeleted).toBe(false);
        expect(hasSoftDelete(pool.calls, 'billing_payments')).toBe(true);
    });

    it('real Zoho id: deletes in Zoho first, then soft-deletes locally', async () => {
        const pool = makeArPool({ payment: arRow({ zoho_payment_id: 'ZP123' }), sum: 0, grandTotal: 1000 });
        billing.setPool(pool);
        const r = await billing.reverseInvoicePayment(5);
        expect(mockDeleteCustomerPayment).toHaveBeenCalledWith('ZP123');
        expect(r.zohoDeleted).toBe(true);
        expect(hasSoftDelete(pool.calls, 'billing_payments')).toBe(true);
    });

    it('Zoho 1002 / "does not exist": tolerated, local delete proceeds', async () => {
        mockDeleteCustomerPayment.mockRejectedValue(new Error('The payment does not exist. (1002)'));
        const pool = makeArPool({ payment: arRow({ zoho_payment_id: 'ZPGONE' }), sum: 0, grandTotal: 1000 });
        billing.setPool(pool);
        const r = await billing.reverseInvoicePayment(5);
        expect(r.zohoDeleted).toBe(true);
        expect(hasSoftDelete(pool.calls, 'billing_payments')).toBe(true);
    });

    it('any other Zoho error: throws ZOHO_DELETE_FAILED and NO local UPDATE is captured', async () => {
        mockDeleteCustomerPayment.mockRejectedValue(new Error('Zoho 500 internal error'));
        const pool = makeArPool({ payment: arRow({ zoho_payment_id: 'ZP500' }) });
        billing.setPool(pool);
        await expect(billing.reverseInvoicePayment(5)).rejects.toMatchObject({ code: 'ZOHO_DELETE_FAILED' });
        expect(hasSoftDelete(pool.calls, 'billing_payments')).toBe(false);
    });

    it("in_flight ('SYNCING'): throws SYNC_IN_FLIGHT, no Zoho call, nothing touched", async () => {
        const pool = makeArPool({ payment: arRow({ zoho_payment_id: 'SYNCING' }) });
        billing.setPool(pool);
        await expect(billing.reverseInvoicePayment(5)).rejects.toMatchObject({ code: 'SYNC_IN_FLIGHT' });
        expect(mockDeleteCustomerPayment).not.toHaveBeenCalled();
        expect(hasSoftDelete(pool.calls, 'billing_payments')).toBe(false);
    });

    it('missing / already-reversed payment: throws NOT_FOUND', async () => {
        const pool = makeArPool({ payment: null });
        billing.setPool(pool);
        await expect(billing.reverseInvoicePayment(5)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('zero pointsEngine interaction (reversal never touches painter points)', async () => {
        const pointsMock = { reverseInvoicePoints: jest.fn(), awardInvoicePoints: jest.fn() };
        billing.setPointsEngine(pointsMock);
        const pool = makeArPool({ payment: arRow({ zoho_payment_id: 'ZP123' }), sum: 0, grandTotal: 1000 });
        billing.setPool(pool);
        await billing.reverseInvoicePayment(5);
        expect(pointsMock.reverseInvoicePoints).not.toHaveBeenCalled();
        expect(pointsMock.awardInvoicePoints).not.toHaveBeenCalled();
        billing.setPointsEngine(null);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// AP recalc — recalcBillPaymentTotals
// ─────────────────────────────────────────────────────────────────────────────
describe('recalcBillPaymentTotals (AP) — re-SUM transitions', () => {
    it('full payment → paid', async () => {
        const pool = makeApPool({ sum: 1000, grandTotal: 1000 });
        expect(await vendors.recalcBillPaymentTotals(pool, 4)).toEqual({ totalPaid: 1000, balanceDue: 0, paymentStatus: 'paid' });
    });

    it('partial payment → partial', async () => {
        const pool = makeApPool({ sum: 400, grandTotal: 1000 });
        expect(await vendors.recalcBillPaymentTotals(pool, 4)).toEqual({ totalPaid: 400, balanceDue: 600, paymentStatus: 'partial' });
    });

    it('re-SUM to 0 (full reversal) → unpaid', async () => {
        const pool = makeApPool({ sum: 0, grandTotal: 1000 });
        expect(await vendors.recalcBillPaymentTotals(pool, 4)).toEqual({ totalPaid: 0, balanceDue: 1000, paymentStatus: 'unpaid' });
    });

    it('the re-SUM excludes soft-deleted rows (deleted_at IS NULL in the SUM SQL)', async () => {
        const pool = makeApPool({ sum: 0, grandTotal: 1000 });
        await vendors.recalcBillPaymentTotals(pool, 4);
        const sumCall = pool.calls.find(c => /SUM\(amount\)[\s\S]*FROM vendor_payments WHERE bill_id/.test(c.sql));
        expect(sumCall.sql).toMatch(/deleted_at IS NULL/);
    });

    it('returns null when the bill row is gone (no header UPDATE)', async () => {
        const pool = makeApPool({ sum: 0, billExists: false });
        expect(await vendors.recalcBillPaymentTotals(pool, 4)).toBeNull();
        expect(pool.calls.some(c => /UPDATE vendor_bills SET/.test(c.sql))).toBe(false);
    });
});

describe('countLiveBillPayments (AP delete-refusal) — carries deleted_at IS NULL', () => {
    it('the COUNT SQL filters soft-deleted rows and returns the live count', async () => {
        const pool = makeApPool({ count: 3 });
        const n = await vendors.countLiveBillPayments(pool, 4);
        expect(n).toBe(3);
        const c = pool.calls.find(x => /COUNT\(\*\)[\s\S]*FROM vendor_payments WHERE bill_id/.test(x.sql));
        expect(c.sql).toMatch(/deleted_at IS NULL/);
    });

    it('a fully-reversed bill counts 0 live payments → deletable again', async () => {
        const pool = makeApPool({ count: 0 });
        expect(await vendors.countLiveBillPayments(pool, 4)).toBe(0);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// AP reversal — reverseVendorPayment
// ─────────────────────────────────────────────────────────────────────────────
describe('reverseVendorPayment (AP) — decision matrix', () => {
    it('local_only on-account (NULL id, no bill): zero Zoho calls, no bill recalc', async () => {
        const pool = makeApPool({ payment: apRow({ zoho_payment_id: null, bill_id: null }) });
        vendors.setPool(pool);
        const r = await vendors.reverseVendorPayment(9);
        expect(mockDeleteVendorPayment).not.toHaveBeenCalled();
        expect(r.recalced).toBeNull(); // on-account → no bill to re-SUM
        expect(hasSoftDelete(pool.calls, 'vendor_payments')).toBe(true);
        expect(pool.calls.some(c => /SUM\(amount\)[\s\S]*FROM vendor_payments WHERE bill_id/.test(c.sql))).toBe(false);
    });

    it('bill-linked local_only: soft-delete + bill recalc runs', async () => {
        const pool = makeApPool({ payment: apRow({ zoho_payment_id: null, bill_id: 4 }), sum: 0, grandTotal: 1000 });
        vendors.setPool(pool);
        const r = await vendors.reverseVendorPayment(9);
        expect(mockDeleteVendorPayment).not.toHaveBeenCalled();
        expect(r.recalced.paymentStatus).toBe('unpaid');
        expect(hasSoftDelete(pool.calls, 'vendor_payments')).toBe(true);
    });

    it("LEGACY: zero Zoho calls, legacyManual flagged", async () => {
        const pool = makeApPool({ payment: apRow({ zoho_payment_id: 'LEGACY', bill_id: 4 }), sum: 0, grandTotal: 1000 });
        vendors.setPool(pool);
        const r = await vendors.reverseVendorPayment(9);
        expect(mockDeleteVendorPayment).not.toHaveBeenCalled();
        expect(r.legacyManual).toBe(true);
        expect(hasSoftDelete(pool.calls, 'vendor_payments')).toBe(true);
    });

    it('real Zoho id: deletes in Zoho first, then soft-deletes locally', async () => {
        const pool = makeApPool({ payment: apRow({ zoho_payment_id: 'ZVP42', bill_id: 4 }), sum: 0, grandTotal: 1000 });
        vendors.setPool(pool);
        const r = await vendors.reverseVendorPayment(9);
        expect(mockDeleteVendorPayment).toHaveBeenCalledWith('ZVP42');
        expect(r.zohoDeleted).toBe(true);
        expect(hasSoftDelete(pool.calls, 'vendor_payments')).toBe(true);
    });

    it('Zoho 1002 / "does not exist": tolerated, local delete proceeds', async () => {
        mockDeleteVendorPayment.mockRejectedValue(new Error('This vendorpayment does not exist 1002'));
        const pool = makeApPool({ payment: apRow({ zoho_payment_id: 'ZVPGONE', bill_id: 4 }), sum: 0, grandTotal: 1000 });
        vendors.setPool(pool);
        const r = await vendors.reverseVendorPayment(9);
        expect(r.zohoDeleted).toBe(true);
        expect(hasSoftDelete(pool.calls, 'vendor_payments')).toBe(true);
    });

    it('any other Zoho error: throws ZOHO_DELETE_FAILED and NO local UPDATE is captured', async () => {
        mockDeleteVendorPayment.mockRejectedValue(new Error('Zoho 500 internal error'));
        const pool = makeApPool({ payment: apRow({ zoho_payment_id: 'ZVP500', bill_id: 4 }) });
        vendors.setPool(pool);
        await expect(vendors.reverseVendorPayment(9)).rejects.toMatchObject({ code: 'ZOHO_DELETE_FAILED' });
        expect(hasSoftDelete(pool.calls, 'vendor_payments')).toBe(false);
    });

    it("in_flight ('SYNCING'): throws SYNC_IN_FLIGHT, no Zoho call, nothing touched", async () => {
        const pool = makeApPool({ payment: apRow({ zoho_payment_id: 'SYNCING', bill_id: 4 }) });
        vendors.setPool(pool);
        await expect(vendors.reverseVendorPayment(9)).rejects.toMatchObject({ code: 'SYNC_IN_FLIGHT' });
        expect(mockDeleteVendorPayment).not.toHaveBeenCalled();
        expect(hasSoftDelete(pool.calls, 'vendor_payments')).toBe(false);
    });

    it('missing / already-reversed payment: throws NOT_FOUND', async () => {
        const pool = makeApPool({ payment: null });
        vendors.setPool(pool);
        await expect(vendors.reverseVendorPayment(9)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
});
