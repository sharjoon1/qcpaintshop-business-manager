// Page logic externalized from admin-staff.html inline <script> (S9+F5 Phase E batch 11, 2026-06-25)
// so the page runs under the enforced strict CSP. Verbatim move of all functions; inline on*=
// handlers converted to addEventListener + data-action delegation. No logic changes, no renames,
// escaping helpers untouched.
function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
let allStaff = [];
let branches = [];
let roles = [];
let editingStaffId = null;

// Load initial data
async function loadData() {
    try {
        // Load branches
        const branchRes = await fetch('/api/branches', { headers: getAuthHeaders() });
        const branchData = await branchRes.json();
        branches = branchData.success ? branchData.data : branchData;

        renderBranchCheckboxes();

        // Load roles (only staff-type roles for staff assignment)
        try {
            const rolesRes = await fetch('/api/roles?user_type=staff', { headers: getAuthHeaders() });
            if (rolesRes.ok) {
                const rolesData = await rolesRes.json();
                roles = rolesData.success ? rolesData.data : (Array.isArray(rolesData) ? rolesData : []);
                const roleSelect = document.getElementById('roleId');
                roleSelect.innerHTML = '<option value="">-- Select Role --</option>' +
                    roles.map(r => `<option value="${r.id}">${r.display_name || r.name}</option>`).join('');
            }
        } catch (roleError) {
            console.error('Error loading roles:', roleError);
            // Provide default roles if API fails
            const roleSelect = document.getElementById('roleId');
            roleSelect.innerHTML = `
                <option value="">-- Select Role --</option>
                <option value="1">Admin</option>
                <option value="2">Manager</option>
                <option value="3">Staff</option>
                <option value="4">Accountant</option>
            `;
        }

        // Load staff (users with role='staff' or 'admin')
        await loadStaff();

    } catch (error) {
        console.error('Error loading data:', error);
        alert('Failed to load data');
    }
}

async function loadStaff() {
    try {
        const response = await fetch('/api/users', { headers: getAuthHeaders() });
        const users = await response.json();

        // Filter staff-type roles (exclude customers)
        const customerRoles = ['customer', 'retail_customer', 'contractor', 'builder', 'dealer', 'guest'];
        allStaff = users.filter(u => !customerRoles.includes(u.role));

        // Update stats
        updateStats();

        // Render table
        renderStaffTable();

        document.getElementById('loadingState').classList.add('hidden');
        document.getElementById('staffTable').classList.remove('hidden');

    } catch (error) {
        console.error('Error loading staff:', error);
        document.getElementById('loadingState').innerHTML = '<p class="text-red-600">Failed to load staff</p>';
    }
}

function updateStats() {
    const total = allStaff.length;
    const active = allStaff.filter(s => s.status === 'active').length;
    const pending = allStaff.filter(s => s.status === 'pending_approval').length;
    const inactive = allStaff.filter(s => s.status === 'inactive').length;

    document.getElementById('totalStaff').textContent = total;
    document.getElementById('activeStaff').textContent = active;
    document.getElementById('pendingStaff').textContent = pending;
    document.getElementById('inactiveStaff').textContent = inactive;
}

