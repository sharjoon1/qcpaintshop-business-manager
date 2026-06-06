# Zoho-First Cards + Auto-Proposed DPL + Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Zoho-first DPL reconciliation tab to parity with the DPL-first view — mobile cards, an auto-proposed DPL match (suggest + one-click Accept) for each unmatched Zoho item, and a filter chip bar.

**Architecture:** A new pure helper `proposeDplForZoho(zohoItem, unlinkedEntries)` in `services/dpl-catalog.js` reverse-matches the existing DPL→Zoho linker (exact-SKU → SKU-reconstruct → name+tier) using stored catalog fields. `buildZohoFirstView` attaches a `proposal` to each unmatched row and adds `size_tier` to `unlinkedEntries`; the `by-zoho` endpoint is unchanged. The frontend (`public/admin-dpl.html`) adds a filter bar, mobile cards, and an Accept action that reuses the existing `confirm-link` endpoint.

**Tech Stack:** Node.js, Jest, Playwright, vanilla JS, Tailwind (admin indigo `#667eea`).

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `services/dpl-catalog.js` | Modify | Add pure `proposeDplForZoho`; wire `proposal` + `size_tier` into `buildZohoFirstView` |
| `tests/unit/dpl-catalog-zoho-first.test.js` | Modify | Unit tests for `proposeDplForZoho` + the `buildZohoFirstView` additions |
| `public/admin-dpl.html` | Modify | Filter bar, mobile cards, proposal Accept, render rewrite |
| `tests/e2e/admin-dpl-zoho-first.spec.js` | Modify | E2E: proposal Accept button, filter narrows rows, cards populate |

---

### Task 1: Pure helper `proposeDplForZoho` (TDD)

**Files:**
- Modify: `services/dpl-catalog.js` (add function before `module.exports`; add to export list)
- Modify: `tests/unit/dpl-catalog-zoho-first.test.js` (add a new `describe` block)

Background the implementer must know: `proposeDplForZoho` lives in `services/dpl-catalog.js`, so it can call the module-private helpers `zohoSkuStem`, `birlaBaseCodes`, `stemEndsWithCode`, `tokenize`, `hasAllTokens`, `normalizeSizeTier`, `extractSizeFromZohoName` directly (no import/export needed for those). The DPL catalog does NOT store a `base_code` column, so S1 derives base codes from the stored `base_name` via `birlaBaseCodes`. Relevant facts used to build the fixtures: `SIZE_CODE = {'1L':'01','4L':'04','10L':'10','20L':'20'}`; `BASE_NAME_CODE` maps `white → ['wt','wht']`; `zohoSkuStem({sku,name})` returns `{stem,tier}` only when the SKU ends with the tier's size-code.

- [ ] **Step 1: Write the failing tests**

In `tests/unit/dpl-catalog-zoho-first.test.js`, add this at the END of the file (after the existing `describe('buildZohoFirstView', ...)` block):

