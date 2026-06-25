// salary-subnav subnav — externalized from public/components/salary-subnav.html (S9+F5 strict CSP). Loaded by universal-nav-loader.js after the fragment is injected.
(function() {
    var salaryPages = [
        { page: 'salary-config', label: 'Salary Config', href: '/admin-salary-config.html', icon: '<path d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/><circle cx="12" cy="12" r="3"/>' },
        { page: 'salary-monthly', label: 'Monthly Salary', href: '/admin-salary-monthly.html', icon: '<path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/>' },
        { page: 'salary-payments', label: 'Payments', href: '/admin-salary-payments.html', icon: '<path d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"/>' },
        { page: 'salary-advances', label: 'Advances', href: '/admin-salary-advances.html', icon: '<path d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>' },
        { page: 'salary-incentives', label: 'Incentives', href: '/admin-salary-incentives.html', icon: '<path d="M5 3l3.057-3L12 4l3.943-4L19 3l2 2-4 4-5-2-5 2-4-4 2-2zM12 12l-4 4h8l-4-4z"/><path d="M8 16h8v5H8z"/>' },
        { page: 'salary-reports', label: 'Reports', href: '/admin-salary-reports.html', icon: '<path d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"/>' }
    ];

    var currentPage = document.body.getAttribute('data-page') || document.documentElement.getAttribute('data-page') || '';
    var currentPageObj = salaryPages.find(function(p) { return p.page === currentPage; });

    var tabsContainer = document.getElementById('salarySubnavTabs');
    var dropdownContainer = document.getElementById('salarySubnavDropdown');

    salaryPages.forEach(function(p) {
        var isActive = p.page === currentPage;
        var tabHtml = '<a href="' + p.href + '" class="salary-subnav-tab' + (isActive ? ' active' : '') + '" data-salary-page="' + p.page + '">' +
            '<svg viewBox="0 0 24 24">' + p.icon + '</svg>' +
            '<span>' + p.label + '</span>' +
        '</a>';

        tabsContainer.insertAdjacentHTML('beforeend', tabHtml);
        dropdownContainer.insertAdjacentHTML('beforeend', tabHtml);
    });

    if (currentPageObj) {
        document.getElementById('salarySubnavCurrentPage').textContent = currentPageObj.label;
    }

    setTimeout(function() {
        var activeTab = tabsContainer.querySelector('.salary-subnav-tab.active');
        if (activeTab) {
            activeTab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        }
    }, 100);
})();

function toggleSalarySubnav() {
    var toggle = document.getElementById('salarySubnavToggle');
    var dropdown = document.getElementById('salarySubnavDropdown');
    toggle.classList.toggle('open');
    dropdown.classList.toggle('show');
}

// Wire the mobile dropdown toggle (replaces the former inline onclick on #salarySubnavToggle).
(function () {
    function wireToggle() {
        var toggle = document.getElementById('salarySubnavToggle');
        if (toggle) toggle.addEventListener('click', toggleSalarySubnav);
    }
    if (document.getElementById('salarySubnavToggle')) wireToggle();
    else document.addEventListener('DOMContentLoaded', wireToggle);
})();

document.addEventListener('click', function(e) {
    var subnav = document.getElementById('salarySubnav');
    if (subnav && !subnav.contains(e.target)) {
        var toggle = document.getElementById('salarySubnavToggle');
        var dropdown = document.getElementById('salarySubnavDropdown');
        if (toggle) toggle.classList.remove('open');
        if (dropdown) dropdown.classList.remove('show');
    }
});
