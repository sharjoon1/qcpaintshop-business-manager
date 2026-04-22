# EstimateCreate — Points Display + Offers Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show Regular Points (gold pill), Annual Points (green pill), and Offer Points (orange pill) on every pack-size row in EstimateCreate, and add a "🎁 Offers" filter chip that filters to offer-only products.

**Architecture:** Backend adds offer-matching to the existing `/me/estimates/products` endpoint (same SQL as `/me/catalog`). Android adds `hasOfferFilter` state to ViewModel, threads it through the screen composable, and renders pills in `PackSizeRow`.

**Tech Stack:** Express.js + MariaDB (backend) · Kotlin + Jetpack Compose + Hilt + Retrofit2 (Android painter flavor)

---

## File Map

| File | Change |
|------|--------|
| `routes/painters.js` | Add offer-fetch + match after product grouping; add `hasOffer` filter param |
| `app/src/painter/.../data/remote/api/EstimateCreateApi.kt` | Add `@Query("hasOffer")` to `getProducts()` |
| `app/src/painter/.../ui/work/estimates/EstimateCreateViewModel.kt` | Add `hasOfferFilter` to state; update `applyFilters`, `resetFilters`, `loadProducts`; add `toggleOfferFilter` |
| `app/src/painter/.../ui/work/estimates/EstimateCreateScreen.kt` | Pills in `PackSizeRow`; Offers chip in filter bar; toggle in `EstimateFilterSheet`; thread params through call sites |

Paths below use the short prefix **`ANDROID`** = `D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\qcpaintshop-android\app\src\painter\java\com\qcpaintshop\painter`
and **`WEB`** = `D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\act.qcpaintshop.com`

---

## Task 1: Backend — offer data on `/me/estimates/products`

**Files:**
- Modify: `WEB/routes/painters.js` (lines 1029–1144)

### Context

The endpoint currently returns `products` as `Object.values(productMap)` (line 1120) with no offer info. Active offers live in `painter_special_offers` and are already fetched + matched in `/me/catalog` (lines 1703–1733). We replicate that pattern here.

- [ ] **Step 1: Add `hasOffer` to query destructuring**

In `WEB/routes/painters.js` line 1031, change:
```javascript
const { billing_type, search, brand, category, product_type, hasPoints } = req.query;
```
to:
```javascript
const { billing_type, search, brand, category, product_type, hasPoints, hasOffer } = req.query;
```

- [ ] **Step 2: Add offer-fetch + match + filter after the product map**

In `WEB/routes/painters.js`, after line 1120 (`const products = Object.values(productMap);`) and before line 1122 (`const [brands] = await pool.query(`), insert:

```javascript
        // Fetch active offers and attach to each product
        const filterHasOffer = hasOffer === 'true' || hasOffer === '1';
        const now = new Date();
        const [offerRows] = await pool.query(
            `SELECT * FROM painter_special_offers
             WHERE is_active = 1 AND DATE(start_date) <= DATE(?) AND DATE(end_date) >= DATE(?)
             ORDER BY created_at DESC`,
            [now, now]
        );
        const productsWithOffers = products.map(p => {
            const matched = offerRows.filter(o => {
                if (o.applies_to === 'all') return true;
                if (o.applies_to === 'brand' && o.target_id === p.brand) return true;
                if (o.applies_to === 'category' && o.target_id === p.category) return true;
                return false;
            });
            return { ...p, offer: matched.length > 0 ? matched[0] : null };
        });
        const finalProducts = filterHasOffer
            ? productsWithOffers.filter(p => p.offer !== null)
            : productsWithOffers;
```

- [ ] **Step 3: Update `res.json` to use `finalProducts`**

In `WEB/routes/painters.js` around line 1135, change:
```javascript
        res.json({
            success: true,
            products,
```
to:
```javascript
        res.json({
            success: true,
            products: finalProducts,
```

- [ ] **Step 4: Verify with curl (manual)**

Start the server locally or check live. Run:
```bash
curl -s -H "X-Painter-Token: <valid-token>" \
  "http://localhost:3000/api/painters/me/estimates/products?billing_type=self" \
  | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log('products:', d.products?.length, '| first offer:', JSON.stringify(d.products?.[0]?.offer))"
```
Expected: `products: N | first offer: null` (or offer object if any active offer exists).

