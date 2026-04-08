/**
 * Vendor Routes
 * CRUD vendors, bills (with AI scan/verify), purchase orders, payments, Zoho push.
 *
 * Exports: { router, setPool }
 */

const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { requirePermission } = require('../middleware/permissionMiddleware');
const { validate, validateQuery, validateParams } = require('../middleware/validate');
const { uploadVendorBill } = require('../config/uploads');
const vendorBillAI = require('../services/vendor-bill-ai-service');
const zohoAPI = require('../services/zoho-api');

let pool;
function setPool(p) { pool = p; vendorBillAI.setPool(p); }

// ═══════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════

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
        const last = rows[0][column];
        const parts = last.split('-');
        const lastSeq = parseInt(parts[parts.length - 1], 10);
        if (!isNaN(lastSeq)) seq = lastSeq + 1;
    }

    return `${prefix}-${dateStr}-${String(seq).padStart(3, '0')}`;
}

// ═══════════════════════════════════════════
// ZOD SCHEMAS
// ═══════════════════════════════════════════

const idParamSchema = z.object({
    id: z.coerce.number().positive()
});

const listQuerySchema = z.object({
    page: z.coerce.number().default(1),
    limit: z.coerce.number().default(20).refine(v => v <= 100, { message: 'Limit max 100' }),
    search: z.string().optional(),
    status: z.string().optional()
});

const createVendorSchema = z.object({
    vendor_name: z.string().min(1),
    contact_person: z.string().optional().default(''),
    phone: z.string().optional().default(''),
    email: z.string().optional().default(''),
    address: z.string().optional().default(''),
    gst_number: z.string().optional().default(''),
    payment_terms: z.number().optional().default(30),
    notes: z.string().optional().default('')
});

const billItemSchema = z.object({
    zoho_item_id: z.string().optional().nullable().default(null),
    item_name: z.string().min(1),
    quantity: z.number().positive(),
    unit_price: z.number().min(0),
    ai_matched: z.boolean().optional().default(false),
    ai_confidence: z.number().min(0).max(1).optional().default(0)
});

const createBillSchema = z.object({
    vendor_id: z.number().positive(),
    bill_number: z.string().optional().default(''),
    bill_date: z.string().optional().nullable(),
    due_date: z.string().optional().nullable(),
    items: z.array(billItemSchema).min(1),
    tax_amount: z.number().optional().default(0),
    notes: z.string().optional().default(''),
    bill_image: z.string().optional().nullable(),
    ai_extracted_data: z.any().optional().nullable()
});

const poItemSchema = z.object({
    zoho_item_id: z.string().optional().default(''),
    item_name: z.string().min(1),
    quantity: z.number().positive(),
    unit_price: z.number().min(0)
});

const createPOSchema = z.object({
    vendor_id: z.number().positive(),
    items: z.array(poItemSchema).min(1),
    tax_amount: z.number().optional().default(0),
    expected_date: z.string().optional().nullable(),
    notes: z.string().optional().default('')
});

const recordPaymentSchema = z.object({
    vendor_id: z.number().positive(),
    bill_id: z.number().optional().nullable(),
    amount: z.number().positive(),
    payment_method: z.enum(['bank_transfer', 'cheque', 'upi', 'cash']),
    payment_reference: z.string().optional().default(''),
    payment_date: z.string().min(1),
    notes: z.string().optional().default('')
});

// ═══════════════════════════════════════════
// PERMISSIONS
// ═══════════════════════════════════════════

const viewPerm = requirePermission('vendors', 'view');
const managePerm = requirePermission('vendors', 'manage');
const poPerm = requirePermission('vendors', 'purchase_orders');

// ═══════════════════════════════════════════
// VENDOR CRUD
// ═══════════════════════════════════════════

