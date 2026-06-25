// Page logic for DPL Match Review. Externalized from the admin-dpl-match.html inline <script>
// (S9+F5 Phase C, 2026-06-25) so the page runs under the enforced strict CSP.
// Verbatim move of all functions; inline on*= handlers converted to addEventListener /
// data-action delegation. No logic changes, no renames, escaping helpers untouched.
function esc(s){ if(s===null||s===undefined) return ''; const d=document.createElement('div'); d.textContent=String(s); return d.innerHTML.replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }

let allItems = [];
let filteredItems = [];
let sortCol = 'index';
let sortDir = 'asc';
let summary = {};

async function loadData() {
    const loading = document.getElementById('loading');
    const content = document.getElementById('content');
    const icon = document.getElementById('refreshIcon');

    loading.classList.remove('hidden');
    content.classList.add('hidden');
    icon.textContent = '⏳';

    try {
        const res = await fetch('/api/zoho/dpl-match-report', { headers: getAuthHeaders() });
        const data = await res.json();

        if (!data.success) throw new Error(data.message || 'Failed to load');

        allItems = data.items || [];
        summary = data.summary || {};

        renderSummary();
        populateBrandFilter();
        applyFilters();

        loading.classList.add('hidden');
        content.classList.remove('hidden');
        showToast('Loaded ' + allItems.length + ' items', 'success');
    } catch(e) {
        loading.innerHTML = '<p class="text-red-500">❌ ' + esc(e.message) + '</p><button data-action="loadData" class="mt-3 px-4 py-2 bg-indigo-500 text-white rounded-lg text-sm">Retry</button>';
        showToast('Error: ' + e.message, 'error');
    }
    icon.textContent = '🔄';
}

function renderSummary() {
    const container = document.getElementById('summaryCards');
    let html = '';

    // Overall card
    const totalMatched = Object.values(summary).reduce((s, b) => s + b.matched, 0);
    const totalAll = Object.values(summary).reduce((s, b) => s + b.total, 0);
    const totalUnmatched = totalAll - totalMatched;
    const pct = totalAll ? Math.round(totalMatched / totalAll * 100) : 0;

    html += `<div class="stat-card flex-1">
        <div class="text-xs text-gray-500 font-medium uppercase tracking-wide">Overall</div>
        <div class="flex items-end gap-2 mt-1">
            <span class="text-2xl font-bold text-gray-800">${totalMatched}</span>
            <span class="text-sm text-gray-400">/ ${totalAll}</span>
        </div>
        <div class="progress-bar mt-2"><div class="progress-fill" style="width:${pct}%;background:linear-gradient(90deg,#667eea,#764ba2)"></div></div>
        <div class="flex justify-between mt-1 text-xs">
            <span class="text-green-600">${totalMatched} matched</span>
            <span class="text-amber-600">${totalUnmatched} unmatched</span>
        </div>
    </div>`;

    // Per brand cards
    for (const [brand, data] of Object.entries(summary)) {
        const bpct = data.total ? Math.round(data.matched / data.total * 100) : 0;
        const unm = data.total - data.matched;
        html += `<div class="stat-card flex-1">
            <div class="text-xs text-gray-500 font-medium uppercase tracking-wide">${brand}</div>
            <div class="flex items-end gap-2 mt-1">
                <span class="text-2xl font-bold text-gray-800">${data.matched}</span>
                <span class="text-sm text-gray-400">/ ${data.total}</span>
                <span class="text-xs font-semibold ${bpct >= 80 ? 'text-green-600' : bpct >= 50 ? 'text-amber-600' : 'text-red-500'}">${bpct}%</span>
            </div>
            <div class="progress-bar mt-2"><div class="progress-fill" style="width:${bpct}%;background:${bpct >= 80 ? '#10b981' : bpct >= 50 ? '#f59e0b' : '#ef4444'}"></div></div>
            <div class="flex justify-between mt-1 text-xs">
                <span class="text-green-600">✅ ${data.matched}</span>
                <span class="text-amber-600">⚠️ ${unm}</span>
            </div>
        </div>`;
    }
    container.innerHTML = html;
}

function populateBrandFilter() {
    const sel = document.getElementById('filterBrand');
    const brands = [...new Set(allItems.map(i => i.zoho_brand).filter(Boolean))].sort();
    sel.innerHTML = '<option value="all">All Brands</option>';
    brands.forEach(b => { sel.innerHTML += `<option value="${esc(b)}">${esc(b)}</option>`; });
}

