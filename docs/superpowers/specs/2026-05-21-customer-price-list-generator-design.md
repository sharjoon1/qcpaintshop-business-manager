# Customer Price List Generator — Design Spec

**Date:** 2026-05-21
**Status:** Approved

---

## 1. Goal

Allow admin staff to generate a branded PDF price list from saved brand DPL data, apply a custom markup % on top of DPL + 18% GST, personalise it with a customer name, and either download or send directly via WhatsApp.

---

## 2. User Flow

1. Open `admin-price-list-generator.html`
2. Type customer name
3. Optionally type WhatsApp number
4. Select one or more brands (only brands with saved DPL data are shown)
5. Select categories (dynamically populated from selected brands' data)
6. Type markup % (e.g. 10)
7. Confirm/adjust effective date (pre-filled today)
8. Click **Download PDF** or **Send on WhatsApp**
9. PDF is generated server-side and returned; if WhatsApp, PDF is also sent to the provided number

---

## 3. Architecture

```
[admin-price-list-generator.html]
  ↓ GET /api/price-list/brands
      → query brand_dpl_lists GROUP BY brand (only rows with parsed_rows)
      → return [{ brand, effective_date, item_count }]

  ↓ POST /api/price-list/generate
      body: { customer_name, whatsapp_number?, brands[], categories[], markup_percent, effective_date }
      → for each brand: SELECT parsed_rows FROM brand_dpl_lists WHERE brand = ?
      → flatten + filter by categories[]
      → compute final_price = Math.ceil(dpl × (1 + markup_percent/100) × 1.18)
      → services/price-list-pdf-generator.js → PDFKit buffer
      → if whatsapp_number: send PDF via existing WhatsApp service
      → response: PDF buffer (Content-Type: application/pdf, Content-Disposition: attachment)
```

**New files:**

| File | Purpose |
|---|---|
| `public/admin-price-list-generator.html` | UI — configuration form + result |
| `routes/price-list.js` | `GET /api/price-list/brands`, `POST /api/price-list/generate` |
| `services/price-list-pdf-generator.js` | PDFKit PDF layout logic |
| `server.js` | Mount `routes/price-list.js` at `/api/price-list` (1 line) |

---

## 4. Price Formula

```
final_price = Math.ceil(dpl × (1 + markup_percent / 100) × 1.18)
```

- Markup is applied first, GST (18%) second
- Result is ceiled to the nearest whole rupee (no paise)
- Example: DPL ₹500, markup 10% → ₹500 × 1.10 × 1.18 = ₹649 → **₹649**

---

## 5. Endpoint: `GET /api/price-list/brands`

Auth: `requirePermission('zoho', 'manage')` (same permission as DPL upload)

Response:
```json
{
  "success": true,
  "data": [
    {
      "brand": "birlaopus",
      "label": "Birla Opus",
      "effective_date": "2026-05-15",
      "item_count": 990,
      "categories": ["Interior", "Exterior", "Enamel", "Primer", "Putty"]
    },
    {
      "brand": "asian",
      "label": "Asian Paints",
      "effective_date": "2026-05-01",
      "item_count": 450,
      "categories": ["Interior", "Exterior"]
    }
  ]
}
```

Categories are extracted server-side from `parsed_rows` of each brand (unique values of `row.category`, sorted).

Only brands where `parsed_rows` is non-null and non-empty are returned.

Brand label mapping (hardcoded in route):
```js
const BRAND_LABELS = {
  birlaopus: 'Birla Opus',
  asian: 'Asian Paints',
  berger: 'Berger Paints',
  gem: 'Gem Paints',
  jsw: 'JSW Paints',
  nippon: 'Nippon Paint',
};
```

---

## 6. Endpoint: `POST /api/price-list/generate`

Auth: `requirePermission('zoho', 'manage')`

Request body:
```json
{
  "customer_name": "Raj Constructions",
  "whatsapp_number": "9876543210",
  "brands": ["birlaopus"],
  "categories": ["Interior", "Exterior"],
  "markup_percent": 10,
  "effective_date": "2026-05-21"
}
```

Validation:
- `customer_name`: required, non-empty string, max 100 chars
- `brands`: required, non-empty array
- `markup_percent`: required, number 0–200
- `categories`: optional; if absent or empty, include all categories
- `whatsapp_number`: optional, 10-digit Indian mobile number (strip +91 prefix if present)

Steps:
1. For each brand in `brands[]`: fetch `parsed_rows` from `brand_dpl_lists`
2. Flatten all rows into a single array
3. Filter by `categories[]` (case-insensitive match on `row.category`); skip if categories empty
4. Compute `final_price` for each row
5. Group rows: by brand → by category → sort by product name then pack size
6. Call `generatePriceListPdf(rows, { customerName, markupPercent, effectiveDate })` → Buffer
7. If `whatsapp_number` provided: send PDF via WhatsApp service as document
8. Return PDF buffer with headers:
   ```
   Content-Type: application/pdf
   Content-Disposition: attachment; filename="PriceList-<CustomerName>-<Date>.pdf"
   ```

Error handling:
- No brands with saved DPL → 400 "No DPL data found for selected brands"
- Zero rows after category filter → 400 "No items match selected categories"
- PDF generation error → 500
- WhatsApp send failure → still return PDF (log warning, don't fail the request)

---

## 7. PDF Layout: `services/price-list-pdf-generator.js`

Uses `pdfkit` (already installed, v0.17.2).

**Page setup:** A4 portrait, margins 40pt all sides

**Header (every page):**
- Left: "QUALITY COLOURS" in brand green `#1B5E3B`, bold, 18pt
- Sub-line: "Price List" in 11pt grey
- Right: "Quality Colours, Chennai" + phone "044-XXXX-XXXX" (hardcoded constants in the PDF generator service)
- Horizontal rule

**Customer block (page 1 only, after header):**
```
Prepared for: Raj Constructions
Date: 21 May 2026     Markup: +10%     Prices inclusive of 18% GST
```

**Section headers:**
- Brand: bold, 13pt, `#1B5E3B`, background `#f0fdf4`, full-width band
- Category: bold, 11pt, `#374151`, slight indent, light grey band

**Table columns:**
| Product Name | Colour Name | Pack Size | Price (GST Incl.) |
|---|---|---|---|
| 55% width | 20% | 10% | 15% right-aligned |

- Alternating row background: white / `#f9fafb`
- Font: 9pt regular for rows, 8pt for headers

**Footer (every page):**
- Left: "Prices inclusive of 18% GST | Valid as of [effective_date]"
- Right: "Page N of M"
- Horizontal rule above

**Page breaks:** Before each new brand section if less than 60pt remaining on page.

---

## 8. WhatsApp Send

Use the existing WhatsApp service in the project. Send the PDF as a document (not image).

Message caption:
```
Hi! Please find your price list attached.
Customer: {customer_name}
Date: {effective_date}
Markup: +{markup_percent}%
```

If WhatsApp send fails, log a warning and still return the PDF to the browser — do not throw a 500.

---

## 9. UI: `admin-price-list-generator.html`

**Page title:** "Price List Generator"

**Form layout (card, max-width 700px, centered):**

```
Customer Name *     [__________________________]

WhatsApp No         [+91 _____________________ ]  (optional)

Select Brands *     ☑ Birla Opus (990 items, updated 15 May 2026)
                    ☐ Asian Paints (—)
                    [brands loaded from GET /api/price-list/brands]

Categories          ☑ Interior  ☑ Exterior  ☐ Enamel  ☐ Primer
                    [auto-loaded when brands change, all checked by default]

Markup %  *         [10] %
                    Preview: DPL ₹500 → Final ₹649

Effective Date      [2026-05-21]

[⬇ Download PDF]   [📱 Send on WhatsApp]
```

**JavaScript functions:**

```js
async function loadBrands()           // GET /api/price-list/brands → render brand checkboxes + store categories per brand
function refreshCategories()          // union of categories[] from currently-checked brands → render category checkboxes
async function generatePriceList(mode) // mode = 'download' | 'whatsapp'
function updateMarkupPreview()        // live preview: "DPL ₹500 → Final ₹649"
```

`generatePriceList('download')`:
- POST /api/price-list/generate (whatsapp_number omitted)
- Receive PDF blob → `URL.createObjectURL` → programmatic `<a>` click → download

`generatePriceList('whatsapp')`:
- POST /api/price-list/generate (include whatsapp_number)
- On success: show "✅ Sent to +91 XXXXXX" toast
- Also trigger download as fallback

**WhatsApp button**: disabled + greyed out if `whatsapp_number` field is empty.

**Loading state**: spinner overlay while generating (PDF can take 2–5s for large lists).

**Auth**: reads `auth_token` from localStorage; passes as `Authorization: Bearer` header.

**Nav**: add "Price List" link to admin navigation (same subnav group as DPL).

---

## 10. Pricing Examples

| DPL | Markup | Final Price |
|---|---|---|
| ₹100 | 10% | ₹130 |
| ₹500 | 10% | ₹649 |
| ₹1,200 | 15% | ₹1,628 |
| ₹250 | 0% | ₹295 |

---

## 11. What Is NOT Changed

- `admin-dpl.html` — untouched
- Existing DPL upload / match / push-to-Zoho workflow — untouched
- `brand_dpl_lists` table schema — read-only here, no changes
- Existing WhatsApp routes / services — called as-is, no modifications

---

## 12. Success Criteria

- Admin selects 1+ brands + categories + markup % + customer name → PDF generates with correct prices
- PDF shows grouped sections (brand > category), correct formula, customer name, date
- Download works in browser (PDF opens/saves correctly)
- WhatsApp send delivers PDF document to provided number
- Only brands with saved DPL data appear in the brand selector
- Categories auto-populate from selected brands' data (no hardcoded list)
- WhatsApp button disabled when no number is entered
- No existing DPL upload / Zoho push functionality broken
