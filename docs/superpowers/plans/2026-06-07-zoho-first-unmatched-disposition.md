# Zoho-first Unmatched Disposition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the owner triage unmatched Zoho items in the Zoho-first view into `done` (manual price pushed to Zoho) or `later` (deferred), so the "No match" list shows only items still needing triage.

**Architecture:** A new per-item `dpl_disposition` column on `zoho_items_map` (sync-safe, like `dpl_updated_at`) is surfaced by `buildZohoFirstView` onto each row, set via a new `POST …/zoho-item/:id/disposition` endpoint, and driven from `admin-dpl.html` with Done/Later/Reopen actions, badges, and two new filter chips. The "Done" path reuses the existing edit (`PUT …/zoho-item/:id`) + push (`POST …/zoho-item/:id/push`) endpoints — no new push logic.

**Tech Stack:** Node.js, Express, MariaDB (`mysql2/promise`); vanilla JS + Tailwind in `public/admin-dpl.html`; Jest unit tests; Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-06-07-zoho-first-unmatched-disposition-design.md`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `migrations/add-zoho-dpl-disposition.js` | Create | Add `dpl_disposition` / `dpl_disposition_at` / `dpl_disposition_by` to `zoho_items_map` |
| `services/dpl-catalog.js` | Modify `buildZohoFirstView` | Surface `disposition` (default `'pending'`) on every row |
| `routes/zoho.js` | Modify by-zoho SELECT + add endpoint | Select `dpl_disposition`; add `POST …/zoho-item/:id/disposition` |
| `tests/unit/dpl-catalog-zoho-first.test.js` | Modify | Assert `disposition` passthrough + default |
| `tests/unit/dpl-catalog-endpoints.test.js` | Modify | Assert the disposition route is registered |
| `public/admin-dpl.html` | Modify | Done/Later/Reopen actions, badges, filter chips, predicate, Done-mode edit |
| `tests/e2e/admin-dpl-zoho-first.spec.js` | Modify | No-match=pending-only, Done/Later filters + badges, card parity |

**Important — editing `admin-dpl.html`:** ~5,300-line file. Locate edit points by the unique anchor strings quoted in each step, not line numbers.

---

### Task 1: Migration — add disposition columns to `zoho_items_map`

**Files:**
- Create: `migrations/add-zoho-dpl-disposition.js`

- [ ] **Step 1: Write the migration script**

Create `migrations/add-zoho-dpl-disposition.js` (mirrors `migrations/add-dpl-updated-at.js`, idempotent per-column):

```js
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function migrate() {
    let pool;
    try {
        pool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'business_manager',
            port: process.env.DB_PORT || 3306
        });

        const columns = [
            ['dpl_disposition',    "VARCHAR(16) NOT NULL DEFAULT 'pending'"],
            ['dpl_disposition_at', 'DATETIME NULL DEFAULT NULL'],
            ['dpl_disposition_by', 'INT NULL DEFAULT NULL'],
        ];

        for (const [name, ddl] of columns) {
            const [cols] = await pool.query(`
                SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'zoho_items_map' AND COLUMN_NAME = ?
            `, [name]);
            if (cols.length === 0) {
                await pool.query(
                    `ALTER TABLE zoho_items_map ADD COLUMN ${name} ${ddl}, ALGORITHM=INPLACE, LOCK=NONE`
                );
                console.log(`✅ zoho_items_map.${name} added`);
            } else {
                console.log(`⏭️ zoho_items_map.${name} already exists`);
            }
        }

        console.log('\n✅ Migration completed!');
    } catch (error) {
        console.error('Migration failed:', error);
        process.exitCode = 1;
    } finally {
        if (pool) await pool.end();
        process.exit(process.exitCode || 0);
    }
}

