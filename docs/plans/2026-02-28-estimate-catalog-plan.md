# Estimate Catalog Manager — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace flat Zoho items list in painter estimate page with curated products from Estimate Manager, add Zoho item mapping to pack sizes, fix mobile overflow, and fix referral sharing.

**Architecture:** Products table (with pack_sizes variations) becomes the source of truth for painter estimates. Each pack_size gets a zoho_item_id mapping. Admin manages products in admin-products.html with new Zoho mapping UI. Painter estimate page shows grouped products with size chips.

**Tech Stack:** Express.js, MySQL, Tailwind CSS, vanilla JS

---

### Task 1: Database Migration — Add zoho_item_id to pack_sizes

**Files:**
- Create: `migrations/migrate-pack-sizes-zoho-mapping.js`

**Step 1: Write the migration script**

```javascript
// migrations/migrate-pack-sizes-zoho-mapping.js
const pool = require('../config/database');

async function migrate() {
    console.log('Starting pack_sizes Zoho mapping migration...');

    // Add zoho_item_id column to pack_sizes
    const [cols] = await pool.query(
        "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pack_sizes' AND COLUMN_NAME = 'zoho_item_id'"
    );

    if (cols.length === 0) {
        await pool.query("ALTER TABLE pack_sizes ADD COLUMN zoho_item_id VARCHAR(100) NULL AFTER base_price");
        await pool.query("ALTER TABLE pack_sizes ADD INDEX idx_zoho_item (zoho_item_id)");
        console.log('Added zoho_item_id column to pack_sizes');
    } else {
        console.log('zoho_item_id column already exists');
    }

    console.log('Migration complete!');
    process.exit(0);
}

migrate().catch(err => { console.error('Migration failed:', err); process.exit(1); });
```

**Step 2: Run the migration**

Run: `node migrations/migrate-pack-sizes-zoho-mapping.js`
Expected: "Added zoho_item_id column to pack_sizes" + "Migration complete!"

**Step 3: Commit**

```bash
git add migrations/migrate-pack-sizes-zoho-mapping.js
git commit -m "feat: add zoho_item_id column to pack_sizes table"
```

---

### Task 2: Backend — Zoho Items Search Endpoint for Mapping

**Files:**
- Modify: `server.js:2441-2470` (POST /api/products)
- Modify: `server.js:2473-2502` (PUT /api/products/:id)

**Step 1: Update POST /api/products endpoint**

In `server.js`, find the POST `/api/products` endpoint (line 2441). Update the pack_sizes INSERT to include zoho_item_id:

```javascript
// In the existing pack_sizes insertion loop (around line 2456):
await pool.query(
    'INSERT INTO pack_sizes (product_id, size, unit, base_price, zoho_item_id, is_active) VALUES (?, ?, ?, ?, ?, 1)',
    [productId, pack.size, pack.unit || 'L', pack.base_price || pack.price, pack.zoho_item_id || null]
);
```

**Step 2: Update PUT /api/products/:id endpoint**

In `server.js`, find the PUT `/api/products/:id` endpoint (line 2473). Update the pack_sizes INSERT to include zoho_item_id:

```javascript
// In the existing pack_sizes insertion loop (around line 2489):
await pool.query(
    'INSERT INTO pack_sizes (product_id, size, unit, base_price, zoho_item_id, is_active) VALUES (?, ?, ?, ?, ?, 1)',
    [req.params.id, pack.size, pack.unit || 'L', pack.base_price || pack.price, pack.zoho_item_id || null]
);
```

**Step 3: Update GET /api/products/:id to return zoho_item_id in pack_sizes**

The existing query at line 2430 already does `SELECT * FROM pack_sizes` so zoho_item_id will be included automatically.

**Step 4: Add a new endpoint to search Zoho items for the mapping dropdown**

Add this BEFORE the existing products endpoints (around line 2395):

```javascript
// Search Zoho items for pack size mapping dropdown
app.get('/api/products/zoho-items-search', requireAuth, async (req, res) => {
    try {
        const { search } = req.query;
        let where = "WHERE (zoho_status = 'active' OR zoho_status IS NULL)";
        const params = [];
        if (search) {
            where += ' AND (zoho_item_name LIKE ? OR zoho_brand LIKE ? OR zoho_sku LIKE ?)';
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        const [items] = await pool.query(`
            SELECT zoho_item_id, zoho_item_name, zoho_brand, zoho_rate, zoho_sku
            FROM zoho_items_map ${where}
            ORDER BY zoho_brand, zoho_item_name
            LIMIT 50
        `, params);
        res.json({ success: true, items });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
```

**IMPORTANT:** This endpoint MUST be placed BEFORE `app.get('/api/products/:id', ...)` (line 2415) otherwise Express will match `:id` = "zoho-items-search".

**Step 5: Commit**

