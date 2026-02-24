/**
 * Automation Registry - In-memory tracking of all cron/scheduled jobs
 * No DB tables — purely in-memory for live dashboard monitoring
 */

const automations = new Map();

/**
 * Register an automation job
 */
function register(id, { name, service, schedule, description }) {
    automations.set(id, {
        id,
        name,
        service,
        schedule,
        description: description || '',
        status: 'idle',       // idle | running | healthy | failed
        lastRunAt: null,
        lastCompletedAt: null,
        lastResult: null,
        lastError: null,
        lastDuration: null,   // ms
        runCount: 0,
        failCount: 0,
        registeredAt: new Date().toISOString()
    });
}

/**
 * Mark a job as currently running
 */
function markRunning(id) {
    const job = automations.get(id);
    if (!job) return;
    job.status = 'running';
    job.lastRunAt = new Date().toISOString();
    job._startTime = Date.now();
}

/**
 * Mark a job as completed successfully
 */
function markCompleted(id, { details, recordsProcessed } = {}) {
    const job = automations.get(id);
    if (!job) return;
    job.status = 'healthy';
    job.lastCompletedAt = new Date().toISOString();
    job.lastResult = { details, recordsProcessed };
    job.lastError = null;
    job.lastDuration = job._startTime ? Date.now() - job._startTime : null;
    job.runCount++;
    delete job._startTime;
}

/**
 * Mark a job as failed
 */
function markFailed(id, { error } = {}) {
    const job = automations.get(id);
    if (!job) return;
    job.status = 'failed';
    job.lastError = error || 'Unknown error';
    job.lastDuration = job._startTime ? Date.now() - job._startTime : null;
    job.runCount++;
    job.failCount++;
    delete job._startTime;
}

/**
 * Get all automation statuses as array
 */
function getAll() {
    const results = [];
    for (const job of automations.values()) {
        const { _startTime, ...clean } = job;
        results.push(clean);
    }
    return results;
}

/**
 * Get status of a single job
 */
function getStatus(id) {
    const job = automations.get(id);
    if (!job) return null;
    const { _startTime, ...clean } = job;
    return clean;
}

/**
 * Get summary counts
 */
function getSummary() {
    let total = 0, running = 0, healthy = 0, failed = 0, idle = 0;
    let lastActivity = null;

    for (const job of automations.values()) {
        total++;
        if (job.status === 'running') running++;
        else if (job.status === 'healthy') healthy++;
        else if (job.status === 'failed') failed++;
        else idle++;

        if (job.lastRunAt && (!lastActivity || job.lastRunAt > lastActivity)) {
            lastActivity = job.lastRunAt;
        }
    }

    return { total, running, healthy, failed, idle, lastActivity };
}

module.exports = {
    register,
    markRunning,
    markCompleted,
    markFailed,
    getAll,
    getStatus,
    getSummary
};