migrate();
```

- [ ] **Step 2: Run the migration**

Run: `node migrations/add-zoho-dpl-disposition.js`
Expected: prints `✅ zoho_items_map.dpl_disposition added` (and the other two), then `✅ Migration completed!`. Re-running prints `⏭️ … already exists` for all three (idempotent).

- [ ] **Step 3: Verify the columns exist**

Run:
```bash
node -e "const m=require('mysql2/promise');const p=require('path');require('dotenv').config({path:p.join(process.cwd(),'.env')});(async()=>{const pool=m.createPool({host:process.env.DB_HOST||'localhost',user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||'',database:process.env.DB_NAME,port:process.env.DB_PORT||3306});const [r]=await pool.query(\"SELECT COLUMN_NAME, COLUMN_DEFAULT FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='zoho_items_map' AND COLUMN_NAME LIKE 'dpl_disposition%' ORDER BY COLUMN_NAME\");console.log(r);await pool.end();})();"
```
Expected: three rows — `dpl_disposition` (default `pending`), `dpl_disposition_at` (default NULL), `dpl_disposition_by` (default NULL).

- [ ] **Step 4: Commit**

```bash
git add migrations/add-zoho-dpl-disposition.js
git commit -m "feat(dpl): add dpl_disposition columns to zoho_items_map"
```

---

### Task 2: Backend — surface `disposition` in `buildZohoFirstView` + select it in the route

**Files:**
- Modify: `services/dpl-catalog.js` (`buildZohoFirstView`)
- Modify: `routes/zoho.js` (by-zoho SELECT)
- Test: `tests/unit/dpl-catalog-zoho-first.test.js`

- [ ] **Step 1: Write the failing unit assertions**

In `tests/unit/dpl-catalog-zoho-first.test.js`, the shared `zohoItems` fixture at the top has a line for Z2:

```js
    { zoho_item_id: 'Z2', zoho_item_name: 'BIRLA OPUS A 1L',  zoho_sku: 'WPRC1',  zoho_cf_dpl: '620',  zoho_rate: '805',  zoho_category_name: 'Interior' },
```

Replace it with (adds a disposition):

```js
    { zoho_item_id: 'Z2', zoho_item_name: 'BIRLA OPUS A 1L',  zoho_sku: 'WPRC1',  zoho_cf_dpl: '620',  zoho_rate: '805',  zoho_category_name: 'Interior', dpl_disposition: 'later' },
