# Design: Zoho Price-Adjust, Sidebar Accordion, Login-After-Logout

**Date**: 2026-04-14
**Status**: Approved
**Scope**: Three concrete bug fixes bundled into one spec. A deeper Zoho Books audit is deferred to a separate follow-up session.

## Context

User reported three daily-use issues:

1. The `% Adjust` tool on `admin-zoho-items-edit.html` currently adjusts Rate → Rate. It should adjust DPL → Rate so the rate column can be derived as "DPL + markup %".
2. The admin sidebar has 14 top-level sections rendered as flat links. Many pages (notably 8 Zoho pages) are only reachable via a separate horizontal subnav, not the sidebar. The sidebar should group every page under its section and the section headers should expand/collapse accordion-style.
3. When a session expires overnight and the user re-opens the app, the dashboard renders but every API call fails silently. The user has to log out and log back in. The client auth guard only checks *local* token presence, never asks the server if the token is still valid.

The user explicitly scoped this session to these three fixes (option A from scoping question). The broader Zoho Books audit is **out of scope for this spec** and will be its own session.

## Track 1 — Price adjust direction fix

### Files touched

- `public/admin-zoho-items-edit.html` — popover UI (lines 148–183) and `applyPctAdjust()` (lines 512–536)

### Backend

No change. `POST /api/zoho/items/bulk-edit` already accepts `rate`, `purchase_rate`, and `cf_dpl` in the change payload (see `routes/zoho.js` lines 2581–2662, field mapping at lines 2630–2636).

### UI change

The `% Adjust` popover's single "Apply to" dropdown is replaced with two dropdowns plus the existing percentage input and scope toggle:

- **Source field** — read from. Options: `DPL` (default), `Rate`, `Purchase Rate`. Backed by column keys `cf_dpl`, `rate`, `purchase_rate`.
- **Target field** — write to. Options: `Rate` (default), `Purchase Rate`, `DPL`. Same column keys.
- **Percentage** — unchanged, accepts positive or negative decimals.
- **Scope toggle** — unchanged (selected rows vs all filtered rows).

Default pairing on open: `DPL → Rate`.

### JS change

`applyPctAdjust()` is rewritten to:

1. Read `source` and `target` column keys from the new dropdowns.
2. Parse `pct` as a float; reject NaN / non-finite with inline error.
3. For each row in scope:
   - `currentSource = row[source]`
   - If `currentSource == null` or `currentSource === 0`, skip row and increment `skippedCount`.
   - Else `newTarget = currentSource * (1 + pct/100)`, rounded to 2 decimals.
   - `setDirty(row, target, newTarget)`.
4. Toast shows `Updated N rows (skipped M with empty ${source})`.

When `source === target` the formula reduces to today's behavior — no regression for users who were using Rate→Rate.

### Validation

- Both dropdowns must have a selected value (they always do since they have defaults, but guard anyway).
- `pct` must be a finite number. Empty string → inline error "Enter a percentage".
- No change required to dirty-row tracking or the Save button flow.

## Track 2 — Sidebar collapsible accordion

### Files touched

- `public/components/sidebar-complete.html` — markup for all 14 top-level sections
- `public/js/universal-nav-loader.js` — accordion toggle logic + active-section detection
- Accordion CSS (`.qc-nav-submenu`, `.qc-nav-submenu.open`) already exists in the sidebar's inline `<style>` block; chevron rotation CSS is new.

### Markup pattern

Every top-level section converts from this flat pattern:

```html
<div class="qc-nav-section-title">Zoho Books</div>
<a class="qc-nav-item" href="/admin-zoho-dashboard.html">Dashboard</a>
<!-- ... more flat links ... -->
```

To this accordion pattern:

```html
<button class="qc-nav-section-toggle" data-section="zoho" aria-expanded="false">
  <span class="qc-nav-section-label">Zoho Books</span>
  <svg class="qc-nav-chevron" aria-hidden="true"><!-- chevron-right --></svg>
</button>
<div class="qc-nav-submenu" data-section="zoho">
  <a class="qc-nav-item" href="/admin-zoho-dashboard.html">Dashboard</a>
  <!-- ... all items for this section ... -->
</div>
```

### Behavior

- **Accordion, single-expand**: clicking any `qc-nav-section-toggle` closes all other `.qc-nav-submenu.open` and toggles the clicked one. Implemented as one delegated click handler in `universal-nav-loader.js`.
- **Auto-expand current section on load**: after the sidebar mounts, the loader scans each `.qc-nav-submenu` for an `<a>` whose `href` matches `location.pathname` (normalized — strip query, trailing slash, leading slash). The matching submenu gets `.open` and its toggle gets `aria-expanded="true"`.
- **Chevron rotation**: CSS rule `.qc-nav-section-toggle[aria-expanded="true"] .qc-nav-chevron { transform: rotate(90deg); }`.
- **Mobile drawer**: the slide-in drawer reuses the same markup, so accordion behavior works identically there.
- **No localStorage persistence** in this pass. Reopening the sidebar expands only the current page's section. (Multi-expand + persistence was option C and was rejected.)

### Submenu content — full parity

Each section's submenu lists every page in that domain. Items are copied from the existing horizontal subnav components so parity is exact.

