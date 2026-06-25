// header-v2 — externalized from public/components/header-v2.html (S9+F5 strict CSP).
// Loaded by universal-nav-loader.js after the header fragment is injected.

// Helper function for authenticated API requests
function getAuthHeaders() {
    const token = localStorage.getItem('auth_token');
    if (!token) {
        window.location.href = '/login.html';
        return {};
    }
    return {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };
}

function toggleProfileDropdown() {
    document.getElementById('profileDropdown').classList.toggle('show');
}

document.addEventListener('click', function(e) {
    const profile = document.querySelector('.qc-profile-section');
    if (profile && !profile.contains(e.target)) {
        document.getElementById('profileDropdown').classList.remove('show');
    }
});

function headerLogout() {
    if (confirm('Are you sure you want to logout?')) {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user');
        window.location.href = '/login.html';
    }
}

// ═══════════════════════════════════════
// HEADER SHRINK ON SCROLL
// Condenses on scroll down, expands on scroll up/top
// ═══════════════════════════════════════
(function() {
    let ticking = false;
    const CONDENSE_THRESHOLD = 80;

    function handleHeaderScroll() {
        const header = document.getElementById('mainHeader');
        if (!header) return;

        const currentScrollY = window.scrollY;

        if (currentScrollY > CONDENSE_THRESHOLD) {
            header.classList.add('header-condensed');
        } else {
            header.classList.remove('header-condensed');
        }

        ticking = false;
    }

    window.addEventListener('scroll', function() {
        if (!ticking) {
            window.requestAnimationFrame(handleHeaderScroll);
            ticking = true;
        }
    }, { passive: true });
})();

async function loadHeaderInfo() {
    const user = JSON.parse(localStorage.getItem('user') || '{}');

    // Set profile name and role in header
    const nameEl = document.getElementById('headerProfileName');
    const roleEl = document.getElementById('headerProfileRole');
    const dropdownName = document.getElementById('dropdownUserName');
    const dropdownRole = document.getElementById('dropdownUserRole');

    const displayName = user.full_name || user.name || 'User';
    const displayRole = user.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : '';

    if (nameEl) nameEl.textContent = displayName;
    if (roleEl) roleEl.textContent = displayRole;
    if (dropdownName) dropdownName.textContent = displayName;
    if (dropdownRole) dropdownRole.textContent = displayRole;

    // Set profile picture or initial
    if (user.profile_image_url) {
        const pic = document.getElementById('headerProfilePic');
        const initial = document.getElementById('headerProfileInitial');
        pic.src = user.profile_image_url;
        pic.style.display = 'block';
        if (initial) initial.style.display = 'none';
    } else if (user.full_name || user.name) {
        const name = user.full_name || user.name;
        const initial = document.getElementById('headerProfileInitial');
        if (initial) initial.textContent = name.charAt(0).toUpperCase();
    }

    // Staff green theme for profile icon
    if (user.role === 'staff' || user.role === 'manager') {
        const initial = document.getElementById('headerProfileInitial');
        if (initial) {
            initial.style.background = 'linear-gradient(135deg, #1B5E3B, #154D31)';
            initial.style.borderColor = '#a7f3d0';
        }
    }

    // Load business logo from settings
    await loadBusinessLogo();
}

