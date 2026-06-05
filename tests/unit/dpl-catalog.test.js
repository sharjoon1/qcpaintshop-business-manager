const catalog = require('../../services/dpl-catalog');

describe('slug', () => {
    test('lowercases and strips non-alphanumerics', () => {
        expect(catalog.slug('One Pure Elegance')).toBe('onepureelegance');
        expect(catalog.slug('Base 2')).toBe('base2');
        expect(catalog.slug(null)).toBe('');
    });
});

describe('normalizeSizeTier', () => {
    const cases = [
        ['200ml', '200ml'], ['200 ML', '200ml'],
        ['900ml', '1L'], ['0.9L', '1L'], ['1L', '1L'],
        ['3.6L', '4L'], ['4L', '4L'],
        ['9L', '10L'], ['10L', '10L'],
        ['18L', '20L'], ['20L', '20L'],
        ['25kg', '25kg'],
    ];
    test.each(cases)('normalizeSizeTier(%s) === %s', (input, expected) => {
        expect(catalog.normalizeSizeTier(input)).toBe(expected);
    });
    test('bare number without a unit is returned verbatim (not promoted to litres)', () => {
        expect(catalog.normalizeSizeTier('20')).toBe('20');
    });
});

describe('extractSizeFromZohoName', () => {
    test('takes the last size-with-unit, ignoring leading category codes', () => {
        expect(catalog.extractSizeFromZohoName('EP01 PEWH One Pure Elegance White 1 L', 'PEWH01')).toBe('1L');
        expect(catalog.extractSizeFromZohoName('PE BASE2 ONE PURE ELEGANCE BASE 2 BIRLA OPUS 4L', 'PEBASE2-4L')).toBe('4L');
        expect(catalog.extractSizeFromZohoName('... 200ml', 'X-200ML')).toBe('200ml');
    });
    test('returns empty string when no size present', () => {
        expect(catalog.extractSizeFromZohoName('Some Colorant Tint', 'CLT')).toBe('');
    });
    test('does NOT match a size embedded in a code with no separator', () => {
        expect(catalog.extractSizeFromZohoName('BIRLA OPUS BASE4L WHITE', '')).toBe('');
    });
});

describe('buildMatchKey', () => {
    test('uses product_code when present', () => {
        const k = catalog.buildMatchKey({ brand: 'birlaopus', product_code: '941001', product_name: 'One Pure Elegance', base_name: 'White', size_tier: '1L' });
        expect(k).toBe('birlaopus|941001|white|1l');
    });
    test('same product+base at 900ml and 1L collapse to the SAME key', () => {
        const a = catalog.buildMatchKey({ brand: 'birlaopus', product_code: '941001', base_name: 'Base 2', size_tier: catalog.normalizeSizeTier('900ml') });
        const b = catalog.buildMatchKey({ brand: 'birlaopus', product_code: '941001', base_name: 'Base 2', size_tier: catalog.normalizeSizeTier('1L') });
        expect(a).toBe(b);
        expect(a).toBe('birlaopus|941001|base2|1l');
    });
    test('falls back to product_name slug when no product_code', () => {
        const k = catalog.buildMatchKey({ brand: 'birlaopus', product_code: '', product_name: 'Royale Aspira', base_name: 'White', size_tier: '4L' });
        expect(k).toBe('birlaopus|royaleaspira|white|4l');
    });
});

describe('dplBaseStems / zohoSkuStem', () => {
    test('White → [wt, wht] (NOT 99 — that is Clear); numeric/other bases pass through', () => {
        expect(catalog.dplBaseStems('PE White')).toEqual(['pewt', 'pewht']);
        expect(catalog.dplBaseStems('PBS White')).toEqual(['pbswt', 'pbswht']);
        expect(catalog.dplBaseStems('PE 99')).toEqual(['pe99']);
        expect(catalog.dplBaseStems('PE 1')).toEqual(['pe1']);
        expect(catalog.dplBaseStems('')).toEqual([]);
    });
    test('zohoSkuStem strips the per-tier size code', () => {
        expect(catalog.zohoSkuStem({ name: 'PE9901 ONE PURE ELEGANCE BIRLA OPUS 01 L', sku: 'PE9901' })).toEqual({ stem: 'pe99', tier: '1L' });
        expect(catalog.zohoSkuStem({ name: 'PE110 ONE PURE ELEGANCE BIRLA OPUS 10 L', sku: 'PE110' })).toEqual({ stem: 'pe1', tier: '10L' });
    });
    test('zohoSkuStem returns null when SKU does not end with the tier size-code', () => {
        expect(catalog.zohoSkuStem({ name: 'SOMETHING 1 L', sku: 'XYZ' })).toBe(null);
    });
});

