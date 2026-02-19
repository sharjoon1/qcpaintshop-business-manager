/**
 * STOCK CHECK ASSIGNMENT MODULE ROUTES
 * Daily physical stock verification — admin assigns items to staff,
 * staff submits counts with optional photo proof, admin reviews & adjusts.
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { requirePermission, requireAuth } = require('../middleware/permissionMiddleware');
const notificationService = require('../services/notification-service');

let pool;
function setPool(dbPool) { pool = dbPool; }

// Photo upload via memory storage (compressed with sharp before saving)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Only image files allowed'));
    }
});

// Ensure upload dir exists
const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'stock-check');

// ========================================
// ADMIN: CREATE ASSIGNMENT
// ========================================

/** POST /api/stock-check/assign — Admin creates stock check assignment */
router.post('/assign', requirePermission('zoho', 'stock_check'), async (req, res) => {
    try {
        const { branch_id, staff_id, check_date, item_ids, show_system_qty, notes } = req.body;

        if (!branch_id || !staff_id || !check_date || !item_ids || !item_ids.length) {
            return res.status(400).json({ success: false, message: 'branch_id, staff_id, check_date, and item_ids are required' });
        }

        // Get branch zoho_location_id
        const [branches] = await pool.query('SELECT id, name as branch_name, zoho_location_id FROM branches WHERE id = ?', [branch_id]);
        if (!branches.length) return res.status(404).json({ success: false, message: 'Branch not found' });
        const branch = branches[0];

        if (!branch.zoho_location_id) {
            return res.status(400).json({ success: false, message: 'Branch has no linked Zoho location. Link it in Zoho Locations first.' });
        }

        // Create assignment
        const [result] = await pool.query(
            `INSERT INTO stock_check_assignments (branch_id, staff_id, check_date, show_system_qty, notes, created_by)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [branch_id, staff_id, check_date, show_system_qty ? 1 : 0, notes || null, req.user.id]
        );
        const assignmentId = result.insertId;

        // Fetch system quantities from zoho_location_stock cache
        const placeholders = item_ids.map(() => '?').join(',');
        const [stockRows] = await pool.query(
            `SELECT zoho_item_id, item_name, sku, stock_on_hand
             FROM zoho_location_stock
             WHERE zoho_item_id IN (${placeholders}) AND zoho_location_id = ?`,
            [...item_ids, branch.zoho_location_id]
        );

        const stockMap = {};
        stockRows.forEach(r => { stockMap[r.zoho_item_id] = r; });

        // Insert items
        for (const itemId of item_ids) {
            const stock = stockMap[itemId] || {};
            await pool.query(
                `INSERT INTO stock_check_items (assignment_id, zoho_item_id, item_name, item_sku, system_qty)
                 VALUES (?, ?, ?, ?, ?)`,
                [assignmentId, itemId, stock.item_name || 'Unknown', stock.sku || '', stock.stock_on_hand || 0]
            );
        }

        // Notify staff
        try {
            await notificationService.send(staff_id, {
                type: 'stock_check_assigned',
                title: 'Stock Check Assigned',
                body: `You have a stock check for ${branch.branch_name} on ${check_date} (${item_ids.length} items)`,
                data: { assignment_id: assignmentId }
            });
        } catch (e) { console.error('Stock check notification error:', e.message); }

        res.json({ success: true, message: 'Assignment created', data: { id: assignmentId, items: item_ids.length } });
    } catch (error) {
        console.error('Create stock check assignment error:', error);
        res.status(500).json({ success: false, message: 'Failed to create assignment' });
    }
});

// ========================================
// ADMIN: LIST ASSIGNMENTS
// ========================================

/** GET /api/stock-check/assignments — List assignments with filters */
router.get('/assignments', requirePermission('zoho', 'stock_check'), async (req, res) => {
    try {
        const { branch_id, staff_id, status, from_date, to_date, page = 1, limit = 25 } = req.query;
        let where = 'WHERE 1=1';
        const params = [];

        if (branch_id) { where += ' AND a.branch_id = ?'; params.push(branch_id); }
        if (staff_id) { where += ' AND a.staff_id = ?'; params.push(staff_id); }
        if (status) { where += ' AND a.status = ?'; params.push(status); }
        if (from_date) { where += ' AND a.check_date >= ?'; params.push(from_date); }
        if (to_date) { where += ' AND a.check_date <= ?'; params.push(to_date); }

        const offset = (parseInt(page) - 1) * parseInt(limit);

        const [countResult] = await pool.query(
            `SELECT COUNT(*) as total FROM stock_check_assignments a ${where}`, params
        );

        const [rows] = await pool.query(
            `SELECT a.*, b.name as branch_name, u.full_name as staff_name,
                    creator.full_name as created_by_name,
                    reviewer.full_name as reviewed_by_name,
                    (SELECT COUNT(*) FROM stock_check_items WHERE assignment_id = a.id) as item_count,
                    (SELECT COUNT(*) FROM stock_check_items WHERE assignment_id = a.id AND difference != 0 AND difference IS NOT NULL) as discrepancy_count
             FROM stock_check_assignments a
             LEFT JOIN branches b ON a.branch_id = b.id
             LEFT JOIN users u ON a.staff_id = u.id
             LEFT JOIN users creator ON a.created_by = creator.id
             LEFT JOIN users reviewer ON a.reviewed_by = reviewer.id
             ${where}
             ORDER BY a.check_date DESC, a.created_at DESC
             LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), offset]
        );

        res.json({
            success: true,
            data: rows,
            pagination: { total: countResult[0].total, page: parseInt(page), limit: parseInt(limit) }
        });
    } catch (error) {
        console.error('List assignments error:', error);
        res.status(500).json({ success: false, message: 'Failed to list assignments' });
    }
});

