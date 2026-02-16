/**
 * ZOHO SYNC SCHEDULER
 * Manages automatic background sync between Zoho Books and local MySQL
 *
 * Features:
 *   - Configurable sync interval (reads from zoho_config table)
 *   - Enable/disable via admin panel
 *   - Daily full sync at configurable time
 *   - Automatic retry on failure
 *   - Graceful start/stop/restart
 *
 * Usage:
 *   const scheduler = require('../services/sync-scheduler');
 *   scheduler.setPool(pool);
 *   scheduler.start();
 */

const cron = require('node-cron');
const zohoAPI = require('./zoho-api');
const rateLimiter = require('./zoho-rate-limiter');

let pool;
let syncJob = null;           // Interval-based sync cron task
let dailyReportJob = null;    // Daily report generation cron task
let stockSyncJob = null;      // Stock sync cron task
let bulkJobProcessor = null;  // Bulk job processor cron task
let configCache = {};         // Cached config values
let isRunning = false;
let lastSyncAttempt = null;
let nextSyncTime = null;

function setPool(dbPool) {
    pool = dbPool;
    zohoAPI.setPool(dbPool);
}

// ========================================
// CONFIG MANAGEMENT
// ========================================

/**
 * Load config from zoho_config table
 */
async function loadConfig() {
    if (!pool) return {};

    try {
        const [rows] = await pool.query(`SELECT config_key, config_value FROM zoho_config`);
        const config = {};
        rows.forEach(row => { config[row.config_key] = row.config_value; });
        configCache = config;
        return config;
    } catch (error) {
        console.error('[Scheduler] Failed to load config:', error.message);
        return configCache; // Return cached version on failure
    }
}

/**
 * Get a config value with default
 */
function getConfig(key, defaultValue) {
    return configCache[key] !== undefined ? configCache[key] : defaultValue;
}

// ========================================
// SYNC EXECUTION
// ========================================

/**
 * Execute a sync cycle - uses quickSync for frequent polling (customers + invoices + payments only)
 * Stock sync is handled separately by executeStockSync on a longer interval.
 * This reduces API consumption from ~300+ calls to ~8-15 calls per cycle.
 */
async function executeSyncCycle() {
    if (!pool) {
        console.error('[Scheduler] Cannot sync - database pool not initialized');
        return;
    }

    lastSyncAttempt = new Date();

    try {
        // Reload config to get latest settings
        await loadConfig();

        // Check if sync is enabled
        if (getConfig('sync_enabled', 'true') !== 'true') {
            console.log('[Scheduler] Sync is disabled, skipping cycle');
            return;
        }

        // Check if another sync is already running
        const [running] = await pool.query(
            `SELECT id FROM zoho_sync_log WHERE status IN ('started','in_progress') AND started_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE) LIMIT 1`
        );
        if (running.length > 0) {
            console.log('[Scheduler] Another sync is already in progress, skipping');
            return;
        }

        // Check daily quota - quickSync only needs ~15 calls
        const quotaCheck = rateLimiter.canStartHeavyOperation(20);
        if (!quotaCheck.safe) {
            console.log(`[Scheduler] Skipping auto-sync: ${quotaCheck.reason}`);
            return;
        }

        // Check circuit breaker
        if (rateLimiter.isCircuitOpen()) {
            console.log(`[Scheduler] Circuit breaker open - skipping auto-sync to preserve API quota`);
            return;
        }

        // Acquire sync lock to prevent overlap with bulk jobs / stock sync
        if (!rateLimiter.tryAcquireSyncLock('quickSync')) {
            console.log(`[Scheduler] Skipping auto-sync: ${rateLimiter.getSyncLockStatus().operation} is running`);
            return;
        }

        console.log('[Scheduler] Starting quick sync cycle (customers, invoices, payments)...');

        try {
            // Use quickSync instead of fullSync - saves ~300 API calls per cycle
            const result = await zohoAPI.quickSync(null); // null = system-triggered
            console.log(`[Scheduler] Quick sync completed. Results:`, JSON.stringify(result.results || {}));
        } finally {
            rateLimiter.releaseSyncLock('quickSync');
        }

    } catch (error) {
        console.error('[Scheduler] Auto-sync failed:', error.message);

        // Log the failure
        try {
            await pool.query(
                `INSERT INTO zoho_sync_log (sync_type, direction, status, error_message, started_at, completed_at)
                 VALUES ('quick', 'zoho_to_local', 'failed', ?, NOW(), NOW())`,
                [`Auto-sync scheduler error: ${error.message}`]
            );
        } catch (logErr) {
            console.error('[Scheduler] Failed to log error:', logErr.message);
        }
    }
}

