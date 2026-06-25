/**
 * Centralized Content-Security-Policy config (S9+F5 hardening).
 * Plan: docs/plans/2026-06-13-s9-f5-csp-hardening-plan.md
 *
 * Three policies are wired in server.js:
 *  - cspDirectives          → ENFORCED globally (permissive: still allows the inline
 *                             scripts/handlers the un-migrated pages rely on).
 *  - cspStrictDirectives    → REPORT-ONLY globally (the target policy; browsers
 *                             report, don't block — builds the migration worklist),
 *                             AND ENFORCED for the per-path allowlist below.
 *  - STRICT_ENFORCED_PATHS  → pages fully migrated to the strict policy; they get
 *                             the enforced strict CSP (Phase E, incremental flip).
 */

// Script CDNs allowed today; shared between the enforced and strict policies.
const SCRIPT_CDNS = [
    "https://cdn.jsdelivr.net",
    "https://cdnjs.cloudflare.com",
    "https://unpkg.com",
    "https://cdn.quilljs.com",
    "https://cdn.socket.io",
    "https://www.googletagmanager.com",
    "https://www.youtube.com"
];

// Enforced, permissive — 'unsafe-eval' already dropped (Phase A). 'unsafe-inline'
// stays until the inline <script> blocks + on*= handlers are migrated (Phases C/D).
const cspDirectives = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", ...SCRIPT_CDNS],
    "script-src-attr": ["'unsafe-inline'"],
    "style-src": [
        "'self'", "'unsafe-inline'",
        "https://fonts.googleapis.com",
        "https://cdnjs.cloudflare.com",
        "https://cdn.jsdelivr.net",
        "https://cdn.quilljs.com",
        "https://unpkg.com"
    ],
    "font-src": ["'self'", "data:", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
    "img-src": ["'self'", "data:", "blob:", "https:"],
    "media-src": ["'self'", "blob:", "https:"],
    "connect-src": ["'self'", "wss:", "https:"],
    "frame-src": ["'self'", "https://www.youtube.com", "https://wa.me"],
    "frame-ancestors": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "upgrade-insecure-requests": []
};

// Target STRICT policy: no 'unsafe-inline' in script-src, no inline handlers
// (script-src-attr 'none'), tightened connect-src (Phase B audit: all browser
// network calls are same-origin /api/* + socket.io to same origin).
const cspStrictDirectives = {
    ...cspDirectives,
    "script-src": ["'self'", "'report-sample'", ...SCRIPT_CDNS],
    "script-src-attr": ["'none'"],
    "connect-src": ["'self'"],
    "report-uri": ["/api/csp-report"]
};

