// Page logic externalized from admin-zoho-locations.html inline <script> (S9+F5 Phase E batch 11, 2026-06-25)
// so the page runs under the enforced strict CSP. Verbatim move of all functions; inline on*=
// handlers converted to addEventListener + data-action delegation. No logic changes, no renames,
// escaping helpers untouched. The inline onmouseover/onmouseout background swaps are replaced by a
// CSS hover rule (same #667eea → #5a6fd6 effect) added to the page <style>, since they cannot remain
// as inline handlers under CSP.

// ========================
// Toast Notification
// ========================
function showToast(message, type) {
    var toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast toast-' + (type || 'info');
    toast.classList.add('show');
    setTimeout(function() { toast.classList.remove('show'); }, 3500);
}

// ========================
// Utility Functions
// ========================
function escapeHtml(text) {
    if (!text) return '';
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatDateTime(dateStr) {
    if (!dateStr) return '--';
    try {
        var d = new Date(dateStr);
        if (isNaN(d.getTime())) return '--';
        return d.toLocaleString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: true
        });
    } catch (e) {
        return '--';
    }
}

// ========================
// State
// ========================
var locations = [];
var branches = [];

// ========================
// API Fetch Helper
// ========================
async function zohoFetch(url, options) {
    try { return await apiRequest(url, options); }
    catch (err) { showToast(err.message || 'Network error', 'error'); return null; }
}

// ========================
// Load Branches (for dropdown)
// ========================
async function loadBranches() {
    var response = await zohoFetch('/api/branches');
    if (!response) return;
    try {
        var data = await response.json();
        // Handle both array and object with data/branches key
        if (Array.isArray(data)) {
            branches = data;
        } else if (data.data && Array.isArray(data.data)) {
            branches = data.data;
        } else if (data.branches && Array.isArray(data.branches)) {
            branches = data.branches;
        } else {
            branches = [];
        }
    } catch (e) {
        console.error('Failed to parse branches:', e);
        branches = [];
    }
}

// ========================
// Load Locations
// ========================
async function loadLocations() {
    var loadingGrid = document.getElementById('loadingGrid');
    var locationsGrid = document.getElementById('locationsGrid');
    var emptyState = document.getElementById('emptyState');

    loadingGrid.classList.remove('hidden');
    locationsGrid.classList.add('hidden');
    emptyState.classList.add('hidden');

    var response = await zohoFetch('/api/zoho/locations?include_inactive=1');
    if (!response) {
        loadingGrid.classList.add('hidden');
        emptyState.classList.remove('hidden');
        document.getElementById('summaryText').textContent = 'Failed to load locations';
        return;
    }

    var data = await response.json();

    // Handle various response shapes
    if (data.success !== undefined && !data.success) {
        loadingGrid.classList.add('hidden');
        emptyState.classList.remove('hidden');
        document.getElementById('summaryText').textContent = data.message || 'Failed to load locations';
        return;
    }

    locations = data.locations || data.data || data || [];
    if (!Array.isArray(locations)) locations = [];

    loadingGrid.classList.add('hidden');

    if (locations.length === 0) {
        emptyState.classList.remove('hidden');
        document.getElementById('summaryText').textContent = '0 locations synced, 0 mapped to branches';
        return;
    }

    locationsGrid.classList.remove('hidden');
    renderLocations();
    updateSummary();
}