```js
const { proposeDplForZoho } = require('../../services/dpl-catalog');

describe('proposeDplForZoho', () => {
    // Unlinked DPL catalog entries (subset of getCatalog with zoho_item_id == null),
    // already carrying size_tier (added in Task 2).
    const unlinked = [
        // entry 1 has NO canonical SKU on purpose, so the S1 test exercises
        // reconstruction (not exact-SKU). Its base 'White' + tier '4L' is what matches.
        { entry_id: 1, product_name: 'Weather Shield', base_name: 'White', size_tier: '4L',  dpl_size_label: '3.6L', current_dpl: 2180, canonical_sku: '' },
        { entry_id: 2, product_name: 'Weather Shield', base_name: 'Clear', size_tier: '10L', dpl_size_label: '9L',   current_dpl: 4100, canonical_sku: 'PBS9910' },
        { entry_id: 3, product_name: 'Pure Elegance',  base_name: 'White', size_tier: '1L',  dpl_size_label: '0.9L', current_dpl: 700,  canonical_sku: 'PE WT 01' },
    ];

    test('S0 exact canonical SKU → high / exact-sku', () => {
        const p = proposeDplForZoho(
            { zoho_item_id: 'Z', zoho_item_name: 'BIRLA OPUS WEATHER SHIELD 10 L', zoho_sku: 'PBS9910' },
            unlinked
        );
        expect(p).not.toBeNull();
        expect(p.entry_id).toBe(2);
        expect(p.confidence).toBe('high');
        expect(p.reason).toBe('exact-sku');
        expect(p.current_dpl).toBe(4100);
        expect(p.dpl_size_label).toBe('9L');
    });

    test('S1 SKU reconstruct (base_name + tier) → high / sku-reconstruct', () => {
        // Zoho SKU 'PBSWT04' → stem 'pbswt', tier '4L'; entry 1 base 'White'→'wt' ends the stem.
        const p = proposeDplForZoho(
            { zoho_item_id: 'Z', zoho_item_name: 'BIRLA OPUS WEATHER SHIELD 4 L', zoho_sku: 'PBSWT04' },
            unlinked
        );
        expect(p).not.toBeNull();
        expect(p.entry_id).toBe(1);
        expect(p.confidence).toBe('high');
        expect(p.reason).toBe('sku-reconstruct');
    });

    test('S1 ambiguous (two entries reconstruct to same stem+tier) → null', () => {
        const dup = [
            { entry_id: 10, product_name: 'A', base_name: 'White', size_tier: '4L', dpl_size_label: '3.6L', current_dpl: 100, canonical_sku: 'X1' },
            { entry_id: 11, product_name: 'B', base_name: 'White', size_tier: '4L', dpl_size_label: '3.6L', current_dpl: 200, canonical_sku: 'X2' },
        ];
        const p = proposeDplForZoho(
            { zoho_item_id: 'Z', zoho_item_name: 'BIRLA OPUS 4 L', zoho_sku: 'PBSWT04' },
            dup
        );
        expect(p).toBeNull();
    });

    test('S2 name + tier (SKU not a clean Birla stem) → low / product+tier-only', () => {
        // SKU 'RANDOM' yields no stem; name tokens "weather shield" + tier 10L match entry 2.
        const p = proposeDplForZoho(
            { zoho_item_id: 'Z', zoho_item_name: 'WEATHER SHIELD 10 L', zoho_sku: 'RANDOM' },
            unlinked
        );
        expect(p).not.toBeNull();
        expect(p.entry_id).toBe(2);
        expect(p.confidence).toBe('low');
        expect(p.reason).toBe('product+tier-only');
    });

    test('S2 ambiguous (two entries match name+tier) → null', () => {
        const dup = [
            { entry_id: 20, product_name: 'Weather Shield', base_name: 'White', size_tier: '10L', dpl_size_label: '9L', current_dpl: 100, canonical_sku: 'A' },
            { entry_id: 21, product_name: 'Weather Shield', base_name: 'Clear', size_tier: '10L', dpl_size_label: '9L', current_dpl: 200, canonical_sku: 'B' },
        ];
        const p = proposeDplForZoho(
            { zoho_item_id: 'Z', zoho_item_name: 'WEATHER SHIELD 10 L', zoho_sku: 'RANDOM' },
            dup
        );
        expect(p).toBeNull();
    });

    test('no candidate → null', () => {
        const p = proposeDplForZoho(
            { zoho_item_id: 'Z', zoho_item_name: 'SOMETHING ELSE 20 L', zoho_sku: 'NOPE' },
            unlinked
        );
        expect(p).toBeNull();
    });

    test('blank SKU falls through to S2 by name+tier', () => {
        const p = proposeDplForZoho(
            { zoho_item_id: 'Z', zoho_item_name: 'PURE ELEGANCE 1 L', zoho_sku: '' },
            unlinked
        );
        expect(p).not.toBeNull();
        expect(p.entry_id).toBe(3);
        expect(p.reason).toBe('product+tier-only');
    });

    test('handles empty / missing inputs', () => {
        expect(proposeDplForZoho({}, [])).toBeNull();
        expect(proposeDplForZoho(null, null)).toBeNull();
    });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx jest tests/unit/dpl-catalog-zoho-first.test.js --no-coverage
```

