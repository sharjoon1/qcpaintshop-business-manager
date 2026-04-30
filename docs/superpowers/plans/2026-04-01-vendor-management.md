# Vendor Management System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a complete vendor management module where staff can manage vendors, enter/scan purchase bills with AI verification, create purchase orders, track vendor payments, and push bills/POs to Zoho Books.

**Architecture:** New `routes/vendors.js` route module with 6 tables (vendors, vendor_bills, vendor_bill_items, vendor_purchase_orders, vendor_po_items, vendor_payments). AI bill scanning via `services/vendor-bill-ai-service.js` using Clawdbot/KAI with base64 image encoding. Zoho integration adds `createBill()` and `createPurchaseOrder()` to existing `zoho-api.js`. Single-page UI (`staff-vendors.html`) with 4 tabs. Follows established patterns from Phase 1 billing module.

**Tech Stack:** Express.js, MySQL (mysql2/promise), Zod validation, Multer (bill photo uploads), Clawdbot/KAI (AI OCR + product matching), Zoho Books API, Tailwind CSS + design-system.css.

**Spec:** `docs/superpowers/specs/2026-04-01-staff-billing-vendor-management-design.md` (Phase 2 section)

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `migrations/migrate-vendors.js` | Create 6 vendor tables + permissions + config |
| `services/vendor-bill-ai-service.js` | AI bill image scanning (OCR extract), product matching, verification |
| `routes/vendors.js` | All vendor API endpoints: CRUD, bills, POs, payments, AI scan/verify |
| `public/staff-vendors.html` | Single-page UI with Vendors/Bills/Purchase Orders/Payments tabs |
| `tests/unit/vendors.test.js` | Unit tests for vendor schemas and AI matching logic |

### Modified Files
| File | Change |
|------|--------|
| `services/zoho-api.js` | Add `createBill()`, `getBills()`, `createPurchaseOrder()` methods |
| `config/uploads.js` | Add `uploadVendorBill` Multer config + `uploads/vendor-bills` directory |
| `server.js` | Import vendor routes, call `setPool()`, mount at `/api/vendors` |
| `public/components/sidebar-complete.html` | Add "Vendors" link under Billing section |
| `public/components/staff-sidebar.html` | Add "Vendors" link |
| `Skills.md` | Document vendor management system |

---

## Task 1: Database Migration

**Files:**
- Create: `migrations/migrate-vendors.js`

- [ ] **Step 1: Write migration file**

