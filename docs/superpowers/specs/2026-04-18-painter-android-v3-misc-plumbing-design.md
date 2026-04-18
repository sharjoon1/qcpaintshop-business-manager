# Painter Android v3.0.0 Sub-project 3: Misc Plumbing Fixes — Design Spec

**Date:** 2026-04-18
**Status:** Approved design, awaiting implementation plan
**Author:** Claude Opus 4.7 + sharjoon1

## Goal

Close the 18 compile errors on the painter v3.0.0 WIP that are not part of the withdrawal workflow (Sub-project 2) or attendance/streak workflow (Sub-project 1). These are scattered field-alignment, DTO-extension, and API-binding fixes. Pure mechanical plumbing with no architectural choices.

## Context

- Repo: `D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\qcpaintshop-android`, branch `audit/2026-04-17`.
- Current state: 14 commits (caf899e → f83df6f) have driven compile errors from 261 → 54 across the prior data-layer completion spec (`docs/superpowers/specs/2026-04-17-painter-android-v3-data-layer-design.md`).
- Remaining 54 errors cluster into 3 independent sub-projects. Order agreed with user: 3 → 2 → 1.
- This spec covers sub-project 3 only.
- Full project state in `project_painter_android_v3_wip.md` (user auto-memory).

## Scope

Only the 18 non-workflow errors:

| File | # errors | Fix letter |
|---|---|---|
| `ui/home/components/OfferCarousel.kt` | 5 | A |
| `ui/profile/CardsViewModel.kt` | 2 | B |
| `ui/work/estimates/EstimateCreateScreen.kt` | 3 | C |
| `ui/work/estimates/EstimateCreateViewModel.kt` | 1 | D |
| `ui/work/estimates/EstimateDetailViewModel.kt` | 5 | E |
| `ui/home/HomeViewModel.kt` | 1 | F |
| `ui/catalog/ProductDetailSheet.kt` | 1 | G |

Out of scope:
- Withdrawal workflow (9 HomeScreen errors) — Sub-project 2
- Attendance + streak (27 errors across StreakSheet, AttendanceCalendarViewModel, HomeScreen) — Sub-project 1

## Architectural Decisions

| Decision | Choice | Why |
|---|---|---|
| OfferProduct `id`/`rate` | Computed aliases (`get()` properties) | Backend already returns these under `productId`/`minRate`; screens want `id`/`rate`; alias is free |
| OfferProduct `offerValue` | `var` + default `null`, client-populated via HomeViewModel join | Backend returns products and offers as parallel arrays; joining them client-side is a 5-line pass, no new endpoint |
| `PackSize.regularPoints` | New `Double? = null` field, optional | Backend `/me/catalog` doesn't return points per pack-size today; defaults stay null; screen gates on `!= null` |
| `PaymentRequest` shape | `data class PaymentRequest(val amount: Double)` | Matches backend `/me/estimates/:id/payment` body (single `amount` field) |
| `downloadPdf` return type | `Response<ResponseBody>` | PDF needs raw byte stream; Retrofit's `okhttp3.ResponseBody` is standard for binary download |
| `offer.value` smart-cast fix | `offer.value?.let { ... }` scope-function pattern | Kotlin disallows smart-cast on custom getters; `.let` captures the value in a local, non-null in the block |

## New DTO fields

### `CatalogApi.kt`

```kotlin
// Added to existing OfferProduct data class (product-with-offer type):
val id: Int? get() = productId
val rate: Double? get() = minRate
var offerValue: String? = null
```

```kotlin
// Added to existing PackSize data class:
data class PackSize(
    @SerializedName("pack_size_id") val packSizeId: Int,
    val size: String?,
    val unit: String?,
    val rate: Double?,
    val stock: Double?,
    @SerializedName("regular_points") val regularPoints: Double? = null,  // NEW
)
```

### `DashboardApi.kt`

```kotlin
data class DashboardData(
    // ... existing 14 fields ...
    val referralCode: String? = null,
    val painterName: String? = null,  // NEW
    val painterCity: String? = null,  // NEW
)
```

