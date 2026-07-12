/**
 * SP-1 C5 — AP vendor payment → Zoho sync engine
 * (services/vendor-zoho-service.js pushVendorPaymentToZoho / syncBillPayments).
 *
 * Money/correctness path. Locks the AP twin of the AR duplicate-proofing +
 * clamp + guard contract:
 *   - on-account (no bill) payload omits bills[] + location, still posts,
 *   - bill-linked payload carries bills[] + the bill's location,
 *   - VENDOR_NOT_IN_ZOHO / BILL_NOT_PUSHED hard refusals (before any claim/POST),
 *   - already-synced (real id / LEGACY) + fresh-SYNCING + lost-claim skips,
 *   - stale-SYNCING reclaim adopts a matching Zoho payment before POSTing,
 *   - paid_through_account_id only when ai_config seeds it,
 *   - bill balance clamp (NIT-1 ≤ ₹1 zone honored; > ₹1 fails soft),
 *   - real Zoho id stamped back on success,
 *   - a mode-shaped Zoho rejection retries ONCE as 'others'.
 *
 * Uses the SQL-substring-dispatching fake pool + jest.mock of ../../services/zoho-api
 * capturing payloads (template: tests/unit/billing-payment-sync.test.js). The
 * zoho-payment-mapper is the REAL pure module (payload shape is under test).
 */

const mockGetVendorPayments = jest.fn();
const mockCreateVendorPayment = jest.fn();
const mockGetBill = jest.fn();
jest.mock('../../services/zoho-api', () => ({
    getVendorPayments: (...a) => mockGetVendorPayments(...a),
    createVendorPayment: (...a) => mockCreateVendorPayment(...a),
    getBill: (...a) => mockGetBill(...a),
}));

const svc = require('../../services/vendor-zoho-service');

// A vendor_payments row as the main JOIN load returns it (amounts arrive from
// mysql2 as strings; is_fresh_syncing is a DB-computed 1/0).
function payRow(overrides = {}) {
    return {
        id: 7, vendor_id: 3, bill_id: null, amount: '500.00', payment_method: 'cash',
        payment_reference: '', payment_date: '2026-07-12', created_at: '2026-07-12 06:00:00',
        zoho_payment_id: null,
        vendor_zoho_contact_id: 'VZ1',
        bill_zoho_status: null, bill_zoho_bill_id: null, bill_zoho_location_id: null,
        is_fresh_syncing: 0,
        ...overrides,
    };
}

// A bill-linked, ready-to-push payment.
function billPayRow(overrides = {}) {
    return payRow({
        bill_id: 9, bill_zoho_status: 'pushed', bill_zoho_bill_id: 'ZBILL1', bill_zoho_location_id: 'LOC5',
        ...overrides,
    });
}

// `payment` seeds the main JOIN load; `claimAffected` the atomic-claim UPDATE
// affectedRows (default 1); `paidThrough` the ai_config paid-through value;
// `modeOverrides` the zoho_payment_mode_map JSON; `syncCandidates` the
// syncBillPayments candidate id SELECT.
function makePool({ payment, claimAffected = 1, paidThrough = null, modeOverrides = null, syncCandidates = null } = {}) {
    const calls = [];
    return {
        calls,
        query: async (sql, params) => {
            const s = String(sql);
            calls.push({ sql: s, params });
            if (/FROM ai_config WHERE config_key = 'zoho_payment_mode_map'/.test(s)) {
                return [modeOverrides != null ? [{ config_value: JSON.stringify(modeOverrides) }] : []];
            }
            if (/FROM ai_config WHERE config_key = 'zoho_vendor_paid_through_account_id'/.test(s)) {
                return [paidThrough != null ? [{ config_value: paidThrough }] : []];
            }
            if (/FROM vendor_payments vp/.test(s)) {
                return [payment ? [{ ...payment }] : []];
            }
            if (/SELECT id FROM vendor_payments/.test(s)) {
                return [(syncCandidates || []).map(r => ({ ...r }))];
            }
            if (/SET zoho_payment_id = 'SYNCING'/.test(s)) {
                return [{ affectedRows: claimAffected }];
            }
            if (/UPDATE vendor_payments/.test(s)) return [{ affectedRows: 1 }];
            return [[]];
        },
    };
}

