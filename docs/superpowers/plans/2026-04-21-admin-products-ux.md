# Admin Products UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add inline "Add to Existing Product" assignment from the Zoho Import tab, and make both Products tab and Zoho Import tab fully mobile-responsive (card layout below 768px).

**Architecture:** One new backend endpoint in `server.js` handles the atomic pack-size-create + zoho-map in one call. All frontend changes are in `public/admin-products.html` — the JS render functions check `window.innerWidth < 768` and switch between desktop table and mobile card markup. Desktop layout is untouched.

**Tech Stack:** Express.js (server.js), vanilla JS, Tailwind CSS, MySQL (pool.query)

---

## File Map

| File | What changes |
|---|---|
| `server.js` | New `POST /api/products/assign-zoho-item` endpoint near line 2580 |
| `public/admin-products.html` | Mobile CSS + mobile render paths in `renderProducts()` and `renderZohoItems()` + `assignZohoItem()` inline search flow |

---

### Task 1: Backend — assign-zoho-item endpoint

**Files:**
- Modify: `server.js` (insert after the bulk-map endpoint ~line 2579)

- [ ] **Step 1: Find the insertion point**

Open `server.js`. Find line containing:
```javascript
app.post('/api/products/bulk-map', requirePermission('products', 'edit'),
```
The new endpoint goes immediately after the closing `});` of that handler (~line 2579).

- [ ] **Step 2: Insert the endpoint**

```javascript
// Assign a single Zoho item to an existing product (creates pack_size + sets zoho_item_id atomically)
app.post('/api/products/assign-zoho-item', requirePermission('products', 'edit'), async (req, res) => {
    try {
        const { product_id, zoho_item_id, size, unit, price } = req.body;
        if (!product_id || !zoho_item_id || !size || !unit) {
            return res.status(400).json({ success: false, error: 'product_id, zoho_item_id, size, unit are required' });
        }
        const parsedSize = parseFloat(size);
        const parsedPrice = parseFloat(price) || 0;
        if (isNaN(parsedSize) || parsedSize <= 0) {
            return res.status(400).json({ success: false, error: 'size must be a positive number' });
        }

        // Confirm product exists
        const [products] = await pool.query('SELECT id FROM products WHERE id = ? AND status = "active"', [product_id]);
        if (!products.length) return res.status(404).json({ success: false, error: 'Product not found' });

        // Check zoho_item_id isn't already linked to a pack_size
        const [existing] = await pool.query('SELECT id FROM pack_sizes WHERE zoho_item_id = ? AND is_active = 1', [zoho_item_id]);
        if (existing.length) {
            return res.status(409).json({ success: false, error: 'This Zoho item is already mapped to a pack size', pack_size_id: existing[0].id });
        }

        const [result] = await pool.query(
            'INSERT INTO pack_sizes (product_id, size, unit, base_price, zoho_item_id, is_active) VALUES (?, ?, ?, ?, ?, 1)',
            [product_id, parsedSize, unit.toUpperCase(), parsedPrice, zoho_item_id]
        );

        res.json({ success: true, pack_size_id: result.insertId });
    } catch (err) {
        console.error('assign-zoho-item error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
```

- [ ] **Step 3: Verify server restarts cleanly**

```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/act.qcpaintshop.com"
node -e "require('./server.js')" 2>&1 | head -5
```
Expected: No syntax errors (will show connection logs, not crash).

- [ ] **Step 4: Test the endpoint with curl**

