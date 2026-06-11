/**
 * Painter Routes — painter-actor endpoints (A8a split).
 * Every route here is gated by requirePainterAuth or requirePainterSession
 * (the /me/* surface + logout + location-report).
 */

const express = require('express');
const router = express.Router();
const pointsEngine = require('../../services/painter-points-engine');
const { uploadPainterAttendance, uploadProfile, uploadPainterVisualization } = require('../../config/uploads');
const sharp = require('sharp');
const cardGenerator = require('../../services/painter-card-generator');
const painterNotificationService = require('../../services/painter-notification-service');
const notificationService = require('../../services/notification-service');
const { generatePainterEstimatePDF } = require('../painter-estimate-pdf-generator');
const attendanceService = require('../../services/painter-attendance-service');
const { idempotent } = require('../../middleware/idempotency');
const { requirePainterAuth, requirePainterSession } = require('./middleware');
const { logEstimateStatusChange } = require('./shared');

let pool;
let io;
function setPool(p) { pool = p; }
function setIO(ioInstance) { io = ioInstance; }

// ─── Painter Custom-Rate Resolver ─────────────────────────
// Loads painter's overrides once and returns (zohoItemId, brand, category) -> {discountPct, bonusPts}
// Priority: item > brand > category. Used by /me/products, /me/catalog, /me/offer-products.
async function getPainterOverrideResolver(painterId) {
    if (!painterId) return () => ({ discountPct: 0, bonusPts: 0 });
    let rows;
    try {
        [rows] = await pool.query(
            `SELECT scope, target_id, zoho_item_id, discount_pct, bonus_regular_points
             FROM painter_custom_rates WHERE painter_id = ?`,
            [painterId]
        );
    } catch (err) {
        // Table may not exist yet (migration not run). Fail open — no overrides.
        if (err && err.code === 'ER_NO_SUCH_TABLE') return () => ({ discountPct: 0, bonusPts: 0 });
        throw err;
    }
    const byItem = new Map();
    const byBrand = new Map();
    const byCategory = new Map();
    for (const r of rows) {
        const entry = {
            discountPct: parseFloat(r.discount_pct || 0),
            bonusPts: parseFloat(r.bonus_regular_points || 0)
        };
        if (r.scope === 'item' && r.zoho_item_id) byItem.set(String(r.zoho_item_id), entry);
        else if (r.scope === 'brand') byBrand.set(r.target_id, entry);
        else if (r.scope === 'category') byCategory.set(r.target_id, entry);
    }
    return (zohoItemId, brand, category) => (
        (zohoItemId && byItem.get(String(zohoItemId))) ||
        (brand && byBrand.get(brand)) ||
        (category && byCategory.get(category)) ||
        { discountPct: 0, bonusPts: 0 }
    );
}

