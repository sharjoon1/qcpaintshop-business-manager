// Page logic for staff/permission-request.html. Externalized verbatim from the page's end-of-body
// inline <script> (S9+F5 Phase E batch 11, 2026-06-25) so the page runs under the enforced strict
// CSP. Loaded as a NON-deferred classic script right before </body>, matching the original timing.
// Handler wiring appended at the bottom (was inline on*= attributes in the HTML).
function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

let requests = [];
let currentTab = 'new';

// Initialize
async function init() {
    // Set today's date as default
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('requestDate').value = today;
}

// Leave balance tracking
let leaveBalance = null;

async function loadLeaveBalance() {
    try {
        const token = localStorage.getItem('auth_token');
        const res = await fetch('/api/attendance/leave-balance', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (data.success) {
            leaveBalance = data.data;
            updateLeaveBalanceDisplay();
        }
    } catch (e) {
        console.error('Error loading leave balance:', e);
    }
}

function updateLeaveBalanceDisplay() {
    if (!leaveBalance) return;
    const lb = leaveBalance;
    document.getElementById('lbSunday').textContent = `${lb.sunday.used}/${lb.sunday.free} used`;
    document.getElementById('lbSunday').style.color = lb.sunday.remaining > 0 ? '#10b981' : '#ef4444';
    document.getElementById('lbWeekday').textContent = `${lb.weekday.used}/${lb.weekday.free} used`;
    document.getElementById('lbWeekday').style.color = lb.weekday.remaining > 0 ? '#10b981' : '#ef4444';
    checkLeaveWarning();
}

function checkLeaveWarning() {
    if (!leaveBalance) return;
    const requestDate = document.getElementById('requestDate').value;
    if (!requestDate) return;

    const dayOfWeek = new Date(requestDate).getDay(); // 0 = Sunday
    const isSunday = dayOfWeek === 0;
    const warning = document.getElementById('lbWarning');

    if (isSunday && leaveBalance.sunday.remaining <= 0) {
        warning.style.display = 'block';
        warning.textContent = '⚠️ Sunday paid leave used. This leave will be deducted from your salary.';
    } else if (!isSunday && leaveBalance.weekday.remaining <= 0) {
        warning.style.display = 'block';
        warning.textContent = '⚠️ Weekday paid leave used. This leave will be deducted from your salary.';
    } else {
        warning.style.display = 'none';
    }
}

// Show/hide leave balance when request type changes
document.getElementById('requestType').addEventListener('change', function() {
    const leaveInfo = document.getElementById('leaveBalanceInfo');
    if (this.value === 'leave') {
        leaveInfo.style.display = 'block';
        if (!leaveBalance) loadLeaveBalance();
        else updateLeaveBalanceDisplay();
    } else {
        leaveInfo.style.display = 'none';
    }
});

// Re-check warning when date changes
document.getElementById('requestDate').addEventListener('change', function() {
    if (document.getElementById('requestType').value === 'leave') {
        checkLeaveWarning();
    }
});

// Prefetch leave balance
loadLeaveBalance();

// Switch tabs
function switchTab(tab) {
    currentTab = tab;

    if (tab === 'new') {
        document.getElementById('newRequestTab').classList.add('active');
        document.getElementById('myRequestsTab').classList.remove('active');
        document.getElementById('newRequestCard').style.display = 'block';
        document.getElementById('myRequestsCard').style.display = 'none';
    } else {
        document.getElementById('newRequestTab').classList.remove('active');
        document.getElementById('myRequestsTab').classList.add('active');
        document.getElementById('newRequestCard').style.display = 'none';
        document.getElementById('myRequestsCard').style.display = 'block';
        loadMyRequests();
    }
}

// Submit request
async function submitRequest(e) {
    e.preventDefault();

    const submitBtn = document.getElementById('submitBtn');
    const submitBtnText = document.getElementById('submitBtnText');
    submitBtn.disabled = true;
    submitBtnText.textContent = 'Submitting...';

    try {
        const token = localStorage.getItem('auth_token');
        if (!token) {
            window.location.href = '/login.html';
            return;
        }

        const requestData = {
            request_type: document.getElementById('requestType').value,
            request_date: document.getElementById('requestDate').value,
            request_time: document.getElementById('requestTime').value || null,
            duration_minutes: parseInt(document.getElementById('duration').value) || null,
            reason: document.getElementById('reason').value
        };

        const response = await fetch('/api/attendance/permission/request', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestData)
        });

        const data = await response.json();

        if (data.success) {
            // Show success message
            document.getElementById('successMessage').style.display = 'block';
            document.getElementById('requestForm').style.display = 'none';

            // Reset after 3 seconds
            setTimeout(() => {
                document.getElementById('successMessage').style.display = 'none';
                document.getElementById('requestForm').style.display = 'block';
                document.getElementById('requestForm').reset();
                document.getElementById('requestDate').value = new Date().toISOString().split('T')[0];

                submitBtn.disabled = false;
                submitBtnText.textContent = 'Submit Request';
            }, 3000);

        } else {
            alert(data.message || 'Failed to submit request');
            submitBtn.disabled = false;
            submitBtnText.textContent = 'Submit Request';
        }

    } catch (error) {
        console.error('Submit error:', error);
        alert('Network error. Please try again.');
        submitBtn.disabled = false;
        submitBtnText.textContent = 'Submit Request';
    }
}

