// tests/unit/pntr-import-service.test.js
const { normalizePhone, parseBranchPrefix } = require('../../services/pntr-import-service');

describe('normalizePhone', () => {
    test('keeps 10-digit clean phone', () => {
        expect(normalizePhone('9876543210')).toBe('9876543210');
    });
    test('strips country code 91', () => {
        expect(normalizePhone('919876543210')).toBe('9876543210');
        expect(normalizePhone('+91 98765 43210')).toBe('9876543210');
    });
    test('strips formatting', () => {
        expect(normalizePhone('(987) 654-3210')).toBe('9876543210');
    });
    test('rejects empty / too short', () => {
        expect(normalizePhone('')).toBeNull();
        expect(normalizePhone(null)).toBeNull();
        expect(normalizePhone('123')).toBeNull();
    });
    test('rejects 12-digit not starting with 91', () => {
        expect(normalizePhone('441234567890')).toBeNull();
    });
});

describe('parseBranchPrefix', () => {
    const branches = [
        { id: 1, code: 'RMD' }, { id: 2, code: 'TCM' },
        { id: 3, code: 'PKD' }, { id: 4, code: 'RMM' }, { id: 5, code: 'PBN' }
    ];
    test('parses PNTR RMD <name>', () => {
        expect(parseBranchPrefix('PNTR RMD Karthik', branches)).toEqual({ id: 1, code: 'RMD' });
    });
    test('case-insensitive', () => {
        expect(parseBranchPrefix('pntr tcm Mani', branches)).toEqual({ id: 2, code: 'TCM' });
    });
    test('handles extra spaces', () => {
        expect(parseBranchPrefix('PNTR  PKD  Ravi', branches)).toEqual({ id: 3, code: 'PKD' });
    });
    test('returns null when code unknown', () => {
        expect(parseBranchPrefix('PNTR XYZ Someone', branches)).toBeNull();
    });
    test('returns null when no PNTR prefix', () => {
        expect(parseBranchPrefix('RMD Karthik', branches)).toBeNull();
    });
});

const { matchSalesperson, levenshtein, parseSalespersonPhoneSuffix } = require('../../services/pntr-import-service');

describe('parseSalespersonPhoneSuffix', () => {
    test('extracts 10-digit suffix', () => {
        expect(parseSalespersonPhoneSuffix('Karthik 9876543210')).toBe('9876543210');
    });
    test('returns null when no suffix', () => {
        expect(parseSalespersonPhoneSuffix('Karthik')).toBeNull();
    });
});

describe('levenshtein', () => {
    test('identical strings → 0', () => {
        expect(levenshtein('karthik', 'karthik')).toBe(0);
    });
    test('one edit', () => {
        expect(levenshtein('karthik', 'kartik')).toBe(1);
    });
});

describe('matchSalesperson', () => {
    const painters = [
        { id: 10, full_name: 'Karthik', phone: '9876543210' },
        { id: 11, full_name: 'Ravi Kumar', phone: '9123456789' }
    ];
    test('exact phone match', () => {
        const res = matchSalesperson({ name: 'Karthik 9876543210' }, painters);
        expect(res).toEqual({ painter_id: 10, confidence: 'exact_phone' });
    });
    test('exact name match when phone missing', () => {
        const res = matchSalesperson({ name: 'Ravi Kumar' }, painters);
        expect(res).toEqual({ painter_id: 11, confidence: 'exact_name' });
    });
    test('fuzzy name (Levenshtein < 3)', () => {
        const res = matchSalesperson({ name: 'Kartik' }, painters);
        expect(res).toEqual({ painter_id: 10, confidence: 'fuzzy_name' });
    });
    test('unmatched returns null painter_id', () => {
        const res = matchSalesperson({ name: 'Completely Different' }, painters);
        expect(res).toEqual({ painter_id: null, confidence: 'unmatched' });
    });
});
