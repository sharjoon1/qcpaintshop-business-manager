/**
 * GUIDES/DOCUMENTATION MODULE ROUTES
 * Handles guide management, categories, views, favorites, analytics
 */

const express = require('express');
const router = express.Router();
const { requirePermission, requireAuth } = require('../middleware/permissionMiddleware');

let pool;
function setPool(dbPool) { pool = dbPool; }

// Helper: generate slug from title
function slugify(text) {
    return text.toString().toLowerCase().trim()
        .replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-').replace(/-+/g, '-').substring(0, 200);
}

// ========================================
// CATEGORIES
// ========================================

/** GET /api/guides/categories - List all categories */
router.get('/categories', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT c.*, COUNT(g.id) as guide_count
             FROM guide_categories c
             LEFT JOIN guides g ON c.id = g.category_id AND g.status = 'published'
             WHERE c.status = 'active'
             GROUP BY c.id
             ORDER BY c.sort_order ASC, c.name ASC`
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Get categories error:', error);
        res.status(500).json({ success: false, message: 'Failed to get categories' });
    }
});

/** POST /api/guides/categories - Create category (admin) */
router.post('/categories', requirePermission('settings', 'manage'), async (req, res) => {
    try {
        const { name, name_ta, icon, sort_order } = req.body;
        if (!name) return res.status(400).json({ success: false, message: 'Name is required' });

        const [result] = await pool.query(
            'INSERT INTO guide_categories (name, name_ta, icon, sort_order) VALUES (?, ?, ?, ?)',
            [name, name_ta || null, icon || '📄', sort_order || 0]
        );
        res.json({ success: true, message: 'Category created', data: { id: result.insertId } });
    } catch (error) {
        console.error('Create category error:', error);
        res.status(500).json({ success: false, message: 'Failed to create category' });
    }
});

/** PUT /api/guides/categories/:id - Update category (admin) */
router.put('/categories/:id', requirePermission('settings', 'manage'), async (req, res) => {
    try {
        const { name, name_ta, icon, sort_order, status } = req.body;
        await pool.query(
            `UPDATE guide_categories SET name = COALESCE(?, name), name_ta = COALESCE(?, name_ta),
             icon = COALESCE(?, icon), sort_order = COALESCE(?, sort_order), status = COALESCE(?, status)
             WHERE id = ?`,
            [name, name_ta, icon, sort_order, status, req.params.id]
        );
        res.json({ success: true, message: 'Category updated' });
    } catch (error) {
        console.error('Update category error:', error);
        res.status(500).json({ success: false, message: 'Failed to update category' });
    }
});

/** DELETE /api/guides/categories/:id - Delete category (admin) */
router.delete('/categories/:id', requirePermission('settings', 'manage'), async (req, res) => {
    try {
        // Set guides in this category to uncategorized
        await pool.query('UPDATE guides SET category_id = NULL WHERE category_id = ?', [req.params.id]);
        await pool.query('DELETE FROM guide_categories WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Category deleted' });
    } catch (error) {
        console.error('Delete category error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete category' });
    }
});

// ========================================
// GUIDES - ADMIN
// ========================================

/** GET /api/guides - List guides (with filters) */
router.get('/', requireAuth, async (req, res) => {
    try {
        const { category_id, status, language, search, staff_view } = req.query;
        const isStaff = req.user.role === 'staff';

        let query = `
            SELECT g.*, c.name as category_name, c.name_ta as category_name_ta, c.icon as category_icon,
                   u.full_name as author_name
            FROM guides g
            LEFT JOIN guide_categories c ON g.category_id = c.id
            LEFT JOIN users u ON g.author_id = u.id
            WHERE 1=1
        `;
        const params = [];

        // Staff can only see published + visible guides
        if (isStaff || staff_view === '1') {
            query += " AND g.status = 'published' AND g.visible_to_staff = 1";
        }

        if (category_id) { query += ' AND g.category_id = ?'; params.push(category_id); }
        if (status && !isStaff) { query += ' AND g.status = ?'; params.push(status); }
        if (language) { query += " AND (g.language = ? OR g.language = 'both')"; params.push(language); }
        if (search) {
            query += ' AND (g.title LIKE ? OR g.title_ta LIKE ? OR g.summary LIKE ? OR g.summary_ta LIKE ?)';
            const s = `%${search}%`;
            params.push(s, s, s, s);
        }

        query += ' ORDER BY g.updated_at DESC';

        const [rows] = await pool.query(query, params);

        // For staff, also get their favorites
        if (isStaff || staff_view === '1') {
            const guideIds = rows.map(r => r.id);
            if (guideIds.length > 0) {
                const [favs] = await pool.query(
                    'SELECT guide_id FROM guide_favorites WHERE user_id = ? AND guide_id IN (?)',
                    [req.user.id, guideIds]
                );
                const favSet = new Set(favs.map(f => f.guide_id));
                rows.forEach(r => { r.is_favorite = favSet.has(r.id); });
            }
        }

        // Don't send full content in list view
        rows.forEach(r => { r.content_en = undefined; r.content_ta = undefined; });

        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('List guides error:', error);
        res.status(500).json({ success: false, message: 'Failed to list guides' });
    }
});

/** GET /api/guides/:id - Get single guide */
router.get('/:id', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT g.*, c.name as category_name, c.name_ta as category_name_ta, c.icon as category_icon,
                    u.full_name as author_name
             FROM guides g
             LEFT JOIN guide_categories c ON g.category_id = c.id
             LEFT JOIN users u ON g.author_id = u.id
             WHERE g.id = ?`,
            [req.params.id]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Guide not found' });
        }

        const guide = rows[0];

        // Check staff access
        if (req.user.role === 'staff' && (guide.status !== 'published' || !guide.visible_to_staff)) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        // Check if favorited
        const [favCheck] = await pool.query(
            'SELECT id FROM guide_favorites WHERE guide_id = ? AND user_id = ?',
            [guide.id, req.user.id]
        );
        guide.is_favorite = favCheck.length > 0;

        // Record view (insert, don't update)
        try {
            await pool.query(
                'INSERT INTO guide_views (guide_id, user_id) VALUES (?, ?)',
                [guide.id, req.user.id]
            );
            await pool.query('UPDATE guides SET view_count = view_count + 1 WHERE id = ?', [guide.id]);
        } catch (e) { /* ignore view tracking errors */ }

        res.json({ success: true, data: guide });
    } catch (error) {
        console.error('Get guide error:', error);
        res.status(500).json({ success: false, message: 'Failed to get guide' });
    }
});

