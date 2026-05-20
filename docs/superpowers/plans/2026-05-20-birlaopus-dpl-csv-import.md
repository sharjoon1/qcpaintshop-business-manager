# Birla Opus DPL CSV Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parse the Birla Opus SKU Report CSV (sparse matrix, ~990 line items) into structured DPL items with pre-computed names/SKUs/descriptions, match against Zoho items by exact SKU, save to `brand_dpl_lists`, and expose via a CSV upload tab on `admin-dpl.html`.

**Architecture:** A new `parseBirlaOpusCsv` function iterates the sparse matrix and pre-computes all proposed fields using three new builder helpers. These pre-computed fields are carried through the existing `matchWithZohoItems` (via a new exact-SKU branch) and `computeProposedFields` (via a new early-return branch) unchanged. The endpoint in `routes/zoho.js` saves to `brand_dpl_lists` and calls the existing `runBrandDplMatch` helper (with a one-line fix to preserve `_proposed*` fields). The UI adds a tab toggle in Step 1 of `admin-dpl.html`.

**Tech Stack:** Node.js, Express, Multer (memory storage), Jest, vanilla JS / Tailwind CSS. No new npm packages.

---

## File Map

| File | Change |
|---|---|
| `services/price-list-parser.js` | Add `parseBirlaOpusCsv`, `buildProperBirlaItemName`, `buildProperBirlaZohoSku`, `buildProperBirlaDescription`; patch `computeProposedFields` (early return) and `matchWithZohoItems` (exact-SKU branch + `zohoByExactSku` map); patch `runBrandDplMatch` preserve `_proposed*`; extend `module.exports` |
| `config/uploads.js` | Add `uploadPriceCsv` multer config (memory, 5 MB, CSV-only); add to exports |
| `routes/zoho.js` | Add `CSV_CAT_TO_CANON` constant; patch `runBrandDplMatch` to preserve `_proposed*` fields; add `POST /items/dpl-parse-csv` route |
| `public/admin-dpl.html` | Add tab bar (PDF / CSV) above drop-zone in Step 1; add CSV upload area with date field + button; add `parseCsv()` JS function |
| `scripts/import-birlaopus-dpl-csv.js` | New standalone CLI: parse → preview → optional DB save |
| `tests/unit/dpl-csv-parser.test.js` | New test file for all parser + builder helpers |
| `tests/unit/dpl-csv-match.test.js` | New test file for exact-SKU branch + computeProposedFields pass-through |

---

## Task 1: Builder helpers (`buildProperBirlaItemName`, `buildProperBirlaZohoSku`, `buildProperBirlaDescription`)

**Files:**
- Modify: `services/price-list-parser.js` (add 3 functions + extend module.exports)
- Create: `tests/unit/dpl-csv-parser.test.js`

- [ ] **Step 1: Create the test file with failing tests for the three helpers**

Create `tests/unit/dpl-csv-parser.test.js`:

```js
const {
    buildProperBirlaItemName,
    buildProperBirlaZohoSku,
    buildProperBirlaDescription,
} = require('../../services/price-list-parser');

describe('buildProperBirlaItemName', () => {
    test('basic emulsion: BASE + PRODUCT + COLOUR + BIRLA OPUS + SIZE', () => {
        const row = { baseCode: 'PE White', productName: 'One Pure Elegance', colourName: 'White', size: '1L' };
        expect(buildProperBirlaItemName(row)).toBe('PE WHITE ONE PURE ELEGANCE WHITE BIRLA OPUS 1L');
    });

    test('numbered base code', () => {
        const row = { baseCode: 'NS 2', productName: 'Calista Neo Star', colourName: 'Mid Tone', size: '0.9L' };
        expect(buildProperBirlaItemName(row)).toBe('NS 2 CALISTA NEO STAR MID TONE BIRLA OPUS 0.9L');
    });

    test('KG size', () => {
        const row = { baseCode: 'EW 01', productName: 'Birla Opus Exterior', colourName: 'White', size: '20KG' };
        expect(buildProperBirlaItemName(row)).toBe('EW 01 BIRLA OPUS EXTERIOR WHITE BIRLA OPUS 20KG');
    });

    test('ML size', () => {
        const row = { baseCode: 'PE 1', productName: 'One Pure Elegance', colourName: 'Pastel', size: '200ML' };
        expect(buildProperBirlaItemName(row)).toBe('PE 1 ONE PURE ELEGANCE PASTEL BIRLA OPUS 200ML');
    });

    test('Per Unit size passes through unchanged', () => {
        const row = { baseCode: 'RR 01', productName: 'Paint Roller', colourName: '', size: 'Per Unit' };
        expect(buildProperBirlaItemName(row)).toBe('RR 01 PAINT ROLLER  BIRLA OPUS Per Unit');
    });
});

describe('buildProperBirlaZohoSku', () => {
    test('strips spaces from base code', () => {
        expect(buildProperBirlaZohoSku({ baseCode: 'PE White', size: '1L' })).toBe('PEWHITE-1L');
    });

    test('numbered code', () => {
        expect(buildProperBirlaZohoSku({ baseCode: 'NS 2', size: '0.9L' })).toBe('NS2-0.9L');
    });

    test('KG size', () => {
        expect(buildProperBirlaZohoSku({ baseCode: 'TF 1', size: '18L' })).toBe('TF1-18L');
    });

    test('Per Unit', () => {
        expect(buildProperBirlaZohoSku({ baseCode: 'RR 01', size: 'Per Unit' })).toBe('RR01-Per Unit');
    });

    test('multi-space base code', () => {
        expect(buildProperBirlaZohoSku({ baseCode: 'PE  1', size: '4L' })).toBe('PE1-4L');
    });
});

describe('buildProperBirlaDescription', () => {
    test('formats all fields correctly', () => {
        const row = {
            productName: 'One Pure Elegance',
            colourCode: '9900',
            colourName: 'White',
            size: '1L',
            productCode: '941001',
            category: 'Interior',
            segment: 'Luxury',
            dpl: 520,
        };
        expect(buildProperBirlaDescription(row, '2026-05-15')).toBe(
            'Birla Opus One Pure Elegance | 9900 - White | Pack: 1L | Code: 941001 | Interior - Luxury | DPL: ₹520 | Effective: 15 May 2026'
        );
    });

    test('handles decimal DPL', () => {
        const row = { productName: 'Test', colourCode: '9900', colourName: 'White', size: '4L', productCode: '001', category: 'Enamel', segment: 'Premium', dpl: 1234.5 };
        const result = buildProperBirlaDescription(row, '2026-05-15');
        expect(result).toContain('DPL: ₹1234.5');
    });
});
```

- [ ] **Step 2: Run to confirm all tests fail (functions not found)**

```
npx jest tests/unit/dpl-csv-parser.test.js --no-coverage
```

Expected: FAIL — `buildProperBirlaItemName is not a function` (or similar)

- [ ] **Step 3: Add the three helpers to `services/price-list-parser.js`**

Find the line `// ============ MATCH WITH ZOHO ITEMS ============` (line ~1316) and insert the three functions immediately before it:

