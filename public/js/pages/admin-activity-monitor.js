// ── Activity type definitions ──
const ACTIVITY_ICONS = {
    marketing:              { emoji: '📢', label: 'Marketing',        color: '#8b5cf6', bg: '#ede9fe' },
    outstanding_followup:   { emoji: '💰', label: 'Outstanding',      color: '#f59e0b', bg: '#fef3c7' },
    material_arrangement:   { emoji: '📦', label: 'Material Arrange', color: '#3b82f6', bg: '#dbeafe' },
    material_receiving:     { emoji: '🚛', label: 'Material Receiving',color: '#06b6d4', bg: '#cffafe' },
    attending_customer:     { emoji: '🤝', label: 'Customer',         color: '#10b981', bg: '#d1fae5' },
    shop_maintenance:       { emoji: '🧹', label: 'Maintenance',      color: '#64748b', bg: '#f1f5f9' }
};

const ACTIVITY_KEYS = Object.keys(ACTIVITY_ICONS);

let refreshInterval = null;
let liveData = null;

// ── Helpers ──
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatMinutes(m) {
    if (!m && m !== 0) return '-';
    m = Math.round(m);
    if (m < 60) return m + 'm';
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return h + 'h ' + (rm > 0 ? rm + 'm' : '');
}

function elapsedSince(dateStr) {
    if (!dateStr) return '';
    const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
    if (diff < 1) return 'just now';
    if (diff < 60) return diff + 'm ago';
    const h = Math.floor(diff / 60);
    const m = diff % 60;
    return h + 'h ' + m + 'm';
}

function elapsedMinutes(dateStr) {
    if (!dateStr) return 0;
    return Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
}

function timeStr(dateStr) {
    if (!dateStr) return '-';
    const d = new Date(dateStr);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
}

// ── Initialize ──
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('summaryDate').value = todayISO();
    loadBranches();
    loadLiveData();
    loadDaySummary();
    startAutoRefresh();
});

// ── Auto-refresh ──
function startAutoRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(function() {
        if (document.getElementById('autoRefresh').checked) {
            loadLiveData();
        }
    }, 30000);
}

function refreshAll() {
    const icon = document.getElementById('refreshIcon');
    icon.classList.add('refresh-spin');
    loadLiveData().finally(function() {
        setTimeout(function() { icon.classList.remove('refresh-spin'); }, 500);
    });
    loadDaySummary();
}

