# Item Master Management — Design Spec

**Date:** 2026-04-07
**Status:** Approved
**Scope:** New admin page for managing Zoho Books items — naming, SKU, DPL pricing, and NotebookLM integration

---

## 1. Problem

Zoho Books items have inconsistent names, missing SKUs, and no standardized pricing flow. When brands release new DPL (Dealer Price List) PDFs, updating purchase cost and sales price across hundreds of items is manual and error-prone. There is no single place to manage item master data, track price changes, or validate data quality.

## 2. Solution

A new `admin-item-master.html` page with 5 tabs covering the complete item lifecycle:

1. **Items List** — Browse, filter, edit, and standardize all Zoho items
2. **DPL Import** — Upload brand DPL PDFs, query NotebookLM, parse and match prices
3. **Price Calculator** — Auto-calculate Purchase Cost and Sales Price from DPL
4. **Price History** — Track all price changes over time per brand/item
5. **Health Check** — Scan and fix data quality issues (missing SKU, bad names, price mismatches)

## 3. Item Naming Convention

### Standard Format

```
ITEM NAME:   {CAT_CODE}{SIZE} {PRODUCT_SHORT}{BASE/COLOR} {FULL_PRODUCT_NAME} {SIZE} L
DESCRIPTION: {CATEGORY} {BRAND} {SIZE} L ({PRODUCT_SHORT}{BASE/COLOR})
SKU:         {PRODUCT_SHORT}{BASE/COLOR}{SIZE}  (6-8 chars)
```

### Category Codes

| Code | Category           | Code | Category              |
|------|--------------------|------|-----------------------|
| `IP` | Interior Primer    | `EP` | Exterior Primer       |
| `IE` | Interior Emulsion  | `EE` | Exterior Emulsion     |
| `EN` | Enamel             | `WF` | Wood Finish           |
| `WP` | Waterproofing      | `DT` | Distemper             |
| `PT` | Putty              | `ST` | Stainer/Colorant      |
| `TH` | Thinner            | `TA` | Tools & Accessories   |
| `FL` | Floor Coating      | `SP` | Spray Paint           |
| `MP` | Metal Primer       | `AD` | Adhesive              |

### Size Padding

All sizes are zero-padded to 2 digits: `01`, `04`, `10`, `20`. This ensures consistent sorting and SKU length.

### Base Notation

- Emulsions have color bases: `1`, `2`, `3`, `4` — direct number in SKU, no `B` prefix
- Enamels have colors: `BL` (Black), `WH` (White), `RD` (Red), etc.
- Primers, thinners, tools: no base/color

### Examples

| Brand | Category | Product | Base | Size | Item Name | Description | SKU |
|-------|----------|---------|------|------|-----------|-------------|-----|
| Birla Opus | Ext. Primer | Perfect Start Primer | — | 01 L | `EP01 PSP PERFECT START PRIMER 01 L` | `EXTERIOR PRIMER BIRLA OPUS 01 L (PSP)` | `PSP01` |
| Birla Opus | Ext. Emulsion | Power Bright | 1 | 01 L | `EE01 PB1 POWER BRIGHT EXT EMULSION 01 L` | `EXTERIOR EMULSION BIRLA OPUS 01 L (PB1)` | `PB101` |
| Birla Opus | Ext. Emulsion | Power Bright | 3 | 04 L | `EE04 PB3 POWER BRIGHT EXT EMULSION 04 L` | `EXTERIOR EMULSION BIRLA OPUS 04 L (PB3)` | `PB304` |
| Birla Opus | Enamel | Cover Max Black | BL | 01 L | `EN01 CMBL COVER MAX ENAMEL BLACK 01 L` | `ENAMEL BIRLA OPUS 01 L (CMBL)` | `CMBL01` |
| Asian Paints | Int. Emulsion | Royale Luxury | 1 | 04 L | `IE04 RL1 ROYALE LUXURY EMULSION 04 L` | `INTERIOR EMULSION ASIAN PAINTS 04 L (RL1)` | `RL104` |
| Berger | Ext. Emulsion | Weather Coat | 2 | 10 L | `EE10 WC2 WEATHER COAT EXT EMULSION 10 L` | `EXTERIOR EMULSION BERGER 10 L (WC2)` | `WC210` |

## 4. Pricing Formula

```
Purchase Cost = DPL (Dealer Price)
Sales Price   = Math.ceil(DPL * 1.18 * 1.10) = Math.ceil(DPL * 1.298)
```

