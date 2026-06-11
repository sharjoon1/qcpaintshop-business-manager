/**
 * Painter Routes — public endpoints (no auth middleware on registration)
 * (A8a split): register, send-otp, verify-otp, validate-referral,
 * estimate share link, coverage-rates config, painter activation
 * (does its own token/permission checks inline).
 */

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { randomInt } = require('crypto');
const pointsEngine = require('../../services/painter-points-engine');
const zohoAPI = require('../../services/zoho-api');
const smsService = require('../../services/sms-service');
const notificationService = require('../../services/notification-service');
const { otpLimiter } = require('../../middleware/rateLimiter');
const audit = require('../../services/audit-log');
const { hashOtp, otpMatches, MAX_OTP_ATTEMPTS } = require('../../services/otp-utils');

let pool;
let sessionManager;
function setPool(p) { pool = p; }
function setSessionManager(sm) { sessionManager = sm; }

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
        for (let attempt = 0; attempt < 5; attempt++) {
            const [codeCheck] = await pool.query('SELECT id FROM painters WHERE referral_code = ?', [myReferralCode]);
            if (codeCheck.length === 0) break;
            myReferralCode = pointsEngine.generateReferralCode(full_name) + randomInt(10, 100);
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

        // Fire-and-forget Zoho customer + salesperson sync
        try {
            const painterZohoSync = require('../../services/painter-zoho-sync-service');
            painterZohoSync.syncPainterToZoho(result.insertId, { pool, zohoApi: zohoAPI })
                .catch(err => console.error('[painters] zoho sync after register failed', err.message));
        } catch (err) {
            console.error('[painters] zoho sync module load failed', err.message);
        }

        // Notify admins about new pending registration
        try {
            const [admins] = await pool.query("SELECT id FROM users WHERE role IN ('admin','manager') AND status = 'active'");
            for (const admin of admins) {
                await notificationService.send(admin.id, {
                    type: 'painter_registered',
                    title: 'New Painter Registration',
                    body: `${full_name}${city ? ' (' + city + ')' : ''} registered and is awaiting approval.`,
                    data: { page: 'painters', tab: 'list', filter: 'pending' }
                });
            }
        } catch (nErr) { console.error('[painters] registration notify error:', nErr.message); }

        res.json({ success: true, message: 'Registration submitted. Awaiting approval.', painterId: result.insertId, referralCode: myReferralCode });
    } catch (error) {
        console.error('Painter registration error:', error);
        res.status(500).json({ success: false, message: 'Registration failed' });
    }
});

