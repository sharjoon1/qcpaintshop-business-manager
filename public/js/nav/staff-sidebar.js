// staff-sidebar — externalized from public/components/staff-sidebar.html (S9+F5 strict CSP).
// Loaded by universal-nav-loader.js after the staff-sidebar fragment is injected.

// ═══════════════════════════════════════════════════════════════
// STAFF SIDEBAR CONTROLS  –  Hover-to-preview  +  Click-to-pin
// (mirrors sidebar-complete.html behavior exactly)
// ═══════════════════════════════════════════════════════════════

let sidebarPinned   = false;
let hoverActive     = false;
let hoverLeaveTimer = null;
const HOVER_DELAY   = 200;

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
    const sidebar = document.getElementById('mainSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const isDesktop = window.innerWidth >= 768;

    if (isDesktop) {
        if (sidebarPinned) {
            sidebarPinned = false;
            hoverActive   = false;
            collapseSidebar();
            localStorage.setItem('staffSidebarCollapsed', 'true');
            document.removeEventListener('click', handleClickOutside, true);
        } else {
            clearTimeout(hoverLeaveTimer);
            sidebarPinned = true;
            hoverActive   = false;
            expandSidebar();
            localStorage.setItem('staffSidebarCollapsed', 'false');
            setTimeout(() => {
                document.addEventListener('click', handleClickOutside, true);
            }, 60);
        }
    } else {
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
        localStorage.setItem('staffSidebarCollapsed', 'true');
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

    if (sidebar.contains(e.target)) return;

    const headerHamburger = document.getElementById('hamburgerBtn');
    if (headerHamburger && headerHamburger.contains(e.target)) return;

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

    if (toggleBtn) {
        toggleBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            toggleSidebar();
        });
    }

    if (headerHamburger) {
        headerHamburger.addEventListener('click', function(e) {
            e.stopPropagation();
            toggleSidebar();
        });
    }

    sidebar.addEventListener('mouseenter', onSidebarMouseEnter);
    sidebar.addEventListener('mouseleave', onSidebarMouseLeave);
}

// ── restore persisted state ──

function restoreSidebarState() {
    if (window.innerWidth < 768) return;

    const saved = localStorage.getItem('staffSidebarCollapsed');
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

// ── Load User Info into Sidebar ──

function loadSidebarUserInfo() {
    const user = JSON.parse(localStorage.getItem('user') || '{}');

    const nameEl = document.getElementById('sidebarName');
    if (nameEl && user.full_name) {
        nameEl.textContent = user.full_name;
    }

    const roleEl = document.getElementById('sidebarRole');
    if (roleEl && user.role) {
        roleEl.textContent = user.role.charAt(0).toUpperCase() + user.role.slice(1);
    }

    const branchEl = document.getElementById('sidebarBranch');
    if (branchEl && user.branch_name) {
        branchEl.textContent = user.branch_name;
    }

    const avatarEl = document.getElementById('sidebarAvatar');
    const initialEl = document.getElementById('sidebarInitial');

    if (user.profile_image_url) {
        // Escape for the attribute context (F1). Always use this local strict
        // escaper: some host pages define a window.escHtml that doesn't encode
        // quotes (textContent→innerHTML trick) — unsafe inside a double-quoted
        // attribute, so never delegate to the host's helper here.
        const escSafe = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        }[c]));
        avatarEl.innerHTML = `<img src="${escSafe(user.profile_image_url)}" alt="Profile">`;
    } else if (user.full_name && initialEl) {
        initialEl.textContent = user.full_name.charAt(0).toUpperCase();
    }
}

// ── Highlight Active Page ──

function highlightActiveSidebarPage() {
    const path = window.location.pathname;
    document.querySelectorAll('.qc-nav-item[data-page]').forEach(item => {
        const page = item.getAttribute('data-page');
        if (path.includes(page)) {
            item.classList.add('active');
        }
    });
}

// ── Filter sidebar items by user permissions ──
// ALWAYS fetches fresh from API (no stale cache issues when admin updates permissions)

