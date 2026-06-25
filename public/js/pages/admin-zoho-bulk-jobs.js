// Page logic externalized from admin-zoho-bulk-jobs.html inline <script> (S9+F5 Phase E batch 10,
// 2026-06-25) so the page runs under the enforced strict CSP. Verbatim move of all functions;
// inline on*= handlers converted to addEventListener + data-action delegation. No logic changes,
// no renames, escaping helpers untouched.
    // --- State ---
    let jobs = [];
    let expandedJobId = null;
    let expandedJobDetail = null;
    let pollInterval = null;

    // --- Helpers ---
    function formatDate(dateStr) {
        if (!dateStr) return '--';
        var d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    }

    function formatDateTime(dateStr) {
        if (!dateStr) return '--';
        var d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) +
            ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    }

    function formatRelativeTime(dateStr) {
        if (!dateStr) return '--';
        var d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        var now = new Date();
        var diffMs = now - d;
        var diffMin = Math.floor(diffMs / 60000);
        var diffHr = Math.floor(diffMs / 3600000);
        var diffDay = Math.floor(diffMs / 86400000);

        if (diffMin < 1) return 'Just now';
        if (diffMin < 60) return diffMin + 'm ago';
        if (diffHr < 24) return diffHr + 'h ago';
        if (diffDay < 7) return diffDay + 'd ago';
        return formatDate(dateStr);
    }

    function escapeHtml(str) {
        if (!str) return '';
        var div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function getProgressPercent(job) {
        var total = parseInt(job.total_items) || 0;
        var processed = parseInt(job.processed_items) || 0;
        if (total === 0) return 0;
        return Math.min(100, Math.round((processed / total) * 100));
    }

    function getStatusBadge(status) {
        var s = (status || 'pending').toLowerCase();
        var html = '<span class="badge badge-' + s + '">';
        if (s === 'processing') {
            html += '<span class="pulse-dot"></span>';
        }
        html += s.charAt(0).toUpperCase() + s.slice(1);
        html += '</span>';
        return html;
    }

    function getItemStatusBadge(status) {
        var s = (status || 'pending').toLowerCase();
        return '<span class="item-badge item-badge-' + s + '">' + s.charAt(0).toUpperCase() + s.slice(1) + '</span>';
    }

    function getProgressBarClass(status) {
        var s = (status || '').toLowerCase();
        if (s === 'completed') return 'completed';
        if (s === 'failed') return 'failed';
        return '';
    }

    // --- Toast ---
    function showToast(message, type) {
        var toast = document.getElementById('toast');
        toast.textContent = message;
        toast.className = 'toast toast-' + (type || 'info') + ' show';
        setTimeout(function() {
            toast.classList.remove('show');
        }, 3500);
    }

    // --- Confirm Dialog ---
    var pendingConfirmAction = null;

    function showConfirmDialog(title, message, btnText, btnColor, action) {
        document.getElementById('confirmTitle').textContent = title;
        document.getElementById('confirmMessage').textContent = message;
        var actionBtn = document.getElementById('confirmActionBtn');
        actionBtn.textContent = btnText;
        actionBtn.className = 'px-4 py-2 text-sm font-medium text-white rounded-lg transition ' + btnColor;
        pendingConfirmAction = action;
        actionBtn.onclick = function() {
            closeConfirmDialog();
            if (pendingConfirmAction) pendingConfirmAction();
        };
        document.getElementById('confirmOverlay').classList.remove('hidden');
    }

    function closeConfirmDialog() {
        document.getElementById('confirmOverlay').classList.add('hidden');
        pendingConfirmAction = null;
    }

    // --- API: Load Jobs ---
    async function loadJobs() {
        var refreshIcon = document.getElementById('refreshIcon');
        refreshIcon.classList.add('animate-spin');

        try {
            var response = await fetch('/api/zoho/items/bulk-jobs', {
                headers: getAuthHeaders()
            });

            if (response.status === 401) {
                window.location.href = '/login.html';
                return;
            }

            if (!response.ok) throw new Error('Failed to load bulk jobs');

            var result = await response.json();

            if (result.success) {
                jobs = result.data || [];
            } else {
                jobs = [];
            }

            updateStats();
            renderJobs();
            managePollInterval();
        } catch (error) {
            console.error('Error loading bulk jobs:', error);
            showToast('Failed to load bulk jobs', 'error');
        } finally {
            refreshIcon.classList.remove('animate-spin');
            document.getElementById('loadingState').classList.add('hidden');
        }
    }

    // --- Update summary stats ---
    function updateStats() {
        var total = jobs.length;
        var processing = 0, completed = 0, failed = 0, pending = 0;

        jobs.forEach(function(job) {
            var s = (job.status || '').toLowerCase();
            if (s === 'processing') processing++;
            else if (s === 'completed') completed++;
            else if (s === 'failed') failed++;
            else if (s === 'pending') pending++;
        });

        document.getElementById('statTotal').textContent = total;
        document.getElementById('statProcessing').textContent = processing;
        document.getElementById('statCompleted').textContent = completed;
        document.getElementById('statFailed').textContent = failed;
        document.getElementById('statPending').textContent = pending;
    }

    // --- Render Jobs ---
    function renderJobs() {
        var container = document.getElementById('jobsList');
        var emptyState = document.getElementById('emptyState');

        if (jobs.length === 0) {
            container.classList.add('hidden');
            emptyState.classList.remove('hidden');
            return;
        }

        emptyState.classList.add('hidden');
        container.classList.remove('hidden');

        container.innerHTML = jobs.map(function(job) {
            var percent = getProgressPercent(job);
            var total = parseInt(job.total_items) || 0;
            var processed = parseInt(job.processed_items) || 0;
            var failedCount = parseInt(job.failed_items) || 0;
            var status = (job.status || 'pending').toLowerCase();
            var isExpanded = expandedJobId === job.id;
            var progressClass = getProgressBarClass(status);

            var html = '<div class="job-card" id="job-' + job.id + '">';

            // Header section (clickable)
            html += '<div class="job-card-header" data-action="toggle-job" data-id="' + job.id + '">';

            // Top row: type + status + chevron
            html += '<div class="flex items-center justify-between mb-3">';
            html += '<div class="flex items-center gap-3">';
            html += '<div class="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style="background: linear-gradient(135deg, #667eea, #764ba2);">';
            html += '<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>';
            html += '</div>';
            html += '<div>';
            html += '<div class="font-bold text-gray-800 text-sm">' + escapeHtml(job.type || 'Bulk Update') + '</div>';
            html += '<div class="text-xs text-gray-500">Job #' + job.id + '</div>';
            html += '</div>';
            html += '</div>'; // end left side

            html += '<div class="flex items-center gap-3">';
            html += getStatusBadge(status);
            html += '<svg class="w-5 h-5 text-gray-400 chevron-icon' + (isExpanded ? ' rotated' : '') + '" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>';
            html += '</div>';
            html += '</div>'; // end top row

            // Progress bar
            html += '<div class="mb-2">';
            html += '<div class="flex items-center justify-between mb-1">';
            html += '<span class="text-xs font-medium text-gray-600">' + percent + '% complete</span>';
            html += '<span class="text-xs text-gray-500">' + processed + ' / ' + total + ' items</span>';
            html += '</div>';
            html += '<div class="progress-bar-bg">';
            html += '<div class="progress-bar-fill ' + progressClass + '" style="width: ' + percent + '%;"></div>';
            html += '</div>';
            html += '</div>';

            // Counts row
            html += '<div class="flex flex-wrap items-center gap-4 text-xs">';
            html += '<div class="flex items-center gap-1.5">';
            html += '<span class="w-2 h-2 rounded-full bg-green-400"></span>';
            html += '<span class="text-gray-600">Processed: <strong class="text-gray-800">' + processed + '</strong></span>';
            html += '</div>';
            if (failedCount > 0) {
                html += '<div class="flex items-center gap-1.5">';
                html += '<span class="w-2 h-2 rounded-full bg-red-400"></span>';
                html += '<span class="text-gray-600">Failed: <strong class="text-red-700">' + failedCount + '</strong></span>';
                html += '</div>';
            }
            if (job.created_by_name) {
                html += '<div class="flex items-center gap-1.5">';
                html += '<svg class="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>';
                html += '<span class="text-gray-600">' + escapeHtml(job.created_by_name) + '</span>';
                html += '</div>';
            }
            html += '<div class="flex items-center gap-1.5 ml-auto">';
            html += '<svg class="w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>';
            html += '<span class="text-gray-500">' + formatRelativeTime(job.created_at) + '</span>';
            html += '</div>';
            html += '</div>';

            // Actions row
            var hasActions = (status === 'pending' || status === 'processing' || status === 'failed');
            if (hasActions) {
                html += '<div class="flex items-center gap-2 mt-3 pt-3 border-t border-gray-100">';
                if (status === 'pending' || status === 'processing') {
                    html += '<button data-action="confirm-cancel" data-id="' + job.id + '" class="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-yellow-700 bg-yellow-50 hover:bg-yellow-100 border border-yellow-200 rounded-lg transition">';
                    html += '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>';
                    html += 'Cancel Job';
                    html += '</button>';
                }
                if (status === 'failed') {
                    html += '<button data-action="confirm-retry" data-id="' + job.id + '" class="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg transition">';
                    html += '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>';
                    html += 'Retry Job';
                    html += '</button>';
                }
                html += '</div>';
            }

            html += '</div>'; // end job-card-header

            // Detail section (expanded)
            if (isExpanded) {
                html += renderJobDetail();
            }

            html += '</div>'; // end job-card
            return html;
        }).join('');
    }

    // --- Render Job Detail ---
    function renderJobDetail() {
        if (!expandedJobDetail) {
            return '<div class="job-card-detail"><div class="flex items-center justify-center py-6"><svg class="w-5 h-5 animate-spin text-indigo-500 mr-2" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg><span class="text-sm text-gray-500">Loading details...</span></div></div>';
        }

        var job = expandedJobDetail;
        var items = job.items || [];

        var html = '<div class="job-card-detail">';

        // Job metadata
        html += '<div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">';
        html += '<div>';
        html += '<div class="text-xs font-semibold text-gray-500 uppercase mb-0.5">Created</div>';
        html += '<div class="text-sm text-gray-800">' + formatDateTime(job.created_at) + '</div>';
        html += '</div>';
        html += '<div>';
        html += '<div class="text-xs font-semibold text-gray-500 uppercase mb-0.5">Started</div>';
        html += '<div class="text-sm text-gray-800">' + formatDateTime(job.started_at) + '</div>';
        html += '</div>';
        html += '<div>';
        html += '<div class="text-xs font-semibold text-gray-500 uppercase mb-0.5">Completed</div>';
        html += '<div class="text-sm text-gray-800">' + formatDateTime(job.completed_at) + '</div>';
        html += '</div>';
        html += '</div>';

        // Items table
        if (items.length > 0) {
            html += '<div class="text-xs font-semibold text-gray-500 uppercase mb-2">Item Details (' + items.length + ' items)</div>';
            html += '<div class="overflow-x-auto border rounded-lg">';
            html += '<table class="detail-table">';
            html += '<thead><tr>';
            html += '<th>Item Name</th>';
            html += '<th>Status</th>';
            html += '<th>Error Message</th>';
            html += '<th class="text-center">Attempts</th>';
            html += '</tr></thead>';
            html += '<tbody>';

            items.forEach(function(item) {
                html += '<tr>';
                html += '<td class="font-medium">' + escapeHtml(item.item_name || item.name || '--') + '</td>';
                html += '<td>' + getItemStatusBadge(item.status) + '</td>';
                html += '<td class="text-xs">';
                if (item.error_message) {
                    html += '<span class="text-red-600">' + escapeHtml(item.error_message) + '</span>';
                } else {
                    html += '<span class="text-gray-400">--</span>';
                }
                html += '</td>';
                html += '<td class="text-center">' + (item.attempts != null ? item.attempts : '--') + '</td>';
                html += '</tr>';
            });

            html += '</tbody></table>';
            html += '</div>';
        } else {
            html += '<div class="text-center py-4 text-sm text-gray-400">No item details available</div>';
        }

        html += '</div>';
        return html;
    }

    // --- Toggle Job Detail ---
    async function toggleJobDetail(jobId) {
        if (expandedJobId === jobId) {
            // Collapse
            expandedJobId = null;
            expandedJobDetail = null;
            renderJobs();
            return;
        }

        // Expand
        expandedJobId = jobId;
        expandedJobDetail = null;
        renderJobs(); // show loading state

        try {
            var response = await fetch('/api/zoho/items/bulk-jobs/' + jobId, {
                headers: getAuthHeaders()
            });

            if (response.status === 401) {
                window.location.href = '/login.html';
                return;
            }

            if (!response.ok) throw new Error('Failed to load job detail');

            var result = await response.json();

            if (result.success && result.data) {
                expandedJobDetail = result.data;
            } else {
                expandedJobDetail = { items: [] };
            }

            renderJobs();
        } catch (error) {
            console.error('Error loading job detail:', error);
            showToast('Failed to load job details', 'error');
            expandedJobId = null;
            expandedJobDetail = null;
            renderJobs();
        }
    }

    // --- Cancel Job ---
    function confirmCancelJob(jobId) {
        showConfirmDialog(
            'Cancel Job',
            'Are you sure you want to cancel this bulk job? Any items not yet processed will be skipped.',
            'Cancel Job',
            'bg-yellow-600 hover:bg-yellow-700',
            function() { cancelJob(jobId); }
        );
    }

    async function cancelJob(jobId) {
        try {
            var response = await fetch('/api/zoho/items/bulk-jobs/' + jobId + '/cancel', {
                method: 'POST',
                headers: getAuthHeaders()
            });

            if (response.status === 401) {
                window.location.href = '/login.html';
                return;
            }

            var result = await response.json();

            if (result.success) {
                showToast('Job cancelled successfully', 'success');
                loadJobs();
            } else {
                showToast(result.message || 'Failed to cancel job', 'error');
            }
        } catch (error) {
            console.error('Error cancelling job:', error);
            showToast('Failed to cancel job', 'error');
        }
    }

    // --- Retry Job ---
    function confirmRetryJob(jobId) {
        showConfirmDialog(
            'Retry Job',
            'This will retry all failed items in this bulk job. Do you want to continue?',
            'Retry Job',
            'bg-indigo-600 hover:bg-indigo-700',
            function() { retryJob(jobId); }
        );
    }

    async function retryJob(jobId) {
        try {
            var response = await fetch('/api/zoho/items/bulk-jobs/' + jobId + '/retry', {
                method: 'POST',
                headers: getAuthHeaders()
            });

            if (response.status === 401) {
                window.location.href = '/login.html';
                return;
            }

            var result = await response.json();

            if (result.success) {
                showToast('Job retry started', 'success');
                // Reset expanded detail since job state changed
                if (expandedJobId === jobId) {
                    expandedJobDetail = null;
                }
                loadJobs();
            } else {
                showToast(result.message || 'Failed to retry job', 'error');
            }
        } catch (error) {
            console.error('Error retrying job:', error);
            showToast('Failed to retry job', 'error');
        }
    }

    // --- Auto-Refresh Polling (reduced from 5s to 15s to save API overhead) ---
    var pollStartTime = null;
    var maxPollDuration = 30 * 60 * 1000; // Stop after 30 minutes

    function managePollInterval() {
        var hasProcessing = jobs.some(function(job) {
            var s = (job.status || '').toLowerCase();
            return s === 'processing';
        });

        var label = document.getElementById('autoRefreshLabel');

        if (hasProcessing) {
            label.classList.remove('hidden');
            if (!pollInterval) {
                pollStartTime = Date.now();
                pollInterval = setInterval(function() {
                    var elapsed = Date.now() - pollStartTime;
                    if (elapsed > maxPollDuration) {
                        clearInterval(pollInterval);
                        pollInterval = null;
                        pollStartTime = null;
                        label.classList.add('hidden');
                        return;
                    }
                    // Switch from 15s to 30s after first 120s
                    if (elapsed > 120000 && pollInterval) {
                        clearInterval(pollInterval);
                        pollInterval = setInterval(function() {
                            if (Date.now() - pollStartTime > maxPollDuration) {
                                clearInterval(pollInterval);
                                pollInterval = null;
                                pollStartTime = null;
                                label.classList.add('hidden');
                                return;
                            }
                            loadJobs();
                        }, 30000);
                    }
                    loadJobs();
                }, 15000);
            }
        } else {
            label.classList.add('hidden');
            if (pollInterval) {
                clearInterval(pollInterval);
                pollInterval = null;
                pollStartTime = null;
            }
        }
    }

    // --- Keyboard ---
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeConfirmDialog();
        }
    });