function applyOverrideToRate(rate, discountPct) {
    if (!rate || !discountPct) return rate;
    const d = parseFloat(discountPct);
    if (d <= 0 || d >= 100) return rate;
    return Math.round(parseFloat(rate) * (1 - d / 100) * 100) / 100;
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

// S3: painter logout — revoke the presented session (engineers.js parity;
// painters previously had NO way to invalidate a 30-day token).
router.post('/logout', requirePainterSession, async (req, res) => {
    try {
        const token = req.headers['x-painter-token'];
        await pool.query('DELETE FROM painter_sessions WHERE token_hash = LOWER(SHA2(?, 256))', [token]);
        res.json({ success: true });
    } catch (error) {
        console.error('Painter logout error:', error);
        res.status(500).json({ success: false, message: 'Logout failed' });
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

// Painter taps "Request Approval" button on pending screen.
// Rate-limited to once per 2 minutes. Increments counter so admin
// can gauge interest.
router.post('/me/request-approval', requirePainterSession, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT approval_request_count, last_approval_request_at FROM painters WHERE id = ?',
            [req.painter.id]
        );
        if (!rows.length) return res.status(404).json({ success: false, message: 'Painter not found' });

        const painter = rows[0];
        const RATE_LIMIT_SECONDS = 120;

        if (painter.last_approval_request_at) {
            const last = new Date(painter.last_approval_request_at).getTime();
            const elapsed = Math.floor((Date.now() - last) / 1000);
            if (elapsed < RATE_LIMIT_SECONDS) {
                const remaining = RATE_LIMIT_SECONDS - elapsed;
                return res.status(429).json({
                    success: false,
                    code: 'RATE_LIMITED',
                    message: `Please wait ${remaining} seconds before requesting again`,
                    seconds_remaining: remaining,
                    next_available_at: new Date(last + RATE_LIMIT_SECONDS * 1000).toISOString(),
                    count: painter.approval_request_count
                });
            }
        }

        await pool.query(
            'UPDATE painters SET approval_request_count = approval_request_count + 1, last_approval_request_at = NOW() WHERE id = ?',
            [req.painter.id]
        );

        const newCount = painter.approval_request_count + 1;
        const nextAvailable = new Date(Date.now() + RATE_LIMIT_SECONDS * 1000).toISOString();
        console.log(`[Painter Approval Request] painter_id=${req.painter.id} count=${newCount}`);

        res.json({
            success: true,
            message: 'Approval request sent',
            count: newCount,
            next_available_at: nextAvailable,
            seconds_remaining: RATE_LIMIT_SECONDS
        });
    } catch (error) {
        console.error('Request approval error:', error);
        res.status(500).json({ success: false, message: 'Failed to send approval request' });
    }
});

// Lightweight endpoint Android calls on app startup to determine
// which screen to show (Home / PendingApproval / Login).
router.get('/me/status', requirePainterSession, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT id, full_name, phone, profile_photo, level, status, referral_code,
                    approval_request_count, last_approval_request_at
             FROM painters WHERE id = ?`,
            [req.painter.id]
        );
        if (!rows.length) return res.status(404).json({ success: false, message: 'Painter not found' });

        const p = rows[0];
        let seconds_remaining = 0;
        let next_available_at = null;
        if (p.last_approval_request_at) {
            const last = new Date(p.last_approval_request_at).getTime();
            const elapsed = Math.floor((Date.now() - last) / 1000);
            if (elapsed < 120) {
                seconds_remaining = 120 - elapsed;
                next_available_at = new Date(last + 120 * 1000).toISOString();
            }
        }

        res.json({
            success: true,
            painter: {
                id: p.id,
                full_name: p.full_name,
                phone: p.phone,
                profile_photo: p.profile_photo || null,
                level: p.level || null,
                status: p.status,
                referral_code: p.referral_code
            },
            approval: {
                count: p.approval_request_count || 0,
                last_request_at: p.last_approval_request_at,
                seconds_remaining,
                next_available_at
            }
        });
    } catch (error) {
        console.error('Get status error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch status' });
    }
});

// Unified profile update (multipart: full_name, city, optional photo)
// Used by painter Android EditProfileScreen — single multipart call
router.put('/me/profile', requirePainterAuth, uploadProfile.single('photo'), async (req, res) => {
    try {
        const fullName = (req.body.full_name || '').trim();
        const city = req.body.city || null;
        if (!fullName) return res.status(400).json({ success: false, message: 'Name is required' });

        let photoUrl = null;
        if (req.file) {
            const filename = `painter_${req.painter.id}.jpg`;
            const outputPath = require('path').join(__dirname, '..', '..', 'public', 'uploads', 'profiles', filename);
            await sharp(req.file.path)
                .resize(400, 400, { fit: 'cover' })
                .jpeg({ quality: 80 })
                .toFile(outputPath + '.tmp');
            const fs = require('fs');
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
            fs.renameSync(outputPath + '.tmp', outputPath);
            if (req.file.path !== outputPath) { try { fs.unlinkSync(req.file.path); } catch (e) { console.warn('[Painters] temp file cleanup failed:', e.message); } }
            photoUrl = `/uploads/profiles/${filename}?v=${Date.now()}`;
        }

        const sets = ['full_name = ?', 'city = COALESCE(?, city)', 'card_generated_at = NULL', 'id_card_generated_at = NULL'];
        const params = [fullName, city];
        if (photoUrl) {
            sets.splice(2, 0, 'profile_photo = ?');
            params.splice(2, 0, photoUrl);
        }
        await pool.query(`UPDATE painters SET ${sets.join(', ')} WHERE id = ?`, [...params, req.painter.id]);
        res.json({ success: true, message: 'Profile updated', photo_url: photoUrl });
    } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ success: false, message: 'Failed to update profile' });
    }
});

// Upload/update profile photo
router.put('/me/profile-photo', requirePainterAuth, uploadProfile.single('photo'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No photo uploaded' });

        const filename = `painter_${req.painter.id}.jpg`;
        const outputPath = require('path').join(__dirname, '..', '..', 'public', 'uploads', 'profiles', filename);

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
            try { fs.unlinkSync(req.file.path); } catch(e) { console.warn('[Painters] temp file cleanup failed:', e.message); }
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
            'SELECT id, full_name, phone, city, specialization, experience_years, referral_code, profile_photo, current_level, card_generated_at, updated_at FROM painters WHERE id = ?',
            [req.painter.id]
        );
        if (!painters.length) return res.status(404).json({ success: false, message: 'Painter not found' });

        const painter = painters[0];
        const cardPath = require('path').join(__dirname, '..', '..', 'public', 'uploads', 'painter-cards', `painter_${painter.id}.png`);
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
            'SELECT id, full_name, phone, city, specialization, experience_years, referral_code, profile_photo, current_level, id_card_generated_at, updated_at FROM painters WHERE id = ?',
            [req.painter.id]
        );
        if (!painters.length) return res.status(404).json({ success: false, message: 'Painter not found' });

        const painter = painters[0];
        const cardPath = require('path').join(__dirname, '..', '..', 'public', 'uploads', 'painter-cards', `painter_id_${painter.id}.png`);
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
        const [[self]] = await pool.query('SELECT referral_code FROM painters WHERE id = ?', [req.painter.id]);
        const [referrals] = await pool.query(
            `SELECT pr.id, pr.status, pr.created_at,
                    pr.total_referral_points AS earnings,
                    p.full_name, p.phone, p.status AS painter_status, p.city
             FROM painter_referrals pr JOIN painters p ON pr.referred_id = p.id
             WHERE pr.referrer_id = ? ORDER BY pr.created_at DESC`,
            [req.painter.id]
        );
        const totalEarnings = referrals.reduce((sum, r) => sum + parseFloat(r.earnings || 0), 0);
        res.json({
            success: true,
            referral_code: self?.referral_code || null,
            total_earnings: totalEarnings,
            referrals,
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to get referrals' });
    }
});

router.post('/me/withdraw', requirePainterAuth, idempotent('painter.withdraw.create'), async (req, res) => {
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
        const [balance, [referralCount], [recentTxns], [pendingWithdrawals], [painter], [logoSetting], [painterLevel]] = await Promise.all([
            pointsEngine.getBalance(req.painter.id),
            pool.query('SELECT COUNT(*) as count FROM painter_referrals WHERE referrer_id = ?', [req.painter.id]),
            pool.query('SELECT * FROM painter_point_transactions WHERE painter_id = ? ORDER BY created_at DESC LIMIT 10', [req.painter.id]),
            pool.query('SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM painter_withdrawals WHERE painter_id = ? AND status = "pending"', [req.painter.id]),
            pool.query('SELECT referral_code, profile_photo, full_name, city FROM painters WHERE id = ?', [req.painter.id]),
            pool.query("SELECT setting_value FROM settings WHERE setting_key = 'business_logo' LIMIT 1"),
            pool.query('SELECT current_level, current_streak, longest_streak FROM painters WHERE id = ?', [req.painter.id])
        ]);

        const logoVal = logoSetting[0]?.setting_value || null;
        const businessLogo = logoVal
            ? (logoVal.startsWith('/') ? logoVal : `/uploads/logos/${logoVal}`)
            : null;

        // Annual withdrawal window info
        let annualWithdrawalInfo = null;
        try {
            const [awConfig] = await pool.query("SELECT config_key, config_value FROM ai_config WHERE config_key IN ('painter_annual_withdrawal_month', 'painter_annual_withdrawal_day')");
            const cfgMap = {};
            awConfig.forEach(c => { cfgMap[c.config_key] = c.config_value; });
            const awMonth = parseInt(cfgMap.painter_annual_withdrawal_month) || 1;
            const awDay = parseInt(cfgMap.painter_annual_withdrawal_day) || 1;
            const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
            annualWithdrawalInfo = { month: awMonth, day: awDay, label: `Withdrawal opens on ${monthNames[awMonth]} ${awDay}` };
        } catch (e) { /* optional config fetch; skip if table absent */ }

        res.json({
            success: true,
            dashboard: {
                balance,
                referralCode: painter[0]?.referral_code,
                profilePhoto: painter[0]?.profile_photo,
                painterName: painter[0]?.full_name,
                painterCity: painter[0]?.city || '',
                referralCount: referralCount[0].count,
                recentTransactions: recentTxns,
                pendingWithdrawals: { count: pendingWithdrawals[0].count, total: parseFloat(pendingWithdrawals[0].total) },
                businessLogo,
                annualWithdrawalInfo,
                level: painterLevel[0]?.current_level || 'bronze',
                streak: painterLevel[0]?.current_streak || 0,
                longestStreak: painterLevel[0]?.longest_streak || 0
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to load dashboard' });
    }
});

// ═══════════════════════════════════════════
// DAILY STREAK CHECK-IN
// ═══════════════════════════════════════════

router.put('/me/daily-streak', requirePainterAuth, async (req, res) => {
    try {
        const painterId = req.painter.id;
        const todayIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
        const todayStr = `${todayIST.getFullYear()}-${String(todayIST.getMonth() + 1).padStart(2, '0')}-${String(todayIST.getDate()).padStart(2, '0')}`;

        // Check if already checked in today (idempotent)
        const [existing] = await pool.query(
            'SELECT streak_count, bonus_awarded FROM painter_daily_checkins WHERE painter_id = ? AND checkin_date = ?',
            [painterId, todayStr]
        );
        if (existing.length) {
            const [painter] = await pool.query(
                'SELECT current_streak, longest_streak, current_level FROM painters WHERE id = ?',
                [painterId]
            );
            return res.json({
                success: true,
                alreadyCheckedIn: true,
                streak: painter[0].current_streak,
                longestStreak: painter[0].longest_streak,
                level: painter[0].current_level
            });
        }

        // Get painter's last check-in
        const [painter] = await pool.query(
            'SELECT current_streak, longest_streak, last_checkin_date, current_level FROM painters WHERE id = ?',
            [painterId]
        );
        if (!painter.length) return res.status(404).json({ success: false, message: 'Painter not found' });

        const p = painter[0];
        let newStreak = 1;

        // Check if yesterday was last check-in (consecutive day)
        if (p.last_checkin_date) {
            const lastDate = new Date(p.last_checkin_date);
            const yesterday = new Date(todayIST);
            yesterday.setDate(yesterday.getDate() - 1);

            if (lastDate.toISOString().slice(0, 10) === yesterday.toISOString().slice(0, 10)) {
                newStreak = p.current_streak + 1;
            } else if (lastDate.toISOString().slice(0, 10) === todayStr) {
                newStreak = p.current_streak;
            }
        }

        const newLongest = Math.max(newStreak, p.longest_streak || 0);

        // Determine milestone bonus
        const MILESTONES = { 3: 10, 7: 50, 14: 150, 30: 500 };
        let bonusAwarded = 0;
        let milestoneHit = null;

        if (MILESTONES[newStreak]) {
            bonusAwarded = MILESTONES[newStreak];
            milestoneHit = newStreak;
        } else if (newStreak > 30 && newStreak % 30 === 0) {
            bonusAwarded = 500;
            milestoneHit = newStreak;
        }

        // Insert check-in record
        await pool.query(
            'INSERT INTO painter_daily_checkins (painter_id, checkin_date, streak_count, bonus_awarded) VALUES (?, ?, ?, ?)',
            [painterId, todayStr, newStreak, bonusAwarded]
        );

        // Update painter record
        await pool.query(
            'UPDATE painters SET current_streak = ?, longest_streak = ?, last_checkin_date = ? WHERE id = ?',
            [newStreak, newLongest, todayStr, painterId]
        );

        // Award milestone bonus (with level multiplier — also handles level-up notification internally)
        let levelUp = null;
        if (bonusAwarded > 0) {
            const result = await pointsEngine.addPointsWithMultiplier(
                painterId, 'regular', bonusAwarded, 'streak_bonus',
                todayStr, 'streak', `${newStreak}-day streak bonus`, null
            );
            levelUp = result.levelUp;

            // Send milestone notification
            const notif = painterNotificationService.getRetentionNotification('streak_milestone', newStreak, bonusAwarded);
            painterNotificationService.sendToPainter(painterId, notif).catch(e =>
                console.error(`[Streak] Milestone notification failed:`, e.message)
            );
        }

        res.json({
            success: true,
            alreadyCheckedIn: false,
            streak: newStreak,
            longestStreak: newLongest,
            bonusAwarded,
            milestoneHit,
            levelUp,
            level: levelUp ? levelUp.newLevel : p.current_level
        });
    } catch (error) {
        console.error('[Streak] Check-in error:', error);
        res.status(500).json({ success: false, message: 'Failed to record streak' });
    }
});

// ═══════════════════════════════════════════
// MORNING BRIEFING
// ═══════════════════════════════════════════

router.get('/me/briefing', requirePainterAuth, async (req, res) => {
    try {
        const painterId = req.painter.id;

        const [painter] = await pool.query(
            `SELECT current_level, current_streak, longest_streak, last_checkin_date, last_briefing_at,
                    total_earned_regular, total_earned_annual, regular_points, annual_points, full_name
             FROM painters WHERE id = ?`,
            [painterId]
        );
        if (!painter.length) return res.status(404).json({ success: false, message: 'Painter not found' });
        const p = painter[0];

        // 1. "What you earned" — points since last briefing
        const lastBriefing = p.last_briefing_at || new Date(0);
        const [recentPoints] = await pool.query(
            `SELECT COALESCE(SUM(amount), 0) as earned
             FROM painter_point_transactions
             WHERE painter_id = ? AND type = 'earn' AND created_at > ?`,
            [painterId, lastBriefing]
        );
        const earnedSinceLastVisit = parseFloat(recentPoints[0].earned);

        const [estimateUpdates] = await pool.query(
            `SELECT id, estimate_number, status, updated_at
             FROM painter_estimates
             WHERE painter_id = ? AND updated_at > ?
             ORDER BY updated_at DESC LIMIT 5`,
            [painterId, lastBriefing]
        );

        const [withdrawalUpdates] = await pool.query(
            `SELECT id, pool, amount, status, processed_at
             FROM painter_withdrawals
             WHERE painter_id = ? AND (processed_at > ? OR requested_at > ?)
             ORDER BY COALESCE(processed_at, requested_at) DESC LIMIT 5`,
            [painterId, lastBriefing, lastBriefing]
        );

        // 2. "Today's opportunity" — daily bonus product
        const [bonusConfig] = await pool.query(
            "SELECT config_key, config_value FROM ai_config WHERE config_key IN ('painter_daily_bonus_product_id', 'painter_daily_bonus_multiplier', 'painter_daily_bonus_cap')"
        );
        const cfg = {};
        bonusConfig.forEach(c => { cfg[c.config_key] = c.config_value; });

        let dailyBonus = null;
        if (cfg.painter_daily_bonus_product_id) {
            const [product] = await pool.query(
                `SELECT p.id, p.name, b.name as brand, c.name as category, p.image_url
                 FROM products p LEFT JOIN brands b ON p.brand_id = b.id LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = ?`,
                [cfg.painter_daily_bonus_product_id]
            );
            if (product.length) {
                const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
                const midnightIST = new Date(nowIST);
                midnightIST.setHours(24, 0, 0, 0);
                const hoursLeft = Math.max(0, Math.round((midnightIST - nowIST) / (1000 * 60 * 60) * 10) / 10);

                dailyBonus = {
                    product: product[0],
                    multiplier: parseInt(cfg.painter_daily_bonus_multiplier) || 2,
                    cap: parseInt(cfg.painter_daily_bonus_cap) || 500,
                    hoursLeft
                };
            }
        }

        // 3. "Your progress" — level + streak
        const lifetime = parseFloat(p.total_earned_regular) + parseFloat(p.total_earned_annual);
        const [levels] = await pool.query('SELECT * FROM painter_levels ORDER BY min_points ASC');
        const currentLevelData = levels.find(l => l.level_name === p.current_level) || levels[0];
        const nextLevel = levels.find(l => l.min_points > lifetime);

        const levelProgress = nextLevel ? {
            current: p.current_level,
            next: nextLevel.level_name,
            currentPoints: lifetime,
            nextThreshold: nextLevel.min_points,
            percentage: Math.min(100, Math.round((lifetime / nextLevel.min_points) * 100)),
            pointsNeeded: nextLevel.min_points - lifetime,
            nextMultiplier: parseFloat(nextLevel.multiplier),
            badgeColor: currentLevelData.badge_color,
            nextBadgeColor: nextLevel.badge_color
        } : {
            current: p.current_level,
            next: null,
            currentPoints: lifetime,
            percentage: 100,
            pointsNeeded: 0,
            badgeColor: currentLevelData.badge_color
        };

        // Update last_briefing_at
        await pool.query('UPDATE painters SET last_briefing_at = NOW() WHERE id = ?', [painterId]);

        res.json({
            success: true,
            briefing: {
                earned: {
                    pointsSinceLastVisit: earnedSinceLastVisit,
                    estimateUpdates,
                    withdrawalUpdates
                },
                dailyBonus,
                progress: {
                    streak: p.current_streak || 0,
                    longestStreak: p.longest_streak || 0,
                    level: levelProgress,
                    multiplier: parseFloat(currentLevelData.multiplier)
                }
            }
        });
    } catch (error) {
        console.error('[Briefing] Error:', error);
        res.status(500).json({ success: false, message: 'Failed to load briefing' });
    }
});

// ═══════════════════════════════════════════
// CHECK-IN HISTORY (for streak calendar)
// ═══════════════════════════════════════════

router.get('/me/checkin-history', requirePainterAuth, async (req, res) => {
    try {
        const month = req.query.month; // format: YYYY-MM
        if (!month || !/^\d{4}-\d{2}$/.test(month)) {
            return res.status(400).json({ success: false, message: 'month param required (YYYY-MM)' });
        }

        const [checkins] = await pool.query(
            `SELECT checkin_date, streak_count, bonus_awarded
             FROM painter_daily_checkins
             WHERE painter_id = ? AND checkin_date LIKE ?
             ORDER BY checkin_date ASC`,
            [req.painter.id, `${month}%`]
        );

        res.json({
            success: true,
            checkins: checkins.map(c => ({
                date: c.checkin_date,
                streak: c.streak_count,
                bonus: parseFloat(c.bonus_awarded)
            }))
        });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to load check-in history' });
    }
});

// ═══════════════════════════════════════════
// PAINTER ESTIMATE ENDPOINTS (/me/estimates/*)
// ═══════════════════════════════════════════

// Helper: generate estimate number PE + YYYYMMDD + 4-digit seq
// Atomic: uses painter_estimate_sequence row-lock so concurrent requests can't collide.
async function generateEstimateNumber() {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const prefix = `PE${y}${m}${d}`;
    await pool.query(
        `INSERT INTO painter_estimate_sequence (date_prefix, last_seq) VALUES (?, 1)
         ON DUPLICATE KEY UPDATE last_seq = last_seq + 1`,
        [prefix]
    );
    const [rows] = await pool.query(
        'SELECT last_seq FROM painter_estimate_sequence WHERE date_prefix = ?',
        [prefix]
    );
    const seq = rows.length ? parseInt(rows[0].last_seq) : 1;
    return prefix + String(seq).padStart(4, '0');
}

// Product list for estimate builder
router.get('/me/estimates/products', requirePainterAuth, async (req, res) => {
    try {
        const { billing_type, search, brand, category, product_type, hasPoints, hasOffer } = req.query;

        const filterHasPoints = hasPoints === 'true' || hasPoints === '1';

        let where = "WHERE p.status = 'active' AND ps.is_active = 1 AND ps.zoho_item_id IS NOT NULL";
        const params = [];

        if (search) {
            where += ' AND (p.name LIKE ? OR b.name LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }
        if (brand) {
            const brandId = parseInt(brand, 10);
            if (!isNaN(brandId) && brandId > 0) {
                where += ' AND b.id = ?';
                params.push(brandId);
            } else {
                where += ' AND b.name = ?';
                params.push(brand);
            }
        }
        if (category) {
            const catId = parseInt(category, 10);
            if (!isNaN(catId) && catId > 0) {
                where += ' AND c.id = ?';
                params.push(catId);
            } else {
                where += ' AND c.name = ?';
                params.push(category);
            }
        }
        if (product_type) {
            where += ' AND p.product_type = ?';
            params.push(product_type);
        }

        const hasPointsJoin = filterHasPoints
            ? `INNER JOIN painter_product_point_rates ppr ON ppr.item_id = ps.zoho_item_id COLLATE utf8mb4_unicode_ci AND ppr.regular_points_per_unit > 0`
            : '';

        const [rows] = await pool.query(`
            SELECT p.id, p.name, p.product_type, p.area_coverage, p.gst_percentage, p.image_url,
                   b.name as brand, b.id as brand_id,
                   c.name as category, c.id as category_id,
                   ps.id as pack_size_id, ps.size, ps.unit, ps.base_price, ps.zoho_item_id,
                   ps.color_name, ps.color_code,
                   zim.zoho_rate, zim.zoho_label_rate, zim.zoho_stock_on_hand as stock,
                   pprs.regular_points_per_unit as regular_points,
                   pprs.annual_eligible, pprs.annual_pct
            FROM products p
            LEFT JOIN brands b ON p.brand_id = b.id
            LEFT JOIN categories c ON p.category_id = c.id
            INNER JOIN pack_sizes ps ON ps.product_id = p.id
            LEFT JOIN zoho_items_map zim ON zim.zoho_item_id = ps.zoho_item_id
            LEFT JOIN painter_product_point_rates pprs ON pprs.item_id = ps.zoho_item_id COLLATE utf8mb4_unicode_ci
            ${hasPointsJoin}
            ${where}
            ORDER BY b.name, p.name, CAST(ps.size AS DECIMAL(10,2))
        `, params);

        // Painter overrides
        const resolveOverride = await getPainterOverrideResolver(req.painter?.id);

        // Group by product
        const productMap = {};
        for (const row of rows) {
            if (!productMap[row.id]) {
                productMap[row.id] = {
                    id: row.id,
                    name: row.name,
                    image_url: row.image_url || null,
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
            const ov = resolveOverride(row.zoho_item_id, row.brand, row.category);
            const showPrices = billing_type === 'self';
            const baseReg = row.regular_points ? parseFloat(row.regular_points) : null;
            const regularPts = baseReg != null ? baseReg + (ov.bonusPts || 0) : null;
            const baseRate = parseFloat(row.zoho_rate || row.base_price || 0);
            const adjRate = applyOverrideToRate(baseRate, ov.discountPct);
            // Annual = effective rate × annual_pct / 100 (matches points-engine line-total formula)
            const annualPts = (adjRate > 0 && row.annual_eligible && row.annual_pct) ? Math.round(adjRate * parseFloat(row.annual_pct) / 100 * 100) / 100 : null;
            productMap[row.id].pack_sizes.push({
                pack_size_id: row.pack_size_id,
                size: String(parseFloat(row.size) || row.size || ''),
                unit: row.unit,
                rate: showPrices ? adjRate : null,
                mrp: parseFloat(row.zoho_label_rate || row.zoho_rate || row.base_price || 0),
                zoho_item_id: row.zoho_item_id,
                stock: parseFloat(row.stock || 0),
                regular_points: regularPts,
                annual_points: annualPts,
                color_name: row.color_name || null,
                color_code: row.color_code || null,
            });
        }

        const products = Object.values(productMap);

        // Fetch active offers and attach to each product
        const filterHasOffer = hasOffer === 'true' || hasOffer === '1';
        const now = new Date();
        const [offerRows] = await pool.query(
            `SELECT * FROM painter_special_offers
             WHERE is_active = 1 AND DATE(start_date) <= DATE(?) AND DATE(end_date) >= DATE(?)
             ORDER BY created_at DESC`,
            [now, now]
        );
        const productsWithOffers = products.map(p => {
            const matched = offerRows.filter(o => {
                if (o.applies_to === 'all') return true;
                if (o.applies_to === 'brand' && o.target_id === p.brand) return true;
                if (o.applies_to === 'category' && o.target_id === p.category) return true;
                if (o.applies_to === 'product' && parseInt(o.target_id, 10) === p.id) return true;
                return false;
            });
            return { ...p, offer: matched.length > 0 ? matched[0] : null };
        });
        const finalProducts = filterHasOffer
            ? productsWithOffers.filter(p => p.offer !== null)
            : productsWithOffers;

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
            products: finalProducts,
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
router.post('/me/estimates', requirePainterAuth, idempotent('painter.estimate.create'), async (req, res) => {
    try {
        const {
            billing_type, customer_name, customer_phone, customer_address,
            items, notes, submit,
            // v3.1 cart/markup flow additions:
            pricing_mode,        // 'direct' (default) | 'request_qc_price'
            labour_charge,       // decimal, customer path only
            hide_qc_branding,    // 0/1, customer path only
        } = req.body;
        if (!billing_type || !['self', 'customer'].includes(billing_type)) {
            return res.status(400).json({ success: false, message: 'billing_type must be self or customer' });
        }
        if (billing_type === 'customer' && !customer_name) {
            return res.status(400).json({ success: false, message: 'Customer name is required for customer billing' });
        }
        if (!items || !items.length) {
            return res.status(400).json({ success: false, message: 'At least one item is required' });
        }

        const pricingMode = (billing_type === 'customer' && pricing_mode === 'request_qc_price') ? 'request_qc_price' : 'direct';
        const labourCharge = (billing_type === 'customer') ? Math.max(0, parseFloat(labour_charge) || 0) : 0;
        const hideBranding = (billing_type === 'customer' && (hide_qc_branding === 1 || hide_qc_branding === '1' || hide_qc_branding === true)) ? 1 : 0;

        // Validate items — each has pack_size_id + quantity
        const packSizeIds = items.map(i => i.pack_size_id || i.item_id);
        const [packSizeRows] = await pool.query(`
            SELECT ps.id as pack_size_id, ps.zoho_item_id, ps.size, ps.unit, ps.base_price, ps.product_id,
                   p.name as product_name, p.product_type,
                   zim.zoho_item_name, zim.zoho_brand, zim.zoho_category_name, zim.zoho_rate, zim.zoho_label_rate
            FROM pack_sizes ps
            INNER JOIN products p ON p.id = ps.product_id
            LEFT JOIN zoho_items_map zim ON zim.zoho_item_id = ps.zoho_item_id
            WHERE ps.id IN (?) AND ps.is_active = 1
        `, [packSizeIds]);

        const packSizeMap = {};
        packSizeRows.forEach(r => { packSizeMap[r.pack_size_id] = r; });

        const estimateNumber = await generateEstimateNumber();
        // Self billing always goes to pending_admin immediately — no draft state.
        // Customer-direct estimates are the painter's private marketing tool:
        // they save to "saved_direct" so they don't clog admin's approval queue.
        // After the customer confirms, painter uses /me/estimates/:id/submit-to-admin
        // to convert to pending_admin as either self or customer billing.
        const isDirectCustomer = billing_type === 'customer' && pricingMode === 'direct';
        let status;
        if (billing_type === 'self') {
            status = 'pending_admin';
        } else {
            status = submit
                ? (isDirectCustomer ? 'saved_direct' : 'pending_admin')
                : 'draft';
        }

        let subtotal = 0;
        let markupSubtotal = 0;
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

            // v3.1: per-item markup (customer+direct only). Enforce strict MRP cap.
            let markupUnitPrice = 0;
            let markupLineTotal = 0;
            if (billing_type === 'customer' && pricingMode === 'direct' && item.markup_pct != null) {
                const pct = Math.max(0, parseFloat(item.markup_pct) || 0);
                markupUnitPrice = Math.round(unitPrice * (1 + pct / 100) * 100) / 100;
                const mrp = parseFloat(psRow.zoho_label_rate || psRow.zoho_rate || 0);
                if (mrp > 0 && markupUnitPrice > mrp + 0.01) {
                    return res.status(400).json({
                        success: false,
                        message: `Markup for "${psRow.product_name} ${psRow.size}${psRow.unit}" exceeds MRP (₹${mrp.toFixed(2)}). Reduce the % or increase the MRP in Zoho.`,
                    });
                }
                markupLineTotal = Math.round(qty * markupUnitPrice * 100) / 100;
                markupSubtotal += markupLineTotal;
            }

            lineItems.push({
                zoho_item_id: psRow.zoho_item_id,
                item_name: `${psRow.product_name} ${psRow.size}${psRow.unit}`,
                brand: psRow.zoho_brand,
                category: psRow.zoho_category_name,
                quantity: qty,
                unit_price: unitPrice,
                line_total: lineTotal,
                markup_unit_price: markupUnitPrice,
                markup_line_total: markupLineTotal,
                display_order: i
            });
        }

        // Prices already include GST — store 0 for gst_amount, grandTotal = subtotal [+ markup + labour].
        // For customer+direct path, customer-facing total = markupSubtotal + labourCharge (what the
        // painter shows their end-customer). We still record cost subtotal for audit.
        const gstAmount = 0;
        const grandTotal = (billing_type === 'customer' && pricingMode === 'direct' && markupSubtotal > 0)
            ? (markupSubtotal + labourCharge)
            : subtotal;

        const [result] = await pool.query(
            `INSERT INTO painter_estimates
             (estimate_number, painter_id, billing_type, customer_name, customer_phone, customer_address,
              subtotal, gst_amount, grand_total, status, notes, created_by_painter,
              pricing_mode, labour_charge, hide_qc_branding)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [estimateNumber, req.painter.id, billing_type,
             customer_name || null, customer_phone || null, customer_address || null,
             subtotal, gstAmount, grandTotal, status, notes || null, req.painter.id,
             pricingMode, labourCharge, hideBranding]
        );

        const estimateId = result.insertId;

        // Insert line items
        for (const li of lineItems) {
            await pool.query(
                `INSERT INTO painter_estimate_items
                 (estimate_id, zoho_item_id, item_name, brand, category, quantity, unit_price, line_total,
                  markup_unit_price, markup_line_total, display_order)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [estimateId, li.zoho_item_id, li.item_name, li.brand, li.category,
                 li.quantity, li.unit_price, li.line_total,
                 li.markup_unit_price, li.markup_line_total, li.display_order]
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
            'SELECT * FROM painter_estimate_items WHERE estimate_id = ? AND deleted_at IS NULL ORDER BY display_order, id',
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

            // Soft-delete existing items (history preserved for U18 audit trail)
            await pool.query('UPDATE painter_estimate_items SET deleted_at = NOW() WHERE estimate_id = ? AND deleted_at IS NULL', [estimates[0].id]);

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

            // Zoho prices already include GST — no separate calculation needed
            const gstAmount = 0;
            const grandTotal = subtotal;
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
        const [items] = await pool.query('SELECT COUNT(*) as cnt FROM painter_estimate_items WHERE estimate_id = ? AND deleted_at IS NULL', [estimates[0].id]);
        if (items[0].cnt === 0) return res.status(400).json({ success: false, message: 'Add at least one item before submitting' });

        await pool.query("UPDATE painter_estimates SET status = 'pending_admin' WHERE id = ?", [estimates[0].id]);
        await logEstimateStatusChange(estimates[0].id, 'draft', 'pending_admin', req.painter.id, 'Painter submitted for review');
        res.json({ success: true, message: 'Estimate submitted for admin review' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to submit estimate' });
    }
});

// Painter: convert a saved_direct customer estimate to admin approval. Painter
// picks either 'self' (admin approves at painter rate, no markup kept — points
// flow as self-billing i.e. annual only) or 'customer' (admin reviews full
// markup and can approve with markup or downgrade to base-only).
router.post('/me/estimates/:estimateId/submit-to-admin', requirePainterAuth, async (req, res) => {
    try {
        const { mode } = req.body; // 'self' | 'customer'
        if (!['self', 'customer'].includes(mode)) {
            return res.status(400).json({ success: false, message: "mode must be 'self' or 'customer'" });
        }
        const [estimates] = await pool.query(
            "SELECT * FROM painter_estimates WHERE id = ? AND painter_id = ? AND status IN ('saved_direct', 'draft')",
            [req.params.estimateId, req.painter.id]
        );
        if (!estimates.length) {
            return res.status(404).json({ success: false, message: 'Estimate not found or cannot be submitted' });
        }
        const prevStatus = estimates[0].status;
        // For drafts, use existing billing_type; for saved_direct the mode param selects billing type
        const newBillingType = prevStatus === 'draft' ? estimates[0].billing_type : (mode === 'self' ? 'self' : 'customer');
        await pool.query(
            `UPDATE painter_estimates
             SET status = 'pending_admin',
                 billing_type = ?,
                 hide_qc_branding = 0
             WHERE id = ?`,
            [newBillingType, estimates[0].id]
        );
        await logEstimateStatusChange(
            estimates[0].id, prevStatus, 'pending_admin', req.painter.id,
            `Painter submitted estimate → admin review as ${newBillingType} billing`
        );
        res.json({ success: true, message: `Submitted for admin review (${newBillingType} billing)` });
    } catch (error) {
        console.error('submit-to-admin error:', error);
        res.status(500).json({ success: false, message: 'Failed to submit' });
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
router.post('/me/estimates/:estimateId/payment', requirePainterAuth, idempotent('painter.estimate.payment'), async (req, res) => {
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
            `SELECT pe.*, p.full_name as painter_name, p.phone as painter_phone, p.city as painter_city
             FROM painter_estimates pe JOIN painters p ON pe.painter_id = p.id
             WHERE pe.id = ? AND pe.painter_id = ?`,
            [req.params.estimateId, req.painter.id]
        );
        if (!estimates.length) return res.status(404).json({ success: false, message: 'Estimate not found' });
        if (estimates[0].status === 'draft') return res.status(400).json({ success: false, message: 'Cannot download draft estimate' });

        const [items] = await pool.query(
            'SELECT * FROM painter_estimate_items WHERE estimate_id = ? AND deleted_at IS NULL ORDER BY display_order, id',
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
        const { search, brand, category, hasPoints, inStock, hasOffer, page = 1, limit = 50 } = req.query;
        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
        const offset = (pageNum - 1) * limitNum;
        const filterHasOffer = hasOffer === 'true' || hasOffer === '1';

        // ---- catalog admin ordering + visibility -----------------------
        // Six LEFT JOINs (3 global + 3 painter override). Hidden filters
        // are added to WHERE via COALESCE(override, global, 0)=0. Ordering
        // is applied in the products query via MAX() over the same COALESCE.
        // TRIM both sides on string keys: seed data is TRIMMED but the raw
        // zoho_brand / zoho_category_name columns can contain trailing space.
        const painterId = (req.painter && req.painter.id) || 0;
        const catalogJoins = `
            LEFT JOIN painter_catalog_brand_order        gb ON TRIM(gb.brand) = TRIM(zim.zoho_brand)
            LEFT JOIN painter_catalog_brand_overrides    bo ON bo.painter_id = ? AND TRIM(bo.brand) = TRIM(zim.zoho_brand)
            LEFT JOIN painter_catalog_category_order     gc ON TRIM(gc.brand) = TRIM(zim.zoho_brand) AND TRIM(gc.category) = TRIM(zim.zoho_category_name)
            LEFT JOIN painter_catalog_category_overrides co ON co.painter_id = ? AND TRIM(co.brand) = TRIM(zim.zoho_brand) AND TRIM(co.category) = TRIM(zim.zoho_category_name)
            LEFT JOIN painter_catalog_product_order      gp ON gp.product_id = p.id
            LEFT JOIN painter_catalog_product_overrides  ppo ON ppo.painter_id = ? AND ppo.product_id = p.id
        `;
        const catalogJoinParams = [painterId, painterId, painterId];
        const catalogHiddenWhere = `
            AND COALESCE(bo.is_hidden,  gb.is_hidden, 0) = 0
            AND COALESCE(co.is_hidden,  gc.is_hidden, 0) = 0
            AND COALESCE(ppo.is_hidden, gp.is_hidden, 0) = 0
        `;

        const joins = `
            FROM products p
            INNER JOIN pack_sizes ps ON ps.product_id = p.id AND ps.is_active = 1
            INNER JOIN zoho_items_map zim ON zim.zoho_item_id = ps.zoho_item_id
                AND (zim.zoho_status = 'active' OR zim.zoho_status IS NULL)
            ${catalogJoins}
        `;
        let where = "WHERE p.status = 'active' " + catalogHiddenWhere;
        const params = [...catalogJoinParams];

        // Pre-fetch active offers so we can add SQL filter when hasOffer=true
        const now = new Date();
        let activeOffers = [];
        if (filterHasOffer) {
            const [offerRows] = await pool.query(`
                SELECT applies_to, target_id FROM painter_special_offers
                WHERE is_active = 1 AND DATE(start_date) <= DATE(?) AND DATE(end_date) >= DATE(?)
            `, [now, now]);
            activeOffers = offerRows;
            if (activeOffers.length > 0) {
                const hasAllOffer = activeOffers.some(o => o.applies_to === 'all');
                if (!hasAllOffer) {
                    const offerBrands = activeOffers.filter(o => o.applies_to === 'brand').map(o => o.target_id);
                    const offerCats = activeOffers.filter(o => o.applies_to === 'category').map(o => o.target_id);
                    const clauses = [];
                    if (offerBrands.length) clauses.push(`zim.zoho_brand IN (${offerBrands.map(() => '?').join(',')})`);
                    if (offerCats.length) clauses.push(`zim.zoho_category_name IN (${offerCats.map(() => '?').join(',')})`);
                    if (clauses.length) {
                        where += ` AND (${clauses.join(' OR ')})`;
                        params.push(...offerBrands, ...offerCats);
                    }
                }
                // hasAllOffer = true means all products qualify → no extra WHERE needed
            } else {
                // No active offers → return empty result
                return res.json({ success: true, products: [], total: 0, page: pageNum, limit: limitNum, hasMore: false });
            }
        }

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

        // hasPoints: only products that have painter point rates configured
        const filterHasPoints = hasPoints === 'true' || hasPoints === '1';
        // inStock: only products with stock > 0 (applied as HAVING after aggregation)
        const filterInStock = inStock === 'true' || inStock === '1';

        // Count grouped products
        let countSql = `SELECT COUNT(DISTINCT p.id) as total ${joins}`;
        if (filterHasPoints) {
            countSql += ` INNER JOIN painter_product_point_rates ppr_f
                ON ppr_f.item_id = zim.zoho_item_id COLLATE utf8mb4_unicode_ci
                AND ppr_f.regular_points_per_unit > 0`;
        }
        countSql += ` ${where}`;
        if (filterInStock) {
            // Wrap in subquery to filter by stock
            countSql = `SELECT COUNT(*) as total FROM (
                SELECT p.id
                ${joins}
                ${filterHasPoints ? `INNER JOIN painter_product_point_rates ppr_f
                    ON ppr_f.item_id = zim.zoho_item_id COLLATE utf8mb4_unicode_ci
                    AND ppr_f.regular_points_per_unit > 0` : ''}
                ${where}
                GROUP BY p.id
                HAVING (SELECT COALESCE(SUM(zls.stock_on_hand), 0) FROM zoho_location_stock zls
                    WHERE zls.zoho_item_id IN (
                        SELECT ps3.zoho_item_id FROM pack_sizes ps3
                        WHERE ps3.product_id = p.id AND ps3.is_active = 1
                    )) > 0
            ) as stock_filtered`;
        }
        const [countResult] = await pool.query(countSql, params);
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
                   MAX(TRIM(zim.zoho_brand))         as brand,
                   MAX(TRIM(zim.zoho_category_name)) as category,
                   (SELECT z2.image_url FROM pack_sizes ps2
                    INNER JOIN zoho_items_map z2 ON z2.zoho_item_id = ps2.zoho_item_id
                    WHERE ps2.product_id = p.id AND ps2.is_active = 1 AND z2.image_url IS NOT NULL
                    LIMIT 1) as image_url,
                   MAX(ppr.regular_points_per_unit) as points_per_unit,
                   MAX(ppr.annual_eligible) as annual_eligible,
                   MAX(ppr.annual_pct) as annual_pct,
                   MAX(COALESCE(bo.sort_order,  gb.sort_order, 999)) as _brand_sort,
                   MAX(COALESCE(co.sort_order,  gc.sort_order, 999)) as _cat_sort,
                   MAX(COALESCE(ppo.sort_order, gp.sort_order, 999)) as _prod_sort
            ${joins}
            ${filterHasPoints ? 'INNER' : 'LEFT'} JOIN painter_product_point_rates ppr
                ON ppr.item_id = zim.zoho_item_id COLLATE utf8mb4_unicode_ci
                ${filterHasPoints ? 'AND ppr.regular_points_per_unit > 0' : ''}
            ${where}
            GROUP BY p.id, p.name, p.product_type
            ${filterInStock ? `HAVING (SELECT COALESCE(SUM(zls.stock_on_hand), 0) FROM zoho_location_stock zls
                WHERE zls.zoho_item_id IN (
                    SELECT ps3.zoho_item_id FROM pack_sizes ps3
                    WHERE ps3.product_id = p.id AND ps3.is_active = 1
                )) > 0` : ''}
            ORDER BY _brand_sort ASC, brand ASC,
                     _cat_sort   ASC, category ASC,
                     _prod_sort  ASC, p.name ASC
            LIMIT ? OFFSET ?
        `, [...params, limitNum, offset]);

        // Active offers
        // If hasOffer filter was applied we already have activeOffers; otherwise fetch now
        const offers = activeOffers.length ? activeOffers : await pool.query(`
            SELECT * FROM painter_special_offers
            WHERE is_active = 1 AND DATE(start_date) <= DATE(?) AND DATE(end_date) >= DATE(?)
            ORDER BY created_at DESC
        `, [now, now]).then(([rows]) => rows);

        // Painter overrides (discount % / bonus regular points)
        const resolveOverride = await getPainterOverrideResolver(req.painter?.id);

        // Match offers to grouped products + apply painter overrides
        const productsWithOffers = products.map(p => {
            const matchedOffers = offers.filter(o => {
                if (o.applies_to === 'all') return true;
                if (o.applies_to === 'brand' && o.target_id === p.brand) return true;
                if (o.applies_to === 'category' && o.target_id === p.category) return true;
                return false;
            });
            const ov = resolveOverride(null, p.brand, p.category);
            const baseReg = p.points_per_unit ? parseFloat(p.points_per_unit) : null;
            return {
                ...p,
                min_rate: applyOverrideToRate(parseFloat(p.min_rate || 0), ov.discountPct),
                max_rate: applyOverrideToRate(parseFloat(p.max_rate || 0), ov.discountPct),
                total_stock: parseFloat(p.total_stock || 0),
                points_per_unit: baseReg != null ? baseReg + (ov.bonusPts || 0) : null,
                offer: matchedOffers.length > 0 ? matchedOffers[0] : null,
                pack_sizes: [],
            };
        });

        // Fetch pack_sizes per product so catalog cards can render inline variant chips
        const productIds = productsWithOffers.map(p => p.product_id);
        if (productIds.length) {
            const [variants] = await pool.query(`
                SELECT ps.product_id, ps.id AS pack_size_id, ps.size, ps.unit,
                       ps.zoho_item_id, ps.color_name, ps.color_code,
                       CAST(zim.zoho_rate AS DECIMAL(10,2)) AS rate,
                       CAST(zim.zoho_label_rate AS DECIMAL(10,2)) AS mrp,
                       COALESCE((SELECT SUM(zls.stock_on_hand) FROM zoho_location_stock zls
                                 WHERE zls.zoho_item_id = zim.zoho_item_id), 0) AS stock,
                       ppr.regular_points_per_unit AS regular_points,
                       ppr.annual_eligible, ppr.annual_pct
                FROM pack_sizes ps
                INNER JOIN zoho_items_map zim ON zim.zoho_item_id = ps.zoho_item_id
                LEFT JOIN painter_product_point_rates ppr
                    ON ppr.item_id = zim.zoho_item_id COLLATE utf8mb4_unicode_ci
                WHERE ps.product_id IN (?) AND ps.is_active = 1
                ORDER BY ps.product_id, CAST(ps.size AS DECIMAL(10,2))
            `, [productIds]);
            // Build product-id -> {brand, category} lookup for per-variant override resolution
            const prodMeta = {};
            for (const p of productsWithOffers) {
                prodMeta[p.product_id] = { brand: p.brand, category: p.category };
            }

            const bySize = {};
            for (const v of variants) {
                if (!bySize[v.product_id]) bySize[v.product_id] = [];
                const meta = prodMeta[v.product_id] || {};
                const ov = resolveOverride(v.zoho_item_id, meta.brand, meta.category);
                const baseReg = v.regular_points ? parseFloat(v.regular_points) : null;
                const reg = baseReg != null ? baseReg + (ov.bonusPts || 0) : null;
                const rate = applyOverrideToRate(parseFloat(v.rate || 0), ov.discountPct);
                // Annual = rate × annual_pct / 100 (per unit)
                const annualPts = (rate > 0 && v.annual_eligible && v.annual_pct)
                    ? Math.round(rate * parseFloat(v.annual_pct) / 100 * 100) / 100
                    : null;
                bySize[v.product_id].push({
                    pack_size_id: v.pack_size_id,
                    size: String(parseFloat(v.size) || v.size || ''),
                    unit: v.unit,
                    zoho_item_id: v.zoho_item_id,
                    rate,
                    mrp: parseFloat(v.mrp || v.rate || 0),
                    stock: parseFloat(v.stock || 0),
                    regular_points: reg,
                    annual_points: annualPts,
                    color_name: v.color_name || null,
                    color_code: v.color_code || null,
                });
            }
            for (const p of productsWithOffers) {
                p.pack_sizes = bySize[p.product_id] || [];
            }
        }

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
                   ps.id as pack_size_id,
                   ps.size as pack_size, ps.unit as pack_unit,
                   ps.color_name, ps.color_code,
                   zim.zoho_brand as brand, zim.zoho_category_name as category,
                   zim.zoho_rate as rate, zim.zoho_label_rate as mrp,
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
            ORDER BY CAST(ps.size AS DECIMAL(10,2)) ASC
        `, [productId]);

        if (!variants.length) {
            return res.status(404).json({ success: false, message: 'No variants found' });
        }

        const brand = variants[0].brand;
        const category = variants[0].category;
        const image_url = variants.find(v => v.image_url)?.image_url || null;

        // Painter overrides
        const resolveOverride = await getPainterOverrideResolver(req.painter?.id);

        const adjustedVariants = variants.map(v => {
            const ov = resolveOverride(v.item_id, brand, category);
            const baseReg = v.points_per_unit ? parseFloat(v.points_per_unit) : 0;
            const regularPts = baseReg + (ov.bonusPts || 0);
            const rate = applyOverrideToRate(parseFloat(v.rate || 0), ov.discountPct);
            // Annual = rate × annual_pct / 100 (per unit)
            const annualPts = (rate > 0 && v.annual_eligible && v.annual_pct)
                ? Math.round(rate * parseFloat(v.annual_pct) / 100 * 100) / 100
                : 0;
            return {
                id: v.item_id,
                pack_size_id: v.pack_size_id,
                size: String(parseFloat(v.pack_size) || v.pack_size || ''),
                unit: v.pack_unit || '',
                rate,
                mrp: parseFloat(v.mrp || v.rate || 0),
                stock: parseFloat(v.stock || 0),
                regular_points: regularPts,
                annual_points: annualPts,
                image_url: v.image_url || null,
                color_name: v.color_name || null,
                color_code: v.color_code || null,
            };
        });

        const product = {
            product_id: prod.id,
            name: prod.name,
            product_type: prod.product_type,
            brand,
            category,
            image_url,
            variant_count: adjustedVariants.length,
            min_rate: Math.min(...adjustedVariants.map(v => v.rate)),
            max_rate: Math.max(...adjustedVariants.map(v => v.rate)),
            total_stock: adjustedVariants.reduce((s, v) => s + v.stock, 0),
            variants: adjustedVariants
        };

        // Matching offers
        const now = new Date();
        const [offers] = await pool.query(`
            SELECT * FROM painter_special_offers
            WHERE is_active = 1 AND DATE(start_date) <= DATE(?) AND DATE(end_date) >= DATE(?)
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
            WHERE is_active = 1 AND DATE(start_date) <= DATE(?) AND DATE(end_date) >= DATE(?)
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
            WHERE is_active = 1 AND DATE(start_date) <= DATE(?) AND DATE(end_date) >= DATE(?)
            ORDER BY created_at DESC
        `, [now, now]);

        if (!offers.length) {
            return res.json({ success: true, brands: [], products: [], offers: [] });
        }

        // Build product filter based on offer targets.
        // An 'all' offer covers every active product → no extra WHERE needed.
        // Otherwise restrict to brands / categories / specific products named by the
        // active offers. 'product' target_id is a products.id (int).
        let extraWhere = '';
        const extraParams = [];
        const hasAllOffer = offers.some(o => o.applies_to === 'all');
        const brandOffers = offers.filter(o => o.applies_to === 'brand' && o.target_id);
        const categoryOffers = offers.filter(o => o.applies_to === 'category' && o.target_id);
        const productOffers = offers.filter(o => o.applies_to === 'product' && o.target_id);

        if (!hasAllOffer && (brandOffers.length || categoryOffers.length || productOffers.length)) {
            const conditions = [];
            if (brandOffers.length) {
                const ids = brandOffers.map(o => o.target_id);
                conditions.push(`zim.zoho_brand IN (${ids.map(() => '?').join(',')})`);
                extraParams.push(...ids);
            }
            if (categoryOffers.length) {
                const ids = categoryOffers.map(o => o.target_id);
                conditions.push(`zim.zoho_category_name IN (${ids.map(() => '?').join(',')})`);
                extraParams.push(...ids);
            }
            if (productOffers.length) {
                const ids = productOffers.map(o => parseInt(o.target_id, 10)).filter(n => !isNaN(n));
                if (ids.length) {
                    conditions.push(`p.id IN (${ids.map(() => '?').join(',')})`);
                    extraParams.push(...ids);
                }
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
                   MAX(ppr.regular_points_per_unit) as points_per_unit,
                   (SELECT CAST(zim3.zoho_label_rate AS DECIMAL(10,2))
                    FROM pack_sizes ps3
                    INNER JOIN zoho_items_map zim3 ON zim3.zoho_item_id = ps3.zoho_item_id
                    LEFT JOIN painter_product_point_rates ppr3
                        ON ppr3.item_id = zim3.zoho_item_id COLLATE utf8mb4_unicode_ci
                    WHERE ps3.product_id = p.id AND ps3.is_active = 1
                    ORDER BY ppr3.regular_points_per_unit DESC, zim3.zoho_label_rate DESC
                    LIMIT 1) as mrp,
                   (SELECT CAST(zim4.zoho_rate AS DECIMAL(10,2)) * COALESCE(ppr4.annual_pct, 0) / 100
                    FROM pack_sizes ps4
                    INNER JOIN zoho_items_map zim4 ON zim4.zoho_item_id = ps4.zoho_item_id
                    INNER JOIN painter_product_point_rates ppr4
                        ON ppr4.item_id = zim4.zoho_item_id COLLATE utf8mb4_unicode_ci
                    WHERE ps4.product_id = p.id AND ps4.is_active = 1
                        AND ppr4.annual_eligible = 1 AND ppr4.annual_pct > 0
                    ORDER BY CAST(ps4.size AS DECIMAL(10,2)) DESC
                    LIMIT 1) as annual_points,
                   (SELECT CAST(zim5.zoho_rate AS DECIMAL(10,2)) FROM pack_sizes ps5
                    INNER JOIN zoho_items_map zim5 ON zim5.zoho_item_id = ps5.zoho_item_id
                    WHERE ps5.product_id = p.id AND ps5.is_active = 1
                    ORDER BY CAST(ps5.size AS DECIMAL(10,2)) DESC LIMIT 1) as max_variant_rate,
                   (SELECT CONCAT(ps6.size, ' ', COALESCE(ps6.unit, '')) FROM pack_sizes ps6
                    WHERE ps6.product_id = p.id AND ps6.is_active = 1
                    ORDER BY CAST(ps6.size AS DECIMAL(10,2)) DESC LIMIT 1) as max_variant_size
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

        // Unique brands, ordered by admin-configured list (fallback alphabetical for unknowns)
        const uniqueBrands = [...new Set(products.map(p => p.brand).filter(Boolean))];
        let brands = uniqueBrands.sort();
        try {
            const [[cfg]] = await pool.query(
                "SELECT config_value FROM ai_config WHERE config_key = 'painter_offer_brand_order'"
            );
            if (cfg?.config_value) {
                const ordered = JSON.parse(cfg.config_value);
                if (Array.isArray(ordered)) {
                    const setOrdered = new Set(ordered);
                    const inOrder = ordered.filter(b => uniqueBrands.includes(b));
                    const rest = uniqueBrands.filter(b => !setOrdered.has(b)).sort();
                    brands = [...inOrder, ...rest];
                }
            }
        } catch (_) { /* ignore parse errors, keep alphabetical */ }

        // Apply painter-specific overrides (discount % on rate, bonus on regular points)
        const resolveOverride = await getPainterOverrideResolver(req.painter?.id);

        res.json({
            success: true,
            brands,
            products: products.map(p => {
                const ov = resolveOverride(null, p.brand, p.category);
                const baseRegular = p.points_per_unit ? parseFloat(p.points_per_unit) : 0;
                const adjustedRegular = baseRegular + (ov.bonusPts || 0);
                const rawMaxRate = p.max_variant_rate ? parseFloat(p.max_variant_rate) : 0;
                const maxVRate = rawMaxRate ? applyOverrideToRate(rawMaxRate, ov.discountPct) : null;
                // Annual scales linearly with rate (formula = rate × annual_pct / 100).
                // SQL returned raw annual (base rate × annual_pct/100). After discount, scale by rate ratio.
                const rawAnnual = p.annual_points ? parseFloat(p.annual_points) : 0;
                const adjustedAnnual = rawMaxRate > 0 && maxVRate
                    ? Math.round(rawAnnual * (maxVRate / rawMaxRate) * 100) / 100
                    : rawAnnual;
                const minRate = p.min_rate ? applyOverrideToRate(p.min_rate, ov.discountPct) : null;
                const maxRate = p.max_rate ? applyOverrideToRate(p.max_rate, ov.discountPct) : null;
                return {
                    ...p,
                    min_rate: minRate,
                    max_rate: maxRate,
                    points_per_unit: adjustedRegular > 0 ? adjustedRegular : null,
                    mrp: p.mrp ? parseFloat(p.mrp) : null,
                    annual_points: adjustedAnnual > 0 ? adjustedAnnual : null,
                    max_variant_rate: maxVRate,
                    max_variant_size: p.max_variant_size ? String(p.max_variant_size).trim() : null,
                    // Per-unit self-bill total = annual + offer. Customer-bill total = regular + annual + offer.
                    // We return the components; client computes both totals.
                    max_variant_regular: adjustedRegular > 0 ? adjustedRegular : null,
                    max_variant_annual: adjustedAnnual > 0 ? adjustedAnnual : null
                };
            }),
            offers: offers.map(o => ({
                id: o.id,
                title: o.title,
                offer_type: o.offer_type,
                bonus_points: o.bonus_points ? parseFloat(o.bonus_points) : null,
                multiplier_value: o.multiplier_value ? parseFloat(o.multiplier_value) : null,
                applies_to: o.applies_to,
                target_id: o.target_id,
                banner_image_url: o.banner_image_url || null
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

        res.json({ success: true, training: content, content, categories });
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
            (painter_id, event_type, branch_id, check_in_at, check_in_photo_url, latitude, longitude, distance_from_shop, points_awarded)
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
                   branch_id, distance_from_shop as distance_meters
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
// PAINTER SELFIE-ATTENDANCE V2 ENDPOINTS (new system)
// ═══════════════════════════════════════════════════════════════

router.get('/me/attendance/branches-nearby', requirePainterAuth, async (req, res) => {
    try {
        const lat = parseFloat(req.query.lat);
        const lng = parseFloat(req.query.lng);
        if (!isFinite(lat) || !isFinite(lng)) {
            return res.status(400).json({ error: 'lat and lng required' });
        }
        const radius = Math.min(parseFloat(req.query.radius) || 1000, 50000);
        const branches = await attendanceService.findNearbyBranches(lat, lng, radius);
        res.json({ branches });
    } catch (err) {
        console.error('nearby branches error:', err);
        res.status(500).json({ error: 'Failed to load branches' });
    }
});

router.post('/me/attendance/checkin', requirePainterAuth, uploadPainterAttendance.single('selfie'), async (req, res) => {
    const painterId = req.painter.id;
    const branchId = parseInt(req.body.branch_id, 10);
    const lat = parseFloat(req.body.latitude);
    const lng = parseFloat(req.body.longitude);

    try {
        if (!req.file) return res.status(400).json({ code: 'SELFIE_REQUIRED', error: 'Selfie image required' });
        if (!isFinite(lat) || !isFinite(lng) || !branchId) {
            return res.status(400).json({ error: 'branch_id, latitude, longitude required' });
        }

        const cfg = await attendanceService.loadConfig();
        if (!cfg.enabled) return res.status(503).json({ error: 'Attendance temporarily disabled' });

        const [branchRows] = await pool.query(
            "SELECT id, name, latitude, longitude FROM branches WHERE id=? AND status='active'",
            [branchId]
        );
        if (branchRows.length === 0) return res.status(400).json({ code: 'BRANCH_INACTIVE', error: 'Branch not found or inactive' });
        const branch = branchRows[0];
        if (branch.latitude == null || branch.longitude == null) {
            return res.status(400).json({ code: 'BRANCH_NO_GPS', error: 'Branch has no GPS set' });
        }

        const distance = attendanceService.haversineMeters(lat, lng, Number(branch.latitude), Number(branch.longitude));
        if (distance > cfg.geofenceMeters) {
            const nearby = await attendanceService.findNearbyBranches(lat, lng, 5000);
            const closest = nearby[0] || null;
            return res.status(400).json({
                code: 'OUTSIDE_GEOFENCE',
                distance_meters: distance,
                max_meters: cfg.geofenceMeters,
                closest_branch: closest ? { id: closest.branch_id, name: closest.name, distance_meters: closest.distance_meters } : null,
                error: `You are ${distance}m from ${branch.name}. Must be within ${cfg.geofenceMeters}m.`
            });
        }

        const pad = n => String(n).padStart(2, '0');
        const today = new Date();
        const dateStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
        const [dup] = await pool.query(
            "SELECT id, checkin_at, branch_id FROM painter_attendance_checkins WHERE painter_id=? AND checkin_date=?",
            [painterId, dateStr]
        );
        if (dup.length > 0) {
            return res.status(409).json({
                code: 'ALREADY_CHECKED_IN',
                existing_checkin: dup[0],
                error: 'Already checked in today'
            });
        }

        const selfiePath = req.file.path.replace(/\\/g, '/').replace(/^public\//, '/');
        const result = await attendanceService.recordCheckin({
            painterId, branchId, lat, lng, selfiePath,
            distanceMeters: distance, pointsPerDay: cfg.pointsPerDay
        });

        try {
            const painterNotif = require('../../services/painter-notification-service');
            await painterNotif.sendToPainter(painterId, {
                type: 'attendance_checkin_confirmed',
                title: `✓ Check-in confirmed at ${branch.name}`,
                title_ta: `✓ ${branch.name}-ல் சரிபார்ப்பு வெற்றி`,
                body: `${cfg.pointsPerDay} AP earned for today.`,
                body_ta: `இன்று ${cfg.pointsPerDay} AP சேர்க்கப்பட்டது.`,
                data: { screen: 'attendance', checkin_id: String(result.checkinId) }
            });
        } catch (e) { console.warn('notif failed:', e.message); }

        res.json({
            checkin_id: result.checkinId,
            ap_earned: cfg.pointsPerDay,
            month_key: result.monthKey
        });
    } catch (err) {
        console.error('checkin error:', err);
        res.status(500).json({ error: 'Check-in failed', detail: err.message });
    }
});

router.get('/me/attendance/month', requirePainterAuth, async (req, res) => {
    try {
        const painterId = req.painter.id;
        const monthKey = req.query.month || (() => {
            const d = new Date();
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        })();

        const cfg = await attendanceService.loadConfig();

        const [checkins] = await pool.query(
            `SELECT id, branch_id, checkin_date, checkin_at, distance_meters, selfie_path, status, points_awarded
             FROM painter_attendance_checkins
             WHERE painter_id=? AND month_key=? ORDER BY checkin_date`,
            [painterId, monthKey]
        );
        const [monthlyRows] = await pool.query(
            'SELECT * FROM painter_attendance_monthly WHERE painter_id=? AND month_key=?',
            [painterId, monthKey]
        );
        const monthly = monthlyRows[0] || null;

        const [billingRows] = await pool.query(
            `SELECT COALESCE(SUM(total),0) AS billed
             FROM painter_estimates
             WHERE painter_id=? AND billing_type='customer'
               AND status IN ('pushed_to_zoho','payment_recorded')
               AND DATE_FORMAT(created_at, '%Y-%m')=?`,
            [painterId, monthKey]
        );
        const billed = Number(billingRows[0].billed);
        const claimPctPreview = attendanceService.computeClaimPct(billed, cfg);
        const totalAp = monthly ? monthly.total_ap_earned : checkins.filter(c => c.status === 'approved').length * cfg.pointsPerDay;
        const claimablePreview = attendanceService.computeClaimableAp(totalAp, claimPctPreview);

        res.json({
            month_key: monthKey,
            checkins,
            total_checkins: checkins.filter(c => c.status === 'approved').length,
            total_ap_earned: totalAp,
            monthly_customer_billed_preview: billed,
            claim_pct_preview: claimPctPreview,
            claimable_ap_preview: claimablePreview,
            claim_status: monthly ? monthly.claim_status : 'pending',
            ap_claimed: monthly ? monthly.ap_claimed : 0,
            claim_window: monthly && monthly.claim_window_opens_at ? {
                opens_at: monthly.claim_window_opens_at,
                closes_at: monthly.claim_window_closes_at
            } : null
        });
    } catch (err) {
        console.error('month summary error:', err);
        res.status(500).json({ error: 'Failed to load month summary' });
    }
});

router.get('/me/attendance/history', requirePainterAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT month_key, total_checkins, total_ap_earned, monthly_customer_billed,
                    claim_pct, claimable_ap, ap_claimed, claim_status, claimed_at, forfeited_at
             FROM painter_attendance_monthly
             WHERE painter_id=?
             ORDER BY month_key DESC
             LIMIT 12`,
            [req.painter.id]
        );
        res.json({ history: rows });
    } catch (err) {
        console.error('history error:', err);
        res.status(500).json({ error: 'Failed to load history' });
    }
});