/** POST /api/guides - Create guide (admin) */
router.post('/', requirePermission('settings', 'manage'), async (req, res) => {
    try {
        const { category_id, title, title_ta, content_en, content_ta, summary, summary_ta,
                language, content_type, status, visible_to_staff } = req.body;

        if (!title) return res.status(400).json({ success: false, message: 'Title is required' });

        const slug = slugify(title) + '-' + Date.now().toString(36);

        const [result] = await pool.query(
            `INSERT INTO guides (category_id, title, title_ta, slug, content_en, content_ta,
             summary, summary_ta, language, content_type, status, visible_to_staff, author_id, version)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [category_id || null, title, title_ta || null, slug,
             content_en || null, content_ta || null, summary || null, summary_ta || null,
             language || 'both', content_type || 'rich_text', status || 'draft',
             visible_to_staff !== undefined ? visible_to_staff : 1, req.user.id]
        );

        res.json({ success: true, message: 'Guide created', data: { id: result.insertId, slug } });
    } catch (error) {
        console.error('Create guide error:', error);
        res.status(500).json({ success: false, message: 'Failed to create guide' });
    }
});

/** PUT /api/guides/:id - Update guide (admin) */
router.put('/:id', requirePermission('settings', 'manage'), async (req, res) => {
    try {
        const { category_id, title, title_ta, content_en, content_ta, summary, summary_ta,
                language, content_type, status, visible_to_staff, change_summary } = req.body;

        // Get current version for history
        const [current] = await pool.query('SELECT * FROM guides WHERE id = ?', [req.params.id]);
        if (current.length === 0) {
            return res.status(404).json({ success: false, message: 'Guide not found' });
        }

        const guide = current[0];
        const newVersion = guide.version + 1;

        // Save version history
        await pool.query(
            `INSERT INTO guide_versions (guide_id, version, title, title_ta, content_en, content_ta, changed_by, change_summary)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [guide.id, guide.version, guide.title, guide.title_ta, guide.content_en, guide.content_ta,
             req.user.id, change_summary || 'Updated']
        );

        // Update guide
        const updates = [];
        const params = [];

        if (category_id !== undefined) { updates.push('category_id = ?'); params.push(category_id || null); }
        if (title !== undefined) { updates.push('title = ?'); params.push(title); }
        if (title_ta !== undefined) { updates.push('title_ta = ?'); params.push(title_ta); }
        if (content_en !== undefined) { updates.push('content_en = ?'); params.push(content_en); }
        if (content_ta !== undefined) { updates.push('content_ta = ?'); params.push(content_ta); }
        if (summary !== undefined) { updates.push('summary = ?'); params.push(summary); }
        if (summary_ta !== undefined) { updates.push('summary_ta = ?'); params.push(summary_ta); }
        if (language !== undefined) { updates.push('language = ?'); params.push(language); }
        if (content_type !== undefined) { updates.push('content_type = ?'); params.push(content_type); }
        if (status !== undefined) { updates.push('status = ?'); params.push(status); }
        if (visible_to_staff !== undefined) { updates.push('visible_to_staff = ?'); params.push(visible_to_staff); }

        updates.push('version = ?');
        params.push(newVersion);
        params.push(req.params.id);

        await pool.query(`UPDATE guides SET ${updates.join(', ')} WHERE id = ?`, params);

        res.json({ success: true, message: 'Guide updated', version: newVersion });
    } catch (error) {
        console.error('Update guide error:', error);
        res.status(500).json({ success: false, message: 'Failed to update guide' });
    }
});

