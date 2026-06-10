/**
 * Painter Scheduler - Cron orchestrator for painter system automated jobs
 * - Monthly slab evaluation (1st of month, 6 AM IST)
 * - Quarterly slab evaluation (1st of Jan/Apr/Jul/Oct, 6:30 AM IST)
 * - Daily credit overdue check (8 AM IST)
 * - Midnight streak reset (00:00 IST)
 * - Daily bonus product rotation (00:05 IST)
 * - Daily bonus push notification (7 AM IST)
 * - Streak-at-risk reminder (8 PM IST)
 */

const cron = require('node-cron');
const pointsEngine = require('./painter-points-engine');
const painterNotificationService = require('./painter-notification-service');
const pntrImportService = require('./pntr-import-service');
const painterZohoSyncService = require('./painter-zoho-sync-service');
const painterMarketingScheduler = require('./painter-marketing-scheduler');
const painterBackfillService = require('./painter-points-backfill-service');
const attendanceService = require('./painter-attendance-service');
const zohoApi = require('./zoho-api');

const { isClusterPrimary } = require('./cluster-guard');
let pool = null;
let registry = null;
const jobs = {};

function setPool(p) {
    pool = p;
    pointsEngine.setPool(p);
    attendanceService.setPool(p);
    painterZohoSyncService.init({ pool: p, zohoApi });
}

