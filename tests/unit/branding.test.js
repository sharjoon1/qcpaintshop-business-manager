const { getBranding } = require('../../services/branding');

describe('getBranding', () => {
    test('maps settings rows into an object', async () => {
        const pool = {
            query: async () => [[
                { setting_key: 'business_name', setting_value: 'Quality Colours' },
                { setting_key: 'business_phone', setting_value: '7418831122' }
            ]]
        };
        const out = await getBranding(pool);
        expect(out.business_name).toBe('Quality Colours');
        expect(out.business_phone).toBe('7418831122');
    });

    test('returns {} when the query throws', async () => {
        const pool = { query: async () => { throw new Error('db down'); } };
        await expect(getBranding(pool)).resolves.toEqual({});
    });
});
