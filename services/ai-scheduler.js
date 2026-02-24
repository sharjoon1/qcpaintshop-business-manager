/**
 * AI Scheduler - Cron orchestrator for all automated AI analysis jobs
 * Configurable schedules via ai_config table
 */

const cron = require('node-cron');

const aiEngine = require('./ai-engine');
const aiAnalyzer = require('./ai-analyzer');
const aiStaffAnalyzer = require('./ai-staff-analyzer');
const aiLeadManager = require('./ai-lead-manager');
const aiMarketing = require('./ai-marketing');
const contextBuilder = require('./ai-context-builder');

let pool = null;
let sessionManager = null;
let io = null;
let registry = null;
const jobs = {};

function setPool(p) {
    pool = p;
    aiEngine.setPool(p);
    aiAnalyzer.setPool(p);
    aiStaffAnalyzer.setPool(p);
    aiLeadManager.setPool(p);
    aiMarketing.setPool(p);
    contextBuilder.setPool(p);
}
function setSessionManager(sm) { sessionManager = sm; }
function setIO(i) { io = i; }
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

// ─── WhatsApp Delivery ─────────────────────────────────────────

async function sendWhatsAppReport(message) {
    if (!sessionManager) return;
    try {
        const enabled = await getConfig('whatsapp_reports_enabled');
        if (enabled !== '1') return;

        const recipients = await getConfig('whatsapp_report_recipients');
        if (!recipients) return;

        const phones = recipients.split(',').map(p => p.trim()).filter(Boolean);
        for (const phone of phones) {
            try {
                await sessionManager.sendMessage(0, phone, message, { source: 'ai_report' });
            } catch (e) {
                console.error(`[AI Scheduler] Failed to send WhatsApp to ${phone}:`, e.message);
            }
        }
    } catch (e) {
        console.error('[AI Scheduler] WhatsApp delivery error:', e.message);
    }
}

// ─── Job Runners ───────────────────────────────────────────────

async function runZohoDaily() {
    try {
        const enabled = await getConfig('zoho_daily_enabled');
        if (enabled !== '1') { console.log('[AI Scheduler] Zoho daily analysis disabled'); return; }

        console.log('[AI Scheduler] Running Zoho daily analysis...');
        if (registry) registry.markRunning('ai-zoho-daily');
        const result = await aiAnalyzer.runZohoAnalysis('daily');
        console.log(`[AI Scheduler] Zoho daily done: ${result.insights.length} insights, ${result.tokensUsed} tokens`);
        if (registry) registry.markCompleted('ai-zoho-daily', { recordsProcessed: result.insights.length });

        // Send WhatsApp summary
        const waMessage = aiAnalyzer.buildWhatsAppSummary(result);
        await sendWhatsAppReport(waMessage);

        // Notify admin UI via socket
        if (io) io.to('ai_dashboard').emit('analysis_complete', { type: 'zoho_daily', runId: result.runId });

    } catch (e) {
        console.error('[AI Scheduler] Zoho daily analysis failed:', e.message);
        if (registry) registry.markFailed('ai-zoho-daily', { error: e.message });
    }
}

async function runZohoWeekly() {
    try {
        const enabled = await getConfig('zoho_daily_enabled'); // shares config
        if (enabled !== '1') return;

        console.log('[AI Scheduler] Running Zoho weekly analysis...');
        if (registry) registry.markRunning('ai-zoho-weekly');
        const result = await aiAnalyzer.runZohoAnalysis('weekly');
        console.log(`[AI Scheduler] Zoho weekly done: ${result.insights.length} insights`);
        if (registry) registry.markCompleted('ai-zoho-weekly', { recordsProcessed: result.insights.length });

        const waMessage = aiAnalyzer.buildWhatsAppSummary(result);
        await sendWhatsAppReport(waMessage);

        if (io) io.to('ai_dashboard').emit('analysis_complete', { type: 'zoho_weekly', runId: result.runId });
    } catch (e) {
        console.error('[AI Scheduler] Zoho weekly analysis failed:', e.message);
        if (registry) registry.markFailed('ai-zoho-weekly', { error: e.message });
    }
}

