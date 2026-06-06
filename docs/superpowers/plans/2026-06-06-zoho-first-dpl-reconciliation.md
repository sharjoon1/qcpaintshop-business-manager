# Zoho-First DPL Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Zoho-first" reconciliation tab to `admin-dpl.html` that lists every active Zoho item for a brand as a row, shows the DPL price matched to it from the latest DPL list, and lets the user attach DPL to unmatched items inline and bulk-push changed DPL/rate to Zoho.

**Architecture:** A pure helper `buildZohoFirstView(zohoItems, catalogEntries)` in `services/dpl-catalog.js` inverts the existing DPL-anchored `dpl_catalog` data into one row per Zoho item. A new read-only endpoint `GET /api/zoho/items/dpl-catalog/:brand/by-zoho` fetches active Zoho items + `getCatalog(brand)` and returns the helper's output. The frontend adds a view toggle and a second table; **all writes reuse the existing `confirm-link` and `push` endpoints** — no new write logic.

**Tech Stack:** Node.js, Express, MySQL (`mysql2/promise`), Jest, vanilla JS, Tailwind (admin palette `#667eea`).

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `services/dpl-catalog.js` | Modify | Add pure `buildZohoFirstView` helper + export |
| `tests/unit/dpl-catalog-zoho-first.test.js` | Create | Unit tests for `buildZohoFirstView` |
| `routes/zoho.js` | Modify | Add `GET …/:brand/by-zoho` endpoint |
| `public/admin-dpl.html` | Modify | View toggle + Zoho-first table + render + attach + bulk push |
| `tests/e2e/admin-dpl-zoho-first.spec.js` | Create | Renders rows, unmatched sorts first |

---

### Task 1: Pure helper `buildZohoFirstView` (TDD)

**Files:**
- Create: `tests/unit/dpl-catalog-zoho-first.test.js`
- Modify: `services/dpl-catalog.js` (add function before `module.exports` at line ~567; add to export list)

- [ ] **Step 1: Write the failing test**

Create `tests/unit/dpl-catalog-zoho-first.test.js`:

```js
const { buildZohoFirstView } = require('../../services/dpl-catalog');

// Active Zoho items (as returned by the by-zoho query — see Task 2).
const zohoItems = [
    { zoho_item_id: 'Z1', zoho_item_name: 'BIRLA OPUS A 4L',  zoho_sku: 'WPRC4',  zoho_cf_dpl: '2050', zoho_rate: '2660', zoho_category_name: 'Interior' },
    { zoho_item_id: 'Z2', zoho_item_name: 'BIRLA OPUS A 1L',  zoho_sku: 'WPRC1',  zoho_cf_dpl: '620',  zoho_rate: '805',  zoho_category_name: 'Interior' },
    { zoho_item_id: 'Z3', zoho_item_name: 'BIRLA OPUS B 10L', zoho_sku: 'ADSS10', zoho_cf_dpl: '4100', zoho_rate: '5322', zoho_category_name: 'Exterior' },
    { zoho_item_id: 'Z4', zoho_item_name: 'BIRLA OPUS C 20L', zoho_sku: 'XYZ20',  zoho_cf_dpl: '8000', zoho_rate: '10380', zoho_category_name: 'Exterior' },
];

// dpl_catalog entries (as returned by getCatalog) — only some carry a zoho_item_id.
const catalogEntries = [
    // matched + changed: new DPL 2180 vs old 2050
    { id: 11, zoho_item_id: 'Z1', current_dpl: '2180', current_rate: '2830', product_name: 'A', base_name: 'White', dpl_size_label: '3.6L', canonical_sku: 'WPRC4' },
    // matched + unchanged: new DPL equals old 4100
    { id: 13, zoho_item_id: 'Z3', current_dpl: '4100', current_rate: '5322', product_name: 'B', base_name: 'Clear', dpl_size_label: '9L', canonical_sku: 'ADSS10' },
    // shared: two entries both link to Z4
    { id: 14, zoho_item_id: 'Z4', current_dpl: '8000', current_rate: '10380', product_name: 'C', base_name: 'White', dpl_size_label: '18L', canonical_sku: 'XYZ20' },
    { id: 15, zoho_item_id: 'Z4', current_dpl: '8100', current_rate: '10510', product_name: 'C', base_name: 'Pastel', dpl_size_label: '18L', canonical_sku: 'XYZ20B' },
    // unlinked (attach candidate): no zoho_item_id
    { id: 99, zoho_item_id: null, current_dpl: '700', current_rate: '910', product_name: 'A', base_name: 'White', dpl_size_label: '0.9L', canonical_sku: 'WPRC1' },
];

describe('buildZohoFirstView', () => {
    const { rows, unlinkedEntries } = buildZohoFirstView(zohoItems, catalogEntries);

    test('returns one row per Zoho item', () => {
        expect(rows).toHaveLength(4);
    });

    test('matched + changed row carries new dpl/rate, diff and changed=true', () => {
        const r = rows.find(x => x.zoho_item_id === 'Z1');
        expect(r.status).toBe('matched');
        expect(r.entry_id).toBe(11);
        expect(r.new_dpl).toBe(2180);
        expect(r.new_rate).toBe(2830);
        expect(r.diff).toBe(130);     // 2180 - 2050
        expect(r.changed).toBe(true);
    });

    test('matched + unchanged row has diff 0 and changed=false', () => {
        const r = rows.find(x => x.zoho_item_id === 'Z3');
        expect(r.status).toBe('matched');
        expect(r.diff).toBe(0);
        expect(r.changed).toBe(false);
    });

    test('unmatched Zoho item has status unmatched and null new values', () => {
        const r = rows.find(x => x.zoho_item_id === 'Z2');
        expect(r.status).toBe('unmatched');
        expect(r.entry_id).toBeNull();
        expect(r.new_dpl).toBeNull();
        expect(r.diff).toBeNull();
        expect(r.changed).toBe(false);
    });

    test('Zoho item linked by >1 entry is shared with shared_count and no entry_id', () => {
        const r = rows.find(x => x.zoho_item_id === 'Z4');
        expect(r.status).toBe('shared');
        expect(r.shared_count).toBe(2);
        expect(r.entry_id).toBeNull();
        expect(r.changed).toBe(false);
    });

    test('rows sorted: unmatched, then changed, then shared, then unchanged', () => {
        expect(rows.map(r => r.zoho_item_id)).toEqual(['Z2', 'Z1', 'Z4', 'Z3']);
    });

    test('unlinkedEntries lists only entries without a zoho_item_id', () => {
        expect(unlinkedEntries).toHaveLength(1);
        expect(unlinkedEntries[0]).toMatchObject({
            entry_id: 99, product_name: 'A', base_name: 'White',
            dpl_size_label: '0.9L', current_dpl: 700, canonical_sku: 'WPRC1',
        });
    });

    test('null/non-numeric DPL yields diff null (never NaN)', () => {
        const { rows: r2 } = buildZohoFirstView(
            [{ zoho_item_id: 'Z9', zoho_item_name: 'X', zoho_sku: 'S', zoho_cf_dpl: null, zoho_rate: null }],
            [{ id: 1, zoho_item_id: 'Z9', current_dpl: '500', current_rate: '650' }]
        );
        expect(r2[0].diff).toBeNull();
        expect(Number.isNaN(r2[0].diff)).toBe(false);
    });

    test('handles empty inputs', () => {
        const out = buildZohoFirstView([], []);
        expect(out.rows).toEqual([]);
        expect(out.unlinkedEntries).toEqual([]);
    });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx jest tests/unit/dpl-catalog-zoho-first.test.js --no-coverage
```

Expected: FAIL — `buildZohoFirstView is not a function`.

- [ ] **Step 3: Implement the helper**

In `services/dpl-catalog.js`, add this function immediately **before** the `module.exports = {` line (currently ~line 567):