function prevMonthKey() {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ─── M4: job_runs catch-up persistence ────────────────────────
// Date-anchored jobs stamp a (job_name, period_label) row in job_runs on
// success. On startup, runStartupCatchup() re-runs any job whose most recent
// expected period is missing its marker — so a deploy/restart that straddles a
// fire time no longer silently loses that period (slab bonuses, AP windows).

function monthKeyOf(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Monthly jobs fire on the 1st for the PREVIOUS month.
function expectedMonthlyLabel(now = new Date()) {
    return monthKeyOf(new Date(now.getFullYear(), now.getMonth() - 1, 1));
}

// Quarterly slabs fire on the 1st of Jan/Apr/Jul/Oct for the PREVIOUS quarter.
function expectedQuarterlyLabel(now = new Date()) {
    let year = now.getFullYear();
    let quarter = Math.ceil((now.getMonth() + 1) / 3) - 1;
    if (quarter === 0) { quarter = 4; year--; }
    return `${year}-Q${quarter}`;
}

// Forfeit fires on the 8th for the previous month; before the 8th the most
// recently DUE label is the month before last.
function expectedForfeitLabel(now = new Date()) {
    const back = now.getDate() >= 8 ? 1 : 2;
    return monthKeyOf(new Date(now.getFullYear(), now.getMonth() - back, 1));
}

// Atomically claim a (job, period) BEFORE running it — the PRIMARY KEY makes
// the INSERT IGNORE a mutex, so a startup catch-up and a live cron fire (or
// two anything) can never both execute the same period. On failure the claim
// is released so a later run can retry. Residual (accepted): a hard crash
// mid-run leaves the marker without a completed run — the jobs themselves are
// per-painter idempotent, so a manual re-run completes the tail.
// If job_runs doesn't exist yet (code deployed before the migration), run
// untracked rather than blocking the job.
async function claimJobRun(jobName, periodLabel) {
    try {
        const [r] = await pool.query(
            'INSERT IGNORE INTO job_runs (job_name, period_label) VALUES (?, ?)',
            [jobName, periodLabel]
        );
        return { claimed: r.affectedRows > 0, tracked: true };
    } catch (e) {
        console.error(`[Painter Scheduler] job_runs claim failed (${jobName} ${periodLabel}) — running untracked:`, e.message);
        return { claimed: true, tracked: false };
    }
}

async function releaseJobRun(jobName, periodLabel) {
    try {
        await pool.query('DELETE FROM job_runs WHERE job_name = ? AND period_label = ?', [jobName, periodLabel]);
    } catch (e) {
        console.error(`[Painter Scheduler] job_runs release failed (${jobName} ${periodLabel}):`, e.message);
    }
}

async function jobRanFor(jobName, periodLabel) {
    const [rows] = await pool.query(
        'SELECT 1 FROM job_runs WHERE job_name = ? AND period_label = ? LIMIT 1',
        [jobName, periodLabel]
    );
    return rows.length > 0;
}

// Forfeit fires on the 8th 02:00 IST; before then the most recent due fire is
// last month's.
function forfeitDueAt(now) {
    const back = now.getDate() >= 8 ? 0 : 1;
    return new Date(now.getFullYear(), now.getMonth() - back, 8, 2, 0);
}

async function runStartupCatchup(now = new Date()) {
    // Order matters: a missed open-claim must run before a missed forfeit so a
    // late-opened window exists (forfeit itself only closes expired windows).
    // dueAt guards against running EARLY: a restart on the 1st before the
    // cron's fire time must wait for the cron (the fire times sit after the
    // overnight Zoho/PNTR syncs — evaluating slabs at e.g. 02:00 would use an
    // incomplete invoice basis and record it permanently).
    const checks = [
        { job: 'painter-attendance-open-claim', label: expectedMonthlyLabel(now), runner: runOpenAttendanceClaim,
          dueAt: new Date(now.getFullYear(), now.getMonth(), 1, 0, 5) },
        { job: 'painter-monthly-slabs', label: expectedMonthlyLabel(now), runner: runMonthlySlabEvaluation,
          dueAt: new Date(now.getFullYear(), now.getMonth(), 1, 6, 0) },
        { job: 'painter-quarterly-slabs', label: expectedQuarterlyLabel(now), runner: runQuarterlySlabEvaluation,
          dueAt: new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1, 6, 30) },
        { job: 'painter-attendance-forfeit', label: expectedForfeitLabel(now), runner: runForfeitAndPurge,
          dueAt: forfeitDueAt(now) },
    ];
    for (const c of checks) {
        try {
            if (now < c.dueAt) continue; // not due yet — the live cron fires later today
            if (await jobRanFor(c.job, c.label)) continue;
            console.log(`[Painter Scheduler] Catch-up: ${c.job} has no marker for ${c.label} — running now`);
            await c.runner(c.label);
        } catch (e) {
            console.error(`[Painter Scheduler] Catch-up failed for ${c.job} ${c.label}:`, e.message);
        }
    }
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

async function runMonthlySlabEvaluation(yearMonthOverride = null) {
    // Evaluate previous month (or the explicit period when catching up — M4).
    // String-guarded: node-cron passes a context arg to callbacks.
    const yearMonth = typeof yearMonthOverride === 'string' ? yearMonthOverride : expectedMonthlyLabel();
    let claim = null;
    try {
        const enabled = await getConfig('painter_system_enabled');
        if (enabled !== '1') { console.log('[Painter Scheduler] System disabled, skipping monthly slabs'); return; }

        claim = await claimJobRun('painter-monthly-slabs', yearMonth);
        if (!claim.claimed) { console.log(`[Painter Scheduler] Monthly slabs already ran for ${yearMonth} — skipping`); return; }

        console.log(`[Painter Scheduler] Running monthly slab evaluation for ${yearMonth}...`);
        if (registry) registry.markRunning('painter-monthly-slabs');
        const result = await pointsEngine.evaluateMonthlySlabs(yearMonth);
        console.log(`[Painter Scheduler] Monthly slabs done: ${result.evaluated} evaluated, ${result.awarded} awarded`);
        if (registry) registry.markCompleted('painter-monthly-slabs', { recordsProcessed: result.evaluated });
    } catch (error) {
        if (claim && claim.claimed && claim.tracked) await releaseJobRun('painter-monthly-slabs', yearMonth);
        console.error('[Painter Scheduler] Monthly slab evaluation failed:', error.message);
        if (registry) registry.markFailed('painter-monthly-slabs', { error: error.message });
    }
}

async function runQuarterlySlabEvaluation(yearQuarterOverride = null) {
    // Evaluate previous quarter (or the explicit period when catching up — M4).
    // String-guarded: node-cron passes a context arg to callbacks.
    const yearQuarter = typeof yearQuarterOverride === 'string' ? yearQuarterOverride : expectedQuarterlyLabel();
    let claim = null;
    try {
        const enabled = await getConfig('painter_system_enabled');
        if (enabled !== '1') { console.log('[Painter Scheduler] System disabled, skipping quarterly slabs'); return; }

        claim = await claimJobRun('painter-quarterly-slabs', yearQuarter);
        if (!claim.claimed) { console.log(`[Painter Scheduler] Quarterly slabs already ran for ${yearQuarter} — skipping`); return; }

        console.log(`[Painter Scheduler] Running quarterly slab evaluation for ${yearQuarter}...`);
        if (registry) registry.markRunning('painter-quarterly-slabs');
        const result = await pointsEngine.evaluateQuarterlySlabs(yearQuarter);
        console.log(`[Painter Scheduler] Quarterly slabs done: ${result.evaluated} evaluated, ${result.awarded} awarded`);
        if (registry) registry.markCompleted('painter-quarterly-slabs', { recordsProcessed: result.evaluated });
    } catch (error) {
        if (claim && claim.claimed && claim.tracked) await releaseJobRun('painter-quarterly-slabs', yearQuarter);
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

async function runPointsDriftCheck() {
    try {
        const enabled = await getConfig('painter_system_enabled');
        if (enabled !== '1') return;

        if (registry) registry.markRunning('painter-points-drift-check');
        const result = await pointsEngine.checkPointsDrift();
        if (result.drifted > 0) {
            console.error(`[Painter Scheduler] Points drift check: ${result.drifted} painter(s) out of sync with ledger — see [Points] DRIFT lines above`);
        } else {
            console.log('[Painter Scheduler] Points drift check: all balances match the ledger');
        }
        if (registry) registry.markCompleted('painter-points-drift-check', { drifted: result.drifted });
    } catch (error) {
        console.error('[Painter Scheduler] Points drift check failed:', error.message);
        if (registry) registry.markFailed('painter-points-drift-check', { error: error.message });
    }
}

// ─── Retention Job Runners ────────────────────────────────────

async function runStreakReset() {
    try {
        const enabled = await getConfig('painter_system_enabled');
        if (enabled !== '1') return;

        console.log('[Painter Scheduler] Running midnight streak reset...');
        if (registry) registry.markRunning('painter-streak-reset');

        // Reset streaks for painters who didn't check in yesterday (IST)
        const [result] = await pool.query(`
            UPDATE painters
            SET current_streak = 0
            WHERE current_streak > 0
              AND (last_checkin_date IS NULL OR last_checkin_date < DATE(CONVERT_TZ(NOW(), '+00:00', '+05:30')) - INTERVAL 1 DAY)
        `);

        console.log(`[Painter Scheduler] Streak reset: ${result.affectedRows} painters reset`);
        if (registry) registry.markCompleted('painter-streak-reset', { recordsProcessed: result.affectedRows });
    } catch (error) {
        console.error('[Painter Scheduler] Streak reset failed:', error.message);
        if (registry) registry.markFailed('painter-streak-reset', { error: error.message });
    }
}

async function runDailyBonusRotation() {
    try {
        const enabled = await getConfig('painter_system_enabled');
        if (enabled !== '1') return;

        console.log('[Painter Scheduler] Rotating daily bonus product...');
        if (registry) registry.markRunning('painter-bonus-rotation');

        // Pick random active product
        const [products] = await pool.query(
            "SELECT id, name FROM products WHERE status = 'active' ORDER BY RAND() LIMIT 1"
        );
        if (products.length) {
            const multiplier = Math.random() < 0.5 ? 2 : 3;
            await pool.query("UPDATE ai_config SET config_value = ? WHERE config_key = 'painter_daily_bonus_product_id'", [String(products[0].id)]);
            await pool.query("UPDATE ai_config SET config_value = ? WHERE config_key = 'painter_daily_bonus_multiplier'", [String(multiplier)]);
            console.log(`[Painter Scheduler] Bonus product: ${products[0].name} (${multiplier}x)`);
        }

        if (registry) registry.markCompleted('painter-bonus-rotation', { product: products[0]?.name });
    } catch (error) {
        console.error('[Painter Scheduler] Bonus rotation failed:', error.message);
        if (registry) registry.markFailed('painter-bonus-rotation', { error: error.message });
    }
}

async function runDailyBonusPush() {
    try {
        const enabled = await getConfig('painter_system_enabled');
        if (enabled !== '1') return;

        console.log('[Painter Scheduler] Sending daily bonus push...');
        if (registry) registry.markRunning('painter-daily-bonus-push');

        const productId = await getConfig('painter_daily_bonus_product_id');
        const multiplier = await getConfig('painter_daily_bonus_multiplier') || '2';
        if (!productId) { console.log('[Painter Scheduler] No bonus product set, skipping'); return; }

        const [product] = await pool.query('SELECT name FROM products WHERE id = ?', [productId]);
        if (!product.length) return;

        const notif = painterNotificationService.getRetentionNotification('daily_bonus', product[0].name, multiplier);
        const results = await painterNotificationService.sendToAll(notif);

        console.log(`[Painter Scheduler] Daily bonus push sent to ${results.length} painters`);
        if (registry) registry.markCompleted('painter-daily-bonus-push', { sent: results.length });
    } catch (error) {
        console.error('[Painter Scheduler] Daily bonus push failed:', error.message);
        if (registry) registry.markFailed('painter-daily-bonus-push', { error: error.message });
    }
}

async function runStreakReminder() {
    try {
        const enabled = await getConfig('painter_system_enabled');
        if (enabled !== '1') return;

        const reminderEnabled = await getConfig('painter_streak_reminder_enabled');
        if (reminderEnabled !== '1') return;

        console.log('[Painter Scheduler] Sending streak-at-risk reminders...');
        if (registry) registry.markRunning('painter-streak-reminder');

        // Find painters with streak > 0 who haven't checked in today (IST)
        const [painters] = await pool.query(`
            SELECT id, current_streak FROM painters
            WHERE status = 'approved'
              AND current_streak > 0
              AND (last_checkin_date IS NULL OR last_checkin_date < DATE(CONVERT_TZ(NOW(), '+00:00', '+05:30')))
        `);

        let sent = 0;
        for (const painter of painters) {
            try {
                const notif = painterNotificationService.getRetentionNotification('streak_at_risk', painter.current_streak);
                await painterNotificationService.sendToPainter(painter.id, notif);
                sent++;
            } catch (e) {
                console.error(`[Painter Scheduler] Streak reminder failed for painter ${painter.id}:`, e.message);
            }
        }

        console.log(`[Painter Scheduler] Streak reminders sent: ${sent}/${painters.length}`);
        if (registry) registry.markCompleted('painter-streak-reminder', { sent, total: painters.length });
    } catch (error) {
        console.error('[Painter Scheduler] Streak reminder failed:', error.message);
        if (registry) registry.markFailed('painter-streak-reminder', { error: error.message });
    }
}

// ─── Attendance Job Runners ──────────────────────────────────

async function runOpenAttendanceClaim(monthKeyOverride = null) {
    const monthKey = typeof monthKeyOverride === 'string' ? monthKeyOverride : prevMonthKey();
    let claim = null;
    try {
        claim = await claimJobRun('painter-attendance-open-claim', monthKey);
        if (!claim.claimed) { console.log(`[attendance] open claim already ran for ${monthKey} — skipping`); return; }

        console.log(`[attendance] opening monthly claim window for ${monthKey}...`);
        if (registry) registry.markRunning('painter-attendance-open-claim');
        const { opened } = await attendanceService.openMonthlyClaim(monthKey);
        console.log(`[attendance] opened claim for ${opened} painter(s)`);
        if (registry) registry.markCompleted('painter-attendance-open-claim', { recordsProcessed: opened });
    } catch (err) {
        if (claim && claim.claimed && claim.tracked) await releaseJobRun('painter-attendance-open-claim', monthKey);
        console.error('[attendance] open claim failed:', err);
        if (registry) registry.markFailed('painter-attendance-open-claim', { error: err.message });
    }
}

async function runRecomputeClaimable() {
    try {
        await attendanceService.recomputeClaimable(prevMonthKey());
    } catch (err) {
        console.error('[attendance] recompute failed:', err);
    }
}

async function runRemindUnclaimed() {
    try {
        if (registry) registry.markRunning('painter-attendance-remind');
        const { reminded } = await attendanceService.remindUnclaimed(prevMonthKey());
        console.log(`[attendance] reminded ${reminded} painter(s)`);
        if (registry) registry.markCompleted('painter-attendance-remind', { recordsProcessed: reminded });
    } catch (err) {
        console.error('[attendance] remind failed:', err);
        if (registry) registry.markFailed('painter-attendance-remind', { error: err.message });
    }
}

async function runForfeitAndPurge(monthKeyOverride = null) {
    // Forfeit prev month (claim window just closed) AND purge images from
    // the month before that. When catching up (M4) both keys derive from
    // the explicit forfeit month instead of "now".
    const monthKey = typeof monthKeyOverride === 'string' ? monthKeyOverride : prevMonthKey();
    let claim = null;
    try {
        claim = await claimJobRun('painter-attendance-forfeit', monthKey);
        if (!claim.claimed) { console.log(`[attendance] forfeit already ran for ${monthKey} — skipping`); return; }

        if (registry) registry.markRunning('painter-attendance-forfeit');
        const [fy, fm] = monthKey.split('-').map(Number);
        const purgeKey = monthKeyOf(new Date(fy, fm - 2, 1));
        const { forfeited, purged } = await attendanceService.forfeitAndPurge(monthKey, purgeKey);
        console.log(`[attendance] forfeited=${forfeited} purged=${purged}`);
        if (registry) registry.markCompleted('painter-attendance-forfeit', { forfeited, purged });
    } catch (err) {
        if (claim && claim.claimed && claim.tracked) await releaseJobRun('painter-attendance-forfeit', monthKey);
        console.error('[attendance] forfeit failed:', err);
        if (registry) registry.markFailed('painter-attendance-forfeit', { error: err.message });
    }
}

// ─── Scheduler Start/Stop ────────────────────────────────────

function start() {

    if (!isClusterPrimary()) {
        console.log('[painter-scheduler] skipping cron registration — not PM2 cluster primary');
        return;
    }
    // Register automations
    if (registry) {
        registry.register('painter-monthly-slabs', { name: 'Monthly Slab Eval', service: 'painter-scheduler', schedule: '0 6 1 * *', description: 'Monthly painter value slab evaluation' });
        registry.register('painter-quarterly-slabs', { name: 'Quarterly Slab Eval', service: 'painter-scheduler', schedule: '30 6 1 1,4,7,10 *', description: 'Quarterly painter slab evaluation' });
        registry.register('painter-credit-check', { name: 'Credit Overdue Check', service: 'painter-scheduler', schedule: '0 8 * * *', description: 'Daily painter credit overdue check' });
        registry.register('painter-streak-reset', { name: 'Streak Reset', service: 'painter-scheduler', schedule: '0 0 * * *', description: 'Midnight streak reset for inactive painters' });
        registry.register('painter-bonus-rotation', { name: 'Bonus Rotation', service: 'painter-scheduler', schedule: '5 0 * * *', description: 'Rotate daily bonus product at midnight' });
        registry.register('painter-daily-bonus-push', { name: 'Daily Bonus Push', service: 'painter-scheduler', schedule: '0 7 * * *', description: '7 AM daily bonus product notification' });
        registry.register('painter-streak-reminder', { name: 'Streak Reminder', service: 'painter-scheduler', schedule: '0 20 * * *', description: '8 PM streak-at-risk reminder' });
        registry.register('painter-attendance-open-claim', { name: 'Attendance Open Claim', service: 'painter-scheduler', schedule: '5 0 1 * *', description: 'Open monthly attendance AP claim window on 1st of month' });
        registry.register('painter-attendance-recompute', { name: 'Attendance Recompute Claimable', service: 'painter-scheduler', schedule: '0 */6 1-7 * *', description: 'Recompute claimable AP every 6h during claim window' });
        registry.register('painter-attendance-remind', { name: 'Attendance Claim Reminder', service: 'painter-scheduler', schedule: '0 20 7 * *', description: '8 PM day-before reminder for unclaimed attendance AP' });
        registry.register('painter-attendance-forfeit', { name: 'Attendance Forfeit + Purge', service: 'painter-scheduler', schedule: '0 2 8 * *', description: 'Forfeit unclaimed attendance + purge old selfie images' });
        registry.register('painter-location-prune', { name: 'Location Events Prune', service: 'painter-scheduler', schedule: '30 2 * * *', description: 'Delete painter location events older than 30 days' });
        registry.register('painter-points-drift-check', { name: 'Points Drift Check', service: 'painter-scheduler', schedule: '0 3 * * *', description: 'Daily ledger-vs-balance drift check for painter points (M5)' });
    }

    // M4: re-run any date-anchored job whose latest expected period has no
    // job_runs marker (a deploy/restart that straddled the fire time).
    // Fire-and-forget; each catch-up job logs its own failures.
    runStartupCatchup().catch(e =>
        console.error('[Painter Scheduler] Startup catch-up failed:', e.message)
    );

    // Existing jobs. Wrapped in arrows: the runners take an optional period
    // override (M4 catch-up) that must NOT receive node-cron's callback arg.
    jobs.monthlySlabs = cron.schedule('0 6 1 * *', () => runMonthlySlabEvaluation(), { timezone: 'Asia/Kolkata' });
    jobs.quarterlySlabs = cron.schedule('30 6 1 1,4,7,10 *', () => runQuarterlySlabEvaluation(), { timezone: 'Asia/Kolkata' });
    jobs.creditCheck = cron.schedule('0 8 * * *', runCreditOverdueCheck, { timezone: 'Asia/Kolkata' });
    jobs.pointsDriftCheck = cron.schedule('0 3 * * *', runPointsDriftCheck, { timezone: 'Asia/Kolkata' });

    // Retention jobs
    jobs.streakReset = cron.schedule('0 0 * * *', runStreakReset, { timezone: 'Asia/Kolkata' });
    jobs.bonusRotation = cron.schedule('5 0 * * *', runDailyBonusRotation, { timezone: 'Asia/Kolkata' });
    jobs.dailyBonusPush = cron.schedule('0 7 * * *', runDailyBonusPush, { timezone: 'Asia/Kolkata' });
    jobs.streakReminder = cron.schedule('0 20 * * *', runStreakReminder, { timezone: 'Asia/Kolkata' });

    // Attendance jobs (open/forfeit wrapped — they take M4 period overrides)
    jobs.attendanceOpenClaim = cron.schedule('5 0 1 * *', () => runOpenAttendanceClaim(), { timezone: 'Asia/Kolkata' });
    jobs.attendanceRecompute = cron.schedule('0 */6 1-7 * *', runRecomputeClaimable, { timezone: 'Asia/Kolkata' });
    jobs.attendanceRemind = cron.schedule('0 20 7 * *', runRemindUnclaimed, { timezone: 'Asia/Kolkata' });
    jobs.attendanceForfeit = cron.schedule('0 2 8 * *', () => runForfeitAndPurge(), { timezone: 'Asia/Kolkata' });

    // Location events retention: prune rows older than 30 days at 02:30 IST daily
    jobs.locationPrune = cron.schedule('30 2 * * *', async () => {
        try {
            const [result] = await pool.query(
                'DELETE FROM painter_location_events WHERE recorded_at < NOW() - INTERVAL 30 DAY'
            );
            if (result.affectedRows > 0) {
                console.log(`[Painter Scheduler] Pruned ${result.affectedRows} old location events`);
            }
        } catch (e) {
            console.error('[Painter Scheduler] Location prune error:', e.message);
        }
    }, { timezone: 'Asia/Kolkata' });

    console.log('[Painter Scheduler] Started: monthly-slabs(1st 6AM), quarterly-slabs(Q1 6:30AM), credit-check(daily 8AM), points-drift-check(3AM), streak-reset(midnight), bonus-rotation(00:05), daily-bonus-push(7AM), streak-reminder(8PM), attendance-open-claim(1st 00:05), attendance-recompute(every 6h days 1-7), attendance-remind(7th 8PM), attendance-forfeit(8th 2AM)');

    // PNTR Painter Marketing — register 4 IST crons (02:30 incremental, 03:00 retry, 03:30 backfill, 06:00 daily list).
    // These call the Zoho API, so only register them when Zoho is configured; otherwise getAccessToken
    // throws 'ZOHO_ORGANIZATION_ID not set' twice daily. The loyalty/streak/attendance crons above are
    // Zoho-independent and always run (so painterScheduler can start outside the Zoho gate — SVC-007).
    if (process.env.ZOHO_ORGANIZATION_ID) {
        painterMarketingScheduler.registerCron({
            pool,
            zohoApi,
            pntrImportService,
            backfillService: painterBackfillService,
            painterZohoSyncService
        });
    } else {
        console.log('[Painter Scheduler] PNTR marketing crons skipped (ZOHO_ORGANIZATION_ID not set)');
    }
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
    runMonthlySlabEvaluation,
    runQuarterlySlabEvaluation,
    runCreditOverdueCheck,
    runPointsDriftCheck,
    runStreakReset,
    runDailyBonusRotation,
    runDailyBonusPush,
    runStreakReminder,
    runOpenAttendanceClaim,
    runRecomputeClaimable,
    runRemindUnclaimed,
    runForfeitAndPurge,
    // M4 catch-up internals (exported for unit tests)
    runStartupCatchup,
    expectedMonthlyLabel,
    expectedQuarterlyLabel,
    expectedForfeitLabel
};