// List vendors
router.get('/',
    viewPerm,
    validateQuery(listQuerySchema),
    async (req, res) => {
        try {
            const { search, status } = req.query;
            const page = Number(req.query.page) || 1;
            const limit = Number(req.query.limit) || 20;
            const offset = (page - 1) * limit;

            let where = 'WHERE 1=1';
            const params = [];

            if (search) {
                where += ' AND (v.vendor_name LIKE ? OR v.contact_person LIKE ? OR v.phone LIKE ?)';
                const term = `%${search}%`;
                params.push(term, term, term);
            }
            if (status) {
                where += ' AND v.status = ?';
                params.push(status);
            }

            const [countRows] = await pool.query(
                `SELECT COUNT(*) AS total FROM vendors v ${where}`,
                params
            );
            const total = countRows[0].total;

            const [rows] = await pool.query(
                `SELECT v.*,
                    (SELECT COUNT(*) FROM vendor_bills WHERE vendor_id = v.id) AS bill_count,
                    (SELECT COALESCE(SUM(balance_due), 0) FROM vendor_bills WHERE vendor_id = v.id AND payment_status != 'paid') AS outstanding
                 FROM vendors v
                 ${where}
                 ORDER BY v.created_at DESC
                 LIMIT ? OFFSET ?`,
                [...params, limit, offset]
            );

            res.json({
                success: true,
                vendors: rows,
                pagination: { page, limit, total, pages: Math.ceil(total / limit) }
            });
        } catch (error) {
            console.error('List vendors error:', error);
            res.status(500).json({ success: false, message: 'Failed to list vendors' });
        }
    }
);

// Sync vendors from Zoho
router.post('/sync-zoho',
    managePerm,
    async (req, res) => {
        try {
            let page = 1;
            let hasMore = true;
            let synced = 0;

            while (hasMore) {
                const response = await zohoAPI.getContacts({ page, per_page: 200, contact_type: 'vendor' });
                const contacts = response.contacts || [];

                for (const c of contacts) {
                    await pool.query(
                        `INSERT INTO vendors (vendor_name, contact_person, phone, email, address, gst_number, zoho_contact_id)
                         VALUES (?, ?, ?, ?, ?, ?, ?)
                         ON DUPLICATE KEY UPDATE
                            vendor_name = VALUES(vendor_name),
                            contact_person = VALUES(contact_person),
                            phone = VALUES(phone),
                            email = VALUES(email),
                            address = VALUES(address),
                            gst_number = VALUES(gst_number)`,
                        [
                            c.contact_name || '',
                            c.contact_persons?.[0]?.first_name || '',
                            c.phone || '',
                            c.email || '',
                            (c.billing_address?.address || '') + ' ' + (c.billing_address?.city || ''),
                            c.gst_no || '',
                            c.contact_id
                        ]
                    );
                    synced++;
                }

                hasMore = contacts.length === 200;
                page++;
            }

            res.json({ success: true, message: `Synced ${synced} vendors from Zoho` });
        } catch (error) {
            console.error('Sync vendors from Zoho error:', error);
            res.status(500).json({ success: false, message: 'Failed to sync vendors from Zoho' });
        }
    }
);

// Get vendor detail
// NOTE: GET /:id moved after all named routes (purchase-orders, payments) to avoid route conflicts