```javascript
// migrations/migrate-vendors.js
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

        console.log('Connected to database. Running vendor management migration...\n');

        // 1. vendors
        console.log('1. Creating vendors table...');
        await runStep(pool, 'vendors', `
            CREATE TABLE IF NOT EXISTS vendors (
                id INT AUTO_INCREMENT PRIMARY KEY,
                zoho_contact_id VARCHAR(50) NULL,
                vendor_name VARCHAR(255) NOT NULL,
                contact_person VARCHAR(255),
                phone VARCHAR(20),
                email VARCHAR(100),
                address TEXT,
                gst_number VARCHAR(20),
                payment_terms INT DEFAULT 30,
                status ENUM('active','inactive') DEFAULT 'active',
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_status (status),
                INDEX idx_zoho_contact (zoho_contact_id),
                INDEX idx_vendor_name (vendor_name)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 2. vendor_bills
        console.log('2. Creating vendor_bills table...');
        await runStep(pool, 'vendor_bills', `
            CREATE TABLE IF NOT EXISTS vendor_bills (
                id INT AUTO_INCREMENT PRIMARY KEY,
                vendor_id INT NOT NULL,
                bill_number VARCHAR(50),
                bill_date DATE,
                due_date DATE,
                subtotal DECIMAL(12,2) DEFAULT 0,
                tax_amount DECIMAL(12,2) DEFAULT 0,
                grand_total DECIMAL(12,2) DEFAULT 0,
                amount_paid DECIMAL(12,2) DEFAULT 0,
                balance_due DECIMAL(12,2) DEFAULT 0,
                payment_status ENUM('unpaid','partial','paid') DEFAULT 'unpaid',
                zoho_status ENUM('pending','pushed','failed') DEFAULT 'pending',
                zoho_bill_id VARCHAR(50) NULL,
                bill_image VARCHAR(500),
                ai_extracted_data JSON,
                ai_verification_status ENUM('pending','verified','mismatch','corrected') DEFAULT 'pending',
                ai_verification_result JSON,
                verified_at TIMESTAMP NULL,
                verified_by INT NULL,
                entered_by INT NOT NULL,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
                INDEX idx_vendor (vendor_id),
                INDEX idx_payment_status (payment_status),
                INDEX idx_zoho_status (zoho_status),
                INDEX idx_verification (ai_verification_status),
                INDEX idx_bill_date (bill_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 3. vendor_bill_items
        console.log('3. Creating vendor_bill_items table...');
        await runStep(pool, 'vendor_bill_items', `
            CREATE TABLE IF NOT EXISTS vendor_bill_items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                bill_id INT NOT NULL,
                zoho_item_id VARCHAR(50) NULL,
                item_name VARCHAR(255) NOT NULL,
                quantity DECIMAL(10,2) NOT NULL,
                unit_price DECIMAL(10,2) NOT NULL,
                line_total DECIMAL(12,2) NOT NULL,
                ai_matched BOOLEAN DEFAULT FALSE,
                ai_confidence DECIMAL(3,2) NULL,
                FOREIGN KEY (bill_id) REFERENCES vendor_bills(id) ON DELETE CASCADE,
                INDEX idx_bill (bill_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 4. vendor_purchase_orders
        console.log('4. Creating vendor_purchase_orders table...');
        await runStep(pool, 'vendor_purchase_orders', `
            CREATE TABLE IF NOT EXISTS vendor_purchase_orders (
                id INT AUTO_INCREMENT PRIMARY KEY,
                po_number VARCHAR(20) NOT NULL UNIQUE,
                vendor_id INT NOT NULL,
                created_by INT NOT NULL,
                subtotal DECIMAL(12,2) DEFAULT 0,
                tax_amount DECIMAL(12,2) DEFAULT 0,
                grand_total DECIMAL(12,2) DEFAULT 0,
                status ENUM('draft','sent','received','cancelled') DEFAULT 'draft',
                zoho_po_id VARCHAR(50) NULL,
                expected_date DATE,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
                INDEX idx_vendor (vendor_id),
                INDEX idx_status (status),
                INDEX idx_created_by (created_by)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 5. vendor_po_items
        console.log('5. Creating vendor_po_items table...');
        await runStep(pool, 'vendor_po_items', `
            CREATE TABLE IF NOT EXISTS vendor_po_items (
                id INT AUTO_INCREMENT PRIMARY KEY,
                po_id INT NOT NULL,
                zoho_item_id VARCHAR(50),
                item_name VARCHAR(255) NOT NULL,
                quantity DECIMAL(10,2) NOT NULL,
                unit_price DECIMAL(10,2) NOT NULL,
                line_total DECIMAL(12,2) NOT NULL,
                FOREIGN KEY (po_id) REFERENCES vendor_purchase_orders(id) ON DELETE CASCADE,
                INDEX idx_po (po_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 6. vendor_payments
        console.log('6. Creating vendor_payments table...');
        await runStep(pool, 'vendor_payments', `
            CREATE TABLE IF NOT EXISTS vendor_payments (
                id INT AUTO_INCREMENT PRIMARY KEY,
                vendor_id INT NOT NULL,
                bill_id INT NULL,
                amount DECIMAL(12,2) NOT NULL,
                payment_method ENUM('bank_transfer','cheque','upi','cash') NOT NULL,
                payment_reference VARCHAR(100),
                payment_date DATE NOT NULL,
                paid_by INT NOT NULL,
                zoho_payment_id VARCHAR(50) NULL,
                notes TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
                FOREIGN KEY (bill_id) REFERENCES vendor_bills(id) ON DELETE SET NULL,
                INDEX idx_vendor (vendor_id),
                INDEX idx_bill (bill_id),
                INDEX idx_payment_date (payment_date)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);

        // 7. Permissions
        console.log('\n7. Adding vendor permissions...');
        const permissions = [
            ['vendors', 'view', 'View Vendors', 'View vendor list, bills, and purchase orders'],
            ['vendors', 'manage', 'Manage Vendors', 'Create/edit vendors, bills, and record payments'],
            ['vendors', 'purchase_orders', 'Vendor Purchase Orders', 'Create and manage purchase orders']
        ];
        for (const [module, action, displayName, description] of permissions) {
            const [existing] = await pool.query(
                'SELECT id FROM permissions WHERE module = ? AND action = ?', [module, action]
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

        // 8. Config
        console.log('\n8. Adding vendor config...');
        const configs = [
            ['vendor_management_enabled', '1'],
            ['vendor_ai_scan_enabled', '1'],
            ['vendor_po_prefix', 'PO']
        ];
        for (const [key, value] of configs) {
            const [existing] = await pool.query('SELECT config_key FROM ai_config WHERE config_key = ?', [key]);
            if (existing.length === 0) {
                await runStep(pool, `config: ${key}`,
                    'INSERT INTO ai_config (config_key, config_value) VALUES (?, ?)', [key, value]
                );
            } else {
                console.log(`   SKIP config: ${key} (exists)`);
            }
        }

        console.log('\n✅ Vendor management migration completed successfully');
    } catch (error) {
        console.error('Migration failed:', error);
    } finally {
        if (pool) await pool.end();
    }
}

migrate();
```

- [ ] **Step 2: Run migration**

Run: `node migrations/migrate-vendors.js`
Expected: 6 tables created, 3 permissions added, 3 config keys added.

- [ ] **Step 3: Commit**

```bash
git add migrations/migrate-vendors.js
git commit -m "feat(vendors): add migration for vendor tables, permissions, config"
```

---

## Task 2: Add Zoho API Methods for Bills & POs

**Files:**
- Modify: `services/zoho-api.js`

- [ ] **Step 1: Add createBill, getBills, createPurchaseOrder methods**

Find the exports at the bottom of `services/zoho-api.js`. Before the `module.exports = {` line, add these functions:

```javascript
/**
 * Get bills (vendor invoices) from Zoho Books
 */
async function getBills(params = {}) {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    return await apiGet('/bills', { organization_id: orgId, ...params });
}

/**
 * Create a bill (vendor invoice) in Zoho Books
 */
async function createBill(billData) {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    return await apiPost(`/bills?organization_id=${orgId}`, billData);
}

/**
 * Create a purchase order in Zoho Books
 */
async function createPurchaseOrder(poData) {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    return await apiPost(`/purchaseorders?organization_id=${orgId}`, poData);
}

/**
 * Get purchase orders from Zoho Books
 */
async function getPurchaseOrders(params = {}) {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    return await apiGet('/purchaseorders', { organization_id: orgId, ...params });
}
```

Then add them to the `module.exports` object:

```javascript
    // Vendor/Bills
    getBills,
    createBill,
    getPurchaseOrders,
    createPurchaseOrder,
```

- [ ] **Step 2: Verify syntax**

Run: `node -c services/zoho-api.js`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add services/zoho-api.js
git commit -m "feat(vendors): add createBill, getBills, createPurchaseOrder to Zoho API"
```

---

## Task 3: Upload Config for Vendor Bills

**Files:**
- Modify: `config/uploads.js`

- [ ] **Step 1: Add vendor bill upload directory and Multer config**

In `config/uploads.js`, add `'uploads/vendor-bills'` to the `uploadDirs` array.

Then before the `module.exports`, add:

```javascript
// Vendor bill photo upload (10MB, images + PDF)
const uploadVendorBill = multer({
    storage: createDiskStorage('uploads/vendor-bills/', 'bill'),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only image and PDF files allowed'));
        }
    }
});
```

Add `uploadVendorBill` to the `module.exports` object.

- [ ] **Step 2: Verify syntax**

Run: `node -c config/uploads.js`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add config/uploads.js
git commit -m "feat(vendors): add vendor bill upload config"
```

---

## Task 4: AI Bill Scanning Service

**Files:**
- Create: `services/vendor-bill-ai-service.js`

- [ ] **Step 1: Write the AI service**

```javascript
/**
 * Vendor Bill AI Service
 * Scans bill images via KAI (Clawdbot), extracts items, matches to Zoho products.
 *
 * Exports: { setPool, scanBillImage, verifyBillItems, matchProductsToZoho }
 */

const fs = require('fs');
const path = require('path');
const aiEngine = require('./ai-engine');

let pool;

function setPool(p) { pool = p; }

/**
 * Scan a vendor bill image and extract structured data.
 * Reads the image file, encodes to base64, sends to KAI for OCR extraction.
 * Returns: { vendor_name, bill_number, bill_date, items: [{name, qty, rate, amount}], subtotal, tax, total }
 */
async function scanBillImage(imagePath) {
    const absPath = path.resolve(imagePath);
    if (!fs.existsSync(absPath)) {
        throw new Error('Bill image file not found: ' + imagePath);
    }

    const imageBuffer = fs.readFileSync(absPath);
    const base64Image = imageBuffer.toString('base64');
    const ext = path.extname(absPath).toLowerCase();
    const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
    const mimeType = mimeMap[ext] || 'image/jpeg';

    const messages = [
        {
            role: 'system',
            content: `You are a bill/invoice OCR extraction assistant. Extract data from vendor bills/invoices.
Return ONLY valid JSON with no markdown or explanation. Use this exact structure:
{
  "vendor_name": "string",
  "bill_number": "string",
  "bill_date": "YYYY-MM-DD",
  "items": [
    { "name": "string", "quantity": number, "rate": number, "amount": number }
  ],
  "subtotal": number,
  "tax": number,
  "total": number
}
If a field cannot be read, use null. For items, extract every line item visible.`
        },
        {
            role: 'user',
            content: `[IMAGE: data:${mimeType};base64,${base64Image}]\n\nExtract all data from this vendor bill image. Return JSON only.`
        }
    ];

    const result = await aiEngine.generate(messages, {
        provider: 'clawdbot',
        maxTokens: 4096,
        temperature: 0.1
    });

    const text = (result.text || '').trim();

    // Parse JSON from response (handle potential markdown wrapping)
    let jsonStr = text;
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) jsonStr = jsonMatch[1].trim();

    try {
        return JSON.parse(jsonStr);
    } catch (e) {
        console.error('AI bill scan: failed to parse JSON response:', text.substring(0, 500));
        throw new Error('AI could not extract structured data from the bill image');
    }
}

/**
 * Match extracted product names to Zoho items.
 * Uses fuzzy matching against zoho_items_map.zoho_item_name.
 * Also checks vendor's purchase history for better matches.
 *
 * Returns items array with zoho_item_id, ai_matched, ai_confidence added.
 */
async function matchProductsToZoho(extractedItems, vendorId) {
    if (!extractedItems || !extractedItems.length) return [];

    // Load all active Zoho items for matching
    const [zohoItems] = await pool.query(
        `SELECT zoho_item_id, zoho_item_name, sku, brand, rate
         FROM zoho_items_map WHERE status = 'active'`
    );

    // Load vendor's previous bill items for better matching
    let vendorHistory = [];
    if (vendorId) {
        const [history] = await pool.query(
            `SELECT vbi.item_name, vbi.zoho_item_id, COUNT(*) as usage_count
             FROM vendor_bill_items vbi
             JOIN vendor_bills vb ON vbi.bill_id = vb.id
             WHERE vb.vendor_id = ? AND vbi.zoho_item_id IS NOT NULL
             GROUP BY vbi.item_name, vbi.zoho_item_id
             ORDER BY usage_count DESC`,
            [vendorId]
        );
        vendorHistory = history;
    }

    return extractedItems.map(item => {
        const itemName = (item.name || '').toLowerCase().trim();
        if (!itemName) {
            return { ...item, zoho_item_id: null, ai_matched: false, ai_confidence: 0 };
        }

        // 1. Check vendor history first (highest priority)
        const historyMatch = vendorHistory.find(h =>
            h.item_name.toLowerCase().trim() === itemName
        );
        if (historyMatch) {
            return {
                ...item,
                zoho_item_id: historyMatch.zoho_item_id,
                ai_matched: true,
                ai_confidence: 0.95
            };
        }

        // 2. Exact match on zoho_item_name
        const exactMatch = zohoItems.find(z =>
            z.zoho_item_name.toLowerCase().trim() === itemName
        );
        if (exactMatch) {
            return {
                ...item,
                zoho_item_id: exactMatch.zoho_item_id,
                ai_matched: true,
                ai_confidence: 0.90
            };
        }

        // 3. Fuzzy match — check if item name contains zoho name or vice versa
        let bestMatch = null;
        let bestScore = 0;

        for (const z of zohoItems) {
            const zName = z.zoho_item_name.toLowerCase().trim();
            let score = 0;

            // Contains match
            if (zName.includes(itemName) || itemName.includes(zName)) {
                score = 0.7;
            }

            // Word overlap scoring
            const itemWords = itemName.split(/\s+/).filter(w => w.length > 2);
            const zWords = zName.split(/\s+/).filter(w => w.length > 2);
            if (itemWords.length > 0 && zWords.length > 0) {
                const matchingWords = itemWords.filter(w => zWords.some(zw => zw.includes(w) || w.includes(zw)));
                const wordScore = matchingWords.length / Math.max(itemWords.length, zWords.length);
                score = Math.max(score, wordScore * 0.8);
            }

            if (score > bestScore) {
                bestScore = score;
                bestMatch = z;
            }
        }

        if (bestMatch && bestScore >= 0.5) {
            return {
                ...item,
                zoho_item_id: bestMatch.zoho_item_id,
                ai_matched: true,
                ai_confidence: Math.round(bestScore * 100) / 100
            };
        }

        return { ...item, zoho_item_id: null, ai_matched: false, ai_confidence: 0 };
    });
}

/**
 * Verify staff-entered bill items against AI-extracted data.
 * Compares each field and returns a verification result.
 *
 * Returns: { status: 'verified'|'mismatch', differences: [{field, expected, actual}] }
 */
function verifyBillItems(staffItems, aiExtractedData) {
    if (!aiExtractedData || !aiExtractedData.items) {
        return { status: 'verified', differences: [], message: 'No AI data to compare against' };
    }

    const differences = [];
    const aiItems = aiExtractedData.items;

    // Compare item count
    if (staffItems.length !== aiItems.length) {
        differences.push({
            field: 'item_count',
            expected: aiItems.length,
            actual: staffItems.length,
            message: `Bill has ${aiItems.length} items, you entered ${staffItems.length}`
        });
    }

    // Compare matching items by position
    const maxLen = Math.min(staffItems.length, aiItems.length);
    for (let i = 0; i < maxLen; i++) {
        const staff = staffItems[i];
        const ai = aiItems[i];

        if (ai.quantity != null && Math.abs(parseFloat(staff.quantity) - ai.quantity) > 0.01) {
            differences.push({
                field: `item_${i + 1}_quantity`,
                item_name: staff.item_name || ai.name,
                expected: ai.quantity,
                actual: parseFloat(staff.quantity),
                message: `${staff.item_name || ai.name}: Qty should be ${ai.quantity}, you entered ${staff.quantity}`
            });
        }

        if (ai.rate != null && Math.abs(parseFloat(staff.unit_price) - ai.rate) > 0.01) {
            differences.push({
                field: `item_${i + 1}_rate`,
                item_name: staff.item_name || ai.name,
                expected: ai.rate,
                actual: parseFloat(staff.unit_price),
                message: `${staff.item_name || ai.name}: Rate should be ${ai.rate}, you entered ${staff.unit_price}`
            });
        }
    }

    // Compare totals
    if (aiExtractedData.total != null) {
        const staffTotal = staffItems.reduce((sum, i) => sum + parseFloat(i.line_total || 0), 0);
        if (Math.abs(staffTotal - aiExtractedData.total) > 1) {
            differences.push({
                field: 'total',
                expected: aiExtractedData.total,
                actual: Math.round(staffTotal * 100) / 100,
                message: `Bill total is ${aiExtractedData.total}, your items total ${Math.round(staffTotal * 100) / 100}`
            });
        }
    }

    return {
        status: differences.length === 0 ? 'verified' : 'mismatch',
        differences
    };
}

module.exports = { setPool, scanBillImage, matchProductsToZoho, verifyBillItems };
```

- [ ] **Step 2: Verify syntax**

Run: `node -c services/vendor-bill-ai-service.js`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add services/vendor-bill-ai-service.js
git commit -m "feat(vendors): add AI bill scanning service with OCR, product matching, verification"
```

---

## Task 5: Vendor Routes

**Files:**
- Create: `routes/vendors.js`

This is a large file. It contains all vendor API endpoints following the same pattern as `routes/billing.js`.

- [ ] **Step 1: Write the route file**

```javascript
/**
 * Vendor Routes
 * Vendor CRUD, bills (with AI scan/verify), purchase orders, payments.
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

async function generateNumber(prefix, table, column) {
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const pattern = `${prefix}-${dateStr}-%`;
    const [rows] = await pool.query(
        `SELECT ${column} FROM ${table} WHERE ${column} LIKE ? ORDER BY id DESC LIMIT 1`, [pattern]
    );
    let seq = 1;
    if (rows.length) {
        const parts = rows[0][column].split('-');
        seq = parseInt(parts[2]) + 1;
    }
    return `${prefix}-${dateStr}-${String(seq).padStart(3, '0')}`;
}

// ═══════════════════════════════════════════
// SCHEMAS
// ═══════════════════════════════════════════

const idParamSchema = z.object({ id: z.coerce.number().int().positive() });

const listQuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(20),
    search: z.string().optional(),
    status: z.string().optional(),
});

const createVendorSchema = z.object({
    vendor_name: z.string().min(1),
    contact_person: z.string().optional().default(''),
    phone: z.string().optional().default(''),
    email: z.string().optional().default(''),
    address: z.string().optional().default(''),
    gst_number: z.string().optional().default(''),
    payment_terms: z.number().int().min(0).optional().default(30),
    notes: z.string().optional().default(''),
});

const billItemSchema = z.object({
    zoho_item_id: z.string().optional().nullable().default(null),
    item_name: z.string().min(1),
    quantity: z.number().positive(),
    unit_price: z.number().min(0),
    ai_matched: z.boolean().optional().default(false),
    ai_confidence: z.number().min(0).max(1).optional().default(0),
});

const createBillSchema = z.object({
    vendor_id: z.number().int().positive(),
    bill_number: z.string().optional().default(''),
    bill_date: z.string().optional().nullable(),
    due_date: z.string().optional().nullable(),
    items: z.array(billItemSchema).min(1),
    tax_amount: z.number().min(0).optional().default(0),
    notes: z.string().optional().default(''),
});

const poItemSchema = z.object({
    zoho_item_id: z.string().optional().default(''),
    item_name: z.string().min(1),
    quantity: z.number().positive(),
    unit_price: z.number().min(0),
});

const createPOSchema = z.object({
    vendor_id: z.number().int().positive(),
    items: z.array(poItemSchema).min(1),
    tax_amount: z.number().min(0).optional().default(0),
    expected_date: z.string().optional().nullable(),
    notes: z.string().optional().default(''),
});

const recordPaymentSchema = z.object({
    vendor_id: z.number().int().positive(),
    bill_id: z.number().int().positive().optional().nullable(),
    amount: z.number().positive(),
    payment_method: z.enum(['bank_transfer', 'cheque', 'upi', 'cash']),
    payment_reference: z.string().optional().default(''),
    payment_date: z.string().min(1),
    notes: z.string().optional().default(''),
});

// ═══════════════════════════════════════════
// VENDOR CRUD
// ═══════════════════════════════════════════

const viewPerm = requirePermission('vendors', 'view');
const managePerm = requirePermission('vendors', 'manage');
const poPerm = requirePermission('vendors', 'purchase_orders');

// List vendors
router.get('/', viewPerm, validateQuery(listQuerySchema), async (req, res) => {
    try {
        const { page, limit, search, status } = req.query;
        const offset = (page - 1) * limit;
        let where = 'WHERE 1=1';
        const params = [];

        if (status) { where += ' AND v.status = ?'; params.push(status); }
        if (search) { where += ' AND (v.vendor_name LIKE ? OR v.phone LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

        const [countRows] = await pool.query(`SELECT COUNT(*) as total FROM vendors v ${where}`, params);
        const [vendors] = await pool.query(
            `SELECT v.*,
                    (SELECT COUNT(*) FROM vendor_bills WHERE vendor_id = v.id) as bill_count,
                    (SELECT COALESCE(SUM(balance_due), 0) FROM vendor_bills WHERE vendor_id = v.id AND payment_status != 'paid') as outstanding
             FROM vendors v ${where}
             ORDER BY v.vendor_name
             LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        res.json({ success: true, vendors, pagination: { page, limit, total: countRows[0].total, pages: Math.ceil(countRows[0].total / limit) } });
    } catch (error) {
        console.error('List vendors error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get vendor detail
router.get('/:id', viewPerm, validateParams(idParamSchema), async (req, res) => {
    try {
        const [vendors] = await pool.query('SELECT * FROM vendors WHERE id = ?', [req.params.id]);
        if (!vendors.length) return res.status(404).json({ success: false, message: 'Vendor not found' });

        const [bills] = await pool.query(
            'SELECT * FROM vendor_bills WHERE vendor_id = ? ORDER BY bill_date DESC LIMIT 10', [req.params.id]
        );
        const [payments] = await pool.query(
            'SELECT * FROM vendor_payments WHERE vendor_id = ? ORDER BY payment_date DESC LIMIT 10', [req.params.id]
        );

        res.json({ success: true, vendor: { ...vendors[0], recent_bills: bills, recent_payments: payments } });
    } catch (error) {
        console.error('Get vendor error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Create vendor
router.post('/', managePerm, validate(createVendorSchema), async (req, res) => {
    try {
        const data = req.body;
        const [result] = await pool.query(
            `INSERT INTO vendors (vendor_name, contact_person, phone, email, address, gst_number, payment_terms, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [data.vendor_name, data.contact_person, data.phone, data.email, data.address, data.gst_number, data.payment_terms, data.notes]
        );
        res.json({ success: true, vendor: { id: result.insertId, vendor_name: data.vendor_name } });
    } catch (error) {
        console.error('Create vendor error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Edit vendor
router.put('/:id', managePerm, validateParams(idParamSchema), validate(createVendorSchema), async (req, res) => {
    try {
        const [existing] = await pool.query('SELECT id FROM vendors WHERE id = ?', [req.params.id]);
        if (!existing.length) return res.status(404).json({ success: false, message: 'Vendor not found' });

        const data = req.body;
        await pool.query(
            `UPDATE vendors SET vendor_name=?, contact_person=?, phone=?, email=?, address=?, gst_number=?, payment_terms=?, notes=? WHERE id=?`,
            [data.vendor_name, data.contact_person, data.phone, data.email, data.address, data.gst_number, data.payment_terms, data.notes, req.params.id]
        );
        res.json({ success: true, message: 'Vendor updated' });
    } catch (error) {
        console.error('Edit vendor error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Sync vendors from Zoho
router.post('/sync-zoho', managePerm, async (req, res) => {
    try {
        const result = await zohoAPI.getContacts({ contact_type: 'vendor', per_page: 200 });
        const contacts = result.contacts || [];
        let synced = 0;

        for (const c of contacts) {
            const [existing] = await pool.query('SELECT id FROM vendors WHERE zoho_contact_id = ?', [c.contact_id]);
            if (existing.length) {
                await pool.query(
                    'UPDATE vendors SET vendor_name=?, phone=?, email=? WHERE zoho_contact_id=?',
                    [c.contact_name, c.phone || '', c.email || '', c.contact_id]
                );
            } else {
                await pool.query(
                    `INSERT INTO vendors (zoho_contact_id, vendor_name, phone, email, status) VALUES (?, ?, ?, ?, 'active')`,
                    [c.contact_id, c.contact_name, c.phone || '', c.email || '']
                );
            }
            synced++;
        }

        res.json({ success: true, message: `Synced ${synced} vendors from Zoho` });
    } catch (error) {
        console.error('Sync vendors error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ═══════════════════════════════════════════
// BILLS — named routes BEFORE :id params
// ═══════════════════════════════════════════

// AI Scan bill image — upload photo, extract data, match products
router.post('/bills/scan', managePerm, uploadVendorBill.single('bill_image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No image uploaded' });

        const imagePath = req.file.path;
        const vendorId = req.body.vendor_id ? parseInt(req.body.vendor_id) : null;

        // 1. AI scan
        const extracted = await vendorBillAI.scanBillImage(imagePath);

        // 2. Match products to Zoho
        const matchedItems = await vendorBillAI.matchProductsToZoho(extracted.items || [], vendorId);

        res.json({
            success: true,
            scan_result: {
                vendor_name: extracted.vendor_name,
                bill_number: extracted.bill_number,
                bill_date: extracted.bill_date,
                items: matchedItems,
                subtotal: extracted.subtotal,
                tax: extracted.tax,
                total: extracted.total,
                image_path: imagePath
            }
        });
    } catch (error) {
        console.error('AI bill scan error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// List bills
router.get('/bills', viewPerm, validateQuery(listQuerySchema.extend({
    vendor_id: z.coerce.number().int().optional(),
    payment_status: z.enum(['unpaid', 'partial', 'paid']).optional(),
})), async (req, res) => {
    try {
        const { page, limit, search, vendor_id, payment_status } = req.query;
        const offset = (page - 1) * limit;
        let where = 'WHERE 1=1';
        const params = [];

        if (vendor_id) { where += ' AND vb.vendor_id = ?'; params.push(vendor_id); }
        if (payment_status) { where += ' AND vb.payment_status = ?'; params.push(payment_status); }
        if (search) { where += ' AND (vb.bill_number LIKE ? OR v.vendor_name LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

        const [countRows] = await pool.query(
            `SELECT COUNT(*) as total FROM vendor_bills vb JOIN vendors v ON vb.vendor_id = v.id ${where}`, params
        );

        const [bills] = await pool.query(
            `SELECT vb.*, v.vendor_name
             FROM vendor_bills vb
             JOIN vendors v ON vb.vendor_id = v.id
             ${where}
             ORDER BY vb.created_at DESC
             LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        res.json({ success: true, bills, pagination: { page, limit, total: countRows[0].total, pages: Math.ceil(countRows[0].total / limit) } });
    } catch (error) {
        console.error('List bills error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Create bill
router.post('/bills', managePerm, validate(createBillSchema), async (req, res) => {
    try {
        const data = req.body;

        const subtotal = data.items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0);
        const grandTotal = Math.round((subtotal + data.tax_amount) * 100) / 100;

        const [result] = await pool.query(
            `INSERT INTO vendor_bills
             (vendor_id, bill_number, bill_date, due_date, subtotal, tax_amount, grand_total, balance_due,
              bill_image, ai_extracted_data, entered_by, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [data.vendor_id, data.bill_number, data.bill_date || null, data.due_date || null,
             Math.round(subtotal * 100) / 100, data.tax_amount, grandTotal, grandTotal,
             data.bill_image || null, data.ai_extracted_data ? JSON.stringify(data.ai_extracted_data) : null,
             req.user.id, data.notes]
        );
        const billId = result.insertId;

        for (const item of data.items) {
            const lineTotal = Math.round(item.quantity * item.unit_price * 100) / 100;
            await pool.query(
                `INSERT INTO vendor_bill_items (bill_id, zoho_item_id, item_name, quantity, unit_price, line_total, ai_matched, ai_confidence)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [billId, item.zoho_item_id || null, item.item_name, item.quantity, item.unit_price, lineTotal,
                 item.ai_matched || false, item.ai_confidence || 0]
            );
        }

        res.json({ success: true, bill: { id: billId, grand_total: grandTotal } });
    } catch (error) {
        console.error('Create bill error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Get bill detail
router.get('/bills/:id', viewPerm, validateParams(idParamSchema), async (req, res) => {
    try {
        const [bills] = await pool.query(
            `SELECT vb.*, v.vendor_name FROM vendor_bills vb JOIN vendors v ON vb.vendor_id = v.id WHERE vb.id = ?`,
            [req.params.id]
        );
        if (!bills.length) return res.status(404).json({ success: false, message: 'Bill not found' });

        const [items] = await pool.query('SELECT * FROM vendor_bill_items WHERE bill_id = ?', [req.params.id]);
        const [payments] = await pool.query(
            `SELECT vp.*, u.full_name as paid_by_name FROM vendor_payments vp LEFT JOIN users u ON vp.paid_by = u.id WHERE vp.bill_id = ? ORDER BY vp.payment_date DESC`,
            [req.params.id]
        );

        res.json({ success: true, bill: { ...bills[0], items, payments } });
    } catch (error) {
        console.error('Get bill error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Edit bill items
router.put('/bills/:id/items', managePerm, validateParams(idParamSchema), async (req, res) => {
    try {
        const [existing] = await pool.query('SELECT id, ai_verification_status FROM vendor_bills WHERE id = ?', [req.params.id]);
        if (!existing.length) return res.status(404).json({ success: false, message: 'Bill not found' });

        const { items } = req.body;
        if (!items || !items.length) return res.status(400).json({ success: false, message: 'Items required' });

        await pool.query('DELETE FROM vendor_bill_items WHERE bill_id = ?', [req.params.id]);

        let subtotal = 0;
        for (const item of items) {
            const lineTotal = Math.round(item.quantity * item.unit_price * 100) / 100;
            subtotal += lineTotal;
            await pool.query(
                `INSERT INTO vendor_bill_items (bill_id, zoho_item_id, item_name, quantity, unit_price, line_total, ai_matched, ai_confidence)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [req.params.id, item.zoho_item_id || null, item.item_name, item.quantity, item.unit_price, lineTotal,
                 item.ai_matched || false, item.ai_confidence || 0]
            );
        }

        // Update bill totals
        const [bill] = await pool.query('SELECT tax_amount FROM vendor_bills WHERE id = ?', [req.params.id]);
        const grandTotal = Math.round((subtotal + parseFloat(bill[0].tax_amount)) * 100) / 100;
        await pool.query(
            'UPDATE vendor_bills SET subtotal = ?, grand_total = ?, balance_due = ? - amount_paid WHERE id = ?',
            [Math.round(subtotal * 100) / 100, grandTotal, grandTotal, req.params.id]
        );

        res.json({ success: true, message: 'Bill items updated' });
    } catch (error) {
        console.error('Edit bill items error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// AI Verify bill
router.post('/bills/:id/verify', managePerm, validateParams(idParamSchema), async (req, res) => {
    try {
        const [bills] = await pool.query('SELECT * FROM vendor_bills WHERE id = ?', [req.params.id]);
        if (!bills.length) return res.status(404).json({ success: false, message: 'Bill not found' });

        const bill = bills[0];
        const aiData = typeof bill.ai_extracted_data === 'string' ? JSON.parse(bill.ai_extracted_data) : bill.ai_extracted_data;

        if (!aiData) return res.status(400).json({ success: false, message: 'No AI scan data. Upload bill image first.' });

        const [staffItems] = await pool.query('SELECT * FROM vendor_bill_items WHERE bill_id = ?', [req.params.id]);

        const result = vendorBillAI.verifyBillItems(staffItems, aiData);

        const verificationStatus = result.status === 'verified' ? 'verified' : 'mismatch';
        await pool.query(
            `UPDATE vendor_bills SET ai_verification_status = ?, ai_verification_result = ?,
             verified_at = ${verificationStatus === 'verified' ? 'NOW()' : 'NULL'},
             verified_by = ${verificationStatus === 'verified' ? '?' : 'NULL'} WHERE id = ?`,
            verificationStatus === 'verified'
                ? [verificationStatus, JSON.stringify(result), req.user.id, req.params.id]
                : [verificationStatus, JSON.stringify(result), req.params.id]
        );

        res.json({ success: true, verification: result });
    } catch (error) {
        console.error('Verify bill error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Submit verified bill
router.post('/bills/:id/submit', managePerm, validateParams(idParamSchema), async (req, res) => {
    try {
        const [bills] = await pool.query('SELECT id, ai_verification_status FROM vendor_bills WHERE id = ?', [req.params.id]);
        if (!bills.length) return res.status(404).json({ success: false, message: 'Bill not found' });

        if (!['verified', 'corrected'].includes(bills[0].ai_verification_status)) {
            return res.status(400).json({ success: false, message: 'Bill must be verified before submitting' });
        }

        // Mark as submitted (just update verified_at if not set)
        await pool.query(
            'UPDATE vendor_bills SET ai_verification_status = ?, verified_at = COALESCE(verified_at, NOW()), verified_by = COALESCE(verified_by, ?) WHERE id = ?',
            ['verified', req.user.id, req.params.id]
        );

        res.json({ success: true, message: 'Bill submitted' });
    } catch (error) {
        console.error('Submit bill error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Push bill to Zoho
router.post('/bills/:id/push-zoho', poPerm, validateParams(idParamSchema), async (req, res) => {
    try {
        const [bills] = await pool.query(
            'SELECT vb.*, v.zoho_contact_id, v.vendor_name FROM vendor_bills vb JOIN vendors v ON vb.vendor_id = v.id WHERE vb.id = ?',
            [req.params.id]
        );
        if (!bills.length) return res.status(404).json({ success: false, message: 'Bill not found' });
        const bill = bills[0];

        if (bill.zoho_status === 'pushed') return res.status(400).json({ success: false, message: 'Already pushed to Zoho' });

        // Resolve vendor contact
        let vendorContactId = bill.zoho_contact_id;
        if (!vendorContactId) {
            const contactRes = await zohoAPI.createContact({
                contact_name: bill.vendor_name,
                contact_type: 'vendor'
            });
            vendorContactId = contactRes?.contact?.contact_id;
            if (vendorContactId) {
                await pool.query('UPDATE vendors SET zoho_contact_id = ? WHERE id = ?', [vendorContactId, bill.vendor_id]);
            }
        }
        if (!vendorContactId) throw new Error('Could not resolve Zoho vendor contact');

        const [items] = await pool.query('SELECT * FROM vendor_bill_items WHERE bill_id = ?', [bill.id]);

        const now = new Date();
        const billDate = bill.bill_date
            ? new Date(bill.bill_date).toISOString().slice(0, 10)
            : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        const zohoBill = await zohoAPI.createBill({
            vendor_id: vendorContactId,
            bill_number: bill.bill_number || undefined,
            date: billDate,
            due_date: bill.due_date ? new Date(bill.due_date).toISOString().slice(0, 10) : undefined,
            line_items: items.map(i => ({
                item_id: i.zoho_item_id || undefined,
                name: i.item_name,
                quantity: parseFloat(i.quantity),
                rate: parseFloat(i.unit_price)
            }))
        });

        const zohoBillId = zohoBill?.bill?.bill_id || 'unknown';
        await pool.query(
            'UPDATE vendor_bills SET zoho_status = ?, zoho_bill_id = ? WHERE id = ?',
            ['pushed', zohoBillId, bill.id]
        );

        res.json({ success: true, message: 'Bill pushed to Zoho', zoho_bill_id: zohoBillId });
    } catch (error) {
        console.error('Push bill to Zoho error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ═══════════════════════════════════════════
// PURCHASE ORDERS
// ═══════════════════════════════════════════

// List POs
router.get('/purchase-orders', viewPerm, validateQuery(listQuerySchema.extend({
    vendor_id: z.coerce.number().int().optional(),
})), async (req, res) => {
    try {
        const { page, limit, search, status, vendor_id } = req.query;
        const offset = (page - 1) * limit;
        let where = 'WHERE 1=1';
        const params = [];

        if (vendor_id) { where += ' AND po.vendor_id = ?'; params.push(vendor_id); }
        if (status) { where += ' AND po.status = ?'; params.push(status); }
        if (search) { where += ' AND (po.po_number LIKE ? OR v.vendor_name LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

        const [countRows] = await pool.query(
            `SELECT COUNT(*) as total FROM vendor_purchase_orders po JOIN vendors v ON po.vendor_id = v.id ${where}`, params
        );

        const [orders] = await pool.query(
            `SELECT po.*, v.vendor_name, u.full_name as created_by_name
             FROM vendor_purchase_orders po
             JOIN vendors v ON po.vendor_id = v.id
             LEFT JOIN users u ON po.created_by = u.id
             ${where}
             ORDER BY po.created_at DESC
             LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        res.json({ success: true, purchase_orders: orders, pagination: { page, limit, total: countRows[0].total, pages: Math.ceil(countRows[0].total / limit) } });
    } catch (error) {
        console.error('List POs error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Create PO
router.post('/purchase-orders', poPerm, validate(createPOSchema), async (req, res) => {
    try {
        const data = req.body;
        const poNumber = await generateNumber('PO', 'vendor_purchase_orders', 'po_number');

        const subtotal = data.items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0);
        const grandTotal = Math.round((subtotal + data.tax_amount) * 100) / 100;

        const [result] = await pool.query(
            `INSERT INTO vendor_purchase_orders (po_number, vendor_id, created_by, subtotal, tax_amount, grand_total, expected_date, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [poNumber, data.vendor_id, req.user.id, Math.round(subtotal * 100) / 100, data.tax_amount, grandTotal, data.expected_date || null, data.notes]
        );
        const poId = result.insertId;

        for (const item of data.items) {
            const lineTotal = Math.round(item.quantity * item.unit_price * 100) / 100;
            await pool.query(
                'INSERT INTO vendor_po_items (po_id, zoho_item_id, item_name, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?)',
                [poId, item.zoho_item_id || null, item.item_name, item.quantity, item.unit_price, lineTotal]
            );
        }

        res.json({ success: true, purchase_order: { id: poId, po_number: poNumber, grand_total: grandTotal } });
    } catch (error) {
        console.error('Create PO error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Edit PO (draft only)
router.put('/purchase-orders/:id', poPerm, validateParams(idParamSchema), validate(createPOSchema), async (req, res) => {
    try {
        const [existing] = await pool.query('SELECT id, status FROM vendor_purchase_orders WHERE id = ?', [req.params.id]);
        if (!existing.length) return res.status(404).json({ success: false, message: 'PO not found' });
        if (existing[0].status !== 'draft') return res.status(400).json({ success: false, message: 'Can only edit draft POs' });

        const data = req.body;
        const subtotal = data.items.reduce((sum, i) => sum + i.quantity * i.unit_price, 0);
        const grandTotal = Math.round((subtotal + data.tax_amount) * 100) / 100;

        await pool.query(
            'UPDATE vendor_purchase_orders SET vendor_id=?, subtotal=?, tax_amount=?, grand_total=?, expected_date=?, notes=? WHERE id=?',
            [data.vendor_id, Math.round(subtotal * 100) / 100, data.tax_amount, grandTotal, data.expected_date || null, data.notes, req.params.id]
        );

        await pool.query('DELETE FROM vendor_po_items WHERE po_id = ?', [req.params.id]);
        for (const item of data.items) {
            const lineTotal = Math.round(item.quantity * item.unit_price * 100) / 100;
            await pool.query(
                'INSERT INTO vendor_po_items (po_id, zoho_item_id, item_name, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?, ?)',
                [req.params.id, item.zoho_item_id || null, item.item_name, item.quantity, item.unit_price, lineTotal]
            );
        }

        res.json({ success: true, message: 'PO updated' });
    } catch (error) {
        console.error('Edit PO error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Send PO
router.post('/purchase-orders/:id/send', poPerm, validateParams(idParamSchema), async (req, res) => {
    try {
        const [existing] = await pool.query('SELECT id, status FROM vendor_purchase_orders WHERE id = ?', [req.params.id]);
        if (!existing.length) return res.status(404).json({ success: false, message: 'PO not found' });
        if (existing[0].status !== 'draft') return res.status(400).json({ success: false, message: 'Can only send draft POs' });

        await pool.query('UPDATE vendor_purchase_orders SET status = ? WHERE id = ?', ['sent', req.params.id]);
        res.json({ success: true, message: 'PO sent' });
    } catch (error) {
        console.error('Send PO error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Push PO to Zoho
router.post('/purchase-orders/:id/push-zoho', poPerm, validateParams(idParamSchema), async (req, res) => {
    try {
        const [pos] = await pool.query(
            'SELECT po.*, v.zoho_contact_id, v.vendor_name FROM vendor_purchase_orders po JOIN vendors v ON po.vendor_id = v.id WHERE po.id = ?',
            [req.params.id]
        );
        if (!pos.length) return res.status(404).json({ success: false, message: 'PO not found' });
        const po = pos[0];

        if (po.zoho_po_id) return res.status(400).json({ success: false, message: 'Already pushed to Zoho' });

        let vendorContactId = po.zoho_contact_id;
        if (!vendorContactId) {
            const contactRes = await zohoAPI.createContact({ contact_name: po.vendor_name, contact_type: 'vendor' });
            vendorContactId = contactRes?.contact?.contact_id;
            if (vendorContactId) await pool.query('UPDATE vendors SET zoho_contact_id = ? WHERE id = ?', [vendorContactId, po.vendor_id]);
        }
        if (!vendorContactId) throw new Error('Could not resolve Zoho vendor contact');

        const [items] = await pool.query('SELECT * FROM vendor_po_items WHERE po_id = ?', [po.id]);

        const zohoResult = await zohoAPI.createPurchaseOrder({
            vendor_id: vendorContactId,
            date: new Date().toISOString().slice(0, 10),
            delivery_date: po.expected_date ? new Date(po.expected_date).toISOString().slice(0, 10) : undefined,
            line_items: items.map(i => ({
                item_id: i.zoho_item_id || undefined,
                name: i.item_name,
                quantity: parseFloat(i.quantity),
                rate: parseFloat(i.unit_price)
            }))
        });

        const zohoPOId = zohoResult?.purchaseorder?.purchaseorder_id || 'unknown';
        await pool.query('UPDATE vendor_purchase_orders SET zoho_po_id = ? WHERE id = ?', [zohoPOId, po.id]);

        res.json({ success: true, message: 'PO pushed to Zoho', zoho_po_id: zohoPOId });
    } catch (error) {
        console.error('Push PO to Zoho error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ═══════════════════════════════════════════
// PAYMENTS
// ═══════════════════════════════════════════

// List vendor payments
router.get('/payments', viewPerm, validateQuery(listQuerySchema.extend({
    vendor_id: z.coerce.number().int().optional(),
})), async (req, res) => {
    try {
        const { page, limit, vendor_id } = req.query;
        const offset = (page - 1) * limit;
        let where = 'WHERE 1=1';
        const params = [];

        if (vendor_id) { where += ' AND vp.vendor_id = ?'; params.push(vendor_id); }

        const [countRows] = await pool.query(
            `SELECT COUNT(*) as total FROM vendor_payments vp ${where}`, params
        );

        const [payments] = await pool.query(
            `SELECT vp.*, v.vendor_name, u.full_name as paid_by_name,
                    vb.bill_number
             FROM vendor_payments vp
             JOIN vendors v ON vp.vendor_id = v.id
             LEFT JOIN users u ON vp.paid_by = u.id
             LEFT JOIN vendor_bills vb ON vp.bill_id = vb.id
             ${where}
             ORDER BY vp.payment_date DESC
             LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        res.json({ success: true, payments, pagination: { page, limit, total: countRows[0].total, pages: Math.ceil(countRows[0].total / limit) } });
    } catch (error) {
        console.error('List payments error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// Record vendor payment
router.post('/payments', managePerm, validate(recordPaymentSchema), async (req, res) => {
    try {
        const data = req.body;

        await pool.query(
            `INSERT INTO vendor_payments (vendor_id, bill_id, amount, payment_method, payment_reference, payment_date, paid_by, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [data.vendor_id, data.bill_id || null, data.amount, data.payment_method, data.payment_reference, data.payment_date, req.user.id, data.notes]
        );

        // Update bill if linked
        if (data.bill_id) {
            const [paySum] = await pool.query(
                'SELECT COALESCE(SUM(amount), 0) as total_paid FROM vendor_payments WHERE bill_id = ?', [data.bill_id]
            );
            const totalPaid = Number(paySum[0].total_paid);
            const [bill] = await pool.query('SELECT grand_total FROM vendor_bills WHERE id = ?', [data.bill_id]);
            if (bill.length) {
                const balanceDue = Math.max(0, parseFloat(bill[0].grand_total) - totalPaid);
                const status = balanceDue <= 0.01 ? 'paid' : totalPaid > 0 ? 'partial' : 'unpaid';
                await pool.query(
                    'UPDATE vendor_bills SET amount_paid = ?, balance_due = ?, payment_status = ? WHERE id = ?',
                    [totalPaid, Math.round(balanceDue * 100) / 100, status, data.bill_id]
                );
            }
        }

        res.json({ success: true, message: 'Payment recorded' });
    } catch (error) {
        console.error('Record payment error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = { router, setPool };
```

- [ ] **Step 2: Verify syntax**

Run: `node -c routes/vendors.js`
Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add routes/vendors.js
git commit -m "feat(vendors): add vendor routes — CRUD, bills with AI scan/verify, POs, payments"
```

---

## Task 6: Register Vendor Routes in server.js

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Add import**

Near `const billingRoutes = require('./routes/billing');` add:
```javascript
const vendorRoutes = require('./routes/vendors');
```

- [ ] **Step 2: Add setPool**

Near `billingRoutes.setPool(pool);` add:
```javascript
vendorRoutes.setPool(pool);
```

- [ ] **Step 3: Mount route**

Near `app.use('/api/billing', billingRoutes.router);` add:
```javascript
app.use('/api/vendors', vendorRoutes.router);
```

- [ ] **Step 4: Verify syntax**

Run: `node -c server.js`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat(vendors): register vendor routes in server.js"
```

---

## Task 7: Unit Tests

**Files:**
- Create: `tests/unit/vendors.test.js`

- [ ] **Step 1: Write tests**

```javascript
// tests/unit/vendors.test.js
const { z } = require('zod');

describe('Vendor System', () => {
    // Schemas (same as routes/vendors.js)
    const createVendorSchema = z.object({
        vendor_name: z.string().min(1),
        contact_person: z.string().optional().default(''),
        phone: z.string().optional().default(''),
        email: z.string().optional().default(''),
        address: z.string().optional().default(''),
        gst_number: z.string().optional().default(''),
        payment_terms: z.number().int().min(0).optional().default(30),
        notes: z.string().optional().default(''),
    });

    const billItemSchema = z.object({
        zoho_item_id: z.string().optional().nullable().default(null),
        item_name: z.string().min(1),
        quantity: z.number().positive(),
        unit_price: z.number().min(0),
        ai_matched: z.boolean().optional().default(false),
        ai_confidence: z.number().min(0).max(1).optional().default(0),
    });

    const createBillSchema = z.object({
        vendor_id: z.number().int().positive(),
        bill_number: z.string().optional().default(''),
        bill_date: z.string().optional().nullable(),
        due_date: z.string().optional().nullable(),
        items: z.array(billItemSchema).min(1),
        tax_amount: z.number().min(0).optional().default(0),
        notes: z.string().optional().default(''),
    });

    const recordPaymentSchema = z.object({
        vendor_id: z.number().int().positive(),
        bill_id: z.number().int().positive().optional().nullable(),
        amount: z.number().positive(),
        payment_method: z.enum(['bank_transfer', 'cheque', 'upi', 'cash']),
        payment_reference: z.string().optional().default(''),
        payment_date: z.string().min(1),
        notes: z.string().optional().default(''),
    });

    describe('Vendor Schema', () => {
        it('should accept valid vendor', () => {
            const result = createVendorSchema.safeParse({ vendor_name: 'Asian Paints' });
            expect(result.success).toBe(true);
            expect(result.data.payment_terms).toBe(30);
        });

        it('should reject missing vendor_name', () => {
            const result = createVendorSchema.safeParse({ phone: '9876543210' });
            expect(result.success).toBe(false);
        });
    });

    describe('Bill Schema', () => {
        it('should accept valid bill', () => {
            const result = createBillSchema.safeParse({
                vendor_id: 1,
                items: [{ item_name: 'Emulsion 10L', quantity: 5, unit_price: 2000 }]
            });
            expect(result.success).toBe(true);
        });

        it('should accept bill with AI-matched items', () => {
            const result = createBillSchema.safeParse({
                vendor_id: 1,
                items: [{
                    zoho_item_id: 'Z001',
                    item_name: 'Primer',
                    quantity: 10,
                    unit_price: 500,
                    ai_matched: true,
                    ai_confidence: 0.85
                }]
            });
            expect(result.success).toBe(true);
            expect(result.data.items[0].ai_matched).toBe(true);
        });

        it('should reject empty items', () => {
            const result = createBillSchema.safeParse({ vendor_id: 1, items: [] });
            expect(result.success).toBe(false);
        });
    });

    describe('Payment Schema', () => {
        it('should accept valid bank payment', () => {
            const result = recordPaymentSchema.safeParse({
                vendor_id: 1,
                amount: 50000,
                payment_method: 'bank_transfer',
                payment_date: '2026-04-01'
            });
            expect(result.success).toBe(true);
        });

        it('should reject invalid payment method', () => {
            const result = recordPaymentSchema.safeParse({
                vendor_id: 1, amount: 100, payment_method: 'credit', payment_date: '2026-04-01'
            });
            expect(result.success).toBe(false);
        });
    });

    describe('Bill Verification Logic', () => {
        // Import the verification function inline
        function verifyBillItems(staffItems, aiExtractedData) {
            if (!aiExtractedData || !aiExtractedData.items) {
                return { status: 'verified', differences: [] };
            }
            const differences = [];
            const aiItems = aiExtractedData.items;

            if (staffItems.length !== aiItems.length) {
                differences.push({ field: 'item_count', expected: aiItems.length, actual: staffItems.length });
            }

            const maxLen = Math.min(staffItems.length, aiItems.length);
            for (let i = 0; i < maxLen; i++) {
                if (aiItems[i].quantity != null && Math.abs(parseFloat(staffItems[i].quantity) - aiItems[i].quantity) > 0.01) {
                    differences.push({ field: `item_${i + 1}_quantity`, expected: aiItems[i].quantity, actual: parseFloat(staffItems[i].quantity) });
                }
                if (aiItems[i].rate != null && Math.abs(parseFloat(staffItems[i].unit_price) - aiItems[i].rate) > 0.01) {
                    differences.push({ field: `item_${i + 1}_rate`, expected: aiItems[i].rate, actual: parseFloat(staffItems[i].unit_price) });
                }
            }

            return { status: differences.length === 0 ? 'verified' : 'mismatch', differences };
        }

        it('should verify matching items', () => {
            const staff = [{ quantity: 5, unit_price: 2000, line_total: 10000 }];
            const ai = { items: [{ name: 'Paint', quantity: 5, rate: 2000 }] };
            const result = verifyBillItems(staff, ai);
            expect(result.status).toBe('verified');
            expect(result.differences).toHaveLength(0);
        });

        it('should detect quantity mismatch', () => {
            const staff = [{ quantity: 10, unit_price: 500, line_total: 5000 }];
            const ai = { items: [{ name: 'Paint', quantity: 5, rate: 500 }] };
            const result = verifyBillItems(staff, ai);
            expect(result.status).toBe('mismatch');
            expect(result.differences[0].field).toBe('item_1_quantity');
        });

        it('should detect rate mismatch', () => {
            const staff = [{ quantity: 5, unit_price: 600, line_total: 3000 }];
            const ai = { items: [{ name: 'Paint', quantity: 5, rate: 500 }] };
            const result = verifyBillItems(staff, ai);
            expect(result.status).toBe('mismatch');
        });

        it('should verify when no AI data', () => {
            const staff = [{ quantity: 5, unit_price: 500, line_total: 2500 }];
            const result = verifyBillItems(staff, null);
            expect(result.status).toBe('verified');
        });

        it('should detect item count mismatch', () => {
            const staff = [
                { quantity: 5, unit_price: 500, line_total: 2500 },
                { quantity: 3, unit_price: 200, line_total: 600 }
            ];
            const ai = { items: [{ name: 'Paint', quantity: 5, rate: 500 }] };
            const result = verifyBillItems(staff, ai);
            expect(result.status).toBe('mismatch');
        });
    });
});
```

- [ ] **Step 2: Run tests**

Run: `npx jest tests/unit/vendors.test.js --verbose`
Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/vendors.test.js
git commit -m "test(vendors): add unit tests for vendor schemas and bill verification"
```

---

## Task 8: Staff Vendors UI Page

**Files:**
- Create: `public/staff-vendors.html`

This is a large UI page with 4 tabs (Vendors, Bills, Purchase Orders, Payments). It follows the exact same pattern as `public/staff-billing.html`.

- [ ] **Step 1: Create the full HTML page**

The page must include:

**HTML head:** Same as staff-billing.html (Tailwind, design-system.css, universal-nav-loader, auth-helper, `data-page="vendors"`, theme-color #1B5E3B)

**Stats cards (top):** 4 cards — Total Vendors, Open Bills (unpaid), Outstanding Amount, Purchase Orders

**4 tabs:** Vendors | Bills | Purchase Orders | Payments

**Vendors tab:**
- Search + "+ New Vendor" button
- Vendor cards: vendor_name, phone, outstanding amount, bill_count
- Click opens detail slide-out showing vendor info + recent bills + recent payments
- Create/edit vendor modal with fields: vendor_name, contact_person, phone, email, address, gst_number, payment_terms
- "Sync from Zoho" button

**Bills tab:**
- Search + vendor filter dropdown + "+ New Bill" button
- Bill cards: bill_number, vendor_name, grand_total, payment_status pill, verification status pill
- **AI Bill Flow in create modal:**
  1. Select vendor
  2. Upload bill photo (camera/gallery) — "Scan with AI" button
  3. Loading spinner "AI reading bill..."
  4. AI results auto-fill items table (with ai_matched badges)
  5. Staff can edit any item (name, qty, rate, zoho item mapping)
  6. "Verify" button → compares vs AI → shows green "Verified" or yellow "3 differences found"
  7. "Submit" button (only after verified)
- Bill detail modal: items table, payment history, Push to Zoho button
- Pagination

**Purchase Orders tab:**
- Search + "+ New PO" button
- PO cards: po_number, vendor_name, grand_total, status pill
- Create/edit PO modal: select vendor, add products (search zoho_items_map), items table
- Send / Push to Zoho actions
- Pagination

**Payments tab:**
- Recent vendor payments list
- "Record Payment" button → modal with vendor select, bill select (optional), amount, method, reference, date
- Pagination

**JavaScript API calls:** All target `/api/vendors/*`

**CSS:** Same status pill pattern as billing page. Staff green theme (#1B5E3B). No purple.

**Key interactions:**
- AI scan: `POST /api/vendors/bills/scan` (multipart form with bill_image + vendor_id)
- Verify: `POST /api/vendors/bills/:id/verify`
- Submit: `POST /api/vendors/bills/:id/submit`
- Product search for POs: `GET /api/billing/products?search=` (reuse from billing module)

- [ ] **Step 2: Verify page loads in browser**

Check all 4 tabs, modals, and that there are no JS console errors.

- [ ] **Step 3: Commit**

```bash
git add public/staff-vendors.html
git commit -m "feat(vendors): add vendor management UI page with 4 tabs, AI bill scanning"
```

---

## Task 9: Navigation Entries

**Files:**
- Modify: `public/components/sidebar-complete.html`
- Modify: `public/components/staff-sidebar.html`

- [ ] **Step 1: Add vendor link to admin sidebar**

In `public/components/sidebar-complete.html`, find the Billing section that was added in Phase 1. Add a vendor link below the Billing link:

```html
<a href="/staff-vendors.html" class="qc-nav-item" data-page="vendors" data-requires="vendors.view">
    <span class="qc-nav-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
    <span class="qc-nav-item-text">Vendors</span>
    <span class="qc-nav-tooltip">Vendors</span>
</a>
```

- [ ] **Step 2: Add vendor link to staff sidebar**

In `public/components/staff-sidebar.html`, add below the Billing link:

```html
<a href="/staff-vendors.html" class="qc-nav-item" data-page="vendors" data-requires="vendors.view">
    <span class="qc-nav-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
    <span class="qc-nav-item-text">Vendors</span>
    <span class="qc-nav-tooltip">Vendors</span>
</a>
```

- [ ] **Step 3: Commit**

```bash
git add public/components/sidebar-complete.html public/components/staff-sidebar.html
git commit -m "feat(vendors): add vendor management link to sidebars"
```

---

## Task 10: E2E Testing & Skills.md

- [ ] **Step 1: Run all unit tests**

Run: `npm test`
Expected: All tests pass (billing + vendor tests).

- [ ] **Step 2: Manual E2E test checklist**

1. Open `/staff-vendors.html` — page loads, stats show
2. Create vendor — verify in list
3. Edit vendor — fields update
4. Create bill manually (without AI) — verify items and totals
5. Upload bill image → AI scan → auto-fills items
6. Edit AI-prefilled items → verify → submit
7. Create PO → verify in list
8. Send PO → status changes
9. Record vendor payment → bill balance updates
10. Sync vendors from Zoho (if creds available)

- [ ] **Step 3: Update Skills.md with vendor management documentation**

Add section for vendor management system documenting: tables, routes, permissions, pages, AI service.

- [ ] **Step 4: Commit fixes and docs**

```bash
git add Skills.md
git commit -m "docs: add vendor management documentation to Skills.md"
```
