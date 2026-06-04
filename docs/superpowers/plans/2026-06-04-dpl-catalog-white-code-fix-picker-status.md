# DPL Catalog — White-code fix + picker link-status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop White from stealing Clear's `…99…` SKU (99 = Clear, not White) and let White match SKUs that encode it as WT (e.g. PBSWT04); also show, in the re-pick picker, which Zoho items are already linked to a catalog entry.

**Architecture:** `dplBaseStem` (single stem, `white→'99'`) becomes `dplBaseStems` (candidate stems, `white→['wt','wht']`, 99 removed). S1 in `linkEntryToZoho` tries all candidates; unique hit confirms. Picker render annotates each result from the loaded `catalogEntries`. No migration. Rebuild after deploy.

**Tech Stack:** Node.js CommonJS, Jest, vanilla JS.

**Spec:** `docs/superpowers/specs/2026-06-04-dpl-catalog-white-code-fix-picker-status-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `services/dpl-catalog.js` | `BASE_WORD_CODE` multi-code (no 99); `dplBaseStems`; S1 tries all; exports | Modify |
| `tests/unit/dpl-catalog.test.js` | reframe dplBaseStem→dplBaseStems + the White=PE9901 assumptions (PE99=Clear) | Modify |
| `public/admin-dpl.html` | `catLinkBadge` in the re-pick picker | Modify |

---

## Task 1: White-code fix in the linker + tests

**Files:** Modify `services/dpl-catalog.js`, `tests/unit/dpl-catalog.test.js`.

- [ ] **Step 1: Replace the `dplBaseStem` definition + `BASE_WORD_CODE`** — find:

```javascript
// Colour-word → Zoho base segment (numeric bases pass through; words need a map).
// Extend as new special bases surface; unmapped ones fall to review.
const BASE_WORD_CODE = { white: '99' };

// DPL baseCode ("PE White" / "PE 1") → SKU stem ("pe99" / "pe1").
function dplBaseStem(baseCode) {
    const bc = String(baseCode == null ? '' : baseCode).trim().toLowerCase();
    if (!bc) return '';
    const m = bc.match(/^([a-z]+)\s+(.+)$/);
    if (!m) return bc.replace(/[^a-z0-9]+/g, '');
    let base = m[2].replace(/\s+/g, '');
    base = BASE_WORD_CODE[base] || base;
    return m[1] + base.replace(/[^a-z0-9]+/g, '');
}
```
Replace with:

```javascript
// Colour word → possible Zoho SKU base codes. NOTE: on Birla Opus 99 = CLEAR, NOT
// White — Clear matches via its numeric base ("PE 99" → "pe99") with no rule. White
// is encoded as WT/WHT in SKUs (e.g. PBSWT04). Numeric/unmapped bases pass through.
const BASE_WORD_CODE = { white: ['wt', 'wht'] };

// DPL baseCode ("PE White" / "PBS White" / "PE 1" / "PE 99") → candidate Zoho SKU
// stems. A colour word expands to its possible codes; numeric/other bases pass through.
function dplBaseStems(baseCode) {
    const bc = String(baseCode == null ? '' : baseCode).trim().toLowerCase();
    if (!bc) return [];
    const m = bc.match(/^([a-z]+)\s+(.+)$/);
    if (!m) return [bc.replace(/[^a-z0-9]+/g, '')];
    const prefix = m[1];
    const baseRaw = m[2].replace(/\s+/g, '');
    const codes = BASE_WORD_CODE[baseRaw] || [baseRaw];
    return codes.map(c => prefix + String(c).replace(/[^a-z0-9]+/g, ''));
}
```

- [ ] **Step 2: Update S1 in `linkEntryToZoho`** — find:

```javascript
    // S1: SKU reconstruction (PRIMARY — deterministic)
    const stem = dplBaseStem(entry.base_code);
    if (stem && SIZE_CODE[entry.size_tier]) {
        const hits = items.filter(z => {
            const s = zohoSkuStem(z);
            return s && s.stem === stem && s.tier === entry.size_tier;
        });
        if (hits.length === 1) return { zoho_item_id: hits[0].zoho_item_id, link_status: 'confirmed', link_confidence: 95, link_reason: 'sku-reconstruct' };
        if (hits.length > 1) return { zoho_item_id: null, link_status: 'review', link_confidence: 55, link_reason: 'ambiguous-sku' };
    }
