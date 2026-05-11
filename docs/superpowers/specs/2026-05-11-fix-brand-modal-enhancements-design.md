# Fix Brand/Category Modal Enhancements Design

**Date:** 2026-05-11
**Status:** Approved (brainstorming complete)
**Scope:** Two narrow improvements to the "Fix Brand / Category" modal on `admin-zoho-items-edit.html`: (1) add a "(no brand assigned)" option to the modal's Current Brand filter, (2) auto-select a row's checkbox when the user changes its new-brand or new-category dropdown in the scan-results table.

## Background

The modal at `public/admin-zoho-items-edit.html:351` lets admins bulk-fix wrong brand/category on Zoho items:
1. Enter filters → click **Scan Matching Items**.
2. Review the resulting rows in a table — each row has a checkbox + per-row "New Brand" and "New Category" dropdowns.
3. Tick the rows to act on + use **Set for selected items** OR per-row dropdowns → click **Apply** to push changes to Zoho and update locally.

Two friction points:

**(a)** The Current Brand filter offers existing brands but no way to search for items whose brand is NULL/empty — the most common "needs fixing" subset. Admins have to discover these via name search instead.

**(b)** After scanning, when an admin changes a row's new-brand or new-category dropdown to indicate intent ("set this row to Birla Opus"), the row is NOT auto-included in the bulk apply — they must remember to also tick the checkbox. The Apply button operates only on checked rows, so an unchecked row with a changed dropdown is silently ignored.

## Goals

1. Modal's Current Brand filter exposes a sentinel "⚠ (no brand assigned)" entry that finds items with `brand IS NULL OR brand = ''` (after trimming).
2. Changing a per-row new-brand or new-category dropdown to a non-empty value auto-ticks that row's checkbox so the user's intent is captured by Apply without a second click.

## Non-Goals

- The page's top-level brand filter (`#brandFilter`, line 241) is NOT changed. User explicitly scoped the request to the modal.
- No symmetric "(no category assigned)" sentinel for the Current Category filter — user only requested brand. Easy add later if needed.
- No auto-uncheck when the user reverts a dropdown back to "— don't change —" (empty). Keeps user's intent sticky; they can manually uncheck.

## Architecture

```
admin-zoho-items-edit.html
  └── Fix Brand/Category Modal
        ├── reCurrentBrand select       ← MODIFIED: add "(no brand assigned)" option
        ├── runReassignScan()           ← unchanged shape; sends sentinel string
        ├── renderReassignTable()       ← MODIFIED: dropdowns wire to reAutoSelect helper
        └── reAutoSelect(idx, val)      ← NEW: ticks the row checkbox when val is truthy

routes/zoho.js
  ├── /items/filters/list                ← MODIFIED: response includes noBrandCount
  └── /items/reassign/scan               ← MODIFIED: accepts currentBrand === sentinel
```

## Data Model

No DB changes. Pure frontend + route-handler logic.

## Sentinel value

Choose `__no_brand__` as the magic-string brand filter value sent over the wire. Three reasons:
- Double-underscore prefix/suffix is a recognizable "never a real brand name" pattern.
- Distinguishable from empty string `""` (which today means "any brand").
- URL-safe, no encoding surprises.

The frontend never displays this string — the `<option>` text reads `⚠ (no brand assigned)` while its `value` is `__no_brand__`.

## Components

### 1. Backend — `/api/zoho/items/filters/list`

Currently returns:
```json
{ "success": true, "brands": [...], "categories": [...] }
```

Add a `noBrandCount` integer:

```json
{ "success": true, "brands": [...], "categories": [...], "noBrandCount": 12 }
```

Compute as a one-row sidecar query (or extend the existing brand-list query with a `UNION` for the null bucket — driver-friendly choice depends on existing pattern). Simplest:

```sql
SELECT COUNT(*) AS n
FROM zoho_items_map
WHERE zoho_status = 'active'
  AND (zoho_brand IS NULL OR TRIM(zoho_brand) = '')
```

Return `n` as `noBrandCount`. Cap at 0 if query fails; never break the brand list.

