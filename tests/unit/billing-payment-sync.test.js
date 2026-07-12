/**
 * SP-1 C4 — per-payment Zoho sync engine
 * (services/billing-zoho-service.js forwardInvoicePayments / syncInvoicePaymentsToZoho).
 *
 * Money/correctness path. Locks the duplicate-proofing + clamp + guard contract:
 *   - N unsynced rows → N customerpayments, each with its own mode/date/reference,
 *   - real Zoho id stamped back per success,
 *   - atomic claim (affectedRows 0 → skip, zero POSTs),
 *   - adopt-before-create (matching reference → no POST),
 *   - balance clamp table {-5, 0, 0.01, 0.99, 1.01, 500} (NIT-1 ≤ ₹1 zone honored),
 *   - void → fail-soft, pending-approval → left NULL,
 *   - credit/LEGACY/real-id excluded at SQL level,
 *   - mode-shaped rejection → one retry as 'others',
 *   - a non-mode Zoho throw never rejects (engine returns a failed summary).
 *
 * Uses the SQL-substring-dispatching fake pool + jest.mock of ../../services/zoho-api
 * capturing payloads (template: tests/unit/billing-zoho-service.test.js).
 */

const mockGetInvoice = jest.fn();
const mockGetPayments = jest.fn();
const mockCreatePayment = jest.fn();
jest.mock('../../services/zoho-api', () => ({
    getInvoice: (...a) => mockGetInvoice(...a),
    getPayments: (...a) => mockGetPayments(...a),
    createPayment: (...a) => mockCreatePayment(...a),
    // stubs for exports billing-zoho-service references but these tests never hit
    createContact: jest.fn(),
    createInvoice: jest.fn(),
    finalizeDocument: jest.fn(),
    getDocumentStatus: jest.fn(),
}));

const svc = require('../../services/billing-zoho-service');

// A billing_payments candidate row (amounts arrive from mysql2 as strings).
function payRow(id, amount, method = 'cash', extra = {}) {
    return {
        id, invoice_id: 7, amount: String(amount), payment_method: method,
        payment_reference: '', payment_date: '2026-07-10', created_at: '2026-07-10 06:00:00',
        zoho_payment_id: null, zoho_claimed_at: null, ...extra,
    };
}

function goodInvoice(balance = 100000, extra = {}) {
    return { invoice: { invoice_id: 'ZINV1', customer_id: 'CONT1', status: 'sent', date: '2026-07-01', balance, ...extra } };
}

// Fake pool: `candidates` seeds the candidate SELECT; `claimAffected` maps
// payment id → the affectedRows the atomic claim UPDATE returns (default 1);
// `invoice` seeds the syncInvoicePaymentsToZoho invoice-load; `modeOverrides`
// seeds the ai_config zoho_payment_mode_map JSON.
function makeEnginePool({ candidates = [], claimAffected = null, invoice = undefined, modeOverrides = null } = {}) {
    const calls = [];
    return {
        calls,
        query: async (sql, params) => {
            const s = String(sql);
            calls.push({ sql: s, params });
            if (/FROM ai_config WHERE config_key = 'zoho_payment_mode_map'/.test(s)) {
                return [modeOverrides != null ? [{ config_value: JSON.stringify(modeOverrides) }] : []];
            }
            if (/FROM billing_invoices WHERE id/.test(s)) {
                return [invoice ? [invoice] : []];
            }
            if (/FROM billing_payments\s+WHERE invoice_id/.test(s)) {
                return [candidates.map(r => ({ ...r }))];
            }
            if (/SET zoho_payment_id = 'SYNCING'/.test(s)) {
                const id = params[0];
                const aff = (claimAffected && Object.prototype.hasOwnProperty.call(claimAffected, id)) ? claimAffected[id] : 1;
                return [{ affectedRows: aff }];
            }
            if (/UPDATE billing_payments/.test(s)) return [{ affectedRows: 1 }];
            return [[]];
        },
    };
}

let counter;
beforeEach(() => {
    counter = 0;
    mockGetInvoice.mockReset();
    mockGetPayments.mockReset();
    mockCreatePayment.mockReset();
    mockGetInvoice.mockResolvedValue(goodInvoice());
    mockGetPayments.mockResolvedValue({ customerpayments: [] });
    mockCreatePayment.mockImplementation(async () => ({ payment: { payment_id: `ZP${++counter}` } }));
    svc.setPointsEngine(null);
});

