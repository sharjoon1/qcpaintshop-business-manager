/**
 * SYSTEM MONITORING ROUTES
 * Comprehensive dashboard data for system health, integrations, and business metrics
 */
const express = require('express');
const router = express.Router();
const os = require('os');
const { execSync } = require('child_process');
const { requireRole } = require('../middleware/permissionMiddleware');

// All monitoring endpoints require admin role
router.use(requireRole(['admin', 'super_admin']));

let pool;
let automationRegistry = null;
let responseTracker = null;
let productionMonitor = null;

function setPool(p) { pool = p; }
function setAutomationRegistry(r) { automationRegistry = r; }
function setResponseTracker(rt) { responseTracker = rt; }
function setProductionMonitor(pm) { productionMonitor = pm; }

// ─── Helpers ───────────────────────────────────────────────────

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1073741824) return (bytes / 1048576).toFixed(1) + ' MB';
    return (bytes / 1073741824).toFixed(2) + ' GB';
}

function formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    return parts.join(' ') || '< 1m';
}

function safeQuery(query, params = []) {
    return pool.query(query, params).then(r => r[0]).catch(() => []);
}

function safeQueryOne(query, params = []) {
    return pool.query(query, params).then(r => r[0]?.[0] || {}).catch(() => ({}));
}

// ─── GET /api/monitoring/overview ─────────────────────────────

