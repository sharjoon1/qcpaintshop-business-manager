// admin-salary-config page logic — externalized from admin-salary-config.html (S9+F5 strict CSP).
// NON-deferred, loaded right before </body> (matches original end-of-body timing).
const API_BASE = '';
let currentUser = null;

// Check authentication
async function checkAuth() {
    const token = localStorage.getItem('auth_token');
    if (!token) {
        window.location.href = '/login.html';
        return false;
    }

    try {
        const response = await fetch(`${API_BASE}/api/auth/me`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            throw new Error('Unauthorized');
        }

        currentUser = await response.json();
        return true;
    } catch (error) {
        localStorage.removeItem('auth_token');
        window.location.href = '/login.html';
        return false;
    }
}

// Load branches
async function loadBranches() {
    try {
        const token = localStorage.getItem('auth_token');
        const response = await fetch(`${API_BASE}/api/branches`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const result = await response.json();
        const branches = Array.isArray(result) ? result : (result.data || []);

        const selects = ['filterBranch', 'branchId'];
        selects.forEach(selectId => {
            const select = document.getElementById(selectId);
            select.innerHTML = selectId === 'filterBranch' ? '<option value="">All Branches</option>' : '<option value="">Select Branch</option>';
            branches.forEach(branch => {
                select.innerHTML += `<option value="${branch.id}">${escapeVis(branch.name)}</option>`;
            });
        });
    } catch (error) {
        console.error('Error loading branches:', error);
    }
}

// ---------- Staff salary-visibility panel ----------
let _visStaffList = [];
function toggleVisibilityPanel() {
    const p = document.getElementById('visibilityPanel');
    const show = p.style.display === 'none';
    p.style.display = show ? 'block' : 'none';
    if (show && _visStaffList.length === 0) loadVisibilityList();
}
async function loadVisibilityList() {
    const token = localStorage.getItem('auth_token');
    try {
        const res = await fetch(`${API_BASE}/api/salary/visibility`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const json = await res.json();
        if (json.success) { _visStaffList = json.data || []; renderVisibilityList(); }
        else document.getElementById('visLoading').textContent = json.message || 'Load failed';
    } catch (e) {
        document.getElementById('visLoading').textContent = 'Load failed: ' + e.message;
    }
}
function renderVisibilityList() {
    const q = (document.getElementById('visSearch').value || '').toLowerCase().trim();
    const list = q
        ? _visStaffList.filter(u => (u.full_name || '').toLowerCase().includes(q) || (u.username || '').toLowerCase().includes(q))
        : _visStaffList;
    document.getElementById('visLoading').style.display = 'none';
    const wrap = document.getElementById('visList');
    wrap.style.display = 'block';
    if (list.length === 0) { wrap.innerHTML = '<div style="padding:16px;color:#6b7280;font-size:13px;">No staff match.</div>'; return; }
    wrap.innerHTML = list.map(u => {
        const on = u.salary_visible_to_staff == 1;
        return `
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border-bottom:1px solid #f3f4f6;">
                <div>
                    <div style="font-weight:600;color:#111827;">${escapeVis(u.full_name || u.username || ('User #' + u.id))}</div>
                    <div style="font-size:12px;color:#6b7280;">${escapeVis(u.role)}${u.username ? ' · @' + escapeVis(u.username) : ''}</div>
                </div>
                <label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;">
                    <span style="font-size:12px;color:${on ? '#059669' : '#6b7280'};font-weight:600;">${on ? 'Visible' : 'Hidden'}</span>
                    <input type="checkbox" ${on ? 'checked' : ''} data-action="toggle-visibility" data-id="${u.id}" style="width:18px;height:18px;cursor:pointer;">
                </label>
            </div>`;
    }).join('');
}
function escapeVis(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
async function toggleStaffVisibility(userId, cb) {
    const token = localStorage.getItem('auth_token');
    const visible = cb.checked;
    cb.disabled = true;
    try {
        const res = await fetch(`${API_BASE}/api/salary/visibility/${userId}`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ visible })
        });
        const json = await res.json();
        if (json.success) {
            // Update local cache + re-render to refresh the label
            const hit = _visStaffList.find(u => u.id === userId);
            if (hit) hit.salary_visible_to_staff = visible ? 1 : 0;
            renderVisibilityList();
        } else {
            cb.checked = !visible;
            alert(json.message || 'Update failed');
        }
    } catch (e) {
        cb.checked = !visible;
        alert('Update failed: ' + e.message);
    }
    cb.disabled = false;
}
// ---------- end visibility panel ----------

