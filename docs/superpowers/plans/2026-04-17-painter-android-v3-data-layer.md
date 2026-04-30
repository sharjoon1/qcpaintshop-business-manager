# Painter Android v3.0.0 Data Layer Completion — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the painter Android v3.0.0 WIP so `./gradlew clean :app:assemblePainterRelease` exits 0 (currently fails with 261 pre-existing errors masked by gradle's Kotlin cache).

**Architecture:** Define missing DTOs (ProductDetail, ProductVariant, OfferProduct, BalanceData, offer-products response), extend existing ViewModel UiStates with the filter/pagination/sheet-toggle/product-detail state that screens already reference, and wire calls to existing backend endpoints. No backend changes; no new features beyond what screens already expect.

**Tech Stack:** Kotlin 2.x, Jetpack Compose Material3, Retrofit 2, Gson, Hilt DI, Coroutines Flow. Build via Gradle 8.11 (`:app:assemblePainterRelease`). Target painter flavor at `app/src/painter/`.

**Approved spec:** `docs/superpowers/specs/2026-04-17-painter-android-v3-data-layer-design.md` (commit 973229d).

**Target repo:** `D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\qcpaintshop-android\` on branch `audit/2026-04-17`.

---

## File Structure

7 files changed (1 more than the spec's 6 — `/me/offer-products` endpoint was discovered during plan research; its DTOs live in `CatalogApi.kt` so file count-wise still 6 API files).

| File | Role | Approx lines added/modified |
|---|---|---|
| `app/src/painter/.../data/remote/api/CatalogApi.kt` | + 6 DTOs (ProductDetail, ProductVariant, OfferProduct, ProductDetailResponse, OfferProductItem, OfferProductsResponse); extend getCatalog signature; + getProductDetail, + getOfferProducts methods | +100 |
| `app/src/painter/.../data/remote/api/PointsApi.kt` | + BalanceData DTO | +10 |
| `app/src/painter/.../data/remote/api/DashboardApi.kt` | + referralCode field on DashboardData | +1 |
| `app/src/painter/.../ui/catalog/CatalogViewModel.kt` | Expand CatalogUiState (+14 fields); add 6 methods (applyFilters, resetFilters, loadMore, clearSearch, selectProduct, clearProductDetail); update loadCatalog | +110 |
| `app/src/painter/.../ui/home/HomeViewModel.kt` | Expand HomeUiState (+6 fields); + 2 toggle methods; extend loadAll to call getOfferProducts + getEstimates | +50 |
| `app/src/painter/.../ui/catalog/ProductDetailScreen.kt` | Wire getProductDetail method, drop Int conversion | 1 line removed, 2 added |
| `app/src/painter/.../ui/work/estimates/EstimateCreateViewModel.kt` | Change brand/category param source from `.id` to `.name` | 2 lines |

**No backend files touched.** No new routes, no schema changes.

**Branch strategy:** All commits land on `audit/2026-04-17` (current branch). Each task = one commit. Final merge to master is user's call (out of scope for this plan).

---

## Strategy notes

The painter flavor has **no unit test harness**. TDD = "gradle compile is the test": write code, run `./gradlew :app:compilePainterReleaseKotlin`, verify error count drops, commit.

Each task ends with a build probe step that targets just the Kotlin compile task (30s, no full assembly). The final Task 11 runs the full `./gradlew clean :app:assemblePainterRelease`.

Build probe command used throughout:
```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  ./gradlew :app:compilePainterReleaseKotlin --no-daemon 2>&1 | tail -40 )
```

Error-count probe:
```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  ./gradlew :app:compilePainterReleaseKotlin --no-daemon 2>&1 | grep -cE '^e: ' )
```

---

## Task 1: Baseline verification

**Files:** none

- [ ] **Step 1: Confirm branch + uncommitted state**

Run:
```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  git branch --show-current && git status --short | wc -l )
```
Expected: `audit/2026-04-17` and a number (likely 27 — the v3.0.0 WIP). If branch differs, run `git checkout audit/2026-04-17`. Do NOT stash or reset — the WIP is this plan's input.

- [ ] **Step 2: Confirm baseline error count = 261**

Run:
```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  ./gradlew clean :app:compilePainterReleaseKotlin --no-daemon 2>&1 | grep -cE '^e: ' )
```
Expected: `261`. If materially different (e.g., 0, or >300), stop and investigate — the WIP has changed since the audit captured its state.

- [ ] **Step 3: No commit** (baseline-only task)

---

## Task 2: Add `BalanceData` DTO to PointsApi.kt

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/data/remote/api/PointsApi.kt`

- [ ] **Step 1: Read the file**

Use Read tool on `PointsApi.kt`. Confirm `data class PointsResponse` at line 7 references `BalanceData?` but `BalanceData` is not defined.

- [ ] **Step 2: Add BalanceData data class**