```bash
# Should return 400 (missing fields)
curl -s -X POST http://localhost:3000/api/products/assign-zoho-item \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer test" \
  -d '{}' | python -c "import sys,json; print(json.load(sys.stdin))"
```
Expected: `{'success': False, 'error': 'product_id, zoho_item_id, size, unit are required'}` (or 401 if auth required first — that's fine, means the route is registered).

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat(products): POST /api/products/assign-zoho-item endpoint"
```

---

### Task 2: Frontend — inline "Add to Existing" JS utilities

**Files:**
- Modify: `public/admin-products.html` (JS section, before the closing `</script>` tag)

These utility functions power the inline search dropdown used in both flat and grouped views.

- [ ] **Step 1: Find the JS section end**

Search for the last `</script>` tag in `admin-products.html`. Insert the following block just before it.

- [ ] **Step 2: Add utility state and functions**

```javascript
// ── Assign-to-existing inline search ──────────────────────────────────────
let assignDropdownActiveId = null; // currently open dropdown's zoho_item_id

function openAssignDropdown(zohoItemId, size, unit, price, anchorEl) {
    // Close any existing dropdown first
    closeAssignDropdown();
    assignDropdownActiveId = zohoItemId;

    const dropdown = document.createElement('div');
    dropdown.id = 'assign-dropdown-' + zohoItemId.replace(/[^a-z0-9]/gi, '_');
    dropdown.className = 'assign-dropdown';
    dropdown.innerHTML = `
        <div style="padding:8px;border-bottom:1px solid #e2e8f0;">
            <input id="assign-search-${zohoItemId.replace(/[^a-z0-9]/gi,'_')}"
                type="text" placeholder="🔍 Search product to assign to…"
                style="width:100%;border:1px solid #93c5fd;border-radius:6px;padding:6px 10px;font-size:0.82rem;box-sizing:border-box;outline:none;"
                oninput="debounceAssignSearch('${zohoItemId}', '${escH(size)}', '${escH(unit)}', ${price}, this)"
                autocomplete="off">
        </div>
        <div id="assign-results-${zohoItemId.replace(/[^a-z0-9]/gi,'_')}" style="max-height:200px;overflow-y:auto;">
            <div style="padding:10px;color:#94a3b8;font-size:0.8rem;text-align:center;">Type to search…</div>
        </div>`;
    dropdown.style.cssText = 'position:absolute;z-index:999;background:#fff;border:1px solid #93c5fd;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.12);width:320px;margin-top:4px;';

    // Position below the anchor button
    const rect = anchorEl.getBoundingClientRect();
    dropdown.style.top = (rect.bottom + window.scrollY + 4) + 'px';
    dropdown.style.left = Math.max(8, rect.left + window.scrollX - 160) + 'px';
    document.body.appendChild(dropdown);

    // Auto-focus
    setTimeout(() => dropdown.querySelector('input')?.focus(), 50);

    // Click outside to close
    setTimeout(() => {
        document.addEventListener('click', outsideAssignClick, true);
    }, 100);
}

function outsideAssignClick(e) {
    const dropdown = document.querySelector('.assign-dropdown');
    if (dropdown && !dropdown.contains(e.target) && !e.target.closest('[data-assign-btn]')) {
        closeAssignDropdown();
    }
}

function closeAssignDropdown() {
    document.querySelector('.assign-dropdown')?.remove();
    document.removeEventListener('click', outsideAssignClick, true);
    assignDropdownActiveId = null;
}

let assignSearchTimer = null;
function debounceAssignSearch(zohoItemId, size, unit, price, inputEl) {
    clearTimeout(assignSearchTimer);
    assignSearchTimer = setTimeout(() => doAssignSearch(zohoItemId, size, unit, price, inputEl.value.trim()), 280);
}

async function doAssignSearch(zohoItemId, size, unit, price, query) {
    const safeId = zohoItemId.replace(/[^a-z0-9]/gi, '_');
    const resultsEl = document.getElementById('assign-results-' + safeId);
    if (!resultsEl) return;

    if (!query) {
        resultsEl.innerHTML = '<div style="padding:10px;color:#94a3b8;font-size:0.8rem;text-align:center;">Type to search…</div>';
        return;
    }
    resultsEl.innerHTML = '<div style="padding:10px;color:#94a3b8;font-size:0.8rem;text-align:center;">Searching…</div>';

    try {
        const res = await fetch(`/api/products?search=${encodeURIComponent(query)}&limit=8&status=active`, { headers: getAuthHeaders() });
        const data = await res.json();
        const items = data.products || data || [];
        if (!items.length) {
            resultsEl.innerHTML = '<div style="padding:10px;color:#94a3b8;font-size:0.8rem;text-align:center;">No products found</div>';
            return;
        }
        resultsEl.innerHTML = items.map(p => `
            <div onclick="confirmAssignZohoItem('${escH(zohoItemId)}', ${p.id}, '${escH(p.name)}', '${escH(size)}', '${escH(unit)}', ${price})"
                style="padding:9px 12px;cursor:pointer;border-bottom:1px solid #f1f5f9;font-size:0.82rem;"
                onmouseover="this.style.background='#eff6ff'" onmouseout="this.style.background=''">
                <span style="font-weight:600;color:#1d4ed8;">${escH(p.name)}</span>
                <span style="color:#94a3b8;font-size:0.75rem;margin-left:8px;">${p.brand_name || ''}</span>
            </div>`).join('');
    } catch (e) {
        resultsEl.innerHTML = '<div style="padding:10px;color:#dc2626;font-size:0.8rem;text-align:center;">Search failed</div>';
    }
}

async function confirmAssignZohoItem(zohoItemId, productId, productName, size, unit, price) {
    closeAssignDropdown();
    if (!confirm(`Add ${size}${unit} @ ₹${price} to "${productName}"?`)) return;

    try {
        const res = await fetch('/api/products/assign-zoho-item', {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ product_id: productId, zoho_item_id: zohoItemId, size, unit, price })
        });
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Failed');

        // Update local mapped state
        zohoMappedIds.add(zohoItemId);
        zohoMappedInfo[zohoItemId] = { product_id: productId, product_name: productName };

        // Re-render the current view
        await loadZohoItems();
        showToast(`✓ Assigned to "${productName}"`, 'success');
    } catch (e) {
        showToast('Error: ' + e.message, 'error');
    }
}

function showToast(msg, type) {
    const t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = `position:fixed;bottom:80px;left:50%;transform:translateX(-50%);padding:10px 20px;border-radius:10px;font-size:0.85rem;font-weight:600;z-index:9999;color:#fff;background:${type==='success'?'#10b981':'#ef4444'};box-shadow:0 4px 12px rgba(0,0,0,0.15);`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
}
```

- [ ] **Step 3: Verify no JS errors**

Open `http://localhost:3000/admin-products.html` in browser, open DevTools console. Expected: no errors on page load.

- [ ] **Step 4: Commit**

```bash
git add public/admin-products.html
git commit -m "feat(products): assign-to-existing JS utility functions"
```

---

### Task 3: Frontend — wire "Add to Existing" into flat and grouped views

**Files:**
- Modify: `public/admin-products.html` — `renderZohoItems()` flat view and grouped view sections

- [ ] **Step 1: Add "Add to Existing" button to flat view unmapped rows**

