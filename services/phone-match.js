/**
 * phone-match.js — phone identity check by last-10 digits.
 * Returns true only when both inputs normalise to the SAME full 10-digit number,
 * so empty/partial values never match (secure default for ownership checks).
 */
function normalize(p) {
    return String(p == null ? '' : p).replace(/\D/g, '').slice(-10);
}

function samePhone(a, b) {
    const na = normalize(a);
    const nb = normalize(b);
    return na.length === 10 && na === nb;
}

module.exports = { samePhone, normalize };
