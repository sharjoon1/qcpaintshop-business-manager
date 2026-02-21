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
    const { headers: customHeaders, ...restOptions } = options;
    const mergedHeaders = {
        ...getAuthHeaders(),
        ...(customHeaders || {})
    };

    try {
        const response = await fetch(url, { ...restOptions, headers: mergedHeaders });

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

/**
 * Detect if running inside the QC Android app WebView
 * @returns {boolean} True if inside Android WebView
 */
function isAndroidApp() {
    return navigator.userAgent.includes('QCManagerApp');
}

/**
 * Register service worker for PWA / offline support + web push
 */
function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(function(reg) {
                console.log('SW registered, scope:', reg.scope);
                // Subscribe to web push if logged in and not in Android WebView
                if (isAuthenticated() && !isAndroidApp()) {
                    subscribeWebPush(reg);
                }
            })
            .catch(function(err) {
                console.warn('SW registration failed:', err);
            });
    }
}

/**
 * Subscribe to Web Push notifications
 */
async function subscribeWebPush(registration) {
    try {
        // Check if already subscribed
        const existing = await registration.pushManager.getSubscription();
        if (existing) {
            console.log('Web push already subscribed');
            return;
        }

        // Fetch VAPID public key from server
        const res = await fetch('/api/notifications/push/vapid-key');
        const data = await res.json();
        if (!data.success || !data.key) {
            console.log('No VAPID key available, skipping web push');
            return;
        }

        // Convert VAPID key from base64url to Uint8Array
        const vapidKey = urlBase64ToUint8Array(data.key);

        // Subscribe
        const subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: vapidKey
        });

        const subJson = subscription.toJSON();

        // Send subscription to server
        await fetch('/api/notifications/push/subscribe', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + localStorage.getItem('auth_token')
            },
            body: JSON.stringify({
                type: 'web',
                endpoint: subJson.endpoint,
                p256dh: subJson.keys.p256dh,
                auth_key: subJson.keys.auth
            })
        });

        console.log('Web push subscribed successfully');
    } catch (err) {
        if (err.name === 'NotAllowedError') {
            console.log('Push notification permission denied');
        } else {
            console.warn('Web push subscription failed:', err);
        }
    }
}

/**
 * Convert base64url string to Uint8Array for VAPID key
 */
function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = window.atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

// Register service worker on load
registerServiceWorker();

/**
 * Convenience wrapper: authenticated fetch that auto-parses JSON.
 * Automatically sets Content-Type for JSON bodies.
 * @param {string} url - API endpoint
 * @param {Object} options - Fetch options (method, body, headers, etc.)
 * @returns {Promise<Object>} Parsed JSON response
 */
async function apiFetch(url, options = {}) {
    // Auto-set Content-Type for JSON string bodies
    if (options.body && typeof options.body === 'string' && !options.headers?.['Content-Type']) {
        options.headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    }
    const response = await apiRequest(url, options);
    return response.json();
}

/**
 * Check if current user has admin/manager role.
 * If staff or other non-admin role, redirect to staff dashboard.
 * Call this at the top of admin-only pages.
 */
function requireAdminOrRedirect() {
    if (!isAuthenticated()) {
        window.location.href = '/login.html';
        return false;
    }
    const user = getCurrentUser();
    if (user && !['admin', 'manager', 'super_admin'].includes(user.role)) {
        window.location.href = '/staff/dashboard.html';
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
window.apiFetch = apiFetch;
window.checkAuthOrRedirect = checkAuthOrRedirect;
window.requireAdminOrRedirect = requireAdminOrRedirect;
window.isAndroidApp = isAndroidApp;

console.log('✅ Auth helper loaded');