// ========================================
// SINGLE ASSIGNMENT DETAIL
// ========================================

/** GET /api/stock-check/assignments/:id — Single assignment detail */
router.get('/assignments/:id', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT a.*, b.name as branch_name, u.full_name as staff_name,
                    creator.full_name as created_by_name,
                    reviewer.full_name as reviewed_by_name
             FROM stock_check_assignments a
             LEFT JOIN branches b ON a.branch_id = b.id
             LEFT JOIN users u ON a.staff_id = u.id
             LEFT JOIN users creator ON a.created_by = creator.id
             LEFT JOIN users reviewer ON a.reviewed_by = reviewer.id
             WHERE a.id = ?`,
            [req.params.id]
        );

        if (!rows.length) return res.status(404).json({ success: false, message: 'Assignment not found' });

        const assignment = rows[0];

        // Staff can only see their own assignments
        if (req.user.role === 'staff' && assignment.staff_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        // Get items
        const [items] = await pool.query(
            'SELECT * FROM stock_check_items WHERE assignment_id = ? ORDER BY item_name ASC',
            [req.params.id]
        );

        assignment.items = items;
        res.json({ success: true, data: assignment });
    } catch (error) {
        console.error('Get assignment error:', error);
        res.status(500).json({ success: false, message: 'Failed to get assignment' });
    }
});

// ========================================
// ADMIN: DELETE PENDING ASSIGNMENT
// ========================================

/** DELETE /api/stock-check/assignments/:id — Delete pending assignment */
router.delete('/assignments/:id', requirePermission('zoho', 'stock_check'), async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id, status FROM stock_check_assignments WHERE id = ?', [req.params.id]);
        if (!rows.length) return res.status(404).json({ success: false, message: 'Assignment not found' });
        if (rows[0].status !== 'pending') {
            return res.status(400).json({ success: false, message: 'Can only delete pending assignments' });
        }

        await pool.query('DELETE FROM stock_check_assignments WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Assignment deleted' });
    } catch (error) {
        console.error('Delete assignment error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete assignment' });
    }
});

// ========================================
// STAFF: MY ASSIGNMENTS
// ========================================

/** GET /api/stock-check/my-assignments — Staff's assignments (today by default) */
router.get('/my-assignments', requireAuth, async (req, res) => {
    try {
        const { date } = req.query;
        const targetDate = date || new Date().toISOString().split('T')[0];

        const [rows] = await pool.query(
            `SELECT a.*, b.name as branch_name,
                    (SELECT COUNT(*) FROM stock_check_items WHERE assignment_id = a.id) as item_count
             FROM stock_check_assignments a
             LEFT JOIN branches b ON a.branch_id = b.id
             WHERE a.staff_id = ? AND a.check_date = ?
             ORDER BY a.created_at DESC`,
            [req.user.id, targetDate]
        );

        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('My assignments error:', error);
        res.status(500).json({ success: false, message: 'Failed to get assignments' });
    }
});

// ========================================
// STAFF: SUBMIT COUNTS
// ========================================

/** POST /api/stock-check/submit/:id — Staff submits item counts + photos */
router.post('/submit/:id', requireAuth, upload.any(), async (req, res) => {
    try {
        const assignmentId = req.params.id;

        // Verify assignment belongs to this staff and is pending
        const [assignments] = await pool.query(
            'SELECT * FROM stock_check_assignments WHERE id = ? AND staff_id = ?',
            [assignmentId, req.user.id]
        );
        if (!assignments.length) return res.status(404).json({ success: false, message: 'Assignment not found' });
        if (assignments[0].status !== 'pending') {
            return res.status(400).json({ success: false, message: 'Assignment already submitted' });
        }

        // Parse items from body
        let items;
        try {
            items = typeof req.body.items === 'string' ? JSON.parse(req.body.items) : req.body.items;
        } catch (e) {
            return res.status(400).json({ success: false, message: 'Invalid items data' });
        }

        if (!items || !items.length) {
            return res.status(400).json({ success: false, message: 'No items submitted' });
        }

        // Build file map: photo_{item_id} => file buffer
        const fileMap = {};
        if (req.files) {
            for (const file of req.files) {
                fileMap[file.fieldname] = file;
            }
        }

        // Ensure upload dir
        if (!fs.existsSync(UPLOAD_DIR)) {
            fs.mkdirSync(UPLOAD_DIR, { recursive: true });
        }

        const now = new Date();

        for (const item of items) {
            const reportedQty = parseFloat(item.reported_qty);
            if (isNaN(reportedQty)) continue;

            // Get system qty for difference calc
            const [existing] = await pool.query(
                'SELECT id, system_qty FROM stock_check_items WHERE assignment_id = ? AND zoho_item_id = ?',
                [assignmentId, item.zoho_item_id]
            );
            if (!existing.length) continue;

            const systemQty = parseFloat(existing[0].system_qty) || 0;
            const difference = reportedQty - systemQty;
            const variancePct = systemQty !== 0 ? ((difference / systemQty) * 100) : (reportedQty !== 0 ? 100 : 0);

            // Process photo if uploaded
            let photoUrl = null;
            const photoFile = fileMap[`photo_${item.zoho_item_id}`];
            if (photoFile) {
                const filename = `sc-${assignmentId}-${item.zoho_item_id}-${Date.now()}.jpg`;
                const filepath = path.join(UPLOAD_DIR, filename);
                await sharp(photoFile.buffer)
                    .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
                    .jpeg({ quality: 80 })
                    .toFile(filepath);
                photoUrl = `/uploads/stock-check/${filename}`;
            }

            await pool.query(
                `UPDATE stock_check_items
                 SET reported_qty = ?, difference = ?, variance_pct = ?, photo_url = COALESCE(?, photo_url),
                     notes = ?, submitted_at = ?
                 WHERE id = ?`,
                [reportedQty, difference, Math.round(variancePct * 100) / 100, photoUrl, item.notes || null, now, existing[0].id]
            );
        }

        // Mark assignment as submitted
        await pool.query(
            'UPDATE stock_check_assignments SET status = ?, submitted_at = ? WHERE id = ?',
            ['submitted', now, assignmentId]
        );

        // Notify admins
        try {
            const [admins] = await pool.query("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
            const [staffRow] = await pool.query('SELECT full_name FROM users WHERE id = ?', [req.user.id]);
            const staffName = staffRow.length ? staffRow[0].full_name : 'Staff';

            for (const admin of admins) {
                await notificationService.send(admin.id, {
                    type: 'stock_check_submitted',
                    title: 'Stock Check Submitted',
                    body: `${staffName} submitted stock check #${assignmentId} (${items.length} items)`,
                    data: { assignment_id: assignmentId }
                });
            }
        } catch (e) { console.error('Stock check submit notification error:', e.message); }

        res.json({ success: true, message: 'Stock check submitted' });
    } catch (error) {
        console.error('Submit stock check error:', error);
        res.status(500).json({ success: false, message: 'Failed to submit stock check' });
    }
});

