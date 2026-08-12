// billing-invoice-print.js — A4 SALE BILL for billing invoices (Batch B1b).
// Strict-CSP-ready: external file, no inline handlers (data-action delegation).
// Query params: ?id= (required), ?mode=pdf (Puppeteer), ?autoprint=1.

// ========================================
// CONFIG
// ========================================
const urlParams = new URLSearchParams(window.location.search);
const invoiceId = urlParams.get('id');
const mode = urlParams.get('mode'); // 'pdf' hides the action bar
const tokenOverride = urlParams.get('token'); // Puppeteer passes this
const autoprint = urlParams.get('autoprint') === '1';

if (!invoiceId) {
    alert('No invoice ID provided');
    window.location.href = '/staff-billing.html';
}

function getToken() {
    return tokenOverride || localStorage.getItem('auth_token');
}

// Money: Indian comma format, 2 decimals only when non-integer.
function formatINR(amount) {
    const n = parseFloat(amount) || 0;
    const opts = Number.isInteger(n)
        ? { minimumFractionDigits: 0, maximumFractionDigits: 0 }
        : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
    return '₹' + n.toLocaleString('en-IN', opts);
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function escapeHtml(str) {
    if (str === null || str === undefined || str === '') return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

const PAY_METHOD_LABELS = {
    cash: 'Cash', upi: 'UPI', bank_transfer: 'Bank Transfer', cheque: 'Cheque', credit: 'Credit'
};

// ========================================
// INIT
// ========================================
if (mode === 'pdf') {
    const bar = document.getElementById('actionBar');
    if (bar) bar.style.display = 'none';
    document.getElementById('printContent').style.marginTop = '0';
    document.body.style.background = 'white';
}
loadBill();

// ========================================
// LOAD BILL
// ========================================
async function loadBill() {
    try {
        const token = getToken();
        const res = await fetch(`/api/billing/invoices/${invoiceId}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) throw new Error('Failed to load invoice (' + res.status + ')');
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'Failed to load invoice');

        const inv = data.invoice || {};
        const items = data.items || [];
        const payments = data.payments || [];

        // Meta
        document.getElementById('biNumber').textContent = inv.invoice_number || '';
        document.getElementById('biDate').textContent = formatDate(inv.invoice_date || inv.created_at);
        if (inv.branch_id) {
            document.getElementById('biBranch').textContent = 'Branch #' + inv.branch_id;
            document.getElementById('branchRow').classList.remove('hidden');
            resolveBranchName(token, inv.branch_id); // best-effort upgrade to the name
        }

        // Customer block
        document.getElementById('custName').textContent = inv.customer_name || '';
        document.getElementById('custPhone').textContent = inv.customer_phone ? 'Phone: ' + inv.customer_phone : '';
        document.getElementById('custAddress').textContent = inv.customer_address || '';

        renderItems(items);
        renderTotals(inv);
        renderPayments(payments);

        loadBranding(token); // best-effort

        document.getElementById('loadingState').classList.add('hidden');
        document.getElementById('printContent').classList.remove('hidden');

        if (autoprint) {
            setTimeout(() => window.print(), 350);
        }
    } catch (error) {
        console.error('Error loading bill:', error);
        document.getElementById('loadingState').innerHTML = `
            <div class="text-center">
                <div class="text-red-500 text-lg font-bold">Failed to load bill</div>
                <div class="text-gray-500 text-sm mt-2">${escapeHtml(error.message)}</div>
                <button data-action="go-back" class="mt-4 px-4 py-2 bg-gray-600 text-white rounded-lg text-sm">Go Back</button>
            </div>`;
    }
}

// ========================================
// RENDER
// ========================================
function renderItems(items) {
    const tbody = document.getElementById('itemsBody');
    if (!items.length) {
        tbody.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-gray-400">No items</td></tr>';
        return;
    }
    tbody.innerHTML = items.map((item, i) => {
        const name = escapeHtml(item.item_name || 'Item');
        const pack = item.pack_size ? ` <span class="text-gray-400 text-xs">(${escapeHtml(item.pack_size)})</span>` : '';
        const qty = parseFloat(item.quantity) || 0;
        const qtyDisp = Number.isInteger(qty) ? qty : qty.toFixed(2);
        const rate = parseFloat(item.unit_price) || 0;
        const total = parseFloat(item.line_total) || (qty * rate);
        return `<tr>
            <td style="color: var(--text-light); font-weight:600;">${i + 1}</td>
            <td style="font-weight:600;">${name}${pack}</td>
            <td style="text-align:right;">${qtyDisp}</td>
            <td style="text-align:right;">${formatINR(rate)}</td>
            <td style="text-align:right; font-weight:700;">${formatINR(total)}</td>
        </tr>`;
    }).join('');
}

function renderTotals(inv) {
    const subtotal = parseFloat(inv.subtotal) || 0;
    const discount = parseFloat(inv.discount_amount) || 0;
    const grand = parseFloat(inv.grand_total) || 0;
    const paid = parseFloat(inv.amount_paid) || 0;
    const balance = parseFloat(inv.balance_due) || 0;

    document.getElementById('subtotalVal').textContent = formatINR(subtotal);
    if (discount > 0) {
        document.getElementById('discountVal').textContent = '-' + formatINR(discount);
        document.getElementById('discountRow').classList.remove('hidden');
    }
    document.getElementById('grandTotalVal').textContent = formatINR(grand);
    document.getElementById('amountPaidVal').textContent = formatINR(paid);

    if (balance > 0.009) {
        const badge = document.getElementById('balanceBadge');
        badge.textContent = 'Balance Due ' + formatINR(balance);
        badge.classList.remove('hidden');
    } else {
        document.getElementById('paidBadge').classList.remove('hidden');
    }
}

function renderPayments(payments) {
    if (!payments.length) return;
    document.getElementById('paymentsSection').classList.remove('hidden');
    document.getElementById('paymentsBody').innerHTML = payments.map(p => {
        const method = PAY_METHOD_LABELS[p.payment_method] || p.payment_method || '';
        return `<tr>
            <td>${escapeHtml(method)}</td>
            <td>${p.payment_reference ? escapeHtml(p.payment_reference) : '<span style="color:#a0aec0;">—</span>'}</td>
            <td>${formatDate(p.payment_date || p.created_at)}</td>
            <td style="text-align:right; font-weight:600;">${formatINR(p.amount)}</td>
        </tr>`;
    }).join('');
}

// Branch name (best-effort — /api/branches is permission-gated; keep the
// "Branch #N" fallback when the caller can't list branches).
async function resolveBranchName(token, branchId) {
    try {
        const res = await fetch('/api/branches', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        const data = await res.json();
        const branches = data.branches || data.data || [];
        const b = branches.find(x => Number(x.id) === Number(branchId));
        if (b && (b.branch_name || b.name)) {
            document.getElementById('biBranch').textContent = b.branch_name || b.name;
        }
    } catch { /* keep fallback */ }
}

// ========================================
// BRANDING (best-effort, mirrors estimate-print loadBranding)
// ========================================
async function loadBranding(token) {
    try {
        const res = await fetch('/api/settings/branding', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!res.ok) return;
        const settings = await res.json();
        const data = settings.data || settings;
        if (data.business_name) {
            document.getElementById('companyName').textContent = data.business_name;
        }
        if (data.business_logo) {
            document.getElementById('headerLogo').src = '/uploads/logos/' + data.business_logo;
        }
        const details = [];
        if (data.business_address) details.push(escapeHtml(data.business_address));
        const line2 = [];
        if (data.business_phone) line2.push('Phone: ' + escapeHtml(data.business_phone));
        if (data.business_email) line2.push('Email: ' + escapeHtml(data.business_email));
        if (line2.length) details.push(line2.join(' | '));
        if (data.business_gst) details.push('GST: ' + escapeHtml(data.business_gst));
        if (details.length) {
            document.getElementById('companyDetails').innerHTML = details.join('<br>');
        }
    } catch { /* keep defaults */ }
}

// ========================================
// PDF DOWNLOAD (mirrors estimate-print downloadPDF)
// ========================================
function downloadPDF() {
    const token = getToken();
    const ua = navigator.userAgent || '';
    if (ua.includes('QCManagerApp')) {
        window.location.href = `/api/billing/invoices/${invoiceId}/pdf?token=${encodeURIComponent(token)}`;
    } else {
        fetch(`/api/billing/invoices/${invoiceId}/pdf`, {
            headers: { 'Authorization': `Bearer ${token}` }
        }).then(r => {
            if (!r.ok) throw new Error('PDF generation failed');
            return r.blob();
        }).then(blob => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Invoice-${invoiceId}.pdf`;
            a.click();
            URL.revokeObjectURL(url);
        }).catch(err => {
            console.error('PDF error:', err);
            alert('Failed to download PDF. Try printing instead.');
        });
    }
}

// ========================================
// HANDLER WIRING (no inline handlers — CSP-safe)
// ========================================
document.getElementById('headerLogo').addEventListener('error', function () {
    this.style.display = 'none';
});

document.addEventListener('click', function (e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    switch (el.dataset.action) {
        case 'go-back':
            history.back();
            break;
        case 'print':
            window.print();
            break;
        case 'download-pdf':
            downloadPDF();
            break;
    }
});
