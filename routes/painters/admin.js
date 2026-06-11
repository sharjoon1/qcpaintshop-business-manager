/**
 * Painter Routes — staff/admin endpoints (A8a split).
 * Every route here is gated by requireAuth / requirePermission.
 * Named routes stay registered before the parameterized /:id routes,
 * preserving the original registration order.
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { requirePermission, requireAuth } = require('../../middleware/permissionMiddleware');
const pointsEngine = require('../../services/painter-points-engine');
const zohoAPI = require('../../services/zoho-api');
const { uploadProductImage, uploadOfferBanner, uploadTraining, uploadPainterVisualization } = require('../../config/uploads');
const sharp = require('sharp');
const painterNotificationService = require('../../services/painter-notification-service');
const notificationService = require('../../services/notification-service');
const { generatePainterEstimatePDF } = require('../painter-estimate-pdf-generator');
const attendanceService = require('../../services/painter-attendance-service');
const audit = require('../../services/audit-log');
const { logEstimateStatusChange, toISTDateString } = require('./shared');

let pool;
let sessionManager;
function setPool(p) { pool = p; }
function setSessionManager(sm) { sessionManager = sm; }

// S3: admin kill switch — revoke every session for a painter (stolen device,
// offboarding). Audited.
router.post('/:id/revoke-sessions', requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const painterId = parseInt(req.params.id, 10);
        if (!painterId) return res.status(400).json({ success: false, message: 'Invalid painter id' });
        const [result] = await pool.query('DELETE FROM painter_sessions WHERE painter_id = ?', [painterId]);
        audit.record(req, {
            action: 'PAINTER_SESSIONS_REVOKED', entity_type: 'painter', entity_id: painterId,
            after: { revoked_sessions: result.affectedRows }
        });
        res.json({ success: true, revoked: result.affectedRows });
    } catch (error) {
        console.error('Painter revoke-sessions error:', error);
        res.status(500).json({ success: false, message: 'Failed to revoke sessions' });
    }
});

// ═══════════════════════════════════════════════════════════════
// ADMIN NAMED ROUTES (must come BEFORE /:id parameterized routes)
// ═══════════════════════════════════════════════════════════════

// --- PAINTER CUSTOM RATES (per-painter overrides) ---

// List all overrides for a painter
router.get('/custom-rates/:painterId', requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const painterId = parseInt(req.params.painterId);
        if (!painterId) return res.status(400).json({ success: false, message: 'Invalid painter id' });

        const [rows] = await pool.query(`
            SELECT pcr.*, zim.zoho_item_name, zim.zoho_brand, zim.zoho_category_name
            FROM painter_custom_rates pcr
            LEFT JOIN zoho_items_map zim
                ON zim.zoho_item_id = pcr.zoho_item_id COLLATE utf8mb4_unicode_ci
            WHERE pcr.painter_id = ?
            ORDER BY pcr.scope, pcr.target_id
        `, [painterId]);

        res.json({
            success: true,
            rates: rows.map(r => ({
                id: r.id,
                painter_id: r.painter_id,
                scope: r.scope,
                target_id: r.target_id,
                zoho_item_id: r.zoho_item_id,
                discount_pct: parseFloat(r.discount_pct),
                bonus_regular_points: parseFloat(r.bonus_regular_points),
                notes: r.notes,
                created_at: r.created_at,
                zoho_item_name: r.zoho_item_name,
                zoho_brand: r.zoho_brand,
                zoho_category_name: r.zoho_category_name
            }))
        });
    } catch (error) {
        console.error('List custom-rates error:', error);
        res.status(500).json({ success: false, message: 'Failed to list custom rates' });
    }
});

// Upsert (create or update) an override
router.post('/custom-rates', requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const {
            painter_id, scope, target_id, zoho_item_id,
            discount_pct, bonus_regular_points, notes
        } = req.body;

        if (!painter_id || !scope || !target_id) {
            return res.status(400).json({ success: false, message: 'painter_id, scope, target_id required' });
        }
        if (!['item', 'brand', 'category'].includes(scope)) {
            return res.status(400).json({ success: false, message: 'scope must be item|brand|category' });
        }
        if (scope === 'item' && !zoho_item_id) {
            return res.status(400).json({ success: false, message: 'zoho_item_id required when scope=item' });
        }

        const disc = parseFloat(discount_pct || 0);
        const bonus = parseFloat(bonus_regular_points || 0);
        if (disc < 0 || disc > 100) {
            return res.status(400).json({ success: false, message: 'discount_pct must be 0..100' });
        }
        if (disc === 0 && bonus === 0) {
            return res.status(400).json({ success: false, message: 'At least one of discount_pct / bonus_regular_points must be > 0' });
        }

        await pool.query(`
            INSERT INTO painter_custom_rates
                (painter_id, scope, target_id, zoho_item_id, discount_pct, bonus_regular_points, notes, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                zoho_item_id = VALUES(zoho_item_id),
                discount_pct = VALUES(discount_pct),
                bonus_regular_points = VALUES(bonus_regular_points),
                notes = VALUES(notes),
                updated_at = CURRENT_TIMESTAMP
        `, [
            parseInt(painter_id), scope, target_id,
            scope === 'item' ? zoho_item_id : null,
            disc, bonus, notes || null, req.user.id
        ]);

        res.json({ success: true, message: 'Override saved' });
    } catch (error) {
        console.error('Upsert custom-rate error:', error);
        res.status(500).json({ success: false, message: 'Failed to save override' });
    }
});

// Delete an override
router.delete('/custom-rates/:id', requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        await pool.query(`DELETE FROM painter_custom_rates WHERE id = ?`, [id]);
        res.json({ success: true, message: 'Override deleted' });
    } catch (error) {
        console.error('Delete custom-rate error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete override' });
    }
});

// --- OFFER CAROUSEL BRAND ORDER (admin) ---

router.get('/offer-carousel-order', requireAuth, async (req, res) => {
    try {
        const [[cfg]] = await pool.query(
            "SELECT config_value FROM ai_config WHERE config_key = 'painter_offer_brand_order'"
        );
        let order = [];
        try { order = cfg?.config_value ? JSON.parse(cfg.config_value) : []; } catch (_) { order = []; }

        // Also return all available brands (from active pack sizes) for admin picker
        const [rows] = await pool.query(`
            SELECT DISTINCT zoho_brand AS brand
            FROM zoho_items_map
            WHERE zoho_brand IS NOT NULL AND zoho_brand <> ''
            ORDER BY zoho_brand ASC
        `);
        res.json({
            success: true,
            order,
            all_brands: rows.map(r => r.brand)
        });
    } catch (error) {
        console.error('Get brand order error:', error);
        res.status(500).json({ success: false, message: 'Failed to load brand order' });
    }
});

router.put('/offer-carousel-order', requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const { order } = req.body;
        if (!Array.isArray(order)) {
            return res.status(400).json({ success: false, message: 'order must be an array of brand names' });
        }
        const value = JSON.stringify(order);
        await pool.query(`
            INSERT INTO ai_config (config_key, config_value)
            VALUES ('painter_offer_brand_order', ?)
            ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)
        `, [value]);
        res.json({ success: true, message: 'Brand order saved' });
    } catch (error) {
        console.error('Save brand order error:', error);
        res.status(500).json({ success: false, message: 'Failed to save brand order' });
    }
});

// --- OFFERS ADMIN ---

// Dropdown source for offer form: brands / categories / products
// GET /offer-targets?type=brand|category|product&q=searchTerm
router.get('/offer-targets', requireAuth, async (req, res) => {
    try {
        const type = String(req.query.type || '').toLowerCase();
        const q = (req.query.q || '').trim();
        if (!['brand', 'category', 'product'].includes(type)) {
            return res.status(400).json({ success: false, message: 'type must be brand|category|product' });
        }

        if (type === 'brand') {
            const [rows] = await pool.query(`
                SELECT DISTINCT zoho_brand AS value
                FROM zoho_items_map
                WHERE zoho_brand IS NOT NULL AND zoho_brand <> ''
                  ${q ? 'AND zoho_brand LIKE ?' : ''}
                ORDER BY zoho_brand ASC
                LIMIT 200
            `, q ? [`%${q}%`] : []);
            return res.json({ success: true, items: rows.map(r => ({ value: r.value, label: r.value })) });
        }

        if (type === 'category') {
            const [rows] = await pool.query(`
                SELECT DISTINCT zoho_category_name AS value
                FROM zoho_items_map
                WHERE zoho_category_name IS NOT NULL AND zoho_category_name <> ''
                  ${q ? 'AND zoho_category_name LIKE ?' : ''}
                ORDER BY zoho_category_name ASC
                LIMIT 200
            `, q ? [`%${q}%`] : []);
            return res.json({ success: true, items: rows.map(r => ({ value: r.value, label: r.value })) });
        }

        // type === 'product'
        const [rows] = await pool.query(`
            SELECT p.id AS value, p.name AS label,
                   MAX(zim.zoho_brand) AS brand,
                   MAX(zim.zoho_category_name) AS category
            FROM products p
            INNER JOIN pack_sizes ps ON ps.product_id = p.id AND ps.is_active = 1
            INNER JOIN zoho_items_map zim ON zim.zoho_item_id = ps.zoho_item_id
            WHERE p.status = 'active'
              ${q ? 'AND p.name LIKE ?' : ''}
            GROUP BY p.id, p.name
            ORDER BY p.name ASC
            LIMIT 200
        `, q ? [`%${q}%`] : []);
        return res.json({
            success: true,
            items: rows.map(r => ({
                value: String(r.value),
                label: r.label,
                brand: r.brand,
                category: r.category
            }))
        });
    } catch (error) {
        console.error('offer-targets error:', error);
        res.status(500).json({ success: false, message: 'Failed to load targets' });
    }
});

// List all offers
router.get('/offers', requireAuth, async (req, res) => {
    try {
        const [offers] = await pool.query(`
            SELECT pso.*, u.full_name as created_by_name
            FROM painter_special_offers pso
            LEFT JOIN users u ON pso.created_by = u.id
            ORDER BY pso.created_at DESC
        `);

        res.json({
            success: true,
            offers: offers.map(o => ({
                ...o,
                bonus_points: o.bonus_points ? parseFloat(o.bonus_points) : null,
                multiplier_value: o.multiplier_value ? parseFloat(o.multiplier_value) : null
            }))
        });
    } catch (error) {
        console.error('List offers error:', error);
        res.status(500).json({ success: false, message: 'Failed to list offers' });
    }
});

// Create offer
router.post('/offers', requirePermission('painters', 'manage'), uploadOfferBanner.single('banner'), async (req, res) => {
    try {
        // Accept both 'title' and 'title_en' for backwards compatibility (browser cache)
        const title = req.body.title || req.body.title_en;
        const description = req.body.description || req.body.description_en;
        const {
            title_ta, description_ta,
            offer_type, bonus_points, multiplier_value,
            applies_to, target_id,
            start_date, end_date
        } = req.body;

        if (!title || !offer_type || !start_date || !end_date) {
            return res.status(400).json({ success: false, message: 'title, offer_type, start_date, and end_date are required' });
        }

        const bannerUrl = req.file ? `/uploads/offers/${req.file.filename}` : null;

        const [result] = await pool.query(`
            INSERT INTO painter_special_offers
            (title, title_ta, description, description_ta, offer_type,
             bonus_points, multiplier_value, applies_to, target_id,
             banner_image_url, start_date, end_date, is_active, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
        `, [
            title, title_ta || null, description || null, description_ta || null,
            offer_type,
            bonus_points ? parseFloat(bonus_points) : null,
            multiplier_value ? parseFloat(multiplier_value) : null,
            applies_to || 'all', target_id || null,
            bannerUrl, start_date, end_date,
            req.user.id
        ]);

        res.json({ success: true, message: 'Offer created', offerId: result.insertId });
    } catch (error) {
        console.error('Create offer error:', error);
        res.status(500).json({ success: false, message: 'Failed to create offer' });
    }
});

// Update offer
router.put('/offers/:id', requirePermission('painters', 'manage'), uploadOfferBanner.single('banner'), async (req, res) => {
    try {
        const { id } = req.params;
        // Accept both 'title' and 'title_en' for backwards compatibility (browser cache)
        const title = req.body.title || req.body.title_en;
        const description = req.body.description || req.body.description_en;
        const {
            title_ta, description_ta,
            offer_type, bonus_points, multiplier_value,
            applies_to, target_id,
            start_date, end_date, is_active
        } = req.body;

        // Check offer exists
        const [existing] = await pool.query('SELECT id FROM painter_special_offers WHERE id = ?', [id]);
        if (!existing.length) {
            return res.status(404).json({ success: false, message: 'Offer not found' });
        }

        const bannerUrl = req.file ? `/uploads/offers/${req.file.filename}` : undefined;

        let updateQuery = `
            UPDATE painter_special_offers SET
                title = COALESCE(?, title),
                title_ta = COALESCE(?, title_ta),
                description = COALESCE(?, description),
                description_ta = COALESCE(?, description_ta),
                offer_type = COALESCE(?, offer_type),
                bonus_points = COALESCE(?, bonus_points),
                multiplier_value = COALESCE(?, multiplier_value),
                applies_to = COALESCE(?, applies_to),
                target_id = COALESCE(?, target_id),
                start_date = COALESCE(?, start_date),
                end_date = COALESCE(?, end_date)`;
        const updateParams = [
            title || null, title_ta || null, description || null, description_ta || null,
            offer_type || null,
            bonus_points ? parseFloat(bonus_points) : null,
            multiplier_value ? parseFloat(multiplier_value) : null,
            applies_to || null, target_id || null,
            start_date || null, end_date || null
        ];

        if (bannerUrl !== undefined) {
            updateQuery += ', banner_image_url = ?';
            updateParams.push(bannerUrl);
        }

        if (is_active !== undefined) {
            updateQuery += ', is_active = ?';
            updateParams.push(is_active === 'true' || is_active === true || is_active === '1' ? 1 : 0);
        }

        updateQuery += ' WHERE id = ?';
        updateParams.push(id);

        await pool.query(updateQuery, updateParams);
        res.json({ success: true, message: 'Offer updated' });
    } catch (error) {
        console.error('Update offer error:', error);
        res.status(500).json({ success: false, message: 'Failed to update offer' });
    }
});

// Delete offer
router.delete('/offers/:id', requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const [existing] = await pool.query('SELECT id FROM painter_special_offers WHERE id = ?', [req.params.id]);
        if (!existing.length) {
            return res.status(404).json({ success: false, message: 'Offer not found' });
        }

        await pool.query('DELETE FROM painter_special_offers WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Offer deleted' });
    } catch (error) {
        console.error('Delete offer error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete offer' });
    }
});

// --- TRAINING ADMIN ---

// List all training content (admin view — includes drafts)
router.get('/training', requireAuth, async (req, res) => {
    try {
        const { status, category, type, search } = req.query;

        let where = 'WHERE 1=1';
        const params = [];

        if (status) {
            where += ' AND tc.status = ?';
            params.push(status);
        }
        if (category) {
            where += ' AND tc.category_id = ?';
            params.push(parseInt(category));
        }
        if (type) {
            where += ' AND tc.content_type = ?';
            params.push(type);
        }
        if (search) {
            where += ' AND (tc.title LIKE ? OR tc.description LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }

        const [content] = await pool.query(`
            SELECT tc.*, cat.name as category_name,
                   u.full_name as created_by_name
            FROM painter_training_content tc
            LEFT JOIN painter_training_categories cat ON tc.category_id = cat.id
            LEFT JOIN users u ON tc.created_by = u.id
            ${where}
            ORDER BY tc.sort_order ASC, tc.created_at DESC
        `, params);

        const [categories] = await pool.query(`
            SELECT * FROM painter_training_categories ORDER BY sort_order ASC, name ASC
        `);

        res.json({ success: true, content, categories });
    } catch (error) {
        console.error('Admin training list error:', error);
        res.status(500).json({ success: false, message: 'Failed to list training content' });
    }
});

// Create training content
router.post('/training', requirePermission('painters', 'manage'), uploadTraining.single('file'), async (req, res) => {
    try {
        const {
            title, title_ta, description, description_ta,
            content_type, category_id, video_url, body_html, body_html_ta,
            sort_order, status
        } = req.body;

        if (!title || !content_type) {
            return res.status(400).json({ success: false, message: 'title and content_type are required' });
        }

        let thumbnailUrl = null;
        let pdfUrl = null;

        if (req.file) {
            if (content_type === 'pdf') {
                pdfUrl = `/uploads/training/${req.file.filename}`;
            } else {
                thumbnailUrl = `/uploads/training/${req.file.filename}`;
            }
        }

        const [result] = await pool.query(`
            INSERT INTO painter_training_content
            (title, title_ta, description, description_ta, content_type,
             category_id, video_url, body_html, body_html_ta,
             thumbnail_url, pdf_url, sort_order, status, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            title, title_ta || null, description || null, description_ta || null,
            content_type,
            category_id ? parseInt(category_id) : null,
            video_url || null, body_html || null, body_html_ta || null,
            thumbnailUrl, pdfUrl,
            parseInt(sort_order) || 0,
            status || 'draft',
            req.user.id
        ]);

        res.json({ success: true, message: 'Training content created', contentId: result.insertId });
    } catch (error) {
        console.error('Create training error:', error);
        res.status(500).json({ success: false, message: 'Failed to create training content' });
    }
});

// Update training content
router.put('/training/:id', requirePermission('painters', 'manage'), uploadTraining.single('file'), async (req, res) => {
    try {
        const { id } = req.params;
        const {
            title, title_ta, description, description_ta,
            content_type, category_id, video_url, body_html, body_html_ta,
            sort_order, status
        } = req.body;

        const [existing] = await pool.query('SELECT id, content_type FROM painter_training_content WHERE id = ?', [id]);
        if (!existing.length) {
            return res.status(404).json({ success: false, message: 'Training content not found' });
        }

        const effectiveType = content_type || existing[0].content_type;
        let fileUpdate = '';
        const fileParams = [];

        if (req.file) {
            if (effectiveType === 'pdf') {
                fileUpdate = ', pdf_url = ?';
                fileParams.push(`/uploads/training/${req.file.filename}`);
            } else {
                fileUpdate = ', thumbnail_url = ?';
                fileParams.push(`/uploads/training/${req.file.filename}`);
            }
        }

        await pool.query(`
            UPDATE painter_training_content SET
                title = COALESCE(?, title),
                title_ta = COALESCE(?, title_ta),
                description = COALESCE(?, description),
                description_ta = COALESCE(?, description_ta),
                content_type = COALESCE(?, content_type),
                category_id = COALESCE(?, category_id),
                video_url = COALESCE(?, video_url),
                body_html = COALESCE(?, body_html),
                body_html_ta = COALESCE(?, body_html_ta),
                sort_order = COALESCE(?, sort_order),
                status = COALESCE(?, status)
                ${fileUpdate}
            WHERE id = ?
        `, [
            title || null, title_ta || null, description || null, description_ta || null,
            content_type || null,
            category_id ? parseInt(category_id) : null,
            video_url || null, body_html || null, body_html_ta || null,
            sort_order != null ? parseInt(sort_order) : null,
            status || null,
            ...fileParams,
            id
        ]);

        res.json({ success: true, message: 'Training content updated' });
    } catch (error) {
        console.error('Update training error:', error);
        res.status(500).json({ success: false, message: 'Failed to update training content' });
    }
});

// Delete training content
router.delete('/training/:id', requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const [existing] = await pool.query('SELECT id FROM painter_training_content WHERE id = ?', [req.params.id]);
        if (!existing.length) {
            return res.status(404).json({ success: false, message: 'Training content not found' });
        }

        await pool.query('DELETE FROM painter_training_content WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Training content deleted' });
    } catch (error) {
        console.error('Delete training error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete training content' });
    }
});

// --- PRODUCT IMAGES ---

// Upload product image
router.post('/products/:itemId/image', requirePermission('painters', 'manage'), uploadProductImage.single('image'), async (req, res) => {
    try {
        const { itemId } = req.params;

        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Image file is required' });
        }

        // Verify product exists
        const [existing] = await pool.query('SELECT zoho_item_id FROM zoho_items_map WHERE zoho_item_id = ?', [itemId]);
        if (!existing.length) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        const imageUrl = `/uploads/products/${req.file.filename}`;
        await pool.query('UPDATE zoho_items_map SET image_url = ? WHERE zoho_item_id = ?', [imageUrl, itemId]);

        res.json({ success: true, message: 'Product image uploaded', image_url: imageUrl });
    } catch (error) {
        console.error('Upload product image error:', error);
        res.status(500).json({ success: false, message: 'Failed to upload product image' });
    }
});

// --- BULK NOTIFICATIONS ---

// Send notification to all painters
router.post('/notifications/send-all', requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const { type, title, title_ta, body, body_ta, data } = req.body;

        if (!title || !body) {
            return res.status(400).json({ success: false, message: 'title and body are required' });
        }

        const results = await painterNotificationService.sendToAll({
            type: type || 'announcement',
            title,
            title_ta: title_ta || null,
            body,
            body_ta: body_ta || null,
            data: data || null
        });

        const successCount = results.filter(r => r.success).length;
        const failCount = results.filter(r => !r.success).length;

        res.json({
            success: true,
            message: `Notification sent to ${successCount} painters${failCount > 0 ? ` (${failCount} failed)` : ''}`,
            sent: successCount,
            failed: failCount,
            total: results.length
        });
    } catch (error) {
        console.error('Bulk notification error:', error);
        res.status(500).json({ success: false, message: 'Failed to send notifications' });
    }
});

// --- INVOICE LINKING ---

router.post('/invoice/process', requirePermission('painters', 'points'), async (req, res) => {
    try {
        const { painter_id, invoice, billing_type } = req.body;
        if (!painter_id || !invoice || !billing_type) {
            return res.status(400).json({ success: false, message: 'painter_id, invoice, and billing_type are required' });
        }
        const result = await pointsEngine.processInvoice(parseInt(painter_id), invoice, billing_type, req.user.id);
        res.json(result);
    } catch (error) {
        console.error('Process invoice error:', error);
        res.status(500).json({ success: false, message: 'Failed to process invoice' });
    }
});

router.get('/invoice/search', requireAuth, async (req, res) => {
    try {
        const { search } = req.query;
        if (!search) return res.json({ success: true, invoices: [] });
        const [processed] = await pool.query('SELECT invoice_id FROM painter_invoices_processed WHERE invoice_number LIKE ?', [`%${search}%`]);
        const processedIds = processed.map(p => p.invoice_id);
        res.json({ success: true, processedIds });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Search failed' });
    }
});

// --- PRODUCT RATES CONFIG (GROUPED) ---

router.get('/config/product-rates/grouped', requireAuth, async (req, res) => {
    try {
        // Get products with their variants and point rates
        const [rows] = await pool.query(`
            SELECT p.id as product_id, p.name as product_name,
                   b.name as brand, c.name as category,
                   ps.zoho_item_id as item_id, zim.zoho_item_name as item_name,
                   zim.zoho_rate as mrp,
                   ppr.regular_points_per_unit, ppr.annual_eligible, ppr.annual_pct
            FROM products p
            LEFT JOIN brands b ON p.brand_id = b.id
            LEFT JOIN categories c ON p.category_id = c.id
            INNER JOIN pack_sizes ps ON ps.product_id = p.id AND ps.is_active = 1 AND ps.zoho_item_id IS NOT NULL
            LEFT JOIN zoho_items_map zim ON zim.zoho_item_id = ps.zoho_item_id
            LEFT JOIN painter_product_point_rates ppr ON ppr.item_id = ps.zoho_item_id
            WHERE p.status = 'active'
            ORDER BY b.name, p.name, zim.zoho_rate
        `);

        // Group by product
        const productMap = {};
        for (const row of rows) {
            if (!productMap[row.product_id]) {
                productMap[row.product_id] = {
                    product_id: row.product_id,
                    product_name: row.product_name,
                    brand: row.brand,
                    category: row.category,
                    variants: []
                };
            }
            productMap[row.product_id].variants.push({
                item_id: row.item_id,
                item_name: row.item_name,
                mrp: row.mrp ? parseFloat(row.mrp) : null,
                regular_points_per_unit: row.regular_points_per_unit ? parseFloat(row.regular_points_per_unit) : 0,
                annual_eligible: row.annual_eligible ? 1 : 0,
                annual_pct: row.annual_pct ? parseFloat(row.annual_pct) : 1.0
            });
        }

        // Build product summaries
        const products = Object.values(productMap).map(p => {
            const v = p.variants;
            const rates = v.map(x => x.regular_points_per_unit);
            const annuals = v.map(x => x.annual_eligible);
            const pcts = v.map(x => x.annual_pct);
            const mrps = v.filter(x => x.mrp).map(x => x.mrp);

            const allSameRate = rates.every(r => r === rates[0]);
            const allSameAnnual = annuals.every(a => a === annuals[0]);
            const allSamePct = pcts.every(p => p === pcts[0]);

            return {
                product_id: p.product_id,
                product_name: p.product_name,
                brand: p.brand,
                category: p.category,
                variant_count: v.length,
                min_mrp: mrps.length ? Math.min(...mrps) : null,
                max_mrp: mrps.length ? Math.max(...mrps) : null,
                regular_points_per_unit: allSameRate ? rates[0] : Math.max(...rates),
                annual_eligible: allSameAnnual ? annuals[0] : 1,
                annual_pct: allSamePct ? pcts[0] : Math.max(...pcts),
                has_mixed_rates: !(allSameRate && allSameAnnual && allSamePct)
            };
        });

        // Get unmapped items: items in painter_product_point_rates NOT linked to any active product
        const [unmapped] = await pool.query(`
            SELECT ppr.item_id, ppr.item_name, ppr.regular_points_per_unit, ppr.annual_eligible, ppr.annual_pct, ppr.category,
                   zim.zoho_brand as brand, zim.zoho_rate as mrp
            FROM painter_product_point_rates ppr
            LEFT JOIN zoho_items_map zim ON ppr.item_id = zim.zoho_item_id COLLATE utf8mb4_unicode_ci
            WHERE ppr.item_id NOT IN (
                SELECT ps.zoho_item_id FROM pack_sizes ps
                INNER JOIN products p ON ps.product_id = p.id AND p.status = 'active'
                WHERE ps.is_active = 1 AND ps.zoho_item_id IS NOT NULL
            )
            ORDER BY ppr.item_name
        `);

        // Get unique brands/categories for filters
        const brands = [...new Set(products.map(p => p.brand).filter(Boolean))].sort();
        const categories = [...new Set(products.map(p => p.category).filter(Boolean))].sort();

        const totalVariants = products.reduce((sum, p) => sum + p.variant_count, 0);

        res.json({
            success: true,
            products,
            unmapped: unmapped.map(u => ({
                ...u,
                mrp: u.mrp ? parseFloat(u.mrp) : null,
                regular_points_per_unit: parseFloat(u.regular_points_per_unit || 0),
                annual_pct: parseFloat(u.annual_pct || 1.0)
            })),
            brands,
            categories,
            summary: { product_count: products.length, variant_count: totalVariants, unmapped_count: unmapped.length }
        });
    } catch (error) {
        console.error('Get grouped rates error:', error);
        res.status(500).json({ success: false, message: 'Failed to get grouped rates' });
    }
});

router.get('/config/product-rates/grouped/:productId', requireAuth, async (req, res) => {
    try {
        const { productId } = req.params;
        const [variants] = await pool.query(`
            SELECT ps.zoho_item_id as item_id, zim.zoho_item_name as item_name,
                   ps.size, ps.unit, zim.zoho_rate as mrp,
                   ppr.regular_points_per_unit, ppr.annual_eligible, ppr.annual_pct
            FROM pack_sizes ps
            LEFT JOIN zoho_items_map zim ON zim.zoho_item_id = ps.zoho_item_id
            LEFT JOIN painter_product_point_rates ppr ON ppr.item_id = ps.zoho_item_id
            WHERE ps.product_id = ? AND ps.is_active = 1 AND ps.zoho_item_id IS NOT NULL
            ORDER BY zim.zoho_rate
        `, [productId]);

        res.json({
            success: true,
            variants: variants.map(v => ({
                item_id: v.item_id,
                item_name: v.item_name,
                size: v.size,
                unit: v.unit,
                mrp: v.mrp ? parseFloat(v.mrp) : null,
                regular_points_per_unit: parseFloat(v.regular_points_per_unit || 0),
                annual_eligible: v.annual_eligible ? 1 : 0,
                annual_pct: parseFloat(v.annual_pct || 1.0)
            }))
        });
    } catch (error) {
        console.error('Get product variants error:', error);
        res.status(500).json({ success: false, message: 'Failed to get variants' });
    }
});

router.put('/config/product-rates/grouped', requirePermission('painters', 'points'), async (req, res) => {
    try {
        const { products, overrides, unmapped } = req.body;
        let updated = 0;

        // Process product-level rates — fan out to all variants
        if (Array.isArray(products)) {
            for (const prod of products) {
                // Get all zoho_item_ids for this product
                const [packSizes] = await pool.query(
                    `SELECT ps.zoho_item_id FROM pack_sizes ps WHERE ps.product_id = ? AND ps.is_active = 1 AND ps.zoho_item_id IS NOT NULL`,
                    [prod.product_id]
                );

                // Build set of overridden item_ids to skip
                const overriddenIds = new Set((overrides || []).map(o => o.item_id));

                for (const ps of packSizes) {
                    if (overriddenIds.has(ps.zoho_item_id)) continue; // skip — will be handled by overrides
                    await pool.query(
                        `INSERT INTO painter_product_point_rates (item_id, regular_points_per_unit, annual_eligible, annual_pct)
                         VALUES (?, ?, ?, ?)
                         ON DUPLICATE KEY UPDATE regular_points_per_unit = VALUES(regular_points_per_unit),
                         annual_eligible = VALUES(annual_eligible), annual_pct = VALUES(annual_pct)`,
                        [ps.zoho_item_id, prod.regular_points_per_unit || 0,
                         prod.annual_eligible ? 1 : 0, prod.annual_pct || 1.0]
                    );
                    updated++;
                }
            }
        }

        // Process per-variant overrides
        if (Array.isArray(overrides)) {
            for (const ov of overrides) {
                await pool.query(
                    `INSERT INTO painter_product_point_rates (item_id, regular_points_per_unit, annual_eligible, annual_pct)
                     VALUES (?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE regular_points_per_unit = VALUES(regular_points_per_unit),
                     annual_eligible = VALUES(annual_eligible), annual_pct = VALUES(annual_pct)`,
                    [ov.item_id, ov.regular_points_per_unit || 0,
                     ov.annual_eligible ? 1 : 0, ov.annual_pct || 1.0]
                );
                updated++;
            }
        }

        // Process unmapped items
        if (Array.isArray(unmapped)) {
            for (const u of unmapped) {
                await pool.query(
                    `INSERT INTO painter_product_point_rates (item_id, regular_points_per_unit, annual_eligible, annual_pct)
                     VALUES (?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE regular_points_per_unit = VALUES(regular_points_per_unit),
                     annual_eligible = VALUES(annual_eligible), annual_pct = VALUES(annual_pct)`,
                    [u.item_id, u.regular_points_per_unit || 0,
                     u.annual_eligible ? 1 : 0, u.annual_pct || 1.0]
                );
                updated++;
            }
        }

        res.json({ success: true, message: `${updated} item rates updated` });
    } catch (error) {
        console.error('Update grouped rates error:', error);
        res.status(500).json({ success: false, message: 'Failed to update rates' });
    }
});

// --- PRODUCT RATES CONFIG (LEGACY) ---

router.get('/config/product-rates', requireAuth, async (req, res) => {
    try {
        const { search, brand, category } = req.query;
        let where = 'WHERE 1=1';
        const params = [];

        if (search) {
            where += ' AND (ppr.item_name LIKE ? OR zim.zoho_brand LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }
        if (brand) {
            where += ' AND zim.zoho_brand = ?';
            params.push(brand);
        }
        if (category) {
            where += ' AND ppr.category = ?';
            params.push(category);
        }

        const [rates] = await pool.query(`
            SELECT ppr.*, zim.zoho_brand as brand, zim.zoho_rate as mrp,
                   zim.zoho_stock_on_hand as stock
            FROM painter_product_point_rates ppr
            LEFT JOIN zoho_items_map zim ON ppr.item_id = zim.zoho_item_id COLLATE utf8mb4_unicode_ci
            ${where}
            ORDER BY ppr.category, ppr.item_name
        `, params);

        // Get unique brands/categories for filter dropdowns
        const [brands] = await pool.query(`
            SELECT DISTINCT zim.zoho_brand as brand
            FROM painter_product_point_rates ppr
            JOIN zoho_items_map zim ON ppr.item_id = zim.zoho_item_id COLLATE utf8mb4_unicode_ci
            WHERE zim.zoho_brand IS NOT NULL AND zim.zoho_brand != ''
            ORDER BY zim.zoho_brand
        `);
        const [categories] = await pool.query(`
            SELECT DISTINCT category FROM painter_product_point_rates
            WHERE category IS NOT NULL AND category != '' ORDER BY category
        `);

        res.json({ success: true, rates, brands: brands.map(b => b.brand), categories: categories.map(c => c.category) });
    } catch (error) {
        console.error('Get rates error:', error);
        res.status(500).json({ success: false, message: 'Failed to get rates' });
    }
});

router.put('/config/product-rates', requirePermission('painters', 'points'), async (req, res) => {
    try {
        const { rates } = req.body;
        if (!Array.isArray(rates)) return res.status(400).json({ success: false, message: 'rates array required' });

        for (const rate of rates) {
            await pool.query(
                `INSERT INTO painter_product_point_rates (item_id, item_name, regular_points_per_unit, annual_eligible, annual_pct, category)
                 VALUES (?, ?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE item_name = VALUES(item_name), regular_points_per_unit = VALUES(regular_points_per_unit),
                 annual_eligible = VALUES(annual_eligible), annual_pct = VALUES(annual_pct), category = VALUES(category)`,
                [rate.item_id, rate.item_name || null, rate.regular_points_per_unit || 0,
                 rate.annual_eligible ? 1 : 0, rate.annual_pct || 1.0, rate.category || null]
            );
        }
        res.json({ success: true, message: `${rates.length} rates updated` });
    } catch (error) {
        console.error('Update rates error:', error);
        res.status(500).json({ success: false, message: 'Failed to update rates' });
    }
});

router.post('/config/product-rates/sync', requirePermission('painters', 'points'), async (req, res) => {
    try {
        const [items] = await pool.query(`
            SELECT zoho_item_id as item_id, zoho_item_name as name,
                   zoho_category_name as category, zoho_brand as brand, zoho_rate as rate
            FROM zoho_items_map
            WHERE zoho_status = 'active' OR zoho_status IS NULL
            ORDER BY zoho_item_name
        `);
        let synced = 0;
        let skipped = 0;
        const uniqueBrands = new Set();
        for (const item of items) {
            if (item.brand) uniqueBrands.add(item.brand);
            const [existing] = await pool.query('SELECT id FROM painter_product_point_rates WHERE item_id = ?', [item.item_id]);
            if (!existing.length) {
                const categoryDisplay = item.category || (item.brand ? item.brand : null);
                await pool.query(
                    'INSERT INTO painter_product_point_rates (item_id, item_name, category) VALUES (?, ?, ?)',
                    [item.item_id, item.name, categoryDisplay]
                );
                synced++;
            } else {
                skipped++;
            }
        }
        res.json({
            success: true,
            message: `${synced} new items synced (${skipped} already exist)`,
            synced, skipped, total: items.length,
            brands: Array.from(uniqueBrands).sort()
        });
    } catch (error) {
        console.error('Sync rates error:', error);
        res.status(500).json({ success: false, message: 'Failed to sync rates: ' + error.message });
    }
});

// --- VALUE SLABS CONFIG ---

router.get('/config/slabs', requireAuth, async (req, res) => {
    try {
        const [slabs] = await pool.query('SELECT * FROM painter_value_slabs ORDER BY period_type, min_amount');
        res.json({ success: true, slabs });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to get slabs' });
    }
});

router.post('/config/slabs', requirePermission('painters', 'points'), async (req, res) => {
    try {
        const { period_type, min_amount, max_amount, bonus_points, label } = req.body;
        if (!period_type || min_amount == null || !bonus_points) {
            return res.status(400).json({ success: false, message: 'period_type, min_amount, and bonus_points required' });
        }
        const [result] = await pool.query(
            'INSERT INTO painter_value_slabs (period_type, min_amount, max_amount, bonus_points, label) VALUES (?, ?, ?, ?, ?)',
            [period_type, min_amount, max_amount || null, bonus_points, label || null]
        );
        res.json({ success: true, message: 'Slab created', id: result.insertId });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to create slab' });
    }
});

router.put('/config/slabs/:id', requirePermission('painters', 'points'), async (req, res) => {
    try {
        const { period_type, min_amount, max_amount, bonus_points, label, is_active } = req.body;
        await pool.query(
            `UPDATE painter_value_slabs SET period_type = COALESCE(?, period_type), min_amount = COALESCE(?, min_amount),
             max_amount = ?, bonus_points = COALESCE(?, bonus_points), label = ?, is_active = COALESCE(?, is_active) WHERE id = ?`,
            [period_type, min_amount, max_amount !== undefined ? max_amount : null, bonus_points, label || null, is_active, req.params.id]
        );
        res.json({ success: true, message: 'Slab updated' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update slab' });
    }
});

router.delete('/config/slabs/:id', requirePermission('painters', 'points'), async (req, res) => {
    try {
        await pool.query('DELETE FROM painter_value_slabs WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Slab deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to delete slab' });
    }
});

// --- WITHDRAWALS (ADMIN) ---

router.get('/withdrawals', requireAuth, async (req, res) => {
    try {
        const { status, page = 1, limit = 50 } = req.query;
        let query = 'SELECT pw.*, p.full_name, p.phone FROM painter_withdrawals pw JOIN painters p ON pw.painter_id = p.id WHERE 1=1';
        const params = [];
        if (status) { query += ' AND pw.status = ?'; params.push(status); }
        query += ' ORDER BY pw.requested_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));
        const [withdrawals] = await pool.query(query, params);
        res.json({ success: true, withdrawals });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to get withdrawals' });
    }
});

router.put('/withdrawals/:id', requirePermission('painters', 'points'), async (req, res) => {
    try {
        const { action, payment_reference, notes } = req.body;
        if (!action) return res.status(400).json({ success: false, message: 'Action required (approve/reject/paid)' });

        // Get withdrawal details before processing (for notification + audit before-snapshot)
        const [wRows] = await pool.query('SELECT painter_id, pool, amount, status FROM painter_withdrawals WHERE id = ?', [req.params.id]);
        const withdrawal = wRows[0];

        const result = await pointsEngine.processWithdrawal(parseInt(req.params.id), action, req.user.id, payment_reference, notes);
        res.json({ success: true, message: `Withdrawal ${action}d`, ...result });

        await audit.record(req, {
            action: `painter.withdrawal.${action}`,
            entity_type: 'painter_withdrawal',
            entity_id: req.params.id,
            before: withdrawal,
            after: { ...withdrawal, status: action === 'paid' ? 'paid' : (action === 'approve' ? 'approved' : 'rejected'), payment_reference, notes }
        });

        // Send notification to painter
        if (withdrawal) {
            try {
                const amt = parseFloat(withdrawal.amount).toFixed(2);
                const poolLabel = withdrawal.pool === 'regular' ? 'Regular' : 'Annual';
                let title, body, type;
                if (action === 'approve' || action === 'paid') {
                    type = 'withdrawal_approved';
                    title = 'Withdrawal Approved!';
                    body = `Your ${poolLabel} points withdrawal of ${amt} has been ${action === 'paid' ? 'paid' : 'approved'}.${payment_reference ? ' Ref: ' + payment_reference : ''}`;
                } else if (action === 'reject') {
                    type = 'withdrawal_rejected';
                    title = 'Withdrawal Rejected';
                    body = `Your ${poolLabel} points withdrawal of ${amt} was rejected.${notes ? ' Reason: ' + notes : ''}`;
                }
                if (type) {
                    await painterNotificationService.sendToPainter(withdrawal.painter_id, {
                        type,
                        title,
                        body,
                        data: { withdrawal_id: String(req.params.id), action }
                    });
                }
            } catch (notifErr) {
                console.error('Withdrawal notification error (non-fatal):', notifErr.message);
            }
        }
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// --- ATTENDANCE (ADMIN) ---

router.get('/attendance', requireAuth, async (req, res) => {
    try {
        const { painter_id, page = 1, limit = 50 } = req.query;
        let query = 'SELECT pa.*, p.full_name, p.phone FROM painter_attendance pa JOIN painters p ON pa.painter_id = p.id WHERE 1=1';
        const params = [];
        if (painter_id) { query += ' AND pa.painter_id = ?'; params.push(painter_id); }
        query += ' ORDER BY pa.check_in_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));
        const [records] = await pool.query(query, params);
        res.json({ success: true, attendance: records });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to get attendance' });
    }
});

router.post('/attendance/:checkinId/reject', requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const checkinId = parseInt(req.params.checkinId, 10);
        const { reason } = req.body;
        if (!reason || reason.trim().length < 3) {
            return res.status(400).json({ error: 'reason (3+ chars) required' });
        }
        const result = await attendanceService.rejectCheckin(checkinId, reason.trim(), req.user.id);

        try {
            const painterNotif = require('../../services/painter-notification-service');
            await painterNotif.sendToPainter(result.painter_id, {
                type: 'attendance_rejected',
                title: '⚠ Check-in rejected',
                title_ta: '⚠ சரிபார்ப்பு நிராகரிக்கப்பட்டது',
                body: `${result.clawback} AP removed. Reason: ${reason}`,
                body_ta: `${result.clawback} AP நீக்கப்பட்டது. காரணம்: ${reason}`,
                data: { screen: 'attendance' }
            });
        } catch (e) { /* push notification failure; non-fatal */ }

        res.json(result);
    } catch (err) {
        if (err.status) return res.status(err.status).json({ code: err.code, error: err.message });
        console.error('reject error:', err);
        res.status(500).json({ error: 'Reject failed' });
    }
});

