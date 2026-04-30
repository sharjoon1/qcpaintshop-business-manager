# Staff Billing System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete billing module where staff can create estimates, direct invoices, collect payments (full/partial/credit), and push invoices to Zoho Books — for both customers and painters.

**Architecture:** New `routes/billing.js` route module with `billing_estimates`, `billing_invoices`, `billing_payments` tables. Shared Zoho push service (`services/billing-zoho-service.js`). Single-page UI (`staff-billing.html`) with Estimates/Invoices/Payments tabs. Follows existing patterns: `setPool()` export, `requirePermission()` middleware, branch filtering, Zod validation.

**Tech Stack:** Express.js, MySQL (mysql2/promise), Zod validation, Zoho Books API (via existing `zoho-api.js`), Tailwind CSS + design-system.css, vanilla JS frontend.

**Spec:** `docs/superpowers/specs/2026-04-01-staff-billing-vendor-management-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `migrations/migrate-billing.js` | Create billing_estimates, billing_estimate_items, billing_invoices, billing_invoice_items, billing_payments tables + permissions + config |
| `routes/billing.js` | All billing API endpoints: estimates CRUD, invoices CRUD, payments, product search, Zoho push |
| `services/billing-zoho-service.js` | Zoho contact resolution, invoice creation, payment recording — reusable for vendor module later |
| `public/staff-billing.html` | Single-page UI with Estimates/Invoices/Payments tabs |
| `tests/unit/billing.test.js` | Unit tests for billing route helpers and validation |

### Modified Files
| File | Change |
|------|--------|
| `server.js` | Import billing routes, call `setPool()`, mount at `/api/billing` |

---

## Task 1: Database Migration

**Files:**
- Create: `migrations/migrate-billing.js`

- [ ] **Step 1: Write migration file**

```javascript
// migrations/migrate-billing.js
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function runStep(pool, label, sql, params = []) {
    try {
        await pool.query(sql, params);
        console.log(`   OK  ${label}`);
        return 'ok';
    } catch (err) {
        const code = err.code || '';
        if (['ER_DUP_FIELDNAME', 'ER_DUP_ENTRY', 'ER_TABLE_EXISTS_ERROR'].includes(code)) {
            console.log(`   SKIP ${label} (${code})`);
            return 'skip';
        }
        console.error(`   FAIL ${label} — ${err.message}`);
        return 'fail';
    }
}

