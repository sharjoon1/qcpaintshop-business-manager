/**
 * RT-064 — Zoho OAuth CSRF state token.
 * Locks the HMAC-signed, stateless state behaviour: a freshly generated state
 * verifies, while missing / malformed / tampered / expired / wrong-secret
 * tokens are rejected. This is the only CSRF defence on the unauthenticated
 * /oauth/callback, so the rejection paths must stay strict.
 */

const oauth = require('../../services/zoho-oauth');

describe('Zoho OAuth state (RT-064 CSRF guard)', () => {
    const OLD = process.env.ZOHO_CLIENT_SECRET;
    beforeAll(() => { process.env.ZOHO_CLIENT_SECRET = 'test-secret-123'; });
    afterAll(() => {
        if (OLD === undefined) delete process.env.ZOHO_CLIENT_SECRET;
        else process.env.ZOHO_CLIENT_SECRET = OLD;
    });

    test('a freshly generated state round-trips through verify', () => {
        expect(oauth.verifyOAuthState(oauth.generateOAuthState())).toBe(true);
    });

    test('rejects missing / empty state', () => {
        expect(oauth.verifyOAuthState(undefined)).toBe(false);
        expect(oauth.verifyOAuthState('')).toBe(false);
        expect(oauth.verifyOAuthState(null)).toBe(false);
    });

    test('rejects malformed state (wrong segment count)', () => {
        expect(oauth.verifyOAuthState('a.b')).toBe(false);
        expect(oauth.verifyOAuthState('a.b.c.d')).toBe(false);
    });

    test('rejects a tampered signature', () => {
        const parts = oauth.generateOAuthState().split('.');
        parts[2] = parts[2].replace(/.$/, (c) => (c === '0' ? '1' : '0'));
        expect(oauth.verifyOAuthState(parts.join('.'))).toBe(false);
    });

    test('rejects a forged payload (changed nonce, original signature)', () => {
        const [, ts, sig] = oauth.generateOAuthState().split('.');
        expect(oauth.verifyOAuthState(['deadbeef'.repeat(4), ts, sig].join('.'))).toBe(false);
    });

    test('rejects an expired state (older than maxAge)', () => {
        // maxAgeMs in the past forces even a brand-new token to read as expired.
        expect(oauth.verifyOAuthState(oauth.generateOAuthState(), -1)).toBe(false);
    });

    test('state minted under a different secret does not verify', () => {
        const s = oauth.generateOAuthState();
        process.env.ZOHO_CLIENT_SECRET = 'a-different-secret';
        expect(oauth.verifyOAuthState(s)).toBe(false);
        process.env.ZOHO_CLIENT_SECRET = 'test-secret-123';
    });
});