Both match backend `/me/dashboard` response (`routes/painters.js:615-618`) which already sends these camelCase.

### `EstimateDetailApi.kt`

```kotlin
data class PaymentRequest(val amount: Double)

interface EstimateDetailApi {
    // ... existing methods ...

    @POST("me/estimates/{id}/request-discount")
    suspend fun requestDiscount(@Path("id") id: Int): Response<GenericResponse>

    @POST("me/estimates/{id}/payment")
    suspend fun submitPayment(
        @Path("id") id: Int,
        @Body body: PaymentRequest,
    ): Response<GenericResponse>

    @GET("me/estimates/{id}/pdf")
    @Streaming
    suspend fun downloadPdf(@Path("id") id: Int): Response<okhttp3.ResponseBody>
}
```

Backend routes verified at `routes/painters.js` — all three exist. `@Streaming` annotation important for `downloadPdf` to avoid loading entire PDF into memory.

## Interface changes

### `EstimateCreateApi.getProducts` (fix D)

Add `hasPoints: Boolean? = null` param; change `brand: Int?` / `category: Int?` to `String?` (parallels Task 5's CatalogApi change).

Caller `EstimateCreateViewModel.kt:256-257` already passes `.id` → change to `.name` (same pattern as Task 11 deferred work).

## Code-level fixes

### `HomeViewModel.loadAll()` (fix F + offerValue join)

Remove `offset` arg from `workApi.getEstimates(limit = 5, offset = 0)` — signature is `getEstimates(limit)`.

After `/me/offer-products` response processes, join products to offers client-side:
```kotlin
val offersByTarget = offers.associateBy { it.targetId ?: "" }
val joined = products.map { p ->
    val offer = offersByTarget[p.brand] ?: offersByTarget[p.category]
    val display = when {
        offer?.bonusPoints != null -> "+${offer.bonusPoints.toInt()} pts"
        offer?.multiplierValue != null -> "${offer.multiplierValue}x"
        else -> null
    }
    p.apply { offerValue = display }
}
```
Then `grouped = joined.groupBy { it.brand ?: "" }.filterKeys { it.isNotEmpty() }` as before.

### `ProductDetailSheet.kt:333` (fix G)

Current:
```kotlin
if (offer.value != null) { Surface(...) { Text(offer.value, ...) } }
```
Replace with:
```kotlin
offer.value?.let { v -> Surface(...) { Text(v, ...) } }
```

## Success criteria

1. `./gradlew :app:compilePainterReleaseKotlin` error count drops 54 → 36 (18 errors cleared).
2. No new errors introduced in previously-clean files.
3. Remaining errors strictly in Sub-project 1 (StreakSheet, AttendanceCalendarViewModel) and Sub-project 2 (HomeScreen withdrawal) territories.

## Out of scope

- Full build verification (happens after Sub-projects 1 & 2 land)
- Runtime testing (user's smoke test, deferred)
- Backend changes — none needed
- Design changes to the offer-carousel join logic beyond the simple brand/category match

## Files changed (6)

| File | Change | Approx lines |
|---|---|---|
| `data/remote/api/CatalogApi.kt` | +3 aliases on OfferProduct, +1 field on PackSize | +6 |
| `data/remote/api/DashboardApi.kt` | +2 fields on DashboardData | +2 |
| `data/remote/api/EstimateCreateApi.kt` | signature: +hasPoints, brand/category→String | 3 |
| `data/remote/api/EstimateDetailApi.kt` | +PaymentRequest DTO, +3 methods | +15 |
| `ui/home/HomeViewModel.kt` | -offset arg, +offerValue client-join | +8 / -1 |
| `ui/catalog/ProductDetailSheet.kt` | smart-cast fix | 2 |
| `ui/work/estimates/EstimateCreateViewModel.kt` | brand/category `.id → .name` + hasPoints pass-through | 3 |

Total: 7 files (spec said 6 originally; +1 because EstimateCreateViewModel caller-site cascade).

## Terminal State

This spec ends here. Next step: `superpowers:writing-plans` generates the implementation plan.
