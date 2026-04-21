# Admin Painter Management UI/UX Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `public/admin-painters.html` from a flat 14-button tab bar into a mobile-first 2-level nav (4 group tabs + scrollable sub-tabs), with hybrid card/table lists and 44px touch targets throughout.

**Architecture:** All changes are in `public/admin-painters.html` (4685 lines, single file). The flat tab row (lines 93-109) is replaced with a sticky group strip + sticky sub-tab strip. `switchTab()` is refactored to not rely on `event.target`; a new `switchGroup()` function drives group-level navigation. Each content tab gets mobile card variants alongside desktop table views using Tailwind responsive classes.

**Tech Stack:** Vanilla JS, Tailwind CSS (CDN), existing `data-table` / `badge-*` / `btn-sm` CSS classes, existing `esc()` / `authHeaders()` / `API` globals.

---

## Tab → Group Mapping

| Group | Sub-tabs (existing tab IDs) |
|-------|-----------------------------|
| Painters 👥 | `painters`, `rates`, `training`, `visualizations` |
| Finance 💰 | `withdrawals`, `points`, `estimates` |
| Catalog 📦 | `catalog`, `offers`, `overrides` |
| Comms 📣 | `attendance`, `reports`, `marketing`, `notifications` |

---

## File Map

- **Modify only:** `public/admin-painters.html`
  - Lines 18-80: `<style>` block — add group/sub-tab CSS, mobile card CSS, bottom-sheet modal CSS
  - Lines 93-109: flat tab row — replace with group strip + sub-tab strip HTML
  - Lines 112-152: `tab-painters` content — add mobile card list + skeleton loader
  - Lines 319-339: `tab-withdrawals` content — add summary strip + mobile cards
  - Lines 1313-1332: `switchTab()` function — refactor to remove `event.target` dependency
  - After `switchTab()`: add `switchGroup()`, `GROUP_TABS` constant, badge update helpers
  - `renderPaintersTable()` (~line 1362): emit both mobile cards and desktop rows
  - `loadWithdrawals()` (~line 2127): emit both mobile cards and desktop rows

---

## Task 1: CSS additions + Group/Sub-tab Nav HTML

**Files:**
- Modify: `public/admin-painters.html` (lines 18-109)

### Context
The current `<style>` block ends around line 80. The flat tab row is lines 93-109. We are replacing both.

- [ ] **Step 1: Add CSS for group strip, sub-tab strip, mobile cards, and bottom-sheet modals**

Find the closing `</style>` tag (around line 80) and insert before it:

```css
        /* ── 2-Level Nav ── */
        .group-btn { display:flex; flex-direction:column; align-items:center; justify-content:center; flex:1; padding:0.5rem 0.25rem; border-radius:0.5rem; font-size:0.75rem; font-weight:600; color:#64748b; cursor:pointer; transition:all 0.15s; background:transparent; border:none; min-height:44px; gap:1px; }
        .group-btn .grp-icon { font-size:1.1rem; line-height:1; }
        .group-btn .grp-label { font-size:0.68rem; white-space:nowrap; }
        .group-btn.active { background:linear-gradient(135deg,#667eea,#764ba2); color:#fff; box-shadow:0 2px 8px rgba(102,126,234,0.3); }
        .group-badge { display:none; background:#ef4444; color:#fff; border-radius:9999px; font-size:0.6rem; font-weight:700; padding:1px 5px; margin-left:2px; vertical-align:middle; }
        .group-badge.show { display:inline; }

        #groupStrip { position:sticky; top:0; z-index:40; background:#fff; padding:0.25rem; border-radius:0.75rem; border:1px solid #e8ecf1; margin-bottom:0; box-shadow:0 1px 4px rgba(0,0,0,0.06); }
        #subTabStrip { position:sticky; top:56px; z-index:39; background:#fff; border:1px solid #e8ecf1; border-radius:0.75rem; margin-bottom:1rem; overflow-x:auto; scrollbar-width:none; box-shadow:0 1px 4px rgba(0,0,0,0.04); }
        #subTabStrip::-webkit-scrollbar { display:none; }
        .subtab-group { display:none; }
        .subtab-group.active { display:flex; min-width:100%; }
        .subtab-btn { flex:1; white-space:nowrap; padding:0.625rem 1rem; font-size:0.8125rem; font-weight:500; color:#64748b; cursor:pointer; background:transparent; border:none; border-bottom:2px solid transparent; min-height:44px; transition:all 0.15s; }
        .subtab-btn:hover { color:#374151; background:#f8fafc; }
        .subtab-btn.active { color:#4f46e5; border-bottom-color:#4f46e5; font-weight:600; }

        /* ── Mobile painter cards ── */
        .painter-card { background:#fff; border:1px solid #e8ecf1; border-radius:0.75rem; padding:0.875rem 1rem; margin-bottom:0.625rem; }
        .painter-card-avatar { width:40px; height:40px; border-radius:9999px; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:0.875rem; color:#fff; flex-shrink:0; border:2px solid; }
        .painter-card-name { font-weight:600; font-size:0.9375rem; color:#1e293b; }
        .painter-card-meta { font-size:0.8rem; color:#64748b; margin-top:1px; }
        .painter-card-actions { display:flex; gap:0.5rem; margin-top:0.625rem; flex-wrap:wrap; }
        .painter-card-actions .btn-sm { min-height:36px; flex:1; text-align:center; }

        /* ── Mobile withdrawal cards ── */
        .withdrawal-card { background:#fff; border:1px solid #e8ecf1; border-radius:0.75rem; padding:0.875rem 1rem; margin-bottom:0.625rem; }
        .withdrawal-card-header { display:flex; justify-content:space-between; align-items:flex-start; }
        .withdrawal-card-actions { display:grid; grid-template-columns:1fr 1fr; gap:0.5rem; margin-top:0.75rem; }
        .withdrawal-card-actions button { min-height:40px; }

        /* ── Skeleton loader ── */
        .skeleton { background:linear-gradient(90deg,#f1f5f9 25%,#e2e8f0 50%,#f1f5f9 75%); background-size:200% 100%; animation:shimmer 1.4s infinite; border-radius:0.375rem; }
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
        .skeleton-card { background:#fff; border:1px solid #e8ecf1; border-radius:0.75rem; padding:0.875rem; margin-bottom:0.625rem; }

        /* ── Bottom-sheet modals on mobile ── */
        @media (max-width:767px) {
            .modal-content { border-radius:1rem 1rem 0 0 !important; position:fixed !important; bottom:0 !important; left:0 !important; right:0 !important; width:100% !important; max-width:100% !important; max-height:90vh !important; margin:0 !important; overflow-y:auto; }
            .modal-overlay { align-items:flex-end !important; }
        }

        /* ── Summary strip ── */
        .summary-strip { background:#f8fafc; border:1px solid #e8ecf1; border-radius:0.75rem; padding:0.625rem 1rem; margin-bottom:0.75rem; display:flex; gap:1.25rem; flex-wrap:wrap; font-size:0.8125rem; }
        .summary-strip span { color:#64748b; }
        .summary-strip strong { color:#1e293b; }

        /* ── Touch-target helpers ── */
        .touch-btn { min-height:44px; min-width:44px; display:inline-flex; align-items:center; justify-content:center; }
```

