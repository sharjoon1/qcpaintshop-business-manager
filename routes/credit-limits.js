/**
 * Credit Limit Routes — Zoho customer credit management
 * Manages credit limits on zoho_customers_map (not local customers table).
 * Uses zoho_outstanding (receivables from Zoho) as the "credit used" value.
 * Mounted at /api/credit-limits
 */

const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/permissionMiddleware');
const zohoAPI = require('../services/zoho-api');

let pool = null;
function setPool(p) { pool = p; }

// ═══════════════════════════════════════════════════════════════
// NAMED ROUTES FIRST (before /:customerId to avoid interception)
// ═══════════════════════════════════════════════════════════════

// GET /api/credit-limits/customers — list all Zoho customers with credit info
router.get('/customers', requireAuth, async (req, res) => {
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
router.get('/overview/summary', requireAuth, async (req, res) => {
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
router.get('/violations/list', requireAuth, async (req, res) => {
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
router.post('/check', requireAuth, async (req, res) => {
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
router.post('/bulk-set', requireAuth, async (req, res) => {
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
        res.json({ success: true, updated });
    } catch (e) {
        await conn.rollback();
        conn.release();
        console.error('[CreditLimits] Bulk set error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// POST /api/credit-limits/sync — sync customers from Zoho (replaces recalculate)
router.post('/sync', requireAuth, async (req, res) => {
    try {
        const result = await zohoAPI.syncCustomers('credit-limits-page');
        res.json({ success: true, synced: result.synced, message: `Synced ${result.synced} customers from Zoho` });
    } catch (e) {
        console.error('[CreditLimits] Sync error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// PARAMETERIZED ROUTES (after all named routes)
// ═══════════════════════════════════════════════════════════════

// GET /api/credit-limits/:customerId — get single Zoho customer credit info
router.get('/:customerId', requireAuth, async (req, res) => {
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
router.post('/:customerId/set-limit', requireAuth, async (req, res) => {
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

        res.json({
            success: true,
            previous_limit: previousLimit,
            new_limit: Number(credit_limit),
            credit_used: Number(current[0].zoho_outstanding),
            credit_available: Number(credit_limit) - Number(current[0].zoho_outstanding)
        });
    } catch (e) {
        await conn.rollback();
        conn.release();
        console.error('[CreditLimits] Set limit error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// GET /api/credit-limits/:customerId/history — credit limit change history
router.get('/:customerId/history', requireAuth, async (req, res) => {
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

module.exports = { router, setPool };
