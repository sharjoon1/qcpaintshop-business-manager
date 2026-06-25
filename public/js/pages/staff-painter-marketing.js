// Page logic externalized from staff-painter-marketing.html inline <script> (S9+F5 Phase E batch 11, 2026-06-25)
// so the page runs under the enforced strict CSP. Verbatim move of all functions; inline on*=
// handlers converted to data-action delegation. No logic changes, no renames, escaping helpers untouched.
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
                    <button data-action="open-outcome" data-id="${l.id}" class="flex items-center justify-center py-2 rounded-lg text-xs font-semibold border text-green-700 bg-white" style="border-color:#1B5E3B">✏️ Log</button>
                </div>
                ${l.status === 'interested' ? `
                <div class="mt-2 rounded-lg px-3 py-2 flex items-center justify-between bg-amber-50">
                    <span class="text-xs text-amber-700">⭐ Interested — Convert?</span>
                    <button data-action="convert-lead" data-id="${l.id}" class="text-xs font-bold" style="color:#1B5E3B">Convert →</button>
                </div>` : ''}
            </div>`;
        }).join('');
    }

    function openOutcome(leadId) {
        closeModal();

        // Measure nav bar so we can position sheet exactly above it
        const navEl = document.querySelector('.qc-mobile-quickbar');
        const navH = navEl ? Math.round(navEl.getBoundingClientRect().height) : 0;
        const sheetMaxH = Math.round(window.innerHeight * 0.75) - navH;

        // Dim overlay — stops at top of nav bar so no z-index fight needed
        const overlay = document.createElement('div');
        overlay.id = 'outcomeModal';
        overlay.style.cssText = `position:fixed;top:0;left:0;right:0;bottom:${navH}px;background:rgba(0,0,0,0.5);z-index:9998`;
        overlay.onclick = closeModal;
        document.body.appendChild(overlay);

        // Sheet — pinned exactly to the top of the nav bar
        const sheet = document.createElement('div');
        sheet.id = 'outcomeSheet';
        sheet.style.cssText = `position:fixed;left:0;right:0;bottom:${navH}px;z-index:9999;background:white;border-radius:1rem 1rem 0 0;display:flex;flex-direction:column;overflow:hidden;max-height:${sheetMaxH}px`;
        sheet.onclick = function(e){ e.stopPropagation(); };
        sheet.innerHTML = `
            <div style="overflow-y:auto;padding:1rem;flex:1;min-height:0">
                <h3 style="font-weight:700;font-size:1rem;margin-bottom:0.75rem;color:#0D3D23">Log Outcome</h3>
                <label style="display:block;font-size:0.75rem;font-weight:500;color:#4b5563;margin-bottom:0.25rem">Channel</label>
                <select id="ch" data-action="toggle-call-fields" style="width:100%;border:1px solid #d1d5db;border-radius:0.5rem;padding:0.5rem 0.75rem;font-size:0.875rem;margin-bottom:0.75rem;background:white">
                    <option value="call">Call</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="visit">Visited Shop</option>
                </select>
                <div id="callFields">
                    <label style="display:block;font-size:0.75rem;font-weight:500;color:#4b5563;margin-bottom:0.25rem">Call Status</label>
                    <select id="cs" style="width:100%;border:1px solid #d1d5db;border-radius:0.5rem;padding:0.5rem 0.75rem;font-size:0.875rem;margin-bottom:0.75rem;background:white">
                        <option value="">—</option>
                        <option value="connected">Connected</option>
                        <option value="not_answered">Not Answered</option>
                        <option value="wrong_number">Wrong Number</option>
                        <option value="switched_off">Switched Off</option>
                        <option value="busy">Busy</option>
                    </select>
                </div>
                <label style="display:block;font-size:0.75rem;font-weight:500;color:#4b5563;margin-bottom:0.25rem">Outcome</label>
                <select id="oc" style="width:100%;border:1px solid #d1d5db;border-radius:0.5rem;padding:0.5rem 0.75rem;font-size:0.875rem;margin-bottom:0.75rem;background:white">
                    <option value="">—</option>
                    <option value="interested_in_program">Interested ⭐</option>
                    <option value="already_aware">Already Aware</option>
                    <option value="will_visit_shop">Will Visit Shop</option>
                    <option value="wants_callback">Wants Callback</option>
                    <option value="not_interested">Not Interested</option>
                    <option value="no_answer">No Answer</option>
                    <option value="wrong_number">Wrong Number</option>
                </select>
                <label style="display:block;font-size:0.75rem;font-weight:500;color:#4b5563;margin-bottom:0.25rem">Callback date</label>
                <input type="date" id="cd" style="width:100%;border:1px solid #d1d5db;border-radius:0.5rem;padding:0.5rem 0.75rem;font-size:0.875rem;margin-bottom:0.75rem">
                <label style="display:block;font-size:0.75rem;font-weight:500;color:#4b5563;margin-bottom:0.25rem">Notes</label>
                <textarea id="nt" rows="2" style="width:100%;border:1px solid #d1d5db;border-radius:0.5rem;padding:0.5rem 0.75rem;font-size:0.875rem;resize:none" placeholder="Optional"></textarea>
            </div>
            <div style="flex-shrink:0;display:flex;gap:0.5rem;justify-content:flex-end;padding:1rem;border-top:1px solid #f3f4f6;background:white">
                <button data-action="close-modal" style="padding:0.5rem 1rem;font-size:0.875rem;border:1px solid #d1d5db;border-radius:0.5rem;color:#4b5563;background:white;cursor:pointer">Cancel</button>
                <button data-action="save-outcome" data-id="${leadId}" style="padding:0.5rem 1rem;font-size:0.875rem;border:none;border-radius:0.5rem;color:white;background:#1B5E3B;font-weight:600;cursor:pointer">Save</button>
            </div>`;
        document.body.appendChild(sheet);
    }

    function closeModal() {
        document.getElementById('outcomeModal')?.remove();
        document.getElementById('outcomeSheet')?.remove();
    }
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

// ── Static handler wiring (externalized from inline on*= attributes; S9+F5 Phase E batch 11, 2026-06-25) ──
// Filter pills were wired via `.onclick` property assignment in the original inline block (not inline
// on*= attributes), which is already CSP-safe JS — moved here verbatim.
document.querySelectorAll('.pill-filter').forEach(p => p.onclick = () => {
    document.querySelectorAll('.pill-filter').forEach(x => x.classList.remove('active'));
    p.classList.add('active');
    filter = p.dataset.filter;
    render();
});

// Delegated dispatcher for runtime-rendered buttons (replaces inline
// onclick="openOutcome(...)" / onclick="convertLead(...)" / onclick="closeModal()" /
// onclick="saveOutcome(...)"). One document-level click listener routes by data-action.
document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    if (!action) return;
    if (action === 'open-outcome') {
        openOutcome(btn.getAttribute('data-id'));
    } else if (action === 'convert-lead') {
        convertLead(btn.getAttribute('data-id'));
    } else if (action === 'close-modal') {
        closeModal();
    } else if (action === 'save-outcome') {
        saveOutcome(btn.getAttribute('data-id'));
    }
});

// Delegated dispatcher for the runtime-rendered Channel <select> (replaces inline
// onchange="toggleCallFields()").
document.addEventListener('change', function (e) {
    const sel = e.target.closest('[data-action="toggle-call-fields"]');
    if (!sel) return;
    toggleCallFields();
});

// Initialize
load();