- [ ] **Step 2: Replace the flat tab row with 2-level nav HTML**

Find and replace the entire `<!-- Tabs -->` block (lines 93-109):

```html
            <!-- OLD: <div class="flex flex-wrap gap-2 mb-6"> ... </div> -->
```

Replace with:

```html
            <!-- Group Strip -->
            <div id="groupStrip" class="flex gap-1 mb-1">
                <button class="group-btn active" onclick="switchGroup('painters')" id="grp-painters">
                    <span class="grp-icon">👥</span>
                    <span class="grp-label">Painters</span>
                </button>
                <button class="group-btn" onclick="switchGroup('finance')" id="grp-finance">
                    <span class="grp-icon">💰</span>
                    <span class="grp-label">Finance<span class="group-badge" id="finBadge"></span></span>
                </button>
                <button class="group-btn" onclick="switchGroup('catalog')" id="grp-catalog">
                    <span class="grp-icon">📦</span>
                    <span class="grp-label">Catalog</span>
                </button>
                <button class="group-btn" onclick="switchGroup('comms')" id="grp-comms">
                    <span class="grp-icon">📣</span>
                    <span class="grp-label">Comms</span>
                </button>
            </div>

            <!-- Sub-tab Strip -->
            <div id="subTabStrip">
                <div id="subtabs-painters" class="subtab-group active">
                    <button class="subtab-btn active" onclick="switchTab('painters')" id="stab-painters">Painters</button>
                    <button class="subtab-btn" onclick="switchTab('rates')" id="stab-rates">Levels & Slabs</button>
                    <button class="subtab-btn" onclick="switchTab('training')" id="stab-training">Training</button>
                    <button class="subtab-btn" onclick="switchTab('visualizations')" id="stab-visualizations">Visualizations</button>
                </div>
                <div id="subtabs-finance" class="subtab-group">
                    <button class="subtab-btn" onclick="switchTab('withdrawals')" id="stab-withdrawals">Withdrawals</button>
                    <button class="subtab-btn" onclick="switchTab('points')" id="stab-points">Billing</button>
                    <button class="subtab-btn" onclick="switchTab('estimates')" id="stab-estimates">Estimates</button>
                </div>
                <div id="subtabs-catalog" class="subtab-group">
                    <button class="subtab-btn" onclick="switchTab('catalog')" id="stab-catalog">Products</button>
                    <button class="subtab-btn" onclick="switchTab('offers')" id="stab-offers">Offers</button>
                    <button class="subtab-btn" onclick="switchTab('overrides')" id="stab-overrides">Points Config</button>
                </div>
                <div id="subtabs-comms" class="subtab-group">
                    <button class="subtab-btn" onclick="switchTab('attendance')" id="stab-attendance">Attendance</button>
                    <button class="subtab-btn" onclick="switchTab('reports')" id="stab-reports">Reports</button>
                    <button class="subtab-btn" onclick="switchTab('marketing')" id="stab-marketing">Marketing</button>
                    <button class="subtab-btn" onclick="switchTab('notifications')" id="stab-notifications">Notifications</button>
                </div>
            </div>
```

- [ ] **Step 3: Verify the page loads without JS errors**

Open `http://localhost:3000/admin-painters.html` (or the dev server URL) in a browser. Open DevTools console. Confirm:
- No JS errors on load
- Group strip renders with 4 buttons
- Sub-tab strip shows "Painters | Levels & Slabs | Training | Visualizations"

- [ ] **Step 4: Commit**

```bash
cd "D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\act.qcpaintshop.com"
git add public/admin-painters.html
git commit -m "feat(painters-ui): add 2-level group+subtab nav shell with CSS"
```

---

## Task 2: Refactor `switchTab()` + add `switchGroup()` JS

**Files:**
- Modify: `public/admin-painters.html` (~line 1313, the `switchTab` function)

### Context
Current `switchTab(tab)` uses `event.target.classList.add('active')` — this breaks when called programmatically. We need to replace it with ID-based activation. We also add `switchGroup()` and `GROUP_TABS`.

- [ ] **Step 1: Replace the `switchTab` function**

Find the existing `function switchTab(tab) {` block (lines ~1313-1332) and replace the entire function:

