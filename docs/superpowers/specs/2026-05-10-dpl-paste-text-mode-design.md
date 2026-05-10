# DPL Paste-Text Mode (Birla Opus)

**Date:** 2026-05-10
**Status:** Approved (brainstorming complete)
**Scope:** Add a paste-text alternative to PDF upload on `admin-dpl.html` for Birla Opus DPL ingestion.

## Background

The current DPL pipeline at `https://act.qcpaintshop.com/admin-dpl.html` requires uploading a PDF, which then runs through `parseBirlaOpus` (regex parser) and AI extraction (`callHermes`). PDF text extraction is unreliable when the vendor's layout changes or when the PDF is image-based, and AI extraction is slow and non-deterministic.

The user already has clean tab-separated DPL data (paste-able) and wants a deterministic, fast ingestion path that skips PDF/AI extraction entirely while reusing the existing match-review-push UI.

## Goals

1. User can paste a tab-separated Birla Opus DPL table into `admin-dpl.html` and get the same review/diff/push experience as the PDF upload flow.
2. Parsing is deterministic — same input always yields the same output.
3. Backend reuses `matchWithZohoItems` and the existing push-to-Zoho endpoint without modification.
4. Existing PDF-upload flow is unchanged.

## Non-Goals

- Other brands (Asian/Berger/JSW/Nippon) — out of scope for v1; tabular parsers for those brands are a follow-up.
- Replacing PDF mode — both modes coexist.
- Changes to the push-to-Zoho endpoint or Zoho API logic.

## Architecture

```
admin-dpl.html
  ├── Step 1: Brand select   (unchanged)
  ├── Step 2: Input          ← MODIFIED: tabbed [Upload PDF | Paste Text]
  │     ├── Upload PDF tab   (unchanged) → POST /api/zoho/parse-price-list
  │     └── Paste Text tab   (new)       → POST /api/zoho/parse-pasted-dpl
  ├── Step 3: Review/Diff    (unchanged — both endpoints return same shape)
  ├── Step 4: Approve        (unchanged)
  └── Step 5: Push to Zoho   (unchanged)
```

The pasted-text endpoint produces the same response shape as the PDF endpoint's job result, so the frontend match-diff-push code works without changes.

## Data Format

Pasted input — one row per line, tab-separated (or 2+ space-separated as fallback):

```
SNo  Category  ProductName(SkuCode)  Shade  PackSize  Price
1    Interior Luxury    One Pure Elegance (941001)    White    1L    490
```

Known quirks in real data:
- Some rows omit the **Shade** column (5 fields instead of 6) — must inherit shade from the previous row for the same product.
- Prices use comma thousands separators: `"1,930"`.
- Pack sizes vary: `200ml`, `500ml`, `1L`, `4L`, `0.9L`, `25KG`, `1kg`, `Per Unit`, `Per Tube`, `Sheet`.
- Trailing whitespace on rows.
- Header row (`S.No  Product Category  Product Name  Base/Color Shade  Pack Size  Price (Excl. GST)`) — skip.
- Trailing T&C section starting `"Terms and Conditions"` — terminate parsing.

## Components

### Parser: `parseBirlaOpusTabular(text)` in `services/price-list-parser.js`

Pure function. Returns `Array<{ product, packSize, dpl, category, brand, baseCode }>`.

Steps:
1. Split into lines, drop blanks.
2. Skip header rows; stop at `"Terms and Conditions"`.
3. For each line, split on tabs first, fall back to 2+ spaces. Trim trailing whitespace.
4. Normalize columns:
   - **Category** — keep as-is (e.g. `"Interior Luxury"`); the matcher will map tier→canonical via the existing `TIER_TO_CAT` map in `routes/zoho.js`.
   - **Product** — extract trailing `(NNNNNN)` SKU code into `baseCode`; trim from product string.
   - **Shade** — keep as-is. If 5-column row, inherit last shade for this product. `"No Base/Others"` → empty.
   - **Pack size** — normalize: `L` capital, `ml` lower, `kg` lower (`25KG` → `25kg`, etc.).
   - **Price** — strip commas, parse float, reject ≤ 0.
5. Build product label: `"<Product> - <Shade>"` (matches existing `parseBirlaOpus` output convention at `services/price-list-parser.js:235`). Skip dash if shade is empty.
6. Emit one flat row per parsed line.