describe('forwardInvoicePayments — happy path', () => {
    it('forwards N unsynced rows as N customerpayments with per-row mode/date/reference', async () => {
        const candidates = [
            payRow(1, 100, 'cash'),
            payRow(2, 200, 'upi', { payment_date: '2026-07-11' }),
            payRow(3, 300, 'bank_transfer'),
        ];
        svc.setPool(makeEnginePool({ candidates }));
        const summary = await svc.forwardInvoicePayments({ invoiceId: 7, zohoInvoiceId: 'ZINV1' });

        expect(mockCreatePayment).toHaveBeenCalledTimes(3);
        const calls = mockCreatePayment.mock.calls.map(c => c[0]);
        expect(calls[0].reference_number).toBe('ACT-BP-1');
        expect(calls[0].payment_mode).toBe('cash');
        expect(calls[0].date).toBe('2026-07-10');
        expect(calls[0].customer_id).toBe('CONT1'); // from the Zoho invoice, NOT resolveZohoContact
        expect(calls[1].reference_number).toBe('ACT-BP-2');
        expect(calls[1].payment_mode).toBe('UPI');
        expect(calls[1].date).toBe('2026-07-11');
        expect(calls[2].reference_number).toBe('ACT-BP-3');
        expect(calls[2].payment_mode).toBe('banktransfer');
        expect(summary.synced).toBe(3);
        expect(summary.failed).toEqual([]);
    });

    it('stamps the returned Zoho payment id back onto each row on success', async () => {
        const candidates = [payRow(1, 100), payRow(2, 200)];
        const pool = makeEnginePool({ candidates });
        svc.setPool(pool);
        await svc.forwardInvoicePayments({ invoiceId: 7, zohoInvoiceId: 'ZINV1' });

        const stamps = pool.calls.filter(c => /UPDATE billing_payments SET zoho_payment_id = \?, zoho_sync_error = \? WHERE id = \? AND zoho_payment_id = 'SYNCING'/.test(c.sql));
        expect(stamps.length).toBe(2);
        expect(stamps[0].params).toEqual(['ZP1', null, 1]);
        expect(stamps[1].params).toEqual(['ZP2', null, 2]);
    });
});

