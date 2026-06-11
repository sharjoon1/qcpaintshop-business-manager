/**
 * GST Reports — locks the report computation core.
 *
 * KEY INVARIANT (owner decision 2026-06-12, DECISIONS.md): the FILING report
 * always reflects actual sale values for every non-void invoice — the
 * gst_purchase flag and cost restatement exist ONLY in the internal
 * cost-analysis report.
 */
const { monthRange, isB2B, resolveCostRate, deriveTax, invoiceNumberRange } = require('../../routes/gst-reports');

describe('monthRange', () => {
    it('expands YYYY-MM to first/last day (leap-aware)', () => {
        expect(monthRange('2026-05')).toEqual(['2026-05-01', '2026-05-31']);
        expect(monthRange('2026-02')).toEqual(['2026-02-01', '2026-02-28']);
        expect(monthRange('2028-02')).toEqual(['2028-02-01', '2028-02-29']);
    });

    it('rejects malformed input', () => {
        expect(() => monthRange('2026-13')).toThrow();
        expect(() => monthRange('2026-5')).toThrow();
        expect(() => monthRange('')).toThrow();
        expect(() => monthRange("2026-05'; DROP TABLE x;--")).toThrow();
    });
});

describe('isB2B (GSTIN split)', () => {
    it('GSTIN present → B2B; blank/whitespace/null → B2C', () => {
        expect(isB2B('33AAAAA0000A1Z5')).toBe(true);
        expect(isB2B('')).toBe(false);
        expect(isB2B('   ')).toBe(false);
        expect(isB2B(null)).toBe(false);
        expect(isB2B(undefined)).toBe(false);
    });
});

describe('invoiceNumberRange (auditor completeness check)', () => {
    it('orders by the numeric suffix, not lexically', () => {
        const r = invoiceNumberRange(['INV-000101', 'INV-000099', 'INV-000100']);
        expect(r.count).toBe(3);
        expect(r.ranges).toEqual([{ prefix: 'INV-', first: 'INV-000099', last: 'INV-000101', count: 3 }]);
        // lexical would wrongly put INV-9 after INV-100
        expect(invoiceNumberRange(['INV-9', 'INV-100']).ranges[0])
            .toEqual({ prefix: 'INV-', first: 'INV-9', last: 'INV-100', count: 2 });
    });

    it('splits MIXED series into separate ranges (legacy INV-* vs current QCIN-*), largest first', () => {
        const r = invoiceNumberRange(['QCIN-000787', 'INV-000002', 'QCIN-001925', 'QCIN-000900']);
        expect(r.count).toBe(4);
        expect(r.ranges).toEqual([
            { prefix: 'QCIN-', first: 'QCIN-000787', last: 'QCIN-001925', count: 3 },
            { prefix: 'INV-', first: 'INV-000002', last: 'INV-000002', count: 1 },
        ]);
    });

    it('falls back to lexical within a series when numbers are not numeric-suffixed', () => {
        expect(invoiceNumberRange(['B/X', 'A/X']).ranges[0].first).toBe('A/X');
    });

    it('empty/blank-safe', () => {
        expect(invoiceNumberRange([])).toEqual({ count: 0, ranges: [] });
        expect(invoiceNumberRange([null, ' '])).toEqual({ count: 0, ranges: [] });
    });
});

describe('deriveTax (Zoho header sync stores only total)', () => {
    it('uses real sub_total/tax_total when the sync has them', () => {
        expect(deriveTax(1180, 1000, 180)).toEqual({ taxable: 1000, gst: 180, derived: false });
    });

    it('derives the split from the GST-inclusive total at 18% when both are 0', () => {
        const t = deriveTax(1180, 0, 0);
        expect(t).toEqual({ taxable: 1000, gst: 180, derived: true });
        // derived parts must reconcile back to the total
        expect(t.taxable + t.gst).toBeCloseTo(1180, 2);
    });

    it('zero/empty total stays zero', () => {
        expect(deriveTax(0, 0, 0)).toEqual({ taxable: 0, gst: 0, derived: true });
        expect(deriveTax(null, null, null)).toEqual({ taxable: 0, gst: 0, derived: true });
    });
});

describe('resolveCostRate (purchase-cost preference)', () => {
    it('prefers DPL when it parses to a positive number', () => {
        expect(resolveCostRate({ zoho_cf_dpl: '385.50', zoho_purchase_rate: '300', last_purchase_rate: '290' }))
            .toEqual({ rate: 385.5, source: 'dpl' });
    });

    it('falls back to zoho_purchase_rate, then last_purchase_rate', () => {
        expect(resolveCostRate({ zoho_cf_dpl: '', zoho_purchase_rate: '300', last_purchase_rate: '290' }))
            .toEqual({ rate: 300, source: 'purchase_rate' });
        expect(resolveCostRate({ zoho_cf_dpl: null, zoho_purchase_rate: '0', last_purchase_rate: '290' }))
            .toEqual({ rate: 290, source: 'last_purchase_rate' });
    });

    it('returns none when nothing usable — caller must list, not silently price at 0', () => {
        expect(resolveCostRate({ zoho_cf_dpl: 'N/A', zoho_purchase_rate: null, last_purchase_rate: '0' }))
            .toEqual({ rate: null, source: 'none' });
        expect(resolveCostRate({})).toEqual({ rate: null, source: 'none' });
    });

    it('rejects negative/garbage DPL strings instead of using them', () => {
        expect(resolveCostRate({ zoho_cf_dpl: '-5', zoho_purchase_rate: '120' }).source).toBe('purchase_rate');
    });
});
