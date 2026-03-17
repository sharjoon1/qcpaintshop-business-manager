# Estimate Product Integration & Print Enhancement — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add global product search to estimate creation, replace dual PDF/print renderers with a single professional HTML print page, and add column toggle controls with Image and Pack Size columns.

**Architecture:** Single-page HTML print template (`estimate-print.html`) replaces both PDFKit and browser print. Puppeteer-core renders the same HTML server-side for PDF downloads. Column toggles use localStorage for defaults and `estimates.column_visibility` JSON for per-estimate persistence. Global search filters the existing `allProducts` client-side array.

**Tech Stack:** HTML/Tailwind CSS, vanilla JS, puppeteer-core (server-side PDF), Express.js, MySQL

**Spec:** `docs/superpowers/specs/2026-03-17-estimate-product-integration-design.md`

---

## Chunk 1: Database Migration + Server Changes

### Task 1: Migration — Add image_url to estimate_items

**Files:**
- Create: `migrations/migrate-estimate-columns.js`

- [ ] **Step 1: Create migration file**

```javascript
// migrations/migrate-estimate-columns.js
require('dotenv').config();
const mysql = require('mysql2/promise');

async function migrate() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME
    });

    console.log('Starting estimate columns migration...');

    try {
        await pool.query('ALTER TABLE estimate_items ADD COLUMN image_url VARCHAR(500) DEFAULT NULL AFTER product_id');
        console.log('Added image_url column to estimate_items');
    } catch (e) {
        if (e.code === 'ER_DUP_FIELDNAME') {
            console.log('image_url column already exists');
        } else {
            throw e;
        }
    }

    await pool.end();
    console.log('Migration complete!');
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
```

- [ ] **Step 2: Run migration on remote**

```bash
ssh root@161.97.114.189 "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && node migrations/migrate-estimate-columns.js"
```

Expected: "Added image_url column to estimate_items" or "image_url column already exists"

- [ ] **Step 3: Commit**

```bash
git add migrations/migrate-estimate-columns.js
git commit -m "feat: add image_url column to estimate_items for product thumbnails"
```

### Task 2: Server — Accept image_url in estimate items

**Files:**
- Modify: `server.js` — `POST /api/estimates` (around line 3196) and `PUT /api/estimates/:id` (around line 3245)

- [ ] **Step 1: Update POST /api/estimates item INSERT**

In `server.js`, find the `POST /api/estimates` handler. Change the `itemValues` mapping (around line 3196) to include `image_url`:

```javascript
// BEFORE (line ~3196):
const itemValues = items.map(item => [
    estimateId, item.product_id || null, item.item_description,
    item.quantity, item.area || null, item.mix_info || null,
    item.unit_price, item.breakdown_cost || null, item.color_cost || 0,
    item.line_total, item.display_order || 0
]);

// AFTER:
const itemValues = items.map(item => [
    estimateId, item.product_id || null, item.image_url || null,
    item.item_description,
    item.quantity, item.area || null, item.mix_info || null,
    item.unit_price, item.breakdown_cost || null, item.color_cost || 0,
    item.line_total, item.display_order || 0
]);
```

And update the INSERT column list (line ~3204):

```sql
-- BEFORE:
INSERT INTO estimate_items (
    estimate_id, product_id, item_description, quantity, area, mix_info,
    unit_price, breakdown_cost, color_cost, line_total, display_order
) VALUES ?

-- AFTER:
INSERT INTO estimate_items (
    estimate_id, product_id, image_url, item_description, quantity, area, mix_info,
    unit_price, breakdown_cost, color_cost, line_total, display_order
) VALUES ?
```

- [ ] **Step 2: Update PUT /api/estimates/:id item INSERT**

Same change in the PUT handler (around line 3245):

```javascript
// BEFORE (line ~3245):
const itemValues = items.map(item => [
    estimateId, item.product_id || null, item.item_description,
    item.quantity, item.area || null, item.mix_info || null,
    item.unit_price, item.breakdown_cost || null, item.color_cost || 0,
    item.line_total, item.display_order || 0
]);

// AFTER:
const itemValues = items.map(item => [
    estimateId, item.product_id || null, item.image_url || null,
    item.item_description,
    item.quantity, item.area || null, item.mix_info || null,
    item.unit_price, item.breakdown_cost || null, item.color_cost || 0,
    item.line_total, item.display_order || 0
]);
```

