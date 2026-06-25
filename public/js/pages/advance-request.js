// Page logic for staff/advance-request.html. Externalized verbatim from the page's end-of-body
// inline <script> (S9+F5 Phase C, 2026-06-25) so the page runs under the enforced strict CSP.
// Loaded as a NON-deferred classic script right before </body>, matching the original timing.
// Handler wiring appended at the bottom (was an inline onsubmit attribute in the HTML).
function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

function showToast(message, type = 'success') {
    const container = document.getElementById('toastContainer');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function formatCurrency(amount) {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(amount || 0);
}

function statusBadge(status) {
    return `<span class="badge badge-${status}">${status.charAt(0).toUpperCase() + status.slice(1)}</span>`;
}

async function loadHistory() {
    try {
        const res = await fetch('/api/salary/my-advances', { headers: getAuthHeaders() });
        const data = await res.json();
        document.getElementById('historyLoader').style.display = 'none';

        if (data.success && data.data && data.data.length > 0) {
            // Check for pending request
            const hasPending = data.data.some(a => a.status === 'pending');
            if (hasPending) {
                document.getElementById('advanceForm').style.display = 'none';
                document.getElementById('pendingWarning').style.display = 'block';
            }

            document.getElementById('historyContent').style.display = 'block';
            document.getElementById('historyContent').innerHTML = data.data.map(a => `
                <div style="padding: 14px 0; border-bottom: 1px solid #f3f4f6;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
                        <span style="font-size: 18px; font-weight: 700; color: #1f2937;">${formatCurrency(a.amount)}</span>
                        ${statusBadge(a.status)}
                    </div>
                    ${a.reason ? `<div style="font-size: 13px; color: #6b7280; margin-bottom: 4px;">${esc(a.reason)}</div>` : ''}
                    <div style="font-size: 12px; color: #9ca3af;">${new Date(a.created_at).toLocaleDateString()}</div>
                    ${a.rejection_reason ? `<div style="margin-top: 6px; font-size: 13px; color: #991b1b; background: #fee2e2; padding: 8px; border-radius: 8px;">Reason: ${esc(a.rejection_reason)}</div>` : ''}
                    ${a.payment_date ? `<div style="margin-top: 4px; font-size: 12px; color: #065f46;">Paid on ${new Date(a.payment_date).toLocaleDateString()}</div>` : ''}
                </div>
            `).join('');
        } else {
            document.getElementById('noHistory').style.display = 'block';
        }
    } catch (e) {
        console.error('Load history error:', e);
        document.getElementById('historyLoader').style.display = 'none';
        document.getElementById('noHistory').style.display = 'block';
    }
}

async function submitRequest(e) {
    e.preventDefault();
    const amount = document.getElementById('amount').value;
    const reason = document.getElementById('reason').value.trim();
    const btn = document.getElementById('submitBtn');

    if (!amount || parseFloat(amount) <= 0) {
        showToast('Please enter a valid amount', 'error');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Submitting...';

    try {
        const res = await fetch('/api/salary/my-advance-request', {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ amount: parseFloat(amount), reason })
        });
        const data = await res.json();

        if (data.success) {
            showToast('Advance request submitted successfully!');
            document.getElementById('amount').value = '';
            document.getElementById('reason').value = '';
            loadHistory();
        } else {
            showToast(data.message || 'Failed to submit request', 'error');
        }
    } catch (e) {
        showToast('Network error. Please try again.', 'error');
    }

    btn.disabled = false;
    btn.textContent = 'Submit Request';
}

loadHistory();

// --- Handler wiring (S9+F5: replaces the inline onsubmit="submitRequest(event)" on #advanceForm) ---
const advanceForm = document.getElementById('advanceForm');
if (advanceForm) advanceForm.addEventListener('submit', submitRequest);
