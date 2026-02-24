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

/** GET /api/stock-check/locations/:branchId — Get Zoho locations for a branch */
router.get('/locations/:branchId', requirePermission('zoho', 'stock_check'), async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT zoho_location_id, zoho_location_name FROM zoho_locations_map
             WHERE local_branch_id = ? AND is_active = 1
             ORDER BY zoho_location_name`,
            [req.params.branchId]
        );
        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Get branch locations error:', error);
        res.status(500).json({ success: false, message: 'Failed to get locations' });
    }
});

/** POST /api/stock-check/assign — Admin creates stock check assignment */
router.post('/assign', requirePermission('zoho', 'stock_check'), async (req, res) => {
    try {
        const { branch_id, staff_id, check_date, item_ids, show_system_qty, notes, zoho_location_id } = req.body;

        if (!branch_id || !staff_id || !check_date || !item_ids || !item_ids.length) {
            return res.status(400).json({ success: false, message: 'branch_id, staff_id, check_date, and item_ids are required' });
        }

        // Validate staff_id is an assignable role
        const ASSIGNABLE_ROLES = ['staff', 'sales_staff', 'branch_manager'];
        const [staffUser] = await pool.query('SELECT id, role FROM users WHERE id = ? AND status = ?', [staff_id, 'active']);
        if (!staffUser.length) return res.status(400).json({ success: false, message: 'Staff member not found or inactive' });
        if (!ASSIGNABLE_ROLES.includes(staffUser[0].role)) return res.status(400).json({ success: false, message: 'Can only assign stock checks to staff members' });

        // Get branch info
        const [branches] = await pool.query('SELECT id, name as branch_name FROM branches WHERE id = ?', [branch_id]);
        if (!branches.length) return res.status(404).json({ success: false, message: 'Branch not found' });
        const branch = branches[0];

        // Determine location: use explicit selection, or fall back to branch default
        let locationId = zoho_location_id;
        if (!locationId) {
            const [brRow] = await pool.query('SELECT zoho_location_id FROM branches WHERE id = ?', [branch_id]);
            locationId = brRow.length ? brRow[0].zoho_location_id : null;
        }
        if (!locationId) {
            return res.status(400).json({ success: false, message: 'No Zoho location selected or linked to branch.' });
        }

        // Create assignment with chosen location
        const [result] = await pool.query(
            `INSERT INTO stock_check_assignments (branch_id, zoho_location_id, staff_id, check_date, show_system_qty, notes, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [branch_id, locationId, staff_id, check_date, show_system_qty ? 1 : 0, notes || null, req.user.id]
        );
        const assignmentId = result.insertId;

        // Fetch system quantities from zoho_location_stock cache for selected location
        const placeholders = item_ids.map(() => '?').join(',');
        const [stockRows] = await pool.query(
            `SELECT zoho_item_id, item_name, sku, stock_on_hand
             FROM zoho_location_stock
             WHERE zoho_item_id IN (${placeholders}) AND zoho_location_id = ?`,
            [...item_ids, locationId]
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

        // If status=submitted and include_partial=1, also show pending assignments with submitted items
        const includePartial = req.query.include_partial === '1';
        if (includePartial && status === 'submitted') {
            where = where.replace(' AND a.status = ?', ' AND (a.status = ? OR (a.status = \'pending\' AND EXISTS (SELECT 1 FROM stock_check_items sci WHERE sci.assignment_id = a.id AND sci.item_status = \'submitted\')))');
        }

        const [countResult] = await pool.query(
            `SELECT COUNT(*) as total FROM stock_check_assignments a ${where}`, params
        );

        const [rows] = await pool.query(
            `SELECT a.*, DATE_FORMAT(a.check_date, '%Y-%m-%d') as check_date,
                    b.name as branch_name, u.full_name as staff_name,
                    creator.full_name as created_by_name,
                    reviewer.full_name as reviewed_by_name,
                    zlm.zoho_location_name as location_name,
                    (SELECT COUNT(*) FROM stock_check_items WHERE assignment_id = a.id) as item_count,
                    (SELECT COUNT(*) FROM stock_check_items WHERE assignment_id = a.id AND difference != 0 AND difference IS NOT NULL) as discrepancy_count,
                    (SELECT COUNT(*) FROM stock_check_items WHERE assignment_id = a.id AND item_status IN ('submitted', 'adjusted')) as submitted_count
             FROM stock_check_assignments a
             LEFT JOIN branches b ON a.branch_id = b.id
             LEFT JOIN users u ON a.staff_id = u.id
             LEFT JOIN users creator ON a.created_by = creator.id
             LEFT JOIN users reviewer ON a.reviewed_by = reviewer.id
             LEFT JOIN zoho_locations_map zlm ON a.zoho_location_id = zlm.zoho_location_id COLLATE utf8mb4_unicode_ci
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
            `SELECT a.*, DATE_FORMAT(a.check_date, '%Y-%m-%d') as check_date,
                    b.name as branch_name, u.full_name as staff_name,
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

/** GET /api/stock-check/my-assignments — Staff's assignments (today by default, or all pending) */
router.get('/my-assignments', requireAuth, async (req, res) => {
    try {
        const { date, pending } = req.query;

        // ?pending=1 — return all non-completed assignments (for dashboard widget)
        if (pending === '1') {
            const [rows] = await pool.query(
                `SELECT a.*, DATE_FORMAT(a.check_date, '%Y-%m-%d') as check_date,
                        b.name as branch_name,
                        u.full_name as created_by_name,
                        zlm.zoho_location_name as location_name,
                        (SELECT COUNT(*) FROM stock_check_items WHERE assignment_id = a.id) as item_count
                 FROM stock_check_assignments a
                 LEFT JOIN branches b ON a.branch_id = b.id
                 LEFT JOIN users u ON a.created_by = u.id
                 LEFT JOIN zoho_locations_map zlm ON a.zoho_location_id = zlm.zoho_location_id COLLATE utf8mb4_unicode_ci
                 WHERE a.staff_id = ? AND a.status IN ('pending', 'submitted')
                 ORDER BY a.check_date DESC, a.created_at DESC
                 LIMIT 10`,
                [req.user.id]
            );
            return res.json({ success: true, data: rows });
        }

        const now = new Date();
        const targetDate = date || `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

        const [rows] = await pool.query(
            `SELECT a.*, DATE_FORMAT(a.check_date, '%Y-%m-%d') as check_date,
                    b.name as branch_name,
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
// STAFF: MY SUBMISSIONS HISTORY
// ========================================

/** GET /api/stock-check/my-submissions — Staff's past submitted/reviewed/adjusted assignments */
router.get('/my-submissions', requireAuth, async (req, res) => {
    try {
        const { page = 1, limit: lim = 20 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(lim);

        const [countResult] = await pool.query(
            `SELECT COUNT(*) as total FROM stock_check_assignments
             WHERE staff_id = ? AND status IN ('submitted', 'reviewed', 'adjusted')`,
            [req.user.id]
        );

        const [rows] = await pool.query(
            `SELECT a.*, DATE_FORMAT(a.check_date, '%Y-%m-%d') as check_date,
                    b.name as branch_name,
                    (SELECT COUNT(*) FROM stock_check_items WHERE assignment_id = a.id) as item_count,
                    (SELECT COUNT(*) FROM stock_check_items WHERE assignment_id = a.id AND difference != 0 AND difference IS NOT NULL) as discrepancy_count
             FROM stock_check_assignments a
             LEFT JOIN branches b ON a.branch_id = b.id
             WHERE a.staff_id = ? AND a.status IN ('submitted', 'reviewed', 'adjusted')
             ORDER BY a.submitted_at DESC
             LIMIT ? OFFSET ?`,
            [req.user.id, parseInt(lim), offset]
        );

        res.json({
            success: true,
            data: rows,
            pagination: { total: countResult[0].total, page: parseInt(page), limit: parseInt(lim) }
        });
    } catch (error) {
        console.error('My submissions error:', error);
        res.status(500).json({ success: false, message: 'Failed to get submissions' });
    }
});

// ========================================
// STAFF: SAVE PROGRESS (PARTIAL SUBMISSION)
// ========================================

/** POST /api/stock-check/save-progress/:id — Staff saves partial progress on stock check */
router.post('/save-progress/:id', requireAuth, upload.any(), async (req, res) => {
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
            return res.status(400).json({ success: false, message: 'No items to save' });
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
        let saved = 0;

        for (const item of items) {
            const reportedQty = parseFloat(item.reported_qty);
            if (isNaN(reportedQty)) continue;

            // Get system qty for difference calc
            const [existing] = await pool.query(
                'SELECT id, system_qty, item_status FROM stock_check_items WHERE assignment_id = ? AND zoho_item_id = ?',
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

            // Only update items that haven't been submitted/adjusted yet
            const currentStatus = existing[0].item_status || 'pending';
            if (currentStatus === 'submitted' || currentStatus === 'adjusted') {
                continue; // Skip locked items
            }

            await pool.query(
                `UPDATE stock_check_items
                 SET reported_qty = ?, difference = ?, variance_pct = ?, photo_url = COALESCE(?, photo_url),
                     notes = ?, submitted_at = ?, item_status = 'checked'
                 WHERE id = ?`,
                [reportedQty, difference, Math.round(variancePct * 100) / 100, photoUrl, item.notes || null, now, existing[0].id]
            );
            saved++;
        }

        // Get progress stats (do NOT change assignment status)
        const [totalRows] = await pool.query(
            'SELECT COUNT(*) as total FROM stock_check_items WHERE assignment_id = ?',
            [assignmentId]
        );
        const [checkedRows] = await pool.query(
            'SELECT COUNT(*) as checked FROM stock_check_items WHERE assignment_id = ? AND reported_qty IS NOT NULL',
            [assignmentId]
        );

        const total = totalRows[0].total;
        const checked = checkedRows[0].checked;
        const remaining = total - checked;
        const progressPct = total > 0 ? Math.round((checked / total) * 100) : 0;

        res.json({
            success: true,
            message: `Saved ${saved} items`,
            data: { saved, total, checked, remaining, progress_pct: progressPct }
        });
    } catch (error) {
        console.error('Save progress error:', error);
        res.status(500).json({ success: false, message: 'Failed to save progress' });
    }
});

// ========================================
// STAFF: GET PROGRESS
// ========================================

/** GET /api/stock-check/progress/:id — Get progress stats + checked items for resume */
router.get('/progress/:id', requireAuth, async (req, res) => {
    try {
        const assignmentId = req.params.id;

        // Verify assignment belongs to this staff
        const [assignments] = await pool.query(
            'SELECT id, staff_id, status FROM stock_check_assignments WHERE id = ?',
            [assignmentId]
        );
        if (!assignments.length) return res.status(404).json({ success: false, message: 'Assignment not found' });
        if (assignments[0].staff_id !== req.user.id) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        // Get all items with their check status
        const [items] = await pool.query(
            'SELECT zoho_item_id, reported_qty, difference, variance_pct, notes, photo_url, submitted_at, item_status FROM stock_check_items WHERE assignment_id = ? ORDER BY item_name ASC',
            [assignmentId]
        );

        const total = items.length;
        const checkedItems = items.filter(i => i.reported_qty !== null);
        const checked = checkedItems.length;
        const remaining = total - checked;
        const progressPct = total > 0 ? Math.round((checked / total) * 100) : 0;
        const discrepancies = checkedItems.filter(i => parseFloat(i.difference) !== 0).length;
        const submittedItems = items.filter(i => i.item_status === 'submitted').length;
        const adjustedItems = items.filter(i => i.item_status === 'adjusted').length;

        res.json({
            success: true,
            data: {
                total,
                checked,
                remaining,
                progress_pct: progressPct,
                discrepancies,
                submitted_count: submittedItems,
                adjusted_count: adjustedItems,
                checked_items: checkedItems.map(i => ({
                    zoho_item_id: i.zoho_item_id,
                    reported_qty: i.reported_qty,
                    difference: i.difference,
                    variance_pct: i.variance_pct,
                    notes: i.notes,
                    photo_url: i.photo_url,
                    item_status: i.item_status || 'checked'
                }))
            }
        });
    } catch (error) {
        console.error('Get progress error:', error);
        res.status(500).json({ success: false, message: 'Failed to get progress' });
    }
});

// ========================================
// STAFF: SUBMIT COUNTS
// ========================================

/** POST /api/stock-check/submit/:id — Staff submits checked items as a batch (partial submission) */
router.post('/submit/:id', requireAuth, upload.any(), async (req, res) => {
    try {
        const assignmentId = req.params.id;

        // Verify assignment belongs to this staff and is still workable
        const [assignments] = await pool.query(
            'SELECT * FROM stock_check_assignments WHERE id = ? AND staff_id = ?',
            [assignmentId, req.user.id]
        );
        if (!assignments.length) return res.status(404).json({ success: false, message: 'Assignment not found' });
        if (assignments[0].status === 'adjusted') {
            return res.status(400).json({ success: false, message: 'Assignment already fully adjusted' });
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
        let submittedCount = 0;

        for (const item of items) {
            const reportedQty = parseFloat(item.reported_qty);
            if (isNaN(reportedQty)) continue;

            // Get system qty + current item_status
            const [existing] = await pool.query(
                'SELECT id, system_qty, item_status FROM stock_check_items WHERE assignment_id = ? AND zoho_item_id = ?',
                [assignmentId, item.zoho_item_id]
            );
            if (!existing.length) continue;

            // Skip items already submitted or adjusted
            const currentStatus = existing[0].item_status || 'pending';
            if (currentStatus === 'submitted' || currentStatus === 'adjusted') continue;

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
                     notes = ?, submitted_at = ?, item_status = 'submitted'
                 WHERE id = ?`,
                [reportedQty, difference, Math.round(variancePct * 100) / 100, photoUrl, item.notes || null, now, existing[0].id]
            );
            submittedCount++;
        }

        // Count remaining items that are NOT yet submitted or adjusted
        const [remainingRows] = await pool.query(
            `SELECT COUNT(*) as remaining FROM stock_check_items
             WHERE assignment_id = ? AND item_status NOT IN ('submitted', 'adjusted')`,
            [assignmentId]
        );
        const remaining = remainingRows[0].remaining;

        // If all items are submitted/adjusted → mark assignment as submitted
        // Otherwise keep as pending so staff can continue checking
        if (remaining === 0) {
            await pool.query(
                'UPDATE stock_check_assignments SET status = ?, submitted_at = COALESCE(submitted_at, ?) WHERE id = ?',
                ['submitted', now, assignmentId]
            );
        } else {
            // Keep pending but record the latest submission time
            await pool.query(
                'UPDATE stock_check_assignments SET submitted_at = COALESCE(submitted_at, ?) WHERE id = ?',
                [now, assignmentId]
            );
        }

        // Notify admins
        try {
            const [admins] = await pool.query("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
            const [staffRow] = await pool.query('SELECT full_name FROM users WHERE id = ?', [req.user.id]);
            const staffName = staffRow.length ? staffRow[0].full_name : 'Staff';

            const batchMsg = remaining > 0
                ? `${staffName} submitted ${submittedCount} items for stock check #${assignmentId} (${remaining} remaining)`
                : `${staffName} submitted final batch for stock check #${assignmentId} (${submittedCount} items, all complete)`;

            for (const admin of admins) {
                await notificationService.send(admin.id, {
                    type: 'stock_check_submitted',
                    title: 'Stock Check Batch Submitted',
                    body: batchMsg,
                    data: { assignment_id: assignmentId }
                });
            }
        } catch (e) { console.error('Stock check submit notification error:', e.message); }

        res.json({
            success: true,
            message: remaining > 0
                ? `Submitted ${submittedCount} items (${remaining} remaining)`
                : `All items submitted (${submittedCount} items)`,
            data: { submitted: submittedCount, remaining }
        });
    } catch (error) {
        console.error('Submit stock check error:', error);
        res.status(500).json({ success: false, message: 'Failed to submit stock check' });
    }
});

// ========================================
// STAFF: SELF-REQUEST STOCK CHECK
// ========================================

/** POST /api/stock-check/self-request — Staff creates + submits their own stock check */
router.post('/self-request', requireAuth, upload.any(), async (req, res) => {
    try {
        const { reason, zoho_location_id: reqLocationId } = req.body;
        let items;
        try {
            items = typeof req.body.items === 'string' ? JSON.parse(req.body.items) : req.body.items;
        } catch (e) {
            return res.status(400).json({ success: false, message: 'Invalid items data' });
        }

        if (!items || !items.length) {
            return res.status(400).json({ success: false, message: 'No items submitted' });
        }

        // Get staff's branch
        const [userRows] = await pool.query('SELECT branch_id FROM users WHERE id = ?', [req.user.id]);
        if (!userRows.length || !userRows[0].branch_id) {
            return res.status(400).json({ success: false, message: 'Your account is not assigned to a branch' });
        }
        const branchId = userRows[0].branch_id;

        // Get zoho location
        let locationId = reqLocationId;
        if (!locationId) {
            const [locRows] = await pool.query(
                'SELECT zoho_location_id FROM zoho_locations_map WHERE local_branch_id = ? AND is_active = 1 LIMIT 1',
                [branchId]
            );
            locationId = locRows.length ? locRows[0].zoho_location_id : null;
        }
        if (!locationId) {
            return res.status(400).json({ success: false, message: 'No Zoho location found for your branch' });
        }

        const now = new Date();
        const checkDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        // Create assignment as self_requested + already submitted
        const [result] = await pool.query(
            `INSERT INTO stock_check_assignments
             (branch_id, zoho_location_id, staff_id, check_date, show_system_qty, notes, requested_reason, request_type, created_by, status, submitted_at)
             VALUES (?, ?, ?, ?, 0, ?, ?, 'self_requested', ?, 'submitted', ?)`,
            [branchId, locationId, req.user.id, checkDate, reason || null, reason || null, req.user.id, now]
        );
        const assignmentId = result.insertId;

        // Build file map
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

        // Fetch system quantities
        const itemIds = items.map(i => i.zoho_item_id);
        const placeholders = itemIds.map(() => '?').join(',');
        const [stockRows] = await pool.query(
            `SELECT zoho_item_id, item_name, sku, stock_on_hand
             FROM zoho_location_stock
             WHERE zoho_item_id IN (${placeholders}) AND zoho_location_id = ?`,
            [...itemIds, locationId]
        );
        const stockMap = {};
        stockRows.forEach(r => { stockMap[r.zoho_item_id] = r; });

        // Insert items with counts
        for (const item of items) {
            const stock = stockMap[item.zoho_item_id] || {};
            const reportedQty = parseFloat(item.reported_qty);
            const systemQty = parseFloat(stock.stock_on_hand) || 0;
            const difference = reportedQty - systemQty;
            const variancePct = systemQty !== 0 ? ((difference / systemQty) * 100) : (reportedQty !== 0 ? 100 : 0);

            // Process photo
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
                `INSERT INTO stock_check_items
                 (assignment_id, zoho_item_id, item_name, item_sku, system_qty, reported_qty, difference, variance_pct, photo_url, notes, submitted_at, item_status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted')`,
                [assignmentId, item.zoho_item_id, stock.item_name || 'Unknown', stock.sku || '',
                 systemQty, reportedQty, difference, Math.round(variancePct * 100) / 100,
                 photoUrl, item.notes || null, now]
            );
        }

        // Notify admins
        try {
            const [admins] = await pool.query("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
            const [staffRow] = await pool.query('SELECT full_name FROM users WHERE id = ?', [req.user.id]);
            const staffName = staffRow.length ? staffRow[0].full_name : 'Staff';

            for (const admin of admins) {
                await notificationService.send(admin.id, {
                    type: 'stock_check_submitted',
                    title: 'Self-Requested Stock Check',
                    body: `${staffName} submitted a self-requested stock check (${items.length} items)${reason ? ': ' + reason : ''}`,
                    data: { assignment_id: assignmentId }
                });
            }
        } catch (e) { console.error('Self-request notification error:', e.message); }

        res.json({ success: true, message: 'Stock check submitted', data: { id: assignmentId, items: items.length } });
    } catch (error) {
        console.error('Self-request stock check error:', error);
        res.status(500).json({ success: false, message: 'Failed to create stock check' });
    }
});

// ========================================
// ADMIN: REVIEW ASSIGNMENT
// ========================================

/** GET /api/stock-check/review/:id — Admin review with system vs reported */
router.get('/review/:id', requirePermission('zoho', 'stock_check'), async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT a.*, DATE_FORMAT(a.check_date, '%Y-%m-%d') as check_date,
                    b.name as branch_name, u.full_name as staff_name,
                    zlm.zoho_location_name as location_name
             FROM stock_check_assignments a
             LEFT JOIN branches b ON a.branch_id = b.id
             LEFT JOIN users u ON a.staff_id = u.id
             LEFT JOIN zoho_locations_map zlm ON a.zoho_location_id = zlm.zoho_location_id COLLATE utf8mb4_unicode_ci
             WHERE a.id = ?`,
            [req.params.id]
        );
        if (!rows.length) return res.status(404).json({ success: false, message: 'Assignment not found' });

        const assignment = rows[0];

        // Get items with live stock comparison from zoho_location_stock
        const [items] = await pool.query(
            `SELECT sci.*,
                    ls.stock_on_hand AS current_system_qty,
                    ls.last_synced_at,
                    CASE WHEN sci.reported_qty IS NOT NULL
                         THEN sci.reported_qty - COALESCE(ls.stock_on_hand, sci.system_qty)
                         ELSE NULL END AS live_difference,
                    CASE WHEN sci.reported_qty IS NOT NULL AND COALESCE(ls.stock_on_hand, sci.system_qty) != 0
                         THEN ROUND((sci.reported_qty - COALESCE(ls.stock_on_hand, sci.system_qty)) / COALESCE(ls.stock_on_hand, sci.system_qty) * 100, 2)
                         ELSE NULL END AS live_variance_pct
             FROM stock_check_items sci
             LEFT JOIN zoho_location_stock ls
               ON sci.zoho_item_id = ls.zoho_item_id AND ls.zoho_location_id = ?
             WHERE sci.assignment_id = ?
             ORDER BY sci.item_name ASC`,
            [assignment.zoho_location_id, req.params.id]
        );

        // Summary stats using live values
        const totalItems = items.length;
        const matchCount = items.filter(i => i.live_difference !== null && parseFloat(i.live_difference) === 0).length;
        const discrepancyCount = items.filter(i => i.live_difference !== null && parseFloat(i.live_difference) !== 0).length;
        const pendingCount = items.filter(i => i.reported_qty === null).length;
        const submittedCount = items.filter(i => i.item_status === 'submitted').length;
        const adjustedCount = items.filter(i => i.item_status === 'adjusted').length;
        // Count submitted items with live discrepancies (these are pushable to Zoho)
        const pushableCount = items.filter(i => i.item_status === 'submitted' && i.live_difference !== null && parseFloat(i.live_difference) !== 0).length;

        res.json({
            success: true,
            data: {
                ...assignment,
                items,
                summary: { totalItems, matchCount, discrepancyCount, pendingCount, submittedCount, adjustedCount, pushableCount }
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
            `SELECT a.*, DATE_FORMAT(a.check_date, '%Y-%m-%d') as check_date,
                    b.name as branch_name
             FROM stock_check_assignments a
             LEFT JOIN branches b ON a.branch_id = b.id
             WHERE a.id = ?`,
            [req.params.id]
        );
        if (!rows.length) return res.status(404).json({ success: false, message: 'Assignment not found' });

        const assignment = rows[0];

        // Use assignment's stored location, fall back to branch default
        let locationId = assignment.zoho_location_id;
        if (!locationId) {
            const [brRow] = await pool.query('SELECT zoho_location_id FROM branches WHERE id = ?', [assignment.branch_id]);
            locationId = brRow.length ? brRow[0].zoho_location_id : null;
        }
        if (!locationId) {
            return res.status(400).json({ success: false, message: 'No Zoho location linked' });
        }

        // Get ALL submitted items with live stock comparison
        const [items] = await pool.query(
            `SELECT sci.*,
                    ls.stock_on_hand AS current_system_qty,
                    CASE WHEN sci.reported_qty IS NOT NULL
                         THEN sci.reported_qty - COALESCE(ls.stock_on_hand, sci.system_qty)
                         ELSE NULL END AS live_difference
             FROM stock_check_items sci
             LEFT JOIN zoho_location_stock ls
               ON sci.zoho_item_id = ls.zoho_item_id AND ls.zoho_location_id = ?
             WHERE sci.assignment_id = ? AND sci.item_status = 'submitted'`,
            [locationId, req.params.id]
        );

        if (!items.length) {
            // No submitted items to process
            return res.json({ success: true, message: 'No submitted items to process. Waiting for more items from staff.' });
        }

        // Split into discrepancy vs zero-diff using live values
        const discrepancyItems = items.filter(i => i.live_difference !== null && parseFloat(i.live_difference) !== 0);
        const zeroDiffItems = items.filter(i => !i.live_difference || parseFloat(i.live_difference) === 0);

        let adjustmentIds = [];
        const failedItems = []; // Items that Zoho rejected (e.g. insufficient stock)

        if (discrepancyItems.length) {
            const zohoAPI = require('../services/zoho-api');

            const checkDate = assignment.check_date instanceof Date
                ? `${assignment.check_date.getFullYear()}-${String(assignment.check_date.getMonth()+1).padStart(2,'0')}-${String(assignment.check_date.getDate()).padStart(2,'0')}`
                : String(assignment.check_date).split('T')[0];

            const lineItems = discrepancyItems.map(item => ({
                item_id: item.zoho_item_id,
                location_id: locationId,
                quantity_adjusted: parseFloat(item.live_difference)
            }));

            console.log(`[Stock Check] Pushing batch adjustment for assignment #${assignment.id}, branch: ${assignment.branch_name}, location: ${locationId}, items: ${lineItems.length} (live stock comparison)`);
            console.log(`[Stock Check] Line items:`, lineItems.map(li => `${li.item_id}: live_diff=${li.quantity_adjusted}`).join(', '));

            // Zoho "reason" field must be < 50 characters
            const shortBranch = (assignment.branch_name || 'Branch').replace(/^QC\s*-\s*/, '');
            const batchReason = `SC #${assignment.id} ${shortBranch}`.substring(0, 49);

            try {
                // Try batch push first (most efficient)
                const adjustmentData = {
                    date: checkDate,
                    reason: batchReason,
                    description: `Stock check #${assignment.id}, physical count on ${checkDate}, branch: ${assignment.branch_name || 'Unknown'} (batch push, ${lineItems.length} items)`,
                    adjustment_type: 'quantity',
                    location_id: locationId,
                    line_items: lineItems
                };

                const zohoResult = await zohoAPI.createInventoryAdjustment(adjustmentData);
                const adjId = zohoResult?.inventory_adjustment?.inventory_adjustment_id || zohoResult?.inventoryadjustment_id || null;
                if (adjId) adjustmentIds.push(adjId);
            } catch (batchErr) {
                // Batch failed (e.g. Zoho 9205 insufficient stock) — fall back to individual pushes
                console.warn(`[Stock Check] Batch push failed for assignment #${assignment.id}: ${batchErr.message}. Falling back to individual item pushes.`);

                for (const item of discrepancyItems) {
                    try {
                        const singleData = {
                            date: checkDate,
                            reason: batchReason,
                            description: `Stock check #${assignment.id}, item: ${item.item_name}, diff: ${item.live_difference}`,
                            adjustment_type: 'quantity',
                            location_id: locationId,
                            line_items: [{
                                item_id: item.zoho_item_id,
                                location_id: locationId,
                                quantity_adjusted: parseFloat(item.live_difference)
                            }]
                        };
                        const singleResult = await zohoAPI.createInventoryAdjustment(singleData);
                        const adjId = singleResult?.inventory_adjustment?.inventory_adjustment_id || singleResult?.inventoryadjustment_id || null;
                        if (adjId) adjustmentIds.push(adjId);
                    } catch (itemErr) {
                        console.error(`[Stock Check] Individual push failed for item "${item.item_name}" (${item.zoho_item_id}): ${itemErr.message}`);
                        failedItems.push({ id: item.id, name: item.item_name, error: itemErr.message });
                    }
                }
            }
        }

        // Build set of failed item IDs for skipping
        const failedIds = new Set(failedItems.map(f => f.id));

        // Update stock_check_items with live values — mark adjusted (or keep submitted if Zoho rejected)
        for (const item of items) {
            const liveSystemQty = item.current_system_qty ?? item.system_qty;
            const liveDiff = item.live_difference;
            const liveVariancePct = liveSystemQty && parseFloat(liveSystemQty) !== 0
                ? Math.round((parseFloat(liveDiff) / parseFloat(liveSystemQty)) * 10000) / 100
                : null;

            if (failedIds.has(item.id)) {
                // Zoho rejected this item — update values but keep status as 'submitted' so admin can retry
                await pool.query(
                    `UPDATE stock_check_items
                     SET system_qty = ?, difference = ?, variance_pct = ?,
                         notes = CONCAT(COALESCE(notes, ''), '\n[Zoho push failed: insufficient stock]')
                     WHERE id = ?`,
                    [liveSystemQty, liveDiff, liveVariancePct, item.id]
                );
            } else {
                await pool.query(
                    `UPDATE stock_check_items
                     SET system_qty = ?, difference = ?, variance_pct = ?, item_status = 'adjusted'
                     WHERE id = ?`,
                    [liveSystemQty, liveDiff, liveVariancePct, item.id]
                );
            }
        }

        const adjustmentId = adjustmentIds.length ? adjustmentIds.join(',') : null;

        // Check if ALL items in the assignment are now adjusted
        const [remainingItems] = await pool.query(
            `SELECT COUNT(*) as remaining FROM stock_check_items
             WHERE assignment_id = ? AND item_status NOT IN ('adjusted')`,
            [req.params.id]
        );
        const allDone = remainingItems[0].remaining === 0;

        if (allDone) {
            // All items processed → mark assignment as adjusted
            const existingAdjId = assignment.adjustment_id;
            const newAdjId = adjustmentId
                ? (existingAdjId ? `${existingAdjId},${adjustmentId}` : adjustmentId)
                : existingAdjId;

            await pool.query(
                `UPDATE stock_check_assignments
                 SET status = 'adjusted', reviewed_by = ?, reviewed_at = NOW(), adjustment_id = ?
                 WHERE id = ?`,
                [req.user.id, newAdjId, req.params.id]
            );
        } else {
            // More items still pending/checked/failed — store partial adjustment ID
            if (adjustmentId) {
                const existingAdjId = assignment.adjustment_id;
                const newAdjId = existingAdjId ? `${existingAdjId},${adjustmentId}` : adjustmentId;
                await pool.query(
                    `UPDATE stock_check_assignments SET reviewed_by = ?, adjustment_id = ? WHERE id = ?`,
                    [req.user.id, newAdjId, req.params.id]
                );
            }
        }

        const successCount = items.length - failedItems.length;
        const failedMsg = failedItems.length
            ? ` ${failedItems.length} item(s) failed (insufficient stock in Zoho): ${failedItems.map(f => f.name).join(', ')}.`
            : '';
        res.json({
            success: true,
            message: allDone
                ? `All items adjusted (${successCount} items, ${discrepancyItems.length - failedItems.length} discrepancies pushed). Assignment complete.`
                : `Pushed ${discrepancyItems.length - failedItems.length} discrepancies to Zoho (${successCount} adjusted, ${remainingItems[0].remaining} remaining).${failedMsg}`,
            data: {
                adjustment_id: adjustmentId, all_done: allDone,
                pushed: successCount, discrepancies: discrepancyItems.length,
                remaining: remainingItems[0].remaining,
                failed: failedItems
            }
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
        const { branch_id, zoho_location_id, days = 30, limit: lim = 50 } = req.query;

        if (!branch_id) {
            return res.status(400).json({ success: false, message: 'branch_id is required' });
        }

        // Use explicit location or fall back to branch default
        let locationId = zoho_location_id;
        if (!locationId) {
            const [branches] = await pool.query('SELECT zoho_location_id FROM branches WHERE id = ?', [branch_id]);
            locationId = branches.length ? branches[0].zoho_location_id : null;
        }
        if (!locationId) {
            return res.status(400).json({ success: false, message: 'No Zoho location selected or linked to branch' });
        }

        // Items in this location that haven't been checked in N days
        const [rows] = await pool.query(
            `SELECT ls.zoho_item_id, ls.item_name, ls.sku, ls.stock_on_hand,
                    MAX(sci.submitted_at) as last_checked
             FROM zoho_location_stock ls
             LEFT JOIN stock_check_items sci ON ls.zoho_item_id = sci.zoho_item_id COLLATE utf8mb4_unicode_ci
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

// ========================================
// PRODUCT SEARCH WITH LAST-CHECKED INFO
// ========================================

/** GET /api/stock-check/products/search — Search products with last-checked info */
router.get('/products/search', requireAuth, async (req, res) => {
    try {
        const { search, zoho_location_id, branch_id, limit: lim = 20 } = req.query;

        if (!search || search.length < 2) {
            return res.json({ success: true, data: [] });
        }

        // Determine location
        let locationId = zoho_location_id;
        if (!locationId) {
            const bId = branch_id;
            const effectiveBranchId = bId || (await getBranchId(req.user.id));
            if (effectiveBranchId) {
                const [locRows] = await pool.query(
                    'SELECT zoho_location_id FROM zoho_locations_map WHERE local_branch_id = ? AND is_active = 1 LIMIT 1',
                    [effectiveBranchId]
                );
                locationId = locRows.length ? locRows[0].zoho_location_id : null;
            }
        }

        if (!locationId) {
            return res.status(400).json({ success: false, message: 'Could not determine Zoho location' });
        }

        const searchTerm = '%' + search + '%';
        const [rows] = await pool.query(
            `SELECT ls.zoho_item_id, ls.item_name, ls.sku, ls.stock_on_hand,
                    MAX(sci.submitted_at) as last_checked
             FROM zoho_location_stock ls
             LEFT JOIN stock_check_items sci ON ls.zoho_item_id = sci.zoho_item_id COLLATE utf8mb4_unicode_ci
                 AND sci.submitted_at IS NOT NULL
             WHERE ls.zoho_location_id = ? AND (ls.item_name LIKE ? OR ls.sku LIKE ?)
             GROUP BY ls.zoho_item_id, ls.item_name, ls.sku, ls.stock_on_hand
             ORDER BY ls.item_name ASC
             LIMIT ?`,
            [locationId, searchTerm, searchTerm, parseInt(lim)]
        );

        res.json({ success: true, data: rows });
    } catch (error) {
        console.error('Product search error:', error);
        res.status(500).json({ success: false, message: 'Failed to search products' });
    }
});

// ========================================
// BRANCH INVENTORY (ALL ITEMS + PRICE + LAST CHECKED)
// ========================================

/** GET /api/stock-check/products/inventory — All items for a branch location */
router.get('/products/inventory', requirePermission('zoho', 'stock_check'), async (req, res) => {
    try {
        const { branch_id, zoho_location_id } = req.query;
        if (!branch_id) return res.status(400).json({ success: false, message: 'branch_id is required' });

        let locationId = zoho_location_id;
        if (!locationId) {
            const [locRows] = await pool.query(
                'SELECT zoho_location_id FROM zoho_locations_map WHERE local_branch_id = ? AND is_active = 1 LIMIT 1',
                [branch_id]
            );
            locationId = locRows.length ? locRows[0].zoho_location_id : null;
        }
        if (!locationId) return res.status(400).json({ success: false, message: 'No active location for branch' });

        const [rows] = await pool.query(
            `SELECT ls.zoho_item_id, ls.item_name, ls.sku, ls.stock_on_hand,
                    ls.last_synced_at as updated_at,
                    COALESCE(zim.zoho_rate, 0) as price,
                    zim.zoho_brand as brand, zim.zoho_category_name as category,
                    MAX(sci.submitted_at) as last_checked
             FROM zoho_location_stock ls
             LEFT JOIN zoho_items_map zim ON ls.zoho_item_id = zim.zoho_item_id COLLATE utf8mb4_unicode_ci
             LEFT JOIN stock_check_items sci ON ls.zoho_item_id = sci.zoho_item_id COLLATE utf8mb4_unicode_ci
                 AND sci.submitted_at IS NOT NULL
             WHERE ls.zoho_location_id = ?
             GROUP BY ls.zoho_item_id, ls.item_name, ls.sku, ls.stock_on_hand, ls.last_synced_at, zim.zoho_rate, zim.zoho_brand, zim.zoho_category_name
             ORDER BY ls.item_name ASC`,
            [locationId]
        );

        res.json({ success: true, data: rows, total: rows.length });
    } catch (error) {
        console.error('Products inventory error:', error);
        res.status(500).json({ success: false, message: 'Failed to load inventory' });
    }
});

/** Helper: get user's branch_id from DB */
async function getBranchId(userId) {
    const [rows] = await pool.query('SELECT branch_id FROM users WHERE id = ?', [userId]);
    return rows.length ? rows[0].branch_id : null;
}

module.exports = { router, setPool };
