// sidebar-complete — externalized from public/components/sidebar-complete.html (S9+F5 strict CSP).
// Loaded by universal-nav-loader.js after the admin sidebar fragment is injected.

// ═══════════════════════════════════════════════════════════════
// SIDEBAR CONTROLS  –  Hover-to-preview  +  Click-to-pin
//
// DESKTOP (≥ 768 px):
//   • Sidebar starts as a collapsed 60 px icon rail.
//   • Hovering ANYWHERE on the rail (top to bottom) auto-expands
//     the sidebar to full width.  It stays open while the cursor
//     is inside the sidebar area.
//   • Moving the cursor out collapses it back (after a short
//     debounce to avoid flicker).
//   • Clicking the 3-dash toggle button inside the sidebar header
//     PINS the sidebar open.  It stays expanded until:
//       – the user clicks the toggle again, OR
//       – the user clicks anywhere on the dashboard area.
//   • The 3-dash toggle replaces the old header hamburger on
//     desktop.  It lives inside the sidebar itself.
//
// MOBILE (< 768 px):
//   • Header hamburger opens / closes the slide-in sidebar +
//     overlay (unchanged).
// ═══════════════════════════════════════════════════════════════

let sidebarPinned  = false;   // true = click-locked open
let hoverActive    = false;   // true = expanded via hover
let hoverLeaveTimer = null;
const HOVER_DELAY  = 200;     // ms debounce before collapsing

// ── helpers ──

function expandSidebar() {
    const s = document.getElementById('mainSidebar');
    s.classList.remove('collapsed');
    document.body.classList.remove('sidebar-collapsed');
}

function collapseSidebar() {
    const s = document.getElementById('mainSidebar');
    s.classList.add('collapsed');
    document.body.classList.add('sidebar-collapsed');
}

// ── toggle (click the 3-dash button inside sidebar) ──

function toggleSidebar() {
    const sidebar  = document.getElementById('mainSidebar');
    const overlay  = document.getElementById('sidebarOverlay');
    const isDesktop = window.innerWidth >= 768;

    if (isDesktop) {
        if (sidebarPinned) {
            // unpin → collapse
            sidebarPinned = false;
            hoverActive   = false;
            collapseSidebar();
            localStorage.setItem('sidebarCollapsed', 'true');
            document.removeEventListener('click', handleClickOutside, true);
        } else {
            // pin open
            clearTimeout(hoverLeaveTimer);
            sidebarPinned = true;
            hoverActive   = false;
            expandSidebar();
            localStorage.setItem('sidebarCollapsed', 'false');
            setTimeout(() => {
                document.addEventListener('click', handleClickOutside, true);
            }, 60);
        }
    } else {
        // mobile slide-in toggle
        sidebar.classList.toggle('open');
        overlay.classList.toggle('show');
    }
}

function closeSidebar() {
    const sidebar = document.getElementById('mainSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const isDesktop = window.innerWidth >= 768;

    if (isDesktop) {
        sidebarPinned = false;
        hoverActive   = false;
        collapseSidebar();
        localStorage.setItem('sidebarCollapsed', 'true');
        document.removeEventListener('click', handleClickOutside, true);
    } else {
        sidebar.classList.remove('open');
        overlay.classList.remove('show');
    }
}

// ── click-outside (active only when pinned) ──

function handleClickOutside(e) {
    const sidebar = document.getElementById('mainSidebar');
    if (!sidebar || window.innerWidth < 768) return;

    if (sidebar.classList.contains('collapsed')) {
        sidebarPinned = false;
        document.removeEventListener('click', handleClickOutside, true);
        return;
    }

    // click inside sidebar → ignore
    if (sidebar.contains(e.target)) return;

    // click on mobile hamburger in header → let toggleSidebar handle it
    const headerHamburger = document.getElementById('hamburgerBtn');
    if (headerHamburger && headerHamburger.contains(e.target)) return;

    // click on dashboard → unpin & collapse
    closeSidebar();
}

// ── hover on the sidebar rail (desktop) ──

function onSidebarMouseEnter() {
    if (window.innerWidth < 768 || sidebarPinned) return;
    clearTimeout(hoverLeaveTimer);
    hoverActive = true;
    expandSidebar();
}

function onSidebarMouseLeave() {
    if (window.innerWidth < 768 || sidebarPinned) return;

    hoverLeaveTimer = setTimeout(() => {
        if (!sidebarPinned && hoverActive) {
            hoverActive = false;
            collapseSidebar();
        }
    }, HOVER_DELAY);
}

// ── wire up all listeners ──

function attachSidebarListeners() {
    const sidebar       = document.getElementById('mainSidebar');
    const toggleBtn     = document.getElementById('sidebarToggleBtn');
    const headerHamburger = document.getElementById('hamburgerBtn');

    if (!sidebar) return;

    // Sidebar toggle button (inside sidebar header) – click to pin/unpin
    if (toggleBtn) {
        toggleBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            toggleSidebar();
        });
    }

    // Header hamburger (mobile fallback) – click to open/close
    if (headerHamburger) {
        headerHamburger.addEventListener('click', function(e) {
            e.stopPropagation();
            toggleSidebar();
        });
    }

    // Hover on the ENTIRE sidebar (whether collapsed rail or expanded)
    sidebar.addEventListener('mouseenter', onSidebarMouseEnter);
    sidebar.addEventListener('mouseleave', onSidebarMouseLeave);
}

// ── restore persisted state ──

