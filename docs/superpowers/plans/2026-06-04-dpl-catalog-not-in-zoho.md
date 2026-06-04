# DPL Catalog — "Not in Zoho" mark + filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user mark a not-linked catalog entry as "not in Zoho (pending creation)", hide such items from the normal filters, and surface them under a "🚫 Pending" filter — so the review list shows only actionable items and pending creations are a clean worklist.

**Architecture:** A `not_in_zoho` column (kept out of the build upsert → survives rebuild) + a `setNotInZoho` service + a mark endpoint. UI: `isPending(e) = not_in_zoho && !zoho_item_id`; a Pending filter; a mark/unmark button on not-linked entries (card + picker footer).

**Tech Stack:** Node.js/Express CommonJS + mysql2, Jest, vanilla JS.

**Spec:** `docs/superpowers/specs/2026-06-04-dpl-catalog-not-in-zoho-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `migrations/migrate-dpl-catalog-not-in-zoho.js` | add `not_in_zoho` column (self-running, idempotent) | Create (done by controller) |
| `services/dpl-catalog.js` | `setNotInZoho(id, value, updatedBy)` | Modify |
| `routes/zoho.js` | `POST .../entry/:id/not-in-zoho` | Modify |
| `public/admin-dpl.html` | Pending filter, mark button (card + picker), `isPending`, `markNotInZoho` | Modify |
| tests | `setNotInZoho` unit + route registration | Modify |

---

## Task 1: Service `setNotInZoho` + mark endpoint + tests

**Files:** Modify `services/dpl-catalog.js`, `routes/zoho.js`, `tests/unit/dpl-catalog.test.js`, `tests/unit/dpl-catalog-endpoints.test.js`.

- [ ] **Step 1: Failing tests**

In `tests/unit/dpl-catalog.test.js` append:
```javascript
describe('setNotInZoho', () => {
    test('sets the flag (1/0) with updated_by', async () => {
        const calls = [];
        catalog.setPool({ query: async (sql, params) => { calls.push({ sql, params }); return [{}]; } });
        await catalog.setNotInZoho(5, true, 'u');
        expect(calls[0].sql).toMatch(/UPDATE dpl_catalog SET not_in_zoho = \?, updated_by = \? WHERE id = \?/);
        expect(calls[0].params).toEqual([1, 'u', 5]);
        await catalog.setNotInZoho(6, false, 'u');
        expect(calls[1].params).toEqual([0, 'u', 6]);
    });
});
```
In `tests/unit/dpl-catalog-endpoints.test.js` add inside the describe:
```javascript
    test('POST /items/dpl-catalog/entry/:id/not-in-zoho', () => {
        expect(has('post', '/items/dpl-catalog/entry/:id/not-in-zoho')).toBe(true);
    });
