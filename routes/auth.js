/**
 * Authentication & OTP Routes
 * /api/auth/* and /api/otp/* — mounted at /api so paths keep their original shape.
 * A1: extracted verbatim from server.js (pure mechanical move, no logic changes).
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { getUserPermissions, invalidateSessionToken, invalidateUser } = require('../middleware/permissionMiddleware');
const { authLimiter, otpLimiter } = require('../middleware/rateLimiter');
const { hashOtp, otpMatches, MAX_OTP_ATTEMPTS } = require('../services/otp-utils');
const smsService = require('../services/sms-service');

let pool = null;
function setPool(p) {
    pool = p;
}
// ========================================
// AUTHENTICATION ENDPOINTS
// ========================================

// Login
router.post('/auth/login', authLimiter, async (req, res) => {
    try {
        const { username, password, remember } = req.body;

        if (!username || !password) {
            return res.status(400).json({ success: false, message: 'Username and password are required' });
        }

        const [users] = await pool.query(
            `SELECT u.*, b.name as branch_name 
             FROM users u 
             LEFT JOIN branches b ON u.branch_id = b.id 
             WHERE (u.username = ? OR u.email = ? OR u.phone = ?) AND u.status = ?`,
            [username, username, username, 'active']
        );

        if (users.length === 0) {
            // SYS-009: audit failed login (unknown account) — req.user unset → actor 'system'
            require('../services/audit-log').record(req, {
                action: 'LOGIN_FAILED', entity_type: 'user', entity_id: null,
                after: { username, reason: 'user_not_found' }
            });
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        const user = users[0];

        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
            // SYS-009: audit failed login (bad password)
            require('../services/audit-log').record(req, {
                action: 'LOGIN_FAILED', entity_type: 'user', entity_id: user.id,
                after: { username: user.username, reason: 'bad_password' }
            });
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }

        // 2FA challenge for admin/manager roles that have TOTP enabled
        if (['admin', 'manager'].includes(user.role) && user.totp_enabled) {
            return res.json({ success: true, requires_2fa: true, user_id: user.id });
        }

        const sessionToken = crypto.randomBytes(32).toString('hex');
        const sessionTokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + (remember ? 720 : 24));

        // Dual-write raw + hash so a code rollback still finds new sessions; reads use hash.
        await pool.query(
            'INSERT INTO user_sessions (user_id, session_token, token_hash, ip_address, user_agent, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
            [user.id, sessionToken, sessionTokenHash, req.ip, req.get('User-Agent'), expiresAt]
        );

        await pool.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

        // SYS-009: audit successful login
        require('../services/audit-log').record(req, {
            action: 'LOGIN_SUCCESS', entity_type: 'user', entity_id: user.id,
            after: { username: user.username, role: user.role }
        });

        res.json({
            success: true,
            token: sessionToken,
            user: {
                id: user.id,
                username: user.username,
                full_name: user.full_name,
                email: user.email,
                role: user.role,
                branch_id: user.branch_id,
                branch_name: user.branch_name || null,
                phone: user.phone,
                profile_image_url: user.profile_image_url
            }
        });

    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Complete login after successful 2FA TOTP validation
router.post('/auth/login-2fa', authLimiter, async (req, res) => {
    try {
        const { user_id, token, remember } = req.body;
        if (!user_id || !token) {
            return res.status(400).json({ success: false, message: 'user_id and token required' });
        }

        const totpSvc = require('../services/totp-service');
        const [users] = await pool.query(
            `SELECT u.*, b.name as branch_name FROM users u
             LEFT JOIN branches b ON u.branch_id = b.id
             WHERE u.id = ? AND u.status = 'active' AND u.role IN ('admin','manager')`,
            [user_id]
        );
        const user = users[0];
        if (!user) return res.status(404).json({ success: false, message: 'User not found' });
        if (!user.totp_enabled) return res.status(400).json({ success: false, message: '2FA not enabled for this user' });

        const valid = totpSvc.verifyToken(user.totp_secret, token);
        if (!valid) {
            // SYS-009: audit failed 2FA challenge
            require('../services/audit-log').record(req, {
                action: 'LOGIN_FAILED', entity_type: 'user', entity_id: user.id,
                after: { username: user.username, reason: 'bad_2fa_token' }
            });
            return res.status(401).json({ success: false, message: 'Invalid 2FA token' });
        }

        const sessionToken = crypto.randomBytes(32).toString('hex');
        const sessionTokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + (remember ? 720 : 24));

        await pool.query(
            'INSERT INTO user_sessions (user_id, session_token, token_hash, ip_address, user_agent, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
            [user.id, sessionToken, sessionTokenHash, req.ip, req.get('User-Agent'), expiresAt]
        );
        await pool.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);

        // SYS-009: audit successful login (via 2FA)
        require('../services/audit-log').record(req, {
            action: 'LOGIN_SUCCESS', entity_type: 'user', entity_id: user.id,
            after: { username: user.username, role: user.role, via: '2fa' }
        });

        res.json({
            success: true,
            token: sessionToken,
            user: {
                id: user.id,
                username: user.username,
                full_name: user.full_name,
                email: user.email,
                role: user.role,
                branch_id: user.branch_id,
                branch_name: user.branch_name || null,
                phone: user.phone,
                profile_image_url: user.profile_image_url
            }
        });
    } catch (error) {
        console.error('2FA login error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Verify token
router.get('/auth/verify', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ success: false, message: 'No token provided' });
        }

        const [sessions] = await pool.query(
            `SELECT s.*, u.id as user_id, u.username, u.full_name, u.email, u.role, u.branch_id, u.phone, u.profile_image_url, b.name as branch_name
             FROM user_sessions s JOIN users u ON s.user_id = u.id
             LEFT JOIN branches b ON u.branch_id = b.id
             WHERE s.token_hash = LOWER(SHA2(?, 256)) AND s.expires_at > NOW() AND u.status = 'active'`,
            [token]
        );

        if (sessions.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid or expired token' });
        }

        const session = sessions[0];
        res.json({
            success: true,
            user: {
                id: session.user_id,
                username: session.username,
                full_name: session.full_name,
                email: session.email,
                role: session.role,
                branch_id: session.branch_id,
                branch_name: session.branch_name || null,
                phone: session.phone,
                profile_image_url: session.profile_image_url
            }
        });

    } catch (error) {
        console.error('Verify token error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Auth "me" endpoint
router.get('/auth/me', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ success: false, message: 'No token provided' });
        }

        const [sessions] = await pool.query(
            `SELECT s.*, u.id as user_id, u.username, u.full_name, u.email, u.role, u.branch_id, u.phone, u.profile_image_url, b.name as branch_name
             FROM user_sessions s JOIN users u ON s.user_id = u.id
             LEFT JOIN branches b ON u.branch_id = b.id
             WHERE s.token_hash = LOWER(SHA2(?, 256)) AND s.expires_at > NOW() AND u.status = 'active'`,
            [token]
        );

        if (sessions.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid or expired token' });
        }

        const session = sessions[0];

        // Fetch full user details including personal, KYC, and bank fields
        let u = session;
        try {
            const [fullUser] = await pool.query(
                `SELECT id, username, full_name, email, role, branch_id, phone, profile_image_url, created_at,
                        date_of_birth, door_no, street, city, state, pincode,
                        aadhar_number, aadhar_proof_url, pan_number, pan_proof_url, kyc_status,
                        emergency_contact_name, emergency_contact_phone,
                        bank_account_name, bank_name, bank_account_number, bank_ifsc_code, upi_id
                 FROM users WHERE id = ?`, [session.user_id]
            );
            if (fullUser.length > 0) u = fullUser[0];
        } catch(e) { /* fallback to session data */ }

        res.json({
            success: true,
            user: {
                id: u.id || session.user_id,
                username: u.username || session.username,
                full_name: u.full_name || session.full_name,
                email: u.email || session.email,
                role: u.role || session.role,
                branch_id: u.branch_id || session.branch_id,
                branch_name: session.branch_name || null,
                phone: u.phone || session.phone,
                profile_image_url: u.profile_image_url || session.profile_image_url,
                created_at: u.created_at,
                date_of_birth: u.date_of_birth || null,
                door_no: u.door_no || null,
                street: u.street || null,
                city: u.city || null,
                state: u.state || null,
                pincode: u.pincode || null,
                aadhar_number: u.aadhar_number || null,
                aadhar_proof_url: u.aadhar_proof_url || null,
                pan_number: u.pan_number || null,
                pan_proof_url: u.pan_proof_url || null,
                kyc_status: u.kyc_status || null,
                emergency_contact_name: u.emergency_contact_name || null,
                emergency_contact_phone: u.emergency_contact_phone || null,
                bank_account_name: u.bank_account_name || null,
                bank_name: u.bank_name || null,
                bank_account_number: u.bank_account_number || null,
                bank_ifsc_code: u.bank_ifsc_code || null,
                upi_id: u.upi_id || null
            }
        });

    } catch (error) {
        console.error('Auth me error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Logout
router.post('/auth/logout', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (token) {
            await pool.query('DELETE FROM user_sessions WHERE token_hash = LOWER(SHA2(?, 256))', [token]);
            invalidateSessionToken(token); // drop from the A2 auth cache immediately
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Forgot Password — issues a single-use, time-limited reset link.
// The user's real password is NOT touched until they submit a new password
// through the /reset-password.html form.
router.post('/auth/forgot-password', authLimiter, async (req, res) => {
    const genericResponse = {
        success: true,
        message: 'If an account exists with this email, a password reset link has been sent.'
    };

    const { email } = req.body || {};
    if (!email || typeof email !== 'string') {
        return res.status(400).json({ success: false, message: 'Email is required.' });
    }

    // Respond identically before doing any DB lookup or SMTP work so the
    // response time can't be used to enumerate which emails are registered.
    res.json(genericResponse);

    const requestIp = req.ip;
    const requestUa = (req.get('User-Agent') || '').slice(0, 255);

    setImmediate(async () => {
        try {
            const [users] = await pool.query(
                'SELECT id, full_name, username, email FROM users WHERE email = ? AND status = ?',
                [email, 'active']
            );
            if (users.length === 0) return;

            const user = users[0];

            const rawToken = crypto.randomBytes(32).toString('hex');
            const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
            const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

            await pool.query(
                `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at, requested_ip, requested_ua)
                 VALUES (?, ?, ?, ?, ?)`,
                [user.id, tokenHash, expiresAt, requestIp, requestUa]
            );

            if (!process.env.SMTP_HOST) return;

            const baseUrl = process.env.APP_PUBLIC_URL || 'https://act.qcpaintshop.com';
            const resetLink = `${baseUrl}/reset-password.html?token=${rawToken}`;

            const _smtpCfg = {
                host: process.env.SMTP_HOST,
                port: parseInt(process.env.SMTP_PORT || '587'),
                secure: parseInt(process.env.SMTP_PORT || '587') === 465 || process.env.SMTP_SECURE === 'true',
                // SVC-035: validate cert by default; SMTP_INSECURE_TLS=true only for the loopback relay.
                tls: { rejectUnauthorized: process.env.SMTP_INSECURE_TLS !== 'true' },
            };
            if (process.env.SMTP_USER) _smtpCfg.auth = { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD };
            const transporter = nodemailer.createTransport(_smtpCfg);

            await transporter.sendMail({
                from: `"${process.env.MAIL_FROM_NAME || 'Quality Colours'}" <${process.env.MAIL_FROM || process.env.SMTP_USER}>`,
                to: email,
                subject: 'Password Reset - Quality Colours Business Manager',
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
                            <h1 style="color: white; margin: 0;">Quality Colours</h1>
                        </div>
                        <div style="background: #f9fafb; padding: 30px;">
                            <h2 style="color: #333;">Reset your password</h2>
                            <p>Hello <strong>${user.full_name || user.username}</strong>,</p>
                            <p>Click the button below to choose a new password. This link is valid for 1 hour and can be used only once.</p>
                            <p style="text-align:center; margin: 28px 0;">
                                <a href="${resetLink}" style="background: #667eea; color: white; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-block;">Reset Password</a>
                            </p>
                            <p style="color: #6b7280; font-size: 13px;">If the button doesn't work, copy and paste this link:</p>
                            <p style="word-break: break-all; color: #4f46e5; font-size: 13px;">${resetLink}</p>
                            <p style="color: #6b7280; font-size: 13px; margin-top: 24px;">If you didn't request a password reset, you can safely ignore this email — your password remains unchanged.</p>
                        </div>
                    </div>
                `
            });
        } catch (error) {
            console.error('Forgot password background error:', error.message);
        }
    });
});

// Mobile-OTP-driven password reset. Pairs with /api/otp/send (purpose=Password
// Reset) + /api/otp/verify on the frontend: user enters their phone, gets an
// SMS, enters OTP + new password. We re-verify the otp_id here, set the new
// hash, blow away any active sessions, and return a generic response so an
// attacker can't enumerate registered phones by response shape.
router.post('/auth/forgot-password-mobile', authLimiter, async (req, res) => {
    try {
        const { mobile, otp_id, password } = req.body || {};
        if (!mobile || !otp_id || !password) {
            return res.status(400).json({ success: false, message: 'Mobile, otp_id and password are required.' });
        }
        if (typeof password !== 'string' || password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 8 characters with one uppercase letter and one number.'
            });
        }
        if (!/^[6-9]\d{9}$/.test(mobile)) {
            return res.status(400).json({ success: false, message: 'Invalid mobile number.' });
        }

        const [otps] = await pool.query(
            `SELECT id FROM otp_verifications
             WHERE id = ? AND phone = ? AND purpose = 'Password Reset' AND verified = 1
               AND created_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE)`,
            [otp_id, mobile]
        );
        if (otps.length === 0) {
            return res.status(400).json({ success: false, message: 'OTP verification expired. Request a new code.' });
        }

        const [users] = await pool.query(
            'SELECT id FROM users WHERE phone IN (?, ?, ?) AND status = ? LIMIT 1',
            [mobile, '+91' + mobile, '91' + mobile, 'active']
        );

        // Always consume the OTP so the same code can't be replayed.
        await pool.query('DELETE FROM otp_verifications WHERE id = ?', [otp_id]);

        if (users.length === 0) {
            return res.json({ success: true, message: 'Password reset successful.' });
        }

        const hashed = await bcrypt.hash(password, 10);
        await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hashed, users[0].id]);

        // Sign every existing session out — the assumption is whoever just
        // requested a reset wants stale sessions invalidated.
        await pool.query('DELETE FROM user_sessions WHERE user_id = ?', [users[0].id]);
        invalidateUser(users[0].id);

        res.json({ success: true, message: 'Password reset successful. Please login with your new password.' });
    } catch (error) {
        console.error('Forgot-password-mobile error:', error);
        res.status(500).json({ success: false, message: 'Reset failed. Please try again.' });
    }
});

// Validate a reset token without consuming it (used by the reset page on load)
router.get('/auth/validate-reset-token', async (req, res) => {
    try {
        const { token } = req.query;
        if (!token || typeof token !== 'string') {
            return res.status(400).json({ success: false, message: 'Token required.' });
        }
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const [rows] = await pool.query(
            `SELECT id FROM password_reset_tokens
             WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()`,
            [tokenHash]
        );
        if (rows.length === 0) {
            return res.status(400).json({ success: false, message: 'Reset link is invalid or has expired.' });
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Validate reset token error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// Consume a reset token and set a new password
router.post('/auth/reset-password', authLimiter, async (req, res) => {
    try {
        const { token, password } = req.body || {};
        if (!token || !password) {
            return res.status(400).json({ success: false, message: 'Token and new password are required.' });
        }
        if (typeof password !== 'string' || password.length < 8) {
            return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
        }

        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const conn = await pool.getConnection();
        try {
            await conn.beginTransaction();

            const [rows] = await conn.query(
                `SELECT id, user_id FROM password_reset_tokens
                 WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()
                 FOR UPDATE`,
                [tokenHash]
            );
            if (rows.length === 0) {
                await conn.rollback();
                return res.status(400).json({ success: false, message: 'Reset link is invalid or has expired.' });
            }
            const { id: tokenId, user_id: userId } = rows[0];

            const newHash = await bcrypt.hash(password, 10);
            await conn.query('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, userId]);
            await conn.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?', [tokenId]);
            await conn.query('DELETE FROM user_sessions WHERE user_id = ?', [userId]);

            await conn.commit();
            invalidateUser(userId);
            res.json({ success: true, message: 'Password reset successfully. Please log in with your new password.' });
        } catch (err) {
            await conn.rollback();
            throw err;
        } finally {
            conn.release();
        }
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ success: false, message: 'Server error.' });
    }
});

// Get current user's permissions
router.get('/auth/permissions', getUserPermissions);

// ========================================
// OTP AUTHENTICATION
// ========================================

// Send OTP
router.post('/otp/send', otpLimiter, async (req, res) => {
    try {
        const { mobile, purpose } = req.body;

        if (!mobile || !/^[6-9]\d{9}$/.test(mobile)) {
            return res.status(400).json({ success: false, error: 'Invalid mobile number', code: 'VALIDATION_ERROR' });
        }

        if (!['Registration', 'Login', 'Password Reset', 'Staff Registration'].includes(purpose)) {
            return res.status(400).json({ success: false, error: 'Invalid purpose', code: 'VALIDATION_ERROR' });
        }

        // Rate limit
        const [rateCheck] = await pool.query(
            'SELECT COUNT(*) as count FROM otp_verifications WHERE phone = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)',
            [mobile]
        );

        if (rateCheck[0].count >= 3) {
            return res.status(429).json({
                success: false,
                error: 'Too many OTP requests. Try again after 1 hour.',
                code: 'RATE_LIMIT_EXCEEDED'
            });
        }

        if (purpose === 'Registration' || purpose === 'Staff Registration') {
            const [existing] = await pool.query('SELECT id FROM users WHERE phone = ? OR phone = ? OR phone = ?', [mobile, '+91' + mobile, '91' + mobile]);
            if (existing.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: 'Mobile number already registered.',
                    code: 'MOBILE_ALREADY_REGISTERED'
                });
            }
            if (purpose === 'Staff Registration') {
                const [pendingRegs] = await pool.query(
                    "SELECT id FROM staff_registrations WHERE phone = ? AND status = 'pending'", [mobile]
                );
                if (pendingRegs.length > 0) {
                    return res.status(400).json({
                        success: false,
                        error: 'A staff registration with this mobile number is already pending.',
                        code: 'MOBILE_ALREADY_REGISTERED'
                    });
                }
            }
        }

        // For password reset, only send SMS if the mobile is actually registered.
        // Return success regardless so an attacker can't enumerate which numbers
        // belong to staff. The reset endpoint applies the same generic response.
        if (purpose === 'Password Reset') {
            const [users] = await pool.query(
                'SELECT id FROM users WHERE phone IN (?, ?, ?) AND status = ? LIMIT 1',
                [mobile, '+91' + mobile, '91' + mobile, 'active']
            );
            if (users.length === 0) {
                return res.json({
                    success: true,
                    data: { mobile, otp_id: null, expires_in_seconds: 300, purpose },
                    message: 'If an account exists with this mobile number, an OTP has been sent.'
                });
            }
        }

        // Invalidate old OTPs
        await pool.query(
            'UPDATE otp_verifications SET verified = 1 WHERE phone = ? AND purpose = ? AND verified = 0',
            [mobile, purpose]
        );

        const otpCode = String(crypto.randomInt(100000, 1000000));
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

        const [result] = await pool.query(
            'INSERT INTO otp_verifications (phone, otp, purpose, expires_at) VALUES (?, ?, ?, ?)',
            [mobile, hashOtp(otpCode), purpose, expiresAt]
        );

        // Send SMS via configured provider (DLT-registered templates)
        {
            // DLT-registered template (single verified template for all OTP purposes)
            const message = `Your verification OTP for Quality Colours registration is ${otpCode}. Please enter this code at https://qcpaintshop.com/ to complete setup. - QUALITY COLOURS.`;
            smsService.sendSms({ number: '91' + mobile, text: message, label: 'SMS' });
        }

        // For Staff Registration, also send OTP via email
        if (purpose === 'Staff Registration' && req.body.email && process.env.SMTP_HOST) {
            try {
                const _smtpCfg = {
                    host: process.env.SMTP_HOST,
                    port: parseInt(process.env.SMTP_PORT || '587'),
                    secure: parseInt(process.env.SMTP_PORT || '587') === 465 || process.env.SMTP_SECURE === 'true',
                };
                if (process.env.SMTP_USER) _smtpCfg.auth = { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD };
                const transporter = nodemailer.createTransport(_smtpCfg);
                await transporter.sendMail({
                    from: `"${process.env.MAIL_FROM_NAME || 'Quality Colours'}" <${process.env.MAIL_FROM || process.env.SMTP_USER}>`,
                    to: req.body.email,
                    subject: 'OTP Verification - Quality Colours Staff Registration',
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
                                <h1 style="color: white; margin: 0;">Quality Colours</h1>
                            </div>
                            <div style="background: #f9fafb; padding: 30px;">
                                <h2 style="color: #333;">Staff Registration OTP</h2>
                                <p>Your verification code is:</p>
                                <div style="background: white; border: 2px solid #667eea; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
                                    <code style="font-size: 32px; font-weight: bold; color: #667eea; letter-spacing: 8px;">${otpCode}</code>
                                </div>
                                <p style="color: #6b7280; font-size: 13px;">Valid for 5 minutes. Do not share this code.</p>
                            </div>
                        </div>
                    `
                });
                console.log('OTP email sent to:', req.body.email);
            } catch (emailErr) {
                console.error('OTP email error:', emailErr.message);
            }
        }

        const response = {
            success: true,
            data: {
                mobile,
                otp_id: result.insertId,
                expires_in_seconds: 300,
                purpose
            },
            message: `OTP sent successfully to ${mobile}`
        };

        if (process.env.NODE_ENV === 'development') {
            response.data.otp_code = otpCode;
        }

        res.json(response);

    } catch (error) {
        console.error('Send OTP Error:', error);
        res.status(500).json({ success: false, error: 'Failed to send OTP', code: 'SERVER_ERROR' });
    }
});

// Verify OTP
router.post('/otp/verify', otpLimiter, async (req, res) => {
    try {
        const { mobile, otp_code, purpose } = req.body;

        if (!mobile || !otp_code || !purpose) {
            return res.status(400).json({ success: false, error: 'Missing required fields', code: 'VALIDATION_ERROR' });
        }

        const [otps] = await pool.query(
            'SELECT * FROM otp_verifications WHERE phone = ? AND purpose = ? AND verified = 0 AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
            [mobile, purpose]
        );

        if (otps.length === 0) {
            return res.status(400).json({ success: false, error: 'Invalid or expired OTP', code: 'OTP_INVALID' });
        }

        // S2: OTPs are stored hashed; cap wrong guesses per issued code.
        if (otps[0].attempts >= MAX_OTP_ATTEMPTS) {
            await pool.query('UPDATE otp_verifications SET verified = 1 WHERE id = ?', [otps[0].id]);
            return res.status(400).json({ success: false, error: 'Too many wrong attempts. Request a new OTP.', code: 'OTP_INVALID' });
        }
        if (!otpMatches(otps[0].otp, otp_code)) {
            await pool.query('UPDATE otp_verifications SET attempts = attempts + 1 WHERE id = ?', [otps[0].id]);
            return res.status(400).json({ success: false, error: 'Invalid OTP code', code: 'OTP_MISMATCH' });
        }

        await pool.query('UPDATE otp_verifications SET verified = 1 WHERE id = ?', [otps[0].id]);

        res.json({
            success: true,
            data: {
                id: otps[0].id,
                mobile,
                purpose,
                verified_at: new Date().toISOString(),
                is_verified: true,
                next_step: purpose === 'Registration' ? 'complete_registration' : 'continue'
            },
            message: 'OTP verified successfully'
        });

    } catch (error) {
        console.error('Verify OTP Error:', error);
        res.status(500).json({ success: false, error: 'Failed to verify OTP', code: 'SERVER_ERROR' });
    }
});

// Resend OTP (FIXED: proper implementation instead of broken app._router.handle)
router.post('/otp/resend', otpLimiter, async (req, res) => {
    try {
        const { mobile, purpose } = req.body;

        if (!mobile || !purpose) {
            return res.status(400).json({ success: false, error: 'Missing mobile and purpose', code: 'VALIDATION_ERROR' });
        }

        // Check cooldown
        const [recent] = await pool.query(
            'SELECT created_at FROM otp_verifications WHERE phone = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1',
            [mobile, purpose]
        );

        if (recent.length > 0) {
            const elapsed = (Date.now() - new Date(recent[0].created_at).getTime()) / 1000;
            if (elapsed < 60) {
                return res.status(429).json({
                    success: false,
                    error: `Please wait ${Math.ceil(60 - elapsed)} seconds.`,
                    code: 'RESEND_COOLDOWN',
                    details: { retry_after: Math.ceil(60 - elapsed) }
                });
            }
        }

        // Invalidate old OTPs
        await pool.query(
            'UPDATE otp_verifications SET verified = 1 WHERE phone = ? AND purpose = ? AND verified = 0',
            [mobile, purpose]
        );

        const otpCode = String(crypto.randomInt(100000, 1000000));
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

        const [result] = await pool.query(
            'INSERT INTO otp_verifications (phone, otp, purpose, expires_at) VALUES (?, ?, ?, ?)',
            [mobile, hashOtp(otpCode), purpose, expiresAt]
        );

        // Send SMS (DLT-registered templates)
        {
            const message = `Your verification OTP for Quality Colours registration is ${otpCode}. Please enter this code at https://qcpaintshop.com/ to complete setup. - QUALITY COLOURS.`;
            smsService.sendSms({ number: '91' + mobile, text: message, label: 'SMS resend' });
        }

        // For Staff Registration, also resend OTP via email
        if (purpose === 'Staff Registration' && req.body.email && process.env.SMTP_HOST) {
            try {
                const _smtpCfg = {
                    host: process.env.SMTP_HOST,
                    port: parseInt(process.env.SMTP_PORT || '587'),
                    secure: parseInt(process.env.SMTP_PORT || '587') === 465 || process.env.SMTP_SECURE === 'true',
                };
                if (process.env.SMTP_USER) _smtpCfg.auth = { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD };
                const transporter = nodemailer.createTransport(_smtpCfg);
                await transporter.sendMail({
                    from: `"${process.env.MAIL_FROM_NAME || 'Quality Colours'}" <${process.env.MAIL_FROM || process.env.SMTP_USER}>`,
                    to: req.body.email,
                    subject: 'OTP Verification - Quality Colours Staff Registration',
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
                                <h1 style="color: white; margin: 0;">Quality Colours</h1>
                            </div>
                            <div style="background: #f9fafb; padding: 30px;">
                                <h2 style="color: #333;">Staff Registration OTP</h2>
                                <p>Your verification code is:</p>
                                <div style="background: white; border: 2px solid #667eea; border-radius: 8px; padding: 20px; text-align: center; margin: 20px 0;">
                                    <code style="font-size: 32px; font-weight: bold; color: #667eea; letter-spacing: 8px;">${otpCode}</code>
                                </div>
                                <p style="color: #6b7280; font-size: 13px;">Valid for 5 minutes. Do not share this code.</p>
                            </div>
                        </div>
                    `
                });
                console.log('[OTP] Email resent to:', req.body.email);
            } catch (emailErr) {
                console.error('[OTP] Email resend error:', emailErr.message);
            }
        }

        const response = {
            success: true,
            data: { mobile, otp_id: result.insertId, expires_in_seconds: 300, purpose },
            message: `OTP resent to ${mobile}`
        };

        if (process.env.NODE_ENV === 'development') {
            response.data.otp_code = otpCode;
        }

        res.json(response);

    } catch (error) {
        console.error('Resend OTP Error:', error);
        res.status(500).json({ success: false, error: 'Failed to resend OTP', code: 'SERVER_ERROR' });
    }
});

// Register
router.post('/auth/register', authLimiter, async (req, res) => {
    try {
        const { mobile, otp_id, customer_name, email, password, password_confirm, whatsapp_opt_in } = req.body;

        if (!mobile || !otp_id || !customer_name || !password || !password_confirm) {
            return res.status(400).json({ success: false, error: 'Missing required fields', code: 'VALIDATION_ERROR' });
        }

        if (password !== password_confirm) {
            return res.status(400).json({ success: false, error: 'Passwords do not match', code: 'PASSWORD_MISMATCH' });
        }

        if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
            return res.status(400).json({
                success: false,
                error: 'Password must be at least 8 characters with one uppercase letter and one number',
                code: 'PASSWORD_WEAK'
            });
        }

        const [otps] = await pool.query(
            'SELECT * FROM otp_verifications WHERE id = ? AND phone = ? AND verified = 1 AND created_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE)',
            [otp_id, mobile]
        );

        if (otps.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'OTP verification expired. Please request a new OTP.',
                code: 'OTP_VERIFICATION_INVALID'
            });
        }

        const [existing] = await pool.query('SELECT id FROM users WHERE phone = ?', [mobile]);
        if (existing.length > 0) {
            return res.status(400).json({ success: false, error: 'Mobile number already registered', code: 'MOBILE_ALREADY_REGISTERED' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const [result] = await pool.query(
            'INSERT INTO users (username, password_hash, full_name, phone, email, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [mobile, hashedPassword, customer_name, mobile, email || '', 'customer', 'active']
        );

        const sessionToken = crypto.randomBytes(32).toString('hex');
        const sessionTokenHash = crypto.createHash('sha256').update(sessionToken).digest('hex');
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 24);

        await pool.query(
            'INSERT INTO user_sessions (user_id, session_token, token_hash, expires_at) VALUES (?, ?, ?, ?)',
            [result.insertId, sessionToken, sessionTokenHash, expiresAt]
        );

        res.status(201).json({
            success: true,
            data: {
                user_id: result.insertId,
                username: mobile,
                customer_name,
                email,
                role: 'customer',
                token: sessionToken
            },
            message: 'Registration successful! Welcome to Quality Colours.'
        });

    } catch (error) {
        console.error('Registration Error:', error);
        res.status(500).json({ success: false, error: 'Registration failed', code: 'SERVER_ERROR' });
    }
});
module.exports = {
    router,
    setPool
};