// ========================
// Render Location Cards
// ========================
function renderLocations() {
    var grid = document.getElementById('locationsGrid');
    grid.innerHTML = '';

    locations.forEach(function(loc) {
        var card = document.createElement('div');
        card.className = 'location-card';
        card.id = 'location-card-' + loc.id;

        // Determine status
        var isActive = loc.status === 'active' || loc.is_active === 1 || loc.is_active === true;
        var isPrimary = loc.is_primary === 1 || loc.is_primary === true;
        var statusBadge = isActive
            ? '<span class="badge badge-active">Active</span>'
            : '<span class="badge badge-inactive">Inactive</span>';
        var primaryBadge = isPrimary
            ? '<span class="badge badge-primary ml-1">Primary</span>'
            : '';

        // Address
        var address = loc.address || loc.street || '';
        if (loc.city) address += (address ? ', ' : '') + loc.city;
        if (loc.state) address += (address ? ', ' : '') + loc.state;
        if (loc.zip || loc.zipcode) address += (address ? ' ' : '') + (loc.zip || loc.zipcode);

        // Branch mapping dropdown
        var currentBranchId = loc.branch_id || loc.mapped_branch_id || '';
        var branchOptions = '<option value="">-- Select Branch --</option>';
        branches.forEach(function(branch) {
            var selected = (String(branch.id) === String(currentBranchId)) ? ' selected' : '';
            branchOptions += '<option value="' + branch.id + '"' + selected + '>' + escapeHtml(branch.name || branch.branch_name || 'Branch #' + branch.id) + '</option>';
        });

        // Last synced
        var lastSynced = formatDateTime(loc.last_synced || loc.synced_at || loc.updated_at);

        card.innerHTML = '' +
            '<div class="flex items-start justify-between mb-3">' +
                '<div class="flex-1 min-w-0">' +
                    '<h3 class="text-lg font-bold text-gray-800 truncate">' + escapeHtml(loc.name || loc.location_name || 'Unnamed Location') + '</h3>' +
                    '<div class="flex items-center gap-1.5 mt-1 flex-wrap">' +
                        statusBadge +
                        primaryBadge +
                    '</div>' +
                '</div>' +
                '<div class="flex-shrink-0 ml-3">' +
                    '<svg class="w-8 h-8 text-gray-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
                        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path>' +
                        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path>' +
                    '</svg>' +
                '</div>' +
            '</div>' +
            (address
                ? '<p class="text-sm text-gray-500 mb-4 flex items-start gap-1.5">' +
                    '<svg class="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
                        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"></path>' +
                        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"></path>' +
                    '</svg>' +
                    '<span>' + escapeHtml(address) + '</span>' +
                '</p>'
                : '<p class="text-sm text-gray-400 italic mb-4">No address available</p>'
            ) +
            '<div class="mb-3">' +
                '<label class="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">Mapped Branch</label>' +
                '<select id="branch-select-' + loc.id + '" data-action="branch-change" data-id="' + loc.id + '" class="branch-select w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:border-transparent" style="focus:ring-color: #667eea;">' +
                    branchOptions +
                '</select>' +
            '</div>' +
            '<div class="flex items-center justify-between">' +
                '<span class="text-xs text-gray-400">Last synced: ' + lastSynced + '</span>' +
                '<button id="save-btn-' + loc.id + '" data-action="save-mapping" data-id="' + loc.id + '" class="inline-flex items-center gap-1.5 px-3 py-1.5 text-white text-xs font-semibold rounded-lg transition opacity-50 cursor-not-allowed" style="background: #667eea;" disabled>' +
                    '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
                        '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>' +
                    '</svg>' +
                    '<span>Save Mapping</span>' +
                '</button>' +
            '</div>';

        grid.appendChild(card);
    });
}

// ========================
// Branch Change Handler
// ========================
function onBranchChange(locationId) {
    var btn = document.getElementById('save-btn-' + locationId);
    if (btn) {
        btn.disabled = false;
        btn.classList.remove('opacity-50', 'cursor-not-allowed');
        // Original inline onmouseover/onmouseout background swaps replaced by CSS hover
        // (btn-save-map:hover rule in <style>) — same #667eea → #5a6fd6 effect, CSP-safe.
    }
}

