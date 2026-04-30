# Painter Android v3.0.0 Sub-project 3 — Misc Plumbing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drop compile error count from 54 → 36 on the painter v3.0.0 WIP by closing 18 scattered plumbing errors. No withdrawal workflow, no attendance/streak work — those are separate sub-projects.

**Architecture:** Pure additions + one caller-site cascade. Seven files touched, ~30 net lines. Each fix is local; commits are grouped by file/concern.

**Tech Stack:** Kotlin 2.x, Retrofit 2, Gson, Jetpack Compose Material3, Hilt DI. Build via `./gradlew :app:compilePainterReleaseKotlin --no-daemon` — no clean required (previous sub-project already validated baseline).

**Approved spec:** `docs/superpowers/specs/2026-04-18-painter-android-v3-misc-plumbing-design.md` (commit `470ca92`).

**Target repo/branch:** `D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\qcpaintshop-android` on `audit/2026-04-17` (continues from commit `f83df6f`).

---

## File Structure

7 files, 7 commits:

| File | Task | Net lines |
|---|---|---|
| `app/src/painter/.../data/remote/api/CatalogApi.kt` | Task 1 (OfferProduct aliases + offerValue) + Task 2 (PackSize.regularPoints) | +7 |
| `app/src/painter/.../data/remote/api/DashboardApi.kt` | Task 3 (painterName + painterCity) | +2 |
| `app/src/painter/.../data/remote/api/EstimateCreateApi.kt` | Task 4a (signature extension) | 3 |
| `app/src/painter/.../ui/work/estimates/EstimateCreateViewModel.kt` | Task 4b (caller cascade + hasPoints arg) | ~4 |
| `app/src/painter/.../data/remote/api/EstimateDetailApi.kt` | Task 5 (PaymentRequest + 3 methods) | +15 |
| `app/src/painter/.../ui/home/HomeViewModel.kt` | Task 6 (offset removal + offerValue client-join) | ~9 |
| `app/src/painter/.../ui/catalog/ProductDetailSheet.kt` | Task 7 (smart-cast fix) | 2 |

Task 4 touches 2 files but one commit (cascading change). Task 8 is verification only, no commit.

---

## Strategy notes

No tests exist in the painter flavor — "tests pass" = gradle compile succeeds. After each task, compile probe. The one command used throughout:

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  ./gradlew :app:compilePainterReleaseKotlin --no-daemon 2>&1 | grep -cE '^e: ' )
```

Starting error count: **54**.

---

## Task 1: Add OfferProduct aliases + offerValue field

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/data/remote/api/CatalogApi.kt`

**Purpose:** OfferCarousel references `product.id`, `product.rate`, `product.offerValue`. `OfferProduct` has `productId`, `minRate`, no offerValue. Add computed aliases + mutable field.

- [ ] **Step 1: Read the file**

The `OfferProduct` class (the product-with-offer type, used by `/me/offer-products`) is at approximately lines 143-154 of CatalogApi.kt:

```kotlin
data class OfferProduct(
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
```

- [ ] **Step 2: Add 3 aliases as class body**

Use Edit tool. Find the block above (ending with `)`) and replace with:

```kotlin
data class OfferProduct(
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
) {
    val id: Int? get() = productId
    val rate: Double? get() = minRate
    var offerValue: String? = null
}
```

**Note on `var offerValue`:** non-JSON (client-populated in Task 6). Having `var` on a data-class body-property is legal — it's a mutable member, not part of `equals/hashCode`. Gson ignores it on deserialize (no backend field of that name) and `.copy()` doesn't affect it either.

- [ ] **Step 3: Compile probe**

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  ./gradlew :app:compilePainterReleaseKotlin --no-daemon 2>&1 | grep -cE '^e: ' )
```
Expected: **49** (54 − 5 OfferCarousel errors).

- [ ] **Step 4: Commit**

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  git add app/src/painter/java/com/qcpaintshop/painter/data/remote/api/CatalogApi.kt && \
  git commit -m "feat(painter): OfferProduct aliases (id/rate) + offerValue client field" )
```

---

