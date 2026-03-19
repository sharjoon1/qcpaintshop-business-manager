# Estimate Pricing & Description Enhancements — Design Spec

**Date:** 2026-03-19
**Page:** `estimate-create-new.html` (admin only)
**Status:** Approved

## Overview

Enhance the admin estimate creation page with per-product markup, discount, labor charges, editable descriptions, and a "show description only" toggle. Extends the existing `estimates` + `estimate_items` tables via ALTER TABLE migration. `painter_estimates` untouched.

## Decisions

- **Calculation order:** Markup first, then discount on marked-up price
- **Scope:** Admin page only; backend is admin-only for now
- **Labor:** Separate line items in the same `estimate_items` table with `item_type='labor'`
- **Descriptions:** Plain text with line breaks (no rich text)
- **Show Description Only:** Global toggle + per-product override (NULL = follow global)
- **GST:** Prices inclusive — `gst_amount = 0`, `grand_total = subtotal + labor`
- **Architecture:** ALTER existing `estimates` + `estimate_items` tables; `painter_estimates` untouched
- **Estimate number format:** Keep existing `ESTYYYYMMDDNNNN` (no dashes, 4-digit sequence)
- **Customer ID:** Keep existing `customers.id` FK; also add `customer_name/phone/address` fields (already in server.js, not in original schema)

## Existing Schema (Current State)

### `estimates` table (live columns used by server.js)
```
id, estimate_number, customer_name, customer_phone, customer_address,
estimate_date, valid_until, subtotal, gst_amount, grand_total,
show_gst_breakdown, column_visibility, notes, status, created_by,
created_at, updated_at
```
Note: `customer_id` exists in original schema but server.js currently stores customer data as flat strings.

### `estimate_items` table (live columns used by server.js)
```
id, estimate_id, product_id, image_url, item_description,
quantity, area, mix_info, unit_price, breakdown_cost, color_cost,
line_total, display_order
```

## Migration Strategy (ALTER TABLE)

### `estimates` — ADD columns

| Column | Type | Notes |
|--------|------|-------|
| total_markup | DECIMAL(12,2) DEFAULT 0 | Sum of all markup amounts |
| total_discount | DECIMAL(12,2) DEFAULT 0 | Sum of all discount amounts |
| total_labor | DECIMAL(12,2) DEFAULT 0 | Sum of all labor items |
| show_description_only | TINYINT DEFAULT 0 | Global toggle |
| admin_notes | TEXT | |
| branch_id | INT NULL | FK branches.id (if not already present) |

Keep existing: `estimate_number`, `customer_name/phone/address`, `estimate_date`, `valid_until`, `subtotal`, `gst_amount`, `grand_total`, `show_gst_breakdown`, `column_visibility`, `notes`, `status`, `created_by`, timestamps.

Existing estimates remain valid — new columns default to 0/NULL.

### `estimate_items` — ADD columns

| Column | Type | Notes |
|--------|------|-------|
| item_type | ENUM('product','labor') DEFAULT 'product' | Existing rows default to 'product' |
| zoho_item_id | VARCHAR(100) NULL | |
| item_name | VARCHAR(255) NULL | Display name |
| brand | VARCHAR(100) NULL | |
| category | VARCHAR(100) NULL | |
| pack_size | VARCHAR(50) NULL | |
| product_type | ENUM('unit','area') NULL | |
| custom_description | TEXT NULL | Plain text, line breaks |
| show_description_only | TINYINT NULL | NULL=use global, 0/1=override |
| num_coats | INT DEFAULT 1 | |
| base_price | DECIMAL(12,2) NULL | Original unit price (before markup) |
| markup_type | ENUM('price_pct','price_value','total_pct','total_value') NULL | |
| markup_value | DECIMAL(12,2) DEFAULT 0 | User-entered value |
| markup_amount | DECIMAL(12,2) DEFAULT 0 | Calculated markup in ₹ |
| price_after_markup | DECIMAL(12,2) NULL | base_price + markup |
| discount_type | ENUM('price_pct','price_value','total_pct','total_value') NULL | |
| discount_value | DECIMAL(12,2) DEFAULT 0 | User-entered value |
| discount_amount | DECIMAL(12,2) DEFAULT 0 | Calculated discount in ₹ |
| final_price | DECIMAL(12,2) NULL | After markup then discount |
| labor_description | VARCHAR(255) NULL | For labor items |
| labor_taxable | TINYINT DEFAULT 1 | For labor items |

Keep existing: `id`, `estimate_id`, `product_id`, `image_url`, `item_description`, `quantity`, `area`, `mix_info`, `unit_price`, `breakdown_cost`, `color_cost`, `line_total`, `display_order`.

For existing rows: `base_price` = `unit_price`, `final_price` = `unit_price`, `item_type` = 'product'.

### Indexes to add
- `estimates`: `INDEX idx_branch (branch_id)`
- `estimate_items`: none needed (already has `idx_estimate`)

## Calculation Logic

### Per Product Item

```
Markup (applied to base_price):
  price_pct:    markup_amount = base_price * markup_value / 100
  price_value:  markup_amount = markup_value
  total_pct:    markup_amount = (base_price * quantity) * markup_value / 100 / quantity
  total_value:  markup_amount = markup_value / quantity

  price_after_markup = base_price + markup_amount

Discount (applied to price_after_markup):
  price_pct:    discount_amount = price_after_markup * discount_value / 100
  price_value:  discount_amount = discount_value
  total_pct:    discount_amount = (price_after_markup * quantity) * discount_value / 100 / quantity
  total_value:  discount_amount = discount_value / quantity

  final_price = price_after_markup - discount_amount
  line_total = final_price * quantity
```