Also test `hasOffer=true`:
```bash
curl -s -H "X-Painter-Token: <valid-token>" \
  "http://localhost:3000/api/painters/me/estimates/products?billing_type=self&hasOffer=true" \
  | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); const bad=d.products?.filter(p=>!p.offer); console.log('total:', d.products?.length, '| without offer:', bad?.length)"
```
Expected: `without offer: 0`

- [ ] **Step 5: Commit backend change**

```bash
cd "D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\act.qcpaintshop.com"
git add routes/painters.js
git commit -m "feat(estimates): attach active offers to /me/estimates/products + hasOffer filter"
```

---

## Task 2: Android API + ViewModel

**Files:**
- Modify: `ANDROID/data/remote/api/EstimateCreateApi.kt`
- Modify: `ANDROID/ui/work/estimates/EstimateCreateViewModel.kt`

### 2A — API: add `hasOffer` query param

- [ ] **Step 1: Add query param to `getProducts()`**

In `EstimateCreateApi.kt`, change the `getProducts()` signature from:
```kotlin
    @GET("me/estimates/products")
    suspend fun getProducts(
        @Query("billing_type") billingType: String,
        @Query("search") search: String? = null,
        @Query("brand") brand: String? = null,
        @Query("category") category: String? = null,
        @Query("hasPoints") hasPoints: Boolean? = null,
    ): Response<EstimateProductsResponse>
```
to:
```kotlin
    @GET("me/estimates/products")
    suspend fun getProducts(
        @Query("billing_type") billingType: String,
        @Query("search") search: String? = null,
        @Query("brand") brand: String? = null,
        @Query("category") category: String? = null,
        @Query("hasPoints") hasPoints: Boolean? = null,
        @Query("hasOffer") hasOffer: Boolean? = null,
    ): Response<EstimateProductsResponse>
```

### 2B — ViewModel: state + filter logic

- [ ] **Step 2: Add `hasOfferFilter` to `EstimateCreateUiState`**

In `EstimateCreateViewModel.kt`, change the state class from:
```kotlin
    val hasPointsFilter: Boolean = false,
    val activeFilterCount: Int = 0,
```
to:
```kotlin
    val hasPointsFilter: Boolean = false,
    val hasOfferFilter: Boolean = false,
    val activeFilterCount: Int = 0,
```

- [ ] **Step 3: Update `applyFilters()` signature and body**

Replace the entire `applyFilters` function (lines 246–260):
```kotlin
    fun applyFilters(brand: FilterOption?, category: FilterOption?, hasPoints: Boolean) {
        var count = 0
        if (brand != null) count++
        if (category != null) count++
        if (hasPoints) count++
        _uiState.update {
            it.copy(
                selectedBrand = brand,
                selectedCategory = category,
                hasPointsFilter = hasPoints,
                activeFilterCount = count,
            )
        }
        loadProducts()
    }
```
with:
```kotlin
    fun applyFilters(brand: FilterOption?, category: FilterOption?, hasPoints: Boolean, hasOffer: Boolean = false) {
        var count = 0
        if (brand != null) count++
        if (category != null) count++
        if (hasPoints) count++
        if (hasOffer) count++
        _uiState.update {
            it.copy(
                selectedBrand = brand,
                selectedCategory = category,
                hasPointsFilter = hasPoints,
                hasOfferFilter = hasOffer,
                activeFilterCount = count,
            )
        }
        loadProducts()
    }
```

- [ ] **Step 4: Add `toggleOfferFilter()` helper**

After `applyFilters`, add:
```kotlin
    fun toggleOfferFilter() {
        val s = _uiState.value
        applyFilters(s.selectedBrand, s.selectedCategory, s.hasPointsFilter, !s.hasOfferFilter)
    }
```

- [ ] **Step 5: Update `resetFilters()` to clear `hasOfferFilter`**

