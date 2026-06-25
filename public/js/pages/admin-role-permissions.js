// Page logic externalized from admin-role-permissions.html inline <script> (S9+F5 Phase E batch 10, 2026-06-25)
// so the page runs under the enforced strict CSP. Verbatim move of all functions; inline on*=
// handlers converted to addEventListener + data-action delegation. No logic changes, no renames,
// escaping helpers untouched.
// Get role ID from URL
const urlParams = new URLSearchParams(window.location.search);
let roleId = urlParams.get('role_id') || urlParams.get('role');

// Global state
let allPermissions = {};
let rolePermissions = [];
let selectedPermissions = new Set();

function escHtml(s){ if(s==null) return ''; const d=document.createElement('div'); d.textContent=String(s); return d.innerHTML; }

// Module icons
const moduleIcons = {
    'estimates': '📝', 'products': '📦', 'customers': '👥',
    'staff': '👨‍💼', 'branches': '🏪', 'brands': '🏷️',
    'categories': '📂', 'reports': '📊', 'settings': '⚙️',
    'roles': '🔐', 'leads': '🎯', 'marketing': '📢',
    'dashboard': '📊', 'attendance': '📅', 'salary': '💰',
    'activities': '📋', 'tasks': '✅', 'zoho': '📘'
};

// Friendly module display names
const moduleNames = {
    'zoho': 'Zoho Books'
};

// Show role selector when no role_id is provided
async function showRoleSelector() {
    document.getElementById('roleSelectorCard').classList.remove('hidden');

    try {
        const response = await apiRequest('/api/roles');
        const data = await response.json();

        if (!data.success || !data.data || data.data.length === 0) {
            document.getElementById('roleCards').innerHTML = '<p class="text-gray-500 col-span-full text-center py-4">No roles found. <a href="/admin-roles.html" class="text-purple-600 underline">Create roles first</a>.</p>';
            return;
        }

        const roles = data.data;
        document.getElementById('roleCards').innerHTML = roles.map(role => `
            <button data-action="select-role" data-id="${role.id}" class="text-left border-2 border-gray-200 rounded-lg p-4 hover:border-purple-500 hover:shadow-lg transition ${role.is_system_role ? 'bg-blue-50 border-blue-200' : ''}">
                <div class="flex justify-between items-start mb-1">
                    <h3 class="font-bold text-gray-800">${escHtml(role.display_name)}</h3>
                    <span class="px-2 py-0.5 text-xs rounded ${role.user_type === 'staff' ? 'bg-purple-100 text-purple-700' : 'bg-green-100 text-green-700'}">${escHtml(role.user_type)}</span>
                </div>
                <p class="text-sm text-gray-600">${escHtml(role.description || role.name)}</p>
            </button>
        `).join('');
    } catch (error) {
        console.error('Error loading roles:', error);
        document.getElementById('roleCards').innerHTML = '<p class="text-red-500 col-span-full text-center py-4">Failed to load roles.</p>';
    }
}

// Handle role selection from the selector cards
function selectRole(id) {
    roleId = id;
    // Update URL without reload
    const newUrl = `${window.location.pathname}?role_id=${id}`;
    history.replaceState(null, '', newUrl);
    // Hide selector, load permissions
    document.getElementById('roleSelectorCard').classList.add('hidden');
    init();
}

// Load role details and permissions
async function loadRoleDetails() {
    try {
        const response = await apiRequest(`/api/roles/${roleId}`);
        const data = await response.json();

        if (data.success) {
            const role = data.data;
            document.getElementById('roleName').textContent = role.display_name;
            document.title = `Permissions: ${role.display_name} - Quality Colours`;

            // Store current permissions
            rolePermissions = role.permissions.map(p => p.id);
            selectedPermissions = new Set(rolePermissions);
        } else {
            showNotification('Failed to load role details: ' + (data.error || ''), 'error');
        }
    } catch (error) {
        console.error('Error loading role:', error);
        showNotification('Error loading role: ' + error.message, 'error');
    }
}

// Load all permissions
async function loadAllPermissions() {
    try {
        const response = await apiRequest('/api/roles/permissions/by-module');
        const data = await response.json();

        if (data.success) {
            allPermissions = data.data;
            displayPermissions();
        } else {
            showNotification('Failed to load permissions: ' + (data.error || ''), 'error');
        }
    } catch (error) {
        console.error('Error loading permissions:', error);
        showNotification('Error loading permissions: ' + error.message, 'error');
    }
}

