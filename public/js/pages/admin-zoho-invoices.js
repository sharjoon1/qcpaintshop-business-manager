// admin-zoho-invoices page logic — externalized from admin-zoho-invoices.html (S9+F5 strict CSP).
// NON-deferred, loaded right before </body> (matches original end-of-body timing).
// Verbatim move of the inline block; static onclick/onchange/onkeyup handlers converted to
// addEventListener at the bottom, and runtime onclick handlers in innerHTML templates converted
// to data-action + a delegated document-level click listener. No logic/renaming/escaping changes.

// --- State ---
let invoices = [];
let currentPage = 1;
let totalInvoices = 0;
let totalPages = 1;
const PAGE_LIMIT = 20;
let searchTimeout = null;

// --- Helpers ---
function formatINR(amount) {
    return '₹' + parseFloat(amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
}

function formatDate(dateStr) {
    if (!dateStr) return '--';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getStatusBadge(status) {
    const map = {
        paid:           'bg-green-100 text-green-800',
        overdue:        'bg-red-100 text-red-800',
        sent:           'bg-blue-100 text-blue-800',
        partially_paid: 'bg-yellow-100 text-yellow-800',
        draft:          'bg-gray-100 text-gray-700',
        void:           'bg-gray-200 text-gray-500'
    };
    const cls = map[(status || '').toLowerCase()] || 'bg-gray-100 text-gray-700';
    const label = (status || 'unknown').replace(/_/g, ' ');
    return '<span class="inline-block px-2.5 py-1 rounded-full text-xs font-semibold capitalize ' + cls + '">' + label + '</span>';
}

function creditBadge(limit, utilization, balance) {
    limit = Number(limit) || 0;
    utilization = Number(utilization) || 0;
    balance = Number(balance) || 0;
    // Only show for unpaid invoices
    if (balance <= 0) return '<span class="text-gray-300 text-xs">--</span>';
    if (limit === 0) return '<span class="inline-block px-1.5 py-0.5 rounded-full text-xs font-semibold bg-gray-100 text-gray-400" title="No credit limit set">--</span>';
    var bg, fg;
    if (utilization > 100) { bg = '#fecaca'; fg = '#991b1b'; }
    else if (utilization > 80) { bg = '#fee2e2'; fg = '#dc2626'; }
    else if (utilization > 50) { bg = '#fef3c7'; fg = '#92400e'; }
    else { bg = '#d1fae5'; fg = '#065f46'; }
    return '<span class="inline-block px-1.5 py-0.5 rounded-full text-xs font-semibold" style="background:' + bg + ';color:' + fg + '" title="Credit limit: ₹' + limit.toLocaleString('en-IN') + '">' + utilization + '%</span>';
}

function getSortParams() {
    const val = document.getElementById('filterSort').value;
    const parts = val.split('_');
    const order = parts.pop(); // asc or desc
    const sort = parts.join('_');
    return { sort, order: order.toUpperCase() };
}

function debounceSearch() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        currentPage = 1;
        loadInvoices();
    }, 400);
}

// --- API Calls ---
async function loadInvoices() {
    const status = document.getElementById('filterStatus').value;
    const search = document.getElementById('filterSearch').value.trim();
    const { sort, order } = getSortParams();

    const params = new URLSearchParams({
        page: currentPage,
        limit: PAGE_LIMIT,
        sort: sort,
        order: order
    });
    if (status) params.set('status', status);
    if (search) params.set('search', search);

    showLoading(true);
    try {
        const response = await fetch('/api/zoho/invoices?' + params.toString(), {
            headers: getAuthHeaders()
        });

        if (response.status === 401) {
            window.location.href = '/login.html';
            return;
        }

        if (!response.ok) {
            throw new Error('Failed to fetch invoices');
        }

        const result = await response.json();

        if (result.success) {
            invoices = result.data || [];
            totalInvoices = result.pagination ? result.pagination.total : invoices.length;
            totalPages = result.pagination ? result.pagination.totalPages : Math.ceil(totalInvoices / PAGE_LIMIT);
            currentPage = result.pagination ? result.pagination.page : currentPage;

            if (result.stats) {
                updateStats(result.stats);
            }
        } else {
            invoices = [];
            totalInvoices = 0;
            totalPages = 1;
        }

        renderInvoices();
        renderPagination();
        showLoading(false);
    } catch (error) {
        console.error('Error loading invoices:', error);
        showLoading(false);
        showEmpty(true);
    }
}

