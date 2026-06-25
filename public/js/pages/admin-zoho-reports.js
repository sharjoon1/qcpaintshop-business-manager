// admin-zoho-reports page logic — externalized from admin-zoho-reports.html (S9+F5 strict CSP).
// NON-deferred, loaded right before </body> (matches original end-of-body timing).
// Verbatim move of the inline block; static onclick/onchange handlers converted to
// addEventListener at the bottom. No logic/renaming/escaping changes.
function esc(s){ if(s===null||s===undefined) return ''; const d=document.createElement('div'); d.textContent=String(s); return d.innerHTML; }

// ===== State =====
let currentReport = 'profit_loss';
let lastCacheTime = null;

// ===== Currency formatting =====
function formatCurrency(val) {
    if (val === null || val === undefined || val === '') return '--';
    return '₹' + parseFloat(val).toLocaleString('en-IN', { minimumFractionDigits: 2 });
}

// ===== Date helpers (Indian Financial Year: Apr 1 - Mar 31) =====
function toISO(d) {
    return d.toISOString().split('T')[0];
}

function getIndianFYStart(refDate) {
    const y = refDate.getMonth() >= 3 ? refDate.getFullYear() : refDate.getFullYear() - 1;
    return new Date(y, 3, 1); // April 1
}

function getIndianFYEnd(refDate) {
    const y = refDate.getMonth() >= 3 ? refDate.getFullYear() + 1 : refDate.getFullYear();
    return new Date(y, 2, 31); // March 31
}

function getCurrentQuarterDates() {
    const now = new Date();
    const m = now.getMonth(); // 0-indexed
    // Indian FY quarters: Q1=Apr-Jun, Q2=Jul-Sep, Q3=Oct-Dec, Q4=Jan-Mar
    let qStart, qEnd;
    if (m >= 3 && m <= 5) {
        qStart = new Date(now.getFullYear(), 3, 1);
        qEnd = new Date(now.getFullYear(), 5, 30);
    } else if (m >= 6 && m <= 8) {
        qStart = new Date(now.getFullYear(), 6, 1);
        qEnd = new Date(now.getFullYear(), 8, 30);
    } else if (m >= 9 && m <= 11) {
        qStart = new Date(now.getFullYear(), 9, 1);
        qEnd = new Date(now.getFullYear(), 11, 31);
    } else {
        qStart = new Date(now.getFullYear(), 0, 1);
        qEnd = new Date(now.getFullYear(), 2, 31);
    }
    return { start: qStart, end: qEnd };
}

function applyPreset() {
    const preset = document.getElementById('datePreset').value;
    if (!preset) return;
    const now = new Date();
    let from, to;

    switch (preset) {
        case 'this_month':
            from = new Date(now.getFullYear(), now.getMonth(), 1);
            to = new Date(now.getFullYear(), now.getMonth() + 1, 0);
            break;
        case 'last_month':
            from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
            to = new Date(now.getFullYear(), now.getMonth(), 0);
            break;
        case 'this_quarter': {
            const q = getCurrentQuarterDates();
            from = q.start;
            to = q.end;
            break;
        }
        case 'this_fy':
            from = getIndianFYStart(now);
            to = getIndianFYEnd(now);
            break;
        case 'last_fy': {
            const lastFYRef = new Date(now.getFullYear() - 1, now.getMonth(), 1);
            from = getIndianFYStart(lastFYRef);
            to = getIndianFYEnd(lastFYRef);
            break;
        }
    }

    if (from) document.getElementById('fromDate').value = toISO(from);
    if (to) document.getElementById('toDate').value = toISO(to);
}

// ===== Report Tab Selection =====
function selectReport(type) {
    currentReport = type;
    localStorage.setItem('zoho_report_type', type);
    const tabs = document.querySelectorAll('#reportTabs button');
    tabs.forEach(btn => {
        if (btn.dataset.report === type) {
            btn.className = 'pill-btn px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap bg-purple-600 text-white';
        } else {
            btn.className = 'pill-btn px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap bg-white text-gray-700 border hover:bg-gray-50';
        }
    });

    // Balance Sheet only needs to_date
    const fromGroup = document.getElementById('fromDateGroup');
    if (type === 'balance_sheet') {
        fromGroup.style.opacity = '0.5';
        fromGroup.querySelector('input').disabled = true;
    } else {
        fromGroup.style.opacity = '1';
        fromGroup.querySelector('input').disabled = false;
    }
}

