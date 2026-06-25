// Page logic externalized from staff-incentives.html inline <script> (S9+F5 Phase E batch 11,
// 2026-06-25) so the page runs under the enforced strict CSP. Verbatim move of all functions;
// inline on*= handlers converted to addEventListener. No logic changes, no renames, escaping
// helpers untouched.

const API_BASE = '';
let allIncentives = [];
let currentStatusFilter = '';

function getHeaders() {
    return {
        'Authorization': 'Bearer ' + localStorage.getItem('auth_token'),
        'Content-Type': 'application/json'
    };
}

function fmtINR(n) {
    return parseFloat(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

function escHtml(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

// Populate month filter (last 6 months)
function initMonthFilter() {
    const sel = document.getElementById('filterMonth');
    const now = new Date();
    for (let i = 0; i < 6; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const val = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const label = d.toLocaleString('en-IN', { month: 'short', year: 'numeric' });
        sel.innerHTML += `<option value="${val}" ${i === 0 ? 'selected' : ''}>${label}</option>`;
    }
}

async function loadIncentives() {
    const month = document.getElementById('filterMonth').value;

    document.getElementById('loading').classList.remove('hidden');
    document.getElementById('incentiveList').classList.add('hidden');
    document.getElementById('emptyState').classList.add('hidden');

    try {
        const res = await fetch(`${API_BASE}/api/salary/incentives?month=${month}`, {
            headers: { 'Authorization': 'Bearer ' + localStorage.getItem('auth_token') }
        });
        const result = await res.json();

        document.getElementById('loading').classList.add('hidden');

        if (result.success && result.data.length > 0) {
            allIncentives = result.data;
            updateSummary(result.summary);
            updateTypeBreakdown(result.data);
            renderIncentives(result.data);
            document.getElementById('incentiveList').classList.remove('hidden');
        } else {
            allIncentives = [];
            updateSummary({ total: 0, pending_count: 0, approved_count: 0, approved_amount: 0, pending_amount: 0 });
            updateTypeBreakdown([]);
            document.getElementById('emptyState').classList.remove('hidden');
        }
    } catch (err) {
        console.error('Error:', err);
        document.getElementById('loading').classList.add('hidden');
        document.getElementById('emptyState').classList.remove('hidden');
    }
}

function updateSummary(s) {
    document.getElementById('totalConversions').textContent = s.total || 0;
    document.getElementById('approvedAmt').textContent = '₹' + fmtINR(s.approved_amount);
    document.getElementById('pendingAmt').textContent = '₹' + fmtINR(s.pending_amount);
}

function updateTypeBreakdown(data) {
    const container = document.getElementById('typeBreakdown');
    const counts = { customer: 0, painter: 0, engineer: 0 };
    data.forEach(i => { if (counts[i.lead_type] !== undefined) counts[i.lead_type]++; });

    const colors = {
        customer: { bg: 'bg-blue-50', text: 'text-blue-700', icon: '&#128100;' },
        painter: { bg: 'bg-green-50', text: 'text-green-700', icon: '&#127912;' },
        engineer: { bg: 'bg-amber-50', text: 'text-amber-700', icon: '&#128736;' }
    };

    container.innerHTML = Object.entries(counts).map(([type, count]) => {
        const c = colors[type];
        return `<div class="${c.bg} ${c.text} rounded-xl px-4 py-2 flex items-center gap-2 flex-shrink-0">
            <span class="text-lg">${c.icon}</span>
            <span class="font-semibold text-sm">${count}</span>
            <span class="text-xs opacity-70">${type}</span>
        </div>`;
    }).join('');
}

function filterByStatus(status) {
    currentStatusFilter = status;
    document.querySelectorAll('.filter-tab').forEach(t => {
        const isActive = t.dataset.status === status;
        t.className = `filter-tab flex-1 py-2 text-xs font-semibold rounded-lg transition ${isActive ? 'bg-green-50 text-green-700' : 'text-gray-500'}`;
    });

    const filtered = status ? allIncentives.filter(i => i.status === status) : allIncentives;

    if (filtered.length > 0) {
        renderIncentives(filtered);
        document.getElementById('incentiveList').classList.remove('hidden');
        document.getElementById('emptyState').classList.add('hidden');
    } else {
        document.getElementById('incentiveList').classList.add('hidden');
        document.getElementById('emptyState').classList.remove('hidden');
    }
}

function renderIncentives(data) {
    const container = document.getElementById('incentiveList');

    const statusConfig = {
        approved: { bg: 'bg-green-50', border: 'border-green-200', badge: 'bg-green-100 text-green-700', icon: '&#10003;', label: 'Approved' },
        pending: { bg: 'bg-amber-50', border: 'border-amber-200', badge: 'bg-amber-100 text-amber-700', icon: '&#9202;', label: 'Pending' },
        rejected: { bg: 'bg-red-50', border: 'border-red-200', badge: 'bg-red-100 text-red-700', icon: '&#10007;', label: 'Rejected' }
    };

    const typeColors = {
        customer: 'bg-blue-100 text-blue-700',
        painter: 'bg-green-100 text-green-700',
        engineer: 'bg-amber-100 text-amber-700'
    };

    container.innerHTML = data.map(i => {
        const s = statusConfig[i.status] || statusConfig.pending;
        const created = new Date(i.created_at);
        const dateStr = created.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });

        return `<div class="incentive-card ${s.bg} border ${s.border} rounded-xl p-4">
            <div class="flex items-start justify-between">
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 mb-1.5">
                        <span class="text-sm font-bold text-gray-900">${escHtml(i.lead_name) || 'Manual'}</span>
                        <span class="px-2 py-0.5 rounded-full text-[10px] font-semibold ${typeColors[i.lead_type] || ''}">${escHtml(i.lead_type || '')}</span>
                    </div>
                    ${i.lead_phone ? `<p class="text-xs text-gray-500 mb-1">${escHtml(i.lead_phone)}</p>` : ''}
                    ${i.notes ? `<p class="text-xs text-gray-500 truncate">${escHtml(i.notes)}</p>` : ''}
                </div>
                <div class="text-right flex-shrink-0 ml-3">
                    <div class="text-lg font-bold text-gray-900">₹${fmtINR(i.amount)}</div>
                    <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${s.badge}">
                        ${s.label}
                    </span>
                </div>
            </div>
            <div class="flex items-center justify-between mt-2 pt-2 border-t border-gray-200/50">
                <span class="text-[11px] text-gray-400">${dateStr}</span>
                ${i.approved_by_name ? `<span class="text-[11px] text-gray-400">by ${escHtml(i.approved_by_name)}</span>` : ''}
            </div>
        </div>`;
    }).join('');
}

// Request Incentive
function showRequestModal() {
    document.getElementById('reqAmount').value = '';
    document.getElementById('reqInvoiceRef').value = '';
    document.getElementById('reqNotes').value = '';
    document.getElementById('requestModal').classList.remove('hidden');
    document.getElementById('requestModal').classList.add('flex');
}

function closeRequestModal() {
    document.getElementById('requestModal').classList.add('hidden');
    document.getElementById('requestModal').classList.remove('flex');
}

async function submitRequest() {
    const amount = document.getElementById('reqAmount').value;
    const invoice_reference = document.getElementById('reqInvoiceRef').value.trim();
    const notes = document.getElementById('reqNotes').value.trim();

    if (!amount || parseFloat(amount) <= 0) { alert('Enter a valid amount'); return; }
    if (!invoice_reference) { alert('Invoice reference is required'); return; }

    try {
        const res = await fetch(`${API_BASE}/api/salary/incentives/request`, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({ amount: parseFloat(amount), invoice_reference, notes })
        });
        const result = await res.json();
        if (result.success) {
            alert(result.message);
            closeRequestModal();
            loadIncentives();
        } else {
            alert('Error: ' + result.message);
        }
    } catch (err) {
        alert('Network error');
    }
}

// ── Static handler wiring (externalized from inline on*= attributes; S9+F5 Phase E batch 11, 2026-06-25) ──
// Header "+ Request" button (was onclick="showRequestModal()")
document.getElementById('requestBtn').addEventListener('click', showRequestModal);
// Month filter select (was onchange="loadIncentives()")
document.getElementById('filterMonth').addEventListener('change', loadIncentives);
// Filter tabs (were onclick="filterByStatus('<status>')") — literal status arg per tab
document.querySelectorAll('.filter-tab').forEach(tab => {
    tab.addEventListener('click', () => filterByStatus(tab.dataset.status));
});
// Modal Cancel button (was onclick="closeRequestModal()")
document.getElementById('cancelBtn').addEventListener('click', closeRequestModal);
// Modal Submit button (was onclick="submitRequest()")
document.getElementById('submitBtn').addEventListener('click', submitRequest);

// Init
initMonthFilter();
loadIncentives();