// ========================================
// ADMIN: REVIEW ASSIGNMENT
// ========================================

/** GET /api/stock-check/review/:id — Admin review with system vs reported */
router.get('/review/:id', requirePermission('zoho', 'stock_check'), async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT a.*, b.name as branch_name, b.zoho_location_id, u.full_name as staff_name
             FROM stock_check_assignments a
             LEFT JOIN branches b ON a.branch_id = b.id
             LEFT JOIN users u ON a.staff_id = u.id
             WHERE a.id = ?`,
            [req.params.id]
        );
        if (!rows.length) return res.status(404).json({ success: false, message: 'Assignment not found' });

        const assignment = rows[0];

        // Get items with comparison data
        const [items] = await pool.query(
            'SELECT * FROM stock_check_items WHERE assignment_id = ? ORDER BY item_name ASC',
            [req.params.id]
        );

        // Summary stats
        const totalItems = items.length;
        const matchCount = items.filter(i => i.difference !== null && parseFloat(i.difference) === 0).length;
        const discrepancyCount = items.filter(i => i.difference !== null && parseFloat(i.difference) !== 0).length;
        const pendingCount = items.filter(i => i.reported_qty === null).length;

        res.json({
            success: true,
            data: {
                ...assignment,
                items,
                summary: { totalItems, matchCount, discrepancyCount, pendingCount }
            }
        });
    } catch (error) {
        console.error('Review assignment error:', error);
        res.status(500).json({ success: false, message: 'Failed to get review data' });
    }
});

// ========================================
// ADMIN: CREATE ZOHO ADJUSTMENT
// ========================================

/** POST /api/stock-check/adjust/:id — Push discrepancies to Zoho as inventory adjustment */
router.post('/adjust/:id', requirePermission('zoho', 'stock_check'), async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT a.*, b.name as branch_name, b.zoho_location_id
             FROM stock_check_assignments a
             LEFT JOIN branches b ON a.branch_id = b.id
             WHERE a.id = ?`,
            [req.params.id]
        );
        if (!rows.length) return res.status(404).json({ success: false, message: 'Assignment not found' });

        const assignment = rows[0];
        if (assignment.status === 'adjusted') {
            return res.status(400).json({ success: false, message: 'Already adjusted' });
        }
        if (!assignment.zoho_location_id) {
            return res.status(400).json({ success: false, message: 'Branch has no linked Zoho location' });
        }

        // Get items with discrepancies
        const [items] = await pool.query(
            `SELECT * FROM stock_check_items
             WHERE assignment_id = ? AND difference IS NOT NULL AND difference != 0`,
            [req.params.id]
        );

        if (!items.length) {
            // No discrepancies — mark as reviewed
            await pool.query(
                'UPDATE stock_check_assignments SET status = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?',
                ['reviewed', req.user.id, req.params.id]
            );
            return res.json({ success: true, message: 'No discrepancies found. Marked as reviewed.' });
        }

        // Build Zoho inventory adjustment payload
        const zohoAPI = require('../services/zoho-api');

        const lineItems = items.map(item => ({
            item_id: item.zoho_item_id,
            quantity_adjusted: parseFloat(item.difference),
            warehouse_id: assignment.zoho_location_id
        }));

        const adjustmentData = {
            date: assignment.check_date,
            reason: `Stock check #${assignment.id} - Physical count by staff on ${assignment.check_date}`,
            description: `Auto-generated from stock check assignment #${assignment.id}`,
            adjustment_type: 'quantity',
            line_items: lineItems
        };

        const zohoResult = await zohoAPI.createInventoryAdjustment(adjustmentData);

        const adjustmentId = zohoResult?.inventory_adjustment?.inventory_adjustment_id || zohoResult?.inventoryadjustment_id || null;

        // Update assignment status
        await pool.query(
            `UPDATE stock_check_assignments
             SET status = 'adjusted', reviewed_by = ?, reviewed_at = NOW(), adjustment_id = ?
             WHERE id = ?`,
            [req.user.id, adjustmentId, req.params.id]
        );

        res.json({
            success: true,
            message: `Inventory adjustment created (${items.length} items)`,
            data: { adjustment_id: adjustmentId }
        });
    } catch (error) {
        console.error('Create adjustment error:', error);
        res.status(500).json({ success: false, message: 'Failed to create Zoho adjustment: ' + error.message });
    }
});

