const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const multer = require('multer');
const path = require('path');
require('dotenv').config();

// Import permission middleware
const { requirePermission, requireAnyPermission, requireAuth, getUserPermissions } = require('./middleware/permissionMiddleware');

// Import attendance routes
const attendanceRoutes = require('./routes/attendance');

// Import salary routes
const salaryRoutes = require('./routes/salary');

// Import estimate request routes
const estimateRequestRoutes = require('./routes/estimate-requests');

const app = express();

app.use(cors());
// Increase payload limit for profile picture uploads (base64 images can be large)
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static('public'));

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10
});

// Configure multer for file uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads/logos/');
    },
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'logo-' + uniqueName + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB limit
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files allowed'));
        }
    }
});

// Initialize attendance routes with database pool
attendanceRoutes.setPool(pool);

// Initialize salary routes with database pool
salaryRoutes.setPool(pool);

// Initialize estimate request routes with database pool
estimateRequestRoutes.setPool(pool);

// Mount attendance routes
app.use('/api/attendance', attendanceRoutes.router);

// Mount salary routes
app.use('/api/salary', salaryRoutes.router);

// Mount estimate request routes
app.use('/api/estimate-requests', estimateRequestRoutes.router);

// Test endpoint to verify salary routes are loaded
app.get('/api/salary-test', (req, res) => {
    res.json({ success: true, message: 'Salary test endpoint working' });
});

