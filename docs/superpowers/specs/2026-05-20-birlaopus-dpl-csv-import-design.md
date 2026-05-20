# Birla Opus DPL CSV Import — Design Spec

**Date:** 2026-05-20
**Status:** Approved
**Source:** BirlaOpus_DPL_15May2026_SKU_Report.csv (331 SKU rows → ~990 line items)

---

## 1. Goal

Replace the current manual-paste workflow for Birla Opus DPL updates with a structured CSV upload path that:
- Parses all 990 line items from the sparse-matrix SKU report
- Generates properly structured item names, Zoho SKUs, and rich descriptions from the CSV's own structured fields
- Feeds the existing match → review → push-to-Zoho workflow unchanged
- Saves to `brand_dpl_lists` so "Match Now" works from the saved card in future

The paste-text panel stays intact; both coexist.

---

## 2. CSV Format

```
Columns: Category, Segment, Product Name, Product Code, Base Code (SKU),
         Base / Colour Name, [37 size columns]
```

- **Sparse matrix:** each row has prices only in applicable size columns; the rest are empty
- **One row = one SKU variant** across all its available sizes
- Size columns: 50ML, 100ML, 200ML, 400ML, 500ML, 0.2L, 0.5L, 0.9L, 1L, 2.5L, 3.6L, 4L, 5L, 6L, 7.5L, 9L, 10L, 12.5L, 18L, 20L, 25L, 30L, 37.5L, 0.5KG, 1KG, 2KG, 3KG, 5KG, 10KG, 12KG, 15KG, 20KG, 25KG, 30KG, Per Unit, Per Tube, Per Sheet
- "Base / Colour Name" field format: `"9900 - White"` → split on ` - ` → colourCode=`"9900"`, colourName=`"White"`
- File is UTF-8 with BOM (`﻿`)

---

## 3. Architecture

```
CSV file (browser)
  → POST /api/zoho/items/dpl-parse-csv        (routes/zoho.js)
    → parseBirlaOpusCsv(buffer)               (services/price-list-parser.js)
       → for each non-empty price cell:
           buildProperBirlaZohoSku()           → "PEWHITE-1L"
           buildProperBirlaItemName()          → "PE WHITE ONE PURE ELEGANCE WHITE BIRLA OPUS 1L"
           buildProperBirlaDescription()       → rich description string
    → brandDplService.save()                  (brand_dpl_lists, brand='birlaopus')
    → matchWithZohoItems()                    (exact SKU branch added)
       → computeProposedFields()              (pre-set field pass-through branch)
    → returns same aiData shape showAiResults() already consumes
```

**Files changed:**

| File | Change |
|---|---|
| `services/price-list-parser.js` | Add `parseBirlaOpusCsv`, 3 builder helpers, SKU-match branch in `matchWithZohoItems`, pass-through branch in `computeProposedFields` |
| `routes/zoho.js` | Add `POST /items/dpl-parse-csv` endpoint |
| `config/uploads.js` | Add `uploadPriceCsv` multer config |
| `public/admin-dpl.html` | Add CSV tab toggle + upload area in Step 1 |
| `scripts/import-birlaopus-dpl-csv.js` | New standalone CLI |

**Router note:** The spec originally referenced `routes/item-master.js` (mounted at `/api/item-master`), but all `admin-dpl.html` API calls target `/api/zoho/items/…` which is `routes/zoho.js`. The endpoint lives in `zoho.js` — consistent with `parse-price-list`, `brand-dpl/:brand`, etc.

---

## 4. Parser: `parseBirlaOpusCsv(csvBuffer)`

Location: `services/price-list-parser.js`

