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
const zohoAPI = require('../services/zoho-api');

let pool;
let io;
let sessionManager;

function setPool(p) {
    pool = p;
    pointsEngine.setPool(p);
    zohoAPI.setPool(p);
}

function setIO(ioInstance) { io = ioInstance; }
function setSessionManager(sm) { sessionManager = sm; }

// ─── Estimate Status History Logging ─────────────────────────
async function logEstimateStatusChange(estimateId, oldStatus, newStatus, changedBy, notes) {
    try {
        await pool.query(
            `INSERT INTO estimate_status_history (estimate_id, estimate_type, old_status, new_status, changed_by_user_id, notes, timestamp)
             VALUES (?, 'painter', ?, ?, ?, ?, NOW())`,
            [estimateId, oldStatus, newStatus, changedBy, notes || null]
        );
    } catch (err) {
        console.error('[Painters] Failed to log estimate status change:', err.message);
    }
}

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
// PUBLIC ESTIMATE SHARE (no auth)
// ═══════════════════════════════════════════

router.get('/estimates/share/:token', async (req, res) => {
    try {
        const [estimates] = await pool.query(
            `SELECT pe.*, p.full_name as painter_name, p.phone as painter_phone
             FROM painter_estimates pe
             JOIN painters p ON pe.painter_id = p.id
             WHERE pe.share_token = ? AND pe.share_token_expires_at > NOW()
             AND pe.status IN ('sent_to_customer','approved','payment_recorded','pushed_to_zoho')`,
            [req.params.token]
        );
        if (!estimates.length) return res.status(404).json({ success: false, message: 'Estimate not found or link expired' });

        const estimate = estimates[0];
        const [items] = await pool.query(
            'SELECT * FROM painter_estimate_items WHERE estimate_id = ? ORDER BY display_order, id', [estimate.id]
        );

        // Return markup prices for customer view
        res.json({
            success: true,
            estimate: {
                estimate_number: estimate.estimate_number,
                customer_name: estimate.customer_name,
                customer_phone: estimate.customer_phone,
                customer_address: estimate.customer_address,
                subtotal: parseFloat(estimate.markup_subtotal),
                gst_amount: parseFloat(estimate.markup_gst_amount),
                grand_total: parseFloat(estimate.markup_grand_total),
                status: estimate.status,
                created_at: estimate.created_at,
                painter_name: estimate.painter_name
            },
            items: items.map(i => ({
                item_name: i.item_name,
                brand: i.brand,
                category: i.category,
                quantity: parseFloat(i.quantity),
                unit_price: parseFloat(i.markup_unit_price),
                line_total: parseFloat(i.markup_line_total)
            }))
        });
    } catch (error) {
        console.error('Share estimate error:', error);
        res.status(500).json({ success: false, message: 'Failed to load estimate' });
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

// ═══════════════════════════════════════════
// PAINTER ESTIMATE ENDPOINTS (/me/estimates/*)
// ═══════════════════════════════════════════

// Helper: generate estimate number PE + YYYYMMDD + 4-digit seq
async function generateEstimateNumber() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const prefix = `PE${y}${m}${d}`;
    const [rows] = await pool.query(
        "SELECT estimate_number FROM painter_estimates WHERE estimate_number LIKE ? ORDER BY id DESC LIMIT 1",
        [prefix + '%']
    );
    let seq = 1;
    if (rows.length) {
        const last = rows[0].estimate_number;
        seq = parseInt(last.substring(prefix.length)) + 1;
    }
    return prefix + String(seq).padStart(4, '0');
}

// Product list for estimate builder
router.get('/me/estimates/products', requirePainterAuth, async (req, res) => {
    try {
        const { billing_type, search, brand, category } = req.query;
        let where = "WHERE (zim.zoho_status = 'active' OR zim.zoho_status IS NULL)";
        const params = [];

        if (search) {
            where += ' AND (zim.zoho_item_name LIKE ? OR zim.zoho_brand LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }
        if (brand) {
            where += ' AND zim.zoho_brand = ?';
            params.push(brand);
        }
        if (category) {
            where += ' AND zim.zoho_category_name = ?';
            params.push(category);
        }

        const [items] = await pool.query(`
            SELECT zim.zoho_item_id as item_id, zim.zoho_item_name as name,
                   zim.zoho_brand as brand, zim.zoho_category_name as category,
                   zim.zoho_rate as rate, zim.zoho_stock_on_hand as stock
            FROM zoho_items_map zim
            ${where}
            ORDER BY zim.zoho_brand, zim.zoho_item_name
            LIMIT 500
        `, params);

        // Get filter options
        const [brands] = await pool.query(`
            SELECT DISTINCT zoho_brand as brand FROM zoho_items_map
            WHERE zoho_brand IS NOT NULL AND zoho_brand != ''
            AND (zoho_status = 'active' OR zoho_status IS NULL)
            ORDER BY zoho_brand
        `);
        const [categories] = await pool.query(`
            SELECT DISTINCT zoho_category_name as category FROM zoho_items_map
            WHERE zoho_category_name IS NOT NULL AND zoho_category_name != ''
            AND (zoho_status = 'active' OR zoho_status IS NULL)
            ORDER BY zoho_category_name
        `);

        // Self-billing: show prices. Customer-billing: hide prices
        const showPrices = billing_type === 'self';
        const mapped = items.map(i => ({
            item_id: i.item_id,
            name: i.name,
            brand: i.brand,
            category: i.category,
            rate: showPrices ? parseFloat(i.rate || 0) : null,
            stock: parseFloat(i.stock || 0)
        }));

        res.json({
            success: true,
            products: mapped,
            brands: brands.map(b => b.brand),
            categories: categories.map(c => c.category)
        });
    } catch (error) {
        console.error('Estimate products error:', error);
        res.status(500).json({ success: false, message: 'Failed to load products' });
    }
});

// List painter's estimates
router.get('/me/estimates', requirePainterAuth, async (req, res) => {
    try {
        const { status, limit = 50, offset = 0 } = req.query;
        let query = 'SELECT * FROM painter_estimates WHERE painter_id = ?';
        const params = [req.painter.id];
        if (status) { query += ' AND status = ?'; params.push(status); }
        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));
        const [estimates] = await pool.query(query, params);
        res.json({ success: true, estimates });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to load estimates' });
    }
});

// Create estimate
router.post('/me/estimates', requirePainterAuth, async (req, res) => {
    try {
        const { billing_type, customer_name, customer_phone, customer_address, items, notes, submit } = req.body;
        if (!billing_type || !['self', 'customer'].includes(billing_type)) {
            return res.status(400).json({ success: false, message: 'billing_type must be self or customer' });
        }
        if (billing_type === 'customer' && !customer_name) {
            return res.status(400).json({ success: false, message: 'Customer name is required for customer billing' });
        }
        if (!items || !items.length) {
            return res.status(400).json({ success: false, message: 'At least one item is required' });
        }

        // Fetch GST config
        const [gstConfig] = await pool.query("SELECT config_value FROM ai_config WHERE config_key = 'painter_estimate_gst_pct'");
        const gstPct = gstConfig.length ? parseFloat(gstConfig[0].config_value) : 18;

        // Validate items and get server-side prices from zoho_items_map
        const itemIds = items.map(i => i.item_id);
        const [zohoItems] = await pool.query(
            `SELECT zoho_item_id, zoho_item_name, zoho_brand, zoho_category_name, zoho_rate
             FROM zoho_items_map WHERE zoho_item_id IN (?)`, [itemIds]
        );
        const zohoMap = {};
        zohoItems.forEach(z => { zohoMap[z.zoho_item_id] = z; });

        const estimateNumber = await generateEstimateNumber();
        const status = submit ? 'pending_admin' : 'draft';

        // Calculate totals from server-side prices
        let subtotal = 0;
        const lineItems = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const zohoItem = zohoMap[item.item_id];
            if (!zohoItem) {
                return res.status(400).json({ success: false, message: `Product not found: ${item.item_id}` });
            }
            const qty = parseFloat(item.quantity) || 1;
            const unitPrice = parseFloat(zohoItem.zoho_rate) || 0;
            const lineTotal = qty * unitPrice;
            subtotal += lineTotal;
            lineItems.push({
                zoho_item_id: item.item_id,
                item_name: zohoItem.zoho_item_name,
                brand: zohoItem.zoho_brand,
                category: zohoItem.zoho_category_name,
                quantity: qty,
                unit_price: unitPrice,
                line_total: lineTotal,
                display_order: i
            });
        }

        const gstAmount = subtotal * (gstPct / 100);
        const grandTotal = subtotal + gstAmount;

        const [result] = await pool.query(
            `INSERT INTO painter_estimates
             (estimate_number, painter_id, billing_type, customer_name, customer_phone, customer_address,
              subtotal, gst_amount, grand_total, status, notes, created_by_painter)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [estimateNumber, req.painter.id, billing_type,
             customer_name || null, customer_phone || null, customer_address || null,
             subtotal, gstAmount, grandTotal, status, notes || null, req.painter.id]
        );

        const estimateId = result.insertId;

        // Insert line items
        for (const li of lineItems) {
            await pool.query(
                `INSERT INTO painter_estimate_items
                 (estimate_id, zoho_item_id, item_name, brand, category, quantity, unit_price, line_total, display_order)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [estimateId, li.zoho_item_id, li.item_name, li.brand, li.category,
                 li.quantity, li.unit_price, li.line_total, li.display_order]
            );
        }

        res.json({
            success: true,
            message: submit ? 'Estimate submitted for review' : 'Draft saved',
            estimateId,
            estimateNumber
        });
    } catch (error) {
        console.error('Create estimate error:', error);
        res.status(500).json({ success: false, message: 'Failed to create estimate' });
    }
});