// ========================
// Save Mapping
// ========================
async function saveMapping(locationId) {
    var select = document.getElementById('branch-select-' + locationId);
    var btn = document.getElementById('save-btn-' + locationId);
    var branchId = select ? select.value : '';

    if (!branchId) {
        showToast('Please select a branch to map', 'warning');
        return;
    }

    // Disable button and show loading
    btn.disabled = true;
    var originalHtml = btn.innerHTML;
    btn.innerHTML = '' +
        '<svg class="w-3.5 h-3.5 spin" fill="none" viewBox="0 0 24 24">' +
            '<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>' +
            '<path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>' +
        '</svg>' +
        '<span>Saving...</span>';
    btn.classList.add('opacity-75');

    var response = await zohoFetch('/api/zoho/locations/' + locationId + '/map', {
        method: 'PUT',
        body: JSON.stringify({ branch_id: parseInt(branchId) })
    });

    if (!response) {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
        btn.classList.remove('opacity-75');
        return;
    }

    var data = await response.json();

    if (response.ok && (data.success !== false)) {
        showToast('Location mapped to branch successfully', 'success');

        // Update local state
        var loc = locations.find(function(l) { return l.id === locationId; });
        if (loc) {
            loc.branch_id = parseInt(branchId);
            loc.mapped_branch_id = parseInt(branchId);
        }

        // Update button to saved state
        btn.innerHTML = '' +
            '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">' +
                '<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>' +
            '</svg>' +
            '<span>Saved</span>';
        btn.style.background = '#059669';
        btn.classList.remove('opacity-75');
        btn.disabled = true;
        btn.classList.add('opacity-50', 'cursor-not-allowed');

        // Reset button after delay
        setTimeout(function() {
            btn.innerHTML = originalHtml;
            btn.style.background = '#667eea';
        }, 2000);

        updateSummary();
    } else {
        showToast(data.message || 'Failed to save mapping', 'error');
        btn.innerHTML = originalHtml;
        btn.disabled = false;
        btn.classList.remove('opacity-75');
    }
}

// ========================
// Sync Locations from Zoho
// ========================
async function syncLocations() {
    var btn = document.getElementById('syncBtn');
    var icon = document.getElementById('syncIcon');
    var text = document.getElementById('syncBtnText');

    btn.disabled = true;
    btn.style.opacity = '0.75';
    icon.classList.add('spin');
    text.textContent = 'Syncing...';

    var response = await zohoFetch('/api/zoho/locations/sync', {
        method: 'POST'
    });

    btn.disabled = false;
    btn.style.opacity = '1';
    icon.classList.remove('spin');
    text.textContent = 'Sync Locations';

    if (!response) return;

    var data = await response.json();

    if (response.ok && data.success) {
        var synced = data.data?.synced || 0;
        var toastType = synced > 0 ? 'success' : 'warning';
        showToast(data.message || (synced + ' locations synced'), toastType);
        // Reload locations after sync
        await loadLocations();
    } else {
        showToast(data.message || 'Failed to sync locations from Zoho', 'error');
    }
}

// ========================
// Update Summary
// ========================
function updateSummary() {
    var total = locations.length;
    var mapped = 0;
    locations.forEach(function(loc) {
        if (loc.branch_id || loc.mapped_branch_id) {
            mapped++;
        }
    });
    document.getElementById('summaryText').textContent =
        total + ' location' + (total !== 1 ? 's' : '') + ' synced, ' +
        mapped + ' mapped to branches';
}

// ========================
// Initialize
// ========================
async function init() {
    // Load branches first (needed for dropdowns), then locations
    await loadBranches();
    await loadLocations();
}

// ── Static handler wiring (externalized from inline on*= attributes; S9+F5 Phase E batch 11, 2026-06-25) ──
// Header "Sync Locations" button (was onclick="syncLocations()")
document.getElementById('syncBtn').addEventListener('click', syncLocations);
// Empty-state "Sync Locations Now" button (was onclick="syncLocations()")
document.getElementById('syncBtnEmpty').addEventListener('click', syncLocations);

// Delegated dispatcher for runtime-rendered card controls (replaces inline
// onchange="onBranchChange(...)" on <select> and onclick="saveMapping(...)" on <button>).
// One document-level click listener + one change listener, both route by data-action.
document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-action]');
    if (!btn) return;
    var action = btn.getAttribute('data-action');
    if (!action) return;
    if (action === 'save-mapping') {
        saveMapping(btn.getAttribute('data-id'));
    }
});

document.addEventListener('change', function (e) {
    var el = e.target.closest('[data-action]');
    if (!el) return;
    var action = el.getAttribute('data-action');
    if (!action) return;
    if (action === 'branch-change') {
        onBranchChange(el.getAttribute('data-id'));
    }
});

// Initialize
init();