## Task 2: Add PackSize.regularPoints field

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/data/remote/api/CatalogApi.kt`

**Purpose:** `EstimateCreateScreen.kt:1103` references `packSize.regularPoints`. PackSize DTO doesn't have it. Add optional `Double?` field.

- [ ] **Step 1: Update PackSize data class**

Use Edit tool. Find:
```kotlin
data class PackSize(
    @SerializedName("pack_size_id") val packSizeId: Int,
    val size: String?,
    val unit: String?,
    val rate: Double?,
    val stock: Double?,
)
```

Replace with:
```kotlin
data class PackSize(
    @SerializedName("pack_size_id") val packSizeId: Int,
    val size: String?,
    val unit: String?,
    val rate: Double?,
    val stock: Double?,
    @SerializedName("regular_points") val regularPoints: Double? = null,
)
```

Default null because backend `/me/catalog` doesn't currently return this on the PackSize shape; Gson leaves it null harmlessly. If/when backend adds `regular_points` to the catalog payload, Gson will auto-populate via the `@SerializedName`.

- [ ] **Step 2: Compile probe**

Expected: **46** (49 − 3 EstimateCreateScreen regularPoints errors).

- [ ] **Step 3: Commit**

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  git add app/src/painter/java/com/qcpaintshop/painter/data/remote/api/CatalogApi.kt && \
  git commit -m "feat(painter): PackSize.regularPoints optional field" )
```

---

## Task 3: Add DashboardData.painterName + painterCity

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/data/remote/api/DashboardApi.kt`

**Purpose:** CardsViewModel reads `dashboard.painterName` and `dashboard.painterCity`. Backend already sends them camelCase (routes/painters.js:617-618). Fields missed when `referralCode` was added.

- [ ] **Step 1: Locate DashboardData closing paren**

Find the last line of the data class:
```kotlin
    @SerializedName("total_lifetime_points") val totalLifetimePoints: Int?,
    val referralCode: String? = null,
)
```

- [ ] **Step 2: Insert 2 new fields**

Use Edit tool. Replace:
```kotlin
    @SerializedName("total_lifetime_points") val totalLifetimePoints: Int?,
    val referralCode: String? = null,
)
```

With:
```kotlin
    @SerializedName("total_lifetime_points") val totalLifetimePoints: Int?,
    val referralCode: String? = null,
    val painterName: String? = null,
    val painterCity: String? = null,
)
```

No `@SerializedName` — backend sends these as camelCase.

- [ ] **Step 3: Compile probe**

Expected: **44** (46 − 2 CardsViewModel errors).

- [ ] **Step 4: Commit**

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  git add app/src/painter/java/com/qcpaintshop/painter/data/remote/api/DashboardApi.kt && \
  git commit -m "feat(painter): DashboardData.painterName + painterCity from /me/dashboard" )
```

---

## Task 4: Extend EstimateCreateApi signature + fix caller

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/data/remote/api/EstimateCreateApi.kt`
- Modify: `app/src/painter/java/com/qcpaintshop/painter/ui/work/estimates/EstimateCreateViewModel.kt`

**Purpose:** `EstimateCreateViewModel.kt:258` passes `hasPoints = ...` but API method doesn't accept it. Also `brand: Int?` / `category: Int?` should become `String?` with callers passing names. Same cascading change pattern as CatalogApi in the prior sub-project (Task 5).

### Step 1: Read EstimateCreateApi current signature

Current block (lines 36-47):
```kotlin
interface EstimateCreateApi {
    @GET("me/estimates/products")
    suspend fun getProducts(
        @Query("billing_type") billingType: String,
        @Query("search") search: String? = null,
        @Query("brand") brand: Int? = null,
        @Query("category") category: Int? = null,
    ): Response<EstimateProductsResponse>

    @POST("me/estimates")
    suspend fun createEstimate(@Body body: EstimateCreateRequest): Response<EstimateCreateResponse>
}
```

- [ ] **Step 2: Replace EstimateCreateApi interface**

Use Edit tool. Find the block above. Replace with:

```kotlin
interface EstimateCreateApi {
    @GET("me/estimates/products")
    suspend fun getProducts(
        @Query("billing_type") billingType: String,
        @Query("search") search: String? = null,
        @Query("brand") brand: String? = null,
        @Query("category") category: String? = null,
        @Query("hasPoints") hasPoints: Boolean? = null,
    ): Response<EstimateProductsResponse>