describe('linkEntryToZoho', () => {
    // Real Birla shape: base in the SKU. 99 = CLEAR (not White). White is encoded as WT.
    const zoho = [
        { zoho_item_id: 'Z1', name: 'PE9901 ONE PURE ELEGANCE BIRLA OPUS 01 L', sku: 'PE9901' },
        { zoho_item_id: 'Z2', name: 'PE101 ONE PURE ELEGANCE BIRLA OPUS 01 L', sku: 'PE101' },
        { zoho_item_id: 'Z3', name: 'PE9904 ONE PURE ELEGANCE BIRLA OPUS 04 L', sku: 'PE9904' },
        { zoho_item_id: 'Z4', name: 'PBSWT04 STYLE POWER BRIGHT SHINE BIRLA OPUS 04 L', sku: 'PBSWT04' },
    ];

    test('S0 exact canonical SKU wins', () => {
        const r = catalog.linkEntryToZoho({ base_code: 'PE 99', product_name: 'One Pure Elegance', size_tier: '1L', canonical_sku: 'PE9901' }, zoho);
        expect(r.zoho_item_id).toBe('Z1');
        expect(r.link_reason).toBe('exact-sku');
        expect(r.link_confidence).toBe(100);
    });

    test('S1: Clear (PE 99 → pe99) → PE9901', () => {
        const r = catalog.linkEntryToZoho({ base_code: 'PE 99', product_name: 'One Pure Elegance', size_tier: '1L' }, zoho);
        expect(r.zoho_item_id).toBe('Z1');
        expect(r.link_reason).toBe('sku-reconstruct');
        expect(r.link_status).toBe('confirmed');
    });

    test('S1: White does NOT steal the Clear PE99 SKU', () => {
        const r = catalog.linkEntryToZoho({ base_code: 'PE White', product_name: 'One Pure Elegance', size_tier: '1L' }, zoho);
        expect(r.zoho_item_id).not.toBe('Z1');
        expect(r.link_status).not.toBe('confirmed');
    });

    test('S1: White encoded as WT → PBSWT04', () => {
        const r = catalog.linkEntryToZoho({ base_code: 'PBS White', product_name: 'Style Power Bright Shine', size_tier: '4L' }, zoho);
        expect(r.zoho_item_id).toBe('Z4');
        expect(r.link_reason).toBe('sku-reconstruct');
        expect(r.link_status).toBe('confirmed');
    });

    test('S1 Base 1 (PE 1 stem) → PE101', () => {
        const r = catalog.linkEntryToZoho({ base_code: 'PE 1', product_name: 'One Pure Elegance', size_tier: '1L' }, zoho);
        expect(r.zoho_item_id).toBe('Z2');
        expect(r.link_status).toBe('confirmed');
    });

    test('off-size: DPL Clear 3.6L (tier 4L) links to the Zoho 4L SKU PE9904', () => {
        const r = catalog.linkEntryToZoho({ base_code: 'PE 99', product_name: 'One Pure Elegance', size_tier: catalog.normalizeSizeTier('3.6L') }, zoho);
        expect(r.zoho_item_id).toBe('Z3');
        expect(r.link_reason).toBe('sku-reconstruct');
    });

    test('a tier Zoho lacks → needs_creating', () => {
        const r = catalog.linkEntryToZoho({ base_code: 'PE 99', product_name: 'One Pure Elegance', size_tier: '20L' }, zoho);
        expect(r.zoho_item_id).toBe(null);
        expect(r.link_status).toBe('needs_creating');
    });
});

