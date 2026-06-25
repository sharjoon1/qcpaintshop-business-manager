// Page logic for Admin Branch Management. Externalized from the admin-branches.html inline
// <script> (S9+F5 Phase C, 2026-06-25) so the page runs under the enforced strict CSP.
// Verbatim move of all functions; inline on*= handlers converted to addEventListener +
// data-action delegation. No logic changes, no renames, escaping helpers untouched.
let branches = [];
let editingBranchId = null;

function escHtml(s){ if(s==null) return ''; const d=document.createElement('div'); d.textContent=String(s); return d.innerHTML; }

// Get auth headers
function getAuthHeaders() {
    const token = localStorage.getItem('auth_token');
    return {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
    };
}

// Load all branches
async function loadBranches() {
    try {
        const response = await fetch('/api/branches', { headers: getAuthHeaders() });
        const result = await response.json();

        if (result.success && result.data) {
            branches = result.data;
        } else {
            branches = [];
        }

        renderBranches();
    } catch (error) {
        console.error('Error loading branches:', error);
        alert('Failed to load branches');
    }
}

// Render branches table
function renderBranches() {
    const tbody = document.getElementById('branchesTableBody');

    if (branches.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-gray-500">No branches found</td></tr>';
        return;
    }

    tbody.innerHTML = branches.map(branch => `
        <tr class="hover:bg-gray-50">
            <td class="px-6 py-4 text-sm font-semibold text-gray-900 hidden sm:table-cell">${branch.id}</td>
            <td class="px-6 py-4 text-sm font-semibold text-gray-900">${escHtml(branch.name)}</td>
            <td class="px-6 py-4 text-sm">
                <span class="px-3 py-1 bg-purple-100 text-purple-800 rounded-full font-semibold">${escHtml(branch.code)}</span>
            </td>
            <td class="px-6 py-4 text-sm text-gray-700 hidden sm:table-cell">${escHtml(branch.city) || '-'}</td>
            <td class="px-6 py-4 text-sm text-gray-700">${escHtml(branch.phone) || '-'}</td>
            <td class="px-6 py-4 text-sm text-gray-700 hidden sm:table-cell">${branch.opened_date ? new Date(branch.opened_date).toLocaleDateString() : '-'}</td>
            <td class="px-6 py-4">
                <span class="px-3 py-1 text-xs font-semibold rounded-full ${
                    branch.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                }">
                    ${branch.status === 'active' ? '● Active' : '○ Inactive'}
                </span>
            </td>
            <td class="px-6 py-4 text-center whitespace-nowrap">
                <button data-action="edit-branch" data-id="${branch.id}" class="text-blue-600 hover:text-blue-800 font-semibold text-sm mr-3">
                    Edit
                </button>
                <button data-action="delete-branch" data-id="${branch.id}" class="text-red-600 hover:text-red-800 font-semibold text-sm">
                    Delete
                </button>
            </td>
        </tr>
    `).join('');
}

// Open add modal
function openAddModal() {
    editingBranchId = null;
    document.getElementById('modalTitle').textContent = 'Add Branch';
    document.getElementById('branchForm').reset();
    document.getElementById('branchId').value = '';
    document.getElementById('branchStatus').value = 'active';
    document.getElementById('branchModal').classList.remove('hidden');
}

// Edit branch
function editBranch(id) {
    const branch = branches.find(b => b.id === id);
    if (!branch) return;

    editingBranchId = id;
    document.getElementById('modalTitle').textContent = 'Edit Branch';
    document.getElementById('branchId').value = branch.id;
    document.getElementById('branchName').value = branch.name;
    document.getElementById('branchCode').value = branch.code;
    document.getElementById('branchCity').value = branch.city || '';
    document.getElementById('branchPhone').value = branch.phone || '';
    document.getElementById('branchAddress').value = branch.address || '';
    document.getElementById('branchOpenedDate').value = branch.opened_date || '';
    document.getElementById('branchStatus').value = branch.status;
    document.getElementById('branchLatitude').value = branch.latitude || '';
    document.getElementById('branchLongitude').value = branch.longitude || '';
    document.getElementById('branchGeoRadius').value = branch.geo_fence_radius_meters || branch.geo_fence_radius || 500;
    document.getElementById('branchModal').classList.remove('hidden');
}