// Load staff
async function loadStaff() {
    const token = localStorage.getItem('auth_token');
    const response = await fetch(`${API_BASE}/api/users?assignable=1`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await response.json();

    const select = document.getElementById('userId');
    select.innerHTML = '<option value="">Select Staff</option>';
    data.forEach(user => {
        select.innerHTML += `<option value="${user.id}">${escapeVis(user.full_name)} - ${escapeVis(user.email)}</option>`;
    });
}

// Load salary configurations
async function loadConfigs() {
    const token = localStorage.getItem('auth_token');
    const branchId = document.getElementById('filterBranch').value;
    const isActive = document.getElementById('filterStatus').value;

    document.getElementById('loading').style.display = 'block';
    document.getElementById('tableContent').style.display = 'none';
    document.getElementById('emptyState').style.display = 'none';

    let url = `${API_BASE}/api/salary/config?`;
    if (branchId) url += `branch_id=${branchId}&`;
    if (isActive) url += `is_active=${isActive}&`;

    const response = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
    });

    const result = await response.json();

    document.getElementById('loading').style.display = 'none';

    if (result.success && result.data.length > 0) {
        renderConfigs(result.data);
        document.getElementById('tableContent').style.display = 'block';
    } else {
        document.getElementById('emptyState').style.display = 'block';
    }
}

// Render configurations
function renderConfigs(configs) {
    const tbody = document.getElementById('configTableBody');
    tbody.innerHTML = configs.map(config => `
        <tr>
            <td>${escapeVis(config.staff_name)}</td>
            <td>${escapeVis(config.branch_name)}</td>
            <td class="money">₹${(parseFloat(config.monthly_salary) || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
            <td class="money">₹${(parseFloat(config.hourly_rate) || 0).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
            <td>${config.overtime_multiplier}x</td>
            <td class="money">₹${((parseFloat(config.transport_allowance) || 0) + (parseFloat(config.food_allowance) || 0) + (parseFloat(config.other_allowance) || 0)).toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
            <td>${new Date(config.effective_from).toLocaleDateString('en-IN')}</td>
            <td>
                <span class="badge ${config.is_active ? 'badge-success' : 'badge-secondary'}">
                    ${config.is_active ? 'Active' : 'Inactive'}
                </span>
            </td>
            <td>
                <button class="btn btn-primary" style="padding: 5px 10px; font-size: 12px;" data-action="edit-config" data-id="${config.id}">
                    <i class="fas fa-edit"></i> Edit
                </button>
            </td>
        </tr>
    `).join('');
}

// Show add modal
function showAddModal() {
    document.getElementById('modalTitle').textContent = 'Add Salary Configuration';
    document.getElementById('configForm').reset();
    document.getElementById('configId').value = '';
    document.getElementById('effectiveFrom').valueAsDate = new Date();
    document.getElementById('configModal').classList.add('active');
}

