/**
 * WA MARKETING ROUTES
 * WhatsApp marketing campaign management
 *
 * Endpoints:
 *   GET    /api/wa-marketing/campaigns              - List campaigns
 *   GET    /api/wa-marketing/campaigns/:id           - Campaign detail
 *   POST   /api/wa-marketing/campaigns               - Create draft
 *   PUT    /api/wa-marketing/campaigns/:id           - Update draft
 *   DELETE /api/wa-marketing/campaigns/:id           - Delete campaign
 *   POST   /api/wa-marketing/campaigns/:id/populate  - Build audience
 *   POST   /api/wa-marketing/campaigns/:id/start     - Start/schedule
 *   POST   /api/wa-marketing/campaigns/:id/pause     - Pause
 *   POST   /api/wa-marketing/campaigns/:id/resume    - Resume
 *   POST   /api/wa-marketing/campaigns/:id/cancel    - Cancel
 *   GET    /api/wa-marketing/campaigns/:id/leads     - Per-lead statuses
 *   POST   /api/wa-marketing/campaigns/:id/duplicate - Clone as draft
 *   GET    /api/wa-marketing/templates               - List templates
 *   POST   /api/wa-marketing/templates               - Create template
 *   PUT    /api/wa-marketing/templates/:id           - Update template
 *   DELETE /api/wa-marketing/templates/:id           - Delete template
 *   GET    /api/wa-marketing/dashboard               - Stats + trends
 *   GET    /api/wa-marketing/dashboard/sending-stats - Hourly/daily chart data
 *   POST   /api/wa-marketing/leads/preview           - Preview lead count
 *   POST   /api/wa-marketing/leads/preview-message   - Preview resolved message
 *   GET    /api/wa-marketing/settings                - Get settings
 *   PUT    /api/wa-marketing/settings                - Update settings
 *   POST   /api/wa-marketing/upload                  - Upload media
 *   POST   /api/wa-marketing/instant-send            - Send instant messages
 *   GET    /api/wa-marketing/instant-history          - Instant message history
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { requirePermission } = require('../middleware/permissionMiddleware');

let pool;
let campaignEngine;
let sessionManager;
let io;

function setPool(p) { pool = p; }
function setCampaignEngine(engine) { campaignEngine = engine; }
function setSessionManager(sm) { sessionManager = sm; }
function setIO(socketIO) { io = socketIO; }

const viewPerm = requirePermission('marketing', 'view');
const managePerm = requirePermission('marketing', 'manage');

// Upload config
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/wa-marketing'),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `campaign_${Date.now()}${ext}`);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 16 * 1024 * 1024 }, // 16MB
    fileFilter: (req, file, cb) => {
        const allowed = /jpeg|jpg|png|gif|webp|pdf|doc|docx|xls|xlsx/;
        const ext = allowed.test(path.extname(file.originalname).toLowerCase());
        const mime = allowed.test(file.mimetype) || file.mimetype.startsWith('image/') || file.mimetype.startsWith('application/');
        cb(null, ext || mime);
    }
});

// ========================================
// CAMPAIGNS — CRUD
// ========================================

// GET /campaigns — list with filters
router.get('/campaigns', viewPerm, async (req, res) => {
    try {
        const { status, branch_id, page = 1, limit = 20, search } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const params = [];
        let where = 'WHERE 1=1';

        if (status) { where += ' AND c.status = ?'; params.push(status); }
        if (branch_id) { where += ' AND c.branch_id = ?'; params.push(parseInt(branch_id)); }
        if (search) { where += ' AND (c.name LIKE ? OR c.description LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

        const [countRows] = await pool.query(
            `SELECT COUNT(*) as total FROM wa_campaigns c ${where}`, params
        );

        const [campaigns] = await pool.query(
            `SELECT c.*, CASE WHEN c.branch_id = 0 THEN 'General WhatsApp' ELSE b.name END as branch_name, u.full_name as created_by_name
             FROM wa_campaigns c
             LEFT JOIN branches b ON c.branch_id = b.id
             LEFT JOIN users u ON c.created_by = u.id
             ${where}
             ORDER BY c.updated_at DESC
             LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), offset]
        );

        res.json({
            campaigns,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: countRows[0].total,
                pages: Math.ceil(countRows[0].total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('[WA Marketing] List campaigns error:', error.message);
        res.status(500).json({ error: 'Failed to load campaigns' });
    }
});

// GET /campaigns/:id — detail
router.get('/campaigns/:id', viewPerm, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT c.*, CASE WHEN c.branch_id = 0 THEN 'General WhatsApp' ELSE b.name END as branch_name, u.full_name as created_by_name
             FROM wa_campaigns c
             LEFT JOIN branches b ON c.branch_id = b.id
             LEFT JOIN users u ON c.created_by = u.id
             WHERE c.id = ?`,
            [req.params.id]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Campaign not found' });

        // Get status breakdown
        const [statusBreakdown] = await pool.query(
            `SELECT status, COUNT(*) as count FROM wa_campaign_leads WHERE campaign_id = ? GROUP BY status`,
            [req.params.id]
        );

        res.json({ campaign: rows[0], status_breakdown: statusBreakdown });
    } catch (error) {
        console.error('[WA Marketing] Get campaign error:', error.message);
        res.status(500).json({ error: 'Failed to load campaign' });
    }
});

// POST /campaigns — create draft
router.post('/campaigns', managePerm, async (req, res) => {
    try {
        const {
            name, description, branch_id, message_type = 'text', message_body,
            media_url, media_filename, media_caption, audience_filter,
            min_delay_seconds, max_delay_seconds, hourly_limit, daily_limit, warm_up_enabled
        } = req.body;

        if (!name) return res.status(400).json({ error: 'Campaign name is required' });
        if (branch_id == null || branch_id === '') return res.status(400).json({ error: 'Branch is required' });

        const [result] = await pool.query(
            `INSERT INTO wa_campaigns (name, description, branch_id, message_type, message_body,
             media_url, media_filename, media_caption, audience_filter,
             min_delay_seconds, max_delay_seconds, hourly_limit, daily_limit, warm_up_enabled, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [name, description || null, parseInt(branch_id), message_type, message_body || null,
             media_url || null, media_filename || null, media_caption || null,
             audience_filter ? JSON.stringify(audience_filter) : null,
             min_delay_seconds || 30, max_delay_seconds || 90,
             hourly_limit || 30, daily_limit || 200,
             warm_up_enabled ? 1 : 0, req.user.id]
        );

        res.json({ success: true, campaign_id: result.insertId });
    } catch (error) {
        console.error('[WA Marketing] Create campaign error:', error.message);
        res.status(500).json({ error: 'Failed to create campaign' });
    }
});

// PUT /campaigns/:id — update draft
router.put('/campaigns/:id', managePerm, async (req, res) => {
    try {
        const [existing] = await pool.query('SELECT status FROM wa_campaigns WHERE id = ?', [req.params.id]);
        if (existing.length === 0) return res.status(404).json({ error: 'Campaign not found' });
        if (!['draft', 'paused'].includes(existing[0].status)) {
            return res.status(400).json({ error: 'Only draft or paused campaigns can be edited' });
        }

        const fields = ['name', 'description', 'branch_id', 'message_type', 'message_body',
            'media_url', 'media_filename', 'media_caption', 'audience_filter',
            'min_delay_seconds', 'max_delay_seconds', 'hourly_limit', 'daily_limit', 'warm_up_enabled'];

        const updates = [];
        const params = [];
        for (const field of fields) {
            if (req.body[field] !== undefined) {
                updates.push(`${field} = ?`);
                if (field === 'audience_filter') {
                    params.push(JSON.stringify(req.body[field]));
                } else if (field === 'warm_up_enabled') {
                    params.push(req.body[field] ? 1 : 0);
                } else if (field === 'branch_id') {
                    params.push(parseInt(req.body[field]));
                } else {
                    params.push(req.body[field]);
                }
            }
        }

        if (updates.length === 0) return res.json({ success: true });

        params.push(req.params.id);
        await pool.query(`UPDATE wa_campaigns SET ${updates.join(', ')} WHERE id = ?`, params);
        res.json({ success: true });
    } catch (error) {
        console.error('[WA Marketing] Update campaign error:', error.message);
        res.status(500).json({ error: 'Failed to update campaign' });
    }
});

// DELETE /campaigns/:id
router.delete('/campaigns/:id', managePerm, async (req, res) => {
    try {
        const [existing] = await pool.query('SELECT status FROM wa_campaigns WHERE id = ?', [req.params.id]);
        if (existing.length === 0) return res.status(404).json({ error: 'Campaign not found' });
        if (!['draft', 'completed', 'cancelled', 'failed'].includes(existing[0].status)) {
            return res.status(400).json({ error: 'Only draft/completed/cancelled/failed campaigns can be deleted' });
        }

        await pool.query('DELETE FROM wa_campaigns WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        console.error('[WA Marketing] Delete campaign error:', error.message);
        res.status(500).json({ error: 'Failed to delete campaign' });
    }
});

// ========================================
// CAMPAIGNS — AUDIENCE
// ========================================

// POST /campaigns/:id/populate — build audience from lead_ids (manual) or filters (auto)
router.post('/campaigns/:id/populate', managePerm, async (req, res) => {
    try {
        const [campaign] = await pool.query('SELECT * FROM wa_campaigns WHERE id = ?', [req.params.id]);
        if (campaign.length === 0) return res.status(404).json({ error: 'Campaign not found' });
        if (!['draft', 'paused'].includes(campaign[0].status)) {
            return res.status(400).json({ error: 'Only draft/paused campaigns can be populated' });
        }

        let leads;
        const { lead_ids, filters: reqFilters } = req.body;

        if (lead_ids && Array.isArray(lead_ids) && lead_ids.length > 0) {
            // Manual selection: fetch specific leads by ID
            const placeholders = lead_ids.map(() => '?').join(',');
            [leads] = await pool.query(
                `SELECT l.id, l.name, l.phone, l.company, l.city, l.source, l.status,
                        l.email, b.name as branch_name
                 FROM leads l
                 LEFT JOIN branches b ON l.branch_id = b.id
                 WHERE l.id IN (${placeholders}) AND l.phone IS NOT NULL AND l.phone != ''`,
                lead_ids
            );
        } else {
            // Filter-based selection
            const filters = reqFilters || (campaign[0].audience_filter ? JSON.parse(campaign[0].audience_filter) : {});
            const { query: leadQuery, params: leadParams } = buildLeadFilterQuery(filters, campaign[0].branch_id);
            [leads] = await pool.query(leadQuery, leadParams);
        }

        if (leads.length === 0) {
            return res.status(400).json({ error: 'No leads found with phone numbers' });
        }

        // Fisher-Yates shuffle
        for (let i = leads.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [leads[i], leads[j]] = [leads[j], leads[i]];
        }

        // Clear existing audience
        await pool.query('DELETE FROM wa_campaign_leads WHERE campaign_id = ?', [req.params.id]);

        // Bulk insert
        const values = leads.map((lead, idx) => [
            req.params.id, lead.id, lead.phone, lead.name, 'pending', idx + 1
        ]);

        // Insert in batches of 500
        for (let i = 0; i < values.length; i += 500) {
            const batch = values.slice(i, i + 500);
            await pool.query(
                `INSERT INTO wa_campaign_leads (campaign_id, lead_id, phone, lead_name, status, send_order)
                 VALUES ${batch.map(() => '(?, ?, ?, ?, ?, ?)').join(', ')}`,
                batch.flat()
            );
        }

        // Update campaign
        const filterData = lead_ids ? { mode: 'manual', lead_ids } : (reqFilters || {});
        await pool.query(
            `UPDATE wa_campaigns SET total_leads = ?, audience_filter = ?, sent_count = 0, failed_count = 0 WHERE id = ?`,
            [leads.length, JSON.stringify(filterData), req.params.id]
        );

        res.json({ success: true, total_leads: leads.length });
    } catch (error) {
        console.error('[WA Marketing] Populate error:', error.message);
        res.status(500).json({ error: 'Failed to populate audience' });
    }
});

// ========================================
// CAMPAIGNS — ACTIONS
// ========================================

// POST /campaigns/:id/start
router.post('/campaigns/:id/start', managePerm, async (req, res) => {
    try {
        const [campaign] = await pool.query('SELECT * FROM wa_campaigns WHERE id = ?', [req.params.id]);
        if (campaign.length === 0) return res.status(404).json({ error: 'Campaign not found' });
        if (!['draft', 'scheduled'].includes(campaign[0].status)) {
            return res.status(400).json({ error: 'Only draft/scheduled campaigns can be started' });
        }

        // Check if audience is populated
        const [leadCount] = await pool.query(
            'SELECT COUNT(*) as count FROM wa_campaign_leads WHERE campaign_id = ?',
            [req.params.id]
        );
        if (leadCount[0].count === 0) {
            return res.status(400).json({ error: 'Campaign has no audience — populate leads first' });
        }

        const { scheduled_at } = req.body;
        if (scheduled_at) {
            await pool.query(
                "UPDATE wa_campaigns SET status = 'scheduled', scheduled_at = ? WHERE id = ?",
                [scheduled_at, req.params.id]
            );
            res.json({ success: true, status: 'scheduled', scheduled_at });
        } else {
            await pool.query(
                "UPDATE wa_campaigns SET status = 'running', sending_started_at = COALESCE(sending_started_at, NOW()) WHERE id = ?",
                [req.params.id]
            );
            res.json({ success: true, status: 'running' });
        }
    } catch (error) {
        console.error('[WA Marketing] Start campaign error:', error.message);
        res.status(500).json({ error: 'Failed to start campaign' });
    }
});

// POST /campaigns/:id/pause
router.post('/campaigns/:id/pause', managePerm, async (req, res) => {
    try {
        const [result] = await pool.query(
            "UPDATE wa_campaigns SET status = 'paused' WHERE id = ? AND status = 'running'",
            [req.params.id]
        );
        if (result.affectedRows === 0) return res.status(400).json({ error: 'Campaign is not running' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to pause campaign' });
    }
});

// POST /campaigns/:id/resume
router.post('/campaigns/:id/resume', managePerm, async (req, res) => {
    try {
        const [result] = await pool.query(
            "UPDATE wa_campaigns SET status = 'running' WHERE id = ? AND status = 'paused'",
            [req.params.id]
        );
        if (result.affectedRows === 0) return res.status(400).json({ error: 'Campaign is not paused' });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to resume campaign' });
    }
});

// POST /campaigns/:id/cancel
router.post('/campaigns/:id/cancel', managePerm, async (req, res) => {
    try {
        const [campaign] = await pool.query('SELECT status FROM wa_campaigns WHERE id = ?', [req.params.id]);
        if (campaign.length === 0) return res.status(404).json({ error: 'Campaign not found' });
        if (['completed', 'cancelled'].includes(campaign[0].status)) {
            return res.status(400).json({ error: 'Campaign already finished' });
        }

        await pool.query("UPDATE wa_campaigns SET status = 'cancelled', completed_at = NOW() WHERE id = ?", [req.params.id]);
        await pool.query("UPDATE wa_campaign_leads SET status = 'skipped' WHERE campaign_id = ? AND status = 'pending'", [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to cancel campaign' });
    }
});

// GET /campaigns/:id/leads — per-lead statuses
router.get('/campaigns/:id/leads', viewPerm, async (req, res) => {
    try {
        const { status, search, page = 1, limit = 50 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const params = [req.params.id];
        let where = 'WHERE wcl.campaign_id = ?';

        if (status) { where += ' AND wcl.status = ?'; params.push(status); }
        if (search) { where += ' AND (wcl.lead_name LIKE ? OR wcl.phone LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

        const [countRows] = await pool.query(
            `SELECT COUNT(*) as total FROM wa_campaign_leads wcl ${where}`, params
        );

        const [leads] = await pool.query(
            `SELECT wcl.* FROM wa_campaign_leads wcl ${where}
             ORDER BY wcl.send_order ASC LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), offset]
        );

        res.json({
            leads,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: countRows[0].total,
                pages: Math.ceil(countRows[0].total / parseInt(limit))
            }
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to load campaign leads' });
    }
});

// POST /campaigns/:id/duplicate
router.post('/campaigns/:id/duplicate', managePerm, async (req, res) => {
    try {
        const [orig] = await pool.query('SELECT * FROM wa_campaigns WHERE id = ?', [req.params.id]);
        if (orig.length === 0) return res.status(404).json({ error: 'Campaign not found' });

        const c = orig[0];
        const [result] = await pool.query(
            `INSERT INTO wa_campaigns (name, description, branch_id, message_type, message_body,
             media_url, media_filename, media_caption, audience_filter,
             min_delay_seconds, max_delay_seconds, hourly_limit, daily_limit, warm_up_enabled, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [`${c.name} (Copy)`, c.description, c.branch_id, c.message_type, c.message_body,
             c.media_url, c.media_filename, c.media_caption, c.audience_filter,
             c.min_delay_seconds, c.max_delay_seconds, c.hourly_limit, c.daily_limit,
             c.warm_up_enabled, req.user.id]
        );

        res.json({ success: true, campaign_id: result.insertId });
    } catch (error) {
        res.status(500).json({ error: 'Failed to duplicate campaign' });
    }
});

// ========================================
// LEADS BROWSER (for contact picker)
// ========================================

// GET /leads/browse — paginated lead list for audience selection
router.get('/leads/browse', viewPerm, async (req, res) => {
    try {
        const { search, status, source, priority, branch_id, page = 1, limit = 50 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const params = [];
        let where = 'WHERE l.phone IS NOT NULL AND l.phone != ""';

        if (search) {
            where += ' AND (l.name LIKE ? OR l.phone LIKE ? OR l.company LIKE ? OR l.city LIKE ?)';
            const s = `%${search}%`;
            params.push(s, s, s, s);
        }
        if (status) { where += ' AND l.status = ?'; params.push(status); }
        if (source) { where += ' AND l.source = ?'; params.push(source); }
        if (priority) { where += ' AND l.priority = ?'; params.push(priority); }
        if (branch_id) { where += ' AND l.branch_id = ?'; params.push(parseInt(branch_id)); }

        const [countRows] = await pool.query(`SELECT COUNT(*) as total FROM leads l ${where}`, params);

        const [leads] = await pool.query(
            `SELECT l.id, l.name, l.phone, l.email, l.company, l.city, l.status, l.source, l.priority,
                    l.last_contact_date, b.name as branch_name
             FROM leads l
             LEFT JOIN branches b ON l.branch_id = b.id
             ${where}
             ORDER BY l.name ASC
             LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), offset]
        );

        res.json({
            leads,
            pagination: {
                page: parseInt(page),
                limit: parseInt(limit),
                total: countRows[0].total,
                pages: Math.ceil(countRows[0].total / parseInt(limit))
            }
        });
    } catch (error) {
        console.error('[WA Marketing] Browse leads error:', error.message);
        res.status(500).json({ error: 'Failed to load leads' });
    }
});

// ========================================
// TEMPLATES
// ========================================

router.get('/templates', viewPerm, async (req, res) => {
    try {
        const { category, search } = req.query;
        let where = 'WHERE is_active = 1';
        const params = [];

        if (category) { where += ' AND category = ?'; params.push(category); }
        if (search) { where += ' AND (name LIKE ? OR message_body LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

        const [templates] = await pool.query(
            `SELECT t.*, u.full_name as created_by_name
             FROM wa_message_templates t
             LEFT JOIN users u ON t.created_by = u.id
             ${where} ORDER BY t.usage_count DESC, t.updated_at DESC`,
            params
        );

        res.json({ templates });
    } catch (error) {
        res.status(500).json({ error: 'Failed to load templates' });
    }
});

router.post('/templates', managePerm, async (req, res) => {
    try {
        const { name, category, message_type, message_body, media_url, media_caption, variables_used } = req.body;
        if (!name || !message_body) return res.status(400).json({ error: 'Name and message body are required' });

        const [result] = await pool.query(
            `INSERT INTO wa_message_templates (name, category, message_type, message_body, media_url, media_caption, variables_used, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [name, category || 'custom', message_type || 'text', message_body,
             media_url || null, media_caption || null, variables_used || null, req.user.id]
        );

        res.json({ success: true, template_id: result.insertId });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create template' });
    }
});

router.put('/templates/:id', managePerm, async (req, res) => {
    try {
        const fields = ['name', 'category', 'message_type', 'message_body', 'media_url', 'media_caption', 'variables_used', 'is_active'];
        const updates = [];
        const params = [];

        for (const field of fields) {
            if (req.body[field] !== undefined) {
                updates.push(`${field} = ?`);
                params.push(req.body[field]);
            }
        }
        if (updates.length === 0) return res.json({ success: true });

        params.push(req.params.id);
        await pool.query(`UPDATE wa_message_templates SET ${updates.join(', ')} WHERE id = ?`, params);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update template' });
    }
});

router.delete('/templates/:id', managePerm, async (req, res) => {
    try {
        await pool.query('DELETE FROM wa_message_templates WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to delete template' });
    }
});

// ========================================
// DASHBOARD
// ========================================

router.get('/dashboard', viewPerm, async (req, res) => {
    try {
        // Campaign stats
        const [campaignStats] = await pool.query(`
            SELECT
                COUNT(*) as total_campaigns,
                SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) as running,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as drafts,
                SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END) as paused,
                SUM(CASE WHEN status = 'scheduled' THEN 1 ELSE 0 END) as scheduled
            FROM wa_campaigns
        `);

        // Message stats
        const [messageStats] = await pool.query(`
            SELECT
                COALESCE(SUM(sent_count), 0) as total_sent,
                COALESCE(SUM(delivered_count), 0) as total_delivered,
                COALESCE(SUM(read_count), 0) as total_read,
                COALESCE(SUM(failed_count), 0) as total_failed
            FROM wa_campaigns
        `);

        // Today's sends
        const [todayStats] = await pool.query(`
            SELECT COALESCE(SUM(messages_sent), 0) as sent, COALESCE(SUM(messages_failed), 0) as failed
            FROM wa_sending_stats WHERE stat_date = CURDATE()
        `);

        // Recent campaigns
        const [recentCampaigns] = await pool.query(`
            SELECT c.id, c.name, c.status, c.total_leads, c.sent_count, c.failed_count,
                   c.sending_started_at, c.completed_at,
                   CASE WHEN c.branch_id = 0 THEN 'General WhatsApp' ELSE b.name END as branch_name
            FROM wa_campaigns c
            LEFT JOIN branches b ON c.branch_id = b.id
            ORDER BY c.updated_at DESC LIMIT 5
        `);

        // Engine status
        const engineStatus = campaignEngine ? campaignEngine.getEngineStatus() : { running: false };

        res.json({
            campaigns: campaignStats[0],
            messages: messageStats[0],
            today: todayStats[0],
            recent_campaigns: recentCampaigns,
            engine: engineStatus
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to load dashboard' });
    }
});

router.get('/dashboard/sending-stats', viewPerm, async (req, res) => {
    try {
        const { days = 7, branch_id } = req.query;
        const params = [parseInt(days)];
        let branchWhere = '';
        if (branch_id) { branchWhere = 'AND branch_id = ?'; params.push(parseInt(branch_id)); }

        // Hourly for today
        const [hourly] = await pool.query(
            `SELECT stat_hour, SUM(messages_sent) as sent, SUM(messages_failed) as failed
             FROM wa_sending_stats
             WHERE stat_date = CURDATE() ${branchWhere}
             GROUP BY stat_hour ORDER BY stat_hour`,
            branch_id ? [parseInt(branch_id)] : []
        );

        // Daily for past N days
        const [daily] = await pool.query(
            `SELECT stat_date, SUM(messages_sent) as sent, SUM(messages_failed) as failed
             FROM wa_sending_stats
             WHERE stat_date >= DATE_SUB(CURDATE(), INTERVAL ? DAY) ${branchWhere}
             GROUP BY stat_date ORDER BY stat_date`,
            params
        );

        res.json({ hourly, daily });
    } catch (error) {
        res.status(500).json({ error: 'Failed to load sending stats' });
    }
});

// ========================================
// LEADS PREVIEW
// ========================================

router.post('/leads/preview', viewPerm, async (req, res) => {
    try {
        const { filters = {}, branch_id } = req.body;
        const { query, params } = buildLeadFilterQuery(filters, branch_id, true);
        const [rows] = await pool.query(query, params);
        res.json({ count: rows[0].count });
    } catch (error) {
        res.status(500).json({ error: 'Failed to preview leads' });
    }
});

router.post('/leads/preview-message', viewPerm, async (req, res) => {
    try {
        const { message_body, lead_data } = req.body;
        if (!message_body) return res.json({ resolved: '' });

        const resolved = campaignEngine
            ? campaignEngine.resolveMessage(message_body, lead_data || { lead_name: 'John Doe', name: 'John Doe', company: 'ABC Corp', city: 'Chennai', phone: '9876543210' })
            : message_body;

        res.json({ resolved });
    } catch (error) {
        res.status(500).json({ error: 'Failed to preview message' });
    }
});

// ========================================
// SETTINGS
// ========================================

router.get('/settings', managePerm, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT `key`, value FROM wa_marketing_settings ORDER BY `key`');
        const settings = {};
        for (const row of rows) settings[row.key] = row.value;
        res.json({ settings });
    } catch (error) {
        res.status(500).json({ error: 'Failed to load settings' });
    }
});

router.put('/settings', managePerm, async (req, res) => {
    try {
        const { settings } = req.body;
        if (!settings || typeof settings !== 'object') return res.status(400).json({ error: 'Settings object required' });

        for (const [key, value] of Object.entries(settings)) {
            await pool.query(
                'INSERT INTO wa_marketing_settings (`key`, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = ?',
                [key, String(value), String(value)]
            );
        }

        // Reload engine settings
        if (campaignEngine) await campaignEngine.loadSettings();

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Failed to update settings' });
    }
});

// ========================================
// MEDIA UPLOAD
// ========================================

router.post('/upload', managePerm, upload.single('media'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        let finalPath = req.file.path.replace(/\\/g, '/');

        // Compress images with sharp
        if (req.file.mimetype.startsWith('image/') && !req.file.mimetype.includes('gif')) {
            const compressedPath = finalPath.replace(/(\.\w+)$/, '_compressed$1');
            await sharp(req.file.path)
                .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 80 })
                .toFile(compressedPath);

            fs.unlinkSync(req.file.path);
            finalPath = compressedPath;
        }

        res.json({
            success: true,
            url: '/' + finalPath,
            filename: req.file.originalname,
            size: req.file.size
        });
    } catch (error) {
        console.error('[WA Marketing] Upload error:', error.message);
        res.status(500).json({ error: 'Failed to upload file' });
    }
});

// ========================================
// HELPERS
// ========================================

function buildLeadFilterQuery(filters, branchId, countOnly = false) {
    const params = [];
    let where = 'WHERE l.phone IS NOT NULL AND l.phone != ""';

    if (filters.status) {
        if (Array.isArray(filters.status)) {
            where += ` AND l.status IN (${filters.status.map(() => '?').join(',')})`;
            params.push(...filters.status);
        } else {
            where += ' AND l.status = ?';
            params.push(filters.status);
        }
    }

    if (filters.source) {
        if (Array.isArray(filters.source)) {
            where += ` AND l.source IN (${filters.source.map(() => '?').join(',')})`;
            params.push(...filters.source);
        } else {
            where += ' AND l.source = ?';
            params.push(filters.source);
        }
    }

    if (filters.priority) {
        where += ' AND l.priority = ?';
        params.push(filters.priority);
    }

    if (branchId) {
        where += ' AND l.branch_id = ?';
        params.push(parseInt(branchId));
    }

    if (filters.city) {
        where += ' AND l.city LIKE ?';
        params.push(`%${filters.city}%`);
    }

    if (filters.date_from) {
        where += ' AND l.created_at >= ?';
        params.push(filters.date_from);
    }

    if (filters.date_to) {
        where += ' AND l.created_at <= ?';
        params.push(filters.date_to + ' 23:59:59');
    }

    if (filters.assigned_to) {
        where += ' AND l.assigned_to = ?';
        params.push(parseInt(filters.assigned_to));
    }

    if (countOnly) {
        return { query: `SELECT COUNT(*) as count FROM leads l ${where}`, params };
    }

    return {
        query: `SELECT l.id, l.name, l.phone, l.company, l.city, l.source, l.status,
                       l.email, b.name as branch_name
                FROM leads l
                LEFT JOIN branches b ON l.branch_id = b.id
                ${where}`,
        params
    };
}

// ========================================
// INSTANT SEND — Send to selected leads with anti-block
// ========================================

/** POST /api/wa-marketing/instant-send */
router.post('/instant-send', managePerm, async (req, res) => {
    try {
        const { lead_ids, message, branch_id, media_url, media_type, media_caption } = req.body;

        if (!lead_ids || !lead_ids.length || !message) {
            return res.status(400).json({ success: false, message: 'lead_ids and message are required' });
        }
        if (branch_id == null || branch_id === '') {
            return res.status(400).json({ success: false, message: 'branch_id (WhatsApp session) is required' });
        }

        // Check WhatsApp session
        if (!sessionManager) {
            return res.status(500).json({ success: false, message: 'WhatsApp session manager not available' });
        }
        if (!sessionManager.isConnected(branch_id)) {
            const brStatus = sessionManager.getBranchStatus(branch_id);
            return res.status(400).json({ success: false, message: `WhatsApp session for this branch is ${brStatus?.status || 'not connected'}. Connect it first.` });
        }

        // Fetch leads
        const placeholders = lead_ids.map(() => '?').join(',');
        const [leads] = await pool.query(
            `SELECT l.id, l.name, l.phone, l.company, l.city, l.email, l.source, l.status as lead_status,
                    l.last_contact_date, b.name as branch_name
             FROM leads l
             LEFT JOIN branches b ON l.branch_id = b.id
             WHERE l.id IN (${placeholders}) AND l.phone IS NOT NULL AND l.phone != ''`,
            lead_ids
        );

        if (!leads.length) {
            return res.status(400).json({ success: false, message: 'No leads with valid phone numbers found' });
        }

        // Create batch
        const batchId = `IM-${Date.now().toString(36).toUpperCase()}`;

        // Insert all as pending
        const insertValues = leads.map(lead => [
            batchId, lead.id, lead.name, lead.phone, message, null,
            media_url || null, media_type || null, media_caption || null,
            branch_id, 'pending', req.user.id
        ]);
        for (const vals of insertValues) {
            await pool.query(
                `INSERT INTO wa_instant_messages
                 (batch_id, lead_id, lead_name, phone, message_template, message_content, media_url, media_type, media_caption, branch_id, status, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                vals
            );
        }

        // Start background processing (don't await)
        processInstantBatch(batchId, branch_id, message, leads, media_url, media_type, media_caption, req.user.id);

        res.json({ success: true, batch_id: batchId, total: leads.length });
    } catch (error) {
        console.error('Instant send error:', error);
        res.status(500).json({ success: false, message: 'Failed to start instant send' });
    }
});

/**
 * Background processor for instant message batch
 * Sends messages one by one with random delays (5-15s) and anti-block
 */
async function processInstantBatch(batchId, branchId, messageTemplate, leads, mediaUrl, mediaType, mediaCaption, userId) {
    // Shuffle for randomness
    const shuffled = [...leads].sort(() => Math.random() - 0.5);
    let sent = 0, failed = 0;

    for (let i = 0; i < shuffled.length; i++) {
        const lead = shuffled[i];

        try {
            // Resolve message with anti-block (spin text + variables + invisible marker)
            const resolvedMsg = campaignEngine.resolveMessage(messageTemplate, {
                lead_name: lead.name, name: lead.name,
                company: lead.company, city: lead.city,
                email: lead.email, phone: lead.phone,
                source: lead.source, lead_status: lead.lead_status,
                branch_name: lead.branch_name
            });

            // Update status to sending
            await pool.query(
                `UPDATE wa_instant_messages SET status = 'sending', message_content = ? WHERE batch_id = ? AND lead_id = ?`,
                [resolvedMsg, batchId, lead.id]
            );

            // Emit progress: sending
            emitInstantProgress(userId, {
                batch_id: batchId, lead_id: lead.id, lead_name: lead.name,
                phone: lead.phone, status: 'sending',
                index: i + 1, total: shuffled.length, sent, failed
            });

            // Send via WhatsApp session
            if (mediaUrl && mediaType) {
                const mediaPath = path.join(__dirname, '..', mediaUrl.startsWith('/') ? mediaUrl.substring(1) : mediaUrl);
                await sessionManager.sendMedia(branchId, lead.phone, {
                    type: mediaType,
                    mediaPath,
                    caption: mediaCaption ? campaignEngine.resolveMessage(mediaCaption, lead) : undefined
                });
                // Also send text if message is not just a caption
                if (messageTemplate.trim() && messageTemplate.trim() !== mediaCaption?.trim()) {
                    await new Promise(r => setTimeout(r, 1000 + Math.random() * 2000));
                    await sessionManager.sendMessage(branchId, lead.phone, resolvedMsg);
                }
            } else {
                await sessionManager.sendMessage(branchId, lead.phone, resolvedMsg);
            }

            // Mark sent
            await pool.query(
                `UPDATE wa_instant_messages SET status = 'sent', sent_at = NOW() WHERE batch_id = ? AND lead_id = ?`,
                [batchId, lead.id]
            );
            sent++;

            emitInstantProgress(userId, {
                batch_id: batchId, lead_id: lead.id, lead_name: lead.name,
                phone: lead.phone, status: 'sent',
                index: i + 1, total: shuffled.length, sent, failed
            });

        } catch (err) {
            failed++;
            await pool.query(
                `UPDATE wa_instant_messages SET status = 'failed', error_message = ? WHERE batch_id = ? AND lead_id = ?`,
                [(err.message || 'Unknown error').substring(0, 500), batchId, lead.id]
            ).catch(() => {});

            emitInstantProgress(userId, {
                batch_id: batchId, lead_id: lead.id, lead_name: lead.name,
                phone: lead.phone, status: 'failed', error: err.message,
                index: i + 1, total: shuffled.length, sent, failed
            });
        }

        // Anti-block delay: 5-15 seconds between messages
        if (i < shuffled.length - 1) {
            const delay = 5000 + Math.random() * 10000;
            await new Promise(r => setTimeout(r, delay));
        }
    }

    // Emit completion
    if (io) {
        io.to(`user_${userId}`).emit('wa_instant_complete', {
            batch_id: batchId, total: shuffled.length, sent, failed
        });
    }
}

function emitInstantProgress(userId, data) {
    if (io) {
        io.to(`user_${userId}`).emit('wa_instant_progress', data);
    }
}

// ========================================
// INSTANT HISTORY — Recent instant messages
// ========================================

/** GET /api/wa-marketing/instant-history */
router.get('/instant-history', viewPerm, async (req, res) => {
    try {
        const { batch_id, status, search, page = 1, limit = 50 } = req.query;
        let where = 'WHERE 1=1';
        const params = [];

        if (batch_id) { where += ' AND m.batch_id = ?'; params.push(batch_id); }
        if (status) { where += ' AND m.status = ?'; params.push(status); }
        if (search) {
            where += ' AND (m.lead_name LIKE ? OR m.phone LIKE ?)';
            params.push(`%${search}%`, `%${search}%`);
        }

        const offset = (parseInt(page) - 1) * parseInt(limit);

        const [countResult] = await pool.query(
            `SELECT COUNT(*) as total FROM wa_instant_messages m ${where}`, params
        );

        const [rows] = await pool.query(
            `SELECT m.*, u.full_name as sent_by_name,
                    CASE WHEN m.branch_id = 0 THEN 'General WhatsApp' ELSE b.name END as branch_name
             FROM wa_instant_messages m
             LEFT JOIN users u ON m.created_by = u.id
             LEFT JOIN branches b ON m.branch_id = b.id
             ${where}
             ORDER BY m.created_at DESC
             LIMIT ? OFFSET ?`,
            [...params, parseInt(limit), offset]
        );

        // Also return batch summary stats
        const [batches] = await pool.query(
            `SELECT batch_id, COUNT(*) as total,
                    SUM(status = 'sent') as sent,
                    SUM(status = 'failed') as failed,
                    SUM(status = 'pending' OR status = 'sending') as pending,
                    MIN(created_at) as started_at,
                    MAX(sent_at) as completed_at
             FROM wa_instant_messages
             GROUP BY batch_id
             ORDER BY MIN(created_at) DESC
             LIMIT 20`
        );

        res.json({
            success: true,
            data: rows,
            batches,
            pagination: { total: countResult[0].total, page: parseInt(page), limit: parseInt(limit) }
        });
    } catch (error) {
        console.error('Instant history error:', error);
        res.status(500).json({ success: false, message: 'Failed to get instant history' });
    }
});

/** GET /api/wa-marketing/whatsapp-sessions — Get connected sessions for branch picker */
router.get('/whatsapp-sessions', viewPerm, async (req, res) => {
    try {
        if (!sessionManager) {
            return res.json({ success: true, data: [] });
        }
        const sessions = sessionManager.getStatus();
        res.json({ success: true, data: sessions });
    } catch (error) {
        console.error('Get WA sessions error:', error);
        res.json({ success: true, data: [] });
    }
});

module.exports = {
    router,
    setPool,
    setCampaignEngine,
    setSessionManager,
    setIO
};
