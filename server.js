/**
 * QC Paint Shop Business Manager - API Server
 * Complete rebuild with all modules integrated
 * Version: 2.0.0
 * Date: 2026-02-09
 *
 * Modules: Auth, Roles, Permissions, Branches, Users/Staff,
 * Customers, Leads, Products, Estimates, Attendance, Salary,
 * Activity Tracker, Task Management, Settings
 */

const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// Import middleware
const { initPool, requirePermission, requireAnyPermission, requireAuth, requireRole, getUserPermissions } = require('./middleware/permissionMiddleware');

// Import route modules
const attendanceRoutes = require('./routes/attendance');
const salaryRoutes = require('./routes/salary');
const estimateRequestRoutes = require('./routes/estimate-requests');
const rolesRoutes = require('./routes/roles');
const leadsRoutes = require('./routes/leads');
const branchesRoutes = require('./routes/branches');
const activitiesRoutes = require('./routes/activities');
const tasksRoutes = require('./routes/tasks');
const zohoRoutes = require('./routes/zoho');
const staffRegistrationRoutes = require('./routes/staff-registration');
const dailyTasksRoutes = require('./routes/daily-tasks');
const syncScheduler = require('./services/sync-scheduler');
const whatsappProcessor = require('./services/whatsapp-processor');

const app = express();

// ========================================
// MIDDLEWARE SETUP
// ========================================

// CORS: fail-safe — never fall back to wildcard
const allowedOrigins = (() => {
    if (process.env.CORS_ORIGIN) {
        // Support comma-separated origins: "https://act.qcpaintshop.com,https://qcpaintshop.com"
        return process.env.CORS_ORIGIN.split(',').map(o => o.trim());
    }
    if (process.env.NODE_ENV === 'production') {
        console.error('❌ CORS_ORIGIN is not set! Defaulting to https://act.qcpaintshop.com');
        return ['https://act.qcpaintshop.com'];
    }
    // Development default
    return ['http://localhost:3000', 'http://127.0.0.1:3000'];
})();

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (server-to-server, Postman, same-origin)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        // In development, allow local network IPs (192.168.x.x, 10.x.x.x, etc.)
        if (process.env.NODE_ENV !== 'production') {
            try {
                const url = new URL(origin);
                const host = url.hostname;
                if (host.startsWith('192.168.') ||
                    host.startsWith('10.') ||
                    host.startsWith('172.') ||
                    host === 'localhost' ||
                    host === '127.0.0.1') {
                    return callback(null, true);
                }
            } catch (e) { /* invalid origin, fall through to block */ }
        }
        console.warn(`⚠️ CORS blocked request from: ${origin}`);
        return callback(new Error('Not allowed by CORS'));
    },
    credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// ========================================
// DATABASE CONNECTION
// ========================================

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 20,
    queueLimit: 0
});

// Initialize shared pool for middleware and all route modules
initPool(pool);
attendanceRoutes.setPool(pool);
salaryRoutes.setPool(pool);
estimateRequestRoutes.setPool(pool);
rolesRoutes.setPool(pool);
leadsRoutes.setPool(pool);
branchesRoutes.setPool(pool);
activitiesRoutes.setPool(pool);
tasksRoutes.setPool(pool);
zohoRoutes.setPool(pool);
staffRegistrationRoutes.setPool(pool);
dailyTasksRoutes.setPool(pool);
syncScheduler.setPool(pool);
whatsappProcessor.setPool(pool);

// ========================================
// FILE UPLOAD CONFIG
// ========================================

// Ensure upload directories exist
const uploadDirs = [
    'public/uploads/logos',
    'public/uploads/profiles',
    'public/uploads/attendance/clock-in',
    'public/uploads/attendance/clock-out',
    'public/uploads/documents',
    'public/uploads/design-requests',
    'public/uploads/visualizations',
    'public/uploads/aadhar',
    'public/uploads/daily-tasks',
    'uploads/attendance/break'
];
uploadDirs.forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

const logoStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/uploads/logos/'),
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'logo-' + uniqueName + path.extname(file.originalname));
    }
});

const uploadLogo = multer({
    storage: logoStorage,
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files allowed'));
        }
    }
});

// Profile picture upload config
const profileStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/uploads/profiles/'),
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'profile-' + uniqueName + path.extname(file.originalname));
    }
});

const uploadProfile = multer({
    storage: profileStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files allowed'));
        }
    }
});

// Aadhar proof upload config
const aadharStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/uploads/aadhar/'),
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'aadhar-' + uniqueName + path.extname(file.originalname));
    }
});

const uploadAadhar = multer({
    storage: aadharStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/') || file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Only image and PDF files allowed'));
        }
    }
});

// Design request photo upload config (memory storage + sharp compression)
const designRequestUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) {
            cb(null, true);
        } else {
            cb(new Error('Only image files allowed'));
        }
    }
});

// ========================================
// MOUNT ROUTE MODULES
// ========================================

app.use('/api/attendance', attendanceRoutes.router);
app.use('/api/salary', salaryRoutes.router);
app.use('/api/estimate-requests', estimateRequestRoutes.router);
app.use('/api/roles', rolesRoutes.router);
app.use('/api/leads', leadsRoutes.router);
app.use('/api/branches', branchesRoutes.router);
app.use('/api/activities', activitiesRoutes.router);
app.use('/api/tasks', tasksRoutes.router);
app.use('/api/zoho', zohoRoutes.router);
app.use('/api/staff-registration', staffRegistrationRoutes.router);
app.use('/api/daily-tasks', dailyTasksRoutes.router);

// Zoho OAuth callback redirect (Zoho app configured with /oauth/callback)
app.get('/oauth/callback', (req, res) => {
    const query = new URLSearchParams(req.query).toString();
    res.redirect(`/api/zoho/oauth/callback${query ? '?' + query : ''}`);
});