Find the flat view section (around line 1331). Find this code block inside the flat view `items.map()`:
```javascript
: `<input type="checkbox" value="${itemId}" ${isSelected ? 'checked' : ''} onchange="toggleZohoItemSelect('${itemId}', this.checked)" class="zoho-item-cb w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500">`
```

Replace the entire `isMapped ? ... : ...` ternary in that `<td>` with:
```javascript
${isMapped
    ? `<button onclick="switchToProductsAndEdit(${zohoMappedInfo[itemId]?.product_id})" class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-green-100 text-green-700 hover:bg-green-200 cursor-pointer border border-green-200 transition" title="Mapped to: ${escH(zohoMappedInfo[itemId]?.product_name || '')} — Click to edit">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
        Edit
    </button>`
    : `<div class="flex flex-col gap-1">
        <input type="checkbox" value="${itemId}" ${isSelected ? 'checked' : ''} onchange="toggleZohoItemSelect('${itemId}', this.checked)" class="zoho-item-cb w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500">
        <button data-assign-btn onclick="event.stopPropagation();openAssignDropdown('${itemId}','${escH(extractSizeFromName(item.name||item.item_name||''))}','${escH(extractUnitFromName(item.name||item.item_name||''))}',${parseFloat(item.rate)||0},this)" class="text-xs px-1.5 py-0.5 bg-blue-50 border border-blue-200 text-blue-700 rounded hover:bg-blue-100 whitespace-nowrap">Assign ▾</button>
    </div>`
}
```

- [ ] **Step 2: Add helper functions for size/unit extraction**

Just before the `openAssignDropdown` function added in Task 2, add:
```javascript
function extractSizeFromName(name) {
    const m = name.match(/(\d+(?:\.\d+)?)\s*(L|KG|ltr|litre|kg|liter|Ltr|Litre)/i);
    return m ? m[1] : '';
}
function extractUnitFromName(name) {
    const m = name.match(/\d+(?:\.\d+)?\s*(L|KG|ltr|litre|kg|liter|Ltr|Litre)/i);
    if (!m) return 'L';
    const u = m[1].toUpperCase();
    if (u === 'LTR' || u === 'LITRE' || u === 'LITER') return 'L';
    return u;
}
```

- [ ] **Step 3: Add "Add to Existing" button to grouped view unmapped groups**

Find the grouped view section (around line 1295). Find this block inside `groups.map()`:
```javascript
: `<input type="checkbox" ${allSelected ? 'checked' : ''} onchange="toggleZohoGroupSelect([${itemIds.map(id => '\'' + id + '\'').join(',')}], this.checked)" class="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500">`
```

Replace the entire first `<td>` cell content's ternary (the checkbox vs Mapped button cell) with:
```javascript
${g.allMapped
    ? `<button onclick="switchToProductsAndEdit(${mappedProduct?.product_id})" class="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold bg-green-100 text-green-700 hover:bg-green-200 cursor-pointer border border-green-200 transition" title="Mapped to: ${escH(mappedProduct?.product_name || '')}">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
        Mapped
    </button>`
    : `<div class="flex flex-col gap-1 items-center">
        <input type="checkbox" ${allSelected ? 'checked' : ''} onchange="toggleZohoGroupSelect([${itemIds.map(id => "'" + id + "'").join(',')}], this.checked)" class="w-4 h-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500">
        <button data-assign-btn onclick="event.stopPropagation();openGroupAssignDropdown(${JSON.stringify(g.items).replace(/"/g,'&quot;')},this)" class="text-xs px-1.5 py-0.5 bg-blue-50 border border-blue-200 text-blue-700 rounded hover:bg-blue-100 whitespace-nowrap">Assign ▾</button>
    </div>`
}
```

- [ ] **Step 4: Add openGroupAssignDropdown function**

After the `confirmAssignZohoItem` function (Task 2), add:
```javascript
async function openGroupAssignDropdown(groupItems, anchorEl) {
    // Use first item's metadata for the anchor; will assign ALL unmapped items in group
    const unmapped = groupItems.filter(i => !zohoMappedIds.has(i.zoho_item_id || i.item_id));
    if (!unmapped.length) { showToast('All items in group are already mapped', 'error'); return; }
    const first = unmapped[0];
    const size = extractSizeFromName(first.name || first.item_name || '');
    const unit = extractUnitFromName(first.name || first.item_name || '');
    const price = parseFloat(first.rate) || 0;
    // Use a composite key for dropdown ID
    const groupKey = 'grp_' + (first.zoho_item_id || first.item_id);
    openAssignDropdown(groupKey, size, unit, price, anchorEl);

    // Override confirmAssign for this group to assign all unmapped items
    window._pendingGroupItems = unmapped;
    window._originalConfirm = window.confirmAssignZohoItem;
    window.confirmAssignZohoItem = async function(_, productId, productName) {
        closeAssignDropdown();
        window.confirmAssignZohoItem = window._originalConfirm;
        if (!confirm(`Assign ${unmapped.length} unmapped item(s) to "${productName}"?`)) return;
        let ok = 0, fail = 0;
        for (const item of unmapped) {
            const itemId = item.zoho_item_id || item.item_id;
            const sz = extractSizeFromName(item.name || item.item_name || '');
            const un = extractUnitFromName(item.name || item.item_name || '');
            const pr = parseFloat(item.rate) || 0;
            try {
                const res = await fetch('/api/products/assign-zoho-item', {
                    method: 'POST',
                    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({ product_id: productId, zoho_item_id: itemId, size: sz, unit: un, price: pr })
                });
                const data = await res.json();
                if (data.success) { zohoMappedIds.add(itemId); zohoMappedInfo[itemId] = { product_id: productId, product_name: productName }; ok++; }
                else fail++;
            } catch { fail++; }
        }
        await loadZohoItems();
        showToast(`✓ Assigned ${ok} item(s) to "${productName}"${fail ? ', ' + fail + ' failed' : ''}`, ok ? 'success' : 'error');
    };
}
```