```js
// ============ CSV BUILDER HELPERS ============

// Builds the canonical item name from structured CSV fields.
// Format: BASE_CODE_UPPER PRODUCT_UPPER COLOUR_UPPER BIRLA OPUS SIZE
function buildProperBirlaItemName({ baseCode, productName, colourName, size }) {
    const base    = String(baseCode    || '').toUpperCase();
    const product = String(productName || '').toUpperCase();
    const colour  = String(colourName  || '').toUpperCase();
    return `${base} ${product} ${colour} BIRLA OPUS ${size}`.replace(/\s{2,}/g, ' ').trim();
}

// Builds the Zoho SKU: spaces stripped from base code, uppercased, hyphen, size.
function buildProperBirlaZohoSku({ baseCode, size }) {
    const skuClean = String(baseCode || '').replace(/\s+/g, '').toUpperCase();
    return `${skuClean}-${size}`;
}

// Builds a rich searchable description. effectiveDate must be 'YYYY-MM-DD'.
function buildProperBirlaDescription({ productName, colourCode, colourName, size, productCode, category, segment, dpl }, effectiveDate) {
    const effDate = effectiveDate
        ? (() => {
              const [y, m, d] = effectiveDate.split('-');
              const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
              return `${parseInt(d, 10)} ${months[parseInt(m, 10) - 1]} ${y}`;
          })()
        : '';
    return `Birla Opus ${productName} | ${colourCode} - ${colourName} | Pack: ${size} | Code: ${productCode} | ${category} - ${segment} | DPL: ₹${dpl} | Effective: ${effDate}`;
}
```

- [ ] **Step 4: Export the three helpers in `module.exports` at the bottom of the file**

Find the `module.exports = {` block (line ~1799). Add these three exports inside it:

```js
    // CSV builder helpers (structured fields → name / SKU / description)
    buildProperBirlaItemName,
    buildProperBirlaZohoSku,
    buildProperBirlaDescription,
```

- [ ] **Step 5: Run tests — confirm all 10 pass**

```
npx jest tests/unit/dpl-csv-parser.test.js --no-coverage
```

Expected: PASS (10 tests)

- [ ] **Step 6: Commit**

```
git add services/price-list-parser.js tests/unit/dpl-csv-parser.test.js
git commit -m "feat(dpl-csv): add buildProperBirlaItemName/ZohoSku/Description helpers"
```

---

## Task 2: `parseBirlaOpusCsv` parser

**Files:**
- Modify: `services/price-list-parser.js`
- Modify: `tests/unit/dpl-csv-parser.test.js`

- [ ] **Step 1: Add failing tests for `parseBirlaOpusCsv`**

Append to `tests/unit/dpl-csv-parser.test.js`:

```js
const { parseBirlaOpusCsv } = require('../../services/price-list-parser');

// Minimal 2-row CSV: header + one SKU row with 2 non-empty sizes
const MINIMAL_CSV = [
    'Category,Segment,Product Name,Product Code,Base Code (SKU),Base / Colour Name,200ML,1L,4L,18L',
    'Interior,Luxury,One Pure Elegance,941001,PE White,9900 - White,,520,,',
].join('\n');

const MINIMAL_CSV_WITH_BOM = '﻿' + MINIMAL_CSV;

describe('parseBirlaOpusCsv — exports', () => {
    test('is exported as a function', () => {
        expect(typeof parseBirlaOpusCsv).toBe('function');
    });
});

describe('parseBirlaOpusCsv — happy path', () => {
    test('parses a single non-empty cell from minimal CSV string', () => {
        const buf = Buffer.from(MINIMAL_CSV);
        const out = parseBirlaOpusCsv(buf);
        expect(out).toHaveLength(1);
        const item = out[0];
        expect(item.dpl).toBe(520);
        expect(item.packSize).toBe('1L');
        expect(item.baseCode).toBe('PE White');
        expect(item.colourCode).toBe('9900');
        expect(item.colourName).toBe('White');
        expect(item.productName).toBe('One Pure Elegance');
        expect(item.productCode).toBe('941001');
        expect(item.category).toBe('Interior');
        expect(item.segment).toBe('Luxury');
        expect(item.brand).toBe('Birla Opus');
        expect(item.product).toBe('One Pure Elegance - White');
    });

    test('strips UTF-8 BOM', () => {
        const buf = Buffer.from(MINIMAL_CSV_WITH_BOM, 'utf8');
        const out = parseBirlaOpusCsv(buf);
        expect(out).toHaveLength(1);
        expect(out[0].dpl).toBe(520);
    });

    test('pre-computes _proposedName, _proposedZohoSku, _proposedDescription', () => {
        const buf = Buffer.from(MINIMAL_CSV);
        const item = parseBirlaOpusCsv(buf)[0];
        expect(item._proposedName).toBe('PE WHITE ONE PURE ELEGANCE WHITE BIRLA OPUS 1L');
        expect(item._proposedZohoSku).toBe('PEWHITE-1L');
        expect(item._proposedDescription).toContain('Birla Opus One Pure Elegance');
        expect(item._proposedDescription).toContain('DPL: ₹520');
    });

    test('skips empty price cells', () => {
        const csv = [
            'Category,Segment,Product Name,Product Code,Base Code (SKU),Base / Colour Name,200ML,1L,4L',
            'Interior,Luxury,One Pure Elegance,941001,PE White,9900 - White,,,',
        ].join('\n');
        const out = parseBirlaOpusCsv(Buffer.from(csv));
        expect(out).toHaveLength(0);
    });

    test('skips non-numeric price cells', () => {
        const csv = [
            'Category,Segment,Product Name,Product Code,Base Code (SKU),Base / Colour Name,1L',
            'Interior,Luxury,One Pure Elegance,941001,PE White,9900 - White,N/A',
        ].join('\n');
        const out = parseBirlaOpusCsv(Buffer.from(csv));
        expect(out).toHaveLength(0);
    });

    test('skips zero and negative price cells', () => {
        const csv = [
            'Category,Segment,Product Name,Product Code,Base Code (SKU),Base / Colour Name,1L,4L',
            'Interior,Luxury,Test,000001,T 1,9900 - White,0,-10',
        ].join('\n');
        const out = parseBirlaOpusCsv(Buffer.from(csv));
        expect(out).toHaveLength(0);
    });

    test('handles comma-formatted prices (1,930 → 1930)', () => {
        const csv = [
            'Category,Segment,Product Name,Product Code,Base Code (SKU),Base / Colour Name,4L',
            'Interior,Luxury,One Pure Elegance,941001,PE White,9900 - White,"1,930"',
        ].join('\n');
        const out = parseBirlaOpusCsv(Buffer.from(csv));
        expect(out).toHaveLength(1);
        expect(out[0].dpl).toBe(1930);
    });

    test('parses multiple sizes from one SKU row', () => {
        const csv = [
            'Category,Segment,Product Name,Product Code,Base Code (SKU),Base / Colour Name,200ML,1L,4L',
            'Interior,Luxury,One Pure Elegance,941001,PE White,9900 - White,107,520,2050',
        ].join('\n');
        const out = parseBirlaOpusCsv(Buffer.from(csv));
        expect(out).toHaveLength(3);
        expect(out.map(i => i.packSize).sort()).toEqual(['1L', '200ML', '4L'].sort());
        expect(out.find(i => i.packSize === '1L').dpl).toBe(520);
        expect(out.find(i => i.packSize === '200ML').dpl).toBe(107);
    });

    test('splits colour code and name from "Base / Colour Name"', () => {
        const csv = [
            'Category,Segment,Product Name,Product Code,Base Code (SKU),Base / Colour Name,0.9L',
            'Interior,Luxury,Calista Neo Star,942002,NS 2,9902 - Mid Tone,506',
        ].join('\n');
        const item = parseBirlaOpusCsv(Buffer.from(csv))[0];
        expect(item.colourCode).toBe('9902');
        expect(item.colourName).toBe('Mid Tone');
        expect(item.product).toBe('Calista Neo Star - Mid Tone');
    });

    test('handles missing colour separator (no " - ")', () => {
        const csv = [
            'Category,Segment,Product Name,Product Code,Base Code (SKU),Base / Colour Name,1L',
            'Interior,Luxury,Test,001,T 1,NoCodeHere,500',
        ].join('\n');
        const item = parseBirlaOpusCsv(Buffer.from(csv))[0];
        expect(item.colourCode).toBe('');
        expect(item.colourName).toBe('NoCodeHere');
    });

    test('returns empty array for empty buffer', () => {
        expect(parseBirlaOpusCsv(Buffer.from(''))).toEqual([]);
    });

    test('returns empty array for header-only CSV', () => {
        const csv = 'Category,Segment,Product Name,Product Code,Base Code (SKU),Base / Colour Name,1L';
        expect(parseBirlaOpusCsv(Buffer.from(csv))).toEqual([]);
    });
});
```