Replace `resetFilters` (lines 262–272):
```kotlin
    fun resetFilters() {
        _uiState.update {
            it.copy(
                selectedBrand = null,
                selectedCategory = null,
                hasPointsFilter = false,
                activeFilterCount = 0,
            )
        }
        loadProducts()
    }
```
with:
```kotlin
    fun resetFilters() {
        _uiState.update {
            it.copy(
                selectedBrand = null,
                selectedCategory = null,
                hasPointsFilter = false,
                hasOfferFilter = false,
                activeFilterCount = 0,
            )
        }
        loadProducts()
    }
```

- [ ] **Step 6: Update `loadProducts()` to pass `hasOffer`**

In `loadProducts()` (lines 326–358), change the `estimateCreateApi.getProducts(...)` call from:
```kotlin
                val response = estimateCreateApi.getProducts(
                    billingType = state.billingType,
                    search = searchTerm.ifBlank { null },
                    brand = state.selectedBrand?.name,
                    category = state.selectedCategory?.name,
                    hasPoints = state.hasPointsFilter,
                )
```
to:
```kotlin
                val response = estimateCreateApi.getProducts(
                    billingType = state.billingType,
                    search = searchTerm.ifBlank { null },
                    brand = state.selectedBrand?.name,
                    category = state.selectedCategory?.name,
                    hasPoints = if (state.hasPointsFilter) true else null,
                    hasOffer = if (state.hasOfferFilter) true else null,
                )
```

- [ ] **Step 7: Commit Android API + ViewModel changes**

```bash
cd "D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\qcpaintshop-android"
git add app/src/painter/java/com/qcpaintshop/painter/data/remote/api/EstimateCreateApi.kt
git add app/src/painter/java/com/qcpaintshop/painter/ui/work/estimates/EstimateCreateViewModel.kt
git commit -m "feat(estimates): hasOffer API param + ViewModel filter state"
```

---

## Task 3: Android UI — Pills + Offers chip + Filter sheet

**Files:**
- Modify: `ANDROID/ui/work/estimates/EstimateCreateScreen.kt`

### 3A — Update `PackSizeRow` to accept offer and render pills

- [ ] **Step 1: Add `ProductOffer` import to `EstimateCreateScreen.kt`**

In `EstimateCreateScreen.kt` around line 39, add after the `PackSize` import line:
```kotlin
import com.qcpaintshop.painter.data.remote.api.ProductOffer
```

- [ ] **Step 2: Add `offer` param and replace points text with pills in `PackSizeRow`**

Replace the entire `PackSizeRow` composable (lines 1135–1217):