router.get('/attendance/today', requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const { branch_id, date } = req.query;
        const dateStr = date || new Date().toISOString().slice(0, 10);
        const params = [dateStr];
        let where = 'c.checkin_date = ?';
        if (branch_id) { where += ' AND c.branch_id = ?'; params.push(branch_id); }

        const [rows] = await pool.query(
            `SELECT c.id, c.painter_id, p.full_name AS painter_name, p.profile_photo,
                    c.branch_id, b.name AS branch_name,
                    c.checkin_at, c.distance_meters, c.selfie_path,
                    c.status, c.rejected_reason, c.points_awarded
             FROM painter_attendance_checkins c
             JOIN painters p ON p.id = c.painter_id
             JOIN branches b ON b.id = c.branch_id
             WHERE ${where}
             ORDER BY c.checkin_at DESC`,
            params
        );
        res.json({ date: dateStr, checkins: rows });
    } catch (err) {
        console.error('today error:', err);
        res.status(500).json({ error: 'Failed to load today' });
    }
});

router.get('/attendance/monthly', requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const monthKey = req.query.month || (() => {
            const d = new Date(); d.setMonth(d.getMonth() - 1);
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        })();
        const branchId = req.query.branch_id;
        const params = [monthKey];
        let branchFilter = '';
        if (branchId) {
            branchFilter = `AND p.id IN (SELECT DISTINCT painter_id FROM painter_attendance_checkins WHERE branch_id=? AND month_key=?)`;
            params.push(branchId, monthKey);
        }
        const [rows] = await pool.query(
            `SELECT m.*, p.full_name, p.profile_photo
             FROM painter_attendance_monthly m
             JOIN painters p ON p.id = m.painter_id
             WHERE m.month_key=? ${branchFilter}
             ORDER BY m.total_ap_earned DESC`,
            params
        );
        res.json({ month_key: monthKey, rows });
    } catch (err) {
        console.error('monthly error:', err);
        res.status(500).json({ error: 'Failed to load monthly' });
    }
});