async function loadBusinessLogo() {
    try {
        const token = localStorage.getItem('auth_token');
        if (!token) return;

        const response = await fetch('/api/settings/branding', {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) return;

        const settings = await response.json();
        // Handle both flat and wrapped response formats
        const data = settings.data || settings;

        if (data.business_logo) {
            const logoElement = document.getElementById('headerLogo');
            if (logoElement) {
                logoElement.onerror = function() {
                    // Prevent infinite loop - only fallback once
                    this.onerror = null;
                    this.src = '/icons/icon-192x192.png';
                };
                logoElement.src = data.business_logo;
            }
            // Also update any other logo elements on the page
            document.querySelectorAll('.business-logo, [data-logo="business"]').forEach(el => {
                if (el.tagName === 'IMG') {
                    el.onerror = function() { this.onerror = null; this.src = '/icons/icon-192x192.png'; };
                    el.src = data.business_logo;
                }
            });
        }
    } catch (error) {
        console.warn('Could not load business logo:', error);
    }
}

// ═══════════════════════════════════════
// NOTIFICATIONS
// ═══════════════════════════════════════

let _notifPollTimer = null;

function toggleNotificationPanel() {
    const panel = document.getElementById('notifPanel');
    panel.classList.toggle('show');
    if (panel.classList.contains('show')) {
        loadNotifications();
    }
}

// Close notification panel on outside click
document.addEventListener('click', function(e) {
    const bell = document.querySelector('.qc-notification-bell');
    const panel = document.getElementById('notifPanel');
    if (panel && bell && !bell.contains(e.target) && !panel.contains(e.target)) {
        panel.classList.remove('show');
    }
});

async function fetchNotificationCount() {
    try {
        const token = localStorage.getItem('auth_token');
        if (!token) return;
        const r = await fetch('/api/notifications/count', { headers: { 'Authorization': `Bearer ${token}` } });
        if (!r.ok) return;
        const data = await r.json();
        const badge = document.getElementById('notifBadge');
        if (badge) {
            const count = data.count || 0;
            badge.textContent = count > 99 ? '99+' : count;
            badge.classList.toggle('has-count', count > 0);
        }
    } catch {}
}

async function loadNotifications() {
    try {
        const token = localStorage.getItem('auth_token');
        if (!token) return;
        const r = await fetch('/api/notifications?limit=10', { headers: { 'Authorization': `Bearer ${token}` } });
        if (!r.ok) return;
        const result = await r.json();
        const list = document.getElementById('notifList');
        if (!list) return;

        const notifications = result.data || [];
        if (notifications.length === 0) {
            list.innerHTML = '<div class="qc-notification-empty">No notifications</div>';
            return;
        }

        list.innerHTML = notifications.map(n => {
            const icon = getNotifIcon(n.type);
            const timeAgo = formatTimeAgo(n.created_at);
            // Safely encode data as base64 to avoid HTML escaping issues
            let dataB64 = '';
            try {
                const raw = typeof n.data === 'string' ? n.data : JSON.stringify(n.data || {});
                dataB64 = btoa(unescape(encodeURIComponent(raw)));
            } catch(e) { dataB64 = btoa('{}'); }
            return `<div class="qc-notification-item ${n.is_read ? '' : 'unread'}" data-action="notif-click" data-notif-id="${n.id}" data-notif-type="${escapeHtml(n.type || '')}" data-notif-data="${escapeHtml(dataB64)}">
                <div class="qc-notification-icon">${icon}</div>
                <div class="qc-notification-body">
                    <div class="qc-notification-title">${escapeHtml(n.title)}</div>
                    <div class="qc-notification-text">${escapeHtml(n.body || '')}</div>
                    <div class="qc-notification-time">${timeAgo}</div>
                </div>
            </div>`;
        }).join('');
    } catch {}
}

function getNotifIcon(type) {
    const icons = {
        'chat_message': '💬', 'estimate_shared': '📋', 'estimate_approved': '✅',
        'estimate_rejected': '❌', 'task_assigned': '📌', 'task_completed': '✅',
        'stock_check_assigned': '📦', 'stock_check_submitted': '📦',
        'permission_approved': '✅', 'permission_rejected': '❌',
        'reclockin_request': '🔄', 'break_exceeded': '⏰',
        'force_clockout': '🔴', 'geo_auto_clockout': '📍', 'geo_auto_clockout_admin': '📍',
        'salary_generated': '💰', 'salary_paid': '💵',
        'advance_approved': '✅', 'advance_rejected': '❌',
        'new_registration': '👤', 'system': '🔔', 'system_alert': '🔔',
        'attendance_report': '📊', 'admin_attendance_report': '📊',
        'lead_assigned': '🎯', 'lead_created': '🎯',
        'lead_creation_alert': '📢', 'lead_overdue_alert': '⚠️', 'lead_followup_reminder': '🔔',
        'credit_limit_request_new': '💳', 'credit_limit_request_resolved': '💳',
        'clock_in': '🟢', 'clock_out': '🔴',
        'break_start': '☕', 'break_end': '☕',
        'outside_work_start': '🚶', 'outside_work_end': '🚶',
        'prayer_start': '🕌', 'prayer_end': '🕌',
        'geofence_violation': '📍', 'document': '📄',
        'admin_notice': '📣', 'profile_updated': '👤',
        'incentive_earned': '🎉', 'incentive_approved': '✅', 'incentive_rejected': '❌', 'incentive_request': '📋'
    };
    return icons[type] || '🔔';
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatTimeAgo(dateStr) {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff / 86400) + 'd ago';
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

async function handleNotifClick(id, type, dataB64) {
    try {
        const token = localStorage.getItem('auth_token');
        await fetch(`/api/notifications/${id}/read`, { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
        fetchNotificationCount();
    } catch {}

    // Decode data from base64
    let data = {};
    try {
        const raw = decodeURIComponent(escape(atob(dataB64 || '')));
        data = JSON.parse(raw);
    } catch { data = {}; }

    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const _hRole = (user.role || '').toLowerCase();
    const isAdmin = ['admin', 'administrator', 'super_admin'].includes(_hRole);
    const isStaff = !isAdmin && (_hRole === 'staff' || _hRole === 'manager' || _hRole === 'branch_manager' || _hRole === 'accountant' || _hRole === 'sales_staff');

    // Data-based deep links (highest priority)
    if (data.conversation_id) {
        window.location.href = `/chat.html?conversation=${data.conversation_id}`;
        return;
    }
    if (data.lead_id) {
        window.location.href = isStaff ? `/staff-leads.html?lead=${data.lead_id}` : `/admin-leads.html?lead=${data.lead_id}`;
        return;
    }
    if (data.estimate_id) {
        window.location.href = isStaff ? `/staff-estimates.html?id=${data.estimate_id}` : `/admin-painters.html?tab=estimates&id=${data.estimate_id}`;
        return;
    }
    if (data.pdf_url) {
        window.open(data.pdf_url, '_blank');
        return;
    }

    // Type-based navigation
    const routes = {
        // Chat
        'chat_message':             '/chat.html',
        // Attendance
        'attendance_report':        isStaff ? '/staff/dashboard.html' : '/admin-attendance.html',
        'admin_attendance_report':  '/admin-attendance.html',
        'clock_in':                 isStaff ? '/staff/dashboard.html' : '/admin-attendance.html',
        'clock_out':                isStaff ? '/staff/dashboard.html' : '/admin-attendance.html',
        'break_start':              isStaff ? '/staff/dashboard.html' : '/admin-attendance.html',
        'break_end':                isStaff ? '/staff/dashboard.html' : '/admin-attendance.html',
        'break_exceeded':           isStaff ? '/staff/dashboard.html' : '/admin-attendance.html',
        'outside_work_start':       isStaff ? '/staff/dashboard.html' : '/admin-attendance.html',
        'outside_work_end':         isStaff ? '/staff/dashboard.html' : '/admin-attendance.html',
        'prayer_start':             isStaff ? '/staff/dashboard.html' : '/admin-attendance.html',
        'prayer_end':               isStaff ? '/staff/dashboard.html' : '/admin-attendance.html',
        'force_clockout':           isStaff ? '/staff/history.html' : '/admin-attendance.html',
        'geo_auto_clockout':        isStaff ? '/staff/history.html' : '/admin-attendance.html',
        'geo_auto_clockout_admin':  '/admin-attendance.html',
        'geofence_violation':       isStaff ? '/staff/dashboard.html' : '/admin-attendance.html',
        'reclockin_request':        '/admin-attendance.html',
        // Permissions
        'permission_approved':      isStaff ? '/staff/permission-request.html' : '/admin-attendance.html',
        'permission_rejected':      isStaff ? '/staff/permission-request.html' : '/admin-attendance.html',
        // Stock
        'stock_check_assigned':     isStaff ? '/staff/stock-check.html' : '/admin-stock-check.html',
        'stock_check_submitted':    '/admin-stock-check.html',
        // Tasks
        'task_assigned':            isStaff ? '/staff-daily-work.html' : '/admin-tasks.html',
        'task_completed':           isStaff ? '/staff-daily-work.html' : '/admin-tasks.html',
        // Leads
        'lead_assigned':            isStaff ? '/staff-leads.html' : '/admin-leads.html',
        'lead_created':             isStaff ? '/staff-leads.html' : '/admin-leads.html',
        'lead_creation_alert':      '/staff-leads.html',
        'lead_overdue_alert':       '/staff-leads.html',
        'lead_followup_reminder':   '/staff-leads.html',
        // Salary
        'salary_generated':         isStaff ? '/staff/dashboard.html' : '/admin-salary.html',
        'salary_paid':              isStaff ? '/staff/dashboard.html' : '/admin-salary.html',
        'advance_approved':         isStaff ? '/staff/dashboard.html' : '/admin-salary.html',
        'advance_rejected':         isStaff ? '/staff/dashboard.html' : '/admin-salary.html',
        'document':                 isStaff ? '/staff/dashboard.html' : '/admin-salary.html',
        // Estimates
        'estimate_shared':          isStaff ? '/staff-estimates.html' : '/admin-painters.html?tab=estimates',
        'estimate_approved':        isStaff ? '/staff-estimates.html' : '/admin-painters.html?tab=estimates',
        'estimate_rejected':        isStaff ? '/staff-estimates.html' : '/admin-painters.html?tab=estimates',
        // Credit
        'credit_limit_request_new':      isAdmin ? '/admin-credit-limits.html' : null,
        'credit_limit_request_resolved': '/admin-credit-limits.html',
        // System
        'system_alert':             isAdmin ? '/admin-system-health.html' : null,
        'new_registration':         isAdmin ? '/admin-staff-registrations.html' : null,
        'profile_updated':          isAdmin ? '/admin-staff.html' : '/staff/dashboard.html',
        'admin_notice':             isStaff ? '/staff/dashboard.html' : '/admin-attendance.html',
        // Incentives
        'incentive_earned':         '/staff-incentives.html',
        'incentive_approved':       '/staff-incentives.html',
        'incentive_rejected':       '/staff-incentives.html',
        'incentive_request':        isAdmin ? '/admin-salary-incentives.html' : '/staff-incentives.html',
    };

    const dest = routes[type];
    if (dest) {
        window.location.href = dest;
        return;
    }

    // Default: close panel (no matching route)
    document.getElementById('notifPanel').classList.remove('show');
}

async function markAllNotificationsRead() {
    try {
        const token = localStorage.getItem('auth_token');
        await fetch('/api/notifications/read-all', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
        fetchNotificationCount();
        loadNotifications();
    } catch {}
}

// Listen for Socket.io notifications (if socket-helper loaded)
window.addEventListener('qc-notification', function(e) {
    fetchNotificationCount();
    // If panel is open, refresh it
    const panel = document.getElementById('notifPanel');
    if (panel && panel.classList.contains('show')) loadNotifications();
});

// Initialize on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { loadHeaderInfo(); fetchNotificationCount(); });
} else {
    loadHeaderInfo();
    fetchNotificationCount();
}

// Poll notification count every 30s
_notifPollTimer = setInterval(fetchNotificationCount, 30000);

// Delegated handler for the former inline onclicks (S9+F5 CSP externalization).
// Static: toggle-notif / mark-all-read / toggle-profile / logout.
// Runtime: notif-click — per-notification, emitted by loadNotifications() with
// data-notif-id/type/data attrs (read via el.dataset, auto-escaped).
(function () {
    function wireHeaderHandlers() {
        document.addEventListener('click', function (e) {
            var el = e.target.closest('[data-action]');
            if (!el) return;
            var action = el.getAttribute('data-action');
            if (action === 'toggle-notif') { e.preventDefault(); toggleNotificationPanel(); }
            else if (action === 'mark-all-read') { e.preventDefault(); markAllNotificationsRead(); }
            else if (action === 'toggle-profile') { toggleProfileDropdown(); }
            else if (action === 'logout') { e.preventDefault(); headerLogout(); }
            else if (action === 'notif-click') {
                handleNotifClick(el.dataset.notifId, el.dataset.notifType, el.dataset.notifData);
            }
        });
    }
    if (document.getElementById('mainHeader')) wireHeaderHandlers();
    else document.addEventListener('DOMContentLoaded', wireHeaderHandlers);
})();
