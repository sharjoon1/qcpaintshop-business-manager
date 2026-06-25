// Page logic for Task Management. Externalized from the admin-tasks.html inline <script>
// (S9+F5 Phase C, 2026-06-25) so the page runs under the enforced strict CSP.
// Verbatim move of all functions; inline on*= handlers converted to addEventListener /
// data-action delegation. No logic changes, no renames, escaping helpers untouched.
        document.addEventListener('navigationLoaded', initTasksPage);
        setTimeout(initTasksPage, 1000);

        let tasksInitialized = false;
        let currentPage = 1;
        let totalPages = 1;
        let allUsers = [];

        function initTasksPage() {
            if (tasksInitialized) return;
            tasksInitialized = true;
            console.log('Initializing Tasks Management Page...');
            loadUsers();
            loadStats();
            loadTasks();
            initializeStarRating();
        }

        function getPageAuthHeaders() {
            if (window.getAuthHeaders) {
                return window.getAuthHeaders();
            }
            return {
                'Authorization': `Bearer ${localStorage.getItem('auth_token')}`,
                'Content-Type': 'application/json'
            };
        }
        // Alias for backwards compatibility - avoid overwriting window.getAuthHeaders
        const getAuthHeaders = getPageAuthHeaders;

        async function loadUsers() {
            try {
                const response = await fetch('/api/users?assignable=1', {
                    headers: getAuthHeaders()
                });

                if (response.ok) {
                    const users = await response.json();
                    allUsers = users;

                    const assignedToSelect = document.getElementById('taskAssignedTo');
                    const filterAssignedTo = document.getElementById('filterAssignedTo');

                    users.forEach(user => {
                        const option1 = new Option(`${user.full_name} (${user.username})`, user.id);
                        const option2 = new Option(`${user.full_name} (${user.username})`, user.id);
                        assignedToSelect.add(option1);
                        filterAssignedTo.add(option2);
                    });
                }
            } catch (error) {
                console.error('Error loading users:', error);
            }
        }

        async function loadStats() {
            try {
                const response = await fetch('/api/tasks/stats', {
                    headers: getAuthHeaders()
                });

                if (response.ok) {
                    const result = await response.json();
                    const stats = result.data || result;
                    document.getElementById('statTotal').textContent = stats.total || 0;
                    document.getElementById('statPending').textContent = stats.pending || 0;
                    document.getElementById('statInProgress').textContent = stats.in_progress || 0;
                    document.getElementById('statCompleted').textContent = stats.completed || 0;
                    document.getElementById('statOverdue').textContent = stats.overdue || 0;
                }
            } catch (error) {
                console.error('Error loading stats:', error);
            }
        }

        async function loadTasks() {
            try {
                const status = document.getElementById('filterStatus').value;
                const priority = document.getElementById('filterPriority').value;
                const assignedTo = document.getElementById('filterAssignedTo').value;
                const search = document.getElementById('filterSearch').value;

                const params = new URLSearchParams({
                    page: currentPage,
                    limit: 20
                });

                if (status) params.append('status', status);
                if (priority) params.append('priority', priority);
                if (assignedTo) params.append('assigned_to', assignedTo);
                if (search) params.append('search', search);

                const response = await fetch(`/api/tasks?${params}`, {
                    headers: getAuthHeaders()
                });

                if (response.ok) {
                    const data = await response.json();
                    displayTasks(data.data || []);
                    updatePagination(data.pagination || {});
                    loadStats(); // Refresh stats
                } else {
                    showError('Failed to load tasks');
                }
            } catch (error) {
                console.error('Error loading tasks:', error);
                showError('Error loading tasks');
            }
        }

        function displayTasks(tasks) {
            const tbody = document.getElementById('tasksTableBody');

            if (tasks.length === 0) {
                tbody.innerHTML = `
                    <tr>
                        <td colspan="9" class="px-4 py-8 text-center text-gray-500">
                            No tasks found. Create your first task!
                        </td>
                    </tr>
                `;
                return;
            }

            tbody.innerHTML = tasks.map(task => {
                const progress = task.progress_percentage || task.completion_percentage || 0;
                const dueDate = task.due_date ? new Date(task.due_date).toLocaleDateString() : 'N/A';
                const rating = task.rating ? '★'.repeat(task.rating) + '☆'.repeat(5 - task.rating) : 'Not rated';

                return `
                    <tr>
                        <td class="px-4 py-3 text-sm font-semibold text-gray-900">#${task.id}</td>
                        <td class="px-4 py-3">
                            <div class="font-semibold text-gray-900">${escapeHtml(task.title)}</div>
                            <div class="text-xs text-gray-500">${escapeHtml((task.task_type || task.category || '').replace('_', ' '))}</div>
                        </td>
                        <td class="px-4 py-3 text-sm text-gray-700">${escapeHtml(task.assigned_to_name || 'Unassigned')}</td>
                        <td class="px-4 py-3">
                            <span class="badge badge-${task.priority}">${task.priority}</span>
                        </td>
                        <td class="px-4 py-3">
                            <span class="badge badge-${task.status}">${task.status.replace('_', ' ')}</span>
                        </td>
                        <td class="px-4 py-3" style="min-width: 150px;">
                            <div class="flex items-center gap-2">
                                <div class="flex-1 progress-bar">
                                    <div class="progress-fill" style="width: ${progress}%"></div>
                                </div>
                                <span class="text-xs font-semibold text-gray-700">${progress}%</span>
                            </div>
                        </td>
                        <td class="px-4 py-3 text-sm text-gray-700">${dueDate}</td>
                        <td class="px-4 py-3 text-sm" style="color: #fbbf24;">${rating}</td>
                        <td class="px-4 py-3">
                            <div class="flex gap-1">
                                <button data-action="viewTask" data-id="${task.id}" class="action-btn btn-secondary" title="View Details">👁️</button>
                                <button data-action="editTask" data-id="${task.id}" class="action-btn btn-secondary" title="Edit">✏️</button>
                                ${task.status === 'completed' && !task.rating ?
                                    `<button data-action="openRateModal" data-id="${task.id}" class="action-btn btn-primary" title="Rate Task">⭐</button>` :
                                    ''}
                                <button data-action="deleteTask" data-id="${task.id}" class="action-btn" style="background: #fee2e2; color: #991b1b;" title="Delete">🗑️</button>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        function updatePagination(pagination) {
            const page = pagination.page || 1;
            const total_pages = pagination.total_pages || pagination.totalPages || 1;
            const totalItems = pagination.total || pagination.totalTasks || 0;
            const limit = pagination.limit || 20;

            currentPage = page;
            totalPages = total_pages;

            const start = totalItems > 0 ? ((page - 1) * limit) + 1 : 0;
            const end = Math.min(page * limit, totalItems);

            document.getElementById('pageInfo').textContent = `${start}-${end} of ${totalItems}`;
            document.getElementById('prevBtn').disabled = page <= 1;
            document.getElementById('nextBtn').disabled = page >= total_pages;
        }

        function changePage(delta) {
            currentPage += delta;
            if (currentPage < 1) currentPage = 1;
            if (currentPage > totalPages) currentPage = totalPages;
            loadTasks();
        }

        function openCreateModal() {
            document.getElementById('modalTitle').textContent = 'Create New Task';
            document.getElementById('taskForm').reset();
            document.getElementById('taskId').value = '';

            // Set default due date to tomorrow
            const tomorrow = new Date();
            tomorrow.setDate(tomorrow.getDate() + 1);
            document.getElementById('taskDueDate').value = tomorrow.toISOString().split('T')[0];

            openModal('taskModal');
        }

        async function editTask(id) {
            try {
                const response = await fetch(`/api/tasks/${id}`, {
                    headers: getAuthHeaders()
                });

                if (response.ok) {
                    const result = await response.json();
                    const task = result.data ? result.data.task || result.data : result;

                    document.getElementById('modalTitle').textContent = 'Edit Task';
                    document.getElementById('taskId').value = task.id;
                    document.getElementById('taskTitle').value = task.title;
                    document.getElementById('taskDescription').value = task.description || '';
                    document.getElementById('taskAssignedTo').value = task.assigned_to;
                    document.getElementById('taskPriority').value = task.priority;
                    document.getElementById('taskCategory').value = task.task_type || task.category || 'one_time';
                    document.getElementById('taskDueDate').value = task.due_date ? task.due_date.split('T')[0] : '';

                    openModal('taskModal');
                } else {
                    showError('Failed to load task details');
                }
            } catch (error) {
                console.error('Error loading task:', error);
                showError('Error loading task details');
            }
        }

        async function saveTask(event) {
            event.preventDefault();

            const taskId = document.getElementById('taskId').value;
            const taskData = {
                title: document.getElementById('taskTitle').value,
                description: document.getElementById('taskDescription').value,
                assigned_to: parseInt(document.getElementById('taskAssignedTo').value),
                priority: document.getElementById('taskPriority').value,
                task_type: document.getElementById('taskCategory').value,
                due_date: document.getElementById('taskDueDate').value
            };

            try {
                const url = taskId
                    ? `/api/tasks/${taskId}`
                    : '/api/tasks';

                const method = taskId ? 'PUT' : 'POST';

                const response = await fetch(url, {
                    method: method,
                    headers: getAuthHeaders(),
                    body: JSON.stringify(taskData)
                });

                if (response.ok) {
                    showSuccess(taskId ? 'Task updated successfully' : 'Task created successfully');
                    closeModal('taskModal');
                    loadTasks();
                } else {
                    const error = await response.json();
                    showError(error.message || error.error || 'Failed to save task');
                }
            } catch (error) {
                console.error('Error saving task:', error);
                showError('Error saving task');
            }
        }

        async function viewTask(id) {
            try {
                const response = await fetch(`/api/tasks/${id}`, {
                    headers: getAuthHeaders()
                });

                if (response.ok) {
                    const result = await response.json();
                    const task = result.data ? result.data.task || result.data : result;

                    const dueDate = task.due_date ? new Date(task.due_date).toLocaleDateString() : 'N/A';
                    const createdDate = new Date(task.created_at).toLocaleDateString();
                    const rating = task.rating ? '★'.repeat(task.rating) + '☆'.repeat(5 - task.rating) : 'Not rated';

                    document.getElementById('taskDetails').innerHTML = `
                        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                            <div>
                                <h3 class="text-2xl font-bold text-gray-900 mb-2">${escapeHtml(task.title)}</h3>
                                <p class="text-gray-600 mb-4">${escapeHtml(task.description || 'No description')}</p>
                            </div>
                            <div class="space-y-2">
                                <div class="flex justify-between">
                                    <span class="font-semibold text-gray-700">Status:</span>
                                    <span class="badge badge-${task.status}">${task.status.replace('_', ' ')}</span>
                                </div>
                                <div class="flex justify-between">
                                    <span class="font-semibold text-gray-700">Priority:</span>
                                    <span class="badge badge-${task.priority}">${task.priority}</span>
                                </div>
                                <div class="flex justify-between">
                                    <span class="font-semibold text-gray-700">Task Type:</span>
                                    <span class="text-gray-900">${(task.task_type || task.category || 'N/A').replace('_', ' ')}</span>
                                </div>
                                <div class="flex justify-between">
                                    <span class="font-semibold text-gray-700">Assigned To:</span>
                                    <span class="text-gray-900">${escapeHtml(task.assigned_to_name || 'Unassigned')}</span>
                                </div>
                                <div class="flex justify-between">
                                    <span class="font-semibold text-gray-700">Created By:</span>
                                    <span class="text-gray-900">${escapeHtml(task.created_by_name || 'N/A')}</span>
                                </div>
                                <div class="flex justify-between">
                                    <span class="font-semibold text-gray-700">Due Date:</span>
                                    <span class="text-gray-900">${dueDate}</span>
                                </div>
                                <div class="flex justify-between">
                                    <span class="font-semibold text-gray-700">Created:</span>
                                    <span class="text-gray-900">${createdDate}</span>
                                </div>
                                <div class="flex justify-between">
                                    <span class="font-semibold text-gray-700">Progress:</span>
                                    <span class="text-gray-900">${task.progress_percentage || task.completion_percentage || 0}%</span>
                                </div>
                                <div class="flex justify-between">
                                    <span class="font-semibold text-gray-700">Rating:</span>
                                    <span style="color: #fbbf24;">${rating}</span>
                                </div>
                                ${task.rating_notes ? `
                                <div class="col-span-2">
                                    <span class="font-semibold text-gray-700">Rating Notes:</span>
                                    <p class="text-gray-600 mt-1">${escapeHtml(task.rating_notes)}</p>
                                </div>
                                ` : ''}
                            </div>
                        </div>
                        <div class="progress-bar mb-2">
                            <div class="progress-fill" style="width: ${task.progress_percentage || task.completion_percentage || 0}%"></div>
                        </div>
                    `;

                    // Display updates
                    const updates = task.updates || (result.data && result.data.updates) || [];
                    if (updates.length > 0) {
                        document.getElementById('taskUpdates').innerHTML = updates.map(update => `
                            <div class="timeline-item">
                                <div class="flex justify-between items-start mb-1">
                                    <span class="font-semibold text-gray-900">${escapeHtml(update.user_name || update.updated_by_name || 'Unknown')}</span>
                                    <span class="text-xs text-gray-500">${new Date(update.created_at || update.updated_at).toLocaleString()}</span>
                                </div>
                                <p class="text-gray-600 text-sm">${escapeHtml(update.comment || 'Status/Progress updated')}</p>
                                ${update.progress_percentage !== null ?
                                    `<span class="text-xs text-purple-600 font-semibold">Progress: ${update.progress_percentage}%</span>` :
                                    ''}
                            </div>
                        `).join('');
                    } else {
                        document.getElementById('taskUpdates').innerHTML = '<p class="text-gray-500 text-sm">No updates yet</p>';
                    }

                    openModal('viewTaskModal');
                } else {
                    showError('Failed to load task details');
                }
            } catch (error) {
                console.error('Error loading task details:', error);
                showError('Error loading task details');
            }
        }

        async function deleteTask(id) {
            if (!confirm('Are you sure you want to delete this task?')) return;

            try {
                const response = await fetch(`/api/tasks/${id}`, {
                    method: 'DELETE',
                    headers: getAuthHeaders()
                });

                if (response.ok) {
                    showSuccess('Task deleted successfully');
                    loadTasks();
                } else {
                    const error = await response.json();
                    showError(error.message || error.error || 'Failed to delete task');
                }
            } catch (error) {
                console.error('Error deleting task:', error);
                showError('Error deleting task');
            }
        }

        function openRateModal(id) {
            document.getElementById('rateTaskId').value = id;
            document.getElementById('rateForm').reset();
            document.getElementById('ratingValue').value = '';

            // Reset stars
            document.querySelectorAll('#starRating .star').forEach(star => {
                star.classList.remove('active');
            });

            openModal('rateTaskModal');
        }

        function initializeStarRating() {
            const stars = document.querySelectorAll('#starRating .star');

            stars.forEach(star => {
                star.addEventListener('click', function() {
                    const value = parseInt(this.getAttribute('data-value'));
                    document.getElementById('ratingValue').value = value;

                    stars.forEach(s => {
                        const starValue = parseInt(s.getAttribute('data-value'));
                        if (starValue <= value) {
                            s.classList.add('active');
                        } else {
                            s.classList.remove('active');
                        }
                    });
                });
            });
        }

        async function submitRating(event) {
            event.preventDefault();

            const taskId = document.getElementById('rateTaskId').value;
            const rating = parseInt(document.getElementById('ratingValue').value);
            const notes = document.getElementById('ratingNotes').value;

            if (!rating) {
                showError('Please select a rating');
                return;
            }

            try {
                const response = await fetch(`/api/tasks/${taskId}/rate`, {
                    method: 'PATCH',
                    headers: getAuthHeaders(),
                    body: JSON.stringify({
                        rating: rating,
                        rating_notes: notes
                    })
                });

                if (response.ok) {
                    showSuccess('Task rated successfully');
                    closeModal('rateTaskModal');
                    loadTasks();
                } else {
                    const error = await response.json();
                    showError(error.message || error.error || 'Failed to rate task');
                }
            } catch (error) {
                console.error('Error rating task:', error);
                showError('Error rating task');
            }
        }

        function openModal(modalId) {
            document.getElementById(modalId).classList.add('active');
            document.body.style.overflow = 'hidden';
        }

        function closeModal(modalId) {
            document.getElementById(modalId).classList.remove('active');
            document.body.style.overflow = 'auto';
        }

        // Close modal when clicking outside
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', function(e) {
                if (e.target === this) {
                    closeModal(this.id);
                }
            });
        });

        function escapeHtml(text) {
            const map = {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#039;'
            };
            return text ? String(text).replace(/[&<>"']/g, m => map[m]) : '';
        }

        function showToast(message, type) {
            const existing = document.querySelector('.toast-notification');
            if (existing) existing.remove();
            const toast = document.createElement('div');
            toast.className = 'toast-notification';
            toast.style.cssText = `position:fixed;top:20px;right:20px;z-index:9999;padding:14px 20px;border-radius:10px;color:white;font-weight:600;font-size:14px;box-shadow:0 4px 20px rgba(0,0,0,0.2);transition:opacity 0.3s;max-width:400px;`;
            toast.style.background = type === 'success' ? '#10b981' : '#ef4444';
            toast.textContent = (type === 'success' ? '✓ ' : '✗ ') + message;
            document.body.appendChild(toast);
            setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 4000);
        }

        function showSuccess(message) {
            showToast(message, 'success');
        }

        function showError(message) {
            showToast(message, 'error');
        }

// ── Static handler wiring (externalized from inline on*= attributes; S9+F5 Phase C, 2026-06-25) ──
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('createTaskBtn').addEventListener('click', openCreateModal);
    document.getElementById('filterStatus').addEventListener('change', loadTasks);
    document.getElementById('filterPriority').addEventListener('change', loadTasks);
    document.getElementById('filterAssignedTo').addEventListener('change', loadTasks);
    document.getElementById('filterSearch').addEventListener('keyup', loadTasks);
    document.getElementById('prevBtn').addEventListener('click', function() { changePage(-1); });
    document.getElementById('nextBtn').addEventListener('click', function() { changePage(1); });
    document.getElementById('taskForm').addEventListener('submit', saveTask);
    document.getElementById('closeTaskModalBtn').addEventListener('click', function() { closeModal('taskModal'); });
    document.getElementById('closeViewTaskModalBtn').addEventListener('click', function() { closeModal('viewTaskModal'); });
    document.getElementById('rateForm').addEventListener('submit', submitRating);
    document.getElementById('closeRateTaskModalBtn').addEventListener('click', function() { closeModal('rateTaskModal'); });

    // Delegated runtime handler for the per-row action buttons rendered inside the
    // tasks table innerHTML (rebuilt on every load). data-action keeps it CSP-clean.
    document.addEventListener('click', function(e) {
        var btn = e.target.closest('[data-action]');
        if (!btn) return;
        var action = btn.dataset.action;
        var id = parseInt(btn.dataset.id, 10);
        if (Number.isNaN(id)) return;
        switch (action) {
            case 'viewTask':       viewTask(id); break;
            case 'editTask':       editTask(id); break;
            case 'openRateModal':  openRateModal(id); break;
            case 'deleteTask':     deleteTask(id); break;
        }
    });
});
