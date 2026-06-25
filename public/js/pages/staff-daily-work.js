// Page logic externalized from staff-daily-work.html inline <script> (S9+F5 Phase E batch 11, 2026-06-25)
// so the page runs under the enforced strict CSP. Verbatim move of all functions; inline on*=
// handlers converted to addEventListener + data-action delegation. No logic changes, no renames,
// escaping helpers untouched.
const API_BASE = '/api/staff/daily-work';
let dashboardData = null;

// ─── Init ──────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('headerDate').textContent = now.toLocaleDateString('ta-IN', options);
    loadDashboard();
});

// ─── API Helper ────────────────────────────────────────────────

async function api(url, options = {}) {
    const token = localStorage.getItem('auth_token');
    const res = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            ...options.headers
        }
    });
    return res.json();
}

// ─── Load Dashboard ────────────────────────────────────────────

async function loadDashboard() {
    try {
        const result = await api(API_BASE);
        if (!result.success) throw new Error(result.message);
        dashboardData = result.data;
        renderAll();
    } catch (e) {
        console.error('Dashboard load error:', e);
        showToast('Failed to load dashboard', 'error');
    }
}

function renderAll() {
    const d = dashboardData;

    // Attendance badge
    const dot = document.getElementById('attendanceDot');
    const text = document.getElementById('attendanceText');
    if (d.attendance.clocked_in && !d.attendance.clocked_out) {
        dot.className = 'w-2.5 h-2.5 rounded-full bg-green-400 pulse-dot';
        text.textContent = 'Working';
    } else if (d.attendance.clocked_out) {
        dot.className = 'w-2.5 h-2.5 rounded-full bg-gray-400';
        text.textContent = 'Shift Done';
    } else {
        dot.className = 'w-2.5 h-2.5 rounded-full bg-yellow-400 pulse-dot';
        text.textContent = 'Not Clocked In';
    }

    // Stats
    document.getElementById('statFollowups').textContent = d.leads.stats.followups_today || 0;
    document.getElementById('statOverdue').textContent = d.leads.stats.overdue || 0;
    document.getElementById('statConversions').textContent = d.leads.stats.converted_this_month || 0;
    document.getElementById('statIncentive').textContent = '₹' + formatNum(d.incentives.approved);

    // AI Tasks
    renderAiTasks(d.ai_tasks);

    // Leads
    renderLeads(d.leads);

    // Outstanding
    renderOutstanding(d.outstanding);

    // Incentive
    document.getElementById('incConversions').textContent = d.incentives.conversions;
    document.getElementById('incApproved').textContent = '₹' + formatNum(d.incentives.approved);
    document.getElementById('incPending').textContent = '₹' + formatNum(d.incentives.pending);
}

// ─── Render AI Tasks ───────────────────────────────────────────

function renderAiTasks(aiData) {
    const container = document.getElementById('tasksList');
    const progressEl = document.getElementById('taskProgress');
    const summaryEl = document.getElementById('aiSummary');
    const motivationEl = document.getElementById('aiMotivation');

    if (!aiData || !aiData.tasks || aiData.tasks.length === 0) {
        container.innerHTML = `
            <div class="p-6 text-center">
                <p class="text-gray-400 text-sm mb-3">No tasks generated yet</p>
                <button data-action="regenerate-tasks" class="bg-green-600 text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-green-700 transition">
                    Generate Tasks
                </button>
            </div>`;
        progressEl.textContent = 'No tasks';
        return;
    }

    const completed = aiData.tasks.filter(t => t.completed).length;
    const total = aiData.tasks.length;
    progressEl.textContent = `${completed}/${total} completed`;

    if (aiData.summary) {
        summaryEl.textContent = aiData.summary;
        summaryEl.classList.remove('hidden');
    }

    container.innerHTML = aiData.tasks.map((task, i) => `
        <div class="task-card p-4 flex items-start gap-3 cursor-pointer hover:bg-gray-50 transition ${task.completed ? 'task-done' : ''} priority-${task.priority || 'medium'}"
             data-action="toggle-task" data-id="${i}">
            <div class="mt-0.5 flex-shrink-0">
                <div class="w-5 h-5 rounded-full border-2 flex items-center justify-center transition
                    ${task.completed ? 'bg-green-500 border-green-500' : 'border-gray-300 hover:border-green-400'}">
                    ${task.completed ? '<svg class="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"/></svg>' : ''}
                </div>
            </div>
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1">
                    <span class="task-title font-medium text-sm text-gray-800">${escHtml(task.title)}</span>
                    <span class="text-[9px] px-1.5 py-0.5 rounded-full font-medium cat-${task.category || 'general'}">
                        ${getCategoryLabel(task.category)}
                    </span>
                </div>
                <p class="text-xs text-gray-500 leading-relaxed">${escHtml(task.description || '')}</p>
            </div>
        </div>
    `).join('');
}