/** DELETE /api/guides/:id - Delete guide (admin) */
router.delete('/:id', requirePermission('settings', 'manage'), async (req, res) => {
    try {
        await pool.query('DELETE FROM guides WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Guide deleted' });
    } catch (error) {
        console.error('Delete guide error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete guide' });
    }
});

// ========================================
// FAVORITES
// ========================================

/** POST /api/guides/:id/favorite - Toggle favorite */
router.post('/:id/favorite', requireAuth, async (req, res) => {
    try {
        const [existing] = await pool.query(
            'SELECT id FROM guide_favorites WHERE guide_id = ? AND user_id = ?',
            [req.params.id, req.user.id]
        );

        if (existing.length > 0) {
            await pool.query('DELETE FROM guide_favorites WHERE id = ?', [existing[0].id]);
            res.json({ success: true, favorited: false, message: 'Removed from favorites' });
        } else {
            await pool.query(
                'INSERT INTO guide_favorites (guide_id, user_id) VALUES (?, ?)',
                [req.params.id, req.user.id]
            );
            res.json({ success: true, favorited: true, message: 'Added to favorites' });
        }
    } catch (error) {
        console.error('Toggle favorite error:', error);
        res.status(500).json({ success: false, message: 'Failed to toggle favorite' });
    }
});

// ========================================
// ANALYTICS (Admin)
// ========================================

/** GET /api/guides/admin/analytics - Guide analytics */
router.get('/admin/analytics', requirePermission('settings', 'view'), async (req, res) => {
    try {
        // Overall stats
        const [totalGuides] = await pool.query("SELECT COUNT(*) as total FROM guides");
        const [published] = await pool.query("SELECT COUNT(*) as total FROM guides WHERE status = 'published'");
        const [totalViews] = await pool.query("SELECT COUNT(*) as total FROM guide_views");
        const [uniqueReaders] = await pool.query("SELECT COUNT(DISTINCT user_id) as total FROM guide_views");

        // Most viewed guides
        const [popular] = await pool.query(
            `SELECT g.id, g.title, g.title_ta, g.view_count, c.name as category_name
             FROM guides g
             LEFT JOIN guide_categories c ON g.category_id = c.id
             ORDER BY g.view_count DESC LIMIT 10`
        );

        // Recent views
        const [recentViews] = await pool.query(
            `SELECT gv.viewed_at, g.title, u.full_name
             FROM guide_views gv
             JOIN guides g ON gv.guide_id = g.id
             JOIN users u ON gv.user_id = u.id
             ORDER BY gv.viewed_at DESC LIMIT 20`
        );

        // Staff read counts
        const [staffReads] = await pool.query(
            `SELECT u.id, u.full_name, COUNT(DISTINCT gv.guide_id) as guides_read,
                    COUNT(gv.id) as total_views
             FROM users u
             LEFT JOIN guide_views gv ON u.id = gv.user_id
             WHERE u.role = 'staff' AND u.status = 'active'
             GROUP BY u.id
             ORDER BY guides_read DESC`
        );

        // Guide version history
        const [versions] = await pool.query(
            `SELECT gv.*, g.title as guide_title, u.full_name as changed_by_name
             FROM guide_versions gv
             JOIN guides g ON gv.guide_id = g.id
             LEFT JOIN users u ON gv.changed_by = u.id
             ORDER BY gv.created_at DESC LIMIT 20`
        );

        res.json({
            success: true,
            data: {
                stats: {
                    total_guides: totalGuides[0].total,
                    published: published[0].total,
                    total_views: totalViews[0].total,
                    unique_readers: uniqueReaders[0].total
                },
                popular_guides: popular,
                recent_views: recentViews,
                staff_reads: staffReads,
                version_history: versions
            }
        });
    } catch (error) {
        console.error('Analytics error:', error);
        res.status(500).json({ success: false, message: 'Failed to get analytics' });
    }
});

module.exports = { router, setPool };
