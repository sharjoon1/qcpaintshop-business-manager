# Estimate Catalog Manager — Design Document

**Date:** 2026-02-28
**Status:** Approved

## Problem

1. Painter estimate create page shows ALL Zoho Books items instead of curated products
2. Brands/categories show all Zoho data instead of curated subset
3. Mobile layout has horizontal overflow
4. Referral code sharing doesn't work (silent failure)

## Solution Overview

### 1. Zoho Mapping on Pack Sizes

Add `zoho_item_id` column to `pack_sizes` table to map each product variation to a Zoho Books item.

**Schema change:**
```sql
ALTER TABLE pack_sizes ADD COLUMN zoho_item_id VARCHAR(100) NULL;
ALTER TABLE pack_sizes ADD INDEX idx_zoho_item (zoho_item_id);
```

### 2. Admin Products Page — Zoho Mapping UI

In `admin-products.html`, when editing/creating a product's pack sizes, each variation gets a searchable dropdown to select the corresponding Zoho item from `zoho_items_map`.

**Flow:**
- Admin creates product: "Asian Paints Apex Emulsion" (area_wise)
- Adds pack sizes: 1L, 4L, 10L, 20L
- For each pack size, selects the matching Zoho item from dropdown
- Dropdown is searchable, shows: item name + brand + rate

### 3. Painter Estimate Create Page — Grouped Products

Replace the flat Zoho items list with grouped products from `products` + `pack_sizes` tables.

**New endpoint:** `GET /api/painters/me/estimates/catalog`

Returns:
```json
{
  "products": [
    {
      "id": 1,
      "name": "Asian Paints Apex Emulsion",
      "brand": "Asian Paints",
      "category": "Interior Emulsion",
      "product_type": "area_wise",
      "area_coverage": 120,
      "pack_sizes": [
        { "id": 1, "size": 1, "unit": "L", "rate": 245, "zoho_item_id": "12345", "stock": 50 },
        { "id": 2, "size": 4, "unit": "L", "rate": 980, "zoho_item_id": "12346", "stock": 30 },
        { "id": 3, "size": 10, "unit": "L", "rate": 2450, "zoho_item_id": "12347", "stock": 15 },
        { "id": 4, "size": 20, "unit": "L", "rate": 4900, "zoho_item_id": "12348", "stock": 8 }
      ]
    }
  ],
  "brands": ["Asian Paints", "Berger"],
  "categories": ["Interior Emulsion", "Exterior"]
}
```

**UI:** Products shown as cards with size chips. Tap a size chip to add to cart. Cart tracks by pack_size_id (which carries the zoho_item_id for invoice creation).

**Filters:** Brands and categories come from `brands`/`categories` tables (only those with active mapped products), NOT from zoho_items_map.

### 4. Mobile Layout Fix

- Add `overflow-x: hidden` on body
- Add `max-width: 100vw` on main container
- Verify filter selects have `min-width: 0`

### 5. Referral Share Fix

Current code uses `navigator.share()` with empty catch — silent failure on Android WebView.

**Fix — Fallback chain:**
1. `navigator.share()` — native share dialog
2. If fails → `navigator.clipboard.writeText()` + toast
3. If fails → show referral text in a copyable modal with WhatsApp deep link button

### 6. Data Flow for Estimate Submission

When painter submits estimate:
- Cart items reference `pack_size_id`
- Backend looks up `pack_sizes.zoho_item_id` for each item
- Uses `zoho_items_map` rate (server-side) for pricing
- Stores in `painter_estimate_items` with zoho_item_id
- Zoho push uses the mapped zoho_item_id to create invoice line items

### 7. Admin Tab 7 — "Estimate Catalog" in admin-painters.html

Quick overview showing:
- Count of mapped products (e.g., "45 products, 156 variations mapped")
- Link to admin-products.html for actual product management
- This keeps product management centralized in admin-products.html
