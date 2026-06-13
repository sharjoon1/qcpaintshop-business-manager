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
]);

module.exports = { SCRIPT_CDNS, cspDirectives, cspStrictDirectives, STRICT_ENFORCED_PATHS };