router.get('/:painterId/attendance/calendar', requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const painterId = parseInt(req.params.painterId, 10);
        const monthKey = req.query.month || (() => {
            const d = new Date();
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        })();
        const [checkins] = await pool.query(
            `SELECT c.*, b.name AS branch_name, u.full_name AS rejected_by_name
             FROM painter_attendance_checkins c
             JOIN branches b ON b.id = c.branch_id
             LEFT JOIN users u ON u.id = c.rejected_by
             WHERE c.painter_id=? AND c.month_key=?
             ORDER BY c.checkin_date`,
            [painterId, monthKey]
        );
        const [monthlyRows] = await pool.query(
            'SELECT * FROM painter_attendance_monthly WHERE painter_id=? AND month_key=?',
            [painterId, monthKey]
        );
        res.json({ month_key: monthKey, checkins, monthly: monthlyRows[0] || null });
    } catch (err) {
        console.error('calendar error:', err);
        res.status(500).json({ error: 'Failed to load calendar' });
    }
});

// --- REFERRALS (ADMIN) ---

router.get('/referrals', requireAuth, async (req, res) => {
    try {
        const [referrals] = await pool.query(
            `SELECT pr.*, r1.full_name as referrer_name, r1.phone as referrer_phone,
                    r2.full_name as referred_name, r2.phone as referred_phone
             FROM painter_referrals pr
             JOIN painters r1 ON pr.referrer_id = r1.id
             JOIN painters r2 ON pr.referred_id = r2.id
             ORDER BY pr.created_at DESC`
        );
        res.json({ success: true, referrals });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to get referrals' });
    }
});

// --- REPORTS ---

