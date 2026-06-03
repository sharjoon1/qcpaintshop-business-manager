const { router } = require('../../routes/zoho');

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
});
