/**
 * Credit Limit Routes — Zoho customer credit management
 * Manages credit limits on zoho_customers_map (not local customers table).
 * Uses zoho_outstanding (receivables from Zoho) as the "credit used" value.
 * Mounted at /api/credit-limits
 */

const express = require('express');
const router = express.Router();
const { requireAuth, requireRole, requirePermission } = require('../middleware/permissionMiddleware');
const zohoAPI = require('../services/zoho-api');
const notificationService = require('../services/notification-service');

let pool = null;
let io = null;
function setPool(p) { pool = p; }
function setIO(i) { io = i; }

// ═══════════════════════════════════════════════════════════════
// ZOHO SYNC HELPER — sync credit limit to Zoho Books contact
// ═══════════════════════════════════════════════════════════════
async function syncLimitToZoho(zohoCustomerMapId) {
    try {
        const [rows] = await pool.query(
            'SELECT zoho_contact_id, credit_limit FROM zoho_customers_map WHERE id = ?',
            [zohoCustomerMapId]
        );
        if (!rows.length || !rows[0].zoho_contact_id) return { synced: false, reason: 'no_contact_id' };

        await zohoAPI.updateContact(rows[0].zoho_contact_id, {
            credit_limit: Number(rows[0].credit_limit)
        });
        return { synced: true };
    } catch (err) {
        console.error('[CreditLimits] Zoho sync error for map_id', zohoCustomerMapId, ':', err.message);
        return { synced: false, reason: err.message };
    }
}

// ═══════════════════════════════════════════════════════════════
// CREDIT CHECK UTILITY — used by painters push-to-Zoho etc.
// ═══════════════════════════════════════════════════════════════
async function checkCreditBeforeInvoice(dbPool, zohoContactId, invoiceAmount) {
    const [rows] = await dbPool.query(
        `SELECT id, zoho_contact_name, credit_limit, zoho_outstanding
         FROM zoho_customers_map WHERE zoho_contact_id = ? LIMIT 1`,
        [zohoContactId]
    );

    if (!rows.length) {
        return { allowed: true, reason: 'Customer not in credit system' };
    }

    const c = rows[0];
    const limit = Number(c.credit_limit);
    const outstanding = Number(c.zoho_outstanding);
    const amount = Number(invoiceAmount);

    // No limit set → BLOCKED (must request a limit first)
    if (limit === 0) {
        // Check if there's a pending request already
        const [pending] = await dbPool.query(
            'SELECT id FROM credit_limit_requests WHERE zoho_customer_map_id = ? AND status = ? LIMIT 1',
            [c.id, 'pending']
        );
        return {
            allowed: false,
            reason: 'No credit limit set for ' + c.zoho_contact_name + '. Please request a credit limit from admin.',
            credit_limit: 0,
            outstanding,
            available: 0,
            no_limit_set: true,
            has_pending_request: pending.length > 0,
            customer_name: c.zoho_contact_name,
            zoho_customer_map_id: c.id
        };
    }

    const available = limit - outstanding;
    if (available < amount) {
        return {
            allowed: false,
            reason: `Credit limit exceeded for ${c.zoho_contact_name}. Available: ₹${available.toLocaleString('en-IN')}, Required: ₹${amount.toLocaleString('en-IN')}`,
            credit_limit: limit,
            outstanding,
            available,
            shortage: amount - available,
            no_limit_set: false,
            has_pending_request: false,
            customer_name: c.zoho_contact_name,
            zoho_customer_map_id: c.id
        };
    }

    return {
        allowed: true,
        credit_limit: limit,
        outstanding,
        available,
        no_limit_set: false,
        customer_name: c.zoho_contact_name,
        zoho_customer_map_id: c.id
    };
}

// ═══════════════════════════════════════════════════════════════
// NAMED ROUTES FIRST (before /:customerId to avoid interception)
// ═══════════════════════════════════════════════════════════════

