# DPL Catalog Review Panel — UX Redesign (search + filter + mobile cards)

**Date:** 2026-06-03
**Status:** Approved (pending spec review)
**Scope:** Frontend only — `public/admin-dpl.html` `#catalogPanel`. No backend/API/DB changes.

## Problem

After "Build Catalog", the review panel renders all `dpl_catalog` rows (≈1329 for Birla Opus) in a single dense 8-column table sorted by `category, product_name`. Three concrete pain points reported:

1. **"No checkbox on any row."** Push checkboxes only render for `confirmed + linked + current_dpl > 0` rows (214 of 1329). Those rows are scattered through the list, so the first screen — and most of the list — shows only review/needs-creating rows (no checkbox). With no search, the selectable rows are effectively unfindable. (Browser-cached stale HTML can compound this.)
2. **Not mobile-friendly.** The 8-column `text-[11px]` table horizontally overflows on phones; checkboxes/buttons are hard to reach.
3. **No product search / no "show selectable" filter.**

Root cause: discovery + density, not a data bug (verified on prod: 214 confirmed rows, all with `current_dpl > 0` and a `zoho_item_id`).

## Goals / Non-goals

**Goals:** Make confirmed/selectable rows one tap away (search + "Pushable" filter); make the panel usable on mobile (card layout); keep all existing behavior (confirm, pick, apply-prices, push, select-all) working unchanged.

**Non-goals (YAGNI):** product-family grouping, virtual scrolling, server-side search/pagination, backend changes, brand selector (Birla-only today).

## Design

All changes are client-side in `public/admin-dpl.html`. `getCatalog` already returns every field needed (`product_name`, `base_name`, `size_tier`, `dpl_size_label`, `canonical_sku`, `canonical_name`, `current_dpl`, `current_rate`, `zoho_item_id`, `link_status`, `link_confidence`, `link_reason`, `id`).

### 1. Search (client-side)

- A debounced (200ms) text input in the catalog toolbar bound to a `catalogSearch` string.
- Matches case-insensitively against the concatenation of: `product_name`, `base_name`, `canonical_sku`, and the linked Zoho name (`zohoNameFor(e.zoho_item_id, e)` — uses `catZohoNameCache` with `canonical_name` fallback).
- Empty search = no text constraint.

### 2. Filters

- Keep the four status filters: `All · Review · Needs-creating · Confirmed` (existing `setCatalogFilter` + `catalogFilter`).
- **Add** a `Pushable` filter value: shows only rows where `link_status === 'confirmed' && zoho_item_id && Number(current_dpl) > 0` (the same predicate as `canPush`). Reuse a single shared predicate `isPushable(e)` so the row checkbox gate, the select-all set, and this filter never drift.
- Search AND filter combine. A single helper `visibleCatalogRows()` returns `catalogEntries` reduced by (status/pushable filter) then (search) — used by the renderer and the result count.
- Toolbar shows **"Showing X of Y"** (X = visible after filter+search, Y = total).

### 3. Responsive layout (one render, two presentations)

`renderCatalog()` computes `visibleCatalogRows()` once, then writes BOTH:

- **Desktop table** — the existing `<table>`, wrapped so it is `hidden sm:block` (table visible ≥ sm). Header checkbox (`#catHeadCheck`) lives here only.
- **Mobile cards** — a new `#catalogCards` container, `sm:hidden`, one card per visible row:
  - Top row: checkbox (only when `isPushable(e)`), then **Product · Base** (bold product, muted base).
  - Meta row: `size_tier (dpl_size_label)` · `DPL ₹{current_dpl} → ₹{current_rate}` · status badge.
  - `canonical_sku` (mono) and linked Zoho name (or "— not linked —").
  - Action buttons: `✓ Confirm` (when not confirmed and linked) / `🔄 Pick` / `change` (when confirmed) — same `confirmCatalogEntry` / `openCatPicker` handlers.

