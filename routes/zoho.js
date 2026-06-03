/**
 * ZOHO BOOKS INTEGRATION ROUTES
 * Admin panel endpoints for Zoho Books management
 *
 * Endpoints:
 *   GET    /api/zoho/status           - Connection & sync status
 *   GET    /api/zoho/dashboard        - Dashboard stats
 *   GET    /api/zoho/dashboard/drilldown - Drill into stat card metrics
 *   GET    /api/zoho/dashboard/drilldown/export - Export drilldown as CSV
 *   POST   /api/zoho/sync/full        - Trigger full sync
 *   POST   /api/zoho/sync/invoices    - Sync invoices only
 *   POST   /api/zoho/sync/customers   - Sync customers only
 *   POST   /api/zoho/sync/payments    - Sync payments only
 *   GET    /api/zoho/invoices         - List cached invoices
 *   GET    /api/zoho/invoices/:id     - Single invoice detail
 *   GET    /api/zoho/payments         - List cached payments
 *   GET    /api/zoho/payments/:id    - Single payment detail
 *   GET    /api/zoho/customers        - List Zoho customers
 *   GET    /api/zoho/reports/:type    - Financial reports
 *   GET    /api/zoho/sync/log         - Sync history
 *   GET    /api/zoho/config           - Get config
 *   PUT    /api/zoho/config           - Update config
 *   GET    /api/zoho/oauth/url        - Get OAuth setup URL
 *   GET    /api/zoho/oauth/callback   - OAuth callback handler
 *   POST   /api/zoho/oauth/disconnect - Disconnect Zoho
 *   GET    /api/zoho/whatsapp/queue   - WhatsApp queue
 *   POST   /api/zoho/whatsapp/send    - Queue WhatsApp message
 */

const express = require('express');
const router = express.Router();
const { requirePermission, requireAuth } = require('../middleware/permissionMiddleware');
const { branchScope } = require('../middleware/branchScope');

// Services (initialized via setPool)
const zohoOAuth = require('../services/zoho-oauth');
const zohoAPI = require('../services/zoho-api');
const syncScheduler = require('../services/sync-scheduler');
const whatsappProcessor = require('../services/whatsapp-processor');
const purchaseSuggestion = require('../services/purchase-suggestion');
const aiEngine = require('../services/ai-engine');
const invoiceLineSync = require('../services/zoho-invoice-line-sync');
const reorderCompute = require('../services/reorder-compute-service');
const reorderReport = require('../services/reorder-report-service');
const vendorItemMapper = require('../services/vendor-item-mapper');
const brandDplService = require('../services/brand-dpl-service');
const dplCatalogService = require('../services/dpl-catalog');
const pathMod = require('path');
const fsMod = require('fs');

let pool;

// Maps DPL paste-mode category strings (e.g. "Interior Luxury") to canonical
// category names that matchWithZohoItems / propose-naming expect.
// Shared by /items/brand-dpl/:brand POST + /items/brand-dpl/:brand/match.
const PASTE_CAT_TO_CANON = {
    'INTERIOR LUXURY':       'INTERIOR EMULSION',
    'INTERIOR PREMIUM':      'INTERIOR EMULSION',
    'INTERIOR ECONOMY':      'INTERIOR EMULSION',
    'EXTERIOR LUXURY':       'EXTERIOR EMULSION',
    'EXTERIOR PREMIUM':      'EXTERIOR EMULSION',
    'EXTERIOR ECONOMY':      'EXTERIOR EMULSION',
    'WATERPROOFING':         'WATERPROOFING',
    'ENAMEL LUXURY':         'ENAMEL',
    'ENAMEL PREMIUM':        'ENAMEL',
    'ENAMEL ECONOMY':        'ENAMEL',
    'WOOD FINISHES LUXURY':  'WOOD FINISH',
    'WOOD FINISHES PREMIUM': 'WOOD FINISH',
    'WOOD FINISHES ECONOMY': 'WOOD FINISH',
    'WOOD FINISHES OTHER':   'WOOD FINISH',
    'PAINTING TOOLS':        '',
    'THINNERS':              '',
    'COLORANTS':             'COLORANT',
    'STAINERS':              'COLORANT',
};

// Category names as they appear in the Birla Opus CSV SKU Report (column 1).
// Maps the raw CSV category header to the canonical category string expected by
// matchWithZohoItems / propose-naming. Empty string = skip / no canonical.
const CSV_CAT_TO_CANON = {
    'INTERIOR':       'INTERIOR EMULSION',
    'EXTERIOR':       'EXTERIOR EMULSION',
    'ENAMEL':         'ENAMEL',
    'WOOD FINISHES':  'WOOD FINISH',
    'COLORANTS':      'COLORANT',
    'PAINTING TOOLS': '',
};

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

// ========================================
// DPL CATALOG (deterministic item-master mediator) — build / read / confirm-link
// ========================================