- [ ] **Step 5: Smoke test in browser**

1. Open `http://localhost:3000/admin-products.html?tab=zoho-import`
2. Find an unmapped item in flat view — confirm "Assign ▾" button appears
3. Click it — confirm search dropdown opens
4. Type a product name — confirm results appear
5. Click a result — confirm confirmation dialog, then row updates to "Mapped ✓"
6. Switch to grouped view — confirm "Assign ▾" appears on unmapped group cards

- [ ] **Step 6: Commit**

```bash
git add public/admin-products.html
git commit -m "feat(products): inline assign-to-existing button in flat and grouped zoho import views"
```

---

### Task 4: Frontend — mobile-responsive Products tab

**Files:**
- Modify: `public/admin-products.html` — CSS `<style>` block + `renderProducts()` function + filter bar HTML

- [ ] **Step 1: Add mobile CSS**

Find the `<style>` block in the `<head>` (or add one before `</head>`). Append:
```css
<style>
/* ── Mobile: Products Tab ───────────────────────────── */
.products-table-wrap { display: block; }
.products-mobile-list { display: none; }
.filter-drawer-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: 400; }
.filter-drawer { display: none; position: fixed; bottom: 0; left: 0; right: 0; background: #fff; border-radius: 20px 20px 0 0; z-index: 401; padding: 20px; max-height: 80vh; overflow-y: auto; box-shadow: 0 -4px 24px rgba(0,0,0,0.15); }
.filter-drawer.open, .filter-drawer-overlay.open { display: block; }

@media (max-width: 767px) {
    .products-table-wrap { display: none !important; }
    .products-mobile-list { display: block; }
    #headerActions { display: none; } /* replaced by mobile Add button */
    .products-mobile-add { display: flex !important; }

    /* Zoho import table → hidden on mobile */
    .zoho-table-wrap { display: none !important; }
    .zoho-mobile-list { display: block; }
    .zoho-desktop-toolbar { display: none !important; }
    .zoho-mobile-toolbar { display: flex !important; }
}
.products-mobile-add { display: none; }
.zoho-mobile-list { display: none; }
.zoho-mobile-toolbar { display: none; }
</style>
```

- [ ] **Step 2: Wrap the existing products table**

Find the `<table>` element inside the products tab. Wrap it:

Before:
```html
<div class="card">
    <div id="loadingState"...>
```

Wrap the table (everything from the opening `<div class="overflow-x-auto">` to its closing `</div>`) in:
```html
<div class="products-table-wrap">
  <!-- existing table markup unchanged -->
</div>
<div class="products-mobile-list" id="productsMobileList"></div>
```

Also add after the existing "Add Product" header button:
```html
<button onclick="openAddModal()" class="products-mobile-add items-center gap-2 px-3 py-2 bg-green-700 text-white text-sm font-semibold rounded-lg" data-permission-module="products" data-permission-action="add">
    + Add
</button>
```

- [ ] **Step 3: Add filter drawer HTML**

Just before `</body>`, add:
```html
<!-- Mobile Filter Drawer -->
<div class="filter-drawer-overlay" id="filterDrawerOverlay" onclick="closeFilterDrawer()"></div>
<div class="filter-drawer" id="filterDrawer">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <span style="font-weight:700;font-size:1rem;">Filter Products</span>
        <button onclick="clearFilters();closeFilterDrawer()" style="background:none;border:none;color:#64748b;font-size:0.85rem;cursor:pointer;">Clear all</button>
    </div>
    <div style="margin-bottom:12px;">
        <div style="font-size:0.72rem;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:5px;">Brand</div>
        <select id="filterBrandMobile" onchange="document.getElementById('filterBrand').value=this.value;renderProducts();" style="width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;font-size:0.85rem;"></select>
    </div>
    <div style="margin-bottom:12px;">
        <div style="font-size:0.72rem;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:5px;">Category</div>
        <select id="filterCategoryMobile" onchange="document.getElementById('filterCategory').value=this.value;renderProducts();" style="width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;font-size:0.85rem;"></select>
    </div>
    <div style="margin-bottom:12px;">
        <div style="font-size:0.72rem;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:5px;">Status</div>
        <div style="display:flex;gap:6px;">
            <button onclick="setMobileFilter('filterStatus','')" class="mobile-filter-btn flex-1 py-2 rounded-lg text-sm border" id="mfStatus-all">All</button>
            <button onclick="setMobileFilter('filterStatus','active')" class="mobile-filter-btn flex-1 py-2 rounded-lg text-sm border" id="mfStatus-active">Active</button>
            <button onclick="setMobileFilter('filterStatus','inactive')" class="mobile-filter-btn flex-1 py-2 rounded-lg text-sm border" id="mfStatus-inactive">Inactive</button>
        </div>
    </div>
    <div style="margin-bottom:20px;">
        <div style="font-size:0.72rem;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:5px;">Type</div>
        <div style="display:flex;gap:6px;">
            <button onclick="setMobileFilter('filterType','')" class="mobile-filter-btn flex-1 py-2 rounded-lg text-sm border" id="mfType-all">All</button>
            <button onclick="setMobileFilter('filterType','area_wise')" class="mobile-filter-btn flex-1 py-2 rounded-lg text-sm border" id="mfType-area">Area</button>
            <button onclick="setMobileFilter('filterType','unit_wise')" class="mobile-filter-btn flex-1 py-2 rounded-lg text-sm border" id="mfType-unit">Unit</button>
        </div>
    </div>
    <button onclick="closeFilterDrawer()" style="width:100%;background:#1B5E3B;color:#fff;border:none;border-radius:10px;padding:12px;font-size:0.9rem;font-weight:600;cursor:pointer;">Apply Filters</button>
</div>
```