```kotlin
@Composable
private fun PackSizeRow(
    packSize: PackSize,
    offer: ProductOffer? = null,
    showPrice: Boolean = true,
    quantityInCart: Int,
    onAdd: () -> Unit,
) {
    val rpColor = Color(0xFFB8860B)
    val rpBg   = Color(0xFFFFF8E1)
    val apColor = QCGreen
    val apBg   = Color(0xFFE8F5E9)
    val opColor = Color(0xFFE65100)
    val opBg   = Color(0xFFFFF3E0)

    val showRp = packSize.regularPoints != null && packSize.regularPoints > 0
    val showAp = packSize.annualPoints  != null && packSize.annualPoints  > 0
    val showOp = offer != null

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "${packSize.size ?: ""} ${packSize.unit ?: ""}".trim(),
                fontSize = 13.sp,
                color = QCTextPrimary,
                modifier = Modifier.weight(1f),
            )
            if (showPrice && packSize.rate != null) {
                Text(
                    "Rs ${String.format("%.0f", packSize.rate)}",
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Medium,
                    color = QCGreen,
                )
                Spacer(Modifier.width(6.dp))
            }
            Spacer(Modifier.width(8.dp))
            if (quantityInCart > 0) {
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = QCGreen.copy(alpha = 0.1f),
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                    ) {
                        Text(
                            "$quantityInCart in cart",
                            fontSize = 11.sp,
                            color = QCGreen,
                            fontWeight = FontWeight.Medium,
                        )
                        Spacer(Modifier.width(6.dp))
                        Surface(
                            onClick = onAdd,
                            shape = CircleShape,
                            color = QCGreen,
                            modifier = Modifier.size(24.dp),
                        ) {
                            Box(contentAlignment = Alignment.Center) {
                                Icon(Icons.Default.Add, null, tint = Color.White, modifier = Modifier.size(16.dp))
                            }
                        }
                    }
                }
            } else {
                FilledTonalButton(
                    onClick = onAdd,
                    contentPadding = PaddingValues(horizontal = 12.dp, vertical = 0.dp),
                    modifier = Modifier.height(32.dp),
                    shape = RoundedCornerShape(8.dp),
                    colors = ButtonDefaults.filledTonalButtonColors(
                        containerColor = QCGreen.copy(alpha = 0.1f),
                        contentColor = QCGreen,
                    ),
                ) {
                    Icon(Icons.Default.Add, null, modifier = Modifier.size(16.dp))
                    Spacer(Modifier.width(4.dp))
                    Text("Add", fontSize = 12.sp)
                }
            }
        }
        // Points pills row — only shown when at least one pill is active
        if (showRp || showAp || showOp) {
            Row(
                modifier = Modifier.padding(top = 3.dp),
                horizontalArrangement = Arrangement.spacedBy(5.dp),
            ) {
                if (showRp) {
                    Surface(shape = RoundedCornerShape(10.dp), color = rpBg) {
                        Text(
                            "${packSize.regularPoints!!.toInt()} RP",
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            color = rpColor,
                            modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp),
                        )
                    }
                }
                if (showAp) {
                    Surface(shape = RoundedCornerShape(10.dp), color = apBg) {
                        Text(
                            "${packSize.annualPoints!!.toInt()} AP",
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            color = apColor,
                            modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp),
                        )
                    }
                }
                if (showOp) {
                    val label = offer?.value?.let { "🎁 $it" } ?: "🎁 Offer"
                    Surface(shape = RoundedCornerShape(10.dp), color = opBg) {
                        Text(
                            label,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            color = opColor,
                            modifier = Modifier.padding(horizontal = 7.dp, vertical = 2.dp),
                        )
                    }
                }
            }
        }
    }
}
```

### 3B — Pass `offer` from `ProductCard` to `PackSizeRow`

- [ ] **Step 2: Update `PackSizeRow` call site inside `ProductCard`**

In `ProductCard` (around lines 1121–1127), change:
```kotlin
                            PackSizeRow(
                                packSize = packSize,
                                showPrice = billingType == "self",
                                quantityInCart = inCart?.quantity ?: 0,
                                onAdd = { onAddToCart(packSize) },
                            )
```
to:
```kotlin
                            PackSizeRow(
                                packSize = packSize,
                                offer = product.offer,
                                showPrice = billingType == "self",
                                quantityInCart = inCart?.quantity ?: 0,
                                onAdd = { onAddToCart(packSize) },
                            )
```

### 3C — Update `ProductsStep` signature and call sites

- [ ] **Step 3: Add `hasOfferFilter` and `onToggleOfferFilter` to `ProductsStep` signature**

In `ProductsStep` (line 559–579), change:
```kotlin
    hasPointsFilter: Boolean,
    activeFilterCount: Int,
    onApplyFilters: (FilterOption?, FilterOption?, Boolean) -> Unit,
    onResetFilters: () -> Unit,
```
to:
```kotlin
    hasPointsFilter: Boolean,
    hasOfferFilter: Boolean,
    activeFilterCount: Int,
    onApplyFilters: (FilterOption?, FilterOption?, Boolean, Boolean) -> Unit,
    onResetFilters: () -> Unit,
    onToggleOfferFilter: () -> Unit,
```

- [ ] **Step 4: Fix all `onApplyFilters` call sites inside `ProductsStep` to pass `hasOfferFilter`**

There are 3 `onApplyFilters(...)` calls inside `ProductsStep`. Add `hasOfferFilter` as the 4th argument to each:

