/**
 * Painter Management Routes
 * Public, Painter-Auth, and Admin endpoints for painter loyalty system
 *
 * IMPORTANT: Named routes (config/*, invoice/*, withdrawals, attendance, referrals, reports/*)
 * MUST be defined BEFORE parameterized /:id routes to avoid Express matching conflicts.
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { requirePermission, requireAuth } = require('../middleware/permissionMiddleware');
const pointsEngine = require('../services/painter-points-engine');

let pool;
let io;
let sessionManager;

function setPool(p) {
    pool = p;
    pointsEngine.setPool(p);
}

function setIO(ioInstance) { io = ioInstance; }
function setSessionManager(sm) { sessionManager = sm; }

// ═══════════════════════════════════════════
// PAINTER AUTH MIDDLEWARE
// ═══════════════════════════════════════════

async function requirePainterAuth(req, res, next) {
    const token = req.headers['x-painter-token'];
    if (!token) return res.status(401).json({ success: false, message: 'Painter authentication required' });

    try {
        const [sessions] = await pool.query(
            'SELECT ps.painter_id, p.status, p.full_name FROM painter_sessions ps JOIN painters p ON ps.painter_id = p.id WHERE ps.token = ? AND ps.expires_at > NOW()',
            [token]
        );
        if (!sessions.length) return res.status(401).json({ success: false, message: 'Invalid or expired session' });
        if (sessions[0].status !== 'approved') return res.status(403).json({ success: false, message: `Account is ${sessions[0].status}` });

        req.painter = { id: sessions[0].painter_id, name: sessions[0].full_name };
        next();
    } catch (error) {
        console.error('Painter auth error:', error);
        res.status(500).json({ success: false, message: 'Authentication error' });
    }
}

// ═══════════════════════════════════════════
// PUBLIC ENDPOINTS (no auth)
// ═══════════════════════════════════════════

// Register a new painter
router.post('/register', async (req, res) => {
    try {
        const { full_name, phone, email, city, district, experience_years, specialization, referral_code, aadhar_number, pan_number, address, pincode } = req.body;

        if (!full_name || !phone) return res.status(400).json({ success: false, message: 'Name and phone are required' });

        const [existing] = await pool.query('SELECT id, status FROM painters WHERE phone = ?', [phone]);
        if (existing.length > 0) {
            return res.status(400).json({ success: false, message: `Phone already registered (status: ${existing[0].status})` });
        }

        let myReferralCode = pointsEngine.generateReferralCode(full_name);
        const [codeCheck] = await pool.query('SELECT id FROM painters WHERE referral_code = ?', [myReferralCode]);
        if (codeCheck.length > 0) {
            myReferralCode = pointsEngine.generateReferralCode(full_name) + Math.floor(Math.random() * 10);
        }

        let referredBy = null;
        if (referral_code) {
            const [referrer] = await pool.query('SELECT id FROM painters WHERE referral_code = ? AND status = "approved"', [referral_code]);
            if (referrer.length > 0) referredBy = referrer[0].id;
        }

        const [result] = await pool.query(
            `INSERT INTO painters (full_name, phone, email, city, district, experience_years, specialization, referral_code, referred_by, aadhar_number, pan_number, address, pincode)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [full_name, phone, email || null, city || null, district || null, experience_years || 0,
             specialization || 'both', myReferralCode, referredBy, aadhar_number || null, pan_number || null, address || null, pincode || null]
        );

        if (referredBy) {
            await pool.query('INSERT INTO painter_referrals (referrer_id, referred_id, status) VALUES (?, ?, "pending")', [referredBy, result.insertId]);
        }

        res.json({ success: true, message: 'Registration submitted. Awaiting approval.', painterId: result.insertId, referralCode: myReferralCode });
    } catch (error) {
        console.error('Painter registration error:', error);
        res.status(500).json({ success: false, message: 'Registration failed' });
    }
});

// Send OTP
router.post('/send-otp', async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone) return res.status(400).json({ success: false, message: 'Phone is required' });

        const [painters] = await pool.query('SELECT id, status, full_name FROM painters WHERE phone = ?', [phone]);
        if (!painters.length) return res.status(404).json({ success: false, message: 'No painter found with this phone number' });

        const painter = painters[0];
        const otp = String(Math.floor(100000 + Math.random() * 900000));
        const token = crypto.randomBytes(32).toString('hex');

        await pool.query('DELETE FROM painter_sessions WHERE painter_id = ? AND expires_at < NOW()', [painter.id]);

        await pool.query(
            'INSERT INTO painter_sessions (painter_id, token, otp, otp_expires_at, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE), DATE_ADD(NOW(), INTERVAL 30 DAY))',
            [painter.id, token, otp]
        );

        // Send OTP via WhatsApp using General session (branch_id=0)
        console.log(`[Painter OTP] Phone: ${phone}, OTP: ${otp}`);
        if (sessionManager) {
            try {
                const otpMessage = `🎨 *Quality Colours Painter Program*\n\nYour OTP is: *${otp}*\n\nValid for 10 minutes. Do not share this code with anyone.`;
                await sessionManager.sendMessage(0, phone, otpMessage, { source: 'painter_otp' });
                console.log(`[Painter OTP] WhatsApp sent to ${phone}`);
            } catch (waErr) {
                console.error(`[Painter OTP] WhatsApp send failed for ${phone}:`, waErr.message);
            }
        }
        res.json({ success: true, message: 'OTP sent', status: painter.status });
    } catch (error) {
        console.error('Send OTP error:', error);
        res.status(500).json({ success: false, message: 'Failed to send OTP' });
    }
});

// Verify OTP
router.post('/verify-otp', async (req, res) => {
    try {
        const { phone, otp } = req.body;
        if (!phone || !otp) return res.status(400).json({ success: false, message: 'Phone and OTP are required' });

        const [sessions] = await pool.query(
            `SELECT ps.id, ps.token, ps.painter_id, p.status, p.full_name, p.referral_code
             FROM painter_sessions ps JOIN painters p ON ps.painter_id = p.id
             WHERE p.phone = ? AND ps.otp = ? AND ps.otp_expires_at > NOW()
             ORDER BY ps.id DESC LIMIT 1`,
            [phone, otp]
        );

        if (!sessions.length) return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });

        const session = sessions[0];
        await pool.query('UPDATE painter_sessions SET otp = NULL, otp_expires_at = NULL WHERE id = ?', [session.id]);

        res.json({
            success: true, token: session.token,
            painter: { id: session.painter_id, name: session.full_name, status: session.status, referralCode: session.referral_code }
        });
    } catch (error) {
        console.error('Verify OTP error:', error);
        res.status(500).json({ success: false, message: 'Verification failed' });
    }
});

// Validate referral code
router.get('/validate-referral/:code', async (req, res) => {
    try {
        const [painter] = await pool.query('SELECT id, full_name, city FROM painters WHERE referral_code = ? AND status = "approved"', [req.params.code]);
        if (!painter.length) return res.json({ success: false, valid: false });
        res.json({ success: true, valid: true, referrer: { name: painter[0].full_name, city: painter[0].city } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Validation failed' });
    }
});

// ═══════════════════════════════════════════
// PAINTER-AUTH ENDPOINTS (/me/*)
// ═══════════════════════════════════════════

router.get('/me', requirePainterAuth, async (req, res) => {
    try {
        const [painters] = await pool.query('SELECT * FROM painters WHERE id = ?', [req.painter.id]);
        if (!painters.length) return res.status(404).json({ success: false, message: 'Painter not found' });
        const p = painters[0];
        delete p.aadhar_number;
        res.json({ success: true, painter: p });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to get profile' });
    }
});

router.put('/me', requirePainterAuth, async (req, res) => {
    try {
        const { email, address, city, district, pincode, experience_years, specialization } = req.body;
        await pool.query(
            `UPDATE painters SET email = COALESCE(?, email), address = COALESCE(?, address), city = COALESCE(?, city),
             district = COALESCE(?, district), pincode = COALESCE(?, pincode), experience_years = COALESCE(?, experience_years),
             specialization = COALESCE(?, specialization) WHERE id = ?`,
            [email, address, city, district, pincode, experience_years, specialization, req.painter.id]
        );
        res.json({ success: true, message: 'Profile updated' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update profile' });
    }
});

router.get('/me/points/:pool', requirePainterAuth, async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        const transactions = await pointsEngine.getLedger(req.painter.id, req.params.pool, limit, offset);
        const balance = await pointsEngine.getBalance(req.painter.id);
        res.json({ success: true, transactions, balance });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to get transactions' });
    }
});

router.get('/me/referrals', requirePainterAuth, async (req, res) => {
    try {
        const [referrals] = await pool.query(
            `SELECT pr.*, p.full_name, p.phone, p.status as painter_status, p.city
             FROM painter_referrals pr JOIN painters p ON pr.referred_id = p.id
             WHERE pr.referrer_id = ? ORDER BY pr.created_at DESC`,
            [req.painter.id]
        );
        res.json({ success: true, referrals });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to get referrals' });
    }
});

router.post('/me/withdraw', requirePainterAuth, async (req, res) => {
    try {
        const { pool: pointPool, amount } = req.body;
        if (!pointPool || !amount || amount <= 0) return res.status(400).json({ success: false, message: 'Pool and positive amount are required' });
        const result = await pointsEngine.requestWithdrawal(req.painter.id, pointPool, parseFloat(amount));
        res.json({ success: true, message: 'Withdrawal requested', ...result });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
});

router.get('/me/withdrawals', requirePainterAuth, async (req, res) => {
    try {
        const [withdrawals] = await pool.query('SELECT * FROM painter_withdrawals WHERE painter_id = ? ORDER BY requested_at DESC', [req.painter.id]);
        res.json({ success: true, withdrawals });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to get withdrawals' });
    }
});

router.get('/me/invoices', requirePainterAuth, async (req, res) => {
    try {
        const [invoices] = await pool.query('SELECT * FROM painter_invoices_processed WHERE painter_id = ? ORDER BY processed_at DESC', [req.painter.id]);
        res.json({ success: true, invoices });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to get invoices' });
    }
});

router.get('/me/attendance', requirePainterAuth, async (req, res) => {
    try {
        const [records] = await pool.query('SELECT * FROM painter_attendance WHERE painter_id = ? ORDER BY check_in_at DESC', [req.painter.id]);
        res.json({ success: true, attendance: records });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to get attendance' });
    }
});

router.get('/me/dashboard', requirePainterAuth, async (req, res) => {
    try {
        const balance = await pointsEngine.getBalance(req.painter.id);
        const [referralCount] = await pool.query('SELECT COUNT(*) as count FROM painter_referrals WHERE referrer_id = ?', [req.painter.id]);
        const [recentTxns] = await pool.query('SELECT * FROM painter_point_transactions WHERE painter_id = ? ORDER BY created_at DESC LIMIT 10', [req.painter.id]);
        const [pendingWithdrawals] = await pool.query('SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM painter_withdrawals WHERE painter_id = ? AND status = "pending"', [req.painter.id]);
        const [painter] = await pool.query('SELECT referral_code FROM painters WHERE id = ?', [req.painter.id]);

        res.json({
            success: true,
            dashboard: {
                balance,
                referralCode: painter[0]?.referral_code,
                referralCount: referralCount[0].count,
                recentTransactions: recentTxns,
                pendingWithdrawals: { count: pendingWithdrawals[0].count, total: parseFloat(pendingWithdrawals[0].total) }
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to load dashboard' });
    }
});

// ═══════════════════════════════════════════════════════════════
// ADMIN NAMED ROUTES (must come BEFORE /:id parameterized routes)
// ═══════════════════════════════════════════════════════════════

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

// --- PRODUCT RATES CONFIG ---

router.get('/config/product-rates', requireAuth, async (req, res) => {
    try {
        const [rates] = await pool.query('SELECT * FROM painter_product_point_rates ORDER BY category, item_name');
        res.json({ success: true, rates });
    } catch (error) {
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
        const [items] = await pool.query("SELECT item_id, name, category FROM zoho_items_cache WHERE status = 'active' ORDER BY name");
        let synced = 0;
        for (const item of items) {
            const [existing] = await pool.query('SELECT id FROM painter_product_point_rates WHERE item_id = ?', [item.item_id]);
            if (!existing.length) {
                await pool.query('INSERT INTO painter_product_point_rates (item_id, item_name, category) VALUES (?, ?, ?)', [item.item_id, item.name, item.category || null]);
                synced++;
            }
        }
        res.json({ success: true, message: `${synced} new items synced`, total: items.length });
    } catch (error) {
        console.error('Sync rates error:', error);
        res.status(500).json({ success: false, message: 'Failed to sync rates. Zoho items cache may not exist.' });
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
        const result = await pointsEngine.processWithdrawal(parseInt(req.params.id), action, req.user.id, payment_reference, notes);
        res.json({ success: true, message: `Withdrawal ${action}d`, ...result });
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

// ═══════════════════════════════════════════════════════════════
// ADMIN PARAMETERIZED ROUTES (/:id) — MUST be AFTER named routes
// ═══════════════════════════════════════════════════════════════

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

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
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
        const { full_name, email, phone, city, district, state, pincode, experience_years, specialization, notes, zoho_contact_id } = req.body;
        await pool.query(
            `UPDATE painters SET full_name = COALESCE(?, full_name), email = COALESCE(?, email), phone = COALESCE(?, phone),
             city = COALESCE(?, city), district = COALESCE(?, district), state = COALESCE(?, state), pincode = COALESCE(?, pincode),
             experience_years = COALESCE(?, experience_years), specialization = COALESCE(?, specialization),
             notes = COALESCE(?, notes), zoho_contact_id = COALESCE(?, zoho_contact_id) WHERE id = ?`,
            [full_name, email, phone, city, district, state, pincode, experience_years, specialization, notes, zoho_contact_id, req.params.id]
        );
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
        await pool.query('UPDATE painters SET status = ?, approved_by = ?, approved_at = NOW() WHERE id = ?', [status, req.user.id, req.params.id]);

        if (action === 'approve') {
            await pool.query('UPDATE painter_referrals SET status = "active" WHERE referred_id = ?', [req.params.id]);
        }

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
        await pool.query('UPDATE painters SET credit_enabled = ?, credit_limit = ? WHERE id = ?',
            [credit_enabled ? 1 : 0, parseFloat(credit_limit) || 0, req.params.id]);
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
        if (amt > 0) {
            await pointsEngine.addPoints(parseInt(req.params.id), pointPool, amt, 'admin_adjustment', null, null, description || 'Admin adjustment', req.user.id);
        } else if (amt < 0) {
            await pointsEngine.deductPoints(parseInt(req.params.id), pointPool, Math.abs(amt), 'admin_adjustment', null, null, description || 'Admin adjustment', req.user.id);
        }

        const balance = await pointsEngine.getBalance(parseInt(req.params.id));
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

module.exports = { router, setPool, setIO, setSessionManager };
