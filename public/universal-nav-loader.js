/**
 * Universal Navigation Loader v3.0 - Production Ready
 * Robust component loading with comprehensive error handling
 */

(function() {
    'use strict';
    
    // Determine sidebar based on user role
    let sidebarPath = '/components/sidebar-complete.html';
    try {
        const u = JSON.parse(localStorage.getItem('user') || '{}');
        if (u.role && !['admin', 'manager', 'super_admin'].includes(u.role)) {
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
        PAINTERS_SUBNAV_PATH: '/components/painters-subnav.html',
        RETRY_ATTEMPTS: 3,
        RETRY_DELAY: 1000
    };

    // Map data-page values to subnav component paths
    const SUBNAV_MAP = {
        // Leads & CRM
        'leads': CONFIG.LEADS_SUBNAV_PATH,
        'customers': CONFIG.LEADS_SUBNAV_PATH,
        'customer-types': CONFIG.LEADS_SUBNAV_PATH,
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
        'geofence-logs': CONFIG.ATTENDANCE_SUBNAV_PATH,
        // Salary & Payroll
        'salary-config': CONFIG.SALARY_SUBNAV_PATH,
        'salary-monthly': CONFIG.SALARY_SUBNAV_PATH,
        'salary-payments': CONFIG.SALARY_SUBNAV_PATH,
        'salary-advances': CONFIG.SALARY_SUBNAV_PATH,
        'salary-reports': CONFIG.SALARY_SUBNAV_PATH,
        // Sales & Estimates
        'estimates': CONFIG.SALES_SUBNAV_PATH,
        'estimate-create': CONFIG.SALES_SUBNAV_PATH,
        'estimate-requests': CONFIG.SALES_SUBNAV_PATH,
        'estimate-actions': CONFIG.SALES_SUBNAV_PATH,
        'estimate-settings': CONFIG.SALES_SUBNAV_PATH,
        // Products & Inventory
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
        // Painters
        'painters': CONFIG.PAINTERS_SUBNAV_PATH,
        'painter-points': CONFIG.PAINTERS_SUBNAV_PATH,
        'painter-rates': CONFIG.PAINTERS_SUBNAV_PATH,
        'painter-withdrawals': CONFIG.PAINTERS_SUBNAV_PATH,
        'painter-reports': CONFIG.PAINTERS_SUBNAV_PATH,
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
            
            const response = await fetch(url, {
                cache: 'no-cache',
                headers: {
                    'Cache-Control': 'no-cache'
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