Expected: the new `proposeDplForZoho` tests FAIL with `proposeDplForZoho is not a function`. The existing `buildZohoFirstView` tests still pass.

- [ ] **Step 3: Implement `proposeDplForZoho`**

In `services/dpl-catalog.js`, add this function immediately **before** the `module.exports = {` line:

```js
// ── Reverse matcher: propose the best unlinked DPL entry for a Zoho item ─────
// Inverse of linkEntryToZoho. Pure/deterministic. Uses STORED catalog fields
// (base_code is not stored, so S1 derives codes from base_name via birlaBaseCodes).
//   zohoItem       : { zoho_item_id, zoho_item_name, zoho_sku }
//   unlinkedEntries: [{ entry_id, product_name, base_name, size_tier,
//                       dpl_size_label, current_dpl, canonical_sku }]
// Returns the single best candidate or null:
//   S0 exact canonical SKU         → confidence 'high', reason 'exact-sku'
//   S1 SKU reconstruct (base+tier) → confidence 'high', reason 'sku-reconstruct'
//   S2 product tokens + tier       → confidence 'low',  reason 'product+tier-only'
// Ambiguous S1/S2 (more than one candidate) → null (never guess).
function proposeDplForZoho(zohoItem, unlinkedEntries) {
    const zi = zohoItem || {};
    const entries = unlinkedEntries || [];
    const sku = String(zi.zoho_sku || '');
    const name = String(zi.zoho_item_name || '');

    const shape = (e, confidence, reason) => ({
        entry_id: e.entry_id,
        product_name: e.product_name || '',
        base_name: e.base_name || '',
        dpl_size_label: e.dpl_size_label || '',
        current_dpl: e.current_dpl != null ? e.current_dpl : null,
        confidence,
        reason,
    });

    // S0: exact canonical SKU
    if (sku) {
        const want = sku.toUpperCase();
        const hit = entries.find(e => String(e.canonical_sku || '').toUpperCase() === want);
        if (hit) return shape(hit, 'high', 'exact-sku');
    }

    // S1: SKU reconstruct — Zoho stem+tier vs entry base_name codes at the same tier.
    const info = zohoSkuStem({ sku, name });
    if (info) {
        const s1 = entries.filter(e => {
            if (e.size_tier !== info.tier) return false;
            const codes = birlaBaseCodes(e.base_name);
            return codes && codes.some(c => stemEndsWithCode(info.stem, c));
        });
        if (s1.length === 1) return shape(s1[0], 'high', 'sku-reconstruct');
        if (s1.length > 1) return null; // ambiguous — don't guess
    }

    // S2: product-name tokens + tier fallback.
    const tier = normalizeSizeTier(extractSizeFromZohoName(name, sku));
    const tokenSet = new Set(tokenize(name + ' ' + sku));
    const s2 = entries.filter(e =>
        e.size_tier === tier && hasAllTokens(tokenSet, tokenize(e.product_name))
    );
    if (s2.length === 1) return shape(s2[0], 'low', 'product+tier-only');

    return null;
}
```

Add `proposeDplForZoho` to the `module.exports` object. Change:

```js
    updateAppliedPrices, updateCanonicalFields, markPushed, setNotInZoho,
    buildZohoFirstView,
};
```

to:

```js
    updateAppliedPrices, updateCanonicalFields, markPushed, setNotInZoho,
    buildZohoFirstView, proposeDplForZoho,
};
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest tests/unit/dpl-catalog-zoho-first.test.js --no-coverage
```