describe('buildCatalogFromDpl', () => {
    const zoho = [
        { zoho_item_id: 'Z1', name: 'PE9901 ONE PURE ELEGANCE BIRLA OPUS 01 L', sku: 'PE9901', description: '', category: 'INTERIOR EMULSION' },
        { zoho_item_id: 'Z3', name: 'PE9904 ONE PURE ELEGANCE BIRLA OPUS 04 L', sku: 'PE9904', description: '', category: 'INTERIOR EMULSION' },
    ];
    const rows = [
        { product: 'One Pure Elegance - Clear', productName: 'One Pure Elegance', colourName: 'Clear', baseCode: 'PE 99', productCode: '941001', colourCode: '9999', packSize: '1L', dpl: 445, category: 'INTERIOR EMULSION', brand: 'Birla Opus' },
        { product: 'One Pure Elegance - Clear', productName: 'One Pure Elegance', colourName: 'Clear', baseCode: 'PE 99', productCode: '941001', colourCode: '9999', packSize: '3.6L', dpl: 1751, category: 'INTERIOR EMULSION', brand: 'Birla Opus' },
    ];

    test('entry has tier, match_key, price, and SKU-reconstructed link', () => {
        const entries = catalog.buildCatalogFromDpl('birlaopus', rows, zoho);
        expect(entries).toHaveLength(2);
        const e1 = entries.find(e => e.size_tier === '1L');
        expect(e1.product_code).toBe('941001');
        expect(e1.base_name).toBe('Clear');
        expect(e1.dpl_size_label).toBe('1L');
        expect(e1.current_dpl).toBe(445);
        expect(e1.current_rate).toBe(Math.ceil(445 * 1.18 * 1.10));
        expect(e1.match_key).toBe('birlaopus|941001|clear|1l');
        expect(e1.zoho_item_id).toBe('Z1');
        expect(e1.link_status).toBe('confirmed');
        expect(e1.link_reason).toBe('sku-reconstruct');
    });

    test('off-size DPL 3.6L (tier 4L) links to the Zoho 4L item', () => {
        const entries = catalog.buildCatalogFromDpl('birlaopus', rows, zoho);
        const e2 = entries.find(e => e.size_tier === '4L');
        expect(e2.dpl_size_label).toBe('3.6L');
        expect(e2.zoho_item_id).toBe('Z3');
        expect(e2.link_status).toBe('confirmed');
    });
});

describe('buildCatalogFromDpl — preserve user-confirmed/pushed links across rebuild', () => {
    // The linker can only auto-reach 'review'/'needs_creating' for this row (no SKU stem,
    // no colorant). A prior user confirm/push must survive a rebuild instead of being
    // clobbered back to review by the fresh linker result.
    const rows = [
        { productName: 'Style Perfect Start Primer', colourName: 'White', baseCode: '', productCode: '800010', packSize: '10L', dpl: 1200, category: 'PRIMER', brand: 'Birla Opus' },
    ];
    const mk = 'birlaopus|800010|white|10l';

    test('no existing → linker decides (needs_creating, no zoho match)', () => {
        const e = catalog.buildCatalogFromDpl('birlaopus', rows, [], [])[0];
        expect(e.match_key).toBe(mk);
        expect(e.link_status).toBe('needs_creating');
        expect(e.zoho_item_id).toBeNull();
    });

    test('user-confirmed prev is restored to confirmed (+ canonical preserved)', () => {
        const existing = [{ match_key: mk, zoho_item_id: 'Z9', link_status: 'confirmed', link_reason: 'user-confirmed',
            canonical_name: 'PSP CANON', canonical_sku: 'PSP9910', canonical_description: 'd', pushed_at: null }];
        const e = catalog.buildCatalogFromDpl('birlaopus', rows, [], existing)[0];
        expect(e.link_status).toBe('confirmed');
        expect(e.link_confidence).toBe(100);
        expect(e.link_reason).toBe('user-confirmed');
        expect(e.zoho_item_id).toBe('Z9');
        expect(e.canonical_sku).toBe('PSP9910');
        expect(e.canonical_name).toBe('PSP CANON');
    });

    test('previously-pushed-but-downgraded prev is restored to confirmed', () => {
        const existing = [{ match_key: mk, zoho_item_id: 'Z9', link_status: 'review', link_reason: 'product+tier-only',
            canonical_name: 'PSP CANON', canonical_sku: 'PSP9910', canonical_description: 'd', pushed_at: '2026-06-04 10:11:53' }];
        const e = catalog.buildCatalogFromDpl('birlaopus', rows, [], existing)[0];
        expect(e.link_status).toBe('confirmed');
        expect(e.link_confidence).toBe(100);
        expect(e.zoho_item_id).toBe('Z9');
    });

    test('prev marked not-in-zoho (no link) is NOT restored', () => {
        const existing = [{ match_key: mk, zoho_item_id: null, link_status: 'needs_creating', link_reason: 'marked-not-in-zoho',
            canonical_name: null, canonical_sku: null, canonical_description: null, pushed_at: '2026-06-04 10:11:53' }];
        const e = catalog.buildCatalogFromDpl('birlaopus', rows, [], existing)[0];
        expect(e.link_status).toBe('needs_creating');
        expect(e.zoho_item_id).toBeNull();
    });
});

