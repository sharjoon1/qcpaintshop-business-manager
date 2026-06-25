// admin-zoho-salesorders page logic — externalized from admin-zoho-salesorders.html (S9+F5 strict CSP).
// NON-deferred, loaded right before </body> (matches original end-of-body timing).
let currentPage = 1;
let allRows = [];

function escHtml(s){ if(s==null) return ''; const d=document.createElement('div'); d.textContent=String(s); return d.innerHTML; }

function formatCurrency(amount) {
    const n = parseFloat(amount) || 0;
    return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function statusBadge(status) {
    const map = {
        confirmed: 'bg-blue-100 text-blue-800',
        draft: 'bg-gray-100 text-gray-600',
        invoiced: 'bg-green-100 text-green-800',
        void: 'bg-red-100 text-red-800'
    };
    const cls = map[(status||'').toLowerCase()] || 'bg-gray-100 text-gray-600';
    return `<span class="px-2 py-0.5 rounded-full text-xs font-medium ${cls}">${status || '-'}</span>`;
}

function applyFilters() { loadSalesOrders(1); }

async function loadSalesOrders(page = 1) {
    currentPage = page;
    const from = document.getElementById('fromDate').value;
    const to = document.getElementById('toDate').value;
    const status = document.getElementById('statusFilter').value;
    const search = document.getElementById('searchInput').value;
    let url = `/api/zoho/salesorders?page=${page}&limit=50`;
    if (from) url += `&from_date=${from}`;
    if (to) url += `&to_date=${to}`;
    if (status) url += `&status=${status}`;
    if (search) url += `&search=${encodeURIComponent(search)}`;
    try {
        const data = await fetch(url, { headers: getAuthHeaders() }).then(r => r.json());
        allRows = data.salesorders || [];
        const tbody = document.getElementById('soBody');
        if (!allRows.length) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-gray-400">No sales orders found for the selected filters.</td></tr>';
            updateSummaryCards([]);
            return;
        }
        tbody.innerHTML = allRows.map(so => `
            <tr class="hover:bg-gray-50 cursor-pointer" data-action="open-so-modal" data-tid="${escHtml(so.transaction_id)}" data-sonum="${escHtml(so.so_number || '')}">
                <td class="px-3 py-2 font-medium text-indigo-700 whitespace-nowrap">${escHtml(so.so_number || so.transaction_id) || '-'}</td>
                <td class="px-3 py-2 whitespace-nowrap text-gray-700">${so.date || '-'}</td>
                <td class="px-3 py-2 text-gray-800 max-w-[140px] truncate">${escHtml(so.customer_name) || '-'}</td>
                <td class="px-3 py-2 text-gray-500 hidden md:table-cell">${so.location_id || '-'}</td>
                <td class="px-3 py-2 text-right font-medium text-gray-800">${formatCurrency(so.total)}</td>
                <td class="px-3 py-2 text-center">${statusBadge(so.status)}</td>
                <td class="px-3 py-2 text-center hidden sm:table-cell">
                    <button class="text-xs px-2 py-1 rounded bg-indigo-50 text-indigo-700 hover:bg-indigo-100">View</button>
                </td>
            </tr>
        `).join('');
        updateSummaryCards(allRows);
        document.getElementById('soPagination').textContent = `${allRows.length} sales orders`;
    } catch (err) {
        document.getElementById('soBody').innerHTML = '<tr><td colspan="7" class="text-center py-6 text-red-500">Failed to load sales orders</td></tr>';
    }
}

function updateSummaryCards(rows) {
    document.getElementById('statTotal').textContent = rows.length;
    document.getElementById('statConfirmed').textContent = rows.filter(r => (r.status||'').toLowerCase() === 'confirmed').length;
    document.getElementById('statInvoiced').textContent = rows.filter(r => (r.status||'').toLowerCase() === 'invoiced').length;
    const total = rows.reduce((s, r) => s + parseFloat(r.total || 0), 0);
    document.getElementById('statValue').textContent = formatCurrency(total);
}

