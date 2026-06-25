// Page logic externalized from admin-roles.html inline <script> (S9+F5 Phase E batch 10, 2026-06-25)
// so the page runs under the enforced strict CSP. Verbatim move of all functions; inline on*=
// handlers converted to addEventListener + data-action delegation. No logic changes, no renames,
// escaping helpers untouched.
let allRoles = [];
let currentFilter = 'staff';

function escHtml(s){ if(s==null) return ''; const d=document.createElement('div'); d.textContent=String(s); return d.innerHTML; }

// Load roles
async function loadRoles() {
    try {
        const response = await apiRequest('/api/roles');
        const data = await response.json();

        if (data.success) {
            allRoles = data.data || [];
            filterRoles(currentFilter);
        } else {
            alert('❌ Failed to load roles: ' + (data.error || data.message || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error loading roles:', error);
        alert('❌ Error loading roles: ' + error.message);
    }
}

// Filter and display roles
function filterRoles(type) {
    currentFilter = type;

    // Update tab styling
    document.querySelectorAll('[id^="tab-"]').forEach(tab => {
        tab.classList.remove('border-purple-600', 'text-purple-600');
        tab.classList.add('border-transparent', 'text-gray-600');
    });
    document.getElementById(`tab-${type}`).classList.remove('border-transparent', 'text-gray-600');
    document.getElementById(`tab-${type}`).classList.add('border-purple-600', 'text-purple-600');

    // Filter roles
    const filtered = type === 'all' ? allRoles : allRoles.filter(r => r.user_type === type);

    // Render roles
    const container = document.getElementById('rolesContainer');
    container.innerHTML = filtered.map(role => `
        <div class="bg-white border-2 border-gray-200 rounded-lg p-4 hover:shadow-lg transition ${role.is_system_role ? 'border-blue-200 bg-blue-50' : ''}">
            <div class="flex justify-between items-start mb-2">
                <div>
                    <h3 class="font-bold text-lg text-gray-800">${escHtml(role.display_name)}</h3>
                    <p class="text-sm text-gray-600">${escHtml(role.name)}</p>
                </div>
                <span class="px-2 py-1 text-xs font-semibold rounded ${role.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}">
                    ${escHtml(role.status)}
                </span>
            </div>

            <p class="text-sm text-gray-600 mb-3">${escHtml(role.description) || 'No description'}</p>

            <div class="flex items-center gap-2 text-xs text-gray-500 mb-3">
                <span class="px-2 py-1 bg-gray-100 rounded">${escHtml(role.user_type)}</span>
                ${role.is_system_role ? '<span class="px-2 py-1 bg-blue-100 text-blue-800 rounded">System</span>' : ''}
            </div>

            <div class="flex gap-2">
                <button data-action="view-permissions" data-id="${role.id}" class="flex-1 px-3 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700">
                    Permissions
                </button>
                ${!role.is_system_role ? `
                <button data-action="edit-role" data-id="${role.id}" class="px-3 py-2 bg-gray-600 text-white text-sm rounded hover:bg-gray-700">
                    Edit
                </button>
                ` : ''}
            </div>
        </div>
    `).join('');
}

// Open add role modal
function openAddRoleModal() {
    document.getElementById('modalTitle').textContent = 'Add Role';
    document.getElementById('roleForm').reset();
    document.getElementById('roleId').value = '';
    document.getElementById('roleModal').classList.remove('hidden');
}

// Close modal
function closeRoleModal() {
    document.getElementById('roleModal').classList.add('hidden');
}

// Edit role
function editRole(roleId) {
    const role = allRoles.find(r => r.id === roleId);
    if (!role) return;

    document.getElementById('modalTitle').textContent = 'Edit Role';
    document.getElementById('roleId').value = role.id;
    document.getElementById('roleName').value = role.name;
    document.getElementById('roleDisplayName').value = role.display_name;
    document.getElementById('roleDescription').value = role.description || '';
    document.getElementById('roleUserType').value = role.user_type;
    document.getElementById('roleStatus').value = role.status;
    document.getElementById('rolePriceMarkup').value = role.price_markup_percent || 0;
    document.getElementById('roleDefaultDiscount').value = role.default_discount_percent || 0;

    document.getElementById('roleModal').classList.remove('hidden');
}

// Save role
document.getElementById('roleForm').addEventListener('submit', async function(e) {
    e.preventDefault();

    const roleId = document.getElementById('roleId').value;
    const roleData = {
        name: document.getElementById('roleName').value,
        display_name: document.getElementById('roleDisplayName').value,
        description: document.getElementById('roleDescription').value,
        user_type: document.getElementById('roleUserType').value,
        status: document.getElementById('roleStatus').value,
        price_markup_percent: document.getElementById('rolePriceMarkup').value,
        default_discount_percent: document.getElementById('roleDefaultDiscount').value
    };

    try {
        const token = localStorage.getItem('auth_token');
        const url = roleId ? `/api/roles/${roleId}` : '/api/roles';
        const method = roleId ? 'PUT' : 'POST';

        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(roleData)
        });

        const result = await response.json();

        if (response.ok && result.success) {
            alert('✅ Role saved successfully!');
            closeRoleModal();
            loadRoles();
        } else {
            alert(`❌ Failed to save role: ${result.error || result.message}`);
        }
    } catch (error) {
        console.error('Error saving role:', error);
        alert('❌ Error saving role');
    }
});

// View permissions
function viewPermissions(roleId) {
    window.location.href = `/admin-role-permissions.html?role_id=${roleId}`;
}

// ── Static handler wiring (externalized from inline on*= attributes; S9+F5 Phase E batch 10, 2026-06-25) ──
// Add Role header button (was onclick="openAddRoleModal()")
document.getElementById('addRoleBtn').addEventListener('click', openAddRoleModal);
// Staff Roles tab (was onclick="filterRoles('staff')")
document.getElementById('tab-staff').addEventListener('click', () => filterRoles('staff'));
// Customer Roles tab (was onclick="filterRoles('customer')")
document.getElementById('tab-customer').addEventListener('click', () => filterRoles('customer'));
// All Roles tab (was onclick="filterRoles('all')")
document.getElementById('tab-all').addEventListener('click', () => filterRoles('all'));
// Modal Cancel button (was onclick="closeRoleModal()")
document.getElementById('roleCancelBtn').addEventListener('click', closeRoleModal);

// Delegated dispatcher for runtime-rendered role card buttons (replaces inline
// onclick="viewPermissions(...)" / onclick="editRole(...)"). One document-level listener
// routes by data-action.
document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    if (action === 'view-permissions') viewPermissions(btn.getAttribute('data-id'));
    else if (action === 'edit-role') editRole(btn.getAttribute('data-id'));
});

// Load roles on page load
loadRoles();
