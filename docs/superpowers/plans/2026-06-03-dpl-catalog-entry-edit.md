# DPL Catalog — entry detail + edit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the admin view & edit a catalog entry's canonical name/SKU/description, see the old DPL alongside new DPL → selling rate, and stop a single duplicate-SKU item from blocking the whole push (skip conflicts with a clear reason, flag them in the UI).

**Architecture:** Additive backend (`routes/zoho.js` GET enrich + new PUT edit + push pre-filter; `services/dpl-catalog.js` one helper) returning extra fields on the existing catalog GET, plus a tap-to-open edit sheet in `public/admin-dpl.html`. No DB migration; reuses `getCatalog`, `buildPushChanges`, `createBulkEditJob`.

**Tech Stack:** Express CommonJS + mysql2, Jest (service unit + route-registration tests), vanilla JS + Tailwind UI.

**Spec:** `docs/superpowers/specs/2026-06-03-dpl-catalog-entry-edit-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `services/dpl-catalog.js` | `updateCanonicalFields(id, fields, updatedBy)` | Modify |
| `routes/zoho.js` | GET enrich (old Zoho values + `sku_conflict`); new `PUT .../entry/:id`; push SKU-conflict pre-filter | Modify |
| `public/admin-dpl.html` | `#catEditModal` + handlers; card/table ✏ Edit + ⚠ dup + old-DPL price line | Modify |
| `tests/unit/dpl-catalog.test.js` | `updateCanonicalFields` unit test | Modify |
| `tests/unit/dpl-catalog-endpoints.test.js` | PUT route registration | Modify |

**Reused unchanged:** `getCatalog`, `buildPushChanges`, `createBulkEditJob` (backstop), `confirmCatalogEntry`, `openCatPicker`, search/filter/card pipeline.

---

## Task 1: Service — `updateCanonicalFields` + unit test

**Files:** Modify `services/dpl-catalog.js`; Modify `tests/unit/dpl-catalog.test.js`.

