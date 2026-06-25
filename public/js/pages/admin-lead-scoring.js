// admin-lead-scoring page logic — externalized from admin-lead-scoring.html (S9+F5 strict CSP).
// Non-deferred, loaded right before </body> (matches original end-of-body timing).
const API = '/api/leads';
let dashboardData = null;

// ─── Load Dashboard ──────────────────────────────
async function loadScoringDashboard() {
    try {
        const res = await fetch(`${API}/scoring/dashboard`, { headers: getAuthHeaders() });
        const json = await res.json();
        if (!json.success) throw new Error(json.message);

        dashboardData = json.data;
        renderOverview(json.data.distribution);
        renderDistribution(json.data.distribution);
        renderTopLeads(json.data.topLeads);
        renderLastRun(json.data.lastRun);
        document.getElementById('predictedCount').textContent = json.data.predictedConversions || 0;
    } catch (err) {
        console.error('Dashboard load error:', err);
        document.getElementById('lastRunInfo').textContent = 'Failed to load dashboard';
    }
}

function renderOverview(d) {
    document.getElementById('avgScore').textContent = d.avg_score || '0';
    document.getElementById('hotCount').textContent = d.hot || 0;
    document.getElementById('warmCount').textContent = d.warm || 0;
    document.getElementById('coldCount').textContent = d.cold || 0;
}

function renderDistribution(d) {
    const total = (d.hot || 0) + (d.warm || 0) + (d.cold || 0) + (d.unscored || 0);
    if (total === 0) {
        document.getElementById('distributionBar').innerHTML = '<div class="bg-gray-200 w-full flex items-center justify-center text-xs text-gray-400">No data</div>';
        return;
    }
    const pct = v => ((v || 0) / total * 100).toFixed(1);
    const bar = document.getElementById('distributionBar');
    bar.innerHTML = '';

    const segments = [
        { count: d.hot || 0, cls: 'bg-red-500', label: 'Hot' },
        { count: d.warm || 0, cls: 'bg-amber-400', label: 'Warm' },
        { count: d.cold || 0, cls: 'bg-blue-500', label: 'Cold' },
        { count: d.unscored || 0, cls: 'bg-gray-300', label: 'Unscored' }
    ];

    segments.forEach(s => {
        if (s.count > 0) {
            const div = document.createElement('div');
            div.className = `${s.cls} flex items-center justify-center text-xs text-white font-medium`;
            div.style.width = pct(s.count) + '%';
            div.title = `${s.label}: ${s.count}`;
            if (parseFloat(pct(s.count)) > 8) div.textContent = s.count;
            bar.appendChild(div);
        }
    });

    const legend = document.getElementById('distributionLegend');
    legend.innerHTML = segments.map(s =>
        `<span class="flex items-center gap-1.5"><span class="w-3 h-3 rounded-full ${s.cls}"></span>${s.label}: ${s.count} (${pct(s.count)}%)</span>`
    ).join('');
}

