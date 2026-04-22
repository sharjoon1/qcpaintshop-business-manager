# EstimateCreate — Points Display + Offers Filter

**Date:** 2026-04-22
**Status:** Approved

## Summary

When a painter taps + to create an estimate, the product list shows pack-size rows. Currently only Regular Points are shown. This spec adds Annual Points and Offer Points to each row, plus an Offers filter chip so painters can quickly filter to offer-only products.

---

## 1. Backend

### Endpoint: `GET /me/estimates/products`

**File:** `routes/painters.js`

**Current behaviour:** Returns products with `regular_points` and `annual_points` per pack size. Does not fetch or attach offer data.

**Changes:**

1. Add `hasOffer` query param (boolean, optional). When truthy, filter results to only products that have an active offer.

2. Always fetch active offers and attach a matching `offer` object to every product in the response — even when `hasOffer` is not set. This lets the Android app show offer pills on all matching rows without a second request.

3. Offer-fetching logic: reuse the identical SQL and matching logic already present in `/me/catalog` (lines ~1704–1733):
   - Query `painter_special_offers WHERE is_active=1 AND DATE(start_date) <= DATE(now) AND DATE(end_date) >= DATE(now)`
   - Match each product by `applies_to` ('all' / 'brand' / 'category') against `target_id`
   - Attach first matched offer as `offer: { id, name, offer_value, ... }` or `offer: null`

4. When `hasOffer=true`, filter `productsWithOffers` to only rows where `offer !== null`.

**No new tables or endpoints required.**

---

## 2. Android — API layer

**File:** `app/src/main/java/com/qcpaintshop/data/remote/api/EstimateCreateApi.kt`

Add one query parameter to `getProducts()`:

```kotlin
@Query("hasOffer") hasOffer: Boolean? = null
```

No changes to DTOs — `CatalogProduct` already has `offer: ProductOffer?` and `offerValue: String?`. `PackSize` already has `regularPoints` and `annualPoints`.

---

## 3. Android — ViewModel

**File:** `app/src/main/java/com/qcpaintshop/.../ui/work/estimates/EstimateCreateViewModel.kt`

### State

Add to `EstimateCreateUiState`:

```kotlin
val hasOfferFilter: Boolean = false
```

Update `activeFilterCount` computation to include `hasOfferFilter`:

```kotlin
val activeFilterCount = listOf(selectedBrand, selectedCategory).count { it != null } +
    listOf(hasPointsFilter, hasOfferFilter).count { it }
```

### `applyFilters()`

Signature change:

```kotlin
fun applyFilters(brand: FilterOption?, category: FilterOption?, hasPoints: Boolean, hasOffer: Boolean)
```

Pass `hasOffer` to `loadProducts()` and save to state.

### `resetFilters()`

Also set `hasOfferFilter = false`.

### `loadProducts()`

Pass `hasOffer = if (uiState.hasOfferFilter) true else null` to `api.getProducts()`.

---

## 4. Android — UI

**File:** `app/src/main/java/com/qcpaintshop/.../ui/work/estimates/EstimateCreateScreen.kt`

### PackSizeRow — points pills

Replace the current single `regularPoints` text with three conditional pills (Option A — coloured pills):

| Pill | Condition | Style |
|------|-----------|-------|
| `"N RP"` | `packSize.regularPoints > 0` | Gold background `#FFF8E1`, text `#B8860B` |
| `"N AP"` | `packSize.annualPoints > 0` | Green background `#E8F5E9`, text `#1B5E3B` |
| `"🎁 +N OP"` | `product.offer != null` | Orange background `#FFF3E0`, text `#E65100` |

The offer points value (`N` in `+N OP`) comes from `product.offerValue` (already on `CatalogProduct`).

Pills are laid out in a horizontal `FlowRow` (or `Row` with `Arrangement.spacedBy`) below the size/price row. Only non-zero/non-null pills are rendered — no empty space when all are absent.

### Filter chip bar

Add `"🎁 Offers"` chip immediately after the existing Points chip in the horizontal scrolling chip row.

- **Inactive:** Same style as other inactive chips (outlined, grey)
- **Active:** Orange background `#E65100`, white text — matches the OP pill colour

Tapping the chip calls `viewModel.toggleOfferFilter()` (new helper that flips `hasOfferFilter` and triggers `loadProducts()`).

### Filter bottom sheet

Add an "Offer products only" toggle row beneath the existing "Has points" toggle. Bound to `hasOfferFilter` in state.

---

## 5. Out of scope

- No changes to the Catalog screen (already has offers)
- No new offer data beyond what `painter_special_offers` already stores
- No UI changes to EstimateCreate other than the pack-size row and filter bar described above

---

## 6. Testing

- Backend: confirm `/me/estimates/products` returns `offer: null` for non-offer products and `offer: {...}` for matching ones; confirm `hasOffer=true` filters correctly
- Android: build painter flavor, open EstimateCreate, verify RP/AP/OP pills render on rows; toggle Offers chip and confirm list filters; toggle Points chip independently
