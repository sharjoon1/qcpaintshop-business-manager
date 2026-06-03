# Birla Opus DPL — Long-format CSV support (auto-detect)

**Date:** 2026-06-03
**Status:** Approved
**Scope:** `services/price-list-parser.js` (new parsers) + `routes/zoho.js` (one call-site swap). No DB/UI change.

## Problem

`admin-dpl.html`'s CSV upload (`POST /api/zoho/items/dpl-parse-csv`) only accepts a **wide / "sparse-matrix"** CSV — headers `Category, Segment, Product Name, Product Code, Base Code (SKU), Base / Colour Name` + one column per pack-size. A user uploaded a **long / tall** CSV (`Category, SubCategory, Product, ProductCode, BaseCode, BaseName, ProdBaseCode, Unit, Price_excl_GST`; one row per size). `parseBirlaOpusCsv`'s required-header check fails → returns `[]` → endpoint 400 "No data rows found in CSV — check file format". The long format is legitimate and richer (its `ProdBaseCode` = the catalog's SKU stem). The system should ingest both.

## Approach

Add a long-format parser and a thin auto-detector; leave the existing wide parser untouched.

### Components (all in `services/price-list-parser.js`)

1. **`parseBirlaOpusCsv(buffer, effectiveDate)`** — existing wide parser. UNCHANGED.

2. **`parseBirlaOpusCsvLong(buffer, effectiveDate)`** (new) — parses the long format. Required headers: `Category, SubCategory, Product, ProductCode, ProdBaseCode, Unit, Price_excl_GST` (and uses `BaseCode`, `BaseName` when present). Per data row emits ONE result object with the SAME shape as the wide parser:
   - `product` = `colourName ? "${productName} - ${colourName}" : productName`
   - `packSize` = normalized `Unit` (see normalization)
   - `dpl` = `parseFloat(Price_excl_GST.replace(/,/g,''))`, dropped if not a positive number
   - `brand` = `'Birla Opus'`
   - `category` = `Category`, `segment` = `SubCategory`
   - `baseCode` = `ProdBaseCode` (e.g. "PE White") — the SKU-stem source
   - `productCode` = `ProductCode`
   - `colourCode` = `BaseCode` (numeric, e.g. "9900"), `colourName` = `BaseName`
   - `productName` = `Product`
   - `_proposedName` / `_proposedZohoSku` / `_proposedDescription` via the existing `buildProperBirla*` helpers (same as wide).
   - Skips rows missing `Product` or `ProdBaseCode`.

3. **`parseBirlaOpusCsvAuto(buffer, effectiveDate)`** (new) — reads the header line, decides:
   - has `Unit` AND `Price_excl_GST` columns → `parseBirlaOpusCsvLong`
   - else → `parseBirlaOpusCsv` (wide)
   Returns whatever the chosen parser returns (incl. `[]`).

### Unit normalization (long only)

`Unit` values like `"200 ML"`, `"1L"`, `"1KG"` → canonical size-column name. Try, in order, `[trimmed, trimmed without spaces, that uppercased]`; first match in `BIRLA_OPUS_SIZE_SET` wins (`"200 ML"`→`"200ML"`). If none match, keep the **trimmed verbatim** value (never drop the row) — consistent with the project's "don't silently drop on size mismatch" ethos (`normalizeSizeTier`).

### Endpoint change (`routes/zoho.js`)

`/items/dpl-parse-csv` (~line 5972): `parseBirlaOpusCsv(req.file.buffer, …)` → `parseBirlaOpusCsvAuto(req.file.buffer, …)`. Everything else (CSV_CAT_TO_CANON canonicalization, `brandDplService.save`, audit, match) is unchanged — it operates on the returned rows regardless of source format.

## Non-goals / decisions

- Duplicate `(product, base, size)` rows are NOT de-duped in the parser — the catalog upsert collapses by `match_key` downstream (observed duplicates are identical-price, harmless).
- No UI change — the existing CSV button now accepts either format.
- No change to the wide parser, the tab-paste parser, or the catalog.
- Brands other than Birla Opus: out of scope.

## Testing

Unit (`tests/unit/`):
- `parseBirlaOpusCsvLong`: a small long CSV (incl. a `"200 ML"` unit and a duplicate row) → correct field mapping, `packSize` normalization, `dpl` numeric, `baseCode`="PE White".
- `parseBirlaOpusCsvAuto`: long-header buffer routes to long parser (non-empty rows with `baseCode`); wide-header buffer routes to wide parser; rows count > 0 for both.
- Regression: existing wide-CSV parser test stays green.

Integration smoke (manual, post-deploy): upload the user's ORIGINAL `birla_opus_skus.csv` via admin-dpl.html → "Saved + matched 1340 rows" (≈), then Build Catalog works.

## Key files

- Modify: `services/price-list-parser.js` (add 2 functions + exports), `routes/zoho.js` (1 call swap).
- Test: `tests/unit/dpl-csv-long.test.js` (new).
- Reused: `buildProperBirlaItemName/ZohoSku/Description`, `splitCsvLine`, `BIRLA_OPUS_SIZE_SET`.