function renderStaffTable() {
    const tbody = document.getElementById('staffTableBody');

    if (allStaff.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="text-center py-8 text-gray-500">No staff members found</td></tr>';
        return;
    }

    tbody.innerHTML = allStaff.map(staff => {
        const assignedBranches = staff.assigned_branches || [];
        const branchDisplay = assignedBranches.length > 0
            ? assignedBranches.map(ab => ab.is_primary ? `<strong>${esc(ab.branch_name)}</strong>` : esc(ab.branch_name)).join(', ')
            : (esc(branches.find(b => b.id == staff.branch_id)?.name) || 'N/A');
        const geoEnabled = staff.geo_fence_enabled !== undefined ? staff.geo_fence_enabled : true;
        const roleObj = roles.find(r => (r.name || '').toLowerCase() === (staff.role || '').toLowerCase());
        const roleLabel = roleObj ? (roleObj.display_name || roleObj.name) : (staff.role || 'N/A');
        const isAdminRole = ['admin','administrator','super_admin'].includes((staff.role || '').toLowerCase());
        const roleBadgeClass = isAdminRole ? 'bg-purple-100 text-purple-800'
            : (staff.role === 'manager' || staff.role === 'branch_manager' ? 'bg-blue-100 text-blue-800'
            : 'bg-gray-100 text-gray-700');
        return `
            <tr class="hover:bg-gray-50">
                <td class="px-4 py-3 text-sm hide-mobile">${staff.id}</td>
                <td class="px-4 py-3">
                    <div class="flex items-center gap-2">
                        ${staff.profile_image_url
                            ? `<img src="${staff.profile_image_url}" class="staff-avatar w-8 h-8 rounded-full object-cover shrink-0">`
                            : `<div class="w-8 h-8 rounded-full bg-purple-100 text-purple-700 flex items-center justify-center text-xs font-bold shrink-0">${(staff.full_name || '?').charAt(0).toUpperCase()}</div>`
                        }
                        <div>
                            <div class="font-semibold text-gray-900">${esc(staff.full_name) || 'N/A'}</div>
                            <div class="text-xs text-gray-500">${esc(staff.email)}</div>
                        </div>
                    </div>
                </td>
                <td class="px-4 py-3">
                    <span class="px-2 py-1 text-xs rounded-full font-semibold ${roleBadgeClass}">${esc(roleLabel)}</span>
                </td>
                <td class="px-4 py-3 hide-mobile">
                    <span class="px-2 py-0.5 text-xs rounded-full ${getKycClass(staff.kyc_status)}">${getKycText(staff.kyc_status)}</span>
                </td>
                <td class="px-4 py-3 text-sm text-gray-700 hide-mobile">${esc(staff.username)}</td>
                <td class="px-4 py-3 text-sm text-gray-700 hide-mobile">${esc(staff.phone) || '-'}</td>
                <td class="px-4 py-3 text-sm text-gray-700">${branchDisplay}</td>
                <td class="px-4 py-3 hide-mobile">
                    <span class="px-2 py-0.5 text-xs rounded-full ${geoEnabled ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}">
                        ${geoEnabled ? 'ON' : 'OFF'}
                    </span>
                </td>
                <td class="px-4 py-3">
                    <span class="px-2 py-1 text-xs rounded-full ${getStatusClass(staff.status)}">
                        ${getStatusText(staff.status)}
                    </span>
                </td>
                <td class="px-4 py-3 text-center space-x-2">
                    <button data-action="edit-staff" data-id="${staff.id}" class="text-blue-600 hover:text-blue-900 font-semibold text-sm">
                        Edit
                    </button>
                    ${staff.id === 1 ? '' : `<button data-action="delete-staff" data-id="${staff.id}" class="text-red-600 hover:text-red-900 font-semibold text-sm">
                        Delete
                    </button>`}
                </td>
            </tr>
        `;
    }).join('');
}

function getStatusClass(status) {
    const classes = {
        'active': 'bg-green-100 text-green-800',
        'inactive': 'bg-gray-100 text-gray-800',
        'pending_approval': 'bg-yellow-100 text-yellow-800'
    };
    return classes[status] || 'bg-gray-100 text-gray-800';
}

function getStatusText(status) {
    const texts = {
        'active': '✅ Active',
        'inactive': '⏸️ Inactive',
        'pending_approval': '⏳ Pending'
    };
    return texts[status] || status;
}

function getKycClass(status) {
    const classes = { 'complete': 'bg-green-100 text-green-700', 'verified': 'bg-blue-100 text-blue-700', 'incomplete': 'bg-red-100 text-red-700' };
    return classes[status] || 'bg-red-100 text-red-700';
}
function getKycText(status) {
    const texts = { 'complete': 'Complete', 'verified': 'Verified', 'incomplete': 'Incomplete' };
    return texts[status] || 'Incomplete';
}

function renderBranchCheckboxes() {
    const container = document.getElementById('branchCheckboxes');
    container.innerHTML = branches.map(b => `
        <label class="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" value="${b.id}" class="w-4 h-4 text-purple-600 border-gray-300 rounded focus:ring-purple-500">
            <span class="text-sm text-gray-700">${esc(b.name)}</span>
        </label>
    `).join('');
}

