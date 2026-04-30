# Item Master Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a 5-tab admin page for managing Zoho Books items — standardized naming/SKU, DPL pricing with auto-calculation, NotebookLM integration, price history, and data health checks.

**Architecture:** New route file `routes/item-master.js` with 17 endpoints reading/writing `zoho_items_map` + 3 new tables. Single frontend page `admin-item-master.html` with 5 tabs. Reuses existing `price-list-parser.js` for PDF parsing and `zoho_bulk_jobs` for Zoho sync.

**Tech Stack:** Express.js, MySQL/MariaDB, Zod validation, Multer PDF upload, NotebookLM CLI, Tailwind CSS, vanilla JS frontend.

**Spec:** `docs/superpowers/specs/2026-04-07-item-master-management-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `migrations/migrate-item-master.js` | Creates 3 tables: `item_naming_rules`, `dpl_versions`, `dpl_price_history` |
| `routes/item-master.js` | 17 API endpoints across 5 groups (Items, Naming, DPL, NotebookLM, History/Health) |
| `public/admin-item-master.html` | 5-tab frontend: Items List, DPL Import, Price Calculator, Price History, Health Check |
| `tests/unit/item-master.test.js` | Unit tests for pricing formula, name generation, health check logic |

### Modified Files
| File | Change |
|------|--------|
| `server.js` (~line 278) | Register `routes/item-master.js` at `/api/item-master` |
| `config/uploads.js` | Add `uploadDplPdf` multer config for DPL PDF uploads |
| `public/universal-nav-loader.js` (~line 39) | Add `'item-master'` to SUBNAV_MAP pointing to Zoho subnav |

---

## Task 1: Database Migration

**Files:**
- Create: `migrations/migrate-item-master.js`

- [ ] **Step 1: Create the migration file**

```javascript
// migrations/migrate-item-master.js
const pool = require('../config/database').createPool();

