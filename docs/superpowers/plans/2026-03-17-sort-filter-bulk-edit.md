# Column Sort/Filter + Bulk Edit Scoping — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add column-wise sort/filter to Products tab and Zoho Import tab, fix bulk edit scoping in zoho-items-edit, and add "Paste to All Rows" dropdown.

**Architecture:** Products tab uses client-side sort/filter on the in-memory `products` array. Zoho Import tab sends sort params to backend API. Zoho items edit page gets a `getVisibleItemIds()` helper for scoped bulk ops and a cell-level paste dropdown.

**Tech Stack:** HTML/Tailwind CSS, vanilla JS, Express.js (backend sort), MySQL

**Spec:** `docs/superpowers/specs/2026-03-17-sort-filter-bulk-edit-design.md`

---

## Chunk 1: Products Tab — Column Sort & Filter

### Task 1: Replace filter bar with column filter row (Products Tab)

**Files:**
- Modify: `public/admin-products.html`

- [ ] **Step 1: Replace the filter bar HTML with column sort headers + filter row**

Find the filter bar (lines 43-73) — the `<div class="bg-white rounded-xl shadow-sm p-4 mb-4">` containing searchInput, filterBrand, filterCategory, filterType, filterStatus. **Remove it entirely.**

Replace the Products table `<thead>` (lines 86-91) with sort headers + filter row:

```html
<thead>
    <tr class="bg-gray-800 text-white">
        <th class="w-10 text-center px-3 py-2"><input type="checkbox" id="productSelectAll" onchange="toggleProductSelectAll(this.checked)" class="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"></th>
        <th class="w-14 px-3 py-2">Image</th>
        <th class="px-3 py-2 text-left cursor-pointer select-none hover:bg-gray-700 transition" onclick="sortProducts('name')">
            Name <span id="sort-name" class="ml-1 text-gray-400">⇅</span>
        </th>
        <th class="px-3 py-2 text-left cursor-pointer select-none hover:bg-gray-700 transition" onclick="sortProducts('brand_name')">
            Brand <span id="sort-brand_name" class="ml-1 text-gray-400">⇅</span>
        </th>
        <th class="px-3 py-2 text-left cursor-pointer select-none hover:bg-gray-700 transition" onclick="sortProducts('category_name')">
            Category <span id="sort-category_name" class="ml-1 text-gray-400">⇅</span>
        </th>
        <th class="px-3 py-2 text-left cursor-pointer select-none hover:bg-gray-700 transition" onclick="sortProducts('product_type')">
            Type <span id="sort-product_type" class="ml-1 text-gray-400">⇅</span>
        </th>
        <th class="px-3 py-2 text-right cursor-pointer select-none hover:bg-gray-700 transition" onclick="sortProducts('base_price')">
            Price <span id="sort-base_price" class="ml-1 text-gray-400">⇅</span>
        </th>
        <th class="px-3 py-2 text-left cursor-pointer select-none hover:bg-gray-700 transition" onclick="sortProducts('status')">
            Status <span id="sort-status" class="ml-1 text-gray-400">⇅</span>
        </th>
        <th class="px-3 py-2 text-center">Actions</th>
    </tr>
    <!-- Filter Row -->
    <tr class="bg-gray-100 border-b border-gray-200">
        <td class="px-1 py-1"></td>
        <td class="px-1 py-1"></td>
        <td class="px-1 py-1">
            <input type="text" id="filterName" placeholder="Search..." class="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:border-purple-500 focus:outline-none" oninput="applyFilters()">
        </td>
        <td class="px-1 py-1">
            <select id="filterBrand" class="w-full px-1 py-1 text-xs border border-gray-300 rounded focus:border-purple-500 focus:outline-none" onchange="applyFilters()">
                <option value="">All</option>
            </select>
        </td>
        <td class="px-1 py-1">
            <select id="filterCategory" class="w-full px-1 py-1 text-xs border border-gray-300 rounded focus:border-purple-500 focus:outline-none" onchange="applyFilters()">
                <option value="">All</option>
            </select>
        </td>
        <td class="px-1 py-1">
            <select id="filterType" class="w-full px-1 py-1 text-xs border border-gray-300 rounded focus:border-purple-500 focus:outline-none" onchange="applyFilters()">
                <option value="">All</option>
                <option value="unit_wise">Unit</option>
                <option value="area_wise">Area</option>
            </select>
        </td>
        <td class="px-1 py-1"></td>
        <td class="px-1 py-1">
            <select id="filterStatus" class="w-full px-1 py-1 text-xs border border-gray-300 rounded focus:border-purple-500 focus:outline-none" onchange="applyFilters()">
                <option value="">All</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
            </select>
        </td>
        <td class="px-1 py-1 text-center">
            <button onclick="clearFilters()" class="text-xs text-purple-600 hover:text-purple-800 font-semibold" title="Clear all filters">✕</button>
        </td>
    </tr>
</thead>
```

