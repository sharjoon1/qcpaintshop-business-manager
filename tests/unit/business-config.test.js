/**
 * SVC-037 — business-config UPI helper.
 * Locks the safe-fallback contract: defaults match the historical literals,
 * a missing pool or failing query never throws, blank config values are
 * ignored, and buildUpiUrl encodes the payee/note and fixes the amount.
 */

const { getUpiConfig, buildUpiUrl, UPI_DEFAULTS } = require('../../services/business-config');

describe('business-config UPI (SVC-037)', () => {
    test('buildUpiUrl encodes payee + note and fixes amount to 2dp', () => {
        const url = buildUpiUrl({ vpa: 'shop@bank', payee: 'Quality Colours' }, 1234.5, 'EST-7');
        expect(url).toBe('upi://pay?pa=shop@bank&pn=Quality%20Colours&am=1234.50&cu=INR&tn=EST-7');
    });

    test('buildUpiUrl treats a non-numeric amount as 0.00', () => {
        expect(buildUpiUrl({ vpa: 'x@y', payee: 'P' }, undefined, '')).toContain('am=0.00');
    });

    test('getUpiConfig returns defaults when no pool is given', async () => {
        expect(await getUpiConfig(null)).toEqual(UPI_DEFAULTS);
    });

    test('getUpiConfig falls back to defaults on query error', async () => {
        const pool = { query: async () => { throw new Error('no ai_config table'); } };
        expect(await getUpiConfig(pool)).toEqual(UPI_DEFAULTS);
    });

    test('getUpiConfig reads configured values and ignores blanks', async () => {
        const pool = {
            query: async () => [[
                { config_key: 'business_upi_vpa', config_value: 'newvpa@hdfc' },
                { config_key: 'business_upi_payee', config_value: '   ' }, // blank → keep default
            ]],
        };
        const cfg = await getUpiConfig(pool);
        expect(cfg.vpa).toBe('newvpa@hdfc');
        expect(cfg.payee).toBe(UPI_DEFAULTS.payee);
    });
});