function applyFilters() {
    const brand = document.getElementById('filterBrand').value;
    const status = document.getElementById('filterStatus').value;
    const search = document.getElementById('filterSearch').value.toLowerCase().trim();

    filteredItems = allItems.filter(item => {
        if (brand !== 'all' && item.zoho_brand !== brand) return false;
        if (status !== 'all' && item.status !== status) return false;
        if (search) {
            const hay = [item.zoho_item_name, item.zoho_sku, item.product_name, item.zoho_brand].join(' ').toLowerCase();
            if (!hay.includes(search)) return false;
        }
        return true;
    });

    sortItems();
    renderTable();
    renderMobileCards();
    document.getElementById('resultCount').textContent = filteredItems.length + ' of ' + allItems.length + ' items';
}

function sortBy(col) {
    if (sortCol === col) { sortDir = sortDir === 'asc' ? 'desc' : 'asc'; }
    else { sortCol = col; sortDir = 'asc'; }

    document.querySelectorAll('.sort-icon').forEach(el => {
        el.classList.remove('active');
        el.textContent = '▲';
    });
    const icon = document.querySelector(`.sort-icon[data-col="${col}"]`);
    if (icon) { icon.classList.add('active'); icon.textContent = sortDir === 'asc' ? '▲' : '▼'; }

    sortItems();
    renderTable();
    renderMobileCards();
}

function sortItems() {
    filteredItems.sort((a, b) => {
        let va, vb;
        if (sortCol === 'index') { return 0; } // keep original order
        if (sortCol === 'rate' || sortCol === 'dpl') {
            va = parseFloat(a['zoho_' + (sortCol === 'dpl' ? 'cf_dpl' : sortCol)]) || 0;
            vb = parseFloat(b['zoho_' + (sortCol === 'dpl' ? 'cf_dpl' : sortCol)]) || 0;
        } else if (sortCol === 'brand') {
            va = (a.zoho_brand || '').toLowerCase();
            vb = (b.zoho_brand || '').toLowerCase();
        } else if (sortCol === 'sku') {
            va = (a.zoho_sku || '').toLowerCase();
            vb = (b.zoho_sku || '').toLowerCase();
        } else {
            va = (a[sortCol] || '').toString().toLowerCase();
            vb = (b[sortCol] || '').toString().toLowerCase();
        }
        if (va < vb) return sortDir === 'asc' ? -1 : 1;
        if (va > vb) return sortDir === 'asc' ? 1 : -1;
        return 0;
    });
}

function renderTable() {
    const tbody = document.getElementById('tableBody');
    if (filteredItems.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-gray-400">No items match your filters</td></tr>';
        return;
    }

    // Render in chunks for performance
    const max = Math.min(filteredItems.length, 500);
    let html = '';
    for (let i = 0; i < max; i++) {
        const item = filteredItems[i];
        const isMatched = item.status === 'matched';
        const rate = item.zoho_rate ? '₹' + Number(item.zoho_rate).toLocaleString('en-IN') : '-';
        const dpl = item.zoho_cf_dpl ? '₹' + Number(item.zoho_cf_dpl).toLocaleString('en-IN') : '-';

        html += `<tr class="${isMatched ? 'row-matched' : 'row-unmatched'}">
            <td class="text-gray-400 text-xs">${i + 1}</td>
            <td class="text-xs">${esc(item.zoho_brand) || '-'}</td>
            <td class="font-mono text-xs font-semibold text-indigo-700">${esc(item.zoho_sku) || '-'}</td>
            <td class="text-xs max-w-xs truncate" title="${esc(item.zoho_item_name || '')}">${esc(item.zoho_item_name) || '-'}</td>
            <td class="text-right text-xs font-mono">${rate}</td>
            <td class="text-right text-xs font-mono">${dpl}</td>
            <td><span class="badge ${isMatched ? 'badge-matched' : 'badge-unmatched'}">${isMatched ? '✅ Matched' : '⚠️ Unmatched'}</span></td>
            <td class="text-xs ${isMatched ? 'text-gray-700' : 'text-gray-400 italic'}">${esc(item.product_name) || (isMatched ? '-' : 'Not mapped')}</td>
        </tr>`;
    }
    if (filteredItems.length > 500) {
        html += `<tr><td colspan="8" class="text-center py-4 text-gray-400 text-xs">Showing first 500 of ${filteredItems.length} results. Use filters to narrow down.</td></tr>`;
    }
    tbody.innerHTML = html;
}

