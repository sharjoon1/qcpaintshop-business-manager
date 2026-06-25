// Page logic for admin-monitoring.html. Externalized from the page inline <script> (S9+F5 Phase C
// batch 3, 2026-06-25) so the page runs under the enforced strict CSP (script-src 'self',
// script-src-attr 'none'). Verbatim move of the original logic — no renames, escaping untouched.
// The three original inline on*= handlers (refresh button, DB Tables button, modal close) were
// converted to data-action attributes on the markup and are dispatched by ONE delegated listener
// below; functions stay global so the delegated dispatch and auto-refresh interval resolve them.
const token = localStorage.getItem('auth_token');
let refreshInterval = null;

function headers() { return { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }; }

function statusDot(status) {
    const map = { connected: 'dot-green', online: 'dot-green', healthy: 'dot-green', completed: 'dot-green',
                  running: 'dot-green', expired: 'dot-red', disconnected: 'dot-red', failed: 'dot-red',
                  error: 'dot-red', critical: 'dot-red', connecting: 'dot-amber', qr_pending: 'dot-amber',
                  warning: 'dot-amber', idle: 'dot-gray' };
    return `<span class="status-dot ${map[status] || 'dot-gray'}"></span>`;
}

function sevBadge(sev) {
    return `<span class="sev-badge sev-${sev}">${sev}</span>`;
}

function formatNum(n) {
    if (n >= 100000) return (n/100000).toFixed(1) + 'L';
    if (n >= 1000) return (n/1000).toFixed(1) + 'K';
    return n.toString();
}

function progressColor(pct) {
    if (pct > 90) return '#ef4444';
    if (pct > 75) return '#f59e0b';
    return '#10b981';
}

async function loadDashboard() {
    const btn = document.getElementById('refreshIcon');
    btn.classList.add('refresh-spin');
    try {
        const res = await fetch('/api/monitoring/overview', { headers: headers() });
        if (res.status === 401) { window.location.href = '/login.html'; return; }
        const d = await res.json();
        if (!d.success) throw new Error(d.message);

        document.getElementById('lastUpdated').textContent = `Last updated: ${d.timestamp}`;
        renderSystem(d.system);
        renderDatabase(d.database);
        renderPM2(d.pm2);
        renderErrors(d.errors);
        renderZoho(d.integrations.zoho);
        renderWhatsApp(d.integrations.whatsapp);
        renderAI(d.integrations.ai);
        renderBusiness(d.business_today);
        renderJobs(d.background_jobs);
        renderPerformance(d.performance);
        renderIssues(d.top_issues);
        renderErrorTable(d.errors.recent);
    } catch (e) {
        console.error('Dashboard load error:', e);
    }
    btn.classList.remove('refresh-spin');
}

function renderSystem(s) {
    const memPct = s.memory.percent;
    const cpuPct = s.cpu.percent;
    document.getElementById('cardServer').innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
            <div class="metric-icon" style="background:#ede9fe;">&#9881;&#65039;</div>
            <div><div style="font-weight:600;color:#0f172a;">Server</div><div style="font-size:11px;color:#64748b;">Up ${s.uptime}</div></div>
        </div>
        <div style="margin-bottom:8px;">
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;"><span style="color:#64748b;">Memory</span><span style="font-weight:600;">${memPct}%</span></div>
            <div class="progress-bar"><div class="progress-fill" style="width:${memPct}%;background:${progressColor(memPct)};"></div></div>
            <div style="font-size:11px;color:#94a3b8;margin-top:2px;">Process: ${s.memory.process_rss}</div>
        </div>
        <div>
            <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px;"><span style="color:#64748b;">CPU</span><span style="font-weight:600;">${cpuPct}%</span></div>
            <div class="progress-bar"><div class="progress-fill" style="width:${cpuPct}%;background:${progressColor(cpuPct)};"></div></div>
            <div style="font-size:11px;color:#94a3b8;margin-top:2px;">${s.cpu.cores} cores | Load: ${s.cpu.load_avg}</div>
        </div>`;
}

function renderDatabase(db) {
    const cls = db.status === 'connected' ? 'dot-green' : 'dot-red';
    document.getElementById('cardDatabase').innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
            <div class="metric-icon" style="background:#dbeafe;">&#128451;</div>
            <div><div style="font-weight:600;color:#0f172a;">Database</div><div style="font-size:11px;color:#64748b;">${statusDot(db.status)} ${db.status}</div></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div><div style="font-size:20px;font-weight:700;color:#0f172a;">${db.tables}</div><div class="metric-label">Tables</div></div>
            <div><div style="font-size:20px;font-weight:700;color:#0f172a;">${db.size}</div><div class="metric-label">Size</div></div>
            <div><div style="font-size:20px;font-weight:700;color:#0f172a;">${db.connections}</div><div class="metric-label">Connections</div></div>
            <div><div style="font-size:20px;font-weight:700;color:#0f172a;">${db.slow_queries_24h}</div><div class="metric-label">Slow Queries 24h</div></div>
        </div>`;
}