router.get('/reports/summary', requireAuth, async (req, res) => {
    try {
        const [total] = await pool.query('SELECT COUNT(*) as count FROM painters');
        const [approved] = await pool.query('SELECT COUNT(*) as count FROM painters WHERE status = "approved"');
        const [pending] = await pool.query('SELECT COUNT(*) as count FROM painters WHERE status = "pending"');
        const [pointsIssued] = await pool.query('SELECT COALESCE(SUM(amount), 0) as total FROM painter_point_transactions WHERE type = "earn"');
        const [pointsRedeemed] = await pool.query('SELECT COALESCE(SUM(ABS(amount)), 0) as total FROM painter_point_transactions WHERE type IN ("debit","redeem")');
        const [pendingWithdrawals] = await pool.query('SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM painter_withdrawals WHERE status = "pending"');
        const [activeCredit] = await pool.query('SELECT COUNT(*) as count, COALESCE(SUM(credit_used), 0) as total FROM painters WHERE credit_enabled = 1');

        res.json({
            success: true,
            summary: {
                totalPainters: total[0].count,
                approvedPainters: approved[0].count,
                pendingPainters: pending[0].count,
                totalPointsIssued: parseFloat(pointsIssued[0].total),
                totalPointsRedeemed: parseFloat(pointsRedeemed[0].total),
                pendingWithdrawals: { count: pendingWithdrawals[0].count, total: parseFloat(pendingWithdrawals[0].total) },
                activeCredit: { count: activeCredit[0].count, totalUsed: parseFloat(activeCredit[0].total) }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to get summary' });
    }
});

router.get('/reports/top-earners', requireAuth, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 20;
        const [earners] = await pool.query(
            `SELECT id, full_name, phone, city, regular_points, annual_points,
                    total_earned_regular, total_earned_annual,
                    (total_earned_regular + total_earned_annual) as total_earned
             FROM painters WHERE status = "approved"
             ORDER BY total_earned DESC LIMIT ?`,
            [limit]
        );
        res.json({ success: true, earners });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to get top earners' });
    }
});

// --- ESTIMATES (ADMIN) ---

// List all estimates
router.get('/estimates', requireAuth, async (req, res) => {
    try {
        const { status, billing_type, painter, page = 1, limit = 50 } = req.query;
        let query = `SELECT pe.*, p.full_name as painter_name, p.phone as painter_phone
                     FROM painter_estimates pe
                     JOIN painters p ON pe.painter_id = p.id WHERE 1=1`;
        const params = [];

        if (status) { query += ' AND pe.status = ?'; params.push(status); }
        if (billing_type) { query += ' AND pe.billing_type = ?'; params.push(billing_type); }
        if (painter) {
            query += ' AND (p.full_name LIKE ? OR p.phone LIKE ? OR pe.estimate_number LIKE ?)';
            params.push(`%${painter}%`, `%${painter}%`, `%${painter}%`);
        }

        const countQuery = query.replace(/SELECT pe\.\*.*FROM/, 'SELECT COUNT(*) as total FROM');
        const [countResult] = await pool.query(countQuery, params);
        const total = countResult[0].total;

        query += ' ORDER BY pe.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

        const [estimates] = await pool.query(query, params);

        // Get item counts for each estimate
        if (estimates.length) {
            const ids = estimates.map(e => e.id);
            const [counts] = await pool.query(
                'SELECT estimate_id, COUNT(*) as item_count, SUM(quantity) as total_qty FROM painter_estimate_items WHERE estimate_id IN (?) AND deleted_at IS NULL GROUP BY estimate_id',
                [ids]
            );
            const countMap = {};
            counts.forEach(c => { countMap[c.estimate_id] = { items: c.item_count, qty: c.total_qty }; });
            estimates.forEach(e => {
                e.item_count = countMap[e.id]?.items || 0;
                e.total_qty = countMap[e.id]?.qty || 0;
            });
        }

        res.json({ success: true, estimates, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
    } catch (error) {
        console.error('List estimates error:', error);
        res.status(500).json({ success: false, message: 'Failed to list estimates' });
    }
});

// Search products for estimate editing (admin) — MUST be before /:estimateId
router.get('/estimates/products', requireAuth, async (req, res) => {
    try {
        const { search } = req.query;
        if (!search || search.trim().length < 2) return res.json({ success: true, products: [] });

        const [products] = await pool.query(
            `SELECT zim.zoho_item_id, zim.zoho_item_name, zim.zoho_description, zim.zoho_rate,
                    zim.zoho_brand, zim.zoho_category_name, zim.image_url
             FROM zoho_items_map zim
             WHERE (zim.zoho_item_name LIKE ? OR zim.zoho_description LIKE ? OR zim.zoho_brand LIKE ?)
             AND zim.zoho_rate > 0
             ORDER BY zim.zoho_item_name
             LIMIT 20`,
            [`%${search}%`, `%${search}%`, `%${search}%`]
        );

        res.json({ success: true, products });
    } catch (error) {
        console.error('Search estimate products error:', error);
        res.status(500).json({ success: false, message: 'Failed to search products' });
    }
});

// Get single estimate detail (admin)
router.get('/estimates/:estimateId', requireAuth, async (req, res) => {
    try {
        const [estimates] = await pool.query(
            `SELECT pe.*, p.full_name as painter_name, p.phone as painter_phone, p.city as painter_city,
                    p.zoho_contact_id as painter_zoho_contact_id
             FROM painter_estimates pe
             JOIN painters p ON pe.painter_id = p.id
             WHERE pe.id = ?`,
            [req.params.estimateId]
        );
        if (!estimates.length) return res.status(404).json({ success: false, message: 'Estimate not found' });

        const [items] = await pool.query(
            `SELECT pei.*, zim.zoho_description, zim.zoho_item_name as zoho_display_name
             FROM painter_estimate_items pei
             LEFT JOIN zoho_items_map zim ON pei.zoho_item_id = zim.zoho_item_id COLLATE utf8mb4_unicode_ci
             WHERE pei.estimate_id = ? AND pei.deleted_at IS NULL ORDER BY pei.display_order, pei.id`,
            [estimates[0].id]
        );

        res.json({ success: true, estimate: estimates[0], items });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to load estimate' });
    }
});

// Admin edit estimate items — replace items + recalculate totals
router.put('/estimates/:estimateId/items', requirePermission('painters', 'estimates'), async (req, res) => {
    try {
        const { items } = req.body; // [{ item_id (zoho_item_id), quantity }]
        if (!items || !Array.isArray(items) || !items.length) {
            return res.status(400).json({ success: false, message: 'Items array is required' });
        }

        const editableStatuses = ['admin_review', 'approved', 'sent_to_customer', 'final_approved', 'payment_submitted', 'payment_recorded'];
        const [estimates] = await pool.query(
            'SELECT * FROM painter_estimates WHERE id = ? AND status IN (?)',
            [req.params.estimateId, editableStatuses]
        );
        if (!estimates.length) return res.status(404).json({ success: false, message: 'Estimate not found or not editable' });

        const estimate = estimates[0];
        const isCustomer = estimate.billing_type === 'customer';
        const hadPayment = ['payment_submitted', 'payment_recorded'].includes(estimate.status);

        // Fetch prices from zoho_items_map for all requested items
        const itemIds = items.map(i => i.item_id);
        const [zohoItems] = await pool.query(
            `SELECT zoho_item_id, zoho_item_name, zoho_description, zoho_rate, zoho_brand, zoho_category_name
             FROM zoho_items_map WHERE zoho_item_id IN (?)`,
            [itemIds]
        );
        const zohoMap = {};
        zohoItems.forEach(z => { zohoMap[z.zoho_item_id] = z; });

        // Soft-delete existing items (history preserved for U18 audit trail)
        await pool.query('UPDATE painter_estimate_items SET deleted_at = NOW() WHERE estimate_id = ? AND deleted_at IS NULL', [estimate.id]);

        // Insert new items with server-side prices
        let subtotal = 0;
        for (let i = 0; i < items.length; i++) {
            const reqItem = items[i];
            const zoho = zohoMap[reqItem.item_id];
            if (!zoho) continue;

            const qty = parseFloat(reqItem.quantity) || 1;
            const unitPrice = parseFloat(zoho.zoho_rate) || 0;
            const lineTotal = Math.round(unitPrice * qty * 100) / 100;
            subtotal += lineTotal;

            await pool.query(
                `INSERT INTO painter_estimate_items (estimate_id, zoho_item_id, item_name, brand, category, quantity, unit_price, line_total, display_order)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [estimate.id, reqItem.item_id, zoho.zoho_item_name, zoho.zoho_brand, zoho.zoho_category_name, qty, unitPrice, lineTotal, i + 1]
            );
        }

        const grandTotal = subtotal; // Prices include GST

        // Update estimate totals
        const updateFields = {
            subtotal, gst_amount: 0, grand_total: grandTotal
        };

        // Customer billing: clear markup/discount, reset status to admin_review
        if (isCustomer) {
            updateFields.markup_subtotal = null;
            updateFields.markup_gst_amount = null;
            updateFields.markup_grand_total = null;
            updateFields.discount_percentage = null;
            updateFields.discount_amount = null;
            updateFields.final_grand_total = null;

            const oldStatus = estimate.status;
            if (oldStatus !== 'admin_review') {
                updateFields.status = 'admin_review';
                await logEstimateStatusChange(estimate.id, oldStatus, 'admin_review', req.user.id, 'Items edited by admin — markup cleared, needs re-markup');
            }
        }
        // Self billing: keep status (even payment_recorded) — balance will be shown if total > paid
        // Payment fields are always preserved

        const setClauses = Object.keys(updateFields).map(k => `${k} = ?`).join(', ');
        const setValues = Object.values(updateFields);
        await pool.query(`UPDATE painter_estimates SET ${setClauses} WHERE id = ?`, [...setValues, estimate.id]);

        // Calculate balance if payment exists
        const paidAmount = parseFloat(estimate.payment_amount) || 0;
        const balanceDue = paidAmount > 0 ? Math.max(0, Math.round((grandTotal - paidAmount) * 100) / 100) : 0;

        res.json({
            success: true,
            message: `Items updated${isCustomer ? ' — markup cleared, set new markup' : ''}${balanceDue > 0 ? ` — Balance due: ₹${balanceDue}` : ''}`,
            subtotal, grandTotal, balanceDue
        });
    } catch (error) {
        console.error('Edit estimate items error:', error);
        res.status(500).json({ success: false, message: 'Failed to update items' });
    }
});

// Download estimate PDF (admin)
router.get('/estimates/:estimateId/pdf', requireAuth, async (req, res) => {
    try {
        const [estimates] = await pool.query(
            `SELECT pe.*, p.full_name as painter_name, p.phone as painter_phone
             FROM painter_estimates pe JOIN painters p ON pe.painter_id = p.id
             WHERE pe.id = ?`,
            [req.params.estimateId]
        );
        if (!estimates.length) return res.status(404).json({ success: false, message: 'Estimate not found' });
        if (estimates[0].status === 'draft') return res.status(400).json({ success: false, message: 'Cannot download draft estimate' });

        const [items] = await pool.query(
            'SELECT * FROM painter_estimate_items WHERE estimate_id = ? AND deleted_at IS NULL ORDER BY display_order, id',
            [estimates[0].id]
        );

        const [settings] = await pool.query("SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('business_name','business_logo','business_address','business_phone','business_email','business_gst')");
        const branding = {};
        settings.forEach(s => { branding[s.setting_key] = s.setting_value; });

        // Admin PDF: always show markup prices for customer billing
        const showMarkup = estimates[0].billing_type === 'customer';
        generatePainterEstimatePDF(res, estimates[0], items, branding, { showMarkup });
    } catch (error) {
        console.error('Admin estimate PDF error:', error);
        if (!res.headersSent) res.status(500).json({ success: false, message: 'Failed to generate PDF' });
    }
});

// Review estimate (approve / reject)
router.put('/estimates/:estimateId/review', requirePermission('painters', 'estimates'), async (req, res) => {
    try {
        const { action, admin_notes } = req.body;
        if (!action || !['approve', 'reject'].includes(action)) {
            return res.status(400).json({ success: false, message: 'Action must be approve or reject' });
        }

        const [estimates] = await pool.query(
            "SELECT * FROM painter_estimates WHERE id = ? AND status IN ('pending_admin','admin_review')",
            [req.params.estimateId]
        );
        if (!estimates.length) return res.status(404).json({ success: false, message: 'Estimate not found or not reviewable' });

        const estimate = estimates[0];

        if (action === 'reject') {
            await pool.query(
                "UPDATE painter_estimates SET status = 'rejected', admin_notes = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?",
                [admin_notes || null, req.user.id, estimate.id]
            );
            await logEstimateStatusChange(estimate.id, estimate.status, 'rejected', req.user.id, admin_notes || 'Rejected by admin');
            return res.json({ success: true, message: 'Estimate rejected' });
        }

        // Approve: self-billing → approved; customer-billing → admin_review (needs markup)
        let newStatus;
        if (estimate.billing_type === 'self') {
            newStatus = 'approved';
        } else {
            // Customer billing: check if markup prices exist
            const [markupCheck] = await pool.query(
                'SELECT SUM(markup_unit_price) as total FROM painter_estimate_items WHERE estimate_id = ? AND deleted_at IS NULL',
                [estimate.id]
            );
            newStatus = (markupCheck[0].total > 0) ? 'approved' : 'admin_review';
        }

        await pool.query(
            "UPDATE painter_estimates SET status = ?, admin_notes = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?",
            [newStatus, admin_notes || null, req.user.id, estimate.id]
        );
        await logEstimateStatusChange(estimate.id, estimate.status, newStatus, req.user.id, admin_notes || 'Approved by admin');

        res.json({ success: true, message: `Estimate ${newStatus === 'admin_review' ? 'approved - set markup prices next' : 'approved'}`, status: newStatus });
    } catch (error) {
        console.error('Review estimate error:', error);
        res.status(500).json({ success: false, message: 'Failed to review estimate' });
    }
});

// Set markup prices (customer billing) — supports % and absolute pricing
router.post('/estimates/:estimateId/markup', requirePermission('painters', 'estimates'), async (req, res) => {
    try {
        const { items, markup_percentage } = req.body; // items: [{ id, markup_unit_price?, markup_pct? }], markup_percentage: bulk %
        if (!items && !markup_percentage) return res.status(400).json({ success: false, message: 'Items with markup prices or markup percentage required' });

        const [estimates] = await pool.query(
            "SELECT * FROM painter_estimates WHERE id = ? AND billing_type = 'customer' AND status IN ('pending_admin','admin_review')",
            [req.params.estimateId]
        );
        if (!estimates.length) return res.status(404).json({ success: false, message: 'Customer-billing estimate not found' });

        // Get all items for this estimate
        const [allItems] = await pool.query(
            'SELECT id, unit_price, quantity FROM painter_estimate_items WHERE estimate_id = ? AND deleted_at IS NULL',
            [estimates[0].id]
        );
        const bulkPct = parseFloat(markup_percentage) || 0;

        let markupSubtotal = 0;
        for (const dbItem of allItems) {
            // Check if this item has a specific markup from the request
            const reqItem = items ? items.find(i => i.id === dbItem.id || i.id === String(dbItem.id)) : null;
            let markupPrice;

            if (reqItem && reqItem.markup_unit_price) {
                // Absolute price provided
                markupPrice = parseFloat(reqItem.markup_unit_price);
            } else if (reqItem && reqItem.markup_pct) {
                // Per-item percentage
                markupPrice = parseFloat(dbItem.unit_price) * (1 + parseFloat(reqItem.markup_pct) / 100);
            } else if (bulkPct > 0) {
                // Bulk percentage
                markupPrice = parseFloat(dbItem.unit_price) * (1 + bulkPct / 100);
            } else {
                continue; // No markup specified for this item
            }

            markupPrice = Math.round(markupPrice * 100) / 100;
            const markupLineTotal = markupPrice * parseFloat(dbItem.quantity);
            markupSubtotal += markupLineTotal;
            await pool.query(
                'UPDATE painter_estimate_items SET markup_unit_price = ?, markup_line_total = ? WHERE id = ?',
                [markupPrice, markupLineTotal, dbItem.id]
            );
        }

        // Prices already include GST — no separate GST calculation
        const markupGrandTotal = markupSubtotal;

        await pool.query(
            `UPDATE painter_estimates SET markup_subtotal = ?, markup_gst_amount = 0, markup_grand_total = ?,
             status = 'approved', reviewed_by = ?, reviewed_at = NOW() WHERE id = ?`,
            [markupSubtotal, markupGrandTotal, req.user.id, estimates[0].id]
        );
        await logEstimateStatusChange(estimates[0].id, estimates[0].status, 'approved', req.user.id, `Markup set${bulkPct > 0 ? ' (' + bulkPct + '%)' : ''} and approved`);

        res.json({ success: true, message: 'Markup prices set and estimate approved', markupGrandTotal });
    } catch (error) {
        console.error('Set markup error:', error);
        res.status(500).json({ success: false, message: 'Failed to set markup prices' });
    }
});

// Admin: approve a customer estimate at painter's base rate only (strip markup).
// The estimate's billing_type flips to 'self' so the points engine (processInvoice)
// awards annual-only points instead of regular + annual. Used when admin decides
// the painter shouldn't earn customer-markup commission for this deal.
router.post('/estimates/:estimateId/approve-as-self', requirePermission('painters', 'estimates'), async (req, res) => {
    try {
        const [estimates] = await pool.query(
            "SELECT * FROM painter_estimates WHERE id = ? AND status IN ('pending_admin','admin_review')",
            [req.params.estimateId]
        );
        if (!estimates.length) {
            return res.status(404).json({ success: false, message: 'Estimate not found or not pending review' });
        }
        // Wipe any existing markup — base rate only, annual points only.
        await pool.query(
            'UPDATE painter_estimate_items SET markup_unit_price = 0, markup_line_total = 0 WHERE estimate_id = ?',
            [estimates[0].id]
        );
        await pool.query(
            `UPDATE painter_estimates
             SET billing_type = 'self',
                 markup_subtotal = 0,
                 markup_gst_amount = 0,
                 markup_grand_total = 0,
                 status = 'approved',
                 reviewed_by = ?,
                 reviewed_at = NOW()
             WHERE id = ?`,
            [req.user.id, estimates[0].id]
        );
        await logEstimateStatusChange(
            estimates[0].id, estimates[0].status, 'approved', req.user.id,
            'Approved as self-billing (base rate only, annual points only)'
        );
        res.json({ success: true, message: 'Approved at base rate — self-billing, annual points only' });
    } catch (error) {
        console.error('Approve-as-self error:', error);
        res.status(500).json({ success: false, message: 'Failed to approve' });
    }
});

// Generate share token + WhatsApp link
router.post('/estimates/:estimateId/share', requirePermission('painters', 'estimates'), async (req, res) => {
    try {
        const [estimates] = await pool.query(
            "SELECT * FROM painter_estimates WHERE id = ? AND billing_type = 'customer' AND status IN ('approved','sent_to_customer')",
            [req.params.estimateId]
        );
        if (!estimates.length) return res.status(404).json({ success: false, message: 'Approved customer estimate not found' });

        const estimate = estimates[0];
        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

        const oldStatus = estimate.status;
        await pool.query(
            "UPDATE painter_estimates SET share_token = ?, share_token_expires_at = ?, status = 'sent_to_customer' WHERE id = ?",
            [token, expiresAt, estimate.id]
        );
        await logEstimateStatusChange(estimate.id, oldStatus, 'sent_to_customer', req.user.id, 'Share link generated for customer');

        const shareUrl = `${req.protocol}://${req.get('host')}/share/painter-estimate/${token}`;
        const waText = `Hi ${estimate.customer_name || 'Customer'},\n\nHere is your paint estimate from Quality Colours:\n${shareUrl}\n\nEstimate #: ${estimate.estimate_number}\nTotal: ₹${parseFloat(estimate.markup_grand_total).toLocaleString('en-IN')}\n\nPlease review and confirm. Thank you!`;
        const waLink = estimate.customer_phone
            ? `https://wa.me/91${estimate.customer_phone.replace(/\D/g, '').slice(-10)}?text=${encodeURIComponent(waText)}`
            : null;

        res.json({ success: true, shareUrl, waLink, token, message: 'Share link generated' });
    } catch (error) {
        console.error('Share estimate error:', error);
        res.status(500).json({ success: false, message: 'Failed to generate share link' });
    }
});

// Admin: Apply discount to customer estimate
router.post('/estimates/:estimateId/discount', requirePermission('painters', 'estimates'), async (req, res) => {
    try {
        const { discount_percentage } = req.body;
        if (!discount_percentage || parseFloat(discount_percentage) <= 0) {
            return res.status(400).json({ success: false, message: 'Discount percentage is required' });
        }

        const [estimates] = await pool.query(
            "SELECT * FROM painter_estimates WHERE id = ? AND status = 'discount_requested'",
            [req.params.estimateId]
        );
        if (!estimates.length) return res.status(404).json({ success: false, message: 'Estimate with discount request not found' });

        const estimate = estimates[0];
        const baseTotal = parseFloat(estimate.markup_grand_total) || parseFloat(estimate.grand_total);
        const pct = parseFloat(discount_percentage);
        const discountAmount = Math.round(baseTotal * (pct / 100) * 100) / 100;
        const finalTotal = Math.round((baseTotal - discountAmount) * 100) / 100;

        await pool.query(
            `UPDATE painter_estimates SET discount_percentage = ?, discount_amount = ?, final_grand_total = ?,
             discount_approved_by = ?, discount_approved_at = NOW(), status = 'final_approved' WHERE id = ?`,
            [pct, discountAmount, finalTotal, req.user.id, estimate.id]
        );
        await logEstimateStatusChange(estimate.id, 'discount_requested', 'final_approved', req.user.id, `Discount ${pct}% applied (₹${discountAmount})`);

        res.json({ success: true, message: `Discount of ${pct}% applied. Final total: ₹${finalTotal}`, finalTotal, discountAmount });
    } catch (error) {
        console.error('Apply discount error:', error);
        res.status(500).json({ success: false, message: 'Failed to apply discount' });
    }
});

// Admin: Approve estimate without discount (skip discount, go straight to final_approved)
router.post('/estimates/:estimateId/approve-final', requirePermission('painters', 'estimates'), async (req, res) => {
    try {
        const [estimates] = await pool.query(
            "SELECT * FROM painter_estimates WHERE id = ? AND status IN ('approved','sent_to_customer','discount_requested')",
            [req.params.estimateId]
        );
        if (!estimates.length) return res.status(404).json({ success: false, message: 'Estimate not found' });

        const estimate = estimates[0];
        const finalTotal = parseFloat(estimate.markup_grand_total) || parseFloat(estimate.grand_total);

        await pool.query(
            `UPDATE painter_estimates SET final_grand_total = ?, status = 'final_approved',
             discount_approved_by = ?, discount_approved_at = NOW() WHERE id = ?`,
            [finalTotal, req.user.id, estimate.id]
        );
        await logEstimateStatusChange(estimate.id, estimate.status, 'final_approved', req.user.id, 'Final approved (no discount)');

        res.json({ success: true, message: 'Estimate final approved' });
    } catch (error) {
        console.error('Approve final error:', error);
        res.status(500).json({ success: false, message: 'Failed to approve estimate' });
    }
});

// Admin: Confirm painter-submitted payment
router.post('/estimates/:estimateId/confirm-payment', requirePermission('painters', 'estimates'), async (req, res) => {
    try {
        const [estimates] = await pool.query(
            `SELECT pe.*, p.full_name as painter_name, p.phone as painter_phone
             FROM painter_estimates pe JOIN painters p ON pe.painter_id = p.id
             WHERE pe.id = ? AND pe.status = 'payment_submitted'`,
            [req.params.estimateId]
        );
        if (!estimates.length) return res.status(404).json({ success: false, message: 'No pending payment to confirm' });

        const estimate = estimates[0];
        await pool.query(
            "UPDATE painter_estimates SET status = 'payment_recorded', payment_recorded_by = ?, payment_recorded_at = NOW() WHERE id = ?",
            [req.user.id, estimate.id]
        );
        await logEstimateStatusChange(estimate.id, 'payment_submitted', 'payment_recorded', req.user.id, 'Payment confirmed by admin');

        // Award painter loyalty points on payment confirmation
        let pointsResult = { regularPoints: 0, annualPoints: 0 };
        try {
            const [items] = await pool.query(
                'SELECT zoho_item_id, quantity, line_total FROM painter_estimate_items WHERE estimate_id = ? AND deleted_at IS NULL',
                [estimate.id]
            );
            const invoiceForPoints = {
                invoice_id: `EST-${estimate.id}`,
                invoice_number: estimate.estimate_number || `EST-${estimate.id}`,
                date: new Date().toISOString().split('T')[0],
                total: parseFloat(estimate.final_grand_total) || parseFloat(estimate.markup_grand_total) || parseFloat(estimate.grand_total) || 0,
                line_items: items.map(i => ({
                    item_id: i.zoho_item_id,
                    quantity: parseFloat(i.quantity),
                    item_total: parseFloat(i.line_total)
                }))
            };
            pointsResult = await pointsEngine.processInvoice(estimate.painter_id, invoiceForPoints, estimate.billing_type, req.user.id);
            if (pointsResult && !pointsResult.alreadyProcessed) {
                await pool.query(
                    'UPDATE painter_estimates SET points_awarded = ?, regular_points_awarded = ?, annual_points_awarded = ? WHERE id = ?',
                    [(pointsResult.regularPoints || 0) + (pointsResult.annualPoints || 0),
                     pointsResult.regularPoints || 0, pointsResult.annualPoints || 0, estimate.id]
                );
                console.log(`[Points] Confirm-payment: painter ${estimate.painter_id}, estimate ${estimate.id}, regular=${pointsResult.regularPoints}, annual=${pointsResult.annualPoints}`);
                // Notify painter about points
                const totalPts = (pointsResult.regularPoints || 0) + (pointsResult.annualPoints || 0);
                if (totalPts > 0) {
                    const parts = [];
                    if (pointsResult.regularPoints > 0) parts.push(`${pointsResult.regularPoints} regular`);
                    if (pointsResult.annualPoints > 0) parts.push(`${pointsResult.annualPoints.toFixed(2)} annual`);
                    painterNotificationService.sendToPainter(estimate.painter_id, {
                        type: 'points_earned',
                        title: 'Points Earned!',
                        body: `You earned ${parts.join(' + ')} points for estimate #${estimate.estimate_number || estimate.id}.`,
                        data: { estimate_id: String(estimate.id), points: String(totalPts) }
                    }).catch(e => console.error('Points notification error:', e.message));
                }
            }
        } catch (ptsErr) {
            console.error('Points award on confirm-payment (non-fatal):', ptsErr.message);
        }

        // Auto-create slab-based incentive on payment confirmation
        try {
            const customerPhone = estimate.customer_phone || estimate.painter_phone;
            const customerName = estimate.customer_name || estimate.painter_name;
            const estimateTotal = parseFloat(estimate.final_grand_total) || parseFloat(estimate.markup_grand_total) || parseFloat(estimate.grand_total) || 0;

            let leadMatch = null;
            if (customerPhone) {
                const [leads] = await pool.query(
                    `SELECT l.id, l.assigned_to, l.lead_type, l.customer_id FROM leads l
                     WHERE l.status = 'won' AND l.lead_type IS NOT NULL AND l.customer_id IS NOT NULL AND l.phone = ?
                     ORDER BY l.converted_at DESC LIMIT 1`, [customerPhone]
                );
                if (leads.length > 0) leadMatch = leads[0];
            }
            if (!leadMatch && customerName) {
                const [leads] = await pool.query(
                    `SELECT l.id, l.assigned_to, l.lead_type, l.customer_id FROM leads l
                     WHERE l.status = 'won' AND l.lead_type IS NOT NULL AND l.customer_id IS NOT NULL AND l.name = ?
                     ORDER BY l.converted_at DESC LIMIT 1`, [customerName]
                );
                if (leads.length > 0) leadMatch = leads[0];
            }

            if (leadMatch && leadMatch.assigned_to) {
                const [existingInc] = await pool.query(
                    'SELECT id FROM staff_incentives WHERE lead_id = ? AND estimate_id = ?', [leadMatch.id, estimate.id]
                );
                if (existingInc.length === 0) {
                    const [incEnabled] = await pool.query("SELECT config_value FROM ai_config WHERE config_key = 'incentive_enabled'");
                    if (!incEnabled.length || incEnabled[0].config_value === 'true') {
                        const [slabEnabled] = await pool.query("SELECT config_value FROM ai_config WHERE config_key = 'incentive_slab_enabled'");
                        const useSlabs = slabEnabled.length > 0 && slabEnabled[0].config_value === 'true';

                        let incAmount = 0;
                        if (useSlabs && estimateTotal > 0) {
                            const [slabs] = await pool.query(
                                'SELECT incentive_amount FROM incentive_slabs WHERE is_active = 1 AND min_amount <= ? AND max_amount >= ? LIMIT 1',
                                [estimateTotal, estimateTotal]
                            );
                            if (slabs.length > 0) incAmount = parseFloat(slabs[0].incentive_amount);
                        }
                        if (incAmount === 0) {
                            const [flatConfig] = await pool.query("SELECT config_value FROM ai_config WHERE config_key = 'incentive_per_conversion'");
                            incAmount = flatConfig.length > 0 ? parseFloat(flatConfig[0].config_value) || 500 : 500;
                        }

                        const [autoApprove] = await pool.query("SELECT config_value FROM ai_config WHERE config_key = 'incentive_auto_approve'");
                        const autoApproveVal = autoApprove.length > 0 && autoApprove[0].config_value === 'true';
                        const now = new Date();
                        const incMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

                        await pool.query(
                            `INSERT INTO staff_incentives (user_id, lead_id, customer_id, lead_type, incentive_month, amount, estimate_id, estimate_amount, source, status, notes)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'auto_estimate', ?, ?)`,
                            [leadMatch.assigned_to, leadMatch.id, leadMatch.customer_id, leadMatch.lead_type,
                             incMonth, incAmount, estimate.id, estimateTotal,
                             autoApproveVal ? 'approved' : 'pending',
                             `Payment confirmed: Estimate #${estimate.estimate_number}`]
                        );
                        console.log(`[Incentive] Confirm-payment: staff ${leadMatch.assigned_to}, estimate ${estimate.id}, ₹${incAmount}`);
                        // Notify staff
                        try {
                            await notificationService.send(leadMatch.assigned_to, {
                                type: 'incentive_earned',
                                title: 'Incentive Earned!',
                                body: `You earned ₹${incAmount} incentive for estimate #${estimate.estimate_number} (${autoApproveVal ? 'auto-approved' : 'pending approval'})`,
                                data: { page: 'my-incentives' }
                            });
                        } catch (nErr) { console.error('Incentive notification error:', nErr.message); }
                    }
                }
            }
        } catch (incErr) {
            console.error('Auto-incentive on confirm-payment (non-fatal):', incErr);
        }

        res.json({ success: true, message: 'Payment confirmed' });
    } catch (error) {
        console.error('Confirm payment error:', error);
        res.status(500).json({ success: false, message: 'Failed to confirm payment' });
    }
});

// Record payment (admin — directly confirmed, no painter step needed)
router.post('/estimates/:estimateId/payment', requirePermission('painters', 'estimates'), async (req, res) => {
    try {
        const { payment_method, payment_reference, payment_amount } = req.body;
        if (!payment_method) return res.status(400).json({ success: false, message: 'Payment method is required' });

        const [estimates] = await pool.query(
            "SELECT * FROM painter_estimates WHERE id = ? AND status IN ('approved','sent_to_customer','final_approved','payment_submitted')",
            [req.params.estimateId]
        );
        if (!estimates.length) return res.status(404).json({ success: false, message: 'Estimate not found' });

        const estimate = estimates[0];
        const previousPaid = parseFloat(estimate.payment_amount) || 0;
        const effectiveTotal = parseFloat(estimate.final_grand_total) || parseFloat(estimate.markup_grand_total) || parseFloat(estimate.grand_total);
        const amount = parseFloat(payment_amount) || (effectiveTotal - previousPaid);
        const totalPaid = previousPaid > 0 ? previousPaid + amount : amount;

        await pool.query(
            `UPDATE painter_estimates SET status = 'payment_recorded', payment_method = ?, payment_reference = ?,
             payment_amount = ?, payment_recorded_by = ?, payment_recorded_at = NOW() WHERE id = ?`,
            [payment_method, payment_reference || null, totalPaid, req.user.id, estimate.id]
        );
        await logEstimateStatusChange(estimate.id, estimate.status, 'payment_recorded', req.user.id, `Payment: ${payment_method} ₹${amount}${payment_reference ? ' ref:' + payment_reference : ''}`);

        res.json({ success: true, message: 'Payment recorded' });
    } catch (error) {
        console.error('Record payment error:', error);
        res.status(500).json({ success: false, message: 'Failed to record payment' });
    }
});

// Push to Zoho + award points
router.post('/estimates/:estimateId/push-zoho', requirePermission('painters', 'estimates'), async (req, res) => {
    try {
        const [estimates] = await pool.query(
            `SELECT pe.*, p.full_name as painter_name, p.phone as painter_phone, p.zoho_contact_id as painter_zoho_contact_id
             FROM painter_estimates pe JOIN painters p ON pe.painter_id = p.id
             WHERE pe.id = ? AND pe.status = 'payment_recorded'`,
            [req.params.estimateId]
        );
        if (!estimates.length) return res.status(404).json({ success: false, message: 'Payment-recorded estimate not found' });

        const estimate = estimates[0];
        const [items] = await pool.query('SELECT * FROM painter_estimate_items WHERE estimate_id = ? AND deleted_at IS NULL ORDER BY display_order', [estimate.id]);

        // 1. Resolve Zoho contact
        let zohoContactId;
        if (estimate.billing_type === 'self') {
            // Use painter's Zoho contact
            zohoContactId = estimate.painter_zoho_contact_id;
            if (!zohoContactId) {
                try {
                    const contactRes = await zohoAPI.createContact({
                        contact_name: estimate.painter_name,
                        contact_type: 'customer',
                        phone: estimate.painter_phone
                    });
                    if (contactRes && contactRes.contact) {
                        zohoContactId = contactRes.contact.contact_id;
                        await pool.query('UPDATE painters SET zoho_contact_id = ? WHERE id = ?', [zohoContactId, estimate.painter_id]);
                    }
                } catch (contactErr) {
                    console.error('Zoho create contact error:', contactErr.message);
                    return res.status(500).json({ success: false, message: 'Failed to create Zoho contact: ' + contactErr.message });
                }
            }
        } else {
            // Customer billing: create contact for customer
            try {
                const contactRes = await zohoAPI.createContact({
                    contact_name: estimate.customer_name,
                    contact_type: 'customer',
                    phone: estimate.customer_phone || undefined
                });
                if (contactRes && contactRes.contact) {
                    zohoContactId = contactRes.contact.contact_id;
                }
            } catch (contactErr) {
                console.error('Zoho create customer contact error:', contactErr.message);
                return res.status(500).json({ success: false, message: 'Failed to create Zoho contact for customer: ' + contactErr.message });
            }
        }

        if (!zohoContactId) {
            return res.status(500).json({ success: false, message: 'Could not resolve Zoho contact ID' });
        }

        // 1b. Credit limit check before invoicing
        try {
            const { checkCreditBeforeInvoice } = require('../credit-limits');
            const creditCheck = await checkCreditBeforeInvoice(pool, zohoContactId, parseFloat(estimate.grand_total));
            if (!creditCheck.allowed) {
                // Log violation
                try {
                    await pool.query(
                        `INSERT INTO credit_limit_violations (zoho_customer_map_id, violation_type, invoice_amount, credit_limit, credit_used, staff_id)
                         VALUES (?, ?, ?, ?, ?, ?)`,
                        [creditCheck.zoho_customer_map_id || null, creditCheck.no_limit_set ? 'no_limit' : 'exceeded',
                         parseFloat(estimate.grand_total), creditCheck.credit_limit || 0, creditCheck.outstanding || 0, req.user.id]
                    );
                } catch (logErr) { console.error('Credit violation log error:', logErr.message); }

                return res.status(403).json({
                    success: false,
                    message: creditCheck.reason,
                    credit_check: creditCheck
                });
            }
        } catch (creditErr) {
            console.error('Credit check error (non-blocking):', creditErr.message);
            // If credit check fails (e.g. table missing), allow the invoice to proceed
        }

        // 2. Create Zoho invoice (use discounted rates if discount was applied)
        const isCustomer = estimate.billing_type === 'customer';
        const hasDiscount = parseFloat(estimate.discount_percentage) > 0;
        const discountMultiplier = hasDiscount ? (1 - parseFloat(estimate.discount_percentage) / 100) : 1;
        const lineItems = items.map(i => {
            let rate = isCustomer ? parseFloat(i.markup_unit_price) : parseFloat(i.unit_price);
            if (isCustomer && hasDiscount) rate = Math.round(rate * discountMultiplier * 100) / 100;
            return { item_id: i.zoho_item_id, quantity: parseFloat(i.quantity), rate };
        });

        let zohoInvoice;
        try {
            const invoiceData = {
                customer_id: zohoContactId,
                date: new Date().toISOString().split('T')[0],
                line_items: lineItems
            };
            zohoInvoice = await zohoAPI.createInvoice(invoiceData);
        } catch (invoiceErr) {
            console.error('Zoho create invoice error:', invoiceErr.message);
            return res.status(500).json({ success: false, message: 'Failed to create Zoho invoice: ' + invoiceErr.message });
        }

        const invoiceId = zohoInvoice?.invoice?.invoice_id || 'unknown';
        const invoiceNumber = zohoInvoice?.invoice?.invoice_number || 'unknown';

        // 3. Award points via pointsEngine (skip if already awarded at confirm-payment)
        let pointsResult = { regularPoints: estimate.regular_points_awarded || 0, annualPoints: estimate.annual_points_awarded || 0 };
        if ((estimate.points_awarded || 0) === 0) {
            try {
                const invoiceForPoints = {
                    // Canonical dedup key for estimate-originated invoices.
                    // Matches the confirm-payment path so a retried push-to-zoho
                    // can't double-award points if confirm-payment partially succeeded.
                    invoice_id: `EST-${estimate.id}`,
                    invoice_number: invoiceNumber || estimate.estimate_number || `EST-${estimate.id}`,
                    // Points at push time = credit purchase (not yet paid) — link
                    // the Zoho invoice so the credit overdue check (M3) can track
                    // its balance until it's actually paid.
                    zoho_invoice_id: invoiceId !== 'unknown' ? invoiceId : null,
                    date: new Date().toISOString().split('T')[0],
                    total: parseFloat(estimate.grand_total),
                    line_items: items.map(i => ({
                        item_id: i.zoho_item_id,
                        quantity: parseFloat(i.quantity),
                        item_total: parseFloat(i.line_total)
                    }))
                };
                pointsResult = await pointsEngine.processInvoice(estimate.painter_id, invoiceForPoints, estimate.billing_type, req.user.id);
            } catch (pointsErr) {
                console.error('Points award error:', pointsErr.message);
            }
        } else {
            console.log(`[Points] Push-to-Zoho: skipping — already awarded ${estimate.points_awarded} points at confirm-payment`);
        }

        // 4. Update estimate
        await pool.query(
            `UPDATE painter_estimates SET status = 'pushed_to_zoho', zoho_invoice_id = ?, zoho_invoice_number = ?,
             zoho_contact_id = ?, points_awarded = ?, regular_points_awarded = ?, annual_points_awarded = ? WHERE id = ?`,
            [invoiceId, invoiceNumber, zohoContactId,
             (pointsResult.regularPoints || 0) + (pointsResult.annualPoints || 0),
             pointsResult.regularPoints || 0, pointsResult.annualPoints || 0,
             estimate.id]
        );
        await logEstimateStatusChange(estimate.id, 'payment_recorded', 'pushed_to_zoho', req.user.id, `Zoho invoice: ${invoiceNumber}`);

        // 5. Auto-create staff incentive if this estimate's customer came from a converted lead
        try {
            // Match customer to a converted lead by name+phone
            const customerName = estimate.customer_name || estimate.painter_name;
            const customerPhone = estimate.customer_phone || estimate.painter_phone;
            const estimateTotal = parseFloat(estimate.final_grand_total) || parseFloat(estimate.markup_grand_total) || parseFloat(estimate.grand_total) || 0;

            let leadMatch = null;
            if (customerPhone) {
                const [leads] = await pool.query(
                    `SELECT l.id, l.assigned_to, l.name, l.lead_type, l.customer_id
                     FROM leads l
                     WHERE l.status = 'won' AND l.lead_type IS NOT NULL AND l.customer_id IS NOT NULL
                       AND l.phone = ?
                     ORDER BY l.converted_at DESC LIMIT 1`,
                    [customerPhone]
                );
                if (leads.length > 0) leadMatch = leads[0];
            }
            if (!leadMatch && customerName) {
                const [leads] = await pool.query(
                    `SELECT l.id, l.assigned_to, l.name, l.lead_type, l.customer_id
                     FROM leads l
                     WHERE l.status = 'won' AND l.lead_type IS NOT NULL AND l.customer_id IS NOT NULL
                       AND l.name = ?
                     ORDER BY l.converted_at DESC LIMIT 1`,
                    [customerName]
                );
                if (leads.length > 0) leadMatch = leads[0];
            }

            if (leadMatch && leadMatch.assigned_to) {
                // Allow multiple incentives per lead (different estimates) — check by estimate_id
                const [existingIncentive] = await pool.query(
                    'SELECT id FROM staff_incentives WHERE lead_id = ? AND estimate_id = ?', [leadMatch.id, estimate.id]
                );

                if (existingIncentive.length === 0) {
                    const [incentiveEnabled] = await pool.query(
                        "SELECT config_value FROM ai_config WHERE config_key = 'incentive_enabled'"
                    );
                    const isEnabled = !incentiveEnabled.length || incentiveEnabled[0].config_value === 'true';

                    if (isEnabled) {
                        // Check if slab system is enabled
                        const [slabEnabled] = await pool.query(
                            "SELECT config_value FROM ai_config WHERE config_key = 'incentive_slab_enabled'"
                        );
                        const useSlabs = slabEnabled.length > 0 && slabEnabled[0].config_value === 'true';

                        let incentiveAmount = 0;
                        if (useSlabs && estimateTotal > 0) {
                            // Slab-based lookup
                            const [slabs] = await pool.query(
                                'SELECT incentive_amount FROM incentive_slabs WHERE is_active = 1 AND min_amount <= ? AND max_amount >= ? LIMIT 1',
                                [estimateTotal, estimateTotal]
                            );
                            if (slabs.length > 0) {
                                incentiveAmount = parseFloat(slabs[0].incentive_amount);
                            }
                        }

                        // Fallback to flat rate if no slab match or slabs disabled
                        if (incentiveAmount === 0) {
                            const [incentiveConfig] = await pool.query(
                                "SELECT config_value FROM ai_config WHERE config_key = 'incentive_per_conversion'"
                            );
                            incentiveAmount = incentiveConfig.length > 0 ? parseFloat(incentiveConfig[0].config_value) || 500 : 500;
                        }

                        const [autoApprove] = await pool.query(
                            "SELECT config_value FROM ai_config WHERE config_key = 'incentive_auto_approve'"
                        );
                        const autoApproveVal = autoApprove.length > 0 && autoApprove[0].config_value === 'true';

                        const now = new Date();
                        const incentiveMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

                        await pool.query(
                            `INSERT INTO staff_incentives (user_id, lead_id, customer_id, lead_type, incentive_month, amount, estimate_id, estimate_amount, source, status, notes)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'auto_estimate', ?, ?)`,
                            [leadMatch.assigned_to, leadMatch.id, leadMatch.customer_id, leadMatch.lead_type,
                             incentiveMonth, incentiveAmount, estimate.id, estimateTotal,
                             autoApproveVal ? 'approved' : 'pending',
                             `Payment received: Estimate #${estimate.estimate_number}, Zoho Invoice: ${invoiceNumber}`]
                        );
                        console.log(`[Incentive] Slab-based for staff ${leadMatch.assigned_to}, lead ${leadMatch.id}, estimate ${estimate.id}, total ₹${estimateTotal}, incentive ₹${incentiveAmount}`);
                        // Notify staff
                        try {
                            await notificationService.send(leadMatch.assigned_to, {
                                type: 'incentive_earned',
                                title: 'Incentive Earned!',
                                body: `You earned ₹${incentiveAmount} incentive for estimate #${estimate.estimate_number} (${autoApproveVal ? 'auto-approved' : 'pending approval'})`,
                                data: { page: 'my-incentives' }
                            });
                        } catch (nErr) { console.error('Incentive notification error:', nErr.message); }
                    }
                }
            }
        } catch (incErr) {
            console.error('Auto-incentive on payment error (non-fatal):', incErr);
        }

        res.json({
            success: true,
            message: 'Invoice pushed to Zoho and points awarded',
            zohoInvoiceId: invoiceId,
            zohoInvoiceNumber: invoiceNumber,
            points: pointsResult
        });
    } catch (error) {
        console.error('Push to Zoho error:', error);
        res.status(500).json({ success: false, message: 'Failed to push to Zoho: ' + error.message });
    }
});

// ═══════════════════════════════════════════════════════════════
// ADMIN ENDPOINTS FOR NEW FEATURES
// ═══════════════════════════════════════════════════════════════

// List all price reports (admin)
router.get('/admin/price-reports', requireAuth, requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;
        const pg = Number(page);
        const lim = Number(limit);
        let query = `SELECT pr.*, p.full_name as painter_name, p.phone as painter_phone
                     FROM painter_price_reports pr
                     JOIN painters p ON pr.painter_id = p.id WHERE 1=1`;
        const params = [];

        if (status) { query += ' AND pr.status = ?'; params.push(status); }

        const countQuery = query.replace(/SELECT pr\.\*, .*? FROM/, 'SELECT COUNT(*) as total FROM');
        const [countResult] = await pool.query(countQuery, params);
        const total = countResult[0].total;

        query += ' ORDER BY pr.created_at DESC LIMIT ? OFFSET ?';
        params.push(lim, (pg - 1) * lim);

        const [reports] = await pool.query(query, params);
        res.json({ success: true, reports, total, page: pg, pages: Math.ceil(total / lim) });
    } catch (error) {
        console.error('Admin list price reports error:', error);
        res.status(500).json({ success: false, message: 'Failed to list price reports' });
    }
});

// Review price report (admin)
router.put('/admin/price-reports/:id', requireAuth, requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const { status, admin_response, matched_price } = req.body;
        if (!status) return res.status(400).json({ success: false, message: 'Status is required' });

        await pool.query(
            `UPDATE painter_price_reports SET status = ?, admin_response = ?, matched_price = ?, reviewed_by = ?, reviewed_at = NOW()
             WHERE id = ?`,
            [status, admin_response || null, matched_price || null, req.user.id, req.params.id]
        );

        // Notify painter
        try {
            const [report] = await pool.query('SELECT painter_id, product_name FROM painter_price_reports WHERE id = ?', [req.params.id]);
            if (report.length) {
                await painterNotificationService.sendToPainter(report[0].painter_id, {
                    type: 'price_report_reviewed',
                    title: 'Price Report Reviewed',
                    body: `Your price report for "${report[0].product_name}" has been ${status}.${admin_response ? ' ' + admin_response : ''}`,
                    data: { page: 'price-reports' }
                });
            }
        } catch (nErr) { console.error('Price report review notification error:', nErr.message); }

        res.json({ success: true, message: 'Price report updated' });
    } catch (error) {
        console.error('Review price report error:', error);
        res.status(500).json({ success: false, message: 'Failed to review price report' });
    }
});

// List all product requests (admin)
router.get('/admin/product-requests', requireAuth, requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;
        const pg = Number(page);
        const lim = Number(limit);
        let query = `SELECT pr.*, p.full_name as painter_name, p.phone as painter_phone
                     FROM painter_product_requests pr
                     JOIN painters p ON pr.painter_id = p.id WHERE 1=1`;
        const params = [];

        if (status) { query += ' AND pr.status = ?'; params.push(status); }

        const countQuery = query.replace(/SELECT pr\.\*, .*? FROM/, 'SELECT COUNT(*) as total FROM');
        const [countResult] = await pool.query(countQuery, params);
        const total = countResult[0].total;

        query += ' ORDER BY pr.created_at DESC LIMIT ? OFFSET ?';
        params.push(lim, (pg - 1) * lim);

        const [requests] = await pool.query(query, params);
        res.json({ success: true, requests, total, page: pg, pages: Math.ceil(total / lim) });
    } catch (error) {
        console.error('Admin list product requests error:', error);
        res.status(500).json({ success: false, message: 'Failed to list product requests' });
    }
});

