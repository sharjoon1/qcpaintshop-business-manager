# Column Sort/Filter + Bulk Edit Scoping

**Date:** 2026-03-17
**Status:** Approved

## Overview

Two independent features:
1. **Column sort/filter** for admin-products.html (Products tab + Zoho Import tab)
2. **Bulk edit scoping fix + Paste to All** for admin-zoho-items-edit.html

## Feature 1: Column Sort/Filter

### Scope
- `admin-products.html` — Products tab (client-side, ~623 items)
- `admin-products.html` — Zoho Import tab (server-side paginated, ~1,855 items)
- `estimate-create-new.html` — **out of scope** (items table too small)

### Products Tab (Client-Side)

**Current state:** Text search + 4 separate dropdown filters (Brand, Category, Type, Status) above the table. No sort.

**Changes:**

**Sortable column headers:**
- Click any column header → toggles: neutral → ascending → descending → neutral
- Arrow indicator: `▲` (asc), `▼` (desc), `⇅` (neutral/unsorted)
- Only one column sorted at a time (clicking a new column resets the previous)
- Sort persisted in `sessionStorage` key `products_sort` (column + direction)

**Sortable columns:**
| Column | Sort Type |
|--------|-----------|
| Name | Alphabetical (case-insensitive) |
| Brand | Alphabetical |
| Category | Alphabetical |
| Type | Alphabetical (unit_wise/area_wise) |
| Price | Numeric |
| Status | Alphabetical (active/inactive) |

**Non-sortable:** Checkbox, Image, Actions

**Column filter row:**
- New `<tr>` in `<thead>` directly below the header row
- Small filter inputs per column, styled compact (height ~28px, small font)

| Column | Filter Type |
|--------|-------------|
| Name | Text input (searches name, brand, category, description — same multi-field search as current) |
| Brand | Dropdown (populated from brands list) |
| Category | Dropdown (populated from categories list) |
| Type | Dropdown (All / Unit Wise / Area Wise) |
| Price | Not filtered (low value for this column) |
| Status | Dropdown (All / Active / Inactive) |

**Replaces:** The existing separate filter bar (search input + 4 dropdowns + clear button) is replaced by the column filter row. This moves filters to where they logically belong — directly under each column header.

**Implementation:** All sorting and filtering happens client-side on the existing `products` array. The `getFilteredProducts()` function is updated to read from column filter inputs, then sort results before rendering.

### Zoho Import Tab (Server-Side Paginated)

**Current state:** Text search + 2 dropdowns (Brand, Category) + Mapped status dropdown. No sort. Server-side pagination (50/page).

**Changes:**

**Sortable column headers:**
- Same UI as Products tab (click header → arrow indicator)
- Sort params sent to API: `?sort=zoho_item_name&order=asc`
- Backend `GET /api/zoho/items` needs `sort` and `order` query params added

**Sortable columns:**
| Column | Sort Param |
|--------|-----------|
| Item Name | `zoho_item_name` |
| SKU | `zoho_sku` |
| Brand | `zoho_brand` |
| Category | `zoho_category_name` |
| Rate | `zoho_rate` |
| Stock | `zoho_stock_on_hand` |

**Non-sortable:** Checkbox, Image, HSN

**Column filter row:**
- Same style as Products tab
- Text inputs for Name, SKU; dropdowns for Brand, Category, Mapped status
- Replaces the existing separate filter section
- Filters sent as query params to the API (existing behavior, just moved into column headers)

**Backend change:** Add `sort` and `order` params to the `GET /api/zoho/items` endpoint. Whitelist sortable column names to prevent SQL injection. Default: `ORDER BY zoho_item_name ASC`.

### Shared UI Pattern

Both tables use identical styling:

**Header cell:**
```
┌──────────────────┐
│ Name         ▲   │  ← clickable, shows sort direction
├──────────────────┤
│ [filter input  ] │  ← compact input/dropdown
└──────────────────┘
```

