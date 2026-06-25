// zoho-subnav subnav — externalized from public/components/zoho-subnav.html (S9+F5 strict CSP). Loaded by universal-nav-loader.js after the fragment is injected.
(function() {
    // Hide entire subnav for non-admin users
    var isAdmin = false;
    try {
        var user = JSON.parse(localStorage.getItem('user') || '{}');
        isAdmin = user.role === 'admin' || user.role === 'manager' || user.role === 'super_admin' || user.is_admin === true;
    } catch(e) {}
    if (!isAdmin) {
        var subnavEl = document.getElementById('zohoSubnav');
        if (subnavEl) subnavEl.style.display = 'none';
        return;
    }

    var zohoPages = [
        { page: 'zoho-dashboard', label: 'Dashboard', href: '/admin-zoho-dashboard.html', icon: '<path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4"/>' },
        { page: 'zoho-invoices', label: 'Invoices', href: '/admin-zoho-invoices.html', icon: '<path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>' },
        { page: 'zoho-items', label: 'Items', href: '/admin-zoho-items.html', icon: '<path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4"/>' },
        { page: 'zoho-items-edit', label: 'Edit Items', href: '/admin-zoho-items-edit.html', icon: '<path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>' },
        { page: 'zoho-dpl', label: 'DPL Import', href: '/admin-dpl.html', icon: '<path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M9 19l3-3m0 0l3 3m-3-3v12"/>' },
        { page: 'zoho-price-list', label: 'Price List', href: '/admin-price-list-generator.html', icon: '<path d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2zM10 8.5a.5.5 0 11-1 0 .5.5 0 011 0zm5 5a.5.5 0 11-1 0 .5.5 0 011 0z"/>' },
        { page: 'zoho-stock', label: 'Stock', href: '/admin-zoho-stock.html', icon: '<path d="M4 7v10c0 2 1 3 3 3h10c2 0 3-1 3-3V7c0-2-1-3-3-3H7c-2 0-3 1-3 3z"/><path d="M16 2v4M8 2v4M4 10h16"/>' },
        { page: 'zoho-stock-adjust', label: 'Stock Adjust', href: '/admin-zoho-stock-adjust.html', icon: '<path d="M12 6v6m0 0v6m0-6h6m-6 0H6"/>' },
        { page: 'zoho-stock-check', label: 'Stock Check', href: '/admin-stock-check.html', icon: '<path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"/>' },
        { page: 'zoho-locations', label: 'Locations', href: '/admin-zoho-locations.html', icon: '<path d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>' },
        { page: 'zoho-reorder', label: 'Reorder', href: '/admin-zoho-reorder.html', icon: '<path d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"/>' },
        { page: 'zoho-purchase-suggestions', label: 'Purchase Orders', href: '/admin-zoho-purchase-suggestions.html', icon: '<path d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 100 4 2 2 0 000-4z"/>' },
        { page: 'zoho-transactions', label: 'Transactions', href: '/admin-zoho-transactions.html', icon: '<path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>' },
        { page: 'zoho-collections', label: 'Collections', href: '/admin-zoho-collections.html', icon: '<path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>' },
        { page: 'zoho-bulk-jobs', label: 'Bulk Jobs', href: '/admin-zoho-bulk-jobs.html', icon: '<path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>' },
        { page: 'zoho-reports', label: 'Reports', href: '/admin-zoho-reports.html', icon: '<path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>' },
        { page: 'zoho-stock-migrate', label: 'Stock Migration', href: '/admin-stock-migration.html', icon: '<path d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"/>' },
        { page: 'item-master', label: 'Item Master', href: '/admin-item-master.html', icon: '<path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/>' },
        { page: 'zoho-settings', label: 'Settings', href: '/admin-zoho-settings.html', icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>' }
    ];

    // Detect current page
    var currentPage = document.body.getAttribute('data-page') || document.documentElement.getAttribute('data-page') || '';
    var currentPageObj = zohoPages.find(function(p) { return p.page === currentPage; });

    // Build tabs for desktop
    var tabsContainer = document.getElementById('zohoSubnavTabs');
    var dropdownContainer = document.getElementById('zohoSubnavDropdown');

    zohoPages.forEach(function(p) {
        var isActive = p.page === currentPage;
        var tabHtml = '<a href="' + p.href + '" class="zoho-subnav-tab' + (isActive ? ' active' : '') + '" data-zoho-page="' + p.page + '">' +
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
        document.getElementById('zohoSubnavCurrentPage').textContent = currentPageObj.label;
    }

    // Scroll active tab into view on desktop
    setTimeout(function() {
        var activeTab = tabsContainer.querySelector('.zoho-subnav-tab.active');
        if (activeTab) {
            activeTab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
    }, 100);
})();

function toggleZohoSubnav() {
    var toggle = document.getElementById('zohoSubnavToggle');
    var dropdown = document.getElementById('zohoSubnavDropdown');
    toggle.classList.toggle('open');
    dropdown.classList.toggle('show');
}

// Wire the mobile dropdown toggle (replaces the former inline onclick on #zohoSubnavToggle).
(function () {
    function wireToggle() {
        var toggle = document.getElementById('zohoSubnavToggle');
        if (toggle) toggle.addEventListener('click', toggleZohoSubnav);
    }
    if (document.getElementById('zohoSubnavToggle')) wireToggle();
    else document.addEventListener('DOMContentLoaded', wireToggle);
})();

// Close dropdown when clicking outside
document.addEventListener('click', function(e) {
    var subnav = document.getElementById('zohoSubnav');
    if (subnav && !subnav.contains(e.target)) {
        var toggle = document.getElementById('zohoSubnavToggle');
        var dropdown = document.getElementById('zohoSubnavDropdown');
        if (toggle) toggle.classList.remove('open');
        if (dropdown) dropdown.classList.remove('show');
    }
});
