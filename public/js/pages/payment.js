// Public payment-link page. Externalized from the page inline <script>
// (S9+F5 Phase C, 2026-06-13) so the page runs under the enforced strict CSP.
const params = new URLSearchParams(window.location.search);
const linkId = params.get('order');

async function init() {
    if (params.get('status') === 'paid') {
        document.getElementById('success').style.display = 'block';
        return;
    }

    if (!linkId) { showError('No payment order specified in this link.'); return; }

    document.getElementById('loader').style.display = 'block';
    try {
        const res = await fetch(`/api/zoho/collections/pay-order/${encodeURIComponent(linkId)}`);
        const data = await res.json();
        document.getElementById('loader').style.display = 'none';

        if (!data.success) { showError(data.error || 'This payment link is invalid or has expired.'); return; }

        document.getElementById('inv-number').textContent = data.order.zoho_invoice_number || '—';
        document.getElementById('inv-customer').textContent = data.order.customer_name || '—';
        document.getElementById('inv-amount').textContent = '₹' + parseFloat(data.order.amount).toLocaleString('en-IN', { minimumFractionDigits: 2 });
        document.getElementById('payBtn').href = data.order.zoho_payment_link_url || '#';
        document.getElementById('content').style.display = 'block';
    } catch (e) {
        document.getElementById('loader').style.display = 'none';
        showError('Failed to load payment details. Please try again.');
    }
}

function showError(msg) {
    document.getElementById('error-msg').textContent = msg;
    document.getElementById('error').style.display = 'block';
}

init();
