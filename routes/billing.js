/**
 * Billing Routes
 * Estimates, invoices, payments, Zoho push, product search, dashboard stats.
 *
 * Exports: { router, setPool, setPointsEngine }
 */

const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { requirePermission } = require('../middleware/permissionMiddleware');
const { validate, validateQuery, validateParams } = require('../middleware/validate');
const billingZohoService = require('../services/billing-zoho-service');

let pool;
function setPool(p) { pool = p; billingZohoService.setPool(p); }
function setPointsEngine(pe) { billingZohoService.setPointsEngine(pe); }

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════

/**
 * Get branch filter based on user role.
 * Admin/manager/super_admin can optionally filter by query param; staff is locked to own branch.
 */
function getBranchFilter(req) {
    const role = req.user.role;
    if (['admin', 'manager', 'super_admin'].includes(role)) {
        return req.query.branch_id ? Number(req.query.branch_id) : null;
    }
    return req.user.branch_id || null;
}

/**
 * Generate a sequential number: PREFIX-YYYYMMDD-001
 */
async function generateNumber(prefix, table, column) {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const dateStr = `${yyyy}${mm}${dd}`;
    const pattern = `${prefix}-${dateStr}-%`;

    const [rows] = await pool.query(
        `SELECT ${column} FROM ${table} WHERE ${column} LIKE ? ORDER BY id DESC LIMIT 1`,
        [pattern]
    );

    let seq = 1;
    if (rows.length) {
        const last = rows[0][column]; // e.g. EST-20260401-003
        const parts = last.split('-');
        const lastSeq = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(lastSeq)) seq = lastSeq + 1;
    }

    return `${prefix}-${dateStr}-${String(seq).padStart(3, '0')}`;
}

// ═══════════════════════════════════════════
// ZOD SCHEMAS
// ═══════════════════════════════════════════

const estimateItemSchema = z.object({
    zoho_item_id: z.string().min(1),
    item_name: z.string().min(1),
    pack_size: z.string().optional().default(''),
    quantity: z.number().positive(),
    unit_price: z.number().min(0)
});

const createEstimateSchema = z.object({
    customer_type: z.enum(['customer', 'painter']),
    customer_id: z.number().optional().nullable(),
    painter_id: z.number().optional().nullable(),
    customer_name: z.string().min(1),
    customer_phone: z.string().optional().default(''),
    customer_address: z.string().optional().default(''),
    items: z.array(estimateItemSchema).min(1),
    discount_amount: z.number().min(0).optional().default(0),
    notes: z.string().optional().default(''),
    valid_until: z.string().optional().nullable(),
    status: z.enum(['draft', 'sent']).optional().default('draft')
});

const createInvoiceSchema = z.object({
    customer_type: z.enum(['customer', 'painter']),
    customer_id: z.number().optional().nullable(),
    painter_id: z.number().optional().nullable(),
    customer_name: z.string().min(1),
    customer_phone: z.string().optional().default(''),
    customer_address: z.string().optional().default(''),
    items: z.array(estimateItemSchema).min(1),
    discount_amount: z.number().min(0).optional().default(0),
    notes: z.string().optional().default('')
});

const listQuerySchema = z.object({
    page: z.coerce.number().default(1),
    limit: z.coerce.number().default(20).refine(v => v <= 100, { message: 'Limit max 100' }),
    status: z.string().optional(),
    customer_type: z.enum(['customer', 'painter']).optional(),
    search: z.string().optional(),
    branch_id: z.coerce.number().optional()
});

const invoiceListQuerySchema = listQuerySchema.extend({
    payment_status: z.string().optional(),
    zoho_status: z.string().optional()
});

const idParamSchema = z.object({
    id: z.coerce.number().positive()
});

const recordPaymentSchema = z.object({
    amount: z.number().positive(),
    payment_method: z.enum(['cash', 'upi', 'bank_transfer', 'cheque', 'credit']),
    payment_reference: z.string().optional().default(''),
    notes: z.string().optional().default('')
});