// Send OTP
router.post('/send-otp', otpLimiter, async (req, res) => {
    try {
        const { phone } = req.body;
        if (!phone) return res.status(400).json({ success: false, message: 'Phone is required' });

        const [painters] = await pool.query('SELECT id, status, full_name FROM painters WHERE phone = ?', [phone]);
        if (!painters.length) return res.status(404).json({ success: false, code: 'NOT_REGISTERED', message: 'No painter found with this phone number' });

        const painter = painters[0];

        // Play Store test account — fixed OTP bypass, never honored in production.
        // KN-P2-3: fail-closed — requires BOTH non-prod NODE_ENV AND an explicit
        // ALLOW_TEST_OTP=true flag, so a single NODE_ENV misconfig cannot open it.
        const allowTestBypass = process.env.NODE_ENV !== 'production' && process.env.ALLOW_TEST_OTP === 'true';
        const isTestAccount = allowTestBypass && (phone === '9999999999' || phone === '+919999999999');
        const otp = isTestAccount ? '123456' : String(crypto.randomInt(100000, 1000000));
        const token = crypto.randomBytes(32).toString('hex');

        await pool.query('DELETE FROM painter_sessions WHERE painter_id = ? AND expires_at < NOW()', [painter.id]);

        // Dual-write raw token + hash so a code rollback can still find this row; reads use hash.
        // S2: only the OTP's sha256 hash is stored.
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        await pool.query(
            'INSERT INTO painter_sessions (painter_id, token, token_hash, otp, otp_expires_at, expires_at) VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE), DATE_ADD(NOW(), INTERVAL 30 DAY))',
            [painter.id, token, tokenHash, hashOtp(otp)]
        );

        // Send OTP via SMS (primary) + WhatsApp (secondary)
        if (process.env.NODE_ENV !== 'production') {
            console.log(`[Painter OTP] Phone: ${phone}, OTP: ${otp}`);
        }

        if (!isTestAccount) {
            // 1. SMS — always send (reliable)
            {
                const smsText = `Your verification OTP for Quality Colours registration is ${otp}. Please enter this code at https://qcpaintshop.com/ to complete setup. - QUALITY COLOURS.`;
                const cleanPhone = phone.replace(/\D/g, '');
                const number = cleanPhone.startsWith('91') ? cleanPhone : '91' + cleanPhone;
                smsService.sendSms({ number, text: smsText, label: `Painter OTP ${phone}` });
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
router.post('/verify-otp', otpLimiter, async (req, res) => {
    try {
        const { phone, otp } = req.body;
        if (!phone || !otp) return res.status(400).json({ success: false, message: 'Phone and OTP are required' });

        // S2: fetch the latest pending OTP session for the phone, compare the
        // hash in Node, and cap wrong guesses per issued code.
        const [sessions] = await pool.query(
            `SELECT ps.id, ps.token, ps.painter_id, ps.otp AS otp_hash, ps.otp_attempts,
                    p.status, p.full_name, p.phone, p.profile_photo, p.level, p.referral_code
             FROM painter_sessions ps JOIN painters p ON ps.painter_id = p.id
             WHERE p.phone = ? AND ps.otp IS NOT NULL AND ps.otp_expires_at > NOW()
             ORDER BY ps.id DESC LIMIT 1`,
            [phone]
        );

        if (!sessions.length) {
            // S4: audit failed painter login (actor unauthenticated → 'system')
            audit.record(req, {
                action: 'PAINTER_LOGIN_FAILED', entity_type: 'painter', entity_id: null,
                after: { phone, reason: 'invalid_or_expired_otp' }
            });
            return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
        }

        const session = sessions[0];

        if (session.otp_attempts >= MAX_OTP_ATTEMPTS) {
            await pool.query('UPDATE painter_sessions SET otp = NULL, otp_expires_at = NULL WHERE id = ?', [session.id]);
            return res.status(400).json({ success: false, message: 'Too many wrong attempts. Request a new OTP.' });
        }
        if (!otpMatches(session.otp_hash, otp)) {
            await pool.query('UPDATE painter_sessions SET otp_attempts = otp_attempts + 1 WHERE id = ?', [session.id]);
            audit.record(req, {
                action: 'PAINTER_LOGIN_FAILED', entity_type: 'painter', entity_id: session.painter_id,
                after: { phone, reason: 'wrong_otp' }
            });
            return res.status(400).json({ success: false, message: 'Invalid or expired OTP' });
        }

        await pool.query('UPDATE painter_sessions SET otp = NULL, otp_expires_at = NULL WHERE id = ?', [session.id]);

        // S4: audit successful painter login
        audit.record(req, {
            action: 'PAINTER_LOGIN_SUCCESS', entity_type: 'painter', entity_id: session.painter_id,
            after: { phone: session.phone, status: session.status }
        });

        res.json({
            success: true, token: session.token,
            painter: {
                id: session.painter_id,
                full_name: session.full_name,
                phone: session.phone,
                profile_photo: session.profile_photo || null,
                level: session.level || null,
                status: session.status,
                referral_code: session.referral_code
            }
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
            'SELECT * FROM painter_estimate_items WHERE estimate_id = ? AND deleted_at IS NULL ORDER BY display_order, id', [estimate.id]
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

// ═══════════════════════════════════════════════════════════════
// PAINT COVERAGE CONFIG (no auth needed)
// ═══════════════════════════════════════════════════════════════

router.get('/config/coverage-rates', async (req, res) => {
    try {
        const [rows] = await pool.query("SELECT config_key, config_value FROM ai_config WHERE config_key LIKE 'paint_coverage_%'");

        const defaults = {
            primer: 110,
            putty: 30,
            interior_emulsion: 110,
            exterior_emulsion: 90,
            texture: 30,
            waterproofing: 55
        };

        if (rows.length === 0) {
            return res.json({ success: true, coverage_rates: defaults, source: 'defaults' });
        }

        const rates = { ...defaults };
        for (const row of rows) {
            const key = row.config_key.replace('paint_coverage_', '');
            rates[key] = parseFloat(row.config_value) || defaults[key] || 0;
        }

        res.json({ success: true, coverage_rates: rates, source: 'config' });
    } catch (error) {
        console.error('Get coverage rates error:', error);
        res.status(500).json({ success: false, message: 'Failed to get coverage rates' });
    }
});

// ═══════════════════════════════════════════
// PAINTER ACTIVATION (self via painter-token OR admin via permission)
// ═══════════════════════════════════════════
router.post('/:id/activate', async (req, res) => {
    try {
        const painterId = Number(req.params.id);
        if (!painterId) return res.status(400).json({ success: false, message: 'Invalid painter id' });

        // Try painter self-activation first
        let authorized = false;
        const painterToken = req.headers['x-painter-token'];
        if (painterToken) {
            const [ps] = await pool.query(
                `SELECT painter_id FROM painter_sessions WHERE token_hash = LOWER(SHA2(?, 256)) AND expires_at > NOW() LIMIT 1`,
                [painterToken]
            );
            if (ps.length && ps[0].painter_id === painterId) authorized = true;
        }

        // Fallback: admin with painters.manage
        if (!authorized) {
            const adminToken = req.headers.authorization?.replace('Bearer ', '');
            if (adminToken) {
                const [sessions] = await pool.query(
                    `SELECT u.role FROM user_sessions s JOIN users u ON s.user_id = u.id
                     WHERE s.token_hash = LOWER(SHA2(?, 256)) AND s.expires_at > NOW() AND u.status='active' LIMIT 1`,
                    [adminToken]
                );
                if (sessions.length) {
                    if (['admin','administrator','super_admin'].includes((sessions[0].role || '').toLowerCase())) authorized = true;
                    else {
                        const [perms] = await pool.query(
                            `SELECT 1 FROM role_permissions rp
                             JOIN permissions p ON rp.permission_id = p.id
                             JOIN roles r ON rp.role_id = r.id
                             WHERE r.name = ? AND p.module='painters' AND p.action='manage' LIMIT 1`,
                            [sessions[0].role]
                        );
                        if (perms.length) authorized = true;
                    }
                }
            }
        }

        if (!authorized) return res.status(403).json({ success: false, message: 'forbidden' });

        const [rows] = await pool.query(`SELECT id, activated_at FROM painters WHERE id = ? LIMIT 1`, [painterId]);
        if (!rows.length) return res.status(404).json({ success: false, message: 'not_found' });
        if (rows[0].activated_at) return res.json({ success: true, already_activated: true });

        await pool.query(`UPDATE painters SET activated_at = NOW() WHERE id = ?`, [painterId]);
        await pool.query(
            `UPDATE painter_leads SET status='active_painter', activated_at = NOW() WHERE painter_id = ?`,
            [painterId]
        );

        // Fire-and-forget: Zoho sync → then backfill
        const painterZohoSync = require('../../services/painter-zoho-sync-service');
        const backfill = require('../../services/painter-points-backfill-service');
        painterZohoSync.syncPainterToZoho(painterId, { pool, zohoApi: zohoAPI })
            .then(() => backfill.backfillPainter(painterId, '2025-12-01', { pool }))
            .catch(err => console.error('[painters] activate chain failed', err.message));

        res.json({ success: true, activated: true });
    } catch (err) {
        console.error('[painters] activate endpoint error:', err);
        res.status(500).json({ success: false, message: err.message });
    }
});

module.exports = { router, setPool, setSessionManager };