```

- [ ] **Step 2: Run, verify FAIL** — `npx jest tests/unit/dpl-catalog.test.js tests/unit/dpl-catalog-endpoints.test.js`.

- [ ] **Step 3: Implement service** — in `services/dpl-catalog.js`, immediately AFTER the `markPushed` function, add:
```javascript
// Flag/unflag an entry as "not in Zoho (pending creation)". Kept out of _COLS so it
// survives rebuilds.
async function setNotInZoho(id, value, updatedBy) {
    await pool.query(
        `UPDATE dpl_catalog SET not_in_zoho = ?, updated_by = ? WHERE id = ?`,
        [value ? 1 : 0, updatedBy || null, id]
    );
}
```
Add `setNotInZoho` to `module.exports`.

- [ ] **Step 4: Implement endpoint** — in `routes/zoho.js`, immediately AFTER the `PUT /items/dpl-catalog/entry/:id` edit route's closing `});`, insert:
```javascript
// Mark/unmark a catalog entry as "not in Zoho (pending creation)".
router.post('/items/dpl-catalog/entry/:id/not-in-zoho', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: 'Invalid entry id' });
        const value = !!(req.body && req.body.value);
        const updatedBy = req.user ? (req.user.username || String(req.user.id)) : null;
        await dplCatalogService.setNotInZoho(id, value, updatedBy);
        res.json({ success: true });
    } catch (err) {
        console.error('DPL catalog not-in-zoho error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});
```

- [ ] **Step 5: Run, verify PASS + module load**
```bash
node -e "require('./services/dpl-catalog.js'); console.log('svc OK')"
node --check routes/zoho.js && node -e "require('./routes/zoho.js'); console.log('zoho OK')"
npx jest tests/unit/dpl-catalog.test.js tests/unit/dpl-catalog-endpoints.test.js
```
Expected: `svc OK`, `zoho OK`, all pass.

- [ ] **Step 6: Commit**
```bash
git add services/dpl-catalog.js routes/zoho.js tests/unit/dpl-catalog.test.js tests/unit/dpl-catalog-endpoints.test.js
git commit -m "feat(dpl-catalog): not-in-zoho flag — service + mark endpoint"
```

---

## Task 2: UI — Pending filter + mark button + picker footer

**Files:** Modify `public/admin-dpl.html`.

- [ ] **Step 1: Add `isPending` + restructure `visibleCatalogRows`** — find:
```javascript
    // Rows visible after the active status/pushable filter AND the text search.
    function visibleCatalogRows() {
        var q = catalogSearch.trim().toLowerCase();
        return catalogEntries.filter(function(e){
            if (catalogFilter === 'pushable') { if (!isPushable(e)) return false; }
            else if (catalogFilter === 'pushed') { if (!e.pushed_at) return false; }
            else if (catalogFilter !== 'all' && e.link_status !== catalogFilter) return false;
            if (q) {
                var hay = ((e.product_name || '') + ' ' + (e.base_name || '') + ' ' +
                           (e.canonical_sku || '') + ' ' + zohoNameFor(e.zoho_item_id, e)).toLowerCase();
                if (hay.indexOf(q) === -1) return false;
            }
            return true;
        });
    }
```
Replace with:
```javascript
    // An entry the user marked "not in Zoho" that isn't linked yet → pending creation.
    function isPending(e) { return !!e.not_in_zoho && !e.zoho_item_id; }

    // Rows visible after the active filter AND the text search. Pending items show ONLY
    // under the 'pending' filter and are hidden from every other view.
    function visibleCatalogRows() {
        var q = catalogSearch.trim().toLowerCase();
        return catalogEntries.filter(function(e){
            if (catalogFilter === 'pending') {
                if (!isPending(e)) return false;
            } else {
                if (isPending(e)) return false;
                if (catalogFilter === 'pushable') { if (!isPushable(e)) return false; }
                else if (catalogFilter === 'pushed') { if (!e.pushed_at) return false; }
                else if (catalogFilter !== 'all' && e.link_status !== catalogFilter) return false;
            }
            if (q) {
                var hay = ((e.product_name || '') + ' ' + (e.base_name || '') + ' ' +
                           (e.canonical_sku || '') + ' ' + zohoNameFor(e.zoho_item_id, e)).toLowerCase();
                if (hay.indexOf(q) === -1) return false;
            }
            return true;
        });
    }
```

- [ ] **Step 2: Register the `pending` filter id** — find:
```javascript
        var map = { all: 'catFilterAll', review: 'catFilterReview', needs_creating: 'catFilterNeeds', confirmed: 'catFilterConfirmed', pushable: 'catFilterPushable', pushed: 'catFilterPushed' };
```
Replace with:
```javascript
        var map = { all: 'catFilterAll', review: 'catFilterReview', needs_creating: 'catFilterNeeds', confirmed: 'catFilterConfirmed', pushable: 'catFilterPushable', pushed: 'catFilterPushed', pending: 'catFilterPending' };
```

- [ ] **Step 3: Add the "🚫 Pending" filter button** — find:
```html
                        <button onclick="setCatalogFilter('pushed')" id="catFilterPushed" class="cat-filter px-2 py-1 rounded text-[11px] font-semibold bg-gray-100 text-gray-600">✅ Pushed</button>
```
Replace with:
```html
                        <button onclick="setCatalogFilter('pushed')" id="catFilterPushed" class="cat-filter px-2 py-1 rounded text-[11px] font-semibold bg-gray-100 text-gray-600">✅ Pushed</button>
                        <button onclick="setCatalogFilter('pending')" id="catFilterPending" class="cat-filter px-2 py-1 rounded text-[11px] font-semibold bg-gray-100 text-gray-600">🚫 Pending</button>
```

- [ ] **Step 4: Mark/unmark button in `actionHtml`** — find:
```javascript
            action += '<button onclick="openCatEdit(' + e.id + ')" class="px-2 py-1 rounded border border-amber-300 text-amber-700 text-[10px] font-bold ml-1">✏ Edit</button>';
            return action;
```
Replace with:
```javascript
            action += '<button onclick="openCatEdit(' + e.id + ')" class="px-2 py-1 rounded border border-amber-300 text-amber-700 text-[10px] font-bold ml-1">✏ Edit</button>';
            if (!e.zoho_item_id) {
                action += e.not_in_zoho
                    ? '<button onclick="markNotInZoho(' + e.id + ', false)" class="px-2 py-1 rounded border text-gray-500 text-[10px] ml-1">↩ Unmark</button>'
                    : '<button onclick="markNotInZoho(' + e.id + ', true)" class="px-2 py-1 rounded border border-rose-300 text-rose-700 text-[10px] font-bold ml-1">🚫 Not in Zoho</button>';
            }
            return action;
```

- [ ] **Step 5: Picker footer mark button** — find:
```html
                    <div id="catPickerResults" class="flex-1 overflow-y-auto px-3 pb-3 space-y-1"></div>
                </div>
            </div>

            <!-- Catalog entry detail + edit sheet -->
```
Replace with:
```html
                    <div id="catPickerResults" class="flex-1 overflow-y-auto px-3 pb-3 space-y-1"></div>
                    <div class="p-3 border-t">
                        <button onclick="markNotInZohoFromPicker()" class="w-full px-3 py-2 rounded border border-rose-300 text-rose-700 text-xs font-bold hover:bg-rose-50">🚫 This item isn't in Zoho — mark pending</button>
                    </div>
                </div>
            </div>

            <!-- Catalog entry detail + edit sheet -->
```

- [ ] **Step 6: Add `markNotInZoho` + `markNotInZohoFromPicker`** — immediately AFTER the `function pickCatZoho(zohoItemId) { ... }` function, add:
```javascript
    async function markNotInZoho(id, value) {
        try {
            var resp = await fetch('/api/zoho/items/dpl-catalog/entry/' + id + '/not-in-zoho', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ value: value })
            });
            var body = await resp.json();
            if (!resp.ok || !body.success) throw new Error(body.message || 'Failed');
            var e = catalogEntries.find(function(x){ return x.id === id; });
            if (e) e.not_in_zoho = value ? 1 : 0;
            showToast(value ? 'Marked: not in Zoho (pending)' : 'Unmarked', 'success');
            renderCatalog();
        } catch (err) { showToast('Mark error: ' + err.message, 'error'); }
    }
    function markNotInZohoFromPicker() {
        var id = catPickerEntryId;
        closeCatPicker();
        if (id != null) markNotInZoho(id, true);
    }