beforeEach(() => {
    mockGetVendorPayments.mockReset();
    mockCreateVendorPayment.mockReset();
    mockGetBill.mockReset();
    mockGetVendorPayments.mockResolvedValue({ vendorpayments: [] });
    mockCreateVendorPayment.mockResolvedValue({ vendorpayment: { payment_id: 'ZVP1' } });
    mockGetBill.mockResolvedValue({ bill: { bill_id: 'ZBILL1', status: 'open', balance: 100000 } });
});

describe('pushVendorPaymentToZoho — on-account (unapplied)', () => {
    it('omits bills[] + location, does NOT fetch a bill, and still posts', async () => {
        svc.setPool(makePool({ payment: payRow() }));
        const result = await svc.pushVendorPaymentToZoho(7);

        expect(mockCreateVendorPayment).toHaveBeenCalledTimes(1);
        const payload = mockCreateVendorPayment.mock.calls[0][0];
        expect(payload).not.toHaveProperty('bills');
        expect(payload).not.toHaveProperty('location_id');
        expect(payload.vendor_id).toBe('VZ1');
        expect(payload.reference_number).toBe('ACT-VP-7');
        expect(payload.payment_mode).toBe('cash');
        expect(payload.amount).toBe(500);
        expect(mockGetBill).not.toHaveBeenCalled();
        expect(result).toEqual({ zohoPaymentId: 'ZVP1' });
    });
});

describe('pushVendorPaymentToZoho — bill-linked', () => {
    it('includes bills[] (amount_applied) + the bill location and fetches the bill', async () => {
        svc.setPool(makePool({ payment: billPayRow() }));
        const result = await svc.pushVendorPaymentToZoho(7);

        const payload = mockCreateVendorPayment.mock.calls[0][0];
        expect(payload.bills).toEqual([{ bill_id: 'ZBILL1', amount_applied: 500 }]);
        expect(payload.location_id).toBe('LOC5');
        expect(mockGetBill).toHaveBeenCalledWith('ZBILL1');
        expect(result).toEqual({ zohoPaymentId: 'ZVP1' });
    });
});

describe('pushVendorPaymentToZoho — hard refusals (no claim, no POST)', () => {
    it('throws VENDOR_NOT_IN_ZOHO when the vendor has no zoho_contact_id', async () => {
        const pool = makePool({ payment: payRow({ vendor_zoho_contact_id: null }) });
        svc.setPool(pool);
        await expect(svc.pushVendorPaymentToZoho(7)).rejects.toMatchObject({ code: 'VENDOR_NOT_IN_ZOHO' });
        expect(mockCreateVendorPayment).not.toHaveBeenCalled();
        expect(pool.calls.some(c => /SET zoho_payment_id = 'SYNCING'/.test(c.sql))).toBe(false);
    });

    it('throws BILL_NOT_PUSHED when the linked bill has no zoho_status pushed', async () => {
        svc.setPool(makePool({ payment: billPayRow({ bill_zoho_status: 'pending' }) }));
        await expect(svc.pushVendorPaymentToZoho(7)).rejects.toMatchObject({ code: 'BILL_NOT_PUSHED' });
        expect(mockCreateVendorPayment).not.toHaveBeenCalled();
    });

    it('throws BILL_NOT_PUSHED when the linked bill is pushed but has no zoho_bill_id', async () => {
        svc.setPool(makePool({ payment: billPayRow({ bill_zoho_status: 'pushed', bill_zoho_bill_id: null }) }));
        await expect(svc.pushVendorPaymentToZoho(7)).rejects.toMatchObject({ code: 'BILL_NOT_PUSHED' });
        expect(mockCreateVendorPayment).not.toHaveBeenCalled();
    });
});

