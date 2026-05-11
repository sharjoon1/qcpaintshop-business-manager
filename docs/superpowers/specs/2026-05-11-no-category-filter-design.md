# "(no category assigned)" Filter Design

**Date:** 2026-05-11
**Status:** Approved (brainstorming complete)
**Scope:** Symmetric mirror of the just-shipped `__no_brand__` sentinel — add a `__no_category__` filter option to the Fix Brand/Category modal's Current Category dropdown.

## Background

The brand-sentinel feature shipped at commits `6494a43` (backend) + `f2179e1` (frontend) let admins find Zoho items with NULL/empty brand. The user asks for the same on the category axis: "no category assigned" filter for finding items missing a category.

## Goals

1. `__no_category__` sentinel value works in `/items/reassign/scan` like `__no_brand__` does: when sent, the SQL filter becomes `(zoho_category_name IS NULL OR TRIM(zoho_category_name) = '')`.
2. Modal's `reCurrentCategory` dropdown offers a "⚠ (no category assigned)" option below "— any —".
3. Combining `__no_brand__` + `__no_category__` filters works correctly (items missing BOTH).

## Non-Goals

- No change to the page's top-level `categoryFilter` (line 244) — modal-only.
- No `noCategoryCount` API addition — same rationale as the brand version (modal builds dropdown from in-memory items).
- No change to the `reNewCategory` "set this value" dropdown — sentinel is meaningless there.

## Architecture

```
routes/zoho.js
  /items/reassign/scan
    ├── currentBrand === '__no_brand__'        ← already shipped
    └── currentCategory === '__no_category__'  ← NEW

public/admin-zoho-items-edit.html
  openReassignModal()
    ├── brandOpts (includes __no_brand__)      ← already shipped
    └── catOpts (add __no_category__)          ← NEW
```

No DB change, no service change, no new API surface, no new helpers.

## Components

### Backend — `/items/reassign/scan` category branch

Currently (after the brand sentinel block):

```js
if (currentCategory) {
    whereParts.push('zoho_category_name = ?');
    params.push(currentCategory);
}
```

Becomes:

```js
if (currentCategory === '__no_category__') {
    whereParts.push("(zoho_category_name IS NULL OR TRIM(zoho_category_name) = '')");
} else if (currentCategory) {
    whereParts.push('zoho_category_name = ?');
    params.push(currentCategory);
}
```

Same structural shape as the existing brand sentinel.

### Frontend — modal's category dropdown

`openReassignModal` builds `catOpts` from the in-memory `items` array. Inject the sentinel between "— any —" and the real category list:

```js
var catOpts = '<option value="">— any —</option>' +
    '<option value="__no_category__" style="color:#b45309;font-weight:600">⚠ (no category assigned)</option>' +
    Array.from(catSet).sort().map(function(c){ return '<option value="'+escapeHtml(c)+'">'+escapeHtml(c)+'</option>'; }).join('');
```

Amber color + bold weight matches the existing `__no_brand__` styling for visual consistency.

## Combination behavior

`/items/reassign/scan` ANDs all whereParts. Picking both sentinels yields:

```sql
WHERE zoho_status = 'active'
  AND (zoho_brand IS NULL OR TRIM(zoho_brand) = '')
  AND (zoho_category_name IS NULL OR TRIM(zoho_category_name) = '')
```

Which finds items missing BOTH brand and category — useful for cleanup of half-imported items. No special handling required; the existing AND-combination logic does this correctly.

## Tests

No automated tests. Manual smoke checks:

1. Open modal → Current Category dropdown → confirm "⚠ (no category assigned)" appears between "— any —" and the real list.
2. Pick the sentinel only → Scan → result list contains items with NULL/empty category.
3. Pick `__no_brand__` + `__no_category__` together → Scan → result list contains items missing both.
4. Picking a real category still works as before (regression check).

## File Touch List

- **Modify** `routes/zoho.js` — `/items/reassign/scan` handler, ~4 lines around the existing `currentCategory` branch.
- **Modify** `public/admin-zoho-items-edit.html` — `openReassignModal`, one new line in the `catOpts` construction.

No new files. No DB migration. No new dependencies.
