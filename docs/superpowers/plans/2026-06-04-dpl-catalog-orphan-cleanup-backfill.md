# DPL Catalog — orphan cleanup + push backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the build self-clean stale catalog entries (orphans), and backfill push history from existing bulk jobs so already-pushed items (e.g. job #86's 85) appear under the "✅ Pushed" filter.

**Architecture:** `deleteOrphans(brand, keepMatchKeys)` in `services/dpl-catalog.js`; the build endpoint calls it after upsert (deterministic full rebuild → safe to delete the complement). A one-time `scripts/backfill-dpl-catalog-push.js` stamps `pushed_*` from `item_update` bulk jobs (payload carries `cf_dpl`/`rate`).

**Tech Stack:** Node.js CommonJS + mysql2, Jest.

**Spec:** `docs/superpowers/specs/2026-06-04-dpl-catalog-orphan-cleanup-backfill-design.md`

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `services/dpl-catalog.js` | `deleteOrphans(brand, keepKeys)` | Modify |
| `routes/zoho.js` | build calls `deleteOrphans`; `removed` in summary | Modify |
| `scripts/backfill-dpl-catalog-push.js` | one-time push-history backfill (dry-run default) | Create |
| `tests/unit/dpl-catalog.test.js` | `deleteOrphans` unit test | Modify |

---

## Task 1: `deleteOrphans` + build self-clean

**Files:** Modify `services/dpl-catalog.js`, `routes/zoho.js`, `tests/unit/dpl-catalog.test.js`.

- [ ] **Step 1: Write failing test** — append to `tests/unit/dpl-catalog.test.js` (module var e.g. `catalog`):

```javascript
describe('deleteOrphans', () => {
    test('deletes rows for the brand whose match_key is not in keepKeys', async () => {
        const calls = [];
        catalog.setPool({ query: async (sql, params) => { calls.push({ sql, params }); return [{ affectedRows: 3 }]; } });
        const n = await catalog.deleteOrphans('birlaopus', ['k1', 'k2']);
        expect(n).toBe(3);
        expect(calls).toHaveLength(1);
        expect(calls[0].sql).toMatch(/DELETE FROM dpl_catalog WHERE brand = \? AND match_key NOT IN \(\?, \?\)/);
        expect(calls[0].params).toEqual(['birlaopus', 'k1', 'k2']);
    });

    test('empty keepKeys → no query, returns 0 (never wipes)', async () => {
        const calls = [];
        catalog.setPool({ query: async (sql, params) => { calls.push({ sql, params }); return [{}]; } });
        expect(await catalog.deleteOrphans('birlaopus', [])).toBe(0);
        expect(calls).toHaveLength(0);
    });
});
```

- [ ] **Step 2: Run, verify FAIL** — `npx jest tests/unit/dpl-catalog.test.js`.

- [ ] **Step 3: Implement** — in `services/dpl-catalog.js`, immediately AFTER the `upsertEntries` function, add:

```javascript
// Delete catalog rows for a brand whose match_key is NOT in the freshly-built set
// (self-cleaning rebuild — removes products no longer in the DPL). Empty keepKeys
// is a no-op so a failed/empty build can never wipe the table.
async function deleteOrphans(brand, keepKeys) {
    if (!keepKeys || !keepKeys.length) return 0;
    const [r] = await pool.query(
        `DELETE FROM dpl_catalog WHERE brand = ? AND match_key NOT IN (${keepKeys.map(() => '?').join(',')})`,
        [brand, ...keepKeys]
    );
    return r.affectedRows || 0;
}
```

- [ ] **Step 4: Export** — add `deleteOrphans` to `module.exports` (next to `upsertEntries`).

- [ ] **Step 5: Wire into the build endpoint** — in `routes/zoho.js` build handler, find:

```javascript
        const entries = dplCatalogService.buildCatalogFromDpl(brand, parsedRows, zohoItems);
        const updatedBy = req.user ? (req.user.username || String(req.user.id)) : null;
        await dplCatalogService.upsertEntries(entries, updatedBy);

        const summary = { total: entries.length, confirmed: 0, review: 0, needs_creating: 0 };
        entries.forEach(e => { summary[e.link_status] = (summary[e.link_status] || 0) + 1; });

        res.json({ success: true, data: summary });
```
Replace with:

```javascript
        const entries = dplCatalogService.buildCatalogFromDpl(brand, parsedRows, zohoItems);
        const updatedBy = req.user ? (req.user.username || String(req.user.id)) : null;
        await dplCatalogService.upsertEntries(entries, updatedBy);
        const removed = await dplCatalogService.deleteOrphans(brand, entries.map(e => e.match_key));

        const summary = { total: entries.length, confirmed: 0, review: 0, needs_creating: 0, removed };
        entries.forEach(e => { if (e.link_status in summary) summary[e.link_status] += 1; });

        res.json({ success: true, data: summary });
```
(Note: the `if (e.link_status in summary)` guard keeps the existing per-status counting but avoids clobbering the new `removed` key — `removed` is not a link_status so it's never incremented by an entry.)

- [ ] **Step 6: Verify**

```bash
node -e "require('./services/dpl-catalog.js'); console.log('svc OK')"
node --check routes/zoho.js && node -e "require('./routes/zoho.js'); console.log('zoho OK')"
npx jest tests/unit/dpl-catalog.test.js tests/unit/dpl-catalog-endpoints.test.js
```
Expected: `svc OK`, `zoho OK`, all pass.

- [ ] **Step 7: Commit**

```bash
git add services/dpl-catalog.js routes/zoho.js tests/unit/dpl-catalog.test.js
git commit -m "feat(dpl-catalog): self-cleaning build (deleteOrphans on rebuild)"
```

---

## Task 2: One-time push backfill script

**Files:** Create `scripts/backfill-dpl-catalog-push.js`.

- [ ] **Step 1: Create the script**

```javascript
/**
 * One-time: backfill dpl_catalog push state from historical item_update bulk jobs.
 * Each job_item payload carries the exact cf_dpl/rate pushed; match by zoho_item_id,
 * most-recent job wins. Run AFTER orphan cleanup so only current entries are stamped.
 *
 * Usage:
 *   node scripts/backfill-dpl-catalog-push.js [brand]          # dry-run (default birlaopus)
 *   node scripts/backfill-dpl-catalog-push.js [brand] --apply  # write
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../config/database').createPool();

(async () => {
    const brand = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'birlaopus';
    const apply = process.argv.includes('--apply');
    try {
        const [entries] = await pool.query(
            'SELECT id, zoho_item_id FROM dpl_catalog WHERE brand = ? AND zoho_item_id IS NOT NULL', [brand]);

        const [rows] = await pool.query(
            `SELECT j.id AS job_id, j.created_at, ji.zoho_item_id, ji.payload
             FROM zoho_bulk_job_items ji JOIN zoho_bulk_jobs j ON ji.job_id = j.id
             WHERE j.job_type = 'item_update' ORDER BY j.id ASC`);

        const latestByZid = new Map(); // zoho_item_id -> { job_id, created_at, dpl, rate }
        for (const r of rows) {
            let pl = r.payload;
            try { pl = typeof pl === 'string' ? JSON.parse(pl) : pl; } catch (e) { continue; }
            if (!pl || pl.cf_dpl == null || isNaN(Number(pl.cf_dpl))) continue;
            latestByZid.set(String(r.zoho_item_id), {
                job_id: r.job_id, created_at: r.created_at,
                dpl: Number(pl.cf_dpl), rate: pl.rate != null ? Number(pl.rate) : null,
            });
        }

        let stamped = 0; const samples = [];
        for (const e of entries) {
            const rec = latestByZid.get(String(e.zoho_item_id));
            if (!rec) continue;
            stamped++;
            if (samples.length < 15) samples.push({ id: e.id, job: rec.job_id, dpl: rec.dpl, rate: rec.rate });
            if (apply) {
                await pool.query(
                    'UPDATE dpl_catalog SET pushed_at = ?, pushed_job_id = ?, pushed_dpl = ?, pushed_rate = ? WHERE id = ?',
                    [rec.created_at, rec.job_id, rec.dpl, rec.rate, e.id]);
            }
        }

        console.log(`brand=${brand} linked=${entries.length} matched=${stamped} ${apply ? 'STAMPED' : '(DRY-RUN — pass --apply)'}`);
        console.table(samples);
        process.exit(0);
    } catch (err) { console.error('backfill error:', err.message); process.exit(1); }
})();
```

- [ ] **Step 2: Syntax check**

```bash
node --check scripts/backfill-dpl-catalog-push.js
```
Expected: no output. (Runs on prod after deploy + rebuild.)

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-dpl-catalog-push.js
git commit -m "chore(dpl-catalog): one-time push-history backfill script"
```

---

## Self-Review notes (spec coverage)

- **deleteOrphans (empty-guard, NOT IN delete):** Task 1 Steps 3 + test. ✓
- **Build self-cleans + reports `removed`:** Task 1 Step 5. ✓
- **Backfill from item_update jobs (cf_dpl/rate, most-recent wins):** Task 2. ✓
- **Order preserved (rebuild before backfill):** post-deploy section below. ✓

## Post-deploy (controller runs)

1. Push + deploy.
2. **Rebuild** the Birla catalog server-side → response shows `removed ≈ 566`; catalog count ~1342.
3. **Backfill dry-run:** `node scripts/backfill-dpl-catalog-push.js birlaopus` → review matched count; then `--apply`.
4. Verify: catalog GET count ~1342; ✅ Pushed filter shows job #86's items with `pushed_job_id=86`.

## Out of scope

Distinguishing catalog vs manual pushes; UI changes; other brands.
