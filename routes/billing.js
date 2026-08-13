/**
 * Billing Routes
 * Estimates, invoices, payments, Zoho push, product search, dashboard stats.
 *
 * Exports: { router, setPool, setPointsEngine } + calculateTotals,
 * createEstimateSchema, recordPaymentSchema (the latter for unit testing only).
 */

const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { requirePermission, isFullAdmin, hasRolePermission } = require('../middleware/permissionMiddleware');
const { validate, validateQuery, validateParams } = require('../middleware/validate');
const billingZohoService = require('../services/billing-zoho-service');
const zohoAPI = require('../services/zoho-api');
const auditLog = require('../services/audit-log');
const { idempotent, setPool: setIdempotencyPool } = require('../middleware/idempotency');
const { istDateString, classifyPaymentReversal } = require('../services/zoho-payment-mapper');

let pool;
let pointsEngine = null;
function setPool(p) { pool = p; billingZohoService.setPool(p); auditLog.setPool(p); setIdempotencyPool(p); }
function setPointsEngine(pe) { pointsEngine = pe; billingZohoService.setPointsEngine(pe); }

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════

/**
 * Get branch filter based on user role.
 * Admin/manager/super_admin can optionally filter by query param; staff is locked to own branch.
 */
function getBranchFilter(req) {
    if (!req.user) return null;
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

/**
 * Compute estimate/invoice money totals (shared by the four create/edit endpoints).
 * No rounding here — values are stored as computed; grand total floors at 0.
 */
function calculateTotals(items, discountAmount = 0) {
    const subtotal = items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0);
    const grandTotal = Math.max(0, subtotal - discountAmount);
    return { subtotal, grandTotal };
}

/**
 * Overpayment guard (1-paisa tolerance). DECIMAL columns come back from
 * mysql2 as STRINGS (the pool has no decimalNumbers option), so both sides
 * must be coerced — the old inline check (`amount > balance_due + 0.01`)
 * string-concatenated to e.g. '500.000.01', compared against NaN, and
 * therefore never rejected anything.
 */
function paymentExceedsBalance(amount, balanceDue) {
    return Number(amount) > (Number(balanceDue) || 0) + 0.01;
}

/**
 * Settle an invoice from its grand total + total paid (both may be mysql2
 * DECIMAL strings). Extracted from the record-payment handler so the money math
 * is testable directly (paymentExceedsBalance precedent). Balance floors at 0,
 * and a balance within the 1-paisa rounding tolerance is 'paid', otherwise
 * 'partial'.
 *
 * SP-1 C6: gained the `totalPaid <= 0 → 'unpaid'` case so that a FULLY-reversed
 * invoice (all payments soft-deleted) drops back to 'unpaid' — which re-opens
 * the delete/void path (the "reverse it first" dead end closes). The record path
 * never hits this branch: a positive payment was just inserted, so totalPaid is
 * always > 0 there and the paid/partial behavior is byte-identical to pre-SP1.
 */
function computePaymentSettlement(grandTotal, totalPaid) {
    const gt = Number(grandTotal) || 0;
    const paid = Number(totalPaid) || 0;
    const balanceDue = Math.max(0, gt - paid);
    let paymentStatus;
    if (paid <= 0) paymentStatus = 'unpaid';
    else if (balanceDue <= 0.01) paymentStatus = 'paid';
    else paymentStatus = 'partial';
    return { balanceDue, paymentStatus };
}

/**
 * Re-SUM an invoice's live (non-soft-deleted) payments and rewrite its header
 * money columns. Shared by the record-payment path and the reversal path so the
 * settlement math + SUM filter live in ONE tested place. `db` is a pool OR a
 * transaction connection (both expose .query). The SUM excludes soft-deleted
 * rows (deleted_at IS NULL) — a reversed payment stops counting immediately.
 * @returns {Promise<{totalPaid:number, balanceDue:number, paymentStatus:string}>}
 */
async function recalcInvoicePaymentTotals(db, invoiceId) {
    const [paySum] = await db.query(
        'SELECT COALESCE(SUM(amount), 0) AS total_paid FROM billing_payments WHERE invoice_id = ? AND deleted_at IS NULL',
        [invoiceId]
    );
    const totalPaid = Number(paySum[0].total_paid);
    const [invRows] = await db.query(
        'SELECT grand_total FROM billing_invoices WHERE id = ?',
        [invoiceId]
    );
    const grandTotal = invRows.length ? invRows[0].grand_total : 0;
    const { balanceDue, paymentStatus } = computePaymentSettlement(grandTotal, totalPaid);
    await db.query(
        `UPDATE billing_invoices SET
            amount_paid = ?, balance_due = ?, payment_status = ?, updated_at = NOW()
         WHERE id = ?`,
        [totalPaid, balanceDue, paymentStatus, invoiceId]
    );
    return { totalPaid, balanceDue, paymentStatus };
}

/**
 * Count an invoice's LIVE (non-reversed) payments. The delete/void refusal uses
 * this so a fully-reversed invoice (all payments soft-deleted) becomes
 * deletable again. Exported for direct testing (no supertest).
 */
async function countLiveInvoicePayments(db, invoiceId) {
    const [rows] = await db.query(
        'SELECT COUNT(*) AS c FROM billing_payments WHERE invoice_id = ? AND deleted_at IS NULL',
        [invoiceId]
    );
    return Number(rows[0].c) || 0;
}

/**
 * Reverse (soft-delete) a single billing payment, Zoho-first. Extracted from the
 * DELETE handler so it's unit-testable without supertest (paymentExceedsBalance
 * precedent). Uses the module-level `pool` + `zohoAPI`.
 *
 * Order (mirrors the invoice void flow at routes/billing.js delete-invoice):
 *   1. Load the live payment (404 → NOT_FOUND).
 *   2. classifyPaymentReversal(zoho_payment_id):
 *        - in_flight ('SYNCING')      → throw SYNC_IN_FLIGHT (409); nothing touched.
 *        - zoho_delete_required       → deleteCustomerPayment FIRST; a
 *          /does not exist|1002/i is tolerated as already-gone; ANY other Zoho
 *          error → throw ZOHO_DELETE_FAILED (502) with the Zoho message verbatim
 *          and NO local change.
 *        - legacy_manual ('LEGACY')   → skip Zoho; the caller appends the
 *          "adjust in Zoho manually" note.
 *        - local_only (NULL)          → skip Zoho.
 *   3. In ONE transaction: soft-delete the row + recalc the parent invoice
 *      totals (a full reversal flips it back to 'unpaid').
 * @returns {Promise<{payment:Object, zohoDeleted:boolean, legacyManual:boolean, recalced:Object}>}
 */
async function reverseInvoicePayment(paymentId) {
    const [rows] = await pool.query(
        'SELECT * FROM billing_payments WHERE id = ? AND deleted_at IS NULL',
        [paymentId]
    );
    if (!rows.length) { const e = new Error('Payment not found'); e.code = 'NOT_FOUND'; throw e; }
    const payment = rows[0];

    const kind = classifyPaymentReversal(payment.zoho_payment_id);
    if (kind === 'in_flight') {
        const e = new Error('This payment is mid-sync to Zoho — retry the reversal in a minute.');
        e.code = 'SYNC_IN_FLIGHT';
        throw e;
    }

    let zohoDeleted = false;
    let legacyManual = false;
    if (kind === 'zoho_delete_required') {
        try {
            await zohoAPI.deleteCustomerPayment(payment.zoho_payment_id);
            zohoDeleted = true;
        } catch (zErr) {
            // Already gone from Zoho (deleted there directly — error 1002) → treat
            // as deleted and proceed locally, exactly like the invoice-void path.
            if (/does not exist|1002/i.test(zErr.message || '')) {
                zohoDeleted = true;
            } else {
                const e = new Error(zErr.message || String(zErr));
                e.code = 'ZOHO_DELETE_FAILED';
                throw e; // NO local change on any other Zoho error
            }
        }
    } else if (kind === 'legacy_manual') {
        legacyManual = true;
    }

    let recalced;
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await connection.query('UPDATE billing_payments SET deleted_at = NOW() WHERE id = ?', [paymentId]);
        recalced = await recalcInvoicePaymentTotals(connection, payment.invoice_id);
        await connection.commit();
    } catch (txErr) {
        try { await connection.rollback(); } catch { /* already rolled back */ }
        throw txErr;
    } finally {
        connection.release();
    }

    return { payment, zohoDeleted, legacyManual, recalced };
}

