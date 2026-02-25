/**
 * Anomaly Detection API Routes
 * Endpoints for viewing, managing, and triggering anomaly detection scans
 */

const express = require('express');
const router = express.Router();
const { requirePermission, requireAuth } = require('../middleware/permissionMiddleware');
const anomalyDetector = require('../services/anomaly-detector');

let pool = null;
function setPool(p) {
    pool = p;
    anomalyDetector.setPool(p);
}

// ========================================
// DASHBOARD & LIST ENDPOINTS
// ========================================

/**
 * GET /api/anomalies/dashboard
 * Get anomaly dashboard summary stats
 */
router.get('/dashboard', requireAuth, async (req, res) => {
    try {
        const stats = await anomalyDetector.getDashboardStats();
        res.json({ success: true, data: stats });
    } catch (error) {
        console.error('Anomaly dashboard error:', error);
        res.status(500).json({ success: false, message: 'Failed to load dashboard' });
    }
});

/**
 * GET /api/anomalies/config
 * Get anomaly detection configuration
 */
router.get('/config', requirePermission('system', 'health'), async (req, res) => {
    try {
        const config = await anomalyDetector.getConfig();
        const [rows] = await pool.query(
            `SELECT config_key, config_value, description FROM ai_config WHERE config_key LIKE 'anomaly_%' ORDER BY config_key`
        );
        res.json({ success: true, data: { parsed: config, raw: rows } });
    } catch (error) {
        console.error('Anomaly config error:', error);
        res.status(500).json({ success: false, message: 'Failed to load config' });
    }
});

/**
 * PUT /api/anomalies/config
 * Update anomaly detection configuration
 */
router.put('/config', requirePermission('system', 'health'), async (req, res) => {
    try {
        const { settings } = req.body;
        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({ success: false, message: 'Settings object required' });
        }

        const allowedKeys = [
            'anomaly_detection_enabled', 'anomaly_scan_interval_hours',
            'anomaly_revenue_zscore_threshold', 'anomaly_attendance_zscore_threshold',
            'anomaly_stock_deviation_pct', 'anomaly_collection_delay_days',
            'anomaly_auto_resolve_days', 'anomaly_max_per_scan', 'anomaly_notify_critical'
        ];

        let updated = 0;
        for (const [key, value] of Object.entries(settings)) {
            if (allowedKeys.includes(key)) {
                await pool.query(
                    `UPDATE ai_config SET config_value = ? WHERE config_key = ?`,
                    [String(value), key]
                );
                updated++;
            }
        }

        res.json({ success: true, message: `Updated ${updated} settings` });
    } catch (error) {
        console.error('Anomaly config update error:', error);
        res.status(500).json({ success: false, message: 'Failed to update config' });
    }
});

/**
 * GET /api/anomalies
 * List anomalies with filters
 */
router.get('/', requireAuth, async (req, res) => {
    try {
        const { type, severity, status, branch_id, page = 1, limit = 25 } = req.query;
        const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);

        let where = 'WHERE 1=1';
        const params = [];

        if (type) { where += ' AND anomaly_type = ?'; params.push(type); }
        if (severity) { where += ' AND severity = ?'; params.push(severity); }
        if (status) { where += ' AND status = ?'; params.push(status); }
        if (branch_id) { where += ' AND branch_id = ?'; params.push(parseInt(branch_id)); }

        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) as total FROM detected_anomalies ${where}`, params
        );

        const [rows] = await pool.query(
            `SELECT id, anomaly_type, severity, title, description, status,
                    entity_type, entity_id, metric_name, expected_value, actual_value,
                    deviation_pct, z_score, branch_id, detected_at, resolved_at, metadata
             FROM detected_anomalies ${where}
             ORDER BY detected_at DESC
             LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), offset]
        );

        res.json({
            success: true,
            data: rows,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('Anomaly list error:', error);
        res.status(500).json({ success: false, message: 'Failed to load anomalies' });
    }
});

// ========================================
// SINGLE ANOMALY ENDPOINTS
// ========================================

/**
 * GET /api/anomalies/:id
 * Get anomaly detail
 */
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT da.*, u.full_name as resolved_by_name
             FROM detected_anomalies da
             LEFT JOIN users u ON da.resolved_by = u.id
             WHERE da.id = ?`,
            [req.params.id]
        );
        if (!rows.length) {
            return res.status(404).json({ success: false, message: 'Anomaly not found' });
        }
        res.json({ success: true, data: rows[0] });
    } catch (error) {
        console.error('Anomaly detail error:', error);
        res.status(500).json({ success: false, message: 'Failed to load anomaly' });
    }
});

/**
 * PUT /api/anomalies/:id/status
 * Update anomaly status (acknowledge, investigate, resolve, false-positive)
 */
router.put('/:id/status', requirePermission('system', 'health'), async (req, res) => {
    try {
        const { status, notes } = req.body;
        const validStatuses = ['acknowledged', 'investigating', 'resolved', 'false_positive'];

        if (!validStatuses.includes(status)) {
            return res.status(400).json({ success: false, message: `Invalid status. Use: ${validStatuses.join(', ')}` });
        }

        const updates = ['status = ?'];
        const params = [status];

        if (['resolved', 'false_positive'].includes(status)) {
            updates.push('resolved_at = NOW()');
            updates.push('resolved_by = ?');
            params.push(req.user.id);
        }

        if (notes) {
            updates.push('resolution_notes = ?');
            params.push(notes);
        }

        params.push(req.params.id);
        const [result] = await pool.query(
            `UPDATE detected_anomalies SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Anomaly not found' });
        }

        res.json({ success: true, message: `Anomaly ${status}` });
    } catch (error) {
        console.error('Anomaly status update error:', error);
        res.status(500).json({ success: false, message: 'Failed to update status' });
    }
});

// ========================================
// SCAN ENDPOINTS
// ========================================

/**
 * POST /api/anomalies/scan
 * Trigger a manual anomaly scan
 */
router.post('/scan', requirePermission('system', 'health'), async (req, res) => {
    try {
        const result = await anomalyDetector.runFullScan();
        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Anomaly scan error:', error);
        res.status(500).json({ success: false, message: 'Scan failed: ' + error.message });
    }
});

module.exports = { router, setPool };
