const API_BASE = '/api/zoho/whatsapp-sessions';
let sessionsData = [];
let generalData = null;

// ========================================
// LOAD SESSIONS
// ========================================

async function loadSessions() {
    try {
        const resp = await apiRequest(`${API_BASE}/`);
        if (!resp) return;
        const data = await resp.json();
        if (!data.success) throw new Error(data.message);

        sessionsData = data.data;
        generalData = data.general || null;
        renderGeneralCard();
        renderCards();
    } catch (err) {
        console.error('Load sessions error:', err);
        showToast('Failed to load sessions', 'error');
    }
}

function renderGeneralCard() {
    const container = document.getElementById('generalSection');
    if (!generalData) {
        generalData = { branch_id: 0, branch_name: 'General WhatsApp', status: 'disconnected' };
    }

    const g = generalData;
    const status = g.status || 'disconnected';
    const statusLabel = {
        connected: 'Connected',
        qr_pending: 'Scan QR Code',
        connecting: 'Connecting...',
        disconnected: 'Disconnected',
        failed: 'Failed'
    }[status] || 'Unknown';

    const connectedInfo = status === 'connected' && g.phone_number
        ? `<div class="text-sm text-green-700 font-medium mt-1">+${g.phone_number}</div>
           ${g.connected_at ? `<div class="text-xs text-gray-400 mt-0.5">Connected since ${formatDate(g.connected_at)}</div>` : ''}`
        : '';

    const errorInfo = status === 'failed' && g.last_error
        ? `<div class="text-xs text-red-500 mt-1 truncate" title="${escHtml(g.last_error)}">${escHtml(g.last_error.substring(0, 80))}</div>`
        : '';

    const buttons = status === 'connected'
        ? `<div class="flex gap-2 mt-3">
               <button data-action="open-test-modal" data-id="0" class="btn-test flex-1">Test Message</button>
               <button data-action="disconnect-branch" data-id="0" class="btn-disconnect flex-1">Disconnect</button>
           </div>`
        : status === 'connecting' || status === 'qr_pending'
        ? `<button data-action="disconnect-branch" data-id="0" class="btn-disconnect w-full mt-3">Cancel</button>`
        : `<button data-action="connect-branch" data-id="0" class="btn-connect w-full mt-3">Connect General WhatsApp</button>`;

    container.innerHTML = `
        <div class="general-card" id="card-0">
            <div class="status-bar ${status}"></div>
            <div class="flex items-center gap-3 mb-2">
                <span class="status-dot ${status}"></span>
                <div class="flex-1">
                    <div class="font-semibold text-gray-800 flex items-center gap-2">
                        General WhatsApp
                        <span class="general-badge">Company-wide</span>
                    </div>
                    <div class="text-xs text-gray-500">${statusLabel}</div>
                </div>
            </div>
            ${connectedInfo}
            ${errorInfo}
            <div class="qr-container" id="qr-0" style="display:${status === 'qr_pending' || g.has_qr ? 'flex' : 'none'}">
                <div class="text-center text-gray-400 text-xs">
                    ${status === 'qr_pending' ? '<div class="spinner w-6 h-6 border-2 border-indigo-300 border-t-indigo-600 rounded-full mx-auto mb-2"></div>Loading QR...' : ''}
                </div>
            </div>
            ${buttons}
            <div class="text-xs text-gray-400 mt-3 border-t border-gray-200 pt-2">
                Used as fallback when a branch has no connection. Messages sent via General appear in chat history under "General" label.
            </div>
        </div>
    `;

    // Load QR if pending
    if (g.has_qr || status === 'qr_pending') {
        fetchQR(0);
    }
}

function isHeadOfficeBranch(branch) {
    return (branch.branch_name && branch.branch_name.toLowerCase().includes('head')) ||
           branch.branch_id === 1;
}

