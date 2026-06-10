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
const http = require('http');
const cors = require('cors');
const bcrypt = require('bcrypt');
const sharp = require('sharp');
const path = require('path');
require('dotenv').config();
const { Server: SocketIO } = require('socket.io');

// Import middleware
const { initPool, requirePermission, requireAnyPermission, requireAuth, requireRole, isFullAdmin, FULL_ADMIN_ROLES, invalidateUser } = require('./middleware/permissionMiddleware');

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
const rateLimiter = require('./services/zoho-rate-limiter');
const chatRoutes = require('./routes/chat');
const notificationRoutes = require('./routes/notifications');
const estimatePdfRoutes = require('./routes/estimate-pdf');
const estimateRoutes = require('./routes/estimates');
const shareRoutes = require('./routes/share');
const notificationService = require('./services/notification-service');
const autoClockout = require('./services/auto-clockout');
const websiteRoutes = require('./routes/website');
const guidesRoutes = require('./routes/guides');
const stockCheckRoutes = require('./routes/stock-check');
const stockMigrationRoutes = require('./routes/stock-migration');
const collectionsRoutes = require('./routes/collections');
const whatsappSessionManager = require('./services/whatsapp-session-manager');
const whatsappSessionsRoutes = require('./routes/whatsapp-sessions');
const waMarketingRoutes = require('./routes/wa-marketing');
const waCampaignEngine = require('./services/wa-campaign-engine');
const attendanceReport = require('./services/attendance-report');
const whatsappChatRoutes = require('./routes/whatsapp-chat');
const waContactsRoutes = require('./routes/wa-contacts');
const aiRoutes = require('./routes/ai');
const aiScheduler = require('./services/ai-scheduler');
const paintersRoutes = require('./routes/painters');
const engineersRoutes = require('./routes/engineers');
const painterMarketingRoutes = require('./routes/painter-marketing');
const adminNotificationsRoutes = require('./routes/admin-notifications');
const billingRoutes = require('./routes/billing');
const vendorRoutes = require('./routes/vendors');
const painterScheduler = require('./services/painter-scheduler');
const dataRetentionService = require('./services/data-retention-service');
const leadReminderScheduler = require('./services/lead-reminder-scheduler');
const leadAutoAssignScheduler = require('./services/lead-auto-assign-scheduler');
const appMetadataCollector = require('./services/app-metadata-collector');
const systemRoutes = require('./routes/system');
const creditLimitRoutes = require('./routes/credit-limits');
const errorHandlerMw = require('./middleware/errorHandler');
const { globalLimiter, publicUploadLimiter } = require('./middleware/rateLimiter');
const customerAuthService = require('./services/customer-auth');
const systemHealthService = require('./services/system-health-service');
const errorAnalysisService = require('./services/error-analysis-service');
const aiEngineForErrors = require('./services/ai-engine');
const automationRegistry = require('./services/automation-registry');
const adminDashboardRoutes = require('./routes/admin-dashboard');
const anomalyRoutes = require('./routes/anomalies');
const anomalyDetector = require('./services/anomaly-detector');
const productionMonitor = require('./services/production-monitor');
const responseTracker = require('./middleware/responseTracker');
const painterNotificationService = require('./services/painter-notification-service');
const staffDailyWorkRoutes = require('./routes/staff-daily-work');
const staffTaskGenerator = require('./services/staff-task-generator');
const activityFeedRoutes = require('./routes/activity-feed');
const activityFeed = require('./services/activity-feed');
const activityTrackerService = require('./services/activity-tracker-service');
const activityTrackerRoutes = require('./routes/activity-tracker');
const itemMasterRoutes = require('./routes/item-master');
const fcmAdmin = require('./services/fcm-admin');
const monitoringRoutes = require('./routes/monitoring');
const photosRoutes = require('./routes/photos');
const agreementsRoutes = require('./routes/agreements');
const twoFARoutes = require('./routes/auth-2fa');
const priceListRoutes = require('./routes/price-list');
const authInlineRoutes = require('./routes/auth');
const paintColorsRoutes = require('./routes/paint-colors');
const productsInlineRoutes = require('./routes/products');
const customerPortalRoutes = require('./routes/customer-portal');

const app = express();
app.set('trust proxy', 1); // Trust first proxy (nginx/aaPanel)

// Global error buffer for App Analyzer
global._appErrorBuffer = global._appErrorBuffer || [];
const _originalConsoleError = console.error;
console.error = function(...args) {
    _originalConsoleError.apply(console, args);
    try {
        const message = args.map(a => typeof a === 'string' ? a : (a instanceof Error ? a.message : JSON.stringify(a))).join(' ');
        global._appErrorBuffer.push({ message: message.substring(0, 500), stack: (args.find(a => a instanceof Error))?.stack || '', timestamp: new Date().toISOString() });
        if (global._appErrorBuffer.length > 100) global._appErrorBuffer.shift();
    } catch (e) { /* never break error logging */ }
};

// ========================================
// MIDDLEWARE SETUP
// ========================================

