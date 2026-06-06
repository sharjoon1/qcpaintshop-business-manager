# Zoho-First Edit Zoho Item + Per-Row Push Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user edit a real Zoho item's Name/SKU/Description/DPL (rate auto-derived) from each Zoho-first row — saved locally to `zoho_items_map` — and push that single item to Zoho with a per-row button.

**Architecture:** A pure `computeZohoRate(dpl)` helper in `services/dpl-catalog.js`. Two thin endpoints in `routes/zoho.js`: `PUT /items/zoho-item/:id` (local update of `zoho_items_map`, rate computed server-side) and `POST /items/zoho-item/:id/push` (reuses the existing `createBulkEditJob` push path — which already guards SKU conflicts). Frontend adds an edit sheet (`#zfEditModal`) + per-row ✏ Edit / ⬆ Push buttons to the Zoho-first view.

**Tech Stack:** Node.js, Express, MySQL (`mysql2/promise`), Jest, Playwright, vanilla JS, Tailwind (admin indigo `#667eea`).

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `services/dpl-catalog.js` | Modify | Add pure `computeZohoRate(dpl)` + export |
| `tests/unit/dpl-catalog-zoho-first.test.js` | Modify | Unit tests for `computeZohoRate` |
| `routes/zoho.js` | Modify | `PUT /items/zoho-item/:id` + `POST /items/zoho-item/:id/push` |
| `public/admin-dpl.html` | Modify | Edit sheet, row/card ✏ Edit + ⬆ Push, edit/push JS |
| `tests/e2e/admin-dpl-zoho-first.spec.js` | Modify | E2E: edit sheet opens prefilled, rate preview, Push button present |

---

### Task 1: Pure helper `computeZohoRate` (TDD)

**Files:**
- Modify: `services/dpl-catalog.js` (add function before `module.exports`; add to exports)
- Modify: `tests/unit/dpl-catalog-zoho-first.test.js` (add a new `describe` block)

- [ ] **Step 1: Write the failing tests**

In `tests/unit/dpl-catalog-zoho-first.test.js`, add at the END of the file:

```js
const { computeZohoRate } = require('../../services/dpl-catalog');

describe('computeZohoRate', () => {
    test('DPL 100 → 130 (ceil(100*1.18*1.10))', () => {
        expect(computeZohoRate(100)).toBe(130); // 129.8 → 130
    });
    test('DPL 500 → 649', () => {
        expect(computeZohoRate(500)).toBe(649); // 649.0 → 649
    });
    test('accepts numeric strings', () => {
        expect(computeZohoRate('500')).toBe(649);
    });
    test('DPL 0 → 0', () => {
        expect(computeZohoRate(0)).toBe(0);
    });
    test('null / non-numeric → 0', () => {
        expect(computeZohoRate(null)).toBe(0);
        expect(computeZohoRate('abc')).toBe(0);
        expect(computeZohoRate(undefined)).toBe(0);
    });
    test('negative → 0', () => {
        expect(computeZohoRate(-50)).toBe(0);
    });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx jest tests/unit/dpl-catalog-zoho-first.test.js --no-coverage
```

Expected: the `computeZohoRate` tests FAIL with `computeZohoRate is not a function`. Existing tests still pass.

- [ ] **Step 3: Implement the helper**

In `services/dpl-catalog.js`, add immediately **before** the `module.exports = {` line:

```js
// Selling rate from DPL: ceil(dpl × 1.18 GST × 1.10 markup), to a whole rupee.
// Returns 0 for non-positive / non-numeric input (so callers never push NaN).
function computeZohoRate(dpl) {
    const d = parseFloat(dpl);
    return Number.isFinite(d) && d > 0 ? Math.ceil(d * 1.18 * 1.10) : 0;
}
```

Add `computeZohoRate` to the `module.exports` object. Change:

```js
    updateAppliedPrices, updateCanonicalFields, markPushed, setNotInZoho,
    buildZohoFirstView, proposeDplForZoho,
};
```

to:

```js
    updateAppliedPrices, updateCanonicalFields, markPushed, setNotInZoho,
    buildZohoFirstView, proposeDplForZoho, computeZohoRate,
};
```

- [ ] **Step 4: Run to verify pass**

```bash
npx jest tests/unit/dpl-catalog-zoho-first.test.js --no-coverage
```

Expected: all pass (existing + 6 new `computeZohoRate` tests).

- [ ] **Step 5: Commit**

```bash
git add services/dpl-catalog.js tests/unit/dpl-catalog-zoho-first.test.js
git commit -m "feat(dpl-catalog): computeZohoRate helper (ceil dpl*1.18*1.10)"
```

---

### Task 2: Edit + Push endpoints (`routes/zoho.js`)

**Files:**
- Modify: `routes/zoho.js` (insert two routes after the `POST /items/dpl-catalog/:brand/push` handler — i.e. after its closing `});`, before the next route)

Context for the implementer: `createBulkEditJob(items, user)` is a function defined later in `routes/zoho.js` (around line 3131). Because of function-declaration hoisting it is callable from your new route. Each item it expects is `{ zoho_item_id, item_name, changes }` where `changes` is a non-empty object (e.g. `{ cf_dpl, purchase_rate, rate, name, sku, description }`). `createBulkEditJob` ALREADY guards SKU conflicts (both within the batch and against other active items in the local mirror) and throws an `Error` with an `httpStatus` property on conflict — so the push route does NOT need its own SKU check; it just propagates `err.httpStatus`. `dplCatalogService` is already required at the top of the file; `computeZohoRate` is now exported from it (Task 1).

- [ ] **Step 1: Find the insertion point**

In `routes/zoho.js`, find the `POST /items/dpl-catalog/:brand/push` handler (its first line is `router.post('/items/dpl-catalog/:brand/push', requirePermission('zoho', 'manage'), async (req, res) => {`). Scroll to its closing `});`. Insert the new routes immediately after that closing `});`.

- [ ] **Step 2: Add the two endpoints**

Insert exactly:

```js
// Edit a single Zoho item's details LOCALLY (zoho_items_map only — no Zoho write).
// Body: { name?, sku?, description?, dpl? }. When dpl is given, the selling rate is
// recomputed server-side. Pushing to Zoho is a separate step (see /push below).
router.put('/items/zoho-item/:id', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const id = String(req.params.id || '');
        if (!id) return res.status(400).json({ success: false, message: 'Invalid item id' });

        const body = req.body || {};
        const sets = [];
        const vals = [];
        if (body.name !== undefined)        { sets.push('zoho_item_name = ?'); vals.push(String(body.name).trim()); }
        if (body.sku !== undefined)         { sets.push('zoho_sku = ?');       vals.push(String(body.sku).trim()); }
        if (body.description !== undefined) { sets.push('zoho_description = ?'); vals.push(String(body.description).trim()); }

        let rate = null;
        if (body.dpl !== undefined) {
            const dpl = parseFloat(body.dpl);
            if (!Number.isFinite(dpl) || dpl < 0 || dpl > 100000) {
                return res.status(400).json({ success: false, message: 'dpl must be a number between 0 and 100000' });
            }
            rate = dplCatalogService.computeZohoRate(dpl);
            sets.push('zoho_cf_dpl = ?'); vals.push(dpl);
            sets.push('zoho_rate = ?');   vals.push(rate);
        }

        if (!sets.length) return res.status(400).json({ success: false, message: 'No editable fields provided' });

        // Confirm the item exists first — a no-op UPDATE returns affectedRows 0 even
        // for an existing row under mysql2's default flags, so we can't rely on it for 404.
        const [exist] = await pool.query('SELECT zoho_item_id FROM zoho_items_map WHERE zoho_item_id = ?', [id]);
        if (!exist.length) return res.status(404).json({ success: false, message: 'Item not found' });

        vals.push(id);
        await pool.query(`UPDATE zoho_items_map SET ${sets.join(', ')} WHERE zoho_item_id = ?`, vals);
        res.json({ success: true, rate });
    } catch (err) {
        console.error('Zoho-item edit error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Push ONE Zoho item's current (locally-edited) name/SKU/description/DPL/rate to the
// live Zoho item, via the same bulk-edit job path the catalog push uses (which also
// guards SKU conflicts and mirrors confirmed values back to zoho_items_map).
router.post('/items/zoho-item/:id/push', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const id = String(req.params.id || '');
        if (!id) return res.status(400).json({ success: false, message: 'Invalid item id' });

        const [rows] = await pool.query(
            `SELECT zoho_item_id, zoho_item_name, zoho_sku, zoho_description, zoho_cf_dpl, zoho_rate
               FROM zoho_items_map WHERE zoho_item_id = ?`, [id]
        );
        if (!rows.length) return res.status(404).json({ success: false, message: 'Item not found' });

        const z = rows[0];
        const dpl = z.zoho_cf_dpl != null ? parseFloat(z.zoho_cf_dpl) : null;
        if (!(dpl > 0)) return res.status(400).json({ success: false, message: 'Set a DPL before pushing' });
        const rate = z.zoho_rate != null ? parseFloat(z.zoho_rate) : dplCatalogService.computeZohoRate(dpl);

        const changes = { cf_dpl: dpl, purchase_rate: dpl, rate };
        if (z.zoho_item_name)        changes.name = String(z.zoho_item_name).trim();
        if (z.zoho_sku)              changes.sku = String(z.zoho_sku).trim();
        if (z.zoho_description != null) changes.description = String(z.zoho_description).trim();

        const result = await createBulkEditJob(
            [{ zoho_item_id: id, item_name: z.zoho_item_name || '', changes }],
            req.user
        );
        res.json({ success: true, job_id: result.job_id });
    } catch (err) {
        // createBulkEditJob throws with an httpStatus on validation / SKU conflict.
        const status = err.httpStatus || 500;
        console.error('Zoho-item push error:', err.message);
        res.status(status).json({ success: false, message: err.message });
    }
});
```