// ===== Show/Hide States =====
function showState(state) {
    ['loadingState', 'errorState', 'initialState', 'reportArea'].forEach(id => {
        document.getElementById(id).classList.add('hidden');
    });
    if (state) document.getElementById(state).classList.remove('hidden');
}

function showError(title, message) {
    document.getElementById('errorTitle').textContent = title || 'Failed to load report';
    document.getElementById('errorMessage').textContent = message || 'An error occurred while fetching the report.';
    showState('errorState');
}

// ===== Generate Report =====
async function generateReport() {
    const fromDate = document.getElementById('fromDate').value;
    const toDate = document.getElementById('toDate').value;
    const useCached = document.getElementById('useCached').checked;

    // Validate dates
    if (currentReport !== 'balance_sheet' && !fromDate) {
        showError('Missing Date', 'Please select a From Date.');
        return;
    }
    if (!toDate) {
        showError('Missing Date', 'Please select a To Date.');
        return;
    }

    // Persist filter state
    localStorage.setItem('zoho_report_from', fromDate);
    localStorage.setItem('zoho_report_to', toDate);

    showState('loadingState');
    document.getElementById('cacheIndicator').classList.add('hidden');

    // Build URL
    let url = `/api/zoho/reports/${currentReport}?`;
    const params = new URLSearchParams();
    if (currentReport !== 'balance_sheet' && fromDate) {
        params.append('from_date', fromDate);
    }
    params.append('to_date', toDate);
    if (useCached) {
        params.append('use_cache', 'true');
    }
    url += params.toString();

    try {
        const response = await fetch(url, { headers: getAuthHeaders() });

        if (response.status === 401) {
            localStorage.removeItem('auth_token');
            localStorage.removeItem('user');
            window.location.href = '/login.html';
            return;
        }

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.message || `Server returned ${response.status}`);
        }

        const data = await response.json();

        // Check for cache indicator
        if (data.cached && data.cached_at) {
            lastCacheTime = data.cached_at;
            const cacheDate = new Date(data.cached_at);
            const timeStr = cacheDate.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
            document.getElementById('cacheMessage').textContent = `Cached data from ${timeStr}. Click to refresh.`;
            document.getElementById('cacheIndicator').classList.remove('hidden');
        } else {
            document.getElementById('cacheIndicator').classList.add('hidden');
        }

        renderReport(currentReport, data);
        showState('reportArea');

    } catch (err) {
        console.error('Report fetch error:', err);
        showError('Failed to load report', err.message);
    }
}

function refreshReport() {
    document.getElementById('useCached').checked = false;
    generateReport();
}

// ===== Render Report =====
function renderReport(type, data) {
    const summaryCards = document.getElementById('summaryCards');
    const thead = document.getElementById('reportTableHead');
    const tbody = document.getElementById('reportTableBody');
    summaryCards.innerHTML = '';
    thead.innerHTML = '';
    tbody.innerHTML = '';

    // Hide P&L chart for non-P&L reports
    const plContainer = document.getElementById('plChartContainer');
    if (plContainer) plContainer.classList.add('hidden');

    const reportData = data.report_data || data.data || data;

    switch (type) {
        case 'profit_loss':
            renderProfitLoss(reportData, summaryCards, thead, tbody);
            break;
        case 'balance_sheet':
            renderBalanceSheet(reportData, summaryCards, thead, tbody);
            break;
        case 'sales_by_customer':
            renderSalesByCustomer(reportData, summaryCards, thead, tbody);
            break;
        case 'sales_by_item':
            renderSalesByItem(reportData, summaryCards, thead, tbody);
            break;
        case 'receivables':
            renderReceivables(reportData, summaryCards, thead, tbody);
            break;
        case 'aging':
            renderAging(reportData, summaryCards, thead, tbody);
            break;
    }
}