function renderLastRun(run) {
    const el = document.getElementById('lastRunInfo');
    if (!run) {
        el.textContent = 'No scoring runs yet. Click "Run Scoring Now" to start.';
        return;
    }
    const date = new Date(run.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
    el.textContent = `Last run: ${date} (${run.status}) — ${run.summary || ''}`;
}

// ─── Render Top Leads Table ──────────────────────
function renderTopLeads(leads) {
    const tbody = document.getElementById('leadsTableBody');
    if (!leads || leads.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-gray-400">No scored leads. Run scoring first.</td></tr>';
        return;
    }

    tbody.innerHTML = leads.map(l => {
        const score = l.lead_score || 0;
        const color = score >= 80 ? '#ef4444' : score >= 50 ? '#f59e0b' : '#3b82f6';
        const statusColors = {
            'new': 'bg-blue-100 text-blue-700', 'contacted': 'bg-yellow-100 text-yellow-700',
            'interested': 'bg-green-100 text-green-700', 'quoted': 'bg-purple-100 text-purple-700',
            'negotiating': 'bg-indigo-100 text-indigo-700', 'follow_up': 'bg-orange-100 text-orange-700'
        };
        const statusCls = statusColors[l.status] || 'bg-gray-100 text-gray-700';
        const budget = l.estimated_budget ? '₹' + Number(l.estimated_budget).toLocaleString('en-IN') : '--';

        return `<tr class="border-b border-gray-50 hover:bg-gray-50 cursor-pointer" data-action="show-lead-detail" data-id="${l.id}">
            <td class="px-4 py-3">
                <div class="flex items-center gap-2">
                    ${renderScoreRingSmall(score, color)}
                    <span class="font-semibold" style="color:${color}">${score}</span>
                </div>
            </td>
            <td class="px-4 py-3">
                <div class="font-medium text-gray-800">${escHtml(l.name)}</div>
                <div class="text-xs text-gray-400">${escHtml(l.phone || '')} ${l.assigned_name ? '· ' + escHtml(l.assigned_name) : ''}</div>
            </td>
            <td class="px-4 py-3 hidden md:table-cell">
                <span class="px-2 py-0.5 rounded-full text-xs font-medium ${statusCls}">${l.status}</span>
            </td>
            <td class="px-4 py-3 hidden lg:table-cell text-gray-600">${budget}</td>
            <td class="px-4 py-3 hidden lg:table-cell text-xs text-gray-500 max-w-[200px] truncate">${escHtml(l.ai_recommendation || l.next_action || '--')}</td>
            <td class="px-4 py-3 text-right">
                <button data-action="show-lead-detail" data-id="${l.id}" class="text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-600 mr-1">Detail</button>
                <button data-action="predict-conversion" data-id="${l.id}" class="text-xs px-2 py-1 rounded text-white" style="background:#667eea;">Predict</button>
            </td>
        </tr>`;
    }).join('');
}

// ─── Score Ring SVG ──────────────────────────────
function renderScoreRingSmall(score, color) {
    const r = 14, c = 2 * Math.PI * r;
    const offset = c - (score / 100) * c;
    return `<svg width="36" height="36" viewBox="0 0 36 36">
        <circle cx="18" cy="18" r="${r}" fill="none" stroke="#e5e7eb" stroke-width="3"/>
        <circle class="score-ring" cx="18" cy="18" r="${r}" fill="none" stroke="${color}" stroke-width="3"
            stroke-dasharray="${c}" stroke-dashoffset="${offset}" stroke-linecap="round"
            transform="rotate(-90 18 18)"/>
    </svg>`;
}

function renderScoreRingLarge(score, color) {
    const r = 42, c = 2 * Math.PI * r;
    const offset = c - (score / 100) * c;
    return `<svg width="100" height="100" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r="${r}" fill="none" stroke="#e5e7eb" stroke-width="6"/>
        <circle class="score-ring" cx="50" cy="50" r="${r}" fill="none" stroke="${color}" stroke-width="6"
            stroke-dasharray="${c}" stroke-dashoffset="${offset}" stroke-linecap="round"
            transform="rotate(-90 50 50)"/>
        <text x="50" y="50" text-anchor="middle" dominant-baseline="central"
            font-size="22" font-weight="bold" fill="${color}">${score}</text>
    </svg>`;
}

// ─── Lead Detail Panel ───────────────────────────
async function showLeadDetail(id) {
    const panel = document.getElementById('detailPanel');
    const overlay = document.getElementById('slideOverlay');
    const content = document.getElementById('detailContent');

    content.innerHTML = '<div class="flex items-center justify-center py-12"><div class="animate-spin w-8 h-8 border-4 border-gray-200 border-t-purple-500 rounded-full"></div></div>';
    panel.classList.add('open');
    overlay.classList.add('open');

    try {
        const res = await fetch(`${API}/${id}/score`, { headers: getAuthHeaders() });
        const json = await res.json();
        if (!json.success) throw new Error(json.message);

        const d = json.data;
        const lead = d.lead;
        const score = d.score || 0;
        const color = score >= 80 ? '#ef4444' : score >= 50 ? '#f59e0b' : '#3b82f6';

        document.getElementById('detailLeadName').textContent = lead.name;

        let html = '';

        // Score ring
        html += `<div class="text-center">
            ${renderScoreRingLarge(score, color)}
            <div class="text-sm text-gray-500 mt-2">Lead Score</div>
            ${d.score_updated_at ? `<div class="text-xs text-gray-400">Updated: ${new Date(d.score_updated_at).toLocaleString('en-IN')}</div>` : ''}
        </div>`;

        // Lead info
        html += `<div class="grid grid-cols-2 gap-3 text-sm">
            <div><span class="text-gray-400">Status:</span> <span class="font-medium">${lead.status}</span></div>
            <div><span class="text-gray-400">Source:</span> <span class="font-medium">${lead.source || '--'}</span></div>
            <div><span class="text-gray-400">Budget:</span> <span class="font-medium">${lead.estimated_budget ? '₹' + Number(lead.estimated_budget).toLocaleString('en-IN') : '--'}</span></div>
            <div><span class="text-gray-400">Followups:</span> <span class="font-medium">${lead.total_followups || 0}</span></div>
            <div><span class="text-gray-400">Assigned:</span> <span class="font-medium">${lead.assigned_name || 'Unassigned'}</span></div>
            <div><span class="text-gray-400">Branch:</span> <span class="font-medium">${lead.branch_name || '--'}</span></div>
        </div>`;

        // AI Recommendation
        if (d.ai_recommendation) {
            html += `<div class="bg-purple-50 rounded-lg p-3 border border-purple-100">
                <div class="text-xs font-medium text-purple-700 mb-1">AI Recommendation</div>
                <div class="text-sm text-purple-900">${escHtml(d.ai_recommendation)}</div>
                ${d.next_action ? `<div class="text-xs text-purple-600 mt-1">Next: ${escHtml(d.next_action)} ${d.next_action_date ? '(' + d.next_action_date + ')' : ''}</div>` : ''}
            </div>`;
        }

        // Score Breakdown
        if (d.breakdown) {
            const maxScores = { budget: 25, status: 20, recency: 20, engagement: 15, source: 10, responsiveness: 10 };
            html += `<div>
                <div class="text-sm font-medium text-gray-700 mb-3">Score Breakdown</div>
                <div class="space-y-2.5">
                    ${Object.entries(d.breakdown).map(([key, val]) => {
                        const max = maxScores[key] || 25;
                        const pct = Math.min(100, (val / max) * 100);
                        const barColor = pct >= 70 ? '#22c55e' : pct >= 40 ? '#f59e0b' : '#ef4444';
                        return `<div>
                            <div class="flex justify-between text-xs text-gray-500 mb-1">
                                <span class="capitalize">${key}</span>
                                <span>${val}/${max}</span>
                            </div>
                            <div class="breakdown-bar">
                                <div class="breakdown-fill" style="width:${pct}%;background:${barColor}"></div>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        }

        // Conversion Prediction
        html += `<div id="predictionSection-${id}">`;
        if (d.prediction) {
            html += renderPrediction(d.prediction);
        } else {
            html += `<div class="text-center">
                <button data-action="predict-conversion" data-id="${id}" class="px-4 py-2 rounded-lg text-white text-sm font-medium" style="background:#667eea;">
                    Generate Conversion Prediction
                </button>
            </div>`;
        }
        html += '</div>';

        // Follow-up Suggestions
        if (d.suggestions && d.suggestions.length > 0) {
            html += `<div>
                <div class="text-sm font-medium text-gray-700 mb-3">Suggested Follow-ups</div>
                <div class="space-y-2">
                    ${d.suggestions.map(s => {
                        const prioColor = s.priority === 'high' ? 'border-red-200 bg-red-50' : s.priority === 'medium' ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50';
                        const typeIcons = {
                            'call': '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/>',
                            'visit': '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>',
                            'whatsapp': '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>',
                            'email': '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"/>',
                            'meeting': '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z"/>'
                        };
                        return `<div class="border ${prioColor} rounded-lg p-3">
                            <div class="flex items-start gap-2">
                                <svg class="w-4 h-4 mt-0.5 text-gray-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">${typeIcons[s.type] || typeIcons['call']}</svg>
                                <div class="flex-1 min-w-0">
                                    <div class="flex items-center justify-between">
                                        <span class="text-sm font-medium text-gray-800">${escHtml(s.title)}</span>
                                        <span class="text-xs text-gray-400">${escHtml(s.timing)}</span>
                                    </div>
                                    <div class="text-xs text-gray-600 mt-1">${escHtml(s.message)}</div>
                                    <div class="text-xs text-gray-400 mt-1 italic">${escHtml(s.reasoning)}</div>
                                </div>
                            </div>
                        </div>`;
                    }).join('')}
                </div>
            </div>`;
        }

        // Recent Followups
        if (d.recentFollowups && d.recentFollowups.length > 0) {
            html += `<div>
                <div class="text-sm font-medium text-gray-700 mb-3">Recent Follow-ups</div>
                <div class="space-y-2">
                    ${d.recentFollowups.map(f => `<div class="flex gap-3 text-xs">
                        <div class="text-gray-400 whitespace-nowrap">${new Date(f.created_at).toLocaleDateString('en-IN')}</div>
                        <div class="flex-1">
                            <span class="font-medium text-gray-700">[${f.followup_type}]</span>
                            ${f.user_name ? `<span class="text-gray-400">by ${escHtml(f.user_name)}</span>` : ''}
                            <div class="text-gray-600 mt-0.5">${escHtml((f.notes || '').substring(0, 150))}</div>
                        </div>
                    </div>`).join('')}
                </div>
            </div>`;
        }

        // Action buttons
        html += `<div class="flex gap-2 pt-2 border-t border-gray-100">
            <a href="/admin-leads.html" class="flex-1 text-center px-3 py-2 rounded-lg bg-gray-100 text-gray-700 text-sm font-medium hover:bg-gray-200">View Full Lead</a>
            <button data-action="predict-conversion" data-id="${id}" class="flex-1 px-3 py-2 rounded-lg text-white text-sm font-medium" style="background:#667eea;">Refresh Prediction</button>
        </div>`;

        content.innerHTML = html;
    } catch (err) {
        console.error('Detail load error:', err);
        content.innerHTML = `<div class="text-center text-red-500 py-8">Failed to load: ${escHtml(err.message)}</div>`;
    }
}

function renderPrediction(p) {
    const prob = p.conversion_probability || 0;
    const probColor = prob >= 70 ? '#22c55e' : prob >= 40 ? '#f59e0b' : '#ef4444';
    const factors = p.factors || (p.factors_json ? JSON.parse(p.factors_json) : []);

    return `<div class="bg-gradient-to-br from-indigo-50 to-purple-50 rounded-lg p-4 border border-indigo-100">
        <div class="text-sm font-medium text-indigo-700 mb-3">Conversion Prediction</div>
        <div class="flex items-center gap-4 mb-3">
            <div class="text-3xl font-bold" style="color:${probColor}">${prob}%</div>
            <div class="text-sm text-gray-600">
                <div>Timeline: <span class="font-medium">${escHtml(p.predicted_timeline || '--')}</span></div>
                <div>Confidence: <span class="font-medium">${p.confidence || 0}%</span></div>
            </div>
        </div>
        ${p.ai_explanation || p.explanation ? `<div class="text-xs text-gray-600 mb-3">${escHtml(p.ai_explanation || p.explanation)}</div>` : ''}
        ${factors.length > 0 ? `<div class="space-y-1">
            ${factors.map(f => `<div class="flex items-center gap-2 text-xs">
                <span class="factor-${f.impact}">${f.impact === 'positive' ? '+' : f.impact === 'negative' ? '-' : '~'}</span>
                <span class="font-medium text-gray-700">${escHtml(f.factor)}</span>
                <span class="text-gray-400">${escHtml(f.description)}</span>
            </div>`).join('')}
        </div>` : ''}
    </div>`;
}

function closeDetailPanel() {
    document.getElementById('detailPanel').classList.remove('open');
    document.getElementById('slideOverlay').classList.remove('open');
}

// ─── Actions ─────────────────────────────────────
async function runScoring() {
    const btn = document.getElementById('runScoringBtn');
    btn.disabled = true;
    btn.innerHTML = '<svg class="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg> Scoring...';

    try {
        const res = await fetch('/api/ai/analysis/run', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ type: 'lead_scoring' })
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.message);

        await loadScoringDashboard();
        showToast('Scoring completed successfully!', 'success');
    } catch (err) {
        console.error('Run scoring error:', err);
        showToast('Scoring failed: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg> Run Scoring Now';
    }
}