    @POST("me/estimates")
    suspend fun createEstimate(@Body body: EstimateCreateRequest): Response<EstimateCreateResponse>
}
```

Changes: brand/category `Int? → String?`, new `hasPoints: Boolean? = null` query param.

- [ ] **Step 3: Check caller site in EstimateCreateViewModel**

Read around line 255-265 of `EstimateCreateViewModel.kt`. The call likely looks like:

```kotlin
val response = estimateCreateApi.getProducts(
    billingType = state.billingType,
    search = state.searchQuery.ifBlank { null },
    brand = state.selectedBrand?.name,
    category = state.selectedCategory?.name,
    hasPoints = state.hasPointsFilter,
)
```

If the call currently passes `state.selectedBrand?.id` (Int) or `state.selectedCategory?.id`, switch to `.name` to match new String signature. If caller already uses `.name` (applied in prior sub-project's amendments), only the `hasPoints = ...` line needs alignment — ensure the param name exactly matches `hasPoints`.

- [ ] **Step 4: Update caller if needed**

Use Edit tool. Target the block in EstimateCreateViewModel.kt around the `getProducts` call. If `.id` is present, replace with `.name`; confirm `hasPoints = state.hasPointsFilter` matches the new param name (if the current code uses a different name like `hasPointsFilter` as the arg label, rename to `hasPoints`).

The correct final call:
```kotlin
val response = estimateCreateApi.getProducts(
    billingType = state.billingType,
    search = state.searchQuery.ifBlank { null },
    brand = state.selectedBrand?.name,
    category = state.selectedCategory?.name,
    hasPoints = state.hasPointsFilter,
)
```

- [ ] **Step 5: Compile probe**

Expected: **43** (44 − 1 EstimateCreateViewModel hasPoints error). Any "brand/category type mismatch" errors resolve in the same pass.

- [ ] **Step 6: Commit both files together**

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  git add \
    app/src/painter/java/com/qcpaintshop/painter/data/remote/api/EstimateCreateApi.kt \
    app/src/painter/java/com/qcpaintshop/painter/ui/work/estimates/EstimateCreateViewModel.kt && \
  git commit -m "feat(painter): EstimateCreateApi — hasPoints + String brand/category, caller aligned" )
```

---