async function loadStats() {
    try {
        const response = await fetch('/api/zoho/invoices?page=1&limit=1', {
            headers: getAuthHeaders()
        });
        if (response.status === 401) {
            window.location.href = '/login.html';
            return;
        }
        if (response.ok) {
            const result = await response.json();
            if (result.stats) {
                updateStats(result.stats);
            }
        }
    } catch (e) {
        console.error('Error loading stats:', e);
    }
}

async function syncInvoices() {
    const btn = document.getElementById('syncBtn');
    const icon = document.getElementById('syncIcon');
    btn.disabled = true;
    icon.classList.add('animate-spin');
    btn.classList.add('opacity-75');

    showBanner('Syncing invoices from Zoho Books...', 'info');

    try {
        const response = await fetch('/api/zoho/sync/invoices', {
            method: 'POST',
            headers: getAuthHeaders()
        });

        if (response.status === 401) {
            window.location.href = '/login.html';
            return;
        }

        const result = await response.json();

        if (response.ok && result.success) {
            const msg = result.message || 'Invoices synced successfully.';
            showBanner(msg, 'success');
            currentPage = 1;
            loadInvoices();
        } else {
            showBanner(result.message || 'Sync failed. Please try again.', 'error');
        }
    } catch (error) {
        console.error('Sync error:', error);
        showBanner('Sync failed. Check your connection and try again.', 'error');
    } finally {
        btn.disabled = false;
        icon.classList.remove('animate-spin');
        btn.classList.remove('opacity-75');
    }
}

async function openInvoiceDetail(invoiceId) {
    document.getElementById('invoiceModal').classList.remove('hidden');
    document.getElementById('modalLoading').classList.remove('hidden');
    document.getElementById('modalContent').classList.add('hidden');
    document.body.style.overflow = 'hidden';

    try {
        const response = await fetch('/api/zoho/invoices/' + invoiceId, {
            headers: getAuthHeaders()
        });

        if (response.status === 401) {
            window.location.href = '/login.html';
            return;
        }

        if (!response.ok) throw new Error('Failed to load invoice detail');

        const result = await response.json();
        const inv = result.data || result;

        populateModal(inv);
        document.getElementById('modalLoading').classList.add('hidden');
        document.getElementById('modalContent').classList.remove('hidden');
    } catch (error) {
        console.error('Error loading invoice detail:', error);
        closeModal();
        alert('Failed to load invoice details. Please try again.');
    }
}

// --- Rendering ---
function updateStats(stats) {
    document.getElementById('statTotal').textContent = stats.total != null ? stats.total : '--';
    document.getElementById('statPaid').textContent = stats.paid != null ? stats.paid : '--';
    document.getElementById('statSent').textContent = stats.sent != null ? stats.sent : '--';
    document.getElementById('statOverdue').textContent = stats.overdue != null ? stats.overdue : '--';
    document.getElementById('statPartial').textContent = stats.partially_paid != null ? stats.partially_paid : '--';
}