Expected: PASS — all existing tests + the 8 new `proposeDplForZoho` tests green.

- [ ] **Step 5: Commit**

```bash
git add services/dpl-catalog.js tests/unit/dpl-catalog-zoho-first.test.js
git commit -m "feat(dpl-catalog): proposeDplForZoho — reverse matcher for unmatched Zoho items"
```

---

### Task 2: Wire `proposal` + `size_tier` into `buildZohoFirstView`

**Files:**
- Modify: `services/dpl-catalog.js` (replace the `buildZohoFirstView` function body)
- Modify: `tests/unit/dpl-catalog-zoho-first.test.js` (add assertions)

- [ ] **Step 1: Add the failing assertions**

In `tests/unit/dpl-catalog-zoho-first.test.js`, inside the existing `describe('buildZohoFirstView', ...)` block, add these tests (after the existing ones):

```js
    test('unmatched rows carry a proposal field; matched/shared carry null', () => {
        const { rows } = buildZohoFirstView(zohoItems, catalogEntries);
        const z1 = rows.find(r => r.zoho_item_id === 'Z1'); // matched
        const z2 = rows.find(r => r.zoho_item_id === 'Z2'); // unmatched
        const z4 = rows.find(r => r.zoho_item_id === 'Z4'); // shared
        expect(z1.proposal).toBeNull();
        expect(z4.proposal).toBeNull();
        expect(z2).toHaveProperty('proposal'); // present (value may be a proposal or null)
    });

    test('unlinkedEntries now include size_tier', () => {
        const { unlinkedEntries } = buildZohoFirstView(zohoItems, catalogEntries);
        expect(unlinkedEntries[0]).toHaveProperty('size_tier');
    });

    test('an unmatched Zoho item whose SKU exactly matches an unlinked entry gets that proposal', () => {
        const zItems = [{ zoho_item_id: 'ZX', zoho_item_name: 'BIRLA OPUS X 1L', zoho_sku: 'WPRC1', zoho_cf_dpl: '600', zoho_rate: '780' }];
        const entries = [{ id: 99, zoho_item_id: null, current_dpl: '700', current_rate: '910', product_name: 'X', base_name: 'White', size_tier: '1L', dpl_size_label: '0.9L', canonical_sku: 'WPRC1' }];
        const { rows } = buildZohoFirstView(zItems, entries);
        expect(rows[0].status).toBe('unmatched');
        expect(rows[0].proposal).not.toBeNull();
        expect(rows[0].proposal.entry_id).toBe(99);
        expect(rows[0].proposal.reason).toBe('exact-sku');
    });
```

Note: the existing fixture's `catalogEntries` (top of the file) must carry `size_tier` on at least the unlinked entry for these to be meaningful. The unlinked entry there is `{ id: 99, ... base_name: 'White', dpl_size_label: '0.9L', canonical_sku: 'WPRC1' }`. Add `size_tier: '1L'` to it in the fixture so the proposal path has a tier to work with. Make that one-line fixture edit now (find the `id: 99` entry in the file and add `size_tier: '1L',`).

- [ ] **Step 2: Run the tests to verify the new ones fail**

```bash
npx jest tests/unit/dpl-catalog-zoho-first.test.js --no-coverage
```

Expected: the 3 new `buildZohoFirstView` assertions FAIL (`proposal` undefined / `size_tier` missing). Everything else passes.

- [ ] **Step 3: Replace `buildZohoFirstView`**

In `services/dpl-catalog.js`, replace the ENTIRE existing `buildZohoFirstView` function with this version (computes `unlinkedEntries` first, attaches `proposal` to unmatched rows, adds `size_tier`):