Shape matches the `cleanItems` rows that `routes/zoho.js:5142-5169` produces from the PDF/AI flow, so it plugs straight into `matchWithZohoItems`.

### Backend: `POST /api/zoho/parse-pasted-dpl` in `routes/zoho.js`

- **Auth**: `requireAdmin`.
- **Body**: `{ brand: 'birlaopus', text: '<pasted-table>' }`.
- **Validation**: reject if brand !== `'birlaopus'` (`501 Not Implemented` with hint to use PDF mode).
- **Synchronous response** — no job queue. Pasted text is small (≤ ~300KB worst case); parse + DB query + match completes in <1s.

Flow:
1. `parseBirlaOpusTabular(text)` → `cleanItems[]`.
2. Fetch active Zoho items (same query as `routes/zoho.js:5172-5180`).
3. `priceListParser.matchWithZohoItems(cleanItems, zohoItems)` → `{ matched, unmatched }`.
4. Build `itemsOut` (same shape as `routes/zoho.js:5192-5225`).
5. Build `zohoItemsOut` with same-brand filter (same code as `routes/zoho.js:5229-5255`).
6. Return:
   ```json
   {
     "brand": "birlaopus",
     "totalExtracted": <number>,
     "autoMatched": <number>,
     "needsReview": <number>,
     "items": [...],
     "zohoItems": [...],
     "source": { "type": "pasted-text", "lines": <input-line-count> }
   }
   ```

### Frontend: `public/admin-dpl.html`

Step 2 input section gets two tabs:
- **Upload PDF** (default, current dropzone unchanged).
- **Paste Text** — `<textarea>` (10-15 rows tall) + live "Lines detected" counter + "Parse Pasted Text" button.

Behavior:
- Brand must be selected first (existing brand-card UI from step 1).
- For v1, only `birlaopus` is supported; other brands disable the paste tab with tooltip "Coming soon for other brands".
- "Parse Pasted Text" → `POST /api/zoho/parse-pasted-dpl` (synchronous — no polling, unlike the PDF endpoint which uses a job queue).
- On success, the response body is fed directly into the same state slot the PDF flow populates after polling completes (the `items` / `zohoItems` / `autoMatched` / `needsReview` fields). Step 3 onward runs unchanged.
- Step 3 review header gets a small badge: `Source: Pasted text` (vs. existing implicit `Source: PDF (filename.pdf)`).

Mobile: tabs stack vertically; textarea grows to viewport.

## Tests

New file: `tests/unit/dpl-tabular-parser.test.js`. Cases:
1. **Happy path** — single full row → expected `cleanItems` shape (product label, packSize, dpl, category, brand, baseCode).
2. **Shade inheritance** — 5-column row inherits shade from previous row for the same product.
3. **Comma price** — `"1,930"` parses to `1930`.
4. **Trailing whitespace** — rows with trailing spaces parse identically to clean rows.
5. **Header row** — first-row column-name line is skipped.
6. **T&C terminator** — content after `"Terms and Conditions"` is ignored.
7. **Empty input** — empty/whitespace-only text returns empty array.
8. **Pack size normalization** — `25KG` → `25kg`, `200 ml` → `200ml`, `0.9L` → `0.9L`.
9. **Empty/`No Base/Others` shade** — produces product without trailing dash-shade.

Manual verification on user's full pasted Birla Opus dataset (1248 rows): every row produces a `cleanItems` entry with non-zero dpl, totalExtracted matches input row count modulo skipped headers/T&C lines.

## Out-of-Scope (Future Work)

- Tabular parsers for other brands (Asian/Berger/JSW/Nippon) — separate spec per brand.
- Spreadsheet-file upload (.xlsx/.csv) — current scope is paste-only.
- Persisting pasted text in the audit trail — out of scope; existing DPL change audit (the `dpl_updated_at` column on `zoho_items_map`) is sufficient.

## File Touch List

- `services/price-list-parser.js` — add `parseBirlaOpusTabular`, export it.
- `routes/zoho.js` — add `POST /api/zoho/parse-pasted-dpl`.
- `public/admin-dpl.html` — add Paste Text tab in step 2 + handler JS.
- `tests/unit/dpl-tabular-parser.test.js` — new.

No DB migrations. No config changes.
