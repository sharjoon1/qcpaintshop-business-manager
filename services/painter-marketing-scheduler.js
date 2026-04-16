const cron = require('node-cron');

const DEFAULT_CFG = {
    daily_quota: 10,
    recycle_days_new: 7,
    recycle_days_callback: 3,
    recycle_days_will_visit: 14,
    recycle_days_already_aware: 60,
    recycle_days_not_interested: 30,
    recycle_days_unreachable: 60,
    recycle_days_active_painter: 45
};

function addDays(date, days) {
    const d = new Date(date.getTime());
    d.setUTCDate(d.getUTCDate() + days);
    return d;
}

function applyOutcome({ outcome, callbackDate = null, consecutiveNoAnswer = 0, currentStatus = 'new', cfg = DEFAULT_CFG, today = new Date() }) {
    switch (outcome) {
        case 'interested_in_program':
            return { status: 'interested', next_eligible_date: addDays(today, cfg.recycle_days_new ?? 7) };
        case 'wants_callback':
            return {
                status: 'in_progress',
                next_eligible_date: callbackDate ? new Date(`${callbackDate}T00:00:00Z`) : addDays(today, cfg.recycle_days_callback ?? 3)
            };
        case 'will_visit_shop':
            return { status: 'in_progress', next_eligible_date: addDays(today, cfg.recycle_days_will_visit ?? 14) };
        case 'already_aware':
            return { status: 'in_progress', next_eligible_date: addDays(today, cfg.recycle_days_already_aware ?? 60) };
        case 'not_interested':
            return { status: 'not_interested', next_eligible_date: addDays(today, cfg.recycle_days_not_interested ?? 30) };
        case 'wrong_number':
            return { status: 'wrong_number', next_eligible_date: null };
        case 'no_answer':
            if (consecutiveNoAnswer >= 5) {
                return { status: 'unreachable', next_eligible_date: addDays(today, cfg.recycle_days_unreachable ?? 60) };
            }
            return { status: currentStatus, next_eligible_date: addDays(today, cfg.recycle_days_callback ?? 3) };
        default:
            return { status: currentStatus, next_eligible_date: addDays(today, 1) };
    }
}

async function getConfig(pool, branchId, userId = null) {
    const [branchCfg] = await pool.query(
        `SELECT * FROM painter_marketing_config WHERE scope='branch' AND scope_id=? LIMIT 1`,
        [branchId]
    );
    let cfg = branchCfg[0] ? { ...DEFAULT_CFG, ...branchCfg[0] } : { ...DEFAULT_CFG };
    if (userId) {
        const [userCfg] = await pool.query(
            `SELECT * FROM painter_marketing_config WHERE scope='user' AND scope_id=? LIMIT 1`,
            [userId]
        );
        if (userCfg[0]) cfg = { ...cfg, ...userCfg[0] };
    }
    return cfg;
}

async function generateDailyLists(pool) {
    const [branches] = await pool.query(`SELECT id FROM branches WHERE status='active'`);
    const stats = { branches: 0, staff: 0, assignments: 0 };
    for (const br of branches) {
        stats.branches++;
        const [staff] = await pool.query(
            `SELECT id FROM users WHERE branch_id = ? AND role IN ('staff','manager') AND is_active = 1`,
            [br.id]
        );
        for (const s of staff) {
            stats.staff++;
            const cfg = await getConfig(pool, br.id, s.id);
            const quota = Number(cfg.daily_quota || 10);
            const [eligible] = await pool.query(
                `SELECT id FROM painter_leads
                 WHERE branch_id = ?
                   AND assigned_to = ?
                   AND status IN ('new','in_progress','interested','unreachable')
                   AND (next_eligible_date IS NULL OR next_eligible_date <= CURDATE())
                   AND id NOT IN (
                       SELECT painter_lead_id FROM painter_daily_assignments WHERE assigned_date = CURDATE()
                   )
                 ORDER BY
                    FIELD(status,'interested','in_progress','new','unreachable'),
                    COALESCE(last_contact_date, '1970-01-01') ASC
                 LIMIT ?`,
                [br.id, s.id, quota]
            );
            for (const lead of eligible) {
                await pool.query(
                    `INSERT IGNORE INTO painter_daily_assignments (user_id, branch_id, painter_lead_id, assigned_date)
                     VALUES (?, ?, ?, CURDATE())`,
                    [s.id, br.id, lead.id]
                );
                stats.assignments++;
            }
        }
    }
    return stats;
}

async function assignNewLead(pool, painterLeadId, branchId) {
    const [candidates] = await pool.query(
        `SELECT u.id, COUNT(pl.id) AS cnt
         FROM users u LEFT JOIN painter_leads pl ON pl.assigned_to = u.id AND pl.status NOT IN ('converted','active_painter','wrong_number','duplicate')
         WHERE u.branch_id = ? AND u.role IN ('staff','manager') AND u.is_active = 1
         GROUP BY u.id ORDER BY cnt ASC LIMIT 1`,
        [branchId]
    );
    if (!candidates.length) return null;
    const userId = candidates[0].id;
    await pool.query(`UPDATE painter_leads SET assigned_to = ? WHERE id = ?`, [userId, painterLeadId]);
    return userId;
}

let _registered = false;
function registerCron({ pool, zohoApi, pntrImportService, backfillService, painterZohoSyncService }) {
    if (_registered) return;
    _registered = true;
    cron.schedule('30 2 * * *', async () => {
        try { await pntrImportService.runIncrementalImport({ pool, zohoApi }); }
        catch (e) { console.error('[pntr-marketing] incremental import failed', e.message); }
    }, { timezone: 'Asia/Kolkata' });
    cron.schedule('0 3 * * *', async () => {
        try { await painterZohoSyncService.retryQueue({ pool, zohoApi }); }
        catch (e) { console.error('[pntr-marketing] retry queue failed', e.message); }
    }, { timezone: 'Asia/Kolkata' });
    cron.schedule('30 3 * * *', async () => {
        try { await backfillService.runDailyIncremental({ pool }); }
        catch (e) { console.error('[pntr-marketing] backfill daily failed', e.message); }
    }, { timezone: 'Asia/Kolkata' });
    cron.schedule('0 6 * * *', async () => {
        try { await generateDailyLists(pool); }
        catch (e) { console.error('[pntr-marketing] daily list gen failed', e.message); }
    }, { timezone: 'Asia/Kolkata' });
    console.log('[pntr-marketing] crons registered: 02:30, 03:00, 03:30, 06:00 IST');
}

module.exports = {
    applyOutcome,
    getConfig,
    generateDailyLists,
    assignNewLead,
    registerCron,
    DEFAULT_CFG
};
