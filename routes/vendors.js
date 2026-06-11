/**
 * Vendor Routes
 * CRUD vendors, bills (with AI scan/verify), purchase orders, payments, Zoho push.
 *
 * Exports: { router, setPool }
 */

const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { requirePermission, isFullAdmin } = require('../middleware/permissionMiddleware');
const { validate, validateQuery, validateParams } = require('../middleware/validate');
const { uploadVendorBill } = require('../config/uploads');
const vendorBillAI = require('../services/vendor-bill-ai-service');
const zohoAPI = require('../services/zoho-api');
const { idempotent, setPool: setIdempotencyPool } = require('../middleware/idempotency');

const { computeZohoRate } = require('../services/dpl-catalog');

let pool;
function setPool(p) { pool = p; vendorBillAI.setPool(p); setIdempotencyPool(p); }

const r2 = n => Math.round((parseFloat(n) || 0) * 100) / 100;
const GST_RATE = 0.18; // paints/putty: CGST 9 + SGST 9

// Zoho rejects a raw mysql2 Date (serialized as a full ISO timestamp) with
// "Invalid value passed for <Date>". It wants a bare YYYY-MM-DD. Format any
// date-ish value to that, using LOCAL date parts (host TZ is IST) so a DATE
// column's midnight doesn't roll back a day. Returns null when unparseable.
function toYmd(value) {
    if (!value) return null;
    const d = new Date(value);
    if (isNaN(d)) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Vendor bill/PO money model (owner decision 2026-06-12):
 *   subtotal = Σ(qty × DPL)   [unit_price is the ex-GST DPL cost per pack]
 *   taxable  = subtotal − total discount  (discount applied to the TOTAL, never item-wise)
 *   tax      = explicit taxAmount when given, else taxable × 18%
 *   grand    = taxable + tax
 * Returns every intermediate so the UI can show a transparent breakdown that
 * must reconcile to the printed invoice amount.
 */
function computeBillTotals(items, discountAmount = 0, taxAmount = null) {
    const subtotal = r2((items || []).reduce((s, it) => s + (parseFloat(it.quantity) || 0) * (parseFloat(it.unit_price) || 0), 0));
    const discount = r2(Math.min(Math.max(parseFloat(discountAmount) || 0, 0), subtotal));
    const taxable = r2(subtotal - discount);
    const tax = taxAmount != null ? r2(taxAmount) : r2(taxable * GST_RATE);
    const grand = r2(taxable + tax);
    return { subtotal, discount, taxable, tax, grand };
}

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
    // Without this field Zod silently stripped HSN edits on every items save,
    // so reconciled HSN values never persisted (the submit gate then blocked).
    hsn_or_sac: z.string().optional().nullable().default(null),
    ai_matched: z.boolean().optional().default(false),
    ai_confidence: z.number().min(0).max(1).optional().default(0)
});