// Review product request (admin)
router.put('/admin/product-requests/:id', requireAuth, requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const { status, added_product_id } = req.body;
        if (!status) return res.status(400).json({ success: false, message: 'Status is required' });

        await pool.query(
            `UPDATE painter_product_requests SET status = ?, added_product_id = ?, reviewed_by = ?, reviewed_at = NOW()
             WHERE id = ?`,
            [status, added_product_id || null, req.user.id, req.params.id]
        );

        // Notify painter
        try {
            const [request] = await pool.query('SELECT painter_id, product_name FROM painter_product_requests WHERE id = ?', [req.params.id]);
            if (request.length) {
                await painterNotificationService.sendToPainter(request[0].painter_id, {
                    type: 'product_request_reviewed',
                    title: 'Product Request Update',
                    body: `Your request for "${request[0].product_name}" has been ${status}.`,
                    data: { page: 'product-requests' }
                });
            }
        } catch (nErr) { console.error('Product request review notification error:', nErr.message); }

        res.json({ success: true, message: 'Product request updated' });
    } catch (error) {
        console.error('Review product request error:', error);
        res.status(500).json({ success: false, message: 'Failed to review product request' });
    }
});

// Create weekly challenge (admin)
router.post('/admin/challenges', requireAuth, requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const { title, description, challenge_type, target_value, reward_points, start_date, end_date, icon } = req.body;

        if (!title || !target_value || !reward_points) {
            return res.status(400).json({ success: false, message: 'Title, target value, and reward points are required' });
        }

        const [result] = await pool.query(
            `INSERT INTO painter_challenges (title, description, challenge_type, target_value, reward_points,
             start_date, end_date, icon, is_active, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NOW())`,
            [title, description || null, challenge_type || 'general', target_value, reward_points,
             start_date || new Date().toISOString().split('T')[0], end_date || null, icon || null, req.user.id]
        );

        res.json({ success: true, message: 'Challenge created', id: result.insertId });
    } catch (error) {
        console.error('Create challenge error:', error);
        res.status(500).json({ success: false, message: 'Failed to create challenge' });
    }
});

