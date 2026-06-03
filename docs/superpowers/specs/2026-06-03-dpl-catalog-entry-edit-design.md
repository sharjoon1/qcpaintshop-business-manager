# DPL Catalog — entry detail + edit (name/SKU/description, old DPL, SKU-dup safety)

**Date:** 2026-06-03
**Status:** Approved
**Scope:** `routes/zoho.js` (catalog GET enrich + new edit endpoint + push pre-filter), `services/dpl-catalog.js` (one helper), `public/admin-dpl.html` (detail/edit sheet + card affordances). No migration.

## Problem

After Build Catalog, a test push of a confirmed item failed with *"One or more SKUs in the batch are already held by a different active item in Zoho."* Root cause (verified on prod): catalog entry "Colorant - Black" (id 1314) is confirmed-linked to Zoho item `…417103`, but its **auto-proposed `canonical_sku` "GEMCLBLK"** is held by a DIFFERENT active item — *"GEMCL BLACK COLORANT ASTRAL 01 L"* (`…135085`). `createBulkEditJob`'s SKU guard correctly rejects the WHOLE batch, so a single bad item blocks everything. Separately, `computeProposedFields` produces unreliable canonical name/SKU/description for non-standard products (Colorant/tinter rows show a wrong "GEM ASTRAL PAINTS" brand).

User needs, in the catalog review UI:
1. See & edit the auto-proposed **name / SKU / description**.
2. **Non-duplicate SKU** — flag when the proposed SKU collides with another active item, and let the user edit it.
3. See the **old DPL** (current Zoho price) alongside new DPL → selling rate.
4. See the **description**, editable.

## Decisions (from brainstorming)

- Edit UI = **tap a card/row → a detail/edit sheet (modal)**; card stays clean.
- Duplicate SKU = **block + show why + let user edit**: conflicting entries are flagged (⚠) and **excluded from the push** (reported in `skipped` with the conflicting item's name), so the non-conflicting items still push. Editing the SKU to a unique value clears the flag.
- Out of scope (YAGNI): fixing the `computeProposedFields` proposer algorithm; the existing Confirm / Pick / change buttons; brands other than Birla.

## Architecture

### 1. Catalog GET enrichment (`GET /api/zoho/items/dpl-catalog/:brand`)

Today the endpoint returns `getCatalog(brand)` = `SELECT * FROM dpl_catalog`. Enrich in the endpoint (keep `getCatalog` simple):

- After fetching entries, run ONE query for the linked Zoho values:
  `SELECT zoho_item_id, zoho_item_name, zoho_sku, zoho_cf_dpl, zoho_rate, zoho_description FROM zoho_items_map WHERE zoho_item_id IN (<distinct linked ids>)` → map by id.
- Run ONE query for SKU holders:
  `SELECT zoho_item_id, zoho_item_name, UPPER(zoho_sku) sku FROM zoho_items_map WHERE zoho_status='active' AND UPPER(zoho_sku) IN (<distinct UPPER(canonical_sku)>)` → map sku → {id, name}.
- Decorate each entry with:
  - `old_dpl` = linked `zoho_cf_dpl` (or null), `old_rate` = linked `zoho_rate`, `zoho_name`, `zoho_sku`, `zoho_description`.
  - `sku_conflict` = the holder's `zoho_item_name` when `UPPER(canonical_sku)` is held by an active item whose id ≠ this entry's `zoho_item_id`; else null.

Return the decorated array (same endpoint, additive fields — UI back-compat safe).

### 2. Edit endpoint (`PUT /api/zoho/items/dpl-catalog/entry/:id`)

`requirePermission('zoho','manage')`. Body: `{ canonical_name?, canonical_sku?, canonical_description? }` (only provided keys updated). Calls new service `dplCatalogService.updateCanonicalFields(id, fields, updatedBy)`:

```
UPDATE dpl_catalog SET canonical_name=?, canonical_sku=?, canonical_description=?, updated_by=? WHERE id=?
```
(only the SET clauses for provided keys). Saves even when the SKU duplicates another item (so the user can iterate). Response: `{ success:true }`. Trim string inputs; empty string allowed (clears the field).

### 3. Push pre-filter (`POST .../dpl-catalog/:brand/push`)

Before building `items`, compute SKU conflicts for the chosen pushable entries (reuse the holders query from §1, scoped to the chosen entries' canonical_skus). For each pushable entry whose `canonical_sku` is held by an active item with a different id → move to `skipped` with `reason: "SKU '<sku>' already used by '<item name>'"`. Build `items` only from the remainder. This means a conflicting item no longer reaches `createBulkEditJob` (whose guard remains a backstop), so the batch never all-or-nothings on one dup.

### 4. UI — detail/edit sheet (`public/admin-dpl.html`)

- **Card/row** gains: a ✏ button (and tap on the card body) that opens the sheet; a **⚠ dup** badge when `sku_conflict` is set; the price line shows **`old_dpl` → `current_dpl` → `current_rate`** (old DPL muted; "—" when `old_dpl` null).
- **Edit sheet** (new modal `#catEditModal`, modeled on the existing `#catPickerModal`):
  - Read-only header: product · base · size; linked Zoho item (`zoho_name` / `zoho_sku`).
  - Price row: Old DPL `old_dpl` → New DPL `current_dpl` → Selling `current_rate`.
  - Editable inputs: **Name** (`canonical_name`), **SKU** (`canonical_sku`), **Description** (`canonical_description`, textarea).
  - SKU input shows a live ⚠ line when the current value equals a known conflict (`sku_conflict` from load, refreshed after save).
  - **Save** → `PUT .../entry/:id` with the three fields → on success, close the sheet, `toast`, and call `loadCatalog()` to re-fetch (this recomputes `sku_conflict`/old-DPL server-side, so the card badge + sheet stay accurate). Reload cost is one GET; acceptable.
- Reuses `catPushSelected`, render pipeline, and the existing Confirm/Pick handlers unchanged.

## Components

| Unit | Change |
|---|---|
| `routes/zoho.js` GET catalog | enrich with linked Zoho values + `sku_conflict` |
| `routes/zoho.js` PUT entry | new edit endpoint |
| `routes/zoho.js` push | pre-filter SKU conflicts into `skipped` |
| `services/dpl-catalog.js` | `updateCanonicalFields(id, fields, updatedBy)` |
| `public/admin-dpl.html` | `#catEditModal` + open/save handlers; card ✏ + ⚠ + old-DPL price line |

**Reused unchanged:** `getCatalog`, `buildPushChanges`, `createBulkEditJob` (still a backstop guard), `confirmCatalogEntry`, `openCatPicker`, the search/filter/card pipeline, push/apply endpoints.

## Error handling

- PUT invalid id → 400; missing body → 400 "no fields to update".
- GET enrichment queries tolerate zero linked ids / zero skus (skip the `IN ()`).
- Push with all-conflicting selection → 400 "Nothing to push (all selected have SKU conflicts)" + `skipped` detail.

## Testing

- Unit (`services/dpl-catalog.js`): `updateCanonicalFields` issues the right UPDATE with only provided keys + param order.
- Route registration: `PUT /items/dpl-catalog/entry/:id` registered.
- Manual smoke (desktop + mobile): tap card → sheet shows old→new→selling + name/SKU/desc; edit SKU to unique → Save → ⚠ clears; push a confirmed dup → it lands in `skipped` with the holder name, good items still push.

## Key files

- Modify: `routes/zoho.js`, `services/dpl-catalog.js`, `public/admin-dpl.html`.
- Test: `tests/unit/dpl-catalog.test.js` (extend), `tests/unit/dpl-catalog-endpoints.test.js` (extend).
