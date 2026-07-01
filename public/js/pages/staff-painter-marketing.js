// Staff Painter Marketing page controller.
//
// Wired to the painter-lead onboarding workflow (Task 6, 2026-06-30):
//   - GET  /api/painter-leads/my          → staff's assigned leads (filter chips + actions)
//   - GET  /api/painter-leads/my/today    → today's follow-ups (auto-loaded for the "Today" chip)
//   - POST /api/painter-leads/:id/followup
//   - POST /api/painter-leads/:id/send-invite
//   - PUT  /api/painters/:id/approve      (only when lead.status === 'registered' && lead.painter_id)
//
// All API calls go through the shared auth-helper (`apiFetch` / `getAuthHeaders`).
// Inline `on*=` handlers are forbidden by CSP — every button dispatches via
// `data-action` and the document-level click listener below. User content
// (names, notes, phone, etc.) is escaped with `esc()` before innerHTML.

(function () {
    'use strict';

    // ────────────────────────────────────────────────────────────────
    //  State
    // ────────────────────────────────────────────────────────────────

    let allLeads = [];         // assigned leads from /my
    let todayLeads = [];       // lead ids present in /my/today
    let filter = 'all';
    let isLoading = false;

    // ────────────────────────────────────────────────────────────────
    //  Helpers
    // ────────────────────────────────────────────────────────────────

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
    }

    function cleanPhone(phone) {
        if (!phone) return '';
        const digits = String(phone).replace(/\D/g, '');
        if (digits.length === 10) return digits;
        // Already prefixed (e.g. 91XXXXXXXXXX) — strip the leading 91 for wa.me
        if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
        return digits;
    }

    function daysSince(dateStr) {
        if (!dateStr) return null;
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return null;
        return Math.floor((Date.now() - d.getTime()) / 86400000);
    }

    function getFilters() {
        return {
            all:        () => allLeads,
            today:      () => {
                const ids = new Set(todayLeads.map(l => l.id));
                return allLeads.filter(l => ids.has(l.id));
            },
            pending:    () => allLeads.filter(l =>
                ['new', 'in_progress'].includes(l.status) && !l.last_contact_date
            ),
            interested: () => allLeads.filter(l => l.status === 'interested'),
            invited:    () => allLeads.filter(l => l.status === 'invited'),
            registered: () => allLeads.filter(l => l.status === 'registered'),
        };
    }

    function todayIso() {
        return new Date().toISOString().slice(0, 10);
    }

    // ────────────────────────────────────────────────────────────────
    //  Loading
    // ────────────────────────────────────────────────────────────────

    async function load() {
        if (isLoading) return;
        isLoading = true;
        try {
            const [myRes, todayRes] = await Promise.all([
                apiFetch('/api/painter-leads/my?limit=100'),
                apiFetch('/api/painter-leads/my/today').catch(() => null),
            ]);

            allLeads = (myRes && myRes.success && Array.isArray(myRes.data)) ? myRes.data : [];

            // /my/today returns { today, new_leads, invited } — merge by id
            const todayBag = (todayRes && todayRes.success && todayRes.data) || {};
            const todayArr = [
                ...(Array.isArray(todayBag.today)       ? todayBag.today : []),
                ...(Array.isArray(todayBag.new_leads)   ? todayBag.new_leads : []),
                ...(Array.isArray(todayBag.invited)     ? todayBag.invited : []),
            ];
            const seen = new Set();
            todayLeads = todayArr.filter(l => {
                if (!l || seen.has(l.id)) return false;
                seen.add(l.id);
                return true;
            });
            render();
        } catch (err) {
            document.getElementById('list').innerHTML =
                `<div class="bg-red-50 text-red-600 rounded-xl p-4 text-sm">${esc(err.message)}</div>`;
        } finally {
            isLoading = false;
        }
    }

    // ────────────────────────────────────────────────────────────────
    //  Render
    // ────────────────────────────────────────────────────────────────

    function render() {
        const total = allLeads.length;
        const contacted = allLeads.filter(l => !!l.last_contact_date).length;

        document.getElementById('summary').textContent =
            `${contacted} of ${total} contacted · ${todayLeads.length} due today`;
        document.getElementById('progressBadge').textContent = `${contacted}/${total}`;
        document.getElementById('progressFill').style.width =
            total ? (100 * contacted / total) + '%' : '0%';

        const filters = getFilters();
        const list = filters[filter] ? filters[filter]() : allLeads;

        if (!list.length) {
            document.getElementById('list').innerHTML =
                `<div class="bg-white rounded-xl p-8 text-center text-gray-400 text-sm shadow-sm">No leads in this view</div>`;
            return;
        }

        document.getElementById('list').innerHTML = list.map(renderLeadCard).join('');
    }

    function renderLeadCard(l) {
        const ph = cleanPhone(l.phone);
        const since = daysSince(l.last_contact_date);
        const lastTxt = l.last_contact_date
            ? `Last: ${since === 0 ? 'today' : since + 'd ago'} — ${esc(l.last_outcome || '')}`
            : 'No prior contact';

        const showApprove = l.status === 'registered' && l.painter_id;

        return `
        <div class="lead-card bg-white rounded-xl p-4 mb-3 shadow-sm border border-gray-100">
            <div class="flex items-start justify-between mb-1 gap-2">
                <strong class="text-gray-900 text-sm leading-tight">${esc(l.full_name || 'Unnamed')}</strong>
                <span class="badge badge-${esc(l.status)} text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap">${esc((l.status || '').replace(/_/g, ' '))}</span>
            </div>
            <div class="text-gray-500 text-xs mb-0.5">${esc(l.lead_number || '')} · ${esc(ph)}</div>
            <div class="text-gray-400 text-xs mb-2">${lastTxt}</div>
            ${l.notes ? `<div class="text-xs text-gray-500 italic mb-2 line-clamp-2">"${esc(l.notes)}"</div>` : ''}
            <div class="grid grid-cols-4 gap-2">
                <a data-action="call-lead" data-id="${l.id}" data-phone="${esc(ph)}"
                   class="action-btn flex items-center justify-center py-2 rounded-lg text-xs font-semibold text-white brand-bg">Call</a>
                <a data-action="wa-lead" data-id="${l.id}" data-phone="${esc(ph)}" target="_blank" rel="noopener"
                   class="action-btn flex items-center justify-center py-2 rounded-lg text-xs font-semibold text-white" style="background:#25d366">WA</a>
                <button data-action="open-followup" data-id="${l.id}"
                   class="action-btn flex items-center justify-center py-2 rounded-lg text-xs font-semibold border brand-text bg-white brand-border">Log</button>
                <button data-action="open-invite" data-id="${l.id}"
                   class="action-btn flex items-center justify-center py-2 rounded-lg text-xs font-semibold border brand-text bg-white brand-border">Invite</button>
            </div>
            ${showApprove ? `
            <div class="mt-2 rounded-lg px-3 py-2 flex items-center justify-between" style="background:#FFF7E6">
                <span class="text-xs" style="color:#92400e">Registered — awaiting approval</span>
                <button data-action="approve-painter" data-painter-id="${esc(l.painter_id)}" data-lead-id="${l.id}"
                   class="action-btn text-xs font-bold brand-text">Approve →</button>
            </div>` : ''}
        </div>`;
    }

    // ────────────────────────────────────────────────────────────────
    //  Modals
    // ────────────────────────────────────────────────────────────────

    function closeModal() {
        const root = document.getElementById('modalRoot');
        if (root) root.innerHTML = '';
    }

    function buildSheet({ title, bodyHtml, primaryLabel, primaryAction }) {
        closeModal();
        const root = document.getElementById('modalRoot');

        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.dataset.action = 'close-modal';
        root.appendChild(overlay);

        const sheet = document.createElement('div');
        sheet.className = 'modal-sheet';
        sheet.dataset.action = 'sheet-stop';
        sheet.innerHTML = `
            <div style="overflow-y:auto;padding:1rem;flex:1;min-height:0">
                <h3 style="font-weight:700;font-size:1rem;margin-bottom:0.75rem" class="brand-text">${esc(title)}</h3>
                ${bodyHtml}
            </div>
            <div style="flex-shrink:0;display:flex;gap:0.5rem;justify-content:flex-end;padding:1rem;border-top:1px solid #f3f4f6;background:white">
                <button data-action="close-modal"
                    style="padding:0.5rem 1rem;font-size:0.875rem;border:1px solid #d1d5db;border-radius:0.5rem;color:#4b5563;background:white;cursor:pointer">Cancel</button>
                <button data-action="${esc(primaryAction)}"
                    style="padding:0.5rem 1rem;font-size:0.875rem;border:none;border-radius:0.5rem;color:white;background:#1B5E3B;font-weight:600;cursor:pointer">${esc(primaryLabel)}</button>
            </div>`;
        root.appendChild(sheet);
    }

    function openFollowup(leadId) {
        const today = todayIso();
        const bodyHtml = `
            <label style="display:block;font-size:0.75rem;font-weight:500;color:#4b5563;margin-bottom:0.25rem">Channel</label>
            <select id="fuType" style="width:100%;border:1px solid #d1d5db;border-radius:0.5rem;padding:0.5rem 0.75rem;font-size:0.875rem;margin-bottom:0.75rem;background:white">
                <option value="call">Call</option>
                <option value="whatsapp">WhatsApp</option>
                <option value="visit">Visit</option>
                <option value="sms">SMS</option>
            </select>
            <label style="display:block;font-size:0.75rem;font-weight:500;color:#4b5563;margin-bottom:0.25rem">Call status <span style="color:#9ca3af">(calls only)</span></label>
            <select id="fuCallStatus" style="width:100%;border:1px solid #d1d5db;border-radius:0.5rem;padding:0.5rem 0.75rem;font-size:0.875rem;margin-bottom:0.75rem;background:white">
                <option value="">—</option>
                <option value="connected">Connected</option>
                <option value="not_answered">Not Answered</option>
                <option value="wrong_number">Wrong Number</option>
                <option value="switched_off">Switched Off</option>
                <option value="busy">Busy</option>
            </select>
            <label style="display:block;font-size:0.75rem;font-weight:500;color:#4b5563;margin-bottom:0.25rem">Outcome</label>
            <select id="fuOutcome" style="width:100%;border:1px solid #d1d5db;border-radius:0.5rem;padding:0.5rem 0.75rem;font-size:0.875rem;margin-bottom:0.75rem;background:white">
                <option value="">—</option>
                <option value="interested">Interested ⭐</option>
                <option value="callback">Wants Callback</option>
                <option value="not_interested">Not Interested</option>
                <option value="no_response">No Response</option>
                <option value="wrong_number">Wrong Number</option>
                <option value="unreachable">Unreachable</option>
                <option value="other">Other</option>
            </select>
            <label style="display:block;font-size:0.75rem;font-weight:500;color:#4b5563;margin-bottom:0.25rem">Next follow-up date</label>
            <input type="date" id="fuNextDate" value="${esc(today)}"
                style="width:100%;border:1px solid #d1d5db;border-radius:0.5rem;padding:0.5rem 0.75rem;font-size:0.875rem;margin-bottom:0.75rem">
            <label style="display:block;font-size:0.75rem;font-weight:500;color:#4b5563;margin-bottom:0.25rem">Notes <span style="color:#ef4444">*</span></label>
            <textarea id="fuNotes" rows="2" placeholder="What happened?"
                style="width:100%;border:1px solid #d1d5db;border-radius:0.5rem;padding:0.5rem 0.75rem;font-size:0.875rem;resize:none"></textarea>
            <p id="fuError" style="display:none;color:#dc2626;font-size:0.75rem;margin-top:0.5rem"></p>`;
        buildSheet({
            title: 'Log Follow-up',
            bodyHtml,
            primaryLabel: 'Save',
            primaryAction: 'save-followup',
        });
        // Stamp the lead id onto the primary button so the dispatcher can find it.
        const root = document.getElementById('modalRoot');
        const saveBtn = root.querySelector('[data-action="save-followup"]');
        if (saveBtn) saveBtn.dataset.id = leadId;
    }

    function openInvite(leadId) {
        const bodyHtml = `
            <p style="font-size:0.8125rem;color:#4b5563;margin-bottom:0.75rem">
                Sends a WhatsApp invite (falls back to SMS) with a unique registration link.
                The lead's status will move to <strong>Invited</strong>.
            </p>
            <label style="display:block;font-size:0.75rem;font-weight:500;color:#4b5563;margin-bottom:0.25rem">Channel</label>
            <select id="invChannel" style="width:100%;border:1px solid #d1d5db;border-radius:0.5rem;padding:0.5rem 0.75rem;font-size:0.875rem;margin-bottom:0.75rem;background:white">
                <option value="auto">Auto (WhatsApp → SMS)</option>
                <option value="whatsapp">WhatsApp only</option>
                <option value="sms">SMS only</option>
            </select>
            <label style="display:block;font-size:0.75rem;font-weight:500;color:#4b5563;margin-bottom:0.25rem">Custom message <span style="color:#9ca3af">(optional)</span></label>
            <textarea id="invMessage" rows="3" placeholder="Leave blank to send the default invite"
                style="width:100%;border:1px solid #d1d5db;border-radius:0.5rem;padding:0.5rem 0.75rem;font-size:0.875rem;resize:none"></textarea>
            <p id="invError" style="display:none;color:#dc2626;font-size:0.75rem;margin-top:0.5rem"></p>`;
        buildSheet({
            title: 'Send Invite',
            bodyHtml,
            primaryLabel: 'Send',
            primaryAction: 'save-invite',
        });
        const root = document.getElementById('modalRoot');
        const sendBtn = root.querySelector('[data-action="save-invite"]');
        if (sendBtn) sendBtn.dataset.id = leadId;
    }

    // ────────────────────────────────────────────────────────────────
    //  Save actions
    // ────────────────────────────────────────────────────────────────

    async function saveFollowup(leadId) {
        const notesEl = document.getElementById('fuNotes');
        const errEl   = document.getElementById('fuError');
        const notes   = (notesEl && notesEl.value || '').trim();
        if (!notes) {
            if (errEl) { errEl.textContent = 'Notes are required'; errEl.style.display = 'block'; }
            return;
        }
        const body = {
            followup_type:    document.getElementById('fuType').value,
            call_status:      document.getElementById('fuCallStatus').value || null,
            outcome:          document.getElementById('fuOutcome').value || null,
            next_followup_date: document.getElementById('fuNextDate').value || null,
            notes,
        };
        try {
            const r = await apiFetch(`/api/painter-leads/${leadId}/followup`, {
                method: 'POST',
                body: JSON.stringify(body),
            });
            if (r && r.success) {
                closeModal();
                toast('Follow-up saved');
                load();
            } else {
                if (errEl) {
                    errEl.textContent = (r && (r.message || r.error)) || 'Failed';
                    errEl.style.display = 'block';
                }
            }
        } catch (err) {
            if (errEl) { errEl.textContent = 'Error: ' + err.message; errEl.style.display = 'block'; }
        }
    }

    async function saveInvite(leadId) {
        const errEl = document.getElementById('invError');
        const channel = document.getElementById('invChannel').value;
        const message = (document.getElementById('invMessage').value || '').trim();
        const body = { channel };
        if (message) body.message = message;

        try {
            const r = await apiFetch(`/api/painter-leads/${leadId}/send-invite`, {
                method: 'POST',
                body: JSON.stringify(body),
            });
            if (r && r.success) {
                closeModal();
                const via = r.data && r.data.channel ? ` via ${r.data.channel}` : '';
                toast(`Invite sent${via}`);
                load();
            } else {
                if (errEl) {
                    errEl.textContent = (r && (r.message || r.error)) || 'Failed';
                    errEl.style.display = 'block';
                }
            }
        } catch (err) {
            if (errEl) { errEl.textContent = 'Error: ' + err.message; errEl.style.display = 'block'; }
        }
    }

    async function approvePainter(painterId, leadId) {
        if (!confirm('Approve this painter? They will become an active Quality Colours painter.')) return;
        try {
            const r = await apiFetch(`/api/painters/${painterId}/approve`, {
                method: 'PUT',
                body: JSON.stringify({ action: 'approve' }),
            });
            if (r && r.success) {
                toast('Painter approved');
                load();
            } else {
                alert((r && (r.message || r.error)) || 'Failed to approve painter');
            }
        } catch (err) {
            alert('Error: ' + err.message);
        }
    }

    // Auto-log a 'whatsapp' followup when staff taps the WhatsApp action.
    // The followup endpoint is called fire-and-forget; UI doesn't block.
    async function logWhatsappTap(leadId) {
        try {
            await apiFetch(`/api/painter-leads/${leadId}/followup`, {
                method: 'POST',
                body: JSON.stringify({
                    followup_type: 'whatsapp',
                    outcome:       'no_response',
                    notes:         'Opened WhatsApp chat',
                }),
            });
            // Refresh progress badge quietly — don't lose scroll position.
            const contacted = allLeads.filter(l => !!l.last_contact_date).length + 1;
            const badge = document.getElementById('progressBadge');
            const fill  = document.getElementById('progressFill');
            if (badge) badge.textContent = `${contacted}/${allLeads.length}`;
            if (fill && allLeads.length) {
                fill.style.width = (100 * contacted / allLeads.length) + '%';
            }
        } catch (_) {
            // Silent: WhatsApp tap logging is best-effort.
        }
    }

    // ────────────────────────────────────────────────────────────────
    //  Toast (lightweight)
    // ────────────────────────────────────────────────────────────────

    function toast(msg) {
        const el = document.createElement('div');
        el.className = 'toast-enter';
        el.textContent = msg;
        el.style.cssText = [
            'position:fixed',
            'left:50%',
            'bottom:1.25rem',
            'transform:translateX(-50%)',
            'background:#0D3D23',
            'color:#fff',
            'padding:0.625rem 1rem',
            'border-radius:0.625rem',
            'font-size:0.8125rem',
            'font-weight:600',
            'z-index:10000',
            'box-shadow:0 6px 24px rgba(0,0,0,0.2)',
            'pointer-events:none',
        ].join(';');
        document.body.appendChild(el);
        setTimeout(() => {
            el.classList.remove('toast-enter');
            el.classList.add('toast-exit');
            setTimeout(() => el.remove(), 280);
        }, 1800);
    }

    // ────────────────────────────────────────────────────────────────
    //  Wiring (CSP-safe: delegated listeners only)
    // ────────────────────────────────────────────────────────────────

    // Filter chips — captured at load because they exist in the static HTML.
    document.querySelectorAll('.pill-filter').forEach(p => {
        p.addEventListener('click', () => {
            document.querySelectorAll('.pill-filter').forEach(x => x.classList.remove('active'));
            p.classList.add('active');
            filter = p.dataset.filter;
            render();
        });
    });

    // Delegated dispatcher for runtime-rendered buttons + modal controls.
    document.addEventListener('click', function (e) {
        // Stop clicks inside the sheet from bubbling to the overlay.
        const inSheet = e.target.closest('[data-action="sheet-stop"]');
        if (inSheet && !e.target.closest('[data-action]')) {
            e.stopPropagation();
            return;
        }

        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.getAttribute('data-action');
        const id = btn.getAttribute('data-id');
        const phone = btn.getAttribute('data-phone') || '';
        const painterId = btn.getAttribute('data-painter-id');
        const leadId = btn.getAttribute('data-lead-id') || id;

        switch (action) {
            case 'call-lead': {
                // Allow the default <a href="tel:..."> behaviour to fire.
                return;
            }
            case 'wa-lead': {
                // Default link opens wa.me — also log a followup.
                if (leadId) logWhatsappTap(leadId);
                return;
            }
            case 'open-followup': openFollowup(leadId); break;
            case 'open-invite':   openInvite(leadId);   break;
            case 'close-modal':   closeModal();         break;
            case 'save-followup': saveFollowup(leadId); break;
            case 'save-invite':   saveInvite(leadId);   break;
            case 'approve-painter':
                if (painterId) approvePainter(painterId, leadId);
                break;
            default:
                break;
        }
    });

    // Initialize
    load();
})();
