# Fix Brand/Category Modal Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "(no brand assigned)" sentinel option to the modal's Current Brand filter, and auto-tick a row's checkbox when its New Brand or New Category dropdown is changed to a non-empty value.

**Architecture:** Two narrow, mostly orthogonal changes. Backend: extend the existing `/api/zoho/items/reassign/scan` handler to recognize a sentinel string `__no_brand__` and translate it to a `(brand IS NULL OR TRIM(brand) = '')` SQL filter. Frontend: prepend a static `<option value="__no_brand__">⚠ (no brand assigned)</option>` to the modal's brand filter, and introduce a `reAutoSelect(idx, value)` helper wired into both row-level `<select>` `onchange` handlers.

**Tech Stack:** Express + MariaDB (route handler), vanilla JS frontend.

**Spec:** `docs/superpowers/specs/2026-05-11-fix-brand-modal-enhancements-design.md`.

---

## File Touch List

- **Modify:** `routes/zoho.js` — `/items/reassign/scan` (lines ~4597-4646) handles `__no_brand__` sentinel.
- **Modify:** `public/admin-zoho-items-edit.html`:
  - `openReassignModal` (line ~1849) — prepend sentinel option to `reCurrentBrand`.
  - `renderReassignTable` (line ~1934) — extend both per-row `<select>` `onchange` attributes.
  - Add `reAutoSelect(idx, value)` helper near the existing reassign helpers.

**Deviation from spec note**: spec proposed adding `noBrandCount` to `/api/zoho/items/filters/list` so the modal can show "(no brand assigned) (NN)" with hide-when-zero behavior. The modal actually builds its dropdowns from the in-memory `items` array (current page), not from `/filters/list` — so wiring `noBrandCount` would require an extra `/filters/list` round-trip just for this one count. We skip that work; the option is always visible. If zero no-brand items exist, the scan returns "0 matching items" — acceptable UX. The `noBrandCount` field is NOT added.

No DB migration. No service changes. No new dependencies.

---

## Task 1: Backend scan-endpoint sentinel

**Files:**
- Modify: `routes/zoho.js` (lines ~4613-4616 inside `/items/reassign/scan` handler).

### - [ ] Step 1: Apply the sentinel handler

Find the existing `currentBrand` branch in `/items/reassign/scan` (search for `if (currentBrand)` inside this handler — around line 4613):

```javascript
        if (currentBrand) {
            whereParts.push('zoho_brand = ?');
            params.push(currentBrand);
        }
```

Replace with:

```javascript
        if (currentBrand === '__no_brand__') {
            // Sentinel: match items whose brand is NULL, empty, or whitespace-only.
            // Used by the "(no brand assigned)" option in the Fix Brand modal.
            whereParts.push("(zoho_brand IS NULL OR TRIM(zoho_brand) = '')");
        } else if (currentBrand) {
            whereParts.push('zoho_brand = ?');
            params.push(currentBrand);
        }
```

### - [ ] Step 2: Verify the module loads

Run from working directory `D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\act.qcpaintshop.com`:

```bash
node -e "require('./routes/zoho.js'); console.log('OK')"
```

Expected: `OK`. If the file fails to parse, the edit broke syntax — re-inspect.

### - [ ] Step 3: Quick endpoint smoke test (optional — only if dev server runs locally)

If a local dev server is already running, this curl works (replace `<TOKEN>` with an admin Bearer token from localStorage):

```bash
curl -s "http://localhost:3000/api/zoho/items/reassign/scan?currentBrand=__no_brand__" \
  -H "Authorization: Bearer <TOKEN>" | head -50
```

Expected: `success: true` and an `items` array containing only items whose `brand` field is empty/null. Skip this step if no local DB is available — Task 2's frontend smoke covers it after deploy.

### - [ ] Step 4: Commit

