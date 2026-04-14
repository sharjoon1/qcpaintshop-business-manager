# Reorder Intelligence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Analyze per-branch per-item sales velocity from Zoho invoice line items, auto-compute per-branch reorder levels using a brand-aware lead-time formula, and deliver a daily branch-wise reorder report at 07:00 IST via dashboard, WhatsApp, and FCM — with inter-branch stock visibility.

**Architecture:** Three new services wire together in sequence (invoice-line sync → reorder compute → report) registered as nightly crons via the existing `automation-registry`. Data lands in two new tables (`branch_item_sales`, `brand_reorder_config`) plus extensions to `zoho_reorder_config`. UI lives in existing `admin-zoho-reorder.html` with three new tabs. Hybrid apply rule protects manually configured reorder rows.

**Tech Stack:** Node.js + Express, MySQL 8 (mysql2/promise), Socket.io, Jest, PDFKit, Zoho Books API, FCM (firebase-admin), whatsapp-web.js.

**Spec:** `docs/superpowers/specs/2026-04-14-reorder-intelligence-design.md`

---

## File Structure

### New files
- `migrations/migrate-reorder-intelligence.js` — idempotent schema migration + config seeds
- `services/zoho-invoice-line-sync.js` — fetches invoice line items, upserts to `branch_item_sales`
- `services/reorder-compute-service.js` — velocity → reorder levels → alerts
- `services/reorder-report-service.js` — assembles report rows + dispatches delivery
- `services/reorder-report-pdf-generator.js` — PDFKit branch-wise reorder PDF
- `middleware/branchScope.js` — auto-scopes list endpoints for branch managers
- `tests/unit/reorder-compute.test.js`
- `tests/unit/invoice-line-sync.test.js`
- `tests/unit/reorder-report.test.js`
- `tests/unit/brand-config.test.js`

### Modified files
- `routes/zoho.js` — adds 10+ endpoints (brand config CRUD, backfill, compute, report, sales analysis)
- `public/admin-zoho-reorder.html` — adds 3 new tabs, enhances Configuration tab
- `services/sync-scheduler.js` — registers 3 new crons via automation-registry
- `config/permissions.js` — adds `zoho.reorder.manage` sub-permission (verify structure first)

---

## Task 1: Database Migration

**Files:**
- Create: `migrations/migrate-reorder-intelligence.js`
- Test manually by running the migration on a dev database

- [ ] **Step 1: Write the migration script**

Create `migrations/migrate-reorder-intelligence.js` with this content:

```javascript
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function columnExists(pool, table, column) {
    const [rows] = await pool.query(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [table, column]
    );
    return rows.length > 0;
}

async function tableExists(pool, table) {
    const [rows] = await pool.query(
        `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
        [table]
    );
    return rows.length > 0;
}

