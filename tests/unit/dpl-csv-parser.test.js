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

const { parseBirlaOpusCsv } = require('../../services/price-list-parser');

// Minimal 2-row CSV: header + one SKU row with 2 non-empty sizes
const MINIMAL_CSV = [
    'Category,Segment,Product Name,Product Code,Base Code (SKU),Base / Colour Name,200ML,1L,4L,18L',
    'Interior,Luxury,One Pure Elegance,941001,PE White,9900 - White,,520,,',
].join('\n');

const MINIMAL_CSV_WITH_BOM = '﻿' + MINIMAL_CSV;

describe('parseBirlaOpusCsv — exports', () => {
    test('is exported as a function', () => {
        expect(typeof parseBirlaOpusCsv).toBe('function');
    });
});

describe('parseBirlaOpusCsv — happy path', () => {
    test('parses a single non-empty cell from minimal CSV string', () => {
        const buf = Buffer.from(MINIMAL_CSV);
        const out = parseBirlaOpusCsv(buf);
        expect(out).toHaveLength(1);
        const item = out[0];
        expect(item.dpl).toBe(520);
        expect(item.packSize).toBe('1L');
        expect(item.baseCode).toBe('PE White');
        expect(item.colourCode).toBe('9900');
        expect(item.colourName).toBe('White');
        expect(item.productName).toBe('One Pure Elegance');
        expect(item.productCode).toBe('941001');
        expect(item.category).toBe('Interior');
        expect(item.segment).toBe('Luxury');
        expect(item.brand).toBe('Birla Opus');
        expect(item.product).toBe('One Pure Elegance - White');
    });

    test('strips UTF-8 BOM', () => {
        const buf = Buffer.from(MINIMAL_CSV_WITH_BOM, 'utf8');
        const out = parseBirlaOpusCsv(buf);
        expect(out).toHaveLength(1);
        expect(out[0].dpl).toBe(520);
    });

    test('pre-computes _proposedName, _proposedZohoSku, _proposedDescription', () => {
        const buf = Buffer.from(MINIMAL_CSV);
        const item = parseBirlaOpusCsv(buf)[0];
        expect(item._proposedName).toBe('PE WHITE ONE PURE ELEGANCE WHITE BIRLA OPUS 1L');
        expect(item._proposedZohoSku).toBe('PEWHITE-1L');
        expect(item._proposedDescription).toContain('Birla Opus One Pure Elegance');
        expect(item._proposedDescription).toContain('DPL: ₹520');
    });

    test('skips empty price cells', () => {
        const csv = [
            'Category,Segment,Product Name,Product Code,Base Code (SKU),Base / Colour Name,200ML,1L,4L',
            'Interior,Luxury,One Pure Elegance,941001,PE White,9900 - White,,,',
        ].join('\n');
        const out = parseBirlaOpusCsv(Buffer.from(csv));
        expect(out).toHaveLength(0);
    });

    test('skips non-numeric price cells', () => {
        const csv = [
            'Category,Segment,Product Name,Product Code,Base Code (SKU),Base / Colour Name,1L',
            'Interior,Luxury,One Pure Elegance,941001,PE White,9900 - White,N/A',
        ].join('\n');
        const out = parseBirlaOpusCsv(Buffer.from(csv));
        expect(out).toHaveLength(0);
    });

    test('skips zero and negative price cells', () => {
        const csv = [
            'Category,Segment,Product Name,Product Code,Base Code (SKU),Base / Colour Name,1L,4L',
            'Interior,Luxury,Test,000001,T 1,9900 - White,0,-10',
        ].join('\n');
        const out = parseBirlaOpusCsv(Buffer.from(csv));
        expect(out).toHaveLength(0);
    });

    test('handles comma-formatted prices (1,930 → 1930)', () => {
        const csv = [
            'Category,Segment,Product Name,Product Code,Base Code (SKU),Base / Colour Name,4L',
            'Interior,Luxury,One Pure Elegance,941001,PE White,9900 - White,"1,930"',
        ].join('\n');
        const out = parseBirlaOpusCsv(Buffer.from(csv));
        expect(out).toHaveLength(1);
        expect(out[0].dpl).toBe(1930);
    });

    test('parses multiple sizes from one SKU row', () => {
        const csv = [
            'Category,Segment,Product Name,Product Code,Base Code (SKU),Base / Colour Name,200ML,1L,4L',
            'Interior,Luxury,One Pure Elegance,941001,PE White,9900 - White,107,520,2050',
        ].join('\n');
        const out = parseBirlaOpusCsv(Buffer.from(csv));
        expect(out).toHaveLength(3);
        expect(out.map(i => i.packSize).sort()).toEqual(['1L', '200ML', '4L'].sort());
        expect(out.find(i => i.packSize === '1L').dpl).toBe(520);
        expect(out.find(i => i.packSize === '200ML').dpl).toBe(107);
    });

    test('splits colour code and name from "Base / Colour Name"', () => {
        const csv = [
            'Category,Segment,Product Name,Product Code,Base Code (SKU),Base / Colour Name,0.9L',
            'Interior,Luxury,Calista Neo Star,942002,NS 2,9902 - Mid Tone,506',
        ].join('\n');
        const item = parseBirlaOpusCsv(Buffer.from(csv))[0];
        expect(item.colourCode).toBe('9902');
        expect(item.colourName).toBe('Mid Tone');
        expect(item.product).toBe('Calista Neo Star - Mid Tone');
    });

    test('handles CRLF line endings (Windows files)', () => {
        const csv = 'Category,Segment,Product Name,Product Code,Base Code (SKU),Base / Colour Name,1L\r\nInterior,Luxury,One Pure Elegance,941001,PE White,9900 - White,520';
        const out = parseBirlaOpusCsv(Buffer.from(csv));
        expect(out).toHaveLength(1);
        expect(out[0].dpl).toBe(520);
        expect(out[0].packSize).toBe('1L');
    });

    test('handles missing colour separator (no " - ")', () => {
        const csv = [
            'Category,Segment,Product Name,Product Code,Base Code (SKU),Base / Colour Name,1L',
            'Interior,Luxury,Test,001,T 1,NoCodeHere,500',
        ].join('\n');
        const item = parseBirlaOpusCsv(Buffer.from(csv))[0];
        expect(item.colourCode).toBe('');
        expect(item.colourName).toBe('NoCodeHere');
    });

    test('skips rows with fewer columns than header', () => {
        const csv = [
            'Category,Segment,Product Name,Product Code,Base Code (SKU),Base / Colour Name,1L',
            'Interior,Luxury',  // too short — only 2 cols
        ].join('\n');
        expect(parseBirlaOpusCsv(Buffer.from(csv))).toEqual([]);
    });

    test('returns empty array for empty buffer', () => {
        expect(parseBirlaOpusCsv(Buffer.from(''))).toEqual([]);
    });

    test('returns empty array for header-only CSV', () => {
        const csv = 'Category,Segment,Product Name,Product Code,Base Code (SKU),Base / Colour Name,1L';
        expect(parseBirlaOpusCsv(Buffer.from(csv))).toEqual([]);
    });
});