- [ ] **Step 1: Write failing test** — append to `tests/unit/dpl-catalog.test.js` (use the file's existing required module variable, e.g. `catalog`):

```javascript
describe('updateCanonicalFields', () => {
    test('updates only provided canonical fields with map-order params', async () => {
        const calls = [];
        catalog.setPool({ query: async (sql, params) => { calls.push({ sql, params }); return [{}]; } });
        const ok = await catalog.updateCanonicalFields(
            5, { canonical_name: 'N', canonical_sku: 'ABC', canonical_description: 'D' }, 'admin');
        expect(ok).toBe(true);
        expect(calls).toHaveLength(1);
        expect(calls[0].sql).toMatch(/UPDATE dpl_catalog SET canonical_name = \?, canonical_sku = \?, canonical_description = \?, updated_by = \? WHERE id = \?/);
        expect(calls[0].params).toEqual(['N', 'ABC', 'D', 'admin', 5]);
    });

    test('writes only the keys provided', async () => {
        const calls = [];
        catalog.setPool({ query: async (sql, params) => { calls.push({ sql, params }); return [{}]; } });
        await catalog.updateCanonicalFields(7, { canonical_sku: 'XYZ' }, 'u');
        expect(calls[0].sql).toMatch(/SET canonical_sku = \?, updated_by = \? WHERE id = \?/);
        expect(calls[0].params).toEqual(['XYZ', 'u', 7]);
    });

    test('returns false and issues no query when no fields provided', async () => {
        const calls = [];
        catalog.setPool({ query: async (sql, params) => { calls.push({ sql, params }); return [{}]; } });
        const ok = await catalog.updateCanonicalFields(9, {}, 'u');
        expect(ok).toBe(false);
        expect(calls).toHaveLength(0);
    });
});
```

- [ ] **Step 2: Run, verify FAIL** — `npx jest tests/unit/dpl-catalog.test.js` → FAIL (`updateCanonicalFields` undefined).

- [ ] **Step 3: Implement** — in `services/dpl-catalog.js`, immediately AFTER the `confirmLink` function (and before `module.exports`), add:

```javascript
// Update user-editable canonical fields on an entry. Only keys present in `fields`
// are written (undefined keys untouched); a provided value is trimmed; '' clears it.
// Returns false (no query) when nothing was provided.
async function updateCanonicalFields(id, fields, updatedBy) {
    const editable = ['canonical_name', 'canonical_sku', 'canonical_description'];
    const sets = [];
    const vals = [];
    for (const key of editable) {
        if (fields && fields[key] !== undefined) {
            sets.push(`${key} = ?`);
            vals.push(fields[key] === null ? null : String(fields[key]).trim());
        }
    }
    if (!sets.length) return false;
    sets.push('updated_by = ?');
    vals.push(updatedBy || null);
    vals.push(id);
    await pool.query(`UPDATE dpl_catalog SET ${sets.join(', ')} WHERE id = ?`, vals);
    return true;
}
```

- [ ] **Step 4: Export it** — in `module.exports`, add `updateCanonicalFields` to the list (next to `updateAppliedPrices`):

```javascript
    buildPushChanges, upsertEntries, getCatalog, confirmLink, updateAppliedPrices, updateCanonicalFields,
```
(Match the existing export line's style; just append `updateCanonicalFields`.)

- [ ] **Step 5: Run, verify PASS** — `npx jest tests/unit/dpl-catalog.test.js` → all pass.

- [ ] **Step 6: Commit**

```bash
git add services/dpl-catalog.js tests/unit/dpl-catalog.test.js
git commit -m "feat(dpl-catalog): updateCanonicalFields service helper"
```

---

## Task 2: Routes — GET enrich + PUT edit + push SKU pre-filter

**Files:** Modify `routes/zoho.js`; Modify `tests/unit/dpl-catalog-endpoints.test.js`.

- [ ] **Step 1: Add PUT registration test** — in `tests/unit/dpl-catalog-endpoints.test.js`, inside the existing `describe`, add:

```javascript
    test('PUT /items/dpl-catalog/entry/:id', () => {
        expect(has('put', '/items/dpl-catalog/entry/:id')).toBe(true);
    });
```

- [ ] **Step 2: Run, verify FAIL** — `npx jest tests/unit/dpl-catalog-endpoints.test.js` → the new test FAILS.

- [ ] **Step 3: Enrich the GET handler** — in `routes/zoho.js`, replace the whole `router.get('/items/dpl-catalog/:brand', ...)` handler (the one returning `getCatalog`) with:

```javascript
// Read the brand catalog, enriched with linked Zoho values (old DPL/rate/name/sku/
// description) + a sku_conflict flag (canonical_sku held by a DIFFERENT active item).
router.get('/items/dpl-catalog/:brand', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const brand = String(req.params.brand || '').toLowerCase();
        if (!assertSupportedBrand(brand, res)) return;
        const entries = await dplCatalogService.getCatalog(brand);

        const linkedIds = [...new Set(entries.filter(e => e.zoho_item_id).map(e => String(e.zoho_item_id)))];
        const zById = new Map();
        if (linkedIds.length) {
            const [zrows] = await pool.query(
                `SELECT zoho_item_id, zoho_item_name, zoho_sku, zoho_cf_dpl, zoho_rate, zoho_description
                 FROM zoho_items_map WHERE zoho_item_id IN (${linkedIds.map(() => '?').join(',')})`,
                linkedIds
            );
            zrows.forEach(z => zById.set(String(z.zoho_item_id), z));
        }

        const skus = [...new Set(entries.filter(e => e.canonical_sku).map(e => String(e.canonical_sku).toUpperCase()))];
        const skuHolders = new Map();
        if (skus.length) {
            const [hrows] = await pool.query(
                `SELECT zoho_item_id, zoho_item_name, UPPER(zoho_sku) AS sku
                 FROM zoho_items_map WHERE zoho_status='active' AND UPPER(zoho_sku) IN (${skus.map(() => '?').join(',')})`,
                skus
            );
            hrows.forEach(h => {
                if (!skuHolders.has(h.sku)) skuHolders.set(h.sku, []);
                skuHolders.get(h.sku).push({ id: String(h.zoho_item_id), name: h.zoho_item_name });
            });
        }

        const decorated = entries.map(e => {
            const z = e.zoho_item_id ? zById.get(String(e.zoho_item_id)) : null;
            let sku_conflict = null;
            if (e.canonical_sku) {
                const holders = skuHolders.get(String(e.canonical_sku).toUpperCase()) || [];
                const other = holders.find(h => h.id !== String(e.zoho_item_id));
                if (other) sku_conflict = other.name;
            }
            return Object.assign({}, e, {
                old_dpl: z && z.zoho_cf_dpl != null ? z.zoho_cf_dpl : null,
                old_rate: z && z.zoho_rate != null ? z.zoho_rate : null,
                zoho_name: z ? z.zoho_item_name : null,
                zoho_sku: z ? z.zoho_sku : null,
                zoho_description: z ? z.zoho_description : null,
                sku_conflict,
            });
        });

        res.json({ success: true, data: decorated });
    } catch (err) {
        console.error('DPL catalog get error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});
```

- [ ] **Step 4: Add the PUT edit endpoint** — in `routes/zoho.js`, immediately AFTER the `confirm-link` route's closing `});` (~line 171), insert:

```javascript
// Edit user-correctable canonical fields (name / sku / description) on an entry.
router.put('/items/dpl-catalog/entry/:id', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: 'Invalid entry id' });
        const body = req.body || {};
        const fields = {};
        ['canonical_name', 'canonical_sku', 'canonical_description'].forEach(k => {
            if (body[k] !== undefined) fields[k] = body[k];
        });
        const updatedBy = req.user ? (req.user.username || String(req.user.id)) : null;
        const ok = await dplCatalogService.updateCanonicalFields(id, fields, updatedBy);
        if (!ok) return res.status(400).json({ success: false, message: 'No editable fields provided' });
        res.json({ success: true });
    } catch (err) {
        console.error('DPL catalog edit error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});
```

- [ ] **Step 5: Add the push SKU-conflict pre-filter** — in `routes/zoho.js` push handler, find:

```javascript
        if (!pushable.length) {
            return res.status(400).json({ success: false, message: 'No pushable confirmed entries with a DPL price in the selection.', skipped });
        }

        // Current Zoho values for diffing + price-history old values.
        const zids = [...new Set(pushable.map(e => String(e.zoho_item_id)))];
```
Replace with:

```javascript
        if (!pushable.length) {
            return res.status(400).json({ success: false, message: 'No pushable confirmed entries with a DPL price in the selection.', skipped });
        }

        // Exclude entries whose canonical SKU is held by a DIFFERENT active Zoho item.
        // Zoho rejects duplicate SKUs; skip these with a clear reason (so one bad item
        // does not fail the whole batch). The user edits the SKU and re-pushes.
        const conflictSkus = [...new Set(pushable.filter(e => e.canonical_sku).map(e => String(e.canonical_sku).toUpperCase()))];
        const holderBySku = new Map();
        if (conflictSkus.length) {
            const [hrows] = await pool.query(
                `SELECT zoho_item_id, zoho_item_name, UPPER(zoho_sku) AS sku
                 FROM zoho_items_map WHERE zoho_status='active' AND UPPER(zoho_sku) IN (${conflictSkus.map(() => '?').join(',')})`,
                conflictSkus
            );
            hrows.forEach(h => {
                if (!holderBySku.has(h.sku)) holderBySku.set(h.sku, []);
                holderBySku.get(h.sku).push({ id: String(h.zoho_item_id), name: h.zoho_item_name });
            });
        }
        const conflictFree = [];
        for (const e of pushable) {
            const holders = e.canonical_sku ? (holderBySku.get(String(e.canonical_sku).toUpperCase()) || []) : [];
            const other = holders.find(h => h.id !== String(e.zoho_item_id));
            if (other) {
                skipped.push({ id: e.id, reason: `SKU '${e.canonical_sku}' already used by '${other.name}'` });
            } else {
                conflictFree.push(e);
            }
        }
        if (!conflictFree.length) {
            return res.status(400).json({ success: false, message: 'Nothing to push — all selected items have SKU conflicts. Edit the SKUs and retry.', skipped });
        }

        // Current Zoho values for diffing + price-history old values.
        const zids = [...new Set(conflictFree.map(e => String(e.zoho_item_id)))];
```

- [ ] **Step 6: Point the items loop at `conflictFree`** — in the SAME push handler, find:

```javascript
        const items = [];
        for (const e of pushable) {
```
Replace with:

```javascript
        const items = [];
        for (const e of conflictFree) {
```
(Leave the rest of the loop, `createBulkEditJob`, price-history, and response unchanged.)

- [ ] **Step 7: Verify** — run:

```bash
node --check routes/zoho.js && node -e "require('./routes/zoho.js'); console.log('zoho OK')"
npx jest tests/unit/dpl-catalog-endpoints.test.js tests/unit/dpl-catalog.test.js
```
Expected: `zoho OK` and all tests pass (incl. the new PUT registration test).

- [ ] **Step 8: Commit**

```bash
git add routes/zoho.js tests/unit/dpl-catalog-endpoints.test.js
git commit -m "feat(dpl-catalog): GET enrich (old DPL + sku_conflict), PUT edit, push skips SKU conflicts"
```

---

## Task 3: UI — edit sheet + card affordances

**Files:** Modify `public/admin-dpl.html`.

- [ ] **Step 1: Add the edit-sheet modal** — immediately AFTER the `#catPickerModal` closing `</div>` block (the picker modal that ends just before `<!-- Auto-Propose (No PDF)`), insert:

```html
            <!-- Catalog entry detail + edit sheet -->
            <div id="catEditModal" class="fixed inset-0 bg-black/40 items-center justify-center z-50" style="display:none">
                <div class="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col">
                    <div class="p-3 border-b flex items-center justify-between">
                        <div class="font-bold text-sm" id="catEditTitle">Edit catalog item</div>
                        <button onclick="closeCatEdit()" class="text-gray-400 hover:text-gray-700 text-xl leading-none">&times;</button>
                    </div>
                    <div class="p-3 overflow-y-auto space-y-3 text-xs">
                        <div id="catEditMeta" class="text-gray-500"></div>
                        <div id="catEditPrices" class="flex flex-wrap items-center gap-2 text-[12px]"></div>
                        <div id="catEditLinked" class="text-[11px] text-gray-600"></div>
                        <div>
                            <label class="block text-[11px] text-gray-500 mb-0.5">Name</label>
                            <input type="text" id="catEditName" class="w-full px-3 py-2 border rounded text-xs outline-none focus:border-indigo-500">
                        </div>
                        <div>
                            <label class="block text-[11px] text-gray-500 mb-0.5">SKU</label>
                            <input type="text" id="catEditSku" oninput="catEditCheckSku()" class="w-full px-3 py-2 border rounded text-xs font-mono outline-none focus:border-indigo-500">
                            <div id="catEditSkuWarn" class="hidden text-[11px] text-rose-600 mt-1"></div>
                        </div>
                        <div>
                            <label class="block text-[11px] text-gray-500 mb-0.5">Description</label>
                            <textarea id="catEditDesc" rows="3" class="w-full px-3 py-2 border rounded text-xs outline-none focus:border-indigo-500 resize-y"></textarea>
                        </div>
                    </div>
                    <div class="p-3 border-t flex justify-end gap-2">
                        <button onclick="closeCatEdit()" class="px-3 py-2 rounded border text-gray-600 text-xs">Cancel</button>
                        <button onclick="saveCatEdit()" id="catEditSaveBtn" class="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold disabled:opacity-50">💾 Save</button>
                    </div>
                </div>
            </div>
```

- [ ] **Step 2: Add edit-sheet handlers** — in the catalog JS, immediately AFTER the `function closeCatPicker() { ... }` line (near `openCatPicker`), insert:

```javascript
    var catEditEntryId = null;
    function openCatEdit(entryId) {
        var e = catalogEntries.find(function(x){ return x.id === entryId; });
        if (!e) return;
        catEditEntryId = entryId;
        document.getElementById('catEditTitle').textContent = (e.product_name || '') + ' ' + (e.base_name || '');
        document.getElementById('catEditMeta').textContent = (e.product_name || '') + ' · ' + (e.base_name || '') + ' · ' + (e.size_tier || '');
        var oldDpl = e.old_dpl != null ? '₹' + e.old_dpl : '—';
        var newDpl = e.current_dpl != null ? '₹' + e.current_dpl : '—';
        var rate = e.current_rate != null ? '₹' + e.current_rate : '—';
        document.getElementById('catEditPrices').innerHTML =
            '<span class="text-gray-400">Old DPL ' + esc(oldDpl) + '</span><span>→ New DPL <b>' + esc(newDpl) + '</b></span><span>→ Sell <b>' + esc(rate) + '</b></span>';
        document.getElementById('catEditLinked').innerHTML = e.zoho_item_id
            ? ('Linked: ' + esc(e.zoho_name || e.canonical_name || String(e.zoho_item_id)) + (e.zoho_sku ? ' <span class="font-mono text-gray-400">(' + esc(e.zoho_sku) + ')</span>' : ''))
            : '<span class="text-gray-400">— not linked —</span>';
        document.getElementById('catEditName').value = e.canonical_name || '';
        document.getElementById('catEditSku').value = e.canonical_sku || '';
        document.getElementById('catEditDesc').value = e.canonical_description || '';
        document.getElementById('catEditModal').style.display = 'flex';
        catEditCheckSku();
    }
    function closeCatEdit() { document.getElementById('catEditModal').style.display = 'none'; catEditEntryId = null; }
    function catEditCheckSku() {
        var e = catalogEntries.find(function(x){ return x.id === catEditEntryId; });
        var warn = document.getElementById('catEditSkuWarn');
        if (!e) { warn.classList.add('hidden'); return; }
        var val = document.getElementById('catEditSku').value.trim().toUpperCase();
        if (e.sku_conflict && e.canonical_sku && val === String(e.canonical_sku).toUpperCase()) {
            warn.textContent = '⚠ SKU already used by: ' + e.sku_conflict + ' — edit to a unique SKU before pushing.';
            warn.classList.remove('hidden');
        } else {
            warn.classList.add('hidden');
        }
    }
    async function saveCatEdit() {
        if (catEditEntryId == null) return;
        var btn = document.getElementById('catEditSaveBtn');
        btn.disabled = true;
        try {
            var resp = await fetch('/api/zoho/items/dpl-catalog/entry/' + catEditEntryId, {
                method: 'PUT',
                headers: { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    canonical_name: document.getElementById('catEditName').value,
                    canonical_sku: document.getElementById('catEditSku').value,
                    canonical_description: document.getElementById('catEditDesc').value
                })
            });
            var body = await resp.json();
            if (!resp.ok || !body.success) throw new Error(body.message || 'Save failed');
            closeCatEdit();
            showToast('Saved', 'success');
            await loadCatalog();
        } catch (err) {
            showToast('Save error: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }
```

- [ ] **Step 3: Add an ✏ Edit button to every row** — in `renderCatalog`'s `actionHtml(e)`, find:

```javascript
            } else {
                action += '<button onclick="openCatPicker(' + e.id + ')" class="px-2 py-1 rounded border text-gray-500 text-[10px]">change</button>';
            }
            return action;
```
Replace with:

```javascript
            } else {
                action += '<button onclick="openCatPicker(' + e.id + ')" class="px-2 py-1 rounded border text-gray-500 text-[10px]">change</button>';
            }
            action += '<button onclick="openCatEdit(' + e.id + ')" class="px-2 py-1 rounded border border-amber-300 text-amber-700 text-[10px] font-bold ml-1">✏ Edit</button>';
            return action;
```

- [ ] **Step 4: Table — old-DPL price + ⚠ dup on SKU + tappable product** — in `renderCatalog`'s `if (tbody)` block, find:

```javascript
                var priceCell = (e.current_dpl != null ? '₹' + esc(String(e.current_dpl)) : '-') +
                    (e.current_rate != null ? '<div class="text-[10px] text-gray-400">→ ₹' + esc(String(e.current_rate)) + '</div>' : '');
                return '<tr class="border-t">' +
                    '<td class="px-2 py-1.5 text-center">' + checkbox + '</td>' +
                    '<td class="px-2 py-1.5"><div class="font-semibold text-gray-800">' + esc(e.product_name || '') + '</div><div class="text-gray-500">' + esc(e.base_name || '') + '</div></td>' +
                    '<td class="px-2 py-1.5">' + esc(e.size_tier || '') + (e.dpl_size_label && e.dpl_size_label !== e.size_tier ? ' <span class="text-gray-400">(' + esc(e.dpl_size_label) + ')</span>' : '') + '</td>' +
                    '<td class="px-2 py-1.5 text-right">' + priceCell + '</td>' +
                    '<td class="px-2 py-1.5 font-mono">' + esc(e.canonical_sku || '-') + '</td>' +
```
Replace with:

```javascript
                var priceCell = (e.old_dpl != null ? '<span class="text-gray-400">₹' + esc(String(e.old_dpl)) + ' → </span>' : '') +
                    (e.current_dpl != null ? '₹' + esc(String(e.current_dpl)) : '-') +
                    (e.current_rate != null ? '<div class="text-[10px] text-gray-400">→ ₹' + esc(String(e.current_rate)) + '</div>' : '');
                var skuCell = '<span class="' + (e.sku_conflict ? 'text-rose-600' : '') + '">' + esc(e.canonical_sku || '-') + (e.sku_conflict ? ' <span title="' + esc(e.sku_conflict) + '">⚠</span>' : '') + '</span>';
                return '<tr class="border-t">' +
                    '<td class="px-2 py-1.5 text-center">' + checkbox + '</td>' +
                    '<td class="px-2 py-1.5 cursor-pointer" onclick="openCatEdit(' + e.id + ')"><div class="font-semibold text-gray-800">' + esc(e.product_name || '') + '</div><div class="text-gray-500">' + esc(e.base_name || '') + '</div></td>' +
                    '<td class="px-2 py-1.5">' + esc(e.size_tier || '') + (e.dpl_size_label && e.dpl_size_label !== e.size_tier ? ' <span class="text-gray-400">(' + esc(e.dpl_size_label) + ')</span>' : '') + '</td>' +
                    '<td class="px-2 py-1.5 text-right">' + priceCell + '</td>' +
                    '<td class="px-2 py-1.5 font-mono">' + skuCell + '</td>' +
```

- [ ] **Step 5: Card — old-DPL price + ⚠ dup on SKU + tappable title** — in `renderCatalog`'s `if (cards)` block, find:

```javascript
                var price = (e.current_dpl != null ? '₹' + esc(String(e.current_dpl)) : '-') +
                    (e.current_rate != null ? ' <span class="text-gray-400">→ ₹' + esc(String(e.current_rate)) + '</span>' : '');
                var sizeLine = esc(e.size_tier || '') + (e.dpl_size_label && e.dpl_size_label !== e.size_tier ? ' (' + esc(e.dpl_size_label) + ')' : '');
                return '<div class="cat-card border rounded-lg p-3 flex gap-3 ' + (catPushSelected[e.id] ? 'bg-emerald-50 border-emerald-200' : 'bg-white') + '" data-id="' + e.id + '">' +
                    cb +
                    '<div class="flex-1 min-w-0">' +
                        '<div class="flex items-start justify-between gap-2">' +
                            '<div class="min-w-0"><div class="font-semibold text-gray-800 truncate">' + esc(e.product_name || '') + '</div>' +
                            '<div class="text-gray-500 text-[11px]">' + esc(e.base_name || '') + ' · ' + sizeLine + '</div></div>' +
                            statusBadge(e) +
                        '</div>' +
                        '<div class="text-[12px] text-gray-700 mt-1">' + price + '</div>' +
                        '<div class="text-[10px] text-gray-400 font-mono mt-0.5">' + esc(e.canonical_sku || '-') + '</div>' +
```
Replace with:

```javascript
                var price = (e.old_dpl != null ? '<span class="text-gray-400">₹' + esc(String(e.old_dpl)) + ' → </span>' : '') +
                    (e.current_dpl != null ? '₹' + esc(String(e.current_dpl)) : '-') +
                    (e.current_rate != null ? ' <span class="text-gray-400">→ ₹' + esc(String(e.current_rate)) + '</span>' : '');
                var sizeLine = esc(e.size_tier || '') + (e.dpl_size_label && e.dpl_size_label !== e.size_tier ? ' (' + esc(e.dpl_size_label) + ')' : '');
                var skuLine = '<div class="text-[10px] font-mono mt-0.5 ' + (e.sku_conflict ? 'text-rose-600' : 'text-gray-400') + '">' + esc(e.canonical_sku || '-') + (e.sku_conflict ? ' ⚠ dup' : '') + '</div>';
                return '<div class="cat-card border rounded-lg p-3 flex gap-3 ' + (catPushSelected[e.id] ? 'bg-emerald-50 border-emerald-200' : 'bg-white') + '" data-id="' + e.id + '">' +
                    cb +
                    '<div class="flex-1 min-w-0">' +
                        '<div class="flex items-start justify-between gap-2">' +
                            '<div class="min-w-0 cursor-pointer" onclick="openCatEdit(' + e.id + ')"><div class="font-semibold text-gray-800 truncate">' + esc(e.product_name || '') + '</div>' +
                            '<div class="text-gray-500 text-[11px]">' + esc(e.base_name || '') + ' · ' + sizeLine + '</div></div>' +
                            statusBadge(e) +
                        '</div>' +
                        '<div class="text-[12px] text-gray-700 mt-1">' + price + '</div>' +
                        skuLine +
```

- [ ] **Step 6: Sanity check** — grep that each new function appears once: `function openCatEdit`, `function closeCatEdit`, `function catEditCheckSku`, `async function saveCatEdit`; and ids `catEditModal`, `catEditName`, `catEditSku`, `catEditDesc`, `catEditPrices`, `catEditLinked`, `catEditSkuWarn` each appear once. Confirm `var catEditEntryId` once.

- [ ] **Step 7: Browser smoke (human verifies)** — desktop + mobile:
  1. Build/Load catalog → cards/rows show **₹oldDPL → ₹newDPL → ₹rate** (old muted; omitted when no old DPL).
  2. A confirmed item with a colliding SKU shows **⚠** (table) / **⚠ dup** (card) on the SKU; tapping the product or **✏ Edit** opens the sheet with the warning line naming the conflicting item.
  3. Edit the SKU to a unique value → **Save** → toast, catalog reloads, ⚠ gone.
  4. Push that item → it now goes (or, if still conflicting, lands in **skipped** with the holder name while other items push).

- [ ] **Step 8: Commit**

```bash
git add public/admin-dpl.html
git commit -m "feat(dpl-catalog-ui): tap-to-edit sheet (name/SKU/desc), old DPL, SKU-dup badge"
```

---

## Self-Review notes (spec coverage)

- **GET enrich (old_dpl/old_rate/zoho_*/sku_conflict):** Task 2 Step 3. ✓
- **PUT edit endpoint + service helper:** Task 1 + Task 2 Step 4. ✓
- **Push skips SKU conflicts (no all-or-nothing):** Task 2 Steps 5-6. ✓
- **Edit sheet (old→new→sell, name/SKU/desc, live ⚠, Save→reload):** Task 3 Steps 1-2. ✓
- **Card/table ✏ Edit + ⚠ dup + old-DPL price + tap-to-open:** Task 3 Steps 3-5. ✓
- **SKU dup decision = block+show+edit:** the conflicting entry is flagged (⚠) and excluded from push with the holder name. ✓

## Out of scope

The `computeProposedFields` proposer algorithm, Confirm/Pick flow internals, other brands.
