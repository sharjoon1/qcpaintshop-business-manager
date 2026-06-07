# Zoho-first Full Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Build-Catalog "Zoho-first" view in `public/admin-dpl.html` to full feature parity with DPL-first — pushed-state badges, Pushable/Pushed filters, search over linked DPL fields, SKU-conflict warnings, and one-step Re-pick of the linked DPL entry.

**Architecture:** The by-zoho route decorates catalog entries with `sku_conflict` (reusing the DPL-first route's skuHolders lookup) before `buildZohoFirstView`; the pure helper then surfaces `pushed_at/pushed_job_id/pushed_dpl/sku_conflict` and a derived `push_changed` onto each matched row. The frontend adds a pushed chip, two filter chips, full search, a SKU ⚠, and a Re-pick button that composes the existing `not-in-zoho` + `confirm-link` calls; push selection switches from "changed" to "pushable" to match DPL-first.

**Tech Stack:** Node.js, Express, MySQL (`mysql2/promise`); vanilla JS + Tailwind in `public/admin-dpl.html`; Jest unit tests; Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-06-07-zoho-first-full-parity-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `services/dpl-catalog.js` | Modify `buildZohoFirstView` | Surface `pushed_at/pushed_job_id/pushed_dpl/sku_conflict` + derived `push_changed` on matched rows |
| `routes/zoho.js` | Modify by-zoho route | Attach `sku_conflict` to entries before `buildZohoFirstView` |
| `tests/unit/dpl-catalog-zoho-first.test.js` | Modify | Assert pushed-state passthrough + `push_changed` derivation |
| `public/admin-dpl.html` | Modify | Pushed chip, Pushable/Pushed filters, full search, SKU ⚠, Re-pick, pushable selection |
| `tests/e2e/admin-dpl-zoho-first.spec.js` | Modify | Smoke pushed chip, Pushable filter, DPL-name search, SKU ⚠, Re-pick button |

**Important — editing `admin-dpl.html`:** ~5,300-line file. Locate edit points by the
unique anchor strings quoted in each step, not line numbers.

---

### Task 1: Backend — surface pushed-state + sku_conflict on Zoho-first rows

**Files:**
- Modify: `services/dpl-catalog.js` (`buildZohoFirstView`)
- Modify: `routes/zoho.js` (`GET …/:brand/by-zoho`)
- Test: `tests/unit/dpl-catalog-zoho-first.test.js`

- [ ] **Step 1: Add failing unit assertions**

In `tests/unit/dpl-catalog-zoho-first.test.js`, first extend the shared
`catalogEntries` fixture (near the top, the `{ id: 11, … }` matched+changed entry) so it
carries push-state + a conflict. Replace the line:

```js
    { id: 11, zoho_item_id: 'Z1', current_dpl: '2180', current_rate: '2830', product_name: 'A', base_name: 'White', dpl_size_label: '3.6L', canonical_sku: 'WPRC4' },
```

with:

```js
    { id: 11, zoho_item_id: 'Z1', current_dpl: '2180', current_rate: '2830', product_name: 'A', base_name: 'White', dpl_size_label: '3.6L', canonical_sku: 'WPRC4',
      pushed_at: '2026-06-01 10:00:00', pushed_job_id: 777, pushed_dpl: '2050', pushed_rate: '2660', sku_conflict: 'SOME OTHER ITEM' },
```

Then add these tests inside `describe('buildZohoFirstView', …)`, right after the
existing `'unmatched row has matched and linked_entries both null'` test:

```js
    test('matched row surfaces pushed-state + sku_conflict from the entry', () => {
        const r = rows.find(x => x.zoho_item_id === 'Z1');
        expect(r.pushed_at).toBe('2026-06-01 10:00:00');
        expect(r.pushed_job_id).toBe(777);
        expect(r.pushed_dpl).toBe(2050);
        expect(r.sku_conflict).toBe('SOME OTHER ITEM');
    });

    test('push_changed is true when pushed_dpl differs from current dpl', () => {
        // entry 11: pushed_dpl 2050 vs current_dpl 2180 → changed since last push.
        const r = rows.find(x => x.zoho_item_id === 'Z1');
        expect(r.push_changed).toBe(true);
    });

    test('push_changed is false when never pushed', () => {
        // entry 13 (Z3) has no pushed_at in the fixture.
        const r = rows.find(x => x.zoho_item_id === 'Z3');
        expect(r.push_changed).toBe(false);
        expect(r.pushed_at == null).toBe(true);
    });

    test('unmatched and shared rows have null pushed-state fields', () => {
        const u = rows.find(x => x.zoho_item_id === 'Z2'); // unmatched
        const s = rows.find(x => x.zoho_item_id === 'Z4'); // shared
        expect(u.pushed_at).toBeNull();
        expect(u.push_changed).toBe(false);
        expect(u.sku_conflict).toBeNull();
        expect(s.pushed_at).toBeNull();
        expect(s.push_changed).toBe(false);
        expect(s.sku_conflict).toBeNull();
    });

    test('push_changed is true when only the rate differs', () => {
        const out = buildZohoFirstView(
            [{ zoho_item_id: 'ZR', zoho_item_name: 'X', zoho_sku: 'S', zoho_cf_dpl: '100', zoho_rate: '130' }],
            [{ id: 1, zoho_item_id: 'ZR', current_dpl: '100', current_rate: '140', pushed_at: '2026-06-01 00:00:00', pushed_dpl: '100', pushed_rate: '130' }]
        );
        expect(out.rows[0].push_changed).toBe(true); // dpl same, rate 130→140
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest tests/unit/dpl-catalog-zoho-first.test.js --no-coverage
```

Expected: the new tests FAIL (`r.pushed_at` undefined / `push_changed` undefined); the
pre-existing tests still PASS (the fixture additions are extra keys, harmless).

- [ ] **Step 3: Surface the fields in `buildZohoFirstView`**

In `services/dpl-catalog.js`, the matched branch currently ends with the `matched = {…}`
assignment. Add push-state locals. First, extend the declaration line:

```js
        let matched = null, linked_entries = null;
```

to:

```js
        let matched = null, linked_entries = null;
        let pushed_at = null, pushed_job_id = null, pushed_dpl = null;
        let push_changed = false, sku_conflict = null;
```

Then, inside the `if (linked.length === 1) {` block, after the `matched = {…};`
assignment, add:

```js
            pushed_at = e.pushed_at != null ? e.pushed_at : null;
            pushed_job_id = e.pushed_job_id != null ? e.pushed_job_id : null;
            pushed_dpl = num(e.pushed_dpl);
            sku_conflict = e.sku_conflict || null;
            push_changed = pushed_at != null &&
                (Number(e.pushed_dpl) !== Number(e.current_dpl) ||
                 Number(e.pushed_rate) !== Number(e.current_rate));
```

Finally add the fields to the returned row object. Replace:

```js
            status, changed, shared_count, proposal,
            matched, linked_entries,
        };
```

with:

```js
            status, changed, shared_count, proposal,
            matched, linked_entries,
            pushed_at, pushed_job_id, pushed_dpl, push_changed, sku_conflict,
        };
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest tests/unit/dpl-catalog-zoho-first.test.js --no-coverage
```

Expected: ALL tests PASS.

- [ ] **Step 5: Decorate by-zoho entries with `sku_conflict` in the route**

In `routes/zoho.js`, find the by-zoho handler block:

```js
        const entries = await dplCatalogService.getCatalog(brand);
        const view = dplCatalogService.buildZohoFirstView(zohoItems, entries);
```

Replace it with (mirrors the `sku_conflict` lookup from the `/:brand` route):

```js
        const entries = await dplCatalogService.getCatalog(brand);

        // Decorate with sku_conflict: another ACTIVE Zoho item already holding this
        // entry's canonical SKU (pushing would collide). Mirrors GET …/:brand.
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
        for (const e of entries) {
            if (!e.canonical_sku) { e.sku_conflict = null; continue; }
            const holders = skuHolders.get(String(e.canonical_sku).toUpperCase()) || [];
            const other = holders.find(h => h.id !== String(e.zoho_item_id));
            e.sku_conflict = other ? other.name : null;
        }

        const view = dplCatalogService.buildZohoFirstView(zohoItems, entries);
```

- [ ] **Step 6: Run unit tests + lint to confirm backend is clean**

```bash
npx jest tests/unit/dpl-catalog-zoho-first.test.js --no-coverage
npx eslint routes/zoho.js services/dpl-catalog.js
```

Expected: tests PASS; eslint exits 0.

- [ ] **Step 7: Commit**

```bash
git add services/dpl-catalog.js routes/zoho.js tests/unit/dpl-catalog-zoho-first.test.js
git commit -m "feat(dpl-catalog): surface pushed-state + sku_conflict on Zoho-first rows"
```

---

### Task 2: Frontend — pushed-state chip (A) + SKU-conflict warning (D)

**Files:**
- Modify: `public/admin-dpl.html`

- [ ] **Step 1: Add the pushed chip helper**

Immediately BEFORE `function zfLinkedDplCell(r) {` add:

```js
    // Pushed-state chip for a matched Zoho-first row (mirrors DPL-first pushedChip).
    function zfPushedChip(r) {
        if (!r.pushed_at) return '';
        var detail = 'Pushed ' + fmtPushed(r.pushed_at) + (r.pushed_job_id ? ' · job #' + r.pushed_job_id : '');
        return r.push_changed
            ? ' <span class="px-1.5 py-0.5 rounded text-[10px] bg-amber-100 text-amber-700" title="' + esc(detail + ' · ₹' + r.pushed_dpl + '→₹' + r.new_dpl + ' — DPL changed, re-push') + '">⚠ re-push</span>'
            : ' <span class="px-1.5 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-700" title="' + esc(detail + ' · no change') + '">✅ pushed</span>';
    }
```

- [ ] **Step 2: Add a SKU-cell helper**

Immediately BEFORE `function zfPushedChip(r) {` add:

```js
    // SKU cell with a conflict warning when another active Zoho item holds this SKU.
    function zfSkuCell(r) {
        var sku = esc(r.zoho_sku || '—');
        if (r.sku_conflict) {
            return '<span class="text-rose-600">' + sku +
                ' <span title="SKU also used by: ' + esc(r.sku_conflict) + '">⚠</span></span>';
        }
        return sku;
    }
```

- [ ] **Step 3: Use the pushed chip + SKU cell in the table row**

In `renderZohoFirst`, the table-row template currently has:

```js
                '<td class="px-2 py-1.5 text-left text-gray-500">' + esc(r.zoho_sku) + '</td>' +
```

Replace with:

```js
                '<td class="px-2 py-1.5 text-left text-gray-500">' + zfSkuCell(r) + '</td>' +
```

And the Status cell currently reads:

```js
                '<td class="px-2 py-1.5 text-center">' + zfStatusChip(r) + zfProposalHtml(r) + zfRowActions(r) + '</td>' +
```

Replace with:

```js
                '<td class="px-2 py-1.5 text-center">' + zfStatusChip(r) + zfPushedChip(r) + zfProposalHtml(r) + zfRowActions(r) + '</td>' +
```

- [ ] **Step 4: Use the pushed chip + SKU conflict in the card**

In `zfCardHtml`, the SKU/category line currently reads:

```js
                '<div class="text-[10px] font-mono text-gray-400">' + esc(r.zoho_sku) +
                    (r.category ? ' · ' + esc(r.category) : '') + '</div></div>' +
                zfStatusChip(r) +
```

Replace with:

```js
                '<div class="text-[10px] font-mono ' + (r.sku_conflict ? 'text-rose-600' : 'text-gray-400') + '">' + esc(r.zoho_sku) +
                    (r.sku_conflict ? ' ⚠' : '') + (r.category ? ' · ' + esc(r.category) : '') + '</div></div>' +
                '<div class="text-right">' + zfStatusChip(r) + zfPushedChip(r) + '</div>' +
```

- [ ] **Step 5: Verify no regression**

```bash
npx playwright test tests/e2e/admin-dpl-zoho-first.spec.js
```

Expected: existing 4 tests still PASS (additive chips; `toContain` assertions unaffected).

- [ ] **Step 6: Commit**

```bash
git add public/admin-dpl.html
git commit -m "feat(dpl-zoho-first): pushed-state chip + SKU-conflict warning"
```

---

### Task 3: Frontend — Pushable/Pushed filters (B) + full search (C)

**Files:**
- Modify: `public/admin-dpl.html`

- [ ] **Step 1: Add the two filter chips to the markup**

Find the Zoho-first filter row (anchor: `id="zffUnchanged"`):

```html
                        <button onclick="setZohoFilter('unchanged')" id="zffUnchanged" class="zf-filter px-2 py-1 rounded text-[11px] font-semibold bg-gray-100 text-gray-600">✓ Unchanged</button>
```

Replace with (append two chips):

```html
                        <button onclick="setZohoFilter('unchanged')" id="zffUnchanged" class="zf-filter px-2 py-1 rounded text-[11px] font-semibold bg-gray-100 text-gray-600">✓ Unchanged</button>
                        <button onclick="setZohoFilter('pushable')"  id="zffPushable"  class="zf-filter px-2 py-1 rounded text-[11px] font-semibold bg-gray-100 text-gray-600">☑ Pushable</button>
                        <button onclick="setZohoFilter('pushed')"    id="zffPushed"    class="zf-filter px-2 py-1 rounded text-[11px] font-semibold bg-gray-100 text-gray-600">✅ Pushed</button>
```

- [ ] **Step 2: Add `zfIsPushable` near the other zf push helpers**

Find `function zfChangedRows() {` and add immediately ABOVE it:

```js
    // A row is pushable when it's matched, carries a DPL to write, and is either
    // not yet pushed or its DPL/rate changed since the last push (mirrors isPushable).
    function zfIsPushable(r) {
        return r.status === 'matched' && r.new_dpl != null && Number(r.new_dpl) > 0
            && (!r.pushed_at || r.push_changed);
    }
```

- [ ] **Step 3: Extend the filter + search predicate**

Replace the whole `visibleZohoFirstRows` function:

```js
    function visibleZohoFirstRows() {
        var q = (document.getElementById('zfSearch').value || '').toLowerCase().trim();
        return zfRows.filter(function(r) {
            if (zfFilter === 'unmatched' && r.status !== 'unmatched') return false;
            if (zfFilter === 'changed'   && !r.changed) return false;
            if (zfFilter === 'shared'    && r.status !== 'shared') return false;
            if (zfFilter === 'unchanged' && !(r.status === 'matched' && !r.changed)) return false;
            if (q) {
                return (r.zoho_name || '').toLowerCase().indexOf(q) !== -1 ||
                       (r.zoho_sku  || '').toLowerCase().indexOf(q) !== -1;
            }
            return true;
        });
    }
```

with:

```js
    // Build the search haystack: Zoho name/SKU + any linked DPL product/base/SKU.
    function zfHaystack(r) {
        var parts = [r.zoho_name || '', r.zoho_sku || ''];
        if (r.matched) parts.push(r.matched.product_name, r.matched.base_name, r.matched.canonical_sku);
        if (r.linked_entries) r.linked_entries.forEach(function(e){
            parts.push(e.product_name, e.base_name, e.canonical_sku);
        });
        if (r.proposal) parts.push(r.proposal.product_name, r.proposal.base_name);
        return parts.join(' ').toLowerCase();
    }

    function visibleZohoFirstRows() {
        var q = (document.getElementById('zfSearch').value || '').toLowerCase().trim();
        return zfRows.filter(function(r) {
            if (zfFilter === 'unmatched' && r.status !== 'unmatched') return false;
            if (zfFilter === 'changed'   && !r.changed) return false;
            if (zfFilter === 'shared'    && r.status !== 'shared') return false;
            if (zfFilter === 'unchanged' && !(r.status === 'matched' && !r.changed)) return false;
            if (zfFilter === 'pushable'  && !zfIsPushable(r)) return false;
            if (zfFilter === 'pushed'    && !r.pushed_at) return false;
            if (q) return zfHaystack(r).indexOf(q) !== -1;
            return true;
        });
    }
```

- [ ] **Step 4: Register the new chips in `setZohoFilter`**

Replace the `ids` map line in `setZohoFilter`:

```js
        var ids = { all: 'zffAll', unmatched: 'zffUnmatched', changed: 'zffChanged', shared: 'zffShared', unchanged: 'zffUnchanged' };
```

with:

```js
        var ids = { all: 'zffAll', unmatched: 'zffUnmatched', changed: 'zffChanged', shared: 'zffShared', unchanged: 'zffUnchanged', pushable: 'zffPushable', pushed: 'zffPushed' };
```

- [ ] **Step 5: Verify no regression**

```bash
npx playwright test tests/e2e/admin-dpl-zoho-first.spec.js
```

Expected: existing 4 tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add public/admin-dpl.html
git commit -m "feat(dpl-zoho-first): Pushable/Pushed filters + search over linked DPL fields"
```

---

### Task 4: Frontend — pushable-based push selection + Re-pick (E)

**Files:**
- Modify: `public/admin-dpl.html`

- [ ] **Step 1: Switch push selection from "changed" to "pushable"**

Replace `zfChangedRows`:

```js
    function zfChangedRows() {
        return zfRows.filter(function(r){ return r.changed && r.entry_id != null; });
    }
```

with:

```js
    function zfPushableRows() {
        return zfRows.filter(function(r){ return zfIsPushable(r) && r.entry_id != null; });
    }
```

Then replace `zfSelectedIds`:

```js
    function zfSelectedIds() {
        return zfChangedRows().filter(function(r){ return zfPushSelected[r.entry_id]; })
                              .map(function(r){ return r.entry_id; });
    }
```

with:

```js
    function zfSelectedIds() {
        return zfPushableRows().filter(function(r){ return zfPushSelected[r.entry_id]; })
                               .map(function(r){ return r.entry_id; });
    }
```

- [ ] **Step 2: Make the header check + row checkbox key off pushable**

In `zfToggleHeadCheck`, replace:

```js
        visibleZohoFirstRows().forEach(function(r){
            if (r.changed && r.entry_id != null) {
```

with:

```js
        visibleZohoFirstRows().forEach(function(r){
            if (zfIsPushable(r) && r.entry_id != null) {
```

In `renderZohoFirst`, replace the row-checkbox guard:

```js
            var chk = (r.changed && r.entry_id != null)
```

with:

```js
            var chk = (zfIsPushable(r) && r.entry_id != null)
```

- [ ] **Step 3: Default-select pushable rows on load**

In `loadZohoFirst`, replace:

```js
            var keep = {};
            zfRows.forEach(function(r){
                if (r.changed && r.entry_id != null) keep[r.entry_id] = true;
            });
            zfPushSelected = keep;
```

with:

```js
            var keep = {};
            zfRows.forEach(function(r){
                if (zfIsPushable(r) && r.entry_id != null) keep[r.entry_id] = true;
            });
            zfPushSelected = keep;
```

- [ ] **Step 4: Add the Re-pick button to matched rows**

Replace `zfRowActions`:

```js
    function zfRowActions(r) {
        var idAttr = esc(r.zoho_item_id);
        return '<div class="mt-1 flex flex-wrap gap-1">' +
            '<button onclick="openZfEdit(\'' + idAttr + '\')" class="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-700 hover:bg-gray-200">✏ Edit</button>' +
            '<button onclick="pushZfItem(\'' + idAttr + '\')" class="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-600 text-white hover:bg-indigo-700">⬆ Push</button>' +
            '</div>';
    }
```

with (adds 🔄 Re-pick on matched rows; opens the existing attach picker):

```js
    function zfRowActions(r) {
        var idAttr = esc(r.zoho_item_id);
        var repick = (r.status === 'matched')
            ? '<button onclick="openAttachPicker(\'' + idAttr + '\')" class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700 hover:bg-amber-200" title="Swap this Zoho item to a different DPL entry">🔄 Re-pick</button>'
            : '';
        return '<div class="mt-1 flex flex-wrap gap-1">' +
            '<button onclick="openZfEdit(\'' + idAttr + '\')" class="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-700 hover:bg-gray-200">✏ Edit</button>' +
            '<button onclick="pushZfItem(\'' + idAttr + '\')" class="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-600 text-white hover:bg-indigo-700">⬆ Push</button>' +
            repick +
            '</div>';
    }
```

- [ ] **Step 5: Make `attachDpl` re-pick-aware (detach old, then link new)**

Replace `attachDpl`:

```js
    async function attachDpl(entryId) {
        if (!zfAttachItemId) return;
        try {
            var resp = await fetch('/api/zoho/items/dpl-catalog/entry/' + entryId + '/confirm-link', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ zoho_item_id: zfAttachItemId })
            });
            var body = await resp.json();
            if (!resp.ok || !body.success) throw new Error(body.message || ('Server error ' + resp.status));
            showToast('DPL attached', 'success');
            closeAttachPicker();
            await loadZohoFirst();
        } catch (err) {
            showToast('Attach error: ' + err.message, 'error');
        }
    }
```

with:

```js
    async function attachDpl(entryId) {
        if (!zfAttachItemId) return;
        try {
            // Re-pick: if this Zoho item already links a different DPL entry, detach the
            // old one (→ not-in-zoho) first so attaching the new one doesn't make it shared.
            var row = zfRows.find(function(r){ return String(r.zoho_item_id) === String(zfAttachItemId); });
            var oldEntryId = row && row.entry_id != null ? row.entry_id : null;
            if (oldEntryId != null && Number(oldEntryId) !== Number(entryId)) {
                var dResp = await fetch('/api/zoho/items/dpl-catalog/entry/' + oldEntryId + '/not-in-zoho', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' },
                    body: JSON.stringify({ value: true })
                });
                var dBody = await dResp.json();
                if (!dResp.ok || !dBody.success) throw new Error(dBody.message || ('Server error ' + dResp.status));
            }
            var resp = await fetch('/api/zoho/items/dpl-catalog/entry/' + entryId + '/confirm-link', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ zoho_item_id: zfAttachItemId })
            });
            var body = await resp.json();
            if (!resp.ok || !body.success) throw new Error(body.message || ('Server error ' + resp.status));
            showToast(oldEntryId != null ? 'DPL re-picked' : 'DPL attached', 'success');
            closeAttachPicker();
            await loadZohoFirst();
        } catch (err) {
            showToast('Attach error: ' + err.message, 'error');
        }
    }