async function openSOModal(transactionId, soNumber) {
    document.getElementById('soModal').classList.remove('hidden');
    document.getElementById('modalSONumber').textContent = soNumber || transactionId;
    document.getElementById('modalContent').innerHTML = '<div class="text-center py-8 text-gray-400">Loading...</div>';
    try {
        const data = await fetch(`/api/zoho/salesorders/${transactionId}`, { headers: getAuthHeaders() }).then(r => r.json());
        if (!data.success || !data.salesorder) {
            document.getElementById('modalContent').innerHTML = '<p class="text-gray-500 text-center py-4">Could not load sales order details.</p>';
            return;
        }
        const so = data.salesorder;
        const items = so.line_items || [];
        document.getElementById('modalContent').innerHTML = `
            <div class="space-y-3">
                <div class="grid grid-cols-2 gap-3 text-sm">
                    <div><span class="text-gray-500">SO Number</span><br><strong>${escHtml(so.salesorder_number) || '-'}</strong></div>
                    <div><span class="text-gray-500">Date</span><br><strong>${so.date || '-'}</strong></div>
                    <div><span class="text-gray-500">Customer</span><br><strong>${escHtml(so.customer_name) || '-'}</strong></div>
                    <div><span class="text-gray-500">Salesperson</span><br><strong>${escHtml(so.salesperson_name) || '-'}</strong></div>
                </div>
                ${items.length ? `
                <div class="border rounded-lg overflow-hidden">
                    <table class="min-w-full text-xs">
                        <thead class="bg-gray-50"><tr>
                            <th class="px-3 py-2 text-left text-gray-600">Item</th>
                            <th class="px-3 py-2 text-right text-gray-600">Qty</th>
                            <th class="px-3 py-2 text-right text-gray-600">Rate</th>
                            <th class="px-3 py-2 text-right text-gray-600">Amount</th>
                        </tr></thead>
                        <tbody class="divide-y divide-gray-100">
                            ${items.map(it => `<tr>
                                <td class="px-3 py-2">${escHtml(it.name || it.item_name) || '-'}</td>
                                <td class="px-3 py-2 text-right">${it.quantity || '-'}</td>
                                <td class="px-3 py-2 text-right">${formatCurrency(it.rate)}</td>
                                <td class="px-3 py-2 text-right font-medium">${formatCurrency(it.item_total)}</td>
                            </tr>`).join('')}
                        </tbody>
                    </table>
                </div>` : '<p class="text-sm text-gray-500">No line items available.</p>'}
                <div class="flex justify-between items-center pt-2 border-t">
                    <strong class="text-gray-700">Total</strong>
                    <strong class="text-lg text-indigo-700">${formatCurrency(so.total)}</strong>
                </div>
                ${so.salesorder_id ? `<a href="https://books.zoho.in/app#salesorders/${so.salesorder_id}" target="_blank" class="block text-center text-sm text-indigo-600 hover:underline mt-2">Open in Zoho &rarr;</a>` : ''}
            </div>
        `;
    } catch (e) {
        document.getElementById('modalContent').innerHTML = '<p class="text-red-500 text-sm text-center py-4">Failed to load details.</p>';
    }
}

function closeSOModal() {
    document.getElementById('soModal').classList.add('hidden');
}

function exportCSV() {
    if (!allRows.length) { alert('No data to export.'); return; }
    const headers = ['SO Number','Date','Customer','Location','Amount','Status'];
    const rows = allRows.map(so => [
        so.so_number || so.transaction_id || '',
        so.date || '',
        so.customer_name || '',
        so.location_id || '',
        so.total || 0,
        so.status || ''
    ]);
    const csv = [headers, ...rows].map(r => r.map(v => '"' + String(v).replace(/"/g,'""') + '"').join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sales-orders-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

// Close modal on overlay click
document.getElementById('soModal').addEventListener('click', function(e) {
    if (e.target === this) closeSOModal();
});

// Converted from static onclick= attributes (S9+F5 strict CSP): exportCSV / applyFilters / closeSOModal.
document.getElementById('btnExportCSV').addEventListener('click', exportCSV);
document.getElementById('btnApplyFilters').addEventListener('click', applyFilters);
document.getElementById('btnCloseSOModal').addEventListener('click', closeSOModal);

// Delegated listener for runtime-rendered rows (converted from inline onclick="openSOModal(...)"
// on each <tr> and the View <button>). Click on a row (or the View button inside it) opens the
// modal; closest() collapses both the row and the nested-button case into a single dispatch.
document.addEventListener('click', function(e) {
    const el = e.target.closest('[data-action="open-so-modal"]');
    if (!el) return;
    openSOModal(el.dataset.tid, el.dataset.sonum);
});

// Init
loadSalesOrders(1);
