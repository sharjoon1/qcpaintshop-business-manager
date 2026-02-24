/**
 * COLLECTIONS ROUTES
 * Outstanding invoice management & payment collection tracking
 * Now with per-branch filtering and customer-branch assignment
 *
 * Endpoints:
 *   GET    /api/zoho/collections/summary             - Dashboard stats
 *   GET    /api/zoho/collections/customers            - Customer-wise outstanding
 *   GET    /api/zoho/collections/invoices             - Filterable invoice list
 *   POST   /api/zoho/collections/remind               - Send WhatsApp reminders
 *   POST   /api/zoho/collections/remind/log           - Log non-WhatsApp reminder
 *   GET    /api/zoho/collections/reminders            - Reminder history
 *   GET    /api/zoho/collections/promises             - List promises
 *   POST   /api/zoho/collections/promises             - Create promise-to-pay
 *   PUT    /api/zoho/collections/promises/:id         - Update promise status
 *   GET    /api/zoho/collections/export               - CSV export
 *   PUT    /api/zoho/collections/customers/:customerId/branch  - Assign customer to branch
 *   POST   /api/zoho/collections/customers/assign-branch       - Bulk assign customers to branch
 */

const express = require('express');
const router = express.Router();
const { requirePermission } = require('../middleware/permissionMiddleware');

let pool;
function setPool(p) { pool = p; }

const perm = requirePermission('zoho', 'collections');

// Helper: resolve branch_id from user role
function getBranchFilter(req) {
    if (req.user.role === 'admin') {
        return req.query.branch_id ? parseInt(req.query.branch_id) : null;
    }
    return req.user.branch_id || null;
}

// ========================================
// SUMMARY
// ========================================

