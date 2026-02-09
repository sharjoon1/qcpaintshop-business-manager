/**
 * Universal Navigation Loader v3.0 - Production Ready
 * Robust component loading with comprehensive error handling
 */

(function() {
    'use strict';
    
    // Configuration
    const CONFIG = {
        HEADER_PATH: '/business-manager/components/header-v2.html',
        SIDEBAR_PATH: '/business-manager/components/sidebar-complete.html',
        RETRY_ATTEMPTS: 3,
        RETRY_DELAY: 1000
    };
    
    // Skip navigation on login pages
    const isLoginPage = window.location.pathname.includes('/login.html') || 
                        window.location.pathname.includes('/forgot-password.html');
    
    if (isLoginPage) {
        console.log('⏭️ Skipping navigation on login page');
        return;
    }
    
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
        // Fallback for toggleEnhancedSidebar
        if (typeof window.toggleEnhancedSidebar === 'undefined') {
            console.warn('⚠️ toggleEnhancedSidebar not found, creating fallback');
            window.toggleEnhancedSidebar = function() {
                const sidebar = document.getElementById('enhancedSidebar');
                const overlay = document.getElementById('enhancedSidebarOverlay');
                const hamburger = document.getElementById('enhancedHamburgerBtn');
                
                if (sidebar && overlay) {
                    sidebar.classList.toggle('open');
                    overlay.classList.toggle('show');
                }
                
                if (hamburger) {
                    hamburger.classList.toggle('active');
                }
            };
        }
        
        // Fallback for closeEnhancedSidebar
        if (typeof window.closeEnhancedSidebar === 'undefined') {
            window.closeEnhancedSidebar = function() {
                const sidebar = document.getElementById('enhancedSidebar');
                const overlay = document.getElementById('enhancedSidebarOverlay');
                const hamburger = document.getElementById('enhancedHamburgerBtn');
                
                if (sidebar && overlay) {
                    sidebar.classList.remove('open');
                    overlay.classList.remove('show');
                }
                
                if (hamburger) {
                    hamburger.classList.remove('active');
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