async function migrate() {
    console.log('=== Item Master Migration ===');

    // Table 1: item_naming_rules
    await pool.query(`
        CREATE TABLE IF NOT EXISTS item_naming_rules (
            id INT PRIMARY KEY AUTO_INCREMENT,
            brand VARCHAR(100) NOT NULL,
            category VARCHAR(100) NOT NULL,
            category_code VARCHAR(5) NOT NULL,
            product_name VARCHAR(255) NOT NULL,
            product_short VARCHAR(10) NOT NULL,
            has_base BOOLEAN DEFAULT false,
            has_color BOOLEAN DEFAULT false,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY unique_brand_product (brand, product_name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('Created table: item_naming_rules');

    // Table 2: dpl_versions
    await pool.query(`
        CREATE TABLE IF NOT EXISTS dpl_versions (
            id INT PRIMARY KEY AUTO_INCREMENT,
            brand VARCHAR(100) NOT NULL,
            version_label VARCHAR(50),
            effective_date DATE NOT NULL,
            pdf_path VARCHAR(500),
            notebooklm_notebook_id VARCHAR(100),
            total_items INT DEFAULT 0,
            matched_items INT DEFAULT 0,
            status ENUM('draft','active','archived') DEFAULT 'draft',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_brand (brand),
            INDEX idx_status (status)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('Created table: dpl_versions');

    // Table 3: dpl_price_history
    await pool.query(`
        CREATE TABLE IF NOT EXISTS dpl_price_history (
            id INT PRIMARY KEY AUTO_INCREMENT,
            zoho_item_id VARCHAR(100) NOT NULL,
            dpl_version_id INT,
            old_dpl DECIMAL(10,2),
            new_dpl DECIMAL(10,2),
            old_purchase_rate DECIMAL(10,2),
            new_purchase_rate DECIMAL(10,2),
            old_sales_rate DECIMAL(10,2),
            new_sales_rate DECIMAL(10,2),
            changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            changed_by INT,
            FOREIGN KEY (dpl_version_id) REFERENCES dpl_versions(id),
            INDEX idx_item (zoho_item_id),
            INDEX idx_version (dpl_version_id),
            INDEX idx_changed_at (changed_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('Created table: dpl_price_history');

    console.log('=== Item Master Migration Complete ===');
    process.exit(0);
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
```

- [ ] **Step 2: Run the migration**

Run: `node migrations/migrate-item-master.js`
Expected: Three "Created table" messages + "Migration Complete"

- [ ] **Step 3: Commit**

```bash
git add migrations/migrate-item-master.js
git commit -m "feat(item-master): add migration for naming rules, DPL versions, price history tables"
```

---

## Task 2: Unit Tests for Core Logic

**Files:**
- Create: `tests/unit/item-master.test.js`

- [ ] **Step 1: Write tests for pricing formula, name generation, and health check**

```javascript
// tests/unit/item-master.test.js
const { z } = require('zod');

/**
 * Item Master — unit tests for pricing formula, name generation, and health checks
 */

// === Pricing Formula ===

function calculateSalesPrice(dpl) {
    return Math.ceil(dpl * 1.298);
}

describe('Item Master — Pricing Formula', () => {
    it('should calculate sales price as ceil(DPL * 1.298)', () => {
        expect(calculateSalesPrice(285)).toBe(370);
        expect(calculateSalesPrice(410)).toBe(533);
        expect(calculateSalesPrice(1000)).toBe(1298);
        expect(calculateSalesPrice(100)).toBe(130);
    });

    it('should round up fractional results', () => {
        // 285 * 1.298 = 369.93 → 370
        expect(calculateSalesPrice(285)).toBe(370);
        // 500 * 1.298 = 649.0 → 649 (exact)
        expect(calculateSalesPrice(500)).toBe(649);
    });

    it('should handle zero DPL', () => {
        expect(calculateSalesPrice(0)).toBe(0);
    });
});

// === Size Padding ===

function padSize(size) {
    return String(size).padStart(2, '0');
}

describe('Item Master — Size Padding', () => {
    it('should zero-pad single digit sizes', () => {
        expect(padSize(1)).toBe('01');
        expect(padSize(4)).toBe('04');
    });

    it('should not pad two digit sizes', () => {
        expect(padSize(10)).toBe('10');
        expect(padSize(20)).toBe('20');
    });
});

// === Name Generation ===

const CATEGORY_CODES = {
    'Interior Primer': 'IP', 'Exterior Primer': 'EP',
    'Interior Emulsion': 'IE', 'Exterior Emulsion': 'EE',
    'Enamel': 'EN', 'Wood Finish': 'WF',
    'Waterproofing': 'WP', 'Distemper': 'DT',
    'Putty': 'PT', 'Stainer/Colorant': 'ST',
    'Thinner': 'TH', 'Tools & Accessories': 'TA',
    'Floor Coating': 'FL', 'Spray Paint': 'SP',
    'Metal Primer': 'MP', 'Adhesive': 'AD'
};

function generateItemName(rule, size, variant) {
    const sizePad = padSize(size);
    const variantStr = variant || '';
    return `${rule.category_code}${sizePad} ${rule.product_short}${variantStr} ${rule.product_name} ${sizePad} L`.toUpperCase();
}

function generateDescription(rule, size, variant, brand) {
    const sizePad = padSize(size);
    const variantStr = variant || '';
    return `${rule.category} ${brand} ${sizePad} L (${rule.product_short}${variantStr})`.toUpperCase();
}

function generateSku(rule, variant, size) {
    const sizePad = padSize(size);
    const variantStr = variant || '';
    return `${rule.product_short}${variantStr}${sizePad}`.toUpperCase();
}

describe('Item Master — Name Generation', () => {
    const primerRule = {
        category: 'Exterior Primer',
        category_code: 'EP',
        product_name: 'Perfect Start Primer',
        product_short: 'PSP',
        has_base: false,
        has_color: false
    };

    const emulsionRule = {
        category: 'Exterior Emulsion',
        category_code: 'EE',
        product_name: 'Power Bright Ext Emulsion',
        product_short: 'PB',
        has_base: true,
        has_color: false
    };

    const enamelRule = {
        category: 'Enamel',
        category_code: 'EN',
        product_name: 'Cover Max Enamel Black',
        product_short: 'CM',
        has_base: false,
        has_color: true
    };

    it('should generate primer item name (no variant)', () => {
        expect(generateItemName(primerRule, 1, null))
            .toBe('EP01 PSP PERFECT START PRIMER 01 L');
    });

    it('should generate primer SKU (no variant)', () => {
        expect(generateSku(primerRule, null, 1)).toBe('PSP01');
    });

    it('should generate primer description', () => {
        expect(generateDescription(primerRule, 1, null, 'Birla Opus'))
            .toBe('EXTERIOR PRIMER BIRLA OPUS 01 L (PSP)');
    });

    it('should generate emulsion item name with base', () => {
        expect(generateItemName(emulsionRule, 1, '1'))
            .toBe('EE01 PB1 POWER BRIGHT EXT EMULSION 01 L');
    });

    it('should generate emulsion SKU with base', () => {
        expect(generateSku(emulsionRule, '1', 1)).toBe('PB101');
        expect(generateSku(emulsionRule, '3', 4)).toBe('PB304');
    });

    it('should generate enamel item name with color', () => {
        expect(generateItemName(enamelRule, 1, 'BL'))
            .toBe('EN01 CMBL COVER MAX ENAMEL BLACK 01 L');
    });

    it('should generate enamel SKU with color', () => {
        expect(generateSku(enamelRule, 'BL', 1)).toBe('CMBL01');
    });
});

// === Health Check Logic ===

function checkItemHealth(item) {
    const issues = [];
    if (!item.zoho_sku || item.zoho_sku.trim() === '') {
        issues.push({ type: 'missing_sku', message: 'No SKU set' });
    }
    if (!item.zoho_cf_dpl || Number(item.zoho_cf_dpl) === 0) {
        issues.push({ type: 'missing_dpl', message: 'No DPL price set' });
    }
    if (!item.zoho_brand || item.zoho_brand.trim() === '') {
        issues.push({ type: 'missing_brand_category', message: 'No brand set' });
    }
    if (!item.zoho_category_name || item.zoho_category_name.trim() === '') {
        issues.push({ type: 'missing_brand_category', message: 'No category set' });
    }
    if (item.zoho_cf_dpl && item.zoho_purchase_rate && Number(item.zoho_cf_dpl) !== Number(item.zoho_purchase_rate)) {
        issues.push({ type: 'dpl_purchase_mismatch', message: `DPL (${item.zoho_cf_dpl}) != Purchase (${item.zoho_purchase_rate})` });
    }
    if (item.zoho_cf_dpl && item.zoho_rate) {
        const expectedSales = Math.ceil(Number(item.zoho_cf_dpl) * 1.298);
        if (Number(item.zoho_rate) !== expectedSales) {
            issues.push({ type: 'sales_price_mismatch', message: `Sales (${item.zoho_rate}) != Expected (${expectedSales})` });
        }
    }
    // Check name format: should start with 2-3 letter category code + 2 digit size
    const namePattern = /^[A-Z]{2,3}\d{2}\s/;
    if (item.zoho_item_name && !namePattern.test(item.zoho_item_name)) {
        issues.push({ type: 'bad_name_format', message: 'Name does not match standard format' });
    }
    return issues;
}

describe('Item Master — Health Check', () => {
    it('should flag missing SKU', () => {
        const issues = checkItemHealth({ zoho_item_name: 'EP01 PSP Test 01 L', zoho_sku: '', zoho_cf_dpl: '285', zoho_purchase_rate: '285', zoho_rate: '370', zoho_brand: 'Birla Opus', zoho_category_name: 'Primer' });
        expect(issues.some(i => i.type === 'missing_sku')).toBe(true);
    });

    it('should flag missing DPL', () => {
        const issues = checkItemHealth({ zoho_item_name: 'EP01 PSP Test 01 L', zoho_sku: 'PSP01', zoho_cf_dpl: null, zoho_purchase_rate: '285', zoho_rate: '370', zoho_brand: 'Birla Opus', zoho_category_name: 'Primer' });
        expect(issues.some(i => i.type === 'missing_dpl')).toBe(true);
    });

    it('should flag DPL/purchase mismatch', () => {
        const issues = checkItemHealth({ zoho_item_name: 'EP01 PSP Test 01 L', zoho_sku: 'PSP01', zoho_cf_dpl: '285', zoho_purchase_rate: '300', zoho_rate: '370', zoho_brand: 'Birla Opus', zoho_category_name: 'Primer' });
        expect(issues.some(i => i.type === 'dpl_purchase_mismatch')).toBe(true);
    });

    it('should flag sales price mismatch', () => {
        const issues = checkItemHealth({ zoho_item_name: 'EP01 PSP Test 01 L', zoho_sku: 'PSP01', zoho_cf_dpl: '285', zoho_purchase_rate: '285', zoho_rate: '400', zoho_brand: 'Birla Opus', zoho_category_name: 'Primer' });
        expect(issues.some(i => i.type === 'sales_price_mismatch')).toBe(true);
    });

    it('should flag bad name format', () => {
        const issues = checkItemHealth({ zoho_item_name: 'Royale Luxury Emulsion 4 Ltr', zoho_sku: 'RL04', zoho_cf_dpl: '3250', zoho_purchase_rate: '3250', zoho_rate: '4221', zoho_brand: 'Asian Paints', zoho_category_name: 'Emulsion' });
        expect(issues.some(i => i.type === 'bad_name_format')).toBe(true);
    });

    it('should return no issues for complete item', () => {
        const issues = checkItemHealth({ zoho_item_name: 'EP01 PSP PERFECT START PRIMER 01 L', zoho_sku: 'PSP01', zoho_cf_dpl: '285', zoho_purchase_rate: '285', zoho_rate: '370', zoho_brand: 'Birla Opus', zoho_category_name: 'Exterior Primer' });
        expect(issues).toEqual([]);
    });
});

// === Zod Validation Schemas ===

const bulkEditSchema = z.object({
    items: z.array(z.object({
        zoho_item_id: z.string().min(1),
        changes: z.object({
            zoho_item_name: z.string().optional(),
            zoho_description: z.string().optional(),
            zoho_sku: z.string().optional(),
            zoho_brand: z.string().optional(),
            zoho_category_name: z.string().optional()
        })
    })).min(1)
});

const dplApplySchema = z.object({
    items: z.array(z.object({
        zoho_item_id: z.string().min(1),
        new_dpl: z.coerce.number().positive()
    })).min(1),
    dpl_version_id: z.coerce.number().int().positive().optional()
});

const namingRuleSchema = z.object({
    brand: z.string().min(1),
    category: z.string().min(1),
    category_code: z.string().min(2).max(5),
    product_name: z.string().min(1),
    product_short: z.string().min(2).max(10),
    has_base: z.boolean().default(false),
    has_color: z.boolean().default(false)
});

describe('Item Master — Validation Schemas', () => {
    it('should validate bulk edit payload', () => {
        const result = bulkEditSchema.safeParse({
            items: [{ zoho_item_id: '123', changes: { zoho_sku: 'PSP01' } }]
        });
        expect(result.success).toBe(true);
    });

    it('should reject empty items array', () => {
        const result = bulkEditSchema.safeParse({ items: [] });
        expect(result.success).toBe(false);
    });

    it('should validate DPL apply payload', () => {
        const result = dplApplySchema.safeParse({
            items: [{ zoho_item_id: '123', new_dpl: 285 }],
            dpl_version_id: 1
        });
        expect(result.success).toBe(true);
    });

    it('should reject negative DPL', () => {
        const result = dplApplySchema.safeParse({
            items: [{ zoho_item_id: '123', new_dpl: -10 }]
        });
        expect(result.success).toBe(false);
    });

    it('should validate naming rule', () => {
        const result = namingRuleSchema.safeParse({
            brand: 'Birla Opus', category: 'Exterior Primer',
            category_code: 'EP', product_name: 'Perfect Start Primer',
            product_short: 'PSP', has_base: false, has_color: false
        });
        expect(result.success).toBe(true);
    });
});
```

- [ ] **Step 2: Run the tests**

Run: `npx jest tests/unit/item-master.test.js --verbose`
Expected: All tests PASS (pricing, naming, health check, validation)

- [ ] **Step 3: Commit**

```bash
git add tests/unit/item-master.test.js
git commit -m "test(item-master): add unit tests for pricing formula, name generation, health checks, validation"
```

---

## Task 3: Backend Route — Items & Summary Endpoints

**Files:**
- Create: `routes/item-master.js`
- Modify: `server.js` (~line 278)
- Modify: `config/uploads.js`

- [ ] **Step 1: Add DPL PDF multer config to `config/uploads.js`**

Add after the existing `uploadVendorBill` config (before `module.exports`). Also add `'uploads/dpl-pdfs'` to the `uploadDirs` array near line 11.

```javascript
// DPL PDF upload — stores to disk with brand subfolder
const uploadDplPdf = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const brand = (req.body.brand || 'unknown').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
            const dir = path.join(__dirname, '..', 'uploads', 'dpl-pdfs', brand);
            fs.mkdirSync(dir, { recursive: true });
            cb(null, dir);
        },
        filename: (req, file, cb) => {
            const timestamp = Date.now();
            const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
            cb(null, `${timestamp}-${safeName}`);
        }
    }),
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only PDF files are allowed'), false);
        }
    },
    limits: { fileSize: 15 * 1024 * 1024 }
});
```

Add `uploadDplPdf` to the `module.exports` object.

- [ ] **Step 2: Create the route file with Items group + Summary + Health Check endpoints**

Create `routes/item-master.js`:

```javascript
/**
 * Item Master Management Routes
 * 
 * Endpoints:
 * GET    /items          — List items with filters
 * GET    /items/:id      — Single item detail
 * GET    /summary        — Summary cards data
 * POST   /items/bulk-edit — Bulk update items
 * GET    /naming-rules   — List naming rules
 * POST   /naming-rules   — Create/update naming rule
 * DELETE /naming-rules/:id — Delete naming rule
 * POST   /generate-names — Auto-generate names from rules
 * GET    /dpl-versions   — List DPL versions
 * POST   /dpl-versions   — Upload new DPL PDF
 * POST   /dpl-parse      — Parse PDF
 * POST   /dpl-match      — Match parsed items to Zoho
 * POST   /dpl-apply      — Apply DPL prices + auto-calc
 * POST   /dpl-notebooklm — Query NotebookLM
 * GET    /price-history   — Price change history
 * GET    /price-history/:itemId — Item price timeline
 * GET    /health-check    — Scan data quality issues
 */

const express = require('express');
const router = express.Router();
const { requirePermission, requireAuth } = require('../middleware/permissionMiddleware');
const { validate, validateQuery } = require('../middleware/validate');
const { z } = require('zod');
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

let pool;

function setPool(p) { pool = p; }

// ==================== Constants ====================

const CATEGORY_CODES = {
    'Interior Primer': 'IP', 'Exterior Primer': 'EP',
    'Interior Emulsion': 'IE', 'Exterior Emulsion': 'EE',
    'Enamel': 'EN', 'Wood Finish': 'WF',
    'Waterproofing': 'WP', 'Distemper': 'DT',
    'Putty': 'PT', 'Stainer/Colorant': 'ST',
    'Thinner': 'TH', 'Tools & Accessories': 'TA',
    'Floor Coating': 'FL', 'Spray Paint': 'SP',
    'Metal Primer': 'MP', 'Adhesive': 'AD'
};

const COLOR_MAP = {
    'BLACK': 'BL', 'WHITE': 'WH', 'RED': 'RD', 'BLUE': 'BU',
    'GREEN': 'GR', 'YELLOW': 'YL', 'BROWN': 'BR', 'GREY': 'GY',
    'CREAM': 'CR', 'IVORY': 'IV', 'SILVER': 'SL', 'GOLDEN': 'GD'
};

function padSize(size) {
    return String(size).padStart(2, '0');
}

function calculateSalesPrice(dpl) {
    return Math.ceil(Number(dpl) * 1.298);
}

// ==================== Validation Schemas ====================

const itemsQuerySchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(500).default(50),
    brand: z.string().optional(),
    category: z.string().optional(),
    base: z.string().optional(),
    size: z.string().optional(),
    status: z.enum(['all', 'complete', 'missing_dpl', 'no_sku', 'bad_name']).default('all'),
    search: z.string().optional(),
    sort: z.string().optional(),
    order: z.enum(['asc', 'desc']).default('asc')
});

const bulkEditSchema = z.object({
    items: z.array(z.object({
        zoho_item_id: z.string().min(1),
        changes: z.object({
            zoho_item_name: z.string().optional(),
            zoho_description: z.string().optional(),
            zoho_sku: z.string().optional(),
            zoho_brand: z.string().optional(),
            zoho_category_name: z.string().optional()
        })
    })).min(1)
});

const namingRuleSchema = z.object({
    brand: z.string().min(1),
    category: z.string().min(1),
    category_code: z.string().min(2).max(5),
    product_name: z.string().min(1),
    product_short: z.string().min(2).max(10),
    has_base: z.boolean().default(false),
    has_color: z.boolean().default(false)
});

const generateNamesSchema = z.object({
    zoho_item_ids: z.array(z.string().min(1)).min(1)
});

const dplApplySchema = z.object({
    items: z.array(z.object({
        zoho_item_id: z.string().min(1),
        new_dpl: z.coerce.number().positive()
    })).min(1),
    dpl_version_id: z.coerce.number().int().positive().optional()
});

const dplVersionSchema = z.object({
    brand: z.string().min(1),
    version_label: z.string().optional(),
    effective_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    notebooklm_notebook_id: z.string().optional()
});

const notebookLmSchema = z.object({
    brand: z.string().min(1),
    notebook_id: z.string().min(1),
    query: z.string().min(1)
});

const priceHistoryQuerySchema = z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(500).default(50),
    brand: z.string().optional(),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    search: z.string().optional()
});

// ==================== Health Check Logic ====================

function checkItemHealth(item) {
    const issues = [];
    if (!item.zoho_sku || item.zoho_sku.trim() === '') {
        issues.push({ type: 'missing_sku', message: 'No SKU set' });
    }
    if (!item.zoho_cf_dpl || Number(item.zoho_cf_dpl) === 0) {
        issues.push({ type: 'missing_dpl', message: 'No DPL price set' });
    }
    if (!item.zoho_brand || item.zoho_brand.trim() === '') {
        issues.push({ type: 'missing_brand_category', message: 'No brand set' });
    }
    if (!item.zoho_category_name || item.zoho_category_name.trim() === '') {
        issues.push({ type: 'missing_brand_category', message: 'No category set' });
    }
    if (item.zoho_cf_dpl && item.zoho_purchase_rate && Number(item.zoho_cf_dpl) !== Number(item.zoho_purchase_rate)) {
        issues.push({ type: 'dpl_purchase_mismatch', message: `DPL (${item.zoho_cf_dpl}) != Purchase (${item.zoho_purchase_rate})` });
    }
    if (item.zoho_cf_dpl && item.zoho_rate) {
        const expectedSales = calculateSalesPrice(item.zoho_cf_dpl);
        if (Number(item.zoho_rate) !== expectedSales) {
            issues.push({ type: 'sales_price_mismatch', message: `Sales (${item.zoho_rate}) != Expected (${expectedSales})` });
        }
    }
    const namePattern = /^[A-Z]{2,3}\d{2}\s/;
    if (item.zoho_item_name && !namePattern.test(item.zoho_item_name)) {
        issues.push({ type: 'bad_name_format', message: 'Name does not match standard format' });
    }
    return issues;
}

// ==================== Name Generation Logic ====================

function generateItemName(rule, size, variant) {
    const sizePad = padSize(size);
    const variantStr = variant || '';
    return `${rule.category_code}${sizePad} ${rule.product_short}${variantStr} ${rule.product_name} ${sizePad} L`.toUpperCase();
}

function generateDescription(rule, size, variant, brand) {
    const sizePad = padSize(size);
    const variantStr = variant || '';
    return `${rule.category} ${brand} ${sizePad} L (${rule.product_short}${variantStr})`.toUpperCase();
}

function generateSku(rule, variant, size) {
    const sizePad = padSize(size);
    const variantStr = variant || '';
    return `${rule.product_short}${variantStr}${sizePad}`.toUpperCase();
}

function extractSizeFromName(name) {
    const match = name.match(/(\d+(?:\.\d+)?)\s*(L|KG|PC|M|LTR|LITRE)/i);
    return match ? parseFloat(match[1]) : null;
}

function extractBaseFromName(name) {
    const match = name.match(/base\s*(\d)/i);
    return match ? match[1] : null;
}

function extractColorFromName(name) {
    const upper = name.toUpperCase();
    for (const [color, code] of Object.entries(COLOR_MAP)) {
        if (upper.includes(color)) return code;
    }
    return null;
}

// ==================== ITEMS ENDPOINTS ====================

// GET /items — List items with filters
router.get('/items', requireAuth, validateQuery(itemsQuerySchema), async (req, res) => {
    try {
        const { page, limit, brand, category, base, size, status, search, sort, order } = req.query;
        const offset = (Number(page) - 1) * Number(limit);
        const params = [];
        let where = "WHERE zoho_status = 'active'";

        if (brand) { where += ' AND zoho_brand = ?'; params.push(brand); }
        if (category) { where += ' AND zoho_category_name = ?'; params.push(category); }
        if (search) { where += ' AND (zoho_item_name LIKE ? OR zoho_sku LIKE ? OR zoho_description LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
        if (status === 'missing_dpl') { where += " AND (zoho_cf_dpl IS NULL OR zoho_cf_dpl = '' OR zoho_cf_dpl = '0')"; }
        if (status === 'no_sku') { where += " AND (zoho_sku IS NULL OR zoho_sku = '')"; }
        if (status === 'bad_name') { where += " AND zoho_item_name NOT REGEXP '^[A-Z]{2,3}[0-9]{2} '"; }

        const sortCol = { name: 'zoho_item_name', sku: 'zoho_sku', brand: 'zoho_brand', category: 'zoho_category_name', dpl: 'zoho_cf_dpl', rate: 'zoho_rate' }[sort] || 'zoho_item_name';
        const orderDir = order === 'desc' ? 'DESC' : 'ASC';

        const [[{ total }]] = await pool.query(`SELECT COUNT(*) as total FROM zoho_items_map ${where}`, params);
        const [items] = await pool.query(
            `SELECT zoho_item_id, zoho_item_name, zoho_sku, zoho_brand, zoho_category_name,
                    zoho_rate, zoho_purchase_rate, zoho_cf_dpl, zoho_unit, zoho_stock_on_hand,
                    zoho_description, zoho_cf_product_name, zoho_status, last_synced_at
             FROM zoho_items_map ${where}
             ORDER BY ${sortCol} ${orderDir}
             LIMIT ? OFFSET ?`,
            [...params, Number(limit), offset]
        );

        res.json({ items, total, page: Number(page), limit: Number(limit), pages: Math.ceil(total / Number(limit)) });
    } catch (err) {
        console.error('Item master list error:', err);
        res.status(500).json({ error: 'Failed to fetch items' });
    }
});

// GET /items/:id — Single item detail
router.get('/items/:id', requireAuth, async (req, res) => {
    try {
        const [items] = await pool.query(
            `SELECT * FROM zoho_items_map WHERE zoho_item_id = ?`, [req.params.id]
        );
        if (!items.length) return res.status(404).json({ error: 'Item not found' });

        const [history] = await pool.query(
            `SELECT h.*, v.version_label, v.brand as dpl_brand
             FROM dpl_price_history h
             LEFT JOIN dpl_versions v ON h.dpl_version_id = v.id
             WHERE h.zoho_item_id = ?
             ORDER BY h.changed_at DESC LIMIT 20`, [req.params.id]
        );

        const [rules] = await pool.query(
            `SELECT * FROM item_naming_rules WHERE brand = ? LIMIT 50`,
            [items[0].zoho_brand]
        );

        res.json({ item: items[0], price_history: history, naming_rules: rules });
    } catch (err) {
        console.error('Item detail error:', err);
        res.status(500).json({ error: 'Failed to fetch item detail' });
    }
});

// GET /summary — Summary cards
router.get('/summary', requireAuth, async (req, res) => {
    try {
        const [[totals]] = await pool.query(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN zoho_cf_dpl IS NOT NULL AND zoho_cf_dpl != '' AND zoho_cf_dpl != '0' THEN 1 ELSE 0 END) as dpl_set,
                SUM(CASE WHEN zoho_cf_dpl IS NULL OR zoho_cf_dpl = '' OR zoho_cf_dpl = '0' THEN 1 ELSE 0 END) as missing_dpl,
                SUM(CASE WHEN zoho_sku IS NULL OR zoho_sku = '' THEN 1 ELSE 0 END) as no_sku,
                COUNT(DISTINCT zoho_brand) as brands
            FROM zoho_items_map WHERE zoho_status = 'active'
        `);
        res.json(totals);
    } catch (err) {
        console.error('Summary error:', err);
        res.status(500).json({ error: 'Failed to fetch summary' });
    }
});