describe('applyDplPrices', () => {
    const existing = [
        { id: 1, match_key: 'birlaopus|941001|white|1l', zoho_item_id: 'Z1', current_dpl: 490 },
        { id: 2, match_key: 'birlaopus|941001|base2|1l', zoho_item_id: 'Z2', current_dpl: 520 },
    ];
    const rows = [
        { product: 'One Pure Elegance - White', packSize: '1L', dpl: 510, baseCode: '941001' },
        { product: 'One Pure Elegance - Base 3', packSize: '4L', dpl: 1800, baseCode: '941001' },
    ];

    test('updates matched entries, flags new ones, lists untouched', () => {
        const res = catalog.applyDplPrices('birlaopus', rows, existing);
        expect(res.updated).toHaveLength(1);
        expect(res.updated[0].match_key).toBe('birlaopus|941001|white|1l');
        expect(res.updated[0].new_dpl).toBe(510);
        expect(res.updated[0].new_rate).toBe(Math.ceil(510 * 1.18 * 1.10));
        expect(res.updated[0].old_dpl).toBe(490);

        expect(res.newNeedsLinking).toHaveLength(1);
        expect(res.newNeedsLinking[0].match_key).toBe('birlaopus|941001|base3|4l');

        expect(res.noDplThisTime.map(e => e.match_key)).toContain('birlaopus|941001|base2|1l');
    });
});

describe('applyDplPrices — enriched diff fields', () => {
    const existing = [
        { id: 1, match_key: 'birlaopus|941001|white|1l', zoho_item_id: 'Z1', current_dpl: 490,
          current_rate: 636, link_status: 'confirmed', product_name: 'One Pure Elegance',
          base_name: 'White', size_tier: '1L', dpl_size_label: '1L',
          canonical_name: 'BIRLA OPUS ONE PURE ELEGANCE WHITE 1L', canonical_sku: 'PE9901',
          canonical_description: 'desc' },
    ];
    const rows = [{ product: 'One Pure Elegance - White', packSize: '1L', dpl: 510, baseCode: '941001' }];

    test('updated rows carry id, zoho_item_id, link_status, old_rate, canonical + display fields', () => {
        const u = catalog.applyDplPrices('birlaopus', rows, existing).updated[0];
        expect(u.id).toBe(1);
        expect(u.zoho_item_id).toBe('Z1');
        expect(u.link_status).toBe('confirmed');
        expect(u.old_rate).toBe(636);
        expect(u.new_rate).toBe(Math.ceil(510 * 1.18 * 1.10));
        expect(u.product_name).toBe('One Pure Elegance');
        expect(u.base_name).toBe('White');
        expect(u.size_tier).toBe('1L');
        expect(u.canonical_sku).toBe('PE9901');
        expect(u.canonical_name).toBe('BIRLA OPUS ONE PURE ELEGANCE WHITE 1L');
    });
});

