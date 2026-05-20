const {
    buildProperBirlaItemName,
    buildProperBirlaZohoSku,
    buildProperBirlaDescription,
} = require('../../services/price-list-parser');

describe('buildProperBirlaItemName', () => {
    test('basic emulsion: BASE + PRODUCT + COLOUR + BIRLA OPUS + SIZE', () => {
        const row = { baseCode: 'PE White', productName: 'One Pure Elegance', colourName: 'White', size: '1L' };
        expect(buildProperBirlaItemName(row)).toBe('PE WHITE ONE PURE ELEGANCE WHITE BIRLA OPUS 1L');
    });

    test('numbered base code', () => {
        const row = { baseCode: 'NS 2', productName: 'Calista Neo Star', colourName: 'Mid Tone', size: '0.9L' };
        expect(buildProperBirlaItemName(row)).toBe('NS 2 CALISTA NEO STAR MID TONE BIRLA OPUS 0.9L');
    });

    test('KG size', () => {
        const row = { baseCode: 'EW 01', productName: 'Birla Opus Exterior', colourName: 'White', size: '20KG' };
        expect(buildProperBirlaItemName(row)).toBe('EW 01 BIRLA OPUS EXTERIOR WHITE BIRLA OPUS 20KG');
    });

    test('ML size', () => {
        const row = { baseCode: 'PE 1', productName: 'One Pure Elegance', colourName: 'Pastel', size: '200ML' };
        expect(buildProperBirlaItemName(row)).toBe('PE 1 ONE PURE ELEGANCE PASTEL BIRLA OPUS 200ML');
    });

    test('Per Unit size passes through unchanged', () => {
        const row = { baseCode: 'RR 01', productName: 'Paint Roller', colourName: '', size: 'Per Unit' };
        expect(buildProperBirlaItemName(row)).toBe('RR 01 PAINT ROLLER BIRLA OPUS Per Unit');
    });

    test('two-word colour name (TF 1 / Ananya Textura / Tintable White / 18L)', () => {
        const row = { baseCode: 'TF 1', productName: 'Ananya Textura', colourName: 'Tintable White', size: '18L' };
        expect(buildProperBirlaItemName(row)).toBe('TF 1 ANANYA TEXTURA TINTABLE WHITE BIRLA OPUS 18L');
    });
});

describe('buildProperBirlaZohoSku', () => {
    test('strips spaces from base code', () => {
        expect(buildProperBirlaZohoSku({ baseCode: 'PE White', size: '1L' })).toBe('PEWHITE-1L');
    });

    test('numbered code', () => {
        expect(buildProperBirlaZohoSku({ baseCode: 'NS 2', size: '0.9L' })).toBe('NS2-0.9L');
    });

    test('KG size', () => {
        expect(buildProperBirlaZohoSku({ baseCode: 'TF 1', size: '18L' })).toBe('TF1-18L');
    });

    test('Per Unit', () => {
        expect(buildProperBirlaZohoSku({ baseCode: 'RR 01', size: 'Per Unit' })).toBe('RR01-Per Unit');
    });

    test('multi-space base code', () => {
        expect(buildProperBirlaZohoSku({ baseCode: 'PE  1', size: '4L' })).toBe('PE1-4L');
    });

    test('numeric suffix base code + KG size (EW 01 / 20KG)', () => {
        expect(buildProperBirlaZohoSku({ baseCode: 'EW 01', size: '20KG' })).toBe('EW01-20KG');
    });
});

describe('buildProperBirlaDescription', () => {
    test('formats all fields correctly', () => {
        const row = {
            productName: 'One Pure Elegance',
            colourCode: '9900',
            colourName: 'White',
            size: '1L',
            productCode: '941001',
            category: 'Interior',
            segment: 'Luxury',
            dpl: 520,
        };
        expect(buildProperBirlaDescription(row, '2026-05-15')).toBe(
            'Birla Opus One Pure Elegance | 9900 - White | Pack: 1L | Code: 941001 | Interior - Luxury | DPL: ₹520 | Effective: 15 May 2026'
        );
    });

    test('handles decimal DPL', () => {
        const row = { productName: 'Test', colourCode: '9900', colourName: 'White', size: '4L', productCode: '001', category: 'Enamel', segment: 'Premium', dpl: 1234.5 };
        const result = buildProperBirlaDescription(row, '2026-05-15');
        expect(result).toContain('DPL: ₹1234.5');
    });

    test('returns empty effective date for missing or malformed effectiveDate', () => {
        const row = { productName: 'Test', colourCode: '001', colourName: 'White', size: '1L', productCode: '001', category: 'Interior', segment: 'Luxury', dpl: 100 };
        expect(buildProperBirlaDescription(row, undefined)).toContain('Effective: ');
        expect(buildProperBirlaDescription(row, 'invalid-date')).toContain('Effective: ');
        expect(buildProperBirlaDescription(row, '2026/05/15')).toContain('Effective: ');
    });
});
