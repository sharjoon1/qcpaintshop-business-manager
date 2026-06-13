# S9 + F5 — CSP Hardening + Mega-page JS Externalization (Plan)

**Status:** DRAFT — awaiting owner approval (per-phase gates).
**Date:** 2026-06-13. **Author:** Claude Code. **Backlog IDs:** S9 (high/XL), F5 (med/XL).
**Source:** docs/PROJECT-REPORT-2026-06-10.md §13 rows S9, F5.

---

## 1. Goal

Tighten the global Content-Security-Policy so a stored-XSS payload cannot execute:
drop `'unsafe-inline'` and `'unsafe-eval'` from `script-src`, drop `'unsafe-inline'`
from `script-src-attr`, and narrow `connect-src` from the blanket `https:`/`wss:`
to an explicit allowlist. F5 (externalizing inline JS from the mega-pages) is the
**prerequisite** — strict CSP cannot ship while pages rely on inline scripts/handlers.

## 2. Why this is XL — the measured footprint (2026-06-13)

| Thing | Count | Implication |
|---|---|---|
| Inline `on*=` event handlers | **2,863** across 143 HTML files | `script-src-attr 'unsafe-inline'` cannot be dropped until ALL are converted to `addEventListener` |
| Inline `<script>` blocks | **152** HTML files | `script-src 'unsafe-inline'` cannot be dropped until all are externalized to `.js` |
| Mega-pages | admin-dpl 5,490 / admin-painters 5,396 / staff/dashboard 3,798 lines | bulk of the inline JS lives here |
| `eval` / `new Function` | **0** | ✅ `'unsafe-eval'` is droppable NOW with near-zero risk |

**Hard constraint:** pages are **static HTML served by `express.static`** — there is
no server-side templating, so a per-request CSP **nonce cannot be injected** into
`<script nonce>` tags. That rules out the nonce strategy. The only viable path is:
**externalize all inline scripts to files** (F5) + **remove all inline handlers**.

**No automated UI tests exist** — every converted page must be manually
smoke-tested. A missed handler = a dead button in prod with no test to catch it.
This risk is the reason for the report-only + per-path-enforcement strategy below.

## 3. Strategy — de-risk before enforce

Two ideas make this safe to do incrementally instead of as one big-bang flip:

1. **Report-Only first.** Ship the STRICT policy as `Content-Security-Policy-Report-Only`
   (a second header) ALONGSIDE the existing enforced permissive policy, with a
   `report-uri`/`report-to` endpoint that logs violations. Real usage then produces
   an exact, page-by-page inventory of what actually breaks — no guessing. The
   enforced policy stays permissive (nothing breaks for users) until we flip.

2. **Per-path enforcement.** CSP is one global header today, so strict mode can only
   ship when EVERY page is clean. Replace the single `helmet()` CSP with a small
   middleware that serves the **strict** policy for pages already migrated (tracked
   in an allowlist) and the **permissive** policy for the rest. This lets us flip
   pages on one at a time as they're finished, instead of waiting for all 143.

## 4. Phases (each its own approval gate)

### Phase A — Immediate safe wins (low risk, no page changes) ⭐ recommend now
- Drop `'unsafe-eval'` from `script-src` (confirmed 0 usages).
- Add the **Report-Only strict header** + a `POST /api/csp-report` sink that buffers
  violations (reuse the `global._appErrorBuffer` pattern; rate-limited; no PII).
- **Do NOT** narrow `connect-src` yet (needs the per-page fetch audit — see Phase B).
- Acceptance: all pages still load (manual spot-check of dashboard, admin-dpl,
  staff-billing, painter pages); `npm test` green; CSP-RO violations start landing
  in the sink. Deploy, then read a few days of reports to build the Phase D worklist.

### Phase B — connect-src narrowing (low/med risk)
- From the CSP-RO `connect-src` violations + a code audit of `fetch(`/`XMLHttpRequest`/
  `io(` targets, build the explicit allowlist: `'self'`, the socket origin (`wss:`
  self), and any genuinely browser-direct third parties (e.g. `api.qrserver.com` is
  an **img**, not connect; most Zoho traffic is server-side, not browser→Zoho).
- Replace blanket `https:` with the allowlist. Keep it in Report-Only one cycle, then
  enforce. Acceptance: no new connect-src violations from normal use.

### Phase C — F5: externalize inline `<script>` blocks, page-by-page
- Per page: move the inline JS to `public/js/pages/<page>.js`, reference via
  `<script src="/js/pages/<page>.js" defer>`. Keep code identical (no refactor) to
  isolate risk. Order: smallest/most-used first to build confidence, mega-pages last.
- A page is "script-clean" when it has zero inline `<script>` with code (JSON-LD/config
  blocks get a hash in the strict policy, which IS supported for static files).
- Acceptance per page: page works identically (manual smoke); CSP-RO shows no
  `script-src` inline violation for that path.

### Phase D — remove inline `on*=` handlers, page-by-page (the mountain: 2,863)
- Prefer **event delegation**: one delegated listener per page on a container,
  dispatching by `data-action="..."` (+ `data-id` etc.). This collapses dozens of
  per-element handlers into one block and is far less error-prone than 1:1 rewrites.
- Convert inline `onclick="fn(a,b)"` → `data-action="fn" data-...` + a delegated
  handler, or `el.addEventListener` for unique elements. **escHtml/esc must still
  wrap any value interpolated into `data-*`** (XSS rule unchanged).
- Acceptance per page: every former inline action still fires (manual smoke of each
  button/select on the page); CSP-RO shows no `script-src-attr` violation for that path.

### Phase E — flip to enforced strict, per path, then global
- As each page finishes C+D, add it to the strict-policy allowlist (per-path
  middleware) and move its strict header from Report-Only to enforced.
- When the allowlist covers all pages, delete the permissive branch and the
  per-path split — the global policy is strict. Remove `'unsafe-inline'` from
  `script-src` and `script-src-attr`. `style-src 'unsafe-inline'` MAY remain
  (Tailwind/utility styles; style injection is far lower risk) — decide at the end.

## 5. Risks & mitigations
- **Dead buttons in prod (no UI tests):** report-only + per-path flip + per-page manual
  smoke; never flip a page to enforced before its CSP-RO is clean.
- **Third-party widgets (YouTube/WhatsApp/QR/Quill):** keep their hosts in the relevant
  directives; verify each still renders under strict.
- **Socket.IO:** needs `connect-src` wss self + `script-src` cdn.socket.io (or self-host).
- **Scope creep into refactors:** Phase C/D move code verbatim — no logic changes —
  so a regression is a wiring bug, not a behavior change.

## 6. Recommended first step
Execute **Phase A** (drop `unsafe-eval` + add Report-Only strict header + CSP report
sink). It is low-risk, shippable on its own, and its violation reports turn the
2,863-handler guess into a precise, prioritized worklist for Phases C/D.

## 7. Definition of done (S9 + F5)
- `script-src` has no `'unsafe-inline'`/`'unsafe-eval'`; `script-src-attr` has no
  `'unsafe-inline'`; `connect-src` is an explicit allowlist (no blanket `https:`).
- `grep -rE "on(click|change|...)=" public/ --include=*.html` → 0 (or only on
  data-action-delegated, no JS in the attribute).
- No page regressions (manual smoke matrix of all role dashboards + money pages).
- `npm test` green; commit per phase; deploy + `/health` verify per the §7 runbook.
