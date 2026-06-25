/**
 * Locks the CSP hardening invariants (S9+F5) so a future edit can't silently
 * re-loosen the strict policy, flip a page to enforced-strict before it's clean,
 * or re-introduce inline scripts/handlers into the shared-nav fragments.
 */
const fs = require('fs');
const path = require('path');
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
    it('includes the batch-2 pages (zero-handler, audited + adversarially verified)', () => {
        for (const p of [
            '/404.html', '/privacy-policy.html', '/birla-opus-report.html',
            '/', '/index.html',
            '/engineer-cart.html', '/engineer-login.html', '/engineer-profile.html', '/engineer-register.html',
            '/staff-estimates.html',
        ]) {
            expect(STRICT_ENFORCED_PATHS.has(p)).toBe(true);
        }
    });
    it('now INCLUDES admin-reports.html (shared-nav externalization complete — N5 proof flip)', () => {
        expect(STRICT_ENFORCED_PATHS.has('/admin-reports.html')).toBe(true);
    });
});

describe('Shared-nav externalization (N1-N4)', () => {
    const ROOT = path.join(__dirname, '..', '..');
    // Every nav component whose inline <script> was externalized to /js/nav/<name>.js.
    const CASES = [
        'header-v2', 'sidebar-complete', 'staff-sidebar',
        'zoho-subnav', 'whatsapp-subnav', 'system-subnav', 'staff-work-subnav',
        'sales-subnav', 'salary-subnav', 'products-subnav', 'painters-subnav',
        'marketing-subnav', 'leads-subnav', 'branches-subnav', 'attendance-subnav',
    ];
    for (const name of CASES) {
        it(`components/${name}.html is strict-clean (0 inline <script>, 0 on*=)`, () => {
            const frag = fs.readFileSync(path.join(ROOT, 'public', 'components', name + '.html'), 'utf8');
            expect((frag.match(/<script/g) || []).length).toBe(0);
            expect((frag.match(/on(click|change|input|submit|focus|blur|keydown|keyup|keypress|load)=/g) || []).length).toBe(0);
        });
        it(`js/nav/${name}.js exists (externalized JS)`, () => {
            expect(fs.existsSync(path.join(ROOT, 'public', 'js', 'nav', name + '.js'))).toBe(true);
        });
    }
});