**Algorithm:**
1. Strip UTF-8 BOM, split into lines, parse header row to build a `colIndex` map (column name → array index). This makes the parser robust to future column reordering.
2. Define `KNOWN_SIZES` constant — the 37 known size column names.
3. Build `sizeColumns` array: filter header columns that appear in `KNOWN_SIZES`, record their indices.
4. For each data row:
   - Skip if fewer columns than the header count
   - Extract: `category`, `segment`, `productName`, `productCode`, `baseCode`, `colourRaw`
   - Parse `colourRaw` ("9900 - White") → `{ colourCode: "9900", colourName: "White" }` (split on first ` - `)
   - For each size column: skip if cell is empty or whitespace
   - Validate price: strip commas, check `/^\d+(\.\d+)?$/`, parse float, skip if ≤ 0
   - Call the three builders, attach as `_proposedName`, `_proposedZohoSku`, `_proposedDescription`
   - Push item to results
5. Return flat array

**Output item shape:**
```js
{
  product: "One Pure Elegance - White",    // productName + " - " + colourName (fuzzy-match fallback)
  packSize: "1L",                          // normalized via existing normalizePackSize()
  dpl: 520,
  brand: "Birla Opus",
  category: "Interior",
  segment: "Luxury",
  baseCode: "PE White",
  productCode: "941001",
  colourCode: "9900",
  colourName: "White",
  _proposedName: "PE WHITE ONE PURE ELEGANCE WHITE BIRLA OPUS 1L",
  _proposedZohoSku: "PEWHITE-1L",
  _proposedDescription: "Birla Opus One Pure Elegance | 9900 - White | Pack: 1L | Code: 941001 | Interior - Luxury | DPL: ₹520 | Effective: 15 May 2026",
}
```

---

## 5. Builder Helpers

All three added to `services/price-list-parser.js` and exported.

### `buildProperBirlaItemName(row)`
```
Input:  { baseCode: "PE White", productName: "One Pure Elegance", colourName: "White", size: "1L" }
Output: "PE WHITE ONE PURE ELEGANCE WHITE BIRLA OPUS 1L"
Rule:   `${baseCode.toUpperCase()} ${productName.toUpperCase()} ${colourName.toUpperCase()} BIRLA OPUS ${size}`
```
`row.colourName` is the already-extracted display name (not the "9900 - White" raw value).

> **Spec note — resolved ambiguity:** The original spec stated `[BASE_SKU] [PRODUCT NAME] [COLOUR NAME]` (product before colour) but the NS 2 example showed the reverse (`NS 2 MID TONE CALISTA NEO STAR`). This design locks in **PRODUCT before COLOUR** throughout (`PE WHITE ONE PURE ELEGANCE WHITE BIRLA OPUS 1L`, `NS 2 CALISTA NEO STAR MID TONE BIRLA OPUS 0.9L`) — consistent with the format declaration and example 1. If the user confirms they want COLOUR before PRODUCT for certain items, a separate rule can be added.

### `buildProperBirlaZohoSku(row)`
```
Input:  { baseCode: "PE White", size: "1L" }
Output: "PEWHITE-1L"
Rule:   baseCode with all whitespace removed, uppercased + "-" + size (uppercased)
```
Size is kept as-is from the CSV header (e.g. "1L", "0.9L", "200ML", "0.5KG", "Per Unit").

### `buildProperBirlaDescription(row, effectiveDate)`
```
Input:  { productName, colourCode, colourName, size, productCode, category, segment, dpl }
        effectiveDate: "2026-05-15"
Output: "Birla Opus One Pure Elegance | 9900 - White | Pack: 1L | Code: 941001 | Interior - Luxury | DPL: ₹520 | Effective: 15 May 2026"
```
`effectiveDate` is formatted as "15 May 2026" for display. The CLI script can pass a different date.

---

## 6. Match Flow Integration

### `matchWithZohoItems` — exact SKU branch (new, added before fuzzy loop)

```js
// Pre-index Zoho items by SKU for O(1) exact lookup
const zohoByExactSku = new Map();
for (const zi of scopedZoho) {
    const sku = (zi.sku || zi.zoho_sku || '').toUpperCase().trim();
    if (sku) zohoByExactSku.set(sku, zi);
}

// For each parsed item with a pre-computed Zoho SKU, attempt exact match first
for (const parsed of parsedItems) {
    if (!parsed._proposedZohoSku) continue;  // skip non-CSV items
    const exactMatch = zohoByExactSku.get(parsed._proposedZohoSku.toUpperCase());
    if (exactMatch) {
        // treat as matched, compute proposed fields, push to matched[]
    } else {
        // push to unmatched[] for fuzzy fallback
    }
}
// remaining items (no _proposedZohoSku) go through existing fuzzy logic unchanged
```