describe('buildPushChanges', () => {
    const entry = {
        current_dpl: 510, current_rate: 662,
        canonical_name: 'BIRLA OPUS ONE PURE ELEGANCE WHITE 1L', canonical_sku: 'PE9901',
        canonical_description: 'Premium interior emulsion', category: 'Interior Luxury',
    };

    test('always includes prices', () => {
        const c = catalog.buildPushChanges(entry, { sku: 'PE9901', name: entry.canonical_name,
            description: entry.canonical_description, category: 'Interior Luxury', cf_dpl: 490 });
        expect(c.cf_dpl).toBe(510);
        expect(c.purchase_rate).toBe(510);
        expect(c.rate).toBe(662);
    });

    test('adds name/sku/description/category only when they differ', () => {
        const c = catalog.buildPushChanges(entry, { sku: 'OLD', name: 'Old Name',
            description: 'old', category: 'Old Cat', cf_dpl: 490 });
        expect(c.name).toBe('BIRLA OPUS ONE PURE ELEGANCE WHITE 1L');
        expect(c.sku).toBe('PE9901');
        expect(c.description).toBe('Premium interior emulsion');
        expect(c.category).toBe('Interior Luxury');
    });

    test('omits name/sku when identical to current Zoho values', () => {
        const c = catalog.buildPushChanges(entry, { sku: 'PE9901', name: entry.canonical_name,
            description: entry.canonical_description, category: 'Interior Luxury', cf_dpl: 490 });
        expect(c).not.toHaveProperty('name');
        expect(c).not.toHaveProperty('sku');
        expect(c).not.toHaveProperty('description');
        expect(c).not.toHaveProperty('category');
    });

    test('never emits empty canonical values', () => {
        const c = catalog.buildPushChanges({ current_dpl: 510, current_rate: 662,
            canonical_name: '', canonical_sku: null }, { sku: 'X', name: 'Y', cf_dpl: 1 });
        expect(c).not.toHaveProperty('name');
        expect(c).not.toHaveProperty('sku');
    });

    test('returns null when entry has no current_dpl', () => {
        expect(catalog.buildPushChanges({ current_dpl: null }, {})).toBeNull();
    });
});

describe('updateAppliedPrices', () => {
    test('issues one UPDATE per row with new dpl/rate', async () => {
        const calls = [];
        catalog.setPool({ query: async (sql, params) => { calls.push({ sql, params }); return [{}]; } });
        await catalog.updateAppliedPrices(
            [{ id: 7, new_dpl: 510, new_rate: 662 }], 'admin');
        expect(calls).toHaveLength(1);
        expect(calls[0].sql).toMatch(/UPDATE dpl_catalog SET/i);
        expect(calls[0].params).toEqual([510, 662, 'admin', 7]);
    });
});