function renderCards() {
    const grid = document.getElementById('sessionsGrid');
    document.getElementById('branchesLabel').style.display = sessionsData.length > 0 ? '' : 'none';
    if (sessionsData.length === 0) {
        grid.innerHTML = '<div class="text-center py-12 text-gray-400 col-span-full">No branches found.</div>';
        return;
    }

    grid.innerHTML = sessionsData.map(s => {
        const status = s.status || 'disconnected';
        const statusLabel = {
            connected: 'Connected',
            qr_pending: 'Scan QR Code',
            connecting: 'Connecting...',
            disconnected: 'Disconnected',
            failed: 'Failed'
        }[status] || 'Unknown';

        const connectedInfo = status === 'connected' && s.phone_number
            ? `<div class="text-sm text-green-700 font-medium mt-1">+${s.phone_number}</div>
               ${s.connected_at ? `<div class="text-xs text-gray-400 mt-0.5">Connected since ${formatDate(s.connected_at)}</div>` : ''}`
            : '';

        const errorInfo = status === 'failed' && s.last_error
            ? `<div class="text-xs text-red-500 mt-1 truncate" title="${escHtml(s.last_error)}">${escHtml(s.last_error.substring(0, 80))}</div>`
            : '';

        const buttons = status === 'connected'
            ? `<div class="flex gap-2 mt-3">
                   <button data-action="open-test-modal" data-id="${s.branch_id}" class="btn-test flex-1">Test Message</button>
                   <button data-action="disconnect-branch" data-id="${s.branch_id}" class="btn-disconnect flex-1">Disconnect</button>
               </div>`
            : status === 'connecting' || status === 'qr_pending'
            ? `<button data-action="disconnect-branch" data-id="${s.branch_id}" class="btn-disconnect w-full mt-3">Cancel</button>`
            : `<button data-action="connect-branch" data-id="${s.branch_id}" class="btn-connect w-full mt-3">Connect WhatsApp</button>`;

        return `
            <div class="branch-card" id="card-${s.branch_id}">
                <div class="status-bar ${status}"></div>
                <div class="flex items-center gap-3 mb-2">
                    <span class="status-dot ${status}"></span>
                    <div class="flex-1">
                        <div class="font-semibold text-gray-800">${escHtml(s.branch_name)}</div>
                        <div class="text-xs text-gray-400">${statusLabel}</div>
                    </div>
                </div>
                ${connectedInfo}
                ${errorInfo}
                <div class="qr-container" id="qr-${s.branch_id}" style="display:${status === 'qr_pending' || s.has_qr ? 'flex' : 'none'}">
                    <div class="text-center text-gray-400 text-xs">
                        ${status === 'qr_pending' ? '<div class="spinner w-6 h-6 border-2 border-indigo-300 border-t-indigo-600 rounded-full mx-auto mb-2"></div>Loading QR...' : ''}
                    </div>
                </div>
                ${buttons}
                ${isHeadOfficeBranch(s) ? `
                <div style="margin-top:10px; padding:8px 10px; background:#f0fdf4; border-radius:8px; font-size:11px; color:#166534; border:1px solid #bbf7d0;">
                    <strong>Head Office:</strong> You can also connect the
                    <a href="#" data-action="scroll-to-general"
                       style="color:#16a34a; text-decoration:underline;">General WhatsApp</a>
                    for company-wide message routing.
                </div>` : ''}
            </div>
        `;
    }).join('');

    // Load QR codes for pending sessions
    sessionsData.filter(s => s.has_qr || s.status === 'qr_pending').forEach(s => {
        fetchQR(s.branch_id);
    });
}

// ========================================
// CONNECT / DISCONNECT
// ========================================

async function connectBranch(branchId) {
    try {
        const resp = await apiRequest(`${API_BASE}/${branchId}/connect`, { method: 'POST' });
        if (!resp) return;
        const data = await resp.json();
        showToast(data.message || 'Connecting...', data.success ? 'success' : 'error');
        if (data.success) {
            // Update local state
            const s = sessionsData.find(x => x.branch_id === branchId);
            if (s) { s.status = 'connecting'; renderCards(); }
        }
    } catch (err) {
        showToast('Connection failed: ' + err.message, 'error');
    }
}

async function disconnectBranch(branchId) {
    if (!confirm('Disconnect this branch\'s WhatsApp session?')) return;
    try {
        const resp = await apiRequest(`${API_BASE}/${branchId}/disconnect`, { method: 'POST' });
        if (!resp) return;
        const data = await resp.json();
        showToast(data.message || 'Disconnected', data.success ? 'success' : 'error');
        loadSessions();
    } catch (err) {
        showToast('Disconnect failed: ' + err.message, 'error');
    }
}

// ========================================
// QR CODE
// ========================================

async function fetchQR(branchId) {
    try {
        const resp = await apiRequest(`${API_BASE}/${branchId}/qr`);
        if (!resp) return;
        const data = await resp.json();
        if (data.success && data.data.qr) {
            renderQR(branchId, data.data.qr);
        }
    } catch (err) {
        console.error('Fetch QR error:', err);
    }
}

function renderQR(branchId, qrData) {
    const container = document.getElementById(`qr-${branchId}`);
    if (!container) return;

    container.style.display = 'flex';
    container.innerHTML = '';

    try {
        // Use qrcode-generator library
        const qr = qrcode(0, 'M');
        qr.addData(qrData);
        qr.make();

        const canvas = document.createElement('canvas');
        const size = 220;
        const cellSize = size / qr.getModuleCount();
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext('2d');

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size, size);

        ctx.fillStyle = '#000000';
        for (let row = 0; row < qr.getModuleCount(); row++) {
            for (let col = 0; col < qr.getModuleCount(); col++) {
                if (qr.isDark(row, col)) {
                    ctx.fillRect(col * cellSize, row * cellSize, cellSize + 0.5, cellSize + 0.5);
                }
            }
        }

        container.appendChild(canvas);
    } catch (err) {
        container.innerHTML = `<div class="text-xs text-red-500">Failed to render QR: ${escHtml(err.message)}</div>`;
    }
}