// POST /items/bulk-edit — Bulk update items
router.post('/items/bulk-edit', requireAuth, validate(bulkEditSchema), async (req, res) => {
    try {
        const { items } = req.body;
        let updated = 0;
        for (const item of items) {
            const sets = [];
            const vals = [];
            for (const [key, val] of Object.entries(item.changes)) {
                if (['zoho_item_name', 'zoho_description', 'zoho_sku', 'zoho_brand', 'zoho_category_name'].includes(key)) {
                    sets.push(`${key} = ?`);
                    vals.push(val);
                }
            }
            if (sets.length) {
                vals.push(item.zoho_item_id);
                await pool.query(`UPDATE zoho_items_map SET ${sets.join(', ')} WHERE zoho_item_id = ?`, vals);
                updated++;
            }
        }
        res.json({ updated });
    } catch (err) {
        console.error('Bulk edit error:', err);
        res.status(500).json({ error: 'Failed to bulk edit items' });
    }
});

// ==================== NAMING RULES ENDPOINTS ====================

// GET /naming-rules
router.get('/naming-rules', requireAuth, async (req, res) => {
    try {
        const brand = req.query.brand;
        let query = 'SELECT * FROM item_naming_rules';
        const params = [];
        if (brand) { query += ' WHERE brand = ?'; params.push(brand); }
        query += ' ORDER BY brand, category, product_name';
        const [rules] = await pool.query(query, params);
        res.json({ rules });
    } catch (err) {
        console.error('Naming rules error:', err);
        res.status(500).json({ error: 'Failed to fetch naming rules' });
    }
});

