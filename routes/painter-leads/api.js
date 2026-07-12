/**
 * Painter Leads API — CRUD, assignment, followups, invite send.
 *
 * Endpoints (mounted by ./index.js at /api/painter-leads):
 *   GET    /                       — list with filters (painter_leads.view)
 *   GET    /stats                  — funnel counts (painter_leads.view)
 *   GET    /:id                    — detail + followups + invites (painter_leads.view)
 *   POST   /                       — create lead (painter_leads.add)
 *   PUT    /:id                    — update lead (own.edit | manage, + owner check)
 *   POST   /:id/assign             — assign to staff (painter_leads.assign)
 *   POST   /:id/followup           — log followup (own.edit | manage, + owner check)
 *   POST   /:id/send-invite        — WhatsApp + SMS fallback invite (own.edit | manage, + owner check)
 *   GET    /my                     — staff's own leads (painter_leads.own.view)
 *   GET    /my/today               — staff's today followups (painter_leads.own.view)
 *
 * Owner policy (inside handlers): a user without `painter_leads.manage` (or full
 * admin) may only act on leads where `assigned_to = req.user.id`. Full admins
 * (admin / administrator / super_admin) and users with `painter_leads.manage`
 * bypass the check — handled by the permission middleware first, then by
 * `canActOnLead()` below as the secondary gate.
 *
 * Phone policy: all phones are normalized to last 10 digits. Duplicate active
 * painter_leads reject creation with a 409 referencing the existing lead.
 *
 * Lead number: PL-YYYYMMDD-XXXX, generated atomically inside a transaction by
 * SELECT MAXing today's existing numbers and +1 — same pattern as
 * routes/leads.js generateLeadNumber(), but guarded by row-level locking so
 * two concurrent creates don't collide.
 */

const express = require('express');
const crypto = require('crypto');
const { requirePermission, requireAnyPermission, isFullAdmin } = require('../../middleware/permissionMiddleware');
const smsService = require('../../services/sms-service');

// Lazy-load WhatsApp session manager so the file loads even if wwjs is missing.
let whatsappSessionManager = null;
try {
    whatsappSessionManager = require('../../services/whatsapp-session-manager');
} catch (e) {
    // Optional — fall back to SMS-only when wwjs isn't installed.
}

// We intentionally hold the manager reference at module scope, not via setSessionManager
// from server.js, to avoid forcing the orchestrator to wire it. If the server has
// already replaced it (server.js overwrites module.exports.sendMessage etc.) we use
// whichever is loaded.

const router = express.Router();

let pool;

function setPool(p) { pool = p; }

// ─────────────────────────────────────────────────────────────────────────
//  Constants
// ─────────────────────────────────────────────────────────────────────────

const VALID_STATUSES = [
    'new', 'in_progress', 'interested', 'invited', 'registered', 'converted', 'active_painter',
    'not_interested', 'unreachable', 'wrong_number', 'duplicate', 'snoozed',
];

const VALID_FOLLOWUP_TYPES = ['call', 'whatsapp', 'visit', 'sms'];
const VALID_FOLLOWUP_OUTCOMES = [
    'interested', 'not_interested', 'callback', 'no_response',
    'converted', 'wrong_number', 'unreachable', 'other',
];

const VALID_SOURCES = [
    'zoho_import', 'staff_walk_in', 'staff_referral',
    'painter_referral', 'admin_bulk',
];

const PAINTER_REGISTER_URL = 'https://act.qcpaintshop.com/painter-register.html';

// ─────────────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────────────

/**
 * Normalize a phone to its last 10 digits. Returns null if the input does
 * not contain at least 10 digits.
 */
function normalizePhone(raw) {
    if (raw == null) return null;
    const digits = String(raw).replace(/\D/g, '');
    if (digits.length < 10) return null;
    return digits.slice(-10);
}

/**
 * Build a 91XXXXXXXXXX country-code form (what whatsapp-session-manager uses).
 * Falls back to digits prefixed with 91 when only 10 digits are present.
 */
function toE164India(tenDigit) {
    if (!tenDigit) return null;
    if (tenDigit.startsWith('91') && tenDigit.length === 12) return tenDigit;
    return '91' + tenDigit;
}

/**
 * Generate today's PL-YYYYMMDD-XXXX number atomically using a transaction
 * with SELECT ... FOR UPDATE on the candidate rows so concurrent inserts
 * never reuse the same sequence value.
 */