```js
// ── Zoho-first reconciliation view ──────────────────────────────────────────
// Invert the DPL-anchored catalog into ONE ROW PER ACTIVE ZOHO ITEM. Pure /
// deterministic (no DB, no clock) so it is unit-testable in isolation.
//   zohoItems     : [{ zoho_item_id, zoho_item_name, zoho_sku, zoho_cf_dpl,
//                       zoho_rate, zoho_category_name }]  (active, brand-scoped)
//   catalogEntries: getCatalog(brand) output (entries carry zoho_item_id when linked)
// Returns { rows, unlinkedEntries }. rows are sorted:
//   unmatched → matched&changed → shared → matched&unchanged, then by name (numeric).
function buildZohoFirstView(zohoItems, catalogEntries) {
    const num = v => {
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : null;
    };
    const round2 = n => Math.round(n * 100) / 100;

    // Group linked entries by Zoho item id.
    const linkMap = new Map();
    for (const e of (catalogEntries || [])) {
        if (e.zoho_item_id == null) continue;
        const k = String(e.zoho_item_id);
        if (!linkMap.has(k)) linkMap.set(k, []);
        linkMap.get(k).push(e);
    }

    const rows = (zohoItems || []).map(zi => {
        const linked = linkMap.get(String(zi.zoho_item_id)) || [];
        const old_dpl = num(zi.zoho_cf_dpl);
        const old_rate = num(zi.zoho_rate);

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

        return {
            zoho_item_id: zi.zoho_item_id,
            zoho_name: zi.zoho_item_name || '',
            zoho_sku: zi.zoho_sku || '',
            category: zi.zoho_category_name || '',
            old_dpl, old_rate,
            entry_id, new_dpl, new_rate, diff,
            status, changed, shared_count,
        };
    });

    // Sort rank: unmatched(0) < changed(1) < shared(2) < unchanged(3).
    const rank = r => {
        if (r.status === 'unmatched') return 0;
        if (r.status === 'matched' && r.changed) return 1;
        if (r.status === 'shared') return 2;
        return 3; // matched & unchanged
    };
    rows.sort((a, b) => {
        const d = rank(a) - rank(b);
        if (d !== 0) return d;
        return String(a.zoho_name).localeCompare(String(b.zoho_name), 'en', { numeric: true });
    });

    const unlinkedEntries = (catalogEntries || [])
        .filter(e => e.zoho_item_id == null)
        .map(e => ({
            entry_id: e.id,
            product_name: e.product_name || '',
            base_name: e.base_name || '',
            dpl_size_label: e.dpl_size_label || '',
            current_dpl: num(e.current_dpl),
            canonical_sku: e.canonical_sku || '',
        }));

    return { rows, unlinkedEntries };
}
```

Then add `buildZohoFirstView` to the `module.exports` object. Change:

```js
    updateAppliedPrices, updateCanonicalFields, markPushed, setNotInZoho,
};
```

to:

```js
    updateAppliedPrices, updateCanonicalFields, markPushed, setNotInZoho,
    buildZohoFirstView,
};
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx jest tests/unit/dpl-catalog-zoho-first.test.js --no-coverage
```

