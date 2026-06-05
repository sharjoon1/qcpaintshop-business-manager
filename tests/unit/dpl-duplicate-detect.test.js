const { computeDuplicateInfo } = require('../../public/js/dpl-duplicate-detect');

// sku_base_match is the server-computed verdict (Birla base-code aware) for whether
// an entry's base+size matches the SKU of the Zoho item it is linked to.
function E(id, zoho_item_id, sku_base_match, link_status) {
    return { id, zoho_item_id, sku_base_match, link_status: link_status || 'confirmed' };
}

describe('computeDuplicateInfo', () => {
    test('no collision when confirmed entries link to different Zoho items', () => {
        expect(computeDuplicateInfo([E(1, 'Z1', true), E(2, 'Z2', true)])).toEqual({});
    });

    test('2-way collision: the base-matching entry is best, the other is wrong', () => {
        // e.g. TF110 (pastel): pastel entry sku_base_match=true, white entry=false.
        const info = computeDuplicateInfo([E(1, 'Z1', true), E(2, 'Z1', false)]);
        expect(info[1]).toEqual({ count: 2, role: 'best' });
        expect(info[2]).toEqual({ count: 2, role: 'wrong' });
    });

    test('ambiguous when NO entry matches the Zoho SKU', () => {
        const info = computeDuplicateInfo([E(1, 'Z1', false), E(2, 'Z1', null)]);
        expect(info[1]).toEqual({ count: 2, role: 'ambiguous' });
        expect(info[2]).toEqual({ count: 2, role: 'ambiguous' });
    });

    test('ambiguous when MORE THAN ONE entry matches the Zoho SKU', () => {
        const info = computeDuplicateInfo([E(1, 'Z1', true), E(2, 'Z1', true)]);
        expect(info[1].role).toBe('ambiguous');
        expect(info[2].role).toBe('ambiguous');
    });

    test('unlinked entries (null zoho_item_id) are ignored', () => {
        expect(computeDuplicateInfo([E(1, null, null), E(2, null, null)])).toEqual({});
    });

    test('non-confirmed entries are not counted toward a collision', () => {
        const info = computeDuplicateInfo([
            E(1, 'Z1', true, 'confirmed'),
            E(2, 'Z1', false, 'review'), // review — ignored
        ]);
        expect(info).toEqual({});
    });
});