// POST /naming-rules — Upsert
router.post('/naming-rules', requireAuth, validate(namingRuleSchema), async (req, res) => {
    try {
        const { brand, category, category_code, product_name, product_short, has_base, has_color } = req.body;
        await pool.query(`
            INSERT INTO item_naming_rules (brand, category, category_code, product_name, product_short, has_base, has_color)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE category = VALUES(category), category_code = VALUES(category_code),
                product_short = VALUES(product_short), has_base = VALUES(has_base), has_color = VALUES(has_color)
        `, [brand, category, category_code, product_name, product_short, has_base, has_color]);
        res.json({ success: true });
    } catch (err) {
        console.error('Naming rule save error:', err);
        res.status(500).json({ error: 'Failed to save naming rule' });
    }
});

// DELETE /naming-rules/:id
router.delete('/naming-rules/:id', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM item_naming_rules WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Naming rule delete error:', err);
        res.status(500).json({ error: 'Failed to delete naming rule' });
    }
});

// POST /generate-names — Preview auto-generated names
router.post('/generate-names', requireAuth, validate(generateNamesSchema), async (req, res) => {
    try {
        const { zoho_item_ids } = req.body;
        const placeholders = zoho_item_ids.map(() => '?').join(',');
        const [items] = await pool.query(
            `SELECT zoho_item_id, zoho_item_name, zoho_description, zoho_sku, zoho_brand, zoho_category_name
             FROM zoho_items_map WHERE zoho_item_id IN (${placeholders})`, zoho_item_ids
        );
        const [allRules] = await pool.query('SELECT * FROM item_naming_rules');
        const rulesMap = new Map();
        for (const r of allRules) {
            rulesMap.set(`${r.brand}||${r.product_name}`, r);
        }

        const previews = [];
        for (const item of items) {
            const size = extractSizeFromName(item.zoho_item_name);
            if (!size) { previews.push({ zoho_item_id: item.zoho_item_id, error: 'Could not extract size from name' }); continue; }

            // Try to find matching rule
            let matchedRule = null;
            for (const [key, rule] of rulesMap) {
                if (rule.brand === item.zoho_brand && item.zoho_item_name.toUpperCase().includes(rule.product_name.toUpperCase())) {
                    matchedRule = rule; break;
                }
            }
            if (!matchedRule) { previews.push({ zoho_item_id: item.zoho_item_id, error: 'No matching naming rule found' }); continue; }

            let variant = null;
            if (matchedRule.has_base) variant = extractBaseFromName(item.zoho_item_name);
            if (matchedRule.has_color) variant = extractColorFromName(item.zoho_item_name);

            previews.push({
                zoho_item_id: item.zoho_item_id,
                old_name: item.zoho_item_name,
                new_name: generateItemName(matchedRule, size, variant),
                old_desc: item.zoho_description,
                new_desc: generateDescription(matchedRule, size, variant, item.zoho_brand),
                old_sku: item.zoho_sku,
                new_sku: generateSku(matchedRule, variant, size)
            });
        }
        res.json({ previews });
    } catch (err) {
        console.error('Generate names error:', err);
        res.status(500).json({ error: 'Failed to generate names' });
    }
});

