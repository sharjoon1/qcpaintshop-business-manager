/**
 * Painter Scheduler - Cron orchestrator for painter system automated jobs
 * - Monthly slab evaluation (1st of month, 6 AM IST)
 * - Quarterly slab evaluation (1st of Jan/Apr/Jul/Oct, 6:30 AM IST)
 * - Daily credit overdue check (8 AM IST)
 */

const cron = require('node-cron');
const pointsEngine = require('./painter-points-engine');

let pool = null;
let registry = null;
const jobs = {};

function setPool(p) {
    pool = p;
    pointsEngine.setPool(p);
}

function setAutomationRegistry(r) { registry = r; }

// ─── Config Helper ─────────────────────────────────────────────

async function getConfig(key) {
    if (!pool) return null;
    try {
        const [rows] = await pool.query('SELECT config_value FROM ai_config WHERE config_key = ?', [key]);
        return rows[0]?.config_value || null;
    } catch (e) {
        return null;
    }
}

// ─── Job Runners ───────────────────────────────────────────────

async function runMonthlySlabEvaluation() {
    try {
        const enabled = await getConfig('painter_system_enabled');
        if (enabled !== '1') { console.log('[Painter Scheduler] System disabled, skipping monthly slabs'); return; }

        // Evaluate previous month
        const now = new Date();
        const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const yearMonth = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;

        console.log(`[Painter Scheduler] Running monthly slab evaluation for ${yearMonth}...`);
        if (registry) registry.markRunning('painter-monthly-slabs');
        const result = await pointsEngine.evaluateMonthlySlabs(yearMonth);
        console.log(`[Painter Scheduler] Monthly slabs done: ${result.evaluated} evaluated, ${result.awarded} awarded`);
        if (registry) registry.markCompleted('painter-monthly-slabs', { recordsProcessed: result.evaluated });
    } catch (error) {
        console.error('[Painter Scheduler] Monthly slab evaluation failed:', error.message);
        if (registry) registry.markFailed('painter-monthly-slabs', { error: error.message });
    }
}

async function runQuarterlySlabEvaluation() {
    try {
        const enabled = await getConfig('painter_system_enabled');
        if (enabled !== '1') { console.log('[Painter Scheduler] System disabled, skipping quarterly slabs'); return; }

        // Evaluate previous quarter
        const now = new Date();
        let year = now.getFullYear();
        let quarter = Math.ceil((now.getMonth() + 1) / 3) - 1; // previous quarter
        if (quarter === 0) { quarter = 4; year--; }
        const yearQuarter = `${year}-Q${quarter}`;

        console.log(`[Painter Scheduler] Running quarterly slab evaluation for ${yearQuarter}...`);
        if (registry) registry.markRunning('painter-quarterly-slabs');
        const result = await pointsEngine.evaluateQuarterlySlabs(yearQuarter);
        console.log(`[Painter Scheduler] Quarterly slabs done: ${result.evaluated} evaluated, ${result.awarded} awarded`);
        if (registry) registry.markCompleted('painter-quarterly-slabs', { recordsProcessed: result.evaluated });
    } catch (error) {
        console.error('[Painter Scheduler] Quarterly slab evaluation failed:', error.message);
        if (registry) registry.markFailed('painter-quarterly-slabs', { error: error.message });
    }
}

async function runCreditOverdueCheck() {
    try {
        const enabled = await getConfig('painter_system_enabled');
        if (enabled !== '1') { console.log('[Painter Scheduler] System disabled, skipping credit check'); return; }

        console.log('[Painter Scheduler] Running credit overdue check...');
        if (registry) registry.markRunning('painter-credit-check');
        const result = await pointsEngine.checkOverdueCredits();
        console.log(`[Painter Scheduler] Credit check done: ${result.processed} painters processed`);
        if (registry) registry.markCompleted('painter-credit-check', { recordsProcessed: result.processed });
    } catch (error) {
        console.error('[Painter Scheduler] Credit overdue check failed:', error.message);
        if (registry) registry.markFailed('painter-credit-check', { error: error.message });
    }
}

// ─── Scheduler Start/Stop ────────────────────────────────────

function start() {
    // Register automations
    if (registry) {
        registry.register('painter-monthly-slabs', { name: 'Monthly Slab Eval', service: 'painter-scheduler', schedule: '0 6 1 * *', description: 'Monthly painter value slab evaluation' });
        registry.register('painter-quarterly-slabs', { name: 'Quarterly Slab Eval', service: 'painter-scheduler', schedule: '30 6 1 1,4,7,10 *', description: 'Quarterly painter slab evaluation' });
        registry.register('painter-credit-check', { name: 'Credit Overdue Check', service: 'painter-scheduler', schedule: '0 8 * * *', description: 'Daily painter credit overdue check' });
    }

    // Monthly slab evaluation — 1st of every month, 6:00 AM IST
    jobs.monthlySlabs = cron.schedule('0 6 1 * *', runMonthlySlabEvaluation, { timezone: 'Asia/Kolkata' });

    // Quarterly slab evaluation — 1st of Jan/Apr/Jul/Oct, 6:30 AM IST
    jobs.quarterlySlabs = cron.schedule('30 6 1 1,4,7,10 *', runQuarterlySlabEvaluation, { timezone: 'Asia/Kolkata' });

    // Daily credit overdue check — 8:00 AM IST
    jobs.creditCheck = cron.schedule('0 8 * * *', runCreditOverdueCheck, { timezone: 'Asia/Kolkata' });

    console.log('[Painter Scheduler] Started: monthly-slabs(1st 6AM), quarterly-slabs(Q1 6:30AM), credit-check(daily 8AM)');
}

function stop() {
    Object.values(jobs).forEach(j => j && j.stop());
    console.log('[Painter Scheduler] Stopped all jobs');
}

module.exports = {
    setPool,
    setAutomationRegistry,
    start,
    stop,
    // Expose runners for manual triggering
    runMonthlySlabEvaluation,
    runQuarterlySlabEvaluation,
    runCreditOverdueCheck
};