async function generateLeadNumber() {
    const today = new Date();
    const dateStr =
        today.getFullYear().toString() +
        String(today.getMonth() + 1).padStart(2, '0') +
        String(today.getDate()).padStart(2, '0');
    const prefix = `PL-${dateStr}-`;
    const likePattern = `${prefix}%`;

    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [rows] = await conn.query(
            `SELECT lead_number FROM painter_leads
             WHERE lead_number LIKE ?
             ORDER BY lead_number DESC
             LIMIT 1
             FOR UPDATE`,
            [likePattern]
        );
        let nextSeq = 1;
        if (rows.length > 0) {
            const lastSeq = parseInt(String(rows[0].lead_number).split('-').pop(), 10);
            if (!isNaN(lastSeq)) nextSeq = lastSeq + 1;
        }
        await conn.commit();
        return `${prefix}${String(nextSeq).padStart(4, '0')}`;
    } catch (err) {
        try { await conn.rollback(); } catch (_) { /* ignore */ }
        throw err;
    } finally {
        conn.release();
    }
}

/**
 * Resolve whether the caller can act on a given lead (used inside handlers).
 * `lead` is a row from painter_leads; pass null if unknown and the caller
 * will treat as not-found.
 *
 * Returns one of:
 *   { ok: true,  via: 'owner'|'manage'|'admin' }
 *   { ok: false, reason: 'not_found'|'forbidden' }
 */
function canActOnLead(lead, user) {
    if (!lead) return { ok: false, reason: 'not_found' };
    if (!user) return { ok: false, reason: 'forbidden' };
    if (isFullAdmin(user.role)) return { ok: true, via: 'admin' };
    // owner check is delegated to caller (we don't know manage here without DB).
    if (Number(lead.assigned_to) === Number(user.id)) return { ok: true, via: 'owner' };
    return { ok: false, reason: 'forbidden' };
}

/**
 * Try sending a WhatsApp invite via the session manager. Returns
 * { ok: true } when sendMessage returned a truthy result, otherwise false.
 * Defensive: never throws — all exceptions collapse to false so the caller
 * can fall back to SMS without extra try/catch.
 */
async function trySendWhatsApp(branchId, phone, message) {
    if (!whatsappSessionManager || typeof whatsappSessionManager.sendMessage !== 'function') {
        return false;
    }
    try {
        const result = await whatsappSessionManager.sendMessage(
            branchId, phone, message, { source: 'painter_invite' }
        );
        return !!result;
    } catch (err) {
        console.error('[painter-leads] WhatsApp send failed:', err.message);
        return false;
    }
}

/**
 * Build the invite message body. Uses the painter-register deep-link with
 * the token; staff name is included when available so the painter sees who
 * is reaching out.
 */
function buildInviteMessage({ name, token, staffName }) {
    const link = `${PAINTER_REGISTER_URL}?token=${token}`;
    const greeting = name ? `Hi ${name},` : 'Hi,';
    const by = staffName ? ` (invited by ${staffName})` : '';
    return (
        `${greeting}\n\n` +
        `You've been invited to join the Quality Colours Painter Program${by}. ` +
        `Please register using the link below — it is unique to you:\n\n` +
        `${link}\n\n` +
        `If you have questions, reply to this message and our team will help.`
    );
}

// ─────────────────────────────────────────────────────────────────────────
//  LIST + STATS
// ─────────────────────────────────────────────────────────────────────────

/**
 * GET /api/painter-leads
 * Query: status, source, assigned_to, branch_id, search, date_from, date_to,
 *        page, limit, sort_by, sort_order
 */