// ==================== DPL ENDPOINTS ====================

// GET /dpl-versions
router.get('/dpl-versions', requireAuth, async (req, res) => {
    try {
        const brand = req.query.brand;
        let query = 'SELECT * FROM dpl_versions';
        const params = [];
        if (brand) { query += ' WHERE brand = ?'; params.push(brand); }
        query += ' ORDER BY effective_date DESC';
        const [versions] = await pool.query(query, params);
        res.json({ versions });
    } catch (err) {
        console.error('DPL versions error:', err);
        res.status(500).json({ error: 'Failed to fetch DPL versions' });
    }
});

// POST /dpl-versions — Upload new DPL PDF (multipart: file + body fields)
// Uses uploadDplPdf middleware from config/uploads.js — attached in server.js
router.post('/dpl-versions', requireAuth, async (req, res) => {
    try {
        const { brand, version_label, effective_date, notebooklm_notebook_id } = req.body;
        if (!brand || !effective_date) return res.status(400).json({ error: 'brand and effective_date required' });

        const pdfPath = req.file ? req.file.path : null;

        // Archive previous active version for this brand
        await pool.query("UPDATE dpl_versions SET status = 'archived' WHERE brand = ? AND status = 'active'", [brand]);

        const [result] = await pool.query(`
            INSERT INTO dpl_versions (brand, version_label, effective_date, pdf_path, notebooklm_notebook_id, status)
            VALUES (?, ?, ?, ?, ?, 'active')
        `, [brand, version_label || null, effective_date, pdfPath, notebooklm_notebook_id || null]);

        res.json({ success: true, id: result.insertId });
    } catch (err) {
        console.error('DPL version create error:', err);
        res.status(500).json({ error: 'Failed to create DPL version' });
    }
});