```bash
git add routes/zoho.js
git commit -m "$(cat <<'EOF'
feat(zoho): __no_brand__ sentinel in /items/reassign/scan

The reassign-scan endpoint now treats currentBrand === '__no_brand__' as
"items with NULL/empty/whitespace-only brand", widening the modal's
filter beyond exact-string brand matches. All other currentBrand values
keep the existing equality semantics.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Frontend dropdown option + auto-select helper

**Files:**
- Modify: `public/admin-zoho-items-edit.html` — three locations described below.

### - [ ] Step 1: Add the sentinel option to the modal's Current Brand dropdown

Find the `openReassignModal` function (search for `function openReassignModal`). The current dropdown construction at line ~1849-1850 looks like:

```javascript
        var brandOpts = '<option value="">— any —</option>' +
            Array.from(brandSet).sort().map(function(b){ return '<option value="'+escapeHtml(b)+'">'+escapeHtml(b)+'</option>'; }).join('');
```

Replace with:

```javascript
        var brandOpts = '<option value="">— any —</option>' +
            '<option value="__no_brand__" style="color:#b45309;font-weight:600">⚠ (no brand assigned)</option>' +
            Array.from(brandSet).sort().map(function(b){ return '<option value="'+escapeHtml(b)+'">'+escapeHtml(b)+'</option>'; }).join('');
```

The sentinel option is inserted between "— any —" and the real brand list. The amber color and bold weight signal it's special.

Do NOT change the New Brand or New Category dropdown construction (lines 1856-1859) — the sentinel is meaningless for the "set this value" use case. Leave those alone.

### - [ ] Step 2: Add the `reAutoSelect` helper

Find the existing reassign helper block (search for `function updateReSelectedCount` — around line 1949). Add `reAutoSelect` directly above it:

```javascript
    // When a user changes a per-row New Brand or New Category to a non-empty
    // value, auto-tick the row's checkbox so the Apply button captures the
    // intent without a second click. Empty values (the "— don't change —"
    // option) leave the checkbox state untouched — users keep their existing
    // selection if they intentionally reset a dropdown.
    function reAutoSelect(idx, value) {
        if (!value) return;
        var cb = document.querySelector('.re-cb[data-idx="' + idx + '"]');
        if (cb && !cb.checked) {
            cb.checked = true;
            updateReSelectedCount();
        }
    }
```

### - [ ] Step 3: Wire the per-row dropdowns to `reAutoSelect`

Find `renderReassignTable` (line ~1923). The current row construction includes (lines ~1934 and ~1936):

```javascript
            html += '<td style="padding:6px 8px"><select id="re-brand-sel-'+idx+'" onchange="reItems['+idx+'].newBrand=this.value" class="w-full px-2 py-1 border border-gray-300 rounded text-xs">'+bHtml+'</select></td>';
            // ... (current category column in between) ...
            html += '<td style="padding:6px 8px"><select id="re-cat-sel-'+idx+'" onchange="reItems['+idx+'].newCategory=this.value" class="w-full px-2 py-1 border border-gray-300 rounded text-xs">'+cHtml+'</select></td>';
```

Update both `onchange` attributes:

```javascript
            html += '<td style="padding:6px 8px"><select id="re-brand-sel-'+idx+'" onchange="reItems['+idx+'].newBrand=this.value; reAutoSelect('+idx+', this.value)" class="w-full px-2 py-1 border border-gray-300 rounded text-xs">'+bHtml+'</select></td>';
            // ... unchanged in between ...
            html += '<td style="padding:6px 8px"><select id="re-cat-sel-'+idx+'" onchange="reItems['+idx+'].newCategory=this.value; reAutoSelect('+idx+', this.value)" class="w-full px-2 py-1 border border-gray-300 rounded text-xs">'+cHtml+'</select></td>';