async function migrate() {
    let pool;
    try {
        pool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'business_manager',
            port: process.env.DB_PORT || 3306
        });

        console.log('Connected to database. Running billing migration...\n');

        // 1. billing_estimates
        console.log('1. Creating billing_estimates table...');
        await runStep(pool, 'billing_estimates', `
            CREATE TABLE IF NOT EXISTS billing_estimates (
                id INT AUTO_INCREMENT PRIMARY KEY,
                estimate_number VARCHAR(20) NOT NULL UNIQUE,
                created_by INT NOT NULL,
                branch_id INT,
                customer_type ENUM('customer','painter') NOT NULL,
                customer_id INT NULL,
                painter_id INT NULL,
                customer_name VARCHAR(255) NOT NULL,
                customer_phone VARCHAR(20),
                customer_address TEXT,
                subtotal DECIMAL(12,2) DEFAULT 0,
                discount_amount DECIMAL(12,2) DEFAULT 0,
                grand_total DECIMAL(12,2) DEFAULT 0,
                status ENUM('draft','sent','approved','converted','cancelled') DEFAULT 'draft',
                converted_to_invoice_id INT NULL,
                notes TEXT,
                valid_until DATE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_status (status),
                INDEX idx_created_by (created_by),
                INDEX idx_branch (branch_id),
                INDEX idx_customer_type (customer_type),
                INDEX idx_created_at (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 2. billing_estimate_items
        console.log('2. Creating billing_estimate_items table...');
        await runStep(pool, 'billing_estimate_items', `
            CREATE TABLE IF NOT EXISTS billing_estimate_items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                estimate_id INT NOT NULL,
                zoho_item_id VARCHAR(50),
                item_name VARCHAR(255) NOT NULL,
                pack_size VARCHAR(100),
                quantity DECIMAL(10,2) NOT NULL,
                unit_price DECIMAL(10,2) NOT NULL,
                line_total DECIMAL(12,2) NOT NULL,
                display_order INT DEFAULT 0,
                FOREIGN KEY (estimate_id) REFERENCES billing_estimates(id) ON DELETE CASCADE,
                INDEX idx_estimate (estimate_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 3. billing_invoices
        console.log('3. Creating billing_invoices table...');
        await runStep(pool, 'billing_invoices', `
            CREATE TABLE IF NOT EXISTS billing_invoices (
                id INT AUTO_INCREMENT PRIMARY KEY,
                invoice_number VARCHAR(20) NOT NULL UNIQUE,
                created_by INT NOT NULL,
                branch_id INT,
                source ENUM('direct','estimate') NOT NULL DEFAULT 'direct',
                estimate_id INT NULL,
                customer_type ENUM('customer','painter') NOT NULL,
                customer_id INT NULL,
                painter_id INT NULL,
                customer_name VARCHAR(255) NOT NULL,
                customer_phone VARCHAR(20),
                customer_address TEXT,
                subtotal DECIMAL(12,2) DEFAULT 0,
                discount_amount DECIMAL(12,2) DEFAULT 0,
                grand_total DECIMAL(12,2) DEFAULT 0,
                amount_paid DECIMAL(12,2) DEFAULT 0,
                balance_due DECIMAL(12,2) DEFAULT 0,
                payment_status ENUM('unpaid','partial','paid') DEFAULT 'unpaid',
                zoho_status ENUM('pending','pushed','failed') DEFAULT 'pending',
                zoho_invoice_id VARCHAR(50) NULL,
                zoho_invoice_number VARCHAR(50) NULL,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_payment_status (payment_status),
                INDEX idx_zoho_status (zoho_status),
                INDEX idx_created_by (created_by),
                INDEX idx_branch (branch_id),
                INDEX idx_customer_type (customer_type),
                INDEX idx_created_at (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 4. billing_invoice_items
        console.log('4. Creating billing_invoice_items table...');
        await runStep(pool, 'billing_invoice_items', `
            CREATE TABLE IF NOT EXISTS billing_invoice_items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                invoice_id INT NOT NULL,
                zoho_item_id VARCHAR(50),
                item_name VARCHAR(255) NOT NULL,
                pack_size VARCHAR(100),
                quantity DECIMAL(10,2) NOT NULL,
                unit_price DECIMAL(10,2) NOT NULL,
                line_total DECIMAL(12,2) NOT NULL,
                display_order INT DEFAULT 0,
                FOREIGN KEY (invoice_id) REFERENCES billing_invoices(id) ON DELETE CASCADE,
                INDEX idx_invoice (invoice_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 5. billing_payments
        console.log('5. Creating billing_payments table...');
        await runStep(pool, 'billing_payments', `
            CREATE TABLE IF NOT EXISTS billing_payments (
                id INT AUTO_INCREMENT PRIMARY KEY,
                invoice_id INT NOT NULL,
                amount DECIMAL(12,2) NOT NULL,
                payment_method ENUM('cash','upi','bank_transfer','cheque','credit') NOT NULL,
                payment_reference VARCHAR(100),
                received_by INT NOT NULL,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (invoice_id) REFERENCES billing_invoices(id) ON DELETE CASCADE,
                INDEX idx_invoice (invoice_id),
                INDEX idx_received_by (received_by),
                INDEX idx_created_at (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 6. Add permissions
        console.log('\n6. Adding billing permissions...');
        const permissions = [
            ['billing', 'estimate', 'Billing Estimates', 'Create and manage billing estimates'],
            ['billing', 'invoice', 'Billing Invoices', 'Create and manage billing invoices'],
            ['billing', 'payment', 'Billing Payments', 'Record and manage payments'],
            ['billing', 'zoho_push', 'Billing Zoho Push', 'Push invoices to Zoho Books']
        ];
        for (const [module, action, displayName, description] of permissions) {
            const [existing] = await pool.query(
                'SELECT id FROM permissions WHERE module = ? AND action = ?',
                [module, action]
            );
            if (existing.length === 0) {
                await runStep(pool, `permission: ${module}.${action}`,
                    'INSERT INTO permissions (module, action, display_name, description) VALUES (?, ?, ?, ?)',
                    [module, action, displayName, description]
                );
            } else {
                console.log(`   SKIP permission: ${module}.${action} (exists)`);
            }
        }

        // 7. Add config keys
        console.log('\n7. Adding billing config...');
        const configs = [
            ['billing_enabled', '1'],
            ['billing_estimate_prefix', 'BE'],
            ['billing_invoice_prefix', 'BI'],
            ['billing_gst_inclusive', '1']
        ];
        for (const [key, value] of configs) {
            const [existing] = await pool.query('SELECT config_key FROM ai_config WHERE config_key = ?', [key]);
            if (existing.length === 0) {
                await runStep(pool, `config: ${key}`,
                    'INSERT INTO ai_config (config_key, config_value) VALUES (?, ?)',
                    [key, value]
                );
            } else {
                console.log(`   SKIP config: ${key} (exists)`);
            }
        }

        console.log('\n✅ Billing migration completed successfully');
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        if (pool) await pool.end();
    }
}

migrate();
```

- [ ] **Step 2: Run migration**

Run: `node migrations/migrate-billing.js`
Expected: All 5 tables created, 4 permissions added, 4 config keys added.

- [ ] **Step 3: Verify tables exist**

Run: `node -e "const mysql=require('mysql2/promise');const path=require('path');require('dotenv').config({path:path.join(__dirname,'.env')});(async()=>{const p=mysql.createPool({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,port:process.env.DB_PORT||3306});const [r]=await p.query(\"SHOW TABLES LIKE 'billing_%'\");console.log('Tables:',r.map(Object.values).flat());await p.end()})()"`
Expected: `Tables: [ 'billing_estimate_items', 'billing_estimates', 'billing_invoice_items', 'billing_invoices', 'billing_payments' ]`

- [ ] **Step 4: Commit**

```bash
git add migrations/migrate-billing.js
git commit -m "feat(billing): add migration for billing tables, permissions, config"
```

---

## Task 2: Billing Zoho Service

**Files:**
- Create: `services/billing-zoho-service.js`

- [ ] **Step 1: Write the service**

```javascript
// services/billing-zoho-service.js
const zohoAPI = require('./zoho-api');

let pool;
let pointsEngine;

function setPool(p) { pool = p; }
function setPointsEngine(pe) { pointsEngine = pe; }

/**
 * Find or create a Zoho contact for the given customer/painter.
 * Returns zohoContactId string or throws.
 */
async function resolveZohoContact(customerType, { customerId, painterId, customerName, customerPhone }) {
    if (customerType === 'painter' && painterId) {
        const [painters] = await pool.query(
            'SELECT zoho_contact_id, full_name, phone FROM painters WHERE id = ?', [painterId]
        );
        if (!painters.length) throw new Error('Painter not found');
        const painter = painters[0];
        if (painter.zoho_contact_id) return painter.zoho_contact_id;

        // Create contact for painter
        const res = await zohoAPI.createContact({
            contact_name: painter.full_name,
            contact_type: 'customer',
            phone: painter.phone
        });
        const contactId = res?.contact?.contact_id;
        if (!contactId) throw new Error('Failed to create Zoho contact for painter');
        await pool.query('UPDATE painters SET zoho_contact_id = ? WHERE id = ?', [contactId, painterId]);
        return contactId;
    }

    // Customer type
    if (customerId) {
        const [customers] = await pool.query(
            'SELECT zoho_customer_id FROM zoho_customers_map WHERE id = ?', [customerId]
        );
        if (customers.length && customers[0].zoho_customer_id) {
            return customers[0].zoho_customer_id;
        }
    }

    // Create new contact
    const res = await zohoAPI.createContact({
        contact_name: customerName,
        contact_type: 'customer',
        phone: customerPhone || undefined
    });
    const contactId = res?.contact?.contact_id;
    if (!contactId) throw new Error('Failed to create Zoho contact for customer');
    return contactId;
}

/**
 * Push a billing invoice to Zoho Books.
 * Updates billing_invoices with zoho_invoice_id/number.
 * Awards painter points if applicable.
 */
async function pushInvoiceToZoho(invoiceId, userId) {
    // Load invoice
    const [invoices] = await pool.query('SELECT * FROM billing_invoices WHERE id = ?', [invoiceId]);
    if (!invoices.length) throw new Error('Invoice not found');
    const invoice = invoices[0];

    if (invoice.zoho_status === 'pushed') throw new Error('Invoice already pushed to Zoho');

    // Load items
    const [items] = await pool.query(
        'SELECT * FROM billing_invoice_items WHERE invoice_id = ? ORDER BY display_order', [invoiceId]
    );
    if (!items.length) throw new Error('Invoice has no items');

    // 1. Resolve Zoho contact
    const zohoContactId = await resolveZohoContact(invoice.customer_type, {
        customerId: invoice.customer_id,
        painterId: invoice.painter_id,
        customerName: invoice.customer_name,
        customerPhone: invoice.customer_phone
    });

    // 2. Credit limit check (non-blocking)
    try {
        const { checkCreditBeforeInvoice } = require('../routes/credit-limits');
        const creditCheck = await checkCreditBeforeInvoice(pool, zohoContactId, parseFloat(invoice.grand_total));
        if (!creditCheck.allowed) {
            throw new Error(creditCheck.reason || 'Credit limit exceeded');
        }
    } catch (err) {
        if (err.message.includes('Credit limit') || err.message.includes('credit')) throw err;
        console.error('Credit check error (non-blocking):', err.message);
    }

    // 3. Create Zoho invoice
    const lineItems = items.map(i => ({
        item_id: i.zoho_item_id,
        quantity: parseFloat(i.quantity),
        rate: parseFloat(i.unit_price)
    }));

    const zohoResult = await zohoAPI.createInvoice({
        customer_id: zohoContactId,
        date: new Date().toISOString().split('T')[0],
        line_items: lineItems
    });

    const zohoInvoiceId = zohoResult?.invoice?.invoice_id || 'unknown';
    const zohoInvoiceNumber = zohoResult?.invoice?.invoice_number || 'unknown';

    // 4. Award painter points if painter billing
    let pointsResult = { regularPoints: 0, annualPoints: 0 };
    if (invoice.customer_type === 'painter' && invoice.painter_id && pointsEngine) {
        try {
            const invoiceForPoints = {
                invoice_id: zohoInvoiceId,
                invoice_number: zohoInvoiceNumber,
                date: new Date().toISOString().split('T')[0],
                total: parseFloat(invoice.grand_total),
                line_items: items.map(i => ({
                    item_id: i.zoho_item_id,
                    quantity: parseFloat(i.quantity),
                    item_total: parseFloat(i.line_total)
                }))
            };
            pointsResult = await pointsEngine.processInvoice(
                invoice.painter_id, invoiceForPoints, 'self', userId
            );
        } catch (err) {
            console.error('Points award error:', err.message);
        }
    }

    // 5. Record Zoho payment if invoice has payments
    if (parseFloat(invoice.amount_paid) > 0) {
        try {
            await zohoAPI.createPayment({
                customer_id: zohoContactId,
                payment_mode: 'Cash',
                amount: parseFloat(invoice.amount_paid),
                date: new Date().toISOString().split('T')[0],
                invoices: [{ invoice_id: zohoInvoiceId, amount_applied: parseFloat(invoice.amount_paid) }]
            });
        } catch (err) {
            console.error('Zoho payment record error:', err.message);
        }
    }

    // 6. Update invoice
    await pool.query(
        `UPDATE billing_invoices SET zoho_status = 'pushed', zoho_invoice_id = ?, zoho_invoice_number = ? WHERE id = ?`,
        [zohoInvoiceId, zohoInvoiceNumber, invoiceId]
    );

    return { zohoInvoiceId, zohoInvoiceNumber, pointsResult };
}

module.exports = { setPool, setPointsEngine, resolveZohoContact, pushInvoiceToZoho };
```

- [ ] **Step 2: Commit**

```bash
git add services/billing-zoho-service.js
git commit -m "feat(billing): add billing Zoho service for contact resolution and invoice push"
```

---

## Task 3: Billing Routes — Estimates

**Files:**
- Create: `routes/billing.js`

- [ ] **Step 1: Write estimate routes**

```javascript
// routes/billing.js
const express = require('express');
const router = express.Router();
const { z } = require('zod');
const { requirePermission, requireAuth } = require('../middleware/permissionMiddleware');
const { validate, validateQuery, validateParams } = require('../middleware/validate');
const billingZohoService = require('../services/billing-zoho-service');

let pool;

function setPool(p) {
    pool = p;
    billingZohoService.setPool(p);
}

function setPointsEngine(pe) {
    billingZohoService.setPointsEngine(pe);
}

// ========================================
// HELPERS
// ========================================

function getBranchFilter(req) {
    if (req.user.role === 'admin' || req.user.role === 'manager' || req.user.role === 'super_admin') {
        return req.query.branch_id ? parseInt(req.query.branch_id) : null;
    }
    return req.user.branch_id || null;
}

async function generateNumber(prefix, table, column) {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const dateStr = `${y}${m}${d}`;
    const pattern = `${prefix}-${dateStr}-%`;

    const [rows] = await pool.query(
        `SELECT ${column} FROM ${table} WHERE ${column} LIKE ? ORDER BY id DESC LIMIT 1`,
        [pattern]
    );

    let seq = 1;
    if (rows.length) {
        const last = rows[0][column];
        const parts = last.split('-');
        seq = parseInt(parts[2]) + 1;
    }
    return `${prefix}-${dateStr}-${String(seq).padStart(3, '0')}`;
}

// ========================================
// SCHEMAS
// ========================================

const estimateItemSchema = z.object({
    zoho_item_id: z.string().min(1),
    item_name: z.string().min(1),
    pack_size: z.string().optional().default(''),
    quantity: z.number().positive(),
    unit_price: z.number().min(0),
});

const createEstimateSchema = z.object({
    customer_type: z.enum(['customer', 'painter']),
    customer_id: z.number().int().positive().optional().nullable(),
    painter_id: z.number().int().positive().optional().nullable(),
    customer_name: z.string().min(1),
    customer_phone: z.string().optional().default(''),
    customer_address: z.string().optional().default(''),
    items: z.array(estimateItemSchema).min(1),
    discount_amount: z.number().min(0).optional().default(0),
    notes: z.string().optional().default(''),
    valid_until: z.string().optional().nullable(),
    status: z.enum(['draft', 'sent']).optional().default('draft'),
});

const listQuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    status: z.string().optional(),
    customer_type: z.enum(['customer', 'painter']).optional(),
    search: z.string().optional(),
    branch_id: z.coerce.number().int().optional(),
});

const idParamSchema = z.object({
    id: z.coerce.number().int().positive(),
});

// ========================================
// ESTIMATE ENDPOINTS
// ========================================

const estimatePerm = requirePermission('billing', 'estimate');

// Create estimate
router.post('/estimates', estimatePerm, validate(createEstimateSchema), async (req, res) => {
    try {
        const { customer_type, customer_id, painter_id, customer_name, customer_phone,
                customer_address, items, discount_amount, notes, valid_until, status } = req.body;

        const estimateNumber = await generateNumber('BE', 'billing_estimates', 'estimate_number');

        let subtotal = 0;
        for (const item of items) {
            item.line_total = Math.round(item.quantity * item.unit_price * 100) / 100;
            subtotal += item.line_total;
        }
        subtotal = Math.round(subtotal * 100) / 100;
        const grandTotal = Math.round((subtotal - discount_amount) * 100) / 100;

        const [result] = await pool.query(
            `INSERT INTO billing_estimates
             (estimate_number, created_by, branch_id, customer_type, customer_id, painter_id,
              customer_name, customer_phone, customer_address, subtotal, discount_amount, grand_total,
              status, notes, valid_until)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [estimateNumber, req.user.id, req.user.branch_id || null, customer_type,
             customer_id || null, painter_id || null, customer_name, customer_phone,
             customer_address, subtotal, discount_amount, grandTotal, status, notes,
             valid_until || null]
        );
        const estimateId = result.insertId;

        // Insert items
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            await pool.query(
                `INSERT INTO billing_estimate_items
                 (estimate_id, zoho_item_id, item_name, pack_size, quantity, unit_price, line_total, display_order)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [estimateId, item.zoho_item_id, item.item_name, item.pack_size || '',
                 item.quantity, item.unit_price, item.line_total, i + 1]
            );
        }

        res.json({ success: true, estimate: { id: estimateId, estimate_number: estimateNumber, status, grand_total: grandTotal } });
    } catch (error) {
        console.error('Create estimate error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// List estimates
router.get('/estimates', estimatePerm, validateQuery(listQuerySchema), async (req, res) => {
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
            params.push(`%${search}%`, `%${search}%`);
        }

        const [countRows] = await pool.query(
            `SELECT COUNT(*) as total FROM billing_estimates be ${where}`, params
        );
        const total = countRows[0].total;

        const [estimates] = await pool.query(
            `SELECT be.*, u.full_name as created_by_name
             FROM billing_estimates be
             LEFT JOIN users u ON be.created_by = u.id
             ${where}
             ORDER BY be.created_at DESC
             LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        res.json({ success: true, estimates, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (error) {
        console.error('List estimates error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get estimate detail
router.get('/estimates/:id', estimatePerm, validateParams(idParamSchema), async (req, res) => {
    try {
        const [estimates] = await pool.query(
            `SELECT be.*, u.full_name as created_by_name
             FROM billing_estimates be
             LEFT JOIN users u ON be.created_by = u.id
             WHERE be.id = ?`,
            [req.params.id]
        );
        if (!estimates.length) return res.status(404).json({ success: false, message: 'Estimate not found' });

        const [items] = await pool.query(
            'SELECT * FROM billing_estimate_items WHERE estimate_id = ? ORDER BY display_order',
            [req.params.id]
        );

        res.json({ success: true, estimate: { ...estimates[0], items } });
    } catch (error) {
        console.error('Get estimate error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Update estimate (draft/sent only)
router.put('/estimates/:id', estimatePerm, validateParams(idParamSchema), validate(createEstimateSchema), async (req, res) => {
    try {
        const [existing] = await pool.query('SELECT id, status FROM billing_estimates WHERE id = ?', [req.params.id]);
        if (!existing.length) return res.status(404).json({ success: false, message: 'Estimate not found' });
        if (!['draft', 'sent'].includes(existing[0].status)) {
            return res.status(400).json({ success: false, message: 'Can only edit draft or sent estimates' });
        }

        const { customer_type, customer_id, painter_id, customer_name, customer_phone,
                customer_address, items, discount_amount, notes, valid_until, status } = req.body;

        let subtotal = 0;
        for (const item of items) {
            item.line_total = Math.round(item.quantity * item.unit_price * 100) / 100;
            subtotal += item.line_total;
        }
        subtotal = Math.round(subtotal * 100) / 100;
        const grandTotal = Math.round((subtotal - discount_amount) * 100) / 100;

        await pool.query(
            `UPDATE billing_estimates SET customer_type=?, customer_id=?, painter_id=?,
             customer_name=?, customer_phone=?, customer_address=?, subtotal=?, discount_amount=?,
             grand_total=?, status=?, notes=?, valid_until=? WHERE id=?`,
            [customer_type, customer_id || null, painter_id || null, customer_name, customer_phone,
             customer_address, subtotal, discount_amount, grandTotal, status || existing[0].status,
             notes, valid_until || null, req.params.id]
        );

        // Replace items
        await pool.query('DELETE FROM billing_estimate_items WHERE estimate_id = ?', [req.params.id]);
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            await pool.query(
                `INSERT INTO billing_estimate_items
                 (estimate_id, zoho_item_id, item_name, pack_size, quantity, unit_price, line_total, display_order)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [req.params.id, item.zoho_item_id, item.item_name, item.pack_size || '',
                 item.quantity, item.unit_price, item.line_total, i + 1]
            );
        }

        res.json({ success: true, message: 'Estimate updated' });
    } catch (error) {
        console.error('Update estimate error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Delete (cancel) estimate
router.delete('/estimates/:id', estimatePerm, validateParams(idParamSchema), async (req, res) => {
    try {
        const [existing] = await pool.query('SELECT id, status FROM billing_estimates WHERE id = ?', [req.params.id]);
        if (!existing.length) return res.status(404).json({ success: false, message: 'Estimate not found' });
        if (existing[0].status === 'converted') {
            return res.status(400).json({ success: false, message: 'Cannot cancel converted estimate' });
        }

        await pool.query('UPDATE billing_estimates SET status = ? WHERE id = ?', ['cancelled', req.params.id]);
        res.json({ success: true, message: 'Estimate cancelled' });
    } catch (error) {
        console.error('Cancel estimate error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Send estimate
router.post('/estimates/:id/send', estimatePerm, validateParams(idParamSchema), async (req, res) => {
    try {
        const [existing] = await pool.query('SELECT id, status FROM billing_estimates WHERE id = ?', [req.params.id]);
        if (!existing.length) return res.status(404).json({ success: false, message: 'Estimate not found' });
        if (existing[0].status !== 'draft') {
            return res.status(400).json({ success: false, message: 'Can only send draft estimates' });
        }

        await pool.query('UPDATE billing_estimates SET status = ? WHERE id = ?', ['sent', req.params.id]);
        res.json({ success: true, message: 'Estimate sent' });
    } catch (error) {
        console.error('Send estimate error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Convert estimate to invoice
const invoicePerm = requirePermission('billing', 'invoice');

router.post('/estimates/:id/convert', invoicePerm, validateParams(idParamSchema), async (req, res) => {
    try {
        const [estimates] = await pool.query('SELECT * FROM billing_estimates WHERE id = ?', [req.params.id]);
        if (!estimates.length) return res.status(404).json({ success: false, message: 'Estimate not found' });
        const est = estimates[0];
        if (!['draft', 'sent', 'approved'].includes(est.status)) {
            return res.status(400).json({ success: false, message: 'Estimate cannot be converted in current status' });
        }
        if (est.converted_to_invoice_id) {
            return res.status(400).json({ success: false, message: 'Estimate already converted' });
        }

        const [items] = await pool.query(
            'SELECT * FROM billing_estimate_items WHERE estimate_id = ? ORDER BY display_order', [est.id]
        );

        // Create invoice
        const invoiceNumber = await generateNumber('BI', 'billing_invoices', 'invoice_number');

        const [invoiceResult] = await pool.query(
            `INSERT INTO billing_invoices
             (invoice_number, created_by, branch_id, source, estimate_id, customer_type,
              customer_id, painter_id, customer_name, customer_phone, customer_address,
              subtotal, discount_amount, grand_total, balance_due, notes)
             VALUES (?, ?, ?, 'estimate', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [invoiceNumber, req.user.id, req.user.branch_id || null, est.id,
             est.customer_type, est.customer_id, est.painter_id, est.customer_name,
             est.customer_phone, est.customer_address, est.subtotal, est.discount_amount,
             est.grand_total, est.grand_total, est.notes]
        );
        const invoiceId = invoiceResult.insertId;

        // Copy items
        for (const item of items) {
            await pool.query(
                `INSERT INTO billing_invoice_items
                 (invoice_id, zoho_item_id, item_name, pack_size, quantity, unit_price, line_total, display_order)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [invoiceId, item.zoho_item_id, item.item_name, item.pack_size,
                 item.quantity, item.unit_price, item.line_total, item.display_order]
            );
        }

        // Update estimate status
        await pool.query(
            'UPDATE billing_estimates SET status = ?, converted_to_invoice_id = ? WHERE id = ?',
            ['converted', invoiceId, est.id]
        );

        res.json({
            success: true,
            invoice: { id: invoiceId, invoice_number: invoiceNumber, grand_total: est.grand_total }
        });
    } catch (error) {
        console.error('Convert estimate error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// INVOICE ENDPOINTS
// ========================================

const createInvoiceSchema = z.object({
    customer_type: z.enum(['customer', 'painter']),
    customer_id: z.number().int().positive().optional().nullable(),
    painter_id: z.number().int().positive().optional().nullable(),
    customer_name: z.string().min(1),
    customer_phone: z.string().optional().default(''),
    customer_address: z.string().optional().default(''),
    items: z.array(estimateItemSchema).min(1),
    discount_amount: z.number().min(0).optional().default(0),
    notes: z.string().optional().default(''),
});

// Create direct invoice
router.post('/invoices', invoicePerm, validate(createInvoiceSchema), async (req, res) => {
    try {
        const { customer_type, customer_id, painter_id, customer_name, customer_phone,
                customer_address, items, discount_amount, notes } = req.body;

        const invoiceNumber = await generateNumber('BI', 'billing_invoices', 'invoice_number');

        let subtotal = 0;
        for (const item of items) {
            item.line_total = Math.round(item.quantity * item.unit_price * 100) / 100;
            subtotal += item.line_total;
        }
        subtotal = Math.round(subtotal * 100) / 100;
        const grandTotal = Math.round((subtotal - discount_amount) * 100) / 100;

        const [result] = await pool.query(
            `INSERT INTO billing_invoices
             (invoice_number, created_by, branch_id, source, customer_type, customer_id, painter_id,
              customer_name, customer_phone, customer_address, subtotal, discount_amount,
              grand_total, balance_due, notes)
             VALUES (?, ?, ?, 'direct', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [invoiceNumber, req.user.id, req.user.branch_id || null, customer_type,
             customer_id || null, painter_id || null, customer_name, customer_phone,
             customer_address, subtotal, discount_amount, grandTotal, grandTotal, notes]
        );
        const invoiceId = result.insertId;

        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            await pool.query(
                `INSERT INTO billing_invoice_items
                 (invoice_id, zoho_item_id, item_name, pack_size, quantity, unit_price, line_total, display_order)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [invoiceId, item.zoho_item_id, item.item_name, item.pack_size || '',
                 item.quantity, item.unit_price, item.line_total, i + 1]
            );
        }

        res.json({ success: true, invoice: { id: invoiceId, invoice_number: invoiceNumber, grand_total: grandTotal } });
    } catch (error) {
        console.error('Create invoice error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// List invoices
router.get('/invoices', invoicePerm, validateQuery(listQuerySchema.extend({
    payment_status: z.enum(['unpaid', 'partial', 'paid']).optional(),
    zoho_status: z.enum(['pending', 'pushed', 'failed']).optional(),
})), async (req, res) => {
    try {
        const { page, limit, status, customer_type, search, payment_status, zoho_status } = req.query;
        const branchId = getBranchFilter(req);
        const offset = (page - 1) * limit;

        let where = 'WHERE 1=1';
        const params = [];

        if (branchId) { where += ' AND bi.branch_id = ?'; params.push(branchId); }
        if (payment_status) { where += ' AND bi.payment_status = ?'; params.push(payment_status); }
        if (zoho_status) { where += ' AND bi.zoho_status = ?'; params.push(zoho_status); }
        if (customer_type) { where += ' AND bi.customer_type = ?'; params.push(customer_type); }
        if (search) {
            where += ' AND (bi.customer_name LIKE ? OR bi.invoice_number LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }

        const [countRows] = await pool.query(
            `SELECT COUNT(*) as total FROM billing_invoices bi ${where}`, params
        );
        const total = countRows[0].total;

        const [invoices] = await pool.query(
            `SELECT bi.*, u.full_name as created_by_name
             FROM billing_invoices bi
             LEFT JOIN users u ON bi.created_by = u.id
             ${where}
             ORDER BY bi.created_at DESC
             LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        res.json({ success: true, invoices, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (error) {
        console.error('List invoices error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get invoice detail
router.get('/invoices/:id', invoicePerm, validateParams(idParamSchema), async (req, res) => {
    try {
        const [invoices] = await pool.query(
            `SELECT bi.*, u.full_name as created_by_name
             FROM billing_invoices bi
             LEFT JOIN users u ON bi.created_by = u.id
             WHERE bi.id = ?`,
            [req.params.id]
        );
        if (!invoices.length) return res.status(404).json({ success: false, message: 'Invoice not found' });

        const [items] = await pool.query(
            'SELECT * FROM billing_invoice_items WHERE invoice_id = ? ORDER BY display_order',
            [req.params.id]
        );
        const [payments] = await pool.query(
            `SELECT bp.*, u.full_name as received_by_name
             FROM billing_payments bp
             LEFT JOIN users u ON bp.received_by = u.id
             WHERE bp.invoice_id = ?
             ORDER BY bp.created_at DESC`,
            [req.params.id]
        );

        res.json({ success: true, invoice: { ...invoices[0], items, payments } });
    } catch (error) {
        console.error('Get invoice error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Edit invoice (unpaid only)
router.put('/invoices/:id', invoicePerm, validateParams(idParamSchema), validate(createInvoiceSchema), async (req, res) => {
    try {
        const [existing] = await pool.query('SELECT id, payment_status, zoho_status FROM billing_invoices WHERE id = ?', [req.params.id]);
        if (!existing.length) return res.status(404).json({ success: false, message: 'Invoice not found' });
        if (existing[0].payment_status !== 'unpaid') {
            return res.status(400).json({ success: false, message: 'Can only edit unpaid invoices' });
        }
        if (existing[0].zoho_status === 'pushed') {
            return res.status(400).json({ success: false, message: 'Cannot edit pushed invoice' });
        }

        const { customer_type, customer_id, painter_id, customer_name, customer_phone,
                customer_address, items, discount_amount, notes } = req.body;

        let subtotal = 0;
        for (const item of items) {
            item.line_total = Math.round(item.quantity * item.unit_price * 100) / 100;
            subtotal += item.line_total;
        }
        subtotal = Math.round(subtotal * 100) / 100;
        const grandTotal = Math.round((subtotal - discount_amount) * 100) / 100;

        await pool.query(
            `UPDATE billing_invoices SET customer_type=?, customer_id=?, painter_id=?,
             customer_name=?, customer_phone=?, customer_address=?, subtotal=?, discount_amount=?,
             grand_total=?, balance_due=?, notes=? WHERE id=?`,
            [customer_type, customer_id || null, painter_id || null, customer_name, customer_phone,
             customer_address, subtotal, discount_amount, grandTotal, grandTotal, notes, req.params.id]
        );

        await pool.query('DELETE FROM billing_invoice_items WHERE invoice_id = ?', [req.params.id]);
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            await pool.query(
                `INSERT INTO billing_invoice_items
                 (invoice_id, zoho_item_id, item_name, pack_size, quantity, unit_price, line_total, display_order)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [req.params.id, item.zoho_item_id, item.item_name, item.pack_size || '',
                 item.quantity, item.unit_price, item.line_total, i + 1]
            );
        }

        res.json({ success: true, message: 'Invoice updated' });
    } catch (error) {
        console.error('Update invoice error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// PAYMENT ENDPOINTS
// ========================================

const paymentPerm = requirePermission('billing', 'payment');

const recordPaymentSchema = z.object({
    amount: z.number().positive(),
    payment_method: z.enum(['cash', 'upi', 'bank_transfer', 'cheque', 'credit']),
    payment_reference: z.string().optional().default(''),
    notes: z.string().optional().default(''),
});

// Record payment
router.post('/invoices/:id/payment', paymentPerm, validateParams(idParamSchema), validate(recordPaymentSchema), async (req, res) => {
    try {
        const [invoices] = await pool.query('SELECT * FROM billing_invoices WHERE id = ?', [req.params.id]);
        if (!invoices.length) return res.status(404).json({ success: false, message: 'Invoice not found' });
        const invoice = invoices[0];

        if (invoice.payment_status === 'paid') {
            return res.status(400).json({ success: false, message: 'Invoice already fully paid' });
        }
        if (invoice.zoho_status === 'pushed') {
            return res.status(400).json({ success: false, message: 'Cannot add payment to pushed invoice' });
        }

        const { amount, payment_method, payment_reference, notes } = req.body;
        const balanceDue = parseFloat(invoice.balance_due);

        if (amount > balanceDue + 0.01) {
            return res.status(400).json({ success: false, message: `Payment exceeds balance due (${balanceDue})` });
        }

        // Insert payment
        await pool.query(
            `INSERT INTO billing_payments (invoice_id, amount, payment_method, payment_reference, received_by, notes)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [invoice.id, amount, payment_method, payment_reference, req.user.id, notes]
        );

        // Update invoice totals
        const newAmountPaid = Math.round((parseFloat(invoice.amount_paid) + amount) * 100) / 100;
        const newBalanceDue = Math.round((parseFloat(invoice.grand_total) - newAmountPaid) * 100) / 100;
        const newStatus = newBalanceDue <= 0.01 ? 'paid' : 'partial';

        await pool.query(
            `UPDATE billing_invoices SET amount_paid = ?, balance_due = ?, payment_status = ? WHERE id = ?`,
            [newAmountPaid, Math.max(0, newBalanceDue), newStatus, invoice.id]
        );

        res.json({
            success: true,
            message: 'Payment recorded',
            payment: { amount_paid: newAmountPaid, balance_due: Math.max(0, newBalanceDue), payment_status: newStatus }
        });
    } catch (error) {
        console.error('Record payment error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// List payments (recent)
router.get('/payments', paymentPerm, validateQuery(listQuerySchema), async (req, res) => {
    try {
        const { page, limit } = req.query;
        const branchId = getBranchFilter(req);
        const offset = (page - 1) * limit;

        let where = 'WHERE 1=1';
        const params = [];
        if (branchId) { where += ' AND bi.branch_id = ?'; params.push(branchId); }

        const [countRows] = await pool.query(
            `SELECT COUNT(*) as total FROM billing_payments bp
             JOIN billing_invoices bi ON bp.invoice_id = bi.id ${where}`, params
        );

        const [payments] = await pool.query(
            `SELECT bp.*, bi.invoice_number, bi.customer_name, bi.grand_total,
                    u.full_name as received_by_name
             FROM billing_payments bp
             JOIN billing_invoices bi ON bp.invoice_id = bi.id
             LEFT JOIN users u ON bp.received_by = u.id
             ${where}
             ORDER BY bp.created_at DESC
             LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        res.json({ success: true, payments, pagination: { page, limit, total: countRows[0].total } });
    } catch (error) {
        console.error('List payments error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// ZOHO PUSH
// ========================================

const zohoPushPerm = requirePermission('billing', 'zoho_push');

router.post('/invoices/:id/push-zoho', zohoPushPerm, validateParams(idParamSchema), async (req, res) => {
    try {
        const result = await billingZohoService.pushInvoiceToZoho(req.params.id, req.user.id);
        res.json({ success: true, message: 'Invoice pushed to Zoho', ...result });
    } catch (error) {
        console.error('Zoho push error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// PRODUCT SEARCH
// ========================================

router.get('/products', estimatePerm, async (req, res) => {
    try {
        const search = req.query.search || '';
        const brand = req.query.brand || '';

        let where = 'WHERE zim.status = "active"';
        const params = [];

        if (search) {
            where += ' AND (zim.zoho_item_name LIKE ? OR zim.sku LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }
        if (brand) {
            where += ' AND zim.brand = ?';
            params.push(brand);
        }

        const [products] = await pool.query(
            `SELECT zim.id, zim.zoho_item_id, zim.zoho_item_name as item_name,
                    zim.sku, zim.rate, zim.brand, zim.category, zim.unit, zim.pack_size
             FROM zoho_items_map zim
             ${where}
             ORDER BY zim.zoho_item_name
             LIMIT 50`,
            params
        );

        res.json({ success: true, products });
    } catch (error) {
        console.error('Product search error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// DASHBOARD STATS
// ========================================

router.get('/stats', estimatePerm, async (req, res) => {
    try {
        const branchId = getBranchFilter(req);
        const branchWhere = branchId ? 'AND branch_id = ?' : '';
        const branchParams = branchId ? [branchId] : [];

        const today = new Date();
        const y = today.getFullYear();
        const m = String(today.getMonth() + 1).padStart(2, '0');
        const d = String(today.getDate()).padStart(2, '0');
        const todayStr = `${y}-${m}-${d}`;

        const [estimateStats] = await pool.query(
            `SELECT
                COUNT(*) as total,
                SUM(status = 'draft') as drafts,
                SUM(status = 'sent') as sent,
                SUM(status = 'converted') as converted
             FROM billing_estimates WHERE 1=1 ${branchWhere}`, branchParams
        );

        const [invoiceStats] = await pool.query(
            `SELECT
                COUNT(*) as total,
                SUM(payment_status = 'unpaid') as unpaid,
                SUM(payment_status = 'partial') as partial,
                SUM(payment_status = 'paid') as paid,
                SUM(zoho_status = 'pushed') as pushed,
                COALESCE(SUM(grand_total), 0) as total_value,
                COALESCE(SUM(amount_paid), 0) as total_collected,
                COALESCE(SUM(balance_due), 0) as total_outstanding
             FROM billing_invoices WHERE 1=1 ${branchWhere}`, branchParams
        );

        const [todayPayments] = await pool.query(
            `SELECT COALESCE(SUM(bp.amount), 0) as today_collected
             FROM billing_payments bp
             JOIN billing_invoices bi ON bp.invoice_id = bi.id
             WHERE DATE(bp.created_at) = ? ${branchWhere.replace('branch_id', 'bi.branch_id')}`,
            [todayStr, ...branchParams]
        );

        res.json({
            success: true,
            stats: {
                estimates: estimateStats[0],
                invoices: invoiceStats[0],
                today_collected: todayPayments[0].today_collected
            }
        });
    } catch (error) {
        console.error('Stats error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = { router, setPool, setPointsEngine };
```

- [ ] **Step 2: Commit**

```bash
git add routes/billing.js
git commit -m "feat(billing): add billing routes — estimates, invoices, payments, Zoho push, product search"
```

---

## Task 4: Register Routes in server.js

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Add import at top of server.js (near other route imports)**

Find the line `const paintersRoutes = require('./routes/painters');` and add below it:
```javascript
const billingRoutes = require('./routes/billing');
```

- [ ] **Step 2: Add setPool call (near other setPool calls)**

Find the line `paintersRoutes.setPool(pool);` and add below it:
```javascript
billingRoutes.setPool(pool);
billingRoutes.setPointsEngine(pointsEngine);
```

- [ ] **Step 3: Mount route (in MOUNT ROUTE MODULES section)**

Find the line `app.use('/api/painters', paintersRoutes.router);` and add below it:
```javascript
app.use('/api/billing', billingRoutes.router);
```

- [ ] **Step 4: Verify server starts**

Run: `node -e "require('./server');" &` then `curl http://localhost:PORT/api/billing/stats` (replace PORT with actual).
Or just verify no syntax errors: `node -c server.js`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat(billing): register billing routes in server.js"
```

---

## Task 5: Unit Tests

**Files:**
- Create: `tests/unit/billing.test.js`

- [ ] **Step 1: Write tests**

```javascript
// tests/unit/billing.test.js
const { z } = require('zod');

describe('Billing Schemas', () => {
    // Test the same schemas used in billing.js
    const estimateItemSchema = z.object({
        zoho_item_id: z.string().min(1),
        item_name: z.string().min(1),
        pack_size: z.string().optional().default(''),
        quantity: z.number().positive(),
        unit_price: z.number().min(0),
    });

    const createEstimateSchema = z.object({
        customer_type: z.enum(['customer', 'painter']),
        customer_id: z.number().int().positive().optional().nullable(),
        painter_id: z.number().int().positive().optional().nullable(),
        customer_name: z.string().min(1),
        customer_phone: z.string().optional().default(''),
        customer_address: z.string().optional().default(''),
        items: z.array(estimateItemSchema).min(1),
        discount_amount: z.number().min(0).optional().default(0),
        notes: z.string().optional().default(''),
        valid_until: z.string().optional().nullable(),
        status: z.enum(['draft', 'sent']).optional().default('draft'),
    });

    const recordPaymentSchema = z.object({
        amount: z.number().positive(),
        payment_method: z.enum(['cash', 'upi', 'bank_transfer', 'cheque', 'credit']),
        payment_reference: z.string().optional().default(''),
        notes: z.string().optional().default(''),
    });

    describe('Estimate Schema', () => {
        it('should accept valid customer estimate', () => {
            const result = createEstimateSchema.safeParse({
                customer_type: 'customer',
                customer_name: 'Test Customer',
                items: [{ zoho_item_id: 'Z001', item_name: 'Paint', quantity: 2, unit_price: 500 }]
            });
            expect(result.success).toBe(true);
            expect(result.data.status).toBe('draft');
            expect(result.data.discount_amount).toBe(0);
        });

        it('should accept valid painter estimate', () => {
            const result = createEstimateSchema.safeParse({
                customer_type: 'painter',
                painter_id: 5,
                customer_name: 'Painter Kumar',
                items: [{ zoho_item_id: 'Z002', item_name: 'Emulsion', quantity: 1, unit_price: 1200 }]
            });
            expect(result.success).toBe(true);
        });

        it('should reject empty items array', () => {
            const result = createEstimateSchema.safeParse({
                customer_type: 'customer',
                customer_name: 'Test',
                items: []
            });
            expect(result.success).toBe(false);
        });

        it('should reject missing customer_name', () => {
            const result = createEstimateSchema.safeParse({
                customer_type: 'customer',
                items: [{ zoho_item_id: 'Z001', item_name: 'Paint', quantity: 1, unit_price: 100 }]
            });
            expect(result.success).toBe(false);
        });

        it('should reject invalid customer_type', () => {
            const result = createEstimateSchema.safeParse({
                customer_type: 'vendor',
                customer_name: 'Test',
                items: [{ zoho_item_id: 'Z001', item_name: 'Paint', quantity: 1, unit_price: 100 }]
            });
            expect(result.success).toBe(false);
        });

        it('should reject negative quantity', () => {
            const result = createEstimateSchema.safeParse({
                customer_type: 'customer',
                customer_name: 'Test',
                items: [{ zoho_item_id: 'Z001', item_name: 'Paint', quantity: -1, unit_price: 100 }]
            });
            expect(result.success).toBe(false);
        });
    });

    describe('Payment Schema', () => {
        it('should accept valid cash payment', () => {
            const result = recordPaymentSchema.safeParse({
                amount: 1500,
                payment_method: 'cash'
            });
            expect(result.success).toBe(true);
        });

        it('should accept UPI with reference', () => {
            const result = recordPaymentSchema.safeParse({
                amount: 2000,
                payment_method: 'upi',
                payment_reference: 'UPI123456'
            });
            expect(result.success).toBe(true);
        });

        it('should reject zero amount', () => {
            const result = recordPaymentSchema.safeParse({
                amount: 0,
                payment_method: 'cash'
            });
            expect(result.success).toBe(false);
        });

        it('should reject invalid payment method', () => {
            const result = recordPaymentSchema.safeParse({
                amount: 100,
                payment_method: 'bitcoin'
            });
            expect(result.success).toBe(false);
        });
    });
});

describe('Billing Calculations', () => {
    function calculateTotals(items, discountAmount = 0) {
        let subtotal = 0;
        for (const item of items) {
            item.line_total = Math.round(item.quantity * item.unit_price * 100) / 100;
            subtotal += item.line_total;
        }
        subtotal = Math.round(subtotal * 100) / 100;
        const grandTotal = Math.round((subtotal - discountAmount) * 100) / 100;
        return { subtotal, grandTotal };
    }

    it('should calculate simple total', () => {
        const items = [{ quantity: 2, unit_price: 500 }];
        const { subtotal, grandTotal } = calculateTotals(items);
        expect(subtotal).toBe(1000);
        expect(grandTotal).toBe(1000);
    });

    it('should calculate with discount', () => {
        const items = [{ quantity: 3, unit_price: 1000 }];
        const { subtotal, grandTotal } = calculateTotals(items, 500);
        expect(subtotal).toBe(3000);
        expect(grandTotal).toBe(2500);
    });

    it('should handle multiple items', () => {
        const items = [
            { quantity: 2, unit_price: 500 },
            { quantity: 1, unit_price: 1200 },
            { quantity: 5, unit_price: 300 }
        ];
        const { subtotal, grandTotal } = calculateTotals(items);
        expect(subtotal).toBe(3700);
        expect(grandTotal).toBe(3700);
    });

    it('should handle decimal quantities', () => {
        const items = [{ quantity: 2.5, unit_price: 400 }];
        const { subtotal, grandTotal } = calculateTotals(items);
        expect(subtotal).toBe(1000);
        expect(grandTotal).toBe(1000);
    });

    it('should round correctly', () => {
        const items = [{ quantity: 3, unit_price: 33.33 }];
        const { subtotal } = calculateTotals(items);
        expect(subtotal).toBe(99.99);
    });
});
```

- [ ] **Step 2: Run tests**

Run: `npx jest tests/unit/billing.test.js --verbose`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/billing.test.js
git commit -m "test(billing): add unit tests for billing schemas and calculations"
```

---

## Task 6: Staff Billing UI — HTML Page

**Files:**
- Create: `public/staff-billing.html`

- [ ] **Step 1: Write the full HTML page**

```html
<!DOCTYPE html>
<html lang="ta">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="theme-color" content="#1B5E3B">
    <meta name="apple-mobile-web-app-capable" content="yes">
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
    <link rel="manifest" href="/manifest.json">
    <link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192x192.png">
    <title>Billing - QC Paint Shop</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <link rel="stylesheet" href="/css/design-system.css">
    <script src="/universal-nav-loader.js"></script>
    <script src="/js/auth-helper.js"></script>
    <script>checkAuthOrRedirect();</script>
    <style>
        .tab-active { border-bottom: 3px solid #1B5E3B; color: #1B5E3B; font-weight: 600; }
        .tab-inactive { border-bottom: 3px solid transparent; color: #6b7280; }
        .tab-btn { padding: 12px 20px; cursor: pointer; transition: all 0.2s; }
        .tab-btn:hover { color: #1B5E3B; }

        .status-draft { background: #f3f4f6; color: #374151; }
        .status-sent { background: #dbeafe; color: #1d4ed8; }
        .status-approved { background: #d1fae5; color: #065f46; }
        .status-converted { background: #ede9fe; color: #5b21b6; }
        .status-cancelled { background: #fee2e2; color: #991b1b; }
        .status-unpaid { background: #fee2e2; color: #991b1b; }
        .status-partial { background: #fef3c7; color: #92400e; }
        .status-paid { background: #d1fae5; color: #065f46; }
        .status-pending { background: #fef3c7; color: #92400e; }
        .status-pushed { background: #d1fae5; color: #065f46; }

        .product-row { transition: background 0.15s; }
        .product-row:hover { background: #f9fafb; }

        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 50; display: none; }
        .modal-overlay.active { display: flex; }
        .modal-content { background: white; border-radius: 16px; max-width: 700px; width: 95%; max-height: 90vh; overflow-y: auto; }

        .skeleton { background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 8px; }
        @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    </style>
</head>
<body class="bg-gray-50 min-h-screen" data-page="billing">

<!-- Stats Cards -->
<div class="max-w-7xl mx-auto px-4 pt-4 pb-2">
    <div class="grid grid-cols-2 md:grid-cols-4 gap-3" id="statsCards">
        <div class="qc-card-sm bg-white">
            <div class="text-xs text-gray-500">Today Collection</div>
            <div class="text-xl font-bold text-green-700" id="statTodayCollection">--</div>
        </div>
        <div class="qc-card-sm bg-white">
            <div class="text-xs text-gray-500">Invoices</div>
            <div class="text-xl font-bold text-blue-700" id="statInvoiceCount">--</div>
        </div>
        <div class="qc-card-sm bg-white">
            <div class="text-xs text-gray-500">Outstanding</div>
            <div class="text-xl font-bold text-red-600" id="statOutstanding">--</div>
        </div>
        <div class="qc-card-sm bg-white">
            <div class="text-xs text-gray-500">Estimates</div>
            <div class="text-xl font-bold text-purple-700" id="statEstimateCount">--</div>
        </div>
    </div>
</div>

<!-- Tabs -->
<div class="max-w-7xl mx-auto px-4">
    <div class="flex border-b border-gray-200 bg-white rounded-t-xl mt-2">
        <button class="tab-btn tab-active" data-tab="estimates" onclick="switchTab('estimates')">Estimates</button>
        <button class="tab-btn tab-inactive" data-tab="invoices" onclick="switchTab('invoices')">Invoices</button>
        <button class="tab-btn tab-inactive" data-tab="payments" onclick="switchTab('payments')">Payments</button>
    </div>
</div>

<!-- Tab Content -->
<div class="max-w-7xl mx-auto px-4 pb-24">
    <!-- Estimates Tab -->
    <div id="tab-estimates" class="tab-content bg-white rounded-b-xl shadow-sm p-4">
        <div class="flex justify-between items-center mb-4">
            <input type="text" id="estimateSearch" placeholder="Search estimates..."
                   class="qc-input w-48 md:w-64" oninput="debounceEstimateSearch()">
            <button class="qc-btn qc-btn-primary text-sm" onclick="openCreateModal('estimate')">+ New Estimate</button>
        </div>
        <div id="estimateList" class="space-y-2"></div>
        <div id="estimatePagination" class="flex justify-center mt-4 gap-2"></div>
    </div>

    <!-- Invoices Tab -->
    <div id="tab-invoices" class="tab-content bg-white rounded-b-xl shadow-sm p-4 hidden">
        <div class="flex flex-wrap justify-between items-center mb-4 gap-2">
            <input type="text" id="invoiceSearch" placeholder="Search invoices..."
                   class="qc-input w-48 md:w-64" oninput="debounceInvoiceSearch()">
            <div class="flex gap-2">
                <select id="invoicePaymentFilter" class="qc-input w-28 text-sm" onchange="loadInvoices()">
                    <option value="">All Status</option>
                    <option value="unpaid">Unpaid</option>
                    <option value="partial">Partial</option>
                    <option value="paid">Paid</option>
                </select>
                <button class="qc-btn qc-btn-primary text-sm" onclick="openCreateModal('invoice')">+ New Invoice</button>
            </div>
        </div>
        <div id="invoiceList" class="space-y-2"></div>
        <div id="invoicePagination" class="flex justify-center mt-4 gap-2"></div>
    </div>

    <!-- Payments Tab -->
    <div id="tab-payments" class="tab-content bg-white rounded-b-xl shadow-sm p-4 hidden">
        <div class="flex justify-between items-center mb-4">
            <h3 class="text-lg font-semibold text-gray-800">Recent Payments</h3>
        </div>
        <div id="paymentList" class="space-y-2"></div>
        <div id="paymentPagination" class="flex justify-center mt-4 gap-2"></div>
    </div>
</div>

<!-- Create/Edit Modal -->
<div class="modal-overlay" id="createModal">
    <div class="modal-content m-auto p-6">
        <div class="flex justify-between items-center mb-4">
            <h2 class="text-lg font-bold text-gray-800" id="modalTitle">New Estimate</h2>
            <button onclick="closeCreateModal()" class="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
        </div>

        <form id="createForm" onsubmit="handleFormSubmit(event)">
            <input type="hidden" id="formMode" value="estimate">
            <input type="hidden" id="formEditId" value="">

            <!-- Customer Type -->
            <div class="mb-4">
                <label class="qc-label mb-1 block">Type</label>
                <div class="flex gap-3">
                    <label class="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="customer_type" value="customer" checked onchange="onCustomerTypeChange()">
                        <span class="text-sm">Customer</span>
                    </label>
                    <label class="flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="customer_type" value="painter" onchange="onCustomerTypeChange()">
                        <span class="text-sm">Painter</span>
                    </label>
                </div>
            </div>

            <!-- Customer Search -->
            <div id="customerSection">
                <div class="mb-4">
                    <label class="qc-label mb-1 block">Customer Name *</label>
                    <input type="text" id="customerName" class="qc-input" required placeholder="Search or enter new...">
                    <div id="customerSuggestions" class="absolute bg-white shadow-lg rounded-lg mt-1 z-10 hidden max-h-40 overflow-y-auto w-full"></div>
                </div>
                <div class="grid grid-cols-2 gap-3 mb-4">
                    <div>
                        <label class="qc-label mb-1 block">Phone</label>
                        <input type="text" id="customerPhone" class="qc-input" placeholder="Phone">
                    </div>
                    <div>
                        <label class="qc-label mb-1 block">Address</label>
                        <input type="text" id="customerAddress" class="qc-input" placeholder="Address">
                    </div>
                </div>
            </div>

            <!-- Painter Search (hidden by default) -->
            <div id="painterSection" class="hidden mb-4">
                <label class="qc-label mb-1 block">Painter *</label>
                <input type="text" id="painterSearch" class="qc-input" placeholder="Search painter...">
                <input type="hidden" id="selectedPainterId" value="">
                <div id="painterSuggestions" class="absolute bg-white shadow-lg rounded-lg mt-1 z-10 hidden max-h-40 overflow-y-auto w-full"></div>
            </div>

            <!-- Product Search -->
            <div class="mb-4">
                <label class="qc-label mb-1 block">Add Products</label>
                <input type="text" id="productSearch" class="qc-input" placeholder="Search products..." oninput="debounceProductSearch()">
                <div id="productSuggestions" class="bg-white shadow-lg rounded-lg mt-1 z-10 hidden max-h-48 overflow-y-auto border"></div>
            </div>

            <!-- Items Table -->
            <div class="mb-4 overflow-x-auto">
                <table class="w-full text-sm">
                    <thead class="bg-gray-50">
                        <tr>
                            <th class="p-2 text-left">Product</th>
                            <th class="p-2 text-center w-20">Qty</th>
                            <th class="p-2 text-right w-24">Rate</th>
                            <th class="p-2 text-right w-24">Total</th>
                            <th class="p-2 w-10"></th>
                        </tr>
                    </thead>
                    <tbody id="itemsTable"></tbody>
                </table>
                <div id="noItemsMsg" class="text-center text-gray-400 py-4 text-sm">No items added yet</div>
            </div>

            <!-- Totals -->
            <div class="border-t pt-3 mb-4 space-y-1">
                <div class="flex justify-between text-sm">
                    <span class="text-gray-600">Subtotal</span>
                    <span id="subtotalDisplay" class="font-medium">0.00</span>
                </div>
                <div class="flex justify-between text-sm items-center">
                    <span class="text-gray-600">Discount</span>
                    <input type="number" id="discountAmount" class="qc-input w-24 text-right text-sm p-1" value="0" min="0" step="0.01" oninput="recalcTotals()">
                </div>
                <div class="flex justify-between text-base font-bold border-t pt-2">
                    <span>Grand Total</span>
                    <span id="grandTotalDisplay">0.00</span>
                </div>
            </div>

            <!-- Notes -->
            <div class="mb-4">
                <label class="qc-label mb-1 block">Notes</label>
                <textarea id="formNotes" class="qc-input" rows="2" placeholder="Optional notes..."></textarea>
            </div>

            <!-- Actions -->
            <div class="flex gap-2 justify-end">
                <button type="button" onclick="closeCreateModal()" class="qc-btn qc-btn-ghost">Cancel</button>
                <button type="submit" id="formSaveDraft" class="qc-btn bg-gray-600 text-white" data-action="draft">Save Draft</button>
                <button type="submit" id="formSubmit" class="qc-btn qc-btn-primary" data-action="submit">
                    <span id="formSubmitLabel">Send Estimate</span>
                </button>
            </div>
        </form>
    </div>
</div>

<!-- Payment Modal -->
<div class="modal-overlay" id="paymentModal">
    <div class="modal-content m-auto p-6" style="max-width: 400px;">
        <div class="flex justify-between items-center mb-4">
            <h2 class="text-lg font-bold text-gray-800">Record Payment</h2>
            <button onclick="closePaymentModal()" class="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
        </div>
        <div class="mb-3">
            <div class="text-sm text-gray-500">Invoice: <span id="payInvoiceNum" class="font-medium text-gray-800"></span></div>
            <div class="text-sm text-gray-500">Balance Due: <span id="payBalanceDue" class="font-bold text-red-600"></span></div>
        </div>
        <form onsubmit="handlePaymentSubmit(event)">
            <input type="hidden" id="payInvoiceId" value="">
            <div class="mb-3">
                <label class="qc-label mb-1 block">Amount *</label>
                <input type="number" id="payAmount" class="qc-input" required min="0.01" step="0.01">
            </div>
            <div class="mb-3">
                <label class="qc-label mb-1 block">Method *</label>
                <select id="payMethod" class="qc-input" required>
                    <option value="cash">Cash</option>
                    <option value="upi">UPI</option>
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="cheque">Cheque</option>
                    <option value="credit">Credit</option>
                </select>
            </div>
            <div class="mb-3">
                <label class="qc-label mb-1 block">Reference</label>
                <input type="text" id="payReference" class="qc-input" placeholder="UPI ref / cheque no">
            </div>
            <div class="flex gap-2 justify-end">
                <button type="button" onclick="closePaymentModal()" class="qc-btn qc-btn-ghost">Cancel</button>
                <button type="submit" class="qc-btn qc-btn-primary">Record Payment</button>
            </div>
        </form>
    </div>
</div>

<!-- Invoice Detail Modal -->
<div class="modal-overlay" id="detailModal">
    <div class="modal-content m-auto p-6">
        <div class="flex justify-between items-center mb-4">
            <h2 class="text-lg font-bold text-gray-800" id="detailTitle">Invoice Detail</h2>
            <button onclick="closeDetailModal()" class="text-gray-400 hover:text-gray-600 text-2xl">&times;</button>
        </div>
        <div id="detailContent"></div>
    </div>
</div>

<script>
const API = '/api/billing';
const token = localStorage.getItem('auth_token');
const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

let currentItems = [];
let currentTab = 'estimates';
let searchTimers = {};

// ========================================
// TAB SWITCHING
// ========================================

function switchTab(tab) {
    currentTab = tab;
    document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.toggle('tab-active', b.dataset.tab === tab);
        b.classList.toggle('tab-inactive', b.dataset.tab !== tab);
    });
    document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
    document.getElementById(`tab-${tab}`).classList.remove('hidden');

    if (tab === 'estimates') loadEstimates();
    else if (tab === 'invoices') loadInvoices();
    else if (tab === 'payments') loadPayments();
}

// ========================================
// STATS
// ========================================

async function loadStats() {
    try {
        const res = await fetch(`${API}/stats`, { headers });
        const data = await res.json();
        if (!data.success) return;
        const s = data.stats;
        document.getElementById('statTodayCollection').textContent = formatCurrency(s.today_collected);
        document.getElementById('statInvoiceCount').textContent = s.invoices.total || 0;
        document.getElementById('statOutstanding').textContent = formatCurrency(s.invoices.total_outstanding);
        document.getElementById('statEstimateCount').textContent = s.estimates.total || 0;
    } catch (e) { console.error('Stats error:', e); }
}

// ========================================
// ESTIMATES
// ========================================

let estimatePage = 1;

function debounceEstimateSearch() {
    clearTimeout(searchTimers.estimate);
    searchTimers.estimate = setTimeout(() => { estimatePage = 1; loadEstimates(); }, 300);
}

async function loadEstimates() {
    const search = document.getElementById('estimateSearch').value;
    try {
        const res = await fetch(`${API}/estimates?page=${estimatePage}&limit=15&search=${encodeURIComponent(search)}`, { headers });
        const data = await res.json();
        if (!data.success) return;

        const container = document.getElementById('estimateList');
        if (!data.estimates.length) {
            container.innerHTML = '<div class="text-center text-gray-400 py-8">No estimates found</div>';
            document.getElementById('estimatePagination').innerHTML = '';
            return;
        }

        container.innerHTML = data.estimates.map(e => `
            <div class="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50 cursor-pointer" onclick="viewEstimate(${e.id})">
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2">
                        <span class="font-medium text-sm">${e.estimate_number}</span>
                        <span class="px-2 py-0.5 rounded-full text-xs status-${e.status}">${e.status}</span>
                    </div>
                    <div class="text-sm text-gray-600 truncate">${e.customer_name}</div>
                    <div class="text-xs text-gray-400">${e.created_by_name || ''} &middot; ${formatDate(e.created_at)}</div>
                </div>
                <div class="text-right ml-3">
                    <div class="font-bold text-sm">${formatCurrency(e.grand_total)}</div>
                    ${e.status === 'draft' || e.status === 'sent' ? `<button class="text-xs text-green-700 font-medium mt-1" onclick="event.stopPropagation(); convertEstimate(${e.id})">Convert &rarr;</button>` : ''}
                </div>
            </div>
        `).join('');

        renderPagination('estimatePagination', data.pagination, (p) => { estimatePage = p; loadEstimates(); });
    } catch (e) { console.error('Load estimates error:', e); }
}

async function viewEstimate(id) {
    try {
        const res = await fetch(`${API}/estimates/${id}`, { headers });
        const data = await res.json();
        if (!data.success) return;
        const e = data.estimate;

        document.getElementById('detailTitle').textContent = `Estimate ${e.estimate_number}`;
        document.getElementById('detailContent').innerHTML = `
            <div class="space-y-3">
                <div class="flex justify-between">
                    <span class="text-sm text-gray-500">Customer</span>
                    <span class="font-medium">${e.customer_name} ${e.customer_phone ? `(${e.customer_phone})` : ''}</span>
                </div>
                <div class="flex justify-between">
                    <span class="text-sm text-gray-500">Status</span>
                    <span class="px-2 py-0.5 rounded-full text-xs status-${e.status}">${e.status}</span>
                </div>
                <div class="border-t pt-2">
                    <table class="w-full text-sm">
                        <thead class="bg-gray-50"><tr><th class="p-2 text-left">Item</th><th class="p-2 text-center">Qty</th><th class="p-2 text-right">Rate</th><th class="p-2 text-right">Total</th></tr></thead>
                        <tbody>${e.items.map(i => `<tr class="border-t"><td class="p-2">${i.item_name}</td><td class="p-2 text-center">${i.quantity}</td><td class="p-2 text-right">${formatCurrency(i.unit_price)}</td><td class="p-2 text-right">${formatCurrency(i.line_total)}</td></tr>`).join('')}</tbody>
                    </table>
                </div>
                <div class="border-t pt-2 space-y-1">
                    <div class="flex justify-between text-sm"><span>Subtotal</span><span>${formatCurrency(e.subtotal)}</span></div>
                    ${parseFloat(e.discount_amount) > 0 ? `<div class="flex justify-between text-sm"><span>Discount</span><span>-${formatCurrency(e.discount_amount)}</span></div>` : ''}
                    <div class="flex justify-between font-bold"><span>Grand Total</span><span>${formatCurrency(e.grand_total)}</span></div>
                </div>
                <div class="flex gap-2 pt-2">
                    ${['draft','sent'].includes(e.status) ? `<button class="qc-btn qc-btn-primary text-sm flex-1" onclick="editEstimate(${e.id}); closeDetailModal();">Edit</button>` : ''}
                    ${['draft','sent','approved'].includes(e.status) && !e.converted_to_invoice_id ? `<button class="qc-btn bg-green-700 text-white text-sm flex-1" onclick="convertEstimate(${e.id}); closeDetailModal();">Convert to Invoice</button>` : ''}
                    ${e.status === 'draft' ? `<button class="qc-btn qc-btn-danger text-sm" onclick="cancelEstimate(${e.id}); closeDetailModal();">Cancel</button>` : ''}
                </div>
            </div>
        `;
        document.getElementById('detailModal').classList.add('active');
    } catch (e) { console.error('View estimate error:', e); }
}

async function convertEstimate(id) {
    if (!confirm('Convert this estimate to invoice?')) return;
    try {
        const res = await fetch(`${API}/estimates/${id}/convert`, { method: 'POST', headers });
        const data = await res.json();
        if (data.success) {
            showToast(`Invoice ${data.invoice.invoice_number} created`);
            loadEstimates();
            loadStats();
        } else { showToast(data.message, 'error'); }
    } catch (e) { showToast('Error converting estimate', 'error'); }
}

async function cancelEstimate(id) {
    if (!confirm('Cancel this estimate?')) return;
    try {
        const res = await fetch(`${API}/estimates/${id}`, { method: 'DELETE', headers });
        const data = await res.json();
        if (data.success) { showToast('Estimate cancelled'); loadEstimates(); loadStats(); }
        else showToast(data.message, 'error');
    } catch (e) { showToast('Error', 'error'); }
}

// ========================================
// INVOICES
// ========================================

let invoicePage = 1;

function debounceInvoiceSearch() {
    clearTimeout(searchTimers.invoice);
    searchTimers.invoice = setTimeout(() => { invoicePage = 1; loadInvoices(); }, 300);
}

async function loadInvoices() {
    const search = document.getElementById('invoiceSearch').value;
    const paymentStatus = document.getElementById('invoicePaymentFilter').value;
    try {
        let url = `${API}/invoices?page=${invoicePage}&limit=15&search=${encodeURIComponent(search)}`;
        if (paymentStatus) url += `&payment_status=${paymentStatus}`;

        const res = await fetch(url, { headers });
        const data = await res.json();
        if (!data.success) return;

        const container = document.getElementById('invoiceList');
        if (!data.invoices.length) {
            container.innerHTML = '<div class="text-center text-gray-400 py-8">No invoices found</div>';
            document.getElementById('invoicePagination').innerHTML = '';
            return;
        }

        container.innerHTML = data.invoices.map(inv => `
            <div class="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50 cursor-pointer" onclick="viewInvoice(${inv.id})">
                <div class="flex-1 min-w-0">
                    <div class="flex items-center gap-2 flex-wrap">
                        <span class="font-medium text-sm">${inv.invoice_number}</span>
                        <span class="px-2 py-0.5 rounded-full text-xs status-${inv.payment_status}">${inv.payment_status}</span>
                        <span class="px-2 py-0.5 rounded-full text-xs status-${inv.zoho_status}">Zoho: ${inv.zoho_status}</span>
                    </div>
                    <div class="text-sm text-gray-600 truncate">${inv.customer_name}</div>
                    <div class="text-xs text-gray-400">${inv.created_by_name || ''} &middot; ${formatDate(inv.created_at)}</div>
                </div>
                <div class="text-right ml-3">
                    <div class="font-bold text-sm">${formatCurrency(inv.grand_total)}</div>
                    ${parseFloat(inv.balance_due) > 0 ? `<div class="text-xs text-red-600">Due: ${formatCurrency(inv.balance_due)}</div>` : ''}
                </div>
            </div>
        `).join('');

        renderPagination('invoicePagination', data.pagination, (p) => { invoicePage = p; loadInvoices(); });
    } catch (e) { console.error('Load invoices error:', e); }
}

async function viewInvoice(id) {
    try {
        const res = await fetch(`${API}/invoices/${id}`, { headers });
        const data = await res.json();
        if (!data.success) return;
        const inv = data.invoice;

        let paymentsHtml = '';
        if (inv.payments && inv.payments.length) {
            paymentsHtml = `
                <div class="border-t pt-2 mt-2">
                    <div class="text-sm font-medium mb-1">Payments</div>
                    ${inv.payments.map(p => `
                        <div class="flex justify-between text-sm py-1 border-b border-gray-100">
                            <span>${formatCurrency(p.amount)} (${p.payment_method}) ${p.payment_reference ? '- ' + p.payment_reference : ''}</span>
                            <span class="text-gray-400">${formatDate(p.created_at)}</span>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        document.getElementById('detailTitle').textContent = `Invoice ${inv.invoice_number}`;
        document.getElementById('detailContent').innerHTML = `
            <div class="space-y-3">
                <div class="flex justify-between"><span class="text-sm text-gray-500">Customer</span><span class="font-medium">${inv.customer_name}</span></div>
                <div class="flex justify-between"><span class="text-sm text-gray-500">Payment</span><span class="px-2 py-0.5 rounded-full text-xs status-${inv.payment_status}">${inv.payment_status}</span></div>
                <div class="flex justify-between"><span class="text-sm text-gray-500">Zoho</span><span class="px-2 py-0.5 rounded-full text-xs status-${inv.zoho_status}">${inv.zoho_status}</span></div>
                ${inv.zoho_invoice_number ? `<div class="flex justify-between"><span class="text-sm text-gray-500">Zoho #</span><span>${inv.zoho_invoice_number}</span></div>` : ''}
                <div class="border-t pt-2">
                    <table class="w-full text-sm">
                        <thead class="bg-gray-50"><tr><th class="p-2 text-left">Item</th><th class="p-2 text-center">Qty</th><th class="p-2 text-right">Rate</th><th class="p-2 text-right">Total</th></tr></thead>
                        <tbody>${inv.items.map(i => `<tr class="border-t"><td class="p-2">${i.item_name}</td><td class="p-2 text-center">${i.quantity}</td><td class="p-2 text-right">${formatCurrency(i.unit_price)}</td><td class="p-2 text-right">${formatCurrency(i.line_total)}</td></tr>`).join('')}</tbody>
                    </table>
                </div>
                <div class="border-t pt-2 space-y-1">
                    <div class="flex justify-between text-sm"><span>Subtotal</span><span>${formatCurrency(inv.subtotal)}</span></div>
                    ${parseFloat(inv.discount_amount) > 0 ? `<div class="flex justify-between text-sm"><span>Discount</span><span>-${formatCurrency(inv.discount_amount)}</span></div>` : ''}
                    <div class="flex justify-between font-bold"><span>Grand Total</span><span>${formatCurrency(inv.grand_total)}</span></div>
                    <div class="flex justify-between text-sm text-green-700"><span>Paid</span><span>${formatCurrency(inv.amount_paid)}</span></div>
                    ${parseFloat(inv.balance_due) > 0 ? `<div class="flex justify-between text-sm text-red-600 font-medium"><span>Balance Due</span><span>${formatCurrency(inv.balance_due)}</span></div>` : ''}
                </div>
                ${paymentsHtml}
                <div class="flex gap-2 pt-2 flex-wrap">
                    ${inv.payment_status !== 'paid' && inv.zoho_status !== 'pushed' ? `<button class="qc-btn bg-green-700 text-white text-sm flex-1" onclick="openPaymentModal(${inv.id}, '${inv.invoice_number}', ${inv.balance_due}); closeDetailModal();">Record Payment</button>` : ''}
                    ${inv.zoho_status === 'pending' ? `<button class="qc-btn bg-blue-700 text-white text-sm flex-1" onclick="pushToZoho(${inv.id}); closeDetailModal();">Push to Zoho</button>` : ''}
                    ${inv.payment_status === 'unpaid' && inv.zoho_status !== 'pushed' ? `<button class="qc-btn qc-btn-outline text-sm" onclick="editInvoice(${inv.id}); closeDetailModal();">Edit</button>` : ''}
                </div>
            </div>
        `;
        document.getElementById('detailModal').classList.add('active');
    } catch (e) { console.error('View invoice error:', e); }
}

// ========================================
// PAYMENTS
// ========================================

let paymentPage = 1;

async function loadPayments() {
    try {
        const res = await fetch(`${API}/payments?page=${paymentPage}&limit=20`, { headers });
        const data = await res.json();
        if (!data.success) return;

        const container = document.getElementById('paymentList');
        if (!data.payments.length) {
            container.innerHTML = '<div class="text-center text-gray-400 py-8">No payments recorded</div>';
            return;
        }

        container.innerHTML = data.payments.map(p => `
            <div class="flex items-center justify-between p-3 border rounded-lg">
                <div class="flex-1">
                    <div class="font-medium text-sm text-green-700">${formatCurrency(p.amount)}</div>
                    <div class="text-sm text-gray-600">${p.invoice_number} - ${p.customer_name}</div>
                    <div class="text-xs text-gray-400">${p.payment_method}${p.payment_reference ? ' - ' + p.payment_reference : ''} &middot; ${p.received_by_name || ''}</div>
                </div>
                <div class="text-xs text-gray-400">${formatDate(p.created_at)}</div>
            </div>
        `).join('');

        renderPagination('paymentPagination', data.pagination, (p) => { paymentPage = p; loadPayments(); });
    } catch (e) { console.error('Load payments error:', e); }
}

// ========================================
// PAYMENT MODAL
// ========================================

function openPaymentModal(invoiceId, invoiceNum, balanceDue) {
    document.getElementById('payInvoiceId').value = invoiceId;
    document.getElementById('payInvoiceNum').textContent = invoiceNum;
    document.getElementById('payBalanceDue').textContent = formatCurrency(balanceDue);
    document.getElementById('payAmount').value = balanceDue;
    document.getElementById('payAmount').max = balanceDue;
    document.getElementById('paymentModal').classList.add('active');
}

function closePaymentModal() { document.getElementById('paymentModal').classList.remove('active'); }

async function handlePaymentSubmit(e) {
    e.preventDefault();
    const invoiceId = document.getElementById('payInvoiceId').value;
    const body = {
        amount: parseFloat(document.getElementById('payAmount').value),
        payment_method: document.getElementById('payMethod').value,
        payment_reference: document.getElementById('payReference').value,
        notes: ''
    };

    try {
        const res = await fetch(`${API}/invoices/${invoiceId}/payment`, {
            method: 'POST', headers, body: JSON.stringify(body)
        });
        const data = await res.json();
        if (data.success) {
            showToast('Payment recorded');
            closePaymentModal();
            loadInvoices();
            loadPayments();
            loadStats();
        } else { showToast(data.message, 'error'); }
    } catch (e) { showToast('Error recording payment', 'error'); }
}

// ========================================
// ZOHO PUSH
// ========================================

async function pushToZoho(invoiceId) {
    if (!confirm('Push this invoice to Zoho Books?')) return;
    try {
        const res = await fetch(`${API}/invoices/${invoiceId}/push-zoho`, { method: 'POST', headers });
        const data = await res.json();
        if (data.success) {
            showToast(`Pushed to Zoho: ${data.zohoInvoiceNumber}`);
            loadInvoices();
            loadStats();
        } else { showToast(data.message, 'error'); }
    } catch (e) { showToast('Error pushing to Zoho', 'error'); }
}

// ========================================
// CREATE/EDIT MODAL
// ========================================

function openCreateModal(mode, editData = null) {
    currentItems = [];
    document.getElementById('formMode').value = mode;
    document.getElementById('formEditId').value = '';
    document.getElementById('modalTitle').textContent = mode === 'estimate' ? 'New Estimate' : 'New Invoice';

    // Show/hide draft button
    document.getElementById('formSaveDraft').style.display = mode === 'estimate' ? '' : 'none';
    document.getElementById('formSubmitLabel').textContent = mode === 'estimate' ? 'Send Estimate' : 'Create Invoice';

    // Reset form
    document.getElementById('customerName').value = '';
    document.getElementById('customerPhone').value = '';
    document.getElementById('customerAddress').value = '';
    document.getElementById('painterSearch').value = '';
    document.getElementById('selectedPainterId').value = '';
    document.getElementById('productSearch').value = '';
    document.getElementById('discountAmount').value = '0';
    document.getElementById('formNotes').value = '';
    document.querySelector('input[name="customer_type"][value="customer"]').checked = true;
    onCustomerTypeChange();

    if (editData) {
        document.getElementById('formEditId').value = editData.id;
        document.getElementById('modalTitle').textContent = `Edit ${mode === 'estimate' ? 'Estimate' : 'Invoice'} #${editData.id}`;
        document.getElementById('customerName').value = editData.customer_name || '';
        document.getElementById('customerPhone').value = editData.customer_phone || '';
        document.getElementById('customerAddress').value = editData.customer_address || '';
        document.getElementById('discountAmount').value = editData.discount_amount || 0;
        document.getElementById('formNotes').value = editData.notes || '';

        if (editData.customer_type === 'painter') {
            document.querySelector('input[name="customer_type"][value="painter"]').checked = true;
            document.getElementById('selectedPainterId').value = editData.painter_id || '';
            document.getElementById('painterSearch').value = editData.customer_name || '';
            onCustomerTypeChange();
        }

        currentItems = (editData.items || []).map(i => ({
            zoho_item_id: i.zoho_item_id,
            item_name: i.item_name,
            pack_size: i.pack_size || '',
            quantity: parseFloat(i.quantity),
            unit_price: parseFloat(i.unit_price)
        }));
    }

    renderItems();
    document.getElementById('createModal').classList.add('active');
}

function closeCreateModal() { document.getElementById('createModal').classList.remove('active'); }

function onCustomerTypeChange() {
    const type = document.querySelector('input[name="customer_type"]:checked').value;
    document.getElementById('customerSection').classList.toggle('hidden', type === 'painter');
    document.getElementById('painterSection').classList.toggle('hidden', type !== 'painter');
}

async function editEstimate(id) {
    const res = await fetch(`${API}/estimates/${id}`, { headers });
    const data = await res.json();
    if (data.success) openCreateModal('estimate', data.estimate);
}

async function editInvoice(id) {
    const res = await fetch(`${API}/invoices/${id}`, { headers });
    const data = await res.json();
    if (data.success) openCreateModal('invoice', data.invoice);
}

// ========================================
// PRODUCT SEARCH
// ========================================

function debounceProductSearch() {
    clearTimeout(searchTimers.product);
    searchTimers.product = setTimeout(searchProducts, 300);
}

async function searchProducts() {
    const q = document.getElementById('productSearch').value.trim();
    const container = document.getElementById('productSuggestions');
    if (q.length < 2) { container.classList.add('hidden'); return; }

    try {
        const res = await fetch(`${API}/products?search=${encodeURIComponent(q)}`, { headers });
        const data = await res.json();
        if (!data.success || !data.products.length) {
            container.innerHTML = '<div class="p-3 text-gray-400 text-sm">No products found</div>';
            container.classList.remove('hidden');
            return;
        }

        container.innerHTML = data.products.map(p => `
            <div class="p-2 hover:bg-green-50 cursor-pointer product-row text-sm border-b" onclick='addProduct(${JSON.stringify(p).replace(/'/g, "&#39;")})'>
                <div class="font-medium">${p.item_name}</div>
                <div class="text-xs text-gray-500">${p.pack_size || ''} ${p.brand || ''} &middot; Rate: ${formatCurrency(p.rate)}</div>
            </div>
        `).join('');
        container.classList.remove('hidden');
    } catch (e) { console.error('Product search error:', e); }
}

function addProduct(p) {
    currentItems.push({
        zoho_item_id: p.zoho_item_id,
        item_name: p.item_name,
        pack_size: p.pack_size || '',
        quantity: 1,
        unit_price: parseFloat(p.rate) || 0
    });
    renderItems();
    document.getElementById('productSearch').value = '';
    document.getElementById('productSuggestions').classList.add('hidden');
}

function removeItem(idx) { currentItems.splice(idx, 1); renderItems(); }

function updateItemQty(idx, val) { currentItems[idx].quantity = parseFloat(val) || 0; recalcTotals(); }
function updateItemRate(idx, val) { currentItems[idx].unit_price = parseFloat(val) || 0; recalcTotals(); }

function renderItems() {
    const tbody = document.getElementById('itemsTable');
    const noMsg = document.getElementById('noItemsMsg');

    if (!currentItems.length) {
        tbody.innerHTML = '';
        noMsg.classList.remove('hidden');
        recalcTotals();
        return;
    }
    noMsg.classList.add('hidden');

    tbody.innerHTML = currentItems.map((item, i) => `
        <tr class="border-t">
            <td class="p-2">
                <div class="text-sm font-medium">${item.item_name}</div>
                <div class="text-xs text-gray-400">${item.pack_size}</div>
            </td>
            <td class="p-2"><input type="number" value="${item.quantity}" min="0.01" step="0.01" class="qc-input text-center text-sm p-1 w-16" onchange="updateItemQty(${i}, this.value)"></td>
            <td class="p-2"><input type="number" value="${item.unit_price}" min="0" step="0.01" class="qc-input text-right text-sm p-1 w-20" onchange="updateItemRate(${i}, this.value)"></td>
            <td class="p-2 text-right text-sm font-medium">${formatCurrency(item.quantity * item.unit_price)}</td>
            <td class="p-2"><button onclick="removeItem(${i})" class="text-red-400 hover:text-red-600">&times;</button></td>
        </tr>
    `).join('');
    recalcTotals();
}

function recalcTotals() {
    let subtotal = 0;
    for (const item of currentItems) subtotal += item.quantity * item.unit_price;
    subtotal = Math.round(subtotal * 100) / 100;
    const discount = parseFloat(document.getElementById('discountAmount').value) || 0;
    const grandTotal = Math.round((subtotal - discount) * 100) / 100;
    document.getElementById('subtotalDisplay').textContent = formatCurrency(subtotal);
    document.getElementById('grandTotalDisplay').textContent = formatCurrency(grandTotal);
}

// ========================================
// FORM SUBMIT
// ========================================

async function handleFormSubmit(e) {
    e.preventDefault();
    const mode = document.getElementById('formMode').value;
    const editId = document.getElementById('formEditId').value;
    const action = e.submitter?.dataset?.action || 'submit';

    const customerType = document.querySelector('input[name="customer_type"]:checked').value;

    if (!currentItems.length) { showToast('Add at least one product', 'error'); return; }

    const body = {
        customer_type: customerType,
        customer_id: null,
        painter_id: customerType === 'painter' ? parseInt(document.getElementById('selectedPainterId').value) || null : null,
        customer_name: customerType === 'painter'
            ? document.getElementById('painterSearch').value
            : document.getElementById('customerName').value,
        customer_phone: document.getElementById('customerPhone').value,
        customer_address: document.getElementById('customerAddress').value,
        items: currentItems,
        discount_amount: parseFloat(document.getElementById('discountAmount').value) || 0,
        notes: document.getElementById('formNotes').value,
    };

    if (mode === 'estimate') {
        body.status = action === 'draft' ? 'draft' : 'sent';
    }

    const isEdit = !!editId;
    const url = mode === 'estimate'
        ? `${API}/estimates${isEdit ? '/' + editId : ''}`
        : `${API}/invoices${isEdit ? '/' + editId : ''}`;
    const method = isEdit ? 'PUT' : 'POST';

    try {
        const res = await fetch(url, { method, headers, body: JSON.stringify(body) });
        const data = await res.json();
        if (data.success) {
            showToast(isEdit ? 'Updated successfully' : `${mode === 'estimate' ? 'Estimate' : 'Invoice'} created`);
            closeCreateModal();
            if (mode === 'estimate') loadEstimates();
            else { loadInvoices(); switchTab('invoices'); }
            loadStats();
        } else { showToast(data.message, 'error'); }
    } catch (e) { showToast('Error saving', 'error'); }
}

// ========================================
// HELPERS
// ========================================

function formatCurrency(val) {
    const n = parseFloat(val) || 0;
    return n.toLocaleString('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatDate(d) {
    if (!d) return '';
    return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
}

function renderPagination(containerId, pg, onClick) {
    const container = document.getElementById(containerId);
    if (pg.pages <= 1) { container.innerHTML = ''; return; }
    let html = '';
    for (let i = 1; i <= pg.pages; i++) {
        html += `<button class="px-3 py-1 rounded text-sm ${i === pg.page ? 'bg-green-700 text-white' : 'bg-gray-200 text-gray-700'}" onclick="(${onClick})(${i})">${i}</button>`;
    }
    container.innerHTML = html;
}

function showToast(msg, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `fixed bottom-20 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg shadow-lg text-white text-sm z-50 ${type === 'error' ? 'bg-red-600' : 'bg-green-700'}`;
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
}

function closeDetailModal() { document.getElementById('detailModal').classList.remove('active'); }

// ========================================
// INIT
// ========================================

loadStats();
loadEstimates();
</script>

</body>
</html>
```

- [ ] **Step 2: Verify page loads**

Open the app in browser and navigate to `/staff-billing.html`. Check:
- Stats cards render (may show 0 initially)
- Tabs switch correctly
- "+ New Estimate" button opens modal
- Product search works
- No JS console errors

- [ ] **Step 3: Commit**

```bash
git add public/staff-billing.html
git commit -m "feat(billing): add staff billing UI page with estimates, invoices, payments tabs"
```

---

## Task 7: Add Navigation Entry

**Files:**
- Modify: Look at existing sidebar/nav to add billing entry

- [ ] **Step 1: Find the sidebar component and add billing link**

Check `public/components/sidebar-complete.html` and/or `public/components/staff-sidebar.html`. Add a "Billing" link pointing to `/staff-billing.html` in the appropriate section.

The sidebar uses `data-page` for active state highlighting. Use `data-page="billing"` to match the `data-page` attribute in `staff-billing.html`.

Add the link near other staff-facing entries. For admin sidebar, add under a "Billing" section. For staff sidebar, add as a main item.

Example link to add:
```html
<a href="/staff-billing.html" data-page="billing" class="nav-link">
    <svg><!-- receipt/invoice icon --></svg>
    <span>Billing</span>
</a>
```

- [ ] **Step 2: Add SUBNAV_MAP entry in universal-nav-loader.js (if needed)**

If billing needs subnav, add entry to the SUBNAV_MAP object. For now, billing uses tabs within the page, so this may not be needed.

- [ ] **Step 3: Commit**

```bash
git add public/components/sidebar-complete.html public/components/staff-sidebar.html
git commit -m "feat(billing): add billing navigation link to sidebars"
```

---

## Task 8: End-to-End Testing

- [ ] **Step 1: Run unit tests**

Run: `npx jest tests/unit/billing.test.js --verbose`
Expected: All tests pass.

- [ ] **Step 2: Run all existing tests to verify no regressions**

Run: `npm test`
Expected: All 38+ tests pass.

- [ ] **Step 3: Manual E2E test checklist**

Test in browser:
1. Open `/staff-billing.html` — page loads, stats show
2. Create estimate (customer type) — save draft, verify in list
3. Send estimate — status changes to "sent"
4. Convert estimate to invoice — invoice appears in Invoices tab
5. Create direct invoice — verify in list
6. Record cash payment (full) — payment_status changes to "paid"
7. Record partial payment — status shows "partial", balance updates
8. Push to Zoho (if Zoho creds available) — zoho_status changes to "pushed"
9. Create painter estimate — verify painter_id saved
10. Product search — returns products from zoho_items_map

- [ ] **Step 4: Commit any fixes from testing**

```bash
git add -A
git commit -m "fix(billing): fixes from E2E testing"
```

---

## Task 9: Update Skills.md

**Files:**
- Modify: `Skills.md`

- [ ] **Step 1: Add billing system documentation to Skills.md**

Add a new section documenting:
- Billing module overview (estimates, invoices, payments)
- Database tables (billing_estimates, billing_invoices, billing_payments)
- API endpoints (list the key ones)
- Permissions (billing.estimate, billing.invoice, billing.payment, billing.zoho_push)
- Page: staff-billing.html
- Zoho integration service: billing-zoho-service.js

- [ ] **Step 2: Commit**

```bash
git add Skills.md
git commit -m "docs: add billing system documentation to Skills.md"
```
