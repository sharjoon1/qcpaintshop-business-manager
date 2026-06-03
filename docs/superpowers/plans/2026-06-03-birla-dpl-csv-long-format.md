# Birla Opus DPL — Long-format CSV support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the existing CSV upload (`/api/zoho/items/dpl-parse-csv`) accept the *long/tall* Birla Opus CSV (`Category,SubCategory,Product,ProductCode,BaseCode,BaseName,ProdBaseCode,Unit,Price_excl_GST`) in addition to the current *wide/sparse-matrix* CSV, by auto-detecting the format.

**Architecture:** Add a long-format parser `parseBirlaOpusCsvLong` and a header-sniffing dispatcher `parseBirlaOpusCsvAuto` to `services/price-list-parser.js`; both return the SAME row shape as the existing `parseBirlaOpusCsv` so all downstream code (save → match → catalog) is untouched. The endpoint swaps its single call from `parseBirlaOpusCsv` to `parseBirlaOpusCsvAuto`. The existing wide parser is unchanged.

**Tech Stack:** Node.js CommonJS, Jest. Reuses `splitCsvLine`, `BIRLA_OPUS_SIZE_SET`, `buildProperBirlaItemName/ZohoSku/Description` (all module-scoped in `price-list-parser.js`).

**Spec:** `docs/superpowers/specs/2026-06-03-birla-dpl-csv-long-format-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `services/price-list-parser.js` | add `normalizeBirlaUnit`, `parseBirlaOpusCsvLong`, `parseBirlaOpusCsvAuto`; export the two parsers | Modify |
| `tests/unit/dpl-csv-long.test.js` | unit tests for long parser + auto dispatch + wide regression | Create |
| `routes/zoho.js` | swap the `/dpl-parse-csv` call to the auto dispatcher | Modify |

**Reused unchanged:** `parseBirlaOpusCsv` (wide), `splitCsvLine`, `BIRLA_OPUS_SIZE_SET`, the `buildProperBirla*` helpers, the endpoint's `CSV_CAT_TO_CANON` canonicalization + `brandDplService.save` + audit + match.

---

## Task 1: Long parser + auto-dispatcher + tests

**Files:**
- Modify: `services/price-list-parser.js`
- Test: `tests/unit/dpl-csv-long.test.js` (new)

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/dpl-csv-long.test.js`:

```javascript
const {
    parseBirlaOpusCsvLong,
    parseBirlaOpusCsvAuto,
    parseBirlaOpusCsv,
} = require('../../services/price-list-parser');

const LONG = [
    'Category,SubCategory,Product,ProductCode,BaseCode,BaseName,ProdBaseCode,Unit,Price_excl_GST',
    'Interior,Luxury,One Pure Elegance,941001,9900,White,PE White,1L,520',
    'Interior,Luxury,One Pure Elegance,941001,9900,White,PE White,200 ML,110',
    'Interior,Luxury,One Pure Elegance,941001,9901,Pastel,PE 1,1L,514',
    'Interior,Luxury,One Pure Elegance,941001,9901,Pastel,PE 1,1L,514',
].join('\n');

// Wide format accepted by the existing parser (Category, Segment, Product Name,
// Product Code, Base Code (SKU), Base / Colour Name + size columns).
const WIDE = [
    'Category,Segment,Product Name,Product Code,Base Code (SKU),Base / Colour Name,1L,4L',
    'Interior,Luxury,One Pure Elegance,941001,PE White,9900 - White,520,2050',
].join('\n');

describe('parseBirlaOpusCsvLong', () => {
    const rows = parseBirlaOpusCsvLong(Buffer.from(LONG), '2026-06-03');

    test('emits one row per data line with mapped fields', () => {
        expect(rows.length).toBe(4);
        const r = rows[0];
        expect(r.productCode).toBe('941001');
        expect(r.baseCode).toBe('PE White');
        expect(r.colourCode).toBe('9900');
        expect(r.colourName).toBe('White');
        expect(r.productName).toBe('One Pure Elegance');
        expect(r.product).toBe('One Pure Elegance - White');
        expect(r.packSize).toBe('1L');
        expect(r.dpl).toBe(520);
        expect(r.brand).toBe('Birla Opus');
        expect(r.category).toBe('Interior');
        expect(r.segment).toBe('Luxury');
    });

    test('normalizes "200 ML" to canonical "200ML"', () => {
        const ml = rows.find(r => r.dpl === 110);
        expect(ml.packSize).toBe('200ML');
    });

    test('keeps duplicate (product,base,size) rows (dedup handled downstream)', () => {
        expect(rows.filter(r => r.baseCode === 'PE 1').length).toBe(2);
    });

    test('builds proposed name/sku/description', () => {
        const r = rows[0];
        expect(typeof r._proposedName).toBe('string');
        expect(r._proposedZohoSku.length).toBeGreaterThan(0);
        expect(typeof r._proposedDescription).toBe('string');
    });

    test('returns [] when a required header is missing', () => {
        const bad = 'Category,SubCategory,Product,ProductCode\nInterior,Luxury,X,1\n';
        expect(parseBirlaOpusCsvLong(Buffer.from(bad), '2026-06-03')).toEqual([]);
    });
});

describe('parseBirlaOpusCsvAuto', () => {
    test('routes a long-format header to the long parser', () => {
        const rows = parseBirlaOpusCsvAuto(Buffer.from(LONG), '2026-06-03');
        expect(rows.length).toBe(4);
        expect(rows[0].baseCode).toBe('PE White');
    });

    test('routes a wide-format header to the wide parser', () => {
        const rows = parseBirlaOpusCsvAuto(Buffer.from(WIDE), '2026-06-03');
        expect(rows.length).toBe(2); // 1L + 4L cells
        expect(rows[0].baseCode).toBe('PE White');
    });

    test('empty buffer returns []', () => {
        expect(parseBirlaOpusCsvAuto(Buffer.from(''), '2026-06-03')).toEqual([]);
    });
});
```