// Update challenge (admin)
router.put('/admin/challenges/:id', requireAuth, requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const { title, description, challenge_type, target_value, reward_points, start_date, end_date, icon, is_active } = req.body;

        const updates = [];
        const params = [];

        if (title !== undefined) { updates.push('title = ?'); params.push(title); }
        if (description !== undefined) { updates.push('description = ?'); params.push(description); }
        if (challenge_type !== undefined) { updates.push('challenge_type = ?'); params.push(challenge_type); }
        if (target_value !== undefined) { updates.push('target_value = ?'); params.push(target_value); }
        if (reward_points !== undefined) { updates.push('reward_points = ?'); params.push(reward_points); }
        if (start_date !== undefined) { updates.push('start_date = ?'); params.push(start_date); }
        if (end_date !== undefined) { updates.push('end_date = ?'); params.push(end_date); }
        if (icon !== undefined) { updates.push('icon = ?'); params.push(icon); }
        if (is_active !== undefined) { updates.push('is_active = ?'); params.push(is_active ? 1 : 0); }

        if (updates.length === 0) return res.status(400).json({ success: false, message: 'Nothing to update' });

        params.push(req.params.id);
        await pool.query(`UPDATE painter_challenges SET ${updates.join(', ')} WHERE id = ?`, params);

        res.json({ success: true, message: 'Challenge updated' });
    } catch (error) {
        console.error('Update challenge error:', error);
        res.status(500).json({ success: false, message: 'Failed to update challenge' });
    }
});

