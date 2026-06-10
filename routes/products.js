/**
 * Products Routes
 * /api/products/* — mounted at /api so paths keep their original shape.
 * A1: extracted verbatim from server.js (pure mechanical move, no logic changes).
 * ROUTE ORDER IS LOAD-BEARING: static paths (/products/units, /products/zoho-items-search,
 * /products/catalog-stats, ...) match before /products/:id only because of registration
 * order — preserved exactly as it was in server.js.
 */

const express = require('express');
const router = express.Router();
const { requireAuth, requirePermission } = require('../middleware/permissionMiddleware');
const { uploadProductImage } = require('../config/uploads');

let pool = null;
function setPool(p) {
    pool = p;
}

// ========================================
// PRODUCTS
// ========================================

const DEFAULT_UNITS = ['L', 'KG', 'M', 'PC'];

router.get('/products/units', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(
            "SELECT config_value FROM ai_config WHERE config_key = 'product_units'"
        );
        const units = rows.length ? JSON.parse(rows[0].config_value) : DEFAULT_UNITS;
        res.json({ success: true, units });
    } catch (e) {
        res.json({ success: true, units: DEFAULT_UNITS });
    }
});

router.post('/products/units', requireAuth, async (req, res) => {
    try {
        const { units } = req.body;
        if (!Array.isArray(units) || units.length === 0)
            return res.status(400).json({ success: false, message: 'units must be a non-empty array' });
        const clean = [...new Set(units.map(u => String(u).trim().toUpperCase()).filter(Boolean))];
        await pool.query(
            "INSERT INTO ai_config (config_key, config_value) VALUES ('product_units', ?) ON DUPLICATE KEY UPDATE config_value = ?",
            [JSON.stringify(clean), JSON.stringify(clean)]
        );
        res.json({ success: true, units: clean });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Search Zoho items for pack size mapping dropdown
router.get('/products/zoho-items-search', requireAuth, async (req, res) => {
    try {
        const { search } = req.query;
        let where = "WHERE (zoho_status = 'active' OR zoho_status IS NULL)";
        const params = [];
        if (search) {
            where += ' AND (zoho_item_name LIKE ? OR zoho_brand LIKE ? OR zoho_sku LIKE ? OR zoho_item_id = ?)';
            params.push(`%${search}%`, `%${search}%`, `%${search}%`, search);
        }
        const [items] = await pool.query(`
            SELECT zoho_item_id, zoho_item_name, zoho_brand, zoho_rate, zoho_sku
            FROM zoho_items_map ${where}
            ORDER BY zoho_brand, zoho_item_name
            LIMIT 50
        `, params);
        res.json({ success: true, items });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Catalog stats for estimate catalog tab
router.get('/products/catalog-stats', requireAuth, async (req, res) => {
    try {
        const [[{ total_products }]] = await pool.query(
            "SELECT COUNT(*) as total_products FROM products WHERE status = 'active'"
        );
        const [[{ mapped }]] = await pool.query(
            "SELECT COUNT(*) as mapped FROM pack_sizes ps INNER JOIN products p ON p.id = ps.product_id WHERE p.status = 'active' AND ps.is_active = 1 AND ps.zoho_item_id IS NOT NULL"
        );
        const [[{ unmapped }]] = await pool.query(
            "SELECT COUNT(*) as unmapped FROM pack_sizes ps INNER JOIN products p ON p.id = ps.product_id WHERE p.status = 'active' AND ps.is_active = 1 AND (ps.zoho_item_id IS NULL OR ps.zoho_item_id = '')"
        );
        const [[{ brand_count }]] = await pool.query(
            "SELECT COUNT(DISTINCT b.id) as brand_count FROM brands b INNER JOIN products p ON p.brand_id = b.id WHERE p.status = 'active'"
        );
        res.json({ success: true, total_products, mapped, unmapped, brand_count });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get all unmapped pack sizes (for bulk mapping)
router.get('/products/unmapped-pack-sizes', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT ps.id as pack_size_id, ps.size, ps.unit, ps.base_price,
                   p.id as product_id, p.name as product_name,
                   b.name as brand_name, c.name as category_name
            FROM pack_sizes ps
            INNER JOIN products p ON p.id = ps.product_id
            LEFT JOIN brands b ON p.brand_id = b.id
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE p.status = 'active' AND ps.is_active = 1
              AND (ps.zoho_item_id IS NULL OR ps.zoho_item_id = '')
            ORDER BY b.name, p.name, ps.size
        `);
        res.json({ success: true, items: rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Bulk map pack sizes to Zoho items
router.post('/products/bulk-map', requirePermission('products', 'edit'), async (req, res) => {
    try {
        const { mappings } = req.body;
        if (!Array.isArray(mappings) || mappings.length === 0) {
            return res.status(400).json({ success: false, error: 'No mappings provided' });
        }
        if (mappings.length > 100) {
            return res.status(400).json({ success: false, error: 'Maximum 100 mappings per call' });
        }

        const conn = await pool.getConnection();
        await conn.beginTransaction();
        let mapped = 0, failed = 0;
        try {
            for (const m of mappings) {
                if (!m.pack_size_id || !m.zoho_item_id) { failed++; continue; }
                const [result] = await conn.query(
                    'UPDATE pack_sizes SET zoho_item_id = ? WHERE id = ? AND is_active = 1',
                    [m.zoho_item_id, m.pack_size_id]
                );
                if (result.affectedRows > 0) mapped++; else failed++;
            }
            await conn.commit();
            res.json({ success: true, mapped, failed });
        } catch (txErr) {
            await conn.rollback();
            throw txErr;
        } finally {
            conn.release();
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Assign a single Zoho item to an existing product (creates pack_size + sets zoho_item_id atomically)
router.post('/products/assign-zoho-item', requirePermission('products', 'edit'), async (req, res) => {
    try {
        const { product_id, zoho_item_id, size, unit, price, color_name, color_code } = req.body;
        const colorName = color_name ? String(color_name).trim().substring(0, 100) || null : null;
        const colorCode = color_code && /^#[0-9A-Fa-f]{3,8}$/.test(String(color_code)) ? String(color_code) : null;
        if (!product_id || !zoho_item_id || !size || !unit) {
            return res.status(400).json({ success: false, error: 'product_id, zoho_item_id, size, unit are required' });
        }
        const parsedSize = parseFloat(size);
        const parsedPrice = parseFloat(price) || 0;
        if (isNaN(parsedSize) || parsedSize <= 0) {
            return res.status(400).json({ success: false, error: 'size must be a positive number' });
        }

        const normalizedUnit = String(unit || 'L').toUpperCase().substring(0, 10);
        if (!normalizedUnit) {
            return res.status(400).json({ success: false, error: 'Unit is required' });
        }

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            const [products] = await conn.query('SELECT id FROM products WHERE id = ? AND status = "active"', [product_id]);
            if (!products.length) {
                await conn.rollback();
                conn.release();
                return res.status(404).json({ success: false, error: 'Product not found' });
            }

            const [existing] = await conn.query('SELECT id FROM pack_sizes WHERE zoho_item_id = ? AND is_active = 1', [zoho_item_id]);
            if (existing.length) {
                await conn.rollback();
                conn.release();
                return res.status(409).json({ success: false, error: 'This Zoho item is already mapped to a pack size', pack_size_id: existing[0].id });
            }

            const [result] = await conn.query(
                'INSERT INTO pack_sizes (product_id, size, unit, base_price, zoho_item_id, color_name, color_code, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
                [product_id, parsedSize, normalizedUnit, parsedPrice, zoho_item_id, colorName, colorCode]
            );

            await conn.commit();
            conn.release();
            res.json({ success: true, pack_size_id: result.insertId });
        } catch (txErr) {
            await conn.rollback();
            conn.release();
            if (txErr.code === 'ER_DUP_ENTRY') {
                return res.status(409).json({ success: false, error: 'This Zoho item is already mapped to a pack size' });
            }
            throw txErr;
        }
    } catch (err) {
        console.error('assign-zoho-item error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// Get zoho_item_ids already mapped to pack_sizes
router.get('/products/mapped-zoho-ids', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT ps.zoho_item_id, ps.product_id, p.name as product_name
             FROM pack_sizes ps
             INNER JOIN products p ON p.id = ps.product_id AND p.status = 'active'
             WHERE ps.zoho_item_id IS NOT NULL AND ps.zoho_item_id != '' AND ps.is_active = 1`
        );
        // ids: for backward compat, mappings: zoho_item_id → { product_id, product_name }
        const mappings = {};
        for (const r of rows) {
            mappings[r.zoho_item_id] = { product_id: r.product_id, product_name: r.product_name };
        }
        res.json({ success: true, ids: rows.map(r => r.zoho_item_id), mappings });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Import Zoho items as local Products + pack_sizes
router.post('/products/import-from-zoho', requirePermission('products', 'add'), async (req, res) => {
    try {
        const { groups, force } = req.body;

        if (!Array.isArray(groups) || !groups.length) {
            return res.status(400).json({ success: false, error: 'No groups provided' });
        }

        // Collect all zoho_item_ids from groups
        const allItemIds = [];
        for (const g of groups) {
            if (!g.name || !Array.isArray(g.items) || !g.items.length) continue;
            for (const item of g.items) {
                if (item.zoho_item_id) allItemIds.push(item.zoho_item_id);
            }
        }
        if (!allItemIds.length) {
            return res.status(400).json({ success: false, error: 'No items in groups' });
        }
        if (allItemIds.length > 200) {
            return res.status(400).json({ success: false, error: 'Maximum 200 items per import' });
        }

        // Helper: map raw unit text to standard code
        function mapUnitCode(u) {
            if (!u) return 'L';
            u = u.trim().toLowerCase();
            if (/^(l|ltr?|litres?|liters?)$/.test(u)) return 'L';
            if (/^(kg|kgs?)$/.test(u)) return 'KG';
            if (/^ml$/.test(u)) return 'L';
            if (/^(gm?|grams?)$/.test(u)) return 'KG';
            if (/^(pc|pcs?|pieces?|nos|qty)$/.test(u)) return 'PC';
            if (/^(m|meters?)$/.test(u)) return 'M';
            return 'L';
        }

        const conn = await pool.getConnection();
        await conn.beginTransaction();
        try {
            const ph = allItemIds.map(() => '?').join(',');

            // Fetch Zoho item details for rate/unit info
            const [zohoItems] = await conn.query(`SELECT * FROM zoho_items_map WHERE zoho_item_id IN (${ph})`, allItemIds);
            const zohoMap = {};
            for (const z of zohoItems) zohoMap[z.zoho_item_id] = z;

            // Check already-mapped items
            const [alreadyMapped] = await conn.query(
                `SELECT DISTINCT zoho_item_id FROM pack_sizes WHERE zoho_item_id IN (${ph}) AND is_active = 1`, allItemIds
            );
            const mappedSet = new Set(alreadyMapped.map(r => r.zoho_item_id));

            // If force=true, remove old pack_size mappings so they can be re-imported
            let replaced = 0;
            if (force && mappedSet.size > 0) {
                const mappedIds = [...mappedSet];
                const mph = mappedIds.map(() => '?').join(',');
                await conn.query(`DELETE FROM pack_sizes WHERE zoho_item_id IN (${mph}) AND is_active = 1`, mappedIds);
                replaced = mappedSet.size;
                mappedSet.clear();
            }

            let productsCreated = 0, packSizesCreated = 0, skipped = 0;

            for (const group of groups) {
                if (!group.name || !Array.isArray(group.items) || !group.items.length) continue;

                const productName = group.name.trim();
                const brand = (group.brand || '').trim();
                const category = (group.category || '').trim();
                const productType = group.product_type || 'unit_wise';
                // Default coverage 120 sqft/L for area_wise if not specified
                const areaCoverage = productType === 'area_wise' ? (parseFloat(group.area_coverage) || 120) : null;

                // Filter out any remaining already-mapped items (if force was false)
                const itemsToImport = group.items.filter(i => !mappedSet.has(i.zoho_item_id));
                skipped += group.items.length - itemsToImport.length;
                if (!itemsToImport.length) continue;

                // Find or create brand
                let brandId = null;
                if (brand) {
                    const [eb] = await conn.query('SELECT id FROM brands WHERE name = ?', [brand]);
                    if (eb.length) { brandId = eb[0].id; }
                    else { const [r] = await conn.query('INSERT INTO brands (name) VALUES (?)', [brand]); brandId = r.insertId; }
                }
                // Find or create category
                let categoryId = null;
                if (category) {
                    const [ec] = await conn.query('SELECT id FROM categories WHERE name = ?', [category]);
                    if (ec.length) { categoryId = ec[0].id; }
                    else { const [r] = await conn.query('INSERT INTO categories (name) VALUES (?)', [category]); categoryId = r.insertId; }
                }
                // Find or create product (uses the user-edited name from frontend)
                let productId;
                const [ep] = await conn.query(
                    'SELECT id FROM products WHERE name = ? AND brand_id <=> ? AND category_id <=> ? AND status = ?',
                    [productName, brandId, categoryId, 'active']
                );
                if (ep.length) {
                    productId = ep[0].id;
                } else {
                    const rate = zohoMap[itemsToImport[0].zoho_item_id]?.zoho_rate || 0;
                    const [r] = await conn.query(
                        "INSERT INTO products (name, brand_id, category_id, product_type, base_price, area_coverage, status) VALUES (?, ?, ?, ?, ?, ?, 'active')",
                        [productName, brandId, categoryId, productType, rate, areaCoverage]
                    );
                    productId = r.insertId;
                    productsCreated++;
                }
                // Create pack sizes — parse size from frontend's size_label or fallback to zoho item name
                for (const item of itemsToImport) {
                    const zohoItem = zohoMap[item.zoho_item_id];
                    if (!zohoItem) continue;

                    let size = 1, unit = mapUnitCode(zohoItem.zoho_unit);
                    if (item.size_label) {
                        const m = item.size_label.match(/^(\d+(?:\.\d+)?)\s*(.*)$/);
                        if (m) {
                            size = parseFloat(m[1]);
                            if (m[2]) unit = mapUnitCode(m[2]);
                        }
                    }

                    await conn.query(
                        'INSERT INTO pack_sizes (product_id, size, unit, base_price, zoho_item_id, is_active) VALUES (?, ?, ?, ?, ?, 1)',
                        [productId, size, unit, zohoItem.zoho_rate || 0, item.zoho_item_id]
                    );
                    packSizesCreated++;
                }
            }

            await conn.commit();
            res.json({ success: true, products_created: productsCreated, pack_sizes_created: packSizesCreated, skipped, replaced });
        } catch (txErr) {
            await conn.rollback();
            throw txErr;
        } finally {
            conn.release();
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Upload product image (for Zoho items)
router.post('/products/:itemId/image', requirePermission('products', 'edit'), uploadProductImage.single('image'), async (req, res) => {
    try {
        const { itemId } = req.params;
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Image file is required' });
        }
        const imageUrl = `/uploads/products/${req.file.filename}`;
        // If itemId is numeric, it's a product ID — update products table
        if (/^\d+$/.test(itemId)) {
            await pool.query('UPDATE products SET image_url = ? WHERE id = ?', [imageUrl, itemId]);
            // Also update zoho_items_map for all pack_sizes of this product
            await pool.query(
                `UPDATE zoho_items_map zim JOIN pack_sizes ps ON ps.zoho_item_id = zim.zoho_item_id
                 SET zim.image_url = ? WHERE ps.product_id = ?`, [imageUrl, itemId]
            );
        } else {
            // Otherwise it's a zoho_item_id
            const [existing] = await pool.query('SELECT zoho_item_id FROM zoho_items_map WHERE zoho_item_id = ?', [itemId]);
            if (!existing.length) {
                return res.status(404).json({ success: false, message: 'Product not found in Zoho items' });
            }
            await pool.query('UPDATE zoho_items_map SET image_url = ? WHERE zoho_item_id = ?', [imageUrl, itemId]);
        }
        res.json({ success: true, message: 'Product image uploaded', image_url: imageUrl });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/products', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT p.*, b.name as brand_name, c.name as category_name,
                (SELECT zim.image_url FROM pack_sizes ps2
                 INNER JOIN zoho_items_map zim ON zim.zoho_item_id = ps2.zoho_item_id
                 WHERE ps2.product_id = p.id AND ps2.is_active = 1 AND zim.image_url IS NOT NULL
                 LIMIT 1) as image_url
            FROM products p
            LEFT JOIN brands b ON p.brand_id = b.id
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE p.status = 'active'
            ORDER BY p.name
        `);

        // Attach pack_sizes summary for each product
        if (rows.length > 0) {
            const productIds = rows.map(r => r.id);
            const [packSummary] = await pool.query(`
                SELECT product_id,
                    COUNT(*) as variant_count,
                    GROUP_CONCAT(DISTINCT CONCAT(size, ' ', COALESCE(unit,'L')) ORDER BY CAST(size AS DECIMAL) SEPARATOR '|') as size_list,
                    COUNT(DISTINCT color_name) as color_count,
                    GROUP_CONCAT(DISTINCT CONCAT(COALESCE(color_name,''), ':', COALESCE(color_code,'')) ORDER BY color_name SEPARATOR '|') as color_swatches
                FROM pack_sizes
                WHERE product_id IN (?) AND is_active = 1
                GROUP BY product_id
            `, [productIds]);

            const summaryMap = {};
            packSummary.forEach(s => { summaryMap[s.product_id] = s; });

            rows.forEach(r => {
                const s = summaryMap[r.id];
                if (s) {
                    r.variant_count = s.variant_count;
                    r.size_list = s.size_list;
                    r.color_count = s.color_count;
                    r.color_swatches = s.color_swatches;
                } else {
                    r.variant_count = 0;
                    r.size_list = '';
                    r.color_count = 0;
                    r.color_swatches = '';
                }
            });
        }

        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/products/:id', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT p.*, b.name as brand_name, c.name as category_name
            FROM products p
            LEFT JOIN brands b ON p.brand_id = b.id
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE p.id = ?
        `, [req.params.id]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }

        // Get pack sizes with zoho item names
        const [packSizes] = await pool.query(
            `SELECT ps.*, zim.zoho_item_name, zim.zoho_description
             FROM pack_sizes ps
             LEFT JOIN zoho_items_map zim ON zim.zoho_item_id = ps.zoho_item_id
             WHERE ps.product_id = ? AND ps.is_active = 1 ORDER BY ps.size`,
            [req.params.id]
        );

        // Use first zoho_description as fallback if product.description is empty
        const product = rows[0];
        if (!product.description && packSizes.length > 0) {
            const zohoDesc = packSizes.find(ps => ps.zoho_description);
            if (zohoDesc) product.description = zohoDesc.zoho_description;
        }

        res.json({ ...product, pack_sizes: packSizes });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/products', requirePermission('products', 'add'), async (req, res) => {
    try {
        const { name, brand_id, category_id, product_type, description, gst_percentage, base_price, available_sizes, area_coverage, status } = req.body;

        const [result] = await pool.query(
            'INSERT INTO products (name, brand_id, category_id, product_type, description, gst_percentage, base_price, available_sizes, area_coverage, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [name, brand_id, category_id, product_type, description || null, gst_percentage || 18, base_price || 0, available_sizes || null, area_coverage || null, status || 'active']
        );

        const productId = result.insertId;

        if (available_sizes) {
            try {
                const packSizes = JSON.parse(available_sizes);
                for (const pack of packSizes) {
                    await pool.query(
                        'INSERT INTO pack_sizes (product_id, size, unit, base_price, zoho_item_id, is_active) VALUES (?, ?, ?, ?, ?, 1)',
                        [productId, pack.size, String(pack.unit || 'L').toUpperCase().substring(0, 10), pack.base_price || pack.price, pack.zoho_item_id || null]
                    );
                }
            } catch (e) {
                console.error('Error inserting pack sizes:', e);
            }
        }

        res.json({ success: true, id: productId });
    } catch (err) {
        console.error('Error creating product:', err);
        res.status(500).json({ error: err.message });
    }
});

router.put('/products/:id', requirePermission('products', 'edit'), async (req, res) => {
    try {
        const { name, brand_id, category_id, product_type, description, gst_percentage, base_price, available_sizes, area_coverage, status } = req.body;

        await pool.query(
            'UPDATE products SET name = ?, brand_id = ?, category_id = ?, product_type = ?, description = ?, gst_percentage = ?, base_price = ?, available_sizes = ?, area_coverage = ?, status = ? WHERE id = ?',
            [name, brand_id, category_id, product_type, description || null, gst_percentage || 18, base_price || 0, available_sizes || null, area_coverage || null, status || 'active', req.params.id]
        );

        // Snapshot existing size→zoho_item_id so re-saves don't lose catalog visibility
        const [existingPs] = await pool.query(
            'SELECT size, zoho_item_id FROM pack_sizes WHERE product_id = ? AND is_active = 1 AND zoho_item_id IS NOT NULL',
            [req.params.id]
        );
        const savedZohoMap = {};
        for (const ps of existingPs) savedZohoMap[parseFloat(ps.size)] = ps.zoho_item_id;

        await pool.query('DELETE FROM pack_sizes WHERE product_id = ?', [req.params.id]);

        let packSizesInserted = 0;
        if (available_sizes) {
            try {
                const packSizes = JSON.parse(available_sizes);
                for (const pack of packSizes) {
                    const unit = String(pack.unit || 'L').toUpperCase().substring(0, 10);
                    const zohoId = pack.zoho_item_id || savedZohoMap[parseFloat(pack.size)] || null;
                    await pool.query(
                        'INSERT INTO pack_sizes (product_id, size, unit, base_price, zoho_item_id, color_name, color_code, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)',
                        [req.params.id, pack.size, unit, pack.base_price || pack.price, zohoId,
                         pack.color_name ? String(pack.color_name).trim().substring(0, 100) || null : null,
                         pack.color_code && /^#[0-9A-Fa-f]{3,8}$/.test(String(pack.color_code)) ? String(pack.color_code) : null]
                    );
                    packSizesInserted++;
                }
            } catch (e) {
                console.error(`[PUT /api/products/${req.params.id}] Error inserting pack sizes:`, e.message);
                return res.status(500).json({ success: false, error: 'Failed to save pack sizes: ' + e.message });
            }
        }

        res.json({ success: true, pack_sizes_saved: packSizesInserted });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/products/:id', requirePermission('products', 'delete'), async (req, res) => {
    try {
        await pool.query('UPDATE products SET status = ? WHERE id = ?', ['inactive', req.params.id]);
        // Also deactivate pack_sizes so their Zoho mappings are freed
        await pool.query('UPDATE pack_sizes SET is_active = 0 WHERE product_id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Bulk delete (deactivate) products
router.post('/products/bulk-delete', requirePermission('products', 'delete'), async (req, res) => {
    try {
        const { ids } = req.body;
        if (!Array.isArray(ids) || !ids.length) {
            return res.status(400).json({ success: false, error: 'No product IDs provided' });
        }
        // Sanitize: ensure all are integers
        const safeIds = ids.map(id => parseInt(id)).filter(id => id > 0);
        if (!safeIds.length) return res.status(400).json({ success: false, error: 'Invalid IDs' });

        const placeholders = safeIds.map(() => '?').join(',');
        await pool.query(`UPDATE products SET status = 'inactive' WHERE id IN (${placeholders})`, safeIds);
        await pool.query(`UPDATE pack_sizes SET is_active = 0 WHERE product_id IN (${placeholders})`, safeIds);

        res.json({ success: true, deleted: safeIds.length });
    } catch (err) {
        console.error('Bulk delete error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = {
    router,
    setPool
};
