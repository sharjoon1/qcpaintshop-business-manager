/**
 * Response Time Tracking Middleware
 * Measures API response times and tracks slow endpoints
 * Uses in-memory ring buffer for dashboard metrics
 */

const BUFFER_SIZE = 1000;  // Keep last 1000 requests
const SLOW_THRESHOLD_MS = 3000;

// Ring buffer for response times
const buffer = [];
let bufferIndex = 0;
const slowEndpoints = {};  // { path: { count, totalMs, maxMs } }
let requestCount = 0;
let lastResetTime = Date.now();

/**
 * Express middleware - attach to app.use()
 */
function middleware(req, res, next) {
    // Skip static files and health checks
    if (!req.path.startsWith('/api/')) return next();

    const start = process.hrtime.bigint();

    // Hook into response finish
    const originalEnd = res.end;
    res.end = function(...args) {
        const duration = Number(process.hrtime.bigint() - start) / 1e6; // ms

        recordRequest({
            path: req.route ? req.route.path : req.path,
            method: req.method,
            statusCode: res.statusCode,
            durationMs: Math.round(duration * 100) / 100,
            timestamp: Date.now()
        });

        originalEnd.apply(res, args);
    };

    next();
}

function recordRequest(entry) {
    // Ring buffer insert
    buffer[bufferIndex % BUFFER_SIZE] = entry;
    bufferIndex++;
    requestCount++;

    // Track slow endpoints
    if (entry.durationMs >= SLOW_THRESHOLD_MS) {
        const key = `${entry.method} ${entry.path}`;
        if (!slowEndpoints[key]) {
            slowEndpoints[key] = { count: 0, totalMs: 0, maxMs: 0 };
        }
        slowEndpoints[key].count++;
        slowEndpoints[key].totalMs += entry.durationMs;
        slowEndpoints[key].maxMs = Math.max(slowEndpoints[key].maxMs, entry.durationMs);
    }
}

/**
 * Get current metrics summary
 */
function getMetrics() {
    const now = Date.now();
    const activeEntries = buffer.filter(e => e && (now - e.timestamp) < 300000); // Last 5 min

    if (activeEntries.length === 0) {
        return {
            p50: 0, p95: 0, p99: 0, avg: 0,
            rpm: 0, totalRequests: requestCount,
            errorRate: 0, slowest: []
        };
    }

    // Sort durations for percentile calculation
    const durations = activeEntries.map(e => e.durationMs).sort((a, b) => a - b);
    const len = durations.length;

    // Calculate percentiles
    const p50 = durations[Math.floor(len * 0.5)] || 0;
    const p95 = durations[Math.floor(len * 0.95)] || 0;
    const p99 = durations[Math.floor(len * 0.99)] || 0;
    const avg = Math.round(durations.reduce((a, b) => a + b, 0) / len);

    // Error rate (5xx responses)
    const errors = activeEntries.filter(e => e.statusCode >= 500).length;
    const errorRate = Math.round((errors / len) * 10000) / 100; // 2 decimal %

    // RPM (requests per minute over last 5 min window)
    const elapsedMin = Math.max(1, (now - (activeEntries[0]?.timestamp || now)) / 60000);
    const rpm = Math.round(len / elapsedMin);

    // Top 5 slowest endpoint patterns
    const slowest = Object.entries(slowEndpoints)
        .map(([path, data]) => ({ path, ...data, avgMs: Math.round(data.totalMs / data.count) }))
        .sort((a, b) => b.maxMs - a.maxMs)
        .slice(0, 5);

    // Status code breakdown
    const statusBreakdown = {};
    for (const e of activeEntries) {
        const group = `${Math.floor(e.statusCode / 100)}xx`;
        statusBreakdown[group] = (statusBreakdown[group] || 0) + 1;
    }

    return {
        p50: Math.round(p50),
        p95: Math.round(p95),
        p99: Math.round(p99),
        avg,
        rpm,
        totalRequests: requestCount,
        activeWindow: len,
        errorRate,
        statusBreakdown,
        slowest
    };
}

/**
 * Reset counters (for testing or periodic cleanup)
 */
function reset() {
    buffer.length = 0;
    bufferIndex = 0;
    requestCount = 0;
    lastResetTime = Date.now();
    Object.keys(slowEndpoints).forEach(k => delete slowEndpoints[k]);
}

module.exports = {
    middleware,
    getMetrics,
    reset,
    recordRequest,
    BUFFER_SIZE,
    SLOW_THRESHOLD_MS
};
