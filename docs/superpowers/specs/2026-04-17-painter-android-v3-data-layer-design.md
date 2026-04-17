# Painter Android v3.0.0 Data Layer Completion — Design Spec

**Date:** 2026-04-17
**Status:** Approved design, awaiting implementation plan
**Author:** Claude Opus 4.7 + sharjoon1

## Goal

Finish the painter Android v3.0.0 WIP so `./gradlew clean :app:assemblePainterRelease` exits 0. The WIP has 261 pre-existing compile errors that gradle's Kotlin cache was masking (discovered 2026-04-17 during first `painter-android-audit` skill run). The errors cluster into **missing DTOs, missing fields on existing DTOs, and missing state/methods on existing ViewModels** — screens were written against a data model that was never implemented.

This spec fills that gap: no new features, no new backend work, just plumbing that makes the pre-existing screens (CatalogScreen, ProductDetailSheet, HomeScreen, ProductDetailScreen, OfferCarousel, StreakSheet) actually compile and function against the backend endpoints that already exist in `routes/painters.js`.

## Context

- **Repo:** `D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\qcpaintshop-android`, branch `audit/2026-04-17` (or new feature branch)
- **Backend reference:** `D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\act.qcpaintshop.com\routes\painters.js`
- **Error evidence:** `qcpaintshop-android/audit-findings/2026-04-17/build-log-combined.txt` (261 errors, gitignored)
- **WIP files:** 17 modified + 10 untracked in the painter flavor. Includes new APIs (`CardsApi.kt`, `NotificationApi.kt`, `PointsApi.kt`, `ProfileApi.kt`, `ReferralApi.kt`, `VisualizationApi.kt`) and UI (`FilterBottomSheet.kt`, `ProductDetailScreen.kt`, `home/components/`, `utils/`).

Before implementing this spec, the v3.0.0 WIP files must already be in the working tree (they are — see WIP list above). This spec finishes them; it does not recreate them.

## Scope

**In scope (A per brainstorming):** data-layer plumbing only — define missing DTOs, extend existing ViewModels with the members screens already reference, wire calls to existing backend endpoints. Result: clean compile + features work.

**Out of scope:**
- P0/P1 audit fixes from the 2026-04-17 audit (pattern 1 cascade for `productId`/`painterId`, pattern 6 `menuAnchor`, pattern 8 brand/category Int → String). Those re-run via the audit skill after this merges.
- `StreakSheet.kt` `java.time.*` on minSdk 24 (needs core library desugaring; separate spec).
- `PUT /me/profile` missing backend route (separate backend change).
- Any new features beyond what screens already reference.

## Architectural Decisions

| Decision | Choice | Why |
|---|---|---|
| DTO shape | 1:1 with backend JSON | Retrofit + Gson deserializes directly; no mapping layer; keeps the `routes/painters.js` handlers as the single source of truth |
| Filter key type | String (name), not Int (ID) | Backend `/me/catalog` handler at line 1393-1399 accepts `?brand=Asian Paints` as a name string. Memory confirms this is deliberate. Also fixes audit NET-02 P1 as a side-effect |
| State ownership | All new state lives on the existing `*UiState` classes | Matches painter flavor's existing pattern (all screens use a single `UiState` + StateFlow) |
| Mutation pattern | `_uiState.update { it.copy(...) }` | Consistent with existing CatalogViewModel, HomeViewModel |
| `ProductDetailViewModel` location | Co-located in `ProductDetailScreen.kt` | Already scaffolded there (lines 50-80); keep it — extraction is out of scope |
| Filter UI representation | `List<String>` for brands/categories, chips keyed by name | Backend response already returns them as strings (`CatalogResponse.brands: List<String>?`). `FilterOption(id, name)` is irrelevant for this use case |

## New DTOs

All added to existing API interface files:

### `data/remote/api/CatalogApi.kt`

