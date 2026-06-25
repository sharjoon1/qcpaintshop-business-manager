// Page logic externalized from estimate-actions.html inline <script> (S9+F5 Phase E batch 11, 2026-06-25)
// so the page runs under the enforced strict CSP. Verbatim move of all functions; inline on*=
// handlers converted to addEventListener + data-action delegation. No logic changes, no renames,
// escaping helpers untouched.
function esc(s){if(s==null)return '';const d=document.createElement('div');d.textContent=String(s);return d.innerHTML;}
const urlParams = new URLSearchParams(window.location.search);
const estimateId = urlParams.get('id');
let currentNewStatus = '';

// Mobile menu
document.getElementById('mobileMenuBtn')?.addEventListener('click', () => {
    document.getElementById('sidebar')?.classList.toggle('-translate-x-full');
});

function logout() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
    window.location.href = '/login.html';
}

// Load estimate info
async function loadEstimate() {
    try {
        const response = await apiRequest(`/api/estimates/${estimateId}`);
        const data = await response.json();

        document.getElementById('estimateTitle').textContent = `Estimate #${data.estimate_number}`;
        document.getElementById('customerName').textContent = data.customer_name;
        document.getElementById('currentStatus').innerHTML = getStatusBadge(data.status);

        // Hide buttons based on current status
        if (data.status === 'approved') {
            document.getElementById('btnApprove').classList.add('hidden');
        } else if (data.status === 'rejected') {
            document.getElementById('btnReject').classList.add('hidden');
        }

        loadHistory();
    } catch (error) {
        console.error('Error loading estimate:', error);
    }
}

// Load status history
async function loadHistory() {
    try {
        const response = await apiRequest(`/api/estimates/${estimateId}/history`);
        const history = await response.json();

        const container = document.getElementById('historyContainer');

        if (history.length === 0) {
            container.innerHTML = '<div class="text-center py-8 text-gray-500">No status changes yet</div>';
            return;
        }

        container.innerHTML = history.map(h => `
            <div class="flex items-start border-l-4 ${getStatusColor(h.new_status)} pl-4 py-2">
                <div class="flex-1">
                    <div class="flex items-center gap-2 mb-1">
                        ${getStatusBadge(h.new_status)}
                        ${h.old_status ? `<span class="text-sm text-gray-500">from ${esc(h.old_status)}</span>` : ''}
                    </div>
                    ${h.reason ? `<p class="text-sm text-gray-700 mb-1"><strong>Reason:</strong> ${esc(h.reason)}</p>` : ''}
                    ${h.notes ? `<p class="text-sm text-gray-600 mb-1">${esc(h.notes)}</p>` : ''}
                    <p class="text-xs text-gray-500">
                        By ${esc(h.changed_by_name) || 'System'} • ${formatDate(h.timestamp)}
                    </p>
                </div>
            </div>
        `).join('');

    } catch (error) {
        console.error('Error loading history:', error);
    }
}

function getStatusBadge(status) {
    const badges = {
        'draft': '<span class="px-3 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-800">🆕 Draft</span>',
        'sent': '<span class="px-3 py-1 text-xs font-semibold rounded-full bg-blue-100 text-blue-800">📧 Sent</span>',
        'pending_approval': '<span class="px-3 py-1 text-xs font-semibold rounded-full bg-yellow-100 text-yellow-800">⏳ Pending</span>',
        'approved': '<span class="px-3 py-1 text-xs font-semibold rounded-full bg-green-100 text-green-800">✅ Approved</span>',
        'rejected': '<span class="px-3 py-1 text-xs font-semibold rounded-full bg-red-100 text-red-800">❌ Rejected</span>',
        'converted': '<span class="px-3 py-1 text-xs font-semibold rounded-full bg-purple-100 text-purple-800">📄 Converted</span>',
        'expired': '<span class="px-3 py-1 text-xs font-semibold rounded-full bg-orange-100 text-orange-800">⌛ Expired</span>'
    };
    return badges[status] || badges['draft'];
}

function getStatusColor(status) {
    const colors = {
        'approved': 'border-green-500',
        'rejected': 'border-red-500',
        'sent': 'border-blue-500',
        'pending_approval': 'border-yellow-500',
        'converted': 'border-purple-500',
        'draft': 'border-gray-500',
        'expired': 'border-orange-500'
    };
    return colors[status] || 'border-gray-500';
}

function formatDate(dateString) {
    const date = new Date(dateString);
    return date.toLocaleString('en-IN');
}

// Change status
function changeStatus(newStatus) {
    currentNewStatus = newStatus;
    const titles = {
        'approved': 'Approve Estimate',
        'rejected': 'Reject Estimate',
        'sent': 'Mark as Sent',
        'pending_approval': 'Mark as Pending Approval'
    };
    document.getElementById('modalTitle').textContent = titles[newStatus] || 'Change Status';
    document.getElementById('statusModal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('statusModal').classList.add('hidden');
    document.getElementById('statusReason').value = '';
    document.getElementById('statusNotes').value = '';
}

async function confirmStatusChange() {
    const reason = document.getElementById('statusReason').value;
    const notes = document.getElementById('statusNotes').value;

    try {
        const response = await apiRequest(`/api/estimates/${estimateId}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status: currentNewStatus, reason, notes })
        });

        if (response.ok) {
            closeModal();
            loadEstimate();
            alert('Status updated successfully!');
        } else {
            alert('Failed to update status');
        }
    } catch (error) {
        console.error('Error updating status:', error);
        alert('Error updating status');
    }
}

// Other actions
function convertToInvoice() {
    // Not wired yet — show an honest message instead of a confirm() that does nothing.
    alert('Convert to Invoice is coming soon.');
}

function downloadPDF() {
    window.open(`estimate-view.html?id=${estimateId}`, '_blank');
    setTimeout(() => window.print(), 500);
}

function duplicate() {
    alert('Duplicate is coming in a future update.');
}

// ── Static handler wiring (externalized from inline on*= attributes; S9+F5 Phase E batch 11, 2026-06-25) ──
// Back button (was onclick="history.back()")
document.getElementById('backBtn').addEventListener('click', () => history.back());
// Approve (was onclick="changeStatus('approved')")
document.getElementById('btnApprove').addEventListener('click', () => changeStatus('approved'));
// Reject (was onclick="changeStatus('rejected')")
document.getElementById('btnReject').addEventListener('click', () => changeStatus('rejected'));
// Mark as Sent (was onclick="changeStatus('sent')")
document.getElementById('btnSent').addEventListener('click', () => changeStatus('sent'));
// Convert to Invoice (was onclick="convertToInvoice()")
document.getElementById('btnConvert').addEventListener('click', convertToInvoice);
// Download PDF (was onclick="downloadPDF()")
document.getElementById('btnDownload').addEventListener('click', downloadPDF);
// Duplicate (was onclick="duplicate()")
document.getElementById('btnDuplicate').addEventListener('click', duplicate);
// Modal Cancel (was onclick="closeModal()")
document.getElementById('modalCancelBtn').addEventListener('click', closeModal);
// Modal Confirm (was onclick="confirmStatusChange()")
document.getElementById('confirmBtn').addEventListener('click', confirmStatusChange);

// Load on page load
if (!estimateId) {
    alert('No estimate ID');
    window.location.href = 'estimates.html';
} else {
    loadEstimate();
}