a) Brand "All Brands" dropdown item (line ~651):
```kotlin
onApplyFilters(null, selectedCategory, hasPointsFilter, hasOfferFilter); brandExpanded = false
```
b) Brand specific item (line ~655):
```kotlin
onApplyFilters(brand, selectedCategory, hasPointsFilter, hasOfferFilter); brandExpanded = false
```
c) Category "All Categories" dropdown item (line ~680):
```kotlin
onApplyFilters(selectedBrand, null, hasPointsFilter, hasOfferFilter); categoryExpanded = false
```
d) Category specific item (line ~684):
```kotlin
onApplyFilters(selectedBrand, cat, hasPointsFilter, hasOfferFilter); categoryExpanded = false
```
e) Points chip toggle (line ~695):
```kotlin
onClick = { onApplyFilters(selectedBrand, selectedCategory, !hasPointsFilter, hasOfferFilter) },
```

- [ ] **Step 5: Add "🎁 Offers" FilterChip after the Points chip**

In `ProductsStep`, after the Points `FilterChip` block (after line ~705), before the `// Clear all` block, insert:

```kotlin
            // Offers filter chip
            FilterChip(
                selected = hasOfferFilter,
                onClick = onToggleOfferFilter,
                label = { Text("🎁 Offers", fontSize = 12.sp) },
                leadingIcon = if (hasOfferFilter) {{ Icon(Icons.Default.Check, null, Modifier.size(14.dp)) }} else null,
                shape = RoundedCornerShape(20.dp),
                modifier = Modifier.height(34.dp),
                colors = FilterChipDefaults.filterChipColors(
                    selectedContainerColor = Color(0xFFE65100).copy(alpha = 0.15f),
                    selectedLabelColor = Color(0xFFE65100),
                    selectedLeadingIconColor = Color(0xFFE65100),
                ),
            )
```

### 3D — Update `EstimateFilterSheet`

- [ ] **Step 6: Add `initialHasOffer` param and update signature of `EstimateFilterSheet`**

Change the function signature from:
```kotlin
private fun EstimateFilterSheet(
    brands: List<FilterOption>,
    categories: List<FilterOption>,
    initialBrand: FilterOption?,
    initialCategory: FilterOption?,
    initialHasPoints: Boolean,
    onApply: (FilterOption?, FilterOption?, Boolean) -> Unit,
    onReset: () -> Unit,
    onDismiss: () -> Unit,
)
```
to:
```kotlin
private fun EstimateFilterSheet(
    brands: List<FilterOption>,
    categories: List<FilterOption>,
    initialBrand: FilterOption?,
    initialCategory: FilterOption?,
    initialHasPoints: Boolean,
    initialHasOffer: Boolean,
    onApply: (FilterOption?, FilterOption?, Boolean, Boolean) -> Unit,
    onReset: () -> Unit,
    onDismiss: () -> Unit,
)
```

- [ ] **Step 7: Add local `hasOffer` state and "Offer products only" toggle row inside `EstimateFilterSheet`**

After `var hasPoints by remember { mutableStateOf(initialHasPoints) }` add:
```kotlin
    var hasOffer by remember { mutableStateOf(initialHasOffer) }
```

After the `onReset` button block, also reset `hasOffer`:
```kotlin
                    hasPoints = false
                    hasOffer = false
                    onReset()
```

After the existing "Points products only" toggle row (after line ~921, before `Spacer(Modifier.height(24.dp))`), add:

```kotlin
            Spacer(Modifier.height(12.dp))

            // Offer products toggle
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Offer products only", style = MaterialTheme.typography.bodyMedium)
                Switch(
                    checked = hasOffer,
                    onCheckedChange = { hasOffer = it },
                    colors = SwitchDefaults.colors(
                        checkedThumbColor = QCSurface,
                        checkedTrackColor = Color(0xFFE65100),
                    ),
                )
            }
```

Update the Apply button's `onClick` to pass `hasOffer`:
```kotlin
                onClick = { onApply(selectedBrand, selectedCategory, hasPoints, hasOffer) },
```

### 3E — Wire `ProductsStep` call site in `EstimateCreateScreen`

- [ ] **Step 8: Add new params to `ProductsStep` call in `EstimateCreateScreen`**

In `EstimateCreateScreen` around lines 141–160, change the `ProductsStep(...)` invocation:

