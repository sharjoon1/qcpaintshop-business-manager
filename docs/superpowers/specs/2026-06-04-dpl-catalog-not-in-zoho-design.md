# DPL Catalog — "Not in Zoho (pending creation)" mark + filter

**Date:** 2026-06-04
**Status:** Approved
**Scope:** migration (1 column), `services/dpl-catalog.js` (setter), `routes/zoho.js` (mark endpoint + GET passthrough), `public/admin-dpl.html` (mark button + Pending filter). No proposer/linker change.

## Problem

Many review/needs_creating entries are genuinely **not in Zoho yet** (new products like Aluminum, or bases with no Zoho item like OPE White). The user wants to **mark** such an item as "not uploaded / pending creation" so it's triaged, and **filter those out** of the review list so only actionable items remain (and keep a worklist of the pending ones).

## Decision (from brainstorming)

- A `not_in_zoho` flag on the catalog entry, set via a mark/unmark action on **not-linked** entries (from the picker modal and the card/row).
- Survives rebuilds (kept OUT of the build upsert `_COLS`).
- A **"🚫 Pending"** filter shows marked-and-still-unlinked entries; **all other filters hide them**.
- **"Pending" = `not_in_zoho` AND not linked** — if a marked item later gets a `zoho_item_id` (created in Zoho + picked, or a rebuild match), it auto-leaves Pending and shows normally; no stale-state cleanup needed.

## Architecture

### 1. Schema — `migrations/migrate-dpl-catalog-not-in-zoho.js`

Idempotent (information_schema check), self-running. Adds:
`not_in_zoho TINYINT(1) NOT NULL DEFAULT 0`.
NOT added to `_COLS` → preserved across rebuilds.

### 2. Service — `setNotInZoho(id, value, updatedBy)` (`services/dpl-catalog.js`)

```javascript
async function setNotInZoho(id, value, updatedBy) {
    await pool.query(
        `UPDATE dpl_catalog SET not_in_zoho = ?, updated_by = ? WHERE id = ?`,
        [value ? 1 : 0, updatedBy || null, id]
    );
}
```
Exported.

### 3. Endpoint — `POST /api/zoho/items/dpl-catalog/entry/:id/not-in-zoho`

`requirePermission('zoho','manage')`. Body `{ value: boolean }`. Parses id (400 if invalid); `setNotInZoho(id, !!value, updatedBy)`; `{ success:true }`.

### 4. GET enrich

`not_in_zoho` passes through via `getCatalog`'s `SELECT *` (MySQL returns 0/1). No code needed.

### 5. UI (`public/admin-dpl.html`)

- **`isPending(e)`** = `!!e.not_in_zoho && !e.zoho_item_id`.
- **`visibleCatalogRows`** restructured: if `catalogFilter === 'pending'` → keep only `isPending(e)`; else → drop `isPending(e)` first, then apply the existing pushable/pushed/status logic. (Search filter unchanged, applied after.)
- **"🚫 Pending" filter button** (`#catFilterPending`) + entry in the `setCatalogFilter` id map.
- **Mark/unmark action** for not-linked entries (`!e.zoho_item_id`) in `actionHtml`: when not marked → "🚫 Not in Zoho" (rose); when marked → "↩ Unmark" (gray). `onclick="markNotInZoho(id, true|false)"`.
- **Picker modal footer:** a "🚫 Not in Zoho (mark pending)" button → `markNotInZoho(catPickerEntryId, true)` then `closeCatPicker()` (per the user's "mark it there when the item isn't in Zoho").
- **`markNotInZoho(id, value)`**: POST the endpoint, update the in-memory entry's `not_in_zoho`, toast, `renderCatalog()`.
- **Badge** on pending rows (visible only in the Pending filter): "🚫 pending creation" (rose).

## Non-goals

- No auto-create in Zoho (still flag-only); this just records the user's triage decision.
- No proposer/linker/push change. Pending items are never pushable (not linked).

## Error handling

- Endpoint: invalid id → 400. Migration idempotent.
- `isPending` is false when linked, so a later link clears the Pending state implicitly.

## Testing

- Unit (`services/dpl-catalog.js`): `setNotInZoho(5, true, 'u')` → `UPDATE … SET not_in_zoho = ?, updated_by = ? WHERE id = ?` params `[1,'u',5]`; `false` → `[0,'u',5]`.
- Route registration: `POST /items/dpl-catalog/entry/:id/not-in-zoho` registered.
- Manual smoke: mark a needs_creating item → it leaves Review/Needs-creating, appears under 🚫 Pending; Unmark there → returns. Rebuild → mark preserved. Link the item (Pick) → leaves Pending automatically.

## Key files

- Create: `migrations/migrate-dpl-catalog-not-in-zoho.js`.
- Modify: `services/dpl-catalog.js` (`setNotInZoho` + export), `routes/zoho.js` (endpoint), `public/admin-dpl.html` (filter, mark button, picker footer, isPending).
- Test: `tests/unit/dpl-catalog.test.js`, `tests/unit/dpl-catalog-endpoints.test.js`.
