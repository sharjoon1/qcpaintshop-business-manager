# DPL Catalog — push-state tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remember which catalog entries were pushed to Zoho (when + which bulk job + price at push), survive rebuilds, exclude already-pushed-unchanged items from "Pushable", and surface them under a "Pushed" filter with the last-push date/job and a "price changed → re-push" signal.

**Architecture:** 4 new `dpl_catalog` columns kept OUT of the build upsert (`_COLS`) so rebuilds preserve them; a `markPushed` service stamp called after a push job is created; a push pre-filter that skips already-pushed-unchanged; GET enrich adds a derived `push_changed`; UI gets a Pushed filter + badge and a tightened `isPushable`.

**Tech Stack:** Node.js CommonJS + mysql2, Jest, vanilla JS + Tailwind.

**Spec:** `docs/superpowers/specs/2026-06-04-dpl-catalog-push-tracking-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `migrations/migrate-dpl-catalog-push-tracking.js` | idempotent ADD of 4 columns (self-running) | Create |
| `services/dpl-catalog.js` | `markPushed(rows, jobId)` | Modify |
| `routes/zoho.js` | push stamp + pre-filter skip-unchanged + GET `push_changed` | Modify |
| `public/admin-dpl.html` | `isPushable` tighten + Pushed filter + badge + `fmtPushed` | Modify |
| `tests/unit/dpl-catalog.test.js` | `markPushed` unit test | Modify |

**Reused unchanged:** `_COLS`/`upsertEntries` (push cols excluded → rebuild-safe), `buildCatalogFromDpl`, the linker, `createBulkEditJob`.

---

## Task 1: Migration — 4 push-tracking columns

**Files:** Create `migrations/migrate-dpl-catalog-push-tracking.js`.

- [ ] **Step 1: Create the self-running idempotent migration**

```javascript
/**
 * Add push-tracking columns to dpl_catalog (remember last push per entry).
 * Idempotent: checks information_schema before each ADD. Kept OUT of the build
 * upsert (_COLS) so rebuilds preserve them.
 * Usage: node migrations/migrate-dpl-catalog-push-tracking.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/database').createPool();

async function colExists(table, col) {
    const [r] = await pool.query(
        `SELECT 1 FROM information_schema.columns
         WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1`,
        [table, col]);
    return r.length > 0;
}

(async () => {
    try {
        const adds = [
            ['pushed_at', 'TIMESTAMP NULL DEFAULT NULL'],
            ['pushed_job_id', 'INT DEFAULT NULL'],
            ['pushed_dpl', 'DECIMAL(12,2) DEFAULT NULL'],
            ['pushed_rate', 'DECIMAL(12,2) DEFAULT NULL'],
        ];
        for (const [col, def] of adds) {
            if (await colExists('dpl_catalog', col)) { console.log('  exists:', col); continue; }
            await pool.query(`ALTER TABLE dpl_catalog ADD COLUMN ${col} ${def}`);
            console.log('  added:', col);
        }
        console.log('dpl_catalog push-tracking migration complete');
        process.exit(0);
    } catch (e) { console.error('migration error:', e.message); process.exit(1); }
})();
```

- [ ] **Step 2: Syntax check**

```bash
node --check migrations/migrate-dpl-catalog-push-tracking.js
```
Expected: no output. (Do NOT run it locally — runs on prod after deploy.)

- [ ] **Step 3: Commit**

```bash
git add migrations/migrate-dpl-catalog-push-tracking.js
git commit -m "feat(dpl-catalog): migration — push-tracking columns"
```

---

## Task 2: Service — `markPushed`

**Files:** Modify `services/dpl-catalog.js`; Modify `tests/unit/dpl-catalog.test.js`.

- [ ] **Step 1: Write failing test** — append to `tests/unit/dpl-catalog.test.js` (use the file's module variable, e.g. `catalog`):

```javascript
describe('markPushed', () => {
    test('stamps pushed_at/job/dpl/rate per row', async () => {
        const calls = [];
        catalog.setPool({ query: async (sql, params) => { calls.push({ sql, params }); return [{}]; } });
        await catalog.markPushed([{ id: 7, dpl: 510, rate: 662 }, { id: 9, dpl: 100, rate: 130 }], 86);
        expect(calls).toHaveLength(2);
        expect(calls[0].sql).toMatch(/UPDATE dpl_catalog SET pushed_at = NOW\(\), pushed_job_id = \?, pushed_dpl = \?, pushed_rate = \? WHERE id = \?/);
        expect(calls[0].params).toEqual([86, 510, 662, 7]);
        expect(calls[1].params).toEqual([86, 100, 130, 9]);
    });

    test('no rows → no query', async () => {
        const calls = [];
        catalog.setPool({ query: async (sql, params) => { calls.push({ sql, params }); return [{}]; } });
        await catalog.markPushed([], 1);
        expect(calls).toHaveLength(0);
    });
});
```

- [ ] **Step 2: Run, verify FAIL** — `npx jest tests/unit/dpl-catalog.test.js`.

- [ ] **Step 3: Implement** — in `services/dpl-catalog.js`, immediately AFTER the `updateCanonicalFields` function, add:

```javascript
// Stamp the push state on entries that were just pushed (job created). These columns
// are NOT in _COLS, so a later rebuild preserves them.
async function markPushed(rows, jobId) {
    for (const r of (rows || [])) {
        await pool.query(
            `UPDATE dpl_catalog SET pushed_at = NOW(), pushed_job_id = ?, pushed_dpl = ?, pushed_rate = ? WHERE id = ?`,
            [jobId, r.dpl != null ? r.dpl : null, r.rate != null ? r.rate : null, r.id]
        );
    }
}
```

- [ ] **Step 4: Export** — add `markPushed` to `module.exports` (next to `updateCanonicalFields`).

- [ ] **Step 5: Run, verify PASS** — `npx jest tests/unit/dpl-catalog.test.js` → all pass.

- [ ] **Step 6: Commit**

```bash
git add services/dpl-catalog.js tests/unit/dpl-catalog.test.js
git commit -m "feat(dpl-catalog): markPushed service stamp"
```

---

## Task 3: Routes — push stamp + skip-unchanged + GET push_changed

**Files:** Modify `routes/zoho.js`.

- [ ] **Step 1: Stamp on successful push** — in the push handler, find:

```javascript
        const jobItems = items.map(({ _entry, _zc, ...keep }) => keep);
        const result = await createBulkEditJob(jobItems, req.user);
```
Replace with:

```javascript
        const jobItems = items.map(({ _entry, _zc, ...keep }) => keep);
        const result = await createBulkEditJob(jobItems, req.user);

        // Stamp push state on the pushed entries (best-effort; never fail the push).
        try {
            await dplCatalogService.markPushed(
                items.map(it => ({ id: it._entry.id, dpl: it._entry.current_dpl, rate: it._entry.current_rate })),
                result.job_id
            );
        } catch (stampErr) {
            console.error('DPL catalog push: markPushed failed (non-fatal):', stampErr.message);
        }
```

- [ ] **Step 2: Skip already-pushed-unchanged in the pre-filter** — in the push handler, find:

```javascript
        const conflictFree = [];
        for (const e of pushable) {
            const holders = e.canonical_sku ? (holderBySku.get(String(e.canonical_sku).toUpperCase()) || []) : [];
            const other = holders.find(h => h.id !== String(e.zoho_item_id));
            if (other) {
                skipped.push({ id: e.id, reason: `SKU '${e.canonical_sku}' already used by '${other.name}'` });
            } else {
                conflictFree.push(e);
            }
        }
```
Replace with:

```javascript
        const conflictFree = [];
        for (const e of pushable) {
            const holders = e.canonical_sku ? (holderBySku.get(String(e.canonical_sku).toUpperCase()) || []) : [];
            const other = holders.find(h => h.id !== String(e.zoho_item_id));
            if (other) {
                skipped.push({ id: e.id, reason: `SKU '${e.canonical_sku}' already used by '${other.name}'` });
                continue;
            }
            // Skip entries already pushed with no price change (redundant Zoho write).
            if (e.pushed_at && Number(e.pushed_dpl) === Number(e.current_dpl) && Number(e.pushed_rate) === Number(e.current_rate)) {
                skipped.push({ id: e.id, reason: `already pushed (job #${e.pushed_job_id}), no price change` });
                continue;
            }
            conflictFree.push(e);
        }
```

- [ ] **Step 3: Add `push_changed` to GET enrich** — in the catalog GET handler, find:

```javascript
            return Object.assign({}, e, {
                old_dpl: z && z.zoho_cf_dpl != null ? z.zoho_cf_dpl : null,
                old_rate: z && z.zoho_rate != null ? z.zoho_rate : null,
                zoho_name: z ? z.zoho_item_name : null,
                zoho_sku: z ? z.zoho_sku : null,
                zoho_description: z ? z.zoho_description : null,
                sku_conflict,
            });
```
Replace with:

```javascript
            const push_changed = !!(e.pushed_at != null &&
                (Number(e.pushed_dpl) !== Number(e.current_dpl) || Number(e.pushed_rate) !== Number(e.current_rate)));
            return Object.assign({}, e, {
                old_dpl: z && z.zoho_cf_dpl != null ? z.zoho_cf_dpl : null,
                old_rate: z && z.zoho_rate != null ? z.zoho_rate : null,
                zoho_name: z ? z.zoho_item_name : null,
                zoho_sku: z ? z.zoho_sku : null,
                zoho_description: z ? z.zoho_description : null,
                sku_conflict,
                push_changed,
            });
```
(`pushed_at`/`pushed_job_id`/`pushed_dpl`/`pushed_rate` pass through via the `e` spread — `getCatalog` does `SELECT *`.)

- [ ] **Step 4: Verify**

```bash
node --check routes/zoho.js && node -e "require('./routes/zoho.js'); console.log('zoho OK')"
npx jest tests/unit/dpl-catalog-endpoints.test.js tests/unit/dpl-catalog.test.js
```
Expected: `zoho OK` and all pass.

- [ ] **Step 5: Commit**

```bash
git add routes/zoho.js
git commit -m "feat(dpl-catalog): stamp push state, skip pushed-unchanged, expose push_changed"
```

---

## Task 4: UI — Pushed filter + badge + tightened isPushable

**Files:** Modify `public/admin-dpl.html`.

- [ ] **Step 1: Tighten `isPushable` + add `fmtPushed`** — find:

```javascript
    function isPushable(e) {
        return e.link_status === 'confirmed' && e.zoho_item_id && e.current_dpl != null && Number(e.current_dpl) > 0;
    }
```
Replace with:

```javascript
    function isPushable(e) {
        return e.link_status === 'confirmed' && e.zoho_item_id && e.current_dpl != null && Number(e.current_dpl) > 0
            && (!e.pushed_at || e.push_changed);
    }

    var CAT_MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    function fmtPushed(ts) {
        if (!ts) return '';
        var d = new Date(ts.replace ? ts.replace(' ', 'T') : ts);
        if (isNaN(d.getTime())) return String(ts);
        function p(n){ return (n < 10 ? '0' : '') + n; }
        return p(d.getDate()) + '-' + CAT_MON[d.getMonth()] + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
    }
```

- [ ] **Step 2: Add the `pushed` branch to `visibleCatalogRows`** — find:

```javascript
            if (catalogFilter === 'pushable') { if (!isPushable(e)) return false; }
            else if (catalogFilter !== 'all' && e.link_status !== catalogFilter) return false;
```
Replace with:

```javascript
            if (catalogFilter === 'pushable') { if (!isPushable(e)) return false; }
            else if (catalogFilter === 'pushed') { if (!e.pushed_at) return false; }
            else if (catalogFilter !== 'all' && e.link_status !== catalogFilter) return false;
```

- [ ] **Step 3: Register the `pushed` filter id** — find:

```javascript
        var map = { all: 'catFilterAll', review: 'catFilterReview', needs_creating: 'catFilterNeeds', confirmed: 'catFilterConfirmed', pushable: 'catFilterPushable' };
```
Replace with:

```javascript
        var map = { all: 'catFilterAll', review: 'catFilterReview', needs_creating: 'catFilterNeeds', confirmed: 'catFilterConfirmed', pushable: 'catFilterPushable', pushed: 'catFilterPushed' };
```

- [ ] **Step 4: Add the "✅ Pushed" filter button** — find:

```html
                        <button onclick="setCatalogFilter('pushable')" id="catFilterPushable" class="cat-filter px-2 py-1 rounded text-[11px] font-semibold bg-gray-100 text-gray-600">☑ Pushable</button>
```
Replace with:

```html
                        <button onclick="setCatalogFilter('pushable')" id="catFilterPushable" class="cat-filter px-2 py-1 rounded text-[11px] font-semibold bg-gray-100 text-gray-600">☑ Pushable</button>
                        <button onclick="setCatalogFilter('pushed')" id="catFilterPushed" class="cat-filter px-2 py-1 rounded text-[11px] font-semibold bg-gray-100 text-gray-600">✅ Pushed</button>
```

- [ ] **Step 5: Add a `pushedBadge` helper + render it in card and table** — in `renderCatalog`, find the `statusBadge` inner helper:

```javascript
        function statusBadge(e) {
```
Insert BEFORE it:

```javascript
        function pushedBadge(e) {
            if (!e.pushed_at) return '';
            var base = '✅ Pushed ' + esc(fmtPushed(e.pushed_at)) + (e.pushed_job_id ? ' · job #' + esc(String(e.pushed_job_id)) : '');
            if (e.push_changed) {
                return '<div class="text-[10px] text-amber-600 mt-0.5">' + base + ' · ⚠ ₹' + esc(String(e.pushed_dpl)) + '→₹' + esc(String(e.current_dpl)) + ' re-push</div>';
            }
            return '<div class="text-[10px] text-emerald-600 mt-0.5">' + base + ' · no change</div>';
        }
```

- [ ] **Step 6: Render the pushed badge in the CARD** — find (the card's SKU line + linked block):

```javascript
                var skuLine = '<div class="text-[10px] font-mono mt-0.5 ' + (e.sku_conflict ? 'text-rose-600' : 'text-gray-400') + '">' + esc(e.canonical_sku || '-') + (e.sku_conflict ? ' ⚠ dup' : '') + '</div>';
```
Append after the `'<div class="text-[11px] text-gray-600 mt-0.5 truncate">' + linkedHtml(e) + '</div>' +` line, by replacing:

```javascript
                        '<div class="text-[11px] text-gray-600 mt-0.5 truncate">' + linkedHtml(e) + '</div>' +
                        '<div class="mt-2 flex flex-wrap gap-1">' + actionHtml(e) + '</div>' +
```
with:

```javascript
                        '<div class="text-[11px] text-gray-600 mt-0.5 truncate">' + linkedHtml(e) + '</div>' +
                        pushedBadge(e) +
                        '<div class="mt-2 flex flex-wrap gap-1">' + actionHtml(e) + '</div>' +
```

- [ ] **Step 7: Render the pushed badge in the TABLE status cell** — find:

```javascript
                    '<td class="px-2 py-1.5 text-center">' + statusBadge(e) + '</td>' +
                    '<td class="px-2 py-1.5 text-center whitespace-nowrap">' + actionHtml(e) + '</td>' +
```
Replace with:

```javascript
                    '<td class="px-2 py-1.5 text-center">' + statusBadge(e) + pushedBadge(e) + '</td>' +
                    '<td class="px-2 py-1.5 text-center whitespace-nowrap">' + actionHtml(e) + '</td>' +
```

- [ ] **Step 8: Sanity** — grep each appears once: `function fmtPushed`, `function pushedBadge`, `id="catFilterPushed"`, `catalogFilter === 'pushed'`, `pushed: 'catFilterPushed'`. Confirm `isPushable` has the `(!e.pushed_at || e.push_changed)` clause.

- [ ] **Step 9: Browser smoke (human verifies)** — push a confirmed item → it leaves "Pushable", appears under **✅ Pushed** with "✅ Pushed DD-Mon HH:MM · job #N · no change"; rebuild → still pushed, not pushable; change that item's DPL (re-upload DPL + apply prices) → badge shows "⚠ ₹old→₹new re-push" and it re-enters Pushable.

- [ ] **Step 10: Commit**

```bash
git add public/admin-dpl.html
git commit -m "feat(dpl-catalog-ui): Pushed filter + last-push badge; pushed-unchanged not pushable"
```

---

## Self-Review notes (spec coverage)

- **4 columns, rebuild-safe (not in _COLS):** Task 1 + the unchanged `_COLS`. ✓
- **Stamp on push (date/job/dpl/rate):** Task 2 + Task 3 Step 1. ✓
- **Skip pushed-unchanged on push:** Task 3 Step 2. ✓
- **`push_changed` in GET:** Task 3 Step 3. ✓
- **isPushable excludes pushed-unchanged; Pushed filter; badge with date/job + change signal:** Task 4. ✓
- **Price-only "changed":** the `pushed_dpl/rate` vs `current_dpl/rate` comparisons. ✓

## Post-deploy (controller runs)

1. Push + deploy.
2. Apply the migration on prod: `ssh hetzner "cd /www/wwwroot/act.qcpaintshop.com && node migrations/migrate-dpl-catalog-push-tracking.js"`.
3. Smoke per Task 4 Step 9 (a real push stamps the columns; rebuild preserves them).

## Out of scope

Tracking name/SKU-only changes; background-worker Zoho-failure reconciliation; other brands.