function renderInvoices() {
    const tableBody = document.getElementById('invoiceTableBody');
    const cardsContainer = document.getElementById('invoiceCardsContainer');
    const tableContainer = document.getElementById('invoiceTableContainer');

    if (invoices.length === 0) {
        tableContainer.classList.add('hidden');
        showEmpty(true);
        return;
    }

    showEmpty(false);
    tableContainer.classList.remove('hidden');

    // Desktop table rows
    tableBody.innerHTML = invoices.map(inv => {
        const id = inv.id || inv.zoho_invoice_id;
        return '<tr class="hover:bg-gray-50 cursor-pointer transition" data-action="open-invoice-detail" data-id="' + escapeHtml(id) + '">' +
            '<td class="px-4 py-3 font-semibold text-purple-700 whitespace-nowrap">' + escapeHtml(inv.invoice_number || '--') + '</td>' +
            '<td class="px-4 py-3 text-gray-800">' + escapeHtml(inv.customer_name || '--') + '</td>' +
            '<td class="px-4 py-3 text-gray-600 whitespace-nowrap">' + formatDate(inv.invoice_date) + '</td>' +
            '<td class="px-4 py-3 text-gray-600 whitespace-nowrap">' + formatDate(inv.due_date) + '</td>' +
            '<td class="px-4 py-3 text-gray-800 font-medium text-right whitespace-nowrap">' + formatINR(inv.total) + '</td>' +
            '<td class="px-4 py-3 text-gray-800 font-medium text-right whitespace-nowrap">' + formatINR(inv.balance) + '</td>' +
            '<td class="px-4 py-3 text-center">' + creditBadge(inv.credit_limit, inv.credit_utilization, inv.balance) + '</td>' +
            '<td class="px-4 py-3 text-center">' + getStatusBadge(inv.status) + '</td>' +
        '</tr>';
    }).join('');

    // Mobile cards
    cardsContainer.innerHTML = invoices.map(inv => {
        const id = inv.id || inv.zoho_invoice_id;
        return '<div class="bg-white rounded-lg shadow p-4 cursor-pointer hover:shadow-md transition" data-action="open-invoice-detail" data-id="' + escapeHtml(id) + '">' +
            '<div class="flex justify-between items-start mb-2">' +
                '<div>' +
                    '<div class="font-bold text-purple-700 text-sm">' + escapeHtml(inv.invoice_number || '--') + '</div>' +
                    '<div class="text-gray-800 font-medium text-sm mt-0.5">' + escapeHtml(inv.customer_name || '--') + '</div>' +
                '</div>' +
                '<div>' + getStatusBadge(inv.status) + '</div>' +
            '</div>' +
            '<div class="flex justify-between items-end mt-3">' +
                '<div class="text-xs text-gray-500">' + formatDate(inv.invoice_date) + '</div>' +
                '<div class="text-right">' +
                    '<div class="text-sm font-bold text-gray-800">' + formatINR(inv.total) + '</div>' +
                    (parseFloat(inv.balance || 0) > 0 ? '<div class="text-xs text-red-600">Bal: ' + formatINR(inv.balance) + '</div>' : '') +
                '</div>' +
            '</div>' +
        '</div>';
    }).join('');
}

function renderPagination() {
    const info = document.getElementById('paginationInfo');
    const controls = document.getElementById('paginationControls');

    if (totalInvoices === 0) {
        info.textContent = 'Showing 0 invoices';
        controls.innerHTML = '';
        return;
    }

    const start = (currentPage - 1) * PAGE_LIMIT + 1;
    const end = Math.min(currentPage * PAGE_LIMIT, totalInvoices);
    info.textContent = 'Showing ' + start + '-' + end + ' of ' + totalInvoices + ' invoices';

    let html = '';

    // Previous button
    html += '<button data-action="go-to-page" data-page="' + (currentPage - 1) + '" ' +
            (currentPage <= 1 ? 'disabled' : '') +
            ' class="px-3 py-1.5 pag-mob text-sm rounded-lg border ' +
            (currentPage <= 1 ? 'text-gray-400 border-gray-200 cursor-not-allowed' : 'text-gray-700 border-gray-300 hover:bg-gray-100') +
            '">Prev</button>';

    // Page numbers
    const maxVisible = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxVisible / 2));
    let endPage = Math.min(totalPages, startPage + maxVisible - 1);
    if (endPage - startPage < maxVisible - 1) {
        startPage = Math.max(1, endPage - maxVisible + 1);
    }

    if (startPage > 1) {
        html += '<button data-action="go-to-page" data-page="1" class="px-3 py-1.5 pag-mob text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100">1</button>';
        if (startPage > 2) {
            html += '<span class="px-2 py-1.5 text-sm text-gray-400">...</span>';
        }
    }

    for (let i = startPage; i <= endPage; i++) {
        if (i === currentPage) {
            html += '<button class="px-3 py-1.5 pag-mob text-sm rounded-lg bg-purple-600 text-white font-medium">' + i + '</button>';
        } else {
            html += '<button data-action="go-to-page" data-page="' + i + '" class="px-3 py-1.5 pag-mob text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100">' + i + '</button>';
        }
    }

    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            html += '<span class="px-2 py-1.5 text-sm text-gray-400">...</span>';
        }
        html += '<button data-action="go-to-page" data-page="' + totalPages + '" class="px-3 py-1.5 pag-mob text-sm rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100">' + totalPages + '</button>';
    }

    // Next button
    html += '<button data-action="go-to-page" data-page="' + (currentPage + 1) + '" ' +
            (currentPage >= totalPages ? 'disabled' : '') +
            ' class="px-3 py-1.5 pag-mob text-sm rounded-lg border ' +
            (currentPage >= totalPages ? 'text-gray-400 border-gray-200 cursor-not-allowed' : 'text-gray-700 border-gray-300 hover:bg-gray-100') +
            '">Next</button>';

    controls.innerHTML = html;
}