- [ ] **Step 4: Add mobile filter bar to Products tab HTML**

Find the existing desktop filter bar inside `#tab-products` (the `<div class="flex items-center...">` with search/brand/category selects). Wrap it with `class="desktop-filter-bar"` and add a mobile filter bar after it:

```html
<div class="block md:hidden mb-3" id="mobileProductsFilterBar">
    <div style="display:flex;gap:8px;">
        <input type="text" id="filterNameMobile" placeholder="🔍 Search products…"
            style="flex:1;border:1px solid #e2e8f0;border-radius:10px;padding:8px 12px;font-size:0.85rem;"
            oninput="document.getElementById('filterName').value=this.value;renderProducts();updateMobileFilterChips();">
        <button onclick="openFilterDrawer()" style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:10px;padding:8px 14px;font-size:0.85rem;white-space:nowrap;">Filter ▾</button>
        <button onclick="openAddModal()" style="background:#1B5E3B;color:#fff;border:none;border-radius:10px;padding:8px 14px;font-size:0.85rem;font-weight:600;" data-permission-module="products" data-permission-action="add">+ Add</button>
    </div>
    <div id="mobileActiveChips" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;"></div>
</div>
```

- [ ] **Step 5: Add mobile render path to renderProducts()**

Find the `renderProducts()` function. At the **end** of the function (after the `tbody.innerHTML = ...` line), add:

```javascript
// Mobile card render
if (window.innerWidth < 768) {
    const mobileList = document.getElementById('productsMobileList');
    if (!mobileList) return;
    if (filtered.length === 0) {
        mobileList.innerHTML = `<div style="text-align:center;padding:40px;color:#94a3b8;">No products match your filters.</div>`;
        return;
    }
    mobileList.innerHTML = filtered.map(p => `
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:12px;margin-bottom:8px;display:flex;gap:10px;align-items:center;" onclick="editProduct(${p.id})">
            ${p.image_url
                ? `<img src="${escHtml(p.image_url)}" style="width:44px;height:44px;object-fit:cover;border-radius:8px;border:1px solid #e2e8f0;flex-shrink:0;">`
                : `<div style="width:44px;height:44px;background:#f1f5f9;border-radius:8px;border:2px dashed #d1d5db;display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:1.2rem;">🎨</div>`
            }
            <div style="flex:1;min-width:0;">
                <div style="font-weight:700;font-size:0.88rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(p.name)}</div>
                <div style="font-size:0.72rem;color:#64748b;">${escHtml(p.brand_name||'')}&nbsp;·&nbsp;${escHtml(p.category_name||'')}</div>
                <div style="display:flex;gap:5px;margin-top:4px;align-items:center;flex-wrap:wrap;">
                    <span style="font-weight:700;color:#16a34a;font-size:0.82rem;">₹${parseFloat(p.base_price).toFixed(0)}</span>
                    <span style="background:${p.status==='active'?'#d1fae5':'#f1f5f9'};color:${p.status==='active'?'#065f46':'#64748b'};border-radius:4px;padding:1px 6px;font-size:0.68rem;">${p.status==='active'?'● Active':'○ Inactive'}</span>
                    <span style="background:${p.product_type==='area_wise'?'#e0f2fe':'#fef3c7'};color:${p.product_type==='area_wise'?'#0369a1':'#92400e'};border-radius:4px;padding:1px 6px;font-size:0.68rem;">${p.product_type==='area_wise'?'Area':'Unit'}</span>
                </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:5px;flex-shrink:0;" onclick="event.stopPropagation()">
                <button onclick="editProduct(${p.id})" style="background:#eff6ff;border:none;border-radius:6px;padding:5px 10px;font-size:0.72rem;color:#1d4ed8;font-weight:600;">Edit</button>
                <button onclick="deleteProduct(${p.id})" style="background:#fef2f2;border:none;border-radius:6px;padding:5px 10px;font-size:0.72rem;color:#dc2626;font-weight:600;">Del</button>
            </div>
        </div>
    `).join('') + `<div style="text-align:center;color:#94a3b8;font-size:0.75rem;padding:8px;">Showing ${filtered.length} of ${products.length}</div>`;
}
```

- [ ] **Step 6: Add filter drawer JS functions**