function updatePrimaryBranchSelect() {
    const checkedIds = [];
    document.querySelectorAll('#branchCheckboxes input[type="checkbox"]:checked').forEach(cb => {
        checkedIds.push(parseInt(cb.value));
    });
    const select = document.getElementById('primaryBranch');
    const currentVal = select.value;
    select.innerHTML = '<option value="">-- Select Primary Branch --</option>' +
        branches.filter(b => checkedIds.includes(b.id)).map(b => `<option value="${b.id}">${esc(b.name)}</option>`).join('');
    // Restore selection if still valid
    if (checkedIds.includes(parseInt(currentVal))) {
        select.value = currentVal;
    } else if (checkedIds.length === 1) {
        select.value = checkedIds[0];
    }
}

function openAddModal() {
    editingStaffId = null;
    document.getElementById('modalTitle').textContent = 'Add New Staff';
    document.getElementById('staffForm').reset();
    document.getElementById('staffId').value = '';
    document.getElementById('password').required = true;
    document.getElementById('geoFenceEnabled').checked = true;
    document.getElementById('kycSection').classList.add('hidden');
    document.getElementById('aadharNumber').value = '';
    document.getElementById('panNumber').value = '';
    document.querySelectorAll('#branchCheckboxes input[type="checkbox"]').forEach(cb => cb.checked = false);
    updatePrimaryBranchSelect();
    document.getElementById('staffModal').classList.remove('hidden');
}

function editStaff(id) {
    const staff = allStaff.find(s => s.id == id);
    if (!staff) return;

    editingStaffId = id;
    document.getElementById('modalTitle').textContent = 'Edit Staff';
    document.getElementById('staffId').value = staff.id;
    document.getElementById('fullName').value = staff.full_name || '';
    document.getElementById('username').value = staff.username;
    document.getElementById('email').value = staff.email;
    document.getElementById('phone').value = staff.phone || '';

    // Set branch checkboxes
    const assignedIds = (staff.assigned_branches || []).map(ab => ab.branch_id);
    if (assignedIds.length === 0 && staff.branch_id) assignedIds.push(staff.branch_id);
    document.querySelectorAll('#branchCheckboxes input[type="checkbox"]').forEach(cb => {
        cb.checked = assignedIds.includes(parseInt(cb.value));
    });
    updatePrimaryBranchSelect();
    document.getElementById('primaryBranch').value = staff.branch_id || '';

    // Geo-fence toggle
    document.getElementById('geoFenceEnabled').checked = staff.geo_fence_enabled !== undefined ? !!staff.geo_fence_enabled : true;

    // KYC fields (only shown when editing)
    document.getElementById('kycSection').classList.remove('hidden');
    document.getElementById('aadharNumber').value = staff.aadhar_number || '';
    document.getElementById('panNumber').value = staff.pan_number || '';

    // Match role by name since users table stores role as text, not role_id.
    // 'administrator' and 'super_admin' are treated as distinct roles in the
    // dropdown; they're matched by exact name first.
    const staffRoleName = (staff.role || '').toLowerCase();
    let matchedRole = roles.find(r => (r.name || '').toLowerCase() === staffRoleName);
    // If no exact match (e.g. legacy data), and the role is one of the
    // admin aliases, fall back to the canonical 'admin' option so the
    // dropdown still has a sensible selection.
    if (!matchedRole && ['admin', 'administrator', 'super_admin'].includes(staffRoleName)) {
        matchedRole = roles.find(r => (r.name || '').toLowerCase() === 'admin');
    }
    document.getElementById('roleId').value = matchedRole ? matchedRole.id : '';
    document.getElementById('status').value = staff.status;
    document.getElementById('password').required = false;
    document.getElementById('password').value = '';

    document.getElementById('staffModal').classList.remove('hidden');
}

function closeModal() {
    document.getElementById('staffModal').classList.add('hidden');
}