Expected: PASS — all 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add services/dpl-catalog.js tests/unit/dpl-catalog-zoho-first.test.js
git commit -m "feat(dpl-catalog): buildZohoFirstView — invert catalog to one row per Zoho item"
```

---

### Task 2: Read endpoint `GET …/:brand/by-zoho`

**Files:**
- Modify: `routes/zoho.js` (insert a new route immediately **after** the `GET /items/dpl-catalog/:brand` handler, which closes at line ~218)

- [ ] **Step 1: Add the endpoint**

In `routes/zoho.js`, immediately after the closing `});` of the `router.get('/items/dpl-catalog/:brand', …)` handler (line ~218) and before the `confirm-link` route comment (line ~220), insert:

```js
// Zoho-first reconciliation: ONE ROW PER ACTIVE ZOHO ITEM for the brand, each
// matched to its DPL price via the existing dpl_catalog link. Read-only — attach
// and push reuse the confirm-link / push endpoints below.
router.get('/items/dpl-catalog/:brand/by-zoho', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const brand = String(req.params.brand || '').toLowerCase();
        if (!assertSupportedBrand(brand, res)) return;

        const [zohoItems] = await pool.query(
            `SELECT zoho_item_id, zoho_item_name, zoho_sku, zoho_cf_dpl, zoho_rate, zoho_category_name
               FROM zoho_items_map
              WHERE zoho_status = 'active'${catalogZohoScopeSql(brand)}`
        );

        const entries = await dplCatalogService.getCatalog(brand);
        const view = dplCatalogService.buildZohoFirstView(zohoItems, entries);

        res.json({ success: true, data: view });
    } catch (err) {
        console.error('DPL catalog by-zoho error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});
```

> Note: Express matches `/:brand/by-zoho` before `/:brand` only because it is a longer, more specific path; placing it physically after the `/:brand` GET is fine because Express tests routes in registration order and `/:brand` will NOT match a two-segment path like `birlaopus/by-zoho`. No reordering needed.

- [ ] **Step 2: Verify the module still loads**

```bash
node -e "require('./routes/zoho'); console.log('OK')"
```

Expected: `OK` (no syntax error). If it prints a DB warning that's fine — we only require the module.

- [ ] **Step 3: Smoke-test the route shape with a stub pool**

Create a throwaway check (run, then delete the file):

```bash
node -e "
const zoho = require('./routes/zoho');
zoho.setPool({ query: async () => [[
  { zoho_item_id: 'Z1', zoho_item_name: 'BIRLA OPUS A 4L', zoho_sku: 'WPRC4', zoho_cf_dpl: 2050, zoho_rate: 2660, zoho_category_name: 'Interior' }
]] });
const svc = require('./services/dpl-catalog');
svc.setPool({ query: async () => [[]] });
console.log('routes/zoho exports router:', typeof zoho.router === 'function' || typeof zoho.router === 'object');
"
```

Expected: prints `routes/zoho exports router: true`. (This confirms the module wires up; full HTTP behavior is verified in the browser in Task 3.)

- [ ] **Step 4: Run the unit suite to confirm nothing regressed**

```bash
npx jest tests/unit/dpl-catalog-zoho-first.test.js --no-coverage
```

Expected: PASS (unchanged from Task 1).

- [ ] **Step 5: Commit**

```bash
git add routes/zoho.js
git commit -m "feat(dpl-catalog): GET .../:brand/by-zoho — Zoho-first reconciliation read endpoint"
```

---

### Task 3: Frontend — Zoho-first tab in `admin-dpl.html`

**Files:**
- Modify: `public/admin-dpl.html`

> ⚠ This task is the only place where exact line numbers may have drifted from
> earlier tasks editing nearby files — but this task edits a different file
> (`admin-dpl.html`), untouched by Tasks 1–2, so the line anchors below are stable.

This task is broken into small edits. The existing DPL-first content inside `#catalogPanel` (lines 341–395) gets wrapped in a `#dplFirstView` div; a new `#zohoFirstView` div is added beside it; a toggle switches between them.

- [ ] **Step 1: Add the view toggle + wrap existing content (open)**

In `public/admin-dpl.html`, find the panel open (line 340):

```html
            <div id="catalogPanel" class="mt-4 border-t pt-4 hidden">
                <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
```

Replace those two lines with (adds the toggle bar, then opens `#dplFirstView`):

```html
            <div id="catalogPanel" class="mt-4 border-t pt-4 hidden">
                <div class="flex items-center gap-1 mb-3">
                    <button onclick="switchCatalogView('dpl')" id="cvDpl" class="cv-tab px-3 py-1.5 rounded text-[11px] font-bold bg-indigo-600 text-white">DPL-first</button>
                    <button onclick="switchCatalogView('zoho')" id="cvZoho" class="cv-tab px-3 py-1.5 rounded text-[11px] font-bold bg-gray-100 text-gray-600">Zoho-first</button>
                </div>
                <div id="dplFirstView">
                <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
```

- [ ] **Step 2: Wrap existing content (close) + add the Zoho-first view**

Find the catalog cards + empty-state + panel close (lines 394–396):

```html
                <div id="catalogCards" class="sm:hidden space-y-2"></div>
                <div id="catalogEmpty" class="hidden text-center text-gray-400 text-xs py-8">No catalog entries match.</div>
            </div>
```

Replace with (closes `#dplFirstView`, then adds the entire `#zohoFirstView` block, then closes the panel):

```html
                <div id="catalogCards" class="sm:hidden space-y-2"></div>
                <div id="catalogEmpty" class="hidden text-center text-gray-400 text-xs py-8">No catalog entries match.</div>
                </div><!-- /#dplFirstView -->

                <div id="zohoFirstView" class="hidden">
                    <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
                        <div class="flex flex-wrap gap-2 text-[11px]">
                            <span class="px-2 py-1 rounded bg-gray-100 text-gray-700">Zoho items: <b id="zfTotal">0</b></span>
                            <span class="px-2 py-1 rounded bg-rose-100 text-rose-700">⚠ No match: <b id="zfUnmatched">0</b></span>
                            <span class="px-2 py-1 rounded bg-amber-100 text-amber-700">↕ Changed: <b id="zfChanged">0</b></span>
                        </div>
                        <button onclick="pushZohoFirstChanged()" id="zfPushBtn" class="px-2 py-1 rounded text-[11px] font-bold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 flex items-center gap-1" disabled>
                            <svg id="zfPushSpinner" class="hidden w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                            🚀 Push updated DPL (<span id="zfPushCount">0</span>)
                        </button>
                    </div>
                    <div class="flex flex-wrap items-center gap-2 mb-2">
                        <input type="text" id="zfSearch" oninput="renderZohoFirst()" aria-label="Search Zoho items" placeholder="🔍 Search Zoho item / SKU…" class="flex-1 min-w-[180px] px-3 py-1.5 border rounded text-[11px] outline-none focus:border-indigo-500">
                        <span class="text-[11px] text-gray-500 whitespace-nowrap">Showing <b id="zfShowing">0 of 0</b></span>
                    </div>
                    <div class="overflow-x-auto border rounded-lg">
                        <table class="w-full text-[11px]">
                            <thead class="bg-gray-50 text-gray-500">
                                <tr>
                                    <th class="px-2 py-2 text-left">Zoho item</th>
                                    <th class="px-2 py-2 text-left">SKU</th>
                                    <th class="px-2 py-2 text-right">Current DPL</th>
                                    <th class="px-2 py-2 text-right">New DPL</th>
                                    <th class="px-2 py-2 text-right">New rate</th>
                                    <th class="px-2 py-2 text-right">Diff</th>
                                    <th class="px-2 py-2 text-center">Status</th>
                                </tr>
                            </thead>
                            <tbody id="zohoFirstTableBody"></tbody>
                        </table>
                    </div>
                    <div id="zohoFirstEmpty" class="hidden text-center text-gray-400 text-xs py-8">No Zoho items for this brand.</div>
                </div>

                <!-- Attach-DPL picker modal -->
                <div id="zfAttachModal" class="hidden fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onclick="if(event.target===this)closeAttachPicker()">
                    <div class="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[80vh] flex flex-col">
                        <div class="px-4 py-3 border-b flex items-center justify-between">
                            <div class="text-sm font-bold text-gray-800">Attach DPL to <span id="zfAttachItemName" class="text-indigo-700"></span></div>
                            <button onclick="closeAttachPicker()" class="text-gray-400 hover:text-gray-700 text-lg leading-none">&times;</button>
                        </div>
                        <div class="p-3">
                            <input type="text" id="zfAttachSearch" oninput="renderAttachCandidates()" placeholder="🔍 Search DPL list (product / base / SKU / size)…" class="w-full px-3 py-1.5 border rounded text-[11px] outline-none focus:border-indigo-500">
                        </div>
                        <div id="zfAttachList" class="overflow-y-auto px-3 pb-3 space-y-1"></div>
                    </div>
                </div>
            </div>
```

- [ ] **Step 3: Add state variables**

Find the `// ── DPL Catalog review ──` marker (line ~1308) and add these declarations immediately below it:

```js
    // Zoho-first reconciliation view state
    var catalogViewMode = 'dpl';        // 'dpl' | 'zoho'
    var zfRows = [];                    // rows from GET .../by-zoho
    var zfUnlinked = [];               // attach-picker candidates
    var zfAttachItemId = null;         // Zoho item id currently being attached
```

- [ ] **Step 4: Add the view-switch + loader functions**

Add the following functions immediately **above** the existing `async function loadCatalog()` (line ~1493):

```js
    function switchCatalogView(mode) {
        catalogViewMode = mode;
        document.getElementById('cvDpl').className  = 'cv-tab px-3 py-1.5 rounded text-[11px] font-bold ' + (mode === 'dpl'  ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600');
        document.getElementById('cvZoho').className = 'cv-tab px-3 py-1.5 rounded text-[11px] font-bold ' + (mode === 'zoho' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600');
        document.getElementById('dplFirstView').classList.toggle('hidden', mode !== 'dpl');
        document.getElementById('zohoFirstView').classList.toggle('hidden', mode !== 'zoho');
        if (mode === 'zoho') loadZohoFirst();
    }

    async function loadZohoFirst() {
        var brand = currentBrandDpl || DEFAULT_BRAND;
        try {
            var resp = await fetch('/api/zoho/items/dpl-catalog/' + encodeURIComponent(brand) + '/by-zoho', {
                headers: { 'Authorization': 'Bearer ' + getToken() }
            });
            var body = await resp.json();
            if (!resp.ok || !body.success) throw new Error(body.message || ('Server error ' + resp.status));
            zfRows = (body.data && body.data.rows) || [];
            zfUnlinked = (body.data && body.data.unlinkedEntries) || [];
            renderZohoFirst();
        } catch (err) {
            showToast('Load Zoho-first error: ' + err.message, 'error');
        }
    }
```

- [ ] **Step 5: Add the render function**

Add immediately below `loadZohoFirst` (from Step 4):

```js
    function fmtMoney(n) {
        if (n == null) return '—';
        return '₹' + Number(n).toLocaleString('en-IN');
    }

    function zfStatusChip(r) {
        if (r.status === 'unmatched')
            return '<button onclick="openAttachPicker(\'' + esc(r.zoho_item_id) + '\')" class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 hover:bg-rose-200">⚠ Attach DPL</button>';
        if (r.status === 'shared')
            return '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">⚠ shared ×' + r.shared_count + '</span>';
        if (r.changed)
            return '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-700">↕ changed</span>';
        return '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700">✓ ok</span>';
    }

    function zfDiffCell(r) {
        if (r.diff == null) return '<span class="text-gray-400">—</span>';
        if (r.diff === 0)   return '<span class="text-gray-400">₹0</span>';
        var up = r.diff > 0;
        var cls = up ? 'text-rose-600' : 'text-green-600';
        var arrow = up ? '↑' : '↓';
        return '<span class="' + cls + ' font-semibold">' + (up ? '+' : '') + fmtMoney(r.diff) + ' ' + arrow + '</span>';
    }

    function renderZohoFirst() {
        var q = (document.getElementById('zfSearch').value || '').toLowerCase().trim();
        var visible = zfRows.filter(function(r) {
            if (!q) return true;
            return (r.zoho_name || '').toLowerCase().indexOf(q) !== -1 ||
                   (r.zoho_sku  || '').toLowerCase().indexOf(q) !== -1;
        });

        var unmatched = zfRows.filter(function(r){ return r.status === 'unmatched'; }).length;
        var changed   = zfRows.filter(function(r){ return r.changed; });
        document.getElementById('zfTotal').textContent = zfRows.length;
        document.getElementById('zfUnmatched').textContent = unmatched;
        document.getElementById('zfChanged').textContent = changed.length;
        document.getElementById('zfShowing').textContent = visible.length + ' of ' + zfRows.length;

        document.getElementById('zfPushCount').textContent = changed.length;
        document.getElementById('zfPushBtn').disabled = changed.length === 0;

        var tbody = document.getElementById('zohoFirstTableBody');
        tbody.innerHTML = visible.map(function(r) {
            return '<tr class="border-t hover:bg-gray-50">' +
                '<td class="px-2 py-1.5 text-left">' + esc(r.zoho_name) + '</td>' +
                '<td class="px-2 py-1.5 text-left text-gray-500">' + esc(r.zoho_sku) + '</td>' +
                '<td class="px-2 py-1.5 text-right">' + fmtMoney(r.old_dpl) + '</td>' +
                '<td class="px-2 py-1.5 text-right">' + fmtMoney(r.new_dpl) + '</td>' +
                '<td class="px-2 py-1.5 text-right">' + fmtMoney(r.new_rate) + '</td>' +
                '<td class="px-2 py-1.5 text-right">' + zfDiffCell(r) + '</td>' +
                '<td class="px-2 py-1.5 text-center">' + zfStatusChip(r) + '</td>' +
                '</tr>';
        }).join('');

        document.getElementById('zohoFirstEmpty').classList.toggle('hidden', zfRows.length !== 0);
    }
```

- [ ] **Step 6: Add the attach-picker + bulk-push functions**

Add immediately below `renderZohoFirst` (from Step 5):

```js
    function openAttachPicker(zohoItemId) {
        zfAttachItemId = zohoItemId;
        var row = zfRows.find(function(r){ return String(r.zoho_item_id) === String(zohoItemId); });
        document.getElementById('zfAttachItemName').textContent = row ? row.zoho_name : zohoItemId;
        document.getElementById('zfAttachSearch').value = '';
        document.getElementById('zfAttachModal').classList.remove('hidden');
        renderAttachCandidates();
    }

    function closeAttachPicker() {
        zfAttachItemId = null;
        document.getElementById('zfAttachModal').classList.add('hidden');
    }

    function renderAttachCandidates() {
        var q = (document.getElementById('zfAttachSearch').value || '').toLowerCase().trim();
        var list = zfUnlinked.filter(function(e) {
            if (!q) return true;
            return (e.product_name || '').toLowerCase().indexOf(q) !== -1 ||
                   (e.base_name    || '').toLowerCase().indexOf(q) !== -1 ||
                   (e.canonical_sku|| '').toLowerCase().indexOf(q) !== -1 ||
                   (e.dpl_size_label||'').toLowerCase().indexOf(q) !== -1;
        }).slice(0, 50);

        var box = document.getElementById('zfAttachList');
        if (!list.length) {
            box.innerHTML = '<div class="text-center text-gray-400 text-[11px] py-6">No unlinked DPL entries match.</div>';
            return;
        }
        box.innerHTML = list.map(function(e) {
            return '<button onclick="attachDpl(' + e.entry_id + ')" class="w-full text-left px-3 py-2 border rounded hover:bg-indigo-50 hover:border-indigo-300 transition">' +
                '<div class="text-[11px] font-semibold text-gray-800">' + esc(e.product_name) + ' · ' + esc(e.base_name || '—') + '</div>' +
                '<div class="text-[10px] text-gray-500">' + esc(e.dpl_size_label) + ' · SKU ' + esc(e.canonical_sku || '—') + ' · DPL ' + fmtMoney(e.current_dpl) + '</div>' +
                '</button>';
        }).join('');
    }

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

    async function pushZohoFirstChanged() {
        var ids = zfRows.filter(function(r){ return r.changed && r.entry_id != null; })
                        .map(function(r){ return r.entry_id; });
        if (!ids.length) return;
        var brand = currentBrandDpl || DEFAULT_BRAND;
        var btn = document.getElementById('zfPushBtn');
        var sp = document.getElementById('zfPushSpinner');
        btn.disabled = true; sp.classList.remove('hidden');
        try {
            var resp = await fetch('/api/zoho/items/dpl-catalog/' + encodeURIComponent(brand) + '/push', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: ids })
            });
            var body = await resp.json();
            if (!resp.ok || !body.success) throw new Error(body.message || ('Server error ' + resp.status));
            showToast('Pushed ' + ids.length + ' item(s) to Zoho', 'success');
            await loadZohoFirst();
        } catch (err) {
            showToast('Push error: ' + err.message, 'error');
        } finally {
            sp.classList.add('hidden');
        }
    }
```

- [ ] **Step 7: Start the server and verify in the browser**

```bash
node server.js
```

Open `http://localhost:3000/admin-dpl.html`, select the Birla Opus brand, and load the catalog. Then:

1. Click the **Zoho-first** toggle → the table loads one row per active Zoho item.
2. Confirm the summary chips (Zoho items / No match / Changed) show non-zero counts.
3. Confirm **⚠ Attach DPL** rows sort to the top, **↕ changed** next.
4. Click **⚠ Attach DPL** on an unmatched row → picker opens → search → click a DPL entry → toast "DPL attached" → row updates.
5. Click **🚀 Push updated DPL (N)** → toast "Pushed N item(s)" → diffs clear (changed count drops).
6. Switch back to **DPL-first** → the original view is intact and unchanged.

- [ ] **Step 8: Commit**

```bash
git add public/admin-dpl.html
git commit -m "feat(dpl-catalog-ui): Zoho-first reconciliation tab — attach DPL + bulk push"
```

---

### Task 4: E2E render test (Playwright)

**Files:**
- Create: `tests/e2e/admin-dpl-zoho-first.spec.js`

The existing `tests/e2e/admin-dpl-render.spec.js` uses **Playwright** (not jsdom): it
loads the real `admin-dpl.html` via a `file://` URL, stubs the nav loader +
`getToken` with `addInitScript`, then `page.evaluate(...)` sets `window` globals and
calls a render function. The page's top-level `var`/`function` declarations (e.g.
`var catalogEntries`, `function renderCatalog`) live at script scope = `window`, so
the same is true for our `var zfRows` and `function renderZohoFirst`. We reuse that
harness exactly.

- [ ] **Step 1: Write the test**

Create `tests/e2e/admin-dpl-zoho-first.spec.js`:

```js
// Integration smoke for the REAL admin-dpl.html renderZohoFirst(): loads the actual
// page, injects sample Zoho-first rows, and asserts the table renders with the
// expected status chips, diff, counts and push-button state. Mirrors the harness in
// admin-dpl-render.spec.js.
/* global window, document */
const { test, expect } = require('@playwright/test');
const { pathToFileURL } = require('url');
const path = require('path');

const pageUrl = pathToFileURL(
    path.join(__dirname, '..', '..', 'public', 'admin-dpl.html')
).href;

test('renderZohoFirst populates the table, unmatched first', async ({ page }) => {
    const pageErrors = [];
    page.on('pageerror', e => pageErrors.push(e.message));
    await page.route('**/universal-nav-loader.js', r => r.abort());
    await page.addInitScript(() => {
        window.requireAdminOrRedirect = function () {};
        window.getToken = function () { return 'test'; };
    });
    await page.goto(pageUrl).catch(() => {});

    const res = await page.evaluate(() => {
        // zfRows is the already-sorted output of buildZohoFirstView (server sorts).
        window.zfRows = [
            { zoho_item_id: 'Z2', zoho_name: 'BIRLA OPUS A 1L',  zoho_sku: 'WPRC1',  old_dpl: 620,  old_rate: 805,  entry_id: null, new_dpl: null, new_rate: null, diff: null, status: 'unmatched', changed: false, shared_count: 0 },
            { zoho_item_id: 'Z1', zoho_name: 'BIRLA OPUS A 4L',  zoho_sku: 'WPRC4',  old_dpl: 2050, old_rate: 2660, entry_id: 11,   new_dpl: 2180, new_rate: 2830, diff: 130,  status: 'matched',   changed: true,  shared_count: 0 },
            { zoho_item_id: 'Z3', zoho_name: 'BIRLA OPUS B 10L', zoho_sku: 'ADSS10', old_dpl: 4100, old_rate: 5322, entry_id: 13,   new_dpl: 4100, new_rate: 5322, diff: 0,    status: 'matched',   changed: false, shared_count: 0 },
        ];
        window.zfUnlinked = [];

        const panel = document.getElementById('catalogPanel');
        if (panel) panel.classList.remove('hidden');
        document.getElementById('zohoFirstView').classList.remove('hidden');
        window.renderZohoFirst();

        const tbody = document.getElementById('zohoFirstTableBody');
        const rowEls = tbody.querySelectorAll('tr');
        return {
            rows: rowEls.length,
            firstText: rowEls[0] ? rowEls[0].textContent : '',
            firstHasButton: !!(rowEls[0] && rowEls[0].querySelector('button')),
            secondText: rowEls[1] ? rowEls[1].textContent : '',
            unmatched: document.getElementById('zfUnmatched').textContent,
            changed: document.getElementById('zfChanged').textContent,
            pushDisabled: document.getElementById('zfPushBtn').disabled,
        };
    });

    expect(pageErrors).toEqual([]);
    expect(res.rows).toBe(3);
    expect(res.firstText).toContain('BIRLA OPUS A 1L'); // unmatched sorted first
    expect(res.firstHasButton).toBe(true);              // Attach DPL button present
    expect(res.firstText).toContain('Attach DPL');
    expect(res.secondText).toContain('+₹130');          // changed row shows diff
    expect(res.secondText).toContain('changed');
    expect(res.unmatched).toBe('1');
    expect(res.changed).toBe('1');
    expect(res.pushDisabled).toBe(false);               // 1 changed row → push enabled
});
```

- [ ] **Step 2: Run the test**

```bash
npx playwright test tests/e2e/admin-dpl-zoho-first.spec.js
```

Expected: PASS — 1 test, 3 rows, unmatched first, push enabled. (If the repo runs
Playwright via a different script, mirror how `admin-dpl-render.spec.js` is run —
check `package.json` scripts and `playwright.config.*`.)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/admin-dpl-zoho-first.spec.js
git commit -m "test(dpl-catalog-ui): e2e render for Zoho-first view"
```

---

## Run Full Test Suite

Jest only matches `**/tests/**/*.test.js` (see `jest.config.js`); Playwright runs
the `*.spec.js` e2e files separately.

```bash
npm test                 # jest — includes the new dpl-catalog-zoho-first.test.js
npm run test:e2e         # playwright — includes admin-dpl-zoho-first.spec.js
```

Expected: all existing unit tests pass + the new `dpl-catalog-zoho-first` unit test;
all Playwright specs pass + the new `admin-dpl-zoho-first` render spec.

---

## Deploy (after user approval)

```bash
ssh hetzner "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && npm install && pm2 restart business-manager"
```

Then hard-refresh `admin-dpl.html` (no CSS/JS cache-bust on this page — see [[reference_css_hidden_responsive_gotcha]]) and verify the Zoho-first tab on prod.
