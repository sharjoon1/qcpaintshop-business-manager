/**
 * ZOHO API RATE LIMITER + USAGE TRACKER
 * Token bucket rate limiter for Zoho Books API (100 req/min limit)
 * Uses 80 req/min safe limit to avoid hitting the wall
 *
 * Also tracks daily API usage (Zoho's 10,000/org/day limit)
 * and provides usage stats for the API Usage Monitor.
 *
 * KEY FIX: All API calls now go through this limiter via apiGet/apiPost/apiPut/apiDelete
 * so 100% of calls are tracked. Daily count is persisted to DB to survive restarts.
 *
 * Usage:
 *   const rateLimiter = require('./zoho-rate-limiter');
 *   rateLimiter.setPool(pool); // Required for DB persistence
 *   await rateLimiter.acquire('callerName');
 *   // make API call
 */

class ZohoRateLimiter {
    constructor(maxRequests = 80, windowMs = 60000) {
        this.maxRequests = maxRequests;
        this.windowMs = windowMs;
        this.tokens = maxRequests;
        this.lastRefill = Date.now();
        this.queue = [];
        this.refillInterval = null;

        // === Database pool for persistence ===
        this.pool = null;

        // === Daily Quota Tracking ===
        this.dailyLimit = 10000;
        this.dailyUsed = 0;
        this.dailyDate = this._todayStr();
        this.dailyPaused = false;
        this.dailyReserve = 500; // Reserve 500 calls for manual/urgent operations

        // === API Call Log (rolling window for monitoring) ===
        this.callLog = [];          // { timestamp, caller, endpoint, method }
        this.maxLogEntries = 2000;  // Keep last 2000 entries

        // === Per-caller usage tracking ===
        this.callerUsage = {};      // { callerName: { count, lastCall } }

        // === Sync lock: prevent overlapping heavy operations ===
        this.activeSyncOp = null;   // Name of currently running sync operation
        this.activeSyncStart = null;

        // === DB Persistence ===
        this.persistCounter = 0;    // Calls since last DB persist
        this.persistInterval = 25;  // Persist to DB every N calls
        this.isPersisting = false;  // Prevent concurrent persists

        // === Alert thresholds (percentage of dailyLimit) ===
        this.alertThresholds = [80, 90, 95];
        this.alertsTriggered = {};  // { 80: false, 90: false, 95: false }
        this._resetAlerts();

        // === Circuit breaker for non-critical operations ===
        this.circuitBreakerThreshold = 9000; // Stop non-critical at 90%
    }

    /**
     * Set database pool for persisting daily counts across restarts
     */
    setPool(dbPool) {
        this.pool = dbPool;
        this._loadDailyFromDB().catch(err => {
            console.error('[RateLimiter] Failed to load daily count from DB:', err.message);
        });
    }

    _todayStr() {
        // Use IST (Asia/Kolkata) for date to match Zoho's India datacenter
        return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    }

    _resetAlerts() {
        this.alertsTriggered = {};
        for (const threshold of this.alertThresholds) {
            this.alertsTriggered[threshold] = false;
        }
    }

    _resetDailyIfNeeded() {
        const today = this._todayStr();
        if (today !== this.dailyDate) {
            console.log(`[RateLimiter] New day detected (${today}). Previous day ${this.dailyDate}: ${this.dailyUsed} API calls used.`);
            this.dailyUsed = 0;
            this.dailyDate = today;
            this.dailyPaused = false;
            this.callerUsage = {};
            this.callLog = [];
            this._resetAlerts();
            // Persist the reset
            this._persistDailyToDB().catch(() => {});
        }
    }

    _refill() {
        const now = Date.now();
        const elapsed = now - this.lastRefill;
        const tokensToAdd = Math.floor((elapsed / this.windowMs) * this.maxRequests);
        if (tokensToAdd > 0) {
            this.tokens = Math.min(this.maxRequests, this.tokens + tokensToAdd);
            this.lastRefill = now;
        }
    }

    _processQueue() {
        this._refill();
        while (this.queue.length > 0 && this.tokens > 0) {
            this.tokens--;
            const { resolve, caller } = this.queue.shift();
            this._recordCall(caller);
            resolve();
        }
    }