// ========================================
// ADMIN: DASHBOARD STATS
// ========================================

/** GET /api/stock-check/dashboard — Summary stats per branch */
router.get('/dashboard', requirePermission('zoho', 'stock_check'), async (req, res) => {
    try {
        const { from_date, to_date } = req.query;
        let dateFilter = '';
        const params = [];

        if (from_date) { dateFilter += ' AND a.check_date >= ?'; params.push(from_date); }
        if (to_date) { dateFilter += ' AND a.check_date <= ?'; params.push(to_date); }

        const [stats] = await pool.query(
            `SELECT b.id as branch_id, b.name as branch_name,
                    COUNT(a.id) as total_assignments,
                    SUM(CASE WHEN a.status = 'pending' THEN 1 ELSE 0 END) as pending_count,
                    SUM(CASE WHEN a.status = 'submitted' THEN 1 ELSE 0 END) as submitted_count,
                    SUM(CASE WHEN a.status = 'reviewed' THEN 1 ELSE 0 END) as reviewed_count,
                    SUM(CASE WHEN a.status = 'adjusted' THEN 1 ELSE 0 END) as adjusted_count
             FROM branches b
             LEFT JOIN stock_check_assignments a ON b.id = a.branch_id ${dateFilter}
             WHERE b.status = 'active'
             GROUP BY b.id, b.name
             ORDER BY b.name`,
            params
        );

        // Overall totals
        const totals = {
            total: stats.reduce((s, r) => s + (r.total_assignments || 0), 0),
            pending: stats.reduce((s, r) => s + (r.pending_count || 0), 0),
            submitted: stats.reduce((s, r) => s + (r.submitted_count || 0), 0),
            reviewed: stats.reduce((s, r) => s + (r.reviewed_count || 0), 0),
            adjusted: stats.reduce((s, r) => s + (r.adjusted_count || 0), 0)
        };

        res.json({ success: true, data: { branches: stats, totals } });
    } catch (error) {
        console.error('Dashboard stats error:', error);
        res.status(500).json({ success: false, message: 'Failed to get dashboard stats' });
    }
});

