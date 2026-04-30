# Color Variants B2 (Android) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface color/shade data in the Android painter catalog — color swatches on product list cards, a color filter strip in the product detail sheet, and color labels in the cart.

**Architecture:** Backend adds two columns (`ps.color_name`, `ps.color_code`) to two existing SELECT queries in `routes/painters.js`. Android data models gain nullable `colorName`/`colorCode` fields. UI reads them and renders swatches when present; null = no-op (full backward compat).

**Tech Stack:** Node.js/Express (backend), Kotlin/Jetpack Compose (Android), Gradle

---

## File Map

| File | Change |
|---|---|
| `act.qcpaintshop.com/routes/painters.js` | Add `ps.color_name`, `ps.color_code` to both catalog queries; include in push/return objects |
| `qcpaintshop-android/app/src/painter/.../data/remote/api/CatalogApi.kt` | Add `colorName`, `colorCode` to `PackSize` and `ProductVariant` |
| `qcpaintshop-android/app/src/painter/.../data/local/cart/CartStore.kt` | Add `colorName`, `colorCode` to `CartItem` |
| `qcpaintshop-android/app/src/painter/.../ui/catalog/CatalogViewModel.kt` | Pass `colorName`, `colorCode` to `CartItem` in `addToCart()` |
| `qcpaintshop-android/app/src/painter/.../ui/catalog/CatalogScreen.kt` | Color swatch strip in `ProductFamilyCard`; filter chips by selected color; update `CartRow` subtitle |
| `qcpaintshop-android/app/src/painter/.../ui/catalog/ProductDetailSheet.kt` | Color filter strip above variants table in `ProductDetailSheet` |
| `qcpaintshop-android/app/src/painter/.../ui/work/estimates/EstimateCreateScreen.kt` | Update `CartItemRow` subtitle to show color dot + name |

**Android base path shorthand:** All Android files live under `qcpaintshop-android/app/src/painter/java/com/qcpaintshop/painter/`

---

### Task 1: Backend — catalog list query returns color

**Files:**
- Modify: `act.qcpaintshop.com/routes/painters.js` lines 1711–1754

- [ ] **Step 1: Add color columns to the catalog list SELECT**

Find (line ~1711):
```javascript
                SELECT ps.product_id, ps.id AS pack_size_id, ps.size, ps.unit,
                       ps.zoho_item_id,
```

Replace with:
```javascript
                SELECT ps.product_id, ps.id AS pack_size_id, ps.size, ps.unit,
                       ps.zoho_item_id, ps.color_name, ps.color_code,
```

- [ ] **Step 2: Include color in the push object**

Find (line ~1744):
```javascript
                bySize[v.product_id].push({
                    pack_size_id: v.pack_size_id,
                    size: String(parseFloat(v.size) || v.size || ''),
                    unit: v.unit,
                    zoho_item_id: v.zoho_item_id,
                    rate,
                    mrp: parseFloat(v.mrp || v.rate || 0),
                    stock: parseFloat(v.stock || 0),
                    regular_points: reg,
                    annual_points: annualPts,
                });
```

Replace with:
```javascript
                bySize[v.product_id].push({
                    pack_size_id: v.pack_size_id,
                    size: String(parseFloat(v.size) || v.size || ''),
                    unit: v.unit,
                    zoho_item_id: v.zoho_item_id,
                    rate,
                    mrp: parseFloat(v.mrp || v.rate || 0),
                    stock: parseFloat(v.stock || 0),
                    regular_points: reg,
                    annual_points: annualPts,
                    color_name: v.color_name || null,
                    color_code: v.color_code || null,
                });
```

- [ ] **Step 3: Verify syntax**

```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/act.qcpaintshop.com"
node --check routes/painters.js && echo "SYNTAX OK"
```
Expected: `SYNTAX OK`

- [ ] **Step 4: Commit**

