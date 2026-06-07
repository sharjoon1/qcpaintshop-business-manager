# Zoho-first Unmatched Disposition — Design

**Date:** 2026-06-07
**Status:** Approved (brainstormed with owner)
**Area:** `public/admin-dpl.html` "Zoho-first" tab · `services/dpl-catalog.js` · `routes/zoho.js` · migration

## Problem

In the Zoho-first view, the **No match** filter lists every active Zoho item with
no linked DPL-catalog entry. Many of these genuinely have **no DPL-list price** —
non-Birla products, accessories, services, fixed-price SKUs. Today the only actions
on an unmatched row are *Attach DPL* / *Accept proposal*, which assume a DPL match
exists. There is no way to say "this item has no DPL match — I handled it manually"
or "set this one aside for later". So the No-match list never shrinks and the owner
cannot triage it.

## Goal

Give each unmatched Zoho item a **disposition** the owner controls:

- **pending** (default) — still needs triage; shows under *No match*.
- **done** — owner set a manual price, pushed it to Zoho, and finalized the item.
- **later** — deferred; set aside to handle another day.

Done/Later items leave the *No match* list but remain visible (with a badge) under
*All* and under their own filter chips. Every disposition is reversible (*Reopen*).

## Decisions (owner-confirmed)

1. **"Done" semantics:** manual rate → push to Zoho → mark Done. Done always goes
   through the existing edit + push path; it is not a bare flag.
2. **Manual price entry:** owner types a **manual DPL**; rate auto-computes as
   `ceil(dpl × 1.18 × 1.10)` (existing `computeZohoRate`). No new direct-rate field —
   stays consistent with the whole DPL-driven pricing model.
3. **Visibility:** Done/Later items are removed from *No match* but still appear in
   *All* with a Done/Later badge, plus dedicated *Done* / *Later* filter chips.
4. **Storage:** new columns on `zoho_items_map` (approach A).

## Architecture

### Storage (approach A — columns on `zoho_items_map`)

Additive migration adds:

| Column | Type | Notes |
|---|---|---|
| `dpl_disposition` | `VARCHAR(16) NOT NULL DEFAULT 'pending'` | `pending` / `done` / `later` |
| `dpl_disposition_at` | `DATETIME NULL` | stamped when set to done/later |
| `dpl_disposition_by` | `INT NULL` | user id who set it (audit) |

`ALGORITHM=INPLACE, LOCK=NONE` (MariaDB 10.11). **Sync-safe:** the Zoho item sync
(`services/zoho-api.js`) is `INSERT … ON DUPLICATE KEY UPDATE` over an explicit
column list and never deletes rows (it only flips `zoho_status` to `inactive` then
re-activates synced items). It does not touch `dpl_disposition`, so the disposition
persists across syncs exactly like `zoho_cf_dpl` / `dpl_updated_at`.

Rejected alternatives: (B) separate `zoho_dpl_dispositions` table — extra join +
orphan risk for no gain; (C) placeholder `dpl_catalog` entries — pollutes the catalog.

### Backend

- **`buildZohoFirstView` (`services/dpl-catalog.js`)** — read `zi.dpl_disposition`
  and surface `disposition` (default `'pending'`) on every row object. The field is
  independent of `status`; matched/shared rows simply carry `'pending'` unless
  explicitly set. No sort change required (disposition filtering is done client-side).
- **by-zoho route (`routes/zoho.js`)** — add `dpl_disposition` to the `zoho_items_map`
  SELECT that feeds `zohoItems` (alongside the existing `catalogZohoScopeSql` columns).
- **New endpoint** `POST /api/zoho/items/zoho-item/:id/disposition`
  - body `{ disposition: 'pending' | 'done' | 'later' }`
  - validates the enum; updates `dpl_disposition`, `dpl_disposition_at`
    (`NOW()` for done/later, `NULL` for pending), `dpl_disposition_by = req.user.id`.
  - permission `zoho/manage`; writes an `audit-log` record (before/after).
