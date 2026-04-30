/**
 * idempotency-fetch.js (U17)
 *
 * Drop-in helper to attach an Idempotency-Key header to a fetch() call.
 * Usage:
 *   const key = qcIdempotencyKey();          // generate once when user clicks submit
 *   await fetch('/api/billing/estimates', {
 *       method: 'POST',
 *       headers: qcWithIdempotency(key, { 'Content-Type': 'application/json', ... }),
 *       body: JSON.stringify(payload)
 *   });
 *
 * If the same `key` is used a second time within 24h on the same scope,
 * the server replays the original response (header `Idempotent-Replay: true`).
 *
 * Safe to retry on network error — pass the SAME key.
 */
(function () {
    function uuid() {
        if (window.crypto && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
        // Fallback for older browsers (RFC4122 v4-ish from random bytes)
        const b = new Uint8Array(16);
        (window.crypto || window.msCrypto).getRandomValues(b);
        b[6] = (b[6] & 0x0f) | 0x40;
        b[8] = (b[8] & 0x3f) | 0x80;
        const h = Array.from(b, x => x.toString(16).padStart(2, '0'));
        return `${h.slice(0,4).join('')}-${h.slice(4,6).join('')}-${h.slice(6,8).join('')}-${h.slice(8,10).join('')}-${h.slice(10,16).join('')}`;
    }

    window.qcIdempotencyKey = uuid;

    window.qcWithIdempotency = function (key, headers) {
        const h = Object.assign({}, headers || {});
        if (key) h['Idempotency-Key'] = key;
        return h;
    };
})();
