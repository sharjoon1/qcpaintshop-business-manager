# Zoho-first Full Parity — Pushed State, Filters, Search, SKU Conflict, Re-pick

**Date:** 2026-06-07
**Status:** Approved (chat), pending spec review
**Page:** `public/admin-dpl.html` — Build Catalog → "Zoho-first" view
**Brand:** Birla Opus only (inherits existing scope)
**Builds on:** `2026-06-07-zoho-first-parity-design.md` (round 1: linked DPL product, shared
resolve, category, stats, push selection — already shipped, HEAD `c29eff4`).

---

## Problem

After round 1, the Zoho-first view shows the linked DPL product but still lacks
several capabilities the DPL-first view has, so the two views are not at parity.
The user wants Zoho-first to work like the DPL-first view. Five gaps remain (all
approved for this round):

- **A. Pushed-state badge** — DPL-first shows per row whether the linked DPL was
  already pushed to Zoho (✅ pushed / ⚠ re-push, with date + job #). Zoho-first shows
  nothing, so you can't tell what still needs pushing.
- **B. Pushed / Pushable filters** — DPL-first filters by ☑ Pushable and ✅ Pushed.
  Zoho-first only has unmatched / changed / shared / unchanged.
- **C. Full search** — DPL-first searches product / base / SKU / Zoho name. Zoho-first
  searches only the Zoho item name + SKU, not the linked DPL product.
- **D. SKU conflict warning** — DPL-first flags ⚠ when a row's canonical SKU is already
  used by a different active Zoho item. Zoho-first doesn't.
- **E. Re-pick linked DPL** — DPL-first lets you change a row's link (🔄 Pick). In
  Zoho-first a matched row can only be detached (via the shared resolver) — there is no
  one-step "swap this row to a different DPL entry".

## Goal

Bring the Zoho-first view to feature parity with DPL-first for the five items above,
reusing existing endpoints and the round-1 structures. No new write endpoints.

## Non-goals

- No new write endpoints. Re-pick composes the existing `not-in-zoho` + `confirm-link`
  calls; pushed state is read-only data.
- No DPL-first behavior change *except* a low-risk refactor is explicitly avoided —
  the `sku_conflict` query is duplicated into the by-zoho route rather than refactoring
  the heavily-used `/:brand` route (see Architecture).
- **Pending filter is intentionally NOT ported.** DPL-first "Pending" = a DPL entry
  marked not-in-zoho with no link. Those entries are not linked to any active Zoho
  item, so they never appear as Zoho-first rows. A Pending chip would always be empty;
  omit it.

---

## Architecture

### Backend

**`routes/zoho.js` — `GET …/:brand/by-zoho`.** Today this passes raw `getCatalog`
entries to `buildZohoFirstView`. The DPL-first route (`GET …/:brand`) decorates entries
with two computed fields the raw rows lack: `sku_conflict` (needs a cross-item DB
lookup) and `push_changed` (pure, derivable from the row).

- `sku_conflict` requires the `skuHolders` query (find other active Zoho items holding
  the same `canonical_sku`). Replicate that block in the by-zoho route and set
  `e.sku_conflict` on each entry **before** calling `buildZohoFirstView`. (We duplicate
  ~20 lines rather than refactor the critical `/:brand` path; the block is small and
  well-understood. A future cleanup could extract a shared `decorateCatalogEntries`.)

**`services/dpl-catalog.js` — `buildZohoFirstView` (pure).** For matched rows
(`linked.length === 1`), surface these onto the row object:
- `pushed_at`, `pushed_job_id`, `pushed_dpl` — passthrough from the entry.
- `push_changed` — derived: `pushed_at != null && (Number(pushed_dpl) !== Number(new_dpl) || Number(pushed_rate) !== Number(new_rate))`. (Same formula the `/:brand` route uses; `new_dpl`/`new_rate` here equal the entry's `current_dpl`/`current_rate`.)
- `sku_conflict` — passthrough from the (route-decorated) entry.

For unmatched and shared rows these fields are `null` (unmatched has no entry; shared is
excluded from push, consistent with round 1). Pure and unit-testable: `push_changed`
derivation is computed in the helper; `sku_conflict` is treated as input data.

### Frontend — `public/admin-dpl.html` Zoho-first (window-global functions)

**A. Pushed badge.** New `zfPushedChip(r)` returns ✅ pushed / ⚠ re-push with a tooltip
(`fmtPushed(r.pushed_at)` + job #), shown in the Status cell after `zfStatusChip`. The
mobile card gets the same chip. Reuses the existing `fmtPushed` helper.

**B. Filters.** Add two chips to the zf-filter row: **☑ Pushable** (`zffPushable`) and
**✅ Pushed** (`zffPushed`). Add `zfIsPushable(r) = r.status==='matched' && r.new_dpl > 0
&& (!r.pushed_at || r.push_changed)`. Extend `visibleZohoFirstRows` (filter `pushable` →
`zfIsPushable`; `pushed` → `r.pushed_at`) and the `setZohoFilter` id map.

**C. Search.** Extend the search predicate in `visibleZohoFirstRows` so the haystack
also includes, for matched rows, `r.matched.product_name / base_name / canonical_sku`,
and for shared rows the `r.linked_entries[].product_name / base_name / canonical_sku`.

**D. SKU conflict.** In the table, the SKU cell shows the Zoho SKU; when `r.sku_conflict`
is set, append a ⚠ with `title` = the conflicting item name and color the SKU rose. Same
treatment in the card's SKU line. (Mirrors DPL-first `skuCell` / `skuLine`.)

**E. Re-pick.** `zfRowActions` adds a **🔄 Re-pick** button on matched rows that calls
`openAttachPicker(r.zoho_item_id)` (the existing unlinked-DPL picker). `attachDpl(entryId)`
becomes re-pick-aware: if the target Zoho item currently has a matched entry
(`row.entry_id != null` and it differs from the chosen entry), first
`POST …/entry/<old_entry_id>/not-in-zoho {value:true}` to detach the old link, then
`POST …/entry/<new_entry_id>/confirm-link {zoho_item_id}`. This prevents the row from
becoming "shared". Unmatched rows keep today's single confirm-link behavior.

**Push selection → pushable parity.** Round 1 keyed the push checkbox/selection off
`changed` rows. For DPL-first parity, key it off `zfIsPushable` instead: the checkbox
shows on pushable rows (matched, DPL present, not-yet-pushed or needs re-push);
`loadZohoFirst` default-selects pushable rows; `zfSelectedIds`/`zfChangedRows` become
`zfPushableRows`-based; the header select-all and bulk push use pushable. The bulk push
endpoint (`…/:brand/push {ids}`) is unchanged.

## Data flow

```
loadZohoFirst()
  → GET …/by-zoho
      route: getCatalog → attach sku_conflict (skuHolders query)
      buildZohoFirstView → rows[] now carry pushed_at/job/dpl, push_changed, sku_conflict
  → default-select pushable rows → renderZohoFirst()
      row: SKU(+⚠ conflict) | Linked DPL | Status(chip + zfPushedChip) | actions(✏ ⬆ 🔄 Re-pick)
      filters: All / No match / Changed / Shared / Unchanged / ☑ Pushable / ✅ Pushed
Re-pick: openAttachPicker → attachDpl → [detach old not-in-zoho] → confirm-link new → reload
```

## Error handling

Every fetch keeps the existing `showToast(..., 'error')` pattern and reloads on success.
Re-pick's two-step (detach → link) runs sequentially; if detach fails it throws before
linking (no partial swap that orphans the row). Bulk push keeps its disable+spinner.

## Testing

- **Unit** (`tests/unit/dpl-catalog-zoho-first.test.js`):
  - matched row surfaces `pushed_at/pushed_job_id/pushed_dpl/sku_conflict` from the entry;
  - `push_changed` true when `pushed_dpl !== current_dpl` (or rate differs), false when equal, false when never pushed;
  - unmatched/shared rows have these fields null.
- **E2E** (`tests/e2e/admin-dpl-zoho-first.spec.js`):
  - pushed chip renders ✅/⚠ from `pushed_at`/`push_changed`;
  - `Pushable` filter narrows to pushable rows; `Pushed` filter to pushed rows;
  - search by a linked DPL product name matches a matched row;
  - SKU ⚠ appears when `sku_conflict` set;
  - re-pick: `zfRowActions` renders 🔄 on a matched row (button presence smoke).

## Files

| File | Action |
|---|---|
| `routes/zoho.js` | Decorate by-zoho entries with `sku_conflict` before `buildZohoFirstView` |
| `services/dpl-catalog.js` | `buildZohoFirstView`: surface pushed_*/push_changed/sku_conflict on matched rows |
| `tests/unit/dpl-catalog-zoho-first.test.js` | Add assertions |
| `public/admin-dpl.html` | Pushed chip, Pushable/Pushed filters, full search, SKU ⚠, Re-pick, pushable-based selection |
| `tests/e2e/admin-dpl-zoho-first.spec.js` | Extend smoke |
