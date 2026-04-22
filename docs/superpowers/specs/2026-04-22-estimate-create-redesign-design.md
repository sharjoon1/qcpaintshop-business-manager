# Estimate Create Page Redesign

**Date:** 2026-04-22
**Status:** Approved

## Overview

Rebuild `estimate-create-new.html` as a split-panel UI with full Zoho customer and product access. Both admin and staff use this page. The new design eliminates the 3-step Brand→Category→Product drill-down, replaces upfront bulk loading with fast server-side search, and gives staff a live estimate panel that is always visible while they pick products.

## Goals

- Access all Zoho active products directly from `zoho_items_map`
- Access all Zoho contacts merged with local customers
- Live estimate panel always visible (desktop: right panel; mobile: default view)
- Mobile-first responsive design with bottom drawer for product picker
- No `zoho.view` permission required — works for both admin and staff with `requireAuth`

## Layout

### Desktop (≥ 768px)

Two-column layout, both panels independently scrollable:

- **Left panel (400px fixed):** Customer search + product search + area calculator
- **Right panel (flex-1):** Estimate items + labor + totals + save button pinned at bottom

### Mobile (< 768px)

- Default view: estimate items panel
- "Add Product" button fixed at bottom → slides up a bottom drawer (70vh, swipe down to close)
- Customer search at top of main view
- Save button fixed at very bottom of screen

---

## Backend — New Endpoints

All three endpoints added to `routes/estimates.js`. Auth: `requireAuth` only (no `zoho.view`).

### GET /api/estimates/search-customers

**Purpose:** Merged, deduped customer search across Zoho contacts and local customers.

**Query params:**
- `q` (string, min 2 chars) — searches name, phone, email

**Logic:**
1. Query `zoho_customers_map` WHERE name/phone/email LIKE `%q%`
2. Query `customers` WHERE name/phone/email LIKE `%q%`
3. Merge results; where a Zoho contact has `local_customer_id`, collapse into one result (Zoho contact preferred, local data as fallback)
4. Return max 10 results ordered by name

**Response shape per result:**
```json
{
  "id": "zoho_contact_id or local customers.id",
  "name": "string",
  "phone": "string",
  "email": "string",
  "address": "string",
  "source": "zoho | local | both",
  "zoho_contact_id": "string | null",
  "local_customer_id": "number | null"
}
```

**No-query behaviour:** Returns last 5 recently used customers (stored in `localStorage` on client, no server query needed).

---

### GET /api/estimates/search-products

**Purpose:** Search Zoho active items with optional brand/category filter.

**Query params:**
- `q` (string) — searches `zoho_item_name`, `zoho_sku`, `zoho_brand`, `zoho_category_name`
- `brand` (string, optional) — exact match on `zoho_brand`
- `category` (string, optional) — exact match on `zoho_category_name`
- `page` (int, default 1)

**Logic:**
```sql
SELECT zim.zoho_item_id, zim.zoho_item_name, zim.zoho_brand, zim.zoho_category_name,
       zim.zoho_rate, zim.zoho_unit, zim.zoho_stock_on_hand,
       p.area_coverage, p.product_type, p.id as local_product_id
FROM zoho_items_map zim
LEFT JOIN pack_sizes ps ON ps.zoho_item_id = zim.zoho_item_id AND ps.is_active = 1
LEFT JOIN products p ON p.id = ps.product_id AND p.status = 'active'
WHERE (zim.zoho_status = 'active' OR zim.zoho_status IS NULL)
  [AND filters...]
ORDER BY zim.zoho_item_name ASC
LIMIT 20 OFFSET ?
```
- Return 20 results per page

**Response shape per result:**
```json
{
  "zoho_item_id": "string",
  "name": "string",
  "brand": "string",
  "category": "string",
  "rate": 6250.00,
  "unit": "Nos",
  "stock_on_hand": 12,
  "area_coverage": 12.5,
  "local_product_id": 42,
  "has_area_calc": true
}
```

`has_area_calc` is `true` when `area_coverage > 0` (from `products.area_coverage` via local product mapping).
`local_product_id` is used by the client to fetch sibling pack sizes for multi-pack area combo.

---

### GET /api/estimates/filter-options

**Purpose:** Returns distinct brands and categories for filter chips. In-memory cached for 5 minutes.

**Response:**
```json
{
  "brands": ["Asian Paints", "Berger", "Nerolac"],
  "categories": ["Interior", "Exterior", "Primer", "Wood"]
}
```

---

## Frontend — Customer Search Component

