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

describe('matchWithZohoItems — overflow handling (PDF prices > Zoho family)', () => {
    test('5 prices, 4-size family: drops SMALLEST price (200ml not in Zoho)', () => {
        // Real-world Birla Opus Pastel emulsion: PDF lists 200ml/1L/4L/10L/20L,
        // but Zoho catalog only stocks 1L/4L/10L/20L (no 200ml SKU).
        const parsed = [{
            brand: 'Birla Opus',
            product: 'Calista Ever Stay - Pastel',
            _prices: [104, 484, 1902, 4740, 9390],
            category: 'INTERIOR EMULSION',
            baseCode: '9901',
        }];
        const zoho = [
            { zoho_item_id: '1', sku: 'ES101', name: 'ES101 CALISTA EVER STAY BIRLA OPUS 01 L', rate: 628,   brand: 'Birla Opus', category: 'INTERIOR EMULSION', cf_dpl: 0, description: '' },
            { zoho_item_id: '2', sku: 'ES104', name: 'ES104 CALISTA EVER STAY BIRLA OPUS 04 L', rate: 2467,  brand: 'Birla Opus', category: 'INTERIOR EMULSION', cf_dpl: 0, description: '' },
            { zoho_item_id: '3', sku: 'ES110', name: 'ES110 CALISTA EVER STAY BIRLA OPUS 10 L', rate: 6149,  brand: 'Birla Opus', category: 'INTERIOR EMULSION', cf_dpl: 0, description: '' },
            { zoho_item_id: '4', sku: 'ES120', name: 'ES120 CALISTA EVER STAY BIRLA OPUS 20 L', rate: 12184, brand: 'Birla Opus', category: 'INTERIOR EMULSION', cf_dpl: 0, description: '' },
        ];

        const { matched, unmatched } = matchWithZohoItems(parsed, zoho);

        const byZohoId = Object.fromEntries(matched.map(m => [m.zoho_item_id, m]));
        // The 4 LARGEST prices map to the 4 Zoho sizes ascending.
        expect(byZohoId['1'].dpl).toBe(484);   // 1L  <- was wrongly 104
        expect(byZohoId['2'].dpl).toBe(1902);  // 4L  <- was wrongly 484
        expect(byZohoId['3'].dpl).toBe(4740);  // 10L <- was wrongly 1902
        expect(byZohoId['4'].dpl).toBe(9390);  // 20L <- was wrongly 4740 (and 9390 was dropped)
        // The smallest price (104) goes to unmatched as the missing-size leftover.
        const pastelLeftovers = unmatched.filter(u => u.product && u.product.includes('Ever Stay - Pastel'));
        expect(pastelLeftovers).toHaveLength(1);
        expect(pastelLeftovers[0].dpl).toBe(104);
    });

    test('3 prices, 5-size family: no overflow, 3 smallest sizes mapped (regression check)', () => {
        // Existing behavior: when PDF has FEWER prices than Zoho family,
        // smallest prices map to smallest sizes (rate-anchored ascending).
        const parsed = [{
            brand: 'Birla Opus',
            product: 'Calista Ever Stay - Clear',
            _prices: [91, 418, 1643],
            category: 'INTERIOR EMULSION',
            baseCode: '9999',
        }];
        const zoho = [
            { zoho_item_id: '1', sku: 'ES9912M', name: 'ES9912M CALISTA EVER STAY BIRLA OPUS 200 ML', rate: 118,   brand: 'Birla Opus', category: 'INTERIOR EMULSION', cf_dpl: 0, description: '' },
            { zoho_item_id: '2', sku: 'ES9901',  name: 'ES9901 CALISTA EVER STAY BIRLA OPUS 01 L',    rate: 541,   brand: 'Birla Opus', category: 'INTERIOR EMULSION', cf_dpl: 0, description: '' },
            { zoho_item_id: '3', sku: 'ES9904',  name: 'ES9904 CALISTA EVER STAY BIRLA OPUS 04 L',    rate: 2127,  brand: 'Birla Opus', category: 'INTERIOR EMULSION', cf_dpl: 0, description: '' },
            { zoho_item_id: '4', sku: 'ES9910',  name: 'ES9910 CALISTA EVER STAY BIRLA OPUS 10 L',    rate: 5276,  brand: 'Birla Opus', category: 'INTERIOR EMULSION', cf_dpl: 0, description: '' },
            { zoho_item_id: '5', sku: 'ES9920',  name: 'ES9920 CALISTA EVER STAY BIRLA OPUS 20 L',    rate: 10448, brand: 'Birla Opus', category: 'INTERIOR EMULSION', cf_dpl: 0, description: '' },
        ];

        const { matched } = matchWithZohoItems(parsed, zoho);
        const byZohoId = Object.fromEntries(matched.map(m => [m.zoho_item_id, m]));
        expect(byZohoId['1'].dpl).toBe(91);    // 200ml
        expect(byZohoId['2'].dpl).toBe(418);   // 1L
        expect(byZohoId['3'].dpl).toBe(1643);  // 4L
        expect(byZohoId['4']).toBeUndefined();
        expect(byZohoId['5']).toBeUndefined();
    });
});

