/**
 * STAFF REGISTRATION MODULE ROUTES
 * Handles staff self-registration, admin review, approval, offer letter generation
 */

const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const PDFDocument = require('pdfkit');
const { requirePermission, requireAuth } = require('../middleware/permissionMiddleware');
const emailService = require('../services/email-service');
const notificationService = require('../services/notification-service');

let pool;

function setPool(dbPool) {
    pool = dbPool;
}

// Aadhar upload config
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

// sendEmail is now provided by the shared email service (services/email-service.js)
const sendEmail = emailService.send;

// ========================================
// PUBLIC: Check phone/email availability
// ========================================
router.post('/check-availability', async (req, res) => {
    try {
        const { phone, email } = req.body;
        const result = {};

        if (phone) {
            const [users] = await pool.query(
                'SELECT id FROM users WHERE phone = ? OR phone = ? OR phone = ?',
                [phone, '+91' + phone, '91' + phone]
            );
            const [pending] = await pool.query(
                "SELECT id FROM staff_registrations WHERE phone = ? AND status = 'pending'", [phone]
            );
            result.phone_available = users.length === 0 && pending.length === 0;
        }

        if (email) {
            const [users] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
            const [pending] = await pool.query(
                "SELECT id FROM staff_registrations WHERE email = ? AND status = 'pending'", [email]
            );
            result.email_available = users.length === 0 && pending.length === 0;
        }

        res.json({ success: true, data: result });
    } catch (error) {
        console.error('Check availability error:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// ========================================
// PUBLIC: Submit staff registration
// ========================================
router.post('/register', uploadAadhar.single('aadhar_proof'), async (req, res) => {
    try {
        const {
            full_name, email, phone, password, password_confirm, otp_id,
            date_of_birth, door_no, street, city, state, pincode,
            aadhar_number, pan_number, emergency_contact_name, emergency_contact_phone
        } = req.body;

        // Validate required fields
        if (!full_name || !email || !phone || !password || !password_confirm || !otp_id) {
            return res.status(400).json({ success: false, message: 'Missing required fields' });
        }

        if (password !== password_confirm) {
            return res.status(400).json({ success: false, message: 'Passwords do not match' });
        }

        if (password.length < 8 || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
            return res.status(400).json({
                success: false,
                message: 'Password must be at least 8 characters with one uppercase letter and one number'
            });
        }

        // Validate phone format
        if (!/^[6-9]\d{9}$/.test(phone)) {
            return res.status(400).json({ success: false, message: 'Invalid phone number format' });
        }

        // Validate email format
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ success: false, message: 'Invalid email format' });
        }

        // Verify OTP
        const [otps] = await pool.query(
            'SELECT * FROM otp_verifications WHERE id = ? AND phone = ? AND verified = 1 AND created_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE)',
            [otp_id, phone]
        );
        if (otps.length === 0) {
            return res.status(400).json({ success: false, message: 'OTP verification expired. Please request a new OTP.' });
        }

        // Check duplicates in users table (handle +91 prefix variations)
        const [existingUsers] = await pool.query(
            'SELECT id FROM users WHERE phone = ? OR phone = ? OR phone = ? OR email = ?',
            [phone, '+91' + phone, '91' + phone, email]
        );
        if (existingUsers.length > 0) {
            return res.status(400).json({ success: false, message: 'Phone or email already registered as a user' });
        }

        // Check duplicates in pending registrations
        const [existingRegs] = await pool.query(
            "SELECT id FROM staff_registrations WHERE (phone = ? OR email = ?) AND status = 'pending'",
            [phone, email]
        );
        if (existingRegs.length > 0) {
            return res.status(400).json({ success: false, message: 'A registration with this phone or email is already pending review' });
        }

        // Validate Aadhar number if provided
        if (aadhar_number && !/^\d{12}$/.test(aadhar_number)) {
            return res.status(400).json({ success: false, message: 'Aadhar number must be exactly 12 digits' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const aadharProofUrl = req.file ? `/uploads/aadhar/${req.file.filename}` : null;

        const [result] = await pool.query(`
            INSERT INTO staff_registrations (
                full_name, email, phone, password_hash,
                date_of_birth, door_no, street, city, state, pincode,
                aadhar_number, aadhar_proof_url, pan_number,
                emergency_contact_name, emergency_contact_phone,
                phone_verified, otp_id, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE, ?, 'pending')
        `, [
            full_name, email, phone, hashedPassword,
            date_of_birth || null, door_no || null, street || null,
            city || null, state || 'Tamil Nadu', pincode || null,
            aadhar_number || null, aadharProofUrl, pan_number || null,
            emergency_contact_name || null, emergency_contact_phone || null,
            otp_id
        ]);

        // Send confirmation email
        await sendEmail(email, 'Registration Received - Quality Colours', `
            <h2 style="color: #333;">Hello ${full_name},</h2>
            <p>Thank you for registering with Quality Colours. Your application has been received and is currently under review.</p>
            <div style="background: white; border-left: 4px solid #667eea; padding: 15px; margin: 20px 0; border-radius: 4px;">
                <p style="margin: 0; color: #4b5563;"><strong>Registration ID:</strong> REG-${result.insertId}</p>
                <p style="margin: 5px 0 0; color: #4b5563;"><strong>Status:</strong> Under Review</p>
            </div>
            <p>You will receive an email notification once your registration has been reviewed by our team.</p>
            <p style="color: #6b7280; font-size: 13px;">If you did not submit this registration, please ignore this email.</p>
        `);

        // Notify all admins of new registration
        try {
            const [admins] = await pool.query("SELECT id FROM users WHERE role = 'admin' AND status = 'active'");
            if (admins.length > 0) {
                await notificationService.sendToMany(
                    admins.map(a => a.id),
                    { type: 'new_registration', title: 'New Staff Registration', body: `${full_name} has submitted a registration for review.`, data: { type: 'new_registration', registration_id: result.insertId } }
                );
            }
        } catch (notifErr) { console.error('Registration notification error:', notifErr.message); }

        res.status(201).json({
            success: true,
            data: { registration_id: result.insertId },
            message: 'Registration submitted successfully! Your application is under review.'
        });

    } catch (error) {
        console.error('Staff registration error:', error);
        res.status(500).json({ success: false, message: 'Registration failed. Please try again.' });
    }
});

// ========================================
// ADMIN: Get registration stats
// ========================================
router.get('/stats', requireAuth, requirePermission('staff_registrations', 'view'), async (req, res) => {
    try {
        const [stats] = await pool.query(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
                SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected
            FROM staff_registrations
        `);
        res.json({ success: true, data: stats[0] });
    } catch (error) {
        console.error('Get stats error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch stats' });
    }
});

// ========================================
// ADMIN: List registrations
// ========================================
router.get('/registrations', requireAuth, requirePermission('staff_registrations', 'view'), async (req, res) => {
    try {
        const { status, search, page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;

        let query = `
            SELECT sr.*,
                   u_approved.full_name as approved_by_name,
                   u_rejected.full_name as rejected_by_name,
                   b.name as branch_name
            FROM staff_registrations sr
            LEFT JOIN users u_approved ON sr.approved_by = u_approved.id
            LEFT JOIN users u_rejected ON sr.rejected_by = u_rejected.id
            LEFT JOIN branches b ON sr.assigned_branch_id = b.id
            WHERE 1=1
        `;
        const params = [];

        if (status) {
            query += ' AND sr.status = ?';
            params.push(status);
        }

        if (search) {
            query += ' AND (sr.full_name LIKE ? OR sr.phone LIKE ? OR sr.email LIKE ? OR sr.city LIKE ?)';
            const s = `%${search}%`;
            params.push(s, s, s, s);
        }

        // Get total count
        const countQuery = query.replace(/SELECT sr\.\*[\s\S]*?FROM/, 'SELECT COUNT(*) as total FROM');
        const [countResult] = await pool.query(countQuery, params);
        const total = countResult[0].total;

        query += ' ORDER BY sr.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), parseInt(offset));

        const [registrations] = await pool.query(query, params);

        res.json({
            success: true,
            data: registrations,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error('List registrations error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch registrations' });
    }
});

// ========================================
// ADMIN: Get single registration
// ========================================
router.get('/registrations/:id', requireAuth, requirePermission('staff_registrations', 'view'), async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT sr.*,
                   u_approved.full_name as approved_by_name,
                   u_rejected.full_name as rejected_by_name,
                   b.name as branch_name
            FROM staff_registrations sr
            LEFT JOIN users u_approved ON sr.approved_by = u_approved.id
            LEFT JOIN users u_rejected ON sr.rejected_by = u_rejected.id
            LEFT JOIN branches b ON sr.assigned_branch_id = b.id
            WHERE sr.id = ?
        `, [req.params.id]);

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Registration not found' });
        }

        res.json({ success: true, data: rows[0] });
    } catch (error) {
        console.error('Get registration error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch registration' });
    }
});

// ========================================
// ADMIN: Approve registration
// ========================================
router.post('/registrations/:id/approve', requireAuth, requirePermission('staff_registrations', 'approve'), async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const { assigned_role, assigned_branch_id, joining_date, monthly_salary,
                transport_allowance = 0, food_allowance = 0, other_allowance = 0 } = req.body;

        if (!assigned_role || !assigned_branch_id || !joining_date || !monthly_salary) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'Role, branch, joining date and salary are required' });
        }

        // Get registration
        const [regs] = await connection.query(
            "SELECT * FROM staff_registrations WHERE id = ? AND status = 'pending'",
            [req.params.id]
        );
        if (regs.length === 0) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'Registration not found or already processed' });
        }

        const reg = regs[0];

        // Check if phone/email already taken in users (handle +91 prefix variations)
        const [existing] = await connection.query(
            'SELECT id FROM users WHERE phone = ? OR phone = ? OR phone = ? OR email = ?',
            [reg.phone, '+91' + reg.phone, '91' + reg.phone, reg.email]
        );
        if (existing.length > 0) {
            await connection.rollback();
            return res.status(400).json({ success: false, message: 'Phone or email already exists in users table' });
        }

        // Create user account
        const [userResult] = await connection.query(`
            INSERT INTO users (username, password_hash, full_name, email, phone, role, branch_id, status, date_of_birth,
                              door_no, street, city, state, pincode, aadhar_number, aadhar_proof_url,
                              pan_number, pan_proof_url,
                              emergency_contact_name, emergency_contact_phone)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            reg.phone, reg.password_hash, reg.full_name, reg.email, reg.phone,
            assigned_role, assigned_branch_id,
            reg.date_of_birth, reg.door_no, reg.street, reg.city, reg.state, reg.pincode,
            reg.aadhar_number, reg.aadhar_proof_url,
            reg.pan_number || null, reg.pan_proof_url || null,
            reg.emergency_contact_name, reg.emergency_contact_phone
        ]);

        const userId = userResult.insertId;

        // Create salary config
        await connection.query(`
            INSERT INTO staff_salary_config (
                user_id, branch_id, monthly_salary,
                transport_allowance, food_allowance, other_allowance,
                effective_from, is_active, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
        `, [userId, assigned_branch_id, monthly_salary,
            transport_allowance, food_allowance, other_allowance,
            joining_date, req.user.id]);

        // Generate offer letter PDF
        const offerLetterPath = await generateOfferLetter(reg, {
            assigned_role, assigned_branch_id, joining_date,
            monthly_salary, transport_allowance, food_allowance, other_allowance
        }, connection);

        // Update registration
        await connection.query(`
            UPDATE staff_registrations SET
                status = 'approved',
                assigned_role = ?,
                assigned_branch_id = ?,
                approved_by = ?,
                approved_at = NOW(),
                joining_date = ?,
                monthly_salary = ?,
                transport_allowance = ?,
                food_allowance = ?,
                other_allowance = ?,
                offer_letter_url = ?,
                created_user_id = ?
            WHERE id = ?
        `, [assigned_role, assigned_branch_id, req.user.id, joining_date,
            monthly_salary, transport_allowance, food_allowance, other_allowance,
            offerLetterPath, userId, req.params.id]);

        await connection.commit();

        // Notify all admins of approval
        try {
            const [admins] = await pool.query("SELECT id FROM users WHERE role = 'admin' AND status = 'active' AND id != ?", [req.user.id]);
            if (admins.length > 0) {
                await notificationService.sendToMany(
                    admins.map(a => a.id),
                    { type: 'new_registration', title: 'Registration Approved', body: `${reg.full_name} has been approved as ${assigned_role}.`, data: { type: 'new_registration', registration_id: req.params.id } }
                );
            }
        } catch (notifErr) { console.error('Approval notification error:', notifErr.message); }

        // Send approval email (outside transaction)
        const totalSalary = parseFloat(monthly_salary) + parseFloat(transport_allowance) + parseFloat(food_allowance) + parseFloat(other_allowance);
        await sendEmail(reg.email, 'Congratulations! Your Registration is Approved - Quality Colours', `
            <h2 style="color: #333;">Dear ${reg.full_name},</h2>
            <p>We are delighted to inform you that your staff registration has been <strong style="color: #059669;">approved</strong>!</p>
            <div style="background: white; border: 1px solid #e5e7eb; padding: 20px; margin: 20px 0; border-radius: 8px;">
                <h3 style="color: #667eea; margin-top: 0;">Your Details</h3>
                <table style="width: 100%; border-collapse: collapse;">
                    <tr><td style="padding: 8px 0; color: #6b7280;">Position:</td><td style="padding: 8px 0; font-weight: 600;">${assigned_role}</td></tr>
                    <tr><td style="padding: 8px 0; color: #6b7280;">Joining Date:</td><td style="padding: 8px 0; font-weight: 600;">${joining_date}</td></tr>
                    <tr><td style="padding: 8px 0; color: #6b7280;">Monthly CTC:</td><td style="padding: 8px 0; font-weight: 600;">₹${totalSalary.toLocaleString('en-IN')}</td></tr>
                </table>
            </div>
            <p>You can now log in to the staff portal using your registered phone number and password.</p>
            <div style="text-align: center; margin: 25px 0;">
                <a href="https://act.qcpaintshop.com/login.html" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 12px 30px; border-radius: 8px; text-decoration: none; font-weight: 600;">Login to Staff Portal</a>
            </div>
            <p style="color: #6b7280; font-size: 13px;">Your offer letter will be shared with you separately.</p>
        `);

        res.json({
            success: true,
            message: 'Registration approved successfully',
            data: {
                user_id: userId,
                offer_letter_url: offerLetterPath
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error('Approve registration error:', error);
        res.status(500).json({ success: false, message: 'Failed to approve registration' });
    } finally {
        connection.release();
    }
});

// ========================================
// ADMIN: Reject registration
// ========================================
router.post('/registrations/:id/reject', requireAuth, requirePermission('staff_registrations', 'approve'), async (req, res) => {
    try {
        const { reason } = req.body;
        if (!reason) {
            return res.status(400).json({ success: false, message: 'Rejection reason is required' });
        }

        const [regs] = await pool.query(
            "SELECT * FROM staff_registrations WHERE id = ? AND status = 'pending'",
            [req.params.id]
        );
        if (regs.length === 0) {
            return res.status(400).json({ success: false, message: 'Registration not found or already processed' });
        }

        const reg = regs[0];

        await pool.query(`
            UPDATE staff_registrations SET
                status = 'rejected',
                rejected_by = ?,
                rejected_at = NOW(),
                rejection_reason = ?
            WHERE id = ?
        `, [req.user.id, reason, req.params.id]);

        // Send rejection email
        await sendEmail(reg.email, 'Registration Update - Quality Colours', `
            <h2 style="color: #333;">Dear ${reg.full_name},</h2>
            <p>Thank you for your interest in joining Quality Colours.</p>
            <p>After careful review, we regret to inform you that your staff registration (REG-${reg.id}) could not be approved at this time.</p>
            <div style="background: #fef2f2; border-left: 4px solid #ef4444; padding: 15px; margin: 20px 0; border-radius: 4px;">
                <p style="margin: 0; color: #991b1b;"><strong>Reason:</strong> ${reason}</p>
            </div>
            <p>If you have any questions, please contact our office.</p>
        `);

        res.json({ success: true, message: 'Registration rejected' });
    } catch (error) {
        console.error('Reject registration error:', error);
        res.status(500).json({ success: false, message: 'Failed to reject registration' });
    }
});

// ========================================
// ADMIN: Send offer letter via email
// ========================================
router.post('/registrations/:id/send-offer-letter', requireAuth, requirePermission('staff_registrations', 'approve'), async (req, res) => {
    try {
        const [regs] = await pool.query(
            "SELECT * FROM staff_registrations WHERE id = ? AND status = 'approved'",
            [req.params.id]
        );
        if (regs.length === 0) {
            return res.status(400).json({ success: false, message: 'Approved registration not found' });
        }

        const reg = regs[0];
        if (!reg.offer_letter_url) {
            return res.status(400).json({ success: false, message: 'Offer letter not yet generated' });
        }

        const filePath = path.join(__dirname, '..', 'public', reg.offer_letter_url);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ success: false, message: 'Offer letter file not found' });
        }

        const sent = await sendEmail(
            reg.email,
            'Your Offer Letter - Quality Colours',
            `
                <h2 style="color: #333;">Dear ${reg.full_name},</h2>
                <p>Please find attached your official offer letter from Quality Colours.</p>
                <p>We look forward to having you on our team starting <strong>${reg.joining_date ? new Date(reg.joining_date).toLocaleDateString('en-IN') : 'soon'}</strong>.</p>
                <p>If you have any questions, please don't hesitate to reach out.</p>
            `,
            [{
                filename: `Offer-Letter-${reg.full_name.replace(/\s+/g, '-')}.pdf`,
                path: filePath
            }]
        );

        if (sent) {
            await pool.query(
                'UPDATE staff_registrations SET offer_letter_sent = TRUE, offer_letter_sent_at = NOW() WHERE id = ?',
                [req.params.id]
            );
            res.json({ success: true, message: 'Offer letter sent successfully' });
        } else {
            res.status(500).json({ success: false, message: 'Failed to send email. Check SMTP configuration.' });
        }
    } catch (error) {
        console.error('Send offer letter error:', error);
        res.status(500).json({ success: false, message: 'Failed to send offer letter' });
    }
});

// ========================================
// ADMIN: Download offer letter
// ========================================
router.get('/registrations/:id/offer-letter', async (req, res) => {
    try {
        // Support token from both header and query param (for window.open downloads)
        const token = req.headers.authorization?.replace('Bearer ', '') || req.query.token;
        if (!token) {
            return res.status(401).json({ success: false, message: 'Authentication required' });
        }

        const [sessions] = await pool.query(
            `SELECT s.*, u.id as user_id, u.role FROM user_sessions s
             JOIN users u ON s.user_id = u.id
             WHERE s.session_token = ? AND s.expires_at > NOW() AND u.status = 'active'`,
            [token]
        );
        if (sessions.length === 0) {
            return res.status(401).json({ success: false, message: 'Invalid or expired session' });
        }

        const [regs] = await pool.query('SELECT * FROM staff_registrations WHERE id = ?', [req.params.id]);
        if (regs.length === 0 || !regs[0].offer_letter_url) {
            return res.status(404).json({ success: false, message: 'Offer letter not found' });
        }

        const filePath = path.join(__dirname, '..', 'public', regs[0].offer_letter_url);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ success: false, message: 'Offer letter file not found' });
        }

        res.download(filePath, `Offer-Letter-REG-${req.params.id}.pdf`);
    } catch (error) {
        console.error('Download offer letter error:', error);
        res.status(500).json({ success: false, message: 'Failed to download offer letter' });
    }
});

// ========================================
// HELPER: Generate Offer Letter PDF (Bilingual English + Tamil with Aadhar)
// ========================================
async function generateOfferLetter(registration, approvalData, connection, customContent = null) {
    return new Promise(async (resolve, reject) => {
        try {
            const fileName = `offer-letter-${registration.id}-${Date.now()}.pdf`;
            const filePath = path.join(__dirname, '..', 'public', 'uploads', 'documents', fileName);
            const urlPath = `/uploads/documents/${fileName}`;

            // Ensure directory exists
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            // Get branch name and address
            let branchName = 'Head Office';
            let branchAddress = '';
            if (approvalData.assigned_branch_id) {
                const [branches] = await (connection || pool).query(
                    'SELECT name, address FROM branches WHERE id = ?', [approvalData.assigned_branch_id]
                );
                if (branches.length > 0) {
                    branchName = branches[0].name;
                    branchAddress = branches[0].address || '';
                }
            }
            if (customContent && customContent.branch_name) branchName = customContent.branch_name;

            // Get all company settings
            let companyName = 'Quality Colours';
            let companyAddress = 'Thanjavur, Tamil Nadu';
            let companyPhone = '';
            let companyEmail = '';
            let companyGST = '';
            let companyPAN = '';
            let companyLogo = '';
            try {
                const [settings] = await (connection || pool).query(
                    "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('business_name', 'business_address', 'business_phone', 'business_email', 'gst_number', 'pan_number', 'business_logo')"
                );
                settings.forEach(s => {
                    if (s.setting_key === 'business_name' && s.setting_value) companyName = s.setting_value;
                    if (s.setting_key === 'business_address' && s.setting_value) companyAddress = s.setting_value;
                    if (s.setting_key === 'business_phone' && s.setting_value) companyPhone = s.setting_value;
                    if (s.setting_key === 'business_email' && s.setting_value) companyEmail = s.setting_value;
                    if (s.setting_key === 'gst_number' && s.setting_value) companyGST = s.setting_value;
                    if (s.setting_key === 'pan_number' && s.setting_value) companyPAN = s.setting_value;
                    if (s.setting_key === 'business_logo' && s.setting_value) companyLogo = s.setting_value;
                });
            } catch (e) { /* use defaults */ }
            if (customContent && customContent.company_name) companyName = customContent.company_name;
            if (customContent && customContent.company_address) companyAddress = customContent.company_address;

            // Register Tamil font (Nirmala UI supports Tamil script)
            const tamilFontPath = 'C:\\Windows\\Fonts\\Nirmala.ttf';
            const tamilFontBoldPath = 'C:\\Windows\\Fonts\\NirmalaB.ttf';
            const hasTamilFont = fs.existsSync(tamilFontPath);

            const doc = new PDFDocument({ margin: 50, size: 'A4' });
            const stream = fs.createWriteStream(filePath);
            doc.pipe(stream);

            // Register fonts
            if (hasTamilFont) {
                doc.registerFont('Tamil', tamilFontPath);
                doc.registerFont('TamilBold', tamilFontBoldPath);
            }

            const totalCTC = parseFloat(approvalData.monthly_salary) +
                           parseFloat(approvalData.transport_allowance || 0) +
                           parseFloat(approvalData.food_allowance || 0) +
                           parseFloat(approvalData.other_allowance || 0);

            const annualCTC = totalCTC * 12;
            const today = new Date();
            const joiningDate = new Date(approvalData.joining_date);
            const position = approvalData.assigned_role.charAt(0).toUpperCase() + approvalData.assigned_role.slice(1);
            const fmt = (n) => parseFloat(n).toLocaleString('en-IN');
            const dateStr = today.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });
            const joiningDateStr = joiningDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });

            // ═══════════════════════════════════════════════
            // PAGE 1: ENGLISH OFFER LETTER
            // ═══════════════════════════════════════════════

            // Header gradient bar
            doc.rect(0, 0, doc.page.width, 10).fill('#667eea');
            doc.rect(0, 10, doc.page.width, 5).fill('#764ba2');

            // Company Logo
            let logoY = 30;
            if (companyLogo) {
                const logoPath = path.join(__dirname, '..', 'public', companyLogo);
                if (fs.existsSync(logoPath)) {
                    try {
                        doc.image(logoPath, doc.page.width / 2 - 30, logoY, { width: 60, height: 60 });
                        logoY += 65;
                    } catch(e) { /* skip logo if error */ }
                }
            }

            // Company Header
            doc.y = logoY;
            doc.fontSize(22).fillColor('#667eea').text(companyName, { align: 'center' });
            doc.fontSize(9).fillColor('#6b7280').text(companyAddress, { align: 'center' });

            // Contact info line
            const contactParts = [];
            if (companyPhone) contactParts.push(`Ph: ${companyPhone}`);
            if (companyEmail) contactParts.push(`Email: ${companyEmail}`);
            if (contactParts.length > 0) {
                doc.text(contactParts.join('  |  '), { align: 'center' });
            }

            // GST/PAN line
            const regParts = [];
            if (companyGST) regParts.push(`GSTIN: ${companyGST}`);
            if (companyPAN) regParts.push(`PAN: ${companyPAN}`);
            if (regParts.length > 0) {
                doc.fontSize(8).fillColor('#9ca3af').text(regParts.join('  |  '), { align: 'center' });
            }

            doc.moveDown(0.5);
            doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke('#667eea');

            // Date and Reference
            doc.moveDown(0.8);
            doc.fontSize(10).fillColor('#374151');
            doc.text(`Date: ${dateStr}`, 50, doc.y, { continued: false });
            doc.text(`Ref: QC/OL/${new Date().getFullYear()}/${String(registration.id).padStart(4, '0')}`, { align: 'right' });

            // Title
            doc.moveDown(1);
            doc.rect(doc.page.width / 2 - 80, doc.y, 160, 28).fill('#667eea');
            doc.fontSize(14).fillColor('#ffffff').text('OFFER LETTER', doc.page.width / 2 - 80, doc.y + 7, { width: 160, align: 'center' });
            doc.y += 40;

            // Salutation
            doc.fontSize(11).fillColor('#374151');
            doc.text(`Dear ${registration.full_name},`, 50);
            doc.moveDown(0.6);

            // Offer paragraph
            const offerText = (customContent && customContent.offer_text) ? customContent.offer_text :
                `With reference to your application and subsequent discussions, we are pleased to offer you the position of "${position}" at ${companyName}, ${branchName} Branch. ` +
                `We were impressed with your profile and believe you will be a valuable addition to our team.`;
            doc.fontSize(10).text(offerText, { align: 'justify', lineGap: 3 });
            doc.moveDown(0.5);

            // Employment details
            doc.text(`Your employment details are as follows:`, { align: 'left' });
            doc.moveDown(0.5);

            // Details table
            const detailsData = [
                ['Designation', position],
                ['Department', 'Operations'],
                ['Branch / Location', `${branchName}${branchAddress ? ', ' + branchAddress : ''}`],
                ['Date of Joining', joiningDateStr],
                ['Reporting To', 'Branch Manager / Admin'],
                ['Working Hours', '10:00 AM to 8:00 PM (10 hours/day)'],
                ['Weekly Off', 'As per company schedule'],
                ['Probation Period', '3 months from date of joining']
            ];

            let detY = doc.y;
            detailsData.forEach((row, i) => {
                if (i % 2 === 0) {
                    doc.rect(50, detY, doc.page.width - 100, 20).fill('#f8f9fa');
                }
                doc.fontSize(9).fillColor('#6b7280').text(row[0], 55, detY + 5, { width: 160 });
                doc.fontSize(9).fillColor('#1f2937').text(': ' + row[1], 220, detY + 5, { width: 280 });
                detY += 20;
            });
            doc.y = detY + 10;

            // Salary table header
            doc.fontSize(11).fillColor('#1f2937').text('Compensation Details:', { underline: true });
            doc.moveDown(0.4);

            const tableTop = doc.y;
            const col1 = 55;
            const colMid = 350;
            const colRight = 430;
            const rowHeight = 22;
            const tableWidth = doc.page.width - 100;

            // Table header
            doc.rect(col1 - 5, tableTop, tableWidth, rowHeight).fill('#667eea');
            doc.fontSize(9).fillColor('#ffffff');
            doc.text('Component', col1, tableTop + 6, { width: 200 });
            doc.text('Monthly (₹)', colMid, tableTop + 6, { width: 80, align: 'right' });
            doc.text('Annual (₹)', colRight, tableTop + 6, { width: 80, align: 'right' });

            // Salary rows
            const salaryRows = [
                ['Basic Salary', approvalData.monthly_salary],
                ['Transport Allowance', approvalData.transport_allowance || 0],
                ['Food Allowance', approvalData.food_allowance || 0],
                ['Other Allowance', approvalData.other_allowance || 0]
            ];

            let y = tableTop + rowHeight;
            salaryRows.forEach((row, i) => {
                const bg = i % 2 === 0 ? '#f9fafb' : '#ffffff';
                doc.rect(col1 - 5, y, tableWidth, rowHeight).fill(bg);
                doc.fontSize(9).fillColor('#4b5563');
                doc.text(row[0], col1, y + 6, { width: 200 });
                doc.text(`₹${fmt(row[1])}`, colMid, y + 6, { width: 80, align: 'right' });
                doc.text(`₹${fmt(parseFloat(row[1]) * 12)}`, colRight, y + 6, { width: 80, align: 'right' });
                y += rowHeight;
            });

            // Total row
            doc.rect(col1 - 5, y, tableWidth, rowHeight + 2).fill('#667eea');
            doc.fontSize(9.5).fillColor('#ffffff');
            doc.text('Total Cost to Company (CTC)', col1, y + 6, { width: 200 });
            doc.text(`₹${fmt(totalCTC)}`, colMid, y + 6, { width: 80, align: 'right' });
            doc.text(`₹${fmt(annualCTC)}`, colRight, y + 6, { width: 80, align: 'right' });
            doc.y = y + rowHeight + 15;

            // Terms & Conditions
            doc.fontSize(11).fillColor('#1f2937').text('Terms & Conditions:', { underline: true });
            doc.moveDown(0.3);
            doc.fontSize(8.5).fillColor('#4b5563');

            const defaultTerms = [
                'This offer is valid for acceptance within 7 days from the date of issuance. Non-acceptance within this period will render this offer void.',
                'You will be on probation for a period of 3 months from the date of joining. Your appointment will be confirmed upon satisfactory completion of the probation period.',
                'During probation, either party may terminate the employment with 15 days written notice or salary in lieu thereof. After confirmation, a notice period of 30 days is applicable.',
                'You are expected to work the full scheduled hours, maintain punctuality, and adhere to all company policies, rules and regulations.',
                'Your salary is subject to applicable tax deductions (TDS) as per Income Tax Act and other statutory deductions as per government regulations.',
                'You shall not disclose any confidential information of the company to any third party during or after your employment.',
                'The company reserves the right to transfer you to any department, branch, or location based on business requirements.',
                'You are entitled to leave as per the company\'s leave policy. Unauthorized absence may result in deductions or disciplinary action.',
                'Any form of misconduct, negligence, insubordination, or breach of company policy may result in disciplinary action including termination.',
                'You are required to submit all original educational certificates and identity proofs at the time of joining for verification.'
            ];
            const terms = (customContent && Array.isArray(customContent.terms) && customContent.terms.length > 0) ? customContent.terms : defaultTerms;

            terms.forEach((term, i) => {
                doc.text(`${i + 1}. ${term}`, 55, doc.y, { align: 'justify', lineGap: 2, width: doc.page.width - 110 });
                doc.moveDown(0.2);
            });

            // Signature section
            doc.moveDown(1.5);
            doc.fontSize(10).fillColor('#374151');
            doc.text(`For ${companyName}`, 50);
            doc.moveDown(2.5);
            doc.text('________________________', 50);
            doc.text('Authorized Signatory', 50);

            // Employee acceptance
            const accX = 320;
            doc.y -= 55;
            doc.text('Acceptance by Employee:', accX);
            doc.moveDown(2.5);
            doc.text('________________________', accX);
            doc.text(registration.full_name, accX);
            doc.text('Date: ________________', accX);

            // Footer
            const bottomY = doc.page.height - 25;
            doc.rect(0, bottomY - 5, doc.page.width, 5).fill('#764ba2');
            doc.rect(0, bottomY, doc.page.width, 10).fill('#667eea');
            doc.fontSize(7).fillColor('#ffffff').text('This is a system-generated offer letter from ' + companyName, 0, bottomY + 1, { align: 'center', width: doc.page.width });

            // ═══════════════════════════════════════════════
            // PAGE 2: TAMIL OFFER LETTER
            // ═══════════════════════════════════════════════
            if (hasTamilFont) {
                doc.addPage({ margin: 50, size: 'A4' });

                // Header gradient bar
                doc.rect(0, 0, doc.page.width, 10).fill('#667eea');
                doc.rect(0, 10, doc.page.width, 5).fill('#764ba2');

                // Company Logo
                let tLogoY = 30;
                if (companyLogo) {
                    const logoPath = path.join(__dirname, '..', 'public', companyLogo);
                    if (fs.existsSync(logoPath)) {
                        try {
                            doc.image(logoPath, doc.page.width / 2 - 30, tLogoY, { width: 60, height: 60 });
                            tLogoY += 65;
                        } catch(e) {}
                    }
                }

                doc.y = tLogoY;
                doc.font('TamilBold').fontSize(20).fillColor('#667eea').text(companyName, { align: 'center' });
                doc.font('Tamil').fontSize(9).fillColor('#6b7280').text(companyAddress, { align: 'center' });
                if (contactParts.length > 0) doc.text(contactParts.join('  |  '), { align: 'center' });
                if (regParts.length > 0) doc.fontSize(8).fillColor('#9ca3af').text(regParts.join('  |  '), { align: 'center' });

                doc.moveDown(0.5);
                doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke('#667eea');

                // Date and Ref
                doc.moveDown(0.8);
                doc.font('Tamil').fontSize(10).fillColor('#374151');
                doc.text(`தேதி: ${dateStr}`, 50);
                doc.text(`குறிப்பு எண்: QC/OL/${new Date().getFullYear()}/${String(registration.id).padStart(4, '0')}`, { align: 'right' });

                // Title
                doc.moveDown(1);
                doc.rect(doc.page.width / 2 - 80, doc.y, 160, 28).fill('#667eea');
                doc.font('TamilBold').fontSize(14).fillColor('#ffffff').text('வேலை வாய்ப்பு கடிதம்', doc.page.width / 2 - 80, doc.y + 6, { width: 160, align: 'center' });
                doc.y += 40;

                // Salutation
                doc.font('Tamil').fontSize(11).fillColor('#374151');
                doc.text(`அன்புள்ள ${registration.full_name} அவர்களுக்கு,`, 50);
                doc.moveDown(0.6);

                // Offer text in Tamil
                const tamilOfferText = (customContent && customContent.tamil_offer_text) ? customContent.tamil_offer_text :
                    `உங்கள் விண்ணப்பம் மற்றும் அதன் பின்னரான விவாதங்களைக் குறிப்பிட்டு, ${companyName} நிறுவனத்தின் ${branchName} கிளையில் "${position}" பதவிக்கு உங்களுக்கு வேலை வாய்ப்பு வழங்குவதில் மகிழ்ச்சி அடைகிறோம். உங்கள் திறமைகள் எங்கள் குழுவிற்கு மதிப்புமிக்க பங்களிப்பாக இருக்கும் என நம்புகிறோம்.`;
                doc.font('Tamil').fontSize(10).text(tamilOfferText, { align: 'justify', lineGap: 3 });
                doc.moveDown(0.5);

                doc.text('உங்கள் வேலை விவரங்கள் பின்வருமாறு:', { align: 'left' });
                doc.moveDown(0.5);

                // Tamil details table
                const tamilDetails = [
                    ['பதவி', position],
                    ['துறை', 'செயல்பாடுகள்'],
                    ['கிளை / இடம்', `${branchName}${branchAddress ? ', ' + branchAddress : ''}`],
                    ['சேரும் தேதி', joiningDateStr],
                    ['அறிக்கையிடுபவர்', 'கிளை மேலாளர் / நிர்வாகி'],
                    ['வேலை நேரம்', 'காலை 10:00 முதல் இரவு 8:00 வரை (10 மணி நேரம்)'],
                    ['வாரவிடுப்பு', 'நிறுவன அட்டவணையின்படி'],
                    ['சோதனைக் காலம்', 'சேர்ந்த நாளிலிருந்து 3 மாதங்கள்']
                ];

                let tDetY = doc.y;
                tamilDetails.forEach((row, i) => {
                    if (i % 2 === 0) doc.rect(50, tDetY, doc.page.width - 100, 22).fill('#f8f9fa');
                    doc.font('Tamil').fontSize(9).fillColor('#6b7280').text(row[0], 55, tDetY + 5, { width: 180 });
                    doc.font('Tamil').fontSize(9).fillColor('#1f2937').text(': ' + row[1], 240, tDetY + 5, { width: 260 });
                    tDetY += 22;
                });
                doc.y = tDetY + 10;

                // Tamil salary table
                doc.font('TamilBold').fontSize(11).fillColor('#1f2937').text('ஊதிய விவரங்கள்:', { underline: true });
                doc.moveDown(0.4);

                const tTableTop = doc.y;

                doc.rect(col1 - 5, tTableTop, tableWidth, rowHeight).fill('#667eea');
                doc.font('TamilBold').fontSize(9).fillColor('#ffffff');
                doc.text('கூறு', col1, tTableTop + 6, { width: 200 });
                doc.text('மாதம் (₹)', colMid, tTableTop + 6, { width: 80, align: 'right' });
                doc.text('ஆண்டு (₹)', colRight, tTableTop + 6, { width: 80, align: 'right' });

                const tamilSalaryRows = [
                    ['அடிப்படை ஊதியம்', approvalData.monthly_salary],
                    ['போக்குவரத்து படி', approvalData.transport_allowance || 0],
                    ['உணவு படி', approvalData.food_allowance || 0],
                    ['பிற படிகள்', approvalData.other_allowance || 0]
                ];

                let tY = tTableTop + rowHeight;
                tamilSalaryRows.forEach((row, i) => {
                    const bg = i % 2 === 0 ? '#f9fafb' : '#ffffff';
                    doc.rect(col1 - 5, tY, tableWidth, rowHeight).fill(bg);
                    doc.font('Tamil').fontSize(9).fillColor('#4b5563');
                    doc.text(row[0], col1, tY + 6, { width: 200 });
                    doc.text(`₹${fmt(row[1])}`, colMid, tY + 6, { width: 80, align: 'right' });
                    doc.text(`₹${fmt(parseFloat(row[1]) * 12)}`, colRight, tY + 6, { width: 80, align: 'right' });
                    tY += rowHeight;
                });

                doc.rect(col1 - 5, tY, tableWidth, rowHeight + 2).fill('#667eea');
                doc.font('TamilBold').fontSize(9.5).fillColor('#ffffff');
                doc.text('மொத்த CTC', col1, tY + 6, { width: 200 });
                doc.text(`₹${fmt(totalCTC)}`, colMid, tY + 6, { width: 80, align: 'right' });
                doc.text(`₹${fmt(annualCTC)}`, colRight, tY + 6, { width: 80, align: 'right' });
                doc.y = tY + rowHeight + 15;

                // Tamil Terms
                doc.font('TamilBold').fontSize(11).fillColor('#1f2937').text('விதிமுறைகள் மற்றும் நிபந்தனைகள்:', { underline: true });
                doc.moveDown(0.3);
                doc.font('Tamil').fontSize(8.5).fillColor('#4b5563');

                const defaultTamilTerms = [
                    'இந்த வாய்ப்பு கடிதம் வழங்கப்பட்ட நாளிலிருந்து 7 நாட்களுக்குள் ஏற்றுக்கொள்ளப்பட வேண்டும். இக்காலத்திற்குள் ஏற்கப்படாவிட்டால் இது செல்லாது.',
                    'நீங்கள் சேர்ந்த நாளிலிருந்து 3 மாதங்கள் சோதனைக் காலத்தில் இருப்பீர்கள். திருப்திகரமான சோதனைக் காலம் முடிந்ததும் உங்கள் நியமனம் உறுதி செய்யப்படும்.',
                    'சோதனைக் காலத்தில், இருதரப்பும் 15 நாட்கள் எழுத்துப்பூர்வ அறிவிப்பு அல்லது ஊதியத்துடன் வேலையை நிறுத்தலாம். உறுதிப்படுத்தலுக்குப் பிறகு 30 நாட்கள் அறிவிப்புக் காலம் பொருந்தும்.',
                    'நீங்கள் முழு வேலை நேரம் பணிபுரிய வேண்டும், நேரம் தவறாமை கடைப்பிடிக்க வேண்டும், மற்றும் நிறுவனத்தின் அனைத்து கொள்கைகள் மற்றும் விதிகளைப் பின்பற்ற வேண்டும்.',
                    'உங்கள் ஊதியம் வருமான வரிச் சட்டம் மற்றும் அரசு விதிகளின்படி பொருந்தும் வரி விலக்குகளுக்கு உட்பட்டது.',
                    'நிறுவனத்தின் எந்தவொரு ரகசிய தகவலையும் வேலையின் போது அல்லது பின்னர் மூன்றாம் தரப்பினருக்கு வெளிப்படுத்தக் கூடாது.',
                    'வணிகத் தேவைகளின் அடிப்படையில் நிறுவனம் உங்களை எந்த துறை, கிளை அல்லது இடத்திற்கும் மாற்றும் உரிமையைக் கொண்டுள்ளது.',
                    'நிறுவனத்தின் விடுப்புக் கொள்கையின்படி விடுப்பு பெறலாம். அங்கீகரிக்கப்படாத விடுப்பு ஊதிய விலக்கு அல்லது ஒழுங்கு நடவடிக்கைக்கு வழிவகுக்கும்.',
                    'தவறான நடத்தை, கவனக்குறைவு, கீழ்ப்படியாமை அல்லது நிறுவனக் கொள்கை மீறல் ஆகியவை பணிநீக்கம் உள்ளிட்ட ஒழுங்கு நடவடிக்கைக்கு வழிவகுக்கும்.',
                    'சேரும் நேரத்தில் அசல் கல்வி சான்றிதழ்கள் மற்றும் அடையாள ஆவணங்களை சரிபார்ப்புக்காக சமர்ப்பிக்க வேண்டும்.'
                ];
                const tamilTerms = (customContent && Array.isArray(customContent.tamil_terms) && customContent.tamil_terms.length > 0) ? customContent.tamil_terms : defaultTamilTerms;

                tamilTerms.forEach((term, i) => {
                    doc.text(`${i + 1}. ${term}`, 55, doc.y, { align: 'justify', lineGap: 2, width: doc.page.width - 110 });
                    doc.moveDown(0.2);
                });

                // Signature section
                doc.moveDown(1.5);
                doc.font('Tamil').fontSize(10).fillColor('#374151');
                doc.text(`${companyName} சார்பாக`, 50);
                doc.moveDown(2.5);
                doc.text('________________________', 50);
                doc.text('அங்கீகரிக்கப்பட்ட கையொப்பமிடுபவர்', 50);

                const tAccX = 320;
                doc.y -= 55;
                doc.text('ஊழியர் ஏற்றுக்கொள்ளல்:', tAccX);
                doc.moveDown(2.5);
                doc.text('________________________', tAccX);
                doc.text(registration.full_name, tAccX);
                doc.text('தேதி: ________________', tAccX);

                // Footer
                const tBottomY = doc.page.height - 25;
                doc.rect(0, tBottomY - 5, doc.page.width, 5).fill('#764ba2');
                doc.rect(0, tBottomY, doc.page.width, 10).fill('#667eea');
                doc.font('Tamil').fontSize(7).fillColor('#ffffff').text('இது ' + companyName + ' நிறுவனத்தின் கணினி உருவாக்கிய வேலை வாய்ப்பு கடிதம்', 0, tBottomY + 1, { align: 'center', width: doc.page.width });
            }

            // ═══════════════════════════════════════════════
            // PAGE 3: AADHAR PROOF COPY (if uploaded)
            // ═══════════════════════════════════════════════
            if (registration.aadhar_proof_url) {
                const aadharPath = path.join(__dirname, '..', 'public', registration.aadhar_proof_url);
                if (fs.existsSync(aadharPath)) {
                    const ext = path.extname(aadharPath).toLowerCase();
                    if (['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(ext)) {
                        doc.addPage({ margin: 50, size: 'A4' });

                        // Header
                        doc.rect(0, 0, doc.page.width, 10).fill('#667eea');
                        doc.rect(0, 10, doc.page.width, 5).fill('#764ba2');

                        doc.y = 30;
                        doc.fontSize(16).fillColor('#1f2937').text('IDENTITY DOCUMENT - AADHAR CARD', { align: 'center' });
                        if (hasTamilFont) {
                            doc.font('Tamil').fontSize(12).fillColor('#6b7280').text('அடையாள ஆவணம் - ஆதார் அட்டை', { align: 'center' });
                            doc.font('Helvetica');
                        }
                        doc.moveDown(0.5);

                        doc.fontSize(10).fillColor('#4b5563');
                        doc.text(`Employee / ஊழியர்: ${registration.full_name}`, { align: 'center' });
                        if (registration.aadhar_number) {
                            doc.text(`Aadhar No / ஆதார் எண்: ${registration.aadhar_number.replace(/(\d{4})/g, '$1 ').trim()}`, { align: 'center' });
                        }
                        doc.moveDown(1);
                        doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).stroke('#e5e7eb');
                        doc.moveDown(1);

                        // Embed the Aadhar image
                        try {
                            const maxWidth = doc.page.width - 100;
                            const maxHeight = doc.page.height - doc.y - 80;
                            doc.image(aadharPath, 50, doc.y, {
                                fit: [maxWidth, maxHeight],
                                align: 'center',
                                valign: 'center'
                            });
                        } catch (imgErr) {
                            doc.fontSize(10).fillColor('#ef4444').text('(Aadhar document could not be embedded)', { align: 'center' });
                        }

                        // Footer
                        const aBottomY = doc.page.height - 25;
                        doc.rect(0, aBottomY - 5, doc.page.width, 5).fill('#764ba2');
                        doc.rect(0, aBottomY, doc.page.width, 10).fill('#667eea');
                        doc.fontSize(7).fillColor('#ffffff').text('Attached document for verification purposes only', 0, aBottomY + 1, { align: 'center', width: doc.page.width });
                    }
                }
            }

            doc.end();

            stream.on('finish', () => resolve(urlPath));
            stream.on('error', reject);
        } catch (err) {
            reject(err);
        }
    });
}

// ========================================
// STAFF: Get/Update Bank Details
// ========================================
router.get('/bank-details', requireAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT bank_account_name, bank_name, bank_account_number, bank_ifsc_code, upi_id FROM users WHERE id = ?',
            [req.user.id]
        );
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'User not found' });
        res.json({ success: true, data: rows[0] });
    } catch (error) {
        console.error('Get bank details error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch bank details' });
    }
});

router.post('/bank-details', requireAuth, async (req, res) => {
    try {
        const { bank_account_name, bank_name, bank_account_number, bank_ifsc_code, upi_id } = req.body;

        if (!bank_account_name || !bank_name || !bank_account_number || !bank_ifsc_code) {
            return res.status(400).json({ success: false, message: 'Account holder name, bank name, account number and IFSC code are required' });
        }

        // Validate IFSC format (11 chars: 4 alpha + 0 + 6 alphanumeric)
        if (!/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(bank_ifsc_code)) {
            return res.status(400).json({ success: false, message: 'Invalid IFSC code format' });
        }

        await pool.query(
            `UPDATE users SET bank_account_name = ?, bank_name = ?, bank_account_number = ?, bank_ifsc_code = ?, upi_id = ? WHERE id = ?`,
            [bank_account_name, bank_name, bank_account_number, bank_ifsc_code, upi_id || null, req.user.id]
        );

        res.json({ success: true, message: 'Bank details saved successfully' });
    } catch (error) {
        console.error('Save bank details error:', error);
        res.status(500).json({ success: false, message: 'Failed to save bank details' });
    }
});

// ========================================
// ADMIN: View staff bank details
// ========================================
router.get('/bank-details/:userId', requireAuth, requirePermission('staff_registrations', 'view'), async (req, res) => {
    try {
        const [rows] = await pool.query(
            'SELECT bank_account_name, bank_name, bank_account_number, bank_ifsc_code, upi_id FROM users WHERE id = ?',
            [req.params.userId]
        );
        if (rows.length === 0) return res.status(404).json({ success: false, message: 'User not found' });
        res.json({ success: true, data: rows[0] });
    } catch (error) {
        console.error('Get staff bank details error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch bank details' });
    }
});

// ========================================
// ADMIN: Update staff bank details
// ========================================
router.post('/bank-details/:userId', requireAuth, requirePermission('staff_registrations', 'approve'), async (req, res) => {
    try {
        const { bank_account_name, bank_name, bank_account_number, bank_ifsc_code, upi_id } = req.body;

        if (!bank_account_name || !bank_name || !bank_account_number || !bank_ifsc_code) {
            return res.status(400).json({ success: false, message: 'Account holder name, bank name, account number and IFSC code are required' });
        }

        if (!/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(bank_ifsc_code)) {
            return res.status(400).json({ success: false, message: 'Invalid IFSC code format' });
        }

        const [user] = await pool.query('SELECT id FROM users WHERE id = ?', [req.params.userId]);
        if (user.length === 0) return res.status(404).json({ success: false, message: 'User not found' });

        await pool.query(
            `UPDATE users SET bank_account_name = ?, bank_name = ?, bank_account_number = ?, bank_ifsc_code = ?, upi_id = ? WHERE id = ?`,
            [bank_account_name, bank_name, bank_account_number, bank_ifsc_code, upi_id || null, req.params.userId]
        );

        res.json({ success: true, message: 'Bank details updated successfully' });
    } catch (error) {
        console.error('Update staff bank details error:', error);
        res.status(500).json({ success: false, message: 'Failed to update bank details' });
    }
});

// ========================================
// ADMIN: Get offer letter editable data
// ========================================
router.get('/registrations/:id/offer-letter-data', requireAuth, requirePermission('staff_registrations', 'view'), async (req, res) => {
    try {
        const [regs] = await pool.query(`
            SELECT sr.*, b.name as branch_name
            FROM staff_registrations sr
            LEFT JOIN branches b ON sr.assigned_branch_id = b.id
            WHERE sr.id = ? AND sr.status = 'approved'
        `, [req.params.id]);

        if (regs.length === 0) {
            return res.status(404).json({ success: false, message: 'Approved registration not found' });
        }

        const reg = regs[0];

        // Try to get saved custom content
        let savedContent = null;
        try {
            if (reg.offer_letter_content) {
                savedContent = JSON.parse(reg.offer_letter_content);
            }
        } catch(e) {}

        // Get company settings
        let companyName = 'Quality Colours';
        let companyAddress = 'Thanjavur, Tamil Nadu';
        try {
            const [settings] = await pool.query(
                "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('business_name', 'business_address')"
            );
            settings.forEach(s => {
                if (s.setting_key === 'business_name' && s.setting_value) companyName = s.setting_value;
                if (s.setting_key === 'business_address' && s.setting_value) companyAddress = s.setting_value;
            });
        } catch(e) {}

        const position = reg.assigned_role ? (reg.assigned_role.charAt(0).toUpperCase() + reg.assigned_role.slice(1)) : 'Staff';
        const branchName = reg.branch_name || 'Head Office';

        const defaultTerms = [
            'This offer is valid for acceptance within 7 days from the date of issuance. Non-acceptance within this period will render this offer void.',
            'You will be on probation for a period of 3 months from the date of joining. Your appointment will be confirmed upon satisfactory completion of the probation period.',
            'During probation, either party may terminate the employment with 15 days written notice or salary in lieu thereof. After confirmation, a notice period of 30 days is applicable.',
            'You are expected to work the full scheduled hours, maintain punctuality, and adhere to all company policies, rules and regulations.',
            'Your salary is subject to applicable tax deductions (TDS) as per Income Tax Act and other statutory deductions as per government regulations.',
            'You shall not disclose any confidential information of the company to any third party during or after your employment.',
            'The company reserves the right to transfer you to any department, branch, or location based on business requirements.',
            'You are entitled to leave as per the company\'s leave policy. Unauthorized absence may result in deductions or disciplinary action.',
            'Any form of misconduct, negligence, insubordination, or breach of company policy may result in disciplinary action including termination.',
            'You are required to submit all original educational certificates and identity proofs at the time of joining for verification.'
        ];

        const defaultTamilTerms = [
            'இந்த வாய்ப்பு கடிதம் வழங்கப்பட்ட நாளிலிருந்து 7 நாட்களுக்குள் ஏற்றுக்கொள்ளப்பட வேண்டும். இக்காலத்திற்குள் ஏற்கப்படாவிட்டால் இது செல்லாது.',
            'நீங்கள் சேர்ந்த நாளிலிருந்து 3 மாதங்கள் சோதனைக் காலத்தில் இருப்பீர்கள். திருப்திகரமான சோதனைக் காலம் முடிந்ததும் உங்கள் நியமனம் உறுதி செய்யப்படும்.',
            'சோதனைக் காலத்தில், இருதரப்பும் 15 நாட்கள் எழுத்துப்பூர்வ அறிவிப்பு அல்லது ஊதியத்துடன் வேலையை நிறுத்தலாம். உறுதிப்படுத்தலுக்குப் பிறகு 30 நாட்கள் அறிவிப்புக் காலம் பொருந்தும்.',
            'நீங்கள் முழு வேலை நேரம் பணிபுரிய வேண்டும், நேரம் தவறாமை கடைப்பிடிக்க வேண்டும், மற்றும் நிறுவனத்தின் அனைத்து கொள்கைகள் மற்றும் விதிகளைப் பின்பற்ற வேண்டும்.',
            'உங்கள் ஊதியம் வருமான வரிச் சட்டம் மற்றும் அரசு விதிகளின்படி பொருந்தும் வரி விலக்குகளுக்கு உட்பட்டது.',
            'நிறுவனத்தின் எந்தவொரு ரகசிய தகவலையும் வேலையின் போது அல்லது பின்னர் மூன்றாம் தரப்பினருக்கு வெளிப்படுத்தக் கூடாது.',
            'வணிகத் தேவைகளின் அடிப்படையில் நிறுவனம் உங்களை எந்த துறை, கிளை அல்லது இடத்திற்கும் மாற்றும் உரிமையைக் கொண்டுள்ளது.',
            'நிறுவனத்தின் விடுப்புக் கொள்கையின்படி விடுப்பு பெறலாம். அங்கீகரிக்கப்படாத விடுப்பு ஊதிய விலக்கு அல்லது ஒழுங்கு நடவடிக்கைக்கு வழிவகுக்கும்.',
            'தவறான நடத்தை, கவனக்குறைவு, கீழ்ப்படியாமை அல்லது நிறுவனக் கொள்கை மீறல் ஆகியவை பணிநீக்கம் உள்ளிட்ட ஒழுங்கு நடவடிக்கைக்கு வழிவகுக்கும்.',
            'சேரும் நேரத்தில் அசல் கல்வி சான்றிதழ்கள் மற்றும் அடையாள ஆவணங்களை சரிபார்ப்புக்காக சமர்ப்பிக்க வேண்டும்.'
        ];

        const defaultOfferText = `With reference to your application and subsequent discussions, we are pleased to offer you the position of "${position}" at ${companyName}, ${branchName} Branch. We were impressed with your profile and believe you will be a valuable addition to our team.`;

        const defaultTamilOfferText = `உங்கள் விண்ணப்பம் மற்றும் அதன் பின்னரான விவாதங்களைக் குறிப்பிட்டு, ${companyName} நிறுவனத்தின் ${branchName} கிளையில் "${position}" பதவிக்கு உங்களுக்கு வேலை வாய்ப்பு வழங்குவதில் மகிழ்ச்சி அடைகிறோம். உங்கள் திறமைகள் எங்கள் குழுவிற்கு மதிப்புமிக்க பங்களிப்பாக இருக்கும் என நம்புகிறோம்.`;

        const defaultData = {
            company_name: companyName,
            company_address: companyAddress,
            employee_name: reg.full_name,
            position: position,
            branch_name: branchName,
            ref_number: `QC/OL/${new Date().getFullYear()}/${String(reg.id).padStart(4, '0')}`,
            letter_date: new Date(reg.approved_at || Date.now()).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }),
            joining_date: reg.joining_date ? new Date(reg.joining_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : '',
            monthly_salary: parseFloat(reg.monthly_salary || 0),
            transport_allowance: parseFloat(reg.transport_allowance || 0),
            food_allowance: parseFloat(reg.food_allowance || 0),
            other_allowance: parseFloat(reg.other_allowance || 0),
            offer_text: defaultOfferText,
            tamil_offer_text: defaultTamilOfferText,
            terms: defaultTerms,
            tamil_terms: defaultTamilTerms,
            offer_letter_url: reg.offer_letter_url,
            aadhar_proof_url: reg.aadhar_proof_url,
            aadhar_number: reg.aadhar_number
        };

        // Merge with saved custom content (preserve offer_letter_url from DB)
        const data = savedContent ? { ...defaultData, ...savedContent, offer_letter_url: reg.offer_letter_url } : defaultData;

        res.json({ success: true, data });
    } catch (error) {
        console.error('Get offer letter data error:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch offer letter data' });
    }
});

// ========================================
// ADMIN: Regenerate offer letter with edits
// ========================================
router.post('/registrations/:id/regenerate-offer-letter', requireAuth, requirePermission('staff_registrations', 'approve'), async (req, res) => {
    try {
        const [regs] = await pool.query(
            "SELECT * FROM staff_registrations WHERE id = ? AND status = 'approved'",
            [req.params.id]
        );
        if (regs.length === 0) {
            return res.status(404).json({ success: false, message: 'Approved registration not found' });
        }

        const reg = regs[0];
        const customContent = req.body;

        // Delete old offer letter file if exists
        if (reg.offer_letter_url) {
            const oldPath = path.join(__dirname, '..', 'public', reg.offer_letter_url);
            try { fs.unlinkSync(oldPath); } catch(e) {}
        }

        // Generate new PDF with custom content
        const offerLetterPath = await generateOfferLetter(reg, {
            assigned_role: reg.assigned_role,
            assigned_branch_id: reg.assigned_branch_id,
            joining_date: reg.joining_date,
            monthly_salary: customContent.monthly_salary != null ? customContent.monthly_salary : reg.monthly_salary,
            transport_allowance: customContent.transport_allowance != null ? customContent.transport_allowance : (reg.transport_allowance || 0),
            food_allowance: customContent.food_allowance != null ? customContent.food_allowance : (reg.food_allowance || 0),
            other_allowance: customContent.other_allowance != null ? customContent.other_allowance : (reg.other_allowance || 0)
        }, null, customContent);

        // Save custom content and new URL - handle missing column gracefully
        const contentJson = JSON.stringify(customContent);
        try {
            await pool.query(
                'UPDATE staff_registrations SET offer_letter_url = ?, offer_letter_content = ? WHERE id = ?',
                [offerLetterPath, contentJson, req.params.id]
            );
        } catch(e) {
            if (e.code === 'ER_BAD_FIELD_ERROR') {
                try {
                    await pool.query('ALTER TABLE staff_registrations ADD COLUMN offer_letter_content TEXT NULL');
                    await pool.query(
                        'UPDATE staff_registrations SET offer_letter_url = ?, offer_letter_content = ? WHERE id = ?',
                        [offerLetterPath, contentJson, req.params.id]
                    );
                } catch(e2) {
                    await pool.query('UPDATE staff_registrations SET offer_letter_url = ? WHERE id = ?',
                        [offerLetterPath, req.params.id]);
                }
            } else {
                throw e;
            }
        }

        // Reset sent status since content changed
        await pool.query(
            'UPDATE staff_registrations SET offer_letter_sent = FALSE, offer_letter_sent_at = NULL WHERE id = ?',
            [req.params.id]
        );

        res.json({ success: true, data: { offer_letter_url: offerLetterPath }, message: 'Offer letter regenerated successfully' });
    } catch (error) {
        console.error('Regenerate offer letter error:', error);
        res.status(500).json({ success: false, message: 'Failed to regenerate offer letter' });
    }
});

module.exports = {
    router,
    setPool
};