router.post('/me/attendance/claim', requirePainterAuth, async (req, res) => {
    try {
        const monthKey = req.body.month_key;
        if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) {
            return res.status(400).json({ error: 'month_key required (YYYY-MM)' });
        }
        const result = await attendanceService.claimMonth(req.painter.id, monthKey);

        try {
            const painterNotif = require('../../services/painter-notification-service');
            await painterNotif.sendToPainter(req.painter.id, {
                type: 'attendance_claimed_success',
                title: `✓ Claimed ${result.claimed_ap} AP`,
                title_ta: `✓ ${result.claimed_ap} AP கிளைம் ஆகிவிட்டது`,
                body: `${result.claimed_ap} AP added to your Regular points.`,
                body_ta: `${result.claimed_ap} AP உங்கள் Regular புள்ளிகளில் சேர்க்கப்பட்டது.`,
                data: { screen: 'points' }
            });
        } catch (e) { /* push notification failure; non-fatal */ }

        res.json(result);
    } catch (err) {
        if (err.status) return res.status(err.status).json({ code: err.code, error: err.message });
        console.error('claim error:', err);
        res.status(500).json({ error: 'Claim failed' });
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
// QUOTATIONS CRUD (painter self)
// ═══════════════════════════════════════════════════════════════

// Create quotation
router.post('/me/quotations', requirePainterAuth, async (req, res) => {
    try {
        const {
            quotation_type, customer_name, customer_phone, customer_address,
            rooms_data, labour_rate, labour_rate_type, material_cost_per_sqft,
            total_sqft, labour_total, material_total, grand_total,
            terms_conditions, validity_days, language, items
        } = req.body;

        if (!customer_name) return res.status(400).json({ success: false, message: 'Customer name is required' });

        // Auto-generate quotation number: QT-YYYY-NNNN
        const year = new Date().getFullYear();
        const [countRows] = await pool.query('SELECT COUNT(*) as cnt FROM painter_quotations WHERE painter_id = ?', [req.painter.id]);
        const seq = (countRows[0].cnt + 1).toString().padStart(4, '0');
        const quotation_number = `QT-${year}-${seq}`;

        const [result] = await pool.query(
            `INSERT INTO painter_quotations (painter_id, quotation_number, quotation_type, customer_name, customer_phone, customer_address,
             rooms_data, labour_rate, labour_rate_type, material_cost_per_sqft, total_sqft, labour_total, material_total, grand_total,
             terms_conditions, validity_days, language, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', NOW())`,
            [req.painter.id, quotation_number, quotation_type || 'room_based', customer_name, customer_phone || null, customer_address || null,
             rooms_data ? JSON.stringify(rooms_data) : null, labour_rate || 0, labour_rate_type || 'per_sqft', material_cost_per_sqft || 0,
             total_sqft || 0, labour_total || 0, material_total || 0, grand_total || 0,
             terms_conditions || null, validity_days || 15, language || 'en']
        );

        const quotationId = result.insertId;

        // Insert items if provided (itemized type)
        if (items && Array.isArray(items) && items.length > 0) {
            const itemValues = items.map(item => [
                quotationId, item.description || '', item.area_sqft || 0, item.rate || 0,
                item.amount || 0, item.paint_type || null, item.coats || 1, item.note || null
            ]);
            await pool.query(
                `INSERT INTO painter_quotation_items (quotation_id, description, area_sqft, rate, amount, paint_type, coats, note)
                 VALUES ?`,
                [itemValues]
            );
        }

        res.json({ success: true, message: 'Quotation created', quotation_id: quotationId, quotation_number });
    } catch (error) {
        console.error('Create quotation error:', error);
        res.status(500).json({ success: false, message: 'Failed to create quotation' });
    }
});

// List quotations
router.get('/me/quotations', requirePainterAuth, async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;
        const pg = Number(page);
        const lim = Number(limit);
        let query = 'SELECT q.*, (SELECT COUNT(*) FROM painter_quotation_items WHERE quotation_id = q.id) as item_count FROM painter_quotations q WHERE q.painter_id = ?';
        const params = [req.painter.id];

        if (status) { query += ' AND q.status = ?'; params.push(status); }

        const countQuery = `SELECT COUNT(*) as total FROM painter_quotations WHERE painter_id = ?${status ? ' AND status = ?' : ''}`;
        const countParams = status ? [req.painter.id, status] : [req.painter.id];
        const [countResult] = await pool.query(countQuery, countParams);
        const total = countResult[0].total;

        query += ' ORDER BY q.created_at DESC LIMIT ? OFFSET ?';
        params.push(lim, (pg - 1) * lim);

        const [quotations] = await pool.query(query, params);
        res.json({ success: true, quotations, total, page: pg, pages: Math.ceil(total / lim) });
    } catch (error) {
        console.error('List quotations error:', error);
        res.status(500).json({ success: false, message: 'Failed to list quotations' });
    }
});