```kotlin
data class ProductDetail(
    @SerializedName("product_id") val id: String?,
    val name: String?,
    @SerializedName("product_type") val productType: String?,
    val brand: String?,
    val category: String?,
    @SerializedName("image_url") val imageUrl: String?,
    @SerializedName("variant_count") val variantCount: Int?,
    @SerializedName("min_rate") val minRate: Double?,
    @SerializedName("max_rate") val maxRate: Double?,
    @SerializedName("total_stock") val totalStock: Double?,
    val variants: List<ProductVariant>?,
)

data class ProductVariant(
    val id: String?,                        // item_id in backend; always String per pattern 1
    val size: String?,
    val unit: String?,
    val rate: Double?,
    val stock: Double?,
    @SerializedName("regular_points") val regularPoints: Double?,
    @SerializedName("annual_points") val annualPoints: Double?,
    @SerializedName("image_url") val imageUrl: String?,
)

data class OfferProduct(
    val id: Int?,
    val title: String?,
    val description: String?,
    @SerializedName("applies_to") val appliesTo: String?,    // 'all' | 'brand' | 'category'
    @SerializedName("target_id") val targetId: String?,
    @SerializedName("bonus_points") val bonusPoints: Double?,
    @SerializedName("multiplier_value") val multiplierValue: Double?,
    @SerializedName("start_date") val startDate: String?,
    @SerializedName("end_date") val endDate: String?,
)

data class ProductDetailResponse(
    val success: Boolean,
    val product: ProductDetail?,
    val offers: List<OfferProduct>?,
)
```

### `data/remote/api/PointsApi.kt`

Backend `painter-points-engine.js::getBalance()` (verified line 25-39) returns:
```javascript
{ regular, annual, totalEarnedRegular, totalEarnedAnnual, totalRedeemedRegular, totalRedeemedAnnual }
```

Kotlin DTO:
```kotlin
data class BalanceData(
    val regular: Double?,
    val annual: Double?,
    val totalEarnedRegular: Double?,     // camelCase in backend JSON, no @SerializedName needed
    val totalEarnedAnnual: Double?,
    val totalRedeemedRegular: Double?,
    val totalRedeemedAnnual: Double?,
)
```

## Extended Interfaces

### `CatalogApi.kt::CatalogApi`

```kotlin
@GET("me/catalog")
suspend fun getCatalog(
    @Query("search") search: String? = null,
    @Query("brand") brand: String? = null,           // was Int? — fixes audit NET-02
    @Query("category") category: String? = null,     // was Int? — fixes audit NET-02
    @Query("hasPoints") hasPoints: Boolean? = null,  // NEW
    @Query("inStock") inStock: Boolean? = null,      // NEW
    @Query("page") page: Int = 1,                    // NEW
    @Query("limit") limit: Int = 50,                 // NEW
    @Query("billing_type") billingType: String = "self",
): Response<CatalogResponse>

@GET("me/catalog/{productId}")                       // NEW method
suspend fun getProductDetail(@Path("productId") productId: String): Response<ProductDetailResponse>
```

### `CatalogResponse` adjustment

Already has `brands: List<String>?` and `categories: List<String>?`. Add pagination metadata if backend returns it:
```kotlin
data class CatalogResponse(
    val success: Boolean,
    val products: List<CatalogProduct>?,
    val brands: List<String>?,
    val categories: List<String>?,
    @SerializedName("total_count") val totalCount: Int? = null,  // NEW (optional)
    val page: Int? = null,
    val limit: Int? = null,
)
```
(Only add fields the backend actually sends; confirm at impl time.)

## ViewModel Contracts

### `CatalogViewModel` + `CatalogUiState`

**Current state (7 fields, 3 methods):** `isLoading, searchQuery, products, inStockOnly` + `search(), toggleInStock(), requestProduct()`.

**New state (10 fields added):**
```kotlin
data class CatalogUiState(
    // Existing
    val isLoading: Boolean = true,
    val searchQuery: String = "",
    val products: List<CatalogProduct> = emptyList(),
    // NEW
    val selectedBrand: String? = null,
    val selectedCategory: String? = null,
    val hasPointsFilter: Boolean = false,
    val inStockFilter: Boolean = false,
    val brands: List<String> = emptyList(),
    val categories: List<String> = emptyList(),
    val isLoadingMore: Boolean = false,
    val hasMore: Boolean = true,
    val currentPage: Int = 1,
)
```
Note: existing `inStockOnly` is renamed to `inStockFilter` to match screen references. If any other code paths reference `inStockOnly`, add a compatibility computed val during implementation.