## Task 5: Add PaymentRequest DTO + 3 methods to EstimateDetailApi

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/data/remote/api/EstimateDetailApi.kt`

**Purpose:** `EstimateDetailViewModel` calls `api.requestDiscount(id)`, `api.submitPayment(id, PaymentRequest(amount))`, `api.downloadPdf(id)` — none exist yet on the interface.

- [ ] **Step 1: Add import for okhttp3.ResponseBody**

Read EstimateDetailApi.kt — currently 39 lines. Imports block is lines 1-5. The `retrofit2.http.*` wildcard import already covers `@POST`, `@GET`, `@Path`, `@Body`, `@Streaming`. But `ResponseBody` is in `okhttp3.*` and needs explicit import.

Use Edit tool. Find the imports:
```kotlin
import com.google.gson.annotations.SerializedName
import retrofit2.Response
import retrofit2.http.*
```

Replace with:
```kotlin
import com.google.gson.annotations.SerializedName
import okhttp3.ResponseBody
import retrofit2.Response
import retrofit2.http.*
```

- [ ] **Step 2: Add PaymentRequest DTO + GenericResponse import**

`GenericResponse` is already defined in `CatalogApi.kt` — package-level, auto-accessible since all API files share the same package. No import needed.

Insert `PaymentRequest` data class before the `interface EstimateDetailApi {` line. Use Edit tool. Find:
```kotlin
interface EstimateDetailApi {
    @GET("me/estimates/{id}")
    suspend fun getEstimateDetail(@Path("id") id: Int): Response<EstimateDetailResponse>
}
```

Replace with:
```kotlin
data class PaymentRequest(val amount: Double)

interface EstimateDetailApi {
    @GET("me/estimates/{id}")
    suspend fun getEstimateDetail(@Path("id") id: Int): Response<EstimateDetailResponse>

    @POST("me/estimates/{id}/request-discount")
    suspend fun requestDiscount(@Path("id") id: Int): Response<GenericResponse>

    @POST("me/estimates/{id}/payment")
    suspend fun submitPayment(
        @Path("id") id: Int,
        @Body body: PaymentRequest,
    ): Response<GenericResponse>

    @GET("me/estimates/{id}/pdf")
    @Streaming
    suspend fun downloadPdf(@Path("id") id: Int): Response<ResponseBody>
}
```

Backend routes verified to exist at `routes/painters.js`:
- `POST /me/estimates/:id/request-discount`
- `POST /me/estimates/:id/payment`
- `GET /me/estimates/:id/pdf`

`@Streaming` on `downloadPdf` important — without it Retrofit buffers the full PDF in memory before returning, which can OOM on large files.

- [ ] **Step 3: Compile probe**

Expected: **38** (43 − 5 EstimateDetailViewModel errors).

- [ ] **Step 4: Commit**

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  git add app/src/painter/java/com/qcpaintshop/painter/data/remote/api/EstimateDetailApi.kt && \
  git commit -m "feat(painter): EstimateDetailApi — requestDiscount, submitPayment, downloadPdf + PaymentRequest DTO" )
```

---

## Task 6: Fix HomeViewModel — offset removal + offerValue client-join

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/ui/home/HomeViewModel.kt`

**Purpose:** Fix 1 compile error (line 149 `offset` arg) + populate `offerValue` on each OfferProduct from the parallel offers array in the /me/offer-products response.

- [ ] **Step 1: Read the offer-products block (around lines 135-145)**

Current block:
```kotlin
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
```

- [ ] **Step 2: Replace with offer-join version**

Use Edit tool. Find the block above. Replace with:

```kotlin
            // Load offer products (grouped by brand) with offerValue joined in
            try {
                val resp = catalogApi.getOfferProducts()
                val body = resp.body()
                if (body?.success == true) {
                    val brands = body.brands ?: emptyList()
                    val products = body.products ?: emptyList()
                    val offers = body.offers ?: emptyList()
                    val offersByTarget = offers.associateBy { it.targetId ?: "" }
                    products.forEach { p ->
                        val offer = offersByTarget[p.brand] ?: offersByTarget[p.category]
                        p.offerValue = when {
                            offer?.bonusPoints != null -> "+${offer.bonusPoints.toInt()} pts"
                            offer?.multiplierValue != null -> "${offer.multiplierValue}x"
                            else -> null
                        }
                    }
                    val grouped = products.groupBy { it.brand ?: "" }.filterKeys { it.isNotEmpty() }
                    _uiState.update { it.copy(offerBrands = brands, offerProducts = grouped) }
                }
            } catch (_: Exception) {}
```

Note: `products.forEach { p -> p.offerValue = ... }` mutates the `var` field on each `OfferProduct`. This is why offerValue is `var` (Task 1) instead of `val` — we populate in-place after parsing.

- [ ] **Step 3: Remove `offset` arg from getEstimates call**

Find:
```kotlin
                val resp = workApi.getEstimates(limit = 5, offset = 0)
```

Replace with:
```kotlin
                val resp = workApi.getEstimates(limit = 5)
```

WorkApi's `getEstimates` signature takes `limit` only. Remove the extra arg.

- [ ] **Step 4: Compile probe**

Expected: **37** (38 − 1 HomeViewModel offset error). If the errors drop more (e.g., to 35), great — could mean a cascading fix landed.

- [ ] **Step 5: Commit**

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  git add app/src/painter/java/com/qcpaintshop/painter/ui/home/HomeViewModel.kt && \
  git commit -m "fix(painter): HomeViewModel — drop offset arg + join offerValue from offers array" )
```

---

## Task 7: Fix ProductDetailSheet smart-cast

**Files:**
- Modify: `app/src/painter/java/com/qcpaintshop/painter/ui/catalog/ProductDetailSheet.kt`

**Purpose:** Kotlin forbids smart-casting custom-getter properties. Replace `if (offer.value != null) { ... offer.value ... }` with scope function `offer.value?.let { v -> ... v ... }`.

- [ ] **Step 1: Read the broken block (~lines 325-345)**

Located in the `OfferHighlightCard` composable. Current:

```kotlin
            if (offer.value != null) {
                Surface(
                    shape = RoundedCornerShape(6.dp),
                    color = QCGold,
                ) {
                    Text(
                        offer.value,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White,
                    )
                }
            }
```

- [ ] **Step 2: Replace with `.let`**

Use Edit tool. Find the block above verbatim. Replace with:

```kotlin
            offer.value?.let { v ->
                Surface(
                    shape = RoundedCornerShape(6.dp),
                    color = QCGold,
                ) {
                    Text(
                        v,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = Color.White,
                    )
                }
            }
```

Kotlin captures `offer.value` into the non-null `v` parameter — no smart-cast required, no recomputation mid-block.

- [ ] **Step 3: Compile probe**

Expected: **36** (37 − 1 smart-cast error). This matches the spec's success criteria exactly.

- [ ] **Step 4: Commit**

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  git add app/src/painter/java/com/qcpaintshop/painter/ui/catalog/ProductDetailSheet.kt && \
  git commit -m "fix(painter): ProductDetailSheet — use .let to avoid smart-cast on computed offer.value" )