describe('pushVendorPaymentToZoho — sentinel + claim skips', () => {
    it('skips a payment already stamped with a real Zoho id (already_synced)', async () => {
        svc.setPool(makePool({ payment: payRow({ zoho_payment_id: 'ZVPREAL' }) }));
        const result = await svc.pushVendorPaymentToZoho(7);
        expect(result).toEqual({ skipped: 'already_synced' });
        expect(mockCreateVendorPayment).not.toHaveBeenCalled();
    });

    it('skips a LEGACY payment (already_synced) — never re-forwarded', async () => {
        svc.setPool(makePool({ payment: payRow({ zoho_payment_id: 'LEGACY' }) }));
        const result = await svc.pushVendorPaymentToZoho(7);
        expect(result).toEqual({ skipped: 'already_synced' });
        expect(mockCreateVendorPayment).not.toHaveBeenCalled();
    });

    it('skips a fresh SYNCING claim (in_flight) — another worker owns it', async () => {
        svc.setPool(makePool({ payment: payRow({ zoho_payment_id: 'SYNCING', is_fresh_syncing: 1 }) }));
        const result = await svc.pushVendorPaymentToZoho(7);
        expect(result).toEqual({ skipped: 'in_flight' });
        expect(mockCreateVendorPayment).not.toHaveBeenCalled();
    });

    it('skips as in_flight when the atomic claim loses the race (affectedRows 0)', async () => {
        svc.setPool(makePool({ payment: payRow(), claimAffected: 0 }));
        const result = await svc.pushVendorPaymentToZoho(7);
        expect(result).toEqual({ skipped: 'in_flight' });
        expect(mockGetVendorPayments).not.toHaveBeenCalled();
        expect(mockCreateVendorPayment).not.toHaveBeenCalled();
    });
});

describe('pushVendorPaymentToZoho — adopt-before-create', () => {
    it('a stale SYNCING row reclaims and ADOPTS a matching Zoho payment (no POST)', async () => {
        mockGetVendorPayments.mockResolvedValue({ vendorpayments: [{ payment_id: 'ZEXIST', reference_number: 'ACT-VP-7' }] });
        const pool = makePool({ payment: payRow({ zoho_payment_id: 'SYNCING', is_fresh_syncing: 0 }), claimAffected: 1 });
        svc.setPool(pool);
        const result = await svc.pushVendorPaymentToZoho(7);

        expect(mockCreateVendorPayment).not.toHaveBeenCalled();
        expect(result).toEqual({ adopted: true, zohoPaymentId: 'ZEXIST' });
        const adopt = pool.calls.find(c => /UPDATE vendor_payments SET zoho_payment_id = \?, zoho_sync_error = NULL/.test(c.sql));
        expect(adopt.params).toEqual(['ZEXIST', 7]);
    });

    it('does NOT adopt when the returned reference does not exactly match — falls through to create', async () => {
        mockGetVendorPayments.mockResolvedValue({ vendorpayments: [{ payment_id: 'ZOTHER', reference_number: 'ACT-VP-77' }] });
        svc.setPool(makePool({ payment: payRow() }));
        const result = await svc.pushVendorPaymentToZoho(7);
        expect(mockCreateVendorPayment).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ zohoPaymentId: 'ZVP1' });
    });
});

describe('pushVendorPaymentToZoho — paid_through_account_id (config-gated)', () => {
    it('includes paid_through_account_id only when ai_config has it', async () => {
        svc.setPool(makePool({ payment: payRow(), paidThrough: 'ACC-99' }));
        await svc.pushVendorPaymentToZoho(7);
        expect(mockCreateVendorPayment.mock.calls[0][0].paid_through_account_id).toBe('ACC-99');
    });

    it('omits paid_through_account_id when ai_config is unset', async () => {
        svc.setPool(makePool({ payment: payRow(), paidThrough: null }));
        await svc.pushVendorPaymentToZoho(7);
        expect(mockCreateVendorPayment.mock.calls[0][0]).not.toHaveProperty('paid_through_account_id');
    });
});

