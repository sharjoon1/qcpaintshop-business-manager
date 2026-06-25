// whatsapp-subnav subnav — externalized from public/components/whatsapp-subnav.html (S9+F5 strict CSP). Loaded by universal-nav-loader.js after the fragment is injected.
(function() {
    var waPages = [
        { page: 'wa-dashboard', label: 'Dashboard', href: '/admin-wa-dashboard.html', icon: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>' },
        { page: 'whatsapp-chat', label: 'Chat', href: '/admin-whatsapp-chat.html', icon: '<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>' },
        { page: 'wa-contacts', label: 'Contacts', href: '/admin-wa-contacts.html', icon: '<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>' },
        { page: 'wa-marketing', label: 'Campaigns', href: '/admin-wa-marketing.html', icon: '<path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>' },
        { page: 'wa-templates', label: 'Templates', href: '/admin-wa-templates.html', icon: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>' },
        { page: 'whatsapp-sessions', label: 'Sessions', href: '/admin-whatsapp-sessions.html', icon: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>' },
        { page: 'wa-admin-login', label: 'Admin Login', href: '/admin-wa-admin-login.html', icon: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>' },
        { page: 'wa-settings', label: 'Settings', href: '/admin-wa-settings.html', icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>' }
    ];

    var currentPage = document.body.getAttribute('data-page') || '';
    var currentPageObj = waPages.find(function(p) { return p.page === currentPage; });

    var tabsContainer = document.getElementById('waSubnavTabs');
    var dropdownContainer = document.getElementById('waSubnavDropdown');

    waPages.forEach(function(p) {
        var isActive = p.page === currentPage;
        var tabHtml = '<a href="' + p.href + '" class="wa-subnav-tab' + (isActive ? ' active' : '') + '">' +
            '<svg viewBox="0 0 24 24">' + p.icon + '</svg>' +
            '<span>' + p.label + '</span>' +
        '</a>';
        tabsContainer.insertAdjacentHTML('beforeend', tabHtml);
        dropdownContainer.insertAdjacentHTML('beforeend', tabHtml);
    });

    if (currentPageObj) {
        document.getElementById('waSubnavCurrentPage').textContent = currentPageObj.label;
    }
})();

function toggleWaSubnav() {
    var toggle = document.getElementById('waSubnavToggle');
    var dropdown = document.getElementById('waSubnavDropdown');
    toggle.classList.toggle('open');
    dropdown.classList.toggle('show');
}

// Wire the mobile dropdown toggle (replaces the former inline onclick on #waSubnavToggle).
(function () {
    function wireToggle() {
        var toggle = document.getElementById('waSubnavToggle');
        if (toggle) toggle.addEventListener('click', toggleWaSubnav);
    }
    if (document.getElementById('waSubnavToggle')) wireToggle();
    else document.addEventListener('DOMContentLoaded', wireToggle);
})();

document.addEventListener('click', function(e) {
    var subnav = document.getElementById('waSubnav');
    if (subnav && !subnav.contains(e.target)) {
        var toggle = document.getElementById('waSubnavToggle');
        var dropdown = document.getElementById('waSubnavDropdown');
        if (toggle) toggle.classList.remove('open');
        if (dropdown) dropdown.classList.remove('show');
    }
});