function renderPM2(pm) {
    document.getElementById('cardPM2').innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
            <div class="metric-icon" style="background:#d1fae5;">&#9889;</div>
            <div><div style="font-weight:600;color:#0f172a;">PM2 Process</div><div style="font-size:11px;color:#64748b;">${statusDot(pm.status)} ${pm.status}</div></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
            <div><div style="font-size:20px;font-weight:700;color:#0f172a;">${pm.memory || 'N/A'}</div><div class="metric-label">Memory</div></div>
            <div><div style="font-size:20px;font-weight:700;color:#0f172a;">${pm.cpu || 'N/A'}</div><div class="metric-label">CPU</div></div>
            <div><div style="font-size:20px;font-weight:700;color:#0f172a;">${pm.restarts ?? 'N/A'}</div><div class="metric-label">Restarts</div></div>
            <div><div style="font-size:20px;font-weight:700;color:#0f172a;">${pm.uptime || 'N/A'}</div><div class="metric-label">Uptime</div></div>
        </div>`;
}

function renderErrors(e) {
    const severity = e.critical_count > 0 ? 'critical' : e.last_hour > 5 ? 'warning' : 'healthy';
    document.getElementById('cardErrors').innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
            <div class="metric-icon" style="background:${e.critical_count > 0 ? '#fee2e2' : '#f0fdf4'};">${e.critical_count > 0 ? '&#128308;' : '&#9989;'}</div>
            <div><div style="font-weight:600;color:#0f172a;">Errors</div><div style="font-size:11px;color:#64748b;">${sevBadge(severity)}</div></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;text-align:center;">
            <div><div style="font-size:24px;font-weight:700;color:#0f172a;">${e.last_24h}</div><div class="metric-label">24h</div></div>
            <div><div style="font-size:24px;font-weight:700;color:#0f172a;">${e.last_hour}</div><div class="metric-label">1h</div></div>
            <div><div style="font-size:24px;font-weight:700;color:${e.critical_count > 0 ? '#ef4444' : '#0f172a'};">${e.critical_count}</div><div class="metric-label">Critical</div></div>
        </div>`;
}

function renderZoho(z) {
    document.getElementById('cardZoho').innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
            <div class="metric-icon" style="background:#fef3c7;">&#128214;</div>
            <div><div style="font-weight:600;color:#0f172a;">Zoho Books</div><div style="font-size:11px;color:#64748b;">${statusDot(z.status)} ${z.status}</div></div>
        </div>
        <div style="font-size:12px;color:#475569;line-height:1.8;">
            <div>Last Sync: <strong>${z.last_sync}</strong> (${z.last_sync_type})</div>
            <div>Sync Status: ${sevBadge(z.last_sync_status === 'completed' ? 'healthy' : 'warning')}</div>
            <div>Token Expires: <strong>${z.token_expires}</strong> (${z.token_expires_in})</div>
        </div>`;
}

function renderWhatsApp(w) {
    const sessHtml = w.sessions.map(s =>
        `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;">
            <span style="font-size:12px;color:#334155;">${s.phone || 'No phone'}</span>
            <span style="font-size:11px;">${statusDot(s.status)} ${s.status}</span>
        </div>`
    ).join('');
    document.getElementById('cardWhatsApp').innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
            <div class="metric-icon" style="background:#d1fae5;">&#128172;</div>
            <div><div style="font-weight:600;color:#0f172a;">WhatsApp</div><div style="font-size:11px;color:#64748b;">${w.connected_count}/${w.total} connected</div></div>
        </div>
        <div>${sessHtml || '<div style="font-size:12px;color:#94a3b8;">No sessions</div>'}</div>`;
}

