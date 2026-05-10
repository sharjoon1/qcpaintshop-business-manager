# DPL Coverage Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cycling Filter button on `admin-dpl.html` AI Review screen with a single View dropdown that adds match-status filters (Auto-matched / Needs review) plus a "Zoho uncovered" mode showing Birla Opus catalog items no DPL row points at.

**Architecture:** Pure frontend feature. New `services/dpl-coverage.js` exports `computeZohoUncovered(items, zohoItems)` (the same 5-line logic is also inlined in `admin-dpl.html` since static frontend can't `require()` Node modules). The dropdown drives a new `aiViewMode` state; `renderAiTable()` and `renderAiCards()` early-branch into Zoho-uncovered render paths when the mode is `'zoho-uncovered'`.

**Tech Stack:** Node.js (service module), Jest unit tests (mocked-data pure-function tests), vanilla JS frontend.

**Spec:** `docs/superpowers/specs/2026-05-10-dpl-coverage-views-design.md`.

---

## File Touch List

- **Create:** `services/dpl-coverage.js` — exports `computeZohoUncovered`.
- **Create:** `tests/unit/dpl-coverage.test.js` — 6 unit tests for the helper.
- **Modify:** `public/admin-dpl.html`:
  - Line 333: replace button with `<select id="aiViewMode">`.
  - Lines 1562-1576: replace `aiPushedFilter` + `aiCyclePushedFilter` with `aiViewMode` + `aiSetViewMode`.
  - Lines 1578-1582: replace `aiHidePushedCheck` with `aiRowVisibleInMode`.
  - Update existing call sites at lines 1499 and 1618 to use the new function name.
  - Add `computeZohoUncovered`, `renderZohoUncoveredTable`, `renderZohoUncoveredCards` near other render helpers.
  - Update `showAiResults()` (around line 1242) to refresh the dropdown's count label.
  - Update `renderAiTable()` (around line 1596) and `renderAiCards()` (around line 1490) to early-branch on `aiViewMode === 'zoho-uncovered'`.

No backend changes. No DB. No new npm dependencies.

---

## Task 1: Service helper with TDD

**Files:**
- Create: `services/dpl-coverage.js`
- Create: `tests/unit/dpl-coverage.test.js`

### - [ ] Step 1: Write the failing tests

Create `tests/unit/dpl-coverage.test.js`:

```javascript
const { computeZohoUncovered } = require('../../services/dpl-coverage');

describe('computeZohoUncovered', () => {
    test('exported as a function', () => {
        expect(typeof computeZohoUncovered).toBe('function');
    });

    test('returns empty array for empty inputs', () => {
        expect(computeZohoUncovered([], [])).toEqual([]);
        expect(computeZohoUncovered(null, null)).toEqual([]);
        expect(computeZohoUncovered(undefined, undefined)).toEqual([]);
    });

    test('returns full zohoItems list when no items are matched', () => {
        const zohoItems = [
            { zoho_item_id: 'A', name: 'Item A' },
            { zoho_item_id: 'B', name: 'Item B' },
        ];
        const items = [
            { product: 'P1', dpl: 100 }, // no auto_match
            { product: 'P2', dpl: 200 }, // no auto_match
        ];
        expect(computeZohoUncovered(items, zohoItems)).toEqual(zohoItems);
    });

    test('returns empty array when every zoho item is matched', () => {
        const zohoItems = [
            { zoho_item_id: 'A', name: 'Item A' },
            { zoho_item_id: 'B', name: 'Item B' },
        ];
        const items = [
            { product: 'P1', dpl: 100, auto_match: { zoho_item_id: 'A' } },
            { product: 'P2', dpl: 200, auto_match: { zoho_item_id: 'B' } },
        ];
        expect(computeZohoUncovered(items, zohoItems)).toEqual([]);
    });

    test('returns only the unmatched subset', () => {
        const zohoItems = [
            { zoho_item_id: 'A', name: 'Item A' },
            { zoho_item_id: 'B', name: 'Item B' },
            { zoho_item_id: 'C', name: 'Item C' },
        ];
        const items = [
            { product: 'P1', dpl: 100, auto_match: { zoho_item_id: 'A' } },
            { product: 'P3', dpl: 300, auto_match: { zoho_item_id: 'C' } },
        ];
        const out = computeZohoUncovered(items, zohoItems);
        expect(out).toHaveLength(1);
        expect(out[0].zoho_item_id).toBe('B');
    });

    test('auto_match without zoho_item_id does not count as a match', () => {
        const zohoItems = [
            { zoho_item_id: 'A', name: 'Item A' },
        ];
        const items = [
            { product: 'P1', dpl: 100, auto_match: { warning: 'no id', zoho_item_id: null } },
        ];
        expect(computeZohoUncovered(items, zohoItems)).toEqual(zohoItems);
    });

    test('multiple items pointing to the same zoho_item_id still count as one match', () => {
        const zohoItems = [
            { zoho_item_id: 'A', name: 'Item A' },
            { zoho_item_id: 'B', name: 'Item B' },
        ];
        const items = [
            { product: 'P1a', dpl: 100, auto_match: { zoho_item_id: 'A' } },
            { product: 'P1b', dpl: 110, auto_match: { zoho_item_id: 'A' } },
            { product: 'P1c', dpl: 120, auto_match: { zoho_item_id: 'A' } },
        ];
        const out = computeZohoUncovered(items, zohoItems);
        expect(out).toHaveLength(1);
        expect(out[0].zoho_item_id).toBe('B');
    });
});
```

### - [ ] Step 2: Run tests to verify they fail

Run: `npx jest tests/unit/dpl-coverage.test.js`

Expected: All tests fail with `Cannot find module '../../services/dpl-coverage'`.

### - [ ] Step 3: Implement the helper

Create `services/dpl-coverage.js`:

```javascript
/**
 * Coverage helpers for the DPL paste/match flow.
 *
 * The same logic is also inlined inside `public/admin-dpl.html` because the
 * static frontend cannot `require()` Node modules. Both copies must stay
 * in sync — keep them small and obvious.
 */

/**
 * Compute the subset of Zoho items that no DPL row points at.
 *
 * @param {Array<{auto_match?: {zoho_item_id?: string|null}}>} items   DPL rows from the match payload
 * @param {Array<{zoho_item_id: string}>} zohoItems                    Brand-scoped Zoho catalog rows
 * @returns {Array<object>} Subset of zohoItems whose id is not referenced
 *                          by any item's auto_match.zoho_item_id.
 */
function computeZohoUncovered(items, zohoItems) {
    const matchedIds = new Set();
    (items || []).forEach(function(r) {
        if (r && r.auto_match && r.auto_match.zoho_item_id) {
            matchedIds.add(r.auto_match.zoho_item_id);
        }
    });
    return (zohoItems || []).filter(function(z) {
        return !matchedIds.has(z.zoho_item_id);
    });
}

module.exports = { computeZohoUncovered };
```

### - [ ] Step 4: Run tests to verify they pass

Run: `npx jest tests/unit/dpl-coverage.test.js`

Expected: 7 tests passing (1 export + 6 behavior).

### - [ ] Step 5: Commit

```bash
git add services/dpl-coverage.js tests/unit/dpl-coverage.test.js
git commit -m "$(cat <<'EOF'
feat(dpl): computeZohoUncovered helper for coverage views

Pure function: takes a match payload's items + zohoItems arrays, returns
the zohoItems whose IDs no DPL row points at. Used by the new "Zoho
uncovered" view in admin-dpl.html. Same logic will be inlined in the
HTML script block (static frontend can't require Node modules).

7 unit tests with mocked data.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Frontend View dropdown + Zoho-uncovered render

**Files:**
- Modify: `public/admin-dpl.html`

This task replaces the existing single-button filter with a multi-state dropdown and adds the Zoho-uncovered rendering paths (table + mobile cards).

### - [ ] Step 1: Replace the Filter button HTML with a View dropdown

In `public/admin-dpl.html`, find line ~333:

```html
                            <button id="aiPushedFilterBtn" onclick="aiCyclePushedFilter()" class="px-2 py-1 border border-gray-300 rounded text-xs hover:bg-gray-50">Filter: All</button>
```

Replace with:

```html
                            <select id="aiViewMode" onchange="aiSetViewMode(this.value)" class="px-2 py-1 border border-gray-300 rounded text-xs outline-none focus:border-indigo-500 bg-white">
                                <option value="all">View: All DPL rows</option>
                                <option value="matched">Auto-matched only</option>
                                <option value="unmatched">Needs review only</option>
                                <option value="hide-pushed">Hide pushed</option>
                                <option value="pushed">Pushed only</option>
                                <option value="zoho-uncovered">Zoho uncovered (0)</option>
                            </select>
```

### - [ ] Step 2: Replace `aiPushedFilter` state and `aiCyclePushedFilter`/`aiHidePushedCheck` functions

Find the existing block (lines ~1561-1582):

```javascript
    // 3-state pushed filter: '' = All, 'hide' = Hide Pushed, 'only' = Show Pushed Only
    var aiPushedFilter = '';
    function aiCyclePushedFilter() {
        aiPushedFilter = aiPushedFilter === '' ? 'hide' : aiPushedFilter === 'hide' ? 'only' : '';
        var btn = document.getElementById('aiPushedFilterBtn');
        if (btn) {
            if (aiPushedFilter === 'hide') {
                btn.textContent = 'Filter: Hide Pushed'; btn.style.borderColor = '#f59e0b'; btn.style.color = '#b45309';
            } else if (aiPushedFilter === 'only') {
                btn.textContent = 'Filter: Pushed Only'; btn.style.borderColor = '#10b981'; btn.style.color = '#065f46';
            } else {
                btn.textContent = 'Filter: All'; btn.style.borderColor = ''; btn.style.color = '';
            }
        }
        renderAiTable();
    }
    // Legacy alias used by renderAiTable/renderAiCards
    function aiHidePushedCheck(row) {
        if (aiPushedFilter === 'hide' && row._alreadyPushed) return true;
        if (aiPushedFilter === 'only' && !row._alreadyPushed) return true;
        return false;
    }
```

Replace with:

```javascript
    // View mode for the AI Review table.
    // Values: 'all' | 'matched' | 'unmatched' | 'hide-pushed' | 'pushed' | 'zoho-uncovered'
    // 'zoho-uncovered' is special — it switches the table to render aiData.zohoItems
    // (filtered to items no DPL row points at) instead of aiData.items.
    var aiViewMode = 'all';
    function aiSetViewMode(mode) {
        aiViewMode = mode || 'all';
        renderAiTable();
    }
    // Returns true if the DPL `row` is visible under the current view mode.
    // Always returns true in 'zoho-uncovered' mode (callers branch earlier).
    function aiRowVisibleInMode(row) {
        switch (aiViewMode) {
            case 'matched':     return !!(row.auto_match && row.auto_match.zoho_item_id);
            case 'unmatched':   return !(row.auto_match && row.auto_match.zoho_item_id);
            case 'hide-pushed': return !row._alreadyPushed;
            case 'pushed':      return !!row._alreadyPushed;
            case 'all':
            case 'zoho-uncovered':
            default:            return true;
        }
    }
    // Inline copy of services/dpl-coverage.js — keep in sync. Static frontend
    // cannot require Node modules, so the same 5-line helper lives in both places.
    function computeZohoUncovered(items, zohoItems) {
        var matchedIds = new Set();
        (items || []).forEach(function(r) {
            if (r && r.auto_match && r.auto_match.zoho_item_id) {
                matchedIds.add(r.auto_match.zoho_item_id);
            }
        });
        return (zohoItems || []).filter(function(z) {
            return !matchedIds.has(z.zoho_item_id);
        });
    }
```

### - [ ] Step 3: Update the two existing call sites of `aiHidePushedCheck`

Search for `aiHidePushedCheck` — there are exactly two call sites (around lines 1499 and 1618). Replace each occurrence:

```javascript
            if (aiHidePushedCheck(row)) return;
```

with:

```javascript
            if (!aiRowVisibleInMode(row)) return;
```

Use `Edit` with `replace_all: true` since there are no other `aiHidePushedCheck` references after Step 2 deleted the definition.

### - [ ] Step 4: Add the Zoho-uncovered render functions

In `public/admin-dpl.html`, find the `renderAiCards` function (search for `function renderAiCards`). Add these two new functions immediately above it (so all "render" helpers stay grouped):

```javascript
    // Render the table-view body for Zoho-uncovered mode.
    // Replaces aiMatchBody innerHTML with a different column layout and a
    // small explanatory banner above the rows.
    function renderZohoUncoveredTable() {
        var uncov = computeZohoUncovered(aiData && aiData.items, aiData && aiData.zohoItems);
        var bodyEl = document.getElementById('aiMatchBody');
        if (!bodyEl) return;

        // Replace the table head columns first by writing a header row inside thead.
        // Simpler: render everything inside tbody as colspan rows so we keep one DOM tree.
        var html = '';
        // Banner row spanning all columns of the existing thead (8 columns).
        html += '<tr><td colspan="8" style="padding:10px;background:#fffbeb;border-bottom:1px solid #fde68a;font-size:12px;color:#92400e">'
              + '📋 ' + uncov.length + ' Birla Opus Zoho items have no row in the latest DPL paste. Likely discontinued, missing from the vendor PDF, or a naming mismatch.'
              + '</td></tr>';
        if (uncov.length === 0) {
            html += '<tr><td colspan="8" style="padding:24px;text-align:center;color:#9ca3af;font-size:12px">No uncovered items — every Birla Opus Zoho item is matched by a DPL row. ✅</td></tr>';
        } else {
            // Header row inside tbody (colspan-driven layout — avoids touching the static thead).
            html += '<tr style="background:#f1f5f9;font-weight:600;color:#475569;font-size:11px">'
                  + '<td colspan="2" style="padding:7px 8px">SKU</td>'
                  + '<td colspan="3" style="padding:7px 8px">Name</td>'
                  + '<td style="padding:7px 8px;text-align:right">Current Rate</td>'
                  + '<td style="padding:7px 8px;text-align:right">Current DPL</td>'
                  + '<td style="padding:7px 8px">DPL last updated</td>'
                  + '</tr>';
            uncov.forEach(function(z) {
                var dplDate = z.dpl_updated_at ? new Date(z.dpl_updated_at).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—';
                html += '<tr>'
                      + '<td colspan="2" style="padding:5px 8px;font-family:monospace;font-size:11px;color:#4338ca">' + esc(z.sku || '—') + '</td>'
                      + '<td colspan="3" style="padding:5px 8px;font-size:12px"><div class="break-words" title="' + esc(z.name || '') + '">' + esc(z.name || '') + '</div></td>'
                      + '<td style="padding:5px 8px;text-align:right;font-size:12px;color:#374151">' + (z.rate > 0 ? fmt(z.rate) : '—') + '</td>'
                      + '<td style="padding:5px 8px;text-align:right;font-size:12px;color:#059669;font-weight:600">' + (z.cf_dpl > 0 ? fmt(z.cf_dpl) : '—') + '</td>'
                      + '<td style="padding:5px 8px;font-size:11px;color:#64748b">' + esc(dplDate) + '</td>'
                      + '</tr>';
            });
        }
        bodyEl.innerHTML = html;

        // Update the "selected" counter label so it doesn't lie about DPL row state.
        aiUpdateSelectedCount();
    }

    // Render the mobile card view for Zoho-uncovered mode.
    function renderZohoUncoveredCards() {
        var uncov = computeZohoUncovered(aiData && aiData.items, aiData && aiData.zohoItems);
        var html = '';
        html += '<div style="padding:10px;background:#fffbeb;border:1px solid #fde68a;border-radius:8px;margin-bottom:10px;font-size:12px;color:#92400e">'
              + '📋 ' + uncov.length + ' Birla Opus Zoho items have no row in the latest DPL paste.</div>';
        if (uncov.length === 0) {
            html += '<div style="padding:24px;text-align:center;color:#9ca3af;font-size:12px">No uncovered items — every Birla Opus Zoho item is matched. ✅</div>';
        } else {
            uncov.forEach(function(z) {
                var dplDate = z.dpl_updated_at ? new Date(z.dpl_updated_at).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric' }) : '—';
                html += '<div class="ai-card">'
                      + '<div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start">'
                      +   '<div style="flex:1;min-width:0">'
                      +     '<div style="font-family:monospace;font-size:11px;color:#4338ca">' + esc(z.sku || '—') + '</div>'
                      +     '<div class="ai-card-name">' + esc(z.name || '') + '</div>'
                      +   '</div>'
                      +   '<div style="text-align:right;font-size:11px;flex-shrink:0">'
                      +     '<div>Rate: <span style="color:#374151;font-weight:600">' + (z.rate > 0 ? fmt(z.rate) : '—') + '</span></div>'
                      +     '<div>DPL: <span style="color:#059669;font-weight:600">' + (z.cf_dpl > 0 ? fmt(z.cf_dpl) : '—') + '</span></div>'
                      +   '</div>'
                      + '</div>'
                      + '<div class="ai-card-meta" style="margin-top:6px">DPL last updated: ' + esc(dplDate) + '</div>'
                      + '</div>';
            });
        }
        return html;
    }
```

### - [ ] Step 5: Add early-branch in `renderAiTable` and `renderAiCards`

Find `renderAiTable` (search for `function renderAiTable`). Just below the existing entry — after the `if (aiIsMobileLayout())` block but before the main `forEach` — add a new branch. The current entry looks like:

```javascript
    function renderAiTable() {
        if (!aiData) return;
        var search  = (document.getElementById('aiRowSearch').value || '').toLowerCase();
        var catF    = (document.getElementById('aiCatFilter') ? document.getElementById('aiCatFilter').value : '');
        var rows = aiData.items || [];
        var cardCont = document.getElementById('aiCardContainer');

        if (aiIsMobileLayout()) {
            document.getElementById('aiMatchBody').innerHTML = '';
            if (cardCont) cardCont.innerHTML = renderAiCards(rows, search, catF);
            aiUpdateSelectedCount();
            return;
        }
        if (cardCont) cardCont.innerHTML = '';
```

Insert this block immediately after `if (cardCont) cardCont.innerHTML = '';`:

```javascript

        // Zoho-uncovered mode renders a different dataset (zohoItems minus matched).
        if (aiViewMode === 'zoho-uncovered') {
            renderZohoUncoveredTable();
            return;
        }
```

Then find `renderAiCards` (search for `function renderAiCards`). At the very top of the function, immediately after the line that opens it, insert:

```javascript
        if (aiViewMode === 'zoho-uncovered') {
            return renderZohoUncoveredCards();
        }
```

Mobile flow at `renderAiTable` line `if (cardCont) cardCont.innerHTML = renderAiCards(rows, search, catF);` already calls `renderAiCards`, which will now early-return the Zoho cards. No additional change needed there.

### - [ ] Step 6: Update `showAiResults()` to refresh dropdown count

Find `showAiResults` (search for `function showAiResults`). At the bottom of the function — after the existing `aiData` setup but before any final `renderAiTable()` call (find the last line of the function and add this just before the closing `}`) — add:

```javascript

        // Refresh the "Zoho uncovered (NN)" dropdown option label so the count is accurate.
        var sel = document.getElementById('aiViewMode');
        if (sel && aiData) {
            var n = computeZohoUncovered(aiData.items, aiData.zohoItems).length;
            for (var i = 0; i < sel.options.length; i++) {
                if (sel.options[i].value === 'zoho-uncovered') {
                    sel.options[i].textContent = 'Zoho uncovered (' + n + ')';
                    break;
                }
            }
        }
```

If `showAiResults()` is large and you cannot find the closing brace easily, search for the next function declaration after `function showAiResults()` — the line above it is the closing `}` of `showAiResults`.

### - [ ] Step 7: Static checks

```bash
grep -n "aiPushedFilter\|aiCyclePushedFilter\|aiHidePushedCheck" public/admin-dpl.html
```
Expected: zero matches (all renamed/deleted).

```bash
grep -n "aiViewMode\|aiSetViewMode\|aiRowVisibleInMode\|computeZohoUncovered\|renderZohoUncoveredTable\|renderZohoUncoveredCards" public/admin-dpl.html
```
Expected: each new symbol appears at least at one definition site + at least one call site.

### - [ ] Step 8: Commit

```bash
git add public/admin-dpl.html
git commit -m "$(cat <<'EOF'
feat(dpl): View dropdown with match-status filters + Zoho-uncovered mode

