// admin-geofence-logs page logic — externalized from admin-geofence-logs.html (S9+F5 strict CSP).
// NON-deferred, loaded right before </body> (matches original end-of-body timing).
function esc(s){ if(s===null||s===undefined) return ''; const d=document.createElement('div'); d.textContent=String(s); return d.innerHTML; }

// Set default date range to last 7 days
const today = new Date().toISOString().split('T')[0];
const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
document.getElementById('filterFromDate').value = weekAgo;
document.getElementById('filterToDate').value = today;

async function loadFilters() {
    try {
        // Load branches
        const branchRes = await fetch('/api/branches', { headers: getAuthHeaders() });
        const branchData = await branchRes.json();
        if (branchData.success) {
            const sel = document.getElementById('filterBranch');
            (branchData.data || []).forEach(b => {
                sel.innerHTML += `<option value="${b.id}">${esc(b.name)}</option>`;
            });
        }

        // Load staff
        const staffRes = await fetch('/api/staff?role=staff', { headers: getAuthHeaders() });
        const staffData = await staffRes.json();
        if (staffData.success) {
            const sel = document.getElementById('filterStaff');
            (staffData.data || []).forEach(s => {
                sel.innerHTML += `<option value="${s.id}">${esc(s.full_name || s.name)}</option>`;
            });
        }
    } catch (e) {
        console.error('Load filters error:', e);
    }
}

async function loadViolations() {
    const branch = document.getElementById('filterBranch').value;
    const staff = document.getElementById('filterStaff').value;
    const fromDate = document.getElementById('filterFromDate').value;
    const toDate = document.getElementById('filterToDate').value;

    const params = new URLSearchParams();
    if (branch) params.append('branch_id', branch);
    if (staff) params.append('user_id', staff);
    if (fromDate) params.append('from_date', fromDate);
    if (toDate) params.append('to_date', toDate);

    try {
        const res = await fetch(`/api/attendance/geofence-violations?${params}`, { headers: getAuthHeaders() });
        const data = await res.json();

        if (data.success) {
            const violations = data.data || [];
            renderTable(violations);
            updateSummary(violations);
        }
    } catch (e) {
        console.error('Load violations error:', e);
        document.getElementById('violationsTable').innerHTML =
            '<tr><td colspan="6" class="px-4 py-8 text-center text-red-400">Failed to load data</td></tr>';
    }
}

function renderTable(violations) {
    const tbody = document.getElementById('violationsTable');
    if (violations.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-gray-400">No violations found</td></tr>';
        return;
    }

    tbody.innerHTML = violations.map(v => {
        const dt = new Date(v.created_at);
        const typeClass = v.violation_type === 'left_area' ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700';
        const typeLabel = v.violation_type === 'left_area' ? 'Left Area' : 'Returned';

        return `<tr class="border-t hover:bg-gray-50">
            <td class="px-4 py-3 font-medium">${esc(v.staff_name || v.username)}</td>
            <td class="px-4 py-3">${esc(v.branch_name)}</td>
            <td class="px-4 py-3">${dt.toLocaleDateString()} ${dt.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})}</td>
            <td class="px-4 py-3 font-semibold">${v.distance_from_fence}m</td>
            <td class="px-4 py-3">${v.fence_radius}m</td>
            <td class="px-4 py-3"><span class="px-2 py-1 rounded-full text-xs font-semibold ${typeClass}">${typeLabel}</span></td>
        </tr>`;
    }).join('');
}

function updateSummary(violations) {
    document.getElementById('totalViolations').textContent = violations.length;
    document.getElementById('leftAreaCount').textContent = violations.filter(v => v.violation_type === 'left_area').length;
    document.getElementById('returnedCount').textContent = violations.filter(v => v.violation_type === 'returned').length;
    document.getElementById('uniqueStaff').textContent = new Set(violations.map(v => v.user_id)).size;
}

// Converted from onchange="loadViolations()" on the four filter inputs/selects (S9+F5 strict CSP).
document.getElementById('filterBranch').addEventListener('change', loadViolations);
document.getElementById('filterStaff').addEventListener('change', loadViolations);
document.getElementById('filterFromDate').addEventListener('change', loadViolations);
document.getElementById('filterToDate').addEventListener('change', loadViolations);

loadFilters();
loadViolations();