async function runStaffDaily() {
    try {
        const enabled = await getConfig('staff_daily_enabled');
        if (enabled !== '1') { console.log('[AI Scheduler] Staff daily analysis disabled'); return; }

        console.log('[AI Scheduler] Running staff daily analysis...');
        if (registry) registry.markRunning('ai-staff-daily');
        const result = await aiStaffAnalyzer.runStaffAnalysis('daily');
        console.log(`[AI Scheduler] Staff daily done: ${result.insights.length} insights`);
        if (registry) registry.markCompleted('ai-staff-daily', { recordsProcessed: result.insights.length });

        const waMessage = aiStaffAnalyzer.buildWhatsAppSummary(result);
        await sendWhatsAppReport(waMessage);

        if (io) io.to('ai_dashboard').emit('analysis_complete', { type: 'staff_daily', runId: result.runId });
    } catch (e) {
        console.error('[AI Scheduler] Staff daily analysis failed:', e.message);
        if (registry) registry.markFailed('ai-staff-daily', { error: e.message });
    }
}

async function runLeadScoring() {
    try {
        const enabled = await getConfig('lead_scoring_enabled');
        if (enabled !== '1') { console.log('[AI Scheduler] Lead scoring disabled'); return; }

        console.log('[AI Scheduler] Running lead scoring...');
        if (registry) registry.markRunning('ai-lead-scoring');
        const result = await aiLeadManager.scoreAllLeads();
        console.log(`[AI Scheduler] Lead scoring done: ${result.totalScored} leads scored`);
        if (registry) registry.markCompleted('ai-lead-scoring', { recordsProcessed: result.totalScored });

        // Check for stale leads and send alerts
        const staleLeads = await aiLeadManager.getStalLeads(7);
        if (staleLeads.length > 0) {
            let msg = `🔔 *Stale Lead Alert*\n${staleLeads.length} leads with no activity in 7+ days:\n\n`;
            staleLeads.slice(0, 10).forEach(l => {
                msg += `• ${l.name} — ${l.days_inactive} days (${l.assigned_name || 'Unassigned'})\n`;
            });
            await sendWhatsAppReport(msg);
        }

        if (io) io.to('ai_dashboard').emit('analysis_complete', { type: 'lead_scoring', runId: result.runId });
    } catch (e) {
        console.error('[AI Scheduler] Lead scoring failed:', e.message);
        if (registry) registry.markFailed('ai-lead-scoring', { error: e.message });
    }
}

async function runMarketingWeekly() {
    try {
        const enabled = await getConfig('marketing_weekly_enabled');
        if (enabled !== '1') { console.log('[AI Scheduler] Marketing analysis disabled'); return; }

        console.log('[AI Scheduler] Running marketing analysis...');
        if (registry) registry.markRunning('ai-marketing-weekly');
        const result = await aiMarketing.runMarketingAnalysis();
        console.log(`[AI Scheduler] Marketing done: ${result.insights.length} insights`);
        if (registry) registry.markCompleted('ai-marketing-weekly', { recordsProcessed: result.insights.length });

        if (result.insights.length) {
            let msg = `💡 *Weekly Marketing Tips*\n\n`;
            result.insights.forEach((tip, i) => {
                msg += `${i + 1}. *${tip.title}*\n${tip.description}\n➡️ ${tip.action_recommended}\n\n`;
            });
            await sendWhatsAppReport(msg);
        }

        if (io) io.to('ai_dashboard').emit('analysis_complete', { type: 'marketing_tips', runId: result.runId });
    } catch (e) {
        console.error('[AI Scheduler] Marketing analysis failed:', e.message);
        if (registry) registry.markFailed('ai-marketing-weekly', { error: e.message });
    }
}

// ─── Daily Snapshot ───────────────────────────────────────────

