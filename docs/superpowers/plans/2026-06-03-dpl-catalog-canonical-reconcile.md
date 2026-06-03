# DPL Catalog — canonical reconcile on re-link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `canonical_sku`/name drifting from the linked Zoho item: recompute the canonical fields whenever a link is confirmed/re-picked, and provide a one-time repair for already-drifted rows — so the auto-proposed SKU always equals the linked item's own SKU (correct + unique, never collides on push).

**Architecture:** A new pure `reconcileCanonical(entry, zohoItem)` helper in `services/dpl-catalog.js` re-runs the existing `computeProposedFields` proposer against the CURRENT linked item. `confirmLink` calls it (so re-picking resets the canonical fields). A one-off `scripts/reconcile-dpl-catalog.js` repairs existing drift. `buildCatalogFromDpl` is left untouched (zero build-behaviour risk).

**Tech Stack:** Node.js CommonJS, Jest. Reuses `computeProposedFields` (already imported in `dpl-catalog.js`).

**Spec:** `docs/superpowers/specs/2026-06-03-dpl-catalog-canonical-reconcile-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `services/dpl-catalog.js` | add + export `reconcileCanonical`; recompute canonical in `confirmLink` | Modify |
| `tests/unit/dpl-catalog.test.js` | unit tests for `reconcileCanonical` + `confirmLink` recompute | Modify |
| `scripts/reconcile-dpl-catalog.js` | one-time drift repair (dry-run by default, `--apply` to write) | Create |

**Reused unchanged:** `buildCatalogFromDpl`, `computeProposedFields`, `buildPushChanges`, the routes/UI. No migration.

---

## Task 1: `reconcileCanonical` + `confirmLink` recompute + tests

**Files:** Modify `services/dpl-catalog.js`; Modify `tests/unit/dpl-catalog.test.js`.

- [ ] **Step 1: Write failing tests** — append to `tests/unit/dpl-catalog.test.js` (use the file's required-module variable, e.g. `catalog`):

```javascript
describe('reconcileCanonical', () => {
    test('canonical_sku becomes the linked item sku; name carries it', () => {
        const c = catalog.reconcileCanonical(
            { product_name: 'Colorant', base_name: 'Black', size_tier: '1L', dpl_size_label: '1L', current_dpl: 394, category: 'Interior' },
            { zoho_sku: 'OPCLBL', zoho_description: 'BLACK COLORANT', zoho_category_name: 'Interior' });
        expect(c.canonical_sku).toBe('OPCLBL');
        expect(c.canonical_name).toContain('OPCLBL');
        expect(typeof c.canonical_description).toBe('string');
    });

    test('returns null canonical_sku when the linked item has no sku', () => {
        const c = catalog.reconcileCanonical(
            { product_name: 'X', base_name: '', size_tier: '1L', dpl_size_label: '1L', current_dpl: 100, category: '' },
            { zoho_sku: '' });
        expect(c.canonical_sku).toBeNull();
    });
});