This branch is gated on `_proposedZohoSku` being present — PDF/text items never have this field.

### `computeProposedFields` — pre-set pass-through (new branch, at top of function)

```js
if (pdfItem._proposedName) {
    return {
        ...base,
        proposed_name: pdfItem._proposedName,
        proposed_sku: pdfItem._proposedZohoSku || base.current_sku,
        proposed_description: pdfItem._proposedDescription,
    };
}
// ... existing logic unchanged below
```

`base` already contains `proposed_rate` (computed from DPL × 1.298 = 1.18 × 1.10 — same formula).

---

## 7. Endpoint: `POST /api/zoho/items/dpl-parse-csv`

Location: `routes/zoho.js`

```
Auth:     requirePermission('zoho', 'manage')
Upload:   uploadPriceCsv.single('csv')   (memory storage, 5MB, .csv only)
Body:
  effective_date   optional YYYY-MM-DD; extracted from filename if absent
  match            optional boolean, default true

Steps:
  1. Reject if no file
  2. Extract effective_date from filename regex /(\d{1,2})([A-Za-z]{3})(\d{4})/
     Month map: Jan→01 … Dec→12 → "15May2026" → "2026-05-15"
     Fallback: body.effective_date → today
  3. csvString = req.file.buffer.toString('utf8')
  4. parsedRows = parseBirlaOpusCsv(req.file.buffer)
  5. If parsedRows.length === 0 → 400 "No data rows found in CSV"
  6. before = await brandDplService.get('birlaopus')
  7. saved = await brandDplService.save({ brand:'birlaopus', rawText:csvString, parsedRows, effectiveDate, updatedBy })
  8. audit-log: action 'brand_dpl.save', entity_type 'brand_dpl_lists', entity_id 'birlaopus'
  9. If match: match = await runBrandDplMatch('birlaopus', parsedRows)
  10. Return { success:true, data:{ saved, match, parsed_count:parsedRows.length } }

Error handling:
  - File type rejected by multer → 400
  - Zero rows → 400
  - DB/match error → 500
```

Response shape is identical to `POST /items/brand-dpl/:brand` so the frontend reuses the same `showAiResults()` handler.

---

## 8. Multer Config: `uploadPriceCsv`

Location: `config/uploads.js`

```js
const uploadPriceCsv = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const ok = file.mimetype === 'text/csv'
            || file.mimetype === 'application/vnd.ms-excel'
            || file.originalname.toLowerCase().endsWith('.csv');
        ok ? cb(null, true) : cb(new Error('Only CSV files allowed'));
    }
});
```

Exported alongside existing configs. No new upload directory needed (memory-only).

---

## 9. UI: `admin-dpl.html` Step 1 CSV Tab

**Tab bar** (inserted above existing drop-zone):
```
[ 📄 Upload PDF ]  [ 📊 Upload CSV ]
```
- Two `<button>` elements toggling `active` class
- Switching tabs shows/hides the PDF area vs CSV area; brand DPL paste panel stays below both

**CSV tab content:**
- File input: `accept=".csv"`, id=`csvFileInput`
- Label: `"Birla Opus SKU Report CSV (e.g. BirlaOpus_DPL_15May2026_SKU_Report.csv)"`
- On file select: attempt to extract date from filename → pre-fill date input
- Date input: `type="date"`, id=`csvEffectiveDate`, label "Effective date"
- "Parse & Match CSV" button → `parseCsv()` function
- Status area showing parsed count badge on success: `"990 line items parsed"`

