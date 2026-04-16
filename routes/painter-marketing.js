/**
 * Painter Marketing Routes (PNTR bulk import + daily list + conversion + backfill)
 */
const express = require('express');
const { z } = require('zod');
const { requireAuth, requirePermission } = require('../middleware/permissionMiddleware');
const { validate } = require('../middleware/validate');
const { applyOutcome, generateDailyLists, assignNewLead } = require('../services/painter-marketing-scheduler');
const pntrImport = require('../services/pntr-import-service');
const painterZohoSync = require('../services/painter-zoho-sync-service');
const backfill = require('../services/painter-points-backfill-service');
const zohoApi = require('../services/zoho-api');

const router = express.Router();
let pool;
function setPool(p) { pool = p; }

let sessionManager;
function setSessionManager(sm) { sessionManager = sm; }

// ─────────── STAFF ENDPOINTS ───────────

router.get('/me/today', requirePermission('painters', 'marketing_view'), async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT pl.*, pda.contacted_at, pda.contact_outcome, pda.id AS assignment_id
             FROM painter_daily_assignments pda
             JOIN painter_leads pl ON pl.id = pda.painter_lead_id
             WHERE pda.user_id = ? AND pda.assigned_date = CURDATE()
             ORDER BY pda.contacted_at IS NULL DESC,
                      FIELD(pl.status,'interested','in_progress','new','unreachable'),
                      pl.last_contact_date ASC`,
            [req.user.id]
        );
        res.json({ success: true, list: rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/me/painters', requirePermission('painters', 'marketing_view'), async (req, res) => {
    try {
        const { status, search } = req.query;
        const params = [req.user.id];
        let where = `WHERE assigned_to = ?`;
        if (status) { where += ` AND status = ?`; params.push(status); }
        if (search) { where += ` AND (full_name LIKE ? OR phone LIKE ?)`; params.push(`%${search}%`, `%${search}%`); }
        const [rows] = await pool.query(
            `SELECT * FROM painter_leads ${where} ORDER BY last_contact_date DESC LIMIT 200`, params
        );
        res.json({ success: true, list: rows });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

const followupSchema = z.object({
    followup_type: z.enum(['call', 'whatsapp', 'visit']),
    call_status: z.enum(['connected', 'not_answered', 'wrong_number', 'switched_off', 'busy']).nullable().optional(),
    outcome: z.enum([
        'interested_in_program', 'already_aware', 'will_visit_shop',
        'wants_callback', 'not_interested', 'wrong_number', 'no_answer'
    ]).nullable().optional(),
    next_followup_date: z.string().nullable().optional(),
    notes: z.string().nullable().optional()
});
router.post('/leads/:id/followup', requirePermission('painters', 'marketing_contact'),
    validate(followupSchema), async (req, res) => {
    try {
        const leadId = Number(req.params.id);
        const body = req.body;
        await pool.query(
            `INSERT INTO painter_lead_followups
                (painter_lead_id, user_id, followup_type, call_status, outcome, next_followup_date, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [leadId, req.user.id, body.followup_type, body.call_status || null, body.outcome || null,
             body.next_followup_date || null, body.notes || null]
        );

        const [leadRows] = await pool.query(`SELECT status, branch_id FROM painter_leads WHERE id = ?`, [leadId]);
        if (!leadRows.length) return res.status(404).json({ success: false, error: 'lead_not_found' });
        const currentStatus = leadRows[0].status;
        const branchId = leadRows[0].branch_id;
        const [cfgRows] = await pool.query(
            `SELECT * FROM painter_marketing_config WHERE scope='branch' AND scope_id=? LIMIT 1`, [branchId]
        );
        const cfg = cfgRows[0] || {};

        const [recent] = await pool.query(
            `SELECT outcome FROM painter_lead_followups WHERE painter_lead_id = ?
             ORDER BY id DESC LIMIT 5`, [leadId]
        );
        const consecutive = recent.length && recent.every(r => r.outcome === 'no_answer') ? recent.length : 0;

        const effective = applyOutcome({
            outcome: body.outcome,
            callbackDate: body.next_followup_date,
            consecutiveNoAnswer: consecutive,
            currentStatus,
            cfg
        });

        const connected = body.call_status === 'connected' ? 1 : 0;
        await pool.query(
            `UPDATE painter_leads
             SET last_contact_date = NOW(),
                 last_outcome = ?,
                 status = ?,
                 next_eligible_date = ?,
                 total_attempts = total_attempts + 1,
                 contact_count = contact_count + ?
             WHERE id = ?`,
            [body.outcome, effective.status,
             effective.next_eligible_date ? effective.next_eligible_date.toISOString().slice(0, 10) : null,
             connected, leadId]
        );
        await pool.query(
            `UPDATE painter_daily_assignments
             SET contacted_at = NOW(), contact_outcome = ?
             WHERE painter_lead_id = ? AND user_id = ? AND assigned_date = CURDATE()`,
            [body.outcome, leadId, req.user.id]
        );
        res.json({ success: true, new_status: effective.status, next_eligible: effective.next_eligible_date });
    } catch (err) { console.error('[pntr-marketing] followup failed', err); res.status(500).json({ success: false, error: err.message }); }
});