```bash
git add server.js
git commit -m "feat: add zoho_item_id support to products endpoints + zoho items search"
```

---

### Task 3: Admin UI — Zoho Mapping in Pack Sizes

**Files:**
- Modify: `public/admin-products.html`

**Step 1: Add Zoho items cache variable**

In `admin-products.html`, around line 290, add:

```javascript
let zohoItemsCache = []; // For pack size mapping dropdown
```

**Step 2: Add zohoItemSearch function**

After the existing `getAuthHeaders()` function (around line 299), add:

```javascript
async function searchZohoItems(query) {
    try {
        const res = await fetch(`/api/products/zoho-items-search?search=${encodeURIComponent(query)}`, { headers: getAuthHeaders() });
        const data = await res.json();
        return data.success ? data.items : [];
    } catch (e) {
        console.error('Zoho search error:', e);
        return [];
    }
}
```

**Step 3: Update `addPackSize()` function**

Find `addPackSize()` (around line 486). After pushing to the array, include zoho_item_id:

```javascript
function addPackSize() {
    const size = parseFloat(document.getElementById('newPackSize').value);
    const unit = document.getElementById('newPackUnit').value;
    const price = parseFloat(document.getElementById('newPackPrice').value);
    if (!size || !price) { alert('Enter both size and price'); return; }
    packSizes.push({ size, unit, price, base_price: price, zoho_item_id: null, zoho_item_name: '' });
    renderPackSizes();
    document.getElementById('newPackSize').value = '';
    document.getElementById('newPackUnit').value = 'L';
    document.getElementById('newPackPrice').value = '';
}
```

**Step 4: Update `renderPackSizes()` function**

Replace the existing `renderPackSizes()` (around line 513-528) with:

```javascript
function renderPackSizes() {
    const container = document.getElementById('packSizesList');
    if (packSizes.length === 0) {
        container.innerHTML = '<p class="text-sm text-gray-500 italic">No pack sizes added yet</p>';
        return;
    }
    container.innerHTML = packSizes.map((ps, idx) => `
        <div class="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-2">
            <div class="flex items-center justify-between">
                <span class="font-semibold text-gray-700">${ps.size} ${ps.unit || 'L'}</span>
                <span class="text-gray-900">₹${parseFloat(ps.price).toFixed(2)}</span>
                <button type="button" onclick="removePackSize(${idx})" class="text-red-600 hover:text-red-800 font-semibold text-sm">Remove</button>
            </div>
            <div class="flex items-center gap-2">
                <label class="text-xs text-gray-500 whitespace-nowrap">Zoho Item:</label>
                <div class="relative flex-1">
                    <input type="text"
                        id="zohoSearch_${idx}"
                        class="w-full px-2 py-1.5 border border-gray-300 rounded text-xs focus:border-purple-500 focus:outline-none"
                        placeholder="Search Zoho item to map..."
                        value="${ps.zoho_item_name || ''}"
                        oninput="debounceZohoSearch(${idx})"
                        onfocus="debounceZohoSearch(${idx})"
                    >
                    <div id="zohoDropdown_${idx}" class="absolute z-50 top-full left-0 right-0 bg-white border border-gray-300 rounded-b shadow-lg max-h-40 overflow-y-auto" style="display:none"></div>
                </div>
                ${ps.zoho_item_id ? `<span class="text-xs text-green-600 font-medium whitespace-nowrap">✓ Mapped</span>` : `<span class="text-xs text-orange-500 whitespace-nowrap">Not mapped</span>`}
            </div>
        </div>
    `).join('');
}
```

**Step 5: Add Zoho search debounce and dropdown logic**

Add after `renderPackSizes()`:

```javascript
let zohoSearchTimers = {};

function debounceZohoSearch(idx) {
    clearTimeout(zohoSearchTimers[idx]);
    zohoSearchTimers[idx] = setTimeout(() => showZohoDropdown(idx), 300);
}

async function showZohoDropdown(idx) {
    const input = document.getElementById(`zohoSearch_${idx}`);
    const dropdown = document.getElementById(`zohoDropdown_${idx}`);
    if (!input || !dropdown) return;

    const query = input.value.trim();
    const items = await searchZohoItems(query);

    if (!items.length) {
        dropdown.innerHTML = '<div class="px-3 py-2 text-xs text-gray-400">No items found</div>';
        dropdown.style.display = 'block';
        return;
    }

    dropdown.innerHTML = items.map(item => `
        <div class="px-3 py-2 text-xs hover:bg-purple-50 cursor-pointer border-b border-gray-100"
             onclick="selectZohoItem(${idx}, '${item.zoho_item_id}', '${(item.zoho_item_name || '').replace(/'/g, "\\'")}')">
            <div class="font-medium text-gray-800">${item.zoho_item_name}</div>
            <div class="text-gray-500">${item.zoho_brand || ''} • ₹${item.zoho_rate || 0}</div>
        </div>
    `).join('');
    dropdown.style.display = 'block';

    // Close on outside click
    setTimeout(() => {
        document.addEventListener('click', function closeDropdown(e) {
            if (!dropdown.contains(e.target) && e.target !== input) {
                dropdown.style.display = 'none';
                document.removeEventListener('click', closeDropdown);
            }
        });
    }, 100);
}

function selectZohoItem(idx, zohoItemId, zohoItemName) {
    packSizes[idx].zoho_item_id = zohoItemId;
    packSizes[idx].zoho_item_name = zohoItemName;
    renderPackSizes();
}
```

