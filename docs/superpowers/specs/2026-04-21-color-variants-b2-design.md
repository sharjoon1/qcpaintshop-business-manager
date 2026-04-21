# Color Variants B2 (Android) — Design Spec

## Goal

Surface color/shade data in the Android painter catalog. Each (product + color + size) combination is already a separate Zoho item in the backend. B2 makes colors visible in the app: color swatches on product list cards, a color filter strip in the detail sheet, and color labels in the cart.

## Scope

Android painter app only. Backend API changes are limited to adding two columns to existing SELECT queries. No new endpoints, no new tables.

## Out of Scope

- Admin web UI (shipped in B1)
- Color-based search/filter in the catalog filter sheet
- Any changes to the Zoho sync / DPL system

---

## Architecture

### Data Flow

```
painters.js /me/catalog          →  CatalogProduct.packSizes[].colorName/colorCode
painters.js /me/catalog/:id      →  ProductDetail.variants[].colorName/colorCode
CartStore                        →  CartItem.colorName/colorCode
```

Color data originates in `pack_sizes.color_name` / `pack_sizes.color_code` (added in B1). Backend queries already join `pack_sizes`; B2 adds the two columns to both SELECT lists. Android models add nullable fields. UI reads them and renders swatches or skips if null.

---

## Backend Changes

**File:** `routes/painters.js`

### 1. `/me/catalog` pack_sizes sub-query

Find the SELECT inside the catalog list query that fetches pack_sizes per product. Add `ps.color_name` and `ps.color_code` to the column list.

Current columns include: `ps.id AS pack_size_id`, `ps.size`, `ps.unit`, `ps.base_price AS rate`, `ps.zoho_item_id`, `ps.is_active`, stock columns, points columns.

Add: `ps.color_name`, `ps.color_code`

These map to the new `PackSize` fields in the Android DTO.

### 2. `/me/catalog/:productId` variants query

Find the SELECT that fetches variants for a single product detail. Add `ps.color_name`, `ps.color_code` to the column list.

These map to the new `ProductVariant` fields in the Android DTO.

---

## Android Changes

### File: `CatalogApi.kt`

**`PackSize` data class** — add two nullable fields:
```kotlin
@SerializedName("color_name") val colorName: String? = null,
@SerializedName("color_code") val colorCode: String? = null,
```

**`ProductVariant` data class** — add two nullable fields:
```kotlin
@SerializedName("color_name") val colorName: String? = null,
@SerializedName("color_code") val colorCode: String? = null,
```

### File: `CartStore.kt`

**`CartItem` data class** — add two nullable fields:
```kotlin
val colorName: String? = null,
val colorCode: String? = null,
```

All existing `CartItem(...)` call sites pass these as `null` by default (Kotlin default params). The cart creation call site in `CatalogScreen.kt` (where painter taps "Add to Cart") passes `selectedVariant.colorName` and `selectedVariant.colorCode`.

### File: `CatalogScreen.kt` — `ProductFamilyCard`

**Color swatch strip (new):**

When `product.packSizes` contains any entry with `colorName != null`:
- Render a horizontal row of 18dp circle composables below the category label
- Each circle is filled with `Color(android.graphics.Color.parseColor(colorCode))`, with a 1dp `Color(0xFFE2E8F0)` border
- Selected color gets a 2dp `Color(0xFF1B5E3B)` border
- Max 5 swatches shown; if more, show "+N" text label after them
- First color is selected by default on card open

**Variant chip row (updated):**

When a color is selected, the variant chip row (`LazyRow` of size chips) filters to only the `PackSize` entries matching `selectedColorName`. If no color is selected (product has no colors), all pack sizes show as today.

**Add-to-cart call site (updated):**

Pass `colorName = selectedVariant.colorName` and `colorCode = selectedVariant.colorCode` when constructing `CartItem`.

### File: `ProductDetailSheet.kt`

**Color filter strip (new):**

Above the variants table header row, when `product.variants` contains any entry with `colorName != null`:
- Render a horizontal `LazyRow` of color swatches (same 18dp circle style as catalog card)
- A "All" chip appears first; tapping it clears the filter
- State: `var selectedColor by remember { mutableStateOf<String?>(null) }`
- When `selectedColor != null`, `VariantRow` composables are filtered to only matching `colorName`
- Variants with `colorName == null` always show regardless of filter

**`VariantRow` (unchanged):** The row itself does not get a color column. Filtering by color means only same-color rows are visible at once, so no column is needed.

### File: Cart item row composable (to be identified — likely in the estimate creation or cart screen)

When `cartItem.colorName != null`, prefix the size label with a 10dp filled circle swatch and the color name:

```
● White · 1L · ₹480
```

The circle is rendered as a `Box` with `Modifier.size(10.dp).clip(CircleShape).background(color)`.

---

## Color Parsing

`color_code` values are CSS hex strings (`#FFFFFF`, `#9CA3AF`). Parse with:
```kotlin
Color(android.graphics.Color.parseColor(colorCode))
```

Wrap in a `try/catch` — fall back to `Color.Gray` if the string is malformed (defensive, should never happen with data from the server).

---

## Backward Compatibility

- All new fields are nullable with default `null`. Products without colors render exactly as today.
- `CartItem` default params mean existing cart serialization is unaffected.
- Backend adds columns to SELECT; existing consumers ignore unknown JSON fields.

---

## Files Changed

| File | Change |
|---|---|
| `routes/painters.js` | Add `ps.color_name`, `ps.color_code` to catalog list + detail SELECT queries |
| `app/.../data/remote/api/CatalogApi.kt` | Add `colorName`, `colorCode` to `PackSize` and `ProductVariant` |
| `app/.../data/local/cart/CartStore.kt` | Add `colorName`, `colorCode` to `CartItem` |
| `app/.../ui/catalog/CatalogScreen.kt` | Color swatch strip in `ProductFamilyCard`; filter variant chips by selected color; pass color to cart |
| `app/.../ui/catalog/ProductDetailSheet.kt` | Color filter strip above variants table |
| Cart item row composable (estimate/cart screen) | Show color dot + name in cart item rows |

---

## Testing

- Product with colors: swatches appear on card; tapping swatch filters chip row
- Product without colors: card unchanged, no swatches
- Detail sheet: color strip appears; tapping color filters table; "All" clears filter
- Cart: item with color shows dot + name; item without color shows size only
- Malformed hex (empty string, null): falls back to gray swatch, no crash
- Cold start with color items in cart: color fields deserialize correctly