```javascript
    const GROUP_TABS = {
        painters: ['painters', 'rates', 'training', 'visualizations'],
        finance: ['withdrawals', 'points', 'estimates'],
        catalog: ['catalog', 'offers', 'overrides'],
        comms: ['attendance', 'reports', 'marketing', 'notifications']
    };

    function switchGroup(group) {
        document.querySelectorAll('.group-btn').forEach(b => b.classList.remove('active'));
        document.getElementById('grp-' + group).classList.add('active');
        document.querySelectorAll('.subtab-group').forEach(g => g.classList.remove('active'));
        document.getElementById('subtabs-' + group).classList.add('active');
        switchTab(GROUP_TABS[group][0]);
    }

    function switchTab(tab) {
        document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
        const tabEl = document.getElementById('tab-' + tab);
        if (tabEl) tabEl.classList.add('active');
        document.querySelectorAll('.subtab-btn').forEach(b => b.classList.remove('active'));
        const stabEl = document.getElementById('stab-' + tab);
        if (stabEl) {
            stabEl.classList.add('active');
            stabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
        }
        if (tab === 'painters') loadPainters();
        if (tab === 'points') loadPointsTab();
        if (tab === 'rates') loadRatesTab();
        if (tab === 'withdrawals') loadWithdrawals();
        if (tab === 'reports') loadReportsTab();
        if (tab === 'estimates') loadEstimates();
        if (tab === 'offers') loadOffers();
        if (tab === 'overrides') { ensureOvrPainterList(); loadOvrTarget(); }
        if (tab === 'training') loadTrainingContent();
        if (tab === 'catalog') loadCatalogStats();
        if (tab === 'visualizations') loadVisualizations();
        if (tab === 'marketing') initMarketingTab();
        if (tab === 'attendance') initAttendanceTab();
        // notifications tab has no lazy-load trigger needed
    }

    function updateFinanceBadge(count) {
        const badge = document.getElementById('finBadge');
        if (!badge) return;
        if (count > 0) { badge.textContent = count; badge.classList.add('show'); }
        else { badge.classList.remove('show'); }
    }
```

- [ ] **Step 2: Find all other places in the file that call `switchTab` via button `onclick`**

Search for remaining `onclick="switchTab(` calls that were part of the OLD flat tab row — these are gone now (replaced in Task 1). Confirm the old flat-tab `onclick` attributes no longer exist in the file. The only remaining `switchTab` calls should be inside `switchGroup()` and inside content areas (e.g., report cards that jump to a tab).

- [ ] **Step 3: Fix the existing `switchTab` call in `loadSummary` that uses `event.target`**

Search for this pattern (~line 2196):
```javascript
onclick="${s.pendingPainters > 0 ? "document.getElementById('painterStatusFilter').value='pending';loadPainters();switchTab('painters');" : ''}"
```
This is fine — it calls `switchTab('painters')` without `event.target`. No change needed.

- [ ] **Step 4: Verify group switching works in browser**

Open `admin-painters.html`. Click "Finance 💰" group button. Confirm:
- Finance group button turns indigo/active
- Sub-tab strip shows "Withdrawals | Billing | Estimates"
- Withdrawals content tab becomes visible
- Click "Catalog 📦" — sub-tab strip updates to "Products | Offers | Points Config"

- [ ] **Step 5: Commit**

```bash
git add public/admin-painters.html
git commit -m "feat(painters-ui): switchGroup() + refactored switchTab() with ID-based activation"
```

---

## Task 3: Painters Tab — Hybrid Card/Table List

**Files:**
- Modify: `public/admin-painters.html` (tab-painters content ~lines 112-153, renderPaintersTable ~line 1362)

### Context
Current painters tab has a single desktop table. We add a mobile card list (`id="paintersMobileList"`) alongside the existing table. `renderPaintersTable()` populates both. Level ring colours: Bronze `#CD7F32`, Silver `#9CA3AF`, Gold `#D4A24E`, Diamond `#3B82F6`.

- [ ] **Step 1: Update the tab-painters HTML to add mobile list + skeleton + better filter area**

Find the `<div id="tab-painters" class="tab-content active">` block (lines ~112-153) and replace its inner content (everything from the pendingAlert down to `</div>` closing the tab) with:

```html
            <!-- Tab 1: Painters -->
            <div id="tab-painters" class="tab-content active">
                <div id="pendingAlert" style="display:none;background:#fffbeb;border:1px solid #f59e0b;border-radius:12px;padding:12px 16px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:12px;">
                    <span style="color:#92400e;font-size:0.9rem;font-weight:600;">⚠️ <span id="pendingAlertCount"></span> painter(s) awaiting approval</span>
                    <button onclick="document.getElementById('painterStatusFilter').value='pending';loadPainters();" style="background:#f59e0b;color:#fff;border:none;border-radius:8px;padding:6px 14px;font-size:0.82rem;font-weight:600;cursor:pointer;">Review Now</button>
                </div>
                <!-- Search + Filters -->
                <div class="bg-white rounded-xl border border-gray-200 p-3 mb-3">
                    <input type="text" id="painterSearch" placeholder="Search name, phone, city…" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-2" oninput="debounceLoadPainters()">
                    <div class="flex gap-2 overflow-x-auto pb-1" style="scrollbar-width:none;">
                        <select id="painterStatusFilter" class="shrink-0 px-3 py-2 border border-gray-300 rounded-full text-sm bg-white" onchange="loadPainters()">
                            <option value="">All Status</option>
                            <option value="pending">Pending</option>
                            <option value="approved">Approved</option>
                            <option value="suspended">Suspended</option>
                            <option value="rejected">Rejected</option>
                        </select>
                        <select id="painterLevelFilter" class="shrink-0 px-3 py-2 border border-gray-300 rounded-full text-sm bg-white" onchange="loadPainters()">
                            <option value="">All Levels</option>
                            <option value="bronze">Bronze</option>
                            <option value="silver">Silver</option>
                            <option value="gold">Gold</option>
                            <option value="diamond">Diamond</option>
                        </select>
                        <select id="painterBranchFilter" class="shrink-0 px-3 py-2 border border-gray-300 rounded-full text-sm bg-white" onchange="loadPainters()">
                            <option value="">All Branches</option>
                        </select>
                        <select id="painterSortFilter" class="shrink-0 px-3 py-2 border border-gray-300 rounded-full text-sm bg-white" onchange="loadPainters()">
                            <option value="">Sort: Default</option>
                            <option value="name">Name A→Z</option>
                            <option value="regular_points">Reg Points ↓</option>
                            <option value="annual_points">Ann Points ↓</option>
                            <option value="joined">Joined ↓</option>
                        </select>
                    </div>
                </div>

                <!-- Mobile Cards (hidden on md+) -->
                <div id="paintersMobileList" class="md:hidden">
                    <div class="skeleton-card"><div class="skeleton h-4 w-3/4 mb-2"></div><div class="skeleton h-3 w-1/2"></div></div>
                    <div class="skeleton-card"><div class="skeleton h-4 w-2/3 mb-2"></div><div class="skeleton h-3 w-1/3"></div></div>
                    <div class="skeleton-card"><div class="skeleton h-4 w-3/4 mb-2"></div><div class="skeleton h-3 w-1/2"></div></div>
                </div>

                <!-- Desktop Table (hidden on mobile) -->
                <div class="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div class="overflow-x-auto">
                        <table class="data-table">
                            <thead>
                                <tr>
                                    <th>Name</th>
                                    <th>Phone</th>
                                    <th>City</th>
                                    <th>Status</th>
                                    <th>Level</th>
                                    <th>Streak</th>
                                    <th>Regular Pts</th>
                                    <th>Annual Pts</th>
                                    <th>Credit</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody id="paintersTableBody">
                                <tr><td colspan="10" class="text-center py-8 text-gray-400">Loading…</td></tr>
                            </tbody>
                        </table>
                    </div>
                </div>
                <div id="paintersPagination" class="flex justify-between items-center mt-4 text-sm text-gray-500"></div>
            </div>
```

