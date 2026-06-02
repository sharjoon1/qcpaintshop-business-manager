const { samePhone } = require('../../services/phone-match');

describe('samePhone', () => {
    test('matches identical 10-digit numbers', () => {
        expect(samePhone('9876543210', '9876543210')).toBe(true);
    });
    test('ignores country code and formatting', () => {
        expect(samePhone('+91 98765 43210', '9876543210')).toBe(true);
        expect(samePhone('919876543210', '9876543210')).toBe(true);
    });
    test('rejects different numbers', () => {
        expect(samePhone('9876543210', '9999999999')).toBe(false);
    });
    test('rejects when either side is empty/short (security default)', () => {
        expect(samePhone('', '9876543210')).toBe(false);
        expect(samePhone(null, null)).toBe(false);
        expect(samePhone('12345', '12345')).toBe(false);
    });
});
