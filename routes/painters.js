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
const { uploadProductImage, uploadOfferBanner, uploadTraining, uploadPainterAttendance, uploadProfile, uploadPainterVisualization } = require('../config/uploads');
const sharp = require('sharp');
const cardGenerator = require('../services/painter-card-generator');
const painterNotificationService = require('../services/painter-notification-service');
const notificationService = require('../services/notification-service');
const { generatePainterEstimatePDF } = require('./painter-estimate-pdf-generator');

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
             specialization = COALESCE(?, specialization), card_generated_at = NULL, id_card_generated_at = NULL WHERE id = ?`,
            [email, address, city, district, pincode, experience_years, specialization, req.painter.id]
        );
        res.json({ success: true, message: 'Profile updated' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update profile' });
    }
});

// Upload/update profile photo
router.put('/me/profile-photo', requirePainterAuth, uploadProfile.single('photo'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No photo uploaded' });

        const filename = `painter_${req.painter.id}.jpg`;
        const outputPath = require('path').join(__dirname, '..', 'public', 'uploads', 'profiles', filename);

        // Resize + compress with sharp
        await sharp(req.file.path)
            .resize(400, 400, { fit: 'cover' })
            .jpeg({ quality: 80 })
            .toFile(outputPath + '.tmp');

        // Replace original with processed version
        const fs = require('fs');
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        fs.renameSync(outputPath + '.tmp', outputPath);
        // Remove multer's original upload
        if (req.file.path !== outputPath) {
            try { fs.unlinkSync(req.file.path); } catch(e) {}
        }

        const photoUrl = `/uploads/profiles/${filename}?v=${Date.now()}`;
        await pool.query('UPDATE painters SET profile_photo = ?, card_generated_at = NULL, id_card_generated_at = NULL WHERE id = ?', [photoUrl, req.painter.id]);

        res.json({ success: true, photo_url: photoUrl });
    } catch (error) {
        console.error('Profile photo upload error:', error);
        res.status(500).json({ success: false, message: 'Failed to upload photo' });
    }
});

// Get/generate visiting card PNG
router.get('/me/visiting-card', requirePainterAuth, async (req, res) => {
    try {
        const [painters] = await pool.query(
            'SELECT id, full_name, phone, city, specialization, experience_years, referral_code, profile_photo, card_generated_at, updated_at FROM painters WHERE id = ?',
            [req.painter.id]
        );
        if (!painters.length) return res.status(404).json({ success: false, message: 'Painter not found' });

        const painter = painters[0];
        const cardPath = require('path').join(__dirname, '..', 'public', 'uploads', 'painter-cards', `painter_${painter.id}.png`);
        const fs = require('fs');

        // Check if card needs regeneration
        const needsRegen = !painter.card_generated_at
            || !fs.existsSync(cardPath)
            || (painter.updated_at && new Date(painter.updated_at) > new Date(painter.card_generated_at));

        if (needsRegen) {
            await cardGenerator.generateCard(painter, pool);
            await pool.query('UPDATE painters SET card_generated_at = NOW() WHERE id = ?', [painter.id]);
        }

        // Return as image or JSON with URL based on query param
        if (req.query.format === 'url') {
            res.json({ success: true, url: `/uploads/painter-cards/painter_${painter.id}.png?v=${Date.now()}` });
        } else {
            res.sendFile(cardPath);
        }
    } catch (error) {
        console.error('Visiting card error:', error);
        res.status(500).json({ success: false, message: 'Failed to generate visiting card' });
    }
});

// Generate/get painter ID card (portrait badge)
router.get('/me/id-card', requirePainterAuth, async (req, res) => {
    try {
        const [painters] = await pool.query(
            'SELECT id, full_name, phone, city, specialization, experience_years, referral_code, profile_photo, id_card_generated_at, updated_at FROM painters WHERE id = ?',
            [req.painter.id]
        );
        if (!painters.length) return res.status(404).json({ success: false, message: 'Painter not found' });

        const painter = painters[0];
        const cardPath = require('path').join(__dirname, '..', 'public', 'uploads', 'painter-cards', `painter_id_${painter.id}.png`);
        const fs = require('fs');

        const needsRegen = !painter.id_card_generated_at
            || !fs.existsSync(cardPath)
            || (painter.updated_at && new Date(painter.updated_at) > new Date(painter.id_card_generated_at));

        if (needsRegen) {
            await cardGenerator.generateIdCard(painter, pool);
            await pool.query('UPDATE painters SET id_card_generated_at = NOW() WHERE id = ?', [painter.id]);
        }

        if (req.query.format === 'url') {
            res.json({ success: true, url: `/uploads/painter-cards/painter_id_${painter.id}.png?v=${Date.now()}` });
        } else {
            res.sendFile(cardPath);
        }
    } catch (error) {
        console.error('ID card error:', error);
        res.status(500).json({ success: false, message: 'Failed to generate ID card' });
    }
});

// ═══════════════════════════════════════════
// PAINTER VISUALIZATION REQUESTS
// ═══════════════════════════════════════════

// Submit visualization request
router.post('/me/visualizations', requirePainterAuth, uploadPainterVisualization.single('photo'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'Photo is required' });

        const { brand, color_name, color_code, color_hex, notes } = req.body;

        // Save uploaded photo with sharp compression
        const filename = `viz-req-${req.painter.id}-${Date.now()}.jpg`;
        const outputPath = `public/uploads/painter-visualizations/${filename}`;
        await sharp(req.file.buffer)
            .resize(1200, 900, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 85 })
            .toFile(outputPath);

        const photoUrl = `/uploads/painter-visualizations/${filename}`;

        const [result] = await pool.query(
            `INSERT INTO painter_visualization_requests (painter_id, photo_path, brand, color_name, color_code, color_hex, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [req.painter.id, photoUrl, brand || null, color_name || null, color_code || null, color_hex || null, notes || null]
        );

        res.json({ success: true, id: result.insertId, message: 'Visualization request submitted' });
    } catch (error) {
        console.error('Visualization submit error:', error);
        res.status(500).json({ success: false, message: 'Failed to submit request' });
    }
});

