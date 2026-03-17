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

// Services (initialized via setPool)
const zohoOAuth = require('../services/zoho-oauth');
const zohoAPI = require('../services/zoho-api');
const syncScheduler = require('../services/sync-scheduler');
const whatsappProcessor = require('../services/whatsapp-processor');
const purchaseSuggestion = require('../services/purchase-suggestion');
const aiEngine = require('../services/ai-engine');

let pool;

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

            const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

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
            `, [...params, parseInt(limit), offset]);

            res.json({
                success: true,
                type: 'invoices',
                data: rows,
                pagination: {
                    total: counts.total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    pages: Math.ceil(counts.total / parseInt(limit))
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

            const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

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
            `, [...params, parseInt(limit), offset]);

            res.json({
                success: true,
                type: 'payments',
                data: rows,
                pagination: {
                    total: counts.total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    pages: Math.ceil(counts.total / parseInt(limit))
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

        const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

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
        `, [...params, parseInt(limit), offset]);

        res.json({
            success: true,
            data: invoices,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / parseInt(limit))
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

        const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) as total FROM zoho_payments zp ${where}`, params
        );

        const [payments] = await pool.query(`
            SELECT zp.*
            FROM zoho_payments zp
            ${where}
            ORDER BY zp.payment_date DESC
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), offset]);

        res.json({
            success: true,
            data: payments,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / parseInt(limit))
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

        const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) as total FROM zoho_customers_map zcm ${where}`, params
        );

        const [customers] = await pool.query(`
            SELECT zcm.*, c.full_name as local_customer_name, c.phone as local_phone
            FROM zoho_customers_map zcm
            LEFT JOIN customers c ON zcm.local_customer_id = c.id
            ${where}
            ORDER BY zcm.zoho_contact_name ASC
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), offset]);

        res.json({
            success: true,
            data: customers,
            pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) }
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

        res.json({ success: true, data: config });
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
router.post('/oauth/exchange', requireAuth, async (req, res) => {
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

        let where = 'WHERE 1=1';
        const params = [];

        if (status) {
            where += ' AND wf.status = ?';
            params.push(status);
        }

        const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

        const [queue] = await pool.query(`
            SELECT wf.*, u.full_name as created_by_name
            FROM whatsapp_followups wf
            LEFT JOIN users u ON wf.created_by = u.id
            ${where}
            ORDER BY wf.created_at DESC
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), offset]);

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
        res.json({
            success: true,
            brands: brands.map(r => r.zoho_brand),
            categories: categories.map(r => r.zoho_category_name)
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

        const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
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
        `, [...params, parseInt(limit), offset]);

        res.json({
            success: true,
            data: rows,
            pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) }
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

        const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
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
        `, [...params, parseInt(limit), offset]);

        res.json({
            success: true,
            data: rows,
            pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) }
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

        const showInactive = req.query.show_inactive === '1';
        let where = showInactive ? "WHERE 1=1" : "WHERE (zim.zoho_status = 'active' OR zim.zoho_status IS NULL)";
        const params = [];

        if (search) {
            where += ' AND (zim.zoho_item_name LIKE ? OR zim.zoho_sku LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }
        if (brand) {
            where += ' AND zim.zoho_brand LIKE ?';
            params.push(`%${brand}%`);
        }
        if (category) {
            where += ' AND zim.zoho_category_name LIKE ?';
            params.push(`%${category}%`);
        }

        const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

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
                zim.zoho_stock_on_hand as stock_on_hand,
                zim.zoho_category_name as category_name,
                zim.zoho_upc as upc,
                zim.zoho_ean as ean,
                zim.zoho_isbn as isbn,
                zim.zoho_part_number as part_number,
                zim.zoho_cf_product_name as cf_product_name,
                zim.zoho_cf_dpl as cf_dpl,
                zim.zoho_status as status,
                zim.last_synced_at as last_synced
            FROM zoho_items_map zim
            ${where}
            ORDER BY ${(() => {
                const SORT_WHITELIST = ['zoho_item_name','zoho_sku','zoho_brand','zoho_category_name','zoho_rate','zoho_stock_on_hand'];
                const sortCol = SORT_WHITELIST.includes(req.query.sort) ? `zim.${req.query.sort}` : 'zim.zoho_item_name';
                const sortOrder = req.query.order === 'desc' ? 'DESC' : 'ASC';
                return `${sortCol} ${sortOrder}`;
            })()}
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), offset]);

        res.json({
            success: true,
            data: items,
            pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) }
        });
    } catch (error) {
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

/**
 * POST /api/zoho/items/bulk-edit - Create bulk job with per-item unique payloads
 * Unlike bulk-update (same fields for all items), this accepts individual changes per item.
 */
router.post('/items/bulk-edit', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const { items } = req.body;
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'items array is required' });
        }

        // Validate each item has zoho_item_id and changes
        for (const item of items) {
            if (!item.zoho_item_id || !item.changes || Object.keys(item.changes).length === 0) {
                return res.status(400).json({ success: false, message: 'Each item must have zoho_item_id and non-empty changes' });
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
            req.user.id
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

        // Also update local zoho_items_map so edits persist before Zoho sync
        const FIELD_MAP = {
            name: 'zoho_item_name', sku: 'zoho_sku', rate: 'zoho_rate',
            purchase_rate: 'zoho_purchase_rate', cf_dpl: 'zoho_cf_dpl',
            unit: 'zoho_unit', hsn_or_sac: 'zoho_hsn_or_sac',
            tax_percentage: 'zoho_tax_percentage', brand: 'zoho_brand',
            category_name: 'zoho_category_name', manufacturer: 'zoho_manufacturer',
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
            if (sets.length > 0) {
                vals.push(item.zoho_item_id);
                await pool.query(`UPDATE zoho_items_map SET ${sets.join(', ')} WHERE zoho_item_id = ?`, vals);
            }
        }

        res.json({
            success: true,
            data: { job_id: jobId, total_items: items.length },
            message: `Bulk edit job created with ${items.length} items`
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/items/bulk-jobs - List bulk jobs
 * NOTE: Must be defined BEFORE /items/:id to avoid :id catching "bulk-jobs"
 */
router.get('/items/bulk-jobs', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;

        let where = 'WHERE 1=1';
        const params = [];

        if (status) { where += ' AND bj.status = ?'; params.push(status); }

        const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

        const [jobs] = await pool.query(`
            SELECT bj.*, u.full_name as created_by_name
            FROM zoho_bulk_jobs bj
            LEFT JOIN users u ON bj.created_by = u.id
            ${where}
            ORDER BY bj.created_at DESC
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), offset]);

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
        let itemWhere = 'WHERE bji.job_id = ?';
        const itemParams = [req.params.id];

        if (item_status) { itemWhere += ' AND bji.status = ?'; itemParams.push(item_status); }

        const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

        const [items] = await pool.query(`
            SELECT bji.* FROM zoho_bulk_job_items bji
            ${itemWhere}
            ORDER BY bji.id
            LIMIT ? OFFSET ?
        `, [...itemParams, parseInt(limit), offset]);

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

        let where = 'WHERE 1=1';
        const params = [];

        if (from_date) { where += ' AND dt.transaction_date >= ?'; params.push(from_date); }
        if (to_date) { where += ' AND dt.transaction_date <= ?'; params.push(to_date); }
        if (location_id) { where += ' AND dt.zoho_location_id = ?'; params.push(location_id); }

        const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

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
        `, [...params, parseInt(limit), offset]);

        res.json({
            success: true,
            data: transactions,
            pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) }
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
router.get('/reorder/config', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const { item_id, location_id, page = 1, limit = 50 } = req.query;

        let where = 'WHERE 1=1';
        const params = [];

        if (item_id) { where += ' AND rc.zoho_item_id = ?'; params.push(item_id); }
        if (location_id) { where += ' AND rc.zoho_location_id = ?'; params.push(location_id); }

        const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

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
        `, [...params, parseInt(limit), offset]);

        res.json({
            success: true,
            data: configs,
            pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / parseInt(limit)) }
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
            WHERE lm.is_active = 1 OR lm.is_active IS NULL
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
 * POST /api/zoho/items/parse-price-list - Parse a brand dealer price list PDF
 * Returns extracted items with product name, pack size, and DPL
 * Optionally matches against existing Zoho items
 */
const { uploadPriceList } = require('../config/uploads');
const priceListParser = require('../services/price-list-parser');

router.post('/items/parse-price-list', requirePermission('zoho', 'manage'), uploadPriceList.single('pdf'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'PDF file is required' });
        }

        const result = await priceListParser.parsePriceList(req.file.buffer, req.file.originalname);

        // If requested, match against existing Zoho items
        if (req.body.match !== 'false') {
            const [zohoItems] = await pool.query(
                `SELECT zoho_item_id, zoho_item_name AS name, zoho_sku AS sku, zoho_rate AS rate, zoho_cf_dpl AS cf_dpl, zoho_unit AS unit
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
router.post('/items/apply-price-list', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const { items } = req.body;
        if (!items || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ success: false, message: 'items array required' });
        }

        let updated = 0;
        for (const item of items) {
            if (!item.zoho_item_id || item.cf_dpl === undefined) continue;
            const [result] = await pool.query(
                `UPDATE zoho_items_map SET zoho_cf_dpl = ? WHERE zoho_item_id = ?`,
                [item.cf_dpl, item.zoho_item_id]
            );
            if (result.affectedRows > 0) updated++;
        }

        res.json({
            success: true,
            data: { updated, total: items.length },
            message: `Updated DPL for ${updated} of ${items.length} items`
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = {
    router,
    setPool
};
