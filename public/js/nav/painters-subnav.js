// painters-subnav subnav — externalized from public/components/painters-subnav.html (S9+F5 strict CSP). Loaded by universal-nav-loader.js after the fragment is injected.
(function() {
    var painterPages = [
        { page: 'painters', label: 'Painters', href: '/admin-painters.html', icon: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>' },
        { page: 'painter-points', label: 'Points & Invoices', href: '/admin-painters.html?tab=points', icon: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>' },
        { page: 'painter-rates', label: 'Rates & Slabs', href: '/admin-painters.html?tab=rates', icon: '<line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>' },
        { page: 'painter-withdrawals', label: 'Withdrawals', href: '/admin-painters.html?tab=withdrawals', icon: '<rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/>' },
        { page: 'painter-reports', label: 'Referrals & Reports', href: '/admin-painters.html?tab=reports', icon: '<path d="M9 19v-6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2zm0 0V9a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v10m-6 0a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2m0 0V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-2a2 2 0 0 1-2-2z"/>' }
    ];

    var currentPage = document.body.getAttribute('data-page') || '';
    var currentPageObj = painterPages.find(function(p) { return p.page === currentPage; }) || painterPages[0];

    var tabsContainer = document.getElementById('paintersSubnavTabs');
    var dropdownContainer = document.getElementById('paintersSubnavDropdown');

    painterPages.forEach(function(p) {
        var isActive = p.page === currentPage || (currentPage === 'painters' && p.page === 'painters');
        var tabHtml = '<a href="' + p.href + '" class="painters-subnav-tab' + (isActive ? ' active' : '') + '" data-painter-page="' + p.page + '">' +
            '<svg viewBox="0 0 24 24">' + p.icon + '</svg>' +
            '<span>' + p.label + '</span>' +
        '</a>';

        tabsContainer.insertAdjacentHTML('beforeend', tabHtml);
        dropdownContainer.insertAdjacentHTML('beforeend', tabHtml);
    });

    if (currentPageObj) {
        document.getElementById('paintersSubnavCurrentPage').textContent = currentPageObj.label;
    }

    setTimeout(function() {
        var activeTab = tabsContainer.querySelector('.painters-subnav-tab.active');
        if (activeTab) {
            activeTab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
    }, 100);
})();

function togglePaintersSubnav() {
    var toggle = document.getElementById('paintersSubnavToggle');
    var dropdown = document.getElementById('paintersSubnavDropdown');
    toggle.classList.toggle('open');
    dropdown.classList.toggle('show');
}

// Wire the mobile dropdown toggle (replaces the former inline onclick on #paintersSubnavToggle).
(function () {
    function wireToggle() {
        var toggle = document.getElementById('paintersSubnavToggle');
        if (toggle) toggle.addEventListener('click', togglePaintersSubnav);
    }
    if (document.getElementById('paintersSubnavToggle')) wireToggle();
    else document.addEventListener('DOMContentLoaded', wireToggle);
})();

document.addEventListener('click', function(e) {
    var subnav = document.getElementById('paintersSubnav');
    if (subnav && !subnav.contains(e.target)) {
        var toggle = document.getElementById('paintersSubnavToggle');
        var dropdown = document.getElementById('paintersSubnavDropdown');
        if (toggle) toggle.classList.remove('open');
        if (dropdown) dropdown.classList.remove('show');
    }
});
