// admin-customer-types page logic — externalized from admin-customer-types.html (S9+F5 strict CSP).
// NON-deferred, loaded right before </body> (matches original end-of-body timing).
        let allTypes = [];
        let editingTypeId = null;

        function esc(s){if(s==null)return '';const d=document.createElement('div');d.textContent=String(s);return d.innerHTML;}

        function getAuthHeaders() {
            const token = localStorage.getItem('auth_token');
            return {
                'Content-Type': 'application/json',
                'Authorization': token ? `Bearer ${token}` : ''
            };
        }

        async function loadTypes() {
            try {
                const response = await fetch('/api/customer-types', { headers: getAuthHeaders() });
                allTypes = await response.json();

                renderTypesGrid();

                document.getElementById('loadingState').classList.add('hidden');
                document.getElementById('typesGrid').classList.remove('hidden');

            } catch (error) {
                console.error('Error loading types:', error);
                document.getElementById('loadingState').innerHTML = '<p class="text-red-600">Failed to load customer types</p>';
            }
        }

        function renderTypesGrid() {
            const grid = document.getElementById('typesGrid');

            if (allTypes.length === 0) {
                grid.innerHTML = '<p class="col-span-2 text-center py-8 text-gray-500">No customer types found</p>';
                return;
            }

            grid.innerHTML = allTypes.map(type => `
                <div class="border border-gray-200 rounded-lg p-4 hover:shadow-md transition ${type.status === 'inactive' ? 'bg-gray-50' : 'bg-white'}">
                    <div class="flex items-start justify-between mb-3">
                        <div>
                            <h3 class="font-bold text-lg text-gray-900">${esc(type.name)}</h3>
                            <p class="text-sm text-gray-600 mt-1">${type.description ? esc(type.description) : 'No description'}</p>
                        </div>
                        <span class="px-2 py-1 text-xs rounded-full ${type.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-200 text-gray-600'}">
                            ${type.status === 'active' ? '✅ Active' : '⏸️ Inactive'}
                        </span>
                    </div>

                    <div class="bg-purple-50 rounded-lg p-3 mb-3 space-y-2">
                        <div class="flex items-center justify-between">
                            <span class="text-sm text-gray-600">Default Discount:</span>
                            <span class="text-lg font-bold text-green-600">${parseFloat(type.default_discount || 0).toFixed(1)}%</span>
                        </div>
                        <div class="flex items-center justify-between">
                            <span class="text-sm text-gray-600">Price Markup:</span>
                            <span class="text-lg font-bold text-orange-600">${parseFloat(type.price_markup || 0).toFixed(1)}%</span>
                        </div>
                    </div>

                    <div class="flex gap-2">
                        <button data-action="edit-type" data-id="${type.id}" class="flex-1 px-3 py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 text-sm font-semibold">
                            ✏️ Edit
                        </button>
                        <button data-action="delete-type" data-id="${type.id}" class="flex-1 px-3 py-2 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 text-sm font-semibold">
                            🗑️ Delete
                        </button>
                    </div>
                </div>
            `).join('');
        }

        function openAddModal() {
            editingTypeId = null;
            document.getElementById('modalTitle').textContent = 'Add New Customer Type';
            document.getElementById('typeForm').reset();
            document.getElementById('typeId').value = '';
            document.getElementById('typeModal').classList.remove('hidden');
        }

        function editType(id) {
            const type = allTypes.find(t => t.id == id);
            if (!type) return;

            editingTypeId = id;
            document.getElementById('modalTitle').textContent = 'Edit Customer Type';
            document.getElementById('typeId').value = type.id;
            document.getElementById('typeName').value = type.name;
            document.getElementById('description').value = type.description || '';
            document.getElementById('defaultDiscount').value = parseFloat(type.default_discount || 0);
            document.getElementById('priceMarkup').value = parseFloat(type.price_markup || 0);
            document.getElementById('status').value = type.status;

            document.getElementById('typeModal').classList.remove('hidden');
        }

        function closeModal() {
            document.getElementById('typeModal').classList.add('hidden');
        }

        async function saveType(event) {
            event.preventDefault();

            const typeData = {
                name: document.getElementById('typeName').value,
                description: document.getElementById('description').value || null,
                default_discount: document.getElementById('defaultDiscount').value || 0,
                price_markup: document.getElementById('priceMarkup').value || 0,
                status: document.getElementById('status').value
            };

            try {
                const url = editingTypeId
                    ? `/api/customer-types/${editingTypeId}`
                    : '/api/customer-types';

                const method = editingTypeId ? 'PUT' : 'POST';

                const response = await fetch(url, {
                    method: method,
                    headers: getAuthHeaders(),
                    body: JSON.stringify(typeData)
                });

                if (response.ok) {
                    alert(editingTypeId ? 'Customer type updated successfully!' : 'Customer type added successfully!');
                    closeModal();
                    loadTypes();
                } else {
                    const error = await response.json();
                    alert('Failed to save customer type: ' + (error.error || 'Unknown error'));
                }
            } catch (error) {
                console.error('Error saving type:', error);
                alert('Error saving customer type');
            }
        }

        async function deleteType(id) {
            const type = allTypes.find(t => t.id == id);
            if (!type) return;

            if (!confirm(`Are you sure you want to delete "${type.name}"?\n\nThis action cannot be undone!`)) return;

            try {
                const response = await fetch(`/api/customer-types/${id}`, {
                    method: 'DELETE',
                    headers: getAuthHeaders()
                });

                if (response.ok) {
                    alert('Customer type deleted successfully!');
                    loadTypes();
                } else {
                    alert('Failed to delete customer type');
                }
            } catch (error) {
                console.error('Error deleting type:', error);
                alert('Error deleting customer type');
            }
        }

        // Converted from static onclick=/onsubmit= attributes (S9+F5 strict CSP):
        // openAddModal (Add button), closeModal (overlay backdrop + Cancel button), saveType (form submit, AJAX).
        document.getElementById('btnAddType').addEventListener('click', openAddModal);
        document.getElementById('modalBackdrop').addEventListener('click', closeModal);
        document.getElementById('btnCancelModal').addEventListener('click', closeModal);
        document.getElementById('typeForm').addEventListener('submit', saveType);

        // Delegated listener for runtime-rendered card buttons (converted from inline
        // onclick="editType(${id})" / onclick="deleteType(${id})" inside the grid innerHTML template).
        document.addEventListener('click', function(e) {
            const editEl = e.target.closest('[data-action="edit-type"]');
            if (editEl) { editType(editEl.dataset.id); return; }
            const delEl = e.target.closest('[data-action="delete-type"]');
            if (delEl) { deleteType(delEl.dataset.id); return; }
        });

        // Initialize
        loadTypes();