// Get single estimate
router.get('/me/estimates/:estimateId', requirePainterAuth, async (req, res) => {
    try {
        const [estimates] = await pool.query(
            'SELECT * FROM painter_estimates WHERE id = ? AND painter_id = ?',
            [req.params.estimateId, req.painter.id]
        );
        if (!estimates.length) return res.status(404).json({ success: false, message: 'Estimate not found' });

        const [items] = await pool.query(
            'SELECT * FROM painter_estimate_items WHERE estimate_id = ? ORDER BY display_order, id',
            [estimates[0].id]
        );

        res.json({ success: true, estimate: estimates[0], items });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to load estimate' });
    }
});

// Update draft estimate
router.put('/me/estimates/:estimateId', requirePainterAuth, async (req, res) => {
    try {
        const [estimates] = await pool.query(
            "SELECT * FROM painter_estimates WHERE id = ? AND painter_id = ? AND status = 'draft'",
            [req.params.estimateId, req.painter.id]
        );
        if (!estimates.length) return res.status(404).json({ success: false, message: 'Draft estimate not found' });

        const { billing_type, customer_name, customer_phone, customer_address, items, notes } = req.body;
        const bt = billing_type || estimates[0].billing_type;

        // Fetch GST config
        const [gstConfig] = await pool.query("SELECT config_value FROM ai_config WHERE config_key = 'painter_estimate_gst_pct'");
        const gstPct = gstConfig.length ? parseFloat(gstConfig[0].config_value) : 18;

        if (items && items.length) {
            const itemIds = items.map(i => i.item_id);
            const [zohoItems] = await pool.query(
                `SELECT zoho_item_id, zoho_item_name, zoho_brand, zoho_category_name, zoho_rate
                 FROM zoho_items_map WHERE zoho_item_id IN (?)`, [itemIds]
            );
            const zohoMap = {};
            zohoItems.forEach(z => { zohoMap[z.zoho_item_id] = z; });

            // Delete old items and re-insert
            await pool.query('DELETE FROM painter_estimate_items WHERE estimate_id = ?', [estimates[0].id]);

            let subtotal = 0;
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                const zohoItem = zohoMap[item.item_id];
                if (!zohoItem) continue;
                const qty = parseFloat(item.quantity) || 1;
                const unitPrice = parseFloat(zohoItem.zoho_rate) || 0;
                const lineTotal = qty * unitPrice;
                subtotal += lineTotal;
                await pool.query(
                    `INSERT INTO painter_estimate_items
                     (estimate_id, zoho_item_id, item_name, brand, category, quantity, unit_price, line_total, display_order)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [estimates[0].id, item.item_id, zohoItem.zoho_item_name, zohoItem.zoho_brand,
                     zohoItem.zoho_category_name, qty, unitPrice, lineTotal, i]
                );
            }

            const gstAmount = subtotal * (gstPct / 100);
            const grandTotal = subtotal + gstAmount;
            await pool.query(
                `UPDATE painter_estimates SET billing_type = ?, customer_name = ?, customer_phone = ?,
                 customer_address = ?, subtotal = ?, gst_amount = ?, grand_total = ?, notes = ? WHERE id = ?`,
                [bt, customer_name || null, customer_phone || null, customer_address || null,
                 subtotal, gstAmount, grandTotal, notes || null, estimates[0].id]
            );
        } else {
            await pool.query(
                `UPDATE painter_estimates SET billing_type = ?, customer_name = ?, customer_phone = ?,
                 customer_address = ?, notes = ? WHERE id = ?`,
                [bt, customer_name || null, customer_phone || null, customer_address || null,
                 notes || null, estimates[0].id]
            );
        }

        res.json({ success: true, message: 'Estimate updated' });
    } catch (error) {
        console.error('Update estimate error:', error);
        res.status(500).json({ success: false, message: 'Failed to update estimate' });
    }
});

// Submit draft → pending_admin
router.post('/me/estimates/:estimateId/submit', requirePainterAuth, async (req, res) => {
    try {
        const [estimates] = await pool.query(
            "SELECT * FROM painter_estimates WHERE id = ? AND painter_id = ? AND status = 'draft'",
            [req.params.estimateId, req.painter.id]
        );
        if (!estimates.length) return res.status(404).json({ success: false, message: 'Draft estimate not found' });

        // Verify has items
        const [items] = await pool.query('SELECT COUNT(*) as cnt FROM painter_estimate_items WHERE estimate_id = ?', [estimates[0].id]);
        if (items[0].cnt === 0) return res.status(400).json({ success: false, message: 'Add at least one item before submitting' });

        await pool.query("UPDATE painter_estimates SET status = 'pending_admin' WHERE id = ?", [estimates[0].id]);
        await logEstimateStatusChange(estimates[0].id, 'draft', 'pending_admin', req.painter.id, 'Painter submitted for review');
        res.json({ success: true, message: 'Estimate submitted for admin review' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to submit estimate' });
    }
});

// Cancel draft
router.delete('/me/estimates/:estimateId', requirePainterAuth, async (req, res) => {
    try {
        const [estimates] = await pool.query(
            "SELECT * FROM painter_estimates WHERE id = ? AND painter_id = ? AND status = 'draft'",
            [req.params.estimateId, req.painter.id]
        );
        if (!estimates.length) return res.status(404).json({ success: false, message: 'Draft estimate not found' });

        await pool.query("UPDATE painter_estimates SET status = 'cancelled' WHERE id = ?", [estimates[0].id]);
        await logEstimateStatusChange(estimates[0].id, 'draft', 'cancelled', req.painter.id, 'Painter cancelled estimate');
        res.json({ success: true, message: 'Estimate cancelled' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to cancel estimate' });
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
                'SELECT estimate_id, COUNT(*) as item_count, SUM(quantity) as total_qty FROM painter_estimate_items WHERE estimate_id IN (?) GROUP BY estimate_id',
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
            'SELECT * FROM painter_estimate_items WHERE estimate_id = ? ORDER BY display_order, id',
            [estimates[0].id]
        );

        res.json({ success: true, estimate: estimates[0], items });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to load estimate' });
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
                'SELECT SUM(markup_unit_price) as total FROM painter_estimate_items WHERE estimate_id = ?',
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

// Set markup prices (customer billing)
router.post('/estimates/:estimateId/markup', requirePermission('painters', 'estimates'), async (req, res) => {
    try {
        const { items } = req.body; // [{ id, markup_unit_price }]
        if (!items || !items.length) return res.status(400).json({ success: false, message: 'Items with markup prices required' });

        const [estimates] = await pool.query(
            "SELECT * FROM painter_estimates WHERE id = ? AND billing_type = 'customer' AND status IN ('pending_admin','admin_review')",
            [req.params.estimateId]
        );
        if (!estimates.length) return res.status(404).json({ success: false, message: 'Customer-billing estimate not found' });

        const [gstConfig] = await pool.query("SELECT config_value FROM ai_config WHERE config_key = 'painter_estimate_gst_pct'");
        const gstPct = gstConfig.length ? parseFloat(gstConfig[0].config_value) : 18;

        let markupSubtotal = 0;
        for (const item of items) {
            const markupPrice = parseFloat(item.markup_unit_price) || 0;
            const [lineItem] = await pool.query('SELECT quantity FROM painter_estimate_items WHERE id = ? AND estimate_id = ?', [item.id, estimates[0].id]);
            if (!lineItem.length) continue;
            const markupLineTotal = markupPrice * parseFloat(lineItem[0].quantity);
            markupSubtotal += markupLineTotal;
            await pool.query(
                'UPDATE painter_estimate_items SET markup_unit_price = ?, markup_line_total = ? WHERE id = ?',
                [markupPrice, markupLineTotal, item.id]
            );
        }

        const markupGst = markupSubtotal * (gstPct / 100);
        const markupGrandTotal = markupSubtotal + markupGst;

        await pool.query(
            `UPDATE painter_estimates SET markup_subtotal = ?, markup_gst_amount = ?, markup_grand_total = ?,
             status = 'approved', reviewed_by = ?, reviewed_at = NOW() WHERE id = ?`,
            [markupSubtotal, markupGst, markupGrandTotal, req.user.id, estimates[0].id]
        );
        await logEstimateStatusChange(estimates[0].id, estimates[0].status, 'approved', req.user.id, 'Markup prices set and approved');

        res.json({ success: true, message: 'Markup prices set and estimate approved', markupGrandTotal });
    } catch (error) {
        console.error('Set markup error:', error);
        res.status(500).json({ success: false, message: 'Failed to set markup prices' });
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

// Record payment
router.post('/estimates/:estimateId/payment', requirePermission('painters', 'estimates'), async (req, res) => {
    try {
        const { payment_method, payment_reference, payment_amount } = req.body;
        if (!payment_method) return res.status(400).json({ success: false, message: 'Payment method is required' });

        const [estimates] = await pool.query(
            "SELECT * FROM painter_estimates WHERE id = ? AND status IN ('approved','sent_to_customer')",
            [req.params.estimateId]
        );
        if (!estimates.length) return res.status(404).json({ success: false, message: 'Approved estimate not found' });

        const estimate = estimates[0];
        const amount = parseFloat(payment_amount) || parseFloat(estimate.grand_total);

        await pool.query(
            `UPDATE painter_estimates SET status = 'payment_recorded', payment_method = ?, payment_reference = ?,
             payment_amount = ?, payment_recorded_by = ?, payment_recorded_at = NOW() WHERE id = ?`,
            [payment_method, payment_reference || null, amount, req.user.id, estimate.id]
        );
        await logEstimateStatusChange(estimate.id, estimate.status, 'payment_recorded', req.user.id, `Payment: ${payment_method}${payment_reference ? ' ref:' + payment_reference : ''}`);

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
        const [items] = await pool.query('SELECT * FROM painter_estimate_items WHERE estimate_id = ? ORDER BY display_order', [estimate.id]);

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
            const { checkCreditBeforeInvoice } = require('./credit-limits');
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

        // 2. Create Zoho invoice
        const isCustomer = estimate.billing_type === 'customer';
        const lineItems = items.map(i => ({
            item_id: i.zoho_item_id,
            quantity: parseFloat(i.quantity),
            rate: isCustomer ? parseFloat(i.markup_unit_price) : parseFloat(i.unit_price)
        }));

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

        // 3. Award points via pointsEngine
        let pointsResult = { regularPoints: 0, annualPoints: 0 };
        try {
            const invoiceForPoints = {
                invoice_id: invoiceId,
                invoice_number: invoiceNumber,
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
            // Don't fail the whole operation — Zoho invoice was already created
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
