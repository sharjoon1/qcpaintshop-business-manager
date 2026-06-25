// Page logic for Stock Migration. Externalized from the admin-stock-migration.html inline <script>
// (S9+F5 Phase C, 2026-06-25) so the page runs under the enforced strict CSP.
// Verbatim move of all functions; inline on*= handlers converted to addEventListener /
// data-action delegation. No logic changes, no renames, escaping helpers untouched.
let branchData = [];
let transferInProgress = false;

function headers() { return getAuthHeaders(); }

async function syncStock() {
    const btn = document.getElementById('btnSync');
    btn.disabled = true;
    btn.textContent = 'Syncing...';
    showToast('Syncing stock from Zoho... this may take a minute', 'info');
    try {
        const result = await apiPost('/api/zoho/migration/sync-stock', {});
        if (result.success) {
            showToast('Stock sync started! Wait 1-2 minutes, then click Refresh.', 'success');
        } else {
            showToast('Sync failed: ' + result.message, 'error');
        }
    } catch (err) {
        showToast('Sync error: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Sync Stock from Zoho';
    }
}

function showToast(msg, type = 'success') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast toast-' + type + ' show';
    setTimeout(() => t.classList.remove('show'), 3000);
}

async function apiFetch(url) {
    const res = await fetch(url, { headers: headers() });
    return res.json();
}

async function apiPost(url, body) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { ...headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    return res.json();
}

async function loadData() {
    document.getElementById('loadingState').style.display = '';
    document.getElementById('emptyState').style.display = 'none';
    document.getElementById('branchList').innerHTML = '';
    document.getElementById('summarySection').style.display = 'none';
    document.getElementById('actionSection').style.display = 'none';

    try {
        const data = await apiFetch('/api/zoho/migration/warehouse-stock');
        if (!data.success) throw new Error(data.message);

        branchData = data.branches || [];
        document.getElementById('loadingState').style.display = 'none';

        if (branchData.length === 0) {
            document.getElementById('emptyState').style.display = '';
            return;
        }

        renderSummary();
        renderTable();
        document.getElementById('summarySection').style.display = '';
        document.getElementById('actionSection').style.display = 'flex';
    } catch (err) {
        document.getElementById('loadingState').innerHTML = '<div class="text-red-500">Error: ' + esc(err.message) + '</div>';
        showToast('Failed to load data: ' + err.message, 'error');
    }
}

function renderSummary() {
    const branches = branchData.filter(b => b.total_items > 0);
    const totalItems = branchData.reduce((s, b) => s + b.total_items, 0);
    const totalQty = branchData.reduce((s, b) => s + b.total_quantity, 0);

    document.getElementById('statBranches').textContent = branches.length;
    document.getElementById('statItems').textContent = totalItems;
    document.getElementById('statQuantity').textContent = Math.round(totalQty).toLocaleString();
    document.getElementById('statPending').textContent = branches.length;
}

function renderTable() {
    const container = document.getElementById('branchList');
    let html = `<div class="branch-row header">
        <div>Branch</div>
        <div>Warehouse Location</div>
        <div>Items</div>
        <div>Total Qty</div>
        <div>Business Location</div>
        <div>Action</div>
    </div>`;

    branchData.forEach((b, idx) => {
        const hasStock = b.total_items > 0;
        html += `<div class="branch-row" id="branch-row-${idx}">
            <div>
                <span class="mobile-label">Branch: </span>
                <span class="font-semibold text-gray-900">${esc(b.branch_name)}</span>
            </div>
            <div>
                <span class="mobile-label">Warehouse: </span>
                <span class="text-sm text-gray-600">${esc(b.warehouse_location_name)}</span>
            </div>
            <div>
                <span class="mobile-label">Items: </span>
                <span class="font-medium">${b.total_items}</span>
                ${hasStock ? `<button class="expand-btn" data-action="toggleItems" data-idx="${idx}">view</button>` : ''}
            </div>
            <div>
                <span class="mobile-label">Total Qty: </span>
                <span class="font-medium">${Math.round(b.total_quantity).toLocaleString()}</span>
            </div>
            <div>
                <span class="mobile-label">Business: </span>
                <span class="text-sm text-gray-600">${esc(b.business_location_name)}</span>
            </div>
            <div>
                <span id="branch-status-${idx}">
                    ${hasStock
                        ? `<button class="btn btn-primary btn-sm" id="btn-transfer-${idx}" data-action="transferBranch" data-idx="${idx}">Transfer</button>`
                        : `<span class="status-badge status-skipped">No stock</span>`}
                </span>
            </div>
        </div>
        <div id="items-${idx}" class="item-list" style="margin:0 1rem">
            ${b.items.map(i => `<div class="item-row"><span>${esc(i.name)}${i.sku ? ' (' + esc(i.sku) + ')' : ''}</span><span class="font-medium">${i.stock}</span></div>`).join('')}
        </div>`;
    });

    container.innerHTML = html;
}