And update the INSERT column list (line ~3253):

```sql
-- BEFORE:
INSERT INTO estimate_items (
    estimate_id, product_id, item_description, quantity, area, mix_info,
    unit_price, breakdown_cost, color_cost, line_total, display_order
) VALUES ?

-- AFTER:
INSERT INTO estimate_items (
    estimate_id, product_id, image_url, item_description, quantity, area, mix_info,
    unit_price, breakdown_cost, color_cost, line_total, display_order
) VALUES ?
```

- [ ] **Step 3: Verify GET /api/estimates/:id returns image_url**

The existing `GET /api/estimates/:id` (line ~3135) uses `SELECT ei.*, p.name as product_name...` — the `*` already picks up the new `image_url` column. No change needed.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: accept image_url in estimate items create/update"
```

---

## Chunk 2: Global Product Search in estimate-create-new.html

### Task 3: Add global search bar UI

**Files:**
- Modify: `public/estimate-create-new.html`

- [ ] **Step 1: Add search bar HTML**

In `estimate-create-new.html`, find the Step 2 section (line ~117). Add a global search bar ABOVE the Brand/Category/Product row:

```html
<!-- Insert after line 118 (after <h2>Step 2: Add Products</h2>) -->
<!-- Global Product Search -->
<div class="relative mb-4">
    <div class="relative">
        <svg class="absolute left-3 top-3 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
        </svg>
        <input type="text" id="globalProductSearch" placeholder="Search products by name... (quick find)"
            class="w-full pl-10 pr-4 py-3 border-2 border-gray-300 rounded-lg focus:border-purple-600 focus:outline-none text-sm"
            oninput="onGlobalSearch(this.value)" autocomplete="off">
    </div>
    <div id="globalSearchResults" class="hidden absolute left-0 right-0 top-full mt-1 bg-white border-2 border-purple-300 rounded-lg shadow-xl z-50 max-h-80 overflow-y-auto">
    </div>
