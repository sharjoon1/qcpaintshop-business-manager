# Estimate Pricing & Description Enhancements — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-product markup/discount, labor charges, editable descriptions, and "show description only" toggle to the admin estimate creation page.

**Architecture:** ALTER existing `estimates` + `estimate_items` tables to add new columns. Extract inline estimate routes from `server.js` into `routes/estimates.js` with enhanced create/update logic. Enhance `estimate-create-new.html` UI with inline markup/discount dropdowns, labor section, and description editing.

**Tech Stack:** Express.js, MySQL, vanilla JS, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-19-estimate-pricing-enhancements-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `migrations/migrate-estimate-enhancements.js` | Create | ALTER TABLE migration for both tables |
| `routes/estimates.js` | Create | Extracted + enhanced estimate CRUD routes |
| `server.js` | Modify (lines 3116-3350) | Remove inline estimate routes, mount new router |
| `public/estimate-create-new.html` | Modify | Enhanced UI — markup/discount/labor/description |

---

### Task 1: Database Migration

**Files:**
- Create: `migrations/migrate-estimate-enhancements.js`

- [ ] **Step 1: Create the migration file**

```js
// migrations/migrate-estimate-enhancements.js
const mysql = require('mysql2/promise');
require('dotenv').config();

async function migrate() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'business_manager',
        waitForConnections: true,
        connectionLimit: 5
    });

    const conn = await pool.getConnection();
    console.log('Connected to database');

    try {
        // Helper: check if column exists
        async function columnExists(table, column) {
            const [rows] = await conn.query(
                `SELECT COUNT(*) as cnt FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
                [process.env.DB_NAME || 'business_manager', table, column]
            );
            return rows[0].cnt > 0;
        }

        // Helper: check if index exists
        async function indexExists(table, indexName) {
            const [rows] = await conn.query(
                `SELECT COUNT(*) as cnt FROM information_schema.STATISTICS
                 WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?`,
                [process.env.DB_NAME || 'business_manager', table, indexName]
            );
            return rows[0].cnt > 0;
        }

        // ========== estimates table ==========
        console.log('\n--- Altering estimates table ---');

        const estimateColumns = [
            { name: 'total_markup', sql: 'DECIMAL(12,2) DEFAULT 0 AFTER grand_total' },
            { name: 'total_discount', sql: 'DECIMAL(12,2) DEFAULT 0 AFTER total_markup' },
            { name: 'total_labor', sql: 'DECIMAL(12,2) DEFAULT 0 AFTER total_discount' },
            { name: 'show_description_only', sql: 'TINYINT DEFAULT 0 AFTER notes' },
            { name: 'admin_notes', sql: 'TEXT AFTER notes' },
            { name: 'branch_id', sql: 'INT NULL AFTER created_by' }
        ];

        for (const col of estimateColumns) {
            if (await columnExists('estimates', col.name)) {
                console.log(`  Column estimates.${col.name} already exists, skipping`);
            } else {
                await conn.query(`ALTER TABLE estimates ADD COLUMN ${col.name} ${col.sql}`);
                console.log(`  Added estimates.${col.name}`);
            }
        }

        // Add branch_id index
        if (!(await indexExists('estimates', 'idx_branch'))) {
            await conn.query('ALTER TABLE estimates ADD INDEX idx_branch (branch_id)');
            console.log('  Added index idx_branch');
        }

        // ========== estimate_items table ==========
        console.log('\n--- Altering estimate_items table ---');

        const itemColumns = [
            { name: 'item_type', sql: "ENUM('product','labor') DEFAULT 'product' AFTER estimate_id" },
            { name: 'zoho_item_id', sql: 'VARCHAR(100) NULL AFTER product_id' },
            { name: 'item_name', sql: 'VARCHAR(255) NULL AFTER zoho_item_id' },
            { name: 'brand', sql: 'VARCHAR(100) NULL AFTER item_name' },
            { name: 'category', sql: 'VARCHAR(100) NULL AFTER brand' },
            { name: 'pack_size', sql: 'VARCHAR(50) NULL AFTER category' },
            { name: 'product_type', sql: "ENUM('unit','area') NULL AFTER pack_size" },
            { name: 'custom_description', sql: 'TEXT NULL AFTER product_type' },
            { name: 'show_description_only', sql: 'TINYINT NULL AFTER custom_description' },
            { name: 'num_coats', sql: 'INT DEFAULT 1 AFTER area' },
            { name: 'base_price', sql: 'DECIMAL(12,2) NULL AFTER num_coats' },
            { name: 'markup_type', sql: "ENUM('price_pct','price_value','total_pct','total_value') NULL AFTER base_price" },
            { name: 'markup_value', sql: 'DECIMAL(12,2) DEFAULT 0 AFTER markup_type' },
            { name: 'markup_amount', sql: 'DECIMAL(12,2) DEFAULT 0 AFTER markup_value' },
            { name: 'price_after_markup', sql: 'DECIMAL(12,2) NULL AFTER markup_amount' },
            { name: 'discount_type', sql: "ENUM('price_pct','price_value','total_pct','total_value') NULL AFTER price_after_markup" },
            { name: 'discount_value', sql: 'DECIMAL(12,2) DEFAULT 0 AFTER discount_type' },
            { name: 'discount_amount', sql: 'DECIMAL(12,2) DEFAULT 0 AFTER discount_value' },
            { name: 'final_price', sql: 'DECIMAL(12,2) NULL AFTER discount_amount' },
            { name: 'labor_description', sql: 'VARCHAR(255) NULL AFTER display_order' },
            { name: 'labor_taxable', sql: 'TINYINT DEFAULT 1 AFTER labor_description' }
        ];

        for (const col of itemColumns) {
            if (await columnExists('estimate_items', col.name)) {
                console.log(`  Column estimate_items.${col.name} already exists, skipping`);
            } else {
                await conn.query(`ALTER TABLE estimate_items ADD COLUMN ${col.name} ${col.sql}`);
                console.log(`  Added estimate_items.${col.name}`);
            }
        }

        // Backfill existing rows: base_price = unit_price, final_price = unit_price
        console.log('\n--- Backfilling existing data ---');
        const [updated] = await conn.query(`
            UPDATE estimate_items
            SET base_price = unit_price,
                final_price = unit_price,
                price_after_markup = unit_price
            WHERE base_price IS NULL AND unit_price IS NOT NULL
        `);
        console.log(`  Backfilled ${updated.affectedRows} existing rows`);

        console.log('\n✅ Migration complete!');
    } catch (err) {
        console.error('Migration error:', err);
        throw err;
    } finally {
        conn.release();
        await pool.end();
    }
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
```

- [ ] **Step 2: Run migration on server**

```bash
ssh root@161.97.114.189 "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && node migrations/migrate-estimate-enhancements.js"
```

Expected: All columns added, existing rows backfilled with `base_price = unit_price`.

- [ ] **Step 3: Commit**

```bash
git add migrations/migrate-estimate-enhancements.js
git commit -m "feat: add markup/discount/labor/description columns to estimate tables"
```

---

### Task 2: Extract and Enhance Estimate Routes

**Files:**
- Create: `routes/estimates.js`
- Modify: `server.js:3116-3337` (remove inline routes), `server.js:~44,~188,~275` (mount new router)

- [ ] **Step 1: Create `routes/estimates.js`**

Create the route file with a `setPool` pattern matching existing routes (like `routes/estimate-pdf.js`). Extract the 7 existing endpoints from `server.js` lines 3116-3337 and enhance `POST /` and `PUT /:id` with:

1. Calculation engine for markup → discount
2. Support for `item_type='labor'` rows
3. New columns: `custom_description`, `show_description_only`, `base_price`, markup/discount fields, `labor_description`, `labor_taxable`
4. Estimate totals: `total_markup`, `total_discount`, `total_labor`

```js
// routes/estimates.js
const express = require('express');
const router = express.Router();
const { requirePermission } = require('../middleware/permissionMiddleware');

