# Leads ↔ Painter Program Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow staff to nominate customer leads for the Painter Program from admin-leads.html, earn incentive on painter conversion, and show source tracking in the Marketing tab.

**Architecture:** Four backend changes (migration, new endpoint, incentive on convert, source in leads query) + two frontend changes (admin-leads.html button/modal, admin-painters.html source badge). No new tables. Uses existing `painter_leads.source_lead_id` FK and `leads.lead_type` enum.

**Tech Stack:** Express.js, MySQL/MariaDB, vanilla JS, Tailwind CSS.

---

## File Map

| File | Change |
|------|--------|
| `migrations/migrate-painter-lead-incentive.js` | CREATE — ALTER staff_incentives.source ENUM |
| `routes/painter-marketing.js` | MODIFY — new from-lead endpoint + incentive on convert + source_lead_id in GET /admin/leads |
| `public/admin-leads.html` | MODIFY — Painter Program button + modal + badge in lead rows |
| `public/admin-painters.html` | MODIFY — Source column in All Leads table |

---

## Task 1: Migration — Add 'painter_convert' to staff_incentives.source ENUM

**Files:**
- Create: `migrations/migrate-painter-lead-incentive.js`

- [ ] **Step 1: Create migration file**

```js
// migrations/migrate-painter-lead-incentive.js
require('dotenv').config();
const { createPool } = require('../config/database');

async function run() {
    const pool = createPool();
    try {
        await pool.query(`
            ALTER TABLE staff_incentives
            MODIFY COLUMN source ENUM('auto_estimate','manual_request','admin_added','painter_convert')
            DEFAULT 'admin_added'
        `);
        console.log('✓ staff_incentives.source ENUM updated — painter_convert added');
    } finally {
        await pool.end();
    }
}
run().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Run migration on server**

```bash
ssh root@161.97.114.189 "cd /www/wwwroot/act.qcpaintshop.com && node migrations/migrate-painter-lead-incentive.js"
```

Expected output:
```
✓ staff_incentives.source ENUM updated — painter_convert added
```

- [ ] **Step 3: Commit**

```bash
cd "D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\act.qcpaintshop.com"
git add migrations/migrate-painter-lead-incentive.js
git commit -m "feat(pntr): migration — add painter_convert to staff_incentives.source ENUM"
```

---

## Task 2: Backend — POST /admin/leads/from-lead endpoint

**Files:**
- Modify: `routes/painter-marketing.js` (after line 303, before the duplicates endpoint)

- [ ] **Step 1: Add the endpoint after GET /admin/leads/:id/history**

Find `router.get('/admin/leads/:id/history'` (line ~287). After its closing `});`, add:

```js
// Create painter_lead from an existing customer lead
router.post('/admin/leads/from-lead', requirePermission('painters', 'marketing_manage'), async (req, res) => {
    try {
        const { lead_id, branch_id } = req.body;
        if (!lead_id || !branch_id) return res.status(400).json({ success: false, error: 'lead_id and branch_id required' });

        // Fetch customer lead
        const [[lead]] = await pool.query(
            `SELECT id, name, phone, email, assigned_to FROM leads WHERE id = ?`, [Number(lead_id)]
        );
        if (!lead) return res.status(404).json({ success: false, error: 'lead_not_found' });

        // Normalize phone to 10 digits
        const digits = String(lead.phone || '').replace(/\D/g, '');
        let phone = digits;
        if (digits.length === 12 && digits.startsWith('91')) phone = digits.slice(2);
        else if (digits.length === 11 && digits.startsWith('0')) phone = digits.slice(1);
        if (!phone || phone.length !== 10) return res.status(400).json({ success: false, error: 'invalid_phone' });

        // Check duplicate by phone
        const [[existing]] = await pool.query(
            `SELECT id FROM painter_leads WHERE phone = ? LIMIT 1`, [phone]
        );
        if (existing) return res.status(409).json({ success: false, error: 'already_exists', painter_lead_id: existing.id });

        // Insert painter_lead
        const [ins] = await pool.query(
            `INSERT INTO painter_leads (full_name, phone, email, branch_id, branch_detected_via, assigned_to, source_lead_id, status)
             VALUES (?, ?, ?, ?, 'admin_assign', ?, ?, 'new')`,
            [lead.name, phone, lead.email || null, Number(branch_id), lead.assigned_to || null, Number(lead_id)]
        );
        const painter_lead_id = ins.insertId;

        // Tag the original lead as painter type
        await pool.query(`UPDATE leads SET lead_type = 'painter' WHERE id = ?`, [Number(lead_id)]);

        // Assign to staff queue
        await assignNewLead(pool, painter_lead_id, Number(branch_id));

        res.json({ success: true, painter_lead_id });
    } catch (err) {
        console.error('[admin/leads/from-lead]', err);
        res.status(500).json({ success: false, error: err.message });
    }
});
```

- [ ] **Step 2: Verify the endpoint is placed correctly — read lines around insertion point**

Read `routes/painter-marketing.js` lines 300-320 to confirm it was inserted after the history endpoint.

- [ ] **Step 3: Commit**

```bash
git add routes/painter-marketing.js
git commit -m "feat(pntr): POST /admin/leads/from-lead — nominate customer lead as painter lead"
```

---

## Task 3: Backend — Incentive on painter_lead conversion

**Files:**
- Modify: `routes/painter-marketing.js` lines 128-161 (`POST /leads/:id/convert`)

- [ ] **Step 1: Replace the convert endpoint with incentive-aware version**

Find the full `router.post('/leads/:id/convert'` endpoint (lines 128-161). Replace it entirely with:

```js
router.post('/leads/:id/convert', requirePermission('painters', 'marketing_convert'),
    validate(convertSchema), async (req, res) => {
    const leadId = Number(req.params.id);
    const [leadRows] = await pool.query(`SELECT * FROM painter_leads WHERE id = ? LIMIT 1`, [leadId]);
    if (!leadRows.length) return res.status(404).json({ success: false, error: 'lead_not_found' });
    const lead = leadRows[0];
    if (lead.painter_id) return res.status(409).json({ success: false, error: 'already_converted' });

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [insRes] = await conn.query(
            `INSERT INTO painters
                (full_name, phone, email, branch_id, status, created_via, source_lead_id, zoho_customer_id, activated_at)
             VALUES (?, ?, ?, ?, 'approved', 'staff_convert', ?, ?, NULL)`,
            [lead.full_name, lead.phone, lead.email, lead.branch_id, lead.id, lead.zoho_customer_id || null]
        );
        const painterId = insRes.insertId;
        await conn.query(
            `UPDATE painter_leads SET painter_id = ?, status='converted', converted_at = NOW() WHERE id = ?`,
            [painterId, leadId]
        );
        await conn.commit();

        // Auto-incentive for assigned staff
        if (lead.assigned_to) {
            try {
                const [[cfg]] = await pool.query(
                    `SELECT
                        MAX(CASE WHEN config_key='incentive_enabled' THEN config_value END) AS enabled,
                        MAX(CASE WHEN config_key='incentive_per_conversion' THEN config_value END) AS amount,
                        MAX(CASE WHEN config_key='incentive_auto_approve' THEN config_value END) AS auto_approve
                     FROM ai_config WHERE config_key IN ('incentive_enabled','incentive_per_conversion','incentive_auto_approve')`
                );
                if ((cfg.enabled || 'true') === 'true') {
                    const amount = parseFloat(cfg.amount || '500');
                    const autoApprove = (cfg.auto_approve || 'false') === 'true';
                    const incMonth = new Date().toISOString().slice(0, 7);
                    await pool.query(
                        `INSERT INTO staff_incentives
                            (user_id, lead_id, lead_type, incentive_month, amount, source, status, notes)
                         VALUES (?, ?, 'painter', ?, ?, 'painter_convert', ?, ?)`,
                        [
                            lead.assigned_to,
                            lead.source_lead_id || null,
                            incMonth,
                            amount,
                            autoApprove ? 'approved' : 'pending',
                            `Painter enrolled: ${lead.full_name} (${lead.phone})`
                        ]
                    );
                }
            } catch (incErr) {
                console.error('[pntr-marketing] incentive insert failed (non-fatal)', incErr.message);
            }
        }

        painterZohoSync.syncPainterToZoho(painterId, { pool, zohoApi })
            .catch(err => console.error('[pntr-marketing] zoho sync after convert failed', err.message));
        res.json({ success: true, painter_id: painterId });
    } catch (err) {
        await conn.rollback();
        console.error('[pntr-marketing] convert failed', err);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        conn.release();
    }
});
```

- [ ] **Step 2: Verify the replacement is correct**

Read `routes/painter-marketing.js` lines 128-200 to confirm the new endpoint looks right.

- [ ] **Step 3: Commit**

```bash
git add routes/painter-marketing.js
git commit -m "feat(pntr): add incentive INSERT on painter_lead staff_convert"
```

---

## Task 4: Backend — Add source_lead_id to GET /admin/leads response

**Files:**
- Modify: `routes/painter-marketing.js` — `GET /admin/leads` endpoint

- [ ] **Step 1: Update the SELECT query**

Find the `GET /admin/leads` endpoint (around line 205). Find the SELECT query that starts:
```js
const [leads] = await pool.query(
    `SELECT pl.id, pl.full_name, pl.phone, pl.branch_id, pl.status,
```

Add `pl.source_lead_id, l2.name AS source_lead_name` to the SELECT and add the JOIN:

Replace the SELECT block with:
```js
const [leads] = await pool.query(
    `SELECT pl.id, pl.full_name, pl.phone, pl.branch_id, pl.status,
            pl.total_attempts, pl.last_contact_date, pl.imported_at,
            pl.source_lead_id,
            b.name AS branch_name,
            u.full_name AS staff_name, pl.assigned_to,
            l2.name AS source_lead_name
     FROM painter_leads pl
     LEFT JOIN branches b ON b.id = pl.branch_id
     LEFT JOIN users u ON u.id = pl.assigned_to
     LEFT JOIN leads l2 ON l2.id = pl.source_lead_id
     ${where}
     ORDER BY pl.imported_at DESC
     LIMIT ? OFFSET ?`,
    [...params, Number(limit), offset]
);
```

- [ ] **Step 2: Commit**

```bash
git add routes/painter-marketing.js
git commit -m "feat(pntr): include source_lead_id + source_lead_name in GET /admin/leads response"
```

---

## Task 5: Frontend — admin-leads.html Painter Program button + modal

**Files:**
- Modify: `public/admin-leads.html`

- [ ] **Step 1: Add modal HTML**

Find the Convert Modal HTML (around line 421, `id="convertModal"`). After its closing `</div>` tag, insert the new Painter Program modal:

```html
<!-- Painter Program Nomination Modal -->
<div id="painterProgramModal" class="hidden fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
    <div class="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
        <h3 class="text-lg font-bold text-gray-900 mb-1">🎨 Nominate for Painter Program</h3>
        <p class="text-sm text-gray-500 mb-4">This person will be added to the Painter Marketing queue for follow-up and enrollment.</p>
        <div class="bg-gray-50 rounded-lg p-3 mb-4">
            <div id="ppModalLeadName" class="font-semibold text-gray-900 text-sm"></div>
            <div id="ppModalLeadPhone" class="text-gray-500 text-xs mt-0.5"></div>
        </div>
        <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-1">Assign to Branch</label>
            <select id="ppModalBranch" class="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:border-green-600">
                <option value="">Choose branch…</option>
            </select>
        </div>
        <div class="flex gap-3 justify-end">
            <button onclick="closePainterProgramModal()" class="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">Cancel</button>
            <button onclick="submitPainterNomination()" class="px-4 py-2 text-sm bg-green-700 text-white rounded-lg font-semibold hover:bg-green-800">Nominate</button>
        </div>
        <div id="ppModalStatus" class="text-xs mt-2 text-gray-500"></div>
    </div>
</div>
```

- [ ] **Step 2: Add "Painter Program" button to lead row**

Find the lead row action buttons in `renderLeads()` (around line 737). Find this section:
```js
${!lead.customer_id && lead.status !== 'inactive' ? `<button onclick="showConvertModal(...)
```

Add the Painter Program button BEFORE the Convert button:
```js
${lead.lead_type !== 'painter' ? `<button onclick="showPainterProgramModal(${lead.id}, '${escapeHtml(lead.name).replace(/'/g, "\\'")}', '${escapeHtml(lead.phone || '')}')" class="text-green-600 hover:text-green-800 font-semibold text-sm mr-2" title="Add to Painter Program">🎨 Painter</button>` : `<span class="text-xs text-green-600 font-semibold mr-2">✓ Painter</span>`}
```

- [ ] **Step 3: Add JavaScript functions**

Find the end of the `<script>` section (near the bottom of the file, before `</script>`). Add these functions:

```js
// ─── Painter Program Nomination ───
let ppCurrentLeadId = null;

async function showPainterProgramModal(leadId, name, phone) {
    ppCurrentLeadId = leadId;
    document.getElementById('ppModalLeadName').textContent = name;
    document.getElementById('ppModalLeadPhone').textContent = phone;
    document.getElementById('ppModalStatus').textContent = '';

    // Load branches
    const branchSel = document.getElementById('ppModalBranch');
    branchSel.innerHTML = '<option value="">Choose branch…</option>';
    try {
        const r = await fetch('/api/branches', { headers: getAuthHeaders() }).then(x => x.json());
        const list = r.data || r.branches || [];
        list.forEach(b => {
            branchSel.innerHTML += `<option value="${b.id}">${escapeHtml(b.name)}</option>`;
        });
    } catch (e) { console.error('loadBranches', e); }

    document.getElementById('painterProgramModal').classList.remove('hidden');
}

function closePainterProgramModal() {
    document.getElementById('painterProgramModal').classList.add('hidden');
    ppCurrentLeadId = null;
}

async function submitPainterNomination() {
    const branch_id = Number(document.getElementById('ppModalBranch').value);
    const statusEl = document.getElementById('ppModalStatus');
    if (!branch_id) { statusEl.textContent = 'Branch தேர்ந்தெடுங்கள்'; return; }

    statusEl.textContent = 'Nominating…';
    try {
        const r = await fetch('/api/painter-marketing/admin/leads/from-lead', {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ lead_id: ppCurrentLeadId, branch_id })
        }).then(x => x.json());

        if (r.success) {
            statusEl.style.color = '#16a34a';
            statusEl.textContent = '✓ Successfully added to Painter Program marketing queue!';
            setTimeout(() => { closePainterProgramModal(); loadLeads(); }, 1500);
        } else if (r.error === 'already_exists') {
            statusEl.style.color = '#d97706';
            statusEl.textContent = 'Already in Painter Program queue.';
        } else {
            statusEl.style.color = '#dc2626';
            statusEl.textContent = r.error || 'Failed';
        }
    } catch (e) {
        statusEl.style.color = '#dc2626';
        statusEl.textContent = 'Network error';
    }
}
```

- [ ] **Step 4: Commit**

```bash
git add public/admin-leads.html
git commit -m "feat(pntr): admin-leads — Painter Program nomination button + modal"
```

---

## Task 6: Frontend — admin-painters.html Source badge in All Leads

**Files:**
- Modify: `public/admin-painters.html`

- [ ] **Step 1: Add Source column header to All Leads table**

Find the All Leads table header (around line 698):
```html
<th class="p-2 hidden lg:table-cell">Last Contact</th>
```

Add after it:
```html
<th class="p-2 hidden lg:table-cell">Source</th>
```

- [ ] **Step 2: Add Source cell to loadAllLeads row rendering**

Find `loadAllLeads` function (around line 3221). Find the tbody row template string. Find the last `<td>` (Last Contact cell):
```js
'<td class="p-2 text-gray-400 text-xs hidden lg:table-cell">' + (l.last_contact_date ? ... : 'Never') + '</td>'
```

Add after it:
```js
'<td class="p-2 hidden lg:table-cell">' +
  (l.source_lead_id
    ? '<a href="/admin-leads.html" target="_blank" class="text-xs bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full hover:bg-blue-100" title="From customer lead: ' + mktEsc(l.source_lead_name || '') + '">📋 Customer Lead</a>'
    : '<span class="text-xs text-gray-300">PNTR Zoho</span>') +
