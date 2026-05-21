describe('price-list route module', () => {
    test('exports router and setPool', () => {
        const mod = require('../../routes/price-list');
        expect(typeof mod.router).toBe('function');
        expect(typeof mod.setPool).toBe('function');
    });

    test('setPool stores pool without throwing', () => {
        const mod = require('../../routes/price-list');
        expect(() => mod.setPool({ query: jest.fn() })).not.toThrow();
    });
});
