const {
    isEmulsionCategory,
    isEnamelCategory,
    extractEmulsionProductName,
    extractEnamelProductAndColor,
    stripDuplicateSkuPrefix,
    buildBirlaName,
    computeProposedFields,
} = require('../../services/price-list-parser');

describe('Birla Opus DPL naming — scaffold', () => {
    test('all helpers are exported', () => {
        expect(typeof isEmulsionCategory).toBe('function');
        expect(typeof isEnamelCategory).toBe('function');
        expect(typeof extractEmulsionProductName).toBe('function');
        expect(typeof extractEnamelProductAndColor).toBe('function');
        expect(typeof stripDuplicateSkuPrefix).toBe('function');
        expect(typeof buildBirlaName).toBe('function');
    });
});

describe('isEmulsionCategory', () => {
    test('matches Interior Emulsion', () => {
        expect(isEmulsionCategory('INTERIOR EMULSION')).toBe(true);
    });
    test('matches Exterior Emulsion (case-insensitive)', () => {
        expect(isEmulsionCategory('Exterior Emulsion')).toBe(true);
    });
    test('rejects Enamel', () => {
        expect(isEmulsionCategory('ENAMEL')).toBe(false);
    });
    test('rejects null and empty', () => {
        expect(isEmulsionCategory(null)).toBe(false);
        expect(isEmulsionCategory('')).toBe(false);
    });
});

describe('isEnamelCategory', () => {
    test('matches ENAMEL', () => {
        expect(isEnamelCategory('ENAMEL')).toBe(true);
    });
    test('rejects Interior Emulsion', () => {
        expect(isEnamelCategory('INTERIOR EMULSION')).toBe(false);
    });
    test('rejects null', () => {
        expect(isEnamelCategory(null)).toBe(false);
    });
});

describe('extractEmulsionProductName', () => {
    test('strips variant suffix and uppercases', () => {
        expect(extractEmulsionProductName('Ever Stay - White')).toBe('EVER STAY');
    });
    test('handles Pastel variant', () => {
        expect(extractEmulsionProductName('Calista Ever Clear - Pastel')).toBe('CALISTA EVER CLEAR');
    });
    test('keeps tier word ONE', () => {
        expect(extractEmulsionProductName('One Pure Elegance - Mid Tone')).toBe('ONE PURE ELEGANCE');
    });
    test('returns name unchanged when no separator', () => {
        expect(extractEmulsionProductName('Style Color Fresh')).toBe('STYLE COLOR FRESH');
    });
    test('skips ANNEXURE prefix and uses meaningful part', () => {
        expect(extractEmulsionProductName('Annexure - Calista Sparkle PU')).toBe('CALISTA SPARKLE PU');
    });
    test('handles empty', () => {
        expect(extractEmulsionProductName('')).toBe('');
        expect(extractEmulsionProductName(null)).toBe('');
    });
});

describe('extractEnamelProductAndColor', () => {
    test('splits product and color on dash', () => {
        expect(extractEnamelProductAndColor('Calista Sparkle - Blue')).toEqual({
            productName: 'CALISTA SPARKLE',
            color: 'BLUE',
        });
    });
    test('handles multi-word color', () => {
        expect(extractEnamelProductAndColor('Calista Sparkle - Deep Orange')).toEqual({
            productName: 'CALISTA SPARKLE',
            color: 'DEEP ORANGE',
        });
    });
    test('color empty when no separator', () => {
        expect(extractEnamelProductAndColor('Cover Max')).toEqual({
            productName: 'COVER MAX',
            color: '',
        });
    });
    test('handles empty', () => {
        expect(extractEnamelProductAndColor('')).toEqual({ productName: '', color: '' });
        expect(extractEnamelProductAndColor(null)).toEqual({ productName: '', color: '' });
    });
});

describe('stripDuplicateSkuPrefix', () => {
    test('strips leading SKU-prefix token (CSWT case)', () => {
        // SKU = CSWT20, name starts with "CSWT STYLE COLOR SMART ..."
        expect(stripDuplicateSkuPrefix('CSWT STYLE COLOR SMART BIRLA OPUS', 'CSWT20'))
            .toBe('STYLE COLOR SMART BIRLA OPUS');
    });
    test('strips full SKU + dangling unit (CSTSBK500ML case)', () => {
        // SKU = CSTSBK500ML, name = "CSTSBK500 ML CST SATIN BLACK ..."
        expect(stripDuplicateSkuPrefix('CSTSBK500 ML CST SATIN BLACK ENAMEL', 'CSTSBK500ML'))
            .toBe('CST SATIN BLACK ENAMEL');
    });
    test('strips full SKU + dangling L (AWPUEM01L case)', () => {
        expect(stripDuplicateSkuPrefix('AWPUEM01 L PU EXTERIOR MATT', 'AWPUEM01L'))
            .toBe('PU EXTERIOR MATT');
    });
    test('does not strip when name does not duplicate SKU', () => {
        expect(stripDuplicateSkuPrefix('CALISTA EVER STAY BIRLA OPUS', 'ES101'))
            .toBe('CALISTA EVER STAY BIRLA OPUS');
    });
    test('handles missing sku gracefully', () => {
        expect(stripDuplicateSkuPrefix('CALISTA EVER STAY', '')).toBe('CALISTA EVER STAY');
        expect(stripDuplicateSkuPrefix('CALISTA EVER STAY', null)).toBe('CALISTA EVER STAY');
    });
    test('handles empty name', () => {
        expect(stripDuplicateSkuPrefix('', 'CSWT20')).toBe('');
    });
});

