/**
 * Universal Navigation Loader v3.0 - Production Ready
 * Robust component loading with comprehensive error handling
 */

(function() {
    'use strict';
    
    // Determine sidebar based on user role.
    // Admin-level roles (admin / administrator / super_admin / manager /
    // branch_manager) get the full admin sidebar; everyone else gets the
    // staff sidebar.
    let sidebarPath = '/components/sidebar-complete.html';
    const ADMIN_LEVEL_ROLES = ['admin', 'administrator', 'super_admin', 'manager', 'branch_manager'];
    try {
        const u = JSON.parse(localStorage.getItem('user') || '{}');
        const role = u.role ? String(u.role).toLowerCase() : '';
        if (role && !ADMIN_LEVEL_ROLES.includes(role)) {
            sidebarPath = '/components/staff-sidebar.html';
        }
    } catch(e) {}

    // Configuration
    const CONFIG = {
        HEADER_PATH: '/components/header-v2.html',
        SIDEBAR_PATH: sidebarPath,
        ZOHO_SUBNAV_PATH: '/components/zoho-subnav.html',
        ATTENDANCE_SUBNAV_PATH: '/components/attendance-subnav.html',
        LEADS_SUBNAV_PATH: '/components/leads-subnav.html',
        BRANCHES_SUBNAV_PATH: '/components/branches-subnav.html',
        SALARY_SUBNAV_PATH: '/components/salary-subnav.html',
        SALES_SUBNAV_PATH: '/components/sales-subnav.html',
        PRODUCTS_SUBNAV_PATH: '/components/products-subnav.html',
        SYSTEM_SUBNAV_PATH: '/components/system-subnav.html',
        MARKETING_SUBNAV_PATH: '/components/marketing-subnav.html',
        WHATSAPP_SUBNAV_PATH: '/components/whatsapp-subnav.html',
        PAINTERS_SUBNAV_PATH: '/components/painters-subnav.html',
        STAFF_WORK_SUBNAV_PATH: '/components/staff-work-subnav.html',
        RETRY_ATTEMPTS: 3,
        RETRY_DELAY: 1000
    };

    // Map data-page values to subnav component paths
    const SUBNAV_MAP = {
        // Leads & CRM
        'leads': CONFIG.LEADS_SUBNAV_PATH,
        'customers': CONFIG.LEADS_SUBNAV_PATH,
        'customer-types': CONFIG.LEADS_SUBNAV_PATH,
        'credit-limits': CONFIG.LEADS_SUBNAV_PATH,
        'design-requests': CONFIG.LEADS_SUBNAV_PATH,
        'lead-scoring': CONFIG.LEADS_SUBNAV_PATH,
        // Branches & Staff
        'branches': CONFIG.BRANCHES_SUBNAV_PATH,
        'staff': CONFIG.BRANCHES_SUBNAV_PATH,
        'staff-registrations': CONFIG.BRANCHES_SUBNAV_PATH,
        'roles': CONFIG.BRANCHES_SUBNAV_PATH,
        'permissions': CONFIG.BRANCHES_SUBNAV_PATH,
        // HR & Attendance (admin pages)
        'admin-tasks': CONFIG.ATTENDANCE_SUBNAV_PATH,
        'admin-daily-tasks': CONFIG.ATTENDANCE_SUBNAV_PATH,
        'activity-monitor': CONFIG.ATTENDANCE_SUBNAV_PATH,
        'geofence-logs': CONFIG.ATTENDANCE_SUBNAV_PATH,
        // Salary & Payroll
        'salary-config': CONFIG.SALARY_SUBNAV_PATH,
        'salary-monthly': CONFIG.SALARY_SUBNAV_PATH,
        'salary-payments': CONFIG.SALARY_SUBNAV_PATH,
        'salary-advances': CONFIG.SALARY_SUBNAV_PATH,
        'salary-incentives': CONFIG.SALARY_SUBNAV_PATH,
        'salary-reports': CONFIG.SALARY_SUBNAV_PATH,
        // Sales & Estimates
        'estimates': CONFIG.SALES_SUBNAV_PATH,
        'estimate-create': CONFIG.SALES_SUBNAV_PATH,
        'estimate-requests': CONFIG.SALES_SUBNAV_PATH,
        'estimate-actions': CONFIG.SALES_SUBNAV_PATH,
        'estimate-settings': CONFIG.SALES_SUBNAV_PATH,
        // Products & Inventory
        'item-master': CONFIG.ZOHO_SUBNAV_PATH,
        'products': CONFIG.PRODUCTS_SUBNAV_PATH,
        'categories': CONFIG.PRODUCTS_SUBNAV_PATH,
        'brands': CONFIG.PRODUCTS_SUBNAV_PATH,
        // System
        'reports': CONFIG.SYSTEM_SUBNAV_PATH,
        'settings': CONFIG.SYSTEM_SUBNAV_PATH,
        'profile': CONFIG.SYSTEM_SUBNAV_PATH,
        'website': CONFIG.SYSTEM_SUBNAV_PATH,
        'guides': CONFIG.SYSTEM_SUBNAV_PATH,
        'ai': CONFIG.SYSTEM_SUBNAV_PATH,
        'system-health': CONFIG.SYSTEM_SUBNAV_PATH,
        'bug-reports': CONFIG.SYSTEM_SUBNAV_PATH,
        'anomalies': CONFIG.SYSTEM_SUBNAV_PATH,
        'monitoring': CONFIG.SYSTEM_SUBNAV_PATH,
        'photos': CONFIG.SYSTEM_SUBNAV_PATH,
        // WhatsApp
        'wa-dashboard': CONFIG.WHATSAPP_SUBNAV_PATH,
        'whatsapp-chat': CONFIG.WHATSAPP_SUBNAV_PATH,
        'wa-contacts': CONFIG.WHATSAPP_SUBNAV_PATH,
        'wa-marketing': CONFIG.WHATSAPP_SUBNAV_PATH,
        'wa-templates': CONFIG.WHATSAPP_SUBNAV_PATH,
        'whatsapp-sessions': CONFIG.WHATSAPP_SUBNAV_PATH,
        'wa-admin-login': CONFIG.WHATSAPP_SUBNAV_PATH,
        'wa-settings': CONFIG.WHATSAPP_SUBNAV_PATH,
        // Painters
        'painters': CONFIG.PAINTERS_SUBNAV_PATH,
        'painter-points': CONFIG.PAINTERS_SUBNAV_PATH,
        'painter-rates': CONFIG.PAINTERS_SUBNAV_PATH,
        'painter-withdrawals': CONFIG.PAINTERS_SUBNAV_PATH,
        'painter-reports': CONFIG.PAINTERS_SUBNAV_PATH,
        // Staff Work (staff-only pages)
        'my-leads': CONFIG.STAFF_WORK_SUBNAV_PATH,
        'my-estimates': CONFIG.STAFF_WORK_SUBNAV_PATH,
        'my-incentives': CONFIG.STAFF_WORK_SUBNAV_PATH,
    };
    
    // Skip navigation on login pages and public share pages
    const isLoginPage = window.location.pathname.includes('/login.html') ||
                        window.location.pathname.includes('/forgot-password.html') ||
                        window.location.pathname.startsWith('/share/') ||
                        window.location.pathname.includes('/painter-register.html') ||
                        window.location.pathname.includes('/painter-login.html') ||
                        window.location.pathname.includes('/painter-dashboard.html');

    if (isLoginPage) {
        console.log('⏭️ Skipping navigation on login/public page');
        return;
    }

    // Load error prevention script for all admin pages
    (function loadErrorPrevention() {
        const ep = document.createElement('script');
        ep.src = '/js/error-prevention.js';
        document.head.appendChild(ep);
    })();

    // Load Socket.io client + socket helper for real-time features
    (function loadSocketScripts() {
        const s1 = document.createElement('script');
        s1.src = 'https://cdn.socket.io/4.7.5/socket.io.min.js';
        s1.onload = function() {
            const s2 = document.createElement('script');
            s2.src = '/js/socket-helper.js';
            document.head.appendChild(s2);
        };
        document.head.appendChild(s1);
    })();
    
    // State
    let loadAttempts = 0;
    let componentsLoaded = false;
    
    /**
     * Load a component with retry logic
     */
    async function loadComponentWithRetry(url, insertBefore, attemptNum = 1) {
        try {
            console.log(`🔄 Loading ${url} (attempt ${attemptNum}/${CONFIG.RETRY_ATTEMPTS})`);
            
            const cacheBust = url + (url.includes('?') ? '&' : '?') + '_v=' + Date.now();
            const response = await fetch(cacheBust, {
                cache: 'no-store',
                headers: {
                    'Cache-Control': 'no-cache, no-store',
                    'Pragma': 'no-cache'
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const html = await response.text();
            
            if (!html || html.trim().length === 0) {
                throw new Error('Empty response received');
            }
            
            // Create container
            const container = document.createElement('div');
            container.innerHTML = html;
            
            // Extract and store scripts
            const scripts = [];
            container.querySelectorAll('script').forEach(script => {
                if (script.textContent && script.textContent.trim()) {
                    scripts.push(script.textContent);
                }
                script.remove();
            });
            
            // Insert HTML
            while (container.firstChild) {
                insertBefore.parentNode.insertBefore(container.firstChild, insertBefore);
            }
            
            // Execute scripts
            scripts.forEach(scriptText => {
                try {
                    const scriptEl = document.createElement('script');
                    scriptEl.textContent = scriptText;
                    document.body.appendChild(scriptEl);
                } catch (execError) {
                    console.error('Script execution error:', execError);
                }
            });
            
            console.log(`✅ Successfully loaded: ${url}`);
            return true;
            
        } catch (error) {
            console.error(`❌ Failed to load ${url} (attempt ${attemptNum}):`, error);
            
            // Retry logic
            if (attemptNum < CONFIG.RETRY_ATTEMPTS) {
                console.log(`⏳ Retrying in ${CONFIG.RETRY_DELAY}ms...`);
                await new Promise(resolve => setTimeout(resolve, CONFIG.RETRY_DELAY));
                return loadComponentWithRetry(url, insertBefore, attemptNum + 1);
            }
            
            return false;
        }
    }
    
    /**
     * Initialize navigation components
     */
    async function initNavigation() {
        // Prevent duplicate loading
        if (componentsLoaded) {
            console.log('⏭️ Components already loaded');
            return;
        }
        
        console.log('🚀 Initializing universal navigation v3.0...');
        
        // Find insertion point
        const insertBefore = document.body.firstElementChild;
        if (!insertBefore) {
            console.error('❌ Cannot inject navigation: body has no children');
            return;
        }
        
        try {
            // Load both components in parallel
            const [headerLoaded, sidebarLoaded] = await Promise.all([
                loadComponentWithRetry(CONFIG.HEADER_PATH, insertBefore),
                loadComponentWithRetry(CONFIG.SIDEBAR_PATH, insertBefore)
            ]);
            
            if (headerLoaded && sidebarLoaded) {
                componentsLoaded = true;
                console.log('✅ Universal navigation loaded successfully!');

                // Ensure global functions exist
                ensureGlobalFunctions();

                // Wire accordion: auto-expand the section for the current page
                initSidebarAccordion();

                // Load module subnavs based on data-page
                const dataPage = document.body.getAttribute('data-page') || document.documentElement.getAttribute('data-page') || '';
                const header = document.getElementById('mainHeader');
                if (header && header.nextSibling) {
                    let subnavPath = null;
                    let subnavName = '';

                    // Check prefix-based matches first (existing behavior)
                    if (dataPage.startsWith('zoho-')) {
                        subnavPath = CONFIG.ZOHO_SUBNAV_PATH;
                        subnavName = 'Zoho';
                    } else if (dataPage.startsWith('attendance-')) {
                        subnavPath = CONFIG.ATTENDANCE_SUBNAV_PATH;
                        subnavName = 'Attendance';
                    } else if (dataPage.startsWith('marketing-')) {
                        subnavPath = CONFIG.MARKETING_SUBNAV_PATH;
                        subnavName = 'Marketing';
                    } else if (dataPage.startsWith('wa-') || dataPage.startsWith('whatsapp-')) {
                        subnavPath = CONFIG.WHATSAPP_SUBNAV_PATH;
                        subnavName = 'WhatsApp';
                    } else if (SUBNAV_MAP[dataPage]) {
                        // Fallback to explicit mapping
                        subnavPath = SUBNAV_MAP[dataPage];
                        subnavName = dataPage;
                    }

                    if (subnavPath) {
                        const subnavLoaded = await loadComponentWithRetry(subnavPath, header.nextSibling);
                        if (subnavLoaded) {
                            console.log(`✅ ${subnavName} sub-navigation loaded`);
                        }
                    }
                }

                // Dispatch custom event
                document.dispatchEvent(new CustomEvent('navigationLoaded'));
            } else {
                console.error('❌ Failed to load one or more components');
                showLoadError();
            }
            
        } catch (error) {
            console.error('❌ Navigation initialization failed:', error);
            showLoadError();
        }
    }
    
    /**
     * Ensure global functions are available
     */
    function ensureGlobalFunctions() {
        // Fallback for toggleSidebar
        if (typeof window.toggleSidebar === 'undefined') {
            console.warn('⚠️ toggleSidebar not found, creating fallback');
            window.toggleSidebar = function() {
                const sidebar = document.getElementById('mainSidebar');
                const overlay = document.getElementById('sidebarOverlay');

                if (sidebar) {
                    sidebar.classList.toggle('open');
                }
                if (overlay) {
                    overlay.classList.toggle('show');
                }
            };
        }

        // Fallback for closeSidebar
        if (typeof window.closeSidebar === 'undefined') {
            window.closeSidebar = function() {
                const sidebar = document.getElementById('mainSidebar');
                const overlay = document.getElementById('sidebarOverlay');

                if (sidebar) {
                    sidebar.classList.remove('open');
                }
                if (overlay) {
                    overlay.classList.remove('show');
                }
            };
        }
    }

    /**
     * Toggle a single nav section's submenu. Accordion behavior:
     * clicking a section closes all others and toggles the clicked one.
     * Exposed as global so inline onclick="qcToggleNavSection(this)" works.
     */
    function qcToggleNavSection(btn) {
        if (!btn) return;
        var sidebar = btn.closest('.qc-sidebar');
        if (!sidebar) return;
        var section = btn.getAttribute('data-section');
        var isOpen = btn.getAttribute('aria-expanded') === 'true';
        // Close all toggles in this sidebar
        sidebar.querySelectorAll('.qc-nav-section-toggle').forEach(function(t) {
            t.setAttribute('aria-expanded', 'false');
        });
        sidebar.querySelectorAll('.qc-nav-submenu').forEach(function(s) {
            s.classList.remove('open');
        });
        // If the clicked one wasn't open, open it
        if (!isOpen) {
            btn.setAttribute('aria-expanded', 'true');
            var submenu = sidebar.querySelector('.qc-nav-submenu[data-section="' + section + '"]');
            if (submenu) submenu.classList.add('open');
        }
    }
    window.qcToggleNavSection = qcToggleNavSection;

    /**
     * Auto-expand the section containing the current URL's page.
     * Matches each <a href> inside each .qc-nav-submenu against location.pathname.
     */
    function initSidebarAccordion() {
        var sidebar = document.querySelector('.qc-sidebar');
        if (!sidebar) return;
        var path = window.location.pathname.replace(/\/+$/, '');
        if (!path) path = '/';
        // Strip leading slash for comparison flexibility
        var target = path.toLowerCase();
        var matchedSection = null;
        sidebar.querySelectorAll('.qc-nav-submenu').forEach(function(submenu) {
            if (matchedSection) return;
            var links = submenu.querySelectorAll('a[href]');
            for (var i = 0; i < links.length; i++) {
                var href = (links[i].getAttribute('href') || '').toLowerCase().replace(/\/+$/, '') || '/';
                if (href === target || (target !== '/' && href !== '/' && target.indexOf(href) === 0 && (target[href.length] === undefined || target[href.length] === '/' || target[href.length] === '?'))) {
                    matchedSection = submenu.getAttribute('data-section');
                    break;
                }
            }
        });
        if (matchedSection) {
            var btn = sidebar.querySelector('.qc-nav-section-toggle[data-section="' + matchedSection + '"]');
            var submenu = sidebar.querySelector('.qc-nav-submenu[data-section="' + matchedSection + '"]');
            if (btn) btn.setAttribute('aria-expanded', 'true');
            if (submenu) submenu.classList.add('open');
        }
    }

    /**
     * Show error notification to user
     */
    function showLoadError() {
        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #fee2e2;
            color: #991b1b;
            padding: 1rem 1.5rem;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            z-index: 9999;
            font-family: system-ui, -apple-system, sans-serif;
        `;
        errorDiv.textContent = 'Failed to load navigation. Please refresh the page.';
        document.body.appendChild(errorDiv);
        
        setTimeout(() => errorDiv.remove(), 5000);
    }
    
    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initNavigation);
    } else {
        // DOM already loaded
        initNavigation();
    }
    
    // Helper function for authenticated requests
    window.getAuthHeaders = function() {
        const token = localStorage.getItem('auth_token');
        if (!token) {
            console.warn('⚠️ No auth token found');
            return {
                'Content-Type': 'application/json'
            };
        }
        return {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        };
    };
    
    console.log('📦 Universal Navigation Loader v3.0 initialized');
    
})();