**New methods:**
```kotlin
fun applyFilters(brand: String?, category: String?, hasPoints: Boolean, inStock: Boolean)
fun resetFilters()
fun loadMore()                 // appends page+1 to products, respects hasMore + isLoadingMore
fun clearSearch()              // clears searchQuery + triggers reload
```

`loadCatalog()` (private) updated to pass all filter + pagination params. After response, populate `brands`/`categories` from `CatalogResponse.brands`/`categories` (which the backend already returns).

### `HomeViewModel` + `HomeUiState`

**Current state:** well-populated (painterName, regularPoints, annualPoints, etc.). See `HomeViewModel.kt` lines 13-36 for full list.

**New state (5 fields added):**
```kotlin
data class HomeUiState(
    // ... existing ...
    val offers: List<OfferData> = emptyList(),
    val recentEstimates: List<EstimateSummary> = emptyList(),     // EstimateSummary from existing EstimateApi
    val referralCode: String? = null,
    val showWithdrawalSheet: Boolean = false,
    val showStreakSheet: Boolean = false,
)
```

**`recentEstimates` source:** Use existing `EstimateApi.getEstimates(limit = 5)` — the `EstimateSummary` type (or whatever the DTO is named on that API) is already defined. Call it alongside the dashboard/briefing/gamification loads in `loadAll()`.

**`referralCode` source:** Already returned by `/me/dashboard` at the top level of the `dashboard` object (verified at `routes/painters.js:615`: `referralCode: painter[0]?.referral_code`). The existing `DashboardData` DTO is missing this field. Spec adds it:

```kotlin
data class DashboardData(
    // ... existing 13 fields ...
    @SerializedName("referralCode") val referralCode: String? = null,  // NEW
)
```

**Note on dashboard response drift (informational, not in scope):** Inspection of `/me/dashboard` at line 611-627 shows the response uses keys like `balance`, `referralCode`, `profilePhoto`, `painterName`, `recentTransactions`, `pendingWithdrawals` — different from what current `DashboardData` expects (`totalEarnings`, `thisMonthEarnings`, `regularPoints`, etc.). Many existing `HomeUiState` fields have been defaulting to 0 silently. This is a **pre-existing bug**, not created by this spec. A follow-up spec should reconcile the full dashboard contract. For this spec, only `referralCode` is added because it's required by the screen.

**New methods:**
```kotlin
fun toggleWithdrawalSheet() { _uiState.update { it.copy(showWithdrawalSheet = !it.showWithdrawalSheet) } }
fun toggleStreakSheet()    { _uiState.update { it.copy(showStreakSheet = !it.showStreakSheet) } }
```

`loadAll()` extended:
```kotlin
// After existing dashboard/briefing/gamification loads, add:
catalogApi.getOffers().fold(
    onSuccess = { r -> _uiState.update { it.copy(offers = r.body()?.offers ?: emptyList()) } },
    onFailure = { /* silent */ }
)
```