**Dual-DOM correctness (the key detail).** Both presentations render checkboxes with `class="cat-push-check"` + `data-id`, so a given entry id appears TWICE in the DOM (once in the hidden table, once in the hidden cards, depending on viewport). To prevent stale-copy bugs, selection is driven entirely from the **data model** (`catPushSelected`), never from DOM `:checked` counts:

- Render sets each checkbox's `checked` from `catPushSelected[e.id]` (both copies agree at render time).
- `onCatCheck(id, checked)` updates `catPushSelected`, then mirrors to BOTH DOM copies: `document.querySelectorAll('.cat-push-check[data-id="'+id+'"]').forEach(cb => cb.checked = checked)`, then calls `refreshPushButton()`.
- `toggleHeadCheck(el)` and `toggleSelectAllConfirmed()` iterate the *visible pushable rows from data* (`visibleCatalogRows().filter(isPushable)`), set `catPushSelected` for those ids, mirror to DOM copies, and `refreshPushButton()`.
- `refreshPushButton()` derives everything from data: `#pushCount` = count of truthy `catPushSelected`; `#pushZohoBtn.disabled` = that count is 0; the `#catHeadCheck` checked/indeterminate state compares the number of *currently visible pushable* ids that are selected against the total visible-pushable count (all → checked, some → indeterminate, none → unchecked). No DOM `:checked` counting anywhere.

### 4. Discovery hint

When `isPushable` rows exist, the toolbar shows a subtle line: **"{n} pushable — tap ☑ Pushable"**, where the chip is the Pushable filter button. Hidden when n = 0.

### 5. Empty state

`#catalogEmpty` text becomes "No catalog entries match." and shows whenever `visibleCatalogRows()` is empty (filter and/or search), for both layouts.

### 6. Cache-busting

`admin-dpl.html` carries its JS inline (no separate versioned asset), so the unit to keep fresh is the HTML document itself. Add, in `<head>`, a `<meta http-equiv="Cache-Control" content="no-cache, must-revalidate">` (plus `Pragma: no-cache`) so a redeploy is picked up without a manual hard-refresh. Low-risk, self-contained, no server-config change.

## Components touched

| Unit | Change |
|---|---|
| `#catalogPanel` markup | add search input + `Pushable` filter button + "Showing X of Y" + hint; wrap table `hidden sm:block`; add `#catalogCards` (`sm:hidden`) |
| `renderCatalog()` | compute `visibleCatalogRows()`; render table tbody AND card list; keep `refreshPushButton()` on both render paths |
| new `isPushable(e)`, `visibleCatalogRows()`, `catalogSearch` state, `setCatalogSearch()` (debounced) | shared predicate + filter/search pipeline |
| `setCatalogFilter` | accept `'pushable'` value |
| `toggleSelectAllConfirmed` | select over `isPushable` (unchanged semantics, now via shared predicate) |

**Reused unchanged:** `loadCatalog`, `applyCatalogPrices`, `pushCatalogToZoho`, `confirmCatalogEntry`, `openCatPicker`/picker modal, `onCatCheck`, `catPushSelected`, the push/apply endpoints.

## Testing

No automated UI tests in this project for `admin-dpl.html`. Manual smoke (desktop + mobile viewport):
1. Build catalog → "Showing 1329 of 1329"; hint shows "214 pushable".
2. Click **☑ Pushable** → only 214 rows; every row has a checkbox.
3. Search "elegance" → list narrows live; count updates; clearing restores.
4. Search + Pushable combine (AND).
5. Mobile viewport (<640px): cards show, table hidden; checkbox tappable; Confirm/Pick/change work.
6. Desktop (≥640px): table shows, cards hidden; unchanged.
7. Select rows in either layout → "🚀 Push N" count correct; header checkbox reflects all/partial/none; push works; selection clears on reload.
8. `node -e "require(...)"` not applicable (HTML); verify file has no JS syntax errors (load page, check console).

## Out of scope

Backend, other brands, the AI/legacy match flow, the non-catalog parts of `admin-dpl.html`.