describe('dpl-catalog DB layer', () => {
    test('upsertEntries issues an INSERT ... ON DUPLICATE KEY per entry', async () => {
        const calls = [];
        catalog.setPool({ query: async (sql, params) => { calls.push({ sql, params }); return [{ affectedRows: 1 }]; } });
        await catalog.upsertEntries([
            { brand: 'birlaopus', match_key: 'birlaopus|941001|white|1l', category: 'Interior Luxury', product_code: '941001', product_name: 'One Pure Elegance', base_name: 'White', size_tier: '1L', dpl_size_label: '1L', zoho_item_id: 'Z1', canonical_name: 'X', canonical_sku: 'PEWH01', canonical_description: 'D', current_dpl: 490, current_rate: 636, link_status: 'confirmed', link_confidence: 90, link_reason: 'product+base+tier' },
        ], 'tester');
        expect(calls.length).toBe(1);
        expect(/INSERT INTO dpl_catalog/i.test(calls[0].sql)).toBe(true);
        expect(/ON DUPLICATE KEY UPDATE/i.test(calls[0].sql)).toBe(true);
        expect(calls[0].params).toContain('birlaopus|941001|white|1l');
    });

    test('getCatalog selects by brand', async () => {
        let captured;
        catalog.setPool({ query: async (sql, params) => { captured = { sql, params }; return [[{ id: 1 }]]; } });
        const rows = await catalog.getCatalog('birlaopus');
        expect(rows).toEqual([{ id: 1 }]);
        expect(/FROM dpl_catalog d/i.test(captured.sql)).toBe(true);
        expect(/LEFT JOIN zoho_items_map z/i.test(captured.sql)).toBe(true);
        expect(/z\.zoho_sku AS zoho_sku/i.test(captured.sql)).toBe(true);
        expect(/WHERE d\.brand = \?/i.test(captured.sql)).toBe(true);
        expect(captured.params).toEqual(['birlaopus']);
    });

    test('confirmLink pins zoho_item_id and sets status confirmed', async () => {
        let captured;
        catalog.setPool({ query: async (sql, params) => { captured = { sql, params }; return [{ affectedRows: 1 }]; } });
        await catalog.confirmLink(7, 'Z9', 'tester');
        expect(/UPDATE dpl_catalog SET/i.test(captured.sql)).toBe(true);
        expect(/zoho_item_id = \?/i.test(captured.sql)).toBe(true);
        expect(/link_status = 'confirmed'/i.test(captured.sql)).toBe(true);
        expect(captured.params).toEqual(['Z9', 'tester', 7]);
    });
});

describe('updateCanonicalFields', () => {
    test('updates only provided canonical fields with map-order params', async () => {
        const calls = [];
        catalog.setPool({ query: async (sql, params) => { calls.push({ sql, params }); return [{}]; } });
        const ok = await catalog.updateCanonicalFields(
            5, { canonical_name: 'N', canonical_sku: 'ABC', canonical_description: 'D' }, 'admin');
        expect(ok).toBe(true);
        expect(calls).toHaveLength(1);
        expect(calls[0].sql).toMatch(/UPDATE dpl_catalog SET canonical_name = \?, canonical_sku = \?, canonical_description = \?, updated_by = \? WHERE id = \?/);
        expect(calls[0].params).toEqual(['N', 'ABC', 'D', 'admin', 5]);
    });

    test('writes only the keys provided', async () => {
        const calls = [];
        catalog.setPool({ query: async (sql, params) => { calls.push({ sql, params }); return [{}]; } });
        await catalog.updateCanonicalFields(7, { canonical_sku: 'XYZ' }, 'u');
        expect(calls[0].sql).toMatch(/SET canonical_sku = \?, updated_by = \? WHERE id = \?/);
        expect(calls[0].params).toEqual(['XYZ', 'u', 7]);
    });

    test('returns false and issues no query when no fields provided', async () => {
        const calls = [];
        catalog.setPool({ query: async (sql, params) => { calls.push({ sql, params }); return [{}]; } });
        const ok = await catalog.updateCanonicalFields(9, {}, 'u');
        expect(ok).toBe(false);
        expect(calls).toHaveLength(0);
    });
});

describe('reconcileCanonical', () => {
    test('canonical_sku becomes the linked item sku; name carries it', () => {
        const c = catalog.reconcileCanonical(
            { product_name: 'Colorant', base_name: 'Black', size_tier: '1L', dpl_size_label: '1L', current_dpl: 394, category: 'Interior' },
            { zoho_sku: 'OPCLBL', zoho_description: 'BLACK COLORANT', zoho_category_name: 'Interior' });
        expect(c.canonical_sku).toBe('OPCLBL');
        expect(c.canonical_name).toContain('OPCLBL');
        expect(typeof c.canonical_description).toBe('string');
    });

    test('returns null canonical_sku when the linked item has no sku', () => {
        const c = catalog.reconcileCanonical(
            { product_name: 'X', base_name: '', size_tier: '1L', dpl_size_label: '1L', current_dpl: 100, category: '' },
            { zoho_sku: '' });
        expect(c.canonical_sku).toBeNull();
    });
});