async function saveStaff(event) {
    event.preventDefault();

    const selectedRoleId = document.getElementById('roleId').value;
    const selectedRole = roles.find(r => r.id == selectedRoleId);

    // Reject the form if the roles list never loaded — otherwise we'd
    // silently downgrade everyone to 'staff' on save.
    if (!selectedRole) {
        alert('Please select a role for this staff member.');
        return;
    }

    // Gather selected branch IDs
    const selectedBranchIds = [];
    document.querySelectorAll('#branchCheckboxes input[type="checkbox"]:checked').forEach(cb => {
        selectedBranchIds.push(parseInt(cb.value));
    });
    if (selectedBranchIds.length === 0) {
        alert('Please select at least one branch');
        return;
    }
    const primaryBranchId = document.getElementById('primaryBranch').value;
    if (!primaryBranchId) {
        alert('Please select a primary branch');
        return;
    }

    const staffData = {
        full_name: document.getElementById('fullName').value,
        username: document.getElementById('username').value,
        email: document.getElementById('email').value,
        phone: document.getElementById('phone').value || null,
        branch_id: parseInt(primaryBranchId),
        branch_ids: selectedBranchIds,
        geo_fence_enabled: document.getElementById('geoFenceEnabled').checked,
        status: document.getElementById('status').value,
        role: (selectedRole.name || 'staff').toLowerCase()
    };

    // KYC fields (only when editing)
    if (editingStaffId) {
        const aadhar = document.getElementById('aadharNumber').value.trim();
        const pan = document.getElementById('panNumber').value.trim().toUpperCase();
        if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan)) {
            alert('Invalid PAN format (e.g. ABCDE1234F)');
            return;
        }
        staffData.aadhar_number = aadhar || null;
        staffData.pan_number = pan || null;
    }

    const password = document.getElementById('password').value;
    if (password) {
        staffData.password = password;
    }

    try {
        const url = editingStaffId
            ? `/api/users/${editingStaffId}`
            : '/api/users';

        const method = editingStaffId ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method: method,
            headers: getAuthHeaders(),
            body: JSON.stringify(staffData)
        });

        let body = null;
        try { body = await response.json(); } catch(_) {}

        if (response.ok) {
            alert(editingStaffId ? 'Staff updated successfully!' : 'Staff added successfully!');
            closeModal();
            loadStaff();
        } else {
            const msg = (body && (body.error || body.message)) || `HTTP ${response.status}`;
            alert('Failed to save staff: ' + msg);
        }
    } catch (error) {
        console.error('Error saving staff:', error);
        alert('Error saving staff: ' + (error.message || error));
    }
}

async function deleteStaff(id) {
    const staff = allStaff.find(s => s.id == id);
    if (!staff) return;

    if (!confirm(`Are you sure you want to delete ${staff.full_name}?\n\nThis action cannot be undone!`)) return;

    try {
        const response = await fetch(`/api/users/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });

        if (response.ok) {
            alert('Staff deleted successfully!');
            loadStaff();
        } else {
            alert('Failed to delete staff');
        }
    } catch (error) {
        console.error('Error deleting staff:', error);
        alert('Error deleting staff');
    }
}

// ── Static handler wiring (externalized from inline on*= attributes; S9+F5 Phase E batch 11, 2026-06-25) ──
// Add Staff header button (was onclick="openAddModal()")
document.getElementById('addStaffBtn').addEventListener('click', openAddModal);
// Modal backdrop overlay (was onclick="closeModal()")
document.getElementById('staffModalBackdrop').addEventListener('click', closeModal);
// Staff form save (was onsubmit="saveStaff(event)")
document.getElementById('staffForm').addEventListener('submit', saveStaff);
// Modal Cancel button (was onclick="closeModal()")
document.getElementById('staffCancelBtn').addEventListener('click', closeModal);

// Delegated dispatcher for runtime-rendered table buttons (replaces inline
// onclick="editStaff(...)" / onclick="deleteStaff(...)"). One document-level listener routes by data-action.
document.addEventListener('click', function (e) {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.getAttribute('data-action');
    if (!action) return;
    if (action === 'edit-staff') {
        editStaff(el.getAttribute('data-id'));
    } else if (action === 'delete-staff') {
        deleteStaff(el.getAttribute('data-id'));
    }
});

// Hide runtime-rendered profile images that fail to load (was inline
// onerror="this.style.display='none'" on the <img>). error events do not bubble,
// so this delegated listener runs in the capture phase.
document.addEventListener('error', function (e) {
    const img = e.target;
    if (img && img.tagName === 'IMG' && img.classList.contains('staff-avatar')) {
        img.style.display = 'none';
    }
}, true);

// Delegated change listener for runtime-rendered branch checkboxes
// (replaces inline onchange="updatePrimaryBranchSelect()" on each checkbox).
document.getElementById('branchCheckboxes').addEventListener('change', function (e) {
    if (e.target.matches('input[type="checkbox"]')) {
        updatePrimaryBranchSelect();
    }
});

// Initialize
loadData();