```
Replace with:

```javascript
    // S1: SKU reconstruction (PRIMARY — deterministic). A colour word yields several
    // candidate stems (e.g. White → wt/wht); a unique hit across them confirms.
    const stems = dplBaseStems(entry.base_code);
    if (stems.length && SIZE_CODE[entry.size_tier]) {
        const hits = items.filter(z => {
            const s = zohoSkuStem(z);
            return s && stems.includes(s.stem) && s.tier === entry.size_tier;
        });
        if (hits.length === 1) return { zoho_item_id: hits[0].zoho_item_id, link_status: 'confirmed', link_confidence: 95, link_reason: 'sku-reconstruct' };
        if (hits.length > 1) return { zoho_item_id: null, link_status: 'review', link_confidence: 55, link_reason: 'ambiguous-sku' };
    }
```

- [ ] **Step 3: Export `dplBaseStems`** — in `module.exports`, replace `dplBaseStem` with `dplBaseStems` (match the actual export line; just swap the name).

- [ ] **Step 4: Replace the `dplBaseStem / zohoSkuStem` test block** — in `tests/unit/dpl-catalog.test.js`, find the whole `describe('dplBaseStem / zohoSkuStem', () => { ... });` block and replace with:

```javascript
describe('dplBaseStems / zohoSkuStem', () => {
    test('White → [wt, wht] (NOT 99 — that is Clear); numeric/other bases pass through', () => {
        expect(catalog.dplBaseStems('PE White')).toEqual(['pewt', 'pewht']);
        expect(catalog.dplBaseStems('PBS White')).toEqual(['pbswt', 'pbswht']);
        expect(catalog.dplBaseStems('PE 99')).toEqual(['pe99']);   // Clear is numeric 99 → passthrough
        expect(catalog.dplBaseStems('PE 1')).toEqual(['pe1']);
        expect(catalog.dplBaseStems('')).toEqual([]);
    });
    test('zohoSkuStem strips the per-tier size code', () => {
        expect(catalog.zohoSkuStem({ name: 'PE9901 ONE PURE ELEGANCE BIRLA OPUS 01 L', sku: 'PE9901' })).toEqual({ stem: 'pe99', tier: '1L' });
        expect(catalog.zohoSkuStem({ name: 'PE110 ONE PURE ELEGANCE BIRLA OPUS 10 L', sku: 'PE110' })).toEqual({ stem: 'pe1', tier: '10L' });
    });
    test('zohoSkuStem returns null when SKU does not end with the tier size-code', () => {
        expect(catalog.zohoSkuStem({ name: 'SOMETHING 1 L', sku: 'XYZ' })).toBe(null);
    });
});
```

- [ ] **Step 5: Replace the `linkEntryToZoho` test block** — find the whole `describe('linkEntryToZoho', () => { ... });` block and replace with (PE99 = Clear; White matches only a WT SKU):

```javascript
describe('linkEntryToZoho', () => {
    // Real Birla shape: base in the SKU. 99 = CLEAR (not White). White is encoded as WT.
    const zoho = [
        { zoho_item_id: 'Z1', name: 'PE9901 ONE PURE ELEGANCE BIRLA OPUS 01 L', sku: 'PE9901' }, // Clear 1L
        { zoho_item_id: 'Z2', name: 'PE101 ONE PURE ELEGANCE BIRLA OPUS 01 L', sku: 'PE101' },    // Base 1 (Pastel) 1L
        { zoho_item_id: 'Z3', name: 'PE9904 ONE PURE ELEGANCE BIRLA OPUS 04 L', sku: 'PE9904' }, // Clear 4L
        { zoho_item_id: 'Z4', name: 'PBSWT04 STYLE POWER BRIGHT SHINE BIRLA OPUS 04 L', sku: 'PBSWT04' }, // White 4L (WT)
    ];

    test('S0 exact canonical SKU wins', () => {
        const r = catalog.linkEntryToZoho({ base_code: 'PE 99', product_name: 'One Pure Elegance', size_tier: '1L', canonical_sku: 'PE9901' }, zoho);
        expect(r.zoho_item_id).toBe('Z1');
        expect(r.link_reason).toBe('exact-sku');
        expect(r.link_confidence).toBe(100);
    });

    test('S1: Clear (PE 99 → pe99) → PE9901', () => {
        const r = catalog.linkEntryToZoho({ base_code: 'PE 99', product_name: 'One Pure Elegance', size_tier: '1L' }, zoho);
        expect(r.zoho_item_id).toBe('Z1');
        expect(r.link_reason).toBe('sku-reconstruct');
        expect(r.link_status).toBe('confirmed');
    });

    test('S1: White does NOT steal the Clear PE99 SKU', () => {
        const r = catalog.linkEntryToZoho({ base_code: 'PE White', product_name: 'One Pure Elegance', size_tier: '1L' }, zoho);
        expect(r.zoho_item_id).not.toBe('Z1');       // must NOT grab the Clear item
        expect(r.link_status).not.toBe('confirmed'); // no PE white SKU → falls through
    });

    test('S1: White encoded as WT → PBSWT04', () => {
        const r = catalog.linkEntryToZoho({ base_code: 'PBS White', product_name: 'Style Power Bright Shine', size_tier: '4L' }, zoho);
        expect(r.zoho_item_id).toBe('Z4');
        expect(r.link_reason).toBe('sku-reconstruct');
        expect(r.link_status).toBe('confirmed');
    });

    test('S1 Base 1 (PE 1 stem) → PE101', () => {
        const r = catalog.linkEntryToZoho({ base_code: 'PE 1', product_name: 'One Pure Elegance', size_tier: '1L' }, zoho);
        expect(r.zoho_item_id).toBe('Z2');
        expect(r.link_status).toBe('confirmed');
    });

    test('off-size: DPL Clear 3.6L (tier 4L) links to the Zoho 4L SKU PE9904', () => {
        const r = catalog.linkEntryToZoho({ base_code: 'PE 99', product_name: 'One Pure Elegance', size_tier: catalog.normalizeSizeTier('3.6L') }, zoho);
        expect(r.zoho_item_id).toBe('Z3');
        expect(r.link_reason).toBe('sku-reconstruct');
    });

    test('a tier Zoho lacks → needs_creating', () => {
        const r = catalog.linkEntryToZoho({ base_code: 'PE 99', product_name: 'One Pure Elegance', size_tier: '20L' }, zoho);
        expect(r.zoho_item_id).toBe(null);
        expect(r.link_status).toBe('needs_creating');
    });
});
```

- [ ] **Step 6: Replace the `buildCatalogFromDpl` test block** — find the whole `describe('buildCatalogFromDpl', () => { ... });` block and replace with (use Clear rows → PE99 SKUs, the correct mapping):

```javascript
describe('buildCatalogFromDpl', () => {
    // PE99xx = CLEAR (99 = Clear). CSV-parser row shape.
    const zoho = [
        { zoho_item_id: 'Z1', name: 'PE9901 ONE PURE ELEGANCE BIRLA OPUS 01 L', sku: 'PE9901', description: '', category: 'INTERIOR EMULSION' }, // Clear 1L
        { zoho_item_id: 'Z3', name: 'PE9904 ONE PURE ELEGANCE BIRLA OPUS 04 L', sku: 'PE9904', description: '', category: 'INTERIOR EMULSION' }, // Clear 4L
    ];
    const rows = [
        { product: 'One Pure Elegance - Clear', productName: 'One Pure Elegance', colourName: 'Clear', baseCode: 'PE 99', productCode: '941001', colourCode: '9999', packSize: '1L', dpl: 445, category: 'INTERIOR EMULSION', brand: 'Birla Opus' },
        { product: 'One Pure Elegance - Clear', productName: 'One Pure Elegance', colourName: 'Clear', baseCode: 'PE 99', productCode: '941001', colourCode: '9999', packSize: '3.6L', dpl: 1751, category: 'INTERIOR EMULSION', brand: 'Birla Opus' },
    ];

    test('entry has tier, match_key, price, and SKU-reconstructed link', () => {
        const entries = catalog.buildCatalogFromDpl('birlaopus', rows, zoho);
        expect(entries).toHaveLength(2);
        const e1 = entries.find(e => e.size_tier === '1L');
        expect(e1.product_code).toBe('941001');
        expect(e1.base_name).toBe('Clear');
        expect(e1.dpl_size_label).toBe('1L');
        expect(e1.current_dpl).toBe(445);
        expect(e1.current_rate).toBe(Math.ceil(445 * 1.18 * 1.10));
        expect(e1.match_key).toBe('birlaopus|941001|clear|1l');
        expect(e1.zoho_item_id).toBe('Z1');
        expect(e1.link_status).toBe('confirmed');
        expect(e1.link_reason).toBe('sku-reconstruct');
    });

    test('off-size DPL 3.6L (tier 4L) links to the Zoho 4L item', () => {
        const entries = catalog.buildCatalogFromDpl('birlaopus', rows, zoho);
        const e2 = entries.find(e => e.size_tier === '4L');
        expect(e2.dpl_size_label).toBe('3.6L');
        expect(e2.zoho_item_id).toBe('Z3');
        expect(e2.link_status).toBe('confirmed');
    });
});
```

- [ ] **Step 7: Run, verify PASS** — `npx jest tests/unit/dpl-catalog.test.js`. Expected: all pass (the reframed tests + the rest). If any OTHER test referenced `dplBaseStem` (singular) or assumed White=PE99, update it to the corrected semantics (PE99 = Clear; White only via a WT SKU).

- [ ] **Step 8: Module load + sibling suite**

```bash
node -e "require('./services/dpl-catalog.js'); console.log('svc OK')"
npx jest tests/unit/dpl-catalog.test.js tests/unit/dpl-catalog-endpoints.test.js
```
Expected: `svc OK` and all pass.

- [ ] **Step 9: Commit**

```bash
git add services/dpl-catalog.js tests/unit/dpl-catalog.test.js
git commit -m "fix(dpl-catalog): White no longer maps to 99 (=Clear); match WT-encoded White via multi-stem"
```

---

## Task 2: Picker shows catalog link-status

**Files:** Modify `public/admin-dpl.html`.

- [ ] **Step 1: Add `catLinkBadge` + render it in the picker** — find:

```javascript
            resultsEl.innerHTML = items.map(function(it){
                var zid = it.zoho_item_id; var nm = it.zoho_item_name || it.name || ''; var sku = it.zoho_sku || it.sku || '';
                catZohoNameCache[zid] = nm;
                return '<button onclick="pickCatZoho(\'' + esc(String(zid)) + '\')" class="w-full text-left px-2 py-1.5 rounded hover:bg-indigo-50 border border-gray-100 text-[11px]"><div class="font-semibold text-gray-800">' + esc(nm) + '</div><div class="text-gray-400 font-mono">' + esc(sku) + '</div></button>';
            }).join('');