function restoreSidebarState() {
    if (window.innerWidth < 768) return;

    const saved = localStorage.getItem('sidebarCollapsed');
    const shouldCollapse = saved !== 'false';   // default = collapsed

    if (shouldCollapse) {
        collapseSidebar();
        sidebarPinned = false;
    } else {
        expandSidebar();
        sidebarPinned = true;
        setTimeout(() => {
            document.addEventListener('click', handleClickOutside, true);
        }, 100);
    }
}

// ── highlight active page ──

function highlightActiveSidebarPage() {
    const path = window.location.pathname;
    document.querySelectorAll('.qc-nav-item[data-page]').forEach(item => {
        if (path.includes(item.getAttribute('data-page'))) {
            item.classList.add('active');
        }
    });
}

// ── logout ──

function logoutUser() {
    if (confirm('Are you sure you want to logout?')) {
        localStorage.removeItem('auth_token');
        localStorage.removeItem('user');
        window.location.href = '/login.html';
    }
}

// ── responsive resize ──

window.addEventListener('resize', function() {
    const sidebar = document.getElementById('mainSidebar');
    const isDesktop = window.innerWidth >= 768;

    if (!isDesktop) {
        document.removeEventListener('click', handleClickOutside, true);
        sidebar.classList.remove('collapsed');
        document.body.classList.remove('sidebar-collapsed');
        sidebarPinned = false;
        hoverActive   = false;
        clearTimeout(hoverLeaveTimer);
    } else {
        sidebar.classList.remove('open');
        document.getElementById('sidebarOverlay').classList.remove('show');
        restoreSidebarState();
    }
});

// ── role-based nav filtering ──

function filterNavByRole() {
    let userRole = null;
    try {
        const user = JSON.parse(localStorage.getItem('user'));
        userRole = user && user.role ? String(user.role).toLowerCase() : null;
    } catch (e) {}

    // Admin / administrator / super_admin see everything — no filtering needed.
    const FULL_ADMIN = ['admin', 'administrator', 'super_admin'];
    if (!userRole || FULL_ADMIN.includes(userRole)) return;

    // For role matching, treat administrator+super_admin as 'admin' so that
    // any data-roles="admin,..." entries are visible to them too.
    const matchRole = userRole;

    // Hide sections restricted to other roles
    document.querySelectorAll('.qc-nav-section[data-roles]').forEach(section => {
        const allowed = section.getAttribute('data-roles').split(',').map(s => s.trim().toLowerCase());
        if (!allowed.includes(matchRole)) {
            section.style.display = 'none';
        }
    });

    // Hide individual items restricted to other roles
    document.querySelectorAll('.qc-nav-item[data-roles]').forEach(item => {
        const allowed = item.getAttribute('data-roles').split(',').map(s => s.trim().toLowerCase());
        if (!allowed.includes(matchRole)) {
            item.style.display = 'none';
        }
    });

    // Hide dividers that are next to hidden sections
    document.querySelectorAll('.qc-nav-divider').forEach(divider => {
        const next = divider.nextElementSibling;
        const prev = divider.previousElementSibling;
        const nextHidden = next && next.style.display === 'none';
        const prevHidden = prev && prev.style.display === 'none';
        if (nextHidden || prevHidden) {
            divider.style.display = 'none';
        }
    });

    // Hide section titles if all visible items in that section are gone
    document.querySelectorAll('.qc-nav-section').forEach(section => {
        if (section.style.display === 'none') return;
        const visibleItems = section.querySelectorAll('.qc-nav-item:not([style*="display: none"])');
        if (visibleItems.length === 0) {
            section.style.display = 'none';
        }
    });
}

// ── init ──

function highlightQuickbar() {
    const path = window.location.pathname;
    document.querySelectorAll('.qc-quickbar-item[data-qb-page]').forEach(item => {
        const page = item.getAttribute('data-qb-page');
        if (path.includes(page)) {
            item.classList.add('active');
        }
    });
}

function initSidebar() {
    filterNavByRole();
    restoreSidebarState();
    highlightActiveSidebarPage();
    highlightQuickbar();
    attachSidebarListeners();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSidebar);
} else {
    initSidebar();
}

// Wire the former inline onclick handlers (S9+F5 CSP externalization).
// 13 section toggles -> ONE delegated .qc-nav-section-toggle listener (clicks land
// on inner span/svg, so use closest); overlay + .qc-sidebar-close -> closeSidebar;
// .qc-sidebar-logout -> logoutUser; mobile menu -> toggleSidebar.
(function () {
    function wireSidebarCompleteHandlers() {
        var sidebar = document.querySelector('.qc-sidebar');
        if (sidebar && window.qcToggleNavSection) {
            sidebar.addEventListener('click', function (e) {
                var btn = e.target.closest('.qc-nav-section-toggle');
                if (btn) window.qcToggleNavSection(btn);
            });
        }
        var overlay = document.getElementById('sidebarOverlay');
        if (overlay) overlay.addEventListener('click', closeSidebar);
        var closeBtn = document.querySelector('.qc-sidebar-close');
        if (closeBtn) closeBtn.addEventListener('click', closeSidebar);
        var logoutBtn = document.querySelector('.qc-sidebar-logout');
        if (logoutBtn) logoutBtn.addEventListener('click', logoutUser);
        var menuBtn = document.querySelector('#mobileQuickbar .qc-quickbar-item[data-action="toggle-sidebar"]');
        if (menuBtn) menuBtn.addEventListener('click', toggleSidebar);
    }
    if (document.querySelector('.qc-sidebar')) wireSidebarCompleteHandlers();
    else document.addEventListener('DOMContentLoaded', wireSidebarCompleteHandlers);
})();