function renderMobileCards() {
    const container = document.getElementById('mobileCards');
    const max = Math.min(filteredItems.length, 200);
    let html = '';
    for (let i = 0; i < max; i++) {
        const item = filteredItems[i];
        const isMatched = item.status === 'matched';
        const rate = item.zoho_rate ? '₹' + Number(item.zoho_rate).toLocaleString('en-IN') : '-';

        html += `<div class="mb-2 p-3 rounded-lg border ${isMatched ? 'bg-green-50 border-green-200' : 'bg-amber-50 border-amber-200'}">
            <div class="flex justify-between items-start">
                <div class="flex-1 min-w-0">
                    <div class="text-xs font-mono font-bold text-indigo-700">${esc(item.zoho_sku) || '-'}</div>
                    <div class="text-sm font-medium text-gray-800 truncate">${esc(item.zoho_item_name) || '-'}</div>
                    <div class="text-xs text-gray-500 mt-1">${esc(item.zoho_brand) || '-'}</div>
                </div>
                <div class="text-right ml-3">
                    <div class="text-sm font-bold">${rate}</div>
                    <span class="badge ${isMatched ? 'badge-matched' : 'badge-unmatched'} mt-1">${isMatched ? '✅' : '⚠️'}</span>
                </div>
            </div>
            ${isMatched ? '<div class="text-xs text-green-700 mt-1">→ ' + (esc(item.product_name) || '-') + '</div>' : '<div class="text-xs text-amber-700 mt-1 italic">Not mapped to any product</div>'}
        </div>`;
    }
    if (filteredItems.length > 200) {
        html += '<p class="text-center text-xs text-gray-400 py-3">Showing first 200. Use filters to narrow down.</p>';
    }
    container.innerHTML = html;
}

function exportCSV() {
    // PAGE-197: RFC-4180 escaping + CSV/Excel formula-injection guard for every cell.
    const csvCell = (v) => {
        let s = (v == null ? '' : String(v));
        if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;            // neutralize leading formula chars
        if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
        return s;
    };
    const rows = [['#', 'Brand', 'SKU', 'Zoho Item Name', 'Rate', 'DPL', 'Status', 'Mapped Product']];
    filteredItems.forEach((item, i) => {
        rows.push([
            i + 1,
            item.zoho_brand || '',
            item.zoho_sku || '',
            item.zoho_item_name || '',
            item.zoho_rate || '',
            item.zoho_cf_dpl || '',
            item.status,
            item.product_name || ''
        ]);
    });
    const csv = rows.map(r => r.map(csvCell).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dpl-match-report-' + new Date().toISOString().slice(0, 10) + '.csv';
    a.click();
    URL.revokeObjectURL(url);
    showToast('CSV exported (' + filteredItems.length + ' items)', 'success');
}

function showToast(msg, type = 'info') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show';
    t.style.background = type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#667eea';
    t.style.color = 'white';
    setTimeout(() => { t.classList.remove('show'); }, 3000);
}

// --- S9+F5 CSP: inline on*= handlers wired via addEventListener / data-action delegation ---
function initDplMatchHandlers() {
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) refreshBtn.addEventListener('click', loadData);

    const exportBtn = document.getElementById('exportCsvBtn');
    if (exportBtn) exportBtn.addEventListener('click', exportCSV);

    const filterBrand = document.getElementById('filterBrand');
    if (filterBrand) filterBrand.addEventListener('change', applyFilters);

    const filterStatus = document.getElementById('filterStatus');
    if (filterStatus) filterStatus.addEventListener('change', applyFilters);

    const filterSearch = document.getElementById('filterSearch');
    if (filterSearch) filterSearch.addEventListener('input', applyFilters);

    // Sortable column headers (re-rendered by innerHTML only inside <tbody>, the <thead>
    // is static markup, so direct listeners are safe). data-sort carries the column key.
    document.querySelectorAll('#matchTable thead th[data-sort]').forEach(th => {
        th.addEventListener('click', () => sortBy(th.dataset.sort));
    });

    // Delegated runtime handler for the Retry button rendered into the loading block on
    // a failed load (rebuilt via innerHTML). data-action keeps it CSP-clean.
    document.addEventListener('click', function(e) {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        if (action === 'loadData') { loadData(); }
    });
}

// Init
document.addEventListener('DOMContentLoaded', function() {
    initDplMatchHandlers();
    loadData();
});
