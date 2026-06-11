const { router, catalogZohoScopeSql } = require('../../routes/zoho');

describe('dpl-catalog endpoints registered on zoho router', () => {
    // routes/zoho is now a directory of sub-routers composed via router.use()
    // (A8b split), so walk nested router stacks too.
    const flatRoutes = (r) => r.stack.flatMap(l =>
        l.route ? [l.route] : (l.handle && Array.isArray(l.handle.stack) ? flatRoutes(l.handle) : []));
    const has = (method, path) => flatRoutes(router).some(rt => rt.path === path && rt.methods[method]);
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
    test('POST /items/zoho-item/:id/disposition', () => {
        expect(has('post', '/items/zoho-item/:id/disposition')).toBe(true);
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