**Step 6: Update `editProduct()` to load zoho_item_id from pack_sizes**

In `editProduct()` (around line 562), update the pack sizes loading section. After the pack sizes are parsed, fetch the product detail with pack_sizes from DB:

Replace the pack sizes loading block (lines 580-607) with:

```javascript
// Load pack sizes from server (includes zoho_item_id)
try {
    const psRes = await fetch(`/api/products/${id}`, { headers: getAuthHeaders() });
    const psData = await psRes.json();
    if (psData.pack_sizes && psData.pack_sizes.length > 0) {
        packSizes = psData.pack_sizes.map(ps => ({
            size: ps.size,
            unit: ps.unit || 'L',
            price: parseFloat(ps.base_price),
            base_price: parseFloat(ps.base_price),
            zoho_item_id: ps.zoho_item_id || null,
            zoho_item_name: '' // Will be populated by display
        }));
        // Fetch Zoho item names for mapped items
        for (let i = 0; i < packSizes.length; i++) {
            if (packSizes[i].zoho_item_id) {
                const items = await searchZohoItems(packSizes[i].zoho_item_id);
                const match = items.find(it => it.zoho_item_id == packSizes[i].zoho_item_id);
                if (match) packSizes[i].zoho_item_name = match.zoho_item_name;
            }
        }
    } else if (product.available_sizes) {
        try {
            packSizes = JSON.parse(product.available_sizes);
            if (!Array.isArray(packSizes)) packSizes = [];
            packSizes = packSizes.map(ps => ({
                size: typeof ps === 'number' ? ps : ps.size,
                unit: ps.unit || 'L',
                price: ps.price || ps.base_price || parseFloat(product.base_price),
                base_price: ps.base_price || ps.price || parseFloat(product.base_price),
                zoho_item_id: null,
                zoho_item_name: ''
            }));
        } catch (e) { packSizes = []; }
    }
} catch (e) { console.error('Error loading pack sizes:', e); }
```

Note: `editProduct()` must become `async function editProduct(id)`.

**Step 7: Update `saveProduct()` to send zoho_item_id**

In `saveProduct()` (around line 621), update the `available_sizes` JSON to include zoho_item_id. The packSizes already contains zoho_item_id from the UI, so the JSON.stringify at line 638 will include it automatically. No code change needed here — the backend will read it.

**Step 8: Commit**

```bash
git add public/admin-products.html
git commit -m "feat: add Zoho item mapping UI to pack sizes in admin products"
```

---

### Task 4: Backend — Painter Estimate Catalog Endpoint

**Files:**
- Modify: `routes/painters.js:425-489`

**Step 1: Replace `/me/estimates/products` endpoint**

In `routes/painters.js`, replace the existing `/me/estimates/products` route (lines 425-489) with a new catalog endpoint that returns grouped products:

```javascript
// Painter estimate catalog - grouped products with pack sizes
router.get('/me/estimates/products', requirePainterAuth, async (req, res) => {
    try {
        const { billing_type, search, brand, category, product_type } = req.query;

        // Base query: products with mapped pack sizes only
        let where = "WHERE p.status = 'active' AND ps.is_active = 1 AND ps.zoho_item_id IS NOT NULL";
        const params = [];

        if (search) {
            where += ' AND (p.name LIKE ? OR b.name LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }
        if (brand) {
            where += ' AND b.id = ?';
            params.push(brand);
        }
        if (category) {
            where += ' AND c.id = ?';
            params.push(category);
        }
        if (product_type) {
            where += ' AND p.product_type = ?';
            params.push(product_type);
        }

        // Get products with pack sizes
        const [rows] = await pool.query(`
            SELECT p.id, p.name, p.product_type, p.area_coverage, p.gst_percentage,
                   b.name as brand, b.id as brand_id,
                   c.name as category, c.id as category_id,
                   ps.id as pack_size_id, ps.size, ps.unit, ps.base_price, ps.zoho_item_id,
                   zim.zoho_rate, zim.zoho_stock_on_hand as stock
            FROM products p
            LEFT JOIN brands b ON p.brand_id = b.id
            LEFT JOIN categories c ON p.category_id = c.id
            INNER JOIN pack_sizes ps ON ps.product_id = p.id
            LEFT JOIN zoho_items_map zim ON zim.zoho_item_id = ps.zoho_item_id
            ${where}
            ORDER BY b.name, p.name, ps.size
        `, params);

        // Group by product
        const productMap = {};
        for (const row of rows) {
            if (!productMap[row.id]) {
                productMap[row.id] = {
                    id: row.id,
                    name: row.name,
                    brand: row.brand,
                    brand_id: row.brand_id,
                    category: row.category,
                    category_id: row.category_id,
                    product_type: row.product_type,
                    area_coverage: row.area_coverage ? parseFloat(row.area_coverage) : null,
                    gst_percentage: row.gst_percentage ? parseFloat(row.gst_percentage) : 18,
                    pack_sizes: []
                };
            }
            const showPrices = billing_type === 'self';
            productMap[row.id].pack_sizes.push({
                pack_size_id: row.pack_size_id,
                size: parseFloat(row.size),
                unit: row.unit,
                rate: showPrices ? parseFloat(row.zoho_rate || row.base_price || 0) : null,
                zoho_item_id: row.zoho_item_id,
                stock: parseFloat(row.stock || 0)
            });
        }

        const products = Object.values(productMap);

        // Get brands & categories that have mapped products
        const [brands] = await pool.query(`
            SELECT DISTINCT b.id, b.name FROM brands b
            INNER JOIN products p ON p.brand_id = b.id AND p.status = 'active'
            INNER JOIN pack_sizes ps ON ps.product_id = p.id AND ps.is_active = 1 AND ps.zoho_item_id IS NOT NULL
            ORDER BY b.name
        `);
        const [categories] = await pool.query(`
            SELECT DISTINCT c.id, c.name FROM categories c
            INNER JOIN products p ON p.category_id = c.id AND p.status = 'active'
            INNER JOIN pack_sizes ps ON ps.product_id = p.id AND ps.is_active = 1 AND ps.zoho_item_id IS NOT NULL
            ORDER BY c.name
        `);

        res.json({
            success: true,
            products,
            brands: brands.map(b => ({ id: b.id, name: b.name })),
            categories: categories.map(c => ({ id: c.id, name: c.name }))
        });
    } catch (error) {
        console.error('Estimate catalog error:', error);
        res.status(500).json({ success: false, message: 'Failed to load catalog' });
    }
});
```

**Step 2: Update POST `/me/estimates` to handle pack_size_id**

In `routes/painters.js`, find the POST `/me/estimates` (line 508). The `items` array from frontend will now send `{ pack_size_id, quantity }` instead of `{ item_id, quantity }`. Update the items validation (lines 525-559):

```javascript
// Replace the item validation block (lines 525-559) with:

// Validate items — each has pack_size_id + quantity
const packSizeIds = items.map(i => i.pack_size_id || i.item_id);
const [packSizeRows] = await pool.query(`
    SELECT ps.id as pack_size_id, ps.zoho_item_id, ps.size, ps.unit, ps.base_price, ps.product_id,
           p.name as product_name, p.product_type,
           zim.zoho_item_name, zim.zoho_brand, zim.zoho_category_name, zim.zoho_rate
    FROM pack_sizes ps
    INNER JOIN products p ON p.id = ps.product_id
    LEFT JOIN zoho_items_map zim ON zim.zoho_item_id = ps.zoho_item_id
    WHERE ps.id IN (?) AND ps.is_active = 1
`, [packSizeIds]);

const packSizeMap = {};
packSizeRows.forEach(r => { packSizeMap[r.pack_size_id] = r; });

let subtotal = 0;
const lineItems = [];
for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const psId = item.pack_size_id || item.item_id;
    const psRow = packSizeMap[psId];
    if (!psRow || !psRow.zoho_item_id) {
        return res.status(400).json({ success: false, message: `Product not found or not mapped: ${psId}` });
    }
    const qty = parseFloat(item.quantity) || 1;
    const unitPrice = parseFloat(psRow.zoho_rate || psRow.base_price || 0);
    const lineTotal = qty * unitPrice;
    subtotal += lineTotal;
    lineItems.push({
        zoho_item_id: psRow.zoho_item_id,
        item_name: `${psRow.product_name} ${psRow.size}${psRow.unit}`,
        brand: psRow.zoho_brand,
        category: psRow.zoho_category_name,
        quantity: qty,
        unit_price: unitPrice,
        line_total: lineTotal,
        display_order: i
    });
}
```

**Step 3: Commit**

```bash
git add routes/painters.js
git commit -m "feat: replace flat Zoho items with grouped catalog in painter estimates"
```

---

### Task 5: Frontend — Redesign Painter Estimate Create Page

**Files:**
- Modify: `public/painter-estimate-create.html`

**Step 1: Fix mobile overflow**

