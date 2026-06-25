// Page logic externalized from admin-zoho-expenses.html inline <script>
// (S9+F5 Phase E batch 10, 2026-06-25) so the page runs under the enforced strict CSP.
// Verbatim move of all functions; inline on*= handlers converted to addEventListener
// + data-action delegation. No logic changes, no renames, escaping helpers untouched.
let currentPage = 1;
let cnCurrentPage = 1;
let currentTab = 'expenses';

function escHtml(s){ if(s==null) return ''; const d=document.createElement('div'); d.textContent=String(s); return d.innerHTML; }

function formatCurrency(amount) {
    const n = parseFloat(amount) || 0;
    return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function statusBadge(status) {
    const map = {
        paid: 'bg-green-100 text-green-800',
        invoiced: 'bg-green-100 text-green-700',
        unbilled: 'bg-amber-100 text-amber-800',
        'non-billable': 'bg-gray-100 text-gray-600',
        open: 'bg-blue-100 text-blue-800',
        void: 'bg-red-100 text-red-800',
        closed: 'bg-gray-100 text-gray-600'
    };
    const cls = map[(status||'').toLowerCase()] || 'bg-gray-100 text-gray-600';
    return `<span class="px-2 py-0.5 rounded-full text-xs font-medium ${cls}">${status || '-'}</span>`;
}

function switchTab(tab) {
    currentTab = tab;
    document.getElementById('expensesSection').classList.toggle('hidden', tab !== 'expenses');
    document.getElementById('creditNotesSection').classList.toggle('hidden', tab !== 'creditnotes');
    document.getElementById('tabExpenses').className = tab === 'expenses'
        ? 'px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white'
        : 'px-4 py-2 text-sm font-medium rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-gray-50';
    document.getElementById('tabCreditNotes').className = tab === 'creditnotes'
        ? 'px-4 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white'
        : 'px-4 py-2 text-sm font-medium rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-gray-50';
    if (tab === 'creditnotes') loadCreditNotes();
}

async function loadExpenses(page = 1) {
    currentPage = page;
    const from = document.getElementById('fromDate').value;
    const to = document.getElementById('toDate').value;
    const status = document.getElementById('statusFilter').value;
    let url = `/api/zoho/expenses?page=${page}&limit=50`;
    if (from) url += `&from_date=${from}`;
    if (to) url += `&to_date=${to}`;
    if (status) url += `&status=${status}`;
    try {
        const data = await fetch(url, { headers: getAuthHeaders() }).then(r => r.json());
        const tbody = document.getElementById('expensesBody');
        if (!data.expenses || data.expenses.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-gray-400">No expenses found. Click Sync Expenses to load data.</td></tr>';
            updateSummaryCards([], null);
            return;
        }
        tbody.innerHTML = data.expenses.map(e => `
            <tr class="hover:bg-gray-50">
                <td class="px-3 py-2 whitespace-nowrap text-gray-700">${e.date || '-'}</td>
                <td class="px-3 py-2 text-gray-800 max-w-[120px] truncate">${escHtml(e.vendor_name) || '-'}</td>
                <td class="px-3 py-2 text-gray-600 hidden sm:table-cell max-w-[120px] truncate">${escHtml(e.account_name) || '-'}</td>
                <td class="px-3 py-2 text-gray-500 hidden sm:table-cell">${escHtml(e.reference_number) || '-'}</td>
                <td class="px-3 py-2 text-right font-medium text-gray-800">${formatCurrency(e.total)}</td>
                <td class="px-3 py-2 text-right text-gray-500 hidden sm:table-cell">${formatCurrency(e.tax_amount)}</td>
                <td class="px-3 py-2 text-center">${statusBadge(e.status)}</td>
            </tr>
        `).join('');
        updateSummaryCards(data.expenses, null);
        const totalPages = Math.ceil((data.total || data.expenses.length) / 50);
        document.getElementById('expensesPagination').textContent = totalPages > 1
            ? `Page ${page} of ${totalPages} — ${data.total} total`
            : `${data.expenses.length} expenses`;
    } catch (err) {
        document.getElementById('expensesBody').innerHTML = '<tr><td colspan="7" class="text-center py-6 text-red-500">Failed to load expenses</td></tr>';
    }
}

async function loadCreditNotes(page = 1) {
    if (page < 1) return;
    cnCurrentPage = page;
    const limit = 50;
    try {
        const params = new URLSearchParams({ page, limit });
        const data = await fetch(`/api/zoho/creditnotes?${params}`, { headers: getAuthHeaders() }).then(r => r.json());
        const tbody = document.getElementById('creditNotesBody');
        if (!data.creditnotes || data.creditnotes.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-gray-400">No credit notes found. Click Sync Credit Notes to load data.</td></tr>';
            document.getElementById('statCreditBalance').textContent = '₹0';
            document.getElementById('cnPageInfo').textContent = '0 records';
            document.getElementById('cnPrevBtn').disabled = true;
            document.getElementById('cnNextBtn').disabled = true;
            return;
        }
        tbody.innerHTML = data.creditnotes.map(cn => `
            <tr class="hover:bg-gray-50">
                <td class="px-3 py-2 whitespace-nowrap text-gray-700">${cn.date || '-'}</td>
                <td class="px-3 py-2 font-medium text-indigo-700">${escHtml(cn.creditnote_number) || '-'}</td>
                <td class="px-3 py-2 text-gray-700 hidden sm:table-cell">${escHtml(cn.customer_name) || '-'}</td>
                <td class="px-3 py-2 text-right font-medium">${formatCurrency(cn.total)}</td>
                <td class="px-3 py-2 text-right text-blue-700 font-medium">${formatCurrency(cn.balance)}</td>
                <td class="px-3 py-2 text-center">${statusBadge(cn.status)}</td>
            </tr>
        `).join('');
        const totalBalance = data.creditnotes.reduce((s, cn) => s + parseFloat(cn.balance || 0), 0);
        document.getElementById('statCreditBalance').textContent = formatCurrency(totalBalance);

        const totalPages = Math.max(1, Math.ceil((data.total || data.creditnotes.length) / limit));
        document.getElementById('cnPageInfo').textContent = data.total
            ? `Page ${page} of ${totalPages} — ${data.total} total`
            : `${data.creditnotes.length} credit notes`;
        document.getElementById('cnPrevBtn').disabled = page <= 1;
        document.getElementById('cnNextBtn').disabled = page >= totalPages;
    } catch (err) {
        document.getElementById('creditNotesBody').innerHTML = '<tr><td colspan="6" class="text-center py-6 text-red-500">Failed to load credit notes</td></tr>';
    }
}

function updateSummaryCards(expenses, creditBalance) {
    const now = new Date();
    const monthStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
    const monthTotal = expenses.filter(e => (e.date||'').startsWith(monthStr)).reduce((s,e) => s + parseFloat(e.total||0), 0);
    const paidTotal = expenses.filter(e => (e.status||'').toLowerCase() === 'paid').reduce((s,e) => s + parseFloat(e.total||0), 0);
    const pendingTotal = expenses.filter(e => ['unbilled','non-billable'].includes((e.status||'').toLowerCase())).reduce((s,e) => s + parseFloat(e.total||0), 0);
    document.getElementById('statMonth').textContent = formatCurrency(monthTotal);
    document.getElementById('statPaid').textContent = formatCurrency(paidTotal);
    document.getElementById('statPending').textContent = formatCurrency(pendingTotal);
}

function applyFilters() {
    loadExpenses(1);
}

async function syncExpenses() {
    const btn = document.getElementById('syncExpBtn');
    btn.disabled = true;
    btn.textContent = 'Syncing...';
    try {
        const data = await fetch('/api/zoho/sync/expenses', { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeaders()), body: '{}' }).then(r => r.json());
        if (data.success) {
            btn.textContent = `✓ ${data.upserted} synced`;
            loadExpenses(1);
        } else {
            btn.textContent = 'Sync failed';
        }
    } catch (e) {
        btn.textContent = 'Error';
    }
    setTimeout(() => { btn.disabled = false; btn.innerHTML = '<svg class="w-4 h-4 inline mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>Sync Expenses'; }, 3000);
}