function renderAI(ai) {
    document.getElementById('cardAI').innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;">
            <div class="metric-icon" style="background:#ede9fe;">&#129302;</div>
            <div><div style="font-weight:600;color:#0f172a;">AI Services</div><div style="font-size:11px;color:#64748b;">${statusDot(ai.enabled ? 'connected' : 'disconnected')} ${ai.enabled ? 'Active' : 'Disabled'}</div></div>
        </div>
        <div style="font-size:12px;color:#475569;line-height:1.8;">
            <div>Provider: <strong>${ai.provider}</strong></div>
            <div>Last Run: <strong>${ai.last_run}</strong></div>
            <div>Type: ${ai.last_type} | Status: ${sevBadge(ai.last_status === 'completed' ? 'healthy' : ai.last_status === 'failed' ? 'critical' : 'info')}</div>
            <div>Duration: ${ai.last_duration}</div>
        </div>`;
}

function renderBusiness(b) {
    const cards = [
        { id: 'bRevenue', icon: '&#8377;', label: 'Revenue', value: '&#8377;' + formatNum(b.revenue), color: '#10b981', bg: '#d1fae5' },
        { id: 'bInvoices', icon: '&#128196;', label: 'Invoices', value: b.invoices, color: '#3b82f6', bg: '#dbeafe' },
        { id: 'bCollections', icon: '&#128176;', label: 'Collections', value: '&#8377;' + formatNum(b.collections), color: '#8b5cf6', bg: '#ede9fe' },
        { id: 'bStaff', icon: '&#128101;', label: 'Staff Present', value: `${b.staff_present}/${b.staff_total}`, color: '#f59e0b', bg: '#fef3c7' },
        { id: 'bLeads', icon: '&#127919;', label: 'New Leads', value: b.leads_new, color: '#ec4899', bg: '#fce7f3' },
        { id: 'bAttendance', icon: '&#128200;', label: 'Attendance', value: b.attendance_rate + '%', color: '#06b6d4', bg: '#cffafe' }
    ];
    cards.forEach(c => {
        document.getElementById(c.id).innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                <div class="metric-icon" style="background:${c.bg};font-size:16px;">${c.icon}</div>
                <div class="metric-label">${c.label}</div>
            </div>
            <div class="metric-value" style="color:${c.color};">${c.value}</div>`;
    });
}

function renderJobs(jobs) {
    if (!jobs || jobs.length === 0) {
        document.getElementById('jobsList').innerHTML = '<div style="text-align:center;padding:16px;color:#94a3b8;">No jobs registered</div>';
        return;
    }
    document.getElementById('jobsList').innerHTML = jobs.map(j => `
        <div class="job-row">
            <div style="flex:1;min-width:0;">
                <div style="font-size:13px;font-weight:600;color:#0f172a;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${j.name}</div>
                <div style="font-size:11px;color:#94a3b8;">${j.schedule || ''} | Runs: ${j.run_count} | Fails: ${j.fail_count}</div>
                ${j.last_error ? `<div style="font-size:11px;color:#ef4444;margin-top:2px;">Error: ${j.last_error.substring(0, 80)}</div>` : ''}
            </div>
            <div style="text-align:right;flex-shrink:0;">
                <div>${sevBadge(j.status === 'healthy' || j.status === 'running' ? 'healthy' : j.status === 'failed' ? 'critical' : 'info')}</div>
                <div style="font-size:10px;color:#94a3b8;margin-top:2px;">${j.last_run !== 'Never' ? j.last_run : 'Never run'}</div>
            </div>
        </div>`).join('');
}