describe('buildBirlaName', () => {
    test('emulsion canonical: WT-base no duplicate', () => {
        expect(buildBirlaName({
            sku: 'ESWT01',
            pdfProduct: 'Calista Ever Stay - White',
            category: 'INTERIOR EMULSION',
            packFormatted: '01 L',
        })).toBe('ESWT01 CALISTA EVER STAY BIRLA OPUS 01 L');
    });

    test('emulsion canonical: non-WT base (Pastel)', () => {
        expect(buildBirlaName({
            sku: 'ES101',
            pdfProduct: 'Calista Ever Stay - Pastel',
            category: 'INTERIOR EMULSION',
            packFormatted: '01 L',
        })).toBe('ES101 CALISTA EVER STAY BIRLA OPUS 01 L');
    });

    test('emulsion: ONE tier preserved, Mid Tone variant stripped', () => {
        expect(buildBirlaName({
            sku: 'PE204',
            pdfProduct: 'One Pure Elegance - Mid Tone',
            category: 'INTERIOR EMULSION',
            packFormatted: '04 L',
        })).toBe('PE204 ONE PURE ELEGANCE BIRLA OPUS 04 L');
    });

    test('exterior emulsion uses same emulsion format', () => {
        expect(buildBirlaName({
            sku: 'TL9920',
            pdfProduct: 'One True Look - Clear',
            category: 'EXTERIOR EMULSION',
            packFormatted: '20 L',
        })).toBe('TL9920 ONE TRUE LOOK BIRLA OPUS 20 L');
    });

    test('enamel: color preserved with ENAMEL keyword', () => {
        expect(buildBirlaName({
            sku: 'CSTBL01',
            pdfProduct: 'Calista Sparkle - Blue',
            category: 'ENAMEL',
            packFormatted: '01 L',
        })).toBe('CSTBL01 CALISTA SPARKLE ENAMEL BLUE BIRLA OPUS 01 L');
    });

    test('enamel: multi-word color', () => {
        expect(buildBirlaName({
            sku: 'CSTDOR01',
            pdfProduct: 'Calista Sparkle - Deep Orange',
            category: 'ENAMEL',
            packFormatted: '01 L',
        })).toBe('CSTDOR01 CALISTA SPARKLE ENAMEL DEEP ORANGE BIRLA OPUS 01 L');
    });

    test('enamel: no dash → empty color, no double space', () => {
        expect(buildBirlaName({
            sku: 'CME500',
            pdfProduct: 'Cover Max',
            category: 'ENAMEL',
            packFormatted: '500 ML',
        })).toBe('CME500 COVER MAX ENAMEL BIRLA OPUS 500 ML');
    });

    test('strips duplicate SKU prefix even if input PDF name contains it', () => {
        expect(buildBirlaName({
            sku: 'CSWT20',
            pdfProduct: 'CSWT Calista Color Smart - White',
            category: 'INTERIOR EMULSION',
            packFormatted: '20 L',
        })).toBe('CSWT20 CALISTA COLOR SMART BIRLA OPUS 20 L');
    });

    test('non-emulsion non-enamel falls back to emulsion format', () => {
        expect(buildBirlaName({
            sku: 'PHP20',
            pdfProduct: 'Style Pro Hide Primer',
            category: 'INTERIOR PRIMER',
            packFormatted: '20 L',
        })).toBe('PHP20 STYLE PRO HIDE PRIMER BIRLA OPUS 20 L');
    });

    test('returns null when sku missing', () => {
        expect(buildBirlaName({
            sku: '',
            pdfProduct: 'Ever Stay',
            category: 'INTERIOR EMULSION',
            packFormatted: '01 L',
        })).toBeNull();
    });

    test('returns null when packFormatted missing', () => {
        expect(buildBirlaName({
            sku: 'ES101',
            pdfProduct: 'Ever Stay',
            category: 'INTERIOR EMULSION',
            packFormatted: '',
        })).toBeNull();
    });
});