// Helmet sets security headers (X-Content-Type-Options, X-Frame-Options, etc.)
// plus a permissive Content-Security-Policy that whitelists the third-party
// CDNs in active use across the public/ pages. Stricter CSP (drop
// 'unsafe-inline' / 'unsafe-eval', narrow connect-src) is a follow-up that
// requires migrating remaining inline-script handlers first.
// NOTE: CSP is allowlist-based, so any host NOT in script-src/style-src is
// blocked by default — this includes cdn.tailwindcss.com (we use the local
// JIT pipeline; postinstall builds public/css/tailwind.css). If a page
// regresses to the CDN, the browser will block-and-report, not silently load.
app.use(require('helmet')({
    contentSecurityPolicy: {
        useDefaults: true,
        directives: {
            "default-src": ["'self'"],
            "script-src": [
                "'self'", "'unsafe-inline'", "'unsafe-eval'",
                "https://cdn.jsdelivr.net",
                "https://cdnjs.cloudflare.com",
                "https://unpkg.com",
                "https://cdn.quilljs.com",
                "https://cdn.socket.io",
                "https://www.googletagmanager.com",
                "https://www.youtube.com"
            ],
            "script-src-attr": ["'unsafe-inline'"],
            "style-src": [
                "'self'", "'unsafe-inline'",
                "https://fonts.googleapis.com",
                "https://cdnjs.cloudflare.com",
                "https://cdn.jsdelivr.net",
                "https://cdn.quilljs.com",
                "https://unpkg.com"
            ],
            "font-src": ["'self'", "data:", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
            "img-src": ["'self'", "data:", "blob:", "https:"],
            "media-src": ["'self'", "blob:", "https:"],
            "connect-src": ["'self'", "wss:", "https:"],
            "frame-src": ["'self'", "https://www.youtube.com", "https://wa.me"],
            "frame-ancestors": ["'self'"],
            "object-src": ["'none'"],
            "base-uri": ["'self'"],
            "upgrade-insecure-requests": []
        }
    }
}));

// gzip / br response compression for /api/*
app.use(require('compression')());

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

// Rate limiting — global on all API routes
app.use('/api', globalLimiter);

// Response time tracking
app.use(responseTracker.middleware);

// (Static mounts moved below — they now sit after pool/auth init so that
// the PII-upload gate at /uploads/aadhar and /uploads/documents can use
// the DB pool to verify the requester's session.)

// Applink referral short URL: https://act.qcpaintshop.com/r/{code}
// On Android (painter app installed + verified assetlinks), this opens the app's
// Register screen with the ref code prefilled. On web or uninstalled devices, we
// fall back to the existing painter-register.html page carrying the same ref.
app.get('/r/:code', (req, res) => {
    const code = (req.params.code || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
    res.redirect(302, `/painter-register.html?ref=${encodeURIComponent(code)}`);
});

// ========================================
// DATABASE CONNECTION
// ========================================

const { createPool } = require('./config/database');
const pool = createPool();

// ── PII upload gate (must sit BEFORE express.static so it intercepts) ──
// /uploads/aadhar and /uploads/documents hold Aadhar scans and offer
// letter PDFs. Block direct URL access; only privileged roles can read
// these files via the static path. The dedicated API routes
// (e.g. GET /api/staff/registrations/:id/offer-letter) handle
// owner-can-read-their-own logic separately.
// S5: roles aligned with FULL_ADMIN_ROLES (super_admin/administrator were
// 403'd before) + manager/hr; Bearer header ONLY — ?token= support dropped
// (bearer tokens were landing in access logs; no page used it — verified).
const PII_PRIVILEGED_ROLES = new Set([...FULL_ADMIN_ROLES, 'manager', 'hr']);
app.use(['/uploads/aadhar', '/uploads/documents'], async (req, res, next) => {
    try {
        const token = req.headers.authorization?.replace('Bearer ', '');
        if (!token) return res.status(401).send('Unauthorized');
        const [sessions] = await pool.query(
            `SELECT u.role FROM user_sessions s JOIN users u ON s.user_id = u.id
             WHERE s.token_hash = LOWER(SHA2(?, 256)) AND s.expires_at > NOW() AND u.status = 'active'`,
            [token]
        );
        if (sessions.length === 0) return res.status(401).send('Unauthorized');
        if (!PII_PRIVILEGED_ROLES.has(String(sessions[0].role).toLowerCase())) {
            return res.status(403).send('Forbidden');
        }
        next();
    } catch (err) {
        console.error('[pii-gate]', err);
        res.status(500).send('Server error');
    }
});

// KN-P2-5: never let user-uploaded content render inline. Force a download and
// block MIME sniffing on everything served under /uploads (covers both
// public/uploads/* and the top-level uploads/* roots). Embedded <img>/<video>
// still display — browsers ignore Content-Disposition for subresource loads;
// only direct navigation to an upload URL downloads, so a spoofed HTML/SVG
// cannot execute in our origin.
app.use('/uploads', (req, res, next) => {
    res.setHeader('Content-Disposition', 'attachment');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    next();
});

app.use(express.static('public'));
app.use('/uploads', express.static('uploads'));

// Initialize shared pool for middleware and all route modules
initPool(pool);
customerAuthService.setPool(pool);
attendanceRoutes.setPool(pool);
attendanceRoutes.setActivityTrackerService(activityTrackerService);
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
whatsappProcessor.setSessionManager(whatsappSessionManager);
rateLimiter.setPool(pool); // Enable DB persistence for API call tracking
chatRoutes.setPool(pool);
notificationRoutes.setPool(pool);
estimatePdfRoutes.setPool(pool);
estimateRoutes.setPool(pool);
shareRoutes.setPool(pool);
notificationService.setPool(pool);
autoClockout.setPool(pool);
autoClockout.setActivityTrackerService(activityTrackerService);
websiteRoutes.setPool(pool);
guidesRoutes.setPool(pool);
stockCheckRoutes.setPool(pool);
stockMigrationRoutes.setPool(pool);
collectionsRoutes.setPool(pool);
whatsappSessionManager.setPool(pool);
whatsappSessionsRoutes.setPool(pool);
whatsappSessionsRoutes.setSessionManager(whatsappSessionManager);
waMarketingRoutes.setPool(pool);
waMarketingRoutes.setCampaignEngine(waCampaignEngine);
waMarketingRoutes.setSessionManager(whatsappSessionManager);
waCampaignEngine.setPool(pool);
waCampaignEngine.setSessionManager(whatsappSessionManager);
attendanceReport.setPool(pool);
attendanceReport.setSessionManager(whatsappSessionManager);
attendanceRoutes.setReportService(attendanceReport);
whatsappChatRoutes.setPool(pool);
whatsappChatRoutes.setSessionManager(whatsappSessionManager);
waContactsRoutes.setPool(pool);
aiRoutes.setPool(pool);
appMetadataCollector.setPool(pool);
aiRoutes.setCollector(appMetadataCollector);
aiScheduler.setPool(pool);
paintersRoutes.setPool(pool);
painterMarketingRoutes.setPool(pool);
if (typeof painterMarketingRoutes.setSessionManager === 'function') {
    painterMarketingRoutes.setSessionManager(whatsappSessionManager);
}
paintersRoutes.setSessionManager(whatsappSessionManager);
engineersRoutes.setPool(pool);
engineersRoutes.setSessionManager(whatsappSessionManager);
adminNotificationsRoutes.setPool(pool);
billingRoutes.setPool(pool);
billingRoutes.setPointsEngine(require('./services/painter-points-engine'));
vendorRoutes.setPool(pool);
painterScheduler.setPool(pool);
dataRetentionService.setPool(pool);
require('./services/audit-log').setPool(pool);
leadAutoAssignScheduler.setPool(pool);
leadReminderScheduler.init(pool, notificationService);
aiScheduler.setSessionManager(whatsappSessionManager);
systemRoutes.setPool(pool);
creditLimitRoutes.setPool(pool);
systemHealthService.setPool(pool);
errorAnalysisService.setPool(pool);
errorAnalysisService.setAiEngine(aiEngineForErrors);
aiEngineForErrors.setPool(pool);
errorHandlerMw.setPool(pool);
errorHandlerMw.setErrorAnalysisService(errorAnalysisService);
anomalyRoutes.setPool(pool);
anomalyDetector.setPool(pool);
productionMonitor.setPool(pool);
staffDailyWorkRoutes.setPool(pool);
staffTaskGenerator.setPool(pool);
activityFeedRoutes.setPool(pool);
activityFeed.setPool(pool);
activityTrackerService.setPool(pool);
activityTrackerService.setNotificationService(notificationService);
activityTrackerRoutes.setPool(pool);
activityTrackerRoutes.setActivityService(activityTrackerService);
activityTrackerRoutes.setNotificationService(notificationService);
activityTrackerRoutes.setReportService(attendanceReport);
monitoringRoutes.setPool(pool);
photosRoutes.setPool(pool);
if (itemMasterRoutes.setPool) itemMasterRoutes.setPool(pool);
agreementsRoutes.setPool(pool);
twoFARoutes.setPool(pool);
priceListRoutes.setPool(pool);
authInlineRoutes.setPool(pool);
paintColorsRoutes.setPool(pool);
productsInlineRoutes.setPool(pool);
customerPortalRoutes.setPool(pool);
const invoiceLineSync = require('./services/zoho-invoice-line-sync');
invoiceLineSync.setPool(pool);
const reorderCompute = require('./services/reorder-compute-service');
reorderCompute.setPool(pool);
const reorderReport = require('./services/reorder-report-service');
reorderReport.setPool(pool);
const vendorItemMapper = require('./services/vendor-item-mapper');
vendorItemMapper.setPool(pool);
const branchScopeMiddleware = require('./middleware/branchScope');
branchScopeMiddleware.setPool(pool);
monitoringRoutes.setAutomationRegistry(automationRegistry);
monitoringRoutes.setResponseTracker(responseTracker);
monitoringRoutes.setProductionMonitor(productionMonitor);
productionMonitor.setNotificationService(notificationService);
productionMonitor.setResponseTracker(responseTracker);

// ========================================
// FILE UPLOAD CONFIG
// ========================================

const { ensureUploadDirs, uploadLogo, uploadProfile, uploadAadhar, designRequestUpload } = require('./config/uploads');
ensureUploadDirs();

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
app.use('/api/activity-tracker', activityTrackerRoutes.router);
app.use('/api/chat', chatRoutes.router);
app.use('/api/notifications', notificationRoutes.router);
app.use('/api/estimates', estimatePdfRoutes.router);
app.use('/api/estimates', requireAuth, estimateRoutes.router);
app.use('/api/share', shareRoutes.router);
app.use('/api/website', websiteRoutes.router);
app.use('/api/guides', guidesRoutes.router);
app.use('/api/stock-check', stockCheckRoutes.router);
app.use('/api/zoho/migration', stockMigrationRoutes.router);
app.use('/api/zoho/collections', collectionsRoutes.router);
app.use('/api/zoho/whatsapp-sessions', whatsappSessionsRoutes.router);
app.use('/api/wa-marketing', waMarketingRoutes.router);
app.use('/api/whatsapp-chat', whatsappChatRoutes.router);
app.use('/api/wa-contacts', waContactsRoutes.router);
app.use('/api/ai', aiRoutes.router);
app.use('/api/painters', paintersRoutes.router);
app.use('/api/engineers', engineersRoutes.router);
app.use('/api/painter-marketing', painterMarketingRoutes.router);
app.use('/api/admin-notifications', adminNotificationsRoutes.router);
app.use('/api/billing', billingRoutes.router);
app.use('/api/vendors', vendorRoutes.router);
app.use('/api/system', systemRoutes.router);
app.use('/api/credit-limits', creditLimitRoutes.router);
app.use('/api/admin/dashboard', adminDashboardRoutes.router);
app.use('/api/anomalies', anomalyRoutes.router);
app.use('/api/staff/daily-work', staffDailyWorkRoutes.router);
app.use('/api/activity-feed', activityFeedRoutes.router);
app.use('/api/monitoring', monitoringRoutes.router);
app.use('/api/photos', photosRoutes.router);
app.use('/api/item-master', itemMasterRoutes.router);
app.use('/api/agreements', agreementsRoutes.router);
app.use('/api/2fa', twoFARoutes);
app.use('/api/price-list', priceListRoutes.router);

// Share page routes (serve HTML for public share links)
app.get('/share/estimate/:token', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'share', 'estimate.html'));
});
app.get('/share/painter-estimate/:token', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'share', 'painter-estimate.html'));
});
app.get('/share/design-request/:token', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'share', 'design-request.html'));
});