// ── Static handler wiring (externalized from inline on*= attributes; S9+F5 Phase E batch 10, 2026-06-25) ──
// Refresh button (was onclick="loadJobs()")
document.getElementById('refreshBtn').addEventListener('click', loadJobs);
// Confirm overlay backdrop (was onclick="closeConfirmDialog()")
document.getElementById('confirmOverlay').addEventListener('click', closeConfirmDialog);
// Confirm dialog inner panel — stop propagation so backdrop close doesn't fire (was onclick="event.stopPropagation()")
document.getElementById('confirmDialogContent').addEventListener('click', function (e) { e.stopPropagation(); });
// Confirm Cancel button (was onclick="closeConfirmDialog()")
document.getElementById('confirmCancelBtn').addEventListener('click', closeConfirmDialog);

// Delegated dispatcher for runtime-rendered job-card buttons (replaces inline
// onclick="toggleJobDetail(...)" / "confirmCancelJob(...)" / "confirmRetryJob(...)"). One
// document-level listener routes by data-action; the original handlers called
// event.stopPropagation() before the action, so we replicate that here to keep the click from
// bubbling up to the job-card-header toggle handler.
document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-action');
    if (!action) return;
    if (action === 'toggle-job') {
        toggleJobDetail(btn.getAttribute('data-id'));
    } else if (action === 'confirm-cancel') {
        e.stopPropagation();
        confirmCancelJob(btn.getAttribute('data-id'));
    } else if (action === 'confirm-retry') {
        e.stopPropagation();
        confirmRetryJob(btn.getAttribute('data-id'));
    }
});

// --- Init ---
loadJobs();