```bash
git add routes/painters.js
git commit -m "feat(b2): catalog list query returns color_name, color_code per pack size"
```

---

### Task 2: Backend — product detail query returns color + deploy

**Files:**
- Modify: `act.qcpaintshop.com/routes/painters.js` lines 1814–1864

- [ ] **Step 1: Add color columns to the detail SELECT**

Find (line ~1815):
```javascript
            SELECT zim.zoho_item_id as item_id, zim.zoho_item_name as name,
                   ps.id as pack_size_id,
                   ps.size as pack_size, ps.unit as pack_unit,
```

Replace with:
```javascript
            SELECT zim.zoho_item_id as item_id, zim.zoho_item_name as name,
                   ps.id as pack_size_id,
                   ps.size as pack_size, ps.unit as pack_unit,
                   ps.color_name, ps.color_code,
```

- [ ] **Step 2: Include color in the return object**

Find (line ~1853):
```javascript
            return {
                id: v.item_id,
                pack_size_id: v.pack_size_id,
                size: String(parseFloat(v.pack_size) || v.pack_size || ''),
                unit: v.pack_unit || '',
                rate,
                mrp: parseFloat(v.mrp || v.rate || 0),
                stock: parseFloat(v.stock || 0),
                regular_points: regularPts,
                annual_points: annualPts,
                image_url: v.image_url || null,
            };
```

Replace with:
```javascript
            return {
                id: v.item_id,
                pack_size_id: v.pack_size_id,
                size: String(parseFloat(v.pack_size) || v.pack_size || ''),
                unit: v.pack_unit || '',
                rate,
                mrp: parseFloat(v.mrp || v.rate || 0),
                stock: parseFloat(v.stock || 0),
                regular_points: regularPts,
                annual_points: annualPts,
                image_url: v.image_url || null,
                color_name: v.color_name || null,
                color_code: v.color_code || null,
            };
```

- [ ] **Step 3: Verify syntax**

```bash
node --check routes/painters.js && echo "SYNTAX OK"
```
Expected: `SYNTAX OK`

- [ ] **Step 4: Commit**

```bash
git add routes/painters.js
git commit -m "feat(b2): product detail query returns color_name, color_code per variant"
```

- [ ] **Step 5: Push and deploy**

```bash
git push origin master
ssh hetzner "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && pm2 restart business-manager && echo 'DEPLOY OK'"
```
Expected: `DEPLOY OK`

---

### Task 3: Android data models — add color fields

**Files:**
- Modify: `data/remote/api/CatalogApi.kt`
- Modify: `data/local/cart/CartStore.kt`

- [ ] **Step 1: Add colorName/colorCode to PackSize**

In `CatalogApi.kt`, find:
```kotlin
data class PackSize(
    @SerializedName("pack_size_id") val packSizeId: Int,
    val size: String?,
    val unit: String?,
    val rate: Double?,
    val stock: Double?,
    val mrp: Double? = null,
    @SerializedName("zoho_item_id") val zohoItemId: String? = null,
    @SerializedName("regular_points") val regularPoints: Double? = null,
    @SerializedName("annual_points") val annualPoints: Double? = null,
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
    val mrp: Double? = null,
    @SerializedName("zoho_item_id") val zohoItemId: String? = null,
    @SerializedName("regular_points") val regularPoints: Double? = null,
    @SerializedName("annual_points") val annualPoints: Double? = null,
    @SerializedName("color_name") val colorName: String? = null,
    @SerializedName("color_code") val colorCode: String? = null,
)
```

- [ ] **Step 2: Add colorName/colorCode to ProductVariant**

In `CatalogApi.kt`, find:
```kotlin
data class ProductVariant(
    val id: String?,
    @SerializedName("pack_size_id") val packSizeId: Int? = null,
    val size: String?,
    val unit: String?,
    val rate: Double?,
    val mrp: Double? = null,
    val stock: Double?,
    @SerializedName("regular_points") val regularPoints: Double?,
    @SerializedName("annual_points") val annualPoints: Double?,
    @SerializedName("image_url") val imageUrl: String?,
)
```