### 2. Backend — `/api/zoho/items/reassign/scan`

Today reads `req.query.currentBrand` and adds an exact-match filter:

```js
if (currentBrand) sql += ' AND zoho_brand = ?', params.push(currentBrand);
```

Extend: when `currentBrand === '__no_brand__'`, replace the equality with the null-check expression:

```js
if (currentBrand === '__no_brand__') {
    sql += " AND (zoho_brand IS NULL OR TRIM(zoho_brand) = '')";
} else if (currentBrand) {
    sql += ' AND zoho_brand = ?';
    params.push(currentBrand);
}
```

No other endpoint needs to handle the sentinel — only the scan endpoint reads `currentBrand`.

### 3. Frontend — modal Current Brand dropdown population

Find where `reCurrentBrand` is populated (search for `reCurrentBrand` element being filled — should be a function that runs when the modal opens or after `loadFilterOptions` for the modal scope). The function reads the same brand-list response.

After populating the regular `<option>` entries, prepend (right after `— any —`) the sentinel:

```html
<option value="__no_brand__" style="color:#b45309;font-weight:600">⚠ (no brand assigned) (NN)</option>
```

Where `NN` is `data.noBrandCount`. Hide the option entirely when `noBrandCount === 0` (no actionable rows — adding a useless option is noise).

### 4. Frontend — `reAutoSelect(idx, value)` helper

New helper near the existing reassign helpers (around line ~1945):

```js
function reAutoSelect(idx, value) {
    if (!value) return;  // empty = "don't change" — don't change checkbox state
    var cb = document.querySelector('.re-cb[data-idx="' + idx + '"]');
    if (cb && !cb.checked) {
        cb.checked = true;
        updateReSelectedCount();
    }
}
```

### 5. Frontend — wire row dropdowns to `reAutoSelect`

In `renderReassignTable` (line ~1934), extend both `onchange` handlers:

```js
// Before:
onchange="reItems[idx].newBrand=this.value"
onchange="reItems[idx].newCategory=this.value"

// After:
onchange="reItems[idx].newBrand=this.value; reAutoSelect(idx, this.value)"
onchange="reItems[idx].newCategory=this.value; reAutoSelect(idx, this.value)"
```

The `initRowDropdowns(reItems.length)` call (which sets up the searchable-select widgets) must also forward the change event — verify by inspecting that helper. If it bypasses native `onchange`, add an equivalent hook inside that helper's selection callback.

## Tests

No new automated tests. The existing system has no integration tests for this modal. Smoke checks:

1. **No-brand filter** — open modal, pick "⚠ (no brand assigned)", click Scan. Expect: result list contains items with empty/null brand, count badge in header matches `noBrandCount` from filter dropdown.
2. **Auto-select on brand change** — scan returns ≥1 row. Change one row's New Brand dropdown to a real brand. Expect: the row's checkbox auto-ticks, "Selected" count increments by 1.
3. **Auto-select on category change** — same but for New Category.
4. **Auto-select does NOT trigger on revert** — manually uncheck a row whose dropdown is set, then revert the dropdown to "— don't change —". Expect: checkbox stays unchecked.
5. **`noBrandCount === 0` edge case** — manually patch a row to seed the table with no null-brand items (or run on a fresh DB). Open modal. Expect: sentinel option is hidden.

## Out-of-Scope (already covered above)

- Top-level brand filter unchanged.
- No "no category assigned" sentinel.
- No bulk-set auto-check (only per-row dropdowns trigger).

## File Touch List

- **Modify** `routes/zoho.js`:
  - `/api/zoho/items/filters/list` handler — add `noBrandCount` sidecar query.
  - `/api/zoho/items/reassign/scan` handler — handle `__no_brand__` sentinel.
- **Modify** `public/admin-zoho-items-edit.html`:
  - Populate modal's `reCurrentBrand` with the sentinel option.
  - Add `reAutoSelect(idx, value)` helper.
  - Update `renderReassignTable` to wire dropdowns to `reAutoSelect`.

No DB migration, no new dependencies, no service file changes.
