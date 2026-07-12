/**
 * Unit tests for the pure Zoho payment mapper (services/zoho-payment-mapper.js,
 * SP-1 C2). Locks: the full mode table (incl. credit→null, unknown→others),
 * ai_config override merge, IST date handling (incl. a late-evening UTC stamp
 * that rolls into the next IST day), minDate clamping, deterministic reference
 * numbers, on-account vs bill-linked vendor payloads, DECIMAL-string amount
 * coercion, and the reversal classification of the zoho_payment_id sentinel.
 */

const mapper = require('../../services/zoho-payment-mapper');

describe('mapPaymentModeToZoho — full mode table', () => {
    it.each([
        ['cash', 'cash'],
        ['upi', 'UPI'],
        ['bank_transfer', 'banktransfer'],
        ['cheque', 'check'],
    ])('maps %s → %s', (method, expected) => {
        expect(mapper.mapPaymentModeToZoho(method)).toBe(expected);
    });

    it('maps credit → null (never forwarded)', () => {
        expect(mapper.mapPaymentModeToZoho('credit')).toBeNull();
    });

    it('maps an unknown method → "others"', () => {
        expect(mapper.mapPaymentModeToZoho('wallet')).toBe('others');
        expect(mapper.mapPaymentModeToZoho(undefined)).toBe('others');
        expect(mapper.mapPaymentModeToZoho(null)).toBe('others');
    });

    it('applies an ai_config override over the default', () => {
        expect(mapper.mapPaymentModeToZoho('upi', { upi: 'gpay' })).toBe('gpay');
    });

    it('an override can add a new method mapping (unknown no longer → others)', () => {
        expect(mapper.mapPaymentModeToZoho('wallet', { wallet: 'others' })).toBe('others');
        expect(mapper.mapPaymentModeToZoho('wallet', { wallet: 'UPI' })).toBe('UPI');
    });

    it('an override can force a mode to null (do not forward)', () => {
        expect(mapper.mapPaymentModeToZoho('cheque', { cheque: null })).toBeNull();
    });

    it('the DEFAULT_MODE_MAP is exported and matches the owner spec', () => {
        expect(mapper.DEFAULT_MODE_MAP).toEqual({
            cash: 'cash', upi: 'UPI', bank_transfer: 'banktransfer', cheque: 'check', credit: null,
        });
    });
});

describe('loadModeOverrides — best-effort ai_config read', () => {
    it('parses the zoho_payment_mode_map JSON value', async () => {
        const pool = { query: async () => [[{ config_value: '{"upi":"gpay"}' }]] };
        expect(await mapper.loadModeOverrides(pool)).toEqual({ upi: 'gpay' });
    });

    it('returns {} when the config key is absent', async () => {
        const pool = { query: async () => [[]] };
        expect(await mapper.loadModeOverrides(pool)).toEqual({});
    });

    it('returns {} on invalid JSON (never throws)', async () => {
        const pool = { query: async () => [[{ config_value: 'not-json' }]] };
        expect(await mapper.loadModeOverrides(pool)).toEqual({});
    });

    it('returns {} when the query itself throws', async () => {
        const pool = { query: async () => { throw new Error('no table'); } };
        expect(await mapper.loadModeOverrides(pool)).toEqual({});
    });

    it('ignores a non-object JSON payload (e.g. an array)', async () => {
        const pool = { query: async () => [[{ config_value: '[1,2,3]' }]] };
        expect(await mapper.loadModeOverrides(pool)).toEqual({});
    });
});

describe('istDateString — Asia/Kolkata calendar date', () => {
    it('renders a mid-day UTC stamp on the same IST day', () => {
        expect(mapper.istDateString(new Date('2026-07-12T06:00:00Z'))).toBe('2026-07-12');
    });

    it('rolls a 20:45 UTC stamp into the NEXT IST day (+05:30)', () => {
        expect(mapper.istDateString(new Date('2026-07-12T20:45:00Z'))).toBe('2026-07-13');
    });

    it('accepts an ISO string as well as a Date', () => {
        expect(mapper.istDateString('2026-07-12T20:45:00Z')).toBe('2026-07-13');
    });

    it('returns null for empty / invalid input', () => {
        expect(mapper.istDateString(null)).toBeNull();
        expect(mapper.istDateString('')).toBeNull();
        expect(mapper.istDateString('nonsense')).toBeNull();
    });
});