async function syncCreditNotes() {
    const btn = document.getElementById('syncCNBtn');
    btn.disabled = true;
    btn.textContent = 'Syncing...';
    try {
        const data = await fetch('/api/zoho/sync/creditnotes', { method: 'POST', headers: getAuthHeaders() }).then(r => r.json());
        if (data.success) {
            btn.textContent = `✓ ${data.upserted} synced`;
            if (currentTab === 'creditnotes') loadCreditNotes();
        } else {
            btn.textContent = 'Sync failed';
        }
    } catch (e) {
        btn.textContent = 'Error';
    }
    setTimeout(() => { btn.disabled = false; btn.textContent = 'Sync Credit Notes'; }, 3000);
}

// ── Static handler wiring (externalized from inline on*= attributes; S9+F5 Phase E batch 10, 2026-06-25) ──
// Sync Expenses button (was onclick="syncExpenses()")
document.getElementById('syncExpBtn').addEventListener('click', syncExpenses);
// Sync Credit Notes button (was onclick="syncCreditNotes()")
document.getElementById('syncCNBtn').addEventListener('click', syncCreditNotes);
// Expenses tab button (was onclick="switchTab('expenses')")
document.getElementById('tabExpenses').addEventListener('click', () => switchTab('expenses'));
// Credit Notes tab button (was onclick="switchTab('creditnotes')")
document.getElementById('tabCreditNotes').addEventListener('click', () => switchTab('creditnotes'));
// Apply filters button (was onclick="applyFilters()")
document.getElementById('applyFiltersBtn').addEventListener('click', applyFilters);
// Credit notes Prev button (was onclick="loadCreditNotes(cnCurrentPage - 1)")
document.getElementById('cnPrevBtn').addEventListener('click', () => loadCreditNotes(cnCurrentPage - 1));
// Credit notes Next button (was onclick="loadCreditNotes(cnCurrentPage + 1)")
document.getElementById('cnNextBtn').addEventListener('click', () => loadCreditNotes(cnCurrentPage + 1));

// Initialize
loadExpenses(1);
