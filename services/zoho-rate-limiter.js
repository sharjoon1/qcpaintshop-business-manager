/**
 * ZOHO API RATE LIMITER + USAGE TRACKER
 * Token bucket rate limiter for Zoho Books API (100 req/min limit)
 * Uses 80 req/min safe limit to avoid hitting the wall
 *
 * Also tracks daily API usage (Zoho's 10,000/org/day limit)
 * and provides usage stats for the API Usage Monitor.
 *
 * Usage:
 *   const rateLimiter = require('./zoho-rate-limiter');
 *   await rateLimiter.acquire('syncItems');
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

        // === Daily Quota Tracking ===
        this.dailyLimit = 10000;
        this.dailyUsed = 0;
        this.dailyDate = this._todayStr();
        this.dailyPaused = false;
        this.dailyReserve = 500; // Reserve 500 calls for manual/urgent operations

        // === API Call Log (rolling window for monitoring) ===
        this.callLog = [];          // { timestamp, caller, endpoint }
        this.maxLogEntries = 2000;  // Keep last 2000 entries

        // === Per-caller usage tracking ===
        this.callerUsage = {};      // { callerName: { count, lastCall } }

        // === Sync lock: prevent overlapping heavy operations ===
        this.activeSyncOp = null;   // Name of currently running sync operation
        this.activeSyncStart = null;
    }

    _todayStr() {
        return new Date().toISOString().split('T')[0];
    }

    _resetDailyIfNeeded() {
        const today = this._todayStr();
        if (today !== this.dailyDate) {
            this.dailyUsed = 0;
            this.dailyDate = today;
            this.dailyPaused = false;
            this.callerUsage = {};
            this.callLog = [];
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
    }

    /**
     * Acquire a token to make an API call.
     * @param {string} caller - Identifier for the caller (e.g., 'syncItems', 'bulkJob', 'getInvoice')
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
                date: this.dailyDate
            },
            rate: {
                current_tokens: this.tokens,
                max_per_minute: this.maxRequests,
                queued: this.queue.length,
                calls_last_5_min: last5MinCalls.length,
                calls_last_hour: lastHourCalls.length,
                calls_per_minute: callsPerMinute
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
}

module.exports = new ZohoRateLimiter();