// ── Load branches ──
async function loadBranches() {
    try {
        const res = await fetch('/api/branches', { headers: getAuthHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        const sel = document.getElementById('summaryBranch');
        const branches = data.branches || data || [];
        branches.forEach(function(b) {
            const opt = document.createElement('option');
            opt.value = b.id;
            opt.textContent = b.name || b.branch_name || ('Branch ' + b.id);
            sel.appendChild(opt);
        });
    } catch (e) { console.error('Failed to load branches:', e); }
}

// ── Load live data ──
async function loadLiveData() {
    try {
        const res = await fetch('/api/activity-tracker/admin/live', { headers: getAuthHeaders() });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        liveData = data;
        renderSummaryCards(data);
        renderStaffCards(data);
        document.getElementById('lastUpdated').textContent = 'Updated ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    } catch (e) {
        console.error('Failed to load live data:', e);
        document.getElementById('lastUpdated').textContent = 'Failed to load - ' + e.message;
    }
}

// ── Render summary cards ──
function renderSummaryCards(data) {
    const activeStaff = (data.active_staff || []);
    const idleStaff = (data.idle_staff || []);
    const breakStaff = (data.on_break_staff || []);

    const activeCount = activeStaff.length;
    const idleCount = idleStaff.length;
    const breakCount = breakStaff.length;

    // Count per activity type
    const typeCounts = {};
    ACTIVITY_KEYS.forEach(function(k) { typeCounts[k] = 0; });
    activeStaff.forEach(function(s) {
        const t = s.activity_type || s.current_activity;
        if (t && typeCounts[t] !== undefined) typeCounts[t]++;
    });

    // Main summary cards
    document.getElementById('summaryCards').innerHTML =
        renderSummaryCard('Active', activeCount, '#10b981', '#d1fae5') +
        renderSummaryCard('Idle', idleCount, '#f59e0b', '#fef3c7') +
        renderSummaryCard('On Break', breakCount, '#3b82f6', '#dbeafe') +
        renderSummaryCard('Total Tracked', activeCount + idleCount + breakCount, '#667eea', '#eef2ff');

    // Activity type cards
    let typeHtml = '';
    ACTIVITY_KEYS.forEach(function(k) {
        const info = ACTIVITY_ICONS[k];
        typeHtml += '<div class="summary-card" style="display:flex;align-items:center;gap:10px;text-align:left;">' +
            '<span style="font-size:20px;">' + info.emoji + '</span>' +
            '<div>' +
                '<div style="font-size:20px;font-weight:700;color:' + info.color + ';">' + typeCounts[k] + '</div>' +
                '<div class="summary-label">' + escapeHtml(info.label) + '</div>' +
            '</div></div>';
    });
    document.getElementById('activityTypeCounts').innerHTML = typeHtml;
}

function renderSummaryCard(label, value, color, bg) {
    return '<div class="summary-card">' +
        '<div style="width:36px;height:36px;border-radius:10px;background:' + bg + ';display:flex;align-items:center;justify-content:center;margin:0 auto 8px;">' +
            '<div style="width:12px;height:12px;border-radius:50%;background:' + color + ';"></div>' +
        '</div>' +
        '<div class="summary-value" style="color:' + color + ';">' + value + '</div>' +
        '<div class="summary-label">' + escapeHtml(label) + '</div>' +
    '</div>';
}

// ── Render staff cards ──
function renderStaffCards(data) {
    const activeStaff = data.active_staff || [];
    const idleStaff = data.idle_staff || [];
    const breakStaff = data.on_break_staff || [];

    // Active cards
    document.getElementById('activeCount').textContent = activeStaff.length;
    if (activeStaff.length === 0) {
        document.getElementById('activeStaffGrid').innerHTML =
            '<div class="empty-state" style="grid-column:1/-1;padding:24px;"><p>No active staff right now</p></div>';
    } else {
        document.getElementById('activeStaffGrid').innerHTML = activeStaff.map(function(s) {
            const type = s.activity_type || s.current_activity || 'unknown';
            const info = ACTIVITY_ICONS[type] || { emoji: '❓', label: type, color: '#64748b', bg: '#f1f5f9' };
            const elapsed = elapsedSince(s.started_at || s.activity_started_at);
            return '<div class="staff-card active" data-user-id="' + s.user_id + '" data-name="' + escapeHtml(s.full_name || s.name || '') + '">' +
                '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
                    '<div>' +
                        '<div style="font-size:14px;font-weight:600;color:#0f172a;">' + escapeHtml(s.full_name || s.name) + '</div>' +
                        '<div style="font-size:11px;color:#94a3b8;margin-top:2px;">' + escapeHtml(s.branch_name || '') + '</div>' +
                    '</div>' +
                    '<span class="badge badge-green">Active</span>' +
                '</div>' +
                '<div style="margin-top:12px;display:flex;align-items:center;gap:8px;">' +
                    '<span style="font-size:20px;">' + info.emoji + '</span>' +
                    '<div>' +
                        '<div style="font-size:13px;font-weight:600;color:' + info.color + ';">' + escapeHtml(info.label) + '</div>' +
                        '<div class="elapsed">' + elapsed + '</div>' +
                    '</div>' +
                '</div>' +
            '</div>';
        }).join('');
    }

    // Idle cards
    document.getElementById('idleCount').textContent = idleStaff.length;
    if (idleStaff.length === 0) {
        document.getElementById('idleStaffGrid').innerHTML =
            '<div class="empty-state" style="grid-column:1/-1;padding:24px;"><p>No idle staff</p></div>';
    } else {
        document.getElementById('idleStaffGrid').innerHTML = idleStaff.map(function(s) {
            const idleMins = s.idle_minutes || elapsedMinutes(s.last_activity_end || s.idle_since);
            return '<div class="staff-card idle" data-user-id="' + s.user_id + '" data-name="' + escapeHtml(s.full_name || s.name || '') + '">' +
                '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
                    '<div>' +
                        '<div style="font-size:14px;font-weight:600;color:#0f172a;">' + escapeHtml(s.full_name || s.name) + '</div>' +
                        '<div style="font-size:11px;color:#94a3b8;margin-top:2px;">' + escapeHtml(s.branch_name || '') + '</div>' +
                    '</div>' +
                    '<span class="badge badge-amber">IDLE ' + formatMinutes(idleMins) + '</span>' +
                '</div>' +
                '<div style="margin-top:12px;display:flex;align-items:center;justify-content:space-between;">' +
                    '<div class="elapsed">Last active: ' + (s.last_activity_end ? elapsedSince(s.last_activity_end) : 'N/A') + '</div>' +
                    '<button class="btn-reminder" data-action="sendReminder" data-user-id="' + s.user_id + '">Send Reminder</button>' +
                '</div>' +
            '</div>';
        }).join('');
    }

    // Break cards
    document.getElementById('breakCount').textContent = breakStaff.length;
    if (breakStaff.length === 0) {
        document.getElementById('breakStaffGrid').innerHTML =
            '<div class="empty-state" style="grid-column:1/-1;padding:24px;"><p>No staff on break</p></div>';
    } else {
        document.getElementById('breakStaffGrid').innerHTML = breakStaff.map(function(s) {
            const elapsed = elapsedSince(s.break_started_at || s.started_at);
            return '<div class="staff-card on-break" data-user-id="' + s.user_id + '" data-name="' + escapeHtml(s.full_name || s.name || '') + '">' +
                '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
                    '<div>' +
                        '<div style="font-size:14px;font-weight:600;color:#0f172a;">' + escapeHtml(s.full_name || s.name) + '</div>' +
                        '<div style="font-size:11px;color:#94a3b8;margin-top:2px;">' + escapeHtml(s.branch_name || '') + '</div>' +
                    '</div>' +
                    '<span class="badge badge-blue">Break ' + elapsed + '</span>' +
                '</div>' +
            '</div>';
        }).join('');
    }
}

// ── Staff card click (event delegation: cards are rebuilt on every refresh; the
//    Send Reminder button stops propagation so it never triggers the card) ──
document.addEventListener('click', function(e) {
    if (e.target.closest('.btn-reminder')) return;
    const card = e.target.closest('.staff-card[data-user-id]');
    if (card) viewStaffTimeline(Number(card.dataset.userId), card.dataset.name || '');
});

// ── Send Reminder ──
async function sendReminder(userId, btn) {
    if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }
    try {
        const res = await fetch('/api/activity-tracker/admin/send-reminder/' + userId, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        if (!res.ok) {
            const err = await res.json().catch(function() { return {}; });
            throw new Error(err.error || 'Failed');
        }
        if (btn) { btn.textContent = 'Sent!'; btn.style.background = '#d1fae5'; btn.style.color = '#065f46'; btn.style.borderColor = '#10b981'; }
        setTimeout(function() {
            if (btn) { btn.textContent = 'Send Reminder'; btn.disabled = false; btn.style.background = ''; btn.style.color = ''; btn.style.borderColor = ''; }
        }, 3000);
    } catch (e) {
        alert('Failed to send reminder: ' + e.message);
        if (btn) { btn.disabled = false; btn.textContent = 'Send Reminder'; }
    }
}

// ── Day Summary ──
async function loadDaySummary() {
    const date = document.getElementById('summaryDate').value;
    const branch = document.getElementById('summaryBranch').value;
    if (!date) return;

    const container = document.getElementById('summaryTableContainer');
    container.innerHTML = '<div style="text-align:center;padding:24px;color:#94a3b8;">Loading summary...</div>';

    try {
        let url = '/api/activity-tracker/admin/summary?date=' + date;
        if (branch) url += '&branch_id=' + branch;
        const res = await fetch(url, { headers: getAuthHeaders() });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        renderDaySummary(data);
    } catch (e) {
        console.error('Failed to load summary:', e);
        container.innerHTML = '<div class="empty-state"><p>Failed to load summary: ' + escapeHtml(e.message) + '</p></div>';
    }
}

function renderDaySummary(data) {
    const container = document.getElementById('summaryTableContainer');
    const staffSummaries = data.staff_summaries || data.summaries || data || [];

    if (!Array.isArray(staffSummaries) || staffSummaries.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No activity data for this date</p></div>';
        return;
    }

    // Build totals
    const totals = {};
    ACTIVITY_KEYS.forEach(function(k) { totals[k] = 0; });
    let grandTotal = 0;

    let rows = staffSummaries.map(function(s) {
        let rowTotal = 0;
        let cells = '';
        ACTIVITY_KEYS.forEach(function(k) {
            const mins = s[k] || (s.activities && s.activities[k]) || 0;
            totals[k] += mins;
            rowTotal += mins;
            cells += '<td style="text-align:center;">' + (mins > 0 ? formatMinutes(mins) : '<span style="color:#cbd5e1;">-</span>') + '</td>';
        });
        grandTotal += rowTotal;
        return '<tr>' +
            '<td style="font-weight:600;">' + escapeHtml(s.full_name || s.name || s.staff_name) + '</td>' +
            cells +
            '<td style="text-align:center;font-weight:700;">' + formatMinutes(rowTotal) + '</td>' +
        '</tr>';
    }).join('');

    // Totals row
    let totalCells = '';
    ACTIVITY_KEYS.forEach(function(k) {
        totalCells += '<td style="text-align:center;">' + (totals[k] > 0 ? formatMinutes(totals[k]) : '-') + '</td>';
    });

    const html = '<table class="summary-table">' +
        '<thead><tr>' +
            '<th>Staff Name</th>' +
            ACTIVITY_KEYS.map(function(k) { return '<th style="text-align:center;">' + ACTIVITY_ICONS[k].emoji + ' ' + escapeHtml(ACTIVITY_ICONS[k].label) + '</th>'; }).join('') +
            '<th style="text-align:center;">Total</th>' +
        '</tr></thead>' +
        '<tbody>' + rows +
        '<tr class="total-row"><td>TOTAL</td>' + totalCells + '<td style="text-align:center;">' + formatMinutes(grandTotal) + '</td></tr>' +
        '</tbody></table>';

    container.innerHTML = html;
}

// ── Staff Timeline Slideout ──
async function viewStaffTimeline(userId, name) {
    document.getElementById('slideoutOverlay').classList.add('active');
    document.getElementById('slideoutPanel').classList.add('active');
    document.getElementById('slideoutTitle').textContent = (name || '') + '\'s Timeline';
    document.getElementById('slideoutSubtitle').textContent = 'Today - ' + new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' });
    document.getElementById('slideoutBody').innerHTML = '<div style="text-align:center;padding:24px;color:#94a3b8;">Loading timeline...</div>';

    try {
        const res = await fetch('/api/activity-tracker/admin/staff/' + userId + '/timeline', { headers: getAuthHeaders() });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        renderTimeline(data);
    } catch (e) {
        document.getElementById('slideoutBody').innerHTML = '<div class="empty-state"><p>Failed to load timeline: ' + escapeHtml(e.message) + '</p></div>';
    }
}

function renderTimeline(data) {
    const entries = data.timeline || data.entries || data || [];
    const body = document.getElementById('slideoutBody');

    if (!Array.isArray(entries) || entries.length === 0) {
        body.innerHTML = '<div class="empty-state"><p>No activity entries for today</p></div>';
        return;
    }

    // Summary at top
    const totalMins = entries.reduce(function(acc, e) { return acc + (e.duration_minutes || 0); }, 0);
    let summaryHtml = '<div style="background:#f8fafc;border-radius:10px;padding:14px;margin-bottom:16px;">' +
        '<div style="font-size:12px;color:#64748b;font-weight:500;">Total Activity Time</div>' +
        '<div style="font-size:22px;font-weight:700;color:#0f172a;">' + formatMinutes(totalMins) + '</div>' +
        '<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;">';

    // Per-type breakdown
    const typeBreakdown = {};
    entries.forEach(function(e) {
        const t = e.activity_type;
        if (!typeBreakdown[t]) typeBreakdown[t] = 0;
        typeBreakdown[t] += (e.duration_minutes || 0);
    });
    Object.keys(typeBreakdown).forEach(function(t) {
        const info = ACTIVITY_ICONS[t] || { emoji: '❓', label: t, bg: '#f1f5f9', color: '#64748b' };
        summaryHtml += '<span style="background:' + info.bg + ';color:' + info.color + ';padding:3px 8px;border-radius:8px;font-size:11px;font-weight:600;">' +
            info.emoji + ' ' + escapeHtml(info.label) + ': ' + formatMinutes(typeBreakdown[t]) + '</span>';
    });
    summaryHtml += '</div></div>';

    // Timeline entries
    let timelineHtml = entries.map(function(e) {
        const info = ACTIVITY_ICONS[e.activity_type] || { emoji: '❓', label: e.activity_type, bg: '#f1f5f9', color: '#64748b' };
        const isActive = !e.ended_at;
        const duration = e.duration_minutes ? formatMinutes(e.duration_minutes) : (isActive ? 'In progress' : '-');

        return '<div class="timeline-entry">' +
            '<div class="timeline-dot ' + (isActive ? 'active' : 'completed') + '">' + info.emoji + '</div>' +
            '<div style="flex:1;min-width:0;">' +
                '<div style="display:flex;justify-content:space-between;align-items:center;">' +
                    '<div style="font-size:13px;font-weight:600;color:' + info.color + ';">' + escapeHtml(info.label) + '</div>' +
                    '<div style="font-size:11px;color:#94a3b8;">' + duration + '</div>' +
                '</div>' +
                '<div style="font-size:12px;color:#64748b;margin-top:2px;">' +
                    timeStr(e.started_at) + (e.ended_at ? ' - ' + timeStr(e.ended_at) : ' - ongoing') +
                '</div>' +
                (e.notes ? '<div style="font-size:12px;color:#94a3b8;margin-top:4px;font-style:italic;">' + escapeHtml(e.notes) + '</div>' : '') +
            '</div>' +
        '</div>';
    }).join('');

    body.innerHTML = summaryHtml + timelineHtml;
}

function closeSlideout() {
    document.getElementById('slideoutOverlay').classList.remove('active');
    document.getElementById('slideoutPanel').classList.remove('active');
}

// Close on Escape key
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') closeSlideout();
});