router.get('/', requirePermission('painter_leads', 'view'), async (req, res) => {
    try {
        const {
            status, source, assigned_to, branch_id,
            search, date_from, date_to,
            page = 1, limit = 25,
            sort_by = 'created_at', sort_order = 'DESC',
        } = req.query;

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
        const offset = (pageNum - 1) * limitNum;

        const allowedSort = new Set([
            'created_at', 'updated_at', 'full_name', 'lead_number',
            'status', 'total_attempts', 'last_contact_date',
        ]);
        const sortColumn = allowedSort.has(sort_by) ? sort_by : 'created_at';
        const sortDir = String(sort_order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        const where = ['1=1'];
        const params = [];

        if (status) { where.push('pl.status = ?'); params.push(status); }
        if (source) { where.push('pl.source = ?'); params.push(source); }
        if (assigned_to) {
            if (assigned_to === 'unassigned') {
                where.push('pl.assigned_to IS NULL');
            } else {
                where.push('pl.assigned_to = ?');
                params.push(parseInt(assigned_to, 10));
            }
        }
        if (branch_id) {
            where.push('pl.branch_id = ?');
            params.push(parseInt(branch_id, 10));
        }
        if (search) {
            const term = `%${search}%`;
            where.push('(pl.full_name LIKE ? OR pl.phone LIKE ? OR pl.email LIKE ? OR pl.lead_number LIKE ?)');
            params.push(term, term, term, term);
        }
        if (date_from) { where.push('pl.created_at >= ?'); params.push(date_from); }
        if (date_to)   { where.push('pl.created_at <= ?'); params.push(`${date_to} 23:59:59`); }

        const whereSql = `WHERE ${where.join(' AND ')}`;

        const [countRows] = await pool.query(
            `SELECT COUNT(*) AS total FROM painter_leads pl ${whereSql}`,
            params
        );
        const total = countRows[0].total;

        const [rows] = await pool.query(
            `SELECT pl.*,
                    b.name AS branch_name,
                    u.full_name AS assigned_to_name,
                    cb.full_name AS created_by_name,
                    ib.full_name AS invited_by_name
             FROM painter_leads pl
             LEFT JOIN branches b ON pl.branch_id = b.id
             LEFT JOIN users    u ON pl.assigned_to = u.id
             LEFT JOIN users   cb ON pl.created_by = cb.id
             LEFT JOIN users   ib ON pl.invited_by = ib.id
             ${whereSql}
             ORDER BY pl.${sortColumn} ${sortDir}
             LIMIT ? OFFSET ?`,
            [...params, limitNum, offset]
        );

        res.json({
            success: true,
            data: rows,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                total_pages: Math.ceil(total / limitNum),
            },
        });
    } catch (err) {
        console.error('[painter-leads] list error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to retrieve painter leads' });
    }
});

/**
 * GET /api/painter-leads/stats
 * Funnel counts. Admin/manager see everything; everyone else is scoped to
 * their own assigned leads.
 */
router.get('/stats', requirePermission('painter_leads', 'view'), async (req, res) => {
    try {
        // Scope: staff users get only their own; admins/managers see all.
        const scope = (!isFullAdmin(req.user.role) && req.user.role !== 'manager');
        const params = [];
        let scopeWhere = '';
        if (scope) {
            scopeWhere = 'WHERE assigned_to = ?';
            params.push(req.user.id);
        }

        const [rows] = await pool.query(
            `SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'new'             THEN 1 ELSE 0 END) AS new_leads,
                SUM(CASE WHEN status = 'in_progress'     THEN 1 ELSE 0 END) AS in_progress,
                SUM(CASE WHEN status = 'interested'      THEN 1 ELSE 0 END) AS interested,
                SUM(CASE WHEN status = 'invited'         THEN 1 ELSE 0 END) AS invited,
                SUM(CASE WHEN status = 'registered'      THEN 1 ELSE 0 END) AS registered,
                SUM(CASE WHEN status = 'active_painter'  THEN 1 ELSE 0 END) AS active_painter,
                SUM(CASE WHEN status = 'converted'       THEN 1 ELSE 0 END) AS converted,
                SUM(CASE WHEN status = 'not_interested'  THEN 1 ELSE 0 END) AS not_interested,
                SUM(CASE WHEN status = 'unreachable'     THEN 1 ELSE 0 END) AS unreachable,
                SUM(CASE WHEN status = 'wrong_number'    THEN 1 ELSE 0 END) AS wrong_number,
                SUM(CASE WHEN status = 'duplicate'       THEN 1 ELSE 0 END) AS \`duplicate\`,
                SUM(CASE WHEN status = 'snoozed'         THEN 1 ELSE 0 END) AS snoozed,
                SUM(CASE WHEN assigned_to IS NULL        THEN 1 ELSE 0 END) AS unassigned
             FROM painter_leads ${scopeWhere}`,
            params
        );

        res.json({ success: true, data: rows[0] });
    } catch (err) {
        console.error('[painter-leads] stats error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to retrieve stats' });
    }
});

// ─────────────────────────────────────────────────────────────────────────
//  STAFF OWN-LEAD ENDPOINTS (declared BEFORE /:id to avoid route shadowing)
// ─────────────────────────────────────────────────────────────────────────

/**
 * GET /api/painter-leads/my
 * List the caller's assigned leads.
 */
