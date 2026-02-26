/**
 * Production Monitor & Self-Healing Service
 * Continuously monitors system health and triggers automated recovery actions
 */

const os = require('os');

let pool = null;
let io = null;
let whatsappSessionManager = null;
let notificationService = null;
let responseTracker = null;
let monitorInterval = null;
let snapshotInterval = null;

function setPool(p) { pool = p; }
function setIO(socketIO) { io = socketIO; }
function setSessionManager(sm) { whatsappSessionManager = sm; }
function setNotificationService(ns) { notificationService = ns; }
function setResponseTracker(rt) { responseTracker = rt; }

// ─── Configuration ──────────────────────────────────────────

const DEFAULTS = {
    checkIntervalMs: 60000,          // Health check every 60s
    snapshotIntervalMs: 300000,      // Persist snapshot every 5 min
    memoryWarningMB: 512,             // Warn at 512MB RSS
    memoryCriticalMB: 768,            // Critical at 768MB RSS
    eventLoopLagWarnMs: 100,         // Warn if event loop lag > 100ms
    eventLoopLagCriticalMs: 500,     // Critical if > 500ms
    dbPoolWarnPct: 80,               // Warn if 80% of connections used
    maxStaleSessionHours: 72,        // Cleanup sessions older than 72h
    alertCooldownMinutes: 60,        // Don't re-alert same issue within 60 min
    maxHealingActionsPerHour: 10     // Safety cap on auto-healing
};

// ─── State ──────────────────────────────────────────────────

const state = {
    startedAt: Date.now(),
    lastCheck: null,
    lastSnapshot: null,
    healingActions: [],              // { action, timestamp, result }
    alertsSent: {},                  // { key: lastAlertTimestamp }
    consecutiveDbFailures: 0,
    circuitBreaker: {                // Zoho API circuit breaker
        state: 'closed',            // closed, open, half-open
        failures: 0,
        lastFailure: null,
        openedAt: null,
        threshold: 5,
        resetMs: 300000              // 5 min
    },
    metrics: {                       // Latest metrics snapshot
        memory: null,
        eventLoopLag: null,
        dbPool: null,
        responseTime: null,
        connections: 0,
        uptime: 0
    }
};

// ─── Event Loop Lag Measurement ─────────────────────────────

let lastLoopTime = Date.now();
let eventLoopLag = 0;

function measureEventLoopLag() {
    const now = Date.now();
    const expected = 1000;
    const actual = now - lastLoopTime;
    eventLoopLag = Math.max(0, actual - expected);
    lastLoopTime = now;
}

// ─── Health Checks ──────────────────────────────────────────

