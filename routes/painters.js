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
const { uploadProductImage, uploadOfferBanner, uploadTraining, uploadPainterAttendance } = require('../config/uploads');
const painterNotificationService = require('../services/painter-notification-service');

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

// ─── Haversine Distance (meters) ─────────────────────────────
function haversineDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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

        // Play Store test account — fixed OTP bypass (no WhatsApp needed)
        const isTestAccount = (phone === '9999999999' || phone === '+919999999999');
        const otp = isTestAccount ? '123456' : String(Math.floor(100000 + Math.random() * 900000));
        const token = crypto.randomBytes(32).toString('hex');

        await pool.query('DELETE FROM painter_sessions WHERE painter_id = ? AND expires_at < NOW()', [painter.id]);

        await pool.query(
            'INSERT INTO painter_sessions (painter_id, token, otp, otp_expires_at, expires_at) VALUES (?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE), DATE_ADD(NOW(), INTERVAL 30 DAY))',
            [painter.id, token, otp]
        );

        // Send OTP via SMS (primary) + WhatsApp (secondary)
        console.log(`[Painter OTP] Phone: ${phone}, OTP: ${otp}`);

        if (!isTestAccount) {
            // 1. SMS — always send (reliable)
            if (process.env.SMS_USER && process.env.SMS_PASSWORD) {
                const http = require('http');
                const querystring = require('querystring');
                // Must use DLT-registered template (same as customer OTP)
                const smsText = `Your verification OTP for Quality Colours registration is ${otp}. Please enter this code at https://qcpaintshop.com/ to complete setup. - QUALITY COLOURS.`;
                const cleanPhone = phone.replace(/\D/g, '');
                const smsParams = querystring.stringify({
                    user: process.env.SMS_USER,
                    password: process.env.SMS_PASSWORD,
                    senderid: process.env.SMS_SENDER_ID || 'QUALTQ',
                    channel: 'Trans', DCS: '0', flashsms: '0',
                    number: cleanPhone.startsWith('91') ? cleanPhone : '91' + cleanPhone,
                    text: smsText, route: '4'
                });
                http.get(`http://retailsms.nettyfish.com/api/mt/SendSMS?${smsParams}`, (smsRes) => {
                    let data = '';
                    smsRes.on('data', chunk => { data += chunk; });
                    smsRes.on('end', () => console.log(`[Painter OTP] SMS response for ${phone}:`, data));
                }).on('error', (err) => console.error(`[Painter OTP] SMS error for ${phone}:`, err.message));
            }

            // 2. WhatsApp — also try (if session available)
            if (sessionManager) {
                try {
                    const otpMessage = `🎨 *Quality Colours Painter Program*\n\nYour OTP is: *${otp}*\n\nValid for 10 minutes. Do not share this code with anyone.`;
                    await sessionManager.sendMessage(0, phone, otpMessage, { source: 'painter_otp' });
                    console.log(`[Painter OTP] WhatsApp sent to ${phone}`);
                } catch (waErr) {
                    console.error(`[Painter OTP] WhatsApp failed for ${phone}:`, waErr.message);
                }
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
// PAINTER CATALOG ENDPOINTS (/me/catalog/*)
// ═══════════════════════════════════════════════════════════════

// Browse product catalog with images, points, and active offers
router.get('/me/catalog', requirePainterAuth, async (req, res) => {
    try {
        const { search, brand, category, page = 1, limit = 50 } = req.query;
        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
        const offset = (pageNum - 1) * limitNum;

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

        // Get total count
        const [countResult] = await pool.query(`
            SELECT COUNT(*) as total FROM zoho_items_map zim ${where}
        `, params);
        const total = countResult[0].total;

        // Products with point rates
        const [products] = await pool.query(`
            SELECT zim.zoho_item_id as item_id, zim.zoho_item_name as name,
                   zim.zoho_brand as brand, zim.zoho_category_name as category,
                   zim.zoho_rate as rate, zim.zoho_stock_on_hand as stock,
                   zim.image_url,
                   ppr.regular_points_per_unit as points_per_unit, ppr.annual_eligible, ppr.annual_pct
            FROM zoho_items_map zim
            LEFT JOIN painter_product_point_rates ppr
                ON ppr.item_id = zim.zoho_item_id COLLATE utf8mb4_unicode_ci
            ${where}
            ORDER BY zim.zoho_brand, zim.zoho_item_name
            LIMIT ? OFFSET ?
        `, [...params, limitNum, offset]);

        // Get active offers
        const now = new Date();
        const [offers] = await pool.query(`
            SELECT * FROM painter_special_offers
            WHERE is_active = 1 AND start_date <= ? AND end_date >= ?
            ORDER BY created_at DESC
        `, [now, now]);

        // Match offers to products
        const productsWithOffers = products.map(p => {
            const matchedOffers = offers.filter(o => {
                if (o.applies_to === 'all') return true;
                if (o.applies_to === 'brand' && o.target_id === p.brand) return true;
                if (o.applies_to === 'category' && o.target_id === p.category) return true;
                if (o.applies_to === 'product' && o.target_id === p.item_id) return true;
                return false;
            });
            return {
                ...p,
                rate: parseFloat(p.rate || 0),
                stock: parseFloat(p.stock || 0),
                points_per_unit: p.points_per_unit ? parseFloat(p.points_per_unit) : null,
                offer: matchedOffers.length > 0 ? matchedOffers[0] : null
            };
        });

        // Filter options
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

        res.json({
            success: true,
            products: productsWithOffers,
            offers: offers.map(o => ({
                ...o,
                bonus_points: o.bonus_points ? parseFloat(o.bonus_points) : null,
                multiplier_value: o.multiplier_value ? parseFloat(o.multiplier_value) : null
            })),
            brands: brands.map(b => b.brand),
            categories: categories.map(c => c.category),
            pagination: { page: pageNum, limit: limitNum, total, pages: Math.ceil(total / limitNum) }
        });
    } catch (error) {
        console.error('Catalog browse error:', error);
        res.status(500).json({ success: false, message: 'Failed to load catalog' });
    }
});

// Product detail with offers
router.get('/me/catalog/:itemId', requirePainterAuth, async (req, res) => {
    try {
        const { itemId } = req.params;

        const [products] = await pool.query(`
            SELECT zim.zoho_item_id as item_id, zim.zoho_item_name as name,
                   zim.zoho_brand as brand, zim.zoho_category_name as category,
                   zim.zoho_rate as rate, zim.zoho_stock_on_hand as stock,
                   zim.image_url,
                   ppr.regular_points_per_unit as points_per_unit, ppr.annual_eligible, ppr.annual_pct
            FROM zoho_items_map zim
            LEFT JOIN painter_product_point_rates ppr
                ON ppr.item_id = zim.zoho_item_id COLLATE utf8mb4_unicode_ci
            WHERE zim.zoho_item_id = ?
        `, [itemId]);

        if (!products.length) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        const product = products[0];
        product.rate = parseFloat(product.rate || 0);
        product.stock = parseFloat(product.stock || 0);
        product.points_per_unit = product.points_per_unit ? parseFloat(product.points_per_unit) : null;

        // Find matching offers for this product
        const now = new Date();
        const [offers] = await pool.query(`
            SELECT * FROM painter_special_offers
            WHERE is_active = 1 AND start_date <= ? AND end_date >= ?
            AND (
                applies_to = 'all'
                OR (applies_to = 'product' AND target_id = ?)
                OR (applies_to = 'brand' AND target_id = ?)
                OR (applies_to = 'category' AND target_id = ?)
            )
            ORDER BY created_at DESC
        `, [now, now, itemId, product.brand, product.category]);

        res.json({
            success: true,
            product,
            offers: offers.map(o => ({
                ...o,
                bonus_points: o.bonus_points ? parseFloat(o.bonus_points) : null,
                multiplier_value: o.multiplier_value ? parseFloat(o.multiplier_value) : null
            }))
        });
    } catch (error) {
        console.error('Catalog product detail error:', error);
        res.status(500).json({ success: false, message: 'Failed to load product' });
    }
});

// Active offers list
router.get('/me/offers', requirePainterAuth, async (req, res) => {
    try {
        const now = new Date();
        const [offers] = await pool.query(`
            SELECT * FROM painter_special_offers
            WHERE is_active = 1 AND start_date <= ? AND end_date >= ?
            ORDER BY created_at DESC
        `, [now, now]);

        res.json({
            success: true,
            offers: offers.map(o => ({
                ...o,
                bonus_points: o.bonus_points ? parseFloat(o.bonus_points) : null,
                multiplier_value: o.multiplier_value ? parseFloat(o.multiplier_value) : null
            }))
        });
    } catch (error) {
        console.error('Get offers error:', error);
        res.status(500).json({ success: false, message: 'Failed to load offers' });
    }
});

// ═══════════════════════════════════════════════════════════════
// PAINTER TRAINING ENDPOINTS (/me/training/*)
// ═══════════════════════════════════════════════════════════════

// List training content
router.get('/me/training', requirePainterAuth, async (req, res) => {
    try {
        const { category, type, search } = req.query;

        let where = "WHERE tc.status = 'published'";
        const params = [];

        if (category) {
            where += ' AND tc.category_id = ?';
            params.push(parseInt(category));
        }
        if (type) {
            where += ' AND tc.content_type = ?';
            params.push(type);
        }
        if (search) {
            where += ' AND (tc.title LIKE ? OR tc.title_ta LIKE ? OR tc.summary LIKE ?)';
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        const [content] = await pool.query(`
            SELECT tc.*, cat.name as category_name, cat.name_ta as category_name_ta
            FROM painter_training_content tc
            LEFT JOIN painter_training_categories cat ON tc.category_id = cat.id
            ${where}
            ORDER BY tc.is_featured DESC, tc.created_at DESC
        `, params);

        const [categories] = await pool.query(`
            SELECT * FROM painter_training_categories
            WHERE is_active = 1
            ORDER BY sort_order ASC, name ASC
        `);

        res.json({ success: true, content, categories });
    } catch (error) {
        console.error('Training list error:', error);
        res.status(500).json({ success: false, message: 'Failed to load training content' });
    }
});

// Single training content detail (increments view count)
router.get('/me/training/:id', requirePainterAuth, async (req, res) => {
    try {
        const { id } = req.params;

        const [content] = await pool.query(`
            SELECT tc.*, cat.name as category_name, cat.name_ta as category_name_ta
            FROM painter_training_content tc
            LEFT JOIN painter_training_categories cat ON tc.category_id = cat.id
            WHERE tc.id = ? AND tc.status = 'published'
        `, [id]);

        if (!content.length) {
            return res.status(404).json({ success: false, message: 'Training content not found' });
        }

        // Increment view count
        await pool.query('UPDATE painter_training_content SET view_count = view_count + 1 WHERE id = ?', [id]);
        content[0].view_count += 1;

        res.json({ success: true, content: content[0] });
    } catch (error) {
        console.error('Training detail error:', error);
        res.status(500).json({ success: false, message: 'Failed to load training content' });
    }
});

// ═══════════════════════════════════════════════════════════════
// PAINTER ATTENDANCE ENDPOINTS (/me/attendance/*)
// ═══════════════════════════════════════════════════════════════

// Today's check-in status
router.get('/me/attendance/today', requirePainterAuth, async (req, res) => {
    try {
        const [records] = await pool.query(
            `SELECT * FROM painter_attendance
             WHERE painter_id = ? AND DATE(check_in_at) = CURDATE()
             ORDER BY check_in_at DESC LIMIT 1`,
            [req.painter.id]
        );

        res.json({
            success: true,
            checkedIn: records.length > 0,
            attendance: records[0] || null
        });
    } catch (error) {
        console.error('Attendance today error:', error);
        res.status(500).json({ success: false, message: 'Failed to check attendance status' });
    }
});

// GPS geofence check-in
router.post('/me/attendance/check-in', requirePainterAuth, uploadPainterAttendance.single('photo'), async (req, res) => {
    try {
        const { latitude, longitude } = req.body;

        if (!latitude || !longitude) {
            return res.status(400).json({ success: false, message: 'Location (latitude, longitude) is required' });
        }

        const lat = parseFloat(latitude);
        const lng = parseFloat(longitude);

        if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
            return res.status(400).json({ success: false, message: 'Invalid coordinates' });
        }

        // Check if already checked in today
        const [existing] = await pool.query(
            `SELECT id FROM painter_attendance
             WHERE painter_id = ? AND DATE(check_in_at) = CURDATE()`,
            [req.painter.id]
        );
        if (existing.length > 0) {
            return res.status(400).json({ success: false, message: 'Already checked in today' });
        }

        // Get branches with GPS coordinates
        const [branches] = await pool.query(`
            SELECT id, name, latitude, longitude, geo_fence_radius
            FROM branches
            WHERE is_active = 1 AND latitude IS NOT NULL AND longitude IS NOT NULL
        `);

        if (!branches.length) {
            return res.status(400).json({ success: false, message: 'No branches configured with GPS coordinates' });
        }

        // Get geofence radius from config (fallback)
        const [geoConfig] = await pool.query(
            "SELECT config_value FROM ai_config WHERE config_key = 'painter_attendance_geofence_radius'"
        );
        const defaultRadius = geoConfig.length ? parseFloat(geoConfig[0].config_value) : 500; // 500m default

        // Find nearest branch using haversine
        let nearestBranch = null;
        let minDistance = Infinity;

        for (const branch of branches) {
            const dist = haversineDistance(lat, lng, parseFloat(branch.latitude), parseFloat(branch.longitude));
            if (dist < minDistance) {
                minDistance = dist;
                nearestBranch = branch;
            }
        }

        const fenceRadius = nearestBranch.geo_fence_radius || defaultRadius;

        if (minDistance > fenceRadius) {
            return res.status(400).json({
                success: false,
                message: `Too far from nearest store (${nearestBranch.name}). Distance: ${Math.round(minDistance)}m, Required: within ${Math.round(fenceRadius)}m`,
                distance: Math.round(minDistance),
                required: Math.round(fenceRadius),
                branch: nearestBranch.name
            });
        }

        // Get daily attendance points from config
        const [pointsConfig] = await pool.query(
            "SELECT config_value FROM ai_config WHERE config_key = 'painter_attendance_daily_points'"
        );
        const dailyPoints = pointsConfig.length ? parseInt(pointsConfig[0].config_value) : 5;

        // Photo URL if uploaded
        const photoUrl = req.file ? `/uploads/painter-attendance/${req.file.filename}` : null;

        // Insert attendance record
        const [result] = await pool.query(`
            INSERT INTO painter_attendance
            (painter_id, event_type, branch_id, check_in_at, photo_url, latitude, longitude, distance_meters, points_awarded)
            VALUES (?, 'store_visit', ?, NOW(), ?, ?, ?, ?, ?)
        `, [req.painter.id, nearestBranch.id, photoUrl, lat, lng, Math.round(minDistance), dailyPoints]);

        // Award points via points engine
        try {
            await pointsEngine.awardAttendancePoints(req.painter.id, result.insertId);
        } catch (pointsErr) {
            console.error('[Painter Attendance] Points award error:', pointsErr.message);
        }

        res.json({
            success: true,
            message: `Checked in at ${nearestBranch.name}!`,
            attendance: {
                id: result.insertId,
                branch: nearestBranch.name,
                distance: Math.round(minDistance),
                points: dailyPoints,
                check_in_at: new Date()
            }
        });
    } catch (error) {
        console.error('Attendance check-in error:', error);
        res.status(500).json({ success: false, message: 'Failed to check in' });
    }
});

// Monthly attendance calendar data
router.get('/me/attendance/monthly', requirePainterAuth, async (req, res) => {
    try {
        const now = new Date();
        const month = parseInt(req.query.month) || (now.getMonth() + 1);
        const year = parseInt(req.query.year) || now.getFullYear();

        const [visits] = await pool.query(`
            SELECT DATE(check_in_at) as visit_date, points_awarded, check_in_at,
                   branch_id, distance_meters
            FROM painter_attendance
            WHERE painter_id = ? AND MONTH(check_in_at) = ? AND YEAR(check_in_at) = ?
            ORDER BY check_in_at ASC
        `, [req.painter.id, month, year]);

        const totalVisits = visits.length;
        const totalPoints = visits.reduce((sum, v) => sum + (v.points_awarded || 0), 0);

        res.json({
            success: true,
            month,
            year,
            visits: visits.map(v => ({
                date: v.visit_date,
                points: v.points_awarded || 0,
                check_in_time: v.check_in_at,
                distance: v.distance_meters
            })),
            totalVisits,
            totalPoints
        });
    } catch (error) {
        console.error('Monthly attendance error:', error);
        res.status(500).json({ success: false, message: 'Failed to load attendance history' });
    }
});

// ═══════════════════════════════════════════════════════════════
// PAINTER NOTIFICATION & FCM ENDPOINTS (/me/fcm/*, /me/notifications/*)
// ═══════════════════════════════════════════════════════════════

// Register FCM token
router.post('/me/fcm/register', requirePainterAuth, async (req, res) => {
    try {
        const { fcm_token, device_info } = req.body;
        if (!fcm_token) {
            return res.status(400).json({ success: false, message: 'fcm_token is required' });
        }

        await pool.query(`
            INSERT INTO painter_fcm_tokens (painter_id, fcm_token, device_info, is_active)
            VALUES (?, ?, ?, 1)
            ON DUPLICATE KEY UPDATE is_active = 1, device_info = VALUES(device_info), updated_at = NOW()
        `, [req.painter.id, fcm_token, device_info ? JSON.stringify(device_info) : null]);

        res.json({ success: true, message: 'FCM token registered' });
    } catch (error) {
        console.error('FCM register error:', error);
        res.status(500).json({ success: false, message: 'Failed to register FCM token' });
    }
});

// Deactivate FCM token
router.delete('/me/fcm/unregister', requirePainterAuth, async (req, res) => {
    try {
        const { fcm_token } = req.body;
        if (!fcm_token) {
            return res.status(400).json({ success: false, message: 'fcm_token is required' });
        }

        await pool.query(
            `UPDATE painter_fcm_tokens SET is_active = 0 WHERE painter_id = ? AND fcm_token = ?`,
            [req.painter.id, fcm_token]
        );

        res.json({ success: true, message: 'FCM token deactivated' });
    } catch (error) {
        console.error('FCM unregister error:', error);
        res.status(500).json({ success: false, message: 'Failed to deactivate FCM token' });
    }
});

// List notifications (paginated)
router.get('/me/notifications', requirePainterAuth, async (req, res) => {
    try {
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
        const offset = Math.max(0, parseInt(req.query.offset) || 0);
        const unreadOnly = req.query.unread === '1';

        const result = await painterNotificationService.getNotifications(req.painter.id, {
            limit,
            offset,
            unreadOnly
        });

        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Get notifications error:', error);
        res.status(500).json({ success: false, message: 'Failed to load notifications' });
    }
});

// Mark notification as read
router.put('/me/notifications/:id/read', requirePainterAuth, async (req, res) => {
    try {
        const notificationId = req.params.id === 'all' ? 'all' : parseInt(req.params.id);
        const result = await painterNotificationService.markRead(req.painter.id, notificationId);
        res.json({ success: true, ...result });
    } catch (error) {
        console.error('Mark read error:', error);
        res.status(500).json({ success: false, message: 'Failed to mark notification as read' });
    }
});

// ═══════════════════════════════════════════════════════════════
// ADMIN NAMED ROUTES (must come BEFORE /:id parameterized routes)
// ═══════════════════════════════════════════════════════════════

// --- OFFERS ADMIN ---

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
        const {
            title, title_ta, description, description_ta,
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
        const {
            title, title_ta, description, description_ta,
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