describe('pushVendorPaymentToZoho — bill balance clamp (NIT-1 ≤ ₹1 honored)', () => {
    it('delta ≤ 0: posts amount as-is (no clamp)', async () => {
        mockGetBill.mockResolvedValue({ bill: { bill_id: 'ZBILL1', status: 'open', balance: 600 } });
        svc.setPool(makePool({ payment: billPayRow() }));
        await svc.pushVendorPaymentToZoho(7);
        const payload = mockCreateVendorPayment.mock.calls[0][0];
        expect(payload.amount).toBe(500);
        expect(payload.bills[0].amount_applied).toBe(500);
    });

    it('0 < delta ≤ ₹1: clamps amount + amount_applied to the bill balance and records the clamp', async () => {
        mockGetBill.mockResolvedValue({ bill: { bill_id: 'ZBILL1', status: 'open', balance: 499.5 } });
        const pool = makePool({ payment: billPayRow() });
        svc.setPool(pool);
        const result = await svc.pushVendorPaymentToZoho(7);

        const payload = mockCreateVendorPayment.mock.calls[0][0];
        expect(payload.amount).toBe(499.5);
        expect(payload.bills[0].amount_applied).toBe(499.5);
        expect(payload.description).toMatch(/clamped by/);
        const stamp = pool.calls.find(c => /UPDATE vendor_payments SET zoho_payment_id = \?, zoho_sync_error = \?/.test(c.sql));
        expect(String(stamp.params[1])).toMatch(/clamped by/);
        expect(result).toEqual({ zohoPaymentId: 'ZVP1' });
    });

    it('delta > ₹1: fails soft (release + throw), no POST', async () => {
        mockGetBill.mockResolvedValue({ bill: { bill_id: 'ZBILL1', status: 'open', balance: 400 } });
        const pool = makePool({ payment: billPayRow() });
        svc.setPool(pool);
        await expect(svc.pushVendorPaymentToZoho(7)).rejects.toThrow(/exceeds Zoho bill balance/);
        expect(mockCreateVendorPayment).not.toHaveBeenCalled();
        const release = pool.calls.find(c => /UPDATE vendor_payments SET zoho_payment_id = NULL, zoho_sync_error = \?/.test(c.sql));
        expect(release).toBeTruthy();
    });

    it('void Zoho bill: releases the claim and throws, no POST', async () => {
        mockGetBill.mockResolvedValue({ bill: { bill_id: 'ZBILL1', status: 'void', balance: 500 } });
        const pool = makePool({ payment: billPayRow() });
        svc.setPool(pool);
        await expect(svc.pushVendorPaymentToZoho(7)).rejects.toThrow(/void/);
        expect(mockCreateVendorPayment).not.toHaveBeenCalled();
        expect(pool.calls.some(c => /SET zoho_payment_id = NULL, zoho_sync_error/.test(c.sql))).toBe(true);
    });
});