Add these CSS rules in the `<style>` block (after line 11):

```css
* { box-sizing: border-box; }
html, body { max-width: 100vw; overflow-x: hidden; }
```

**Step 2: Add product type filter**

In Step 3 filters (around line 126), add a product type toggle and replace brand/category with ID-based selects:

Replace lines 126-133 with:

```html
<div class="flex gap-2 mb-2">
    <button type="button" class="type-tab active" data-type="" onclick="filterByType(this, '')">All</button>
    <button type="button" class="type-tab" data-type="unit_wise" onclick="filterByType(this, 'unit_wise')">Unit Wise</button>
    <button type="button" class="type-tab" data-type="area_wise" onclick="filterByType(this, 'area_wise')">Area Wise</button>
</div>
<div class="flex gap-2">
    <select id="brandFilter" class="filter-select flex-1 min-w-0" onchange="loadProducts()">
        <option value="">All Brands</option>
    </select>
    <select id="categoryFilter" class="filter-select flex-1 min-w-0" onchange="loadProducts()">
        <option value="">All Categories</option>
    </select>
</div>
```

Add the tab CSS in the style block:

```css
.type-tab { padding: 0.375rem 0.75rem; border-radius: 8px; font-size: 0.75rem; font-weight: 600; border: 1px solid #d1d5db; background: #fff; color: #6b7280; cursor: pointer; transition: all 0.15s; white-space: nowrap; }
.type-tab.active { background: #1B5E3B; color: #fff; border-color: #1B5E3B; }
```

**Step 3: Rewrite `loadProducts()` function**

Replace the existing `loadProducts()` (lines 245-286) with:

```javascript
let selectedType = '';

function filterByType(el, type) {
    selectedType = type;
    document.querySelectorAll('.type-tab').forEach(t => t.classList.remove('active'));
    el.classList.add('active');
    loadProducts();
}

async function loadProducts() {
    const search = document.getElementById('productSearch').value;
    const brand = document.getElementById('brandFilter').value;
    const category = document.getElementById('categoryFilter').value;

    try {
        const params = new URLSearchParams({ billing_type: billingType });
        if (search) params.set('search', search);
        if (brand) params.set('brand', brand);
        if (category) params.set('category', category);
        if (selectedType) params.set('product_type', selectedType);

        const res = await fetch(`${API}/me/estimates/products?${params}`, { headers: painterHeaders() });
        if (res.status === 401) { window.location.href = '/painter-login.html'; return; }
        const data = await res.json();
        if (!data.success) throw new Error(data.message);

        allProducts = data.products;

        // Populate filter dropdowns (only on first load)
        const brandSelect = document.getElementById('brandFilter');
        if (brandSelect.options.length <= 1 && data.brands.length) {
            data.brands.forEach(b => {
                const opt = document.createElement('option');
                opt.value = b.id; opt.textContent = b.name;
                brandSelect.appendChild(opt);
            });
        }
        const catSelect = document.getElementById('categoryFilter');
        if (catSelect.options.length <= 1 && data.categories.length) {
            data.categories.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.id; opt.textContent = c.name;
                catSelect.appendChild(opt);
            });
        }

        renderProducts(data.products);
    } catch (err) {
        console.error('Load products error:', err);
        document.getElementById('productList').innerHTML = '<div class="text-center py-4 text-red-500 text-sm">Failed to load products</div>';
    }
}
```

**Step 4: Rewrite `renderProducts()` — grouped product cards**

Replace the existing `renderProducts()` (lines 288-325) with:

```javascript
function renderProducts(products) {
    const container = document.getElementById('productList');
    if (!products.length) {
        container.innerHTML = '<div class="text-center py-8 text-gray-400 text-sm">No products found</div>';
        return;
    }

    container.innerHTML = products.map(p => {
        const typeLabel = p.product_type === 'area_wise' ? 'Area' : 'Unit';
        const typeBg = p.product_type === 'area_wise' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700';

        return `
        <div class="product-card" style="flex-direction:column;align-items:stretch;gap:0.5rem;">
            <div class="flex items-start justify-between gap-2">
                <div class="flex-1 min-w-0">
                    <div class="text-sm font-semibold text-gray-800">${esc(p.name)}</div>
                    <div class="flex items-center gap-2 mt-0.5 flex-wrap">
                        ${p.brand ? `<span class="text-xs text-gray-500">${esc(p.brand)}</span>` : ''}
                        <span class="badge ${typeBg}" style="font-size:0.625rem">${typeLabel}</span>
                        ${p.area_coverage ? `<span class="text-xs text-gray-400">${p.area_coverage} sq ft/L</span>` : ''}
                    </div>
                </div>
            </div>
            <div class="flex flex-wrap gap-1.5">
                ${p.pack_sizes.map(ps => {
                    const key = `${p.id}_${ps.pack_size_id}`;
                    const inCart = cart[key];
                    if (inCart) {
                        return `
                        <div class="flex items-center gap-1 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1">
                            <button class="qty-btn" style="width:24px;height:24px;font-size:0.875rem;" onclick="updateQty('${key}', -1)">−</button>
                            <span class="text-xs font-semibold w-5 text-center">${inCart.quantity}</span>
                            <button class="qty-btn" style="width:24px;height:24px;font-size:0.875rem;" onclick="updateQty('${key}', 1)">+</button>
                            <span class="text-xs font-medium text-emerald-700 ml-1">${ps.size}${ps.unit}</span>
                            ${ps.rate !== null ? `<span class="text-xs text-gray-500">₹${ps.rate.toLocaleString('en-IN')}</span>` : ''}
                        </div>`;
                    }
                    return `
                    <button onclick="addToCart('${key}', ${p.id}, ${ps.pack_size_id})"
                            class="px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors
                            ${ps.stock > 0 ? 'text-emerald-700 border-emerald-200 hover:bg-emerald-50' : 'text-gray-400 border-gray-200'}">
                        ${ps.size}${ps.unit}${ps.rate !== null ? ` • ₹${ps.rate.toLocaleString('en-IN')}` : ''}
                    </button>`;
                }).join('')}
            </div>
        </div>`;
    }).join('');
}
```

**Step 5: Rewrite cart functions**

Replace `addToCart`, `updateQty`, `updateCartUI` with cart logic keyed by `productId_packSizeId`:

```javascript
// cart key = "productId_packSizeId"
function addToCart(key, productId, packSizeId) {
    const product = allProducts.find(p => p.id === productId);
    if (!product) return;
    const ps = product.pack_sizes.find(s => s.pack_size_id === packSizeId);
    if (!ps) return;
    cart[key] = {
        product_id: productId,
        pack_size_id: packSizeId,
        zoho_item_id: ps.zoho_item_id,
        name: product.name,
        brand: product.brand,
        size: ps.size,
        unit: ps.unit,
        rate: ps.rate,
        stock: ps.stock,
        quantity: 1
    };
    renderProducts(allProducts);
    updateCartUI();
}

function updateQty(key, delta) {
    if (!cart[key]) return;
    cart[key].quantity += delta;
    if (cart[key].quantity <= 0) delete cart[key];
    renderProducts(allProducts);
    updateCartUI();
}

function clearCart() {
    cart = {};
    renderProducts(allProducts);
    updateCartUI();
}

function updateCartUI() {
    const items = Object.values(cart);
    const count = items.length;
    const totalQty = items.reduce((s, i) => s + i.quantity, 0);

    document.getElementById('cartCount').textContent = `${count} items`;
    document.getElementById('floatingCartCount').textContent = `${count} items (${totalQty} qty)`;

    if (count === 0) {
        document.getElementById('floatingCart').style.display = 'none';
        document.getElementById('cartSection').style.display = 'none';
        return;
    }

    document.getElementById('floatingCart').style.display = 'block';
    document.getElementById('cartSection').style.display = 'block';

    document.getElementById('cartItems').innerHTML = items.map(i => `
        <div class="cart-item">
            <div class="flex-1 min-w-0">
                <div class="text-sm font-medium truncate">${esc(i.name)} — ${i.size}${i.unit}</div>
                <div class="text-xs text-gray-400">${esc(i.brand || '')} • Qty: ${i.quantity}</div>
            </div>
            <div class="text-right flex-shrink-0">
                ${i.rate !== null ? `<div class="text-sm font-semibold">₹${(i.rate * i.quantity).toLocaleString('en-IN')}</div>` : '<div class="text-xs text-gray-400">Price by admin</div>'}
            </div>
            <button class="ml-2 text-gray-400 hover:text-red-500" onclick="delete cart['${i.product_id}_${i.pack_size_id}'];renderProducts(allProducts);updateCartUI();">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
        </div>
    `).join('');

    if (billingType === 'self') {
        const subtotal = items.reduce((s, i) => s + (i.rate || 0) * i.quantity, 0);
        document.getElementById('cartTotals').innerHTML = `
            <div class="flex justify-between text-sm text-gray-600 mb-1"><span>Subtotal</span><span>₹${subtotal.toLocaleString('en-IN')}</span></div>
            <div class="flex justify-between text-sm text-gray-600 mb-1"><span>GST (18%)</span><span>₹${(subtotal * 0.18).toLocaleString('en-IN')}</span></div>
            <div class="flex justify-between font-semibold text-gray-800 pt-1 border-t border-gray-200"><span>Grand Total</span><span>₹${(subtotal * 1.18).toLocaleString('en-IN')}</span></div>
        `;
        document.getElementById('floatingCartTotal').textContent = `₹${(subtotal * 1.18).toLocaleString('en-IN')}`;
    } else {
        document.getElementById('cartTotals').innerHTML = '<div class="text-sm text-gray-500 text-center">Prices will be set by admin after review</div>';
        document.getElementById('floatingCartTotal').textContent = '';
    }
}
```