Replaces the cycling "Filter: All" button with a single <select> View
dropdown carrying six modes:

- All DPL rows                  (default)
- Auto-matched only
- Needs review only
- Hide pushed
- Pushed only
- Zoho uncovered (NN)           (table mode switch)

The first five filter aiData.items in place. The last switches the
table to render aiData.zohoItems minus the IDs every auto_match points
at — surfacing Birla Opus catalog SKUs that no DPL row covers
(discontinued / missing from PDF / naming mismatch).

Pure frontend: computeZohoUncovered() inlined alongside its
services/dpl-coverage.js twin. New renderZohoUncoveredTable() and
renderZohoUncoveredCards() handle the alternate dataset for desktop
and mobile. Dropdown's NN count refreshed inside showAiResults().

Replaces aiPushedFilter / aiCyclePushedFilter / aiHidePushedCheck with
aiViewMode / aiSetViewMode / aiRowVisibleInMode (single state machine).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Verification (after both tasks)

- [ ] `npx jest tests/unit/dpl-coverage.test.js` → 7/7 pass.
- [ ] `npx jest` (full suite) → no NEW failures (3 pre-existing baseline failures don't count).
- [ ] `grep -n "aiPushedFilter\|aiCyclePushedFilter\|aiHidePushedCheck" public/admin-dpl.html` → zero matches.
- [ ] `git log --oneline -3` shows two new commits: service helper + frontend.

## Self-Review Notes

- **Spec coverage:**
  - Goal 1 (single dropdown, 5 filter modes + Zoho-uncovered) → Task 2 Step 1.
  - Goal 2 (filters work on `aiData.items` purely client-side) → Task 2 Step 2 (`aiRowVisibleInMode`).
  - Goal 3 (Zoho-uncovered re-uses `.cmp-table` with different data) → Task 2 Step 4 (`renderZohoUncoveredTable` writes into the same `aiMatchBody`).
  - Goal 4 (mobile honours modes) → Task 2 Step 4 (`renderZohoUncoveredCards`) + Step 5 (early-branch in `renderAiCards`).

- **Type consistency:** `computeZohoUncovered(items, zohoItems)` signature identical in service (Task 1) and inline copy (Task 2). `aiViewMode` string values listed identically in dropdown options, `aiRowVisibleInMode` switch, and render-branch checks.

- **No placeholders.** All steps have exact code, exact paths, exact commands.

- **Why the inline duplication is acceptable:** The function is 5 lines of pure logic. Extracting it via a `<script src="/js/dpl-coverage.js">` build step would add infrastructure for a one-off helper; copying-with-comment is cheaper. If a third caller appears, revisit.
