/**
 * Locks the CSP hardening invariants (S9+F5) so a future edit can't silently
 * re-loosen the strict policy or flip a page to enforced-strict before it's clean.
 */
const { cspDirectives, cspStrictDirectives, STRICT_ENFORCED_PATHS } = require('../../config/csp');

describe('CSP enforced (permissive) policy', () => {
    it('has dropped unsafe-eval (Phase A) but still allows unsafe-inline for un-migrated pages', () => {
        expect(cspDirectives['script-src']).not.toContain("'unsafe-eval'");
        expect(cspDirectives['script-src']).toContain("'unsafe-inline'");
        expect(cspDirectives['script-src-attr']).toContain("'unsafe-inline'");
    });
});

describe('CSP strict (target) policy', () => {
    it('forbids inline scripts and inline handlers', () => {
        expect(cspStrictDirectives['script-src']).not.toContain("'unsafe-inline'");
        expect(cspStrictDirectives['script-src']).not.toContain("'unsafe-eval'");
        expect(cspStrictDirectives['script-src-attr']).toEqual(["'none'"]);
    });
    it('tightens connect-src to self only (no blanket wss:/https:)', () => {
        expect(cspStrictDirectives['connect-src']).toEqual(["'self'"]);
    });
    it('keeps the script CDNs and reports violations', () => {
        expect(cspStrictDirectives['script-src']).toContain('https://cdn.socket.io');
        expect(cspStrictDirectives['report-uri']).toEqual(['/api/csp-report']);
    });
});

describe('STRICT_ENFORCED_PATHS allowlist', () => {
    it('is a Set of leading-slash exact paths', () => {
        expect(STRICT_ENFORCED_PATHS).toBeInstanceOf(Set);
        for (const p of STRICT_ENFORCED_PATHS) expect(p.startsWith('/')).toBe(true);
    });
    it('includes the migrated pages (estimate-edit shim + batch 1)', () => {
        for (const p of ['/estimate-edit.html', '/forgot-password.html', '/reset-password.html', '/payment.html']) {
            expect(STRICT_ENFORCED_PATHS.has(p)).toBe(true);
        }
    });
});
