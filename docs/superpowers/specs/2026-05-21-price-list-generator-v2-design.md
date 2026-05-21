# Price List Generator v2 — Design Spec

**Date:** 2026-05-21
**Status:** Approved

---

## 1. Goal

Enhance the existing Customer Price List Generator to support:
1. Individual product search + selection (category accordion + live search)
2. Negative markup % (for discount price lists)
3. Category column in the PDF table
4. Proper ₹ symbol rendering via embedded Noto Sans font

---

## 2. Files Changed

| File | Action | Purpose |
|---|---|---|
| `assets/fonts/NotoSans-Regular.ttf` | Add | Noto Sans regular — enables ₹ symbol in PDF |
| `assets/fonts/NotoSans-Bold.ttf` | Add | Noto Sans bold — used for PDF headers/bands |
| `services/price-list-pdf-generator.js` | Modify | Register fonts; new 5-column table layout; flat brand table; update formatINR |
| `routes/price-list.js` | Modify | Add GET /items; update POST /generate to accept items[]; widen markup range to −99…200 |
| `public/admin-price-list-generator.html` | Modify | 2-step UI: brand select → load items → accordion+search → select → generate |

---

## 3. Font Setup

Download `NotoSans-Regular.ttf` and `NotoSans-Bold.ttf` from Google Fonts / jsDelivr and commit to `assets/fonts/`.

In `services/price-list-pdf-generator.js`, register at module load:

```js
const path = require('path');
const FONT_REGULAR = path.join(__dirname, '../assets/fonts/NotoSans-Regular.ttf');
const FONT_BOLD    = path.join(__dirname, '../assets/fonts/NotoSans-Bold.ttf');
```

In `generatePriceListPdf`, after `new PDFDocument(...)`:

```js
doc.registerFont('Regular', FONT_REGULAR);
doc.registerFont('Bold',    FONT_BOLD);
```

Replace all `doc.font('Helvetica')` → `doc.font('Regular')` and `doc.font('Helvetica-Bold')` → `doc.font('Bold')` throughout the function.

`formatINR` stays as `'₹ ' + amount.toLocaleString('en-IN')` — now renders correctly with the registered font.

---

## 4. PDF Layout Changes

### 4.1 Column widths (PAGE_W ≈ 515pt)

| Column | Width | % |
|---|---|---|
| Product Name | 206pt | 40% |
| Category | 77pt | 15% |
| Colour | 88pt | 17% |
| Size | 62pt | 12% |
| Price (GST Incl.) | 77pt | 15% |

Total: 510pt (remaining 5pt absorbed into right padding of Price column).

### 4.2 Table structure per brand

- **Brand band** — kept (`#f0fdf4` fill, `#1B5E3B` bold, brand name UPPERCASED)
- **Category sub-band headers** — **removed** (category is now a column)
- **Column header row** — dark band with: PRODUCT / CATEGORY / COLOUR / SIZE / PRICE
- **Item rows** — alternating white / `#f9fafb`; Category cell in `#374151` regular weight

### 4.3 groupRowsForPdf updated

Signature changes from `groupRowsForPdf(rows, brandLabel)` returning `{ brandLabel, categories[] }` to `groupRowsForPdf(rows, brandLabel)` returning `{ brandLabel, items[] }` — a flat list (no category sub-groups).

Items within the flat list are sorted: **category alphabetically first**, then productName, then packSize.

```js
// New return shape (v2):
{ brandLabel, items: [{ productName, category, colourName, packSize, finalPrice }] }
```

The route continues to call `groupRowsForPdf` once per brand (same as v1), then passes the resulting array to `generatePriceListPdf`. The PDF generator iterates brand groups and within each brand renders a flat item table (no category sub-bands).

`generatePriceListPdf` signature is unchanged: `generatePriceListPdf(brandGroups, { customerName, markupPercent, effectiveDate })`.

---

## 5. Endpoint: `GET /api/price-list/items`

Auth: `requirePermission('zoho', 'manage')`

Query param: `brands` — comma-separated brand codes (e.g. `?brands=birlaopus,asian`)

Validation: brands filtered against `BRAND_LABELS` allowlist; max 6 brands.

Response:
```json
{
  "success": true,
  "data": [
    {
      "brand": "birlaopus",
      "brandLabel": "Birla Opus",
      "category": "Interior",
      "product": "One Pure Elegance",
      "colourName": "White",
      "packSize": "1L",
      "dpl": 500
    }
  ]
}
```

Items returned sorted by brand → category → product → packSize.

Only brands with non-null `parsed_rows` and `parsed_count > 0` are returned.

---

## 6. Endpoint: `POST /api/price-list/generate` (updated)

Auth: `requirePermission('zoho', 'manage')`

### Request body

```json
{
  "customer_name": "Raj Constructions",
  "whatsapp_number": "9876543210",
  "markup_percent": -10,
  "effective_date": "2026-05-21",
  "items": [
    {
      "brand": "birlaopus",
      "brandLabel": "Birla Opus",
      "category": "Interior",
      "product": "One Pure Elegance",
      "colourName": "White",
      "packSize": "1L",
      "dpl": 500
    }
  ]
}
```

