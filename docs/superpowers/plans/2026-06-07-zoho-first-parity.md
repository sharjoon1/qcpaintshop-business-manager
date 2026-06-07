# Zoho-first Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Build-Catalog "Zoho-first" view in `public/admin-dpl.html` to parity with DPL-first — show the linked DPL product on matched rows, let shared rows be resolved, show category, add stat chips, and make bulk push respect per-row selection.

**Architecture:** A pure backend helper (`buildZohoFirstView`) already inverts the catalog into one row per active Zoho item; we enrich each matched/shared row with the linked DPL entry detail (no route or SQL change). The frontend (`admin-dpl.html`, window-global functions) then renders a new "Linked DPL product" column + category line, an expandable shared-row resolver that reuses the existing `not-in-zoho` endpoint, two new stat chips, and per-row push checkboxes wired into the existing `…/push {ids}` endpoint.

**Tech Stack:** Node.js, Express, MySQL (`mysql2/promise`) — backend untouched at route level; vanilla JS + Tailwind in `public/admin-dpl.html`; Jest unit tests; Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-06-07-zoho-first-parity-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `services/dpl-catalog.js` | Modify `buildZohoFirstView` | Add `matched` block (1-link) + `linked_entries[]` (shared) to each row |
| `tests/unit/dpl-catalog-zoho-first.test.js` | Modify | Assert the new `matched` / `linked_entries` fields |
| `public/admin-dpl.html` | Modify | Zoho-first: Linked-DPL column, category, shared resolver, stat chips, push checkboxes |
| `tests/e2e/admin-dpl-zoho-first.spec.js` | Modify | Smoke the linked-DPL column, shared detach, checkbox-driven push |

**Important — editing `admin-dpl.html`:** it is a 5,200-line file. Use the unique
anchor strings quoted in each step (not line numbers) when locating edit points; line
numbers shift as you edit.

---

### Task 1: Backend — enrich `buildZohoFirstView` rows with linked DPL detail

**Files:**
- Modify: `services/dpl-catalog.js` (`buildZohoFirstView`, ~line 575)
- Test: `tests/unit/dpl-catalog-zoho-first.test.js`

- [ ] **Step 1: Add failing unit assertions**

In `tests/unit/dpl-catalog-zoho-first.test.js`, inside the
`describe('buildZohoFirstView', …)` block (after the existing
`'Zoho item linked by >1 entry is shared…'` test, around line 63), add:

```js
    test('matched row carries a matched block with the linked DPL entry detail', () => {
        const r = rows.find(x => x.zoho_item_id === 'Z1');
        expect(r.matched).toMatchObject({
            entry_id: 11,
            product_name: 'A',
            base_name: 'White',
            dpl_size_label: '3.6L',
            canonical_sku: 'WPRC4',
        });
        expect(r.linked_entries).toBeNull();
    });

    test('shared row carries linked_entries for every colliding entry', () => {
        const r = rows.find(x => x.zoho_item_id === 'Z4');
        expect(r.matched).toBeNull();
        expect(Array.isArray(r.linked_entries)).toBe(true);
        expect(r.linked_entries).toHaveLength(2);
        expect(r.linked_entries[0]).toMatchObject({
            entry_id: 14, product_name: 'C', base_name: 'White',
            dpl_size_label: '18L', canonical_sku: 'XYZ20', current_dpl: 8000,
        });
        expect(r.linked_entries[1]).toMatchObject({ entry_id: 15, current_dpl: 8100 });
    });

    test('unmatched row has matched and linked_entries both null', () => {
        const r = rows.find(x => x.zoho_item_id === 'Z2');
        expect(r.matched).toBeNull();
        expect(r.linked_entries).toBeNull();
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest tests/unit/dpl-catalog-zoho-first.test.js --no-coverage
```

Expected: the three new tests FAIL (`r.matched` is `undefined`), all pre-existing tests still PASS.

- [ ] **Step 3: Enrich the rows in `buildZohoFirstView`**

In `services/dpl-catalog.js`, find the matched/shared branch inside the
`rows = (zohoItems || []).map(zi => { … })` body. Replace this block:

```js
        let status = 'unmatched';
        let entry_id = null, new_dpl = null, new_rate = null, diff = null;
        let changed = false, shared_count = 0;

        if (linked.length === 1) {
            const e = linked[0];
            status = 'matched';
            entry_id = e.id;
            new_dpl = num(e.current_dpl);
            new_rate = num(e.current_rate);
            diff = (new_dpl != null && old_dpl != null) ? round2(new_dpl - old_dpl) : null;
            changed = diff != null && diff !== 0;
        } else if (linked.length > 1) {
            status = 'shared';
            shared_count = linked.length;
        }
```

with:

```js
        let status = 'unmatched';
        let entry_id = null, new_dpl = null, new_rate = null, diff = null;
        let changed = false, shared_count = 0;
        let matched = null, linked_entries = null;

        if (linked.length === 1) {
            const e = linked[0];
            status = 'matched';
            entry_id = e.id;
            new_dpl = num(e.current_dpl);
            new_rate = num(e.current_rate);
            diff = (new_dpl != null && old_dpl != null) ? round2(new_dpl - old_dpl) : null;
            changed = diff != null && diff !== 0;
            matched = {
                entry_id: e.id,
                product_name: e.product_name || '',
                base_name: e.base_name || '',
                dpl_size_label: e.dpl_size_label || '',
                canonical_sku: e.canonical_sku || '',
            };
        } else if (linked.length > 1) {
            status = 'shared';
            shared_count = linked.length;
            linked_entries = linked.map(e => ({
                entry_id: e.id,
                product_name: e.product_name || '',
                base_name: e.base_name || '',
                dpl_size_label: e.dpl_size_label || '',
                canonical_sku: e.canonical_sku || '',
                current_dpl: num(e.current_dpl),
            }));
        }
```

Then add `matched, linked_entries` to the returned row object. Replace:

```js
        return {
            zoho_item_id: zi.zoho_item_id,
            zoho_name: zi.zoho_item_name || '',
            zoho_sku: zi.zoho_sku || '',
            category: zi.zoho_category_name || '',
            old_dpl, old_rate,
            entry_id, new_dpl, new_rate, diff,
            status, changed, shared_count, proposal,
        };
```

with:

```js
        return {
            zoho_item_id: zi.zoho_item_id,
            zoho_name: zi.zoho_item_name || '',
            zoho_sku: zi.zoho_sku || '',
            category: zi.zoho_category_name || '',
            old_dpl, old_rate,
            entry_id, new_dpl, new_rate, diff,
            status, changed, shared_count, proposal,
            matched, linked_entries,
        };
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest tests/unit/dpl-catalog-zoho-first.test.js --no-coverage
```

