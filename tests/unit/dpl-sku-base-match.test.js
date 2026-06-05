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

    // --- Variant bases that DON'T share the plain-colour code (from real prod data) ---
    test('Organic Yellow 10L matches NS510 (code 5)', () => {
        expect(catalog.skuBaseMatch(E('Organic Yellow', '10L', 'NS510', 'NS510 ... BIRLA OPUS 10 L'))).toBe(true);
    });

    test('Inorganic Yellow 10L matches TLI410 (code 4, NOT 5)', () => {
        expect(catalog.skuBaseMatch(E('Inorganic Yellow', '10L', 'TLI410', 'TLI410 ... BIRLA OPUS 10 L'))).toBe(true);
    });

    test('Inorganic Yellow does NOT match the Organic Yellow SKU (4 ≠ 5)', () => {
        expect(catalog.skuBaseMatch(E('Inorganic Yellow', '10L', 'NS510', 'NS510 ... BIRLA OPUS 10 L'))).toBe(false);
    });

    test('Organic Red 10L matches NS610 (code 6)', () => {
        expect(catalog.skuBaseMatch(E('Organic Red', '10L', 'NS610', 'NS610 ... BIRLA OPUS 10 L'))).toBe(true);
    });

    test('Tintable White 10L matches PF1310 (code 13, NOT WT)', () => {
        expect(catalog.skuBaseMatch(E('Tintable White', '10L', 'PF1310', 'PF1310 ... BIRLA OPUS 10 L'))).toBe(true);
    });

    test('plain Mid Tone 10L still matches NS210 (code 2)', () => {
        expect(catalog.skuBaseMatch(E('Mid Tone', '10L', 'NS210', 'NS210 ... BIRLA OPUS 10 L'))).toBe(true);
    });
});