```

---

## Task 8: Final verification

**Files:** none modified

- [ ] **Step 1: Confirm total drop**

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  ./gradlew :app:compilePainterReleaseKotlin --no-daemon 2>&1 | grep -cE '^e: ' )
```

Expected: **36** (down from 54).

- [ ] **Step 2: Confirm remaining errors are in Sub-project 1 & 2 territory only**

```bash
( cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  ./gradlew :app:compilePainterReleaseKotlin --no-daemon 2>&1 | grep -E '^e: ' \
    | sed -E 's|.+painter/java/com/qcpaintshop/painter/||; s|\.kt:.*|.kt|' \
    | sort | uniq -c | sort -rn )
```

Expected output (approximately):
```
   15 ui/home/components/StreakSheet.kt        ← Sub-project 1
   12 ui/profile/AttendanceCalendarViewModel.kt  ← Sub-project 1
    9 ui/home/HomeScreen.kt                    ← Sub-project 2 (withdrawal)
```

If any file outside this list shows errors, investigate — a regression may have been introduced.

- [ ] **Step 3: Confirm 7 new commits landed**

```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android" && \
  git log --oneline audit/2026-04-17 ^master | head -10
```

Expected: 7 new commits above `f83df6f chore: gitignore .superpowers/...` — one per Task 1-7.

- [ ] **Step 4: No commit for this task** — verification only.

---

## Self-review

**Spec coverage check:**

| Spec section | Plan task |
|---|---|
| Fix A — OfferProduct aliases + offerValue | Task 1 |
| Fix B — DashboardData.painterName/painterCity | Task 3 |
| Fix C — PackSize.regularPoints | Task 2 |
| Fix D — EstimateCreateApi hasPoints + String brand/category | Task 4 |
| Fix E — EstimateDetailApi methods + PaymentRequest | Task 5 |
| Fix F — HomeViewModel offset removal + offerValue join | Task 6 |
| Fix G — ProductDetailSheet smart-cast | Task 7 |
| Success criteria: 54 → 36 errors | Task 8 Step 1 |

All 7 spec fixes have tasks. One spec deviation: plan's Task 4 was spec's "Fix D" — the spec said 3 lines, plan says ~4 lines for a 2-file cascade. Minor; accounted for in Task 4 Step 4.

**Placeholder scan:** no TBD/TODO/similar-to. Every step shows exact code. Every Edit shows exact old_string/new_string. Every compile probe has a concrete expected number.

**Type consistency:**
- `OfferProduct.offerValue: var String?` — defined Task 1, mutated Task 6 via `p.offerValue = ...`. Consistent (var, not val; in class body, not primary constructor).
- `PaymentRequest` — defined Task 5 as `data class PaymentRequest(val amount: Double)`. No other task references this, so no conflict possible.
- `brand/category: String?` — Task 4 makes the API accept String; caller passes `.name` (also String). Consistent.
- Expected error count at each step: 54 → 49 → 46 → 44 → 43 → 38 → 37 → 36. Sum of drops: 5+3+2+1+5+1+1 = 18. Matches 54-36 target. ✓

**Scope check:** 7 code tasks + 1 verification task. All additive or small caller cascades. No cross-task ordering hazards — could in principle parallelize Tasks 1, 2, 3, 5, 7 (touch different files); Tasks 4 and 6 touch ViewModels that depend on prior API changes. Linear execution is fine and matches subagent-driven-development's sequential nature.

---

## Summary

8 tasks, 7 commits, 7 files, ~30 net lines. After Task 8 the painter v3.0.0 WIP will have 36 compile errors remaining — all inside Sub-project 1 (attendance/streak, 27 errors) and Sub-project 2 (withdrawal, 9 errors). Next specs brainstormed in that order.
