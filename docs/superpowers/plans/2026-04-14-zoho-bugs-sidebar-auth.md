# Zoho Price-Adjust, Sidebar Accordion, Login-After-Logout — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three distinct bugs — price-adjust direction in `admin-zoho-items-edit.html` (generalize to source→target dropdowns, default DPL→Rate), convert admin sidebar to collapsible accordion with full submenu parity, and fix stale-session dashboard-limbo by proactively validating the token on every page load.

**Architecture:** Three independent tracks, each self-contained. Track 1 modifies one HTML file (popover markup + one JS function). Track 2 modifies one sidebar HTML file (markup restructure + new CSS) and one loader JS file (accordion wiring + active-section detection). Track 3 modifies one client-side auth helper (new `validateSession()`, `logout({reason})` signature, module-level double-logout guard) and one login page (expired-session toast). No server-side changes — `GET /api/auth/me` already exists at `server.js:455-500+` and returns `{ success: true, user: {...} }` on 200 / 401 with `{ success: false, message }` on expiry.

**Tech Stack:** Static HTML + vanilla JS + Tailwind CDN. Express.js backend (already has `/api/auth/me`). No build step. No framework.

**Spec:** `docs/superpowers/specs/2026-04-14-zoho-bugs-sidebar-auth-design.md`

**Baseline facts (do not re-discover):**
- `public/admin-zoho-items-edit.html` popover: lines **148-183**; `applyPctAdjust()`: lines **512-536**; `getCurrentValue(id, field)` is already in scope and accepts any column key (used today for `rate` and `purchase_rate` — `cf_dpl` will work the same way).
- Backend endpoint `POST /api/zoho/items/bulk-edit` at `routes/zoho.js:2581-2662` already maps `rate → zoho_rate`, `cf_dpl → zoho_cf_dpl`, `purchase_rate → zoho_purchase_rate`. No backend change needed.
- `public/components/sidebar-complete.html` has **14** `.qc-nav-section-title` section headers at lines **575, 600, 620, 640, 655, 685, 745, 785, 837, 849, 866, 878** (some sections span multiple headers). Each is followed by flat `<a class="qc-nav-item">` links. CSS classes `.qc-nav-submenu` and `.qc-nav-submenu.open` already exist at lines **203-222** but are currently unused.
- `public/universal-nav-loader.js` is the correct loader (not `/public/js/universal-nav-loader.js`). Loaded via `<script src="/universal-nav-loader.js"></script>`.
- `public/js/auth-helper.js` lines **49-53** is `logout()`, lines **61-83** is `apiRequest()`, lines **89-95** is `checkAuthOrRedirect()`.
- `server.js:455-500+` is `GET /api/auth/me`. Returns `{ success: true, user: {...} }` on 200, `{ success: false, message: ... }` on 401.
- Subnav component files exist in `public/components/`: `zoho-subnav.html`, `attendance-subnav.html`, `branches-subnav.html`, `leads-subnav.html`, `marketing-subnav.html`, `painters-subnav.html`, `products-subnav.html`, `salary-subnav.html`, `sales-subnav.html`, `staff-work-subnav.html`, `system-subnav.html`, `whatsapp-subnav.html`.

---

## Task 1: Price-Adjust — Update popover markup

**Files:**
- Modify: `public/admin-zoho-items-edit.html:148-183` (the `% Adjust` popover)

- [ ] **Step 1.1: Replace the popover markup**

Find this exact block at `public/admin-zoho-items-edit.html:148-183`:

```html
                <div class="relative" id="pctAdjustWrap">
                    <button onclick="togglePctPopover()" class="px-3 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-xs font-medium text-gray-700 flex items-center gap-1.5 transition" title="Adjust rates by %">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                        % Adjust
                    </button>
                    <div id="pctPopover" class="pct-popover hidden">
                        <div class="text-xs font-semibold text-gray-700 mb-2">Adjust Rates by Percentage</div>
                        <div class="space-y-2">
                            <div>
                                <label class="text-xs text-gray-500">Apply to</label>
                                <select id="pctField" class="w-full mt-0.5 px-2 py-1.5 border border-gray-300 rounded text-xs">
                                    <option value="rate">Rate (Selling Price)</option>
                                    <option value="purchase_rate">Purchase Rate</option>
                                </select>
                            </div>
                            <div>
                                <label class="text-xs text-gray-500">Percentage (%)</label>
                                <div class="flex gap-1 mt-0.5">
                                    <input type="number" id="pctValue" step="0.01" placeholder="e.g. 10 or -5" class="flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs outline-none focus:border-indigo-500">
                                    <span class="flex items-center text-xs text-gray-400">%</span>
                                </div>
                            </div>
                            <div>
                                <label class="text-xs text-gray-500">Scope</label>
                                <select id="pctScope" class="w-full mt-0.5 px-2 py-1.5 border border-gray-300 rounded text-xs">
                                    <option value="selected">Selected items only</option>
                                    <option value="page">All on current page</option>
                                </select>
                            </div>
                            <div class="flex gap-2 pt-1">
                                <button onclick="togglePctPopover()" class="flex-1 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded text-xs font-medium text-gray-600">Cancel</button>
                                <button onclick="applyPctAdjust()" class="flex-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 rounded text-xs font-medium text-white">Apply</button>
                            </div>
                        </div>
                    </div>
                </div>
```

Replace with:

```html
                <div class="relative" id="pctAdjustWrap">
                    <button onclick="togglePctPopover()" class="px-3 py-1.5 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 text-xs font-medium text-gray-700 flex items-center gap-1.5 transition" title="Adjust rates by %">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
                        % Adjust
                    </button>
                    <div id="pctPopover" class="pct-popover hidden">
                        <div class="text-xs font-semibold text-gray-700 mb-2">Adjust Price by Percentage</div>
                        <div class="space-y-2">
                            <div>
                                <label class="text-xs text-gray-500">Source field (read from)</label>
                                <select id="pctSource" class="w-full mt-0.5 px-2 py-1.5 border border-gray-300 rounded text-xs">
                                    <option value="cf_dpl" selected>DPL</option>
                                    <option value="rate">Rate (Selling Price)</option>
                                    <option value="purchase_rate">Purchase Rate</option>
                                </select>
                            </div>
                            <div>
                                <label class="text-xs text-gray-500">Target field (write to)</label>
                                <select id="pctTarget" class="w-full mt-0.5 px-2 py-1.5 border border-gray-300 rounded text-xs">
                                    <option value="rate" selected>Rate (Selling Price)</option>
                                    <option value="purchase_rate">Purchase Rate</option>
                                    <option value="cf_dpl">DPL</option>
                                </select>
                            </div>
                            <div>
                                <label class="text-xs text-gray-500">Percentage (%)</label>
                                <div class="flex gap-1 mt-0.5">
                                    <input type="number" id="pctValue" step="0.01" placeholder="e.g. 10 or -5" class="flex-1 px-2 py-1.5 border border-gray-300 rounded text-xs outline-none focus:border-indigo-500">
                                    <span class="flex items-center text-xs text-gray-400">%</span>
                                </div>
                                <div class="text-[10px] text-gray-400 mt-1">New Target = Source × (1 + %/100)</div>
                            </div>
                            <div>
                                <label class="text-xs text-gray-500">Scope</label>
                                <select id="pctScope" class="w-full mt-0.5 px-2 py-1.5 border border-gray-300 rounded text-xs">
                                    <option value="selected">Selected items only</option>
                                    <option value="page">All on current page</option>
                                </select>
                            </div>
                            <div class="flex gap-2 pt-1">
                                <button onclick="togglePctPopover()" class="flex-1 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 rounded text-xs font-medium text-gray-600">Cancel</button>
                                <button onclick="applyPctAdjust()" class="flex-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 rounded text-xs font-medium text-white">Apply</button>
                            </div>
                        </div>
                    </div>
                </div>
```

Key differences: heading changed to "Adjust Price by Percentage"; single `#pctField` select replaced with two selects (`#pctSource` default `cf_dpl`, `#pctTarget` default `rate`); added a formula hint line under the percentage input.

- [ ] **Step 1.2: Verify the file still parses and opens in a browser**

Load `https://act.qcpaintshop.com/admin-zoho-items-edit.html` (or local equivalent) in a browser, click `% Adjust`, confirm both dropdowns render with correct defaults (`DPL` selected in Source, `Rate (Selling Price)` selected in Target) and the formula hint line is visible. No JS errors in console.

**Do not commit yet** — Task 2 replaces `applyPctAdjust()` which references these new dropdown IDs. If we commit now the app is broken between commits.

---

## Task 2: Price-Adjust — Rewrite `applyPctAdjust()`

**Files:**
- Modify: `public/admin-zoho-items-edit.html:512-536` (the `applyPctAdjust` function)

- [ ] **Step 2.1: Replace the function body**

Find this exact block at `public/admin-zoho-items-edit.html:512-536`:

```javascript
    function applyPctAdjust() {
        var field = document.getElementById('pctField').value;
        var pct = parseFloat(document.getElementById('pctValue').value);
        var scope = document.getElementById('pctScope').value;
        if (isNaN(pct) || pct === 0) { showToast('Enter a non-zero percentage', 'error'); return; }
        var targetItems = [];
        if (scope === 'selected') {
            if (selectedItemIds.size === 0) { showToast('Select items first', 'error'); return; }
            targetItems = items.filter(function(it) { return selectedItemIds.has(String(it.item_id || it.zoho_item_id)); });
        } else { targetItems = getFilteredItems(); }
        if (!confirm('Apply ' + (pct > 0 ? '+' : '') + pct + '% to ' + field.replace('_', ' ') + ' for ' + targetItems.length + ' items?')) return;
        var count = 0;
        targetItems.forEach(function(item) {
            var id = String(item.item_id || item.zoho_item_id);
            var current = parseFloat(getCurrentValue(id, field)) || 0;
            if (current > 0) {
                var newVal = Math.round((current * (1 + pct / 100)) * 100) / 100;
                setDirty(id, field, String(newVal));
                count++;
            }
        });
        togglePctPopover();
        renderTable();
        showToast('Adjusted ' + field.replace('_', ' ') + ' by ' + (pct > 0 ? '+' : '') + pct + '% for ' + count + ' items', 'success');
    }
```

Replace with:

```javascript
    function applyPctAdjust() {
        var source = document.getElementById('pctSource').value;
        var target = document.getElementById('pctTarget').value;
        var pct = parseFloat(document.getElementById('pctValue').value);
        var scope = document.getElementById('pctScope').value;
        if (!source || !target) { showToast('Select source and target fields', 'error'); return; }
        if (isNaN(pct)) { showToast('Enter a percentage', 'error'); return; }
        var targetItems = [];
        if (scope === 'selected') {
            if (selectedItemIds.size === 0) { showToast('Select items first', 'error'); return; }
            targetItems = items.filter(function(it) { return selectedItemIds.has(String(it.item_id || it.zoho_item_id)); });
        } else { targetItems = getFilteredItems(); }
        var prettyLabel = function(k) { return k === 'cf_dpl' ? 'DPL' : k === 'rate' ? 'Rate' : k === 'purchase_rate' ? 'Purchase Rate' : k; };
        var sign = pct > 0 ? '+' : '';
        var msg = 'Apply ' + sign + pct + '% from ' + prettyLabel(source) + ' to ' + prettyLabel(target) + ' for ' + targetItems.length + ' items?';
        if (!confirm(msg)) return;
        var updated = 0, skipped = 0;
        targetItems.forEach(function(item) {
            var id = String(item.item_id || item.zoho_item_id);
            var currentSource = parseFloat(getCurrentValue(id, source));
            if (!isFinite(currentSource) || currentSource === 0) { skipped++; return; }
            var newTarget = Math.round((currentSource * (1 + pct / 100)) * 100) / 100;
            setDirty(id, target, String(newTarget));
            updated++;
        });
        togglePctPopover();
        renderTable();
        var resultMsg = 'Updated ' + prettyLabel(target) + ' for ' + updated + ' items';
        if (skipped > 0) resultMsg += ' (skipped ' + skipped + ' with empty ' + prettyLabel(source) + ')';
        showToast(resultMsg, 'success');
    }
```