```kotlin
                    isProductsStep(uiState) -> ProductsStep(
                        products = uiState.products,
                        searchQuery = uiState.searchQuery,
                        cart = uiState.cart,
                        isLoading = uiState.isLoading,
                        billingType = uiState.billingType,
                        onSearch = viewModel::search,
                        onAddToCart = viewModel::addToCart,
                        onUpdateQuantity = viewModel::updateCartQuantity,
                        onRemoveFromCart = viewModel::removeFromCart,
                        cartItemCount = viewModel.cartItemCount,
                        brands = uiState.brands,
                        categories = uiState.categories,
                        selectedBrand = uiState.selectedBrand,
                        selectedCategory = uiState.selectedCategory,
                        hasPointsFilter = uiState.hasPointsFilter,
                        hasOfferFilter = uiState.hasOfferFilter,
                        activeFilterCount = uiState.activeFilterCount,
                        onApplyFilters = viewModel::applyFilters,
                        onResetFilters = viewModel::resetFilters,
                        onToggleOfferFilter = viewModel::toggleOfferFilter,
                    )
```

- [ ] **Step 9: Update `EstimateFilterSheet` call site inside `ProductsStep`**

In `ProductsStep` around line 824–841, change:
```kotlin
        EstimateFilterSheet(
            brands = brands,
            categories = categories,
            initialBrand = selectedBrand,
            initialCategory = selectedCategory,
            initialHasPoints = hasPointsFilter,
            onApply = { brand, category, hasPoints ->
                onApplyFilters(brand, category, hasPoints)
                showFilterSheet = false
            },
```
to:
```kotlin
        EstimateFilterSheet(
            brands = brands,
            categories = categories,
            initialBrand = selectedBrand,
            initialCategory = selectedCategory,
            initialHasPoints = hasPointsFilter,
            initialHasOffer = hasOfferFilter,
            onApply = { brand, category, hasPoints, hasOffer ->
                onApplyFilters(brand, category, hasPoints, hasOffer)
                showFilterSheet = false
            },
```

- [ ] **Step 10: Commit UI changes**

```bash
cd "D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\qcpaintshop-android"
git add app/src/painter/java/com/qcpaintshop/painter/ui/work/estimates/EstimateCreateScreen.kt
git commit -m "feat(estimates): RP/AP/OP pills on pack-size rows + Offers filter chip"
```

---

## Task 4: Build APK and verify

- [ ] **Step 1: Build painter release APK**

```bash
cd "D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\qcpaintshop-android"
./gradlew assemblePainterRelease
```
Expected: `BUILD SUCCESSFUL`. APK at `app/build/outputs/apk/painter/release/app-painter-release.apk`.

- [ ] **Step 2: Bump versionCode and versionName**

In `app/build.gradle`, update painter flavor:
```groovy
versionCode 14
versionName "3.1.2"
```
Then rebuild:
```bash
./gradlew assemblePainterRelease
```

- [ ] **Step 3: Send APK via Telegram**

```bash
APK_PATH="app/build/outputs/apk/painter/release/app-painter-release.apk"
curl -s -F document=@"$APK_PATH" \
  -F chat_id=930726256 \
  -F caption="Painter v3.1.2 — RP/AP/OP pills + Offers filter chip" \
  "https://api.telegram.org/bot6151083158:AAGlvK-tiU_akQyAMBTP5Kz5xQu-yZQVwPo/sendDocument"
```

- [ ] **Step 4: Deploy backend**

```bash
ssh root@161.97.114.189 "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && npm install && pm2 restart business-manager"
```

- [ ] **Step 5: Verify on device**

Install APK. Open EstimateCreate → tap + → expand a product card. Check:
1. Pack-size rows show gold `RP` pill when `regularPoints > 0`
2. Pack-size rows show green `AP` pill when `annualPoints > 0`
3. Pack-size rows show orange `🎁 +N pts` pill when product has active offer
4. Filter bar shows `🎁 Offers` chip after Points chip
5. Tapping Offers chip filters list to offer-only products
6. Filter bottom sheet has "Offer products only" toggle
7. Points chip still works independently

- [ ] **Step 6: Final commit (version bump)**

```bash
cd "D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\qcpaintshop-android"
git add app/build.gradle
git commit -m "chore: bump painter to v3.1.2 (versionCode 14)"
git push origin master
```