- **Manual rate path reuses existing endpoints** — no new push logic:
  - `PUT /api/zoho/items/zoho-item/:id` (edit: name/sku/desc/dpl) — already present.
  - `POST /api/zoho/items/zoho-item/:id/push` — already present (reuses the audited
    `createBulkEditJob`, SKU-conflict guard + mirror-back).

### Frontend (`public/admin-dpl.html`, Zoho-first tab)

**Row state surfaced:** each row carries `r.disposition` (`pending`/`done`/`later`).

**Actions on an unmatched + pending row** (table row actions + card, mobile parity):
- `✅ Done` → opens the existing `✏ Edit` sheet (`openZfEdit`) in **Done mode**: the
  primary button becomes `✅ Push & mark Done`, which runs `saveZfEdit` →
  `pushZfItem` → on push success calls the disposition endpoint with `done`. If the
  push fails (e.g. SKU conflict) the item is **not** marked done and the error toast
  shows.
- `🕒 Later` → one-click → disposition endpoint with `later` → `loadZohoFirst`.

**Done/Later rows:** show a badge (`✅ Done` / `🕒 Later`) and an `↩ Reopen` action
(disposition `pending`). The Attach/Accept actions stay available so a deferred item
can still be DPL-linked later.

**Filter chips:** add `✅ Done` and `🕒 Later`. Predicate changes in
`visibleZohoFirstRows`:
- `unmatched` (No match) → `status === 'unmatched' && disposition === 'pending'`.
- `done` → `disposition === 'done'`.
- `later` → `disposition === 'later'`.
- `all` → unchanged (everything; badges distinguish disposition).
- Existing `changed` / `shared` / `unchanged` / `pushable` / `pushed` predicates
  unchanged.

**Stat counts:** No-match count reflects pending-only (cosmetic; uses the same
predicate).

### Data flow (Done)

```
[unmatched pending row]
   │  click ✅ Done
   ▼
openZfEdit(id)  ──set manual DPL──►  ✅ Push & mark Done
                                         │ PUT  /zoho-item/:id   (name/sku/desc/dpl)
                                         │ POST /zoho-item/:id/push   (createBulkEditJob)
                                         │   └─ push fails ─► toast, STOP (stays pending)
                                         ▼ push ok
                                       POST /zoho-item/:id/disposition {done}
                                         ▼
                                       loadZohoFirst() → row leaves No-match, badge ✅ Done
```

## Error handling

- Disposition endpoint rejects unknown enum values with 400.
- Done flow is sequential and fails closed: a failed edit or push aborts before the
  disposition is written, so a half-finished item stays `pending` and visible.
- `Reopen` and `Later` are idempotent single writes; safe to repeat.

## Testing

**Unit (`tests/unit/dpl-catalog-zoho-first.test.js`)**
- `buildZohoFirstView` surfaces `disposition` from the entry/zoho item; defaults to
  `'pending'` when absent.

**E2E (`tests/e2e/admin-dpl-zoho-first.spec.js`)**
- `🕒 Later` on a pending unmatched row removes it from *No match* and it appears
  under the *Later* chip.
- A `done` row renders a `✅ Done` badge and an `↩ Reopen` action, and is hidden from
  *No match* but present under *All*.
- Card (mobile) view exposes the same Done/Later actions.

## Scope / out of scope

- **In:** Birla Opus brand (the existing Zoho-first scope). Disposition columns are
  brand-agnostic, so other brands inherit the behavior when their scope is added.
- **Out:** a direct-rate override field (owner chose manual-DPL→auto-rate);
  disposition notes/reason text (YAGNI — not requested); bulk disposition actions.

## File map

| File | Action |
|---|---|
| `migrations/add-zoho-dpl-disposition.js` | New — add 3 columns to `zoho_items_map` |
| `services/dpl-catalog.js` | Surface `disposition` in `buildZohoFirstView` |
| `routes/zoho.js` | Select `dpl_disposition`; add disposition POST endpoint |
| `public/admin-dpl.html` | Done/Later/Reopen actions, badges, filter chips, predicate |
| `tests/unit/dpl-catalog-zoho-first.test.js` | disposition passthrough |
| `tests/e2e/admin-dpl-zoho-first.spec.js` | Later move, Done badge+Reopen, card parity |
