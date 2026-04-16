# Painter Marketing Admin — All Leads + Slide Panel + WhatsApp Send

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add All Leads view, lead slide-out panel (branch assign + manual staff assign + WhatsApp send + contact history) to the Painter Marketing admin tab.

**Architecture:** Three new backend endpoints added to `routes/painter-marketing.js`. WhatsApp send wired via existing `whatsapp-session-manager` (same pattern as `routes/painters.js` OTP). Frontend adds one new subtab + a slide panel in `public/admin-painters.html` — no new files needed.

**Tech Stack:** Express.js, MySQL/MariaDB, vanilla JS, Tailwind CSS, existing `whatsapp-session-manager` service.

---

## File Map

| File | Change |
|------|--------|
| `routes/painter-marketing.js` | Add `setSessionManager`, 5 new endpoints |
| `server.js` | Wire `setSessionManager` after existing `setPool` call |
| `public/admin-painters.html` | New subtab button, new subtab HTML pane, slide panel HTML, ~200 lines JS |

---

## Task 1: Backend — All Leads List + Assign + History endpoints

**Files:**
- Modify: `routes/painter-marketing.js`

- [ ] **Step 1: Add `setSessionManager` wiring at top of file**

Open `routes/painter-marketing.js`. After line 16 (`function setPool(p) { pool = p; }`), add:

```js
let sessionManager;
function setSessionManager(sm) { sessionManager = sm; }
```

And update the module exports at the bottom of the file from:
```js
module.exports = { router, setPool };
```
to:
```js
module.exports = { router, setPool, setSessionManager };
```

- [ ] **Step 2: Add `GET /admin/leads` endpoint**

Add after line 200 (after the existing `/admin/queues/unassigned/assign` endpoint):