- [ ] **Step 2: Add sort state and sortProducts() function**

Add to the `<script>` section (near the top, with other state variables):

```javascript
// Sort state
let productSortCol = sessionStorage.getItem('products_sort_col') || '';
let productSortDir = sessionStorage.getItem('products_sort_dir') || ''; // 'asc' | 'desc' | ''

function sortProducts(col) {
    if (productSortCol === col) {
        // Cycle: asc → desc → none
        if (productSortDir === 'asc') productSortDir = 'desc';
        else if (productSortDir === 'desc') { productSortDir = ''; productSortCol = ''; }
        else productSortDir = 'asc';
    } else {
        productSortCol = col;
        productSortDir = 'asc';
    }
    sessionStorage.setItem('products_sort_col', productSortCol);
    sessionStorage.setItem('products_sort_dir', productSortDir);
    updateSortArrows();
    renderProducts();
}

function updateSortArrows() {
    document.querySelectorAll('[id^="sort-"]').forEach(el => {
        el.textContent = '⇅';
        el.className = 'ml-1 text-gray-400';
    });
    if (productSortCol && productSortDir) {
        const el = document.getElementById('sort-' + productSortCol);
        if (el) {
            el.textContent = productSortDir === 'asc' ? '▲' : '▼';
            el.className = 'ml-1 text-yellow-300';
        }
    }
}
```

- [ ] **Step 3: Update getFilteredProducts() to use new filter IDs and add sorting**

Replace the existing `getFilteredProducts()` function:

```javascript
function getFilteredProducts() {
    const search = (document.getElementById('filterName')?.value || '').toLowerCase().trim();
    const brandId = document.getElementById('filterBrand')?.value || '';
    const categoryId = document.getElementById('filterCategory')?.value || '';
    const type = document.getElementById('filterType')?.value || '';
    const status = document.getElementById('filterStatus')?.value || '';

    let filtered = products.filter(product => {
        if (search && !product.name.toLowerCase().includes(search) &&
            !(product.brand_name || '').toLowerCase().includes(search) &&
            !(product.category_name || '').toLowerCase().includes(search) &&
            !(product.description || '').toLowerCase().includes(search)) {
            return false;
        }
        if (brandId && String(product.brand_id) !== brandId) return false;
        if (categoryId && String(product.category_id) !== categoryId) return false;
        if (type && product.product_type !== type) return false;
        if (status && product.status !== status) return false;
        return true;
    });

    // Sort
    if (productSortCol && productSortDir) {
        filtered.sort((a, b) => {
            let va = a[productSortCol], vb = b[productSortCol];
            if (productSortCol === 'base_price') {
                va = parseFloat(va) || 0;
                vb = parseFloat(vb) || 0;
            } else {
                va = String(va || '').toLowerCase();
                vb = String(vb || '').toLowerCase();
            }
            if (va < vb) return productSortDir === 'asc' ? -1 : 1;
            if (va > vb) return productSortDir === 'asc' ? 1 : -1;
            return 0;
        });
    }

    return filtered;
}
```

- [ ] **Step 4: Update clearFilters() to use new filter IDs**

```javascript
function clearFilters() {
    const nameInput = document.getElementById('filterName');
    if (nameInput) nameInput.value = '';
    document.getElementById('filterBrand').value = '';
    document.getElementById('filterCategory').value = '';
    document.getElementById('filterType').value = '';
    document.getElementById('filterStatus').value = '';
    productSortCol = '';
    productSortDir = '';
    sessionStorage.removeItem('products_sort_col');
    sessionStorage.removeItem('products_sort_dir');
    updateSortArrows();
    renderProducts();
}
```

- [ ] **Step 5: Update renderProducts() results count**

In `renderProducts()`, update the results count to use the new filter check:

```javascript
const isFiltered = document.getElementById('filterName')?.value || document.getElementById('filterBrand').value || document.getElementById('filterCategory').value || document.getElementById('filterType').value || document.getElementById('filterStatus').value;
```