describe('buildCustomerPaymentPayload (AR)', () => {
    const base = {
        zohoContactId: 'CONT-1',
        zohoInvoiceId: 'ZINV-1',
        payment: { id: 42, amount: '500.00', payment_method: 'upi', payment_reference: 'TXN9', payment_date: '2026-07-10' },
    };

    it('builds the customerpayment shape with a deterministic ACT-BP reference', () => {
        const p = mapper.buildCustomerPaymentPayload(base);
        expect(p).toEqual({
            customer_id: 'CONT-1',
            payment_mode: 'UPI',
            amount: 500,
            date: '2026-07-10',
            reference_number: 'ACT-BP-42',
            description: 'upi - TXN9',
            invoices: [{ invoice_id: 'ZINV-1', amount_applied: 500 }],
        });
    });

    it('coerces a mysql2 DECIMAL-string amount to a number (both amount and amount_applied)', () => {
        const p = mapper.buildCustomerPaymentPayload(base);
        expect(p.amount).toBe(500);
        expect(typeof p.amount).toBe('number');
        expect(p.invoices[0].amount_applied).toBe(500);
    });

    it('returns null for a credit payment (mode maps null → do not forward)', () => {
        const p = mapper.buildCustomerPaymentPayload({
            ...base, payment: { ...base.payment, payment_method: 'credit' },
        });
        expect(p).toBeNull();
    });

    it('falls back to the IST date of created_at when payment_date is absent', () => {
        const p = mapper.buildCustomerPaymentPayload({
            ...base,
            payment: { id: 7, amount: '100.00', payment_method: 'cash', created_at: new Date('2026-07-12T20:45:00Z') },
        });
        expect(p.date).toBe('2026-07-13');
        expect(p.reference_number).toBe('ACT-BP-7');
    });

    it('clamps the date UP to minDate when the payment date is earlier (Zoho rejects date < invoice date)', () => {
        const p = mapper.buildCustomerPaymentPayload({ ...base, minDate: '2026-07-15' });
        expect(p.date).toBe('2026-07-15');
    });

    it('does NOT lower the date to minDate when the payment date is already later', () => {
        const p = mapper.buildCustomerPaymentPayload({ ...base, minDate: '2026-07-01' });
        expect(p.date).toBe('2026-07-10');
    });

    it('description carries just the method when there is no reference', () => {
        const p = mapper.buildCustomerPaymentPayload({
            ...base, payment: { ...base.payment, payment_reference: null },
        });
        expect(p.description).toBe('upi');
    });
});

describe('buildVendorPaymentPayload (AP)', () => {
    const payment = { id: 9, amount: '1250.50', payment_method: 'bank_transfer', payment_reference: 'NEFT1', payment_date: '2026-07-11' };

    it('bill-linked payload includes bills[] and (when provided) paid_through + location', () => {
        const p = mapper.buildVendorPaymentPayload({
            zohoVendorId: 'VEN-1', zohoBillId: 'ZBILL-1', payment,
            paidThroughAccountId: 'ACCT-1', locationId: 'LOC-1',
        });
        expect(p).toEqual({
            vendor_id: 'VEN-1',
            payment_mode: 'banktransfer',
            amount: 1250.5,
            date: '2026-07-11',
            reference_number: 'ACT-VP-9',
            description: 'bank_transfer - NEFT1',
            bills: [{ bill_id: 'ZBILL-1', amount_applied: 1250.5 }],
            paid_through_account_id: 'ACCT-1',
            location_id: 'LOC-1',
        });
    });

    it('on-account payload omits bills, location and paid_through when not provided', () => {
        const p = mapper.buildVendorPaymentPayload({ zohoVendorId: 'VEN-1', payment });
        expect(p).not.toHaveProperty('bills');
        expect(p).not.toHaveProperty('location_id');
        expect(p).not.toHaveProperty('paid_through_account_id');
        expect(p.vendor_id).toBe('VEN-1');
        expect(p.reference_number).toBe('ACT-VP-9');
        expect(p.amount).toBe(1250.5);
    });

    it('includes paid_through but not location for an on-account payment when only paid_through is set', () => {
        const p = mapper.buildVendorPaymentPayload({ zohoVendorId: 'VEN-1', payment, paidThroughAccountId: 'ACCT-1' });
        expect(p.paid_through_account_id).toBe('ACCT-1');
        expect(p).not.toHaveProperty('location_id');
        expect(p).not.toHaveProperty('bills');
    });

    it('returns null for a credit vendor payment', () => {
        const p = mapper.buildVendorPaymentPayload({
            zohoVendorId: 'VEN-1', payment: { ...payment, payment_method: 'credit' },
        });
        expect(p).toBeNull();
    });
});

describe('classifyPaymentReversal — sentinel branches', () => {
    it('a real Zoho id requires a Zoho delete', () => {
        expect(mapper.classifyPaymentReversal('123456000000123')).toBe('zoho_delete_required');
    });
    it('LEGACY → manual adjustment in Zoho', () => {
        expect(mapper.classifyPaymentReversal('LEGACY')).toBe('legacy_manual');
    });
    it('SYNCING → in-flight', () => {
        expect(mapper.classifyPaymentReversal('SYNCING')).toBe('in_flight');
    });
    it('null / empty → local only (never reached Zoho)', () => {
        expect(mapper.classifyPaymentReversal(null)).toBe('local_only');
        expect(mapper.classifyPaymentReversal('')).toBe('local_only');
        expect(mapper.classifyPaymentReversal(undefined)).toBe('local_only');
    });
});
