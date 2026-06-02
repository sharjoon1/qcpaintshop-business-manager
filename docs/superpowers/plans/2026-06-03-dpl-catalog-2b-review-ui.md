# DPL Catalog — Sub-Plan 2b: Catalog Review UI

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Add a "Catalog" review UI to `public/admin-dpl.html`: Build the brand catalog, show a product-grouped review table (DPL data, canonical SKU, linked Zoho item + confidence + reason), and let the admin confirm or re-pick each link via a Zoho search modal — calling the sub-plan-2a endpoints.

**Architecture:** A new `#catalogPanel` + picker modal, plus self-contained JS that calls `POST .../dpl-catalog/:brand/build`, `GET .../dpl-catalog/:brand`, `POST .../dpl-catalog/entry/:id/confirm-link`, and reuses `GET /api/zoho/items?search=` for re-pick. Uses the page's existing `getToken()`, `showToast()`, `esc()`, `currentBrandDpl`, `DEFAULT_BRAND`.

**Tech Stack:** Vanilla browser JS in `admin-dpl.html` (inline `<script>`). Verify via inline-script parse (no jest for HTML).

---

## Task 1: Build Catalog button + Catalog panel + picker + JS

**Files:** Modify `public/admin-dpl.html`.

- [ ] **Step 1: Add the "Build Catalog" button**

In `public/admin-dpl.html`, find the "Update DPL" button line:
```html
                            <button onclick="startUpdateDpl()" id="updateDplBtn" class="px-4 py-2 border border-emerald-300 bg-white hover:bg-emerald-50 text-emerald-700 rounded-lg text-xs font-bold transition">📝 Update DPL</button>
```
Add immediately AFTER it (still inside the same button row):
```html
                            <button onclick="buildCatalog()" id="buildCatalogBtn" class="px-4 py-2 border border-indigo-300 bg-white hover:bg-indigo-50 text-indigo-700 rounded-lg text-xs font-bold transition flex items-center gap-2 disabled:opacity-50">
                                <svg id="buildCatalogSpinner" class="hidden w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                🗂️ Build Catalog
                            </button>
```

- [ ] **Step 2: Add the Catalog panel + picker modal**

Find the closing of the `brandDplPanel` div (the `</div>` on its own line immediately BEFORE the `<!-- Auto-Propose (No PDF) — Step 0 / alternate path -->` comment). Insert this block immediately AFTER that `</div>` and BEFORE the Auto-Propose comment:
```html

            <!-- DPL Catalog review panel -->
            <div id="catalogPanel" class="mt-4 border-t pt-4 hidden">
                <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <div class="flex flex-wrap gap-2 text-[11px]">
                        <span class="px-2 py-1 rounded bg-gray-100 text-gray-700">Total: <b id="catTotal">0</b></span>
                        <span class="px-2 py-1 rounded bg-green-100 text-green-700">✅ Confirmed: <b id="catConfirmed">0</b></span>
                        <span class="px-2 py-1 rounded bg-amber-100 text-amber-700">⚠ Review: <b id="catReview">0</b></span>
                        <span class="px-2 py-1 rounded bg-rose-100 text-rose-700">🆕 Needs creating: <b id="catNeeds">0</b></span>
                    </div>
                    <div class="flex gap-1">
                        <button onclick="setCatalogFilter('all')" id="catFilterAll" class="cat-filter px-2 py-1 rounded text-[11px] font-semibold bg-indigo-600 text-white">All</button>
                        <button onclick="setCatalogFilter('review')" id="catFilterReview" class="cat-filter px-2 py-1 rounded text-[11px] font-semibold bg-gray-100 text-gray-600">Review</button>
                        <button onclick="setCatalogFilter('needs_creating')" id="catFilterNeeds" class="cat-filter px-2 py-1 rounded text-[11px] font-semibold bg-gray-100 text-gray-600">Needs creating</button>
                        <button onclick="setCatalogFilter('confirmed')" id="catFilterConfirmed" class="cat-filter px-2 py-1 rounded text-[11px] font-semibold bg-gray-100 text-gray-600">Confirmed</button>
                    </div>
                </div>
                <div class="overflow-x-auto border rounded-lg">
                    <table class="w-full text-[11px]">
                        <thead class="bg-gray-50 text-gray-500">
                            <tr>
                                <th class="px-2 py-2 text-left">Product / Base</th>
                                <th class="px-2 py-2 text-left">Size</th>
                                <th class="px-2 py-2 text-right">DPL</th>
                                <th class="px-2 py-2 text-left">Canonical SKU</th>
                                <th class="px-2 py-2 text-left">Linked Zoho item</th>
                                <th class="px-2 py-2 text-center">Status</th>
                                <th class="px-2 py-2 text-center">Action</th>
                            </tr>
                        </thead>
                        <tbody id="catalogTableBody"></tbody>
                    </table>
                </div>
                <div id="catalogEmpty" class="hidden text-center text-gray-400 text-xs py-8">No catalog entries for this filter.</div>
            </div>

            <!-- Zoho item picker for catalog re-link -->
            <div id="catPickerModal" class="fixed inset-0 bg-black/40 items-center justify-center z-50" style="display:none">
                <div class="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
                    <div class="p-3 border-b flex items-center justify-between">
                        <div class="font-bold text-sm" id="catPickerTitle">Pick a Zoho item</div>
                        <button onclick="closeCatPicker()" class="text-gray-400 hover:text-gray-700 text-xl leading-none">&times;</button>
                    </div>
                    <div class="p-3">
                        <input type="text" id="catPickerSearch" oninput="catPickerSearchDebounced()" placeholder="Search name / SKU..." class="w-full px-3 py-2 border rounded text-xs outline-none focus:border-indigo-500">
                    </div>
                    <div id="catPickerResults" class="flex-1 overflow-y-auto px-3 pb-3 space-y-1"></div>
                </div>
            </div>
```