In the JS section, add:
```javascript
function openFilterDrawer() {
    // Sync mobile selects with desktop selects
    const bd = document.getElementById('filterBrandMobile');
    const cd = document.getElementById('filterCategoryMobile');
    if (bd) bd.innerHTML = document.getElementById('filterBrand').innerHTML;
    if (cd) cd.innerHTML = document.getElementById('filterCategory').innerHTML;
    if (bd) bd.value = document.getElementById('filterBrand').value;
    if (cd) cd.value = document.getElementById('filterCategory').value;
    document.getElementById('filterDrawer')?.classList.add('open');
    document.getElementById('filterDrawerOverlay')?.classList.add('open');
}
function closeFilterDrawer() {
    document.getElementById('filterDrawer')?.classList.remove('open');
    document.getElementById('filterDrawerOverlay')?.classList.remove('open');
    updateMobileFilterChips();
}
function setMobileFilter(desktopId, value) {
    document.getElementById(desktopId).value = value;
    renderProducts();
}
function updateMobileFilterChips() {
    const chips = document.getElementById('mobileActiveChips');
    if (!chips) return;
    const active = [];
    const brand = document.getElementById('filterBrand')?.value;
    const cat = document.getElementById('filterCategory')?.value;
    const status = document.getElementById('filterStatus')?.value;
    const type = document.getElementById('filterType')?.value;
    if (brand) active.push({ label: brand, clear: () => { document.getElementById('filterBrand').value=''; renderProducts(); updateMobileFilterChips(); } });
    if (cat) active.push({ label: cat, clear: () => { document.getElementById('filterCategory').value=''; renderProducts(); updateMobileFilterChips(); } });
    if (status) active.push({ label: status, clear: () => { document.getElementById('filterStatus').value=''; renderProducts(); updateMobileFilterChips(); } });
    if (type) active.push({ label: type==='area_wise'?'Area':'Unit', clear: () => { document.getElementById('filterType').value=''; renderProducts(); updateMobileFilterChips(); } });
    chips.innerHTML = active.map((a,i) => `<span style="background:#d1fae5;color:#065f46;border-radius:99px;padding:3px 10px;font-size:0.72rem;cursor:pointer;" onclick="chipClear(${i})">${escH(a.label)} ×</span>`).join('');
    chips._clearFns = active.map(a => a.clear);
}
function chipClear(i) {
    const chips = document.getElementById('mobileActiveChips');
    if (chips._clearFns?.[i]) chips._clearFns[i]();
}
```

- [ ] **Step 7: Test mobile layout**

Open `http://localhost:3000/admin-products.html` in browser. Open DevTools → Toggle Device Toolbar (Ctrl+Shift+M) → set width to 375px.
Expected:
- Desktop table is hidden
- Product cards are visible, scrollable
- "Filter ▾" button opens the bottom drawer
- Active filters show as chips below search
- Edit/Del buttons work on cards

- [ ] **Step 8: Commit**

```bash
git add public/admin-products.html
git commit -m "feat(products): mobile-responsive products tab — cards + filter drawer"
```

---

### Task 5: Frontend — mobile-responsive Zoho Import tab

**Files:**
- Modify: `public/admin-products.html` — Zoho import tab section + renderZohoItems/renderZohoGroups

- [ ] **Step 1: Add mobile toolbar to Zoho Import tab**

Find the existing Zoho Import toolbar (`<div class="flex items-center justify-between mb-3">`). Add `class="zoho-desktop-toolbar"` to it, then insert a mobile toolbar after it:

```html
<div class="zoho-mobile-toolbar items-center gap-2 mb-3" style="flex-wrap:wrap;">
    <div style="display:flex;gap:8px;flex:1;">
        <input type="text" id="zohoSearchMobile" placeholder="🔍 Search…"
            style="flex:1;border:1px solid #e2e8f0;border-radius:10px;padding:8px 12px;font-size:0.85rem;"
            oninput="document.getElementById('zohoSearchInput').value=this.value;debounceZohoSearch();">
        <button onclick="openZohoFilterDrawer()" style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:10px;padding:8px 14px;font-size:0.85rem;white-space:nowrap;">Filter ▾</button>
        <button onclick="syncZohoItems()" style="background:#10b981;color:#fff;border:none;border-radius:10px;padding:8px 14px;font-size:0.85rem;font-weight:600;">⟳</button>
    </div>
</div>
```

- [ ] **Step 2: Wrap Zoho table and add mobile list container**

Find `<div class="bg-white rounded-xl shadow-sm overflow-hidden">` that wraps the Zoho items table. Add class `zoho-table-wrap` to it. After its closing `</div>`, add:

```html
<div class="zoho-mobile-list" id="zohoMobileList"></div>
```

- [ ] **Step 3: Add Zoho filter drawer HTML**