describe('confirmLink recompute', () => {
    test('recomputes canonical fields from the newly linked item', async () => {
        const calls = [];
        catalog.setPool({ query: async (sql, params) => {
            calls.push({ sql, params });
            if (/FROM dpl_catalog WHERE id/.test(sql)) return [[{ id: 1, product_name: 'Colorant', base_name: 'Black', size_tier: '1L', dpl_size_label: '1L', current_dpl: 394, category: 'Interior' }]];
            if (/FROM zoho_items_map/.test(sql)) return [[{ zoho_sku: 'OPCLBL', zoho_description: 'd', zoho_category_name: 'Interior' }]];
            return [{}];
        } });
        await catalog.confirmLink(1, 'ZID', 'admin');
        const upd = calls.find(c => /UPDATE dpl_catalog SET zoho_item_id/.test(c.sql));
        expect(upd).toBeTruthy();
        expect(upd.sql).toMatch(/canonical_sku = \?/);
        expect(upd.params[0]).toBe('ZID');       // zoho_item_id
        expect(upd.params[2]).toBe('OPCLBL');     // canonical_sku
        expect(upd.params[5]).toBe(1);            // id
    });

    test('falls back to link-only update when entry not found', async () => {
        const calls = [];
        catalog.setPool({ query: async (sql) => {
            calls.push({ sql });
            if (/FROM dpl_catalog WHERE id/.test(sql)) return [[]];
            if (/FROM zoho_items_map/.test(sql)) return [[]];
            return [{}];
        } });
        await catalog.confirmLink(2, 'ZID', 'u');
        const upd = calls.find(c => /UPDATE dpl_catalog SET zoho_item_id/.test(c.sql));
        expect(upd.sql).not.toMatch(/canonical_sku/);
    });
});

describe('linkEntryToZoho — colorant map', () => {
    const opclbl = { zoho_item_id: 'Z1', sku: 'OPCLBL', name: 'OPCLBL COLORANT BIRLA OPUS 01 L' };

    test('maps a colorant productCode to its exact Zoho SKU (confirmed)', () => {
        const r = catalog.linkEntryToZoho(
            { product_code: '970002', size_tier: '1L', product_name: 'Colorant', base_name: 'Black' },
            [opclbl, { zoho_item_id: 'Z2', sku: 'OPCLWT', name: 'OPCLWT WHITE BIRLA OPUS 01 L' }]);
        expect(r.link_status).toBe('confirmed');
        expect(r.link_reason).toBe('colorant-map');
        expect(r.zoho_item_id).toBe('Z1');
        expect(r.link_confidence).toBe(95);
    });

    test('does NOT match when the tier differs (200ml colorant, only 1L OPCL item)', () => {
        const r = catalog.linkEntryToZoho(
            { product_code: '970002', size_tier: '200ml', product_name: 'Colorant', base_name: 'Black' },
            [opclbl]);
        expect(r.link_reason).not.toBe('colorant-map');
        expect(r.link_status).toBe('needs_creating');
    });

    test('non-colorant productCode is unaffected (falls through)', () => {
        const r = catalog.linkEntryToZoho(
            { product_code: '941001', size_tier: '1L', product_name: 'X', base_name: 'Y' },
            [opclbl]);
        expect(r.link_reason).not.toBe('colorant-map');
    });
});

describe('markPushed', () => {
    test('stamps pushed_at/job/dpl/rate per row', async () => {
        const calls = [];
        catalog.setPool({ query: async (sql, params) => { calls.push({ sql, params }); return [{}]; } });
        await catalog.markPushed([{ id: 7, dpl: 510, rate: 662 }, { id: 9, dpl: 100, rate: 130 }], 86);
        expect(calls).toHaveLength(2);
        expect(calls[0].sql).toMatch(/UPDATE dpl_catalog SET pushed_at = NOW\(\), pushed_job_id = \?, pushed_dpl = \?, pushed_rate = \? WHERE id = \?/);
        expect(calls[0].params).toEqual([86, 510, 662, 7]);
        expect(calls[1].params).toEqual([86, 100, 130, 9]);
    });

    test('no rows → no query', async () => {
        const calls = [];
        catalog.setPool({ query: async (sql, params) => { calls.push({ sql, params }); return [{}]; } });
        await catalog.markPushed([], 1);
        expect(calls).toHaveLength(0);
    });
});

