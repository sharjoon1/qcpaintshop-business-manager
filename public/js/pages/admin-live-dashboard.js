(function() {
    const API = '/api/admin/dashboard/live';
    let pollInterval = null;
    let socket = null;

    // ── Formatting helpers ──
    function formatTime(dateStr) {
        if (!dateStr) return '--';
        const d = new Date(dateStr);
        return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    }

    function formatDuration(ms) {
        if (!ms) return '--';
        if (ms < 1000) return ms + 'ms';
        if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
        return (ms / 60000).toFixed(1) + 'm';
    }

    function formatCurrency(n) {
        if (!n) return '0';
        return Number(n).toLocaleString('en-IN');
    }

    function timeAgo(dateStr) {
        if (!dateStr) return '';
        const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
        if (seconds < 60) return 'just now';
        if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
        if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
        return Math.floor(seconds / 86400) + 'd ago';
    }

    function escHtml(str) {
        const div = document.createElement('div');
        div.textContent = str || '';
        return div.innerHTML;
    }

    const typeIcons = {
        clock_in: '<svg class="w-4 h-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"/></svg>',
        clock_out: '<svg class="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>',
        stock_submit: '<svg class="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/></svg>',
        task_complete: '<svg class="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>',
        estimate: '<svg class="w-4 h-4 text-purple-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>',
        new_lead: '<svg class="w-4 h-4 text-pink-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"/></svg>'
    };

    // ── Render functions ──

    function renderMetrics(m) {
        setText('m-staffPresent', m.staffPresent);
        setText('m-staffOnline', m.staffOnline);
        setText('m-pendingTasks', m.pendingTasks);
        setText('m-overdueTasks', m.overdueTasks);
        setText('m-todayEstimates', m.todayEstimates);
        setText('m-todayEstimateValue', formatCurrency(m.todayEstimateValue));
        setText('m-pendingStockChecks', m.pendingStockChecks);
        setText('m-newLeadsToday', m.newLeadsToday);

        // Color highlights
        const overdueEl = document.getElementById('m-overdueTasks');
        if (overdueEl) overdueEl.className = m.overdueTasks > 0 ? 'text-red-500 font-medium' : 'text-gray-400 font-medium';
    }

    function renderStaffList(users) {
        const el = document.getElementById('staffList');
        const count = document.getElementById('onlineCount');
        count.textContent = users.length;

        if (users.length === 0) {
            el.innerHTML = '<div class="text-center text-gray-400 text-sm py-6">No staff currently online</div>';
            return;
        }

        el.innerHTML = users.map(u => `
            <div class="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 transition">
                <span class="online-dot pulse"></span>
                <div class="flex-1 min-w-0">
                    <div class="text-sm font-medium text-gray-800 truncate">${escHtml(u.full_name)}</div>
                    <div class="text-xs text-gray-400">${escHtml(u.branch_name)}</div>
                </div>
                <span class="role-badge role-${u.role}">${u.role}</span>
            </div>
        `).join('');
    }

    function renderAutomations(data) {
        const el = document.getElementById('automationList');
        setText('autoHealthy', data.summary.healthy);
        setText('autoFailed', data.summary.failed);
        setText('autoRunning', data.summary.running);

        if (data.jobs.length === 0) {
            el.innerHTML = '<div class="text-center text-gray-400 text-sm py-6">No automations registered yet</div>';
            return;
        }

        // Sort: running first, then failed, then healthy, then idle
        const order = { running: 0, failed: 1, healthy: 2, idle: 3 };
        const sorted = [...data.jobs].sort((a, b) => (order[a.status] || 3) - (order[b.status] || 3));

        el.innerHTML = sorted.map(j => `
            <div class="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50 transition">
                <span class="auto-status ${j.status}"></span>
                <div class="flex-1 min-w-0">
                    <div class="text-sm font-medium text-gray-800 truncate">${escHtml(j.name)}</div>
                    <div class="text-xs text-gray-400">
                        ${j.schedule || ''}${j.lastRunAt ? ' · Last: ' + timeAgo(j.lastRunAt) : ''}${j.lastDuration ? ' · ' + formatDuration(j.lastDuration) : ''}
                    </div>
                </div>
                <div class="text-right flex-shrink-0">
                    ${j.status === 'failed' ? '<span class="text-xs text-red-500 font-medium">Failed</span>' :
                      j.status === 'running' ? '<span class="text-xs text-blue-500 font-medium">Running</span>' :
                      j.runCount > 0 ? '<span class="text-xs text-gray-400">' + j.runCount + ' runs</span>' :
                      '<span class="text-xs text-gray-300">Not run</span>'}
                </div>
            </div>
        `).join('');
    }

    function renderActivityFeed(events) {
        const el = document.getElementById('activityFeed');
        const count = document.getElementById('feedCount');
        count.textContent = events.length + ' events';

        if (events.length === 0) {
            el.innerHTML = '<div class="text-center text-gray-400 text-sm py-6">No activity yet today</div>';
            return;
        }

        el.innerHTML = events.map(e => `
            <div class="activity-item ${e.type} flex items-start gap-2 rounded-lg">
                <div class="mt-0.5 flex-shrink-0">${typeIcons[e.type] || ''}</div>
                <div class="flex-1 min-w-0">
                    <div class="text-sm text-gray-700 truncate">${escHtml(e.message)}</div>
                </div>
                <span class="text-xs text-gray-400 flex-shrink-0 whitespace-nowrap">${formatTime(e.time)}</span>
            </div>
        `).join('');
    }

    function updateStatusBar(data) {
        const bar = document.getElementById('statusBar');
        const text = document.getElementById('statusText');
        const failed = data.automations.summary.failed || 0;
        const running = data.automations.summary.running || 0;

        if (failed >= 3) {
            bar.className = 'status-bar critical rounded-xl px-4 py-3 mb-4 flex items-center justify-between text-white';
            text.textContent = failed + ' automations failing — check immediately';
        } else if (failed > 0) {
            bar.className = 'status-bar warning rounded-xl px-4 py-3 mb-4 flex items-center justify-between text-white';
            text.textContent = failed + ' automation' + (failed > 1 ? 's' : '') + ' failed · ' + running + ' running';
        } else {
            bar.className = 'status-bar healthy rounded-xl px-4 py-3 mb-4 flex items-center justify-between text-white';
            text.textContent = 'All systems operational' + (running > 0 ? ' · ' + running + ' running' : '');
        }

        document.getElementById('lastRefreshed').textContent = 'Updated ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
    }

    function setText(id, val) {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    }

    // ── Data loading ──

    async function loadData() {
        try {
            const token = localStorage.getItem('auth_token');
            if (!token) return;

            const resp = await fetch(API, {
                headers: { 'Authorization': 'Bearer ' + token }
            });

            if (!resp.ok) {
                if (resp.status === 401 || resp.status === 403) {
                    window.location.href = '/login.html';
                    return;
                }
                throw new Error('API error: ' + resp.status);
            }

            const json = await resp.json();
            if (!json.success) throw new Error(json.message || 'Failed');

            const d = json.data;
            renderMetrics(d.metrics);
            renderStaffList(d.onlineUsers);
            renderAutomations(d.automations);
            renderActivityFeed(d.activityFeed);
            updateStatusBar(d);
        } catch (err) {
            console.error('[LiveDashboard] Load error:', err);
        }
    }

    function refreshNow() {
        const btn = document.getElementById('refreshBtn');
        btn.innerHTML = '<svg class="w-4 h-4 refresh-spinner" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>';
        loadData().finally(() => {
            setTimeout(() => {
                btn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>';
            }, 500);
        });
    }
    window.refreshNow = refreshNow;

    // ── Socket.io for real-time user updates ──

    function initSocket() {
        if (typeof window.qcSocket !== 'undefined' && window.qcSocket) {
            socket = window.qcSocket;
        } else {
            // Wait for socket-helper to initialize
            const checkSocket = setInterval(() => {
                if (window.qcSocket) {
                    socket = window.qcSocket;
                    clearInterval(checkSocket);
                    setupSocketListeners();
                }
            }, 500);
            return;
        }
        setupSocketListeners();
    }

    function setupSocketListeners() {
        if (!socket) return;

        socket.emit('join_live_dashboard');

        socket.on('user_online', (user) => {
            // Refresh full data to get updated list
            loadData();
        });

        socket.on('user_offline', (data) => {
            loadData();
        });
    }

    // ── Init ──

    loadData();
    pollInterval = setInterval(loadData, 10000);
    initSocket();

    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        if (pollInterval) clearInterval(pollInterval);
    });

    // Pause polling when tab is hidden, resume when visible
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            if (pollInterval) clearInterval(pollInterval);
            pollInterval = null;
        } else {
            loadData();
            pollInterval = setInterval(loadData, 10000);
        }
    });

    // ── Handler wiring (externalized from inline onclick on #refreshBtn) ──
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', refreshNow);
})();