// Get quotation detail with items
router.get('/me/quotations/:id', requirePainterAuth, async (req, res) => {
    try {
        const [quotations] = await pool.query('SELECT * FROM painter_quotations WHERE id = ? AND painter_id = ?', [req.params.id, req.painter.id]);
        if (!quotations.length) return res.status(404).json({ success: false, message: 'Quotation not found' });

        const [items] = await pool.query('SELECT * FROM painter_quotation_items WHERE quotation_id = ? ORDER BY id', [req.params.id]);
        const quotation = quotations[0];
        if (quotation.rooms_data && typeof quotation.rooms_data === 'string') {
            try { quotation.rooms_data = JSON.parse(quotation.rooms_data); } catch (e) { /* malformed JSON stored; skip */ }
        }

        res.json({ success: true, quotation, items });
    } catch (error) {
        console.error('Get quotation error:', error);
        res.status(500).json({ success: false, message: 'Failed to get quotation' });
    }
});

// Update quotation (only if draft)
router.put('/me/quotations/:id', requirePainterAuth, async (req, res) => {
    try {
        const [existing] = await pool.query('SELECT id, status FROM painter_quotations WHERE id = ? AND painter_id = ?', [req.params.id, req.painter.id]);
        if (!existing.length) return res.status(404).json({ success: false, message: 'Quotation not found' });
        if (existing[0].status !== 'draft') return res.status(400).json({ success: false, message: 'Can only edit draft quotations' });

        const {
            quotation_type, customer_name, customer_phone, customer_address,
            rooms_data, labour_rate, labour_rate_type, material_cost_per_sqft,
            total_sqft, labour_total, material_total, grand_total,
            terms_conditions, validity_days, language, items
        } = req.body;

        await pool.query(
            `UPDATE painter_quotations SET quotation_type = COALESCE(?, quotation_type), customer_name = COALESCE(?, customer_name),
             customer_phone = COALESCE(?, customer_phone), customer_address = COALESCE(?, customer_address),
             rooms_data = COALESCE(?, rooms_data), labour_rate = COALESCE(?, labour_rate), labour_rate_type = COALESCE(?, labour_rate_type),
             material_cost_per_sqft = COALESCE(?, material_cost_per_sqft), total_sqft = COALESCE(?, total_sqft),
             labour_total = COALESCE(?, labour_total), material_total = COALESCE(?, material_total), grand_total = COALESCE(?, grand_total),
             terms_conditions = COALESCE(?, terms_conditions), validity_days = COALESCE(?, validity_days), language = COALESCE(?, language),
             updated_at = NOW() WHERE id = ?`,
            [quotation_type, customer_name, customer_phone, customer_address,
             rooms_data ? JSON.stringify(rooms_data) : null, labour_rate, labour_rate_type,
             material_cost_per_sqft, total_sqft, labour_total, material_total, grand_total,
             terms_conditions, validity_days, language, req.params.id]
        );

        // Replace items if provided
        if (items && Array.isArray(items)) {
            await pool.query('DELETE FROM painter_quotation_items WHERE quotation_id = ?', [req.params.id]);
            if (items.length > 0) {
                const itemValues = items.map(item => [
                    req.params.id, item.description || '', item.area_sqft || 0, item.rate || 0,
                    item.amount || 0, item.paint_type || null, item.coats || 1, item.note || null
                ]);
                await pool.query(
                    `INSERT INTO painter_quotation_items (quotation_id, description, area_sqft, rate, amount, paint_type, coats, note)
                     VALUES ?`,
                    [itemValues]
                );
            }
        }

        res.json({ success: true, message: 'Quotation updated' });
    } catch (error) {
        console.error('Update quotation error:', error);
        res.status(500).json({ success: false, message: 'Failed to update quotation' });
    }
});