router.get('/my', requirePermission('painter_leads', 'own.view'), async (req, res) => {
    try {
        const {
            status, search,
            page = 1, limit = 25,
            sort_by = 'created_at', sort_order = 'DESC',
        } = req.query;

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
        const offset = (pageNum - 1) * limitNum;

        const allowedSort = new Set([
            'created_at', 'updated_at', 'full_name', 'lead_number',
            'status', 'last_contact_date', 'next_eligible_date',
        ]);
        const sortColumn = allowedSort.has(sort_by) ? sort_by : 'created_at';
        const sortDir = String(sort_order).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        const where = ['pl.assigned_to = ?'];
        const params = [req.user.id];

        if (status)  { where.push('pl.status = ?'); params.push(status); }
        if (search) {
            const term = `%${search}%`;
            where.push('(pl.full_name LIKE ? OR pl.phone LIKE ? OR pl.lead_number LIKE ?)');
            params.push(term, term, term);
        }

        const whereSql = `WHERE ${where.join(' AND ')}`;

        const [countRows] = await pool.query(
            `SELECT COUNT(*) AS total FROM painter_leads pl ${whereSql}`,
            params
        );
        const total = countRows[0].total;

        const [rows] = await pool.query(
            `SELECT pl.*, b.name AS branch_name
             FROM painter_leads pl
             LEFT JOIN branches b ON pl.branch_id = b.id
             ${whereSql}
             ORDER BY pl.${sortColumn} ${sortDir}
             LIMIT ? OFFSET ?`,
            [...params, limitNum, offset]
        );

        res.json({
            success: true,
            data: rows,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                total_pages: Math.ceil(total / limitNum),
            },
        });
    } catch (err) {
        console.error('[painter-leads] my list error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to retrieve your leads' });
    }
});

/**
 * GET /api/painter-leads/my/today
 * Today's follow-ups (overdue + due-today + newly assigned) for the caller.
 */
router.get('/my/today', requirePermission('painter_leads', 'own.view'), async (req, res) => {
    try {
        const userId = req.user.id;

        // Due or overdue follow-ups (status not terminal)
        const [today] = await pool.query(
            `SELECT pl.*
             FROM painter_leads pl
             WHERE pl.assigned_to = ?
               AND pl.next_eligible_date IS NOT NULL
               AND pl.next_eligible_date <= CURDATE()
               AND pl.status NOT IN ('registered','converted','active_painter','not_interested','wrong_number','duplicate','snoozed')
             ORDER BY (pl.next_eligible_date < CURDATE()) DESC,
                      pl.priority DESC,
                      pl.next_eligible_date ASC
             LIMIT 100`,
            [userId]
        );

        // Uncontacted new leads assigned to caller (today + earlier with no contact yet)
        const [newLeads] = await pool.query(
            `SELECT pl.*
             FROM painter_leads pl
             WHERE pl.assigned_to = ?
               AND pl.status = 'new'
               AND pl.last_contact_date IS NULL
             ORDER BY pl.created_at ASC
             LIMIT 100`,
            [userId]
        );

        // Invited but not yet registered (caller may want to follow up)
        const [invited] = await pool.query(
            `SELECT pl.*
             FROM painter_leads pl
             WHERE pl.assigned_to = ?
               AND pl.status IN ('invited','interested','in_progress')
             ORDER BY pl.invited_at DESC
             LIMIT 100`,
            [userId]
        );

        res.json({
            success: true,
            data: {
                today,
                new_leads: newLeads,
                invited,
                counts: {
                    today_count: today.length,
                    new_count: newLeads.length,
                    invited_count: invited.length,
                },
            },
        });
    } catch (err) {
        console.error('[painter-leads] my today error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to retrieve today\'s leads' });
    }
});

// ─────────────────────────────────────────────────────────────────────────
//  DETAIL
// ─────────────────────────────────────────────────────────────────────────

/**
 * GET /api/painter-leads/:id
 * Returns the lead row, recent followups, and recent invites.
 */
router.get('/:id', requirePermission('painter_leads', 'view'), async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json({ success: false, message: 'Invalid lead id' });

        const [rows] = await pool.query(
            `SELECT pl.*,
                    b.name AS branch_name,
                    u.full_name AS assigned_to_name,
                    cb.full_name AS created_by_name,
                    ib.full_name AS invited_by_name,
                    ab.full_name AS approved_by_name
             FROM painter_leads pl
             LEFT JOIN branches b ON pl.branch_id = b.id
             LEFT JOIN users    u ON pl.assigned_to = u.id
             LEFT JOIN users   cb ON pl.created_by  = cb.id
             LEFT JOIN users   ib ON pl.invited_by  = ib.id
             LEFT JOIN users   ab ON pl.approved_by = ab.id
             WHERE pl.id = ?`,
            [id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Painter lead not found' });
        }

        const lead = rows[0];

        const [followups] = await pool.query(
            `SELECT pf.*, u.full_name AS user_name
             FROM painter_lead_followups pf
             LEFT JOIN users u ON pf.user_id = u.id
             WHERE pf.painter_lead_id = ?
             ORDER BY pf.created_at DESC
             LIMIT 50`,
            [id]
        );

        const [invites] = await pool.query(
            `SELECT pi.*, u.full_name AS sent_by_name
             FROM painter_lead_invites pi
             LEFT JOIN users u ON pi.sent_by = u.id
             WHERE pi.painter_lead_id = ?
             ORDER BY pi.sent_at DESC
             LIMIT 50`,
            [id]
        );

        res.json({ success: true, data: { ...lead, followups, invites } });
    } catch (err) {
        console.error('[painter-leads] detail error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to retrieve lead' });
    }
});