- [ ] **Step 3: Verify the module loads**

```bash
node -e "require('./routes/zoho'); console.log('OK')"
```

Expected: `OK` (no syntax / reference error).

- [ ] **Step 4: Smoke-check the PUT validation branches with a stub pool**

This exercises the early-return validation paths (which run before any DB call needs to matter):

```bash
node -e "
const express = require('express');
const zoho = require('./routes/zoho');
zoho.setPool({ query: async () => [[]] });
// Find the PUT handler on the router stack and confirm it 400s with no fields.
const layer = zoho.router.stack.find(l => l.route && l.route.path === '/items/zoho-item/:id' && l.route.methods.put);
console.log('PUT route registered:', !!layer);
const pushLayer = zoho.router.stack.find(l => l.route && l.route.path === '/items/zoho-item/:id/push' && l.route.methods.post);
console.log('POST push route registered:', !!pushLayer);
"
```

Expected: prints `PUT route registered: true` and `POST push route registered: true`. (If `zoho.router` is not directly enumerable this way, instead just confirm Step 3 printed `OK` and move on — the behavior is covered by the browser test in Task 3.)

- [ ] **Step 5: Run the unit suite (no regression)**

```bash
npx jest tests/unit/dpl-catalog-zoho-first.test.js --no-coverage
```

Expected: PASS (unchanged from Task 1).

- [ ] **Step 6: Commit**

```bash
git add routes/zoho.js
git commit -m "feat(dpl-catalog): PUT /items/zoho-item/:id (local edit) + POST .../push (single-item Zoho push)"
```

---

### Task 3: Frontend — edit sheet + row/card Edit & Push (`public/admin-dpl.html`)

**Files:**
- Modify: `public/admin-dpl.html`

Read the Zoho-first region (HTML ~lines 403–459, the DPL-first edit sheet `#catEditModal` ~lines 478–508 as a style reference) and the Zoho-first JS (`var zfFilter`/`zfAttachItemId` ~line 1375, `function zfCardHtml` ~line 1620, `renderZohoFirst` table row ~line 1688) before editing. Confirm each anchor matches before applying.

- [ ] **Step 1: Add the edit state variable**