describe('confirmLink recompute', () => {
    test('recomputes canonical fields from the newly linked item', async () => {
        const calls = [];
        catalog.setPool({ query: async (sql, params) => {
            calls.push({ sql, params });
            if (/FROM dpl_catalog WHERE id/.test(sql)) return [[{ id: 1, product_name: 'Colorant', base_name: 'Black', size_tier: '1L', dpl_size_label: '1L', current_dpl: 394, category: 'Interior' }]];
            if (/FROM zoho_items_map/.test(sql)) return [[{ zoho_sku: 'OPCLBL', zoho_description: 'd', zoho_category_name: 'Interior' }]];
            return [{}];
        } });
        await catalog.confirmLink(1, 'ZID', 'admin');
        const upd = calls.find(c => /UPDATE dpl_catalog SET zoho_item_id/.test(c.sql));
        expect(upd).toBeTruthy();
        expect(upd.sql).toMatch(/canonical_sku = \?/);
        expect(upd.params[0]).toBe('ZID');       // zoho_item_id
        expect(upd.params[2]).toBe('OPCLBL');     // canonical_sku
        expect(upd.params[5]).toBe(1);            // id
    });

    test('falls back to link-only update when entry not found', async () => {
        const calls = [];
        catalog.setPool({ query: async (sql) => {
            calls.push({ sql });
            if (/FROM dpl_catalog WHERE id/.test(sql)) return [[]];
            if (/FROM zoho_items_map/.test(sql)) return [[]];
            return [{}];
        } });
        await catalog.confirmLink(2, 'ZID', 'u');
        const upd = calls.find(c => /UPDATE dpl_catalog SET zoho_item_id/.test(c.sql));
        expect(upd.sql).not.toMatch(/canonical_sku/);
    });
});
```

- [ ] **Step 2: Run, verify FAIL** — `npx jest tests/unit/dpl-catalog.test.js` → FAIL (`reconcileCanonical` undefined; confirmLink not recomputing). NOTE: if there is an EXISTING `confirmLink` test asserting a single query, it will need updating in Step 4 — note it now.

- [ ] **Step 3: Add `reconcileCanonical`** — in `services/dpl-catalog.js`, immediately BEFORE the `confirmLink` function, add:

```javascript
// Recompute canonical name/sku/description for an entry from its CURRENTLY linked
// Zoho item (re-runs the Birla proposer). proposed_sku = the linked item's own SKU,
// so canonical_sku tracks the link and push never renames it. Fields may be null.
function reconcileCanonical(entry, zohoItem) {
    const e = entry || {};
    const z = zohoItem || {};
    const product = e.base_name ? `${e.product_name || ''} - ${e.base_name}` : (e.product_name || '');
    const pf = computeProposedFields(
        { product, packSize: e.dpl_size_label || e.size_tier || '', dpl: parseFloat(e.current_dpl) || 0, category: e.category || '' },
        { sku: z.zoho_sku || z.sku || '', description: z.zoho_description || z.description || '', category: z.zoho_category_name || z.category || '' },
        'birlaopus'
    );
    return {
        canonical_name: pf.proposed_name || null,
        canonical_sku: pf.proposed_sku || null,
        canonical_description: pf.proposed_description || null,
    };
}
```

- [ ] **Step 4: Recompute in `confirmLink`** — replace the existing `confirmLink` function:

```javascript
async function confirmLink(id, zohoItemId, updatedBy) {
    await pool.query(
        `UPDATE dpl_catalog SET zoho_item_id = ?, link_status = 'confirmed', link_confidence = 100,
            link_reason = 'user-confirmed', updated_by = ? WHERE id = ?`,
        [zohoItemId, updatedBy || null, id]
    );
}
```
with:

```javascript
async function confirmLink(id, zohoItemId, updatedBy) {
    // Recompute the canonical fields against the newly linked item so the SKU/name
    // never drift from a previous link (the cause of duplicate-SKU push failures).
    const [erows] = await pool.query('SELECT * FROM dpl_catalog WHERE id = ?', [id]);
    const [zrows] = await pool.query(
        'SELECT zoho_sku, zoho_description, zoho_category_name FROM zoho_items_map WHERE zoho_item_id = ?',
        [zohoItemId]
    );
    if (erows.length && zrows.length) {
        const c = reconcileCanonical(erows[0], zrows[0]);
        await pool.query(
            `UPDATE dpl_catalog SET zoho_item_id = ?, link_status = 'confirmed', link_confidence = 100,
                link_reason = 'user-confirmed', canonical_name = ?, canonical_sku = ?, canonical_description = ?,
                updated_by = ? WHERE id = ?`,
            [zohoItemId, c.canonical_name, c.canonical_sku, c.canonical_description, updatedBy || null, id]
        );
        return;
    }
    // Fallback: entry or Zoho item not found — original link-only update.
    await pool.query(
        `UPDATE dpl_catalog SET zoho_item_id = ?, link_status = 'confirmed', link_confidence = 100,
            link_reason = 'user-confirmed', updated_by = ? WHERE id = ?`,
        [zohoItemId, updatedBy || null, id]
    );
}
```

If an EXISTING test asserted `confirmLink` issues exactly one query / a specific single SQL, update it to allow the new select-then-update flow (the recompute path now runs 3 queries). Do not weaken the new tests.

- [ ] **Step 5: Export `reconcileCanonical`** — add it to `module.exports` (next to `confirmLink`):

```javascript
    buildPushChanges, upsertEntries, getCatalog, confirmLink, reconcileCanonical, updateAppliedPrices, updateCanonicalFields,
