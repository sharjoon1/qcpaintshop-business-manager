// tests/unit/dpl-price-size.test.js
const { matchWithZohoItems } = require('../../services/price-list-parser');

// Helper: build a synthetic Zoho catalog row.
function zohoItem({ id, sku, name, rate, brand = 'Birla Opus', category = 'INTERIOR EMULSION' }) {
    return {
        zoho_item_id: id, sku, name, rate, brand, category,
        cf_dpl: 0, description: '', dpl_updated_at: null,
    };
}

describe('matchWithZohoItems — Birla Opus _prices rate-anchored expansion', () => {
    test('White base: 4 prices map to 1L/4L/10L/20L by ascending rate', () => {
        const parsed = [{
            brand: 'Birla Opus',
            product: 'Calista Ever Stay - White',
            _prices: [490, 1930, 4783, 9478],
            category: 'INTERIOR EMULSION',
            baseCode: '9900',
        }];
        const zoho = [
            zohoItem({ id: '1', sku: 'ESWT01', name: 'ESWT01 CALISTA EVER STAY BIRLA OPUS 01 L', rate: 635 }),
            zohoItem({ id: '2', sku: 'ESWT04', name: 'ESWT04 CALISTA EVER STAY BIRLA OPUS 04 L', rate: 2503 }),
            zohoItem({ id: '3', sku: 'ESWT10', name: 'ESWT10 CALISTA EVER STAY BIRLA OPUS 10 L', rate: 6203 }),
            zohoItem({ id: '4', sku: 'ESWT20', name: 'ESWT20 CALISTA EVER STAY BIRLA OPUS 20 L', rate: 12289 }),
        ];

        const { matched } = matchWithZohoItems(parsed, zoho);

        const byZohoId = Object.fromEntries(matched.map(m => [m.zoho_item_id, m]));
        expect(byZohoId['1'].dpl).toBe(490);
        expect(byZohoId['2'].dpl).toBe(1930);
        expect(byZohoId['3'].dpl).toBe(4783);
        expect(byZohoId['4'].dpl).toBe(9478);
        expect(byZohoId['1'].packSize).toBe('1L');
        expect(byZohoId['2'].packSize).toBe('4L');
        expect(byZohoId['3'].packSize).toBe('10L');
        expect(byZohoId['4'].packSize).toBe('20L');
    });

    test('Pastel base: 5 prices include 200ml as the smallest', () => {
        const parsed = [{
            brand: 'Birla Opus',
            product: 'Calista Ever Stay - Pastel',
            _prices: [104, 484, 1902, 4740, 9390],
            category: 'INTERIOR EMULSION',
            baseCode: '9901',
        }];
        const zoho = [
            zohoItem({ id: '1', sku: 'ES12M', name: 'ES12M CALISTA EVER STAY BIRLA OPUS 200 ML', rate: 135 }),
            zohoItem({ id: '2', sku: 'ES101', name: 'ES101 CALISTA EVER STAY BIRLA OPUS 01 L', rate: 628 }),
            zohoItem({ id: '3', sku: 'ES104', name: 'ES104 CALISTA EVER STAY BIRLA OPUS 04 L', rate: 2467 }),
            zohoItem({ id: '4', sku: 'ES110', name: 'ES110 CALISTA EVER STAY BIRLA OPUS 10 L', rate: 6149 }),
            zohoItem({ id: '5', sku: 'ES120', name: 'ES120 CALISTA EVER STAY BIRLA OPUS 20 L', rate: 12184 }),
        ];

        const { matched } = matchWithZohoItems(parsed, zoho);

        const byZohoId = Object.fromEntries(matched.map(m => [m.zoho_item_id, m]));
        expect(byZohoId['1'].dpl).toBe(104);
        expect(byZohoId['2'].dpl).toBe(484);
        expect(byZohoId['3'].dpl).toBe(1902);
        expect(byZohoId['4'].dpl).toBe(4740);
        expect(byZohoId['5'].dpl).toBe(9390);
    });

    test('Clear base: 3 prices, larger Zoho sizes simply get no proposal', () => {
        const parsed = [{
            brand: 'Birla Opus',
            product: 'Calista Ever Stay - Clear',
            _prices: [91, 418, 1643],
            category: 'INTERIOR EMULSION',
            baseCode: '9999',
        }];
        const zoho = [
            zohoItem({ id: '1', sku: 'ES9912M', name: 'ES9912M CALISTA EVER STAY BIRLA OPUS 200 ML', rate: 118 }),
            zohoItem({ id: '2', sku: 'ES9901',  name: 'ES9901 CALISTA EVER STAY BIRLA OPUS 01 L',   rate: 541 }),
            zohoItem({ id: '3', sku: 'ES9904',  name: 'ES9904 CALISTA EVER STAY BIRLA OPUS 04 L',   rate: 2127 }),
            zohoItem({ id: '4', sku: 'ES9910',  name: 'ES9910 CALISTA EVER STAY BIRLA OPUS 10 L',   rate: 5276 }),
            zohoItem({ id: '5', sku: 'ES9920',  name: 'ES9920 CALISTA EVER STAY BIRLA OPUS 20 L',   rate: 10448 }),
        ];

        const { matched, unmatched } = matchWithZohoItems(parsed, zoho);

        const byZohoId = Object.fromEntries(matched.map(m => [m.zoho_item_id, m]));
        expect(byZohoId['1'].dpl).toBe(91);
        expect(byZohoId['2'].dpl).toBe(418);
        expect(byZohoId['3'].dpl).toBe(1643);
        expect(byZohoId['4']).toBeUndefined();
        expect(byZohoId['5']).toBeUndefined();
        expect(unmatched.filter(u => u.product.includes('Ever Stay - Clear'))).toHaveLength(0);
    });

    test('Flat row pass-through: item without _prices still matches by name + packSize', () => {
        const parsed = [{
            brand: 'Birla Opus',
            product: 'Calista Sparkle - Blue',
            packSize: '1L',
            dpl: 150,
            category: 'ENAMEL',
        }];
        const zoho = [
            zohoItem({ id: '99', sku: 'CSTBL01', name: 'CSTBL01 CALISTA SPARKLE ENAMEL BLUE BIRLA OPUS 01 L', rate: 220, category: 'ENAMEL' }),
        ];

        const { matched } = matchWithZohoItems(parsed, zoho);
        expect(matched).toHaveLength(1);
        expect(matched[0].zoho_item_id).toBe('99');
        expect(matched[0].dpl).toBe(150);
        expect(matched[0].packSize).toBe('1L');
    });

    test('Mixed batch: _prices item + flat item processed in one call', () => {
        const parsed = [
            {
                brand: 'Birla Opus',
                product: 'Calista Ever Stay - White',
                _prices: [490, 1930],
                category: 'INTERIOR EMULSION',
                baseCode: '9900',
            },
            {
                brand: 'Birla Opus',
                product: 'Calista Sparkle - Blue',
                packSize: '1L',
                dpl: 150,
                category: 'ENAMEL',
            },
        ];
        const zoho = [
            zohoItem({ id: '1', sku: 'ESWT01', name: 'ESWT01 CALISTA EVER STAY BIRLA OPUS 01 L', rate: 635 }),
            zohoItem({ id: '2', sku: 'ESWT04', name: 'ESWT04 CALISTA EVER STAY BIRLA OPUS 04 L', rate: 2503 }),
            zohoItem({ id: '99', sku: 'CSTBL01', name: 'CSTBL01 CALISTA SPARKLE ENAMEL BLUE BIRLA OPUS 01 L', rate: 220, category: 'ENAMEL' }),
        ];

        const { matched } = matchWithZohoItems(parsed, zoho);
        const byZohoId = Object.fromEntries(matched.map(m => [m.zoho_item_id, m]));
        expect(byZohoId['1'].dpl).toBe(490);
        expect(byZohoId['2'].dpl).toBe(1930);
        expect(byZohoId['99'].dpl).toBe(150);
    });
});