// ═══════════════════════════════════════════
// PRODUCT SEARCH
// ═══════════════════════════════════════════

// Customer search (from zoho_customers_map)
router.get('/customers',
    requirePermission('billing', 'estimate'),
    async (req, res) => {
        try {
            const search = req.query.search || '';
            if (search.length < 2) return res.json({ success: true, customers: [] });

            const [customers] = await pool.query(
                `SELECT id, zoho_contact_id, zoho_contact_name, zoho_phone, zoho_email
                 FROM zoho_customers_map
                 WHERE zoho_contact_name LIKE ? OR zoho_phone LIKE ?
                 ORDER BY zoho_contact_name
                 LIMIT 20`,
                [`%${search}%`, `%${search}%`]
            );

            res.json({ success: true, customers });
        } catch (error) {
            console.error('Customer search error:', error);
            res.status(500).json({ success: false, message: error.message });
        }
    }
);

router.get('/products',
    requirePermission('billing', 'estimate'),
    async (req, res) => {
        try {
            const search = req.query.search || '';
            const brand = req.query.brand || '';

            let where = "WHERE zim.status = 'active'";
            const params = [];

            if (search) {
                where += ' AND (zim.zoho_item_name LIKE ? OR zim.sku LIKE ?)';
                const term = `%${search}%`;
                params.push(term, term);
            }
            if (brand) {
                where += ' AND zim.brand = ?';
                params.push(brand);
            }

            const [rows] = await pool.query(
                `SELECT zim.id, zim.zoho_item_id, zim.zoho_item_name AS item_name,
                        zim.sku, zim.rate, zim.brand, zim.category, zim.unit, zim.pack_size
                 FROM zoho_items_map zim
                 ${where}
                 ORDER BY zim.zoho_item_name
                 LIMIT 50`,
                params
            );

            res.json({ success: true, products: rows });
        } catch (error) {
            console.error('Product search error:', error);
            res.status(500).json({ success: false, message: 'Failed to search products' });
        }
    }
);

// ═══════════════════════════════════════════
// DASHBOARD STATS
// ═══════════════════════════════════════════

router.get('/stats',
    requirePermission('billing', 'estimate'),
    async (req, res) => {
        try {
            const branchId = getBranchFilter(req);
            let branchWhere = '';
            const params = [];
            if (branchId) {
                branchWhere = ' AND branch_id = ?';
                params.push(branchId);
            }

            // Estimate counts by status
            const [estCounts] = await pool.query(
                `SELECT status, COUNT(*) AS cnt
                 FROM billing_estimates
                 WHERE 1=1 ${branchWhere}
                 GROUP BY status`,
                params
            );

            // Invoice counts + totals
            const invoiceParams = branchId ? [branchId] : [];
            const [invStats] = await pool.query(
                `SELECT
                     COUNT(*) AS total_invoices,
                     COALESCE(SUM(grand_total), 0) AS total_value,
                     COALESCE(SUM(amount_paid), 0) AS total_collected,
                     COALESCE(SUM(balance_due), 0) AS total_outstanding
                 FROM billing_invoices
                 WHERE 1=1 ${branchWhere}`,
                invoiceParams
            );

            const [invByStatus] = await pool.query(
                `SELECT payment_status, COUNT(*) AS cnt
                 FROM billing_invoices
                 WHERE 1=1 ${branchWhere}
                 GROUP BY payment_status`,
                invoiceParams
            );

            // Today's payments
            const payParams = branchId ? [branchId] : [];
            const [todayPay] = await pool.query(
                `SELECT COALESCE(SUM(bp.amount), 0) AS today_collected
                 FROM billing_payments bp
                 JOIN billing_invoices bi ON bp.invoice_id = bi.id
                 WHERE DATE(bp.created_at) = CURDATE() ${branchId ? ' AND bi.branch_id = ?' : ''}`,
                payParams
            );

            const estimates = {};
            for (const r of estCounts) estimates[r.status] = r.cnt;

            const invoices = {
                ...(invStats[0] || {}),
                by_status: {}
            };
            for (const r of invByStatus) invoices.by_status[r.payment_status] = r.cnt;

            res.json({
                success: true,
                estimates,
                invoices,
                today_collected: todayPay[0]?.today_collected || 0
            });
        } catch (error) {
            console.error('Billing stats error:', error);
            res.status(500).json({ success: false, message: 'Failed to load stats' });
        }
    }
);