// Delete quotation (only if draft)
router.delete('/me/quotations/:id', requirePainterAuth, async (req, res) => {
    try {
        const [existing] = await pool.query('SELECT id, status FROM painter_quotations WHERE id = ? AND painter_id = ?', [req.params.id, req.painter.id]);
        if (!existing.length) return res.status(404).json({ success: false, message: 'Quotation not found' });
        if (existing[0].status !== 'draft') return res.status(400).json({ success: false, message: 'Can only delete draft quotations' });

        await pool.query('DELETE FROM painter_quotation_items WHERE quotation_id = ?', [req.params.id]);
        await pool.query('DELETE FROM painter_quotations WHERE id = ?', [req.params.id]);

        res.json({ success: true, message: 'Quotation deleted' });
    } catch (error) {
        console.error('Delete quotation error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete quotation' });
    }
});

// Send quotation (draft -> sent)
router.put('/me/quotations/:id/send', requirePainterAuth, async (req, res) => {
    try {
        const [existing] = await pool.query('SELECT id, status FROM painter_quotations WHERE id = ? AND painter_id = ?', [req.params.id, req.painter.id]);
        if (!existing.length) return res.status(404).json({ success: false, message: 'Quotation not found' });
        if (existing[0].status !== 'draft') return res.status(400).json({ success: false, message: 'Can only send draft quotations' });

        await pool.query('UPDATE painter_quotations SET status = ?, sent_at = NOW(), updated_at = NOW() WHERE id = ?', ['sent', req.params.id]);
        res.json({ success: true, message: 'Quotation sent' });
    } catch (error) {
        console.error('Send quotation error:', error);
        res.status(500).json({ success: false, message: 'Failed to send quotation' });
    }
});