// Zoho OAuth callback redirect (Zoho app configured with /oauth/callback)
app.get('/oauth/callback', (req, res) => {
    const query = new URLSearchParams(req.query).toString();
    res.redirect(`/api/zoho/oauth/callback${query ? '?' + query : ''}`);
});


// ========================================
// AUTHENTICATION ENDPOINTS
// ========================================
// A1: the 14 inline auth/OTP endpoints (/api/auth/*, /api/otp/*) moved
// verbatim to routes/auth.js. Mounted here so Express matching order is
// unchanged relative to the routes registered above/below this line.
app.use('/api', authInlineRoutes.router);

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
        console.error('public site-info error:', err);
        res.status(500).json({ success: false, error: 'Server error' });
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
        console.error('public branches error:', err);
        res.status(500).json({ success: false, error: 'Server error' });
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
        console.error('public brands error:', err);
        res.status(500).json({ success: false, error: 'Server error' });
    }
});

app.post('/api/public/design-requests', publicUploadLimiter, designRequestUpload.single('photo'), async (req, res) => {
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

// --- Gemini AI Image Generation ---
const { GoogleGenerativeAI } = require('@google/generative-ai');
const geminiAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;
// geminiAI is shared with the moved visualization handlers (routes/paint-colors.js)
paintColorsRoutes.setGeminiAI(geminiAI);

// GET /api/ai-status - check AI model availability
app.get('/api/ai-status', requireAuth, async (req, res) => {
    const status = {
        gemini: 'unknown',
        pollinations: 'unknown',
        modelInfo: {
            gemini: { type: 'img2img', description: 'Edits your actual building photo with new colors', free: true, recommended: true },
            pollinations: { type: 'text2img', description: 'Generates a sample building with selected colors (free unlimited)', free: true, recommended: false }
        }
    };

    // Check Gemini first (primary model)
    if (!geminiAI) {
        status.gemini = 'not_configured';
    } else {
        try {
            const model = geminiAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.0-flash-exp' });
            await model.generateContent('Say OK');
            status.gemini = 'available';
        } catch (e) {
            const msg = e.message || '';
            if (msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
                status.gemini = 'quota_exceeded';
            } else {
                status.gemini = 'error';
            }
        }
    }

    // Check Pollinations (fallback - free flux text-to-image)
    try {
        const testUrl = 'https://image.pollinations.ai/prompt/test?model=flux&width=64&height=64&nologo=true&seed=1';
        const pollRes = await fetch(testUrl, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
        status.pollinations = pollRes.ok ? 'available' : (pollRes.status === 530 ? 'down' : 'error');
    } catch (e) {
        status.pollinations = e.name === 'TimeoutError' ? 'slow' : 'down';
    }

    res.json({ success: true, data: status });
});

// A1: the 6 inline paint-colors/visualization endpoints (paint-colors
// brands/families/colors + design-requests :id/visualize, :id/visualizations,
// :id/auto-visualize) moved verbatim to routes/paint-colors.js. Mounted here
// so Express matching order is unchanged relative to the routes registered
// above/below this line.
app.use('/api', paintColorsRoutes.router);

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
        const { role, branch_id, status, assignable } = req.query;
        let query = `SELECT id, username, email, full_name, phone, role, branch_id, geo_fence_enabled, status, created_at, last_login, profile_image_url, kyc_status, aadhar_number, pan_number FROM users WHERE 1=1`;
        const params = [];

        if (assignable === '1') {
            query += " AND role IN ('staff', 'sales_staff', 'branch_manager', 'manager', 'accountant')";
            query += " AND status = 'active'";
        } else {
            if (role) { query += ' AND role = ?'; params.push(role); }
            if (status) { query += ' AND status = ?'; params.push(status); }
        }
        if (branch_id) { query += ' AND branch_id = ?'; params.push(branch_id); }

        query += ' ORDER BY created_at DESC';
        const [rows] = await pool.query(query, params);

        // Fetch assigned branches for all users
        const [allUserBranches] = await pool.query(
            `SELECT ub.user_id, ub.branch_id, ub.is_primary, b.name as branch_name
             FROM user_branches ub
             JOIN branches b ON ub.branch_id = b.id
             ORDER BY ub.is_primary DESC, b.name ASC`
        );

        // Group branches by user_id
        const branchMap = {};
        for (const ub of allUserBranches) {
            if (!branchMap[ub.user_id]) branchMap[ub.user_id] = [];
            branchMap[ub.user_id].push(ub);
        }

        // Attach assigned_branches to each user
        for (const user of rows) {
            user.assigned_branches = branchMap[user.id] || [];
        }

        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/users/:id', requireAuth, async (req, res) => {
    try {
        // Staff can only view their own profile; admin/manager can view any
        if (req.params.id != req.user.id && !isFullAdmin(req.user.role) && !['manager', 'branch_manager'].includes(req.user.role)) {
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
        if (req.body.pan_number !== undefined) { setClauses.push('pan_number = ?'); params.push(req.body.pan_number || null); }

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

        // Recompute KYC status after profile update
        await computeKycStatus(userId);

        res.json({ success: true, message: 'Profile updated successfully' });
    } catch (err) {
        console.error('Update profile error:', err);
        res.status(500).json({ error: err.message });
    }
});

// KYC status helper - checks aadhar + pan + bank details
async function computeKycStatus(userId) {
    try {
        const [rows] = await pool.query(
            `SELECT aadhar_number, aadhar_proof_url, pan_number, pan_proof_url,
                    bank_account_number, bank_ifsc_code, kyc_status
             FROM users WHERE id = ?`, [userId]
        );
        if (rows.length === 0) return;
        const u = rows[0];
        const isComplete = u.aadhar_number && u.aadhar_proof_url
            && u.pan_number && u.pan_proof_url
            && u.bank_account_number && u.bank_ifsc_code;
        const newStatus = u.kyc_status === 'verified' ? 'verified' : (isComplete ? 'complete' : 'incomplete');
        if (newStatus !== u.kyc_status) {
            await pool.query('UPDATE users SET kyc_status = ? WHERE id = ?', [newStatus, userId]);
        }
    } catch (err) {
        console.error('KYC status compute error:', err.message);
    }
}

// Upload Aadhar proof (self-service)
app.post('/api/upload/aadhar', requireAuth, uploadAadhar.single('aadhar_proof'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }
        const aadharUrl = `/uploads/aadhar/${req.file.filename}`;
        await pool.query('UPDATE users SET aadhar_proof_url = ? WHERE id = ?', [aadharUrl, req.user.id]);
        await computeKycStatus(req.user.id);
        res.json({ success: true, aadhar_proof_url: aadharUrl });
    } catch (err) {
        console.error('Aadhar upload error:', err);
        res.status(500).json({ success: false, message: 'Failed to upload Aadhar proof' });
    }
});