```

Then add these tests inside `describe('buildZohoFirstView', …)`, right after the existing `'unmatched Zoho item has status unmatched and null new values'` test:

```js
    test('row surfaces dpl_disposition from the Zoho item', () => {
        const r = rows.find(x => x.zoho_item_id === 'Z2');
        expect(r.disposition).toBe('later');
    });

    test('disposition defaults to pending when the Zoho item has none', () => {
        const r = rows.find(x => x.zoho_item_id === 'Z1');
        expect(r.disposition).toBe('pending');
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/unit/dpl-catalog-zoho-first.test.js --no-coverage`
Expected: the two new tests FAIL (`r.disposition` is `undefined`); all pre-existing tests still PASS.

- [ ] **Step 3: Surface `disposition` in `buildZohoFirstView`**

In `services/dpl-catalog.js`, inside `buildZohoFirstView`, the row-mapping callback returns an object that starts:

```js
        return {
            zoho_item_id: zi.zoho_item_id,
            zoho_name: zi.zoho_item_name || '',
            zoho_sku: zi.zoho_sku || '',
            category: zi.zoho_category_name || '',
```

Replace that opening of the returned object with (adds `disposition`):

```js
        return {
            zoho_item_id: zi.zoho_item_id,
            zoho_name: zi.zoho_item_name || '',
            zoho_sku: zi.zoho_sku || '',
            category: zi.zoho_category_name || '',
            disposition: zi.dpl_disposition || 'pending',
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/unit/dpl-catalog-zoho-first.test.js --no-coverage`
Expected: ALL tests PASS.

- [ ] **Step 5: Select `dpl_disposition` in the by-zoho route**

In `routes/zoho.js`, find the by-zoho handler's query:

```js
        const [zohoItems] = await pool.query(
            `SELECT zoho_item_id, zoho_item_name, zoho_sku, zoho_cf_dpl, zoho_rate, zoho_category_name
               FROM zoho_items_map
              WHERE zoho_status = 'active'${catalogZohoScopeSql(brand)}`
        );
```

Replace the SELECT column list to include `dpl_disposition`:

```js
        const [zohoItems] = await pool.query(
            `SELECT zoho_item_id, zoho_item_name, zoho_sku, zoho_cf_dpl, zoho_rate, zoho_category_name, dpl_disposition
               FROM zoho_items_map
              WHERE zoho_status = 'active'${catalogZohoScopeSql(brand)}`
        );
```

- [ ] **Step 6: Run unit tests + lint**

Run:
```bash
npx jest tests/unit/dpl-catalog-zoho-first.test.js --no-coverage
npx eslint routes/zoho.js services/dpl-catalog.js
```
Expected: tests PASS; eslint exits 0 (pre-existing warnings in zoho.js are unrelated and acceptable — 0 errors).

- [ ] **Step 7: Commit**

```bash
git add services/dpl-catalog.js routes/zoho.js tests/unit/dpl-catalog-zoho-first.test.js
git commit -m "feat(dpl-zoho-first): surface dpl_disposition on rows + select it in by-zoho"
```

---

### Task 3: Backend — the disposition endpoint

**Files:**
- Modify: `routes/zoho.js` (add endpoint)
- Test: `tests/unit/dpl-catalog-endpoints.test.js`

- [ ] **Step 1: Write the failing registration test**

In `tests/unit/dpl-catalog-endpoints.test.js`, inside `describe('dpl-catalog endpoints registered on zoho router', …)`, add after the `'POST /items/dpl-catalog/entry/:id/not-in-zoho'` test:

```js
    test('POST /items/zoho-item/:id/disposition', () => {
        expect(has('post', '/items/zoho-item/:id/disposition')).toBe(true);
    });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/unit/dpl-catalog-endpoints.test.js --no-coverage`
Expected: the new test FAILS (`expect(false).toBe(true)`); all others PASS.

- [ ] **Step 3: Implement the endpoint**

In `routes/zoho.js`, locate the push handler that begins with:

```js
router.post('/items/zoho-item/:id/push', requirePermission('zoho', 'manage'), async (req, res) => {
```

Immediately AFTER that handler's closing `});`, insert the new endpoint:

```js
// Set the DPL triage disposition for one Zoho item: pending (default / reopen),
// done (owner finalized a manual price), or later (deferred). Stored on
// zoho_items_map — the item sync upsert never touches these columns, so it persists.
router.post('/items/zoho-item/:id/disposition', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const id = String(req.params.id || '');
        if (!id) return res.status(400).json({ success: false, message: 'Invalid item id' });

        const disposition = String((req.body || {}).disposition || '').toLowerCase();
        if (!['pending', 'done', 'later'].includes(disposition)) {
            return res.status(400).json({ success: false, message: "disposition must be 'pending', 'done' or 'later'" });
        }

        const [exist] = await pool.query(
            'SELECT zoho_item_id, dpl_disposition FROM zoho_items_map WHERE zoho_item_id = ?', [id]
        );
        if (!exist.length) return res.status(404).json({ success: false, message: 'Item not found' });

        const userId = req.user ? req.user.id : null;
        if (disposition === 'pending') {
            await pool.query(
                `UPDATE zoho_items_map SET dpl_disposition = 'pending', dpl_disposition_at = NULL, dpl_disposition_by = ? WHERE zoho_item_id = ?`,
                [userId, id]
            );
        } else {
            await pool.query(
                `UPDATE zoho_items_map SET dpl_disposition = ?, dpl_disposition_at = NOW(), dpl_disposition_by = ? WHERE zoho_item_id = ?`,
                [disposition, userId, id]
            );
        }

        try {
            const audit = require('../services/audit-log');
            await audit.record(req, {
                action: 'zoho_item_disposition',
                entity_type: 'zoho_item',
                entity_id: id,
                before: { dpl_disposition: exist[0].dpl_disposition || 'pending' },
                after: { dpl_disposition: disposition }
            });
        } catch (e) {
            console.warn('audit-log record failed:', e.message);
        }

        res.json({ success: true, disposition });
    } catch (err) {
        console.error('Zoho-item disposition error:', err.message);
        res.status(500).json({ success: false, message: err.message });
    }
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx jest tests/unit/dpl-catalog-endpoints.test.js --no-coverage`
Expected: ALL tests PASS.

- [ ] **Step 5: Lint**

Run: `npx eslint routes/zoho.js`
Expected: exits 0 (0 errors).

- [ ] **Step 6: Commit**

```bash
git add routes/zoho.js tests/unit/dpl-catalog-endpoints.test.js
git commit -m "feat(dpl-zoho-first): POST zoho-item/:id/disposition endpoint"
```

---

### Task 4: Frontend — Done/Later/Reopen actions, badges, filter chips

**Files:**
- Modify: `public/admin-dpl.html`

- [ ] **Step 1: Add the two filter chips to the markup**

Find the Zoho-first filter row chip for Pushed (anchor: `id="zffPushed"`):

```html
                        <button onclick="setZohoFilter('pushed')"    id="zffPushed"    class="zf-filter px-2 py-1 rounded text-[11px] font-semibold bg-gray-100 text-gray-600">✅ Pushed</button>
```

Replace it with (append Done + Later chips):

```html
                        <button onclick="setZohoFilter('pushed')"    id="zffPushed"    class="zf-filter px-2 py-1 rounded text-[11px] font-semibold bg-gray-100 text-gray-600">✅ Pushed</button>
                        <button onclick="setZohoFilter('done')"      id="zffDone"      class="zf-filter px-2 py-1 rounded text-[11px] font-semibold bg-gray-100 text-gray-600">✅ Done</button>
                        <button onclick="setZohoFilter('later')"     id="zffLater"     class="zf-filter px-2 py-1 rounded text-[11px] font-semibold bg-gray-100 text-gray-600">🕒 Later</button>
```

- [ ] **Step 2: Add the "Push & mark Done" button to the edit modal footer**

Find the edit-modal footer (anchor: `id="zfEditSaveBtn"`):

```html
                            <button onclick="saveZfEdit()" id="zfEditSaveBtn" class="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold disabled:opacity-50">💾 Save</button>
```

Replace it with (adds a hidden Done button beside Save):

```html
                            <button onclick="saveZfEdit()" id="zfEditSaveBtn" class="px-4 py-2 rounded bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold disabled:opacity-50">💾 Save</button>
                            <button onclick="saveZfEditAndDone()" id="zfEditDoneBtn" class="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold disabled:opacity-50" style="display:none">✅ Push &amp; mark Done</button>
```

- [ ] **Step 3: Add `var zfDoneMode` state**

Find the Zoho-first state declarations (anchor: `var zfEditItemId = null;`):

```js
    var zfEditItemId = null;            // Zoho item id currently being edited
```

Replace it with:

```js
    var zfEditItemId = null;            // Zoho item id currently being edited
    var zfDoneMode = false;             // true while the edit sheet is in "Push & mark Done" mode
```

- [ ] **Step 4: Add the disposition badge + actions helpers**

Find `function zfStatusChip(r) {` and add immediately ABOVE it:

```js
    // Badge shown on a row that the owner has triaged out of "No match".
    function zfDispositionBadge(r) {
        var disp = r.disposition || 'pending';
        if (disp === 'done')  return ' <span class="px-1.5 py-0.5 rounded text-[10px] bg-emerald-100 text-emerald-700" title="Manually finalized — no DPL match">✅ Done</span>';
        if (disp === 'later') return ' <span class="px-1.5 py-0.5 rounded text-[10px] bg-sky-100 text-sky-700" title="Deferred — set up later">🕒 Later</span>';
        return '';
    }

    // Triage buttons for an unmatched row: pending → Done / Later; otherwise Reopen.
    function zfDispositionActions(r) {
        if (r.status !== 'unmatched') return '';
        var idAttr = esc(r.zoho_item_id);
        var disp = r.disposition || 'pending';
        if (disp === 'pending') {
            return '<button onclick="zfMarkDone(\'' + idAttr + '\')" class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-600 text-white hover:bg-emerald-700" title="Set a manual price, push to Zoho, and finalize">✅ Done</button>' +
                   '<button onclick="zfSetDisposition(\'' + idAttr + '\',\'later\')" class="px-2 py-0.5 rounded text-[10px] font-bold bg-sky-100 text-sky-700 hover:bg-sky-200" title="Set this item aside for later">🕒 Later</button>';
        }
        return '<button onclick="zfSetDisposition(\'' + idAttr + '\',\'pending\')" class="px-2 py-0.5 rounded text-[10px] font-bold bg-gray-100 text-gray-700 hover:bg-gray-200" title="Move back to No match">↩ Reopen</button>';
    }
```

- [ ] **Step 5: Render the disposition buttons inside the unmatched action area**

In `zfProposalHtml`, the function currently is:

```js
    function zfProposalHtml(r) {
        if (r.status !== 'unmatched') return '';
        var idAttr = esc(r.zoho_item_id);
        var attachBtn = '<button onclick="openAttachPicker(\'' + idAttr + '\')" class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 hover:bg-rose-200">Attach DPL</button>';
        if (r.proposal) {
            var p = r.proposal;
            var confCls = p.confidence === 'high' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700';
            var acceptBtn = '<button onclick="acceptProposal(\'' + idAttr + '\',' + Number(p.entry_id) + ')" class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-600 text-white hover:bg-emerald-700">✓ Accept</button>';
            return '<div class="mt-1 text-[10px] text-gray-600">Proposed: <b>' + esc(p.product_name) + '</b> · ' + esc(p.base_name || '—') + ' · ' + esc(p.dpl_size_label) + ' · ' + fmtMoney(p.current_dpl) +
                ' <span class="px-1 rounded ' + confCls + '">' + esc(p.confidence) + '</span></div>' +
                '<div class="mt-1 flex flex-wrap gap-1">' + acceptBtn + attachBtn + '</div>';
        }
        return '<div class="mt-1">' + attachBtn + '</div>';
    }
```

Replace it with (append `zfDispositionActions(r)` to both action rows):

```js
    function zfProposalHtml(r) {
        if (r.status !== 'unmatched') return '';
        var idAttr = esc(r.zoho_item_id);
        var dispBtns = zfDispositionActions(r);
        var attachBtn = '<button onclick="openAttachPicker(\'' + idAttr + '\')" class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 hover:bg-rose-200">Attach DPL</button>';
        if (r.proposal) {
            var p = r.proposal;
            var confCls = p.confidence === 'high' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700';
            var acceptBtn = '<button onclick="acceptProposal(\'' + idAttr + '\',' + Number(p.entry_id) + ')" class="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-600 text-white hover:bg-emerald-700">✓ Accept</button>';
            return '<div class="mt-1 text-[10px] text-gray-600">Proposed: <b>' + esc(p.product_name) + '</b> · ' + esc(p.base_name || '—') + ' · ' + esc(p.dpl_size_label) + ' · ' + fmtMoney(p.current_dpl) +
                ' <span class="px-1 rounded ' + confCls + '">' + esc(p.confidence) + '</span></div>' +
                '<div class="mt-1 flex flex-wrap gap-1">' + acceptBtn + attachBtn + dispBtns + '</div>';
        }
        return '<div class="mt-1 flex flex-wrap gap-1">' + attachBtn + dispBtns + '</div>';
    }
```

- [ ] **Step 6: Show the badge in the table Status cell and the card**

In `renderZohoFirst`, the table Status cell currently reads:

```js
                '<td class="px-2 py-1.5 text-center">' + zfStatusChip(r) + zfPushedChip(r) + zfProposalHtml(r) + zfRowActions(r) + '</td>' +
```

Replace with (adds the badge after the pushed chip):

```js
                '<td class="px-2 py-1.5 text-center">' + zfStatusChip(r) + zfPushedChip(r) + zfDispositionBadge(r) + zfProposalHtml(r) + zfRowActions(r) + '</td>' +
```

In `zfCardHtml`, the status area currently reads:

```js
                '<div class="text-right">' + zfStatusChip(r) + zfPushedChip(r) + '</div>' +
```

Replace with:

```js
                '<div class="text-right">' + zfStatusChip(r) + zfPushedChip(r) + zfDispositionBadge(r) + '</div>' +
```

- [ ] **Step 7: Extend the filter predicate**

Replace the whole `visibleZohoFirstRows` function:

```js
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

with (No-match = pending-only; add done/later):

```js
    function visibleZohoFirstRows() {
        var q = (document.getElementById('zfSearch').value || '').toLowerCase().trim();
        return zfRows.filter(function(r) {
            var disp = r.disposition || 'pending';
            if (zfFilter === 'unmatched' && !(r.status === 'unmatched' && disp === 'pending')) return false;
            if (zfFilter === 'changed'   && !r.changed) return false;
            if (zfFilter === 'shared'    && r.status !== 'shared') return false;
            if (zfFilter === 'unchanged' && !(r.status === 'matched' && !r.changed)) return false;
            if (zfFilter === 'pushable'  && !zfIsPushable(r)) return false;
            if (zfFilter === 'pushed'    && !r.pushed_at) return false;
            if (zfFilter === 'done'      && disp !== 'done') return false;
            if (zfFilter === 'later'     && disp !== 'later') return false;
            if (q) return zfHaystack(r).indexOf(q) !== -1;
            return true;
        });
    }
```

- [ ] **Step 8: Register the new chips in `setZohoFilter`**

Replace the `ids` map line in `setZohoFilter`:

```js
        var ids = { all: 'zffAll', unmatched: 'zffUnmatched', changed: 'zffChanged', shared: 'zffShared', unchanged: 'zffUnchanged', pushable: 'zffPushable', pushed: 'zffPushed' };
```

with:

```js
        var ids = { all: 'zffAll', unmatched: 'zffUnmatched', changed: 'zffChanged', shared: 'zffShared', unchanged: 'zffUnchanged', pushable: 'zffPushable', pushed: 'zffPushed', done: 'zffDone', later: 'zffLater' };
```

- [ ] **Step 9: Make the No-match stat count pending-only**

In `renderZohoFirst`, the stat-count line currently reads:

```js
        var unmatched = zfRows.filter(function(r){ return r.status === 'unmatched'; }).length;
```

Replace with:

```js
        var unmatched = zfRows.filter(function(r){ return r.status === 'unmatched' && (r.disposition || 'pending') === 'pending'; }).length;
```

- [ ] **Step 10: Reset edit-sheet mode in `openZfEdit` and add the disposition functions**

In `openZfEdit`, the function currently ends:

```js
        document.getElementById('zfEditDpl').value = (r.old_dpl != null ? r.old_dpl : '');
        updateZfRatePreview();
        document.getElementById('zfEditModal').style.display = 'flex';
    }
```

Replace that ending with (always reset to normal Save mode):

```js
        document.getElementById('zfEditDpl').value = (r.old_dpl != null ? r.old_dpl : '');
        updateZfRatePreview();
        zfDoneMode = false;
        document.getElementById('zfEditDoneBtn').style.display = 'none';
        document.getElementById('zfEditSaveBtn').style.display = '';
        document.getElementById('zfEditModal').style.display = 'flex';
    }
```

Then, immediately AFTER the `closeZfEdit` function, add the three new functions:

```js
    // Open the edit sheet in "Push & mark Done" mode for an unmatched item.
    function zfMarkDone(zohoItemId) {
        openZfEdit(zohoItemId);
        zfDoneMode = true;
        document.getElementById('zfEditDoneBtn').style.display = '';
        document.getElementById('zfEditSaveBtn').style.display = 'none';
    }

    // Save manual details → push to Zoho → only on success, mark disposition 'done'.
    async function saveZfEditAndDone() {
        if (!zfEditItemId) return;
        var itemId = zfEditItemId;
        var btn = document.getElementById('zfEditDoneBtn');
        btn.disabled = true;
        try {
            var dplVal = document.getElementById('zfEditDpl').value;
            var descVal = document.getElementById('zfEditDesc').value;
            var payload = {
                name: document.getElementById('zfEditName').value,
                sku: document.getElementById('zfEditSku').value
            };
            if (descVal.trim() !== '') payload.description = descVal;
            if (dplVal !== '') payload.dpl = parseFloat(dplVal);
            var sResp = await fetch('/api/zoho/items/zoho-item/' + encodeURIComponent(itemId), {
                method: 'PUT',
                headers: { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            var sBody = await sResp.json();
            if (!sResp.ok || !sBody.success) throw new Error(sBody.message || ('Save failed ' + sResp.status));

            var pResp = await fetch('/api/zoho/items/zoho-item/' + encodeURIComponent(itemId) + '/push', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' }
            });
            var pBody = await pResp.json();
            if (!pResp.ok || !pBody.success) throw new Error(pBody.message || ('Push failed ' + pResp.status));

            var dResp = await fetch('/api/zoho/items/zoho-item/' + encodeURIComponent(itemId) + '/disposition', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ disposition: 'done' })
            });
            var dBody = await dResp.json();
            if (!dResp.ok || !dBody.success) throw new Error(dBody.message || ('Disposition failed ' + dResp.status));

            closeZfEdit();
            showToast('Pushed & marked Done', 'success');
            await loadZohoFirst();
        } catch (err) {
            showToast('Done error: ' + err.message, 'error');
        } finally {
            btn.disabled = false;
        }
    }

    // Set/clear a Zoho item's disposition (later / pending-reopen) and reload.
    async function zfSetDisposition(zohoItemId, disposition) {
        try {
            var resp = await fetch('/api/zoho/items/zoho-item/' + encodeURIComponent(zohoItemId) + '/disposition', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ disposition: disposition })
            });
            var body = await resp.json();
            if (!resp.ok || !body.success) throw new Error(body.message || ('Server error ' + resp.status));
            showToast(disposition === 'later' ? 'Set aside for later' : (disposition === 'pending' ? 'Reopened' : 'Updated'), 'success');
            await loadZohoFirst();
        } catch (err) {
            showToast('Disposition error: ' + err.message, 'error');
        }
    }
```

- [ ] **Step 11: Sanity-check the existing e2e suite still passes**

Run: `npx playwright test tests/e2e/admin-dpl-zoho-first.spec.js`
Expected: existing tests still PASS (additive markup/helpers; existing assertions unaffected). The new disposition test is added in Task 5.

- [ ] **Step 12: Commit**

```bash
git add public/admin-dpl.html
git commit -m "feat(dpl-zoho-first): Done/Later/Reopen triage UI for unmatched items"
```

---

### Task 5: E2E coverage + full verification

**Files:**
- Modify: `tests/e2e/admin-dpl-zoho-first.spec.js`

- [ ] **Step 1: Append the disposition e2e test**

Append to `tests/e2e/admin-dpl-zoho-first.spec.js` (after the last test, before EOF):

```js
test('disposition: No-match excludes done/later, Done+Later chips filter, badges render, card parity', async ({ page }) => {
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
            // pending unmatched → stays under No match
            { zoho_item_id: 'Zp', zoho_name: 'BIRLA OPUS PENDING 1L', zoho_sku: 'PEND1', old_dpl: 600, old_rate: 780,
              entry_id: null, new_dpl: null, new_rate: null, diff: null, status: 'unmatched', changed: false, shared_count: 0,
              proposal: null, matched: null, linked_entries: null, disposition: 'pending' },
            // done unmatched → out of No match, ✅ Done badge + Reopen
            { zoho_item_id: 'Zd', zoho_name: 'ACCESSORY ROLLER', zoho_sku: 'ROLL1', old_dpl: 120, old_rate: 156,
              entry_id: null, new_dpl: null, new_rate: null, diff: null, status: 'unmatched', changed: false, shared_count: 0,
              proposal: null, matched: null, linked_entries: null, disposition: 'done' },
            // later unmatched → out of No match, 🕒 Later badge
            { zoho_item_id: 'Zl', zoho_name: 'THINNER 5L', zoho_sku: 'THIN5', old_dpl: 300, old_rate: 390,
              entry_id: null, new_dpl: null, new_rate: null, diff: null, status: 'unmatched', changed: false, shared_count: 0,
              proposal: null, matched: null, linked_entries: null, disposition: 'later' },
        ];
        window.zfUnlinked = [];
        window.zfPushSelected = {};

        const panel = document.getElementById('catalogPanel');
        if (panel) panel.classList.remove('hidden');
        document.getElementById('zohoFirstView').classList.remove('hidden');
        window.renderZohoFirst();

        const rowTexts = () => Array.from(document.querySelectorAll('#zohoFirstTableBody tr')).map(t => t.textContent);

        // No match → only the pending item.
        window.setZohoFilter('unmatched');
        const noMatch = rowTexts();

        // Done chip → only the done item, with badge + Reopen.
        window.setZohoFilter('done');
        const doneTexts = rowTexts();
        const doneHtml = document.getElementById('zohoFirstTableBody').innerHTML;

        // Later chip → only the later item.
        window.setZohoFilter('later');
        const laterTexts = rowTexts();

        // All → all three, badges present; check card parity for the Done badge.
        window.setZohoFilter('all');
        const allCount = document.querySelectorAll('#zohoFirstTableBody tr').length;
        const cardsHtml = document.getElementById('zohoFirstCards').innerHTML;

        return {
            chipsExist: !!document.getElementById('zffDone') && !!document.getElementById('zffLater'),
            noMatchCount: noMatch.length,
            noMatchFirst: noMatch[0] || '',
            doneCount: doneTexts.length,
            doneFirst: doneTexts[0] || '',
            doneHasBadge: doneHtml.indexOf('✅ Done') !== -1,
            doneHasReopen: doneHtml.indexOf('↩ Reopen') !== -1,
            laterCount: laterTexts.length,
            laterFirst: laterTexts[0] || '',
            allCount,
            cardsHaveDoneBadge: cardsHtml.indexOf('✅ Done') !== -1,
        };
    });

    expect(pageErrors).toEqual([]);
    expect(res.chipsExist).toBe(true);
    expect(res.noMatchCount).toBe(1);                        // pending only
    expect(res.noMatchFirst).toContain('BIRLA OPUS PENDING 1L');
    expect(res.doneCount).toBe(1);
    expect(res.doneFirst).toContain('ACCESSORY ROLLER');
    expect(res.doneHasBadge).toBe(true);                     // ✅ Done badge
    expect(res.doneHasReopen).toBe(true);                    // ↩ Reopen action
    expect(res.laterCount).toBe(1);
    expect(res.laterFirst).toContain('THINNER 5L');
    expect(res.allCount).toBe(3);                            // All shows everything
    expect(res.cardsHaveDoneBadge).toBe(true);               // mobile card parity
});
```

- [ ] **Step 2: Run the Zoho-first e2e suite**

Run: `npx playwright test tests/e2e/admin-dpl-zoho-first.spec.js`
Expected: all tests PASS (the prior 6 + this new one), zero `pageerror`.

- [ ] **Step 3: Run the full unit suite + lint**

Run:
```bash
npx jest --no-coverage
npm run lint
```
Expected: all unit tests PASS; lint clean on touched files (0 errors).

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/admin-dpl-zoho-first.spec.js
git commit -m "test(dpl-zoho-first): e2e for done/later disposition filters + badges"
```

---

## Self-review notes

- **Spec coverage:** storage columns → Task 1. `disposition` on rows + route SELECT → Task 2.
  disposition endpoint → Task 3. Done (manual-DPL→push→mark) + Later + Reopen + badges +
  filter chips + No-match=pending → Task 4. Unit (passthrough) → Task 2; route registration →
  Task 3; e2e (filters/badges/card parity) → Task 5.
- **Out of scope (per spec):** direct-rate override, disposition notes, bulk disposition.
- **No new push logic:** Done reuses `PUT …/zoho-item/:id` + `POST …/zoho-item/:id/push`;
  fails closed (push error aborts before `disposition: 'done'` is written).
- **Type consistency:** row field `disposition` ('pending'|'done'|'later'); helpers
  `zfDispositionBadge`, `zfDispositionActions`, `zfMarkDone`, `saveZfEditAndDone`,
  `zfSetDisposition`; state `zfDoneMode`; filter ids `zffDone`/`zffLater` match markup +
  `setZohoFilter` map + predicate; endpoint `POST /items/zoho-item/:id/disposition` matches
  the registration test and all three client callers.
- **Sync safety:** columns live on `zoho_items_map`; the sync upsert (`zoho-api.js`) updates
  only its explicit column list and never deletes rows, so disposition persists.
- **Prod migration:** run `node migrations/add-zoho-dpl-disposition.js` on the server during
  deploy (idempotent); per the prod `_migrations` gap, no runner marker is required for this
  standalone script.
```