- [ ] **Step 2: Run to confirm all new tests fail**

```
npx jest tests/unit/dpl-csv-parser.test.js --no-coverage
```

Expected: the 3 builder tests pass (from Task 1), all `parseBirlaOpusCsv` tests FAIL.

- [ ] **Step 3: Implement `parseBirlaOpusCsv` in `services/price-list-parser.js`**

Insert immediately after the three builder helper functions (before the `// ============ MATCH WITH ZOHO ITEMS ============` comment):

```js
// Known size column headers. Order matches spec; used to identify which columns
// hold prices in the sparse-matrix CSV.
const BIRLA_OPUS_SIZE_COLUMNS = [
    '50ML','100ML','200ML','400ML','500ML',
    '0.2L','0.5L','0.9L','1L','2.5L','3.6L','4L','5L','6L','7.5L','9L',
    '10L','12.5L','18L','20L','25L','30L','37.5L',
    '0.5KG','1KG','2KG','3KG','5KG','10KG','12KG','15KG','20KG','25KG','30KG',
    'Per Unit','Per Tube','Per Sheet',
];
const BIRLA_OPUS_SIZE_SET = new Set(BIRLA_OPUS_SIZE_COLUMNS);

/**
 * Parse a Birla Opus SKU Report CSV (sparse matrix) into a flat array of
 * DPL line items. Accepts a Buffer (UTF-8, with or without BOM).
 *
 * Each item has all structured fields plus pre-computed _proposedName,
 * _proposedZohoSku, _proposedDescription for use by matchWithZohoItems.
 *
 * @param {Buffer} csvBuffer
 * @param {string} [effectiveDate]  ISO date string (YYYY-MM-DD). If omitted,
 *                                  descriptions will show an empty Effective line.
 * @returns {Array<object>}
 */
function parseBirlaOpusCsv(csvBuffer, effectiveDate) {
    if (!Buffer.isBuffer(csvBuffer) || csvBuffer.length === 0) return [];

    // Strip UTF-8 BOM if present
    let text = csvBuffer.toString('utf8');
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

    const lines = text.split(/\r?\n/);
    if (lines.length < 2) return [];

    // Parse header row — build column-name → index map.
    // Handle quoted fields by using a simple CSV split.
    const headerCols = splitCsvLine(lines[0]);
    const colIndex = {};
    headerCols.forEach((h, i) => { colIndex[h.trim()] = i; });

    // Identify size columns by matching header names against the known set.
    const sizeColEntries = []; // [ { name, idx } ]
    headerCols.forEach((h, i) => {
        const name = h.trim();
        if (BIRLA_OPUS_SIZE_SET.has(name)) sizeColEntries.push({ name, idx: i });
    });

    const required = ['Category', 'Segment', 'Product Name', 'Product Code', 'Base Code (SKU)', 'Base / Colour Name'];
    for (const r of required) {
        if (colIndex[r] == null) return []; // malformed header
    }

    const results = [];

    for (let li = 1; li < lines.length; li++) {
        const line = lines[li];
        if (!line.trim()) continue;
        const cols = splitCsvLine(line);

        const category    = (cols[colIndex['Category']]          || '').trim();
        const segment     = (cols[colIndex['Segment']]           || '').trim();
        const productName = (cols[colIndex['Product Name']]      || '').trim();
        const productCode = (cols[colIndex['Product Code']]      || '').trim();
        const baseCode    = (cols[colIndex['Base Code (SKU)']]   || '').trim();
        const colourRaw   = (cols[colIndex['Base / Colour Name']]|| '').trim();

        if (!productName || !baseCode) continue;

        // Split "9900 - White" → colourCode="9900", colourName="White"
        let colourCode = '';
        let colourName = colourRaw;
        const sepIdx = colourRaw.indexOf(' - ');
        if (sepIdx > -1) {
            colourCode = colourRaw.slice(0, sepIdx).trim();
            colourName = colourRaw.slice(sepIdx + 3).trim();
        }

        for (const { name: size, idx } of sizeColEntries) {
            const raw = (cols[idx] || '').trim().replace(/^"|"$/g, ''); // strip CSV quotes
            if (!raw) continue;

            // Strip commas from numbers like "1,930"
            const cleaned = raw.replace(/,/g, '');
            if (!/^\d+(\.\d+)?$/.test(cleaned)) continue;
            const dpl = parseFloat(cleaned);
            if (!isFinite(dpl) || dpl <= 0) continue;

            const packSize = normalizePackSize(size);

            results.push({
                product: colourName ? `${productName} - ${colourName}` : productName,
                packSize,
                dpl,
                brand: 'Birla Opus',
                category,
                segment,
                baseCode,
                productCode,
                colourCode,
                colourName,
                productName,
                _proposedName:        buildProperBirlaItemName({ baseCode, productName, colourName, size: packSize }),
                _proposedZohoSku:     buildProperBirlaZohoSku({ baseCode, size: packSize }),
                _proposedDescription: buildProperBirlaDescription({ productName, colourCode, colourName, size: packSize, productCode, category, segment, dpl }, effectiveDate || null),
            });
        }
    }

    return results;
}

// Split a single CSV line, handling double-quoted fields that may contain commas.
function splitCsvLine(line) {
    const cols = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            // doubled quote inside quoted field = escaped quote
            if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
            else { inQuotes = !inQuotes; }
        } else if (ch === ',' && !inQuotes) {
            cols.push(cur);
            cur = '';
        } else {
            cur += ch;
        }
    }
    cols.push(cur);
    return cols;
}
```

