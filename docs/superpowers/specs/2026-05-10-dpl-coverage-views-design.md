# DPL Coverage Views Design (Match-status filter + Zoho-uncovered)

**Date:** 2026-05-10
**Status:** Approved (brainstorming complete)
**Scope:** Frontend-only addition to `admin-dpl.html`. Adds a unified View dropdown that lets admins filter the AI Review table by match status, push status, and switch to a Zoho-side coverage view.

## Background

After the brand-DPL storage feature shipped earlier today, an admin reviewing match results on `admin-dpl.html` only has the existing 3-state push-filter button (`All / Hide Pushed / Pushed Only`). They cannot:

1. Filter the DPL table to show only auto-matched rows (to verify which mappings the system found).
2. Filter to show only needs-review rows (to focus on the gaps).
3. See which Birla Opus items in the Zoho catalog have NO DPL row pointing at them — i.e. SKUs that won't get a price update from the latest paste.

The third gap is operationally important: it surfaces discontinued SKUs, naming-mismatch SKUs that the matcher missed, and items genuinely missing from the vendor PDF.

## Goals

1. Single dropdown control replaces the cycling button, exposing all five row-filter modes plus the Zoho-uncovered view in one menu.
2. Match-status filters work purely on the in-memory `aiData.items` array — no backend/DB change.
3. Zoho-uncovered mode re-uses the same `.cmp-table` rendering pipeline but renders a different dataset (`aiData.zohoItems` minus matched IDs).
4. Mobile card view (`renderAiCards`) honours the same modes.

## Non-Goals

- Search/filter inside Zoho-uncovered mode (v1 lists everything; users can scroll).
- Click-to-act buttons on uncovered rows (no "Map to DPL", no "Mark as discontinued"). Read-only audit only.
- Export to CSV / clipboard. Future enhancement.
- Backend endpoint changes — `aiData` already carries enough to compute uncovered client-side.

## Architecture

```
admin-dpl.html  (existing structure)
  Step 2 review
    ├── Top filter bar
    │     ├── Filter rows search   (unchanged)
    │     ├── Category dropdown    (unchanged)
    │     ├── Select all / Auto-Matched buttons   (unchanged)
    │     └── View dropdown        ← REPLACES the "Filter: All" button
    │           ├── All DPL rows
    │           ├── Auto-matched only
    │           ├── Needs review only
    │           ├── Hide pushed
    │           ├── Pushed only
    │           └── Zoho uncovered (NN)
    ├── aiTableWrap   (desktop)
    ├── aiCardContainer   (mobile)
    └── renderAiTable() / renderAiCards()
          ├── if aiViewMode === 'zoho-uncovered' → render Zoho rows
          └── else → render filtered DPL rows
```

The dropdown's label updates dynamically with `(NN)` count of uncovered Zoho items so the badge is always accurate.

## State

Replace the existing `aiPushedFilter` integer (0/1/2 cycle) with a single string state:

```js
var aiViewMode = 'all';   // 'all' | 'matched' | 'unmatched' | 'hide-pushed' | 'pushed' | 'zoho-uncovered'
```

`aiCyclePushedFilter()` is removed. The `<select>` element has `onchange="aiSetViewMode(this.value)"` which updates state and calls `renderAiTable()`.

## Filter logic

`aiHidePushedCheck(row)` is generalized to a single function `aiRowVisibleInMode(row)` that returns true/false based on `aiViewMode`. The existing call site (`renderAiTable`'s `forEach`) replaces `if (aiHidePushedCheck(row)) return;` with `if (!aiRowVisibleInMode(row)) return;`.

Mode-by-mode behavior:

| Mode | Visibility rule |
|---|---|
| `all` | Always visible |
| `matched` | `row.auto_match` truthy |
| `unmatched` | `row.auto_match` falsy |
| `hide-pushed` | `!row._alreadyPushed` (existing logic) |
| `pushed` | `row._alreadyPushed` (existing logic) |
| `zoho-uncovered` | Not applied to DPL rows (table renders Zoho rows instead — handled at the entry of `renderAiTable`/`renderAiCards`) |

## Zoho-uncovered computation

Pure function:

```js
function computeZohoUncovered(items, zohoItems) {
    var matchedIds = new Set();
    (items || []).forEach(function(r) {
        if (r.auto_match && r.auto_match.zoho_item_id) {
            matchedIds.add(r.auto_match.zoho_item_id);
        }
    });
    return (zohoItems || []).filter(function(z) {
        return !matchedIds.has(z.zoho_item_id);
    });
}
```

Called once per render (cheap — set construction is O(items), filter is O(zohoItems), both small).

## Render branches

`renderAiTable()` early-branches:

```js
if (aiViewMode === 'zoho-uncovered') {
    return renderZohoUncoveredTable();
}
// ... existing logic
```

`renderZohoUncoveredTable()` builds a different `<thead>`:

| SKU | Name | Current Rate | Current DPL | DPL last updated |
|---|---|---:|---:|---|

A small banner at the top of the table reads:
> 📋 NN Birla Opus Zoho items have no row in the latest DPL paste. Likely discontinued, missing from the vendor PDF, or a naming mismatch.

Same for `renderAiCards()` — early-branches to `renderZohoUncoveredCards()` which produces simplified cards with just SKU + name + rate/DPL/last-updated.

## Dropdown count update

The dropdown's "Zoho uncovered (NN)" option label is rebuilt every time `aiData` changes — i.e. inside `showAiResults()` (existing function) after `aiData` is set. The rebuild swaps the option text only:

```js
var opt = document.querySelector('#aiViewMode option[value="zoho-uncovered"]');
if (opt && aiData) {
    var n = computeZohoUncovered(aiData.items, aiData.zohoItems).length;
    opt.textContent = 'Zoho uncovered (' + n + ')';
}
```

## Tests

Pure unit test for `computeZohoUncovered`. Add `tests/unit/dpl-coverage.test.js`:

1. Empty inputs → empty array.
2. All items matched → empty array.
3. No items matched → returns full zohoItems list.
4. Mixed: 3 zoho items, 2 matched → 1 returned.
5. Auto_match without zoho_item_id → does not count as matched (skipped from set).
6. Same zoho_item_id matched twice (multiple DPL rows pointing to it) → still counted as one match.

The function is small and pure; no need for integration tests against the route.

## Browser/UI testing

After deploy: open `admin-dpl.html`, ensure the View dropdown shows 6 options including "Zoho uncovered (NN)" with a non-zero N for Birla Opus. Click each option and confirm the table updates. Mobile: viewport ≤639px, confirm card view honours the dropdown.

## File touch list

- **Create:** `tests/unit/dpl-coverage.test.js`
- **Modify:** `public/admin-dpl.html`:
  - Replace `<button id="aiPushedFilterBtn">` (line 333) with `<select id="aiViewMode">`.
  - Replace `var aiPushedFilter = 0;` with `var aiViewMode = 'all';`.
  - Delete `aiCyclePushedFilter()`, add `aiSetViewMode(mode)` and `aiRowVisibleInMode(row)`.
  - Update `renderAiTable()` to early-branch on `zoho-uncovered`; add `renderZohoUncoveredTable()`.
  - Update `renderAiCards()` similarly; add `renderZohoUncoveredCards()`.
  - Update `showAiResults()` to refresh the dropdown's count.
  - Add `computeZohoUncovered(items, zohoItems)` helper at the top of the script block (or near other compute helpers).

No backend touched. No `routes/zoho.js` change. No DB.
