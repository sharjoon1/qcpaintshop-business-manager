const catalog = require('../../services/dpl-catalog');

// Birla Opus base → SKU base-code convention (per the brand):
//   white=WT  pastel=1  mid=2  clear=99  yellow=5  red=6
// skuBaseMatch(entry) answers: does this linked entry's base+size match the SKU
// of the Zoho item it points to? true / false / null (undeterminable).
function E(base_name, size_tier, zoho_sku, zoho_name) {
    return { base_name, size_tier, zoho_sku, zoho_name };
}

describe('skuBaseMatch (Birla base-code aware)', () => {
    test('Pastel 10L correctly matches TF110 (base code 1)', () => {
        expect(catalog.skuBaseMatch(E('Pastel', '10L', 'TF110', 'TF110 ONE TRUE FLEX BIRLA OPUS 10 L'))).toBe(true);
    });

    test('White 10L does NOT match TF110 (white is WT, not 1)', () => {
        expect(catalog.skuBaseMatch(E('White', '10L', 'TF110', 'TF110 ONE TRUE FLEX BIRLA OPUS 10 L'))).toBe(false);
    });

    test('White 20L matches TFWT20 (base code WT)', () => {
        expect(catalog.skuBaseMatch(E('White', '20L', 'TFWT20', 'TFWT20 ONE TRUE FLEX BIRLA OPUS 20 L'))).toBe(true);
    });

    test('Clear 10L matches TLI9910 (base code 99)', () => {
        expect(catalog.skuBaseMatch(E('Clear', '10L', 'TLI9910', 'TLI9910 ONE TRUE LIFE BIRLA OPUS 10 L'))).toBe(true);
    });

    test('Pastel 10L does NOT match TLI9910 (that SKU is clear/99)', () => {
        expect(catalog.skuBaseMatch(E('Pastel', '10L', 'TLI9910', 'TLI9910 ONE TRUE LIFE BIRLA OPUS 10 L'))).toBe(false);
    });

    test('unknown base → null (cannot determine)', () => {
        expect(catalog.skuBaseMatch(E('Metallic', '10L', 'TF110', 'TF110 ONE TRUE FLEX BIRLA OPUS 10 L'))).toBeNull();
    });

    test('unparseable Zoho SKU (no size code) → null', () => {
        expect(catalog.skuBaseMatch(E('White', '10L', 'WEIRDSKU', 'No size here'))).toBeNull();
    });
});