function toggleItems(idx) {
    const el = document.getElementById('items-' + idx);
    el.classList.toggle('show');
}

function addLog(msg, type) {
    const section = document.getElementById('logSection');
    section.style.display = '';
    const list = document.getElementById('logList');
    const time = new Date().toLocaleTimeString();
    list.innerHTML += `<div class="log-entry log-${esc(type)}">[${esc(time)}] ${esc(msg)}</div>`;
    list.scrollTop = list.scrollHeight;
}

function setBranchStatus(idx, status, text) {
    const el = document.getElementById('branch-status-' + idx);
    if (!el) return;
    if (status === 'transferring') {
        el.innerHTML = `<span class="status-badge status-transferring"><span class="spinner-sm"></span> Transferring</span>`;
    } else if (status === 'success') {
        el.innerHTML = `<span class="status-badge status-success">Done</span>`;
    } else if (status === 'failed') {
        el.innerHTML = `<span class="status-badge status-failed" title="${esc(text || '')}">Failed</span>`;
    } else if (status === 'skipped') {
        el.innerHTML = `<span class="status-badge status-skipped">Skipped</span>`;
    }
}

async function transferBranch(idx) {
    if (transferInProgress) return showToast('Transfer already in progress', 'warning');

    const branch = branchData[idx];
    if (!branch || branch.total_items === 0) return;

    const btn = document.getElementById('btn-transfer-' + idx);
    if (btn) btn.disabled = true;

    setBranchStatus(idx, 'transferring');
    addLog(`Starting transfer for ${branch.branch_name}...`, 'info');

    try {
        const result = await apiPost('/api/zoho/migration/transfer', {
            branch_id: branch.branch_id,
            branch_name: branch.branch_name,
            from_location_id: branch.warehouse_location_id,
            to_location_id: branch.business_location_id,
            items: branch.items
        });

        if (result.success) {
            if (result.skipped) {
                setBranchStatus(idx, 'skipped');
                addLog(`${branch.branch_name}: Skipped (no items with stock)`, 'skip');
            } else {
                setBranchStatus(idx, 'success');
                addLog(`${branch.branch_name}: Transfer order created (${result.items_transferred} items, TO#: ${result.transfer_order_number || result.transfer_order_id || 'N/A'})`, 'success');
            }
            showToast(`${branch.branch_name} transfer complete`, 'success');
        } else {
            setBranchStatus(idx, 'failed', result.message);
            addLog(`${branch.branch_name}: FAILED - ${result.message}`, 'error');
            showToast(`${branch.branch_name} transfer failed`, 'error');
        }
    } catch (err) {
        setBranchStatus(idx, 'failed', err.message);
        addLog(`${branch.branch_name}: ERROR - ${err.message}`, 'error');
        showToast('Transfer error: ' + err.message, 'error');
    }
}