const convertSchema = z.object({
    referral_source: z.string().nullable().optional(),
    preferred_brands: z.array(z.string()).nullable().optional(),
    notes: z.string().nullable().optional()
});
router.post('/leads/:id/convert', requirePermission('painters', 'marketing_convert'),
    validate(convertSchema), async (req, res) => {
    const leadId = Number(req.params.id);
    const [leadRows] = await pool.query(`SELECT * FROM painter_leads WHERE id = ? LIMIT 1`, [leadId]);
    if (!leadRows.length) return res.status(404).json({ success: false, error: 'lead_not_found' });
    const lead = leadRows[0];
    if (lead.painter_id) return res.status(409).json({ success: false, error: 'already_converted' });

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [insRes] = await conn.query(
            `INSERT INTO painters
                (full_name, phone, email, branch_id, status, created_via, source_lead_id, zoho_customer_id, activated_at)
             VALUES (?, ?, ?, ?, 'approved', 'staff_convert', ?, ?, NULL)`,
            [lead.full_name, lead.phone, lead.email, lead.branch_id, lead.id, lead.zoho_customer_id || null]
        );
        const painterId = insRes.insertId;
        await conn.query(
            `UPDATE painter_leads SET painter_id = ?, status='converted', converted_at = NOW() WHERE id = ?`,
            [painterId, leadId]
        );
        await conn.commit();
        painterZohoSync.syncPainterToZoho(painterId, { pool, zohoApi })
            .catch(err => console.error('[pntr-marketing] zoho sync after convert failed', err.message));
        res.json({ success: true, painter_id: painterId });
    } catch (err) {
        await conn.rollback();
        console.error('[pntr-marketing] convert failed', err);
        res.status(500).json({ success: false, error: err.message });
    } finally {
        conn.release();
    }
});

// ─────────── ADMIN ENDPOINTS ───────────

router.post('/admin/import/bulk', requirePermission('painters', 'marketing_manage'), async (req, res) => {
    try {
        const result = await pntrImport.runBulkImport({ pool, zohoApi, triggeredBy: req.user.id, runType: 'manual' });
        res.json({ success: true, ...result });
    } catch (err) { console.error('[pntr-bulk-import] failed', err); res.status(500).json({ success: false, error: err.message }); }
});