async function filterSidebarByPermissions() {
    try {
        const token = localStorage.getItem('auth_token');
        if (!token) return;

        // Get user role for role-based filtering
        let userRole = null;
        try {
            const user = JSON.parse(localStorage.getItem('user'));
            userRole = user && user.role;
        } catch(e) {}

        const resp = await fetch('/api/auth/permissions', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (!resp.ok) return;
        const permData = await resp.json();

        // Update localStorage cache for other pages (PermissionManager, credit-limits page, etc.)
        permData.timestamp = Date.now();
        permData.loadedAt = Date.now();
        localStorage.setItem('user_permissions', JSON.stringify(permData));

        // Sync role from server → localStorage (keeps UI in sync after admin changes role)
        if (permData.role) {
            userRole = permData.role;
            try {
                const u = JSON.parse(localStorage.getItem('user') || '{}');
                if (u.role !== permData.role) {
                    u.role = permData.role;
                    localStorage.setItem('user', JSON.stringify(u));
                }
            } catch(e) {}
        }

        // Admin bypass — show everything
        if (permData.is_admin) return;

        // Build permission set for fast lookup
        const permSet = new Set();
        if (Array.isArray(permData.permissions)) {
            permData.permissions.forEach(p => permSet.add(`${p.module}.${p.action}`));
        }

        // Hide items gated by data-requires (permission-based)
        document.querySelectorAll('[data-requires]').forEach(el => {
            const required = el.getAttribute('data-requires');
            if (!permSet.has(required)) {
                el.style.display = 'none';
            }
        });

        // Hide items gated by data-roles (role-based)
        if (userRole) {
            document.querySelectorAll('.qc-nav-section[data-roles]').forEach(section => {
                const allowed = section.getAttribute('data-roles').split(',');
                if (!allowed.includes(userRole)) {
                    section.style.display = 'none';
                }
            });
            document.querySelectorAll('.qc-nav-item[data-roles]').forEach(item => {
                const allowed = item.getAttribute('data-roles').split(',');
                if (!allowed.includes(userRole)) {
                    item.style.display = 'none';
                }
            });
        }

        // Hide sections where ALL nav items are hidden
        document.querySelectorAll('.qc-nav-section').forEach(section => {
            if (section.style.display === 'none') return;
            const items = section.querySelectorAll('.qc-nav-item');
            if (items.length === 0) return;
            const allHidden = Array.from(items).every(item => item.style.display === 'none');
            if (allHidden) {
                section.style.display = 'none';
            }
        });

        // Hide dividers next to hidden sections
        document.querySelectorAll('.qc-nav-divider').forEach(divider => {
            const next = divider.nextElementSibling;
            const prev = divider.previousElementSibling;
            const nextHidden = next && next.style.display === 'none';
            const prevHidden = prev && prev.style.display === 'none';
            if (nextHidden || prevHidden) {
                divider.style.display = 'none';
            }
        });
    } catch(e) {
        // On error, leave sidebar as-is (show all)
    }
}

// ── Logout ──

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
    loadSidebarUserInfo();
    highlightActiveSidebarPage();
    highlightQuickbar();
    filterSidebarByPermissions();
    restoreSidebarState();
    attachSidebarListeners();
    // Debug: log sidebar nav items count
    var navItems = document.querySelectorAll('#mainSidebar .qc-nav-item');
    console.log('[Sidebar] Staff sidebar loaded with ' + navItems.length + ' nav items');
    var creditItem = document.querySelector('[data-page="credit-limits"]');
    console.log('[Sidebar] Credit Limits item:', creditItem ? 'FOUND' : 'MISSING');
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSidebar);
} else {
    initSidebar();
}

// Wire the former inline onclick handlers (S9+F5 CSP externalization).
// Replaces: overlay onclick=closeSidebar, .qc-sidebar-close onclick=closeSidebar,
// .qc-sidebar-logout onclick=logoutUser, mobile menu onclick=toggleSidebar.
(function () {
    function wireStaffSidebarHandlers() {
        var overlay = document.getElementById('sidebarOverlay');
        if (overlay) overlay.addEventListener('click', closeSidebar);

        var closeBtn = document.querySelector('.qc-sidebar-close');
        if (closeBtn) closeBtn.addEventListener('click', closeSidebar);

        var logoutBtn = document.querySelector('.qc-sidebar-logout');
        if (logoutBtn) logoutBtn.addEventListener('click', logoutUser);

        var menuBtn = document.querySelector('#mobileQuickbar .qc-quickbar-item[data-action="toggle-sidebar"]');
        if (menuBtn) menuBtn.addEventListener('click', toggleSidebar);
    }
    if (document.getElementById('mainSidebar')) wireStaffSidebarHandlers();
    else document.addEventListener('DOMContentLoaded', wireStaffSidebarHandlers);
})();
