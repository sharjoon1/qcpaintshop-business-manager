/**
 * Dynamic Logo Loader
 * Loads business logo from settings and updates header
 */
(function() {
    'use strict';
    
    async function loadBusinessLogo() {
        try {
            // Get auth token
            const token = localStorage.getItem('token') || localStorage.getItem('auth_token');
            
            // Fetch settings
            const response = await fetch('/api/settings', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            if (!response.ok) {
                console.warn('Failed to load settings for logo');
                return;
            }
            
            const settings = await response.json();
            
            // Update logo if exists
            if (settings.business_logo) {
                const logoElements = document.querySelectorAll('.business-logo, #headerLogo, [data-logo="business"]');
                logoElements.forEach(logo => {
                    if (logo.tagName === 'IMG') {
                        logo.src = settings.business_logo;
                        console.log('✅ Business logo updated:', settings.business_logo);
                    }
                });
            }
        } catch (error) {
            console.error('Error loading business logo:', error);
        }
    }
    
    // Load logo when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', loadBusinessLogo);
    } else {
        loadBusinessLogo();
    }
    
    // Export for manual refresh
    window.refreshBusinessLogo = loadBusinessLogo;
    
})();
