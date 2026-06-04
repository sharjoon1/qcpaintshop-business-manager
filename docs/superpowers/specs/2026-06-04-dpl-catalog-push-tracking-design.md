# DPL Catalog — push-state tracking

**Date:** 2026-06-04
**Status:** Approved
**Scope:** migration (4 new `dpl_catalog` columns), `routes/zoho.js` (push stamp + GET enrich + push pre-filter), `services/dpl-catalog.js` (stamp helper), `public/admin-dpl.html` (Pushed filter + badge + isPushable). Rebuild-safe by design.

## Problem

After pushing confirmed catalog entries to Zoho, the catalog keeps no memory of the push. Rebuilding the catalog (or re-uploading a DPL) shows the already-pushed items as "ready to push" again — even when the price hasn't changed. The user wants: already-pushed items shown **separately**, with the **last push date/time + bulk job #**; on a DPL re-upload with **no price change** they read "already pushed, no change" (not re-pushable); only a **price change** re-flags them for push.

## Decision (from brainstorming)

Track the push on each entry with 4 new columns kept OUT of the build upsert's column set, so they survive every rebuild. "Changed since push" = the **price** (DPL or selling rate) differs from what was pushed (name/SKU-only changes do not re-flag). Already-pushed-unchanged entries are excluded from "Pushable" (not selectable) and shown under a new "Pushed" filter.

## Architecture

### 1. Schema — 4 new `dpl_catalog` columns (migration)

`migrations/migrate-dpl-catalog-push-tracking.js` (idempotent — checks `information_schema.columns` before each ADD):

| Column | Type | Meaning |
|---|---|---|
| `pushed_at` | TIMESTAMP NULL DEFAULT NULL | last successful push time (server/IST) |
| `pushed_job_id` | INT DEFAULT NULL | the `zoho_bulk_jobs.id` of that push |
| `pushed_dpl` | DECIMAL(12,2) DEFAULT NULL | `current_dpl` at push time |
| `pushed_rate` | DECIMAL(12,2) DEFAULT NULL | `current_rate` at push time |

**Rebuild-safety:** `services/dpl-catalog.js` `_COLS` (the upsert column list) does NOT include these → `INSERT … ON DUPLICATE KEY UPDATE` never overwrites them. A rebuild that hits the same `match_key` preserves the push stamp. (Confirmed: `_COLS` is build-only.)

### 2. Push stamp (`routes/zoho.js` push endpoint)

After `const result = await createBulkEditJob(jobItems, req.user);` succeeds, stamp every pushed entry. The push loop already holds `items[]` with `_entry` (the catalog row). Add a service call:

```javascript
await dplCatalogService.markPushed(
    items.map(it => ({ id: it._entry.id, dpl: it._entry.current_dpl, rate: it._entry.current_rate })),
    result.job_id
);
```

New service `markPushed(rows, jobId)`:
```
UPDATE dpl_catalog SET pushed_at = NOW(), pushed_job_id = ?, pushed_dpl = ?, pushed_rate = ? WHERE id = ?   -- per row
```
Best-effort (wrap in try/catch; a stamp failure must not fail the push that already succeeded).

### 3. Push pre-filter — skip already-pushed-unchanged (defensive)

In the push endpoint, after computing `conflictFree`, drop entries already pushed with no price change into `skipped` (reason `already pushed (job #N), no price change`). "No change" = `pushed_at != null && Number(pushed_dpl)===Number(current_dpl) && Number(pushed_rate)===Number(current_rate)`. The client won't select them, but this guards redundant Zoho writes if it ever happens.

### 4. GET enrich (`routes/zoho.js` catalog GET)

`getCatalog` already returns the new columns (`SELECT *`). The endpoint adds a derived field per entry:
- `push_changed` = `pushed_at != null && (Number(pushed_dpl) !== Number(current_dpl) || Number(pushed_rate) !== Number(current_rate))`

(`pushed_at`, `pushed_job_id`, `pushed_dpl`, `pushed_rate` pass through unchanged.)

### 5. UI (`public/admin-dpl.html`)

- **`isPushable(e)`** gains: `&& (!e.pushed_at || e.push_changed)` — already-pushed-unchanged entries are no longer pushable/selectable.
- **New filter** `pushed`: a "✅ Pushed" button; `visibleCatalogRows` treats `catalogFilter === 'pushed'` as "show entries with `pushed_at != null`".
- **Card/row badge** when `pushed_at`:
  - base: `✅ Pushed <DD-Mon HH:MM> · job #<pushed_job_id>`
  - if `push_changed`: append `⚠ price changed ₹<pushed_dpl>→₹<current_dpl> — re-push` (and the row IS pushable again).
  - else: append `· no price change` (not pushable).
- Date formatting: a small `fmtPushed(ts)` helper → "04-Jun 14:30" (local). The count chips / select-all already key off `isPushable`, so they update automatically.

## Non-goals

- No change to `buildCatalogFromDpl`, the linker, the proposer, `confirmLink`, `applyDplPrices`.
- "Changed" tracks price only (DPL/rate), not name/SKU/description.
- The stamp is at job-creation time (push submitted). Background-worker Zoho failures are tracked by the bulk job itself, not re-surfaced on the catalog (could refine later).

## Error handling

- `markPushed` best-effort (try/catch, non-fatal).
- Migration idempotent (column-exists checks) — safe to re-run.
- GET enrich: `push_changed` is false when `pushed_at` is null.

## Testing

- Unit (`services/dpl-catalog.js`): `markPushed([{id,dpl,rate}], 86)` issues one UPDATE per row with `[86, dpl, rate, id]` param order and `pushed_at = NOW()` in the SQL.
- Route registration unaffected; existing catalog endpoint tests stay green.
- Post-deploy integration: apply migration; push a test item → verify `pushed_at`/`pushed_job_id`/`pushed_dpl`/`pushed_rate` set; rebuild → values preserved, entry shows pushed + not pushable; bump that entry's `current_dpl` → `push_changed` true, re-pushable.

## Key files

- Create: `migrations/migrate-dpl-catalog-push-tracking.js`.
- Modify: `services/dpl-catalog.js` (`markPushed`), `routes/zoho.js` (stamp + pre-filter skip + GET `push_changed`), `public/admin-dpl.html` (Pushed filter, badge, isPushable).
- Test: `tests/unit/dpl-catalog.test.js` (extend for `markPushed`).
