// leads-subnav subnav — externalized from public/components/leads-subnav.html (S9+F5 strict CSP). Loaded by universal-nav-loader.js after the fragment is injected.
(function() {
    var leadsPages = [
        { page: 'leads', label: 'Lead Management', href: '/admin-leads.html', icon: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>' },
        { page: 'customers', label: 'Customers', href: '/admin-customers.html', icon: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>' },
        { page: 'customer-types', label: 'Customer Types', href: '/admin-customer-types.html', icon: '<path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"/>' },
        { page: 'design-requests', label: 'Design Requests', href: '/admin-design-requests.html', icon: '<path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/>' },
        { page: 'lead-scoring', label: 'AI Scoring', href: '/admin-lead-scoring.html', icon: '<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>' },
        { page: 'credit-limits', label: 'Credit Limits', href: '/admin-credit-limits.html', icon: '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/>' }
    ];

    var currentPage = document.body.getAttribute('data-page') || document.documentElement.getAttribute('data-page') || '';
    var currentPageObj = leadsPages.find(function(p) { return p.page === currentPage; });

    var tabsContainer = document.getElementById('leadsSubnavTabs');
    var dropdownContainer = document.getElementById('leadsSubnavDropdown');

    leadsPages.forEach(function(p) {
        var isActive = p.page === currentPage;
        var tabHtml = '<a href="' + p.href + '" class="leads-subnav-tab' + (isActive ? ' active' : '') + '" data-leads-page="' + p.page + '">' +
            '<svg viewBox="0 0 24 24">' + p.icon + '</svg>' +
            '<span>' + p.label + '</span>' +
        '</a>';

        tabsContainer.insertAdjacentHTML('beforeend', tabHtml);
        dropdownContainer.insertAdjacentHTML('beforeend', tabHtml);
    });

    if (currentPageObj) {
        document.getElementById('leadsSubnavCurrentPage').textContent = currentPageObj.label;
    }

    setTimeout(function() {
        var activeTab = tabsContainer.querySelector('.leads-subnav-tab.active');
        if (activeTab) {
            activeTab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
    }, 100);
})();

function toggleLeadsSubnav() {
    var toggle = document.getElementById('leadsSubnavToggle');
    var dropdown = document.getElementById('leadsSubnavDropdown');
    toggle.classList.toggle('open');
    dropdown.classList.toggle('show');
}

// Wire the mobile dropdown toggle (replaces the former inline onclick on #leadsSubnavToggle).
(function () {
    function wireToggle() {
        var toggle = document.getElementById('leadsSubnavToggle');
        if (toggle) toggle.addEventListener('click', toggleLeadsSubnav);
    }
    if (document.getElementById('leadsSubnavToggle')) wireToggle();
    else document.addEventListener('DOMContentLoaded', wireToggle);
})();

document.addEventListener('click', function(e) {
    var subnav = document.getElementById('leadsSubnav');
    if (subnav && !subnav.contains(e.target)) {
        var toggle = document.getElementById('leadsSubnavToggle');
        var dropdown = document.getElementById('leadsSubnavDropdown');
        if (toggle) toggle.classList.remove('open');
        if (dropdown) dropdown.classList.remove('show');
    }
});
