/**
 * Universal Navigation Loader v2.0
 * Loads header and sidebar components on every page
 */

(function() {
    'use strict';
    
    // Determine if this is a staff page or login page
    const isStaffPage = window.location.pathname.includes('/staff/');
    const isLoginPage = window.location.pathname.includes('/login.html') || 
                        window.location.pathname.includes('/forgot-password.html');
    
    // Skip navigation on login pages
    if (isLoginPage) {
        console.log('⏭️ Skipping navigation on login page');
        return;
    }
    
    // Component paths
    const HEADER_PATH = '/components/header-v2.html';
    const SIDEBAR_PATH = isStaffPage 
        ? '/components/staff-sidebar.html'
        : '/components/sidebar-complete.html';
    
    /**
     * Load a component and inject it into the page
     */
    async function loadComponent(url, insertBeforeElement) {
        try {
            const response = await fetch(url);
            if (!response.ok) {
                console.error(`❌ Failed to load ${url}: ${response.status}`);
                return false;
            }
            
            const html = await response.text();
            
            // Create a temporary container
            const temp = document.createElement('div');
            temp.innerHTML = html;
            
            // Extract and execute scripts separately
            const scripts = temp.querySelectorAll('script');
            const scriptTexts = [];
            scripts.forEach(script => {
                if (script.textContent) {
                    scriptTexts.push(script.textContent);
                }
                script.remove(); // Remove from temp to avoid double execution
            });
            
            // Insert all children before the target element
            while (temp.firstChild) {
                insertBeforeElement.parentNode.insertBefore(temp.firstChild, insertBeforeElement);
            }
            
            // Execute scripts in order
            scriptTexts.forEach(scriptText => {
                try {
                    eval(scriptText);
                } catch (err) {
                    console.error('Script execution error:', err);
                }
            });
            
            console.log(`✅ Loaded: ${url}`);
            return true;
        } catch (error) {
            console.error(`❌ Error loading ${url}:`, error);
            return false;
        }
    }
    
    /**
     * Initialize navigation components
     */
    async function initNavigation() {
        // Find the first child of body to insert components before
        const firstBodyChild = document.body.firstElementChild;
        
        if (!firstBodyChild) {
            console.error('❌ Cannot inject navigation: body has no children');
            return;
        }
        
        console.log('🔄 Loading navigation components...');
        
        // Load both components
        const results = await Promise.all([
            loadComponent(HEADER_PATH, firstBodyChild),
            loadComponent(SIDEBAR_PATH, firstBodyChild)
        ]);
        
        if (results.every(r => r)) {
            console.log('✅ Universal navigation loaded successfully');
            
            // Ensure functions are globally accessible
            if (typeof window.toggleSidebar === 'undefined') {
                console.warn('⚠️ toggleSidebar not defined, creating fallback');
                window.toggleSidebar = function() {
                    const sidebar = document.getElementById('mainSidebar');
                    const overlay = document.getElementById('sidebarOverlay');
                    if (sidebar) sidebar.classList.toggle('open');
                    if (overlay) overlay.classList.toggle('show');
                };
            }
        } else {
            console.error('❌ Some components failed to load');
        }
    }
    
    // Initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initNavigation);
    } else {
        initNavigation();
    }
})();
