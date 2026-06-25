// admin-wa-dashboard page logic — externalized from admin-wa-dashboard.html (S9+F5 strict CSP).
// Non-deferred, loaded right before </body> (matches original end-of-body timing).
const token = localStorage.getItem('auth_token');
const headers = { 'Authorization': 'Bearer ' + token };
let sendingChart = null;

// ========== TOAST ==========
function showToast(msg, type = 'error') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast ' + (type === 'success' ? 'success' : '');
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 3000);
}

// ========== FETCH HELPER ==========
async function apiFetch(url) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

// ========== LOAD KPI STATS ==========
async function loadChatStats() {
    try {
        const data = await apiFetch('/api/whatsapp-chat/stats');
        document.getElementById('kpiContacts').textContent = (data.total_conversations || 0).toLocaleString();
        document.getElementById('kpiUnread').textContent = (data.unread_count || 0) + ' unread';
        document.getElementById('kpiMsgToday').textContent = (data.messages_today || 0).toLocaleString();
        const inCount = data.incoming_today || 0;
        const outCount = (data.messages_today || 0) - inCount;
        document.getElementById('kpiMsgBreakdown').textContent = inCount + ' in / ' + outCount + ' out';
    } catch (err) {
        console.error('Chat stats error:', err);
        showToast('Failed to load chat stats');
    }
}

async function loadCampaignStats() {
    try {
        const data = await apiFetch('/api/wa-marketing/dashboard');
        const c = data.campaigns || {};
        const running = c.running || 0;
        const scheduled = c.scheduled || 0;
        document.getElementById('kpiCampaigns').textContent = running + scheduled;
        const parts = [];
        if (running) parts.push(running + ' running');
        if (scheduled) parts.push(scheduled + ' scheduled');
        if (c.drafts) parts.push(c.drafts + ' drafts');
        document.getElementById('kpiCampaignsSub').textContent = parts.join(', ') || 'No active campaigns';
    } catch (err) {
        console.error('Campaign stats error:', err);
        showToast('Failed to load campaign stats');
    }
}

// ========== LOAD SESSIONS ==========
async function loadSessions() {
    try {
        const data = await apiFetch('/api/zoho/whatsapp-sessions/');
        const sessions = data.data || [];
        const general = data.general;
        const all = general ? [general, ...sessions] : sessions;

        let connected = 0;
        let total = all.length;
        let html = '';

        all.forEach(s => {
            const isConn = s.status === 'connected';
            if (isConn) connected++;
            html += `
                <div class="session-item">
                    <div class="session-dot ${isConn ? 'connected' : 'disconnected'}"></div>
                    <div>
                        <div class="session-name">${escHtml(s.branch_name)}</div>
                        <div class="session-phone">${s.phone_number || s.live_phone || 'Not connected'}</div>
                    </div>
                </div>`;
        });

        document.getElementById('sessionGrid').innerHTML = html || '<p class="text-gray-400 text-sm">No sessions configured</p>';
        document.getElementById('kpiSessions').textContent = connected + ' / ' + total;
        document.getElementById('kpiSessionsSub').textContent = connected === total ? 'All connected' : (total - connected) + ' disconnected';
    } catch (err) {
        console.error('Sessions error:', err);
        document.getElementById('sessionGrid').innerHTML = '<p class="text-red-400 text-sm">Failed to load sessions</p>';
        showToast('Failed to load sessions');
    }
}

// ========== LOAD SENDING CHART ==========
async function loadSendingChart() {
    try {
        const data = await apiFetch('/api/wa-marketing/dashboard/sending-stats?days=7');
        const daily = data.daily || [];

        const labels = daily.map(d => {
            const dt = new Date(d.stat_date);
            return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
        });
        const sent = daily.map(d => d.sent || 0);
        const failed = daily.map(d => d.failed || 0);

        if (sendingChart) sendingChart.destroy();

        const ctx = document.getElementById('sendingChart').getContext('2d');
        sendingChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: 'Sent',
                        data: sent,
                        backgroundColor: '#25D366',
                        borderRadius: 4,
                        barPercentage: 0.7
                    },
                    {
                        label: 'Failed',
                        data: failed,
                        backgroundColor: '#ef4444',
                        borderRadius: 4,
                        barPercentage: 0.7
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        labels: { font: { size: 11, weight: '500' }, boxWidth: 12, padding: 12 }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: { font: { size: 11 }, stepSize: 1 },
                        grid: { color: '#f1f5f9' }
                    },
                    x: {
                        ticks: { font: { size: 11 } },
                        grid: { display: false }
                    }
                }
            }
        });
    } catch (err) {
        console.error('Sending chart error:', err);
    }
}

// ========== LOAD RECENT CONVERSATIONS ==========
async function loadRecentConversations() {
    try {
        const data = await apiFetch('/api/whatsapp-chat/conversations?limit=20');
        const rows = data.conversations || [];
        const tbody = document.getElementById('recentBody');

        if (rows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-gray-400 py-6">No conversations yet</td></tr>';
            return;
        }

        tbody.innerHTML = rows.map(r => {
            const name = r.saved_name || r.pushname || r.phone_number;
            const dir = r.last_direction || 'out';
            const body = r.last_message || '';
            const preview = body.length > 60 ? body.substring(0, 60) + '...' : body;
            const time = r.last_message_at ? formatTime(r.last_message_at) : '--';
            const unread = r.unread_count > 0 ? `<span class="ml-1 inline-flex items-center justify-center w-5 h-5 rounded-full text-white text-[10px] font-bold" style="background:#25D366;">${r.unread_count}</span>` : '';

            return `<tr>
                <td class="font-medium">${escHtml(name)}${unread}</td>
                <td class="text-gray-500">${escHtml(r.branch_name || '--')}</td>
                <td><span class="dir-badge dir-${dir}">${dir === 'in' ? 'Received' : 'Sent'}</span></td>
                <td class="text-gray-500" style="max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(preview) || '<span class="text-gray-300 italic">Media</span>'}</td>
                <td class="text-gray-400 whitespace-nowrap">${time}</td>
            </tr>`;
        }).join('');
    } catch (err) {
        console.error('Recent conversations error:', err);
        document.getElementById('recentBody').innerHTML = '<tr><td colspan="5" class="text-center text-red-400 py-6">Failed to load conversations</td></tr>';
    }
}

// ========== HELPERS ==========
function escHtml(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function formatTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) {
        return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    }
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) {
        return 'Yesterday ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    }
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ' ' +
           d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

// ========== REFRESH ALL ==========
async function refreshAll() {
    document.getElementById('lastUpdated').textContent = 'Refreshing...';
    await Promise.allSettled([
        loadChatStats(),
        loadCampaignStats(),
        loadSessions(),
        loadSendingChart(),
        loadRecentConversations()
    ]);
    const now = new Date();
    document.getElementById('lastUpdated').textContent = 'Updated ' + now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

// ========== INIT ==========
refreshAll();

// Auto-refresh every 60s
setInterval(refreshAll, 60000);

// ========== HANDLER WIRING (S9+F5 CSP) ==========
// Replaces the inline onclick="refreshAll()" on the Refresh button.
(function () {
    var btn = document.getElementById('refreshBtn');
    if (btn) btn.addEventListener('click', refreshAll);
})();
