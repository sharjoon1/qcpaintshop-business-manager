# Zoho-First DPL Reconciliation — Design

**Date:** 2026-06-06
**Status:** Approved (design), pending implementation plan
**Area:** DPL Catalog (`services/dpl-catalog.js`, `routes/zoho.js`, `public/admin-dpl.html`)

---

## 1. Problem

The DPL Catalog feature is live, but reconciling DPL prices into Zoho items is
**slow**. The current view is **DPL-anchored**: one row per DPL-list entry, and
the user hunts for the matching Zoho item and confirms each link. The DPL list
contains many products that are not in Zoho (not sellable), so the user wades
through noise.

The user wants the inverse, **Zoho-anchored** view: the **first column is the
Zoho item** (the real sellable catalog), and each Zoho item shows the DPL price
matched to it from the latest DPL list — so only genuinely sellable items are
reviewed, and updated DPL/rate can be pushed back to Zoho in one action.

## 2. Goal

A new **"Zoho-first" tab** in `admin-dpl.html` (per brand) that:

- Lists every **active Zoho item** for the brand as a row (Zoho item name in the
  first column).
- Shows, per item: current DPL, the **new DPL from the DPL list** (via the
  existing `dpl_catalog` link), the new computed rate, the price diff, and a
  match status chip.
- Surfaces **unmatched** items first so the user only spends time where needed.
- Lets the user **attach a DPL entry inline** to an unmatched Zoho item.
- **Bulk-pushes** the updated DPL/rate for matched + changed items to Zoho in one
  click.

**Non-goals:** This tab does NOT re-run matching, change the rate formula, change
the existing DPL-anchored view, or alter the price-list PDF generator. It is a
presentation inversion + gap-fill over the existing `dpl_catalog` data, reusing
existing write paths.

## 3. Scope decision

- **New tab** inside `admin-dpl.html`. The existing DPL-anchored ("Confirmed")
  view stays unchanged. Both coexist.
- **Brand:** Birla Opus only (consistent with `assertSupportedBrand` /
  `CATALOG_ZOHO_SCOPE`, which today gates to `birlaopus`). The endpoint inherits
  that gate; other brands light up automatically when their scope is added.

## 4. Data model (reused — no schema change)

- **`zoho_items_map`** — source of sellable items. Relevant columns:
  `zoho_item_id`, `zoho_item_name`, `zoho_sku`, `zoho_cf_dpl` (current DPL on
  Zoho), `zoho_rate` (current selling rate), `zoho_brand`, `zoho_category_name`,
  `zoho_status`.
- **`dpl_catalog`** — DPL-anchored entries, each optionally linked to a Zoho item
  via `zoho_item_id`. Relevant: `id`, `current_dpl` (new DPL from latest list),
  `current_rate` (new rate = `ceil(dpl × 1.18 × 1.10)`), `link_status`,
  `link_confidence`, `pushed_dpl`, `pushed_rate`, `not_in_zoho`,
  `product_name`, `base_name`, `size_tier`, `dpl_size_label`, `canonical_sku`.

The match between a Zoho item and a DPL price is the **existing**
`dpl_catalog.zoho_item_id` link, produced by the existing build/apply-prices
flow. No new linking heuristic is introduced.

## 5. Backend

### 5.1 Pure helper (new) — `services/dpl-catalog.js`

```
buildZohoFirstView(zohoItems, catalogEntries) -> { rows, unlinkedEntries }
```

- **Inputs:** `zohoItems` = active Zoho items for the brand (already scoped),
  `catalogEntries` = `getCatalog(brand)` output.
- **Build** `Map<zoho_item_id, entry[]>` from entries that carry a
  `zoho_item_id`.
- **rows:** one per Zoho item, each:
  - `zoho_item_id`, `zoho_name`, `zoho_sku`, `category`
  - `old_dpl` = `zoho_cf_dpl`, `old_rate` = `zoho_rate`
  - matched entry (if any) → `entry_id`, `new_dpl` = `current_dpl`,
    `new_rate` = `current_rate`
  - `diff` = `new_dpl − old_dpl` (null when unmatched)
  - `status`:
    - `matched` — exactly one linked entry
    - `unmatched` — no linked entry
    - `shared` — more than one linked entry (carries `shared_count`); reuses the
      duplicate concept from `public/js/dpl-duplicate-detect.js`
  - `changed` = matched && `diff !== 0`
- **unlinkedEntries:** catalog entries with no `zoho_item_id` (the attach-picker
  candidates), each: `entry_id`, `product_name`, `base_name`, `dpl_size_label`,
  `current_dpl`, `canonical_sku`.
- **Pure / deterministic** — no DB, no Date.now — unit-testable in isolation.

### 5.2 Endpoint (new) — `routes/zoho.js`