```js
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

    // Unlinked entries = attach-picker candidates + reverse-match pool (carry size_tier).
    const unlinkedEntries = (catalogEntries || [])
        .filter(e => e.zoho_item_id == null)
        .map(e => ({
            entry_id: e.id,
            product_name: e.product_name || '',
            base_name: e.base_name || '',
            size_tier: e.size_tier || '',
            dpl_size_label: e.dpl_size_label || '',
            current_dpl: num(e.current_dpl),
            canonical_sku: e.canonical_sku || '',
        }));

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

        const proposal = status === 'unmatched'
            ? proposeDplForZoho({ zoho_item_id: zi.zoho_item_id, zoho_item_name: zi.zoho_item_name, zoho_sku: zi.zoho_sku }, unlinkedEntries)
            : null;

        return {
            zoho_item_id: zi.zoho_item_id,
            zoho_name: zi.zoho_item_name || '',
            zoho_sku: zi.zoho_sku || '',
            category: zi.zoho_category_name || '',
            old_dpl, old_rate,
            entry_id, new_dpl, new_rate, diff,
            status, changed, shared_count, proposal,
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

    return { rows, unlinkedEntries };
}
```

(`proposeDplForZoho` is defined earlier in Task 1 — it is hoisted as a function declaration, so the call site here works regardless of source order within the file.)

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest tests/unit/dpl-catalog-zoho-first.test.js --no-coverage
```

Expected: PASS — all `buildZohoFirstView` + `proposeDplForZoho` tests green.

- [ ] **Step 5: Run the full unit suite (no regression)**

```bash
npm test
```

Expected: all suites pass (the by-zoho endpoint and everything else unaffected; rows just gained a `proposal` field).

- [ ] **Step 6: Commit**

```bash
git add services/dpl-catalog.js tests/unit/dpl-catalog-zoho-first.test.js
git commit -m "feat(dpl-catalog): attach proposal to unmatched Zoho-first rows + size_tier on unlinkedEntries"
```

---

### Task 3: Frontend — cards, filters, Accept (`public/admin-dpl.html`)

**Files:**
- Modify: `public/admin-dpl.html`

All edits are in the Zoho-first view region (HTML ~lines 403–436) and its script functions (~lines 1366, 1579–1639). Read those regions first to confirm the anchors match before editing.

- [ ] **Step 1: Add the filter chip bar + make the table desktop-only**

Find this line (the Zoho-first table wrapper, ~line 419):

```html
                    <div class="overflow-x-auto border rounded-lg">
```

Replace it with (filter bar inserted above, table wrapper gains `hidden sm:block`):

```html
                    <div class="flex flex-wrap gap-1 mb-2">
                        <button onclick="setZohoFilter('all')"       id="zffAll"       class="zf-filter px-2 py-1 rounded text-[11px] font-semibold bg-indigo-600 text-white">All</button>
                        <button onclick="setZohoFilter('unmatched')" id="zffUnmatched" class="zf-filter px-2 py-1 rounded text-[11px] font-semibold bg-gray-100 text-gray-600">⚠ No match</button>
                        <button onclick="setZohoFilter('changed')"   id="zffChanged"   class="zf-filter px-2 py-1 rounded text-[11px] font-semibold bg-gray-100 text-gray-600">↕ Changed</button>
                        <button onclick="setZohoFilter('shared')"    id="zffShared"    class="zf-filter px-2 py-1 rounded text-[11px] font-semibold bg-gray-100 text-gray-600">⚠ Shared</button>
                        <button onclick="setZohoFilter('unchanged')" id="zffUnchanged" class="zf-filter px-2 py-1 rounded text-[11px] font-semibold bg-gray-100 text-gray-600">✓ Unchanged</button>
                    </div>
                    <div class="overflow-x-auto border rounded-lg hidden sm:block">
```

- [ ] **Step 2: Add the mobile cards container**

Find this line (~line 435):

```html
                    <div id="zohoFirstEmpty" class="hidden text-center text-gray-400 text-xs py-8">No Zoho items for this brand.</div>