async function runDailySnapshot() {
    try {
        const enabled = await getConfig('daily_snapshot_enabled');
        if (enabled !== '1') { console.log('[AI Scheduler] Daily snapshot disabled'); return; }

        console.log('[AI Scheduler] Generating daily business snapshot...');
        if (registry) registry.markRunning('ai-daily-snapshot');
        const data = await contextBuilder.generateDailySnapshot();
        console.log('[AI Scheduler] Daily snapshot generated successfully');
        if (registry) registry.markCompleted('ai-daily-snapshot', { details: 'Snapshot generated' });
        return data;
    } catch (e) {
        console.error('[AI Scheduler] Daily snapshot failed:', e.message);
        if (registry) registry.markFailed('ai-daily-snapshot', { error: e.message });
    }
}

// ─── Start / Stop ──────────────────────────────────────────────

function start() {
    // Register automations
    if (registry) {
        registry.register('ai-zoho-daily', { name: 'AI Zoho Daily', service: 'ai-scheduler', schedule: '9:00 PM IST', description: 'Daily Zoho business analysis' });
        registry.register('ai-zoho-weekly', { name: 'AI Zoho Weekly', service: 'ai-scheduler', schedule: 'Mon 8:00 AM', description: 'Weekly Zoho trend analysis' });
        registry.register('ai-staff-daily', { name: 'AI Staff Daily', service: 'ai-scheduler', schedule: '10:30 PM IST', description: 'Daily staff performance analysis' });
        registry.register('ai-lead-scoring', { name: 'AI Lead Scoring', service: 'ai-scheduler', schedule: 'Every 6h', description: 'Score and rank all leads' });
        registry.register('ai-marketing-weekly', { name: 'AI Marketing Tips', service: 'ai-scheduler', schedule: 'Mon 9:00 AM', description: 'Weekly marketing insights' });
        registry.register('ai-daily-snapshot', { name: 'Business Snapshot', service: 'ai-scheduler', schedule: '6AM/12PM/6PM', description: 'Daily business data snapshot' });
    }

    // Daily Zoho analysis — 9:00 PM IST (15:30 UTC)
    jobs.zohoDaily = cron.schedule('30 15 * * *', runZohoDaily, { timezone: 'Asia/Kolkata' });

    // Daily Staff analysis — 10:30 PM IST (17:00 UTC)
    jobs.staffDaily = cron.schedule('0 17 * * *', runStaffDaily, { timezone: 'Asia/Kolkata' });

    // Lead scoring — every 6 hours
    jobs.leadScoring = cron.schedule('0 */6 * * *', runLeadScoring, { timezone: 'Asia/Kolkata' });

    // Weekly Zoho analysis — Monday 8:00 AM IST
    jobs.zohoWeekly = cron.schedule('0 8 * * 1', runZohoWeekly, { timezone: 'Asia/Kolkata' });

    // Weekly marketing tips — Monday 9:00 AM IST
    jobs.marketingWeekly = cron.schedule('0 9 * * 1', runMarketingWeekly, { timezone: 'Asia/Kolkata' });

    // Daily business snapshots — 6 AM, 12 PM, 6 PM IST
    jobs.snapshotMorning = cron.schedule('0 6 * * *', runDailySnapshot, { timezone: 'Asia/Kolkata' });
    jobs.snapshotNoon = cron.schedule('0 12 * * *', runDailySnapshot, { timezone: 'Asia/Kolkata' });
    jobs.snapshotEvening = cron.schedule('0 18 * * *', runDailySnapshot, { timezone: 'Asia/Kolkata' });

    console.log('[AI Scheduler] Started: zoho-daily(21:00), staff-daily(22:30), lead-scoring(6h), marketing(Mon 9AM), snapshots(6AM/12PM/6PM)');
}

function stop() {
    Object.values(jobs).forEach(j => j && j.stop());
    console.log('[AI Scheduler] Stopped all jobs');
}

module.exports = {
    setPool,
    setSessionManager,
    setIO,
    setAutomationRegistry,
    start,
    stop,
    // Expose runners for manual triggering
    runZohoDaily,
    runZohoWeekly,
    runStaffDaily,
    runLeadScoring,
    runMarketingWeekly,
    runDailySnapshot
};