// ========================================
// SOCKET.IO REAL-TIME
// ========================================

function setupSocketListeners() {
    const socket = getSocket();
    if (!socket) {
        setTimeout(setupSocketListeners, 2000);
        return;
    }

    // Join admin room
    socket.emit('join_whatsapp_admin');

    socket.on('whatsapp_qr', (data) => {
        console.log('QR received for branch', data.branch_id);
        if (data.branch_id === 0) {
            if (generalData) { generalData.status = 'qr_pending'; generalData.has_qr = true; }
            renderGeneralCard();
        } else {
            const s = sessionsData.find(x => x.branch_id === data.branch_id);
            if (s) {
                s.status = 'qr_pending';
                s.has_qr = true;
                renderCards();
            }
        }
        renderQR(data.branch_id, data.qr);
    });

    socket.on('whatsapp_status', (data) => {
        console.log('Status update for branch', data.branch_id, ':', data.status);
        if (data.branch_id === 0) {
            if (!generalData) generalData = { branch_id: 0, branch_name: 'General WhatsApp' };
            generalData.status = data.status;
            if (data.phone_number) generalData.phone_number = data.phone_number;
            if (data.status === 'connected') generalData.has_qr = false;
            renderGeneralCard();
        } else {
            const s = sessionsData.find(x => x.branch_id === data.branch_id);
            if (s) {
                s.status = data.status;
                if (data.phone_number) s.phone_number = data.phone_number;
                if (data.status === 'connected') s.has_qr = false;
                renderCards();
            } else {
                loadSessions();
            }
        }
    });
}

// ========================================
// TEST MESSAGE MODAL
// ========================================

function openTestModal(branchId) {
    document.getElementById('testBranchId').value = branchId;
    document.getElementById('testPhone').value = '';
    document.getElementById('testMessage').value = '';
    document.getElementById('testModal').classList.add('show');
}

function closeTestModal() {
    document.getElementById('testModal').classList.remove('show');
}

async function sendTestMessage() {
    const branchId = document.getElementById('testBranchId').value;
    const phone = document.getElementById('testPhone').value.trim();
    const message = document.getElementById('testMessage').value.trim();

    if (!phone) {
        showToast('Please enter a phone number', 'error');
        return;
    }

    try {
        const resp = await apiRequest(`${API_BASE}/${branchId}/test`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, message: message || undefined })
        });
        if (!resp) return;
        const data = await resp.json();
        showToast(data.message, data.success ? 'success' : 'error');
        if (data.success) closeTestModal();
    } catch (err) {
        showToast('Test failed: ' + err.message, 'error');
    }
}

// ========================================
// HELPERS
// ========================================

function formatDate(d) {
    if (!d) return '';
    const dt = new Date(d);
    return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function escHtml(s) {
    if (!s) return '';
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showToast(msg, type = 'info') {
    const t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.className = 'toast show ' + (type === 'error' ? 'toast-error' : type === 'success' ? 'toast-success' : '');
    setTimeout(() => { t.className = 'toast'; }, 3500);
}

// ========================================
// HANDLER WIRING (S9+F5 strict CSP — converted from inline on*= attributes)
// ========================================

// Delegated click listener for runtime-injected buttons inside the rendered cards
// (renderGeneralCard / renderCards innerHTML templates) and the Head-Office link.
// Args read via el.dataset (branch_id is a server-issued integer, auto-unescaped).
document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    const branchId = Number(el.dataset.id);
    if (action === 'open-test-modal') {
        openTestModal(branchId);
    } else if (action === 'disconnect-branch') {
        disconnectBranch(branchId);
    } else if (action === 'connect-branch') {
        connectBranch(branchId);
    } else if (action === 'scroll-to-general') {
        e.preventDefault();
        const generalSection = document.getElementById('generalSection');
        if (generalSection) generalSection.scrollIntoView({ behavior: 'smooth' });
    }
});

// Converted from onclick="loadSessions()" on the Refresh button (static in HTML).
document.getElementById('btnRefresh').addEventListener('click', loadSessions);
// Converted from onclick="closeTestModal()" on the modal Cancel button (static in HTML).
document.getElementById('btnCancelTest').addEventListener('click', closeTestModal);
// Converted from onclick="sendTestMessage()" on the modal Send Test button (static in HTML).
document.getElementById('btnSendTest').addEventListener('click', sendTestMessage);

// ========================================
// INIT
// ========================================

document.addEventListener('DOMContentLoaded', () => {
    loadSessions();
    setupSocketListeners();
});