```

### - [ ] Step 4: Verify the searchable-select wrapper still propagates onchange

`initRowDropdowns(reItems.length)` is called immediately after the table is built (line ~1941). This helper likely wraps each `<select>` with a searchable UI (input field + filtered dropdown). Search for `initRowDropdowns` and inspect: when a user picks a value through the searchable wrapper, does the underlying `<select>`'s native `onchange` fire?

If `initRowDropdowns` dispatches a `change` event on the underlying select (or assigns the new value via `.value = X` followed by `select.dispatchEvent(new Event('change'))`), the `onchange` HTML attribute will run and `reAutoSelect` will be called. Done.

If `initRowDropdowns` instead assigns `.value = X` directly WITHOUT firing the event, the auto-select won't trigger via the searchable widget — only via the native `<select>` (which is hidden). In that case, find the selection callback inside `initRowDropdowns` / `makeSearchableSelect` (search for one of those names) and ensure it dispatches the change event. The fix is typically a 1-line addition like:

```javascript
selectEl.dispatchEvent(new Event('change'));
```

right after `selectEl.value = chosenValue`.

This step is exploratory — the implementer must read the helper. Note any change in the commit message.

### - [ ] Step 5: Static checks

```bash
grep -n "__no_brand__" public/admin-zoho-items-edit.html
```
Expected: at least one match in `openReassignModal`.

```bash
grep -n "reAutoSelect" public/admin-zoho-items-edit.html
```
Expected: 1 definition + 2 call sites (per-row brand + per-row category onchange).

### - [ ] Step 6: Commit

```bash
git add public/admin-zoho-items-edit.html
git commit -m "$(cat <<'EOF'
feat(zoho): "(no brand assigned)" option + auto-select on Fix Brand modal

Two narrow improvements to the Fix Brand/Category modal:

- Current Brand filter now offers "⚠ (no brand assigned)" (sentinel
  value __no_brand__). Scanning with it returns items whose brand is
  NULL/empty/whitespace-only. Backed by the scan endpoint's matching
  sentinel handler in a previous commit.

- Changing a per-row "New Brand" or "New Category" dropdown to a
  non-empty value now auto-ticks that row's checkbox via the new
  reAutoSelect(idx, value) helper. Apply captures the intent without
  requiring a second click. Empty values (— don't change —) leave
  checkbox state alone.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Verification (after both tasks)

- [ ] `node -e "require('./routes/zoho.js'); console.log('OK')"` prints `OK`.
- [ ] `grep -n "__no_brand__" routes/zoho.js public/admin-zoho-items-edit.html` — at least one match in each file.
- [ ] `grep -n "reAutoSelect" public/admin-zoho-items-edit.html` — 1 def + 2 calls.
- [ ] `git log --oneline -2` shows the two new commits.

Manual browser checks (post-deploy):
- Open `admin-zoho-items-edit.html` → click **Fix Brand/Category** → confirm "⚠ (no brand assigned)" appears in Current Brand. Pick it → click **Scan Matching Items** → result list shows items with empty brand.
- Same modal → after scanning, change one row's New Brand dropdown → checkbox auto-ticks, "Selected" count increments by 1.
- Same modal → change a row's New Category dropdown → same auto-tick behavior.

## Self-Review Notes

- **Spec coverage:**
  - Spec § "Sentinel value" + § "Backend `/items/reassign/scan`" → Task 1.
  - Spec § "Modal Current Brand dropdown population" → Task 2 Step 1.
  - Spec § "`reAutoSelect` helper" → Task 2 Step 2.
  - Spec § "Wire row dropdowns" → Task 2 Step 3.
  - Spec § "Backend `/items/filters/list`" (`noBrandCount` addition) → **intentionally skipped**, documented in "Deviation from spec note" at the top of this plan. Functional impact: option is always visible regardless of whether no-brand items exist.

- **Type/symbol consistency:** sentinel string `__no_brand__` identical in route handler and HTML option `value`. Helper name `reAutoSelect` identical in definition and call sites.

- **No placeholders.** All steps have exact code, exact paths, exact commands.