// ========================================
// AUTHENTICATION ENDPOINTS
// ========================================

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password, remember } = req.body;
        
        const [users] = await pool.query(
            'SELECT * FROM users WHERE (username = ? OR email = ?) AND status = "active"',
            [username, username]
        );
        
        if (users.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
        
        const user = users[0];
        
        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        if (!passwordMatch) {
            return res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
        
        const sessionToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + (remember ? 720 : 24));
        
        await pool.query(
            'INSERT INTO user_sessions (user_id, session_token, ip_address, user_agent, expires_at) VALUES (?, ?, ?, ?, ?)',
            [user.id, sessionToken, req.ip, req.get('User-Agent'), expiresAt]
        );
        
        await pool.query('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);
        
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
                phone: user.phone,
                profile_image_url: user.profile_image_url
            }
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Verify token endpoint
app.get('/api/auth/verify', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ success: false, message: 'No token provided' });
        }
        
        const [sessions] = await pool.query(
            'SELECT s.*, u.* FROM user_sessions s JOIN users u ON s.user_id = u.id WHERE s.session_token = ? AND s.expires_at > NOW()',
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
                branch_id: session.branch_id
            }
        });
        
    } catch (error) {
        console.error('Verify token error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Auth "me" endpoint (alias for verify - used by newer pages)
app.get('/api/auth/me', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ success: false, message: 'No token provided' });
        }
        
        const [sessions] = await pool.query(
            'SELECT s.*, u.* FROM user_sessions s JOIN users u ON s.user_id = u.id WHERE s.session_token = ? AND s.expires_at > NOW()',
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
                branch_id: session.branch_id
            }
        });
        
    } catch (error) {
        console.error('Auth me error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Logout endpoint
app.post('/api/auth/logout', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (token) {
            await pool.query('DELETE FROM user_sessions WHERE session_token = ?', [token]);
        }
        res.json({ success: true });
    } catch (error) {
        console.error('Logout error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Forgot Password endpoint
app.post('/api/auth/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        
        // Check if user exists
        const [users] = await pool.query(
            'SELECT * FROM users WHERE email = ? AND status = "active"',
            [email]
        );
        
        if (users.length === 0) {
            // Don't reveal if email exists or not (security best practice)
            return res.json({ 
                success: true, 
                message: 'If an account exists with this email, you will receive a password reset link shortly.' 
            });
        }
        
        const user = users[0];
        
        // Generate reset token
        const resetToken = crypto.randomBytes(32).toString('hex');
        const resetExpires = new Date();
        resetExpires.setHours(resetExpires.getHours() + 1); // 1 hour expiry
        
        // Store reset token (we'll need to add a column for this or use a separate table)
        // For now, let's send them a temporary password
        const tempPassword = crypto.randomBytes(4).toString('hex'); // 8 character temp password
        const hashedPassword = await bcrypt.hash(tempPassword, 10);
        
        await pool.query(
            'UPDATE users SET password_hash = ? WHERE id = ?',
            [hashedPassword, user.id]
        );
        
        // Configure email transporter
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: parseInt(process.env.SMTP_PORT),
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASSWORD
            }
        });
        
        // Send email
        const mailOptions = {
            from: `"${process.env.MAIL_FROM_NAME}" <${process.env.MAIL_FROM}>`,
            to: email,
            subject: 'Password Reset - Quality Colours Business Manager',
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
                        <h1 style="color: white; margin: 0;">Quality Colours</h1>
                        <p style="color: rgba(255,255,255,0.9); margin: 10px 0 0 0;">Business Manager</p>
                    </div>
                    <div style="background: #f9fafb; padding: 30px;">
                        <h2 style="color: #333; margin-top: 0;">Password Reset Request</h2>
                        <p style="color: #666; line-height: 1.6;">
                            Hello <strong>${user.full_name || user.username}</strong>,
                        </p>
                        <p style="color: #666; line-height: 1.6;">
                            We received a request to reset your password. Your temporary password is:
                        </p>
                        <div style="background: white; border: 2px solid #667eea; border-radius: 8px; padding: 20px; margin: 20px 0; text-align: center;">
                            <code style="font-size: 24px; font-weight: bold; color: #667eea; letter-spacing: 2px;">${tempPassword}</code>
                        </div>
                        <p style="color: #666; line-height: 1.6;">
                            Please log in using this temporary password and change it immediately from your profile settings.
                        </p>
                        <div style="text-align: center; margin: 30px 0;">
                            <a href="https://act.qcpaintshop.com/business-manager/login.html" 
                               style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: bold;">
                                Login Now
                            </a>
                        </div>
                        <p style="color: #999; font-size: 12px; line-height: 1.6;">
                            If you didn't request this password reset, please contact support immediately.
                        </p>
                    </div>
                    <div style="background: #1f2937; padding: 20px; text-align: center;">
                        <p style="color: #9ca3af; font-size: 12px; margin: 0;">
                            © 2026 Quality Colours. All rights reserved.
                        </p>
                    </div>
                </div>
            `
        };
        
        await transporter.sendMail(mailOptions);
        
        res.json({ 
            success: true, 
            message: 'Password reset email sent successfully. Please check your inbox.' 
        });
        
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ success: false, message: 'Failed to send reset email. Please try again later.' });
    }
});

// ========================================
// PERMISSIONS
// ========================================

// Get current user's permissions
app.get('/api/auth/permissions', getUserPermissions);

// ========================================
// OTP AUTHENTICATION
// ========================================

// Send OTP
app.post('/api/otp/send', async (req, res) => {
    try {
        const { mobile, purpose } = req.body;
        
        // Validate
        if (!mobile || !/^[6-9]\d{9}$/.test(mobile)) {
            return res.status(400).json({ success: false, error: 'Invalid mobile number', code: 'VALIDATION_ERROR' });
        }
        
        if (!['Registration', 'Login', 'Password Reset'].includes(purpose)) {
            return res.status(400).json({ success: false, error: 'Invalid purpose', code: 'VALIDATION_ERROR' });
        }
        
        // Check rate limit (3 per hour)
        const [rateCheck] = await pool.query(
            'SELECT COUNT(*) as count FROM otp_verifications WHERE phone = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR)',
            [mobile]
        );
        
        if (rateCheck[0].count >= 3) {
            return res.status(429).json({ 
                success: false, 
                error: 'Too many OTP requests. Please try again after 1 hour.', 
                code: 'RATE_LIMIT_EXCEEDED',
                details: { retry_after: 3600 }
            });
        }
        
        // Check if mobile already registered (for Registration purpose)
        if (purpose === 'Registration') {
            const [existing] = await pool.query('SELECT id FROM users WHERE phone = ?', [mobile]);
            if (existing.length > 0) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'This mobile number is already registered. Please login instead.', 
                    code: 'MOBILE_ALREADY_REGISTERED' 
                });
            }
        }
        
        // Invalidate old OTPs
        await pool.query(
            'UPDATE otp_verifications SET verified = 1 WHERE phone = ? AND purpose = ? AND verified = 0',
            [mobile, purpose]
        );
        
        // Generate OTP
        const otpCode = String(Math.floor(100000 + Math.random() * 900000));
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5 minutes
        
        // Save OTP
        const [result] = await pool.query(
            'INSERT INTO otp_verifications (phone, otp, purpose, expires_at) VALUES (?, ?, ?, ?)',
            [mobile, otpCode, purpose, expiresAt]
        );
        
        // Send SMS via Nettyfish
        const https = require('https');
        const querystring = require('querystring');
        
        const message = `Your verification OTP for Quality Colours registration is ${otpCode}. Please enter this code at https://qcpaintshop.com/ to complete setup. - QUALITY COLOURS.`;
        
        const params = querystring.stringify({
            user: 'QUALITYCOLOURS',
            password: 'Netty@25',
            senderid: 'QUALTQ',
            channel: 'Trans',
            DCS: '0',
            flashsms: '0',
            number: '91' + mobile,
            text: message,
            route: '4'
        });
        
        const smsUrl = `https://retailsms.nettyfish.com/api/mt/SendSMS?${params}`;
        
        https.get(smsUrl, (smsRes) => {
            let data = '';
            smsRes.on('data', chunk => { data += chunk; });
            smsRes.on('end', () => {
                console.log('SMS Response:', data);
            });
        }).on('error', (err) => {
            console.error('SMS Error:', err);
        });
        
        // Response
        const response = {
            success: true,
            data: {
                mobile: mobile,
                otp_id: result.insertId,
                expires_in_seconds: 300,
                purpose: purpose
            },
            message: `OTP sent successfully to ${mobile}`
        };
        
        // In development, include OTP
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
app.post('/api/otp/verify', async (req, res) => {
    try {
        const { mobile, otp_code, purpose } = req.body;
        
        // Validate
        if (!mobile || !otp_code || !purpose) {
            return res.status(400).json({ success: false, error: 'Missing required fields', code: 'VALIDATION_ERROR' });
        }
        
        // Get OTP
        const [otps] = await pool.query(
            'SELECT * FROM otp_verifications WHERE phone = ? AND purpose = ? AND verified = 0 AND expires_at > NOW() ORDER BY created_at DESC LIMIT 1',
            [mobile, purpose]
        );
        
        if (otps.length === 0) {
            return res.status(400).json({ success: false, error: 'Invalid or expired OTP', code: 'OTP_INVALID' });
        }
        
        const otp = otps[0];
        
        // Verify code
        if (otp.otp !== otp_code) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid OTP code', 
                code: 'OTP_MISMATCH'
            });
        }
        
        // Mark as verified
        await pool.query('UPDATE otp_verifications SET verified = 1 WHERE id = ?', [otp.id]);
        
        res.json({
            success: true,
            data: {
                id: otp.id,
                mobile: mobile,
                purpose: purpose,
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

// Resend OTP
app.post('/api/otp/resend', async (req, res) => {
    try {
        const { mobile, purpose } = req.body;
        
        // Check cooldown (60 seconds)
        const [recent] = await pool.query(
            'SELECT created_at FROM otp_verifications WHERE phone = ? AND purpose = ? ORDER BY created_at DESC LIMIT 1',
            [mobile, purpose]
        );
        
        if (recent.length > 0) {
            const elapsed = (Date.now() - new Date(recent[0].created_at).getTime()) / 1000;
            if (elapsed < 60) {
                return res.status(429).json({
                    success: false,
                    error: `Please wait ${Math.ceil(60 - elapsed)} seconds before requesting a new OTP.`,
                    code: 'RESEND_COOLDOWN',
                    details: { retry_after: Math.ceil(60 - elapsed) }
                });
            }
        }
        
        // Use same logic as send
        return app._router.handle({ ...req, url: '/api/otp/send', method: 'POST' }, res);
        
    } catch (error) {
        console.error('Resend OTP Error:', error);
        res.status(500).json({ success: false, error: 'Failed to resend OTP', code: 'SERVER_ERROR' });
    }
});

// Register (Complete registration after OTP)
app.post('/api/auth/register', async (req, res) => {
    try {
        const { mobile, otp_id, customer_name, email, password, password_confirm, whatsapp_opt_in } = req.body;
        
        // Validate
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
        
        // Verify OTP was verified
        const [otps] = await pool.query(
            'SELECT * FROM otp_verifications WHERE id = ? AND phone = ? AND verified = 1 AND created_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE)',
            [otp_id, mobile]
        );
        
        if (otps.length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'OTP verification expired or invalid. Please request a new OTP.', 
                code: 'OTP_VERIFICATION_INVALID' 
            });
        }
        
        // Check if already registered
        const [existing] = await pool.query('SELECT id FROM users WHERE phone = ?', [mobile]);
        if (existing.length > 0) {
            return res.status(400).json({ success: false, error: 'Mobile number already registered', code: 'MOBILE_ALREADY_REGISTERED' });
        }
        
        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);
        
        // Create user
        const [result] = await pool.query(
            'INSERT INTO users (username, password_hash, full_name, phone, email, role, status) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [mobile, hashedPassword, customer_name, mobile, email || '', 'customer', 'active']
        );
        
        // Generate session token
        const sessionToken = crypto.randomBytes(32).toString('hex');
        await pool.query(
            'INSERT INTO user_sessions (user_id, session_token) VALUES (?, ?)',
            [result.insertId, sessionToken]
        );
        
        res.status(201).json({
            success: true,
            data: {
                user_id: result.insertId,
                username: mobile,
                customer_name: customer_name,
                email: email,
                role: 'Customer',
                token: sessionToken,
                lead_linked: false
            },
            message: 'Registration successful! Welcome to Quality Colors.'
        });
        
    } catch (error) {
        console.error('Registration Error:', error);
        res.status(500).json({ success: false, error: 'Registration failed', code: 'SERVER_ERROR' });
    }
});

// ========================================
// DATABASE TEST
// ========================================

app.get('/api/test', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT 1 as test');
        res.json({ status: 'Database connected', result: rows[0] });
    } catch (err) {
        res.status(500).json({ error: 'Database connection failed', message: err.message });
    }
});

// ========================================
// SETTINGS
// ========================================

// Get all settings
app.get('/api/settings', requireAuth, async (req, res) => {
    try {
        const [settings] = await pool.query('SELECT * FROM settings');
        
        // Convert to key-value object
        const settingsObj = {};
        settings.forEach(setting => {
            settingsObj[setting.setting_key] = setting.setting_value;
        });
        
        res.json(settingsObj);
    } catch (err) {
        console.error('Get settings error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Get settings by category
app.get('/api/settings/:category', async (req, res) => {
    try {
        const [settings] = await pool.query(
            'SELECT * FROM settings WHERE category = ?',
            [req.params.category]
        );
        
        const settingsObj = {};
        settings.forEach(setting => {
            settingsObj[setting.setting_key] = setting.setting_value;
        });
        
        res.json(settingsObj);
    } catch (err) {
        console.error('Get settings by category error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Update settings
app.post('/api/settings', requirePermission('settings', 'manage'), async (req, res) => {
    try {
        const settings = req.body;
        
        // Update each setting
        for (const [key, value] of Object.entries(settings)) {
            await pool.query(
                'INSERT INTO settings (setting_key, setting_value, category) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
                [key, value, key.split('_')[0], value]
            );
        }
        
        res.json({ success: true, message: 'Settings updated successfully' });
    } catch (err) {
        console.error('Update settings error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Logo upload endpoint
app.post('/api/upload/logo', requireAuth, upload.single('logo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }
        
        const logoUrl = `/business-manager/uploads/logos/${req.file.filename}`;
        
        // Save logo URL to settings
        await pool.query(
            'INSERT INTO settings (setting_key, setting_value, category) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
            ['business_logo', logoUrl, 'business', logoUrl]
        );
        
        res.json({ success: true, logoUrl: logoUrl, message: 'Logo uploaded successfully' });
    } catch (error) {
        console.error('Logo upload error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Update single setting
app.put('/api/settings/:key', requirePermission('settings', 'manage'), async (req, res) => {
    try {
        const { value, category } = req.body;
        
        await pool.query(
            'INSERT INTO settings (setting_key, setting_value, category) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
            [req.params.key, value, category, value]
        );
        
        res.json({ success: true, message: 'Setting updated successfully' });
    } catch (err) {
        console.error('Update setting error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// BRANDS
// ========================================

app.get('/api/brands', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM brands WHERE status = "active" ORDER BY name');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/brands', requirePermission('brands', 'add'), async (req, res) => {
    try {
        const { name, logo_url, status } = req.body;
        const [result] = await pool.query(
            'INSERT INTO brands (name, logo_url, status) VALUES (?, ?, ?)', 
            [name, logo_url, status || 'active']
        );
        res.json({ id: result.insertId, name, logo_url, status: status || 'active' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/brands/:id', requirePermission('brands', 'edit'), async (req, res) => {
    try {
        const { name, logo_url, status } = req.body;
        await pool.query(
            'UPDATE brands SET name = ?, logo_url = ?, status = ? WHERE id = ?',
            [name, logo_url, status, req.params.id]
        );
        res.json({ success: true, message: 'Brand updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/brands/:id', requirePermission('brands', 'delete'), async (req, res) => {
    try {
        await pool.query('UPDATE brands SET status = "inactive" WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Brand deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// CATEGORIES
// ========================================

app.get('/api/categories', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM categories WHERE status = "active" ORDER BY name');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/categories', requirePermission('categories', 'add'), async (req, res) => {
    try {
        const { name, description, status } = req.body;
        const [result] = await pool.query(
            'INSERT INTO categories (name, description, status) VALUES (?, ?, ?)', 
            [name, description, status || 'active']
        );
        res.json({ id: result.insertId, name, description, status: status || 'active' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/categories/:id', requirePermission('categories', 'edit'), async (req, res) => {
    try {
        const { name, description, status } = req.body;
        await pool.query(
            'UPDATE categories SET name = ?, description = ?, status = ? WHERE id = ?',
            [name, description, status, req.params.id]
        );
        res.json({ success: true, message: 'Category updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/categories/:id', requirePermission('categories', 'delete'), async (req, res) => {
    try {
        await pool.query('UPDATE categories SET status = "inactive" WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Category deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// BRANCHES
// ========================================

app.get('/api/branches', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM branches WHERE status = "active" ORDER BY name');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// USERS (STAFF MANAGEMENT)
// ========================================

// Get all users
app.get('/api/users', requirePermission('staff', 'view'), async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id, username, email, full_name, phone, role, branch_id, status, created_at, last_login FROM users ORDER BY created_at DESC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get single user
app.get('/api/users/:id', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id, username, email, full_name, phone, role, branch_id, status, created_at, last_login FROM users WHERE id = ?', [req.params.id]);
        if (rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create user
app.post('/api/users', requirePermission('staff', 'add'), async (req, res) => {
    try {
        const { username, email, password, full_name, phone, role, branch_id, status } = req.body;
        
        // Hash password
        const password_hash = await bcrypt.hash(password, 10);
        
        const [result] = await pool.query(
            'INSERT INTO users (username, email, password_hash, full_name, phone, role, branch_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [username, email, password_hash, full_name, phone, role || 'staff', branch_id, status || 'active']
        );
        
        res.json({ success: true, id: result.insertId, message: 'User created successfully' });
    } catch (err) {
        console.error('Create user error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Update user
app.put('/api/users/:id', requirePermission('staff', 'edit'), async (req, res) => {
    try {
        const { username, email, password, full_name, phone, role, branch_id, status, profile_image_url } = req.body;
        const userId = req.params.id;
        
        // Only include fields that are provided (not undefined)
        let updateData = {};
        if (username !== undefined) updateData.username = username;
        if (email !== undefined) updateData.email = email;
        if (full_name !== undefined) updateData.full_name = full_name;
        if (phone !== undefined) updateData.phone = phone;
        if (role !== undefined) updateData.role = role;
        if (branch_id !== undefined) updateData.branch_id = branch_id;
        if (status !== undefined) updateData.status = status;
        if (profile_image_url !== undefined) updateData.profile_image_url = profile_image_url;
        
        // If password provided, hash it
        if (password) {
            const password_hash = await bcrypt.hash(password, 10);
            updateData.password_hash = password_hash;
        }
        
        await pool.query('UPDATE users SET ? WHERE id = ?', [updateData, userId]);
        
        res.json({ success: true, message: 'User updated successfully' });
    } catch (err) {
        console.error('Update user error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Delete user
app.delete('/api/users/:id', requirePermission('staff', 'delete'), async (req, res) => {
    try {
        const userId = req.params.id;
        
        // Check if user exists
        const [user] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
        if (user.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        // Don't allow deleting the last admin
        if (user[0].role === 'admin') {
            const [admins] = await pool.query('SELECT COUNT(*) as count FROM users WHERE role = "admin"');
            if (admins[0].count <= 1) {
                return res.status(400).json({ error: 'Cannot delete the last admin user' });
            }
        }
        
        // Delete user
        await pool.query('DELETE FROM users WHERE id = ?', [userId]);
        
        res.json({ success: true, message: 'User deleted successfully' });
    } catch (err) {
        console.error('Delete user error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Change password
app.post('/api/users/change-password', async (req, res) => {
    try {
        const { user_id, current_password, new_password } = req.body;
        
        // Get user
        const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [user_id]);
        if (users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        
        const user = users[0];
        
        // Verify current password
        const passwordMatch = await bcrypt.compare(current_password, user.password_hash);
        if (!passwordMatch) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }
        
        // Hash new password
        const new_password_hash = await bcrypt.hash(new_password, 10);
        
        // Update password
        await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [new_password_hash, user_id]);
        
        // Invalidate all sessions for this user
        await pool.query('DELETE FROM user_sessions WHERE user_id = ?', [user_id]);
        
        res.json({ success: true, message: 'Password changed successfully' });
    } catch (err) {
        console.error('Change password error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// CUSTOMER TYPES
// ========================================

// Get all customer types
app.get('/api/customer-types', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM customer_types ORDER BY name');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get single customer type
app.get('/api/customer-types/:id', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM customer_types WHERE id = ?', [req.params.id]);
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Customer type not found' });
        }
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create customer type
app.post('/api/customer-types', async (req, res) => {
    try {
        const { name, description, default_discount, status } = req.body;
        
        const [result] = await pool.query(
            'INSERT INTO customer_types (name, description, default_discount, status) VALUES (?, ?, ?, ?)',
            [name, description, default_discount || 0, status || 'active']
        );
        
        res.json({ success: true, id: result.insertId, message: 'Customer type created successfully' });
    } catch (err) {
        console.error('Create customer type error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Update customer type
app.put('/api/customer-types/:id', async (req, res) => {
    try {
        const { name, description, default_discount, status } = req.body;
        const typeId = req.params.id;
        
        await pool.query(
            'UPDATE customer_types SET name = ?, description = ?, default_discount = ?, status = ? WHERE id = ?',
            [name, description, default_discount, status, typeId]
        );
        
        res.json({ success: true, message: 'Customer type updated successfully' });
    } catch (err) {
        console.error('Update customer type error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Delete customer type
app.delete('/api/customer-types/:id', async (req, res) => {
    try {
        const typeId = req.params.id;
        
        // Check if any customers use this type
        const [customers] = await pool.query('SELECT COUNT(*) as count FROM customers WHERE customer_type_id = ?', [typeId]);
        if (customers[0].count > 0) {
            return res.status(400).json({ error: `Cannot delete: ${customers[0].count} customers are using this type` });
        }
        
        await pool.query('DELETE FROM customer_types WHERE id = ?', [typeId]);
        
        res.json({ success: true, message: 'Customer type deleted successfully' });
    } catch (err) {
        console.error('Delete customer type error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// PRODUCTS
// ========================================

app.get('/api/products', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT p.*, b.name as brand_name, c.name as category_name 
            FROM products p 
            LEFT JOIN brands b ON p.brand_id = b.id 
            LEFT JOIN categories c ON p.category_id = c.id 
            WHERE p.status = "active" 
            ORDER BY p.name
        `);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/products/:id', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM products WHERE id = ?', [req.params.id]);
        res.json(rows[0] || {});
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/products', requirePermission('products', 'add'), async (req, res) => {
    try {
        const { name, brand_id, category_id, product_type, description, gst_percentage, available_sizes, status } = req.body;
        
        // Insert product
        const [result] = await pool.query(
            'INSERT INTO products (name, brand_id, category_id, product_type, description, gst_percentage, base_price, available_sizes, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [name, brand_id, category_id, product_type, description || null, gst_percentage || 18, req.body.base_price || 0, available_sizes || null, status || 'active']
        );
        
        const productId = result.insertId;
        
        // Insert pack sizes if provided
        if (available_sizes) {
            try {
                const packSizes = JSON.parse(available_sizes);
                for (const pack of packSizes) {
                    await pool.query(
                        'INSERT INTO pack_sizes (product_id, size, unit, base_price, is_active) VALUES (?, ?, ?, ?, 1)',
                        [productId, pack.size, pack.unit || 'L', pack.base_price || pack.price]
                    );
                }
            } catch (e) {
                console.error('Error inserting pack sizes:', e);
            }
        }
        
        res.json({ success: true, id: productId });
    } catch (err) {
        console.error('Error creating product:', err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/products/:id', requirePermission('products', 'edit'), async (req, res) => {
    try {
        const { name, brand_id, category_id, product_type, description, gst_percentage, available_sizes, status } = req.body;
        
        // Update product
        await pool.query(
            'UPDATE products SET name = ?, brand_id = ?, category_id = ?, product_type = ?, description = ?, gst_percentage = ?, base_price = ?, available_sizes = ?, status = ? WHERE id = ?',
            [name, brand_id, category_id, product_type, description || null, gst_percentage || 18, req.body.base_price || 0, available_sizes || null, status || 'active', req.params.id]
        );
        
        // Delete old pack sizes and insert new ones
        await pool.query('DELETE FROM pack_sizes WHERE product_id = ?', [req.params.id]);
        
        if (available_sizes) {
            try {
                const packSizes = JSON.parse(available_sizes);
                for (const pack of packSizes) {
                    await pool.query(
                        'INSERT INTO pack_sizes (product_id, size, unit, base_price, is_active) VALUES (?, ?, ?, ?, 1)',
                        [req.params.id, pack.size, pack.unit || 'L', pack.base_price || pack.price]
                    );
                }
            } catch (e) {
                console.error('Error updating pack sizes:', e);
            }
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error('Error updating product:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/products/:id', requirePermission('products', 'delete'), async (req, res) => {
    try {
        await pool.query('UPDATE products SET status = "inactive" WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// CUSTOMERS
// ========================================

app.get('/api/customers', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM customers ORDER BY name');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/customers', requirePermission('customers', 'add'), async (req, res) => {
    try {
        const { name, phone, email, address, city, gst_number } = req.body;
        const [result] = await pool.query(
            'INSERT INTO customers (name, phone, email, address, city, gst_number, status) VALUES (?, ?, ?, ?, ?, ?, "approved")',
            [name, phone, email, address, city, gst_number]
        );
        res.json({ id: result.insertId });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// ESTIMATES
// ========================================

app.get('/api/estimates', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM estimates ORDER BY estimate_date DESC, id DESC');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/estimates/:id', async (req, res) => {
    try {
        const [estimate] = await pool.query('SELECT * FROM estimates WHERE id = ?', [req.params.id]);
        if (estimate.length === 0) {
            return res.status(404).json({ error: 'Estimate not found' });
        }
        
        const [items] = await pool.query(`
            SELECT ei.*, p.name as product_name, p.product_type 
            FROM estimate_items ei 
            LEFT JOIN products p ON ei.product_id = p.id 
            WHERE ei.estimate_id = ? 
            ORDER BY ei.display_order
        `, [req.params.id]);
        
        res.json({ ...estimate[0], items });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Create new estimate
app.post('/api/estimates', requirePermission('estimates', 'add'), async (req, res) => {
    try {
        const {
            customer_name,
            customer_phone,
            customer_address,
            estimate_date,
            valid_until,
            subtotal,
            gst_amount,
            grand_total,
            show_gst_breakdown,
            column_visibility,
            notes,
            status,
            items
        } = req.body;

        // Generate estimate number
        const datePrefix = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const [lastEstimate] = await pool.query(
            'SELECT estimate_number FROM estimates WHERE estimate_number LIKE ? ORDER BY id DESC LIMIT 1',
            [`EST${datePrefix}%`]
        );
        
        let estimateNumber;
        if (lastEstimate.length > 0) {
            const lastNum = parseInt(lastEstimate[0].estimate_number.slice(-4));
            estimateNumber = `EST${datePrefix}${String(lastNum + 1).padStart(4, '0')}`;
        } else {
            estimateNumber = `EST${datePrefix}0001`;
        }

        // Insert estimate
        const [result] = await pool.query(
            `INSERT INTO estimates (
                estimate_number, customer_name, customer_phone, customer_address,
                estimate_date, valid_until, subtotal, gst_amount, grand_total,
                show_gst_breakdown, column_visibility, notes, status, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                estimateNumber, customer_name, customer_phone, customer_address,
                estimate_date, valid_until, subtotal, gst_amount, grand_total,
                show_gst_breakdown ? 1 : 0, column_visibility, notes, status, 1
            ]
        );

        const estimateId = result.insertId;

        // Insert items
        if (items && items.length > 0) {
            const itemValues = items.map(item => [
                estimateId,
                item.product_id || null, // Save product_id from item
                item.item_description,
                item.quantity,
                item.area || null,
                item.mix_info || null,
                item.unit_price,
                item.breakdown_cost || null,
                item.color_cost || 0,
                item.line_total,
                item.display_order || 0
            ]);

            await pool.query(
                `INSERT INTO estimate_items (
                    estimate_id, product_id, item_description, quantity, area, mix_info,
                    unit_price, breakdown_cost, color_cost, line_total, display_order
                ) VALUES ?`,
                [itemValues]
            );
        }

        res.json({
            success: true,
            id: estimateId,
            estimate_number: estimateNumber,
            message: 'Estimate created successfully'
        });

    } catch (err) {
        console.error('Create estimate error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Update estimate
app.put('/api/estimates/:id', requirePermission('estimates', 'edit'), async (req, res) => {
    try {
        const estimateId = req.params.id;
        const {
            customer_name,
            customer_phone,
            customer_address,
            estimate_date,
            valid_until,
            subtotal,
            gst_amount,
            grand_total,
            show_gst_breakdown,
            column_visibility,
            notes,
            items
        } = req.body;

        console.log('Updating estimate:', estimateId);
        console.log('Data:', req.body);

        // Update estimate
        const updateResult = await pool.query(
            `UPDATE estimates SET
                customer_name = ?, customer_phone = ?, customer_address = ?,
                estimate_date = ?, valid_until = ?, subtotal = ?, gst_amount = ?,
                grand_total = ?, show_gst_breakdown = ?, column_visibility = ?, notes = ?,
                last_updated_at = NOW()
            WHERE id = ?`,
            [
                customer_name, customer_phone, customer_address || null,
                estimate_date, valid_until, subtotal, gst_amount, grand_total,
                show_gst_breakdown ? 1 : 0, column_visibility, notes || null, estimateId
            ]
        );
        
        console.log('Update result:', updateResult);

        // Delete existing items
        await pool.query('DELETE FROM estimate_items WHERE estimate_id = ?', [estimateId]);

        // Insert new items
        if (items && items.length > 0) {
            const itemValues = items.map(item => [
                estimateId,
                item.product_id || null, // Save product_id from item
                item.item_description,
                item.quantity,
                item.area || null,
                item.mix_info || null,
                item.unit_price,
                item.breakdown_cost || null,
                item.color_cost || 0,
                item.line_total,
                item.display_order || 0
            ]);

            await pool.query(
                `INSERT INTO estimate_items (
                    estimate_id, product_id, item_description, quantity, area, mix_info,
                    unit_price, breakdown_cost, color_cost, line_total, display_order
                ) VALUES ?`,
                [itemValues]
            );
        }

        res.json({
            success: true,
            message: 'Estimate updated successfully'
        });

    } catch (err) {
        console.error('Update estimate error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Get estimate items
app.get('/api/estimates/:id/items', async (req, res) => {
    try {
        const [items] = await pool.query(
            'SELECT * FROM estimate_items WHERE estimate_id = ? ORDER BY display_order',
            [req.params.id]
        );
        res.json(items);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update estimate status
app.patch('/api/estimates/:id/status', async (req, res) => {
    try {
        const { status, reason, notes } = req.body;
        const estimateId = req.params.id;
        
        // Get current estimate
        const [current] = await pool.query('SELECT status FROM estimates WHERE id = ?', [estimateId]);
        if (current.length === 0) {
            return res.status(404).json({ error: 'Estimate not found' });
        }
        
        const oldStatus = current[0].status;
        
        // Update estimate
        const updates = { status, last_updated_at: new Date() };
        
        if (status === 'approved') {
            updates.approved_by_admin_id = 1; // TODO: Get from auth token
            updates.approved_at = new Date();
        }
        
        await pool.query('UPDATE estimates SET ? WHERE id = ?', [updates, estimateId]);
        
        // Log status change
        await pool.query(
            'INSERT INTO estimate_status_history (estimate_id, old_status, new_status, changed_by_user_id, reason, notes) VALUES (?, ?, ?, ?, ?, ?)',
            [estimateId, oldStatus, status, 1, reason, notes]
        );
        
        // Log to audit
        await pool.query(
            'INSERT INTO audit_log (user_id, action, table_name, record_id, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)',
            [1, 'status_change', 'estimates', estimateId, JSON.stringify({status: oldStatus}), JSON.stringify({status})]
        );
        
        res.json({ success: true, message: 'Status updated successfully' });
    } catch (err) {
        console.error('Update status error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Delete estimate
app.delete('/api/estimates/:id', requirePermission('estimates', 'delete'), async (req, res) => {
    try {
        const estimateId = req.params.id;
        
        // Check if estimate exists
        const [estimate] = await pool.query('SELECT * FROM estimates WHERE id = ?', [estimateId]);
        if (estimate.length === 0) {
            return res.status(404).json({ error: 'Estimate not found' });
        }
        
        // Delete items first (foreign key constraint)
        await pool.query('DELETE FROM estimate_items WHERE estimate_id = ?', [estimateId]);
        
        // Delete estimate
        await pool.query('DELETE FROM estimates WHERE id = ?', [estimateId]);
        
        // Log to audit
        await pool.query(
            'INSERT INTO audit_log (user_id, action, table_name, record_id, old_value, new_value) VALUES (?, ?, ?, ?, ?, ?)',
            [1, 'delete', 'estimates', estimateId, JSON.stringify(estimate[0]), null]
        );
        
        res.json({ success: true, message: 'Estimate deleted successfully' });
    } catch (err) {
        console.error('Delete estimate error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Get estimate status history
app.get('/api/estimates/:id/history', async (req, res) => {
    try {
        const [history] = await pool.query(`
            SELECT h.*, u.full_name as changed_by_name
            FROM estimate_status_history h
            LEFT JOIN users u ON h.changed_by_user_id = u.id
            WHERE h.estimate_id = ?
            ORDER BY h.timestamp DESC
        `, [req.params.id]);
        
        res.json(history);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// CALCULATE ESTIMATE
// ========================================

app.post('/api/calculate', async (req, res) => {
    try {
        const { product_id, area, color_cost } = req.body;
        
        const [product] = await pool.query('SELECT * FROM products WHERE id = ?', [product_id]);
        if (!product[0]) return res.status(404).json({ error: 'Product not found' });
        
        const p = product[0];
        const sizes = JSON.parse(p.available_sizes).sort((a, b) => b - a);
        
        if (p.product_type === 'area_wise') {
            const totalLiters = area / p.area_coverage;
            let remaining = totalLiters;
            let mix = [];
            
            sizes.forEach(size => {
                const count = Math.floor(remaining / size);
                if (count > 0) {
                    const pricePerUnit = p.base_price * size;
                    mix.push({ size, count, price: pricePerUnit });
                    remaining -= count * size;
                }
            });
            
            const mixInfo = mix.map(m => `${m.count}x${m.size}L`).join(' + ');
            const breakdown = mix.map(m => `${m.count}x₹${m.price}`).join(' + ');
            const subtotal = mix.reduce((sum, m) => sum + (m.count * m.price), 0);
            const total = subtotal + (color_cost || 0);
            
            res.json({
                quantity: totalLiters.toFixed(2),
                area: area,
                mix_info: mixInfo,
                breakdown_cost: breakdown,
                color_cost: color_cost || 0,
                line_total: total
            });
        } else {
            res.json({
                quantity: 1,
                mix_info: '1 Nos',
                breakdown_cost: `₹${p.base_price} x 1`,
                color_cost: 0,
                line_total: p.base_price
            });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// HEALTH CHECK & ROOT
// ========================================

app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        service: 'QC Business Manager API'
    });
});

// ========================================
// ROLE & PERMISSION MANAGEMENT (Module 1)
// ========================================
const rolesRouter = require('./routes/roles');
app.use('/api/roles', rolesRouter);

app.get('/', (req, res) => {
    res.json({
        service: 'Quality Colors Business Manager API',
        version: '1.0.0',
        endpoints: {
            auth: '/api/auth/*',
            brands: '/api/brands',
            categories: '/api/categories', 
            products: '/api/products',
            customers: '/api/customers',
            estimates: '/api/estimates',
            roles: '/api/roles',
            test: '/api/test',
            health: '/health'
        }
    });
});

app.listen(process.env.PORT, () => {
    console.log(`API running on port ${process.env.PORT}`);
});
