// Page logic externalized from staff/tasks.html (S9+F5 Phase C, strict CSP).
// Verbatim move of the original inline page-logic <script>, plus:
//   - runtime-injected onclick handlers in the createTaskCard() template literal converted
//     to data-action attributes + a single delegated document-level click listener;
//   - static inline on*= attributes (onclick/oninput) in the HTML converted to addEventListener
//     wiring appended at the end of this file.
// No business logic changed; escaping helpers (escapeHtml) untouched.
        let allTasks = [];
        let currentTaskId = null;

        // Load tasks on page load
        document.addEventListener('DOMContentLoaded', function() {
            loadTasks();
        });

        // Load tasks from API
        async function loadTasks() {
            try {
                const status = document.getElementById('filter-status').value;
                const priority = document.getElementById('filter-priority').value;

                let url = '/api/tasks/my-tasks?';
                if (status) url += `status=${status}&`;
                if (priority) url += `priority=${priority}&`;

                const response = await fetch(url, {
                    headers: getAuthHeaders()
                });

                if (!response.ok) {
                    throw new Error('Failed to load tasks');
                }

                const data = await response.json();
                allTasks = data.data || [];

                displayTasks(allTasks);
                updateSummary(allTasks);
            } catch (error) {
                console.error('Error loading tasks:', error);
                alert('Failed to load tasks. Please try again.');
            }
        }

        // Display tasks in grid
        function displayTasks(tasks) {
            const container = document.getElementById('tasks-container');
            const emptyState = document.getElementById('empty-state');

            if (tasks.length === 0) {
                container.innerHTML = '';
                emptyState.classList.remove('hidden');
                return;
            }

            emptyState.classList.add('hidden');
            container.innerHTML = tasks.map(task => createTaskCard(task)).join('');
        }

        // Create task card HTML
        function createTaskCard(task) {
            const isOverdue = task.status !== 'completed' && new Date(task.due_date) < new Date();
            const borderColor = isOverdue ? 'border-l-4 border-red-500' :
                               task.status === 'completed' ? 'border-l-4 border-green-500' :
                               'border-l-4 border-teal-500';

            const statusColors = {
                'pending': 'bg-yellow-100 text-yellow-800',
                'in_progress': 'bg-blue-100 text-blue-800',
                'completed': 'bg-green-100 text-green-800'
            };

            const priorityColors = {
                'low': 'bg-gray-100 text-gray-800',
                'medium': 'bg-blue-100 text-blue-800',
                'high': 'bg-orange-100 text-orange-800',
                'urgent': 'bg-red-100 text-red-800'
            };

            const dueDate = new Date(task.due_date).toLocaleDateString('en-IN', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });

            const description = task.description && task.description.length > 100
                ? task.description.substring(0, 100) + '...'
                : task.description || 'No description';

            return `
                <div class="task-card bg-white rounded-lg shadow ${borderColor} p-5 cursor-pointer" data-action="open-task" data-id="${task.id}">
                    <div class="flex justify-between items-start mb-3">
                        <h3 class="text-lg font-semibold text-gray-800 flex-1">${escapeHtml(task.title)}</h3>
                        ${isOverdue ? '<span class="text-red-600 text-sm font-semibold ml-2">OVERDUE</span>' : ''}
                    </div>

                    <p class="text-gray-600 text-sm mb-4">${escapeHtml(description)}</p>

                    <div class="flex flex-wrap gap-2 mb-4">
                        <span class="px-2 py-1 rounded-full text-xs font-semibold ${statusColors[task.status]}">
                            ${task.status.replace('_', ' ').toUpperCase()}
                        </span>
                        <span class="px-2 py-1 rounded-full text-xs font-semibold ${priorityColors[task.priority]}">
                            ${task.priority.toUpperCase()}
                        </span>
                    </div>

                    <div class="mb-3">
                        <div class="flex justify-between items-center mb-1">
                            <span class="text-xs text-gray-500">Progress</span>
                            <span class="text-xs font-semibold text-teal-600">${task.progress_percentage || task.completion_percentage || 0}%</span>
                        </div>
                        <div class="w-full bg-gray-200 rounded-full h-2">
                            <div class="progress-bar bg-gradient-to-r from-teal-600 to-teal-700 h-2 rounded-full" style="width: ${task.progress_percentage || task.completion_percentage || 0}%"></div>
                        </div>
                    </div>

                    <div class="flex justify-between items-center text-sm text-gray-500">
                        <div class="flex items-center">
                            <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path>
                            </svg>
                            ${dueDate}
                        </div>
                        <button data-action="view-task" data-id="${task.id}" class="text-teal-600 hover:text-teal-700 font-medium">
                            View Details →
                        </button>
                    </div>
                </div>
            `;
        }

        // Update summary cards
        function updateSummary(tasks) {
            const total = tasks.length;
            const inProgress = tasks.filter(t => t.status === 'in_progress').length;

            const today = new Date();
            today.setHours(0, 0, 0, 0);
            const completedToday = tasks.filter(t => {
                if (t.status !== 'completed' || !t.completed_at) return false;
                const completedDate = new Date(t.completed_at);
                completedDate.setHours(0, 0, 0, 0);
                return completedDate.getTime() === today.getTime();
            }).length;

            const overdue = tasks.filter(t => {
                return t.status !== 'completed' && new Date(t.due_date) < new Date();
            }).length;

            document.getElementById('total-tasks').textContent = total;
            document.getElementById('in-progress-tasks').textContent = inProgress;
            document.getElementById('completed-today').textContent = completedToday;
            document.getElementById('overdue-tasks').textContent = overdue;
        }

        // Open task detail modal
        async function openTaskDetail(taskId) {
            currentTaskId = taskId;

            try {
                const response = await fetch(`/api/tasks/${taskId}`, {
                    headers: getAuthHeaders()
                });

                if (!response.ok) {
                    throw new Error('Failed to load task details');
                }

                const result = await response.json();
                const taskData = result.data || result;
                const task = taskData.task || taskData;

                // Populate modal
                document.getElementById('detail-title').textContent = task.title;
                document.getElementById('detail-description').textContent = task.description || 'No description';

                const dueDate = new Date(task.due_date).toLocaleDateString('en-IN', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric'
                });
                document.getElementById('detail-due-date').textContent = dueDate;
                document.getElementById('detail-progress').textContent = `${task.progress_percentage || task.completion_percentage || 0}%`;
                document.getElementById('detail-created-by').textContent = task.assigned_by_name || task.creator_name || 'Unknown';

                // Status badge
                const statusColors = {
                    'pending': 'bg-yellow-100 text-yellow-800',
                    'in_progress': 'bg-blue-100 text-blue-800',
                    'completed': 'bg-green-100 text-green-800'
                };
                const statusBadge = document.getElementById('detail-status-badge');
                statusBadge.textContent = task.status.replace('_', ' ').toUpperCase();
                statusBadge.className = `px-3 py-1 rounded-full text-sm font-semibold ${statusColors[task.status]}`;

                // Priority badge
                const priorityColors = {
                    'low': 'bg-gray-100 text-gray-800',
                    'medium': 'bg-blue-100 text-blue-800',
                    'high': 'bg-orange-100 text-orange-800',
                    'urgent': 'bg-red-100 text-red-800'
                };
                const priorityBadge = document.getElementById('detail-priority-badge');
                priorityBadge.textContent = task.priority.toUpperCase();
                priorityBadge.className = `px-3 py-1 rounded-full text-sm font-semibold ${priorityColors[task.priority]}`;

                // Progress bar
                const progress = task.progress_percentage || task.completion_percentage || 0;
                document.getElementById('detail-progress-percent').textContent = `${progress}%`;
                document.getElementById('detail-progress-bar').style.width = `${progress}%`;

                // Show/hide action buttons based on status
                const startBtn = document.getElementById('start-task-btn');
                const completeBtn = document.getElementById('complete-task-btn');

                if (task.status === 'completed') {
                    startBtn.classList.add('hidden');
                    completeBtn.classList.add('hidden');
                } else if (task.status === 'in_progress') {
                    startBtn.classList.add('hidden');
                    completeBtn.classList.remove('hidden');
                } else {
                    startBtn.classList.remove('hidden');
                    completeBtn.classList.remove('hidden');
                }

                // Load updates
                displayUpdates(taskData.updates || []);

                // Show modal
                document.getElementById('task-detail-modal').classList.add('show');
            } catch (error) {
                console.error('Error loading task details:', error);
                alert('Failed to load task details. Please try again.');
            }
        }

        // Display updates timeline
        function displayUpdates(updates) {
            const timeline = document.getElementById('updates-timeline');
            const noUpdates = document.getElementById('no-updates');

            if (updates.length === 0) {
                timeline.innerHTML = '';
                noUpdates.classList.remove('hidden');
                return;
            }

            noUpdates.classList.add('hidden');
            timeline.innerHTML = updates.map(update => {
                const date = new Date(update.created_at).toLocaleDateString('en-IN', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                });

                let content = '';
                if (update.comment) {
                    content = `<p class="text-gray-700">${escapeHtml(update.comment)}</p>`;
                }
                if (update.progress_percentage !== null && update.progress_percentage !== undefined) {
                    content += `<p class="text-sm text-teal-600 font-medium mt-1">Progress updated to ${update.progress_percentage}%</p>`;
                }

                return `
                    <div class="timeline-item relative pl-6 pb-4">
                        <div class="absolute left-0 top-1 w-3 h-3 bg-teal-600 rounded-full"></div>
                        <div class="bg-gray-50 rounded-lg p-3">
                            <div class="flex justify-between items-start mb-2">
                                <span class="font-medium text-gray-800">${escapeHtml(update.user_name || 'Unknown')}</span>
                                <span class="text-xs text-gray-500">${date}</span>
                            </div>
                            ${content}
                        </div>
                    </div>
                `;
            }).join('');
        }

        // Close task detail modal
        function closeTaskDetailModal() {
            document.getElementById('task-detail-modal').classList.remove('show');
            currentTaskId = null;
        }

        // Update task status
        async function updateTaskStatus(newStatus) {
            if (!currentTaskId) return;

            const confirmMessages = {
                'in_progress': 'Start working on this task?',
                'completed': 'Mark this task as completed?'
            };

            if (!confirm(confirmMessages[newStatus])) {
                return;
            }

            try {
                const response = await fetch(`/api/tasks/${currentTaskId}/status`, {
                    method: 'PATCH',
                    headers: {
                        ...getAuthHeaders(),
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ status: newStatus })
                });

                if (!response.ok) {
                    throw new Error('Failed to update status');
                }

                alert('Task status updated successfully!');
                closeTaskDetailModal();
                loadTasks();
            } catch (error) {
                console.error('Error updating status:', error);
                alert('Failed to update task status. Please try again.');
            }
        }

        // Open add update modal
        function openAddUpdateModal() {
            document.getElementById('update-comment').value = '';
            document.getElementById('update-progress').value = '0';
            document.getElementById('progress-value').textContent = '0%';
            document.getElementById('add-update-modal').classList.add('show');
        }

        // Close add update modal
        function closeAddUpdateModal() {
            document.getElementById('add-update-modal').classList.remove('show');
        }

        // Utility function to escape HTML
        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        // === Static handler wiring (converted from inline on*= attributes in tasks.html) ===

        // "Apply Filters" button (was onclick="loadTasks()")
        var applyFiltersBtn = document.getElementById('apply-filters-btn');
        if (applyFiltersBtn) applyFiltersBtn.addEventListener('click', loadTasks);

        // Task detail modal "Close ×" button (was onclick="closeTaskDetailModal()")
        var closeDetailBtn = document.getElementById('close-task-detail-btn');
        if (closeDetailBtn) closeDetailBtn.addEventListener('click', closeTaskDetailModal);

        // "Start Working" button (was onclick="updateTaskStatus('in_progress')")
        var startTaskBtn = document.getElementById('start-task-btn');
        if (startTaskBtn) startTaskBtn.addEventListener('click', function () { updateTaskStatus('in_progress'); });

        // "Mark Complete" button (was onclick="updateTaskStatus('completed')")
        var completeTaskBtn = document.getElementById('complete-task-btn');
        if (completeTaskBtn) completeTaskBtn.addEventListener('click', function () { updateTaskStatus('completed'); });

        // "Add Update" button (was onclick="openAddUpdateModal()")
        var addUpdateBtn = document.getElementById('add-update-btn');
        if (addUpdateBtn) addUpdateBtn.addEventListener('click', openAddUpdateModal);

        // Add-update modal "Close ×" button (was onclick="closeAddUpdateModal()")
        var closeUpdateModalXBtn = document.getElementById('close-add-update-modal-btn');
        if (closeUpdateModalXBtn) closeUpdateModalXBtn.addEventListener('click', closeAddUpdateModal);

        // Update form "Cancel" button (was onclick="closeAddUpdateModal()")
        var cancelUpdateBtn = document.getElementById('cancel-update-btn');
        if (cancelUpdateBtn) cancelUpdateBtn.addEventListener('click', closeAddUpdateModal);

        // Progress range slider (was oninput="document.getElementById('progress-value').textContent = this.value + '%'")
        var updateProgressInput = document.getElementById('update-progress');
        if (updateProgressInput) updateProgressInput.addEventListener('input', function () {
            document.getElementById('progress-value').textContent = this.value + '%';
        });

        // Update form submit (was an inline addEventListener in the original script; preserved here)
        var updateForm = document.getElementById('update-form');
        if (updateForm) updateForm.addEventListener('submit', async function(e) {
            e.preventDefault();

            if (!currentTaskId) return;

            const comment = document.getElementById('update-comment').value.trim();
            const progress = parseInt(document.getElementById('update-progress').value);

            if (!comment && progress === 0) {
                alert('Please enter a comment or update the progress');
                return;
            }

            try {
                const response = await fetch(`/api/tasks/${currentTaskId}/update`, {
                    method: 'POST',
                    headers: {
                        ...getAuthHeaders(),
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        comment: comment || null,
                        progress_percentage: progress
                    })
                });

                if (!response.ok) {
                    throw new Error('Failed to add update');
                }

                alert('Update added successfully!');
                closeAddUpdateModal();
                openTaskDetail(currentTaskId); // Reload task details
                loadTasks(); // Reload task list
            } catch (error) {
                console.error('Error adding update:', error);
                alert('Failed to add update. Please try again.');
            }
        });

        // Close modals when clicking outside
        window.addEventListener('click', function(event) {
            if (event.target.classList.contains('modal')) {
                event.target.classList.remove('show');
            }
        });

        // === Delegated click listener for runtime-injected data-action elements ===
        // Replaces the former inline onclick handlers inside the createTaskCard() template:
        //   card div   was onclick="openTaskDetail(${task.id})"
        //   View btn   was onclick="event.stopPropagation(); openTaskDetail(${task.id})"
        // closest('[data-action]') returns the innermost data-action element, so a click on
        // the View Details button resolves to the button (not the card) — replicating the
        // original event.stopPropagation() behavior without an explicit stopPropagation call.
        document.addEventListener('click', function (ev) {
            var t = ev.target instanceof Element ? ev.target.closest('[data-action]') : null;
            if (!t) return;
            var action = t.getAttribute('data-action');
            if (action === 'open-task' || action === 'view-task') {
                var id = t.getAttribute('data-id');
                if (id != null) openTaskDetail(id);
            }
        });