router.post('/admin/import/incremental', requirePermission('painters', 'marketing_manage'), async (req, res) => {
    try {
        const result = await pntrImport.runIncrementalImport({ pool, zohoApi, triggeredBy: req.user.id });
        res.json({ success: true, ...result });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/admin/import/runs', requirePermission('painters', 'marketing_manage'), async (req, res) => {
    const [rows] = await pool.query(`SELECT * FROM painter_pntr_import_runs ORDER BY id DESC LIMIT 50`);
    res.json({ success: true, runs: rows });
});

router.get('/admin/queues/unassigned', requirePermission('painters', 'marketing_manage'), async (req, res) => {
    const [rows] = await pool.query(
        `SELECT * FROM painter_leads WHERE branch_id IS NULL ORDER BY imported_at DESC LIMIT 500`
    );
    res.json({ success: true, list: rows });
});

router.post('/admin/queues/unassigned/assign', requirePermission('painters', 'marketing_manage'), async (req, res) => {
    const { ids, branch_id } = req.body;
    if (!Array.isArray(ids) || !ids.length || !branch_id) {
        return res.status(400).json({ success: false, error: 'ids + branch_id required' });
    }
    await pool.query(
        `UPDATE painter_leads SET branch_id = ?, branch_detected_via='admin_assign'
         WHERE id IN (${ids.map(() => '?').join(',')})`,
        [branch_id, ...ids]
    );
    for (const id of ids) await assignNewLead(pool, id, branch_id);
    res.json({ success: true, count: ids.length });
});

router.get('/admin/leads', requirePermission('painters', 'marketing_view'), async (req, res) => {
    try {
        const { branch_id, status, search, page = 1, limit = 50 } = req.query;
        const offset = (Number(page) - 1) * Number(limit);
        const conditions = [];
        const params = [];

        if (branch_id === 'unassigned') {
            conditions.push('pl.branch_id IS NULL');
        } else if (branch_id) {
            conditions.push('pl.branch_id = ?');
            params.push(Number(branch_id));
        }
        if (status) {
            conditions.push('pl.status = ?');
            params.push(status);
        }
        if (search) {
            conditions.push('(pl.full_name LIKE ? OR pl.phone LIKE ?)');
            params.push(`%${search}%`, `%${search}%`);
        }

        const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';

        const [leads] = await pool.query(
            `SELECT pl.id, pl.full_name, pl.phone, pl.branch_id, pl.status,
                    pl.total_attempts, pl.last_contact_date, pl.imported_at,
                    b.name AS branch_name,
                    u.full_name AS staff_name, pl.assigned_to
             FROM painter_leads pl
             LEFT JOIN branches b ON b.id = pl.branch_id
             LEFT JOIN users u ON u.id = pl.assigned_to
             ${where}
             ORDER BY pl.imported_at DESC
             LIMIT ? OFFSET ?`,
            [...params, Number(limit), offset]
        );

        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) AS total FROM painter_leads pl ${where}`,
            params
        );
        const [[{ unassigned_count }]] = await pool.query(
            `SELECT COUNT(*) AS unassigned_count FROM painter_leads WHERE branch_id IS NULL`
        );

        res.json({ success: true, leads, total, unassigned_count });
    } catch (err) {
        console.error('[admin/leads]', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

router.put('/admin/leads/:id/assign', requirePermission('painters', 'marketing_manage'), async (req, res) => {
    try {
        const leadId = Number(req.params.id);
        const { branch_id, assigned_to } = req.body;
        if (!branch_id) return res.status(400).json({ success: false, error: 'branch_id required' });

        let staffId = assigned_to || null;
        if (!staffId) {
            await assignNewLead(pool, leadId, branch_id);
            const [[updated]] = await pool.query(
                `SELECT pl.assigned_to, u.full_name AS staff_name
                 FROM painter_leads pl LEFT JOIN users u ON u.id = pl.assigned_to
                 WHERE pl.id = ?`, [leadId]
            );
            return res.json({ success: true, assigned_to: updated.assigned_to, staff_name: updated.staff_name });
        }

        await pool.query(
            `UPDATE painter_leads SET branch_id = ?, assigned_to = ?, branch_detected_via = 'admin_assign' WHERE id = ?`,
            [branch_id, staffId, leadId]
        );
        const [[{ staff_name }]] = await pool.query(`SELECT full_name AS staff_name FROM users WHERE id = ?`, [staffId]);
        res.json({ success: true, assigned_to: staffId, staff_name });
    } catch (err) {
        console.error('[admin/leads/assign]', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/admin/leads/:id/history', requirePermission('painters', 'marketing_view'), async (req, res) => {
    try {
        const [history] = await pool.query(
            `SELECT plf.followup_type, plf.call_status, plf.outcome, plf.notes, plf.created_at,
                    u.full_name AS staff_name
             FROM painter_lead_followups plf
             LEFT JOIN users u ON u.id = plf.user_id
             WHERE plf.painter_lead_id = ?
             ORDER BY plf.created_at DESC`,
            [Number(req.params.id)]
        );
        res.json({ success: true, history });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/admin/branches/:branch_id/staff', requirePermission('painters', 'marketing_manage'), async (req, res) => {
    try {
        const [staff] = await pool.query(
            `SELECT DISTINCT u.id, u.full_name
             FROM users u
             JOIN user_roles ur ON ur.user_id = u.id
             JOIN role_permissions rp ON rp.role_id = ur.role_id
             WHERE rp.module = 'painters' AND rp.action = 'marketing_contact'
               AND u.branch_id = ? AND u.status = 'active'
             ORDER BY u.full_name`,
            [Number(req.params.id)]
        );
        res.json({ success: true, staff });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/admin/leads/:id/send-wa', requirePermission('painters', 'marketing_manage'), async (req, res) => {
    try {
        const leadId = Number(req.params.id);
        const { message } = req.body;
        if (!message || !message.trim()) return res.status(400).json({ success: false, error: 'message required' });

        const [[lead]] = await pool.query(`SELECT phone, full_name FROM painter_leads WHERE id = ?`, [leadId]);
        if (!lead) return res.status(404).json({ success: false, error: 'Lead not found' });

        const digits = String(lead.phone).replace(/\D/g, '');
        let waPhone = digits;
        if (digits.length === 10) waPhone = '91' + digits;
        else if (digits.length === 12 && digits.startsWith('91')) waPhone = digits;
        else return res.status(400).json({ success: false, error: 'Invalid phone number' });

        if (!sessionManager) return res.status(503).json({ success: false, error: 'WhatsApp session not available' });

        await sessionManager.sendMessage(0, waPhone + '@c.us', message, { source: 'painter_marketing_admin' });

        await pool.query(
            `INSERT INTO painter_lead_followups (painter_lead_id, user_id, followup_type, outcome, notes)
             VALUES (?, ?, 'whatsapp', 'message_sent', ?)`,
            [leadId, req.user.id, message]
        );

        await pool.query(
            `UPDATE painter_leads SET last_contact_date = NOW(), total_attempts = total_attempts + 1 WHERE id = ?`,
            [leadId]
        );

        res.json({ success: true });
    } catch (err) {
        console.error('[admin/send-wa]', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/admin/queues/duplicates', requirePermission('painters', 'marketing_manage'), async (req, res) => {
    const [rows] = await pool.query(
        `SELECT dq.*, pl.full_name AS original_name, pl.phone AS original_phone
         FROM painter_lead_duplicate_queue dq
         LEFT JOIN painter_leads pl ON pl.id = dq.original_painter_lead_id
         WHERE dq.resolution = 'pending' ORDER BY dq.id ASC LIMIT 500`
    );
    res.json({ success: true, list: rows });
});

router.post('/admin/queues/duplicates/:id/resolve', requirePermission('painters', 'marketing_manage'), async (req, res) => {
    const { resolution, notes } = req.body;
    if (!['merged', 'kept_original', 'kept_duplicate', 'ignored'].includes(resolution)) {
        return res.status(400).json({ success: false, error: 'invalid_resolution' });
    }
    await pool.query(
        `UPDATE painter_lead_duplicate_queue
         SET resolution = ?, resolved_by = ?, resolved_at = NOW(), notes = ?
         WHERE id = ?`,
        [resolution, req.user.id, notes || null, req.params.id]
    );
    res.json({ success: true });
});

router.get('/admin/queues/salesperson-unmatched', requirePermission('painters', 'marketing_manage'), async (req, res) => {
    const [rows] = await pool.query(
        `SELECT * FROM painter_zoho_salesperson_map WHERE match_confidence='unmatched' ORDER BY id DESC LIMIT 500`
    );
    res.json({ success: true, list: rows });
});

router.post('/admin/queues/salesperson-unmatched/:id/link', requirePermission('painters', 'marketing_manage'), async (req, res) => {
    const { painter_id } = req.body;
    if (!painter_id) return res.status(400).json({ success: false, error: 'painter_id required' });
    await pool.query(
        `UPDATE painter_zoho_salesperson_map
         SET painter_id = ?, match_confidence='exact_name' WHERE id = ?`,
        [painter_id, req.params.id]
    );
    const [spRow] = await pool.query(`SELECT zoho_salesperson_id FROM painter_zoho_salesperson_map WHERE id = ?`, [req.params.id]);
    if (spRow.length) {
        await pool.query(`UPDATE painters SET zoho_salesperson_id = ? WHERE id = ?`, [spRow[0].zoho_salesperson_id, painter_id]);
    }
    res.json({ success: true });
});

router.get('/admin/config', requirePermission('painters', 'marketing_manage'), async (req, res) => {
    const { scope, scope_id } = req.query;
    if (!scope || !scope_id) return res.status(400).json({ success: false, error: 'scope+scope_id required' });
    const [rows] = await pool.query(
        `SELECT * FROM painter_marketing_config WHERE scope = ? AND scope_id = ? LIMIT 1`,
        [scope, scope_id]
    );
    res.json({ success: true, config: rows[0] || null });
});

router.post('/admin/config', requirePermission('painters', 'marketing_manage'), async (req, res) => {
    const {
        scope, scope_id, daily_quota,
        recycle_days_new, recycle_days_callback, recycle_days_will_visit,
        recycle_days_already_aware, recycle_days_not_interested,
        recycle_days_unreachable, recycle_days_active_painter
    } = req.body;
    if (!['branch', 'user'].includes(scope) || !scope_id) return res.status(400).json({ success: false, error: 'invalid_scope' });
    await pool.query(
        `INSERT INTO painter_marketing_config
            (scope, scope_id, daily_quota, recycle_days_new, recycle_days_callback, recycle_days_will_visit,
             recycle_days_already_aware, recycle_days_not_interested, recycle_days_unreachable, recycle_days_active_painter)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            daily_quota = VALUES(daily_quota),
            recycle_days_new = VALUES(recycle_days_new),
            recycle_days_callback = VALUES(recycle_days_callback),
            recycle_days_will_visit = VALUES(recycle_days_will_visit),
            recycle_days_already_aware = VALUES(recycle_days_already_aware),
            recycle_days_not_interested = VALUES(recycle_days_not_interested),
            recycle_days_unreachable = VALUES(recycle_days_unreachable),
            recycle_days_active_painter = VALUES(recycle_days_active_painter),
            updated_at = CURRENT_TIMESTAMP`,
        [scope, scope_id, daily_quota || 10,
         recycle_days_new || 7, recycle_days_callback || 3, recycle_days_will_visit || 14,
         recycle_days_already_aware || 60, recycle_days_not_interested || 30,
         recycle_days_unreachable || 60, recycle_days_active_painter || 45]
    );
    res.json({ success: true });
});

router.post('/admin/generate-daily-lists', requirePermission('painters', 'marketing_manage'), async (req, res) => {
    try {
        const stats = await generateDailyLists(pool);
        res.json({ success: true, ...stats });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/admin/backfill/preview', requirePermission('painters', 'marketing_manage'), async (req, res) => {
    const { from_date, painter_ids } = req.body;
    if (!from_date) return res.status(400).json({ success: false, error: 'from_date required' });
    try {
        const preview = await backfill.previewBackfill({ pool, fromDate: from_date, painterIds: painter_ids || null });
        res.json({ success: true, ...preview });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.post('/admin/backfill/run', requirePermission('painters', 'marketing_manage'), async (req, res) => {
    const { from_date, painter_ids } = req.body;
    if (!from_date) return res.status(400).json({ success: false, error: 'from_date required' });
    try {
        const summary = await backfill.runBulkBackfill({ pool, fromDate: from_date, painterIds: painter_ids || null });
        res.json({ success: true, ...summary });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

router.get('/admin/performance', requirePermission('painters', 'marketing_manage'), async (req, res) => {
    const { from, to, branch_id } = req.query;
    const params = [];
    let where = `WHERE 1=1`;
    if (from) { where += ` AND pda.assigned_date >= ?`; params.push(from); }
    if (to) { where += ` AND pda.assigned_date <= ?`; params.push(to); }
    if (branch_id) { where += ` AND pda.branch_id = ?`; params.push(branch_id); }
    const [stats] = await pool.query(
        `SELECT
            pda.user_id, u.full_name, pda.branch_id,
            COUNT(*) AS total_assigned,
            SUM(CASE WHEN pda.contacted_at IS NOT NULL THEN 1 ELSE 0 END) AS contacted,
            SUM(CASE WHEN pda.contact_outcome IN ('interested_in_program') THEN 1 ELSE 0 END) AS interested
         FROM painter_daily_assignments pda
         LEFT JOIN users u ON u.id = pda.user_id
         ${where}
         GROUP BY pda.user_id, pda.branch_id
         ORDER BY contacted DESC`,
        params
    );
    res.json({ success: true, stats });
});

module.exports = { router, setPool, setSessionManager };
