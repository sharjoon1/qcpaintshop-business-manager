/**
 * ZOHO ROUTES — SHARED STATE & HELPERS
 * Split from routes/zoho.js (A8b). Single instances of cross-router module
 * state: brand helpers, sync debounce, LRU API cache, and the service-pool
 * wiring + permission auto-fix that the original setPool performed.
 * All code below is moved verbatim from routes/zoho.js.
 */

// Services (initialized via setPool)
const zohoOAuth = require('../../services/zoho-oauth');
const zohoAPI = require('../../services/zoho-api');
const purchaseSuggestion = require('../../services/purchase-suggestion');
const brandDplService = require('../../services/brand-dpl-service');
const dplCatalogService = require('../../services/dpl-catalog');

// Brands supported by the paste-text → save → match flow. Each entry maps the
// lowercase URL key (`:brand` param) to the human-readable display name used
// inside matchWithZohoItems / normalizeBrand calls.
const BRAND_DISPLAY_NAMES = {
    birlaopus: 'Birla Opus',
};

/**
 * Validate :brand param. Returns true if supported; otherwise sends 400 and returns false.
 * Caller must short-circuit on false.
 */
function assertSupportedBrand(brand, res) {
    if (!BRAND_DISPLAY_NAMES[brand]) {
        res.status(400).json({ success: false, message: `Brand "${brand}" not yet supported for paste-text mode` });
        return false;
    }
    return true;
}

// Per-brand SQL scope (a WHERE fragment, literal patterns only — no params) for
// catalog candidate Zoho items. Tolerant: the brand column OR the item name carries
// the brand, so blank-brand items whose NAME says the brand are still candidates.
// Unknown brand → '' (no scope). assertSupportedBrand already gates to birlaopus.
const CATALOG_ZOHO_SCOPE = {
    birlaopus: "(UPPER(COALESCE(zoho_brand,'')) LIKE '%BIRLA%' OR UPPER(zoho_item_name) LIKE '%BIRLA OPUS%')",
};
function catalogZohoScopeSql(brand) {
    const s = CATALOG_ZOHO_SCOPE[String(brand || '').toLowerCase()];
    return s ? ` AND ${s}` : '';
}

// === DEBOUNCE & CACHE ===
// Prevents rapid-fire sync clicks from wasting API calls
const _syncDebounce = {}; // { operationKey: lastCallTimestamp }
const SYNC_DEBOUNCE_MS = 30000; // 30 seconds between same sync type

function isSyncDebounced(operation) {
    const now = Date.now();
    const lastCall = _syncDebounce[operation];
    if (lastCall && (now - lastCall) < SYNC_DEBOUNCE_MS) {
        const waitSec = Math.ceil((SYNC_DEBOUNCE_MS - (now - lastCall)) / 1000);
        return waitSec;
    }
    _syncDebounce[operation] = now;
    return 0;
}

// LRU cache for expensive API responses (replaces plain object — auto-evicts)
const { LRUCache } = require('lru-cache');
const _apiCache = new LRUCache({ max: 500, ttl: 300000 }); // 500 entries, 5-min TTL

function getCached(key, maxAgeMs = 300000) {
    const entry = _apiCache.get(key);
    if (entry === undefined) return null;
    // If caller requests a shorter TTL than default, check manually
    if (maxAgeMs < 300000) {
        const age = Date.now() - (entry._ts || 0);
        if (age > maxAgeMs) { _apiCache.delete(key); return null; }
    }
    return entry.data;
}

function setCache(key, data) {
    _apiCache.set(key, { data, _ts: Date.now() });
}

function clearCache(prefix) {
    if (prefix) {
        for (const k of _apiCache.keys()) { if (k.startsWith(prefix)) _apiCache.delete(k); }
    } else {
        _apiCache.clear();
    }
}

// Service singletons + permission auto-fix. The route-level pool lives in
// each sub-router (set by its own setPool); index.js composes the calls.
function setPool(dbPool) {
    zohoOAuth.setPool(dbPool);
    zohoAPI.setPool(dbPool);
    purchaseSuggestion.setPool(dbPool);
    brandDplService.setPool(dbPool);
    dplCatalogService.setPool(dbPool);

    // Ensure Zoho permissions have proper display names (auto-fix for existing databases)
    ensureZohoPermissions(dbPool).catch(err => {
        console.log('[Zoho] Permission display_name fix skipped:', err.message);
    });
}

async function ensureZohoPermissions(dbPool) {
    const zohoPermissions = [
        ['zoho', 'view',        'View Zoho Books Dashboard',  'View Zoho Books data and sync logs'],
        ['zoho', 'sync',        'Sync Data with Zoho',        'Trigger manual sync of invoices, items, customers, stock'],
        ['zoho', 'manage',      'Manage Zoho Settings',       'Manage Zoho configuration, OAuth, scheduler, mappings'],
        ['zoho', 'reports',     'View Zoho Reports',          'View financial and transaction reports from Zoho Books'],
        ['zoho', 'whatsapp',    'WhatsApp Followups',         'Send and manage WhatsApp followup messages'],
        ['zoho', 'invoices',    'Manage Invoices',            'View and manage Zoho Books invoices and payments'],
        ['zoho', 'items',       'Manage Items',               'View, edit and manage Zoho Books items'],
        ['zoho', 'stock',       'Manage Stock',               'View stock levels and create stock adjustments'],
        ['zoho', 'locations',   'Manage Locations',           'View and manage warehouse/location mappings'],
        ['zoho', 'reorder',     'Manage Reorder Alerts',      'Configure reorder levels, view and action alerts'],
        ['zoho', 'bulk_update', 'Bulk Operations',            'Execute bulk item updates and price changes'],
        ['zoho', 'collections', 'Manage Collections',        'View and manage outstanding invoice collections and payment tracking']
    ];

    for (const [module, action, displayName, desc] of zohoPermissions) {
        await dbPool.query(`
            INSERT INTO permissions (module, action, display_name, description)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                display_name = COALESCE(NULLIF(display_name, ''), VALUES(display_name)),
                description = COALESCE(NULLIF(description, ''), VALUES(description))
        `, [module, action, displayName, desc]);
    }

    // Auto-assign all zoho permissions to admin role if not already assigned
    await dbPool.query(`
        INSERT IGNORE INTO role_permissions (role_id, permission_id)
        SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
        WHERE r.name = 'admin' AND p.module = 'zoho'
    `);
}

module.exports = {
    setPool,
    BRAND_DISPLAY_NAMES,
    assertSupportedBrand,
    catalogZohoScopeSql,
    isSyncDebounced,
    getCached,
    setCache,
    clearCache
};
