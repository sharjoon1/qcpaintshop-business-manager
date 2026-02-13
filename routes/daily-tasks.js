/**
 * Daily Mandatory Tasks Routes
 * Staff complete daily checklist items with photo proof
 * Admin manages templates and reviews submissions
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const sharp = require('sharp');
const fs = require('fs');
const { requireAuth, requirePermission } = require('../middleware/permissionMiddleware');

let pool;
function setPool(p) { pool = p; }

// Photo upload config
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, '..', 'public', 'uploads', 'daily-tasks');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const uniqueName = `${req.user.id}_${Date.now()}_${Math.round(Math.random() * 1E9)}`;
        cb(null, uniqueName + path.extname(file.originalname));
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png|webp/;
        const ext = allowed.test(path.extname(file.originalname).toLowerCase());
        const mime = allowed.test(file.mimetype);
        cb(null, ext && mime);
    }
});

// ========================================
// STAFF ENDPOINTS
// ========================================

// GET /today - Templates for user's role + existing responses for today
router.get('/today', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const today = new Date().toISOString().split('T')[0];

        // Get user role
        const [users] = await pool.query('SELECT role FROM users WHERE id = ?', [userId]);
        const userRole = users[0]?.role || 'staff';

        // Get active templates
        const [templates] = await pool.query(
            'SELECT * FROM daily_task_templates WHERE is_active = TRUE ORDER BY sort_order'
        );

        // Filter by role
        const filtered = templates.filter(t => {
            try {
                const roles = typeof t.roles === 'string' ? JSON.parse(t.roles) : t.roles;
                return !roles || roles.length === 0 || roles.includes(userRole);
            } catch { return true; }
        });

        // Get today's responses
        const [responses] = await pool.query(
            'SELECT * FROM daily_task_responses WHERE user_id = ? AND task_date = ?',
            [userId, today]
        );

        // Get materials for responses
        const responseIds = responses.map(r => r.id).filter(Boolean);
        let materials = [];
        if (responseIds.length > 0) {
            [materials] = await pool.query(
                'SELECT * FROM daily_task_materials WHERE response_id IN (?)',
                [responseIds]
            );
        }

        // Get submission status
        const [submissions] = await pool.query(
            'SELECT * FROM daily_task_submissions WHERE user_id = ? AND task_date = ?',
            [userId, today]
        );

        // Parse JSON fields
        const parsedTemplates = filtered.map(t => ({
            ...t,
            detail_fields: typeof t.detail_fields === 'string' ? JSON.parse(t.detail_fields || '[]') : (t.detail_fields || []),
            roles: typeof t.roles === 'string' ? JSON.parse(t.roles || '[]') : (t.roles || [])
        }));

        const parsedResponses = responses.map(r => ({
            ...r,
            details: typeof r.details === 'string' ? JSON.parse(r.details || '{}') : (r.details || {}),
            photos: typeof r.photos === 'string' ? JSON.parse(r.photos || '[]') : (r.photos || [])
        }));

        res.json({
            success: true,
            data: {
                templates: parsedTemplates,
                responses: parsedResponses,
                materials,
                submission: submissions[0] || null,
                date: today
            }
        });
    } catch (error) {
        console.error('Error loading daily tasks:', error);
        res.status(500).json({ success: false, error: 'Failed to load daily tasks' });
    }
});

// POST /respond/:templateId - Upsert response
router.post('/respond/:templateId', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const templateId = parseInt(req.params.templateId);
        const today = new Date().toISOString().split('T')[0];
        const { answer, reason, details } = req.body;

        // Validate template exists
        const [templates] = await pool.query('SELECT * FROM daily_task_templates WHERE id = ? AND is_active = TRUE', [templateId]);
        if (templates.length === 0) {
            return res.status(404).json({ success: false, error: 'Template not found' });
        }

        // Upsert response
        await pool.query(`
            INSERT INTO daily_task_responses (user_id, task_date, template_id, answer, reason, details)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                answer = VALUES(answer),
                reason = VALUES(reason),
                details = VALUES(details),
                updated_at = CURRENT_TIMESTAMP
        `, [userId, today, templateId, answer || null, reason || null, details ? JSON.stringify(details) : null]);

        res.json({ success: true, message: 'Response saved' });
    } catch (error) {
        console.error('Error saving response:', error);
        res.status(500).json({ success: false, error: 'Failed to save response' });
    }
});

// POST /upload-photo - Upload photo proof
router.post('/upload-photo', requireAuth, upload.single('photo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No photo uploaded' });
        }

        const userId = req.user.id;
        const templateId = parseInt(req.body.template_id);
        const today = new Date().toISOString().split('T')[0];

        // Compress with sharp
        const compressedName = `compressed_${req.file.filename}`;
        const compressedPath = path.join(req.file.destination, compressedName);

        await sharp(req.file.path)
            .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toFile(compressedPath);

        // Remove original, rename compressed
        fs.unlinkSync(req.file.path);
        const finalName = req.file.filename.replace(path.extname(req.file.filename), '.jpg');
        const finalPath = path.join(req.file.destination, finalName);
        fs.renameSync(compressedPath, finalPath);

        const photoUrl = `/uploads/daily-tasks/${finalName}`;

        // Update response photos array
        const [existing] = await pool.query(
            'SELECT id, photos FROM daily_task_responses WHERE user_id = ? AND task_date = ? AND template_id = ?',
            [userId, today, templateId]
        );

        if (existing.length > 0) {
            let photos = [];
            try {
                photos = typeof existing[0].photos === 'string' ? JSON.parse(existing[0].photos || '[]') : (existing[0].photos || []);
            } catch { photos = []; }
            photos.push(photoUrl);
            await pool.query('UPDATE daily_task_responses SET photos = ? WHERE id = ?', [JSON.stringify(photos), existing[0].id]);
        } else {
            // Create response with just the photo
            await pool.query(
                'INSERT INTO daily_task_responses (user_id, task_date, template_id, photos) VALUES (?, ?, ?, ?)',
                [userId, today, templateId, JSON.stringify([photoUrl])]
            );
        }

        res.json({ success: true, photo_url: photoUrl });
    } catch (error) {
        console.error('Error uploading photo:', error);
        res.status(500).json({ success: false, error: 'Failed to upload photo' });
    }
});

// POST /material/:responseId - Add material vendor entry
router.post('/material/:responseId', requireAuth, async (req, res) => {
    try {
        const responseId = parseInt(req.params.responseId);
        const { vendor_name, bill_on_zoho, notes } = req.body;

        if (!vendor_name) {
            return res.status(400).json({ success: false, error: 'Vendor name is required' });
        }

        // Verify response belongs to user
        const [responses] = await pool.query(
            'SELECT id FROM daily_task_responses WHERE id = ? AND user_id = ?',
            [responseId, req.user.id]
        );
        if (responses.length === 0) {
            return res.status(404).json({ success: false, error: 'Response not found' });
        }

        const [result] = await pool.query(
            'INSERT INTO daily_task_materials (response_id, vendor_name, bill_on_zoho, notes) VALUES (?, ?, ?, ?)',
            [responseId, vendor_name, bill_on_zoho || false, notes || null]
        );

        res.json({ success: true, id: result.insertId });
    } catch (error) {
        console.error('Error adding material:', error);
        res.status(500).json({ success: false, error: 'Failed to add material entry' });
    }
});

// POST /material/:id/photo - Upload material photo
router.post('/material/:id/photo', requireAuth, upload.single('photo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No photo uploaded' });
        }

        const materialId = parseInt(req.params.id);

        // Compress
        const compressedName = `compressed_${req.file.filename}`;
        const compressedPath = path.join(req.file.destination, compressedName);

        await sharp(req.file.path)
            .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toFile(compressedPath);

        fs.unlinkSync(req.file.path);
        const finalName = req.file.filename.replace(path.extname(req.file.filename), '.jpg');
        const finalPath = path.join(req.file.destination, finalName);
        fs.renameSync(compressedPath, finalPath);

        const photoUrl = `/uploads/daily-tasks/${finalName}`;

        await pool.query('UPDATE daily_task_materials SET photo_url = ? WHERE id = ?', [photoUrl, materialId]);

        res.json({ success: true, photo_url: photoUrl });
    } catch (error) {
        console.error('Error uploading material photo:', error);
        res.status(500).json({ success: false, error: 'Failed to upload photo' });
    }
});

// DELETE /material/:id - Remove material entry
router.delete('/material/:id', requireAuth, async (req, res) => {
    try {
        const materialId = parseInt(req.params.id);

        // Verify ownership via join
        const [rows] = await pool.query(`
            SELECT m.id FROM daily_task_materials m
            JOIN daily_task_responses r ON m.response_id = r.id
            WHERE m.id = ? AND r.user_id = ?
        `, [materialId, req.user.id]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Material entry not found' });
        }

        await pool.query('DELETE FROM daily_task_materials WHERE id = ?', [materialId]);
        res.json({ success: true, message: 'Material entry removed' });
    } catch (error) {
        console.error('Error deleting material:', error);
        res.status(500).json({ success: false, error: 'Failed to delete material entry' });
    }
});

// POST /submit-day - Mark day complete
router.post('/submit-day', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const today = new Date().toISOString().split('T')[0];

        // Count templates for user's role
        const [users] = await pool.query('SELECT role FROM users WHERE id = ?', [userId]);
        const userRole = users[0]?.role || 'staff';

        const [templates] = await pool.query('SELECT * FROM daily_task_templates WHERE is_active = TRUE');
        const filtered = templates.filter(t => {
            try {
                const roles = typeof t.roles === 'string' ? JSON.parse(t.roles) : t.roles;
                return !roles || roles.length === 0 || roles.includes(userRole);
            } catch { return true; }
        });

        // Count responses
        const [responses] = await pool.query(
            'SELECT COUNT(*) as count FROM daily_task_responses WHERE user_id = ? AND task_date = ? AND answer IS NOT NULL',
            [userId, today]
        );

        const totalTasks = filtered.length;
        const completedTasks = responses[0].count;

        await pool.query(`
            INSERT INTO daily_task_submissions (user_id, task_date, total_tasks, completed_tasks)
            VALUES (?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                total_tasks = VALUES(total_tasks),
                completed_tasks = VALUES(completed_tasks),
                submitted_at = CURRENT_TIMESTAMP
        `, [userId, today, totalTasks, completedTasks]);

        res.json({ success: true, message: 'Daily report submitted', total: totalTasks, completed: completedTasks });
    } catch (error) {
        console.error('Error submitting day:', error);
        res.status(500).json({ success: false, error: 'Failed to submit daily report' });
    }
});

// GET /history - Past submissions
router.get('/history', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const limit = parseInt(req.query.limit) || 30;

        const [submissions] = await pool.query(
            'SELECT * FROM daily_task_submissions WHERE user_id = ? ORDER BY task_date DESC LIMIT ?',
            [userId, limit]
        );

        res.json({ success: true, data: submissions });
    } catch (error) {
        console.error('Error loading history:', error);
        res.status(500).json({ success: false, error: 'Failed to load history' });
    }
});

// GET /status - Today's completion status (for dashboard card)
router.get('/status', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const today = new Date().toISOString().split('T')[0];

        // Get user role
        const [users] = await pool.query('SELECT role FROM users WHERE id = ?', [userId]);
        const userRole = users[0]?.role || 'staff';

        // Count applicable templates
        const [templates] = await pool.query('SELECT * FROM daily_task_templates WHERE is_active = TRUE');
        const filtered = templates.filter(t => {
            try {
                const roles = typeof t.roles === 'string' ? JSON.parse(t.roles) : t.roles;
                return !roles || roles.length === 0 || roles.includes(userRole);
            } catch { return true; }
        });

        // Count responses
        const [responses] = await pool.query(
            'SELECT COUNT(*) as count FROM daily_task_responses WHERE user_id = ? AND task_date = ? AND answer IS NOT NULL',
            [userId, today]
        );

        // Check if submitted
        const [submissions] = await pool.query(
            'SELECT * FROM daily_task_submissions WHERE user_id = ? AND task_date = ?',
            [userId, today]
        );

        res.json({
            success: true,
            data: {
                total: filtered.length,
                completed: responses[0].count,
                submitted: submissions.length > 0
            }
        });
    } catch (error) {
        console.error('Error loading status:', error);
        res.status(500).json({ success: false, error: 'Failed to load status' });
    }
});

// ========================================
// ADMIN ENDPOINTS
// ========================================

// GET /templates - List all templates
router.get('/templates', requirePermission('tasks', 'view'), async (req, res) => {
    try {
        const [templates] = await pool.query('SELECT * FROM daily_task_templates ORDER BY sort_order');
        const parsed = templates.map(t => ({
            ...t,
            detail_fields: typeof t.detail_fields === 'string' ? JSON.parse(t.detail_fields || '[]') : (t.detail_fields || []),
            roles: typeof t.roles === 'string' ? JSON.parse(t.roles || '[]') : (t.roles || [])
        }));
        res.json({ success: true, data: parsed });
    } catch (error) {
        console.error('Error loading templates:', error);
        res.status(500).json({ success: false, error: 'Failed to load templates' });
    }
});

// POST /templates - Create template
router.post('/templates', requirePermission('tasks', 'add'), async (req, res) => {
    try {
        const { section, title, description, task_type, detail_fields, roles, photo_required, sort_order } = req.body;

        if (!section || !title || !task_type) {
            return res.status(400).json({ success: false, error: 'Section, title, and task type are required' });
        }

        const [result] = await pool.query(
            `INSERT INTO daily_task_templates (section, title, description, task_type, detail_fields, roles, photo_required, sort_order, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [section, title, description || null, task_type,
             detail_fields ? JSON.stringify(detail_fields) : null,
             roles ? JSON.stringify(roles) : '["staff","manager"]',
             photo_required || false,
             sort_order || 0,
             req.user.id]
        );

        res.json({ success: true, id: result.insertId, message: 'Template created' });
    } catch (error) {
        console.error('Error creating template:', error);
        res.status(500).json({ success: false, error: 'Failed to create template' });
    }
});

// PUT /templates/:id - Update template
router.put('/templates/:id', requirePermission('tasks', 'edit'), async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const { section, title, description, task_type, detail_fields, roles, photo_required, sort_order, is_active } = req.body;

        await pool.query(
            `UPDATE daily_task_templates SET
                section = COALESCE(?, section),
                title = COALESCE(?, title),
                description = COALESCE(?, description),
                task_type = COALESCE(?, task_type),
                detail_fields = COALESCE(?, detail_fields),
                roles = COALESCE(?, roles),
                photo_required = COALESCE(?, photo_required),
                sort_order = COALESCE(?, sort_order),
                is_active = COALESCE(?, is_active)
             WHERE id = ?`,
            [section || null, title || null, description, task_type || null,
             detail_fields ? JSON.stringify(detail_fields) : null,
             roles ? JSON.stringify(roles) : null,
             photo_required !== undefined ? photo_required : null,
             sort_order !== undefined ? sort_order : null,
             is_active !== undefined ? is_active : null,
             id]
        );

        res.json({ success: true, message: 'Template updated' });
    } catch (error) {
        console.error('Error updating template:', error);
        res.status(500).json({ success: false, error: 'Failed to update template' });
    }
});

// DELETE /templates/:id - Soft-delete (set is_active=false)
router.delete('/templates/:id', requirePermission('tasks', 'delete'), async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        await pool.query('UPDATE daily_task_templates SET is_active = FALSE WHERE id = ?', [id]);
        res.json({ success: true, message: 'Template deactivated' });
    } catch (error) {
        console.error('Error deleting template:', error);
        res.status(500).json({ success: false, error: 'Failed to delete template' });
    }
});

// GET /admin/responses - View staff responses (filtered by date/user/branch)
router.get('/admin/responses', requirePermission('tasks', 'view'), async (req, res) => {
    try {
        const date = req.query.date || new Date().toISOString().split('T')[0];
        const userId = req.query.user_id;

        let query = `
            SELECT r.*, t.title as template_title, t.section, t.task_type, t.photo_required,
                   u.full_name as user_name, u.username
            FROM daily_task_responses r
            JOIN daily_task_templates t ON r.template_id = t.id
            JOIN users u ON r.user_id = u.id
            WHERE r.task_date = ?
        `;
        const params = [date];

        if (userId) {
            query += ' AND r.user_id = ?';
            params.push(parseInt(userId));
        }

        query += ' ORDER BY u.full_name, t.sort_order';

        const [responses] = await pool.query(query, params);

        // Get materials
        const responseIds = responses.map(r => r.id);
        let materials = [];
        if (responseIds.length > 0) {
            [materials] = await pool.query(
                'SELECT * FROM daily_task_materials WHERE response_id IN (?)',
                [responseIds]
            );
        }

        // Parse JSON fields
        const parsed = responses.map(r => ({
            ...r,
            details: typeof r.details === 'string' ? JSON.parse(r.details || '{}') : (r.details || {}),
            photos: typeof r.photos === 'string' ? JSON.parse(r.photos || '[]') : (r.photos || []),
            materials: materials.filter(m => m.response_id === r.id)
        }));

        res.json({ success: true, data: parsed });
    } catch (error) {
        console.error('Error loading admin responses:', error);
        res.status(500).json({ success: false, error: 'Failed to load responses' });
    }
});

// GET /admin/summary - Completion stats per day
router.get('/admin/summary', requirePermission('tasks', 'view'), async (req, res) => {
    try {
        const date = req.query.date || new Date().toISOString().split('T')[0];

        const [submissions] = await pool.query(`
            SELECT s.*, u.full_name as user_name, u.username
            FROM daily_task_submissions s
            JOIN users u ON s.user_id = u.id
            WHERE s.task_date = ?
            ORDER BY u.full_name
        `, [date]);

        // Get all staff who should have submitted
        const [allStaff] = await pool.query(
            "SELECT id, full_name, username, role FROM users WHERE role IN ('staff', 'manager') AND status = 'active'"
        );

        const submittedIds = submissions.map(s => s.user_id);
        const notSubmitted = allStaff.filter(s => !submittedIds.includes(s.id));

        res.json({
            success: true,
            data: {
                submitted: submissions,
                not_submitted: notSubmitted,
                date
            }
        });
    } catch (error) {
        console.error('Error loading summary:', error);
        res.status(500).json({ success: false, error: 'Failed to load summary' });
    }
});

module.exports = {
    router,
    setPool
};