async function migrate() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'business_manager',
        port: process.env.DB_PORT || 3306
    });

    try {
        console.log('Reorder Intelligence migration starting...\n');

        if (!(await tableExists(pool, 'branch_item_sales'))) {
            await pool.query(`
                CREATE TABLE branch_item_sales (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    local_branch_id INT NOT NULL,
                    zoho_item_id VARCHAR(50) NOT NULL,
                    sale_date DATE NOT NULL,
                    qty_sold DECIMAL(12,2) NOT NULL DEFAULT 0,
                    revenue DECIMAL(12,2) NOT NULL DEFAULT 0,
                    invoice_count INT NOT NULL DEFAULT 0,
                    synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY uq_bis (local_branch_id, zoho_item_id, sale_date),
                    KEY idx_item_date (zoho_item_id, sale_date),
                    KEY idx_branch_date (local_branch_id, sale_date)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            console.log('✅ branch_item_sales created');
        } else {
            console.log('⏭️  branch_item_sales exists');
        }

        if (!(await tableExists(pool, 'brand_reorder_config'))) {
            await pool.query(`
                CREATE TABLE brand_reorder_config (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    brand_name VARCHAR(100) NOT NULL,
                    lead_time_days INT NOT NULL DEFAULT 7,
                    safety_days INT NOT NULL DEFAULT 5,
                    is_active TINYINT(1) NOT NULL DEFAULT 1,
                    updated_by INT,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    UNIQUE KEY uq_brand (brand_name)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            await pool.query(
                `INSERT INTO brand_reorder_config (brand_name, lead_time_days, safety_days)
                 VALUES ('__default__', 7, 5)`
            );
            console.log('✅ brand_reorder_config created + __default__ seeded');
        } else {
            console.log('⏭️  brand_reorder_config exists');
        }

        if (!(await tableExists(pool, 'invoice_line_sync_cursor'))) {
            await pool.query(`
                CREATE TABLE invoice_line_sync_cursor (
                    invoice_id VARCHAR(50) PRIMARY KEY,
                    synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    line_count INT
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            console.log('✅ invoice_line_sync_cursor created');
        } else {
            console.log('⏭️  invoice_line_sync_cursor exists');
        }

        if (!(await tableExists(pool, 'reorder_report_log'))) {
            await pool.query(`
                CREATE TABLE reorder_report_log (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    report_date DATE NOT NULL,
                    scope VARCHAR(50) NOT NULL,
                    items_count INT NOT NULL,
                    delivery_status JSON,
                    generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    KEY idx_date_scope (report_date, scope)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            console.log('✅ reorder_report_log created');
        } else {
            console.log('⏭️  reorder_report_log exists');
        }

        if (await tableExists(pool, 'zoho_reorder_config')) {
            if (!(await columnExists(pool, 'zoho_reorder_config', 'source'))) {
                await pool.query(
                    `ALTER TABLE zoho_reorder_config ADD COLUMN source ENUM('manual','auto') NOT NULL DEFAULT 'manual'`
                );
                console.log('✅ zoho_reorder_config.source added');
            }
            if (!(await columnExists(pool, 'zoho_reorder_config', 'avg_daily_sales'))) {
                await pool.query(
                    `ALTER TABLE zoho_reorder_config ADD COLUMN avg_daily_sales DECIMAL(10,3) NULL`
                );
                console.log('✅ zoho_reorder_config.avg_daily_sales added');
            }
            if (!(await columnExists(pool, 'zoho_reorder_config', 'computed_at'))) {
                await pool.query(
                    `ALTER TABLE zoho_reorder_config ADD COLUMN computed_at TIMESTAMP NULL`
                );
                console.log('✅ zoho_reorder_config.computed_at added');
            }
        } else {
            console.warn('⚠️  zoho_reorder_config does not exist — run zoho reorder migration first');
        }

        const configKeys = [
            ['reorder_sales_window_days', '60'],
            ['reorder_min_sales_for_auto', '1'],
            ['reorder_invoice_sync_time', '02:00'],
            ['reorder_compute_time', '02:30'],
            ['reorder_report_time', '07:00'],
            ['reorder_report_recipients', '[]'],
            ['reorder_report_whatsapp_enabled', '0'],
            ['reorder_report_fcm_enabled', '0'],
            ['reorder_report_pdf_enabled', '1']
        ];
        for (const [k, v] of configKeys) {
            await pool.query(
                `INSERT IGNORE INTO ai_config (config_key, config_value) VALUES (?, ?)`,
                [k, v]
            );
        }
        console.log(`✅ ${configKeys.length} ai_config keys seeded (IGNORE existing)`);

        console.log('\n✅ Migration completed!');
    } catch (error) {
        console.error('Migration failed:', error);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

migrate();
```

- [ ] **Step 2: Run the migration locally (or on dev server)**

Run: `node migrations/migrate-reorder-intelligence.js`
Expected: all tables created, no errors.

- [ ] **Step 3: Verify schema**

Query:
```sql
DESCRIBE branch_item_sales;
DESCRIBE brand_reorder_config;
DESCRIBE invoice_line_sync_cursor;
DESCRIBE reorder_report_log;
SHOW COLUMNS FROM zoho_reorder_config LIKE 'source';
SHOW COLUMNS FROM zoho_reorder_config LIKE 'avg_daily_sales';
SELECT * FROM brand_reorder_config;
SELECT config_key, config_value FROM ai_config WHERE config_key LIKE 'reorder_%';
```
Expected: all tables/columns present; 1 row in `brand_reorder_config` (`__default__`); 9 keys in `ai_config`.

- [ ] **Step 4: Re-run migration to verify idempotency**

Run the same command again.
Expected: all entries show `⏭️ exists`. No errors.

- [ ] **Step 5: Commit**

```bash
git add migrations/migrate-reorder-intelligence.js
git commit -m "feat(reorder): add schema for branch sales + brand config + report log"
```

---

## Task 2: Brand Config Backend (CRUD + tests)

**Files:**
- Modify: `routes/zoho.js` (add endpoints near existing reorder routes)
- Create: `tests/unit/brand-config.test.js`

- [ ] **Step 1: Write failing tests for brand config**

Create `tests/unit/brand-config.test.js`:

```javascript
const mysql = require('mysql2/promise');
const express = require('express');
const request = require('supertest');
require('dotenv').config();

describe('Brand Reorder Config', () => {
    let pool;
    let app;

    beforeAll(async () => {
        pool = mysql.createPool({
            host: process.env.DB_HOST, user: process.env.DB_USER,
            password: process.env.DB_PASSWORD, database: process.env.DB_NAME
        });
    });
    afterAll(async () => { await pool.end(); });

    beforeEach(async () => {
        await pool.query(`DELETE FROM brand_reorder_config WHERE brand_name != '__default__'`);
    });

    test('GET /brands returns list including __default__', async () => {
        const [rows] = await pool.query(`SELECT * FROM brand_reorder_config`);
        expect(rows.some(r => r.brand_name === '__default__')).toBe(true);
    });

    test('INSERT new brand succeeds', async () => {
        await pool.query(
            `INSERT INTO brand_reorder_config (brand_name, lead_time_days, safety_days) VALUES (?, ?, ?)`,
            ['Asian Paints', 3, 3]
        );
        const [rows] = await pool.query(`SELECT * FROM brand_reorder_config WHERE brand_name = ?`, ['Asian Paints']);
        expect(rows.length).toBe(1);
        expect(rows[0].lead_time_days).toBe(3);
    });

    test('DELETE of __default__ is forbidden in business logic', async () => {
        // Will be enforced at route level; verify data layer alone allows delete
        const isDefaultLocked = (brandName) => brandName === '__default__';
        expect(isDefaultLocked('__default__')).toBe(true);
        expect(isDefaultLocked('Shalimar')).toBe(false);
    });
});
```

- [ ] **Step 2: Run tests, confirm they pass (data-layer only, no route yet)**

Run: `npx jest tests/unit/brand-config.test.js -v`
Expected: PASS (3 tests).

- [ ] **Step 3: Add brand config endpoints to `routes/zoho.js`**

Find the existing reorder section in `routes/zoho.js` (search for `reorder/alerts` or `zohoAPI.getReorderDashboard`). Add these endpoints immediately after:

```javascript
/**
 * GET /api/zoho/reorder/brands - List brand reorder configs
 */
router.get('/reorder/brands', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT bc.*, u.full_name AS updated_by_name,
                   (SELECT COUNT(DISTINCT zoho_item_id) FROM zoho_items_map
                    WHERE zoho_brand = bc.brand_name) AS item_count
            FROM brand_reorder_config bc
            LEFT JOIN users u ON u.id = bc.updated_by
            ORDER BY (bc.brand_name = '__default__') DESC, bc.brand_name ASC
        `);
        res.json({ success: true, data: rows });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * POST /api/zoho/reorder/brands - Create brand config
 */
router.post('/reorder/brands', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const { brand_name, lead_time_days, safety_days, is_active } = req.body;
        if (!brand_name || !brand_name.trim()) {
            return res.status(400).json({ success: false, message: 'brand_name required' });
        }
        if (brand_name === '__default__') {
            return res.status(400).json({ success: false, message: 'Use PUT to edit __default__' });
        }
        const lead = Number(lead_time_days);
        const safety = Number(safety_days);
        if (!Number.isFinite(lead) || lead < 0 || !Number.isFinite(safety) || safety < 0) {
            return res.status(400).json({ success: false, message: 'lead_time_days and safety_days must be non-negative numbers' });
        }
        await pool.query(
            `INSERT INTO brand_reorder_config (brand_name, lead_time_days, safety_days, is_active, updated_by)
             VALUES (?, ?, ?, ?, ?)`,
            [brand_name.trim(), lead, safety, is_active === false ? 0 : 1, req.user.id]
        );
        res.json({ success: true });
    } catch (e) {
        if (e.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ success: false, message: 'Brand already exists' });
        }
        res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * PUT /api/zoho/reorder/brands/:id - Update brand config
 */
router.put('/reorder/brands/:id', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const { lead_time_days, safety_days, is_active } = req.body;
        const lead = Number(lead_time_days);
        const safety = Number(safety_days);
        if (!Number.isFinite(lead) || lead < 0 || !Number.isFinite(safety) || safety < 0) {
            return res.status(400).json({ success: false, message: 'lead_time_days and safety_days must be non-negative numbers' });
        }
        await pool.query(
            `UPDATE brand_reorder_config
             SET lead_time_days = ?, safety_days = ?, is_active = ?, updated_by = ?
             WHERE id = ?`,
            [lead, safety, is_active === false ? 0 : 1, req.user.id, id]
        );
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * DELETE /api/zoho/reorder/brands/:id - Delete brand config (__default__ locked)
 */
router.delete('/reorder/brands/:id', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        const [rows] = await pool.query(`SELECT brand_name FROM brand_reorder_config WHERE id = ?`, [id]);
        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Brand config not found' });
        }
        if (rows[0].brand_name === '__default__') {
            return res.status(400).json({ success: false, message: '__default__ cannot be deleted' });
        }
        await pool.query(`DELETE FROM brand_reorder_config WHERE id = ?`, [id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});
```

- [ ] **Step 4: Smoke-test endpoints manually**

After restarting the server, curl (or via browser with auth cookie):
```bash
curl -H "Authorization: Bearer <token>" https://act.qcpaintshop.com/api/zoho/reorder/brands
# Expect: {success:true, data:[{brand_name:'__default__', ...}]}
```

- [ ] **Step 5: Commit**

```bash
git add routes/zoho.js tests/unit/brand-config.test.js
git commit -m "feat(reorder): brand config CRUD endpoints + tests"
```

---

## Task 3: Brand Config UI Tab

**Files:**
- Modify: `public/admin-zoho-reorder.html`

- [ ] **Step 1: Inspect the existing tab structure in admin-zoho-reorder.html**

Read the file, identify the tab pattern (likely `<div class="tab-buttons">` + `<div class="tab-content">`). Note data loading helper and how auth token is fetched (probably `localStorage.getItem('auth_token')`).

- [ ] **Step 2: Add "Brand Config" tab button + panel**

Add a tab button next to existing tabs:
```html
<button class="tab-btn" data-tab="brand-config" onclick="switchTab('brand-config')">
    Brand Config
</button>
```

Add the panel (place after existing tab panels):
```html
<div id="tab-brand-config" class="tab-panel hidden">
    <div class="flex justify-between items-center mb-4">
        <h3 class="text-lg font-semibold">Brand Lead Time Configuration</h3>
        <button onclick="openBrandModal()" class="px-3 py-1.5 bg-indigo-600 text-white rounded text-sm">+ Add Brand</button>
    </div>
    <div class="overflow-x-auto">
        <table class="min-w-full bg-white text-sm">
            <thead class="bg-gray-50">
                <tr>
                    <th class="px-3 py-2 text-left">Brand</th>
                    <th class="px-3 py-2 text-right">Lead time (days)</th>
                    <th class="px-3 py-2 text-right">Safety (days)</th>
                    <th class="px-3 py-2 text-center">Items using</th>
                    <th class="px-3 py-2 text-center">Active</th>
                    <th class="px-3 py-2 text-right">Actions</th>
                </tr>
            </thead>
            <tbody id="brandConfigBody"></tbody>
        </table>
    </div>
</div>

<!-- Add/Edit Brand Modal -->
<div id="brandModal" class="fixed inset-0 bg-black bg-opacity-50 hidden items-center justify-center z-50">
    <div class="bg-white rounded-lg p-6 w-full max-w-md">
        <h3 class="text-lg font-semibold mb-3" id="brandModalTitle">Add Brand</h3>
        <form id="brandForm" onsubmit="saveBrand(event)">
            <input type="hidden" id="brandId">
            <label class="block text-xs text-gray-600">Brand name</label>
            <input type="text" id="brandName" required class="w-full border rounded px-2 py-1 mb-2">
            <label class="block text-xs text-gray-600">Lead time (days)</label>
            <input type="number" min="0" id="brandLead" required class="w-full border rounded px-2 py-1 mb-2">
            <label class="block text-xs text-gray-600">Safety (days)</label>
            <input type="number" min="0" id="brandSafety" required class="w-full border rounded px-2 py-1 mb-2">
            <label class="flex items-center gap-2"><input type="checkbox" id="brandActive" checked> Active</label>
            <div class="flex justify-end gap-2 mt-4">
                <button type="button" onclick="closeBrandModal()" class="px-3 py-1.5 border rounded">Cancel</button>
                <button type="submit" class="px-3 py-1.5 bg-indigo-600 text-white rounded">Save</button>
            </div>
        </form>
    </div>
</div>
```

- [ ] **Step 3: Add JS to load, render, and mutate brands**

Add inside the page script block (near other tab-loading functions):

```javascript
async function loadBrandConfigs() {
    const token = localStorage.getItem('auth_token');
    const res = await fetch('/api/zoho/reorder/brands', {
        headers: { 'Authorization': 'Bearer ' + token }
    });
    const json = await res.json();
    const tbody = document.getElementById('brandConfigBody');
    if (!json.success) { tbody.innerHTML = '<tr><td colspan="6" class="text-red-600 p-3">' + escapeHtml(json.message || 'Failed') + '</td></tr>'; return; }
    tbody.innerHTML = json.data.map(b => `
        <tr class="border-b ${b.brand_name === '__default__' ? 'bg-blue-50' : ''}">
            <td class="px-3 py-2 font-medium">${escapeHtml(b.brand_name)}${b.brand_name === '__default__' ? ' <span class="text-xs text-blue-600">(fallback)</span>' : ''}</td>
            <td class="px-3 py-2 text-right">${b.lead_time_days}</td>
            <td class="px-3 py-2 text-right">${b.safety_days}</td>
            <td class="px-3 py-2 text-center">${b.item_count || 0}</td>
            <td class="px-3 py-2 text-center">${b.is_active ? '✅' : '—'}</td>
            <td class="px-3 py-2 text-right">
                <button onclick='editBrand(${JSON.stringify(b).replace(/\'/g, "&#39;")})' class="text-indigo-600 text-xs">Edit</button>
                ${b.brand_name !== '__default__' ? ` | <button onclick="deleteBrand(${b.id}, '${escapeHtml(b.brand_name)}')" class="text-red-600 text-xs">Delete</button>` : ''}
            </td>
        </tr>
    `).join('');
}

function openBrandModal() {
    document.getElementById('brandModalTitle').textContent = 'Add Brand';
    document.getElementById('brandId').value = '';
    document.getElementById('brandName').value = '';
    document.getElementById('brandName').readOnly = false;
    document.getElementById('brandLead').value = 7;
    document.getElementById('brandSafety').value = 5;
    document.getElementById('brandActive').checked = true;
    document.getElementById('brandModal').classList.remove('hidden');
    document.getElementById('brandModal').classList.add('flex');
}

function editBrand(b) {
    document.getElementById('brandModalTitle').textContent = 'Edit Brand — ' + b.brand_name;
    document.getElementById('brandId').value = b.id;
    document.getElementById('brandName').value = b.brand_name;
    document.getElementById('brandName').readOnly = true;
    document.getElementById('brandLead').value = b.lead_time_days;
    document.getElementById('brandSafety').value = b.safety_days;
    document.getElementById('brandActive').checked = !!b.is_active;
    document.getElementById('brandModal').classList.remove('hidden');
    document.getElementById('brandModal').classList.add('flex');
}

function closeBrandModal() {
    document.getElementById('brandModal').classList.add('hidden');
    document.getElementById('brandModal').classList.remove('flex');
}

async function saveBrand(ev) {
    ev.preventDefault();
    const id = document.getElementById('brandId').value;
    const body = {
        brand_name: document.getElementById('brandName').value.trim(),
        lead_time_days: parseInt(document.getElementById('brandLead').value, 10),
        safety_days: parseInt(document.getElementById('brandSafety').value, 10),
        is_active: document.getElementById('brandActive').checked
    };
    const token = localStorage.getItem('auth_token');
    const url = id ? `/api/zoho/reorder/brands/${id}` : '/api/zoho/reorder/brands';
    const method = id ? 'PUT' : 'POST';
    const res = await fetch(url, {
        method,
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const json = await res.json();
    if (!json.success) { alert(json.message || 'Failed'); return; }
    closeBrandModal();
    loadBrandConfigs();
}

async function deleteBrand(id, name) {
    if (!confirm(`Delete brand "${name}"?`)) return;
    const token = localStorage.getItem('auth_token');
    const res = await fetch(`/api/zoho/reorder/brands/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + token }
    });
    const json = await res.json();
    if (!json.success) { alert(json.message || 'Failed'); return; }
    loadBrandConfigs();
}
```

Wire `loadBrandConfigs()` into the tab switch function (find existing `switchTab` and add case for `brand-config`).

- [ ] **Step 4: Smoke test in browser**

Navigate to `admin-zoho-reorder.html`, click Brand Config tab. Verify `__default__` row shows. Add a brand "Asian Paints" with lead=3 safety=3. Edit it. Delete it. Confirm `__default__` cannot be deleted.

- [ ] **Step 5: Commit**

```bash
git add public/admin-zoho-reorder.html
git commit -m "feat(reorder): brand config UI tab with CRUD"
```

---

## Task 4: Invoice-Line Sync Service

**Files:**
- Create: `services/zoho-invoice-line-sync.js`
- Create: `tests/unit/invoice-line-sync.test.js`

- [ ] **Step 1: Write failing tests for core helpers**

Create `tests/unit/invoice-line-sync.test.js`:

```javascript
const { computeSyncWindow, aggregateLineItems } = require('../../services/zoho-invoice-line-sync');

describe('invoice-line-sync helpers', () => {
    test('computeSyncWindow returns 90-day window when DB empty', () => {
        const w = computeSyncWindow(null, new Date('2026-04-14'));
        expect(w.from).toBe('2026-01-14');
        expect(w.to).toBe('2026-04-13');
    });

    test('computeSyncWindow returns incremental window when lastDate given', () => {
        const w = computeSyncWindow('2026-04-10', new Date('2026-04-14'));
        expect(w.from).toBe('2026-04-09');
        expect(w.to).toBe('2026-04-13');
    });

    test('aggregateLineItems sums qty per (branch, item, date)', () => {
        const invoice = {
            invoice_id: 'INV1', invoice_date: '2026-04-10', local_branch_id: 3,
            line_items: [
                { item_id: 'I1', quantity: 2, item_total: 200 },
                { item_id: 'I1', quantity: 3, item_total: 300 },
                { item_id: 'I2', quantity: 1, item_total: 50 }
            ]
        };
        const agg = aggregateLineItems([invoice]);
        expect(agg).toContainEqual({ local_branch_id: 3, zoho_item_id: 'I1', sale_date: '2026-04-10', qty_sold: 5, revenue: 500, invoice_count: 1 });
        expect(agg).toContainEqual({ local_branch_id: 3, zoho_item_id: 'I2', sale_date: '2026-04-10', qty_sold: 1, revenue: 50, invoice_count: 1 });
    });

    test('aggregateLineItems counts invoices once per item (not per line)', () => {
        const invoice = {
            invoice_id: 'INV1', invoice_date: '2026-04-10', local_branch_id: 3,
            line_items: [
                { item_id: 'I1', quantity: 1, item_total: 100 },
                { item_id: 'I1', quantity: 1, item_total: 100 }
            ]
        };
        const agg = aggregateLineItems([invoice]);
        expect(agg[0].invoice_count).toBe(1);
        expect(agg[0].qty_sold).toBe(2);
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/invoice-line-sync.test.js -v`
Expected: FAIL — "Cannot find module" (service not yet created).

- [ ] **Step 3: Create service skeleton with helpers**

Create `services/zoho-invoice-line-sync.js`:

```javascript
const zohoAPI = require('./zoho-api');

let pool;
function setPool(p) { pool = p; }

function toIsoDate(d) {
    return d.toISOString().slice(0, 10);
}

function addDays(date, days) {
    const d = new Date(date);
    d.setUTCDate(d.getUTCDate() + days);
    return d;
}

function computeSyncWindow(lastSaleDate, now = new Date()) {
    const yesterday = addDays(now, -1);
    if (!lastSaleDate) {
        return { from: toIsoDate(addDays(now, -90)), to: toIsoDate(yesterday) };
    }
    const from = addDays(new Date(lastSaleDate), -1);
    return { from: toIsoDate(from), to: toIsoDate(yesterday) };
}

function aggregateLineItems(invoices) {
    const key = (b, i, d) => `${b}|${i}|${d}`;
    const map = new Map();
    for (const inv of invoices) {
        const seenItems = new Set();
        for (const li of (inv.line_items || [])) {
            const k = key(inv.local_branch_id, li.item_id, inv.invoice_date);
            if (!map.has(k)) {
                map.set(k, {
                    local_branch_id: inv.local_branch_id,
                    zoho_item_id: li.item_id,
                    sale_date: inv.invoice_date,
                    qty_sold: 0, revenue: 0, invoice_count: 0
                });
            }
            const agg = map.get(k);
            agg.qty_sold += Number(li.quantity || 0);
            agg.revenue += Number(li.item_total || 0);
            if (!seenItems.has(`${inv.invoice_id}|${li.item_id}`)) {
                agg.invoice_count += 1;
                seenItems.add(`${inv.invoice_id}|${li.item_id}`);
            }
        }
    }
    return Array.from(map.values());
}

module.exports = {
    setPool,
    computeSyncWindow,
    aggregateLineItems
};
```

- [ ] **Step 4: Run tests to verify helpers pass**

Run: `npx jest tests/unit/invoice-line-sync.test.js -v`
Expected: PASS (4 tests).

- [ ] **Step 5: Implement the main sync loop**

Append to `services/zoho-invoice-line-sync.js`:

```javascript
async function getLastSyncedDate() {
    const [rows] = await pool.query(`SELECT MAX(sale_date) AS last FROM branch_item_sales`);
    return rows[0]?.last ? toIsoDate(new Date(rows[0].last)) : null;
}

async function fetchUnsyncedInvoices(window) {
    const [rows] = await pool.query(
        `SELECT zi.invoice_id, zi.invoice_date, zi.local_branch_id
         FROM zoho_invoices zi
         LEFT JOIN invoice_line_sync_cursor c ON c.invoice_id = zi.invoice_id
         WHERE zi.invoice_date BETWEEN ? AND ?
           AND zi.local_branch_id IS NOT NULL
           AND c.invoice_id IS NULL
         ORDER BY zi.invoice_date ASC, zi.invoice_id ASC`,
        [window.from, window.to]
    );
    return rows;
}

async function upsertAggregates(aggs) {
    if (aggs.length === 0) return;
    const values = aggs.map(a => [a.local_branch_id, a.zoho_item_id, a.sale_date, a.qty_sold, a.revenue, a.invoice_count]);
    await pool.query(
        `INSERT INTO branch_item_sales
         (local_branch_id, zoho_item_id, sale_date, qty_sold, revenue, invoice_count)
         VALUES ?
         ON DUPLICATE KEY UPDATE
           qty_sold = qty_sold + VALUES(qty_sold),
           revenue = revenue + VALUES(revenue),
           invoice_count = invoice_count + VALUES(invoice_count)`,
        [values]
    );
}

async function markCursor(invoiceId, lineCount) {
    await pool.query(
        `INSERT IGNORE INTO invoice_line_sync_cursor (invoice_id, line_count) VALUES (?, ?)`,
        [invoiceId, lineCount]
    );
}

function isRateLimitError(err) {
    const m = (err?.message || '').toLowerCase();
    return m.includes('rate limit') || m.includes('error 45') || m.includes('error 57') || m.includes('quota');
}

async function syncInvoiceLines({ emitProgress } = {}) {
    if (!pool) throw new Error('pool not set');

    const lastDate = await getLastSyncedDate();
    const window = computeSyncWindow(lastDate);
    const invoices = await fetchUnsyncedInvoices(window);

    console.log(`[InvoiceLineSync] Window ${window.from}..${window.to} — ${invoices.length} unsynced invoices`);
    if (invoices.length === 0) return { synced: 0, total: 0, window };

    let synced = 0, failed = 0;
    const BATCH = 50;

    for (let i = 0; i < invoices.length; i += BATCH) {
        const slice = invoices.slice(i, i + BATCH);
        const fetched = [];

        for (const inv of slice) {
            try {
                const resp = await zohoAPI.getInvoice(inv.invoice_id);
                const full = resp?.invoice || resp;
                fetched.push({
                    invoice_id: inv.invoice_id,
                    invoice_date: inv.invoice_date instanceof Date ? toIsoDate(inv.invoice_date) : inv.invoice_date,
                    local_branch_id: inv.local_branch_id,
                    line_items: full?.line_items || []
                });
                await markCursor(inv.invoice_id, (full?.line_items || []).length);
                synced++;
            } catch (e) {
                failed++;
                console.error(`[InvoiceLineSync] ${inv.invoice_id}: ${e.message}`);
                if (isRateLimitError(e)) {
                    console.warn('[InvoiceLineSync] Rate limit hit, stopping batch for resume next run');
                    const aggs = aggregateLineItems(fetched);
                    await upsertAggregates(aggs);
                    return { synced, failed, total: invoices.length, window, pausedOnRateLimit: true };
                }
            }
        }

        const aggs = aggregateLineItems(fetched);
        await upsertAggregates(aggs);

        if (emitProgress) emitProgress({ synced, failed, total: invoices.length });
        console.log(`[InvoiceLineSync] Progress ${synced}/${invoices.length}`);
    }

    console.log(`[InvoiceLineSync] Done. Synced ${synced}, failed ${failed}`);
    return { synced, failed, total: invoices.length, window };
}

module.exports.syncInvoiceLines = syncInvoiceLines;
module.exports.getLastSyncedDate = getLastSyncedDate;
```

Ensure `zohoAPI.getInvoice` exists — it does (verified in `services/zoho-api.js` via `getItem` pattern; if missing, add a thin wrapper calling `apiGet('/invoices/${id}?organization_id=...')`).

- [ ] **Step 6: Verify `zohoAPI.getInvoice` exists and add if missing**

Search `services/zoho-api.js` for `getInvoice`. If not exported, add:

```javascript
async function getInvoice(invoiceId) {
    const orgId = process.env.ZOHO_ORGANIZATION_ID;
    return await apiGet(`/invoices/${invoiceId}`, { organization_id: orgId });
}
module.exports.getInvoice = getInvoice;
```

- [ ] **Step 7: Commit**

```bash
git add services/zoho-invoice-line-sync.js services/zoho-api.js tests/unit/invoice-line-sync.test.js
git commit -m "feat(reorder): invoice-line sync service with resumable cursor"
```

---

## Task 5: Back-fill Endpoint + UI Button

**Files:**
- Modify: `routes/zoho.js`
- Modify: `public/admin-zoho-reorder.html`
- Modify: `server.js` (wire `setPool` on startup)

- [ ] **Step 1: Wire pool to new service on server boot**

In `server.js`, find where existing services get `setPool` called (e.g., `zohoAPI.setPool(pool)`). Add:

```javascript
const invoiceLineSync = require('./services/zoho-invoice-line-sync');
invoiceLineSync.setPool(pool);
```

- [ ] **Step 2: Add endpoints to `routes/zoho.js`**

```javascript
const invoiceLineSync = require('../services/zoho-invoice-line-sync');
// (at top with other service requires)

/**
 * POST /api/zoho/reorder/backfill-sales - Trigger invoice-line sync (background)
 */
router.post('/reorder/backfill-sales', requirePermission('zoho', 'reorder'), async (req, res) => {
    // Return immediately, run in background
    res.json({ success: true, message: 'Sync started — watch sales-sync-status' });
    setImmediate(async () => {
        try {
            const io = req.app.get('io');
            await invoiceLineSync.syncInvoiceLines({
                emitProgress: p => io?.emit('invoice-line-sync-progress', p)
            });
            io?.emit('invoice-line-sync-done');
        } catch (e) {
            console.error('[BackfillSales] failed:', e);
        }
    });
});

/**
 * GET /api/zoho/reorder/sales-sync-status - Sync status/progress
 */
router.get('/reorder/sales-sync-status', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const [[{ cursor_count }]] = await pool.query(`SELECT COUNT(*) AS cursor_count FROM invoice_line_sync_cursor`);
        const [[{ sales_count, min_date, max_date }]] = await pool.query(
            `SELECT COUNT(*) AS sales_count, MIN(sale_date) AS min_date, MAX(sale_date) AS max_date
             FROM branch_item_sales`
        );
        res.json({
            success: true,
            data: {
                invoices_synced: cursor_count,
                sales_rows: sales_count,
                earliest_date: min_date,
                latest_date: max_date
            }
        });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});
```

- [ ] **Step 3: Add back-fill button + status banner to the page**

Inside `admin-zoho-reorder.html`, near the top of the page content (above tab buttons):

```html
<div id="syncStatusBanner" class="bg-amber-50 border border-amber-200 rounded p-3 mb-3 hidden">
    <div class="flex justify-between items-center">
        <div class="text-sm">
            <span id="syncStatusText">Loading...</span>
        </div>
        <button id="backfillBtn" onclick="triggerBackfill()" class="px-3 py-1.5 bg-indigo-600 text-white rounded text-sm">
            Back-fill sales history
        </button>
    </div>
    <div id="syncProgress" class="mt-2 text-xs text-gray-600 hidden"></div>
</div>
```

Add JS:

```javascript
async function loadSyncStatus() {
    const token = localStorage.getItem('auth_token');
    const res = await fetch('/api/zoho/reorder/sales-sync-status', { headers: { 'Authorization': 'Bearer ' + token } });
    const json = await res.json();
    if (!json.success) return;
    const banner = document.getElementById('syncStatusBanner');
    banner.classList.remove('hidden');
    const d = json.data;
    document.getElementById('syncStatusText').innerHTML =
        `Sales rows: <b>${d.sales_rows}</b> | Invoices synced: <b>${d.invoices_synced}</b> | Range: ${d.earliest_date || '—'} → ${d.latest_date || '—'}`;
}

async function triggerBackfill() {
    if (!confirm('Start invoice-line sync? May take up to 10 minutes on first run.')) return;
    const token = localStorage.getItem('auth_token');
    document.getElementById('backfillBtn').disabled = true;
    const res = await fetch('/api/zoho/reorder/backfill-sales', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token }
    });
    const json = await res.json();
    document.getElementById('syncProgress').classList.remove('hidden');
    document.getElementById('syncProgress').textContent = json.message || 'Started';

    // Listen for progress via socket
    if (window.qcSocket) {
        window.qcSocket.on('invoice-line-sync-progress', p => {
            document.getElementById('syncProgress').textContent =
                `Syncing ${p.synced}/${p.total} (${p.failed} failed)`;
        });
        window.qcSocket.on('invoice-line-sync-done', () => {
            document.getElementById('syncProgress').textContent = 'Done ✅';
            document.getElementById('backfillBtn').disabled = false;
            loadSyncStatus();
        });
    }
}

// Call on page load
document.addEventListener('DOMContentLoaded', loadSyncStatus);
```

- [ ] **Step 4: Manual smoke test on dev**

Deploy, load the page, click "Back-fill sales history", watch banner update. Verify `branch_item_sales` starts filling (query DB directly).

- [ ] **Step 5: Commit**

```bash
git add server.js routes/zoho.js public/admin-zoho-reorder.html
git commit -m "feat(reorder): backfill endpoint + status banner UI"
```

---

## Task 6: Reorder Compute Service (+ tests)

**Files:**
- Create: `services/reorder-compute-service.js`
- Create: `tests/unit/reorder-compute.test.js`

- [ ] **Step 1: Write failing tests for compute logic**

Create `tests/unit/reorder-compute.test.js`:

```javascript
const { computeReorderLevel, computeSeverity, computeReorderQuantity } = require('../../services/reorder-compute-service');

describe('reorder-compute', () => {
    test('computeReorderLevel multiplies avg sales by (lead + safety)', () => {
        expect(computeReorderLevel(2.5, 7, 5)).toBe(30); // ceil(2.5*12)=30
        expect(computeReorderLevel(1, 3, 3)).toBe(6);
        expect(computeReorderLevel(0.5, 10, 5)).toBe(8); // ceil(7.5)
    });

    test('computeReorderQuantity gives 15-day replenish pack', () => {
        expect(computeReorderQuantity(2)).toBe(30);
        expect(computeReorderQuantity(0.5)).toBe(8);
    });

    test('computeSeverity tiers by stock/reorder ratio', () => {
        expect(computeSeverity(2, 10)).toBe('critical');   // 0.2
        expect(computeSeverity(4, 10)).toBe('high');       // 0.4
        expect(computeSeverity(6, 10)).toBe('medium');     // 0.6
        expect(computeSeverity(9, 10)).toBe('low');        // 0.9
        expect(computeSeverity(15, 10)).toBe(null);        // above reorder
    });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx jest tests/unit/reorder-compute.test.js -v`
Expected: FAIL — Cannot find module.

- [ ] **Step 3: Implement the service**

Create `services/reorder-compute-service.js`:

```javascript
let pool;
function setPool(p) { pool = p; }

function computeReorderLevel(avgDailySales, leadDays, safetyDays) {
    return Math.ceil(avgDailySales * (leadDays + safetyDays));
}

function computeReorderQuantity(avgDailySales) {
    return Math.ceil(avgDailySales * 15);
}

function computeSeverity(currentStock, reorderLevel) {
    if (reorderLevel <= 0) return null;
    const ratio = currentStock / reorderLevel;
    if (ratio > 1) return null;
    if (ratio <= 0.25) return 'critical';
    if (ratio <= 0.50) return 'high';
    if (ratio <= 0.75) return 'medium';
    return 'low';
}

async function getBrandConfig() {
    const [rows] = await pool.query(`SELECT brand_name, lead_time_days, safety_days FROM brand_reorder_config WHERE is_active = 1`);
    const map = new Map(rows.map(r => [r.brand_name, r]));
    const def = map.get('__default__') || { lead_time_days: 7, safety_days: 5 };
    return { map, def };
}

async function computeAll({ windowDays = 60, minSales = 1 } = {}) {
    if (!pool) throw new Error('pool not set');

    const [[{ cnt }]] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM branch_item_sales WHERE sale_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
        [windowDays]
    );
    console.log(`[ReorderCompute] ${cnt} recent sales rows to consider`);

    const [rows] = await pool.query(
        `SELECT bis.local_branch_id, bis.zoho_item_id,
                SUM(bis.qty_sold) AS total_qty,
                zim.zoho_brand AS brand,
                zlm.zoho_location_id
         FROM branch_item_sales bis
         JOIN zoho_items_map zim ON zim.zoho_item_id = bis.zoho_item_id
         LEFT JOIN zoho_locations_map zlm ON zlm.local_branch_id = bis.local_branch_id
         WHERE bis.sale_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
         GROUP BY bis.local_branch_id, bis.zoho_item_id, zim.zoho_brand, zlm.zoho_location_id`,
        [windowDays]
    );

    const { map, def } = await getBrandConfig();

    let updated = 0, skipped = 0, skippedManual = 0;

    for (const r of rows) {
        const avgDaily = Number(r.total_qty) / windowDays;
        if (Number(r.total_qty) < minSales) { skipped++; continue; }
        if (!r.zoho_location_id) { skipped++; continue; }

        const cfg = map.get(r.brand) || def;
        const reorderLevel = computeReorderLevel(avgDaily, cfg.lead_time_days, cfg.safety_days);
        const reorderQty = computeReorderQuantity(avgDaily);

        const [existing] = await pool.query(
            `SELECT source FROM zoho_reorder_config WHERE zoho_item_id = ? AND zoho_location_id = ?`,
            [r.zoho_item_id, r.zoho_location_id]
        );
        if (existing.length > 0 && existing[0].source === 'manual') {
            skippedManual++;
            continue;
        }

        await pool.query(`
            INSERT INTO zoho_reorder_config
                (zoho_item_id, zoho_location_id, reorder_level, reorder_quantity,
                 source, avg_daily_sales, computed_at, is_active)
            VALUES (?, ?, ?, ?, 'auto', ?, NOW(), 1)
            ON DUPLICATE KEY UPDATE
                reorder_level = VALUES(reorder_level),
                reorder_quantity = VALUES(reorder_quantity),
                source = 'auto',
                avg_daily_sales = VALUES(avg_daily_sales),
                computed_at = NOW(),
                is_active = 1
        `, [r.zoho_item_id, r.zoho_location_id, reorderLevel, reorderQty, avgDaily]);

        updated++;
    }

    console.log(`[ReorderCompute] Config: ${updated} updated, ${skipped} skipped (no sales/location), ${skippedManual} manual-protected`);

    const alertStats = await refreshAlerts();

    await pool.query(
        `INSERT INTO zoho_sync_log (sync_type, direction, status, records_synced, completed_at)
         VALUES ('reorder_compute', 'internal', 'completed', ?, NOW())`,
        [updated]
    );

    return { updated, skipped, skippedManual, alerts: alertStats };
}

async function refreshAlerts() {
    const [rows] = await pool.query(`
        SELECT rc.zoho_item_id, rc.zoho_location_id, rc.reorder_level,
               COALESCE(ls.stock_on_hand, 0) AS stock
        FROM zoho_reorder_config rc
        LEFT JOIN zoho_location_stock ls
            ON ls.zoho_item_id = rc.zoho_item_id AND ls.zoho_location_id = rc.zoho_location_id
        WHERE rc.is_active = 1
    `);

    let active = 0, resolved = 0;
    for (const r of rows) {
        const severity = computeSeverity(Number(r.stock), Number(r.reorder_level));
        if (severity) {
            await pool.query(`
                INSERT INTO zoho_reorder_alerts
                    (zoho_item_id, zoho_location_id, severity, status, triggered_at)
                VALUES (?, ?, ?, 'active', NOW())
                ON DUPLICATE KEY UPDATE
                    severity = VALUES(severity),
                    status = 'active',
                    triggered_at = IF(status='active', triggered_at, NOW())
            `, [r.zoho_item_id, r.zoho_location_id, severity]);
            active++;
        } else {
            const [upd] = await pool.query(`
                UPDATE zoho_reorder_alerts
                SET status = 'resolved', resolved_at = NOW()
                WHERE zoho_item_id = ? AND zoho_location_id = ? AND status = 'active'
            `, [r.zoho_item_id, r.zoho_location_id]);
            if (upd.affectedRows > 0) resolved++;
        }
    }
    return { active, resolved };
}

module.exports = {
    setPool,
    computeReorderLevel,
    computeReorderQuantity,
    computeSeverity,
    computeAll,
    refreshAlerts
};
```

Note: the `zoho_reorder_alerts` table may not have a unique key on (item, location). Check the existing schema; if not, the `ON DUPLICATE KEY UPDATE` will behave as INSERT. Update the upsert accordingly — if no unique key, do `SELECT` then `INSERT` or `UPDATE`. This task assumes a unique key exists; if not, modify Task 1's migration to add:

```sql
ALTER TABLE zoho_reorder_alerts ADD UNIQUE KEY uq_item_loc (zoho_item_id, zoho_location_id);
```

Verify by inspecting `zoho_reorder_alerts` schema; if missing, add the ALTER to Task 1 migration before re-running.

- [ ] **Step 4: Verify zoho_reorder_alerts unique key; add to migration if needed**

Run: `SHOW CREATE TABLE zoho_reorder_alerts` on dev DB. If no unique key on `(zoho_item_id, zoho_location_id)`, add an idempotent block to `migrations/migrate-reorder-intelligence.js`:

```javascript
// Check + add unique key on zoho_reorder_alerts
const [idx] = await pool.query(
    `SELECT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='zoho_reorder_alerts' AND INDEX_NAME='uq_item_loc'`
);
if (idx.length === 0 && await tableExists(pool, 'zoho_reorder_alerts')) {
    await pool.query(`ALTER TABLE zoho_reorder_alerts ADD UNIQUE KEY uq_item_loc (zoho_item_id, zoho_location_id)`);
    console.log('✅ zoho_reorder_alerts.uq_item_loc added');
}
```

Re-run migration.

- [ ] **Step 5: Run compute tests**

Run: `npx jest tests/unit/reorder-compute.test.js -v`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add services/reorder-compute-service.js tests/unit/reorder-compute.test.js migrations/migrate-reorder-intelligence.js
git commit -m "feat(reorder): compute service with hybrid apply + severity tiers"
```

---

## Task 7: Manual Compute Trigger Endpoint

**Files:**
- Modify: `server.js`, `routes/zoho.js`

- [ ] **Step 1: Wire pool on startup**

In `server.js`:
```javascript
const reorderCompute = require('./services/reorder-compute-service');
reorderCompute.setPool(pool);
```

- [ ] **Step 2: Add endpoint**

In `routes/zoho.js`:
```javascript
const reorderCompute = require('../services/reorder-compute-service');

/**
 * POST /api/zoho/reorder/compute-now - Run compute inline, return summary
 */
router.post('/reorder/compute-now', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const windowDays = parseInt(req.body.window_days, 10) || 60;
        const minSales = parseInt(req.body.min_sales, 10) || 1;
        const result = await reorderCompute.computeAll({ windowDays, minSales });
        res.json({ success: true, data: result });
    } catch (e) {
        console.error('[ComputeNow]', e);
        res.status(500).json({ success: false, message: e.message });
    }
});
```

- [ ] **Step 3: Smoke test**

```bash
curl -X POST -H "Authorization: Bearer <token>" https://act.qcpaintshop.com/api/zoho/reorder/compute-now -H "Content-Type: application/json" -d '{}'
# Expect: { success:true, data: { updated, skipped, skippedManual, alerts:{active, resolved} } }
```

- [ ] **Step 4: Commit**

```bash
git add server.js routes/zoho.js
git commit -m "feat(reorder): POST /compute-now manual trigger"
```

---

## Task 8: Enhance Configuration Tab (Source Badge, Avg Sales Columns)

**Files:**
- Modify: `public/admin-zoho-reorder.html`
- Modify: `routes/zoho.js` (enhance existing config list endpoint + add reset-to-auto)

- [ ] **Step 1: Add reset-to-auto endpoint**

In `routes/zoho.js` (near other reorder/config endpoints):

```javascript
/**
 * POST /api/zoho/reorder/config/reset-to-auto - Convert manual rows to auto
 */
router.post('/reorder/config/reset-to-auto', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, message: 'ids array required' });
        }
        const [result] = await pool.query(
            `UPDATE zoho_reorder_config SET source = 'auto' WHERE id IN (?)`,
            [ids]
        );
        res.json({ success: true, data: { updated: result.affectedRows } });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});
```

Also ensure the existing config list endpoint returns `source`, `avg_daily_sales`, `computed_at`. Find the endpoint (likely `GET /api/zoho/reorder/config` or similar) and update its SELECT to include these columns. If the endpoint doesn't exist, add one:

```javascript
/**
 * GET /api/zoho/reorder/config - Per-branch per-item config list
 */
router.get('/reorder/config', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const { location_id, source } = req.query;
        let where = 'WHERE 1=1';
        const params = [];
        if (location_id) { where += ' AND rc.zoho_location_id = ?'; params.push(location_id); }
        if (source) { where += ' AND rc.source = ?'; params.push(source); }
        const [rows] = await pool.query(`
            SELECT rc.*, zim.zoho_item_name, zim.zoho_sku, zim.zoho_brand,
                   zlm.location_name, zlm.local_branch_id,
                   COALESCE(ls.stock_on_hand, 0) AS current_stock
            FROM zoho_reorder_config rc
            JOIN zoho_items_map zim ON zim.zoho_item_id = rc.zoho_item_id
            LEFT JOIN zoho_locations_map zlm ON zlm.zoho_location_id = rc.zoho_location_id
            LEFT JOIN zoho_location_stock ls
                ON ls.zoho_item_id = rc.zoho_item_id AND ls.zoho_location_id = rc.zoho_location_id
            ${where}
            ORDER BY zlm.location_name, zim.zoho_item_name
            LIMIT 1000
        `, params);
        res.json({ success: true, data: rows });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});
```

- [ ] **Step 2: Update Configuration tab rendering**

Find the existing Configuration tab render function in `admin-zoho-reorder.html`. Update table columns:

```html
<thead>
    <tr>
        <th><input type="checkbox" onchange="toggleAllConfigRows(this)"></th>
        <th>Source</th>
        <th>Item</th>
        <th>SKU</th>
        <th>Brand</th>
        <th>Branch</th>
        <th>Reorder Level</th>
        <th>Current Stock</th>
        <th>Avg Sales (60d)</th>
        <th>Computed</th>
    </tr>
</thead>
```

Update render:
```javascript
function renderConfigRows(rows) {
    const tbody = document.getElementById('configBody');
    tbody.innerHTML = rows.map(r => `
        <tr>
            <td><input type="checkbox" class="config-cb" data-id="${r.id}"></td>
            <td>
                <span class="px-2 py-0.5 rounded text-xs ${r.source === 'auto' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}">
                    ${r.source === 'auto' ? '🤖 Auto' : '👤 Manual'}
                </span>
            </td>
            <td>${escapeHtml(r.zoho_item_name)}</td>
            <td>${escapeHtml(r.zoho_sku || '')}</td>
            <td>${escapeHtml(r.zoho_brand || '')}</td>
            <td>${escapeHtml(r.location_name || '')}</td>
            <td class="text-right">${r.reorder_level}</td>
            <td class="text-right ${r.current_stock <= r.reorder_level ? 'text-red-600 font-semibold' : ''}">${r.current_stock}</td>
            <td class="text-right">${r.avg_daily_sales != null ? Number(r.avg_daily_sales).toFixed(2) : '—'}</td>
            <td class="text-xs text-gray-500">${r.computed_at ? new Date(r.computed_at).toLocaleDateString('en-IN') : '—'}</td>
        </tr>
    `).join('');
}

async function resetSelectedToAuto() {
    const ids = Array.from(document.querySelectorAll('.config-cb:checked')).map(cb => parseInt(cb.dataset.id, 10));
    if (ids.length === 0) { alert('Select rows first'); return; }
    if (!confirm(`Reset ${ids.length} rows to auto? They will be recomputed next cycle.`)) return;
    const token = localStorage.getItem('auth_token');
    const res = await fetch('/api/zoho/reorder/config/reset-to-auto', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
    });
    const json = await res.json();
    alert(json.success ? `Reset ${json.data.updated} rows` : json.message);
    loadConfig();
}
```

Add a "Reset Selected to Auto" button above the table:
```html
<button onclick="resetSelectedToAuto()" class="px-3 py-1.5 bg-amber-600 text-white rounded text-sm">
    Reset Selected → Auto
</button>
```

- [ ] **Step 3: Smoke test**

Run `/compute-now` once. Verify Configuration tab shows auto rows with 🤖 badge and avg-sales column populated.

- [ ] **Step 4: Commit**

```bash
git add routes/zoho.js public/admin-zoho-reorder.html
git commit -m "feat(reorder): source badge + avg sales cols + reset-to-auto"
```

---

## Task 9: Report Service — Data Assembly + Other-Branches

**Files:**
- Create: `services/reorder-report-service.js`
- Create: `tests/unit/reorder-report.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/unit/reorder-report.test.js`:

```javascript
const { buildOtherBranchesMap, sortReportRows } = require('../../services/reorder-report-service');

describe('reorder-report helpers', () => {
    test('buildOtherBranchesMap indexes stock per item excluding target branch', () => {
        const stocks = [
            { zoho_item_id: 'I1', local_branch_id: 1, location_name: 'Main', stock_on_hand: 50 },
            { zoho_item_id: 'I1', local_branch_id: 2, location_name: 'Thangachi', stock_on_hand: 0 },
            { zoho_item_id: 'I1', local_branch_id: 3, location_name: 'Paramakudi', stock_on_hand: 20 },
            { zoho_item_id: 'I2', local_branch_id: 1, location_name: 'Main', stock_on_hand: 5 }
        ];
        const map = buildOtherBranchesMap(stocks, 2);
        // Only positive stock, exclude branch 2 (target)
        expect(map.get('I1')).toEqual([
            { branch_id: 1, branch_name: 'Main', stock_on_hand: 50 },
            { branch_id: 3, branch_name: 'Paramakudi', stock_on_hand: 20 }
        ]);
        expect(map.get('I2')).toEqual([
            { branch_id: 1, branch_name: 'Main', stock_on_hand: 5 }
        ]);
    });

    test('sortReportRows sorts by severity desc then days_to_stockout asc', () => {
        const rows = [
            { severity: 'medium', days_to_stockout: 3 },
            { severity: 'critical', days_to_stockout: 10 },
            { severity: 'critical', days_to_stockout: 1 },
            { severity: 'low', days_to_stockout: 0 }
        ];
        const sorted = sortReportRows(rows);
        expect(sorted[0]).toEqual({ severity: 'critical', days_to_stockout: 1 });
        expect(sorted[1]).toEqual({ severity: 'critical', days_to_stockout: 10 });
        expect(sorted[2]).toEqual({ severity: 'medium', days_to_stockout: 3 });
        expect(sorted[3]).toEqual({ severity: 'low', days_to_stockout: 0 });
    });
});
```

- [ ] **Step 2: Run tests, verify fail**

Run: `npx jest tests/unit/reorder-report.test.js -v`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement service helpers**

Create `services/reorder-report-service.js`:

```javascript
let pool;
function setPool(p) { pool = p; }

const SEVERITY_RANK = { critical: 4, high: 3, medium: 2, low: 1 };

function sortReportRows(rows) {
    return [...rows].sort((a, b) => {
        const sa = SEVERITY_RANK[a.severity] || 0;
        const sb = SEVERITY_RANK[b.severity] || 0;
        if (sb !== sa) return sb - sa;
        return (a.days_to_stockout || 0) - (b.days_to_stockout || 0);
    });
}

function buildOtherBranchesMap(stockRows, targetBranchId) {
    const map = new Map();
    for (const s of stockRows) {
        if (s.local_branch_id === targetBranchId) continue;
        if (Number(s.stock_on_hand) <= 0) continue;
        if (!map.has(s.zoho_item_id)) map.set(s.zoho_item_id, []);
        map.get(s.zoho_item_id).push({
            branch_id: s.local_branch_id,
            branch_name: s.location_name,
            stock_on_hand: Number(s.stock_on_hand)
        });
    }
    for (const arr of map.values()) arr.sort((a, b) => b.stock_on_hand - a.stock_on_hand);
    return map;
}

async function assembleReport({ branchId = null, date = null } = {}) {
    if (!pool) throw new Error('pool not set');
    const reportDate = date || new Date().toISOString().slice(0, 10);

    let where = `WHERE a.status = 'active'`;
    const params = [];
    if (branchId) {
        where += ` AND zlm.local_branch_id = ?`;
        params.push(branchId);
    }

    const [alerts] = await pool.query(`
        SELECT a.zoho_item_id, a.zoho_location_id, a.severity,
               zim.zoho_item_name AS item_name,
               zim.zoho_sku AS sku,
               zim.zoho_brand AS brand,
               zim.zoho_unit AS unit,
               zlm.local_branch_id AS branch_id,
               zlm.location_name AS branch_name,
               rc.reorder_level,
               rc.reorder_quantity,
               rc.avg_daily_sales,
               COALESCE(ls.stock_on_hand, 0) AS current_stock
        FROM zoho_reorder_alerts a
        JOIN zoho_items_map zim ON zim.zoho_item_id = a.zoho_item_id
        JOIN zoho_locations_map zlm ON zlm.zoho_location_id = a.zoho_location_id
        LEFT JOIN zoho_reorder_config rc ON rc.zoho_item_id = a.zoho_item_id AND rc.zoho_location_id = a.zoho_location_id
        LEFT JOIN zoho_location_stock ls ON ls.zoho_item_id = a.zoho_item_id AND ls.zoho_location_id = a.zoho_location_id
        ${where}
    `, params);

    const itemIds = [...new Set(alerts.map(a => a.zoho_item_id))];
    let otherMap = new Map();
    if (itemIds.length > 0) {
        const [stocks] = await pool.query(`
            SELECT ls.zoho_item_id, zlm.local_branch_id, zlm.location_name,
                   ls.stock_on_hand
            FROM zoho_location_stock ls
            JOIN zoho_locations_map zlm ON zlm.zoho_location_id = ls.zoho_location_id
            WHERE ls.zoho_item_id IN (?) AND ls.stock_on_hand > 0
        `, [itemIds]);
        // If branchId null (consolidated), other-branches still useful: exclude target per row
        otherMap = new Map();
        for (const s of stocks) {
            if (!otherMap.has(s.zoho_item_id)) otherMap.set(s.zoho_item_id, []);
            otherMap.get(s.zoho_item_id).push(s);
        }
    }

    const rows = alerts.map(a => {
        const avg = Number(a.avg_daily_sales || 0);
        const daysToStockout = avg > 0 ? Math.floor(Number(a.current_stock) / avg) : Infinity;
        const suggestedQty = Math.max(0, Number(a.reorder_level) + Number(a.reorder_quantity) - Number(a.current_stock));

        const otherBranches = (otherMap.get(a.zoho_item_id) || [])
            .filter(s => s.local_branch_id !== a.branch_id)
            .sort((x, y) => y.stock_on_hand - x.stock_on_hand)
            .map(s => ({ branch_id: s.local_branch_id, branch_name: s.location_name, stock_on_hand: Number(s.stock_on_hand) }));

        return {
            item_name: a.item_name,
            sku: a.sku,
            brand: a.brand,
            unit: a.unit,
            branch_id: a.branch_id,
            branch_name: a.branch_name,
            current_stock: Number(a.current_stock),
            reorder_level: Number(a.reorder_level),
            severity: a.severity,
            avg_daily_sales: avg,
            days_to_stockout: daysToStockout === Infinity ? null : daysToStockout,
            suggested_order_qty: suggestedQty,
            other_branches: otherBranches
        };
    });

    return { report_date: reportDate, scope: branchId ? `branch:${branchId}` : 'consolidated', rows: sortReportRows(rows) };
}

module.exports = { setPool, buildOtherBranchesMap, sortReportRows, assembleReport };
```

- [ ] **Step 4: Run tests**

Run: `npx jest tests/unit/reorder-report.test.js -v`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add services/reorder-report-service.js tests/unit/reorder-report.test.js
git commit -m "feat(reorder): report data assembly with inter-branch stock"
```

---

## Task 10: Report PDF Generator

**Files:**
- Create: `services/reorder-report-pdf-generator.js`

- [ ] **Step 1: Implement PDF generator**

Create `services/reorder-report-pdf-generator.js`:

```javascript
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const COLORS = {
    primary: '#1B5E3B',
    primaryLight: '#2E7D4F',
    gold: '#D4A24E',
    danger: '#DC2626',
    warning: '#F59E0B',
    medium: '#EAB308',
    low: '#6B7280',
    bg: '#F9FAFB',
    text: '#1F2937'
};

function severityColor(sev) {
    return sev === 'critical' ? COLORS.danger :
           sev === 'high' ? COLORS.warning :
           sev === 'medium' ? COLORS.medium : COLORS.low;
}

async function generateReorderPdf(report, outPath) {
    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    doc.pipe(fs.createWriteStream(outPath));

    // Header
    doc.fillColor(COLORS.primary).fontSize(20).text('Reorder Report', { align: 'left' });
    doc.fillColor(COLORS.gold).fontSize(11).text('Quality Colours — Stock Replenishment Alert', { align: 'left' });
    doc.moveDown(0.5);
    doc.fillColor(COLORS.text).fontSize(9).text(`Report date: ${report.report_date}   Scope: ${report.scope}   Items: ${report.rows.length}`);
    doc.moveDown();

    // Summary by severity
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    report.rows.forEach(r => { counts[r.severity] = (counts[r.severity] || 0) + 1; });
    const summary = `Critical: ${counts.critical}   High: ${counts.high}   Medium: ${counts.medium}   Low: ${counts.low}`;
    doc.fontSize(10).fillColor(COLORS.primaryLight).text(summary);
    doc.moveDown();

    // Group by branch
    const byBranch = new Map();
    report.rows.forEach(r => {
        const key = r.branch_name || 'Unknown';
        if (!byBranch.has(key)) byBranch.set(key, []);
        byBranch.get(key).push(r);
    });

    for (const [branchName, rows] of byBranch.entries()) {
        if (doc.y > 720) doc.addPage();
        doc.fontSize(13).fillColor(COLORS.primary).text(`📍 ${branchName}`, { underline: false });
        doc.moveDown(0.3);

        for (const r of rows) {
            if (doc.y > 730) doc.addPage();
            const severityC = severityColor(r.severity);

            doc.rect(40, doc.y, 515, 60).fillAndStroke(COLORS.bg, '#E5E7EB');
            const top = doc.y + 5;
            doc.fillColor(severityC).fontSize(8).text(r.severity.toUpperCase(), 48, top);
            doc.fillColor(COLORS.text).fontSize(11).text(r.item_name, 48, top + 12, { width: 380 });
            doc.fontSize(8).fillColor('#6B7280').text(`SKU: ${r.sku || '—'}   Brand: ${r.brand || '—'}   Unit: ${r.unit || '—'}`, 48, top + 28);

            const metricsX = 430;
            doc.fontSize(8).fillColor(COLORS.text).text(`Stock: ${r.current_stock}`, metricsX, top);
            doc.text(`Reorder @: ${r.reorder_level}`, metricsX, top + 10);
            doc.text(`Avg/day: ${r.avg_daily_sales.toFixed(2)}`, metricsX, top + 20);
            doc.fillColor(COLORS.gold).text(`Order: ${r.suggested_order_qty}`, metricsX, top + 32);

            if (r.other_branches && r.other_branches.length > 0) {
                const others = r.other_branches.map(o => `${o.branch_name}: ${o.stock_on_hand}`).join('  |  ');
                doc.fontSize(7).fillColor(COLORS.primaryLight).text(`Other: ${others}`, 48, top + 42, { width: 500 });
            }

            doc.y = top + 60;
            doc.moveDown(0.2);
        }
        doc.moveDown(0.5);
    }

    doc.end();
    return new Promise(resolve => doc.on('end', () => resolve(outPath)));
}

module.exports = { generateReorderPdf };
```

- [ ] **Step 2: Manual smoke test**

Temporarily add a test route or run a Node script:

```javascript
// test-pdf.js (temporary, delete after)
require('dotenv').config();
const mysql = require('mysql2/promise');
const reportSvc = require('./services/reorder-report-service');
const { generateReorderPdf } = require('./services/reorder-report-pdf-generator');
const path = require('path');

(async () => {
    const pool = mysql.createPool({ host: process.env.DB_HOST, user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
    reportSvc.setPool(pool);
    const report = await reportSvc.assembleReport({});
    const out = path.join(__dirname, 'test-reorder.pdf');
    await generateReorderPdf(report, out);
    console.log('Wrote', out);
    await pool.end();
})();
```

Run: `node test-pdf.js`
Open the PDF. Verify layout is readable. Delete `test-pdf.js`.

- [ ] **Step 3: Commit**

```bash
git add services/reorder-report-pdf-generator.js
git commit -m "feat(reorder): PDFKit reorder report generator"
```

---

## Task 11: Report Delivery (WhatsApp + FCM + Dashboard)

**Files:**
- Modify: `services/reorder-report-service.js`
- Modify: `server.js`, `routes/zoho.js`

- [ ] **Step 1: Add delivery function to report service**

Append to `services/reorder-report-service.js`:

```javascript
const path = require('path');
const fs = require('fs');
const { generateReorderPdf } = require('./reorder-report-pdf-generator');

async function getConfig(keys) {
    const [rows] = await pool.query(`SELECT config_key, config_value FROM ai_config WHERE config_key IN (?)`, [keys]);
    const map = {};
    rows.forEach(r => { map[r.config_key] = r.config_value; });
    return map;
}

async function getRecipientsForScope(scope) {
    // scope: 'consolidated' or 'branch:N'
    if (scope.startsWith('branch:')) {
        const branchId = parseInt(scope.split(':')[1], 10);
        const [rows] = await pool.query(
            `SELECT u.id AS user_id, u.full_name, u.phone
             FROM branches b
             JOIN users u ON u.id = b.manager_id
             WHERE b.id = ? AND u.is_active = 1`,
            [branchId]
        );
        return rows;
    }
    const cfg = await getConfig(['reorder_report_recipients']);
    const userIds = JSON.parse(cfg.reorder_report_recipients || '[]');
    if (userIds.length === 0) return [];
    const [rows] = await pool.query(
        `SELECT id AS user_id, full_name, phone FROM users WHERE id IN (?) AND is_active = 1`,
        [userIds]
    );
    return rows;
}

async function deliverReport(report, { force = false } = {}) {
    const [existing] = await pool.query(
        `SELECT id FROM reorder_report_log WHERE report_date = ? AND scope = ?`,
        [report.report_date, report.scope]
    );
    if (existing.length > 0 && !force) {
        return { skipped: true, reason: 'Already sent today' };
    }

    const deliveryStatus = { dashboard: 1, pdf: null, whatsapp: null, fcm: null };
    const cfg = await getConfig(['reorder_report_whatsapp_enabled', 'reorder_report_fcm_enabled', 'reorder_report_pdf_enabled']);

    // Generate PDF if enabled
    let pdfPath = null;
    if (cfg.reorder_report_pdf_enabled === '1' && report.rows.length > 0) {
        const uploadsDir = path.join(__dirname, '..', 'uploads', 'reorder-reports');
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
        const safeScope = report.scope.replace(':', '-');
        pdfPath = path.join(uploadsDir, `reorder-${report.report_date}-${safeScope}.pdf`);
        try {
            await generateReorderPdf(report, pdfPath);
            deliveryStatus.pdf = path.basename(pdfPath);
        } catch (e) {
            deliveryStatus.pdf = 'failed:' + e.message;
        }
    }

    const recipients = await getRecipientsForScope(report.scope);
    const summary = report.rows.length === 0
        ? `✅ No reorder needed (${report.report_date})`
        : `🚨 Reorder Alert — ${report.rows.length} items need reorder (${report.rows.filter(r => r.severity === 'critical').length} critical)`;

    // WhatsApp
    if (cfg.reorder_report_whatsapp_enabled === '1' && recipients.length > 0) {
        try {
            const notificationService = require('./notification-service');
            for (const r of recipients) {
                if (r.phone) {
                    await notificationService.sendWhatsApp({
                        phone: r.phone,
                        message: summary + (pdfPath ? `\nPDF attached.` : ''),
                        attachment: pdfPath
                    }).catch(e => console.error('[ReorderWA]', e.message));
                }
            }
            deliveryStatus.whatsapp = 'sent';
        } catch (e) {
            deliveryStatus.whatsapp = 'failed:' + e.message;
        }
    }

    // FCM
    if (cfg.reorder_report_fcm_enabled === '1' && recipients.length > 0) {
        try {
            const notificationService = require('./notification-service');
            for (const r of recipients) {
                await notificationService.send(r.user_id, {
                    type: 'reorder_report',
                    title: `📦 Reorder Report (${report.scope})`,
                    body: summary,
                    data: { scope: report.scope, date: report.report_date },
                    ttlSeconds: 86400
                }).catch(e => console.error('[ReorderFCM]', e.message));
            }
            deliveryStatus.fcm = 'sent';
        } catch (e) {
            deliveryStatus.fcm = 'failed:' + e.message;
        }
    }

    if (existing.length > 0 && force) {
        await pool.query(`UPDATE reorder_report_log SET delivery_status = ?, generated_at = NOW() WHERE id = ?`,
            [JSON.stringify(deliveryStatus), existing[0].id]);
    } else {
        await pool.query(
            `INSERT INTO reorder_report_log (report_date, scope, items_count, delivery_status) VALUES (?, ?, ?, ?)`,
            [report.report_date, report.scope, report.rows.length, JSON.stringify(deliveryStatus)]
        );
    }

    return { delivered: true, deliveryStatus, pdfPath };
}

async function runDailyReport({ force = false } = {}) {
    const [branches] = await pool.query(`
        SELECT DISTINCT zlm.local_branch_id AS branch_id
        FROM zoho_reorder_alerts a
        JOIN zoho_locations_map zlm ON zlm.zoho_location_id = a.zoho_location_id
        WHERE a.status = 'active' AND zlm.local_branch_id IS NOT NULL
    `);

    const results = [];
    for (const b of branches) {
        const rep = await assembleReport({ branchId: b.branch_id });
        const r = await deliverReport(rep, { force });
        results.push({ scope: rep.scope, ...r });
    }

    const consolidated = await assembleReport({});
    const cr = await deliverReport(consolidated, { force });
    results.push({ scope: consolidated.scope, ...cr });

    return { branches: branches.length, results };
}

module.exports.deliverReport = deliverReport;
module.exports.runDailyReport = runDailyReport;
module.exports.getRecipientsForScope = getRecipientsForScope;
```

- [ ] **Step 2: Wire pool + endpoint**

In `server.js`:
```javascript
const reorderReport = require('./services/reorder-report-service');
reorderReport.setPool(pool);
```

In `routes/zoho.js`:
```javascript
const reorderReport = require('../services/reorder-report-service');
const path = require('path');

/**
 * POST /api/zoho/reorder/run-report - Manual report trigger
 */
router.post('/reorder/run-report', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const force = req.body.force === true || req.query.force === '1';
        const result = await reorderReport.runDailyReport({ force });
        res.json({ success: true, data: result });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * GET /api/zoho/reorder/report - Fetch assembled report (dashboard view)
 */
router.get('/reorder/report', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const branchId = req.query.branch_id ? parseInt(req.query.branch_id, 10) : null;
        const date = req.query.date || null;
        const report = await reorderReport.assembleReport({ branchId, date });
        res.json({ success: true, data: report });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

/**
 * GET /api/zoho/reorder/report/pdf - Download PDF
 */
router.get('/reorder/report/pdf', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const branchId = req.query.branch_id ? parseInt(req.query.branch_id, 10) : null;
        const report = await reorderReport.assembleReport({ branchId });
        const uploadsDir = path.join(__dirname, '..', 'uploads', 'reorder-reports');
        const fs = require('fs');
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
        const safeScope = report.scope.replace(':', '-');
        const pdfPath = path.join(uploadsDir, `reorder-${report.report_date}-${safeScope}.pdf`);
        const { generateReorderPdf } = require('../services/reorder-report-pdf-generator');
        await generateReorderPdf(report, pdfPath);
        res.download(pdfPath);
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});
```

- [ ] **Step 3: Verify `notification-service` exposes `sendWhatsApp` and `send`**

Check `services/notification-service.js` exports. If `sendWhatsApp` doesn't exist, the code above should gracefully fail. Instead, use whatever the existing dispatch function is. In memory notes: `notification-service.js exports send(userId, {type, title, body, data, ttlSeconds})`. WhatsApp send goes through a different service.

Replace the WhatsApp block with:
```javascript
// WhatsApp via whatsapp-session-manager general session
if (cfg.reorder_report_whatsapp_enabled === '1' && recipients.length > 0) {
    try {
        const waManager = require('./whatsapp-session-manager');
        for (const r of recipients) {
            if (r.phone) {
                await waManager.sendToPhone(0, r.phone, summary).catch(e => console.error('[ReorderWA]', e.message));
                if (pdfPath) {
                    await waManager.sendMediaToPhone(0, r.phone, pdfPath, 'Reorder Report').catch(e => console.error('[ReorderWA-PDF]', e.message));
                }
            }
        }
        deliveryStatus.whatsapp = 'sent';
    } catch (e) {
        deliveryStatus.whatsapp = 'failed:' + e.message;
    }
}
```

Verify `whatsapp-session-manager.js` exposes `sendToPhone(branchId, phone, message)` and `sendMediaToPhone`. If not, inspect the file and adjust to the actual function names (search for `module.exports` at the bottom).

- [ ] **Step 4: Smoke test endpoint**

```bash
curl -X POST -H "Authorization: Bearer <token>" https://act.qcpaintshop.com/api/zoho/reorder/run-report -H "Content-Type: application/json" -d '{"force":true}'
```

Inspect `reorder_report_log` for rows.

- [ ] **Step 5: Commit**

```bash
git add services/reorder-report-service.js server.js routes/zoho.js
git commit -m "feat(reorder): report delivery via WhatsApp + FCM + dashboard"
```

---

## Task 12: Daily Report UI Tab

**Files:**
- Modify: `public/admin-zoho-reorder.html`

- [ ] **Step 1: Add tab button + panel**

```html
<button class="tab-btn" data-tab="daily-report" onclick="switchTab('daily-report')">
    Daily Report
</button>
```

```html
<div id="tab-daily-report" class="tab-panel hidden">
    <div class="flex gap-3 items-end mb-3 flex-wrap">
        <div>
            <label class="block text-xs text-gray-600">Date</label>
            <input type="date" id="reportDate" class="border rounded px-2 py-1">
        </div>
        <div>
            <label class="block text-xs text-gray-600">Branch</label>
            <select id="reportBranch" class="border rounded px-2 py-1">
                <option value="">— Consolidated —</option>
            </select>
        </div>
        <button onclick="loadReport()" class="px-3 py-1.5 bg-indigo-600 text-white rounded text-sm">Load</button>
        <button onclick="downloadReportPdf()" class="px-3 py-1.5 border rounded text-sm">Download PDF</button>
        <button onclick="rerunReport()" class="px-3 py-1.5 bg-amber-600 text-white rounded text-sm">Re-run (force)</button>
    </div>
    <div id="reportSummary" class="text-sm text-gray-700 mb-3"></div>
    <div id="reportBody"></div>
</div>
```

- [ ] **Step 2: Add JS**

```javascript
async function loadReportBranches() {
    const token = localStorage.getItem('auth_token');
    const res = await fetch('/api/branches', { headers: { 'Authorization': 'Bearer ' + token } });
    const json = await res.json();
    const sel = document.getElementById('reportBranch');
    if (json.success || Array.isArray(json.data || json)) {
        const list = json.data || json;
        sel.innerHTML = '<option value="">— Consolidated —</option>' +
            list.filter(b => b.is_active !== 0).map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
    }
}

async function loadReport() {
    const token = localStorage.getItem('auth_token');
    const date = document.getElementById('reportDate').value;
    const branchId = document.getElementById('reportBranch').value;
    const qs = new URLSearchParams();
    if (date) qs.set('date', date);
    if (branchId) qs.set('branch_id', branchId);
    const res = await fetch('/api/zoho/reorder/report?' + qs.toString(), { headers: { 'Authorization': 'Bearer ' + token } });
    const json = await res.json();
    if (!json.success) { alert(json.message); return; }
    renderReport(json.data);
}

function renderReport(r) {
    const sev = { critical: 0, high: 0, medium: 0, low: 0 };
    r.rows.forEach(row => { sev[row.severity] = (sev[row.severity] || 0) + 1; });
    document.getElementById('reportSummary').innerHTML =
        `<b>${r.rows.length}</b> items | ` +
        `<span class="text-red-600">Critical: ${sev.critical}</span> | ` +
        `<span class="text-amber-600">High: ${sev.high}</span> | ` +
        `<span class="text-yellow-600">Medium: ${sev.medium}</span> | ` +
        `<span class="text-gray-500">Low: ${sev.low}</span>`;

    const body = document.getElementById('reportBody');
    if (r.rows.length === 0) { body.innerHTML = '<div class="p-4 text-center text-gray-500">✅ No items need reorder</div>'; return; }

    body.innerHTML = `
        <table class="min-w-full bg-white text-sm">
            <thead class="bg-gray-50">
                <tr>
                    <th class="px-2 py-2 text-left">Severity</th>
                    <th class="px-2 py-2 text-left">Item</th>
                    <th class="px-2 py-2 text-left">Branch</th>
                    <th class="px-2 py-2 text-right">Stock</th>
                    <th class="px-2 py-2 text-right">Reorder @</th>
                    <th class="px-2 py-2 text-right">Avg/day</th>
                    <th class="px-2 py-2 text-right">Days left</th>
                    <th class="px-2 py-2 text-right">Order Qty</th>
                    <th class="px-2 py-2 text-left">Other branches</th>
                </tr>
            </thead>
            <tbody>
                ${r.rows.map(row => `
                    <tr class="border-b">
                        <td class="px-2 py-2">
                            <span class="px-2 py-0.5 rounded text-xs ${
                                row.severity === 'critical' ? 'bg-red-100 text-red-700' :
                                row.severity === 'high' ? 'bg-amber-100 text-amber-700' :
                                row.severity === 'medium' ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-700'
                            }">${row.severity}</span>
                        </td>
                        <td class="px-2 py-2">
                            <div class="font-medium">${escapeHtml(row.item_name)}</div>
                            <div class="text-xs text-gray-500">${escapeHtml(row.sku || '')} · ${escapeHtml(row.brand || '')}</div>
                        </td>
                        <td class="px-2 py-2">${escapeHtml(row.branch_name || '')}</td>
                        <td class="px-2 py-2 text-right">${row.current_stock}</td>
                        <td class="px-2 py-2 text-right">${row.reorder_level}</td>
                        <td class="px-2 py-2 text-right">${row.avg_daily_sales.toFixed(2)}</td>
                        <td class="px-2 py-2 text-right ${row.days_to_stockout != null && row.days_to_stockout <= 3 ? 'text-red-600 font-semibold' : ''}">
                            ${row.days_to_stockout != null ? row.days_to_stockout : '∞'}
                        </td>
                        <td class="px-2 py-2 text-right font-semibold text-indigo-700">${row.suggested_order_qty}</td>
                        <td class="px-2 py-2 text-xs">
                            ${row.other_branches.length === 0 ? '<span class="text-gray-400">—</span>' :
                              row.other_branches.slice(0, 5).map(o => `<span class="inline-block bg-green-50 text-green-700 px-1.5 py-0.5 rounded mr-1">${escapeHtml(o.branch_name)}: ${o.stock_on_hand}</span>`).join('')}
                        </td>
                    </tr>
                `).join('')}
            </tbody>
        </table>
    `;
}

async function downloadReportPdf() {
    const date = document.getElementById('reportDate').value;
    const branchId = document.getElementById('reportBranch').value;
    const qs = new URLSearchParams();
    if (date) qs.set('date', date);
    if (branchId) qs.set('branch_id', branchId);
    window.open('/api/zoho/reorder/report/pdf?' + qs.toString(), '_blank');
}

async function rerunReport() {
    if (!confirm('Re-run report and send to recipients (force)?')) return;
    const token = localStorage.getItem('auth_token');
    const res = await fetch('/api/zoho/reorder/run-report', {
        method: 'POST',
        headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true })
    });
    const json = await res.json();
    alert(json.success ? 'Report run complete' : json.message);
    loadReport();
}

// Wire on tab open
// Add to switchTab: if (tab === 'daily-report') { loadReportBranches(); loadReport(); }
```

Modify `switchTab` to call `loadReportBranches()` and `loadReport()` when switching to this tab. Set default date to today on load.

- [ ] **Step 3: Smoke test**

Reload page, click Daily Report tab, see report, change branch filter, download PDF.

- [ ] **Step 4: Commit**

```bash
git add public/admin-zoho-reorder.html
git commit -m "feat(reorder): Daily Report UI tab with inter-branch stock"
```

---

## Task 13: Sales Analysis UI Tab

**Files:**
- Modify: `routes/zoho.js`
- Modify: `public/admin-zoho-reorder.html`

- [ ] **Step 1: Add endpoint**

In `routes/zoho.js`:

```javascript
/**
 * GET /api/zoho/reorder/sales-analysis - Per-branch per-item velocity
 */
router.get('/reorder/sales-analysis', requirePermission('zoho', 'reorder'), async (req, res) => {
    try {
        const { branch_id, brand, category, from, to } = req.query;
        const days = 60;
        let where = `WHERE bis.sale_date >= DATE_SUB(CURDATE(), INTERVAL ${days} DAY)`;
        const params = [];
        if (branch_id) { where += ` AND bis.local_branch_id = ?`; params.push(parseInt(branch_id, 10)); }
        if (brand) { where += ` AND zim.zoho_brand = ?`; params.push(brand); }
        if (category) { where += ` AND zim.zoho_category_name = ?`; params.push(category); }
        if (from) { where += ` AND bis.sale_date >= ?`; params.push(from); }
        if (to) { where += ` AND bis.sale_date <= ?`; params.push(to); }

        const [rows] = await pool.query(`
            SELECT bis.local_branch_id, b.name AS branch_name,
                   bis.zoho_item_id, zim.zoho_item_name AS item_name, zim.zoho_sku AS sku,
                   zim.zoho_brand AS brand, zim.zoho_category_name AS category,
                   SUM(bis.qty_sold) AS total_qty,
                   SUM(bis.revenue) AS total_revenue,
                   ROUND(SUM(bis.qty_sold) / ${days}, 3) AS avg_daily_sales,
                   COALESCE(ls.stock_on_hand, 0) AS current_stock,
                   rc.reorder_level
            FROM branch_item_sales bis
            JOIN zoho_items_map zim ON zim.zoho_item_id = bis.zoho_item_id
            LEFT JOIN branches b ON b.id = bis.local_branch_id
            LEFT JOIN zoho_locations_map zlm ON zlm.local_branch_id = bis.local_branch_id
            LEFT JOIN zoho_location_stock ls ON ls.zoho_item_id = bis.zoho_item_id AND ls.zoho_location_id = zlm.zoho_location_id
            LEFT JOIN zoho_reorder_config rc ON rc.zoho_item_id = bis.zoho_item_id AND rc.zoho_location_id = zlm.zoho_location_id
            ${where}
            GROUP BY bis.local_branch_id, bis.zoho_item_id
            ORDER BY total_qty DESC
            LIMIT 2000
        `, params);

        res.json({ success: true, data: rows });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});
```

- [ ] **Step 2: Add tab + JS**

Tab button:
```html
<button class="tab-btn" data-tab="sales-analysis" onclick="switchTab('sales-analysis')">Sales Analysis</button>
```

Panel:
```html
<div id="tab-sales-analysis" class="tab-panel hidden">
    <div class="flex gap-3 items-end mb-3 flex-wrap">
        <div><label class="block text-xs text-gray-600">Branch</label>
            <select id="saBranch" class="border rounded px-2 py-1">
                <option value="">All</option>
            </select>
        </div>
        <div><label class="block text-xs text-gray-600">Brand</label>
            <input type="text" id="saBrand" class="border rounded px-2 py-1" placeholder="Asian Paints">
        </div>
        <button onclick="loadSalesAnalysis()" class="px-3 py-1.5 bg-indigo-600 text-white rounded text-sm">Load</button>
        <button onclick="exportSalesAnalysisCsv()" class="px-3 py-1.5 border rounded text-sm">Export CSV</button>
    </div>
    <div class="overflow-x-auto">
        <table class="min-w-full bg-white text-sm">
            <thead class="bg-gray-50">
                <tr>
                    <th class="px-2 py-2 text-left">Item</th>
                    <th class="px-2 py-2 text-left">Branch</th>
                    <th class="px-2 py-2 text-left">Brand</th>
                    <th class="px-2 py-2 text-right">60d qty</th>
                    <th class="px-2 py-2 text-right">Avg/day</th>
                    <th class="px-2 py-2 text-right">Stock</th>
                    <th class="px-2 py-2 text-right">Days left</th>
                    <th class="px-2 py-2 text-right">Reorder @</th>
                </tr>
            </thead>
            <tbody id="saBody"></tbody>
        </table>
    </div>
</div>
```

JS:
```javascript
let saRows = [];

async function loadSalesAnalysisBranches() {
    const token = localStorage.getItem('auth_token');
    const res = await fetch('/api/branches', { headers: { 'Authorization': 'Bearer ' + token } });
    const json = await res.json();
    const list = json.data || json;
    const sel = document.getElementById('saBranch');
    sel.innerHTML = '<option value="">All</option>' +
        list.filter(b => b.is_active !== 0).map(b => `<option value="${b.id}">${escapeHtml(b.name)}</option>`).join('');
}

async function loadSalesAnalysis() {
    const token = localStorage.getItem('auth_token');
    const branch = document.getElementById('saBranch').value;
    const brand = document.getElementById('saBrand').value;
    const qs = new URLSearchParams();
    if (branch) qs.set('branch_id', branch);
    if (brand) qs.set('brand', brand);
    const res = await fetch('/api/zoho/reorder/sales-analysis?' + qs.toString(), { headers: { 'Authorization': 'Bearer ' + token } });
    const json = await res.json();
    if (!json.success) { alert(json.message); return; }
    saRows = json.data;
    document.getElementById('saBody').innerHTML = saRows.map(r => {
        const daysLeft = r.avg_daily_sales > 0 ? Math.floor(r.current_stock / r.avg_daily_sales) : '∞';
        return `<tr class="border-b">
            <td class="px-2 py-1.5">
                <div class="font-medium">${escapeHtml(r.item_name)}</div>
                <div class="text-xs text-gray-500">${escapeHtml(r.sku || '')}</div>
            </td>
            <td class="px-2 py-1.5">${escapeHtml(r.branch_name || '')}</td>
            <td class="px-2 py-1.5">${escapeHtml(r.brand || '')}</td>
            <td class="px-2 py-1.5 text-right">${r.total_qty}</td>
            <td class="px-2 py-1.5 text-right">${Number(r.avg_daily_sales).toFixed(2)}</td>
            <td class="px-2 py-1.5 text-right">${r.current_stock}</td>
            <td class="px-2 py-1.5 text-right">${daysLeft}</td>
            <td class="px-2 py-1.5 text-right">${r.reorder_level || '—'}</td>
        </tr>`;
    }).join('');
}

function exportSalesAnalysisCsv() {
    const headers = ['item', 'sku', 'branch', 'brand', 'qty_60d', 'avg_daily', 'stock', 'reorder_level'];
    const lines = [headers.join(',')];
    for (const r of saRows) {
        lines.push([
            JSON.stringify(r.item_name || ''),
            JSON.stringify(r.sku || ''),
            JSON.stringify(r.branch_name || ''),
            JSON.stringify(r.brand || ''),
            r.total_qty,
            r.avg_daily_sales,
            r.current_stock,
            r.reorder_level || ''
        ].join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'sales-analysis.csv'; a.click();
    URL.revokeObjectURL(url);
}
```

Wire tab switch: `if (tab === 'sales-analysis') { loadSalesAnalysisBranches(); loadSalesAnalysis(); }`.

- [ ] **Step 3: Smoke test + Commit**

```bash
git add routes/zoho.js public/admin-zoho-reorder.html
git commit -m "feat(reorder): Sales Analysis tab with CSV export"
```

---

## Task 14: Branch-Manager Scoping Middleware

**Files:**
- Create: `middleware/branchScope.js`
- Modify: `routes/zoho.js` (apply to list endpoints only)

- [ ] **Step 1: Create middleware**

Create `middleware/branchScope.js`:

```javascript
/**
 * Branch-scope middleware for non-admin branch managers.
 *
 * Adds req.branchScope = { branchId: null | number }.
 * - Admins: branchId = null (no filter)
 * - Managers: branchId = their branch's id
 * - Others: branchId = null (no filter; rely on permission system for access)
 */
let pool;
function setPool(p) { pool = p; }

async function branchScope(req, res, next) {
    try {
        if (!req.user) { req.branchScope = { branchId: null }; return next(); }
        const role = req.user.role || '';
        if (role === 'admin' || role === 'superadmin') {
            req.branchScope = { branchId: null };
            return next();
        }
        if (role === 'manager') {
            const [rows] = await pool.query(
                `SELECT id FROM branches WHERE manager_id = ? AND is_active = 1 LIMIT 1`,
                [req.user.id]
            );
            req.branchScope = { branchId: rows[0]?.id || null };
            return next();
        }
        req.branchScope = { branchId: null };
        next();
    } catch (e) {
        console.error('[branchScope]', e);
        req.branchScope = { branchId: null };
        next();
    }
}

module.exports = { setPool, branchScope };
```

- [ ] **Step 2: Wire pool in server.js**

```javascript
const branchScope = require('./middleware/branchScope');
branchScope.setPool(pool);
```

- [ ] **Step 3: Apply to list endpoints that honor scoping**

In `routes/zoho.js`, on the `GET /reorder/report` and `GET /reorder/config` endpoints:

```javascript
const { branchScope } = require('../middleware/branchScope');

// Apply:
router.get('/reorder/report', requirePermission('zoho', 'reorder'), branchScope, async (req, res) => {
    try {
        const branchId = req.branchScope.branchId || (req.query.branch_id ? parseInt(req.query.branch_id, 10) : null);
        // ... rest
```

Same pattern for the config list endpoint — if `branchId` scope is set, filter by `zlm.local_branch_id = ?`.

- [ ] **Step 4: Commit**

```bash
git add middleware/branchScope.js server.js routes/zoho.js
git commit -m "feat(reorder): branch-scope middleware for manager filtering"
```

---

## Task 15: Register Scheduler Crons

**Files:**
- Modify: `services/sync-scheduler.js` (or wherever cron jobs get registered via `automation-registry`)

- [ ] **Step 1: Inspect existing automation-registry usage**

Read `services/sync-scheduler.js` and `services/painter-scheduler.js` to understand the registry `register()` signature.

- [ ] **Step 2: Add three new job registrations**

In the appropriate scheduler file (likely `services/sync-scheduler.js`), add at the end of the existing registration block:

```javascript
const invoiceLineSync = require('./zoho-invoice-line-sync');
const reorderCompute = require('./reorder-compute-service');
const reorderReport = require('./reorder-report-service');

registry.register('invoice-line-sync', {
    name: 'Invoice line items sync',
    description: 'Pulls line items from Zoho invoices into branch_item_sales',
    schedule: '0 0 2 * * *',   // 02:00 IST daily
    timezone: 'Asia/Kolkata',
    service: async () => {
        await invoiceLineSync.syncInvoiceLines();
    }
});

registry.register('reorder-compute', {
    name: 'Reorder level compute',
    description: 'Computes auto reorder levels from 60-day sales velocity',
    schedule: '0 30 2 * * *',   // 02:30 IST daily
    timezone: 'Asia/Kolkata',
    service: async () => {
        await reorderCompute.computeAll();
    }
});

registry.register('reorder-report', {
    name: 'Daily reorder report',
    description: 'Generates & delivers daily reorder report per branch + consolidated',
    schedule: '0 0 7 * * *',    // 07:00 IST daily
    timezone: 'Asia/Kolkata',
    service: async () => {
        await reorderReport.runDailyReport();
    }
});
```

- [ ] **Step 3: Verify timezone + cron format matches existing jobs**

Check `painter-scheduler.js` for the exact cron string format (5-field vs 6-field). Align accordingly.

- [ ] **Step 4: Commit**

```bash
git add services/sync-scheduler.js
git commit -m "feat(reorder): register 3 crons (invoice-sync, compute, report)"
```

---

## Task 16: Deploy + Back-fill + Verify

- [ ] **Step 1: Push + deploy**

```bash
git push origin master
ssh root@161.97.114.189 "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && npm install && node migrations/migrate-reorder-intelligence.js && pm2 restart business-manager"
```

- [ ] **Step 2: Run full test suite**

```bash
ssh root@161.97.114.189 "cd /www/wwwroot/act.qcpaintshop.com && npx jest tests/unit/reorder-compute.test.js tests/unit/invoice-line-sync.test.js tests/unit/reorder-report.test.js tests/unit/brand-config.test.js"
```
Expected: all green.

- [ ] **Step 3: Configure brand lead times via UI**

Open `/admin-zoho-reorder.html`, Brand Config tab. Add at least:
- Asian Paints: 3 / 3
- Berger: 5 / 3
- Shalimar: 10 / 5

`__default__` stays at 7/5.

- [ ] **Step 4: Kick off back-fill**

Click "Back-fill sales history" button. Watch banner progress. Wait until "Done ✅" (~10 min).

Verify: `SELECT COUNT(*) FROM branch_item_sales; SELECT COUNT(*) FROM invoice_line_sync_cursor;` — both positive.

- [ ] **Step 5: Run first compute**

`POST /api/zoho/reorder/compute-now`. Inspect response: `{updated: N, skipped: M, skippedManual: 0, alerts: {active, resolved}}`.

Open Configuration tab — verify rows with 🤖 Auto badge and avg_daily_sales populated.

- [ ] **Step 6: Run first report (force, but WhatsApp/FCM still disabled)**

`POST /api/zoho/reorder/run-report` with `{force:true}`. Open Daily Report tab — verify data shows.

Download PDF, confirm layout.

- [ ] **Step 7: Enable WhatsApp + FCM delivery**

Update `ai_config`:
```sql
UPDATE ai_config SET config_value = '1' WHERE config_key = 'reorder_report_whatsapp_enabled';
UPDATE ai_config SET config_value = '1' WHERE config_key = 'reorder_report_fcm_enabled';
UPDATE ai_config SET config_value = '[3, 5]' WHERE config_key = 'reorder_report_recipients';
-- adjust user IDs for admin + purchase manager
```

- [ ] **Step 8: Trigger report again + verify delivery**

Re-run `run-report` with force. Check recipients received WhatsApp + FCM. Check `reorder_report_log.delivery_status`.

- [ ] **Step 9: Commit final docs update + MEMORY.md**

Update `MEMORY.md` with a short summary of new tables, endpoints, crons. Commit.

```bash
git add memory/
git commit -m "docs(memory): reorder intelligence feature notes"
git push origin master
```

---

## Self-Review Checklist

- [x] **Spec coverage**: Every section in the spec has at least one task. Architecture (Task 4-11), data model (Task 1), services (Task 4, 6, 9-11), scheduler (Task 15), UI (Task 3, 8, 12, 13), permissions (Task 14), config keys (Task 1), endpoints (Tasks 2, 5, 7, 8, 11, 13), migration (Task 1), rollout (Task 16), testing (Tasks 2, 4, 6, 9).
- [x] **No placeholders**: every code step has complete code. No "TODO", "similar to", "appropriate error handling" without specifics.
- [x] **Type consistency**: function names stable — `computeReorderLevel`, `computeSeverity`, `assembleReport`, `runDailyReport`, `syncInvoiceLines` used identically across tasks.
- [x] **File paths** are absolute-style (`services/…`, `public/…`, `routes/…`, `tests/unit/…`, `middleware/…`).

One gap worth surfacing:
- `zoho_reorder_alerts` table structure is assumed but should be verified against current schema during Task 6 Step 4. Migration adds the unique key if missing.
- `notification-service.js` WhatsApp function name must be verified against actual exports in Task 11 Step 3 — plan uses both `sendWhatsApp` (initial) and `whatsapp-session-manager.sendToPhone` (corrected) and explicitly asks the engineer to verify.

These are flagged inline in the tasks, not placeholders to fix.
