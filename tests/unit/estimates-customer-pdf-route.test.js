const { router } = require('../../routes/estimates');

describe('customer estimate PDF route', () => {
    test('GET /customer/:id/pdf is registered', () => {
        const layer = router.stack.find(
            l => l.route && l.route.path === '/customer/:id/pdf' && l.route.methods.get
        );
        expect(layer).toBeTruthy();
    });
});
