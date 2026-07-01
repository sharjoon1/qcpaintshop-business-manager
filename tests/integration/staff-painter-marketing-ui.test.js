/**
 * Integration smoke test for the staff Painter Marketing page.
 *
 * Verifies the structural contract the rest of the system depends on:
 *
 *   - HTML page exists, declares its title, and declares the staff auth gate
 *   - Filter chips for the documented workflow (All / Today / Pending /
 *     Interested / Invited / Registered) are present
 *   - Lead card action buttons exist for Call, WhatsApp, Log Followup,
 *     Send Invite, and Approve
 *   - The page uses the shared auth helper (`apiFetch` / `getAuthHeaders`)
 *   - No inline event handlers are used (CSP-safe)
 *   - The brand palette is green + gold (no purple)
 *
 * DOM-independent on purpose: the project doesn't bundle jsdom, and the
 * Playwright E2E layer covers live behavior. This integration layer is a
 * lightweight contract check that runs in plain Node under Jest.
 */

const fs = require('fs');
const path = require('path');

const HTML_PATH = path.join(__dirname, '..', '..', 'public', 'staff-painter-marketing.html');
const JS_PATH  = path.join(__dirname, '..', '..', 'public', 'js', 'pages', 'staff-painter-marketing.js');

describe('staff painter-marketing page (UI)', () => {
    let html;
    let js;

    beforeAll(() => {
        html = fs.readFileSync(HTML_PATH, 'utf8');
        js  = fs.readFileSync(JS_PATH,  'utf8');
    });

    test('HTML page file exists and declares the page title', () => {
        expect(fs.existsSync(HTML_PATH)).toBe(true);
        // Title contains "Painter Marketing" plus a brand suffix ("— QC").
        expect(html).toMatch(/<title>[^<]*Painter Marketing[^<]*<\/title>/);
        expect(html).toMatch(/id="pageTitle"[^>]*>\s*Painter Marketing\s*</);
    });

    test('HTML page declares the staff auth gate', () => {
        // staff-painter-marketing.html uses checkAuthOrRedirect via the
        // externalized authguard script — both forms must be present.
        expect(html).toMatch(/staff-painter-marketing-authguard\.js/);
        expect(fs.existsSync(path.join(__dirname, '..', '..', 'public', 'js', 'pages', 'staff-painter-marketing-authguard.js'))).toBe(true);
        expect(html).toMatch(/\/js\/auth-helper\.js/);
    });

    test('HTML page contains all required filter chips', () => {
        const required = ['all', 'today', 'pending', 'interested', 'invited', 'registered'];
        required.forEach((f) => {
            // Filter chips declare a data-filter attribute and a human label.
            const re = new RegExp(`data-filter="${f}"[^>]*>\\s*${f.charAt(0).toUpperCase() + f.slice(1)}`);
            expect(html).toMatch(re);
        });
    });

    test('HTML page renders an empty lead list container and modal root', () => {
        expect(html).toMatch(/id="list"/);
        expect(html).toMatch(/id="modalRoot"/);
        expect(html).toMatch(/id="filterBar"/);
        expect(html).toMatch(/id="summary"/);
        expect(html).toMatch(/id="progressBadge"/);
        expect(html).toMatch(/id="progressFill"/);
    });

    test('HTML page does not use inline event handlers (CSP-safe)', () => {
        // Reject every on* attribute — auth gate is in an external file.
        const inlineHandlers = html.match(/\son(click|change|submit|keydown|keyup|keypress|input|focus|blur|load)\s*=/gi) || [];
        expect(inlineHandlers.length).toBe(0);
    });

    test('HTML page matches the staff green + gold brand palette', () => {
        // Green primary
        expect(html).toMatch(/#1B5E3B/);
        // Gold accent
        expect(html).toMatch(/#D4A24E/);
        // No purple — staff painter brand is distinct from the admin purple
        // dashboard (#667eea / #764ba2).
        expect(html).not.toMatch(/#667eea/i);
        expect(html).not.toMatch(/#764ba2/i);
    });

    test('HTML page links the controller script', () => {
        expect(html).toMatch(/\/js\/pages\/staff-painter-marketing\.js/);
    });

    test('JS controller wires the documented painter-leads endpoints', () => {
        // Load endpoints
        expect(js).toMatch(/\/api\/painter-leads\/my/);
        expect(js).toMatch(/\/api\/painter-leads\/my\/today/);
        // Mutation endpoints
        expect(js).toMatch(/\/api\/painter-leads\/\$\{[^}]+\}\/followup/);
        expect(js).toMatch(/\/api\/painter-leads\/\$\{[^}]+\}\/send-invite/);
        // Painter approval endpoint
        expect(js).toMatch(/\/api\/painters\/\$\{[^}]+\}\/approve/);
    });

    test('JS controller uses the shared auth helper', () => {
        // The page should delegate auth + JSON parsing to auth-helper.
        // apiFetch wraps apiRequest/getAuthHeaders internally, so verifying
        // apiFetch is sufficient — the controller never talks to fetch()
        // directly with hand-built headers.
        expect(js).toMatch(/\bapiFetch\s*\(/);
        // auth-helper is the source of truth for these functions.
        expect(html).toMatch(/\/js\/auth-helper\.js/);
    });

    test('JS controller escapes user content before innerHTML', () => {
        // The esc helper must exist and encode every dangerous character.
        // Look only inside the esc function body (bounded by its first `{`
        // after the signature and the next newline-terminated `}`).
        expect(js).toMatch(/function\s+esc\s*\(/);
        const escMatch = js.match(/function\s+esc\s*\([^)]*\)\s*\{([\s\S]*?)\n\s{4}\}\s*\n/);
        expect(escMatch).not.toBeNull();
        const body = escMatch[1];
        expect(body).toMatch(/&amp;/);
        expect(body).toMatch(/&lt;/);
        expect(body).toMatch(/&gt;/);
        expect(body).toMatch(/&quot;/);
        expect(body).toMatch(/&#39;/);
    });

    test('JS controller renders every documented action', () => {
        // Call, WhatsApp, Log Followup, Send Invite, Approve — all must be
        // surfaced as data-action delegates the page can dispatch.
        const requiredActions = [
            'call-lead',
            'wa-lead',
            'open-followup',
            'open-invite',
            'approve-painter',
            'save-followup',
            'save-invite',
            'close-modal',
        ];
        requiredActions.forEach((a) => {
            expect(js).toMatch(new RegExp(`['"]${a}['"]`));
        });
    });

    test('JS controller attaches listeners via addEventListener only', () => {
        expect(js).toMatch(/addEventListener\s*\(\s*['"]click/);
        // No setAttribute('onclick', ...) — listeners must be programmatic.
        expect(js).not.toMatch(/setAttribute\s*\(\s*['"]onclick/);
        // And no inline onclick in the JS either.
        expect(js).not.toMatch(/onclick\s*=/);
    });

    test('JS controller dispatches every action through a single delegated listener', () => {
        // Exactly one document-level click listener routes by data-action.
        const docListeners = js.match(/document\.addEventListener\s*\(\s*['"]click/g) || [];
        expect(docListeners.length).toBe(1);
    });

    test('JS controller only shows Approve when lead is registered with a painter id', () => {
        // The card render path gates the approve CTA on both conditions.
        expect(js).toMatch(/status\s*===\s*['"]registered['"]/);
        expect(js).toMatch(/painter_id/);
    });

    test('JS controller calls the WhatsApp auto-followup side effect', () => {
        // WhatsApp tap must log a 'whatsapp' followup so analytics reflect outreach.
        expect(js).toMatch(/logWhatsappTap|wa-lead/);
        expect(js).toMatch(/followup_type['"]?\s*:\s*['"]whatsapp/);
    });

    test('JS controller ships a toast helper', () => {
        expect(js).toMatch(/function\s+toast\s*\(/);
    });

    test('JS controller defines the six filter buckets', () => {
        // All / Today / Pending / Interested / Invited / Registered
        const expected = ['all', 'today', 'pending', 'interested', 'invited', 'registered'];
        const filterObj = js.match(/function\s+getFilters[\s\S]*?\}\s*\)\s*;/);
        expect(filterObj).not.toBeNull();
        expected.forEach((f) => {
            expect(filterObj[0]).toMatch(new RegExp(`${f}\\s*:`));
        });
    });
});