```

- [ ] **Step 6: Verify no regression**

```bash
npx playwright test tests/e2e/admin-dpl-zoho-first.spec.js
```

Expected: existing 4 tests still PASS. Note: round-1 tests seed `zfPushSelected = {11:true}`
and Z1 is matched with `new_dpl 2180 > 0` and no `pushed_at` → pushable, so the push
button stays enabled exactly as before.

- [ ] **Step 7: Commit**

```bash
git add public/admin-dpl.html
git commit -m "feat(dpl-zoho-first): pushable-based push selection + Re-pick linked DPL"
```

---

### Task 5: E2E coverage for the parity features + full run

**Files:**
- Modify: `tests/e2e/admin-dpl-zoho-first.spec.js`

- [ ] **Step 1: Append an e2e test for pushed chip, Pushable filter, DPL search, SKU ⚠, Re-pick**

Append to `tests/e2e/admin-dpl-zoho-first.spec.js` (before the final newline):

```js
test('pushed chip, pushable filter, DPL-name search, SKU conflict, re-pick button', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.route('**/universal-nav-loader.js', r => r.abort());
    await page.addInitScript(() => {
        window.requireAdminOrRedirect = function () {};
        window.getToken = function () { return 'test'; };
    });
    await page.goto(pageUrl).catch(() => {});

    const res = await page.evaluate(() => {
        window.zfRows = [
            // matched, never pushed, pushable, has linked DPL "Pure Elegance"
            { zoho_item_id: 'Z1', zoho_name: 'BIRLA OPUS A 4L', zoho_sku: 'WPRC4', category: 'Interior',
              old_dpl: 2050, old_rate: 2660, entry_id: 11, new_dpl: 2180, new_rate: 2830, diff: 130,
              status: 'matched', changed: true, shared_count: 0, proposal: null,
              matched: { entry_id: 11, product_name: 'Pure Elegance', base_name: 'White', dpl_size_label: '3.6L', canonical_sku: 'WPRC4' },
              linked_entries: null, pushed_at: null, pushed_job_id: null, pushed_dpl: null, push_changed: false, sku_conflict: 'DUP ITEM' },
            // matched, already pushed, no change → ✅ pushed chip, NOT pushable
            { zoho_item_id: 'Z3', zoho_name: 'BIRLA OPUS B 10L', zoho_sku: 'ADSS10', category: 'Exterior',
              old_dpl: 4100, old_rate: 5322, entry_id: 13, new_dpl: 4100, new_rate: 5322, diff: 0,
              status: 'matched', changed: false, shared_count: 0, proposal: null,
              matched: { entry_id: 13, product_name: 'Weather Coat', base_name: 'Clear', dpl_size_label: '9L', canonical_sku: 'ADSS10' },
              linked_entries: null, pushed_at: '2026-06-01 10:00:00', pushed_job_id: 9, pushed_dpl: 4100, push_changed: false, sku_conflict: null },
        ];
        window.zfUnlinked = [];

        const panel = document.getElementById('catalogPanel');
        if (panel) panel.classList.remove('hidden');
        document.getElementById('zohoFirstView').classList.remove('hidden');
        window.zfPushSelected = { 11: true };
        window.renderZohoFirst();

        const tableHtml = document.getElementById('zohoFirstTableBody').innerHTML;

        // Pushable filter → only Z1 (Z3 is pushed+unchanged, not pushable).
        window.setZohoFilter('pushable');
        const pushableRows = document.querySelectorAll('#zohoFirstTableBody tr').length;
        const pushableFirst = document.querySelectorAll('#zohoFirstTableBody tr')[0];

        // Pushed filter → only Z3.
        window.setZohoFilter('pushed');
        const pushedRows = document.querySelectorAll('#zohoFirstTableBody tr').length;
        const pushedFirst = document.querySelectorAll('#zohoFirstTableBody tr')[0];

        // Search by a linked DPL product name → matches Z1 only.
        window.setZohoFilter('all');
        document.getElementById('zfSearch').value = 'pure elegance';
        window.renderZohoFirst();
        const searchRows = document.querySelectorAll('#zohoFirstTableBody tr').length;
        const searchFirst = document.querySelectorAll('#zohoFirstTableBody tr')[0];

        return {
            hasPushedChip: tableHtml.indexOf('✅ pushed') !== -1,
            hasSkuConflict: tableHtml.indexOf('SKU also used by: DUP ITEM') !== -1,
            hasRepick: tableHtml.indexOf('Re-pick') !== -1,
            pushableRows,
            pushableFirstText: pushableFirst ? pushableFirst.textContent : '',
            pushedRows,
            pushedFirstText: pushedFirst ? pushedFirst.textContent : '',
            searchRows,
            searchFirstText: searchFirst ? searchFirst.textContent : '',
        };
    });

    expect(pageErrors).toEqual([]);
    expect(res.hasPushedChip).toBe(true);                  // Z3 shows ✅ pushed
    expect(res.hasSkuConflict).toBe(true);                 // Z1 SKU conflict ⚠ tooltip
    expect(res.hasRepick).toBe(true);                      // matched rows have 🔄 Re-pick
    expect(res.pushableRows).toBe(1);                      // only Z1 pushable
    expect(res.pushableFirstText).toContain('BIRLA OPUS A 4L');
    expect(res.pushedRows).toBe(1);                        // only Z3 pushed
    expect(res.pushedFirstText).toContain('BIRLA OPUS B 10L');
    expect(res.searchRows).toBe(1);                        // DPL-name search hits Z1
    expect(res.searchFirstText).toContain('BIRLA OPUS A 4L');
});
```

- [ ] **Step 2: Run the Zoho-first e2e suite**

```bash
npx playwright test tests/e2e/admin-dpl-zoho-first.spec.js
```

Expected: all 5 tests PASS, zero `pageerror`.

- [ ] **Step 3: Run the unit suite + lint**

```bash
npx jest tests/unit/dpl-catalog-zoho-first.test.js --no-coverage
npm run lint
```

Expected: unit tests PASS; lint clean on touched files.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/admin-dpl-zoho-first.spec.js
git commit -m "test(dpl-zoho-first): e2e for pushed chip, pushable/pushed filters, DPL search, SKU conflict, re-pick"
```

