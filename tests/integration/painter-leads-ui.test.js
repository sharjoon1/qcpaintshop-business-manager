/**
 * Integration smoke test for the admin Painter Leads dashboard.
 *
 * This test verifies that the dashboard page and its JS controller exist
 * with the structural pieces the rest of the system depends on:
 *
 *   - HTML page loads with required funnel cards and tables
 *   - JS file wires the documented endpoints
 *   - XSS-safe escape helper is present in the JS
 *   - No inline event handlers are used (CSP-friendly)
 *   - Admin gate is invoked on page load
 *
 * We intentionally avoid pulling in jsdom or Playwright here: the project
 * does not bundle jsdom, and Playwright E2E specs (tests/e2e/*.spec.js)
 * run against a live server with a separate runner. This integration
 * layer is a lightweight DOM-independent contract check that runs in plain
 * Node under Jest.
 */

const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, '..', '..', 'public', 'admin-painter-leads.html');
const JS_PATH = path.join(__dirname, '..', '..', 'public', 'js', 'pages', 'admin-painter-leads.js');

describe('admin painter-leads dashboard (UI)', () => {
    let html;
    let js;

    beforeAll(() => {
        html = fs.readFileSync(HTML_PATH, 'utf8');
        js = fs.readFileSync(JS_PATH, 'utf8');
    });

    test('HTML page file exists and declares the page title', () => {
        expect(fs.existsSync(HTML_PATH)).toBe(true);
        expect(html).toMatch(/<title>\s*Painter Lead Management/);
        expect(html).toMatch(/id="pageTitle"[^>]*>\s*Painter Lead Management/);
    });

    test('HTML page declares admin auth gate', () => {
        // requireAdminOrRedirect must be invoked inline so unauthenticated
        // users cannot read the page contents.
        expect(html).toMatch(/requireAdminOrRedirect\s*\(\s*\)\s*;?/);
        expect(html).toMatch(/\/js\/auth-helper\.js/);
    });

    test('HTML page contains every funnel stat card', () => {
        const requiredIds = [
            'statNew',
            'statInProgress',
            'statInterested',
            'statInvited',
            'statRegistered',
            'statActive',
            'statUnassigned',
        ];
        requiredIds.forEach((id) => {
            expect(html).toMatch(new RegExp(`id="${id}"`));
        });
    });

    test('HTML page contains unassigned pool table and assign controls', () => {
        expect(html).toMatch(/id="unassignedTableBody"/);
        expect(html).toMatch(/id="unassignedPagination"/);
        expect(html).toMatch(/id="bulkAssignBtn"/);
        expect(html).toMatch(/id="bulkAssignTo"/);
        expect(html).toMatch(/id="selectAllUnassigned"/);
        // Row-level assign dropdown is populated dynamically by the JS,
        // but the page should declare at least one filter-select style hook.
        expect(html).toMatch(/filter-select/);
    });

    test('HTML page contains staff performance table', () => {
        expect(html).toMatch(/id="staffPerfTableBody"/);
    });

    test('HTML page contains the documented filter controls', () => {
        const expected = [
            'filterStatus',
            'filterBranch',
            'filterAssignedTo',
            'filterDateFrom',
            'filterDateTo',
            'filterSearch',
            'applyFiltersBtn',
            'resetFiltersBtn',
        ];
        expected.forEach((id) => {
            expect(html).toMatch(new RegExp(`id="${id}"`));
        });
    });

    test('HTML page does not use inline event handlers (CSP-safe)', () => {
        // Allow our single inline auth gate call only. Reject any other
        // onclick / onchange / onsubmit / onkeydown attributes.
        const inlineHandlers = html.match(/\son(click|change|submit|keydown|keyup|keypress|input|focus|blur|load)\s*=/gi) || [];
        const authGateMatches = html.match(/requireAdminOrRedirect\s*\(\s*\)\s*;?/g) || [];
        // We expect exactly one inline script for the auth gate and zero
        // attribute-style handlers anywhere else in the markup.
        const authAttrMatches = html.match(/\son[a-z]+\s*=\s*["'][^"']*requireAdminOrRedirect/i) || [];
        expect(inlineHandlers.length).toBe(0);
        expect(authAttrMatches.length).toBe(0);
        // The auth gate itself must be present (allow any number of script
        // wrappers — we're just asserting the call exists).
        expect(authGateMatches.length).toBeGreaterThanOrEqual(1);
    });

    test('HTML page matches admin purple theme tokens', () => {
        // The admin color tokens are #667eea → #764ba2.
        expect(html).toMatch(/#667eea/);
        expect(html).toMatch(/#764ba2/);
    });

    test('HTML page links the controller script', () => {
        expect(html).toMatch(/\/js\/pages\/admin-painter-leads\.js/);
    });

    test('JS controller wires documented API endpoints', () => {
        expect(js).toMatch(/\/api\/painter-leads\/stats/);
        expect(js).toMatch(/\/api\/painter-leads\?/);
        expect(js).toMatch(/\/api\/painter-leads\/\$\{[^}]+\}\/assign/);
        expect(js).toMatch(/\/api\/users\?assignable=1/);
    });

    test('JS controller uses the shared auth helper', () => {
        // The page-level helper comes from auth-helper.js; the JS should
        // delegate auth + JSON parsing to it instead of reinventing it.
        expect(js).toMatch(/\bapiFetch\s*\(/);
        expect(js).toMatch(/\bgetAuthHeaders\s*\(/);
    });

    test('JS controller escapes user content before innerHTML', () => {
        expect(js).toMatch(/function\s+esc\s*\(/);
        // The esc helper must encode the dangerous characters.
        const escMatch = js.match(/function\s+esc[\s\S]*?\n\s{4}\}/);
        expect(escMatch).not.toBeNull();
        expect(escMatch[0]).toMatch(/&amp;/);
        expect(escMatch[0]).toMatch(/&lt;/);
        expect(escMatch[0]).toMatch(/&gt;/);
        expect(escMatch[0]).toMatch(/&quot;/);
    });

    test('JS controller does not use inline onclick attributes', () => {
        expect(js).not.toMatch(/setAttribute\(\s*['"]onclick/);
        expect(js).not.toMatch(/onclick\s*=/);
    });

    test('JS controller attaches listeners via addEventListener only', () => {
        expect(js).toMatch(/addEventListener\s*\(\s*['"]click/);
        expect(js).toMatch(/addEventListener\s*\(\s*['"]change/);
        expect(js).toMatch(/addEventListener\s*\(\s*['"]keydown/);
        expect(js).toMatch(/addEventListener\s*\(\s*['"]DOMContentLoaded/);
    });

    test('JS controller defines a toast helper', () => {
        expect(js).toMatch(/function\s+toast\s*\(/);
    });
});

describe('admin navigation exposes the Painter Leads page', () => {
    const SUBNAV_JS_PATH = path.join(__dirname, '..', '..', 'public', 'js', 'nav', 'painters-subnav.js');
    const SIDEBAR_PATH = path.join(__dirname, '..', '..', 'public', 'components', 'sidebar-complete.html');

    let subnavJs;
    let sidebar;

    beforeAll(() => {
        subnavJs = fs.readFileSync(SUBNAV_JS_PATH, 'utf8');
        sidebar = fs.readFileSync(SIDEBAR_PATH, 'utf8');
    });

    test('painters subnav links to /admin-painter-leads.html', () => {
        expect(subnavJs).toContain('/admin-painter-leads.html');
        expect(subnavJs).toMatch(/page:\s*['"]painter-leads['"]/);
    });

    test('sidebar Painters section links to /admin-painter-leads.html', () => {
        expect(sidebar).toContain('/admin-painter-leads.html');
        expect(sidebar).toMatch(/data-page="painter-leads"/);
    });
});