Use Edit to insert after line 12 (end of `PointsResponse`):
```kotlin
data class BalanceData(
    val regular: Double?,
    val annual: Double?,
    val totalEarnedRegular: Double?,
    val totalEarnedAnnual: Double?,
    val totalRedeemedRegular: Double?,
    val totalRedeemedAnnual: Double?,
)

```
Field names match what `services/painter-points-engine.js::getBalance()` returns (verified lines 25-39 of that file: `regular, annual, totalEarnedRegular, totalEarnedAnnual, totalRedeemedRegular, totalRedeemedAnnual`). No `@SerializedName` needed since backend JSON is camelCase.

- [ ] **Step 3: Compile probe**

Run the error-count probe (from Strategy notes). Expected: drops from 261 to 260 (or close — this DTO is referenced only on PointsApi.kt:10).

- [ ] **Step 4: Commit**

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  git add app/src/painter/java/com/qcpaintshop/painter/data/remote/api/PointsApi.kt && \
  git commit -m "feat(painter): add BalanceData DTO matching backend getBalance() shape" )
```

---

## Task 3: Add product-detail DTOs to CatalogApi.kt

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/data/remote/api/CatalogApi.kt`

- [ ] **Step 1: Read the file**

Use Read tool. Familiarize with current structure (CatalogResponse, CatalogProduct, PackSize, FilterOption, ProductRequestBody, GenericResponse, OffersResponse, OfferData). End of file is line 73.

- [ ] **Step 2: Insert 4 new DTOs after `OfferData` (after current line 73)**

Use Edit to replace the end-of-file block. Find `data class OfferData(` block (lines 67-73) and append these DTOs immediately after the closing `)`:

```kotlin

// ═══════════════════════════════════════════════════════════════
// Product detail (GET /me/catalog/:productId)
// ═══════════════════════════════════════════════════════════════

data class ProductDetail(
    @SerializedName("product_id") val id: Int?,
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
    val id: String?,
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
    @SerializedName("applies_to") val appliesTo: String?,
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

**Note:** `ProductDetail.id` is `Int?` (not `String?`) because `products.id` is the MySQL PK (Int). `ProductVariant.id` is `String?` because it maps to `zoho_items_map.zoho_item_id` (can overflow Int). This matches how `ProductDetailSheet.kt:239` calls `onCreateEstimate(product.id, variant.id?.toIntOrNull() ?: 0)`.

- [ ] **Step 3: Compile probe**

Run error-count probe. Expected: drops significantly (the 55 ProductDetailSheet errors + 37 ProductDetailScreen errors should mostly resolve). Estimate: ~170 errors remain.

- [ ] **Step 4: Commit**

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  git add app/src/painter/java/com/qcpaintshop/painter/data/remote/api/CatalogApi.kt && \
  git commit -m "feat(painter): add ProductDetail/ProductVariant/OfferProduct DTOs" )
```

---

## Task 4: Add offer-products DTOs + endpoint to CatalogApi.kt

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/data/remote/api/CatalogApi.kt`

Backend `GET /me/offer-products` (routes/painters.js:1656) returns `{ brands, products, offers }` where `products[]` has product_id, name, product_type, min_rate, max_rate, variant_count, brand, category, image_url, points_per_unit.

- [ ] **Step 1: Append DTOs after `ProductDetailResponse` (the class added in Task 3)**

Use Edit to insert:
```kotlin

// ═══════════════════════════════════════════════════════════════
// Offer products grouped by brand (GET /me/offer-products)
// Used by HomeScreen's OfferCarousel
// ═══════════════════════════════════════════════════════════════

data class OfferProductItem(
    @SerializedName("product_id") val productId: Int?,
    val name: String?,
    @SerializedName("product_type") val productType: String?,
    @SerializedName("min_rate") val minRate: Double?,
    @SerializedName("max_rate") val maxRate: Double?,
    @SerializedName("variant_count") val variantCount: Int?,
    val brand: String?,
    val category: String?,
    @SerializedName("image_url") val imageUrl: String?,
    @SerializedName("points_per_unit") val pointsPerUnit: Double?,
)

data class OfferProductsResponse(
    val success: Boolean,
    val brands: List<String>?,
    val products: List<OfferProductItem>?,
    val offers: List<OfferProduct>?,
)
```

- [ ] **Step 2: Compile probe**

Run error-count probe. Expected: similar to Task 3 result (these DTOs aren't used until Task 8).

- [ ] **Step 3: Commit**

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  git add app/src/painter/java/com/qcpaintshop/painter/data/remote/api/CatalogApi.kt && \
  git commit -m "feat(painter): add OfferProductsResponse DTO for /me/offer-products" )
```

---

## Task 5: Extend CatalogApi interface signature

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/data/remote/api/CatalogApi.kt`

- [ ] **Step 1: Replace the `interface CatalogApi` block**

Use Edit. Find the current interface (lines 50-64):
```kotlin
interface CatalogApi {
    @GET("me/catalog")
    suspend fun getCatalog(
        @Query("search") search: String? = null,
        @Query("brand") brand: Int? = null,
        @Query("category") category: Int? = null,
        @Query("billing_type") billingType: String = "self",
    ): Response<CatalogResponse>

