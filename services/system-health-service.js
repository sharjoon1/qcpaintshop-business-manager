/**
 * System Health Service
 * Database, memory, disk, API, and external service monitoring
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

let pool = null;
function setPool(p) { pool = p; }

let healthCheckInterval = null;

// ─── Comprehensive Health Check ───────────────────────────────

async function performHealthCheck() {
    const results = {};
    const startTime = Date.now();

    // 1. Database check
    results.database = await checkDatabase();

    // 2. Memory check
    results.memory = checkMemory();

    // 3. Disk space check
    results.diskSpace = await checkDiskSpace();

    // 4. File system check
    results.fileSystem = checkFileSystem();

    // 5. External services check
    results.externalServices = await checkExternalServices();

    // Overall status
    const allStatuses = Object.values(results).map(r => r.status);
    let overallStatus = 'healthy';
    if (allStatuses.includes('critical')) overallStatus = 'critical';
    else if (allStatuses.includes('warning')) overallStatus = 'warning';

    const report = {
        status: overallStatus,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        uptimeFormatted: formatUptime(process.uptime()),
        totalCheckTimeMs: Date.now() - startTime,
        checks: results
    };

    // Save to DB
    if (pool) {
        for (const [checkType, result] of Object.entries(results)) {
            const dbType = checkType === 'diskSpace' ? 'disk_space'
                : checkType === 'fileSystem' ? 'file_system'
                : checkType === 'externalServices' ? 'external_services'
                : checkType;
            try {
                await pool.query(`
                    INSERT INTO system_health_checks (check_type, status, details, response_time_ms)
                    VALUES (?, ?, ?, ?)
                `, [dbType, result.status, JSON.stringify(result), result.responseTimeMs || 0]);
            } catch (e) { /* don't break health check if logging fails */ }
        }
    }

    return report;
}

// ─── Database Health ──────────────────────────────────────────

async function checkDatabase() {
    const start = Date.now();
    try {
        if (!pool) return { status: 'critical', message: 'No database pool', responseTimeMs: 0 };

        // Basic connectivity
        const [pingResult] = await pool.query('SELECT 1 as alive');

        // Connection pool stats
        const poolInfo = pool.pool || {};
        const activeConnections = poolInfo._allConnections?.length || 0;
        const freeConnections = poolInfo._freeConnections?.length || 0;
        const queuedRequests = poolInfo._connectionQueue?.length || 0;

        // Table counts
        const [tables] = await pool.query(`
            SELECT COUNT(*) as table_count FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = DATABASE()
        `);

        // DB size
        const [sizeResult] = await pool.query(`
            SELECT ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS size_mb
            FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()
        `);

        const responseTimeMs = Date.now() - start;
        let status = 'healthy';
        if (responseTimeMs > 2000) status = 'critical';
        else if (responseTimeMs > 500) status = 'warning';
        if (queuedRequests > 5) status = 'warning';
        if (queuedRequests > 15) status = 'critical';

        return {
            status,
            responseTimeMs,
            connected: true,
            tables: tables[0].table_count,
            sizeMb: sizeResult[0].size_mb || 0,
            connections: { active: activeConnections, free: freeConnections, queued: queuedRequests }
        };
    } catch (err) {
        return { status: 'critical', responseTimeMs: Date.now() - start, connected: false, error: err.message };
    }
}

// ─── Memory Health ────────────────────────────────────────────

function checkMemory() {
    const used = process.memoryUsage();
    const totalSystem = os.totalmem();
    const freeSystem = os.freemem();
    const usedSystem = totalSystem - freeSystem;
    const usedPct = Math.round((usedSystem / totalSystem) * 100);

    const heapUsedMb = Math.round(used.heapUsed / 1024 / 1024);
    const heapTotalMb = Math.round(used.heapTotal / 1024 / 1024);
    const rssMb = Math.round(used.rss / 1024 / 1024);

    let status = 'healthy';
    if (heapUsedMb > 500 || usedPct > 90) status = 'critical';
    else if (heapUsedMb > 300 || usedPct > 80) status = 'warning';

    return {
        status,
        process: {
            heapUsedMb,
            heapTotalMb,
            rssMb,
            externalMb: Math.round(used.external / 1024 / 1024)
        },
        system: {
            totalMb: Math.round(totalSystem / 1024 / 1024),
            freeMb: Math.round(freeSystem / 1024 / 1024),
            usedPct
        }
    };
}