async function transferAll() {
    if (transferInProgress) return showToast('Transfer already in progress', 'warning');

    const pendingBranches = branchData.filter(b => b.total_items > 0);
    if (pendingBranches.length === 0) return showToast('No branches to transfer', 'warning');

    if (!confirm(`Transfer stock for ${pendingBranches.length} branch(es)? This will create transfer orders in Zoho.`)) return;

    transferInProgress = true;
    document.getElementById('btnTransferAll').disabled = true;
    document.getElementById('progressSection').style.display = '';
    document.getElementById('logList').innerHTML = '';

    const total = pendingBranches.length;
    let completed = 0;
    let successCount = 0;
    let failCount = 0;

    addLog(`Starting bulk transfer for ${total} branches...`, 'info');

    for (let i = 0; i < branchData.length; i++) {
        const branch = branchData[i];
        if (branch.total_items === 0) {
            setBranchStatus(i, 'skipped');
            continue;
        }

        setBranchStatus(i, 'transferring');
        document.getElementById('progressLabel').textContent = `Transferring ${branch.branch_name}...`;
        document.getElementById('progressCount').textContent = `${completed}/${total}`;

        try {
            const result = await apiPost('/api/zoho/migration/transfer', {
                branch_id: branch.branch_id,
                branch_name: branch.branch_name,
                from_location_id: branch.warehouse_location_id,
                to_location_id: branch.business_location_id,
                items: branch.items
            });

            if (result.success && !result.skipped) {
                setBranchStatus(i, 'success');
                addLog(`${branch.branch_name}: Transfer order created (${result.items_transferred} items)`, 'success');
                successCount++;
            } else if (result.success && result.skipped) {
                setBranchStatus(i, 'skipped');
                addLog(`${branch.branch_name}: Skipped`, 'skip');
            } else {
                setBranchStatus(i, 'failed', result.message);
                addLog(`${branch.branch_name}: FAILED - ${result.message}`, 'error');
                failCount++;
            }
        } catch (err) {
            setBranchStatus(i, 'failed', err.message);
            addLog(`${branch.branch_name}: ERROR - ${err.message}`, 'error');
            failCount++;
        }

        completed++;
        const pct = Math.round((completed / total) * 100);
        document.getElementById('progressFill').style.width = pct + '%';
        document.getElementById('progressCount').textContent = `${completed}/${total}`;
    }

    document.getElementById('progressLabel').textContent = 'Complete!';
    addLog(`Bulk transfer complete: ${successCount} succeeded, ${failCount} failed`, successCount > 0 ? 'success' : 'error');

    transferInProgress = false;
    document.getElementById('btnTransferAll').disabled = true;
    document.getElementById('btnTransferAll').textContent = 'All Transfers Complete';

    // Show disable button if any transfers succeeded
    if (successCount > 0) {
        document.getElementById('btnDisable').style.display = '';
    }

    showToast(`Transfer complete: ${successCount} succeeded, ${failCount} failed`, failCount > 0 ? 'warning' : 'success');
}

async function disableWarehouses() {
    if (!confirm('This will disable ALL warehouse locations in the system. Are you sure?')) return;
    if (!confirm('FINAL CONFIRMATION: Warehouse locations will be marked inactive. Continue?')) return;

    const btn = document.getElementById('btnDisable');
    btn.disabled = true;
    btn.textContent = 'Disabling...';
    addLog('Disabling warehouse locations...', 'info');

    try {
        const result = await apiPost('/api/zoho/migration/disable-warehouses', {});
        if (result.success) {
            addLog(`Disabled ${result.disabled_count} warehouse location(s)`, 'success');
            showToast(`${result.disabled_count} warehouse location(s) disabled`, 'success');
            btn.textContent = 'Warehouses Disabled';
        } else {
            addLog('Failed to disable warehouses: ' + result.message, 'error');
            showToast('Failed: ' + result.message, 'error');
            btn.disabled = false;
            btn.textContent = 'Disable All Warehouse Locations';
        }
    } catch (err) {
        addLog('Error disabling warehouses: ' + err.message, 'error');
        showToast('Error: ' + err.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Disable All Warehouse Locations';
    }
}

function esc(str) {
    if (!str) return '';
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
}

// --- S9+F5 CSP: inline on*= handlers wired via addEventListener / data-action delegation ---
function initStockMigrationHandlers() {
    const btnSync = document.getElementById('btnSync');
    if (btnSync) btnSync.addEventListener('click', syncStock);

    const btnRefresh = document.getElementById('btnRefresh');
    if (btnRefresh) btnRefresh.addEventListener('click', loadData);

    const btnTransferAll = document.getElementById('btnTransferAll');
    if (btnTransferAll) btnTransferAll.addEventListener('click', transferAll);

    const btnDisable = document.getElementById('btnDisable');
    if (btnDisable) btnDisable.addEventListener('click', disableWarehouses);

    // Delegated runtime handler for buttons rendered into branch rows via innerHTML
    // (expand "view" + per-row "Transfer"). data-action keeps it CSP-clean.
    document.addEventListener('click', function(e) {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const action = btn.dataset.action;
        const idx = Number(btn.dataset.idx);
        if (action === 'toggleItems') {
            toggleItems(idx);
        } else if (action === 'transferBranch') {
            transferBranch(idx);
        }
    });
}

// Load on page ready
document.addEventListener('DOMContentLoaded', function() {
    initStockMigrationHandlers();
    loadData();
});