Note: `total_pct` simplifies to `base_price * pct / 100` (same as `price_pct`). Both are kept in the UI for clarity — users think of "10% on total" differently than "10% on price" even though the math is identical for percentage. The distinction only matters for `total_value` vs `price_value`.

### Labor Items

```
line_total = base_price * quantity
```

### Estimate Totals

```
subtotal       = sum of product line_totals
total_markup   = sum of (product markup_amount * quantity)
total_discount = sum of (product discount_amount * quantity)
total_labor    = sum of labor line_totals
gst_amount     = 0 (prices inclusive)
grand_total    = subtotal + total_labor
```

## UI Design

### Product Row Structure

```
+-------------------------------------------------------------+
| [Image] Product Name                          [Edit Desc]    |
|         Custom description text here...                      |
|         [Toggle: Show Name / Description Only]               |
|                                                              |
|  Base: Rs.1,000    [+ Markup v]  [- Discount v]             |
|  Markup: +10% -> +Rs.100     Discount: -5% -> -Rs.55        |
|  Final Price: Rs.1,045  x  Qty: 2  =  Rs.2,090              |
+-------------------------------------------------------------+
```

Markup/Discount dropdowns show 4 options each (price_pct, price_value, total_pct, total_value) with a value input. Real-time calculation preview.

### Labor Charges Section

Below products table:

```
+- Labor Charges ----------------------------------------------+
|  [+ Add Labor Item]                                          |
|  1. Installation charges          Rs.500    [Taxable Y]  [x] |
|  2. Surface preparation           Rs.1,200  [Taxable Y]  [x] |
|  Labor Total: Rs.1,700                                        |
+--------------------------------------------------------------+
```

### Summary Section

```
+- Estimate Summary -------------------------------------------+
|  Subtotal (products):               Rs.10,000                |
|  Total Markup:                      +Rs.1,200                |
|  Total Discount:                    -Rs.550                  |
|  Labor Charges:                     +Rs.1,700                |
|  ------------------------------------------                  |
|  GRAND TOTAL:                       Rs.12,350                |
|  (Prices inclusive of GST)                                   |
|                                                              |
|  [x Show Description Only (all items)]                       |
+--------------------------------------------------------------+
```

## API Design

### Routes — Extract to `routes/estimates.js`

Existing inline routes in `server.js` (lines 3116-3337) will be extracted to `routes/estimates.js` and enhanced with the new fields. Endpoints remain the same:

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | /api/estimates | Create estimate (enhanced payload) |
| GET | /api/estimates | List estimates |
| GET | /api/estimates/:id | Get estimate with items |
| PUT | /api/estimates/:id | Update estimate (enhanced payload) |
| DELETE | /api/estimates/:id | Delete draft only |
| GET | /api/estimates/:id/items | Get items only |
| GET | /api/estimates/:id/history | Get estimate history |
| PUT | /api/estimates/:id/status | Change status (new) |
| GET | /api/estimates/:id/pdf | Generate PDF (integrate existing PDF route) |

### Request Payload (Create/Update)

```json
{
  "customer_name": "Name",
  "customer_phone": "9876543210",
  "customer_address": "Address",
  "estimate_date": "2026-03-19",
  "valid_until": "2026-04-19",
  "branch_id": 1,
  "show_description_only": false,
  "show_gst_breakdown": false,
  "column_visibility": "{}",
  "notes": "...",
  "items": [
    {
      "item_type": "product",
      "product_id": 45,
      "zoho_item_id": "ZI-001",
      "item_name": "Berger Wall Paint 4L",
      "image_url": "/images/...",
      "item_description": "Paint description",
      "brand": "Berger",
      "category": "Interior",
      "pack_size": "4L",
      "product_type": "unit",
      "custom_description": "Premium interior finish\nWhite base coat",
      "show_description_only": null,
      "quantity": 2,
      "area": null,
      "num_coats": 1,
      "base_price": 1000,
      "unit_price": 1000,
      "markup_type": "price_pct",
      "markup_value": 10,
      "discount_type": "price_pct",
      "discount_value": 5,
      "mix_info": null,
      "breakdown_cost": null,
      "color_cost": 0,
      "display_order": 0
    },
    {
      "item_type": "labor",
      "item_name": "Installation charges",
      "labor_description": "Installation charges",
      "base_price": 500,
      "quantity": 1,
      "labor_taxable": true,
      "display_order": 1
    }
  ]
}
```

Backend calculates: `markup_amount`, `price_after_markup`, `discount_amount`, `final_price`, `line_total`, and all estimate totals (`subtotal`, `total_markup`, `total_discount`, `total_labor`, `grand_total`).

## File Changes

### New Files
- `migrations/migrate-estimate-enhancements.js` — ALTER TABLE migration
- `routes/estimates.js` — extracted + enhanced estimate routes

### Modified Files
- `public/estimate-create-new.html` — enhanced UI with markup/discount/labor/description
- `server.js` — remove inline estimate routes, mount `routes/estimates.js`

### Untouched
- `painter_estimates` / `painter_estimate_items` tables
- `routes/painters.js` — painter estimate flow unchanged
- `public/painter-estimate-create.html`
