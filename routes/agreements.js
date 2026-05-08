/**
 * Staff Employment Agreement Routes
 * Handles agreement viewing, signed-doc upload, and admin management.
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { requireAuth } = require('../middleware/permissionMiddleware');

let pool;
function setPool(dbPool) { pool = dbPool; }

// ── upload config ────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, '../public/uploads/agreements');
        fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.pdf';
        cb(null, `agreement_${req.user.id}_${Date.now()}${ext}`);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
    fileFilter: (req, file, cb) => {
        const allowed = ['.pdf', '.jpg', '.jpeg', '.png'];
        if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
        else cb(new Error('Only PDF/JPG/PNG files allowed'));
    }
});

// ── helpers ──────────────────────────────────────────────────────────────────
function getNowIST() {
    return new Date(new Date().getTime() + 5.5 * 60 * 60 * 1000);
}

// ── STAFF ENDPOINTS ──────────────────────────────────────────────────────────

/**
 * GET /api/agreements/my
 * Returns the active agreement + this staff member's record status.
 */
router.get('/my', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const [agr] = await pool.query(
            'SELECT * FROM staff_agreements WHERE is_active = 1 ORDER BY id DESC LIMIT 1'
        );
        if (!agr.length) return res.json({ success: true, agreement: null, record: null });

        const agreementId = agr[0].id;

        // Upsert: ensure a record exists for this user
        await pool.query(
            `INSERT IGNORE INTO staff_agreement_records (agreement_id, user_id) VALUES (?, ?)`,
            [agreementId, userId]
        );

        const [rec] = await pool.query(
            'SELECT * FROM staff_agreement_records WHERE user_id = ?', [userId]
        );

        // Fetch user details for agreement personalisation
        const [users] = await pool.query(
            `SELECT u.full_name, u.role, u.email, u.phone, u.created_at AS joined_at,
                    b.name AS branch_name, sc.monthly_salary
             FROM users u
             LEFT JOIN branches b ON u.branch_id = b.id
             LEFT JOIN staff_salary_config sc ON sc.user_id = u.id
             WHERE u.id = ?`, [userId]
        );

        res.json({
            success: true,
            agreement: agr[0],
            record: rec[0] || null,
            staff: users[0] || {}
        });
    } catch (err) {
        console.error('Agreement GET /my error:', err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * POST /api/agreements/viewed
 * Mark agreement as viewed by this staff member.
 */
router.post('/viewed', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        await pool.query(
            `UPDATE staff_agreement_records
             SET status = IF(status = 'pending', 'viewed', status),
                 viewed_at = IF(viewed_at IS NULL, ?, viewed_at)
             WHERE user_id = ?`,
            [getNowIST().toISOString().replace('T', ' ').substring(0, 19), userId]
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * POST /api/agreements/upload
 * Staff uploads their signed agreement document.
 */
router.post('/upload', requireAuth, upload.single('document'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'File required' });
        const filePath = `/uploads/agreements/${req.file.filename}`;
        const now = getNowIST().toISOString().replace('T', ' ').substring(0, 19);
        await pool.query(
            `UPDATE staff_agreement_records
             SET status = 'uploaded', signed_document = ?, uploaded_at = ?
             WHERE user_id = ?`,
            [filePath, now, req.user.id]
        );
        res.json({ success: true, path: filePath });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ── ADMIN ENDPOINTS ──────────────────────────────────────────────────────────

/**
 * GET /api/agreements/admin/staff-list
 * Returns all active staff with their agreement status.
 */
router.get('/admin/staff-list', requireAuth, async (req, res) => {
    try {
        if (!['admin', 'manager'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }
        const [rows] = await pool.query(
            `SELECT u.id, u.full_name, u.role, u.phone, u.status,
                    b.name AS branch_name,
                    r.status AS agreement_status, r.viewed_at, r.uploaded_at, r.signed_document
             FROM users u
             LEFT JOIN branches b ON u.branch_id = b.id
             LEFT JOIN staff_agreement_records r ON r.user_id = u.id
             WHERE u.role NOT IN ('admin','customer','guest','retail_customer')
               AND u.status = 'active'
             ORDER BY u.full_name`
        );
        res.json({ success: true, staff: rows });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * POST /api/agreements/admin/assign-all
 * Creates pending agreement records for all active staff who don't have one yet.
 */
router.post('/admin/assign-all', requireAuth, async (req, res) => {
    try {
        if (!['admin', 'manager'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }
        const [agr] = await pool.query('SELECT id FROM staff_agreements WHERE is_active = 1 ORDER BY id DESC LIMIT 1');
        if (!agr.length) return res.status(400).json({ success: false, message: 'No active agreement' });
        const agreementId = agr[0].id;

        const [staff] = await pool.query(
            `SELECT id FROM users WHERE role NOT IN ('admin','customer','guest','retail_customer') AND status = 'active'`
        );
        let count = 0;
        for (const s of staff) {
            const [r] = await pool.query('SELECT id FROM staff_agreement_records WHERE user_id = ?', [s.id]);
            if (!r.length) {
                await pool.query(
                    'INSERT INTO staff_agreement_records (agreement_id, user_id, assigned_by) VALUES (?, ?, ?)',
                    [agreementId, s.id, req.user.id]
                );
                count++;
            }
        }
        res.json({ success: true, assigned: count });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * GET /api/agreements/admin/stats
 */
router.get('/admin/stats', requireAuth, async (req, res) => {
    try {
        if (!['admin', 'manager'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }
        const [total] = await pool.query(
            `SELECT COUNT(*) as c FROM users WHERE role NOT IN ('admin','customer','guest','retail_customer') AND status='active'`
        );
        const [uploaded] = await pool.query(`SELECT COUNT(*) as c FROM staff_agreement_records WHERE status='uploaded'`);
        const [viewed] = await pool.query(`SELECT COUNT(*) as c FROM staff_agreement_records WHERE status='viewed'`);
        const [pending] = await pool.query(`SELECT COUNT(*) as c FROM staff_agreement_records WHERE status='pending'`);
        res.json({
            success: true,
            stats: {
                total: total[0].c,
                uploaded: uploaded[0].c,
                viewed: viewed[0].c,
                pending: pending[0].c,
                not_assigned: total[0].c - uploaded[0].c - viewed[0].c - pending[0].c
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = { router, setPool };