// ===== Summary Card Helper =====
function createSummaryCard(label, value, colorClass) {
    return `
        <div class="bg-white rounded-lg shadow p-5 border-l-4 ${colorClass}">
            <p class="text-sm text-gray-500 font-medium">${label}</p>
            <p class="text-2xl font-bold mt-1 ${colorClass.includes('green') ? 'text-green-700' : colorClass.includes('red') ? 'text-red-700' : 'text-gray-800'}">${value}</p>
        </div>`;
}

// ===== Table Helpers =====
function buildTableHead(columns) {
    return '<tr>' + columns.map(col =>
        `<th class="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider border-b">${col}</th>`
    ).join('') + '</tr>';
}

function buildTableRow(cells, isTotal) {
    const cls = isTotal ? 'font-bold bg-gray-50' : '';
    return `<tr class="${cls}">` + cells.map(cell =>
        `<td class="px-4 py-3 text-gray-700 border-b border-gray-100 whitespace-nowrap">${cell}</td>`
    ).join('') + '</tr>';
}

// ===== Extract value from Zoho report rows =====
function extractVal(row, key) {
    if (row[key] !== undefined) return row[key];
    if (row.total !== undefined) return row.total;
    return '';
}

// ===== Profit & Loss =====
function renderProfitLoss(data, summaryCards, thead, tbody) {
    let totalIncome = 0, totalExpense = 0, netProfit = 0;

    // Try to extract summary values from various Zoho response structures
    if (data.summary) {
        totalIncome = parseFloat(data.summary.total_income || data.summary.income || 0);
        totalExpense = parseFloat(data.summary.total_expense || data.summary.expense || 0);
        netProfit = parseFloat(data.summary.net_profit || data.summary.net_profit_or_loss || 0);
    } else if (data.total_income !== undefined) {
        totalIncome = parseFloat(data.total_income || 0);
        totalExpense = parseFloat(data.total_expense || 0);
        netProfit = parseFloat(data.net_profit || 0);
    } else {
        netProfit = totalIncome - totalExpense;
    }

    const profitColor = netProfit >= 0 ? 'border-green-500' : 'border-red-500';
    const profitTextColor = netProfit >= 0 ? 'text-green-700' : 'text-red-700';

    summaryCards.innerHTML =
        createSummaryCard('Total Income', formatCurrency(totalIncome), 'border-blue-500') +
        createSummaryCard('Total Expense', formatCurrency(totalExpense), 'border-orange-500') +
        `<div class="bg-white rounded-lg shadow p-5 border-l-4 ${profitColor}">
            <p class="text-sm text-gray-500 font-medium">Net Profit / Loss</p>
            <p class="text-2xl font-bold mt-1 ${profitTextColor}">${formatCurrency(netProfit)}</p>
        </div>`;

    // Show P&L summary chart
    if (totalIncome > 0 || totalExpense > 0) {
        showPLChart(totalIncome, totalExpense, netProfit);
    }

    // Render detail rows if available
    thead.innerHTML = buildTableHead(['Account', 'Amount']);

    const rows = data.rows || data.line_items || data.sections || [];
    if (Array.isArray(rows) && rows.length > 0) {
        rows.forEach(row => {
            const name = row.account_name || row.name || row.label || row.account || '';
            const amount = row.amount || row.total || row.value || 0;
            const isSection = row.is_section || row.is_header || false;
            if (isSection) {
                tbody.innerHTML += `<tr class="bg-gray-50"><td colspan="2" class="px-4 py-3 font-bold text-gray-800 border-b">${esc(name)}</td></tr>`;
            } else {
                tbody.innerHTML += buildTableRow([esc(name), formatCurrency(amount)], row.is_total || false);
            }
        });
    } else {
        tbody.innerHTML = `<tr><td colspan="2" class="px-4 py-8 text-center text-gray-400">No detailed line items available.</td></tr>`;
    }
}