**Step 6: Update `submitEstimate()` to send pack_size_id**

Replace the items mapping in `submitEstimate()` (around line 412):

```javascript
items: Object.values(cart).map(i => ({ pack_size_id: i.pack_size_id, quantity: i.quantity })),
```

**Step 7: Commit**

```bash
git add public/painter-estimate-create.html
git commit -m "feat: redesign painter estimate page with grouped products and size chips"
```

---

### Task 6: Fix Referral Code Sharing

**Files:**
- Modify: `public/painter-dashboard.html:468-479`

**Step 1: Replace the `shareReferral()` function**

Replace lines 468-479 with:

```javascript
async function shareReferral() {
    const code = dashboardData?.referralCode || document.getElementById('referralCode').textContent;
    if (!code || code === '---') { showToast('Referral code not loaded yet', 'error'); return; }

    const text = `Join Quality Colours Painter Loyalty Program! Use my referral code: ${code}\n\nRegister here: ${window.location.origin}/painter-register.html?ref=${code}`;

    // Try native share first
    if (navigator.share) {
        try {
            await navigator.share({ title: 'Quality Colours Painter Program', text });
            showToast('Shared successfully!');
            return;
        } catch (e) {
            // User cancelled or share failed — fall through to clipboard
        }
    }

    // Try clipboard
    try {
        await navigator.clipboard.writeText(text);
        showToast('Referral code copied to clipboard!');
        return;
    } catch (e) {
        // Clipboard failed — show WhatsApp + manual copy
    }

    // Fallback: WhatsApp deep link + show text
    const waUrl = `https://wa.me/?text=${encodeURIComponent(text)}`;
    const modal = document.createElement('div');
    modal.className = 'fixed inset-0 bg-black/50 flex items-end justify-center z-50';
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    modal.innerHTML = `
        <div class="bg-white rounded-t-2xl w-full max-w-lg p-5 pb-8">
            <h3 class="font-semibold text-gray-800 mb-3">Share Referral Code</h3>
            <div class="bg-gray-50 rounded-lg p-3 text-sm text-gray-700 mb-4 select-all" style="word-break:break-word">${text.replace(/\n/g, '<br>')}</div>
            <div class="flex gap-3">
                <a href="${waUrl}" target="_blank" class="flex-1 py-2.5 bg-green-600 text-white text-center rounded-lg font-medium text-sm">Share via WhatsApp</a>
                <button onclick="this.closest('.fixed').remove()" class="flex-1 py-2.5 border border-gray-300 rounded-lg font-medium text-sm text-gray-600">Close</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function showToast(msg, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `fixed top-4 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm font-medium z-50 ${type === 'error' ? 'bg-red-600' : 'bg-emerald-600'} text-white shadow-lg`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; }, 2000);
    setTimeout(() => toast.remove(), 2500);
}
```

**Step 2: Commit**

```bash
git add public/painter-dashboard.html
git commit -m "fix: referral sharing with proper fallback chain and toast feedback"
```

---

### Task 7: Admin Tab 7 — Estimate Catalog Overview in Painters Page

**Files:**
- Modify: `public/admin-painters.html`

**Step 1: Add Tab 7 "Estimate Catalog" to the tab bar**

Find the tab buttons in admin-painters.html (around line 75 where tab 6 "Estimates" exists). Add tab 7:

```html
<button class="tab-btn" data-tab="catalog" onclick="switchTab('catalog')">Catalog</button>
```

**Step 2: Add tab content section**

After the estimates tab content section, add:

```html
<div id="tab-catalog" class="tab-section" style="display:none">
    <div class="bg-white rounded-xl shadow-sm p-6">
        <div class="flex items-center justify-between mb-4">
            <div>
                <h3 class="text-lg font-bold text-gray-800">Estimate Catalog</h3>
                <p class="text-sm text-gray-500">Products available for painter estimates</p>
            </div>
            <a href="/admin-products.html" class="btn btn-primary text-sm">Manage Products</a>
        </div>
        <div id="catalogStats" class="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div class="bg-gray-50 rounded-lg p-4 text-center">
                <div class="text-2xl font-bold text-gray-800" id="catStatProducts">-</div>
                <div class="text-xs text-gray-500">Products</div>
            </div>
            <div class="bg-gray-50 rounded-lg p-4 text-center">
                <div class="text-2xl font-bold text-emerald-600" id="catStatMapped">-</div>
                <div class="text-xs text-gray-500">Mapped Variations</div>
            </div>
            <div class="bg-gray-50 rounded-lg p-4 text-center">
                <div class="text-2xl font-bold text-orange-500" id="catStatUnmapped">-</div>
                <div class="text-xs text-gray-500">Unmapped</div>
            </div>
            <div class="bg-gray-50 rounded-lg p-4 text-center">
                <div class="text-2xl font-bold text-blue-600" id="catStatBrands">-</div>
                <div class="text-xs text-gray-500">Brands</div>
            </div>
        </div>
        <div id="catalogProductList" class="space-y-2"></div>
    </div>
</div>
```