### Removed fields
- `brands[]` — no longer needed
- `categories[]` — no longer needed

### Validation

| Field | Rule |
|---|---|
| `customer_name` | Required, non-empty string, max 100 chars |
| `items` | Required, non-empty array, max 500 items |
| `markup_percent` | Number, −99 to 200 |
| `items[].dpl` | Number ≥ 0 |
| `items[].brand` | Must be in BRAND_LABELS allowlist |
| `whatsapp_number` | Optional, 10-digit Indian mobile |
| `effective_date` | Optional ISO date, defaults to today |

### Processing

1. Validate inputs
2. For each item: `finalPrice = computeFinalPrice(item.dpl, markupPercent)`
3. Attach `finalPrice` to item
4. `groupRowsForPdf(items, ...)` — group by brand
5. `generatePriceListPdf(brandGroups, opts)` → Buffer
6. WhatsApp send (non-blocking on failure)
7. Return PDF buffer

### Error responses

| Condition | Status | Message |
|---|---|---|
| No items | 400 | "items must be a non-empty array" |
| markup_percent out of range | 400 | "markup_percent must be between -99 and 200" |
| Invalid brand in items | 400 | "Invalid brand in items" |
| PDF generation failure | 500 | "Failed to generate price list" |

---

## 7. Price Formula (unchanged)

```js
Math.ceil(dpl × (1 + markup_percent / 100) × 1.18)
```

Examples with negative markup:

| DPL | Markup | Final Price |
|---|---|---|
| ₹500 | −10% | ₹531 |
| ₹500 | −20% | ₹472 |
| ₹500 | 0% | ₹590 |
| ₹500 | 10% | ₹649 |

---

## 8. UI: `admin-price-list-generator.html` (updated)

### Step 1 — Config panel

```
Customer Name *     [__________________________]
WhatsApp No         [+91 _____________________ ]
Select Brands *     ☑ Birla Opus  ☐ Asian Paints  ...
Markup %  *         [-10] %   Preview: DPL ₹500 → Final ₹531
Effective Date      [2026-05-21]

                    [ Load Products → ]
```

Markup input: `min="-99" max="200"`. Preview updates live. "Load Products" button triggers `GET /api/price-list/items?brands=...` and reveals Step 2.

### Step 2 — Product selection panel (appears after Load)

```
🔍 [Search products…]                    [Select All] [Clear All]

▼ Interior (12 selected / 45)                              [All] [None]
  ☑ One Pure Elegance · White · 1L · DPL ₹500
  ☑ One Pure Elegance · White · 4L · DPL ₹1,800
  ☐ Luxury Emulsion · Tintable · 10L · DPL ₹3,200
  ...

▶ Exterior (0 selected / 30)                               [All] [None]
▶ Enamel (5 selected / 20)                                 [All] [None]

──────────────────────────────────────────
  42 items selected
```

- Search filters across all categories (product name + colour name, case-insensitive)
- Category accordion: click header to expand/collapse
- Each row: checkbox + product + colour + size + DPL price
- Per-category [All] / [None] buttons
- Global [Select All] / [Clear All] buttons
- Footer shows total selected count

### Buttons (always visible at bottom of page)

```
[ ⬇ Download PDF ]    [ 📱 Send on WhatsApp ]
```

- Download: disabled until ≥1 item selected
- WhatsApp: disabled until ≥1 item selected AND 10-digit number entered

### JavaScript functions

```js
async function loadBrands()               // GET /api/price-list/brands → render brand checkboxes
async function loadItems()                // GET /api/price-list/items?brands=... → render accordion
function renderAccordion(items)           // build category accordion HTML from items array
function filterItems(query)              // live search — show/hide rows matching query
function refreshSelectionCount()          // update footer count + enable/disable buttons
function toggleCategory(cat, checked)    // select/deselect all items in a category
function updateMarkupPreview()           // live preview label
function updateWaBtn()                   // enable/disable WA button
async function generatePriceList(mode)   // POST /generate with items[] → download/WA
```

### Data model (client-side)

```js
var allItems = [];       // full list from GET /items
var selectedIds = new Set();  // Set of item IDs (brand|product|colourName|packSize)
```

Item ID is constructed as: `` `${brand}|${product}|${colourName}|${packSize}` ``

---

## 9. What Is NOT Changed

- `admin-dpl.html` — untouched
- DPL upload / match / push-to-Zoho workflow — untouched
- `brand_dpl_lists` table schema — read-only, no changes
- Existing WhatsApp routes/services — called as-is
- `GET /api/price-list/brands` endpoint — untouched
- `computeFinalPrice` formula — unchanged (negative markup already works mathematically)

---

## 10. Success Criteria

- Admin selects brands → loads items → searches/selects individual products → PDF generates with only selected items
- Category column appears in PDF for every item row
- ₹ symbol renders correctly in PDF (not as broken glyph)
- Negative markup (e.g. −10%) produces correct discounted prices in PDF
- Download and WhatsApp send both work
- Download button disabled until at least 1 item is selected
- No existing DPL / Zoho functionality broken
