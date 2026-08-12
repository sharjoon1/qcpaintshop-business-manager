// billing-receipt.js — compact SALE RECEIPT for billing invoices (Batch B1b).
// Strict-CSP-ready: external file, no inline handlers (data-action delegation).
// Query params: ?id= (required), ?mode=pdf (Puppeteer), ?autoprint=1,
// ?thermal=1 (80mm layout; preference persisted in localStorage.qs_thermal).

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
// THERMAL MODE (80mm) — URL param wins, else persisted preference
// ========================================
let thermal = urlParams.get('thermal') !== null
    ? urlParams.get('thermal') === '1'
    : localStorage.getItem('qs_thermal') === '1';

function applyThermal() {
    document.body.classList.toggle('thermal', thermal);
    const pageRule = document.getElementById('pageRule');
    if (pageRule) {
        pageRule.textContent = thermal
            ? '@page{size:80mm auto;margin:3mm}'
            : '@page { size: A4; margin: 8mm 10mm; }';
    }
    const btn = document.getElementById('thermalToggle');
    if (btn) btn.classList.toggle('active', thermal);
}

// ========================================
// INIT
// ========================================
if (mode === 'pdf') {
    const bar = document.getElementById('actionBar');
    if (bar) bar.style.display = 'none';
    document.body.style.background = 'white';
}
applyThermal();
loadReceipt();

// ========================================
// LOAD RECEIPT
// ========================================
async function loadReceipt() {
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

        // "Zoho Invoice: <n>" line ONLY when pushed
        if (inv.zoho_invoice_number) {
            document.getElementById('zohoInvoiceNumber').textContent = inv.zoho_invoice_number;
            document.getElementById('zohoInvoiceRow').classList.remove('hidden');
        }

        // Customer
        document.getElementById('custName').textContent = inv.customer_name || '';
        document.getElementById('custPhone').textContent = inv.customer_phone ? 'Ph: ' + inv.customer_phone : '';

        renderItems(items);
        renderTotals(inv);
        renderPayments(payments);

        loadBranding(token); // best-effort

        document.getElementById('loadingState').classList.add('hidden');
        document.getElementById('receiptContent').classList.remove('hidden');

        if (autoprint) {
            // Give fonts/layout a beat to settle before the print dialog.
            setTimeout(() => window.print(), 350);
        }
    } catch (error) {
        console.error('Error loading receipt:', error);
        document.getElementById('loadingState').innerHTML = `
            <div class="text-center">
                <div class="text-red-500 text-lg font-bold">Failed to load receipt</div>
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
        tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; color:#718096; padding:12px;">No items</td></tr>';
        return;
    }
    tbody.innerHTML = items.map(item => {
        const name = escapeHtml(item.item_name || 'Item');
        const pack = item.pack_size ? ` <span style="color:#718096; font-size:0.85em;">(${escapeHtml(item.pack_size)})</span>` : '';
        const qty = parseFloat(item.quantity) || 0;
        const qtyDisp = Number.isInteger(qty) ? qty : qty.toFixed(2);
        const rate = parseFloat(item.unit_price) || 0;
        const total = parseFloat(item.line_total) || (qty * rate);
        return `<tr>
            <td>${name}${pack}</td>
            <td class="num">${qtyDisp} &times; ${formatINR(rate)}</td>
            <td class="num" style="font-weight:600;">${formatINR(total)}</td>
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

    // Balance-due badge for credit / partial sales; PAID badge otherwise.
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
    document.getElementById('paymentsList').innerHTML = payments.map(p => {
        const method = PAY_METHOD_LABELS[p.payment_method] || p.payment_method || '';
        const ref = p.payment_reference ? ` #${escapeHtml(p.payment_reference)}` : '';
        const date = formatDate(p.payment_date || p.created_at);
        return `<div class="pay-row">
            <span>${escapeHtml(method)}${ref}<span style="color:#718096;"> &middot; ${date}</span></span>
            <span style="font-weight:600;">${formatINR(p.amount)}</span>
        </div>`;
    }).join('');
}

// ========================================
// BRANDING (best-effort, mirrors payment-receipt.js)
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
        const details = [];
        const line1 = [];
        if (data.business_address) line1.push(escapeHtml(data.business_address));
        if (data.business_phone) line1.push('Phone: ' + escapeHtml(data.business_phone));
        if (line1.length) details.push(line1.join(' &middot; '));
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
        window.location.href = `/api/billing/invoices/${invoiceId}/pdf?receipt=1&token=${encodeURIComponent(token)}`;
    } else {
        fetch(`/api/billing/invoices/${invoiceId}/pdf?receipt=1`, {
            headers: { 'Authorization': `Bearer ${token}` }
        }).then(r => {
            if (!r.ok) throw new Error('PDF generation failed');
            return r.blob();
        }).then(blob => {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `Receipt-${invoiceId}.pdf`;
            a.click();
            URL.revokeObjectURL(url);
        }).catch(err => {
            console.error('PDF error:', err);
            alert('Failed to download PDF. Try printing instead.');
        });
    }
}

// ========================================
// ACTION DELEGATION (no inline handlers — CSP-safe)
// ========================================
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
        case 'toggle-thermal':
            thermal = !thermal;
            localStorage.setItem('qs_thermal', thermal ? '1' : '0');
            applyThermal();
            break;
    }
});