function getCategoryLabel(cat) {
    const labels = {
        lead_followup: 'Follow-up',
        lead_add: 'New Lead',
        outstanding_followup: 'Outstanding',
        conversion: 'Convert',
        general: 'General'
    };
    return labels[cat] || cat || 'General';
}

async function toggleTask(index) {
    try {
        const result = await api(`${API_BASE}/tasks/${index}/toggle`, { method: 'POST' });
        if (result.success) {
            dashboardData.ai_tasks.tasks = result.data.tasks;
            dashboardData.ai_tasks.completed = result.data.completedCount;
            renderAiTasks(dashboardData.ai_tasks);
            showToast(result.data.tasks[index].completed ? 'Task completed!' : 'Task unchecked', 'success');
        }
    } catch (e) {
        showToast('Failed to update task', 'error');
    }
}

async function regenerateTasks() {
    const btn = document.getElementById('regenerateBtn');
    btn.textContent = 'Generating...';
    btn.disabled = true;

    try {
        const result = await api(`${API_BASE}/tasks/generate`, { method: 'POST' });
        if (result.success) {
            await loadDashboard();
            showToast('Tasks regenerated!', 'success');
        } else {
            showToast(result.message || 'Generation failed', 'error');
        }
    } catch (e) {
        showToast('Failed to generate tasks', 'error');
    } finally {
        btn.textContent = 'Refresh';
        btn.disabled = false;
    }
}

// ─── Render Leads ──────────────────────────────────────────────

function renderLeads(leadsData) {
    const container = document.getElementById('leadsList');
    const footer = document.getElementById('leadsFooter');
    const allLeads = [...(leadsData.overdue || []), ...(leadsData.today_followups || [])];

    if (allLeads.length === 0) {
        container.innerHTML = `
            <div class="p-6 text-center text-gray-400 text-sm">
                No pending follow-ups.
                <a href="/staff-leads.html" class="text-green-600 font-medium hover:underline">Add a new lead</a>
            </div>`;
        return;
    }

    const subtitle = document.getElementById('leadsSubtitle');
    subtitle.textContent = `${leadsData.today_followups?.length || 0} today, ${leadsData.overdue?.length || 0} overdue`;

    container.innerHTML = allLeads.map(lead => {
        const isOverdue = lead.followup_type === 'overdue';
        const daysOverdue = isOverdue ? Math.ceil((Date.now() - new Date(lead.next_followup_date).getTime()) / 86400000) : 0;

        return `
        <div class="p-4 flex items-center gap-3 hover:bg-gray-50 transition cursor-pointer"
             data-action="open-lead" data-id="${lead.id}">
            <div class="flex-shrink-0">
                <div class="w-10 h-10 rounded-full ${isOverdue ? 'bg-red-100' : 'bg-amber-100'} flex items-center justify-center">
                    <span class="text-sm font-bold ${isOverdue ? 'text-red-600' : 'text-amber-600'}">${escHtml(lead.name.charAt(0).toUpperCase())}</span>
                </div>
            </div>
            <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                    <span class="font-medium text-sm text-gray-800 truncate">${escHtml(lead.name)}</span>
                    ${isOverdue ? `<span class="text-[9px] bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full font-medium">${daysOverdue}d overdue</span>` : '<span class="text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full font-medium">Today</span>'}
                </div>
                <div class="flex items-center gap-2 mt-0.5">
                    <span class="text-xs text-gray-500">${escHtml(lead.phone || '')}</span>
                    <span class="text-[9px] text-gray-400">${lead.status}</span>
                    ${lead.estimated_budget ? `<span class="text-[9px] text-gray-400">₹${formatNum(lead.estimated_budget)}</span>` : ''}
                </div>
            </div>
            <a href="tel:${String(lead.phone || '').replace(/[^0-9+]/g, '')}" data-action="stop-propagation" class="flex-shrink-0 w-8 h-8 rounded-full bg-green-50 flex items-center justify-center hover:bg-green-100 transition">
                <svg class="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
            </a>
        </div>`;
    }).join('');

    footer.classList.remove('hidden');
}