function renderPerformance(p) {
    if (!p) {
        document.getElementById('perfContent').innerHTML = '<div style="text-align:center;padding:16px;color:#94a3b8;">No performance data</div>';
        return;
    }
    const p95Color = p.p95 > 3000 ? '#ef4444' : p.p95 > 1000 ? '#f59e0b' : '#10b981';
    document.getElementById('perfContent').innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px;text-align:center;">
            <div><div style="font-size:20px;font-weight:700;color:#0f172a;">${Math.round(p.avg)}ms</div><div class="metric-label">Avg</div></div>
            <div><div style="font-size:20px;font-weight:700;color:#0f172a;">${Math.round(p.p95)}ms</div><div class="metric-label">P95</div></div>
            <div><div style="font-size:20px;font-weight:700;color:#0f172a;">${p.rpm}</div><div class="metric-label">RPM</div></div>
            <div><div style="font-size:20px;font-weight:700;color:${p.error_rate > 5 ? '#ef4444' : '#0f172a'};">${p.error_rate.toFixed(1)}%</div><div class="metric-label">Error Rate</div></div>
        </div>
        ${p.slowest && p.slowest.length > 0 ? `
        <div style="font-size:12px;font-weight:600;color:#64748b;margin-bottom:6px;">Slowest Endpoints</div>
        ${p.slowest.slice(0, 5).map(s => `
            <div style="display:flex;justify-content:space-between;padding:4px 0;font-size:12px;border-bottom:1px solid #f1f5f9;">
                <span style="color:#334155;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:200px;">${s.path}</span>
                <span style="font-weight:600;color:${s.maxMs > 3000 ? '#ef4444' : '#334155'};">${s.maxMs}ms</span>
            </div>`).join('')}` : ''}`;
}

function renderIssues(issues) {
    const banner = document.getElementById('issuesBanner');
    if (!issues || issues.length === 0) {
        banner.style.display = 'none';
        return;
    }
    banner.style.display = 'block';
    banner.innerHTML = issues.map(i => `
        <div class="issue-row ${i.severity}">
            <div style="flex:1;">
                <div style="font-size:13px;font-weight:600;color:#0f172a;">${sevBadge(i.severity)} ${i.title}</div>
                <div style="font-size:12px;color:#475569;margin-top:2px;">${i.description}</div>
            </div>
            ${i.action ? `<a href="${i.action}" style="font-size:12px;color:#667eea;font-weight:600;text-decoration:none;white-space:nowrap;">Fix &rarr;</a>` : ''}
        </div>`).join('');
}

function renderErrorTable(errors) {
    if (!errors || errors.length === 0) {
        document.getElementById('errorsTable').innerHTML = '<div style="text-align:center;padding:16px;color:#94a3b8;">No recent errors</div>';
        return;
    }
    document.getElementById('errorsTable').innerHTML = `
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
            <thead>
                <tr style="border-bottom:2px solid #e2e8f0;">
                    <th style="text-align:left;padding:8px 6px;color:#64748b;font-weight:600;">Time</th>
                    <th style="text-align:left;padding:8px 6px;color:#64748b;font-weight:600;">Type</th>
                    <th style="text-align:left;padding:8px 6px;color:#64748b;font-weight:600;">Severity</th>
                    <th style="text-align:left;padding:8px 6px;color:#64748b;font-weight:600;">Message</th>
                    <th style="text-align:left;padding:8px 6px;color:#64748b;font-weight:600;">URL</th>
                </tr>
            </thead>
            <tbody>
                ${errors.map(e => `
                    <tr style="border-bottom:1px solid #f1f5f9;">
                        <td style="padding:8px 6px;white-space:nowrap;color:#64748b;">${e.time}</td>
                        <td style="padding:8px 6px;">${e.type || '-'}</td>
                        <td style="padding:8px 6px;">${sevBadge(e.severity || 'info')}</td>
                        <td style="padding:8px 6px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#334155;">${escapeHtml(e.message)}</td>
                        <td style="padding:8px 6px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#94a3b8;">${e.url || '-'}</td>
                    </tr>`).join('')}
            </tbody>
        </table>`;
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

async function loadTableInfo() {
    const modal = document.getElementById('dbTablesModal');
    modal.style.display = 'flex';
    document.getElementById('dbTablesContent').innerHTML = '<div style="text-align:center;padding:20px;color:#94a3b8;">Loading tables...</div>';
    try {
        const res = await fetch('/api/monitoring/database/tables', { headers: headers() });
        const d = await res.json();
        if (!d.success) throw new Error(d.message);
        document.getElementById('dbTablesContent').innerHTML = `
            <div style="margin-bottom:12px;font-size:13px;color:#64748b;">${d.count} tables total</div>
            <table style="width:100%;border-collapse:collapse;font-size:12px;">
                <thead><tr style="border-bottom:2px solid #e2e8f0;">
                    <th style="text-align:left;padding:6px;">Table</th>
                    <th style="text-align:right;padding:6px;">Rows</th>
                    <th style="text-align:right;padding:6px;">Size</th>
                    <th style="text-align:right;padding:6px;">Data</th>
                    <th style="text-align:right;padding:6px;">Index</th>
                </tr></thead>
                <tbody>${d.data.map(t => `
                    <tr style="border-bottom:1px solid #f1f5f9;">
                        <td style="padding:6px;color:#334155;font-weight:500;">${t.table_name || t.TABLE_NAME}</td>
                        <td style="padding:6px;text-align:right;color:#64748b;">${(t.row_count || t.TABLE_ROWS || 0).toLocaleString()}</td>
                        <td style="padding:6px;text-align:right;font-weight:600;">${t.size_mb} MB</td>
                        <td style="padding:6px;text-align:right;color:#64748b;">${t.data_mb} MB</td>
                        <td style="padding:6px;text-align:right;color:#64748b;">${t.index_mb} MB</td>
                    </tr>`).join('')}</tbody>
            </table>`;
    } catch (e) {
        document.getElementById('dbTablesContent').innerHTML = `<div style="color:#ef4444;padding:12px;">Error: ${escapeHtml(e.message)}</div>`;
    }
}

// Auto-refresh
function setupAutoRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
    if (document.getElementById('autoRefresh').checked) {
        refreshInterval = setInterval(loadDashboard, 30000);
    }
}

document.getElementById('autoRefresh').addEventListener('change', setupAutoRefresh);

// Delegated dispatch for the converted inline on*= handlers (refresh, DB Tables, modal close).
// Each markup element carries data-action; this single document-level listener routes by dataset.
document.addEventListener('click', function (e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (action === 'load-dashboard') {
        loadDashboard();
    } else if (action === 'load-table-info') {
        loadTableInfo();
    } else if (action === 'close-db-tables-modal') {
        const modal = document.getElementById('dbTablesModal');
        if (modal) modal.style.display = 'none';
    }
});

// Init
loadDashboard();
setupAutoRefresh();