---

## Self-review notes

- **Spec coverage:** A (pushed badge) → Task 1 (data) + Task 2 (chip). B (filters) →
  Task 3. C (search) → Task 3. D (SKU conflict) → Task 1 (route + data) + Task 2 (cell).
  E (re-pick) → Task 4. Pushable-based selection → Task 4. Tests → Task 1 (unit) + Task 5 (e2e).
- **Pending filter:** intentionally omitted per spec (no meaning in the Zoho-anchored view).
- **No new endpoints:** re-pick = `not-in-zoho` (old) + `confirm-link` (new); pushed data
  is read-only. Confirmed against `routes/zoho.js`.
- **Type consistency:** new row fields `pushed_at / pushed_job_id / pushed_dpl /
  push_changed / sku_conflict`; helpers `zfIsPushable`, `zfPushableRows` (replaces
  `zfChangedRows`), `zfSelectedIds` (now pushable-based), `zfPushedChip`, `zfSkuCell`,
  `zfHaystack` — used identically across tasks. Filter ids `zffPushable`/`zffPushed`
  match markup + `setZohoFilter` map.
- **Round-1 e2e:** still green — seeded row Z1 is matched, `new_dpl>0`, not pushed →
  pushable, so `zfPushSelected={11:true}` keeps the push button enabled as the existing
  assertions expect.