After the products filter drawer added in Task 4, add:
```html
<!-- Mobile Zoho Filter Drawer -->
<div class="filter-drawer-overlay" id="zohoFilterDrawerOverlay" onclick="closeZohoFilterDrawer()"></div>
<div class="filter-drawer" id="zohoFilterDrawer">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <span style="font-weight:700;font-size:1rem;">Filter Zoho Items</span>
        <button onclick="closeZohoFilterDrawer()" style="background:none;border:none;color:#64748b;font-size:0.85rem;cursor:pointer;">Close</button>
    </div>
    <div style="margin-bottom:12px;">
        <div style="font-size:0.72rem;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:5px;">Brand</div>
        <select id="zohoFilterBrandMobile" onchange="document.getElementById('zohoFilterBrand').value=this.value;zohoCurrentPage=1;loadZohoItems();" style="width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;font-size:0.85rem;"><option value="">All Brands</option></select>
    </div>
    <div style="margin-bottom:12px;">
        <div style="font-size:0.72rem;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:5px;">Category</div>
        <select id="zohoFilterCategoryMobile" onchange="document.getElementById('zohoFilterCategory').value=this.value;zohoCurrentPage=1;loadZohoItems();" style="width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px;font-size:0.85rem;"><option value="">All Categories</option></select>
    </div>
    <div style="margin-bottom:20px;">
        <div style="font-size:0.72rem;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:5px;">Mapped Status</div>
        <div style="display:flex;gap:6px;">
            <button onclick="setZohoMobileFilter('')" style="flex:1;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:8px;font-size:0.8rem;cursor:pointer;">All</button>
            <button onclick="setZohoMobileFilter('unmapped')" style="flex:1;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:8px;font-size:0.8rem;cursor:pointer;color:#92400e;">Unmapped</button>
            <button onclick="setZohoMobileFilter('mapped')" style="flex:1;background:#f0fdf4;border:1px solid #d1fae5;border-radius:8px;padding:8px;font-size:0.8rem;cursor:pointer;color:#065f46;">Mapped</button>
        </div>
    </div>
    <button onclick="closeZohoFilterDrawer()" style="width:100%;background:#1B5E3B;color:#fff;border:none;border-radius:10px;padding:12px;font-size:0.9rem;font-weight:600;cursor:pointer;">Apply</button>
</div>
```

- [ ] **Step 4: Add Zoho filter drawer JS functions**

```javascript
function openZohoFilterDrawer() {
    const bd = document.getElementById('zohoFilterBrandMobile');
    const cd = document.getElementById('zohoFilterCategoryMobile');
    if (bd) bd.innerHTML = document.getElementById('zohoFilterBrand').innerHTML;
    if (cd) cd.innerHTML = document.getElementById('zohoFilterCategory').innerHTML;
    if (bd) bd.value = document.getElementById('zohoFilterBrand').value;
    if (cd) cd.value = document.getElementById('zohoFilterCategory').value;
    document.getElementById('zohoFilterDrawer')?.classList.add('open');
    document.getElementById('zohoFilterDrawerOverlay')?.classList.add('open');
}
function closeZohoFilterDrawer() {
    document.getElementById('zohoFilterDrawer')?.classList.remove('open');
    document.getElementById('zohoFilterDrawerOverlay')?.classList.remove('open');
}
function setZohoMobileFilter(value) {
    document.getElementById('zohoFilterMapped').value = value;
    zohoCurrentPage = 1;
    loadZohoItems();
}
```

- [ ] **Step 5: Add mobile render path to the grouped/flat view JS**

Find where `document.getElementById('zohoItemsBody').innerHTML = groups.map(...)` is called (grouped view, ~line 1295). After that assignment, add:

