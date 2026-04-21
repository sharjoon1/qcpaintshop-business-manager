# Color Variants B1 (Web) — Design Spec

## Goal

Add color/shade support to the product catalog. Each (product + color + size) combination maps to one Zoho item with its own stock and price. Colors are extracted automatically from Zoho item names on import, and can be edited manually in the product modal.

## Scope

Web only (backend + admin UI). Android painter catalog is Sub-project B2, built separately after this ships.

## Out of Scope

- Android painter app catalog (B2)
- Color-based filtering or search in the products list
- Color grouping in the Zoho Import tab (existing grouping is by product name only)
- Any changes to the Zoho sync / DPL system

---

## Architecture

### Data Model

One migration adds two nullable columns to the existing `pack_sizes` table:

```sql
ALTER TABLE pack_sizes
  ADD COLUMN color_name VARCHAR(100) NULL,
  ADD COLUMN color_code VARCHAR(20) NULL;
```

- `color_name` — display name used in UI ("White", "Ivory", "Brick Red")
- `color_code` — CSS hex color for swatch rendering ("#FFFFFF", "#F5F0E8")
- Both columns NULL on all existing rows — size-only variants remain fully valid
- No new tables, no FK changes, no breaking migrations

Each `pack_sizes` row represents one (product + size + color) combination. If `color_name IS NULL`, the row is a size-only variant (backward compatible). If `color_name IS NOT NULL`, the row is a color+size combo.

A product can mix color-variants and size-only rows, though in practice a product will have either all-color-variants or no-color-variants.

---

## Color Extraction Service

**File:** `services/color-extractor.js`

Exports one function: `extractColor(itemName) → { colorName, colorCode } | null`

Lookup table of ~30 common paint color names to hex codes:

| Color Name | Hex |
|---|---|
| White | #FFFFFF |
| Off White | #FAF9F6 |
| Ivory | #F5F0E8 |
| Cream | #FDE8CC |
| Beige | #E8D5B0 |
| Wheat | #D4C5A9 |
| Sand | #C8B89A |
| Yellow | #FCD34D |
| Orange | #FB923C |
| Red | #EF4444 |
| Maroon | #7F1D1D |
| Pink | #F9A8D4 |
| Peach | #FBBF9A |
| Brown | #92400E |
| Chocolate | #78350F |
| Green | #22C55E |
| Sage | #C8D8C8 |
| Teal | #0D9488 |
| Blue | #3B82F6 |
| Sky Blue | #7DD3FC |
| Navy | #1E3A5F |
| Grey | #9CA3AF |
| Silver | #D1D5DB |
| Black | #111827 |
| Lilac | #D0C0D8 |
| Lavender | #E0D7F0 |
| Terracotta | #C1440E |
| Rust | #B7410E |

Matching is case-insensitive, word-boundary aware. Multi-word colors ("Off White", "Sky Blue", "Brick Red") are checked before single words to avoid partial matches. Returns `null` if no known color is found in the name.

---

## Backend Changes

### 1. Migration

**File:** `migrations/migrate-pack-sizes-color.js`

Adds `color_name` and `color_code` columns. Idempotent (checks for column existence before altering).

### 2. `POST /api/products/assign-zoho-item`

**File:** `server.js` (~line 2581)

Add optional `color_name`, `color_code` to the request body. Include in the INSERT:

```javascript
const { product_id, zoho_item_id, size, unit, price, color_name, color_code } = req.body;
// color_name and color_code are optional — null if not provided
INSERT INTO pack_sizes (product_id, size, unit, base_price, zoho_item_id, color_name, color_code, is_active)
VALUES (?, ?, ?, ?, ?, ?, ?, 1)
```

### 3. `GET /api/products/:id`

**File:** `server.js` (products section)

Include `color_name`, `color_code` in the pack sizes array returned in the product detail response:

```json
{
  "pack_sizes": [
    { "id": 1, "size": 1, "unit": "L", "base_price": 480, "color_name": "White", "color_code": "#FFFFFF", "zoho_item_id": "..." },
    { "id": 2, "size": 4, "unit": "L", "base_price": 1760, "color_name": "White", "color_code": "#FFFFFF", "zoho_item_id": "..." },
    { "id": 3, "size": 1, "unit": "L", "base_price": 480, "color_name": "Ivory", "color_code": "#F5F0E8", "zoho_item_id": "..." }
  ]
}
```

### 4. `PUT /api/products/:id`

**File:** `server.js` (products section)

When updating pack sizes, accept and persist `color_name`, `color_code` per size row. Existing rows without color remain NULL.

---

## Admin UI Changes

**File:** `public/admin-products.html`

### Product Edit Modal — Pack Sizes Section

Each pack size row in the edit form gets two optional new inputs after the Unit dropdown:

- **Color Name** — text input, placeholder "e.g. White" (optional)
- **Color Swatch** — `<input type="color">` for picking hex, shown as a small circle next to the name input (optional)

If both are blank, `color_name` and `color_code` are sent as `null` (size-only variant).

Display in the pack sizes list: if a pack size has `color_name`, show a small colored circle before the size label: `● White · 1L · ₹480`.

### Zoho Import — Assign Flow Color Pre-fill

When the user clicks "Assign ▾" on a Zoho item row, the confirm dialog pre-fills color from the item name:

1. `openAssignDropdown` calls `extractColorFromName(item.name)` (client-side version of the extraction, same lookup table inlined as a JS object)
2. The confirm dialog shows: *"Add 1L White (#FFFFFF) to '[product name]'?"*
3. The `confirmAssignZohoItem` call sends `color_name` and `color_code` to the endpoint
4. If no color is extracted, the confirm dialog shows: *"Add 1L to '[product name]'?"* — no color fields sent

Client-side color extraction is a JS object constant (same ~30 color map) added to the JS section of `admin-products.html`. No API call needed — purely client-side lookup.

---

## Files Changed

| File | Change |
|---|---|
| `migrations/migrate-pack-sizes-color.js` | New — adds color_name, color_code columns |
| `services/color-extractor.js` | New — color name → hex lookup |
| `server.js` | Update assign-zoho-item INSERT, product GET/:id, product PUT/:id |
| `public/admin-products.html` | Edit modal color inputs + assign flow color pre-fill |

---

## Testing

- Migration is idempotent: run twice, no error
- `extractColor("Ace Exterior White 1L")` → `{ colorName: "White", colorCode: "#FFFFFF" }`
- `extractColor("Bison Guard Grey 4Ltr")` → `{ colorName: "Grey", colorCode: "#9CA3AF" }`
- `extractColor("Premium Emulsion 10L")` → `null`
- `extractColor("Off White Emulsion 4L")` → `{ colorName: "Off White", colorCode: "#FAF9F6" }` (multi-word before single)
- `POST /api/products/assign-zoho-item` with `color_name: "White"` → pack_size row has color_name = "White"
- `POST /api/products/assign-zoho-item` without color → pack_size row has color_name = NULL
- `GET /api/products/:id` → pack_sizes array includes color_name and color_code fields
- Existing pack sizes without color: color_name = null, color_code = null in response
