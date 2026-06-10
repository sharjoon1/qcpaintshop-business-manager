/**
 * S2 — OTPs hashed at rest.
 *
 * Storage format is sha256 hex lowercase of the OTP string — deliberately
 * identical to MySQL's SHA2(otp, 256), so the migration
 * (migrations/20260610_otp_hash_attempts.js) could convert in-flight plaintext
 * OTPs in SQL without invalidating them.
 *
 * MAX_OTP_ATTEMPTS: after this many wrong guesses a stored OTP is consumed;
 * the per-phone rate limiter throttles request frequency, this caps total
 * guesses per issued code (6 digits = 1e6 space; 5 guesses ≈ 0.0005%).
 */
const crypto = require('crypto');

const MAX_OTP_ATTEMPTS = 5;

function hashOtp(otp) {
    return crypto.createHash('sha256').update(String(otp)).digest('hex');
}

/**
 * Timing-safe compare of a stored OTP (hash, or legacy plaintext) against a
 * candidate OTP. The plaintext fallback keeps in-flight OTPs working if the
 * code deploys before the migration runs (a 6-digit OTP can never look like
 * 64-hex, so the formats are unambiguous); the migration then converts all
 * stored values to hashes.
 */
function otpMatches(storedValue, candidate) {
    if (!storedValue || !candidate) return false;
    const stored = String(storedValue).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(stored)) {
        // Legacy plaintext row (pre-migration) — hash both sides and compare.
        return crypto.timingSafeEqual(
            Buffer.from(hashOtp(storedValue), 'hex'),
            Buffer.from(hashOtp(candidate), 'hex')
        );
    }
    return crypto.timingSafeEqual(Buffer.from(stored, 'hex'), Buffer.from(hashOtp(candidate), 'hex'));
}

module.exports = { hashOtp, otpMatches, MAX_OTP_ATTEMPTS };