function populateModal(inv) {
    const detail = inv.zoho_detail || {};
    const lineItems = detail.line_items || [];

    document.getElementById('modalInvoiceTitle').textContent = 'Invoice ' + (inv.invoice_number || '--');
    document.getElementById('modalInvoiceNumber').textContent = inv.invoice_number || '--';
    document.getElementById('modalStatus').innerHTML = getStatusBadge(inv.status);
    document.getElementById('modalCustomer').textContent = inv.customer_name || '--';
    document.getElementById('modalReference').textContent = inv.reference_number || detail.reference_number || '--';
    document.getElementById('modalInvoiceDate').textContent = formatDate(inv.invoice_date);
    document.getElementById('modalDueDate').textContent = formatDate(inv.due_date);

    // Line items
    const lineItemsBody = document.getElementById('modalLineItems');
    if (lineItems.length === 0) {
        lineItemsBody.innerHTML = '<tr><td colspan="5" class="px-4 py-6 text-center text-gray-500">No line items available</td></tr>';
    } else {
        lineItemsBody.innerHTML = lineItems.map(item => {
            return '<tr>' +
                '<td class="px-4 py-2 text-gray-800">' + escapeHtml(item.name || item.description || '--') + '</td>' +
                '<td class="px-4 py-2 text-right text-gray-700">' + (item.quantity != null ? item.quantity : '--') + '</td>' +
                '<td class="px-4 py-2 text-right text-gray-700">' + formatINR(item.rate) + '</td>' +
                '<td class="px-4 py-2 text-right text-gray-700">' + formatINR(item.tax_amount) + '</td>' +
                '<td class="px-4 py-2 text-right font-medium text-gray-800">' + formatINR(item.item_total) + '</td>' +
            '</tr>';
        }).join('');
    }

    // Totals
    const subTotal = detail.sub_total != null ? detail.sub_total : inv.total;
    const taxTotal = detail.tax_total != null ? detail.tax_total : 0;
    const grandTotal = inv.total || detail.total || 0;
    const balance = inv.balance != null ? inv.balance : (detail.balance != null ? detail.balance : 0);

    document.getElementById('modalSubTotal').textContent = formatINR(subTotal);
    document.getElementById('modalTax').textContent = formatINR(taxTotal);
    document.getElementById('modalGrandTotal').textContent = formatINR(grandTotal);
    document.getElementById('modalBalance').textContent = formatINR(balance);
}

// --- UI Helpers ---
function showLoading(show) {
    document.getElementById('loadingState').classList.toggle('hidden', !show);
    if (show) {
        document.getElementById('invoiceTableContainer').classList.add('hidden');
        document.getElementById('emptyState').classList.add('hidden');
    }
}

function showEmpty(show) {
    document.getElementById('emptyState').classList.toggle('hidden', !show);
}

function showBanner(message, type) {
    const banner = document.getElementById('syncBanner');
    const text = document.getElementById('syncBannerText');
    text.textContent = message;

    banner.className = 'mb-4 p-4 rounded-lg flex items-center gap-3 text-sm font-medium';
    if (type === 'success') {
        banner.classList.add('bg-green-50', 'text-green-800', 'border', 'border-green-200');
    } else if (type === 'error') {
        banner.classList.add('bg-red-50', 'text-red-800', 'border', 'border-red-200');
    } else {
        banner.classList.add('bg-blue-50', 'text-blue-800', 'border', 'border-blue-200');
    }
    banner.classList.remove('hidden');

    if (type !== 'info') {
        setTimeout(() => {
            banner.classList.add('hidden');
        }, 6000);
    }
}