- [ ] **Step 2: Update `renderPaintersTable()` to also emit mobile cards**

Find `function renderPaintersTable(painters) {` (~line 1362) and replace the entire function:

```javascript
    const LEVEL_COLORS = { bronze:'#CD7F32', silver:'#9CA3AF', gold:'#D4A24E', diamond:'#3B82F6' };

    function painterInitials(name) {
        return (name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase();
    }

    function levelColor(level) { return LEVEL_COLORS[level||'bronze'] || '#CD7F32'; }

    function renderPaintersTable(painters) {
        const mobileList = document.getElementById('paintersMobileList');
        const tableBody = document.getElementById('paintersTableBody');

        if (!painters.length) {
            if (mobileList) mobileList.innerHTML = '<div class="empty-state"><p>No painters found</p><button onclick="document.getElementById(\'painterStatusFilter\').value=\'\';document.getElementById(\'painterSearch\').value=\'\';loadPainters();" class="btn-sm btn-outline mt-3">Clear Filters</button></div>';
            if (tableBody) tableBody.innerHTML = '<tr><td colspan="10" class="text-center py-8 text-gray-400">No painters found</td></tr>';
            return;
        }

        // Mobile cards
        if (mobileList) {
            mobileList.innerHTML = painters.map(p => {
                const lc = levelColor(p.current_level);
                const lvl = (p.current_level||'bronze');
                const lvlLabel = lvl.charAt(0).toUpperCase()+lvl.slice(1);
                const statusColors = { approved:'#d1fae5|#065f46', pending:'#fef3c7|#92400e', suspended:'#e2e8f0|#475569', rejected:'#fee2e2|#991b1b' };
                const [sbg, scolor] = (statusColors[p.status]||'#e2e8f0|#475569').split('|');
                return `
                <div class="painter-card">
                    <div class="flex items-start gap-3">
                        <div class="painter-card-avatar" style="background:${lc};border-color:${lc};">${painterInitials(p.full_name)}</div>
                        <div class="flex-1 min-w-0">
                            <div class="flex items-center justify-between gap-2">
                                <span class="painter-card-name">${esc(p.full_name)}</span>
                                <span class="badge" style="background:${sbg};color:${scolor};">${p.status}</span>
                            </div>
                            <div class="painter-card-meta">
                                <span style="color:${lc};font-weight:600;">${lvlLabel}</span>
                                &nbsp;·&nbsp; Reg: <strong>${parseFloat(p.regular_points).toFixed(0)}</strong>
                                &nbsp;·&nbsp; Ann: <strong>${parseFloat(p.annual_points).toFixed(0)}</strong>
                            </div>
                            <div class="painter-card-meta">${esc(p.city||'')}${p.city&&p.phone?' · ':''}${esc(p.phone||'')}</div>
                        </div>
                    </div>
                    <div class="painter-card-actions">
                        ${p.status === 'pending' ? `
                            <button onclick="approvePainter(${p.id},'approve')" class="btn-sm btn-success">Approve</button>
                            <button onclick="approvePainter(${p.id},'reject')" class="btn-sm btn-danger">Reject</button>
                        ` : `
                            <button onclick="showPainterDetail(${p.id})" class="btn-sm btn-outline">Edit / View</button>
                            <button onclick="showPainterDetail(${p.id})" class="btn-sm btn-primary">Points ±</button>
                        `}
                    </div>
                </div>`;
            }).join('');
        }

        // Desktop table
        if (tableBody) {
            tableBody.innerHTML = painters.map(p => `
                <tr class="cursor-pointer" onclick="showPainterDetail(${p.id})">
                    <td class="font-medium">${esc(p.full_name)}</td>
                    <td>${esc(p.phone)}</td>
                    <td>${esc(p.city || '-')}</td>
                    <td><span class="badge badge-${p.status}">${p.status}</span></td>
                    <td><span style="color:${levelColor(p.current_level)};font-weight:600">${(p.current_level||'bronze').charAt(0).toUpperCase()+(p.current_level||'bronze').slice(1)}</span></td>
                    <td>${p.current_streak||0} ${(p.current_streak||0)>0?'🔥':''}</td>
                    <td>${parseFloat(p.regular_points).toFixed(2)}</td>
                    <td>${parseFloat(p.annual_points).toFixed(2)}</td>
                    <td>${p.credit_enabled ? '₹' + parseFloat(p.credit_limit).toLocaleString() : '-'}</td>
                    <td>
                        ${p.status === 'pending' ? `
                            <button onclick="event.stopPropagation();approvePainter(${p.id},'approve')" class="btn-sm btn-success mr-1">Approve</button>
                            <button onclick="event.stopPropagation();approvePainter(${p.id},'reject')" class="btn-sm btn-danger">Reject</button>
                        ` : `<button onclick="event.stopPropagation();showPainterDetail(${p.id})" class="btn-sm btn-outline">View</button>`}
                    </td>
                </tr>
            `).join('');
        }
    }
```

