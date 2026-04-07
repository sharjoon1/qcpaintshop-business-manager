/**
 * Item Master Management Routes
 * Naming conventions, DPL pricing, health checks for Zoho Books items
 */

const express = require('express');
const router = express.Router();
const { requireAuth, requirePermission } = require('../middleware/permissionMiddleware');
const { validate, validateQuery } = require('../middleware/validate');
const { z } = require('zod');
const { exec } = require('child_process');
const { uploadDplPdf, uploadPriceList } = require('../config/uploads');

let pool;
function setPool(p) { pool = p; }

// ─── Constants ──────────────────────────────────────────────────────────

const CATEGORY_CODES = {
    'IE': 'INTERIOR EMULSION',
    'EE': 'EXTERIOR EMULSION',
    'EP': 'EXTERIOR PRIMER',
    'IP': 'INTERIOR PRIMER',
    'EN': 'ENAMEL',
    'WC': 'WOOD COATING',
    'WP': 'WATERPROOFING',
    'TX': 'TEXTURE',
    'PT': 'PUTTY',
    'ST': 'STAINER',
    'TH': 'THINNER',
    'AD': 'ADHESIVE'
};

const COLOR_MAP = {
    'WHITE': 'WH', 'BLACK': 'BL', 'RED': 'RD', 'BLUE': 'BU',
    'GREEN': 'GR', 'YELLOW': 'YL', 'GREY': 'GY', 'BROWN': 'BR',
    'CREAM': 'CR', 'IVORY': 'IV', 'SILVER': 'SL', 'GOLD': 'GD',
    'ORANGE': 'OR', 'PINK': 'PK', 'PURPLE': 'PR', 'MAROON': 'MR'
};

function padSize(size) {
    return String(size).padStart(2, '0');
}

function calculateSalesPrice(dpl) {
    return Math.ceil(dpl * 1.298);
}

// ─── Zod Schemas ────────────────────────────────────────────────────────

const itemsQuerySchema = z.object({
    page: z.string().optional().default('1'),
    limit: z.string().optional().default('50'),
    brand: z.string().optional(),
    category: z.string().optional(),
    search: z.string().optional(),
    status: z.enum(['all', 'missing_dpl', 'no_sku', 'bad_name']).optional().default('all'),
    sort: z.string().optional().default('zoho_item_name'),
    order: z.enum(['asc', 'desc']).optional().default('asc')
});

const bulkEditSchema = z.object({
    items: z.array(z.object({
        zoho_item_id: z.string().or(z.number()),
        zoho_item_name: z.string().optional(),
        zoho_sku: z.string().optional(),
        zoho_cf_dpl: z.number().optional(),
        zoho_rate: z.number().optional(),
        zoho_purchase_rate: z.number().optional(),
        zoho_description: z.string().optional()
    })).min(1).max(100)
});

const namingRuleSchema = z.object({
    brand: z.string().min(1),
    product_name: z.string().min(1),
    product_short: z.string().min(1).max(6),
    category_code: z.string().length(2)
});

const generateNamesSchema = z.object({
    brand: z.string().min(1),
    dry_run: z.boolean().optional().default(true)
});

const dplApplySchema = z.object({
    items: z.array(z.object({
        zoho_item_id: z.string().or(z.number()),
        dpl: z.number().positive(),
        version_id: z.number().optional()
    })).min(1).max(500),
    version_id: z.number().optional()
});

const dplVersionSchema = z.object({
    brand: z.string().min(1),
    effective_date: z.string().optional(),
    notes: z.string().optional()
});

const notebookLmSchema = z.object({
    notebook_id: z.string().min(1),
    query: z.string().min(1)
});

const priceHistoryQuerySchema = z.object({
    page: z.string().optional().default('1'),
    limit: z.string().optional().default('50'),
    brand: z.string().optional(),
    from_date: z.string().optional(),
    to_date: z.string().optional(),
    search: z.string().optional()
});

// ─── Helper Functions ───────────────────────────────────────────────────