// ═══════════════════════════════════════════════════════════════
// PRICE MATCH REPORTS (painter self)
// ═══════════════════════════════════════════════════════════════

// Submit price report
router.post('/me/price-reports', requirePainterAuth, uploadProfile.single('proof_photo'), async (req, res) => {
    try {
        const { zoho_item_id, product_name, our_price, reported_price, shop_name, shop_location, note } = req.body;

        if (!product_name || !reported_price) {
            return res.status(400).json({ success: false, message: 'Product name and reported price are required' });
        }

        let proof_photo_url = null;
        if (req.file) {
            const filename = `price-report-${req.painter.id}-${Date.now()}.jpg`;
            const outputPath = `public/uploads/profiles/${filename}`;
            await sharp(req.file.buffer)
                .resize(800, 800, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 85 })
                .toFile(outputPath);
            proof_photo_url = `/uploads/profiles/${filename}`;
        }

        const [result] = await pool.query(
            `INSERT INTO painter_price_reports (painter_id, zoho_item_id, product_name, our_price, reported_price,
             shop_name, shop_location, proof_photo_url, note, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NOW())`,
            [req.painter.id, zoho_item_id || null, product_name, our_price || 0, reported_price,
             shop_name || null, shop_location || null, proof_photo_url, note || null]
        );

        // Notify admins about price report
        try {
            const [admins] = await pool.query("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
            for (const admin of admins) {
                await notificationService.send(admin.id, {
                    type: 'painter_price_report',
                    title: 'New Price Report',
                    body: `${req.painter.name} reported price for ${product_name}: ₹${reported_price} (ours: ₹${our_price || 'N/A'})`,
                    data: { page: 'painters', tab: 'price-reports' }
                });
            }
        } catch (nErr) { console.error('Price report notification error:', nErr.message); }

        res.json({ success: true, message: 'Price report submitted', id: result.insertId });
    } catch (error) {
        console.error('Submit price report error:', error);
        res.status(500).json({ success: false, message: 'Failed to submit price report' });
    }
});

