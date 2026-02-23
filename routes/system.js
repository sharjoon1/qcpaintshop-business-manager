/**
 * System Health & Error Prevention Routes
 * /api/system/*
 */

const express = require('express');
const router = express.Router();
const { requirePermission, requireAuth } = require('../middleware/permissionMiddleware');
const healthService = require('../services/system-health-service');
const preventionService = require('../services/error-prevention-service');
const errorHandler = require('../middleware/errorHandler');

let pool = null;
function setPool(p) {
    pool = p;
    healthService.setPool(p);
    preventionService.setPool(p);
    errorHandler.setPool(p);
}

// ========================================
// HEALTH CHECK ENDPOINTS
// ========================================

/**
 * GET /api/system/health
 * Full system health check
 */
router.get('/health', requireAuth, async (req, res) => {
    try {
        const report = await healthService.performHealthCheck();
        res.json({ success: true, data: report });
    } catch (error) {
        console.error('Health check error:', error);
        res.status(500).json({ success: false, message: 'Health check failed' });
    }
});

/**
 * POST /api/system/health-check
 * Trigger manual health check (stores result)
 */
router.post('/health-check', requirePermission('system', 'health'), async (req, res) => {
    try {
        const report = await healthService.performHealthCheck();
        res.json({ success: true, message: 'Health check completed', data: report });
    } catch (error) {
        console.error('Manual health check error:', error);
        res.status(500).json({ success: false, message: 'Health check failed' });
    }
});

/**
 * GET /api/system/health/history
 * Get health check history
 */
router.get('/health/history', requirePermission('system', 'health'), async (req, res) => {
    try {
        const { check_type, status, limit = 50 } = req.query;
        let where = 'WHERE 1=1';
        const params = [];

        if (check_type) { where += ' AND check_type = ?'; params.push(check_type); }
        if (status) { where += ' AND status = ?'; params.push(status); }

        const [rows] = await pool.query(`
            SELECT * FROM system_health_checks ${where}
            ORDER BY checked_at DESC LIMIT ?
        `, [...params, Math.min(200, parseInt(limit) || 50)]);

        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Health history error:', error);
        res.status(500).json({ success: false, message: 'Failed to get health history' });
    }
});

// ========================================
// ERROR LOG ENDPOINTS
// ========================================

/**
 * GET /api/system/errors
 * Error logs with filtering
 */