// Create vendor
router.post('/',
    managePerm,
    validate(createVendorSchema),
    async (req, res) => {
        try {
            const { vendor_name, contact_person, phone, email, address, gst_number, payment_terms, notes } = req.body;

            const [result] = await pool.query(
                `INSERT INTO vendors (vendor_name, contact_person, phone, email, address, gst_number, payment_terms, notes, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [vendor_name, contact_person, phone, email, address, gst_number, payment_terms, notes, req.user.id]
            );

            res.json({ success: true, vendor_id: result.insertId, message: 'Vendor created' });
        } catch (error) {
            console.error('Create vendor error:', error);
            res.status(500).json({ success: false, message: 'Failed to create vendor' });
        }
    }
);

// Edit vendor
router.put('/:id',
    managePerm,
    validateParams(idParamSchema),
    validate(createVendorSchema),
    async (req, res) => {
        try {
            const { id } = req.params;
            const { vendor_name, contact_person, phone, email, address, gst_number, payment_terms, notes } = req.body;

            const [result] = await pool.query(
                `UPDATE vendors SET vendor_name = ?, contact_person = ?, phone = ?, email = ?, address = ?,
                    gst_number = ?, payment_terms = ?, notes = ?
                 WHERE id = ?`,
                [vendor_name, contact_person, phone, email, address, gst_number, payment_terms, notes, id]
            );

            if (result.affectedRows === 0) {
                return res.status(404).json({ success: false, message: 'Vendor not found' });
            }

            res.json({ success: true, message: 'Vendor updated' });
        } catch (error) {
            console.error('Edit vendor error:', error);
            res.status(500).json({ success: false, message: 'Failed to update vendor' });
        }
    }
);

// ═══════════════════════════════════════════
// BILLS (named routes BEFORE :id)
// ═══════════════════════════════════════════

// Scan bill image (AI)
router.post('/bills/scan',
    managePerm,
    uploadVendorBill.single('bill_image'),
    async (req, res) => {
        try {
            if (!req.file) {
                return res.status(400).json({ success: false, message: 'No bill image uploaded' });
            }

            const vendorId = req.body.vendor_id ? Number(req.body.vendor_id) : null;
            const scan_result = await vendorBillAI.scanBillImage(req.file.path);
            const matched_items = await vendorBillAI.matchProductsToZoho(scan_result.items || [], vendorId);

            res.json({
                success: true,
                scan_result: { ...scan_result, items: matched_items },
                image_path: req.file.path
            });
        } catch (error) {
            console.error('Bill scan error:', error);
            res.status(500).json({ success: false, message: 'Failed to scan bill image' });
        }
    }
);

// List bills
router.get('/bills',
    viewPerm,
    validateQuery(listQuerySchema.extend({
        vendor_id: z.coerce.number().optional(),
        payment_status: z.string().optional()
    })),
    async (req, res) => {
        try {
            const { search, vendor_id, payment_status } = req.query;
            const page = Number(req.query.page) || 1;
            const limit = Number(req.query.limit) || 20;
            const offset = (page - 1) * limit;

            let where = 'WHERE 1=1';
            const params = [];

            if (vendor_id) {
                where += ' AND vb.vendor_id = ?';
                params.push(vendor_id);
            }
            if (payment_status) {
                where += ' AND vb.payment_status = ?';
                params.push(payment_status);
            }
            if (search) {
                where += ' AND (vb.bill_number LIKE ? OR v.vendor_name LIKE ?)';
                const term = `%${search}%`;
                params.push(term, term);
            }

            const [countRows] = await pool.query(
                `SELECT COUNT(*) AS total FROM vendor_bills vb JOIN vendors v ON vb.vendor_id = v.id ${where}`,
                params
            );
            const total = countRows[0].total;

            const [rows] = await pool.query(
                `SELECT vb.*, v.vendor_name
                 FROM vendor_bills vb
                 JOIN vendors v ON vb.vendor_id = v.id
                 ${where}
                 ORDER BY vb.created_at DESC
                 LIMIT ? OFFSET ?`,
                [...params, limit, offset]
            );

            res.json({
                success: true,
                bills: rows,
                pagination: { page, limit, total, pages: Math.ceil(total / limit) }
            });
        } catch (error) {
            console.error('List bills error:', error);
            res.status(500).json({ success: false, message: 'Failed to list bills' });
        }
    }
);

// Create bill
router.post('/bills',
    managePerm,
    validate(createBillSchema),
    async (req, res) => {
        try {
            const { vendor_id, bill_number, bill_date, due_date, items, tax_amount, notes, bill_image, ai_extracted_data } = req.body;

            // Generate bill number if not provided
            const finalBillNumber = bill_number || await generateNumber('BILL', 'vendor_bills', 'bill_number');

            // Calculate totals
            const subtotal = items.reduce((sum, it) => sum + (it.quantity * it.unit_price), 0);
            const grand_total = subtotal + (tax_amount || 0);

            const [result] = await pool.query(
                `INSERT INTO vendor_bills (vendor_id, bill_number, bill_date, due_date, subtotal, tax_amount, grand_total,
                    balance_due, notes, bill_image, ai_extracted_data, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [vendor_id, finalBillNumber, bill_date || null, due_date || null, subtotal, tax_amount,
                 grand_total, grand_total, notes, bill_image || null,
                 ai_extracted_data ? JSON.stringify(ai_extracted_data) : null, req.user.id]
            );

            const billId = result.insertId;

            // Insert items
            for (const item of items) {
                const amount = item.quantity * item.unit_price;
                await pool.query(
                    `INSERT INTO vendor_bill_items (bill_id, zoho_item_id, item_name, quantity, unit_price, amount, ai_matched, ai_confidence)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [billId, item.zoho_item_id || null, item.item_name, item.quantity, item.unit_price, amount, item.ai_matched, item.ai_confidence]
                );
            }

            res.json({ success: true, bill_id: billId, bill_number: finalBillNumber, message: 'Bill created' });
        } catch (error) {
            console.error('Create bill error:', error);
            res.status(500).json({ success: false, message: 'Failed to create bill' });
        }
    }
);

// Get bill detail
router.get('/bills/:id',
    viewPerm,
    validateParams(idParamSchema),
    async (req, res) => {
        try {
            const { id } = req.params;

            const [bills] = await pool.query(
                `SELECT vb.*, v.vendor_name
                 FROM vendor_bills vb
                 JOIN vendors v ON vb.vendor_id = v.id
                 WHERE vb.id = ?`,
                [id]
            );
            if (!bills.length) {
                return res.status(404).json({ success: false, message: 'Bill not found' });
            }

            const [items] = await pool.query(
                'SELECT * FROM vendor_bill_items WHERE bill_id = ? ORDER BY id',
                [id]
            );

            const [payments] = await pool.query(
                `SELECT vp.*, u.full_name AS paid_by_name
                 FROM vendor_payments vp
                 LEFT JOIN users u ON vp.paid_by = u.id
                 WHERE vp.bill_id = ?
                 ORDER BY vp.payment_date DESC`,
                [id]
            );

            res.json({ success: true, bill: bills[0], items, payments });
        } catch (error) {
            console.error('Get bill detail error:', error);
            res.status(500).json({ success: false, message: 'Failed to get bill details' });
        }
    }
);

// Replace bill items
router.put('/bills/:id/items',
    managePerm,
    validateParams(idParamSchema),
    validate(z.object({ items: z.array(billItemSchema).min(1), tax_amount: z.number().optional() })),
    async (req, res) => {
        try {
            const { id } = req.params;
            const { items, tax_amount } = req.body;

            const [bills] = await pool.query('SELECT * FROM vendor_bills WHERE id = ?', [id]);
            if (!bills.length) {
                return res.status(404).json({ success: false, message: 'Bill not found' });
            }

            // Delete old items
            await pool.query('DELETE FROM vendor_bill_items WHERE bill_id = ?', [id]);

            // Insert new items
            const subtotal = items.reduce((sum, it) => sum + (it.quantity * it.unit_price), 0);
            for (const item of items) {
                const amount = item.quantity * item.unit_price;
                await pool.query(
                    `INSERT INTO vendor_bill_items (bill_id, zoho_item_id, item_name, quantity, unit_price, amount, ai_matched, ai_confidence)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                    [id, item.zoho_item_id || null, item.item_name, item.quantity, item.unit_price, amount, item.ai_matched, item.ai_confidence]
                );
            }

            // Recalculate totals
            const finalTax = tax_amount !== undefined ? tax_amount : bills[0].tax_amount;
            const grand_total = subtotal + finalTax;
            const amount_paid = parseFloat(bills[0].amount_paid) || 0;
            const balance_due = grand_total - amount_paid;

            await pool.query(
                `UPDATE vendor_bills SET subtotal = ?, tax_amount = ?, grand_total = ?, balance_due = ? WHERE id = ?`,
                [subtotal, finalTax, grand_total, balance_due, id]
            );

            res.json({ success: true, message: 'Bill items updated', subtotal, grand_total, balance_due });
        } catch (error) {
            console.error('Replace bill items error:', error);
            res.status(500).json({ success: false, message: 'Failed to update bill items' });
        }
    }
);

// Verify bill (AI)
router.post('/bills/:id/verify',
    managePerm,
    validateParams(idParamSchema),
    async (req, res) => {
        try {
            const { id } = req.params;

            const [bills] = await pool.query('SELECT * FROM vendor_bills WHERE id = ?', [id]);
            if (!bills.length) {
                return res.status(404).json({ success: false, message: 'Bill not found' });
            }

            const bill = bills[0];
            const aiData = bill.ai_extracted_data ? JSON.parse(bill.ai_extracted_data) : null;

            const [staffItems] = await pool.query(
                'SELECT * FROM vendor_bill_items WHERE bill_id = ?',
                [id]
            );

            const result = vendorBillAI.verifyBillItems(staffItems, aiData);

            await pool.query(
                `UPDATE vendor_bills SET ai_verification_status = ?, ai_verification_result = ? WHERE id = ?`,
                [result.status, JSON.stringify(result), id]
            );

            res.json({ success: true, verification: result });
        } catch (error) {
            console.error('Verify bill error:', error);
            res.status(500).json({ success: false, message: 'Failed to verify bill' });
        }
    }
);

// Submit bill (mark as verified)
router.post('/bills/:id/submit',
    managePerm,
    validateParams(idParamSchema),
    async (req, res) => {
        try {
            const { id } = req.params;

            const [bills] = await pool.query('SELECT * FROM vendor_bills WHERE id = ?', [id]);
            if (!bills.length) {
                return res.status(404).json({ success: false, message: 'Bill not found' });
            }

            const status = bills[0].ai_verification_status;
            if (status !== 'verified' && status !== 'corrected') {
                return res.status(400).json({ success: false, message: 'Bill must be verified or corrected before submission' });
            }

            await pool.query(
                `UPDATE vendor_bills SET ai_verification_status = 'verified', status = 'verified' WHERE id = ?`,
                [id]
            );

            res.json({ success: true, message: 'Bill submitted and marked as verified' });
        } catch (error) {
            console.error('Submit bill error:', error);
            res.status(500).json({ success: false, message: 'Failed to submit bill' });
        }
    }
);

// Push bill to Zoho
router.post('/bills/:id/push-zoho',
    poPerm,
    validateParams(idParamSchema),
    async (req, res) => {
        try {
            const { id } = req.params;

            const [bills] = await pool.query(
                `SELECT vb.*, v.vendor_name, v.zoho_contact_id, v.gst_number
                 FROM vendor_bills vb
                 JOIN vendors v ON vb.vendor_id = v.id
                 WHERE vb.id = ?`,
                [id]
            );
            if (!bills.length) {
                return res.status(404).json({ success: false, message: 'Bill not found' });
            }

            const bill = bills[0];

            // Resolve Zoho contact — create if missing
            let zohoContactId = bill.zoho_contact_id;
            if (!zohoContactId) {
                const contactResp = await zohoAPI.createContact({
                    contact_name: bill.vendor_name,
                    contact_type: 'vendor',
                    gst_no: bill.gst_number || undefined
                });
                zohoContactId = contactResp.contact?.contact_id;
                if (zohoContactId) {
                    await pool.query('UPDATE vendors SET zoho_contact_id = ? WHERE id = ?', [zohoContactId, bill.vendor_id]);
                }
            }

            if (!zohoContactId) {
                return res.status(400).json({ success: false, message: 'Could not resolve Zoho vendor contact' });
            }

            // Load items
            const [items] = await pool.query('SELECT * FROM vendor_bill_items WHERE bill_id = ?', [id]);

            const lineItems = items.map(it => ({
                item_id: it.zoho_item_id || undefined,
                name: it.item_name,
                quantity: it.quantity,
                rate: it.unit_price
            }));

            const zohoResp = await zohoAPI.createBill({
                vendor_id: zohoContactId,
                bill_number: bill.bill_number,
                date: bill.bill_date,
                due_date: bill.due_date,
                line_items: lineItems
            });

            const zohoBillId = zohoResp.bill?.bill_id;
            await pool.query(
                `UPDATE vendor_bills SET zoho_status = 'pushed', zoho_bill_id = ? WHERE id = ?`,
                [zohoBillId || null, id]
            );

            res.json({ success: true, message: 'Bill pushed to Zoho', zoho_bill_id: zohoBillId });
        } catch (error) {
            console.error('Push bill to Zoho error:', error);
            res.status(500).json({ success: false, message: 'Failed to push bill to Zoho' });
        }
    }
);

// ═══════════════════════════════════════════
// PURCHASE ORDERS
// ═══════════════════════════════════════════

// List purchase orders
router.get('/purchase-orders',
    viewPerm,
    validateQuery(listQuerySchema.extend({
        vendor_id: z.coerce.number().optional()
    })),
    async (req, res) => {
        try {
            const { search, status, vendor_id } = req.query;
            const page = Number(req.query.page) || 1;
            const limit = Number(req.query.limit) || 20;
            const offset = (page - 1) * limit;

            let where = 'WHERE 1=1';
            const params = [];

            if (vendor_id) {
                where += ' AND po.vendor_id = ?';
                params.push(vendor_id);
            }
            if (status) {
                where += ' AND po.status = ?';
                params.push(status);
            }
            if (search) {
                where += ' AND (po.po_number LIKE ? OR v.vendor_name LIKE ?)';
                const term = `%${search}%`;
                params.push(term, term);
            }

            const [countRows] = await pool.query(
                `SELECT COUNT(*) AS total
                 FROM vendor_purchase_orders po
                 JOIN vendors v ON po.vendor_id = v.id
                 ${where}`,
                params
            );
            const total = countRows[0].total;

            const [rows] = await pool.query(
                `SELECT po.*, v.vendor_name, u.full_name AS created_by_name
                 FROM vendor_purchase_orders po
                 JOIN vendors v ON po.vendor_id = v.id
                 LEFT JOIN users u ON po.created_by = u.id
                 ${where}
                 ORDER BY po.created_at DESC
                 LIMIT ? OFFSET ?`,
                [...params, limit, offset]
            );

            res.json({
                success: true,
                purchase_orders: rows,
                pagination: { page, limit, total, pages: Math.ceil(total / limit) }
            });
        } catch (error) {
            console.error('List purchase orders error:', error);
            res.status(500).json({ success: false, message: 'Failed to list purchase orders' });
        }
    }
);

// Create purchase order
router.post('/purchase-orders',
    poPerm,
    validate(createPOSchema),
    async (req, res) => {
        try {
            const { vendor_id, items, tax_amount, expected_date, notes } = req.body;

            const po_number = await generateNumber('PO', 'vendor_purchase_orders', 'po_number');
            const subtotal = items.reduce((sum, it) => sum + (it.quantity * it.unit_price), 0);
            const grand_total = subtotal + (tax_amount || 0);

            const [result] = await pool.query(
                `INSERT INTO vendor_purchase_orders (vendor_id, po_number, subtotal, tax_amount, grand_total, expected_date, notes, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [vendor_id, po_number, subtotal, tax_amount, grand_total, expected_date || null, notes, req.user.id]
            );

            const poId = result.insertId;

            for (const item of items) {
                const amount = item.quantity * item.unit_price;
                await pool.query(
                    `INSERT INTO vendor_po_items (po_id, zoho_item_id, item_name, quantity, unit_price, amount)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [poId, item.zoho_item_id || null, item.item_name, item.quantity, item.unit_price, amount]
                );
            }

            res.json({ success: true, po_id: poId, po_number, message: 'Purchase order created' });
        } catch (error) {
            console.error('Create PO error:', error);
            res.status(500).json({ success: false, message: 'Failed to create purchase order' });
        }
    }
);