Also update `resultsCount` element — if the old filter bar is removed, move the results count display to somewhere visible (e.g., above the table or in the header bar). Add this line before the table:

```html
<div class="flex items-center justify-between px-4 py-2 bg-white border-b">
    <span id="resultsCount" class="text-xs text-gray-500"></span>
</div>
```

- [ ] **Step 6: Call updateSortArrows() on page load**

In the init function (where brands/categories are loaded), add:

```javascript
updateSortArrows();
```

- [ ] **Step 7: Commit**

```bash
git add public/admin-products.html
git commit -m "feat: add column sort/filter to Products tab"
```

---

## Chunk 2: Zoho Import Tab — Column Sort & Filter

### Task 2: Replace Zoho Import filter bar with column sort headers + filter row

**Files:**
- Modify: `public/admin-products.html` (Zoho Import tab section)

- [ ] **Step 1: Remove the Zoho filter bar and add sort/filter to table headers**

Remove the Zoho search/filter bar (lines 209-233) — the `<div class="bg-white rounded-xl shadow-sm p-4 mb-4">` containing zohoSearchInput, zohoFilterBrand, zohoFilterCategory, zohoFilterMapped, and the Sync button.

Move the Sync button to the tab header area (next to the tab title).

Replace the Zoho table `<thead>` (lines 248-260) with:

```html
<thead>
    <tr class="bg-gray-800 text-white">
        <th class="px-3 py-2 text-center w-10"><input type="checkbox" id="zohoSelectAll" onchange="toggleZohoSelectAll(this.checked)" class="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"></th>
        <th class="px-3 py-2 text-center w-16">Image</th>
        <th class="px-3 py-2 text-left cursor-pointer select-none hover:bg-gray-700 transition" onclick="sortZoho('zoho_item_name')">
            Item Name <span id="zsort-zoho_item_name" class="ml-1 text-gray-400">⇅</span>
        </th>
        <th class="px-3 py-2 text-left cursor-pointer select-none hover:bg-gray-700 transition" onclick="sortZoho('zoho_sku')">
            SKU <span id="zsort-zoho_sku" class="ml-1 text-gray-400">⇅</span>
        </th>
        <th class="px-3 py-2 text-left cursor-pointer select-none hover:bg-gray-700 transition" onclick="sortZoho('zoho_brand')">
            Brand <span id="zsort-zoho_brand" class="ml-1 text-gray-400">⇅</span>
        </th>
        <th class="px-3 py-2 text-left cursor-pointer select-none hover:bg-gray-700 transition" onclick="sortZoho('zoho_category_name')">
            Category <span id="zsort-zoho_category_name" class="ml-1 text-gray-400">⇅</span>
        </th>
        <th class="px-3 py-2 text-right cursor-pointer select-none hover:bg-gray-700 transition" onclick="sortZoho('zoho_rate')">
            Rate <span id="zsort-zoho_rate" class="ml-1 text-gray-400">⇅</span>
        </th>
        <th class="px-3 py-2 text-right cursor-pointer select-none hover:bg-gray-700 transition" onclick="sortZoho('zoho_stock_on_hand')">
            Stock <span id="zsort-zoho_stock_on_hand" class="ml-1 text-gray-400">⇅</span>
        </th>
        <th class="px-3 py-2 text-left">HSN</th>
    </tr>
    <!-- Filter Row -->
    <tr class="bg-gray-100 border-b">
        <td class="px-1 py-1"></td>
        <td class="px-1 py-1"></td>
        <td class="px-1 py-1">
            <input type="text" id="zohoSearchInput" placeholder="Search..." class="w-full px-2 py-1 text-xs border border-gray-300 rounded focus:border-purple-500 focus:outline-none" oninput="debounceZohoSearch()">
        </td>
        <td class="px-1 py-1"></td>
        <td class="px-1 py-1">
            <select id="zohoFilterBrand" class="w-full px-1 py-1 text-xs border border-gray-300 rounded focus:border-purple-500 focus:outline-none" onchange="zohoCurrentPage=1; loadZohoItems()">
                <option value="">All</option>
            </select>
        </td>
        <td class="px-1 py-1">
            <select id="zohoFilterCategory" class="w-full px-1 py-1 text-xs border border-gray-300 rounded focus:border-purple-500 focus:outline-none" onchange="zohoCurrentPage=1; loadZohoItems()">
                <option value="">All</option>
            </select>
        </td>
        <td class="px-1 py-1"></td>
        <td class="px-1 py-1"></td>
        <td class="px-1 py-1">
            <select id="zohoFilterMapped" class="w-full px-1 py-1 text-xs border border-gray-300 rounded focus:border-purple-500 focus:outline-none" onchange="zohoCurrentPage=1; loadZohoItems()">
                <option value="">All</option>
                <option value="unmapped">Unmapped</option>
                <option value="mapped">Mapped</option>
            </select>
        </td>
    </tr>
</thead>
```