let pool;

function setPool(p) { pool = p; }

// ========================================
// CALCULATION ENGINE
// ========================================
function calculateItemPricing(item) {
    const basePrice = parseFloat(item.base_price) || parseFloat(item.unit_price) || 0;
    const quantity = parseFloat(item.quantity) || 1;
    let markupAmount = 0;
    let priceAfterMarkup = basePrice;
    let discountAmount = 0;

    // Apply markup
    if (item.markup_type && parseFloat(item.markup_value) > 0) {
        const mv = parseFloat(item.markup_value);
        switch (item.markup_type) {
            case 'price_pct':
                markupAmount = basePrice * mv / 100;
                break;
            case 'price_value':
                markupAmount = mv;
                break;
            case 'total_pct':
                markupAmount = (basePrice * quantity) * mv / 100 / quantity;
                break;
            case 'total_value':
                markupAmount = mv / quantity;
                break;
        }
        priceAfterMarkup = basePrice + markupAmount;
    }

    // Apply discount on price_after_markup
    let finalPrice = priceAfterMarkup;
    if (item.discount_type && parseFloat(item.discount_value) > 0) {
        const dv = parseFloat(item.discount_value);
        switch (item.discount_type) {
            case 'price_pct':
                discountAmount = priceAfterMarkup * dv / 100;
                break;
            case 'price_value':
                discountAmount = dv;
                break;
            case 'total_pct':
                discountAmount = (priceAfterMarkup * quantity) * dv / 100 / quantity;
                break;
            case 'total_value':
                discountAmount = dv / quantity;
                break;
        }
        finalPrice = priceAfterMarkup - discountAmount;
    }

    const lineTotal = finalPrice * quantity;

    return {
        base_price: basePrice,
        markup_amount: Math.round(markupAmount * 100) / 100,
        price_after_markup: Math.round(priceAfterMarkup * 100) / 100,
        discount_amount: Math.round(discountAmount * 100) / 100,
        final_price: Math.round(finalPrice * 100) / 100,
        unit_price: Math.round(finalPrice * 100) / 100,
        line_total: Math.round(lineTotal * 100) / 100
    };
}

function calculateEstimateTotals(items) {
    let subtotal = 0, totalMarkup = 0, totalDiscount = 0, totalLabor = 0;

    for (const item of items) {
        if (item.item_type === 'labor') {
            totalLabor += parseFloat(item.line_total) || 0;
        } else {
            subtotal += parseFloat(item.line_total) || 0;
            totalMarkup += (parseFloat(item.markup_amount) || 0) * (parseFloat(item.quantity) || 1);
            totalDiscount += (parseFloat(item.discount_amount) || 0) * (parseFloat(item.quantity) || 1);
        }
    }

    return {
        subtotal: Math.round(subtotal * 100) / 100,
        total_markup: Math.round(totalMarkup * 100) / 100,
        total_discount: Math.round(totalDiscount * 100) / 100,
        total_labor: Math.round(totalLabor * 100) / 100,
        gst_amount: 0,
        grand_total: Math.round((subtotal + totalLabor) * 100) / 100
    };
}