function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// --- Actions ---
function applyFilters() {
    currentPage = 1;
    loadInvoices();
}

function clearFilters() {
    document.getElementById('filterStatus').value = '';
    document.getElementById('filterSearch').value = '';
    document.getElementById('filterSort').value = 'invoice_date_desc';
    currentPage = 1;
    loadInvoices();
}

function goToPage(page) {
    if (page < 1 || page > totalPages) return;
    currentPage = page;
    loadInvoices();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeModal() {
    document.getElementById('invoiceModal').classList.add('hidden');
    document.body.style.overflow = '';
}

function closeModalBackdrop(event) {
    if (event.target === document.getElementById('invoiceModal')) {
        closeModal();
    }
}

// Close modal on Escape key
document.addEventListener('keydown', function(e) {
    if (e.key === 'Escape') {
        closeModal();
    }
});

// ===== Handler wiring (externalized from inline on*= attributes, S9+F5 strict CSP) =====

// Delegated click listener for runtime-injected elements inside the rendered templates
// (desktop table rows, mobile cards, pagination buttons).
// Args read via el.dataset. The interpolated invoice id is passed through escapeHtml when
// rendered into data-id and re-read via dataset here, preserving the original escaping.
document.addEventListener('click', function(e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (action === 'open-invoice-detail') {
        // Guard against clicks on disabled pagination buttons (they carry data-action too).
        if (el.disabled) return;
        openInvoiceDetail(el.dataset.id);
    } else if (action === 'go-to-page') {
        if (el.disabled) return;
        goToPage(Number(el.dataset.page));
    }
});

// Header "Sync Invoices" button — converted from onclick="syncInvoices()" on #syncBtn.
const syncBtn = document.getElementById('syncBtn');
if (syncBtn) syncBtn.addEventListener('click', syncInvoices);

// Filter bar: Status select — converted from onchange="applyFilters()" on #filterStatus.
document.getElementById('filterStatus').addEventListener('change', applyFilters);

// Filter bar: Search input — converted from onkeyup="debounceSearch()" on #filterSearch.
document.getElementById('filterSearch').addEventListener('keyup', debounceSearch);

// Filter bar: Sort select — converted from onchange="applyFilters()" on #filterSort.
document.getElementById('filterSort').addEventListener('change', applyFilters);

// Filter bar: "Clear Filters" button — converted from onclick="clearFilters()" on #clearFiltersBtn.
const clearFiltersBtn = document.getElementById('clearFiltersBtn');
if (clearFiltersBtn) clearFiltersBtn.addEventListener('click', clearFilters);

// Empty-state "Sync Invoices" button — converted from onclick="syncInvoices()" on #emptySyncBtn.
const emptySyncBtn = document.getElementById('emptySyncBtn');
if (emptySyncBtn) emptySyncBtn.addEventListener('click', syncInvoices);

// Invoice detail modal backdrop — converted from onclick="closeModalBackdrop(event)" on #invoiceModal.
document.getElementById('invoiceModal').addEventListener('click', function(e) {
    closeModalBackdrop(e);
});

// Inner modal panel — converted from onclick="event.stopPropagation()" so clicks inside the
// panel do not bubble to the backdrop handler above.
const modalPanel = document.getElementById('invoiceModalPanel');
if (modalPanel) modalPanel.addEventListener('click', function(e) { e.stopPropagation(); });

// Modal close (&times;) button — converted from onclick="closeModal()" on #modalCloseBtn.
const modalCloseBtn = document.getElementById('modalCloseBtn');
if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeModal);

// Modal footer "Close" button — converted from onclick="closeModal()" on #modalFooterCloseBtn.
const modalFooterCloseBtn = document.getElementById('modalFooterCloseBtn');
if (modalFooterCloseBtn) modalFooterCloseBtn.addEventListener('click', closeModal);

// --- Init ---
loadInvoices();
