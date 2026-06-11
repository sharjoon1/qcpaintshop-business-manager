/**
 * ZOHO ROUTES — INVOICES / PAYMENTS / CUSTOMERS / FINANCIAL REPORTS /
 * DAILY TRANSACTIONS / EXPENSES / CREDIT NOTES / SALES ORDERS
 * Split from routes/zoho.js (A8b) — handlers moved verbatim, original
 * relative order preserved.
 */

const express = require('express');
const router = express.Router();
const { requirePermission } = require('../../middleware/permissionMiddleware');

// Services (initialized via setPool in ./shared)
const zohoAPI = require('../../services/zoho-api');

let pool;
function setPool(dbPool) { pool = dbPool; }

// ========================================
// INVOICES (from local cache)
// ========================================

/**
 * GET /api/zoho/invoices - List invoices
 * Query: ?status=overdue&search=customer_name&page=1&limit=20
 */
router.get('/invoices', requirePermission('zoho', 'invoices'), async (req, res) => {
    try {
        const { status, search, page = 1, limit = 20, sort = 'invoice_date', order = 'DESC' } = req.query;
        const safeLimit = Math.min(parseInt(limit) || 20, 500);

        let where = 'WHERE 1=1';
        const params = [];

        if (status) {
            where += ' AND zi.status = ?';
            params.push(status);
        }
        if (search) {
            where += ' AND (zi.customer_name LIKE ? OR zi.invoice_number LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }

        const allowedSorts = ['invoice_date', 'due_date', 'total', 'balance', 'customer_name', 'invoice_number'];
        const sortCol = allowedSorts.includes(sort) ? sort : 'invoice_date';
        const sortOrder = order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        const offset = (Math.max(1, parseInt(page)) - 1) * safeLimit;

        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) as total FROM zoho_invoices zi ${where}`, params
        );

        const [invoices] = await pool.query(`
            SELECT zi.*, zcm.local_customer_id,
                   zcm.credit_limit, zcm.zoho_outstanding as credit_outstanding,
                   CASE WHEN zcm.credit_limit > 0
                        THEN ROUND((zcm.zoho_outstanding / zcm.credit_limit) * 100, 1) ELSE 0 END as credit_utilization
            FROM zoho_invoices zi
            LEFT JOIN zoho_customers_map zcm ON zi.zoho_customer_id = zcm.zoho_contact_id
            ${where}
            ORDER BY zi.${sortCol} ${sortOrder}
            LIMIT ? OFFSET ?
        `, [...params, safeLimit, offset]);

        const [statsRows] = await pool.query(
            `SELECT COUNT(*) AS total,
             SUM(CASE WHEN status='paid' THEN 1 ELSE 0 END) AS paid,
             SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END) AS sent,
             SUM(CASE WHEN status='overdue' THEN 1 ELSE 0 END) AS overdue,
             SUM(CASE WHEN status='partially_paid' THEN 1 ELSE 0 END) AS partially_paid
             FROM zoho_invoices zi ${where}`, params);

        res.json({
            success: true,
            data: invoices,
            stats: statsRows[0],
            pagination: {
                total,
                page: parseInt(page),
                limit: safeLimit,
                pages: Math.ceil(total / safeLimit),
                totalPages: Math.ceil(total / safeLimit)
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/invoices/:id - Single invoice (from local cache; live fetch only when requested)
 * Query: ?fresh=true to force live Zoho fetch (uses 1 API call)
 */
router.get('/invoices/:id', requirePermission('zoho', 'invoices'), async (req, res) => {
    try {
        // Check local cache
        const [local] = await pool.query(
            `SELECT * FROM zoho_invoices WHERE id = ? OR zoho_invoice_id = ? LIMIT 1`,
            [req.params.id, req.params.id]
        );

        if (local.length === 0) {
            return res.status(404).json({ success: false, message: 'Invoice not found' });
        }

        // Only fetch fresh from Zoho if explicitly requested (saves API calls)
        if (req.query.fresh === 'true') {
            try {
                // Rate limiting handled centrally in apiGet; pass priority for reserve access
                const zohoData = await zohoAPI.getInvoice(local[0].zoho_invoice_id, { caller: 'getInvoiceDetail', priority: 'high' });
                return res.json({
                    success: true,
                    data: { ...local[0], zoho_detail: zohoData.invoice || null }
                });
            } catch (zohoErr) {
                return res.json({
                    success: true,
                    data: local[0],
                    warning: 'Could not fetch live data from Zoho: ' + zohoErr.message
                });
            }
        }

        // Return cached data by default (no API call)
        res.json({ success: true, data: local[0] });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// PAYMENTS
// ========================================

/**
 * GET /api/zoho/payments - List payments
 */
router.get('/payments', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const { search, from_date, to_date, page = 1, limit = 20 } = req.query;
        const safeLimit = Math.min(parseInt(limit) || 20, 500);

        let where = 'WHERE 1=1';
        const params = [];

        if (search) {
            where += ' AND (zp.customer_name LIKE ? OR zp.reference_number LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }
        if (from_date) {
            where += ' AND zp.payment_date >= ?';
            params.push(from_date);
        }
        if (to_date) {
            where += ' AND zp.payment_date <= ?';
            params.push(to_date);
        }

        const offset = (Math.max(1, parseInt(page)) - 1) * safeLimit;

        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) as total FROM zoho_payments zp ${where}`, params
        );

        const [payments] = await pool.query(`
            SELECT zp.*
            FROM zoho_payments zp
            ${where}
            ORDER BY zp.payment_date DESC
            LIMIT ? OFFSET ?
        `, [...params, safeLimit, offset]);

        res.json({
            success: true,
            data: payments,
            pagination: {
                total,
                page: parseInt(page),
                limit: safeLimit,
                pages: Math.ceil(total / safeLimit),
                totalPages: Math.ceil(total / safeLimit)
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/payments/:id - Single payment detail (from local cache)
 */
router.get('/payments/:id', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const [local] = await pool.query(
            `SELECT * FROM zoho_payments WHERE id = ? OR zoho_payment_id = ? LIMIT 1`,
            [req.params.id, req.params.id]
        );

        if (local.length === 0) {
            return res.status(404).json({ success: false, message: 'Payment not found' });
        }

        // Fetch related invoice if linked
        let relatedInvoice = null;
        if (local[0].zoho_invoice_id) {
            const [inv] = await pool.query(
                `SELECT invoice_number, customer_name, total, balance, status, invoice_date, due_date
                 FROM zoho_invoices WHERE zoho_invoice_id = ? LIMIT 1`,
                [local[0].zoho_invoice_id]
            );
            if (inv.length > 0) relatedInvoice = inv[0];
        }

        res.json({ success: true, data: { ...local[0], related_invoice: relatedInvoice } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// CUSTOMERS (Zoho mapped)
// ========================================

/**
 * GET /api/zoho/customers - List Zoho customers with local mapping
 */
router.get('/customers', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const { search, mapped, page = 1, limit = 20 } = req.query;
        const safeLimit = Math.min(parseInt(limit) || 20, 500);

        let where = 'WHERE 1=1';
        const params = [];

        if (search) {
            where += ' AND (zcm.zoho_contact_name LIKE ? OR zcm.zoho_phone LIKE ? OR zcm.zoho_email LIKE ?)';
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        if (mapped === 'true') {
            where += ' AND zcm.local_customer_id IS NOT NULL';
        } else if (mapped === 'false') {
            where += ' AND zcm.local_customer_id IS NULL';
        }

        const offset = (Math.max(1, parseInt(page)) - 1) * safeLimit;

        const [[{ total }]] = await pool.query(
            `SELECT COUNT(*) as total FROM zoho_customers_map zcm ${where}`, params
        );

        const [customers] = await pool.query(`
            SELECT zcm.*, c.name as local_customer_name, c.phone as local_phone
            FROM zoho_customers_map zcm
            LEFT JOIN customers c ON zcm.local_customer_id = c.id
            ${where}
            ORDER BY zcm.zoho_contact_name ASC
            LIMIT ? OFFSET ?
        `, [...params, safeLimit, offset]);

        res.json({
            success: true,
            data: customers,
            pagination: { total, page: parseInt(page), limit: safeLimit, pages: Math.ceil(total / safeLimit), totalPages: Math.ceil(total / safeLimit) }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * PUT /api/zoho/customers/:id/map - Manually map Zoho customer to local customer
 */
router.put('/customers/:id/map', requirePermission('zoho', 'manage'), async (req, res) => {
    try {
        const { local_customer_id } = req.body;
        if (!local_customer_id) {
            return res.status(400).json({ success: false, message: 'local_customer_id required' });
        }

        await pool.query(
            `UPDATE zoho_customers_map SET local_customer_id = ? WHERE id = ?`,
            [local_customer_id, req.params.id]
        );

        res.json({ success: true, message: 'Customer mapped successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// FINANCIAL REPORTS
// ========================================

/**
 * GET /api/zoho/reports/:type - Get financial report
 * Types: profit_loss, balance_sheet, sales_by_customer, sales_by_item, receivables, aging
 */
router.get('/reports/:type', requirePermission('zoho', 'reports'), async (req, res) => {
    try {
        const { type } = req.params;
        const { from_date, to_date, use_cache } = req.query;

        // Check cache first
        if (use_cache !== 'false') {
            const [cached] = await pool.query(`
                SELECT * FROM zoho_financial_reports
                WHERE report_type = ? AND from_date = ? AND to_date = ?
                AND generated_at > DATE_SUB(NOW(), INTERVAL 6 HOUR)
                ORDER BY generated_at DESC LIMIT 1
            `, [type, from_date || null, to_date || null]);

            if (cached.length > 0) {
                return res.json({
                    success: true,
                    data: JSON.parse(cached[0].report_data),
                    summary: cached[0].summary ? JSON.parse(cached[0].summary) : null,
                    cached: true,
                    generated_at: cached[0].generated_at
                });
            }
        }

        // Fetch from Zoho
        let reportData;
        const today = new Date().toISOString().split('T')[0];
        const from = from_date || `${new Date().getFullYear()}-04-01`; // Financial year start (Apr 1)
        const to = to_date || today;

        switch (type) {
            case 'profit_loss':
                reportData = await zohoAPI.getProfitAndLoss(from, to);
                break;
            case 'balance_sheet':
                reportData = await zohoAPI.getBalanceSheet(to);
                break;
            case 'sales_by_customer':
                reportData = await zohoAPI.getSalesByCustomer(from, to);
                break;
            case 'sales_by_item':
                reportData = await zohoAPI.getSalesByItem(from, to);
                break;
            case 'receivables':
                reportData = await zohoAPI.getReceivablesSummary();
                break;
            case 'aging':
                reportData = await zohoAPI.getAgingSummary();
                break;
            default:
                return res.status(400).json({ success: false, message: `Unknown report type: ${type}` });
        }

        // Cache the report
        await pool.query(`
            INSERT INTO zoho_financial_reports (report_type, report_period, from_date, to_date, report_data)
            VALUES (?, ?, ?, ?, ?)
        `, [type, `${from} to ${to}`, from, to, JSON.stringify(reportData)]);

        res.json({
            success: true,
            data: reportData,
            cached: false,
            generated_at: new Date()
        });
    } catch (error) {
        console.error('[Zoho] Report error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});


// ========================================
// DAILY TRANSACTIONS
// ========================================

/**
 * GET /api/zoho/transactions/daily - Summary with date range + location filter
 */
router.get('/transactions/daily', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const { from_date, to_date, location_id, page = 1, limit = 50 } = req.query;
        const safeLimit = Math.min(parseInt(limit) || 50, 500);

        let where = 'WHERE 1=1';
        const params = [];

        if (from_date) { where += ' AND dt.transaction_date >= ?'; params.push(from_date); }
        if (to_date) { where += ' AND dt.transaction_date <= ?'; params.push(to_date); }
        if (location_id) { where += ' AND dt.zoho_location_id = ?'; params.push(location_id); }

        const offset = (Math.max(1, parseInt(page)) - 1) * safeLimit;

        const [[{ total }]] = await pool.query(`
            SELECT COUNT(*) as total FROM zoho_daily_transactions dt
            LEFT JOIN zoho_locations_map lm ON dt.zoho_location_id = lm.zoho_location_id
            ${where} AND (lm.is_active = 1 OR lm.is_active IS NULL)`, params);

        const [transactions] = await pool.query(`
            SELECT dt.*
            FROM zoho_daily_transactions dt
            LEFT JOIN zoho_locations_map lm ON dt.zoho_location_id = lm.zoho_location_id
            ${where} AND (lm.is_active = 1 OR lm.is_active IS NULL)
            ORDER BY dt.transaction_date DESC, dt.location_name ASC
            LIMIT ? OFFSET ?
        `, [...params, safeLimit, offset]);

        res.json({
            success: true,
            data: transactions,
            pagination: { total, page: parseInt(page), limit: safeLimit, pages: Math.ceil(total / safeLimit), totalPages: Math.ceil(total / safeLimit) }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/transactions/daily/:date - Single day across all locations
 */
router.get('/transactions/daily/:date', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const [transactions] = await pool.query(`
            SELECT dt.* FROM zoho_daily_transactions dt
            LEFT JOIN zoho_locations_map lm ON dt.zoho_location_id = lm.zoho_location_id
            WHERE dt.transaction_date = ? AND (lm.is_active = 1 OR lm.is_active IS NULL)
            ORDER BY dt.location_name
        `, [req.params.date]);

        res.json({ success: true, data: transactions });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/transactions/daily/:date/:locationId - Single day + location with line items
 */
router.get('/transactions/daily/:date/:locationId', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const [summary] = await pool.query(`
            SELECT dt.* FROM zoho_daily_transactions dt
            WHERE dt.transaction_date = ? AND dt.zoho_location_id = ?
            LIMIT 1
        `, [req.params.date, req.params.locationId]);

        if (summary.length === 0) {
            return res.status(404).json({ success: false, message: 'No data for this date/location' });
        }

        const [details] = await pool.query(`
            SELECT dtd.* FROM zoho_daily_transaction_details dtd
            WHERE dtd.daily_transaction_id = ?
            ORDER BY dtd.transaction_type, dtd.amount DESC
        `, [summary[0].id]);

        res.json({ success: true, data: { summary: summary[0], details } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * POST /api/zoho/transactions/generate - Generate/refresh report for date range
 */
router.post('/transactions/generate', requirePermission('zoho', 'sync'), async (req, res) => {
    try {
        const { from_date, to_date } = req.body;
        if (!from_date || !to_date) {
            return res.status(400).json({ success: false, message: 'from_date and to_date required' });
        }

        zohoAPI.generateDailyTransactionReport(from_date, to_date, req.user.id).catch(err => {
            console.error('[Zoho] Transaction report generation failed:', err.message);
        });

        res.json({ success: true, message: 'Report generation started. Check sync log for progress.' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * GET /api/zoho/transactions/comparison - Compare locations side-by-side
 */
router.get('/transactions/comparison', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const { from_date, to_date } = req.query;

        let where = 'WHERE dt.zoho_location_id IS NOT NULL';
        const params = [];

        if (from_date) { where += ' AND dt.transaction_date >= ?'; params.push(from_date); }
        if (to_date) { where += ' AND dt.transaction_date <= ?'; params.push(to_date); }

        const [comparison] = await pool.query(`
            SELECT
                dt.zoho_location_id,
                dt.location_name,
                SUM(dt.invoice_count) as total_invoices,
                SUM(dt.invoice_amount) as total_invoice_amount,
                SUM(dt.bill_count) as total_bills,
                SUM(dt.bill_amount) as total_bill_amount,
                SUM(dt.sales_order_count) as total_sales_orders,
                SUM(dt.sales_order_amount) as total_so_amount,
                SUM(dt.purchase_order_count) as total_purchase_orders,
                SUM(dt.purchase_order_amount) as total_po_amount
            FROM zoho_daily_transactions dt
            ${where}
            GROUP BY dt.zoho_location_id, dt.location_name
            ORDER BY total_invoice_amount DESC
        `, params);

        res.json({ success: true, data: comparison });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});


// ==========================================
// EXPENSES
// ==========================================

router.get('/expenses', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const { page=1, limit=50, from_date, to_date, status } = req.query;
        let sql = 'SELECT * FROM zoho_expenses WHERE 1=1';
        const params = [];
        if (from_date) { sql += ' AND date >= ?'; params.push(from_date); }
        if (to_date) { sql += ' AND date <= ?'; params.push(to_date); }
        if (status) { sql += ' AND status = ?'; params.push(status); }
        sql += ' ORDER BY date DESC LIMIT ? OFFSET ?';
        params.push(Number(limit), (Number(page)-1)*Number(limit));
        const [rows] = await pool.query(sql, params);
        const [[{ total }]] = await pool.query('SELECT COUNT(*) as total FROM zoho_expenses');
        res.json({ success: true, expenses: rows, total });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/sync/expenses', requirePermission('zoho', 'sync'), async (req, res) => {
    try {
        const result = await zohoAPI.syncExpenses(req.body || {});
        res.json(result);
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ==========================================
// CREDIT NOTES
// ==========================================

router.get('/creditnotes', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const { page = 1, limit = 50, status, from_date, to_date } = req.query;
        const conditions = ['1=1'];
        const params = [];
        if (status && status !== 'all') { conditions.push('status = ?'); params.push(status); }
        if (from_date) { conditions.push('date >= ?'); params.push(from_date); }
        if (to_date) { conditions.push('date <= ?'); params.push(to_date); }
        const where = conditions.join(' AND ');

        const [[{ total }]] = await pool.query(`SELECT COUNT(*) as total FROM zoho_credit_notes WHERE ${where}`, params);
        const rows = await pool.query(
            `SELECT * FROM zoho_credit_notes WHERE ${where} ORDER BY date DESC LIMIT ? OFFSET ?`,
            [...params, Number(limit), (Number(page) - 1) * Number(limit)]
        ).then(([r]) => r);

        res.json({ success: true, creditnotes: rows, total, page: Number(page), limit: Number(limit) });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.post('/sync/creditnotes', requirePermission('zoho', 'sync'), async (req, res) => {
    try {
        const result = await zohoAPI.syncCreditNotes();
        res.json(result);
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ==========================================
// SALES ORDERS
// ==========================================

router.get('/salesorders', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const { page=1, limit=50, from_date, to_date, status, search } = req.query;
        let sql = `SELECT transaction_id, reference_number as so_number, date,
                          customer_name, total, status, location_id, currency_code
                   FROM zoho_daily_transactions WHERE type = 'sales_order'`;
        const params = [];
        if (from_date) { sql += ' AND date >= ?'; params.push(from_date); }
        if (to_date) { sql += ' AND date <= ?'; params.push(to_date); }
        if (status) { sql += ' AND status = ?'; params.push(status); }
        if (search) { sql += ' AND customer_name LIKE ?'; params.push(`%${search}%`); }
        sql += ' ORDER BY date DESC LIMIT ? OFFSET ?';
        params.push(Number(limit), (Number(page)-1)*Number(limit));
        const [rows] = await pool.query(sql, params);
        res.json({ success: true, salesorders: rows });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

router.get('/salesorders/:id', requirePermission('zoho', 'view'), async (req, res) => {
    try {
        const result = await zohoAPI.getRawSalesOrder(req.params.id);
        res.json({ success: true, salesorder: result.salesorder });
    } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

module.exports = { router, setPool };