// ========================================
// LIST ESTIMATES
// ========================================
router.get('/', requirePermission('estimates', 'view'), async (req, res) => {
    try {
        const { status, search, branch_id } = req.query;
        let query = 'SELECT * FROM estimates WHERE 1=1';
        const params = [];

        if (status) { query += ' AND status = ?'; params.push(status); }
        if (branch_id) { query += ' AND branch_id = ?'; params.push(branch_id); }
        if (search) {
            query += ' AND (estimate_number LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ?)';
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        query += ' ORDER BY estimate_date DESC, id DESC';
        const [rows] = await pool.query(query, params);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// GET SINGLE ESTIMATE
// ========================================
router.get('/:id', requirePermission('estimates', 'view'), async (req, res) => {
    try {
        const [estimate] = await pool.query('SELECT * FROM estimates WHERE id = ?', [req.params.id]);
        if (estimate.length === 0) {
            return res.status(404).json({ error: 'Estimate not found' });
        }

        const [items] = await pool.query(`
            SELECT ei.*, p.name as product_name, p.product_type as product_type
            FROM estimate_items ei
            LEFT JOIN products p ON ei.product_id = p.id
            WHERE ei.estimate_id = ?
            ORDER BY ei.display_order, ei.id
        `, [req.params.id]);

        res.json({ ...estimate[0], items });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// GET ESTIMATE ITEMS
// ========================================
router.get('/:id/items', requirePermission('estimates', 'view'), async (req, res) => {
    try {
        const [items] = await pool.query(
            'SELECT * FROM estimate_items WHERE estimate_id = ? ORDER BY display_order',
            [req.params.id]
        );
        res.json(items);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// CREATE ESTIMATE
// ========================================
router.post('/', requirePermission('estimates', 'add'), async (req, res) => {
    try {
        const {
            customer_name, customer_phone, customer_address, estimate_date, valid_until,
            show_gst_breakdown, column_visibility, show_description_only,
            notes, admin_notes, status, branch_id, items
        } = req.body;

        // Generate estimate number
        const datePrefix = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const [lastEstimate] = await pool.query(
            'SELECT estimate_number FROM estimates WHERE estimate_number LIKE ? ORDER BY id DESC LIMIT 1 FOR UPDATE',
            [`EST${datePrefix}%`]
        );

        let estimateNumber;
        if (lastEstimate.length > 0) {
            const lastNum = parseInt(lastEstimate[0].estimate_number.slice(-4));
            estimateNumber = `EST${datePrefix}${String(lastNum + 1).padStart(4, '0')}`;
        } else {
            estimateNumber = `EST${datePrefix}0001`;
        }

        // Calculate item pricing
        const processedItems = (items || []).map(item => {
            if (item.item_type === 'labor') {
                return {
                    ...item,
                    base_price: parseFloat(item.base_price) || 0,
                    unit_price: parseFloat(item.base_price) || 0,
                    line_total: (parseFloat(item.base_price) || 0) * (parseFloat(item.quantity) || 1),
                    final_price: parseFloat(item.base_price) || 0
                };
            }
            const calc = calculateItemPricing(item);
            return { ...item, ...calc };
        });

        const totals = calculateEstimateTotals(processedItems);

        // Insert estimate
        const [result] = await pool.query(
            `INSERT INTO estimates (
                estimate_number, customer_name, customer_phone, customer_address,
                estimate_date, valid_until, branch_id,
                subtotal, gst_amount, grand_total,
                total_markup, total_discount, total_labor,
                show_gst_breakdown, column_visibility, show_description_only,
                notes, admin_notes, status, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                estimateNumber, customer_name, customer_phone, customer_address,
                estimate_date, valid_until || null, branch_id || null,
                totals.subtotal, totals.gst_amount, totals.grand_total,
                totals.total_markup, totals.total_discount, totals.total_labor,
                show_gst_breakdown ? 1 : 0, column_visibility || null, show_description_only ? 1 : 0,
                notes || null, admin_notes || null, status || 'draft',
                req.user ? req.user.id : 1
            ]
        );

        const estimateId = result.insertId;

        // Insert items
        if (processedItems.length > 0) {
            const itemValues = processedItems.map(item => [
                estimateId,
                item.item_type || 'product',
                item.product_id || null,
                item.zoho_item_id || null,
                item.item_name || item.item_description || null,
                item.brand || null,
                item.category || null,
                item.image_url || null,
                item.pack_size || null,
                item.product_type || null,
                item.custom_description || null,
                item.show_description_only != null ? (item.show_description_only ? 1 : 0) : null,
                item.item_description || item.item_name || null,
                item.quantity || 1,
                item.area || null,
                item.mix_info || null,
                item.num_coats || 1,
                item.base_price || item.unit_price || 0,
                item.markup_type || null,
                item.markup_value || 0,
                item.markup_amount || 0,
                item.price_after_markup || item.unit_price || 0,
                item.discount_type || null,
                item.discount_value || 0,
                item.discount_amount || 0,
                item.final_price || item.unit_price || 0,
                item.unit_price || 0,
                item.breakdown_cost || null,
                item.color_cost || 0,
                item.line_total || 0,
                item.display_order || 0,
                item.labor_description || null,
                item.labor_taxable != null ? (item.labor_taxable ? 1 : 0) : 1
            ]);

            await pool.query(
                `INSERT INTO estimate_items (
                    estimate_id, item_type, product_id, zoho_item_id, item_name,
                    brand, category, image_url, pack_size, product_type,
                    custom_description, show_description_only,
                    item_description, quantity, area, mix_info, num_coats,
                    base_price, markup_type, markup_value, markup_amount, price_after_markup,
                    discount_type, discount_value, discount_amount, final_price,
                    unit_price, breakdown_cost, color_cost, line_total, display_order,
                    labor_description, labor_taxable
                ) VALUES ?`,
                [itemValues]
            );
        }

        res.json({ success: true, id: estimateId, estimate_number: estimateNumber, message: 'Estimate created successfully' });
    } catch (err) {
        console.error('Create estimate error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// UPDATE ESTIMATE
// ========================================
router.put('/:id', requirePermission('estimates', 'edit'), async (req, res) => {
    try {
        const estimateId = req.params.id;
        const {
            customer_name, customer_phone, customer_address, estimate_date, valid_until,
            show_gst_breakdown, column_visibility, show_description_only,
            notes, admin_notes, branch_id, items
        } = req.body;

        // Calculate item pricing
        const processedItems = (items || []).map(item => {
            if (item.item_type === 'labor') {
                return {
                    ...item,
                    base_price: parseFloat(item.base_price) || 0,
                    unit_price: parseFloat(item.base_price) || 0,
                    line_total: (parseFloat(item.base_price) || 0) * (parseFloat(item.quantity) || 1),
                    final_price: parseFloat(item.base_price) || 0
                };
            }
            const calc = calculateItemPricing(item);
            return { ...item, ...calc };
        });

        const totals = calculateEstimateTotals(processedItems);

        await pool.query(
            `UPDATE estimates SET
                customer_name = ?, customer_phone = ?, customer_address = ?,
                estimate_date = ?, valid_until = ?, branch_id = ?,
                subtotal = ?, gst_amount = ?, grand_total = ?,
                total_markup = ?, total_discount = ?, total_labor = ?,
                show_gst_breakdown = ?, column_visibility = ?, show_description_only = ?,
                notes = ?, admin_notes = ?,
                last_updated_at = NOW()
            WHERE id = ?`,
            [
                customer_name, customer_phone, customer_address || null,
                estimate_date, valid_until || null, branch_id || null,
                totals.subtotal, totals.gst_amount, totals.grand_total,
                totals.total_markup, totals.total_discount, totals.total_labor,
                show_gst_breakdown ? 1 : 0, column_visibility || null, show_description_only ? 1 : 0,
                notes || null, admin_notes || null, estimateId
            ]
        );

        // Replace items
        await pool.query('DELETE FROM estimate_items WHERE estimate_id = ?', [estimateId]);

        if (processedItems.length > 0) {
            const itemValues = processedItems.map(item => [
                estimateId,
                item.item_type || 'product',
                item.product_id || null,
                item.zoho_item_id || null,
                item.item_name || item.item_description || null,
                item.brand || null,
                item.category || null,
                item.image_url || null,
                item.pack_size || null,
                item.product_type || null,
                item.custom_description || null,
                item.show_description_only != null ? (item.show_description_only ? 1 : 0) : null,
                item.item_description || item.item_name || null,
                item.quantity || 1,
                item.area || null,
                item.mix_info || null,
                item.num_coats || 1,
                item.base_price || item.unit_price || 0,
                item.markup_type || null,
                item.markup_value || 0,
                item.markup_amount || 0,
                item.price_after_markup || item.unit_price || 0,
                item.discount_type || null,
                item.discount_value || 0,
                item.discount_amount || 0,
                item.final_price || item.unit_price || 0,
                item.unit_price || 0,
                item.breakdown_cost || null,
                item.color_cost || 0,
                item.line_total || 0,
                item.display_order || 0,
                item.labor_description || null,
                item.labor_taxable != null ? (item.labor_taxable ? 1 : 0) : 1
            ]);

            await pool.query(
                `INSERT INTO estimate_items (
                    estimate_id, item_type, product_id, zoho_item_id, item_name,
                    brand, category, image_url, pack_size, product_type,
                    custom_description, show_description_only,
                    item_description, quantity, area, mix_info, num_coats,
                    base_price, markup_type, markup_value, markup_amount, price_after_markup,
                    discount_type, discount_value, discount_amount, final_price,
                    unit_price, breakdown_cost, color_cost, line_total, display_order,
                    labor_description, labor_taxable
                ) VALUES ?`,
                [itemValues]
            );
        }

        res.json({ success: true, message: 'Estimate updated successfully' });
    } catch (err) {
        console.error('Update estimate error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// DELETE ESTIMATE (preserves existing behavior — no status guard)
// ========================================
router.delete('/:id', requirePermission('estimates', 'delete'), async (req, res) => {
    try {
        const estimateId = req.params.id;
        const [estimate] = await pool.query('SELECT * FROM estimates WHERE id = ?', [estimateId]);
        if (estimate.length === 0) return res.status(404).json({ error: 'Estimate not found' });

        await pool.query('DELETE FROM estimate_items WHERE estimate_id = ?', [estimateId]);
        await pool.query('DELETE FROM estimates WHERE id = ?', [estimateId]);
        res.json({ success: true, message: 'Estimate deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// UPDATE STATUS (PATCH — preserves existing method + history logging)
// ========================================
router.patch('/:id/status', requirePermission('estimates', 'edit'), async (req, res) => {
    try {
        const { status, reason, notes } = req.body;
        const estimateId = req.params.id;

        const [current] = await pool.query('SELECT status FROM estimates WHERE id = ?', [estimateId]);
        if (current.length === 0) return res.status(404).json({ error: 'Estimate not found' });

        const oldStatus = current[0].status;

        const setClauses = ['status = ?', 'last_updated_at = NOW()'];
        const params = [status];

        if (status === 'approved') {
            setClauses.push('approved_by_admin_id = ?', 'approved_at = NOW()');
            params.push(req.user.id);
        }

        params.push(estimateId);
        await pool.query(`UPDATE estimates SET ${setClauses.join(', ')} WHERE id = ?`, params);

        await pool.query(
            'INSERT INTO estimate_status_history (estimate_id, old_status, new_status, changed_by_user_id, reason, notes) VALUES (?, ?, ?, ?, ?, ?)',
            [estimateId, oldStatus, status, req.user.id, reason, notes]
        );

        res.json({ success: true, message: 'Status updated successfully' });
    } catch (err) {
        console.error('Update status error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// ESTIMATE HISTORY (uses estimate_status_history table)
// ========================================
router.get('/:id/history', requirePermission('estimates', 'view'), async (req, res) => {
    try {
        const [history] = await pool.query(`
            SELECT h.*, u.full_name as changed_by_name
            FROM estimate_status_history h
            LEFT JOIN users u ON h.changed_by_user_id = u.id
            WHERE h.estimate_id = ?
            ORDER BY h.timestamp DESC
        `, [req.params.id]);
        res.json(history);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = { router, setPool };
```

- [ ] **Step 2: Update `server.js` — remove inline routes, mount new router**

In `server.js`, add near the top requires (around line 44):
```js
const estimateRoutes = require('./routes/estimates');
```

After pool is created (around line 188):
```js
estimateRoutes.setPool(pool);
```

Mount the router (around line 275, near existing estimate PDF mount):
```js
app.use('/api/estimates', requireAuth, estimateRoutes.router);
```

Then **delete** the inline estimate routes from lines 3116-3350 (the 8 `app.get/post/put/patch/delete('/api/estimates...')` handlers — list, get, create, update, items, status, delete, history).

**Important:** The existing `estimatePdfRoutes` mount at line 275 (`app.use('/api/estimates', estimatePdfRoutes.router)`) must remain — it handles PDF generation. The new router and PDF router both mount on `/api/estimates` — Express merges them. The PDF routes use specific paths like `/:id/pdf` that won't conflict.

- [ ] **Step 3: Commit**

```bash
git add routes/estimates.js server.js
git commit -m "feat: extract estimate routes to routes/estimates.js with markup/discount/labor calculation engine"
```

---

### Task 3: Frontend — Markup & Discount UI per Product

**Files:**
- Modify: `public/estimate-create-new.html`

This task enhances the `estimateItems` data structure, the `addProductToEstimate()` function, and `renderEstimateTable()` to support per-product markup and discount with inline dropdowns.

- [ ] **Step 1: Update app state and item structure**

Add to the APP STATE section (after line 475):
```js
// Labor items (separate from product items)
let laborItems = [];
let laborIdCounter = 1;

// Global description toggle
let globalShowDescOnly = false;
```

- [ ] **Step 2: Add markup/discount calculation function**

Add after `formatCurrency` function (after line 607):
```js
// ========================================
// MARKUP / DISCOUNT CALCULATION
// ========================================
function calcMarkup(basePrice, quantity, markupType, markupValue) {
    if (!markupType || !markupValue) return 0;
    const mv = parseFloat(markupValue) || 0;
    switch (markupType) {
        case 'price_pct': return basePrice * mv / 100;
        case 'price_value': return mv;
        case 'total_pct': return (basePrice * quantity) * mv / 100 / quantity;
        case 'total_value': return mv / quantity;
        default: return 0;
    }
}

function calcDiscount(priceAfterMarkup, quantity, discountType, discountValue) {
    if (!discountType || !discountValue) return 0;
    const dv = parseFloat(discountValue) || 0;
    switch (discountType) {
        case 'price_pct': return priceAfterMarkup * dv / 100;
        case 'price_value': return dv;
        case 'total_pct': return (priceAfterMarkup * quantity) * dv / 100 / quantity;
        case 'total_value': return dv / quantity;
        default: return 0;
    }
}

function recalcItem(item) {
    const bp = parseFloat(item.base_price) || 0;
    const qty = parseFloat(item.quantity) || 1;
    item.markup_amount = calcMarkup(bp, qty, item.markup_type, item.markup_value);
    item.price_after_markup = bp + item.markup_amount;
    item.discount_amount = calcDiscount(item.price_after_markup, qty, item.discount_type, item.discount_value);
    item.final_price = item.price_after_markup - item.discount_amount;
    item.line_total = item.final_price * qty;
    item.unit_price = item.final_price;
    item.total = item.line_total;
}
```

- [ ] **Step 3: Update `addProductToEstimate()` to include base_price and new fields**

Modify the existing function. After line 916 where `item` is first created, add:
```js
item.base_price = 0;
item.markup_type = null;
item.markup_value = 0;
item.markup_amount = 0;
item.price_after_markup = 0;
item.discount_type = null;
item.discount_value = 0;
item.discount_amount = 0;
item.final_price = 0;
item.custom_description = '';
item.show_description_only = null; // null = follow global
item.item_type = 'product';
```

In the unit branch (around line 951-953), change:
```js
item.base_price = pack.price;
item.unit_price = pack.price;
item.final_price = pack.price;
item.price_after_markup = pack.price;
item.total = quantity * pack.price;
item.line_total = item.total;
```

In the area branch (around line 962-964), change:
```js
item.base_price = totalPrice / totalLiters;
item.unit_price = item.base_price;
item.final_price = item.base_price;
item.price_after_markup = item.base_price;
item.total = totalPrice;
item.line_total = totalPrice;
```

- [ ] **Step 4: Update `renderEstimateTable()` with markup/discount/description columns**

Replace the entire `renderEstimateTable()` function. The new version renders each product row with:
- Product name + edit description icon + description textarea
- Show description only toggle (radio)
- Base price, markup dropdown, discount dropdown
- Calculated final price x qty = line total

The markup/discount dropdowns are inline `<select>` + `<input>` combos that call `onItemMarkupChange(itemId)` / `onItemDiscountChange(itemId)` which recalculates and re-renders.

Key render changes:
- Each row gets a richer structure with expandable sections
- Markup dropdown: `<select>` with options (None, Price %, Price Rs, Total %, Total Rs) + value `<input>`
- Discount dropdown: same pattern
- Description: textarea that shows on edit icon click
- Show desc only: checkbox per item

```js
function renderEstimateTable() {
    const tbody = document.getElementById('itemsTableBody');
    const cv = columnVisibility;

    if (estimateItems.length === 0 && laborItems.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="text-center py-8 text-gray-500">No items added yet</td></tr>';
        updateTotals();
        updateTogglePills();
        return;
    }

    // Simplified header — product rows are card-style now
    const thead = tbody.closest('table').querySelector('thead tr');
    thead.innerHTML = `
        <th class="px-4 py-3 text-left">#</th>
        <th class="px-4 py-3 text-left">Product</th>
        <th class="px-4 py-3 text-right">Base Price</th>
        <th class="px-4 py-3 text-center">Markup</th>
        <th class="px-4 py-3 text-center">Discount</th>
        <th class="px-4 py-3 text-right">Final Price</th>
        <th class="px-4 py-3 text-right">Qty</th>
        <th class="px-4 py-3 text-right">Line Total</th>
        <th class="px-4 py-3 text-center">Action</th>
    `;

    tbody.innerHTML = estimateItems.map((item, idx) => {
        const descId = `desc_${item.id}`;
        const showDescOnly = item.show_description_only != null ? item.show_description_only : globalShowDescOnly;
        const displayName = showDescOnly && item.custom_description ? item.custom_description : item.product_name;

        return `<tr class="border-b">
            <td class="px-4 py-3 align-top">${idx + 1}</td>
            <td class="px-4 py-3 align-top" style="min-width:200px">
                <div class="font-semibold text-sm">${escHtml(displayName)}</div>
                ${item.custom_description ? `<div class="text-xs text-gray-500 mt-1" style="white-space:pre-line">${escHtml(item.custom_description)}</div>` : ''}
                <div class="flex items-center gap-2 mt-1">
                    <button onclick="toggleDescEdit(${item.id})" class="text-xs text-purple-600 hover:underline">Edit Desc</button>
                    <label class="text-xs text-gray-500 flex items-center gap-1">
                        <input type="checkbox" ${showDescOnly ? 'checked' : ''} onchange="toggleItemDescOnly(${item.id}, this.checked)" class="w-3 h-3">
                        Desc only
                    </label>
                </div>
                <textarea id="${descId}" class="hidden w-full mt-1 p-2 border rounded text-xs" rows="2"
                    placeholder="Custom description..." onblur="saveDesc(${item.id}, this.value)">${item.custom_description || ''}</textarea>
                <div class="text-xs text-gray-400 mt-1">${item.details || ''}</div>
            </td>
            <td class="px-4 py-3 text-right align-top">${formatCurrency(item.base_price)}</td>
            <td class="px-4 py-3 align-top" style="min-width:160px">
                <select onchange="onItemMarkupTypeChange(${item.id}, this.value)" class="w-full text-xs border rounded px-1 py-1 mb-1">
                    <option value="" ${!item.markup_type ? 'selected' : ''}>None</option>
                    <option value="price_pct" ${item.markup_type === 'price_pct' ? 'selected' : ''}>Price %</option>
                    <option value="price_value" ${item.markup_type === 'price_value' ? 'selected' : ''}>Price ₹</option>
                    <option value="total_pct" ${item.markup_type === 'total_pct' ? 'selected' : ''}>Total %</option>
                    <option value="total_value" ${item.markup_type === 'total_value' ? 'selected' : ''}>Total ₹</option>
                </select>
                ${item.markup_type ? `
                    <input type="number" value="${item.markup_value || ''}" min="0" step="0.01"
                        onchange="onItemMarkupValueChange(${item.id}, this.value)"
                        class="w-full text-xs border rounded px-2 py-1"
                        placeholder="Value">
                    <div class="text-xs text-green-600 mt-1">+${formatCurrency(item.markup_amount)}</div>
                ` : ''}
            </td>
            <td class="px-4 py-3 align-top" style="min-width:160px">
                <select onchange="onItemDiscountTypeChange(${item.id}, this.value)" class="w-full text-xs border rounded px-1 py-1 mb-1">
                    <option value="" ${!item.discount_type ? 'selected' : ''}>None</option>
                    <option value="price_pct" ${item.discount_type === 'price_pct' ? 'selected' : ''}>Price %</option>
                    <option value="price_value" ${item.discount_type === 'price_value' ? 'selected' : ''}>Price ₹</option>
                    <option value="total_pct" ${item.discount_type === 'total_pct' ? 'selected' : ''}>Total %</option>
                    <option value="total_value" ${item.discount_type === 'total_value' ? 'selected' : ''}>Total ₹</option>
                </select>
                ${item.discount_type ? `
                    <input type="number" value="${item.discount_value || ''}" min="0" step="0.01"
                        onchange="onItemDiscountValueChange(${item.id}, this.value)"
                        class="w-full text-xs border rounded px-2 py-1"
                        placeholder="Value">
                    <div class="text-xs text-red-600 mt-1">-${formatCurrency(item.discount_amount)}</div>
                ` : ''}
            </td>
            <td class="px-4 py-3 text-right align-top font-semibold">${formatCurrency(item.final_price)}</td>
            <td class="px-4 py-3 text-right align-top">${parseFloat(item.quantity).toFixed(2)}</td>
            <td class="px-4 py-3 text-right align-top font-bold">${formatCurrency(item.line_total)}</td>
            <td class="px-4 py-3 text-center align-top">
                <button onclick="removeItem(${item.id})" class="text-red-600 hover:text-red-800 text-sm">Remove</button>
            </td>
        </tr>`;
    }).join('');

    updateTotals();
    updateTogglePills();
}

function escHtml(str) {
    if (!str) return '';
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
```

- [ ] **Step 5: Add markup/discount/description event handlers**

```js
// ========================================
// ITEM EVENT HANDLERS
// ========================================
function onItemMarkupTypeChange(itemId, type) {
    const item = estimateItems.find(i => i.id === itemId);
    if (!item) return;
    item.markup_type = type || null;
    if (!type) { item.markup_value = 0; item.markup_amount = 0; }
    recalcItem(item);
    renderEstimateTable();
}

function onItemMarkupValueChange(itemId, value) {
    const item = estimateItems.find(i => i.id === itemId);
    if (!item) return;
    item.markup_value = parseFloat(value) || 0;
    recalcItem(item);
    renderEstimateTable();
}

function onItemDiscountTypeChange(itemId, type) {
    const item = estimateItems.find(i => i.id === itemId);
    if (!item) return;
    item.discount_type = type || null;
    if (!type) { item.discount_value = 0; item.discount_amount = 0; }
    recalcItem(item);
    renderEstimateTable();
}

function onItemDiscountValueChange(itemId, value) {
    const item = estimateItems.find(i => i.id === itemId);
    if (!item) return;
    item.discount_value = parseFloat(value) || 0;
    recalcItem(item);
    renderEstimateTable();
}

function toggleDescEdit(itemId) {
    const textarea = document.getElementById(`desc_${itemId}`);
    if (textarea) {
        textarea.classList.toggle('hidden');
        if (!textarea.classList.contains('hidden')) textarea.focus();
    }
}

function saveDesc(itemId, value) {
    const item = estimateItems.find(i => i.id === itemId);
    if (item) {
        item.custom_description = value;
        renderEstimateTable();
    }
}

function toggleItemDescOnly(itemId, checked) {
    const item = estimateItems.find(i => i.id === itemId);
    if (item) {
        item.show_description_only = checked ? 1 : 0;
        renderEstimateTable();
    }
}
```

- [ ] **Step 6: Commit**

```bash
git add public/estimate-create-new.html
git commit -m "feat: add markup/discount dropdowns and description editing to estimate items"
```

---

### Task 4: Frontend — Labor Charges Section

**Files:**
- Modify: `public/estimate-create-new.html`

- [ ] **Step 1: Add Labor Charges HTML section**

Insert after the Products Table `</div>` (after line 278) and before the Save Estimate section (line 280):

```html
<!-- Labor Charges -->
<div class="bg-white rounded-xl shadow-lg p-6 mb-6">
    <div class="flex justify-between items-center mb-4">
        <h2 class="text-lg font-bold text-gray-800">Labor Charges</h2>
        <button onclick="addLaborItem()" class="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-semibold">
            + Add Labor Item
        </button>
    </div>
    <div id="laborItemsContainer">
        <p id="noLaborMsg" class="text-center py-4 text-gray-500 text-sm">No labor charges added</p>
    </div>
    <div id="laborTotal" class="hidden mt-4 pt-3 border-t flex justify-between font-semibold">
        <span>Labor Total:</span>
        <span id="laborTotalAmount">₹0.00</span>
    </div>
</div>
```

- [ ] **Step 2: Add labor JS functions**

```js
// ========================================
// LABOR CHARGES
// ========================================
function addLaborItem() {
    laborItems.push({
        id: laborIdCounter++,
        item_type: 'labor',
        labor_description: '',
        base_price: 0,
        quantity: 1,
        labor_taxable: true,
        line_total: 0
    });
    renderLaborItems();
}

function removeLaborItem(id) {
    laborItems = laborItems.filter(l => l.id !== id);
    renderLaborItems();
    updateTotals();
}

function onLaborChange(id, field, value) {
    const item = laborItems.find(l => l.id === id);
    if (!item) return;

    if (field === 'labor_description') item.labor_description = value;
    else if (field === 'base_price') {
        item.base_price = parseFloat(value) || 0;
        item.line_total = item.base_price * item.quantity;
    }
    else if (field === 'quantity') {
        item.quantity = parseFloat(value) || 1;
        item.line_total = item.base_price * item.quantity;
    }
    else if (field === 'labor_taxable') item.labor_taxable = value;

    renderLaborItems();
    updateTotals();
}

function renderLaborItems() {
    const container = document.getElementById('laborItemsContainer');
    const noMsg = document.getElementById('noLaborMsg');
    const totalDiv = document.getElementById('laborTotal');

    if (laborItems.length === 0) {
        container.innerHTML = '<p id="noLaborMsg" class="text-center py-4 text-gray-500 text-sm">No labor charges added</p>';
        totalDiv.classList.add('hidden');
        return;
    }

    container.innerHTML = laborItems.map((l, idx) => `
        <div class="flex items-center gap-3 mb-2 p-3 bg-gray-50 rounded-lg">
            <span class="text-sm font-semibold text-gray-500 w-6">${idx + 1}.</span>
            <input type="text" value="${escHtml(l.labor_description)}" placeholder="Description (e.g. Installation)"
                onchange="onLaborChange(${l.id}, 'labor_description', this.value)"
                class="flex-1 px-3 py-2 border rounded-lg text-sm">
            <input type="number" value="${l.base_price || ''}" min="0" step="1" placeholder="Amount"
                onchange="onLaborChange(${l.id}, 'base_price', this.value)"
                class="w-28 px-3 py-2 border rounded-lg text-sm text-right">
            <label class="flex items-center gap-1 text-xs text-gray-600 whitespace-nowrap">
                <input type="checkbox" ${l.labor_taxable ? 'checked' : ''}
                    onchange="onLaborChange(${l.id}, 'labor_taxable', this.checked)">
                Taxable
            </label>
            <button onclick="removeLaborItem(${l.id})" class="text-red-500 hover:text-red-700 text-lg font-bold">&times;</button>
        </div>
    `).join('');

    const laborTotal = laborItems.reduce((sum, l) => sum + (l.line_total || 0), 0);
    document.getElementById('laborTotalAmount').textContent = formatCurrency(laborTotal);
    totalDiv.classList.remove('hidden');
}
```

- [ ] **Step 3: Update `updateTotals()` to include labor and markup/discount breakdowns**

Replace the existing `updateTotals()`:

```js
function updateTotals() {
    const productTotal = estimateItems.reduce((sum, item) => sum + (item.line_total || item.total || 0), 0);
    const totalMarkup = estimateItems.reduce((sum, item) => sum + ((item.markup_amount || 0) * (item.quantity || 1)), 0);
    const totalDiscount = estimateItems.reduce((sum, item) => sum + ((item.discount_amount || 0) * (item.quantity || 1)), 0);
    const laborTotal = laborItems.reduce((sum, l) => sum + (l.line_total || 0), 0);
    const grandTotal = productTotal + laborTotal;

    // Update summary display
    document.getElementById('subtotal').textContent = formatCurrency(productTotal);
    document.getElementById('gstAmount').textContent = formatCurrency(0);
    document.getElementById('grandTotal').textContent = formatCurrency(grandTotal);

    // Show/hide markup/discount/labor summary rows
    const summaryDiv = document.getElementById('subtotal').closest('.w-64') || document.getElementById('subtotal').parentElement.parentElement;

    // Update the summary section with full breakdown
    const totalSection = document.querySelector('.mt-6.border-t.pt-4 .flex.justify-end');
    if (totalSection) {
        totalSection.innerHTML = `
            <div class="w-80 space-y-2 text-sm">
                <div class="flex justify-between">
                    <span class="text-gray-600">Subtotal (products):</span>
                    <span>${formatCurrency(productTotal)}</span>
                </div>
                ${totalMarkup > 0 ? `<div class="flex justify-between text-green-600">
                    <span>Total Markup:</span>
                    <span>+${formatCurrency(totalMarkup)}</span>
                </div>` : ''}
                ${totalDiscount > 0 ? `<div class="flex justify-between text-red-600">
                    <span>Total Discount:</span>
                    <span>-${formatCurrency(totalDiscount)}</span>
                </div>` : ''}
                ${laborTotal > 0 ? `<div class="flex justify-between text-blue-600">
                    <span>Labor Charges:</span>
                    <span>+${formatCurrency(laborTotal)}</span>
                </div>` : ''}
                <div class="flex justify-between text-lg font-bold border-t pt-2">
                    <span>Grand Total:</span>
                    <span>${formatCurrency(grandTotal)}</span>
                </div>
                <div class="text-xs text-gray-400 text-right">(Prices inclusive of GST)</div>
            </div>
        `;
    }
}
```

- [ ] **Step 4: Commit**

```bash
git add public/estimate-create-new.html
git commit -m "feat: add labor charges section with taxable toggle to estimate page"
```

---

### Task 5: Frontend — Global Show Description Only Toggle + Save Estimate Update

**Files:**
- Modify: `public/estimate-create-new.html`

- [ ] **Step 1: Add global "Show Description Only" toggle**

Add to the column toggles area (around line 234, after the GST pill):
```html
<span class="text-gray-300 self-center">|</span>
<label class="flex items-center gap-1 text-xs cursor-pointer">
    <input type="checkbox" id="globalDescOnlyToggle" onchange="toggleGlobalDescOnly(this.checked)" class="w-3 h-3">
    <span class="text-gray-600 font-medium">Description Only</span>
</label>
```

Add the JS handler:
```js
function toggleGlobalDescOnly(checked) {
    globalShowDescOnly = checked;
    renderEstimateTable();
}
```

- [ ] **Step 2: Update `saveEstimate()` to include all new fields**

Replace the `saveEstimate()` function to send the enhanced payload with markup, discount, labor, description data:

```js
async function saveEstimate() {
    if (!selectedCustomer) {
        alert('Please select a customer');
        return;
    }
    if (estimateItems.length === 0) {
        alert('Please add at least one product');
        return;
    }

    // Build API items — products + labor
    const apiItems = [
        ...estimateItems.map((item, idx) => ({
            item_type: 'product',
            product_id: item.product_id,
            zoho_item_id: item.zoho_item_id || null,
            item_name: item.product_name,
            image_url: item.image_url || null,
            item_description: item.product_name,
            brand: item.brand || null,
            category: item.category || null,
            pack_size: item.pack_size || null,
            product_type: item.type || 'unit',
            custom_description: item.custom_description || null,
            show_description_only: item.show_description_only,
            quantity: item.quantity,
            area: item.type === 'area' ? item.quantity : null,
            mix_info: item.details,
            num_coats: item.num_coats || 1,
            base_price: item.base_price,
            unit_price: item.final_price || item.unit_price,
            markup_type: item.markup_type || null,
            markup_value: item.markup_value || 0,
            discount_type: item.discount_type || null,
            discount_value: item.discount_value || 0,
            breakdown_cost: null,
            color_cost: 0,
            line_total: item.line_total || item.total,
            display_order: idx + 1
        })),
        ...laborItems.map((l, idx) => ({
            item_type: 'labor',
            item_name: l.labor_description,
            labor_description: l.labor_description,
            base_price: l.base_price,
            quantity: l.quantity || 1,
            labor_taxable: l.labor_taxable,
            line_total: l.line_total,
            display_order: estimateItems.length + idx + 1
        }))
    ];

    const estimateData = {
        customer_name: selectedCustomer.name,
        customer_phone: selectedCustomer.phone,
        customer_address: selectedCustomer.address,
        estimate_date: new Date().toISOString().split('T')[0],
        show_gst_breakdown: false,
        column_visibility: JSON.stringify(columnVisibility),
        show_description_only: globalShowDescOnly,
        notes: '',
        status: 'draft',
        items: apiItems
    };

    try {
        const response = await apiRequest('/api/estimates', {
            method: 'POST',
            body: JSON.stringify(estimateData)
        });

        const result = await response.json();

        if (response.ok && result.success) {
            const urlParams = new URLSearchParams(window.location.search);
            const requestId = urlParams.get('from_request');
            if (requestId) {
                await markRequestAsConverted(requestId, result.id || result.estimate_id);
            }

            const estNum = result.estimate_number || result.id;
            const estId = result.id || result.estimate_id;
            if (confirm('Estimate #' + estNum + ' created! Open print preview?')) {
                window.location.href = 'estimate-print.html?id=' + estId;
            } else {
                window.location.href = 'estimates.html';
            }
        } else {
            alert('Failed to save estimate: ' + (result.message || result.error || 'Unknown error'));
        }
    } catch (error) {
        console.error('Error saving estimate:', error);
        alert('Error saving estimate: ' + error.message);
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add public/estimate-create-new.html
git commit -m "feat: add global description-only toggle and update save with full markup/discount/labor payload"
```

---

### Task 6: Deploy and Test

- [ ] **Step 1: Deploy to server**

```bash
ssh root@161.97.114.189 "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && npm install && pm2 restart business-manager"
```

- [ ] **Step 2: Test end-to-end**

1. Open https://act.qcpaintshop.com/estimate-create-new.html
2. Select a customer
3. Add a product — verify base price shows
4. Set markup (Price %, 10%) — verify +amount shows, final price updates
5. Set discount (Price %, 5%) — verify -amount shows, final price recalculates from marked-up price
6. Edit description — verify textarea appears, text saves
7. Check "Desc only" — verify product name replaced by description
8. Add a labor item — verify it appears in labor section with total
9. Check summary: subtotal, markup, discount, labor, grand total
10. Toggle global "Description Only"
11. Save estimate — verify it creates successfully
12. Check DB: `SELECT * FROM estimates ORDER BY id DESC LIMIT 1` — verify `total_markup`, `total_discount`, `total_labor` populated
13. Check DB: `SELECT * FROM estimate_items WHERE estimate_id = X` — verify new columns populated

- [ ] **Step 3: Commit any fixes**

```bash
git add -A
git commit -m "fix: post-deployment adjustments for estimate enhancements"
```