- 1.18 = 18% GST
- 1.10 = 10% margin
- `Math.ceil()` = round up to nearest rupee

**Example:** DPL = ₹285 → Purchase = ₹285 → Sales = ceil(285 × 1.298) = ceil(369.93) = **₹370**

## 5. Database Schema

### New Table: `item_naming_rules`

Stores product-level naming rules for auto-generating Item Name, Description, and SKU.

```sql
CREATE TABLE item_naming_rules (
    id INT PRIMARY KEY AUTO_INCREMENT,
    brand VARCHAR(100) NOT NULL,
    category VARCHAR(100) NOT NULL,
    category_code VARCHAR(5) NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    product_short VARCHAR(10) NOT NULL,
    has_base BOOLEAN DEFAULT false,
    has_color BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY unique_brand_product (brand, product_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### New Table: `dpl_versions`

Tracks uploaded DPL PDFs per brand with NotebookLM references.

```sql
CREATE TABLE dpl_versions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    brand VARCHAR(100) NOT NULL,
    version_label VARCHAR(50),
    effective_date DATE NOT NULL,
    pdf_path VARCHAR(500),
    notebooklm_notebook_id VARCHAR(100),
    total_items INT DEFAULT 0,
    matched_items INT DEFAULT 0,
    status ENUM('draft','active','archived') DEFAULT 'draft',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_brand (brand),
    INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

### New Table: `dpl_price_history`

Logs every price change for audit trail and timeline views.

```sql
CREATE TABLE dpl_price_history (
    id INT PRIMARY KEY AUTO_INCREMENT,
    zoho_item_id VARCHAR(100) NOT NULL,
    dpl_version_id INT,
    old_dpl DECIMAL(10,2),
    new_dpl DECIMAL(10,2),
    old_purchase_rate DECIMAL(10,2),
    new_purchase_rate DECIMAL(10,2),
    old_sales_rate DECIMAL(10,2),
    new_sales_rate DECIMAL(10,2),
    changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    changed_by INT,
    FOREIGN KEY (dpl_version_id) REFERENCES dpl_versions(id),
    INDEX idx_item (zoho_item_id),
    INDEX idx_version (dpl_version_id),
    INDEX idx_changed_at (changed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

## 6. Backend API

### Route File: `routes/item-master.js`

**Items Group (4 endpoints):**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/item-master/items` | List items with filters: brand, category, base, size, status, search. Paginated (50/page). Reads from `zoho_items_map`. |
| `GET` | `/api/item-master/items/:id` | Single item detail with naming rule and price history. |
| `GET` | `/api/item-master/summary` | Summary cards: total items, DPL set count, missing DPL, no SKU, brand count. |
| `POST` | `/api/item-master/items/bulk-edit` | Bulk update item_name, description, SKU, brand, category for selected `zoho_item_id[]`. Queues Zoho sync. |

**Naming Group (3 endpoints):**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/item-master/naming-rules` | List all naming rules. Filter by brand. |
| `POST` | `/api/item-master/naming-rules` | Create or update a naming rule (upsert on brand+product_name). |
| `DELETE` | `/api/item-master/naming-rules/:id` | Delete a naming rule. |
| `POST` | `/api/item-master/generate-names` | Auto-generate item_name + description + SKU for given `zoho_item_id[]` using naming rules. Returns preview (old vs new). Does not apply until confirmed. |

**DPL Group (5 endpoints):**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/item-master/dpl-versions` | List DPL versions per brand. |
| `POST` | `/api/item-master/dpl-versions` | Upload new DPL PDF. Stores file to `uploads/dpl-pdfs/{brand}/{filename}`, creates version record. |
| `POST` | `/api/item-master/dpl-parse` | Parse uploaded PDF → extract product names and prices. Uses existing `price-list-parser.js`. |
| `POST` | `/api/item-master/dpl-match` | Match parsed items to `zoho_items_map` by name/SKU. Returns matched + unmatched lists. |
| `POST` | `/api/item-master/dpl-apply` | Apply DPL prices: set `zoho_cf_dpl`, calculate `purchase_rate = DPL`, `sales_rate = ceil(DPL * 1.298)`. Logs to `dpl_price_history`. Queues Zoho Books sync. |