```

- [ ] **Step 7: Sanity** — grep each appears once: `function isPending`, `function markNotInZoho`, `function markNotInZohoFromPicker`, `id="catFilterPending"`, `catalogFilter === 'pending'`, `pending: 'catFilterPending'`. Eyeball braces/quotes.

- [ ] **Step 8: Browser smoke (human)** — mark a needs_creating item via "🚫 Not in Zoho" (or picker footer) → it disappears from Review/Needs-creating, appears under "🚫 Pending"; Unmark there → returns; rebuild preserves the mark; Pick/confirm the item → leaves Pending automatically.

- [ ] **Step 9: Commit**
```bash
git add public/admin-dpl.html
git commit -m "feat(dpl-catalog-ui): mark not-in-Zoho (pending) + Pending filter; hide pending from other views"
```

---

## Self-Review notes (spec coverage)

- **not_in_zoho flag (migration, survives rebuild):** controller migration + not in `_COLS`. ✓
- **setNotInZoho + endpoint:** Task 1. ✓
- **isPending = not_in_zoho && !linked; Pending filter shows only these; others hide them:** Task 2 Steps 1-3. ✓
- **Mark/unmark on not-linked (card + picker footer):** Task 2 Steps 4-6. ✓
- **Auto-leaves Pending when linked:** the `!e.zoho_item_id` in isPending. ✓

## Post-deploy (controller runs)

1. Push + deploy.
2. Apply migration: `ssh hetzner "cd /www/wwwroot/act.qcpaintshop.com && node migrations/migrate-dpl-catalog-not-in-zoho.js"`.
3. Smoke per Task 2 Step 8.

## Out of scope

Auto-creating Zoho items; bulk-mark; other brands.
