/**
 * S2 — OTP-at-rest hashing helpers.
 * Locks: sha256-hex-lowercase format (MUST equal MySQL SHA2(otp,256) so the
 * migration can convert in-flight OTPs without invalidating them), timing-safe
 * match semantics, and the attempt cap constant.
 */
const { hashOtp, otpMatches, MAX_OTP_ATTEMPTS } = require('../../services/otp-utils');
const crypto = require('crypto');

describe('hashOtp', () => {
    test('returns sha256 hex lowercase of the OTP string', () => {
        const expected = crypto.createHash('sha256').update('123456').digest('hex');
        expect(hashOtp('123456')).toBe(expected);
        expect(hashOtp('123456')).toMatch(/^[0-9a-f]{64}$/);
    });

    test('numeric input hashes identically to its string form (MySQL SHA2 parity)', () => {
        expect(hashOtp(123456)).toBe(hashOtp('123456'));
    });

    test('different OTPs hash differently', () => {
        expect(hashOtp('123456')).not.toBe(hashOtp('123457'));
    });
});

describe('otpMatches', () => {
    test('matches when the candidate hashes to the stored hash', () => {
        expect(otpMatches(hashOtp('654321'), '654321')).toBe(true);
    });

    test('rejects a wrong candidate', () => {
        expect(otpMatches(hashOtp('654321'), '654322')).toBe(false);
    });

    test('rejects null/empty stored hash or candidate without throwing', () => {
        expect(otpMatches(null, '123456')).toBe(false);
        expect(otpMatches(undefined, '123456')).toBe(false);
        expect(otpMatches('', '123456')).toBe(false);
        expect(otpMatches(hashOtp('123456'), '')).toBe(false);
        expect(otpMatches(hashOtp('123456'), null)).toBe(false);
    });

    test('legacy plaintext stored row matches its plaintext value (rollout window)', () => {
        expect(otpMatches('123456', '123456')).toBe(true);
        expect(otpMatches('123456', '999999')).toBe(false);
    });

    test('is case-insensitive on the stored hash (MySQL SHA2 vs manual entry)', () => {
        expect(otpMatches(hashOtp('111111').toUpperCase(), '111111')).toBe(true);
    });
});

describe('MAX_OTP_ATTEMPTS', () => {
    test('is 5', () => {
        expect(MAX_OTP_ATTEMPTS).toBe(5);
    });
});
