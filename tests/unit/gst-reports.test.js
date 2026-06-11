/**
 * GST Reports — locks the report computation core.
 *
 * KEY INVARIANT (owner decision 2026-06-12, DECISIONS.md): the FILING report
 * always reflects actual sale values for every non-void invoice — the
 * gst_purchase flag and cost restatement exist ONLY in the internal
 * cost-analysis report.
 */
const { monthRange, isB2B, resolveCostRate } = require('../../routes/gst-reports');

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