Behavior changes:
1. Reads `pctSource` and `pctTarget` instead of `pctField`.
2. Formula: `newTarget = currentSource * (1 + pct/100)` — reads source, writes target. When source === target this is identical to today.
3. Allows `pct === 0` (useful for "copy source to target" — e.g., DPL → Rate at 0% to reset rate to DPL).
4. Skips rows with null/zero/NaN source and reports the skip count in the toast.
5. `prettyLabel()` maps column keys to human labels in the confirm dialog and toast.

- [ ] **Step 2.2: Manual test DPL → Rate at +10%**

Load the Edit Items page. Pick 3 items that already have non-zero DPL values. Click `% Adjust`, leave defaults (Source=DPL, Target=Rate), enter `10`, scope = Selected (after selecting the 3 items). Click Apply. Expected: confirm dialog reads "Apply +10% from DPL to Rate for 3 items?". After confirm, the Rate cell in each selected row shows `DPL × 1.10` rounded to 2 decimals (e.g., DPL 100 → Rate 110). Toast reads "Updated Rate for 3 items". Dirty badge increments by 3.

- [ ] **Step 2.3: Manual test Rate → Rate at +5% (regression)**

Set Source to `Rate (Selling Price)`, Target to `Rate (Selling Price)`, pct = 5, scope = Selected (pick 2 items with non-zero rate). Apply. Expected: rates increase by 5%, identical to legacy behavior. No regression.

- [ ] **Step 2.4: Manual test skip count**

Select 2 items — one with DPL empty/0, one with DPL=50. Apply DPL→Rate at +10%. Expected: 1 row updated (rate=55), 1 row skipped. Toast reads "Updated Rate for 1 items (skipped 1 with empty DPL)".

- [ ] **Step 2.5: Commit**