describe('matchWithZohoItems — Birla Opus colorant all-letter SKUs', () => {
    // Birla Opus colorant catalog (OPCL-family) uses all-letter SKUs:
    // OPCLWT, OPCLBL, OPCLOR, OPCLEXY, OPCLEXHDY, OPCLSWT, etc. The structural
    // matcher's parseSkuStructure requires digits, so these items fall through
    // to the keyword fallback. This describe block locks in the matcher's
    // ability to disambiguate them using the exact-cleaned-name bonus.

    function colorantZoho({ id, sku, name }) {
        return {
            zoho_item_id: id, sku, name, rate: 0,
            brand: 'BIRLA OPUS', category: 'COLORANT',
            cf_dpl: 0, description: '',
        };
    }

    test('"Ext. Yellow" picks OPCLEXY over OPCLEXHDY (no "HD" in PDF)', () => {
        const parsed = [{
            brand: 'Birla Opus',
            product: 'Ext. Yellow',
            dpl: 1436,
            packSize: '1L',
            category: 'COLORANT',
        }];
        // OPCLEXHDY listed FIRST to prove order doesn't matter once the
        // exact-cleaned-name bonus is applied.
        const zoho = [
            colorantZoho({ id: 'hd', sku: 'OPCLEXHDY', name: 'OPCLEXHDY EXT. HD YELLOW BIRLA OPUS 01 L' }),
            colorantZoho({ id: 'std', sku: 'OPCLEXY',  name: 'OPCLEXY EXT. YELLOW BIRLA OPUS 01 L' }),
        ];

        const { matched } = matchWithZohoItems(parsed, zoho);
        expect(matched).toHaveLength(1);
        expect(matched[0].zoho_item_id).toBe('std');
    });

    test('"Ext. Red" picks OPCLEXR over OPCLEXHR', () => {
        const parsed = [{
            brand: 'Birla Opus',
            product: 'Ext. Red',
            dpl: 874,
            packSize: '1L',
            category: 'COLORANT',
        }];
        const zoho = [
            colorantZoho({ id: 'hd', sku: 'OPCLEXHR', name: 'OPCLEXHR EXT. HD RED BIRLA OPUS 01 L' }),
            colorantZoho({ id: 'std', sku: 'OPCLEXR', name: 'OPCLEXR EXT. RED BIRLA OPUS 01 L' }),
        ];

        const { matched } = matchWithZohoItems(parsed, zoho);
        expect(matched).toHaveLength(1);
        expect(matched[0].zoho_item_id).toBe('std');
    });

    test('"White" colorant prefers OPCLWT over unrelated AP APEX item', () => {
        const parsed = [{
            brand: 'Birla Opus',
            product: 'White',
            dpl: 552,
            packSize: '1L',
            category: 'COLORANT',
        }];
        const zoho = [
            // Cross-brand item with empty brand + WHITE in name — used to win on first-encounter.
            { zoho_item_id: 'ap', sku: '680912210', name: 'AP APEX ULTIMA BR WHITE 1 LT', rate: 575,
              brand: '', category: '', cf_dpl: 0, description: '' },
            colorantZoho({ id: 'opclwt', sku: 'OPCLWT', name: 'OPCLWT WHITE BIRLA OPUS 01 L' }),
            colorantZoho({ id: 'opclswt', sku: 'OPCLSWT', name: 'OPCLSWT SPECIAL WHITE BIRLA OPUS 01 L' }),
        ];

        const { matched } = matchWithZohoItems(parsed, zoho);
        expect(matched).toHaveLength(1);
        expect(matched[0].zoho_item_id).toBe('opclwt');
    });

    test('"Special White" colorant picks OPCLSWT (does not collapse to OPCLWT)', () => {
        const parsed = [{
            brand: 'Birla Opus',
            product: 'Special White',
            dpl: 350,
            packSize: '1L',
            category: 'COLORANT',
        }];
        const zoho = [
            colorantZoho({ id: 'opclwt',  sku: 'OPCLWT',  name: 'OPCLWT WHITE BIRLA OPUS 01 L' }),
            colorantZoho({ id: 'opclswt', sku: 'OPCLSWT', name: 'OPCLSWT SPECIAL WHITE BIRLA OPUS 01 L' }),
        ];

        const { matched } = matchWithZohoItems(parsed, zoho);
        expect(matched).toHaveLength(1);
        expect(matched[0].zoho_item_id).toBe('opclswt');
    });

    test('"Black" prefers OPCLBL over K2 BITUCOAT (single-letter abbrev collision)', () => {
        // "Black" → pdfAbbrev "B"; cleanZohoName turns OPCLBL into "BLACK" (abbrev "B"),
        // and the existing digit-prefix rule turns K2BC01 into "BITUCOAT" (also abbrev "B").
        // Both land in zohoFamilyIndex["B"], so Strategy 0b sees a multi-hit. Without the
        // exact-name preference, K2 BITUCOAT (listed FIRST here) would win on order.
        const parsed = [{
            brand: 'Birla Opus',
            product: 'Black',
            dpl: 347,
            packSize: '1L',
            category: 'COLORANT',
        }];
        const zoho = [
            // K2 BITUCOAT — adversarial: listed FIRST so the order-based pick would lose.
            { zoho_item_id: 'k2', sku: 'K2BC01', name: 'K2 BITUCOAT 01 L', rate: 250,
              brand: 'K2 WATERPROOFING CHEMICALS', category: '', cf_dpl: 0, description: '' },
            colorantZoho({ id: 'opclbl', sku: 'OPCLBL', name: 'OPCLBL BLACK BIRLA OPUS 01 L' }),
        ];

        const { matched } = matchWithZohoItems(parsed, zoho);
        expect(matched).toHaveLength(1);
        expect(matched[0].zoho_item_id).toBe('opclbl');
    });

    test('"Yellow Oxide" prefers OPCLYO over an unrelated GERMAN YELLOW OXIDE item', () => {
        const parsed = [{
            brand: 'Birla Opus',
            product: 'Yellow Oxide',
            dpl: 481,
            packSize: '1L',
            category: 'COLORANT',
        }];
        const zoho = [
            { zoho_item_id: 'german', sku: 'GERMAN-YO', name: 'GERMAN YELLOW OXIDE 1KG', rate: 80,
              brand: '', category: '', cf_dpl: 0, description: '' },
            colorantZoho({ id: 'opclyo', sku: 'OPCLYO', name: 'OPCLYO YELLOW OXIDE BIRLA OPUS 01 L' }),
        ];

        const { matched } = matchWithZohoItems(parsed, zoho);
        expect(matched).toHaveLength(1);
        expect(matched[0].zoho_item_id).toBe('opclyo');
    });
});