// Display permissions grouped by module
function displayPermissions() {
    const container = document.getElementById('permissionsContainer');
    const modules = Object.keys(allPermissions).sort();

    let totalPerms = 0;
    modules.forEach(module => {
        totalPerms += allPermissions[module].length;
    });

    document.getElementById('totalPermissions').textContent = totalPerms;
    document.getElementById('availableCount').textContent = totalPerms;
    updateSelectedCount();

    container.innerHTML = modules.map(module => {
        const permissions = allPermissions[module];
        const icon = moduleIcons[module] || '📋';
        const moduleName = moduleNames[module] || (module.charAt(0).toUpperCase() + module.slice(1).replace(/_/g, ' '));

        return `
            <div class="bg-white rounded-lg shadow-md overflow-hidden module-section" data-module="${escHtml(module)}">
                <div class="bg-gradient-to-r from-purple-50 to-indigo-50 p-4 border-b border-purple-200">
                    <div class="flex items-center justify-between">
                        <h3 class="text-lg font-bold text-gray-800 flex items-center gap-2">
                            <span>${icon}</span>
                            <span>${escHtml(moduleName)}</span>
                            <span class="text-sm font-normal text-gray-600">(${permissions.length} permissions)</span>
                        </h3>
                        <div class="flex gap-2">
                            <button data-action="select-module" class="text-sm text-purple-600 hover:text-purple-700 font-semibold">
                                Select All
                            </button>
                            <span class="text-gray-400">|</span>
                            <button data-action="deselect-module" class="text-sm text-gray-600 hover:text-gray-700 font-semibold">
                                Deselect All
                            </button>
                        </div>
                    </div>
                </div>
                <div class="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    ${permissions.map(perm => {
                        const displayName = perm.display_name || perm.description || (perm.action.charAt(0).toUpperCase() + perm.action.slice(1).replace(/_/g, ' '));
                        const desc = perm.display_name ? (perm.description || '') : '';
                        const searchText = (displayName + ' ' + (perm.description || '') + ' ' + perm.action).toLowerCase();
                        return `
                        <label class="flex items-start gap-3 p-3 rounded-lg hover:bg-gray-50 cursor-pointer permission-item" data-permission-id="${perm.id}" data-search-text="${escHtml(searchText)}">
                            <input type="checkbox"
                                   class="permission-checkbox mt-1"
                                   data-permission-id="${perm.id}"
                                   data-module="${escHtml(module)}"
                                   ${selectedPermissions.has(perm.id) ? 'checked' : ''}>
                            <div class="flex-1">
                                <p class="font-semibold text-gray-800 text-sm">${escHtml(displayName)}</p>
                                ${desc ? `<p class="text-xs text-gray-600 mt-1">${escHtml(desc)}</p>` : ''}
                            </div>
                        </label>
                    `;}).join('')}
                </div>
            </div>
        `;
    }).join('');
}

// Toggle permission
function togglePermission(permId, checked) {
    if (checked) {
        selectedPermissions.add(permId);
    } else {
        selectedPermissions.delete(permId);
    }
    updateSelectedCount();
}

// Update selected count
function updateSelectedCount() {
    document.getElementById('selectedCount').textContent = selectedPermissions.size;
}

// Select module
function selectModule(module) {
    allPermissions[module].forEach(perm => {
        selectedPermissions.add(perm.id);
        const cb = document.querySelector(`input[data-permission-id="${perm.id}"]`);
        if (cb) cb.checked = true;
    });
    updateSelectedCount();
}

// Deselect module
function deselectModule(module) {
    allPermissions[module].forEach(perm => {
        selectedPermissions.delete(perm.id);
        const cb = document.querySelector(`input[data-permission-id="${perm.id}"]`);
        if (cb) cb.checked = false;
    });
    updateSelectedCount();
}

// Select all
function selectAll() {
    Object.values(allPermissions).flat().forEach(perm => {
        selectedPermissions.add(perm.id);
        const cb = document.querySelector(`input[data-permission-id="${perm.id}"]`);
        if (cb) cb.checked = true;
    });
    updateSelectedCount();
}

