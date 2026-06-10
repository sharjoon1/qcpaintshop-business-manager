/**
 * A12 — locks the OpenAPI generator's parsing contract against the live
 * route table. If a refactor changes how routes are registered (mount table,
 * router patterns), these assertions catch silent spec rot.
 */
const { generate, scanRoutes, toOpenApiPath } = require('../../scripts/generate-openapi');

describe('scanRoutes', () => {
    it('captures method, literal path and same-line auth middleware', () => {
        const src = "router.get('/me', requirePainterAuth, async (req, res) => {\n"
            + "router.post('/things/:id', requirePermission('things', 'edit'), h);\n";
        const { routes } = scanRoutes(src, ['router']);
        expect(routes).toHaveLength(2);
        expect(routes[0]).toMatchObject({ method: 'GET', path: '/me', auth: ['requirePainterAuth'] });
        expect(routes[1].auth).toContain('requirePermission');
        expect(routes[1].permission).toBe('things.edit');
    });

    it('is not confused by a blank line above the registration (the ^\\s* trap)', () => {
        const src = "\n\nrouter.get('/x', requireAuth, h);\n";
        const { routes } = scanRoutes(src, ['router']);
        expect(routes[0].auth).toEqual(['requireAuth']);
    });

    it('counts dynamic template paths as unparsed instead of guessing', () => {
        const { routes, unparsed } = scanRoutes('router.get(`/x/${v}`, h);\n', ['router']);
        expect(routes).toHaveLength(0);
        expect(unparsed).toBe(1);
    });
});

describe('toOpenApiPath', () => {
    it('converts :params to {params}', () => {
        expect(toOpenApiPath('/api/products/:id/image/:size')).toBe('/api/products/{id}/image/{size}');
    });
});

describe('generated spec (live route table)', () => {
    const doc = generate();

    it('covers the full route table (~1,026 operations per the 2026-06 report)', () => {
        expect(doc['x-stats'].operations).toBeGreaterThan(950);
        expect(Object.keys(doc.paths).length).toBeGreaterThan(800);
    });

    it('knows stable, load-bearing routes with their auth gates', () => {
        expect(doc.paths['/api/auth/login'].post['x-auth']).toEqual(['public']);
        expect(doc.paths['/api/painters/me'].get['x-auth']).toEqual(['requirePainterAuth']);
        expect(doc.paths['/api/products'].get['x-auth']).toEqual(['requireAuth']);
        expect(doc.paths['/api/customer/auth/me'].get['x-auth']).toContain('requireCustomerAuth');
    });

    it('converts path params and declares them', () => {
        const op = doc.paths['/api/products/{id}'].get;
        expect(op.parameters).toEqual([
            { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ]);
    });

    it('records permission requirements where declared inline', () => {
        const withPerm = Object.values(doc.paths)
            .flatMap(p => Object.values(p))
            .filter(op => op['x-permission']);
        expect(withPerm.length).toBeGreaterThan(400);
    });
});