- [ ] **Step 2: Add Zoho sort state and function**

```javascript
let zohoSortCol = '';
let zohoSortDir = '';

function sortZoho(col) {
    if (zohoSortCol === col) {
        if (zohoSortDir === 'asc') zohoSortDir = 'desc';
        else if (zohoSortDir === 'desc') { zohoSortDir = ''; zohoSortCol = ''; }
        else zohoSortDir = 'asc';
    } else {
        zohoSortCol = col;
        zohoSortDir = 'asc';
    }
    updateZohoSortArrows();
    zohoCurrentPage = 1;
    loadZohoItems();
}

function updateZohoSortArrows() {
    document.querySelectorAll('[id^="zsort-"]').forEach(el => {
        el.textContent = '⇅';
        el.className = 'ml-1 text-gray-400';
    });
    if (zohoSortCol && zohoSortDir) {
        const el = document.getElementById('zsort-' + zohoSortCol);
        if (el) {
            el.textContent = zohoSortDir === 'asc' ? '▲' : '▼';
            el.className = 'ml-1 text-yellow-300';
        }
    }
}
```

- [ ] **Step 3: Update loadZohoItems() to send sort params**

In the `loadZohoItems()` function, after building the `params` URLSearchParams, add:

```javascript
if (zohoSortCol) params.set('sort', zohoSortCol);
if (zohoSortDir) params.set('order', zohoSortDir);
```

- [ ] **Step 4: Commit**

```bash
git add public/admin-products.html
git commit -m "feat: add column sort/filter to Zoho Import tab"
```

### Task 3: Backend — Add sort/order params to GET /api/zoho/items

**Files:**
- Modify: `routes/zoho.js`

- [ ] **Step 1: Add sort/order support to the endpoint**

In `routes/zoho.js`, find the `GET /api/zoho/items` endpoint (around line 1699). Find the hardcoded `ORDER BY zim.zoho_item_name ASC` (line 1754).

Replace the ORDER BY line with:

```javascript
// Before the ORDER BY line, add sort whitelist:
const SORT_WHITELIST = ['zoho_item_name', 'zoho_sku', 'zoho_brand', 'zoho_category_name', 'zoho_rate', 'zoho_stock_on_hand'];
const sortCol = SORT_WHITELIST.includes(req.query.sort) ? `zim.${req.query.sort}` : 'zim.zoho_item_name';
const sortOrder = req.query.order === 'desc' ? 'DESC' : 'ASC';

// Replace: ORDER BY zim.zoho_item_name ASC
// With:
ORDER BY ${sortCol} ${sortOrder}
```

This is a SQL template string — the column name comes from a whitelist (safe against injection), and order is limited to ASC/DESC.

- [ ] **Step 2: Test**

```bash
# Test sort works:
curl -s "http://localhost:3000/api/zoho/items?sort=zoho_rate&order=desc&limit=5" -H "Authorization: Bearer <token>" | head -200
```

- [ ] **Step 3: Commit**

```bash
git add routes/zoho.js
git commit -m "feat: add sort/order params to GET /api/zoho/items endpoint"
```

---

## Chunk 3: Zoho Items Edit — Bulk Scoping Fix + Paste to All

### Task 4: Fix applyPctAdjust() scoping bug

**Files:**
- Modify: `public/admin-zoho-items-edit.html`

- [ ] **Step 1: Fix the 'page' scope to use getFilteredItems()**

Find the `applyPctAdjust()` function (around line 490). Find the line:

```javascript
} else { targetItems = items; }
```

Replace with:

```javascript
} else { targetItems = getFilteredItems(); }
```

This ensures "All on current page" respects active column filters.

- [ ] **Step 2: Add confirmation showing count**

After the `targetItems` assignment and before the `forEach`, add:

```javascript
if (!confirm('Apply ' + (pct > 0 ? '+' : '') + pct + '% to ' + field.replace('_', ' ') + ' for ' + targetItems.length + ' items?')) return;
```

- [ ] **Step 3: Commit**

```bash
git add public/admin-zoho-items-edit.html
git commit -m "fix: scope bulk % adjustment to filtered items only"
```

