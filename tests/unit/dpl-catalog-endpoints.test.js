const { router, catalogZohoScopeSql } = require('../../routes/zoho');

describe('dpl-catalog endpoints registered on zoho router', () => {
    const has = (method, path) => router.stack.some(l => l.route && l.route.path === path && l.route.methods[method]);
    test('POST /items/dpl-catalog/:brand/build', () => {
        expect(has('post', '/items/dpl-catalog/:brand/build')).toBe(true);
    });
    test('GET /items/dpl-catalog/:brand', () => {
        expect(has('get', '/items/dpl-catalog/:brand')).toBe(true);
    });
    test('POST /items/dpl-catalog/entry/:id/confirm-link', () => {
        expect(has('post', '/items/dpl-catalog/entry/:id/confirm-link')).toBe(true);
    });
    test('POST /items/dpl-catalog/:brand/apply-prices', () => {
        expect(has('post', '/items/dpl-catalog/:brand/apply-prices')).toBe(true);
    });
    test('POST /items/dpl-catalog/:brand/push', () => {
        expect(has('post', '/items/dpl-catalog/:brand/push')).toBe(true);
    });
    test('PUT /items/dpl-catalog/entry/:id', () => {
        expect(has('put', '/items/dpl-catalog/entry/:id')).toBe(true);
    });
    test('POST /items/dpl-catalog/entry/:id/not-in-zoho', () => {
        expect(has('post', '/items/dpl-catalog/entry/:id/not-in-zoho')).toBe(true);
    });
});

describe('catalogZohoScopeSql', () => {
    test('birlaopus → tolerant BIRLA scope (brand OR name)', () => {
        const s = catalogZohoScopeSql('birlaopus');
        expect(s).toMatch(/AND \(/);
        expect(s.toUpperCase()).toContain('BIRLA');
        expect(s.toUpperCase()).toContain('ZOHO_ITEM_NAME');
    });
    test('case-insensitive brand key', () => {
        expect(catalogZohoScopeSql('BirlaOpus')).toBe(catalogZohoScopeSql('birlaopus'));
    });
    test('unknown brand → empty string (no scope)', () => {
        expect(catalogZohoScopeSql('asianpaints')).toBe('');
        expect(catalogZohoScopeSql('')).toBe('');
        expect(catalogZohoScopeSql(undefined)).toBe('');
    });
});