// List my price reports
router.get('/me/price-reports', requirePainterAuth, async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;
        const pg = Number(page);
        const lim = Number(limit);
        let query = 'SELECT * FROM painter_price_reports WHERE painter_id = ?';
        const params = [req.painter.id];

        if (status) { query += ' AND status = ?'; params.push(status); }

        const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
        const [countResult] = await pool.query(countQuery, params);
        const total = countResult[0].total;

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(lim, (pg - 1) * lim);

        const [reports] = await pool.query(query, params);
        res.json({ success: true, reports, total, page: pg, pages: Math.ceil(total / lim) });
    } catch (error) {
        console.error('List price reports error:', error);
        res.status(500).json({ success: false, message: 'Failed to list price reports' });
    }
});

// ═══════════════════════════════════════════════════════════════
// PRODUCT REQUESTS (painter self)
// ═══════════════════════════════════════════════════════════════

// Request new product
router.post('/me/product-requests', requirePainterAuth, async (req, res) => {
    try {
        const { product_name, brand, size_needed, note } = req.body;

        if (!product_name) return res.status(400).json({ success: false, message: 'Product name is required' });

        const [result] = await pool.query(
            `INSERT INTO painter_product_requests (painter_id, product_name, brand, size_needed, note, status, created_at)
             VALUES (?, ?, ?, ?, ?, 'pending', NOW())`,
            [req.painter.id, product_name, brand || null, size_needed || null, note || null]
        );

        res.json({ success: true, message: 'Product request submitted', id: result.insertId });
    } catch (error) {
        console.error('Submit product request error:', error);
        res.status(500).json({ success: false, message: 'Failed to submit product request' });
    }
});

// List my product requests
router.get('/me/product-requests', requirePainterAuth, async (req, res) => {
    try {
        const { status, page = 1, limit = 20 } = req.query;
        const pg = Number(page);
        const lim = Number(limit);
        let query = 'SELECT * FROM painter_product_requests WHERE painter_id = ?';
        const params = [req.painter.id];

        if (status) { query += ' AND status = ?'; params.push(status); }

        const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
        const [countResult] = await pool.query(countQuery, params);
        const total = countResult[0].total;

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(lim, (pg - 1) * lim);

        const [requests] = await pool.query(query, params);
        res.json({ success: true, requests, total, page: pg, pages: Math.ceil(total / lim) });
    } catch (error) {
        console.error('List product requests error:', error);
        res.status(500).json({ success: false, message: 'Failed to list product requests' });
    }
});

// ═══════════════════════════════════════════════════════════════
// GAMIFICATION (painter self)
// ═══════════════════════════════════════════════════════════════

// Get level, badges, active challenges with progress
router.get('/me/gamification', requirePainterAuth, async (req, res) => {
    try {
        // Get painter's lifetime points for level calculation
        const [painter] = await pool.query('SELECT total_lifetime_points FROM painters WHERE id = ?', [req.painter.id]);
        const lifetimePoints = painter.length ? (painter[0].total_lifetime_points || 0) : 0;

        let level = 'bronze';
        if (lifetimePoints >= 10000) level = 'diamond';
        else if (lifetimePoints >= 5000) level = 'gold';
        else if (lifetimePoints >= 3000) level = 'silver';

        const levelThresholds = { bronze: 0, silver: 3000, gold: 5000, diamond: 10000 };
        const nextLevel = level === 'diamond' ? null : { bronze: 'silver', silver: 'gold', gold: 'diamond' }[level];
        const nextThreshold = nextLevel ? levelThresholds[nextLevel] : null;

        // Get earned badges
        const [badges] = await pool.query(
            `SELECT b.*, eb.earned_at FROM painter_earned_badges eb
             JOIN painter_badges b ON eb.badge_id = b.id
             WHERE eb.painter_id = ? ORDER BY eb.earned_at DESC`,
            [req.painter.id]
        );

        // Get active challenges with progress
        const [challenges] = await pool.query(
            `SELECT c.*, cp.current_value, cp.completed, cp.claimed, cp.claimed_at
             FROM painter_challenges c
             LEFT JOIN painter_challenge_progress cp ON cp.challenge_id = c.id AND cp.painter_id = ?
             WHERE c.is_active = 1 AND c.end_date >= CURDATE()
             ORDER BY c.end_date ASC`,
            [req.painter.id]
        );

        res.json({
            success: true,
            level,
            lifetime_points: lifetimePoints,
            next_level: nextLevel,
            next_threshold: nextThreshold,
            badges,
            challenges: challenges.map(c => ({
                ...c,
                current_value: c.current_value || 0,
                completed: c.completed || 0,
                claimed: c.claimed || 0,
                progress_pct: c.target_value > 0 ? Math.min(100, Math.round(((c.current_value || 0) / c.target_value) * 100)) : 0
            }))
        });
    } catch (error) {
        console.error('Get gamification error:', error);
        res.status(500).json({ success: false, message: 'Failed to get gamification data' });
    }
});