// ═══════════════════════════════════════════
// ESTIMATES
// ═══════════════════════════════════════════

// Create estimate
router.post('/estimates',
    requirePermission('billing', 'estimate'),
    validate(createEstimateSchema),
    async (req, res) => {
        try {
            const data = req.body;
            const estimateNumber = await generateNumber('BE', 'billing_estimates', 'estimate_number');

            const subtotal = data.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
            const grandTotal = Math.max(0, subtotal - data.discount_amount);

            const [result] = await pool.query(
                `INSERT INTO billing_estimates
                 (estimate_number, customer_type, customer_id, painter_id,
                  customer_name, customer_phone, customer_address,
                  subtotal, discount_amount, grand_total,
                  notes, valid_until, status, branch_id, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    estimateNumber,
                    data.customer_type,
                    data.customer_id || null,
                    data.painter_id || null,
                    data.customer_name,
                    data.customer_phone,
                    data.customer_address,
                    subtotal,
                    data.discount_amount,
                    grandTotal,
                    data.notes,
                    data.valid_until || null,
                    data.status,
                    req.user.branch_id || null,
                    req.user.id
                ]
            );

            const estimateId = result.insertId;

            // Insert items
            for (const item of data.items) {
                const lineTotal = item.quantity * item.unit_price;
                await pool.query(
                    `INSERT INTO billing_estimate_items
                     (estimate_id, zoho_item_id, item_name, pack_size, quantity, unit_price, line_total)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [estimateId, item.zoho_item_id, item.item_name, item.pack_size, item.quantity, item.unit_price, lineTotal]
                );
            }

            res.json({
                success: true,
                id: estimateId,
                estimate_number: estimateNumber,
                status: data.status,
                grand_total: grandTotal
            });
        } catch (error) {
            console.error('Create estimate error:', error);
            res.status(500).json({ success: false, message: 'Failed to create estimate' });
        }
    }
);

// List estimates
router.get('/estimates',
    requirePermission('billing', 'estimate'),
    validateQuery(listQuerySchema),
    async (req, res) => {
        try {
            const { page, limit, status, customer_type, search } = req.query;
            const branchId = getBranchFilter(req);
            const offset = (page - 1) * limit;

            let where = 'WHERE 1=1';
            const params = [];

            if (branchId) { where += ' AND be.branch_id = ?'; params.push(branchId); }
            if (status) { where += ' AND be.status = ?'; params.push(status); }
            if (customer_type) { where += ' AND be.customer_type = ?'; params.push(customer_type); }
            if (search) {
                where += ' AND (be.customer_name LIKE ? OR be.estimate_number LIKE ?)';
                const term = `%${search}%`;
                params.push(term, term);
            }

            const countParams = [...params];
            const [countRows] = await pool.query(
                `SELECT COUNT(*) AS total FROM billing_estimates be ${where}`,
                countParams
            );
            const total = countRows[0].total;

            params.push(limit, offset);
            const [rows] = await pool.query(
                `SELECT be.*, u.full_name AS created_by_name
                 FROM billing_estimates be
                 LEFT JOIN users u ON be.created_by = u.id
                 ${where}
                 ORDER BY be.created_at DESC
                 LIMIT ? OFFSET ?`,
                params
            );

            res.json({
                success: true,
                estimates: rows,
                pagination: { page, limit, total, pages: Math.ceil(total / limit) }
            });
        } catch (error) {
            console.error('List estimates error:', error);
            res.status(500).json({ success: false, message: 'Failed to list estimates' });
        }
    }
);

