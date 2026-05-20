const { computeProposedFields, matchWithZohoItems } = require('../../services/price-list-parser');

describe('computeProposedFields — CSV pre-set pass-through', () => {
    test('returns pre-set _proposedName when present', () => {
        const pdfItem = {
            dpl: 520,
            _proposedName: 'PE WHITE ONE PURE ELEGANCE WHITE BIRLA OPUS 1L',
            _proposedZohoSku: 'PEWHITE-1L',
            _proposedDescription: 'Birla Opus One Pure Elegance | ...',
        };
        const zohoItem = { sku: 'OLDSKU', description: '', category: '', rate: 0 };
        const result = computeProposedFields(pdfItem, zohoItem, 'birlaopus');
        expect(result.proposed_name).toBe('PE WHITE ONE PURE ELEGANCE WHITE BIRLA OPUS 1L');
        expect(result.proposed_sku).toBe('PEWHITE-1L');
        expect(result.proposed_description).toBe('Birla Opus One Pure Elegance | ...');
    });

    test('still computes proposed_rate from dpl when _proposedName is set', () => {
        const pdfItem = {
            dpl: 520,
            _proposedName: 'PE WHITE ONE PURE ELEGANCE WHITE BIRLA OPUS 1L',
            _proposedZohoSku: 'PEWHITE-1L',
            _proposedDescription: 'desc',
        };
        const zohoItem = { sku: '', description: '', category: '', rate: 0 };
        const result = computeProposedFields(pdfItem, zohoItem, 'birlaopus');
        expect(result.proposed_rate).toBe(Math.ceil(520 * 1.298));
    });

    test('falls through to existing logic when _proposedName is absent', () => {
        const pdfItem = { dpl: 0, product: 'Test' };
        const zohoItem = { sku: '', description: '', category: '', rate: 0 };
        const result = computeProposedFields(pdfItem, zohoItem, 'birlaopus');
        expect(result.proposed_name).toBeUndefined();
    });
});

describe('matchWithZohoItems — exact SKU branch', () => {
    const makeCsvItem = (sku, dpl = 520) => ({
        product: 'One Pure Elegance - White',
        packSize: '1L',
        dpl,
        brand: 'Birla Opus',
        category: 'INTERIOR EMULSION',
        baseCode: 'PE White',
        _proposedZohoSku: sku,
        _proposedName: 'PE WHITE ONE PURE ELEGANCE WHITE BIRLA OPUS 1L',
        _proposedDescription: 'desc',
    });

    const makeZohoItem = (sku, name) => ({
        zoho_item_id: 'ZI001',
        name,
        sku,
        zoho_sku: sku,
        rate: 675,
        brand: 'Birla Opus',
        zoho_brand: 'Birla Opus',
        category: 'INTERIOR EMULSION',
        description: '',
    });

    test('exact SKU match places item in matched array', () => {
        const parsed = [makeCsvItem('PEWHITE-1L')];
        const zoho = [makeZohoItem('PEWHITE-1L', 'PE WHITE ONE PURE ELEGANCE WHITE BIRLA OPUS 1L')];
        const result = matchWithZohoItems(parsed, zoho);
        expect(result.matched).toHaveLength(1);
        expect(result.unmatched).toHaveLength(0);
        expect(result.matched[0].zoho_item_id).toBe('ZI001');
    });

    test('unmatched when exact SKU not found in Zoho', () => {
        const parsed = [makeCsvItem('NOTEXIST-1L')];
        const zoho = [makeZohoItem('PEWHITE-1L', 'PE WHITE ONE PURE ELEGANCE WHITE BIRLA OPUS 1L')];
        const result = matchWithZohoItems(parsed, zoho);
        expect(result.unmatched).toHaveLength(1);
    });

    test('non-CSV items (no _proposedZohoSku) go through fuzzy matching unchanged', () => {
        const pdfItem = {
            product: 'One Pure Elegance - White',
            packSize: '1L',
            dpl: 520,
            brand: 'Birla Opus',
            category: 'INTERIOR EMULSION',
        };
        const zoho = [makeZohoItem('PEWHITE-1L', 'PE WHITE ONE PURE ELEGANCE WHITE BIRLA OPUS 1L')];
        expect(() => matchWithZohoItems([pdfItem], zoho)).not.toThrow();
    });
});