// ─── Render Outstanding ────────────────────────────────────────

function renderOutstanding(outstanding) {
    const container = document.getElementById('outstandingList');
    const totalEl = document.getElementById('totalOutstanding');

    if (!outstanding || outstanding.length === 0) {
        container.innerHTML = '<div class="p-6 text-center text-gray-400 text-sm">No outstanding in your branch</div>';
        totalEl.textContent = '₹0';
        return;
    }

    const total = outstanding.reduce((sum, c) => sum + parseFloat(c.outstanding || 0), 0);
    totalEl.textContent = '₹' + formatNum(total);

    const subtitle = document.getElementById('outstandingSubtitle');
    subtitle.textContent = `${outstanding.length} customers`;

    container.innerHTML = outstanding.slice(0, 10).map(cust => {
        const daysOverdue = cust.days_overdue || 0;
        const urgency = daysOverdue > 30 ? 'text-red-600' : daysOverdue > 15 ? 'text-amber-600' : 'text-gray-600';

        return `
        <div class="p-4 flex items-center gap-3 hover:bg-gray-50 transition">
            <div class="flex-1 min-w-0">
                <div class="font-medium text-sm text-gray-800 truncate">${escHtml(cust.customer_name)}</div>
                <div class="flex items-center gap-2 mt-0.5">
                    <span class="text-xs font-semibold ${urgency}">₹${formatNum(cust.outstanding)}</span>
                    <span class="text-[9px] text-gray-400">${cust.invoice_count} invoice${cust.invoice_count !== 1 ? 's' : ''}</span>
                    ${daysOverdue > 0 ? `<span class="text-[9px] text-red-500">${daysOverdue}d overdue</span>` : ''}
                </div>
            </div>
            ${cust.phone ? `
            <a href="tel:${String(cust.phone || '').replace(/[^0-9+]/g, '')}" class="flex-shrink-0 w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center hover:bg-blue-100 transition">
                <svg class="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
            </a>` : ''}
        </div>`;
    }).join('');

    if (outstanding.length > 10) {
        container.innerHTML += `<div class="px-4 py-3 text-center text-xs text-gray-400">+${outstanding.length - 10} more customers</div>`;
    }
}

// ─── Utilities ─────────────────────────────────────────────────

function formatNum(n) {
    if (!n) return '0';
    return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function escHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const colors = { success: 'bg-green-600', error: 'bg-red-600', info: 'bg-green-600' };
    const toast = document.createElement('div');
    toast.className = `${colors[type] || colors.info} text-white px-4 py-2.5 rounded-xl shadow-lg text-sm font-medium toast-enter`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ── Static handler wiring (externalized from inline on*= attributes; S9+F5 Phase E batch 11, 2026-06-25) ──
// Refresh tasks header button (was onclick="regenerateTasks()")
document.getElementById('regenerateBtn').addEventListener('click', regenerateTasks);

// Delegated dispatcher for runtime-rendered buttons/rows (replaces inline onclick="..." inside
// innerHTML). One document-level listener routes by data-action.
document.addEventListener('click', function (e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.getAttribute('data-action');
    if (!action) return;
    if (action === 'regenerate-tasks') {
        // "Generate Tasks" button in empty-state (was onclick="regenerateTasks()")
        regenerateTasks();
    } else if (action === 'toggle-task') {
        // Task row (was onclick="toggleTask(${i})")
        toggleTask(parseInt(el.getAttribute('data-id'), 10));
    } else if (action === 'open-lead') {
        // Lead row (was onclick="window.location.href='/staff-leads.html?highlight=${lead.id}'")
        window.location.href = `/staff-leads.html?highlight=${el.getAttribute('data-id')}`;
    } else if (action === 'stop-propagation') {
        // tel: anchor inside lead row (was onclick="event.stopPropagation()")
        e.stopPropagation();
    }
});