- [ ] **Step 2: Run, verify FAIL**

Run: `npx jest tests/unit/dpl-csv-long.test.js`
Expected: FAIL — `parseBirlaOpusCsvLong` / `parseBirlaOpusCsvAuto` are not exported (TypeError: not a function).

- [ ] **Step 3: Add the three functions after `splitCsvLine`**

In `services/price-list-parser.js`, immediately AFTER the `splitCsvLine` function's closing `}` (the function that ends at the line `return cols; }`, around line 1463) and BEFORE the `// ============ MATCH WITH ZOHO ITEMS ============` comment, insert:

```javascript
// Normalize a long-CSV Unit ("200 ML", "1L", "1KG") to a canonical Birla size
// column name. Tries trimmed, no-space, and no-space-uppercase; falls back to
// the trimmed value verbatim (never drops the row on an unrecognized unit).
function normalizeBirlaUnit(u) {
    const t = String(u == null ? '' : u).trim();
    for (const cand of [t, t.replace(/\s+/g, ''), t.replace(/\s+/g, '').toUpperCase()]) {
        if (BIRLA_OPUS_SIZE_SET.has(cand)) return cand;
    }
    return t;
}

// Parse the LONG / tall Birla Opus CSV (one row per product+base+size):
//   Category,SubCategory,Product,ProductCode,BaseCode,BaseName,ProdBaseCode,Unit,Price_excl_GST
// Emits the SAME row shape as parseBirlaOpusCsv so downstream save/match/catalog
// is identical. ProdBaseCode ("PE White") is the catalog's SKU-stem source.
function parseBirlaOpusCsvLong(csvBuffer, effectiveDate) {
    if (!Buffer.isBuffer(csvBuffer) || csvBuffer.length === 0) return [];

    let text = csvBuffer.toString('utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

    const lines = text.split(/\r?\n/);
    if (lines.length < 2) return [];

    const headerCols = splitCsvLine(lines[0]).map(h => h.trim());
    const colIndex = {};
    headerCols.forEach((h, i) => { colIndex[h] = i; });

    const required = ['Category', 'SubCategory', 'Product', 'ProductCode', 'ProdBaseCode', 'Unit', 'Price_excl_GST'];
    for (const r of required) { if (colIndex[r] == null) return []; }

    const results = [];
    for (let li = 1; li < lines.length; li++) {
        const line = lines[li];
        if (!line.trim()) continue;
        const cols = splitCsvLine(line);

        const category    = (cols[colIndex['Category']]       || '').trim();
        const segment     = (cols[colIndex['SubCategory']]    || '').trim();
        const productName = (cols[colIndex['Product']]        || '').trim();
        const productCode = (cols[colIndex['ProductCode']]    || '').trim();
        const baseCode    = (cols[colIndex['ProdBaseCode']]   || '').trim();
        const colourCode  = colIndex['BaseCode'] != null ? (cols[colIndex['BaseCode']] || '').trim() : '';
        const colourName  = colIndex['BaseName'] != null ? (cols[colIndex['BaseName']] || '').trim() : '';
        const unitRaw     = (cols[colIndex['Unit']]           || '').trim();
        const priceRaw    = (cols[colIndex['Price_excl_GST']] || '').trim().replace(/,/g, '');

        if (!productName || !baseCode) continue;
        if (!/^\d+(\.\d+)?$/.test(priceRaw)) continue;
        const dpl = parseFloat(priceRaw);
        if (!isFinite(dpl) || dpl <= 0) continue;

        const packSize = normalizeBirlaUnit(unitRaw);

        results.push({
            product:              colourName ? `${productName} - ${colourName}` : productName,
            packSize,
            dpl,
            brand:                'Birla Opus',
            category,
            segment,
            baseCode,
            productCode,
            colourCode,
            colourName,
            productName,
            _proposedName:        buildProperBirlaItemName({ baseCode, productName, colourName, size: packSize }),
            _proposedZohoSku:     buildProperBirlaZohoSku({ baseCode, size: packSize }),
            _proposedDescription: buildProperBirlaDescription(
                { productName, colourCode, colourName, size: packSize, productCode, category, segment, dpl },
                effectiveDate
            ),
        });
    }

    return results;
}

// Sniff the header and dispatch to the long or wide Birla Opus CSV parser.
function parseBirlaOpusCsvAuto(csvBuffer, effectiveDate) {
    if (!Buffer.isBuffer(csvBuffer) || csvBuffer.length === 0) return [];
    let text = csvBuffer.toString('utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const headers = new Set(splitCsvLine(firstLine).map(h => h.trim()));
    if (headers.has('Unit') && headers.has('Price_excl_GST')) {
        return parseBirlaOpusCsvLong(csvBuffer, effectiveDate);
    }
    return parseBirlaOpusCsv(csvBuffer, effectiveDate);
}
```