```bash
git add public/admin-zoho-items-edit.html
git commit -m "$(cat <<'EOF'
fix(zoho-items-edit): % adjust now supports source→target (default DPL→Rate)

Previously the % Adjust tool could only scale a single field in place
(Rate→Rate or PurchaseRate→PurchaseRate). Users wanted to derive Rate
from DPL + markup. Replaced the single field dropdown with Source/Target
selects. Default pairing is DPL→Rate. Formula: newTarget = source × (1 + pct/100).
Rows with empty/zero source are skipped and counted in the toast.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Sidebar — Add accordion CSS

**Files:**
- Modify: `public/components/sidebar-complete.html` (CSS block around lines 128-222)

- [ ] **Step 3.1: Insert new CSS rules for section toggle buttons + chevrons**

Open `public/components/sidebar-complete.html`. Locate the existing `.qc-nav-submenu` rule at line 203:

```css
    .qc-nav-submenu {
```

Immediately **before** line 203 (i.e. between the end of `.qc-nav-item-text` at line 200-ish and `.qc-nav-submenu`), insert this new CSS block:

```css
    /* Collapsible section toggle button */
    .qc-nav-section-toggle {
        width: 100%;
        background: transparent;
        border: 0;
        cursor: pointer;
        padding: 0.75rem 1.25rem 0.375rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        color: #94a3b8;
        font-family: inherit;
        font-size: 0.625rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        transition: color 0.15s ease, background 0.15s ease;
    }
    .qc-nav-section-toggle:hover { color: #475569; background: #f8fafc; }
    .qc-nav-section-toggle:focus { outline: none; color: #475569; }
    .qc-nav-section-label { flex: 1; text-align: left; }
    .qc-nav-chevron {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
        transition: transform 0.2s ease;
        color: #94a3b8;
    }
    .qc-nav-section-toggle[aria-expanded="true"] .qc-nav-chevron {
        transform: rotate(90deg);
    }
    .qc-nav-section-toggle[aria-expanded="true"] { color: #1e293b; }
    /* Hide section toggles when sidebar is collapsed */
    .qc-sidebar.collapsed .qc-nav-section-toggle { display: none; }
    /* Submenu wraps .qc-nav-item rows — let items render normally inside */
    .qc-nav-submenu {
        max-height: 0;
        overflow: hidden;
        transition: max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .qc-nav-submenu.open { max-height: 2000px; }
```

**Important:** the existing `.qc-nav-submenu { ... }` and `.qc-nav-submenu.open { max-height: 500px; }` rules at lines 203-211 should be **deleted** as part of this insertion — the new block above replaces them with `max-height: 2000px` (needed because some sections have 17+ items). The `.qc-nav-submenu-item` rules at lines 212-222 are **not touched**.

Use Edit with `old_string`:

```css
    .qc-nav-submenu {
        max-height: 0;
        overflow: hidden;
        transition: max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .qc-nav-submenu.open { max-height: 500px; }
```

and `new_string`:

```css
    /* Collapsible section toggle button */
    .qc-nav-section-toggle {
        width: 100%;
        background: transparent;
        border: 0;
        cursor: pointer;
        padding: 0.75rem 1.25rem 0.375rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        color: #94a3b8;
        font-family: inherit;
        font-size: 0.625rem;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        transition: color 0.15s ease, background 0.15s ease;
    }
    .qc-nav-section-toggle:hover { color: #475569; background: #f8fafc; }
    .qc-nav-section-toggle:focus { outline: none; color: #475569; }
    .qc-nav-section-label { flex: 1; text-align: left; }
    .qc-nav-chevron {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
        transition: transform 0.2s ease;
        color: #94a3b8;
    }
    .qc-nav-section-toggle[aria-expanded="true"] .qc-nav-chevron {
        transform: rotate(90deg);
    }
    .qc-nav-section-toggle[aria-expanded="true"] { color: #1e293b; }
    .qc-sidebar.collapsed .qc-nav-section-toggle { display: none; }
    .qc-nav-submenu {
        max-height: 0;
        overflow: hidden;
        transition: max-height 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .qc-nav-submenu.open { max-height: 2000px; }
```

**Do not commit yet** — Task 4 restructures the markup to use these classes.

---

## Task 4: Sidebar — Restructure every section into `<button>` + `<div class="qc-nav-submenu">`

**Files:**
- Modify: `public/components/sidebar-complete.html` (all 14 sections between lines ~575 and end of nav, roughly 890)

Each top-level section currently looks like this flat pattern:

```html
            <div class="qc-nav-section-title">Sales & Estimates</div>
            <a href="/estimates.html" class="qc-nav-item" data-page="estimates">
                <span class="qc-nav-item-icon">...</span>
                <span class="qc-nav-item-text">All Estimates</span>
            </a>
            <a href="/estimate-create-new.html" class="qc-nav-item" data-page="estimate-create">
                ...
            </a>
            ... more items ...
            <!-- next section starts with another <div class="qc-nav-section-title"> -->
```

We need to convert each section to this pattern:

```html
            <button type="button" class="qc-nav-section-toggle" data-section="sales" aria-expanded="false" onclick="qcToggleNavSection(this)">
                <span class="qc-nav-section-label">Sales & Estimates</span>
                <svg class="qc-nav-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
            <div class="qc-nav-submenu" data-section="sales">
                <a href="/estimates.html" class="qc-nav-item" data-page="estimates">
                    <span class="qc-nav-item-icon">...</span>
                    <span class="qc-nav-item-text">All Estimates</span>
                </a>
                ... all items for this section ...
            </div>
```

Key rules:
- The `.qc-nav-item` `<a>` links **stay exactly as they are** — same classes, same SVGs, same `data-page` attributes. Only the wrapping changes.
- The `.qc-nav-section-title` `<div>` becomes a `.qc-nav-section-toggle` `<button>` with a `<span class="qc-nav-section-label">` inside for the text, plus a chevron SVG.
- The `<a>` items that followed the section title go inside a new `<div class="qc-nav-submenu">`.
- `data-section` attribute is a short slug (`sales`, `products`, `customers`, etc.) — same slug on both the button and its submenu div, so JS can pair them.
- `aria-expanded="false"` on all toggles by default; JS will flip to `"true"` on the active section during init.

Use this `data-section` mapping:

| Section header text | `data-section` slug |
|---|---|
| Sales & Estimates | sales |
| Products & Inventory | products |
| Customers | customers |
| Leads & CRM | leads |
| Branches & Staff | branches |
| HR & Attendance | hr |
| Salary & Payroll | salary |
| Zoho Books | zoho |
| WhatsApp | whatsapp |
| Billing | billing |
| Painters | painters |
| System | system |

(Some sections above "Sales & Estimates" — Dashboard/Chat links at lines 545-573 — have no section title. Leave those as-is. They stay as flat top-level items above the first accordion header.)

- [ ] **Step 4.1: Convert the "Sales & Estimates" section**

Find the block starting at `<div class="qc-nav-section-title">Sales & Estimates</div>` (line 575) and ending just before `<div class="qc-nav-section-title">Products & Inventory</div>` (line 600).

Replace the single `<div class="qc-nav-section-title">Sales & Estimates</div>` line with:

```html
            <button type="button" class="qc-nav-section-toggle" data-section="sales" aria-expanded="false" onclick="qcToggleNavSection(this)">
                <span class="qc-nav-section-label">Sales & Estimates</span>
                <svg class="qc-nav-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="9 18 15 12 9 6"/></svg>
            </button>
            <div class="qc-nav-submenu" data-section="sales">
```

And **before** the next `<div class="qc-nav-section-title">Products & Inventory</div>` line (currently line 600), insert a closing:

```html
            </div>
```

So the Products section's new toggle button comes right after that `</div>`.

- [ ] **Step 4.2: Convert the "Products & Inventory" section**

Same pattern. Section title line 600 becomes button + opening submenu div with `data-section="products"`. Insert `</div>` before the next section title (Customers, line 620).

- [ ] **Step 4.3: Convert the "Customers" section**

`data-section="customers"`. Close before line 640 (Leads & CRM).

- [ ] **Step 4.4: Convert the "Leads & CRM" section**

`data-section="leads"`. Close before line 655 (Branches & Staff).

- [ ] **Step 4.5: Convert the "Branches & Staff" section**

`data-section="branches"`. Close before line 685 (HR & Attendance).

- [ ] **Step 4.6: Convert the "HR & Attendance" section**

`data-section="hr"`. Close before line 745 (Salary & Payroll).

- [ ] **Step 4.7: Convert the "Salary & Payroll" section**

`data-section="salary"`. Close before line 785 (Zoho Books).

- [ ] **Step 4.8: Convert the "Zoho Books" section AND add full parity with `zoho-subnav.html`**

`data-section="zoho"`. Close before line 837 (WhatsApp).

**Special handling for Zoho:** the sidebar currently lists ~9 Zoho links (`admin-zoho-dashboard.html`, `admin-zoho-invoices.html`, `admin-zoho-items.html`, `admin-zoho-stock.html`, `admin-zoho-locations.html`, `admin-zoho-transactions.html`, `admin-zoho-reorder.html`, `admin-zoho-reports.html`, `admin-zoho-settings.html`). The horizontal `components/zoho-subnav.html` has 17+ links. After wrapping the existing 9 in the submenu div, add `<a class="qc-nav-item">` entries for the missing ones by reading `public/components/zoho-subnav.html` as the source of truth.

For each missing link in `zoho-subnav.html` that isn't already in the sidebar's Zoho section, append an `<a class="qc-nav-item" href="{href}" data-page="{slug}"><span class="qc-nav-item-icon"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/></svg></span><span class="qc-nav-item-text">{label}</span></a>` entry inside the submenu div. Use a simple dot SVG as the icon for newly-added items (the dedicated icons in zoho-subnav can be copied over later — for this pass, consistency of presence matters more than icon polish).

**Concrete substeps for Task 4.8:**

1. Read `public/components/zoho-subnav.html` and extract every `<a>` link: its `href`, its visible text, and if possible its icon.
2. Read the current Zoho section in `sidebar-complete.html` (lines 785-836) and list every `<a href>` already present.
3. Compute the set difference — every zoho-subnav link not already in the sidebar.
4. Append those missing links to the new Zoho submenu div using the pattern above.
5. Convert the `<div class="qc-nav-section-title">Zoho Books</div>` to the toggle button as in earlier steps.

- [ ] **Step 4.9: Convert the "WhatsApp" section**

`data-section="whatsapp"`. Close before line 849 (Billing). After wrapping, audit against `public/components/whatsapp-subnav.html` and append any missing links using the same dot-icon fallback.

- [ ] **Step 4.10: Convert the "Billing" section**

`data-section="billing"`. Close before line 866 (Painters). No subnav file for billing — leave as the existing links only.

- [ ] **Step 4.11: Convert the "Painters" section**

`data-section="painters"`. Close before line 878 (System). After wrapping, audit against `public/components/painters-subnav.html` and append missing links with dot icons.

- [ ] **Step 4.12: Convert the "System" section and close it**

`data-section="system"`. This is the last section. Close with `</div>` before whatever element ends the nav list (likely `</nav>` or a closing `</div>` for the nav container). After wrapping, audit against `public/components/system-subnav.html` and append missing links.

- [ ] **Step 4.13: Visual smoke test**

Load any admin page (e.g. `/dashboard.html`). The sidebar should render but **all sections will be collapsed** because no JS is wired yet. Click each section header — nothing happens yet (expected, JS comes in Task 5). There should be no layout breakage: sections stack vertically, no overflow, no extra whitespace. If you see items bleeding outside the expected sections, a `</div>` is misplaced — fix before proceeding.

**Do not commit yet** — Task 5 wires the JS. Without it, the sidebar is unusable.

---

## Task 5: Sidebar — Accordion JS + active-section auto-expand

**Files:**
- Modify: `public/universal-nav-loader.js` — add `qcToggleNavSection` global and active-section init

- [ ] **Step 5.1: Add the `qcToggleNavSection` global and init helper**

Open `public/universal-nav-loader.js`. Find the `ensureGlobalFunctions()` function (currently at lines 300-331). Immediately **after** the closing `}` of `ensureGlobalFunctions` (around line 331), add a new function `initSidebarAccordion` and its helper. Then also call it at the right place in `initNavigation`.

Add this code (place it right after `ensureGlobalFunctions`'s closing brace):

```javascript
    /**
     * Toggle a single nav section's submenu. Accordion behavior:
     * clicking a section closes all others and toggles the clicked one.
     * Exposed as global so inline onclick="qcToggleNavSection(this)" works.
     */
    function qcToggleNavSection(btn) {
        if (!btn) return;
        var sidebar = btn.closest('.qc-sidebar');
        if (!sidebar) return;
        var section = btn.getAttribute('data-section');
        var isOpen = btn.getAttribute('aria-expanded') === 'true';
        // Close all toggles in this sidebar
        sidebar.querySelectorAll('.qc-nav-section-toggle').forEach(function(t) {
            t.setAttribute('aria-expanded', 'false');
        });
        sidebar.querySelectorAll('.qc-nav-submenu').forEach(function(s) {
            s.classList.remove('open');
        });
        // If the clicked one wasn't open, open it
        if (!isOpen) {
            btn.setAttribute('aria-expanded', 'true');
            var submenu = sidebar.querySelector('.qc-nav-submenu[data-section="' + section + '"]');
            if (submenu) submenu.classList.add('open');
        }
    }
    window.qcToggleNavSection = qcToggleNavSection;

    /**
     * Auto-expand the section containing the current URL's page.
     * Matches each <a href> inside each .qc-nav-submenu against location.pathname.
     */
    function initSidebarAccordion() {
        var sidebar = document.querySelector('.qc-sidebar');
        if (!sidebar) return;
        var path = window.location.pathname.replace(/\/+$/, '');
        if (!path) path = '/';
        // Strip leading slash for comparison flexibility
        var target = path.toLowerCase();
        var matchedSection = null;
        sidebar.querySelectorAll('.qc-nav-submenu').forEach(function(submenu) {
            if (matchedSection) return;
            var links = submenu.querySelectorAll('a[href]');
            for (var i = 0; i < links.length; i++) {
                var href = (links[i].getAttribute('href') || '').toLowerCase().replace(/\/+$/, '') || '/';
                if (href === target || (target !== '/' && href !== '/' && target.indexOf(href) === 0 && (target[href.length] === undefined || target[href.length] === '/' || target[href.length] === '?'))) {
                    matchedSection = submenu.getAttribute('data-section');
                    break;
                }
            }
        });
        if (matchedSection) {
            var btn = sidebar.querySelector('.qc-nav-section-toggle[data-section="' + matchedSection + '"]');
            var submenu = sidebar.querySelector('.qc-nav-submenu[data-section="' + matchedSection + '"]');
            if (btn) btn.setAttribute('aria-expanded', 'true');
            if (submenu) submenu.classList.add('open');
        }
    }
```

- [ ] **Step 5.2: Call `initSidebarAccordion()` after sidebar loads**

In the same file, find the line that says `ensureGlobalFunctions();` inside `initNavigation()` (around line 248 in the current file). **Immediately after** that line, add:

```javascript
                ensureGlobalFunctions();

                // Wire accordion: auto-expand the section for the current page
                initSidebarAccordion();

                // Load module subnavs based on data-page
```

(The third line is the existing comment that was previously right after `ensureGlobalFunctions();` — keep it in place.)

- [ ] **Step 5.3: Manual test accordion behavior on multiple pages**

1. Open `https://act.qcpaintshop.com/admin-zoho-dashboard.html` → the "Zoho Books" section should be auto-expanded; all other sections collapsed.
2. Click "Painters" section header → Painters expands, Zoho Books collapses.
3. Click "Painters" again → Painters collapses (nothing expanded).
4. Reload the page → Zoho Books expands again automatically.
5. Open `/admin-leads.html` → "Leads & CRM" auto-expanded.
6. Open `/dashboard.html` → no section auto-expanded (Dashboard is a flat top-level item, not in any submenu). Clicking any section header works.
7. Resize to mobile width (<768px), open the drawer via hamburger → accordion still works inside the drawer.

- [ ] **Step 5.4: Commit the sidebar work (Tasks 3+4+5 together)**

```bash
git add public/components/sidebar-complete.html public/universal-nav-loader.js
git commit -m "$(cat <<'EOF'
feat(sidebar): collapsible accordion with full subnav parity

Converts every top-level sidebar section into a click-to-expand accordion.
Only one section open at a time; the section containing the current URL
auto-expands on load. CSS for .qc-nav-section-toggle + chevron rotation
added; existing .qc-nav-submenu max-height bumped to 2000px to fit long
sections (Zoho has 17+ items). Missing links pulled in from the
horizontal subnav components (zoho/whatsapp/painters/system) so every
page is reachable from the sidebar — not just from the top bar.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Auth — Proactive session validation + hard-redirect logout

**Files:**
- Modify: `public/js/auth-helper.js` (lines 49-53, 61-83, 89-95)

- [ ] **Step 6.1: Update `logout()` to accept a reason + use a re-entrancy guard**

Find at `public/js/auth-helper.js:49-53`:

```javascript
/**
 * Logout user and redirect to login
 */
function logout() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
    window.location.href = '/login.html';
}
```

Replace with:

```javascript
/**
 * Logout user and redirect to login.
 * @param {Object} [opts]
 * @param {string} [opts.reason] - Optional reason shown as toast on login page ('expired')
 */
function logout(opts) {
    // Guard against double-logout when multiple in-flight requests 401 simultaneously
    if (window.__qcLoggingOut) return;
    window.__qcLoggingOut = true;
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
    var reason = opts && opts.reason ? '?reason=' + encodeURIComponent(opts.reason) : '';
    window.location.href = '/login.html' + reason;
}
```

- [ ] **Step 6.2: Update `apiRequest()` to pass `reason: 'expired'` on 401**

Find at `public/js/auth-helper.js:72-75`:

```javascript
        // Handle 401 Unauthorized
        if (response.status === 401) {
            console.warn('⚠️ Unauthorized - redirecting to login');
            logout();
            throw new Error('Unauthorized');
        }
```

Replace with:

```javascript
        // Handle 401 Unauthorized — token invalid or session expired server-side
        if (response.status === 401) {
            console.warn('⚠️ Unauthorized - redirecting to login');
            logout({ reason: 'expired' });
            throw new Error('Unauthorized');
        }
```

- [ ] **Step 6.3: Add `validateSession()` and wire it into `checkAuthOrRedirect()`**

Find at `public/js/auth-helper.js:86-95`:

```javascript
/**
 * Check authentication and redirect to login if not authenticated.
 * Call this at the top of every protected page.
 */
function checkAuthOrRedirect() {
    if (!isAuthenticated()) {
        window.location.href = '/login.html';
        return false;
    }
    return true;
}
```

Replace with:

```javascript
/**
 * Check authentication and redirect to login if not authenticated.
 * Call this at the top of every protected page.
 *
 * Returns a boolean (for legacy callers that check synchronously), but
 * also kicks off async validateSession() which may redirect asynchronously
 * if the server says the token is expired.
 */
function checkAuthOrRedirect() {
    if (!isAuthenticated()) {
        window.location.href = '/login.html';
        return false;
    }
    // Fire-and-forget server-side validation. If the token is stale,
    // validateSession() hard-redirects to /login.html?reason=expired.
    validateSession();
    return true;
}

/**
 * Ask the server whether the local token is still valid. If 401, clear
 * state and redirect to login. If 200, refresh the cached user object.
 * Network errors are tolerated (offline-friendly — the reactive 401
 * handler in apiRequest() catches expired tokens on the next live call).
 */
async function validateSession() {
    // Don't validate on public / login pages (would loop)
    var p = window.location.pathname;
    var publicPaths = ['/login.html', '/forgot-password.html', '/painter-login.html', '/painter-register.html', '/painter-dashboard.html'];
    if (publicPaths.some(function(pp) { return p.indexOf(pp) !== -1; }) || p.indexOf('/share/') === 0) {
        return;
    }
    var token = localStorage.getItem('auth_token');
    if (!token) return; // checkAuthOrRedirect already redirected
    try {
        var res = await fetch('/api/auth/me', {
            headers: { 'Authorization': 'Bearer ' + token },
            cache: 'no-store'
        });
        if (res.status === 401) {
            logout({ reason: 'expired' });
            return;
        }
        if (res.ok) {
            var data = await res.json();
            if (data && data.success && data.user) {
                localStorage.setItem('user', JSON.stringify(data.user));
            }
        }
    } catch (err) {
        // Network failure — don't log user out, they may be offline.
        // apiRequest() will catch expired tokens on the next real call.
        console.warn('validateSession: network error, proceeding with cached session', err);
    }
}
```

- [ ] **Step 6.4: Expose `validateSession` globally**

Find the block at `public/js/auth-helper.js:231-241` that exports to `window`:

```javascript
// Expose functions globally
window.getAuthHeaders = getAuthHeaders;
window.isAuthenticated = isAuthenticated;
window.getCurrentUser = getCurrentUser;
window.logout = logout;
window.apiRequest = apiRequest;
window.apiFetch = apiFetch;
window.checkAuthOrRedirect = checkAuthOrRedirect;
window.requireAdminOrRedirect = requireAdminOrRedirect;
window.isAndroidApp = isAndroidApp;
```

Add `window.validateSession = validateSession;` right before `window.isAndroidApp`:

```javascript
// Expose functions globally
window.getAuthHeaders = getAuthHeaders;
window.isAuthenticated = isAuthenticated;
window.getCurrentUser = getCurrentUser;
window.logout = logout;
window.apiRequest = apiRequest;
window.apiFetch = apiFetch;
window.checkAuthOrRedirect = checkAuthOrRedirect;
window.requireAdminOrRedirect = requireAdminOrRedirect;
window.validateSession = validateSession;
window.isAndroidApp = isAndroidApp;
```

- [ ] **Step 6.5: Also call `validateSession()` from `requireAdminOrRedirect()`**

Find at `public/js/auth-helper.js:218-229`:

```javascript
function requireAdminOrRedirect() {
    if (!isAuthenticated()) {
        window.location.href = '/login.html';
        return false;
    }
    const user = getCurrentUser();
    if (user && !['admin', 'manager', 'super_admin'].includes(user.role)) {
        window.location.href = '/staff/dashboard.html';
        return false;
    }
    return true;
}
```

Replace with:

```javascript
function requireAdminOrRedirect() {
    if (!isAuthenticated()) {
        window.location.href = '/login.html';
        return false;
    }
    const user = getCurrentUser();
    if (user && !['admin', 'manager', 'super_admin'].includes(user.role)) {
        window.location.href = '/staff/dashboard.html';
        return false;
    }
    // Kick off async server-side validation — hard-redirects if token is stale
    validateSession();
    return true;
}
```

- [ ] **Step 6.6: Manual test — expired session kick**

1. Log into the admin panel normally. Note the current `auth_token` in DevTools → Application → Local Storage.
2. In a separate terminal, invalidate the session server-side:
   ```bash
   ssh root@161.97.114.189 "cd /www/wwwroot/act.qcpaintshop.com && mysql -e \"DELETE FROM business_manager.user_sessions WHERE session_token = '<PASTE_TOKEN_HERE>';\""
   ```
   (Or run the equivalent DELETE against the local dev DB if testing locally.)
3. Reload any admin page (e.g. `/dashboard.html`).
4. **Expected:** within ~300ms, the browser hard-redirects to `/login.html?reason=expired`. The old dashboard must not remain interactive.
5. Log in again. Everything should work without a second logout — no "have to logout and login again" loop.

- [ ] **Step 6.7: Manual test — normal session is not disrupted**

Log in, do 5-10 normal actions (navigate pages, submit forms). Confirm no unexpected logouts. Watch the Network tab: each protected page load should fire exactly one `GET /api/auth/me` that returns 200.

- [ ] **Step 6.8: Manual test — double-logout guard**

Open DevTools Console on any admin page. Run:
```javascript
Promise.all([apiRequest('/api/fake-401-1'), apiRequest('/api/fake-401-2')]).catch(()=>{});
```
If the server returns 401 for both (it will, because the URLs don't exist but protected routes check auth), only one redirect should fire — the `__qcLoggingOut` guard prevents a race where both callers try to navigate simultaneously.

---

## Task 7: Login page — Expired-session toast

**Files:**
- Modify: `public/login.html` (add a small `<script>` near the bottom of the body that reads `?reason=expired` and shows a toast)

- [ ] **Step 7.1: Add the toast injection script**

Open `public/login.html`. Find the closing `</body>` tag near the end of the file. Immediately **before** it, insert:

```html
<!-- Expired-session toast: shown when auth-helper redirects here with ?reason=expired -->
<div id="qcExpiredToast" style="position:fixed;top:20px;left:50%;transform:translateX(-50%);background:#fef3c7;color:#92400e;border:1px solid #fde68a;padding:10px 16px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,0.12);font-size:13px;z-index:9999;display:none;max-width:90vw;text-align:center;">
    Your session expired — please log in again.
</div>
<script>
(function() {
    try {
        var reason = new URLSearchParams(window.location.search).get('reason');
        if (reason === 'expired') {
            var t = document.getElementById('qcExpiredToast');
            if (t) {
                t.style.display = 'block';
                // Dismiss when the user starts interacting with the form
                var dismiss = function() { t.style.display = 'none'; };
                document.addEventListener('click', dismiss, { once: true });
                document.addEventListener('keydown', dismiss, { once: true });
                // Also auto-dismiss after 8 seconds
                setTimeout(dismiss, 8000);
            }
        }
    } catch(e) { /* no-op */ }
})();
</script>
</body>
```

(i.e. the existing `</body>` stays after the new `<script>` — we're inserting the toast div and script just before it.)

- [ ] **Step 7.2: Manual test — toast shows with `?reason=expired`**

Open `https://act.qcpaintshop.com/login.html?reason=expired` directly. Expected: amber toast "Your session expired — please log in again." appears near the top of the viewport. Click anywhere or press any key → toast disappears. Wait 8s → toast auto-dismisses.

Open `https://act.qcpaintshop.com/login.html` (no query) → no toast.

- [ ] **Step 7.3: End-to-end test — expired session → login → toast → fresh session**

1. Log in, delete the `user_sessions` row as in Task 6.6.
2. Reload an admin page → redirected to `/login.html?reason=expired` with toast visible.
3. Log in again.
4. Confirm the new session is fully functional (no second logout needed, API calls succeed).

- [ ] **Step 7.4: Commit Tasks 6 + 7 together**

```bash
git add public/js/auth-helper.js public/login.html
git commit -m "$(cat <<'EOF'
fix(auth): proactively validate session on page load, hard-redirect on expiry

Previously auth-helper only checked for local token presence — a stale
server-side session left the user on a non-functional dashboard until
they manually logged out and back in. Now checkAuthOrRedirect and
requireAdminOrRedirect fire an async validateSession() that hits
GET /api/auth/me; on 401 we clear local state and redirect to
/login.html?reason=expired. apiRequest's reactive 401 handler now passes
the same reason. A module-level __qcLoggingOut flag guards against
double-redirects when several requests 401 simultaneously. Login page
shows a small toast when arriving with ?reason=expired.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Final integration check

**Files:** no changes; verification only.

- [ ] **Step 8.1: Run the existing test suite to confirm no regressions in backend code**

```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/act.qcpaintshop.com" && npm test
```

Expected: same pass/fail ratio as before this plan started (per memory: 116 pass, 1 pre-existing fail). No new failures. The plan doesn't touch backend code, so any new failure is a flag to investigate before declaring done.

- [ ] **Step 8.2: Smoke test the three fixes together on one session**

1. Open `/admin-zoho-items-edit.html` → Zoho Books section auto-expanded in the sidebar (Task 5); `% Adjust` popover shows new DPL → Rate defaults (Task 1+2).
2. Open `/dashboard.html` → no section auto-expanded; Zoho Books is collapsed; click it to expand and all 17+ Zoho pages listed.
3. DevTools Network tab on first load: exactly one `GET /api/auth/me` fires, returns 200.
4. Delete the session row, reload → redirect to `/login.html?reason=expired` with toast.

- [ ] **Step 8.3: Update `Skills.md` to reflect the three fixes**

`Skills.md` is the project's system documentation and is updated after every task per CLAUDE.md memory. Add an entry under "Recent Features" matching today's date (2026-04-14):

Append to the `## Recent Features` section:

```markdown
- **Zoho Price-Adjust, Sidebar Accordion, Login-After-Logout fix** (Apr 14): `% Adjust` on `admin-zoho-items-edit.html` now supports source→target dropdowns (default DPL→Rate, formula `source × (1 + pct/100)`); admin sidebar converted to click-to-expand accordion with full subnav parity (Zoho/WhatsApp/Painters/System sections now list every page from their horizontal subnav); `auth-helper.js` added proactive `validateSession()` against `/api/auth/me` so stale sessions no longer leave the user on a non-functional dashboard — expired sessions redirect to `/login.html?reason=expired` with a toast. Files: `public/admin-zoho-items-edit.html`, `public/components/sidebar-complete.html`, `public/universal-nav-loader.js`, `public/js/auth-helper.js`, `public/login.html`. Spec: `docs/superpowers/specs/2026-04-14-zoho-bugs-sidebar-auth-design.md`.
```

Use the Edit tool with a unique anchor to find the right spot in `Skills.md`. If no `## Recent Features` heading exists, append the entry to the file's end under a new `## Changelog` heading.

- [ ] **Step 8.4: Commit the docs update**

```bash
git add Skills.md
git commit -m "$(cat <<'EOF'
docs(skills): record Apr 14 zoho/sidebar/auth fixes

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Verification summary

By the end of this plan, the repository will have 4 new commits on `master`:

1. `fix(zoho-items-edit): % adjust now supports source→target (default DPL→Rate)` — Task 2
2. `feat(sidebar): collapsible accordion with full subnav parity` — Tasks 3+4+5
3. `fix(auth): proactively validate session on page load, hard-redirect on expiry` — Tasks 6+7
4. `docs(skills): record Apr 14 zoho/sidebar/auth fixes` — Task 8

All three user-reported bugs are addressed:

- **Price adjust**: default DPL → Rate at +N% produces the exact "₹100 DPL → ₹110 Rate at 10%" behavior the user asked for, while still allowing Rate→Rate, PurchaseRate→PurchaseRate, or any other source/target pairing.
- **Sidebar**: every section is collapsible under its header; clicking a header expands its submenu and closes others; the current page's section auto-expands on load; every Zoho/WhatsApp/Painters/System page is now reachable from the sidebar rather than only from a horizontal bar.
- **Login-after-logout**: on every admin page load, the client calls `GET /api/auth/me`; if the server says the token is dead, the user is redirected immediately to `/login.html?reason=expired` with a dismissable toast, instead of being stuck on a non-functional dashboard.

No automated tests added — all three fixes are client-side UI and the existing backend test suite is unaffected.