(And equivalent for recentEstimates if the dashboard endpoint doesn't already include them.)

### `ProductDetailViewModel` (in `ProductDetailScreen.kt`)

Already scaffolded at lines 50-80. Changes:
- `productId` already typed `String` (good). Pass as-is to `catalogApi.getProductDetail(productId)` — drop the `.toIntOrNull() ?: 0` conversion at line 67.
- `ProductDetailUiState.isLoading` → keep as-is; the `isLoadingDetail` and `clearProductDetail` errors originate from `CatalogViewModel` / `CatalogUiState` (where the product-detail sheet is driven by the list screen), not from `ProductDetailViewModel`. Implementation plan will add `isLoadingDetail: Boolean = false`, `selectedProduct: ProductDetail? = null`, and `clearProductDetail()` method to `CatalogViewModel` instead.
- Wire call to `catalogApi.getProductDetail()`; unwrap `ProductDetailResponse.product` into `ProductDetailUiState.product`.

## Backend Integration — No Changes Required

Existing endpoints used by this spec:

| Android call | Backend route | File:line |
|---|---|---|
| `catalogApi.getCatalog(...)` | `GET /me/catalog` | `painters.js:1373` |
| `catalogApi.getProductDetail(id)` | `GET /me/catalog/:productId` | `painters.js:1534` |
| `catalogApi.getOffers()` | `GET /me/offers` | `painters.js:1632` |
| `pointsApi.getPoints(pool)` | `GET /me/points/:pool` | `painters.js:518` |

All support the query params and return the fields this spec references. **No backend work.**

## Files Changed

| File | Change type | Est. lines |
|---|---|---|
| `data/remote/api/CatalogApi.kt` | + 4 DTOs, extend getCatalog params, add getProductDetail | +60 |
| `data/remote/api/PointsApi.kt` | + BalanceData DTO | +8 |
| `ui/catalog/CatalogViewModel.kt` | expand UiState + 4 new methods + update loadCatalog | +60 |
| `ui/home/HomeViewModel.kt` | + 5 UiState fields + 2 toggle methods + extend loadAll | +35 |
| `ui/catalog/ProductDetailScreen.kt` | wire getProductDetail, align state names, drop Int conversion | +15 |
| `ui/work/estimates/EstimateCreateViewModel.kt` | change loadProducts() to pass brand/category as String (from selectedBrand/Category FilterOption.name) | +5 |

**6 files.** The 5 screen/composable files (`CatalogScreen.kt`, `HomeScreen.kt`, `ProductDetailSheet.kt`, `StreakSheet.kt`, `OfferCarousel.kt`) are not modified — they already reference the member names defined by this spec.

## Success Criteria

1. From clean state: `./gradlew clean && ./gradlew :app:assemblePainterRelease` exits 0, 0 errors, ≤ the baseline warning count (currently 0).
2. On device (fresh install + OTP login):
   - Catalog loads products from `/me/catalog`
   - Search updates product list after 400ms debounce
   - Filter sheet applies brand/category/inStock/hasPoints — products reload
   - Scroll to bottom triggers `loadMore()` — page 2+ appends without duplicates
   - Tap product → detail screen shows variants with rate + points
3. Home screen:
   - Offers carousel populates (up to N offers)
   - Recent estimates list renders (if present in response)
   - Referral code visible
   - Withdrawal sheet toggles on button press
   - Streak sheet toggles on button press
4. No new runtime crashes vs v2.1.0 in smoke test.

## Testing Strategy

- **Compile-level:** `./gradlew clean :app:assemblePainterRelease` as the primary gate.
- **Functional:** manual device smoke-test of the 5 screens per Success Criteria §2-3.
- **Regression:** verify v2.1.0-present features (check-in, estimate create, attendance calendar, profile edit, referrals) still work — this spec shouldn't touch them but type changes on `CatalogApi.getCatalog()` brand/category could cascade.
- No unit tests — painter flavor has none currently, adding a test harness is out of scope.

## Dependencies & Risks

- **Dependency:** the WIP files in the painter flavor must be present (they are). If anyone resets the repo to `master`, this spec becomes inapplicable.
- **Risk — `inStockOnly` → `inStockFilter` rename:** may cascade to a computed val or deprecation. Implementation plan must grep call sites before rename.
- **Risk — `CatalogViewModel` now owns product-detail state (`selectedProduct`, `isLoadingDetail`, `clearProductDetail()`):** implementation must verify `ProductDetailSheet` invocations flow through `CatalogViewModel` (not a separate injected `ProductDetailViewModel`), matching how the screen is wired. If the sheet uses its own VM, the state additions go to `ProductDetailUiState` instead.
- **Known pre-existing bug (informational):** `/me/dashboard` response shape and `DashboardData` DTO are misaligned beyond the `referralCode` gap this spec closes. Many `HomeUiState` fields silently default to 0. Outside this spec's scope; file separate follow-up.

## Terminal State

This spec ends here. Next step: invoke `superpowers:writing-plans` to create the implementation plan for these 6 files.