    _recordCall(caller) {
        this._resetDailyIfNeeded();
        this.dailyUsed++;

        const now = Date.now();
        const callerName = caller || 'unknown';

        // Update caller usage
        if (!this.callerUsage[callerName]) {
            this.callerUsage[callerName] = { count: 0, lastCall: now };
        }
        this.callerUsage[callerName].count++;
        this.callerUsage[callerName].lastCall = now;

        // Add to call log
        this.callLog.push({
            timestamp: now,
            caller: callerName
        });

        // Trim log if too large
        if (this.callLog.length > this.maxLogEntries) {
            this.callLog = this.callLog.slice(-this.maxLogEntries);
        }

        // Auto-pause if approaching daily limit
        if (this.dailyUsed >= (this.dailyLimit - this.dailyReserve)) {
            this.dailyPaused = true;
            console.warn(`[RateLimiter] DAILY QUOTA WARNING: ${this.dailyUsed}/${this.dailyLimit} used. Pausing non-essential operations.`);
        }

        // Check alert thresholds
        this._checkAlerts();

        // Persist to DB periodically
        this.persistCounter++;
        if (this.persistCounter >= this.persistInterval) {
            this.persistCounter = 0;
            this._persistDailyToDB().catch(() => {});
        }
    }

    /**
     * Check and log alert thresholds
     */
    _checkAlerts() {
        const percentage = (this.dailyUsed / this.dailyLimit) * 100;

        for (const threshold of this.alertThresholds) {
            if (percentage >= threshold && !this.alertsTriggered[threshold]) {
                this.alertsTriggered[threshold] = true;
                const level = threshold >= 95 ? 'CRITICAL' : threshold >= 90 ? 'HIGH' : 'WARNING';
                console.warn(`[RateLimiter] ${level} - API usage at ${threshold}%: ${this.dailyUsed}/${this.dailyLimit} calls used today`);
            }
        }
    }

    // === DATABASE PERSISTENCE ===

    /**
     * Load today's API call count from DB (called on startup)
     */
    async _loadDailyFromDB() {
        if (!this.pool) return;

        try {
            const [rows] = await this.pool.query(
                `SELECT config_key, config_value FROM zoho_config WHERE config_key IN ('api_daily_count', 'api_daily_date', 'api_daily_callers')`
            );

            const config = {};
            for (const row of rows) {
                config[row.config_key] = row.config_value;
            }

            const savedDate = config.api_daily_date;
            const today = this._todayStr();

            if (savedDate === today) {
                // Same day - restore the count
                const savedCount = parseInt(config.api_daily_count) || 0;
                if (savedCount > this.dailyUsed) {
                    this.dailyUsed = savedCount;
                    console.log(`[RateLimiter] Restored daily count from DB: ${this.dailyUsed} calls for ${today}`);
                }

                // Restore caller breakdown
                if (config.api_daily_callers) {
                    try {
                        const savedCallers = JSON.parse(config.api_daily_callers);
                        // Merge: take the max of saved vs in-memory for each caller
                        for (const [name, data] of Object.entries(savedCallers)) {
                            if (!this.callerUsage[name] || this.callerUsage[name].count < data.count) {
                                this.callerUsage[name] = data;
                            }
                        }
                    } catch (e) {
                        // Ignore parse errors
                    }
                }

                // Re-check alerts based on restored count
                this._checkAlerts();
                if (this.dailyUsed >= (this.dailyLimit - this.dailyReserve)) {
                    this.dailyPaused = true;
                }
            } else {
                console.log(`[RateLimiter] New day - starting fresh count for ${today}`);
            }
        } catch (err) {
            console.error('[RateLimiter] DB load error:', err.message);
        }
    }