// Upload PAN proof (self-service) - reuses aadhar upload config (same image/PDF filter)
app.post('/api/upload/pan-proof', requireAuth, uploadAadhar.single('pan_proof'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }
        const panUrl = `/uploads/aadhar/${req.file.filename}`;
        await pool.query('UPDATE users SET pan_proof_url = ? WHERE id = ?', [panUrl, req.user.id]);
        await computeKycStatus(req.user.id);
        res.json({ success: true, pan_proof_url: panUrl });
    } catch (err) {
        console.error('PAN proof upload error:', err);
        res.status(500).json({ success: false, message: 'Failed to upload PAN proof' });
    }
});

app.put('/api/users/:id', requirePermission('staff', 'edit'), async (req, res) => {
    try {
        const { username, email, password, full_name, phone, role, branch_id, status, profile_image_url, geo_fence_enabled, branch_ids } = req.body;
        const userId = req.params.id;

        const setClauses = [];
        const params = [];

        if (username !== undefined) { setClauses.push('username = ?'); params.push(username); }
        if (email !== undefined) { setClauses.push('email = ?'); params.push(email); }
        if (full_name !== undefined) { setClauses.push('full_name = ?'); params.push(full_name); }
        if (phone !== undefined) { setClauses.push('phone = ?'); params.push(phone); }
        if (role !== undefined) { setClauses.push('role = ?'); params.push(role); }
        if (branch_id !== undefined) { setClauses.push('branch_id = ?'); params.push(branch_id); }
        if (geo_fence_enabled !== undefined) { setClauses.push('geo_fence_enabled = ?'); params.push(geo_fence_enabled ? 1 : 0); }
        if (status !== undefined) { setClauses.push('status = ?'); params.push(status); }
        if (profile_image_url !== undefined) { setClauses.push('profile_image_url = ?'); params.push(profile_image_url); }

        if (password) {
            const password_hash = await bcrypt.hash(password, 10);
            setClauses.push('password_hash = ?');
            params.push(password_hash);
        }

        if (setClauses.length === 0 && !branch_ids) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        // Accept KYC fields if provided
        if (req.body.aadhar_number !== undefined) { setClauses.push('aadhar_number = ?'); params.push(req.body.aadhar_number); }
        if (req.body.pan_number !== undefined) { setClauses.push('pan_number = ?'); params.push(req.body.pan_number); }

        if (setClauses.length > 0) {
            params.push(userId);
            await pool.query(`UPDATE users SET ${setClauses.join(', ')} WHERE id = ?`, params);
        }

        // Sync user_branches if branch_ids provided
        if (branch_ids && Array.isArray(branch_ids)) {
            const primaryBranchId = branch_id || null;
            // Remove existing assignments
            await pool.query('DELETE FROM user_branches WHERE user_id = ?', [userId]);
            // Insert new assignments
            for (const bid of branch_ids) {
                await pool.query(
                    'INSERT INTO user_branches (user_id, branch_id, is_primary) VALUES (?, ?, ?)',
                    [userId, bid, bid == primaryBranchId ? 1 : 0]
                );
            }
        }

        // Recompute KYC status after update
        await computeKycStatus(userId);

        // Notify user if admin changed their role, status, or branch.
        // Fire-and-forget so SMTP / push delays never block the API response.
        if ((role !== undefined || status !== undefined || branch_id !== undefined) && parseInt(userId) !== req.user.id) {
            const changes = [];
            if (role) changes.push(`Role: ${role}`);
            if (status) changes.push(`Status: ${status}`);
            if (branch_id) changes.push('Branch updated');

            setImmediate(async () => {
                try {
                    const notificationService = require('./services/notification-service');
                    await notificationService.send(parseInt(userId), {
                        type: 'profile_updated', title: 'Profile Updated',
                        body: `Your profile has been updated. ${changes.join(', ')}`,
                        data: { type: 'profile_updated' }
                    });
                } catch (notifErr) {
                    console.error('Profile update notification error:', notifErr.message);
                }

                try {
                    const [updatedUser] = await pool.query('SELECT email, full_name FROM users WHERE id = ?', [userId]);
                    if (updatedUser.length > 0 && updatedUser[0].email) {
                        const emailService = require('./services/email-service');
                        await emailService.send(updatedUser[0].email, 'Profile Updated - Quality Colours', `
                            <h2 style="color: #333;">Hello ${updatedUser[0].full_name},</h2>
                            <p>Your profile has been updated by an administrator.</p>
                            <div style="background: white; border-left: 4px solid #667eea; padding: 15px; margin: 20px 0; border-radius: 4px;">
                                <p style="margin: 0; color: #4b5563;">${changes.join('<br>')}</p>
                            </div>
                            <p>If you have any questions, please contact your manager.</p>
                        `);
                    }
                } catch (emailErr) {
                    console.error('Profile update email error:', emailErr.message);
                }
            });
        }

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

        if (isFullAdmin(user[0].role)) {
            const [admins] = await pool.query(
                "SELECT COUNT(*) as count FROM users WHERE role IN ('admin','administrator','super_admin') AND status = 'active'"
            );
            if (admins[0].count <= 1) {
                return res.status(400).json({ error: 'Cannot delete the last admin user' });
            }
        }

        // Soft delete instead of hard delete
        await pool.query('UPDATE users SET status = ? WHERE id = ?', ['inactive', userId]);
        await pool.query('DELETE FROM user_sessions WHERE user_id = ?', [userId]);
        invalidateUser(parseInt(userId, 10));

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

// A1: the 16 inline products endpoints (/api/products/*) moved verbatim to
// routes/products.js. Mounted here so Express matching order is unchanged
// relative to the routes registered above/below this line.
app.use('/api', productsInlineRoutes.router);

// ========================================
// CUSTOMER PORTAL
// ========================================

// A1: the 10 inline customer portal endpoints (/api/customer/auth/* and
// /api/customer/me/*) moved verbatim to routes/customer-portal.js. Mounted here
// so Express matching order is unchanged relative to the routes registered
// above/below this line.
app.use('/api', customerPortalRoutes.router);

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
// ESTIMATES — moved to routes/estimates.js
// ========================================

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
        console.error('/api/test DB ping failed:', err);
        res.status(500).json({ error: 'Database connection failed' });
    }
});