// ─── Disk Space ───────────────────────────────────────────────

async function checkDiskSpace() {
    try {
        // Check uploads directory size
        const uploadsDir = path.join(__dirname, '..', 'public', 'uploads');
        let uploadsSizeMb = 0;
        if (fs.existsSync(uploadsDir)) {
            uploadsSizeMb = getDirSizeMb(uploadsDir);
        }

        let status = 'healthy';
        if (uploadsSizeMb > 5000) status = 'critical';
        else if (uploadsSizeMb > 2000) status = 'warning';

        return {
            status,
            uploadsSizeMb: Math.round(uploadsSizeMb * 100) / 100
        };
    } catch (err) {
        return { status: 'warning', error: err.message };
    }
}

function getDirSizeMb(dirPath) {
    let totalSize = 0;
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                totalSize += getDirSizeMb(fullPath);
            } else {
                try { totalSize += fs.statSync(fullPath).size; } catch (e) {}
            }
        }
    } catch (e) {}
    return totalSize / 1024 / 1024;
}

// ─── File System ──────────────────────────────────────────────

function checkFileSystem() {
    const requiredDirs = [
        'public/uploads/logos',
        'public/uploads/profiles',
        'public/uploads/attendance/clock-in',
        'public/uploads/attendance/clock-out',
        'public/uploads/documents',
        'uploads/attendance/break',
        'uploads/stock-check'
    ];

    const issues = [];
    const baseDir = path.join(__dirname, '..');

    for (const dir of requiredDirs) {
        const fullPath = path.join(baseDir, dir);
        if (!fs.existsSync(fullPath)) {
            issues.push({ dir, issue: 'missing' });
        } else {
            try {
                fs.accessSync(fullPath, fs.constants.W_OK);
            } catch (e) {
                issues.push({ dir, issue: 'not_writable' });
            }
        }
    }

    // Check key files
    const requiredFiles = ['server.js', '.env', 'package.json'];
    for (const file of requiredFiles) {
        if (!fs.existsSync(path.join(baseDir, file))) {
            issues.push({ file, issue: 'missing' });
        }
    }

    return {
        status: issues.length > 0 ? 'warning' : 'healthy',
        issueCount: issues.length,
        issues: issues.length > 0 ? issues : undefined
    };
}

// ─── External Services ────────────────────────────────────────

async function checkExternalServices() {
    const services = [];

    // Zoho check (has org ID configured?)
    services.push({
        name: 'Zoho Books',
        configured: !!process.env.ZOHO_ORGANIZATION_ID,
        status: process.env.ZOHO_ORGANIZATION_ID ? 'healthy' : 'warning'
    });

    // WhatsApp (session manager)
    services.push({
        name: 'WhatsApp',
        configured: true,
        status: 'healthy'
    });

    // AI Providers
    services.push({
        name: 'Gemini AI',
        configured: !!process.env.GEMINI_API_KEY,
        status: process.env.GEMINI_API_KEY ? 'healthy' : 'warning'
    });

    services.push({
        name: 'Claude AI',
        configured: !!process.env.ANTHROPIC_API_KEY,
        status: process.env.ANTHROPIC_API_KEY ? 'healthy' : 'warning'
    });

    // Email
    services.push({
        name: 'Email (SMTP)',
        configured: !!process.env.EMAIL_HOST,
        status: process.env.EMAIL_HOST ? 'healthy' : 'warning'
    });

    const anyDown = services.some(s => s.status === 'critical');
    const anyWarn = services.some(s => s.status === 'warning');

    return {
        status: anyDown ? 'critical' : anyWarn ? 'warning' : 'healthy',
        services
    };
}

// ─── Database Integrity Check ─────────────────────────────────