// ═══════════════════════════════════════════════════════════════
// ADMIN PARAMETERIZED ROUTES (/:id) — MUST be AFTER named routes
// ═══════════════════════════════════════════════════════════════

// GET /api/painters/locations/live — admin fleet view (latest ping per painter)
// IMPORTANT: must stay before router.get('/:id', ...) or 'locations' is parsed as an ID
router.get('/locations/live', requireAuth, requirePermission('painters', 'view'), async (req, res) => {
    try {
        const [online] = await pool.query(`
            SELECT ple.painter_id, p.full_name AS name, p.level, b.name AS branch,
                   ple.latitude, ple.longitude, ple.accuracy_m, ple.recorded_at,
                   TIMESTAMPDIFF(SECOND, ple.recorded_at, NOW()) AS seconds_ago,
                   'online' AS status
            FROM painter_location_events ple
            INNER JOIN (
                SELECT painter_id, MAX(recorded_at) AS latest
                FROM painter_location_events
                WHERE recorded_at >= NOW() - INTERVAL 5 MINUTE
                GROUP BY painter_id
            ) latest_online ON latest_online.painter_id = ple.painter_id AND latest_online.latest = ple.recorded_at
            JOIN painters p ON p.id = ple.painter_id
            LEFT JOIN branches b ON b.id = p.branch_id
            ORDER BY p.full_name
        `);

        const [offline] = await pool.query(`
            SELECT ple.painter_id, p.full_name AS name, p.level, b.name AS branch,
                   ple.latitude, ple.longitude, ple.accuracy_m, ple.recorded_at,
                   TIMESTAMPDIFF(SECOND, ple.recorded_at, NOW()) AS seconds_ago,
                   'offline' AS status
            FROM painter_location_events ple
            INNER JOIN (
                SELECT painter_id, MAX(recorded_at) AS latest
                FROM painter_location_events
                WHERE painter_id NOT IN (
                    SELECT DISTINCT painter_id FROM painter_location_events
                    WHERE recorded_at >= NOW() - INTERVAL 5 MINUTE
                )
                GROUP BY painter_id
            ) latest_offline ON latest_offline.painter_id = ple.painter_id AND latest_offline.latest = ple.recorded_at
            JOIN painters p ON p.id = ple.painter_id
            LEFT JOIN branches b ON b.id = p.branch_id
            ORDER BY p.full_name
        `);

        res.json({ success: true, locations: [...online, ...offline] });
    } catch (e) {
        console.error('locations/live error:', e.message);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// GET /api/painters/:id/locations/history?date=YYYY-MM-DD — admin route replay
router.get('/:id/locations/history', requireAuth, requirePermission('painters', 'view'), async (req, res) => {
    try {
        const painterId = parseInt(req.params.id, 10);
        if (isNaN(painterId) || painterId <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid painter ID' });
        }
        let dateStr = req.query.date;
        if (dateStr && !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
            return res.status(400).json({ success: false, message: 'Invalid date format, use YYYY-MM-DD' });
        }
        if (!dateStr) {
            dateStr = toISTDateString(new Date());
        }

        const [points] = await pool.query(
            `SELECT latitude, longitude, accuracy_m, recorded_at
             FROM painter_location_events
             WHERE painter_id = ?
               AND DATE(CONVERT_TZ(recorded_at, '+00:00', '+05:30')) = ?
             ORDER BY recorded_at ASC`,
            [painterId, dateStr]
        );

        res.json({ success: true, points, date: dateStr, count: points.length });
    } catch (e) {
        console.error('locations/history error:', e.message);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// List all painters
router.get('/', requireAuth, async (req, res) => {
    try {
        const { status, search, page = 1, limit = 50 } = req.query;
        let query = 'SELECT * FROM painters WHERE 1=1';
        const params = [];

        if (status) { query += ' AND status = ?'; params.push(status); }
        if (search) {
            query += ' AND (full_name LIKE ? OR phone LIKE ? OR city LIKE ?)';
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
        const [countResult] = await pool.query(countQuery, params);
        const total = countResult[0].total;

        const sort = req.query.sort || '';
        if (sort === 'interest') {
            query += ' ORDER BY approval_request_count DESC, last_approval_request_at DESC, created_at DESC LIMIT ? OFFSET ?';
        } else {
            query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        }
        const offset = (parseInt(page) - 1) * parseInt(limit);
        params.push(parseInt(limit), offset);

        const [painters] = await pool.query(query, params);
        res.json({ success: true, painters, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
    } catch (error) {
        console.error('List painters error:', error);
        res.status(500).json({ success: false, message: 'Failed to list painters' });
    }
});

// Get painter detail
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const id = req.params.id;
        if (isNaN(id)) return res.status(400).json({ success: false, message: 'Invalid painter ID' });

        const [painters] = await pool.query('SELECT * FROM painters WHERE id = ?', [id]);
        if (!painters.length) return res.status(404).json({ success: false, message: 'Painter not found' });

        const [recentTxns] = await pool.query('SELECT * FROM painter_point_transactions WHERE painter_id = ? ORDER BY created_at DESC LIMIT 20', [id]);

        const [referrer] = await pool.query('SELECT id, full_name, phone FROM painters WHERE id = ?', [painters[0].referred_by]);

        res.json({ success: true, painter: painters[0], recentTransactions: recentTxns, referrer: referrer[0] || null });
    } catch (error) {
        console.error('Get painter error:', error);
        res.status(500).json({ success: false, message: 'Failed to get painter' });
    }
});

// Update painter
router.put('/:id', requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const { full_name, email, phone, city, district, state, pincode, experience_years, specialization, notes, zoho_contact_id, assign_referral_code } = req.body;

        const [beforeRows] = await pool.query(
            'SELECT id, full_name, email, phone, city, district, state, pincode, experience_years, specialization, notes, zoho_contact_id, referred_by FROM painters WHERE id = ?',
            [req.params.id]
        );
        if (!beforeRows.length) return res.status(404).json({ success: false, message: 'Painter not found' });

        // Handle referral code assignment
        if (assign_referral_code) {
            const code = assign_referral_code.trim().toUpperCase();
            const [referrer] = await pool.query('SELECT id FROM painters WHERE referral_code = ? AND status = "approved"', [code]);
            if (!referrer.length) {
                return res.status(400).json({ success: false, message: 'Invalid referral code — no approved painter found with this code' });
            }
            const painterId = parseInt(req.params.id);
            if (referrer[0].id === painterId) {
                return res.status(400).json({ success: false, message: 'Cannot assign own referral code' });
            }
            // Check not already referred
            const [existing] = await pool.query('SELECT id FROM painter_referrals WHERE referred_id = ?', [painterId]);
            if (existing.length) {
                return res.status(400).json({ success: false, message: 'This painter already has a referrer assigned' });
            }
            await pool.query('UPDATE painters SET referred_by = ? WHERE id = ?', [referrer[0].id, painterId]);
            await pool.query('INSERT INTO painter_referrals (referrer_id, referred_id, status) VALUES (?, ?, "active")', [referrer[0].id, painterId]);
        }

        await pool.query(
            `UPDATE painters SET full_name = COALESCE(?, full_name), email = COALESCE(?, email), phone = COALESCE(?, phone),
             city = COALESCE(?, city), district = COALESCE(?, district), state = COALESCE(?, state), pincode = COALESCE(?, pincode),
             experience_years = COALESCE(?, experience_years), specialization = COALESCE(?, specialization),
             notes = COALESCE(?, notes), zoho_contact_id = COALESCE(?, zoho_contact_id),
             card_generated_at = NULL, id_card_generated_at = NULL WHERE id = ?`,
            [full_name, email, phone, city, district, state, pincode, experience_years, specialization, notes, zoho_contact_id, req.params.id]
        );

        const [afterRows] = await pool.query(
            'SELECT id, full_name, email, phone, city, district, state, pincode, experience_years, specialization, notes, zoho_contact_id, referred_by FROM painters WHERE id = ?',
            [req.params.id]
        );
        await audit.record(req, {
            action: 'painter.update',
            entity_type: 'painter',
            entity_id: req.params.id,
            before: beforeRows[0],
            after: afterRows[0],
        });

        res.json({ success: true, message: 'Painter updated' });
    } catch (error) {
        console.error('Update painter error:', error);
        res.status(500).json({ success: false, message: 'Failed to update painter' });
    }
});

// Approve/reject painter
router.put('/:id/approve', requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const { action } = req.body;
        const status = action === 'approve' ? 'approved' : 'rejected';
        const [beforeRows] = await pool.query('SELECT id, status, full_name, phone FROM painters WHERE id = ?', [req.params.id]);
        await pool.query('UPDATE painters SET status = ?, approved_by = ?, approved_at = NOW() WHERE id = ?', [status, req.user.id, req.params.id]);
        await audit.record(req, {
            action: `painter.${status}`,
            entity_type: 'painter',
            entity_id: req.params.id,
            before: beforeRows[0],
            after: { ...beforeRows[0], status, approved_by: req.user.id }
        });

        if (action === 'approve') {
            await pool.query('UPDATE painter_referrals SET status = "active" WHERE referred_id = ?', [req.params.id]);
        }

        // WhatsApp notification to painter
        try {
            const [painters] = await pool.query('SELECT full_name, phone FROM painters WHERE id = ?', [req.params.id]);
            if (painters.length && sessionManager) {
                const p = painters[0];
                const msg = action === 'approve'
                    ? `*Quality Colours Painter Program*\n\nHi ${p.full_name}! Your account has been *approved*. You can now log in to the QC Painters app using your phone number.\n\nWelcome to the Quality Colours family!`
                    : `*Quality Colours Painter Program*\n\nHi ${p.full_name}, unfortunately your account registration was not approved at this time. Please contact us for more information.`;
                await sessionManager.sendMessage(0, p.phone, msg, { source: 'painter_approval' });
            }
        } catch (waErr) { console.error('[painters] approve WhatsApp error:', waErr.message); }

        res.json({ success: true, message: `Painter ${status}` });
    } catch (error) {
        console.error('Approve painter error:', error);
        res.status(500).json({ success: false, message: 'Failed to update status' });
    }
});

// Set credit limit
router.put('/:id/credit', requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const { credit_enabled, credit_limit } = req.body;
        const [beforeRows] = await pool.query('SELECT id, credit_enabled, credit_limit FROM painters WHERE id = ?', [req.params.id]);
        const newEnabled = credit_enabled ? 1 : 0;
        const newLimit = parseFloat(credit_limit) || 0;
        await pool.query('UPDATE painters SET credit_enabled = ?, credit_limit = ? WHERE id = ?',
            [newEnabled, newLimit, req.params.id]);
        await audit.record(req, {
            action: 'painter.credit.set',
            entity_type: 'painter',
            entity_id: req.params.id,
            before: beforeRows[0],
            after: { ...beforeRows[0], credit_enabled: newEnabled, credit_limit: newLimit }
        });
        res.json({ success: true, message: 'Credit settings updated' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update credit' });
    }
});

// Get painter point transactions
router.get('/:id/points/:pool', requireAuth, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        const transactions = await pointsEngine.getLedger(req.params.id, req.params.pool, limit, offset);
        res.json({ success: true, transactions });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to get transactions' });
    }
});

// Manual point adjustment
router.post('/:id/points/adjust', requirePermission('painters', 'points'), async (req, res) => {
    try {
        const { pool: pointPool, amount, description } = req.body;
        if (!pointPool || !amount) return res.status(400).json({ success: false, message: 'Pool and amount required' });

        const amt = parseFloat(amount);
        if (isNaN(amt) || Math.abs(amt) > 100000) {
            return res.status(400).json({ success: false, message: 'Amount out of allowed range' });
        }
        const beforeBalance = await pointsEngine.getBalance(parseInt(req.params.id));
        if (amt > 0) {
            await pointsEngine.addPoints(parseInt(req.params.id), pointPool, amt, 'admin_adjustment', null, null, description || 'Admin adjustment', req.user.id);
        } else if (amt < 0) {
            await pointsEngine.deductPoints(parseInt(req.params.id), pointPool, Math.abs(amt), 'admin_adjustment', null, null, description || 'Admin adjustment', req.user.id);
        }

        const balance = await pointsEngine.getBalance(parseInt(req.params.id));
        await audit.record(req, {
            action: 'painter.points.adjust',
            entity_type: 'painter',
            entity_id: req.params.id,
            before: { pool: pointPool, balance: beforeBalance },
            after: { pool: pointPool, balance, delta: amt, description: description || 'Admin adjustment' }
        });
        res.json({ success: true, message: 'Points adjusted', balance });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

// Get processed invoices for painter
router.get('/:id/invoices', requireAuth, async (req, res) => {
    try {
        const [invoices] = await pool.query('SELECT * FROM painter_invoices_processed WHERE painter_id = ? ORDER BY processed_at DESC', [req.params.id]);
        res.json({ success: true, invoices });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to get invoices' });
    }
});

// Record attendance
router.post('/:id/attendance', requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const { event_type, branch_id, notes, check_in_at } = req.body;
        const [result] = await pool.query(
            'INSERT INTO painter_attendance (painter_id, event_type, branch_id, check_in_at, notes, verified_by) VALUES (?, ?, ?, ?, ?, ?)',
            [req.params.id, event_type || 'store_visit', branch_id || null, check_in_at || new Date(), notes || null, req.user.id]
        );
        const points = await pointsEngine.awardAttendancePoints(parseInt(req.params.id), result.insertId);
        res.json({ success: true, message: `Attendance recorded. ${points} points awarded.`, attendanceId: result.insertId });
    } catch (error) {
        console.error('Record attendance error:', error);
        res.status(500).json({ success: false, message: 'Failed to record attendance' });
    }
});

// ═══════════════════════════════════════════
// ADMIN: VISUALIZATION REQUESTS
// ═══════════════════════════════════════════

// List all visualization requests
router.get('/admin/visualizations', requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const status = req.query.status || '';
        let where = '';
        const params = [];
        if (status) {
            where = 'WHERE vr.status = ?';
            params.push(status);
        }
        const [rows] = await pool.query(
            `SELECT vr.*, p.full_name as painter_name, p.phone as painter_phone, p.city as painter_city
             FROM painter_visualization_requests vr
             JOIN painters p ON p.id = vr.painter_id
             ${where}
             ORDER BY FIELD(vr.status, 'pending', 'in_progress', 'completed', 'rejected'), vr.created_at DESC`,
            params
        );
        res.json({ success: true, visualizations: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to load visualizations' });
    }
});

// Process visualization (update status/notes)
router.put('/admin/visualizations/:id', requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const { status, admin_notes } = req.body;
        const updates = [];
        const params = [];

        if (status) { updates.push('status = ?'); params.push(status); }
        if (admin_notes !== undefined) { updates.push('admin_notes = ?'); params.push(admin_notes); }
        if (status === 'in_progress') { updates.push('processed_by = ?'); params.push(req.user.id); }
        if (status === 'completed') { updates.push('completed_at = NOW()'); }

        if (updates.length === 0) return res.status(400).json({ success: false, message: 'Nothing to update' });

        params.push(req.params.id);
        await pool.query(`UPDATE painter_visualization_requests SET ${updates.join(', ')} WHERE id = ?`, params);

        // Send notification to painter if completed or rejected
        if (status === 'completed' || status === 'rejected') {
            const [req_rows] = await pool.query('SELECT painter_id FROM painter_visualization_requests WHERE id = ?', [req.params.id]);
            if (req_rows.length) {
                try {
                    await painterNotificationService.sendToPainter(req_rows[0].painter_id, {
                        title: status === 'completed' ? 'Visualization Ready!' : 'Visualization Update',
                        body: status === 'completed'
                            ? 'Your color visualization is ready. Open the app to view and share it.'
                            : `Your visualization request was ${status}. ${admin_notes || ''}`,
                        type: 'visualization_' + status
                    });
                } catch (e) { console.error('Notification error:', e.message); }
            }
        }

        res.json({ success: true, message: 'Visualization request updated' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update visualization' });
    }
});

// Upload visualization result image
router.post('/admin/visualizations/:id/upload-result', requirePermission('painters', 'manage'), uploadPainterVisualization.single('visualization'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'Visualization image required' });

        const filename = `viz-result-${req.params.id}-${Date.now()}.jpg`;
        const outputPath = `public/uploads/painter-visualizations/${filename}`;
        await sharp(req.file.buffer)
            .resize(1200, 900, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 90 })
            .toFile(outputPath);

        const vizUrl = `/uploads/painter-visualizations/${filename}`;
        await pool.query(
            'UPDATE painter_visualization_requests SET visualization_path = ?, status = ?, completed_at = NOW(), processed_by = ? WHERE id = ?',
            [vizUrl, 'completed', req.user.id, req.params.id]
        );

        // Notify painter
        const [req_rows] = await pool.query('SELECT painter_id FROM painter_visualization_requests WHERE id = ?', [req.params.id]);
        if (req_rows.length) {
            try {
                await painterNotificationService.sendToPainter(req_rows[0].painter_id, {
                    title: 'Visualization Ready!',
                    body: 'Your color visualization is ready. Open the app to view and share it.',
                    type: 'visualization_completed'
                });
            } catch (e) { console.error('Notification error:', e.message); }
        }

        res.json({ success: true, message: 'Visualization uploaded and completed', url: vizUrl });
    } catch (error) {
        console.error('Visualization upload error:', error);
        res.status(500).json({ success: false, message: 'Failed to upload visualization' });
    }
});

