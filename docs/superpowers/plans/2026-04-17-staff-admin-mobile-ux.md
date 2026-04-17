# Staff & Admin Mobile UX Upgrade — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make 5 pages mobile-friendly and add a staff Painter Program nomination flow, delivered in parallel across 6 independent tasks.

**Architecture:** Tasks 1–2 and 4–6 are fully independent and can run simultaneously. Task 3 (staff-leads frontend) depends on Task 1 (backend endpoint) being merged first. All changes are frontend HTML/CSS/JS except Task 1 which adds one route.

**Tech Stack:** Tailwind CSS (CDN), design-system.css, vanilla JS, Express.js (Task 1 only)

---

## File Map

| Task | Files Changed |
|------|--------------|
| 1 | `routes/painter-marketing.js` |
| 2 | `public/staff-painter-marketing.html` |
| 3 | `public/staff-leads.html` *(depends on Task 1)* |
| 4 | `public/admin-leads.html` |
| 5 | `public/admin-painters.html` |
| 6 | `public/staff-billing.html` |

---

## Task 1: Backend — Staff Painter Nomination Endpoint

**Files:**
- Modify: `routes/painter-marketing.js` (after line 380, after the admin `from-lead` route)

**Context:** The existing `POST /api/painter-marketing/admin/leads/from-lead` at line 344 requires `requirePermission('painters', 'marketing_manage')` — staff tokens can't call it. We add a staff-accessible twin using `requireAuth`.

- [ ] **Step 1: Add the new route after line 380 in `routes/painter-marketing.js`**

Insert this block immediately after the closing `});` of the admin `from-lead` route (after line 380):

```javascript
// Staff: nominate a customer lead to painter marketing queue
router.post('/staff/leads/from-lead', requireAuth, async (req, res) => {
    try {
        const { lead_id, notes } = req.body;
        if (!lead_id) return res.status(400).json({ success: false, error: 'lead_id required' });

        const [[lead]] = await pool.query(
            `SELECT id, name, phone, email, assigned_to, branch_id FROM leads WHERE id = ?`,
            [Number(lead_id)]
        );
        if (!lead) return res.status(404).json({ success: false, error: 'lead_not_found' });

        const digits = String(lead.phone || '').replace(/\D/g, '');
        let phone = digits;
        if (digits.length === 12 && digits.startsWith('91')) phone = digits.slice(2);
        else if (digits.length === 11 && digits.startsWith('0')) phone = digits.slice(1);
        if (!phone || phone.length !== 10) return res.status(400).json({ success: false, error: 'invalid_phone' });

        const [[existing]] = await pool.query(
            `SELECT id FROM painter_leads WHERE phone = ? LIMIT 1`, [phone]
        );
        if (existing) return res.status(409).json({ success: false, error: 'already_exists' });

        const branchId = lead.branch_id || null;
        const [ins] = await pool.query(
            `INSERT INTO painter_leads (full_name, phone, email, branch_id, branch_detected_via, assigned_to, source_lead_id, status)
             VALUES (?, ?, ?, ?, 'staff_assign', ?, ?, 'new')`,
            [lead.name, phone, lead.email || null, branchId, lead.assigned_to || null, Number(lead_id)]
        );
        const painter_lead_id = ins.insertId;

        await pool.query(`UPDATE leads SET lead_type = 'painter' WHERE id = ?`, [Number(lead_id)]);
        if (branchId) await assignNewLead(pool, painter_lead_id, branchId);

        res.json({ success: true, painter_lead_id });
    } catch (err) {
        console.error('[staff/leads/from-lead]', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
```

- [ ] **Step 2: Test the endpoint with curl**

Start the server (`node server.js` or check pm2), then run (replace TOKEN with a valid staff auth token from localStorage in the browser):

```bash
curl -s -X POST http://localhost:3000/api/painter-marketing/staff/leads/from-lead \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"lead_id": 1}' | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.parse(d)))"
```

Expected: `{ success: true, painter_lead_id: N }` or `{ success: false, error: 'already_exists' }` (if lead already nominated).
If `{ error: 'lead_not_found' }` — lead_id 1 doesn't exist, try another id.

- [ ] **Step 3: Commit**

```bash
git add routes/painter-marketing.js
git commit -m "feat(pntr): staff endpoint to nominate lead to painter queue"
```

---

## Task 2: `staff-painter-marketing.html` — Full Mobile Rewrite