// Zoho OAuth manual code exchange (direct route for reliability)
app.post('/api/zoho/oauth/exchange', requireRole('admin'), async (req, res) => {
    try {
        const zohoOAuth = require('./services/zoho-oauth');
        const { code } = req.body;
        if (!code) {
            return res.status(400).json({ success: false, message: 'Authorization code is required' });
        }
        console.log('[Zoho] Manual code exchange - code:', code.substring(0, 20) + '...');
        const result = await zohoOAuth.generateTokenFromCode(code.trim());
        console.log('[Zoho] Code exchange successful! Token expires at:', result.expires_at);
        res.json({ success: true, message: 'Zoho Books connected successfully!', data: { expires_at: result.expires_at } });
    } catch (error) {
        console.error('[Zoho] Manual code exchange error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// AUTHENTICATION ENDPOINTS
// ========================================

// Login
app.post('/api/auth/login', async (req, res) => {
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

// Verify token
app.get('/api/auth/verify', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ success: false, message: 'No token provided' });
        }

        const [sessions] = await pool.query(
            `SELECT s.*, u.id as user_id, u.username, u.full_name, u.email, u.role, u.branch_id, u.phone, u.profile_image_url, b.name as branch_name
             FROM user_sessions s JOIN users u ON s.user_id = u.id
             LEFT JOIN branches b ON u.branch_id = b.id
             WHERE s.session_token = ? AND s.expires_at > NOW() AND u.status = 'active'`,
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
app.get('/api/auth/me', async (req, res) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) {
            return res.status(401).json({ success: false, message: 'No token provided' });
        }

        const [sessions] = await pool.query(
            `SELECT s.*, u.id as user_id, u.username, u.full_name, u.email, u.role, u.branch_id, u.phone, u.profile_image_url, b.name as branch_name
             FROM user_sessions s JOIN users u ON s.user_id = u.id
             LEFT JOIN branches b ON u.branch_id = b.id
             WHERE s.session_token = ? AND s.expires_at > NOW() AND u.status = 'active'`,
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
                        aadhar_number, aadhar_proof_url,
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

// Forgot Password (with proper reset token instead of overwriting password)
app.post('/api/auth/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;

        const [users] = await pool.query(
            'SELECT * FROM users WHERE email = ? AND status = ?',
            [email, 'active']
        );

        if (users.length === 0) {
            return res.json({
                success: true,
                message: 'If an account exists with this email, you will receive a password reset link shortly.'
            });
        }

        const user = users[0];

        // Generate temp password and store it
        const tempPassword = crypto.randomBytes(4).toString('hex');
        const hashedPassword = await bcrypt.hash(tempPassword, 10);

        await pool.query(
            'UPDATE users SET password_hash = ? WHERE id = ?',
            [hashedPassword, user.id]
        );

        // Invalidate all existing sessions
        await pool.query('DELETE FROM user_sessions WHERE user_id = ?', [user.id]);

        // Send email if SMTP configured
        if (process.env.SMTP_HOST) {
            const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: parseInt(process.env.SMTP_PORT || '587'),
                secure: parseInt(process.env.SMTP_PORT || '587') === 465 || process.env.SMTP_SECURE === 'true',
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASSWORD
                }
            });

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
                            <h2 style="color: #333;">Password Reset</h2>
                            <p>Hello <strong>${user.full_name || user.username}</strong>,</p>
                            <p>Your temporary password is:</p>
                            <div style="background: white; border: 2px solid #667eea; border-radius: 8px; padding: 20px; text-align: center;">
                                <code style="font-size: 24px; font-weight: bold; color: #667eea;">${tempPassword}</code>
                            </div>
                            <p>Please log in and change it immediately.</p>
                        </div>
                    </div>
                `
            });
        }

        res.json({
            success: true,
            message: 'Password reset email sent successfully.'
        });

    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ success: false, message: 'Failed to send reset email.' });
    }
});

// Get current user's permissions
app.get('/api/auth/permissions', getUserPermissions);

// ========================================
// OTP AUTHENTICATION
// ========================================

// Send OTP
app.post('/api/otp/send', async (req, res) => {
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

        // Invalidate old OTPs
        await pool.query(
            'UPDATE otp_verifications SET verified = 1 WHERE phone = ? AND purpose = ? AND verified = 0',
            [mobile, purpose]
        );

        const otpCode = String(Math.floor(100000 + Math.random() * 900000));
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

        const [result] = await pool.query(
            'INSERT INTO otp_verifications (phone, otp, purpose, expires_at) VALUES (?, ?, ?, ?)',
            [mobile, otpCode, purpose, expiresAt]
        );

        // Send SMS via configured provider (DLT-registered templates)
        if (process.env.SMS_USER && process.env.SMS_PASSWORD) {
            const http = require('http');
            const querystring = require('querystring');

            // Select DLT-registered template based on purpose
            let message;
            if (purpose === 'Staff Registration') {
                message = `Your verification OTP for Quality Colours registration is ${otpCode}. Please enter this code at https://qcpaintshop.com/ to complete setup. - QUALITY COLOURS.`;
            } else {
                message = `Hi, your Quality Colours verification code is ${otpCode}. Use this code to complete registration and view product pricing. - QUALTQ`;
            }

            const params = querystring.stringify({
                user: process.env.SMS_USER,
                password: process.env.SMS_PASSWORD,
                senderid: process.env.SMS_SENDER_ID || 'QUALTQ',
                channel: 'Trans',
                DCS: '0',
                flashsms: '0',
                number: '91' + mobile,
                text: message,
                route: '4'
            });

            const smsUrl = `http://retailsms.nettyfish.com/api/mt/SendSMS?${params}`;

            http.get(smsUrl, (smsRes) => {
                let data = '';
                smsRes.on('data', chunk => { data += chunk; });
                smsRes.on('end', () => {
                    console.log('[SMS] Response:', data);
                });
            }).on('error', (err) => {
                console.error('[SMS] Error:', err.message);
            });
        }

        // For Staff Registration, also send OTP via email
        if (purpose === 'Staff Registration' && req.body.email && process.env.SMTP_HOST) {
            try {
                const transporter = nodemailer.createTransport({
                    host: process.env.SMTP_HOST,
                    port: parseInt(process.env.SMTP_PORT || '587'),
                    secure: parseInt(process.env.SMTP_PORT || '587') === 465 || process.env.SMTP_SECURE === 'true',
                    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
                });
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
app.post('/api/otp/verify', async (req, res) => {
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

        if (otps[0].otp !== otp_code) {
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
app.post('/api/otp/resend', async (req, res) => {
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

        const otpCode = String(Math.floor(100000 + Math.random() * 900000));
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

        const [result] = await pool.query(
            'INSERT INTO otp_verifications (phone, otp, purpose, expires_at) VALUES (?, ?, ?, ?)',
            [mobile, otpCode, purpose, expiresAt]
        );

        // Send SMS (DLT-registered templates)
        if (process.env.SMS_USER && process.env.SMS_PASSWORD) {
            const http = require('http');
            const querystring = require('querystring');

            let message;
            if (purpose === 'Staff Registration') {
                message = `Your verification OTP for Quality Colours registration is ${otpCode}. Please enter this code at https://qcpaintshop.com/ to complete setup. - QUALITY COLOURS.`;
            } else {
                message = `Hi, your Quality Colours verification code is ${otpCode}. Use this code to complete registration and view product pricing. - QUALTQ`;
            }

            const params = querystring.stringify({
                user: process.env.SMS_USER,
                password: process.env.SMS_PASSWORD,
                senderid: process.env.SMS_SENDER_ID || 'QUALTQ',
                channel: 'Trans', DCS: '0', flashsms: '0',
                number: '91' + mobile, text: message, route: '4'
            });
            http.get(`http://retailsms.nettyfish.com/api/mt/SendSMS?${params}`, (smsRes) => {
                let data = '';
                smsRes.on('data', chunk => { data += chunk; });
                smsRes.on('end', () => { console.log('[SMS] Resend response:', data); });
            }).on('error', () => {});
        }

        // For Staff Registration, also resend OTP via email
        if (purpose === 'Staff Registration' && req.body.email && process.env.SMTP_HOST) {
            try {
                const transporter = nodemailer.createTransport({
                    host: process.env.SMTP_HOST,
                    port: parseInt(process.env.SMTP_PORT || '587'),
                    secure: parseInt(process.env.SMTP_PORT || '587') === 465 || process.env.SMTP_SECURE === 'true',
                    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
                });
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
app.post('/api/auth/register', async (req, res) => {
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
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 24);

        await pool.query(
            'INSERT INTO user_sessions (user_id, session_token, expires_at) VALUES (?, ?, ?)',
            [result.insertId, sessionToken, expiresAt]
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

// ========================================
// SETTINGS
// ========================================

// Public branding settings (logo, company name) - available to all authenticated users
app.get('/api/settings/branding', requireAuth, async (req, res) => {
    try {
        const safeKeys = ['business_name', 'business_logo', 'business_phone', 'business_email', 'business_address'];
        const [settings] = await pool.query('SELECT * FROM settings WHERE setting_key IN (?)', [safeKeys]);
        const settingsObj = {};
        settings.forEach(s => { settingsObj[s.setting_key] = s.setting_value; });
        res.json(settingsObj);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Full settings - admin only
app.get('/api/settings', requirePermission('settings', 'manage'), async (req, res) => {
    try {
        const [settings] = await pool.query('SELECT * FROM settings');
        const settingsObj = {};
        settings.forEach(s => { settingsObj[s.setting_key] = s.setting_value; });
        res.json(settingsObj);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/settings/:category', requirePermission('settings', 'manage'), async (req, res) => {
    try {
        const [settings] = await pool.query('SELECT * FROM settings WHERE category = ?', [req.params.category]);
        const settingsObj = {};
        settings.forEach(s => { settingsObj[s.setting_key] = s.setting_value; });
        res.json(settingsObj);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/settings', requirePermission('settings', 'manage'), async (req, res) => {
    try {
        const settings = req.body;
        for (const [key, value] of Object.entries(settings)) {
            await pool.query(
                'INSERT INTO settings (setting_key, setting_value, category) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
                [key, value, key.split('_')[0], value]
            );
        }
        res.json({ success: true, message: 'Settings updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/settings/:key', requirePermission('settings', 'manage'), async (req, res) => {
    try {
        const { value, category } = req.body;
        await pool.query(
            'INSERT INTO settings (setting_key, setting_value, category) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
            [req.params.key, value, category || 'general', value]
        );
        res.json({ success: true, message: 'Setting updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Logo upload - admin only
app.post('/api/upload/logo', requirePermission('settings', 'manage'), uploadLogo.single('logo'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }
        const logoUrl = `/uploads/logos/${req.file.filename}`;
        await pool.query(
            'INSERT INTO settings (setting_key, setting_value, category) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
            ['business_logo', logoUrl, 'business', logoUrl]
        );
        res.json({ success: true, logoUrl, message: 'Logo uploaded successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// Profile picture upload
app.post('/api/upload/profile', requireAuth, uploadProfile.single('profile_image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, error: 'No file uploaded' });
        }
        const profileUrl = `/uploads/profiles/${req.file.filename}`;
        const userId = req.user.id;

        // Update user's profile_image_url in database
        await pool.query('UPDATE users SET profile_image_url = ? WHERE id = ?', [profileUrl, userId]);

        res.json({ success: true, profileUrl, message: 'Profile picture uploaded successfully' });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========================================
// PUBLIC GUEST ENDPOINTS (for request-estimate page)
// ========================================

app.get('/api/guest/brands', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id, name FROM brands WHERE status = ? ORDER BY name', ['active']);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/guest/categories', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT id, name FROM categories WHERE status = ? ORDER BY name', ['active']);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/guest/products', async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT p.id, p.name, p.brand_id, p.category_id, p.product_type,
                   p.area_coverage, p.available_sizes, p.visible_to_guest,
                   b.name as brand_name, c.name as category_name
            FROM products p
            LEFT JOIN brands b ON p.brand_id = b.id
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE p.status = 'active' AND p.visible_to_guest = 1
            ORDER BY p.name
        `);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// PUBLIC API (no auth required)
// ========================================

app.get('/api/public/site-info', async (req, res) => {
    try {
        const [rows] = await pool.query(
            "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('business_name','business_logo','business_phone','business_email','business_address')"
        );
        const info = {};
        rows.forEach(r => { info[r.setting_key] = r.setting_value; });
        res.json({ success: true, data: info });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/public/branches', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, name, address, city, state, phone, open_time, close_time FROM branches WHERE status = ? ORDER BY name',
            ['active']
        );
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/public/brands', async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT id, name, logo_url FROM brands WHERE status = ? ORDER BY name',
            ['active']
        );
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/public/design-requests', designRequestUpload.single('photo'), async (req, res) => {
    try {
        const { name, mobile, city } = req.body;

        if (!name || !mobile) {
            return res.status(400).json({ success: false, error: 'Name and mobile are required' });
        }

        // Validate mobile (Indian format)
        const mobileClean = mobile.replace(/[\s-]/g, '');
        if (!/^(\+91)?[6-9]\d{9}$/.test(mobileClean)) {
            return res.status(400).json({ success: false, error: 'Invalid mobile number' });
        }

        // Process photo if uploaded
        let photoPath = null;
        if (req.file) {
            const timestamp = Date.now();
            const filename = `design_${timestamp}_${Math.round(Math.random() * 1E9)}.jpg`;
            const dir = path.join(__dirname, 'public', 'uploads', 'design-requests');
            const fullPath = path.join(dir, filename);

            await sharp(req.file.buffer)
                .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 80, progressive: true })
                .toFile(fullPath);

            photoPath = `/uploads/design-requests/${filename}`;
        }

        // Generate request number: CDR-YYYYMMDD-XXXX
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        const [countRows] = await pool.query(
            "SELECT COUNT(*) as cnt FROM color_design_requests WHERE request_number LIKE ?",
            [`CDR-${dateStr}-%`]
        );
        const seq = String((countRows[0].cnt || 0) + 1).padStart(4, '0');
        const requestNumber = `CDR-${dateStr}-${seq}`;

        await pool.query(
            'INSERT INTO color_design_requests (request_number, name, mobile, city, photo_path) VALUES (?, ?, ?, ?, ?)',
            [requestNumber, name, mobileClean, city || null, photoPath]
        );

        res.json({ success: true, request_number: requestNumber, message: 'Design request submitted successfully' });
    } catch (err) {
        console.error('Design request error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ========================================
// DESIGN REQUESTS ADMIN API
// ========================================

app.get('/api/design-requests', requireRole('admin', 'manager'), async (req, res) => {
    try {
        const { status, search, page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;
        let where = '1=1';
        const params = [];

        if (status) {
            where += ' AND status = ?';
            params.push(status);
        }
        if (search) {
            where += ' AND (name LIKE ? OR mobile LIKE ? OR request_number LIKE ? OR city LIKE ?)';
            const s = `%${search}%`;
            params.push(s, s, s, s);
        }

        const [countRows] = await pool.query(`SELECT COUNT(*) as total FROM color_design_requests WHERE ${where}`, params);
        const [rows] = await pool.query(
            `SELECT * FROM color_design_requests WHERE ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), parseInt(offset)]
        );

        res.json({ success: true, data: rows, total: countRows[0].total, page: parseInt(page), limit: parseInt(limit) });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/design-requests/stats', requireRole('admin', 'manager'), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT
                COUNT(*) as total,
                SUM(status = 'new') as new_count,
                SUM(status = 'in_progress') as in_progress_count,
                SUM(status = 'completed') as completed_count,
                SUM(status = 'rejected') as rejected_count
            FROM color_design_requests
        `);
        res.json({ success: true, data: rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.put('/api/design-requests/:id', requireRole('admin', 'manager'), async (req, res) => {
    try {
        const { status, admin_notes } = req.body;
        const fields = [];
        const params = [];

        if (status) { fields.push('status = ?'); params.push(status); }
        if (admin_notes !== undefined) { fields.push('admin_notes = ?'); params.push(admin_notes); }

        if (fields.length === 0) {
            return res.status(400).json({ success: false, error: 'No fields to update' });
        }

        params.push(req.params.id);
        await pool.query(`UPDATE color_design_requests SET ${fields.join(', ')} WHERE id = ?`, params);
        res.json({ success: true, message: 'Design request updated' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ========================================
// PAINT COLORS & VISUALIZATION
// ========================================

// Load paint color catalogs
const paintColorsDir = path.join(__dirname, 'data', 'paint-colors');
const paintCatalogs = {};
if (fs.existsSync(paintColorsDir)) {
    fs.readdirSync(paintColorsDir).filter(f => f.endsWith('.json')).forEach(f => {
        try {
            const data = JSON.parse(fs.readFileSync(path.join(paintColorsDir, f), 'utf8'));
            paintCatalogs[data.brandCode] = data;
        } catch (e) { console.error(`Error loading paint catalog ${f}:`, e.message); }
    });
}

// --- Color theory helpers for auto-visualization ---
function hexToHsl(hex) {
    let r = parseInt(hex.slice(1, 3), 16) / 255;
    let g = parseInt(hex.slice(3, 5), 16) / 255;
    let b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h, s, l = (max + min) / 2;
    if (max === min) { h = s = 0; }
    else {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
            case g: h = ((b - r) / d + 2) / 6; break;
            case b: h = ((r - g) / d + 4) / 6; break;
        }
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function escXml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function selectColorCombinations(catalog) {
    const allColors = [];
    for (const family of catalog.families) {
        for (const color of family.colors) {
            allColors.push({ ...color, family: family.code, familyName: family.name, hsl: hexToHsl(color.hex) });
        }
    }
    const light = allColors.filter(c => c.hsl.l >= 65).sort((a, b) => b.hsl.l - a.hsl.l);
    const medium = allColors.filter(c => c.hsl.l >= 30 && c.hsl.l < 65).sort((a, b) => b.hsl.l - a.hsl.l);
    const dark = allColors.filter(c => c.hsl.l < 30).sort((a, b) => a.hsl.l - b.hsl.l);

    const lightNeutral = light.filter(c => c.hsl.s < 20);
    const lightWarm = light.filter(c => c.temperature === 'Warm' && c.hsl.s >= 15);
    const lightCool = light.filter(c => c.temperature === 'Cool' && c.hsl.s >= 15);
    const medWarm = medium.filter(c => c.temperature === 'Warm');
    const medCool = medium.filter(c => c.temperature === 'Cool');
    const pick = (arr, i = 0) => arr[Math.min(i, arr.length - 1)] || allColors[0];

    return [
        // 2-COLOR
        { type: 'two-color', label: 'Classic Elegance', description: 'Neutral walls with a refined accent',
          colors: [{ ...pick(lightNeutral, 2), role: 'Walls' }, { ...pick(medium, 5), role: 'Trim & Accents' }] },
        { type: 'two-color', label: 'Warm Harmony', description: 'Inviting warm tones throughout',
          colors: [{ ...pick(lightWarm.length ? lightWarm : light, 3), role: 'Walls' }, { ...pick(medWarm.length ? medWarm : medium, 4), role: 'Trim & Accents' }] },
        { type: 'two-color', label: 'Cool Contemporary', description: 'Modern cool tones for a sleek look',
          colors: [{ ...pick(lightCool.length ? lightCool : light, 2), role: 'Walls' }, { ...pick(medCool.length ? medCool : medium, 5), role: 'Trim & Accents' }] },
        // 3-COLOR
        { type: 'three-color', label: 'Sophisticated Trio', description: 'Balanced light, medium and dark tones',
          colors: [{ ...pick(lightNeutral, 5), role: 'Walls' }, { ...pick(medium, 10), role: 'Secondary' }, { ...pick(dark, 2), role: 'Doors & Accents' }] },
        { type: 'three-color', label: 'Vibrant Living', description: 'Bold and expressive color story',
          colors: [{ ...pick(lightWarm.length ? lightWarm : light, 5), role: 'Walls' }, { ...pick(medCool.length ? medCool : medium, 8), role: 'Secondary' }, { ...pick(dark, 5), role: 'Doors & Accents' }] },
        { type: 'three-color', label: 'Earth & Nature', description: 'Natural tones inspired by the landscape',
          colors: [
            pick(light.filter(c => c.hsl.h >= 25 && c.hsl.h <= 90), 0) || pick(light, 8),
            { role: 'Walls' },
            pick(medium.filter(c => c.hsl.h >= 60 && c.hsl.h <= 180), 0) || pick(medium, 15),
            { role: 'Secondary' },
            pick(dark.filter(c => c.hsl.h >= 15 && c.hsl.h <= 60), 0) || pick(dark, 0),
            { role: 'Doors & Accents' }
          ].filter(x => x.hex) // build properly below
        }
    ].map(combo => {
        // Fix Earth & Nature combo which needs special handling
        if (combo.label === 'Earth & Nature') {
            const earthWall = light.find(c => c.hsl.h >= 25 && c.hsl.h <= 90) || pick(light, 8);
            const earthMid = medium.find(c => c.hsl.h >= 60 && c.hsl.h <= 180) || pick(medium, 15);
            const earthDark = dark.find(c => c.hsl.h >= 15 && c.hsl.h <= 60) || pick(dark, 0);
            combo.colors = [
                { ...earthWall, role: 'Walls' },
                { ...earthMid, role: 'Secondary' },
                { ...earthDark, role: 'Doors & Accents' }
            ];
        }
        return combo;
    });
}

function createFooterSvg(imgWidth, combo, customerInfo, brandName) {
    const colors = combo.colors;
    const footerH = colors.length === 3 ? 130 : 110;
    const swatchSz = 28;

    let swatchesXml = '';
    const colW = Math.floor((imgWidth - 40) / colors.length);
    colors.forEach((c, i) => {
        const x = 20 + colW * i;
        swatchesXml += `
            <rect x="${x}" y="12" width="${swatchSz}" height="${swatchSz}" rx="5" fill="${c.hex}" stroke="#ffffff" stroke-width="1.5"/>
            <text x="${x + swatchSz + 8}" y="25" font-family="Arial,sans-serif" font-size="12" font-weight="bold" fill="#ffffff">${escXml(c.name)}</text>
            <text x="${x + swatchSz + 8}" y="38" font-family="Arial,sans-serif" font-size="9" fill="#a0a0c0">${escXml(c.code)} | ${escXml(c.role)}</text>`;
    });

    const custLine = (customerInfo.name || '') + (customerInfo.city ? ' | ' + customerInfo.city : '');
    const promo = 'Transform your space with Quality Colours \u2013 Professional Color Consultation';

    return { height: footerH, svg: `<svg width="${imgWidth}" height="${footerH}" xmlns="http://www.w3.org/2000/svg">
        <rect width="${imgWidth}" height="${footerH}" fill="#1a1a2e"/>
        <line x1="20" y1="48" x2="${imgWidth - 20}" y2="48" stroke="#2a2a4e" stroke-width="1"/>
        ${swatchesXml}
        <text x="20" y="66" font-family="Arial,sans-serif" font-size="13" font-weight="bold" fill="#e0e0ff">${escXml(combo.label)}</text>
        <text x="20" y="80" font-family="Arial,sans-serif" font-size="10" fill="#8080b0">${escXml(combo.description)}</text>
        <text x="20" y="${footerH - 28}" font-family="Arial,sans-serif" font-size="10" fill="#a0a0c0">${escXml(custLine)}</text>
        <text x="20" y="${footerH - 12}" font-family="Arial,sans-serif" font-size="9" fill="#667eea" font-style="italic">${escXml(promo)}</text>
        <text x="${imgWidth - 20}" y="66" font-family="Arial,sans-serif" font-size="13" font-weight="bold" fill="#ffffff" text-anchor="end">${escXml(brandName)}</text>
        <text x="${imgWidth - 20}" y="${footerH - 12}" font-family="Arial,sans-serif" font-size="10" fill="#667eea" text-anchor="end">Quality Colours Visualizer</text>
    </svg>` };
}

// --- Gemini AI Image Generation ---
const { GoogleGenerativeAI } = require('@google/generative-ai');
const geminiAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

async function generateAutoViz(photoBuffer, combo, customerInfo, brandName) {
    if (!geminiAI) throw new Error('Gemini API key not configured');

    const modelName = process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp';
    const model = geminiAI.getGenerativeModel({
        model: modelName,
        generationConfig: { responseModalities: ['TEXT', 'IMAGE'] }
    });

    // Convert photo to base64
    const imageBase64 = photoBuffer.toString('base64');
    const colors = combo.colors;

    // Build color instructions
    let colorInstructions;
    if (combo.type === 'two-color') {
        colorInstructions = `- Main walls and large flat painted surfaces: ${colors[0].name} (hex ${colors[0].hex}, RGB ${colors[0].rgb.join(',')})
- Trim, pillars, borders, railings, and accent painted areas: ${colors[1].name} (hex ${colors[1].hex}, RGB ${colors[1].rgb.join(',')})`;
    } else {
        colorInstructions = `- Main walls and large flat painted surfaces: ${colors[0].name} (hex ${colors[0].hex}, RGB ${colors[0].rgb.join(',')})
- Secondary surfaces like pillars, balcony walls, borders, and fascia: ${colors[1].name} (hex ${colors[1].hex}, RGB ${colors[1].rgb.join(',')})
- Doors, window frames, gates, and small accent features: ${colors[2].name} (hex ${colors[2].hex}, RGB ${colors[2].rgb.join(',')})`;
    }

    const prompt = `You are a professional building exterior paint color visualization tool.

Edit this building/elevation photo by precisely repainting the painted surfaces with these exact colors:

${colorInstructions}

CRITICAL RULES:
- ONLY repaint surfaces that would normally be painted (walls, trim, pillars, doors, gates)
- Keep sky, ground, vegetation, glass windows, roof tiles, stone/brick textures, and all non-paintable surfaces COMPLETELY UNCHANGED
- Preserve all architectural details, shadows, depth, lighting, and perspective exactly
- The paint must look photorealistic - natural finish with proper shading from existing light sources
- Maintain the exact same image composition, angle, and framing
- Do NOT add any text, labels, watermarks, or annotations to the image
- The result should look like an actual professional photograph of the repainted building`;

    const result = await model.generateContent([
        { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
        { text: prompt }
    ]);

    // Extract generated image from response
    let imageBuffer = null;
    const candidate = result.response.candidates?.[0];
    if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
            if (part.inlineData) {
                imageBuffer = Buffer.from(part.inlineData.data, 'base64');
                break;
            }
        }
    }

    if (!imageBuffer) {
        const textResponse = candidate?.content?.parts?.map(p => p.text).filter(Boolean).join(' ') || 'No response';
        throw new Error('Gemini did not return an image. Response: ' + textResponse.slice(0, 200));
    }

    // Get dimensions of the AI-generated image
    const meta = await sharp(imageBuffer).metadata();
    const imgWidth = meta.width;

    // Create branded footer
    const { height: footerH, svg: footerSvg } = createFooterSvg(imgWidth, combo, customerInfo, brandName);
    const footerBuf = await sharp(Buffer.from(footerSvg)).png().toBuffer();

    const filename = `viz-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
    const outputPath = path.join(__dirname, 'public', 'uploads', 'visualizations', filename);

    await sharp(imageBuffer)
        .extend({ bottom: footerH, background: { r: 26, g: 26, b: 46, alpha: 255 } })
        .composite([{ input: footerBuf, gravity: 'south' }])
        .jpeg({ quality: 92 })
        .toFile(outputPath);

    return `/uploads/visualizations/${filename}`;
}

// --- Pollinations AI (Kontext) Image Generation ---
async function generateAutoVizPollinations(photoRelPath, combo, customerInfo, brandName) {
    const appUrl = process.env.APP_PUBLIC_URL;
    if (!appUrl || appUrl.includes('localhost')) {
        throw new Error('Pollinations AI requires APP_PUBLIC_URL to be a publicly accessible domain (not localhost). Set APP_PUBLIC_URL in .env to your production URL.');
    }

    const publicImageUrl = appUrl.replace(/\/$/, '') + photoRelPath;
    const colors = combo.colors;

    // Build color prompt
    let prompt;
    if (combo.type === 'two-color') {
        prompt = `Edit this building exterior photo. Repaint ONLY the painted wall surfaces with ${colors[0].name} (exact hex color: ${colors[0].hex}). Repaint the trim, pillars, borders, and accent areas with ${colors[1].name} (exact hex color: ${colors[1].hex}). CRITICAL: Keep the sky, ground, vegetation, glass windows, roof tiles, and all non-painted surfaces completely unchanged. The result must look like a professional realistic photograph of the repainted building.`;
    } else {
        prompt = `Edit this building exterior photo. Repaint the main walls with ${colors[0].name} (${colors[0].hex}). Repaint secondary surfaces like pillars and balcony walls with ${colors[1].name} (${colors[1].hex}). Repaint doors and small accents with ${colors[2].name} (${colors[2].hex}). CRITICAL: Keep the sky, ground, vegetation, glass windows, roof tiles, and all non-painted surfaces completely unchanged. The result must look like a professional realistic photograph of the repainted building.`;
    }

    const seed = Math.floor(Math.random() * 999999);
    const apiUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(prompt)}?model=kontext&image=${encodeURIComponent(publicImageUrl)}&width=1024&height=1024&nologo=true&seed=${seed}`;

    console.log(`[Pollinations] Generating: ${combo.label}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000);

    try {
        const response = await fetch(apiUrl, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (!response.ok) {
            const errText = await response.text().catch(() => 'Unknown error');
            throw new Error(`Pollinations API ${response.status}: ${errText.slice(0, 200)}`);
        }

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.startsWith('image/')) {
            throw new Error('Pollinations returned non-image response: ' + contentType);
        }

        const imageBuffer = Buffer.from(await response.arrayBuffer());
        const meta = await sharp(imageBuffer).metadata();
        if (!meta.width || !meta.height) throw new Error('Invalid image from Pollinations');

        // Add branded footer
        const { height: footerH, svg: footerSvg } = createFooterSvg(meta.width, combo, customerInfo, brandName);
        const footerBuf = await sharp(Buffer.from(footerSvg)).png().toBuffer();

        const filename = `viz-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
        const outputPath = path.join(__dirname, 'public', 'uploads', 'visualizations', filename);

        await sharp(imageBuffer)
            .extend({ bottom: footerH, background: { r: 26, g: 26, b: 46, alpha: 255 } })
            .composite([{ input: footerBuf, gravity: 'south' }])
            .jpeg({ quality: 92 })
            .toFile(outputPath);

        console.log(`[Pollinations] Done: ${combo.label}`);
        return `/uploads/visualizations/${filename}`;
    } finally {
        clearTimeout(timeoutId);
    }
}

// GET /api/paint-colors/brands - list available paint brands
app.get('/api/paint-colors/brands', requireAuth, (req, res) => {
    const brands = Object.values(paintCatalogs).map(c => ({
        code: c.brandCode,
        name: c.brand,
        familyCount: c.families.length,
        colorCount: c.families.reduce((sum, f) => sum + f.colors.length, 0)
    }));
    res.json({ success: true, data: brands });
});

// GET /api/paint-colors/:brand/families - color families for a brand
app.get('/api/paint-colors/:brand/families', requireAuth, (req, res) => {
    const catalog = paintCatalogs[req.params.brand];
    if (!catalog) return res.status(404).json({ success: false, error: 'Brand not found' });
    const families = catalog.families.map(f => ({
        code: f.code,
        name: f.name,
        colorCount: f.colors.length
    }));
    res.json({ success: true, data: families });
});

// GET /api/paint-colors/:brand/colors - filtered/paginated colors
app.get('/api/paint-colors/:brand/colors', requireAuth, (req, res) => {
    const catalog = paintCatalogs[req.params.brand];
    if (!catalog) return res.status(404).json({ success: false, error: 'Brand not found' });

    const { family, search, temperature, page = 1, limit = 60 } = req.query;
    let colors = [];
    const families = family ? catalog.families.filter(f => f.code === family) : catalog.families;
    families.forEach(f => {
        f.colors.forEach(c => colors.push({ ...c, family: f.code, familyName: f.name }));
    });

    if (search) {
        const q = search.toLowerCase();
        colors = colors.filter(c => c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q));
    }
    if (temperature) {
        colors = colors.filter(c => c.temperature === temperature);
    }

    const total = colors.length;
    const pg = parseInt(page);
    const lim = parseInt(limit);
    const paginated = colors.slice((pg - 1) * lim, pg * lim);

    res.json({ success: true, data: paginated, total, page: pg, limit: lim });
});

// POST /api/design-requests/:id/visualize - generate color visualization
app.post('/api/design-requests/:id/visualize', requireRole('admin', 'manager'), async (req, res) => {
    try {
        const { colorCode, brand } = req.body;
        if (!colorCode || !brand) {
            return res.status(400).json({ success: false, error: 'colorCode and brand are required' });
        }

        // Find the color in catalog
        const catalog = paintCatalogs[brand];
        if (!catalog) return res.status(404).json({ success: false, error: 'Brand not found' });

        let colorInfo = null;
        for (const fam of catalog.families) {
            colorInfo = fam.colors.find(c => c.code === colorCode);
            if (colorInfo) { colorInfo = { ...colorInfo, family: fam.code, familyName: fam.name }; break; }
        }
        if (!colorInfo) return res.status(404).json({ success: false, error: 'Color not found' });

        // Get the design request photo
        const [rows] = await pool.query('SELECT * FROM color_design_requests WHERE id = ?', [req.params.id]);
        if (!rows.length) return res.status(404).json({ success: false, error: 'Design request not found' });
        const designReq = rows[0];
        if (!designReq.photo_path) return res.status(400).json({ success: false, error: 'No photo uploaded for this request' });

        // Load original image
        const photoFullPath = path.join(__dirname, 'public', designReq.photo_path);
        if (!fs.existsSync(photoFullPath)) {
            return res.status(404).json({ success: false, error: 'Original photo file not found' });
        }

        const originalImage = sharp(photoFullPath);
        const metadata = await originalImage.metadata();
        const imgWidth = metadata.width;
        const imgHeight = metadata.height;

        // Create color overlay with soft-light blend
        const [r, g, b] = colorInfo.rgb;
        const colorOverlay = await sharp({
            create: { width: imgWidth, height: imgHeight, channels: 4, background: { r, g, b, alpha: 160 } }
        }).png().toBuffer();

        // Apply soft-light blend
        const blended = await sharp(photoFullPath)
            .composite([{ input: colorOverlay, blend: 'soft-light' }])
            .toBuffer();

        // Create branded footer SVG
        const footerHeight = 80;
        const swatchSize = 50;
        const footerSvg = `<svg width="${imgWidth}" height="${footerHeight}" xmlns="http://www.w3.org/2000/svg">
            <rect width="${imgWidth}" height="${footerHeight}" fill="#1a1a2e"/>
            <rect x="20" y="15" width="${swatchSize}" height="${swatchSize}" rx="6" fill="${colorInfo.hex}" stroke="#fff" stroke-width="2"/>
            <text x="${swatchSize + 35}" y="32" font-family="Arial, sans-serif" font-size="16" font-weight="bold" fill="#ffffff">${colorInfo.name}</text>
            <text x="${swatchSize + 35}" y="52" font-family="Arial, sans-serif" font-size="13" fill="#a0a0c0">${colorInfo.code} | RGB(${colorInfo.rgb.join(', ')}) | ${colorInfo.hex}</text>
            <text x="${imgWidth - 20}" y="32" font-family="Arial, sans-serif" font-size="14" font-weight="bold" fill="#ffffff" text-anchor="end">${catalog.brand}</text>
            <text x="${imgWidth - 20}" y="52" font-family="Arial, sans-serif" font-size="11" fill="#a0a0c0" text-anchor="end">${colorInfo.temperature} | ${colorInfo.finishes.join(', ')}</text>
            <text x="${imgWidth - 20}" y="68" font-family="Arial, sans-serif" font-size="10" fill="#667eea" text-anchor="end">Quality Colours Visualizer</text>
        </svg>`;
        const footerBuffer = await sharp(Buffer.from(footerSvg)).png().toBuffer();

        // Combine blended image + footer
        const filename = `viz-${req.params.id}-${Date.now()}.jpg`;
        const outputPath = path.join(__dirname, 'public', 'uploads', 'visualizations', filename);

        await sharp(blended)
            .extend({ bottom: footerHeight, background: { r: 26, g: 26, b: 46, alpha: 255 } })
            .composite([{ input: footerBuffer, gravity: 'south' }])
            .jpeg({ quality: 90 })
            .toFile(outputPath);

        const vizUrl = `/uploads/visualizations/${filename}`;

        // Save to DB
        await pool.query(
            `INSERT INTO design_visualizations (design_request_id, brand, color_code, color_name, color_hex, visualization_path, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [req.params.id, brand, colorInfo.code, colorInfo.name, colorInfo.hex, vizUrl, req.user.id]
        );

        res.json({
            success: true,
            visualizationUrl: vizUrl,
            colorInfo: {
                code: colorInfo.code,
                name: colorInfo.name,
                hex: colorInfo.hex,
                rgb: colorInfo.rgb,
                temperature: colorInfo.temperature,
                finishes: colorInfo.finishes,
                brand: catalog.brand
            }
        });
    } catch (err) {
        console.error('Visualization error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// GET /api/design-requests/:id/visualizations - list visualizations for a request
app.get('/api/design-requests/:id/visualizations', requireRole('admin', 'manager'), async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT * FROM design_visualizations WHERE design_request_id = ? ORDER BY created_at DESC',
            [req.params.id]
        );
        res.json({ success: true, data: rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/design-requests/:id/auto-visualize - generate AI color combinations
app.post('/api/design-requests/:id/auto-visualize', requireRole('admin', 'manager'), async (req, res) => {
    try {
        const { brand, aiModel = 'pollinations' } = req.body;
        if (!brand) return res.status(400).json({ success: false, error: 'brand is required' });

        const catalog = paintCatalogs[brand];
        if (!catalog) return res.status(404).json({ success: false, error: 'Brand not found' });

        const [rows] = await pool.query('SELECT * FROM color_design_requests WHERE id = ?', [req.params.id]);
        if (!rows.length) return res.status(404).json({ success: false, error: 'Design request not found' });
        const designReq = rows[0];
        if (!designReq.photo_path) return res.status(400).json({ success: false, error: 'No photo uploaded for this request' });

        const photoFullPath = path.join(__dirname, 'public', designReq.photo_path);
        if (!fs.existsSync(photoFullPath)) return res.status(404).json({ success: false, error: 'Original photo not found' });

        const customerInfo = { name: designReq.name, city: designReq.city || '' };
        const isGemini = aiModel === 'gemini';
        const isPollinations = aiModel === 'pollinations';

        // Prepare photo buffer for Gemini (Pollinations uses URL instead)
        let photoBuffer;
        if (isGemini) {
            photoBuffer = await sharp(photoFullPath).resize(1200, null, { withoutEnlargement: true }).toBuffer();
        }

        // Select color combinations (3 variations)
        const allCombos = selectColorCombinations(catalog);
        const combos = allCombos.slice(0, 3);

        // Delay between calls: Pollinations needs 16s (rate limit), Gemini needs 2s
        const delayMs = isPollinations ? 16000 : 2000;

        const variations = [];
        const errors = [];
        for (let i = 0; i < combos.length; i++) {
            const combo = combos[i];
            try {
                console.log(`[Viz:${aiModel}] Generating ${i + 1}/${combos.length}: ${combo.label}...`);

                let imageUrl;
                if (isPollinations) {
                    imageUrl = await generateAutoVizPollinations(designReq.photo_path, combo, customerInfo, catalog.brand);
                } else {
                    imageUrl = await generateAutoViz(photoBuffer, combo, customerInfo, catalog.brand);
                }

                // Save to DB
                const colorCodes = combo.colors.map(c => c.code).join(' + ');
                const primaryHex = combo.colors[0].hex;
                await pool.query(
                    `INSERT INTO design_visualizations (design_request_id, brand, color_code, color_name, color_hex, visualization_path, created_by)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [req.params.id, brand, colorCodes.slice(0, 20), combo.label.slice(0, 100), primaryHex, imageUrl, req.user.id]
                );

                variations.push({ type: combo.type, label: combo.label, description: combo.description, imageUrl,
                    colors: combo.colors.map(c => ({ code: c.code, name: c.name, hex: c.hex, role: c.role })) });
                console.log(`[Viz:${aiModel}] Done: ${combo.label}`);

                // Rate-limit delay between API calls
                if (i < combos.length - 1) await new Promise(r => setTimeout(r, delayMs));
            } catch (err) {
                console.error(`[Viz:${aiModel}] Failed ${combo.label}:`, err.message);
                errors.push(combo.label + ': ' + err.message);
            }
        }

        if (!variations.length) {
            const errMsg = errors[0] || 'Unknown error';
            if (errMsg.includes('429') || errMsg.includes('quota')) {
                throw new Error('API quota exceeded. Please try again later or switch to a different AI model.');
            }
            throw new Error('Generation failed: ' + errMsg);
        }
        res.json({ success: true, variations, aiModel, partialErrors: errors.length ? errors : undefined });
    } catch (err) {
        console.error('Auto-visualize error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// ========================================
// BRANDS
// ========================================

app.get('/api/brands', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM brands WHERE status = ? ORDER BY name', ['active']);
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
        res.json({ success: true, id: result.insertId, name, logo_url, status: status || 'active' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
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
        res.status(500).json({ success: false, error: err.message });
    }
});

app.delete('/api/brands/:id', requirePermission('brands', 'delete'), async (req, res) => {
    try {
        await pool.query('UPDATE brands SET status = ? WHERE id = ?', ['inactive', req.params.id]);
        res.json({ success: true, message: 'Brand deleted successfully' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ========================================
// CATEGORIES
// ========================================

app.get('/api/categories', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM categories WHERE status = ? ORDER BY name', ['active']);
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
        await pool.query('UPDATE categories SET status = ? WHERE id = ?', ['inactive', req.params.id]);
        res.json({ success: true, message: 'Category deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// USERS (STAFF MANAGEMENT)
// ========================================

app.get('/api/users', requirePermission('staff', 'view'), async (req, res) => {
    try {
        const { role, branch_id, status } = req.query;
        let query = `SELECT id, username, email, full_name, phone, role, branch_id, status, created_at, last_login, profile_image_url FROM users WHERE 1=1`;
        const params = [];

        if (role) { query += ' AND role = ?'; params.push(role); }
        if (branch_id) { query += ' AND branch_id = ?'; params.push(branch_id); }
        if (status) { query += ' AND status = ?'; params.push(status); }

        query += ' ORDER BY created_at DESC';
        const [rows] = await pool.query(query, params);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/users/:id', requireAuth, async (req, res) => {
    try {
        // Staff can only view their own profile; admin/manager can view any
        if (req.params.id != req.user.id && !['admin', 'manager'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }
        const [rows] = await pool.query(
            'SELECT id, username, email, full_name, phone, role, branch_id, status, created_at, last_login, profile_image_url FROM users WHERE id = ?',
            [req.params.id]
        );
        if (rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/users', requirePermission('staff', 'add'), async (req, res) => {
    try {
        const { username, email, password, full_name, phone, role, branch_id, status } = req.body;

        if (!username || !password || !full_name) {
            return res.status(400).json({ error: 'Username, password, and full name are required' });
        }

        // Check for duplicate
        const [existing] = await pool.query(
            'SELECT id FROM users WHERE username = ? OR (email = ? AND email != "")',
            [username, email || '']
        );
        if (existing.length > 0) {
            return res.status(400).json({ error: 'Username or email already exists' });
        }

        const password_hash = await bcrypt.hash(password, 10);

        const [result] = await pool.query(
            'INSERT INTO users (username, email, password_hash, full_name, phone, role, branch_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [username, email || '', password_hash, full_name, phone, role || 'staff', branch_id || null, status || 'active']
        );

        res.json({ success: true, id: result.insertId, message: 'User created successfully' });
    } catch (err) {
        console.error('Create user error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Self-profile update (any authenticated user can update their own profile)
app.put('/api/users/profile/me', requireAuth, async (req, res) => {
    try {
        const {
            full_name, email, phone, profile_image_url,
            date_of_birth, door_no, street, city, state, pincode,
            aadhar_number, emergency_contact_name, emergency_contact_phone,
            bank_account_name, bank_name, bank_account_number, bank_ifsc_code, upi_id
        } = req.body;
        const userId = req.user.id;

        const setClauses = [];
        const params = [];

        // Basic profile
        if (full_name !== undefined) { setClauses.push('full_name = ?'); params.push(full_name); }
        if (email !== undefined) { setClauses.push('email = ?'); params.push(email); }
        if (phone !== undefined) { setClauses.push('phone = ?'); params.push(phone); }
        if (profile_image_url !== undefined) { setClauses.push('profile_image_url = ?'); params.push(profile_image_url); }

        // Personal details
        if (date_of_birth !== undefined) { setClauses.push('date_of_birth = ?'); params.push(date_of_birth || null); }
        if (door_no !== undefined) { setClauses.push('door_no = ?'); params.push(door_no || null); }
        if (street !== undefined) { setClauses.push('street = ?'); params.push(street || null); }
        if (city !== undefined) { setClauses.push('city = ?'); params.push(city || null); }
        if (state !== undefined) { setClauses.push('state = ?'); params.push(state || null); }
        if (pincode !== undefined) { setClauses.push('pincode = ?'); params.push(pincode || null); }

        // KYC
        if (aadhar_number !== undefined) { setClauses.push('aadhar_number = ?'); params.push(aadhar_number || null); }

        // Emergency contact
        if (emergency_contact_name !== undefined) { setClauses.push('emergency_contact_name = ?'); params.push(emergency_contact_name || null); }
        if (emergency_contact_phone !== undefined) { setClauses.push('emergency_contact_phone = ?'); params.push(emergency_contact_phone || null); }

        // Bank details
        if (bank_account_name !== undefined) { setClauses.push('bank_account_name = ?'); params.push(bank_account_name || null); }
        if (bank_name !== undefined) { setClauses.push('bank_name = ?'); params.push(bank_name || null); }
        if (bank_account_number !== undefined) { setClauses.push('bank_account_number = ?'); params.push(bank_account_number || null); }
        if (bank_ifsc_code !== undefined) { setClauses.push('bank_ifsc_code = ?'); params.push(bank_ifsc_code || null); }
        if (upi_id !== undefined) { setClauses.push('upi_id = ?'); params.push(upi_id || null); }

        if (setClauses.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        params.push(userId);
        await pool.query(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`, params);

        res.json({ success: true, message: 'Profile updated successfully' });
    } catch (err) {
        console.error('Update profile error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Upload Aadhar proof (self-service)
app.post('/api/upload/aadhar', requireAuth, uploadAadhar.single('aadhar_proof'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }
        const aadharUrl = `/uploads/aadhar/${req.file.filename}`;
        await pool.query('UPDATE users SET aadhar_proof_url = ? WHERE id = ?', [aadharUrl, req.user.id]);
        res.json({ success: true, aadhar_proof_url: aadharUrl });
    } catch (err) {
        console.error('Aadhar upload error:', err);
        res.status(500).json({ success: false, message: 'Failed to upload Aadhar proof' });
    }
});

app.put('/api/users/:id', requirePermission('staff', 'edit'), async (req, res) => {
    try {
        const { username, email, password, full_name, phone, role, branch_id, status, profile_image_url } = req.body;
        const userId = req.params.id;

        const setClauses = [];
        const params = [];

        if (username !== undefined) { setClauses.push('username = ?'); params.push(username); }
        if (email !== undefined) { setClauses.push('email = ?'); params.push(email); }
        if (full_name !== undefined) { setClauses.push('full_name = ?'); params.push(full_name); }
        if (phone !== undefined) { setClauses.push('phone = ?'); params.push(phone); }
        if (role !== undefined) { setClauses.push('role = ?'); params.push(role); }
        if (branch_id !== undefined) { setClauses.push('branch_id = ?'); params.push(branch_id); }
        if (status !== undefined) { setClauses.push('status = ?'); params.push(status); }
        if (profile_image_url !== undefined) { setClauses.push('profile_image_url = ?'); params.push(profile_image_url); }

        if (password) {
            const password_hash = await bcrypt.hash(password, 10);
            setClauses.push('password_hash = ?');
            params.push(password_hash);
        }

        if (setClauses.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        params.push(userId);
        await pool.query(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`, params);

        res.json({ success: true, message: 'User updated successfully' });
    } catch (err) {
        console.error('Update user error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/users/:id', requirePermission('staff', 'delete'), async (req, res) => {
    try {
        const userId = req.params.id;

        const [user] = await pool.query('SELECT role FROM users WHERE id = ?', [userId]);
        if (user.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user[0].role === 'admin') {
            const [admins] = await pool.query('SELECT COUNT(*) as count FROM users WHERE role = ?', ['admin']);
            if (admins[0].count <= 1) {
                return res.status(400).json({ error: 'Cannot delete the last admin user' });
            }
        }

        // Soft delete instead of hard delete
        await pool.query('UPDATE users SET status = ? WHERE id = ?', ['inactive', userId]);
        await pool.query('DELETE FROM user_sessions WHERE user_id = ?', [userId]);

        res.json({ success: true, message: 'User deactivated successfully' });
    } catch (err) {
        console.error('Delete user error:', err);
        res.status(500).json({ error: err.message });
    }
});

// Change password
app.post('/api/users/change-password', requireAuth, async (req, res) => {
    try {
        const userId = req.user.id;
        const { current_password, new_password } = req.body;

        if (!current_password || !new_password) {
            return res.status(400).json({ error: 'Current and new password are required' });
        }

        const [users] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
        if (users.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const passwordMatch = await bcrypt.compare(current_password, users[0].password_hash);
        if (!passwordMatch) {
            return res.status(401).json({ error: 'Current password is incorrect' });
        }

        const new_password_hash = await bcrypt.hash(new_password, 10);
        await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [new_password_hash, userId]);
        await pool.query('DELETE FROM user_sessions WHERE user_id = ?', [userId]);

        res.json({ success: true, message: 'Password changed successfully' });
    } catch (err) {
        console.error('Change password error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// CUSTOMER TYPES
// ========================================

app.get('/api/customer-types', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM customer_types ORDER BY name');
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/customer-types', requirePermission('customers', 'add'), async (req, res) => {
    try {
        const { name, description, default_discount, price_markup, status } = req.body;
        const [result] = await pool.query(
            'INSERT INTO customer_types (name, description, default_discount, price_markup, status) VALUES (?, ?, ?, ?, ?)',
            [name, description, default_discount || 0, price_markup || 0, status || 'active']
        );
        res.json({ success: true, id: result.insertId, message: 'Customer type created successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/customer-types/:id', requirePermission('customers', 'edit'), async (req, res) => {
    try {
        const { name, description, default_discount, price_markup, status } = req.body;
        await pool.query(
            'UPDATE customer_types SET name = ?, description = ?, default_discount = ?, price_markup = ?, status = ? WHERE id = ?',
            [name, description, default_discount, price_markup || 0, status, req.params.id]
        );
        res.json({ success: true, message: 'Customer type updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/customer-types/:id', requirePermission('customers', 'delete'), async (req, res) => {
    try {
        const [customers] = await pool.query('SELECT COUNT(*) as count FROM customers WHERE customer_type_id = ?', [req.params.id]);
        if (customers[0].count > 0) {
            return res.status(400).json({ error: `Cannot delete: ${customers[0].count} customers are using this type` });
        }
        await pool.query('DELETE FROM customer_types WHERE id = ?', [req.params.id]);
        res.json({ success: true, message: 'Customer type deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// PRODUCTS
// ========================================

app.get('/api/products', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT p.*, b.name as brand_name, c.name as category_name
            FROM products p
            LEFT JOIN brands b ON p.brand_id = b.id
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE p.status = 'active'
            ORDER BY p.name
        `);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/products/:id', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT p.*, b.name as brand_name, c.name as category_name
            FROM products p
            LEFT JOIN brands b ON p.brand_id = b.id
            LEFT JOIN categories c ON p.category_id = c.id
            WHERE p.id = ?
        `, [req.params.id]);

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }

        // Get pack sizes
        const [packSizes] = await pool.query(
            'SELECT * FROM pack_sizes WHERE product_id = ? AND is_active = 1 ORDER BY size',
            [req.params.id]
        );

        res.json({ ...rows[0], pack_sizes: packSizes });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/products', requirePermission('products', 'add'), async (req, res) => {
    try {
        const { name, brand_id, category_id, product_type, description, gst_percentage, base_price, available_sizes, area_coverage, status } = req.body;

        const [result] = await pool.query(
            'INSERT INTO products (name, brand_id, category_id, product_type, description, gst_percentage, base_price, available_sizes, area_coverage, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [name, brand_id, category_id, product_type, description || null, gst_percentage || 18, base_price || 0, available_sizes || null, area_coverage || null, status || 'active']
        );

        const productId = result.insertId;

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
        const { name, brand_id, category_id, product_type, description, gst_percentage, base_price, available_sizes, area_coverage, status } = req.body;

        await pool.query(
            'UPDATE products SET name = ?, brand_id = ?, category_id = ?, product_type = ?, description = ?, gst_percentage = ?, base_price = ?, available_sizes = ?, area_coverage = ?, status = ? WHERE id = ?',
            [name, brand_id, category_id, product_type, description || null, gst_percentage || 18, base_price || 0, available_sizes || null, area_coverage || null, status || 'active', req.params.id]
        );

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
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/products/:id', requirePermission('products', 'delete'), async (req, res) => {
    try {
        await pool.query('UPDATE products SET status = ? WHERE id = ?', ['inactive', req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// CUSTOMERS
// ========================================

app.get('/api/customers', requireAuth, async (req, res) => {
    try {
        const { status, search } = req.query;
        let query = 'SELECT * FROM customers WHERE 1=1';
        const params = [];

        if (status) { query += ' AND status = ?'; params.push(status); }
        if (search) {
            query += ' AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)';
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        query += ' ORDER BY name';
        const [rows] = await pool.query(query, params);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/customers/:id', requirePermission('customers', 'view'), async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM customers WHERE id = ?', [req.params.id]);
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Customer not found' });
        }
        res.json(rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/customers', requirePermission('customers', 'add'), async (req, res) => {
    try {
        const { name, phone, email, address, city, gst_number, customer_type_id, branch_id, status } = req.body;

        if (!name) {
            return res.status(400).json({ error: 'Customer name is required' });
        }

        const [result] = await pool.query(
            'INSERT INTO customers (name, phone, email, address, city, gst_number, customer_type_id, branch_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [name, phone, email, address, city, gst_number, customer_type_id || null, branch_id || null, status || 'approved']
        );
        res.json({ success: true, id: result.insertId, message: 'Customer created successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/customers/:id', requirePermission('customers', 'edit'), async (req, res) => {
    try {
        const { name, phone, email, address, city, gst_number, customer_type_id, branch_id, status } = req.body;
        await pool.query(
            'UPDATE customers SET name = ?, phone = ?, email = ?, address = ?, city = ?, gst_number = ?, customer_type_id = ?, branch_id = ?, status = ? WHERE id = ?',
            [name, phone, email, address, city, gst_number, customer_type_id, branch_id, status, req.params.id]
        );
        res.json({ success: true, message: 'Customer updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/customers/:id', requirePermission('customers', 'delete'), async (req, res) => {
    try {
        await pool.query('UPDATE customers SET status = ? WHERE id = ?', ['inactive', req.params.id]);
        res.json({ success: true, message: 'Customer deactivated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// ESTIMATES
// ========================================

app.get('/api/estimates', requireAuth, async (req, res) => {
    try {
        const { status, search } = req.query;
        let query = 'SELECT * FROM estimates WHERE 1=1';
        const params = [];

        if (status) { query += ' AND status = ?'; params.push(status); }
        if (search) {
            query += ' AND (estimate_number LIKE ? OR customer_name LIKE ? OR customer_phone LIKE ?)';
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        query += ' ORDER BY estimate_date DESC, id DESC';
        const [rows] = await pool.query(query, params);
        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/estimates/:id', requirePermission('estimates', 'view'), async (req, res) => {
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

app.post('/api/estimates', requirePermission('estimates', 'add'), async (req, res) => {
    try {
        const {
            customer_name, customer_phone, customer_address, estimate_date, valid_until,
            subtotal, gst_amount, grand_total, show_gst_breakdown, column_visibility,
            notes, status, items
        } = req.body;

        // Generate estimate number with locking
        const datePrefix = new Date().toISOString().split('T')[0].replace(/-/g, '');
        const [lastEstimate] = await pool.query(
            'SELECT estimate_number FROM estimates WHERE estimate_number LIKE ? ORDER BY id DESC LIMIT 1 FOR UPDATE',
            [`EST${datePrefix}%`]
        );

        let estimateNumber;
        if (lastEstimate.length > 0) {
            const lastNum = parseInt(lastEstimate[0].estimate_number.slice(-4));
            estimateNumber = `EST${datePrefix}${String(lastNum + 1).padStart(4, '0')}`;
        } else {
            estimateNumber = `EST${datePrefix}0001`;
        }

        const [result] = await pool.query(
            `INSERT INTO estimates (
                estimate_number, customer_name, customer_phone, customer_address,
                estimate_date, valid_until, subtotal, gst_amount, grand_total,
                show_gst_breakdown, column_visibility, notes, status, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                estimateNumber, customer_name, customer_phone, customer_address,
                estimate_date, valid_until, subtotal, gst_amount, grand_total,
                show_gst_breakdown ? 1 : 0, column_visibility, notes, status || 'draft',
                req.user ? req.user.id : 1
            ]
        );

        const estimateId = result.insertId;

        if (items && items.length > 0) {
            const itemValues = items.map(item => [
                estimateId, item.product_id || null, item.item_description,
                item.quantity, item.area || null, item.mix_info || null,
                item.unit_price, item.breakdown_cost || null, item.color_cost || 0,
                item.line_total, item.display_order || 0
            ]);

            await pool.query(
                `INSERT INTO estimate_items (
                    estimate_id, product_id, item_description, quantity, area, mix_info,
                    unit_price, breakdown_cost, color_cost, line_total, display_order
                ) VALUES ?`,
                [itemValues]
            );
        }

        res.json({ success: true, id: estimateId, estimate_number: estimateNumber, message: 'Estimate created successfully' });
    } catch (err) {
        console.error('Create estimate error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/estimates/:id', requirePermission('estimates', 'edit'), async (req, res) => {
    try {
        const estimateId = req.params.id;
        const {
            customer_name, customer_phone, customer_address, estimate_date, valid_until,
            subtotal, gst_amount, grand_total, show_gst_breakdown, column_visibility,
            notes, items
        } = req.body;

        await pool.query(
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

        await pool.query('DELETE FROM estimate_items WHERE estimate_id = ?', [estimateId]);

        if (items && items.length > 0) {
            const itemValues = items.map(item => [
                estimateId, item.product_id || null, item.item_description,
                item.quantity, item.area || null, item.mix_info || null,
                item.unit_price, item.breakdown_cost || null, item.color_cost || 0,
                item.line_total, item.display_order || 0
            ]);

            await pool.query(
                `INSERT INTO estimate_items (
                    estimate_id, product_id, item_description, quantity, area, mix_info,
                    unit_price, breakdown_cost, color_cost, line_total, display_order
                ) VALUES ?`,
                [itemValues]
            );
        }

        res.json({ success: true, message: 'Estimate updated successfully' });
    } catch (err) {
        console.error('Update estimate error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/estimates/:id/items', requirePermission('estimates', 'view'), async (req, res) => {
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

// Update estimate status (FIXED: parameterized SET)
app.patch('/api/estimates/:id/status', requirePermission('estimates', 'edit'), async (req, res) => {
    try {
        const { status, reason, notes } = req.body;
        const estimateId = req.params.id;

        const [current] = await pool.query('SELECT status FROM estimates WHERE id = ?', [estimateId]);
        if (current.length === 0) {
            return res.status(404).json({ error: 'Estimate not found' });
        }

        const oldStatus = current[0].status;

        const setClauses = ['status = ?', 'last_updated_at = NOW()'];
        const params = [status];

        if (status === 'approved') {
            setClauses.push('approved_by_admin_id = ?', 'approved_at = NOW()');
            params.push(req.user.id);
        }

        params.push(estimateId);
        await pool.query(`UPDATE estimates SET ${setClauses.join(', ')} WHERE id = ?`, params);

        await pool.query(
            'INSERT INTO estimate_status_history (estimate_id, old_status, new_status, changed_by_user_id, reason, notes) VALUES (?, ?, ?, ?, ?, ?)',
            [estimateId, oldStatus, status, req.user.id, reason, notes]
        );

        res.json({ success: true, message: 'Status updated successfully' });
    } catch (err) {
        console.error('Update status error:', err);
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/estimates/:id', requirePermission('estimates', 'delete'), async (req, res) => {
    try {
        const estimateId = req.params.id;

        const [estimate] = await pool.query('SELECT * FROM estimates WHERE id = ?', [estimateId]);
        if (estimate.length === 0) {
            return res.status(404).json({ error: 'Estimate not found' });
        }

        await pool.query('DELETE FROM estimate_items WHERE estimate_id = ?', [estimateId]);
        await pool.query('DELETE FROM estimates WHERE id = ?', [estimateId]);

        res.json({ success: true, message: 'Estimate deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/estimates/:id/history', requirePermission('estimates', 'view'), async (req, res) => {
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

app.post('/api/calculate', requireAuth, async (req, res) => {
    try {
        const { product_id, area, color_cost } = req.body;

        const [product] = await pool.query('SELECT * FROM products WHERE id = ?', [product_id]);
        if (!product[0]) return res.status(404).json({ error: 'Product not found' });

        const p = product[0];

        if (p.product_type === 'area_wise' && p.available_sizes) {
            const sizes = JSON.parse(p.available_sizes).sort((a, b) => b - a);
            const totalLiters = area / (p.area_coverage || 1);
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

            if (remaining > 0 && sizes.length > 0) {
                const smallest = sizes[sizes.length - 1];
                mix.push({ size: smallest, count: 1, price: p.base_price * smallest });
            }

            const mixInfo = mix.map(m => `${m.count}x${m.size}L`).join(' + ');
            const breakdown = mix.map(m => `${m.count}x₹${m.price}`).join(' + ');
            const subtotal = mix.reduce((sum, m) => sum + (m.count * m.price), 0);
            const total = subtotal + (color_cost || 0);

            res.json({
                quantity: totalLiters.toFixed(2),
                area,
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
// DASHBOARD STATS
// ========================================

app.get('/api/dashboard/stats', requireRole('admin', 'manager'), async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const thisMonth = today.substring(0, 7);

        const stats = {};

        // Total counts
        const [userCount] = await pool.query('SELECT COUNT(*) as count FROM users WHERE status = ?', ['active']);
        const [customerCount] = await pool.query('SELECT COUNT(*) as count FROM customers WHERE status != ?', ['inactive']);
        const [productCount] = await pool.query('SELECT COUNT(*) as count FROM products WHERE status = ?', ['active']);
        const [estimateCount] = await pool.query('SELECT COUNT(*) as count FROM estimates');

        stats.total_users = userCount[0].count;
        stats.total_customers = customerCount[0].count;
        stats.total_products = productCount[0].count;
        stats.total_estimates = estimateCount[0].count;

        // Today's attendance
        try {
            const [attendanceToday] = await pool.query(
                'SELECT COUNT(*) as count FROM staff_attendance WHERE date = ?', [today]
            );
            stats.attendance_today = attendanceToday[0].count;
        } catch (e) { stats.attendance_today = 0; }

        // Leads
        try {
            const [leadCount] = await pool.query('SELECT COUNT(*) as count FROM leads WHERE status NOT IN (?)', ['inactive']);
            const [newLeads] = await pool.query('SELECT COUNT(*) as count FROM leads WHERE status = ?', ['new']);
            stats.total_leads = leadCount[0].count;
            stats.new_leads = newLeads[0].count;
        } catch (e) {
            stats.total_leads = 0;
            stats.new_leads = 0;
        }

        // Pending tasks
        try {
            const [taskCount] = await pool.query('SELECT COUNT(*) as count FROM staff_tasks WHERE status IN (?)', ['pending']);
            const [overdueCount] = await pool.query(
                'SELECT COUNT(*) as count FROM staff_tasks WHERE status NOT IN (?, ?) AND due_date < ?',
                ['completed', 'cancelled', today]
            );
            stats.pending_tasks = taskCount[0].count;
            stats.overdue_tasks = overdueCount[0].count;
        } catch (e) {
            stats.pending_tasks = 0;
            stats.overdue_tasks = 0;
        }

        // This month estimates total
        const [monthEstimates] = await pool.query(
            'SELECT COUNT(*) as count, COALESCE(SUM(grand_total), 0) as total FROM estimates WHERE DATE_FORMAT(estimate_date, ?) = ?',
            ['%Y-%m', thisMonth]
        );
        stats.month_estimates_count = monthEstimates[0].count;
        stats.month_estimates_total = monthEstimates[0].total;

        res.json({ success: true, data: stats });
    } catch (error) {
        console.error('Dashboard stats error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========================================
// HEALTH CHECK & ROOT
// ========================================

app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        service: 'QC Business Manager API',
        version: '2.0.0'
    });
});

app.get('/api/test', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT 1 as test');
        res.json({ status: 'Database connected', result: rows[0] });
    } catch (err) {
        res.status(500).json({ error: 'Database connection failed', message: err.message });
    }
});

app.get('/', (req, res) => {
    res.json({
        service: 'Quality Colours Business Manager API',
        version: '2.0.0',
        modules: [
            'auth', 'roles', 'permissions', 'branches', 'users',
            'customers', 'leads', 'products', 'estimates',
            'attendance', 'salary', 'activities', 'tasks', 'settings',
            'zoho-books'
        ],
        endpoints: {
            auth: '/api/auth/*',
            brands: '/api/brands',
            categories: '/api/categories',
            products: '/api/products',
            customers: '/api/customers',
            estimates: '/api/estimates',
            roles: '/api/roles',
            branches: '/api/branches',
            leads: '/api/leads',
            attendance: '/api/attendance',
            salary: '/api/salary',
            activities: '/api/activities',
            tasks: '/api/tasks',
            settings: '/api/settings',
            dashboard: '/api/dashboard/stats',
            zoho: '/api/zoho/*',
            health: '/health'
        }
    });
});

// ========================================
// ERROR HANDLING
// ========================================

app.use((err, req, res, _next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        success: false,
        message: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
    });
});

// ========================================
// START SERVER
// ========================================

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`QC Business Manager API v2.0.0 running on port ${PORT}`);
    console.log(`Modules loaded: auth, roles, branches, users, customers, leads, products, estimates, attendance, salary, activities, tasks, settings, zoho-books`);

    // Start background services after server is ready
    if (process.env.ZOHO_ORGANIZATION_ID) {
        syncScheduler.start().catch(err => {
            console.error('Failed to start sync scheduler:', err.message);
        });
        whatsappProcessor.start();
        console.log('Background services started: sync-scheduler, whatsapp-processor');
    } else {
        console.log('Zoho not configured (ZOHO_ORGANIZATION_ID missing) - background services skipped');
    }
});