// ═══════════════════════════════════════════════════════════════
// ADMIN PAINTER CATALOG (ordering + visibility)
// ═══════════════════════════════════════════════════════════════
//
// Six tables back this feature:
//   painter_catalog_brand_order    / _category_order    / _product_order
//   painter_catalog_brand_overrides / _category_overrides / _product_overrides
//
// Globals: NOT NULL sort_order + is_hidden. Overrides: nullable columns —
// NULL means "inherit from global". The painter-facing /me/catalog query
// COALESCEs in the order: override → global → (999, 0).

// ----- helpers ----------------------------------------------------------
function _toBool(v) { return v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0; }
function _toNullableBool(v) { return (v === null || v === undefined || v === '') ? null : _toBool(v); }
function _toNullableInt(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
}

// ----- GLOBAL: brands ---------------------------------------------------
router.get('/admin/catalog/brands', requireAuth, requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT b.brand,
                   b.sort_order,
                   b.is_hidden,
                   (SELECT COUNT(DISTINCT p.id)
                      FROM products p
                      JOIN pack_sizes ps ON ps.product_id = p.id AND ps.is_active = 1
                      JOIN zoho_items_map zim ON zim.zoho_item_id = ps.zoho_item_id
                     WHERE p.status = 'active'
                       AND TRIM(zim.zoho_brand) = b.brand) AS product_count
              FROM painter_catalog_brand_order b
             ORDER BY b.sort_order ASC, b.brand ASC
        `);
        res.json({ success: true, brands: rows });
    } catch (e) {
        console.error('GET /admin/catalog/brands:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

router.put('/admin/catalog/brands/order', requireAuth, requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
        if (!items.length) return res.status(400).json({ success: false, message: 'items[] required' });
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            for (const it of items) {
                if (!it.brand) continue;
                await conn.query(
                    `INSERT INTO painter_catalog_brand_order (brand, sort_order, is_hidden)
                     VALUES (?, ?, ?)
                     ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order), is_hidden = VALUES(is_hidden)`,
                    [String(it.brand), parseInt(it.sort_order, 10) || 999, _toBool(it.is_hidden)]
                );
            }
            await conn.commit();
        } catch (e) { await conn.rollback(); throw e; }
        finally { conn.release(); }
        res.json({ success: true, updated: items.length });
    } catch (e) {
        console.error('PUT /admin/catalog/brands/order:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ----- GLOBAL: categories ----------------------------------------------
router.get('/admin/catalog/categories', requireAuth, requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const brand = req.query.brand || null;
        const params = [];
        let where = '';
        if (brand) { where = 'WHERE c.brand = ?'; params.push(brand); }
        const [rows] = await pool.query(`
            SELECT c.brand, c.category, c.sort_order, c.is_hidden,
                   (SELECT COUNT(DISTINCT p.id)
                      FROM products p
                      JOIN pack_sizes ps ON ps.product_id = p.id AND ps.is_active = 1
                      JOIN zoho_items_map zim ON zim.zoho_item_id = ps.zoho_item_id
                     WHERE p.status = 'active'
                       AND TRIM(zim.zoho_brand) = c.brand
                       AND TRIM(zim.zoho_category_name) = c.category) AS product_count
              FROM painter_catalog_category_order c
              ${where}
             ORDER BY c.brand ASC, c.sort_order ASC, c.category ASC
        `, params);
        res.json({ success: true, categories: rows });
    } catch (e) {
        console.error('GET /admin/catalog/categories:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

router.put('/admin/catalog/categories/order', requireAuth, requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
        if (!items.length) return res.status(400).json({ success: false, message: 'items[] required' });
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            for (const it of items) {
                if (!it.brand || !it.category) continue;
                await conn.query(
                    `INSERT INTO painter_catalog_category_order (brand, category, sort_order, is_hidden)
                     VALUES (?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order), is_hidden = VALUES(is_hidden)`,
                    [String(it.brand), String(it.category), parseInt(it.sort_order, 10) || 999, _toBool(it.is_hidden)]
                );
            }
            await conn.commit();
        } catch (e) { await conn.rollback(); throw e; }
        finally { conn.release(); }
        res.json({ success: true, updated: items.length });
    } catch (e) {
        console.error('PUT /admin/catalog/categories/order:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ----- GLOBAL: products -------------------------------------------------
router.get('/admin/catalog/products', requireAuth, requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const { brand, category } = req.query;
        const params = [];
        const filters = [];
        if (brand)    { filters.push('TRIM(zim.zoho_brand) = ?');         params.push(brand); }
        if (category) { filters.push('TRIM(zim.zoho_category_name) = ?'); params.push(category); }
        const where = filters.length ? ('AND ' + filters.join(' AND ')) : '';
        const [rows] = await pool.query(`
            SELECT p.id AS product_id, p.name,
                   MAX(TRIM(zim.zoho_brand))         AS brand,
                   MAX(TRIM(zim.zoho_category_name)) AS category,
                   COALESCE(po.sort_order, 999) AS sort_order,
                   COALESCE(po.is_hidden, 0)    AS is_hidden,
                   COUNT(DISTINCT ps.id) AS variant_count
              FROM products p
              JOIN pack_sizes ps ON ps.product_id = p.id AND ps.is_active = 1
              JOIN zoho_items_map zim ON zim.zoho_item_id = ps.zoho_item_id
                AND (zim.zoho_status = 'active' OR zim.zoho_status IS NULL)
              LEFT JOIN painter_catalog_product_order po ON po.product_id = p.id
             WHERE p.status = 'active'
               ${where}
             GROUP BY p.id, p.name, po.sort_order, po.is_hidden
             ORDER BY brand ASC, category ASC, sort_order ASC, p.name ASC
        `, params);
        res.json({ success: true, products: rows });
    } catch (e) {
        console.error('GET /admin/catalog/products:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

router.put('/admin/catalog/products/order', requireAuth, requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
        if (!items.length) return res.status(400).json({ success: false, message: 'items[] required' });
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            for (const it of items) {
                const pid = parseInt(it.product_id, 10);
                if (!pid) continue;
                await conn.query(
                    `INSERT INTO painter_catalog_product_order (product_id, sort_order, is_hidden)
                     VALUES (?, ?, ?)
                     ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order), is_hidden = VALUES(is_hidden)`,
                    [pid, parseInt(it.sort_order, 10) || 999, _toBool(it.is_hidden)]
                );
            }
            await conn.commit();
        } catch (e) { await conn.rollback(); throw e; }
        finally { conn.release(); }
        res.json({ success: true, updated: items.length });
    } catch (e) {
        console.error('PUT /admin/catalog/products/order:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// ----- PER-PAINTER OVERRIDES -------------------------------------------
// One GET that returns the painter's view of either brands, categories or
// products with both the global value and the painter-specific override.
router.get('/admin/catalog/painters/:id/overrides', requireAuth, requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const painterId = parseInt(req.params.id, 10);
        if (!painterId) return res.status(400).json({ success: false, message: 'invalid painter id' });
        const level = String(req.query.level || 'brand');
        const brand = req.query.brand || null;
        const category = req.query.category || null;

        if (level === 'brand') {
            const [rows] = await pool.query(`
                SELECT g.brand,
                       g.sort_order AS global_sort, g.is_hidden AS global_hidden,
                       o.sort_order AS override_sort, o.is_hidden AS override_hidden
                  FROM painter_catalog_brand_order g
                  LEFT JOIN painter_catalog_brand_overrides o
                    ON o.painter_id = ? AND o.brand = g.brand
                 ORDER BY g.sort_order ASC, g.brand ASC
            `, [painterId]);
            return res.json({ success: true, level, rows });
        }
        if (level === 'category') {
            const params = [painterId];
            let where = '';
            if (brand) { where = 'WHERE g.brand = ?'; params.push(brand); }
            const [rows] = await pool.query(`
                SELECT g.brand, g.category,
                       g.sort_order AS global_sort, g.is_hidden AS global_hidden,
                       o.sort_order AS override_sort, o.is_hidden AS override_hidden
                  FROM painter_catalog_category_order g
                  LEFT JOIN painter_catalog_category_overrides o
                    ON o.painter_id = ? AND o.brand = g.brand AND o.category = g.category
                  ${where}
                 ORDER BY g.brand ASC, g.sort_order ASC, g.category ASC
            `, params);
            return res.json({ success: true, level, rows });
        }
        if (level === 'product') {
            // Products joined to product_order; brand+category come from zim aggregate.
            const params = [painterId];
            const filters = [];
            if (brand)    { filters.push('TRIM(zim.zoho_brand) = ?');         params.push(brand); }
            if (category) { filters.push('TRIM(zim.zoho_category_name) = ?'); params.push(category); }
            const where = filters.length ? ('AND ' + filters.join(' AND ')) : '';
            const [rows] = await pool.query(`
                SELECT p.id AS product_id, p.name,
                       MAX(TRIM(zim.zoho_brand))         AS brand,
                       MAX(TRIM(zim.zoho_category_name)) AS category,
                       COALESCE(g.sort_order, 999) AS global_sort,
                       COALESCE(g.is_hidden, 0)    AS global_hidden,
                       o.sort_order AS override_sort,
                       o.is_hidden  AS override_hidden
                  FROM products p
                  JOIN pack_sizes ps ON ps.product_id = p.id AND ps.is_active = 1
                  JOIN zoho_items_map zim ON zim.zoho_item_id = ps.zoho_item_id
                    AND (zim.zoho_status = 'active' OR zim.zoho_status IS NULL)
                  LEFT JOIN painter_catalog_product_order g ON g.product_id = p.id
                  LEFT JOIN painter_catalog_product_overrides o
                    ON o.painter_id = ? AND o.product_id = p.id
                 WHERE p.status = 'active'
                   ${where}
                 GROUP BY p.id, p.name, g.sort_order, g.is_hidden, o.sort_order, o.is_hidden
                 ORDER BY brand ASC, category ASC, global_sort ASC, p.name ASC
            `, params);
            return res.json({ success: true, level, rows });
        }
        return res.status(400).json({ success: false, message: 'invalid level' });
    } catch (e) {
        console.error('GET /admin/catalog/painters/:id/overrides:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

// PUT bulk save for brand / category / product overrides. NULL means
// "inherit from global"; sending an empty/missing field clears the override
// for that column. Sending neither sort_order nor is_hidden → delete the row.
router.put('/admin/catalog/painters/:id/overrides/:level', requireAuth, requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const painterId = parseInt(req.params.id, 10);
        const level = req.params.level;
        if (!painterId) return res.status(400).json({ success: false, message: 'invalid painter id' });
        if (!['brand','category','product'].includes(level)) return res.status(400).json({ success: false, message: 'invalid level' });
        const items = Array.isArray(req.body && req.body.items) ? req.body.items : [];
        if (!items.length) return res.status(400).json({ success: false, message: 'items[] required' });

        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();
            for (const it of items) {
                const sort   = _toNullableInt(it.sort_order);
                const hidden = _toNullableBool(it.is_hidden);
                const bothNull = (sort === null && hidden === null);

                if (level === 'brand') {
                    if (!it.brand) continue;
                    if (bothNull) {
                        await conn.query(`DELETE FROM painter_catalog_brand_overrides WHERE painter_id = ? AND brand = ?`, [painterId, String(it.brand)]);
                    } else {
                        await conn.query(
                            `INSERT INTO painter_catalog_brand_overrides (painter_id, brand, sort_order, is_hidden)
                             VALUES (?, ?, ?, ?)
                             ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order), is_hidden = VALUES(is_hidden)`,
                            [painterId, String(it.brand), sort, hidden]
                        );
                    }
                } else if (level === 'category') {
                    if (!it.brand || !it.category) continue;
                    if (bothNull) {
                        await conn.query(`DELETE FROM painter_catalog_category_overrides WHERE painter_id = ? AND brand = ? AND category = ?`,
                            [painterId, String(it.brand), String(it.category)]);
                    } else {
                        await conn.query(
                            `INSERT INTO painter_catalog_category_overrides (painter_id, brand, category, sort_order, is_hidden)
                             VALUES (?, ?, ?, ?, ?)
                             ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order), is_hidden = VALUES(is_hidden)`,
                            [painterId, String(it.brand), String(it.category), sort, hidden]
                        );
                    }
                } else { // product
                    const pid = parseInt(it.product_id, 10);
                    if (!pid) continue;
                    if (bothNull) {
                        await conn.query(`DELETE FROM painter_catalog_product_overrides WHERE painter_id = ? AND product_id = ?`, [painterId, pid]);
                    } else {
                        await conn.query(
                            `INSERT INTO painter_catalog_product_overrides (painter_id, product_id, sort_order, is_hidden)
                             VALUES (?, ?, ?, ?)
                             ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order), is_hidden = VALUES(is_hidden)`,
                            [painterId, pid, sort, hidden]
                        );
                    }
                }
            }
            await conn.commit();
        } catch (e) { await conn.rollback(); throw e; }
        finally { conn.release(); }

        res.json({ success: true, updated: items.length });
    } catch (e) {
        console.error('PUT /admin/catalog/painters/:id/overrides/:level:', e);
        res.status(500).json({ success: false, message: e.message });
    }
});

module.exports = { router, setPool, setSessionManager };
