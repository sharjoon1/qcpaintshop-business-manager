// staff-work-subnav subnav — externalized from public/components/staff-work-subnav.html (S9+F5 strict CSP). Loaded by universal-nav-loader.js after the fragment is injected.
(function() {
    var staffWorkPages = [
        { page: 'my-leads', label: 'My Leads', href: '/staff-leads.html', icon: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>' },
        { page: 'my-estimates', label: 'My Estimates', href: '/staff-estimates.html', icon: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>' },
        { page: 'my-incentives', label: 'My Incentives', href: '/staff-incentives.html', icon: '<circle cx="12" cy="8" r="7"/><polyline points="8.21 13.89 7 23 12 20 17 23 15.79 13.88"/>' }
    ];

    var currentPage = document.body.getAttribute('data-page') || document.documentElement.getAttribute('data-page') || '';
    var currentPageObj = staffWorkPages.find(function(p) { return p.page === currentPage; });

    var tabsContainer = document.getElementById('staffWorkSubnavTabs');
    var dropdownContainer = document.getElementById('staffWorkSubnavDropdown');

    staffWorkPages.forEach(function(p) {
        var isActive = p.page === currentPage;
        var tabHtml = '<a href="' + p.href + '" class="staff-work-subnav-tab' + (isActive ? ' active' : '') + '" data-staff-work-page="' + p.page + '">' +
            '<svg viewBox="0 0 24 24">' + p.icon + '</svg>' +
            '<span>' + p.label + '</span>' +
        '</a>';

        tabsContainer.insertAdjacentHTML('beforeend', tabHtml);
        dropdownContainer.insertAdjacentHTML('beforeend', tabHtml);
    });

    if (currentPageObj) {
        document.getElementById('staffWorkSubnavCurrentPage').textContent = currentPageObj.label;
    }

    setTimeout(function() {
        var activeTab = tabsContainer.querySelector('.staff-work-subnav-tab.active');
        if (activeTab) {
            activeTab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
    }, 100);
})();

function toggleStaffWorkSubnav() {
    var toggle = document.getElementById('staffWorkSubnavToggle');
    var dropdown = document.getElementById('staffWorkSubnavDropdown');
    toggle.classList.toggle('open');
    dropdown.classList.toggle('show');
}

// Wire the mobile dropdown toggle (replaces the former inline onclick on #staffWorkSubnavToggle).
(function () {
    function wireToggle() {
        var toggle = document.getElementById('staffWorkSubnavToggle');
        if (toggle) toggle.addEventListener('click', toggleStaffWorkSubnav);
    }
    if (document.getElementById('staffWorkSubnavToggle')) wireToggle();
    else document.addEventListener('DOMContentLoaded', wireToggle);
})();

document.addEventListener('click', function(e) {
    var subnav = document.getElementById('staffWorkSubnav');
    if (subnav && !subnav.contains(e.target)) {
        var toggle = document.getElementById('staffWorkSubnavToggle');
        var dropdown = document.getElementById('staffWorkSubnavDropdown');
        if (toggle) toggle.classList.remove('open');
        if (dropdown) dropdown.classList.remove('show');
    }
});