```
Replace with:

```javascript
            resultsEl.innerHTML = items.map(function(it){
                var zid = it.zoho_item_id; var nm = it.zoho_item_name || it.name || ''; var sku = it.zoho_sku || it.sku || '';
                catZohoNameCache[zid] = nm;
                return '<button onclick="pickCatZoho(\'' + esc(String(zid)) + '\')" class="w-full text-left px-2 py-1.5 rounded hover:bg-indigo-50 border border-gray-100 text-[11px]"><div class="font-semibold text-gray-800">' + esc(nm) + '</div><div class="text-gray-400 font-mono">' + esc(sku) + '</div>' + catLinkBadge(zid) + '</button>';
            }).join('');
```

- [ ] **Step 2: Define `catLinkBadge`** — immediately AFTER the `function pickCatZoho(zohoItemId) { ... }` function, add:

```javascript
    function catLinkBadge(zid) {
        var e = catalogEntries.find(function(x){ return x.zoho_item_id && String(x.zoho_item_id) === String(zid); });
        if (!e) return '';
        var label = (e.product_name || '') + ' · ' + (e.base_name || '') + ' · ' + (e.size_tier || '');
        if (e.link_status === 'confirmed') return '<div class="text-[10px] text-emerald-600 mt-0.5">✓ confirmed: ' + esc(label) + '</div>';
        return '<div class="text-[10px] text-amber-600 mt-0.5">⚠ in review: ' + esc(label) + '</div>';
    }