    /**
     * Persist daily count to DB (called periodically)
     */
    async _persistDailyToDB() {
        if (!this.pool || this.isPersisting) return;
        this.isPersisting = true;

        try {
            const entries = [
                ['api_daily_count', String(this.dailyUsed)],
                ['api_daily_date', this.dailyDate],
                ['api_daily_callers', JSON.stringify(this.callerUsage)]
            ];

            for (const [key, value] of entries) {
                await this.pool.query(
                    `INSERT INTO zoho_config (config_key, config_value) VALUES (?, ?)
                     ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
                    [key, value]
                );
            }
        } catch (err) {
            // Silently fail - in-memory tracking still works
            // This might fail if zoho_config doesn't have a unique key on config_key
            // In that case, try UPDATE-only approach
            try {
                await this.pool.query(
                    `UPDATE zoho_config SET config_value = ? WHERE config_key = 'api_daily_count'`,
                    [String(this.dailyUsed)]
                );
                await this.pool.query(
                    `UPDATE zoho_config SET config_value = ? WHERE config_key = 'api_daily_date'`,
                    [this.dailyDate]
                );
                await this.pool.query(
                    `UPDATE zoho_config SET config_value = ? WHERE config_key = 'api_daily_callers'`,
                    [JSON.stringify(this.callerUsage)]
                );
            } catch (e2) {
                // Both approaches failed - log once
            }
        } finally {
            this.isPersisting = false;
        }
    }

    /**
     * Acquire a token to make an API call.
     * @param {string} caller - Identifier for the caller (e.g., 'GET /invoices', 'syncItems')
     * @param {object} options - { priority: 'high'|'normal', skipDailyCheck: false }
     */
    acquire(caller = 'unknown', options = {}) {
        this._resetDailyIfNeeded();

        // Check daily quota (high priority callers can use the reserve)
        const effectiveLimit = options.priority === 'high'
            ? this.dailyLimit
            : (this.dailyLimit - this.dailyReserve);

        if (this.dailyUsed >= effectiveLimit && !options.skipDailyCheck) {
            return Promise.reject(new Error(
                `Zoho API daily quota exhausted: ${this.dailyUsed}/${this.dailyLimit} calls used today. ` +
                `Remaining calls reserved for critical operations.`
            ));
        }

        return new Promise((resolve) => {
            this._refill();
            if (this.tokens > 0) {
                this.tokens--;
                this._recordCall(caller);
                resolve();
            } else {
                this.queue.push({ resolve, caller });
                if (!this.refillInterval) {
                    this.refillInterval = setInterval(() => {
                        this._processQueue();
                        if (this.queue.length === 0) {
                            clearInterval(this.refillInterval);
                            this.refillInterval = null;
                        }
                    }, Math.ceil(this.windowMs / this.maxRequests));
                }
            }
        });
    }

    /**
     * Check if a non-critical operation should be allowed (circuit breaker)
     * Returns false if daily usage exceeds the circuit breaker threshold
     */
    isCircuitOpen() {
        this._resetDailyIfNeeded();
        return this.dailyUsed >= this.circuitBreakerThreshold;
    }

    // === SYNC LOCK: Prevent overlapping heavy operations ===

    /**
     * Try to acquire the sync lock for a heavy operation.
     * Returns true if lock acquired, false if another op is running.
     */
    tryAcquireSyncLock(operationName) {
        // Auto-release stale locks (older than 30 minutes)
        if (this.activeSyncOp && this.activeSyncStart) {
            const elapsed = Date.now() - this.activeSyncStart;
            if (elapsed > 30 * 60 * 1000) {
                console.warn(`[RateLimiter] Releasing stale sync lock: ${this.activeSyncOp} (${Math.round(elapsed/60000)}min old)`);
                this.activeSyncOp = null;
                this.activeSyncStart = null;
            }
        }

        if (this.activeSyncOp) {
            return false;
        }

        this.activeSyncOp = operationName;
        this.activeSyncStart = Date.now();
        return true;
    }

    releaseSyncLock(operationName) {
        if (this.activeSyncOp === operationName) {
            this.activeSyncOp = null;
            this.activeSyncStart = null;
        }
    }

    getSyncLockStatus() {
        return {
            locked: this.activeSyncOp !== null,
            operation: this.activeSyncOp,
            started: this.activeSyncStart,
            duration_ms: this.activeSyncStart ? (Date.now() - this.activeSyncStart) : 0
        };
    }

    // === STATUS & MONITORING ===

    getStatus() {
        this._refill();
        this._resetDailyIfNeeded();
        return {
            available_tokens: this.tokens,
            max_requests_per_min: this.maxRequests,
            queued: this.queue.length,
            window_ms: this.windowMs,
            daily_used: this.dailyUsed,
            daily_limit: this.dailyLimit,
            daily_remaining: Math.max(0, this.dailyLimit - this.dailyUsed),
            daily_paused: this.dailyPaused,
            daily_date: this.dailyDate,
            daily_percentage: Math.round((this.dailyUsed / this.dailyLimit) * 100),
            circuit_breaker_open: this.isCircuitOpen(),
            alerts_triggered: { ...this.alertsTriggered },
            sync_lock: this.getSyncLockStatus()
        };
    }

    /**
     * Get detailed usage stats for the API Usage Monitor
     */
    getUsageStats() {
        this._resetDailyIfNeeded();
        const now = Date.now();

        // Calls in last hour
        const oneHourAgo = now - 3600000;
        const lastHourCalls = this.callLog.filter(c => c.timestamp > oneHourAgo);

        // Calls in last 5 minutes
        const fiveMinAgo = now - 300000;
        const last5MinCalls = this.callLog.filter(c => c.timestamp > fiveMinAgo);

        // Calls per minute (last 5 minutes, for rate chart)
        const callsPerMinute = [];
        for (let i = 4; i >= 0; i--) {
            const minStart = now - ((i + 1) * 60000);
            const minEnd = now - (i * 60000);
            const count = this.callLog.filter(c => c.timestamp > minStart && c.timestamp <= minEnd).length;
            const time = new Date(minEnd);
            callsPerMinute.push({
                minute: time.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
                count
            });
        }

        // Top callers (sorted by count descending)
        const topCallers = Object.entries(this.callerUsage)
            .map(([name, data]) => ({
                name,
                count: data.count,
                last_call: new Date(data.lastCall).toISOString(),
                percentage: this.dailyUsed > 0 ? Math.round((data.count / this.dailyUsed) * 100) : 0
            }))
            .sort((a, b) => b.count - a.count);

        // Recent activity (last 20 calls)
        const recentActivity = this.callLog.slice(-20).reverse().map(c => ({
            time: new Date(c.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            caller: c.caller
        }));

        // Hourly breakdown
        const hourlyBreakdown = [];
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        for (let h = 0; h <= new Date().getHours(); h++) {
            const hourStart = todayStart.getTime() + (h * 3600000);
            const hourEnd = hourStart + 3600000;
            const count = this.callLog.filter(c => c.timestamp >= hourStart && c.timestamp < hourEnd).length;
            hourlyBreakdown.push({
                hour: h.toString().padStart(2, '0') + ':00',
                count
            });
        }

        return {
            daily: {
                used: this.dailyUsed,
                limit: this.dailyLimit,
                remaining: Math.max(0, this.dailyLimit - this.dailyUsed),
                percentage: Math.round((this.dailyUsed / this.dailyLimit) * 100),
                paused: this.dailyPaused,
                date: this.dailyDate,
                persisted_to_db: this.pool !== null
            },
            rate: {
                current_tokens: this.tokens,
                max_per_minute: this.maxRequests,
                queued: this.queue.length,
                calls_last_5_min: last5MinCalls.length,
                calls_last_hour: lastHourCalls.length,
                calls_per_minute: callsPerMinute
            },
            alerts: {
                thresholds: this.alertThresholds,
                triggered: { ...this.alertsTriggered },
                circuit_breaker_open: this.isCircuitOpen(),
                circuit_breaker_threshold: this.circuitBreakerThreshold
            },
            top_callers: topCallers.slice(0, 15),
            recent_activity: recentActivity,
            hourly_breakdown: hourlyBreakdown,
            sync_lock: this.getSyncLockStatus()
        };
    }

    reset() {
        this.tokens = this.maxRequests;
        this.lastRefill = Date.now();
        this.queue.forEach(({ resolve }) => resolve());
        this.queue = [];
        if (this.refillInterval) {
            clearInterval(this.refillInterval);
            this.refillInterval = null;
        }
    }

    /**
     * Check if it's safe to start a heavy operation
     * @param {number} estimatedCalls - Estimated number of API calls
     * @returns {{ safe: boolean, reason: string }}
     */
    canStartHeavyOperation(estimatedCalls = 100) {
        this._resetDailyIfNeeded();

        if (this.dailyPaused) {
            return { safe: false, reason: `Daily quota near limit: ${this.dailyUsed}/${this.dailyLimit} used` };
        }

        if (this.dailyUsed + estimatedCalls > this.dailyLimit - this.dailyReserve) {
            return { safe: false, reason: `Not enough quota: ${this.dailyLimit - this.dailyUsed - this.dailyReserve} calls remaining, need ~${estimatedCalls}` };
        }

        if (this.activeSyncOp) {
            return { safe: false, reason: `Another operation in progress: ${this.activeSyncOp}` };
        }

        return { safe: true, reason: 'OK' };
    }

    /**
     * Force persist current state to DB (for graceful shutdown)
     */
    async flush() {
        await this._persistDailyToDB();
    }
}

module.exports = new ZohoRateLimiter();