// POST /dpl-parse — Parse uploaded PDF
router.post('/dpl-parse', requireAuth, async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No PDF file uploaded' });
        const { parsePriceList } = require('../services/price-list-parser');
        const parsed = await parsePriceList(req.file.buffer, req.file.originalname);
        res.json({ items: parsed.items || parsed, brand: parsed.brand || req.body.brand });
    } catch (err) {
        console.error('DPL parse error:', err);
        res.status(500).json({ error: 'Failed to parse PDF' });
    }
});

// POST /dpl-match — Match parsed items to Zoho items
router.post('/dpl-match', requireAuth, async (req, res) => {
    try {
        const { items: parsedItems, brand } = req.body;
        if (!parsedItems || !parsedItems.length) return res.status(400).json({ error: 'No items to match' });

        let query = "SELECT zoho_item_id, zoho_item_name, zoho_sku, zoho_cf_dpl, zoho_rate, zoho_purchase_rate, zoho_brand FROM zoho_items_map WHERE zoho_status = 'active'";
        const params = [];
        if (brand) { query += ' AND zoho_brand = ?'; params.push(brand); }
        const [zohoItems] = await pool.query(query, params);

        const { matchWithZohoItems } = require('../services/price-list-parser');
        const matchResult = matchWithZohoItems(parsedItems, zohoItems);
        res.json(matchResult);
    } catch (err) {
        console.error('DPL match error:', err);
        res.status(500).json({ error: 'Failed to match items' });
    }
});

// POST /dpl-apply — Apply DPL prices with auto-calculation
router.post('/dpl-apply', requireAuth, validate(dplApplySchema), async (req, res) => {
    try {
        const { items, dpl_version_id } = req.body;
        const userId = req.user ? req.user.id : null;
        let updated = 0;
        let historyLogged = 0;

        for (const { zoho_item_id, new_dpl } of items) {
            // Read current values
            const [[current]] = await pool.query(
                'SELECT zoho_cf_dpl, zoho_purchase_rate, zoho_rate FROM zoho_items_map WHERE zoho_item_id = ?',
                [zoho_item_id]
            );
            if (!current) continue;

            const newPurchase = new_dpl;
            const newSales = calculateSalesPrice(new_dpl);

            // Log history
            await pool.query(`
                INSERT INTO dpl_price_history (zoho_item_id, dpl_version_id, old_dpl, new_dpl,
                    old_purchase_rate, new_purchase_rate, old_sales_rate, new_sales_rate, changed_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `, [zoho_item_id, dpl_version_id || null,
                current.zoho_cf_dpl, new_dpl,
                current.zoho_purchase_rate, newPurchase,
                current.zoho_rate, newSales,
                userId]);
            historyLogged++;

            // Update zoho_items_map
            await pool.query(`
                UPDATE zoho_items_map
                SET zoho_cf_dpl = ?, zoho_purchase_rate = ?, zoho_rate = ?
                WHERE zoho_item_id = ?
            `, [new_dpl, newPurchase, newSales, zoho_item_id]);
            updated++;
        }

        // Update DPL version stats if provided
        if (dpl_version_id) {
            await pool.query('UPDATE dpl_versions SET matched_items = ?, total_items = ? WHERE id = ?',
                [updated, items.length, dpl_version_id]);
        }

        res.json({ updated, history_logged: historyLogged, zoho_sync_queued: updated });
    } catch (err) {
        console.error('DPL apply error:', err);
        res.status(500).json({ error: 'Failed to apply DPL prices' });
    }
});

// ==================== NOTEBOOKLM ENDPOINT ====================

// POST /dpl-notebooklm — Query NotebookLM CLI
router.post('/dpl-notebooklm', requireAuth, validate(notebookLmSchema), async (req, res) => {
    try {
        const { notebook_id, query } = req.body;

        // Set active notebook
        await execAsync(`notebooklm use ${notebook_id}`);

        // Ask question
        const { stdout } = await execAsync(`notebooklm ask "${query.replace(/"/g, '\\"')}"`, { timeout: 60000 });

        res.json({ response: stdout, notebook_id });
    } catch (err) {
        console.error('NotebookLM query error:', err);
        res.status(500).json({ error: 'NotebookLM query failed', details: err.message });
    }
});

