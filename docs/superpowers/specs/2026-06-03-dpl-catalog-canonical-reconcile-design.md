# DPL Catalog — canonical SKU/name reconcile on re-link (fix drift)

**Date:** 2026-06-03
**Status:** Approved
**Scope:** `services/dpl-catalog.js` (extract a `reconcileCanonical` helper, recompute in `confirmLink`); a one-time prod repair script. No route/UI/migration change.

## Problem

Pushing a confirmed catalog item failed with a duplicate-SKU error. Root cause (verified on prod): catalog entry 1314 has `canonical_sku = "GEMCLBLK"` but is linked to Zoho item `…417103` whose real SKU is `OPCLBL`. `GEMCLBLK` belongs to a *different* active item (`…135085`). The catalog computes canonical fields at **build** time from the linked item (the proposer sets `proposed_sku = linked item's SKU`), but **`confirmLink` (Confirm / Pick) changes the linked item WITHOUT recomputing canonical fields** — so re-picking an entry leaves the stale SKU/name from the previous link. Pushing then tries to *rename* the linked item's SKU to the stale value, colliding with whoever holds it.

Verified: re-running the proposer for 1314 against the correct OPCLBL link yields `proposed_sku="OPCLBL"`, `proposed_name="OPCLBL COLORANT BIRLA OPUS 01 L"` — clean.

## Decision (from brainstorming)

`canonical_sku` must always track the **linked item's own SKU** (correct + unique by construction). Push therefore never renames the SKU (`buildPushChanges` skips the SKU field when `canonical_sku` equals the linked SKU). Standardizing a specific item's SKU is a deliberate manual edit (existing edit sheet + push pre-filter handle that). Generating brand-new standardized SKUs (Option B) is out of scope.

## Architecture

### 1. `reconcileCanonical(entry, zohoItem)` — new helper in `services/dpl-catalog.js`

Pure function (uses the already-imported `computeProposedFields`). Reconstructs the proposer input from a catalog entry + a linked Zoho item row and returns the three canonical fields:

```
product   = entry.base_name ? `${entry.product_name} - ${entry.base_name}` : entry.product_name
pf        = computeProposedFields(
              { product, packSize: entry.dpl_size_label || entry.size_tier, dpl: parseFloat(entry.current_dpl) || 0, category: entry.category },
              { sku: zohoItem.zoho_sku ?? zohoItem.sku ?? '', description: zohoItem.zoho_description ?? zohoItem.description ?? '', category: zohoItem.zoho_category_name ?? zohoItem.category ?? '' },
              'birlaopus')
return { canonical_name: pf.proposed_name || null, canonical_sku: pf.proposed_sku || null, canonical_description: pf.proposed_description || null }
```

`buildCatalogFromDpl`'s existing inline canonical block is LEFT UNCHANGED (it builds the same `computeProposedFields` call from the raw `row`). We deliberately do NOT refactor build to call `reconcileCanonical` — build has the raw `row.product`/`row.packSize`, whereas `reconcileCanonical` reconstructs `product` from `entry.product_name`/`entry.base_name`; keeping build untouched guarantees zero behaviour change there. The ~6-line overlap is acceptable.

### 2. `confirmLink` recomputes canonical fields

`confirmLink(id, zohoItemId, updatedBy)` currently does one UPDATE (zoho_item_id, link_status='confirmed', link_confidence=100, link_reason='user-confirmed'). Change it to:
- Load the entry (`SELECT ... FROM dpl_catalog WHERE id=?`) and the newly linked Zoho item (`SELECT zoho_sku, zoho_description, zoho_category_name FROM zoho_items_map WHERE zoho_item_id=?`).
- Compute `reconcileCanonical(entry, zohoItem)`.
- UPDATE in one statement: `zoho_item_id`, `link_status`, `link_confidence`, `link_reason`, **`canonical_name`, `canonical_sku`, `canonical_description`**, `updated_by`.
- If the entry or zoho item is missing, fall back to the original link-only UPDATE (don't crash).

This is the fix: re-picking now resets the canonical fields to the chosen item, so they never drift.

### 3. One-time drift repair (prod script, reuses `reconcileCanonical`)

`scripts/reconcile-dpl-catalog.js` — for every linked entry (`zoho_item_id IS NOT NULL`) of a brand, load its current linked Zoho item, compute `reconcileCanonical`, and UPDATE the three canonical fields **only when `canonical_sku` differs from the recomputed value** (the drift signature). Logs how many were fixed + samples. Run once on prod after deploy. Targeted (skips already-correct rows); no manual edits exist on prod yet to clobber.

## Non-goals

- No route/endpoint/UI change (the existing GET enrich, edit sheet, push pre-filter all keep working; once canonical_sku tracks the link, the `sku_conflict` flag clears for fixed entries).
- No change to `computeProposedFields`, the linker, or `buildPushChanges`.
- No recurring auto-reconcile button (confirm-link recompute prevents recurrence; YAGNI).

## Error handling

- `reconcileCanonical` tolerates missing fields (defaults to '', dpl 0); `computeProposedFields` already returns a `base` object (no `proposed_*`) for unhandled cases → canonical fields become null (no SKU shown, push skips — safe).
- `confirmLink` falls back to link-only UPDATE if entry/zoho row not found.
- The repair script wraps each row in try/catch and continues.

## Testing

- Unit (`tests/unit/dpl-catalog.test.js`): `reconcileCanonical({product_name:'Colorant', base_name:'Black', size_tier:'1L', current_dpl:394, category:'Interior'}, {zoho_sku:'OPCLBL'})` → `canonical_sku==='OPCLBL'`, `canonical_name` contains 'OPCLBL', non-null description. Plus a null-SKU fallthrough case.
- Existing `dpl-catalog` build/linker tests stay green (refactor is behaviour-preserving).
- Post-deploy: run the repair script on prod (dry-count first), confirm 1314 → OPCLBL, then verify the catalog GET shows `sku_conflict=null` and a test push of that item succeeds (or skips cleanly).

## Key files

- Modify: `services/dpl-catalog.js` (add + export `reconcileCanonical`; recompute in `confirmLink`; `buildCatalogFromDpl` left as-is).
- Create: `scripts/reconcile-dpl-catalog.js`.
- Test: `tests/unit/dpl-catalog.test.js` (extend).