    @GET("me/offers")
    suspend fun getOffers(): Response<OffersResponse>

    @POST("me/product-requests")
    suspend fun requestProduct(@Body body: ProductRequestBody): Response<GenericResponse>
}
```

Replace with:
```kotlin
interface CatalogApi {
    @GET("me/catalog")
    suspend fun getCatalog(
        @Query("search") search: String? = null,
        @Query("brand") brand: String? = null,
        @Query("category") category: String? = null,
        @Query("hasPoints") hasPoints: Boolean? = null,
        @Query("inStock") inStock: Boolean? = null,
        @Query("page") page: Int = 1,
        @Query("limit") limit: Int = 50,
        @Query("billing_type") billingType: String = "self",
    ): Response<CatalogResponse>

    @GET("me/catalog/{productId}")
    suspend fun getProductDetail(
        @Path("productId") productId: String,
    ): Response<ProductDetailResponse>

    @GET("me/offer-products")
    suspend fun getOfferProducts(): Response<OfferProductsResponse>

    @GET("me/offers")
    suspend fun getOffers(): Response<OffersResponse>

    @POST("me/product-requests")
    suspend fun requestProduct(@Body body: ProductRequestBody): Response<GenericResponse>
}
```

Change summary:
- `brand: Int? → String?`, `category: Int? → String?` (backend expects names)
- Added `hasPoints`, `inStock`, `page`, `limit` query params (backend already supports them)
- Added `getProductDetail(@Path productId: String)` → `ProductDetailResponse`
- Added `getOfferProducts()` → `OfferProductsResponse`

- [ ] **Step 2: Add optional pagination fields to `CatalogResponse`**

Find the `data class CatalogResponse(` block (lines 7-12):
```kotlin
data class CatalogResponse(
    val success: Boolean,
    val products: List<CatalogProduct>?,
    val brands: List<String>?,
    val categories: List<String>?,
)
```
Replace with:
```kotlin
data class CatalogResponse(
    val success: Boolean,
    val products: List<CatalogProduct>?,
    val brands: List<String>?,
    val categories: List<String>?,
    @SerializedName("total_count") val totalCount: Int? = null,
    val page: Int? = null,
    val limit: Int? = null,
)
```

- [ ] **Step 3: Compile probe**

Run error-count probe. Expected: `CatalogViewModel.kt` will now have errors about brand/category type mismatch (was passing Int from FilterOption.id, now expects String). Errors may rise briefly before dropping — track overall.

- [ ] **Step 4: Commit**

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  git add app/src/painter/java/com/qcpaintshop/painter/data/remote/api/CatalogApi.kt && \
  git commit -m "feat(painter): extend CatalogApi — String brand/category, pagination, getProductDetail, getOfferProducts" )
```

---

## Task 6: Add `referralCode` field to DashboardData

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/data/remote/api/DashboardApi.kt`

Backend `/me/dashboard` already returns `referralCode` at the top level of the `dashboard` object (routes/painters.js:615). Add the field to DashboardData DTO.

- [ ] **Step 1: Read DashboardApi.kt**

Use Read tool. Find `data class DashboardData(` — currently ends with `@SerializedName("total_lifetime_points") val totalLifetimePoints: Int?,` on line 25, closing `)` on line 26.

- [ ] **Step 2: Insert `referralCode` as the last field**

Use Edit:
- old:
```kotlin
    @SerializedName("total_lifetime_points") val totalLifetimePoints: Int?,
)
```
- new:
```kotlin
    @SerializedName("total_lifetime_points") val totalLifetimePoints: Int?,
    val referralCode: String? = null,
)
```
Backend sends this as camelCase `referralCode`, not snake_case — no `@SerializedName` needed.

- [ ] **Step 3: Compile probe**

Run error-count probe.

- [ ] **Step 4: Commit**

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  git add app/src/painter/java/com/qcpaintshop/painter/data/remote/api/DashboardApi.kt && \
  git commit -m "feat(painter): DashboardData.referralCode from /me/dashboard response" )
```

---