router.get('/overview', async (req, res) => {
    try {
        const now = new Date();
        const istNow = now.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });

        // Run all queries in parallel
        const [
            systemInfo,
            dbInfo,
            pm2Info,
            errorInfo,
            integrations,
            backgroundJobs,
            businessToday,
            topIssues
        ] = await Promise.all([
            getSystemInfo(),
            getDatabaseInfo(),
            getPM2Info(),
            getErrorInfo(),
            getIntegrationStatus(),
            getBackgroundJobs(),
            getBusinessMetrics(),
            getTopIssues()
        ]);

        res.json({
            success: true,
            timestamp: istNow,
            system: systemInfo,
            database: dbInfo,
            pm2: pm2Info,
            errors: errorInfo,
            integrations,
            background_jobs: backgroundJobs,
            business_today: businessToday,
            top_issues: topIssues,
            performance: getPerformanceMetrics()
        });
    } catch (error) {
        console.error('[Monitoring] Overview error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ─── System Info ───────────────────────────────────────────────

async function getSystemInfo() {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const cpus = os.cpus();
    const cpuAvg = os.loadavg()[0]; // 1-min load avg
    const cpuPercent = Math.min(100, Math.round((cpuAvg / cpus.length) * 100));
    const processMemory = process.memoryUsage();

    let disk = { used: 'N/A', total: 'N/A', percent: 0 };
    try {
        const dfOut = execSync("df -h / | tail -1", { timeout: 5000 }).toString().trim();
        const parts = dfOut.split(/\s+/);
        if (parts.length >= 5) {
            disk = { total: parts[1], used: parts[2], available: parts[3], percent: parseInt(parts[4]) || 0 };
        }
    } catch (e) { /* ignore on Windows */ }

    return {
        uptime: formatUptime(process.uptime()),
        server_uptime: formatUptime(os.uptime()),
        node_version: process.version,
        platform: os.platform(),
        memory: {
            process_rss: formatBytes(processMemory.rss),
            process_heap: formatBytes(processMemory.heapUsed),
            system_used: formatBytes(usedMem),
            system_total: formatBytes(totalMem),
            percent: Math.round((usedMem / totalMem) * 100)
        },
        cpu: {
            cores: cpus.length,
            model: cpus[0]?.model || 'Unknown',
            load_avg: cpuAvg.toFixed(2),
            percent: cpuPercent
        },
        disk
    };
}

// ─── Database Info ─────────────────────────────────────────────

async function getDatabaseInfo() {
    try {
        const [sizeResult] = await pool.query(
            `SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) as size_mb,
                    COUNT(*) as table_count
             FROM information_schema.tables WHERE table_schema = DATABASE()`
        );

        const [poolStatus] = await pool.query('SHOW STATUS LIKE "Threads_connected"');
        const connections = poolStatus[0]?.Value || 0;

        const slowQueries = await safeQueryOne(
            `SELECT COUNT(*) as count FROM error_logs
             WHERE error_type = 'database' AND created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)`
        );

        const [dbStatus] = await pool.query('SELECT 1 as ok');
        const connected = dbStatus && dbStatus[0]?.ok === 1;

        return {
            status: connected ? 'connected' : 'disconnected',
            size: (sizeResult[0]?.size_mb || 0) + ' MB',
            tables: sizeResult[0]?.table_count || 0,
            connections: parseInt(connections) || 0,
            slow_queries_24h: slowQueries.count || 0
        };
    } catch (e) {
        return { status: 'error', size: 'N/A', tables: 0, connections: 0, slow_queries_24h: 0, error: e.message };
    }
}

// ─── PM2 Info ──────────────────────────────────────────────────

async function getPM2Info() {
    try {
        const output = execSync('pm2 jlist', { timeout: 5000 }).toString();
        const processes = JSON.parse(output);
        const app = processes.find(p => p.name === 'business-manager');
        if (!app) return { status: 'not_found', process_name: 'business-manager' };

        return {
            process_name: app.name,
            status: app.pm2_env?.status || 'unknown',
            pid: app.pid,
            restarts: app.pm2_env?.restart_time || 0,
            memory: formatBytes(app.monit?.memory || 0),
            cpu: (app.monit?.cpu || 0) + '%',
            uptime: formatUptime(Math.floor((Date.now() - (app.pm2_env?.pm_uptime || Date.now())) / 1000))
        };
    } catch (e) {
        return { status: 'error', process_name: 'business-manager', error: e.message };
    }
}

// ─── Error Info ────────────────────────────────────────────────

async function getErrorInfo() {
    const [counts] = await pool.query(`
        SELECT
            SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 ELSE 0 END) as last_24h,
            SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 1 HOUR) THEN 1 ELSE 0 END) as last_hour,
            SUM(CASE WHEN severity = 'critical' AND status = 'new' THEN 1 ELSE 0 END) as critical_count
        FROM error_logs
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
    `).catch(() => [[{ last_24h: 0, last_hour: 0, critical_count: 0 }]]);

    const recent = await safeQuery(
        `SELECT id, error_type, severity, error_message, request_url,
                DATE_FORMAT(created_at, '%h:%i %p') as time, created_at
         FROM error_logs
         ORDER BY created_at DESC LIMIT 10`
    );

    return {
        last_24h: counts[0]?.last_24h || 0,
        last_hour: counts[0]?.last_hour || 0,
        critical_count: counts[0]?.critical_count || 0,
        recent: recent.map(r => ({
            id: r.id,
            time: r.time,
            type: r.error_type,
            severity: r.severity,
            message: (r.error_message || '').substring(0, 150),
            url: r.request_url
        }))
    };
}

// ─── Integration Status ───────────────────────────────────────

async function getIntegrationStatus() {
    // Zoho
    const zohoToken = await safeQueryOne(
        `SELECT expires_at, updated_at FROM zoho_oauth_tokens ORDER BY updated_at DESC LIMIT 1`
    );
    const lastSync = await safeQueryOne(
        `SELECT sync_type, status, started_at, completed_at
         FROM zoho_sync_log ORDER BY started_at DESC LIMIT 1`
    );
    const zohoExpires = zohoToken.expires_at ? new Date(zohoToken.expires_at) : null;
    const zohoConnected = zohoExpires && zohoExpires > new Date();

    // WhatsApp
    const waSessions = await safeQuery(
        `SELECT branch_id, phone_number, status, connected_at, disconnected_at, last_error
         FROM whatsapp_sessions ORDER BY branch_id`
    );

    // AI
    const lastAIRun = await safeQueryOne(
        `SELECT analysis_type, status, model_provider, created_at, duration_ms
         FROM ai_analysis_runs ORDER BY created_at DESC LIMIT 1`
    );
    const aiConfig = await safeQueryOne(
        `SELECT config_value FROM ai_config WHERE config_key = 'clawdbot_enabled'`
    );

    return {
        zoho: {
            status: zohoConnected ? 'connected' : 'expired',
            last_sync: lastSync.completed_at ? new Date(lastSync.completed_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Never',
            last_sync_type: lastSync.sync_type || 'N/A',
            last_sync_status: lastSync.status || 'N/A',
            token_expires: zohoExpires ? zohoExpires.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'N/A',
            token_expires_in: zohoExpires ? Math.max(0, Math.round((zohoExpires - new Date()) / 86400000)) + ' days' : 'N/A'
        },
        whatsapp: {
            sessions: waSessions.map(s => ({
                branch_id: s.branch_id,
                phone: s.phone_number,
                status: s.status,
                last_error: s.last_error ? s.last_error.substring(0, 100) : null
            })),
            connected_count: waSessions.filter(s => s.status === 'connected').length,
            total: waSessions.length
        },
        ai: {
            provider: 'Clawdbot (Sonnet 4.5)',
            enabled: aiConfig.config_value === '1',
            last_run: lastAIRun.created_at ? new Date(lastAIRun.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Never',
            last_type: lastAIRun.analysis_type || 'N/A',
            last_status: lastAIRun.status || 'N/A',
            last_duration: lastAIRun.duration_ms ? (lastAIRun.duration_ms / 1000).toFixed(1) + 's' : 'N/A'
        }
    };
}

// ─── Background Jobs ──────────────────────────────────────────

async function getBackgroundJobs() {
    if (automationRegistry) {
        const jobs = automationRegistry.getAll();
        return jobs.map(j => ({
            id: j.id,
            name: j.name,
            schedule: j.schedule,
            status: j.status,
            last_run: j.lastRunAt ? new Date(j.lastRunAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) : 'Never',
            last_result: j.lastResult?.details || null,
            last_error: j.lastError || null,
            last_duration: j.lastDuration ? (j.lastDuration / 1000).toFixed(1) + 's' : null,
            run_count: j.runCount,
            fail_count: j.failCount
        }));
    }
    return [];
}

// ─── Business Metrics ─────────────────────────────────────────

async function getBusinessMetrics() {
    const [revenue] = await pool.query(
        `SELECT COALESCE(SUM(invoice_amount), 0) as revenue,
                COALESCE(SUM(invoice_count), 0) as invoices,
                COALESCE(SUM(payment_received_amount), 0) as collections
         FROM zoho_daily_transactions WHERE transaction_date = CURDATE()`
    ).catch(() => [[{ revenue: 0, invoices: 0, collections: 0 }]]);

    const staffPresent = await safeQueryOne(
        `SELECT COUNT(DISTINCT user_id) as count FROM staff_attendance WHERE date = CURDATE()`
    );

    const totalStaff = await safeQueryOne(
        `SELECT COUNT(*) as count FROM users WHERE status = 'active' AND role IN ('staff', 'manager')`
    );

    const newLeads = await safeQueryOne(
        `SELECT COUNT(*) as count FROM leads WHERE DATE(created_at) = CURDATE()`
    );

    const present = staffPresent.count || 0;
    const total = totalStaff.count || 1;

    return {
        revenue: Math.round(revenue[0]?.revenue || 0),
        invoices: revenue[0]?.invoices || 0,
        collections: Math.round(revenue[0]?.collections || 0),
        staff_present: present,
        staff_total: total,
        leads_new: newLeads.count || 0,
        attendance_rate: Math.round((present / total) * 100)
    };
}

// ─── Performance Metrics ──────────────────────────────────────

function getPerformanceMetrics() {
    if (responseTracker && typeof responseTracker.getMetrics === 'function') {
        const m = responseTracker.getMetrics();
        return {
            p50: m.p50 || 0,
            p95: m.p95 || 0,
            p99: m.p99 || 0,
            avg: m.avg || 0,
            rpm: m.rpm || 0,
            error_rate: m.errorRate || 0,
            total_requests: m.totalRequests || 0,
            slowest: m.slowest || []
        };
    }
    return null;
}

// ─── Top Issues ───────────────────────────────────────────────

async function getTopIssues() {
    const issues = [];

    // Check critical errors
    const criticalErrors = await safeQueryOne(
        `SELECT COUNT(*) as count FROM error_logs WHERE severity = 'critical' AND status = 'new'`
    );
    if (criticalErrors.count > 0) {
        issues.push({
            severity: 'critical',
            title: `${criticalErrors.count} Critical Error(s)`,
            description: 'Unresolved critical errors need attention',
            action: 'admin-system-health.html'
        });
    }

    // Check WhatsApp sessions
    const waSessions = await safeQuery(
        `SELECT phone_number, status FROM whatsapp_sessions WHERE status != 'connected'`
    );
    if (waSessions.length > 0) {
        issues.push({
            severity: 'warning',
            title: `${waSessions.length} WhatsApp Session(s) Disconnected`,
            description: waSessions.map(s => `${s.phone_number} (${s.status})`).join(', '),
            action: 'admin-whatsapp-sessions.html'
        });
    }

    // Check Zoho token expiry
    const zohoToken = await safeQueryOne(
        `SELECT expires_at FROM zoho_oauth_tokens ORDER BY updated_at DESC LIMIT 1`
    );
    if (zohoToken.expires_at) {
        const daysLeft = Math.round((new Date(zohoToken.expires_at) - new Date()) / 86400000);
        if (daysLeft <= 0) {
            issues.push({ severity: 'critical', title: 'Zoho Token Expired', description: 'OAuth token needs refresh', action: 'admin-settings.html' });
        } else if (daysLeft <= 7) {
            issues.push({ severity: 'warning', title: `Zoho Token Expires in ${daysLeft} Days`, description: 'Plan to refresh soon', action: 'admin-settings.html' });
        }
    }

    // Check open bug reports
    const openBugs = await safeQueryOne(
        `SELECT COUNT(*) as count FROM bug_reports WHERE status IN ('open', 'investigating') AND priority IN ('critical', 'high')`
    );
    if (openBugs.count > 0) {
        issues.push({
            severity: 'warning',
            title: `${openBugs.count} High-Priority Bug(s) Open`,
            description: 'Critical/high priority bugs need fixing',
            action: 'admin-bug-reports.html'
        });
    }

    // Check failed background jobs
    if (automationRegistry) {
        const failedJobs = automationRegistry.getAll().filter(j => j.status === 'failed');
        if (failedJobs.length > 0) {
            issues.push({
                severity: 'warning',
                title: `${failedJobs.length} Background Job(s) Failed`,
                description: failedJobs.map(j => j.name).join(', '),
                action: 'admin-system-health.html'
            });
        }
    }

    // Check memory
    const memPercent = Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100);
    if (memPercent > 90) {
        issues.push({ severity: 'critical', title: 'High Memory Usage', description: `${memPercent}% memory used`, action: null });
    } else if (memPercent > 80) {
        issues.push({ severity: 'warning', title: 'Elevated Memory Usage', description: `${memPercent}% memory used`, action: null });
    }

    // Sort: critical first
    issues.sort((a, b) => {
        const order = { critical: 0, warning: 1, info: 2 };
        return (order[a.severity] || 9) - (order[b.severity] || 9);
    });

    return issues;
}

// ─── GET /api/monitoring/errors ───────────────────────────────

router.get('/errors', async (req, res) => {
    try {
        const hours = parseInt(req.query.hours) || 24;
        const limit = Math.min(parseInt(req.query.limit) || 50, 200);
        const severity = req.query.severity;

        let query = `SELECT id, error_type, severity, error_message, request_url, request_method,
                            user_id, frequency_count, status, created_at
                     FROM error_logs
                     WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)`;
        const params = [hours];

        if (severity) {
            query += ' AND severity = ?';
            params.push(severity);
        }

        query += ' ORDER BY created_at DESC LIMIT ?';
        params.push(limit);

        const [rows] = await pool.query(query, params);
        res.json({ success: true, count: rows.length, data: rows });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ─── GET /api/monitoring/performance ──────────────────────────

router.get('/performance', async (req, res) => {
    try {
        const metrics = getPerformanceMetrics();

        // Get recent health snapshots
        const snapshots = await safeQuery(
            `SELECT memory_rss_mb, memory_heap_pct, api_p95_ms, api_rpm,
                    socket_connections, db_pool_used_pct, event_loop_lag_ms,
                    circuit_breaker_state, created_at
             FROM production_health_snapshots
             ORDER BY created_at DESC LIMIT 48`
        );

        res.json({ success: true, current: metrics, history: snapshots.reverse() });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ─── GET /api/monitoring/database/tables ──────────────────────

router.get('/database/tables', async (req, res) => {
    try {
        const [tables] = await pool.query(`
            SELECT table_name,
                   table_rows as row_count,
                   ROUND((data_length + index_length) / 1024 / 1024, 2) as size_mb,
                   ROUND(data_length / 1024 / 1024, 2) as data_mb,
                   ROUND(index_length / 1024 / 1024, 2) as index_mb,
                   update_time
            FROM information_schema.tables
            WHERE table_schema = DATABASE()
            ORDER BY (data_length + index_length) DESC
        `);

        res.json({ success: true, count: tables.length, data: tables });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// ─── GET /api/monitoring/usage ────────────────────────────────

router.get('/usage', async (req, res) => {
    try {
        const today = await safeQuery(`
            SELECT
                (SELECT COUNT(*) FROM staff_attendance WHERE date = CURDATE()) as attendance_actions,
                (SELECT COUNT(*) FROM leads WHERE DATE(created_at) = CURDATE()) as leads_created,
                (SELECT COUNT(*) FROM lead_followups WHERE DATE(created_at) = CURDATE()) as followups_done,
                (SELECT COUNT(*) FROM notifications WHERE DATE(created_at) = CURDATE()) as notifications_sent,
                (SELECT COUNT(*) FROM staff_activity_feed WHERE DATE(created_at) = CURDATE()) as activities_logged,
                (SELECT COUNT(*) FROM user_sessions WHERE DATE(last_activity) = CURDATE()) as active_sessions
        `);

        res.json({ success: true, today: today[0] || {} });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = { router, setPool, setAutomationRegistry, setResponseTracker, setProductionMonitor };