// Build (or rebuild) the brand catalog from its saved DPL + the active Zoho items.
router.post('/items/dpl-catalog/:brand/build', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const brand = String(req.params.brand || '').toLowerCase();
        if (!assertSupportedBrand(brand, res)) return;

        const parsedRows = await brandDplService.getForMatch(brand);
        if (!parsedRows || !parsedRows.length) {
            return res.status(404).json({ success: false, message: 'No saved DPL for this brand. Save a DPL first.' });
        }

        const [zohoItems] = await pool.query(
            `SELECT zoho_item_id, zoho_item_name AS name, zoho_sku AS sku, zoho_rate AS rate,
                    zoho_cf_dpl AS cf_dpl, zoho_brand AS brand, zoho_category_name AS category,
                    zoho_description AS description
             FROM zoho_items_map WHERE zoho_status = 'active'`
        );

        const entries = dplCatalogService.buildCatalogFromDpl(brand, parsedRows, zohoItems);
        const updatedBy = req.user ? (req.user.username || String(req.user.id)) : null;
        await dplCatalogService.upsertEntries(entries, updatedBy);

        const summary = { total: entries.length, confirmed: 0, review: 0, needs_creating: 0 };
        entries.forEach(e => { summary[e.link_status] = (summary[e.link_status] || 0) + 1; });

        res.json({ success: true, data: summary });
    } catch (err) {
        console.error('DPL catalog build error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Read the brand catalog (all entries, grouped client-side for the review UI).
router.get('/items/dpl-catalog/:brand', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const brand = String(req.params.brand || '').toLowerCase();
        if (!assertSupportedBrand(brand, res)) return;
        const entries = await dplCatalogService.getCatalog(brand);
        res.json({ success: true, data: entries });
    } catch (err) {
        console.error('DPL catalog get error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Pin a catalog entry to a specific Zoho item (user-confirmed link).
router.post('/items/dpl-catalog/entry/:id/confirm-link', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) return res.status(400).json({ success: false, message: 'Invalid entry id' });
        const zohoItemId = req.body && req.body.zoho_item_id;
        if (!zohoItemId) return res.status(400).json({ success: false, message: 'zoho_item_id required' });
        const updatedBy = req.user ? (req.user.username || String(req.user.id)) : null;
        await dplCatalogService.confirmLink(id, String(zohoItemId), updatedBy);
        res.json({ success: true });
    } catch (err) {
        console.error('DPL catalog confirm-link error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Re-key the latest saved DPL onto the pinned catalog → price diff. Persists the
// new current_dpl/current_rate locally (no Zoho write). Returns three buckets.
router.post('/items/dpl-catalog/:brand/apply-prices', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const brand = String(req.params.brand || '').toLowerCase();
        if (!assertSupportedBrand(brand, res)) return;

        const parsedRows = await brandDplService.getForMatch(brand);
        if (!parsedRows || !parsedRows.length) {
            return res.status(404).json({ success: false, message: 'No saved DPL for this brand. Save a DPL first.' });
        }
        const existing = await dplCatalogService.getCatalog(brand);
        if (!existing.length) {
            return res.status(409).json({ success: false, message: 'Catalog is empty. Build the catalog first.' });
        }

        const diff = dplCatalogService.applyDplPrices(brand, parsedRows, existing);
        const updatedBy = req.user ? (req.user.username || String(req.user.id)) : null;
        await dplCatalogService.updateAppliedPrices(diff.updated, updatedBy);

        res.json({ success: true, data: {
            updated: diff.updated,
            new_needs_linking: diff.newNeedsLinking,
            no_dpl_this_time: diff.noDplThisTime.map(e => ({
                match_key: e.match_key, product_name: e.product_name,
                base_name: e.base_name, size_tier: e.size_tier,
            })),
            summary: { updated: diff.updated.length, new: diff.newNeedsLinking.length, untouched: diff.noDplThisTime.length },
        } });
    } catch (err) {
        console.error('DPL catalog apply-prices error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

// Push selected confirmed catalog entries to Zoho via the bulk-edit job path.
// Body: { ids: [catalogEntryId, ...] }. Only confirmed entries with a zoho_item_id
// and a current_dpl are pushed; the rest are reported as skipped.
router.post('/items/dpl-catalog/:brand/push', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const brand = String(req.params.brand || '').toLowerCase();
        if (!assertSupportedBrand(brand, res)) return;
        const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids.map(n => parseInt(n, 10)).filter(Number.isFinite) : [];
        if (!ids.length) return res.status(400).json({ success: false, message: 'ids array required' });

        const all = await dplCatalogService.getCatalog(brand);
        const byId = new Map(all.map(e => [e.id, e]));
        const chosen = ids.map(id => byId.get(id)).filter(Boolean);

        const hasDpl = e => e.current_dpl != null && Number(e.current_dpl) > 0;
        const pushable = chosen.filter(e => e.link_status === 'confirmed' && e.zoho_item_id && hasDpl(e));
        const skipped = chosen.filter(e => !(e.link_status === 'confirmed' && e.zoho_item_id && hasDpl(e)))
            .map(e => ({ id: e.id, reason: !e.zoho_item_id ? 'not linked' : e.link_status !== 'confirmed' ? 'not confirmed' : 'no DPL price' }));
        if (!pushable.length) {
            return res.status(400).json({ success: false, message: 'No pushable confirmed entries with a DPL price in the selection.', skipped });
        }

        // Current Zoho values for diffing + price-history old values.
        const zids = [...new Set(pushable.map(e => String(e.zoho_item_id)))];
        const [zrows] = await pool.query(
            `SELECT zoho_item_id, zoho_item_name AS name, zoho_sku AS sku, zoho_description AS description,
                    zoho_category_name AS category, zoho_cf_dpl AS cf_dpl, zoho_purchase_rate AS purchase_rate,
                    zoho_rate AS rate
             FROM zoho_items_map WHERE zoho_item_id IN (${zids.map(() => '?').join(',')})`,
            zids
        );
        const zById = new Map(zrows.map(z => [String(z.zoho_item_id), z]));

        const items = [];
        for (const e of pushable) {
            const zc = zById.get(String(e.zoho_item_id)) || {};
            const changes = dplCatalogService.buildPushChanges(e, zc);
            if (!changes) continue;
            items.push({ zoho_item_id: e.zoho_item_id, item_name: zc.name || e.canonical_name || '', changes, _entry: e, _zc: zc });
        }
        if (!items.length) return res.status(400).json({ success: false, message: 'Nothing to push after diffing.', skipped });

        const jobItems = items.map(({ _entry, _zc, ...keep }) => keep);
        const result = await createBulkEditJob(jobItems, req.user);

        // Log price history (best-effort; mirrors routes/item-master.js /dpl-apply).
        for (const it of items) {
            try {
                await pool.query(
                    `INSERT INTO dpl_price_history (zoho_item_id, version_id, old_dpl, new_dpl, old_purchase_rate, new_purchase_rate, old_sales_rate, new_sales_rate, changed_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        it.zoho_item_id, null,
                        it._zc.cf_dpl || 0, it.changes.cf_dpl,
                        it._zc.purchase_rate || 0, it.changes.purchase_rate,
                        it._zc.rate || 0, it.changes.rate,
                        req.user ? req.user.id : null,
                    ]
                );
            } catch (histErr) {
                console.error('DPL catalog push: price-history log failed (non-fatal):', histErr.message);
            }
        }

        res.json({ success: true, data: { job_id: result.job_id, pushed: result.total_items, skipped } });
    } catch (err) {
        const status = err.httpStatus || 500;
        console.error('DPL catalog push error:', err);
        res.status(status).json(Object.assign({ success: false, message: err.message }, err.code ? { code: err.code } : {}, err.payload || {}));
    }
});

// Module-scoped flag to prevent concurrent invoice-line back-fills
let invoiceBackfillState = { running: false, startedAt: null };

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

function setPool(dbPool) {
    pool = dbPool;
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

// ========================================
// STATUS & DASHBOARD
// ========================================

/**
 * GET /api/zoho/status - Connection status overview
 */
router.get('/status', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const tokenStatus = await zohoOAuth.getTokenStatus();

        // Last sync info
        const [lastSync] = await pool.query(`
            SELECT sync_type, status, records_synced, completed_at
            FROM zoho_sync_log ORDER BY id DESC LIMIT 5
        `);

        // Config
        const [config] = await pool.query(`SELECT config_key, config_value FROM zoho_config`);
        const configMap = {};
        config.forEach(c => { configMap[c.config_key] = c.config_value; });

        res.json({
            success: true,
            data: {
                connection: tokenStatus,
                sync_enabled: configMap.sync_enabled === 'true',
                sync_interval: configMap.sync_interval_minutes || '30',
                last_full_sync: configMap.last_full_sync || null,
                recent_syncs: lastSync,
                zoho_org_id: process.env.ZOHO_ORGANIZATION_ID || null
            }
        });
    } catch (error) {
        console.error('[Zoho] Status error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/dashboard - Dashboard statistics (with optional date filtering)
 * Query params: from_date, to_date (YYYY-MM-DD), compare (true/false)
 */
router.get('/dashboard', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const { from_date, to_date, compare } = req.query;
        const stats = await zohoAPI.getDashboardStats(
            from_date || null,
            to_date || null,
            compare === 'true'
        );
        res.json({ success: true, data: stats });
    } catch (error) {
        console.error('[Zoho] Dashboard error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/dashboard/trend - Dashboard trend data for chart visualization
 * Query params: from_date, to_date (YYYY-MM-DD), granularity (day/week/month)
 */
router.get('/dashboard/trend', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const { from_date, to_date, granularity } = req.query;
        if (!from_date || !to_date) {
            return res.status(400).json({ success: false, message: 'from_date and to_date are required' });
        }
        const data = await zohoAPI.getDashboardTrend(from_date, to_date, granularity || 'day');
        res.json({ success: true, data });
    } catch (error) {
        console.error('[Zoho] Dashboard trend error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/dashboard/export - Export dashboard stats as CSV
 * Query params: from_date, to_date (YYYY-MM-DD)
 */
router.get('/dashboard/export', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const { from_date, to_date } = req.query;
        const stats = await zohoAPI.getDashboardStats(from_date || null, to_date || null, false);

        const inv = stats.invoices || {};
        const pay = stats.payments || {};

        const periodLabel = from_date && to_date ? `${from_date} to ${to_date}` : 'All Time';

        let csv = 'Zoho Books Dashboard Export\n';
        csv += `Period,${periodLabel}\n`;
        csv += `Exported At,${new Date().toISOString()}\n\n`;
        csv += 'Metric,Value\n';
        csv += `Total Revenue,${inv.total_revenue || 0}\n`;
        csv += `Outstanding,${inv.total_outstanding || 0}\n`;
        csv += `Overdue Amount,${inv.overdue_amount || 0}\n`;
        csv += `Total Collected,${pay.total_collected || 0}\n`;
        csv += `Total Invoices,${inv.total_invoices || 0}\n`;
        csv += `Overdue Invoices,${inv.overdue_count || 0}\n`;
        csv += `Unpaid Invoices,${inv.unpaid_count || 0}\n`;
        csv += `Paid Invoices,${inv.paid_count || 0}\n`;
        csv += `Total Payments,${pay.total_payments || 0}\n`;

        const filename = `zoho-dashboard-${from_date || 'all'}-to-${to_date || 'all'}.csv`;
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(csv);
    } catch (error) {
        console.error('[Zoho] Dashboard export error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/dashboard/drilldown - Drill into a specific stat card metric
 * Query params: metric (required), from_date, to_date, search, sort, order, page, limit
 */
router.get('/dashboard/drilldown', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const { metric, from_date, to_date, search, sort, order = 'DESC', page = 1, limit = 25 } = req.query;
        const safeLimit = Math.min(parseInt(limit) || 25, 500);

        if (!metric) {
            return res.status(400).json({ success: false, message: 'metric parameter is required' });
        }

        // Determine which table and conditions to use
        const invoiceMetrics = ['revenue', 'outstanding', 'overdue', 'total_invoices', 'overdue_invoices', 'unpaid_invoices'];
        const paymentMetrics = ['collected'];
        const isInvoice = invoiceMetrics.includes(metric);
        const isPayment = paymentMetrics.includes(metric);

        if (!isInvoice && !isPayment) {
            return res.status(400).json({ success: false, message: 'Invalid metric: ' + metric });
        }

        let where = 'WHERE 1=1';
        const params = [];

        if (isInvoice) {
            // Date filter on invoice_date
            if (from_date) { where += ' AND zi.invoice_date >= ?'; params.push(from_date); }
            if (to_date) { where += ' AND zi.invoice_date <= ?'; params.push(to_date); }

            // Metric-specific conditions
            if (metric === 'outstanding') {
                where += ' AND zi.balance > 0';
            } else if (metric === 'overdue' || metric === 'overdue_invoices') {
                where += " AND zi.status = 'overdue'";
            } else if (metric === 'unpaid_invoices') {
                where += " AND zi.status IN ('sent','overdue','partially_paid')";
            }

            // Search
            if (search) {
                where += ' AND (zi.customer_name LIKE ? OR zi.invoice_number LIKE ?)';
                params.push('%' + search + '%', '%' + search + '%');
            }

            // Sort
            const allowedSorts = ['invoice_number', 'customer_name', 'invoice_date', 'due_date', 'total', 'balance', 'status'];
            const sortCol = allowedSorts.includes(sort) ? sort : 'invoice_date';
            const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

            const offset = (Math.max(1, parseInt(page)) - 1) * safeLimit;

            // Count + summary
            const [[counts]] = await pool.query(
                `SELECT COUNT(*) as total, COALESCE(SUM(zi.total), 0) as total_amount FROM zoho_invoices zi ${where}`, params
            );

            // Data
            const [rows] = await pool.query(`
                SELECT zi.id, zi.zoho_invoice_id, zi.invoice_number, zi.customer_name,
                       zi.invoice_date, zi.due_date, zi.total, zi.balance, zi.status
                FROM zoho_invoices zi
                ${where}
                ORDER BY zi.${sortCol} ${sortOrder}
                LIMIT ? OFFSET ?
            `, [...params, safeLimit, offset]);

            res.json({
                success: true,
                type: 'invoices',
                data: rows,
                pagination: {
                    total: counts.total,
                    page: parseInt(page),
                    limit: safeLimit,
                    pages: Math.ceil(counts.total / safeLimit),
                    totalPages: Math.ceil(counts.total / safeLimit)
                },
                summary: { total_amount: counts.total_amount, count: counts.total }
            });

        } else {
            // Payment metric (collected)
            if (from_date) { where += ' AND zp.payment_date >= ?'; params.push(from_date); }
            if (to_date) { where += ' AND zp.payment_date <= ?'; params.push(to_date); }

            if (search) {
                where += ' AND (zp.customer_name LIKE ? OR zp.payment_number LIKE ?)';
                params.push('%' + search + '%', '%' + search + '%');
            }

            const allowedSorts = ['payment_number', 'customer_name', 'payment_date', 'amount', 'payment_mode'];
            const sortCol = allowedSorts.includes(sort) ? sort : 'payment_date';
            const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

            const offset = (Math.max(1, parseInt(page)) - 1) * safeLimit;

            const [[counts]] = await pool.query(
                `SELECT COUNT(*) as total, COALESCE(SUM(zp.amount), 0) as total_amount FROM zoho_payments zp ${where}`, params
            );

            const [rows] = await pool.query(`
                SELECT zp.id, zp.zoho_payment_id, zp.payment_number, zp.customer_name,
                       zp.payment_date, zp.amount, zp.payment_mode, zp.reference_number, zp.description
                FROM zoho_payments zp
                ${where}
                ORDER BY zp.${sortCol} ${sortOrder}
                LIMIT ? OFFSET ?
            `, [...params, safeLimit, offset]);

            res.json({
                success: true,
                type: 'payments',
                data: rows,
                pagination: {
                    total: counts.total,
                    page: parseInt(page),
                    limit: safeLimit,
                    pages: Math.ceil(counts.total / safeLimit),
                    totalPages: Math.ceil(counts.total / safeLimit)
                },
                summary: { total_amount: counts.total_amount, count: counts.total }
            });
        }
    } catch (error) {
        console.error('[Zoho] Drilldown error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/dashboard/drilldown/export - Export drilldown data as CSV
 * Same params as drilldown minus page/limit
 */
router.get('/dashboard/drilldown/export', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const { metric, from_date, to_date, search, sort, order = 'DESC' } = req.query;

        if (!metric) {
            return res.status(400).json({ success: false, message: 'metric parameter is required' });
        }

        const invoiceMetrics = ['revenue', 'outstanding', 'overdue', 'total_invoices', 'overdue_invoices', 'unpaid_invoices'];
        const isInvoice = invoiceMetrics.includes(metric);

        let where = 'WHERE 1=1';
        const params = [];

        if (isInvoice) {
            if (from_date) { where += ' AND zi.invoice_date >= ?'; params.push(from_date); }
            if (to_date) { where += ' AND zi.invoice_date <= ?'; params.push(to_date); }
            if (metric === 'outstanding') where += ' AND zi.balance > 0';
            else if (metric === 'overdue' || metric === 'overdue_invoices') where += " AND zi.status = 'overdue'";
            else if (metric === 'unpaid_invoices') where += " AND zi.status IN ('sent','overdue','partially_paid')";
            if (search) {
                where += ' AND (zi.customer_name LIKE ? OR zi.invoice_number LIKE ?)';
                params.push('%' + search + '%', '%' + search + '%');
            }

            const allowedSorts = ['invoice_number', 'customer_name', 'invoice_date', 'due_date', 'total', 'balance', 'status'];
            const sortCol = allowedSorts.includes(sort) ? sort : 'invoice_date';
            const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

            const [rows] = await pool.query(`
                SELECT zi.invoice_number, zi.customer_name, zi.invoice_date, zi.due_date,
                       zi.total, zi.balance, zi.status
                FROM zoho_invoices zi ${where}
                ORDER BY zi.${sortCol} ${sortOrder}
                LIMIT 10000
            `, params);

            let csv = 'Invoice #,Customer,Date,Due Date,Total,Balance,Status\n';
            rows.forEach(function(r) {
                csv += '"' + (r.invoice_number || '') + '","' + (r.customer_name || '').replace(/"/g, '""') + '",' +
                       (r.invoice_date || '') + ',' + (r.due_date || '') + ',' +
                       (r.total || 0) + ',' + (r.balance || 0) + ',' + (r.status || '') + '\n';
            });

            const metricLabel = metric.replace(/_/g, '-');
            const filename = 'zoho-drilldown-' + metricLabel + '-' + (from_date || 'all') + '-to-' + (to_date || 'all') + '.csv';
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
            res.send(csv);

        } else {
            // Payments
            if (from_date) { where += ' AND zp.payment_date >= ?'; params.push(from_date); }
            if (to_date) { where += ' AND zp.payment_date <= ?'; params.push(to_date); }
            if (search) {
                where += ' AND (zp.customer_name LIKE ? OR zp.payment_number LIKE ?)';
                params.push('%' + search + '%', '%' + search + '%');
            }

            const allowedSorts = ['payment_number', 'customer_name', 'payment_date', 'amount', 'payment_mode'];
            const sortCol = allowedSorts.includes(sort) ? sort : 'payment_date';
            const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

            const [rows] = await pool.query(`
                SELECT zp.payment_number, zp.customer_name, zp.payment_date,
                       zp.amount, zp.payment_mode, zp.reference_number
                FROM zoho_payments zp ${where}
                ORDER BY zp.${sortCol} ${sortOrder}
                LIMIT 10000
            `, params);

            let csv = 'Payment #,Customer,Date,Amount,Mode,Reference\n';
            rows.forEach(function(r) {
                csv += '"' + (r.payment_number || '') + '","' + (r.customer_name || '').replace(/"/g, '""') + '",' +
                       (r.payment_date || '') + ',' + (r.amount || 0) + ',' +
                       '"' + (r.payment_mode || '') + '","' + (r.reference_number || '') + '"\n';
            });

            const filename = 'zoho-drilldown-collected-' + (from_date || 'all') + '-to-' + (to_date || 'all') + '.csv';
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
            res.send(csv);
        }
    } catch (error) {
        console.error('[Zoho] Drilldown export error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// API USAGE MONITOR
// ========================================

/**
 * GET /api/zoho/api-usage - Real-time API usage stats for the Usage Monitor
 */
router.get('/api-usage', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const rateLimiter = require('../services/zoho-rate-limiter');
        const usageStats = rateLimiter.getUsageStats();

        // Also get sync log for context
        const [recentSyncs] = await pool.query(`
            SELECT sync_type, status, records_synced, records_total, started_at, completed_at,
                   TIMESTAMPDIFF(SECOND, started_at, COALESCE(completed_at, NOW())) as duration_seconds
            FROM zoho_sync_log
            ORDER BY id DESC LIMIT 10
        `);

        // Get active bulk jobs
        const [activeBulkJobs] = await pool.query(`
            SELECT id, status, total_items, processed_items, failed_items, created_at
            FROM zoho_bulk_jobs
            WHERE status IN ('pending', 'processing')
            ORDER BY created_at DESC LIMIT 5
        `);

        // Get today's sync count from log for cross-reference
        const [[syncCounts]] = await pool.query(`
            SELECT
                COUNT(*) as total_syncs_today,
                SUM(records_synced) as total_records_today,
                COUNT(CASE WHEN status = 'failed' THEN 1 END) as failed_syncs_today
            FROM zoho_sync_log
            WHERE DATE(started_at) = CURDATE()
        `);

        res.json({
            success: true,
            data: {
                ...usageStats,
                recent_syncs: recentSyncs,
                active_bulk_jobs: activeBulkJobs,
                sync_summary_today: syncCounts,
                tracking_info: {
                    method: 'central_http_tracking',
                    description: 'All API calls tracked at HTTP layer (apiGet/apiPost/apiPut/apiDelete)',
                    db_persisted: usageStats.daily.persisted_to_db,
                    note: 'Daily count persists across server restarts via DB'
                }
            }
        });
    } catch (error) {
        console.error('[Zoho] API usage error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// SYNC ENDPOINTS
// ========================================

/**
 * POST /api/zoho/sync/full - Full sync (customers + invoices + payments)
 */
router.post('/sync/full', requirePermission('zoho', 'sync'), async (req, res) => {
    try {
        const rateLimiter = require('../services/zoho-rate-limiter');

        // Check if a sync is already running
        const [running] = await pool.query(
            `SELECT id FROM zoho_sync_log WHERE status IN ('started','in_progress') AND started_at > DATE_SUB(NOW(), INTERVAL 10 MINUTE) LIMIT 1`
        );
        if (running.length > 0) {
            return res.status(409).json({ success: false, message: 'A sync is already in progress' });
        }

        // Check API quota before starting
        const quotaStatus = rateLimiter.getStatus();
        if (quotaStatus.daily_percentage >= 90) {
            return res.status(429).json({
                success: false,
                message: `API quota at ${quotaStatus.daily_percentage}% (${quotaStatus.daily_used}/${quotaStatus.daily_limit}). Full sync requires ~300+ API calls. Consider waiting until tomorrow or using a quick sync.`
            });
        }

        // Check sync lock
        if (!rateLimiter.tryAcquireSyncLock('fullSync')) {
            const lockInfo = rateLimiter.getSyncLockStatus();
            return res.status(409).json({
                success: false,
                message: `Cannot start sync: ${lockInfo.operation} is already running`
            });
        }

        // Start sync in background (don't await)
        const userId = req.user.id;
        zohoAPI.fullSync(userId).catch(err => {
            console.error('[Zoho] Background full sync failed:', err.message);
        }).finally(() => {
            rateLimiter.releaseSyncLock('fullSync');
        });

        res.json({
            success: true,
            message: 'Full sync started. Check /api/zoho/sync/log for progress.',
            api_usage: { used: quotaStatus.daily_used, limit: quotaStatus.daily_limit, percentage: quotaStatus.daily_percentage }
        });
    } catch (error) {
        console.error('[Zoho] Sync error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/sync/invoices - Debounced (30s cooldown)
 */
router.post('/sync/invoices', requirePermission('zoho', 'sync'), async (req, res) => {
    try {
        const wait = isSyncDebounced('sync_invoices');
        if (wait > 0) {
            return res.status(429).json({ success: false, message: `Please wait ${wait}s before syncing invoices again` });
        }
        const result = await zohoAPI.syncInvoices(req.user.id);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/sync/customers - Debounced (30s cooldown)
 */
router.post('/sync/customers', requirePermission('zoho', 'sync'), async (req, res) => {
    try {
        const wait = isSyncDebounced('sync_customers');
        if (wait > 0) {
            return res.status(429).json({ success: false, message: `Please wait ${wait}s before syncing customers again` });
        }
        const result = await zohoAPI.syncCustomers(req.user.id);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/sync/payments - Debounced (30s cooldown)
 */
router.post('/sync/payments', requirePermission('zoho', 'sync'), async (req, res) => {
    try {
        const wait = isSyncDebounced('sync_payments');
        if (wait > 0) {
            return res.status(429).json({ success: false, message: `Please wait ${wait}s before syncing payments again` });
        }
        const result = await zohoAPI.syncPayments(req.user.id);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/sync/log - Sync history
 */
router.get('/sync/log', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 20, 100);
        const [logs] = await pool.query(`
            SELECT zsl.*, u.full_name as triggered_by_name
            FROM zoho_sync_log zsl
            LEFT JOIN users u ON zsl.triggered_by = u.id
            ORDER BY zsl.id DESC LIMIT ?
        `, [limit]);

        res.json({ success: true, data: logs });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// INVOICES (from local cache)
// ========================================

/**
 * GET /api/zoho/invoices - List invoices
 * Query: ?status=overdue&search=customer_name&page=1&limit=20
 */
router.get('/invoices', requirePermission('zoho', 'invoices'), async (req, res) => {
    try {
        const { status, search, page = 1, limit = 20, sort = 'invoice_date', order = 'DESC' } = req.query;
        const safeLimit = Math.min(parseInt(limit) || 20, 500);

        let where = 'WHERE 1=1';
        const params = [];

        if (status) {
            where += ' AND zi.status = ?';
            params.push(status);
        }
        if (search) {
            where += ' AND (zi.customer_name LIKE ? OR zi.invoice_number LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }

        const allowedSorts = ['invoice_date', 'due_date', 'total', 'balance', 'customer_name', 'invoice_number'];
        const sortCol = allowedSorts.includes(sort) ? sort : 'invoice_date';
        const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        const offset = (Math.max(1, parseInt(page)) - 1) * safeLimit;

        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) as total FROM zoho_invoices zi ${where}`, params
        );

        const [invoices] = await pool.query(`
            SELECT zi.*, zcm.local_customer_id,
                   zcm.credit_limit, zcm.zoho_outstanding as credit_outstanding,
                   CASE WHEN zcm.credit_limit > 0
                        THEN ROUND((zcm.zoho_outstanding / zcm.credit_limit) * 100, 1) ELSE 0 END as credit_utilization
            FROM zoho_invoices zi
            LEFT JOIN zoho_customers_map zcm ON zi.zoho_customer_id = zcm.zoho_contact_id
            ${where}
            ORDER BY zi.${sortCol} ${sortOrder}
            LIMIT ? OFFSET ?
        `, [...params, safeLimit, offset]);

        const [statsRows] = await pool.query(
            `SELECT COUNT(*) AS total,
             SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) AS paid,
             SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) AS sent,
             SUM(CASE WHEN status='overdue' THEN 1 ELSE 0 END) AS overdue,
             SUM(CASE WHEN status='partially_paid' THEN 1 ELSE 0 END) AS partially_paid
             FROM zoho_invoices zi ${where}`, params);

        res.json({
            success: true,
            data: invoices,
            stats: statsRows[0],
            pagination: {
                total,
                page: parseInt(page),
                limit: safeLimit,
                pages: Math.ceil(total / safeLimit),
                totalPages: Math.ceil(total / safeLimit)
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/invoices/:id - Single invoice (from local cache; live fetch only when requested)
 * Query: ?fresh=true to force live Zoho fetch (uses 1 API call)
 */
router.get('/invoices/:id', requirePermission('zoho', 'invoices'), async (req, res) => {
    try {
        // Check local cache
        const [local] = await pool.query(
            `SELECT * FROM zoho_invoices WHERE id = ? OR zoho_invoice_id = ? LIMIT 1`,
            [req.params.id, req.params.id]
        );

        if (local.length === 0) {
            return res.status(404).json({ success: false, message: 'Invoice not found' });
        }

        // Only fetch fresh from Zoho if explicitly requested (saves API calls)
        if (req.query.fresh === 'true') {
            try {
                // Rate limiting handled centrally in apiGet; pass priority for reserve access
                const zohoData = await zohoAPI.getInvoice(local[0].zoho_invoice_id, { caller: 'getInvoiceDetail', priority: 'high' });
                return res.json({
                    success: true,
                    data: { ...local[0], zoho_detail: zohoData.invoice || null }
                });
            } catch (zohoErr) {
                return res.json({
                    success: true,
                    data: local[0],
                    warning: 'Could not fetch live data from Zoho: ' + zohoErr.message
                });
            }
        }

        // Return cached data by default (no API call)
        res.json({ success: true, data: local[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// PAYMENTS
// ========================================

/**
 * GET /api/zoho/payments - List payments
 */
router.get('/payments', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const { search, from_date, to_date, page = 1, limit = 20 } = req.query;
        const safeLimit = Math.min(parseInt(limit) || 20, 500);

        let where = 'WHERE 1=1';
        const params = [];

        if (search) {
            where += ' AND (zp.customer_name LIKE ? OR zp.reference_number LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }
        if (from_date) {
            where += ' AND zp.payment_date >= ?';
            params.push(from_date);
        }
        if (to_date) {
            where += ' AND zp.payment_date <= ?';
            params.push(to_date);
        }

        const offset = (Math.max(1, parseInt(page)) - 1) * safeLimit;

        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) as total FROM zoho_payments zp ${where}`, params
        );

        const [payments] = await pool.query(`
            SELECT zp.*
            FROM zoho_payments zp
            ${where}
            ORDER BY zp.payment_date DESC
            LIMIT ? OFFSET ?
        `, [...params, safeLimit, offset]);

        res.json({
            success: true,
            data: payments,
            pagination: {
                total,
                page: parseInt(page),
                limit: safeLimit,
                pages: Math.ceil(total / safeLimit),
                totalPages: Math.ceil(total / safeLimit)
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/payments/:id - Single payment detail (from local cache)
 */
router.get('/payments/:id', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const [local] = await pool.query(
            `SELECT * FROM zoho_payments WHERE id = ? OR zoho_payment_id = ? LIMIT 1`,
            [req.params.id, req.params.id]
        );

        if (local.length === 0) {
            return res.status(404).json({ success: false, message: 'Payment not found' });
        }

        // Fetch related invoice if linked
        let relatedInvoice = null;
        if (local[0].zoho_invoice_id) {
            const [inv] = await pool.query(
                `SELECT invoice_number, customer_name, total, balance, status, invoice_date, due_date
                 FROM zoho_invoices WHERE zoho_invoice_id = ? LIMIT 1`,
                [local[0].zoho_invoice_id]
            );
            if (inv.length > 0) relatedInvoice = inv[0];
        }

        res.json({ success: true, data: { ...local[0], related_invoice: relatedInvoice } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// CUSTOMERS (Zoho mapped)
// ========================================

/**
 * GET /api/zoho/customers - List Zoho customers with local mapping
 */
router.get('/customers', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const { search, mapped, page = 1, limit = 20 } = req.query;
        const safeLimit = Math.min(parseInt(limit) || 20, 500);

        let where = 'WHERE 1=1';
        const params = [];

        if (search) {
            where += ' AND (zcm.zoho_contact_name LIKE ? OR zcm.zoho_phone LIKE ? OR zcm.zoho_email LIKE ?)';
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        if (mapped === 'true') {
            where += ' AND zcm.local_customer_id IS NOT NULL';
        } else if (mapped === 'false') {
            where += ' AND zcm.local_customer_id IS NULL';
        }

        const offset = (Math.max(1, parseInt(page)) - 1) * safeLimit;

        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) as total FROM zoho_customers_map zcm ${where}`, params
        );

        const [customers] = await pool.query(`
            SELECT zcm.*, c.name as local_customer_name, c.phone as local_phone
            FROM zoho_customers_map zcm
            LEFT JOIN customers c ON zcm.local_customer_id = c.id
            ${where}
            ORDER BY zcm.zoho_contact_name ASC
            LIMIT ? OFFSET ?
        `, [...params, safeLimit, offset]);

        res.json({
            success: true,
            data: customers,
            pagination: { total, page: parseInt(page), limit: safeLimit, pages: Math.ceil(total / safeLimit), totalPages: Math.ceil(total / safeLimit) }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * PUT /api/zoho/customers/:id/map - Manually map Zoho customer to local customer
 */
router.put('/customers/:id/map', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const { local_customer_id } = req.body;
        if (!local_customer_id) {
            return res.status(400).json({ success: false, message: 'local_customer_id required' });
        }

        await pool.query(
            `UPDATE zoho_customers_map SET local_customer_id = ? WHERE id = ?`,
            [local_customer_id, req.params.id]
        );

        res.json({ success: true, message: 'Customer mapped successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// FINANCIAL REPORTS
// ========================================

/**
 * GET /api/zoho/reports/:type - Get financial report
 * Types: profit_loss, balance_sheet, sales_by_customer, sales_by_item, receivables, aging
 */
router.get('/reports/:type', requirePermission('zoho', 'reports'), async (req, res) => {
    try {
        const { type } = req.params;
        const { from_date, to_date, use_cache } = req.query;

        // Check cache first
        if (use_cache !== 'false') {
            const [cached] = await pool.query(`
                SELECT * FROM zoho_financial_reports
                WHERE report_type = ? AND from_date = ? AND to_date = ?
                AND generated_at > DATE_SUB(NOW(), INTERVAL 6 HOUR)
                ORDER BY generated_at DESC LIMIT 1
            `, [type, from_date || null, to_date || null]);

            if (cached.length > 0) {
                return res.json({
                    success: true,
                    data: JSON.parse(cached[0].report_data),
                    summary: cached[0].summary ? JSON.parse(cached[0].summary) : null,
                    cached: true,
                    generated_at: cached[0].generated_at
                });
            }
        }

        // Fetch from Zoho
        let reportData;
        const today = new Date().toISOString().split('T')[0];
        const from = from_date || `${new Date().getFullYear()}-04-01`; // Financial year start (Apr 1)
        const to = to_date || today;

        switch (type) {
            case 'profit_loss':
                reportData = await zohoAPI.getProfitAndLoss(from, to);
                break;
            case 'balance_sheet':
                reportData = await zohoAPI.getBalanceSheet(to);
                break;
            case 'sales_by_customer':
                reportData = await zohoAPI.getSalesByCustomer(from, to);
                break;
            case 'sales_by_item':
                reportData = await zohoAPI.getSalesByItem(from, to);
                break;
            case 'receivables':
                reportData = await zohoAPI.getReceivablesSummary();
                break;
            case 'aging':
                reportData = await zohoAPI.getAgingSummary();
                break;
            default:
                return res.status(400).json({ success: false, message: `Unknown report type: ${type}` });
        }

        // Cache the report
        await pool.query(`
            INSERT INTO zoho_financial_reports (report_type, report_period, from_date, to_date, report_data)
            VALUES (?, ?, ?, ?, ?)
        `, [type, `${from} to ${to}`, from, to, JSON.stringify(reportData)]);

        res.json({
            success: true,
            data: reportData,
            cached: false,
            generated_at: new Date()
        });
    } catch (error) {
        console.error('[Zoho] Report error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// CONFIGURATION
// ========================================

/**
 * GET /api/zoho/config - Get all config
 */
router.get('/config', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const [config] = await pool.query(`
            SELECT zc.*, u.full_name as updated_by_name
            FROM zoho_config zc
            LEFT JOIN users u ON zc.updated_by = u.id
            ORDER BY zc.config_key
        `);

        const maskedConfig = config.map(row => {
            if (row.config_key === 'whatsapp_api_key') {
                const { config_value, ...rest } = row;
                return { ...rest, is_set: !!config_value };
            }
            return row;
        });
        res.json({ success: true, data: maskedConfig });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * PUT /api/zoho/config - Update config values
 * Body: { configs: [{ key: "sync_enabled", value: "true" }, ...] }
 */
router.put('/config', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const { configs } = req.body;
        if (!Array.isArray(configs)) {
            return res.status(400).json({ success: false, message: 'configs array required' });
        }

        const syncKeys = ['sync_enabled', 'sync_interval_minutes', 'daily_report_enabled', 'daily_report_time', 'stock_sync_enabled', 'stock_sync_interval_hours', 'reorder_alerts_enabled'];
        let needsSchedulerRestart = false;

        for (const { key, value } of configs) {
            await pool.query(
                `UPDATE zoho_config SET config_value = ?, updated_by = ? WHERE config_key = ?`,
                [value, req.user.id, key]
            );
            if (syncKeys.includes(key)) {
                needsSchedulerRestart = true;
            }
        }

        // Auto-restart scheduler if sync config changed
        if (needsSchedulerRestart) {
            try {
                await syncScheduler.restart();
            } catch (schedErr) {
                console.error('[Zoho] Scheduler restart failed:', schedErr.message);
            }
        }

        res.json({ success: true, message: 'Configuration updated', scheduler_restarted: needsSchedulerRestart });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// OAUTH SETUP
// ========================================

/**
 * GET /api/zoho/oauth/url - Get authorization URL for initial setup
 */
router.get('/oauth/url', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const url = zohoOAuth.getAuthorizationUrl();
        res.json({ success: true, data: { authorization_url: url } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/oauth/callback - OAuth callback (redirected from Zoho)
 */
router.get('/oauth/callback', async (req, res) => {
    try {
        const { code, error: oauthError } = req.query;

        if (oauthError) {
            return res.status(400).send(`
                <html><body style="font-family:sans-serif;text-align:center;padding:50px">
                <h2>Zoho Authorization Failed</h2>
                <p>${oauthError}</p>
                <a href="/admin-zoho-settings.html">Back to Settings</a>
                </body></html>
            `);
        }

        if (!code) {
            return res.status(400).send('Authorization code missing');
        }

        await zohoOAuth.generateTokenFromCode(code);

        res.send(`
            <html><body style="font-family:sans-serif;text-align:center;padding:50px">
            <h2 style="color:#22c55e">✅ Zoho Books Connected Successfully!</h2>
            <p>You can now sync your Zoho Books data.</p>
            <a href="/admin-zoho-settings.html" style="display:inline-block;margin-top:20px;padding:10px 30px;background:#667eea;color:white;border-radius:8px;text-decoration:none">Go to Zoho Settings</a>
            </body></html>
        `);
    } catch (error) {
        console.error('[Zoho] OAuth callback error:', error.message);
        res.status(500).send(`
            <html><body style="font-family:sans-serif;text-align:center;padding:50px">
            <h2 style="color:#ef4444">Connection Failed</h2>
            <p>${error.message}</p>
            <a href="/admin-zoho-settings.html">Try Again</a>
            </body></html>
        `);
    }
});

/**
 * POST /api/zoho/oauth/exchange - Manual code exchange (for when callback doesn't reach local server)
 */
router.post('/oauth/exchange', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        console.log('[Zoho] Manual code exchange requested by user:', req.user?.id);
        const { code } = req.body;
        if (!code) {
            return res.status(400).json({ success: false, message: 'Authorization code is required' });
        }

        console.log('[Zoho] Exchanging code:', code.substring(0, 20) + '...');
        const result = await zohoOAuth.generateTokenFromCode(code.trim());
        console.log('[Zoho] Code exchange successful! Token expires at:', result.expires_at);
        res.json({
            success: true,
            message: 'Zoho Books connected successfully!',
            data: { expires_at: result.expires_at }
        });
    } catch (error) {
        console.error('[Zoho] Manual code exchange error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/oauth/disconnect - Disconnect Zoho
 */
router.post('/oauth/disconnect', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const result = await zohoOAuth.revokeToken();
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// WHATSAPP FOLLOWUPS
// ========================================

/**
 * GET /api/zoho/whatsapp/queue - Get WhatsApp message queue
 */
router.get('/whatsapp/queue', requirePermission('zoho', 'whatsapp'), async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;
        const safeLimit = Math.min(parseInt(limit) || 20, 500);

        let where = 'WHERE 1=1';
        const params = [];

        if (status) {
            where += ' AND wf.status = ?';
            params.push(status);
        }

        const offset = (Math.max(1, parseInt(page)) - 1) * safeLimit;

        const [queue] = await pool.query(`
            SELECT wf.*, u.full_name as created_by_name
            FROM whatsapp_followups wf
            LEFT JOIN users u ON wf.created_by = u.id
            ${where}
            ORDER BY wf.created_at DESC
            LIMIT ? OFFSET ?
        `, [...params, safeLimit, offset]);

        res.json({ success: true, data: queue });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/whatsapp/send - Queue a WhatsApp message
 */
router.post('/whatsapp/send', requirePermission('zoho', 'whatsapp'), async (req, res) => {
    try {
        const { customer_id, zoho_customer_id, zoho_invoice_id, phone, message_type, message_body, amount, scheduled_at } = req.body;

        if (!phone || !message_body) {
            return res.status(400).json({ success: false, message: 'phone and message_body are required' });
        }

        // Get customer name
        let customerName = 'Unknown';
        if (zoho_customer_id) {
            const [cust] = await pool.query(
                `SELECT zoho_contact_name FROM zoho_customers_map WHERE zoho_contact_id = ? LIMIT 1`,
                [zoho_customer_id]
            );
            if (cust.length > 0) customerName = cust[0].zoho_contact_name;
        }

        const [result] = await pool.query(`
            INSERT INTO whatsapp_followups (
                customer_id, zoho_customer_id, zoho_invoice_id,
                customer_name, phone, message_type, message_body,
                amount, scheduled_at, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            customer_id || null, zoho_customer_id || null, zoho_invoice_id || null,
            customerName, phone, message_type || 'custom', message_body,
            amount || null, scheduled_at || new Date(), req.user.id
        ]);

        res.json({
            success: true,
            message: 'Message queued',
            data: { id: result.insertId }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * DELETE /api/zoho/whatsapp/:id - Cancel a pending message
 */
router.delete('/whatsapp/:id', requirePermission('zoho', 'whatsapp'), async (req, res) => {
    try {
        const [result] = await pool.query(
            `UPDATE whatsapp_followups SET status = 'cancelled' WHERE id = ? AND status = 'pending'`,
            [req.params.id]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Message not found or already sent' });
        }

        res.json({ success: true, message: 'Message cancelled' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// SCHEDULER CONTROL
// ========================================

/**
 * GET /api/zoho/scheduler/status - Get scheduler & processor status
 */
router.get('/scheduler/status', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        res.json({
            success: true,
            data: {
                scheduler: syncScheduler.getStatus(),
                whatsapp: whatsappProcessor.getStatus()
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/scheduler/restart - Restart scheduler after config change
 */
router.post('/scheduler/restart', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        await syncScheduler.restart();
        res.json({
            success: true,
            message: 'Scheduler restarted with updated config',
            data: syncScheduler.getStatus()
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/whatsapp/process - Manually trigger WhatsApp queue processing
 */
router.post('/whatsapp/process', requirePermission('zoho', 'whatsapp'), async (req, res) => {
    try {
        await whatsappProcessor.processQueue();
        res.json({
            success: true,
            message: 'WhatsApp queue processed',
            data: whatsappProcessor.getStatus()
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/whatsapp/queue-reminders - Manually queue overdue reminders
 */
router.post('/whatsapp/queue-reminders', requirePermission('zoho', 'whatsapp'), async (req, res) => {
    try {
        await whatsappProcessor.queueOverdueReminders();
        res.json({ success: true, message: 'Overdue reminders queued' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// LOCATIONS
// ========================================

/**
 * GET /api/zoho/locations - List locations with branch mapping
 */
router.get('/locations', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const includeInactive = req.query.include_inactive === '1' || req.query.include_inactive === 'true';
        const [locations] = await pool.query(`
            SELECT zlm.*,
                zlm.zoho_location_name as name,
                zlm.zoho_location_name as location_name,
                zlm.local_branch_id as branch_id,
                zlm.last_synced_at as last_synced,
                b.name as branch_name
            FROM zoho_locations_map zlm
            LEFT JOIN branches b ON zlm.local_branch_id = b.id
            ${includeInactive ? '' : 'WHERE zlm.is_active = 1'}
            ORDER BY zlm.zoho_location_name
        `);
        res.json({ success: true, data: locations });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/locations/sync - Sync locations from Zoho (debounced 30s)
 */
router.post('/locations/sync', requirePermission('zoho', 'sync'), async (req, res) => {
    try {
        const wait = isSyncDebounced('sync_locations');
        if (wait > 0) {
            return res.status(429).json({ success: false, message: `Please wait ${wait}s before syncing locations again` });
        }
        const result = await zohoAPI.syncLocations(req.user.id);
        const count = result.synced || 0;
        res.json({
            success: true,
            data: result,
            message: count > 0 ? `${count} location(s) synced from Zoho` : 'Sync completed but no locations found in Zoho. Check if multi-location inventory is enabled in your Zoho Books account.'
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * PUT /api/zoho/locations/:id/map - Map Zoho location to local branch
 */
router.put('/locations/:id/map', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const { branch_id } = req.body;
        if (!branch_id) {
            return res.status(400).json({ success: false, message: 'branch_id required' });
        }

        // Get the zoho_location_id for this mapping record
        const [locMap] = await pool.query(`SELECT zoho_location_id FROM zoho_locations_map WHERE id = ? LIMIT 1`, [req.params.id]);
        if (locMap.length === 0) {
            return res.status(404).json({ success: false, message: 'Location mapping not found' });
        }

        // Clear old branch mapping
        await pool.query(`UPDATE branches SET zoho_location_id = NULL WHERE zoho_location_id = ?`, [locMap[0].zoho_location_id]);

        // Set new mapping
        await pool.query(`UPDATE zoho_locations_map SET local_branch_id = ? WHERE id = ?`, [branch_id, req.params.id]);
        await pool.query(`UPDATE branches SET zoho_location_id = ? WHERE id = ?`, [locMap[0].zoho_location_id, branch_id]);

        res.json({ success: true, message: 'Location mapped to branch' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// STOCK
// ========================================

/**
 * GET /api/zoho/stock - Stock levels with filters
 */
router.get('/stock', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const result = await zohoAPI.getLocationStockDashboard(req.query);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/stock/filter-options - Distinct brands and categories for filter dropdowns
 */
router.get('/stock/filter-options', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const [brands] = await pool.query(
            `SELECT DISTINCT zoho_brand FROM zoho_items_map WHERE zoho_status = 'active' AND zoho_brand IS NOT NULL AND zoho_brand != '' ORDER BY zoho_brand ASC`
        );
        const [categories] = await pool.query(
            `SELECT DISTINCT zoho_category_name FROM zoho_items_map WHERE zoho_status = 'active' AND zoho_category_name IS NOT NULL AND zoho_category_name != '' ORDER BY zoho_category_name ASC`
        );
        const [brandCatRows] = await pool.query(
            `SELECT DISTINCT zoho_brand AS brand, zoho_category_name AS category FROM zoho_items_map
             WHERE zoho_status = 'active'
               AND zoho_brand IS NOT NULL AND zoho_brand != ''
               AND zoho_category_name IS NOT NULL AND zoho_category_name != ''
             ORDER BY zoho_brand, zoho_category_name`
        );
        const brandCategories = {};
        for (const row of brandCatRows) {
            if (!brandCategories[row.brand]) brandCategories[row.brand] = [];
            brandCategories[row.brand].push(row.category);
        }
        res.json({
            success: true,
            brands: brands.map(r => r.zoho_brand),
            categories: categories.map(r => r.zoho_category_name),
            brandCategories
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/stock/by-location - Stock for a specific location (must be before :itemId)
 */
router.get('/stock/by-location', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const { location_id, search, page = 1, limit = 50, sort = 'name_asc', brands, categories, stock_status } = req.query;
        const safeLimit = Math.min(parseInt(limit) || 50, 500);
        if (!location_id) {
            return res.status(400).json({ success: false, message: 'location_id required' });
        }

        let where = "WHERE ls.zoho_location_id = ? AND (zim.zoho_status = 'active' OR zim.zoho_status IS NULL)";
        const params = [location_id];

        if (search) {
            where += ' AND (ls.item_name LIKE ? OR ls.sku LIKE ?)';
            params.push('%' + search + '%', '%' + search + '%');
        }
        if (brands) {
            const brandList = brands.split(',').map(b => b.trim()).filter(Boolean);
            if (brandList.length) {
                where += ` AND zim.zoho_brand IN (${brandList.map(() => '?').join(',')})`;
                params.push(...brandList);
            }
        }
        if (categories) {
            const catList = categories.split(',').map(c => c.trim()).filter(Boolean);
            if (catList.length) {
                where += ` AND zim.zoho_category_name IN (${catList.map(() => '?').join(',')})`;
                params.push(...catList);
            }
        }
        if (stock_status) {
            if (stock_status === 'out_of_stock') where += ' AND ls.stock_on_hand <= 0';
            else if (stock_status === 'low_stock') where += ' AND ls.stock_on_hand > 0 AND ls.stock_on_hand <= 5';
            else if (stock_status === 'in_stock') where += ' AND ls.stock_on_hand > 0';
        }

        // Sort mapping
        const sortMap = {
            name_asc: 'ls.item_name ASC',
            name_desc: 'ls.item_name DESC',
            sku_asc: 'ls.sku ASC',
            sku_desc: 'ls.sku DESC',
            stock_asc: 'ls.stock_on_hand ASC',
            stock_desc: 'ls.stock_on_hand DESC',
            updated_desc: 'ls.last_synced_at DESC',
            updated_asc: 'ls.last_synced_at ASC',
            brand_asc: 'COALESCE(zim.zoho_brand, "zzz") ASC',
            brand_desc: 'COALESCE(zim.zoho_brand, "") DESC',
            category_asc: 'COALESCE(zim.zoho_category_name, "zzz") ASC',
            category_desc: 'COALESCE(zim.zoho_category_name, "") DESC'
        };
        const orderBy = sortMap[sort] || sortMap.name_asc;

        const offset = (Math.max(1, parseInt(page)) - 1) * safeLimit;
        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) as total FROM zoho_location_stock ls LEFT JOIN zoho_items_map zim ON ls.zoho_item_id = zim.zoho_item_id ${where}`, params
        );

        const [rows] = await pool.query(`
            SELECT ls.zoho_item_id as item_id, ls.item_name as name, ls.sku,
                   ls.stock_on_hand, ls.available_stock, ls.committed_stock, ls.available_for_sale,
                   ls.zoho_location_id as location_id, ls.last_synced_at,
                   zim.zoho_brand as brand, zim.zoho_category_name as category
            FROM zoho_location_stock ls
            LEFT JOIN zoho_items_map zim ON ls.zoho_item_id = zim.zoho_item_id
            ${where}
            ORDER BY ${orderBy}
            LIMIT ? OFFSET ?
        `, [...params, safeLimit, offset]);

        res.json({
            success: true,
            data: rows,
            pagination: { total, page: parseInt(page), limit: safeLimit, pages: Math.ceil(total / safeLimit), totalPages: Math.ceil(total / safeLimit) }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/stock/history - Stock change history
 */
router.get('/stock/history', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const { item_id, location_id, page = 1, limit = 50 } = req.query;
        const safeLimit = Math.min(parseInt(limit) || 50, 500);
        let where = 'WHERE 1=1';
        const params = [];

        if (item_id) {
            where += ' AND sh.zoho_item_id = ?';
            params.push(item_id);
        }
        if (location_id) {
            where += ' AND sh.zoho_location_id = ?';
            params.push(location_id);
        }

        const offset = (Math.max(1, parseInt(page)) - 1) * safeLimit;
        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) as total FROM zoho_stock_history sh
             LEFT JOIN zoho_locations_map lm ON sh.zoho_location_id = lm.zoho_location_id
             ${where} AND (lm.is_active = 1 OR lm.is_active IS NULL)`, params
        );

        const [rows] = await pool.query(`
            SELECT sh.*, lm.zoho_location_name
            FROM zoho_stock_history sh
            LEFT JOIN zoho_locations_map lm ON sh.zoho_location_id = lm.zoho_location_id
            ${where} AND (lm.is_active = 1 OR lm.is_active IS NULL)
            ORDER BY sh.created_at DESC
            LIMIT ? OFFSET ?
        `, [...params, safeLimit, offset]);

        res.json({
            success: true,
            data: rows,
            pagination: { total, page: parseInt(page), limit: safeLimit, pages: Math.ceil(total / safeLimit), totalPages: Math.ceil(total / safeLimit) }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/stock/:itemId - Single item stock across all locations
 */
router.get('/stock/:itemId', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const [stock] = await pool.query(`
            SELECT ls.*, lm.zoho_location_name, rc.reorder_level
            FROM zoho_location_stock ls
            LEFT JOIN zoho_locations_map lm ON ls.zoho_location_id = lm.zoho_location_id
            LEFT JOIN zoho_reorder_config rc ON ls.zoho_item_id = rc.zoho_item_id AND ls.zoho_location_id = rc.zoho_location_id
            WHERE ls.zoho_item_id = ? AND (lm.is_active = 1 OR lm.is_active IS NULL)
            ORDER BY lm.zoho_location_name
        `, [req.params.itemId]);

        res.json({ success: true, data: stock });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/stock/sync - Trigger stock sync
 */
router.post('/stock/sync', requirePermission('zoho', 'sync'), async (req, res) => {
    try {
        const rateLimiter = require('../services/zoho-rate-limiter');
        const quotaStatus = rateLimiter.getStatus();

        // Check API quota before starting heavy stock sync
        if (quotaStatus.daily_percentage >= 85) {
            return res.status(429).json({
                success: false,
                message: `API quota at ${quotaStatus.daily_percentage}% (${quotaStatus.daily_used}/${quotaStatus.daily_limit}). Stock sync requires ~300+ API calls. Please wait until tomorrow.`,
                api_usage: { used: quotaStatus.daily_used, limit: quotaStatus.daily_limit, percentage: quotaStatus.daily_percentage }
            });
        }

        const [running] = await pool.query(
            `SELECT id FROM zoho_sync_log WHERE sync_type = 'stock' AND status IN ('started','in_progress') AND started_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE) LIMIT 1`
        );
        if (running.length > 0) {
            return res.status(409).json({ success: false, message: 'Stock sync already in progress' });
        }

        if (!rateLimiter.tryAcquireSyncLock('stockSync')) {
            const lockInfo = rateLimiter.getSyncLockStatus();
            return res.status(409).json({
                success: false,
                message: `Cannot start stock sync: ${lockInfo.operation} is already running`
            });
        }

        zohoAPI.syncLocationStock(req.user.id).catch(err => {
            console.error('[Zoho] Background stock sync failed:', err.message);
        }).finally(() => {
            rateLimiter.releaseSyncLock('stockSync');
        });

        res.json({
            success: true,
            message: 'Stock sync started. Check sync log for progress.',
            api_usage: { used: quotaStatus.daily_used, limit: quotaStatus.daily_limit, percentage: quotaStatus.daily_percentage }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// INVENTORY ADJUSTMENTS
// ========================================

/**
 * POST /api/zoho/inventory-adjustments - Create inventory adjustment in Zoho Books
 * Body: { adjustment_type, date, reason, description, location_id, line_items: [{item_id, quantity_adjusted}] }
 * Note: Zoho API uses location_id (not warehouse_id) for inventory adjustments
 */
router.post('/inventory-adjustments', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const { adjustment_type, date, reason, description, location_id, warehouse_id, line_items } = req.body;
        if (!line_items || !Array.isArray(line_items) || line_items.length === 0) {
            return res.status(400).json({ success: false, message: 'line_items array is required' });
        }
        if (!adjustment_type || !date) {
            return res.status(400).json({ success: false, message: 'adjustment_type and date are required' });
        }

        // Zoho API uses location_id, not warehouse_id - accept either for backward compat
        const zohoLocationId = location_id || warehouse_id;

        // D8 — Branch isolation: non-admins can only adjust stock for their own branch
        const _zRole = (req.user && req.user.role || '').toLowerCase();
        const _zIsAdmin = ['admin','administrator','super_admin'].includes(_zRole);
        if (req.user && !_zIsAdmin && req.user.branch_id && zohoLocationId) {
            const [locRows] = await pool.query(
                `SELECT local_branch_id FROM zoho_locations_map WHERE zoho_location_id = ? LIMIT 1`,
                [zohoLocationId]
            );
            if (locRows.length > 0 && locRows[0].local_branch_id && locRows[0].local_branch_id !== req.user.branch_id) {
                return res.status(403).json({ success: false, message: 'You can only adjust stock for your own branch' });
            }
        }

        const adjustmentData = {
            adjustment_type,
            date,
            reason: reason || '',
            description: description || '',
            line_items: line_items.map(function(li) {
                const item = {
                    item_id: li.item_id,
                    quantity_adjusted: li.quantity_adjusted
                };
                // Each line item needs location_id for multi-warehouse — without it Zoho defaults to primary location
                if (li.location_id || zohoLocationId) {
                    item.location_id = li.location_id || zohoLocationId;
                }
                return item;
            })
        };

        // Add location_id at top level if provided (for multi-warehouse)
        if (zohoLocationId) {
            adjustmentData.location_id = zohoLocationId;
        }

        const result = await zohoAPI.createInventoryAdjustment(adjustmentData);
        clearCache('inv_adjustments_'); // Invalidate cached adjustment lists
        res.json({ success: true, data: result, message: 'Inventory adjustment created' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/inventory-adjustments - List inventory adjustments from Zoho
 * Cached for 5 minutes to avoid redundant API calls
 */
router.get('/inventory-adjustments', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const cacheKey = 'inv_adjustments_' + JSON.stringify(req.query);
        const cached = getCached(cacheKey, 300000); // 5 min cache
        if (cached) {
            return res.json({ success: true, data: cached, cached: true });
        }

        const result = await zohoAPI.getInventoryAdjustments(req.query);
        const data = result.inventory_adjustments || [];
        setCache(cacheKey, data);
        res.json({ success: true, data });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/stock/by-location - Get stock levels grouped by item for a specific location
 */
// ========================================
// ITEMS & BULK UPDATES
// ========================================

/**
 * GET /api/zoho/items - List items from cache
 */
router.get('/items', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const { search, brand, category, page = 1, limit = 50 } = req.query;
        const safeLimit = Math.min(parseInt(limit) || 50, 500);

        const showInactive = req.query.show_inactive === '1';
        let where = showInactive ? "WHERE 1=1" : "WHERE (zim.zoho_status = 'active' OR zim.zoho_status IS NULL)";
        const params = [];

        if (search) {
            where += ' AND (zim.zoho_item_name LIKE ? OR zim.zoho_sku LIKE ? OR zim.zoho_brand LIKE ? OR zim.zoho_category_name LIKE ? OR zim.zoho_description LIKE ?)';
            params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
        }
        if (brand) {
            where += ' AND zim.zoho_brand LIKE ?';
            params.push(`%${brand}%`);
        }
        if (category) {
            where += ' AND zim.zoho_category_name LIKE ?';
            params.push(`%${category}%`);
        }

        const offset = (Math.max(1, parseInt(page)) - 1) * safeLimit;

        const [[{ total }]] = await pool.query(`SELECT COUNT(*) as total FROM zoho_items_map zim ${where}`, params);

        const [items] = await pool.query(`
            SELECT zim.*,
                zim.zoho_item_id as item_id,
                zim.zoho_item_name as name,
                zim.zoho_item_name as item_name,
                zim.zoho_sku as sku,
                zim.zoho_rate as rate,
                zim.zoho_unit as unit,
                zim.zoho_tax_id as tax_id,
                zim.zoho_description as description,
                zim.zoho_purchase_rate as purchase_rate,
                zim.zoho_label_rate as label_rate,
                zim.zoho_tax_name as tax_name,
                zim.zoho_tax_percentage as tax_percentage,
                zim.zoho_hsn_or_sac as hsn_or_sac,
                zim.zoho_brand as brand,
                zim.zoho_manufacturer as manufacturer,
                zim.zoho_reorder_level as reorder_level,
                COALESCE(ls_agg.total_stock, zim.zoho_stock_on_hand, 0) as stock_on_hand,
                zim.zoho_category_name as category_name,
                zim.zoho_upc as upc,
                zim.zoho_ean as ean,
                zim.zoho_isbn as isbn,
                zim.zoho_part_number as part_number,
                zim.zoho_cf_product_name as cf_product_name,
                zim.zoho_cf_dpl as cf_dpl,
                zim.dpl_updated_at as dpl_updated_at,
                zim.zoho_status as status,
                zim.last_synced_at as last_synced
            FROM zoho_items_map zim
            LEFT JOIN (
                SELECT zoho_item_id, SUM(stock_on_hand) as total_stock
                FROM zoho_location_stock
                GROUP BY zoho_item_id
            ) ls_agg ON ls_agg.zoho_item_id = zim.zoho_item_id
            ${where}
            ORDER BY ${(() => {
                const SORT_WHITELIST = ['zoho_item_name','zoho_sku','zoho_brand','zoho_category_name','zoho_rate','zoho_stock_on_hand'];
                const sortCol = SORT_WHITELIST.includes(req.query.sort) ? `zim.${req.query.sort}` : 'zim.zoho_item_name';
                const sortOrder = req.query.order === 'desc' ? 'DESC' : 'ASC';
                return `${sortCol} ${sortOrder}`;
            })()}
            LIMIT ? OFFSET ?
        `, [...params, safeLimit, offset]);

        res.json({
            success: true,
            data: items,
            pagination: { total, page: parseInt(page), limit: safeLimit, pages: Math.ceil(total / safeLimit), totalPages: Math.ceil(total / safeLimit) }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/items - Create a new item in Zoho Books + local DB
 */
router.post('/items', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const { name, rate, sku, brand, category_name, unit, purchase_rate,
                cf_dpl, label_rate, description, hsn_or_sac, tax_percentage,
                manufacturer, reorder_level, status } = req.body;
        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: 'Item name is required' });
        }
        if (rate === undefined || rate === null || rate === '') {
            return res.status(400).json({ success: false, message: 'Rate is required' });
        }

        const zohoPayload = { item_type: 'inventory' };
        if (name)              zohoPayload.name           = name.trim();
        if (rate !== undefined) zohoPayload.rate          = parseFloat(rate) || 0;
        if (sku)               zohoPayload.sku            = sku.trim();
        if (unit)              zohoPayload.unit           = unit;
        if (purchase_rate)     zohoPayload.purchase_rate  = parseFloat(purchase_rate) || 0;
        if (label_rate)        zohoPayload.label_rate     = parseFloat(label_rate) || 0;
        if (description)       zohoPayload.description    = description;
        if (hsn_or_sac)        zohoPayload.hsn_or_sac     = hsn_or_sac;
        if (tax_percentage)    zohoPayload.tax_percentage = parseFloat(tax_percentage) || 0;
        if (manufacturer)      zohoPayload.manufacturer   = manufacturer;
        if (reorder_level)     zohoPayload.reorder_level  = parseInt(reorder_level) || 0;
        if (status)            zohoPayload.status         = status;
        // Zoho Books uses category_name directly
        if (category_name)     zohoPayload.category_name  = category_name;
        // Custom fields
        if (cf_dpl)            zohoPayload.cf_dpl         = parseFloat(cf_dpl) || 0;

        // Create in Zoho
        console.log('[Zoho Items] Creating item in Zoho:', JSON.stringify(zohoPayload));
        const zohoResp = await zohoAPI.createItem(zohoPayload);
        console.log('[Zoho Items] Zoho response code:', zohoResp.code, 'item_id:', zohoResp.item?.item_id);
        const createdItem = zohoResp.item;
        if (!createdItem || !createdItem.item_id) {
            console.error('[Zoho Items] No item_id in Zoho response:', JSON.stringify(zohoResp));
            return res.status(500).json({ success: false, message: 'Zoho did not return item_id' });
        }

        // Insert into local DB
        await pool.query(`
            INSERT INTO zoho_items_map
                (zoho_item_id, zoho_item_name, zoho_sku, zoho_rate, zoho_purchase_rate,
                 zoho_label_rate, zoho_unit, zoho_description, zoho_hsn_or_sac,
                 zoho_tax_percentage, zoho_brand, zoho_category_name, zoho_manufacturer,
                 zoho_reorder_level, zoho_stock_on_hand, zoho_cf_dpl, zoho_status, last_synced_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, NOW())
        `, [
            createdItem.item_id,
            name.trim(),
            sku || createdItem.sku || null,
            parseFloat(rate) || 0,
            parseFloat(purchase_rate) || 0,
            parseFloat(label_rate) || 0,
            unit || null,
            description || null,
            hsn_or_sac || null,
            parseFloat(tax_percentage) || 0,
            brand || null,
            category_name || null,
            manufacturer || null,
            parseInt(reorder_level) || 0,
            parseFloat(cf_dpl) || 0,
            status || 'active'
        ]);

        res.json({ success: true, message: 'Item created successfully', data: { zoho_item_id: createdItem.item_id, name: name.trim() } });
    } catch (error) {
        console.error('[Zoho Items] Create error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/sync/items - Sync items from Zoho (debounced 30s)
 */
router.post('/sync/items', requirePermission('zoho', 'sync'), async (req, res) => {
    try {
        const wait = isSyncDebounced('sync_items');
        if (wait > 0) {
            return res.status(429).json({ success: false, message: `Please wait ${wait}s before syncing items again` });
        }
        const result = await zohoAPI.syncItems(req.user.id);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/items/ai-edit - AI-powered item editing via KAI
 * Sends items + natural language command to AI, returns JSON edits
 */
router.post('/items/ai-edit', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const { command, items, context, history } = req.body;
        if (!command || !command.trim()) {
            return res.status(400).json({ success: false, message: 'command is required' });
        }
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'items array is required' });
        }

        // Build compact item data — minimal fields to stay within WebSocket limits
        const BATCH_SIZE = 300; // Items per AI call (keeps payload under WS frame limit)
        const allCompact = items.map(it => ({
            id: it.zoho_item_id || it.item_id,
            name: it.name || it.item_name,
            sku: it.sku || '',
            rate: parseFloat(it.rate) || 0,
            pr: parseFloat(it.purchase_rate) || 0,
            dpl: parseFloat(it.cf_dpl) || 0,
            brand: it.brand || '',
            desc: it.description || '',
            cat: it.category_name || ''
        }));

        const systemPrompt = `You are KAI, an AI Items Editor for a paint retail business (Quality Colours). You receive inventory items and a user command. Return ONLY valid JSON.

FIELD NAMES IN DATA (shortened): id, name, sku, rate (selling price), pr (purchase_rate), dpl (cf_dpl = Dealer Price List), brand, desc (description), cat (category)
EDITABLE FIELDS in edits: rate, pr, dpl, brand, sku, unit, hsn, tax, cat, desc (use these SHORT names in your edits)
READ-ONLY: id, name

PAINT INDUSTRY PRODUCT KNOWLEDGE (use this to identify products by their abbreviated names):
- "AJAX PAPER" / "ROLL PAPER AJAX" / "ROLL EMERY PAPER" = Sanding Paper / Abrasive Paper (number prefix = grit, e.g. "100 AJAX PAPER" = Sanding Paper 100 Grit)
- "AMBER" colors (Amber Black/Brown/Red/Yellow) = Powder Pigment / Oxide Color
- "STAINER" (Black/Blue/Red/Green/Yellow Stainer) = Liquid Colorant/Tinter
- "DDL FEVICOL" = Wood Adhesive, "ARALDITE" = Epoxy Adhesive, "M-SEAL" = Epoxy Compound
- "BDR" / "BORDER" = Border paint/emulsion for decorative borders
- "BS" prefix (BS01/BS04/BS10/BS20) = Bucket Size (01L/04L/10L/20L) of emulsions
- "AP" prefix = Asian Paints, "APCO" = Apcolite (enamel line), "APEX" = exterior emulsion line
- "DIS" prefix = Distemper, "APTY" = Wall Putty, "CC" prefix = Construction Chemical
- "AF" prefix = Antifouling (marine paint), "BC" prefix = Base Coat (marine/industrial)
- "CST" prefix = Custom shade/color enamel, "CR" prefix = Crack repair product
- "FG" prefix = Floor Guard, "BF" prefix = Marine bottom finish paint
- "CAP WASTE" / "CLOTH WASTE" / "COLOUR WASTE" = Cleaning supplies

RULES:
- Return ONLY JSON: { "edits": [...], "summary": "...", "reply": "..." }
- Each edit: { "id": "<item_id>", "changes": { "<field>": <value> } }. Use SHORT field names (pr, dpl, cat, hsn, tax, desc).
- CRITICAL: Process EVERY matching item. Do NOT skip items. Scan ALL items in the batch.
- Only include changed items. Round numbers to 2 decimals. NEVER change id/name.
- "reply" = conversational message for chat (markdown OK). "summary" = one-line description.
- For % ops: "increase by 5%" = multiply by 1.05. "Set DPL to 80% of rate" = dpl = rate * 0.8.
- If REFERENCE DATA provided (Excel table), match items by name/SKU and apply values from reference.
- If unclear: return empty edits with helpful reply.
- IMPORTANT: Return ONLY the JSON object. No markdown fences, no extra text.`;

        // Field name mapping (short → full)
        const fieldMap = {
            pr: 'purchase_rate', dpl: 'cf_dpl', cat: 'category_name',
            hsn: 'hsn_or_sac', tax: 'tax_percentage', desc: 'description',
            category: 'category_name', tax_pct: 'tax_percentage',
            purchase_rate: 'purchase_rate', cf_dpl: 'cf_dpl', description: 'description'
        };

        // === DETERMINISTIC REFERENCE DATA MATCHING ===
        // If context contains a tab-separated table (pasted from Excel), parse it and do
        // exact name matching instead of sending to AI. This is instant, accurate, and handles
        // thousands of items without batching or timeouts.
        if (context && context.includes('\t')) {
            const lines = context.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            if (lines.length >= 2) {
                // Parse header row to detect columns
                const headerLine = lines[0];
                const headers = headerLine.split('\t').map(h => h.trim().toLowerCase());

                // Map header names to our field names
                const headerFieldMap = {
                    'brand': 'brand', 'brand name': 'brand',
                    'rate': 'rate', 'selling price': 'rate', 'price': 'rate', 'mrp': 'rate',
                    'purchase rate': 'purchase_rate', 'purchase_rate': 'purchase_rate', 'cost': 'purchase_rate', 'cost price': 'purchase_rate',
                    'dpl': 'cf_dpl', 'cf_dpl': 'cf_dpl', 'dealer price': 'cf_dpl',
                    'sku': 'sku',
                    'unit': 'unit',
                    'hsn': 'hsn_or_sac', 'hsn code': 'hsn_or_sac', 'hsn_or_sac': 'hsn_or_sac', 'sac': 'hsn_or_sac',
                    'tax': 'tax_percentage', 'tax %': 'tax_percentage', 'tax_percentage': 'tax_percentage', 'gst': 'tax_percentage',
                    'category': 'category_name', 'category name': 'category_name', 'category_name': 'category_name',
                    'description': 'description'
                };

                // Find which column is the item name (first column or explicit header)
                const nameColIdx = headers.findIndex(h =>
                    h === 'item name' || h === 'name' || h === 'item_name' || h === 'product name' || h === 'product'
                );
                const nameIdx = nameColIdx >= 0 ? nameColIdx : 0; // Default to first column

                // Find value columns (everything except the name column)
                const valueColumns = [];
                for (let i = 0; i < headers.length; i++) {
                    if (i === nameIdx) continue;
                    const fieldName = headerFieldMap[headers[i]];
                    if (fieldName) {
                        valueColumns.push({ colIdx: i, fieldName });
                    }
                }

                // Only use deterministic matching if we found at least one value column
                if (valueColumns.length > 0) {
                    // Build lookup map: normalized item name → { field: value, ... }
                    const lookupMap = new Map();
                    for (let i = 1; i < lines.length; i++) {
                        const cols = lines[i].split('\t');
                        const itemName = (cols[nameIdx] || '').trim();
                        if (!itemName) continue;

                        const values = {};
                        for (const vc of valueColumns) {
                            const val = (cols[vc.colIdx] || '').trim();
                            if (val) {
                                // Keep numeric fields as numbers
                                if (['rate', 'purchase_rate', 'cf_dpl', 'tax_percentage'].includes(vc.fieldName)) {
                                    const num = parseFloat(val);
                                    if (!isNaN(num)) values[vc.fieldName] = num;
                                } else {
                                    values[vc.fieldName] = val;
                                }
                            }
                        }
                        if (Object.keys(values).length > 0) {
                            lookupMap.set(itemName.toUpperCase(), values);
                        }
                    }

                    // Match items by exact name
                    const allEdits = [];
                    let matchCount = 0;
                    let missCount = 0;
                    for (const item of allCompact) {
                        const itemName = (item.name || '').trim().toUpperCase();
                        const match = lookupMap.get(itemName);
                        if (match) {
                            // Only include fields that actually changed
                            const changes = {};
                            for (const [field, newVal] of Object.entries(match)) {
                                const shortField = Object.entries(fieldMap).find(([, v]) => v === field);
                                const currentVal = shortField ? item[shortField[0]] : item[field];
                                if (String(currentVal || '').toUpperCase() !== String(newVal).toUpperCase()) {
                                    changes[field] = newVal;
                                }
                            }
                            if (Object.keys(changes).length > 0) {
                                allEdits.push({ zoho_item_id: item.id, changes });
                                matchCount++;
                            }
                        } else {
                            missCount++;
                        }
                    }

                    const fieldNames = valueColumns.map(vc => vc.fieldName).join(', ');
                    const summary = `Direct match: Updated ${matchCount} items (${fieldNames}). ${missCount} items had no match in reference data. ${lookupMap.size} reference entries used.`;
                    const reply = `**Direct Data Match Complete**\n\n` +
                        `Applied **${fieldNames}** from your reference table (${lookupMap.size} entries) to ${allCompact.length} items.\n\n` +
                        `- **${matchCount}** items updated (exact name match)\n` +
                        `- **${allCompact.length - matchCount - missCount}** items already had correct values\n` +
                        `- **${missCount}** items not found in reference data\n\n` +
                        `*Used deterministic matching — every value applied exactly as provided.*`;

                    return res.json({
                        success: true,
                        edits: allEdits,
                        summary,
                        reply,
                        model: 'deterministic',
                        itemsProcessed: allCompact.length,
                        batchCount: 1
                    });
                }
            }
        }

        // === QUICK STATS HANDLER ===
        // Answer listing/counting questions instantly from loaded items
        const isListQuestion = /\b(how\s+many|list\s+(all|out)|show\s+(all|me)|count|available|what.*categor|what.*brand|which.*categor|which.*brand)\b/i.test(command);
        if (isListQuestion) {
            const brands = {};
            const categories = {};
            allCompact.forEach(it => {
                if (it.brand) brands[it.brand] = (brands[it.brand] || 0) + 1;
                if (it.cat) categories[it.cat] = (categories[it.cat] || 0) + 1;
            });
            const sortedBrands = Object.entries(brands).sort((a, b) => b[1] - a[1]);
            const sortedCats = Object.entries(categories).sort((a, b) => b[1] - a[1]);

            let reply = `**Item Statistics** (${allCompact.length} items loaded)\n\n`;
            if (/brand/i.test(command) || !/categor/i.test(command)) {
                reply += `**Brands (${sortedBrands.length}):**\n`;
                reply += sortedBrands.map(([name, count]) => `- ${name}: ${count} items`).join('\n');
                reply += '\n\n';
            }
            if (/categor/i.test(command) || !/brand/i.test(command)) {
                reply += `**Categories (${sortedCats.length}):**\n`;
                reply += sortedCats.map(([name, count]) => `- ${name}: ${count} items`).join('\n');
            }

            return res.json({
                success: true,
                edits: [],
                summary: `${sortedBrands.length} brands, ${sortedCats.length} categories across ${allCompact.length} items`,
                reply,
                model: 'deterministic',
                itemsProcessed: allCompact.length,
                batchCount: 0
            });
        }

        // === DETERMINISTIC PAINT PRODUCT CATEGORIZER ===
        // When user asks to categorize/classify items, use keyword matching on product names.
        // This is instant, handles all items, and never misses any.
        // Only trigger categorizer for ACTION commands, not questions about categories
        const isCategoryCommand = /\b(categor(ize|ise)|classify|assign\s+categor|set\s+categor|bulk\s+categor|update\s+categor)\b/i.test(command);
        if (isCategoryCommand) {
            function categorizePaintItem(name, desc, brand) {
                const text = `${name || ''} ${desc || ''}`.toUpperCase();
                const b = (brand || '').toUpperCase();

                // --- MARINE / ANTIFOULING ---
                if (/\bANTIFOUL/i.test(text) || /\bMARINE\b/i.test(text) || /\bBASE COAT\b/i.test(text) ||
                    /\bRUST O CAP\b/i.test(text) || /\bPROTECTMASTIC\b/i.test(text) ||
                    b.includes('MARINE') || /\bBF\s/.test(name)) return 'MARINE';

                // --- WALL PUTTY ---
                if (/\bWALL\s*PUTTY\b/.test(text) || /\bWALLCARE.*PUTTY\b/.test(text) ||
                    /\bAPTY\d/.test(text) || /\bSMARTCARE\s*WATERPROOF\s*PUTTY\b/.test(text) ||
                    /\bBIRLA\s*WALLCARE\b/.test(text) || /\bPLASTER\s*COAT\b/.test(text))
                    return b.includes('OPUS') ? 'OPUS WALLCARE&WALLPUTTY'
                         : b.includes('BERGER') ? 'BERGER WALLCARE&WALLPUTTY'
                         : b.includes('MULTI') ? 'MULTI WALLCARE&WALLPUTTY'
                         : /TRUCARE/.test(text) ? (/SUPREMA/.test(text) ? 'TRUCARE WALL PUTTY SUPREMA WHITE- PROJECT' : 'TRUCARE WALL PUTTY WHITE')
                         : /PUTTY.*WHITE|WHITE.*PUTTY/.test(text) ? 'AP TRUCARE ACR WALL PUTTY WHITE'
                         : 'MULTI WALLCARE&WALLPUTTY';

                // --- CONSTRUCTION CHEMICALS / WATERPROOFING ---
                if (/\bCRACK\s*(PASTE|SEAL|POWDER)\b/.test(text) || /\bSEEPGAU?RD\b/.test(text) ||
                    /\bDR\s*FIXIT\b/.test(text) || /\bCMX\b/.test(text) || /\bCRACK\s*MASTER\b/.test(text) ||
                    /\bCC\d/.test(name) || /\bCR\d/.test(name))
                    return /OPUS/.test(text) ? 'CONSTRUCTION CHEMICALS' : /BERGER/.test(text) ? 'CONSTRUCTION CHEMICALS' : 'CONSTRUCTION CHEMICALS';

                if (/\bDAMP\s*PROOF\b/.test(text) || /\bDAMP\s*BLOCK\b/.test(text) || /\bDAMP\s*SHEATH\b/.test(text) ||
                    /\bHYDROLOC\b/.test(text) || /\bWATER\s*PROOF\b/.test(text) || /\bSMART\s*CARE\b/.test(text) ||
                    /\bSMRTCR\b/.test(text)) {
                    if (/DAMP\s*PROOF.*TERACOTA|TERACOTA.*DAMP/.test(text)) return 'AP SMARTCARE DAMP PROOF TERACOTA';
                    if (/DAMP\s*PROOF.*WHITE|WHITE.*DAMP\s*PROOF/.test(text)) return 'AP SMARTCARE DAMP PROOF WHITE';
                    if (/DAMP\s*BLOCK/.test(text)) return /PRIME/.test(text) ? 'SMARTCARE DAMP BLOCK 2K PRIME BLACK' : 'AP SMARTCARE DAMP BLOCK - 2K BLACK';
                    if (/DAMP\s*SHEATH.*EXT/.test(text)) return 'AP SMARTCARE DAMP SHEATH EXTERIOR WHITE';
                    if (/DAMP\s*SHEATH.*INT.*CLASC|CLASC.*INT/.test(text)) return 'AP SMARTCARE DAMP SHEATH INTERIOR CLASC WT';
                    if (/DAMP\s*SHEATH.*INT/.test(text)) return 'AP SMARTCARE DAMP SHEATH INTERIOR WHITE';
                    if (/HYDROLOC/.test(text)) return 'AP SMARTCARE HYDROLOC CLEAR';
                    if (/CRACK\s*SEAL/.test(text)) return 'AP SMARTCARE CRACK SEAL WHITE';
                    if (/REPAIR\s*POLYMER/.test(text)) return 'AP SMART CARE REPAIR POLYMER WHITE';
                    return 'AP SMARTCARE DAMP PROOF WHITE';
                }

                // --- DISTEMPER ---
                if (/\bDIS?TEMB?E?R\b/.test(text) || /\bDIS\d/.test(name) || /\bBISON\s*DIS/.test(text))
                    return /OPUS/.test(text) || b.includes('OPUS') ? 'OPUS DISTEMPAR'
                         : /BERGER/.test(text) || b.includes('BERGER') ? 'BERGER DISTEMPAR'
                         : 'MULTI PDR';

                // --- FLOOR COAT ---
                if (/\bFLOOR\s*(COAT|GUARD)\b/.test(text) || /\bFG\d/.test(name))
                    return /OPUS/.test(text) || b.includes('OPUS') ? 'OPUS FLOOR COAT' : 'FLOOR COAT';

                // --- WOOD PRODUCTS ---
                if (/\bMELA[MY]NE\b/.test(text) || /\bWOOD\s*TECH\b/.test(text) || /\bWOODTECH\b/.test(text) ||
                    /\bVARNISH\b/.test(text) || /\bWOOD\s*STAIN\b/.test(text) || /\bNC\s*SAND/.test(text) ||
                    /\bPU\s*(EX|IN|INT|EXT|PALETTE)\b/.test(text) || /\bLACQUER\b/.test(text) ||
                    /\bFRENCH\s*POLISH\b/.test(text) || /\bWOOD\s*POLISH\b/.test(text) ||
                    /\bSEALER\b/.test(text) || /\bWOOD\s*PRIMER\b/.test(text)) {
                    if (/MELAMYNE.*GLOSSY|GLOSSY.*MELAMYNE/.test(text)) return 'AP WOODTECH MELAMYNE GLOSSY CLEAR';
                    if (/MELAMYNE.*MATT|MATT.*MELAMYNE/.test(text)) return 'AP WOODTECH MELAMYNE MATT CLEAR';
                    if (/MELAMYNE.*SEALER|SEALER.*MELAMYNE/.test(text)) return 'AP WOODTECH MELAMYNE SEALER CLEAR';
                    if (/PU.*EX.*GL/.test(text)) return 'ASNPTS PU EX GL CLEAR';
                    if (/PU.*IN.*SR|PU.*INT.*SEALER/.test(text)) return 'ASNPTS PU IN SR CLEAR';
                    if (/PU.*INT.*GL|PU.*IN.*GL/.test(text)) return 'PU PALETTE TRANSLUCENT APPU INT GLS';
                    if (/WOOD\s*STAIN/.test(text)) return 'WOODTECH WOOD STAIN WALNUT';
                    if (/WOOD\s*PRIMER/.test(text)) return 'ASIAN PAINTS WOOD PRIMER WHITE';
                    if (/OPUS/.test(text) || b.includes('OPUS')) return 'OPUS WOOD POLISH - SEALER, GLASSY, MAT';
                    if (/BERGER/.test(text) || b.includes('BERGER')) return 'BERGER WOOD POLISH - SEALER, GLASSY, MAT';
                    return 'ASIAN PAINT PRODUCTS';
                }

                // --- PRIMER ---
                if (/\bPRIMER\b/.test(text) || /\bPRIMEX\b/.test(text) || /\bPRIMCOAT\b/.test(text) ||
                    /\bPRIME\b/.test(text) && !/PREMIUM/.test(text)) {
                    if (/TRUCARE.*INT|INT.*PRIMER/.test(text) && /ASIAN|AP\b/.test(text)) return 'TRUCARE INTERIOR WALL PRIMER - WT WHITE';
                    if (/TRUCARE.*EXT|EXT.*PRIMER/.test(text)) return /WHITE\s*C/.test(text) ? 'TRUCARE EXTERIOR WALL PRIMER WHITE C' : 'TRUCARE EXTERIOR WALL PRIMER WHITE';
                    if (/EPOXY/.test(text) && /1\s*PACK/.test(text)) return 'TRUCARE 1 PACK EPOXY PRIMER LT GREY';
                    if (/SPARC.*PRIMER|INTERIOR.*PRIMER.*ASIAN/.test(text)) return 'ASIAN PAINTS SPARC INTERIOR PRIMER WHITE';
                    if (/METAL.*PRIMER.*YELLOW|YELLOW.*METAL.*PRIMER|HI\s*PERF/.test(text)) return 'HI PERFORMANCE YELLOW METAL PRIMER YELLOW';
                    if (/OPUS/.test(text) || b.includes('OPUS')) return /METAL|WOOD/.test(text) ? 'OPUS METAL & WOOD PRIMER' : 'OPUS PRIMER';
                    if (/BERGER/.test(text) || b.includes('BERGER')) return /METAL|WOOD/.test(text) ? 'BERGER METAL & WOOD PRIMER' : 'BERGER PRIMER';
                    if (/BIRLA.*OPUS|OPUS.*PRIME/.test(text) || b.includes('PRIME OPUS')) return 'BIRLA OPUS PRIME';
                    if (/NIPPON/.test(text)) return 'ASIAN PAINT PRODUCTS';
                    return 'ASIAN PAINT PRODUCTS';
                }

                // --- ENAMEL ---
                if (/\bENAMEL\b/.test(text) || /\bENML\b/.test(text) || /\bENL\b/.test(text) ||
                    /\bAPCO\s*ADV\b/.test(text) || /\bAPCOLITE\b/.test(text) || /\bAPCO\b/.test(text) ||
                    /\bGLOSS\b/.test(text) && /\bPREMIUM\b/.test(text)) {
                    if (/APCOLITE.*SHYNE|APCOADVSHYNE/.test(text)) {
                        if (/AS11/.test(text)) return 'APCOLITE ADVANCED SHYNE AS11';
                        if (/AS22/.test(text)) return 'APCOLITE ADVANCED SHYNE AS22';
                        if (/PUR\s*WH|PURWH/.test(text)) return 'APCOLITE ADVANCED SHYNE PURWHT';
                        return 'APCOLITE ADVANCED SHYNE PURWHT';
                    }
                    if (/ALL\s*PROTEK/.test(text)) return 'APCOLITE ALL PROTEK PURWHT';
                    if (/BLACK\s*BOARD/.test(text)) return 'ASIAN PAINT PRODUCTS';
                    if (/HAMMER\s*TONE/.test(text)) return 'HAMMER TONE';
                    if (/OPUS/.test(text) || b.includes('OPUS') || b.includes('ENAMEL')) return /OPUS/.test(text) || b.includes('OPUS') ? 'OPUS ENAMEL' : 'BERGER ENAMEL';
                    if (/BERGER/.test(text) || b.includes('BERGER')) return 'BERGER ENAMEL';
                    if (/SPRAY/.test(text)) return 'SPRAY PAINT';
                    return 'AP PREMIUM GLOSS ENAMEL BLACK';
                }

                // --- EMULSION (must come after enamel/primer checks) ---
                // Also match known product lines that ARE emulsions even without "EMULSION" keyword
                const isKnownEmulsionProduct = /\bAPEX\b/.test(text) || /\bROYALE\b/.test(text) ||
                    (/\bTRACTOR\b/.test(text) && !/DISTEMPER/.test(text)) ||
                    (/\bACE\b/.test(text) && !/ENAMEL/.test(text)) ||
                    /\bPREM.*BW\d/.test(text) || /TRACTOREMUL/.test(text) ||
                    /APEXULTIMA/.test(text) || /APACESHYNE/.test(text) ||
                    /APTRACTOREMUL/.test(text);
                if (/\bEMUL(SION|TION)?\b/.test(text) || /\bEML\b/.test(text) || isKnownEmulsionProduct) {
                    // Asian Paints products
                    if (/ROYALE/.test(text)) {
                        if (/SHYNE/.test(text)) {
                            if (/SN10/.test(text)) return 'ROYALE SHYNE SN10';
                            if (/SN21/.test(text)) return 'ROYALE SHYNE SN21';
                            if (/SN3\b/.test(text)) return 'ROYALE SHYNE SN3';
                            if (/RADNT|RADIANT/.test(text)) return 'AP ROYALE SHYNE RADNT WT';
                            return 'AP ROYALE SHYNE RADNT WT';
                        }
                        if (/PLY.*METALLIC|METALLIC/.test(text)) return 'AP ROYALE PLY METALLICS COPPER';
                        if (/GRAND|GRND/.test(text)) return 'AP ROYALE GRAND WHITE';
                        if (/RB1/.test(text)) return 'ROYALE LUXURY EMULSION RB1N';
                        if (/RB2/.test(text)) return 'AP ROYALE RB2';
                        return 'ROYALE LUXURY EMULSION RB1N';
                    }
                    if (/APEX.*ULTIMA|APEXULTIMA/.test(text)) {
                        if (/PROTEK/.test(text)) {
                            if (/UP1\b/.test(text)) return 'APEX ULTIMA PROTEK UP1';
                            if (/UP10/.test(text)) return 'APEX ULTIMA PROTEK UP10';
                            if (/UP20/.test(text)) return 'APEX ULTIMA PROTEK UP20';
                            return 'APEX ULTIMA PROTEK UP1';
                        }
                        if (/HQ16/.test(text)) return 'APEX ULTIMA HQ16';
                        if (/HQ17/.test(text)) return 'APEX ULTIMA HQ17';
                        if (/HQ20/.test(text)) return 'APEX ULTIMA HQ20N';
                        if (/HQ2\b|HQ2N/.test(text)) return 'APEX ULTIMA HQ2N';
                        if (/BR\s*WHITE/.test(text)) return 'AP APEX ULTIMA BR WHITE';
                        return 'APEX ULTIMA HQ17';
                    }
                    if (/APEX.*ADV|APEX\s*ADVANCED/.test(text)) {
                        if (/AV6/.test(text)) return 'APEX ADVANCED AV6';
                        return 'APEX ADVANCED AV6';
                    }
                    if (/APEX.*SUPREMA/.test(text)) return 'APEX SUPREMA CLASSIC WHITE- PROJECT';
                    if (/APEX.*TILE|TILE\s*GUARD/.test(text)) return 'APEX TILE GUARD TG1';
                    if (/\bAPEX\b/.test(text)) {
                        if (/CLASC|CLASSIC/.test(text)) return 'AP APEX CLASC WT';
                        if (/AB11/.test(text)) return 'APEX WP EXT EMULSION AB11';
                        if (/AB12/.test(text)) return 'APEX WP EXT EMULSION AB12';
                        if (/AB15/.test(text)) return 'APEX WP EXT EMULSION AB15';
                        if (/AB17/.test(text)) return 'AP APEX AB17';
                        if (/AB2\b|AB2G/.test(text)) return 'APEX WP EXT EMULSION AB2';
                        if (/AB21/.test(text)) return /AB21G/.test(text) ? 'APEX WP EXT EMULSION AB21G' : 'AP APEX AB21';
                        if (/AB6/.test(text)) return 'APEX WP EXT EMULSION AB6';
                        return 'APEX WP EXT EMULSION AB2';
                    }
                    if (/ACE.*SHYNE|ACESHYNE/.test(text)) {
                        if (/AH10/.test(text)) return 'ACE SHYNE AH10';
                        if (/AH2\b|AH21/.test(text)) return /AH21/.test(text) ? 'ACE SHYNE AH21' : 'ACE SHYNE AH2';
                        return 'ACE SHYNE AH10';
                    }
                    if (/ACE.*ADV/.test(text)) {
                        if (/AE2/.test(text)) return 'ACE ADVANCED AE2';
                        if (/WHITE/.test(text)) return 'AP ACE ADVANCED WHITE';
                        return 'ACE ADVANCED AE2';
                    }
                    if (/ACE.*SPARC/.test(text)) return 'ACE SPARC ADVANCED SUPWHT';
                    if (/\bACE\b.*EXT/.test(text)) {
                        if (/AC17/.test(text)) return 'ACE EXTERIOR EML PT AC17';
                        if (/AC21/.test(text)) return 'ACE EXTERIOR EMULSION AC21G';
                        if (/AC2\b|AC2G/.test(text)) return 'ACE EXTERIOR EMULSION AC2G';
                        if (/AC9/.test(text)) return 'ACE EXTERIOR EMULSION AC9G';
                        return 'ACE EXTERIOR EMULSION AC2G';
                    }
                    if (/TRACTOR.*SHYNE|TRACTORSHYNE/.test(text)) {
                        if (/SH1\b|SH1N/.test(text)) return 'TRACTOR EMULSION SHYNE SH1';
                        if (/SH13/.test(text)) return 'TRACTOR EMULSION SHYNE SH13';
                        return 'TRACTOR EMULSION SHYNE SH1';
                    }
                    if (/TRACTOR.*SPARC/.test(text)) return /SUPWHTA/.test(text) ? 'TRACTOR SPARC SUPWHTA' : 'TRACTOR SPARC SUPWHT';
                    if (/TRACTOR.*SUPREMA/.test(text)) return 'TRACTOR SUPREMA SPRWHITE';
                    if (/TRACTOR.*ADV|TRACTOR.*TA\d/.test(text)) return 'TRACTOR EMULSION ADVANCED TA3';
                    if (/TRACTOR/.test(text) || /\bTE\d/.test(text) || /TRACTOREMUL/.test(text)) {
                        if (/TE1\b|TE\s*1\b/.test(text)) return 'AP TRACTOR EMUL TE1';
                        if (/TE13/.test(text)) return 'TRACTOR EMULSION TE13';
                        if (/TE22/.test(text)) return 'TRACTOR EMULSION TE22N';
                        if (/TE3\b/.test(text)) return 'TRACTOR EMULSION TE3';
                        return 'AP TRACTOR EMUL TE1';
                    }
                    if (/PREM.*EMUL|PREMEMUL/.test(text)) {
                        if (/BW1\b|BW1\//.test(text)) return 'PREMIUM EMULSION BW1';
                        if (/BW11/.test(text)) return 'PREMIUM EMULSION BW11N';
                        if (/BW12/.test(text)) return 'PREMIUM EMULSION BW12';
                        return 'PREMIUM EMULSION BW1';
                    }

                    // Shalimar products
                    if (/SHALIMAR/.test(text) || /HERO\s*PREMIUM/.test(text) || /SILK.*INT|INT.*SILK/.test(text) ||
                        /SHAKTIMAN/.test(text) || /XTRA\s*TOUGH/.test(text) || /NO\s*1\s*SILK/.test(text) ||
                        /SILK\s*ECO/.test(text) || /SILK\s*SIGN/.test(text)) {
                        return 'ASIAN PAINT PRODUCTS';
                    }

                    // Berger products
                    if (/BERGER/.test(text) || b.includes('BERGER') || b.includes('EMULSION BERGER') ||
                        /FLEXO/.test(text) || /SMOOTH\s*EMUL/.test(text) || /LONG\s*LIFE/.test(text) ||
                        /FEASY/.test(text) || /EASY\s*CLEAN/.test(text) || /WALMASTA/.test(text) ||
                        /BISON\s*LITE/.test(text) || /ANTIDUST/.test(text)) return 'BERGER EMULSION';

                    // Crizon products
                    if (/CRIZON|CRIZION/.test(text) || b.includes('CRIZON')) {
                        if (/DIAMONT|GLAZE/.test(text)) return 'ASIAN PAINT PRODUCTS';
                        if (/TUF\s*PRO|TUFPRO/.test(text)) return 'ASIAN PAINT PRODUCTS';
                        if (/FEATHER\s*PRO/.test(text)) return 'ASIAN PAINT PRODUCTS';
                        if (/BDR|BORDER/.test(text)) return 'ASIAN PAINT PRODUCTS';
                        return 'ASIAN PAINT PRODUCTS';
                    }

                    // Opus products
                    if (/OPUS/.test(text) || b.includes('OPUS')) return 'OPUS EMULSION';

                    // Nippon / Astral
                    if (/NIPPON/.test(text)) return 'ASIAN PAINT PRODUCTS';
                    if (/ASTRAL/.test(text)) return 'GEM ASTRAL PAINTS';

                    // Generic/default emulsion
                    return 'ASIAN PAINT PRODUCTS';
                }

                // --- COLORANT / STAINER / TINTER ---
                if (/\bCOLOU?RANT\b/.test(text) || /\bSTAINER\b/.test(text) || /\bTINTER\b/.test(text) ||
                    /\bAMBER\b/.test(text) || /\bCC\b.*\bCOLOU?R/.test(text) || /\bBR\s*COLOURANT/.test(text)) {
                    if (/BERGER/.test(text) || b.includes('BERGER')) return 'BERGER MACHINE COLORANT';
                    if (/OPUS/.test(text) || b.includes('OPUS')) return 'OPUS EMULSION';
                    if (b.includes('MULTI')) return 'MULTI CC';
                    return 'QC STAINER';
                }

                // --- SPRAY PAINT ---
                if (/\bSPRAY\s*PAINT\b/.test(text) || /\bSPRAY\b/.test(text) && /\bPAINT\b/.test(text))
                    return 'SPRAY PAINT';

                // --- HAMMER TONE ---
                if (/\bHAMMER\s*TONE\b/.test(text)) return 'HAMMER TONE';

                // --- ADHESIVE / FEVICOL ---
                if (/\bFEVICOL\b/.test(text) || /\bARALDITE\b/.test(text) || /\bM[\s-]*SEAL\b/.test(text) ||
                    /\bADHESIVE\b/.test(text) || /\bDDL\b/.test(name))
                    return 'ACCESSORIES';

                // --- TOOLS / BRUSHES ---
                if (/\bBRUSH\b/.test(text) || /\bROLLER\b/.test(text) || /\bTAPE\b/.test(text) ||
                    /\bBLADE\b/.test(text) || /\bTRAY\b/.test(text) || /\bMASKING\b/.test(text) ||
                    /\bSPONGE\b/.test(text) || /\bSAND\s*PAPER\b/.test(text) || /\bEMERY\b/.test(text) ||
                    /\bPAPER\b/.test(text) && /\bAJAX\b/.test(text) ||
                    /\bCOMBO\b/.test(text) || /\bSCRAPER\b/.test(text) || /\bPUTTY\s*KNIFE\b/.test(text))
                    return 'TOOLS- BRUSH, ROLLER, BLADE, PAPER';

                // --- ABRASIVE / CUMI ---
                if (/\bCUMI\b/.test(text) || /\bABRASIVE\b/.test(text) || /\bGRIND\b/.test(text) ||
                    /\bSAND\b/.test(text) && /\bDISC\b/.test(text))
                    return 'ACCESSORIES';

                // --- THINNER / SOLVENT ---
                if (/\bTHINNER\b/.test(text) || /\bTURPENTINE\b/.test(text) || /\bSOLVENT\b/.test(text) ||
                    /\bSPIRIT\b/.test(text) || /\bTERMINATOR\b/.test(text))
                    return 'ACCESSORIES';

                // --- TEXTURE / DIATONE ---
                if (/\bTEXTURE\b/.test(text) || /\bDIATONE\b/.test(text) || /\bSTUCCO\b/.test(text))
                    return 'ASIAN PAINT PRODUCTS';

                // --- WASTE / MISC ---
                if (/\bWASTE\b/.test(text) || /\bCLOTH\b/.test(text) && /\bWASTE\b/.test(text) ||
                    /\bCAP\b/.test(text) && /\bWASTE\b/.test(text))
                    return 'ACCESSORIES';

                // --- Brand-based fallback for remaining items ---
                if (b.includes('OPUS') || /OPUS/.test(text)) return 'BIRLA OPUS PRODUCTS';
                if (b.includes('BERGER') || /BERGER/.test(text)) return 'BERGER PAINT PRODUCTS';
                if (b.includes('ADDISONS') || /ADDISONS/.test(text)) return 'QC ADDISONS PRODUCTS';
                if (b.includes('ASTRAL') || /ASTRAL/.test(text)) return 'GEM ASTRAL PAINTS';
                if (b.includes('MULTI')) return 'QC MULTI BRAND';
                if (/ASIAN|AP\s/.test(text) || /^AP/.test(name)) return 'ASIAN PAINT PRODUCTS';
                if (/NIPPON/.test(text)) return 'ASIAN PAINT PRODUCTS';
                if (/CRIZON|CRIZION/.test(text) || b.includes('CRIZON')) return 'ASIAN PAINT PRODUCTS';
                if (/SHALIMAR/.test(text)) return 'ASIAN PAINT PRODUCTS';

                return null; // Truly unrecognizable
            }

            const allEdits = [];
            let categorized = 0;
            let unchanged = 0;
            let unrecognized = 0;
            const categoryCounts = {};

            for (const item of allCompact) {
                const newCat = categorizePaintItem(item.name, item.desc, item.brand);
                if (!newCat) {
                    unrecognized++;
                    continue;
                }
                // Only include if category actually changed
                if ((item.cat || '').toUpperCase() !== newCat.toUpperCase()) {
                    allEdits.push({ zoho_item_id: item.id, changes: { category_name: newCat } });
                    categorized++;
                    categoryCounts[newCat] = (categoryCounts[newCat] || 0) + 1;
                } else {
                    unchanged++;
                }
            }

            // Build summary of categories assigned
            const topCats = Object.entries(categoryCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 15)
                .map(([cat, cnt]) => `  - ${cat}: ${cnt} items`)
                .join('\n');

            const summary = `Categorized ${categorized} items across ${Object.keys(categoryCounts).length} categories. ${unchanged} already correct, ${unrecognized} unrecognized.`;
            const reply = `**Category Assignment Complete**\n\n` +
                `- **${categorized}** items updated with new categories\n` +
                `- **${unchanged}** items already had correct categories\n` +
                `- **${unrecognized}** items could not be categorized (unrecognized names)\n\n` +
                `**Top categories assigned:**\n${topCats}\n\n` +
                `*Deterministic matching — instant, 100% consistent.*`;

            return res.json({
                success: true,
                edits: allEdits,
                summary,
                reply,
                model: 'deterministic',
                itemsProcessed: allCompact.length,
                batchCount: 1
            });
        }

        // === DETERMINISTIC DESCRIPTION UPDATER ===
        // Detect commands about updating descriptions for known product types.
        // Handles product-specific description generation based on item name patterns.
        const isDescCommand = /\bdescription\b/i.test(command);
        if (isDescCommand) {
            const allEdits = [];
            const productTypes = [];

            // --- Sanding Paper / Abrasive Paper ---
            if (/\bsand(ing)?\s*paper\b/i.test(command) || /\bajax\b/i.test(command) || /\bemery\b/i.test(command) || /\babrasive\b/i.test(command)) {
                productTypes.push('Sanding Paper');
                for (const item of allCompact) {
                    const name = (item.name || '').toUpperCase();
                    // Match: "100 AJAX PAPER", "80 ROLL PAPER AJAX 01 METER", "100 ROLL EMERY PAPER 1 MT"
                    if (/AJAX\s*PAPER/.test(name) || /ROLL\s*PAPER\s*AJAX/.test(name) || /EMERY\s*PAPER/.test(name) || /ROLL\s*EMERY/.test(name)) {
                        const gritMatch = name.match(/^(\d+)\s/);
                        const grit = gritMatch ? gritMatch[1] : '';
                        let newDesc;
                        if (/ROLL/.test(name)) {
                            const meterMatch = name.match(/(\d+)\s*M(T|ETER)?/i);
                            const meter = meterMatch ? meterMatch[1] + ' Meter' : '';
                            newDesc = `Sanding Paper ${grit} Grit Roll${meter ? ' ' + meter : ''}`;
                        } else {
                            newDesc = `Sanding Paper ${grit} Grit Sheet`;
                        }
                        if (newDesc && newDesc !== (item.desc || '')) {
                            allEdits.push({ zoho_item_id: item.id, changes: { description: newDesc } });
                        }
                    }
                }
            }

            // --- Stainer / Colorant ---
            if (/\bstainer\b/i.test(command) || /\bcolourant\b/i.test(command) || /\bcolorant\b/i.test(command)) {
                productTypes.push('Stainer/Colorant');
                for (const item of allCompact) {
                    const name = (item.name || '').toUpperCase();
                    if (/STAINER/.test(name)) {
                        const colorMatch = name.match(/^(BLACK|BLUE|RED|GREEN|YELLOW|BROWN|WHITE|ORANGE|VIOLET|MAROON)\s+STAINER/i);
                        const sizeMatch = name.match(/(\d+)\s*ML/i);
                        if (colorMatch) {
                            const color = colorMatch[1].charAt(0) + colorMatch[1].slice(1).toLowerCase();
                            const size = sizeMatch ? sizeMatch[1] + 'ml' : '';
                            const newDesc = `${color} Liquid Stainer${size ? ' ' + size : ''}`;
                            if (newDesc !== (item.desc || '')) {
                                allEdits.push({ zoho_item_id: item.id, changes: { description: newDesc } });
                            }
                        }
                    }
                }
            }

            // --- Amber / Powder Pigment ---
            if (/\bamber\b/i.test(command) || /\bpigment\b/i.test(command) || /\boxide\b/i.test(command)) {
                productTypes.push('Powder Pigment');
                for (const item of allCompact) {
                    const name = (item.name || '').toUpperCase();
                    if (/^AMBER\s/.test(name)) {
                        const colorMatch = name.match(/AMBER\s+(BLACK|BROWN|RED|YELLOW|GREEN|BLUE|WHITE|ORANGE)/i);
                        const sizeMatch = name.match(/(\d+)\s*G/i);
                        if (colorMatch) {
                            const color = colorMatch[1].charAt(0) + colorMatch[1].slice(1).toLowerCase();
                            const size = sizeMatch ? sizeMatch[1] + 'g' : '';
                            const newDesc = `Amber ${color} Powder Pigment${size ? ' ' + size : ''}`;
                            if (newDesc !== (item.desc || '')) {
                                allEdits.push({ zoho_item_id: item.id, changes: { description: newDesc } });
                            }
                        }
                    }
                }
            }

            if (allEdits.length > 0 || productTypes.length > 0) {
                const summary = `Updated descriptions for ${allEdits.length} ${productTypes.join(', ')} items`;
                const reply = `**Description Update Complete**\n\n` +
                    `Updated **${allEdits.length}** item descriptions for: ${productTypes.join(', ')}\n\n` +
                    allEdits.slice(0, 20).map(e => `- ${e.changes.description}`).join('\n') +
                    (allEdits.length > 20 ? `\n- ...and ${allEdits.length - 20} more` : '') +
                    `\n\n*Deterministic — instant, exact values from item names.*`;

                return res.json({
                    success: true,
                    edits: allEdits,
                    summary,
                    reply,
                    model: 'deterministic',
                    itemsProcessed: allCompact.length,
                    batchCount: 1
                });
            }
        }

        // === AI-BASED PROCESSING (fallback for non-reference-data commands) ===
        // Build context section if reference data provided but not tab-separated
        const contextSection = context ? `\nREFERENCE DATA (Excel/table):\n${context.substring(0, 200000)}\n` : '';

        // Split into batches and process in parallel
        const batches = [];
        for (let i = 0; i < allCompact.length; i += BATCH_SIZE) {
            batches.push(allCompact.slice(i, i + BATCH_SIZE));
        }

        const batchPromises = batches.map((batch, bIdx) => {
            let itemOffset = 0;
            for (let i = 0; i < bIdx; i++) itemOffset += batches[i].length;
            const batchLabel = batches.length > 1
                ? `\nBATCH ${bIdx + 1}/${batches.length} (items ${itemOffset + 1}-${itemOffset + batch.length} of ${allCompact.length})`
                : '';

            const userMessage = `COMMAND: ${command.trim()}${contextSection}${batchLabel}
ITEMS (${batch.length}):
${JSON.stringify(batch)}`;

            const messages = [{ role: 'system', content: systemPrompt }];
            if (Array.isArray(history) && history.length > 0) {
                history.slice(-6).forEach(msg => {
                    if (msg.role === 'user' || msg.role === 'assistant') {
                        messages.push({ role: msg.role, content: msg.content });
                    }
                });
            }
            messages.push({ role: 'user', content: userMessage });

            return aiEngine.generateWithFailover(messages, { max_tokens: 16000, temperature: 0.1 })
                .then(result => ({ bIdx, result }))
                .catch(err => ({ bIdx, error: err.message }));
        });

        const batchResults = await Promise.all(batchPromises);

        // Collect results in order
        const allEdits = [];
        const batchSummaries = [];
        let lastReply = '';
        let lastModel = 'unknown';

        for (const br of batchResults) {
            const batchNum = br.bIdx + 1;
            if (br.error) {
                batchSummaries.push(`Batch ${batchNum}: ${br.error}`);
                continue;
            }
            if (!br.result || !br.result.text) {
                batchSummaries.push(`Batch ${batchNum}: empty response`);
                continue;
            }

            lastModel = br.result.model || 'unknown';

            let responseText = br.result.text.trim();
            if (responseText.startsWith('```')) {
                responseText = responseText.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
            }

            let parsed;
            try {
                parsed = JSON.parse(responseText);
            } catch (parseErr) {
                const jsonMatch = responseText.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    try { parsed = JSON.parse(jsonMatch[0]); } catch { parsed = null; }
                }
            }

            if (parsed && Array.isArray(parsed.edits)) {
                const mappedBatchEdits = parsed.edits.map(e => {
                    const changes = {};
                    for (const [k, v] of Object.entries(e.changes || {})) {
                        changes[fieldMap[k] || k] = v;
                    }
                    return { zoho_item_id: e.id, changes };
                });
                allEdits.push(...mappedBatchEdits);
                batchSummaries.push(parsed.summary || `Batch ${batchNum}: ${mappedBatchEdits.length} edits`);
                lastReply = parsed.reply || parsed.summary || '';
            } else {
                batchSummaries.push(`Batch ${batchNum}: failed to parse response`);
            }
        }

        // Build combined response
        const summary = batches.length > 1
            ? `Updated ${allEdits.length} items across ${batches.length} batches (${allCompact.length} total processed)`
            : (batchSummaries[0] || `Processed ${allEdits.length} items`);
        const reply = batches.length > 1
            ? `${lastReply}\n\n**Batch processing complete**: ${allEdits.length} items updated across ${batches.length} batches (${allCompact.length} items scanned).`
            : (lastReply || summary);

        res.json({
            success: true,
            edits: allEdits,
            summary,
            reply,
            model: lastModel,
            itemsProcessed: allCompact.length,
            batchCount: batches.length,
            batchSummaries: batches.length > 1 ? batchSummaries : undefined
        });

    } catch (error) {
        console.error('AI items edit error:', error);
        res.status(500).json({ success: false, message: 'AI processing failed: ' + error.message });
    }
});

/**
 * POST /api/zoho/items/bulk-update - Create bulk update job
 */
router.post('/items/bulk-update', requirePermission('zoho', 'bulk_update'), async (req, res) => {
    try {
        const { filter, update_fields } = req.body;
        if (!filter || !update_fields) {
            return res.status(400).json({ success: false, message: 'filter and update_fields required' });
        }

        const result = await zohoAPI.createBulkUpdateJob(filter, update_fields, req.user.id);
        res.json({ success: true, data: result, message: `Bulk job created with ${result.total_items} items` });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// Shared core of the per-item bulk edit: validates, enforces SKU uniqueness
// (batch + local-mirror cross-check), creates the bulk job + job items, and
// optimistically updates the local zoho_items_map (SKU excluded — written only
// after Zoho confirms, in the bulk-job worker). Throws an Error tagged with
// { httpStatus, code, payload } for the caller to translate to a response.
async function createBulkEditJob(items, user) {
    if (!items || !Array.isArray(items) || items.length === 0) {
        throw Object.assign(new Error('items array is required'), { httpStatus: 400 });
    }
    for (const item of items) {
        if (!item.zoho_item_id || !item.changes || Object.keys(item.changes).length === 0) {
            throw Object.assign(new Error('Each item must have zoho_item_id and non-empty changes'), { httpStatus: 400 });
        }
    }

    // Reject batches that would push the same SKU to multiple distinct
    // Zoho items — Zoho enforces SKU uniqueness, so the first item wins
    // and the rest fail with "error 1001: SKU already exists", and the
    // partial failure leaves the local mirror in a corrupted state.
    //
    // We also reject when a SKU in the batch is already held by a
    // DIFFERENT active item in our local mirror (the classic
    // OPCL01-WHITE vs OPCL01-ORANGE situation): the only thing that
    // would happen on Zoho is a rejection anyway, and we'd rather the
    // user fix it now than discover it 6 minutes into a 200-item job.
    {
        const skuToItems = new Map();
        for (const it of items) {
            const sku = it.changes && it.changes.sku ? String(it.changes.sku).trim() : '';
            if (!sku) continue;
            const key = sku.toUpperCase();
            if (!skuToItems.has(key)) skuToItems.set(key, []);
            skuToItems.get(key).push({ zoho_item_id: it.zoho_item_id, item_name: it.item_name || '', sku });
        }
        const batchDupes = [];
        for (const [_, list] of skuToItems) { if (list.length > 1) batchDupes.push(list); }
        if (batchDupes.length) {
            throw Object.assign(new Error('Batch contains multiple items being pushed with the same SKU. Zoho enforces SKU uniqueness, so this would fail. Edit the SKUs to make them unique.'),
                { httpStatus: 400, code: 'DUPLICATE_SKUS_IN_BATCH', payload: { duplicates: batchDupes } });
        }
        // Cross-check against the local mirror for SKUs already held by
        // ANOTHER active item that is NOT in this batch.
        const skuList = Array.from(skuToItems.keys());
        if (skuList.length) {
            const [held] = await pool.query(
                `SELECT zoho_item_id, zoho_sku, zoho_item_name
                   FROM zoho_items_map
                  WHERE zoho_status = 'active'
                    AND UPPER(zoho_sku) IN (${skuList.map(() => '?').join(',')})`,
                skuList
            );
            const conflicts = [];
            for (const row of held) {
                const rowSku = String(row.zoho_sku || '').toUpperCase();
                const batchEntries = skuToItems.get(rowSku) || [];
                for (const be of batchEntries) {
                    if (be.zoho_item_id !== row.zoho_item_id) {
                        conflicts.push({
                            batch_item: be,
                            already_held_by: { zoho_item_id: row.zoho_item_id, item_name: row.zoho_item_name }
                        });
                    }
                }
            }
            if (conflicts.length) {
                throw Object.assign(new Error('One or more SKUs in the batch are already held by a different active item in Zoho. Push would fail with "SKU already exists". Edit to use unique SKUs.'),
                    { httpStatus: 400, code: 'SKU_HELD_BY_OTHER_ITEM', payload: { conflicts } });
            }
        }
    }

    // Create bulk job
    const [jobResult] = await pool.query(`
        INSERT INTO zoho_bulk_jobs (job_type, filter_criteria, update_fields, total_items, created_by)
        VALUES ('item_update', ?, ?, ?, ?)
    `, [
        JSON.stringify({ mode: 'per_item_edit', item_count: items.length }),
        JSON.stringify({ mode: 'per_item' }),
        items.length,
        user.id
    ]);
    const jobId = jobResult.insertId;

    // Create individual job items with per-item payloads
    // If item_name is missing, look it up from zoho_items_map
    const itemsWithoutName = items.filter(i => !i.item_name);
    const nameLookup = {};
    if (itemsWithoutName.length > 0) {
        const ids = itemsWithoutName.map(i => i.zoho_item_id);
        const [nameRows] = await pool.query(
            `SELECT zoho_item_id, zoho_item_name FROM zoho_items_map WHERE zoho_item_id IN (${ids.map(() => '?').join(',')})`,
            ids
        );
        nameRows.forEach(r => { nameLookup[r.zoho_item_id] = r.zoho_item_name; });
    }

    for (const item of items) {
        const itemName = item.item_name || nameLookup[item.zoho_item_id] || '';
        await pool.query(`
            INSERT INTO zoho_bulk_job_items (job_id, zoho_item_id, item_name, payload)
            VALUES (?, ?, ?, ?)
        `, [jobId, item.zoho_item_id, itemName, JSON.stringify(item.changes)]);
    }

    // Also update local zoho_items_map so edits persist before Zoho sync.
    // NOTE: `sku` is deliberately excluded here — Zoho enforces SKU
    // uniqueness, so an optimistic local SKU write can leave us with two
    // active items sharing the same SKU when Zoho rejects the second push
    // ("error 1001: SKU already exists"). On the next admin-dpl run, the
    // proposer reads the corrupted SKU and proposes another colliding
    // push. The SKU write now lives in services/zoho-api.js inside the
    // bulk-job worker, fired only after Zoho confirms the row.
    const FIELD_MAP = {
        name: 'zoho_item_name', /* sku intentionally NOT here — see comment above */
        rate: 'zoho_rate',
        purchase_rate: 'zoho_purchase_rate', cf_dpl: 'zoho_cf_dpl',
        label_rate: 'zoho_label_rate',
        unit: 'zoho_unit', hsn_or_sac: 'zoho_hsn_or_sac',
        tax_percentage: 'zoho_tax_percentage', brand: 'zoho_brand',
        category_name: 'zoho_category_name', category: 'zoho_category_name',
        manufacturer: 'zoho_manufacturer',
        reorder_level: 'zoho_reorder_level', description: 'zoho_description',
        cf_product_name: 'zoho_cf_product_name', status: 'zoho_status'
    };
    for (const item of items) {
        const sets = [];
        const vals = [];
        for (const [key, val] of Object.entries(item.changes)) {
            const dbCol = FIELD_MAP[key];
            if (dbCol) {
                sets.push(`${dbCol} = ?`);
                vals.push(val);
            }
        }
        if (Object.prototype.hasOwnProperty.call(item.changes, 'cf_dpl')) {
            sets.push('dpl_updated_at = NOW()');
        }
        if (sets.length > 0) {
            vals.push(item.zoho_item_id);
            await pool.query(`UPDATE zoho_items_map SET ${sets.join(', ')} WHERE zoho_item_id = ?`, vals);
        }
        // Sync rate change → pack_sizes.base_price so admin-products.html stays in sync
        if (Object.prototype.hasOwnProperty.call(item.changes, 'rate')) {
            await pool.query(
                'UPDATE pack_sizes SET base_price = ? WHERE zoho_item_id = ? AND is_active = 1',
                [item.changes.rate, item.zoho_item_id]
            );
        }
    }

    return { job_id: jobId, total_items: items.length };
}

/**
 * POST /api/zoho/items/bulk-edit - Create bulk job with per-item unique payloads
 * Unlike bulk-update (same fields for all items), this accepts individual changes per item.
 */
router.post('/items/bulk-edit', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const result = await createBulkEditJob(req.body.items, req.user);
        res.json({ success: true, data: result, message: `Bulk edit job created with ${result.total_items} items` });
    } catch (error) {
        const status = error.httpStatus || 500;
        res.status(status).json(Object.assign({ success: false, message: error.message }, error.code ? { code: error.code } : {}, error.payload || {}));
    }
});

/**
 * GET /api/zoho/items/bulk-jobs - List bulk jobs
 * NOTE: Must be defined BEFORE /items/:id to avoid :id catching "bulk-jobs"
 */
router.get('/items/bulk-jobs', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;
        const safeLimit = Math.min(parseInt(limit) || 20, 500);

        let where = 'WHERE 1=1';
        const params = [];

        if (status) { where += ' AND bj.status = ?'; params.push(status); }

        const offset = (Math.max(1, parseInt(page)) - 1) * safeLimit;

        const [jobs] = await pool.query(`
            SELECT bj.*, u.full_name as created_by_name
            FROM zoho_bulk_jobs bj
            LEFT JOIN users u ON bj.created_by = u.id
            ${where}
            ORDER BY bj.created_at DESC
            LIMIT ? OFFSET ?
        `, [...params, safeLimit, offset]);

        res.json({ success: true, data: jobs });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/items/bulk-jobs/:id - Job detail with item-level status
 */
router.get('/items/bulk-jobs/:id', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const [jobs] = await pool.query(`
            SELECT bj.*, u.full_name as created_by_name
            FROM zoho_bulk_jobs bj
            LEFT JOIN users u ON bj.created_by = u.id
            WHERE bj.id = ? LIMIT 1
        `, [req.params.id]);

        if (jobs.length === 0) {
            return res.status(404).json({ success: false, message: 'Job not found' });
        }

        const { page = 1, limit = 50, item_status } = req.query;
        const safeLimit = Math.min(parseInt(limit) || 50, 500);
        let itemWhere = 'WHERE bji.job_id = ?';
        const itemParams = [req.params.id];

        if (item_status) { itemWhere += ' AND bji.status = ?'; itemParams.push(item_status); }

        const offset = (Math.max(1, parseInt(page)) - 1) * safeLimit;

        const [items] = await pool.query(`
            SELECT bji.* FROM zoho_bulk_job_items bji
            ${itemWhere}
            ORDER BY bji.id
            LIMIT ? OFFSET ?
        `, [...itemParams, safeLimit, offset]);

        res.json({ success: true, data: { job: jobs[0], items } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/items/bulk-jobs/:id/cancel - Cancel job
 */
router.post('/items/bulk-jobs/:id/cancel', requirePermission('zoho', 'bulk_update'), async (req, res) => {
    try {
        const result = await zohoAPI.cancelBulkJob(parseInt(req.params.id));
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/items/bulk-jobs/:id/retry - Retry failed items
 */
router.post('/items/bulk-jobs/:id/retry', requirePermission('zoho', 'bulk_update'), async (req, res) => {
    try {
        const result = await zohoAPI.retryBulkJob(parseInt(req.params.id));
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/items/:id - Single item detail (fresh from Zoho)
 * NOTE: Must be AFTER all /items/bulk-* routes to avoid catching those paths
 */
router.get('/items/:id', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        // Rate limiting handled centrally in apiGet; pass priority for reserve access
        const zohoData = await zohoAPI.getItem(req.params.id, { caller: 'getItemDetail', priority: 'high' });
        res.json({ success: true, data: zohoData.item || zohoData });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// DAILY TRANSACTIONS
// ========================================

/**
 * GET /api/zoho/transactions/daily - Summary with date range + location filter
 */
router.get('/transactions/daily', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const { from_date, to_date, location_id, page = 1, limit = 50 } = req.query;
        const safeLimit = Math.min(parseInt(limit) || 50, 500);

        let where = 'WHERE 1=1';
        const params = [];

        if (from_date) { where += ' AND dt.transaction_date >= ?'; params.push(from_date); }
        if (to_date) { where += ' AND dt.transaction_date <= ?'; params.push(to_date); }
        if (location_id) { where += ' AND dt.zoho_location_id = ?'; params.push(location_id); }

        const offset = (Math.max(1, parseInt(page)) - 1) * safeLimit;

        const [[{ total }]] = await pool.query(`
            SELECT COUNT(*) as total FROM zoho_daily_transactions dt
            LEFT JOIN zoho_locations_map lm ON dt.zoho_location_id = lm.zoho_location_id
            ${where} AND (lm.is_active = 1 OR lm.is_active IS NULL)`, params);

        const [transactions] = await pool.query(`
            SELECT dt.*
            FROM zoho_daily_transactions dt
            LEFT JOIN zoho_locations_map lm ON dt.zoho_location_id = lm.zoho_location_id
            ${where} AND (lm.is_active = 1 OR lm.is_active IS NULL)
            ORDER BY dt.transaction_date DESC, dt.location_name ASC
            LIMIT ? OFFSET ?
        `, [...params, safeLimit, offset]);

        res.json({
            success: true,
            data: transactions,
            pagination: { total, page: parseInt(page), limit: safeLimit, pages: Math.ceil(total / safeLimit), totalPages: Math.ceil(total / safeLimit) }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/transactions/daily/:date - Single day across all locations
 */
router.get('/transactions/daily/:date', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const [transactions] = await pool.query(`
            SELECT dt.* FROM zoho_daily_transactions dt
            LEFT JOIN zoho_locations_map lm ON dt.zoho_location_id = lm.zoho_location_id
            WHERE dt.transaction_date = ? AND (lm.is_active = 1 OR lm.is_active IS NULL)
            ORDER BY dt.location_name
        `, [req.params.date]);

        res.json({ success: true, data: transactions });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/transactions/daily/:date/:locationId - Single day + location with line items
 */
router.get('/transactions/daily/:date/:locationId', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const [summary] = await pool.query(`
            SELECT dt.* FROM zoho_daily_transactions dt
            WHERE dt.transaction_date = ? AND dt.zoho_location_id = ?
            LIMIT 1
        `, [req.params.date, req.params.locationId]);

        if (summary.length === 0) {
            return res.status(404).json({ success: false, message: 'No data for this date/location' });
        }

        const [details] = await pool.query(`
            SELECT dtd.* FROM zoho_daily_transaction_details dtd
            WHERE dtd.daily_transaction_id = ?
            ORDER BY dtd.transaction_type, dtd.amount DESC
        `, [summary[0].id]);

        res.json({ success: true, data: { summary: summary[0], details } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/transactions/generate - Generate/refresh report for date range
 */
router.post('/transactions/generate', requirePermission('zoho', 'sync'), async (req, res) => {
    try {
        const { from_date, to_date } = req.body;
        if (!from_date || !to_date) {
            return res.status(400).json({ success: false, message: 'from_date and to_date required' });
        }

        zohoAPI.generateDailyTransactionReport(from_date, to_date, req.user.id).catch(err => {
            console.error('[Zoho] Transaction report generation failed:', err.message);
        });

        res.json({ success: true, message: 'Report generation started. Check sync log for progress.' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/transactions/comparison - Compare locations side-by-side
 */
router.get('/transactions/comparison', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const { from_date, to_date } = req.query;

        let where = 'WHERE dt.zoho_location_id IS NOT NULL';
        const params = [];

        if (from_date) { where += ' AND dt.transaction_date >= ?'; params.push(from_date); }
        if (to_date) { where += ' AND dt.transaction_date <= ?'; params.push(to_date); }

        const [comparison] = await pool.query(`
            SELECT
                dt.zoho_location_id,
                dt.location_name,
                SUM(dt.invoice_count) as total_invoices,
                SUM(dt.invoice_amount) as total_invoice_amount,
                SUM(dt.bill_count) as total_bills,
                SUM(dt.bill_amount) as total_bill_amount,
                SUM(dt.sales_order_count) as total_sales_orders,
                SUM(dt.sales_order_amount) as total_so_amount,
                SUM(dt.purchase_order_count) as total_purchase_orders,
                SUM(dt.purchase_order_amount) as total_po_amount
            FROM zoho_daily_transactions dt
            ${where}
            GROUP BY dt.zoho_location_id, dt.location_name
            ORDER BY total_invoice_amount DESC
        `, params);

        res.json({ success: true, data: comparison });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// REORDER ALERTS
// ========================================

/**
 * GET /api/zoho/reorder/config - List reorder configurations
 */
router.get('/reorder/config', requirePermission('zoho', 'view'), branchScope, async (req, res) => {
    try {
        const { item_id, source, page = 1, limit = 50 } = req.query;
        const safeLimit = Math.min(parseInt(limit) || 50, 500);

        let where = 'WHERE 1=1';
        const params = [];

        if (item_id) { where += ' AND rc.zoho_item_id = ?'; params.push(item_id); }
        // Branch-scope: manager's branch overrides user-supplied location_id
        if (req.branchScope.branchId != null) {
            where += ' AND lm.local_branch_id = ?';
            params.push(req.branchScope.branchId);
        } else if (req.query.location_id) {
            where += ' AND rc.zoho_location_id = ?';
            params.push(req.query.location_id);
        }
        if (source) { where += ' AND rc.source = ?'; params.push(source); }

        const offset = (Math.max(1, parseInt(page)) - 1) * safeLimit;

        const [[{ total }]] = await pool.query(`
            SELECT COUNT(*) as total FROM zoho_reorder_config rc
            LEFT JOIN zoho_locations_map lm ON rc.zoho_location_id = lm.zoho_location_id
            ${where} AND (lm.is_active = 1 OR lm.is_active IS NULL)`, params);

        const [configs] = await pool.query(`
            SELECT rc.*, ls.stock_on_hand, ls.available_stock
            FROM zoho_reorder_config rc
            LEFT JOIN zoho_location_stock ls ON rc.zoho_item_id = ls.zoho_item_id AND rc.zoho_location_id = ls.zoho_location_id
            LEFT JOIN zoho_locations_map lm ON rc.zoho_location_id = lm.zoho_location_id
            ${where} AND (lm.is_active = 1 OR lm.is_active IS NULL)
            ORDER BY rc.item_name ASC
            LIMIT ? OFFSET ?
        `, [...params, safeLimit, offset]);

        res.json({
            success: true,
            data: configs,
            pagination: { total, page: parseInt(page), limit: safeLimit, pages: Math.ceil(total / safeLimit), totalPages: Math.ceil(total / safeLimit) }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/reorder/config - Set reorder level for item+location
 */
router.post('/reorder/config', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const { zoho_item_id, zoho_location_id, reorder_level, reorder_quantity, max_stock, item_name, location_name } = req.body;
        if (!zoho_item_id || !zoho_location_id || reorder_level === undefined) {
            return res.status(400).json({ success: false, message: 'zoho_item_id, zoho_location_id, and reorder_level required' });
        }

        await pool.query(`
            INSERT INTO zoho_reorder_config (zoho_item_id, zoho_location_id, item_name, location_name, reorder_level, reorder_quantity, max_stock, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                reorder_level = VALUES(reorder_level),
                reorder_quantity = VALUES(reorder_quantity),
                max_stock = VALUES(max_stock),
                item_name = COALESCE(VALUES(item_name), item_name),
                location_name = COALESCE(VALUES(location_name), location_name)
        `, [zoho_item_id, zoho_location_id, item_name || null, location_name || null,
            reorder_level, reorder_quantity || 0, max_stock || 0, req.user.id]);

        res.json({ success: true, message: 'Reorder config saved' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * PUT /api/zoho/reorder/config/:id - Update reorder config
 */
router.put('/reorder/config/:id', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const { reorder_level, reorder_quantity, max_stock, is_active, alert_frequency } = req.body;

        const updates = [];
        const params = [];

        if (reorder_level !== undefined) { updates.push('reorder_level = ?'); params.push(reorder_level); }
        if (reorder_quantity !== undefined) { updates.push('reorder_quantity = ?'); params.push(reorder_quantity); }
        if (max_stock !== undefined) { updates.push('max_stock = ?'); params.push(max_stock); }
        if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }
        if (alert_frequency) { updates.push('alert_frequency = ?'); params.push(alert_frequency); }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, message: 'No fields to update' });
        }

        params.push(req.params.id);
        await pool.query(`UPDATE zoho_reorder_config SET ${updates.join(', ')} WHERE id = ?`, params);

        res.json({ success: true, message: 'Reorder config updated' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * DELETE /api/zoho/reorder/config/:id - Delete reorder config
 */
router.delete('/reorder/config/:id', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        await pool.query(`DELETE FROM zoho_reorder_config WHERE id = ?`, [req.params.id]);
        res.json({ success: true, message: 'Reorder config deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/reorder/config/bulk - Bulk set reorder levels
 */
router.post('/reorder/config/bulk', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const { items } = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'items array required' });
        }

        const result = await zohoAPI.bulkSetReorderLevels(items);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/reorder/config/reset-to-auto - Bulk reset selected configs to source='auto'
 */
router.post('/reorder/config/reset-to-auto', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, message: 'ids array required' });
        }
        const cleanIds = ids.map(n => parseInt(n, 10)).filter(Number.isFinite);
        if (cleanIds.length === 0) {
            return res.status(400).json({ success: false, message: 'no valid ids' });
        }
        const [result] = await pool.query(
            `UPDATE zoho_reorder_config SET source = 'auto' WHERE id IN (?)`,
            [cleanIds]
        );
        res.json({ success: true, data: { updated: result.affectedRows } });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * GET /api/zoho/reorder/alerts - List alerts
 */
router.get('/reorder/alerts', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const result = await zohoAPI.getReorderDashboard(req.query);
        res.json({ success: true, ...result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/reorder/alerts/summary - Dashboard counts
 */
router.get('/reorder/alerts/summary', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const [summary] = await pool.query(`
            SELECT
                COUNT(CASE WHEN ra.status = 'active' THEN 1 END) as active_count,
                COUNT(CASE WHEN ra.status = 'acknowledged' THEN 1 END) as acknowledged_count,
                COUNT(CASE WHEN ra.severity = 'critical' AND ra.status IN ('active','acknowledged') THEN 1 END) as critical_count,
                COUNT(CASE WHEN ra.severity = 'high' AND ra.status IN ('active','acknowledged') THEN 1 END) as high_count,
                COUNT(CASE WHEN ra.severity = 'medium' AND ra.status IN ('active','acknowledged') THEN 1 END) as medium_count,
                COUNT(CASE WHEN ra.severity = 'low' AND ra.status IN ('active','acknowledged') THEN 1 END) as low_count
            FROM zoho_reorder_alerts ra
            LEFT JOIN zoho_locations_map lm ON ra.zoho_location_id = lm.zoho_location_id
            LEFT JOIN reorder_snoozes snz ON snz.zoho_item_id = ra.zoho_item_id AND snz.zoho_location_id = ra.zoho_location_id
            WHERE (lm.is_active = 1 OR lm.is_active IS NULL)
              AND (snz.zoho_item_id IS NULL OR (snz.snoozed_until IS NOT NULL AND snz.snoozed_until < NOW()))
        `);

        res.json({ success: true, data: summary[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * PUT /api/zoho/reorder/alerts/:id/acknowledge - Acknowledge alert
 */
router.put('/reorder/alerts/:id/acknowledge', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const result = await zohoAPI.acknowledgeAlert(parseInt(req.params.id), req.user.id);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * PUT /api/zoho/reorder/alerts/:id/resolve - Resolve alert
 */
router.put('/reorder/alerts/:id/resolve', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const { notes } = req.body;
        const result = await zohoAPI.resolveAlert(parseInt(req.params.id), req.user.id, notes);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/reorder/check - Manual trigger reorder check
 */
router.post('/reorder/check', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const result = await zohoAPI.checkReorderAlerts();
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// BRAND REORDER CONFIG
// ========================================

/**
 * GET /api/zoho/reorder/brands/available - List distinct brand names from zoho_items_map
 * (used by the Brand Config Add modal to populate a dropdown)
 */
router.get('/reorder/brands/available', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT DISTINCT zoho_brand AS brand_name,
                   COUNT(*) AS item_count
            FROM zoho_items_map
            WHERE zoho_brand IS NOT NULL AND zoho_brand != ''
            GROUP BY zoho_brand
            ORDER BY zoho_brand ASC
        `);
        res.json({ success: true, data: rows });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * GET /api/zoho/reorder/brands - List all brand configs with item counts and updated-by name
 */
router.get('/reorder/brands', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT bc.*, u.full_name AS updated_by_name,
                   (SELECT COUNT(DISTINCT zoho_item_id) FROM zoho_items_map
                    WHERE zoho_brand = bc.brand_name) AS item_count
            FROM brand_reorder_config bc
            LEFT JOIN users u ON u.id = bc.updated_by
            ORDER BY (bc.brand_name = '__default__') DESC, bc.brand_name ASC
        `);
        res.json({ success: true, data: rows });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * POST /api/zoho/reorder/brands - Create a brand config
 */
router.post('/reorder/brands', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const { brand_name, lead_time_days, safety_days, is_active } = req.body;
        if (!brand_name || !brand_name.trim()) {
            return res.status(400).json({ success: false, message: 'brand_name required' });
        }
        if (brand_name === '__default__') {
            return res.status(400).json({ success: false, message: 'Use PUT to edit __default__' });
        }
        const lead = Number(lead_time_days);
        const safety = Number(safety_days);
        if (!Number.isFinite(lead) || lead < 0 || !Number.isFinite(safety) || safety < 0) {
            return res.status(400).json({ success: false, message: 'lead_time_days and safety_days must be non-negative numbers' });
        }
        await pool.query(
            `INSERT INTO brand_reorder_config (brand_name, lead_time_days, safety_days, is_active, updated_by)
             VALUES (?, ?, ?, ?, ?)`,
            [brand_name.trim(), lead, safety, is_active === false ? 0 : 1, req.user.id]
        );
        res.json({ success: true });
    } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, message: 'Brand already exists' });
        }
        res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * PUT /api/zoho/reorder/brands/:id - Update lead/safety/is_active (brand_name is immutable)
 */
router.put('/reorder/brands/:id', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) {
            return res.status(400).json({ success: false, message: 'Invalid id' });
        }
        const { lead_time_days, safety_days, is_active } = req.body;
        const lead = Number(lead_time_days);
        const safety = Number(safety_days);
        if (!Number.isFinite(lead) || lead < 0 || !Number.isFinite(safety) || safety < 0) {
            return res.status(400).json({ success: false, message: 'lead_time_days and safety_days must be non-negative numbers' });
        }
        const [result] = await pool.query(
            `UPDATE brand_reorder_config
             SET lead_time_days = ?, safety_days = ?, is_active = ?, updated_by = ?
             WHERE id = ?`,
            [lead, safety, is_active === false ? 0 : 1, req.user.id, id]
        );
        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Brand config not found' });
        }
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * DELETE /api/zoho/reorder/brands/:id - Delete a brand config (__default__ is protected)
 */
router.delete('/reorder/brands/:id', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!Number.isFinite(id)) {
            return res.status(400).json({ success: false, message: 'Invalid id' });
        }
        const [rows] = await pool.query(`SELECT brand_name FROM brand_reorder_config WHERE id = ?`, [id]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Brand config not found' });
        }
        if (rows[0].brand_name === '__default__') {
            return res.status(400).json({ success: false, message: '__default__ cannot be deleted' });
        }
        await pool.query(`DELETE FROM brand_reorder_config WHERE id = ?`, [id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * POST /api/zoho/reorder/backfill-sales - Trigger invoice-line sync (background)
 * Returns immediately; progress emitted via Socket.io.
 */
router.post('/reorder/backfill-sales', requirePermission('zoho', 'reorder'), async (req, res) => {
    if (invoiceBackfillState.running) {
        return res.status(409).json({
            success: false,
            message: 'Back-fill already running since ' + invoiceBackfillState.startedAt.toISOString()
        });
    }
    const days = Math.max(1, Math.min(730, parseInt(req.body.days, 10) || 90));
    invoiceBackfillState = { running: true, startedAt: new Date(), days };
    res.json({ success: true, message: `Sync started for last ${days} days — watch sales-sync-status` });
    setImmediate(async () => {
        try {
            const io = req.app.get('io');
            const result = await invoiceLineSync.syncInvoiceLines({
                backfillDays: days,
                emitProgress: p => io?.emit('invoice-line-sync-progress', p)
            });
            io?.emit('invoice-line-sync-done', result);
            console.log('[BackfillSales] completed:', result);
        } catch (e) {
            console.error('[BackfillSales] failed:', e);
            const io = req.app.get('io');
            io?.emit('invoice-line-sync-done', { error: e.message });
        } finally {
            invoiceBackfillState = { running: false, startedAt: null, days: null };
        }
    });
});

/**
 * GET /api/zoho/reorder/sales-sync-status - Sync status/progress (cursor count, date range)
 */
router.get('/reorder/sales-sync-status', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const [[{ cursor_count }]] = await pool.query(
            `SELECT COUNT(*) AS cursor_count FROM invoice_line_sync_cursor`
        );
        const [[stats]] = await pool.query(
            `SELECT COUNT(*) AS sales_count, MIN(sale_date) AS min_date, MAX(sale_date) AS max_date
             FROM branch_item_sales`
        );
        res.json({
            success: true,
            data: {
                invoices_synced: cursor_count,
                sales_rows: stats.sales_count,
                earliest_date: stats.min_date,
                latest_date: stats.max_date,
                running: invoiceBackfillState.running,
                started_at: invoiceBackfillState.startedAt
            }
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * POST /api/zoho/reorder/compute-now - Run compute inline, return summary
 */
router.post('/reorder/compute-now', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const windowDays = parseInt(req.body.window_days, 10) || 60;
        const minSales = parseInt(req.body.min_sales, 10) || 1;
        const result = await reorderCompute.computeAll({ windowDays, minSales });
        res.json({ success: true, data: result });
    } catch (e) {
        console.error('[ComputeNow]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * POST /api/zoho/reorder/run-report - Manual report run (admin)
 */
router.post('/reorder/run-report', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const force = req.body.force === true || req.query.force === '1';
        const result = await reorderReport.runDailyReport({ force });
        res.json({ success: true, data: result });
    } catch (e) {
        console.error('[RunReport]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * GET /api/zoho/reorder/report - Fetch assembled report (dashboard view)
 */
router.get('/reorder/report', requirePermission('zoho', 'reorder'), branchScope, async (req, res) => {
    try {
        const branchId = req.branchScope.branchId != null
            ? req.branchScope.branchId
            : (req.query.branch_id ? parseInt(req.query.branch_id, 10) : null);
        const date = req.query.date || null;
        const windowDays = parseInt(req.query.window_days, 10) || 60;
        const report = await reorderReport.assembleReport({ branchId, date, windowDays });
        res.json({ success: true, data: report });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * GET /api/zoho/reorder/report/pdf - Download PDF
 */
// Shim: accept token via ?token= for direct-link downloads (WebView-friendly)
const pdfTokenShim = (req, res, next) => {
    if (!req.headers.authorization && req.query.token) {
        req.headers.authorization = 'Bearer ' + req.query.token;
    }
    next();
};

router.get('/reorder/report/pdf', pdfTokenShim, requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const branchId = req.query.branch_id ? parseInt(req.query.branch_id, 10) : null;
        const windowDays = parseInt(req.query.window_days, 10) || 60;
        const minAvgPerDay = parseFloat(req.query.min_avg_per_day) || 0;
        const search = req.query.search || '';
        const sortMode = req.query.sort || 'severity';

        const report = await reorderReport.assembleReport({ branchId, windowDays });
        report.rows = reorderReport.applyFilters(report.rows, { minAvgPerDay, search, sortMode });

        const uploadsDir = pathMod.join(__dirname, '..', 'uploads', 'reorder-reports');
        if (!fsMod.existsSync(uploadsDir)) fsMod.mkdirSync(uploadsDir, { recursive: true });
        const safeScope = report.scope.replace(':', '-');
        const pdfPath = pathMod.join(uploadsDir, `reorder-${report.report_date}-${safeScope}.pdf`);
        const { generateReorderPdf } = require('../services/reorder-report-pdf-generator');
        await generateReorderPdf(report, pdfPath);
        res.download(pdfPath);
    } catch (e) {
        console.error('[ReportPDF]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * POST /api/zoho/reorder/report/send-whatsapp - Send current filtered report via WhatsApp now
 * Body: { branch_id?, window_days?, min_avg_per_day?, search?, sort?, user_ids? }
 */
router.post('/reorder/report/send-whatsapp', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const branchId = req.body.branch_id != null && req.body.branch_id !== ''
            ? parseInt(req.body.branch_id, 10) : null;
        const windowDays = parseInt(req.body.window_days, 10) || 60;
        const minAvgPerDay = parseFloat(req.body.min_avg_per_day) || 0;
        const search = req.body.search || '';
        const sortMode = req.body.sort || 'severity';
        const userIds = Array.isArray(req.body.user_ids)
            ? req.body.user_ids.map(x => parseInt(x, 10)).filter(Number.isFinite)
            : null;

        const result = await reorderReport.sendReportNow({
            branchId, windowDays, minAvgPerDay, search, sortMode,
            userIds, triggeredBy: req.user.id
        });
        res.json({ success: true, data: result });
    } catch (e) {
        console.error('[SendReportNow]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ========================================
// PURCHASE SUGGESTIONS
// ========================================

/**
 * POST /api/zoho/purchase-suggestions/calculate - Run full calculation (debounced 60s)
 */
router.post('/purchase-suggestions/calculate', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const wait = isSyncDebounced('purchase_calc');
        if (wait > 0) {
            return res.status(429).json({ success: false, message: `Please wait ${wait}s before recalculating` });
        }
        const result = await purchaseSuggestion.runFullCalculation(req.user.id);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/purchase-suggestions/latest - Get latest batch results
 */
router.get('/purchase-suggestions/latest', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const batchId = await purchaseSuggestion.getLatestBatchId();
        if (!batchId) {
            return res.json({ success: true, data: { suggestions: [], total: 0, batchId: null } });
        }
        const result = await purchaseSuggestion.getSuggestionsByBatch(batchId, req.query);
        res.json({ success: true, data: { ...result, batchId } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/purchase-suggestions/history - Paginated batch history
 */
router.get('/purchase-suggestions/history', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const result = await purchaseSuggestion.getSuggestionHistory(req.query);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/purchase-suggestions/summary - Summary stats for batch
 */
router.get('/purchase-suggestions/summary', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        let batchId = req.query.batch_id;
        if (!batchId) {
            batchId = await purchaseSuggestion.getLatestBatchId();
        }
        if (!batchId) {
            return res.json({ success: true, data: null });
        }
        const result = await purchaseSuggestion.getSuggestionSummary(batchId);
        res.json({ success: true, data: { ...result, batch_id: batchId } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * PUT /api/zoho/purchase-suggestions/:id/dismiss - Dismiss a suggestion
 */
router.put('/purchase-suggestions/:id/dismiss', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const success = await purchaseSuggestion.dismissSuggestion(parseInt(req.params.id));
        res.json({ success, message: success ? 'Suggestion dismissed' : 'Not found or already actioned' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * PUT /api/zoho/purchase-suggestions/:id/ordered - Mark as ordered
 */
router.put('/purchase-suggestions/:id/ordered', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const success = await purchaseSuggestion.markOrdered(parseInt(req.params.id));
        res.json({ success, message: success ? 'Marked as ordered' : 'Not found or already actioned' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * PUT /api/zoho/purchase-suggestions/bulk-dismiss - Bulk dismiss
 */
router.put('/purchase-suggestions/bulk-dismiss', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const { ids } = req.body;
        const count = await purchaseSuggestion.bulkDismiss(ids);
        res.json({ success: true, data: { dismissed: count } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * PUT /api/zoho/purchase-suggestions/bulk-ordered - Bulk mark ordered
 */
router.put('/purchase-suggestions/bulk-ordered', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const { ids } = req.body;
        const count = await purchaseSuggestion.bulkMarkOrdered(ids);
        res.json({ success: true, data: { ordered: count } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/purchase-suggestions/branch-allocations - Get branch config
 */
router.get('/purchase-suggestions/branch-allocations', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const result = await purchaseSuggestion.getBranchAllocations();
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * PUT /api/zoho/purchase-suggestions/branch-allocations - Update branch percentages
 */
router.put('/purchase-suggestions/branch-allocations', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const { allocations } = req.body;
        if (!Array.isArray(allocations) || allocations.length === 0) {
            return res.status(400).json({ success: false, message: 'allocations array required' });
        }
        const sum = allocations.reduce((s, a) => s + parseFloat(a.percentage || 0), 0);
        if (Math.abs(sum - 100) > 0.1) {
            return res.status(400).json({ success: false, message: `Allocations must sum to 100% (currently ${sum.toFixed(1)}%)` });
        }
        const result = await purchaseSuggestion.updateBranchAllocations(allocations);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/purchase-suggestions/category-defaults - Get category defaults
 */
router.get('/purchase-suggestions/category-defaults', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const result = await purchaseSuggestion.getAllCategoryDefaults();
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * PUT /api/zoho/purchase-suggestions/category-defaults/:id - Update category default
 */
router.put('/purchase-suggestions/category-defaults/:id', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const success = await purchaseSuggestion.updateCategoryDefault(parseInt(req.params.id), req.body);
        res.json({ success, message: success ? 'Updated' : 'Not found' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/purchase-suggestions/category-defaults - Create category default
 */
router.post('/purchase-suggestions/category-defaults', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const result = await purchaseSuggestion.createCategoryDefault(req.body);
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * DELETE /api/zoho/purchase-suggestions/category-defaults/:id - Delete category default
 */
router.delete('/purchase-suggestions/category-defaults/:id', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const success = await purchaseSuggestion.deleteCategoryDefault(parseInt(req.params.id));
        res.json({ success, message: success ? 'Deleted' : 'Not found' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/purchase-suggestions/config - Get system config
 */
router.get('/purchase-suggestions/config', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const result = await purchaseSuggestion.getConfig();
        res.json({ success: true, data: result });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/purchase-suggestions/batch/:batchId - Get specific batch
 */
router.get('/purchase-suggestions/batch/:batchId', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const result = await purchaseSuggestion.getSuggestionsByBatch(req.params.batchId, req.query);
        res.json({ success: true, data: { ...result, batchId: req.params.batchId } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/reorder/sales-analysis - Per-branch per-item sales velocity (60-day rolling)
 */
router.get('/reorder/sales-analysis', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const { branch_id, brand, category, from, to } = req.query;
        const rawDays = parseInt(req.query.window_days, 10);
        const days = Number.isFinite(rawDays) ? Math.max(1, Math.min(365, rawDays)) : 60;
        let where = `WHERE bis.sale_date >= DATE_SUB(CURDATE(), INTERVAL ${days} DAY)`;
        const params = [];
        if (branch_id) { where += ` AND bis.local_branch_id = ?`; params.push(parseInt(branch_id, 10)); }
        if (brand) { where += ` AND zim.zoho_brand = ?`; params.push(brand); }
        if (category) { where += ` AND zim.zoho_category_name = ?`; params.push(category); }
        if (from) { where += ` AND bis.sale_date >= ?`; params.push(from); }
        if (to) { where += ` AND bis.sale_date <= ?`; params.push(to); }

        const [rows] = await pool.query(`
            SELECT bis.local_branch_id, b.name AS branch_name,
                   bis.zoho_item_id, zim.zoho_item_name AS item_name, zim.zoho_sku AS sku,
                   zim.zoho_brand AS brand, zim.zoho_category_name AS category,
                   SUM(bis.qty_sold) AS total_qty,
                   SUM(bis.revenue) AS total_revenue,
                   ROUND(SUM(bis.qty_sold) / ${days}, 3) AS avg_daily_sales,
                   COALESCE(ls.stock_on_hand, 0) AS current_stock,
                   rc.reorder_level
            FROM branch_item_sales bis
            JOIN zoho_items_map zim ON zim.zoho_item_id = bis.zoho_item_id
            LEFT JOIN branches b ON b.id = bis.local_branch_id
            LEFT JOIN zoho_locations_map zlm ON zlm.local_branch_id = bis.local_branch_id
            LEFT JOIN zoho_location_stock ls ON ls.zoho_item_id = bis.zoho_item_id AND ls.zoho_location_id = zlm.zoho_location_id
            LEFT JOIN zoho_reorder_config rc ON rc.zoho_item_id = bis.zoho_item_id AND rc.zoho_location_id = zlm.zoho_location_id
            ${where}
            GROUP BY bis.local_branch_id, bis.zoho_item_id, b.name, zim.zoho_item_name, zim.zoho_sku, zim.zoho_brand, zim.zoho_category_name, ls.stock_on_hand, rc.reorder_level
            ORDER BY total_qty DESC
            LIMIT 2000
        `, params);

        res.json({ success: true, data: rows, window_days: days });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ========================================
// SNOOZE / HIDE ITEMS (from alerts + daily report)
// ========================================

/**
 * GET /reorder/snoozes - List currently-snoozed items (not-yet-expired + forever).
 */
router.get('/reorder/snoozes', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT snz.zoho_item_id, snz.zoho_location_id, snz.snoozed_until, snz.notes,
                   snz.created_at, snz.snoozed_by,
                   zim.zoho_item_name AS item_name, zim.zoho_sku AS sku, zim.zoho_brand AS brand,
                   zlm.zoho_location_name AS location_name,
                   u.full_name AS snoozed_by_name
            FROM reorder_snoozes snz
            LEFT JOIN zoho_items_map zim ON zim.zoho_item_id = snz.zoho_item_id
            LEFT JOIN zoho_locations_map zlm ON zlm.zoho_location_id = snz.zoho_location_id
            LEFT JOIN users u ON u.id = snz.snoozed_by
            WHERE snz.snoozed_until IS NULL OR snz.snoozed_until > NOW()
            ORDER BY snz.created_at DESC
        `);
        res.json({ success: true, data: rows });
    } catch (e) {
        console.error('[snoozes-list]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * POST /reorder/snooze - Mark (item × location) as not-needed.
 * Body: { zoho_item_id, zoho_location_id, duration_days?, notes? }
 * duration_days null/0 → snooze forever.
 */
router.post('/reorder/snooze', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const { zoho_item_id, zoho_location_id, duration_days, notes } = req.body;
        if (!zoho_item_id || !zoho_location_id) {
            return res.status(400).json({ success: false, message: 'zoho_item_id and zoho_location_id required' });
        }
        const days = parseInt(duration_days, 10);
        const until = Number.isFinite(days) && days > 0
            ? new Date(Date.now() + days * 86400000)
            : null;

        await pool.query(`
            INSERT INTO reorder_snoozes (zoho_item_id, zoho_location_id, snoozed_until, notes, snoozed_by)
            VALUES (?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                snoozed_until = VALUES(snoozed_until),
                notes = VALUES(notes),
                snoozed_by = VALUES(snoozed_by)
        `, [String(zoho_item_id), String(zoho_location_id), until, notes || null, req.user.id]);

        res.json({
            success: true,
            data: {
                zoho_item_id, zoho_location_id,
                snoozed_until: until,
                forever: until === null
            }
        });
    } catch (e) {
        console.error('[snooze]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * POST /reorder/snooze-bulk - Snooze many (item × location) pairs at once.
 * Body: { items: [{zoho_item_id, zoho_location_id}], duration_days?, notes? }
 */
router.post('/reorder/snooze-bulk', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const { items, duration_days, notes } = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'items[] required' });
        }
        const days = parseInt(duration_days, 10);
        const until = Number.isFinite(days) && days > 0
            ? new Date(Date.now() + days * 86400000)
            : null;

        let snoozed = 0;
        for (const it of items) {
            if (!it?.zoho_item_id || !it?.zoho_location_id) continue;
            await pool.query(`
                INSERT INTO reorder_snoozes (zoho_item_id, zoho_location_id, snoozed_until, notes, snoozed_by)
                VALUES (?, ?, ?, ?, ?)
                ON DUPLICATE KEY UPDATE
                    snoozed_until = VALUES(snoozed_until),
                    notes = VALUES(notes),
                    snoozed_by = VALUES(snoozed_by)
            `, [String(it.zoho_item_id), String(it.zoho_location_id), until, notes || null, req.user.id]);
            snoozed++;
        }
        res.json({ success: true, data: { snoozed, total: items.length, snoozed_until: until, forever: until === null } });
    } catch (e) {
        console.error('[snooze-bulk]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * DELETE /reorder/snooze/:itemId/:locationId - Un-snooze an item (bring it back).
 */
router.delete('/reorder/snooze/:itemId/:locationId', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        await pool.query(
            `DELETE FROM reorder_snoozes WHERE zoho_item_id = ? AND zoho_location_id = ?`,
            [req.params.itemId, req.params.locationId]
        );
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ========================================
// VENDOR MAPPING (bills → preferred vendor per item)
// ========================================

/**
 * POST /reorder/vendor-mapping/scan - Scan Zoho Books bills to infer vendors per item
 * Body: { months_back?: 1-24 }
 */
router.post('/reorder/vendor-mapping/scan', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const monthsBack = parseInt(req.body.months_back, 10) || 6;
        const scanResult = await vendorItemMapper.scanFromZohoBills({ monthsBack, triggeredBy: req.user.id });
        const inferResult = await vendorItemMapper.inferPrimaries();
        res.json({ success: true, data: { ...scanResult, ...inferResult } });
    } catch (e) {
        console.error('[VendorMapping][scan]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * GET /reorder/vendor-mapping/scans - Recent scan runs
 */
router.get('/reorder/vendor-mapping/scans', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT s.*, u.full_name AS triggered_by_name
             FROM vendor_mapping_scans s
             LEFT JOIN users u ON u.id = s.triggered_by
             ORDER BY s.id DESC LIMIT 10`
        );
        res.json({ success: true, data: rows });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * GET /reorder/vendor-mapping - Review table of items + preferred vendor
 * Query: search, brand, only_unpushed, only_unmapped
 */
router.get('/reorder/vendor-mapping', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const { search, brand, mapping_status, push_status } = req.query;
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        // Cap raised to 5000 so the whole vendor-mapping table can be fetched
        // in one shot (≈1.9k items currently) — avoids cross-page sort headache.
        const limit = Math.min(5000, parseInt(req.query.limit, 10) || 5000);
        const offset = (page - 1) * limit;

        let where = `WHERE zim.zoho_status = 'active'`;
        const params = [];
        if (search) {
            where += ` AND (zim.zoho_item_name LIKE ? OR zim.zoho_sku LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`);
        }
        if (brand) { where += ` AND zim.zoho_brand = ?`; params.push(brand); }
        if (mapping_status === 'mapped') {
            where += ` AND zim.preferred_vendor_id IS NOT NULL`;
        } else if (mapping_status === 'unmapped') {
            where += ` AND zim.preferred_vendor_id IS NULL`;
        }
        if (push_status === 'pushed') {
            where += ` AND zim.vendor_pushed_at IS NOT NULL`;
        } else if (push_status === 'unpushed') {
            where += ` AND zim.preferred_vendor_id IS NOT NULL AND zim.vendor_pushed_at IS NULL`;
        }
        // Legacy query-param aliases for older clients
        if (req.query.only_unpushed === '1' && !push_status) {
            where += ` AND zim.preferred_vendor_id IS NOT NULL AND zim.vendor_pushed_at IS NULL`;
        }
        if (req.query.only_unmapped === '1' && !mapping_status) {
            where += ` AND zim.preferred_vendor_id IS NULL`;
        }

        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) AS total FROM zoho_items_map zim ${where}`, params
        );

        const [rows] = await pool.query(`
            SELECT zim.zoho_item_id, zim.zoho_item_name AS item_name, zim.zoho_sku AS sku,
                   zim.zoho_brand AS brand, zim.zoho_unit AS unit,
                   zim.preferred_vendor_id, zim.last_purchase_rate,
                   zim.vendor_pushed_at,
                   v.vendor_name AS preferred_vendor_name,
                   v.zoho_contact_id AS preferred_vendor_zoho_id,
                   (SELECT COUNT(*) FROM item_vendor_map ivm2 WHERE ivm2.zoho_item_id = zim.zoho_item_id) AS vendor_count,
                   (SELECT MAX(last_bill_date) FROM item_vendor_map ivm3 WHERE ivm3.zoho_item_id = zim.zoho_item_id) AS last_bill_date
            FROM zoho_items_map zim
            LEFT JOIN vendors v ON v.id = zim.preferred_vendor_id
            ${where}
            ORDER BY (zim.preferred_vendor_id IS NULL) DESC, zim.zoho_item_name ASC
            LIMIT ? OFFSET ?
        `, [...params, limit, offset]);

        res.json({
            success: true,
            data: rows,
            pagination: { total, page, limit, pages: Math.ceil(total / limit), totalPages: Math.ceil(total / limit) }
        });
    } catch (e) {
        console.error('[VendorMapping][list]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * GET /reorder/vendor-mapping/:zohoItemId/candidates - Per-item vendor history
 */
router.get('/reorder/vendor-mapping/:zohoItemId/candidates', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT ivm.*, v.vendor_name, v.zoho_contact_id
            FROM item_vendor_map ivm
            JOIN vendors v ON v.id = ivm.vendor_id
            WHERE ivm.zoho_item_id = ?
            ORDER BY ivm.is_primary DESC, ivm.bill_count DESC, ivm.last_bill_date DESC
        `, [req.params.zohoItemId]);
        res.json({ success: true, data: rows });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * PUT /reorder/vendor-mapping/:zohoItemId - Manual override: set primary vendor
 * Body: { vendor_id }
 */
router.put('/reorder/vendor-mapping/:zohoItemId', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const vendorId = parseInt(req.body.vendor_id, 10);
        if (!Number.isFinite(vendorId)) {
            return res.status(400).json({ success: false, message: 'vendor_id required' });
        }
        const result = await vendorItemMapper.setManualPrimary(req.params.zohoItemId, vendorId);
        res.json({ success: true, data: result });
    } catch (e) {
        console.error('[VendorMapping][override]', e);
        res.status(400).json({ success: false, message: e.message });
    }
});

/**
 * POST /reorder/vendor-mapping/push/:zohoItemId - Push preferred vendor to Zoho
 */
router.post('/reorder/vendor-mapping/push/:zohoItemId', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const result = await vendorItemMapper.pushPreferredVendorToZoho(req.params.zohoItemId);
        res.json({ success: true, data: result });
    } catch (e) {
        console.error('[VendorMapping][push]', e);
        res.status(400).json({ success: false, message: e.message });
    }
});

/**
 * GET /reorder/vendors-list - Flat list of active vendors for the mapping picker.
 * The generic /api/vendors endpoint caps limit at 100; this one is unpaginated
 * (≤2000 vendors) and returns only the fields the picker needs.
 */
router.get('/reorder/vendors-list', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT id, vendor_name, contact_person, phone, email, zoho_contact_id
            FROM vendors
            WHERE status = 'active'
            ORDER BY vendor_name ASC
            LIMIT 2000
        `);
        res.json({ success: true, data: rows });
    } catch (e) {
        console.error('[vendors-list]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * POST /reorder/vendor-mapping/apply-brand - Bulk map every item of a brand
 * to a single vendor. Body: { brand, vendor_id }
 */
router.post('/reorder/vendor-mapping/apply-brand', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const { brand, vendor_id } = req.body;
        const vendorId = parseInt(vendor_id, 10);
        if (!brand || !Number.isFinite(vendorId)) {
            return res.status(400).json({ success: false, message: 'brand and vendor_id required' });
        }
        const result = await vendorItemMapper.applyBrandVendor(brand, vendorId);
        res.json({ success: true, data: result });
    } catch (e) {
        console.error('[VendorMapping][apply-brand]', e);
        res.status(400).json({ success: false, message: e.message });
    }
});

/**
 * POST /reorder/vendor-mapping/push-bulk - Push all unpushed items to Zoho
 * Body: { only_unpushed?: bool (default true) }
 */
router.post('/reorder/vendor-mapping/push-bulk', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const onlyUnpushed = req.body.only_unpushed !== false;
        const result = await vendorItemMapper.pushAll({ onlyUnpushed });
        res.json({ success: true, data: result });
    } catch (e) {
        console.error('[VendorMapping][push-bulk]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ========================================
// CREATE PO FROM REORDER ALERT
// ========================================

/**
 * GET /reorder/po-preview - Preview data for "Create PO" modal
 * Query: zoho_item_id, branch_id?, quantity?
 * Returns: suggested vendor, last rate, and item details
 */
router.get('/reorder/po-preview', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const { zoho_item_id } = req.query;
        const quantity = parseFloat(req.query.quantity) || 0;
        if (!zoho_item_id) {
            return res.status(400).json({ success: false, message: 'zoho_item_id required' });
        }

        const [itemRows] = await pool.query(`
            SELECT zim.zoho_item_id, zim.zoho_item_name AS item_name, zim.zoho_sku AS sku,
                   zim.zoho_brand AS brand, zim.zoho_unit AS unit, zim.zoho_rate AS rate,
                   zim.preferred_vendor_id, zim.last_purchase_rate,
                   v.vendor_name AS preferred_vendor_name, v.zoho_contact_id
            FROM zoho_items_map zim
            LEFT JOIN vendors v ON v.id = zim.preferred_vendor_id
            WHERE zim.zoho_item_id = ?
            LIMIT 1
        `, [zoho_item_id]);

        if (!itemRows.length) return res.status(404).json({ success: false, message: 'Item not found' });
        const item = itemRows[0];

        const [candidateRows] = await pool.query(`
            SELECT ivm.vendor_id, v.vendor_name, ivm.bill_count, ivm.last_bill_rate, ivm.last_bill_date, ivm.is_primary
            FROM item_vendor_map ivm
            JOIN vendors v ON v.id = ivm.vendor_id
            WHERE ivm.zoho_item_id = ?
            ORDER BY ivm.is_primary DESC, ivm.bill_count DESC, ivm.last_bill_date DESC
            LIMIT 10
        `, [zoho_item_id]);

        const suggestedRate = Number(item.last_purchase_rate || item.rate || 0);
        const suggestedTotal = quantity * suggestedRate;

        res.json({
            success: true,
            data: {
                item,
                candidates: candidateRows,
                suggestion: {
                    vendor_id: item.preferred_vendor_id,
                    vendor_name: item.preferred_vendor_name,
                    quantity,
                    unit_price: suggestedRate,
                    line_total: suggestedTotal
                }
            }
        });
    } catch (e) {
        console.error('[POPreview]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * POST /reorder/create-po - Create a local draft PO from one or more alert rows
 * Body: { vendor_id, items: [{zoho_item_id, item_name, quantity, unit_price}], expected_date?, notes?, push_to_zoho? }
 */
router.post('/reorder/create-po', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const { vendor_id, items, expected_date, notes, tax_amount, push_to_zoho } = req.body;
        if (!vendor_id || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'vendor_id and items[] required' });
        }

        // Generate PO number locally (avoid cross-module coupling with routes/vendors.js)
        const [[{ nextNo }]] = await pool.query(
            `SELECT IFNULL(MAX(CAST(SUBSTRING_INDEX(po_number, '-', -1) AS UNSIGNED)), 0) + 1 AS nextNo
             FROM vendor_purchase_orders WHERE po_number LIKE 'PO-%'`
        );
        const po_number = `PO-${String(nextNo).padStart(5, '0')}`;

        const subtotal = items.reduce((sum, it) => sum + (Number(it.quantity) * Number(it.unit_price)), 0);
        const tax = Number(tax_amount) || 0;
        const grand_total = subtotal + tax;

        const [result] = await pool.query(
            `INSERT INTO vendor_purchase_orders
                (vendor_id, po_number, subtotal, tax_amount, grand_total, expected_date, notes,
                 source, source_reference, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, 'reorder_alert', ?, ?)`,
            [vendor_id, po_number, subtotal, tax, grand_total, expected_date || null,
             notes || null, `items=${items.length}`, req.user.id]
        );
        const poId = result.insertId;

        for (const it of items) {
            const amount = Number(it.quantity) * Number(it.unit_price);
            await pool.query(
                `INSERT INTO vendor_po_items (po_id, zoho_item_id, item_name, quantity, unit_price, amount)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [poId, it.zoho_item_id || null, it.item_name, it.quantity, it.unit_price, amount]
            );
        }

        // Optional immediate push
        let zohoResult = null;
        if (push_to_zoho) {
            try {
                const [vendorRows] = await pool.query(
                    `SELECT vendor_name, zoho_contact_id, gst_number FROM vendors WHERE id = ?`,
                    [vendor_id]
                );
                const vendor = vendorRows[0];
                let zohoContactId = vendor?.zoho_contact_id;
                if (!zohoContactId && vendor) {
                    const contactResp = await zohoAPI.createContact({
                        contact_name: vendor.vendor_name,
                        contact_type: 'vendor',
                        gst_no: vendor.gst_number || undefined
                    });
                    zohoContactId = contactResp.contact?.contact_id;
                    if (zohoContactId) {
                        await pool.query('UPDATE vendors SET zoho_contact_id = ? WHERE id = ?', [zohoContactId, vendor_id]);
                    }
                }
                if (zohoContactId) {
                    const zohoResp = await zohoAPI.createPurchaseOrder({
                        vendor_id: zohoContactId,
                        purchaseorder_number: po_number,
                        delivery_date: expected_date,
                        line_items: items.map(it => ({
                            item_id: it.zoho_item_id || undefined,
                            name: it.item_name,
                            quantity: Number(it.quantity),
                            rate: Number(it.unit_price)
                        }))
                    });
                    const zohoPOId = zohoResp.purchaseorder?.purchaseorder_id;
                    await pool.query(
                        `UPDATE vendor_purchase_orders SET zoho_status = 'pushed', zoho_po_id = ?, status = 'sent' WHERE id = ?`,
                        [zohoPOId || null, poId]
                    );
                    zohoResult = { zoho_po_id: zohoPOId };
                }
            } catch (e) {
                console.error('[create-po][push]', e);
                zohoResult = { error: e.message };
            }
        }

        res.json({
            success: true,
            data: { po_id: poId, po_number, subtotal, tax_amount: tax, grand_total, zoho: zohoResult }
        });
    } catch (e) {
        console.error('[create-po]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * POST /api/zoho/items/parse-price-list - Parse a brand dealer price list PDF
 * Returns extracted items with product name, pack size, and DPL
 * Optionally matches against existing Zoho items
 */
const { uploadPriceList, uploadPriceCsv } = require('../config/uploads');
const priceListParser = require('../services/price-list-parser');
const http = require('http');

router.post('/items/parse-price-list', requirePermission('zoho', 'manage'), uploadPriceList.single('pdf'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'PDF file is required' });
        }

        const result = await priceListParser.parsePriceList(req.file.buffer, req.file.originalname);

        // If requested, match against existing Zoho items
        if (req.body.match !== 'false') {
            const [zohoItems] = await pool.query(
                `SELECT zoho_item_id, zoho_item_name AS name, zoho_sku AS sku, zoho_rate AS rate,
                        zoho_cf_dpl AS cf_dpl, zoho_unit AS unit, zoho_brand AS brand,
                        zoho_category_name AS category, zoho_description AS description
                 FROM zoho_items_map WHERE zoho_status = 'active'`
            );
            const matchResult = priceListParser.matchWithZohoItems(result.items, zohoItems);
            result.matched = matchResult.matched;
            result.unmatched = matchResult.unmatched;
            result.matchedCount = matchResult.matched.length;
            result.unmatchedCount = matchResult.unmatched.length;
        }

        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Price list parse error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/items/apply-price-list - Apply parsed price list DPL values to items
 * Accepts array of { zoho_item_id, cf_dpl } to update in zoho_items_map
 */
/**
 * GET /api/zoho/items/normalize-scan?brand=X
 * Scan all items of a brand, infer canonical SKU prefix from name, return proposed renames.
 */
router.get('/items/normalize/scan', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const brand = req.query.brand;
        const category = (req.query.category || '').trim();          // optional filter
        const hasBases = req.query.hasBases === '1' || req.query.hasBases === 'true';
        if (!brand) return res.status(400).json({ success: false, message: 'brand query param is required' });

        const whereParts = [`zoho_status = 'active'`, `zoho_brand = ?`];
        const params = [brand];
        if (category) { whereParts.push('zoho_category_name = ?'); params.push(category); }

        const [rows] = await pool.query(
            `SELECT zoho_item_id, zoho_item_name AS name, zoho_sku AS sku, zoho_brand AS brand,
                    zoho_unit AS unit, zoho_category_name AS category, zoho_cf_product_name AS cf_product_name
             FROM zoho_items_map
             WHERE ${whereParts.join(' AND ')}
             ORDER BY zoho_item_name ASC`,
            params
        );

        const summary = { conformant: 0, needs_rename: 0, cannot_parse: 0 };
        const results = [];

        for (const row of rows) {
            const rawName = String(row.name || '').trim();
            const nameUp = rawName.toUpperCase();
            const skuUp = String(row.sku || '').toUpperCase().trim();
            const brandUp = String(row.brand || '').toUpperCase().trim();

            // 1. What the user sees as prefix: first token of the NAME
            const firstToken = nameUp.split(/\s+/)[0] || '';
            const currentNamePrefix = /^[A-Z0-9]{2,8}$/.test(firstToken) ? firstToken : null;

            // 2. Pack code from trailing pack-size in the name
            let inferPack = null;
            const packMatch = nameUp.match(/\b(\d{1,3}(?:\.\d+)?)\s*(ML|L|LT|LTR|LITRE|LITER|KG|GM?)\s*$/i);
            if (packMatch) {
                inferPack = priceListParser.packSizeToCode(packMatch[1] + packMatch[2]);
            }

            // 3. Base detection — only when hasBases=true (emulsion)
            let inferBase = null;
            if (hasBases) {
                const bMatch = nameUp.match(/\bBASE\s*([1-9])\b|\bB([1-9])\b/);
                if (bMatch) inferBase = bMatch[1] || bMatch[2];
                else if (/\bWHITE\b|\bSUPER\s*WHITE\b|\bDEEP\s*WHITE\b/.test(nameUp)) inferBase = 'W';
            }

            // 4. Derive PRODUCT PREFIX.
            //    The SKU is the source of truth when it matches pattern [A-Z]{2,5}\d{2,6}
            //    (e.g., "CF1301" = CF + base13 + pack01 → full prefix is just "CF1301").
            //    For items with partial SKU we fall back to building abbrev+base+pack.
            let productAbbrev = null;
            let skuDerivedPrefix = null;

            // Match full SKU pattern: letters + digits (digits = base + pack combined)
            const skuFullMatch = skuUp.match(/^([A-Z]{2,5})(\d{2,6})$/);
            if (skuFullMatch) {
                productAbbrev = skuFullMatch[1];
                skuDerivedPrefix = skuUp; // entire SKU becomes the prefix
            } else {
                // Fallback: just take leading letters
                const skuLetters = skuUp.match(/^([A-Z]{2,5})/);
                if (skuLetters) productAbbrev = skuLetters[1];
                if (!productAbbrev) {
                    const nameLetters = firstToken.match(/^([A-Z]{2,5})/);
                    if (nameLetters) productAbbrev = nameLetters[1];
                }
            }

            // Strip noise to isolate the product-name words in the middle
            const brandTokens = new Set(brandUp.split(/\s+/).filter(w => w && w.length >= 2));
            const unitWords = new Set(['L', 'LT', 'LTR', 'ML', 'KG', 'G', 'GM', 'LITRE', 'LITER']);
            let middle = rawName;

            // Strip ALL leading prefix-like tokens (anything with digits) so we strip
            // both "OP01" AND "CF13" from "OP01 CF13 STYLE COLOR FRESH OPUS 01 L"
            const midParts = middle.split(/\s+/);
            while (midParts.length > 0 && /\d/.test(midParts[0]) && midParts[0].length <= 8) {
                midParts.shift();
            }
            middle = midParts.join(' ');

            // Drop trailing pack size
            middle = middle.replace(/\s*\b\d{1,3}(?:\.\d+)?\s*(ML|L|LT|LTR|LITRE|LITER|KG|GM?)\s*$/i, '');
            // Drop base markers when applicable
            if (hasBases) {
                middle = middle.replace(/\bBASE\s*[1-9][0-9]?\b/gi, '');
                middle = middle.replace(/\bB[1-9][0-9]?\b/gi, '');
                middle = middle.replace(/\b(?:SUPER\s*|DEEP\s*)?WHITE\b/gi, '');
            }
            // Drop brand tokens from the middle (incl. partial/short forms like "OPUS" from "BIRLA OPUS")
            for (const bt of brandTokens) {
                middle = middle.replace(new RegExp('\\b' + bt + '\\b', 'gi'), '');
            }
            // Also strip common brand short-forms
            const shortBrands = ['OPUS', 'BIRLA'];
            for (const sb of shortBrands) {
                if (brandUp.includes(sb)) {
                    middle = middle.replace(new RegExp('\\b' + sb + '\\b', 'gi'), '');
                }
            }
            // Drop unit words
            for (const uw of unitWords) {
                middle = middle.replace(new RegExp('\\b' + uw + '\\b', 'gi'), '');
            }
            middle = middle.replace(/\s+/g, ' ').trim();

            // Fallback abbrev from middle words
            if (!productAbbrev && middle) {
                const words = middle.toUpperCase()
                    .replace(/[^A-Z ]/g, ' ')
                    .split(/\s+/)
                    .filter(w => w && w.length >= 2);
                if (words.length >= 1) {
                    productAbbrev = words.slice(0, Math.min(3, words.length))
                        .map(w => w[0]).join('');
                }
            }

            // 5. Build proposed prefix + full name + SKU
            //    Emulsion (has bases):  name = [SKU/product-prefix]    [product words] [BRAND] [PACK]
            //    Non-emulsion:          name = [category-code-prefix]  [product words] [BRAND] [PACK]
            //                           SKU  = product-based (keeps uniqueness per product)
            let status = 'cannot_parse';
            let proposedPrefix = null;
            let proposedName = null;
            let proposedSku = null;

            const displayPack = (packMatch ? packMatch[1] + ' ' + packMatch[2].toUpperCase() : '').trim();

            if (hasBases) {
                // Emulsion path: SKU-based prefix drives the NAME and the SKU.
                const emulsionPrefix = skuDerivedPrefix
                    || (productAbbrev && inferPack
                        ? productAbbrev + (inferBase === 'W' ? '0' : (inferBase || '')) + inferPack
                        : null);
                if (emulsionPrefix) {
                    proposedPrefix = emulsionPrefix;
                    proposedSku = emulsionPrefix;
                    const parts = [proposedPrefix, (middle || '').toUpperCase(), brandUp, displayPack]
                        .filter(Boolean).map(s => s.trim()).filter(Boolean);
                    proposedName = parts.join(' ').replace(/\s+/g, ' ').trim();
                    status = (nameUp === proposedName.toUpperCase() && skuUp === proposedSku)
                        ? 'conformant' : 'needs_rename';
                    if (status === 'conformant') { proposedName = null; proposedSku = null; }
                }
            } else {
                // Non-emulsion path: keep the CATEGORY CODE (currentNamePrefix) at the start of NAME.
                //                    SKU stays product-based (current SKU if well-formed, else abbrev+pack).
                if (currentNamePrefix) {
                    proposedPrefix = currentNamePrefix;

                    // Product-based SKU (unique per product, not per category)
                    proposedSku = skuDerivedPrefix
                        || (productAbbrev && inferPack ? productAbbrev + inferPack : null)
                        || skuUp
                        || null;

                    // Build middle by KEEPING category prefix and stripping only pack + brand + unit words
                    // (we do NOT strip further digit-prefixes because the middle may include a product code).
                    let middle2 = rawName.substring(currentNamePrefix.length).trim();
                    middle2 = middle2.replace(/\s*\b\d{1,3}(?:\.\d+)?\s*(ML|L|LT|LTR|LITRE|LITER|KG|GM?)\s*$/i, '');
                    for (const bt of brandTokens) {
                        middle2 = middle2.replace(new RegExp('\\b' + bt + '\\b', 'gi'), '');
                    }
                    for (const sb of shortBrands) {
                        if (brandUp.includes(sb)) middle2 = middle2.replace(new RegExp('\\b' + sb + '\\b', 'gi'), '');
                    }
                    for (const uw of unitWords) {
                        middle2 = middle2.replace(new RegExp('\\b' + uw + '\\b', 'gi'), '');
                    }
                    middle2 = middle2.replace(/\s+/g, ' ').trim();

                    const parts = [proposedPrefix, middle2.toUpperCase(), brandUp, displayPack]
                        .filter(Boolean).map(s => s.trim()).filter(Boolean);
                    proposedName = parts.join(' ').replace(/\s+/g, ' ').trim();

                    status = (nameUp === proposedName.toUpperCase() && (!proposedSku || skuUp === proposedSku))
                        ? 'conformant' : 'needs_rename';
                    if (status === 'conformant') { proposedName = null; proposedSku = null; }
                }
            }

            summary[status]++;
            results.push({
                zoho_item_id: row.zoho_item_id,
                current_name: row.name,
                current_sku: row.sku,
                current_category: row.category,
                current_name_prefix: currentNamePrefix,
                current_sku_value: row.sku || null,
                product_abbrev: productAbbrev,
                middle_name: middle || null,
                inferred_base: inferBase,
                inferred_pack: inferPack,
                proposed_prefix: proposedPrefix,
                proposed_name: proposedName,
                proposed_sku: proposedSku,
                status
            });
        }

        res.json({
            success: true,
            brand,
            category: category || null,
            has_bases: hasBases,
            total: rows.length,
            summary,
            items: results
        });
    } catch (error) {
        console.error('Normalize scan error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/items/filter-options
 * Returns all distinct brands + categories for dropdown filters on the items-edit page.
 */
router.get('/items/filters/list', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const [brands] = await pool.query(`
            SELECT DISTINCT zoho_brand AS name, COUNT(*) AS n FROM zoho_items_map
            WHERE zoho_status = 'active' AND zoho_brand IS NOT NULL AND zoho_brand <> ''
            GROUP BY zoho_brand ORDER BY zoho_brand
        `);
        const [categories] = await pool.query(`
            SELECT DISTINCT zoho_category_name AS name, COUNT(*) AS n FROM zoho_items_map
            WHERE zoho_status = 'active' AND zoho_category_name IS NOT NULL AND zoho_category_name <> ''
            GROUP BY zoho_category_name ORDER BY zoho_category_name
        `);
        const [brandCatRows] = await pool.query(`
            SELECT DISTINCT zoho_brand AS brand, zoho_category_name AS category FROM zoho_items_map
            WHERE zoho_status = 'active'
              AND zoho_brand IS NOT NULL AND zoho_brand <> ''
              AND zoho_category_name IS NOT NULL AND zoho_category_name <> ''
            ORDER BY zoho_brand, zoho_category_name
        `);
        const brandCategories = {};
        for (const row of brandCatRows) {
            if (!brandCategories[row.brand]) brandCategories[row.brand] = [];
            brandCategories[row.brand].push(row.category);
        }
        res.json({
            success: true,
            brands: brands.map(b => ({ name: b.name, count: b.n })),
            categories: categories.map(c => ({ name: c.name, count: c.n })),
            brandCategories
        });
    } catch (error) {
        console.error('Filter options error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/items/reassign/scan
 * Query params: nameContains, currentBrand, currentCategory (any combo; all optional)
 * Returns items matching the criteria so admin can bulk-fix their brand/category.
 */
router.get('/items/reassign/scan', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const nameContains = (req.query.nameContains || '').trim();
        const currentBrand = (req.query.currentBrand || '').trim();
        const currentCategory = (req.query.currentCategory || '').trim();

        if (!nameContains && !currentBrand && !currentCategory) {
            return res.status(400).json({ success: false, message: 'Provide at least one filter (nameContains / currentBrand / currentCategory)' });
        }

        const whereParts = [`zoho_status = 'active'`];
        const params = [];
        if (nameContains) {
            whereParts.push('(zoho_item_name LIKE ? OR zoho_sku LIKE ?)');
            params.push('%' + nameContains + '%', '%' + nameContains + '%');
        }
        if (currentBrand === '__no_brand__') {
            // Sentinel: match items whose brand is NULL, empty, or whitespace-only.
            // Used by the "(no brand assigned)" option in the Fix Brand modal.
            whereParts.push("(zoho_brand IS NULL OR TRIM(zoho_brand) = '')");
        } else if (currentBrand) {
            whereParts.push('zoho_brand = ?');
            params.push(currentBrand);
        }
        if (currentCategory === '__no_category__') {
            // Sentinel: match items whose category is NULL, empty, or whitespace-only.
            // Used by the "(no category assigned)" option in the Fix Brand modal.
            whereParts.push("(zoho_category_name IS NULL OR TRIM(zoho_category_name) = '')");
        } else if (currentCategory) {
            whereParts.push('zoho_category_name = ?');
            params.push(currentCategory);
        }

        const [rows] = await pool.query(
            `SELECT zoho_item_id, zoho_item_name AS name, zoho_sku AS sku,
                    zoho_brand AS brand, zoho_category_name AS category
             FROM zoho_items_map
             WHERE ${whereParts.join(' AND ')}
             ORDER BY zoho_item_name ASC
             LIMIT 2000`,
            params
        );

        // Also return distinct brands + categories for the dropdowns
        const [brands] = await pool.query(`
            SELECT DISTINCT zoho_brand AS name FROM zoho_items_map
            WHERE zoho_status = 'active' AND zoho_brand IS NOT NULL AND zoho_brand <> ''
            ORDER BY zoho_brand
        `);
        const [categories] = await pool.query(`
            SELECT DISTINCT zoho_category_name AS name FROM zoho_items_map
            WHERE zoho_status = 'active' AND zoho_category_name IS NOT NULL AND zoho_category_name <> ''
            ORDER BY zoho_category_name
        `);

        res.json({
            success: true,
            total: rows.length,
            items: rows,
            brands: brands.map(b => b.name),
            categories: categories.map(c => c.name)
        });
    } catch (error) {
        console.error('Reassign scan error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/items/reassign/apply
 * Body: { items: [{ zoho_item_id, new_brand?, new_category? }, ...] }
 * Creates a bulk job to push brand + category changes to Zoho, updates local DB immediately.
 */
router.post('/items/reassign/apply', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const { items } = req.body;
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'items array required' });
        }
        for (const it of items) {
            if (!it.zoho_item_id) return res.status(400).json({ success: false, message: 'Each item must have zoho_item_id' });
            if (!it.new_brand && !it.new_category) {
                return res.status(400).json({ success: false, message: 'Each item must set new_brand or new_category' });
            }
        }

        const [jobResult] = await pool.query(`
            INSERT INTO zoho_bulk_jobs (job_type, filter_criteria, update_fields, total_items, created_by)
            VALUES ('item_update', ?, ?, ?, ?)
        `, [
            JSON.stringify({ mode: 'brand_category_reassign', item_count: items.length }),
            JSON.stringify({ mode: 'per_item', source: 'reassign' }),
            items.length,
            req.user.id
        ]);
        const jobId = jobResult.insertId;

        // Look up current item names for the bulk_job_items display field
        const ids = items.map(i => i.zoho_item_id);
        const [nameRows] = await pool.query(
            `SELECT zoho_item_id, zoho_item_name FROM zoho_items_map WHERE zoho_item_id IN (${ids.map(() => '?').join(',')})`,
            ids
        );
        const nameLookup = {};
        nameRows.forEach(r => { nameLookup[r.zoho_item_id] = r.zoho_item_name; });

        for (const it of items) {
            const payload = {};
            if (it.new_brand) payload.brand = it.new_brand;
            if (it.new_category) payload.category_name = it.new_category;
            await pool.query(`
                INSERT INTO zoho_bulk_job_items (job_id, zoho_item_id, item_name, payload)
                VALUES (?, ?, ?, ?)
            `, [jobId, it.zoho_item_id, nameLookup[it.zoho_item_id] || '', JSON.stringify(payload)]);

            // Update local DB immediately
            const sets = [];
            const vals = [];
            if (it.new_brand) { sets.push('zoho_brand = ?'); vals.push(it.new_brand); }
            if (it.new_category) { sets.push('zoho_category_name = ?'); vals.push(it.new_category); }
            vals.push(it.zoho_item_id);
            await pool.query(`UPDATE zoho_items_map SET ${sets.join(', ')} WHERE zoho_item_id = ?`, vals);
        }

        res.json({
            success: true,
            data: { job_id: jobId, total_items: items.length },
            message: `Bulk reassign job #${jobId} created with ${items.length} items`
        });
    } catch (error) {
        console.error('Reassign apply error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/items/normalize/meta?brand=X
 * Returns distinct categories for the brand (for the category dropdown).
 */
router.get('/items/normalize/meta', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const brand = req.query.brand;
        if (!brand) return res.status(400).json({ success: false, message: 'brand param required' });
        const [rows] = await pool.query(
            `SELECT zoho_category_name AS category, COUNT(*) AS item_count
             FROM zoho_items_map
             WHERE zoho_status = 'active' AND zoho_brand = ? AND zoho_category_name IS NOT NULL AND zoho_category_name <> ''
             GROUP BY zoho_category_name
             ORDER BY zoho_category_name ASC`,
            [brand]
        );
        // Read saved category codes from ai_config if present
        let saved = {};
        try {
            const [[cfg]] = await pool.query(
                "SELECT config_value FROM ai_config WHERE config_key = 'item_normalize_category_codes'"
            );
            if (cfg?.config_value) saved = JSON.parse(cfg.config_value) || {};
        } catch (_) { /* ignore */ }
        res.json({
            success: true,
            brand,
            categories: rows.map(r => ({
                name: r.category,
                count: r.item_count,
                saved_code: (saved[r.category] && saved[r.category].code) || null,
                saved_has_bases: !!(saved[r.category] && saved[r.category].has_bases)
            }))
        });
    } catch (error) {
        console.error('Normalize meta error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/items/normalize/remember
 * Body: { category, code, has_bases }
 * Persists the chosen code so it's pre-filled next time.
 */
router.post('/items/normalize/remember', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const { category, code, has_bases } = req.body;
        if (!category || !code) return res.status(400).json({ success: false, message: 'category + code required' });
        let saved = {};
        const [[cfg]] = await pool.query(
            "SELECT config_value FROM ai_config WHERE config_key = 'item_normalize_category_codes'"
        );
        if (cfg?.config_value) { try { saved = JSON.parse(cfg.config_value) || {}; } catch (_) { saved = {}; } }
        saved[category] = { code: String(code).toUpperCase(), has_bases: !!has_bases };
        await pool.query(
            `INSERT INTO ai_config (config_key, config_value)
             VALUES ('item_normalize_category_codes', ?)
             ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
            [JSON.stringify(saved)]
        );
        res.json({ success: true, message: 'Saved' });
    } catch (error) {
        console.error('Normalize remember error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/items/normalize-apply
 * Body: { items: [{ zoho_item_id, new_name, new_sku? }, ...] }
 * Updates DB and pushes to Zoho.
 */
router.post('/items/normalize/apply', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const { items } = req.body;
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'items array required' });
        }
        // Validate shape
        for (const it of items) {
            if (!it.zoho_item_id || !it.new_name) {
                return res.status(400).json({ success: false, message: 'Each item must have zoho_item_id and new_name' });
            }
        }

        // Create bulk job so user can track at /admin-zoho-bulk-jobs.html
        const [jobResult] = await pool.query(`
            INSERT INTO zoho_bulk_jobs (job_type, filter_criteria, update_fields, total_items, created_by)
            VALUES ('item_update', ?, ?, ?, ?)
        `, [
            JSON.stringify({ mode: 'normalize_names', item_count: items.length }),
            JSON.stringify({ mode: 'per_item', source: 'normalize' }),
            items.length,
            req.user.id
        ]);
        const jobId = jobResult.insertId;

        // Queue per-item payloads
        for (const it of items) {
            const payload = { name: it.new_name };
            if (it.new_sku) payload.sku = it.new_sku;
            await pool.query(`
                INSERT INTO zoho_bulk_job_items (job_id, zoho_item_id, item_name, payload)
                VALUES (?, ?, ?, ?)
            `, [jobId, it.zoho_item_id, it.new_name, JSON.stringify(payload)]);
        }

        // Update local zoho_items_map immediately so the UI reflects changes
        // while the background worker pushes to Zoho.
        for (const it of items) {
            if (it.new_sku) {
                await pool.query(
                    `UPDATE zoho_items_map SET zoho_item_name = ?, zoho_sku = ? WHERE zoho_item_id = ?`,
                    [it.new_name, it.new_sku, it.zoho_item_id]
                );
            } else {
                await pool.query(
                    `UPDATE zoho_items_map SET zoho_item_name = ? WHERE zoho_item_id = ?`,
                    [it.new_name, it.zoho_item_id]
                );
            }
        }

        res.json({
            success: true,
            data: { job_id: jobId, total_items: items.length },
            message: `Bulk rename job #${jobId} created with ${items.length} items — track progress on the Bulk Jobs page`
        });
    } catch (error) {
        console.error('Normalize apply error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/items/apply-price-list', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const { items } = req.body;
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'items array required' });
        }

        let updated = 0;
        for (const item of items) {
            if (!item.zoho_item_id) continue;
            const sets = ['dpl_updated_at = NOW()'];
            const vals = [];
            if (item.cf_dpl != null)    { sets.push('zoho_cf_dpl = ?');      vals.push(item.cf_dpl); }
            if (item.name)              { sets.push('zoho_item_name = ?');    vals.push(item.name); }
            if (item.sku)               { sets.push('zoho_sku = ?');          vals.push(item.sku); }
            if (item.description != null){ sets.push('zoho_description = ?'); vals.push(item.description); }
            if (item.rate != null)      { sets.push('zoho_rate = ?');         vals.push(item.rate); }
            vals.push(item.zoho_item_id);
            const [result] = await pool.query(
                `UPDATE zoho_items_map SET ${sets.join(', ')} WHERE zoho_item_id = ?`, vals
            );
            if (result.affectedRows > 0) updated++;
        }

        res.json({
            success: true,
            data: { updated, total: items.length },
            message: `Updated ${updated} of ${items.length} items`
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

router.get('/dpl-match-report', requireAuth, async (req, res) => {
    try {
        const [zohoItems] = await pool.query(
            "SELECT zoho_item_id, zoho_item_name, zoho_sku, zoho_rate, zoho_cf_dpl, " +
            "zoho_purchase_rate, zoho_brand, zoho_category_name, zoho_cf_product_name " +
            "FROM zoho_items_map WHERE zoho_brand IN ('BIRLA OPUS', 'BERGER PAINTS') " +
            "AND zoho_status = 'active' ORDER BY zoho_brand, zoho_item_name"
        );
        const [mappedPacks] = await pool.query(
            "SELECT ps.zoho_item_id, ps.product_id, p.name as product_name " +
            "FROM pack_sizes ps JOIN products p ON p.id = ps.product_id " +
            "WHERE ps.zoho_item_id IS NOT NULL AND ps.zoho_item_id != '' AND ps.is_active = 1"
        );
        const lookup = {};
        for (const mp of mappedPacks) lookup[mp.zoho_item_id] = { product_id: mp.product_id, product_name: mp.product_name };
        const items = [];
        const summary = {};
        for (const zi of zohoItems) {
            const brand = zi.zoho_brand || 'UNKNOWN';
            if (!summary[brand]) summary[brand] = { total: 0, matched: 0, unmatched: 0 };
            summary[brand].total++;
            const m = lookup[zi.zoho_item_id];
            if (m) summary[brand].matched++; else summary[brand].unmatched++;
            items.push({
                zoho_item_id: zi.zoho_item_id, zoho_item_name: zi.zoho_item_name,
                zoho_sku: zi.zoho_sku, zoho_rate: zi.zoho_rate, zoho_cf_dpl: zi.zoho_cf_dpl,
                zoho_purchase_rate: zi.zoho_purchase_rate, zoho_brand: zi.zoho_brand,
                zoho_category: zi.zoho_category_name,
                status: m ? 'matched' : 'unmatched',
                product_name: m ? m.product_name : null,
                product_id: m ? m.product_id : null
            });
        }
        res.json({ success: true, summary, items, generated_at: new Date().toISOString() });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ── AI Parse Job Store ────────────────────────────────────────────────────────
// Background jobs for DPL PDF extraction (avoids 100s proxy timeouts).
// Jobs expire after 30 min to prevent memory leaks.
const _aiParseJobs = new Map(); // jobId → { status, data, error, progress, startedAt }
function _aiParseCleanup() {
    const cutoff = Date.now() - 30 * 60 * 1000;
    for (const [id, job] of _aiParseJobs) {
        if (job.startedAt < cutoff) _aiParseJobs.delete(id);
    }
}

// GET /api/zoho/items/ai-parse-job/:id — poll for job result
router.get('/items/ai-parse-job/:id', requirePermission('zoho', 'manage'), (req, res) => {
    const job = _aiParseJobs.get(req.params.id);
    if (!job) return res.status(404).json({ success: false, message: 'Job not found or expired (30 min limit)' });
    return res.json({ success: true, status: job.status, progress: job.progress, data: job.data || null, error: job.error || null });
});

/**
 * POST /api/zoho/items/ai-parse-price-list
 * Starts a background AI extraction job. Returns { job_id } immediately.
 * Poll GET /items/ai-parse-job/:id for status ("running" | "done" | "error").
 */
router.post('/items/ai-parse-price-list', requirePermission('zoho', 'manage'), uploadPriceList.single('pdf'), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ success: false, message: 'PDF file is required' });
    }

    // Return job_id immediately so the browser doesn't time out
    _aiParseCleanup();
    const crypto = require('crypto');
    const jobId  = crypto.randomBytes(8).toString('hex');
    _aiParseJobs.set(jobId, { status: 'running', progress: 'Reading PDF...', startedAt: Date.now() });
    res.json({ success: true, job_id: jobId });

    // ── Run extraction in background (after response sent) ──────────────────
    const _pdfBuffer   = req.file.buffer;
    const _pdfFilename = req.file.originalname || '';

    setImmediate(async () => {
    try {
        // ── 1. Extract PDF text ────────────────────────────────────────────
        const pdfParse = require('pdf-parse');
        const pdfData  = await pdfParse(_pdfBuffer);
        const fullText = pdfData.text || '';
        const pages    = pdfData.numpages || 0;
        _aiParseJobs.get(jobId).progress = `PDF read (${pages} pages, ${fullText.length} chars). Starting AI extraction...`;

        // ── 2. Detect brand ────────────────────────────────────────────────
        const detectedBrand = priceListParser.detectBrand(fullText, _pdfFilename);

        // ── 3. Helpers ───────────────────────────────────────────────────────
        function parseRawJson(raw) {
            try {
                let t = (raw || '').trim()
                    .replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
                const a = t.indexOf('['), b = t.lastIndexOf(']');
                if (a !== -1 && b > a) t = t.slice(a, b + 1);
                const arr = JSON.parse(t);
                return Array.isArray(arr) ? arr : [];
            } catch { return []; }
        }

        // Hermes call — single configurable request
        function callHermes(promptText, maxTok = 16000) {
            return new Promise((resolve, reject) => {
                const body = JSON.stringify({
                    model: 'claude-sonnet-4-6',
                    messages: [{ role: 'user', content: promptText }],
                    max_tokens: maxTok,
                    temperature: 0.1
                });
                const options = {
                    hostname: '127.0.0.1', port: 8317,
                    path: '/v1/chat/completions', method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer local',
                        'Content-Length': Buffer.byteLength(body)
                    }
                };
                const req2 = http.request(options, (res2) => {
                    let data = '';
                    res2.on('data', c => { data += c; });
                    res2.on('end', () => {
                        try {
                            const parsed = JSON.parse(data);
                            if (parsed.error) return reject(new Error(parsed.error.message || JSON.stringify(parsed.error)));
                            resolve(parsed.choices?.[0]?.message?.content || '[]');
                        } catch (e) { reject(new Error('Hermes parse error: ' + e.message)); }
                    });
                });
                req2.on('error', reject);
                req2.setTimeout(240000, () => { req2.destroy(); reject(new Error('hermes timeout')); });
                req2.write(body);
                req2.end();
            });
        }

        // Build the extraction prompt (used for both full-text and per-chunk calls)
        function buildPrompt(textSection, isFullDoc = true) {
            return `Extract EVERY product item from this paint brand Dealer Price List PDF${isFullDoc ? '' : ' section'}.

Return ONLY a JSON array — no markdown, no explanation, nothing else:
[{"p":"PRODUCT NAME","s":"1L","d":189,"c":"EXTERIOR EMULSION"},...]

KEY: p=product name (include variant e.g. "- White", "- Pink"), s=pack size, d=DPL dealer price (NUMBER), c=category

CATEGORY — use the SECTION HEADING from the PDF (the actual paint type, NOT tier like LUXURY/PREMIUM):
• Interior emulsion / distemper / acrylic  → "INTERIOR EMULSION"
• Exterior emulsion / weather coat / shield → "EXTERIOR EMULSION"
• Interior undercoat / primer              → "INTERIOR PRIMER"
• Exterior primer                          → "EXTERIOR PRIMER"
• Wood primer / wood sealer                → "WOOD PRIMER"
• Metal primer / rust guard                → "METAL PRIMER"
• Metal & wood primer                      → "METAL & WOOD PRIMER"
• Putty / wall putty                       → "WALL PUTTY"
• Waterproofing / damp proof               → "WATERPROOFING"
• Wood polish / PU / varnish / lacquer     → "WOOD FINISH"
• Enamel / synthetic enamel                → "ENAMEL"
• Distemper                                → "DISTEMPER"
• Construction chemicals / admixture       → "CONSTRUCTION CHEMICALS"
• Colorant / tint                          → "COLORANT"

PACK SIZES: "1L","4L","9L","10L","18L","20L","500ml","200ml","1Kg","4Kg","20Kg","1No","0.9L"

RULES:
1. Each product × each pack size = ONE separate row (e.g. 1L, 4L, 10L, 20L = 4 rows)
2. d = DPL/dealer/trade price (SMALLER number). NOT MRP/customer price (larger number)
3. Extract ALL product families: ONE, CALISTA, ALLWOOD, SPARKLE, PROTEK, STYLE, ALLGUARD, VEGA, CSWT, ALLOVER, OPUS, etc.
4. Skip: company name lines, column headers ("Base Code / Name..."), page numbers, footnotes
5. If a product has multiple base variants (White, Pastel, Base 1, Base 2) — include all variants as separate rows with their own prices
6. Section headings in the PDF tell you the category — track the current section carefully

PDF TEXT:
${textSection}`;
        }

        // ── 4. Strategy A: Traditional regex parser (Birla Opus format) ──────
        // Fast, deterministic — catches products AI might miss due to unusual formatting.
        // Returns items with _prices arrays; we convert to individual rows.
        const tradDebug = { items: 0, error: null };
        const tradRawItems = [];
        try {
            const parseFn = priceListParser.parseBirlaOpus || (() => []);
            const rawTrad = parseFn(fullText);
            // Map tier-based categories to real paint categories
            const TIER_TO_CAT = {
                LUXURY: 'INTERIOR EMULSION', PREMIUM: 'INTERIOR EMULSION',
                ECONOMY: 'INTERIOR EMULSION', STANDARD: 'INTERIOR EMULSION',
                'ULTRA PREMIUM': 'EXTERIOR EMULSION', SPECIALITY: 'INTERIOR EMULSION',
                DESIGNER: 'INTERIOR EMULSION', UNDERCOATS: 'INTERIOR PRIMER',
                OTHERS: ''
            };
            // Preserve _prices arrays so matchWithZohoItems can do rate-anchored
            // expansion against Zoho catalog rates (price-list-parser.js:1100-1254).
            // Flat items (single dpl + packSize) pass through unchanged.
            for (const item of rawTrad) {
                const cat = TIER_TO_CAT[item.category] || item.category || '';
                if (Array.isArray(item._prices) && item._prices.length > 0) {
                    tradRawItems.push({
                        product:  item.product,
                        _prices:  item._prices.slice(),
                        category: cat,
                        brand:    detectedBrand,
                        baseCode: item.baseCode,
                    });
                } else if (item.dpl) {
                    tradRawItems.push({
                        product:  item.product,
                        packSize: item.packSize || '?',
                        dpl:      item.dpl,
                        category: cat,
                        brand:    detectedBrand,
                    });
                }
            }
            tradDebug.items = tradRawItems.length;
        } catch (e) {
            tradDebug.error = e.message;
        }

        // ── 5. Strategy B: AI extraction — single call if text fits ──────────
        // Claude 200K context; even a 300-page DPL PDF is typically < 150K chars.
        const SINGLE_CALL_MAX = 140000; // chars — safe limit for one Claude call
        const LARGE_CHUNK_SIZE = 70000; // chars per chunk when PDF is too large
        const LARGE_CHUNK_OVERLAP = 3000;

        const aiRawItems = [];
        const extractionDebug = [];

        if (fullText.length <= SINGLE_CALL_MAX) {
            // ── SINGLE FULL-TEXT CALL (preferred) ────────────────────────────
            _aiParseJobs.get(jobId).progress = `Sending full PDF text to AI (${fullText.length} chars, single call)...`;
            try {
                const raw = await callHermes(buildPrompt(fullText, true), 32000);
                const parsed = parseRawJson(raw);
                extractionDebug.push({ method: 'single-full-text', chars: fullText.length, extracted: parsed.length });
                aiRawItems.push(...parsed);
                _aiParseJobs.get(jobId).progress = `AI extracted ${parsed.length} items. Matching with Zoho...`;
            } catch (e) {
                extractionDebug.push({ method: 'single-full-text', error: e.message });
                _aiParseJobs.get(jobId).progress = `AI error: ${e.message}. Using traditional parser...`;
            }
        } else {
            // ── LARGE-CHUNK FALLBACK: 70K chars with 3K overlap ──────────────
            const bigChunks = [];
            for (let i = 0; i < fullText.length; i += LARGE_CHUNK_SIZE - LARGE_CHUNK_OVERLAP) {
                bigChunks.push(fullText.slice(i, i + LARGE_CHUNK_SIZE));
                if (i + LARGE_CHUNK_SIZE >= fullText.length) break;
            }
            for (let i = 0; i < bigChunks.length; i++) {
                _aiParseJobs.get(jobId).progress = `Processing chunk ${i+1}/${bigChunks.length}...`;
                try {
                    const raw = await callHermes(buildPrompt(bigChunks[i], false), 16000);
                    const parsed = parseRawJson(raw);
                    extractionDebug.push({ method: 'large-chunk', chunk: i + 1, total: bigChunks.length, chars: bigChunks[i].length, extracted: parsed.length });
                    aiRawItems.push(...parsed);
                } catch (e) {
                    extractionDebug.push({ method: 'large-chunk', chunk: i + 1, error: e.message });
                }
            }
        }

        // ── 6. Merge: traditional (with _prices) wins for products it covered;
        //          AI flat rows fill gaps for products traditional missed.
        const productKey = (s) => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();
        const tradProductSet = new Set();
        for (const it of tradRawItems) {
            const k = productKey(it.product);
            if (k) tradProductSet.add(k);
        }

        // Pool A: every traditional item (both _prices and flat-dpl shapes).
        const mergedItems = tradRawItems.slice();

        // Pool B: AI flat rows for products NOT covered by traditional.
        for (const it of aiRawItems) {
            const k = productKey(it.p || it.product);
            if (!k) continue;
            if (tradProductSet.has(k)) continue;
            mergedItems.push(it);
        }

        // ── 7. Sanitise merged items ─────────────────────────────────────────
        // Fix doubled product names from AI extraction:
        // "One Pure Elegance One Pure Elegance - Mid Tone" → "One Pure Elegance - Mid Tone"
        function fixDoubledName(name) {
            // Pattern: "X X - Y" where X is repeated
            const m = name.match(/^(.+?)\s+\1(\s*-\s*.+)$/i);
            if (m) return (m[1] + m[2]).replace(/\s{2,}/g, ' ').trim();
            return name;
        }

        const cleanItems = [];
        for (const it of mergedItems) {
            if (!it || typeof it !== 'object') continue;
            const product  = fixDoubledName(String(it.p || it.product || '').trim());
            const category = String(it.c || it.category || '').toUpperCase().trim();
            if (!product) continue;

            // Shape 1: _prices array — pass through for rate-anchored expansion.
            if (Array.isArray(it._prices) && it._prices.length > 0) {
                const cleanedPrices = it._prices
                    .map(p => parseFloat(p))
                    .filter(p => isFinite(p) && p > 0);
                if (cleanedPrices.length === 0) continue;
                cleanItems.push({
                    product,
                    _prices:  cleanedPrices,
                    category,
                    brand:    detectedBrand,
                    baseCode: it.baseCode,
                });
                continue;
            }

            // Shape 2: flat row — require explicit packSize + valid dpl.
            const packSize = String(it.s || it.packSize || it.pack || '').trim();
            const dplNum   = parseFloat(it.d != null ? it.d : it.dpl);
            if (!packSize || !isFinite(dplNum) || dplNum <= 0) continue;
            cleanItems.push({ product, packSize, dpl: dplNum, category, brand: detectedBrand });
        }

        // ── 8. Fetch ALL active Zoho items ───────────────────────────────────
        const [zohoItems] = await pool.query(
            `SELECT zoho_item_id, zoho_item_name AS name, zoho_sku AS sku,
                    zoho_rate AS rate, zoho_cf_dpl AS cf_dpl,
                    zoho_brand AS brand, zoho_category_name AS category, zoho_description AS description,
                    dpl_updated_at
             FROM zoho_items_map
             WHERE zoho_status = 'active'
             ORDER BY zoho_item_name ASC`
        );

        // ── 9. Auto-match ────────────────────────────────────────────────────
        // Keep brand so matchWithZohoItems can scope to same-brand Zoho items only
        const cleanItemsForMatch = cleanItems;
        const matchResult = priceListParser.matchWithZohoItems(cleanItemsForMatch, zohoItems);

        // ── 10. Build output ─────────────────────────────────────────────────
        // Source rows from matchResult.matched + unmatched (one entry per resolved
        // PDF row, including expansions of _prices arrays). This replaces the
        // old cleanItems.map approach which assumed every input had an explicit
        // packSize — now invalid because Birla Opus emulsion items use _prices.
        const itemsOut = [];
        for (const m of matchResult.matched) {
            const out = {
                product:  m.product,
                packSize: m.packSize,
                dpl:      m.dpl,
                category: m.category,
            };
            if (m.zoho_item_id) {
                out.auto_match = {
                    zoho_item_id:         m.zoho_item_id,
                    zoho_item_name:       m.zoho_item_name,
                    proposed_name:        m.proposed_name        || null,
                    proposed_sku:         m.proposed_sku         || null,
                    proposed_description: m.proposed_description || null,
                    proposed_rate:        m.proposed_rate        || null,
                    current_sku:          m.current_sku          || null,
                    current_description:  m.current_description  || null,
                    current_rate:         m.currentRate          || null,
                    current_dpl:          m.currentDpl           || null,
                    warning:              m._warning             || null,
                };
            }
            itemsOut.push(out);
        }
        for (const u of matchResult.unmatched) {
            itemsOut.push({
                product:  u.product,
                packSize: u.packSize || '?',
                dpl:      u.dpl,
                category: u.category,
                unmatched_reason: u._reject_reason || null,
            });
        }

        // Filter Zoho items to same brand so client dropdown doesn't show other-brand items.
        // Fallback: check item name for brand keywords when the brand column is empty.
        const pdfBrandNorm = priceListParser.normalizeBrand(detectedBrand || '');
        const sameBrandZoho = pdfBrandNorm ? zohoItems.filter(z => {
            let zb = priceListParser.normalizeBrand(z.brand || '');
            if (!zb) {
                const nm = (z.name || '').toUpperCase();
                zb = (nm.includes('BIRLA') || nm.includes('OPUS')) ? 'BIRLAOPUS'
                   : nm.includes('ASIAN')  ? 'ASIANPAINTS'
                   : nm.includes('BERGER') ? 'BERGERPAINTS'
                   : nm.includes('NIPPON') ? 'NIPPON'
                   : nm.includes('JSW')    ? 'JSW'
                   : '';
            }
            if (!zb) return true; // still unknown brand — keep
            return zb === pdfBrandNorm || zb.includes(pdfBrandNorm) || pdfBrandNorm.includes(zb);
        }) : zohoItems;

        const zohoItemsOut = sameBrandZoho.map(z => ({
            zoho_item_id: z.zoho_item_id,
            name:    z.name,
            sku:     z.sku,
            rate:    parseFloat(z.rate    || 0),
            cf_dpl:  parseFloat(z.cf_dpl  || 0),
            category:    z.category    || '',
            description: z.description || '',
            brand:       z.brand       || '',
            dpl_updated_at: z.dpl_updated_at ? new Date(z.dpl_updated_at).toISOString() : null
        }));

        // ── Store completed result ─────────────────────────────────────────
        _aiParseJobs.set(jobId, {
            status: 'done',
            startedAt: _aiParseJobs.get(jobId)?.startedAt,
            data: {
                brand:          detectedBrand || 'unknown',
                pages,
                // Counts are post-expansion (each _prices array yields multiple itemsOut rows).
                // Reporting cleanItems.length here would under-count because rate-anchored
                // expansion in matchWithZohoItems turns one _prices entry into N matched rows.
                totalExtracted: itemsOut.length,
                autoMatched:    matchResult.matched.length,
                needsReview:    matchResult.unmatched.length,
                items:          itemsOut,
                zohoItems:      zohoItemsOut,
                ai: {
                    provider:      'claude/hermes',
                    model:         'claude-sonnet-4-6',
                    textLength:    fullText.length,
                    method:        fullText.length <= SINGLE_CALL_MAX ? 'single-full-text' : 'large-chunks',
                    aiExtracted:   aiRawItems.length,
                    tradExtracted: tradDebug.items,
                    tradError:     tradDebug.error,
                    extractionDebug
                }
            }
        });
    } catch (error) {
        console.error('AI price list parse error:', error);
        _aiParseJobs.set(jobId, { status: 'error', error: error.message, startedAt: _aiParseJobs.get(jobId)?.startedAt });
    }
    }); // end setImmediate
});

/**
 * GET /api/zoho/items/brand-dpl/:brand
 *
 * Return saved DPL summary for a brand. Drives the Saved Summary Card
 * in admin-dpl.html. ?include=raw also returns raw_text (used when admin
 * clicks "Update DPL" to pre-fill the textarea).
 */
router.get('/items/brand-dpl/:brand', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const brand = String(req.params.brand || '').toLowerCase().trim();
        if (!assertSupportedBrand(brand, res)) return;
        const includeRaw = req.query.include === 'raw';
        const row = await brandDplService.get(brand, { includeRaw });
        if (!row) {
            return res.status(404).json({ success: false, code: 'NO_SAVED_DPL', message: 'No DPL saved for this brand' });
        }
        return res.json({ success: true, data: row });
    } catch (err) {
        console.error('GET brand-dpl error:', err);
        return res.status(500).json({ success: false, message: err.message || 'Server error' });
    }
});

/**
 * POST /api/zoho/items/brand-dpl/:brand
 *
 * Save (or replace) a brand's DPL price list. Optionally runs match in
 * the same call (default true) so the frontend can plug the response
 * into the existing aiData / showAiResults() review UI.
 *
 * Body: { text, effective_date?, match? }
 */
router.post('/items/brand-dpl/:brand', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const brand = String(req.params.brand || '').toLowerCase().trim();
        if (!assertSupportedBrand(brand, res)) return;
        const body = req.body || {};
        const text = String(body.text || '');
        if (!text.trim()) {
            return res.status(400).json({ success: false, message: 'No text provided' });
        }
        if (text.length > 1_000_000) {
            return res.status(413).json({ success: false, message: 'Pasted text is too large. Maximum 1,000,000 characters.' });
        }

        let effectiveDate = new Date().toISOString().slice(0, 10);
        if (body.effective_date) {
            const ed = String(body.effective_date);
            // Shape check + roundtrip equality catches "2026-02-30" (which Date silently rolls to 2026-03-02).
            if (!/^\d{4}-\d{2}-\d{2}$/.test(ed)) {
                return res.status(400).json({ success: false, message: 'effective_date must be YYYY-MM-DD' });
            }
            const parsed = new Date(ed + 'T00:00:00Z');
            if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== ed) {
                return res.status(400).json({ success: false, message: `effective_date "${ed}" is not a real calendar date` });
            }
            effectiveDate = ed;
        }
        const runMatch = body.match !== false;

        const parsedRows = priceListParser.parseBirlaOpusTabular(text);
        if (parsedRows.length === 0) {
            return res.status(400).json({ success: false, message: 'No data rows found in pasted text' });
        }

        const before = await brandDplService.get(brand);

        const updatedBy = req.user && req.user.username ? req.user.username : null;
        const saved = await brandDplService.save({
            brand, rawText: text, parsedRows, effectiveDate, updatedBy,
        });

        try {
            const audit = require('../services/audit-log');
            await audit.record(req, {
                action: 'brand_dpl.save',
                entity_type: 'brand_dpl_lists',
                entity_id: brand,
                before: before ? { parsed_count: before.parsed_count, effective_date: before.effective_date, updated_at: before.updated_at } : null,
                after: { parsed_count: saved.parsed_count, effective_date: saved.effective_date, updated_at: saved.updated_at },
            });
        } catch (e) {
            console.warn('audit-log record failed:', e.message);
        }

        let match = null;
        if (runMatch) {
            match = await runBrandDplMatch(brand, parsedRows);
        }

        return res.json({ success: true, data: { saved, ...(match ? { match } : {}) } });
    } catch (err) {
        console.error('POST brand-dpl error:', err);
        return res.status(500).json({ success: false, message: err.message || 'Server error' });
    }
});

/**
 * POST /api/zoho/items/brand-dpl/:brand/match
 *
 * Re-match against already-saved DPL — no text in body. Powers the
 * "Match Now" button on the Saved Summary Card.
 */
router.post('/items/brand-dpl/:brand/match', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const brand = String(req.params.brand || '').toLowerCase().trim();
        if (!assertSupportedBrand(brand, res)) return;
        const parsedRows = await brandDplService.getForMatch(brand);
        if (!parsedRows) {
            return res.status(404).json({ success: false, code: 'NO_SAVED_DPL', message: 'No DPL saved for this brand' });
        }
        const match = await runBrandDplMatch(brand, parsedRows);
        return res.json({ success: true, data: match });
    } catch (err) {
        console.error('POST brand-dpl match error:', err);
        return res.status(500).json({ success: false, message: err.message || 'Server error' });
    }
});

/**
 * Internal helper: run matchWithZohoItems against parsed-rows + return the
 * payload shape consumed by admin-dpl.html's showAiResults().
 */
async function runBrandDplMatch(brand, parsedRows) {
    const unmappedCats = new Set();
    const cleanItems = parsedRows.map(r => {
        const rawCat = String(r.category || '').toUpperCase().trim();
        let canonCat = PASTE_CAT_TO_CANON[rawCat];
        if (canonCat === undefined && rawCat) {
            unmappedCats.add(rawCat);
            canonCat = r.category || '';
        }
        const item = {
            product: r.product, packSize: r.packSize, dpl: r.dpl,
            category: canonCat || '',
            brand: r.brand, baseCode: r.baseCode,
        };
        if (r._proposedName)        item._proposedName        = r._proposedName;
        if (r._proposedZohoSku)     item._proposedZohoSku     = r._proposedZohoSku;
        if (r._proposedDescription) item._proposedDescription = r._proposedDescription;
        return item;
    });
    if (unmappedCats.size > 0) {
        console.warn('[brand-dpl] Unmapped categories — pass-through (may mis-match): ' + Array.from(unmappedCats).join(', '));
    }

    const [zohoItems] = await pool.query(
        `SELECT zoho_item_id, zoho_item_name AS name, zoho_sku AS sku,
                zoho_rate AS rate, zoho_cf_dpl AS cf_dpl,
                zoho_brand AS brand, zoho_category_name AS category, zoho_description AS description,
                dpl_updated_at
         FROM zoho_items_map
         WHERE zoho_status = 'active'
         ORDER BY zoho_item_name ASC`
    );

    const matchResult = priceListParser.matchWithZohoItems(cleanItems, zohoItems);

    const itemsOut = [];
    for (const m of matchResult.matched) {
        const out = { product: m.product, packSize: m.packSize, dpl: m.dpl, category: m.category };
        if (m.zoho_item_id) {
            out.auto_match = {
                zoho_item_id:         m.zoho_item_id,
                zoho_item_name:       m.zoho_item_name,
                proposed_name:        m.proposed_name        || null,
                proposed_sku:         m.proposed_sku         || null,
                proposed_description: m.proposed_description || null,
                proposed_rate:        m.proposed_rate        || null,
                current_sku:          m.current_sku          || null,
                current_description:  m.current_description  || null,
                current_rate:         m.currentRate          || null,
                current_dpl:          m.currentDpl           || null,
                warning:              m._warning             || null,
            };
        }
        itemsOut.push(out);
    }
    for (const u of matchResult.unmatched) {
        itemsOut.push({
            product: u.product, packSize: u.packSize || '?', dpl: u.dpl, category: u.category,
            unmatched_reason: u._reject_reason || null,
        });
    }

    const brandNorm = priceListParser.normalizeBrand(BRAND_DISPLAY_NAMES[brand] || brand);
    const sameBrandZoho = zohoItems.filter(z => {
        let zb = priceListParser.normalizeBrand(z.brand || '');
        if (!zb) {
            const nm = (z.name || '').toUpperCase();
            zb = (nm.includes('BIRLA') || nm.includes('OPUS')) ? 'BIRLAOPUS' : '';
        }
        if (!zb) return true;
        return zb === brandNorm || zb.includes(brandNorm) || brandNorm.includes(zb);
    });

    const zohoItemsOut = sameBrandZoho.map(z => ({
        zoho_item_id: z.zoho_item_id,
        name: z.name, sku: z.sku,
        rate: parseFloat(z.rate || 0),
        cf_dpl: parseFloat(z.cf_dpl || 0),
        category: z.category || '', description: z.description || '', brand: z.brand || '',
        dpl_updated_at: z.dpl_updated_at ? new Date(z.dpl_updated_at).toISOString() : null,
    }));

    return {
        brand, pages: 0,
        totalExtracted: itemsOut.length,
        autoMatched: matchResult.matched.length,
        needsReview: matchResult.unmatched.length,
        items: itemsOut,
        zohoItems: zohoItemsOut,
        source: { type: 'stored-dpl', parsed: parsedRows.length },
    };
}

/**
 * POST /api/zoho/items/dpl-parse-csv
 *
 * Upload a Birla Opus SKU Report CSV → parse → save to brand_dpl_lists → match.
 * Returns the same aiData shape as POST /items/brand-dpl/:brand so the frontend
 * can reuse showAiResults() directly.
 *
 * Multipart field: csv (required)
 * Body params:
 *   effective_date  optional YYYY-MM-DD; extracted from filename if absent
 *   match           optional boolean string, default "true"
 */
router.post('/items/dpl-parse-csv', requirePermission('zoho', 'manage'), uploadPriceCsv.single('csv'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No CSV file uploaded' });

        // Derive effective date: filename regex → body param → today
        let effectiveDate = new Date().toISOString().slice(0, 10);
        const fnMatch = (req.file.originalname || '').match(/(\d{1,2})([A-Za-z]{3})(\d{4})/);
        if (fnMatch) {
            const monthMap = { Jan:'01',Feb:'02',Mar:'03',Apr:'04',May:'05',Jun:'06',
                               Jul:'07',Aug:'08',Sep:'09',Oct:'10',Nov:'11',Dec:'12' };
            const mm = monthMap[fnMatch[2]];
            if (mm) {
                const dd = String(fnMatch[1]).padStart(2, '0');
                effectiveDate = `${fnMatch[3]}-${mm}-${dd}`;
            }
        }
        if (req.body && req.body.effective_date) {
            const ed = String(req.body.effective_date);
            if (/^\d{4}-\d{2}-\d{2}$/.test(ed)) effectiveDate = ed;
        }

        const csvString = req.file.buffer.toString('utf8');
        const parsedRows = priceListParser.parseBirlaOpusCsv(req.file.buffer, effectiveDate);
        if (parsedRows.length === 0) {
            return res.status(400).json({ success: false, message: 'No data rows found in CSV — check file format' });
        }

        // Canonicalize CSV categories for match compatibility
        const rowsForMatch = parsedRows.map(r => {
            const rawCat = r.category.toUpperCase();
            const canon = CSV_CAT_TO_CANON[rawCat];
            return canon !== undefined ? { ...r, category: canon } : r;
        });

        const before = await brandDplService.get('birlaopus');
        const updatedBy = req.user && req.user.username ? req.user.username : null;
        const saved = await brandDplService.save({
            brand: 'birlaopus',
            rawText: csvString,
            parsedRows: rowsForMatch,
            effectiveDate,
            updatedBy,
        });

        try {
            const audit = require('../services/audit-log');
            await audit.record(req, {
                action: 'brand_dpl.save',
                entity_type: 'brand_dpl_lists',
                entity_id: 'birlaopus',
                before: before ? { parsed_count: before.parsed_count, effective_date: before.effective_date } : null,
                after: { parsed_count: saved.parsed_count, effective_date: saved.effective_date },
            });
        } catch (e) {
            console.warn('[dpl-parse-csv] audit-log failed:', e.message);
        }

        let match = null;
        const runMatch = !req.body || String(req.body.match) !== 'false';
        if (runMatch) {
            match = await runBrandDplMatch('birlaopus', rowsForMatch);
        }

        return res.json({
            success: true,
            data: {
                saved,
                parsed_count: parsedRows.length,
                ...(match ? { match } : {}),
            },
        });
    } catch (err) {
        console.error('[dpl-parse-csv] error:', err);
        return res.status(500).json({ success: false, message: err.message || 'Server error' });
    }
});

/**
 * GET /api/zoho/items/propose-naming
 *
 * Auto-Propose Naming — reads existing items from DB (no PDF needed) and
 * applies brand naming rules to generate proposed Name / SKU / Description /
 * Rate. Returns a review list the frontend uses for bulk approve + push.
 *
 * Query params:
 *   brand — currently only 'birlaopus' is fully supported (default)
 *
 * Response: { success, data: { brand, total, withChanges, items: [...] } }
 */
router.get('/items/propose-naming', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const brandKey = String(req.query.brand || 'birlaopus').toLowerCase();
        if (brandKey !== 'birlaopus') {
            return res.status(400).json({
                success: false,
                message: 'Only brand=birlaopus is supported at this time'
            });
        }

        const [rows] = await pool.query(`
            SELECT zoho_item_id,
                   zoho_item_name AS name,
                   zoho_sku       AS sku,
                   zoho_rate      AS rate,
                   zoho_cf_dpl    AS cf_dpl,
                   zoho_brand     AS brand,
                   zoho_category_name AS category,
                   zoho_description   AS description
            FROM zoho_items_map
            WHERE zoho_status = 'active'
              AND (zoho_brand IN ('BIRLA OPUS','Birla Opus','BIRLAOPUS')
                   OR UPPER(REPLACE(zoho_brand,' ',''))='BIRLAOPUS')
            ORDER BY zoho_item_name ASC
        `);

        // ─── Helpers (self-contained, mirror price-list-parser semantics) ───
        const BRAND_DISPLAY = 'BIRLA OPUS';

        // Decode pack code suffix (e.g. "04", "20", "50M", "01K") to canonical
        // pack size like "4L", "20L", "500ml", "1Kg". Returns null if unparseable.
        function decodePackCode(pc) {
            if (!pc) return null;
            const s = String(pc).toUpperCase().trim();
            const ml = s.match(/^(\d{1,2})M$/);          // "20M"→200ml, "50M"→500ml
            if (ml) return (parseInt(ml[1], 10) * 10) + 'ml';
            const kg = s.match(/^(\d{1,2})K$/);          // "01K"→1Kg, "20K"→20Kg
            if (kg) return parseInt(kg[1], 10) + 'Kg';
            const lt = s.match(/^(\d{1,3})$/);           // "01"→1L, "20"→20L
            if (lt) return parseInt(lt[1], 10) + 'L';
            return null;
        }

        // Format pack size for the display tail in item names.
        // "1L"→"01 L", "4L"→"04 L", "10L"→"10 L", "500ml"→"500 ML", "1Kg"→"01 KG"
        function formatPackDisplay(packSize) {
            if (!packSize) return null;
            const s = String(packSize).toUpperCase().replace(/\s+/g, '');
            const ml = s.match(/^(\d+(?:\.\d+)?)ML$/);
            if (ml) return ml[1] + ' ML';
            const lt = s.match(/^(\d+(?:\.\d+)?)(L|LT|LTR|LITRE|LITER|LITRES)?$/);
            if (lt) {
                const n = parseFloat(lt[1]);
                const i = Math.floor(n);
                return (i < 10 ? '0' + i : String(i)) + ' L';
            }
            const kg = s.match(/^(\d+(?:\.\d+)?)KG$/);
            if (kg) {
                const n = parseFloat(kg[1]);
                const i = Math.floor(n);
                return (i < 10 ? '0' + i : String(i)) + ' KG';
            }
            return null;
        }

        // Split SKU into letter prefix + numeric/letter suffix.
        // "PFP04"   → { abbrev: "PFP",   packCode: "04"  }
        // "CSTBLK01"→ { abbrev: "CSTBLK",packCode: "01"  }
        // "AWMLS50M"→ { abbrev: "AWMLS", packCode: "50M" }
        // "OPWF01K" → { abbrev: "OPWF",  packCode: "01K" }
        function splitSku(sku) {
            if (!sku) return { abbrev: null, packCode: null };
            const s = String(sku).toUpperCase().trim();
            const m = s.match(/^([A-Z]+)(\d{1,3}[A-Z]?)$/);
            if (!m) return { abbrev: null, packCode: null };
            return { abbrev: m[1], packCode: m[2] };
        }

        // Extract the human product-name portion from an existing item name.
        // Strips: 1) leading SKU token, 2) trailing brand+pack tail.
        // "PFP04 STYLE PRO FRESH PRIMER BIRLA OPUS 04 L" → "STYLE PRO FRESH PRIMER"
        // "OPWF01 ALLWOOD WOOD FILLER OPUS 01 KG"        → "ALLWOOD WOOD FILLER"
        function extractProductName(name, abbrev, packCode) {
            if (!name) return '';
            let n = String(name).toUpperCase().trim().replace(/\s+/g, ' ');

            // 1) Strip leading SKU token (e.g. "PFP04 ")
            if (abbrev && packCode) {
                const skuTok = abbrev + packCode;
                if (n.startsWith(skuTok + ' ')) {
                    n = n.slice(skuTok.length + 1).trim();
                } else if (n.startsWith(skuTok)) {
                    n = n.slice(skuTok.length).trim();
                }
            }

            // 2) Strip trailing brand + pack tail. Try most specific first.
            //    Patterns: " BIRLA OPUS 04 L", " OPUS 04 L", " 04 L", " BIRLA OPUS 500 ML", " 01 KG"
            const tailPatterns = [
                /\s+BIRLA\s+OPUS\s+\d{1,3}\s*(?:L|ML|KG)\s*$/i,
                /\s+OPUS\s+\d{1,3}\s*(?:L|ML|KG)\s*$/i,
                /\s+BIRLA\s+OPUS\s*$/i,
                /\s+OPUS\s*$/i,
                /\s+\d{1,3}\s*(?:L|ML|KG)\s*$/i
            ];
            for (const re of tailPatterns) {
                if (re.test(n)) { n = n.replace(re, '').trim(); break; }
            }

            return n.replace(/\s+/g, ' ').trim();
        }

        // Strip noisy tokens like brand or "BIRLA OPUS" out of a category for
        // the description tail. Birla Opus categories are mostly clean already
        // ("INTERIOR PRIMER", "EXTERIOR EMULSION") so just upper-case + collapse.
        function categoryShort(cat) {
            return String(cat || '').toUpperCase().replace(/\s+/g, ' ').trim();
        }

        let withChanges = 0;
        const items = rows.map(r => {
            const currentName        = r.name        || '';
            const currentSku         = r.sku         || '';
            const currentDescription = r.description || '';
            const currentRate        = r.rate != null ? parseFloat(r.rate) : null;
            const currentDpl         = r.cf_dpl != null ? parseFloat(r.cf_dpl) : null;

            const out = {
                zoho_item_id: r.zoho_item_id,
                current_name: currentName,
                current_sku: currentSku,
                current_description: currentDescription,
                current_rate: currentRate,
                current_dpl: currentDpl,
                proposed_name: null,
                proposed_sku: null,
                proposed_description: null,
                proposed_rate: null,
                has_changes: false,
                skip_reason: null
            };

            if (!currentSku || !currentSku.trim()) {
                out.skip_reason = 'blank SKU';
                return out;
            }

            const { abbrev, packCode } = splitSku(currentSku);
            if (!abbrev || !packCode) {
                out.skip_reason = 'unparseable SKU (no abbrev/packCode split)';
                return out;
            }

            const decodedSize = decodePackCode(packCode);
            if (!decodedSize) {
                out.skip_reason = `pack code "${packCode}" can't be decoded`;
                return out;
            }

            const packFmt = formatPackDisplay(decodedSize);
            if (!packFmt) {
                out.skip_reason = `pack format failed for "${decodedSize}"`;
                return out;
            }

            const productName = extractProductName(currentName, abbrev, packCode);
            if (!productName) {
                out.skip_reason = 'product name extraction yielded empty string';
                return out;
            }

            const proposedSku  = (abbrev + packCode).toUpperCase();
            const proposedName = `${proposedSku} ${productName} ${BRAND_DISPLAY} ${packFmt}`;
            const catShort     = categoryShort(r.category);
            const proposedDesc = `${abbrev} ${catShort} ${BRAND_DISPLAY} ${packFmt}`
                .replace(/\s+/g, ' ').trim();
            const proposedRate = (currentDpl && currentDpl > 0)
                ? Math.ceil(currentDpl * 1.18 * 1.10)
                : null;

            out.proposed_sku  = proposedSku;
            out.proposed_name = proposedName;
            out.proposed_description = proposedDesc;
            out.proposed_rate = proposedRate;

            const nameDiff = proposedName !== currentName.trim();
            const skuDiff  = proposedSku  !== currentSku.trim().toUpperCase();
            const descDiff = proposedDesc !== currentDescription.trim();
            const rateDiff = proposedRate != null && currentRate != null &&
                Math.abs(proposedRate - currentRate) >= 0.01;

            out.has_changes = nameDiff || skuDiff || descDiff || rateDiff;
            if (out.has_changes) withChanges++;

            return out;
        });

        res.json({
            success: true,
            data: {
                brand: brandKey,
                total: items.length,
                withChanges,
                items
            }
        });
    } catch (error) {
        console.error('Auto-propose naming error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ==========================================
// EXPENSES
// ==========================================

router.get('/expenses', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const { page=1, limit=50, from_date, to_date, status } = req.query;
        let sql = 'SELECT * FROM zoho_expenses WHERE 1=1';
        const params = [];
        if (from_date) { sql += ' AND date >= ?'; params.push(from_date); }
        if (to_date) { sql += ' AND date <= ?'; params.push(to_date); }
        if (status) { sql += ' AND status = ?'; params.push(status); }
        sql += ' ORDER BY date DESC LIMIT ? OFFSET ?';
        params.push(Number(limit), (Number(page)-1)*Number(limit));
        const [rows] = await pool.query(sql, params);
        const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM zoho_expenses');
        res.json({ success: true, expenses: rows, total });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/sync/expenses', requirePermission('zoho', 'sync'), async (req, res) => {
    try {
        const result = await zohoAPI.syncExpenses(req.body || {});
        res.json(result);
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ==========================================
// CREDIT NOTES
// ==========================================

router.get('/creditnotes', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const { page = 1, limit = 50, status, from_date, to_date } = req.query;
        const conditions = ['1=1'];
        const params = [];
        if (status && status !== 'all') { conditions.push('status = ?'); params.push(status); }
        if (from_date) { conditions.push('date >= ?'); params.push(from_date); }
        if (to_date) { conditions.push('date <= ?'); params.push(to_date); }
        const where = conditions.join(' AND ');

        const [[{ total }]] = await pool.query(`SELECT COUNT(*) as total FROM zoho_credit_notes WHERE ${where}`, params);
        const rows = await pool.query(
            `SELECT * FROM zoho_credit_notes WHERE ${where} ORDER BY date DESC LIMIT ? OFFSET ?`,
            [...params, Number(limit), (Number(page) - 1) * Number(limit)]
        ).then(([r]) => r);

        res.json({ success: true, creditnotes: rows, total, page: Number(page), limit: Number(limit) });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/sync/creditnotes', requirePermission('zoho', 'sync'), async (req, res) => {
    try {
        const result = await zohoAPI.syncCreditNotes();
        res.json(result);
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ==========================================
// SALES ORDERS
// ==========================================

router.get('/salesorders', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const { page=1, limit=50, from_date, to_date, status, search } = req.query;
        let sql = `SELECT transaction_id, reference_number as so_number, date,
                          customer_name, total, status, location_id, currency_code
                   FROM zoho_daily_transactions WHERE type = 'sales_order'`;
        const params = [];
        if (from_date) { sql += ' AND date >= ?'; params.push(from_date); }
        if (to_date) { sql += ' AND date <= ?'; params.push(to_date); }
        if (status) { sql += ' AND status = ?'; params.push(status); }
        if (search) { sql += ' AND customer_name LIKE ?'; params.push(`%${search}%`); }
        sql += ' ORDER BY date DESC LIMIT ? OFFSET ?';
        params.push(Number(limit), (Number(page)-1)*Number(limit));
        const [rows] = await pool.query(sql, params);
        res.json({ success: true, salesorders: rows });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/salesorders/:id', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const result = await zohoAPI.getRawSalesOrder(req.params.id);
        res.json({ success: true, salesorder: result.salesorder });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = {
    router,
    setPool
};
