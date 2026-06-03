# DPL Catalog Review Panel — UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the DPL Catalog review panel usable — add client-side search, a "Pushable" filter, a result count + discovery hint, and a mobile card layout — so the ~214 selectable rows among ~1329 are one tap away on any screen.

**Architecture:** Pure frontend changes in `public/admin-dpl.html`. A single shared predicate `isPushable(e)` and a `visibleCatalogRows()` pipeline (status/pushable filter + text search) feed `renderCatalog()`, which writes BOTH a desktop `<table>` (`hidden sm:block`) and a mobile `#catalogCards` list (`sm:hidden`). Selection is driven from the data model (`catPushSelected`), never DOM `:checked`, so the dual-DOM (each pushable row's checkbox exists in both layouts) stays consistent. No backend/API/DB changes.

**Tech Stack:** Vanilla JS + Tailwind utility classes, inline in `admin-dpl.html`. No build step, no module system, no automated UI test harness — verification is by reading + browser smoke (desktop and mobile widths).

**Spec:** `docs/superpowers/specs/2026-06-03-dpl-catalog-review-ux-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `public/admin-dpl.html` (catalog JS, ~lines 1236-1429) | shared `isPushable`/`visibleCatalogRows` pipeline; data-driven selection; dual (table+card) render | Modify |
| `public/admin-dpl.html` (`#catalogPanel` markup, ~lines 320-360) | search input, Pushable filter, "Showing X of Y", hint, table wrap, `#catalogCards`, empty text | Modify |
| `public/admin-dpl.html` (`<head>`) | no-cache meta tags | Modify |

**Reused unchanged:** `loadCatalog`, `applyCatalogPrices`, `pushCatalogToZoho`, `confirmCatalogEntry`, `openCatPicker` + picker modal, `catPushSelected`, `catZohoNameCache`, `zohoNameFor`, the push/apply endpoints.

**Task order:** JS first (Task 1) — its `renderCatalog` guards every NEW DOM id with `if (el)`, so the page keeps working (desktop table + selection) before the markup exists. Markup second (Task 2) lights up search/cards/hint. Each commit leaves a working page.

---

## Task 1: JS — shared pipeline + data-driven selection + dual render

**File:** `public/admin-dpl.html` (the `// ── DPL Catalog review ──` script block).

- [ ] **Step 1: Add search state next to the existing catalog state**

Find:
```javascript
    var catPushSelected = {}; // { entryId: true }
```
Replace with:
```javascript
    var catPushSelected = {}; // { entryId: true }
    var catalogSearch = '';
    var catalogSearchTimer = null;

    // Single source of truth for "can this row be pushed to Zoho?"
    function isPushable(e) {
        return e.link_status === 'confirmed' && e.zoho_item_id && e.current_dpl != null && Number(e.current_dpl) > 0;
    }

    // Rows visible after the active status/pushable filter AND the text search.
    function visibleCatalogRows() {
        var q = catalogSearch.trim().toLowerCase();
        return catalogEntries.filter(function(e){
            if (catalogFilter === 'pushable') { if (!isPushable(e)) return false; }
            else if (catalogFilter !== 'all' && e.link_status !== catalogFilter) return false;
            if (q) {
                var hay = ((e.product_name || '') + ' ' + (e.base_name || '') + ' ' +
                           (e.canonical_sku || '') + ' ' + zohoNameFor(e.zoho_item_id, e)).toLowerCase();
                if (hay.indexOf(q) === -1) return false;
            }
            return true;
        });
    }

    function setCatalogSearch(v) {
        catalogSearch = v || '';
        clearTimeout(catalogSearchTimer);
        catalogSearchTimer = setTimeout(renderCatalog, 200);
    }

    // Mirror a selection change to every DOM copy of that row's checkbox
    // (a pushable row's checkbox exists in BOTH the table and the card list).
    function setRowCheckedDom(id, checked) {
        document.querySelectorAll('.cat-push-check[data-id="' + id + '"]').forEach(function(cb){ cb.checked = checked; });
    }
```

- [ ] **Step 2: Make selection helpers data-driven + dual-DOM safe**

Find the block (the four functions `refreshPushButton`, `onCatCheck`, `toggleHeadCheck`, `toggleSelectAllConfirmed`):
```javascript
    function refreshPushButton() {
        var ids = Object.keys(catPushSelected).filter(function(k){ return catPushSelected[k]; });
        var countEl = document.getElementById('pushCount');
        var btn = document.getElementById('pushZohoBtn');
        if (countEl) countEl.textContent = ids.length;
        if (btn) btn.disabled = ids.length === 0;
        var hd = document.getElementById('catHeadCheck');
        if (hd) {
            var visible = document.querySelectorAll('.cat-push-check');
            var checkedBoxes = document.querySelectorAll('.cat-push-check:checked');
            hd.checked = visible.length > 0 && checkedBoxes.length === visible.length;
            hd.indeterminate = checkedBoxes.length > 0 && checkedBoxes.length < visible.length;
        }
    }
    function onCatCheck(id, checked) {
        if (checked) catPushSelected[id] = true; else delete catPushSelected[id];
        refreshPushButton();
    }
    function toggleHeadCheck(el) {
        document.querySelectorAll('.cat-push-check').forEach(function(cb){
            cb.checked = el.checked;
            onCatCheck(parseInt(cb.getAttribute('data-id'), 10), el.checked);
        });
    }
    function toggleSelectAllConfirmed() {
        var anyUnselected = catalogEntries.some(function(e){
            return e.link_status === 'confirmed' && e.zoho_item_id && e.current_dpl != null && Number(e.current_dpl) > 0 && !catPushSelected[e.id];
        });
        catalogEntries.forEach(function(e){
            if (e.link_status === 'confirmed' && e.zoho_item_id && e.current_dpl != null && Number(e.current_dpl) > 0) {
                if (anyUnselected) catPushSelected[e.id] = true; else delete catPushSelected[e.id];
            }
        });
        renderCatalog();
        refreshPushButton();
    }
```
Replace with:
```javascript
    function refreshPushButton() {
        var selectedIds = Object.keys(catPushSelected).filter(function(k){ return catPushSelected[k]; });
        var countEl = document.getElementById('pushCount');
        var btn = document.getElementById('pushZohoBtn');
        if (countEl) countEl.textContent = selectedIds.length;
        if (btn) btn.disabled = selectedIds.length === 0;
        var hd = document.getElementById('catHeadCheck');
        if (hd) {
            var visPush = visibleCatalogRows().filter(isPushable);
            var sel = visPush.filter(function(e){ return catPushSelected[e.id]; }).length;
            hd.checked = visPush.length > 0 && sel === visPush.length;
            hd.indeterminate = sel > 0 && sel < visPush.length;
        }
    }
    function onCatCheck(id, checked) {
        if (checked) catPushSelected[id] = true; else delete catPushSelected[id];
        setRowCheckedDom(id, checked);
        refreshPushButton();
    }
    function toggleHeadCheck(el) {
        visibleCatalogRows().filter(isPushable).forEach(function(e){
            if (el.checked) catPushSelected[e.id] = true; else delete catPushSelected[e.id];
            setRowCheckedDom(e.id, el.checked);
        });
        refreshPushButton();
    }
    // Select/deselect all currently-VISIBLE pushable rows (respects filter + search).
    function toggleSelectAllConfirmed() {
        var pushRows = visibleCatalogRows().filter(isPushable);
        var anyUnselected = pushRows.some(function(e){ return !catPushSelected[e.id]; });
        pushRows.forEach(function(e){
            if (anyUnselected) catPushSelected[e.id] = true; else delete catPushSelected[e.id];
            setRowCheckedDom(e.id, anyUnselected);
        });
        refreshPushButton();
    }
```

- [ ] **Step 3: Teach `setCatalogFilter` the `pushable` value**

Find:
```javascript
        var map = { all: 'catFilterAll', review: 'catFilterReview', needs_creating: 'catFilterNeeds', confirmed: 'catFilterConfirmed' };
```
Replace with:
```javascript
        var map = { all: 'catFilterAll', review: 'catFilterReview', needs_creating: 'catFilterNeeds', confirmed: 'catFilterConfirmed', pushable: 'catFilterPushable' };
```

- [ ] **Step 4: Rewrite `renderCatalog` to render table + cards from `visibleCatalogRows()`**

Find the entire `function renderCatalog() { ... }` (from `function renderCatalog() {` through its closing `}` right before `async function confirmCatalogEntry`) and replace it with:
```javascript
    function renderCatalog() {
        var tbody = document.getElementById('catalogTableBody');
        var cards = document.getElementById('catalogCards');
        var counts = { confirmed: 0, review: 0, needs_creating: 0 };
        catalogEntries.forEach(function(e){ counts[e.link_status] = (counts[e.link_status] || 0) + 1; });
        document.getElementById('catTotal').textContent = catalogEntries.length;
        document.getElementById('catConfirmed').textContent = counts.confirmed;
        document.getElementById('catReview').textContent = counts.review;
        document.getElementById('catNeeds').textContent = counts.needs_creating;

        var rows = visibleCatalogRows();

        var showEl = document.getElementById('catShowing');
        if (showEl) showEl.textContent = rows.length + ' of ' + catalogEntries.length;

        var pushableTotal = catalogEntries.filter(isPushable).length;
        var hintEl = document.getElementById('catPushableHint');
        if (hintEl) {
            if (pushableTotal > 0 && catalogFilter !== 'pushable') {
                hintEl.textContent = '☑ ' + pushableTotal + ' pushable';
                hintEl.classList.remove('hidden');
            } else {
                hintEl.classList.add('hidden');
            }
        }

        var emptyEl = document.getElementById('catalogEmpty');
        if (!rows.length) {
            if (tbody) tbody.innerHTML = '';
            if (cards) cards.innerHTML = '';
            if (emptyEl) emptyEl.classList.remove('hidden');
            refreshPushButton();
            return;
        }
        if (emptyEl) emptyEl.classList.add('hidden');

        function statusBadge(e) {
            return e.link_status === 'confirmed'
                ? '<span class="px-1.5 py-0.5 rounded bg-green-100 text-green-700">✅ ' + (e.link_confidence || '') + '</span>'
                : e.link_status === 'review'
                ? '<span class="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700" title="' + esc(e.link_reason || '') + '">⚠ ' + (e.link_confidence || '') + '</span>'
                : '<span class="px-1.5 py-0.5 rounded bg-rose-100 text-rose-700">🆕</span>';
        }
        function linkedHtml(e) {
            return e.zoho_item_id ? esc(zohoNameFor(e.zoho_item_id, e)) : '<span class="text-gray-400">— not linked —</span>';
        }
        function actionHtml(e) {
            var action = '';
            if (e.link_status !== 'confirmed') {
                if (e.zoho_item_id) action += '<button onclick="confirmCatalogEntry(' + e.id + ', \'' + esc(String(e.zoho_item_id)) + '\')" class="px-2 py-1 rounded bg-green-600 text-white text-[10px] font-bold mr-1">✓ Confirm</button>';
                action += '<button onclick="openCatPicker(' + e.id + ')" class="px-2 py-1 rounded border border-indigo-300 text-indigo-700 text-[10px] font-bold">🔄 Pick</button>';
            } else {
                action += '<button onclick="openCatPicker(' + e.id + ')" class="px-2 py-1 rounded border text-gray-500 text-[10px]">change</button>';
            }
            return action;
        }

        if (tbody) {
            tbody.innerHTML = rows.map(function(e){
                var checkbox = isPushable(e)
                    ? '<input type="checkbox" class="cat-push-check" data-id="' + e.id + '" ' + (catPushSelected[e.id] ? 'checked' : '') + ' onclick="onCatCheck(' + e.id + ', this.checked)">'
                    : '';
                var priceCell = (e.current_dpl != null ? '₹' + esc(String(e.current_dpl)) : '-') +
                    (e.current_rate != null ? '<div class="text-[10px] text-gray-400">→ ₹' + esc(String(e.current_rate)) + '</div>' : '');
                return '<tr class="border-t">' +
                    '<td class="px-2 py-1.5 text-center">' + checkbox + '</td>' +
                    '<td class="px-2 py-1.5"><div class="font-semibold text-gray-800">' + esc(e.product_name || '') + '</div><div class="text-gray-500">' + esc(e.base_name || '') + '</div></td>' +
                    '<td class="px-2 py-1.5">' + esc(e.size_tier || '') + (e.dpl_size_label && e.dpl_size_label !== e.size_tier ? ' <span class="text-gray-400">(' + esc(e.dpl_size_label) + ')</span>' : '') + '</td>' +
                    '<td class="px-2 py-1.5 text-right">' + priceCell + '</td>' +
                    '<td class="px-2 py-1.5 font-mono">' + esc(e.canonical_sku || '-') + '</td>' +
                    '<td class="px-2 py-1.5">' + linkedHtml(e) + '</td>' +
                    '<td class="px-2 py-1.5 text-center">' + statusBadge(e) + '</td>' +
                    '<td class="px-2 py-1.5 text-center whitespace-nowrap">' + actionHtml(e) + '</td>' +
                    '</tr>';
            }).join('');
        }

        if (cards) {
            cards.innerHTML = rows.map(function(e){
                var cb = isPushable(e)
                    ? '<input type="checkbox" class="cat-push-check w-5 h-5 mt-0.5 shrink-0" data-id="' + e.id + '" ' + (catPushSelected[e.id] ? 'checked' : '') + ' onclick="onCatCheck(' + e.id + ', this.checked)">'
                    : '<span class="w-5 shrink-0"></span>';
                var price = (e.current_dpl != null ? '₹' + esc(String(e.current_dpl)) : '-') +
                    (e.current_rate != null ? ' <span class="text-gray-400">→ ₹' + esc(String(e.current_rate)) + '</span>' : '');
                var sizeLine = esc(e.size_tier || '') + (e.dpl_size_label && e.dpl_size_label !== e.size_tier ? ' (' + esc(e.dpl_size_label) + ')' : '');
                return '<div class="border rounded-lg p-3 flex gap-3 ' + (catPushSelected[e.id] ? 'bg-emerald-50 border-emerald-200' : 'bg-white') + '">' +
                    cb +
                    '<div class="flex-1 min-w-0">' +
                        '<div class="flex items-start justify-between gap-2">' +
                            '<div class="min-w-0"><div class="font-semibold text-gray-800 truncate">' + esc(e.product_name || '') + '</div>' +
                            '<div class="text-gray-500 text-[11px]">' + esc(e.base_name || '') + ' · ' + sizeLine + '</div></div>' +
                            statusBadge(e) +
                        '</div>' +
                        '<div class="text-[12px] text-gray-700 mt-1">' + price + '</div>' +
                        '<div class="text-[10px] text-gray-400 font-mono mt-0.5">' + esc(e.canonical_sku || '-') + '</div>' +
                        '<div class="text-[11px] text-gray-600 mt-0.5 truncate">' + linkedHtml(e) + '</div>' +
                        '<div class="mt-2 flex flex-wrap gap-1">' + actionHtml(e) + '</div>' +
                    '</div>' +
                '</div>';
            }).join('');
        }

        refreshPushButton();
    }
```

- [ ] **Step 5: Verify the page still loads (desktop unchanged)**

Open `act.qcpaintshop.com/admin-dpl.html` (or the local server) in a desktop browser, go to the DPL/Birla section, Build/Load Catalog. Open DevTools console.
Expected: no JS errors; the existing table renders exactly as before (cards/search/hint markup don't exist yet — guarded, so silently skipped); checkbox selection on confirmed rows still works; "🚀 Push N" still updates.

- [ ] **Step 6: Commit**

```bash
git add public/admin-dpl.html
git commit -m "feat(dpl-catalog-ui): shared isPushable/visibleCatalogRows pipeline + data-driven selection + dual render"
```

---

## Task 2: Markup — search, Pushable filter, count/hint, mobile cards, cache meta

**File:** `public/admin-dpl.html` (`#catalogPanel` markup + `<head>`).

- [ ] **Step 1: Add the Pushable filter button**

Find (in the catalog toolbar filter group):
```html
                        <button onclick="setCatalogFilter('confirmed')" id="catFilterConfirmed" class="cat-filter px-2 py-1 rounded text-[11px] font-semibold bg-gray-100 text-gray-600">Confirmed</button>
                        <span class="mx-1 w-px bg-gray-200"></span>
```
Replace with:
```html
                        <button onclick="setCatalogFilter('confirmed')" id="catFilterConfirmed" class="cat-filter px-2 py-1 rounded text-[11px] font-semibold bg-gray-100 text-gray-600">Confirmed</button>
                        <button onclick="setCatalogFilter('pushable')" id="catFilterPushable" class="cat-filter px-2 py-1 rounded text-[11px] font-semibold bg-gray-100 text-gray-600">☑ Pushable</button>
                        <span class="mx-1 w-px bg-gray-200"></span>
```

- [ ] **Step 2: Add the search row (search input + count + hint) below the toolbar**

Find (the closing of the toolbar flex row, immediately before the table wrapper):
```html
                </div>
                <div class="overflow-x-auto border rounded-lg">
                    <table class="w-full text-[11px]">
```
Replace with:
```html
                </div>
                <div class="flex flex-wrap items-center gap-2 mb-2">
                    <input type="text" id="catSearch" oninput="setCatalogSearch(this.value)" placeholder="🔍 Search product / base / SKU / Zoho item…" class="flex-1 min-w-[180px] px-3 py-1.5 border rounded text-[11px] outline-none focus:border-indigo-500">
                    <span class="text-[11px] text-gray-500 whitespace-nowrap">Showing <b id="catShowing">0 of 0</b></span>
                    <button onclick="setCatalogFilter('pushable')" id="catPushableHint" class="hidden text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 font-semibold whitespace-nowrap"></button>
                </div>
                <div class="overflow-x-auto border rounded-lg hidden sm:block">
                    <table class="w-full text-[11px]">
```

- [ ] **Step 3: Add the mobile card container after the table wrapper**

Find:
```html
                        <tbody id="catalogTableBody"></tbody>
                    </table>
                </div>
                <div id="catalogEmpty" class="hidden text-center text-gray-400 text-xs py-8">No catalog entries for this filter.</div>
```
Replace with:
```html
                        <tbody id="catalogTableBody"></tbody>
                    </table>
                </div>
                <div id="catalogCards" class="sm:hidden space-y-2"></div>
                <div id="catalogEmpty" class="hidden text-center text-gray-400 text-xs py-8">No catalog entries match.</div>
```

- [ ] **Step 4: Add no-cache meta tags in `<head>`**

Find the `<head>` line with the viewport meta:
```html
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
```
Add immediately after it:
```html
    <meta http-equiv="Cache-Control" content="no-cache, must-revalidate">
    <meta http-equiv="Pragma" content="no-cache">
```
(If the exact viewport line differs, add the two meta tags directly after the `<meta charset...>` line instead — anywhere inside `<head>` is fine.)

- [ ] **Step 5: Browser smoke — desktop**

On a desktop browser (≥640px) at `admin-dpl.html`, Build/Load the Birla catalog. Verify:
1. "Showing **1329 of 1329**"; the hint button shows "☑ 214 pushable".
2. Click **☑ Pushable** → table shows only confirmed+pushable rows; every visible row has a checkbox; "Showing **214 of 1329**".
3. Type "elegance" in search → list narrows live (~200ms); count updates; clear → restores.
4. Search + Pushable combine (only pushable rows matching the text).
5. Header checkbox: tick it → all visible pushable rows select; "🚀 Push N" = visible pushable count; untick → clears.
6. Console has no errors.

- [ ] **Step 6: Browser smoke — mobile**

Open DevTools device toolbar (or a phone) at <640px. Verify:
1. The table is hidden; the **card list** shows instead, one card per visible row.
2. Pushable rows show a tappable checkbox on the left; the card tints emerald when selected.
3. **✓ Confirm / 🔄 Pick / change** buttons work (open picker / confirm).
4. Selecting a card updates "🚀 Push N"; switching to desktop width keeps the same selection (data-driven).
5. Search + Pushable filter work identically; empty search result shows "No catalog entries match."

- [ ] **Step 7: Commit**

```bash
git add public/admin-dpl.html
git commit -m "feat(dpl-catalog-ui): search box, Pushable filter, result count/hint, mobile cards, no-cache meta"
```

---

## Self-Review notes (spec coverage)

- **Search (all text, debounced 200ms):** Task 1 Step 1 (`visibleCatalogRows` + `setCatalogSearch`), Task 2 Step 2 (input). ✓
- **Pushable filter + existing status filters:** Task 1 Step 1/3 (`isPushable`, filter logic), Task 2 Step 1 (button). ✓
- **Showing X of Y + pushable hint:** Task 1 Step 4 (`catShowing`/`catPushableHint`), Task 2 Step 2. ✓
- **Mobile cards / desktop table (one render):** Task 1 Step 4 (dual output), Task 2 Step 2/3 (`hidden sm:block` + `#catalogCards sm:hidden`). ✓
- **Dual-DOM selection from data model:** Task 1 Step 2 (`setRowCheckedDom`, data-derived `refreshPushButton`, no DOM `:checked` counting). ✓
- **Empty state for filter/search:** Task 1 Step 4 + Task 2 Step 3 ("No catalog entries match."). ✓
- **Cache-busting:** Task 2 Step 4 (no-cache metas). ✓
- **No backend change / reused handlers:** confirmed — only `admin-dpl.html` touched; push/apply/confirm/pick handlers reused. ✓

## Out of scope

Product-family grouping, virtual scrolling, server-side search/pagination, other brands, the AI/legacy match flow, non-catalog parts of `admin-dpl.html`.