Replace with:
```kotlin
data class ProductVariant(
    val id: String?,
    @SerializedName("pack_size_id") val packSizeId: Int? = null,
    val size: String?,
    val unit: String?,
    val rate: Double?,
    val mrp: Double? = null,
    val stock: Double?,
    @SerializedName("regular_points") val regularPoints: Double?,
    @SerializedName("annual_points") val annualPoints: Double?,
    @SerializedName("image_url") val imageUrl: String?,
    @SerializedName("color_name") val colorName: String? = null,
    @SerializedName("color_code") val colorCode: String? = null,
)
```

- [ ] **Step 3: Add colorName/colorCode to CartItem**

In `CartStore.kt`, find:
```kotlin
data class CartItem(
    val productId: Int,
    val packSizeId: Int,
    val name: String,
    val brand: String?,
    val size: String,
    val unit: String,
    val imageUrl: String?,
    val rate: Double,        // painter / wholesale rate
    val mrp: Double,         // MRP ceiling for customer markup
    val regularPoints: Double?,
    val annualPoints: Double?,
    val quantity: Int,
)
```

Replace with:
```kotlin
data class CartItem(
    val productId: Int,
    val packSizeId: Int,
    val name: String,
    val brand: String?,
    val size: String,
    val unit: String,
    val imageUrl: String?,
    val rate: Double,        // painter / wholesale rate
    val mrp: Double,         // MRP ceiling for customer markup
    val regularPoints: Double?,
    val annualPoints: Double?,
    val quantity: Int,
    val colorName: String? = null,
    val colorCode: String? = null,
)
```

- [ ] **Step 4: Verify compile**

```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android"
./gradlew :app:kaptPainterDebugKotlin --no-build-cache 2>&1 | tail -20
```
Expected: `BUILD SUCCESSFUL`