// Edit configuration
async function editConfig(id) {
    const token = localStorage.getItem('auth_token');
    const response = await fetch(`${API_BASE}/api/salary/config/${id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const result = await response.json();

    if (result.success) {
        const config = result.data;
        document.getElementById('modalTitle').textContent = 'Edit Salary Configuration';
        document.getElementById('configId').value = config.id;
        document.getElementById('userId').value = config.user_id;
        document.getElementById('userId').disabled = true;
        document.getElementById('branchId').value = config.branch_id;
        document.getElementById('monthlySalary').value = config.monthly_salary;
        document.getElementById('overtimeMultiplier').value = config.overtime_multiplier;
        document.getElementById('standardDailyHours').value = config.standard_daily_hours;
        document.getElementById('sundayHours').value = config.sunday_hours;
        document.getElementById('transportAllowance').value = config.transport_allowance;
        document.getElementById('foodAllowance').value = config.food_allowance;
        document.getElementById('otherAllowance').value = config.other_allowance;
        document.getElementById('allowanceNotes').value = config.allowance_notes || '';
        document.getElementById('effectiveFrom').value = config.effective_from.split('T')[0];
        document.getElementById('enableLateDeduction').checked = config.enable_late_deduction;
        document.getElementById('enableAbsenceDeduction').checked = config.enable_absence_deduction;

        document.getElementById('configModal').classList.add('active');
    }
}

// Close modal
function closeModal() {
    document.getElementById('configModal').classList.remove('active');
    document.getElementById('userId').disabled = false;
}

// Save configuration
async function saveConfig() {
    const token = localStorage.getItem('auth_token');
    const id = document.getElementById('configId').value;

    const data = {
        user_id: parseInt(document.getElementById('userId').value),
        branch_id: parseInt(document.getElementById('branchId').value),
        monthly_salary: parseFloat(document.getElementById('monthlySalary').value),
        overtime_multiplier: parseFloat(document.getElementById('overtimeMultiplier').value),
        // standard_daily_hours / sunday_hours intentionally not sent —
        // locked fields, the API rejects them (RT-040 / M6)
        transport_allowance: parseFloat(document.getElementById('transportAllowance').value),
        food_allowance: parseFloat(document.getElementById('foodAllowance').value),
        other_allowance: parseFloat(document.getElementById('otherAllowance').value),
        allowance_notes: document.getElementById('allowanceNotes').value,
        effective_from: document.getElementById('effectiveFrom').value,
        enable_late_deduction: document.getElementById('enableLateDeduction').checked ? 1 : 0,
        enable_absence_deduction: document.getElementById('enableAbsenceDeduction').checked ? 1 : 0
    };

    const url = id ? `${API_BASE}/api/salary/config/${id}` : `${API_BASE}/api/salary/config`;
    const method = id ? 'PUT' : 'POST';

    const response = await fetch(url, {
        method,
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
    });

    const result = await response.json();

    if (result.success) {
        alert('Salary configuration saved successfully!');
        closeModal();
        loadConfigs();
    } else {
        alert('Error: ' + result.message);
    }
}

// ---------- S9+F5 strict-CSP handler wiring (converted from inline on*= attributes) ----------

// Static handlers (converted from inline onclick/onchange/oninput attributes).
document.getElementById('toggleVisBtn').addEventListener('click', toggleVisibilityPanel);
document.getElementById('addConfigBtn').addEventListener('click', showAddModal);
document.getElementById('visSearch').addEventListener('input', renderVisibilityList);
document.getElementById('filterBranch').addEventListener('change', loadConfigs);
document.getElementById('filterStatus').addEventListener('change', loadConfigs);
document.getElementById('refreshBtn').addEventListener('click', loadConfigs);
document.getElementById('cancelBtn').addEventListener('click', closeModal);
document.getElementById('saveConfigBtn').addEventListener('click', saveConfig);

// Runtime-injected handlers (delegated, dispatched by data-action).
// Visibility toggle checkbox (was onchange="toggleStaffVisibility(id, this)" inside a template).
document.addEventListener('change', function (ev) {
    const t = ev.target instanceof Element ? ev.target.closest('[data-action="toggle-visibility"]') : null;
    if (!t) return;
    toggleStaffVisibility(Number(t.dataset.id), t);
});

// Edit config button (was onclick="editConfig(id)" inside a template).
document.addEventListener('click', function (ev) {
    const t = ev.target instanceof Element ? ev.target.closest('[data-action="edit-config"]') : null;
    if (!t) return;
    editConfig(Number(t.dataset.id));
});

// Initialize
(async () => {
    if (await checkAuth()) {
        loadBranches();
        loadStaff();
        loadConfigs();
    }
})();