/**
 * Execute stock sync cycle (every 4 hours by default)
 * This is the heavy operation that fetches per-item stock levels
 */
async function executeStockSync() {
    if (!pool) return;

    try {
        await loadConfig();

        if (getConfig('stock_sync_enabled', 'true') !== 'true') {
            return;
        }

        // Check circuit breaker first
        if (rateLimiter.isCircuitOpen()) {
            console.log(`[Scheduler] Circuit breaker open - skipping stock sync to preserve API quota`);
            return;
        }

        // Check daily quota before starting heavy operation
        const quotaCheck = rateLimiter.canStartHeavyOperation(300);
        if (!quotaCheck.safe) {
            console.log(`[Scheduler] Skipping stock sync: ${quotaCheck.reason}`);
            return;
        }

        // Acquire sync lock
        if (!rateLimiter.tryAcquireSyncLock('stockSync')) {
            console.log(`[Scheduler] Skipping stock sync: ${rateLimiter.getSyncLockStatus().operation} is running`);
            return;
        }

        console.log('[Scheduler] Starting stock sync...');

        try {
            // Sync items first, then locations, then stock
            try {
                await zohoAPI.syncItems(null);
            } catch (e) {
                console.error('[Scheduler] Items sync failed:', e.message);
            }

            try {
                await zohoAPI.syncLocations(null);
            } catch (e) {
                console.error('[Scheduler] Locations sync failed:', e.message);
            }

            // Re-check quota after items/locations sync
            const postQuotaCheck = rateLimiter.canStartHeavyOperation(200);
            if (!postQuotaCheck.safe) {
                console.log(`[Scheduler] Skipping location stock sync: ${postQuotaCheck.reason}`);
            } else {
                try {
                    await zohoAPI.syncLocationStock(null);
                    console.log('[Scheduler] Stock sync completed');
                } catch (e) {
                    console.error('[Scheduler] Stock sync failed:', e.message);
                }
            }

            // Run reorder check after stock sync (no API calls, just DB queries)
            try {
                if (getConfig('reorder_alerts_enabled', 'true') === 'true') {
                    const result = await zohoAPI.checkReorderAlerts();
                    console.log(`[Scheduler] Reorder check: ${result.created} new alerts, ${result.auto_resolved} auto-resolved`);
                }
            } catch (e) {
                console.error('[Scheduler] Reorder check failed:', e.message);
            }
        } finally {
            rateLimiter.releaseSyncLock('stockSync');
        }

    } catch (error) {
        console.error('[Scheduler] Stock sync cycle failed:', error.message);
    }
}

/**
 * Process pending bulk jobs
 */
async function executeBulkJobProcessor() {
    if (!pool) return;

    try {
        // Skip if another heavy sync operation is running
        const lockStatus = rateLimiter.getSyncLockStatus();
        if (lockStatus.locked) {
            return; // Silently skip - don't log every 5 min
        }

        // Check daily quota - need at least 25 calls for a batch
        const quotaCheck = rateLimiter.canStartHeavyOperation(25);
        if (!quotaCheck.safe) {
            console.log(`[Scheduler] Bulk processor paused: ${quotaCheck.reason}`);
            return;
        }

        // Find pending or processing bulk jobs
        const [jobs] = await pool.query(
            `SELECT id FROM zoho_bulk_jobs WHERE status IN ('pending','processing') ORDER BY created_at ASC LIMIT 1`
        );

        if (jobs.length === 0) return;

        console.log(`[Scheduler] Processing bulk job #${jobs[0].id}...`);
        const result = await zohoAPI.processBulkJob(jobs[0].id);
        console.log(`[Scheduler] Bulk job batch done:`, result);

    } catch (error) {
        console.error('[Scheduler] Bulk job processor failed:', error.message);
    }
}

/**
 * Execute daily report generation
 */
