/**
 * Admin Painter Leads Dashboard — JS controller.
 *
 * Wires up:
 *   • GET /api/painter-leads/stats                  → funnel cards
 *   • GET /api/painter-leads?assigned_to=unassigned → unassigned pool table
 *   • GET /api/users?assignable=1                   → staff assign dropdowns
 *   • GET /api/painter-leads?...                    → staff performance rollup
 *   • POST /api/painter-leads/:id/assign            → single + bulk assignment
 *
 * Conventions follow the existing admin-leads.html / admin-painters.html pages:
 *   - getAuthHeaders() / apiFetch() from public/js/auth-helper.js
 *   - esc() helper for safe XSS escaping before innerHTML
 *   - toast() for non-blocking feedback
 *   - No inline event handlers (CSP-safe — all listeners attached via JS)
 */

(function () {
    'use strict';

    // ─── State ──────────────────────────────────────────────────────────
    const state = {
        branches: [],
        staff: [],
        stats: null,
        unassignedLeads: [],
        perf: [], // [{staff_id, full_name, branch_name, assigned, contacted, interested, invited, registered, approved, conversion_pct}]
        unassignedPage: 1,
        unassignedTotalPages: 1,
        filters: {
            status: '',
            branch_id: '',
            assigned_to: '',
            date_from: '',
            date_to: '',
            search: '',
        },
        selectedIds: new Set(),
    };

    const UNASSIGNED_PAGE_SIZE = 25;

    // ─── Utilities ──────────────────────────────────────────────────────

    function esc(value) {
        if (value == null) return '';
        if (typeof value !== 'string') value = String(value);
        return value
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatDate(s) {
        if (!s) return '—';
        const d = new Date(s);
        if (isNaN(d.getTime())) return esc(s);
        return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    function formatStatus(s) {
        if (!s) return '—';
        return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    }

    let toastTimer = null;
    function toast(message, type) {
        const el = document.getElementById('toast');
        if (!el) return;
        el.textContent = message;
        el.classList.remove('success', 'error');
        if (type === 'success') el.classList.add('success');
        if (type === 'error') el.classList.add('error');
        el.classList.add('show');
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
    }

    // ─── Branch dropdown ────────────────────────────────────────────────

    async function loadBranches() {
        try {
            const res = await apiFetch('/api/branches?status=active&limit=200');
            if (res && res.success && Array.isArray(res.data)) {
                state.branches = res.data;
            } else if (Array.isArray(res)) {
                state.branches = res; // some endpoints return raw arrays
            } else {
                state.branches = [];
            }
        } catch (err) {
            console.warn('loadBranches failed (non-fatal):', err.message);
            state.branches = [];
        }
        renderBranchOptions();
    }

    function renderBranchOptions() {
        const sel = document.getElementById('filterBranch');
        if (!sel) return;
        const current = sel.value;
        sel.innerHTML = '<option value="">All Branches</option>' +
            state.branches.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('');
        sel.value = current;
    }

    // ─── Staff dropdown ─────────────────────────────────────────────────

    async function loadStaff() {
        try {
            const res = await apiFetch('/api/users?assignable=1');
            const list = Array.isArray(res) ? res : (res && res.data ? res.data : []);
            // Only assignable field staff (role=staff) are valid assignees for painter leads.
            state.staff = list.filter((u) => {
                const r = String(u.role || '').toLowerCase();
                return r === 'staff' || r === 'manager' || r === 'branch_manager';
            });
        } catch (err) {
            console.warn('loadStaff failed (non-fatal):', err.message);
            state.staff = [];
        }
        renderStaffOptions();
        renderBulkStaffOptions();
    }

    function renderStaffOptions() {
        // Inject into the per-row "Assign To" select templates (kept as
        // <select data-row-assign="...">); populated dynamically per row.
    }

    function renderBulkStaffOptions() {
        const sel = document.getElementById('bulkAssignTo');
        if (!sel) return;
        sel.innerHTML = '<option value="">Choose staff…</option>' +
            state.staff.map((u) => {
                const branch = (u.assigned_branches && u.assigned_branches[0] && u.assigned_branches[0].branch_name)
                    || (state.branches.find((b) => Number(b.id) === Number(u.branch_id)) || {}).name
                    || '';
                const label = branch ? `${u.full_name} (${branch})` : u.full_name;
                return `<option value="${esc(u.id)}">${esc(label)}</option>`;
            }).join('');
    }

    function staffOptionsHtml() {
        return state.staff.map((u) => {
            const branch = (u.assigned_branches && u.assigned_branches[0] && u.assigned_branches[0].branch_name)
                || (state.branches.find((b) => Number(b.id) === Number(u.branch_id)) || {}).name
                || '';
            const label = branch ? `${u.full_name} (${branch})` : u.full_name;
            return `<option value="${esc(u.id)}">${esc(label)}</option>`;
        }).join('');
    }

    // ─── Stats ──────────────────────────────────────────────────────────

    async function loadStats() {
        try {
            const res = await apiFetch('/api/painter-leads/stats');
            if (res && res.success && res.data) {
                state.stats = res.data;
                setStat('statNew', res.data.new_leads);
                setStat('statInProgress', res.data.in_progress);
                setStat('statInterested', res.data.interested);
                setStat('statInvited', res.data.invited);
                setStat('statRegistered', res.data.registered);
                setStat('statActive', res.data.active_painter);
                setStat('statUnassigned', res.data.unassigned);
            }
        } catch (err) {
            console.error('loadStats failed:', err);
            toast('Failed to load stats', 'error');
        }
    }

    function setStat(id, value) {
        const el = document.getElementById(id);
        if (!el) return;
        const n = Number(value || 0);
        el.textContent = Number.isFinite(n) ? n.toLocaleString('en-IN') : '—';
    }

    // ─── Unassigned Pool ────────────────────────────────────────────────

    async function loadUnassigned() {
        const tbody = document.getElementById('unassignedTableBody');
        if (tbody) {
            tbody.innerHTML = `
                <tr><td colspan="8" class="text-center py-8 text-gray-400">
                    <div class="skeleton h-3 w-1/3 mx-auto mb-2"></div>
                    <div class="skeleton h-3 w-1/4 mx-auto"></div>
                </td></tr>`;
        }

        const params = new URLSearchParams();
        params.set('assigned_to', 'unassigned');
        params.set('page', String(state.unassignedPage));
        params.set('limit', String(UNASSIGNED_PAGE_SIZE));
        params.set('sort_by', 'created_at');
        params.set('sort_order', 'DESC');
        if (state.filters.status) params.set('status', state.filters.status);
        if (state.filters.branch_id) params.set('branch_id', state.filters.branch_id);
        if (state.filters.search) params.set('search', state.filters.search);
        if (state.filters.date_from) params.set('date_from', state.filters.date_from);
        if (state.filters.date_to) params.set('date_to', state.filters.date_to);

        try {
            const res = await apiFetch('/api/painter-leads?' + params.toString());
            if (!res || !res.success) {
                throw new Error((res && res.message) || 'Failed to load unassigned pool');
            }
            state.unassignedLeads = Array.isArray(res.data) ? res.data : [];
            const pg = res.pagination || {};
            state.unassignedTotalPages = pg.total_pages || 1;
            renderUnassigned();
            renderUnassignedPagination(pg);
        } catch (err) {
            console.error('loadUnassigned failed:', err);
            if (tbody) {
                tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-red-500">${esc(err.message)}</td></tr>`;
            }
            toast('Failed to load unassigned pool', 'error');
        }
    }

    function renderUnassigned() {
        const tbody = document.getElementById('unassignedTableBody');
        const mobile = document.getElementById('unassignedMobileList');
        const count = document.getElementById('unassignedCount');
        if (count) count.textContent = `${state.unassignedLeads.length} on this page`;

        if (state.unassignedLeads.length === 0) {
            if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-gray-500">No unassigned painter leads.</td></tr>`;
            if (mobile) mobile.innerHTML = '<div class="lead-card text-center text-gray-500">No unassigned painter leads.</div>';
            return;
        }

        if (tbody) {
            tbody.innerHTML = state.unassignedLeads.map((lead) => {
                const checked = state.selectedIds.has(Number(lead.id)) ? 'checked' : '';
                return `
                <tr data-lead-id="${esc(lead.id)}">
                    <td><input type="checkbox" class="row-check" data-lead-id="${esc(lead.id)}" ${checked} aria-label="Select lead ${esc(lead.lead_number || lead.id)}"></td>
                    <td class="font-semibold text-gray-900">${esc(lead.lead_number || ('#' + lead.id))}</td>
                    <td>${esc(lead.full_name)}</td>
                    <td>${esc(lead.phone) || '—'}</td>
                    <td>${esc(lead.branch_name) || '—'}</td>
                    <td><span class="text-xs text-gray-500">${esc((lead.source || '').replace(/_/g, ' '))}</span></td>
                    <td>${formatDate(lead.created_at)}</td>
                    <td>
                        <select class="filter-select row-assign" data-lead-id="${esc(lead.id)}" data-action="row-assign" aria-label="Assign lead ${esc(lead.lead_number || lead.id)} to staff">
                            <option value="">Assign…</option>
                            ${staffOptionsHtml()}
                        </select>
                    </td>
                </tr>`;
            }).join('');
        }

        if (mobile) {
            mobile.innerHTML = state.unassignedLeads.map((lead) => `
                <div class="lead-card" data-lead-id="${esc(lead.id)}">
                    <div class="flex items-start justify-between gap-2 mb-2">
                        <div>
                            <div class="font-semibold text-gray-900">${esc(lead.full_name)}</div>
                            <div class="text-xs text-gray-500">${esc(lead.lead_number || '')} · ${esc(lead.phone) || '—'}</div>
                        </div>
                        <input type="checkbox" class="row-check" data-lead-id="${esc(lead.id)}" aria-label="Select ${esc(lead.full_name)}">
                    </div>
                    <div class="text-xs text-gray-600 mb-2">Branch: ${esc(lead.branch_name) || '—'} · Source: ${esc((lead.source || '').replace(/_/g, ' '))}</div>
                    <select class="filter-select row-assign" data-lead-id="${esc(lead.id)}" data-action="row-assign" aria-label="Assign lead to staff">
                        <option value="">Assign…</option>
                        ${staffOptionsHtml()}
                    </select>
                </div>
            `).join('');
        }
    }

    function renderUnassignedPagination(pg) {
        const el = document.getElementById('unassignedPagination');
        if (!el) return;
        const total = pg && pg.total ? pg.total : 0;
        const page = pg && pg.page ? pg.page : state.unassignedPage;
        const totalPages = pg && pg.total_pages ? pg.total_pages : 1;
        if (total === 0) { el.innerHTML = ''; return; }

        const prevDisabled = page <= 1 ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : '';
        const nextDisabled = page >= totalPages ? 'disabled style="opacity:0.4;cursor:not-allowed;"' : '';
        el.innerHTML = `
            <span>Page ${page} of ${totalPages} · ${total} total</span>
            <div class="flex gap-2">
                <button type="button" class="btn btn-outline btn-sm" data-action="page-prev" ${prevDisabled}>Prev</button>
                <button type="button" class="btn btn-outline btn-sm" data-action="page-next" ${nextDisabled}>Next</button>
            </div>`;
    }

    // ─── Staff Performance ──────────────────────────────────────────────

    async function loadStaffPerformance() {
        const tbody = document.getElementById('staffPerfTableBody');
        if (tbody) {
            tbody.innerHTML = `
                <tr><td colspan="9" class="text-center py-8 text-gray-400">
                    <div class="skeleton h-3 w-1/3 mx-auto mb-2"></div>
                    <div class="skeleton h-3 w-1/4 mx-auto"></div>
                </td></tr>`;
        }

        try {
            // Pull a windowed view (last 90 days) of all leads, then aggregate
            // per-staff client-side. This keeps the dashboard independent of a
            // dedicated /performance endpoint and works against the existing
            // list API.
            const params = new URLSearchParams();
            params.set('limit', '500');
            const from = new Date();
            from.setDate(from.getDate() - 90);
            params.set('date_from', from.toISOString().slice(0, 10));

            const res = await apiFetch('/api/painter-leads?' + params.toString());
            if (!res || !res.success) throw new Error((res && res.message) || 'Failed to load leads');
            const leads = Array.isArray(res.data) ? res.data : [];

            const map = new Map();
            leads.forEach((lead) => {
                if (!lead.assigned_to) return;
                const key = Number(lead.assigned_to);
                if (!map.has(key)) {
                    map.set(key, {
                        staff_id: key,
                        full_name: lead.assigned_to_name || ('User #' + key),
                        branch_name: lead.branch_name || '',
                        assigned: 0,
                        contacted: 0,
                        interested: 0,
                        invited: 0,
                        registered: 0,
                        approved: 0,
                    });
                }
                const row = map.get(key);
                row.assigned += 1;
                if (lead.last_contact_date) row.contacted += 1;
                if (lead.status === 'interested') row.interested += 1;
                if (lead.status === 'invited' || lead.invited_at) row.invited += 1;
                if (lead.status === 'registered' || lead.painter_id) row.registered += 1;
                if (lead.status === 'active_painter' || lead.approved_at) row.approved += 1;
            });

            state.perf = Array.from(map.values()).map((row) => {
                const pct = row.assigned > 0 ? Math.round((row.approved / row.assigned) * 100) : 0;
                return Object.assign({}, row, { conversion_pct: pct });
            }).sort((a, b) => b.assigned - a.assigned);

            renderStaffPerformance();
        } catch (err) {
            console.error('loadStaffPerformance failed:', err);
            if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-red-500">${esc(err.message)}</td></tr>`;
            toast('Failed to load staff performance', 'error');
        }
    }

    function renderStaffPerformance() {
        const tbody = document.getElementById('staffPerfTableBody');
        const count = document.getElementById('staffCount');
        if (count) count.textContent = `${state.perf.length} staff`;

        if (state.perf.length === 0) {
            tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-gray-500">No staff with assigned painter leads in the last 90 days.</td></tr>`;
            return;
        }
        tbody.innerHTML = state.perf.map((row) => {
            const pctClass = row.conversion_pct >= 30
                ? 'bg-green-100 text-green-700'
                : row.conversion_pct >= 10
                    ? 'bg-yellow-100 text-yellow-700'
                    : 'bg-gray-100 text-gray-600';
            return `
            <tr>
                <td class="font-semibold text-gray-900">${esc(row.full_name)}</td>
                <td>${esc(row.branch_name) || '—'}</td>
                <td class="text-center">${row.assigned}</td>
                <td class="text-center">${row.contacted}</td>
                <td class="text-center">${row.interested}</td>
                <td class="text-center">${row.invited}</td>
                <td class="text-center">${row.registered}</td>
                <td class="text-center">${row.approved}</td>
                <td class="text-center"><span class="px-2 py-1 rounded-full text-xs font-bold ${pctClass}">${row.conversion_pct}%</span></td>
            </tr>`;
        }).join('');
    }

    // ─── Assignment ─────────────────────────────────────────────────────

    async function assignLead(leadId, staffId) {
        if (!staffId) return;
        const body = JSON.stringify({ assigned_to: Number(staffId) });
        try {
            const res = await apiFetch(`/api/painter-leads/${leadId}/assign`, {
                method: 'POST',
                body,
            });
            if (res && res.success) {
                toast('Lead assigned', 'success');
                state.selectedIds.delete(Number(leadId));
                await Promise.all([loadStats(), loadUnassigned(), loadStaffPerformance()]);
            } else {
                throw new Error((res && res.message) || 'Assignment failed');
            }
        } catch (err) {
            console.error('assignLead failed:', err);
            toast('Assignment failed: ' + err.message, 'error');
        }
    }

    async function bulkAssign() {
        const sel = document.getElementById('bulkAssignTo');
        const staffId = sel ? sel.value : '';
        if (!staffId) { toast('Choose a staff member first', 'error'); return; }
        const ids = Array.from(state.selectedIds);
        if (ids.length === 0) { toast('Select at least one lead', 'error'); return; }

        const btn = document.getElementById('bulkAssignBtn');
        if (btn) { btn.disabled = true; btn.textContent = 'Assigning…'; }
        try {
            const results = await Promise.allSettled(
                ids.map((id) => apiFetch(`/api/painter-leads/${id}/assign`, {
                    method: 'POST',
                    body: JSON.stringify({ assigned_to: Number(staffId) }),
                }))
            );
            const ok = results.filter((r) => r.status === 'fulfilled' && r.value && r.value.success).length;
            const failed = results.length - ok;
            if (ok > 0) toast(`${ok} assigned${failed > 0 ? `, ${failed} failed` : ''}`, failed > 0 ? 'error' : 'success');
            else toast('Bulk assignment failed', 'error');
            state.selectedIds.clear();
            await Promise.all([loadStats(), loadUnassigned(), loadStaffPerformance()]);
        } finally {
            if (btn) { btn.disabled = false; btn.textContent = 'Assign Selected'; }
            if (sel) sel.value = '';
            updateBulkBar();
        }
    }

    function updateBulkBar() {
        const bar = document.getElementById('bulkAssignBar');
        const counter = document.getElementById('bulkSelectedCount');
        const selectAll = document.getElementById('selectAllUnassigned');
        if (counter) counter.textContent = String(state.selectedIds.size);
        if (bar) bar.classList.toggle('active', state.selectedIds.size > 0);
        if (selectAll) {
            const total = state.unassignedLeads.length;
            selectAll.checked = total > 0 && state.selectedIds.size === total;
            selectAll.indeterminate = state.selectedIds.size > 0 && state.selectedIds.size < total;
        }
    }

    // ─── Filters ────────────────────────────────────────────────────────

    function readFiltersFromForm() {
        state.filters.status = (document.getElementById('filterStatus') || {}).value || '';
        state.filters.branch_id = (document.getElementById('filterBranch') || {}).value || '';
        state.filters.assigned_to = (document.getElementById('filterAssignedTo') || {}).value || '';
        state.filters.date_from = (document.getElementById('filterDateFrom') || {}).value || '';
        state.filters.date_to = (document.getElementById('filterDateTo') || {}).value || '';
        state.filters.search = ((document.getElementById('filterSearch') || {}).value || '').trim();
    }

    function resetFilters() {
        ['filterStatus', 'filterBranch', 'filterAssignedTo', 'filterDateFrom', 'filterDateTo', 'filterSearch']
            .forEach((id) => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
        state.filters = { status: '', branch_id: '', assigned_to: '', date_from: '', date_to: '', search: '' };
        state.unassignedPage = 1;
        state.selectedIds.clear();
        updateBulkBar();
        loadUnassigned();
    }

    // ─── Wire-up ────────────────────────────────────────────────────────

    function attachListeners() {
        const apply = document.getElementById('applyFiltersBtn');
        if (apply) apply.addEventListener('click', () => {
            readFiltersFromForm();
            state.unassignedPage = 1;
            state.selectedIds.clear();
            updateBulkBar();
            loadUnassigned();
        });
        const reset = document.getElementById('resetFiltersBtn');
        if (reset) reset.addEventListener('click', resetFilters);
        const refresh = document.getElementById('refreshBtn');
        if (refresh) refresh.addEventListener('click', () => {
            loadStats();
            loadUnassigned();
            loadStaffPerformance();
        });
        const search = document.getElementById('filterSearch');
        if (search) search.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                readFiltersFromForm();
                state.unassignedPage = 1;
                loadUnassigned();
            }
        });

        const bulkBtn = document.getElementById('bulkAssignBtn');
        if (bulkBtn) bulkBtn.addEventListener('click', bulkAssign);
        const bulkClear = document.getElementById('bulkClearBtn');
        if (bulkClear) bulkClear.addEventListener('click', () => {
            state.selectedIds.clear();
            document.querySelectorAll('.row-check').forEach((c) => { c.checked = false; });
            updateBulkBar();
        });

        // Delegated change/click handlers
        document.addEventListener('change', (e) => {
            const t = e.target;
            if (!t) return;
            if (t.id === 'selectAllUnassigned') {
                const checked = !!t.checked;
                state.unassignedLeads.forEach((l) => {
                    if (checked) state.selectedIds.add(Number(l.id));
                    else state.selectedIds.delete(Number(l.id));
                });
                document.querySelectorAll('.row-check').forEach((c) => { c.checked = checked; });
                updateBulkBar();
                return;
            }
            if (t.classList && t.classList.contains('row-check')) {
                const id = Number(t.dataset.leadId);
                if (t.checked) state.selectedIds.add(id);
                else state.selectedIds.delete(id);
                updateBulkBar();
                return;
            }
            if (t.classList && t.classList.contains('row-assign')) {
                const id = Number(t.dataset.leadId);
                const staffId = t.value;
                t.value = '';
                assignLead(id, staffId);
            }
        });

        document.addEventListener('click', (e) => {
            const t = e.target.closest('[data-action]');
            if (!t) return;
            const action = t.dataset.action;
            if (action === 'page-prev' && state.unassignedPage > 1) {
                state.unassignedPage -= 1;
                loadUnassigned();
            } else if (action === 'page-next' && state.unassignedPage < state.unassignedTotalPages) {
                state.unassignedPage += 1;
                loadUnassigned();
            }
        });
    }

    // ─── Init ───────────────────────────────────────────────────────────

    async function init() {
        attachListeners();
        try {
            await loadBranches();
            await Promise.all([
                loadStaff(),
                loadStats(),
                loadUnassigned(),
                loadStaffPerformance(),
            ]);
        } catch (err) {
            console.error('Init error:', err);
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