// Load my requests
async function loadMyRequests() {
    try {
        const token = localStorage.getItem('auth_token');
        if (!token) {
            window.location.href = '/login.html';
            return;
        }

        document.getElementById('requestsLoading').style.display = 'block';
        document.getElementById('requestsEmpty').style.display = 'none';

        const response = await fetch('/api/attendance/permission/my-requests?limit=50', {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        const data = await response.json();
        requests = data.data || [];

        document.getElementById('requestsLoading').style.display = 'none';

        if (requests.length === 0) {
            document.getElementById('requestsEmpty').style.display = 'block';
            document.getElementById('requestsList').innerHTML = '';
        } else {
            document.getElementById('requestsEmpty').style.display = 'none';
            displayRequests();
        }

    } catch (error) {
        console.error('Load requests error:', error);
        document.getElementById('requestsLoading').innerHTML = `
            <div class="empty-state">
                <div style="font-size: 48px; margin-bottom: 16px;">❌</div>
                <p style="color: #ef4444; font-weight: 600; margin-bottom: 16px;">Failed to load requests</p>
                <button data-action="load-my-requests" style="padding: 12px 24px; background: #1B5E3B; color: white; border: none; border-radius: 8px; font-weight: 600; cursor: pointer;">
                    Retry
                </button>
            </div>
        `;
    }
}

// Display requests
function displayRequests() {
    const listHtml = requests.map(req => {
        const date = new Date(req.request_date);
        const dateStr = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

        const requestedAt = new Date(req.requested_at);
        const requestedStr = requestedAt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

        let statusBadge = '';
        let statusClass = req.status;

        if (req.status === 'pending') {
            statusBadge = '<span class="badge badge-pending">⏳ Pending</span>';
        } else if (req.status === 'approved') {
            statusBadge = '<span class="badge badge-approved">✓ Approved</span>';
        } else if (req.status === 'rejected') {
            statusBadge = '<span class="badge badge-rejected">✗ Rejected</span>';
        }

        const typeLabels = {
            'late_arrival': 'Late Arrival',
            'early_checkout': 'Early Checkout',
            'early_leave': 'Early Leave',
            'extended_break': 'Extended Break',
            'leave': 'Leave',
            'half_day': 'Half Day',
            're_clockin': 'Re Clock-In',
            'outside_work': 'Outside Work'
        };

        let reviewSection = '';
        if (req.status !== 'pending') {
            const reviewedAt = new Date(req.reviewed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
            reviewSection = `
                <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e5e7eb;">
                    <div style="font-size: 11px; color: #6b7280; margin-bottom: 4px;">
                        Reviewed by ${req.reviewed_by_name || 'Admin'} on ${reviewedAt}
                    </div>
                    ${req.review_notes ? `<div style="font-size: 13px; color: #1f2937; font-style: italic;">"${esc(req.review_notes)}"</div>` : ''}
                </div>
            `;
        }

        return `
            <div class="request-item ${statusClass}">
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
                    <div>
                        <div style="font-size: 16px; font-weight: 700; color: #1f2937;">${typeLabels[req.request_type] || req.request_type}</div>
                        <div style="font-size: 12px; color: #6b7280; margin-top: 4px;">For ${dateStr}</div>
                    </div>
                    ${statusBadge}
                </div>

                ${req.duration_minutes ? `
                    <div style="font-size: 13px; color: #6b7280; margin-bottom: 8px;">
                        Duration: <strong>${req.duration_minutes} minutes</strong>
                    </div>
                ` : ''}

                <div style="background: white; padding: 12px; border-radius: 8px; margin-bottom: 8px;">
                    <div style="font-size: 12px; color: #6b7280; margin-bottom: 4px;">Reason:</div>
                    <div style="font-size: 13px; color: #1f2937;">${esc(req.reason)}</div>
                </div>

                <div style="font-size: 11px; color: #9ca3af;">
                    Requested on ${requestedStr}
                </div>

                ${reviewSection}
            </div>
        `;
    }).join('');

    document.getElementById('requestsList').innerHTML = `
        <div class="card">
            <h3 style="font-size: 16px; font-weight: 600; margin-bottom: 16px; color: #1f2937;">
                All Requests (${requests.length})
            </h3>
            ${listHtml}
        </div>
    `;
}

// Go back
function goBack() {
    window.location.href = 'dashboard.html';
}

// ── Static handler wiring (externalized from inline on*= attributes; S9+F5 Phase E batch 11, 2026-06-25) ──
// Back button (was onclick="goBack()")
document.getElementById('backBtn').addEventListener('click', goBack);
// New Request tab (was onclick="switchTab('new')")
document.getElementById('newRequestTab').addEventListener('click', () => switchTab('new'));
// My Requests tab (was onclick="switchTab('my')")
document.getElementById('myRequestsTab').addEventListener('click', () => switchTab('my'));
// Request form submit (was onsubmit="submitRequest(event)")
document.getElementById('requestForm').addEventListener('submit', submitRequest);

// Delegated dispatcher for runtime-rendered buttons (replaces inline
// onclick="loadMyRequests()" on the error-state Retry button). One document-level listener
// routes by data-action.
document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    if (!action) return;
    if (action === 'load-my-requests') {
        loadMyRequests();
    }
});

// Init on load
init();