Find (~line 1377):

```js
    var zfAttachItemId = null;         // Zoho item id currently being attached
```

Add immediately below it:

```js
    var zfEditItemId = null;            // Zoho item id currently being edited
```

- [ ] **Step 2: Add the edit-sheet modal HTML**

Find (~line 461):

```html
            <!-- Zoho item picker for catalog re-link -->
```

Insert immediately **before** that comment:

```html
                <!-- Zoho-first: edit a Zoho item's details (local save; push is separate) -->
                <div id="zfEditModal" class="fixed inset-0 bg-black/40 items-center justify-center z-50" style="display:none">
                    <div class="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col">
                        <div class="p-3 border-b flex items-center justify-between">
                            <div class="font-bold text-sm" id="zfEditTitle">Edit Zoho item</div>
                            <button onclick="closeZfEdit()" class="text-gray-400 hover:text-gray-700 text-xl leading-none">&times;</button>
                        </div>
                        <div class="p-3 overflow-y-auto space-y-3 text-xs">
                            <div id="zfEditMeta" class="text-gray-500"></div>
                            <div>
                                <label class="block text-[11px] text-gray-500 mb-0.5">Name</label>
                                <input type="text" id="zfEditName" class="w-full px-3 py-2 border rounded text-xs outline-none focus:border-indigo-500">
                            </div>
                            <div>
                                <label class="block text-[11px] text-gray-500 mb-0.5">SKU</label>
                                <input type="text" id="zfEditSku" class="w-full px-3 py-2 border rounded text-xs font-mono outline-none focus:border-indigo-500">
                            </div>
                            <div>
                                <label class="block text-[11px] text-gray-500 mb-0.5">Description</label>
                                <textarea id="zfEditDesc" rows="3" class="w-full px-3 py-2 border rounded text-xs outline-none focus:border-indigo-500 resize-y"></textarea>
                            </div>
                            <div class="flex items-center gap-3">
                                <div class="flex-1">
                                    <label class="block text-[11px] text-gray-500 mb-0.5">DPL</label>
                                    <input type="number" id="zfEditDpl" oninput="updateZfRatePreview()" class="w-full px-3 py-2 border rounded text-xs outline-none focus:border-indigo-500">
                                </div>
                                <div class="text-[11px] text-gray-500">Rate (auto): <b id="zfEditRatePreview" class="text-emerald-700">—</b></div>
                            </div>
                        </div>
                        <div class="p-3 border-t flex justify-end gap-2">
                            <button onclick="closeZfEdit()" class="px-3 py-2 rounded border text-gray-600 text-xs">Cancel</button>
                            <button onclick="saveZfEdit()" id="zfEditSaveBtn" class="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold disabled:opacity-50">💾 Save</button>
                        </div>
                    </div>
                </div>

```

- [ ] **Step 3: Add the edit/push functions**

Find (~line 1620):

```js
    function zfCardHtml(r) {
```

Insert the following functions immediately **before** that line (function declarations hoist, so `zfRowActions` is available to `zfCardHtml` and the table renderer):