Expected: ALL tests PASS (existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add services/dpl-catalog.js tests/unit/dpl-catalog-zoho-first.test.js
git commit -m "feat(dpl-catalog): buildZohoFirstView emits matched detail + shared linked_entries"
```

---

### Task 2: Frontend — "Linked DPL product" column + category display (#1, #3)

**Files:**
- Modify: `public/admin-dpl.html`

- [ ] **Step 1: Add the table header column**

Find this Zoho-first table header block (anchor: the `<th>` row inside
`id="zohoFirstTableBody"`'s `<table>`):

```html
                                    <th class="px-2 py-2 text-right">Diff</th>
                                    <th class="px-2 py-2 text-center">Status</th>
```

Replace with:

```html
                                    <th class="px-2 py-2 text-right">Diff</th>
                                    <th class="px-2 py-2 text-left">Linked DPL product</th>
                                    <th class="px-2 py-2 text-center">Status</th>
```

- [ ] **Step 2: Add the linked-DPL cell helper**

Immediately BEFORE `function zfDiffCell(r) {` add this helper. (The `shared`
branch is a simple count for now; Task 3 makes it expandable.)

```js
    // Linked DPL entry detail for a Zoho-first row (symmetric to DPL-first's
    // "Linked Zoho item" column). matched → product · base · size + SKU line.
    function zfLinkedDplCell(r) {
        if (r.status === 'matched' && r.matched) {
            var m = r.matched;
            var head = esc(m.product_name) +
                (m.base_name ? ' · ' + esc(m.base_name) : '') +
                (m.dpl_size_label ? ' · ' + esc(m.dpl_size_label) : '');
            return '<div class="text-gray-700">' + head + '</div>' +
                (m.canonical_sku ? '<div class="text-[10px] font-mono text-gray-400">' + esc(m.canonical_sku) + '</div>' : '');
        }
        if (r.status === 'shared') {
            return '<span class="text-amber-700 font-semibold">' + (r.shared_count || 0) + ' DPL entries</span>';
        }
        return '<span class="text-gray-300">—</span>';
    }
```

- [ ] **Step 3: Render category under the Zoho name + insert the linked-DPL cell (table)**

In `renderZohoFirst`, find the table-row template. Replace:

```js
            return '<tr class="border-t hover:bg-gray-50 align-top">' +
                '<td class="px-2 py-1.5 text-left">' + esc(r.zoho_name) + '</td>' +
                '<td class="px-2 py-1.5 text-left text-gray-500">' + esc(r.zoho_sku) + '</td>' +
                '<td class="px-2 py-1.5 text-right">' + fmtMoney(r.old_dpl) + '</td>' +
                '<td class="px-2 py-1.5 text-right">' + fmtMoney(r.new_dpl) + '</td>' +
                '<td class="px-2 py-1.5 text-right">' + fmtMoney(r.new_rate) + '</td>' +
                '<td class="px-2 py-1.5 text-right">' + zfDiffCell(r) + '</td>' +
                '<td class="px-2 py-1.5 text-center">' + zfStatusChip(r) + zfProposalHtml(r) + zfRowActions(r) + '</td>' +
                '</tr>';
```

with:

```js
            return '<tr class="border-t hover:bg-gray-50 align-top">' +
                '<td class="px-2 py-1.5 text-left"><div>' + esc(r.zoho_name) + '</div>' +
                    (r.category ? '<div class="text-[10px] text-gray-400">' + esc(r.category) + '</div>' : '') + '</td>' +
                '<td class="px-2 py-1.5 text-left text-gray-500">' + esc(r.zoho_sku) + '</td>' +
                '<td class="px-2 py-1.5 text-right">' + fmtMoney(r.old_dpl) + '</td>' +
                '<td class="px-2 py-1.5 text-right">' + fmtMoney(r.new_dpl) + '</td>' +
                '<td class="px-2 py-1.5 text-right">' + fmtMoney(r.new_rate) + '</td>' +
                '<td class="px-2 py-1.5 text-right">' + zfDiffCell(r) + '</td>' +
                '<td class="px-2 py-1.5 text-left">' + zfLinkedDplCell(r) + '</td>' +
                '<td class="px-2 py-1.5 text-center">' + zfStatusChip(r) + zfProposalHtml(r) + zfRowActions(r) + '</td>' +
                '</tr>';
```

- [ ] **Step 4: Add category + linked-DPL line to the mobile card**

In `zfCardHtml`, replace:

```js
        return '<div class="border rounded-lg p-3 bg-white">' +
            '<div class="flex items-start justify-between gap-2">' +
                '<div class="min-w-0"><div class="font-semibold text-gray-800 truncate">' + esc(r.zoho_name) + '</div>' +
                '<div class="text-[10px] font-mono text-gray-400">' + esc(r.zoho_sku) + '</div></div>' +
                zfStatusChip(r) +
            '</div>' +
            '<div class="text-[12px] text-gray-700 mt-1">' + price + ' &nbsp; ' + zfDiffCell(r) + '</div>' +
            zfProposalHtml(r) + zfRowActions(r) +
        '</div>';
```

with:

```js
        return '<div class="border rounded-lg p-3 bg-white">' +
            '<div class="flex items-start justify-between gap-2">' +
                '<div class="min-w-0"><div class="font-semibold text-gray-800 truncate">' + esc(r.zoho_name) + '</div>' +
                '<div class="text-[10px] font-mono text-gray-400">' + esc(r.zoho_sku) +
                    (r.category ? ' · ' + esc(r.category) : '') + '</div></div>' +
                zfStatusChip(r) +
            '</div>' +
            '<div class="text-[12px] text-gray-700 mt-1">' + price + ' &nbsp; ' + zfDiffCell(r) + '</div>' +
            '<div class="text-[11px] mt-1">' + zfLinkedDplCell(r) + '</div>' +
            zfProposalHtml(r) + zfRowActions(r) +
        '</div>';
```

- [ ] **Step 5: Run the existing e2e to confirm nothing regressed**

```bash
npx playwright test tests/e2e/admin-dpl-zoho-first.spec.js
```

Expected: the 3 existing tests still PASS (the new column is additive; existing
assertions use `toContain` and are unaffected).

- [ ] **Step 6: Commit**

```bash
git add public/admin-dpl.html
git commit -m "feat(dpl-zoho-first): Linked DPL product column + category line (table + cards)"
```

---

### Task 3: Frontend — shared-row resolve (#2)

**Files:**
- Modify: `public/admin-dpl.html`

- [ ] **Step 1: Make the shared branch render the colliding entries + detach buttons**

In `zfLinkedDplCell` (added in Task 2), replace the `shared` branch:

```js
        if (r.status === 'shared') {
            return '<span class="text-amber-700 font-semibold">' + (r.shared_count || 0) + ' DPL entries</span>';
        }
```

with:

```js
        if (r.status === 'shared') {
            return zfSharedCell(r);
        }
```

- [ ] **Step 2: Add the `zfSharedCell` helper**

Immediately BEFORE `function zfLinkedDplCell(r) {` add:

```js
    // Shared row: list every colliding DPL entry with a detach action that reuses
    // the existing not-in-zoho endpoint (same mechanism DPL-first uses for dups).
    function zfSharedCell(r) {
        var list = r.linked_entries || [];
        if (!list.length) {
            return '<span class="text-amber-700 font-semibold">' + (r.shared_count || 0) + ' DPL entries</span>';
        }
        var head = '<div class="text-amber-700 font-semibold mb-0.5">⚠ ' + list.length + ' DPL entries share this item</div>';
        var items = list.map(function(e) {
            var label = esc(e.product_name) +
                (e.base_name ? ' · ' + esc(e.base_name) : '') +
                (e.dpl_size_label ? ' · ' + esc(e.dpl_size_label) : '') +
                ' · ' + fmtMoney(e.current_dpl);
            return '<div class="flex items-center justify-between gap-2 py-0.5">' +
                '<span class="text-[10px] text-gray-700 min-w-0">' + label + '</span>' +
                '<button onclick="zfDetachEntry(' + Number(e.entry_id) + ')" ' +
                    'class="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 hover:bg-rose-200" ' +
                    'title="Unlink this DPL entry and mark it for creation">🚫 Not in Zoho</button>' +
            '</div>';
        }).join('');
        return head + items;
    }
```

- [ ] **Step 3: Add the `zfDetachEntry` action**

Immediately BEFORE `async function acceptProposal(zohoItemId, entryId) {` add:

```js
    // Detach one colliding DPL entry from a shared Zoho item: marks it "not in Zoho"
    // (pending creation) via the existing endpoint, then refreshes the Zoho-first view.
    async function zfDetachEntry(entryId) {
        if (!confirm('Unlink this DPL entry from the shared Zoho item and mark it "not in Zoho"?')) return;
        try {
            var resp = await fetch('/api/zoho/items/dpl-catalog/entry/' + entryId + '/not-in-zoho', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ value: true })
            });
            var body = await resp.json();
            if (!resp.ok || !body.success) throw new Error(body.message || ('Server error ' + resp.status));
            showToast('Detached DPL entry', 'success');
            await loadZohoFirst();
        } catch (err) {
            showToast('Detach error: ' + err.message, 'error');
        }
    }
```

- [ ] **Step 4: Verify no JS syntax error by loading the page in the e2e harness**

```bash
npx playwright test tests/e2e/admin-dpl-zoho-first.spec.js
```

Expected: existing tests still PASS (the shared branch is only reached by shared rows,
which the existing fixtures don't include — so this is a no-regression check that the
new functions parse with no `pageerror`).

- [ ] **Step 5: Commit**

```bash
git add public/admin-dpl.html
git commit -m "feat(dpl-zoho-first): expandable shared-row resolver with per-entry detach"
```

---

### Task 4: Frontend — stat chips (#4) + per-row push selection (#5)

**Files:**
- Modify: `public/admin-dpl.html`

- [ ] **Step 1: Add the two stat chips + a header checkbox column**

Find the Zoho-first stat strip (anchor: `id="zfTotal"`):

```html
                            <span class="px-2 py-1 rounded bg-gray-100 text-gray-700">Zoho items: <b id="zfTotal">0</b></span>
                            <span class="px-2 py-1 rounded bg-rose-100 text-rose-700">⚠ No match: <b id="zfUnmatched">0</b></span>
                            <span class="px-2 py-1 rounded bg-amber-100 text-amber-700">↕ Changed: <b id="zfChanged">0</b></span>
```

Replace with:

```html
                            <span class="px-2 py-1 rounded bg-gray-100 text-gray-700">Zoho items: <b id="zfTotal">0</b></span>
                            <span class="px-2 py-1 rounded bg-rose-100 text-rose-700">⚠ No match: <b id="zfUnmatched">0</b></span>
                            <span class="px-2 py-1 rounded bg-amber-100 text-amber-700">↕ Changed: <b id="zfChanged">0</b></span>
                            <span class="px-2 py-1 rounded bg-orange-100 text-orange-700">⚠ Shared: <b id="zfShared">0</b></span>
                            <span class="px-2 py-1 rounded bg-green-100 text-green-700">✓ Unchanged: <b id="zfUnchanged">0</b></span>
```

Then find the Zoho-first table header row and replace:

```html
                                <tr>
                                    <th class="px-2 py-2 text-left">Zoho item</th>
```

with (adds a leading checkbox column header):

```html
                                <tr>
                                    <th class="px-2 py-2 text-center"><input type="checkbox" id="zfHeadCheck" onclick="zfToggleHeadCheck(this)" aria-label="Select all visible changed rows"></th>
                                    <th class="px-2 py-2 text-left">Zoho item</th>
```

- [ ] **Step 2: Add selection state + helpers**

Find the line `var zfPushInFlight = {};` and add immediately above it:

```js
    var zfPushSelected = {};   // entry_id → true, for changed rows queued to push
    // A changed, pushable row carries an entry_id.
    function zfChangedRows() {
        return zfRows.filter(function(r){ return r.changed && r.entry_id != null; });
    }
    function zfSelectedIds() {
        return zfChangedRows().filter(function(r){ return zfPushSelected[r.entry_id]; })
                              .map(function(r){ return r.entry_id; });
    }
    function zfTogglePush(entryId, checked) {
        if (checked) zfPushSelected[entryId] = true;
        else delete zfPushSelected[entryId];
        zfRefreshPushBtn();
    }
    function zfToggleHeadCheck(cb) {
        // Toggle every VISIBLE changed row.
        visibleZohoFirstRows().forEach(function(r){
            if (r.changed && r.entry_id != null) {
                if (cb.checked) zfPushSelected[r.entry_id] = true;
                else delete zfPushSelected[r.entry_id];
            }
        });
        renderZohoFirst();
    }
    function zfRefreshPushBtn() {
        var n = zfSelectedIds().length;
        document.getElementById('zfPushCount').textContent = n;
        document.getElementById('zfPushBtn').disabled = n === 0;
    }
```

- [ ] **Step 3: Render a checkbox cell per row + keep selection reconciled in `loadZohoFirst`**

In `renderZohoFirst`, the stat block currently reads:

```js
        var unmatched = zfRows.filter(function(r){ return r.status === 'unmatched'; }).length;
        var changed   = zfRows.filter(function(r){ return r.changed; });
        document.getElementById('zfTotal').textContent = zfRows.length;
        document.getElementById('zfUnmatched').textContent = unmatched;
        document.getElementById('zfChanged').textContent = changed.length;
        document.getElementById('zfShowing').textContent = visible.length + ' of ' + zfRows.length;

        document.getElementById('zfPushCount').textContent = changed.length;
        document.getElementById('zfPushBtn').disabled = changed.length === 0;
```

Replace with:

```js
        var unmatched = zfRows.filter(function(r){ return r.status === 'unmatched'; }).length;
        var shared    = zfRows.filter(function(r){ return r.status === 'shared'; }).length;
        var unchanged = zfRows.filter(function(r){ return r.status === 'matched' && !r.changed; }).length;
        var changed   = zfRows.filter(function(r){ return r.changed; });
        document.getElementById('zfTotal').textContent = zfRows.length;
        document.getElementById('zfUnmatched').textContent = unmatched;
        document.getElementById('zfChanged').textContent = changed.length;
        document.getElementById('zfShared').textContent = shared;
        document.getElementById('zfUnchanged').textContent = unchanged;
        document.getElementById('zfShowing').textContent = visible.length + ' of ' + zfRows.length;

        zfRefreshPushBtn();
```

Then in the same function, update the table-row template to prepend a checkbox cell.
Replace:

```js
            return '<tr class="border-t hover:bg-gray-50 align-top">' +
                '<td class="px-2 py-1.5 text-left"><div>' + esc(r.zoho_name) + '</div>' +
```

with:

```js
            var chk = (r.changed && r.entry_id != null)
                ? '<input type="checkbox" onchange="zfTogglePush(' + Number(r.entry_id) + ', this.checked)"' + (zfPushSelected[r.entry_id] ? ' checked' : '') + ' aria-label="Queue this row for push">'
                : '';
            return '<tr class="border-t hover:bg-gray-50 align-top">' +
                '<td class="px-2 py-1.5 text-center">' + chk + '</td>' +
                '<td class="px-2 py-1.5 text-left"><div>' + esc(r.zoho_name) + '</div>' +
```

- [ ] **Step 4: Default-select changed rows on load + reconcile stale selection**

Replace the body of `loadZohoFirst`:

```js
            zfRows = (body.data && body.data.rows) || [];
            zfUnlinked = (body.data && body.data.unlinkedEntries) || [];
            renderZohoFirst();
```

with:

```js
            zfRows = (body.data && body.data.rows) || [];
            zfUnlinked = (body.data && body.data.unlinkedEntries) || [];
            // Default: every changed row selected (preserves the old "push all changed"
            // behavior); drop selections for entries that are no longer changed.
            var keep = {};
            zfRows.forEach(function(r){
                if (r.changed && r.entry_id != null) keep[r.entry_id] = true;
            });
            zfPushSelected = keep;
            renderZohoFirst();
```

- [ ] **Step 5: Make the bulk push use the selected ids**

Replace the head of `pushZohoFirstChanged`:

```js
    async function pushZohoFirstChanged() {
        var ids = zfRows.filter(function(r){ return r.changed && r.entry_id != null; })
                        .map(function(r){ return r.entry_id; });
        if (!ids.length) return;
```

with:

```js
    async function pushZohoFirstChanged() {
        var ids = zfSelectedIds();
        if (!ids.length) return;
```

- [ ] **Step 6: Run the e2e suite**

```bash
npx playwright test tests/e2e/admin-dpl-zoho-first.spec.js
```

Expected: existing tests still PASS. The first test asserts `pushDisabled === false`
with one changed row — with default-select-all that row is auto-selected, so the push
button stays enabled. (If a later assertion counts table columns it will be updated in
Task 5; the current fixtures use `toContain`, unaffected.)

- [ ] **Step 7: Commit**

```bash
git add public/admin-dpl.html
git commit -m "feat(dpl-zoho-first): Shared/Unchanged stat chips + per-row push selection"
```

---

### Task 5: E2E coverage for the new behaviors + full test run

**Files:**
- Modify: `tests/e2e/admin-dpl-zoho-first.spec.js`

- [ ] **Step 1: Add an e2e test for the linked-DPL column, shared detach, and checkbox push**

Append to `tests/e2e/admin-dpl-zoho-first.spec.js` (before the final newline):

```js
test('linked DPL column, shared resolver, and checkbox-driven push', async ({ page }) => {
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
            { zoho_item_id: 'Z1', zoho_name: 'BIRLA OPUS A 4L', zoho_sku: 'WPRC4', category: 'Interior',
              old_dpl: 2050, old_rate: 2660, entry_id: 11, new_dpl: 2180, new_rate: 2830, diff: 130,
              status: 'matched', changed: true, shared_count: 0, proposal: null,
              matched: { entry_id: 11, product_name: 'Pure Elegance', base_name: 'White', dpl_size_label: '3.6L', canonical_sku: 'WPRC4' },
              linked_entries: null },
            { zoho_item_id: 'Z4', zoho_name: 'BIRLA OPUS C 20L', zoho_sku: 'XYZ20', category: 'Exterior',
              old_dpl: 8000, old_rate: 10380, entry_id: null, new_dpl: null, new_rate: null, diff: null,
              status: 'shared', changed: false, shared_count: 2, proposal: null, matched: null,
              linked_entries: [
                { entry_id: 14, product_name: 'C', base_name: 'White',  dpl_size_label: '18L', canonical_sku: 'XYZ20',  current_dpl: 8000 },
                { entry_id: 15, product_name: 'C', base_name: 'Pastel', dpl_size_label: '18L', canonical_sku: 'XYZ20B', current_dpl: 8100 },
              ] },
        ];
        window.zfUnlinked = [];

        const panel = document.getElementById('catalogPanel');
        if (panel) panel.classList.remove('hidden');
        document.getElementById('zohoFirstView').classList.remove('hidden');
        // Simulate loadZohoFirst's default selection (changed rows auto-selected).
        window.zfPushSelected = { 11: true };
        window.renderZohoFirst();

        const tableHtml = document.getElementById('zohoFirstTableBody').innerHTML;
        const sharedText = document.getElementById('zohoFirstTableBody').textContent;
        const pushCountBefore = document.getElementById('zfPushCount').textContent;
        const pushDisabledBefore = document.getElementById('zfPushBtn').disabled;

        // Deselect the only changed row via its checkbox handler.
        window.zfTogglePush(11, false);
        const pushCountAfter = document.getElementById('zfPushCount').textContent;
        const pushDisabledAfter = document.getElementById('zfPushBtn').disabled;

        return {
            hasLinkedProduct: tableHtml.indexOf('Pure Elegance') !== -1,
            hasCategory: tableHtml.indexOf('Interior') !== -1,
            hasDetachBtn: tableHtml.indexOf('Not in Zoho') !== -1,
            sharedSummary: sharedText.indexOf('DPL entries share this item') !== -1,
            sharedCount: document.getElementById('zfShared').textContent,
            unchangedCount: document.getElementById('zfUnchanged').textContent,
            pushCountBefore, pushDisabledBefore,
            pushCountAfter, pushDisabledAfter,
        };
    });

    expect(pageErrors).toEqual([]);
    expect(res.hasLinkedProduct).toBe(true);   // matched row shows the DPL product name
    expect(res.hasCategory).toBe(true);        // category rendered
    expect(res.hasDetachBtn).toBe(true);       // shared row detach button
    expect(res.sharedSummary).toBe(true);      // shared resolver header
    expect(res.sharedCount).toBe('1');         // one shared row
    expect(res.unchangedCount).toBe('0');      // no unchanged matched rows here
    expect(res.pushCountBefore).toBe('1');     // changed row pre-selected
    expect(res.pushDisabledBefore).toBe(false);
    expect(res.pushCountAfter).toBe('0');      // deselected → count 0
    expect(res.pushDisabledAfter).toBe(true);  // → push disabled
});
```

- [ ] **Step 2: Run the Zoho-first e2e suite**

```bash
npx playwright test tests/e2e/admin-dpl-zoho-first.spec.js
```

Expected: all 4 tests PASS, zero `pageerror`.

- [ ] **Step 3: Run the unit suite + lint**

```bash
npx jest tests/unit/dpl-catalog-zoho-first.test.js --no-coverage
npm run lint
```

Expected: all unit tests PASS; lint clean (or no new warnings on touched files).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/admin-dpl-zoho-first.spec.js
git commit -m "test(dpl-zoho-first): e2e for linked DPL column, shared detach, checkbox push"
```

---

## Self-review notes

- **Spec coverage:** #1 Linked DPL product → Task 1 (data) + Task 2 (column). #2 Shared
  resolve → Task 1 (`linked_entries`) + Task 3. #3 Category → Task 2. #4 Stats → Task 4
  Step 1/3. #5 Bulk parity → Task 4 Steps 1–5. Tests → Task 1 (unit) + Task 5 (e2e).
- **No new endpoints:** detach reuses `…/entry/:id/not-in-zoho`; push reuses
  `…/:brand/push {ids}`; link/accept untouched. Confirmed against `routes/zoho.js`.
- **Type consistency:** `matched` (object|null), `linked_entries` (array|null),
  `zfPushSelected` (entry_id→bool), `zfSelectedIds()`, `zfChangedRows()`,
  `zfRefreshPushBtn()`, `zfToggleHeadCheck()`, `zfTogglePush()`, `zfSharedCell()`,
  `zfLinkedDplCell()`, `zfDetachEntry()` — names used identically across tasks.
- **Column count:** after Task 2 (+Linked DPL) and Task 4 (+checkbox) the table has 9
  columns; no `colspan` is used in the Zoho-first table body, so no other cell needs
  updating.
