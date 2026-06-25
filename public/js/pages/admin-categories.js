// Verbatim move of all functions from admin-categories.html inline <script> (S9+F5 Phase C,
// 2026-06-25); inline on*= handlers converted to addEventListener + data-action delegation.
// No logic changes, no renames, escaping helpers untouched.
        let categories = [];
        let editingCategoryId = null;

        function esc(s){if(s==null)return '';const d=document.createElement('div');d.textContent=String(s);return d.innerHTML;}

        // Load categories
        async function loadCategorys() {
            try {
                const response = await fetch('/api/categories', { headers: getAuthHeaders() });
                categories = await response.json();

                document.getElementById('loadingState').classList.add('hidden');

                if (categories.length === 0) {
                    document.getElementById('emptyState').classList.remove('hidden');
                    document.getElementById('categoriesTable').classList.add('hidden');
                } else {
                    document.getElementById('emptyState').classList.add('hidden');
                    document.getElementById('categoriesTable').classList.remove('hidden');
                    renderCategorys();
                }
            } catch (error) {
                console.error('Error loading categories:', error);
                alert('Failed to load categories');
            }
        }

        // Render categories table
        function renderCategorys() {
            const tbody = document.getElementById('categoriesBody');
            tbody.innerHTML = categories.map(category => `
                <tr class="hover:bg-gray-50">
                    <td class="px-4 py-3 text-sm font-medium text-gray-900">${esc(category.id)}</td>
                    <td class="px-4 py-3 text-sm font-semibold text-gray-900">${esc(category.name)}</td>
                    <td class="px-4 py-3">
                        <span class="px-3 py-1 text-xs font-semibold rounded-full ${
                            category.status === 'active'
                                ? 'bg-green-100 text-green-800'
                                : 'bg-gray-100 text-gray-800'
                        }">
                            ${category.status === 'active' ? '● Active' : '○ Inactive'}
                        </span>
                    </td>
                    <td class="px-4 py-3 text-center">
                        <button data-action="edit-category" data-id="${category.id}" class="text-blue-600 hover:text-blue-800 font-semibold text-sm mr-3">
                            Edit
                        </button>
                        <button data-action="delete-category" data-id="${category.id}" class="text-red-600 hover:text-red-800 font-semibold text-sm">
                            Delete
                        </button>
                    </td>
                </tr>
            `).join('');
        }

        // Open add modal
        function openAddModal() {
            editingCategoryId = null;
            document.getElementById('modalTitle').textContent = 'Add New Category';
            document.getElementById('categoryForm').reset();
            document.getElementById('categoryId').value = '';
            document.getElementById('categoryStatus').value = 'active';
            document.getElementById('categoryModal').classList.remove('hidden');
        }

        // Edit category
        function editCategory(id) {
            const category = categories.find(b => b.id === id);
            if (!category) return;

            editingCategoryId = id;
            document.getElementById('modalTitle').textContent = 'Edit Category';
            document.getElementById('categoryId').value = category.id;
            document.getElementById('categoryName').value = category.name;
            document.getElementById('categoryDescription').value = category.description || '';
            document.getElementById('categoryStatus').value = category.status;
            document.getElementById('categoryModal').classList.remove('hidden');
        }

        // Close modal
        function closeModal() {
            document.getElementById('categoryModal').classList.add('hidden');
            document.getElementById('categoryForm').reset();
            editingCategoryId = null;
        }

        // Save category
        async function saveCategory(event) {
            event.preventDefault();

            const token = localStorage.getItem('auth_token');
            if (!token) {
                alert('❌ Not authenticated. Please login again.');
                window.location.href = '/login.html';
                return;
            }

            const categoryData = {
                name: document.getElementById('categoryName').value.trim(),
                description: document.getElementById('categoryDescription').value.trim() || null,
                status: document.getElementById('categoryStatus').value
            };

            try {
                let response;
                if (editingCategoryId) {
                    // Update
                    response = await fetch(`/api/categories/${editingCategoryId}`, {
                        method: 'PUT',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify(categoryData)
                    });
                } else {
                    // Create
                    response = await fetch('/api/categories', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${token}`
                        },
                        body: JSON.stringify(categoryData)
                    });
                }

                const result = await response.json();

                if (response.ok && result.success) {
                    alert(`✅ Category ${editingCategoryId ? 'updated' : 'created'} successfully!`);
                    closeModal();
                    loadCategorys();
                } else {
                    const errorMsg = result.error || result.message || 'Failed to save category';
                    console.error('Save category error:', result);
                    alert(`❌ Error: ${errorMsg}`);
                }
            } catch (error) {
                console.error('Error saving category:', error);
                alert(`❌ Failed to save category: ${error.message}`);
            }
        }

        // Delete category
        async function deleteCategory(id) {
            if (!confirm('⚠️ Are you sure you want to delete this category?')) return;

            try {
                const token = localStorage.getItem('auth_token');
                const response = await fetch(`/api/categories/${id}`, {
                    method: 'DELETE',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });

                const result = await response.json();

                if (response.ok && result.success) {
                    alert('✅ Category deleted successfully!');
                    loadCategorys();
                } else {
                    alert(`❌ Failed to delete category: ${result.error || result.message}`);
                }
            } catch (error) {
                console.error('Error deleting category:', error);
                alert('❌ Failed to delete category. Please try again.');
            }
        }

        // Initialize
        loadCategorys();

// ── Static handler wiring (externalized from inline on*= attributes; S9+F5 Phase C, 2026-06-25) ──
// Add Category header button (was onclick="openAddModal()")
document.getElementById('addCategoryBtn').addEventListener('click', openAddModal);
// Add Category empty-state button (was onclick="openAddModal()")
document.getElementById('emptyAddCategoryBtn').addEventListener('click', openAddModal);
// Modal close × button (was onclick="closeModal()")
document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
// Modal Cancel button (was onclick="closeModal()")
document.getElementById('modalCancelBtn').addEventListener('click', closeModal);
// Category form save (was onsubmit="saveCategory(event)")
document.getElementById('categoryForm').addEventListener('submit', saveCategory);

// Delegated dispatcher for runtime-rendered table buttons (replaces inline
// onclick="editCategory(...)" / onclick="deleteCategory(...)"). One document-level listener
// routes by data-action.
document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-action');
    if (!action) return;
    if (action === 'edit-category') {
        editCategory(btn.getAttribute('data-id'));
    } else if (action === 'delete-category') {
        deleteCategory(btn.getAttribute('data-id'));
    }
});