- [ ] **Step 3: Add the JS**

In `public/admin-dpl.html`, immediately AFTER the `matchSavedDpl` function's closing `}` (the function `async function matchSavedDpl() { ... }`), insert:
```javascript

    // ── DPL Catalog review ───────────────────────────────────────
    var catalogEntries = [];
    var catalogFilter = 'all';
    var catPickerEntryId = null;
    var catPickerTimer = null;
    var catZohoNameCache = {};

    async function buildCatalog() {
        var brand = currentBrandDpl || DEFAULT_BRAND;
        var btn = document.getElementById('buildCatalogBtn');
        var sp = document.getElementById('buildCatalogSpinner');
        btn.disabled = true; sp.classList.remove('hidden');
        try {
            var resp = await fetch('/api/zoho/items/dpl-catalog/' + encodeURIComponent(brand) + '/build', {
                method: 'POST', headers: { 'Authorization': 'Bearer ' + getToken() }
            });
            var body = await resp.json();
            if (!resp.ok || !body.success) throw new Error(body.message || ('Server error ' + resp.status));
            var s = body.data;
            showToast('Catalog built: ' + s.confirmed + ' confirmed, ' + s.review + ' review, ' + s.needs_creating + ' need creating', 'success');
            await loadCatalog();
        } catch (err) {
            showToast('Build error: ' + err.message, 'error');
        } finally {
            btn.disabled = false; sp.classList.add('hidden');
        }
    }

    async function loadCatalog() {
        var brand = currentBrandDpl || DEFAULT_BRAND;
        try {
            var resp = await fetch('/api/zoho/items/dpl-catalog/' + encodeURIComponent(brand), {
                headers: { 'Authorization': 'Bearer ' + getToken() }
            });
            var body = await resp.json();
            if (!resp.ok || !body.success) throw new Error(body.message || ('Server error ' + resp.status));
            catalogEntries = body.data || [];
            document.getElementById('catalogPanel').classList.remove('hidden');
            renderCatalog();
        } catch (err) {
            showToast('Load catalog error: ' + err.message, 'error');
        }
    }

    function setCatalogFilter(f) {
        catalogFilter = f;
        document.querySelectorAll('.cat-filter').forEach(function(b){ b.className = 'cat-filter px-2 py-1 rounded text-[11px] font-semibold bg-gray-100 text-gray-600'; });
        var map = { all: 'catFilterAll', review: 'catFilterReview', needs_creating: 'catFilterNeeds', confirmed: 'catFilterConfirmed' };
        var active = document.getElementById(map[f]);
        if (active) active.className = 'cat-filter px-2 py-1 rounded text-[11px] font-semibold bg-indigo-600 text-white';
        renderCatalog();
    }

    function zohoNameFor(zid, e) {
        if (catZohoNameCache[zid]) return catZohoNameCache[zid];
        return e.canonical_name || zid;
    }

    function renderCatalog() {
        var tbody = document.getElementById('catalogTableBody');
        var counts = { confirmed: 0, review: 0, needs_creating: 0 };
        catalogEntries.forEach(function(e){ counts[e.link_status] = (counts[e.link_status] || 0) + 1; });
        document.getElementById('catTotal').textContent = catalogEntries.length;
        document.getElementById('catConfirmed').textContent = counts.confirmed;
        document.getElementById('catReview').textContent = counts.review;
        document.getElementById('catNeeds').textContent = counts.needs_creating;

        var rows = catalogEntries.filter(function(e){ return catalogFilter === 'all' || e.link_status === catalogFilter; });
        if (!rows.length) { tbody.innerHTML = ''; document.getElementById('catalogEmpty').classList.remove('hidden'); return; }
        document.getElementById('catalogEmpty').classList.add('hidden');

        tbody.innerHTML = rows.map(function(e){
            var statusBadge = e.link_status === 'confirmed'
                ? '<span class="px-1.5 py-0.5 rounded bg-green-100 text-green-700">✅ ' + (e.link_confidence || '') + '</span>'
                : e.link_status === 'review'
                ? '<span class="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700" title="' + esc(e.link_reason || '') + '">⚠ ' + (e.link_confidence || '') + '</span>'
                : '<span class="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">🆕</span>';
            var linked = e.zoho_item_id
                ? esc(zohoNameFor(e.zoho_item_id, e))
                : '<span class="text-gray-400">— not linked —</span>';
            var action = '';
            if (e.link_status !== 'confirmed') {
                if (e.zoho_item_id) action += '<button onclick="confirmCatalogEntry(' + e.id + ', \'' + esc(String(e.zoho_item_id)) + '\')" class="px-2 py-1 rounded bg-green-600 text-white text-[10px] font-bold mr-1">✓ Confirm</button>';
                action += '<button onclick="openCatPicker(' + e.id + ')" class="px-2 py-1 rounded border border-indigo-300 text-indigo-700 text-[10px] font-bold">🔄 Pick</button>';
            } else {
                action += '<button onclick="openCatPicker(' + e.id + ')" class="px-2 py-1 rounded border text-gray-500 text-[10px]">change</button>';
            }
            return '<tr class="border-t">' +
                '<td class="px-2 py-1.5"><div class="font-semibold text-gray-800">' + esc(e.product_name || '') + '</div><div class="text-gray-500">' + esc(e.base_name || '') + '</div></td>' +
                '<td class="px-2 py-1.5">' + esc(e.size_tier || '') + (e.dpl_size_label && e.dpl_size_label !== e.size_tier ? ' <span class="text-gray-400">(' + esc(e.dpl_size_label) + ')</span>' : '') + '</td>' +
                '<td class="px-2 py-1.5 text-right">' + (e.current_dpl != null ? '₹' + e.current_dpl : '-') + '</td>' +
                '<td class="px-2 py-1.5 font-mono">' + esc(e.canonical_sku || '-') + '</td>' +
                '<td class="px-2 py-1.5">' + linked + '</td>' +
                '<td class="px-2 py-1.5 text-center">' + statusBadge + '</td>' +
                '<td class="px-2 py-1.5 text-center whitespace-nowrap">' + action + '</td>' +
                '</tr>';
        }).join('');
    }

    async function confirmCatalogEntry(id, zohoItemId) {
        try {
            var resp = await fetch('/api/zoho/items/dpl-catalog/entry/' + id + '/confirm-link', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ zoho_item_id: zohoItemId })
            });
            var body = await resp.json();
            if (!resp.ok || !body.success) throw new Error(body.message || 'Confirm failed');
            var e = catalogEntries.find(function(x){ return x.id === id; });
            if (e) { e.zoho_item_id = zohoItemId; e.link_status = 'confirmed'; e.link_confidence = 100; e.link_reason = 'user-confirmed'; }
            showToast('Link confirmed', 'success');
            renderCatalog();
        } catch (err) { showToast('Confirm error: ' + err.message, 'error'); }
    }

    function openCatPicker(entryId) {
        catPickerEntryId = entryId;
        var e = catalogEntries.find(function(x){ return x.id === entryId; });
        document.getElementById('catPickerTitle').textContent = 'Pick Zoho item for: ' + (e ? (e.product_name + ' ' + e.base_name + ' ' + e.size_tier) : '');
        document.getElementById('catPickerSearch').value = e ? (e.product_name || '') : '';
        document.getElementById('catPickerModal').style.display = 'flex';
        catPickerSearch();
    }
    function closeCatPicker() { document.getElementById('catPickerModal').style.display = 'none'; catPickerEntryId = null; }
    function catPickerSearchDebounced() { clearTimeout(catPickerTimer); catPickerTimer = setTimeout(catPickerSearch, 300); }
    async function catPickerSearch() {
        var q = document.getElementById('catPickerSearch').value.trim();
        var resultsEl = document.getElementById('catPickerResults');
        resultsEl.innerHTML = '<div class="text-gray-400 text-xs py-3 text-center">Searching...</div>';
        try {
            var resp = await fetch('/api/zoho/items?limit=40&search=' + encodeURIComponent(q), { headers: { 'Authorization': 'Bearer ' + getToken() } });
            var body = await resp.json();
            var items = (body && Array.isArray(body.data)) ? body.data : [];
            if (!items.length) { resultsEl.innerHTML = '<div class="text-gray-400 text-xs py-3 text-center">No items found</div>'; return; }
            resultsEl.innerHTML = items.map(function(it){
                var zid = it.zoho_item_id; var nm = it.zoho_item_name || it.name || ''; var sku = it.zoho_sku || it.sku || '';
                catZohoNameCache[zid] = nm;
                return '<button onclick="pickCatZoho(\'' + esc(String(zid)) + '\')" class="w-full text-left px-2 py-1.5 rounded hover:bg-indigo-50 border border-gray-100 text-[11px]"><div class="font-semibold text-gray-800">' + esc(nm) + '</div><div class="text-gray-400 font-mono">' + esc(sku) + '</div></button>';
            }).join('');
        } catch (err) { resultsEl.innerHTML = '<div class="text-rose-500 text-xs py-3 text-center">' + esc(err.message) + '</div>'; }
    }
    function pickCatZoho(zohoItemId) {
        var id = catPickerEntryId;
        closeCatPicker();
        if (id != null) confirmCatalogEntry(id, zohoItemId);
    }
```

- [ ] **Step 4: Verify the inline script parses**

Run:
```bash
node -e 'const fs=require("fs");const h=fs.readFileSync("public/admin-dpl.html","utf8");const re=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;let m,i=0;while((m=re.exec(h))){i++;try{new Function(m[1])}catch(e){console.log("script#"+i+" ERROR: "+e.message)}}console.log(i+" inline scripts checked");'
```
Expected: prints `N inline scripts checked`, NO `ERROR` lines.

- [ ] **Step 5: Commit**

```bash
git add public/admin-dpl.html
git commit -m "feat(dpl-catalog): Catalog review UI (build, grouped table, confirm/re-pick)"
```

---

## Notes
- The catalog GET doesn't return the linked Zoho item's name; the UI falls back to `canonical_name` (present for confirmed/linked entries) and caches names from the picker search.
- No risky bulk-confirm — each review/needs_creating entry is confirmed/re-picked individually (the user's safety net). Confirmed (sku-reconstruct) entries are already correct from the build.
- Before this is usable on prod: deploy + apply `migrations/migrate-dpl-catalog.js`.
- Sub-plan 3 (apply-prices + push) is next.
