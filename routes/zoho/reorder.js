/**
 * ZOHO ROUTES — REORDER ALERTS / BRAND REORDER CONFIG / PURCHASE SUGGESTIONS /
 * SNOOZE / VENDOR MAPPING / CREATE PO FROM REORDER ALERT
 * Split from routes/zoho.js (A8b) — handlers moved verbatim, original
 * relative order preserved.
 */

const express = require('express');
const router = express.Router();
const { requirePermission } = require('../../middleware/permissionMiddleware');
const { branchScope } = require('../../middleware/branchScope');

// Services (initialized via setPool in ./shared)
const zohoAPI = require('../../services/zoho-api');
const purchaseSuggestion = require('../../services/purchase-suggestion');
const invoiceLineSync = require('../../services/zoho-invoice-line-sync');
const reorderCompute = require('../../services/reorder-compute-service');
const reorderReport = require('../../services/reorder-report-service');
const vendorItemMapper = require('../../services/vendor-item-mapper');
const pathMod = require('path');
const fsMod = require('fs');

const { isSyncDebounced } = require('./shared');

let pool;
function setPool(dbPool) { pool = dbPool; }

// Module-scoped flag to prevent concurrent invoice-line back-fills
let invoiceBackfillState = { running: false, startedAt: null };

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

        const uploadsDir = pathMod.join(__dirname, '..', '..', 'uploads', 'reorder-reports');
        if (!fsMod.existsSync(uploadsDir)) fsMod.mkdirSync(uploadsDir, { recursive: true });
        const safeScope = report.scope.replace(':', '-');
        const pdfPath = pathMod.join(uploadsDir, `reorder-${report.report_date}-${safeScope}.pdf`);
        const { generateReorderPdf } = require('../../services/reorder-report-pdf-generator');
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


module.exports = { router, setPool };