function checkItemHealth(item) {
    const issues = [];
    if (!item.zoho_sku) {
        issues.push({ type: 'missing_sku', message: 'Item has no SKU code' });
    }
    if (!item.zoho_cf_dpl || Number(item.zoho_cf_dpl) === 0) {
        issues.push({ type: 'missing_dpl', message: 'DPL price not set' });
    }
    if (item.zoho_cf_dpl && item.zoho_purchase_rate &&
        Math.abs(Number(item.zoho_cf_dpl) - Number(item.zoho_purchase_rate)) > 0.01) {
        issues.push({ type: 'dpl_purchase_mismatch', message: 'DPL does not match purchase rate' });
    }
    if (item.zoho_cf_dpl && item.zoho_rate) {
        const expectedSales = calculateSalesPrice(Number(item.zoho_cf_dpl));
        if (Math.abs(expectedSales - Number(item.zoho_rate)) > 0.01) {
            issues.push({ type: 'sales_price_mismatch', message: `Sales price should be ${expectedSales} but is ${item.zoho_rate}` });
        }
    }
    if (item.zoho_item_name && !/^[A-Z]{2}\d{2}\s/.test(item.zoho_item_name)) {
        issues.push({ type: 'bad_name_format', message: 'Name does not follow XX00 convention' });
    }
    return issues;
}

function generateItemName(rule, size, base, color) {
    const paddedSize = padSize(size);
    let code = rule.product_short;
    if (base) code += base;
    if (color) code += COLOR_MAP[color.toUpperCase()] || color.substring(0, 2).toUpperCase();
    const name = rule.product_name.toUpperCase();
    return `${rule.category_code}${paddedSize} ${code} ${name} ${paddedSize} L`;
}

function generateDescription(rule, size, base) {
    const categoryFull = CATEGORY_CODES[rule.category_code] || rule.category_code;
    const paddedSize = padSize(size);
    const brand = 'BIRLA OPUS';
    let desc = `${categoryFull} ${brand} ${paddedSize} L (${rule.product_short}`;
    if (base) desc += base;
    desc += ')';
    return desc;
}

function generateSku(rule, size, base, color) {
    let code = rule.product_short;
    if (base) code += base;
    if (color) code += COLOR_MAP[color.toUpperCase()] || color.substring(0, 2).toUpperCase();
    return `${code}${padSize(size)}`;
}

function extractSizeFromName(name) {
    const match = name.match(/(\d+(?:\.\d+)?)\s*(?:L|LTR|LITRE|KG|ML)\b/i);
    return match ? match[1] : null;
}

function extractBaseFromName(name) {
    const match = name.match(/\bBASE\s*(\d+)/i);
    return match ? match[1] : null;
}

function extractColorFromName(name) {
    const upperName = name.toUpperCase();
    for (const color of Object.keys(COLOR_MAP)) {
        if (upperName.includes(color)) return color;
    }
    return null;
}

// ========================================================================
// ITEMS ENDPOINTS
// ========================================================================