// Monthly leaderboard
router.get('/me/leaderboard', requirePainterAuth, async (req, res) => {
    try {
        const { scope = 'overall', month } = req.query;
        const targetMonth = month || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
        const monthStart = `${targetMonth}-01`;
        const monthEnd = `${targetMonth}-31`;

        let branchFilter = '';
        const params = [monthStart, monthEnd];

        if (scope === 'branch') {
            const [painterRow] = await pool.query('SELECT branch_id FROM painters WHERE id = ?', [req.painter.id]);
            const branchId = painterRow.length ? painterRow[0].branch_id : null;
            if (branchId) {
                branchFilter = ' AND p.branch_id = ?';
                params.push(branchId);
            }
        }

        const [leaderboard] = await pool.query(
            `SELECT p.id, p.full_name, p.profile_photo,
                    (COALESCE(p.total_earned_regular, 0) + COALESCE(p.total_earned_annual, 0)) AS total_lifetime_points,
                    COALESCE(SUM(pt.amount), 0) as month_points
             FROM painters p
             LEFT JOIN painter_point_transactions pt ON pt.painter_id = p.id
                AND pt.type = 'earn'
                AND pt.created_at >= ? AND pt.created_at <= ?
             WHERE p.status = 'approved'${branchFilter}
             GROUP BY p.id
             ORDER BY month_points DESC
             LIMIT 20`,
            params
        );

        // Calculate levels and ranks
        const ranked = leaderboard.map((entry, idx) => {
            const lp = parseFloat(entry.total_lifetime_points) || 0;
            let lvl = 'bronze';
            if (lp >= 10000) lvl = 'diamond';
            else if (lp >= 5000) lvl = 'gold';
            else if (lp >= 3000) lvl = 'silver';
            return { ...entry, rank: idx + 1, level: lvl };
        });

        // Find current painter's rank
        let myRank = ranked.find(r => r.id === req.painter.id);
        if (!myRank) {
            // Painter not in top 20, calculate their rank
            const [myPoints] = await pool.query(
                `SELECT COALESCE(SUM(amount), 0) as month_points FROM painter_point_transactions
                 WHERE painter_id = ? AND type = 'earn' AND created_at >= ? AND created_at <= ?`,
                [req.painter.id, monthStart, monthEnd]
            );
            const mp = myPoints[0].month_points;
            const [rankResult] = await pool.query(
                `SELECT COUNT(*) + 1 as rank FROM (
                    SELECT painter_id, SUM(amount) as total
                    FROM painter_point_transactions
                    WHERE type = 'earn' AND created_at >= ? AND created_at <= ?
                    GROUP BY painter_id
                    HAVING total > ?
                ) ranked`,
                [monthStart, monthEnd, mp]
            );
            myRank = { id: req.painter.id, rank: rankResult[0].rank, month_points: mp };
        }

        res.json({ success: true, leaderboard: ranked, my_rank: myRank, month: targetMonth, scope });
    } catch (error) {
        console.error('Leaderboard error:', error);
        res.status(500).json({ success: false, message: 'Failed to get leaderboard' });
    }
});

// Claim challenge reward
router.post('/me/challenges/:id/claim', requirePainterAuth, async (req, res) => {
    try {
        const challengeId = req.params.id;

        // Verify challenge exists and is active
        const [challenges] = await pool.query(
            'SELECT * FROM painter_challenges WHERE id = ? AND is_active = 1',
            [challengeId]
        );
        if (!challenges.length) return res.status(404).json({ success: false, message: 'Challenge not found or inactive' });

        const challenge = challenges[0];

        // Check progress
        const [progress] = await pool.query(
            'SELECT * FROM painter_challenge_progress WHERE challenge_id = ? AND painter_id = ?',
            [challengeId, req.painter.id]
        );
        if (!progress.length || !progress[0].completed) {
            return res.status(400).json({ success: false, message: 'Challenge not completed yet' });
        }
        if (progress[0].claimed) {
            return res.status(400).json({ success: false, message: 'Reward already claimed' });
        }

        // Atomic claim: rejects concurrent duplicate clicks (idempotent at DB level)
        const [claimRes] = await pool.query(
            'UPDATE painter_challenge_progress SET claimed = 1, claimed_at = NOW() WHERE challenge_id = ? AND painter_id = ? AND claimed = 0',
            [challengeId, req.painter.id]
        );
        if (claimRes.affectedRows === 0) {
            return res.status(400).json({ success: false, message: 'Reward already claimed' });
        }

        // Award via Points Engine: applies level multiplier, clawback netting,
        // total_earned_regular update, and level-up notification.
        try {
            await pointsEngine.addPointsWithMultiplier(
                req.painter.id, 'regular', parseFloat(challenge.reward_points), 'challenge_reward',
                `challenge-${challengeId}`, 'challenge', `Challenge reward: ${challenge.title}`, null
            );
        } catch (awardErr) {
            // Roll back claim so painter can retry.
            await pool.query(
                'UPDATE painter_challenge_progress SET claimed = 0, claimed_at = NULL WHERE challenge_id = ? AND painter_id = ?',
                [challengeId, req.painter.id]
            );
            throw awardErr;
        }

        res.json({ success: true, message: `Claimed ${challenge.reward_points} points!`, points: challenge.reward_points });
    } catch (error) {
        console.error('Claim challenge error:', error);
        res.status(500).json({ success: false, message: 'Failed to claim challenge reward' });
    }
});

// ═══════════════════════════════════════════════════════════════
// GALLERY (painter self)
// ═══════════════════════════════════════════════════════════════

// Upload work photo
router.post('/me/gallery', requirePainterAuth, uploadProfile.single('photo'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'Photo is required' });

        const { category, description, is_before, pair_id } = req.body;

        const filename = `gallery-${req.painter.id}-${Date.now()}.jpg`;
        const outputPath = `public/uploads/profiles/${filename}`;
        await sharp(req.file.buffer)
            .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 85 })
            .toFile(outputPath);
        const photo_url = `/uploads/profiles/${filename}`;

        const [result] = await pool.query(
            `INSERT INTO painter_gallery (painter_id, photo_url, category, description, is_before, pair_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, NOW())`,
            [req.painter.id, photo_url, category || 'other', description || null, is_before ? 1 : 0, pair_id || null]
        );

        res.json({ success: true, message: 'Photo uploaded', id: result.insertId, photo_url });
    } catch (error) {
        console.error('Upload gallery photo error:', error);
        res.status(500).json({ success: false, message: 'Failed to upload photo' });
    }
});

// List gallery photos
router.get('/me/gallery', requirePainterAuth, async (req, res) => {
    try {
        const { category, page = 1, limit = 20 } = req.query;
        const pg = Number(page);
        const lim = Number(limit);
        let query = 'SELECT * FROM painter_gallery WHERE painter_id = ?';
        const params = [req.painter.id];

        if (category) { query += ' AND category = ?'; params.push(category); }

        const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) as total');
        const [countResult] = await pool.query(countQuery, params);
        const total = countResult[0].total;

        query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(lim, (pg - 1) * lim);

        const [photos] = await pool.query(query, params);
        res.json({ success: true, photos, total, page: pg, pages: Math.ceil(total / lim) });
    } catch (error) {
        console.error('List gallery error:', error);
        res.status(500).json({ success: false, message: 'Failed to list gallery' });
    }
});

// Delete gallery photo
router.delete('/me/gallery/:id', requirePainterAuth, async (req, res) => {
    try {
        const [existing] = await pool.query('SELECT id FROM painter_gallery WHERE id = ? AND painter_id = ?', [req.params.id, req.painter.id]);
        if (!existing.length) return res.status(404).json({ success: false, message: 'Photo not found' });

        await pool.query('DELETE FROM painter_gallery WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Photo deleted' });
    } catch (error) {
        console.error('Delete gallery photo error:', error);
        res.status(500).json({ success: false, message: 'Failed to delete photo' });
    }
});

// ═══════════════════════════════════════════════════════════════
// CALCULATOR (painter self)
// ═══════════════════════════════════════════════════════════════

// Save calculation
router.post('/me/calculations', requirePainterAuth, async (req, res) => {
    try {
        const { calculation_data, total_sqft, total_paint_liters, estimated_cost } = req.body;

        if (!calculation_data) return res.status(400).json({ success: false, message: 'Calculation data is required' });

        const [result] = await pool.query(
            `INSERT INTO painter_calculations (painter_id, calculation_data, total_sqft, total_paint_liters, estimated_cost, created_at)
             VALUES (?, ?, ?, ?, ?, NOW())`,
            [req.painter.id, JSON.stringify(calculation_data), total_sqft || 0, total_paint_liters || 0, estimated_cost || 0]
        );

        res.json({ success: true, message: 'Calculation saved', id: result.insertId });
    } catch (error) {
        console.error('Save calculation error:', error);
        res.status(500).json({ success: false, message: 'Failed to save calculation' });
    }
});

// List saved calculations
router.get('/me/calculations', requirePainterAuth, async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const pg = Number(page);
        const lim = Number(limit);

        const [countResult] = await pool.query('SELECT COUNT(*) as total FROM painter_calculations WHERE painter_id = ?', [req.painter.id]);
        const total = countResult[0].total;

        const [calculations] = await pool.query(
            'SELECT * FROM painter_calculations WHERE painter_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
            [req.painter.id, lim, (pg - 1) * lim]
        );

        // Parse calculation_data JSON
        for (const calc of calculations) {
            if (calc.calculation_data && typeof calc.calculation_data === 'string') {
                try { calc.calculation_data = JSON.parse(calc.calculation_data); } catch (e) { /* malformed JSON stored; skip */ }
            }
        }

        res.json({ success: true, calculations, total, page: pg, pages: Math.ceil(total / lim) });
    } catch (error) {
        console.error('List calculations error:', error);
        res.status(500).json({ success: false, message: 'Failed to list calculations' });
    }
});

// ── Painter Location Tracking ────────────────────────────────────────────────

// POST /api/painters/me/location-report — painter device reports GPS position
router.post('/me/location-report', requirePainterAuth, async (req, res) => {
    try {
        const { latitude, longitude, accuracy } = req.body;
        if (latitude == null || longitude == null) {
            return res.status(400).json({ success: false, message: 'latitude and longitude required' });
        }
        const painterId = req.painter.id;
        const now = new Date();

        // Rate-limit: skip insert if last row is within 25 seconds
        const [[last]] = await pool.query(
            'SELECT recorded_at FROM painter_location_events WHERE painter_id = ? ORDER BY recorded_at DESC LIMIT 1',
            [painterId]
        );
        if (last && (now - new Date(last.recorded_at)) < 25000) {
            return res.json({ success: true });
        }

        await pool.query(
            'INSERT INTO painter_location_events (painter_id, latitude, longitude, accuracy_m, recorded_at) VALUES (?, ?, ?, ?, NOW())',
            [painterId, latitude, longitude, accuracy || null]
        );

        // Emit live update to admin map room
        if (io) {
            const [[painter]] = await pool.query(
                'SELECT p.full_name AS name, p.level, b.name AS branch FROM painters p LEFT JOIN branches b ON b.id = p.branch_id WHERE p.id = ?',
                [painterId]
            );
            io.to('admin_painters_live').emit('painter_location_update', {
                painterId,
                name: painter?.name || 'Unknown',
                level: painter?.level || 'default',
                branch: painter?.branch || '',
                latitude: Number(latitude),
                longitude: Number(longitude),
                accuracy: accuracy ? Number(accuracy) : null,
                recordedAt: now.toISOString()
            });
        }

        res.json({ success: true });
    } catch (e) {
        console.error('painter location-report error:', e.message);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

module.exports = { router, setPool, setIO };