**`parseCsv()` function:**
```js
async function parseCsv() {
    const file = document.getElementById('csvFileInput').files[0];
    const fd = new FormData();
    fd.append('csv', file);
    fd.append('effective_date', document.getElementById('csvEffectiveDate').value || '');
    fd.append('match', 'true');
    const resp = await fetch('/api/zoho/items/dpl-parse-csv', {
        method: 'POST', headers: { Authorization: 'Bearer ' + getToken() }, body: fd
    });
    const body = await resp.json();
    if (!body.success) throw new Error(body.message);
    aiData = body.data.match;
    showAiResults();
    renderSavedDplCard(body.data.saved);
}
```

Step 1 heading updated: `"Upload Brand Price List PDF"` → `"Upload Brand Price List PDF / CSV"`

---

## 10. Standalone CLI: `scripts/import-birlaopus-dpl-csv.js`

```
Usage:
  node scripts/import-birlaopus-dpl-csv.js <path-to-csv>
  node scripts/import-birlaopus-dpl-csv.js <path-to-csv> --save

Steps:
  1. Read CSV from CLI arg
  2. parseBirlaOpusCsv(buffer) → items
  3. Print summary:
     - Total line items
     - By category+segment breakdown (count + price range)
     - Sample: first 3 items (name / sku / dpl / sales price)
  4. Prompt: "Save to brand_dpl_lists? [y/N]: "
     (skipped + auto-confirmed if --save flag)
  5. If confirmed: connect DB pool (require config/database.js), brandDplService.save()
  6. Print saved row: { brand, parsed_count, effective_date, updated_at }

No Zoho API calls. DB-only. Effective date extracted from filename (same regex as endpoint).
```

---

## 11. Naming Examples

| Base Code | Product Name | Colour Name | Size | Item Name | Zoho SKU |
|---|---|---|---|---|---|
| PE White | One Pure Elegance | White | 1L | PE WHITE ONE PURE ELEGANCE WHITE BIRLA OPUS 1L | PEWHITE-1L |
| NS 2 | Calista Neo Star | Mid Tone | 0.9L | NS 2 CALISTA NEO STAR MID TONE BIRLA OPUS 0.9L | NS2-0.9L |
| TF 1 | Ananya Textura | Tintable White | 18L | TF 1 ANANYA TEXTURA TINTABLE WHITE BIRLA OPUS 18L | TF1-18L |
| EW 01 | Birla Opus Exterior | White | 20KG | EW 01 BIRLA OPUS EXTERIOR WHITE BIRLA OPUS 20KG | EW01-20KG |

---

## 12. Sales Price Formula

```
calculateSalesPrice(dpl) = Math.ceil(dpl * 1.298)
```

Same as existing `calculateSalesPrice` in `routes/item-master.js` and `Math.ceil(dpl * 1.18 * 1.10)` in `computeProposedFields` — they are mathematically identical. No change.

When applying CSV DPL to Zoho items:
- `zoho_cf_dpl` = DPL from CSV
- `zoho_purchase_rate` = DPL (same)
- `zoho_rate` = `calculateSalesPrice(DPL)`

---

## 13. What Is NOT Changed

- `parseBirlaOpus(text)` — PDF parse mode, untouched
- `parseBirlaOpusTabular(text)` — paste-text mode, untouched
- `matchWithZohoItems` fuzzy logic — untouched; new branch only fires when `_proposedZohoSku` present
- `computeProposedFields` existing logic — untouched below the new early-return
- `buildBirlaName` — untouched
- All existing endpoints in any route file — none removed
- Brand DPL paste panel in `admin-dpl.html` — stays intact

---

## 14. Success Criteria

- Upload `BirlaOpus_DPL_15May2026_SKU_Report.csv` → exactly ~990 line items parsed
- Each item: correct structured name, Zoho SKU (`PEWHITE-1L` format), rich description, DPL + sales price
- Exact SKU match finds existing Zoho items; unmatched items go to "Needs Review" bucket
- Flows into existing match/compare/push-to-Zoho workflow
- Saved to `brand_dpl_lists` with `effective_date = 2026-05-15`
- "Match Now" button on saved card works from the CSV-saved data
- No existing functionality broken