// Get estimate detail
router.get('/estimates/:id',
    requirePermission('billing', 'estimate'),
    validateParams(idParamSchema),
    async (req, res) => {
        try {
            const { id } = req.params;

            const [estimates] = await pool.query(
                `SELECT be.*, u.full_name AS created_by_name
                 FROM billing_estimates be
                 LEFT JOIN users u ON be.created_by = u.id
                 WHERE be.id = ?`,
                [id]
            );
            if (!estimates.length) {
                return res.status(404).json({ success: false, message: 'Estimate not found' });
            }

            const [items] = await pool.query(
                'SELECT * FROM billing_estimate_items WHERE estimate_id = ? ORDER BY id',
                [id]
            );

            res.json({ success: true, estimate: estimates[0], items });
        } catch (error) {
            console.error('Get estimate error:', error);
            res.status(500).json({ success: false, message: 'Failed to load estimate' });
        }
    }
);

// Edit estimate (draft/sent only)
router.put('/estimates/:id',
    requirePermission('billing', 'estimate'),
    validateParams(idParamSchema),
    validate(createEstimateSchema),
    async (req, res) => {
        try {
            const { id } = req.params;
            const data = req.body;

            const [existing] = await pool.query(
                'SELECT id, status FROM billing_estimates WHERE id = ?', [id]
            );
            if (!existing.length) {
                return res.status(404).json({ success: false, message: 'Estimate not found' });
            }
            if (!['draft', 'sent'].includes(existing[0].status)) {
                return res.status(400).json({ success: false, message: 'Only draft or sent estimates can be edited' });
            }

            const subtotal = data.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
            const grandTotal = Math.max(0, subtotal - data.discount_amount);

            await pool.query(
                `UPDATE billing_estimates SET
                    customer_type = ?, customer_id = ?, painter_id = ?,
                    customer_name = ?, customer_phone = ?, customer_address = ?,
                    subtotal = ?, discount_amount = ?, grand_total = ?,
                    notes = ?, valid_until = ?, status = ?,
                    updated_at = NOW()
                 WHERE id = ?`,
                [
                    data.customer_type, data.customer_id || null, data.painter_id || null,
                    data.customer_name, data.customer_phone, data.customer_address,
                    subtotal, data.discount_amount, grandTotal,
                    data.notes, data.valid_until || null, data.status,
                    id
                ]
            );

            // Replace items
            await pool.query('DELETE FROM billing_estimate_items WHERE estimate_id = ?', [id]);
            for (const item of data.items) {
                const lineTotal = item.quantity * item.unit_price;
                await pool.query(
                    `INSERT INTO billing_estimate_items
                     (estimate_id, zoho_item_id, item_name, pack_size, quantity, unit_price, line_total)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [id, item.zoho_item_id, item.item_name, item.pack_size, item.quantity, item.unit_price, lineTotal]
                );
            }

            res.json({ success: true, message: 'Estimate updated', grand_total: grandTotal });
        } catch (error) {
            console.error('Edit estimate error:', error);
            res.status(500).json({ success: false, message: 'Failed to update estimate' });
        }
    }
);

// Cancel estimate
router.delete('/estimates/:id',
    requirePermission('billing', 'estimate'),
    validateParams(idParamSchema),
    async (req, res) => {
        try {
            const { id } = req.params;

            const [existing] = await pool.query(
                'SELECT id, status, converted_to_invoice_id FROM billing_estimates WHERE id = ?', [id]
            );
            if (!existing.length) {
                return res.status(404).json({ success: false, message: 'Estimate not found' });
            }
            if (existing[0].converted_to_invoice_id) {
                return res.status(400).json({ success: false, message: 'Cannot cancel a converted estimate' });
            }
            if (existing[0].status === 'cancelled') {
                return res.status(400).json({ success: false, message: 'Estimate is already cancelled' });
            }

            await pool.query(
                "UPDATE billing_estimates SET status = 'cancelled', updated_at = NOW() WHERE id = ?",
                [id]
            );

            res.json({ success: true, message: 'Estimate cancelled' });
        } catch (error) {
            console.error('Cancel estimate error:', error);
            res.status(500).json({ success: false, message: 'Failed to cancel estimate' });
        }
    }
);

// Send estimate (draft -> sent)
router.post('/estimates/:id/send',
    requirePermission('billing', 'estimate'),
    validateParams(idParamSchema),
    async (req, res) => {
        try {
            const { id } = req.params;

            const [existing] = await pool.query(
                'SELECT id, status FROM billing_estimates WHERE id = ?', [id]
            );
            if (!existing.length) {
                return res.status(404).json({ success: false, message: 'Estimate not found' });
            }
            if (existing[0].status !== 'draft') {
                return res.status(400).json({ success: false, message: 'Only draft estimates can be sent' });
            }

            await pool.query(
                "UPDATE billing_estimates SET status = 'sent', updated_at = NOW() WHERE id = ?",
                [id]
            );

            res.json({ success: true, message: 'Estimate sent' });
        } catch (error) {
            console.error('Send estimate error:', error);
            res.status(500).json({ success: false, message: 'Failed to send estimate' });
        }
    }
);

// Convert estimate to invoice
router.post('/estimates/:id/convert',
    requirePermission('billing', 'invoice'),
    validateParams(idParamSchema),
    async (req, res) => {
        try {
            const { id } = req.params;

            const [estimates] = await pool.query(
                'SELECT * FROM billing_estimates WHERE id = ?', [id]
            );
            if (!estimates.length) {
                return res.status(404).json({ success: false, message: 'Estimate not found' });
            }
            const est = estimates[0];

            if (est.status === 'cancelled') {
                return res.status(400).json({ success: false, message: 'Cannot convert a cancelled estimate' });
            }
            if (est.converted_to_invoice_id) {
                return res.status(400).json({ success: false, message: 'Estimate already converted' });
            }

            const invoiceNumber = await generateNumber('BI', 'billing_invoices', 'invoice_number');

            const [invResult] = await pool.query(
                `INSERT INTO billing_invoices
                 (invoice_number, source, estimate_id, customer_type, customer_id, painter_id,
                  customer_name, customer_phone, customer_address,
                  subtotal, discount_amount, grand_total, amount_paid, balance_due,
                  payment_status, notes, branch_id, created_by)
                 VALUES (?, 'estimate', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'unpaid', ?, ?, ?)`,
                [
                    invoiceNumber, id,
                    est.customer_type, est.customer_id, est.painter_id,
                    est.customer_name, est.customer_phone, est.customer_address,
                    est.subtotal, est.discount_amount, est.grand_total,
                    est.grand_total, // balance_due = grand_total initially
                    est.notes,
                    est.branch_id, req.user.id
                ]
            );

            const invoiceId = invResult.insertId;

            // Copy items
            const [estItems] = await pool.query(
                'SELECT * FROM billing_estimate_items WHERE estimate_id = ?', [id]
            );
            for (const item of estItems) {
                await pool.query(
                    `INSERT INTO billing_invoice_items
                     (invoice_id, zoho_item_id, item_name, pack_size, quantity, unit_price, line_total)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [invoiceId, item.zoho_item_id, item.item_name, item.pack_size, item.quantity, item.unit_price, item.line_total]
                );
            }

            // Mark estimate as converted
            await pool.query(
                "UPDATE billing_estimates SET status = 'converted', converted_to_invoice_id = ?, updated_at = NOW() WHERE id = ?",
                [invoiceId, id]
            );

            res.json({
                success: true,
                message: 'Estimate converted to invoice',
                invoice_id: invoiceId,
                invoice_number: invoiceNumber
            });
        } catch (error) {
            console.error('Convert estimate error:', error);
            res.status(500).json({ success: false, message: 'Failed to convert estimate' });
        }
    }
);

