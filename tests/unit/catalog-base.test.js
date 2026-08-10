/**
 * Unit tests for services/catalog-base.js — base-key extraction + main-base pick.
 * Fixtures are REAL items from the prod Zoho snapshot (2026-08-07) across all brands.
 */

const fs = require('fs');
const path = require('path');
const { parseBase, pickMainBase, isSeriesConfident } = require('../../services/catalog-base');

const fixtures = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'fixtures', 'catalog-base-fixtures.json'), 'utf8')
);

describe('catalog-base parseBase — real snapshot fixtures', () => {
    test.each(fixtures)('$name', ({ name, sku, series, base }) => {
        // brand is embedded in the fixture name; pull it from the name's " - " segments
        const brandSeg = name.split(' - ').find((s) => /(Opus|Paints|Addisons|Astral|Crizon|Generic|Fixit)/i.test(s)) || '';
        const result = parseBase(name, sku, brandSeg);
        expect(result.series).toBe(series);
        expect(result.baseKey).toBe(base);
    });
});

describe('catalog-base isSeriesConfident', () => {
    test('validated brands confident when series is real', () => {
        expect(isSeriesConfident('STYLE COLOR SMART', 'Birla Opus')).toBe(true);
        expect(isSeriesConfident('BISON GLOW EMULSION', 'Berger Paints')).toBe(true);
        expect(isSeriesConfident('ACCENT', 'Shalimar Paints')).toBe(true);
        expect(isSeriesConfident('MELAMINE', 'Shalimar Paints')).toBe(true);
        expect(isSeriesConfident('HAPPY', 'Berger Paints')).toBe(true); // single-word real series
        expect(isSeriesConfident('ONE PRO SMOOTH WALL PUTTY', 'Birla Opus')).toBe(true);
    });
    test('mangled names (bare base code as series) rejected even for validated brands', () => {
        expect(isSeriesConfident('BR', 'Berger Paints')).toBe(false);
        expect(isSeriesConfident('IV', 'Berger Paints')).toBe(false);
        expect(isSeriesConfident('CS6', 'Birla Opus')).toBe(false);
        expect(isSeriesConfident('ECM1', 'Birla Opus')).toBe(false);
        expect(isSeriesConfident('N', 'Berger Paints')).toBe(false);
        expect(isSeriesConfident('PO', 'Berger Paints')).toBe(false);
    });
    test('product-keyword series pass for other brands', () => {
        expect(isSeriesConfident('BLACK ENAMEL', 'Astral Paints')).toBe(true);
        expect(isSeriesConfident('WALL PUTTY', 'Generic')).toBe(true);
        expect(isSeriesConfident('FEATHER PRO DECO', 'Crizon')).toBe(true);
        expect(isSeriesConfident('ACE EXT EML AC17', 'Asian Paints')).toBe(true);
    });
    test('junk series (colour/base codes) rejected for other brands', () => {
        expect(isSeriesConfident('BR', 'Generic')).toBe(false);
        expect(isSeriesConfident('IV', 'Generic')).toBe(false);
        expect(isSeriesConfident('RD', 'Generic')).toBe(false);
        expect(isSeriesConfident('PO', 'Generic')).toBe(false);
        expect(isSeriesConfident('W1', 'Generic')).toBe(false);
        expect(isSeriesConfident('BLACK', 'Generic')).toBe(false);
        expect(isSeriesConfident('RED', 'Astral Paints')).toBe(false);
        expect(isSeriesConfident('', 'Birla Opus')).toBe(false);
        expect(isSeriesConfident(null, 'Generic')).toBe(false);
    });
});

describe('catalog-base pickMainBase', () => {
    test('prefers the base with most pack sizes', () => {
        expect(pickMainBase(['CS1', 'CS1', 'CS1', 'CS1', 'CS2', 'CS2', 'CS5', 'CS99'])).toBe('CS1');
    });
    test('prefers WT on equal counts', () => {
        expect(pickMainBase(['CS2', 'CSWT', 'CS2', 'CSWT'])).toBe('CSWT');
    });
    test('lowest base number on equal counts (no WT)', () => {
        expect(pickMainBase(['CS5', 'CS2', 'CS5', 'CS2'])).toBe('CS2');
    });
    test('single base returns it', () => {
        expect(pickMainBase(['NS1', 'NS1', 'NS1', 'NS1'])).toBe('NS1');
    });
    test('nulls ignored', () => {
        expect(pickMainBase([null, null, 'N', 'N'])).toBe('N');
    });
    test('empty -> null', () => {
        expect(pickMainBase([])).toBeNull();
        expect(pickMainBase([null])).toBeNull();
    });
});