// ===== Balance Sheet =====
function renderBalanceSheet(data, summaryCards, thead, tbody) {
    let totalAssets = 0, totalLiabilities = 0, equity = 0;

    if (data.summary) {
        totalAssets = parseFloat(data.summary.total_assets || 0);
        totalLiabilities = parseFloat(data.summary.total_liabilities || 0);
        equity = parseFloat(data.summary.equity || data.summary.total_equity || 0);
    } else {
        totalAssets = parseFloat(data.total_assets || 0);
        totalLiabilities = parseFloat(data.total_liabilities || 0);
        equity = parseFloat(data.equity || data.total_equity || 0);
    }

    summaryCards.innerHTML =
        createSummaryCard('Total Assets', formatCurrency(totalAssets), 'border-blue-500') +
        createSummaryCard('Total Liabilities', formatCurrency(totalLiabilities), 'border-red-500') +
        createSummaryCard('Equity', formatCurrency(equity), 'border-green-500');

    thead.innerHTML = buildTableHead(['Account', 'Amount']);

    const rows = data.rows || data.line_items || data.sections || [];
    if (Array.isArray(rows) && rows.length > 0) {
        rows.forEach(row => {
            const name = row.account_name || row.name || row.label || row.account || '';
            const amount = row.amount || row.total || row.value || 0;
            const isSection = row.is_section || row.is_header || false;
            if (isSection) {
                tbody.innerHTML += `<tr class="bg-gray-50"><td colspan="2" class="px-4 py-3 font-bold text-gray-800 border-b">${esc(name)}</td></tr>`;
            } else {
                tbody.innerHTML += buildTableRow([esc(name), formatCurrency(amount)], row.is_total || false);
            }
        });
    } else {
        tbody.innerHTML = `<tr><td colspan="2" class="px-4 py-8 text-center text-gray-400">No detailed line items available.</td></tr>`;
    }
}

// ===== Sales by Customer =====
function renderSalesByCustomer(data, summaryCards, thead, tbody) {
    const rows = data.rows || data.sales || data.customers || data || [];
    summaryCards.innerHTML = '';

    thead.innerHTML = buildTableHead(['Customer Name', 'Invoice Count', 'Total Sales', 'Returns', 'Net Sales']);

    if (Array.isArray(rows) && rows.length > 0) {
        // Sort by highest sales
        const sorted = [...rows].sort((a, b) => {
            const aVal = parseFloat(a.total_sales || a.sales || a.total || 0);
            const bVal = parseFloat(b.total_sales || b.sales || b.total || 0);
            return bVal - aVal;
        });

        let grandTotal = 0;
        sorted.forEach(row => {
            const name = row.customer_name || row.name || row.customer || '';
            const invoices = row.invoice_count || row.invoices || row.count || 0;
            const totalSales = parseFloat(row.total_sales || row.sales || row.total || 0);
            const returns = parseFloat(row.returns || row.credit_notes || 0);
            const netSales = parseFloat(row.net_sales || (totalSales - returns));
            grandTotal += netSales;
            tbody.innerHTML += buildTableRow([esc(name), invoices, formatCurrency(totalSales), formatCurrency(returns), formatCurrency(netSales)], false);
        });

        tbody.innerHTML += buildTableRow(['Total', '', '', '', formatCurrency(grandTotal)], true);
    } else {
        tbody.innerHTML = `<tr><td colspan="5" class="px-4 py-8 text-center text-gray-400">No sales data available.</td></tr>`;
    }
}

// ===== Sales by Item =====
function renderSalesByItem(data, summaryCards, thead, tbody) {
    const rows = data.rows || data.items || data.sales || data || [];
    summaryCards.innerHTML = '';

    thead.innerHTML = buildTableHead(['Item Name', 'Quantity Sold', 'Amount']);

    if (Array.isArray(rows) && rows.length > 0) {
        const sorted = [...rows].sort((a, b) => {
            const aVal = parseFloat(a.amount || a.total || a.sales_amount || 0);
            const bVal = parseFloat(b.amount || b.total || b.sales_amount || 0);
            return bVal - aVal;
        });

        let grandTotal = 0;
        sorted.forEach(row => {
            const name = row.item_name || row.name || row.item || '';
            const qty = row.quantity_sold || row.quantity || row.qty || 0;
            const amount = parseFloat(row.amount || row.total || row.sales_amount || 0);
            grandTotal += amount;
            tbody.innerHTML += buildTableRow([esc(name), qty, formatCurrency(amount)], false);
        });

        tbody.innerHTML += buildTableRow(['Total', '', formatCurrency(grandTotal)], true);
    } else {
        tbody.innerHTML = `<tr><td colspan="3" class="px-4 py-8 text-center text-gray-400">No item sales data available.</td></tr>`;
    }
}