// ═══════════════════════════════════════════
// INVOICES
// ═══════════════════════════════════════════

// Create direct invoice
router.post('/invoices',
    requirePermission('billing', 'invoice'),
    validate(createInvoiceSchema),
    async (req, res) => {
        try {
            const data = req.body;
            const invoiceNumber = await generateNumber('BI', 'billing_invoices', 'invoice_number');

            const subtotal = data.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
            const grandTotal = Math.max(0, subtotal - data.discount_amount);

            const [result] = await pool.query(
                `INSERT INTO billing_invoices
                 (invoice_number, source, customer_type, customer_id, painter_id,
                  customer_name, customer_phone, customer_address,
                  subtotal, discount_amount, grand_total, amount_paid, balance_due,
                  payment_status, notes, branch_id, created_by)
                 VALUES (?, 'direct', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'unpaid', ?, ?, ?)`,
                [
                    invoiceNumber,
                    data.customer_type,
                    data.customer_id || null,
                    data.painter_id || null,
                    data.customer_name,
                    data.customer_phone,
                    data.customer_address,
                    subtotal,
                    data.discount_amount,
                    grandTotal,
                    grandTotal, // balance_due
                    data.notes,
                    req.user.branch_id || null,
                    req.user.id
                ]
            );

            const invoiceId = result.insertId;

            for (const item of data.items) {
                const lineTotal = item.quantity * item.unit_price;
                await pool.query(
                    `INSERT INTO billing_invoice_items
                     (invoice_id, zoho_item_id, item_name, pack_size, quantity, unit_price, line_total)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [invoiceId, item.zoho_item_id, item.item_name, item.pack_size, item.quantity, item.unit_price, lineTotal]
                );
            }

            res.json({
                success: true,
                id: invoiceId,
                invoice_number: invoiceNumber,
                grand_total: grandTotal
            });
        } catch (error) {
            console.error('Create invoice error:', error);
            res.status(500).json({ success: false, message: 'Failed to create invoice' });
        }
    }
);

// List invoices
router.get('/invoices',
    requirePermission('billing', 'invoice'),
    validateQuery(invoiceListQuerySchema),
    async (req, res) => {
        try {
            const { page, limit, status, customer_type, search, payment_status, zoho_status } = req.query;
            const branchId = getBranchFilter(req);
            const offset = (page - 1) * limit;

            let where = 'WHERE 1=1';
            const params = [];

            if (branchId) { where += ' AND bi.branch_id = ?'; params.push(branchId); }
            if (status) { where += ' AND bi.status = ?'; params.push(status); }
            if (customer_type) { where += ' AND bi.customer_type = ?'; params.push(customer_type); }
            if (payment_status) { where += ' AND bi.payment_status = ?'; params.push(payment_status); }
            if (zoho_status) { where += ' AND bi.zoho_status = ?'; params.push(zoho_status); }
            if (search) {
                where += ' AND (bi.customer_name LIKE ? OR bi.invoice_number LIKE ?)';
                const term = `%${search}%`;
                params.push(term, term);
            }

            const countParams = [...params];
            const [countRows] = await pool.query(
                `SELECT COUNT(*) AS total FROM billing_invoices bi ${where}`,
                countParams
            );
            const total = countRows[0].total;

            params.push(limit, offset);
            const [rows] = await pool.query(
                `SELECT bi.*, u.full_name AS created_by_name
                 FROM billing_invoices bi
                 LEFT JOIN users u ON bi.created_by = u.id
                 ${where}
                 ORDER BY bi.created_at DESC
                 LIMIT ? OFFSET ?`,
                params
            );

            res.json({
                success: true,
                invoices: rows,
                pagination: { page, limit, total, pages: Math.ceil(total / limit) }
            });
        } catch (error) {
            console.error('List invoices error:', error);
            res.status(500).json({ success: false, message: 'Failed to list invoices' });
        }
    }
);

// Get invoice detail with items + payments
router.get('/invoices/:id',
    requirePermission('billing', 'invoice'),
    validateParams(idParamSchema),
    async (req, res) => {
        try {
            const { id } = req.params;

            const [invoices] = await pool.query(
                `SELECT bi.*, u.full_name AS created_by_name
                 FROM billing_invoices bi
                 LEFT JOIN users u ON bi.created_by = u.id
                 WHERE bi.id = ?`,
                [id]
            );
            if (!invoices.length) {
                return res.status(404).json({ success: false, message: 'Invoice not found' });
            }

            const [items] = await pool.query(
                'SELECT * FROM billing_invoice_items WHERE invoice_id = ? ORDER BY id',
                [id]
            );

            const [payments] = await pool.query(
                `SELECT bp.*, u.full_name AS received_by_name
                 FROM billing_payments bp
                 LEFT JOIN users u ON bp.received_by = u.id
                 WHERE bp.invoice_id = ?
                 ORDER BY bp.created_at DESC`,
                [id]
            );

            res.json({ success: true, invoice: invoices[0], items, payments });
        } catch (error) {
            console.error('Get invoice error:', error);
            res.status(500).json({ success: false, message: 'Failed to load invoice' });
        }
    }
);

// Edit invoice (unpaid + not pushed only)
router.put('/invoices/:id',
    requirePermission('billing', 'invoice'),
    validateParams(idParamSchema),
    validate(createInvoiceSchema),
    async (req, res) => {
        try {
            const { id } = req.params;
            const data = req.body;

            const [existing] = await pool.query(
                'SELECT id, payment_status, zoho_invoice_id FROM billing_invoices WHERE id = ?', [id]
            );
            if (!existing.length) {
                return res.status(404).json({ success: false, message: 'Invoice not found' });
            }
            if (existing[0].payment_status !== 'unpaid') {
                return res.status(400).json({ success: false, message: 'Only unpaid invoices can be edited' });
            }
            if (existing[0].zoho_invoice_id) {
                return res.status(400).json({ success: false, message: 'Cannot edit an invoice already pushed to Zoho' });
            }

            const subtotal = data.items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
            const grandTotal = Math.max(0, subtotal - data.discount_amount);

            await pool.query(
                `UPDATE billing_invoices SET
                    customer_type = ?, customer_id = ?, painter_id = ?,
                    customer_name = ?, customer_phone = ?, customer_address = ?,
                    subtotal = ?, discount_amount = ?, grand_total = ?,
                    balance_due = ?, notes = ?,
                    updated_at = NOW()
                 WHERE id = ?`,
                [
                    data.customer_type, data.customer_id || null, data.painter_id || null,
                    data.customer_name, data.customer_phone, data.customer_address,
                    subtotal, data.discount_amount, grandTotal,
                    grandTotal, // balance_due resets since unpaid
                    data.notes,
                    id
                ]
            );

            // Replace items
            await pool.query('DELETE FROM billing_invoice_items WHERE invoice_id = ?', [id]);
            for (const item of data.items) {
                const lineTotal = item.quantity * item.unit_price;
                await pool.query(
                    `INSERT INTO billing_invoice_items
                     (invoice_id, zoho_item_id, item_name, pack_size, quantity, unit_price, line_total)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [id, item.zoho_item_id, item.item_name, item.pack_size, item.quantity, item.unit_price, lineTotal]
                );
            }

            res.json({ success: true, message: 'Invoice updated', grand_total: grandTotal });
        } catch (error) {
            console.error('Edit invoice error:', error);
            res.status(500).json({ success: false, message: 'Failed to update invoice' });
        }
    }
);

