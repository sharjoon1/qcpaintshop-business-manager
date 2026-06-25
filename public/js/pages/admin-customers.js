// Page logic externalized from admin-customers.html inline <script> (S9+F5 Phase C, 2026-06-25)
// so the page runs under the enforced strict CSP. Verbatim move of all functions; inline on*=
// handlers converted to addEventListener + data-action delegation. No logic changes, no renames,
// escaping helpers untouched.
function esc(s) { if (!s) return ''; const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

let customers = [];
let branches = [];
let customerTypes = [];
let editingCustomerId = null;
let currentBranchFilter = '';

// Get auth headers
function getAuthHeaders() {
    const token = localStorage.getItem('auth_token');
    return {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
    };
}

// Load all data
async function loadData() {
    await loadBranches();
    await loadCustomerTypes();
    await loadCustomers();
}

// Load branches
async function loadBranches() {
    try {
        const response = await fetch('/api/branches', { headers: getAuthHeaders() });
        const result = await response.json();

        // Handle both response formats
        branches = result.success ? result.data : result;
        if (!Array.isArray(branches)) branches = [];

        // Populate branch filter
        const filterSelect = document.getElementById('branchFilter');
        if (filterSelect) {
            filterSelect.innerHTML = '<option value="">All Branches</option>' +
                branches.map(b => `<option value="${b.id}">${b.name} (${b.code})</option>`).join('');
        }

        // Populate branch selector in form
        const branchSelect = document.getElementById('customerBranch');
        branchSelect.innerHTML = '<option value="">-- Select Branch --</option>' +
            branches.map(b => `<option value="${b.id}">${b.name} (${b.code})</option>`).join('');
    } catch (error) {
        console.error('Error loading branches:', error);
        alert('❌ Failed to load branches. Please refresh the page.');
    }
}

// Load customer types
async function loadCustomerTypes() {
    try {
        const response = await fetch('/api/customer-types', { headers: getAuthHeaders() });
        const data = await response.json();
        customerTypes = Array.isArray(data) ? data : (data.data || []);

        // Populate customer type selector in form
        const typeSelect = document.getElementById('customerType');
        typeSelect.innerHTML = '<option value="">-- Select Type --</option>' +
            customerTypes.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    } catch (error) {
        console.error('Error loading customer types:', error);
        // Non-critical, don't alert
    }
}

// Load customers
async function loadCustomers() {
    try {
        const response = await fetch('/api/customers', { headers: getAuthHeaders() });
        customers = await response.json();

        // Add branch name to customers
        customers = customers.map(c => ({
            ...c,
            branch_name: branches.find(b => b.id === c.branch_id)?.name || 'Unknown'
        }));

        renderCustomers();
        updateStats();
    } catch (error) {
        console.error('Error loading customers:', error);
        alert('Failed to load customers');
    }
}

// Filter by branch
function filterByBranch() {
    const branchEl = document.getElementById('branchFilter');
    currentBranchFilter = branchEl ? branchEl.value : '';
    renderCustomers();
    updateStats();
}

// Update stats
function updateStats() {
    const filtered = currentBranchFilter
        ? customers.filter(c => c.branch_id == currentBranchFilter)
        : customers;

    document.getElementById('totalCustomers').textContent = filtered.length;
    document.getElementById('approvedCustomers').textContent = filtered.filter(c => c.status === 'approved').length;
    document.getElementById('pendingCustomers').textContent = filtered.filter(c => c.status === 'pending').length;

    const branch = branches.find(b => b.id == currentBranchFilter);
    document.getElementById('currentBranch').textContent = branch ? branch.name : 'All';
}

// Render customers table
function renderCustomers() {
    const tbody = document.getElementById('customersTableBody');

    const filtered = currentBranchFilter
        ? customers.filter(c => c.branch_id == currentBranchFilter)
        : customers;

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-gray-500">No customers found</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map(customer => `
        <tr class="hover:bg-gray-50">
            <td class="px-6 py-4 text-sm font-semibold text-gray-900 hide-mobile">${customer.id}</td>
            <td class="px-6 py-4 text-sm font-semibold text-gray-900">${esc(customer.name)}</td>
            <td class="px-6 py-4 text-sm text-gray-700">${esc(customer.phone) || '-'}</td>
            <td class="px-6 py-4 text-sm text-gray-700 hide-mobile">${esc(customer.email) || '-'}</td>
            <td class="px-6 py-4 text-sm text-gray-700 hide-mobile">${esc(customer.city) || '-'}</td>
            <td class="px-6 py-4 text-sm">
                <span class="px-2 py-1 bg-purple-100 text-purple-800 rounded text-xs font-semibold">${esc(customer.branch_name)}</span>
            </td>
            <td class="px-6 py-4 text-sm text-gray-700 hide-mobile">${esc(customer.gst_number) || '-'}</td>
            <td class="px-6 py-4">
                <span class="badge ${
                    customer.status === 'approved' ? 'badge-success' :
                    customer.status === 'pending' ? 'badge-warning' :
                    'badge-secondary'
                }">
                    ${customer.status === 'approved' ? '● Approved' :
                      customer.status === 'pending' ? '⏱ Pending' :
                      '○ Inactive'}
                </span>
            </td>
            <td class="px-6 py-4 text-center">
                <button data-action="edit-customer" data-id="${customer.id}" class="text-blue-600 hover:text-blue-800 font-semibold text-sm mr-3">
                    Edit
                </button>
                <button data-action="delete-customer" data-id="${customer.id}" class="text-red-600 hover:text-red-800 font-semibold text-sm">
                    Delete
                </button>
            </td>
        </tr>
    `).join('');
}

// Open add modal
function openAddModal() {
    editingCustomerId = null;
    document.getElementById('modalTitle').textContent = 'Add Customer';
    document.getElementById('customerForm').reset();
    document.getElementById('customerId').value = '';
    document.getElementById('customerStatus').value = 'pending';

    // Set default branch to current filter
    if (currentBranchFilter) {
        document.getElementById('customerBranch').value = currentBranchFilter;
    }

    document.getElementById('customerModal').classList.remove('hidden');
}

// Edit customer
function editCustomer(id) {
    const customer = customers.find(c => c.id === id);
    if (!customer) return;

    editingCustomerId = id;
    document.getElementById('modalTitle').textContent = 'Edit Customer';
    document.getElementById('customerId').value = customer.id;
    document.getElementById('customerName').value = customer.name;
    document.getElementById('customerPhone').value = customer.phone || '';
    document.getElementById('customerEmail').value = customer.email || '';
    document.getElementById('customerCity').value = customer.city || '';
    document.getElementById('customerBranch').value = customer.branch_id || '';
    document.getElementById('customerType').value = customer.customer_type_id || '';
    document.getElementById('customerGst').value = customer.gst_number || '';
    document.getElementById('customerAddress').value = customer.address || '';
    document.getElementById('customerStatus').value = customer.status;
    document.getElementById('customerModal').classList.remove('hidden');
}

// Close modal
function closeModal() {
    document.getElementById('customerModal').classList.add('hidden');
    document.getElementById('customerForm').reset();
    editingCustomerId = null;
}

// Save customer
async function saveCustomer(event) {
    event.preventDefault();

    const customerData = {
        name: document.getElementById('customerName').value.trim(),
        phone: document.getElementById('customerPhone').value.trim() || null,
        email: document.getElementById('customerEmail').value.trim() || null,
        city: document.getElementById('customerCity').value.trim() || null,
        branch_id: parseInt(document.getElementById('customerBranch').value) || null,
        customer_type_id: parseInt(document.getElementById('customerType').value) || null,
        gst_number: document.getElementById('customerGst').value.trim() || null,
        address: document.getElementById('customerAddress').value.trim() || null,
        status: document.getElementById('customerStatus').value
    };

    try {
        let response;
        if (editingCustomerId) {
            response = await fetch(`/api/customers/${editingCustomerId}`, {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify(customerData)
            });
        } else {
            response = await fetch('/api/customers', {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify(customerData)
            });
        }

        if (response.ok) {
            alert(editingCustomerId ? 'Customer updated successfully!' : 'Customer created successfully!');
            closeModal();
            loadCustomers();
        } else {
            const error = await response.json();
            alert('Error: ' + (error.message || 'Failed to save customer'));
        }
    } catch (error) {
        console.error('Error saving customer:', error);
        alert('Failed to save customer. Please try again.');
    }
}

// Delete customer
async function deleteCustomer(id) {
    if (!confirm('Are you sure you want to delete this customer?')) return;

    try {
        const response = await fetch(`/api/customers/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });

        if (response.ok) {
            alert('Customer deleted successfully!');
            loadCustomers();
        } else {
            alert('Failed to delete customer');
        }
    } catch (error) {
        console.error('Error deleting customer:', error);
        alert('Failed to delete customer. Please try again.');
    }
}

// ── Static handler wiring (externalized from inline on*= attributes; S9+F5 Phase C, 2026-06-25) ──
// Add Customer header button (was onclick="openAddModal()")
document.getElementById('addCustomerBtn').addEventListener('click', openAddModal);
// Branch filter select (was onchange="filterByBranch()")
document.getElementById('branchFilter').addEventListener('change', filterByBranch);
// Modal close × button (was onclick="closeModal()")
document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
// Modal Cancel button (was onclick="closeModal()")
document.getElementById('modalCancelBtn').addEventListener('click', closeModal);
// Customer form save (was onsubmit="saveCustomer(event)")
document.getElementById('customerForm').addEventListener('submit', saveCustomer);

// Delegated dispatcher for runtime-rendered table buttons (replaces inline
// onclick="editCustomer(...)" / onclick="deleteCustomer(...)"). One document-level listener
// routes by data-action.
document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    if (!action) return;
    if (action === 'edit-customer') {
        editCustomer(btn.getAttribute('data-id'));
    } else if (action === 'delete-customer') {
        deleteCustomer(btn.getAttribute('data-id'));
    }
});

// Initialize
loadData();
