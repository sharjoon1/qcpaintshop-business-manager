/**
 * Authentication Helper for Business Manager
 * Provides common authentication functions for all admin pages
 */

/**
 * Roles that grant full admin-level access in the dashboard / navigation.
 * - 'admin' is canonical; 'administrator' is an alias; 'super_admin' is the
 *   highest tier. Any of these should see the same admin UI.
 */
const FULL_ADMIN_ROLES = ['admin', 'administrator', 'super_admin'];
/**
 * Roles that get the manager-level dashboard (admin pages + branch dashboard).
 * Includes full-admin roles plus manager/branch_manager.
 */
const ADMIN_LEVEL_ROLES = ['admin', 'administrator', 'super_admin', 'manager', 'branch_manager'];

function isFullAdminRole(role) {
    return !!role && FULL_ADMIN_ROLES.includes(String(role).toLowerCase());
}
function isAdminLevelRole(role) {
    return !!role && ADMIN_LEVEL_ROLES.includes(String(role).toLowerCase());
}

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
 * Logout user and redirect to login.
 * @param {Object} [opts]
 * @param {string} [opts.reason] - Optional reason shown as toast on login page ('expired')
 */
function logout(opts) {
    // Guard against double-logout when multiple in-flight requests 401 simultaneously
    if (window.__qcLoggingOut) return;
    window.__qcLoggingOut = true;
    localStorage.removeItem('auth_token');
    localStorage.removeItem('user');
    var reason = opts && opts.reason ? '?reason=' + encodeURIComponent(opts.reason) : '';
    window.location.href = '/login.html' + reason;
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

        // Handle 401 Unauthorized — token invalid or session expired server-side
        if (response.status === 401) {
            console.warn('⚠️ Unauthorized - redirecting to login');
            logout({ reason: 'expired' });
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
 *
 * Returns a boolean (for legacy callers that check synchronously), but
 * also kicks off async validateSession() which may redirect asynchronously
 * if the server says the token is expired.
 */
function checkAuthOrRedirect() {
    if (!isAuthenticated()) {
        window.location.href = '/login.html';
        return false;
    }
    // Fire-and-forget server-side validation. If the token is stale,
    // validateSession() hard-redirects to /login.html?reason=expired.
    validateSession();
    return true;
}

/**
 * Ask the server whether the local token is still valid. If 401, clear
 * state and redirect to login. If 200, refresh the cached user object.
 * Network errors are tolerated (offline-friendly — the reactive 401
 * handler in apiRequest() catches expired tokens on the next live call).
 */
async function validateSession() {
    // Don't validate on public / login pages (would loop)
    var p = window.location.pathname;
    var publicPaths = ['/login.html', '/forgot-password.html', '/painter-login.html', '/painter-register.html', '/painter-dashboard.html'];
    if (publicPaths.indexOf(p) !== -1 || p.indexOf('/share/') === 0) {
        return;
    }
    var token = localStorage.getItem('auth_token');
    if (!token) return; // checkAuthOrRedirect already redirected
    try {
        var res = await fetch('/api/auth/me', {
            headers: { 'Authorization': 'Bearer ' + token },
            cache: 'no-store'
        });
        if (res.status === 401) {
            logout({ reason: 'expired' });
            return;
        }
        if (res.ok) {
            var data = await res.json();
            if (data && data.success && data.user) {
                localStorage.setItem('user', JSON.stringify(data.user));
            }
        }
    } catch (err) {
        // Network failure — don't log user out, they may be offline.
        // apiRequest() will catch expired tokens on the next real call.
        console.warn('validateSession: network error, proceeding with cached session', err);
    }
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
    if (user && !isAdminLevelRole(user.role)) {
        window.location.href = '/staff/dashboard.html';
        return false;
    }
    // Kick off async server-side validation — hard-redirects if token is stale
    validateSession();
    return true;
}

/**
 * Strict admin-only gate (admin / administrator / super_admin). Manager and
 * branch_manager are NOT allowed — they get redirected to the manager dashboard.
 */
function requireFullAdminOrRedirect() {
    if (!isAuthenticated()) {
        window.location.href = '/login.html';
        return false;
    }
    const user = getCurrentUser();
    if (user && !isFullAdminRole(user.role)) {
        window.location.href = isAdminLevelRole(user.role) ? '/dashboard.html' : '/staff/dashboard.html';
        return false;
    }
    validateSession();
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
window.requireFullAdminOrRedirect = requireFullAdminOrRedirect;
window.validateSession = validateSession;
window.isAndroidApp = isAndroidApp;
window.FULL_ADMIN_ROLES = FULL_ADMIN_ROLES;
window.ADMIN_LEVEL_ROLES = ADMIN_LEVEL_ROLES;
window.isFullAdminRole = isFullAdminRole;
window.isAdminLevelRole = isAdminLevelRole;

console.log('✅ Auth helper loaded');
