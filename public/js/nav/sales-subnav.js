// sales-subnav subnav — externalized from public/components/sales-subnav.html (S9+F5 strict CSP). Loaded by universal-nav-loader.js after the fragment is injected.
(function() {
    var salesPages = [
        { page: 'estimates', label: 'All Estimates', href: '/estimates.html', icon: '<path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>' },
        { page: 'estimate-create', label: 'Create New', href: '/estimate-create-new.html', icon: '<path d="M12 5v14m-7-7h14"/>' },
        { page: 'estimate-requests', label: 'Estimate Requests', href: '/admin-estimate-requests.html', icon: '<path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>' },
        { page: 'estimate-actions', label: 'Actions', href: '/estimate-actions.html', icon: '<path d="M13 10V3L4 14h7v7l9-11h-7z"/>' },
        { page: 'estimate-settings', label: 'Settings', href: '/estimate-settings.html', icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>' }
    ];

    var currentPage = document.body.getAttribute('data-page') || document.documentElement.getAttribute('data-page') || '';
    var currentPageObj = salesPages.find(function(p) { return p.page === currentPage; });

    var tabsContainer = document.getElementById('salesSubnavTabs');
    var dropdownContainer = document.getElementById('salesSubnavDropdown');

    salesPages.forEach(function(p) {
        var isActive = p.page === currentPage;
        var tabHtml = '<a href="' + p.href + '" class="sales-subnav-tab' + (isActive ? ' active' : '') + '" data-sales-page="' + p.page + '">' +
            '<svg viewBox="0 0 24 24">' + p.icon + '</svg>' +
            '<span>' + p.label + '</span>' +
        '</a>';

        tabsContainer.insertAdjacentHTML('beforeend', tabHtml);
        dropdownContainer.insertAdjacentHTML('beforeend', tabHtml);
    });

    if (currentPageObj) {
        document.getElementById('salesSubnavCurrentPage').textContent = currentPageObj.label;
    }

    setTimeout(function() {
        var activeTab = tabsContainer.querySelector('.sales-subnav-tab.active');
        if (activeTab) {
            activeTab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
    }, 100);
})();

function toggleSalesSubnav() {
    var toggle = document.getElementById('salesSubnavToggle');
    var dropdown = document.getElementById('salesSubnavDropdown');
    toggle.classList.toggle('open');
    dropdown.classList.toggle('show');
}

// Wire the mobile dropdown toggle (replaces the former inline onclick on #salesSubnavToggle).
(function () {
    function wireToggle() {
        var toggle = document.getElementById('salesSubnavToggle');
        if (toggle) toggle.addEventListener('click', toggleSalesSubnav);
    }
    if (document.getElementById('salesSubnavToggle')) wireToggle();
    else document.addEventListener('DOMContentLoaded', wireToggle);
})();

document.addEventListener('click', function(e) {
    var subnav = document.getElementById('salesSubnav');
    if (subnav && !subnav.contains(e.target)) {
        var toggle = document.getElementById('salesSubnavToggle');
        var dropdown = document.getElementById('salesSubnavDropdown');
        if (toggle) toggle.classList.remove('open');
        if (dropdown) dropdown.classList.remove('show');
    }
});