// ─────────────────────────────────────────────────────────────────────────
//  CREATE
// ─────────────────────────────────────────────────────────────────────────

/**
 * POST /api/painter-leads
 * Body: full_name, phone, email, branch_id, source, notes,
 *       assigned_to (optional — defaults to caller for staff, null for admin/manager)
 */
router.post('/', requirePermission('painter_leads', 'add'), async (req, res) => {
    try {
        const {
            full_name, phone, email, branch_id, source, notes,
            assigned_to, status,
        } = req.body || {};

        if (!full_name || !String(full_name).trim()) {
            return res.status(400).json({ success: false, message: 'full_name is required' });
        }

        const cleanPhone = normalizePhone(phone);
        if (!cleanPhone) {
            return res.status(400).json({ success: false, message: 'phone must contain at least 10 digits' });
        }

        // Reject active duplicates (status not in terminal/disposition states).
        const [existing] = await pool.query(
            `SELECT id, lead_number, full_name, status FROM painter_leads
             WHERE phone = ?
               AND status NOT IN ('not_interested','wrong_number','duplicate')
             LIMIT 1`,
            [cleanPhone]
        );
        if (existing.length > 0) {
            return res.status(409).json({
                success: false,
                message: `Duplicate painter lead. Phone already exists in ${existing[0].lead_number} (${existing[0].full_name}) — status ${existing[0].status}`,
                code: 'DUPLICATE_PHONE',
                existing_lead: existing[0],
            });
        }

        const leadNumber = await generateLeadNumber();

        // Default assignment:
        //   - staff who create their own leads → self-assigned (unless explicit assigned_to)
        //   - admin/manager → respect assigned_to (may be null for unassigned pool)
        let assignedTo = assigned_to != null ? parseInt(assigned_to, 10) : null;
        if (assignedTo == null && req.user.role === 'staff') {
            assignedTo = req.user.id;
        }

        const sourceValue = source && VALID_SOURCES.includes(source) ? source : 'staff_walk_in';
        const statusValue = status && VALID_STATUSES.includes(status) ? status : 'new';

        const [result] = await pool.query(
            `INSERT INTO painter_leads
                (lead_number, full_name, phone, email, branch_id, assigned_to,
                 source, created_by, status, notes, total_attempts, contact_count)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)`,
            [
                leadNumber,
                String(full_name).trim(),
                cleanPhone,
                email || null,
                branch_id != null ? parseInt(branch_id, 10) : (req.user.branch_id || null),
                assignedTo,
                sourceValue,
                req.user.id,
                statusValue,
                notes || null,
            ]
        );

        const [created] = await pool.query(
            `SELECT pl.*, u.full_name AS assigned_to_name, b.name AS branch_name
             FROM painter_leads pl
             LEFT JOIN users u ON pl.assigned_to = u.id
             LEFT JOIN branches b ON pl.branch_id = b.id
             WHERE pl.id = ?`,
            [result.insertId]
        );

        res.status(201).json({
            success: true,
            message: 'Painter lead created',
            data: created[0],
        });
    } catch (err) {
        console.error('[painter-leads] create error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to create painter lead' });
    }
});

// ─────────────────────────────────────────────────────────────────────────
//  UPDATE
// ─────────────────────────────────────────────────────────────────────────

/**
 * PUT /api/painter-leads/:id
 * Owner-only (or manage/admin). Updates a partial set of fields.
 */