/**
 * Derive the point-in-time zoho_sync response field from a forwardInvoicePayments
 * summary. Never throws; a null/absent summary is 'not_applicable'.
 * @returns {{status:'synced'|'partial'|'failed'|'pending'|'not_applicable', detail:(string|null)}}
 */
function deriveZohoSync(summary) {
    if (!summary) return { status: 'not_applicable', detail: null };
    const ok = (summary.synced || 0) + (summary.adopted || 0);
    const failedList = Array.isArray(summary.failed) ? summary.failed : [];
    const failedCount = failedList.length;
    const pending = summary.pending || 0;
    if (ok > 0 && failedCount > 0) {
        return { status: 'partial', detail: `${ok} synced, ${failedCount} failed` };
    }
    if (failedCount > 0) {
        return { status: 'failed', detail: failedList.map(f => f.message).join('; ').slice(0, 255) };
    }
    if (ok > 0) {
        return { status: 'synced', detail: `${ok} payment(s) synced to Zoho` };
    }
    if (pending > 0) {
        return { status: 'pending', detail: 'Payment(s) waiting on Zoho invoice approval' };
    }
    return { status: 'not_applicable', detail: null };
}

/**
 * B1.1 create-time credit eligibility — the SAME evaluation the Zoho push gate
 * applies (services/billing-zoho-service.js pushInvoiceToZoho step 4), minus
 * its side effects: the push path resolves the Zoho contact and CREATES one
 * when missing; at create time we only READ the existing mapping. A customer/
 * painter with no existing Zoho contact mapping is exactly what the push gate
 * ends up treating as "not in the credit system" (a freshly created contact
 * has no credit limit) ⇒ ineligible. checkCreditBeforeInvoice is reused
 * verbatim, and — mirroring the push gate's structural check — allowed:true
 * WITHOUT a credit_limit field ("Customer not in credit system") is NOT
 * eligible: eligibility requires an actual evaluated limit.
 * @returns {Promise<{eligible:boolean, limit:(number|null), available:(number|null), reason:(string|null)}>}
 */
async function evaluateCreditForSale(customerType, customerId, painterId, amount) {
    // Resolve the existing Zoho contact id (read-only — never creates one).
    let zohoContactId = null;
    try {
        if (customerType === 'painter' && painterId) {
            // Same both-column read as resolveZohoContact (zoho_contact_id is
            // the billing column; painter-sync writes zoho_customer_id).
            const [rows] = await pool.query(
                'SELECT zoho_contact_id, zoho_customer_id FROM painters WHERE id = ? LIMIT 1',
                [painterId]
            );
            if (rows.length) zohoContactId = rows[0].zoho_contact_id || rows[0].zoho_customer_id || null;
        } else if (customerType === 'customer' && customerId) {
            const [rows] = await pool.query(
                'SELECT zoho_contact_id FROM zoho_customers_map WHERE id = ? LIMIT 1',
                [customerId]
            );
            if (rows.length) zohoContactId = rows[0].zoho_contact_id || null;
        }
    } catch { zohoContactId = null; }

    // Same default + same error handling as the push gate.
    let credit = { allowed: false, reason: 'Customer is not in the credit system' };
    if (zohoContactId) {
        try {
            const { checkCreditBeforeInvoice } = require('./credit-limits');
            const result = await checkCreditBeforeInvoice(pool, zohoContactId, amount);
            if (result) credit = result;
        } catch (err) {
            credit = { allowed: false, reason: 'Credit check failed: ' + err.message };
        }
    }
    const eligible = credit.allowed === true && credit.credit_limit != null;
    return {
        eligible,
        limit: credit.credit_limit != null ? Number(credit.credit_limit) : null,
        available: credit.available != null ? Number(credit.available) : null,
        reason: credit.reason || null
    };
}

// ═══════════════════════════════════════════
// ZOD SCHEMAS
// ═══════════════════════════════════════════

const estimateItemSchema = z.object({
    zoho_item_id: z.string().min(1),
    item_name: z.string().min(1),
    pack_size: z.string().optional().default(''),
    quantity: z.number().positive(),
    unit_price: z.number().min(0),
    // B1.1: printable line description (owner feedback #6). Stored on
    // billing_invoice_items.description (nullable); estimates simply ignore it.
    description: z.string().optional().nullable()
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
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(100, { message: 'Limit max 100' }).default(20),
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
    notes: z.string().optional().default(''),
    // Optional back-date (yyyy-mm-dd); defaults to today in IST at the handler.
    payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'payment_date must be YYYY-MM-DD').optional()
});

// B1a quick-sale: invoice + items + up to 4 split payments in one call.
// NO 'credit' method here — a quick sale records money actually received; a
// credit sale goes through the normal invoice + credit-limit flow.
const quickSalePaymentSchema = z.object({
    amount: z.number().positive(),
    payment_method: z.enum(['cash', 'upi', 'bank_transfer', 'cheque']),
    payment_reference: z.string().optional().default(''),
    // Optional back-date (yyyy-mm-dd); defaults to today in IST at the handler.
    payment_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'payment_date must be YYYY-MM-DD').optional()
});

const quickSaleSchema = z.object({
    customer_type: z.enum(['customer', 'painter']),
    customer_id: z.number().optional().nullable(),
    painter_id: z.number().optional().nullable(),
    customer_name: z.string().min(1),
    customer_phone: z.string().optional().default(''),
    customer_address: z.string().optional().default(''),
    items: z.array(estimateItemSchema).min(1),
    discount_amount: z.number().min(0).optional().default(0),
    notes: z.string().optional().default(''),
    payments: z.array(quickSalePaymentSchema).max(4).optional().default([]),
    // Optional Zoho overrides stamped onto the invoice for the auto-push;
    // when absent the push resolves its own defaults (user/config/branch).
    salesperson_id: z.string().optional().nullable(),
    zoho_location_id: z.string().optional().nullable()
});