// Deselect all
function deselectAll() {
    selectedPermissions.clear();
    document.querySelectorAll('.permission-checkbox').forEach(cb => cb.checked = false);
    updateSelectedCount();
}

// Search permissions
document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('searchPermissions');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            const searchTerm = e.target.value.toLowerCase();

            document.querySelectorAll('.permission-item').forEach(item => {
                const searchText = item.getAttribute('data-search-text');
                item.style.display = searchText.includes(searchTerm) ? 'flex' : 'none';
            });

            document.querySelectorAll('.module-section').forEach(section => {
                const visibleItems = section.querySelectorAll('.permission-item:not([style*="display: none"])');
                section.style.display = (visibleItems.length === 0 && searchTerm) ? 'none' : 'block';
            });
        });
    }
});

// Save permissions
async function savePermissions() {
    const permissionIds = Array.from(selectedPermissions);

    const saveButton = document.getElementById('saveBtn');
    const originalText = saveButton.textContent;
    saveButton.textContent = 'Saving...';
    saveButton.disabled = true;

    try {
        const response = await apiRequest(`/api/roles/${roleId}/permissions`, {
            method: 'PUT',
            body: JSON.stringify({ permission_ids: permissionIds })
        });

        const result = await response.json();

        if (result.success) {
            showNotification(`Permissions saved successfully! (${permissionIds.length} permissions assigned)`, 'success');
            setTimeout(() => { window.location.href = '/admin-roles.html'; }, 1500);
        } else {
            showNotification(result.error || 'Failed to save permissions', 'error');
            saveButton.textContent = originalText;
            saveButton.disabled = false;
        }
    } catch (error) {
        console.error('Error saving permissions:', error);
        showNotification('Error saving permissions: ' + error.message, 'error');
        saveButton.textContent = originalText;
        saveButton.disabled = false;
    }
}

// Show notification
function showNotification(message, type = 'info') {
    const colors = { success: 'bg-green-500', error: 'bg-red-500', info: 'bg-blue-500' };
    const notification = document.createElement('div');
    notification.className = `fixed top-4 right-4 ${colors[type]} text-white px-6 py-3 rounded-lg shadow-lg z-50 transition-opacity`;
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => {
        notification.style.opacity = '0';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Initialize
async function init() {
    if (!roleId) {
        showRoleSelector();
        return;
    }

    // Show permission editing UI
    document.getElementById('saveBtn').classList.remove('hidden');
    document.getElementById('summaryCard').classList.remove('hidden');
    document.getElementById('searchCard').classList.remove('hidden');
    document.getElementById('permissionsContainer').innerHTML = `
        <div class="text-center py-12">
            <div class="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600 mx-auto"></div>
            <p class="text-gray-600 mt-4">Loading permissions...</p>
        </div>`;

    await loadRoleDetails();
    await loadAllPermissions();
}

// ── Static handler wiring (externalized from inline on*= attributes; S9+F5 Phase E batch 10, 2026-06-25) ──
// Save Permissions header button (was onclick="savePermissions()")
document.getElementById('saveBtn').addEventListener('click', savePermissions);
// Select All button (was onclick="selectAll()")
document.getElementById('selectAllBtn').addEventListener('click', selectAll);
// Deselect All button (was onclick="deselectAll()")
document.getElementById('deselectAllBtn').addEventListener('click', deselectAll);

// Delegated dispatcher for runtime-rendered buttons (replaces inline onclick= on role cards and
// module Select/Deselect buttons, plus the per-permission checkbox onchange). One document-level
// click listener routes by data-action; a separate document-level change listener handles the
// permission checkboxes via their existing data-permission-id attribute.
document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    if (!action) return;
    if (action === 'select-role') {
        selectRole(Number(btn.getAttribute('data-id')));
    } else if (action === 'select-module') {
        const section = btn.closest('.module-section');
        if (section) selectModule(section.getAttribute('data-module'));
    } else if (action === 'deselect-module') {
        const section = btn.closest('.module-section');
        if (section) deselectModule(section.getAttribute('data-module'));
    }
});

// Permission checkbox change (was onchange="togglePermission(perm.id, this.checked)")
document.addEventListener('change', function (e) {
    const cb = e.target.closest('input.permission-checkbox[data-permission-id]');
    if (!cb) return;
    togglePermission(Number(cb.getAttribute('data-permission-id')), cb.checked);
});

init();
