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

    // 06:30 IST — FCM push "today's list ready"
    cron.schedule('30 6 * * *', async () => {
        try {
            const [rows] = await pool.query(
                `SELECT user_id, COUNT(*) AS n FROM painter_daily_assignments WHERE assigned_date = CURDATE() GROUP BY user_id`
            );
            const notif = require('./notification-service');
            for (const r of rows) {
                await notif.send(r.user_id, {
                    type: 'painter_marketing_ready',
                    title: '🎨 Today\'s painter calls',
                    body: `${r.n} painters in today's list`,
                    data: { url: '/staff-painter-marketing.html' }
                });
            }
        } catch (e) { console.error('[pntr-marketing] 06:30 push failed', e.message); }
    }, { timezone: 'Asia/Kolkata' });

    // 17:00 IST — reminder to staff < 50% complete
    cron.schedule('0 17 * * *', async () => {
        try {
            const [rows] = await pool.query(
                `SELECT user_id, COUNT(*) AS total, SUM(contacted_at IS NOT NULL) AS done
                 FROM painter_daily_assignments WHERE assigned_date = CURDATE()
                 GROUP BY user_id HAVING total > 0 AND (done * 2 < total)`
            );
            const notif = require('./notification-service');
            for (const r of rows) {
                await notif.send(r.user_id, {
                    type: 'painter_marketing_reminder',
                    title: '⚠️ Painter calls pending',
                    body: `${r.total - r.done} painter calls remaining today`,
                    data: { url: '/staff-painter-marketing.html' }
                });
            }
        } catch (e) { console.error('[pntr-marketing] 17:00 push failed', e.message); }
    }, { timezone: 'Asia/Kolkata' });

    // 18:00 IST — manager WhatsApp alert if any staff < 30% complete
    cron.schedule('0 18 * * *', async () => {
        try {
            const [low] = await pool.query(
                `SELECT pda.branch_id, u.full_name AS staff_name,
                        COUNT(*) AS total, SUM(contacted_at IS NOT NULL) AS done
                 FROM painter_daily_assignments pda JOIN users u ON u.id = pda.user_id
                 WHERE pda.assigned_date = CURDATE()
                 GROUP BY pda.user_id HAVING total > 0 AND (done * 10 < total * 3)`
            );
            if (!low.length) return;
            const byBranch = {};
            for (const r of low) { (byBranch[r.branch_id] ||= []).push(`${r.staff_name}: ${r.done}/${r.total}`); }
            const branchIds = Object.keys(byBranch);
            if (!branchIds.length) return;
            const [branches] = await pool.query(`SELECT id, manager_user_id FROM branches WHERE id IN (?)`, [branchIds]);
            const whatsapp = require('./whatsapp-session-manager');
            for (const b of branches) {
                if (!b.manager_user_id) continue;
                const [mgr] = await pool.query(`SELECT phone FROM users WHERE id = ?`, [b.manager_user_id]);
                if (!mgr[0]?.phone) continue;
                const text = `Painter marketing — underperformers today:\n${byBranch[b.id].join('\n')}`;
                await whatsapp.sendMessage(0, mgr[0].phone, text).catch(err => console.error('[pntr-marketing] WA send fail', err.message));
            }
        } catch (e) { console.error('[pntr-marketing] 18:00 WA failed', e.message); }
    }, { timezone: 'Asia/Kolkata' });

    console.log('[pntr-marketing] crons registered: 02:30, 03:00, 03:30, 06:00, 06:30, 17:00, 18:00 IST');
}

module.exports = {
    applyOutcome,
    getConfig,
    generateDailyLists,
    assignNewLead,
    registerCron,
    DEFAULT_CFG
};