- [ ] **Step 3: Update `loadPainters()` to pass new filter params**

Find the `loadPainters(page = 1)` function (~line 1342). After the `if (status) params.set('status', status);` line, add:

```javascript
            const level = document.getElementById('painterLevelFilter')?.value;
            const sort = document.getElementById('painterSortFilter')?.value;
            if (level) params.set('level', level);
            if (sort) params.set('sort', sort);
```

(The backend may ignore unknown params gracefully — this is a progressive enhancement for when the API supports it. It does no harm if not.)

- [ ] **Step 4: Also update the Finance badge when pending withdrawals load**

Find `loadWithdrawals()` (~line 2127). After the line `if (!data.withdrawals.length)` block, add a call to update the badge. At the top of `loadWithdrawals`, after fetching data:

```javascript
            const pendingCount = (data.withdrawals || []).filter(w => w.status === 'pending').length;
            updateFinanceBadge(pendingCount);
```

Add this right after `allPainters = data.painters;` in `loadPainters` as well (for the pending approval badge on Finance — actually that's on Painters group). Add a `updatePendingBadge` call after `renderPagination`:

```javascript
            const pendingApprovalCount = data.painters.filter(p => p.status === 'pending').length;
            const pb = document.getElementById('pendingBadge');
            if (pb) { if (pendingApprovalCount > 0) { pb.textContent = pendingApprovalCount; pb.style.display = 'inline'; } else pb.style.display = 'none'; }
```

(The `pendingBadge` span still exists in the sub-tab button text area — keep it there for the Painters sub-tab.)

- [ ] **Step 5: Test on mobile viewport**

In Chrome DevTools, set viewport to 375px. Open Painters tab. Confirm:
- Mobile cards show with avatar circles, level color rings, "Edit / View" + "Points ±" buttons
- Desktop table hidden on mobile viewport
- Filter pills row scrolls horizontally without wrapping

- [ ] **Step 6: Commit**

```bash
git add public/admin-painters.html
git commit -m "feat(painters-ui): hybrid mobile cards + desktop table for Painters tab"
```

---

## Task 4: Finance Group — Mobile Withdrawals Cards + Summary Strip

**Files:**
- Modify: `public/admin-painters.html` (tab-withdrawals HTML ~lines 319-339, `loadWithdrawals()` ~line 2127)

### Context
Withdrawals currently renders a desktop-only table. We add: (1) summary strip above the filters showing `Pending: ₹X · This Month Paid: ₹Y`, (2) mobile card list alongside the existing table.

- [ ] **Step 1: Replace the tab-withdrawals HTML**

Find `<div id="tab-withdrawals" class="tab-content">` (line ~319) and replace its entire contents (up to the closing `</div>`) with:

```html
            <div id="tab-withdrawals" class="tab-content">
                <!-- Summary Strip -->
                <div class="summary-strip" id="withdrawalSummaryStrip">
                    <span>Pending: <strong id="wdPendingTotal">—</strong></span>
                    <span>This Month Paid: <strong id="wdMonthPaid">—</strong></span>
                </div>
                <!-- Filters -->
                <div class="bg-white rounded-xl border border-gray-200 p-3 mb-3 flex gap-2 overflow-x-auto" style="scrollbar-width:none;">
                    <select id="withdrawalStatusFilter" class="shrink-0 px-3 py-2 border border-gray-300 rounded-full text-sm bg-white" onchange="loadWithdrawals()">
                        <option value="">All Status</option>
                        <option value="pending" selected>Pending</option>
                        <option value="approved">Approved</option>
                        <option value="rejected">Rejected</option>
                        <option value="paid">Paid</option>
                    </select>
                    <select id="withdrawalTypeFilter" class="shrink-0 px-3 py-2 border border-gray-300 rounded-full text-sm bg-white" onchange="loadWithdrawals()">
                        <option value="">All Types</option>
                        <option value="regular">Regular</option>
                        <option value="annual">Annual</option>
                    </select>
                </div>
                <!-- Mobile Cards -->
                <div id="withdrawalsMobileList" class="md:hidden"></div>
                <!-- Desktop Table -->
                <div class="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div class="overflow-x-auto">
                        <table class="data-table">
                            <thead>
                                <tr><th>Painter</th><th>Phone</th><th>Pool</th><th>Amount</th><th>Status</th><th>Requested</th><th>Actions</th></tr>
                            </thead>
                            <tbody id="withdrawalsTableBody"><tr><td colspan="7" class="text-center py-4 text-gray-400">Loading…</td></tr></tbody>
                        </table>
                    </div>
                </div>
            </div>
```

- [ ] **Step 2: Update `loadWithdrawals()` to populate mobile cards + summary strip**

Find `async function loadWithdrawals() {` (~line 2127). Replace the entire function body with:

```javascript
    async function loadWithdrawals() {
        const status = document.getElementById('withdrawalStatusFilter').value;
        const poolType = document.getElementById('withdrawalTypeFilter')?.value || '';
        try {
            const params = new URLSearchParams({ limit: 100 });
            if (status) params.set('status', status);
            if (poolType) params.set('pool', poolType);
            const res = await fetch(`${API}/withdrawals?${params}`, { headers: authHeaders() });
            const data = await res.json();
            const withdrawals = data.withdrawals || [];

            // Summary strip
            const pending = withdrawals.filter(w => w.status === 'pending');
            const pendingTotal = pending.reduce((s,w) => s + parseFloat(w.amount||0), 0);
            const now = new Date();
            const monthPaid = withdrawals.filter(w => w.status === 'paid' && new Date(w.requested_at).getMonth() === now.getMonth()).reduce((s,w) => s + parseFloat(w.amount||0), 0);
            const el1 = document.getElementById('wdPendingTotal');
            const el2 = document.getElementById('wdMonthPaid');
            if (el1) el1.textContent = '₹' + pendingTotal.toLocaleString('en-IN');
            if (el2) el2.textContent = '₹' + monthPaid.toLocaleString('en-IN');
            updateFinanceBadge(pending.length);

            const statusColors = { pending:'#fef3c7|#92400e', approved:'#d1fae5|#065f46', rejected:'#fee2e2|#991b1b', paid:'#dbeafe|#1e40af' };

            if (!withdrawals.length) {
                const msg = '<div class="empty-state"><p>No withdrawals found</p></div>';
                const mob = document.getElementById('withdrawalsMobileList');
                if (mob) mob.innerHTML = msg;
                document.getElementById('withdrawalsTableBody').innerHTML = '<tr><td colspan="7" class="text-center py-4 text-gray-400">No withdrawals found</td></tr>';
                return;
            }

            // Mobile cards
            const mobEl = document.getElementById('withdrawalsMobileList');
            if (mobEl) {
                mobEl.innerHTML = withdrawals.map(w => {
                    const [sbg, scolor] = (statusColors[w.status]||'#e2e8f0|#475569').split('|');
                    return `
                    <div class="withdrawal-card">
                        <div class="withdrawal-card-header">
                            <div>
                                <div style="font-weight:600;font-size:0.9375rem;">${esc(w.full_name)}</div>
                                <div style="font-size:0.8rem;color:#64748b;">${esc(w.phone||'')} · ${new Date(w.requested_at).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</div>
                                ${w.notes ? `<div style="font-size:0.8rem;color:#64748b;font-style:italic;margin-top:2px;">"${esc(w.notes)}"</div>` : ''}
                            </div>
                            <div style="text-align:right;">
                                <div style="font-weight:700;font-size:1rem;">₹${parseFloat(w.amount).toLocaleString('en-IN')}</div>
                                <div style="font-size:0.78rem;color:#64748b;text-transform:capitalize;">${w.pool}</div>
                                <span class="badge mt-1" style="background:${sbg};color:${scolor};">${w.status}</span>
                            </div>
                        </div>
                        ${w.status === 'pending' ? `
                        <div class="withdrawal-card-actions">
                            <button onclick="processWithdrawal(${w.id},'reject')" class="btn-sm" style="background:#fee2e2;color:#991b1b;border:none;border-radius:0.5rem;min-height:40px;">Reject</button>
                            <button onclick="processWithdrawal(${w.id},'approve')" class="btn-sm btn-success" style="border-radius:0.5rem;min-height:40px;">Approve</button>
                        </div>` : w.status === 'approved' ? `
                        <div style="margin-top:0.5rem;">
                            <button onclick="processWithdrawal(${w.id},'paid')" class="btn-sm btn-primary w-full" style="min-height:40px;">Mark Paid</button>
                        </div>` : ''}
                    </div>`;
                }).join('');
            }

            // Desktop table
            document.getElementById('withdrawalsTableBody').innerHTML = withdrawals.map(w => `
                <tr>
                    <td class="font-medium">${esc(w.full_name)}</td>
                    <td>${esc(w.phone)}</td>
                    <td class="capitalize">${w.pool}</td>
                    <td class="font-semibold">${parseFloat(w.amount).toFixed(2)}</td>
                    <td><span class="badge badge-${w.status}">${w.status}</span></td>
                    <td>${new Date(w.requested_at).toLocaleDateString()}</td>
                    <td>
                        ${w.status === 'pending' ? `
                            <button onclick="processWithdrawal(${w.id}, 'approve')" class="btn-sm btn-success mr-1">Approve</button>
                            <button onclick="processWithdrawal(${w.id}, 'reject')" class="btn-sm btn-danger">Reject</button>
                        ` : w.status === 'approved' ? `
                            <button onclick="processWithdrawal(${w.id}, 'paid')" class="btn-sm btn-primary">Mark Paid</button>
                        ` : '-'}
                    </td>
                </tr>
            `).join('');
        } catch (err) {
            const errMsg = `<tr><td colspan="7" class="text-center py-4 text-red-500">${err.message}</td></tr>`;
            document.getElementById('withdrawalsTableBody').innerHTML = errMsg;
        }
    }
```

- [ ] **Step 3: Verify withdrawal cards on mobile**

Set DevTools to 375px. Navigate to Finance → Withdrawals. Confirm:
- Summary strip shows "Pending: ₹X · This Month Paid: ₹Y"
- Mobile cards show painter name, amount, pool type, Reject/Approve buttons
- Finance group tab shows red badge with pending count if >0

- [ ] **Step 4: Commit**

```bash
git add public/admin-painters.html
git commit -m "feat(painters-ui): Finance group - withdrawal mobile cards + summary strip"
```

---

## Task 5: Painters Tab HTML — Filter bar + Estimates + Billing responsive

**Files:**
- Modify: `public/admin-painters.html` (tab-estimates HTML ~lines 366-416, tab-points HTML ~lines 156-226)

### Context
Estimates tab has a table. We wrap it to add a mobile card list. Billing (points) tab gets overflow-x-auto on its tables so they scroll on mobile.

- [ ] **Step 1: Make estimates tab render mobile cards**

Find `<div id="tab-estimates" class="tab-content">` (~line 366). After the existing filter row `<div class="bg-white rounded-xl border border-gray-200 p-4 mb-4">...</div>`, find the `<table>` wrapper and replace it with a structure that has both a mobile list div and a desktop table:

Find this block (~line 415-416):
```html
                <div class="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div class="overflow-x-auto">
```

Replace the entire estimates table wrapper (ending at `</div></div>` after the tbody) with:

```html
                <!-- Mobile estimate cards -->
                <div id="estimatesMobileList" class="md:hidden"></div>
                <!-- Desktop table -->
                <div class="hidden md:block bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div class="overflow-x-auto">
```

(Keep the existing `<table>`, `<thead>`, `<tbody id="estimatesTableBody">` and closing tags intact, just wrap in the responsive structure.)

- [ ] **Step 2: Update `renderEstimates()` or `loadEstimates()` to also populate mobile cards**

Find `async function loadEstimates(page = 1)` (~line 2282) and find where `estimatesTableBody` is populated. After the `document.getElementById('estimatesTableBody').innerHTML = ...` assignment, add:

```javascript
            const STATUS_CTA = {
                pending_admin: ['Review', 'btn-primary'],
                admin_review: ['Add Markup', 'btn-primary'],
                payment_submitted: ['Confirm Payment', 'btn-success'],
                pushed_to_zoho: [null, null],
            };
            const mobEl = document.getElementById('estimatesMobileList');
            if (mobEl && data.estimates) {
                const estStatusColors = { draft:'#f1f5f9|#475569', pending_admin:'#fef3c7|#92400e', admin_review:'#fef3c7|#b45309', approved:'#d1fae5|#065f46', sent_to_customer:'#dbeafe|#1e40af', discount_requested:'#fef3c7|#92400e', final_approved:'#d1fae5|#065f46', payment_submitted:'#ede9fe|#5b21b6', payment_recorded:'#d1fae5|#065f46', pushed_to_zoho:'#f0fdf4|#166534' };
                mobEl.innerHTML = (data.estimates||[]).map(e => {
                    const [sbg, scolor] = (estStatusColors[e.status]||'#e2e8f0|#475569').split('|');
                    const cta = STATUS_CTA[e.status];
                    return `
                    <div class="painter-card" onclick="viewEstimate(${e.id})">
                        <div class="flex justify-between items-start">
                            <div>
                                <div style="font-weight:600;">${esc(e.estimate_number||'#'+e.id)}</div>
                                <div style="font-size:0.8rem;color:#64748b;">${esc(e.painter_name||'')} · ${new Date(e.created_at).toLocaleDateString('en-IN',{day:'numeric',month:'short'})}</div>
                                <div style="font-size:0.8rem;color:#64748b;text-transform:capitalize;">${(e.billing_type||'').replace('_',' ')}</div>
                            </div>
                            <div style="text-align:right;">
                                <div style="font-weight:700;">₹${parseFloat(e.final_total||e.total||0).toLocaleString('en-IN')}</div>
                                <span class="badge mt-1" style="background:${sbg};color:${scolor};font-size:0.68rem;">${(e.status||'').replace(/_/g,' ')}</span>
                            </div>
                        </div>
                        ${cta && cta[0] ? `<div style="margin-top:0.625rem;"><button onclick="event.stopPropagation();viewEstimate(${e.id})" class="btn-sm ${cta[1]} w-full" style="min-height:40px;">${cta[0]}</button></div>` : ''}
                    </div>`;
                }).join('') || '<div class="empty-state"><p>No estimates found</p></div>';
            }
```

- [ ] **Step 3: Make billing (points) tab tables scroll horizontally on mobile**

Find `<div id="tab-points" class="tab-content">` (~line 156). For every `<table>` inside this tab that is NOT already wrapped in `overflow-x-auto`, add `overflow-x-auto` to its wrapper div. The existing structure already uses `<div class="overflow-x-auto">` in some places — verify all tables have this wrapper. Where missing, add a wrapping `<div class="overflow-x-auto">...</div>`.

Also ensure the grid `grid-cols-1 md:grid-cols-3` and `grid-cols-1 md:grid-cols-4` classes are already present on the form rows (they are — verify and leave them).

- [ ] **Step 4: Commit**

```bash
git add public/admin-painters.html
git commit -m "feat(painters-ui): estimates mobile cards + billing tab responsive tables"
```

---

## Task 6: Catalog, Comms Groups + Final Polish

**Files:**
- Modify: `public/admin-painters.html`

### Context
Catalog and Comms group tabs need mobile-responsive treatment. Attendance gets a summary strip. Marketing and Notifications need overflow-x-auto on their tables. Final CSS touches ensure touch targets, sticky z-indices, and FAB positioning.

- [ ] **Step 1: Attendance tab — add summary strip + mobile-responsive layout**

Find `<div id="tab-attendance" class="tab-content">` (~line 1023). Before the existing sub-tab buttons, add:

```html
        <div class="summary-strip" id="attSummaryStrip" style="display:none;">
            <span>In: <strong id="attCountIn">0</strong></span>
            <span>Out: <strong id="attCountOut">0</strong></span>
            <span>Away: <strong id="attCountAway">0</strong></span>
        </div>
```

Then find the attendance table wrapper `<div class="bg-white rounded-xl border border-gray-200 overflow-x-auto">` (inside `att-sub-today`) and add `overflow-x-auto` if not already present (it is). Also add a mobile card list before the desktop table:

```html
            <!-- Mobile attendance cards -->
            <div id="attMobileList" class="md:hidden mb-2"></div>
```

Update `loadAttendanceToday()` (find it ~line in the attendance section): after populating `att-today-tbody`, also populate `attMobileList`:

```javascript
            const attMob = document.getElementById('attMobileList');
            const strip = document.getElementById('attSummaryStrip');
            if (strip) strip.style.display = 'flex';
            if (attMob) {
                attMob.innerHTML = (data.records||[]).map(r => `
                <div class="painter-card">
                    <div class="flex items-center gap-3">
                        <div style="width:10px;height:10px;border-radius:50%;background:${r.status==='present'?'#10b981':'#94a3b8'};flex-shrink:0;"></div>
                        <div class="flex-1">
                            <div style="font-weight:600;">${esc(r.painter_name||r.full_name||'')}</div>
                            <div style="font-size:0.8rem;color:#64748b;">${esc(r.branch_name||'')} · ${r.check_in_time ? new Date(r.check_in_time).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit'}) : '-'}</div>
                            <div style="font-size:0.78rem;color:#94a3b8;">${r.distance_from_branch ? r.distance_from_branch + 'm from branch' : ''}</div>
                        </div>
                        <span class="badge" style="background:${r.status==='present'?'#d1fae5':'#e2e8f0'};color:${r.status==='present'?'#065f46':'#475569'};">${r.status||'absent'}</span>
                    </div>
                </div>`).join('') || '<div class="empty-state"><p>No records</p></div>';
                const pIn = (data.records||[]).filter(r=>r.status==='present').length;
                const elIn = document.getElementById('attCountIn');
                if (elIn) elIn.textContent = pIn;
            }
```

- [ ] **Step 2: Catalog tab — add "Manage Products →" link and make it responsive**

Find `<div id="tab-catalog" class="tab-content">` (~line 696). At the top of its content (before the first child div), add:

```html
                <div class="flex justify-end mb-3">
                    <a href="/admin-products.html" target="_blank" class="btn-sm btn-outline">Manage Products →</a>
                </div>
```

Then ensure all tables within `tab-catalog` have `overflow-x-auto` wrappers. Find `<div class="overflow-x-auto">` wrappers — if any table lacks one, add it.

- [ ] **Step 3: Make offers tab have FAB-style "New Offer" button**

Find `<div id="tab-offers" class="tab-content">` (~line 417). Find the existing "Add Offer" button (it may be inside a header row). Replace it with:

```html
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-lg font-semibold text-gray-800">Special Offers</h3>
                    <button onclick="showAddOfferModal()" class="btn-sm btn-primary flex items-center gap-1">
                        <span style="font-size:1.1rem;line-height:1;">+</span> New Offer
                    </button>
                </div>
```

Also add a sticky FAB for mobile at the bottom-right:

```html
                <!-- Mobile FAB -->
                <button onclick="showAddOfferModal()" class="md:hidden" style="position:fixed;bottom:1.25rem;right:1.25rem;width:56px;height:56px;border-radius:9999px;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;border:none;font-size:1.5rem;box-shadow:0 4px 16px rgba(102,126,234,0.4);cursor:pointer;z-index:30;display:flex;align-items:center;justify-content:center;" aria-label="New Offer">+</button>
```

Place this button just before the closing `</div>` of `tab-offers`.

- [ ] **Step 4: Make overrides (Points Config) form mobile-friendly**

Find `<div id="tab-overrides" class="tab-content">` (~line 535). Ensure all `<div class="grid grid-cols-...">` inside use `grid-cols-1 md:grid-cols-2` or `grid-cols-1 md:grid-cols-3` patterns. Wrap any bare `<table>` in `<div class="overflow-x-auto">`. Check that the Save Config button has `class="w-full md:w-auto"`.

- [ ] **Step 5: Make marketing and notifications tabs responsive**

For `tab-marketing` (~line 777): all tables should have `overflow-x-auto` wrappers. The lead panel slide-out (`#mktLeadPanel`) already has the `@media (max-width:767px)` bottom-sheet CSS from the original file — verify it's still there.

For `tab-notifications` (~line 1073): ensure the compose form uses `class="w-full"` on its inputs and the history table has `overflow-x-auto`.

- [ ] **Step 6: Final touch-target audit**

Search for all `btn-sm` buttons that are action buttons (Approve, Reject, View, Edit, etc.) and ensure they have at least `min-height:36px` via the existing `.btn-sm` class. The `.btn-sm` CSS is: `padding: 0.375rem 0.75rem`. This gives ~32px height — acceptable as a secondary action. Primary card-level actions already have `min-height:40px` in Task 4. No changes needed.

- [ ] **Step 7: Test full mobile flow**

In Chrome DevTools at 375px:
1. Open Painters group → Painters tab: see avatar cards, search bar, filter pills
2. Switch to Finance → Withdrawals: see summary strip + withdrawal cards + Finance badge
3. Switch to Catalog → Offers: see the fixed FAB "+" in bottom-right corner
4. Switch to Comms → Attendance: see summary strip
5. Resize to desktop (1200px): see all tables with column headers, FAB hidden (`md:hidden`)

- [ ] **Step 8: Commit**

```bash
git add public/admin-painters.html
git commit -m "feat(painters-ui): Catalog+Comms responsive, offers FAB, attendance summary strip"
```

---

## Task 7: Deploy + Verify on Production

**Files:**
- No file changes

- [ ] **Step 1: Deploy to production server**

```bash
ssh root@161.97.114.189 "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && pm2 restart business-manager"
```

Expected output: `[PM2] Restarting process...` followed by `online`.

- [ ] **Step 2: Verify page loads on production**

Open `https://act.qcpaintshop.com/admin-painters.html` on a mobile device or Chrome DevTools 375px. Confirm:
- Group strip shows 4 buttons
- Sub-tab strip scrolls horizontally
- Painters tab shows cards on mobile
- No JS console errors
- Finance → Withdrawals shows summary strip

- [ ] **Step 3: Final commit tag**

```bash
git tag painters-ui-v2-$(date +%Y%m%d)
```