**NotebookLM Group (1 endpoint):**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/item-master/dpl-notebooklm` | Query NotebookLM CLI: `notebooklm use {notebook_id} && notebooklm ask "{query}"`. Parse response, match to items. Input: `{ brand, notebook_id, query }`. |

**History & Health Group (3 endpoints):**

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/item-master/price-history` | Price change history with filters: brand, date range, item search. Grouped by DPL version events. |
| `GET` | `/api/item-master/price-history/:itemId` | Single item price timeline (all changes). |
| `GET` | `/api/item-master/health-check` | Scan all active items. Returns issues grouped by type: missing_sku, bad_name_format, missing_dpl, missing_brand_category, dpl_purchase_mismatch, sales_price_mismatch. Each issue includes item details and suggested fix. |

**Total: 17 endpoints.**

### Auto-Name Generation Logic

```
Input:  zoho_item_id[]
For each item:
  1. Find naming rule by (brand, product_name) from item_naming_rules
  2. If no rule found → skip, flag as "no rule"
  3. Extract size from zoho_item_name (regex: /(\d+)\s*(L|KG|PC|M)/i)
  4. Extract base number if rule.has_base (regex: /base\s*(\d)/i from item name)
  5. Extract color code if rule.has_color (lookup from color map: BLACK→BL, WHITE→WH, RED→RD)
  6. Compose variant = base_number OR color_code OR empty
  7. item_name = "{category_code}{size_padded} {product_short}{variant} {product_name} {size} L"
  8. description = "{category} {brand} {size} L ({product_short}{variant})"
  9. sku = "{product_short}{variant}{size_padded}"
Output: Array of { zoho_item_id, old_name, new_name, old_desc, new_desc, old_sku, new_sku }
```

### DPL Apply Logic

```
Input:  Array of { zoho_item_id, new_dpl }
For each item:
  1. Read current: old_dpl, old_purchase_rate, old_sales_rate from zoho_items_map
  2. Calculate: new_purchase_rate = new_dpl
  3. Calculate: new_sales_rate = Math.ceil(new_dpl * 1.298)
  4. INSERT into dpl_price_history (old values, new values, dpl_version_id)
  5. UPDATE zoho_items_map SET zoho_cf_dpl = new_dpl, zoho_purchase_rate = new_purchase, zoho_rate = new_sales
  6. Queue zoho_bulk_jobs for Zoho Books API sync
Output: { updated: N, history_logged: N, zoho_sync_queued: N }
```

### NotebookLM Integration Logic

```
Input:  { brand, notebook_id, query }
Logic:
  1. Exec: notebooklm use {notebook_id}
  2. Exec: notebooklm ask "{query}" (e.g., "List all products with DPL prices as JSON: product_name, pack_size, dpl_price")
  3. Parse CLI output → extract structured product/price data
  4. Match each to zoho_items_map by product_name + size
  5. Return matched + unmatched items
Output: { matched: [{ zoho_item_id, product, size, dpl }], unmatched: [{ product, size, dpl }] }
```

## 7. Frontend Detail

### File: `public/admin-item-master.html`

**Navigation:** Admin sidebar → Zoho section → "Item Master". `data-page="item-master"`. Permission: `system.zoho`.

### Tab 1: Items List

- **Filter bar:** Brand dropdown, Category dropdown, Base (1/2/3/4/None), Size (01/04/10/20), free-text search, Status filter (Complete/Missing DPL/No SKU/Bad Name)
- **Summary cards (5):** Total Items, DPL Set, Missing DPL, No SKU, Brands — each clickable to apply filter
- **Item table:** Checkbox, Item Name, SKU (monospace), Brand (colored badge), Category, Base (badge), Size, DPL ₹, Purchase ₹, Sales ₹, Status (Complete/No DPL/No SKU+Bad Name)
- **Row highlighting:** White = complete, Yellow (`#fffbeb`) = missing DPL, Red (`#fef2f2`) = no SKU or bad name format
- **Bulk actions bar** (appears when items selected):
  - "Auto-Generate Names" — runs naming rules, shows preview modal (old→new), confirm to apply
  - "Bulk Edit" — modal to set brand/category/base for all selected
- **Click row** → slide-out edit panel: editable Item Name, Description, SKU, Brand, Category, Base, DPL, with live-calculated Purchase + Sales preview
- **Pagination:** 50 items/page

### Tab 2: DPL Import

- **Left: Brand DPL Library**
  - Card per brand: name, latest DPL version + date, item count, NotebookLM status (linked/not linked)
  - Click card → shows version history for that brand
  - "+ Upload New Brand DPL PDF" dashed card at bottom
- **Right: Import Actions**
  - **PDF Upload zone:** Drag-drop or click, accepts PDF files
  - **"Parse PDF & Auto-Match"** button → calls dpl-parse → dpl-match → shows match table
  - **"Query NotebookLM for Prices"** button → opens modal: select brand notebook, enter query, submit → calls dpl-notebooklm → shows match table