describe('deleteOrphans', () => {
    test('deletes rows for the brand whose match_key is not in keepKeys', async () => {
        const calls = [];
        catalog.setPool({ query: async (sql, params) => { calls.push({ sql, params }); return [{ affectedRows: 3 }]; } });
        const n = await catalog.deleteOrphans('birlaopus', ['k1', 'k2']);
        expect(n).toBe(3);
        expect(calls).toHaveLength(1);
        expect(calls[0].sql).toMatch(/DELETE FROM dpl_catalog WHERE brand = \? AND match_key NOT IN \(\?, \?\)/);
        expect(calls[0].params).toEqual(['birlaopus', 'k1', 'k2']);
    });

    test('empty keepKeys → no query, returns 0 (never wipes)', async () => {
        const calls = [];
        catalog.setPool({ query: async (sql, params) => { calls.push({ sql, params }); return [{}]; } });
        expect(await catalog.deleteOrphans('birlaopus', [])).toBe(0);
        expect(calls).toHaveLength(0);
    });
});

describe('migrate-dpl-catalog', () => {
    test('exports up() and creates the table idempotently', async () => {
        const mig = require('../../migrations/migrate-dpl-catalog');
        expect(typeof mig.up).toBe('function');

        const queries = [];
        const pool = {
            query: async (sql) => {
                queries.push(sql);
                if (/SHOW TABLES LIKE/.test(sql)) return [[]]; // table absent
                return [{}];
            }
        };
        await mig.up(pool);
        expect(queries.some(q => /CREATE TABLE dpl_catalog/.test(q))).toBe(true);
        expect(queries.some(q => /match_key/.test(q) && /UNIQUE/.test(q))).toBe(true);
    });

    test('up() skips creation when the table already exists', async () => {
        const mig = require('../../migrations/migrate-dpl-catalog');
        const queries = [];
        const pool = {
            query: async (sql) => {
                queries.push(sql);
                if (/SHOW TABLES LIKE/.test(sql)) return [[{ t: 'dpl_catalog' }]]; // present
                return [{}];
            }
        };
        await mig.up(pool);
        expect(queries.some(q => /CREATE TABLE/.test(q))).toBe(false);
    });
});

describe('setNotInZoho', () => {
    test('value=true unlinks + clears canonical + sets the flag', async () => {
        const calls = [];
        catalog.setPool({ query: async (sql, params) => { calls.push({ sql, params }); return [{}]; } });
        await catalog.setNotInZoho(5, true, 'u');
        expect(calls[0].sql).toMatch(/not_in_zoho = 1/);
        expect(calls[0].sql).toMatch(/zoho_item_id = NULL/);
        expect(calls[0].sql).toMatch(/link_status = 'needs_creating'/);
        expect(calls[0].sql).toMatch(/canonical_sku = NULL/);
        expect(calls[0].params).toEqual(['u', 5]);
    });
    test('value=false clears the flag only', async () => {
        const calls = [];
        catalog.setPool({ query: async (sql, params) => { calls.push({ sql, params }); return [{}]; } });
        await catalog.setNotInZoho(6, false, 'u');
        expect(calls[0].sql).toMatch(/SET not_in_zoho = 0, updated_by = \? WHERE id = \?/);
        expect(calls[0].params).toEqual(['u', 6]);
    });
});

describe('unlinkMarked', () => {
    test('unlinks marked-not-in-zoho entries for the brand', async () => {
        const calls = [];
        catalog.setPool({ query: async (sql, params) => { calls.push({ sql, params }); return [{ affectedRows: 2 }]; } });
        const n = await catalog.unlinkMarked('birlaopus');
        expect(n).toBe(2);
        expect(calls[0].sql).toMatch(/UPDATE dpl_catalog SET zoho_item_id = NULL/);
        expect(calls[0].sql).toMatch(/WHERE brand = \? AND not_in_zoho = 1 AND zoho_item_id IS NOT NULL/);
        expect(calls[0].params).toEqual(['birlaopus']);
    });
});