- [ ] **Step 5: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/data/remote/api/CatalogApi.kt
git add app/src/painter/java/com/qcpaintshop/painter/data/local/cart/CartStore.kt
git commit -m "feat(b2): add colorName/colorCode to PackSize, ProductVariant, CartItem"
```

---

### Task 4: Android ViewModel — pass color to CartItem

**Files:**
- Modify: `ui/catalog/CatalogViewModel.kt` — `addToCart()` function

- [ ] **Step 1: Update addToCart to pass color**

Find in `CatalogViewModel.kt`:
```kotlin
    fun addToCart(product: CatalogProduct, packSize: PackSize) {
        cartStore.add(
            CartItem(
                productId = product.id,
                packSizeId = packSize.packSizeId,
                name = product.name ?: "Product",
                brand = product.brand,
                size = packSize.size ?: "",
                unit = packSize.unit ?: "",
                imageUrl = product.imageUrl,
                rate = packSize.rate ?: product.minRate ?: 0.0,
                mrp = packSize.mrp ?: packSize.rate ?: product.minRate ?: 0.0,
                regularPoints = packSize.regularPoints,
                annualPoints = packSize.annualPoints,
                quantity = 1,
            )
```

Replace with:
```kotlin
    fun addToCart(product: CatalogProduct, packSize: PackSize) {
        cartStore.add(
            CartItem(
                productId = product.id,
                packSizeId = packSize.packSizeId,
                name = product.name ?: "Product",
                brand = product.brand,
                size = packSize.size ?: "",
                unit = packSize.unit ?: "",
                imageUrl = product.imageUrl,
                rate = packSize.rate ?: product.minRate ?: 0.0,
                mrp = packSize.mrp ?: packSize.rate ?: product.minRate ?: 0.0,
                regularPoints = packSize.regularPoints,
                annualPoints = packSize.annualPoints,
                quantity = 1,
                colorName = packSize.colorName,
                colorCode = packSize.colorCode,
            )
```

- [ ] **Step 2: Verify compile**

```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android"
./gradlew :app:kaptPainterDebugKotlin --no-build-cache 2>&1 | tail -20
```
Expected: `BUILD SUCCESSFUL`

- [ ] **Step 3: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/ui/catalog/CatalogViewModel.kt
git commit -m "feat(b2): addToCart passes colorName/colorCode from PackSize to CartItem"
```

---

### Task 5: Android CatalogScreen — color swatches on product card

**Files:**
- Modify: `ui/catalog/CatalogScreen.kt` — `ProductFamilyCard` composable (~line 569) and `CartRow` composable (~line 941)

**Context:** `ProductFamilyCard` currently selects variants by index into the full `variants` list. We add a `selectedColorName` state that filters `variants` before index selection. `CartRow` subtitle currently shows `"${item.size}${item.unit}  •  ${inr.format(item.rate)}/unit"`.

- [ ] **Step 1: Add parseColorSafe helper**

Near the top of `CatalogScreen.kt`, after the `import` block and before the first `@Composable`, add:

```kotlin
private fun parseColorSafe(hex: String?): androidx.compose.ui.graphics.Color =
    runCatching { androidx.compose.ui.graphics.Color(android.graphics.Color.parseColor(hex)) }
        .getOrDefault(androidx.compose.ui.graphics.Color.LightGray)
```

- [ ] **Step 2: Update ProductFamilyCard to add color swatch state**

In `ProductFamilyCard`, find:
```kotlin
    val variants = product.packSizes ?: emptyList()
    var selectedIndex by remember(product.id) { mutableIntStateOf((variants.size - 1).coerceAtLeast(0)) }
    val selectedVariant = variants.getOrNull(selectedIndex)
    val displayPrice = selectedVariant?.rate ?: product.minRate
```

Replace with:
```kotlin
    val allVariants = product.packSizes ?: emptyList()
    // Distinct colors in order of first appearance; null = no color on this product
    val distinctColors = allVariants.mapNotNull { it.colorName }.distinct()
    val hasColors = distinctColors.isNotEmpty()
    var selectedColorName by remember(product.id) {
        mutableStateOf(if (hasColors) distinctColors.first() else null)
    }
    val variants = if (selectedColorName != null)
        allVariants.filter { it.colorName == selectedColorName }
    else allVariants
    var selectedIndex by remember(product.id, selectedColorName) {
        mutableIntStateOf((variants.size - 1).coerceAtLeast(0))
    }
    val selectedVariant = variants.getOrNull(selectedIndex)
    val displayPrice = selectedVariant?.rate ?: product.minRate
```

- [ ] **Step 3: Add color swatch strip below category label**

In `ProductFamilyCard` body, find:
```kotlin
                Text(product.category ?: "", fontSize = 10.sp, color = QCTextSecondary)
                // Variant chips
```

Replace with:
```kotlin
                Text(product.category ?: "", fontSize = 10.sp, color = QCTextSecondary)
                // Color swatch strip (only when product has colors)
                if (hasColors) {
                    Spacer(Modifier.height(5.dp))
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(5.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        val visibleColors = distinctColors.take(5)
                        visibleColors.forEach { colorName ->
                            val colorEntry = allVariants.first { it.colorName == colorName }
                            val isSelected = colorName == selectedColorName
                            Box(
                                modifier = Modifier
                                    .size(18.dp)
                                    .clip(CircleShape)
                                    .background(parseColorSafe(colorEntry.colorCode))
                                    .border(
                                        width = if (isSelected) 2.dp else 1.dp,
                                        color = if (isSelected) QCGreen else Color(0xFFE2E8F0),
                                        shape = CircleShape,
                                    )
                                    .clickable { selectedColorName = colorName },
                            )
                        }
                        if (distinctColors.size > 5) {
                            Text(
                                "+${distinctColors.size - 5}",
                                fontSize = 9.sp,
                                color = QCTextSecondary,
                            )
                        }
                    }
                }
                // Variant chips
```

- [ ] **Step 4: Fix the variant chip LazyRow — it already uses `variants` (filtered)**

The variant chip `LazyRow` already iterates `variants` and uses `selectedIndex`. After Step 2, `variants` is already the color-filtered list, so `selectedIndex` is always valid. No change needed here.

- [ ] **Step 5: Update CartRow subtitle to show color**

In `CatalogScreen.kt`, find `CartRow` (~line 941). Find:
```kotlin
            Text(
                "${item.size}${item.unit}  •  ${inr.format(item.rate)}/unit",
                fontSize = 11.sp, color = QCTextSecondary,
            )
```

Replace with:
```kotlin
            val sizeLabel = buildString {
                item.colorName?.let { append("$it · ") }
                append("${item.size}${item.unit}")
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                item.colorCode?.let { hex ->
                    Box(
                        modifier = Modifier
                            .size(10.dp)
                            .clip(CircleShape)
                            .background(parseColorSafe(hex))
                    )
                    Spacer(Modifier.width(4.dp))
                }
                Text(
                    "$sizeLabel  •  ${inr.format(item.rate)}/unit",
                    fontSize = 11.sp, color = QCTextSecondary,
                )
            }
```

- [ ] **Step 6: Check for missing imports**

`CircleShape` is already imported (`androidx.compose.foundation.shape.CircleShape`).
`border` needs `androidx.compose.foundation.border` — check if already imported; if not, add it.
`clip` needs `androidx.compose.ui.draw.clip` — likely already imported.

Search the existing import block for `border`:
```bash
grep "import androidx.compose.foundation.border" "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android/app/src/painter/java/com/qcpaintshop/painter/ui/catalog/CatalogScreen.kt"
```

If not found, add `import androidx.compose.foundation.border` to the imports.

- [ ] **Step 7: Verify compile**

```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android"
./gradlew :app:kaptPainterDebugKotlin --no-build-cache 2>&1 | tail -30
```
Expected: `BUILD SUCCESSFUL`

- [ ] **Step 8: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/ui/catalog/CatalogScreen.kt
git commit -m "feat(b2): color swatches on product card and color label in CartRow"
```

---

### Task 6: Android ProductDetailSheet — color filter strip

**Files:**
- Modify: `ui/catalog/ProductDetailSheet.kt`

**Context:** The sheet renders a `LazyColumn`. The "Your Earnings" section starts with a title item, then a header row item, then `items(variants)`. We need to insert a color filter strip item between the title and the header row when colors are present.

- [ ] **Step 1: Add parseColorSafe to ProductDetailSheet.kt**

At the top of `ProductDetailSheet.kt`, after the imports and the `private val inr =` line, add:

```kotlin
private fun parseColorSafe(hex: String?): Color =
    runCatching { Color(android.graphics.Color.parseColor(hex)) }
        .getOrDefault(Color.LightGray)
```

- [ ] **Step 2: Add color filter state and filtered variants list**

In `ProductDetailSheet`, find:
```kotlin
                    // Variants header
                    val variants = product.variants ?: emptyList()
                    if (variants.isNotEmpty()) {
                        item {
                            Text(
                                "Your Earnings",
```

Replace with:
```kotlin
                    // Variants header
                    val allVariants = product.variants ?: emptyList()
                    val distinctColors = allVariants.mapNotNull { it.colorName }.distinct()
                    val hasColors = distinctColors.isNotEmpty()
                    var selectedColor by remember(product.id) { mutableStateOf<String?>(null) }
                    val variants = if (selectedColor != null)
                        allVariants.filter { it.colorName == selectedColor || it.colorName == null }
                    else allVariants
                    if (allVariants.isNotEmpty()) {
                        item {
                            Text(
                                "Your Earnings",
```

- [ ] **Step 3: Insert color filter strip item after "Your Earnings" title**

Find (just after the "Your Earnings" Text item closing brace):
```kotlin
                        }

                        // Variant header row
                        item {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 20.dp)
```

Replace with:
```kotlin
                        }

                        // Color filter strip (only when product has color variants)
                        if (hasColors) {
                            item {
                                androidx.compose.foundation.lazy.LazyRow(
                                    modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    item {
                                        // "All" chip
                                        Surface(
                                            shape = RoundedCornerShape(16.dp),
                                            color = if (selectedColor == null) QCGreen else QCGreenContainer,
                                            modifier = Modifier.clickable { selectedColor = null },
                                        ) {
                                            Text(
                                                "All",
                                                fontSize = 11.sp,
                                                fontWeight = FontWeight.Medium,
                                                color = if (selectedColor == null) Color.White else QCGreen,
                                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 5.dp),
                                            )
                                        }
                                    }
                                    items(distinctColors) { colorName ->
                                        val colorEntry = allVariants.first { it.colorName == colorName }
                                        val isSelected = colorName == selectedColor
                                        Row(
                                            modifier = Modifier
                                                .clip(RoundedCornerShape(16.dp))
                                                .background(if (isSelected) QCGreenContainer else Color(0xFFF8FAFC))
                                                .border(
                                                    width = if (isSelected) 2.dp else 1.dp,
                                                    color = if (isSelected) QCGreen else Color(0xFFE2E8F0),
                                                    shape = RoundedCornerShape(16.dp),
                                                )
                                                .clickable { selectedColor = colorName }
                                                .padding(horizontal = 10.dp, vertical = 5.dp),
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                                        ) {
                                            Box(
                                                modifier = Modifier
                                                    .size(14.dp)
                                                    .clip(CircleShape)
                                                    .background(parseColorSafe(colorEntry.colorCode))
                                            )
                                            Text(
                                                colorName,
                                                fontSize = 11.sp,
                                                fontWeight = if (isSelected) FontWeight.SemiBold else FontWeight.Normal,
                                                color = if (isSelected) QCGreen else Color(0xFF374151),
                                            )
                                        }
                                    }
                                }
                            }
                        }

                        // Variant header row
                        item {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(horizontal = 20.dp)
```

- [ ] **Step 4: Add missing imports to ProductDetailSheet.kt**

Check and add any missing imports. The following may be needed:

```kotlin
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
```

The file already imports `LazyColumn` and `items` from `foundation.lazy` — verify the `LazyRow` and `border` imports are present. If the file imports `foundation.lazy.*` or `foundation.*`, they're covered. Otherwise add the specific imports above.

- [ ] **Step 5: Verify compile**

```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android"
./gradlew :app:kaptPainterDebugKotlin --no-build-cache 2>&1 | tail -30
```
Expected: `BUILD SUCCESSFUL`

- [ ] **Step 6: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/ui/catalog/ProductDetailSheet.kt
git commit -m "feat(b2): color filter strip in product detail sheet"
```

---

### Task 7: Android EstimateCreateScreen — CartItemRow shows color

**Files:**
- Modify: `ui/work/estimates/EstimateCreateScreen.kt` — `CartItemRow` composable (~line 1216)

**Context:** `CartItemRow` is a private composable in `EstimateCreateScreen.kt`. It shows the item name and `"${item.size} ${item.unit}"` as a subtitle. We add a small color dot + name when `colorName` is present.

- [ ] **Step 1: Add parseColorSafe to EstimateCreateScreen.kt**

Near the top of `EstimateCreateScreen.kt`, after the import block and before the first composable, add:

```kotlin
private fun parseColorSafe(hex: String?): androidx.compose.ui.graphics.Color =
    runCatching { androidx.compose.ui.graphics.Color(android.graphics.Color.parseColor(hex)) }
        .getOrDefault(androidx.compose.ui.graphics.Color.LightGray)
```

- [ ] **Step 2: Update CartItemRow subtitle**

Find in `CartItemRow` (~line 1237):
```kotlin
            Text(
                "${item.size} ${item.unit}".trim(),
                fontSize = 11.sp,
                color = QCTextSecondary,
            )
```

Replace with:
```kotlin
            Row(verticalAlignment = Alignment.CenterVertically) {
                item.colorCode?.let { hex ->
                    Box(
                        modifier = Modifier
                            .size(10.dp)
                            .clip(androidx.compose.foundation.shape.CircleShape)
                            .background(parseColorSafe(hex))
                    )
                    Spacer(Modifier.width(4.dp))
                }
                val sizeLabel = buildString {
                    item.colorName?.let { append("$it · ") }
                    append("${item.size} ${item.unit}".trim())
                }
                Text(sizeLabel, fontSize = 11.sp, color = QCTextSecondary)
            }
```

- [ ] **Step 3: Verify compile**

```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android"
./gradlew :app:kaptPainterDebugKotlin --no-build-cache 2>&1 | tail -30
```
Expected: `BUILD SUCCESSFUL`

- [ ] **Step 4: Commit**

```bash
git add app/src/painter/java/com/qcpaintshop/painter/ui/work/estimates/EstimateCreateScreen.kt
git commit -m "feat(b2): CartItemRow shows color dot and name in estimate create screen"
```

---

### Task 8: Build APK and deliver

**Files:** None — build and delivery only

- [ ] **Step 1: Full debug build**

```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android"
./gradlew :app:assemblePainterDebug --no-build-cache 2>&1 | tail -30
```
Expected: `BUILD SUCCESSFUL`

APK output path: `app/build/outputs/apk/painter/debug/app-painter-debug.apk`

- [ ] **Step 2: Check APK exists**

```bash
ls -lh "app/build/outputs/apk/painter/debug/app-painter-debug.apk"
```
Expected: file listed with size > 0

- [ ] **Step 3: Send APK via Telegram**

```bash
curl -s -X POST "https://api.telegram.org/bot$(grep TELEGRAM_BOT_TOKEN .env | cut -d= -f2)/sendDocument" \
  -F chat_id=930726256 \
  -F document=@"app/build/outputs/apk/painter/debug/app-painter-debug.apk" \
  -F caption="B2 Colors — painter debug build $(date +%Y-%m-%d)"
```

If the `.env` file doesn't have `TELEGRAM_BOT_TOKEN`, use the bot token directly. The bot is `@qualitycoloursbot`, chat ID `930726256`.

- [ ] **Step 4: Commit version note (optional)**

If `versionName` needs bumping (e.g. 3.1.0 → 3.1.1), update `app/build.gradle` first. Otherwise skip.

---

## Self-Review Checklist

**Spec coverage:**
- ✅ Backend catalog list: Task 1 adds `ps.color_name`, `ps.color_code` to SELECT + push object
- ✅ Backend product detail: Task 2 adds both columns to SELECT + return object
- ✅ `PackSize.colorName/colorCode`: Task 3
- ✅ `ProductVariant.colorName/colorCode`: Task 3
- ✅ `CartItem.colorName/colorCode`: Task 3
- ✅ `addToCart` passes color: Task 4
- ✅ Color swatches on product card: Task 5
- ✅ Variant chips filtered by selected color: Task 5 Step 2
- ✅ CartRow shows color dot + name: Task 5 Step 5
- ✅ Color filter strip in detail sheet: Task 6
- ✅ CartItemRow shows color dot + name: Task 7
- ✅ APK build + delivery: Task 8

**Type consistency:**
- `selectedColorName` (String?) used in Task 5 — `selectedColor` (String?) used in Task 6 — these are different variables in different composables, no conflict
- `parseColorSafe(hex: String?)` defined identically in Tasks 5, 6, 7 — same signature everywhere
- `allVariants` / `variants` naming consistent across Tasks 5 and 6