- [ ] **Step 4: Export `parseBirlaOpusCsv` in `module.exports`**

In the `module.exports = {` block at the bottom of `services/price-list-parser.js`, add:

```js
    parseBirlaOpusCsv,
```

alongside the other CSV exports.

- [ ] **Step 5: Run all tests — confirm all pass**

```
npx jest tests/unit/dpl-csv-parser.test.js --no-coverage
```

Expected: all tests PASS (3 builder + 13 parser = 16 total)

- [ ] **Step 6: Run the full test suite to confirm no regressions**

```
npx jest --no-coverage
```

Expected: all previously-passing tests still pass

- [ ] **Step 7: Commit**

```
git add services/price-list-parser.js tests/unit/dpl-csv-parser.test.js
git commit -m "feat(dpl-csv): parseBirlaOpusCsv — sparse-matrix CSV parser with pre-computed proposed fields"
```

---

## Task 3: `computeProposedFields` pass-through + `matchWithZohoItems` exact-SKU branch + `runBrandDplMatch` `_proposed*` preservation

**Files:**
- Modify: `services/price-list-parser.js` (two patches)
- Modify: `routes/zoho.js` (one patch)
- Create: `tests/unit/dpl-csv-match.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/dpl-csv-match.test.js`:

```js
const { computeProposedFields, matchWithZohoItems } = require('../../services/price-list-parser');

describe('computeProposedFields — CSV pre-set pass-through', () => {
    const base = { proposed_rate: null, current_sku: 'OLDSKU', current_description: '' };

    test('returns pre-set _proposedName when present', () => {
        const pdfItem = {
            dpl: 520,
            _proposedName: 'PE WHITE ONE PURE ELEGANCE WHITE BIRLA OPUS 1L',
            _proposedZohoSku: 'PEWHITE-1L',
            _proposedDescription: 'Birla Opus One Pure Elegance | ...',
        };
        const zohoItem = { sku: 'OLDSKU', description: '', category: '', rate: 0 };
        const result = computeProposedFields(pdfItem, zohoItem, 'birlaopus');
        expect(result.proposed_name).toBe('PE WHITE ONE PURE ELEGANCE WHITE BIRLA OPUS 1L');
        expect(result.proposed_sku).toBe('PEWHITE-1L');
        expect(result.proposed_description).toBe('Birla Opus One Pure Elegance | ...');
    });

    test('still computes proposed_rate from dpl when _proposedName is set', () => {
        const pdfItem = {
            dpl: 520,
            _proposedName: 'PE WHITE ONE PURE ELEGANCE WHITE BIRLA OPUS 1L',
            _proposedZohoSku: 'PEWHITE-1L',
            _proposedDescription: 'desc',
        };
        const zohoItem = { sku: '', description: '', category: '', rate: 0 };
        const result = computeProposedFields(pdfItem, zohoItem, 'birlaopus');
        expect(result.proposed_rate).toBe(Math.ceil(520 * 1.298)); // 675
    });

    test('falls through to existing logic when _proposedName is absent', () => {
        const pdfItem = { dpl: 0, product: 'Test' };
        const zohoItem = { sku: '', description: '', category: '', rate: 0 };
        const result = computeProposedFields(pdfItem, zohoItem, 'birlaopus');
        expect(result.proposed_name).toBeUndefined();
    });
});

describe('matchWithZohoItems — exact SKU branch', () => {
    const makeCsvItem = (sku, dpl = 520) => ({
        product: 'One Pure Elegance - White',
        packSize: '1L',
        dpl,
        brand: 'Birla Opus',
        category: 'Interior',
        baseCode: 'PE White',
        _proposedZohoSku: sku,
        _proposedName: `PE WHITE ONE PURE ELEGANCE WHITE BIRLA OPUS 1L`,
        _proposedDescription: 'desc',
    });

    const makeZohoItem = (sku, name) => ({
        zoho_item_id: 'ZI001',
        name,
        sku,
        zoho_sku: sku,
        rate: 675,
        brand: 'Birla Opus',
        zoho_brand: 'Birla Opus',
        category: 'INTERIOR EMULSION',
        description: '',
    });

    test('exact SKU match places item in matched array', () => {
        const parsed = [makeCsvItem('PEWHITE-1L')];
        const zoho = [makeZohoItem('PEWHITE-1L', 'PE WHITE ONE PURE ELEGANCE WHITE BIRLA OPUS 1L')];
        const result = matchWithZohoItems(parsed, zoho);
        expect(result.matched).toHaveLength(1);
        expect(result.unmatched).toHaveLength(0);
        expect(result.matched[0].zoho_item_id).toBe('ZI001');
    });

    test('unmatched when exact SKU not found in Zoho', () => {
        const parsed = [makeCsvItem('NOTEXIST-1L')];
        const zoho = [makeZohoItem('PEWHITE-1L', 'PE WHITE ONE PURE ELEGANCE WHITE BIRLA OPUS 1L')];
        const result = matchWithZohoItems(parsed, zoho);
        expect(result.unmatched).toHaveLength(1);
    });

    test('non-CSV items (no _proposedZohoSku) go through fuzzy matching unchanged', () => {
        const pdfItem = {
            product: 'One Pure Elegance - White',
            packSize: '1L',
            dpl: 520,
            brand: 'Birla Opus',
            category: 'INTERIOR EMULSION',
        };
        const zoho = [makeZohoItem('PEWHITE-1L', 'PE WHITE ONE PURE ELEGANCE WHITE BIRLA OPUS 1L')];
        // Fuzzy may or may not match; the point is no error is thrown
        expect(() => matchWithZohoItems([pdfItem], zoho)).not.toThrow();
    });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```
