/**
 * System Health, Error Prevention, Bug Reports & Fix Suggestions Routes
 * /api/system/*
 */

const express = require('express');
const router = express.Router();
const { requirePermission, requireAuth } = require('../middleware/permissionMiddleware');
const healthService = require('../services/system-health-service');
const preventionService = require('../services/error-prevention-service');
const errorAnalysisService = require('../services/error-analysis-service');
const errorHandler = require('../middleware/errorHandler');

let pool = null;
function setPool(p) {
    pool = p;
    healthService.setPool(p);
    preventionService.setPool(p);
    errorAnalysisService.setPool(p);
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

// ========================================
// ERROR ANALYSIS ENDPOINTS
// ========================================

/**
 * GET /api/system/errors/analysis
 * Error trend analysis
 */
router.get('/errors/analysis', requirePermission('system', 'health'), async (req, res) => {
    try {
        const { days = 7, module } = req.query;
        const result = await errorAnalysisService.analyzeErrorTrends({
            days: Math.min(90, parseInt(days) || 7),
            module
        });
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Error analysis error:', error);
        res.status(500).json({ success: false, message: 'Error analysis failed' });
    }
});

/**
 * GET /api/system/errors/analysis/:module
 * Module-specific error analysis
 */
router.get('/errors/analysis/:module', requirePermission('system', 'health'), async (req, res) => {
    try {
        const result = await errorAnalysisService.analyzeByModule(req.params.module);
        if (!result) return res.status(404).json({ success: false, message: 'No data for module' });
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Module analysis error:', error);
        res.status(500).json({ success: false, message: 'Module analysis failed' });
    }
});

/**
 * GET /api/system/errors/summary
 * Quick error + bug + fix summary for dashboard
 */
router.get('/errors/summary', requirePermission('system', 'health'), async (req, res) => {
    try {
        const result = await errorAnalysisService.getErrorSummary();
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Error summary error:', error);
        res.status(500).json({ success: false, message: 'Failed to get summary' });
    }
});

/**
 * POST /api/system/errors/:id/fix-suggestions
 * Generate AI fix suggestions for an error
 */
router.post('/errors/:id/fix-suggestions', requirePermission('system', 'health'), async (req, res) => {
    try {
        const suggestions = await errorAnalysisService.generateFixSuggestion(parseInt(req.params.id));
        if (!suggestions) return res.status(404).json({ success: false, message: 'Error not found or AI unavailable' });
        res.json({ success: true, data: suggestions });
    } catch (error) {
        console.error('Fix suggestion error:', error);
        res.status(500).json({ success: false, message: 'Failed to generate fix suggestions' });
    }
});

/**
 * POST /api/system/errors/:id/create-bug
 * Auto-create bug report from an error
 */
router.post('/errors/:id/create-bug', requirePermission('system', 'health'), async (req, res) => {
    try {
        const bugId = await errorAnalysisService.autoCreateBugFromError(parseInt(req.params.id));
        if (!bugId) return res.status(404).json({ success: false, message: 'Error not found' });
        res.json({ success: true, data: { bug_report_id: bugId }, message: 'Bug report created' });
    } catch (error) {
        console.error('Create bug from error:', error);
        res.status(500).json({ success: false, message: 'Failed to create bug report' });
    }
});

// ========================================
// BUG REPORT ENDPOINTS
// ========================================

/**
 * GET /api/system/bugs
 * List bug reports with filtering
 */
router.get('/bugs', requirePermission('system', 'health'), async (req, res) => {
    try {
        const { status, priority, module, assigned_to, search, page = 1, limit = 50 } = req.query;
        let where = 'WHERE 1=1';
        const params = [];

        if (status) { where += ' AND br.status = ?'; params.push(status); }
        if (priority) { where += ' AND br.priority = ?'; params.push(priority); }
        if (module) { where += ' AND br.module = ?'; params.push(module); }
        if (assigned_to) { where += ' AND br.assigned_to = ?'; params.push(assigned_to); }
        if (search) {
            where += ' AND (br.title LIKE ? OR br.description LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }

        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
        const offset = (pageNum - 1) * limitNum;

        const [countRows] = await pool.query(`SELECT COUNT(*) as total FROM bug_reports br ${where}`, params);
        const total = countRows[0].total;

        const [rows] = await pool.query(`
            SELECT br.*,
                   reporter.full_name as reporter_name,
                   assignee.full_name as assignee_name,
                   (SELECT COUNT(*) FROM fix_suggestions fs WHERE fs.bug_report_id = br.id) as fix_count
            FROM bug_reports br
            LEFT JOIN users reporter ON br.reported_by = reporter.id
            LEFT JOIN users assignee ON br.assigned_to = assignee.id
            ${where}
            ORDER BY FIELD(br.priority, 'critical', 'high', 'medium', 'low'), br.created_at DESC
            LIMIT ? OFFSET ?
        `, [...params, limitNum, offset]);

        // Summary counts
        const [summary] = await pool.query(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_count,
                SUM(CASE WHEN status = 'investigating' THEN 1 ELSE 0 END) as investigating,
                SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as in_progress,
                SUM(CASE WHEN status = 'fixed' THEN 1 ELSE 0 END) as fixed,
                SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed,
                SUM(CASE WHEN priority = 'critical' AND status NOT IN ('fixed','closed','wont_fix') THEN 1 ELSE 0 END) as open_critical
            FROM bug_reports
        `);

        res.json({
            success: true,
            data: rows,
            summary: summary[0],
            pagination: { page: pageNum, limit: limitNum, total, total_pages: Math.ceil(total / limitNum) }
        });
    } catch (error) {
        console.error('Bug list error:', error);
        res.status(500).json({ success: false, message: 'Failed to get bug reports' });
    }
});

/**
 * GET /api/system/bugs/:id
 * Get single bug report with fix suggestions
 */
router.get('/bugs/:id', requirePermission('system', 'health'), async (req, res) => {
    try {
        const [bugs] = await pool.query(`
            SELECT br.*,
                   reporter.full_name as reporter_name,
                   assignee.full_name as assignee_name
            FROM bug_reports br
            LEFT JOIN users reporter ON br.reported_by = reporter.id
            LEFT JOIN users assignee ON br.assigned_to = assignee.id
            WHERE br.id = ?
        `, [req.params.id]);

        if (bugs.length === 0) return res.status(404).json({ success: false, message: 'Bug report not found' });

        // Get fix suggestions
        const [suggestions] = await pool.query(
            'SELECT * FROM fix_suggestions WHERE bug_report_id = ? ORDER BY confidence DESC',
            [req.params.id]
        );

        // Get related error if linked
        let relatedError = null;
        if (bugs[0].related_error_id) {
            const [errors] = await pool.query('SELECT * FROM error_logs WHERE id = ?', [bugs[0].related_error_id]);
            if (errors.length > 0) relatedError = errors[0];
        }

        res.json({
            success: true,
            data: { ...bugs[0], fix_suggestions: suggestions, related_error: relatedError }
        });
    } catch (error) {
        console.error('Bug detail error:', error);
        res.status(500).json({ success: false, message: 'Failed to get bug report' });
    }
});

/**
 * POST /api/system/bugs
 * Create new bug report
 */
router.post('/bugs', requirePermission('system', 'health'), async (req, res) => {
    try {
        const { title, description, steps_to_reproduce, expected_behavior, actual_behavior,
                module, priority, assigned_to, related_error_id } = req.body;

        if (!title) return res.status(400).json({ success: false, message: 'Title is required' });

        // Get error hash if linked to error
        let errorHash = null;
        if (related_error_id) {
            const [errors] = await pool.query('SELECT error_hash FROM error_logs WHERE id = ?', [related_error_id]);
            if (errors.length > 0) errorHash = errors[0].error_hash;
        }

        const [result] = await pool.query(`
            INSERT INTO bug_reports (title, description, steps_to_reproduce, expected_behavior,
                actual_behavior, module, priority, reported_by, assigned_to, related_error_id, error_hash)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            title, description || null, steps_to_reproduce || null,
            expected_behavior || null, actual_behavior || null,
            module || null, priority || 'medium',
            req.user.id, assigned_to || null,
            related_error_id || null, errorHash
        ]);

        res.json({ success: true, data: { id: result.insertId }, message: 'Bug report created' });
    } catch (error) {
        console.error('Create bug error:', error);
        res.status(500).json({ success: false, message: 'Failed to create bug report' });
    }
});

/**
 * PUT /api/system/bugs/:id
 * Update bug report
 */
router.put('/bugs/:id', requirePermission('system', 'health'), async (req, res) => {
    try {
        const { title, description, steps_to_reproduce, expected_behavior, actual_behavior,
                module, priority, status, assigned_to, resolution_notes, fix_commit } = req.body;

        const [existing] = await pool.query('SELECT id, status FROM bug_reports WHERE id = ?', [req.params.id]);
        if (existing.length === 0) return res.status(404).json({ success: false, message: 'Bug report not found' });

        const updates = [];
        const params = [];

        if (title !== undefined) { updates.push('title = ?'); params.push(title); }
        if (description !== undefined) { updates.push('description = ?'); params.push(description); }
        if (steps_to_reproduce !== undefined) { updates.push('steps_to_reproduce = ?'); params.push(steps_to_reproduce); }
        if (expected_behavior !== undefined) { updates.push('expected_behavior = ?'); params.push(expected_behavior); }
        if (actual_behavior !== undefined) { updates.push('actual_behavior = ?'); params.push(actual_behavior); }
        if (module !== undefined) { updates.push('module = ?'); params.push(module); }
        if (priority !== undefined) { updates.push('priority = ?'); params.push(priority); }
        if (status !== undefined) {
            updates.push('status = ?'); params.push(status);
            if (['fixed', 'closed', 'wont_fix'].includes(status)) {
                updates.push('resolved_at = NOW()');
            }
        }
        if (assigned_to !== undefined) { updates.push('assigned_to = ?'); params.push(assigned_to || null); }
        if (resolution_notes !== undefined) { updates.push('resolution_notes = ?'); params.push(resolution_notes); }
        if (fix_commit !== undefined) { updates.push('fix_commit = ?'); params.push(fix_commit); }

        if (updates.length === 0) return res.status(400).json({ success: false, message: 'No fields to update' });

        params.push(req.params.id);
        await pool.query(`UPDATE bug_reports SET ${updates.join(', ')} WHERE id = ?`, params);

        res.json({ success: true, message: 'Bug report updated' });
    } catch (error) {
        console.error('Update bug error:', error);
        res.status(500).json({ success: false, message: 'Failed to update bug report' });
    }
});

/**
 * DELETE /api/system/bugs/:id
 * Delete bug report
 */
router.delete('/bugs/:id', requirePermission('system', 'health'), async (req, res) => {
    try {
        await pool.query('DELETE FROM fix_suggestions WHERE bug_report_id = ?', [req.params.id]);
        await pool.query('DELETE FROM bug_reports WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Bug report deleted' });
    } catch (error) {
        console.error('Delete bug error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete bug report' });
    }
});