</div>
<p class="text-xs text-gray-500 mb-3 -mt-2">Or browse by Brand → Category → Product below:</p>
```

- [ ] **Step 2: Add search JavaScript**

Add these functions in the `<script>` section, after the `initDropdowns()` function (around line 474):

```javascript
// ========================================
// GLOBAL PRODUCT SEARCH
// ========================================
function onGlobalSearch(query) {
    const resultsPanel = document.getElementById('globalSearchResults');

    if (!query || query.length < 2) {
        resultsPanel.classList.add('hidden');
        return;
    }

    const q = query.toLowerCase();
    const matches = allProducts.filter(p =>
        p.name.toLowerCase().includes(q) ||
        (p.brand_name && p.brand_name.toLowerCase().includes(q))
    ).slice(0, 10);

    if (matches.length === 0) {
        resultsPanel.innerHTML = '<div class="p-4 text-center text-gray-500 text-sm">No products found</div>';
        resultsPanel.classList.remove('hidden');
        return;
    }

    resultsPanel.innerHTML = matches.map(p => {
        const safeName = (p.name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const safeBrand = (p.brand_name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const safeCat = (p.category_name || '').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<div class="px-4 py-3 hover:bg-purple-50 cursor-pointer border-b border-gray-100 last:border-0"
             onclick="selectFromGlobalSearch(${p.id})">
            <div class="font-semibold text-sm text-gray-800">${safeName}</div>
            <div class="text-xs text-gray-500">${safeBrand}${safeCat ? ' / ' + safeCat : ''}</div>
        </div>`;
    }).join('');
    resultsPanel.classList.remove('hidden');
}

function selectFromGlobalSearch(productId) {
    const product = allProducts.find(p => p.id == productId);
    if (!product) return;

    // Close search
    document.getElementById('globalProductSearch').value = product.name;
    document.getElementById('globalSearchResults').classList.add('hidden');

    // Set selected product and show type/size inputs
    selectedProduct = product;
    onProductSelected(product.id, product);
}

// Close search results when clicking outside
document.addEventListener('click', (e) => {
    const searchContainer = document.getElementById('globalProductSearch')?.parentElement?.parentElement;
    if (searchContainer && !searchContainer.contains(e.target)) {
        document.getElementById('globalSearchResults')?.classList.add('hidden');
    }
});
```

- [ ] **Step 3: Clear global search on product add**

In the `addProductToEstimate()` function (around line 777), add a line to clear the global search:

```javascript
// Add after line 779 (productDD.reset();):
document.getElementById('globalProductSearch').value = '';
```

- [ ] **Step 4: Test manually**

1. Open `estimate-create-new.html`
2. Type a product name in the global search bar
3. Verify results appear, clicking one shows pack size inputs
4. Verify cascade dropdowns still work independently

- [ ] **Step 5: Commit**

```bash
git add public/estimate-create-new.html
git commit -m "feat: add global product search bar to estimate creation"
```

---

## Chunk 3: Column Toggle Pills in estimate-create-new.html

### Task 4: Add column toggles and image_url to estimate items

**Files:**
- Modify: `public/estimate-create-new.html`

- [ ] **Step 1: Add column toggle state and UI**

Add column visibility state in the APP STATE section (around line 437):

```javascript
// Column visibility defaults (loaded from localStorage)
let columnVisibility = JSON.parse(localStorage.getItem('estimate_column_prefs') || 'null') || {
    show_image: true, show_pack_size: true, show_qty: true, show_mix: true,
    show_price: true, show_breakdown: false, show_color: false, show_total: true
};
```

Add toggle pills HTML above the items table. Find the "Estimate Items" heading (line ~198) and add after it:

```html
<!-- Column Toggle Pills -->
<div class="flex flex-wrap gap-2 mb-4" id="columnToggles">
    <span class="text-xs text-gray-500 self-center mr-1">Columns:</span>
    <button onclick="toggleEstCol('show_image')" class="col-pill px-3 py-1 text-xs rounded-full border-2 transition" data-col="show_image">Image</button>
    <button onclick="toggleEstCol('show_pack_size')" class="col-pill px-3 py-1 text-xs rounded-full border-2 transition" data-col="show_pack_size">Pack Size</button>
    <button onclick="toggleEstCol('show_qty')" class="col-pill px-3 py-1 text-xs rounded-full border-2 transition" data-col="show_qty">Qty/Area</button>
    <button onclick="toggleEstCol('show_mix')" class="col-pill px-3 py-1 text-xs rounded-full border-2 transition" data-col="show_mix">Mix Info</button>
    <button onclick="toggleEstCol('show_price')" class="col-pill px-3 py-1 text-xs rounded-full border-2 transition" data-col="show_price">Unit Price</button>
    <button onclick="toggleEstCol('show_breakdown')" class="col-pill px-3 py-1 text-xs rounded-full border-2 transition" data-col="show_breakdown">Breakdown</button>
    <button onclick="toggleEstCol('show_color')" class="col-pill px-3 py-1 text-xs rounded-full border-2 transition" data-col="show_color">Color Cost</button>
    <button onclick="toggleEstCol('show_total')" class="col-pill px-3 py-1 text-xs rounded-full border-2 transition" data-col="show_total">Total</button>
</div>
```

- [ ] **Step 2: Add toggle JavaScript functions**

Add in the `<script>` section:

```javascript
// ========================================
// COLUMN TOGGLE
// ========================================
function toggleEstCol(key) {
    columnVisibility[key] = !columnVisibility[key];
    localStorage.setItem('estimate_column_prefs', JSON.stringify(columnVisibility));
    renderEstimateTable();
    updateTogglePills();
}

function updateTogglePills() {
    document.querySelectorAll('.col-pill').forEach(btn => {
        const key = btn.dataset.col;
        if (columnVisibility[key]) {
            btn.className = 'col-pill px-3 py-1 text-xs rounded-full border-2 transition bg-purple-600 text-white border-purple-600';
        } else {
            btn.className = 'col-pill px-3 py-1 text-xs rounded-full border-2 transition bg-white text-gray-600 border-gray-300 hover:border-purple-300';
        }
    });
}

function extractPackSize(mixInfo) {
    if (!mixInfo) return '-';
    const match = mixInfo.match(/(\d+(?:\.\d+)?\s*(?:L|LTR?|Ltr|Litre|KG|Kg|M|PC))\b/i);
    return match ? match[1] : '-';
}
```

- [ ] **Step 3: Update renderEstimateTable to use column visibility**

Replace the existing `renderEstimateTable()` function (around line 786):

```javascript
function renderEstimateTable() {
    const tbody = document.getElementById('itemsTableBody');
    const cv = columnVisibility;

    if (estimateItems.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="text-center py-8 text-gray-500">No items added yet</td></tr>';
        updateTotals();
        updateTogglePills();
        return;
    }

    // Build header
    const thead = document.querySelector('#itemsTableBody').closest('table').querySelector('thead tr');
    let headerHtml = '<th class="px-4 py-3 text-left">#</th>';
    if (cv.show_image) headerHtml += '<th class="px-4 py-3 text-left">Image</th>';
    headerHtml += '<th class="px-4 py-3 text-left">Product</th>';
    if (cv.show_pack_size) headerHtml += '<th class="px-4 py-3 text-left">Pack Size</th>';
    headerHtml += '<th class="px-4 py-3 text-left">Type</th>';
    if (cv.show_qty) headerHtml += '<th class="px-4 py-3 text-right">Quantity</th>';
    if (cv.show_mix) headerHtml += '<th class="px-4 py-3 text-left">Mix Info</th>';
    if (cv.show_price) headerHtml += '<th class="px-4 py-3 text-right">Unit Price</th>';
    if (cv.show_breakdown) headerHtml += '<th class="px-4 py-3 text-left">Breakdown</th>';
    if (cv.show_color) headerHtml += '<th class="px-4 py-3 text-right">Color Cost</th>';
    if (cv.show_total) headerHtml += '<th class="px-4 py-3 text-right">Total</th>';
    headerHtml += '<th class="px-4 py-3 text-center">Action</th>';
    thead.innerHTML = headerHtml;

    // Build rows
    tbody.innerHTML = estimateItems.map((item, idx) => {
        let row = `<td class="px-4 py-3">${idx + 1}</td>`;
        if (cv.show_image) {
            const imgSrc = item.image_url;
            row += `<td class="px-4 py-3">${imgSrc
                ? `<img src="${imgSrc}" class="w-10 h-10 object-cover rounded" onerror="this.outerHTML='<div class=\\'w-10 h-10 bg-gray-200 rounded flex items-center justify-center\\'><svg class=\\'w-5 h-5 text-gray-400\\' fill=\\'none\\' stroke=\\'currentColor\\' viewBox=\\'0 0 24 24\\'><path stroke-linecap=\\'round\\' stroke-linejoin=\\'round\\' stroke-width=\\'2\\' d=\\'M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z\\'></path></svg></div>'">`
                : '<div class="w-10 h-10 bg-gray-200 rounded flex items-center justify-center"><svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg></div>'
            }</td>`;
        }
        row += `<td class="px-4 py-3 font-semibold">${item.product_name}</td>`;
        if (cv.show_pack_size) row += `<td class="px-4 py-3">${extractPackSize(item.details)}</td>`;
        row += `<td class="px-4 py-3">${item.type === 'unit' ? 'Unit' : 'Area'}</td>`;
        if (cv.show_qty) row += `<td class="px-4 py-3 text-right">${item.quantity.toFixed(2)}</td>`;
        if (cv.show_mix) row += `<td class="px-4 py-3 text-sm">${item.details}</td>`;
        if (cv.show_price) row += `<td class="px-4 py-3 text-right">${formatCurrency(item.unit_price)}</td>`;
        if (cv.show_breakdown) row += `<td class="px-4 py-3">-</td>`;
        if (cv.show_color) row += `<td class="px-4 py-3 text-right">${formatCurrency(0)}</td>`;
        if (cv.show_total) row += `<td class="px-4 py-3 text-right font-semibold">${formatCurrency(item.total)}</td>`;
        row += `<td class="px-4 py-3 text-center"><button onclick="removeItem(${item.id})" class="text-red-600 hover:text-red-800">Remove</button></td>`;
        return `<tr>${row}</tr>`;
    }).join('');

    updateTotals();
    updateTogglePills();
}

function formatCurrency(num) {
    return '₹' + parseFloat(num || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
```

- [ ] **Step 4: Store image_url when adding items**

In the `addProductToEstimate()` function, add `image_url` to the item object. Find the line `let item = {` (around line 738) and add:

```javascript
let item = {
    id: itemIdCounter++,
    product_id: selectedProduct.id,
    product_name: selectedProduct.name,
    image_url: selectedProduct.image_url || null,  // ADD THIS LINE
    type: type
};
```

- [ ] **Step 5: Include image_url and column_visibility in saveEstimate**

In the `saveEstimate()` function, update the `apiItems` mapping (around line 846) to include `image_url`:

```javascript
const apiItems = estimateItems.map((item, idx) => ({
    product_id: item.product_id,
    image_url: item.image_url || null,  // ADD THIS
    item_description: item.product_name,
    quantity: item.quantity,
    area: item.type === 'area' ? item.quantity : null,
    mix_info: item.details,
    unit_price: item.unit_price,
    price_breakdown: item.type,
    color_cost: 0,
    line_total: item.total,
    display_order: idx + 1
}));
```

And include `column_visibility` in the `estimateData` object:

```javascript
const estimateData = {
    // ... existing fields ...
    column_visibility: JSON.stringify(columnVisibility),  // ADD THIS
    items: apiItems
};
```

- [ ] **Step 6: Add print preview option after save**

In the `saveEstimate()` function, find the success handler (around line 889) and replace the alert+redirect:

```javascript
// BEFORE:
alert('✅ Estimate created successfully! Estimate #' + (result.estimate_number || result.id));
window.location.href = 'estimates.html';

// AFTER:
const estNum = result.estimate_number || result.id;
const estId = result.id || result.estimate_id;
if (confirm('Estimate #' + estNum + ' created! Open print preview?')) {
    window.location.href = 'estimate-print.html?id=' + estId;
} else {
    window.location.href = 'estimates.html';
}
```

- [ ] **Step 7: Call updateTogglePills on init**

In the `init()` function (line ~1146), add `updateTogglePills()` after `initDropdowns()`:

```javascript
async function init() {
    initDropdowns();
    updateTogglePills();  // ADD THIS
    await loadInitialData();
    await prefillFromRequest();
    if (estimateItems.length > 0) {
        renderEstimateTable();
    }
}
```

- [ ] **Step 7: Test manually**

1. Open `estimate-create-new.html`
2. Verify column toggle pills appear and reflect saved state
3. Toggle Image OFF → verify image column disappears from table
4. Add a product → verify image shows (or placeholder if no image)
5. Save estimate → verify column_visibility saved in DB

- [ ] **Step 8: Commit**

```bash
git add public/estimate-create-new.html
git commit -m "feat: add column toggle pills with Image and Pack Size columns to estimate creation"
```

---

## Chunk 4: Professional Print Page

### Task 5: Create estimate-print.html

**Files:**
- Create: `public/estimate-print.html`

- [ ] **Step 1: Create the professional print page**

Create `public/estimate-print.html` — a standalone page that loads an estimate by ID from the API and renders it beautifully. This is the single source of truth for how estimates look when printed or exported as PDF.

**Critical implementation details:**

- **Main content wrapper MUST use `id="printContent"`** — Task 8 Puppeteer depends on `page.waitForSelector('#printContent')`
- URL params: `?id={estimateId}` required, `?mode=pdf` hides action bar, `?token={sessionToken}` for Puppeteer auth

**Auth token override (required for Puppeteer PDF):**
```javascript
// At top of <script>:
const urlParams = new URLSearchParams(window.location.search);
const estimateId = urlParams.get('id');
const mode = urlParams.get('mode'); // 'pdf' = hide action bar
const tokenOverride = urlParams.get('token'); // Puppeteer passes this

// Override apiRequest to use token from URL if present
function getToken() {
    return tokenOverride || localStorage.getItem('auth_token');
}

async function fetchEstimate() {
    const token = getToken();
    const res = await fetch(`/api/estimates/${estimateId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    return res.json();
}
```

**Page structure:**
```html
<body class="bg-gray-100">
  <!-- Action bar (hidden in pdf mode and print) -->
  <div id="actionBar" class="no-print fixed top-0 left-0 right-0 bg-white shadow-lg z-50">
    <!-- Back button, Column toggle pills, Print/PDF/Back buttons -->
  </div>

  <!-- Main printable content -->
  <div id="printContent" class="max-w-4xl mx-auto mt-20 p-4 print:mt-0 print:p-0">
    <div class="bg-white shadow-2xl rounded-lg print:shadow-none">
      <!-- Header: logo + company info left, ESTIMATE title right -->
      <!-- Purple divider bar -->
      <!-- BILL TO section -->
      <!-- Items table with dynamic columns -->
      <!-- Summary section (conditional GST) -->
      <!-- Notes section -->
      <!-- Terms & Conditions -->
      <!-- Footer -->
    </div>
  </div>
</body>
```

**Print CSS:**
```css
@media print {
    @page { size: A4; margin: 10mm; }
    .no-print { display: none !important; }
    body { background: white; margin: 0; }
    #printContent { margin: 0; padding: 0; max-width: 100%; }
    table { font-size: 9px !important; page-break-inside: avoid; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
}
```

**Column toggles on this page:**
- Read `column_visibility` JSON from estimate data, fall back to localStorage `estimate_column_prefs`
- Toggle pills update visibility instantly (same as estimate-create-new)
- Toggling does NOT save back to DB (read-only view)

**If `mode=pdf`:** Hide action bar on load:
```javascript
if (mode === 'pdf') {
    document.getElementById('actionBar').style.display = 'none';
    document.getElementById('printContent').style.marginTop = '0';
}
```

**Design:**
- Header: company logo left, "ESTIMATE" title right in primary purple `#667eea`
- Purple gradient divider bar
- Customer "BILL TO" section
- Items table: header with `#667eea` background white text, alternating gray/white rows
- Image column: 40x40 thumbnails, gray placeholder SVG when no image
- Pack Size column: parsed from `mix_info` via regex `(/(\d+(?:\.\d+)?\s*(?:L|LTR?|Ltr|Litre|KG|Kg|M|PC))\b/i)`
- Summary: right-aligned. If `show_gst_breakdown`: show Subtotal + GST + Grand Total. Else: Grand Total only + "All prices inclusive of GST"
- Terms: "1. All prices are inclusive of GST. 2. Estimate valid for 30 days. 3. Subject to stock availability."
- Footer: "Thank you for choosing Quality Colours!"

**Action bar buttons:**
- "Back" — `history.back()`
- Column toggle pills (same style as estimate-create-new)
- "Print" — `window.print()`
- "Download PDF" — fetch `/api/estimates/{id}/pdf` as blob, trigger download

- [ ] **Step 2: Test print page**

1. Open `estimate-print.html?id=1` (use a real estimate ID)
2. Verify it loads and renders correctly
3. Toggle columns — verify they hide/show
4. Click Print → verify `@media print` produces clean A4
5. Test `?mode=pdf` — verify action bar is hidden

- [ ] **Step 3: Commit**

```bash
git add public/estimate-print.html
git commit -m "feat: create professional HTML print page for estimates"
```

### Task 6: Update estimate-view.html to use new print page

**Files:**
- Modify: `public/estimate-view.html`

- [ ] **Step 1: Update Print button**

In `estimate-view.html`, change the Print button (line 94) to open the new print page:

```html
<!-- BEFORE: -->
<button onclick="window.print()" class="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 text-sm">
    🖨️ Print
</button>

<!-- AFTER: -->
<button onclick="window.open('estimate-print.html?id=' + estimateId, '_blank')" class="bg-purple-600 text-white px-4 py-2 rounded-lg hover:bg-purple-700 text-sm">
    🖨️ Print
</button>
```

- [ ] **Step 2: Add new toggle keys to column visibility parsing**

In `estimate-view.html`, find the column visibility parsing (line ~320) and add the new keys:

```javascript
// Add after line 325 (after show_total):
if (savedSettings.show_image !== undefined) columnVisibility.image = savedSettings.show_image;
if (savedSettings.show_pack_size !== undefined) columnVisibility.pack_size = savedSettings.show_pack_size;
if (savedSettings.show_breakdown !== undefined) columnVisibility.breakdown = savedSettings.show_breakdown;
```

- [ ] **Step 3: Commit**

```bash
git add public/estimate-view.html
git commit -m "feat: link estimate view to new print page, add new toggle keys"
```

---

## Chunk 5: Puppeteer PDF Generation

### Task 7: Install puppeteer-core

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install puppeteer-core on server**

```bash
ssh root@161.97.114.189 "cd /www/wwwroot/act.qcpaintshop.com && npm install puppeteer-core"
```

Also install locally for development:

```bash
npm install puppeteer-core
```

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add puppeteer-core for HTML-based PDF generation"
```

### Task 8: Rewrite estimate-pdf.js to use Puppeteer

**Files:**
- Modify: `routes/estimate-pdf.js`

- [ ] **Step 1: Rewrite the PDF route**

Replace the contents of `routes/estimate-pdf.js`:

```javascript
const express = require('express');
const router = express.Router();

let pool;
let puppeteerCore;
let chromiumPath;

function setPool(dbPool) { pool = dbPool; }

// Lazy-load puppeteer and find Chromium path
async function getPuppeteer() {
    if (!puppeteerCore) {
        puppeteerCore = require('puppeteer-core');
    }
    if (!chromiumPath) {
        // Try to find Chromium from the full puppeteer package (used by whatsapp-web.js)
        try {
            const puppeteerFull = require('puppeteer');
            chromiumPath = puppeteerFull.executablePath();
        } catch {
            // Fallback to common system paths
            const fs = require('fs');
            const paths = ['/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/chromium'];
            chromiumPath = paths.find(p => fs.existsSync(p));
        }
        if (!chromiumPath) {
            throw new Error('Chromium not found. Install puppeteer or chromium-browser.');
        }
    }
    return { puppeteer: puppeteerCore, executablePath: chromiumPath };
}

// Auth helper
async function authenticateRequest(req) {
    const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
    if (!token) return null;
    const [sessions] = await pool.query(
        `SELECT s.*, u.id as user_id, u.username, u.role, u.full_name
         FROM user_sessions s JOIN users u ON s.user_id = u.id
         WHERE s.session_token = ? AND s.expires_at > NOW() AND u.status = 'active'`,
        [token]
    );
    return sessions.length > 0 ? sessions[0] : null;
}

// GET /api/estimates/:id/pdf
router.get('/:id/pdf', async (req, res) => {
    let browser;
    try {
        const user = await authenticateRequest(req);
        if (!user) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }

        // Verify estimate exists
        const [estimates] = await pool.query('SELECT estimate_number FROM estimates WHERE id = ?', [req.params.id]);
        if (estimates.length === 0) {
            return res.status(404).json({ success: false, message: 'Estimate not found' });
        }

        const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
        const { puppeteer, executablePath } = await getPuppeteer();

        browser = await puppeteer.launch({
            executablePath,
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });

        const page = await browser.newPage();

        // Build URL to the print page
        const protocol = req.protocol;
        const host = req.get('host');
        const printUrl = `${protocol}://${host}/estimate-print.html?id=${req.params.id}&mode=pdf&token=${token}`;

        await page.goto(printUrl, { waitUntil: 'networkidle0', timeout: 15000 });

        // Wait for content to render
        await page.waitForSelector('#printContent', { timeout: 10000 });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
            printBackground: true
        });

        const filename = `${estimates[0].estimate_number || 'Estimate'}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(pdfBuffer);

    } catch (error) {
        console.error('PDF generation error:', error);
        if (!res.headersSent) {
            res.status(500).json({ success: false, message: 'Failed to generate PDF: ' + error.message });
        }
    } finally {
        if (browser) {
            try { await browser.close(); } catch {}
        }
    }
});

module.exports = { router, setPool };
```

- [ ] **Step 2: Test PDF generation**

```bash
# On the server, after deploying:
curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/estimates/1/pdf" -o test.pdf
# Verify test.pdf is a valid PDF
```

- [ ] **Step 3: Commit**

```bash
git add routes/estimate-pdf.js
git commit -m "feat: replace PDFKit with Puppeteer for estimate PDF generation"
```

---

## Chunk 6: Update estimate-edit.html + Deploy

### Task 9: Update estimate-edit.html column visibility

**Files:**
- Modify: `public/estimate-edit.html`

- [ ] **Step 1: Read estimate-edit.html to find column_visibility handling**

Read the file and find where `column_visibility` is parsed and saved back. Add `show_image` and `show_pack_size` keys to ensure they're preserved during edit (not stripped out).

- [ ] **Step 2: Update the column visibility handling**

Ensure the edit page includes the new keys when saving. If it reads `column_visibility` from the estimate and sends it back, the new keys will be preserved automatically (since it's a JSON blob). Just verify no code strips unknown keys.

- [ ] **Step 3: Commit**

```bash
git add public/estimate-edit.html
git commit -m "feat: preserve new column visibility keys in estimate edit"
```

### Task 10: Deploy to production

**IMPORTANT:** Migration MUST run BEFORE server restart to avoid 500 errors (new INSERT includes `image_url` column).

- [ ] **Step 1: Deploy (migration first, then restart)**

```bash
ssh root@161.97.114.189 "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && node migrations/migrate-estimate-columns.js && npm install && pm2 restart business-manager"
```

- [ ] **Step 3: Verify on production**

1. Open `https://act.qcpaintshop.com/estimate-create-new.html`
2. Test global search bar
3. Test column toggles
4. Create a test estimate with image
5. Open print page from estimate view
6. Download PDF — verify it matches the print page