npx jest tests/unit/dpl-csv-match.test.js --no-coverage
```

Expected: FAIL — pass-through branch and exact-SKU branch not yet added.

- [ ] **Step 3: Patch `computeProposedFields` in `services/price-list-parser.js`**

Find `function computeProposedFields(pdfItem, zohoItem, brandKey) {` (line ~1005). The function currently starts with:

```js
    const dpl = parseFloat(pdfItem.dpl || 0);
    const proposedRate = dpl > 0 ? Math.ceil(dpl * 1.18 * 1.10) : null;

    const currentSku  = String(zohoItem.sku  || '').trim();
    const currentDesc = String(zohoItem.description || '').trim();
    const currentCat  = String(zohoItem.category || '').toUpperCase().trim();

    const base = { proposed_rate: proposedRate, current_sku: currentSku, current_description: currentDesc };

    if (brandKey !== 'birlaopus') return base;
```

Add a new early-return block right **after** the `const base = { ... }` line and **before** the `if (brandKey !== 'birlaopus') return base;` line:

```js
    // Early return for CSV-parsed items: proposed fields pre-computed by parseBirlaOpusCsv.
    if (pdfItem._proposedName) {
        return {
            ...base,
            proposed_name:        pdfItem._proposedName,
            proposed_sku:         pdfItem._proposedZohoSku || currentSku,
            proposed_description: pdfItem._proposedDescription,
        };
    }
```

- [ ] **Step 4: Patch `matchWithZohoItems` in `services/price-list-parser.js` — add `zohoByExactSku` map**

Find the block that builds `zohoByName`, `zohoByWords`, `zohoBySku` (starts around line 1522). It begins with:

```js
    const zohoByName = new Map();
    const zohoByWords = [];
    const zohoBySku = []; // [{item, struct:{abbrev,base,packCode}, name, sku, finish}]

    scopedZoho.forEach(zi => {
```

Add a new Map declaration **before** `const zohoByName`:

```js
    // Exact-SKU index for CSV items that carry _proposedZohoSku (e.g. "PEWHITE-1L").
    const zohoByExactSku = new Map();
    scopedZoho.forEach(zi => {
        const sku = (zi.sku || zi.zoho_sku || '').toUpperCase().trim();
        if (sku) zohoByExactSku.set(sku, zi);
    });

```

- [ ] **Step 5: Patch `matchWithZohoItems` — add exact-SKU lookup in the main match loop**

Find the main loop section (around line 1558) that reads:

```js
        // Shortcut: rate-anchored expansion already picked the Zoho target.
        let match = null;
        if (parsed._assignedZohoId) {
            match = zohoById.get(String(parsed._assignedZohoId)) || null;
        }

        if (!match) match = zohoByName.get(productName);
```

Insert a new block **after** the `_assignedZohoId` block and **before** the `zohoByName` lookup:

```js
        // Exact SKU shortcut: CSV-parsed items carry a pre-computed Zoho SKU.
        if (!match && parsed._proposedZohoSku) {
            match = zohoByExactSku.get(parsed._proposedZohoSku.toUpperCase()) || null;
        }

```

- [ ] **Step 6: Patch `runBrandDplMatch` in `routes/zoho.js` — preserve `_proposed*` fields**

Find `async function runBrandDplMatch(brand, parsedRows)` (around line 5664). Inside, find the `.map(r => { ... return { ... } })` block:

```js
    const cleanItems = parsedRows.map(r => {
        const rawCat = String(r.category || '').toUpperCase().trim();
        let canonCat = PASTE_CAT_TO_CANON[rawCat];
        if (canonCat === undefined && rawCat) {
            unmappedCats.add(rawCat);
            canonCat = r.category || '';
        }
        return {
            product: r.product, packSize: r.packSize, dpl: r.dpl,
            category: canonCat || '',
            brand: r.brand, baseCode: r.baseCode,
        };
    });
```

Change the `return { ... }` to also pass through `_proposed*` fields:

```js
        const item = {
            product: r.product, packSize: r.packSize, dpl: r.dpl,
            category: canonCat || '',
            brand: r.brand, baseCode: r.baseCode,
        };
        if (r._proposedName)        item._proposedName        = r._proposedName;
        if (r._proposedZohoSku)     item._proposedZohoSku     = r._proposedZohoSku;
        if (r._proposedDescription) item._proposedDescription = r._proposedDescription;
        return item;
```

- [ ] **Step 7: Run the new tests — confirm all pass**

```
npx jest tests/unit/dpl-csv-match.test.js --no-coverage
```

Expected: all 6 tests PASS

- [ ] **Step 8: Run the full test suite — confirm no regressions**

```
npx jest --no-coverage
```

Expected: all previously-passing tests still pass

- [ ] **Step 9: Commit**

```
git add services/price-list-parser.js routes/zoho.js tests/unit/dpl-csv-match.test.js
git commit -m "feat(dpl-csv): exact-SKU match branch + computeProposedFields pass-through + runBrandDplMatch _proposed* preserve"
```

---

## Task 4: `uploadPriceCsv` multer config

**Files:**
- Modify: `config/uploads.js`

- [ ] **Step 1: Add `uploadPriceCsv` after `uploadPriceList` in `config/uploads.js`**

Find the existing `uploadPriceList` block (line ~149):

```js
// Price list PDF upload (10MB, memory storage for parsing)
const uploadPriceList = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files allowed'));
        }
    }
});
```

Insert the new config **immediately after** this block:

```js
// Price list CSV upload (5MB, memory storage for parsing, CSV only)
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

- [ ] **Step 2: Add `uploadPriceCsv` to `module.exports` at the bottom of `config/uploads.js`**

Find the `module.exports = {` block and add:

```js
    uploadPriceCsv,
```

- [ ] **Step 3: Confirm no syntax errors**