**Files:**
- Rewrite: `public/staff-painter-marketing.html` (current: 186 lines with fixed 720px container)

**Context:** Replace the entire file. Keep all existing JS logic (API calls, modal, convert), rewrite HTML structure to use Tailwind + staff sidebar pattern (matching `staff-leads.html`).

- [ ] **Step 1: Replace the entire file with the following content**

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="theme-color" content="#1B5E3B">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <link rel="manifest" href="/manifest.json">
    <title>Painter Marketing — QC</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="/css/design-system.css">
    <script src="/universal-nav-loader.js"></script>
    <script src="/js/auth-helper.js"></script>
    <script>checkAuthOrRedirect();</script>
    <style>
        .badge-new           { background:#dbeafe; color:#1e40af; }
        .badge-interested    { background:#dcfce7; color:#166534; }
        .badge-in_progress   { background:#fef3c7; color:#92400e; }
        .badge-unreachable   { background:#fee2e2; color:#991b1b; }
        .badge-not_interested{ background:#f3f4f6; color:#4b5563; }
        .badge-wrong_number  { background:#fecaca; color:#7f1d1d; }
        .badge-converted     { background:#e9d5ff; color:#6b21a8; }
        .pill-filter.active  { background:#1B5E3B !important; color:#fff !important; border-color:#1B5E3B !important; }
    </style>
</head>
<body class="bg-gray-50" data-page="painter-marketing">

<div id="mainContent" class="px-4 sm:px-6 py-4 pb-20 max-w-2xl mx-auto">

    <!-- Header card -->
    <div class="relative overflow-hidden rounded-2xl p-4 mb-4 text-white" style="background:linear-gradient(135deg,#0D3D23 0%,#1B5E3B 100%)">
        <div class="absolute -top-6 -right-6 w-28 h-28 bg-white/5 rounded-full pointer-events-none"></div>
        <div class="flex items-center justify-between mb-3 relative">
            <h1 class="text-lg font-bold">Today's Painter Calls</h1>
            <span id="progressBadge" class="text-xs font-semibold px-3 py-1 rounded-full bg-white/20">0/0</span>
        </div>
        <div class="h-2 rounded-full overflow-hidden bg-white/20 relative">
            <div id="progressFill" class="h-full rounded-full bg-white transition-all duration-300" style="width:0%"></div>
        </div>
        <p id="summary" class="text-xs mt-2 text-green-100">Loading…</p>
    </div>

    <!-- Filter pills -->
    <div class="flex gap-2 mb-4 overflow-x-auto pb-1">
        <button class="pill-filter active flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium bg-white border border-gray-200 text-gray-600" data-filter="all">All</button>
        <button class="pill-filter flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium bg-white border border-gray-200 text-gray-600" data-filter="pending">Pending</button>
        <button class="pill-filter flex-shrink-0 px-4 py-1.5 rounded-full text-sm font-medium bg-white border border-gray-200 text-gray-600" data-filter="done">Done</button>
    </div>

    <!-- Lead list -->
    <div id="list"></div>
</div>

<div id="modalRoot"></div>

<script>
    const token = localStorage.getItem('auth_token');
    const headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

    let allLeads = [], filter = 'all';

    async function load() {
        try {
            const r = await fetch('/api/painter-marketing/me/today', { headers }).then(x => x.json());
            allLeads = r.list || [];
            render();
        } catch (err) {
            document.getElementById('list').innerHTML = `<div class="bg-red-50 text-red-600 rounded-xl p-4 text-sm">${esc(err.message)}</div>`;
        }
    }

    function render() {
        const total = allLeads.length;
        const done  = allLeads.filter(l => l.contacted_at).length;
        document.getElementById('summary').textContent = `${done} of ${total} contacted today`;
        document.getElementById('progressBadge').textContent = `${done}/${total}`;
        document.getElementById('progressFill').style.width = total ? (100 * done / total) + '%' : '0%';

        let list = allLeads;
        if (filter === 'pending') list = allLeads.filter(l => !l.contacted_at);
        if (filter === 'done')    list = allLeads.filter(l =>  l.contacted_at);

        if (!list.length) {
            document.getElementById('list').innerHTML = `<div class="bg-white rounded-xl p-8 text-center text-gray-400 text-sm shadow-sm">No leads in this view</div>`;
            return;
        }

        document.getElementById('list').innerHTML = list.map(l => {
            const lastTxt = l.last_contact_date
                ? `Last: ${Math.floor((Date.now() - new Date(l.last_contact_date)) / 86400000)}d ago — ${esc(l.last_outcome || '')}`
                : 'No prior contact';
            const ph = esc(l.phone || '');
            return `<div class="bg-white rounded-xl p-4 mb-3 shadow-sm border border-gray-100">
                <div class="flex items-start justify-between mb-1">
                    <strong class="text-gray-900 text-sm">${esc(l.full_name)}</strong>
                    <span class="badge badge-${esc(l.status)} text-xs font-medium px-2 py-0.5 rounded-full">${esc(l.status)}</span>
                </div>
                <div class="text-gray-500 text-xs mb-0.5">📞 ${ph}</div>
                <div class="text-gray-400 text-xs mb-2">${lastTxt}</div>
                ${l.notes ? `<div class="text-xs text-gray-500 italic mb-2 line-clamp-2">"${esc(l.notes)}"</div>` : ''}
                <div class="grid grid-cols-3 gap-2">
                    <a href="tel:${ph}" class="flex items-center justify-center py-2 rounded-lg text-xs font-semibold text-white" style="background:#1B5E3B">📞 Call</a>
                    <a href="https://wa.me/91${ph}" target="_blank" rel="noopener" class="flex items-center justify-center py-2 rounded-lg text-xs font-semibold text-white" style="background:#25d366">💬 WA</a>
                    <button onclick="openOutcome(${l.id})" class="flex items-center justify-center py-2 rounded-lg text-xs font-semibold border text-green-700 bg-white" style="border-color:#1B5E3B">✏️ Log</button>
                </div>
                ${l.status === 'interested' ? `
                <div class="mt-2 rounded-lg px-3 py-2 flex items-center justify-between bg-amber-50">
                    <span class="text-xs text-amber-700">⭐ Interested — Convert?</span>
                    <button onclick="convertLead(${l.id})" class="text-xs font-bold" style="color:#1B5E3B">Convert →</button>
                </div>` : ''}
            </div>`;
        }).join('');
    }

    function openOutcome(leadId) {
        document.getElementById('modalRoot').innerHTML = `
        <div class="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50" onclick="if(event.target===this)closeModal()">
            <div class="bg-white rounded-t-2xl sm:rounded-2xl p-4 w-full sm:max-w-md max-h-[85vh] overflow-y-auto">
                <h3 class="font-bold text-base mb-3" style="color:#0D3D23">Log Outcome</h3>
                <label class="block text-xs font-medium text-gray-600 mb-1">Channel</label>
                <select id="ch" onchange="toggleCallFields()" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3">
                    <option value="call">Call</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="visit">Visited Shop</option>
                </select>
                <div id="callFields">
                    <label class="block text-xs font-medium text-gray-600 mb-1">Call Status</label>
                    <select id="cs" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3">
                        <option value="">—</option>
                        <option value="connected">Connected</option>
                        <option value="not_answered">Not Answered</option>
                        <option value="wrong_number">Wrong Number</option>
                        <option value="switched_off">Switched Off</option>
                        <option value="busy">Busy</option>
                    </select>
                </div>
                <label class="block text-xs font-medium text-gray-600 mb-1">Outcome</label>
                <select id="oc" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3">
                    <option value="">—</option>
                    <option value="interested_in_program">Interested ⭐</option>
                    <option value="already_aware">Already Aware</option>
                    <option value="will_visit_shop">Will Visit Shop</option>
                    <option value="wants_callback">Wants Callback</option>
                    <option value="not_interested">Not Interested</option>
                    <option value="no_answer">No Answer</option>
                    <option value="wrong_number">Wrong Number</option>
                </select>
                <label class="block text-xs font-medium text-gray-600 mb-1">Callback date</label>
                <input type="date" id="cd" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-3">
                <label class="block text-xs font-medium text-gray-600 mb-1">Notes</label>
                <textarea id="nt" rows="2" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-4 resize-none" placeholder="Optional"></textarea>
                <div class="flex gap-2 justify-end">
                    <button onclick="closeModal()" class="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600">Cancel</button>
                    <button onclick="saveOutcome(${leadId})" class="px-4 py-2 text-sm text-white rounded-lg font-semibold" style="background:#1B5E3B">Save</button>
                </div>
            </div>
        </div>`;
    }

    function closeModal() { document.getElementById('modalRoot').innerHTML = ''; }
    function toggleCallFields() {
        document.getElementById('callFields').style.display = document.getElementById('ch').value === 'call' ? 'block' : 'none';
    }

    async function saveOutcome(leadId) {
        const body = {
            followup_type: document.getElementById('ch').value,
            call_status:   document.getElementById('cs').value || null,
            outcome:       document.getElementById('oc').value || null,
            next_followup_date: document.getElementById('cd').value || null,
            notes:         document.getElementById('nt').value || null
        };
        try {
            const r = await fetch(`/api/painter-marketing/leads/${leadId}/followup`, { method: 'POST', headers, body: JSON.stringify(body) }).then(x => x.json());
            if (r.success) { closeModal(); load(); } else { alert(r.error?.message || r.error || 'Failed'); }
        } catch (err) { alert('Error: ' + err.message); }
    }

    async function convertLead(leadId) {
        if (!confirm('Convert this lead to a painter? A Zoho customer + salesperson will be created automatically.')) return;
        try {
            const r = await fetch(`/api/painter-marketing/leads/${leadId}/convert`, { method: 'POST', headers, body: JSON.stringify({}) }).then(x => x.json());
            if (r.success) { alert('Converted! Painter ID: ' + r.painter_id); load(); } else { alert(r.error?.message || r.error || 'Failed'); }
        } catch (err) { alert('Error: ' + err.message); }
    }

    document.querySelectorAll('.pill-filter').forEach(p => p.onclick = () => {
        document.querySelectorAll('.pill-filter').forEach(x => x.classList.remove('active'));
        p.classList.add('active');
        filter = p.dataset.filter;
        render();
    });

    load();
</script>
</body>
</html>
```

- [ ] **Step 2: Open `http://localhost:3000/staff-painter-marketing.html` in Chrome DevTools**

Set device to "iPhone 12 Pro" (390×844). Verify:
- Sidebar nav loads correctly (same as other staff pages)
- Header gradient shows with progress bar and badge
- Lead cards render with 3-column button grid (Call / WA / Log)
- "Interested" amber callout strip shows for interested-status leads
- Filter pills (All/Pending/Done) work
- Log modal opens as bottom sheet on mobile
- `tel:` and `wa.me` links are correct

- [ ] **Step 3: Commit**

```bash
git add public/staff-painter-marketing.html
git commit -m "feat: staff-painter-marketing mobile rewrite — action-first cards + sidebar nav"
```

---

## Task 3: `staff-leads.html` — Paint Roller Button + Nomination Modal

**⚠️ Depends on Task 1 being committed first (endpoint must exist)**

**Files:**
- Modify: `public/staff-leads.html`

**Context:** The `renderLeads()` function at line 966 generates each lead card. The action buttons row is at lines 1030–1044. We add a paint roller SVG button after the "View" button when `lead.lead_type !== 'painter'`. We also add modal HTML and 3 JS functions.

- [ ] **Step 1: Locate the exact insertion point in the action buttons row**

Read `public/staff-leads.html` lines 1038–1044. You will see:

```javascript
                <button onclick="event.stopPropagation(); viewLead(${lead.id})" class="action-btn flex-1 text-center py-2 bg-green-50 text-green-600 rounded-lg text-xs font-semibold hover:bg-green-100 transition flex items-center justify-center gap-1">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                    View
                </button>
            </div>
        </div>`;
```

- [ ] **Step 2: Replace that View button block to add the paint roller button after it**

Replace:
```javascript
                <button onclick="event.stopPropagation(); viewLead(${lead.id})" class="action-btn flex-1 text-center py-2 bg-green-50 text-green-600 rounded-lg text-xs font-semibold hover:bg-green-100 transition flex items-center justify-center gap-1">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                    View
                </button>
            </div>
        </div>`;
```

With:
```javascript
                <button onclick="event.stopPropagation(); viewLead(${lead.id})" class="action-btn flex-1 text-center py-2 bg-green-50 text-green-600 rounded-lg text-xs font-semibold hover:bg-green-100 transition flex items-center justify-center gap-1">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                    View
                </button>
                ${lead.lead_type !== 'painter'
                    ? `<button onclick="event.stopPropagation(); openPainterNominate(${lead.id}, '${escapeHtml(lead.name).replace(/'/g, "\\'")}', '${escapeHtml(lead.phone || '').replace(/'/g, "\\'")}')" class="action-btn flex-shrink-0 py-2 px-3 bg-green-50 text-green-700 rounded-lg text-xs font-semibold hover:bg-green-100 transition flex items-center gap-1" title="Add to Painter Program">
                        <svg class="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="18" height="5" rx="2"/><path d="M5 8v3a5 5 0 0 0 5 5h1"/><path d="M11 16v5"/><path d="M9 21h4"/></svg>
                        Painter
                    </button>`
                    : `<span class="flex-shrink-0 px-2 py-1 bg-green-50 text-green-700 rounded-lg text-xs font-semibold flex items-center gap-1">✓ Painter</span>`
                }
            </div>
        </div>`;
```

- [ ] **Step 3: Add the nomination modal + JS functions before the closing `</script>` tag**

Find the last `</script>` tag in the file and insert these functions just before it:

```javascript
    // ─── Painter Program Nomination ───
    function openPainterNominate(leadId, leadName, leadPhone) {
        const existing = document.getElementById('painterNominateModal');
        if (existing) existing.remove();
        document.body.insertAdjacentHTML('beforeend', `
        <div id="painterNominateModal" class="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-[10001]" onclick="if(event.target===this)closePainterNominate()">
            <div class="bg-white rounded-t-2xl sm:rounded-2xl p-5 w-full sm:max-w-sm">
                <h3 class="font-bold text-base text-gray-900 mb-1 flex items-center gap-2">
                    <svg class="w-4 h-4 text-green-700 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="18" height="5" rx="2"/><path d="M5 8v3a5 5 0 0 0 5 5h1"/><path d="M11 16v5"/><path d="M9 21h4"/></svg>
                    Add to Painter Program
                </h3>
                <p class="text-xs text-gray-500 mb-4">${escapeHtml(leadName)} · ${escapeHtml(leadPhone)}</p>
                <label class="block text-xs font-medium text-gray-600 mb-1">Notes (optional)</label>
                <textarea id="pnNotes" rows="2" class="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm mb-2 resize-none" placeholder="Any notes for the marketing team"></textarea>
                <p id="pnError" class="text-xs text-red-600 mb-2 hidden"></p>
                <div class="flex gap-2 justify-end">
                    <button onclick="closePainterNominate()" class="px-4 py-2 text-sm border border-gray-300 rounded-lg text-gray-600">Cancel</button>
                    <button id="pnSubmitBtn" onclick="submitPainterNominate(${leadId})" class="px-4 py-2 text-sm text-white rounded-lg font-semibold" style="background:#1B5E3B">Add to Program</button>
                </div>
            </div>
        </div>`);
    }

    function closePainterNominate() {
        const el = document.getElementById('painterNominateModal');
        if (el) el.remove();
    }

    async function submitPainterNominate(leadId) {
        const notes = document.getElementById('pnNotes').value || null;
        const errEl = document.getElementById('pnError');
        const btn   = document.getElementById('pnSubmitBtn');
        errEl.classList.add('hidden');
        btn.disabled = true;
        btn.textContent = 'Adding…';
        try {
            const r = await fetch('/api/painter-marketing/staff/leads/from-lead', {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify({ lead_id: leadId, notes })
            }).then(x => x.json());

            if (r.success) {
                closePainterNominate();
                showToast('Added to Painter Program queue');
                const lead = allLeads.find(l => l.id === leadId);
                if (lead) { lead.lead_type = 'painter'; renderLeads(allLeads); }
            } else if (r.error === 'already_exists') {
                errEl.textContent = 'Already in Painter Program queue.';
                errEl.classList.remove('hidden');
                btn.disabled = false; btn.textContent = 'Add to Program';
            } else {
                errEl.textContent = r.error || 'Failed. Try again.';
                errEl.classList.remove('hidden');
                btn.disabled = false; btn.textContent = 'Add to Program';
            }
        } catch (err) {
            errEl.textContent = 'Network error: ' + err.message;
            errEl.classList.remove('hidden');
            btn.disabled = false; btn.textContent = 'Add to Program';
        }
    }
```

- [ ] **Step 4: Verify in browser at mobile viewport (390px)**

Open `http://localhost:3000/staff-leads.html` in DevTools mobile view. Check:
- Each lead card shows "Painter" button with paint roller SVG icon when `lead_type !== 'painter'`
- Lead already in painter program shows "✓ Painter" badge instead
- Clicking "Painter" opens a bottom-sheet modal with lead name/phone shown
- Submit calls `POST /api/painter-marketing/staff/leads/from-lead`
- On success: modal closes, toast appears, button becomes "✓ Painter" badge
- On "already_exists": inline error shows (no modal close)

- [ ] **Step 5: Commit**

```bash
git add public/staff-leads.html
git commit -m "feat: staff-leads — paint roller nomination button + modal for Painter Program"
```

---

## Task 4: `admin-leads.html` — Mobile Card View

**Files:**
- Modify: `public/admin-leads.html`

**Context:** The leads table is at lines 175–196, rendered by `renderLeads()` at line 719 which writes to `#leadsTableBody`. We add a `md:hidden` card list updated alongside the table, and hide the table wrapper on mobile.

- [ ] **Step 1: Make the table wrapper desktop-only**

Find the line (around line 175):
```html
            <div class="overflow-x-auto">
                <table class="w-full">
                    <thead class="bg-gradient-to-r from-purple-600 to-purple-700 text-white">
```

Replace `<div class="overflow-x-auto">` with:
```html
            <div class="overflow-x-auto hidden md:block">
```

- [ ] **Step 2: Add mobile card container immediately before that div**

Insert this HTML block immediately before the `<div class="overflow-x-auto hidden md:block">` line you just edited:

```html
            <!-- Mobile card list (hidden on md+) -->
            <div id="leadsMobileList" class="md:hidden space-y-3 mb-4"></div>
```

- [ ] **Step 3: Update `renderLeads()` to also populate the mobile card list**

In the `renderLeads()` function (around line 719), after `tbody.innerHTML = leads.map(lead => { ... }).join('');` find the end of the function and add a call to a new helper. The full updated function ending should look like:

Find the end of `renderLeads()` — it will be after the `tbody.innerHTML = ...` assignment. Add this line right before the closing `}` of `renderLeads()`:

```javascript
            renderLeadsMobile(leads);
```

Then add this new function right after the closing `}` of `renderLeads()`:

```javascript
        function renderLeadsMobile(leads) {
            const container = document.getElementById('leadsMobileList');
            if (!container) return;
            if (!leads.length) {
                container.innerHTML = '<div class="bg-white rounded-xl p-6 text-center text-gray-400 text-sm shadow-sm">No leads found</div>';
                return;
            }
            container.innerHTML = leads.map(lead => {
                const statusClass = `status-${lead.status}`;
                return `<div class="bg-white rounded-xl p-4 shadow-sm border border-gray-100">
                    <div class="flex items-start justify-between mb-2">
                        <div>
                            <div class="font-semibold text-gray-900 text-sm">${escapeHtml(lead.name)}</div>
                            <div class="text-xs text-gray-500 mt-0.5">${escapeHtml(lead.phone) || '—'}</div>
                        </div>
                        <span class="text-xs font-semibold px-2 py-0.5 rounded-full ${statusClass} flex-shrink-0">${formatStatus(lead.status)}</span>
                    </div>
                    <div class="flex items-center gap-2 text-xs text-gray-400 mb-3">
                        <span>${escapeHtml(lead.assigned_to_name) || 'Unassigned'}</span>
                        <span>·</span>
                        <span>${formatDate(lead.created_at)}</span>
                        ${lead.lead_type ? `<span>·</span><span class="px-1.5 py-0.5 rounded-full font-medium ${lead.lead_type === 'painter' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}">${lead.lead_type}</span>` : ''}
                    </div>
                    <div class="flex gap-2">
                        <button onclick="viewLead(${lead.id})" class="flex-1 py-2 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-semibold hover:bg-indigo-100 transition">View</button>
                        <button onclick="editLead(${lead.id})" class="flex-1 py-2 bg-green-50 text-green-600 rounded-lg text-xs font-semibold hover:bg-green-100 transition">Edit</button>
                        ${lead.lead_type !== 'painter' ? `<button onclick="showPainterProgramModal(${lead.id}, '${escapeHtml(lead.name).replace(/'/g, "\\'")}', '${escapeHtml(lead.phone || '').replace(/'/g, "\\'")}')" class="flex-1 py-2 bg-green-50 text-green-700 rounded-lg text-xs font-semibold hover:bg-green-100 transition flex items-center justify-center gap-1"><svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="18" height="5" rx="2"/><path d="M5 8v3a5 5 0 0 0 5 5h1"/><path d="M11 16v5"/><path d="M9 21h4"/></svg>Painter</button>` : `<span class="flex-1 py-2 bg-green-50 text-green-700 rounded-lg text-xs font-semibold flex items-center justify-center">✓ Painter</span>`}
                    </div>
                </div>`;
            }).join('');
        }
```

- [ ] **Step 4: Fix nomination modal to be bottom-sheet on mobile**

Find the Painter Program Nomination Modal (around line 446). It will start with something like:
```html
            <!-- Painter Program Nomination Modal -->
```

Find the modal's inner container div and ensure it has responsive positioning. Look for `class="..."` on the modal dialog div and ensure it includes bottom-sheet on mobile. Replace the modal overlay's inner div class to add mobile bottom-sheet:

Find:
```html
                <div class="bg-white rounded-2xl
```
(inside the nomination modal overlay)

Ensure the outer overlay div has: `class="fixed inset-0 ... flex items-end sm:items-center ..."`. If it currently has `items-center`, add `sm:` prefix and add `items-end` for mobile. Make the dialog itself have `rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md`.

- [ ] **Step 5: Verify mobile layout**

Open `http://localhost:3000/admin-leads.html` in DevTools at 390px width. Check:
- Table is hidden, cards show with name/phone/status/assigned/date
- View, Edit, Painter buttons work
- Painter button opens nomination modal as bottom-sheet on mobile
- At 768px+: table shows, cards hidden

- [ ] **Step 6: Commit**

```bash
git add public/admin-leads.html
git commit -m "feat: admin-leads mobile card view + nomination modal bottom-sheet on mobile"
```

---

## Task 5: `admin-painters.html` — Marketing Tab Mobile Cards + Bottom-Sheet Panel

**Files:**
- Modify: `public/admin-painters.html`

**Context:** The Marketing tab's All Leads subtab renders a table via `loadAllLeads()` at line 3222, writing to `#mktAlBody` (a `<tbody>`). The slide panel `openMktPanel()` is at line ~3185+. We add mobile cards alongside the table and convert the slide panel to a bottom-sheet on mobile.

- [ ] **Step 1: Find the All Leads table wrapper in the HTML**

Search for `mktAlBody` in the file. You'll find a `<table>` containing `<tbody id="mktAlBody">`. Find the wrapping div and add `hidden md:block` to make it desktop-only.

Specifically, find the div wrapping the All Leads table — it will look like:
```html
<div class="overflow-x-auto ...">
    <table ...>
        ...
        <tbody id="mktAlBody">
```

Add `hidden md:block` to that outer div's class list.

- [ ] **Step 2: Add mobile card container before that div**

Insert immediately before the `hidden md:block` table wrapper:
```html
<!-- Mobile card list for All Leads (hidden on md+) -->
<div id="mktAlMobileList" class="md:hidden space-y-3 mb-4"></div>
```

- [ ] **Step 3: Update `loadAllLeads()` to also render mobile cards**

In `loadAllLeads()` (around line 3222), find where `tbody.innerHTML = r.leads.map(...)` ends and the function returns. Right after that `tbody.innerHTML` assignment, add:

```javascript
        renderMktAlMobile(r.leads);
```

Then add this function immediately after the closing `}` of `loadAllLeads()`:

```javascript
    function renderMktAlMobile(leads) {
        var container = document.getElementById('mktAlMobileList');
        if (!container) return;
        if (!leads.length) {
            container.innerHTML = '<div class="bg-white rounded-xl p-6 text-center text-gray-400 text-sm">No leads found</div>';
            return;
        }
        container.innerHTML = leads.map(function(l) {
            var statusHtml = MKT_STATUS_LABELS[l.status] || ('<span class="text-xs text-gray-400">' + mktEsc(l.status) + '</span>');
            var lastContact = l.last_contact_date
                ? Math.floor((Date.now() - new Date(l.last_contact_date)) / 86400000) + 'd ago'
                : 'No contact';
            return '<div class="bg-white rounded-xl p-4 shadow-sm border border-gray-100 cursor-pointer" onclick="openMktPanel(' + JSON.stringify(l).replace(/"/g, '&quot;') + ')">' +
                '<div class="flex items-start justify-between mb-1">' +
                    '<div class="font-semibold text-gray-900 text-sm">' + mktEsc(l.full_name) + '</div>' +
                    statusHtml +
                '</div>' +
                '<div class="text-xs text-gray-500 mb-1">📞 ' + mktEsc(l.phone) + '</div>' +
                '<div class="text-xs text-gray-400 mb-3">' + lastContact + (l.last_outcome ? ' — ' + mktEsc(l.last_outcome) : '') + '</div>' +
                '<div class="flex gap-2">' +
                    '<button onclick="event.stopPropagation(); openMktPanel(' + JSON.stringify(l).replace(/"/g, '&quot;') + ')" class="flex-1 py-2 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-semibold">View / Log</button>' +
                    (l.status !== 'converted' ? '<button onclick="event.stopPropagation(); mktConvertLead(' + l.id + ')" class="flex-1 py-2 text-white rounded-lg text-xs font-semibold" style="background:#1B5E3B">Convert →</button>' : '') +
                '</div>' +
            '</div>';
        }).join('');
    }
```

- [ ] **Step 4: Make the slide panel a bottom-sheet on mobile**

The panel element is `id="mktLeadPanel"` at line 829. It currently has class `fixed top-0 right-0 h-full w-full sm:w-96`. On mobile (< 768px) override it to a bottom-sheet.

Add this CSS rule inside the existing `<style>` block near the top of the file:

```css
        @media (max-width: 767px) {
            #mktLeadPanel {
                top: auto !important;
                bottom: 0 !important;
                left: 0 !important;
                right: 0 !important;
                width: 100% !important;
                height: 85vh !important;
                border-radius: 1rem 1rem 0 0 !important;
                border-left: none !important;
            }
        }
```

- [ ] **Step 5: Verify in DevTools at 390px**

Open `http://localhost:3000/admin-painters.html`, navigate to Marketing tab → All Leads subtab. Check:
- Table hidden on mobile, cards show with name/phone/status/last contact
- "View / Log" button opens the panel as a bottom sheet on mobile
- "Convert →" button works
- At 768px+: table shows, cards hidden

- [ ] **Step 6: Commit**

```bash
git add public/admin-painters.html
git commit -m "feat: admin-painters Marketing tab — mobile card view + bottom-sheet panel"
```

---

## Task 6: `staff-billing.html` — Fix Items Tables in Detail Panels

**Files:**
- Modify: `public/staff-billing.html`

**Context:** The main invoice list (`loadInvoices`) already renders as card divs — no table, no change needed there. However, the estimate/invoice detail panel contains two bare `<table>` elements (items rows at lines ~503 and ~657) with no `overflow-x-auto` wrapper, causing horizontal overflow on mobile.

- [ ] **Step 1: Fix the first items table (around line 503 in the JS template string)**

The `loadInvoices` function (line 587) renders a detail view template that contains:
```javascript
            <table class="w-full text-sm mb-4">
                <thead><tr class="border-b text-left text-gray-500">
                    <th class="py-2 font-medium">Product</th>
```

Find this `<table class="w-full text-sm mb-4">` inside the JS template string and wrap it:

Replace:
```javascript
            <table class="w-full text-sm mb-4">
```
With:
```javascript
            <div class="overflow-x-auto -mx-1"><table class="w-full text-sm mb-4 min-w-[320px]">
```

And find the corresponding closing `</table>` and change it to:
```javascript
            </table></div>
```

- [ ] **Step 2: Fix the second items table (around line 657)**

Read `public/staff-billing.html` lines 655–670 to find the second bare `<table class="w-full text-sm mb-4">`. Apply the same overflow wrapper:

Replace:
```javascript
            <table class="w-full text-sm mb-4">
```
With:
```javascript
            <div class="overflow-x-auto -mx-1"><table class="w-full text-sm mb-4 min-w-[320px]">
```

And close with `</table></div>`.

- [ ] **Step 3: Verify at 390px viewport**

Open `http://localhost:3000/staff-billing.html` in DevTools at 390px. Click on an invoice to open the detail view. Check:
- Items table scrolls horizontally without breaking layout
- Product / Qty / Rate / Total columns are readable
- Main invoice list still shows as cards (unchanged)

- [ ] **Step 4: Commit**

```bash
git add public/staff-billing.html
git commit -m "feat: staff-billing items tables overflow-x-auto in detail panels"
```

---

## Final: Deploy to Production

After all 6 tasks are committed and verified locally:

```bash
ssh root@161.97.114.189 "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && npm install && pm2 restart business-manager"
```

Verify on a real mobile device:
1. `staff-painter-marketing.html` — call queue loads, cards tap correctly, Log modal works
2. `staff-leads.html` — paint roller button shows, nomination modal submits
3. `admin-leads.html` — mobile cards show, nomination works
4. `admin-painters.html` — Marketing/All Leads cards show, panel opens as bottom-sheet
5. `staff-billing.html` — invoice cards show