```js
    // Per-row actions: edit the real Zoho item (local) + push it to Zoho.
    function zfRowActions(r) {
        var idAttr = esc(r.zoho_item_id);
        return '<div class="mt-1 flex flex-wrap gap-1">' +
            '<button onclick="openZfEdit(\'' + idAttr + '\')" class="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-700 hover:bg-gray-200">✏ Edit</button>' +
            '<button onclick="pushZfItem(\'' + idAttr + '\')" class="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-600 text-white hover:bg-indigo-700">⬆ Push</button>' +
            '</div>';
    }

    function updateZfRatePreview() {
        var dpl = parseFloat(document.getElementById('zfEditDpl').value);
        var el = document.getElementById('zfEditRatePreview');
        el.textContent = (isFinite(dpl) && dpl > 0) ? ('₹' + Math.ceil(dpl * 1.18 * 1.10).toLocaleString('en-IN')) : '—';
    }

    function openZfEdit(zohoItemId) {
        var r = zfRows.find(function(x){ return String(x.zoho_item_id) === String(zohoItemId); });
        if (!r) return;
        zfEditItemId = zohoItemId;
        document.getElementById('zfEditMeta').textContent = (r.category || '') + (r.category && r.zoho_sku ? ' · ' : '') + (r.zoho_sku || '');
        document.getElementById('zfEditName').value = r.zoho_name || '';
        document.getElementById('zfEditSku').value = r.zoho_sku || '';
        document.getElementById('zfEditDesc').value = '';
        document.getElementById('zfEditDpl').value = (r.old_dpl != null ? r.old_dpl : '');
        updateZfRatePreview();
        document.getElementById('zfEditModal').style.display = 'flex';
    }

    function closeZfEdit() {
        zfEditItemId = null;
        document.getElementById('zfEditModal').style.display = 'none';
    }

    async function saveZfEdit() {
        if (!zfEditItemId) return;
        var btn = document.getElementById('zfEditSaveBtn');
        btn.disabled = true;
        try {
            var dplVal = document.getElementById('zfEditDpl').value;
            var payload = {
                name: document.getElementById('zfEditName').value,
                sku: document.getElementById('zfEditSku').value,
                description: document.getElementById('zfEditDesc').value
            };
            if (dplVal !== '') payload.dpl = parseFloat(dplVal);
            var resp = await fetch('/api/zoho/items/zoho-item/' + encodeURIComponent(zfEditItemId), {
                method: 'PUT',
                headers: { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            var body = await resp.json();
            if (!resp.ok || !body.success) throw new Error(body.message || ('Server error ' + resp.status));
            closeZfEdit();
            showToast('Saved', 'success');
            await loadZohoFirst();
        } catch (err) {
            showToast('Save error: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    async function pushZfItem(zohoItemId) {
        try {
            var resp = await fetch('/api/zoho/items/zoho-item/' + encodeURIComponent(zohoItemId) + '/push', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' }
            });
            var body = await resp.json();
            if (!resp.ok || !body.success) throw new Error(body.message || ('Server error ' + resp.status));
            showToast('Pushed to Zoho (job #' + body.job_id + ')', 'success');
            await loadZohoFirst();
        } catch (err) {
            showToast('Push error: ' + err.message, 'error');
        }
    }

```

- [ ] **Step 4: Render the actions in the mobile card**

Find (~line 1630, inside `zfCardHtml`):

```js
            zfProposalHtml(r) +
```

Replace it with:

```js
            zfProposalHtml(r) + zfRowActions(r) +
```

- [ ] **Step 5: Render the actions in the desktop table status cell**

Find (~line 1688, inside `renderZohoFirst`):

```js
                '<td class="px-2 py-1.5 text-center">' + zfStatusChip(r) + zfProposalHtml(r) + '</td>' +
```

Replace it with:

```js
                '<td class="px-2 py-1.5 text-center">' + zfStatusChip(r) + zfProposalHtml(r) + zfRowActions(r) + '</td>' +
```

- [ ] **Step 6: Static verification**

1. `node -e "require('./routes/zoho'); console.log('OK')"` → `OK`.
2. Grep that each new name is defined exactly once: `zfRowActions`, `openZfEdit`, `closeZfEdit`, `updateZfRatePreview`, `saveZfEdit`, `pushZfItem`; and that `id="zfEditModal"`, `id="zfEditDpl"`, `id="zfEditRatePreview"` appear once in the markup.
3. Confirm the modal block is balanced (its outer `<div id="zfEditModal">` has a matching close) and sits before the `<!-- Zoho item picker for catalog re-link -->` comment.
4. `npx jest tests/unit/dpl-catalog-zoho-first.test.js --no-coverage` → still green.

- [ ] **Step 7: Commit**

```bash
git add public/admin-dpl.html
git commit -m "feat(dpl-catalog-ui): Zoho-first edit-item sheet + per-row Edit/Push"
```

---

### Task 4: E2E — edit sheet + rate preview + push button (Playwright)

**Files:**
- Modify: `tests/e2e/admin-dpl-zoho-first.spec.js`