describe('pushVendorPaymentToZoho — stamp + Zoho error handling', () => {
    it('stamps the returned Zoho payment id back onto the row on success', async () => {
        mockCreateVendorPayment.mockResolvedValue({ vendorpayment: { payment_id: 'ZVP42' } });
        const pool = makePool({ payment: payRow() });
        svc.setPool(pool);
        const result = await svc.pushVendorPaymentToZoho(7);
        expect(result).toEqual({ zohoPaymentId: 'ZVP42' });
        const stamp = pool.calls.find(c => /UPDATE vendor_payments SET zoho_payment_id = \?, zoho_sync_error = \? WHERE id = \? AND zoho_payment_id = 'SYNCING'/.test(c.sql));
        expect(stamp.params).toEqual(['ZVP42', null, 7]);
    });

    it('a mode-shaped Zoho rejection retries ONCE with payment_mode "others"', async () => {
        mockCreateVendorPayment
            .mockRejectedValueOnce(new Error('Invalid value passed for payment_mode'))
            .mockResolvedValueOnce({ vendorpayment: { payment_id: 'ZVPX' } });
        svc.setPool(makePool({ payment: payRow({ payment_method: 'upi' }) }));
        const result = await svc.pushVendorPaymentToZoho(7);

        expect(mockCreateVendorPayment).toHaveBeenCalledTimes(2);
        expect(mockCreateVendorPayment.mock.calls[0][0].payment_mode).toBe('UPI');
        expect(mockCreateVendorPayment.mock.calls[1][0].payment_mode).toBe('others');
        expect(result).toEqual({ zohoPaymentId: 'ZVPX' });
    });

    it('a NON-mode createVendorPayment failure releases the row and throws (no retry)', async () => {
        mockCreateVendorPayment.mockRejectedValue(new Error('Zoho 500 internal error'));
        const pool = makePool({ payment: payRow() });
        svc.setPool(pool);
        await expect(svc.pushVendorPaymentToZoho(7)).rejects.toThrow(/500/);
        expect(mockCreateVendorPayment).toHaveBeenCalledTimes(1);
        const release = pool.calls.find(c => /UPDATE vendor_payments SET zoho_payment_id = NULL, zoho_sync_error = \? WHERE id = \? AND zoho_payment_id = 'SYNCING'/.test(c.sql));
        expect(release).toBeTruthy();
    });

    it('throws when the payment row is missing / soft-deleted', async () => {
        svc.setPool(makePool({ payment: null }));
        await expect(svc.pushVendorPaymentToZoho(7)).rejects.toThrow(/not found/);
    });
});

describe('resolveVendorPaidThroughAccountId', () => {
    it('returns the trimmed config value when present', async () => {
        svc.setPool({ query: async () => [[{ config_value: '  ACC-1  ' }]] });
        expect(await svc.resolveVendorPaidThroughAccountId()).toBe('ACC-1');
    });
    it('returns null when the config key is unset', async () => {
        svc.setPool({ query: async () => [[]] });
        expect(await svc.resolveVendorPaidThroughAccountId()).toBeNull();
    });
    it('returns null on a query error (best-effort)', async () => {
        svc.setPool({ query: async () => { throw new Error('no table'); } });
        expect(await svc.resolveVendorPaidThroughAccountId()).toBeNull();
    });
});

describe('syncBillPayments', () => {
    it('loops the bill\'s pending payments and tallies synced', async () => {
        const pool = makePool({ payment: payRow(), syncCandidates: [{ id: 1 }, { id: 2 }] });
        svc.setPool(pool);
        const summary = await svc.syncBillPayments(9);
        expect(summary).toEqual({ synced: 2, failed: 0, skipped: 0 });
        expect(mockCreateVendorPayment).toHaveBeenCalledTimes(2);
    });

    it('counts a failed push in the summary (best-effort, never throws)', async () => {
        mockCreateVendorPayment.mockRejectedValue(new Error('Zoho 500'));
        const pool = makePool({ payment: payRow(), syncCandidates: [{ id: 1 }] });
        svc.setPool(pool);
        const summary = await svc.syncBillPayments(9);
        expect(summary).toEqual({ synced: 0, failed: 1, skipped: 0 });
    });

    it('returns an all-zero summary when there are no pending payments', async () => {
        svc.setPool(makePool({ payment: payRow(), syncCandidates: [] }));
        const summary = await svc.syncBillPayments(9);
        expect(summary).toEqual({ synced: 0, failed: 0, skipped: 0 });
        expect(mockCreateVendorPayment).not.toHaveBeenCalled();
    });
});
