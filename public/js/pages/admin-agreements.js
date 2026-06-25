// Page logic for Staff Agreements. Externalized from the admin-agreements.html inline <script>
// (S9+F5 Phase C, 2026-06-25) so the page runs under the enforced strict CSP.
// Verbatim move of all functions; inline on*= handlers converted to addEventListener.
// No logic changes, no renames, escaping helpers untouched.
const token = localStorage.getItem('auth_token');
let allStaff = [];

function escHtml(s){ if(s==null) return ''; const d=document.createElement('div'); d.textContent=String(s); return d.innerHTML; }

async function loadStats() {
    const res = await fetch('/api/agreements/admin/stats', { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!data.success) return;
    const s = data.stats;
    document.getElementById('s-total').textContent   = s.total;
    document.getElementById('s-uploaded').textContent = s.uploaded;
    document.getElementById('s-viewed').textContent   = s.viewed;
    document.getElementById('s-pending').textContent  = s.pending;
}

function fmtDate(dt) {
    if (!dt) return '—';
    return new Date(dt).toLocaleDateString('en-IN', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone:'Asia/Kolkata' });
}

function renderTable(staff) {
    const tbody = document.getElementById('staffBody');
    if (!staff.length) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:#9ca3af;padding:30px;">No staff found</td></tr>';
        return;
    }
    tbody.innerHTML = staff.map(s => {
        const status = s.agreement_status || 'none';
        const badgeClass = { none:'badge-none', pending:'badge-pending', viewed:'badge-viewed', uploaded:'badge-uploaded' }[status] || 'badge-none';
        const badgeLabel = { none:'Not Assigned', pending:'Pending', viewed:'Viewed', uploaded:'Signed ✅' }[status] || status;
        const safeDoc = /^(https?:\/\/|\/)/i.test(s.signed_document || '') ? s.signed_document : '#';
        const docLink = s.signed_document
            ? `<a href="${escHtml(safeDoc)}" target="_blank" class="btn-sm btn-view">View</a>`
            : '—';
        return `<tr data-name="${escHtml((s.full_name||'').toLowerCase())}" data-branch="${escHtml((s.branch_name||'').toLowerCase())}">
            <td style="font-weight:600;">${escHtml(s.full_name) || '—'}</td>
            <td style="color:#6b7280;">${escHtml(s.role) || '—'}</td>
            <td>${escHtml(s.branch_name) || '—'}</td>
            <td><span class="badge ${badgeClass}">${badgeLabel}</span></td>
            <td style="color:#6b7280;font-size:12px;">${fmtDate(s.viewed_at)}</td>
            <td style="color:#6b7280;font-size:12px;">${fmtDate(s.uploaded_at)}</td>
            <td>${docLink}</td>
        </tr>`;
    }).join('');
}

function filterTable(q) {
    q = q.toLowerCase();
    const filtered = allStaff.filter(s =>
        (s.full_name || '').toLowerCase().includes(q) ||
        (s.branch_name || '').toLowerCase().includes(q) ||
        (s.role || '').toLowerCase().includes(q)
    );
    renderTable(filtered);
}

async function loadStaff() {
    try {
        const res = await fetch('/api/agreements/admin/staff-list', { headers: { Authorization: `Bearer ${token}` } });
        const data = await res.json();
        document.getElementById('loader').style.display = 'none';
        document.getElementById('tableWrap').style.display = 'block';
        if (!data.success) return;
        allStaff = data.staff || [];
        renderTable(allStaff);
    } catch (err) {
        document.getElementById('loader').textContent = 'Error loading staff list.';
    }
}

async function assignAll() {
    const btn = document.getElementById('assignBtn');
    btn.disabled = true;
    btn.textContent = 'Assigning...';
    try {
        const res = await fetch('/api/agreements/admin/assign-all', {
            method: 'POST', headers: { Authorization: `Bearer ${token}` }
        });
        const data = await res.json();
        btn.textContent = '➕ Assign to All Staff';
        btn.disabled = false;
        if (data.success) {
            alert(`✅ ${data.assigned} new staff assigned. Reload to see updated list.`);
            loadStats();
            loadStaff();
        }
    } catch (err) {
        btn.textContent = '➕ Assign to All Staff';
        btn.disabled = false;
    }
}

loadStats();
loadStaff();

// ── Static handler wiring (externalized from inline on*= attributes; S9+F5 Phase C, 2026-06-25) ──
document.getElementById('assignBtn').addEventListener('click', assignAll);
document.getElementById('searchBox').addEventListener('input', function() { filterTable(this.value); });