```
GET /api/zoho/items/dpl-catalog/:brand/by-zoho
```

- Guard: `requirePermission('zoho','manage')` + `assertSupportedBrand`.
- Query active Zoho items: reuse `catalogZohoScopeSql(brand)` (same scope the
  build uses), selecting the columns in §4.
- Load `dplCatalogService.getCatalog(brand)`.
- Return `buildZohoFirstView(zohoItems, entries)` as
  `{ success: true, data: { rows, unlinkedEntries } }`.
- **Sort `rows`** server-side: `unmatched` → `changed` → `shared` → `unchanged`;
  tie-break by `zoho_name` (numeric-aware on pack size).

### 5.3 Writes — reuse existing endpoints (no new write logic)

- **Attach (inline):** `POST /api/zoho/items/dpl-catalog/entry/:id/confirm-link`
  with `{ zoho_item_id }` — pins the chosen DPL entry to the Zoho item. The
  picker passes the unlinked entry's `entry_id` as `:id`.
- **Bulk push:** `POST /api/zoho/items/dpl-catalog/:brand/push` with
  `{ ids: [entry_id, ...] }` — the set of matched + changed rows' `entry_id`s.
  This is the same job path the DPL-anchored view already uses; it updates
  `zoho_cf_dpl` + `zoho_rate` on Zoho and stamps `pushed_*`.

## 6. UI — new tab in `admin-dpl.html`

Table, one row per active Zoho item:

| Zoho Item (first col) | SKU | Current DPL | New DPL | New Rate | Diff | Status |
|---|---|---|---|---|---|---|

- **Status chips:** `✓ matched`, `⚠ no match` (+ inline **[Attach DPL]**),
  `⚠ shared ×N`, plus a quieter `unchanged` state for matched/zero-diff.
- **Sort:** unmatched → changed → shared → unchanged (server-provided order).
- **[Attach DPL] picker:** opens a searchable list of `unlinkedEntries` for the
  brand (search by product name / base / size). Selecting one calls
  `confirm-link`, then refreshes the tab.
- **Bulk action:** "Push updated DPL to Zoho (N changed)" — collects `entry_id`s
  of matched+changed rows, calls the push endpoint, then refreshes.
- **Brand selector / reuse:** mirror the existing DPL-anchored tab's brand
  control and auth/escaping helpers already in `admin-dpl.html` (reuse the page's
  existing `esc*` helper — do not introduce a new one).
- **Colors:** Admin palette (`#667eea → #764ba2`). Diff up = red ↑, down =
  green ↓, zero = muted.

## 7. Data flow

```
build catalog (existing)               ← unchanged
        │
        ▼
GET …/by-zoho  →  buildZohoFirstView()  →  Zoho-first tab renders
        │                                       │
        │                          unmatched → [Attach DPL] → confirm-link (existing)
        │                                       │
        └──────────  "Push (N changed)" → push job (existing) ──────────┐
                                                                         ▼
                              zoho_items_map.zoho_cf_dpl + zoho_rate updated, pushed_* stamped
```

## 8. Error handling

- Endpoint: try/catch → `500 { success:false, message }`, matching sibling
  routes. Unsupported brand → handled by `assertSupportedBrand`.
- Empty catalog (never built) → `rows` still returns every Zoho item as
  `unmatched` (no error); the UI shows an inline hint to build the catalog first.
- Attach/push failures surface via existing endpoints' error responses; UI shows
  a toast and leaves the row state unchanged.
- `null` / non-numeric DPL → diff is `null`, rendered as `—` (never `NaN`).

## 9. Testing

- **Unit (`tests/unit/dpl-catalog-zoho-first.test.js`):** `buildZohoFirstView`
  over fixtures — matched, unmatched, shared (×N), changed vs unchanged, null DPL
  diff, and `unlinkedEntries` extraction. Pure function, no DB.
- **E2E (`tests/e2e/admin-dpl-zoho-first.spec.js`):** load the real
  `admin-dpl.html`, switch to the Zoho-first tab, assert rows render and
  unmatched items sort to the top. (Mirrors the existing
  `tests/e2e/admin-dpl-render.spec.js` pattern that caught the dupChip bug.)

## 10. Isolation / boundaries

- All aggregation lives in the pure `buildZohoFirstView` helper in
  `services/dpl-catalog.js`; the route only fetches + delegates + sorts.
- No new write paths — attach and push reuse audited existing endpoints, so the
  Zoho-write surface is unchanged.
- The DPL-anchored view, the rate formula, and the price-list PDF are untouched.

## 11. Open items / future (out of scope for v1)

- Multi-brand: add `CATALOG_ZOHO_SCOPE` entries when other brands' DPLs land.
- "Shared ×N" resolution UI (choosing the best DPL entry for a Zoho item) can be
  deferred to the existing DPL-anchored duplicate tools.