### Task 5: Add Paste to All Rows dropdown

**Files:**
- Modify: `public/admin-zoho-items-edit.html`

- [ ] **Step 1: Add CSS for the paste dropdown**

Add to the `<style>` section:

```css
.paste-dropdown-trigger {
    position: absolute;
    right: 2px;
    top: 50%;
    transform: translateY(-50%);
    width: 18px;
    height: 18px;
    background: #667eea;
    color: white;
    border: none;
    border-radius: 3px;
    font-size: 10px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 5;
    opacity: 0.85;
    transition: opacity 0.15s;
}
.paste-dropdown-trigger:hover { opacity: 1; }

.paste-dropdown-menu {
    position: absolute;
    right: 0;
    top: 100%;
    margin-top: 2px;
    background: white;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.12);
    z-index: 100;
    min-width: 180px;
    overflow: hidden;
}
.paste-dropdown-menu button {
    display: block;
    width: 100%;
    text-align: left;
    padding: 8px 12px;
    font-size: 12px;
    color: #374151;
    border: none;
    background: white;
    cursor: pointer;
}
.paste-dropdown-menu button:hover { background: #f3f4f6; }
.paste-dropdown-menu button:disabled { color: #9ca3af; cursor: not-allowed; }
.paste-dropdown-menu button:disabled:hover { background: white; }

.cell-flash {
    animation: cellFlash 0.6s ease;
}
@keyframes cellFlash {
    0% { background-color: #d1fae5; }
    100% { background-color: transparent; }
}
```

- [ ] **Step 2: Add paste dropdown logic**

Add these functions to the `<script>` section:

```javascript
// ========================================
// PASTE TO ALL ROWS
// ========================================
var pasteDropdownTimeout = null;
var activePasteDropdown = null;

function showPasteDropdown(cell, itemId, field, value) {
    removePasteDropdown(); // Clear any existing

    // Don't show for readonly fields
    var readonlyFields = ['zoho_item_id', 'zoho_stock_on_hand', 'last_synced_at'];
    if (readonlyFields.indexOf(field) !== -1) return;

    // Make cell position relative for absolute positioning
    cell.style.position = 'relative';

    var trigger = document.createElement('button');
    trigger.className = 'paste-dropdown-trigger';
    trigger.innerHTML = '▾';
    trigger.title = 'Paste to multiple rows';
    trigger.onclick = function(e) {
        e.stopPropagation();
        togglePasteMenu(cell, field, value);
    };
    cell.appendChild(trigger);
    activePasteDropdown = { cell: cell, trigger: trigger, field: field, value: value };

    // Auto-hide after 4 seconds
    pasteDropdownTimeout = setTimeout(removePasteDropdown, 4000);
}

function togglePasteMenu(cell, field, value) {
    // Remove existing menu
    var existing = cell.querySelector('.paste-dropdown-menu');
    if (existing) { existing.remove(); return; }

    clearTimeout(pasteDropdownTimeout);

    var menu = document.createElement('div');
    menu.className = 'paste-dropdown-menu';

    var filteredCount = getFilteredItems().length;
    var selectedCount = selectedItemIds.size;

    var btn1 = document.createElement('button');
    btn1.textContent = 'Paste to all rows (' + filteredCount + ')';
    btn1.onclick = function() { pasteToRows('filtered', field, value); menu.remove(); };

    var btn2 = document.createElement('button');
    btn2.textContent = 'Paste to selected (' + selectedCount + ')';
    btn2.disabled = selectedCount === 0;
    btn2.onclick = function() { pasteToRows('selected', field, value); menu.remove(); };

    menu.appendChild(btn1);
    menu.appendChild(btn2);
    cell.appendChild(menu);

    // Close on outside click
    setTimeout(function() {
        document.addEventListener('click', closePasteMenu, { once: true });
    }, 10);
}

function closePasteMenu() {
    document.querySelectorAll('.paste-dropdown-menu').forEach(function(m) { m.remove(); });
}

function removePasteDropdown() {
    clearTimeout(pasteDropdownTimeout);
    if (activePasteDropdown) {
        if (activePasteDropdown.trigger && activePasteDropdown.trigger.parentElement) {
            activePasteDropdown.trigger.remove();
        }
        activePasteDropdown = null;
    }
    closePasteMenu();
}

function pasteToRows(scope, field, value) {
    var displayVal = String(value).length > 20 ? String(value).substring(0, 20) + '...' : String(value);
    var targetItems;

    if (scope === 'selected') {
        targetItems = getFilteredItems().filter(function(it) {
            return selectedItemIds.has(String(it.item_id || it.zoho_item_id));
        });
    } else {
        targetItems = getFilteredItems();
    }

    if (targetItems.length === 0) {
        showToast('No items to paste to', 'error');
        return;
    }

    if (!confirm("Apply '" + displayVal + "' to " + field.replace(/^zoho_/, '').replace(/_/g, ' ') + " for " + targetItems.length + " rows?")) {
        return;
    }

    var count = 0;
    targetItems.forEach(function(item) {
        var id = String(item.item_id || item.zoho_item_id);
        setDirty(id, field, String(value));
        count++;
    });

    removePasteDropdown();
    renderTable();
    showToast('Updated ' + count + ' rows', 'success');

    // Flash affected cells
    setTimeout(function() {
        document.querySelectorAll('td[data-field="' + field + '"]').forEach(function(td) {
            td.classList.add('cell-flash');
            setTimeout(function() { td.classList.remove('cell-flash'); }, 600);
        });
    }, 50);
}
```