const createBillSchema = z.object({
    vendor_id: z.number().positive(),
    bill_number: z.string().optional().default(''),
    bill_date: z.string().optional().nullable(),
    due_date: z.string().optional().nullable(),
    items: z.array(billItemSchema).min(1),
    tax_amount: z.number().optional().nullable(),     // null → auto 18% of taxable
    discount_amount: z.number().min(0).optional().default(0),
    zoho_location_id: z.string().optional().nullable(),   // Zoho location/branch to post to
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
    tax_amount: z.number().optional().nullable(),     // null → auto 18% of taxable
    discount_amount: z.number().min(0).optional().default(0),
    zoho_location_id: z.string().optional().nullable(),   // Zoho location/branch to post to
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

            // vendors has no created_by column (prod schema) — the old INSERT
            // crashed on every manual vendor create.
            const [result] = await pool.query(
                `INSERT INTO vendors (vendor_name, contact_person, phone, email, address, gst_number, payment_terms, notes)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [vendor_name, contact_person, phone, email, address, gst_number, payment_terms, notes]
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
    uploadVendorBill.array('bill_image', 8),   // multi-page bills: up to 8 images
    async (req, res) => {
        try {
            const files = req.files || [];
            if (!files.length) {
                return res.status(400).json({ success: false, message: 'No bill image uploaded' });
            }

            const vendorId = req.body.vendor_id ? Number(req.body.vendor_id) : null;
            const paths = files.map(f => f.path);
            const scan_result = await vendorBillAI.scanBillImage(paths);
            const matched_items = await vendorBillAI.matchProductsToZoho(scan_result.items || [], vendorId);

            res.json({
                success: true,
                scan_result: { ...scan_result, items: matched_items },
                image_path: paths[0],          // representative image for the bill
                image_paths: paths
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
            const { vendor_id, bill_number, bill_date, due_date, items, tax_amount, discount_amount, zoho_location_id, notes, bill_image, ai_extracted_data } = req.body;

            // Generate bill number if not provided
            const finalBillNumber = bill_number || await generateNumber('BILL', 'vendor_bills', 'bill_number');

            // Money model: DPL subtotal − total discount → +GST (auto 18% unless
            // an explicit tax_amount is supplied). See computeBillTotals.
            const t = computeBillTotals(items, discount_amount, tax_amount != null ? tax_amount : null);
            const locName = await resolveLocationName(zoho_location_id);

            // Schema columns are entered_by + line_total (the old created_by/
            // amount names made every INSERT crash — the feature never worked
            // on prod until this fix).
            const [result] = await pool.query(
                `INSERT INTO vendor_bills (vendor_id, bill_number, bill_date, due_date, subtotal, tax_amount, discount_amount, grand_total,
                    balance_due, zoho_location_id, zoho_location_name, notes, bill_image, ai_extracted_data, entered_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [vendor_id, finalBillNumber, bill_date || null, due_date || null, t.subtotal, t.tax, t.discount,
                 t.grand, t.grand, zoho_location_id || null, locName, notes, bill_image || null,
                 ai_extracted_data ? JSON.stringify(ai_extracted_data) : null, req.user.id]
            );

            const billId = result.insertId;

            // Insert items
            for (const item of items) {
                const lineTotal = item.quantity * item.unit_price;
                await pool.query(
                    `INSERT INTO vendor_bill_items (bill_id, zoho_item_id, item_name, quantity, unit_price, line_total, hsn_or_sac, ai_matched, ai_confidence)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [billId, item.zoho_item_id || null, item.item_name, item.quantity, item.unit_price, lineTotal,
                     item.hsn_or_sac || null, item.ai_matched, item.ai_confidence]
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

            // alias line_total AS amount — the bill detail UI renders i.amount
            const [items] = await pool.query(
                'SELECT vbi.*, vbi.line_total AS amount FROM vendor_bill_items vbi WHERE vbi.bill_id = ? ORDER BY vbi.id',
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

            // Parse the stored AI scan + verdict, and compute the line-by-line
            // reconciliation the UI renders (what differs, what needs fixing).
            const bill = bills[0];
            let aiData = null, verification = null, reconciliation = null;
            try { aiData = bill.ai_extracted_data ? JSON.parse(bill.ai_extracted_data) : null; } catch (e) { aiData = null; }
            try { verification = bill.ai_verification_result ? JSON.parse(bill.ai_verification_result) : null; } catch (e) { verification = null; }
            if (aiData) {
                reconciliation = vendorBillAI.buildReconciliation(items, aiData);
                // Attach the catalog's stored DPL per matched line so the UI can
                // offer a per-line "update item DPL" when the bill's cost differs.
                const ids = reconciliation.lines.map(l => l.bill.zoho_item_id).filter(Boolean);
                if (ids.length) {
                    const [dplRows] = await pool.query(
                        `SELECT zoho_item_id, zoho_cf_dpl FROM zoho_items_map WHERE zoho_item_id IN (?)`, [ids]
                    );
                    const dplById = new Map(dplRows.map(r => [r.zoho_item_id, r.zoho_cf_dpl != null ? parseFloat(r.zoho_cf_dpl) : null]));
                    for (const l of reconciliation.lines) {
                        l.bill.stored_dpl = l.bill.zoho_item_id ? (dplById.get(l.bill.zoho_item_id) ?? null) : null;
                        // bill DPL = the line's cost (unit_price); flag a difference
                        l.dpl_diff = l.bill.stored_dpl != null && Math.abs(l.bill.stored_dpl - l.bill.unit_price) > 0.01;
                    }
                }
            }

            res.json({ success: true, bill, items, payments, ai_extracted_data: aiData, verification, reconciliation });
        } catch (error) {
            console.error('Get bill detail error:', error);
            res.status(500).json({ success: false, message: 'Failed to get bill details' });
        }
    }
);

// Zoho item search for the reconciliation match-picker (returns HSN so a match
// auto-fills the line's HSN).
router.get('/zoho-items',
    viewPerm,
    async (req, res) => {
        try {
            const q = `%${(req.query.q || '').trim()}%`;
            const [rows] = await pool.query(
                `SELECT zoho_item_id, zoho_item_name, zoho_sku, zoho_brand, zoho_rate, zoho_hsn_or_sac
                 FROM zoho_items_map
                 WHERE zoho_status = 'active'
                   AND (zoho_item_name LIKE ? OR zoho_sku LIKE ? OR zoho_brand LIKE ?)
                 ORDER BY zoho_item_name LIMIT 30`,
                [q, q, q]
            );
            res.json({ success: true, items: rows });
        } catch (error) {
            console.error('Vendor zoho-items search error:', error);
            res.status(500).json({ success: false, message: 'Search failed' });
        }
    }
);

// Zoho locations/branches for the PO-create + bill-push location picker (owner
// 2026-06-12). Mirrors GET /api/zoho/locations but uses the vendor module's own
// 'view' permission so staff who don't have the 'zoho' module can still pick a
// location. Each row carries the mapped local branch so the UI can default to
// the user's branch.
router.get('/zoho-locations',
    viewPerm,
    async (req, res) => {
        try {
            const [rows] = await pool.query(
                `SELECT zoho_location_id, zoho_location_name, local_branch_id
                 FROM zoho_locations_map
                 WHERE is_active = 1
                 ORDER BY zoho_location_name`
            );
            res.json({ success: true, locations: rows });
        } catch (error) {
            console.error('Vendor zoho-locations error:', error);
            res.status(500).json({ success: false, message: 'Failed to load locations' });
        }
    }
);

// Resolve a location's display name from zoho_locations_map (best-effort).
async function resolveLocationName(zohoLocationId) {
    if (!zohoLocationId) return null;
    try {
        const [rows] = await pool.query(
            'SELECT zoho_location_name FROM zoho_locations_map WHERE zoho_location_id = ? LIMIT 1',
            [zohoLocationId]
        );
        return rows.length ? rows[0].zoho_location_name : null;
    } catch { return null; }
}

// Zoho requires a discount_account_id when an entity-level discount is applied
// to a BILL/PO (purchase discounts post to an account — error 11018 "Associate
// an account for discount" otherwise). The account id lives in ai_config
// (config_key 'zoho_purchase_discount_account_id', seeded to the org's
// "Purchase Discounts" expense account) so it's editable without a deploy.
async function resolvePurchaseDiscountAccountId() {
    try {
        const [rows] = await pool.query(
            "SELECT config_value FROM ai_config WHERE config_key = 'zoho_purchase_discount_account_id' LIMIT 1"
        );
        const v = rows.length ? String(rows[0].config_value || '').trim() : '';
        return v || null;
    } catch { return null; }
}

// Zoho needs each bill/PO line to carry a tax (error 110802 "Specify either a
// Tax or Tax Exemption or Reverse Charge") because the Zoho items have no
// default tax. The owner's paints are 18% GST (intra-state CGST9+SGST9 = the
// "GST18" tax group). The tax id lives in ai_config
// ('zoho_default_gst_tax_id') so it's adjustable (e.g. IGST18 for inter-state).
async function resolveDefaultGstTaxId() {
    try {
        const [rows] = await pool.query(
            "SELECT config_value FROM ai_config WHERE config_key = 'zoho_default_gst_tax_id' LIMIT 1"
        );
        const v = rows.length ? String(rows[0].config_value || '').trim() : '';
        return v || null;
    } catch { return null; }
}

// Update a Zoho item's DPL from the bill (owner decision 2026-06-12): the bill
// is the latest purchase cost, so reconciliation can push the new DPL to the
// item — writes zoho_cf_dpl, recomputes the sales rate (ceil(DPL×1.18×1.10)),
// and pushes to Zoho live (best-effort: the local mirror is updated even if the
// Zoho call fails, so it can be re-pushed from the items page).
router.post('/items/dpl',
    managePerm,
    validate(z.object({ zoho_item_id: z.string().min(1), dpl: z.number().positive() })),
    async (req, res) => {
        try {
            const { zoho_item_id, dpl } = req.body;
            const [rows] = await pool.query(
                'SELECT zoho_item_id, zoho_hsn_or_sac FROM zoho_items_map WHERE zoho_item_id = ?',
                [zoho_item_id]
            );
            if (!rows.length) return res.status(404).json({ success: false, message: 'Item not found' });

            const rate = computeZohoRate(dpl);
            await pool.query(
                `UPDATE zoho_items_map SET zoho_cf_dpl = ?, zoho_rate = ?, zoho_purchase_rate = ?, dpl_updated_at = NOW()
                 WHERE zoho_item_id = ?`,
                [dpl, rate, dpl, zoho_item_id]
            );

            let pushed = false, pushError = null;
            try {
                const changes = { cf_dpl: dpl, purchase_rate: dpl, rate };
                if (rows[0].zoho_hsn_or_sac) changes.hsn_or_sac = String(rows[0].zoho_hsn_or_sac).trim();
                await zohoAPI.updateItem(zoho_item_id, changes);
                pushed = true;
            } catch (e) {
                pushError = e.message;
                console.error('Vendor DPL Zoho push failed:', e.message);
            }
            res.json({ success: true, dpl, sales_rate: rate, zoho_pushed: pushed, push_error: pushError });
        } catch (error) {
            console.error('Vendor DPL update error:', error);
            res.status(500).json({ success: false, message: 'Failed to update DPL' });
        }
    }
);

// Replace bill items
router.put('/bills/:id/items',
    managePerm,
    validateParams(idParamSchema),
    validate(z.object({ items: z.array(billItemSchema).min(1), tax_amount: z.number().optional().nullable(), discount_amount: z.number().min(0).optional() })),
    async (req, res) => {
        try {
            const { id } = req.params;
            const { items, tax_amount, discount_amount } = req.body;

            const [bills] = await pool.query('SELECT * FROM vendor_bills WHERE id = ?', [id]);
            if (!bills.length) {
                return res.status(404).json({ success: false, message: 'Bill not found' });
            }

            // Delete old items
            await pool.query('DELETE FROM vendor_bill_items WHERE bill_id = ?', [id]);

            // Insert new items (schema column is line_total, not amount)
            for (const item of items) {
                const lineTotal = item.quantity * item.unit_price;
                await pool.query(
                    `INSERT INTO vendor_bill_items (bill_id, zoho_item_id, item_name, quantity, unit_price, line_total, hsn_or_sac, ai_matched, ai_confidence)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [id, item.zoho_item_id || null, item.item_name, item.quantity, item.unit_price, lineTotal,
                     (item.hsn_or_sac || '').trim() || null, item.ai_matched, item.ai_confidence]
                );
            }

            // Recalculate totals (DPL subtotal − discount → +GST). Keep the
            // bill's existing discount/tax unless the caller overrides them.
            const discount = discount_amount !== undefined ? discount_amount : parseFloat(bills[0].discount_amount) || 0;
            const tax = tax_amount !== undefined ? tax_amount : (bills[0].tax_amount != null ? parseFloat(bills[0].tax_amount) : null);
            const t = computeBillTotals(items, discount, tax);
            const amount_paid = parseFloat(bills[0].amount_paid) || 0;

            await pool.query(
                `UPDATE vendor_bills SET subtotal = ?, tax_amount = ?, discount_amount = ?, grand_total = ?, balance_due = ? WHERE id = ?`,
                [t.subtotal, t.tax, t.discount, t.grand, t.grand - amount_paid, id]
            );

            res.json({ success: true, message: 'Bill items updated', totals: t, balance_due: t.grand - amount_paid });
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

            // Optional body: a fresh scan result for bills created WITHOUT an
            // upload (e.g. PO→bill conversion). Persist it first so the bill
            // carries the photo + extraction it was verified against.
            const bodyAiData = req.body && req.body.ai_extracted_data ? req.body.ai_extracted_data : null;
            if (bodyAiData) {
                await pool.query(
                    `UPDATE vendor_bills SET ai_extracted_data = ?, bill_image = COALESCE(?, bill_image) WHERE id = ?`,
                    [JSON.stringify(bodyAiData), req.body.bill_image || null, id]
                );
            }

            const aiData = bodyAiData || (bill.ai_extracted_data ? JSON.parse(bill.ai_extracted_data) : null);

            const [staffItems] = await pool.query(
                'SELECT * FROM vendor_bill_items WHERE bill_id = ?',
                [id]
            );

            // Auto-apply the bill's discount + GST from the AI extraction (owner:
            // discount/GST should populate as printed). Discount and tax are
            // seeded INDEPENDENTLY — the old gate only seeded tax when discount
            // was also absent, so a bill could show GST but no discount. A fresh
            // re-scan (bodyAiData present) deliberately syncs both to the photo;
            // otherwise we only fill values the bill hasn't been given yet so a
            // manual edit isn't undone.
            if (aiData) {
                const freshScan = !!bodyAiData;
                const aiDiscount = parseFloat(aiData.discount);
                const aiTax = parseFloat(aiData.tax);
                const curDiscount = parseFloat(bill.discount_amount) || 0;
                const haveTax = bill.tax_amount != null;

                const applyDiscount = Number.isFinite(aiDiscount) && aiDiscount >= 0 && (freshScan || curDiscount === 0);
                const applyTax = Number.isFinite(aiTax) && aiTax > 0 && (freshScan || !haveTax);

                if (applyDiscount || applyTax) {
                    const newDiscount = applyDiscount ? aiDiscount : curDiscount;
                    const newTax = applyTax ? aiTax : (haveTax ? parseFloat(bill.tax_amount) : null);
                    const t = computeBillTotals(staffItems, newDiscount, newTax);
                    const amountPaid = parseFloat(bill.amount_paid) || 0;
                    await pool.query(
                        `UPDATE vendor_bills SET tax_amount = ?, discount_amount = ?, grand_total = ?, balance_due = ? WHERE id = ?`,
                        [t.tax, t.discount, t.grand, t.grand - amountPaid, id]
                    );
                }
            }

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

// Reconcile: save the corrected lines AND re-verify in one call, returning the
// fresh verdict + reconciliation model. This is what the reconciliation UI
// posts when the user has fixed the differences.
router.post('/bills/:id/reconcile',
    managePerm,
    validateParams(idParamSchema),
    validate(z.object({
        items: z.array(billItemSchema).min(1),
        tax_amount: z.number().optional().nullable(),
        discount_amount: z.number().min(0).optional(),
    })),
    async (req, res) => {
        const conn = await pool.getConnection();
        try {
            const { id } = req.params;
            const { items, tax_amount, discount_amount } = req.body;

            const [bills] = await conn.query('SELECT * FROM vendor_bills WHERE id = ?', [id]);
            if (!bills.length) { conn.release(); return res.status(404).json({ success: false, message: 'Bill not found' }); }
            const bill = bills[0];
            if (bill.zoho_status === 'pushed') { conn.release(); return res.status(400).json({ success: false, message: 'Bill already pushed to Zoho — cannot edit' }); }

            await conn.beginTransaction();

            await conn.query('DELETE FROM vendor_bill_items WHERE bill_id = ?', [id]);
            for (const item of items) {
                const lineTotal = item.quantity * item.unit_price;
                await conn.query(
                    `INSERT INTO vendor_bill_items (bill_id, zoho_item_id, item_name, quantity, unit_price, line_total, hsn_or_sac, ai_matched, ai_confidence)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [id, item.zoho_item_id || null, item.item_name, item.quantity, item.unit_price, lineTotal,
                     (item.hsn_or_sac || '').trim() || null, item.ai_matched ? 1 : 0, item.ai_confidence || 0]
                );
            }

            const discount = discount_amount !== undefined ? discount_amount : parseFloat(bill.discount_amount) || 0;
            const tax = tax_amount !== undefined ? tax_amount : (bill.tax_amount != null ? parseFloat(bill.tax_amount) : null);
            const t = computeBillTotals(items, discount, tax);
            const amountPaid = parseFloat(bill.amount_paid) || 0;
            await conn.query(
                `UPDATE vendor_bills SET subtotal = ?, tax_amount = ?, discount_amount = ?, grand_total = ?, balance_due = ? WHERE id = ?`,
                [t.subtotal, t.tax, t.discount, t.grand, t.grand - amountPaid, id]
            );

            // Re-verify against the stored AI extraction
            const aiData = bill.ai_extracted_data ? JSON.parse(bill.ai_extracted_data) : null;
            const [savedItems] = await conn.query('SELECT * FROM vendor_bill_items WHERE bill_id = ?', [id]);
            const result = vendorBillAI.verifyBillItems(savedItems, aiData);
            // 'corrected' when the staff reconciled to a clean verdict — distinct
            // from a first-pass auto 'verified' so the audit shows human review.
            const newStatus = result.status === 'verified' ? 'corrected' : 'mismatch';
            await conn.query(
                `UPDATE vendor_bills SET ai_verification_status = ?, ai_verification_result = ? WHERE id = ?`,
                [newStatus, JSON.stringify(result), id]
            );

            await conn.commit();

            const reconciliation = aiData ? vendorBillAI.buildReconciliation(savedItems, aiData) : null;
            res.json({ success: true, status: newStatus, verification: result, totals: t, reconciliation });
        } catch (error) {
            await conn.rollback();
            console.error('Reconcile bill error:', error);
            res.status(500).json({ success: false, message: 'Failed to reconcile bill' });
        } finally {
            conn.release();
        }
    }
);

// Override verify — the durable "never stuck" escape hatch (owner 2026-06-12).
// When the AI verdict is a 'mismatch' the staff have reviewed and accept (e.g.
// the AI mis-read a bill-level figure that can't be reconciled by editing), an
// authorized user can mark the bill 'corrected' so it can be submitted/pushed.
// This does NOT bypass the real integrity gate — submit + push-zoho still
// re-check that every line is Zoho-matched and HSN'd. The acceptance is stamped
// on the bill (verified_by/verified_at + a marker in ai_verification_result).
router.post('/bills/:id/override-verify',
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
            if (bill.zoho_status === 'pushed') {
                return res.status(400).json({ success: false, message: 'Bill is already pushed to Zoho' });
            }
            if (bill.ai_verification_status === 'verified' || bill.ai_verification_status === 'corrected') {
                return res.json({ success: true, message: 'Bill is already verified', status: bill.ai_verification_status });
            }

            let prior = {};
            try { prior = bill.ai_verification_result ? JSON.parse(bill.ai_verification_result) : {}; } catch { prior = {}; }
            const note = (req.body && typeof req.body.note === 'string') ? req.body.note.slice(0, 500) : '';
            const result = {
                ...prior,
                status: 'corrected',
                overridden: true,
                overridden_by: req.user.id,
                override_note: note,
            };

            await pool.query(
                `UPDATE vendor_bills SET ai_verification_status = 'corrected', ai_verification_result = ?, verified_at = NOW(), verified_by = ? WHERE id = ?`,
                [JSON.stringify(result), req.user.id, id]
            );

            res.json({ success: true, message: 'Differences accepted — bill marked verified. It can now be pushed (a Zoho match + HSN are still required per line).', status: 'corrected' });
        } catch (error) {
            console.error('Override verify error:', error);
            res.status(500).json({ success: false, message: 'Failed to override verification' });
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

            // HSN gate (owner requirement 2026-06-12): every line must be
            // matched to a Zoho item AND carry an HSN before submission.
            const [badItems] = await pool.query(
                `SELECT item_name FROM vendor_bill_items
                 WHERE bill_id = ? AND (zoho_item_id IS NULL OR COALESCE(hsn_or_sac, '') = '')`,
                [id]
            );
            if (badItems.length) {
                return res.status(400).json({
                    success: false,
                    code: 'HSN_GATE',
                    message: `Cannot submit: ${badItems.length} item(s) missing a Zoho match or HSN code`,
                    items: badItems.map(i => i.item_name),
                });
            }

            // (schema has no `status` column — verified state lives in
            // ai_verification_status + verified_at/verified_by)
            await pool.query(
                `UPDATE vendor_bills SET ai_verification_status = 'verified', verified_at = NOW(), verified_by = ? WHERE id = ?`,
                [req.user.id, id]
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
    idempotent('vendor.bill.zohoPush'),
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

            // Push gates (owner requirement 2026-06-12): the bill must have
            // passed verification, and every line must be matched + HSN'd —
            // Zoho admin then approves the pushed bill on the Zoho side.
            if (bill.ai_verification_status !== 'verified' && bill.ai_verification_status !== 'corrected') {
                return res.status(400).json({ success: false, message: 'Bill must be verified before pushing to Zoho' });
            }
            const [gateItems] = await pool.query(
                `SELECT item_name FROM vendor_bill_items
                 WHERE bill_id = ? AND (zoho_item_id IS NULL OR COALESCE(hsn_or_sac, '') = '')`,
                [id]
            );
            if (gateItems.length) {
                return res.status(400).json({
                    success: false,
                    code: 'HSN_GATE',
                    message: `Cannot push: ${gateItems.length} item(s) missing a Zoho match or HSN code`,
                    items: gateItems.map(i => i.item_name),
                });
            }

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

            // Each line must carry a tax (Zoho 110802) — the items have no Zoho
            // default tax, so attach the configured GST tax (18% group).
            const gstTaxId = await resolveDefaultGstTaxId();
            const lineItems = items.map(it => ({
                item_id: it.zoho_item_id || undefined,
                name: it.item_name,
                hsn_or_sac: it.hsn_or_sac || undefined,
                quantity: it.quantity,
                rate: it.unit_price,   // DPL (ex-GST cost per pack)
                ...(gstTaxId ? { tax_id: gstTaxId } : {})
            }));

            // Location/branch to post the bill to in Zoho (owner 2026-06-12).
            // The push body can override (the at-push picker); else use the value
            // chosen at PO/bill create. Persist what we end up using.
            const pushLocationId = (req.body && req.body.zoho_location_id) || bill.zoho_location_id || null;
            const pushLocationName = pushLocationId
                ? (pushLocationId === bill.zoho_location_id ? bill.zoho_location_name : await resolveLocationName(pushLocationId))
                : null;

            // Discount is applied at the bill level, before tax (owner model) —
            // Zoho then computes GST on (subtotal − discount), matching the
            // printed invoice. Zoho applies each item's own tax rate.
            const billDiscount = parseFloat(bill.discount_amount) || 0;
            // Dates MUST be bare YYYY-MM-DD or Zoho 400s "Invalid value passed
            // for Invoice Date". bill_date is required → default to today; due
            // date is optional → omit when absent/unparseable.
            const billDate = toYmd(bill.bill_date) || toYmd(new Date());
            const dueDate = toYmd(bill.due_date);
            // Entity-level bill discount needs a discount_account_id (Zoho 11018).
            const discountAccountId = billDiscount > 0 ? await resolvePurchaseDiscountAccountId() : null;
            const zohoResp = await zohoAPI.createBill({
                vendor_id: zohoContactId,
                bill_number: bill.bill_number,
                date: billDate,
                ...(dueDate ? { due_date: dueDate } : {}),
                line_items: lineItems,
                ...(pushLocationId ? { location_id: pushLocationId } : {}),
                ...(billDiscount > 0 ? {
                    discount: billDiscount,
                    is_discount_before_tax: true,
                    discount_type: 'entity_level',
                    ...(discountAccountId ? { discount_account_id: discountAccountId } : {})
                } : {})
            });

            const zohoBillId = zohoResp.bill?.bill_id;

            // Take it OUT OF DRAFT (owner 2026-06-12): a staff push lands in the
            // admin's Zoho approval queue; an admin push is approved directly.
            const admin = isFullAdmin(req.user && req.user.role);
            const fin = await zohoAPI.finalizeDocument('bill', zohoBillId, admin);

            await pool.query(
                `UPDATE vendor_bills SET zoho_status = 'pushed', zoho_bill_id = ?, zoho_location_id = ?, zoho_location_name = ? WHERE id = ?`,
                [zohoBillId || null, pushLocationId, pushLocationName, id]
            );

            const stateMsg = fin.state === 'approved' ? 'created & approved in Zoho'
                : fin.state === 'submitted' ? 'created & submitted for admin approval in Zoho'
                : fin.state === 'open' ? 'created in Zoho'
                : 'pushed to Zoho (draft — approval step failed, finalize it in Zoho)';
            res.json({ success: true, message: `Bill ${stateMsg}`, zoho_bill_id: zohoBillId, zoho_state: fin.state });
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

            // zoho_status is computed (the table has no such column) — the UI
            // renders a "pushed" pill and hides the push button based on it.
            const [rows] = await pool.query(
                `SELECT po.*, v.vendor_name, u.full_name AS created_by_name,
                    CASE WHEN po.zoho_po_id IS NULL THEN NULL ELSE 'pushed' END AS zoho_status
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

// Get purchase order detail (with items + linked bill).
// The UI used to "fetch the list with limit=999 and find the row" — the Zod
// limit cap (100) silently 400'd that, so View/Edit PO never worked, and PO
// items were never shown or preserved on edit. This endpoint fixes both.
router.get('/purchase-orders/:id',
    viewPerm,
    validateParams(idParamSchema),
    async (req, res) => {
        try {
            const { id } = req.params;

            const [pos] = await pool.query(
                `SELECT po.*, v.vendor_name, u.full_name AS created_by_name,
                    CASE WHEN po.zoho_po_id IS NULL THEN NULL ELSE 'pushed' END AS zoho_status
                 FROM vendor_purchase_orders po
                 JOIN vendors v ON po.vendor_id = v.id
                 LEFT JOIN users u ON po.created_by = u.id
                 WHERE po.id = ?`,
                [id]
            );
            if (!pos.length) {
                return res.status(404).json({ success: false, message: 'Purchase order not found' });
            }

            const [items] = await pool.query(
                'SELECT * FROM vendor_po_items WHERE po_id = ? ORDER BY id',
                [id]
            );

            // Converted-bill linkage (vendor_bills.po_id) so the UI can jump
            // straight to the bill created from this PO.
            const [bills] = await pool.query(
                'SELECT id, bill_number, ai_verification_status, zoho_status FROM vendor_bills WHERE po_id = ? LIMIT 1',
                [id]
            );

            res.json({ success: true, purchase_order: pos[0], items, bill: bills[0] || null });
        } catch (error) {
            console.error('Get PO detail error:', error);
            res.status(500).json({ success: false, message: 'Failed to get purchase order details' });
        }
    }
);

// Create purchase order
router.post('/purchase-orders',
    poPerm,
    validate(createPOSchema),
    async (req, res) => {
        try {
            const { vendor_id, items, tax_amount, discount_amount, zoho_location_id, expected_date, notes } = req.body;

            const po_number = await generateNumber('PO', 'vendor_purchase_orders', 'po_number');
            // Same money model as bills: DPL subtotal − discount → +GST (auto 18%).
            const t = computeBillTotals(items, discount_amount, tax_amount != null ? tax_amount : null);
            const locName = await resolveLocationName(zoho_location_id);

            const [result] = await pool.query(
                `INSERT INTO vendor_purchase_orders (vendor_id, po_number, subtotal, tax_amount, discount_amount, grand_total, zoho_location_id, zoho_location_name, expected_date, notes, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [vendor_id, po_number, t.subtotal, t.tax, t.discount, t.grand, zoho_location_id || null, locName, expected_date || null, notes, req.user.id]
            );

            const poId = result.insertId;

            // schema column is line_total, not amount
            for (const item of items) {
                const lineTotal = item.quantity * item.unit_price;
                await pool.query(
                    `INSERT INTO vendor_po_items (po_id, zoho_item_id, item_name, quantity, unit_price, line_total)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [poId, item.zoho_item_id || null, item.item_name, item.quantity, item.unit_price, lineTotal]
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

            const { vendor_id, items, tax_amount, discount_amount, zoho_location_id, expected_date, notes } = req.body;

            // Replace items
            await pool.query('DELETE FROM vendor_po_items WHERE po_id = ?', [id]);

            const t = computeBillTotals(items, discount_amount, tax_amount != null ? tax_amount : null);
            const locName = await resolveLocationName(zoho_location_id);

            // schema column is line_total, not amount
            for (const item of items) {
                const lineTotal = item.quantity * item.unit_price;
                await pool.query(
                    `INSERT INTO vendor_po_items (po_id, zoho_item_id, item_name, quantity, unit_price, line_total)
                     VALUES (?, ?, ?, ?, ?, ?)`,
                    [id, item.zoho_item_id || null, item.item_name, item.quantity, item.unit_price, lineTotal]
                );
            }

            await pool.query(
                `UPDATE vendor_purchase_orders SET vendor_id = ?, subtotal = ?, tax_amount = ?, discount_amount = ?, grand_total = ?,
                    zoho_location_id = ?, zoho_location_name = ?, expected_date = ?, notes = ? WHERE id = ?`,
                [vendor_id, t.subtotal, t.tax, t.discount, t.grand, zoho_location_id || null, locName, expected_date || null, notes, id]
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

// Convert PO → Bill (owner flow 2026-06-12): copies the PO lines into a new
// vendor_bill (HSN pulled from zoho_items_map where matched), links it via
// vendor_bills.po_id (migration 20260612_vendor_po_bill_link) and marks the
// PO 'received' (the existing status enum's converted state). The response
// tells the UI to prompt for a bill-photo upload + AI verify.
router.post('/purchase-orders/:id/convert-to-bill',
    managePerm,
    idempotent('vendor.po.convertBill'),
    validateParams(idParamSchema),
    async (req, res) => {
        try {
            const { id } = req.params;

            const [pos] = await pool.query('SELECT * FROM vendor_purchase_orders WHERE id = ?', [id]);
            if (!pos.length) {
                return res.status(404).json({ success: false, message: 'Purchase order not found' });
            }
            const po = pos[0];
            if (po.status === 'cancelled') {
                return res.status(400).json({ success: false, message: 'Cancelled POs cannot be converted' });
            }

            const [existing] = await pool.query(
                'SELECT id, bill_number FROM vendor_bills WHERE po_id = ? LIMIT 1',
                [id]
            );
            if (existing.length) {
                return res.status(400).json({
                    success: false,
                    message: `PO already converted to bill ${existing[0].bill_number}`,
                    bill_id: existing[0].id
                });
            }

            const [poItems] = await pool.query(
                'SELECT * FROM vendor_po_items WHERE po_id = ? ORDER BY id',
                [id]
            );
            if (!poItems.length) {
                return res.status(400).json({ success: false, message: 'Purchase order has no items' });
            }

            // HSN from the Zoho catalog for matched lines
            const zohoIds = poItems.map(it => it.zoho_item_id).filter(Boolean);
            const hsnById = new Map();
            if (zohoIds.length) {
                const [hsnRows] = await pool.query(
                    `SELECT zoho_item_id, zoho_hsn_or_sac FROM zoho_items_map WHERE zoho_item_id IN (?)`,
                    [zohoIds]
                );
                for (const r of hsnRows) hsnById.set(r.zoho_item_id, r.zoho_hsn_or_sac || null);
            }

            const billNumber = await generateNumber('BILL', 'vendor_bills', 'bill_number');
            const [result] = await pool.query(
                `INSERT INTO vendor_bills (vendor_id, po_id, bill_number, bill_date, subtotal, tax_amount, discount_amount, grand_total,
                    balance_due, zoho_location_id, zoho_location_name, ai_verification_status, notes, entered_by)
                 VALUES (?, ?, ?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
                [po.vendor_id, id, billNumber, po.subtotal, po.tax_amount, po.discount_amount || 0, po.grand_total,
                 po.grand_total, po.zoho_location_id || null, po.zoho_location_name || null,
                 `Converted from PO ${po.po_number}`, req.user.id]
            );
            const billId = result.insertId;

            for (const item of poItems) {
                await pool.query(
                    `INSERT INTO vendor_bill_items (bill_id, zoho_item_id, item_name, quantity, unit_price, line_total, hsn_or_sac, ai_matched, ai_confidence)
                     VALUES (?, ?, ?, ?, ?, ?, ?, 0, NULL)`,
                    [billId, item.zoho_item_id || null, item.item_name, item.quantity, item.unit_price,
                     item.line_total, (item.zoho_item_id && hsnById.get(item.zoho_item_id)) || null]
                );
            }

            await pool.query(`UPDATE vendor_purchase_orders SET status = 'received' WHERE id = ?`, [id]);

            res.json({
                success: true,
                bill_id: billId,
                bill_number: billNumber,
                po_id: Number(id),
                requires_photo_verification: true,
                message: `Bill ${billNumber} created from PO ${po.po_number}. Upload the bill photo and run AI verify before submitting.`
            });
        } catch (error) {
            console.error('Convert PO to bill error:', error);
            res.status(500).json({ success: false, message: 'Failed to convert purchase order to bill' });
        }
    }
);

// Push PO to Zoho
router.post('/purchase-orders/:id/push-zoho',
    poPerm,
    idempotent('vendor.po.zohoPush'),
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

            // Each line must carry a tax (Zoho 110802) — attach the configured GST.
            const poGstTaxId = await resolveDefaultGstTaxId();
            const lineItems = items.map(it => ({
                item_id: it.zoho_item_id || undefined,
                name: it.item_name,
                quantity: it.quantity,
                rate: it.unit_price,
                ...(poGstTaxId ? { tax_id: poGstTaxId } : {})
            }));

            // expected_date arrives as a JS Date from mysql2 — serialized raw it
            // becomes an ISO timestamp Zoho rejects ("Invalid value passed for
            // Delivery Date"). Send YYYY-MM-DD, and omit entirely when unset.
            let deliveryDate = null;
            if (po.expected_date) {
                const d = new Date(po.expected_date);
                if (!isNaN(d)) {
                    deliveryDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                }
            }
            const poDiscount = parseFloat(po.discount_amount) || 0;
            const poLocationId = (req.body && req.body.zoho_location_id) || po.zoho_location_id || null;
            const poDiscountAccountId = poDiscount > 0 ? await resolvePurchaseDiscountAccountId() : null;
            const zohoResp = await zohoAPI.createPurchaseOrder({
                vendor_id: zohoContactId,
                purchaseorder_number: po.po_number,
                ...(deliveryDate ? { delivery_date: deliveryDate } : {}),
                line_items: lineItems,
                ...(poLocationId ? { location_id: poLocationId } : {}),
                ...(poDiscount > 0 ? {
                    discount: poDiscount,
                    is_discount_before_tax: true,
                    discount_type: 'entity_level',
                    ...(poDiscountAccountId ? { discount_account_id: poDiscountAccountId } : {})
                } : {})
            });

            // vendor_purchase_orders has no zoho_status column (prod schema) —
            // pushed state is derived from zoho_po_id being set.
            const zohoPOId = zohoResp.purchaseorder?.purchaseorder_id;
            await pool.query(
                `UPDATE vendor_purchase_orders SET zoho_po_id = ? WHERE id = ?`,
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
    idempotent('vendor.payment.create'),
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
// ALL VENDORS (lightweight, for dropdowns)
// ═══════════════════════════════════════════
// The paginated list caps limit at 100 (Zod refine) — the dropdowns used to
// request limit=999, get a silent 400, and stay EMPTY (the "can't choose a
// vendor" bug). Dropdowns use this uncapped id+name list instead.
router.get('/all',
    viewPerm,
    async (req, res) => {
        try {
            const [rows] = await pool.query(
                `SELECT id, vendor_name, gst_number FROM vendors WHERE status = 'active' ORDER BY vendor_name`
            );
            res.json({ success: true, vendors: rows });
        } catch (error) {
            console.error('List all vendors error:', error);
            res.status(500).json({ success: false, message: 'Failed to list vendors' });
        }
    }
);

// ═══════════════════════════════════════════
// STATS (header cards)
// ═══════════════════════════════════════════
// The page used to derive "Outstanding" by fetching the vendor list with
// limit=999 — silently 400'd by the limit cap, so the stat always showed ₹0.
// One aggregate query replaces the four list fetches.
router.get('/stats',
    viewPerm,
    async (req, res) => {
        try {
            const [rows] = await pool.query(
                `SELECT
                    (SELECT COUNT(*) FROM vendors) AS total_vendors,
                    (SELECT COUNT(*) FROM vendor_bills WHERE payment_status != 'paid') AS open_bills,
                    (SELECT COALESCE(SUM(balance_due), 0) FROM vendor_bills WHERE payment_status != 'paid') AS outstanding,
                    (SELECT COUNT(*) FROM vendor_purchase_orders) AS purchase_orders`
            );
            res.json({ success: true, stats: rows[0] });
        } catch (error) {
            console.error('Vendor stats error:', error);
            res.status(500).json({ success: false, message: 'Failed to load vendor stats' });
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

// Zod schemas exported for unit testing only (tests/unit/vendors.test.js) —
// routes still use them directly via validate().
module.exports = { router, setPool, createVendorSchema, createBillSchema, recordPaymentSchema, listQuerySchema, computeBillTotals };
