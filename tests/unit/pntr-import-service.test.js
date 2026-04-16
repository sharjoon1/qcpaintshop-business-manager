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