- [ ] **Step 4: Export the two parsers**

In `services/price-list-parser.js` `module.exports`, find:
```javascript
    // CSV parser
    parseBirlaOpusCsv,
};
```
Replace with:
```javascript
    // CSV parser
    parseBirlaOpusCsv,
    parseBirlaOpusCsvLong,
    parseBirlaOpusCsvAuto,
};
```

- [ ] **Step 5: Run, verify PASS**

Run: `npx jest tests/unit/dpl-csv-long.test.js`
Expected: PASS (all tests in both describes).

- [ ] **Step 6: Verify module load + no regression in related suites**

Run:
```bash
node -e "require('./services/price-list-parser.js'); console.log('parser OK')"
npx jest tests/unit/dpl-csv-long.test.js tests/unit/dpl-catalog.test.js
```
Expected: `parser OK` and all pass.

- [ ] **Step 7: Commit**

```bash
git add services/price-list-parser.js tests/unit/dpl-csv-long.test.js
git commit -m "feat(dpl-csv): long-format Birla Opus CSV parser + auto-detect dispatcher"
```

---

## Task 2: Wire the endpoint to the auto-dispatcher

**Files:**
- Modify: `routes/zoho.js` (the `/items/dpl-parse-csv` handler, ~line 5972)

- [ ] **Step 1: Swap the parser call**

In `routes/zoho.js`, find (inside `router.post('/items/dpl-parse-csv', ...)`):
```javascript
        const csvString = req.file.buffer.toString('utf8');
        const parsedRows = priceListParser.parseBirlaOpusCsv(req.file.buffer, effectiveDate);
```
Replace with:
```javascript
        const csvString = req.file.buffer.toString('utf8');
        const parsedRows = priceListParser.parseBirlaOpusCsvAuto(req.file.buffer, effectiveDate);
```
(Leave everything else — the `parsedRows.length === 0` 400 guard, `CSV_CAT_TO_CANON` mapping, `brandDplService.save`, audit, match — unchanged.)

- [ ] **Step 2: Verify module load**

Run:
```bash
node --check routes/zoho.js && node -e "require('./routes/zoho.js'); console.log('zoho OK')"
```
Expected: `zoho OK`.

- [ ] **Step 3: Real-data verification against the user's ORIGINAL long CSV**

The user's original long file is at
`C:/Users/Hiii/.claude/uploads/56d862a3-36f9-44d3-ba80-5906fc80d6bf/f9301148-birla_opus_skus.csv`.
Run:
```bash
node -e "const fs=require('fs');const p=require('./services/price-list-parser');const rows=p.parseBirlaOpusCsvAuto(fs.readFileSync('C:/Users/Hiii/.claude/uploads/56d862a3-36f9-44d3-ba80-5906fc80d6bf/f9301148-birla_opus_skus.csv'),'2026-06-03');console.log('parsed rows:',rows.length);console.log('sample:',JSON.stringify(rows[0]));"
```
Expected: `parsed rows: 1340` (or close; the 2 benign duplicates remain as 1342 here — long parser does NOT dedup, so expect **1342**), and the sample shows `baseCode:"PE White"`, `productCode:"941001"`, `packSize:"1L"`, `dpl:520`. Confirm it is non-zero and well-formed.

- [ ] **Step 4: Commit**

```bash
git add routes/zoho.js
git commit -m "feat(dpl-csv): accept long-format CSV uploads via auto-detect"
```

---

## Self-Review notes (spec coverage)

- **`parseBirlaOpusCsvLong` with full field mapping + same shape:** Task 1 Step 3. ✓
- **Unit normalization "200 ML"→"200ML", verbatim fallback:** Task 1 Step 3 (`normalizeBirlaUnit`) + test. ✓
- **`parseBirlaOpusCsvAuto` header sniff (Unit+Price_excl_GST→long, else wide):** Task 1 Step 3 + tests both directions. ✓
- **Duplicates kept (downstream dedup):** Task 1 test asserts 2 `PE 1` rows. ✓
- **Endpoint swap, everything else unchanged:** Task 2 Step 1. ✓
- **Wide parser untouched / regression:** Task 1 WIDE test routes through unchanged `parseBirlaOpusCsv`; Step 6 runs related suites. ✓
- **Real-data sanity (user's file now parses):** Task 2 Step 3. ✓

## Out of scope

The tab-paste parser, the wide CSV parser internals, the catalog, the UI, and brands other than Birla Opus.