router.get('/summary', perm, async (req, res) => {
    try {
        const branchId = getBranchFilter(req);

        const branchJoin = branchId ? 'LEFT JOIN zoho_customers_map zcm ON zi.zoho_customer_id = zcm.zoho_contact_id' : '';
        const branchWhere = branchId ? 'AND zcm.branch_id = ?' : '';
        const branchParams = branchId ? [branchId] : [];

        // Outstanding & overdue totals
        const [totals] = await pool.query(`
            SELECT
                COALESCE(SUM(zi.balance), 0) as total_outstanding,
                COALESCE(SUM(CASE WHEN zi.due_date < CURDATE() AND zi.balance > 0 THEN zi.balance ELSE 0 END), 0) as overdue_amount,
                COUNT(CASE WHEN zi.due_date < CURDATE() AND zi.balance > 0 THEN 1 END) as overdue_count,
                COUNT(CASE WHEN zi.balance > 0 THEN 1 END) as outstanding_count,
                COALESCE(AVG(CASE WHEN zi.due_date < CURDATE() AND zi.balance > 0 THEN DATEDIFF(CURDATE(), zi.due_date) END), 0) as avg_days_overdue
            FROM zoho_invoices zi
            ${branchJoin}
            WHERE zi.balance > 0 AND zi.status NOT IN ('void', 'draft')
            ${branchWhere}
        `, branchParams);

        // Collection rate (30 days)
        const [collected30d] = await pool.query(`
            SELECT COALESCE(SUM(zp.amount), 0) as collected
            FROM zoho_payments zp
            ${branchId ? 'LEFT JOIN zoho_customers_map zcm ON zp.zoho_customer_id = zcm.zoho_contact_id' : ''}
            WHERE zp.payment_date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
            ${branchWhere}
        `, branchParams);

        // Reminders sent today
        const [remindersToday] = await pool.query(`
            SELECT COUNT(*) as count FROM collection_reminders
            WHERE DATE(created_at) = CURDATE()
            ${branchId ? 'AND branch_id = ?' : ''}
        `, branchParams);

        // Pending promises
        const [pendingPromises] = await pool.query(`
            SELECT COUNT(*) as count, COALESCE(SUM(promise_amount), 0) as amount
            FROM payment_promises WHERE status = 'pending'
            ${branchId ? 'AND branch_id = ?' : ''}
        `, branchParams);

        // Broken promises (past date + still pending)
        const [brokenPromises] = await pool.query(`
            SELECT COUNT(*) as count FROM payment_promises
            WHERE status = 'pending' AND promise_date < CURDATE()
            ${branchId ? 'AND branch_id = ?' : ''}
        `, branchParams);

        const stats = totals[0];
        const outstandingStart = parseFloat(stats.total_outstanding) + parseFloat(collected30d[0].collected);
        const collectionRate = outstandingStart > 0
            ? ((parseFloat(collected30d[0].collected) / outstandingStart) * 100).toFixed(1)
            : 0;

        res.json({
            success: true,
            data: {
                total_outstanding: parseFloat(stats.total_outstanding),
                overdue_amount: parseFloat(stats.overdue_amount),
                overdue_count: stats.overdue_count,
                outstanding_count: stats.outstanding_count,
                avg_days_overdue: Math.round(parseFloat(stats.avg_days_overdue)),
                collection_rate_30d: parseFloat(collectionRate),
                collected_30d: parseFloat(collected30d[0].collected),
                reminders_today: remindersToday[0].count,
                pending_promises: pendingPromises[0].count,
                pending_promises_amount: parseFloat(pendingPromises[0].amount),
                broken_promises: brokenPromises[0].count
            }
        });
    } catch (error) {
        console.error('[Collections] Summary error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// CUSTOMERS
// ========================================

router.get('/customers', perm, async (req, res) => {
    try {
        const { search, sort, order, page = 1, limit = 25 } = req.query;
        const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
        const branchId = getBranchFilter(req);

        let where = 'WHERE zi.balance > 0 AND zi.status NOT IN (\'void\', \'draft\')';
        const params = [];

        if (branchId) {
            where += ' AND zcm.branch_id = ?';
            params.push(branchId);
        }

        if (search) {
            where += ' AND (zcm.zoho_contact_name LIKE ? OR zcm.zoho_phone LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }

        // Customer-grouped query
        const [customers] = await pool.query(`
            SELECT
                zi.zoho_customer_id,
                zcm.zoho_contact_name as customer_name,
                zcm.zoho_phone as phone,
                zcm.branch_id,
                zcm.credit_limit,
                CASE WHEN zcm.credit_limit > 0
                     THEN ROUND((zcm.zoho_outstanding / zcm.credit_limit) * 100, 1) ELSE 0 END as credit_utilization,
                COUNT(*) as invoice_count,
                SUM(zi.balance) as total_outstanding,
                SUM(zi.total) as total_invoiced,
                MIN(zi.due_date) as oldest_due_date,
                MAX(zi.due_date) as newest_due_date,
                SUM(CASE WHEN zi.due_date < CURDATE() THEN zi.balance ELSE 0 END) as overdue_amount,
                COUNT(CASE WHEN zi.due_date < CURDATE() AND zi.balance > 0 THEN 1 END) as overdue_count,
                (SELECT MAX(cr.created_at) FROM collection_reminders cr WHERE cr.zoho_customer_id = zi.zoho_customer_id) as last_reminder,
                (SELECT COUNT(*) FROM payment_promises pp WHERE pp.zoho_customer_id = zi.zoho_customer_id AND pp.status = 'pending') as pending_promises
            FROM zoho_invoices zi
            LEFT JOIN zoho_customers_map zcm ON zi.zoho_customer_id = zcm.zoho_contact_id
            ${where}
            GROUP BY zi.zoho_customer_id, zcm.zoho_contact_name, zcm.zoho_phone, zcm.branch_id, zcm.credit_limit, zcm.zoho_outstanding
            ORDER BY ${getSortColumn(sort, 'total_outstanding')} ${order === 'asc' ? 'ASC' : 'DESC'}
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), offset]);

        // Total count for pagination
        const [countResult] = await pool.query(`
            SELECT COUNT(DISTINCT zi.zoho_customer_id) as total
            FROM zoho_invoices zi
            LEFT JOIN zoho_customers_map zcm ON zi.zoho_customer_id = zcm.zoho_contact_id
            ${where}
        `, params);

        res.json({
            success: true,
            data: customers,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: countResult[0].total
            }
        });
    } catch (error) {
        console.error('[Collections] Customers error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// INVOICES
// ========================================

router.get('/invoices', perm, async (req, res) => {
    try {
        const { search, status, from_date, to_date, customer_id, sort, order, page = 1, limit = 25 } = req.query;
        const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
        const branchId = getBranchFilter(req);

        let where = 'WHERE zi.balance > 0 AND zi.status NOT IN (\'void\', \'draft\')';
        const params = [];

        if (branchId) {
            where += ' AND zcm.branch_id = ?';
            params.push(branchId);
        }

        if (search) {
            where += ' AND (zi.invoice_number LIKE ? OR zcm.zoho_contact_name LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }
        if (status === 'overdue') {
            where += ' AND zi.due_date < CURDATE()';
        } else if (status === 'not_overdue') {
            where += ' AND zi.due_date >= CURDATE()';
        } else if (status === 'sent' || status === 'partially_paid') {
            where += ' AND zi.status = ?';
            params.push(status);
        }
        if (from_date) {
            where += ' AND zi.invoice_date >= ?';
            params.push(from_date);
        }
        if (to_date) {
            where += ' AND zi.invoice_date <= ?';
            params.push(to_date);
        }
        if (customer_id) {
            where += ' AND zi.zoho_customer_id = ?';
            params.push(customer_id);
        }

        const sortCol = getInvoiceSortColumn(sort);
        const [invoices] = await pool.query(`
            SELECT
                zi.zoho_invoice_id,
                zi.invoice_number,
                zi.zoho_customer_id,
                zcm.zoho_contact_name as customer_name,
                zcm.zoho_phone as phone,
                zcm.branch_id,
                zi.total,
                zi.balance,
                zi.invoice_date,
                zi.due_date,
                zi.status,
                CASE WHEN zi.due_date < CURDATE() THEN DATEDIFF(CURDATE(), zi.due_date) ELSE 0 END as days_overdue,
                (SELECT MAX(cr.created_at) FROM collection_reminders cr WHERE cr.zoho_invoice_id = zi.zoho_invoice_id) as last_reminder,
                (SELECT COUNT(*) FROM collection_reminders cr WHERE cr.zoho_invoice_id = zi.zoho_invoice_id) as reminder_count
            FROM zoho_invoices zi
            LEFT JOIN zoho_customers_map zcm ON zi.zoho_customer_id = zcm.zoho_contact_id
            ${where}
            ORDER BY ${sortCol} ${order === 'asc' ? 'ASC' : 'DESC'}
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), offset]);

        const [countResult] = await pool.query(`
            SELECT COUNT(*) as total
            FROM zoho_invoices zi
            LEFT JOIN zoho_customers_map zcm ON zi.zoho_customer_id = zcm.zoho_contact_id
            ${where}
        `, params);

        res.json({
            success: true,
            data: invoices,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: countResult[0].total
            }
        });
    } catch (error) {
        console.error('[Collections] Invoices error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// SEND WHATSAPP REMINDERS
// ========================================

router.post('/remind', perm, async (req, res) => {
    try {
        const { reminders } = req.body;
        // reminders: [{ zoho_invoice_id, zoho_customer_id, customer_name, phone, message_body, balance }]

        if (!reminders || !Array.isArray(reminders) || reminders.length === 0) {
            return res.status(400).json({ success: false, message: 'reminders array is required' });
        }

        const branchId = getBranchFilter(req);

        const results = [];
        for (const r of reminders) {
            if (!r.phone || !r.message_body) {
                results.push({ zoho_invoice_id: r.zoho_invoice_id, success: false, error: 'Missing phone or message' });
                continue;
            }

            // Resolve branch for WhatsApp routing
            let msgBranchId;
            if (r.session_type === 'general') {
                // Explicitly route via General WhatsApp (branch_id = 0)
                msgBranchId = 0;
            } else {
                // Auto mode: request body → branch filter → customer mapping → null
                msgBranchId = r.branch_id || branchId;
                if (!msgBranchId && r.zoho_customer_id) {
                    const [custRow] = await pool.query(
                        'SELECT branch_id FROM zoho_customers_map WHERE zoho_contact_id = ?',
                        [r.zoho_customer_id]
                    );
                    msgBranchId = custRow[0]?.branch_id || null;
                }
            }

            // 1. Insert into whatsapp_followups queue (with branch_id for routing)
            const [wfResult] = await pool.query(`
                INSERT INTO whatsapp_followups (
                    zoho_customer_id, zoho_invoice_id,
                    customer_name, phone, message_type, message_body,
                    amount, scheduled_at, created_by, branch_id
                ) VALUES (?, ?, ?, ?, ?, ?, ?, NOW(), ?, ?)
            `, [
                r.zoho_customer_id || null, r.zoho_invoice_id || null,
                r.customer_name || 'Unknown', r.phone, 'payment_reminder', r.message_body,
                r.balance || null, req.user.id, msgBranchId || null
            ]);

            // 2. Insert into collection_reminders audit log
            await pool.query(`
                INSERT INTO collection_reminders (
                    zoho_invoice_id, zoho_customer_id, customer_name, phone,
                    reminder_type, message_content, whatsapp_queue_id,
                    status, sent_at, sent_by, branch_id
                ) VALUES (?, ?, ?, ?, 'whatsapp', ?, ?, 'pending', NOW(), ?, ?)
            `, [
                r.zoho_invoice_id || '', r.zoho_customer_id || '',
                r.customer_name || 'Unknown', r.phone,
                r.message_body, wfResult.insertId, req.user.id, msgBranchId || null
            ]);

            results.push({ zoho_invoice_id: r.zoho_invoice_id, success: true, whatsapp_queue_id: wfResult.insertId });
        }

        const successCount = results.filter(r => r.success).length;
        res.json({
            success: true,
            message: `${successCount}/${reminders.length} reminders queued`,
            data: results
        });
    } catch (error) {
        console.error('[Collections] Remind error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// LOG NON-WHATSAPP REMINDER
// ========================================

router.post('/remind/log', perm, async (req, res) => {
    try {
        const { zoho_invoice_id, zoho_customer_id, customer_name, phone, reminder_type, notes } = req.body;

        if (!zoho_customer_id || !reminder_type) {
            return res.status(400).json({ success: false, message: 'zoho_customer_id and reminder_type are required' });
        }

        if (!['call', 'visit', 'email'].includes(reminder_type)) {
            return res.status(400).json({ success: false, message: 'reminder_type must be call, visit, or email' });
        }

        const branchId = getBranchFilter(req);

        const [result] = await pool.query(`
            INSERT INTO collection_reminders (
                zoho_invoice_id, zoho_customer_id, customer_name, phone,
                reminder_type, message_content, status, sent_at, sent_by, notes, branch_id
            ) VALUES (?, ?, ?, ?, ?, ?, 'sent', NOW(), ?, ?, ?)
        `, [
            zoho_invoice_id || '', zoho_customer_id, customer_name || '', phone || '',
            reminder_type, notes || '', req.user.id, notes || '', branchId || null
        ]);

        res.json({
            success: true,
            message: `${reminder_type} logged successfully`,
            data: { id: result.insertId }
        });
    } catch (error) {
        console.error('[Collections] Log reminder error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// REMINDER HISTORY
// ========================================

router.get('/reminders', perm, async (req, res) => {
    try {
        const { customer_id, invoice_id, type, from_date, to_date, page = 1, limit = 25 } = req.query;
        const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
        const branchId = getBranchFilter(req);

        let where = 'WHERE 1=1';
        const params = [];

        if (branchId) {
            where += ' AND cr.branch_id = ?';
            params.push(branchId);
        }
        if (customer_id) {
            where += ' AND cr.zoho_customer_id = ?';
            params.push(customer_id);
        }
        if (invoice_id) {
            where += ' AND cr.zoho_invoice_id = ?';
            params.push(invoice_id);
        }
        if (type) {
            where += ' AND cr.reminder_type = ?';
            params.push(type);
        }
        if (from_date) {
            where += ' AND DATE(cr.created_at) >= ?';
            params.push(from_date);
        }
        if (to_date) {
            where += ' AND DATE(cr.created_at) <= ?';
            params.push(to_date);
        }

        const [reminders] = await pool.query(`
            SELECT cr.*, u.full_name as sent_by_name
            FROM collection_reminders cr
            LEFT JOIN users u ON cr.sent_by = u.id
            ${where}
            ORDER BY cr.created_at DESC
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), offset]);

        const [countResult] = await pool.query(`
            SELECT COUNT(*) as total FROM collection_reminders cr ${where}
        `, params);

        res.json({
            success: true,
            data: reminders,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: countResult[0].total
            }
        });
    } catch (error) {
        console.error('[Collections] Reminders error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// PROMISES
// ========================================

router.get('/promises', perm, async (req, res) => {
    try {
        const { status, customer_id, from_date, to_date, page = 1, limit = 25 } = req.query;
        const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
        const branchId = getBranchFilter(req);

        let where = 'WHERE 1=1';
        const params = [];

        if (branchId) {
            where += ' AND pp.branch_id = ?';
            params.push(branchId);
        }

        if (status) {
            if (status === 'broken_auto') {
                // Auto-detect: pending + past promise_date
                where += ' AND pp.status = \'pending\' AND pp.promise_date < CURDATE()';
            } else {
                where += ' AND pp.status = ?';
                params.push(status);
            }
        }
        if (customer_id) {
            where += ' AND pp.zoho_customer_id = ?';
            params.push(customer_id);
        }
        if (from_date) {
            where += ' AND pp.promise_date >= ?';
            params.push(from_date);
        }
        if (to_date) {
            where += ' AND pp.promise_date <= ?';
            params.push(to_date);
        }

        const [promises] = await pool.query(`
            SELECT pp.*, u.full_name as created_by_name,
                CASE WHEN pp.status = 'pending' AND pp.promise_date < CURDATE() THEN 1 ELSE 0 END as is_broken
            FROM payment_promises pp
            LEFT JOIN users u ON pp.created_by = u.id
            ${where}
            ORDER BY pp.promise_date ASC
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), offset]);

        const [countResult] = await pool.query(`
            SELECT COUNT(*) as total FROM payment_promises pp ${where}
        `, params);

        res.json({
            success: true,
            data: promises,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: countResult[0].total
            }
        });
    } catch (error) {
        console.error('[Collections] Promises list error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

router.post('/promises', perm, async (req, res) => {
    try {
        const { zoho_invoice_id, zoho_customer_id, customer_name, promise_date, promise_amount, notes, follow_up_date } = req.body;

        if (!zoho_customer_id || !promise_date || !promise_amount) {
            return res.status(400).json({ success: false, message: 'zoho_customer_id, promise_date, and promise_amount are required' });
        }

        const branchId = getBranchFilter(req);

        const [result] = await pool.query(`
            INSERT INTO payment_promises (
                zoho_invoice_id, zoho_customer_id, customer_name,
                promise_date, promise_amount, notes, follow_up_date, created_by, branch_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            zoho_invoice_id || null, zoho_customer_id, customer_name || '',
            promise_date, promise_amount, notes || null, follow_up_date || null, req.user.id, branchId || null
        ]);

        res.json({
            success: true,
            message: 'Promise recorded',
            data: { id: result.insertId }
        });
    } catch (error) {
        console.error('[Collections] Create promise error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

router.put('/promises/:id', perm, async (req, res) => {
    try {
        const { status, actual_payment_date, actual_amount, notes, follow_up_date } = req.body;

        if (!status || !['pending', 'kept', 'broken', 'partial'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Valid status is required (pending, kept, broken, partial)' });
        }

        const updates = ['status = ?'];
        const params = [status];

        if (actual_payment_date) { updates.push('actual_payment_date = ?'); params.push(actual_payment_date); }
        if (actual_amount !== undefined) { updates.push('actual_amount = ?'); params.push(actual_amount); }
        if (notes !== undefined) { updates.push('notes = ?'); params.push(notes); }
        if (follow_up_date !== undefined) { updates.push('follow_up_date = ?'); params.push(follow_up_date); }

        params.push(req.params.id);

        const [result] = await pool.query(
            `UPDATE payment_promises SET ${updates.join(', ')} WHERE id = ?`,
            params
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Promise not found' });
        }

        res.json({ success: true, message: 'Promise updated' });
    } catch (error) {
        console.error('[Collections] Update promise error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// EXPORT CSV
// ========================================

router.get('/export', perm, async (req, res) => {
    try {
        const { status, from_date, to_date, customer_id } = req.query;
        const branchId = getBranchFilter(req);

        let where = 'WHERE zi.balance > 0 AND zi.status NOT IN (\'void\', \'draft\')';
        const params = [];

        if (branchId) {
            where += ' AND zcm.branch_id = ?';
            params.push(branchId);
        }

        if (status === 'overdue') {
            where += ' AND zi.due_date < CURDATE()';
        }
        if (from_date) { where += ' AND zi.invoice_date >= ?'; params.push(from_date); }
        if (to_date) { where += ' AND zi.invoice_date <= ?'; params.push(to_date); }
        if (customer_id) { where += ' AND zi.zoho_customer_id = ?'; params.push(customer_id); }

        const [rows] = await pool.query(`
            SELECT
                zi.invoice_number as "Invoice #",
                zcm.zoho_contact_name as "Customer",
                zcm.zoho_phone as "Phone",
                zi.invoice_date as "Invoice Date",
                zi.due_date as "Due Date",
                zi.total as "Total",
                zi.balance as "Balance",
                CASE WHEN zi.due_date < CURDATE() THEN DATEDIFF(CURDATE(), zi.due_date) ELSE 0 END as "Days Overdue",
                zi.status as "Status"
            FROM zoho_invoices zi
            LEFT JOIN zoho_customers_map zcm ON zi.zoho_customer_id = zcm.zoho_contact_id
            ${where}
            ORDER BY zi.balance DESC
        `, params);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'No data to export' });
        }

        const headers = Object.keys(rows[0]);
        const csvLines = [headers.join(',')];
        for (const row of rows) {
            csvLines.push(headers.map(h => {
                const val = row[h] === null || row[h] === undefined ? '' : String(row[h]);
                return val.includes(',') || val.includes('"') ? `"${val.replace(/"/g, '""')}"` : val;
            }).join(','));
        }

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename=collections-export-${new Date().toISOString().slice(0,10)}.csv`);
        res.send(csvLines.join('\n'));
    } catch (error) {
        console.error('[Collections] Export error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// CUSTOMER-BRANCH ASSIGNMENT
// ========================================

// Assign single customer to branch
router.put('/customers/:customerId/branch', requirePermission('zoho', 'collections'), async (req, res) => {
    try {
        const { customerId } = req.params;
        const { branch_id } = req.body;

        if (branch_id !== null && branch_id !== undefined && isNaN(parseInt(branch_id))) {
            return res.status(400).json({ success: false, message: 'branch_id must be a number or null' });
        }

        const [result] = await pool.query(
            `UPDATE zoho_customers_map SET branch_id = ? WHERE zoho_contact_id = ?`,
            [branch_id || null, customerId]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }

        res.json({ success: true, message: 'Customer branch updated' });
    } catch (error) {
        console.error('[Collections] Assign branch error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Bulk assign customers to branch
router.post('/customers/assign-branch', requirePermission('zoho', 'collections'), async (req, res) => {
    try {
        const { customer_ids, branch_id } = req.body;

        if (!customer_ids || !Array.isArray(customer_ids) || customer_ids.length === 0) {
            return res.status(400).json({ success: false, message: 'customer_ids array is required' });
        }
        if (branch_id !== null && branch_id !== undefined && isNaN(parseInt(branch_id))) {
            return res.status(400).json({ success: false, message: 'branch_id must be a number or null' });
        }

        const placeholders = customer_ids.map(() => '?').join(',');
        const [result] = await pool.query(
            `UPDATE zoho_customers_map SET branch_id = ? WHERE zoho_contact_id IN (${placeholders})`,
            [branch_id || null, ...customer_ids]
        );

        res.json({
            success: true,
            message: `${result.affectedRows} customers updated`,
            data: { updated: result.affectedRows }
        });
    } catch (error) {
        console.error('[Collections] Bulk assign error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// HELPERS
// ========================================

function getSortColumn(sort, defaultCol) {
    const allowed = {
        total_outstanding: 'total_outstanding',
        customer_name: 'zcm.zoho_contact_name',
        invoice_count: 'invoice_count',
        overdue_amount: 'overdue_amount',
        oldest_due_date: 'oldest_due_date',
        last_reminder: 'last_reminder'
    };
    return allowed[sort] || allowed[defaultCol] || defaultCol;
}

function getInvoiceSortColumn(sort) {
    const allowed = {
        balance: 'zi.balance',
        total: 'zi.total',
        due_date: 'zi.due_date',
        invoice_date: 'zi.invoice_date',
        customer_name: 'zcm.zoho_contact_name',
        days_overdue: 'days_overdue',
        invoice_number: 'zi.invoice_number'
    };
    return allowed[sort] || 'zi.balance';
}

module.exports = { router, setPool };