- [ ] **Step 3: Hook into commitEdit() to show paste dropdown on blur-commit**

Find the `commitEdit()` function (around line 728). Add the paste dropdown trigger at the end, but ONLY for blur-commits (not Enter/Tab):

The key insight: `commitEdit()` is called from both keyboard handlers (Enter/Tab) and blur. We need to distinguish. Add a parameter:

Find the blur handler that calls `commitEdit`. It's likely in `startEdit()` where the input's `onblur` is set. Add a `fromBlur` flag:

```javascript
// In the commitEdit function, add a second parameter:
function commitEdit(cell, fromBlur) {
    if (!cell || !cell.classList.contains('editing')) return;
    var itemId = cell.getAttribute('data-item-id'), field = cell.getAttribute('data-field');
    var val = getCurrentValue(itemId, field);
    var displayVal = val !== null && val !== undefined ? String(val) : '';
    cell.classList.remove('editing');
    cell.classList.toggle('dirty', isDirty(itemId, field));
    cell.innerHTML = escapeHtml(displayVal) || '<span style="color:#cbd5e1">--</span>';
    cell.title = displayVal;
    if (activeEditCell === cell) activeEditCell = null;
    // Update row dirty class
    var tr = cell.closest('tr');
    if (tr) tr.classList.toggle('row-dirty', dirtyItems.has(itemId));

    // Show paste dropdown only on blur-commit and if cell is dirty
    if (fromBlur && isDirty(itemId, field)) {
        showPasteDropdown(cell, itemId, field, val);
    }
}
```

Then find where `commitEdit` is called from blur (in `startEdit()` or wherever the input's `onblur` is bound) and pass `true` as the second argument:

```javascript
// In the blur handler:
input.onblur = function() { commitEdit(cell, true); };
// or
input.addEventListener('blur', function() { commitEdit(cell, true); });
```

For Enter/Tab key handlers, keep calling `commitEdit(cell)` without the second argument (defaults to `undefined`/falsy).

- [ ] **Step 4: Test**

1. Open `admin-zoho-items-edit.html`
2. Search for a brand (e.g., "ASIAN")
3. Edit a Category cell, type "ENAMEL", click away (blur)
4. Verify small `▾` button appears on the cell
5. Click `▾` → verify dropdown shows "Paste to all rows (N)" with correct filtered count
6. Click "Paste to all rows" → verify confirmation dialog
7. Confirm → verify all visible rows update, cells flash green
8. Verify the % adjustment tool also respects filters (search for items, apply % → only filtered items change)

- [ ] **Step 5: Commit**

```bash
git add public/admin-zoho-items-edit.html
git commit -m "feat: add Paste to All Rows dropdown, fix bulk edit scoping"
```

---

## Chunk 4: Deploy

### Task 6: Deploy to production

- [ ] **Step 1: Push and deploy**

```bash
git push origin master
ssh root@161.97.114.189 "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && pm2 restart business-manager"
```

- [ ] **Step 2: Verify on production**

1. `https://act.qcpaintshop.com/admin-products.html` — Products tab: click Name header to sort, use column filters
2. `https://act.qcpaintshop.com/admin-products.html?tab=zoho-import` — Zoho Import tab: click Rate header to sort by price
3. `https://act.qcpaintshop.com/admin-zoho-items-edit.html` — Search items, edit a cell, verify paste dropdown, test bulk % with filters active