// GET /api/credit-limits/customers — list all Zoho customers with credit info
router.get('/customers', requirePermission('credit_limits', 'view'), async (req, res) => {
    try {
        const { search, status, sort, branch } = req.query;
        let where = 'WHERE 1=1';
        const params = [];

        if (search) {
            where += ' AND (zcm.zoho_contact_name LIKE ? OR zcm.zoho_phone LIKE ? OR zcm.zoho_email LIKE ?)';
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        if (branch) {
            where += ' AND zcm.branch_id = ?';
            params.push(Number(branch));
        }

        let orderBy = 'ORDER BY zcm.zoho_contact_name ASC';
        if (sort === 'credit_limit_desc') orderBy = 'ORDER BY zcm.credit_limit DESC';
        else if (sort === 'credit_used_desc') orderBy = 'ORDER BY zcm.zoho_outstanding DESC';
        else if (sort === 'utilization_desc') orderBy = 'ORDER BY (CASE WHEN zcm.credit_limit > 0 THEN zcm.zoho_outstanding / zcm.credit_limit ELSE 0 END) DESC';

        const [rows] = await pool.query(`
            SELECT zcm.id, zcm.zoho_contact_name as name, zcm.zoho_phone as phone,
                   zcm.zoho_email as email, zcm.zoho_gst_no as gst_no,
                   zcm.zoho_contact_id,
                   zcm.credit_limit, zcm.zoho_outstanding as credit_used,
                   (zcm.credit_limit - zcm.zoho_outstanding) as credit_available,
                   CASE WHEN zcm.credit_limit > 0
                        THEN ROUND((zcm.zoho_outstanding / zcm.credit_limit) * 100, 1) ELSE 0 END as utilization,
                   zcm.credit_limit_updated_at, zcm.last_synced_at, zcm.branch_id,
                   b.name as branch_name
            FROM zoho_customers_map zcm
            LEFT JOIN branches b ON zcm.branch_id = b.id
            ${where}
            ${orderBy}
        `, params);

        // Apply status filter in JS (simpler than complex SQL CASE)
        let filtered = rows;
        if (status && status !== 'all') {
            filtered = rows.filter(c => {
                const limit = Number(c.credit_limit);
                const used = Number(c.credit_used);
                const util = limit > 0 ? (used / limit) * 100 : 0;
                switch (status) {
                    case 'no_limit': return limit === 0;
                    case 'under_50': return limit > 0 && util < 50;
                    case '50_to_80': return util >= 50 && util <= 80;
                    case 'over_80': return util > 80 && util <= 100;
                    case 'exceeded': return used > limit && limit > 0;
                    default: return true;
                }
            });
        }

        res.json({ success: true, data: filtered });
    } catch (e) {
        console.error('[CreditLimits] List error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// GET /api/credit-limits/overview/summary — dashboard overview
router.get('/overview/summary', requirePermission('credit_limits', 'view'), async (req, res) => {
    try {
        const [summary] = await pool.query(`
            SELECT
                COUNT(*) as total_customers,
                COALESCE(SUM(credit_limit), 0) as total_limit,
                COALESCE(SUM(zoho_outstanding), 0) as total_used,
                COALESCE(SUM(credit_limit - zoho_outstanding), 0) as total_available,
                COUNT(CASE WHEN credit_limit > 0 THEN 1 END) as customers_with_limit,
                COUNT(CASE WHEN credit_limit > 0 AND zoho_outstanding > credit_limit THEN 1 END) as over_limit_count,
                COUNT(CASE WHEN credit_limit > 0 AND (zoho_outstanding / credit_limit) > 0.8 AND zoho_outstanding <= credit_limit THEN 1 END) as near_limit_count,
                MAX(last_synced_at) as last_synced
            FROM zoho_customers_map
        `);

        const [nearLimit] = await pool.query(`
            SELECT id, zoho_contact_name as name, credit_limit, zoho_outstanding as credit_used,
                   ROUND((zoho_outstanding / credit_limit) * 100, 1) as utilization
            FROM zoho_customers_map
            WHERE credit_limit > 0 AND (zoho_outstanding / credit_limit) > 0.8
            ORDER BY (zoho_outstanding / credit_limit) DESC LIMIT 10
        `);

        const [recentViolations] = await pool.query(`
            SELECT v.*, zcm.zoho_contact_name as customer_name
            FROM credit_limit_violations v
            LEFT JOIN zoho_customers_map zcm ON v.zoho_customer_map_id = zcm.id
            ORDER BY v.created_at DESC LIMIT 10
        `);

        res.json({
            success: true,
            summary: summary[0],
            near_limit: nearLimit,
            recent_violations: recentViolations
        });
    } catch (e) {
        console.error('[CreditLimits] Overview error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// GET /api/credit-limits/violations/list — list violations
router.get('/violations/list', requirePermission('credit_limits', 'view'), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT v.*, zcm.zoho_contact_name as customer_name, u.full_name as staff_name
            FROM credit_limit_violations v
            LEFT JOIN zoho_customers_map zcm ON v.zoho_customer_map_id = zcm.id
            LEFT JOIN users u ON v.staff_id = u.id
            ORDER BY v.created_at DESC LIMIT 100
        `);
        res.json({ success: true, data: rows });
    } catch (e) {
        console.error('[CreditLimits] Violations error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// POST /api/credit-limits/check — check credit availability
router.post('/check', requirePermission('credit_limits', 'view'), async (req, res) => {
    try {
        const { zoho_customer_map_id, amount } = req.body;
        if (!zoho_customer_map_id || !amount) return res.status(400).json({ error: 'zoho_customer_map_id and amount required' });

        const [rows] = await pool.query(`
            SELECT id, zoho_contact_name as name, credit_limit, zoho_outstanding as credit_used,
                   (credit_limit - zoho_outstanding) as credit_available
            FROM zoho_customers_map WHERE id = ?
        `, [zoho_customer_map_id]);

        if (!rows.length) return res.status(404).json({ error: 'Customer not found' });

        const c = rows[0];
        const limit = Number(c.credit_limit);
        const used = Number(c.credit_used);
        const available = limit - used;
        const allowed = limit === 0 ? true : available >= Number(amount); // 0 limit = no limit set

        res.json({
            allowed,
            no_limit_set: limit === 0,
            customer_name: c.name,
            credit_limit: limit,
            credit_used: used,
            credit_available: available,
            invoice_amount: Number(amount),
            shortage: allowed ? 0 : (Number(amount) - available)
        });
    } catch (e) {
        console.error('[CreditLimits] Check error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// POST /api/credit-limits/bulk-set — bulk update credit limits
router.post('/bulk-set', requirePermission('credit_limits', 'manage'), async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const { customers, reason } = req.body; // [{id, credit_limit}]
        if (!Array.isArray(customers) || !customers.length) {
            conn.release();
            return res.status(400).json({ error: 'customers array required' });
        }

        let updated = 0;
        for (const item of customers) {
            const [current] = await conn.query('SELECT id, credit_limit FROM zoho_customers_map WHERE id = ?', [item.id]);
            if (!current.length) continue;

            await conn.query(
                'UPDATE zoho_customers_map SET credit_limit = ?, credit_limit_updated_at = NOW(), credit_limit_updated_by = ? WHERE id = ?',
                [item.credit_limit, req.user.id, item.id]
            );
            await conn.query(
                'INSERT INTO customer_credit_history (zoho_customer_map_id, previous_limit, new_limit, changed_by, reason) VALUES (?, ?, ?, ?, ?)',
                [item.id, current[0].credit_limit, item.credit_limit, req.user.id, reason || 'Bulk update']
            );
            updated++;
        }

        await conn.commit();
        conn.release();

        // Best-effort Zoho sync for each customer
        const zohoResults = [];
        for (const item of customers) {
            const result = await syncLimitToZoho(item.id);
            zohoResults.push({ id: item.id, ...result });
        }

        res.json({ success: true, updated, zoho_sync: zohoResults });
    } catch (e) {
        await conn.rollback();
        conn.release();
        console.error('[CreditLimits] Bulk set error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// POST /api/credit-limits/sync — sync customers from Zoho (replaces recalculate)
router.post('/sync', requirePermission('credit_limits', 'manage'), async (req, res) => {
    try {
        const result = await zohoAPI.syncCustomers('credit-limits-page');
        res.json({ success: true, synced: result.synced, message: `Synced ${result.synced} customers from Zoho` });
    } catch (e) {
        console.error('[CreditLimits] Sync error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// CREATE CUSTOMER — any staff can create, default limit ₹100
// ═══════════════════════════════════════════════════════════════
const DEFAULT_CREDIT_LIMIT = 100;

router.post('/create-customer', requirePermission('credit_limits', 'manage'), async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const { customer_name, phone, email, gst_no, branch_id } = req.body;

        if (!customer_name || !customer_name.trim()) {
            conn.release();
            return res.status(400).json({ error: 'Customer name is required' });
        }

        // 1. Create contact in Zoho Books
        let zohoContactId = null;
        let zohoSynced = false;
        try {
            const contactData = {
                contact_name: customer_name.trim(),
                contact_type: 'customer',
                credit_limit: DEFAULT_CREDIT_LIMIT
            };
            if (phone) contactData.phone = phone.trim();
            if (email) contactData.email = email.trim();
            if (gst_no) contactData.gst_no = gst_no.trim();

            const zohoRes = await zohoAPI.createContact(contactData);
            if (zohoRes && zohoRes.contact) {
                zohoContactId = zohoRes.contact.contact_id;
                zohoSynced = true;
            }
        } catch (zohoErr) {
            console.error('[CreditLimits] Zoho create contact error:', zohoErr.message);
            conn.release();
            return res.status(500).json({ error: 'Failed to create customer in Zoho: ' + zohoErr.message });
        }

        if (!zohoContactId) {
            conn.release();
            return res.status(500).json({ error: 'Zoho did not return a contact ID' });
        }

        // 2. Insert into zoho_customers_map with default credit limit
        const [result] = await conn.query(
            `INSERT INTO zoho_customers_map (zoho_contact_id, zoho_contact_name, zoho_phone, zoho_email, zoho_gst_no, branch_id, credit_limit, credit_limit_updated_at, credit_limit_updated_by, last_synced_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, NOW())`,
            [zohoContactId, customer_name.trim(), phone || null, email || null, gst_no || null, branch_id || null, DEFAULT_CREDIT_LIMIT, req.user.id]
        );

        // 3. Log credit history
        await conn.query(
            'INSERT INTO customer_credit_history (zoho_customer_map_id, previous_limit, new_limit, changed_by, reason) VALUES (?, 0, ?, ?, ?)',
            [result.insertId, DEFAULT_CREDIT_LIMIT, req.user.id, 'New customer — default credit limit']
        );

        await conn.commit();
        conn.release();

        res.json({
            success: true,
            customer_id: result.insertId,
            zoho_contact_id: zohoContactId,
            credit_limit: DEFAULT_CREDIT_LIMIT,
            zoho_synced: zohoSynced,
            message: `Customer created with ₹${DEFAULT_CREDIT_LIMIT} credit limit`
        });
    } catch (e) {
        await conn.rollback();
        conn.release();
        console.error('[CreditLimits] Create customer error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// CREDIT LIMIT REQUEST WORKFLOW (F4)
// ═══════════════════════════════════════════════════════════════

// POST /api/credit-limits/requests — submit a credit limit request
router.post('/requests', requirePermission('credit_limits', 'view'), async (req, res) => {
    try {
        const { zoho_customer_map_id, requested_amount, reason } = req.body;
        if (!zoho_customer_map_id || !requested_amount || requested_amount <= 0) {
            return res.status(400).json({ error: 'zoho_customer_map_id and requested_amount (>0) required' });
        }

        // Get customer info
        const [cust] = await pool.query(
            'SELECT id, zoho_contact_name, branch_id FROM zoho_customers_map WHERE id = ?',
            [zoho_customer_map_id]
        );
        if (!cust.length) return res.status(404).json({ error: 'Customer not found' });

        // Check for existing pending request
        const [existing] = await pool.query(
            'SELECT id FROM credit_limit_requests WHERE zoho_customer_map_id = ? AND status = ?',
            [zoho_customer_map_id, 'pending']
        );
        if (existing.length) {
            return res.status(409).json({ error: 'A pending request already exists for this customer', existing_request_id: existing[0].id });
        }

        const [result] = await pool.query(
            `INSERT INTO credit_limit_requests (branch_id, requested_by, zoho_customer_map_id, customer_name, requested_amount, reason)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [cust[0].branch_id || 0, req.user.id, zoho_customer_map_id, cust[0].zoho_contact_name, requested_amount, reason || null]
        );

        // Notify all admin/super_admin users
        try {
            const [admins] = await pool.query(
                "SELECT id FROM users WHERE role IN ('admin','super_admin') AND status = 'active'"
            );
            for (const admin of admins) {
                await notificationService.send(admin.id, {
                    type: 'credit_limit_request',
                    title: 'New Credit Limit Request',
                    body: `${req.user.full_name || req.user.username} requested ₹${Number(requested_amount).toLocaleString('en-IN')} limit for ${cust[0].zoho_contact_name}`,
                    data: { request_id: result.insertId, customer_name: cust[0].zoho_contact_name }
                });
                if (io) io.to(`user_${admin.id}`).emit('credit_limit_request_new', {
                    id: result.insertId,
                    customer_name: cust[0].zoho_contact_name,
                    requested_amount,
                    requested_by: req.user.full_name || req.user.username
                });
            }
        } catch (notifErr) { console.error('[CreditLimits] Notify error:', notifErr.message); }

        res.json({ success: true, request_id: result.insertId });
    } catch (e) {
        console.error('[CreditLimits] Request submit error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// GET /api/credit-limits/requests — list requests (staff=own, admin=all)
router.get('/requests', requirePermission('credit_limits', 'view'), async (req, res) => {
    try {
        const { status: statusFilter } = req.query;
        const isAdmin = ['admin', 'super_admin', 'manager'].includes(req.user.role);

        let where = 'WHERE 1=1';
        const params = [];

        if (!isAdmin) {
            where += ' AND r.requested_by = ?';
            params.push(req.user.id);
        }
        if (statusFilter && statusFilter !== 'all') {
            where += ' AND r.status = ?';
            params.push(statusFilter);
        }

        const [rows] = await pool.query(`
            SELECT r.*, u.full_name as requested_by_name, rv.full_name as reviewed_by_name,
                   zcm.credit_limit as current_limit, zcm.zoho_outstanding
            FROM credit_limit_requests r
            LEFT JOIN users u ON r.requested_by = u.id
            LEFT JOIN users rv ON r.reviewed_by = rv.id
            LEFT JOIN zoho_customers_map zcm ON r.zoho_customer_map_id = zcm.id
            ${where}
            ORDER BY FIELD(r.status, 'pending', 'approved', 'rejected'), r.created_at DESC
            LIMIT 200
        `, params);

        // Pending count for badge
        const countWhere = isAdmin ? '' : ' AND requested_by = ' + pool.escape(req.user.id);
        const [[{ pending_count }]] = await pool.query(
            `SELECT COUNT(*) as pending_count FROM credit_limit_requests WHERE status = 'pending'${countWhere}`
        );

        res.json({ success: true, data: rows, pending_count });
    } catch (e) {
        console.error('[CreditLimits] Requests list error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// PUT /api/credit-limits/requests/:id/approve — admin approves request
router.put('/requests/:id/approve', requirePermission('credit_limits', 'manage'), async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const { approved_amount, review_notes } = req.body;
        const requestId = req.params.id;

        const [request] = await conn.query('SELECT * FROM credit_limit_requests WHERE id = ? AND status = ?', [requestId, 'pending']);
        if (!request.length) {
            conn.release();
            return res.status(404).json({ error: 'Pending request not found' });
        }
        const r = request[0];
        const finalAmount = approved_amount != null ? Number(approved_amount) : Number(r.requested_amount);

        // Update request
        await conn.query(
            `UPDATE credit_limit_requests SET status = 'approved', approved_amount = ?, reviewed_by = ?, reviewed_at = NOW(), review_notes = ? WHERE id = ?`,
            [finalAmount, req.user.id, review_notes || null, requestId]
        );

        // Get current limit for history
        const [current] = await conn.query('SELECT credit_limit FROM zoho_customers_map WHERE id = ?', [r.zoho_customer_map_id]);
        const previousLimit = current.length ? Number(current[0].credit_limit) : 0;

        // Set the credit limit
        await conn.query(
            'UPDATE zoho_customers_map SET credit_limit = ?, credit_limit_updated_at = NOW(), credit_limit_updated_by = ? WHERE id = ?',
            [finalAmount, req.user.id, r.zoho_customer_map_id]
        );

        // Insert history
        await conn.query(
            'INSERT INTO customer_credit_history (zoho_customer_map_id, previous_limit, new_limit, changed_by, reason) VALUES (?, ?, ?, ?, ?)',
            [r.zoho_customer_map_id, previousLimit, finalAmount, req.user.id, `Approved request #${requestId}` + (review_notes ? ': ' + review_notes : '')]
        );

        await conn.commit();
        conn.release();

        // Zoho sync (best-effort)
        const zohoSync = await syncLimitToZoho(r.zoho_customer_map_id);

        // Notify requester
        try {
            await notificationService.send(r.requested_by, {
                type: 'credit_limit_approved',
                title: 'Credit Limit Approved',
                body: `Your request for ${r.customer_name} was approved: ₹${finalAmount.toLocaleString('en-IN')}`,
                data: { request_id: requestId, approved_amount: finalAmount }
            });
            if (io) io.to(`user_${r.requested_by}`).emit('credit_limit_request_resolved', {
                id: requestId, status: 'approved', approved_amount: finalAmount, customer_name: r.customer_name
            });
        } catch (notifErr) { console.error('[CreditLimits] Notify error:', notifErr.message); }

        res.json({ success: true, approved_amount: finalAmount, zoho_synced: zohoSync.synced });
    } catch (e) {
        await conn.rollback();
        conn.release();
        console.error('[CreditLimits] Approve error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// PUT /api/credit-limits/requests/:id/reject — admin rejects request
router.put('/requests/:id/reject', requirePermission('credit_limits', 'manage'), async (req, res) => {
    try {
        const { review_notes } = req.body;
        if (!review_notes || !review_notes.trim()) {
            return res.status(400).json({ error: 'Reason for rejection is required' });
        }

        const [request] = await pool.query('SELECT * FROM credit_limit_requests WHERE id = ? AND status = ?', [req.params.id, 'pending']);
        if (!request.length) return res.status(404).json({ error: 'Pending request not found' });
        const r = request[0];

        await pool.query(
            `UPDATE credit_limit_requests SET status = 'rejected', reviewed_by = ?, reviewed_at = NOW(), review_notes = ? WHERE id = ?`,
            [req.user.id, review_notes, req.params.id]
        );

        // Notify requester
        try {
            await notificationService.send(r.requested_by, {
                type: 'credit_limit_rejected',
                title: 'Credit Limit Request Rejected',
                body: `Your request for ${r.customer_name} was rejected: ${review_notes}`,
                data: { request_id: req.params.id, reason: review_notes }
            });
            if (io) io.to(`user_${r.requested_by}`).emit('credit_limit_request_resolved', {
                id: Number(req.params.id), status: 'rejected', customer_name: r.customer_name, reason: review_notes
            });
        } catch (notifErr) { console.error('[CreditLimits] Notify error:', notifErr.message); }

        res.json({ success: true });
    } catch (e) {
        console.error('[CreditLimits] Reject error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// PARAMETERIZED ROUTES (after all named routes)
// ═══════════════════════════════════════════════════════════════

// GET /api/credit-limits/:customerId — get single Zoho customer credit info
router.get('/:customerId', requirePermission('credit_limits', 'view'), async (req, res) => {
    try {
        const [customer] = await pool.query(`
            SELECT zcm.id, zcm.zoho_contact_name as name, zcm.zoho_phone as phone,
                   zcm.zoho_email as email, zcm.zoho_gst_no as gst_no,
                   zcm.zoho_contact_id, zcm.zoho_unused_credits as unused_credits,
                   zcm.credit_limit, zcm.zoho_outstanding as credit_used,
                   (zcm.credit_limit - zcm.zoho_outstanding) as credit_available,
                   CASE WHEN zcm.credit_limit > 0 THEN ROUND((zcm.zoho_outstanding / zcm.credit_limit) * 100, 1) ELSE 0 END as utilization,
                   zcm.credit_limit_updated_at, zcm.last_synced_at, zcm.branch_id,
                   u.full_name as updated_by_name, b.name as branch_name
            FROM zoho_customers_map zcm
            LEFT JOIN users u ON zcm.credit_limit_updated_by = u.id
            LEFT JOIN branches b ON zcm.branch_id = b.id
            WHERE zcm.id = ?
        `, [req.params.customerId]);

        if (!customer.length) return res.status(404).json({ error: 'Customer not found' });

        // Outstanding invoices via zoho_contact_id
        const [invoices] = await pool.query(`
            SELECT invoice_number, invoice_date, due_date, total, balance, status
            FROM zoho_invoices
            WHERE zoho_customer_id = ? AND status IN ('sent','overdue','partially_paid') AND balance > 0
            ORDER BY due_date ASC LIMIT 20
        `, [customer[0].zoho_contact_id]);

        res.json({
            success: true,
            customer: customer[0],
            outstanding_invoices: invoices
        });
    } catch (e) {
        console.error('[CreditLimits] Detail error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// POST /api/credit-limits/:customerId/set-limit — update credit limit
router.post('/:customerId/set-limit', requirePermission('credit_limits', 'manage'), async (req, res) => {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const { credit_limit, reason } = req.body;
        const customerId = req.params.customerId;

        if (credit_limit == null || credit_limit < 0) {
            conn.release();
            return res.status(400).json({ error: 'Credit limit must be >= 0' });
        }

        const [current] = await conn.query(
            'SELECT credit_limit, zoho_outstanding FROM zoho_customers_map WHERE id = ?', [customerId]
        );
        if (!current.length) {
            conn.release();
            return res.status(404).json({ error: 'Customer not found' });
        }

        const previousLimit = Number(current[0].credit_limit);

        await conn.query(`
            UPDATE zoho_customers_map SET credit_limit = ?, credit_limit_updated_at = NOW(), credit_limit_updated_by = ?
            WHERE id = ?
        `, [credit_limit, req.user.id, customerId]);

        await conn.query(`
            INSERT INTO customer_credit_history (zoho_customer_map_id, previous_limit, new_limit, changed_by, reason)
            VALUES (?, ?, ?, ?, ?)
        `, [customerId, previousLimit, credit_limit, req.user.id, reason || null]);

        await conn.commit();
        conn.release();

        // Best-effort Zoho sync
        const zohoSync = await syncLimitToZoho(customerId);

        res.json({
            success: true,
            previous_limit: previousLimit,
            new_limit: Number(credit_limit),
            credit_used: Number(current[0].zoho_outstanding),
            credit_available: Number(credit_limit) - Number(current[0].zoho_outstanding),
            zoho_synced: zohoSync.synced
        });
    } catch (e) {
        await conn.rollback();
        conn.release();
        console.error('[CreditLimits] Set limit error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// GET /api/credit-limits/:customerId/history — credit limit change history
router.get('/:customerId/history', requirePermission('credit_limits', 'view'), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT h.*, u.full_name as changed_by_name
            FROM customer_credit_history h
            LEFT JOIN users u ON h.changed_by = u.id
            WHERE h.zoho_customer_map_id = ?
            ORDER BY h.created_at DESC LIMIT 50
        `, [req.params.customerId]);

        res.json({ success: true, data: rows });
    } catch (e) {
        console.error('[CreditLimits] History error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

module.exports = { router, setPool, setIO, checkCreditBeforeInvoice };