// ── Tab switching ──
function switchTab(tab) {
    document.getElementById('tabContentLive').style.display = tab === 'live' ? '' : 'none';
    document.getElementById('tabContentReport').style.display = tab === 'report' ? '' : 'none';

    document.getElementById('tabLive').style.color = tab === 'live' ? '#667eea' : '#64748b';
    document.getElementById('tabLive').style.borderBottomColor = tab === 'live' ? '#667eea' : 'transparent';
    document.getElementById('tabReport').style.color = tab === 'report' ? '#667eea' : '#64748b';
    document.getElementById('tabReport').style.borderBottomColor = tab === 'report' ? '#667eea' : 'transparent';

    if (tab === 'report' && !document.getElementById('reportDate').value) {
        document.getElementById('reportDate').value = todayISO();
        loadReportBranches();
        loadDailyReport();
    }
}

async function loadReportBranches() {
    try {
        const res = await fetch('/api/branches', { headers: getAuthHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        const sel = document.getElementById('reportBranch');
        if (sel.options.length > 1) return;
        const branches = data.branches || data || [];
        branches.forEach(function(b) {
            const opt = document.createElement('option');
            opt.value = b.id;
            opt.textContent = b.name || b.branch_name || ('Branch ' + b.id);
            sel.appendChild(opt);
        });
    } catch (e) { console.error('Failed to load report branches:', e); }
}

// ── Daily Report ──
let currentReportData = null;

async function loadDailyReport() {
    const date = document.getElementById('reportDate').value;
    if (!date) return;

    const container = document.getElementById('reportTableContainer');
    container.innerHTML = '<div style="text-align:center;padding:24px;color:#94a3b8;">Loading report...</div>';
    document.getElementById('reportSummaryCards').innerHTML = '';

    try {
        let url = '/api/activity-tracker/admin/daily-report?date=' + date;
        const res = await fetch(url, { headers: getAuthHeaders() });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const data = await res.json();
        currentReportData = data;

        const report = data.report || [];
        const branchFilter = document.getElementById('reportBranch').value;
        const filtered = branchFilter ? report.filter(function(r) { return String(r.branch_id) === branchFilter; }) : report;

        renderReportSummary(filtered);
        renderReportTable(filtered, data.pdf_url);
    } catch (e) {
        console.error('Failed to load daily report:', e);
        container.innerHTML = '<div class="empty-state"><p>Failed to load: ' + escapeHtml(e.message) + '</p></div>';
    }
}

function renderReportSummary(data) {
    if (!data || data.length === 0) {
        document.getElementById('reportSummaryCards').innerHTML = '';
        return;
    }

    var totalStaff = data.length;
    var totalActive = data.reduce(function(s, r) { return s + r.total_active; }, 0);
    var totalIdle = data.reduce(function(s, r) { return s + r.idle_minutes; }, 0);
    var avgIdlePct = Math.round(data.reduce(function(s, r) { return s + r.idle_percent; }, 0) / totalStaff);

    document.getElementById('reportSummaryCards').innerHTML =
        renderSummaryCard('Total Staff', totalStaff, '#667eea', '#eef2ff') +
        renderSummaryCard('Active Time', formatMinutes(totalActive), '#10b981', '#d1fae5') +
        '<div class="summary-card"><div style="width:36px;height:36px;border-radius:10px;background:#fef3c7;display:flex;align-items:center;justify-content:center;margin:0 auto 8px;"><div style="width:12px;height:12px;border-radius:50%;background:#f59e0b;"></div></div><div class="summary-value" style="color:#f59e0b;">' + formatMinutes(totalIdle) + '</div><div class="summary-label">வேலை செய்யாமல் இருந்த நேரம்</div></div>' +
        renderSummaryCard('Avg Idle %', avgIdlePct + '%', avgIdlePct > 30 ? '#ef4444' : '#f59e0b', avgIdlePct > 30 ? '#fef2f2' : '#fef3c7');
}

function renderReportTable(data, pdfUrl) {
    var container = document.getElementById('reportTableContainer');

    if (!data || data.length === 0) {
        container.innerHTML = '<div class="empty-state"><p>No activity data for this date</p></div>';
        return;
    }

    var grandTotalActive = 0, grandTotalIdle = 0;
    var actTypes = [
        { key: 'marketing', label: 'MKT', emoji: '📢' },
        { key: 'outstanding_followup', label: 'OUT', emoji: '💰' },
        { key: 'material_arrangement', label: 'MAT', emoji: '📦' },
        { key: 'material_receiving', label: 'RCV', emoji: '🚛' },
        { key: 'attending_customer', label: 'CUS', emoji: '🤝' },
        { key: 'shop_maintenance', label: 'SHP', emoji: '🧹' }
    ];

    var actTotals = {};
    actTypes.forEach(function(a) { actTotals[a.key] = 0; });

    var rows = data.map(function(s, idx) {
        grandTotalActive += s.total_active;
        grandTotalIdle += s.idle_minutes;

        var cells = '';
        actTypes.forEach(function(a) {
            var mins = s.activities[a.key] ? s.activities[a.key].minutes : 0;
            actTotals[a.key] += mins;
            cells += '<td style="text-align:center;">' + (mins > 0 ? formatMinutes(mins) : '<span style="color:#cbd5e1;">-</span>') + '</td>';
        });

        var idleColor = s.idle_percent > 50 ? '#ef4444' : (s.idle_percent > 30 ? '#f59e0b' : '#10b981');

        return '<tr>' +
            '<td>' + (idx + 1) + '</td>' +
            '<td style="font-weight:600;">' + escapeHtml(s.full_name) + '</td>' +
            '<td>' + escapeHtml(s.branch_name) + '</td>' +
            '<td>' + escapeHtml(s.clock_in) + '</td>' +
            '<td>' + escapeHtml(s.clock_out) + '</td>' +
            cells +
            '<td style="text-align:center;font-weight:600;color:#10b981;">' + formatMinutes(s.total_active) + '</td>' +
            '<td style="text-align:center;font-weight:600;color:' + idleColor + ';">' + formatMinutes(s.idle_minutes) + '</td>' +
            '<td style="text-align:center;font-weight:700;color:' + idleColor + ';">' + s.idle_percent + '%</td>' +
        '</tr>';
    }).join('');

    var totalCells = '';
    actTypes.forEach(function(a) {
        totalCells += '<td style="text-align:center;">' + (actTotals[a.key] > 0 ? formatMinutes(actTotals[a.key]) : '-') + '</td>';
    });

    var html = '<table class="summary-table">' +
        '<thead><tr>' +
            '<th>#</th><th>Staff</th><th>Branch</th><th>In</th><th>Out</th>' +
            actTypes.map(function(a) { return '<th style="text-align:center;" title="' + escapeHtml(a.label) + '">' + a.emoji + ' ' + a.label + '</th>'; }).join('') +
            '<th style="text-align:center;">Active</th>' +
            '<th style="text-align:center;">Idle*</th>' +
            '<th style="text-align:center;">Idle%</th>' +
        '</tr></thead>' +
        '<tbody>' + rows +
        '<tr class="total-row"><td></td><td>TOTAL</td><td></td><td></td><td></td>' +
            totalCells +
            '<td style="text-align:center;">' + formatMinutes(grandTotalActive) + '</td>' +
            '<td style="text-align:center;">' + formatMinutes(grandTotalIdle) + '</td>' +
            '<td></td>' +
        '</tr></tbody></table>' +
        '<div style="padding:8px 12px;font-size:11px;color:#94a3b8;">* Idle (வேலை செய்யாமல் இருந்த நேரம்) = Total Working - Activities - Break - Prayer - Outside Work</div>';

    container.innerHTML = html;
}

async function generateReportPDF() {
    var date = document.getElementById('reportDate').value;
    if (!date) { alert('Please select a date'); return; }

    try {
        var res = await fetch('/api/activity-tracker/admin/daily-report/generate-pdf', {
            method: 'POST',
            headers: Object.assign({}, getAuthHeaders(), { 'Content-Type': 'application/json' }),
            body: JSON.stringify({ date: date })
        });
        if (!res.ok) {
            var err = await res.json().catch(function() { return {}; });
            throw new Error(err.error || 'Failed to generate PDF');
        }
        var data = await res.json();
        if (data.pdf_url) {
            window.open(data.pdf_url, '_blank');
        }
    } catch (e) {
        alert('PDF generation failed: ' + e.message);
    }
}

async function sendActivityReportsToAll(btn) {
    var date = document.getElementById('reportDate').value;
    if (!date) { alert('Please select a date'); return; }
    if (!confirm('Send activity reports to all staff for ' + date + '?')) return;

    btn.disabled = true;
    btn.textContent = 'Sending...';

    try {
        var res = await fetch('/api/activity-tracker/admin/daily-report/send-all', {
            method: 'POST',
            headers: Object.assign({}, getAuthHeaders(), { 'Content-Type': 'application/json' }),
            body: JSON.stringify({ date: date })
        });
        if (!res.ok) {
            var err = await res.json().catch(function() { return {}; });
            throw new Error(err.error || 'Failed');
        }
        btn.textContent = 'Sent!';
        btn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
        setTimeout(function() {
            btn.disabled = false;
            btn.textContent = 'Send to All Staff';
            btn.style.background = 'linear-gradient(135deg, #f59e0b, #d97706)';
        }, 5000);
    } catch (e) {
        alert('Failed: ' + e.message);
        btn.disabled = false;
        btn.textContent = 'Send to All Staff';
    }
}

// ── Socket.io live updates ──
try {
    const socket = io({ auth: { token: localStorage.getItem('auth_token') } });
    socket.on('connect', function() {
        console.log('Activity monitor socket connected');
    });
    socket.on('activity_tracker_update', function(data) {
        loadLiveData();
    });
    socket.on('activity_tracker_idle', function(data) {
        loadLiveData();
    });
} catch (e) {
    console.warn('Socket.io not available:', e);
}

// ── Static handler wiring (externalized from inline on*= attributes; S9+F5 Phase C, 2026-06-25) ──
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('refreshBtn').addEventListener('click', refreshAll);
    document.getElementById('tabLive').addEventListener('click', function() { switchTab('live'); });
    document.getElementById('tabReport').addEventListener('click', function() { switchTab('report'); });
    document.getElementById('btnLoadDaySummary').addEventListener('click', loadDaySummary);
    document.getElementById('btnLoadDailyReport').addEventListener('click', loadDailyReport);
    document.getElementById('btnGeneratePdf').addEventListener('click', generateReportPDF);
    document.getElementById('btnSendAll').addEventListener('click', function(e) { sendActivityReportsToAll(e.currentTarget); });
    document.getElementById('slideoutOverlay').addEventListener('click', closeSlideout);
    document.getElementById('btnCloseSlideout').addEventListener('click', closeSlideout);

    // Delegated runtime handler for Send Reminder buttons (rendered inside idle-staff
    // card templates, rebuilt on every live refresh). data-action keeps it CSP-clean.
    document.addEventListener('click', function(e) {
        var btn = e.target.closest('[data-action="sendReminder"]');
        if (!btn) return;
        e.stopPropagation();
        sendReminder(btn.dataset.userId, btn);
    });
});