// List my visualization requests
router.get('/me/visualizations', requirePainterAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT id, photo_path, brand, color_name, color_hex, status, visualization_path, admin_notes, created_at, completed_at
             FROM painter_visualization_requests
             WHERE painter_id = ?
             ORDER BY created_at DESC`,
            [req.painter.id]
        );
        res.json({ success: true, visualizations: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to load visualizations' });
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
        const [balance, [referralCount], [recentTxns], [pendingWithdrawals], [painter], [logoSetting]] = await Promise.all([
            pointsEngine.getBalance(req.painter.id),
            pool.query('SELECT COUNT(*) as count FROM painter_referrals WHERE referrer_id = ?', [req.painter.id]),
            pool.query('SELECT * FROM painter_point_transactions WHERE painter_id = ? ORDER BY created_at DESC LIMIT 10', [req.painter.id]),
            pool.query('SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM painter_withdrawals WHERE painter_id = ? AND status = "pending"', [req.painter.id]),
            pool.query('SELECT referral_code, profile_photo, full_name FROM painters WHERE id = ?', [req.painter.id]),
            pool.query("SELECT setting_value FROM settings WHERE setting_key = 'business_logo' LIMIT 1")
        ]);

        const logoVal = logoSetting[0]?.setting_value || null;
        const businessLogo = logoVal
            ? (logoVal.startsWith('/') ? logoVal : `/uploads/logos/${logoVal}`)
            : null;

        res.json({
            success: true,
            dashboard: {
                balance,
                referralCode: painter[0]?.referral_code,
                profilePhoto: painter[0]?.profile_photo,
                painterName: painter[0]?.full_name,
                referralCount: referralCount[0].count,
                recentTransactions: recentTxns,
                pendingWithdrawals: { count: pendingWithdrawals[0].count, total: parseFloat(pendingWithdrawals[0].total) },
                businessLogo
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
        const { billing_type, search, brand, category, product_type } = req.query;

        let where = "WHERE p.status = 'active' AND ps.is_active = 1 AND ps.zoho_item_id IS NOT NULL";
        const params = [];

        if (search) {
            where += ' AND (p.name LIKE ? OR b.name LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }
        if (brand) {
            where += ' AND b.id = ?';
            params.push(brand);
        }
        if (category) {
            where += ' AND c.id = ?';
            params.push(category);
        }
        if (product_type) {
            where += ' AND p.product_type = ?';
            params.push(product_type);
        }

        const [rows] = await pool.query(`
            SELECT p.id, p.name, p.product_type, p.area_coverage, p.gst_percentage,
                   b.name as brand, b.id as brand_id,
                   c.name as category, c.id as category_id,
                   ps.id as pack_size_id, ps.size, ps.unit, ps.base_price, ps.zoho_item_id,
                   zim.zoho_rate, zim.zoho_stock_on_hand as stock
            FROM products p
            LEFT JOIN brands b ON p.brand_id = b.id
            LEFT JOIN categories c ON p.category_id = c.id
            INNER JOIN pack_sizes ps ON ps.product_id = p.id
            LEFT JOIN zoho_items_map zim ON zim.zoho_item_id = ps.zoho_item_id
            ${where}
            ORDER BY b.name, p.name, ps.size
        `, params);

        // Group by product
        const productMap = {};
        for (const row of rows) {
            if (!productMap[row.id]) {
                productMap[row.id] = {
                    id: row.id,
                    name: row.name,
                    brand: row.brand,
                    brand_id: row.brand_id,
                    category: row.category,
                    category_id: row.category_id,
                    product_type: row.product_type,
                    area_coverage: row.area_coverage ? parseFloat(row.area_coverage) : null,
                    gst_percentage: row.gst_percentage ? parseFloat(row.gst_percentage) : 18,
                    pack_sizes: []
                };
            }
            const showPrices = billing_type === 'self';
            productMap[row.id].pack_sizes.push({
                pack_size_id: row.pack_size_id,
                size: parseFloat(row.size),
                unit: row.unit,
                rate: showPrices ? parseFloat(row.zoho_rate || row.base_price || 0) : null,
                zoho_item_id: row.zoho_item_id,
                stock: parseFloat(row.stock || 0)
            });
        }

        const products = Object.values(productMap);

        const [brands] = await pool.query(`
            SELECT DISTINCT b.id, b.name FROM brands b
            INNER JOIN products p ON p.brand_id = b.id AND p.status = 'active'
            INNER JOIN pack_sizes ps ON ps.product_id = p.id AND ps.is_active = 1 AND ps.zoho_item_id IS NOT NULL
            ORDER BY b.name
        `);
        const [categories] = await pool.query(`
            SELECT DISTINCT c.id, c.name FROM categories c
            INNER JOIN products p ON p.category_id = c.id AND p.status = 'active'
            INNER JOIN pack_sizes ps ON ps.product_id = p.id AND ps.is_active = 1 AND ps.zoho_item_id IS NOT NULL
            ORDER BY c.name
        `);

        res.json({
            success: true,
            products,
            brands: brands.map(b => ({ id: b.id, name: b.name })),
            categories: categories.map(c => ({ id: c.id, name: c.name }))
        });
    } catch (error) {
        console.error('Estimate catalog error:', error);
        res.status(500).json({ success: false, message: 'Failed to load catalog' });
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

        // Validate items — each has pack_size_id + quantity
        const packSizeIds = items.map(i => i.pack_size_id || i.item_id);
        const [packSizeRows] = await pool.query(`
            SELECT ps.id as pack_size_id, ps.zoho_item_id, ps.size, ps.unit, ps.base_price, ps.product_id,
                   p.name as product_name, p.product_type,
                   zim.zoho_item_name, zim.zoho_brand, zim.zoho_category_name, zim.zoho_rate
            FROM pack_sizes ps
            INNER JOIN products p ON p.id = ps.product_id
            LEFT JOIN zoho_items_map zim ON zim.zoho_item_id = ps.zoho_item_id
            WHERE ps.id IN (?) AND ps.is_active = 1
        `, [packSizeIds]);

        const packSizeMap = {};
        packSizeRows.forEach(r => { packSizeMap[r.pack_size_id] = r; });

        const estimateNumber = await generateEstimateNumber();
        const status = submit ? 'pending_admin' : 'draft';

        let subtotal = 0;
        const lineItems = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const psId = item.pack_size_id || item.item_id;
            const psRow = packSizeMap[psId];
            if (!psRow || !psRow.zoho_item_id) {
                return res.status(400).json({ success: false, message: `Product not found or not mapped: ${psId}` });
            }
            const qty = parseFloat(item.quantity) || 1;
            const unitPrice = parseFloat(psRow.zoho_rate || psRow.base_price || 0);
            const lineTotal = qty * unitPrice;
            subtotal += lineTotal;
            lineItems.push({
                zoho_item_id: psRow.zoho_item_id,
                item_name: `${psRow.product_name} ${psRow.size}${psRow.unit}`,
                brand: psRow.zoho_brand,
                category: psRow.zoho_category_name,
                quantity: qty,
                unit_price: unitPrice,
                line_total: lineTotal,
                display_order: i
            });
        }

        // Prices already include GST — store 0 for gst_amount, grandTotal = subtotal
        const gstAmount = 0;
        const grandTotal = subtotal;

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

// Painter: Request discount on approved customer estimate
router.post('/me/estimates/:estimateId/request-discount', requirePainterAuth, async (req, res) => {
    try {
        const { notes } = req.body;
        const [estimates] = await pool.query(
            "SELECT * FROM painter_estimates WHERE id = ? AND painter_id = ? AND billing_type = 'customer' AND status IN ('approved','sent_to_customer')",
            [req.params.estimateId, req.painter.id]
        );
        if (!estimates.length) return res.status(404).json({ success: false, message: 'Approved customer estimate not found' });

        const estimate = estimates[0];
        await pool.query(
            "UPDATE painter_estimates SET status = 'discount_requested', discount_requested_at = NOW(), discount_notes = ? WHERE id = ?",
            [notes || null, estimate.id]
        );
        await logEstimateStatusChange(estimate.id, estimate.status, 'discount_requested', req.painter.id, notes || 'Discount requested by painter');

        res.json({ success: true, message: 'Discount request sent to admin' });
    } catch (error) {
        console.error('Request discount error:', error);
        res.status(500).json({ success: false, message: 'Failed to request discount' });
    }
});

// Painter: Submit payment (pending admin confirmation)
// Allowed from: approved (self), final_approved (customer), payment_recorded (balance payment)
router.post('/me/estimates/:estimateId/payment', requirePainterAuth, async (req, res) => {
    try {
        const { payment_method, payment_reference, payment_amount } = req.body;
        if (!payment_method) return res.status(400).json({ success: false, message: 'Payment method is required' });

        const [estimates] = await pool.query(
            "SELECT * FROM painter_estimates WHERE id = ? AND painter_id = ? AND status IN ('approved','final_approved','payment_recorded')",
            [req.params.estimateId, req.painter.id]
        );
        if (!estimates.length) return res.status(404).json({ success: false, message: 'Estimate not found or not payable' });

        const estimate = estimates[0];
        const effectiveTotal = parseFloat(estimate.final_grand_total) || parseFloat(estimate.markup_grand_total) || parseFloat(estimate.grand_total);
        const previousPaid = parseFloat(estimate.payment_amount) || 0;
        const newPayment = parseFloat(payment_amount) || (effectiveTotal - previousPaid);
        const totalPaid = previousPaid + newPayment;

        const oldStatus = estimate.status;
        await pool.query(
            `UPDATE painter_estimates SET status = 'payment_submitted', payment_method = ?, payment_reference = ?,
             payment_amount = ?, payment_recorded_by = ?, payment_recorded_at = NOW() WHERE id = ?`,
            [payment_method, payment_reference || null, totalPaid, req.painter.id, estimate.id]
        );
        await logEstimateStatusChange(estimate.id, oldStatus, 'payment_submitted', req.painter.id,
            `Payment submitted: ${payment_method} ₹${newPayment}${previousPaid > 0 ? ' (additional, total: ₹' + totalPaid + ')' : ''}${payment_reference ? ' ref:' + payment_reference : ''}`);

        res.json({ success: true, message: 'Payment submitted — awaiting admin confirmation' });
    } catch (error) {
        console.error('Painter submit payment error:', error);
        res.status(500).json({ success: false, message: 'Failed to submit payment' });
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

// Download estimate PDF (painter)
router.get('/me/estimates/:estimateId/pdf', requirePainterAuth, async (req, res) => {
    try {
        const [estimates] = await pool.query(
            `SELECT pe.*, p.full_name as painter_name, p.phone as painter_phone
             FROM painter_estimates pe JOIN painters p ON pe.painter_id = p.id
             WHERE pe.id = ? AND pe.painter_id = ?`,
            [req.params.estimateId, req.painter.id]
        );
        if (!estimates.length) return res.status(404).json({ success: false, message: 'Estimate not found' });
        if (estimates[0].status === 'draft') return res.status(400).json({ success: false, message: 'Cannot download draft estimate' });

        const [items] = await pool.query(
            'SELECT * FROM painter_estimate_items WHERE estimate_id = ? ORDER BY display_order, id',
            [estimates[0].id]
        );

        // Load branding from settings
        const [settings] = await pool.query("SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('business_name','business_logo','business_address','business_phone','business_email','business_gst')");
        const branding = {};
        settings.forEach(s => { branding[s.setting_key] = s.setting_value; });

        // Customer billing: show markup prices to painter; Self billing: show cost prices
        const showMarkup = estimates[0].billing_type === 'customer';
        generatePainterEstimatePDF(res, estimates[0], items, branding, { showMarkup });
    } catch (error) {
        console.error('Painter estimate PDF error:', error);
        if (!res.headersSent) res.status(500).json({ success: false, message: 'Failed to generate PDF' });
    }
});

// ═══════════════════════════════════════════════════════════════
// PAINTER CATALOG ENDPOINTS (/me/catalog/*)
// ═══════════════════════════════════════════════════════════════

// Browse product catalog — grouped by product (not individual pack sizes)
router.get('/me/catalog', requirePainterAuth, async (req, res) => {
    try {
        const { search, brand, category, page = 1, limit = 50 } = req.query;
        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
        const offset = (pageNum - 1) * limitNum;

        const joins = `
            FROM products p
            INNER JOIN pack_sizes ps ON ps.product_id = p.id AND ps.is_active = 1
            INNER JOIN zoho_items_map zim ON zim.zoho_item_id = ps.zoho_item_id
                AND (zim.zoho_status = 'active' OR zim.zoho_status IS NULL)
        `;
        let where = "WHERE p.status = 'active'";
        const params = [];

        if (search) {
            where += ' AND (p.name LIKE ? OR zim.zoho_item_name LIKE ? OR zim.zoho_brand LIKE ?)';
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        if (brand) {
            where += ' AND zim.zoho_brand = ?';
            params.push(brand);
        }
        if (category) {
            where += ' AND zim.zoho_category_name = ?';
            params.push(category);
        }

        // Count grouped products
        const [countResult] = await pool.query(
            `SELECT COUNT(DISTINCT p.id) as total ${joins} ${where}`, params
        );
        const total = countResult[0].total;

        // Grouped products: one row per product with aggregated info
        // Stock from zoho_location_stock (sum across all branches)
        const [products] = await pool.query(`
            SELECT p.id as product_id, p.name as name, p.product_type,
                   MIN(CAST(zim.zoho_rate AS DECIMAL(10,2))) as min_rate,
                   MAX(CAST(zim.zoho_rate AS DECIMAL(10,2))) as max_rate,
                   (SELECT COALESCE(SUM(zls.stock_on_hand), 0) FROM zoho_location_stock zls
                    WHERE zls.zoho_item_id IN (
                        SELECT ps3.zoho_item_id FROM pack_sizes ps3
                        WHERE ps3.product_id = p.id AND ps3.is_active = 1
                    )) as total_stock,
                   COUNT(DISTINCT ps.id) as variant_count,
                   MAX(zim.zoho_brand) as brand,
                   MAX(zim.zoho_category_name) as category,
                   (SELECT z2.image_url FROM pack_sizes ps2
                    INNER JOIN zoho_items_map z2 ON z2.zoho_item_id = ps2.zoho_item_id
                    WHERE ps2.product_id = p.id AND ps2.is_active = 1 AND z2.image_url IS NOT NULL
                    LIMIT 1) as image_url,
                   MAX(ppr.regular_points_per_unit) as points_per_unit,
                   MAX(ppr.annual_eligible) as annual_eligible,
                   MAX(ppr.annual_pct) as annual_pct
            ${joins}
            LEFT JOIN painter_product_point_rates ppr
                ON ppr.item_id = zim.zoho_item_id COLLATE utf8mb4_unicode_ci
            ${where}
            GROUP BY p.id, p.name, p.product_type
            ORDER BY p.name
            LIMIT ? OFFSET ?
        `, [...params, limitNum, offset]);

        // Active offers
        const now = new Date();
        const [offers] = await pool.query(`
            SELECT * FROM painter_special_offers
            WHERE is_active = 1 AND start_date <= ? AND end_date >= ?
            ORDER BY created_at DESC
        `, [now, now]);

        // Match offers to grouped products
        const productsWithOffers = products.map(p => {
            const matchedOffers = offers.filter(o => {
                if (o.applies_to === 'all') return true;
                if (o.applies_to === 'brand' && o.target_id === p.brand) return true;
                if (o.applies_to === 'category' && o.target_id === p.category) return true;
                return false;
            });
            return {
                ...p,
                min_rate: parseFloat(p.min_rate || 0),
                max_rate: parseFloat(p.max_rate || 0),
                total_stock: parseFloat(p.total_stock || 0),
                points_per_unit: p.points_per_unit ? parseFloat(p.points_per_unit) : null,
                offer: matchedOffers.length > 0 ? matchedOffers[0] : null
            };
        });

        // Filter options
        const [brands] = await pool.query(`
            SELECT DISTINCT zim.zoho_brand as brand
            FROM zoho_items_map zim
            INNER JOIN pack_sizes ps ON ps.zoho_item_id = zim.zoho_item_id AND ps.is_active = 1
            INNER JOIN products p ON p.id = ps.product_id AND p.status = 'active'
            WHERE zim.zoho_brand IS NOT NULL AND zim.zoho_brand != ''
            ORDER BY zim.zoho_brand
        `);
        const [categories] = await pool.query(`
            SELECT DISTINCT zim.zoho_category_name as category
            FROM zoho_items_map zim
            INNER JOIN pack_sizes ps ON ps.zoho_item_id = zim.zoho_item_id AND ps.is_active = 1
            INNER JOIN products p ON p.id = ps.product_id AND p.status = 'active'
            WHERE zim.zoho_category_name IS NOT NULL AND zim.zoho_category_name != ''
            ORDER BY zim.zoho_category_name
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

// Product detail — returns product with all its variants (pack sizes)
router.get('/me/catalog/:productId', requirePainterAuth, async (req, res) => {
    try {
        const { productId } = req.params;

        // Get the product
        const [prodRows] = await pool.query(
            "SELECT id, name, product_type FROM products WHERE id = ? AND status = 'active'",
            [productId]
        );
        if (!prodRows.length) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }
        const prod = prodRows[0];

        // Get all variants (pack sizes) for this product
        // Stock from zoho_location_stock (sum across all branches)
        const [variants] = await pool.query(`
            SELECT zim.zoho_item_id as item_id, zim.zoho_item_name as name,
                   ps.size as pack_size, ps.unit as pack_unit,
                   zim.zoho_brand as brand, zim.zoho_category_name as category,
                   zim.zoho_rate as rate,
                   COALESCE((SELECT SUM(zls.stock_on_hand) FROM zoho_location_stock zls
                    WHERE zls.zoho_item_id = zim.zoho_item_id), 0) as stock,
                   zim.image_url,
                   ppr.regular_points_per_unit as points_per_unit, ppr.annual_eligible, ppr.annual_pct
            FROM pack_sizes ps
            INNER JOIN zoho_items_map zim ON zim.zoho_item_id = ps.zoho_item_id
                AND (zim.zoho_status = 'active' OR zim.zoho_status IS NULL)
            LEFT JOIN painter_product_point_rates ppr
                ON ppr.item_id = zim.zoho_item_id COLLATE utf8mb4_unicode_ci
            WHERE ps.product_id = ? AND ps.is_active = 1
            ORDER BY CAST(zim.zoho_rate AS DECIMAL(10,2)) ASC
        `, [productId]);

        if (!variants.length) {
            return res.status(404).json({ success: false, message: 'No variants found' });
        }

        const brand = variants[0].brand;
        const category = variants[0].category;
        const image_url = variants.find(v => v.image_url)?.image_url || null;

        const product = {
            product_id: prod.id,
            name: prod.name,
            product_type: prod.product_type,
            brand,
            category,
            image_url,
            variant_count: variants.length,
            min_rate: Math.min(...variants.map(v => parseFloat(v.rate || 0))),
            max_rate: Math.max(...variants.map(v => parseFloat(v.rate || 0))),
            total_stock: variants.reduce((s, v) => s + parseFloat(v.stock || 0), 0),
            variants: variants.map(v => ({
                ...v,
                rate: parseFloat(v.rate || 0),
                stock: parseFloat(v.stock || 0),
                points_per_unit: v.points_per_unit ? parseFloat(v.points_per_unit) : null
            }))
        };

        // Matching offers
        const now = new Date();
        const [offers] = await pool.query(`
            SELECT * FROM painter_special_offers
            WHERE is_active = 1 AND start_date <= ? AND end_date >= ?
            AND (
                applies_to = 'all'
                OR (applies_to = 'brand' AND target_id = ?)
                OR (applies_to = 'category' AND target_id = ?)
            )
            ORDER BY created_at DESC
        `, [now, now, brand, category]);

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

// Offer products grouped by brand (for dashboard offer box)
router.get('/me/offer-products', requirePainterAuth, async (req, res) => {
    try {
        const now = new Date();
        const [offers] = await pool.query(`
            SELECT * FROM painter_special_offers
            WHERE is_active = 1 AND start_date <= ? AND end_date >= ?
            ORDER BY created_at DESC
        `, [now, now]);

        if (!offers.length) {
            return res.json({ success: true, brands: [], products: [], offers: [] });
        }

        // Build product filter based on offer targets
        let extraWhere = '';
        const extraParams = [];
        const brandOffers = offers.filter(o => o.applies_to === 'brand' && o.target_id);
        const categoryOffers = offers.filter(o => o.applies_to === 'category' && o.target_id);

        if (brandOffers.length && !offers.some(o => o.applies_to === 'all')) {
            const brandIds = brandOffers.map(o => o.target_id);
            const catIds = categoryOffers.map(o => o.target_id);
            const conditions = [];
            if (brandIds.length) {
                conditions.push(`zim.zoho_brand IN (${brandIds.map(() => '?').join(',')})`);
                extraParams.push(...brandIds);
            }
            if (catIds.length) {
                conditions.push(`zim.zoho_category_name IN (${catIds.map(() => '?').join(',')})`);
                extraParams.push(...catIds);
            }
            if (conditions.length) extraWhere = ` AND (${conditions.join(' OR ')})`;
        }

        const [products] = await pool.query(`
            SELECT p.id as product_id, p.name, p.product_type,
                   MIN(CAST(zim.zoho_rate AS DECIMAL(10,2))) as min_rate,
                   MAX(CAST(zim.zoho_rate AS DECIMAL(10,2))) as max_rate,
                   COUNT(DISTINCT ps.id) as variant_count,
                   MAX(zim.zoho_brand) as brand,
                   MAX(zim.zoho_category_name) as category,
                   (SELECT z2.image_url FROM pack_sizes ps2
                    INNER JOIN zoho_items_map z2 ON z2.zoho_item_id = ps2.zoho_item_id
                    WHERE ps2.product_id = p.id AND ps2.is_active = 1 AND z2.image_url IS NOT NULL
                    LIMIT 1) as image_url,
                   MAX(ppr.regular_points_per_unit) as points_per_unit
            FROM products p
            INNER JOIN pack_sizes ps ON ps.product_id = p.id AND ps.is_active = 1
            INNER JOIN zoho_items_map zim ON zim.zoho_item_id = ps.zoho_item_id
                AND (zim.zoho_status = 'active' OR zim.zoho_status IS NULL)
            LEFT JOIN painter_product_point_rates ppr
                ON ppr.item_id = zim.zoho_item_id COLLATE utf8mb4_unicode_ci
            WHERE p.status = 'active'${extraWhere}
            GROUP BY p.id, p.name, p.product_type
            ORDER BY p.name
            LIMIT 100
        `, extraParams);

        // Unique brands
        const brands = [...new Set(products.map(p => p.brand).filter(Boolean))].sort();

        res.json({
            success: true,
            brands,
            products: products.map(p => ({
                ...p,
                min_rate: p.min_rate ? parseFloat(p.min_rate) : null,
                max_rate: p.max_rate ? parseFloat(p.max_rate) : null,
                points_per_unit: p.points_per_unit ? parseFloat(p.points_per_unit) : null
            })),
            offers: offers.map(o => ({
                id: o.id,
                title: o.title,
                offer_type: o.offer_type,
                bonus_points: o.bonus_points ? parseFloat(o.bonus_points) : null,
                multiplier_value: o.multiplier_value ? parseFloat(o.multiplier_value) : null,
                applies_to: o.applies_to,
                target_id: o.target_id
            }))
        });
    } catch (error) {
        console.error('Offer products error:', error);
        res.status(500).json({ success: false, message: 'Failed to load offer products' });
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

// Search products for estimate editing (admin) — MUST be before /:estimateId
router.get('/estimates/products', requireAuth, async (req, res) => {
    try {
        const { search } = req.query;
        if (!search || search.trim().length < 2) return res.json({ success: true, products: [] });

        const [products] = await pool.query(
            `SELECT zim.zoho_item_id, zim.zoho_item_name, zim.zoho_description, zim.zoho_rate,
                    zim.brand, zim.category, zim.image_url
             FROM zoho_items_map zim
             WHERE (zim.zoho_item_name LIKE ? OR zim.zoho_description LIKE ? OR zim.brand LIKE ?)
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
             WHERE pei.estimate_id = ? ORDER BY pei.display_order, pei.id`,
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
            `SELECT zoho_item_id, zoho_item_name, zoho_description, zoho_rate, brand, category
             FROM zoho_items_map WHERE zoho_item_id IN (?)`,
            [itemIds]
        );
        const zohoMap = {};
        zohoItems.forEach(z => { zohoMap[z.zoho_item_id] = z; });

        // Delete old items
        await pool.query('DELETE FROM painter_estimate_items WHERE estimate_id = ?', [estimate.id]);

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
                [estimate.id, reqItem.item_id, zoho.zoho_item_name, zoho.brand, zoho.category, qty, unitPrice, lineTotal, i + 1]
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
            'SELECT * FROM painter_estimate_items WHERE estimate_id = ? ORDER BY display_order, id',
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
            'SELECT id, unit_price, quantity FROM painter_estimate_items WHERE estimate_id = ?',
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
                    await painterNotificationService.send(pool, req_rows[0].painter_id, {
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
                await painterNotificationService.send(pool, req_rows[0].painter_id, {
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

module.exports = { router, setPool, setIO, setSessionManager };