// Use current location for geo-fence
function useMyLocation() {
    if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser');
        return;
    }
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            document.getElementById('branchLatitude').value = pos.coords.latitude.toFixed(8);
            document.getElementById('branchLongitude').value = pos.coords.longitude.toFixed(8);
        },
        (err) => {
            alert('Failed to get location: ' + err.message);
        },
        { enableHighAccuracy: true, timeout: 10000 }
    );
}

// Close modal
function closeModal() {
    document.getElementById('branchModal').classList.add('hidden');
    document.getElementById('branchForm').reset();
    editingBranchId = null;
}

// Save branch
async function saveBranch(event) {
    event.preventDefault();

    const latVal = document.getElementById('branchLatitude').value;
    const lngVal = document.getElementById('branchLongitude').value;
    const radiusVal = document.getElementById('branchGeoRadius').value;

    const branchData = {
        name: document.getElementById('branchName').value.trim(),
        code: document.getElementById('branchCode').value.trim().toUpperCase(),
        city: document.getElementById('branchCity').value.trim() || null,
        phone: document.getElementById('branchPhone').value.trim() || null,
        address: document.getElementById('branchAddress').value.trim() || null,
        status: document.getElementById('branchStatus').value,
        latitude: latVal ? parseFloat(latVal) : null,
        longitude: lngVal ? parseFloat(lngVal) : null,
        geo_fence_radius_meters: radiusVal ? parseInt(radiusVal) : 500
    };

    try {
        let response;
        if (editingBranchId) {
            response = await fetch(`/api/branches/${editingBranchId}`, {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify(branchData)
            });
        } else {
            response = await fetch('/api/branches', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify(branchData)
            });
        }

        if (response.ok) {
            alert(editingBranchId ? 'Branch updated successfully!' : 'Branch created successfully!');
            closeModal();
            loadBranches();
        } else {
            const error = await response.json();
            alert('Error: ' + (error.message || 'Failed to save branch'));
        }
    } catch (error) {
        console.error('Error saving branch:', error);
        alert('Failed to save branch. Please try again.');
    }
}

// Delete branch
async function deleteBranch(id) {
    const branch = branches.find(b => b.id === id);
    if (!branch) return;

    if (!confirm(`Are you sure you want to delete "${branch.name}" branch?\n\nThis action cannot be undone!`)) return;

    try {
        const response = await fetch(`/api/branches/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });

        if (response.ok) {
            alert('Branch deleted successfully!');
            loadBranches();
        } else {
            const error = await response.json();
            alert('Failed to delete branch: ' + (error.message || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error deleting branch:', error);
        alert('Failed to delete branch. Please try again.');
    }
}

// Initialize
loadBranches();

// ── Static handler wiring (externalized from inline on*= attributes; S9+F5 Phase C, 2026-06-25) ──
// Add Branch header button (was onclick="openAddModal()")
document.getElementById('addBranchBtn').addEventListener('click', openAddModal);
// Modal close × button (was onclick="closeModal()")
document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
// Modal Cancel button (was onclick="closeModal()")
document.getElementById('modalCancelBtn').addEventListener('click', closeModal);
// Use My Location button (was onclick="useMyLocation()")
document.getElementById('useMyLocationBtn').addEventListener('click', useMyLocation);
// Branch form save (was onsubmit="saveBranch(event)")
document.getElementById('branchForm').addEventListener('submit', saveBranch);

// Delegated dispatcher for runtime-rendered table buttons (replaces inline
// onclick="editBranch(...)" / onclick="deleteBranch(...)"). One document-level listener
// routes by data-action.
document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    if (!action) return;
    if (action === 'edit-branch') {
        editBranch(btn.getAttribute('data-id'));
    } else if (action === 'delete-branch') {
        deleteBranch(btn.getAttribute('data-id'));
    }
});