function checkMemory() {
    const mem = process.memoryUsage();
    const heapUsedMB = Math.round(mem.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(mem.heapTotal / 1024 / 1024);
    const rssMB = Math.round(mem.rss / 1024 / 1024);
    const heapPct = Math.round((mem.heapUsed / mem.heapTotal) * 100);
    const systemFreeMB = Math.round(os.freemem() / 1024 / 1024);
    const systemTotalMB = Math.round(os.totalmem() / 1024 / 1024);

    let status = 'healthy';
    if (rssMB >= DEFAULTS.memoryCriticalMB) status = 'critical';
    else if (rssMB >= DEFAULTS.memoryWarningMB) status = 'warning';

    return {
        status,
        heapUsedMB, heapTotalMB, rssMB, heapPct,
        systemFreeMB, systemTotalMB,
        systemUsedPct: Math.round(((systemTotalMB - systemFreeMB) / systemTotalMB) * 100)
    };
}

async function checkDbPool() {
    if (!pool) return { status: 'critical', message: 'No pool' };

    try {
        const start = Date.now();
        await pool.query('SELECT 1');
        const pingMs = Date.now() - start;

        // Get pool stats (mysql2 pool internals)
        const poolInternal = pool.pool || {};
        const allConnections = poolInternal._allConnections?.length || 0;
        const freeConnections = poolInternal._freeConnections?.length || 0;
        const queueLength = poolInternal._connectionQueue?.length || 0;
        const usedPct = allConnections > 0 ? Math.round(((allConnections - freeConnections) / 20) * 100) : 0;

        let status = 'healthy';
        if (queueLength > 5 || usedPct >= DEFAULTS.dbPoolWarnPct) status = 'warning';
        if (pingMs > 2000 || queueLength > 15) status = 'critical';

        state.consecutiveDbFailures = 0;
        return { status, pingMs, allConnections, freeConnections, queueLength, usedPct };
    } catch (err) {
        state.consecutiveDbFailures++;
        return { status: 'critical', error: err.message, consecutiveFailures: state.consecutiveDbFailures };
    }
}

function checkEventLoop() {
    let status = 'healthy';
    if (eventLoopLag >= DEFAULTS.eventLoopLagCriticalMs) status = 'critical';
    else if (eventLoopLag >= DEFAULTS.eventLoopLagWarnMs) status = 'warning';
    return { status, lagMs: eventLoopLag };
}

function getResponseTimeMetrics() {
    if (!responseTracker) return null;
    return responseTracker.getMetrics();
}

// ─── Self-Healing Actions ───────────────────────────────────

function recordHealingAction(action, result) {
    state.healingActions.push({
        action,
        result,
        timestamp: new Date().toISOString()
    });
    // Keep only last 100 actions
    if (state.healingActions.length > 100) state.healingActions.shift();
    console.log(`[Self-Heal] ${action}: ${result}`);
}

function getHealingCountLastHour() {
    const oneHourAgo = Date.now() - 3600000;
    return state.healingActions.filter(a => new Date(a.timestamp).getTime() > oneHourAgo).length;
}

function canHeal() {
    return getHealingCountLastHour() < DEFAULTS.maxHealingActionsPerHour;
}

async function healMemoryPressure(memMetrics) {
    if (!canHeal()) return;

    // Clear LRU caches in zoho.js
    try {
        const zohoRoutes = require('../routes/zoho');
        if (zohoRoutes.clearAllCaches) {
            zohoRoutes.clearAllCaches();
            recordHealingAction('clear_zoho_cache', 'LRU cache cleared');
        }
    } catch (e) { /* zoho routes may not export this */ }

    // Force garbage collection if available
    if (global.gc) {
        global.gc();
        recordHealingAction('force_gc', `Heap was ${memMetrics.heapPct}%`);
    } else {
        recordHealingAction('gc_unavailable', 'Run with --expose-gc for forced GC');
    }
}

async function healDbPool() {
    if (!canHeal()) return;

    if (state.consecutiveDbFailures >= 3) {
        try {
            // Attempt to recreate the pool
            const { createPool } = require('../config/database');
            const newPool = createPool();
            await newPool.query('SELECT 1');

            // If successful, we can't replace the global pool from here,
            // but we log the action for manual intervention
            await newPool.end();
            recordHealingAction('db_pool_test', 'New pool connection successful - consider restart');
        } catch (err) {
            recordHealingAction('db_pool_test_failed', err.message);
        }
    }
}

async function healStaleSessions() {
    if (!canHeal() || !pool) return;

    try {
        const [result] = await pool.query(
            `DELETE FROM user_sessions WHERE expires_at < DATE_SUB(NOW(), INTERVAL ? HOUR)`,
            [DEFAULTS.maxStaleSessionHours]
        );
        if (result.affectedRows > 0) {
            recordHealingAction('cleanup_stale_sessions', `Removed ${result.affectedRows} expired sessions`);
        }
    } catch (err) {
        // Non-critical, ignore
    }
}

// ─── Circuit Breaker ────────────────────────────────────────

function getCircuitState() { return state.circuitBreaker; }

function recordApiFailure() {
    const cb = state.circuitBreaker;
    cb.failures++;
    cb.lastFailure = Date.now();

    if (cb.failures >= cb.threshold && cb.state === 'closed') {
        cb.state = 'open';
        cb.openedAt = Date.now();
        recordHealingAction('circuit_breaker_open', `${cb.failures} consecutive Zoho API failures`);
    }
}

function recordApiSuccess() {
    const cb = state.circuitBreaker;
    if (cb.state === 'half-open') {
        cb.state = 'closed';
        cb.failures = 0;
        recordHealingAction('circuit_breaker_closed', 'API recovered');
    } else if (cb.state === 'closed') {
        cb.failures = Math.max(0, cb.failures - 1);
    }
}

function canCallApi() {
    const cb = state.circuitBreaker;
    if (cb.state === 'closed') return true;
    if (cb.state === 'open') {
        if (Date.now() - cb.openedAt >= cb.resetMs) {
            cb.state = 'half-open';
            return true;
        }
        return false;
    }
    return true; // half-open allows one request
}

// ─── Alert Dispatch ─────────────────────────────────────────

async function sendAlert(key, severity, title, message) {
    // Throttle check
    const now = Date.now();
    const cooldownMs = DEFAULTS.alertCooldownMinutes * 60000;
    if (state.alertsSent[key] && (now - state.alertsSent[key]) < cooldownMs) {
        return; // Throttled
    }
    state.alertsSent[key] = now;

    const alertMsg = `⚠️ [${severity.toUpperCase()}] ${title}\n${message}\n\nTime: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`;

    // Send WhatsApp alert to admin
    if (whatsappSessionManager && severity === 'critical') {
        try {
            const [admins] = await pool.query(
                `SELECT phone FROM users WHERE role = 'admin' AND status = 'active' AND phone IS NOT NULL LIMIT 3`
            );
            for (const admin of admins) {
                await whatsappSessionManager.sendMessage(0, admin.phone, alertMsg, { source: 'production_alert' });
            }
        } catch (err) {
            console.error('[Monitor] WhatsApp alert error:', err.message);
        }
    }

    // Send in-app notification to all admins
    if (notificationService && pool) {
        try {
            const [admins] = await pool.query(
                `SELECT id FROM users WHERE role IN ('admin', 'manager') AND status = 'active' LIMIT 10`
            );
            for (const admin of admins) {
                await notificationService.send(admin.id, {
                    type: 'system_alert',
                    title: `[${severity}] ${title}`,
                    body: message,
                    data: { severity, key }
                });
            }
        } catch (err) {
            console.error('[Monitor] Notification alert error:', err.message);
        }
    }

    // Emit via Socket.io
    if (io) {
        io.to('live_dashboard_admin').emit('system_alert', { severity, title, message, timestamp: new Date().toISOString() });
    }
}

// ─── Main Monitor Loop ──────────────────────────────────────

async function runCheck() {
    try {
        const memory = checkMemory();
        const dbPool = await checkDbPool();
        const eventLoop = checkEventLoop();
        const responseTime = getResponseTimeMetrics();

        state.metrics = {
            memory,
            eventLoopLag: eventLoop,
            dbPool,
            responseTime,
            connections: io ? io.engine?.clientsCount || 0 : 0,
            uptime: Math.round((Date.now() - state.startedAt) / 1000)
        };
        state.lastCheck = new Date().toISOString();

        // ── Self-Healing Triggers ──

        // Memory pressure
        if (memory.status === 'critical') {
            await healMemoryPressure(memory);
            await sendAlert('memory_critical', 'critical', 'Memory Critical',
                `Heap usage at ${memory.heapPct}% (${memory.heapUsedMB}MB/${memory.heapTotalMB}MB). RSS: ${memory.rssMB}MB.`);
        } else if (memory.status === 'warning') {
            await sendAlert('memory_warning', 'high', 'Memory Warning',
                `Heap usage at ${memory.heapPct}%. Consider monitoring.`);
        }

        // DB pool issues
        if (dbPool.status === 'critical') {
            await healDbPool();
            await sendAlert('db_critical', 'critical', 'Database Connection Failed',
                `${dbPool.error || 'Pool exhausted'}. Consecutive failures: ${state.consecutiveDbFailures}.`);
        }

        // Event loop lag
        if (eventLoop.status === 'critical') {
            await sendAlert('event_loop_critical', 'critical', 'Event Loop Blocked',
                `Event loop lag: ${eventLoop.lagMs}ms. Server may be unresponsive.`);
        }

        // Slow API responses
        if (responseTime && responseTime.p95 > 5000) {
            await sendAlert('slow_api', 'high', 'Slow API Responses',
                `P95 response time: ${responseTime.p95}ms, P99: ${responseTime.p99}ms. Slow endpoints: ${(responseTime.slowest || []).map(s => s.path).join(', ')}`);
        }

        // Periodic stale session cleanup (every 10th check = ~10 min)
        if (Math.random() < 0.1) {
            await healStaleSessions();
        }

    } catch (err) {
        console.error('[Monitor] Check error:', err.message);
    }
}

// ─── Snapshot Persistence ───────────────────────────────────

async function persistSnapshot() {
    if (!pool || !state.metrics.memory) return;

    try {
        await pool.query(
            `INSERT INTO production_health_snapshots
             (memory_heap_mb, memory_heap_pct, memory_rss_mb, event_loop_lag_ms,
              db_pool_used_pct, db_ping_ms, db_queue_length,
              api_p50_ms, api_p95_ms, api_p99_ms, api_rpm,
              socket_connections, uptime_seconds, healing_actions_1h, circuit_breaker_state)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                state.metrics.memory.heapUsedMB,
                state.metrics.memory.heapPct,
                state.metrics.memory.rssMB,
                state.metrics.eventLoopLag?.lagMs || 0,
                state.metrics.dbPool?.usedPct || 0,
                state.metrics.dbPool?.pingMs || 0,
                state.metrics.dbPool?.queueLength || 0,
                state.metrics.responseTime?.p50 || 0,
                state.metrics.responseTime?.p95 || 0,
                state.metrics.responseTime?.p99 || 0,
                state.metrics.responseTime?.rpm || 0,
                state.metrics.connections,
                state.metrics.uptime,
                getHealingCountLastHour(),
                state.circuitBreaker.state
            ]
        );
        state.lastSnapshot = new Date().toISOString();

        // Cleanup old snapshots (keep 7 days)
        await pool.query(
            `DELETE FROM production_health_snapshots WHERE created_at < DATE_SUB(NOW(), INTERVAL 7 DAY)`
        );
    } catch (err) {
        // Table might not exist yet, ignore
        if (err.code !== 'ER_NO_SUCH_TABLE') {
            console.error('[Monitor] Snapshot error:', err.message);
        }
    }
}

// ─── Public API ─────────────────────────────────────────────

function getStatus() {
    return {
        monitoring: !!monitorInterval,
        lastCheck: state.lastCheck,
        lastSnapshot: state.lastSnapshot,
        uptime: Math.round((Date.now() - state.startedAt) / 1000),
        metrics: state.metrics,
        circuitBreaker: {
            state: state.circuitBreaker.state,
            failures: state.circuitBreaker.failures
        },
        healingActions: state.healingActions.slice(-20),
        healingCountLastHour: getHealingCountLastHour()
    };
}

function getMetricsHistory() {
    // Will be fetched from DB by the route
    return state.metrics;
}

function start() {
    if (monitorInterval) return;

    // Event loop lag timer
    setInterval(measureEventLoopLag, 1000);

    // Main health check loop
    monitorInterval = setInterval(runCheck, DEFAULTS.checkIntervalMs);

    // Snapshot persistence loop
    snapshotInterval = setInterval(persistSnapshot, DEFAULTS.snapshotIntervalMs);

    // Run first check after 10s (let server settle)
    setTimeout(runCheck, 10000);

    console.log('[Monitor] Production monitor started (check: 60s, snapshot: 5min)');
}

function stop() {
    if (monitorInterval) { clearInterval(monitorInterval); monitorInterval = null; }
    if (snapshotInterval) { clearInterval(snapshotInterval); snapshotInterval = null; }
}

module.exports = {
    setPool,
    setIO,
    setSessionManager,
    setNotificationService,
    setResponseTracker,
    start,
    stop,
    getStatus,
    getMetricsHistory,
    getCircuitState,
    canCallApi,
    recordApiFailure,
    recordApiSuccess,
    // Exported for testing
    checkMemory,
    checkEventLoop,
    DEFAULTS
};