// Pages fully migrated to the strict policy. Add a page here ONLY after Phase C
// (externalize its inline scripts) + Phase D (remove its inline on*= handlers,
// including any injected via innerHTML) + confirming ZERO Report-Only violations
// for its path. Each entry is an exact req.path (leading slash).
const STRICT_ENFORCED_PATHS = new Set([
    '/estimate-edit.html',   // redirect-only shim; inline script externalized 2026-06-13
    // Batch 1 (2026-06-13) — 0 inline on*= handlers, single inline <script>
    // externalized to /js/pages/<name>.js; already used addEventListener + same-origin
    // fetch. Each verified: 0 inline scripts remain, no on*= substring anywhere.
    '/forgot-password.html',
    '/reset-password.html',
    '/payment.html',
    // Batch 2 (2026-06-15) — 9 zero-handler pages, audited + adversarially verified
    // (full JS-graph scan: no runtime-injected on*= handlers, all calls same-origin,
    // no eval, only allowlisted/self script srcs). Pure-static (no JS at all):
    '/404.html',
    '/privacy-policy.html',
    '/birla-opus-report.html',
    // Single inline <script> externalized to /js/pages/<name>.js (verbatim moves):
    '/',                       // root serves index.html (express.static default)
    '/index.html',
    '/engineer-cart.html',     // each loads engineer-portal.js (terminal, clean) + page JS
    '/engineer-login.html',
    '/engineer-profile.html',
    '/engineer-register.html',
    // Two inline scripts externalized: a SYNC auth-guard (staff-estimates-authguard.js,
    // non-deferred, runs after auth-helper.js) + the header UI wiring (staff-estimates.js):
    '/staff-estimates.html',
    // Shared-nav externalization (2026-06-25): universal-nav-loader.js now loads every nav
    // component's JS as a real external <script src> (no inline re-injection), so nav-loader
    // pages are strict-clean. admin-reports.html — the canonical previously-blocked page — is
    // flipped here as proof; its 2 inline auth-guard <script> blocks were externalized to
    // /js/pages/admin-reports-authguard.js. The remaining ~100 nav-loader pages flip per-path
    // as each page's own inline JS is externalized (Phase E, incremental).
    '/admin-reports.html',
    // Batch 3 (2026-06-25) — non-navloader pages. Each had its inline <script>(s) externalized
    // to /js/pages/<name>.js (verbatim) and its inline on*= handlers (static + runtime-injected)
    // converted to addEventListener / data-action+delegation. Audited + externalized via
    // workflows; mechanically verified (0 inline <script>, 0 on*= per page; .js syntax valid;
    // residual on*= strings are comments only). offline.html deliberately EXCLUDED (its inline
    // onclick is load-bearing for the offline fallback — an external JS would not load offline).
    '/docs/wa-marketing-guide.html',     // pure static, no JS
    '/docs/attendance-guide-tamil.html', // 1 print handler -> addEventListener
    '/share/painter-estimate.html',
    '/share/estimate.html',
    '/share/design-request.html',
    '/engineer-catalog.html',
    '/engineer-dashboard.html',
    '/engineer-new-quote.html',
    '/payment-receipt.html',
    '/customer-dashboard.html',
    '/customer-login.html',
    '/painter-profile.html',
    // Batch 4 (2026-06-25) — first nav-loader functional admin pages flipped (proves the shared-nav
    // externalization unlocks real working pages, not just admin-reports). Each had its head auth-guard
    // externalized SYNC to /js/pages/<name>-authguard.js + its page-logic script to /js/pages/<name>.js
    // (verbatim) + its 1 inline handler converted to addEventListener. Externalized via workflow;
    // mechanically verified (0 inline <script>, 0 on*= per page; .js syntax valid; residuals are comments).
    '/admin-live-dashboard.html',
    '/admin-wa-dashboard.html',
    '/admin-wa-settings.html',
    '/staff/advance-request.html',
    // Batch 5 (2026-06-25) — mid-handler nav-loader admin pages (10-12 handlers each). Each had head
    // auth-guard + page-logic externalized (authguard.js SYNC + page.js verbatim) + all static handlers
    // converted to addEventListener + all RUNTIME-injected handlers (innerHTML templates) converted to
    // data-action + dataset + delegated listeners. Externalized via workflow; mechanically verified
    // (0 inline <script>, 0 on*= per page; all 12 .js syntax-valid; residuals are comments only).
    '/admin-salary-config.html',
    '/admin-activity-monitor.html',
    '/admin-engineers.html',
    '/admin-lead-scoring.html',
    '/admin-zoho-reports.html',
    '/admin-whatsapp-sessions.html',
    // Batch 6 (2026-06-25) — 6 more mid-handler nav-loader pages (10-17 handlers). Same pattern:
    // authguard + page-logic externalized, all static + runtime handlers converted. Also caught +
    // fixed a javascript: URI (CSP-blocked like inline handlers) in daily-tasks error template.
    '/staff/daily-tasks.html',
    '/staff/tasks.html',
    '/admin-estimate-requests.html',
    '/admin-zoho-settings.html',
    '/admin-tasks.html',
    '/admin-daily-tasks.html',
    // Batch 7 (2026-06-25) — 6 high-traffic nav-loader pages. Same pattern; the agent self-check now
    // also catches javascript: URIs (none found in this batch). Tight-grep verified: 0 live handlers.
    '/chat.html',
    '/admin-dpl-match.html',
    '/admin-painter-catalog.html',
    '/admin-whatsapp-chat.html',
    '/admin-zoho-invoices.html',
    '/estimate-create-new.html',
    // Batch 8 (2026-06-25) — 8 low-handler nav-loader pages (2-5 handlers). Highest-blast pages
    // (login, admin-dashboard, dashboard) deliberately EXCLUDED for isolated care later.
    '/admin-agreements.html',
    '/admin-engineer-catalog.html',
    '/estimate-settings.html',
    '/staff/salary.html',
    '/admin-monitoring.html',
    '/admin-geofence-logs.html',
    '/staff/history.html',
    '/admin-zoho-salesorders.html',
    // Batch 9 (2026-06-25) — 8 more mid-handler nav-loader pages (6-7 handlers).
    '/admin-customer-types.html',
    '/admin-salary-reports.html',
    '/admin-settings.html',
    '/admin-stock-migration.html',
    '/staff/activities.html',
    '/admin-branches.html',
    '/admin-categories.html',
    '/admin-customers.html',
    // Batch 10 (2026-06-25) — 7 more mid-handler nav-loader pages (7-8 handlers). Same pattern:
    // head auth-guard + page-logic externalized (authguard.js SYNC + page.js verbatim); all static
    // handlers → addEventListener, all runtime-injected handlers → data-action + dataset + delegated
    // listeners. One page (admin-brands) also delegates a capture-phase `error` listener for the
    // runtime-rendered brand-logo <img> fallback (error events don't bubble). Mechanically verified
    // (0 inline <script>, 0 live on*= per page; all 14 .js syntax-valid; residuals are comments only).
    '/admin-roles.html',
    '/admin-role-permissions.html',
    '/admin-zoho-bulk-jobs.html',
    '/admin-zoho-expenses.html',
    '/staff/agreement.html',
    '/staff/clock-in.html',
    '/admin-brands.html',
    // Batch 11 (2026-06-25) — 9 more mid-handler nav-loader pages (5-9 handlers). Same pattern
    // (authguard.js SYNC + page.js verbatim; static → addEventListener, runtime → data-action +
    // delegated listeners). admin-staff + admin-photos each also delegate a capture-phase `error`
    // listener for runtime-rendered <img> fallbacks (error events don't bubble). admin-profile's
    // known broken aadhar-<img> preview is a SEPARATE auth-header bug, deliberately untouched.
    '/staff/permission-request.html',
    '/staff-daily-work.html',
    '/staff-painter-marketing.html',
    '/admin-staff.html',
    '/admin-zoho-locations.html',
    '/staff-incentives.html',
    '/admin-photos.html',
    '/admin-profile.html',
    '/estimate-actions.html',
]);

module.exports = { SCRIPT_CDNS, cspDirectives, cspStrictDirectives, STRICT_ENFORCED_PATHS };