**Behaviour:**
- On input focus: show last 5 recent customers from `localStorage` key `est_recent_customers` (no API call)
- After 2+ chars typed: debounced 300ms → `GET /api/estimates/search-customers?q=`
- Results show: name + phone + badge (`Zoho` green / `Local` blue / `Both` purple)
- On select: display customer card (name, phone, email, address) below search bar; store in `localStorage` recent list
- "New Customer" button opens existing `newCustomerModal`

**Selected customer card fields:** name, phone, email, address, Zoho badge if linked.

---

## Frontend — Product Search Component

**Behaviour:**
- Single search input: debounced 400ms → `GET /api/estimates/search-products?q=&brand=&category=`
- Brand + category filter chips loaded once from `/api/estimates/filter-options` on page load
- Active chip filters apply on every search
- Results list (scrollable, max 70vh): each row shows name, brand, rate, stock badge
  - Green badge: stock > 0
  - Red badge: stock = 0 (still addable)

**Product row — expand on tap:**
- Inline unit/area mode toggle (radio)
- **Unit mode:** inline +/− qty buttons (min 1), "Add to Estimate" CTA
- **Area mode** (only shown when `has_area_calc = true`):
  - Sqft input + Coats input (default 2)
  - Auto-calculates: `liters_needed = (sqft × coats) / area_coverage`
  - **If `local_product_id` exists:** fetch sibling pack sizes via `GET /api/products/:local_product_id` and suggest a greedy multi-SKU combo (largest pack first) — e.g., "→ 31.25L → 1 × 20L + 1 × 10L". "Add to Estimate" adds all suggested packs as separate line items, each with its own Zoho item rate.
  - **If no `local_product_id`:** single-item mode — shows "→ need 31.25L → use 2 × [this item]". "Add to Estimate" adds N units of the selected Zoho item.
  - Shows area-calc result clearly before the Add button

---

## Frontend — Estimate Items Panel

**Layout:** Card-per-item (not a table) for mobile compatibility.

**Each item card shows:**
- Product name, quantity, unit price, line total
- Tap to expand: inline markup (% or ₹) and discount (% or ₹) inputs
- Remove button (×)

**Controls at top of panel:**
- Overall markup strip: type selector (% / ₹) + value + Apply / Clear
- Overall discount strip: type selector (% / ₹) + value + Apply / Clear
- ⚙ icon → column visibility menu (image, pack size, area, mix info, etc.) — hidden by default on mobile

**Labor charges:**
- "Add Labor" button → adds a row with description + amount inputs
- Labor total shown separately, included in grand total

**Totals (pinned bottom on mobile, bottom of panel on desktop):**
- Subtotal
- Grand Total (all prices inclusive of GST, note shown)
- Save Estimate button

---

## Save Flow

1. Validate: customer selected and at least 1 item added; show inline error if not
2. POST to existing `POST /api/estimates` with same payload shape as current page
3. On success → show success modal overlay:
   - ✅ "Estimate #EST-XXXX Saved!"
   - Grand total
   - "Send to [Customer] on WhatsApp" button (green, calls existing `/api/estimates/:id/send-whatsapp`)
   - "View Estimate →" button (navigates to estimate detail page)
4. Modal has no auto-close; staff must choose an action

---

## Pricing / Markup Logic

Preserved from current implementation:
- `calcMarkup(basePrice, qty, markupType, markupValue)` — supports `price_pct`, `price_value`
- `calcDiscount(priceAfterMarkup, qty, discountType, discountValue)`
- `recalcItem(item)` — final price rounded up to nearest ₹10
- Overall markup/discount applied to all items; per-item overrides per-item

---

## State Management

All client state is plain JS variables (matching current pattern):
```
selectedCustomer     — null or customer object
estimateItems        — array of item objects
laborItems           — array of labor objects
filterOptions        — { brands[], categories[] }
activeFilters        — { brand: '', category: '' }
columnVisibility     — persisted to localStorage (existing key est_column_prefs)
recentCustomers      — persisted to localStorage (key est_recent_customers, max 5)
```

---

## What Is NOT Changed

- `POST /api/estimates` payload shape — no backend changes to save logic
- Existing `newCustomerModal` HTML and `createCustomer()` function
- WhatsApp send endpoint (`/api/estimates/:id/send-whatsapp`)
- Markup/discount calculation functions
- Column visibility localStorage key
- PDF generation routes

---

## Files Changed

| File | Change |
|------|--------|
| `routes/estimates.js` | Add 3 new GET endpoints |
| `public/estimate-create-new.html` | Full rebuild of HTML + JS |

No new tables, no migrations, no new services.