async function executeDailyReport() {
    if (!pool) return;

    try {
        await loadConfig();

        if (getConfig('daily_report_enabled', 'false') !== 'true') {
            return;
        }

        console.log('[Scheduler] Generating daily financial report...');

        const today = new Date();
        const fyStart = today.getMonth() >= 3
            ? `${today.getFullYear()}-04-01`
            : `${today.getFullYear() - 1}-04-01`;
        const todayStr = today.toISOString().split('T')[0];

        // Generate and cache P&L report
        const plReport = await zohoAPI.getProfitAndLoss(fyStart, todayStr);

        await pool.query(`
            INSERT INTO zoho_financial_reports (report_type, report_period, from_date, to_date, report_data)
            VALUES ('profit_loss', 'daily_auto', ?, ?, ?)
        `, [fyStart, todayStr, JSON.stringify(plReport)]);

        // Generate receivables summary
        const receivables = await zohoAPI.getReceivablesSummary();

        await pool.query(`
            INSERT INTO zoho_financial_reports (report_type, report_period, from_date, to_date, report_data)
            VALUES ('receivables', 'daily_auto', ?, ?, ?)
        `, [fyStart, todayStr, JSON.stringify(receivables)]);

        console.log('[Scheduler] Daily financial report generated successfully');

        // Also generate yesterday's daily transaction report
        try {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];
            await zohoAPI.generateDailyTransactionReport(yesterdayStr, yesterdayStr, null);
            console.log('[Scheduler] Yesterday\'s transaction report generated');
        } catch (txErr) {
            console.error('[Scheduler] Transaction report generation failed:', txErr.message);
        }

    } catch (error) {
        console.error('[Scheduler] Daily report generation failed:', error.message);
    }
}

// ========================================
// CRON MANAGEMENT
// ========================================

/**
 * Convert interval minutes to cron expression
 */
function intervalToCron(minutes) {
    const mins = parseInt(minutes) || 30;

    if (mins <= 0) return null; // disabled

    if (mins < 60) {
        // Every N minutes
        return `*/${mins} * * * *`;
    } else if (mins < 1440) {
        // Every N hours
        const hours = Math.floor(mins / 60);
        return `0 */${hours} * * *`;
    } else {
        // Daily at 6 AM
        return '0 6 * * *';
    }
}

/**
 * Start the scheduler
 */
async function start() {
    if (isRunning) {
        console.log('[Scheduler] Already running, call restart() to update');
        return;
    }

    try {
        await loadConfig();

        const syncEnabled = getConfig('sync_enabled', 'true') === 'true';
        const intervalMinutes = getConfig('sync_interval_minutes', '60'); // Changed default: 60 min (was 30)
        const dailyEnabled = getConfig('daily_report_enabled', 'false') === 'true';
        const dailyTime = getConfig('daily_report_time', '09:00');

        console.log(`[Scheduler] Starting... sync_enabled=${syncEnabled}, interval=${intervalMinutes}min (quick sync, no stock)`);

        // Auto-sync cron job
        if (syncEnabled) {
            const cronExpr = intervalToCron(intervalMinutes);
            if (cronExpr && cron.validate(cronExpr)) {
                syncJob = cron.schedule(cronExpr, executeSyncCycle, {
                    scheduled: true,
                    timezone: 'Asia/Kolkata'
                });

                // Calculate next sync time
                nextSyncTime = calculateNextRun(cronExpr);
                console.log(`[Scheduler] Sync job scheduled: ${cronExpr} (every ${intervalMinutes} min)`);
            } else {
                console.warn(`[Scheduler] Invalid cron expression: ${cronExpr}`);
            }
        } else {
            console.log('[Scheduler] Auto-sync is disabled');
        }

        // Daily report cron job
        if (dailyEnabled) {
            const [hours, minutes] = (dailyTime || '09:00').split(':');
            const dailyCron = `${parseInt(minutes) || 0} ${parseInt(hours) || 9} * * *`;

            if (cron.validate(dailyCron)) {
                dailyReportJob = cron.schedule(dailyCron, executeDailyReport, {
                    scheduled: true,
                    timezone: 'Asia/Kolkata'
                });
                console.log(`[Scheduler] Daily report job scheduled: ${dailyCron}`);
            }
        }

        // Stock sync cron job - prefer off-peak hours to preserve daytime quota
        // Off-peak schedule: 2 AM, 6 AM, 12 PM, 6 PM IST (4 times/day during less busy periods)
        // Falls back to every N hours if custom interval is set
        const stockSyncEnabled = getConfig('stock_sync_enabled', 'true') === 'true';
        const stockSyncHours = parseInt(getConfig('stock_sync_interval_hours', '4')) || 4;
        if (stockSyncEnabled) {
            let stockCron;
            if (stockSyncHours === 4) {
                // Default: use off-peak schedule (2 AM, 6 AM, 12 PM, 6 PM)
                stockCron = '0 2,6,12,18 * * *';
            } else if (stockSyncHours === 6) {
                // 6-hour interval: early morning and afternoon
                stockCron = '0 3,9,15,21 * * *';
            } else {
                stockCron = `0 */${stockSyncHours} * * *`;
            }

            if (cron.validate(stockCron)) {
                stockSyncJob = cron.schedule(stockCron, executeStockSync, {
                    scheduled: true,
                    timezone: 'Asia/Kolkata'
                });
                console.log(`[Scheduler] Stock sync job scheduled: ${stockCron} (heavy operation, off-peak preferred)`);
            }
        }

        // Bulk job processor (every 5 minutes - reduced from 2 to prevent quota exhaustion)
        bulkJobProcessor = cron.schedule('*/5 * * * *', executeBulkJobProcessor, {
            scheduled: true,
            timezone: 'Asia/Kolkata'
        });
        console.log('[Scheduler] Bulk job processor scheduled: every 5 min');

        isRunning = true;
        console.log('[Scheduler] Started successfully');

    } catch (error) {
        console.error('[Scheduler] Failed to start:', error.message);
    }
}