async function predictConversion(id) {
    try {
        showToast('Generating prediction...', 'info');
        const res = await fetch(`${API}/${id}/predict`, {
            method: 'POST',
            headers: getAuthHeaders()
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.message);

        // Update prediction section in panel if open
        const section = document.getElementById(`predictionSection-${id}`);
        if (section) {
            section.innerHTML = renderPrediction(json.data);
        }
        showToast('Prediction generated!', 'success');
    } catch (err) {
        console.error('Prediction error:', err);
        showToast('Prediction failed: ' + err.message, 'error');
    }
}

async function triggerNurture(tier) {
    if (!confirm(`Create a WhatsApp nurture campaign for ${tier} leads?`)) return;

    const btnMap = { hot: 'nurtureHot', warm: 'nurtureWarm', cold: 'nurtureCold' };
    const btn = document.getElementById(btnMap[tier]);
    btn.disabled = true;

    try {
        const res = await fetch(`${API}/scoring/nurture`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ tier })
        });
        const json = await res.json();
        if (!json.success) throw new Error(json.message);

        showToast(json.message, 'success');
    } catch (err) {
        console.error('Nurture error:', err);
        showToast('Nurture failed: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
    }
}

// ─── Helpers ─────────────────────────────────────
function escHtml(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

function showToast(msg, type) {
    const colors = { success: '#22c55e', error: '#ef4444', info: '#667eea' };
    const toast = document.createElement('div');
    toast.style.cssText = `position:fixed;top:20px;right:20px;padding:12px 20px;border-radius:8px;color:#fff;font-size:14px;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.15);background:${colors[type] || colors.info};`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

// ─── Static handler wiring (S9+F5 strict CSP: no inline on*=) ──
document.getElementById('runScoringBtn').addEventListener('click', runScoring);
document.getElementById('nurtureHot').addEventListener('click', () => triggerNurture('hot'));
document.getElementById('nurtureWarm').addEventListener('click', () => triggerNurture('warm'));
document.getElementById('nurtureCold').addEventListener('click', () => triggerNurture('cold'));
document.getElementById('slideOverlay').addEventListener('click', closeDetailPanel);
document.getElementById('closeDetailPanelBtn').addEventListener('click', closeDetailPanel);

// ─── Delegated listener for runtime-injected handlers (templates use data-action) ──
// Preserves the original stopPropagation semantics: the inner Detail/Predict buttons
// originally called event.stopPropagation() so the row click did not also fire. Clicks
// on nested data-action elements are intercepted here and propagation stopped so the
// delegated document handler reads only the most-specific (innermost) data-action.
document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    const id = Number(el.dataset.id);
    switch (action) {
        case 'show-lead-detail':
            e.stopPropagation();
            showLeadDetail(id);
            break;
        case 'predict-conversion':
            e.stopPropagation();
            predictConversion(id);
            break;
    }
});

// ─── Init ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', loadScoringDashboard);