// ==================== PRICE HISTORY ENDPOINTS ====================

// GET /price-history
router.get('/price-history', requireAuth, validateQuery(priceHistoryQuerySchema), async (req, res) => {
    try {
        const { page, limit, brand, start_date, end_date, search } = req.query;
        const offset = (Number(page) - 1) * Number(limit);
        const params = [];
        let where = 'WHERE 1=1';

        if (brand) { where += ' AND v.brand = ?'; params.push(brand); }
        if (start_date) { where += ' AND h.changed_at >= ?'; params.push(start_date); }
        if (end_date) { where += ' AND h.changed_at <= ?'; params.push(end_date + ' 23:59:59'); }
        if (search) { where += ' AND (m.zoho_item_name LIKE ? OR m.zoho_sku LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

        const [[{ total }]] = await pool.query(`
            SELECT COUNT(*) as total FROM dpl_price_history h
            LEFT JOIN dpl_versions v ON h.dpl_version_id = v.id
            LEFT JOIN zoho_items_map m ON h.zoho_item_id = m.zoho_item_id
            ${where}
        `, params);

        const [history] = await pool.query(`
            SELECT h.*, v.version_label, v.brand as dpl_brand, v.effective_date,
                   m.zoho_item_name, m.zoho_sku, m.zoho_brand
            FROM dpl_price_history h
            LEFT JOIN dpl_versions v ON h.dpl_version_id = v.id
            LEFT JOIN zoho_items_map m ON h.zoho_item_id = m.zoho_item_id
            ${where}
            ORDER BY h.changed_at DESC
            LIMIT ? OFFSET ?
        `, [...params, Number(limit), offset]);

        res.json({ history, total, page: Number(page), limit: Number(limit) });
    } catch (err) {
        console.error('Price history error:', err);
        res.status(500).json({ error: 'Failed to fetch price history' });
    }
});

// GET /price-history/:itemId — Single item timeline
router.get('/price-history/:itemId', requireAuth, async (req, res) => {
    try {
        const [history] = await pool.query(`
            SELECT h.*, v.version_label, v.brand as dpl_brand
            FROM dpl_price_history h
            LEFT JOIN dpl_versions v ON h.dpl_version_id = v.id
            WHERE h.zoho_item_id = ?
            ORDER BY h.changed_at ASC
        `, [req.params.itemId]);
        res.json({ history });
    } catch (err) {
        console.error('Item price history error:', err);
        res.status(500).json({ error: 'Failed to fetch item price history' });
    }
});

// ==================== HEALTH CHECK ENDPOINT ====================

// GET /health-check
router.get('/health-check', requireAuth, async (req, res) => {
    try {
        const [items] = await pool.query(`
            SELECT zoho_item_id, zoho_item_name, zoho_sku, zoho_brand, zoho_category_name,
                   zoho_cf_dpl, zoho_purchase_rate, zoho_rate
            FROM zoho_items_map WHERE zoho_status = 'active'
        `);

        const issueGroups = {
            missing_sku: [],
            missing_dpl: [],
            missing_brand_category: [],
            bad_name_format: [],
            dpl_purchase_mismatch: [],
            sales_price_mismatch: []
        };

        for (const item of items) {
            const issues = checkItemHealth(item);
            for (const issue of issues) {
                if (issueGroups[issue.type]) {
                    issueGroups[issue.type].push({
                        zoho_item_id: item.zoho_item_id,
                        zoho_item_name: item.zoho_item_name,
                        zoho_sku: item.zoho_sku,
                        message: issue.message
                    });
                }
            }
        }

        const summary = {};
        for (const [type, items] of Object.entries(issueGroups)) {
            summary[type] = { count: items.length, items: items.slice(0, 100) };
        }

        res.json({ total_items: items.length, issues: summary });
    } catch (err) {
        console.error('Health check error:', err);
        res.status(500).json({ error: 'Failed to run health check' });
    }
});

module.exports = { router, setPool };
```

- [ ] **Step 3: Register route in server.js**

In `server.js`, add near line 36 with other imports:
```javascript
const itemMasterRoutes = require('./routes/item-master');
```

Near line 278 with other route registrations:
```javascript
app.use('/api/item-master', itemMasterRoutes.router);
```

In the `setPool` block (search for where other routes get `.setPool(pool)`):
```javascript
if (itemMasterRoutes.setPool) itemMasterRoutes.setPool(pool);
```

- [ ] **Step 4: Run tests to verify nothing is broken**

Run: `npx jest tests/unit/item-master.test.js --verbose`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add routes/item-master.js config/uploads.js server.js
git commit -m "feat(item-master): add 17 API endpoints for items, naming rules, DPL, price history, health check"
```

---

## Task 4: Frontend — Page Shell + Tab 1 (Items List)

**Files:**
- Create: `public/admin-item-master.html`

- [ ] **Step 1: Create the full HTML page with Tab 1 functional**

Create `public/admin-item-master.html` with:
- Page shell: head, Tailwind CDN, design-system.css, auth-helper.js, universal-nav-loader.js
- `data-page="item-master"` on body
- 5-tab navigation bar
- Tab 1: Items List with filter bar, summary cards, item table, pagination, slide-out edit panel, bulk actions
- Tab 2-5: placeholder content (implemented in later tasks)

The file should follow the existing pattern from `admin-dpl.html`:
- `<body data-page="item-master" class="bg-gray-50">`
- Container: `<div class="container mx-auto p-4 md:p-6 max-w-7xl">`
- Admin brand colors: primary `#667eea`, gradient to `#764ba2`
- Toast component for notifications
- Auth check: `requireAdminOrRedirect()`

Key frontend features for Tab 1:
- On load: fetch `/api/item-master/summary` for cards, fetch `/api/item-master/items?page=1&limit=50` for table
- Filter dropdowns populated from item data (distinct brands, categories)
- Summary cards clickable → set status filter → reload
- Table rows: checkbox for bulk select, colored status badges, click row → open slide-out edit panel
- Slide-out edit panel: form fields for Item Name, Description, SKU, Brand, Category, DPL (with live-calculated Purchase + Sales)
- Bulk actions bar: appears when checkboxes selected, "Auto-Generate Names" + "Bulk Edit" buttons
- Pagination with page numbers

This is a large file. The agent implementing this task should read `public/admin-dpl.html` for UI patterns and `public/admin-products.html` for tab structure patterns. Use Tailwind utility classes consistent with the design system. Use vanilla JS fetch() for API calls. No frameworks.

- [ ] **Step 2: Test in browser**

Open: `http://localhost:PORT/admin-item-master.html` (after logging in as admin)
Expected: Page loads with tab bar, summary cards show counts, item table populates with Zoho items

- [ ] **Step 3: Commit**

```bash
git add public/admin-item-master.html
git commit -m "feat(item-master): add frontend page with items list tab, filters, summary cards, bulk edit"
```

---

## Task 5: Frontend — Tab 2 (DPL Import) + Tab 3 (Price Calculator)

**Files:**
- Modify: `public/admin-item-master.html`

- [ ] **Step 1: Add Tab 2 — DPL Import section**

In the Tab 2 container, implement:
- Left panel: Brand DPL Library — fetch `/api/item-master/dpl-versions` → render card per brand with latest version, effective date, item count, NotebookLM status badge
- "+ Upload New Brand DPL PDF" card → opens upload modal with: brand dropdown, version label input, effective date input, PDF file input, NotebookLM notebook ID (optional)
- Upload submits multipart form to `POST /api/item-master/dpl-versions`
- Right panel: Two buttons — "Parse PDF & Auto-Match" and "Query NotebookLM for Prices"
- Parse flow: upload PDF via `POST /api/item-master/dpl-parse` (memory storage) → get parsed items → call `POST /api/item-master/dpl-match` → show match results table
- NotebookLM flow: modal with brand notebook selector + query textarea → `POST /api/item-master/dpl-notebooklm` → parse response → show match table
- Match table: PDF Product, Matched Zoho Item, Pack Size, New DPL, Current DPL, Confidence %, checkbox
- Unmatched section: collapsible list with manual zoho item picker dropdown

- [ ] **Step 2: Add Tab 3 — Price Calculator section**

In the Tab 3 container, implement:
- Formula banner: blue info box showing `Purchase = DPL | Sales = ceil(DPL × 1.298)`
- Brand filter dropdown → loads items with DPL from `/api/item-master/items?status=complete&brand=X`
- Editable price table: Item Name, Current DPL, New DPL (editable input), % Change (colored), Calculated Purchase (auto), Calculated Sales (auto), Apply checkbox
- Live calculation: on input change in "New DPL" cell → auto-update Purchase and Sales columns using JS
- Row highlighting: green tint for changed rows, greyed for same
- "Apply & Sync to Zoho" button → collects checked items → `POST /api/item-master/dpl-apply` → show result toast

- [ ] **Step 3: Test in browser**

Test Tab 2: Upload a test PDF → verify parse results appear → verify match table shows
Test Tab 3: Select brand → verify items load → change DPL value → verify auto-calc → apply

- [ ] **Step 4: Commit**

```bash
git add public/admin-item-master.html
git commit -m "feat(item-master): add DPL import tab with NotebookLM integration + price calculator tab"
```

---

## Task 6: Frontend — Tab 4 (Price History) + Tab 5 (Health Check)

**Files:**
- Modify: `public/admin-item-master.html`

- [ ] **Step 1: Add Tab 4 — Price History**

In the Tab 4 container, implement:
- Filters: Brand dropdown, date range (start/end date inputs), item search text input
- Fetch `/api/item-master/price-history?brand=X&start_date=Y&end_date=Z`
- Timeline cards: group by `dpl_version_id` — show "Brand DPL Version applied on Date — N items updated"
- Click card → expand to show individual item changes in that version (old DPL → new DPL, old Sales → new Sales)
- Click item row → fetch `/api/item-master/price-history/:itemId` → show inline timeline of all changes for that item
- "Download CSV" button → client-side CSV generation from displayed history data

- [ ] **Step 2: Add Tab 5 — Health Check**

In the Tab 5 container, implement:
- "Run Health Check" button → `GET /api/item-master/health-check`
- Results: 6 collapsible sections, one per issue type
- Each section header: issue type label + count badge (red for critical, yellow for warning)
- Section body: table of affected items with item name, current value, expected value, "Fix" button
- "Fix" button for individual items → switch to Tab 1 with that item's edit panel open
- Bulk fix buttons at top:
  - "Auto-fix Name Format" → collect all bad_name_format item IDs → `POST /api/item-master/generate-names` → show preview modal → confirm → `POST /api/item-master/items/bulk-edit`
  - "Sync Purchase = DPL" → collect dpl_purchase_mismatch items → auto-fix via bulk-edit
  - "Recalculate Sales Prices" → collect sales_price_mismatch items → `POST /api/item-master/dpl-apply` with current DPL values (recalculates sales)

- [ ] **Step 3: Test in browser**

Test Tab 4: Verify history loads, timeline cards render, CSV download works
Test Tab 5: Click "Run Health Check" → verify issue groups render with counts → test "Fix" button navigation

- [ ] **Step 4: Commit**

```bash
git add public/admin-item-master.html
git commit -m "feat(item-master): add price history tab with timeline + health check tab with bulk fix"
```

---

## Task 7: Navigation + Final Integration

**Files:**
- Modify: `public/universal-nav-loader.js` (~line 39)

- [ ] **Step 1: Add Item Master to navigation**

In `public/universal-nav-loader.js`, add to `SUBNAV_MAP` (near line 39):
```javascript
'item-master': CONFIG.ZOHO_SUBNAV_PATH,
```

If there is a Zoho subnav component (`components/zoho-subnav.html`), add an "Item Master" link to it. If the component doesn't exist, check how `admin-dpl.html` handles navigation and follow the same pattern.

The link should be:
```html
<a href="/admin-item-master.html" class="subnav-link" data-page="item-master">Item Master</a>
```

- [ ] **Step 2: Verify full navigation flow**

Open admin panel → navigate to Zoho section → verify "Item Master" link appears → click → verify page loads with all 5 tabs functional

- [ ] **Step 3: Run all tests**

Run: `npx jest --verbose`
Expected: All existing tests pass + new item-master tests pass

- [ ] **Step 4: Commit**

```bash
git add public/universal-nav-loader.js
git commit -m "feat(item-master): add Item Master to admin navigation"
```

---

## Task 8: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `npx jest --verbose`
Expected: All tests pass (existing 85 + new item-master tests)

- [ ] **Step 2: End-to-end walkthrough**

1. Navigate to Item Master page
2. Tab 1: Verify items load, filters work, click item → edit panel opens, change DPL → see live price calc
3. Tab 2: Test PDF upload + parse (if PDF available), test NotebookLM query button
4. Tab 3: Select brand → change DPL values → verify auto-calc → apply
5. Tab 4: Verify price history shows after Tab 3 apply
6. Tab 5: Run health check → verify issues detected

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat(item-master): complete Item Master Management page with 5 tabs, 17 endpoints, NotebookLM integration"
```