// ========================================
// ADMIN: SUGGEST PRODUCTS
// ========================================

/** GET /api/stock-check/products/suggest — Items not checked in 30+ days */
router.get('/products/suggest', requirePermission('zoho', 'stock_check'), async (req, res) => {
    try {
        const { branch_id, days = 30, limit: lim = 50 } = req.query;

        if (!branch_id) {
            return res.status(400).json({ success: false, message: 'branch_id is required' });
        }

        // Get branch zoho_location_id
        const [branches] = await pool.query('SELECT zoho_location_id FROM branches WHERE id = ?', [branch_id]);
        if (!branches.length || !branches[0].zoho_location_id) {
            return res.status(400).json({ success: false, message: 'Branch has no linked Zoho location' });
        }
        const locationId = branches[0].zoho_location_id;

        // Items in this location that haven't been checked in N days
        const [rows] = await pool.query(
            `SELECT ls.zoho_item_id, ls.item_name, ls.sku, ls.stock_on_hand,
                    MAX(sci.submitted_at) as last_checked
             FROM zoho_location_stock ls
             LEFT JOIN stock_check_items sci ON ls.zoho_item_id = sci.zoho_item_id
                 AND sci.assignment_id IN (
                     SELECT id FROM stock_check_assignments WHERE branch_id = ?
                 )
             WHERE ls.zoho_location_id = ? AND ls.stock_on_hand > 0
             GROUP BY ls.zoho_item_id, ls.item_name, ls.sku, ls.stock_on_hand
             HAVING last_checked IS NULL OR last_checked < DATE_SUB(NOW(), INTERVAL ? DAY)
             ORDER BY ls.stock_on_hand DESC
             LIMIT ?`,
            [branch_id, locationId, parseInt(days), parseInt(lim)]
        );

        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Suggest products error:', error);
        res.status(500).json({ success: false, message: 'Failed to get suggestions' });
    }
});

module.exports = { router, setPool };