```
node -e "require('./config/uploads'); console.log('OK')"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```
git add config/uploads.js
git commit -m "feat(dpl-csv): add uploadPriceCsv multer config (5MB, memory, CSV-only)"
```

---

## Task 5: `POST /api/zoho/items/dpl-parse-csv` endpoint

**Files:**
- Modify: `routes/zoho.js`

- [ ] **Step 1: Add `CSV_CAT_TO_CANON` constant near the top of `routes/zoho.js`**

Find the existing `PASTE_CAT_TO_CANON` constant (around line 55). Add a new constant **immediately after** it (before `const BRAND_DISPLAY_NAMES`):

```js
// Maps raw CSV category values → canonical form for matchWithZohoItems.
// CSV has clean single-word categories unlike the paste-text "Interior Luxury" format.
const CSV_CAT_TO_CANON = {
    'INTERIOR':      'INTERIOR EMULSION',
    'EXTERIOR':      'EXTERIOR EMULSION',
    'ENAMEL':        'ENAMEL',
    'WOOD FINISHES': 'WOOD FINISH',
    'COLORANTS':     'COLORANT',
    'PAINTING TOOLS':'',
};
```

- [ ] **Step 2: Add `uploadPriceCsv` to the imports at the top of `routes/zoho.js`**

Find the section where `uploadPriceList` is imported or used (search for `uploadPriceList` near the top of the file). It is likely destructured from `config/uploads`. Find:

```js
const { uploadPriceList
```

or wherever multer configs are destructured. Add `uploadPriceCsv` to the same destructure. If it is imported inline via `require`, find the line and add:

```js
const { uploadPriceCsv } = require('../config/uploads');
```

(Check how `uploadPriceList` is imported in `routes/zoho.js` — it may be via a destructured require at the top of the file. Match that pattern exactly.)

- [ ] **Step 3: Locate where to insert the new route**

Find `router.post('/items/brand-dpl/:brand/match'` (around line 5644). The new endpoint should be inserted **before** `router.get('/items/propose-naming'` and **after** the brand-dpl match route. Find the comment block:

```
/**
 * GET /api/zoho/items/propose-naming
```

Insert the new route **just before** this GET route.

- [ ] **Step 4: Add the new endpoint to `routes/zoho.js`**

```js
/**
 * POST /api/zoho/items/dpl-parse-csv
 *
 * Upload a Birla Opus SKU Report CSV → parse → save to brand_dpl_lists → match.
 * Returns the same aiData shape as POST /items/brand-dpl/:brand so the frontend
 * can call showAiResults() directly.
 *
 * Multipart field: csv (required)
 * Body params:
 *   effective_date  optional YYYY-MM-DD; extracted from filename if absent
 *   match           optional boolean string, default "true"
 */
router.post('/items/dpl-parse-csv', requirePermission('zoho', 'manage'), uploadPriceCsv.single('csv'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No CSV file uploaded' });

        // Derive effective date: filename → body param → today
        let effectiveDate = new Date().toISOString().slice(0, 10);
        const fnMatch = (req.file.originalname || '').match(/(\d{1,2})([A-Za-z]{3})(\d{4})/);
        if (fnMatch) {
            const monthMap = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
                               Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
            const mm = monthMap[fnMatch[2]];
            if (mm) {
                const dd = String(fnMatch[1]).padStart(2, '0');
                effectiveDate = `${fnMatch[3]}-${mm}-${dd}`;
            }
        }
        if (req.body && req.body.effective_date) {
            const ed = String(req.body.effective_date);
            if (/^\d{4}-\d{2}-\d{2}$/.test(ed)) effectiveDate = ed;
        }

        const csvString = req.file.buffer.toString('utf8');
        const parsedRows = priceListParser.parseBirlaOpusCsv(req.file.buffer, effectiveDate);
        if (parsedRows.length === 0) {
            return res.status(400).json({ success: false, message: 'No data rows found in CSV — check file format' });
        }

        // Canonicalize CSV categories for match compatibility
        const rowsForMatch = parsedRows.map(r => {
            const canon = CSV_CAT_TO_CANON[r.category.toUpperCase()];
            return canon !== undefined ? { ...r, category: canon } : r;
        });

        const before = await brandDplService.get('birlaopus');
        const updatedBy = req.user && req.user.username ? req.user.username : null;
        const saved = await brandDplService.save({
            brand: 'birlaopus',
            rawText: csvString,
            parsedRows: rowsForMatch,
            effectiveDate,
            updatedBy,
        });

        try {
            const audit = require('../services/audit-log');
            await audit.record(req, {
                action: 'brand_dpl.save',
                entity_type: 'brand_dpl_lists',
                entity_id: 'birlaopus',
                before: before ? { parsed_count: before.parsed_count, effective_date: before.effective_date } : null,
                after: { parsed_count: saved.parsed_count, effective_date: saved.effective_date },
            });
        } catch (e) {
            console.warn('[dpl-parse-csv] audit-log failed:', e.message);
        }

        let match = null;
        const runMatch = req.body && String(req.body.match) !== 'false';
        if (runMatch) {
            match = await runBrandDplMatch('birlaopus', rowsForMatch);
        }

        return res.json({
            success: true,
            data: {
                saved,
                parsed_count: parsedRows.length,
                ...(match ? { match } : {}),
            },
        });
    } catch (err) {
        console.error('[dpl-parse-csv] error:', err);
        return res.status(500).json({ success: false, message: err.message || 'Server error' });
    }
});
```

- [ ] **Step 5: Find how `uploadPriceList` is imported in `routes/zoho.js` and confirm `uploadPriceCsv` is available**

Run:
```
node -e "const r = require('./routes/zoho'); console.log('OK')"
```

Expected: `OK` (no missing-require errors). If you see an error about `uploadPriceCsv`, check Step 2.

- [ ] **Step 6: Manual smoke test via curl**

```
curl -s -X POST http://localhost:3000/api/zoho/items/dpl-parse-csv \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "csv=@D:/QUALITY COLOURS/DOCUMENTS/PRICE LIST/BirlaOpus_DPL_15May2026_SKU_Report.csv" \
  -F "match=false" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const p=JSON.parse(d); console.log('parsed_count:', p.data?.parsed_count)"
```

Expected: `parsed_count: 990` (approx)

(Start the server first: `node server.js` or `pm2 start server.js`)

- [ ] **Step 7: Commit**

```
git add routes/zoho.js
git commit -m "feat(dpl-csv): POST /api/zoho/items/dpl-parse-csv endpoint"
```

---

## Task 6: CSV tab UI in `admin-dpl.html`

**Files:**
- Modify: `public/admin-dpl.html`

- [ ] **Step 1: Update the Step 1 heading**

Find (line ~128):
```html
                Upload Brand Price List PDF
```

Replace with:
```html
                Upload Brand Price List PDF / CSV
```

- [ ] **Step 2: Add the tab bar and CSV upload area**

Find the opening of Step 1 upload area (line ~171):
```html
            <!-- Upload area -->
            <div class="border-2 border-dashed border-gray-300 rounded-lg p-8 ...
```

Insert the tab bar and CSV upload area **immediately before** the `<!-- Upload area -->` comment:

```html
            <!-- Upload mode tabs -->
            <div class="flex gap-2 mb-4 border-b border-gray-200 pb-2">
                <button id="tabPdf" onclick="switchUploadTab('pdf')"
                    class="px-3 py-1.5 rounded-lg text-xs font-semibold border transition tab-upload-btn active-tab"
                    style="background:#667eea;color:white;border-color:#667eea">
                    📄 Upload PDF
                </button>
                <button id="tabCsv" onclick="switchUploadTab('csv')"
                    class="px-3 py-1.5 rounded-lg text-xs font-semibold border border-gray-300 bg-white text-gray-600 transition tab-upload-btn">
                    📊 Upload CSV (SKU Report)
                </button>
            </div>

            <!-- CSV upload area (hidden by default) -->
            <div id="csvUploadArea" class="hidden mb-4">
                <div class="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
                    <p class="text-xs text-emerald-800 font-semibold mb-1">Birla Opus SKU Report CSV</p>
                    <p class="text-[11px] text-emerald-700 mb-3">e.g. <code>BirlaOpus_DPL_15May2026_SKU_Report.csv</code> — sparse matrix format, max 5 MB. Parses all size columns automatically.</p>
                    <div class="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
                        <div class="flex-1">
                            <label class="text-[11px] text-gray-600 font-medium block mb-1">CSV File</label>
                            <input type="file" id="csvFileInput" accept=".csv"
                                class="block w-full text-xs text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-emerald-100 file:text-emerald-700 hover:file:bg-emerald-200 cursor-pointer"
                                onchange="onCsvFileSelect()">
                        </div>
                        <div>
                            <label class="text-[11px] text-gray-600 font-medium block mb-1">Effective Date</label>
                            <input type="date" id="csvEffectiveDate"
                                class="px-2 py-1.5 border border-gray-300 rounded text-xs bg-white focus:border-emerald-500 outline-none">
                        </div>
                    </div>
                    <div id="csvFileInfo" class="hidden mt-2 text-[11px] text-emerald-700 font-medium"></div>
                    <div class="mt-3 flex items-center gap-3">
                        <button onclick="parseCsv()" id="parseCsvBtn"
                            class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold transition flex items-center gap-2 disabled:opacity-50" disabled>
                            <svg id="parseCsvSpinner" class="hidden w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                            Parse &amp; Match CSV
                        </button>
                        <span id="csvParseStatus" class="text-[11px] text-gray-500"></span>
                    </div>
                </div>
            </div>

            <!-- PDF upload area (shown by default, wrapped in a div for tab switching) -->
            <div id="pdfUploadArea">
```

- [ ] **Step 3: Close the `pdfUploadArea` div**

Find the closing of the existing PDF parse button section (around the `</div>` that closes the "Parse button" area, before the `<!-- Brand DPL Mode -->` comment). The structure is:

```html
            <!-- Parse button -->
            <div class="mt-4 ...">
                ...
            </div>

            <!-- Brand DPL Mode — saved per-brand DPL price list -->
```

Insert a `</div>` (closing `pdfUploadArea`) **between** the Parse button closing div and the Brand DPL Mode comment:

```html
            </div><!-- /pdfUploadArea -->

            <!-- Brand DPL Mode — saved per-brand DPL price list -->
```

- [ ] **Step 4: Add tab-switching JS and `parseCsv()` function**

Find the `<script>` block in `admin-dpl.html` (near the bottom, there is one large `<script>` section). Add the following functions inside it, anywhere before the closing `</script>`:

```js
    // ── CSV Upload Tab ──────────────────────────────────────────────
    function switchUploadTab(tab) {
        var isPdf = tab === 'pdf';
        document.getElementById('pdfUploadArea').classList.toggle('hidden', !isPdf);
        document.getElementById('csvUploadArea').classList.toggle('hidden',  isPdf);
        // Update button styles
        var pdfBtn = document.getElementById('tabPdf');
        var csvBtn = document.getElementById('tabCsv');
        if (isPdf) {
            pdfBtn.style.background = '#667eea'; pdfBtn.style.color = 'white'; pdfBtn.style.borderColor = '#667eea';
            csvBtn.style.background = 'white';   csvBtn.style.color = '#4b5563'; csvBtn.style.borderColor = '#d1d5db';
        } else {
            csvBtn.style.background = '#059669'; csvBtn.style.color = 'white'; csvBtn.style.borderColor = '#059669';
            pdfBtn.style.background = 'white';   pdfBtn.style.color = '#4b5563'; pdfBtn.style.borderColor = '#d1d5db';
        }
    }

    function onCsvFileSelect() {
        var file = document.getElementById('csvFileInput').files[0];
        if (!file) return;
        var btn = document.getElementById('parseCsvBtn');
        btn.disabled = false;
        // Show file info
        var info = document.getElementById('csvFileInfo');
        info.textContent = file.name + ' — ' + (file.size / 1024).toFixed(1) + ' KB';
        info.classList.remove('hidden');
        // Try to extract date from filename: "15May2026" → "2026-05-15"
        var m = file.name.match(/(\d{1,2})(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(\d{4})/i);
        if (m) {
            var months = {jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
                          jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12'};
            var mm = months[m[2].toLowerCase()];
            var dd = ('0' + m[1]).slice(-2);
            document.getElementById('csvEffectiveDate').value = m[3] + '-' + mm + '-' + dd;
        }
    }

    async function parseCsv() {
        var file = document.getElementById('csvFileInput').files[0];
        if (!file) { showToast('Please select a CSV file first', 'error'); return; }

        var btn = document.getElementById('parseCsvBtn');
        var sp  = document.getElementById('parseCsvSpinner');
        var statusEl = document.getElementById('csvParseStatus');
        btn.disabled = true; sp.classList.remove('hidden');
        statusEl.textContent = 'Uploading and parsing...';

        try {
            var fd = new FormData();
            fd.append('csv', file);
            var effDate = document.getElementById('csvEffectiveDate').value;
            if (effDate) fd.append('effective_date', effDate);
            fd.append('match', 'true');

            var resp = await fetch('/api/zoho/items/dpl-parse-csv', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + getToken() },
                body: fd,
            });
            var body = await resp.json();
            if (!body.success) throw new Error(body.message || 'Parse failed');

            var parsed = body.data.parsed_count || 0;
            statusEl.textContent = parsed + ' line items parsed';

            if (body.data.match) {
                aiData = body.data.match;
                showAiResults();
            }
            if (body.data.saved) {
                renderSavedDplCard(body.data.saved);
            }
            showToast(parsed + ' items parsed and matched from CSV', 'success');
        } catch (err) {
            showToast('CSV parse error: ' + err.message, 'error');
            statusEl.textContent = 'Error: ' + err.message;
        } finally {
            btn.disabled = false; sp.classList.add('hidden');
        }
    }
    // ── /CSV Upload Tab ─────────────────────────────────────────────
```

- [ ] **Step 5: Manual browser test**

Navigate to `http://localhost:3000/admin-dpl.html` (start server if needed: `node server.js`).

Check:
- Two tabs appear: "📄 Upload PDF" and "📊 Upload CSV (SKU Report)"
- Clicking CSV tab hides PDF area, shows CSV upload area
- Clicking PDF tab restores the drop-zone
- Selecting `BirlaOpus_DPL_15May2026_SKU_Report.csv` auto-fills the effective date field with `2026-05-15`
- "Parse & Match CSV" button becomes enabled
- Clicking it posts to the endpoint, and on success the step 2 review table appears

- [ ] **Step 6: Commit**

```
git add public/admin-dpl.html
git commit -m "feat(dpl-csv): add CSV upload tab to admin-dpl.html Step 1"
```

---

## Task 7: Standalone CLI import script

**Files:**
- Create: `scripts/import-birlaopus-dpl-csv.js`

- [ ] **Step 1: Create the script**

```js
#!/usr/bin/env node
/**
 * Standalone Birla Opus DPL CSV importer.
 * Usage:
 *   node scripts/import-birlaopus-dpl-csv.js <path/to/csv>
 *   node scripts/import-birlaopus-dpl-csv.js <path/to/csv> --save
 */
'use strict';

const fs      = require('fs');
const path    = require('path');
const readline = require('readline');

const { parseBirlaOpusCsv } = require('../services/price-list-parser');

const csvPath = process.argv[2];
const autoSave = process.argv.includes('--save');

if (!csvPath) {
    console.error('Usage: node scripts/import-birlaopus-dpl-csv.js <path/to/csv> [--save]');
    process.exit(1);
}

const absPath = path.resolve(csvPath);
if (!fs.existsSync(absPath)) {
    console.error(`File not found: ${absPath}`);
    process.exit(1);
}

// Extract effective date from filename
function extractDateFromFilename(filename) {
    const m = filename.match(/(\d{1,2})(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(\d{4})/i);
    if (!m) return new Date().toISOString().slice(0, 10);
    const months = { jan:'01',feb:'02',mar:'03',apr:'04',may:'05',jun:'06',
                     jul:'07',aug:'08',sep:'09',oct:'10',nov:'11',dec:'12' };
    const mm = months[m[2].toLowerCase()];
    const dd = String(m[1]).padStart(2, '0');
    return `${m[3]}-${mm}-${dd}`;
}

const effectiveDate = extractDateFromFilename(path.basename(absPath));

console.log(`\nReading: ${absPath}`);
const buf = fs.readFileSync(absPath);
const items = parseBirlaOpusCsv(buf, effectiveDate);

if (items.length === 0) {
    console.error('No items parsed — check CSV format.');
    process.exit(1);
}

// Summary by category + segment
const byCategory = {};
for (const item of items) {
    const key = `${item.category} - ${item.segment}`;
    if (!byCategory[key]) byCategory[key] = { count: 0, minDpl: Infinity, maxDpl: -Infinity };
    byCategory[key].count++;
    if (item.dpl < byCategory[key].minDpl) byCategory[key].minDpl = item.dpl;
    if (item.dpl > byCategory[key].maxDpl) byCategory[key].maxDpl = item.dpl;
}

const allDpls = items.map(i => i.dpl);
const minDpl = Math.min(...allDpls);
const maxDpl = Math.max(...allDpls);

console.log(`\n${'─'.repeat(60)}`);
console.log(`  Birla Opus DPL CSV — Parse Preview`);
console.log(`${'─'.repeat(60)}`);
console.log(`  File:           ${path.basename(absPath)}`);
console.log(`  Effective date: ${effectiveDate}`);
console.log(`  Total items:    ${items.length}`);
console.log(`  DPL range:      ₹${minDpl} – ₹${maxDpl}`);
console.log(`\n  By Category:`);
for (const [key, v] of Object.entries(byCategory).sort()) {
    console.log(`    ${key.padEnd(35)} ${String(v.count).padStart(4)} items   ₹${v.minDpl}–₹${v.maxDpl}`);
}
console.log(`\n  Sample (first 3 items):`);
for (const it of items.slice(0, 3)) {
    const salesPrice = Math.ceil(it.dpl * 1.298);
    console.log(`    ${it._proposedName}`);
    console.log(`      SKU: ${it._proposedZohoSku}   DPL: ₹${it.dpl}   Sales: ₹${salesPrice}`);
}
console.log(`${'─'.repeat(60)}\n`);

async function saveToDb() {
    const { createPool } = require('../config/database');
    const brandDplService = require('../services/brand-dpl-service');
    const pool = createPool();
    brandDplService.setPool(pool);

    console.log('Saving to brand_dpl_lists...');
    const saved = await brandDplService.save({
        brand: 'birlaopus',
        rawText: fs.readFileSync(absPath, 'utf8'),
        parsedRows: items,
        effectiveDate,
        updatedBy: 'import-script',
    });
    console.log('Saved:', JSON.stringify(saved, null, 2));
    await pool.end();
}

if (autoSave) {
    saveToDb().catch(err => { console.error('Save failed:', err.message); process.exit(1); });
} else {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question('Save to brand_dpl_lists? [y/N]: ', async answer => {
        rl.close();
        if (answer.trim().toLowerCase() === 'y') {
            await saveToDb().catch(err => { console.error('Save failed:', err.message); process.exit(1); });
        } else {
            console.log('Aborted — nothing saved.');
        }
    });
}
```

- [ ] **Step 2: Smoke test the CLI (preview only, no save)**

```
node scripts/import-birlaopus-dpl-csv.js "D:/QUALITY COLOURS/DOCUMENTS/PRICE LIST/BirlaOpus_DPL_15May2026_SKU_Report.csv"
```

Expected output includes:
- `Effective date: 2026-05-15`
- `Total items:    990` (approx)
- Category breakdown table
- 3 sample items with correct names and SKUs

When prompted `Save to brand_dpl_lists? [y/N]:` — type `N` to cancel.

- [ ] **Step 3: Commit**

```
git add scripts/import-birlaopus-dpl-csv.js
git commit -m "feat(dpl-csv): standalone CLI import script for Birla Opus SKU Report CSV"
```

---

## Task 8: End-to-end test on admin-dpl.html

No new files — this is a manual verification step.

- [ ] **Step 1: Start the server**

```
node server.js
```

(or `pm2 restart business-manager` if running under pm2)

- [ ] **Step 2: Open admin-dpl.html and upload the real CSV**

Navigate to `http://localhost:3000/admin-dpl.html`. Log in as `sharjoon / 123456`.

- Click "📊 Upload CSV (SKU Report)" tab
- Select `D:/QUALITY COLOURS/DOCUMENTS/PRICE LIST/BirlaOpus_DPL_15May2026_SKU_Report.csv`
- Confirm effective date auto-fills to `2026-05-15`
- Click "Parse & Match CSV"

- [ ] **Step 3: Verify parse count in status**

Status area should show approximately `990 line items parsed`.

- [ ] **Step 4: Verify Step 2 review table**

- Step 2 "Compare & Review" should appear automatically
- Items in the matched group should show `proposed_name` like `PE WHITE ONE PURE ELEGANCE WHITE BIRLA OPUS 1L`
- Items in the unmatched group are those whose `PEWHITE-1L` SKU doesn't exist in the Zoho DB (expected for any SKUs not yet in Zoho)

- [ ] **Step 5: Verify brand DPL saved card**

Below the Step 1 upload area, the Birla Opus "Saved DPL" card should update to show ~990 rows, effective date 2026-05-15.

- [ ] **Step 6: Verify "Match Now" works from saved card**

Click "⚡ Match Now" — should re-run match from the saved CSV data and repopulate Step 2 table.

- [ ] **Step 7: Final commit if any minor fixes were needed**

```
git add -A
git commit -m "fix(dpl-csv): end-to-end fixes from manual testing"
```

---

## Self-Review Checklist (completed by plan author)

**Spec coverage:**
- ✅ Task 1+2: `buildProperBirlaItemName`, `buildProperBirlaZohoSku`, `buildProperBirlaDescription`
- ✅ Task 2: `parseBirlaOpusCsv` (sparse matrix, BOM strip, comma prices, empty cell skip)
- ✅ Task 3: `computeProposedFields` pass-through, `matchWithZohoItems` exact-SKU, `runBrandDplMatch` `_proposed*` preserve
- ✅ Task 4: `uploadPriceCsv` multer (memory, 5MB, CSV-only)
- ✅ Task 5: `POST /api/zoho/items/dpl-parse-csv` (parse → save → match → same aiData shape)
- ✅ Task 6: CSV tab UI in Step 1 with tab toggle, date auto-fill, `parseCsv()`, `showAiResults()` call
- ✅ Task 7: Standalone CLI with preview + optional save
- ✅ Task 8: End-to-end verification
- ✅ Naming: BASE + PRODUCT + COLOUR + BIRLA OPUS + SIZE (product-first, approved)
- ✅ Sales price: `Math.ceil(dpl * 1.298)` — unchanged, `computeProposedFields` already uses `1.18 * 1.10`
- ✅ Effective date: extracted from filename `15May2026` → `2026-05-15`
- ✅ Both PDF paste-text and CSV coexist — paste panel untouched

**No placeholders found.**

**Type consistency:** `parseBirlaOpusCsv` outputs `productName` field (not `product_name`). Both `buildProperBirlaItemName` and `buildProperBirlaDescription` consume `productName`. `parseBirlaOpusCsv` also sets `product` (fuzzy-match fallback) = `productName + " - " + colourName`. Consistent throughout.