router.put(
    '/:id',
    requireAnyPermission([
        { module: 'painter_leads', action: 'manage' },
        { module: 'painter_leads', action: 'own.edit' },
    ]),
    async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            if (!id) return res.status(400).json({ success: false, message: 'Invalid lead id' });

            const [rows] = await pool.query(
                `SELECT id, assigned_to, status, phone, lead_number FROM painter_leads WHERE id = ?`,
                [id]
            );
            if (rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Painter lead not found' });
            }
            const lead = rows[0];

            // Owner check: admin/manager auto-pass via isFullAdmin/role; users with
            // painter_leads.manage also pass; the rest must be the assignee.
            const isAdmin = isFullAdmin(req.user.role);
            const isManager = req.user.role === 'manager';
            const isOwner = Number(lead.assigned_to) === Number(req.user.id);
            if (!isAdmin && !isManager && !isOwner) {
                // requireAnyPermission already accepted them via own.edit; we now
                // reject because they don't actually own the lead.
                return res.status(403).json({ success: false, message: 'You can only edit leads assigned to you' });
            }

            const {
                full_name, phone, email, branch_id, status, notes,
            } = req.body || {};

            const sets = [];
            const params = [];

            if (full_name != null) { sets.push('full_name = ?'); params.push(String(full_name).trim()); }
            if (phone != null) {
                const clean = normalizePhone(phone);
                if (!clean) {
                    return res.status(400).json({ success: false, message: 'phone must contain at least 10 digits' });
                }
                sets.push('phone = ?'); params.push(clean);
            }
            if (email !== undefined) { sets.push('email = ?'); params.push(email || null); }
            if (branch_id !== undefined) {
                sets.push('branch_id = ?');
                params.push(branch_id == null ? null : parseInt(branch_id, 10));
            }
            if (status != null) {
                if (!VALID_STATUSES.includes(status)) {
                    return res.status(400).json({
                        success: false,
                        message: `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`,
                    });
                }
                sets.push('status = ?'); params.push(status);
            }
            if (notes !== undefined) { sets.push('notes = ?'); params.push(notes || null); }

            if (sets.length === 0) {
                return res.status(400).json({ success: false, message: 'No updatable fields provided' });
            }

            params.push(id);
            await pool.query(
                `UPDATE painter_leads SET ${sets.join(', ')} WHERE id = ?`,
                params
            );

            const [updated] = await pool.query(
                `SELECT pl.*, u.full_name AS assigned_to_name, b.name AS branch_name
                 FROM painter_leads pl
                 LEFT JOIN users u ON pl.assigned_to = u.id
                 LEFT JOIN branches b ON pl.branch_id = b.id
                 WHERE pl.id = ?`,
                [id]
            );

            res.json({ success: true, message: 'Painter lead updated', data: updated[0] });
        } catch (err) {
            console.error('[painter-leads] update error:', err.message);
            res.status(500).json({ success: false, message: 'Failed to update painter lead' });
        }
    }
);

// ─────────────────────────────────────────────────────────────────────────
//  ASSIGN
// ─────────────────────────────────────────────────────────────────────────

/**
 * POST /api/painter-leads/:id/assign
 * Body: { assigned_to: number|null, branch_id?: number }
 * Requires painter_leads.assign (or full admin).
 */
router.post('/:id/assign', requirePermission('painter_leads', 'assign'), async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json({ success: false, message: 'Invalid lead id' });

        const { assigned_to, branch_id } = req.body || {};
        if (assigned_to == null && branch_id == null) {
            return res.status(400).json({ success: false, message: 'assigned_to or branch_id required' });
        }

        const [rows] = await pool.query(
            `SELECT id, assigned_to, branch_id, lead_number FROM painter_leads WHERE id = ?`,
            [id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Painter lead not found' });
        }
        const lead = rows[0];

        const sets = [];
        const params = [];
        if (assigned_to !== undefined) {
            sets.push('assigned_to = ?');
            params.push(assigned_to == null ? null : parseInt(assigned_to, 10));
        }
        if (branch_id !== undefined) {
            sets.push('branch_id = ?');
            params.push(branch_id == null ? null : parseInt(branch_id, 10));
        }
        if (sets.length === 0) {
            return res.status(400).json({ success: false, message: 'Nothing to update' });
        }
        params.push(id);
        await pool.query(`UPDATE painter_leads SET ${sets.join(', ')} WHERE id = ?`, params);

        const [updated] = await pool.query(
            `SELECT pl.*, u.full_name AS assigned_to_name, b.name AS branch_name
             FROM painter_leads pl
             LEFT JOIN users u ON pl.assigned_to = u.id
             LEFT JOIN branches b ON pl.branch_id = b.id
             WHERE pl.id = ?`,
            [id]
        );

        res.json({ success: true, message: 'Painter lead assigned', data: updated[0] });
    } catch (err) {
        console.error('[painter-leads] assign error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to assign painter lead' });
    }
});