router.get('/errors', requirePermission('system', 'health'), async (req, res) => {
    try {
        const {
            error_type, severity, status, search,
            date_from, date_to,
            page = 1, limit = 50
        } = req.query;

        let where = 'WHERE 1=1';
        const params = [];

        if (error_type) { where += ' AND el.error_type = ?'; params.push(error_type); }
        if (severity) { where += ' AND el.severity = ?'; params.push(severity); }
        if (status) { where += ' AND el.status = ?'; params.push(status); }
        if (search) {
            where += ' AND (el.error_message LIKE ? OR el.request_url LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }
        if (date_from) { where += ' AND el.created_at >= ?'; params.push(date_from); }
        if (date_to) { where += ' AND el.created_at <= ?'; params.push(`${date_to} 23:59:59`); }

        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
        const offset = (pageNum - 1) * limitNum;

        const [countRows] = await pool.query(`SELECT COUNT(*) as total FROM error_logs el ${where}`, params);
        const total = countRows[0].total;

        const [rows] = await pool.query(`
            SELECT el.*, u.full_name as user_name
            FROM error_logs el
            LEFT JOIN users u ON el.user_id = u.id
            ${where}
            ORDER BY el.created_at DESC
            LIMIT ? OFFSET ?
        `, [...params, limitNum, offset]);

        // Summary stats
        const [summary] = await pool.query(`
            SELECT
                COUNT(*) as total_24h,
                SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as critical,
                SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) as high,
                SUM(CASE WHEN severity = 'medium' THEN 1 ELSE 0 END) as medium,
                SUM(CASE WHEN severity = 'low' THEN 1 ELSE 0 END) as low,
                SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as unresolved
            FROM error_logs
            WHERE created_at >= NOW() - INTERVAL 24 HOUR
        `);

        res.json({
            success: true,
            data: rows,
            summary: summary[0],
            pagination: { page: pageNum, limit: limitNum, total, total_pages: Math.ceil(total / limitNum) }
        });
    } catch (error) {
        console.error('Error logs error:', error);
        res.status(500).json({ success: false, message: 'Failed to get error logs' });
    }
});

/**
 * GET /api/system/errors/stats
 * Error statistics and trends
 */
router.get('/errors/stats', requirePermission('system', 'health'), async (req, res) => {
    try {
        // By type (24h)
        const [byType] = await pool.query(`
            SELECT error_type, COUNT(*) as count
            FROM error_logs WHERE created_at >= NOW() - INTERVAL 24 HOUR
            GROUP BY error_type ORDER BY count DESC
        `);

        // By severity (24h)
        const [bySeverity] = await pool.query(`
            SELECT severity, COUNT(*) as count
            FROM error_logs WHERE created_at >= NOW() - INTERVAL 24 HOUR
            GROUP BY severity ORDER BY FIELD(severity, 'critical', 'high', 'medium', 'low')
        `);

        // Hourly trend (last 24h)
        const [hourlyTrend] = await pool.query(`
            SELECT
                DATE_FORMAT(created_at, '%Y-%m-%d %H:00') as hour,
                COUNT(*) as count
            FROM error_logs
            WHERE created_at >= NOW() - INTERVAL 24 HOUR
            GROUP BY hour
            ORDER BY hour
        `);

        // Top error endpoints
        const [topEndpoints] = await pool.query(`
            SELECT request_url, request_method, COUNT(*) as count
            FROM error_logs
            WHERE created_at >= NOW() - INTERVAL 24 HOUR AND request_url IS NOT NULL
            GROUP BY request_url, request_method
            ORDER BY count DESC LIMIT 10
        `);

        // Resolution rate
        const [resolution] = await pool.query(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status = 'resolved' THEN 1 ELSE 0 END) as resolved,
                SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as unresolved
            FROM error_logs
            WHERE created_at >= NOW() - INTERVAL 7 DAY
        `);

        res.json({
            success: true,
            data: {
                byType, bySeverity, hourlyTrend, topEndpoints,
                resolution: resolution[0]
            }
        });
    } catch (error) {
        console.error('Error stats error:', error);
        res.status(500).json({ success: false, message: 'Failed to get error stats' });
    }
});

/**
 * POST /api/system/errors/:id/resolve
 * Mark error as resolved
 */
router.post('/errors/:id/resolve', requirePermission('system', 'health'), async (req, res) => {
    try {
        const { resolution_notes } = req.body;
        const errorId = req.params.id;

        const [existing] = await pool.query('SELECT id, status FROM error_logs WHERE id = ?', [errorId]);
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Error log not found' });
        }

        await pool.query(
            'UPDATE error_logs SET status = ?, resolution_notes = ?, resolved_at = NOW() WHERE id = ?',
            ['resolved', resolution_notes || null, errorId]
        );

        res.json({ success: true, message: 'Error resolved' });
    } catch (error) {
        console.error('Resolve error:', error);
        res.status(500).json({ success: false, message: 'Failed to resolve error' });
    }
});

/**
 * POST /api/system/errors/:id/ignore
 * Mark error as ignored
 */
router.post('/errors/:id/ignore', requirePermission('system', 'health'), async (req, res) => {
    try {
        await pool.query('UPDATE error_logs SET status = ? WHERE id = ?', ['ignored', req.params.id]);
        res.json({ success: true, message: 'Error ignored' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to ignore error' });
    }
});

// ========================================
// PREVENTION ENDPOINTS
// ========================================

/**
 * GET /api/system/prevention-report
 * Full prevention report with recommendations
 */
router.get('/prevention-report', requirePermission('system', 'health'), async (req, res) => {
    try {
        const report = await preventionService.generatePreventionReport();
        res.json({ success: true, data: report });
    } catch (error) {
        console.error('Prevention report error:', error);
        res.status(500).json({ success: false, message: 'Failed to generate prevention report' });
    }
});

/**
 * POST /api/system/validate-integrity
 * Run data integrity validation
 */
router.post('/validate-integrity', requirePermission('system', 'health'), async (req, res) => {
    try {
        const result = await preventionService.validateDataIntegrity();
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Integrity validation error:', error);
        res.status(500).json({ success: false, message: 'Integrity validation failed' });
    }
});

/**
 * GET /api/system/code-quality
 * Code quality metrics
 */
router.get('/code-quality', requirePermission('system', 'health'), async (req, res) => {
    try {
        const result = await preventionService.performCodeQualityCheck();
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Code quality check error:', error);
        res.status(500).json({ success: false, message: 'Code quality check failed' });
    }
});

/**
 * POST /api/system/errors/log-client
 * Log client-side errors (requires auth only, no special permission)
 */
router.post('/errors/log-client', requireAuth, errorHandler.logClientError);

// ========================================
// DATABASE INTEGRITY
// ========================================

/**
 * GET /api/system/db-integrity
 * Database integrity check results
 */
router.get('/db-integrity', requirePermission('system', 'health'), async (req, res) => {
    try {
        const result = await healthService.checkDatabaseIntegrity();
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('DB integrity error:', error);
        res.status(500).json({ success: false, message: 'Database integrity check failed' });
    }
});

module.exports = {
    router,
    setPool
};
