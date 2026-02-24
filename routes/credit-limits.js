/**
 * Credit Limit Routes — customer credit management
 * Mounted at /api/credit-limits
 */

const express = require('express');
const router = express.Router();
const { requireAuth, requireRole } = require('../middleware/permissionMiddleware');

let pool = null;
function setPool(p) { pool = p; }

// ═══════════════════════════════════════════════════════════════
// NAMED ROUTES FIRST (before /:customerId to avoid interception)
// ═══════════════════════════════════════════════════════════════

// GET /api/credit-limits/customers — list all customers with credit info
router.get('/customers', requireAuth, async (req, res) => {
    try {
        const { search, status, sort } = req.query;
        let where = 'WHERE c.status = \'approved\'';
        const params = [];

        if (search) {
            where += ' AND (c.name LIKE ? OR c.phone LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }

        let orderBy = 'ORDER BY c.name ASC';
        if (sort === 'credit_limit_desc') orderBy = 'ORDER BY c.credit_limit DESC';
        else if (sort === 'credit_used_desc') orderBy = 'ORDER BY c.credit_used DESC';
        else if (sort === 'utilization_desc') orderBy = 'ORDER BY (CASE WHEN c.credit_limit > 0 THEN c.credit_used / c.credit_limit ELSE 0 END) DESC';

        const [rows] = await pool.query(`
            SELECT c.id, c.name, c.phone, c.email, c.company, c.branch_id,
                   c.credit_limit, c.credit_used,
                   (c.credit_limit - c.credit_used) as credit_available,
                   CASE WHEN c.credit_limit > 0 THEN ROUND((c.credit_used / c.credit_limit) * 100, 1) ELSE 0 END as utilization,
                   c.credit_limit_updated_at,
                   b.name as branch_name
            FROM customers c
            LEFT JOIN branches b ON c.branch_id = b.id
            ${where}
            ${orderBy}
        `, params);

        // Apply status filter in JS (simpler than complex SQL CASE)
        let filtered = rows;
        if (status && status !== 'all') {
            filtered = rows.filter(c => {
                const util = c.credit_limit > 0 ? (c.credit_used / c.credit_limit) * 100 : 0;
                switch (status) {
                    case 'no_limit': return Number(c.credit_limit) === 0;
                    case 'under_50': return Number(c.credit_limit) > 0 && util < 50;
                    case '50_to_80': return util >= 50 && util <= 80;
                    case 'over_80': return util > 80 && util <= 100;
                    case 'exceeded': return Number(c.credit_used) > Number(c.credit_limit) && Number(c.credit_limit) > 0;
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
                COALESCE(SUM(credit_limit), 0) as total_limit,
                COALESCE(SUM(credit_used), 0) as total_used,
                COALESCE(SUM(credit_limit - credit_used), 0) as total_available,
                COUNT(CASE WHEN credit_limit > 0 THEN 1 END) as customers_with_limit,
                COUNT(CASE WHEN credit_limit > 0 AND credit_used > credit_limit THEN 1 END) as over_limit_count,
                COUNT(CASE WHEN credit_limit > 0 AND (credit_used / credit_limit) > 0.8 AND credit_used <= credit_limit THEN 1 END) as near_limit_count
            FROM customers WHERE status = 'approved'
        `);

        const [nearLimit] = await pool.query(`
            SELECT id, name, credit_limit, credit_used,
                   ROUND((credit_used / credit_limit) * 100, 1) as utilization
            FROM customers
            WHERE status = 'approved' AND credit_limit > 0 AND (credit_used / credit_limit) > 0.8
            ORDER BY (credit_used / credit_limit) DESC LIMIT 10
        `);

        const [recentViolations] = await pool.query(`
            SELECT v.*, c.name as customer_name
            FROM credit_limit_violations v
            JOIN customers c ON v.customer_id = c.id
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
            SELECT v.*, c.name as customer_name, u.full_name as staff_name
            FROM credit_limit_violations v
            JOIN customers c ON v.customer_id = c.id
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
        const { customer_id, amount } = req.body;
        if (!customer_id || !amount) return res.status(400).json({ error: 'customer_id and amount required' });

        const [rows] = await pool.query(`
            SELECT id, name, credit_limit, credit_used, (credit_limit - credit_used) as credit_available
            FROM customers WHERE id = ?
        `, [customer_id]);

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
            const [current] = await conn.query('SELECT credit_limit FROM customers WHERE id = ?', [item.id]);
            if (!current.length) continue;

            await conn.query(
                'UPDATE customers SET credit_limit = ?, credit_limit_updated_at = NOW(), credit_limit_updated_by = ? WHERE id = ?',
                [item.credit_limit, req.user.id, item.id]
            );
            await conn.query(
                'INSERT INTO customer_credit_history (customer_id, previous_limit, new_limit, changed_by, reason) VALUES (?, ?, ?, ?, ?)',
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

// POST /api/credit-limits/recalculate — recalculate credit_used from invoices
router.post('/recalculate', requireAuth, async (req, res) => {
    try {
        const { customer_id } = req.body;
        let query, params;

        if (customer_id) {
            // Single customer
            query = `
                UPDATE customers c
                LEFT JOIN (
                    SELECT local_customer_id, COALESCE(SUM(balance), 0) as outstanding
                    FROM zoho_invoices
                    WHERE status IN ('sent','overdue','partially_paid') AND balance > 0
                    GROUP BY local_customer_id
                ) inv ON c.id = inv.local_customer_id
                SET c.credit_used = COALESCE(inv.outstanding, 0)
                WHERE c.id = ?
            `;
            params = [customer_id];
        } else {
            // All customers
            query = `
                UPDATE customers c
                LEFT JOIN (
                    SELECT local_customer_id, COALESCE(SUM(balance), 0) as outstanding
                    FROM zoho_invoices
                    WHERE status IN ('sent','overdue','partially_paid') AND balance > 0
                    GROUP BY local_customer_id
                ) inv ON c.id = inv.local_customer_id
                SET c.credit_used = COALESCE(inv.outstanding, 0)
            `;
            params = [];
        }

        const [result] = await pool.query(query, params);
        res.json({ success: true, updated: result.affectedRows });
    } catch (e) {
        console.error('[CreditLimits] Recalculate error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// PARAMETERIZED ROUTES (after all named routes)
// ═══════════════════════════════════════════════════════════════

// GET /api/credit-limits/:customerId — get single customer credit info
router.get('/:customerId', requireAuth, async (req, res) => {
    try {
        const [customer] = await pool.query(`
            SELECT c.id, c.name, c.phone, c.email, c.company,
                   c.credit_limit, c.credit_used,
                   (c.credit_limit - c.credit_used) as credit_available,
                   CASE WHEN c.credit_limit > 0 THEN ROUND((c.credit_used / c.credit_limit) * 100, 1) ELSE 0 END as utilization,
                   c.credit_limit_updated_at, u.full_name as updated_by_name
            FROM customers c
            LEFT JOIN users u ON c.credit_limit_updated_by = u.id
            WHERE c.id = ?
        `, [req.params.customerId]);

        if (!customer.length) return res.status(404).json({ error: 'Customer not found' });

        // Outstanding invoices
        const [invoices] = await pool.query(`
            SELECT invoice_number, invoice_date, due_date, total, balance, status
            FROM zoho_invoices
            WHERE local_customer_id = ? AND status IN ('sent','overdue','partially_paid') AND balance > 0
            ORDER BY due_date ASC LIMIT 20
        `, [req.params.customerId]);

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
            'SELECT credit_limit, credit_used FROM customers WHERE id = ?', [customerId]
        );
        if (!current.length) {
            conn.release();
            return res.status(404).json({ error: 'Customer not found' });
        }

        const previousLimit = Number(current[0].credit_limit);

        await conn.query(`
            UPDATE customers SET credit_limit = ?, credit_limit_updated_at = NOW(), credit_limit_updated_by = ?
            WHERE id = ?
        `, [credit_limit, req.user.id, customerId]);

        await conn.query(`
            INSERT INTO customer_credit_history (customer_id, previous_limit, new_limit, changed_by, reason)
            VALUES (?, ?, ?, ?, ?)
        `, [customerId, previousLimit, credit_limit, req.user.id, reason || null]);

        await conn.commit();
        conn.release();

        res.json({
            success: true,
            previous_limit: previousLimit,
            new_limit: Number(credit_limit),
            credit_used: Number(current[0].credit_used),
            credit_available: Number(credit_limit) - Number(current[0].credit_used)
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
            WHERE h.customer_id = ?
            ORDER BY h.created_at DESC LIMIT 50
        `, [req.params.customerId]);

        res.json({ success: true, data: rows });
    } catch (e) {
        console.error('[CreditLimits] History error:', e.message);
        res.status(500).json({ error: e.message });
    }
});

module.exports = { router, setPool };