**Step 3: Add catalog loading function**

In the script section, add:

```javascript
async function loadCatalogStats() {
    try {
        const res = await fetch('/api/products', { headers: getAuthHeaders() });
        const products = await res.json();

        let totalMapped = 0, totalUnmapped = 0;
        const brandSet = new Set();

        for (const p of products) {
            if (p.brand_name) brandSet.add(p.brand_name);
            let sizes = [];
            try { sizes = JSON.parse(p.available_sizes || '[]'); } catch(e) {}

            // Fetch pack sizes with zoho mapping
            const psRes = await fetch(`/api/products/${p.id}`, { headers: getAuthHeaders() });
            const psData = await psRes.json();
            if (psData.pack_sizes) {
                for (const ps of psData.pack_sizes) {
                    if (ps.zoho_item_id) totalMapped++;
                    else totalUnmapped++;
                }
            }
        }

        document.getElementById('catStatProducts').textContent = products.length;
        document.getElementById('catStatMapped').textContent = totalMapped;
        document.getElementById('catStatUnmapped').textContent = totalUnmapped;
        document.getElementById('catStatBrands').textContent = brandSet.size;

        // Show product list summary
        const container = document.getElementById('catalogProductList');
        container.innerHTML = products.slice(0, 20).map(p => {
            const typeBadge = p.product_type === 'area_wise' ? '<span class="badge badge-primary text-xs">Area</span>' : '<span class="badge badge-success text-xs">Unit</span>';
            return `
                <div class="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div>
                        <span class="font-medium text-gray-800">${p.name}</span>
                        <span class="text-xs text-gray-500 ml-2">${p.brand_name || ''}</span>
                        ${typeBadge}
                    </div>
                    <button onclick="window.location.href='/admin-products.html'" class="text-xs text-purple-600 font-medium">Edit</button>
                </div>
            `;
        }).join('');
    } catch (err) {
        console.error('Catalog stats error:', err);
    }
}
```

**Step 4: Wire catalog tab to load data**

In the `switchTab()` function, add the catalog case:

```javascript
if (tab === 'catalog') loadCatalogStats();
```

**Step 5: Commit**

```bash
git add public/admin-painters.html
git commit -m "feat: add Estimate Catalog overview tab in admin painters page"
```

---

### Task 8: Mobile Layout Polish

**Files:**
- Modify: `public/painter-estimate-create.html`
- Modify: `public/painter-dashboard.html`

**Step 1: Add global mobile overflow fix to estimate page**

Already done in Task 5 Step 1. Verify these CSS rules exist:

```css
* { box-sizing: border-box; }
html, body { max-width: 100vw; overflow-x: hidden; }
```

**Step 2: Add `min-w-0` to filter selects**

Already done in Task 5 Step 2 with `min-w-0` class on selects.

**Step 3: Add mobile overflow fix to painter-dashboard.html**

In `painter-dashboard.html`, add to the existing style block:

```css
* { box-sizing: border-box; }
html, body { max-width: 100vw; overflow-x: hidden; }
```

**Step 4: Commit**

```bash
git add public/painter-estimate-create.html public/painter-dashboard.html
git commit -m "fix: mobile horizontal overflow on painter pages"
```

---

### Task 9: End-to-End Testing

**Step 1: Test admin products Zoho mapping**
1. Open admin-products.html
2. Edit an existing product
3. For each pack size, search and select a Zoho item
4. Save the product
5. Re-open — verify Zoho mapping persists with green "Mapped" indicator

**Step 2: Test painter estimate create**
1. Open painter-estimate-create.html
2. Select billing type
3. Verify products show as grouped cards with size chips (NOT flat Zoho items)
4. Verify brands/categories only show mapped ones
5. Tap size chip to add, verify +/- quantity works
6. Submit estimate and verify it creates correctly

**Step 3: Test referral sharing**
1. Open painter-dashboard.html
2. Tap Share button on referral code
3. Verify share dialog opens or toast shows "copied"
4. Test on Android WebView

**Step 4: Test mobile layout**
1. Open painter-estimate-create.html on mobile or narrow viewport
2. Verify no horizontal scrolling
3. Verify product cards fit within viewport

**Step 5: Final commit**

```bash
git add -A
git commit -m "feat: estimate catalog manager with Zoho mapping, grouped products, referral fix, mobile fix"
```
