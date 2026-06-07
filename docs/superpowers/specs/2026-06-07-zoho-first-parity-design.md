# Zoho-first Parity — Linked DPL Product, Shared Resolve, Category, Stats, Bulk Push

**Date:** 2026-06-07
**Status:** Approved (chat), pending spec review
**Page:** `public/admin-dpl.html` — Build Catalog → "Zoho-first" view
**Brand:** Birla Opus only (inherits existing scope)

---

## Problem

The Build Catalog panel has two views: **DPL-first** (one row per DPL-list entry →
hunt the Zoho match) and **Zoho-first** (one row per active Zoho item → see its DPL
price). DPL-first was built first and is feature-rich. Zoho-first was added later as
the reverse view so the user can see *every* active Opus item in Zoho and quickly spot
which ones still lack a correct DPL match.

In practice Zoho-first is hard to use because it is missing features DPL-first has.
Most importantly: **a matched Zoho row does not show which DPL product it is linked
to** — it shows only the DPL price (New DPL), not the DPL entry's name/base/size/SKU.
The user cannot tell *what* matched, only *that* a price exists.

## Goal

Bring Zoho-first to functional parity with DPL-first so it is the comfortable
"reverse" reconciliation view. Five gaps, all approved for this round:

1. **Linked DPL product** — matched rows show the linked DPL entry (product · base ·
   size · canonical SKU), symmetric to DPL-first's "Linked Zoho item" column.
2. **Shared resolve** — shared rows (one Zoho item linked to >1 DPL entry) list the
   colliding DPL entries, each with a detach action.
3. **Category display** — show the Zoho category per row/card (already fetched, never
   rendered).
4. **Stats** — add `⚠ Shared` and `✓ Unchanged` count chips.
5. **Bulk-push parity** — per-row checkboxes + select-all so "Push updated DPL" pushes
   the *selected* changed rows, not blindly all changed rows.

## Non-goals

- No new write endpoints. All actions reuse existing routes.
- No change to the matching/proposal algorithm (`proposeDplForZoho`, `linkEntryToZoho`).
- No DPL-first changes.
- Shared-item DPL price changes remain excluded from bulk push (resolve via detach,
  then the entry flows through normal matched/changed handling) — unchanged policy.

---

## Architecture

### Backend — `services/dpl-catalog.js :: buildZohoFirstView` (pure, unit-tested)

The helper already groups linked catalog entries per Zoho item id (`linkMap`) but
discards the entry details for matched/shared rows, keeping only price-derived fields.
Add the linked entry details to each row:

- **matched** (`linked.length === 1`): add
  ```js
  matched: {
    entry_id, product_name, base_name, dpl_size_label, canonical_sku
  }
  ```
  (`entry_id` already exists on the row; `matched` is the human-readable detail block.)

- **shared** (`linked.length > 1`): add
  ```js
  linked_entries: [
    { entry_id, product_name, base_name, dpl_size_label, canonical_sku, current_dpl }
  ]   // one per colliding entry, in linkMap order
  ```

`category` is already on each row. `unmatched` rows are unchanged (they already carry
`proposal`). No row-shape change for unmatched/matched-unchanged beyond the new
optional `matched` block.

Source fields (`product_name`, `base_name`, `dpl_size_label`, `canonical_sku`,
`current_dpl`) are the same catalog-entry fields already mapped into `unlinkedEntries`,
so they are known to exist on `getCatalog` output.

**No change** to the `GET /api/zoho/items/dpl-catalog/:brand/by-zoho` route or any SQL.

### Frontend — `public/admin-dpl.html` (Zoho-first view, window-global functions)

**#1 Linked DPL product column.** Insert a new column header "Linked DPL product"
before "Status" in the desktop table; mirror it in the mobile card. Render:
- matched: `product_name · base_name · size_label` + small mono `canonical_sku` line.
- shared: short summary `N DPL entries` linking to the expand (see #2).
- unmatched: `—` (the existing proposal block already lives in the Status/action cell).

**#2 Shared resolve.** A shared row's Linked-DPL cell expands (inline toggle) to list
each colliding entry: `product · base · size · DPL` + a **🚫 Not in Zoho** button that
calls the existing `markNotInZoho(entry_id, true)` →
`POST /api/zoho/items/dpl-catalog/entry/:id/not-in-zoho {value:true}`, then
`loadZohoFirst()` to refresh. This is exactly DPL-first's duplicate-detach mechanism,
reused verbatim.

**#3 Category.** Show `r.category` as a small gray line under the Zoho item name in
both the table cell and the card (same placement as DPL-first's secondary text).

**#4 Stats.** Add two chips to the Zoho-first stat strip: `⚠ Shared: <n>` (count of
`status==='shared'`) and `✓ Unchanged: <n>` (count of `status==='matched' && !changed`).
Computed in `renderZohoFirst` alongside the existing total/unmatched/changed counts.

**#5 Bulk-push parity.** Add a leading checkbox column (desktop) / card checkbox shown
only on **changed** rows. State held in a `zfPushSelected` map keyed by `entry_id`
(mirrors DPL-first's `catPushSelected`). A header checkbox toggles all *visible changed*
rows. The existing **Push updated DPL** button:
- count badge = number of selected changed rows (not all changed);
- on click, pushes the selected `entry_id`s via the existing
  `POST /api/zoho/items/dpl-catalog/:brand/push {ids}` (unchanged endpoint);
- default selection on load = all changed rows selected (preserves today's behavior so
  the button is useful without extra clicks), then the user can deselect.
Selection is reset/reconciled on every `loadZohoFirst()` to keep only still-changed
entries (same discipline as `loadCatalog`'s `keepSel`).

## Data flow

```
loadZohoFirst()
  → GET …/by-zoho  → { rows[], unlinkedEntries[] }
       rows[].matched / rows[].linked_entries  (NEW)
  → renderZohoFirst()  → table + cards, stats, checkbox state
       per-row: ✏Edit / ⬆Push / (unmatched) Accept+Attach / (shared) Not-in-Zoho
       bulk: Push updated DPL (selected changed ids)
```

## Error handling

Reuses the existing `showToast(..., 'error')` pattern on every fetch. Detach, push,
and edit each re-`loadZohoFirst()` on success so the view always reflects server truth.
In-flight guards already exist (`zfPushInFlight`); the bulk button disables + spinner
during push.

## Testing

- **Unit** (`tests/unit/dpl-catalog-zoho-first.test.js`): extend existing suite —
  - matched row carries `matched` with `product_name/base_name/dpl_size_label/canonical_sku`;
  - shared row carries `linked_entries` array of length `shared_count` with entry detail;
  - unmatched/unchanged rows unchanged (regression).
- **E2E** (`tests/e2e/admin-dpl-zoho-first.spec.js`): extend —
  - "Linked DPL product" column renders product text on a matched row;
  - shared row detach button visible + calls not-in-zoho;
  - changed-row checkbox + select-all drive the push count.

## Files

| File | Action |
|---|---|
| `services/dpl-catalog.js` | Modify `buildZohoFirstView` — add `matched` + `linked_entries` |
| `tests/unit/dpl-catalog-zoho-first.test.js` | Add assertions |
| `public/admin-dpl.html` | Zoho-first table/cards/stats/checkbox + shared expand |
| `tests/e2e/admin-dpl-zoho-first.spec.js` | Extend smoke |