// Edit purchase order (draft only)
router.put('/purchase-orders/:id',
    poPerm,
    validateParams(idParamSchema),
    validate(createPOSchema),
    async (req, res) => {
        try {
            const { id } = req.params;

            const [pos] = await pool.query('SELECT * FROM vendor_purchase_orders WHERE id = ?', [id]);
            if (!pos.length) {
                return res.status(404).json({ success: false, message: 'Purchase order not found' });
            }
            if (pos[0].status !== 'draft') {
                return res.status(400).json({ success: false, message: 'Only draft POs can be edited' });
            }

            const { vendor_id, items, tax_amount, expected_date, notes } = req.body;

            // Replace items
            await pool.query('DELETE FROM vendor_po_items WHERE po_id = ?', [id]);

            const subtotal = items.reduce((sum, it) => sum + (it.quantity * it.unit_price), 0);
            const grand_total = subtotal + (tax_amount || 0);

            for (const item of items) {
                const amount = item.quantity * item.unit_price;
                await pool.query(
                    `INSERT INTO vendor_po_items (po_id, zoho_item_id, item_name, quantity, unit_price, amount)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [id, item.zoho_item_id || null, item.item_name, item.quantity, item.unit_price, amount]
                );
            }

            await pool.query(
                `UPDATE vendor_purchase_orders SET vendor_id = ?, subtotal = ?, tax_amount = ?, grand_total = ?,
                    expected_date = ?, notes = ? WHERE id = ?`,
                [vendor_id, subtotal, tax_amount, grand_total, expected_date || null, notes, id]
            );

            res.json({ success: true, message: 'Purchase order updated' });
        } catch (error) {
            console.error('Edit PO error:', error);
            res.status(500).json({ success: false, message: 'Failed to update purchase order' });
        }
    }
);

// Send purchase order (draft → sent)
router.post('/purchase-orders/:id/send',
    poPerm,
    validateParams(idParamSchema),
    async (req, res) => {
        try {
            const { id } = req.params;

            const [pos] = await pool.query('SELECT * FROM vendor_purchase_orders WHERE id = ?', [id]);
            if (!pos.length) {
                return res.status(404).json({ success: false, message: 'Purchase order not found' });
            }
            if (pos[0].status !== 'draft') {
                return res.status(400).json({ success: false, message: 'Only draft POs can be sent' });
            }

            await pool.query(
                `UPDATE vendor_purchase_orders SET status = 'sent' WHERE id = ?`,
                [id]
            );

            res.json({ success: true, message: 'Purchase order marked as sent' });
        } catch (error) {
            console.error('Send PO error:', error);
            res.status(500).json({ success: false, message: 'Failed to send purchase order' });
        }
    }
);

// Push PO to Zoho
router.post('/purchase-orders/:id/push-zoho',
    poPerm,
    validateParams(idParamSchema),
    async (req, res) => {
        try {
            const { id } = req.params;

            const [pos] = await pool.query(
                `SELECT po.*, v.vendor_name, v.zoho_contact_id, v.gst_number
                 FROM vendor_purchase_orders po
                 JOIN vendors v ON po.vendor_id = v.id
                 WHERE po.id = ?`,
                [id]
            );
            if (!pos.length) {
                return res.status(404).json({ success: false, message: 'Purchase order not found' });
            }

            const po = pos[0];

            // Resolve Zoho contact — create if missing
            let zohoContactId = po.zoho_contact_id;
            if (!zohoContactId) {
                const contactResp = await zohoAPI.createContact({
                    contact_name: po.vendor_name,
                    contact_type: 'vendor',
                    gst_no: po.gst_number || undefined
                });
                zohoContactId = contactResp.contact?.contact_id;
                if (zohoContactId) {
                    await pool.query('UPDATE vendors SET zoho_contact_id = ? WHERE id = ?', [zohoContactId, po.vendor_id]);
                }
            }

            if (!zohoContactId) {
                return res.status(400).json({ success: false, message: 'Could not resolve Zoho vendor contact' });
            }

            const [items] = await pool.query('SELECT * FROM vendor_po_items WHERE po_id = ?', [id]);

            const lineItems = items.map(it => ({
                item_id: it.zoho_item_id || undefined,
                name: it.item_name,
                quantity: it.quantity,
                rate: it.unit_price
            }));

            const zohoResp = await zohoAPI.createPurchaseOrder({
                vendor_id: zohoContactId,
                purchaseorder_number: po.po_number,
                delivery_date: po.expected_date,
                line_items: lineItems
            });

            const zohoPOId = zohoResp.purchaseorder?.purchaseorder_id;
            await pool.query(
                `UPDATE vendor_purchase_orders SET zoho_status = 'pushed', zoho_po_id = ? WHERE id = ?`,
                [zohoPOId || null, id]
            );

            res.json({ success: true, message: 'PO pushed to Zoho', zoho_po_id: zohoPOId });
        } catch (error) {
            console.error('Push PO to Zoho error:', error);
            res.status(500).json({ success: false, message: 'Failed to push PO to Zoho' });
        }
    }
);

// ═══════════════════════════════════════════
// PAYMENTS
// ═══════════════════════════════════════════

// List payments
router.get('/payments',
    viewPerm,
    validateQuery(listQuerySchema.extend({
        vendor_id: z.coerce.number().optional()
    })),
    async (req, res) => {
        try {
            const { vendor_id } = req.query;
            const page = Number(req.query.page) || 1;
            const limit = Number(req.query.limit) || 20;
            const offset = (page - 1) * limit;

            let where = 'WHERE 1=1';
            const params = [];

            if (vendor_id) {
                where += ' AND vp.vendor_id = ?';
                params.push(vendor_id);
            }

            const [countRows] = await pool.query(
                `SELECT COUNT(*) AS total FROM vendor_payments vp ${where}`,
                params
            );
            const total = countRows[0].total;

            const [rows] = await pool.query(
                `SELECT vp.*, v.vendor_name, u.full_name AS paid_by_name, vb.bill_number
                 FROM vendor_payments vp
                 JOIN vendors v ON vp.vendor_id = v.id
                 LEFT JOIN users u ON vp.paid_by = u.id
                 LEFT JOIN vendor_bills vb ON vp.bill_id = vb.id
                 ${where}
                 ORDER BY vp.payment_date DESC
                 LIMIT ? OFFSET ?`,
                [...params, limit, offset]
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

// Record payment
router.post('/payments',
    managePerm,
    validate(recordPaymentSchema),
    async (req, res) => {
        try {
            const { vendor_id, bill_id, amount, payment_method, payment_reference, payment_date, notes } = req.body;

            const [result] = await pool.query(
                `INSERT INTO vendor_payments (vendor_id, bill_id, amount, payment_method, payment_reference, payment_date, notes, paid_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [vendor_id, bill_id || null, amount, payment_method, payment_reference, payment_date, notes, req.user.id]
            );

            // If bill_id linked, recalculate bill payment totals
            if (bill_id) {
                const [sumRows] = await pool.query(
                    `SELECT COALESCE(SUM(amount), 0) AS total_paid FROM vendor_payments WHERE bill_id = ?`,
                    [bill_id]
                );
                const totalPaid = parseFloat(sumRows[0].total_paid) || 0;

                const [bills] = await pool.query('SELECT grand_total FROM vendor_bills WHERE id = ?', [bill_id]);
                if (bills.length) {
                    const grandTotal = parseFloat(bills[0].grand_total) || 0;
                    const balanceDue = grandTotal - totalPaid;
                    const paymentStatus = balanceDue <= 0 ? 'paid' : (totalPaid > 0 ? 'partial' : 'unpaid');

                    await pool.query(
                        `UPDATE vendor_bills SET amount_paid = ?, balance_due = ?, payment_status = ? WHERE id = ?`,
                        [totalPaid, Math.max(0, balanceDue), paymentStatus, bill_id]
                    );
                }
            }

            res.json({ success: true, payment_id: result.insertId, message: 'Payment recorded' });
        } catch (error) {
            console.error('Record payment error:', error);
            res.status(500).json({ success: false, message: 'Failed to record payment' });
        }
    }
);

// ═══════════════════════════════════════════
// GET VENDOR BY ID (must be LAST — /:id catches all)
// ═══════════════════════════════════════════
router.get('/:id',
    viewPerm,
    validateParams(idParamSchema),
    async (req, res) => {
        try {
            const { id } = req.params;
            const [vendors] = await pool.query('SELECT * FROM vendors WHERE id = ?', [id]);
            if (!vendors.length) {
                return res.status(404).json({ success: false, message: 'Vendor not found' });
            }
            const [recent_bills] = await pool.query(
                'SELECT * FROM vendor_bills WHERE vendor_id = ? ORDER BY created_at DESC LIMIT 10', [id]
            );
            const [recent_payments] = await pool.query(
                `SELECT vp.*, u.full_name AS paid_by_name
                 FROM vendor_payments vp LEFT JOIN users u ON vp.paid_by = u.id
                 WHERE vp.vendor_id = ? ORDER BY vp.payment_date DESC LIMIT 10`, [id]
            );
            res.json({ success: true, vendor: vendors[0], recent_bills, recent_payments });
        } catch (error) {
            console.error('Get vendor detail error:', error);
            res.status(500).json({ success: false, message: 'Failed to get vendor details' });
        }
    }
);

module.exports = { router, setPool };
