# DPL Catalog — "Not in Zoho" rejects the (wrong) link Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Marking a catalog entry "not in Zoho" should reject its (wrong) auto-link so it actually moves to the Pending filter and stays there across rebuilds; the mark button must be available on review entries (not only unlinked ones); picking/confirming a real item clears the mark.

**Architecture:** `setNotInZoho(id,true)` now unlinks + clears canonical; `unlinkMarked(brand)` (called by the build after upsert) keeps marked entries unlinked across rebuilds; `confirmLink` clears the flag. UI shows the mark/unmark button on any non-confirmed entry. No migration.

**Tech Stack:** Node.js/Express CommonJS + mysql2, Jest, vanilla JS.

**Spec:** (this plan; extends `2026-06-04-dpl-catalog-not-in-zoho-design.md`)

---

## Task 1: Service — mark unlinks, build keeps unlinked, confirm clears flag

**Files:** Modify `services/dpl-catalog.js`, `routes/zoho.js`, `tests/unit/dpl-catalog.test.js`.

- [ ] **Step 1: Replace the `setNotInZoho` failing test** — in `tests/unit/dpl-catalog.test.js`, find the whole `describe('setNotInZoho', () => { ... });` block and replace with:

```javascript
describe('setNotInZoho', () => {
    test('value=true unlinks + clears canonical + sets the flag', async () => {
        const calls = [];
        catalog.setPool({ query: async (sql, params) => { calls.push({ sql, params }); return [{}]; } });
        await catalog.setNotInZoho(5, true, 'u');
        expect(calls[0].sql).toMatch(/not_in_zoho = 1/);
        expect(calls[0].sql).toMatch(/zoho_item_id = NULL/);
        expect(calls[0].sql).toMatch(/link_status = 'needs_creating'/);
        expect(calls[0].sql).toMatch(/canonical_sku = NULL/);
        expect(calls[0].params).toEqual(['u', 5]);
    });
    test('value=false clears the flag only', async () => {
        const calls = [];
        catalog.setPool({ query: async (sql, params) => { calls.push({ sql, params }); return [{}]; } });
        await catalog.setNotInZoho(6, false, 'u');
        expect(calls[0].sql).toMatch(/SET not_in_zoho = 0, updated_by = \? WHERE id = \?/);
        expect(calls[0].params).toEqual(['u', 6]);
    });
});

describe('unlinkMarked', () => {
    test('unlinks marked-not-in-zoho entries for the brand', async () => {
        const calls = [];
        catalog.setPool({ query: async (sql, params) => { calls.push({ sql, params }); return [{ affectedRows: 2 }]; } });
        const n = await catalog.unlinkMarked('birlaopus');
        expect(n).toBe(2);
        expect(calls[0].sql).toMatch(/UPDATE dpl_catalog SET zoho_item_id = NULL/);
        expect(calls[0].sql).toMatch(/WHERE brand = \? AND not_in_zoho = 1 AND zoho_item_id IS NOT NULL/);
        expect(calls[0].params).toEqual(['birlaopus']);
    });
});
```

- [ ] **Step 2: Run, verify FAIL** — `npx jest tests/unit/dpl-catalog.test.js`.

- [ ] **Step 3: Rewrite `setNotInZoho` + add `unlinkMarked`** — in `services/dpl-catalog.js`, replace:

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
with:

```javascript
// Mark/unmark an entry as "not in Zoho (pending creation)". Marking REJECTS the
// (often wrong) auto-link: it unlinks and clears the canonical fields so the entry
// moves to the Pending filter. Kept out of _COLS so the flag survives rebuilds.
async function setNotInZoho(id, value, updatedBy) {
    if (value) {
        await pool.query(
            `UPDATE dpl_catalog SET not_in_zoho = 1, zoho_item_id = NULL, link_status = 'needs_creating',
                link_confidence = 0, link_reason = 'marked-not-in-zoho',
                canonical_name = NULL, canonical_sku = NULL, canonical_description = NULL,
                updated_by = ? WHERE id = ?`,
            [updatedBy || null, id]
        );
    } else {
        await pool.query(
            `UPDATE dpl_catalog SET not_in_zoho = 0, updated_by = ? WHERE id = ?`,
            [updatedBy || null, id]
        );
    }
}

// After a rebuild, re-unlink any entries the user marked not-in-Zoho (the linker would
// otherwise re-attach the wrong item). Keeps marked items in Pending across rebuilds.
async function unlinkMarked(brand) {
    const [r] = await pool.query(
        `UPDATE dpl_catalog SET zoho_item_id = NULL, link_status = 'needs_creating', link_confidence = 0,
            link_reason = 'marked-not-in-zoho', canonical_name = NULL, canonical_sku = NULL, canonical_description = NULL
         WHERE brand = ? AND not_in_zoho = 1 AND zoho_item_id IS NOT NULL`,
        [brand]
    );
    return r.affectedRows || 0;
}
```

- [ ] **Step 4: `confirmLink` clears the flag** — in `services/dpl-catalog.js` `confirmLink`, add `not_in_zoho = 0,` to BOTH UPDATE statements. The recompute UPDATE becomes:

```javascript
        await pool.query(
            `UPDATE dpl_catalog SET zoho_item_id = ?, link_status = 'confirmed', link_confidence = 100,
                link_reason = 'user-confirmed', canonical_name = ?, canonical_sku = ?, canonical_description = ?,
                not_in_zoho = 0, updated_by = ? WHERE id = ?`,
            [zohoItemId, c.canonical_name, c.canonical_sku, c.canonical_description, updatedBy || null, id]
        );
```
and the fallback UPDATE becomes:

```javascript
    await pool.query(
        `UPDATE dpl_catalog SET zoho_item_id = ?, link_status = 'confirmed', link_confidence = 100,
            link_reason = 'user-confirmed', not_in_zoho = 0, updated_by = ? WHERE id = ?`,
        [zohoItemId, updatedBy || null, id]
    );
```
(Params unchanged — `not_in_zoho = 0` is a literal. The existing confirmLink tests still pass.)

- [ ] **Step 5: Export `unlinkMarked`** — add it to `module.exports` (next to `deleteOrphans`).

- [ ] **Step 6: Wire `unlinkMarked` into the build endpoint** — in `routes/zoho.js` build handler, find:

```javascript
        const removed = await dplCatalogService.deleteOrphans(brand, entries.map(e => e.match_key));
```
Add immediately after it:

```javascript
        await dplCatalogService.unlinkMarked(brand);
```

- [ ] **Step 7: Run, verify PASS + module load**
```bash
node -e "require('./services/dpl-catalog.js'); console.log('svc OK')"
node --check routes/zoho.js && node -e "require('./routes/zoho.js'); console.log('zoho OK')"
npx jest tests/unit/dpl-catalog.test.js tests/unit/dpl-catalog-endpoints.test.js
```
Expected: `svc OK`, `zoho OK`, all pass.

- [ ] **Step 8: Commit**
```bash
git add services/dpl-catalog.js routes/zoho.js tests/unit/dpl-catalog.test.js
git commit -m "fix(dpl-catalog): marking not-in-Zoho rejects the link; build keeps marked unlinked; confirm clears flag"
```

---

## Task 2: UI — mark button available on review entries

**Files:** Modify `public/admin-dpl.html`.

- [ ] **Step 1: Show the mark/unmark button on any non-confirmed entry** — in `actionHtml`, find:

```javascript
            if (!e.zoho_item_id) {
                action += e.not_in_zoho
                    ? '<button onclick="markNotInZoho(' + e.id + ', false)" class="px-2 py-1 rounded border text-gray-500 text-[10px] ml-1">↩ Unmark</button>'
                    : '<button onclick="markNotInZoho(' + e.id + ', true)" class="px-2 py-1 rounded border border-rose-300 text-rose-700 text-[10px] font-bold ml-1">🚫 Not in Zoho</button>';
            }
            return action;
```
Replace with:

```javascript
            if (e.link_status !== 'confirmed') {
                action += e.not_in_zoho
                    ? '<button onclick="markNotInZoho(' + e.id + ', false)" class="px-2 py-1 rounded border text-gray-500 text-[10px] ml-1">↩ Unmark</button>'
                    : '<button onclick="markNotInZoho(' + e.id + ', true)" class="px-2 py-1 rounded border border-rose-300 text-rose-700 text-[10px] font-bold ml-1">🚫 Not in Zoho</button>';
            }
            return action;
```

- [ ] **Step 2: Reload after marking (the link changes, not just the flag)** — in `markNotInZoho`, find:

```javascript
            var e = catalogEntries.find(function(x){ return x.id === id; });
            if (e) e.not_in_zoho = value ? 1 : 0;
            showToast(value ? 'Marked: not in Zoho (pending)' : 'Unmarked', 'success');
            renderCatalog();
```
Replace with:

```javascript
            showToast(value ? 'Marked: not in Zoho (pending)' : 'Unmarked', 'success');
            await loadCatalog();
```
(Marking now unlinks server-side, so a full reload reflects the cleared link/canonical, not just the flag.)

- [ ] **Step 3: Sanity** — grep `e.link_status !== 'confirmed'` appears in `actionHtml` for the mark block; `markNotInZoho` calls `loadCatalog()`. Confirm `markNotInZoho` is still `async`.

- [ ] **Step 4: Commit**
```bash
git add public/admin-dpl.html
git commit -m "feat(dpl-catalog-ui): allow marking review (linked) items not-in-Zoho; reload after mark"
```

---

## Self-Review notes

- **Mark rejects link (unlink + clear canonical):** Task 1 Step 3. ✓
- **Build keeps marked unlinked (rebuild-safe pending):** Task 1 Steps 3,6. ✓
- **Confirm/Pick clears the flag:** Task 1 Step 4. ✓
- **Mark button on review (linked) entries:** Task 2 Step 1. ✓
- **UI reflects the unlink:** Task 2 Step 2 (reload). ✓

## Post-deploy (controller runs)

1. Push + deploy.
2. Rebuild the Birla catalog server-side → `unlinkMarked` unlinks already-marked-but-linked entries (id 502 Power Fit Terracotta 1L) → they move to Pending.
3. Verify: id 502 → zoho_item_id NULL, link_status needs_creating, not_in_zoho 1 → appears under 🚫 Pending, gone from Review.

## Out of scope

Auto-create in Zoho; bulk operations; other brands.
