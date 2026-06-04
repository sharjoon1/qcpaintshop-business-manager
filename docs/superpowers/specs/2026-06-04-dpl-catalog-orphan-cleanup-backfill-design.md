# DPL Catalog — orphan cleanup (self-cleaning build) + push backfill

**Date:** 2026-06-04
**Status:** Approved
**Scope:** `services/dpl-catalog.js` (`deleteOrphans`), `routes/zoho.js` (build wires it), a one-time backfill script. No UI/migration.

## Problem

1. **Orphans:** the catalog GET shows 1908 entries but a fresh build produces 1342 — ~566 stale rows from older DPL/CSV builds remain, because `upsertEntries` never deletes match_keys that disappear from the source. (A Zoho item linked to a current entry AND its orphan duplicate is why job #86's 85 items match 99 catalog rows.)
2. **No push history:** the 85 items pushed in **bulk job #86** (2026-06-03, before push-tracking shipped) have no `pushed_at`, so they don't appear under the new "✅ Pushed" filter.

## Decision (from brainstorming)

- **Self-cleaning build:** the build endpoint deletes catalog rows whose `match_key` is not in the freshly-built set (permanent — orphans never accumulate again).
- **One-time push backfill:** stamp `pushed_*` from historical `item_update` bulk jobs (their `job_items.payload` carries the exact `cf_dpl`/`rate` pushed). Match by `zoho_item_id`, most-recent job wins.
- **Order:** deploy → rebuild (cleans orphans, leaving one entry per item) → backfill (stamps the clean entries).

## Architecture

### 1. `deleteOrphans(brand, keepMatchKeys)` — `services/dpl-catalog.js`

```javascript
async function deleteOrphans(brand, keepKeys) {
    if (!keepKeys || !keepKeys.length) return 0;   // never wipe on an empty build
    const [r] = await pool.query(
        `DELETE FROM dpl_catalog WHERE brand = ? AND match_key NOT IN (${keepKeys.map(() => '?').join(',')})`,
        [brand, ...keepKeys]
    );
    return r.affectedRows || 0;
}
```
~1342 placeholders is well within MySQL limits. The empty-keys guard means a failed/empty build never deletes anything.

### 2. Build endpoint wires it (`routes/zoho.js` build)

After `await dplCatalogService.upsertEntries(entries, updatedBy);` (entries is non-empty — the handler 404s earlier when the DPL has no rows), add:

```javascript
const removed = await dplCatalogService.deleteOrphans(brand, entries.map(e => e.match_key));
```
Include `removed` in the summary response (`{ total, confirmed, review, needs_creating, removed }`). The build reads the entire saved DPL each run and is deterministic, so the kept set is always the full catalog — safe to delete the complement.

### 3. One-time push backfill — `scripts/backfill-dpl-catalog-push.js`

Self-running (dotenv + pool), dry-run by default, `--apply` to write:

1. Load catalog entries with a `zoho_item_id` for the brand (`id, zoho_item_id`).
2. Load `item_update` bulk jobs + items ASC by job id:
   `SELECT j.id AS job_id, j.created_at, ji.zoho_item_id, ji.payload FROM zoho_bulk_job_items ji JOIN zoho_bulk_jobs j ON ji.job_id=j.id WHERE j.job_type='item_update' ORDER BY j.id ASC`.
3. Build `latestByZid`: for each row whose payload (JSON-parsed) has a numeric `cf_dpl`, set `latestByZid[zoho_item_id] = { job_id, created_at, dpl: cf_dpl, rate: payload.rate }`. ASC order → the most-recent job wins.
4. For each catalog entry whose `zoho_item_id` is in `latestByZid`, `UPDATE dpl_catalog SET pushed_at=?, pushed_job_id=?, pushed_dpl=?, pushed_rate=? WHERE id=?` (apply mode). Report count + samples.

`pushed_dpl`/`pushed_rate` come from the **payload** (the exact pushed values), so `push_changed` correctly compares them against the entry's current price.

## Non-goals

- No change to the proposer, linker, confirmLink, push endpoint, or UI.
- Backfill is one-time and historical; future pushes are stamped by `markPushed`.
- No attempt to distinguish "catalog push" from "manual DPL edit" job — any `cf_dpl`-bearing `item_update` job that touched a linked item counts (accurate: that DPL is in Zoho).

## Error handling

- `deleteOrphans` empty keys → no-op (return 0).
- Build deletion runs only after a successful upsert of a non-empty set.
- Backfill: payload parse wrapped in try/catch per row; rows without `cf_dpl` skipped.

## Testing

- Unit (`services/dpl-catalog.js`): `deleteOrphans('birlaopus', ['k1','k2'])` → DELETE SQL with `match_key NOT IN (?, ?)` and params `['birlaopus','k1','k2']`; empty keys → no query, returns 0.
- Build endpoint registration unaffected; existing tests stay green.
- Post-deploy integration: rebuild → response `removed ≈ 566`, catalog GET count drops to ~1342; then backfill dry-run shows ~85+ stamped → `--apply` → job #86's items appear under ✅ Pushed with "job #86".

## Key files

- Modify: `services/dpl-catalog.js` (`deleteOrphans` + export), `routes/zoho.js` (build wires it + `removed` in summary).
- Create: `scripts/backfill-dpl-catalog-push.js`.
- Test: `tests/unit/dpl-catalog.test.js` (extend for `deleteOrphans`).