```javascript
// Mobile grouped render
if (window.innerWidth < 768) {
    const ml = document.getElementById('zohoMobileList');
    if (ml) ml.innerHTML = groups.map((g, gi) => {
        const itemIds = g.items.map(i => i.zoho_item_id || i.item_id);
        const mappedProduct = g.allMapped ? zohoMappedInfo[itemIds[0]] : null;
        const unmappedCount = itemIds.filter(id => !zohoMappedIds.has(id)).length;
        return `
        <div style="border:1px solid ${g.allMapped?'#d1fae5':'#fde68a'};border-radius:12px;margin-bottom:8px;overflow:hidden;">
            <div style="background:${g.allMapped?'#f0fdf4':'#fffbeb'};padding:10px 12px;display:flex;align-items:center;gap:8px;" onclick="toggleMobileGroup(${gi})">
                ${g.allMapped
                    ? `<span style="background:#d1fae5;color:#065f46;border-radius:4px;padding:2px 7px;font-size:0.68rem;font-weight:600;">All mapped ✓</span>`
                    : `<input type="checkbox" onclick="event.stopPropagation()" onchange="toggleZohoGroupSelect([${itemIds.map(id=>"'"+id+"'").join(',')}],this.checked)" style="width:15px;height:15px;flex-shrink:0;">`
                }
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:700;font-size:0.85rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escH(g.name)}</div>
                    <div style="font-size:0.68rem;color:${g.allMapped?'#065f46':'#92400e'};">${g.allMapped?'Fully mapped · '+g.items.length+' variants':unmappedCount+' unmapped · '+g.brand}</div>
                </div>
                ${g.allMapped
                    ? `<button onclick="event.stopPropagation();switchToProductsAndEdit(${mappedProduct?.product_id})" style="background:#fff;border:1px solid #e2e8f0;border-radius:6px;padding:4px 8px;font-size:0.7rem;color:#374151;flex-shrink:0;">Edit</button>`
                    : `<button data-assign-btn onclick="event.stopPropagation();openGroupAssignDropdown(${JSON.stringify(g.items).replace(/"/g,'&quot;')},this)" style="background:#e0f2fe;border:none;border-radius:6px;padding:4px 8px;font-size:0.7rem;color:#0369a1;flex-shrink:0;font-weight:600;">Assign ▾</button>
                       <button onclick="event.stopPropagation();selectAndImportGroup([${itemIds.map(id=>"'"+id+"'").join(',')}])" style="background:#10b981;color:#fff;border:none;border-radius:6px;padding:4px 8px;font-size:0.7rem;flex-shrink:0;font-weight:600;">New</button>`
                }
                <span style="color:#94a3b8;font-size:0.8rem;flex-shrink:0;" id="mgroup-chevron-${gi}">▼</span>
            </div>
            <div id="mgroup-body-${gi}" style="display:none;background:#fafaf9;padding:6px 10px;border-top:1px solid ${g.allMapped?'#d1fae5':'#fde68a'};">
                ${g.items.map(item => {
                    const iid = item.zoho_item_id || item.item_id;
                    const mapped = zohoMappedIds.has(iid);
                    return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f1f5f4;">
                        <input type="checkbox" ${mapped?'disabled':''} ${zohoSelectedIds.has(iid)?'checked':''} onchange="toggleZohoItemSelect('${iid}',this.checked)" style="width:13px;height:13px;">
                        <span style="flex:1;font-size:0.78rem;">${escH(item._sizeLabel||item.name||'')}</span>
                        <span style="color:#16a34a;font-weight:600;font-size:0.78rem;">₹${parseFloat(item.rate||0).toFixed(0)}</span>
                        <span style="background:${mapped?'#d1fae5':'#fef3c7'};color:${mapped?'#065f46':'#92400e'};border-radius:3px;padding:1px 5px;font-size:0.65rem;">${mapped?'Mapped':'Unmapped'}</span>
                    </div>`;
                }).join('')}
            </div>
        </div>`;
    }).join('') + `<div style="text-align:center;color:#94a3b8;font-size:0.72rem;padding:8px;">Showing ${groups.length} group(s)</div>`;
}
```

Also find the flat view `document.getElementById('zohoItemsBody').innerHTML = items.map(...)` assignment and add after it:

```javascript
// Mobile flat render
if (window.innerWidth < 768) {
    const ml = document.getElementById('zohoMobileList');
    if (ml) ml.innerHTML = items.map(item => {
        const itemId = item.zoho_item_id || item.item_id;
        const isMapped = zohoMappedIds.has(itemId);
        return `<div style="background:#fff;border:1px solid ${isMapped?'#d1fae5':'#fde68a'};border-radius:10px;padding:10px 12px;margin-bottom:7px;display:flex;align-items:center;gap:8px;">
            <input type="checkbox" ${isMapped?'disabled':''} ${zohoSelectedIds.has(itemId)?'checked':''} onchange="toggleZohoItemSelect('${itemId}',this.checked)" style="width:15px;height:15px;flex-shrink:0;">
            <div style="flex:1;min-width:0;">
                <div style="font-weight:600;font-size:0.82rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escH(item.name||item.item_name||'')}</div>
                <div style="font-size:0.7rem;color:#64748b;">${escH(item.brand||'')} · ₹${parseFloat(item.rate||0).toFixed(0)}</div>
            </div>
            <span style="background:${isMapped?'#d1fae5':'#fef3c7'};color:${isMapped?'#065f46':'#92400e'};border-radius:4px;padding:2px 7px;font-size:0.7rem;flex-shrink:0;">${isMapped?'Mapped':'Unmapped'}</span>
            ${!isMapped?`<button data-assign-btn onclick="openAssignDropdown('${itemId}','${escH(extractSizeFromName(item.name||''))}','${escH(extractUnitFromName(item.name||''))}',${parseFloat(item.rate)||0},this)" style="background:#e0f2fe;border:none;border-radius:6px;padding:4px 8px;font-size:0.7rem;color:#0369a1;flex-shrink:0;">Assign ▾</button>`:''}
        </div>`;
    }).join('');
}
```

- [ ] **Step 6: Add toggleMobileGroup and selectAndImportGroup helpers**

```javascript
function toggleMobileGroup(gi) {
    const body = document.getElementById('mgroup-body-' + gi);
    const chev = document.getElementById('mgroup-chevron-' + gi);
    if (!body) return;
    const open = body.style.display !== 'none';
    body.style.display = open ? 'none' : 'block';
    if (chev) chev.textContent = open ? '▼' : '▲';
}
function selectAndImportGroup(itemIds) {
    itemIds.forEach(id => zohoSelectedIds.add(id));
    updateZohoImportBar();
    importZohoToProducts();
}
```

- [ ] **Step 7: Test mobile Zoho Import layout**

Open `http://localhost:3000/admin-products.html?tab=zoho-import` in DevTools at 375px width.
Expected:
- Desktop table hidden
- Accordion group cards visible — unmapped yellow-bordered, mapped green-bordered
- Tap group header → variants expand
- "Assign ▾" button opens search dropdown
- "New" button triggers import flow
- "Filter ▾" opens filter drawer

- [ ] **Step 8: Commit**

```bash
git add public/admin-products.html
git commit -m "feat(products): mobile-responsive zoho import tab — accordion groups + filter drawer"
```

---

### Task 6: Deploy and verify

**Files:** None — deploy only

- [ ] **Step 1: Deploy to production**

```bash
ssh hetzner "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && pm2 restart business-manager"
```

- [ ] **Step 2: Verify on production mobile**

Open `https://act.qcpaintshop.com/admin-products.html` on a real mobile browser or DevTools emulation:
- Products tab: cards visible, filter drawer works
- Zoho Import tab: accordion groups visible, Assign ▾ works end-to-end

- [ ] **Step 3: Final commit if any hotfixes needed**

```bash
git add public/admin-products.html server.js
git commit -m "fix(products): post-deploy mobile UX hotfixes"
```