```

Replace it with (cards container added above the empty-state):

```html
                    <div id="zohoFirstCards" class="sm:hidden space-y-2"></div>
                    <div id="zohoFirstEmpty" class="hidden text-center text-gray-400 text-xs py-8">No Zoho items for this brand.</div>
```

- [ ] **Step 3: Add the `zfFilter` state variable**

Find this line (~line 1366):

```js
    var zfRows = [];                    // rows from GET .../by-zoho
```

Add immediately below it:

```js
    var zfFilter = 'all';              // 'all' | 'unmatched' | 'changed' | 'shared' | 'unchanged'
```

- [ ] **Step 4: Replace `zfStatusChip` with chip + proposal/card helpers**

Find the entire `zfStatusChip` function (~lines 1584–1592):

```js
    function zfStatusChip(r) {
        if (r.status === 'unmatched')
            return '<button onclick="openAttachPicker(\'' + esc(r.zoho_item_id) + '\')" class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700 hover:bg-rose-200">⚠ Attach DPL</button>';
        if (r.status === 'shared')
            return '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">⚠ shared ×' + r.shared_count + '</span>';
        if (r.changed)
            return '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-700">↕ changed</span>';
        return '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700">✓ ok</span>';
    }
```

Replace it with (status is now a pure label; actions + proposal + card live in helpers):

```js
    function zfStatusChip(r) {
        if (r.status === 'unmatched')
            return '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-700">⚠ no match</span>';
        if (r.status === 'shared')
            return '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-700">⚠ shared ×' + r.shared_count + '</span>';
        if (r.changed)
            return '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-700">↕ changed</span>';
        return '<span class="px-2 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700">✓ ok</span>';
    }

    // Action area for an unmatched row: auto-proposal (if any) + Accept + Attach DPL.
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

    // One mobile card per row (mirrors the DPL-first card style).
    function zfCardHtml(r) {
        var price = fmtMoney(r.old_dpl) + ' <span class="text-gray-400">→</span> ' + fmtMoney(r.new_dpl) +
                    ' <span class="text-gray-400">→ ' + fmtMoney(r.new_rate) + '</span>';
        return '<div class="border rounded-lg p-3 bg-white">' +
            '<div class="flex items-start justify-between gap-2">' +
                '<div class="min-w-0"><div class="font-semibold text-gray-800 truncate">' + esc(r.zoho_name) + '</div>' +
                '<div class="text-[10px] font-mono text-gray-400">' + esc(r.zoho_sku) + '</div></div>' +
                zfStatusChip(r) +
            '</div>' +
            '<div class="text-[12px] text-gray-700 mt-1">' + price + ' &nbsp; ' + zfDiffCell(r) + '</div>' +
            zfProposalHtml(r) +
        '</div>';
    }