// API status (moved off `/` so Express static can serve public/index.html as the public landing page)
app.get('/api/status', (req, res) => {
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
// 404 HANDLER — serves custom 404 page for all unmatched non-API routes
// Must be placed AFTER all real routes and BEFORE the error handler.
// ========================================

app.use((req, res, next) => {
  if (!req.path.startsWith('/api/') && !req.path.startsWith('/socket.io/')) {
    res.status(404).sendFile(path.join(__dirname, 'public', '404.html'));
  } else {
    next();
  }
});

// ========================================
// ERROR HANDLING
// ========================================

app.use(errorHandlerMw.globalErrorHandler);

// ========================================
// START SERVER
// ========================================

// ========================================
// HTTP SERVER + SOCKET.IO
// ========================================

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

// Initialize Socket.io
const io = new SocketIO(server, {
    cors: {
        origin: function (origin, callback) {
            if (!origin) return callback(null, true);
            if (allowedOrigins.includes(origin)) return callback(null, true);
            if (process.env.NODE_ENV !== 'production') {
                try {
                    const url = new URL(origin);
                    const host = url.hostname;
                    if (host.startsWith('192.168.') || host.startsWith('10.') ||
                        host.startsWith('172.') || host === 'localhost') {
                        return callback(null, true);
                    }
                } catch (e) {}
            }
            return callback(new Error('Not allowed by CORS'));
        },
        credentials: true
    }
});

// Make io accessible to routes
app.set('io', io);

// Online user tracking for live dashboard
const onlineUsers = new Map(); // userId → Set<socketId>
app.set('onlineUsers', onlineUsers);

// Pass dependencies to admin dashboard route
adminDashboardRoutes.setDependencies({ pool, onlineUsers: () => app.get('onlineUsers'), automationRegistry });

notificationService.setIO(io);
autoClockout.setIO(io);
whatsappSessionManager.setIO(io);
waCampaignEngine.setIO(io);
waMarketingRoutes.setIO(io);
attendanceReport.setIO(io);
whatsappChatRoutes.setIO(io);
attendanceRoutes.setIO(io);
aiRoutes.setIO(io);
aiScheduler.setIO(io);
paintersRoutes.setIO(io);
creditLimitRoutes.setIO(io);
leadsRoutes.setIO(io);
leadAutoAssignScheduler.setIO(io);
productionMonitor.setIO(io);
activityFeedRoutes.setIO(io);
activityFeed.setIO(io);
activityTrackerService.setIO(io);
activityTrackerRoutes.setIO(io);
productionMonitor.setSessionManager(whatsappSessionManager);
painterNotificationService.setDependencies(pool, io);

// Connect anomaly detector alerts to notification system
const _anomalyAlertThrottle = {};
anomalyDetector.setAlertCallback(async (key, severity, title, message) => {
    // Throttle: max 1 alert per type per hour
    const now = Date.now();
    if (_anomalyAlertThrottle[key] && (now - _anomalyAlertThrottle[key]) < 3600000) return;
    _anomalyAlertThrottle[key] = now;

    console.log(`[Anomaly Alert] ${severity}: ${title}`);

    // Send WhatsApp to admins for critical anomalies
    if (severity === 'critical' && whatsappSessionManager) {
        try {
            const [admins] = await pool.query(`SELECT phone FROM users WHERE role IN ('admin','administrator','super_admin') AND status = 'active' AND phone IS NOT NULL LIMIT 3`);
            const alertMsg = `⚠️ [${severity.toUpperCase()}] ${title}\n${message}\nTime: ${new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}`;
            for (const a of admins) await whatsappSessionManager.sendMessage(0, a.phone, alertMsg, { source: 'anomaly_alert' });
        } catch (e) { console.error('[Anomaly Alert] WhatsApp error:', e.message); }
    }
    // In-app notification to admins/managers
    try {
        const [admins] = await pool.query(`SELECT id FROM users WHERE role IN ('admin','administrator','super_admin','manager','branch_manager') AND status = 'active' LIMIT 10`);
        for (const a of admins) await notificationService.send(a.id, { type: 'system_alert', title: `[${severity}] ${title}`, body: message });
    } catch (e) { console.error('[Anomaly Alert] Notification error:', e.message); }
});

// Socket.io auth middleware
io.use(async (socket, next) => {
    try {
        const token = socket.handshake.auth.token;
        if (!token) return next(new Error('Authentication required'));

        const [sessions] = await pool.query(
            `SELECT s.*, u.id as user_id, u.username, u.role, u.full_name
             FROM user_sessions s JOIN users u ON s.user_id = u.id
             WHERE s.token_hash = LOWER(SHA2(?, 256)) AND s.expires_at > NOW() AND u.status = 'active'`,
            [token]
        );

        if (sessions.length === 0) return next(new Error('Invalid session'));

        socket.user = {
            id: sessions[0].user_id,
            username: sessions[0].username,
            role: sessions[0].role,
            full_name: sessions[0].full_name
        };
        next();
    } catch (err) {
        next(new Error('Auth failed'));
    }
});

// Socket.io connection handler
io.on('connection', async (socket) => {
    const userId = socket.user.id;
    console.log(`Socket connected: ${socket.user.full_name} (${userId})`);

    // Track online status for live dashboard
    if (!onlineUsers.has(userId)) {
        onlineUsers.set(userId, new Set());
        io.to('live_dashboard_admin').emit('user_online', {
            id: userId, full_name: socket.user.full_name, role: socket.user.role
        });
    }
    onlineUsers.get(userId).add(socket.id);

    // Join user's personal room for notifications
    socket.join(`user_${userId}`);

    // Admin users join WhatsApp admin room for QR/status updates
    if (socket.user.role === 'admin') {
        socket.join('whatsapp_admin');
    }

    // Handle explicit room join request from WhatsApp sessions page
    socket.on('join_whatsapp_admin', () => {
        if (isFullAdmin(socket.user.role)) {
            socket.join('whatsapp_admin');
        }
    });

    // WA Marketing admin room
    socket.on('join_wa_marketing_admin', () => {
        if (isFullAdmin(socket.user.role)) {
            socket.join('wa_marketing_admin');
        }
    });

    // WA Chat admin room
    socket.on('join_whatsapp_chat_admin', () => {
        if (isFullAdmin(socket.user.role)) {
            socket.join('whatsapp_chat_admin');
        }
    });

    // Painter room for real-time notifications — staff sockets may watch a
    // painter's events only with admin/manager role (S11: was open to all staff,
    // leaking painter notifications/locations).
    socket.on('join_painter_room', (painterId) => {
        const role = String(socket.user.role || '').toLowerCase();
        if (painterId && (isFullAdmin(socket.user.role) || role === 'manager')) {
            socket.join(`painter_${painterId}`);
        }
    });

    // Admin painters live map room (S11: role-gated like the whatsapp_* rooms)
    socket.on('join_admin_painters_live', () => {
        const role = String(socket.user.role || '').toLowerCase();
        if (isFullAdmin(socket.user.role) || role === 'manager') {
            socket.join('admin_painters_live');
        }
    });

    // Join all conversations the user is part of
    try {
        const [convos] = await pool.query(
            'SELECT conversation_id FROM chat_participants WHERE user_id = ?',
            [userId]
        );
        convos.forEach(c => socket.join(`conversation_${c.conversation_id}`));
    } catch (err) {
        console.error('Socket join conversations error:', err.message);
    }

    // Handle joining a specific conversation
    socket.on('join_conversation', (conversationId) => {
        socket.join(`conversation_${conversationId}`);
    });

    // Handle typing indicator
    socket.on('typing', (data) => {
        socket.to(`conversation_${data.conversation_id}`).emit('user_typing', {
            conversation_id: data.conversation_id,
            user_id: userId,
            user_name: socket.user.full_name,
            is_typing: data.is_typing
        });
    });

    // Handle mark read
    socket.on('mark_read', async (data) => {
        try {
            await pool.query(
                'UPDATE chat_participants SET last_read_at = NOW() WHERE conversation_id = ? AND user_id = ?',
                [data.conversation_id, userId]
            );
            socket.to(`conversation_${data.conversation_id}`).emit('message_read', {
                conversation_id: data.conversation_id,
                user_id: userId,
                user_name: socket.user.full_name,
                read_at: new Date()
            });
        } catch (err) {
            console.error('Socket mark_read error:', err.message);
        }
    });

    // Join live dashboard room (admin/administrator/manager/branch_manager/super_admin only)
    socket.on('join_live_dashboard', () => {
        if (isFullAdmin(socket.user.role) || socket.user.role === 'manager' || socket.user.role === 'branch_manager') {
            socket.join('live_dashboard_admin');
        }
    });

    socket.on('disconnect', () => {
        // Track online status for live dashboard
        const userSockets = onlineUsers.get(userId);
        if (userSockets) {
            userSockets.delete(socket.id);
            if (userSockets.size === 0) {
                onlineUsers.delete(userId);
                io.to('live_dashboard_admin').emit('user_offline', { id: userId });
            }
        }
        console.log(`Socket disconnected: ${socket.user.full_name}`);
    });
});

server.listen(PORT, () => {
    console.log(`QC Business Manager API v2.0.0 running on port ${PORT}`);
    console.log(`Modules loaded: auth, roles, branches, users, customers, leads, products, estimates, attendance, salary, activities, tasks, settings, zoho-books, chat, notifications, pdf, share`);
    console.log(`Socket.io ready`);

    // Pass automation registry to all schedulers
    syncScheduler.setAutomationRegistry(automationRegistry);
    aiScheduler.setAutomationRegistry(automationRegistry);
    painterScheduler.setAutomationRegistry(automationRegistry);
    dataRetentionService.setAutomationRegistry(automationRegistry);
    leadAutoAssignScheduler.setAutomationRegistry(automationRegistry);
    autoClockout.setAutomationRegistry(automationRegistry);
    attendanceReport.setAutomationRegistry(automationRegistry);
    whatsappProcessor.setAutomationRegistry(automationRegistry);

    // Start background services after server is ready
    autoClockout.start();
    attendanceReport.start();

    // Geofence enforcement — every 60 seconds
    // Checks: (1) location turned off >2 min, (2) geo warning >5 min
    setInterval(async () => {
        try {
            const now = new Date();
            const offset = 5.5 * 60 * 60 * 1000;
            const istDate = new Date(now.getTime() + offset);
            const today = istDate.toISOString().split('T')[0];

            // 1. Location-off auto-clockout (2 min grace)
            const [locationOffRecords] = await pool.query(
                `SELECT a.id, a.user_id, a.clock_in_time, a.break_duration_minutes
                 FROM staff_attendance a
                 WHERE a.date = ? AND a.clock_out_time IS NULL
                   AND a.location_off_at IS NOT NULL
                   AND TIMESTAMPDIFF(SECOND, a.location_off_at, NOW()) >= 120`,
                [today]
            );

            for (const rec of locationOffRecords) {
                const clockoutTime = new Date();
                const breakMinutes = rec.break_duration_minutes || 0;
                const workingMinutes = Math.round(((clockoutTime - new Date(rec.clock_in_time)) / 1000 / 60) - breakMinutes);

                await pool.query(
                    `UPDATE staff_attendance
                     SET clock_out_time = ?, total_working_minutes = ?,
                         auto_clockout_type = 'location_off', location_off_at = NULL,
                         geo_warning_started_at = NULL,
                         notes = CONCAT(COALESCE(notes, ''), '\n[Auto clock-out: Location turned off for >2 min]')
                     WHERE id = ?`,
                    [clockoutTime, workingMinutes, rec.id]
                );

                try {
                    await notificationService.send(rec.user_id, {
                        type: 'geo_auto_clockout',
                        title: 'Auto Clock-Out!',
                        body: 'Auto-clocked-out because location was off for over 2 minutes.',
                        data: { type: 'geo_auto_clockout', reason: 'location_off', priority: 'high' }
                    });
                } catch(e) {}

                try {
                    const [userInfo] = await pool.query('SELECT full_name FROM users WHERE id = ?', [rec.user_id]);
                    const staffName = userInfo[0]?.full_name || 'Staff';
                    const [admins] = await pool.query("SELECT id FROM users WHERE role IN ('admin','administrator','super_admin') AND status = 'active'");
                    for (const admin of admins) {
                        await notificationService.send(admin.id, {
                            type: 'geo_auto_clockout_admin',
                            title: 'Staff Auto Clock-Out (Location Off)',
                            body: `${staffName} auto-clocked-out — location off >2 min.`,
                            data: { type: 'geo_auto_clockout_admin', user_id: String(rec.user_id), reason: 'location_off', priority: 'high' }
                        }).catch(() => {});
                    }
                } catch(e) {}
                console.log(`[Geo Cron] Auto-clockout user ${rec.user_id} — location off >2 min`);
            }

            // 2. Stale geo warning auto-clockout (5 min at 300m+)
            const [staleRecords] = await pool.query(
                `SELECT a.id, a.user_id, a.clock_in_time, a.break_duration_minutes, a.last_geo_distance
                 FROM staff_attendance a
                 WHERE a.date = ? AND a.clock_out_time IS NULL
                   AND a.geo_warning_started_at IS NOT NULL
                   AND TIMESTAMPDIFF(SECOND, a.geo_warning_started_at, NOW()) >= 300`,
                [today]
            );

            for (const rec of staleRecords) {
                const [activeOW] = await pool.query("SELECT id FROM outside_work_periods WHERE user_id = ? AND status = 'active' LIMIT 1", [rec.user_id]);
                const [activePrayer] = await pool.query("SELECT id FROM prayer_periods WHERE user_id = ? AND status = 'active' LIMIT 1", [rec.user_id]);
                if (activeOW.length > 0 || activePrayer.length > 0) continue;

                const clockoutTime = new Date();
                const breakMinutes = rec.break_duration_minutes || 0;
                const workingMinutes = Math.round(((clockoutTime - new Date(rec.clock_in_time)) / 1000 / 60) - breakMinutes);
                const dist = rec.last_geo_distance || 0;

                await pool.query(
                    `UPDATE staff_attendance
                     SET clock_out_time = ?, total_working_minutes = ?,
                         auto_clockout_type = 'geo', auto_clockout_distance = ?,
                         geo_warning_started_at = NULL,
                         notes = CONCAT(COALESCE(notes, ''), '\n[Server auto clock-out: ${dist}m from branch, 5 min expired]')
                     WHERE id = ?`,
                    [clockoutTime, workingMinutes, dist, rec.id]
                );

                try {
                    await notificationService.send(rec.user_id, {
                        type: 'geo_auto_clockout',
                        title: 'Auto Clock-Out!',
                        body: `Auto-clocked-out — ${dist}m from branch for over 5 minutes.`,
                        data: { type: 'geo_auto_clockout', distance: String(dist), priority: 'high' }
                    });
                } catch(e) {}

                try {
                    const [userInfo] = await pool.query('SELECT full_name FROM users WHERE id = ?', [rec.user_id]);
                    const staffName = userInfo[0]?.full_name || 'Staff';
                    const [admins] = await pool.query("SELECT id FROM users WHERE role IN ('admin','administrator','super_admin') AND status = 'active'");
                    for (const admin of admins) {
                        await notificationService.send(admin.id, {
                            type: 'geo_auto_clockout_admin',
                            title: 'Staff Auto Clock-Out (Server)',
                            body: `${staffName} auto-clocked-out — ${dist}m from branch, 5 min expired.`,
                            data: { type: 'geo_auto_clockout_admin', user_id: String(rec.user_id), distance: String(dist), priority: 'high' }
                        }).catch(() => {});
                    }
                } catch(e) {}
                console.log(`[Geo Cron] Server auto-clockout user ${rec.user_id} — ${dist}m, 5 min expired`);
            }
        } catch (err) {
            console.error('[Geo Cron] Error:', err.message, '| SQL:', err.sql || 'N/A', '| sqlMessage:', err.sqlMessage || 'N/A', '| code:', err.code || 'N/A');
            console.error('[Geo Cron] Full error:', JSON.stringify({code: err.code, sqlState: err.sqlState, sqlMessage: err.sqlMessage, sql: err.sql && err.sql.substring(0, 300)}));
        }

        // Activity tracker idle detection + max duration check
        try {
            await activityTrackerService.checkIdleStaff();
            await activityTrackerService.checkMaxDuration();
        } catch (err) {
            console.error('[ActivityTracker Cron] Idle/max-duration check error:', err.message);
        }
    }, 60 * 1000); // every 60 seconds
    console.log('[Geo Cron] Geofence enforcement cron started (every 60s)');

    // Non-Zoho background schedulers — start regardless of Zoho config. These were previously
    // gated behind ZOHO_ORGANIZATION_ID by accident, so painter loyalty, AI, anomaly scans, data
    // retention, lead auto-assign, health checks and self-healing silently never ran on any
    // environment without Zoho configured (SVC-001/007). None of them call Zoho at startup; the
    // only Zoho-dependent piece (PNTR marketing crons) is guarded inside painter-scheduler.start().
    aiScheduler.start();
    painterScheduler.start();
    dataRetentionService.start();
    leadAutoAssignScheduler.start();
    systemHealthService.startAutoHealthChecks(300000); // every 5 min
    productionMonitor.start(); // Production health monitoring + self-healing
    photosRoutes.startCleanupCron(); // Photo cleanup daily 2 AM IST
    // Anomaly detection scan every 6 hours
    setInterval(async () => {
        try {
            const result = await anomalyDetector.runFullScan();
            if (result.inserted > 0) console.log(`[Anomaly] Scheduled scan: ${result.inserted} new anomalies`);
        } catch (err) { console.error('[Anomaly] Scheduled scan error:', err.message); }
    }, 6 * 60 * 60 * 1000);
    console.log('Non-Zoho schedulers started: ai-scheduler, painter-scheduler, data-retention, lead-auto-assign, system-health, production-monitor, photo-cleanup; [Anomaly] scan every 6h');

    // Zoho-dependent services — only when ZOHO_ORGANIZATION_ID is configured.
    if (process.env.ZOHO_ORGANIZATION_ID) {
        syncScheduler.start().catch(err => {
            console.error('Failed to start sync scheduler:', err.message);
        });
        whatsappProcessor.start();
        whatsappSessionManager.initializeSessions();
        waCampaignEngine.start();
        console.log('Zoho services started: sync-scheduler, whatsapp-processor, whatsapp-sessions, wa-campaign-engine');
    } else {
        // KN-P1-5: make the skip LOUD and name exactly which schedulers did not start.
        console.warn('[startup] ZOHO_ORGANIZATION_ID not set — SKIPPING Zoho schedulers: sync-scheduler, whatsapp-processor, whatsapp-sessions, wa-campaign-engine. Non-Zoho schedulers started normally.');
    }
});

// Graceful shutdown - persist API usage counter before exit
async function gracefulShutdown(signal) {
    console.log(`\n${signal} received. Shutting down gracefully...`);
    try {
        systemHealthService.stopAutoHealthChecks();
        productionMonitor.stop();
        await rateLimiter.flush();
        console.log('API usage data persisted to DB.');
    } catch (err) {
        console.error('Failed to persist API usage:', err.message);
    }
    process.exit(0);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Catch uncaught exceptions and unhandled rejections
process.on('uncaughtException', (err) => {
    console.error('[FATAL] Uncaught Exception:', err);
    errorHandlerMw.logError(err, null, { type: 'api', severity: 'critical', url: 'uncaughtException' }).catch(() => {});
    // Give time to log, then exit
    setTimeout(() => process.exit(1), 1000);
});

process.on('unhandledRejection', (reason, promise) => {
    const err = reason instanceof Error ? reason : new Error(String(reason));
    console.error('[WARN] Unhandled Rejection:', err);
    errorHandlerMw.logError(err, null, { type: 'api', severity: 'high', url: 'unhandledRejection' }).catch(() => {});
});