// GET /items — List items with filters & pagination
router.get('/items', requireAuth, validateQuery(itemsQuerySchema), async (req, res) => {
    try {
        const { brand, category, search, status, sort, order } = req.query;
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 50;
        const offset = (page - 1) * limit;

        let where = ['1=1'];
        let params = [];

        if (brand) {
            where.push('zoho_brand = ?');
            params.push(brand);
        }
        if (category) {
            where.push('zoho_category_name = ?');
            params.push(category);
        }
        if (search) {
            where.push('(zoho_item_name LIKE ? OR zoho_sku LIKE ? OR zoho_description LIKE ?)');
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        if (status === 'missing_dpl') {
            where.push('(zoho_cf_dpl IS NULL OR zoho_cf_dpl = 0)');
        } else if (status === 'no_sku') {
            where.push("(zoho_sku IS NULL OR zoho_sku = '')");
        } else if (status === 'bad_name') {
            where.push("zoho_item_name NOT REGEXP '^[A-Z]{2}[0-9]{2} '");
        }

        const allowedSorts = ['zoho_item_name', 'zoho_brand', 'zoho_rate', 'zoho_cf_dpl', 'zoho_sku'];
        const sortCol = allowedSorts.includes(sort) ? sort : 'zoho_item_name';
        const sortOrder = order === 'desc' ? 'DESC' : 'ASC';

        const whereClause = where.join(' AND ');

        const [countRows] = await pool.query(
            `SELECT COUNT(*) as total FROM zoho_items_map WHERE ${whereClause}`,
            params
        );

        const [items] = await pool.query(
            `SELECT zoho_item_id, zoho_item_name, zoho_sku, zoho_brand, zoho_category_name,
                    zoho_rate, zoho_purchase_rate, zoho_cf_dpl, zoho_description,
                    zoho_cf_product_name, zoho_status, zoho_unit
             FROM zoho_items_map
             WHERE ${whereClause}
             ORDER BY ${sortCol} ${sortOrder}
             LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        res.json({
            items,
            pagination: {
                page,
                limit,
                total: countRows[0].total,
                pages: Math.ceil(countRows[0].total / limit)
            }
        });
    } catch (err) {
        console.error('Item master list error:', err);
        res.status(500).json({ error: 'Failed to load items' });
    }
});

// GET /items/:id — Single item detail
router.get('/items/:id', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM zoho_items_map WHERE zoho_item_id = ?',
            [req.params.id]
        );
        if (!rows.length) return res.status(404).json({ error: 'Item not found' });
        res.json(rows[0]);
    } catch (err) {
        console.error('Item detail error:', err);
        res.status(500).json({ error: 'Failed to load item' });
    }
});

// GET /summary — Dashboard counts
router.get('/summary', requireAuth, async (req, res) => {
    try {
        const [totalRows] = await pool.query('SELECT COUNT(*) as count FROM zoho_items_map');
        const [dplSetRows] = await pool.query('SELECT COUNT(*) as count FROM zoho_items_map WHERE zoho_cf_dpl IS NOT NULL AND zoho_cf_dpl > 0');
        const [missingDplRows] = await pool.query('SELECT COUNT(*) as count FROM zoho_items_map WHERE zoho_cf_dpl IS NULL OR zoho_cf_dpl = 0');
        const [noSkuRows] = await pool.query("SELECT COUNT(*) as count FROM zoho_items_map WHERE zoho_sku IS NULL OR zoho_sku = ''");
        const [brandRows] = await pool.query('SELECT DISTINCT zoho_brand FROM zoho_items_map WHERE zoho_brand IS NOT NULL ORDER BY zoho_brand');

        res.json({
            total: totalRows[0].count,
            dpl_set: dplSetRows[0].count,
            missing_dpl: missingDplRows[0].count,
            no_sku: noSkuRows[0].count,
            brands: brandRows.map(r => r.zoho_brand)
        });
    } catch (err) {
        console.error('Item summary error:', err);
        res.status(500).json({ error: 'Failed to load summary' });
    }
});

// POST /items/bulk-edit — Update multiple items
router.post('/items/bulk-edit', requireAuth, validate(bulkEditSchema), async (req, res) => {
    try {
        const { items } = req.body;
        let updated = 0;

        for (const item of items) {
            const fields = [];
            const values = [];

            if (item.zoho_item_name !== undefined) { fields.push('zoho_item_name = ?'); values.push(item.zoho_item_name); }
            if (item.zoho_sku !== undefined) { fields.push('zoho_sku = ?'); values.push(item.zoho_sku); }
            if (item.zoho_cf_dpl !== undefined) { fields.push('zoho_cf_dpl = ?'); values.push(item.zoho_cf_dpl); }
            if (item.zoho_rate !== undefined) { fields.push('zoho_rate = ?'); values.push(item.zoho_rate); }
            if (item.zoho_purchase_rate !== undefined) { fields.push('zoho_purchase_rate = ?'); values.push(item.zoho_purchase_rate); }
            if (item.zoho_description !== undefined) { fields.push('zoho_description = ?'); values.push(item.zoho_description); }

            if (fields.length > 0) {
                values.push(item.zoho_item_id);
                await pool.query(
                    `UPDATE zoho_items_map SET ${fields.join(', ')} WHERE zoho_item_id = ?`,
                    values
                );
                updated++;
            }
        }

        res.json({ success: true, updated });
    } catch (err) {
        console.error('Bulk edit error:', err);
        res.status(500).json({ error: 'Failed to bulk edit items' });
    }
});

// ========================================================================
// NAMING ENDPOINTS
// ========================================================================

// GET /naming-rules — List all naming rules
router.get('/naming-rules', requireAuth, async (req, res) => {
    try {
        const [rules] = await pool.query(
            'SELECT * FROM item_naming_rules ORDER BY brand, product_name'
        );
        res.json(rules);
    } catch (err) {
        console.error('Naming rules list error:', err);
        res.status(500).json({ error: 'Failed to load naming rules' });
    }
});

// POST /naming-rules — Create or update a naming rule
router.post('/naming-rules', requireAuth, validate(namingRuleSchema), async (req, res) => {
    try {
        const { brand, product_name, product_short, category_code } = req.body;
        const [result] = await pool.query(
            `INSERT INTO item_naming_rules (brand, product_name, product_short, category_code)
             VALUES (?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE product_short = VALUES(product_short), category_code = VALUES(category_code)`,
            [brand, product_name, product_short, category_code]
        );
        res.json({ success: true, id: result.insertId });
    } catch (err) {
        console.error('Naming rule save error:', err);
        res.status(500).json({ error: 'Failed to save naming rule' });
    }
});

// DELETE /naming-rules/:id — Delete a naming rule
router.delete('/naming-rules/:id', requireAuth, async (req, res) => {
    try {
        await pool.query('DELETE FROM item_naming_rules WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Naming rule delete error:', err);
        res.status(500).json({ error: 'Failed to delete naming rule' });
    }
});

// POST /generate-names — Generate names for items based on rules
router.post('/generate-names', requireAuth, validate(generateNamesSchema), async (req, res) => {
    try {
        const { brand, dry_run } = req.body;

        // Load items for this brand
        const [items] = await pool.query(
            'SELECT zoho_item_id, zoho_item_name, zoho_sku, zoho_cf_product_name, zoho_brand FROM zoho_items_map WHERE zoho_brand = ?',
            [brand]
        );

        // Load naming rules for this brand
        const [rules] = await pool.query(
            'SELECT * FROM item_naming_rules WHERE brand = ?',
            [brand]
        );

        if (!rules.length) {
            return res.status(400).json({ error: 'No naming rules found for this brand' });
        }

        const results = [];

        for (const item of items) {
            const itemName = (item.zoho_cf_product_name || item.zoho_item_name || '').toUpperCase();

            // Find matching rule
            const rule = rules.find(r =>
                itemName.includes(r.product_name.toUpperCase())
            );
            if (!rule) continue;

            const size = extractSizeFromName(item.zoho_item_name || '');
            if (!size) continue;

            const base = extractBaseFromName(item.zoho_item_name || '');
            const color = extractColorFromName(item.zoho_item_name || '');

            const newName = generateItemName(rule, size, base, color);
            const newSku = generateSku(rule, size, base, color);
            const newDesc = generateDescription(rule, size, base);

            results.push({
                zoho_item_id: item.zoho_item_id,
                current_name: item.zoho_item_name,
                new_name: newName,
                current_sku: item.zoho_sku,
                new_sku: newSku,
                new_description: newDesc
            });

            if (!dry_run) {
                await pool.query(
                    'UPDATE zoho_items_map SET zoho_item_name = ?, zoho_sku = ?, zoho_description = ? WHERE zoho_item_id = ?',
                    [newName, newSku, newDesc, item.zoho_item_id]
                );
            }
        }

        res.json({ success: true, dry_run, count: results.length, results });
    } catch (err) {
        console.error('Generate names error:', err);
        res.status(500).json({ error: 'Failed to generate names' });
    }
});

// ========================================================================
// DPL ENDPOINTS
// ========================================================================

// GET /dpl-versions — List DPL versions
router.get('/dpl-versions', requireAuth, async (req, res) => {
    try {
        const [versions] = await pool.query(
            'SELECT * FROM dpl_versions ORDER BY created_at DESC'
        );
        res.json(versions);
    } catch (err) {
        console.error('DPL versions list error:', err);
        res.status(500).json({ error: 'Failed to load DPL versions' });
    }
});

// POST /dpl-versions — Create a new DPL version (with optional PDF upload)
router.post('/dpl-versions', requireAuth, uploadDplPdf.single('file'), async (req, res) => {
    try {
        const { brand, effective_date, notes } = req.body;
        if (!brand) return res.status(400).json({ error: 'Brand is required' });

        const filePath = req.file ? req.file.path.replace(/\\/g, '/') : null;

        const [result] = await pool.query(
            `INSERT INTO dpl_versions (brand, effective_date, notes, file_path, uploaded_by)
             VALUES (?, ?, ?, ?, ?)`,
            [brand, effective_date || new Date(), notes || null, filePath, req.user.id]
        );

        res.json({ success: true, id: result.insertId, file_path: filePath });
    } catch (err) {
        console.error('DPL version create error:', err);
        res.status(500).json({ error: 'Failed to create DPL version' });
    }
});

// POST /dpl-parse — Parse a price list PDF (memory storage)
router.post('/dpl-parse', requireAuth, uploadPriceList.single('file'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const { parsePriceList } = require('../services/price-list-parser');
        const parsedItems = await parsePriceList(req.file.buffer, req.file.originalname);

        res.json({ success: true, count: parsedItems.length, items: parsedItems });
    } catch (err) {
        console.error('DPL parse error:', err);
        res.status(500).json({ error: 'Failed to parse price list' });
    }
});

// POST /dpl-match — Match parsed DPL items with Zoho items
router.post('/dpl-match', requireAuth, async (req, res) => {
    try {
        const { parsedItems, brand } = req.body;
        if (!parsedItems || !Array.isArray(parsedItems)) {
            return res.status(400).json({ error: 'parsedItems array required' });
        }

        const [zohoItems] = await pool.query(
            'SELECT zoho_item_id, zoho_item_name, zoho_sku, zoho_cf_dpl, zoho_rate, zoho_purchase_rate, zoho_brand FROM zoho_items_map WHERE zoho_brand = ?',
            [brand]
        );

        const { matchWithZohoItems } = require('../services/price-list-parser');
        const matched = await matchWithZohoItems(parsedItems, zohoItems);

        res.json({ success: true, count: matched.length, items: matched });
    } catch (err) {
        console.error('DPL match error:', err);
        res.status(500).json({ error: 'Failed to match items' });
    }
});

// POST /dpl-apply — Apply DPL prices to items
router.post('/dpl-apply', requireAuth, validate(dplApplySchema), async (req, res) => {
    try {
        const { items, version_id } = req.body;
        let applied = 0;

        for (const item of items) {
            // Read current prices
            const [current] = await pool.query(
                'SELECT zoho_rate, zoho_purchase_rate, zoho_cf_dpl FROM zoho_items_map WHERE zoho_item_id = ?',
                [item.zoho_item_id]
            );

            if (!current.length) continue;

            const oldRow = current[0];
            const newPurchase = item.dpl;
            const newSales = calculateSalesPrice(item.dpl);

            // Log to price history
            await pool.query(
                `INSERT INTO dpl_price_history (zoho_item_id, version_id, old_dpl, new_dpl, old_purchase_rate, new_purchase_rate, old_sales_rate, new_sales_rate, changed_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    item.zoho_item_id,
                    item.version_id || version_id || null,
                    oldRow.zoho_cf_dpl || 0,
                    item.dpl,
                    oldRow.zoho_purchase_rate || 0,
                    newPurchase,
                    oldRow.zoho_rate || 0,
                    newSales,
                    req.user.id
                ]
            );

            // Update item prices
            await pool.query(
                'UPDATE zoho_items_map SET zoho_cf_dpl = ?, zoho_purchase_rate = ?, zoho_rate = ? WHERE zoho_item_id = ?',
                [item.dpl, newPurchase, newSales, item.zoho_item_id]
            );

            applied++;
        }

        res.json({ success: true, applied });
    } catch (err) {
        console.error('DPL apply error:', err);
        res.status(500).json({ error: 'Failed to apply DPL prices' });
    }
});

// ========================================================================
// NOTEBOOKLM ENDPOINT
// ========================================================================

// POST /dpl-notebooklm — Query NotebookLM for DPL analysis
router.post('/dpl-notebooklm', requireAuth, validate(notebookLmSchema), async (req, res) => {
    try {
        const { notebook_id, query } = req.body;

        // First select the notebook
        const useCmd = `notebooklm use ${notebook_id}`;
        await new Promise((resolve, reject) => {
            exec(useCmd, { timeout: 10000 }, (err) => {
                if (err) reject(err);
                else resolve();
            });
        });

        // Then ask the query
        const safeQuery = query.replace(/"/g, '\\"');
        const askCmd = `notebooklm ask "${safeQuery}"`;
        const result = await new Promise((resolve, reject) => {
            exec(askCmd, { timeout: 30000 }, (err, stdout, stderr) => {
                if (err) reject(err);
                else resolve(stdout);
            });
        });

        res.json({ success: true, answer: result.trim() });
    } catch (err) {
        console.error('NotebookLM error:', err);
        res.status(500).json({ error: 'NotebookLM query failed' });
    }
});

// ========================================================================
// PRICE HISTORY ENDPOINTS
// ========================================================================

// GET /price-history — List price change history
router.get('/price-history', requireAuth, validateQuery(priceHistoryQuerySchema), async (req, res) => {
    try {
        const { brand, from_date, to_date, search } = req.query;
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 50;
        const offset = (page - 1) * limit;

        let where = ['1=1'];
        let params = [];

        if (brand) {
            where.push('zim.zoho_brand = ?');
            params.push(brand);
        }
        if (from_date) {
            where.push('dph.created_at >= ?');
            params.push(from_date);
        }
        if (to_date) {
            where.push('dph.created_at <= ?');
            params.push(to_date + ' 23:59:59');
        }
        if (search) {
            where.push('(zim.zoho_item_name LIKE ? OR zim.zoho_sku LIKE ?)');
            params.push(`%${search}%`, `%${search}%`);
        }

        const whereClause = where.join(' AND ');

        const [countRows] = await pool.query(
            `SELECT COUNT(*) as total
             FROM dpl_price_history dph
             JOIN zoho_items_map zim ON dph.zoho_item_id = zim.zoho_item_id
             LEFT JOIN dpl_versions dv ON dph.version_id = dv.id
             WHERE ${whereClause}`,
            params
        );

        const [rows] = await pool.query(
            `SELECT dph.*, zim.zoho_item_name, zim.zoho_sku, zim.zoho_brand,
                    dv.brand AS version_brand, dv.effective_date AS version_date, dv.notes AS version_notes
             FROM dpl_price_history dph
             JOIN zoho_items_map zim ON dph.zoho_item_id = zim.zoho_item_id
             LEFT JOIN dpl_versions dv ON dph.version_id = dv.id
             WHERE ${whereClause}
             ORDER BY dph.created_at DESC
             LIMIT ? OFFSET ?`,
            [...params, limit, offset]
        );

        res.json({
            history: rows,
            pagination: {
                page,
                limit,
                total: countRows[0].total,
                pages: Math.ceil(countRows[0].total / limit)
            }
        });
    } catch (err) {
        console.error('Price history error:', err);
        res.status(500).json({ error: 'Failed to load price history' });
    }
});

// GET /price-history/:itemId — Price history for a single item
router.get('/price-history/:itemId', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT dph.*, dv.brand AS version_brand, dv.effective_date AS version_date, dv.notes AS version_notes
             FROM dpl_price_history dph
             LEFT JOIN dpl_versions dv ON dph.version_id = dv.id
             WHERE dph.zoho_item_id = ?
             ORDER BY dph.created_at DESC`,
            [req.params.itemId]
        );
        res.json(rows);
    } catch (err) {
        console.error('Item price history error:', err);
        res.status(500).json({ error: 'Failed to load item price history' });
    }
});

// ========================================================================
// HEALTH CHECK ENDPOINT
// ========================================================================

// GET /health-check — Run health check on all active items
router.get('/health-check', requireAuth, async (req, res) => {
    try {
        const [items] = await pool.query(
            `SELECT zoho_item_id, zoho_item_name, zoho_sku, zoho_brand, zoho_category_name,
                    zoho_rate, zoho_purchase_rate, zoho_cf_dpl, zoho_status
             FROM zoho_items_map
             WHERE zoho_status = 'active'`
        );

        const issuesByType = {};
        const itemsWithIssues = [];

        for (const item of items) {
            const issues = checkItemHealth(item);
            if (issues.length > 0) {
                itemsWithIssues.push({
                    zoho_item_id: item.zoho_item_id,
                    zoho_item_name: item.zoho_item_name,
                    zoho_brand: item.zoho_brand,
                    issues
                });
                for (const issue of issues) {
                    if (!issuesByType[issue.type]) issuesByType[issue.type] = 0;
                    issuesByType[issue.type]++;
                }
            }
        }

        res.json({
            total_items: items.length,
            items_with_issues: itemsWithIssues.length,
            issues_by_type: issuesByType,
            items: itemsWithIssues
        });
    } catch (err) {
        console.error('Health check error:', err);
        res.status(500).json({ error: 'Failed to run health check' });
    }
});

module.exports = { router, setPool };
