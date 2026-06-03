# DPL Catalog — scope candidate Zoho items to the catalog's brand

**Date:** 2026-06-03
**Status:** Approved
**Scope:** `routes/zoho.js` (build endpoint query + a small scope helper), `public/admin-dpl.html` (picker brand param). Post-deploy: rebuild the catalog. No migration.

## Problem

`POST /items/dpl-catalog/:brand/build` feeds **all active Zoho items** (every brand) to the linker (`WHERE zoho_status = 'active'`, no brand filter — `routes/zoho.js:127`). The Birla Opus DPL "Colorant - …" rows therefore matched **ASTRAL PAINTS** "GEMCL …" colorants instead of Birla's own "OPCL…" colorants. Verified on prod: **9 catalog entries linked to non-Birla items** (8 Astral colorants + 1 null-brand). Birla DOES have its own colorant items (`OPCLBL`/`OPCLWT`/`OPCLGR`/`OPCLMG`/`OPCLVI`/…, brand `BIRLA OPUS`) — the unscoped linker just grabbed the wrong brand. This undermines the whole point of Build Catalog (it should only match within the brand).

## Decision (from brainstorming)

Scope the catalog's candidate Zoho items to the **same brand** as the DPL being built, using a **tolerant** filter — match the `zoho_brand` column OR the item name (so null/blank-brand Birla items whose name carries "BIRLA OPUS", e.g. the Allwood Thinner, are still candidates). For Birla this yields **511 candidates** (of 2436 active); excludes Astral/Berger/Asian/etc.

## Architecture

### 1. Brand-scope helper (`routes/zoho.js`)

```javascript
// Per-brand SQL scope (a WHERE fragment, no params — literal patterns only) for
// catalog candidate Zoho items. Tolerant: brand column OR item name carries the
// brand, so blank-brand items are still matched. Unknown brand → '' (no scope).
const CATALOG_ZOHO_SCOPE = {
    birlaopus: "(UPPER(COALESCE(zoho_brand,'')) LIKE '%BIRLA%' OR UPPER(zoho_item_name) LIKE '%BIRLA OPUS%')",
};
function catalogZohoScopeSql(brand) {
    const s = CATALOG_ZOHO_SCOPE[String(brand || '').toLowerCase()];
    return s ? ` AND ${s}` : '';
}
```
The patterns are static literals (no user input) → safe to interpolate.

### 2. Build endpoint uses the scope

`routes/zoho.js:123-128` — the candidate query gains the scope:

```javascript
const [zohoItems] = await pool.query(
    `SELECT zoho_item_id, zoho_item_name AS name, zoho_sku AS sku, zoho_rate AS rate,
            zoho_cf_dpl AS cf_dpl, zoho_brand AS brand, zoho_category_name AS category,
            zoho_description AS description
     FROM zoho_items_map WHERE zoho_status = 'active'${catalogZohoScopeSql(brand)}`
);
```
Everything else (buildCatalogFromDpl, upsert, summary) is unchanged — it just receives fewer, correctly-scoped candidates.

### 3. Picker scope (`public/admin-dpl.html`)

The catalog re-pick (`catPickerSearch`) calls `GET /api/zoho/items?limit=40&search=…`. That endpoint already supports a `brand` param (`zoho_brand LIKE %brand%`). Append `&brand=BIRLA` so the manual picker only offers Birla items (the catalog is Birla-only v1). Null-brand Birla items won't appear in the brand-filtered picker, but the user can search them by exact name if ever needed — acceptable for a manual, rare action.

### 4. Rebuild (post-deploy, controller-run)

After deploy, trigger Build Catalog again (the endpoint is idempotent, upsert by `match_key`). With brand-scoped candidates the linker re-matches: the 8 Astral colorant links become correct `OPCL…` Birla links (or `needs_creating` where Birla lacks the item). Verify `Colorant - Black → OPCLBL`, `White → OPCLWT`, etc., and that zero entries link to non-Birla items.

## Non-goals

- No change to `buildCatalogFromDpl`, the linker algorithm, the proposer, or `confirmLink`.
- No new brands (the scope map has only `birlaopus`; extensible later).
- Not preserving prior manual confirmations across the rebuild — the catalog is early-stage and the rebuild is the explicit corrective action.

## Error handling

- Unknown/unsupported brand → `catalogZohoScopeSql` returns `''` (no scope) — but `assertSupportedBrand` already gates the endpoint to birlaopus, so in practice the scope always applies.
- If the scope yields zero candidates (misconfigured), build proceeds and all rows become `needs_creating` (visible, not silent).

## Testing

- Unit (`tests/unit/dpl-catalog-endpoints.test.js` or a small new test): `catalogZohoScopeSql('birlaopus')` contains `BIRLA`; `catalogZohoScopeSql('unknown')` === `''`. (Export the helper for testing.)
- `node -e "require('./routes/zoho.js')"` loads; existing catalog endpoint tests stay green.
- Post-deploy integration: rebuild → query `dpl_catalog JOIN zoho_items_map` for any entry whose linked `zoho_brand` is not Birla → expect 0; spot-check colorants → OPCL*.

## Key files

- Modify: `routes/zoho.js` (scope helper + build query + export helper for the test).
- Modify: `public/admin-dpl.html` (picker `&brand=BIRLA`).
- Test: a unit test for `catalogZohoScopeSql`.
