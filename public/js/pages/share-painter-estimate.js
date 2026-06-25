// Painter share estimate view — externalized from /share/painter-estimate.html (S9+F5 strict CSP).
// SYNC (non-deferred), loaded at end of <body> so it runs after the DOM is parsed,
// matching the original end-of-body inline <script> timing.
function esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

async function loadEstimate() {
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    const token = pathParts[pathParts.length - 1];
    if (!token) {
        document.getElementById('content').innerHTML = '<div class="error">Invalid link</div>';
        return;
    }

    try {
        const res = await fetch(`/api/painters/estimates/share/${token}`);
        const data = await res.json();

        if (!data.success) {
            document.getElementById('content').innerHTML = `<div class="error">${esc(data.message || 'Estimate not found or link expired')}</div>`;
            return;
        }

        const est = data.estimate;
        const items = data.items;

        let itemsHtml = items.map(i => `
            <tr>
                <td>${esc(i.item_name)}</td>
                <td class="text-xs" style="color:#64748b">${esc(i.brand || '')}</td>
                <td class="text-right">${i.quantity}</td>
                <td class="text-right">₹${(i.unit_price || 0).toLocaleString('en-IN')}</td>
                <td class="text-right" style="font-weight:500">₹${(i.line_total || 0).toLocaleString('en-IN')}</td>
            </tr>
        `).join('');

        document.getElementById('content').innerHTML = `
            <div class="card">
                <div class="card-header">Estimate Details</div>
                <div class="card-body">
                    <div class="info-row"><span class="info-label">Estimate #</span><span class="info-value">${esc(est.estimate_number)}</span></div>
                    <div class="info-row"><span class="info-label">Date</span><span class="info-value">${new Date(est.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</span></div>
                    ${est.customer_name ? `<div class="info-row"><span class="info-label">Customer</span><span class="info-value">${esc(est.customer_name)}</span></div>` : ''}
                    <div class="info-row"><span class="info-label">Prepared By</span><span class="info-value">${esc(est.painter_name)}</span></div>
                </div>
            </div>

            <div class="card">
                <div class="card-header">Items</div>
                <div style="overflow-x:auto">
                    <table>
                        <thead><tr><th>Product</th><th>Brand</th><th class="text-right">Qty</th><th class="text-right">Rate</th><th class="text-right">Amount</th></tr></thead>
                        <tbody>${itemsHtml}</tbody>
                    </table>
                </div>
                <div class="totals">
                    <div class="total-row grand"><span>Total</span><span>₹${(est.grand_total || 0).toLocaleString('en-IN')}</span></div>
                    <div style="text-align:right;font-size:0.7rem;color:#94a3b8;margin-top:2px">* Prices inclusive of GST</div>
                </div>
            </div>

            <button class="print-btn" data-action="print">
                <svg style="display:inline;vertical-align:middle;margin-right:6px" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
                Print Estimate
            </button>
        `;
    } catch (err) {
        document.getElementById('content').innerHTML = '<div class="error">Failed to load estimate. Please try again.</div>';
    }
}

// Delegated click dispatcher for runtime-injected handlers (header-v2 notification pattern).
document.addEventListener('click', function (e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (action === 'print') {
        window.print();
    }
});

loadEstimate();
