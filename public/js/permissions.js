/**
 * Frontend Permission Manager
 * Fetches and caches user permissions for UI control
 */

class PermissionManager {
    constructor() {
        this.permissions = [];
        this.isAdmin = false;
        this.role = null;
        this.loaded = false;
    }

    /**
     * Load user permissions from API
     */
    async loadPermissions() {
        try {
            const token = localStorage.getItem('auth_token');
            if (!token) {
                console.warn('No auth token found');
                this.loaded = true;
                return false;
            }

            const response = await fetch('/api/auth/permissions', {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                throw new Error('Failed to load permissions');
            }

            const data = await response.json();
            
            if (data.success) {
                this.permissions = data.permissions || [];
                this.isAdmin = data.is_admin || false;
                this.role = data.role;
                this.loaded = true;
                
                // Store in localStorage for quick access
                localStorage.setItem('user_permissions', JSON.stringify({
                    permissions: this.permissions,
                    isAdmin: this.isAdmin,
                    role: this.role,
                    loadedAt: Date.now()
                }));

                return true;
            }

            return false;

        } catch (error) {
            console.error('Error loading permissions:', error);
            // Try to load from localStorage cache
            this.loadFromCache();
            return false;
        }
    }

    /**
     * Load permissions from localStorage cache
     */
    loadFromCache() {
        try {
            const cached = localStorage.getItem('user_permissions');
            if (cached) {
                const data = JSON.parse(cached);
                
                // Cache valid for 1 hour
                if (Date.now() - data.loadedAt < 3600000) {
                    this.permissions = data.permissions || [];
                    this.isAdmin = data.isAdmin || false;
                    this.role = data.role;
                    this.loaded = true;
                    return true;
                }
            }
        } catch (error) {
            console.error('Error loading cached permissions:', error);
        }
        
        this.loaded = true;
        return false;
    }

    /**
     * Check if user has specific permission
     * @param {string} module - Module name (e.g., 'products', 'customers')
     * @param {string} action - Action name (e.g., 'view', 'add', 'edit', 'delete')
     * @returns {boolean}
     */
    can(module, action) {
        // Admin has all permissions
        if (this.isAdmin) {
            return true;
        }

        // Check if permission exists
        return this.permissions.some(p => 
            p.module === module && p.action === action
        );
    }

    /**
     * Check if user has any of the specified permissions
     * @param {Array} permissions - Array of {module, action} objects
     * @returns {boolean}
     */
    canAny(permissions) {
        if (this.isAdmin) {
            return true;
        }

        return permissions.some(p => this.can(p.module, p.action));
    }

    /**
     * Check if user has all of the specified permissions
     * @param {Array} permissions - Array of {module, action} objects
     * @returns {boolean}
     */
    canAll(permissions) {
        if (this.isAdmin) {
            return true;
        }

        return permissions.every(p => this.can(p.module, p.action));
    }

    /**
     * Hide element if user doesn't have permission
     * @param {string} selector - CSS selector
     * @param {string} module - Module name
     * @param {string} action - Action name
     */
    hideIfNot(selector, module, action) {
        if (!this.can(module, action)) {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => el.style.display = 'none');
        }
    }

    /**
     * Disable element if user doesn't have permission
     * @param {string} selector - CSS selector
     * @param {string} module - Module name
     * @param {string} action - Action name
     */
    disableIfNot(selector, module, action) {
        if (!this.can(module, action)) {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => {
                el.disabled = true;
                el.style.opacity = '0.5';
                el.style.cursor = 'not-allowed';
                el.title = 'You do not have permission to perform this action';
            });
        }
    }

    /**
     * Apply permission-based visibility to elements
     * Usage: Add data-permission-module and data-permission-action attributes to elements
     */
    applyPermissions() {
        document.querySelectorAll('[data-permission-module]').forEach(el => {
            const module = el.getAttribute('data-permission-module');
            const action = el.getAttribute('data-permission-action');
            
            if (module && action && !this.can(module, action)) {
                el.style.display = 'none';
            }
        });

        document.querySelectorAll('[data-permission-disable-module]').forEach(el => {
            const module = el.getAttribute('data-permission-disable-module');
            const action = el.getAttribute('data-permission-disable-action');
            
            if (module && action && !this.can(module, action)) {
                el.disabled = true;
                el.style.opacity = '0.5';
                el.style.cursor = 'not-allowed';
                el.title = 'You do not have permission to perform this action';
            }
        });
    }

    /**
     * Get all permissions for a specific module
     * @param {string} module - Module name
     * @returns {Array}
     */
    getModulePermissions(module) {
        if (this.isAdmin) {
            return ['view', 'add', 'edit', 'delete', 'export', 'approve', 'manage'];
        }

        return this.permissions
            .filter(p => p.module === module)
            .map(p => p.action);
    }

    /**
     * Check if user is admin
     * @returns {boolean}
     */
    isAdministrator() {
        return this.isAdmin;
    }

    /**
     * Get user's role
     * @returns {string|null}
     */
    getRole() {
        return this.role;
    }

    /**
     * Clear permissions cache
     */
    clear() {
        this.permissions = [];
        this.isAdmin = false;
        this.role = null;
        this.loaded = false;
        localStorage.removeItem('user_permissions');
    }
}

// Create global instance
const permissions = new PermissionManager();

// Auto-load permissions on page load
if (typeof window !== 'undefined') {
    window.addEventListener('DOMContentLoaded', async () => {
        await permissions.loadPermissions();
        permissions.applyPermissions();
    });
}

// Export for use in modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = PermissionManager;
}