```

- [ ] **Step 3: Sanity** — grep `function catLinkBadge` appears once; `catLinkBadge(zid)` is referenced in the picker render. Eyeball brace/quote balance.

- [ ] **Step 4: Commit**

```bash
git add public/admin-dpl.html
git commit -m "feat(dpl-catalog-ui): picker shows which Zoho items are already linked"
```

---

## Self-Review notes (spec coverage)

- **Remove white→99, add white→[wt,wht] (multi-stem S1):** Task 1 Steps 1-2. ✓
- **Clear keeps matching (PE 99 → pe99):** test in Step 5. ✓
- **White no longer steals Clear; WT-White matches:** tests in Step 5. ✓
- **Tests reframed (PE99=Clear) so suite reflects reality:** Steps 4-6. ✓
- **Picker link-status badge:** Task 2. ✓

## Post-deploy (controller runs)

1. Push + deploy.
2. Rebuild the Birla catalog server-side (self-cleaning + new white logic).
3. Verify: OPE White 1L/4L NO LONGER link to PE9901/PE9904; Clear still does; Power Bright Shine White 4L → PBSWT04 confirmed. Re-run the push-backfill is NOT needed (pushed_* preserved). Spot-check the picker shows confirmed labels.

## Out of scope

Colour codes beyond white; auto-creating Zoho items for unmatched whites; other brands.