/**
 * POST /api/system/bugs/:id/fix-suggestions
 * Generate AI fix suggestions for a bug report
 */
router.post('/bugs/:id/fix-suggestions', requirePermission('system', 'health'), async (req, res) => {
    try {
        const suggestions = await errorAnalysisService.generateBugFix(parseInt(req.params.id));
        if (!suggestions) return res.status(404).json({ success: false, message: 'Bug not found or AI unavailable' });
        res.json({ success: true, data: suggestions });
    } catch (error) {
        console.error('Bug fix suggestion error:', error);
        res.status(500).json({ success: false, message: 'Failed to generate fix suggestions' });
    }
});

// ========================================
// FIX SUGGESTION ENDPOINTS
// ========================================

/**
 * GET /api/system/fix-suggestions
 * List fix suggestions with filtering
 */
router.get('/fix-suggestions', requirePermission('system', 'health'), async (req, res) => {
    try {
        const { status, type, ai_only, limit = 50 } = req.query;
        let where = 'WHERE 1=1';
        const params = [];

        if (status) { where += ' AND fs.status = ?'; params.push(status); }
        if (type) { where += ' AND fs.suggestion_type = ?'; params.push(type); }
        if (ai_only === '1') { where += ' AND fs.ai_generated = 1'; }

        const [rows] = await pool.query(`
            SELECT fs.*,
                   el.error_message, el.error_type, el.request_url,
                   br.title as bug_title, br.status as bug_status,
                   applier.full_name as applied_by_name
            FROM fix_suggestions fs
            LEFT JOIN error_logs el ON fs.error_id = el.id
            LEFT JOIN bug_reports br ON fs.bug_report_id = br.id
            LEFT JOIN users applier ON fs.applied_by = applier.id
            ${where}
            ORDER BY fs.confidence DESC, fs.created_at DESC
            LIMIT ?
        `, [...params, Math.min(200, parseInt(limit) || 50)]);

        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Fix suggestions list error:', error);
        res.status(500).json({ success: false, message: 'Failed to get fix suggestions' });
    }
});

/**
 * PUT /api/system/fix-suggestions/:id
 * Update fix suggestion status
 */
router.put('/fix-suggestions/:id', requirePermission('system', 'health'), async (req, res) => {
    try {
        const { status } = req.body;
        if (!status || !['pending', 'approved', 'applied', 'rejected'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Valid status required' });
        }

        const updates = ['status = ?'];
        const params = [status];

        if (status === 'applied') {
            updates.push('applied_by = ?', 'applied_at = NOW()');
            params.push(req.user.id);
        }

        params.push(req.params.id);
        await pool.query(`UPDATE fix_suggestions SET ${updates.join(', ')} WHERE id = ?`, params);

        res.json({ success: true, message: `Fix suggestion ${status}` });
    } catch (error) {
        console.error('Update fix suggestion error:', error);
        res.status(500).json({ success: false, message: 'Failed to update fix suggestion' });
    }
});

module.exports = {
    router,
    setPool
};
