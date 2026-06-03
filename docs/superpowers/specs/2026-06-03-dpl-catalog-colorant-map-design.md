# DPL Catalog — explicit colorant SKU map (auto-link colour-word-less SKUs)

**Date:** 2026-06-03
**Status:** Approved
**Scope:** `services/dpl-catalog.js` (add a map + one linker strategy). No route/UI/migration change. Rebuild after deploy.

## Problem

Birla's 16 water-based colorants don't auto-link to their Zoho items, so they fall to `needs_creating` and the user must Pick each manually. Two reasons, both verified on prod:

1. **Zoho colorant names lack/inconsistently carry the colour word** — e.g. SKU `OPCLBL`, name "OPCLBL **COLORANT** BIRLA OPUS 01 L" (no "Black"). The S2 name-linker needs the product/colour tokens in the name; they're absent.
2. **The DPL baseCode abbreviation does not map algorithmically to the Zoho SKU suffix** — `WHT→OPCLWT`, `BLK→OPCLBL`, `ORNG→OPCLOR`, `VLT→OPCLVI`, `EDRD→OPCLEXHR`, … are inconsistent; no transform (and no `dplBaseStem` extension) produces them. The S1 SKU-reconstruct can't bridge it.

The **productCode → Zoho SKU** relationship, however, is a clean 1-to-1 (the DPL productCodes 970001–970016 each denote one colour). An explicit table is the only reliable fix.

## Decision (from brainstorming)

Add an explicit `productCode → Zoho SKU` map in code (16 entries; dev-maintained — YAGNI vs a DB table for ~16 stable items) and a deterministic, tier-checked linker strategy that uses it. Solvent colorants (970025+) have no OPCL items → stay `needs_creating` (correct). The map is extensible for any future "bad-name" product family.

## Architecture

### 1. The map (`services/dpl-catalog.js`)

```javascript
// DPL productCode → exact Zoho SKU, for product families the name/SKU-stem linkers
// can't match (e.g. Birla water colorants: Zoho names lack the colour word and the
// DPL base abbreviations don't map to the Zoho suffix). Verified against prod.
const PRODUCT_CODE_SKU = {
    '970001': 'OPCLWT', '970002': 'OPCLBL', '970003': 'OPCLBLU', '970004': 'OPCLOR',
    '970005': 'OPCLMG', '970006': 'OPCLGR', '970007': 'OPCLVI', '970008': 'OPCLINY',
    '970009': 'OPCLINR', '970010': 'OPCLRO', '970011': 'OPCLYO', '970012': 'OPCLEXY',
    '970013': 'OPCLEXR', '970014': 'OPCLEXHR', '970015': 'OPCLEXHDY', '970016': 'OPCLSWT',
};
```

### 2. New linker strategy in `linkEntryToZoho(entry, zohoItems)`

Inserted as the FIRST strategy, BEFORE S0/S1 (it is the most precise — an exact, curated productCode→SKU pin):

```
const mapSku = entry.product_code && PRODUCT_CODE_SKU[String(entry.product_code).trim()];
if (mapSku) {
    const hit = items.find(z => {
        const sku = String(z.sku || z.zoho_sku || '').toUpperCase();
        if (sku !== mapSku.toUpperCase()) return false;
        const tier = normalizeSizeTier(extractSizeFromZohoName(z.name || z.zoho_item_name || '', sku));
        return tier === entry.size_tier;   // tier-checked: a 200ml colorant won't grab the 1L OPCL item
    });
    if (hit) return { zoho_item_id: hit.zoho_item_id, link_status: 'confirmed', link_confidence: 95, link_reason: 'colorant-map' };
}
```

If no matching Zoho item (e.g. the colorant exists at a size with no OPCL item) → fall through to the existing S0/S1/S2/needs_creating logic unchanged.

The entry already carries `product_code` (set by `buildCatalogFromDpl` from the parsed row's `productCode`). The OPCL items are 1L only, so only 1L colorant entries match; other sizes fall through (correct).

## Non-goals

- No change to `dplBaseStem`/`BASE_WORD_CODE`/S1/S2, the proposer, `confirmLink`, routes, or UI.
- Solvent colorants (970025–970036) — no Zoho OPCL items; intentionally left `needs_creating`.
- No DB-driven mapping table (16 stable items; revisit only if many more families need it).

## Error handling

- Missing/blank `product_code` → strategy skipped (falls through).
- Map SKU present but no active Zoho item with it (or wrong tier) → falls through to existing logic; no crash, no false match.

## Testing

- Unit (`tests/unit/dpl-catalog.test.js`): `linkEntryToZoho({ product_code:'970002', size_tier:'1L', ... }, [{ zoho_item_id:'Z', sku:'OPCLBL', name:'OPCLBL COLORANT BIRLA OPUS 01 L' }])` → `link_status==='confirmed'`, `link_reason==='colorant-map'`, `zoho_item_id==='Z'`. A wrong-tier case (entry `size_tier:'200ml'`, only the 1L OPCL item present) → NOT matched by the colorant strategy (falls through). A non-colorant productCode is unaffected (existing S1/S2 tests stay green).
- Post-deploy: rebuild → the 16 colorants become `confirmed → OPCL*`; spot-check Colorant-Black → OPCLBL, White → OPCLWT.

## Key files

- Modify: `services/dpl-catalog.js` (add `PRODUCT_CODE_SKU` + the strategy in `linkEntryToZoho`).
- Test: `tests/unit/dpl-catalog.test.js` (extend).