- [ ] **Step 1: Append a new test**

Add to `tests/e2e/admin-dpl-zoho-first.spec.js` (after the existing tests; reuse the file-level `pageUrl` / imports):

```js
test('Edit sheet opens prefilled, rate preview computes, Push button present', async ({ page }) => {
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
            { zoho_item_id: 'Z1', zoho_name: 'BIRLA OPUS A 4L', zoho_sku: 'WPRC4', category: 'Interior', old_dpl: 2050, old_rate: 2660, entry_id: 11, new_dpl: 2180, new_rate: 2830, diff: 130, status: 'matched', changed: true, shared_count: 0, proposal: null },
        ];
        window.zfUnlinked = [];

        const panel = document.getElementById('catalogPanel');
        if (panel) panel.classList.remove('hidden');
        document.getElementById('zohoFirstView').classList.remove('hidden');
        window.renderZohoFirst();

        const tableHtml = document.getElementById('zohoFirstTableBody').innerHTML;

        // Open the edit sheet for Z1.
        window.openZfEdit('Z1');
        const modalShown = document.getElementById('zfEditModal').style.display === 'flex';
        const nameVal = document.getElementById('zfEditName').value;
        const skuVal = document.getElementById('zfEditSku').value;
        const dplVal = document.getElementById('zfEditDpl').value;
        const ratePrefill = document.getElementById('zfEditRatePreview').textContent;

        // Change DPL → rate preview recomputes (ceil(500*1.18*1.10)=649).
        document.getElementById('zfEditDpl').value = '500';
        window.updateZfRatePreview();
        const rateAfter = document.getElementById('zfEditRatePreview').textContent;

        return {
            hasEditBtn: tableHtml.indexOf('Edit') !== -1,
            hasPushBtn: tableHtml.indexOf('Push') !== -1,
            modalShown, nameVal, skuVal, dplVal, ratePrefill, rateAfter,
        };
    });

    expect(pageErrors).toEqual([]);
    expect(res.hasEditBtn).toBe(true);            // ✏ Edit rendered on the row
    expect(res.hasPushBtn).toBe(true);            // ⬆ Push rendered on the row
    expect(res.modalShown).toBe(true);            // edit sheet opened
    expect(res.nameVal).toBe('BIRLA OPUS A 4L');  // prefilled from the row
    expect(res.skuVal).toBe('WPRC4');
    expect(res.dplVal).toBe('2050');              // old_dpl prefilled
    expect(res.ratePrefill).toContain('2,661');   // ceil(2050*1.18*1.10)=2661 (en-IN locale)
    expect(res.rateAfter).toContain('649');       // ceil(500*1.18*1.10)=649 after DPL→500
});
```

(Exact rates confirmed in node: `Math.ceil(2050*1.18*1.10) === 2661` → `2,661` via `toLocaleString('en-IN')`; `Math.ceil(500*1.18*1.10) === 649`.)

- [ ] **Step 2: Run the e2e spec**

```bash
npx playwright test tests/e2e/admin-dpl-zoho-first.spec.js
```

Expected: 3 passed (the two existing tests + this one). The existing tests must still pass — `renderZohoFirst` now also appends `zfRowActions`, which adds 'Edit'/'Push' text but does not remove the 'Attach DPL'/'Accept'/'changed' text the earlier tests assert.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/admin-dpl-zoho-first.spec.js
git commit -m "test(dpl-catalog-ui): e2e for Zoho-first edit sheet + rate preview + Push button"
```

---

## Run Full Test Suite

```bash
npm test                 # jest — includes computeZohoRate
npm run test:e2e         # playwright — admin-dpl-zoho-first (3 tests) + others
```

Expected: all jest suites pass; all Playwright specs pass including the 3 Zoho-first tests.

---

## Deploy (after user approval)

```bash
ssh hetzner "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && npm install && pm2 restart business-manager"
```

Then hard-refresh `admin-dpl.html` → Zoho-first tab → ✏ Edit a row (change name/SKU/DPL, watch the rate preview), Save, then ⬆ Push and confirm the toast shows a job number.