**Styles:**
- Header row: existing dark background, white text
- Sort arrow: white, right-aligned in header cell, cursor pointer
- Filter row: light gray background (`#f7fafc`), compact inputs
- Filter inputs: small border, rounded, `font-size: 11px`, `padding: 2px 6px`
- Clear all filters: small "✕ Clear" link at end of filter row

## Feature 2: Bulk Edit Scoping + Paste to All

### Scope
- `admin-zoho-items-edit.html` only

### Bug Fix: Bulk Operations Must Respect Filter Scope

**Current bug:** Bulk operations (% adjustment with "All on current page", Mark Inactive) iterate over all loaded items regardless of search/filter state.

**Fix:** The `applyPctAdjust()` function's `'page'` scope path uses raw `items` array instead of `getFilteredItems()`. Fix: when scope is `'page'`, use `getFilteredItems()` to respect active column filters.

- "All on current page" → only items visible after column filters on current page
- Confirmation dialog shows exact count: "Apply to X items (filtered from Y total)"
- Note: `markSelectedInactive()` already requires explicit checkbox selection — no bug there

**Implementation:** Create a helper function `getVisibleItemIds()` that returns IDs of items currently displayed in the table body (respects search, brand, category filters, and pagination). All bulk operations use this function instead of iterating all loaded items.

### New Feature: Paste to All Rows

**Trigger:** After a user edits a cell and commits the value (Enter/click away), a small dropdown action button appears next to the edited cell.

**Dropdown options:**
1. **"Paste to all rows"** — applies the value to the same column for all rows visible on the current page (filtered)
2. **"Paste to selected"** — applies to checkbox-selected rows only (disabled if no rows selected)

**UX flow:**
1. User edits a cell (e.g., types "ENAMEL" in a Category cell)
2. User commits (Enter or clicks away) — value saves to that row as normal
3. A small `▾` button appears at the right edge of the edited cell (only on blur-commit, NOT on Enter/Tab-commit which moves focus to next cell). Button disappears after 3 seconds or when user clicks elsewhere.
4. Clicking `▾` shows the 2-option dropdown
5. User clicks "Paste to all rows"
6. Confirmation: "Apply 'ENAMEL' to Category for 47 rows?"
7. On confirm: value applied to all visible rows, cells marked as dirty (yellow)

**Scoping:** "All rows" means all rows currently visible on the page after search/filter. NOT all 1,855 items across all pages.

**Visual feedback:**
- After paste: all affected cells flash briefly (green highlight, fades to dirty yellow)
- Changes badge updates with new count
- Toast notification: "Updated 47 rows"

**The dropdown button:**
- Small (16x16), appears inline at right edge of the cell
- Icon: `▾` or `⋮` (vertical dots)
- Disappears after 3 seconds of inactivity or when user clicks elsewhere
- Does NOT appear for readonly columns (Item ID, Stock, Last Synced)

### What's NOT changing

- Inline editing behavior (already works)
- Keyboard navigation (Tab/Enter/Escape — already works)
- Dirty tracking (already works)
- AI command bar / KAI (already works)
- % adjustment tool (already works, just fixing scope)
- Job queue / bulk push to Zoho (already works)
- Column toggles (already works)
- Sticky headers/columns (already works)

## Files Changed

| File | Change |
|------|--------|
| `public/admin-products.html` | Replace filter bar with column sort headers + filter row (Products tab + Zoho Import tab) |
| `routes/zoho.js` | Add `sort` + `order` params to `GET /api/zoho/items` endpoint (whitelist sortable columns) |
| `public/admin-zoho-items-edit.html` | Fix bulk operation scoping, add Paste to All dropdown |

## Out of Scope

- estimate-create-new.html (items table too small for sort/filter)
- New bulk edit features beyond Paste to All (Find & Replace, Fill Down, etc. — can be added later)
- Conflict detection for multi-user editing
- Undo/Redo for bulk edits (AI undo already exists)
