# DPL Catalog — colorant SKU map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-link Birla's 16 water colorants (whose Zoho names lack the colour word and whose DPL base abbreviations don't map to the Zoho SKU) via an explicit `productCode → Zoho SKU` table and a deterministic, tier-checked linker strategy.

**Architecture:** Add a `PRODUCT_CODE_SKU` map + a highest-priority strategy in `linkEntryToZoho` (`services/dpl-catalog.js`). Pure-function change; falls through to existing S0/S1/S2 when not a mapped colorant or no tier match. Rebuild after deploy.

**Tech Stack:** Node.js CommonJS, Jest.

**Spec:** `docs/superpowers/specs/2026-06-03-dpl-catalog-colorant-map-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `services/dpl-catalog.js` | `PRODUCT_CODE_SKU` map + colorant-map strategy in `linkEntryToZoho` | Modify |
| `tests/unit/dpl-catalog.test.js` | unit tests (match + wrong-tier fall-through) | Modify |

**Reused unchanged:** S0/S1/S2 strategies, `normalizeSizeTier`, `extractSizeFromZohoName`, the routes/UI.

---

## Task 1: Colorant map + linker strategy + tests

**Files:** Modify `services/dpl-catalog.js`; Modify `tests/unit/dpl-catalog.test.js`.

- [ ] **Step 1: Write failing tests** — append to `tests/unit/dpl-catalog.test.js` (use the file's required-module variable, e.g. `catalog`):

```javascript
describe('linkEntryToZoho — colorant map', () => {
    const opclbl = { zoho_item_id: 'Z1', sku: 'OPCLBL', name: 'OPCLBL COLORANT BIRLA OPUS 01 L' };

    test('maps a colorant productCode to its exact Zoho SKU (confirmed)', () => {
        const r = catalog.linkEntryToZoho(
            { product_code: '970002', size_tier: '1L', product_name: 'Colorant', base_name: 'Black' },
            [opclbl, { zoho_item_id: 'Z2', sku: 'OPCLWT', name: 'OPCLWT WHITE BIRLA OPUS 01 L' }]);
        expect(r.link_status).toBe('confirmed');
        expect(r.link_reason).toBe('colorant-map');
        expect(r.zoho_item_id).toBe('Z1');
        expect(r.link_confidence).toBe(95);
    });

    test('does NOT match when the tier differs (200ml colorant, only 1L OPCL item)', () => {
        const r = catalog.linkEntryToZoho(
            { product_code: '970002', size_tier: '200ml', product_name: 'Colorant', base_name: 'Black' },
            [opclbl]);
        expect(r.link_reason).not.toBe('colorant-map');
        // no other candidate matches → needs_creating
        expect(r.link_status).toBe('needs_creating');
    });

    test('non-colorant productCode is unaffected (falls through)', () => {
        const r = catalog.linkEntryToZoho(
            { product_code: '941001', size_tier: '1L', product_name: 'X', base_name: 'Y' },
            [opclbl]);
        expect(r.link_reason).not.toBe('colorant-map');
    });
});
```

- [ ] **Step 2: Run, verify FAIL** — `npx jest tests/unit/dpl-catalog.test.js` → the colorant-map test fails (reason is currently `no-match`/something else).

- [ ] **Step 3: Add the map** — in `services/dpl-catalog.js`, immediately AFTER the `BASE_WORD_CODE` const (the line `const BASE_WORD_CODE = { white: '99' };`), add:

```javascript
// DPL productCode → exact Zoho SKU, for product families the name/SKU-stem linkers
// can't match (Birla water colorants: Zoho names lack the colour word and the DPL
// base abbreviations don't map to the Zoho suffix). Verified against prod. Solvent
// colorants (970025+) have no OPCL items and are intentionally absent.
const PRODUCT_CODE_SKU = {
    '970001': 'OPCLWT', '970002': 'OPCLBL', '970003': 'OPCLBLU', '970004': 'OPCLOR',
    '970005': 'OPCLMG', '970006': 'OPCLGR', '970007': 'OPCLVI', '970008': 'OPCLINY',
    '970009': 'OPCLINR', '970010': 'OPCLRO', '970011': 'OPCLYO', '970012': 'OPCLEXY',
    '970013': 'OPCLEXR', '970014': 'OPCLEXHR', '970015': 'OPCLEXHDY', '970016': 'OPCLSWT',
};
```

- [ ] **Step 4: Add the strategy** — in `linkEntryToZoho`, find:

```javascript
function linkEntryToZoho(entry, zohoItems) {
    const items = zohoItems || [];

    // S0: exact canonical SKU
```
Replace with:

```javascript
function linkEntryToZoho(entry, zohoItems) {
    const items = zohoItems || [];

    // SM: explicit productCode→SKU map (curated families the other strategies can't
    // match — e.g. colorants). Exact SKU + tier-checked, so a different-size entry
    // won't grab the only (1L) mapped item.
    const mapSku = entry.product_code && PRODUCT_CODE_SKU[String(entry.product_code).trim()];
    if (mapSku) {
        const want = String(mapSku).toUpperCase();
        const hit = items.find(z => {
            const sku = String(z.sku || z.zoho_sku || '').toUpperCase();
            if (sku !== want) return false;
            const tier = normalizeSizeTier(extractSizeFromZohoName(z.name || z.zoho_item_name || '', sku));
            return tier === entry.size_tier;
        });
        if (hit) return { zoho_item_id: hit.zoho_item_id, link_status: 'confirmed', link_confidence: 95, link_reason: 'colorant-map' };
    }

    // S0: exact canonical SKU
```

- [ ] **Step 5: Run, verify PASS** — `npx jest tests/unit/dpl-catalog.test.js` → all pass (new + existing).

- [ ] **Step 6: Module load + sibling suite**

```bash
node -e "require('./services/dpl-catalog.js'); console.log('svc OK')"
npx jest tests/unit/dpl-catalog.test.js tests/unit/dpl-catalog-endpoints.test.js
```
Expected: `svc OK` and all pass.

- [ ] **Step 7: Commit**

```bash
git add services/dpl-catalog.js tests/unit/dpl-catalog.test.js
git commit -m "feat(dpl-catalog): productCode->SKU colorant map for deterministic auto-linking"
```

---

## Self-Review notes (spec coverage)

- **PRODUCT_CODE_SKU map (16 colorants):** Task 1 Step 3. ✓
- **Highest-priority tier-checked strategy → confirmed (95, colorant-map):** Task 1 Step 4. ✓
- **Wrong-tier / non-colorant fall-through:** Task 1 Step 1 tests + the strategy's `return tier === entry.size_tier`. ✓
- **No change to S0/S1/S2 / proposer / routes:** only an insertion before S0. ✓

## Post-deploy (controller runs, not a subagent task)

1. Push + deploy.
2. Rebuild the Birla catalog (server-side, as before).
3. Verify: the 16 colorants are now `confirmed → OPCL*` (Colorant-Black → OPCLBL, White → OPCLWT, …); solvent colorants remain `needs_creating`.

## Out of scope

Solvent colorants, `dplBaseStem`/S1/S2 changes, the proposer, a DB-driven mapping table, other brands.