describe('forwardInvoicePayments — duplicate proofing', () => {
    it('a lost claim (affectedRows 0) skips the row — no getPayments, no createPayment', async () => {
        const candidates = [payRow(1, 100)];
        const pool = makeEnginePool({ candidates, claimAffected: { 1: 0 } });
        svc.setPool(pool);
        const summary = await svc.forwardInvoicePayments({ invoiceId: 7, zohoInvoiceId: 'ZINV1' });

        expect(mockGetPayments).not.toHaveBeenCalled();
        expect(mockCreatePayment).not.toHaveBeenCalled();
        expect(summary.skipped).toBe(1);
        expect(summary.synced).toBe(0);
    });

    it('adopts an existing Zoho payment by reference — no createPayment', async () => {
        mockGetPayments.mockResolvedValue({ customerpayments: [{ payment_id: 'ZEXIST', reference_number: 'ACT-BP-5' }] });
        const candidates = [payRow(5, 100)];
        const pool = makeEnginePool({ candidates });
        svc.setPool(pool);
        const summary = await svc.forwardInvoicePayments({ invoiceId: 7, zohoInvoiceId: 'ZINV1' });

        expect(mockCreatePayment).not.toHaveBeenCalled();
        expect(summary.adopted).toBe(1);
        const adopt = pool.calls.find(c => /UPDATE billing_payments SET zoho_payment_id = \?, zoho_sync_error = NULL/.test(c.sql));
        expect(adopt.params).toEqual(['ZEXIST', 5]);
    });

    it('does NOT adopt when the returned reference does not exactly match', async () => {
        mockGetPayments.mockResolvedValue({ customerpayments: [{ payment_id: 'ZOTHER', reference_number: 'ACT-BP-55' }] });
        const candidates = [payRow(5, 100)];
        svc.setPool(makeEnginePool({ candidates }));
        const summary = await svc.forwardInvoicePayments({ invoiceId: 7, zohoInvoiceId: 'ZINV1' });
        expect(mockCreatePayment).toHaveBeenCalledTimes(1); // fell through to create
        expect(summary.synced).toBe(1);
    });

    it('excludes credit + LEGACY + already-synced rows at the SQL level', async () => {
        const pool = makeEnginePool({ candidates: [] });
        svc.setPool(pool);
        await svc.forwardInvoicePayments({ invoiceId: 7, zohoInvoiceId: 'ZINV1' });
        const sel = pool.calls.find(c => /FROM billing_payments\s+WHERE invoice_id/.test(c.sql));
        expect(sel).toBeTruthy();
        expect(sel.sql).toMatch(/payment_method != 'credit'/);
        expect(sel.sql).toMatch(/zoho_payment_id IS NULL OR \(zoho_payment_id = 'SYNCING'/);
        expect(sel.sql).toMatch(/deleted_at IS NULL/);
    });
});

describe('forwardInvoicePayments — balance clamp table (NIT-1 ≤ ₹1 zone honored)', () => {
    const cases = [
        { delta: -5, amount: 100, post: true, clamp: false },
        { delta: 0, amount: 100, post: true, clamp: false },
        { delta: 0.01, amount: 100, post: true, clamp: true },
        { delta: 0.99, amount: 100, post: true, clamp: true },
        { delta: 1.01, amount: 100, post: false, clamp: false },
        { delta: 500, amount: 600, post: false, clamp: false },
    ];
    for (const c of cases) {
        const label = c.post ? (c.clamp ? 'clamps then posts' : 'posts as-is') : 'fails soft, no post';
        it(`delta ${c.delta} → ${label}`, async () => {
            const balance = Math.round((c.amount - c.delta) * 100) / 100;
            mockGetInvoice.mockResolvedValue(goodInvoice(balance));
            const pool = makeEnginePool({ candidates: [payRow(1, c.amount)] });
            svc.setPool(pool);
            const summary = await svc.forwardInvoicePayments({ invoiceId: 7, zohoInvoiceId: 'ZINV1' });

            if (c.post) {
                expect(mockCreatePayment).toHaveBeenCalledTimes(1);
                const payload = mockCreatePayment.mock.calls[0][0];
                if (c.clamp) {
                    expect(payload.amount).toBe(balance);
                    expect(payload.invoices[0].amount_applied).toBe(balance);
                    expect(payload.description).toMatch(/clamped by/);
                } else {
                    expect(payload.amount).toBe(c.amount);
                }
                expect(summary.synced).toBe(1);
                expect(summary.failed).toEqual([]);
            } else {
                expect(mockCreatePayment).not.toHaveBeenCalled();
                expect(summary.synced).toBe(0);
                expect(summary.failed.length).toBe(1);
                expect(summary.failed[0].message).toMatch(/exceeds Zoho balance/);
            }
        });
    }
});

describe('forwardInvoicePayments — invoice status guards', () => {
    it('void invoice → zero createPayment, every candidate recorded as failed', async () => {
        mockGetInvoice.mockResolvedValue(goodInvoice(100000, { status: 'void' }));
        const pool = makeEnginePool({ candidates: [payRow(1, 100), payRow(2, 200)] });
        svc.setPool(pool);
        const summary = await svc.forwardInvoicePayments({ invoiceId: 7, zohoInvoiceId: 'ZINV1' });

        expect(mockCreatePayment).not.toHaveBeenCalled();
        expect(summary.failed.length).toBe(2);
        expect(summary.failed[0].message).toMatch(/void/);
        const errs = pool.calls.filter(c => /UPDATE billing_payments SET zoho_payment_id = NULL, zoho_sync_error/.test(c.sql));
        expect(errs.length).toBe(2);
        // never claimed
        expect(pool.calls.filter(c => /SET zoho_payment_id = 'SYNCING'/.test(c.sql)).length).toBe(0);
    });

    it('draft invoice → fail-soft (same as void), zero createPayment', async () => {
        mockGetInvoice.mockResolvedValue(goodInvoice(100000, { status: 'draft' }));
        svc.setPool(makeEnginePool({ candidates: [payRow(1, 100)] }));
        const summary = await svc.forwardInvoicePayments({ invoiceId: 7, zohoInvoiceId: 'ZINV1' });
        expect(mockCreatePayment).not.toHaveBeenCalled();
        expect(summary.failed.length).toBe(1);
    });

    it('missing invoice (getInvoice throws "does not exist") → fail-soft', async () => {
        mockGetInvoice.mockRejectedValue(new Error('Invalid value passed for invoice_id (1002 does not exist)'));
        svc.setPool(makeEnginePool({ candidates: [payRow(1, 100)] }));
        const summary = await svc.forwardInvoicePayments({ invoiceId: 7, zohoInvoiceId: 'ZINV1' });
        expect(mockCreatePayment).not.toHaveBeenCalled();
        expect(summary.failed.length).toBe(1);
        expect(summary.failed[0].message).toMatch(/not found/);
    });

    it('pending-approval status → pending, rows left NULL, no claim, no createPayment', async () => {
        mockGetInvoice.mockResolvedValue(goodInvoice(100000, { status: 'submitted' }));
        const pool = makeEnginePool({ candidates: [payRow(1, 100), payRow(2, 200)] });
        svc.setPool(pool);
        const summary = await svc.forwardInvoicePayments({ invoiceId: 7, zohoInvoiceId: 'ZINV1' });

        expect(mockCreatePayment).not.toHaveBeenCalled();
        expect(summary.pending).toBe(2);
        expect(summary.synced).toBe(0);
        expect(pool.calls.filter(c => /SET zoho_payment_id = 'SYNCING'/.test(c.sql)).length).toBe(0);
        const notes = pool.calls.filter(c => /SET zoho_sync_error = \? WHERE id = \?/.test(c.sql) && c.params[0] === 'awaiting Zoho approval');
        expect(notes.length).toBe(2);
    });
});

describe('forwardInvoicePayments — Zoho error handling', () => {
    it('a mode-shaped Zoho rejection retries ONCE with payment_mode "others"', async () => {
        mockCreatePayment
            .mockRejectedValueOnce(new Error('Invalid value passed for payment_mode'))
            .mockResolvedValueOnce({ payment: { payment_id: 'ZPX' } });
        svc.setPool(makeEnginePool({ candidates: [payRow(1, 100, 'upi')] }));
        const summary = await svc.forwardInvoicePayments({ invoiceId: 7, zohoInvoiceId: 'ZINV1' });

        expect(mockCreatePayment).toHaveBeenCalledTimes(2);
        expect(mockCreatePayment.mock.calls[0][0].payment_mode).toBe('UPI');
        expect(mockCreatePayment.mock.calls[1][0].payment_mode).toBe('others');
        expect(summary.synced).toBe(1);
    });

    it('a NON-mode createPayment rejection never throws — engine returns a failed summary', async () => {
        mockCreatePayment.mockRejectedValue(new Error('Zoho 500 internal error'));
        const pool = makeEnginePool({ candidates: [payRow(1, 100)] });
        svc.setPool(pool);
        const summary = await svc.forwardInvoicePayments({ invoiceId: 7, zohoInvoiceId: 'ZINV1' });

        expect(mockCreatePayment).toHaveBeenCalledTimes(1); // no retry for a non-mode error
        expect(summary.failed.length).toBe(1);
        expect(summary.failed[0].payment_id).toBe(1);
        expect(summary.synced).toBe(0);
        const release = pool.calls.find(c => /UPDATE billing_payments SET zoho_payment_id = NULL, zoho_sync_error = \? WHERE id = \? AND zoho_payment_id = 'SYNCING'/.test(c.sql));
        expect(release).toBeTruthy();
    });
});

describe('syncInvoicePaymentsToZoho — gating', () => {
    it('throws INVOICE_NOT_PUSHED when the invoice is not pushed', async () => {
        svc.setPool(makeEnginePool({ invoice: { id: 7, zoho_status: 'pending', zoho_invoice_id: null } }));
        await expect(svc.syncInvoicePaymentsToZoho(7)).rejects.toMatchObject({ code: 'INVOICE_NOT_PUSHED' });
    });

    it('throws INVOICE_NOT_PUSHED when the invoice does not exist', async () => {
        svc.setPool(makeEnginePool({ invoice: null }));
        await expect(svc.syncInvoicePaymentsToZoho(7)).rejects.toMatchObject({ code: 'INVOICE_NOT_PUSHED' });
    });

    it('delegates to forwardInvoicePayments for a pushed invoice', async () => {
        const pool = makeEnginePool({
            invoice: { id: 7, zoho_status: 'pushed', zoho_invoice_id: 'ZINV1' },
            candidates: [payRow(1, 100)],
        });
        svc.setPool(pool);
        const summary = await svc.syncInvoicePaymentsToZoho(7);
        expect(mockGetInvoice).toHaveBeenCalledWith('ZINV1');
        expect(summary.synced).toBe(1);
    });
});