## Task 7: Extend CatalogUiState

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/ui/catalog/CatalogViewModel.kt`

- [ ] **Step 1: Replace the `data class CatalogUiState(` block**

Use Edit. Find:
```kotlin
data class CatalogUiState(
    val isLoading: Boolean = true,
    val searchQuery: String = "",
    val products: List<CatalogProduct> = emptyList(),
    val inStockOnly: Boolean = false,
)
```

Replace with:
```kotlin
data class CatalogUiState(
    val isLoading: Boolean = true,
    val searchQuery: String = "",
    val products: List<CatalogProduct> = emptyList(),

    // Filters (drive /me/catalog query params)
    val selectedBrand: String? = null,
    val selectedCategory: String? = null,
    val hasPointsFilter: Boolean = false,
    val inStockFilter: Boolean = false,
    val brands: List<String> = emptyList(),
    val categories: List<String> = emptyList(),

    // Pagination
    val isLoadingMore: Boolean = false,
    val hasMore: Boolean = true,
    val currentPage: Int = 1,

    // Product detail sheet (shown from this screen)
    val selectedProduct: ProductDetail? = null,
    val isLoadingDetail: Boolean = false,

    // Offers banner row
    val offers: List<OfferData> = emptyList(),
)
```
`inStockOnly` is renamed to `inStockFilter` (matches `CatalogScreen.kt:186` and friends). `toggleInStock()` method — which is the only consumer of `inStockOnly` — is removed in Task 8.

- [ ] **Step 2: Compile probe**

Error count will temporarily rise: `toggleInStock()` still references the old name. Keep going — Task 8 fixes it.

- [ ] **Step 3: Commit**

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  git add app/src/painter/java/com/qcpaintshop/painter/ui/catalog/CatalogViewModel.kt && \
  git commit -m "feat(painter): extend CatalogUiState with filters, pagination, product-detail, offers" )
```

---

## Task 8: Extend CatalogViewModel with methods + updated loadCatalog

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/ui/catalog/CatalogViewModel.kt`

- [ ] **Step 1: Replace everything from `@HiltViewModel` to end of file**

Use Edit. Find the block starting `@HiltViewModel\nclass CatalogViewModel @Inject constructor(` (currently line 20) through the closing `}` of the class (currently line 71).

Replace with:
```kotlin
@HiltViewModel
class CatalogViewModel @Inject constructor(
    private val catalogApi: CatalogApi
) : ViewModel() {
    private val _uiState = MutableStateFlow(CatalogUiState())
    val uiState: StateFlow<CatalogUiState> = _uiState.asStateFlow()
    private var searchJob: Job? = null

    init {
        loadCatalog(resetPagination = true)
        loadOffers()
    }

    fun search(query: String) {
        _uiState.update { it.copy(searchQuery = query) }
        searchJob?.cancel()
        searchJob = viewModelScope.launch {
            delay(400)
            loadCatalog(resetPagination = true)
        }
    }

    fun clearSearch() {
        _uiState.update { it.copy(searchQuery = "") }
        loadCatalog(resetPagination = true)
    }

    fun applyFilters(brand: String?, category: String?, hasPoints: Boolean, inStock: Boolean) {
        _uiState.update {
            it.copy(
                selectedBrand = brand,
                selectedCategory = category,
                hasPointsFilter = hasPoints,
                inStockFilter = inStock,
            )
        }
        loadCatalog(resetPagination = true)
    }

    fun resetFilters() {
        _uiState.update {
            it.copy(
                selectedBrand = null,
                selectedCategory = null,
                hasPointsFilter = false,
                inStockFilter = false,
            )
        }
        loadCatalog(resetPagination = true)
    }

    fun loadMore() {
        val state = _uiState.value
        if (state.isLoadingMore || !state.hasMore || state.isLoading) return
        _uiState.update { it.copy(isLoadingMore = true) }
        viewModelScope.launch {
            try {
                val nextPage = state.currentPage + 1
                val resp = catalogApi.getCatalog(
                    search = state.searchQuery.ifBlank { null },
                    brand = state.selectedBrand,
                    category = state.selectedCategory,
                    hasPoints = if (state.hasPointsFilter) true else null,
                    inStock = if (state.inStockFilter) true else null,
                    page = nextPage,
                    limit = 50,
                )
                val more = resp.body()?.products ?: emptyList()
                _uiState.update {
                    it.copy(
                        isLoadingMore = false,
                        products = it.products + more,
                        currentPage = nextPage,
                        hasMore = more.size == 50,
                    )
                }
            } catch (_: Exception) {
                _uiState.update { it.copy(isLoadingMore = false) }
            }
        }
    }

    fun selectProduct(productId: Int) {
        _uiState.update { it.copy(isLoadingDetail = true, selectedProduct = null) }
        viewModelScope.launch {
            try {
                val resp = catalogApi.getProductDetail(productId.toString())
                val detail = resp.body()?.product
                _uiState.update { it.copy(isLoadingDetail = false, selectedProduct = detail) }
            } catch (_: Exception) {
                _uiState.update { it.copy(isLoadingDetail = false) }
            }
        }
    }

    fun clearProductDetail() {
        _uiState.update { it.copy(selectedProduct = null, isLoadingDetail = false) }
    }

    fun requestProduct(name: String, brand: String?, size: String?, note: String?) {
        viewModelScope.launch {
            try {
                catalogApi.requestProduct(ProductRequestBody(name, brand, size, note))
            } catch (_: Exception) {}
        }
    }

    private fun loadCatalog(resetPagination: Boolean) {
        viewModelScope.launch {
            _uiState.update {
                it.copy(
                    isLoading = true,
                    currentPage = if (resetPagination) 1 else it.currentPage,
                    products = if (resetPagination) emptyList() else it.products,
                )
            }
            try {
                val state = _uiState.value
                val resp = catalogApi.getCatalog(
                    search = state.searchQuery.ifBlank { null },
                    brand = state.selectedBrand,
                    category = state.selectedCategory,
                    hasPoints = if (state.hasPointsFilter) true else null,
                    inStock = if (state.inStockFilter) true else null,
                    page = state.currentPage,
                    limit = 50,
                )
                val body = resp.body()
                val products = body?.products ?: emptyList()
                _uiState.update {
                    it.copy(
                        isLoading = false,
                        products = products,
                        brands = body?.brands ?: it.brands,
                        categories = body?.categories ?: it.categories,
                        hasMore = products.size == 50,
                    )
                }
            } catch (_: Exception) {
                _uiState.update { it.copy(isLoading = false) }
            }
        }
    }

    private fun loadOffers() {
        viewModelScope.launch {
            try {
                val resp = catalogApi.getOffers()
                val offers = resp.body()?.offers ?: emptyList()
                _uiState.update { it.copy(offers = offers) }
            } catch (_: Exception) {}
        }
    }
}
```

Deleted: `toggleInStock()` and `fun requestProduct` was kept but relocated. The old `loadCatalog()` with client-side `inStockOnly` filter is removed — backend now applies the filter server-side via `?inStock=true`.

- [ ] **Step 2: Compile probe**

Run error-count probe. Expected large drop: CatalogScreen's 63 errors should mostly resolve.

- [ ] **Step 3: Commit**

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  git add app/src/painter/java/com/qcpaintshop/painter/ui/catalog/CatalogViewModel.kt && \
  git commit -m "feat(painter): CatalogViewModel — filters, pagination, product-detail, offers" )
```

---

## Task 9: Extend HomeUiState + HomeViewModel

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/ui/home/HomeViewModel.kt`

- [ ] **Step 1: Replace `data class HomeUiState(...)` block**

Use Edit. Find the current `data class HomeUiState(` block (lines 13-36) and replace with:
```kotlin
data class HomeUiState(
    val isLoading: Boolean = true,
    val painterName: String = "",
    val painterPhoto: String? = null,
    val painterLevel: String = "bronze",
    val thisMonthEarnings: Double = 0.0,
    val regularPoints: Double = 0.0,
    val annualPoints: Double = 0.0,
    val checkinStreak: Int = 0,
    val thisMonthCheckins: Int = 0,
    val todayCheckedIn: Boolean = false,
    val totalEstimates: Int = 0,
    val pendingEstimates: Int = 0,
    val totalLifetimePoints: Int = 0,
    val briefingMessage: String? = null,
    val briefingTips: List<String> = emptyList(),
    val badges: List<BadgeData> = emptyList(),
    val activeChallenges: List<ChallengeData> = emptyList(),
    val error: String? = null,
    val nextLevelName: String = "Silver",
    val levelProgress: Float = 0f,
    val pointsToNextLevel: Int = 500,

    // v3.0.0 additions
    val offerBrands: List<String> = emptyList(),
    val offerProducts: Map<String, List<OfferProductItem>> = emptyMap(),
    val recentEstimates: List<EstimateItem> = emptyList(),
    val referralCode: String? = null,
    val showWithdrawalSheet: Boolean = false,
    val showStreakSheet: Boolean = false,
)
```

- [ ] **Step 2: Inject two new dependencies + extend loadAll + add toggle methods**

Use Edit. Find the `@HiltViewModel\nclass HomeViewModel @Inject constructor(` block through end of class.

Replace with (bold-marked NEW parts are additions; everything else is preserved):
```kotlin
@HiltViewModel
class HomeViewModel @Inject constructor(
    private val dashboardRepository: DashboardRepository,
    private val userPreferences: UserPreferences,
    private val catalogApi: CatalogApi,
    private val workApi: WorkApi,
) : ViewModel() {

    private val _uiState = MutableStateFlow(HomeUiState())
    val uiState: StateFlow<HomeUiState> = _uiState.asStateFlow()

    init {
        loadAll()
        viewModelScope.launch {
            userPreferences.painterName.collect { name ->
                _uiState.update { it.copy(painterName = name ?: "") }
            }
        }
        viewModelScope.launch {
            userPreferences.painterPhoto.collect { photo ->
                _uiState.update { it.copy(painterPhoto = photo) }
            }
        }
    }

    fun loadAll() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            // Load dashboard
            dashboardRepository.getDashboard().fold(
                onSuccess = { d ->
                    val level = d.level ?: "bronze"
                    val lifetime = d.totalLifetimePoints ?: 0
                    val (nextLevel, progress, remaining) = calculateLevel(level, lifetime)
                    _uiState.update {
                        it.copy(
                            thisMonthEarnings = d.thisMonthEarnings ?: 0.0,
                            regularPoints = d.regularPoints ?: 0.0,
                            annualPoints = d.annualPoints ?: 0.0,
                            checkinStreak = d.checkinStreak ?: 0,
                            thisMonthCheckins = d.thisMonthCheckins ?: 0,
                            todayCheckedIn = d.todayCheckedIn ?: false,
                            totalEstimates = d.totalEstimates ?: 0,
                            pendingEstimates = d.pendingEstimates ?: 0,
                            painterLevel = level,
                            totalLifetimePoints = lifetime,
                            nextLevelName = nextLevel,
                            levelProgress = progress,
                            pointsToNextLevel = remaining,
                            referralCode = d.referralCode,
                        )
                    }
                },
                onFailure = { e -> _uiState.update { it.copy(error = e.message) } }
            )

            // Load briefing
            dashboardRepository.getBriefing().fold(
                onSuccess = { b ->
                    _uiState.update {
                        it.copy(
                            briefingMessage = b.message,
                            briefingTips = b.tips ?: emptyList(),
                        )
                    }
                },
                onFailure = { /* silent fail for briefing */ }
            )

            // Load gamification
            dashboardRepository.getGamification().fold(
                onSuccess = { g ->
                    _uiState.update {
                        it.copy(
                            badges = g.badges ?: emptyList(),
                            activeChallenges = g.activeChallenges ?: emptyList(),
                        )
                    }
                },
                onFailure = { /* silent fail */ }
            )

            // Load offer products (grouped by brand)
            try {
                val resp = catalogApi.getOfferProducts()
                val body = resp.body()
                if (body?.success == true) {
                    val brands = body.brands ?: emptyList()
                    val products = body.products ?: emptyList()
                    val grouped = products.groupBy { it.brand ?: "" }.filterKeys { it.isNotEmpty() }
                    _uiState.update { it.copy(offerBrands = brands, offerProducts = grouped) }
                }
            } catch (_: Exception) {}

            // Load recent estimates (last 5)
            try {
                val resp = workApi.getEstimates(limit = 5, offset = 0)
                val list = resp.body()?.estimates ?: emptyList()
                _uiState.update { it.copy(recentEstimates = list) }
            } catch (_: Exception) {}

            _uiState.update { it.copy(isLoading = false) }
        }
    }

    fun toggleWithdrawalSheet() {
        _uiState.update { it.copy(showWithdrawalSheet = !it.showWithdrawalSheet) }
    }

    fun toggleStreakSheet() {
        _uiState.update { it.copy(showStreakSheet = !it.showStreakSheet) }
    }

    private fun calculateLevel(level: String, points: Int): Triple<String, Float, Int> {
        return when {
            points <= 500 -> Triple("Silver", points / 500f, 500 - points)
            points <= 2000 -> Triple("Gold", (points - 500) / 1500f, 2000 - points)
            points <= 5000 -> Triple("Diamond", (points - 2000) / 3000f, 5000 - points)
            else -> Triple("Diamond", 1f, 0)
        }
    }
}
```

Changes vs current code:
- Constructor: added `catalogApi: CatalogApi, workApi: WorkApi`
- `loadAll()`: added offer-products load + recent-estimates load
- Added `toggleWithdrawalSheet()`, `toggleStreakSheet()`
- Added `referralCode` copy in dashboard-success block

**WorkApi check:** verified `WorkApi.getEstimates(limit: Int, offset: Int)` at `EstimateApi.kt:33`. No change needed.

**Hilt binding check:** `CatalogApi` and `WorkApi` must be `@Provides`-ed in `di/AppModule.kt`. Both should already be — the painter flavor compiles (baseline) meaning Hilt graph was complete. Double-check by grepping `@Provides.*CatalogApi` and `@Provides.*WorkApi`:
```bash
grep -nE '@Provides' "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android/app/src/painter/java/com/qcpaintshop/painter/di/AppModule.kt" | head
```
If either is missing, add a `@Provides @Singleton fun provide<Type>(retrofit: Retrofit): <Type> = retrofit.create(<Type>::class.java)` method to `AppModule.kt`. **Only add what's missing.**

- [ ] **Step 3: Compile probe**

Expected drop: HomeScreen 40 errors + OfferCarousel 18 errors should mostly resolve.

- [ ] **Step 4: Commit**

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  git add app/src/painter/java/com/qcpaintshop/painter/ui/home/HomeViewModel.kt && \
  git add app/src/painter/java/com/qcpaintshop/painter/di/AppModule.kt 2>/dev/null || true && \
  git commit -m "feat(painter): HomeViewModel — offers, recent estimates, sheets, referralCode" )
```

---

## Task 10: Wire ProductDetailScreen to new endpoint

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/ui/catalog/ProductDetailScreen.kt`

ProductDetailScreen's VM (at lines 50-80) currently calls `catalogApi.getProductDetail(id)` where `id` is `Int`. Task 5 added the method with `@Path productId: String`. Fix the call site.

- [ ] **Step 1: Update the VM method**

Use Edit. Find (at lines 63-80 approximately):
```kotlin
    private fun loadProduct() {
        viewModelScope.launch {
            _uiState.value = ProductDetailUiState(isLoading = true)
            try {
                val id = productId.toIntOrNull() ?: 0
                val resp = catalogApi.getProductDetail(id)
                if (resp.isSuccessful && resp.body()?.success == true) {
                    _uiState.value = ProductDetailUiState(
                        isLoading = false,
                        product = resp.body()?.product,
                    )
                } else {
                    _uiState.value = ProductDetailUiState(
                        isLoading = false,
                        error = "Product not found",
                    )
                }
            } catch (e: Exception) {
```

Replace with:
```kotlin
    private fun loadProduct() {
        viewModelScope.launch {
            _uiState.value = ProductDetailUiState(isLoading = true)
            try {
                val resp = catalogApi.getProductDetail(productId)
                if (resp.isSuccessful && resp.body()?.success == true) {
                    _uiState.value = ProductDetailUiState(
                        isLoading = false,
                        product = resp.body()?.product,
                    )
                } else {
                    _uiState.value = ProductDetailUiState(
                        isLoading = false,
                        error = "Product not found",
                    )
                }
            } catch (e: Exception) {
```

Drops the `val id = productId.toIntOrNull() ?: 0` line and passes `productId` (String) directly.

- [ ] **Step 2: Compile probe**

- [ ] **Step 3: Commit**

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  git add app/src/painter/java/com/qcpaintshop/painter/ui/catalog/ProductDetailScreen.kt && \
  git commit -m "feat(painter): ProductDetailScreen wired to new getProductDetail(String)" )
```

---

## Task 11: Fix EstimateCreateViewModel brand/category param passing

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/ui/work/estimates/EstimateCreateViewModel.kt`

Task 5 changed `CatalogApi.getCatalog()` brand/category from `Int?` → `String?`. The caller at `EstimateCreateViewModel.kt:256-257` passes `selectedBrand?.id` (Int). Change to `selectedBrand?.name` (String).

Note: this file's `EstimateCreateApi` (the local API used) also has `brand/category: Int?` query params. Check `EstimateCreateApi.kt:41-42`. If those are `Int?`, change them to `String?` too, or — since this spec touched `CatalogApi.getCatalog()` not `EstimateCreateApi.getProducts()` — they may still be `Int?`. Verify with grep and adjust.

- [ ] **Step 1: Verify current state**

```bash
grep -nE 'brand|category' "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android/app/src/painter/java/com/qcpaintshop/painter/data/remote/api/EstimateCreateApi.kt" | head
```
If `@Query("brand") brand: Int?` shows up, update it to `String?` (same as Task 5's CatalogApi change).

- [ ] **Step 2: Update EstimateCreateApi.kt if needed**

Use Edit. Find:
```kotlin
        @Query("brand") brand: Int? = null,
        @Query("category") category: Int? = null,
```
Replace with:
```kotlin
        @Query("brand") brand: String? = null,
        @Query("category") category: String? = null,
```

- [ ] **Step 3: Update EstimateCreateViewModel.kt call site**

Use Edit. Find (around line 253-258):
```kotlin
                val response = estimateCreateApi.getProducts(
                    billingType = state.billingType,
                    search = state.searchQuery.ifBlank { null },
                    brand = state.selectedBrand?.id,
                    category = state.selectedCategory?.id,
```
Replace with:
```kotlin
                val response = estimateCreateApi.getProducts(
                    billingType = state.billingType,
                    search = state.searchQuery.ifBlank { null },
                    brand = state.selectedBrand?.name,
                    category = state.selectedCategory?.name,
```

- [ ] **Step 4: Compile probe**

- [ ] **Step 5: Commit**

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  git add \
    app/src/painter/java/com/qcpaintshop/painter/data/remote/api/EstimateCreateApi.kt \
    app/src/painter/java/com/qcpaintshop/painter/ui/work/estimates/EstimateCreateViewModel.kt && \
  git commit -m "fix(painter): EstimateCreate uses brand/category names (String), not FilterOption.id" )
```

---

## Task 12: Clean build verification

**Files:** none modified

- [ ] **Step 1: Full clean build**

Run:
```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  ./gradlew clean :app:assemblePainterRelease --no-daemon --warning-mode all 2>&1 | tail -60 )
```

Expected: `BUILD SUCCESSFUL`, 0 Kotlin errors, 0 unresolved references.

- [ ] **Step 2: Verify zero errors**

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  ./gradlew clean :app:compilePainterReleaseKotlin --no-daemon 2>&1 | grep -cE '^e: ' )
```
Expected: `0`.

- [ ] **Step 3: Verify APK produced**

```bash
ls -la "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android/app/build/outputs/apk/painter/release/"
```
Expected: a `.apk` file present.

- [ ] **Step 4: If step 1/2 fails**

Examine the error log tail. If the error is a single small issue (type mismatch, missing import), fix inline and re-run. If it's a cascade from a wrong assumption in this plan, stop and escalate — don't deepen the workaround chain.

- [ ] **Step 5: No commit** (verification only)

---

## Task 13: Manual smoke test checklist

**Files:** none modified

These are **user-run** after APK install. Document results in `audit-findings/2026-04-17/v3-smoke-test.md` if tracking.

- [ ] **Step 1: Install fresh APK + OTP login**

Expected: login succeeds, lands on home.

- [ ] **Step 2: Home screen renders**

- [ ] Painter name + photo + level visible
- [ ] Points (regular + annual) visible
- [ ] Offer carousel populates (if any active offers in DB)
- [ ] Recent estimates section shows last N estimates
- [ ] Referral code visible

- [ ] **Step 3: Home sheet toggles**

- [ ] Tap withdrawal icon/button → WithdrawalSheet shows
- [ ] Tap dismiss → sheet closes
- [ ] Tap streak icon/button → StreakSheet shows
- [ ] Tap dismiss → sheet closes

- [ ] **Step 4: Catalog**

- [ ] Products load on entry
- [ ] Search with debounce (400ms) returns filtered results
- [ ] Filter sheet: brand chip filters products
- [ ] Filter sheet: category chip filters products
- [ ] Filter sheet: "Has points" toggle filters products
- [ ] Filter sheet: "In stock" toggle filters products
- [ ] Reset filters restores full list
- [ ] Scroll to bottom loads page 2

- [ ] **Step 5: Product detail sheet**

- [ ] Tap any product card → bottom sheet opens with loading spinner
- [ ] After load: variants list shows with size, unit, rate, points
- [ ] Tap a variant → navigates to estimate create flow
- [ ] Dismiss sheet → state cleared

- [ ] **Step 6: Regression — v2.1.0 flows still work**

- [ ] Check-in flow
- [ ] Estimate create (full multi-step)
- [ ] Attendance calendar
- [ ] Profile edit
- [ ] Referrals screen

---

## Self-review

**Spec coverage check:**

| Spec section | Implementation task |
|---|---|
| New DTOs: ProductDetail, ProductVariant, OfferProduct, ProductDetailResponse | Task 3 |
| New DTOs: BalanceData | Task 2 |
| CatalogApi interface: expanded getCatalog, new getProductDetail | Task 5 |
| CatalogApi (additional): getOfferProducts + DTOs (discovered during plan research) | Tasks 4+5 |
| CatalogResponse pagination fields | Task 5 Step 2 |
| DashboardData referralCode | Task 6 |
| CatalogUiState expansion | Task 7 |
| CatalogViewModel new methods (applyFilters, resetFilters, loadMore, clearSearch, selectProduct, clearProductDetail) | Task 8 |
| HomeUiState expansion (spec said 5 fields; plan has 6 — `offerBrands` + `offerProducts` split because screen uses both separately) | Task 9 |
| HomeViewModel toggle methods + extend loadAll | Task 9 |
| ProductDetailViewModel wire getProductDetail + drop Int conversion | Task 10 |
| EstimateCreateViewModel brand/category from FilterOption.name | Task 11 |
| Success criteria: clean build | Task 12 |
| Smoke test | Task 13 |

All spec sections have tasks. **One spec deviation, documented:** spec said `ProductDetail.id: String?`; plan uses `Int?` because `ProductDetailSheet.kt:239` calls `onCreateEstimate(product.id, ...)` expecting `Int` without conversion, and backend returns `products.id` (MySQL PK, Int). Spec will not be rewritten — deviation is noted here and in Task 3 Step 2. Ship against the code reality.

**Type consistency check:**
- `ProductDetail.id: Int?` — used in Task 3 (definition) and Task 8 (selectProduct accepts Int, converts to String for path). Consistent.
- `ProductVariant.id: String?` — used in Task 3 (definition), referenced by existing `variant.id?.toIntOrNull()` in ProductDetailSheet:239. Consistent.
- `brand`/`category` parameters: Task 5 moves CatalogApi to `String?`; Task 11 moves EstimateCreateApi to `String?` and call sites to `.name`. Consistent.
- `inStockFilter` (state) vs `inStock` (query param): renamed intentionally; query param matches backend contract `?inStock=true|false`. Consistent.
- Method names: `applyFilters`, `resetFilters`, `loadMore`, `clearSearch`, `selectProduct`, `clearProductDetail`, `toggleWithdrawalSheet`, `toggleStreakSheet` — all match screen references grepped during plan research.

**Placeholder scan:** no TBD, TODO, "similar to above", or deferred details. Every code step shows the exact code.

**Known risks flagged in tasks:**
- Task 9: Hilt bindings for `CatalogApi` + `WorkApi` verified at Step 2 (build would have failed baseline otherwise — they exist)
- Task 11: `EstimateCreateApi.brand/category` type check done inline
- Task 12: fail-and-escalate policy if clean build still has errors

---

## Summary

13 tasks, 7 files modified in the painter-android repo, ~270 lines of code added/changed, zero backend work. Each task commits separately. After Task 12, the painter v3.0.0 WIP builds clean. After Task 13, features verified on-device.

**Post-merge next steps (not in this plan):**
1. Delete `audit-findings/` branch or merge `audit/2026-04-17` to master.
2. Re-invoke `painter-android-audit` skill. With the WIP now compiling, the auto-fix loop will cleanly apply the P0/P1 audit fixes (pattern 1 cascade, pattern 6 menuAnchor, pattern 8 brand/category) that failed mid-loop on 2026-04-17.
3. Separate spec to reconcile `/me/dashboard` response shape vs `DashboardData` DTO (referenced in spec's "Informational note" — several `HomeUiState` fields silently default to 0 due to drift).