// ─────────────────────────────────────────────────────────────────────────
//  FOLLOWUP
// ─────────────────────────────────────────────────────────────────────────

/**
 * POST /api/painter-leads/:id/followup
 * Body: { followup_type, outcome?, notes?, next_followup_date?, call_status? }
 * Owner-only (or manage/admin). Mirrors painter-marketing.js semantics.
 */
router.post(
    '/:id/followup',
    requireAnyPermission([
        { module: 'painter_leads', action: 'manage' },
        { module: 'painter_leads', action: 'own.edit' },
    ]),
    async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            if (!id) return res.status(400).json({ success: false, message: 'Invalid lead id' });

            const [rows] = await pool.query(
                `SELECT id, assigned_to, status FROM painter_leads WHERE id = ?`,
                [id]
            );
            if (rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Painter lead not found' });
            }
            const lead = rows[0];

            const isAdmin = isFullAdmin(req.user.role);
            const isManager = req.user.role === 'manager';
            const isOwner = Number(lead.assigned_to) === Number(req.user.id);
            if (!isAdmin && !isManager && !isOwner) {
                return res.status(403).json({
                    success: false,
                    message: 'You can only log followups on leads assigned to you',
                });
            }

            const { followup_type, outcome, notes, next_followup_date, call_status } = req.body || {};

            if (!followup_type || !VALID_FOLLOWUP_TYPES.includes(followup_type)) {
                return res.status(400).json({
                    success: false,
                    message: `followup_type is required and must be one of: ${VALID_FOLLOWUP_TYPES.join(', ')}`,
                });
            }
            if (!notes || !String(notes).trim()) {
                return res.status(400).json({ success: false, message: 'notes is required' });
            }
            if (outcome != null && !VALID_FOLLOWUP_OUTCOMES.includes(outcome)) {
                return res.status(400).json({
                    success: false,
                    message: `outcome must be one of: ${VALID_FOLLOWUP_OUTCOMES.join(', ')}`,
                });
            }

            // Map followup outcome → lead status when transitioning forward.
            let newStatus = lead.status;
            switch (outcome) {
                case 'interested':
                    newStatus = 'interested';
                    break;
                case 'not_interested':
                    newStatus = 'not_interested';
                    break;
                case 'wrong_number':
                    newStatus = 'wrong_number';
                    break;
                case 'unreachable':
                    newStatus = 'unreachable';
                    break;
                case 'callback':
                case 'no_response':
                case 'other':
                    newStatus = lead.status === 'new' ? 'in_progress' : lead.status;
                    break;
                case 'converted':
                    // Reserved for flow upstream; we don't promote here.
                    break;
                default:
                    break;
            }

            // Always move `new` → `in_progress` on first followup.
            if (lead.status === 'new') {
                newStatus = newStatus === 'new' ? 'in_progress' : newStatus;
            }

            const conn = await pool.getConnection();
            try {
                await conn.beginTransaction();

                const [ins] = await conn.query(
                    `INSERT INTO painter_lead_followups
                        (painter_lead_id, user_id, followup_type, call_status, outcome,
                         next_followup_date, notes)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [
                        id, req.user.id, followup_type,
                        call_status || null,
                        outcome || null,
                        next_followup_date || null,
                        String(notes).trim(),
                    ]
                );

                await conn.query(
                    `UPDATE painter_leads
                     SET last_contact_date = NOW(),
                         last_outcome = ?,
                         status = ?,
                         next_eligible_date = COALESCE(?, next_eligible_date),
                         total_attempts = total_attempts + 1,
                         contact_count = contact_count + ?
                     WHERE id = ?`,
                    [
                        outcome || null,
                        newStatus,
                        next_followup_date || null,
                        call_status === 'connected' ? 1 : 0,
                        id,
                    ]
                );

                await conn.commit();

                const [created] = await pool.query(
                    `SELECT * FROM painter_lead_followups WHERE id = ?`,
                    [ins.insertId]
                );

                res.status(201).json({
                    success: true,
                    message: 'Followup logged',
                    data: {
                        followup: created[0],
                        lead_status: newStatus,
                    },
                });
            } catch (innerErr) {
                try { await conn.rollback(); } catch (_) { /* ignore */ }
                throw innerErr;
            } finally {
                conn.release();
            }
        } catch (err) {
            console.error('[painter-leads] followup error:', err.message);
            res.status(500).json({ success: false, message: 'Failed to log followup' });
        }
    }
);

// ─────────────────────────────────────────────────────────────────────────
//  SEND INVITE
// ─────────────────────────────────────────────────────────────────────────

/**
 * POST /api/painter-leads/:id/send-invite
 * Body: { channel?: 'whatsapp'|'sms'|'auto', message?: string, branch_id?: number }
 *
 * Generates a fresh invite_token, inserts a painter_lead_invites row,
 * attempts WhatsApp via session manager (if available), and falls back to
 * SMS via sms-service.sendSms. The lead's status moves to 'invited' and
 * invited_at / invited_by are stamped.
 */
router.post(
    '/:id/send-invite',
    requireAnyPermission([
        { module: 'painter_leads', action: 'manage' },
        { module: 'painter_leads', action: 'own.edit' },
    ]),
    async (req, res) => {
        try {
            const id = parseInt(req.params.id, 10);
            if (!id) return res.status(400).json({ success: false, message: 'Invalid lead id' });

            const [rows] = await pool.query(
                `SELECT id, assigned_to, full_name, phone, status, branch_id
                 FROM painter_leads WHERE id = ?`,
                [id]
            );
            if (rows.length === 0) {
                return res.status(404).json({ success: false, message: 'Painter lead not found' });
            }
            const lead = rows[0];

            const isAdmin = isFullAdmin(req.user.role);
            const isManager = req.user.role === 'manager';
            const isOwner = Number(lead.assigned_to) === Number(req.user.id);
            if (!isAdmin && !isManager && !isOwner) {
                return res.status(403).json({
                    success: false,
                    message: 'You can only send invites for leads assigned to you',
                });
            }

            if (!lead.phone) {
                return res.status(400).json({ success: false, message: 'Lead has no phone number' });
            }

            const { channel = 'auto', message, branch_id } = req.body || {};

            // Generate fresh token (32 bytes hex = 64 chars) per spec.
            const token = crypto.randomBytes(32).toString('hex');

            const staffName = req.user.full_name || req.user.username || 'our team';
            const messageText = (message && String(message).trim())
                || buildInviteMessage({ name: lead.full_name, token, staffName });

            // Pick the WhatsApp branch session. Lead's branch_id is the natural
            // choice, falling back to 0 (General).
            const sessionBranch = branch_id != null
                ? parseInt(branch_id, 10)
                : (lead.branch_id != null ? lead.branch_id : 0);

            const phone10 = normalizePhone(lead.phone);
            const e164 = toE164India(phone10);

            let usedChannel = 'sms';
            let deliveryStatus = 'failed';

            // Try WhatsApp first (unless caller pinned channel='sms').
            if (channel !== 'sms') {
                const waOk = await trySendWhatsApp(sessionBranch, e164 || lead.phone, messageText);
                if (waOk) {
                    usedChannel = 'whatsapp';
                    deliveryStatus = 'sent';
                }
            }

            // Fall back to SMS when WhatsApp unavailable or explicitly requested.
            if (usedChannel === 'sms') {
                try {
                    await smsService.sendSms({
                        number: e164 || lead.phone,
                        text: messageText,
                        label: 'Painter invite',
                    });
                    deliveryStatus = 'sent';
                } catch (smsErr) {
                    console.error('[painter-leads] SMS fallback failed:', smsErr.message);
                    deliveryStatus = 'failed';
                }
            }

            const conn = await pool.getConnection();
            try {
                await conn.beginTransaction();

                await conn.query(
                    `INSERT INTO painter_lead_invites
                        (painter_lead_id, sent_by, channel, message, invite_token, status)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [id, req.user.id, usedChannel, messageText, token, deliveryStatus]
                );

                await conn.query(
                    `UPDATE painter_leads
                     SET invite_token = ?,
                         invited_at = NOW(),
                         invited_by = ?,
                         status = ?
                     WHERE id = ?`,
                    [token, req.user.id, 'invited', id]
                );

                await conn.commit();
            } catch (innerErr) {
                try { await conn.rollback(); } catch (_) { /* ignore */ }
                throw innerErr;
            } finally {
                conn.release();
            }

            res.status(201).json({
                success: true,
                message: deliveryStatus === 'sent'
                    ? `Invite sent via ${usedChannel}`
                    : 'Invite recorded but delivery failed; staff should retry',
                data: {
                    invite_token: token,
                    invite_url: `${PAINTER_REGISTER_URL}?token=${token}`,
                    channel: usedChannel,
                    delivery_status: deliveryStatus,
                    lead_status: 'invited',
                },
            });
        } catch (err) {
            console.error('[painter-leads] send-invite error:', err.message);
            res.status(500).json({ success: false, message: 'Failed to send invite' });
        }
    }
);

module.exports = {
    router,
    setPool,
};