async function checkDatabaseIntegrity() {
    if (!pool) return { status: 'critical', message: 'No database pool' };

    const issues = [];

    try {
        // Check for orphaned records in key tables
        const orphanChecks = [
            { name: 'leads_assigned_user', query: `SELECT COUNT(*) as c FROM leads l LEFT JOIN users u ON l.assigned_to = u.id WHERE l.assigned_to IS NOT NULL AND u.id IS NULL` },
            { name: 'lead_followups_lead', query: `SELECT COUNT(*) as c FROM lead_followups lf LEFT JOIN leads l ON lf.lead_id = l.id WHERE l.id IS NULL` },
            { name: 'user_sessions_user', query: `SELECT COUNT(*) as c FROM user_sessions us LEFT JOIN users u ON us.user_id = u.id WHERE u.id IS NULL` },
            { name: 'staff_attendance_user', query: `SELECT COUNT(*) as c FROM staff_attendance sa LEFT JOIN users u ON sa.user_id = u.id WHERE u.id IS NULL` },
            { name: 'ai_lead_scores_lead', query: `SELECT COUNT(*) as c FROM ai_lead_scores als LEFT JOIN leads l ON als.lead_id = l.id WHERE l.id IS NULL` }
        ];

        for (const check of orphanChecks) {
            try {
                const [result] = await pool.query(check.query);
                if (result[0].c > 0) {
                    issues.push({
                        type: 'orphaned_records',
                        table: check.name,
                        count: result[0].c,
                        severity: result[0].c > 100 ? 'high' : 'medium'
                    });
                }
            } catch (e) {
                // Table might not exist, skip
            }
        }

        // Check for NULL required fields
        const nullChecks = [
            { name: 'users_no_email', query: `SELECT COUNT(*) as c FROM users WHERE email IS NULL OR email = ''` },
            { name: 'branches_no_name', query: `SELECT COUNT(*) as c FROM branches WHERE name IS NULL OR name = ''` },
            { name: 'leads_no_name', query: `SELECT COUNT(*) as c FROM leads WHERE name IS NULL OR name = ''` }
        ];

        for (const check of nullChecks) {
            try {
                const [result] = await pool.query(check.query);
                if (result[0].c > 0) {
                    issues.push({
                        type: 'missing_data',
                        table: check.name,
                        count: result[0].c,
                        severity: 'low'
                    });
                }
            } catch (e) {}
        }

        // Check expired sessions that haven't been cleaned
        try {
            const [expired] = await pool.query(`SELECT COUNT(*) as c FROM user_sessions WHERE expires_at < NOW()`);
            if (expired[0].c > 1000) {
                issues.push({ type: 'stale_data', table: 'user_sessions', count: expired[0].c, severity: 'low' });
            }
        } catch (e) {}

        return {
            status: issues.some(i => i.severity === 'high') ? 'warning' : 'healthy',
            totalIssues: issues.length,
            issues
        };
    } catch (err) {
        return { status: 'critical', error: err.message, issues };
    }
}

// ─── Auto Health Check Scheduler ──────────────────────────────

function startAutoHealthChecks(intervalMs = 300000) {
    if (healthCheckInterval) clearInterval(healthCheckInterval);

    healthCheckInterval = setInterval(async () => {
        try {
            const report = await performHealthCheck();
            if (report.status === 'critical') {
                console.error('[Health Check] CRITICAL status detected:', JSON.stringify(report.checks));
            }
        } catch (err) {
            console.error('[Health Check] Auto-check failed:', err.message);
        }
    }, intervalMs);

    console.log(`[Health Check] Auto health checks started (every ${intervalMs / 1000}s)`);
}

function stopAutoHealthChecks() {
    if (healthCheckInterval) {
        clearInterval(healthCheckInterval);
        healthCheckInterval = null;
    }
}

// ─── Helpers ──────────────────────────────────────────────────

function formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    parts.push(`${m}m`);
    return parts.join(' ');
}

module.exports = {
    setPool,
    performHealthCheck,
    checkDatabase,
    checkMemory,
    checkDiskSpace,
    checkFileSystem,
    checkExternalServices,
    checkDatabaseIntegrity,
    startAutoHealthChecks,
    stopAutoHealthChecks
};
