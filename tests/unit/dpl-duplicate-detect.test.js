const { computeDuplicateInfo } = require('../../public/js/dpl-duplicate-detect');

// Helper to build an entry quickly.
function E(id, zoho_item_id, product_code, zoho_sku, link_status) {
    return { id, zoho_item_id, product_code, zoho_sku, link_status: link_status || 'confirmed' };
}

describe('computeDuplicateInfo', () => {
    test('no collision when confirmed entries link to different Zoho items', () => {
        const info = computeDuplicateInfo([
            E(1, 'Z1', 'TF110', 'TF110'),
            E(2, 'Z2', 'TFWT20', 'TFWT20'),
        ]);
        expect(info).toEqual({});
    });

    test('2-way collision: SKU-matching entry is best, the other is wrong', () => {
        const info = computeDuplicateInfo([
            E(1, 'Z1', 'TF110', 'TF110'),   // product_code matches the shared Zoho sku
            E(2, 'Z1', 'TFP110', 'TF110'),  // different product, wrongly linked
        ]);
        expect(info[1]).toEqual({ count: 2, role: 'best' });
        expect(info[2]).toEqual({ count: 2, role: 'wrong' });
    });

    test('zoho_sku that starts with product_code also counts as a match', () => {
        const info = computeDuplicateInfo([
            E(1, 'Z1', 'TF110', 'TF110EXT'),
            E(2, 'Z1', 'XYZ99', 'TF110EXT'),
        ]);
        expect(info[1].role).toBe('best');
        expect(info[2].role).toBe('wrong');
    });

    test('ambiguous when NO entry matches the Zoho sku', () => {
        const info = computeDuplicateInfo([
            E(1, 'Z1', 'AAA', 'TF110'),
            E(2, 'Z1', 'BBB', 'TF110'),
        ]);
        expect(info[1]).toEqual({ count: 2, role: 'ambiguous' });
        expect(info[2]).toEqual({ count: 2, role: 'ambiguous' });
    });

    test('ambiguous when MORE THAN ONE entry matches the Zoho sku', () => {
        const info = computeDuplicateInfo([
            E(1, 'Z1', 'TF110', 'TF110'),
            E(2, 'Z1', 'TF110', 'TF110'),
        ]);
        expect(info[1].role).toBe('ambiguous');
        expect(info[2].role).toBe('ambiguous');
    });

    test('unlinked entries (null zoho_item_id) are ignored', () => {
        const info = computeDuplicateInfo([
            E(1, null, 'TF110', null),
            E(2, null, 'TFP110', null),
        ]);
        expect(info).toEqual({});
    });

    test('non-confirmed entries are not counted toward a collision', () => {
        const info = computeDuplicateInfo([
            E(1, 'Z1', 'TF110', 'TF110', 'confirmed'),
            E(2, 'Z1', 'TFP110', 'TF110', 'review'),  // review — ignored
        ]);
        // Only one confirmed entry in the group → not a collision.
        expect(info).toEqual({});
    });
});