```

- [ ] **Step 5: Replace `renderZohoFirst` and add filter helpers**

Find the entire `renderZohoFirst` function (~lines 1603–1639, the version that builds `tbody.innerHTML` and sets `zohoFirstEmpty`). Replace it with:

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

    function setZohoFilter(f) {
        zfFilter = f;
        var ids = { all: 'zffAll', unmatched: 'zffUnmatched', changed: 'zffChanged', shared: 'zffShared', unchanged: 'zffUnchanged' };
        document.querySelectorAll('.zf-filter').forEach(function(b){ b.className = 'zf-filter px-2 py-1 rounded text-[11px] font-semibold bg-gray-100 text-gray-600'; });
        var active = document.getElementById(ids[f]);
        if (active) active.className = 'zf-filter px-2 py-1 rounded text-[11px] font-semibold bg-indigo-600 text-white';
        renderZohoFirst();
    }

    function renderZohoFirst() {
        var visible = visibleZohoFirstRows();

        var unmatched = zfRows.filter(function(r){ return r.status === 'unmatched'; }).length;
        var changed   = zfRows.filter(function(r){ return r.changed; });
        document.getElementById('zfTotal').textContent = zfRows.length;
        document.getElementById('zfUnmatched').textContent = unmatched;
        document.getElementById('zfChanged').textContent = changed.length;
        document.getElementById('zfShowing').textContent = visible.length + ' of ' + zfRows.length;

        document.getElementById('zfPushCount').textContent = changed.length;
        document.getElementById('zfPushBtn').disabled = changed.length === 0;

        document.getElementById('zohoFirstTableBody').innerHTML = visible.map(function(r) {
            return '<tr class="border-t hover:bg-gray-50 align-top">' +
                '<td class="px-2 py-1.5 text-left">' + esc(r.zoho_name) + '</td>' +
                '<td class="px-2 py-1.5 text-left text-gray-500">' + esc(r.zoho_sku) + '</td>' +
                '<td class="px-2 py-1.5 text-right">' + fmtMoney(r.old_dpl) + '</td>' +
                '<td class="px-2 py-1.5 text-right">' + fmtMoney(r.new_dpl) + '</td>' +
                '<td class="px-2 py-1.5 text-right">' + fmtMoney(r.new_rate) + '</td>' +
                '<td class="px-2 py-1.5 text-right">' + zfDiffCell(r) + '</td>' +
                '<td class="px-2 py-1.5 text-center">' + zfStatusChip(r) + zfProposalHtml(r) + '</td>' +
                '</tr>';
        }).join('');

        document.getElementById('zohoFirstCards').innerHTML = visible.map(zfCardHtml).join('');

        var emptyEl = document.getElementById('zohoFirstEmpty');
        emptyEl.textContent = zfRows.length === 0 ? 'No Zoho items for this brand.' : 'No Zoho items match.';
        emptyEl.classList.toggle('hidden', visible.length !== 0);
    }
```

- [ ] **Step 6: Add `acceptProposal`**

Find the existing `async function attachDpl(entryId) {` (~line 1678). Add this new function immediately **above** it:

```js
    async function acceptProposal(zohoItemId, entryId) {
        try {
            var resp = await fetch('/api/zoho/items/dpl-catalog/entry/' + entryId + '/confirm-link', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + getToken(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ zoho_item_id: zohoItemId })
            });
            var body = await resp.json();
            if (!resp.ok || !body.success) throw new Error(body.message || ('Server error ' + resp.status));
            showToast('Linked proposed DPL', 'success');
            await loadZohoFirst();
        } catch (err) {
            showToast('Accept error: ' + err.message, 'error');
        }
    }
```

- [ ] **Step 7: Static verification**

1. `node -e "require('./routes/zoho'); console.log('OK')"` → expect `OK` (HTML edits don't affect server, but confirms nothing broke that the page require-chain touches — it doesn't; this is just a smoke check).
2. Grep that each new function name is defined exactly once: `zfProposalHtml`, `zfCardHtml`, `visibleZohoFirstRows`, `setZohoFilter`, `acceptProposal`. And that `#zohoFirstCards`, `#zffAll`, `.zf-filter` appear in the markup.
3. Confirm the table wrapper now has `hidden sm:block` and the cards div has `sm:hidden`.
4. `npx jest tests/unit/dpl-catalog-zoho-first.test.js --no-coverage` → still green (repo health).

- [ ] **Step 8: Commit**

```bash
git add public/admin-dpl.html
git commit -m "feat(dpl-catalog-ui): Zoho-first mobile cards + filter bar + Accept proposed DPL"
```

---

### Task 4: E2E — proposal Accept, filter, cards (Playwright)

**Files:**
- Modify: `tests/e2e/admin-dpl-zoho-first.spec.js`

The existing spec already loads the real page and drives `renderZohoFirst`. Add a second test for the new behavior. Read the existing file first to reuse its harness exactly.

- [ ] **Step 1: Append a new test**

