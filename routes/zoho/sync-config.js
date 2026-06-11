/**
 * ZOHO ROUTES — STATUS & DASHBOARD / API USAGE MONITOR / SYNC ENDPOINTS /
 * CONFIGURATION / OAUTH SETUP / WHATSAPP FOLLOWUPS / SCHEDULER CONTROL /
 * LOCATIONS
 * Split from routes/zoho.js (A8b) — handlers moved verbatim, original
 * relative order preserved.
 */

const express = require('express');
const router = express.Router();
const { requirePermission } = require('../../middleware/permissionMiddleware');

// Services (initialized via setPool in ./shared)
const zohoOAuth = require('../../services/zoho-oauth');
const zohoAPI = require('../../services/zoho-api');
const syncScheduler = require('../../services/sync-scheduler');
const whatsappProcessor = require('../../services/whatsapp-processor');

const { isSyncDebounced } = require('./shared');

let pool;
function setPool(dbPool) { pool = dbPool; }

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
        const rateLimiter = require('../../services/zoho-rate-limiter');
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
        const rateLimiter = require('../../services/zoho-rate-limiter');

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
        const { code, state, error: oauthError } = req.query;

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

        // RT-064: reject callbacks whose state param is missing/forged/expired (CSRF guard).
        // The state is HMAC-signed by getAuthorizationUrl(); an attacker cannot forge one.
        if (!zohoOAuth.verifyOAuthState(state)) {
            return res.status(400).send(`
                <html><body style="font-family:sans-serif;text-align:center;padding:50px">
                <h2 style="color:#ef4444">Invalid or expired authorization request</h2>
                <p>Please start the Zoho connection again from Settings.</p>
                <a href="/admin-zoho-settings.html">Back to Settings</a>
                </body></html>
            `);
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


module.exports = { router, setPool };