// ===== Receivables Summary =====
function renderReceivables(data, summaryCards, thead, tbody) {
    const rows = data.rows || data.receivables || data.customers || data || [];
    summaryCards.innerHTML = '';

    thead.innerHTML = buildTableHead(['Customer', 'Current', '1-15 days', '16-30 days', '31-45 days', '>45 days', 'Total']);

    if (Array.isArray(rows) && rows.length > 0) {
        let totals = { current: 0, d15: 0, d30: 0, d45: 0, d45plus: 0, total: 0 };

        rows.forEach(row => {
            const name = row.customer_name || row.name || row.customer || '';
            const current = parseFloat(row.current || row.not_due || 0);
            const d15 = parseFloat(row['1_15_days'] || row.days_1_15 || row.bucket_1 || 0);
            const d30 = parseFloat(row['16_30_days'] || row.days_16_30 || row.bucket_2 || 0);
            const d45 = parseFloat(row['31_45_days'] || row.days_31_45 || row.bucket_3 || 0);
            const d45plus = parseFloat(row['above_45_days'] || row.days_above_45 || row.bucket_4 || 0);
            const total = parseFloat(row.total || (current + d15 + d30 + d45 + d45plus));

            totals.current += current;
            totals.d15 += d15;
            totals.d30 += d30;
            totals.d45 += d45;
            totals.d45plus += d45plus;
            totals.total += total;

            tbody.innerHTML += buildTableRow([
                esc(name), formatCurrency(current), formatCurrency(d15), formatCurrency(d30),
                formatCurrency(d45), formatCurrency(d45plus), formatCurrency(total)
            ], false);
        });

        tbody.innerHTML += buildTableRow([
            'Total', formatCurrency(totals.current), formatCurrency(totals.d15),
            formatCurrency(totals.d30), formatCurrency(totals.d45),
            formatCurrency(totals.d45plus), formatCurrency(totals.total)
        ], true);
    } else {
        tbody.innerHTML = `<tr><td colspan="7" class="px-4 py-8 text-center text-gray-400">No receivables data available.</td></tr>`;
    }
}

// ===== Aging Report =====
function renderAging(data, summaryCards, thead, tbody) {
    const rows = data.rows || data.aging || data.customers || data || [];
    summaryCards.innerHTML = '';

    // Detect aging buckets from data or use defaults
    const defaultBuckets = ['Current', '1-15', '16-30', '31-45', '46-60', '>60'];
    const bucketHeaders = data.bucket_headers || defaultBuckets;

    thead.innerHTML = buildTableHead(['Customer', ...bucketHeaders, 'Total']);

    if (Array.isArray(rows) && rows.length > 0) {
        const bucketTotals = new Array(bucketHeaders.length).fill(0);
        let grandTotal = 0;

        rows.forEach(row => {
            const name = row.customer_name || row.name || row.customer || '';
            const buckets = row.buckets || row.aging_buckets || [];
            const total = parseFloat(row.total || 0);
            grandTotal += total;

            const bucketCells = bucketHeaders.map((_, i) => {
                const val = parseFloat(buckets[i] || 0);
                bucketTotals[i] += val;
                return formatCurrency(val);
            });

            tbody.innerHTML += buildTableRow([esc(name), ...bucketCells, formatCurrency(total)], false);
        });

        const totalCells = bucketTotals.map(v => formatCurrency(v));
        tbody.innerHTML += buildTableRow(['Total', ...totalCells, formatCurrency(grandTotal)], true);
    } else {
        const colSpan = bucketHeaders.length + 2;
        tbody.innerHTML = `<tr><td colspan="${colSpan}" class="px-4 py-8 text-center text-gray-400">No aging data available.</td></tr>`;
    }
}

