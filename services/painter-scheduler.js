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

// ─── Scheduler Start/Stop ────────────────────────────────────

function start() {
    // Register automations
    if (registry) {
        registry.register('painter-monthly-slabs', { name: 'Monthly Slab Eval', service: 'painter-scheduler', schedule: '0 6 1 * *', description: 'Monthly painter value slab evaluation' });
        registry.register('painter-quarterly-slabs', { name: 'Quarterly Slab Eval', service: 'painter-scheduler', schedule: '30 6 1 1,4,7,10 *', description: 'Quarterly painter slab evaluation' });
        registry.register('painter-credit-check', { name: 'Credit Overdue Check', service: 'painter-scheduler', schedule: '0 8 * * *', description: 'Daily painter credit overdue check' });
        registry.register('painter-streak-reset', { name: 'Streak Reset', service: 'painter-scheduler', schedule: '0 0 * * *', description: 'Midnight streak reset for inactive painters' });
        registry.register('painter-bonus-rotation', { name: 'Bonus Rotation', service: 'painter-scheduler', schedule: '5 0 * * *', description: 'Rotate daily bonus product at midnight' });
        registry.register('painter-daily-bonus-push', { name: 'Daily Bonus Push', service: 'painter-scheduler', schedule: '0 7 * * *', description: '7 AM daily bonus product notification' });
        registry.register('painter-streak-reminder', { name: 'Streak Reminder', service: 'painter-scheduler', schedule: '0 20 * * *', description: '8 PM streak-at-risk reminder' });
    }

    // Existing jobs
    jobs.monthlySlabs = cron.schedule('0 6 1 * *', runMonthlySlabEvaluation, { timezone: 'Asia/Kolkata' });
    jobs.quarterlySlabs = cron.schedule('30 6 1 1,4,7,10 *', runQuarterlySlabEvaluation, { timezone: 'Asia/Kolkata' });
    jobs.creditCheck = cron.schedule('0 8 * * *', runCreditOverdueCheck, { timezone: 'Asia/Kolkata' });

    // Retention jobs
    jobs.streakReset = cron.schedule('0 0 * * *', runStreakReset, { timezone: 'Asia/Kolkata' });
    jobs.bonusRotation = cron.schedule('5 0 * * *', runDailyBonusRotation, { timezone: 'Asia/Kolkata' });
    jobs.dailyBonusPush = cron.schedule('0 7 * * *', runDailyBonusPush, { timezone: 'Asia/Kolkata' });
    jobs.streakReminder = cron.schedule('0 20 * * *', runStreakReminder, { timezone: 'Asia/Kolkata' });

    console.log('[Painter Scheduler] Started: monthly-slabs(1st 6AM), quarterly-slabs(Q1 6:30AM), credit-check(daily 8AM), streak-reset(midnight), bonus-rotation(00:05), daily-bonus-push(7AM), streak-reminder(8PM)');
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
    runStreakReset,
    runDailyBonusRotation,
    runDailyBonusPush,
    runStreakReminder
};