```
(Append `reconcileCanonical` to the existing export line; match its actual current form.)

- [ ] **Step 6: Run, verify PASS** — `npx jest tests/unit/dpl-catalog.test.js` → all pass.

- [ ] **Step 7: Module load + sibling suites**

```bash
node -e "require('./services/dpl-catalog.js'); console.log('svc OK')"
npx jest tests/unit/dpl-catalog.test.js tests/unit/dpl-catalog-endpoints.test.js
```
Expected: `svc OK` and all pass.

- [ ] **Step 8: Commit**

```bash
git add services/dpl-catalog.js tests/unit/dpl-catalog.test.js
git commit -m "feat(dpl-catalog): reconcileCanonical + confirmLink recomputes canonical from linked item"
```

---

## Task 2: One-time drift-repair script

**Files:** Create `scripts/reconcile-dpl-catalog.js`.

- [ ] **Step 1: Create the script**

```javascript
/**
 * One-time: repair drifted canonical fields. For each LINKED catalog entry whose
 * canonical_sku no longer equals the recomputed (linked-item) sku, rewrite the
 * canonical name/sku/description from the current linked Zoho item.
 *
 * Usage:
 *   node scripts/reconcile-dpl-catalog.js [brand]            # dry-run (default brand birlaopus)
 *   node scripts/reconcile-dpl-catalog.js [brand] --apply    # write changes
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/database').createPool();
const svc = require('../services/dpl-catalog');
svc.setPool(pool);

(async () => {
    const brand = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'birlaopus';
    const apply = process.argv.includes('--apply');
    try {
        const [entries] = await pool.query(
            'SELECT * FROM dpl_catalog WHERE brand = ? AND zoho_item_id IS NOT NULL', [brand]);
        const zids = [...new Set(entries.map(e => String(e.zoho_item_id)))];
        const zById = new Map();
        if (zids.length) {
            const [z] = await pool.query(
                `SELECT zoho_item_id, zoho_sku, zoho_description, zoho_category_name
                 FROM zoho_items_map WHERE zoho_item_id IN (${zids.map(() => '?').join(',')})`, zids);
            z.forEach(r => zById.set(String(r.zoho_item_id), r));
        }
        let drifted = 0, fixed = 0; const samples = [];
        for (const e of entries) {
            const z = zById.get(String(e.zoho_item_id));
            if (!z) continue;
            let c;
            try { c = svc.reconcileCanonical(e, z); } catch (err) { console.error('row', e.id, 'failed:', err.message); continue; }
            const cur = String(e.canonical_sku || '').toUpperCase();
            const want = String(c.canonical_sku || '').toUpperCase();
            if (cur === want) continue;
            drifted++;
            if (samples.length < 15) samples.push({ id: e.id, item: `${e.product_name} ${e.base_name}`.trim(), from: e.canonical_sku, to: c.canonical_sku });
            if (apply) {
                await pool.query(
                    'UPDATE dpl_catalog SET canonical_name = ?, canonical_sku = ?, canonical_description = ? WHERE id = ?',
                    [c.canonical_name, c.canonical_sku, c.canonical_description, e.id]);
                fixed++;
            }
        }
        console.log(`brand=${brand} linked=${entries.length} drifted=${drifted} ${apply ? ('fixed=' + fixed) : '(DRY-RUN — pass --apply to write)'}`);
        console.table(samples);
        process.exit(0);
    } catch (err) { console.error('reconcile error:', err.message); process.exit(1); }
})();
```

- [ ] **Step 2: Local syntax check**

```bash
node --check scripts/reconcile-dpl-catalog.js
```
Expected: no output (valid). (Do NOT run it locally — it needs the prod DB; it will be run on the server after deploy.)

- [ ] **Step 3: Commit**

```bash
git add scripts/reconcile-dpl-catalog.js
git commit -m "chore(dpl-catalog): one-time canonical drift-repair script"
```

---

## Self-Review notes (spec coverage)

- **`reconcileCanonical` (canonical_sku = linked sku):** Task 1 Step 3 + test. ✓
- **`confirmLink` recompute (fix future drift) + fallback:** Task 1 Step 4 + 2 tests. ✓
- **Build untouched:** not modified — only `confirmLink` + new helper. ✓
- **One-time repair (drift signature, dry-run default):** Task 2. ✓
- **Push unchanged (canonical_sku now tracks link → no SKU push):** no push edits. ✓

## Post-deploy (controller runs, not part of subagent tasks)

After merge + deploy: `ssh hetzner "cd /www/wwwroot/act.qcpaintshop.com && node scripts/reconcile-dpl-catalog.js birlaopus"` (dry-run), review the drift list, then re-run with `--apply`. Verify entry 1314 → OPCLBL and `sku_conflict` clears.

## Out of scope

Generating brand-new standardized SKUs (Option B); the linker; `buildPushChanges`; routes/UI.
