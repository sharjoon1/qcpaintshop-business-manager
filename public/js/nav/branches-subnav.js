// branches-subnav subnav — externalized from public/components/branches-subnav.html (S9+F5 strict CSP). Loaded by universal-nav-loader.js after the fragment is injected.
(function() {
    var branchesPages = [
        { page: 'branches', label: 'Branches', href: '/admin-branches.html', icon: '<path d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"/>' },
        { page: 'staff', label: 'Staff', href: '/admin-staff.html', icon: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>' },
        { page: 'staff-registrations', label: 'Registrations', href: '/admin-staff-registrations.html', icon: '<path d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z"/>' },
        { page: 'roles', label: 'Roles', href: '/admin-roles.html', icon: '<path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>' },
        { page: 'permissions', label: 'Permissions', href: '/admin-role-permissions.html', icon: '<path d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z"/>' }
    ];

    var currentPage = document.body.getAttribute('data-page') || document.documentElement.getAttribute('data-page') || '';
    var currentPageObj = branchesPages.find(function(p) { return p.page === currentPage; });

    var tabsContainer = document.getElementById('branchesSubnavTabs');
    var dropdownContainer = document.getElementById('branchesSubnavDropdown');

    branchesPages.forEach(function(p) {
        var isActive = p.page === currentPage;
        var tabHtml = '<a href="' + p.href + '" class="branches-subnav-tab' + (isActive ? ' active' : '') + '" data-branches-page="' + p.page + '">' +
            '<svg viewBox="0 0 24 24">' + p.icon + '</svg>' +
            '<span>' + p.label + '</span>' +
        '</a>';

        tabsContainer.insertAdjacentHTML('beforeend', tabHtml);
        dropdownContainer.insertAdjacentHTML('beforeend', tabHtml);
    });

    if (currentPageObj) {
        document.getElementById('branchesSubnavCurrentPage').textContent = currentPageObj.label;
    }

    setTimeout(function() {
        var activeTab = tabsContainer.querySelector('.branches-subnav-tab.active');
        if (activeTab) {
            activeTab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
    }, 100);
})();

function toggleBranchesSubnav() {
    var toggle = document.getElementById('branchesSubnavToggle');
    var dropdown = document.getElementById('branchesSubnavDropdown');
    toggle.classList.toggle('open');
    dropdown.classList.toggle('show');
}

// Wire the mobile dropdown toggle (replaces the former inline onclick on #branchesSubnavToggle).
(function () {
    function wireToggle() {
        var toggle = document.getElementById('branchesSubnavToggle');
        if (toggle) toggle.addEventListener('click', toggleBranchesSubnav);
    }
    if (document.getElementById('branchesSubnavToggle')) wireToggle();
    else document.addEventListener('DOMContentLoaded', wireToggle);
})();

document.addEventListener('click', function(e) {
    var subnav = document.getElementById('branchesSubnav');
    if (subnav && !subnav.contains(e.target)) {
        var toggle = document.getElementById('branchesSubnavToggle');
        var dropdown = document.getElementById('branchesSubnavDropdown');
        if (toggle) toggle.classList.remove('open');
        if (dropdown) dropdown.classList.remove('show');
    }
});