```js
// All leads — filterable by branch, status, search
router.get('/admin/leads', requirePermission('painters', 'marketing_view'), async (req, res) => {
    try {
        const { branch_id, status, search, page = 1, limit = 50 } = req.query;
        const offset = (Number(page) - 1) * Number(limit);
        const conditions = [];
        const params = [];

        if (branch_id === 'unassigned') {
            conditions.push('pl.branch_id IS NULL');
        } else if (branch_id) {
            conditions.push('pl.branch_id = ?');
            params.push(Number(branch_id));
        }
        if (status) {
            conditions.push('pl.status = ?');
            params.push(status);
        }
        if (search) {
            conditions.push('(pl.full_name LIKE ? OR pl.phone LIKE ?)');
            params.push(`%${search}%`, `%${search}%`);
        }

        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

        const [leads] = await pool.query(
            `SELECT pl.id, pl.full_name, pl.phone, pl.branch_id, pl.status,
                    pl.total_attempts, pl.last_contact_date, pl.imported_at,
                    b.name AS branch_name,
                    u.full_name AS staff_name, pl.assigned_to
             FROM painter_leads pl
             LEFT JOIN branches b ON b.id = pl.branch_id
             LEFT JOIN users u ON u.id = pl.assigned_to
             ${where}
             ORDER BY pl.imported_at DESC
             LIMIT ? OFFSET ?`,
            [...params, Number(limit), offset]
        );

        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) AS total FROM painter_leads pl ${where}`,
            params
        );
        const [[{ unassigned_count }]] = await pool.query(
            `SELECT COUNT(*) AS unassigned_count FROM painter_leads WHERE branch_id IS NULL`
        );

        res.json({ success: true, leads, total, unassigned_count });
    } catch (err) {
        console.error('[admin/leads]', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
```

- [ ] **Step 3: Add `PUT /admin/leads/:id/assign` endpoint**

```js
// Assign branch + staff to a lead
router.put('/admin/leads/:id/assign', requirePermission('painters', 'marketing_manage'), async (req, res) => {
    try {
        const leadId = Number(req.params.id);
        const { branch_id, assigned_to } = req.body;
        if (!branch_id) return res.status(400).json({ success: false, error: 'branch_id required' });

        let staffId = assigned_to || null;
        // Auto assign: pick staff with fewest leads in branch
        if (!staffId) {
            await assignNewLead(pool, leadId, branch_id);
            const [[updated]] = await pool.query(
                `SELECT pl.assigned_to, u.full_name AS staff_name
                 FROM painter_leads pl LEFT JOIN users u ON u.id = pl.assigned_to
                 WHERE pl.id = ?`, [leadId]
            );
            return res.json({ success: true, assigned_to: updated.assigned_to, staff_name: updated.staff_name });
        }

        await pool.query(
            `UPDATE painter_leads SET branch_id = ?, assigned_to = ?, branch_detected_via = 'admin_assign' WHERE id = ?`,
            [branch_id, staffId, leadId]
        );
        const [[{ staff_name }]] = await pool.query(`SELECT full_name AS staff_name FROM users WHERE id = ?`, [staffId]);
        res.json({ success: true, assigned_to: staffId, staff_name });
    } catch (err) {
        console.error('[admin/leads/assign]', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
```

- [ ] **Step 4: Add `GET /admin/leads/:id/history` endpoint**

```js
// Contact history for a lead
router.get('/admin/leads/:id/history', requirePermission('painters', 'marketing_view'), async (req, res) => {
    try {
        const [history] = await pool.query(
            `SELECT plf.followup_type, plf.call_status, plf.outcome, plf.notes, plf.created_at,
                    u.full_name AS staff_name
             FROM painter_lead_followups plf
             LEFT JOIN users u ON u.id = plf.user_id
             WHERE plf.painter_lead_id = ?
             ORDER BY plf.created_at DESC`,
            [Number(req.params.id)]
        );
        res.json({ success: true, history });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
```

- [ ] **Step 5: Add `GET /admin/branches/:branch_id/staff` endpoint**

```js
// Staff with marketing_contact permission in a branch
router.get('/admin/branches/:branch_id/staff', requirePermission('painters', 'marketing_manage'), async (req, res) => {
    try {
        const [staff] = await pool.query(
            `SELECT DISTINCT u.id, u.full_name
             FROM users u
             JOIN user_roles ur ON ur.user_id = u.id
             JOIN role_permissions rp ON rp.role_id = ur.role_id
             WHERE rp.module = 'painters' AND rp.action = 'marketing_contact'
               AND u.branch_id = ? AND u.status = 'active'
             ORDER BY u.full_name`,
            [Number(req.params.id)]
        );
        res.json({ success: true, staff });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});
```

- [ ] **Step 6: Add `POST /admin/leads/:id/send-wa` endpoint**

```js
// Send WhatsApp message to a lead (admin-initiated)
router.post('/admin/leads/:id/send-wa', requirePermission('painters', 'marketing_manage'), async (req, res) => {
    try {
        const leadId = Number(req.params.id);
        const { message } = req.body;
        if (!message || !message.trim()) return res.status(400).json({ success: false, error: 'message required' });

        const [[lead]] = await pool.query(`SELECT phone, full_name FROM painter_leads WHERE id = ?`, [leadId]);
        if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

        // Normalize phone to 91XXXXXXXXXX format for WhatsApp
        const digits = String(lead.phone).replace(/\D/g, '');
        let waPhone = digits;
        if (digits.length === 10) waPhone = '91' + digits;
        else if (digits.length === 12 && digits.startsWith('91')) waPhone = digits;
        else return res.status(400).json({ success: false, error: 'Invalid phone number' });

        if (!sessionManager) return res.status(503).json({ success: false, error: 'WhatsApp session not available' });

        await sessionManager.sendMessage(0, waPhone + '@c.us', message, { source: 'painter_marketing_admin' });

        // Log to painter_lead_followups
        await pool.query(
            `INSERT INTO painter_lead_followups (painter_lead_id, user_id, followup_type, outcome, notes)
             VALUES (?, ?, 'whatsapp', 'message_sent', ?)`,
            [leadId, req.user.id, message]
        );

        // Update last_contact_date
        await pool.query(
            `UPDATE painter_leads SET last_contact_date = NOW(), total_attempts = total_attempts + 1 WHERE id = ?`,
            [leadId]
        );

        res.json({ success: true });
    } catch (err) {
        console.error('[admin/send-wa]', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
```

- [ ] **Step 7: Commit**

```bash
git add routes/painter-marketing.js
git commit -m "feat(pntr): 5 new admin endpoints — leads list, assign, history, staff, send-wa"
```

---

## Task 2: Wire sessionManager in server.js

**Files:**
- Modify: `server.js` (around line 224 where `painterMarketingRoutes.setPool(pool)` is called)

- [ ] **Step 1: Find the wiring block and add setSessionManager**

In `server.js`, find the block (around line 224):
```js
painterMarketingRoutes.setPool(pool);
```

Add immediately after:
```js
if (typeof painterMarketingRoutes.setSessionManager === 'function') {
    painterMarketingRoutes.setSessionManager(sessionManager);
}
```

(Note: `sessionManager` is already in scope here — it is used for other routes like `painters.js`)

- [ ] **Step 2: Commit**

```bash
git add server.js
git commit -m "feat(pntr): wire sessionManager into painter-marketing routes"
```

---

## Task 3: Frontend HTML — All Leads subtab + Slide Panel

**Files:**
- Modify: `public/admin-painters.html`

- [ ] **Step 1: Add "All Leads" subtab button**

Find the marketing subtab bar (around line 665):
```html
<button class="mkt-subtab px-3 py-1.5 text-sm rounded-lg hover:bg-gray-100" data-sub="unassigned">Branch Unassigned</button>
```

Insert **before** it:
```html
<button class="mkt-subtab px-3 py-1.5 text-sm rounded-lg hover:bg-gray-100" data-sub="all-leads">All Leads</button>
```

- [ ] **Step 2: Add All Leads subtab HTML pane**

Find the `<!-- Tab 11: Marketing -->` section. Find the first `<!-- Sub: Unassigned -->` comment (around line 674). Insert this **before** it:

```html
<!-- Sub: All Leads -->
<div class="mkt-sub hidden" data-pane="all-leads">
    <div class="flex flex-wrap gap-2 mb-3 items-center">
        <select id="mktAlBranch" class="px-3 py-1.5 border rounded-lg text-sm bg-white">
            <option value="">All Branches</option>
        </select>
        <select id="mktAlStatus" class="px-3 py-1.5 border rounded-lg text-sm bg-white">
            <option value="">All Status</option>
            <option value="new">New</option>
            <option value="in_progress">In Progress</option>
            <option value="interested">Interested</option>
            <option value="converted">Converted</option>
            <option value="not_interested">Not Interested</option>
            <option value="unreachable">Unreachable</option>
        </select>
        <input id="mktAlSearch" type="text" placeholder="Search name or phone…" class="px-3 py-1.5 border rounded-lg text-sm flex-1 min-w-32">
        <span id="mktAlCount" class="text-xs text-gray-500"></span>
        <span id="mktAlUnassignedBadge" class="hidden text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-semibold"></span>
    </div>
    <div class="overflow-x-auto rounded-lg border border-gray-200">
        <table class="w-full text-sm">
            <thead class="bg-gray-50 text-left text-xs uppercase tracking-wide">
                <tr>
                    <th class="p-2 w-8"><input type="checkbox" id="mktAlChkAll"></th>
                    <th class="p-2">Name</th>
                    <th class="p-2 hidden sm:table-cell">Phone</th>
                    <th class="p-2 hidden md:table-cell">Branch</th>
                    <th class="p-2 hidden md:table-cell">Staff</th>
                    <th class="p-2">Status</th>
                    <th class="p-2 hidden lg:table-cell">Last Contact</th>
                </tr>
            </thead>
            <tbody id="mktAlBody"></tbody>
        </table>
    </div>
    <div class="flex gap-2 mt-3 flex-wrap items-center">
        <select id="mktAlBulkBranch" class="px-3 py-1.5 border rounded-lg text-sm bg-white">
            <option value="">Bulk: Choose branch…</option>
        </select>
        <select id="mktAlBulkStaff" class="px-3 py-1.5 border rounded-lg text-sm bg-white">
            <option value="">Auto assign staff</option>
        </select>
        <button onclick="mktAlBulkAssign()" class="px-3 py-1.5 bg-green-700 text-white rounded-lg text-sm font-semibold">Apply to Selected</button>
        <div id="mktAlPagination" class="ml-auto flex gap-1"></div>
    </div>
</div>
```

- [ ] **Step 3: Add Slide Panel HTML**

Find the closing `</div>` of `<div id="tab-marketing" class="tab-content">` (it's the last `</div>` that closes the white card containing all subtabs). Insert this **inside** `tab-marketing` but **after** the main card closing tag:

```html
<!-- Lead Slide Panel -->
<div id="mktLeadPanel" class="hidden fixed top-0 right-0 h-full w-full sm:w-96 bg-white shadow-2xl border-l border-gray-200 z-50 flex flex-col overflow-hidden">
    <div class="flex items-start justify-between p-4 border-b border-gray-200">
        <div>
            <div id="mktPanelName" class="text-base font-bold text-gray-900"></div>
            <div id="mktPanelPhone" class="text-xs text-gray-500 mt-0.5"></div>
        </div>
        <button onclick="closeMktPanel()" class="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded px-2 py-1 text-lg leading-none">✕</button>
    </div>
    <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-5">

        <!-- Info grid -->
        <div>
            <div class="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">Lead Info</div>
            <div class="grid grid-cols-2 gap-2">
                <div class="bg-gray-50 rounded-lg p-2">
                    <div id="mktPanelBranchVal" class="text-sm font-semibold text-gray-900">—</div>
                    <div class="text-xs text-gray-400 mt-0.5">Branch</div>
                </div>
                <div class="bg-gray-50 rounded-lg p-2">
                    <div id="mktPanelStaffVal" class="text-sm font-semibold text-gray-900">—</div>
                    <div class="text-xs text-gray-400 mt-0.5">Assigned Staff</div>
                </div>
                <div class="bg-gray-50 rounded-lg p-2">
                    <div id="mktPanelCallsVal" class="text-sm font-semibold text-gray-900">0</div>
                    <div class="text-xs text-gray-400 mt-0.5">Total Contacts</div>
                </div>
                <div class="bg-gray-50 rounded-lg p-2">
                    <div id="mktPanelLastVal" class="text-sm font-semibold text-gray-900">Never</div>
                    <div class="text-xs text-gray-400 mt-0.5">Last Contact</div>
                </div>
            </div>
        </div>

        <!-- Assign -->
        <div>
            <div class="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">Assign Branch & Staff</div>
            <select id="mktPanelBranchSel" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-2 bg-white">
                <option value="">Choose branch…</option>
            </select>
            <div class="flex gap-2">
                <select id="mktPanelStaffSel" class="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white">
                    <option value="">— Auto assign —</option>
                </select>
                <button onclick="savePanelAssign()" class="px-3 py-2 bg-green-700 text-white rounded-lg text-sm font-semibold hover:bg-green-800">Save</button>
            </div>
            <p class="text-xs text-gray-400 mt-1">Auto assign = picks staff with fewest leads in branch</p>
        </div>

        <!-- WhatsApp -->
        <div>
            <div class="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">WhatsApp Message</div>
            <div class="flex flex-wrap gap-1.5 mb-2" id="mktWaChips">
                <button class="mkt-wa-chip text-xs px-3 py-1 rounded-full bg-gray-100 border border-gray-200 hover:bg-green-50 hover:border-green-300 active" data-tpl="welcome">PNTR Welcome</button>
                <button class="mkt-wa-chip text-xs px-3 py-1 rounded-full bg-gray-100 border border-gray-200 hover:bg-green-50 hover:border-green-300" data-tpl="points">Points Info</button>
                <button class="mkt-wa-chip text-xs px-3 py-1 rounded-full bg-gray-100 border border-gray-200 hover:bg-green-50 hover:border-green-300" data-tpl="register">Register Link</button>
                <button class="mkt-wa-chip text-xs px-3 py-1 rounded-full bg-gray-100 border border-gray-200 hover:bg-green-50 hover:border-green-300" data-tpl="custom">Custom…</button>
            </div>
            <textarea id="mktWaMsg" rows="4" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:border-green-600"></textarea>
            <div class="flex gap-2 mt-2">
                <button onclick="sendMktWa()" class="flex-1 px-3 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-semibold">📱 Send WhatsApp</button>
            </div>
            <div id="mktWaStatus" class="text-xs mt-1 text-gray-500"></div>
        </div>

        <!-- History -->
        <div>
            <div class="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">Contact History</div>
            <div id="mktPanelHistory" class="flex flex-col gap-2 text-sm"></div>
        </div>

    </div>
</div>
<div id="mktPanelOverlay" class="hidden fixed inset-0 bg-black bg-opacity-20 z-40" onclick="closeMktPanel()"></div>
```

- [ ] **Step 4: Commit**

```bash
git add public/admin-painters.html
git commit -m "feat(pntr): add All Leads subtab HTML + slide panel HTML"
```

---

## Task 4: Frontend JavaScript — All Leads + Slide Panel logic

**Files:**
- Modify: `public/admin-painters.html` (JS section, after existing `loadMktBranches` function ~line 3057)

- [ ] **Step 1: Add WA templates constant + helper functions**

Find the `async function loadMktBranches()` function. Add these constants and helpers **just before** it (around line 3044):

```js
// ─── All Leads subtab ───
const MKT_AL_TEMPLATES = {
    welcome: name => `${name} அவர்களே, QC Colour Painter Program-ல் உங்களை அழைக்கிறோம். Points சம்பாதித்து பரிசுகள் வெல்லுங்கள். App Download: https://play.google.com/store/apps/details?id=com.qcpaintshop.painter`,
    points:  name => `${name} அவர்களே, ஒவ்வொரு purchase-க்கும் Loyalty Points கிடைக்கும். அதை திரும்ப பணமாக பெறலாம். App: https://play.google.com/store/apps/details?id=com.qcpaintshop.painter`,
    register: ()   => `QC Painter App: https://play.google.com/store/apps/details?id=com.qcpaintshop.painter`,
    custom:   ()   => ''
};

const MKT_STATUS_LABELS = {
    new: '<span class="px-2 py-0.5 rounded-full text-xs bg-blue-50 text-blue-700">New</span>',
    in_progress: '<span class="px-2 py-0.5 rounded-full text-xs bg-orange-50 text-orange-700">In Progress</span>',
    interested: '<span class="px-2 py-0.5 rounded-full text-xs bg-green-50 text-green-700">Interested</span>',
    converted: '<span class="px-2 py-0.5 rounded-full text-xs bg-green-100 text-green-800 font-bold">Converted ✓</span>',
    not_interested: '<span class="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500">Not Interested</span>',
    unreachable: '<span class="px-2 py-0.5 rounded-full text-xs bg-red-50 text-red-600">Unreachable</span>'
};

let mktAlPage = 1;
let mktAlCurrentLead = null; // { id, full_name, phone, branch_id, assigned_to }
```

- [ ] **Step 2: Add loadAllLeads function**

```js
async function loadAllLeads(page = 1) {
    mktAlPage = page;
    const branch_id = document.getElementById('mktAlBranch').value;
    const status = document.getElementById('mktAlStatus').value;
    const search = document.getElementById('mktAlSearch').value.trim();
    const params = new URLSearchParams({ page, limit: 50 });
    if (branch_id) params.set('branch_id', branch_id);
    if (status) params.set('status', status);
    if (search) params.set('search', search);

    const r = await mktFetch('/admin/leads?' + params.toString());
    if (!r.success) return;

    document.getElementById('mktAlCount').textContent = `${r.total} leads`;
    const badge = document.getElementById('mktAlUnassignedBadge');
    if (r.unassigned_count > 0) {
        badge.textContent = `${r.unassigned_count} unassigned`;
        badge.classList.remove('hidden');
    } else { badge.classList.add('hidden'); }

    const tbody = document.getElementById('mktAlBody');
    if (!r.leads.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="p-4 text-center text-gray-400 text-sm">No leads found</td></tr>`;
        return;
    }

    tbody.innerHTML = r.leads.map(l => `
        <tr class="hover:bg-green-50 cursor-pointer border-b border-gray-100 transition-colors" onclick="openMktPanel(${JSON.stringify(l).replace(/"/g, '&quot;')})">
            <td class="p-2" onclick="event.stopPropagation()"><input type="checkbox" class="mkt-al-chk" value="${l.id}"></td>
            <td class="p-2 font-medium text-gray-900">${mktEsc(l.full_name)}</td>
            <td class="p-2 text-gray-500 hidden sm:table-cell">${mktEsc(l.phone)}</td>
            <td class="p-2 text-gray-500 text-xs hidden md:table-cell">${l.branch_name ? mktEsc(l.branch_name) : '<span class="text-orange-500">Unassigned</span>'}</td>
            <td class="p-2 text-gray-500 text-xs hidden md:table-cell">${l.staff_name ? mktEsc(l.staff_name) : '<span class="text-gray-300">—</span>'}</td>
            <td class="p-2">${MKT_STATUS_LABELS[l.status] || l.status}</td>
            <td class="p-2 text-gray-400 text-xs hidden lg:table-cell">${l.last_contact_date ? new Date(l.last_contact_date).toLocaleDateString('en-IN') : 'Never'}</td>
        </tr>
    `).join('');

    // Pagination
    const totalPages = Math.ceil(r.total / 50);
    const pg = document.getElementById('mktAlPagination');
    if (totalPages > 1) {
        pg.innerHTML = `
            <button onclick="loadAllLeads(${page - 1})" ${page <= 1 ? 'disabled' : ''} class="px-2 py-1 border rounded text-xs disabled:opacity-40">‹</button>
            <span class="px-2 py-1 text-xs text-gray-500">${page} / ${totalPages}</span>
            <button onclick="loadAllLeads(${page + 1})" ${page >= totalPages ? 'disabled' : ''} class="px-2 py-1 border rounded text-xs disabled:opacity-40">›</button>
        `;
    } else { pg.innerHTML = ''; }
}
```

- [ ] **Step 3: Populate All Leads branch + bulk staff dropdowns after loadMktBranches**

Find the existing `loadMktBranches` function. After the line:
```js
['mktBulkBranch', 'mktCfgBranch', 'mktPerfBranch'].forEach(id => {
```

Change it to also include the new dropdowns:
```js
['mktBulkBranch', 'mktCfgBranch', 'mktPerfBranch', 'mktAlBranch', 'mktAlBulkBranch', 'mktPanelBranchSel'].forEach(id => {
```

- [ ] **Step 4: Add filter change listeners**

In `initMarketingTab()`, after the `loadMktBranches()` call, add:

```js
['mktAlBranch', 'mktAlStatus'].forEach(id =>
    document.getElementById(id).addEventListener('change', () => loadAllLeads(1))
);
let mktAlSearchTimer;
document.getElementById('mktAlSearch').addEventListener('input', () => {
    clearTimeout(mktAlSearchTimer);
    mktAlSearchTimer = setTimeout(() => loadAllLeads(1), 350);
});
document.getElementById('mktAlChkAll').addEventListener('change', function() {
    document.querySelectorAll('.mkt-al-chk').forEach(c => c.checked = this.checked);
});
```

- [ ] **Step 5: Add bulk assign for All Leads tab**

```js
async function mktAlBulkAssign() {
    const ids = Array.from(document.querySelectorAll('.mkt-al-chk:checked')).map(c => Number(c.value));
    const branch_id = Number(document.getElementById('mktAlBulkBranch').value);
    const assigned_to = document.getElementById('mktAlBulkStaff').value || null;
    if (!ids.length || !branch_id) return alert('Select leads and a branch first');
    const r = await mktFetch('/admin/queues/unassigned/assign', { method: 'POST', body: JSON.stringify({ ids, branch_id }) });
    if (r.success) { alert(`Assigned ${r.count} leads`); loadAllLeads(mktAlPage); }
    else alert(r.error || 'Failed');
}
```

- [ ] **Step 6: Add bulk staff dropdown population on branch change**

```js
async function loadMktAlBulkStaff(branchId) {
    const sel = document.getElementById('mktAlBulkStaff');
    sel.innerHTML = '<option value="">Auto assign staff</option>';
    if (!branchId) return;
    const r = await mktFetch(`/admin/branches/${branchId}/staff`);
    if (r.success) r.staff.forEach(s => {
        sel.innerHTML += `<option value="${s.id}">${mktEsc(s.full_name)}</option>`;
    });
}
document.getElementById('mktAlBulkBranch')?.addEventListener('change', function() {
    loadMktAlBulkStaff(this.value);
});
```

Note: wrap in `initMarketingTab()` so the element exists first, or use event delegation.

- [ ] **Step 7: Add openMktPanel + closeMktPanel functions**

```js
function openMktPanel(lead) {
    mktAlCurrentLead = lead;
    document.getElementById('mktPanelName').textContent = lead.full_name;
    document.getElementById('mktPanelPhone').textContent = '📱 ' + lead.phone;
    document.getElementById('mktPanelBranchVal').textContent = lead.branch_name || 'Unassigned';
    document.getElementById('mktPanelStaffVal').textContent = lead.staff_name || 'Not assigned';
    document.getElementById('mktPanelCallsVal').textContent = lead.total_attempts || 0;
    document.getElementById('mktPanelLastVal').textContent = lead.last_contact_date
        ? new Date(lead.last_contact_date).toLocaleDateString('en-IN') : 'Never';

    // Pre-select branch in panel dropdown
    const branchSel = document.getElementById('mktPanelBranchSel');
    branchSel.value = lead.branch_id || '';
    loadPanelStaff(lead.branch_id, lead.assigned_to);

    // Default WA template
    selectWaChip('welcome');
    document.getElementById('mktWaStatus').textContent = '';

    // Load history
    loadPanelHistory(lead.id);

    document.getElementById('mktLeadPanel').classList.remove('hidden');
    document.getElementById('mktPanelOverlay').classList.remove('hidden');
}

function closeMktPanel() {
    document.getElementById('mktLeadPanel').classList.add('hidden');
    document.getElementById('mktPanelOverlay').classList.add('hidden');
    mktAlCurrentLead = null;
}
```

- [ ] **Step 8: Add loadPanelStaff function**

```js
async function loadPanelStaff(branchId, selectedId) {
    const sel = document.getElementById('mktPanelStaffSel');
    sel.innerHTML = '<option value="">— Auto assign —</option>';
    if (!branchId) return;
    const r = await mktFetch(`/admin/branches/${branchId}/staff`);
    if (r.success) r.staff.forEach(s => {
        sel.innerHTML += `<option value="${s.id}" ${s.id === selectedId ? 'selected' : ''}>${mktEsc(s.full_name)}</option>`;
    });
}

document.getElementById('mktPanelBranchSel')?.addEventListener('change', function() {
    loadPanelStaff(Number(this.value), null);
});
```

- [ ] **Step 9: Add savePanelAssign function**

```js
async function savePanelAssign() {
    if (!mktAlCurrentLead) return;
    const branch_id = Number(document.getElementById('mktPanelBranchSel').value);
    const assigned_to = document.getElementById('mktPanelStaffSel').value || null;
    if (!branch_id) return alert('Choose a branch first');

    const r = await mktFetch(`/admin/leads/${mktAlCurrentLead.id}/assign`, {
        method: 'PUT',
        body: JSON.stringify({ branch_id, assigned_to: assigned_to ? Number(assigned_to) : null })
    });
    if (r.success) {
        document.getElementById('mktPanelBranchVal').textContent =
            document.getElementById('mktPanelBranchSel').selectedOptions[0]?.text || '—';
        document.getElementById('mktPanelStaffVal').textContent = r.staff_name || 'Auto assigned';
        mktAlCurrentLead.branch_id = branch_id;
        mktAlCurrentLead.assigned_to = r.assigned_to;
        loadAllLeads(mktAlPage); // refresh list
    } else alert(r.error || 'Failed to assign');
}
```

- [ ] **Step 10: Add WA chip selector + sendMktWa function**

```js
function selectWaChip(tpl) {
    document.querySelectorAll('.mkt-wa-chip').forEach(c => c.classList.remove('active', 'bg-green-100', 'border-green-400', 'text-green-800'));
    const active = document.querySelector(`.mkt-wa-chip[data-tpl="${tpl}"]`);
    if (active) active.classList.add('active', 'bg-green-100', 'border-green-400', 'text-green-800');
    const name = mktAlCurrentLead ? mktAlCurrentLead.full_name : '';
    const msg = MKT_AL_TEMPLATES[tpl] ? MKT_AL_TEMPLATES[tpl](name) : '';
    document.getElementById('mktWaMsg').value = msg;
    if (tpl === 'custom') document.getElementById('mktWaMsg').focus();
}

document.querySelectorAll('.mkt-wa-chip').forEach(c =>
    c.addEventListener('click', () => selectWaChip(c.dataset.tpl))
);

async function sendMktWa() {
    if (!mktAlCurrentLead) return;
    const message = document.getElementById('mktWaMsg').value.trim();
    if (!message) return alert('Message cannot be empty');
    const statusEl = document.getElementById('mktWaStatus');
    statusEl.textContent = 'Sending…';
    const r = await mktFetch(`/admin/leads/${mktAlCurrentLead.id}/send-wa`, {
        method: 'POST',
        body: JSON.stringify({ message })
    });
    if (r.success) {
        statusEl.textContent = '✓ Sent successfully';
        statusEl.className = 'text-xs mt-1 text-green-600';
        loadPanelHistory(mktAlCurrentLead.id);
    } else {
        statusEl.textContent = '✗ ' + (r.error || 'Failed to send');
        statusEl.className = 'text-xs mt-1 text-red-500';
    }
}
```

- [ ] **Step 11: Add loadPanelHistory function**

```js
async function loadPanelHistory(leadId) {
    const el = document.getElementById('mktPanelHistory');
    el.innerHTML = '<p class="text-xs text-gray-400">Loading…</p>';
    const r = await mktFetch(`/admin/leads/${leadId}/history`);
    if (!r.success || !r.history.length) {
        el.innerHTML = '<div class="text-xs text-gray-400 text-center py-4">No contact history yet</div>';
        return;
    }
    const typeIcon = { call: '📞', whatsapp: '💬', visit: '🤝' };
    el.innerHTML = r.history.map(h => `
        <div class="p-2 bg-gray-50 rounded-lg border-l-2 ${h.followup_type === 'whatsapp' ? 'border-green-400' : 'border-gray-300'}">
            <div class="flex justify-between items-center mb-1">
                <span class="text-xs font-medium text-gray-600">${typeIcon[h.followup_type] || '•'} ${h.staff_name || 'Admin'}</span>
                <span class="text-xs text-gray-400">${new Date(h.created_at).toLocaleDateString('en-IN')}</span>
            </div>
            ${h.outcome ? `<span class="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded">${mktEsc(h.outcome)}</span> ` : ''}
            ${h.notes ? `<p class="text-xs text-gray-500 mt-1 break-words">${mktEsc(h.notes)}</p>` : ''}
        </div>
    `).join('');
}
```

- [ ] **Step 12: Wire All Leads tab in switchMktSub**

Find the `switchMktSub` function (searches for `function switchMktSub`). Inside it, after the show/hide logic, add:

```js
if (sub === 'all-leads' && !mktAlLoaded) {
    mktAlLoaded = true;
    loadAllLeads(1);
}
```

And add `let mktAlLoaded = false;` near the top of the marketing JS section (alongside `let mktTabInitialized = false`).

Also add the panel event listeners (chip clicks, branch change) inside `initMarketingTab()` so they bind once:

```js
// WA chip listeners
document.querySelectorAll('.mkt-wa-chip').forEach(c =>
    c.addEventListener('click', () => selectWaChip(c.dataset.tpl))
);
// Panel branch change
document.getElementById('mktPanelBranchSel').addEventListener('change', function() {
    loadPanelStaff(Number(this.value), null);
});
// Bulk staff on branch change
document.getElementById('mktAlBulkBranch').addEventListener('change', function() {
    loadMktAlBulkStaff(this.value);
});
```

- [ ] **Step 13: Commit**

```bash
git add public/admin-painters.html
git commit -m "feat(pntr): All Leads subtab + slide panel JS — filters, assign, WA send, history"
```

---

## Task 5: Deploy + smoke test

- [ ] **Step 1: Push to GitHub**

```bash
git push origin master
```

- [ ] **Step 2: Deploy to server**

```bash
ssh root@161.97.114.189 "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && pm2 restart business-manager && echo DONE"
```

- [ ] **Step 3: Smoke test checklist**

Open `https://act.qcpaintshop.com/admin-painters.html` → Marketing tab:

1. ✓ "All Leads" subtab appears before "Branch Unassigned"
2. ✓ All Leads tab loads 289 leads on first open
3. ✓ Branch dropdown shows all 5 branches + "Unassigned"
4. ✓ Status filter reduces list correctly
5. ✓ Search by name filters live
6. ✓ Row click opens slide panel on right
7. ✓ Panel shows correct lead info
8. ✓ Branch change in panel → Staff dropdown repopulates
9. ✓ Save assign → panel info updates + list refreshes
10. ✓ WA chip click → textarea fills with correct template (no நமஸ்தே/வணக்கம்)
11. ✓ Send WhatsApp → success message shown + history entry appears
12. ✓ Contact history shows previous calls/WA entries
13. ✓ ✕ button closes panel

- [ ] **Step 4: Final commit if any fixes needed**

```bash
git add -p
git commit -m "fix(pntr): smoke test fixes for all-leads panel"
git push origin master && ssh root@161.97.114.189 "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && pm2 restart business-manager"
```