// ═══════════════════════════════════════════
// PAYMENTS
// ═══════════════════════════════════════════

// Record payment against invoice
router.post('/invoices/:id/payment',
    requirePermission('billing', 'payment'),
    validateParams(idParamSchema),
    validate(recordPaymentSchema),
    async (req, res) => {
        try {
            const { id } = req.params;
            const data = req.body;

            const [invoices] = await pool.query(
                'SELECT id, balance_due, payment_status FROM billing_invoices WHERE id = ?', [id]
            );
            if (!invoices.length) {
                return res.status(404).json({ success: false, message: 'Invoice not found' });
            }

            const invoice = invoices[0];
            if (data.amount > invoice.balance_due + 0.01) {
                return res.status(400).json({
                    success: false,
                    message: `Payment amount exceeds balance due (${invoice.balance_due})`
                });
            }

            await pool.query(
                `INSERT INTO billing_payments
                 (invoice_id, amount, payment_method, payment_reference, notes, received_by)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [id, data.amount, data.payment_method, data.payment_reference, data.notes, req.user.id]
            );

            // Recalculate from all payments to avoid floating point drift
            const [paySum] = await pool.query(
                'SELECT COALESCE(SUM(amount), 0) AS total_paid FROM billing_payments WHERE invoice_id = ?',
                [id]
            );
            const totalPaid = Number(paySum[0].total_paid);

            const [inv] = await pool.query('SELECT grand_total FROM billing_invoices WHERE id = ?', [id]);
            const grandTotal = Number(inv[0].grand_total);
            const balanceDue = Math.max(0, grandTotal - totalPaid);
            const paymentStatus = balanceDue <= 0.01 ? 'paid' : 'partial';

            await pool.query(
                `UPDATE billing_invoices SET
                    amount_paid = ?, balance_due = ?, payment_status = ?,
                    updated_at = NOW()
                 WHERE id = ?`,
                [totalPaid, balanceDue, paymentStatus, id]
            );

            res.json({
                success: true,
                message: 'Payment recorded',
                payment_number: paymentNumber,
                amount_paid: totalPaid,
                balance_due: balanceDue,
                payment_status: paymentStatus
            });
        } catch (error) {
            console.error('Record payment error:', error);
            res.status(500).json({ success: false, message: 'Failed to record payment' });
        }
    }
);

// List recent payments
router.get('/payments',
    requirePermission('billing', 'payment'),
    validateQuery(listQuerySchema),
    async (req, res) => {
        try {
            const { page, limit, search } = req.query;
            const branchId = getBranchFilter(req);
            const offset = (page - 1) * limit;

            let where = 'WHERE 1=1';
            const params = [];

            if (branchId) { where += ' AND bi.branch_id = ?'; params.push(branchId); }
            if (search) {
                where += ' AND (bi.customer_name LIKE ? OR bi.invoice_number LIKE ? OR bp.payment_number LIKE ?)';
                const term = `%${search}%`;
                params.push(term, term, term);
            }

            const countParams = [...params];
            const [countRows] = await pool.query(
                `SELECT COUNT(*) AS total
                 FROM billing_payments bp
                 JOIN billing_invoices bi ON bp.invoice_id = bi.id
                 ${where}`,
                countParams
            );
            const total = countRows[0].total;

            params.push(limit, offset);
            const [rows] = await pool.query(
                `SELECT bp.*, bi.invoice_number, bi.customer_name, bi.customer_type,
                        u.full_name AS received_by_name
                 FROM billing_payments bp
                 JOIN billing_invoices bi ON bp.invoice_id = bi.id
                 LEFT JOIN users u ON bp.received_by = u.id
                 ${where}
                 ORDER BY bp.created_at DESC
                 LIMIT ? OFFSET ?`,
                params
            );

            res.json({
                success: true,
                payments: rows,
                pagination: { page, limit, total, pages: Math.ceil(total / limit) }
            });
        } catch (error) {
            console.error('List payments error:', error);
            res.status(500).json({ success: false, message: 'Failed to list payments' });
        }
    }
);

// ═══════════════════════════════════════════
// ZOHO PUSH
// ═══════════════════════════════════════════

router.post('/invoices/:id/push-zoho',
    requirePermission('billing', 'zoho_push'),
    validateParams(idParamSchema),
    async (req, res) => {
        try {
            const { id } = req.params;
            const result = await billingZohoService.pushInvoiceToZoho(id, req.user.id);
            res.json({
                success: true,
                message: 'Invoice pushed to Zoho',
                zoho_invoice_id: result.zohoInvoiceId,
                zoho_invoice_number: result.zohoInvoiceNumber,
                points_result: result.pointsResult || null
            });
        } catch (error) {
            console.error('Push to Zoho error:', error);
            res.status(500).json({ success: false, message: error.message || 'Failed to push to Zoho' });
        }
    }
);

// ═══════════════════════════════════════════

module.exports = { router, setPool, setPointsEngine };