/**
 * Stop the scheduler
 */
function stop() {
    if (syncJob) {
        syncJob.stop();
        syncJob = null;
    }
    if (dailyReportJob) {
        dailyReportJob.stop();
        dailyReportJob = null;
    }
    if (stockSyncJob) {
        stockSyncJob.stop();
        stockSyncJob = null;
    }
    if (bulkJobProcessor) {
        bulkJobProcessor.stop();
        bulkJobProcessor = null;
    }
    isRunning = false;
    nextSyncTime = null;
    console.log('[Scheduler] Stopped');
}

/**
 * Restart the scheduler (after config change)
 */
async function restart() {
    console.log('[Scheduler] Restarting...');
    stop();
    // Small delay to ensure clean shutdown
    await new Promise(resolve => setTimeout(resolve, 500));
    await start();
}

// ========================================
// STATUS & INFO
// ========================================

/**
 * Get scheduler status (for admin dashboard/API)
 */
function getStatus() {
    return {
        running: isRunning,
        sync_enabled: getConfig('sync_enabled', 'true') === 'true',
        sync_interval_minutes: getConfig('sync_interval_minutes', '60'),
        sync_mode: 'quick', // Quick sync (no stock) for frequent polling
        sync_job_active: syncJob !== null,
        daily_report_active: dailyReportJob !== null,
        stock_sync_active: stockSyncJob !== null,
        bulk_processor_active: bulkJobProcessor !== null,
        last_sync_attempt: lastSyncAttempt,
        next_sync_time: nextSyncTime,
        api_usage: rateLimiter.getStatus(),
        config: {
            sync_enabled: getConfig('sync_enabled', 'true'),
            sync_interval_minutes: getConfig('sync_interval_minutes', '60'),
            daily_report_enabled: getConfig('daily_report_enabled', 'false'),
            daily_report_time: getConfig('daily_report_time', '09:00'),
            whatsapp_enabled: getConfig('whatsapp_enabled', 'false'),
            stock_sync_enabled: getConfig('stock_sync_enabled', 'true'),
            stock_sync_interval_hours: getConfig('stock_sync_interval_hours', '4'),
            reorder_alerts_enabled: getConfig('reorder_alerts_enabled', 'true')
        }
    };
}

/**
 * Calculate approximate next run time from cron expression
 */
function calculateNextRun(cronExpr) {
    // Simple approximation based on interval
    const now = new Date();
    const parts = cronExpr.split(' ');

    if (parts[0].startsWith('*/')) {
        const mins = parseInt(parts[0].replace('*/', ''));
        const currentMin = now.getMinutes();
        const nextMin = Math.ceil(currentMin / mins) * mins;
        const next = new Date(now);
        next.setMinutes(nextMin, 0, 0);
        if (next <= now) next.setMinutes(next.getMinutes() + mins);
        return next;
    }

    if (parts[1].startsWith('*/')) {
        const hours = parseInt(parts[1].replace('*/', ''));
        const next = new Date(now);
        const currentHour = now.getHours();
        const nextHour = Math.ceil(currentHour / hours) * hours;
        next.setHours(nextHour, 0, 0, 0);
        if (next <= now) next.setHours(next.getHours() + hours);
        return next;
    }

    // Default: assume 30 minutes from now
    return new Date(now.getTime() + 30 * 60 * 1000);
}

module.exports = {
    setPool,
    start,
    stop,
    restart,
    getStatus,
    executeSyncCycle,
    loadConfig
};
