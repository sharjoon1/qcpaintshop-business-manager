// marketing-subnav subnav — externalized from public/components/marketing-subnav.html (S9+F5 strict CSP). Loaded by universal-nav-loader.js after the fragment is injected.
(function() {
    var mktPages = [
        { page: 'marketing-dashboard', label: 'WA Marketing', href: '/admin-wa-marketing.html', icon: '<path d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>' }
    ];

    var currentPage = document.body.getAttribute('data-page') || '';
    var currentPageObj = mktPages.find(function(p) { return p.page === currentPage; });

    var tabsContainer = document.getElementById('mktSubnavTabs');
    var dropdownContainer = document.getElementById('mktSubnavDropdown');

    mktPages.forEach(function(p) {
        var isActive = p.page === currentPage;
        var tabHtml = '<a href="' + p.href + '" class="mkt-subnav-tab' + (isActive ? ' active' : '') + '">' +
            '<svg viewBox="0 0 24 24">' + p.icon + '</svg>' +
            '<span>' + p.label + '</span>' +
        '</a>';
        tabsContainer.insertAdjacentHTML('beforeend', tabHtml);
        dropdownContainer.insertAdjacentHTML('beforeend', tabHtml);
    });

    if (currentPageObj) {
        document.getElementById('mktSubnavCurrentPage').textContent = currentPageObj.label;
    }
})();

function toggleMktSubnav() {
    var toggle = document.getElementById('mktSubnavToggle');
    var dropdown = document.getElementById('mktSubnavDropdown');
    toggle.classList.toggle('open');
    dropdown.classList.toggle('show');
}

// Wire the mobile dropdown toggle (replaces the former inline onclick on #mktSubnavToggle).
(function () {
    function wireToggle() {
        var toggle = document.getElementById('mktSubnavToggle');
        if (toggle) toggle.addEventListener('click', toggleMktSubnav);
    }
    if (document.getElementById('mktSubnavToggle')) wireToggle();
    else document.addEventListener('DOMContentLoaded', wireToggle);
})();

document.addEventListener('click', function(e) {
    var subnav = document.getElementById('mktSubnav');
    if (subnav && !subnav.contains(e.target)) {
        var toggle = document.getElementById('mktSubnavToggle');
        var dropdown = document.getElementById('mktSubnavDropdown');
        if (toggle) toggle.classList.remove('open');
        if (dropdown) dropdown.classList.remove('show');
    }
});