- **Zoho Books** — 17 items from `public/components/zoho-subnav.html`: Dashboard, Invoices, Items, Edit Items, DPL Import, Stock, Stock Adjust, Stock Check, Locations, Reorder, Purchase Orders, Transactions, Collections, Bulk Jobs, Reports, Stock Migration, Item Master, Settings.
- **Staff** — pulled from `public/components/staff-subnav.html` (or equivalent) if present.
- **Painters** — pulled from the painters subnav.
- **Leads**, **Collections**, **System**, **AI**, **WhatsApp**, **Products** — each pulled from its corresponding subnav component if one exists.
- **Sections with no subnav file** (e.g. Dashboard, or any section where no `components/*-subnav.html` is found) stay as flat links with no expand toggle.

Implementation note: before writing the new sidebar markup, enumerate every `components/*-subnav.html` file and list its links as the source of truth. Don't hand-duplicate from memory.

### Out of scope

- **Not** removing the horizontal subnav bars. Sidebar gets full parity first; retiring the horizontal bars is a later cleanup.
- **Not** changing the sidebar for staff (`staff-sidebar.html`). Admin sidebar only. Staff sidebar can follow the same pattern in a later session if desired.

## Track 3 — Login-after-logout auth fix

### Files touched

- `public/js/auth-helper.js` — add `validateSession()`, fix `logout()` to hard-redirect
- `routes/auth.js` (or wherever auth endpoints live) — confirm or add `GET /api/auth/me`
- `public/login.html` — read `?reason=expired` query param and show a small toast

### Server side — `GET /api/auth/me`

Verify this endpoint exists. Expected contract:

- **Auth**: `Authorization: Bearer <token>` header
- **200**: `{ user: { id, full_name, role, branch_id, ... } }` — fresh user row joined with session validity
- **401**: `{ error: 'invalid_session' }` when token missing, not found in `user_sessions`, or expired

If it doesn't already exist, add it using the same session-lookup logic as `middleware/permissionMiddleware.js`. The endpoint is small (~10 lines) and reuses the existing helper.

### Client side — `auth-helper.js`

1. **New `validateSession()` function** — async, called from `checkAuthOrRedirect()` on every protected page load before any other work:
   - If `location.pathname` is `/login.html` or any other public page, return immediately (prevents redirect loops).
   - If no `auth_token` in localStorage, redirect to `/login.html` (existing behavior).
   - Else `fetch('/api/auth/me', { headers: { Authorization: 'Bearer ' + token } })`.
   - **200**: parse JSON, overwrite `localStorage.user` with the fresh server-side user object, return.
   - **401**: clear `auth_token` and `user` from localStorage, `window.location.href = '/login.html?reason=expired'`, return a never-resolving promise so the caller's subsequent code does not run during the redirect.
   - **Network error** (fetch rejected — offline): log warning, allow page to proceed with cached `user`. The reactive 401 handler in `apiRequest()` will catch it later if the token is actually bad.

2. **Fix `logout()`**: signature becomes `logout({ reason } = {})`. Fully clears state and hard-redirects.
   - `localStorage.removeItem('auth_token')`
   - `localStorage.removeItem('user')`
   - `window.location.href = reason ? '/login.html?reason=' + encodeURIComponent(reason) : '/login.html'` — hard redirect, not pushState.
   - Callers: `validateSession()` passes `{ reason: 'expired' }`, `apiRequest()` 401 handler passes `{ reason: 'expired' }`, manual logout button passes nothing.
   - Do not rely on callers to navigate after `logout()`.

3. **`apiRequest()` 401 handler**: already calls `logout()`; after the fix above, this becomes correct by construction. Add a guard to avoid calling `logout()` twice if multiple in-flight requests 401 simultaneously (set a `window.__loggingOut = true` flag).

### Login page toast

`public/login.html` reads `new URLSearchParams(location.search).get('reason')`. If `expired`, show a small non-blocking toast: "Your session expired — please log in again." Toast dismisses on login form interaction.

### Loop guard

`validateSession()` must bail out on `/login.html`, `/painter-login.html`, and any other unauthenticated pages. Maintain an explicit allow-list in `auth-helper.js` since it's easier to audit than pattern matching. Pages not in the allow-list that don't call `checkAuthOrRedirect()` are already unaffected.

## Error handling summary

- **Price adjust**: empty-source-field rows are skipped with count shown; invalid pct shows inline error; no backend error path changes.
- **Sidebar**: if a subnav component is missing or its links can't be scraped at build-time, the section still renders as a flat section with no toggle — no breakage.
- **Auth**: network failure during `validateSession()` is non-fatal (allow page to proceed with cached user); the reactive 401 handler is the ultimate safety net. Double-logout is guarded by a module-level flag.

## Testing

- **Price adjust**: manual — set DPL=100 on a few items, open popover, DPL→Rate at 10%, save, verify Rate becomes 110. Also verify Rate→Rate still works (regression). Verify skip-count toast when an item has empty DPL.
- **Sidebar**: manual — visit every admin page, confirm the correct section is auto-expanded and its link is highlighted. Click each section header to confirm accordion behavior. Mobile drawer check on a narrow viewport.
- **Auth**: manual — log in, then run a SQL `DELETE FROM user_sessions WHERE session_token = '<current>'` to simulate expiry. Reload any admin page. Should hard-redirect to `/login.html?reason=expired` and show the toast. Log in again and confirm everything works without a second logout.

No automated tests added in this pass — all three changes are UI-level and the project's existing test coverage is backend-focused.

## Out of scope (explicit)

- Deep Zoho Books audit (3000-line `routes/zoho.js`, 14 admin pages, silent error swallowing in `billing-zoho-service.js:128-134, 182, 201`). Deferred to a separate session.
- Staff sidebar accordion (`staff-sidebar.html`).
- Retiring the horizontal subnav bars.
- Android app changes.
- Adding automated tests for these changes.