- **Match results table:** PDF Product, Matched Zoho Item, Pack Size, New DPL, Current DPL, Confidence %, checkbox
- **Unmatched section:** Collapsible list of PDF items that couldn't match — manual dropdown to pick zoho item

### Tab 3: Price Calculator

- **Formula banner:** `Purchase = DPL | Sales = ceil(DPL × 1.18 × 1.10) = ceil(DPL × 1.298)`
- **Brand filter dropdown**
- **Price table:** Item Name, Current DPL, New DPL (editable input), % Change (↑/↓ colored), Calculated Purchase, Calculated Sales, Apply checkbox
- **Row colors:** Green tint = changed, grey = same
- **Actions:**
  - "Preview All Changes" — summary modal: X items changing, avg % change
  - "Apply & Sync to Zoho" — calls dpl-apply, shows success/error result
- **Manual entry:** Direct type into "New DPL" cell for individual corrections

### Tab 4: Price History

- **Filters:** Brand dropdown, Date range picker, Item search
- **Timeline cards:** One card per DPL update event — "Birla Opus DPL Feb 2025 applied on 2026-04-07 — 423 items updated, avg change +5.2%"
- **Click card** → expands to show all items changed in that event
- **Click item** → price timeline: simple line showing DPL / Purchase / Sales values over time
- **Export:** "Download CSV" button

### Tab 5: Health Check

- **Scan button:** "Run Health Check" → calls health-check endpoint
- **Results grouped by issue type:**
  - Missing SKU — count badge + expandable item list
  - Non-standard name format — items not matching `{CAT_CODE}{SIZE} ...` pattern
  - Missing DPL — active items with no `zoho_cf_dpl` value
  - Missing brand/category — items with empty brand or category
  - DPL ≠ Purchase Cost — `zoho_cf_dpl` differs from `zoho_purchase_rate`
  - Sales price mismatch — `zoho_rate` differs from `ceil(zoho_cf_dpl * 1.298)`
- **Each issue row:** Item name, current value, expected value, "Fix" button
- **Bulk fix buttons:**
  - "Auto-fix name format" → runs generate-names for all non-standard items
  - "Sync Purchase = DPL" → sets purchase_rate = cf_dpl for all mismatched
  - "Recalculate Sales Prices" → recalculates all sales prices from DPL

## 8. NotebookLM Integration Strategy

### Current Notebooks

| Brand | Notebook ID | Content |
|-------|-------------|---------|
| Asian Paints | `42c8513c-...` | DPL + MRP price lists 2025 |
| Berger Paints | `344d312a-...` | DPL June 2025 |
| Birla Opus | `3a7fc9da-...` | DPL Feb 2025 + MRP Mar 2024 |

### Workflow

1. When a brand releases a new DPL PDF → upload to NotebookLM (via `notebooklm source add`) and to `dpl_versions` table
2. From Tab 2, click "Query NotebookLM" → select brand → system asks: "List all products with pack sizes and DPL prices in structured format"
3. Parse NotebookLM response → match to Zoho items → show diff → user approves → apply prices
4. NotebookLM serves as the searchable, queryable archive of all brand price lists

### CLI Commands Used

```bash
notebooklm use {notebook_id}                    # Set active notebook
notebooklm ask "{query}"                        # Query for prices
notebooklm source add {pdf_path}                # Upload new DPL PDF
notebooklm source list                          # List sources in notebook
```

## 9. Existing Code Reuse

| Component | Reuse |
|-----------|-------|
| `services/price-list-parser.js` | PDF parsing for DPL extraction (Tab 2) |
| `routes/zoho.js` bulk-edit endpoints | Reference for Zoho sync pattern |
| `zoho_bulk_jobs` / `zoho_bulk_job_items` tables | Queue Zoho API updates |
| `services/zoho-api.js` item sync | Push updated items to Zoho Books |
| `config/uploads.js` | Multer config for DPL PDF upload |
| `admin-dpl.html` | Reference for match table UI patterns |
| `design-system.css` | Consistent admin styling |

## 10. Files to Create/Modify

### New Files
- `routes/item-master.js` — 16 API endpoints
- `public/admin-item-master.html` — 5-tab frontend page
- `migrations/migrate-item-master.js` — Creates 3 new tables

### Modified Files
- `server.js` — Register `routes/item-master.js` route
- `public/universal-nav-loader.js` — Add "Item Master" to Zoho subnav section
