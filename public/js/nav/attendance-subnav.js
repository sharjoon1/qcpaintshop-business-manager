// attendance-subnav subnav — externalized from public/components/attendance-subnav.html (S9+F5 strict CSP). Loaded by universal-nav-loader.js after the fragment is injected.
(function() {
    var attendancePages = [
        { page: 'attendance-dashboard', label: 'Dashboard', href: '/staff/dashboard.html', icon: '<path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4"/>' },
        { page: 'attendance-clock-in', label: 'Clock In', href: '/staff/clock-in.html', icon: '<path d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"/>' },
        { page: 'attendance-clock-out', label: 'Clock Out', href: '/staff/clock-out.html', icon: '<path d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/>' },
        { page: 'attendance-history', label: 'History', href: '/staff/history.html', icon: '<path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>' },
        { page: 'attendance-permission', label: 'Permission', href: '/staff/permission-request.html', icon: '<path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>' },
        { page: 'attendance-activities', label: 'Activities', href: '/staff/activities.html', icon: '<path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"/>' },
        { page: 'attendance-tasks', label: 'Tasks', href: '/staff/tasks.html', icon: '<path d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"/>' },
        { page: 'attendance-admin', label: 'Admin Panel', href: '/admin-attendance.html', icon: '<path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><circle cx="12" cy="12" r="3"/>', adminOnly: true },
        { page: 'admin-tasks', label: 'Tasks Admin', href: '/admin-tasks.html', icon: '<path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/>', adminOnly: true },
        { page: 'admin-daily-tasks', label: 'Daily Tasks', href: '/admin-daily-tasks.html', icon: '<path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>', adminOnly: true },
        { page: 'activity-monitor', label: 'Activity Monitor', href: '/admin-activity-monitor.html', icon: '<path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/>', adminOnly: true },
        { page: 'geofence-logs', label: 'Geofence Logs', href: '/admin-geofence-logs.html', icon: '<path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>', adminOnly: true }
    ];

    // Detect current page
    var currentPage = document.body.getAttribute('data-page') || document.documentElement.getAttribute('data-page') || '';
    var currentPageObj = attendancePages.find(function(p) { return p.page === currentPage; });

    // Check if user is admin
    var isAdmin = false;
    try {
        var user = JSON.parse(localStorage.getItem('user') || '{}');
        isAdmin = user.role === 'admin' || user.role === 'super_admin' || user.is_admin === true;
    } catch(e) {}

    // Build tabs for desktop
    var tabsContainer = document.getElementById('attendanceSubnavTabs');
    var dropdownContainer = document.getElementById('attendanceSubnavDropdown');

    attendancePages.forEach(function(p) {
        // Skip admin-only tabs for non-admin users
        if (p.adminOnly && !isAdmin) return;

        var isActive = p.page === currentPage;
        var tabHtml = '<a href="' + p.href + '" class="attendance-subnav-tab' + (isActive ? ' active' : '') + '" data-attendance-page="' + p.page + '">' +
            '<svg viewBox="0 0 24 24">' + p.icon + '</svg>' +
            '<span>' + p.label + '</span>' +
        '</a>';

        // Desktop tabs
        tabsContainer.insertAdjacentHTML('beforeend', tabHtml);
        // Mobile dropdown
        dropdownContainer.insertAdjacentHTML('beforeend', tabHtml);
    });

    // Set mobile toggle label
    if (currentPageObj) {
        document.getElementById('attendanceSubnavCurrentPage').textContent = currentPageObj.label;
    }

    // Scroll active tab into view on desktop
    setTimeout(function() {
        var activeTab = tabsContainer.querySelector('.attendance-subnav-tab.active');
        if (activeTab) {
            activeTab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
    }, 100);
})();

function toggleAttendanceSubnav() {
    var toggle = document.getElementById('attendanceSubnavToggle');
    var dropdown = document.getElementById('attendanceSubnavDropdown');
    toggle.classList.toggle('open');
    dropdown.classList.toggle('show');
}

// Wire the mobile dropdown toggle (replaces the former inline onclick on #attendanceSubnavToggle).
(function () {
    function wireToggle() {
        var toggle = document.getElementById('attendanceSubnavToggle');
        if (toggle) toggle.addEventListener('click', toggleAttendanceSubnav);
    }
    if (document.getElementById('attendanceSubnavToggle')) wireToggle();
    else document.addEventListener('DOMContentLoaded', wireToggle);
})();

// Close dropdown when clicking outside
document.addEventListener('click', function(e) {
    var subnav = document.getElementById('attendanceSubnav');
    if (subnav && !subnav.contains(e.target)) {
        var toggle = document.getElementById('attendanceSubnavToggle');
        var dropdown = document.getElementById('attendanceSubnavDropdown');
        if (toggle) toggle.classList.remove('open');
        if (dropdown) dropdown.classList.remove('show');
    }
});