// B1.1: GET /credit-check — the quick-sale UI pre-check (same evaluation the
// quick-sale create gate and the Zoho push gate apply).
const creditCheckQuerySchema = z.object({
    customer_type: z.enum(['customer', 'painter']),
    customer_id: z.coerce.number().positive().optional(),
    painter_id: z.coerce.number().positive().optional(),
    amount: z.coerce.number().min(0).default(0)
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

            // B1a: resolve the caller's stock location so the product picker can
            // show live branch stock. Staff → own branch; admin may pass
            // ?branch_id. branches.zoho_location_id first, else the active
            // zoho_locations_map row for that branch. '' sentinel when
            // unresolvable — it matches no zoho_location_id, so the stock
            // columns read NULL and the response stays backward compatible.
            // Lookup failures never break the search.
            let stockLocationId = '';
            try {
                const branchId = getBranchFilter(req);
                if (branchId) {
                    const [br] = await pool.query('SELECT zoho_location_id FROM branches WHERE id = ? LIMIT 1', [branchId]);
                    if (br.length && br[0].zoho_location_id) stockLocationId = br[0].zoho_location_id;
                    if (!stockLocationId) {
                        const [lm] = await pool.query(
                            'SELECT zoho_location_id FROM zoho_locations_map WHERE local_branch_id = ? AND is_active = 1 LIMIT 1',
                            [branchId]
                        );
                        if (lm.length && lm[0].zoho_location_id) stockLocationId = lm[0].zoho_location_id;
                    }
                }
            } catch { stockLocationId = ''; }

            let where = "WHERE zim.zoho_status = 'active'";
            // The zoho_location_stock JOIN's ? appears BEFORE the WHERE ?s in
            // SQL order — its param must come FIRST.
            const params = [stockLocationId];

            if (search) {
                where += ' AND (zim.zoho_item_name LIKE ? OR zim.zoho_sku LIKE ?)';
                const term = `%${search}%`;
                params.push(term, term);
            }
            if (brand) {
                where += ' AND zim.zoho_brand = ?';
                params.push(brand);
            }

            const [rows] = await pool.query(
                `SELECT zim.id, zim.zoho_item_id, zim.zoho_item_name AS item_name,
                        zim.zoho_sku AS sku, zim.zoho_rate AS rate, zim.zoho_brand AS brand,
                        zim.zoho_category_name AS category, zim.zoho_unit AS unit,
                        zim.zoho_description AS description,
                        ps.pack_size,
                        zls.stock_on_hand, zls.available_for_sale AS stock,
                        zls.last_synced_at AS stock_as_of
                 FROM zoho_items_map zim
                 LEFT JOIN (
                     SELECT zoho_item_id, MAX(TRIM(CONCAT(size, ' ', COALESCE(unit, '')))) AS pack_size
                     FROM pack_sizes
                     WHERE is_active = 1 AND zoho_item_id IS NOT NULL
                     GROUP BY zoho_item_id
                 ) ps ON ps.zoho_item_id = zim.zoho_item_id
                 LEFT JOIN zoho_location_stock zls
                        ON zls.zoho_item_id = zim.zoho_item_id AND zls.zoho_location_id = ?
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
                 WHERE deleted_at IS NULL ${branchWhere}`,
                invoiceParams
            );

            const [invByStatus] = await pool.query(
                `SELECT payment_status, COUNT(*) AS cnt
                 FROM billing_invoices
                 WHERE deleted_at IS NULL ${branchWhere}
                 GROUP BY payment_status`,
                invoiceParams
            );

            // Today's payments — "today" is the IST business day. The DB session
            // is forced to UTC, so CURDATE() would roll over at 05:30 IST.
            const payParams = branchId ? [branchId] : [];
            const [todayPay] = await pool.query(
                `SELECT COALESCE(SUM(bp.amount), 0) AS today_collected
                 FROM billing_payments bp
                 JOIN billing_invoices bi ON bp.invoice_id = bi.id
                 WHERE bp.deleted_at IS NULL
                 AND DATE(CONVERT_TZ(bp.created_at, '+00:00', '+05:30')) = DATE(CONVERT_TZ(NOW(), '+00:00', '+05:30'))
                 ${branchId ? ' AND bi.branch_id = ?' : ''}`,
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
    idempotent('billing.estimate.create'),
    requirePermission('billing', 'estimate'),
    validate(createEstimateSchema),
    async (req, res) => {
        // billing_estimates.branch_id is NOT NULL — fail fast with a clear
        // message instead of an opaque 500 from the INSERT.
        if (!req.user.branch_id) {
            return res.status(400).json({ success: false, message: 'Your account has no branch assigned. Ask an admin to set your branch before billing.' });
        }
        const connection = await pool.getConnection();
        try {
            const data = req.body;
            const estimateNumber = await generateNumber('BE', 'billing_estimates', 'estimate_number');

            const { subtotal, grandTotal } = calculateTotals(data.items, data.discount_amount);

            await connection.beginTransaction();

            const [result] = await connection.execute(
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
                    req.user.branch_id,
                    req.user.id
                ]
            );

            const estimateId = result.insertId;

            // Insert items
            for (const item of data.items) {
                const lineTotal = item.quantity * item.unit_price;
                await connection.execute(
                    `INSERT INTO billing_estimate_items
                     (estimate_id, zoho_item_id, item_name, pack_size, quantity, unit_price, line_total)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [estimateId, item.zoho_item_id, item.item_name, item.pack_size, item.quantity, item.unit_price, lineTotal]
                );
            }

            await connection.commit();

            res.json({
                success: true,
                id: estimateId,
                estimate_number: estimateNumber,
                status: data.status,
                grand_total: grandTotal
            });
        } catch (error) {
            await connection.rollback();
            console.error('Create estimate error:', error);
            res.status(500).json({ success: false, message: 'Failed to create estimate' });
        } finally {
            connection.release();
        }
    }
);

// List estimates
router.get('/estimates',
    requirePermission('billing', 'estimate'),
    validateQuery(listQuerySchema),
    async (req, res) => {
        try {
            const { status, customer_type, search } = req.query;
            const page = Number(req.query.page) || 1;
            const limit = Number(req.query.limit) || 20;
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
                'SELECT * FROM billing_estimate_items WHERE estimate_id = ? AND deleted_at IS NULL ORDER BY id',
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
        const connection = await pool.getConnection();
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

            const { subtotal, grandTotal } = calculateTotals(data.items, data.discount_amount);

            // Capture pre-edit items for audit trail (U18)
            const [beforeItems] = await pool.query(
                'SELECT * FROM billing_estimate_items WHERE estimate_id = ? AND deleted_at IS NULL ORDER BY id',
                [id]
            );

            await connection.beginTransaction();

            await connection.execute(
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

            // Soft-delete existing items (history preserved for U18 audit trail)
            await connection.execute('UPDATE billing_estimate_items SET deleted_at = NOW() WHERE estimate_id = ? AND deleted_at IS NULL', [id]);
            for (const item of data.items) {
                const lineTotal = item.quantity * item.unit_price;
                await connection.execute(
                    `INSERT INTO billing_estimate_items
                     (estimate_id, zoho_item_id, item_name, pack_size, quantity, unit_price, line_total)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [id, item.zoho_item_id, item.item_name, item.pack_size, item.quantity, item.unit_price, lineTotal]
                );
            }

            await connection.commit();

            auditLog.record(req, {
                action: 'billing.estimate.items.replace',
                entity_type: 'billing_estimate',
                entity_id: id,
                before: { items: beforeItems },
                after:  { items: data.items, grand_total: grandTotal }
            });

            res.json({ success: true, message: 'Estimate updated', grand_total: grandTotal });
        } catch (error) {
            await connection.rollback();
            console.error('Edit estimate error:', error);
            res.status(500).json({ success: false, message: 'Failed to update estimate' });
        } finally {
            connection.release();
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
                'SELECT * FROM billing_estimates WHERE id = ?', [id]
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

            await auditLog.record(req, {
                action: 'billing.estimate.cancel',
                entity_type: 'billing_estimate',
                entity_id: id,
                before: existing[0],
                after: { ...existing[0], status: 'cancelled' }
            });

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
        const connection = await pool.getConnection();
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

            await connection.beginTransaction();

            const [invResult] = await connection.execute(
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
            const [estItems] = await connection.execute(
                'SELECT * FROM billing_estimate_items WHERE estimate_id = ? AND deleted_at IS NULL', [id]
            );
            for (const item of estItems) {
                await connection.execute(
                    `INSERT INTO billing_invoice_items
                     (invoice_id, zoho_item_id, item_name, pack_size, quantity, unit_price, line_total)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [invoiceId, item.zoho_item_id, item.item_name, item.pack_size, item.quantity, item.unit_price, item.line_total]
                );
            }

            // Mark estimate as converted
            await connection.execute(
                "UPDATE billing_estimates SET status = 'converted', converted_to_invoice_id = ?, updated_at = NOW() WHERE id = ?",
                [invoiceId, id]
            );

            await connection.commit();

            // Invoice birth audit (B1a) — best-effort, never fails the response.
            await auditLog.record(req, {
                action: 'billing.invoice.create',
                entity_type: 'billing_invoice', entity_id: invoiceId,
                before: null,
                after: {
                    invoice_number: invoiceNumber, source: 'estimate', estimate_id: id,
                    customer_type: est.customer_type, grand_total: est.grand_total
                }
            });

            res.json({
                success: true,
                message: 'Estimate converted to invoice',
                invoice_id: invoiceId,
                invoice_number: invoiceNumber
            });
        } catch (error) {
            await connection.rollback();
            console.error('Convert estimate error:', error);
            res.status(500).json({ success: false, message: 'Failed to convert estimate' });
        } finally {
            connection.release();
        }
    }
);

// ═══════════════════════════════════════════
// INVOICES
// ═══════════════════════════════════════════

// Create direct invoice
router.post('/invoices',
    idempotent('billing.invoice.create'),
    requirePermission('billing', 'invoice'),
    validate(createInvoiceSchema),
    async (req, res) => {
        // billing_invoices.branch_id is NOT NULL — fail fast with a clear
        // message instead of an opaque 500 from the INSERT.
        if (!req.user.branch_id) {
            return res.status(400).json({ success: false, message: 'Your account has no branch assigned. Ask an admin to set your branch before billing.' });
        }
        const connection = await pool.getConnection();
        try {
            const data = req.body;
            const invoiceNumber = await generateNumber('BI', 'billing_invoices', 'invoice_number');

            const { subtotal, grandTotal } = calculateTotals(data.items, data.discount_amount);

            await connection.beginTransaction();

            const [result] = await connection.execute(
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
                    req.user.branch_id,
                    req.user.id
                ]
            );

            const invoiceId = result.insertId;

            for (const item of data.items) {
                const lineTotal = item.quantity * item.unit_price;
                await connection.execute(
                    `INSERT INTO billing_invoice_items
                     (invoice_id, zoho_item_id, item_name, pack_size, quantity, unit_price, line_total, description)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [invoiceId, item.zoho_item_id, item.item_name, item.pack_size, item.quantity, item.unit_price, lineTotal, item.description || null]
                );
            }

            await connection.commit();

            // Invoice birth audit (B1a) — best-effort, never fails the response.
            await auditLog.record(req, {
                action: 'billing.invoice.create',
                entity_type: 'billing_invoice', entity_id: invoiceId,
                before: null,
                after: {
                    invoice_number: invoiceNumber, source: 'direct',
                    customer_type: data.customer_type, grand_total: grandTotal
                }
            });

            res.json({
                success: true,
                id: invoiceId,
                invoice_number: invoiceNumber,
                grand_total: grandTotal
            });
        } catch (error) {
            await connection.rollback();
            console.error('Create invoice error:', error);
            res.status(500).json({ success: false, message: 'Failed to create invoice' });
        } finally {
            connection.release();
        }
    }
);

// ═══════════════════════════════════════════
// QUICK SALE (B1a)
// One-screen counter sale: invoice + items + up to 4 split payments in ONE
// local transaction (phase 1), then — after commit, never changing the 200 —
// a best-effort auto-push to Zoho behind the ai_config flag
// 'billing_auto_push_on_save' (phase 2). A push failure stamps
// zoho_push_error/zoho_push_attempted_at so the 15-min retry cron picks it up.
// ═══════════════════════════════════════════

router.post('/quick-sale',
    // Auth BEFORE idempotency: a replayed Idempotency-Key must never be served
    // to an unauthenticated caller (judge finding, mirrors push-zoho's order).
    requirePermission('billing', 'invoice'),
    idempotent('billing.quicksale.create'),
    validate(quickSaleSchema),
    async (req, res) => {
        const data = req.body;
        const admin = isFullAdmin(req.user && req.user.role);

        // Recording money needs the payment permission too (mirrors
        // POST /invoices/:id/payment) — checked in-handler because the route
        // itself only demands billing.invoice for a zero-payment sale.
        if ((data.payments || []).length > 0 && !admin) {
            let allowed = false;
            try { allowed = await hasRolePermission(req.user.role, 'billing', 'payment'); }
            catch { allowed = false; }
            if (!allowed) {
                return res.status(403).json({
                    success: false, code: 'PERMISSION_DENIED',
                    message: 'Recording a payment requires the billing.payment permission.'
                });
            }
        }

        // billing_invoices.branch_id is NOT NULL — fail fast with a clear
        // message instead of an opaque 500 from the INSERT (same guard as
        // POST /invoices).
        if (!req.user.branch_id) {
            return res.status(400).json({ success: false, message: 'Your account has no branch assigned. Ask an admin to set your branch before billing.' });
        }

        const { subtotal, grandTotal } = calculateTotals(data.items, data.discount_amount);

        // Pre-transaction overpay guard (same 1-paisa tolerance as
        // paymentExceedsBalance) — refuse before touching the DB.
        const paymentsTotal = (data.payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
        if (paymentsTotal > grandTotal + 0.01) {
            return res.status(400).json({
                success: false, code: 'PAYMENT_EXCEEDS_TOTAL',
                message: `Payments (${paymentsTotal.toFixed(2)}) exceed the invoice total (${grandTotal.toFixed(2)})`
            });
        }

        // B1.1 credit gate (owner feedback #5): a sale that leaves ANY unpaid
        // balance (incl. payments:[]) is a credit sale — refuse at CREATE time,
        // BEFORE the transaction, unless the customer passes the SAME credit
        // eligibility the Zoho push gate applies (paid OR evaluated limit with
        // enough available). The push gate stays as-is (second net). Same
        // 1-paisa tolerance as the push gate's balance_due check.
        const unpaidBalance = Math.max(0, grandTotal - paymentsTotal);
        if (unpaidBalance > 0.01) {
            const credit = await evaluateCreditForSale(
                data.customer_type, data.customer_id || null, data.painter_id || null, unpaidBalance
            );
            if (!credit.eligible) {
                return res.status(400).json({
                    success: false, code: 'CREDIT_REQUIRED',
                    message: 'இந்த customer-க்கு credit limit இல்லை — முழு பணம் வாங்கவும் அல்லது admin-ஐ தொடர்பு கொள்ளவும்.',
                    reason: credit.reason || null,
                    credit: { limit: credit.limit, available: credit.available }
                });
            }
        }

        // ── Phase 1: the local money record — ONE transaction ──
        let invoiceId, invoiceNumber, settled;
        const insertedPayments = [];
        const connection = await pool.getConnection();
        try {
            invoiceNumber = await generateNumber('BI', 'billing_invoices', 'invoice_number');

            await connection.beginTransaction();

            const [result] = await connection.execute(
                `INSERT INTO billing_invoices
                 (invoice_number, source, customer_type, customer_id, painter_id,
                  customer_name, customer_phone, customer_address,
                  subtotal, discount_amount, grand_total, amount_paid, balance_due,
                  payment_status, notes, branch_id, created_by,
                  zoho_salesperson_id, zoho_location_id)
                 VALUES (?, 'direct', ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'unpaid', ?, ?, ?, ?, ?)`,
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
                    grandTotal, // balance_due before the payment rows land
                    data.notes,
                    req.user.branch_id,
                    req.user.id,
                    data.salesperson_id || null,
                    data.zoho_location_id || null
                ]
            );
            invoiceId = result.insertId;

            for (const item of data.items) {
                const lineTotal = item.quantity * item.unit_price;
                await connection.execute(
                    `INSERT INTO billing_invoice_items
                     (invoice_id, zoho_item_id, item_name, pack_size, quantity, unit_price, line_total, description)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [invoiceId, item.zoho_item_id, item.item_name, item.pack_size, item.quantity, item.unit_price, lineTotal, item.description || null]
                );
            }

            for (const pay of (data.payments || [])) {
                // yyyy-mm-dd; default today in IST (server clock IST, DB session UTC).
                const payDate = pay.payment_date || istDateString(new Date());
                const [ins] = await connection.execute(
                    `INSERT INTO billing_payments
                     (invoice_id, amount, payment_method, payment_reference, payment_date, notes, received_by)
                     VALUES (?, ?, ?, ?, ?, '', ?)`,
                    [invoiceId, pay.amount, pay.payment_method, pay.payment_reference, payDate, req.user.id]
                );
                insertedPayments.push({ id: ins.insertId, amount: pay.amount, payment_method: pay.payment_method });
            }

            // One shared settlement path (same math as record-payment/reversal).
            settled = await recalcInvoicePaymentTotals(connection, invoiceId);

            await connection.commit();
        } catch (error) {
            try { await connection.rollback(); } catch { /* already rolled back */ }
            console.error('Quick sale error:', error);
            return res.status(500).json({ success: false, message: 'Failed to create quick sale' });
        } finally {
            connection.release();
        }

        // ── Phase 2: after commit — best-effort, NEVER changes the 200 ──
        await auditLog.record(req, {
            action: 'billing.quicksale.create',
            entity_type: 'billing_invoice', entity_id: invoiceId,
            before: null,
            after: {
                invoice_number: invoiceNumber, grand_total: grandTotal,
                amount_paid: settled.totalPaid, payment_status: settled.paymentStatus,
                payments: insertedPayments.length
            }
        });

        const zoho = { attempted: false, pushed: false, code: null, error: null };
        try {
            if (await billingZohoService.flagOn('billing_auto_push_on_save')) {
                zoho.attempted = true;
                const result = await billingZohoService.pushInvoiceToZoho(invoiceId, req.user.id, { isAdmin: admin });
                zoho.pushed = true;
                zoho.zoho_invoice_id = result.zohoInvoiceId;
                zoho.zoho_invoice_number = result.zohoInvoiceNumber;
                zoho.zoho_state = result.zohoState || null;
                zoho.salesperson_name = result.salespersonName || null;
                zoho.location_name = result.locationName || null;
                zoho.payment_sync = result.paymentSync ? deriveZohoSync(result.paymentSync) : null;
                await auditLog.record(req, {
                    action: 'billing.invoice.zohoPush',
                    entity_type: 'billing_invoice', entity_id: invoiceId,
                    before: null,
                    after: { zoho_invoice_id: result.zohoInvoiceId, zoho_state: result.zohoState || null, auto: true }
                });
            }
        } catch (err) {
            zoho.pushed = false;
            zoho.code = err.code || 'PUSH_FAILED';
            zoho.error = String(err.message || err).slice(0, 255);
            // Stamp the failure so the 15-min retry cron can pick it up.
            try {
                await pool.query(
                    'UPDATE billing_invoices SET zoho_push_error = ?, zoho_push_attempted_at = NOW() WHERE id = ?',
                    [zoho.error, invoiceId]
                );
            } catch { /* stamp is best-effort */ }
            if (err.code === 'PUSH_GATE' || err.code === 'SALESPERSON_REQUIRED') {
                await auditLog.record(req, {
                    action: 'billing.invoice.zohoPush.refused',
                    entity_type: 'billing_invoice', entity_id: invoiceId,
                    before: null, after: { code: err.code, error: zoho.error, auto: true }
                });
            }
        }

        res.json({
            success: true,
            invoice: {
                id: invoiceId,
                invoice_number: invoiceNumber,
                subtotal,
                discount_amount: data.discount_amount,
                grand_total: grandTotal,
                amount_paid: settled.totalPaid,
                balance_due: settled.balanceDue,
                payment_status: settled.paymentStatus
            },
            payments: insertedPayments,
            zoho,
            print_url: `/billing-receipt.html?id=${invoiceId}`
        });
    }
);

// List invoices
router.get('/invoices',
    requirePermission('billing', 'invoice'),
    validateQuery(invoiceListQuerySchema),
    async (req, res) => {
        try {
            // NOTE: no `status` filter here — billing_invoices has no `status`
            // column (payment_status / zoho_status only); `AND bi.status = ?`
            // was a guaranteed SQL error for any caller that passed it.
            const { customer_type, search, payment_status, zoho_status } = req.query;
            const page = Number(req.query.page) || 1;
            const limit = Number(req.query.limit) || 20;
            const branchId = getBranchFilter(req);
            const offset = (page - 1) * limit;

            let where = 'WHERE bi.deleted_at IS NULL';
            const params = [];

            if (branchId) { where += ' AND bi.branch_id = ?'; params.push(branchId); }
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

            // Join the painter so the push UI can pre-select the painter's own
            // mapped Zoho salesperson on a painter invoice (owner 2026-06-12:
            // for a painter invoice the salesperson IS the painter — don't make
            // staff pick it blind from the full list).
            const [invoices] = await pool.query(
                `SELECT bi.*, u.full_name AS created_by_name,
                        p.zoho_salesperson_id AS painter_salesperson_id,
                        p.full_name AS painter_full_name
                 FROM billing_invoices bi
                 LEFT JOIN users u ON bi.created_by = u.id
                 LEFT JOIN painters p ON bi.painter_id = p.id
                 WHERE bi.id = ? AND bi.deleted_at IS NULL`,
                [id]
            );
            if (!invoices.length) {
                return res.status(404).json({ success: false, message: 'Invoice not found' });
            }

            const [items] = await pool.query(
                'SELECT * FROM billing_invoice_items WHERE invoice_id = ? AND deleted_at IS NULL ORDER BY id',
                [id]
            );

            const [payments] = await pool.query(
                `SELECT bp.*, u.full_name AS received_by_name
                 FROM billing_payments bp
                 LEFT JOIN users u ON bp.received_by = u.id
                 WHERE bp.invoice_id = ? AND bp.deleted_at IS NULL
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

// Delete / Void invoice (owner 2026-06-12). Drafts (not pushed) → soft-cancel
// locally. Pushed → admin-only → VOID in Zoho (GST-safe) + reverse painter
// points. Refused when the invoice has any payment. Never hard-deletes.
router.delete('/invoices/:id',
    requirePermission('billing', 'invoice'),
    validateParams(idParamSchema),
    async (req, res) => {
        try {
            const { id } = req.params;
            const [rows] = await pool.query('SELECT * FROM billing_invoices WHERE id = ? AND deleted_at IS NULL', [id]);
            if (!rows.length) return res.status(404).json({ success: false, message: 'Invoice not found' });
            const inv = rows[0];

            // Gate: never delete an invoice that has a LIVE payment (orphans money
            // rows; Zoho also refuses to void/delete a paid invoice). A fully
            // reversed invoice (all payments soft-deleted) drops to 'unpaid' with
            // amount_paid 0 and zero live payments — so it becomes deletable again.
            const amountPaid = parseFloat(inv.amount_paid) || 0;
            const liveCount = await countLiveInvoicePayments(pool, id);
            if (inv.payment_status !== 'unpaid' || amountPaid > 0.01 || liveCount > 0) {
                return res.status(400).json({ success: false, code: 'INVOICE_HAS_PAYMENTS', message: 'This invoice has a payment recorded — reverse the payment first (or handle it directly in Zoho).' });
            }

            const pushed = !!inv.zoho_invoice_id;
            if (pushed && !isFullAdmin(req.user && req.user.role)) {
                return res.status(403).json({ success: false, message: 'Only an admin can delete an invoice that is already in Zoho.' });
            }

            // Reflect in Zoho: VOID the pushed invoice (keeps the record/number).
            if (pushed) {
                try { await zohoAPI.voidInvoice(inv.zoho_invoice_id); }
                catch (zErr) {
                    // Already gone from Zoho (deleted there directly — error 1002
                    // "Invoice does not exist") → remove locally instead of blocking.
                    if (!/does not exist|1002/i.test(zErr.message || '')) {
                        return res.status(400).json({ success: false, code: 'ZOHO_VOID_FAILED', message: 'Zoho would not void this invoice: ' + (zErr.message || zErr) });
                    }
                }
            }

            // Soft-delete locally FIRST (never hard-delete a money row) + items,
            // and free any estimate that converted into this invoice — so the
            // user-visible removal lands before the (separate-txn) points
            // reversal. If reversal then fails it's logged + recoverable, and a
            // re-run 404s (already deleted) rather than re-voiding in Zoho.
            await pool.query('UPDATE billing_invoices SET deleted_at = NOW() WHERE id = ?', [id]);
            await pool.query('UPDATE billing_invoice_items SET deleted_at = NOW() WHERE invoice_id = ? AND deleted_at IS NULL', [id]);
            await pool.query("UPDATE billing_estimates SET converted_to_invoice_id = NULL, status = 'sent' WHERE converted_to_invoice_id = ?", [id]);

            // Reverse painter points (awarded on push) for a voided painter invoice.
            let pointsReversal = null;
            if (pushed && inv.customer_type === 'painter' && inv.painter_id && pointsEngine && pointsEngine.reverseInvoicePoints) {
                try { pointsReversal = await pointsEngine.reverseInvoicePoints(inv.zoho_invoice_id, req.user.id); }
                catch (pErr) { console.error('[invoice.delete] points reversal failed:', pErr.message); }
            }

            await auditLog.record(req, {
                action: 'billing.invoice.delete',
                entity_type: 'billing_invoice', entity_id: id,
                before: inv, after: { deleted_at: 'now', voided_in_zoho: pushed }
            });

            res.json({ success: true, voided: pushed, message: pushed ? 'Invoice voided in Zoho and removed' : 'Invoice deleted', points_reversal: pointsReversal });
        } catch (error) {
            console.error('Delete invoice error:', error);
            res.status(500).json({ success: false, message: 'Failed to delete invoice' });
        }
    }
);

// Edit invoice (unpaid + not pushed only)
router.put('/invoices/:id',
    requirePermission('billing', 'invoice'),
    validateParams(idParamSchema),
    validate(createInvoiceSchema),
    async (req, res) => {
        const connection = await pool.getConnection();
        try {
            const { id } = req.params;
            const data = req.body;

            // No early connection.release() here — the finally block releases.
            // Releasing twice pushes the same connection into the pool's free
            // list twice, letting two requests share one connection (pool
            // poisoning / interleaved transactions).
            const [existing] = await pool.query(
                'SELECT id, payment_status, zoho_invoice_id FROM billing_invoices WHERE id = ? AND deleted_at IS NULL', [id]
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

            const { subtotal, grandTotal } = calculateTotals(data.items, data.discount_amount);

            // Preserve any existing payments when recalculating balance_due
            const [paySum] = await pool.query(
                'SELECT COALESCE(SUM(amount), 0) AS total_paid FROM billing_payments WHERE invoice_id = ? AND deleted_at IS NULL',
                [id]
            );
            const totalPaid = Number(paySum[0].total_paid);
            const balanceDue = Math.max(0, grandTotal - totalPaid);

            // Capture pre-edit items for audit trail (U18)
            const [beforeInvItems] = await pool.query(
                'SELECT * FROM billing_invoice_items WHERE invoice_id = ? AND deleted_at IS NULL ORDER BY id',
                [id]
            );

            await connection.beginTransaction();

            await connection.execute(
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
                    balanceDue,
                    data.notes,
                    id
                ]
            );

            // Soft-delete existing items (history preserved for U18 audit trail)
            await connection.execute(
                'UPDATE billing_invoice_items SET deleted_at = NOW() WHERE invoice_id = ? AND deleted_at IS NULL',
                [id]
            );
            for (const item of data.items) {
                const lineTotal = item.quantity * item.unit_price;
                await connection.execute(
                    `INSERT INTO billing_invoice_items
                     (invoice_id, zoho_item_id, item_name, pack_size, quantity, unit_price, line_total, description)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [id, item.zoho_item_id, item.item_name, item.pack_size, item.quantity, item.unit_price, lineTotal, item.description || null]
                );
            }

            await connection.commit();

            auditLog.record(req, {
                action: 'billing.invoice.items.replace',
                entity_type: 'billing_invoice',
                entity_id: id,
                before: { items: beforeInvItems },
                after:  { items: data.items, grand_total: grandTotal }
            });

            res.json({ success: true, message: 'Invoice updated', grand_total: grandTotal });
        } catch (error) {
            await connection.rollback();
            console.error('Edit invoice error:', error);
            res.status(500).json({ success: false, message: 'Failed to update invoice' });
        } finally {
            connection.release();
        }
    }
);

// ═══════════════════════════════════════════
// PAYMENTS
// ═══════════════════════════════════════════

// Record payment against invoice.
// Local-first: INSERT + re-SUM + header update run inside ONE transaction with
// SELECT ... FOR UPDATE on the invoice row (closes the read-then-check overpay
// TOCTOU hole). Only after the local money record is committed do we attempt a
// best-effort Zoho payment sync — a Zoho failure NEVER affects the local record
// or the HTTP status; the response's point-in-time `zoho_sync` field reflects it.
router.post('/invoices/:id/payment',
    idempotent('billing.payment.create'),
    requirePermission('billing', 'payment'),
    validateParams(idParamSchema),
    validate(recordPaymentSchema),
    async (req, res) => {
        const { id } = req.params;
        const data = req.body;
        // yyyy-mm-dd; default to today in IST (server clock IST, DB session UTC).
        const paymentDate = data.payment_date || istDateString(new Date());

        let inserted, totalPaid, balanceDue, paymentStatus, invoicePushed;
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const [invoices] = await connection.query(
                `SELECT id, balance_due, payment_status, grand_total, zoho_status, zoho_invoice_id
                 FROM billing_invoices WHERE id = ? AND deleted_at IS NULL FOR UPDATE`,
                [id]
            );
            if (!invoices.length) {
                await connection.rollback();
                return res.status(404).json({ success: false, message: 'Invoice not found' });
            }
            const invoice = invoices[0];

            if (paymentExceedsBalance(data.amount, invoice.balance_due)) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: `Payment amount exceeds balance due (${Number(invoice.balance_due).toFixed(2)})`
                });
            }

            const [ins] = await connection.query(
                `INSERT INTO billing_payments
                 (invoice_id, amount, payment_method, payment_reference, payment_date, notes, received_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [id, data.amount, data.payment_method, data.payment_reference, paymentDate, data.notes, req.user.id]
            );

            // Recalculate from all live payments (shared with the reversal path) to
            // avoid floating point drift. FOR UPDATE above still holds the row.
            const recalced = await recalcInvoicePaymentTotals(connection, id);
            totalPaid = recalced.totalPaid;
            balanceDue = recalced.balanceDue;
            paymentStatus = recalced.paymentStatus;

            await connection.commit();

            invoicePushed = invoice.zoho_status === 'pushed' && !!invoice.zoho_invoice_id;
            inserted = {
                id: ins.insertId, invoice_id: Number(id), amount: data.amount,
                payment_method: data.payment_method, payment_reference: data.payment_reference,
                payment_date: paymentDate
            };
        } catch (error) {
            try { await connection.rollback(); } catch { /* already rolled back */ }
            console.error('Record payment error:', error);
            return res.status(500).json({ success: false, message: 'Failed to record payment' });
        } finally {
            connection.release();
        }

        // Audit the committed local money record (best-effort, never throws).
        await auditLog.record(req, {
            action: 'billing.payment.create',
            entity_type: 'billing_payment',
            entity_id: inserted.id,
            before: null,
            after: { ...inserted, amount_paid: totalPaid, balance_due: balanceDue, payment_status: paymentStatus }
        });

        // Best-effort Zoho sync (only for pushed invoices). Never fails the record.
        let zohoSync = { status: 'not_applicable', detail: null };
        if (invoicePushed) {
            try {
                const summary = await billingZohoService.syncInvoicePaymentsToZoho(id);
                zohoSync = deriveZohoSync(summary);
                await auditLog.record(req, {
                    action: 'billing.payment.zohoSync',
                    entity_type: 'billing_invoice', entity_id: id,
                    before: null, after: summary
                });
            } catch (err) {
                if (err.code === 'INVOICE_NOT_PUSHED') {
                    zohoSync = { status: 'not_applicable', detail: null };
                } else {
                    console.error('[billing.payment] inline Zoho sync error:', err.message);
                    zohoSync = { status: 'failed', detail: err.message };
                }
            }
        }

        res.json({
            success: true,
            message: 'Payment recorded',
            amount_paid: totalPaid,
            balance_due: balanceDue,
            payment_status: paymentStatus,
            zoho_sync: zohoSync
        });
    }
);

// Explicitly (re-)sync a pushed invoice's payments to Zoho. Idempotent by header;
// returns the forwardInvoicePayments summary. 400 INVOICE_NOT_PUSHED otherwise.
router.post('/invoices/:id/sync-payments',
    idempotent('billing.payment.zohoSync'),
    requirePermission('billing', 'payment'),
    validateParams(idParamSchema),
    async (req, res) => {
        try {
            const { id } = req.params;
            const summary = await billingZohoService.syncInvoicePaymentsToZoho(id);
            await auditLog.record(req, {
                action: 'billing.payment.zohoSync',
                entity_type: 'billing_invoice', entity_id: id,
                before: null, after: summary
            });
            res.json({ success: true, zoho_sync: deriveZohoSync(summary), summary });
        } catch (error) {
            if (error.code === 'INVOICE_NOT_PUSHED') {
                return res.status(400).json({ success: false, code: 'INVOICE_NOT_PUSHED', message: 'Invoice is not pushed to Zoho yet' });
            }
            console.error('Sync payments error:', error);
            res.status(500).json({ success: false, message: error.message || 'Failed to sync payments' });
        }
    }
);

// List recent payments
router.get('/payments',
    requirePermission('billing', 'payment'),
    validateQuery(listQuerySchema),
    async (req, res) => {
        try {
            const { search } = req.query;
            const page = Number(req.query.page) || 1;
            const limit = Number(req.query.limit) || 20;
            const branchId = getBranchFilter(req);
            const offset = (page - 1) * limit;

            let where = 'WHERE bp.deleted_at IS NULL';
            const params = [];

            if (branchId) { where += ' AND bi.branch_id = ?'; params.push(branchId); }
            if (search) {
                where += ' AND (bi.customer_name LIKE ? OR bi.invoice_number LIKE ?)';
                const term = `%${search}%`;
                params.push(term, term);
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

// Reverse (soft-delete) a payment — admin only (Zoho-first delete). Closes the
// "reverse it first" dead end: a fully-reversed invoice drops back to 'unpaid'
// and becomes deletable/voidable again. requirePermission gates the module; the
// in-handler isFullAdmin gate makes it admin-only (a payment reversal is a
// GST-affecting action once the payment lives in Zoho too).
router.delete('/payments/:id',
    requirePermission('billing', 'payment'),
    validateParams(idParamSchema),
    async (req, res) => {
        const { id } = req.params;
        if (!isFullAdmin(req.user && req.user.role)) {
            return res.status(403).json({ success: false, message: 'Only an admin can reverse a payment.' });
        }
        try {
            const { payment, zohoDeleted, legacyManual, recalced } = await reverseInvoicePayment(id);

            await auditLog.record(req, {
                action: 'billing.payment.delete',
                entity_type: 'billing_payment', entity_id: id,
                before: payment,
                after: { deleted_at: 'now', zoho_deleted: zohoDeleted, invoice_totals: recalced }
            });

            let message = 'Payment reversed';
            if (legacyManual) message += ' — adjust the corresponding payment in Zoho Books manually';
            res.json({ success: true, message, zoho_deleted: zohoDeleted });
        } catch (error) {
            if (error.code === 'NOT_FOUND') {
                return res.status(404).json({ success: false, message: 'Payment not found' });
            }
            if (error.code === 'SYNC_IN_FLIGHT') {
                return res.status(409).json({ success: false, code: 'SYNC_IN_FLIGHT', message: error.message });
            }
            if (error.code === 'ZOHO_DELETE_FAILED') {
                return res.status(502).json({ success: false, code: 'ZOHO_DELETE_FAILED', message: 'Zoho would not delete this payment: ' + error.message });
            }
            console.error('Reverse payment error:', error);
            res.status(500).json({ success: false, message: 'Failed to reverse payment' });
        }
    }
);

// ═══════════════════════════════════════════
// ZOHO PUSH
// ═══════════════════════════════════════════

// Zoho salespersons for the invoice-push picker (owner 2026-06-12: salesperson
// is mandatory on push). Lists the local master; sync pulls fresh from Zoho.
router.get('/salespersons',
    requirePermission('billing', 'invoice'),
    async (req, res) => {
        try {
            const [rows] = await pool.query(
                `SELECT zoho_salesperson_id, salesperson_name, salesperson_email
                 FROM zoho_salespersons WHERE is_active = 1 ORDER BY salesperson_name`
            );
            res.json({ success: true, salespersons: rows });
        } catch (error) {
            console.error('List salespersons error:', error);
            res.status(500).json({ success: false, message: 'Failed to load salespersons' });
        }
    }
);

router.post('/salespersons/sync',
    requirePermission('billing', 'zoho_push'),
    async (req, res) => {
        try {
            const result = await zohoAPI.syncSalespersons();
            res.json({ success: true, synced: result.synced, message: `${result.synced} salesperson(s) synced from Zoho` });
        } catch (error) {
            console.error('Sync salespersons error:', error);
            res.status(500).json({ success: false, message: error.message || 'Failed to sync salespersons' });
        }
    }
);

// Zoho locations/branches for the invoice-push location picker.
router.get('/zoho-locations',
    requirePermission('billing', 'invoice'),
    async (req, res) => {
        try {
            const [rows] = await pool.query(
                `SELECT zoho_location_id, zoho_location_name, local_branch_id
                 FROM zoho_locations_map WHERE is_active = 1 ORDER BY zoho_location_name`
            );
            res.json({ success: true, locations: rows });
        } catch (error) {
            console.error('Billing zoho-locations error:', error);
            res.status(500).json({ success: false, message: 'Failed to load locations' });
        }
    }
);

// B1a: the caller's own push defaults, resolved EXACTLY like the push would —
// salesperson: users.zoho_salesperson_id → ai_config
// 'billing_default_salesperson_id'; location: req.user.branch_id →
// branches.zoho_location_id → active zoho_locations_map row. Names come from
// the local masters. The quick-sale UI shows these before saving.
router.get('/my-defaults',
    requirePermission('billing', 'invoice'),
    async (req, res) => {
        try {
            let salesperson = null;
            const [ur] = await pool.query('SELECT zoho_salesperson_id FROM users WHERE id = ? LIMIT 1', [req.user.id]);
            let spId = (ur.length && ur[0].zoho_salesperson_id) || null;
            if (!spId) {
                spId = (await billingZohoService.readConfigValue('billing_default_salesperson_id')) || null;
            }
            if (spId) {
                let name = null;
                const [sp] = await pool.query('SELECT salesperson_name FROM zoho_salespersons WHERE zoho_salesperson_id = ? LIMIT 1', [spId]);
                if (sp.length) name = sp[0].salesperson_name;
                salesperson = { id: spId, name };
            }

            let location = null;
            if (req.user.branch_id) {
                const [br] = await pool.query('SELECT zoho_location_id FROM branches WHERE id = ? LIMIT 1', [req.user.branch_id]);
                let locId = (br.length && br[0].zoho_location_id) || null;
                if (!locId) {
                    const [lm] = await pool.query(
                        'SELECT zoho_location_id FROM zoho_locations_map WHERE local_branch_id = ? AND is_active = 1 LIMIT 1',
                        [req.user.branch_id]
                    );
                    locId = (lm.length && lm[0].zoho_location_id) || null;
                }
                if (locId) {
                    let name = null;
                    const [loc] = await pool.query('SELECT zoho_location_name FROM zoho_locations_map WHERE zoho_location_id = ? LIMIT 1', [locId]);
                    if (loc.length) name = loc[0].zoho_location_name;
                    location = { id: locId, name };
                }
            }

            res.json({ success: true, salesperson, location });
        } catch (error) {
            console.error('Billing my-defaults error:', error);
            res.status(500).json({ success: false, message: 'Failed to load billing defaults' });
        }
    }
);

// B1.1: quick-sale credit pre-check (owner feedback #5). Runs the SAME
// evaluation the quick-sale create gate and the Zoho push gate apply, so the
// UI can show available credit (or a red note + disabled SAVE) BEFORE the
// cashier hits save. Read-only — never creates a Zoho contact.
router.get('/credit-check',
    requirePermission('billing', 'invoice'),
    validateQuery(creditCheckQuerySchema),
    async (req, res) => {
        try {
            const { customer_type } = req.query;
            const customerId = req.query.customer_id ? Number(req.query.customer_id) : null;
            const painterId = req.query.painter_id ? Number(req.query.painter_id) : null;
            const amount = Number(req.query.amount) || 0;
            const result = await evaluateCreditForSale(customer_type, customerId, painterId, amount);
            res.json({
                success: true,
                eligible: result.eligible,
                limit: result.limit,
                available: result.available,
                reason: result.reason
            });
        } catch (error) {
            console.error('Billing credit-check error:', error);
            res.status(500).json({ success: false, message: 'Failed to check credit' });
        }
    }
);

router.post('/invoices/:id/push-zoho',
    requirePermission('billing', 'zoho_push'),
    idempotent('billing.invoice.zohoPush'),
    validateParams(idParamSchema),
    async (req, res) => {
        try {
            const { id } = req.params;
            const admin = isFullAdmin(req.user && req.user.role);
            const options = {
                salespersonId: (req.body && req.body.salesperson_id) || null,
                locationId: (req.body && req.body.zoho_location_id) || null,
                isAdmin: admin,
                // draft_only (admin-only): create the Zoho invoice as a draft,
                // skipping finalize + payment forwarding — used for the D1
                // discount verification before flipping the push flag on.
                draftOnly: admin && (req.body && req.body.draft_only === true),
            };
            const result = await billingZohoService.pushInvoiceToZoho(id, req.user.id, options);
            const state = result.zohoState;
            const stateMsg = state === 'approved' ? 'created & approved in Zoho'
                : state === 'submitted' ? 'created & submitted for admin approval in Zoho'
                : state === 'sent' ? 'created in Zoho'
                : state === 'draft' ? 'created as a DRAFT in Zoho (not finalized)'
                : 'pushed to Zoho';
            // Push audit (B1a) — best-effort, never fails the response.
            await auditLog.record(req, {
                action: 'billing.invoice.zohoPush',
                entity_type: 'billing_invoice', entity_id: id,
                before: null,
                after: {
                    zoho_invoice_id: result.zohoInvoiceId, zoho_invoice_number: result.zohoInvoiceNumber,
                    zoho_state: state || null, salesperson_id: result.salespersonId || null,
                    location_id: result.locationId || null, draft_only: !!options.draftOnly
                }
            });
            res.json({
                success: true,
                message: `Invoice ${stateMsg}`,
                zoho_invoice_id: result.zohoInvoiceId,
                zoho_invoice_number: result.zohoInvoiceNumber,
                zoho_state: state || null,
                salesperson_name: result.salespersonName || null,
                location_name: result.locationName || null,
                points_result: result.pointsResult || null,
                payment_sync: result.paymentSync ? deriveZohoSync(result.paymentSync) : null
            });
        } catch (error) {
            console.error('Push to Zoho error:', error);
            // B1a: stamp the failure so the 15-min retry cron can pick it up
            // (the retry SELECT only matches zoho_status='pending', so stamping
            // an already-pushed invoice's error is inert). Best-effort.
            try {
                await pool.query(
                    'UPDATE billing_invoices SET zoho_push_error = ?, zoho_push_attempted_at = NOW() WHERE id = ?',
                    [String(error.message || error).slice(0, 255), req.params.id]
                );
            } catch { /* stamp is best-effort */ }
            // Surface the actionable gates (missing salesperson / push eligibility)
            // as 400s with a code so the UI can react instead of a generic 500.
            if (error.code === 'SALESPERSON_REQUIRED' || error.code === 'PUSH_GATE') {
                await auditLog.record(req, {
                    action: 'billing.invoice.zohoPush.refused',
                    entity_type: 'billing_invoice', entity_id: req.params.id,
                    before: null,
                    after: { code: error.code, error: String(error.message || '').slice(0, 255) }
                });
                return res.status(400).json({ success: false, code: error.code, message: error.message });
            }
            res.status(500).json({ success: false, message: error.message || 'Failed to push to Zoho' });
        }
    }
);

// Approval sync-back: pull a pushed invoice's current Zoho lifecycle status (an
// admin may have approved a staff-submitted invoice in Zoho's own UI) and reflect
// it locally on billing_invoices.zoho_approval_state.
router.post('/invoices/:id/sync-zoho-status',
    requirePermission('billing', 'invoice'),
    validateParams(idParamSchema),
    async (req, res) => {
        try {
            const state = await billingZohoService.syncInvoiceApprovalState(req.params.id);
            if (!state) {
                return res.status(400).json({ success: false, message: 'Invoice is not pushed to Zoho yet' });
            }
            res.json({ success: true, zoho_approval_state: state, message: `Zoho status: ${state}` });
        } catch (error) {
            console.error('Sync invoice Zoho status error:', error);
            res.status(500).json({ success: false, message: error.message || 'Failed to sync Zoho status' });
        }
    }
);

// ═══════════════════════════════════════════

// calculateTotals + schemas + paymentExceedsBalance exported for unit testing
// only (tests/unit/billing.test.js) — routes still use them directly.
module.exports = {
    router, setPool, setPointsEngine,
    calculateTotals, paymentExceedsBalance, computePaymentSettlement, deriveZohoSync,
    recalcInvoicePaymentTotals, countLiveInvoicePayments, reverseInvoicePayment,
    evaluateCreditForSale,
    createEstimateSchema, recordPaymentSchema, listQuerySchema, quickSaleSchema
};