// ===== P&L Bar Chart =====
function showPLChart(income, expense, profit) {
    const container = document.getElementById('plChartContainer');
    if (!container) return;
    container.classList.remove('hidden');
    const ctx = document.getElementById('plChart').getContext('2d');
    if (window._plChart) window._plChart.destroy();
    window._plChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['Income', 'Expense', 'Net Profit'],
            datasets: [{
                data: [income, expense, profit],
                backgroundColor: [
                    'rgba(99,102,241,0.75)',
                    'rgba(249,115,22,0.75)',
                    profit >= 0 ? 'rgba(16,185,129,0.75)' : 'rgba(239,68,68,0.75)'
                ],
                borderRadius: 6,
                borderSkipped: false
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function(ctx) {
                            return ' ₹' + Math.abs(ctx.raw).toLocaleString('en-IN', { minimumFractionDigits: 0 });
                        }
                    }
                }
            },
            scales: {
                y: { ticks: { callback: v => '₹' + (v/1000).toFixed(0) + 'k' } }
            }
        }
    });
}

// ===== Export CSV =====
function exportReportCSV() {
    const table = document.getElementById('reportTable');
    if (!table) return;
    const rows = Array.from(table.querySelectorAll('tr'));
    if (!rows.length) return;
    const csv = rows.map(row =>
        Array.from(row.querySelectorAll('th,td'))
            .map(cell => '"' + cell.textContent.trim().replace(/"/g, '""') + '"')
            .join(',')
    ).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'zoho-report-' + currentReport + '-' + new Date().toISOString().split('T')[0] + '.csv';
    a.click();
    URL.revokeObjectURL(url);
}

// ===== Init =====
document.addEventListener('DOMContentLoaded', function() {
    const savedReport = localStorage.getItem('zoho_report_type');
    const savedFrom = localStorage.getItem('zoho_report_from');
    const savedTo = localStorage.getItem('zoho_report_to');

    if (savedFrom) {
        document.getElementById('fromDate').value = savedFrom;
    } else {
        const fyStart = getIndianFYStart(new Date());
        document.getElementById('fromDate').value = toISO(fyStart);
    }

    if (savedTo) {
        document.getElementById('toDate').value = savedTo;
    } else {
        const now = new Date();
        const fyEnd = getIndianFYEnd(now);
        document.getElementById('toDate').value = toISO(now > fyEnd ? fyEnd : now);
    }

    selectReport(savedReport || 'profit_loss');
});

// ===== Handler wiring (externalized from inline on*= attributes, S9+F5 strict CSP) =====
// Report tab pills — converted from onclick="selectReport('<type>')" on each button.
// The buttons share data-report, so a single delegated listener covers all six.
document.getElementById('reportTabs').addEventListener('click', function(e) {
    const btn = e.target.closest('button[data-report]');
    if (!btn) return;
    selectReport(btn.dataset.report);
});

// Date preset — converted from onchange="applyPreset()" on #datePreset.
document.getElementById('datePreset').addEventListener('change', applyPreset);

// Generate button — converted from onclick="generateReport()" on #generateReportBtn.
const generateReportBtn = document.getElementById('generateReportBtn');
if (generateReportBtn) generateReportBtn.addEventListener('click', generateReport);

// Cache "Refresh" link — converted from onclick="refreshReport()" on #refreshReportBtn.
const refreshReportBtn = document.getElementById('refreshReportBtn');
if (refreshReportBtn) refreshReportBtn.addEventListener('click', refreshReport);

// Error-state "Retry" button — converted from onclick="generateReport()" on #retryReportBtn.
const retryReportBtn = document.getElementById('retryReportBtn');
if (retryReportBtn) retryReportBtn.addEventListener('click', generateReport);

// Export CSV button — converted from onclick="exportReportCSV()" on #exportCsvBtn.
const exportCsvBtn = document.getElementById('exportCsvBtn');
if (exportCsvBtn) exportCsvBtn.addEventListener('click', exportReportCSV);