Add this test to `tests/e2e/admin-dpl-zoho-first.spec.js` (after the existing `test(...)`):

```js
test('proposal Accept button, filter narrows rows, and cards populate', async ({ page }) => {
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
            { zoho_item_id: 'Z2', zoho_name: 'BIRLA OPUS A 1L', zoho_sku: 'WPRC1', old_dpl: 620, old_rate: 805, entry_id: null, new_dpl: null, new_rate: null, diff: null, status: 'unmatched', changed: false, shared_count: 0,
              proposal: { entry_id: 99, product_name: 'A', base_name: 'White', dpl_size_label: '0.9L', current_dpl: 700, confidence: 'high', reason: 'exact-sku' } },
            { zoho_item_id: 'Z1', zoho_name: 'BIRLA OPUS A 4L', zoho_sku: 'WPRC4', old_dpl: 2050, old_rate: 2660, entry_id: 11, new_dpl: 2180, new_rate: 2830, diff: 130, status: 'matched', changed: true, shared_count: 0, proposal: null },
        ];
        window.zfUnlinked = [];

        const panel = document.getElementById('catalogPanel');
        if (panel) panel.classList.remove('hidden');
        document.getElementById('zohoFirstView').classList.remove('hidden');
        window.renderZohoFirst();

        const beforeRows = document.querySelectorAll('#zohoFirstTableBody tr').length;
        const cardCount = document.querySelectorAll('#zohoFirstCards > div').length;
        const tableHtml = document.getElementById('zohoFirstTableBody').innerHTML;

        // Apply the "Changed" filter — should drop the unmatched row.
        window.setZohoFilter('changed');
        const afterRows = document.querySelectorAll('#zohoFirstTableBody tr').length;
        const afterFirst = document.querySelectorAll('#zohoFirstTableBody tr')[0];

        return {
            beforeRows,
            cardCount,
            hasAccept: tableHtml.indexOf('Accept') !== -1,
            hasProposedDpl: tableHtml.indexOf('Proposed') !== -1,
            afterRows,
            afterFirstText: afterFirst ? afterFirst.textContent : '',
        };
    });

    expect(pageErrors).toEqual([]);
    expect(res.beforeRows).toBe(2);          // both rows under "All"
    expect(res.cardCount).toBe(2);           // mobile cards populated
    expect(res.hasAccept).toBe(true);        // proposal Accept button rendered
    expect(res.hasProposedDpl).toBe(true);   // proposal details rendered
    expect(res.afterRows).toBe(1);           // "Changed" filter → only the changed row
    expect(res.afterFirstText).toContain('BIRLA OPUS A 4L');
});
```

- [ ] **Step 2: Run the e2e spec**

```bash
npx playwright test tests/e2e/admin-dpl-zoho-first.spec.js
```

Expected: 2 passed (the original render test + this new one). If the original test fails because of the status-chip text change, that is a real regression to investigate — but it should still pass: the unmatched row still contains an `Attach DPL` button (now via `zfProposalHtml`) and the changed row still contains `changed`.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/admin-dpl-zoho-first.spec.js
git commit -m "test(dpl-catalog-ui): e2e for Zoho-first proposal Accept + filter + cards"
```

---

## Run Full Test Suite

```bash
npm test                 # jest — unit (incl. proposeDplForZoho + buildZohoFirstView)
npm run test:e2e         # playwright — admin-dpl-zoho-first (2 tests) + others
```

Expected: all jest suites pass; all Playwright specs pass including the 2 Zoho-first render tests.

---

## Deploy (after user approval)

```bash
ssh hetzner "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && npm install && pm2 restart business-manager"
```

Then hard-refresh `admin-dpl.html` (no JS/CSS cache-bust — see [[reference_css_hidden_responsive_gotcha]]) → Zoho-first tab → verify cards on mobile width, filter chips, and that an unmatched item shows a Proposed DPL with a working ✓ Accept.