'</td>'
```

- [ ] **Step 3: Commit**

```bash
git add public/admin-painters.html
git commit -m "feat(pntr): All Leads table — Source column shows Customer Lead badge"
```

---

## Task 7: Deploy + smoke test

- [ ] **Step 1: Push to GitHub**

```bash
cd "D:\QUALITY COLOURS\DEVELOPMENT\qcpaintshop.com\act.qcpaintshop.com"
git push origin master
```

- [ ] **Step 2: Deploy**

```bash
ssh root@161.97.114.189 "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && pm2 restart business-manager && echo DEPLOYED"
```

- [ ] **Step 3: Smoke test checklist**

1. Open `https://act.qcpaintshop.com/admin-leads.html`
2. ✓ Lead row shows "🎨 Painter" button (for non-painter leads)
3. ✓ Click button → modal opens with lead name/phone
4. ✓ Branch dropdown populated
5. ✓ Submit → success message → row updates to "✓ Painter" badge
6. ✓ Open `https://act.qcpaintshop.com/admin-painters.html` → Marketing → All Leads
7. ✓ Nominated lead appears in All Leads with "📋 Customer Lead" badge
8. ✓ Staff converts painter lead → `staff_incentives` record created
9. ✓ Convert again → 409 already_converted (no duplicate)
10. ✓ Duplicate phone nomination → returns already_exists gracefully

- [ ] **Step 4: Verify incentive on server**

```bash
ssh root@161.97.114.189 "cd /www/wwwroot/act.qcpaintshop.com && node << 'SCRIPT'
require('dotenv').config();
const {createPool} = require('./config/database');
const pool = createPool();
async function run() {
  const [rows] = await pool.query(
    'SELECT id, user_id, lead_type, amount, source, status, notes FROM staff_incentives WHERE source = ? ORDER BY id DESC LIMIT 5',
    ['painter_convert']
  );
  console.log('Painter convert incentives:', JSON.stringify(rows, null, 2));
  process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });
SCRIPT"
```

Expected: Shows recent painter_convert incentive records (if any conversions happened).
