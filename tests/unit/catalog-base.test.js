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
    test('Berger BR/IV/RD/W1 base prefixes extracted', () => {
        const r1 = parseBase('FLXBR01L - BR FLEXO EMULSION - INTERIOR EMULSION - Berger Paints - 01 L', '', 'Berger Paints');
        expect(r1.baseKey).toBe('BR');
        expect(r1.series).toBe('FLEXO EMULSION');
        const r2 = parseBase('CADTIV01L - IV ANTIDUST EMULSION - INTERIOR EMULSION - Berger Paints - 01 L', '', 'Berger Paints');
        expect(r2.baseKey).toBe('IV');
        expect(r2.series).toBe('ANTIDUST EMULSION');
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
        expect(pickMainBase(['CS1', 'CS1', 'CS1', 'CS1', 'CS2', 'CS2', 'CS5', 'CS99'], 'Birla Opus')).toBe('CS1');
    });
    test('Birla prefers base-1 code even when another base has more packs', () => {
        expect(pickMainBase(['CS2', 'CS2', 'CS2', 'CS2', 'CS1', 'CS1'], 'Birla Opus')).toBe('CS1');
    });
    test('Birla base-1 exact match over CS13-style codes', () => {
        expect(pickMainBase(['CS13', 'CS13', 'CS13', 'CS1', 'CS1'], 'Birla Opus')).toBe('CS1');
    });
    test('Birla without base-1 falls back to most packs', () => {
        expect(pickMainBase(['CF13', 'CF13', 'CF13', 'CF13', 'CF99', 'CF99'], 'Birla Opus')).toBe('CF13');
    });
    test('Berger prefers PO over N even when N has more packs', () => {
        expect(pickMainBase(['N', 'N', 'N', 'N', 'PO', 'PO'], 'Berger Paints')).toBe('PO');
    });
    test('Berger without PO falls back to most packs', () => {
        expect(pickMainBase(['N', 'N', 'N', 'N', 'Y', 'Y'], 'Berger Paints')).toBe('N');
    });
    test('other brands keep most-packs behaviour', () => {
        expect(pickMainBase(['A', 'A', 'A', 'B', 'B'], 'Addisons')).toBe('A');
    });
    test('prefers WT on equal counts (non-Birla)', () => {
        expect(pickMainBase(['X2', 'XWT', 'X2', 'XWT'], 'Generic')).toBe('XWT');
    });
    test('lowest base number on equal counts (no WT)', () => {
        expect(pickMainBase(['CS5', 'CS2', 'CS5', 'CS2'], 'Generic')).toBe('CS2');
    });
    test('single base returns it', () => {
        expect(pickMainBase(['NS1', 'NS1', 'NS1', 'NS1'], 'Birla Opus')).toBe('NS1');
    });
    test('nulls ignored', () => {
        expect(pickMainBase([null, null, 'N', 'N'], 'Berger Paints')).toBe('N');
    });
    test('empty -> null', () => {
        expect(pickMainBase([], 'Birla Opus')).toBeNull();
        expect(pickMainBase([null], 'Berger Paints')).toBeNull();
    });
});
