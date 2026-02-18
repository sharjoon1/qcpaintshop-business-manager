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

// In-memory cache for expensive API responses
const _apiCache = {}; // { key: { data, timestamp } }

function getCached(key, maxAgeMs = 300000) { // 5 min default
    const entry = _apiCache[key];
    if (entry && (Date.now() - entry.timestamp) < maxAgeMs) {
        return entry.data;
    }
    return null;
}

function setCache(key, data) {
    _apiCache[key] = { data, timestamp: Date.now() };
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
        ['zoho', 'bulk_update', 'Bulk Operations',            'Execute bulk item updates and price changes']
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
            SELECT zi.*, zcm.local_customer_id
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
        const [locations] = await pool.query(`
            SELECT zlm.*,
                zlm.zoho_location_name as name,
                zlm.zoho_location_name as location_name,
                zlm.local_branch_id as branch_id,
                zlm.last_synced_at as last_synced,
                b.name as branch_name
            FROM zoho_locations_map zlm
            LEFT JOIN branches b ON zlm.local_branch_id = b.id
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
 * GET /api/zoho/stock/by-location - Stock for a specific location (must be before :itemId)
 */
router.get('/stock/by-location', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const { location_id, search, page = 1, limit = 50 } = req.query;
        if (!location_id) {
            return res.status(400).json({ success: false, message: 'location_id required' });
        }

        let where = "WHERE ls.zoho_location_id = ? AND (zim.zoho_status = 'active' OR zim.zoho_status IS NULL)";
        const params = [location_id];

        if (search) {
            where += ' AND (ls.item_name LIKE ? OR ls.sku LIKE ?)';
            params.push('%' + search + '%', '%' + search + '%');
        }

        const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) as total FROM zoho_location_stock ls LEFT JOIN zoho_items_map zim ON ls.zoho_item_id = zim.zoho_item_id ${where}`, params
        );

        const [rows] = await pool.query(`
            SELECT ls.zoho_item_id as item_id, ls.item_name as name, ls.sku,
                   ls.stock_on_hand, ls.available_stock, ls.committed_stock, ls.available_for_sale,
                   ls.zoho_location_id as location_id
            FROM zoho_location_stock ls
            LEFT JOIN zoho_items_map zim ON ls.zoho_item_id = zim.zoho_item_id
            ${where}
            ORDER BY ls.item_name ASC
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
            `SELECT COUNT(*) as total FROM zoho_stock_history sh ${where}`, params
        );

        const [rows] = await pool.query(`
            SELECT sh.*, lm.zoho_location_name
            FROM zoho_stock_history sh
            LEFT JOIN zoho_locations_map lm ON sh.zoho_location_id = lm.zoho_location_id
            ${where}
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
            WHERE ls.zoho_item_id = ?
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
                return {
                    item_id: li.item_id,
                    quantity_adjusted: li.quantity_adjusted
                };
            })
        };

        // Add location_id at top level if provided (for multi-warehouse)
        if (zohoLocationId) {
            adjustmentData.location_id = zohoLocationId;
        }

        const result = await zohoAPI.createInventoryAdjustment(adjustmentData);
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
        const { search, page = 1, limit = 50 } = req.query;

        let where = "WHERE (zim.zoho_status = 'active' OR zim.zoho_status IS NULL)";
        const params = [];

        if (search) {
            where += ' AND (zim.zoho_item_name LIKE ? OR zim.zoho_sku LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
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
                zim.last_synced_at as last_synced
            FROM zoho_items_map zim
            ${where}
            ORDER BY zim.zoho_item_name ASC
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
        for (const item of items) {
            await pool.query(`
                INSERT INTO zoho_bulk_job_items (job_id, zoho_item_id, item_name, payload)
                VALUES (?, ?, ?, ?)
            `, [jobId, item.zoho_item_id, item.item_name || '', JSON.stringify(item.changes)]);
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

        const [[{ total }]] = await pool.query(`SELECT COUNT(*) as total FROM zoho_daily_transactions dt ${where}`, params);

        const [transactions] = await pool.query(`
            SELECT dt.*
            FROM zoho_daily_transactions dt
            ${where}
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
            WHERE dt.transaction_date = ?
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

        const [[{ total }]] = await pool.query(`SELECT COUNT(*) as total FROM zoho_reorder_config rc ${where}`, params);

        const [configs] = await pool.query(`
            SELECT rc.*, ls.stock_on_hand, ls.available_stock
            FROM zoho_reorder_config rc
            LEFT JOIN zoho_location_stock ls ON rc.zoho_item_id = ls.zoho_item_id AND rc.zoho_location_id = ls.zoho_location_id
            ${where}
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
                COUNT(CASE WHEN status = 'active' THEN 1 END) as active_count,
                COUNT(CASE WHEN status = 'acknowledged' THEN 1 END) as acknowledged_count,
                COUNT(CASE WHEN severity = 'critical' AND status IN ('active','acknowledged') THEN 1 END) as critical_count,
                COUNT(CASE WHEN severity = 'high' AND status IN ('active','acknowledged') THEN 1 END) as high_count,
                COUNT(CASE WHEN severity = 'medium' AND status IN ('active','acknowledged') THEN 1 END) as medium_count,
                COUNT(CASE WHEN severity = 'low' AND status IN ('active','acknowledged') THEN 1 END) as low_count
            FROM zoho_reorder_alerts
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

module.exports = {
    router,
    setPool
};
