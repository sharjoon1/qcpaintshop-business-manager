/**
 * Authentication Helper for Business Manager
 * Provides common authentication functions for all admin pages
 */

/**
 * Get authentication headers for API requests
 * @returns {Object} Headers object with Authorization token
 */
function getAuthHeaders() {
    const token = localStorage.getItem('auth_token');
    if (!token) {
        console.warn('⚠️ No auth token found - redirecting to login');
        window.location.href = '/login.html';
        return {};
    }
    return {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
    };
}

/**
 * Check if user is authenticated
 * @returns {boolean} True if authenticated
 */
function isAuthenticated() {
    const token = localStorage.getItem('auth_token');
    return !!token;
}

/**
 * Get current user from localStorage
 * @returns {Object|null} User object or null
 */
function getCurrentUser() {
    try {
        const userStr = localStorage.getItem('user');
        return userStr ? JSON.parse(userStr) : null;
    } catch (error) {
        console.error('Error parsing user data:', error);
        return null;
    }
}

/**
 * Logout user and redirect to login
 */
function logout() {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
    window.location.href = '/login.html';
}

/**
 * Make an authenticated API request
 * @param {string} url - API endpoint URL
 * @param {Object} options - Fetch options (method, body, etc.)
 * @returns {Promise} Fetch promise
 */
async function apiRequest(url, options = {}) {
    const defaultOptions = {
        headers: getAuthHeaders(),
        ...options
    };
    
    // Merge headers if provided
    if (options.headers) {
        defaultOptions.headers = {
            ...defaultOptions.headers,
            ...options.headers
        };
    }
    
    try {
        const response = await fetch(url, defaultOptions);
        
        // Handle 401 Unauthorized
        if (response.status === 401) {
            console.warn('⚠️ Unauthorized - redirecting to login');
            logout();
            throw new Error('Unauthorized');
        }
        
        return response;
    } catch (error) {
        console.error('API Request Error:', error);
        throw error;
    }
}

/**
 * Check authentication and redirect to login if not authenticated.
 * Call this at the top of every protected page.
 */
function checkAuthOrRedirect() {
    if (!isAuthenticated()) {
        window.location.href = '/login.html';
        return false;
    }
    return true;
}

// Expose functions globally
window.getAuthHeaders = getAuthHeaders;
window.isAuthenticated = isAuthenticated;
window.getCurrentUser = getCurrentUser;
window.logout = logout;
window.apiRequest = apiRequest;
window.checkAuthOrRedirect = checkAuthOrRedirect;

console.log('✅ Auth helper loaded');
