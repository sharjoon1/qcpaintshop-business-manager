/**
 * LEAD FOLLOWUP REMINDER SCHEDULER
 * Sends daily notifications to staff about due and overdue lead follow-ups
 * Cron: 8:00 AM IST daily (0 8 * * * Asia/Kolkata)
 */

const cron = require('node-cron');
const { isClusterPrimary } = require('./cluster-guard');

let pool, notificationService;

/**
 * Initialize the scheduler with dependencies
 * @param {object} dbPool - MySQL connection pool
 * @param {object} notifService - Notification service instance
 */
function init(dbPool, notifService) {
    pool = dbPool;
    notificationService = notifService;

    // Only the PM2 cluster-primary worker registers the cron, so reminders don't multi-fire
    // under cluster mode (matches data-retention/production-monitor/ai-scheduler/etc.).
    if (!isClusterPrimary()) {
        console.log('[Lead Reminders] skipping cron registration — not PM2 cluster primary');
        return;
    }
    cron.schedule('0 8 * * *', sendDailyReminders, { timezone: 'Asia/Kolkata' });
    console.log('[Lead Reminders] Scheduler initialized — runs at 8:00 AM IST daily');
}

/**
 * Send daily lead follow-up reminders to assigned staff
 */
async function sendDailyReminders() {
    console.log('[Lead Reminders] Running daily follow-up reminder check...');

    try {
        // 1. Staff with follow-ups due today
        const [todayRows] = await pool.query(`
            SELECT assigned_to, COUNT(*) as count
            FROM leads
            WHERE next_followup_date = CURDATE()
              AND status NOT IN ('won','lost','inactive')
              AND assigned_to IS NOT NULL
            GROUP BY assigned_to
        `);

        let todayNotified = 0;
        for (const row of todayRows) {
            try {
                await notificationService.send(row.assigned_to, {
                    type: 'lead_followup_reminder',
                    title: 'Lead Follow-ups Today',
                    body: `You have ${row.count} lead follow-up${row.count > 1 ? 's' : ''} scheduled for today`,
                    data: { count: row.count, type: 'today' }
                });
                todayNotified++;
            } catch (err) {
                console.error(`[Lead Reminders] Failed to notify user ${row.assigned_to} (today):`, err.message);
            }
        }

        // 2. Staff with overdue follow-ups
        const [overdueRows] = await pool.query(`
            SELECT assigned_to, COUNT(*) as count
            FROM leads
            WHERE next_followup_date < CURDATE()
              AND status NOT IN ('won','lost','inactive')
              AND assigned_to IS NOT NULL
            GROUP BY assigned_to
        `);

        let overdueNotified = 0;
        for (const row of overdueRows) {
            try {
                await notificationService.send(row.assigned_to, {
                    type: 'lead_followup_reminder',
                    title: 'Overdue Lead Follow-ups',
                    body: `You have ${row.count} overdue lead follow-up${row.count > 1 ? 's' : ''}. Please follow up today.`,
                    data: { count: row.count, type: 'overdue' }
                });
                overdueNotified++;
            } catch (err) {
                console.error(`[Lead Reminders] Failed to notify user ${row.assigned_to} (overdue):`, err.message);
            }
        }

        console.log(`[Lead Reminders] Done — ${todayNotified} staff notified for today's follow-ups, ${overdueNotified} staff notified for overdue follow-ups`);
    } catch (err) {
        console.error('[Lead Reminders] Scheduler error:', err.message);
    }
}

module.exports = { init };
