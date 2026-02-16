/**
 * WEBSITE CONTENT MANAGEMENT ROUTES
 * Public endpoints for landing page + Admin CRUD for all website content
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { requirePermission, requireAuth } = require('../middleware/permissionMiddleware');

let pool;
function setPool(dbPool) { pool = dbPool; }

// Upload config for website images
const websiteStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/uploads/website/'),
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'web-' + uniqueName + path.extname(file.originalname));
    }
});

const uploadWebsite = multer({
    storage: websiteStorage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files allowed'));
        }
    }
});

// ========================================
// PUBLIC ENDPOINTS (no auth)
// ========================================

/**
 * GET /api/website/content
 * Returns ALL website content in one call for the landing page
 */
router.get('/content', async (req, res) => {
    try {
        const [services, features, testimonials, gallery, settingsRows] = await Promise.all([
            pool.query('SELECT id, title, title_tamil, description, description_tamil, icon, sort_order FROM website_services WHERE status = ? ORDER BY sort_order, id', ['active']),
            pool.query('SELECT id, title, title_tamil, description, description_tamil, icon, color, sort_order FROM website_features WHERE status = ? ORDER BY sort_order, id', ['active']),
            pool.query('SELECT id, customer_name, customer_role, customer_photo, testimonial_text, testimonial_text_tamil, rating FROM website_testimonials WHERE status = ? ORDER BY sort_order, id', ['active']),
            pool.query('SELECT id, image_url, caption, category FROM website_gallery WHERE status = ? ORDER BY sort_order, id', ['active']),
            pool.query("SELECT setting_key, setting_value FROM settings WHERE setting_key LIKE 'hero_%' OR setting_key LIKE 'about_%' OR setting_key LIKE 'footer_%' OR setting_key LIKE 'social_%' OR setting_key LIKE 'design_request_%'")
        ]);

        const settings = {};
        settingsRows[0].forEach(r => { settings[r.setting_key] = r.setting_value; });

        res.json({
            success: true,
            data: {
                settings,
                services: services[0],
                features: features[0],
                testimonials: testimonials[0],
                gallery: gallery[0]
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/website/gallery
 * Gallery images with optional category filter
 */
router.get('/gallery', async (req, res) => {
    try {
        const { category } = req.query;
        let query = 'SELECT id, image_url, caption, category FROM website_gallery WHERE status = ?';
        const params = ['active'];
        if (category && category !== 'all') {
            query += ' AND category = ?';
            params.push(category);
        }
        query += ' ORDER BY sort_order, id';
        const [rows] = await pool.query(query, params);
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ========================================
// ADMIN ENDPOINTS (require settings.manage)
// ========================================

// --- SERVICES CRUD ---
router.get('/services', requirePermission('settings', 'manage'), async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM website_services ORDER BY sort_order, id');
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/services', requirePermission('settings', 'manage'), async (req, res) => {
    try {
        const { title, title_tamil, description, description_tamil, icon, sort_order } = req.body;
        if (!title) return res.status(400).json({ success: false, error: 'Title is required' });
        const [result] = await pool.query(
            'INSERT INTO website_services (title, title_tamil, description, description_tamil, icon, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
            [title, title_tamil || null, description || null, description_tamil || null, icon || 'paint-brush', sort_order || 0]
        );
        res.json({ success: true, id: result.insertId });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.put('/services/:id', requirePermission('settings', 'manage'), async (req, res) => {
    try {
        const { title, title_tamil, description, description_tamil, icon, sort_order, status } = req.body;
        await pool.query(
            'UPDATE website_services SET title=?, title_tamil=?, description=?, description_tamil=?, icon=?, sort_order=?, status=? WHERE id=?',
            [title, title_tamil || null, description || null, description_tamil || null, icon || 'paint-brush', sort_order || 0, status || 'active', req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.delete('/services/:id', requirePermission('settings', 'manage'), async (req, res) => {
    try {
        await pool.query('DELETE FROM website_services WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- FEATURES CRUD ---
router.get('/features', requirePermission('settings', 'manage'), async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM website_features ORDER BY sort_order, id');
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/features', requirePermission('settings', 'manage'), async (req, res) => {
    try {
        const { title, title_tamil, description, description_tamil, icon, color, sort_order } = req.body;
        if (!title) return res.status(400).json({ success: false, error: 'Title is required' });
        const [result] = await pool.query(
            'INSERT INTO website_features (title, title_tamil, description, description_tamil, icon, color, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [title, title_tamil || null, description || null, description_tamil || null, icon || 'check-circle', color || 'green', sort_order || 0]
        );
        res.json({ success: true, id: result.insertId });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.put('/features/:id', requirePermission('settings', 'manage'), async (req, res) => {
    try {
        const { title, title_tamil, description, description_tamil, icon, color, sort_order, status } = req.body;
        await pool.query(
            'UPDATE website_features SET title=?, title_tamil=?, description=?, description_tamil=?, icon=?, color=?, sort_order=?, status=? WHERE id=?',
            [title, title_tamil || null, description || null, description_tamil || null, icon || 'check-circle', color || 'green', sort_order || 0, status || 'active', req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.delete('/features/:id', requirePermission('settings', 'manage'), async (req, res) => {
    try {
        await pool.query('DELETE FROM website_features WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- TESTIMONIALS CRUD ---
router.get('/testimonials', requirePermission('settings', 'manage'), async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM website_testimonials ORDER BY sort_order, id');
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/testimonials', requirePermission('settings', 'manage'), async (req, res) => {
    try {
        const { customer_name, customer_role, customer_photo, testimonial_text, testimonial_text_tamil, rating, sort_order } = req.body;
        if (!customer_name || !testimonial_text) return res.status(400).json({ success: false, error: 'Name and testimonial text are required' });
        const [result] = await pool.query(
            'INSERT INTO website_testimonials (customer_name, customer_role, customer_photo, testimonial_text, testimonial_text_tamil, rating, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [customer_name, customer_role || null, customer_photo || null, testimonial_text, testimonial_text_tamil || null, rating || 5, sort_order || 0]
        );
        res.json({ success: true, id: result.insertId });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.put('/testimonials/:id', requirePermission('settings', 'manage'), async (req, res) => {
    try {
        const { customer_name, customer_role, customer_photo, testimonial_text, testimonial_text_tamil, rating, sort_order, status } = req.body;
        await pool.query(
            'UPDATE website_testimonials SET customer_name=?, customer_role=?, customer_photo=?, testimonial_text=?, testimonial_text_tamil=?, rating=?, sort_order=?, status=? WHERE id=?',
            [customer_name, customer_role || null, customer_photo || null, testimonial_text, testimonial_text_tamil || null, rating || 5, sort_order || 0, status || 'active', req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.delete('/testimonials/:id', requirePermission('settings', 'manage'), async (req, res) => {
    try {
        await pool.query('DELETE FROM website_testimonials WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- GALLERY CRUD ---
router.get('/gallery-admin', requirePermission('settings', 'manage'), async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM website_gallery ORDER BY sort_order, id');
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/gallery-admin', requirePermission('settings', 'manage'), async (req, res) => {
    try {
        const { image_url, caption, category, sort_order } = req.body;
        if (!image_url) return res.status(400).json({ success: false, error: 'Image URL is required' });
        const [result] = await pool.query(
            'INSERT INTO website_gallery (image_url, caption, category, sort_order) VALUES (?, ?, ?, ?)',
            [image_url, caption || null, category || 'general', sort_order || 0]
        );
        res.json({ success: true, id: result.insertId });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.put('/gallery-admin/:id', requirePermission('settings', 'manage'), async (req, res) => {
    try {
        const { image_url, caption, category, sort_order, status } = req.body;
        await pool.query(
            'UPDATE website_gallery SET image_url=?, caption=?, category=?, sort_order=?, status=? WHERE id=?',
            [image_url, caption || null, category || 'general', sort_order || 0, status || 'active', req.params.id]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.delete('/gallery-admin/:id', requirePermission('settings', 'manage'), async (req, res) => {
    try {
        const { id } = req.params;
        // Get image path to delete file
        const [rows] = await pool.query('SELECT image_url FROM website_gallery WHERE id = ?', [id]);
        if (rows.length && rows[0].image_url && rows[0].image_url.startsWith('/uploads/')) {
            const filePath = path.join(__dirname, '..', 'public', rows[0].image_url);
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        }
        await pool.query('DELETE FROM website_gallery WHERE id = ?', [id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- SETTINGS (bulk update) ---
router.put('/settings', requirePermission('settings', 'manage'), async (req, res) => {
    try {
        const { settings } = req.body;
        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({ success: false, error: 'Settings object is required' });
        }

        const allowedKeys = [
            'hero_title', 'hero_title_tamil', 'hero_subtitle', 'hero_subtitle_tamil',
            'hero_cta1_text', 'hero_cta1_link', 'hero_cta2_text', 'hero_cta2_link',
            'about_title', 'about_title_tamil', 'about_description', 'about_description_tamil',
            'design_request_response_time',
            'footer_tagline', 'footer_tagline_tamil',
            'social_whatsapp', 'social_instagram', 'social_facebook', 'social_youtube'
        ];

        for (const [key, value] of Object.entries(settings)) {
            if (!allowedKeys.includes(key)) continue;
            const [existing] = await pool.query('SELECT id FROM settings WHERE setting_key = ?', [key]);
            if (existing.length) {
                await pool.query('UPDATE settings SET setting_value = ? WHERE setting_key = ?', [value || '', key]);
            } else {
                await pool.query('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?)', [key, value || '']);
            }
        }

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- IMAGE UPLOAD ---
router.post('/upload', requirePermission('settings', 'manage'), uploadWebsite.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, error: 'No image uploaded' });

        // Compress with sharp
        const inputPath = req.file.path;
        const outputFilename = 'web-' + Date.now() + '-' + Math.round(Math.random() * 1E9) + '.jpg';
        const outputPath = path.join('public/uploads/website/', outputFilename);

        await sharp(inputPath)
            .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toFile(outputPath);

        // Delete original if different
        if (inputPath !== outputPath) {
            fs.unlinkSync(inputPath);
        }

        const imageUrl = '/uploads/website/' + outputFilename;
        res.json({ success: true, url: imageUrl });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = { router, setPool };
