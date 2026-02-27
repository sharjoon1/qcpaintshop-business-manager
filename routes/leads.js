/**
 * LEADS MODULE ROUTES
 * Handles lead management, followups, conversion, and assignment
 */

const express = require('express');
const router = express.Router();
const { requirePermission, requireAuth } = require('../middleware/permissionMiddleware');
const leadManager = require('../services/ai-lead-manager');
const notificationService = require('../services/notification-service');

let io;

function setIO(socketIO) {
    io = socketIO;
}

// Database connection (imported from main app)
let pool;

function setPool(dbPool) {
    pool = dbPool;
    leadManager.setPool(dbPool);
}

// ========================================
// HELPER FUNCTIONS
// ========================================

/**
 * Generate a unique lead number in the format LEAD-YYYYMMDD-XXXX
 */
async function generateLeadNumber() {
    const today = new Date();
    const dateStr = today.getFullYear().toString() +
        String(today.getMonth() + 1).padStart(2, '0') +
        String(today.getDate()).padStart(2, '0');

    const prefix = `LEAD-${dateStr}-`;

    const [rows] = await pool.query(
        `SELECT lead_number FROM leads
         WHERE lead_number LIKE ?
         ORDER BY lead_number DESC LIMIT 1`,
        [`${prefix}%`]
    );

    let nextSeq = 1;
    if (rows.length > 0) {
        const lastNum = rows[0].lead_number;
        const lastSeq = parseInt(lastNum.split('-').pop(), 10);
        if (!isNaN(lastSeq)) {
            nextSeq = lastSeq + 1;
        }
    }

    return `${prefix}${String(nextSeq).padStart(4, '0')}`;
}

/**
 * Build WHERE clause for role-based lead filtering
 * Staff: only own leads | Manager: branch leads | Admin: all leads
 */
function buildRoleFilter(user) {
    if (user.role === 'admin' || user.role === 'super_admin') {
        return { clause: '', params: [] };
    }
    if (user.role === 'manager') {
        return { clause: ' AND l.branch_id = ?', params: [user.branch_id] };
    }
    return { clause: ' AND l.assigned_to = ?', params: [user.id] };
}

/**
 * Check if user owns a lead (assigned_to = userId)
 */
async function checkLeadOwnership(leadId, userId) {
    const [rows] = await pool.query(
        'SELECT id, assigned_to, name FROM leads WHERE id = ?',
        [leadId]
    );
    if (rows.length === 0) return { exists: false };
    return { exists: true, isOwner: rows[0].assigned_to === userId, lead: rows[0] };
}

// ========================================
// LIST & STATS ENDPOINTS
// ========================================

/**
 * GET /api/leads
 * List all leads with filters and pagination
 */
router.get('/', requirePermission('leads', 'view'), async (req, res) => {
    try {
        const {
            status,
            priority,
            assigned_to,
            branch_id,
            search,
            date_from,
            date_to,
            source,
            page = 1,
            limit = 25,
            sort_by = 'created_at',
            sort_order = 'DESC'
        } = req.query;

        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
        const offset = (pageNum - 1) * limitNum;

        // Whitelist allowed sort columns to prevent injection
        const allowedSortColumns = [
            'created_at', 'updated_at', 'name', 'lead_number',
            'status', 'priority', 'estimated_budget', 'next_followup_date',
            'last_contact_date', 'total_followups'
        ];
        const sortColumn = allowedSortColumns.includes(sort_by) ? sort_by : 'created_at';
        const sortDir = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        let whereClause = ' WHERE 1=1';
        const params = [];

        if (status) {
            whereClause += ' AND l.status = ?';
            params.push(status);
        }

        if (priority) {
            whereClause += ' AND l.priority = ?';
            params.push(priority);
        }

        if (assigned_to) {
            whereClause += ' AND l.assigned_to = ?';
            params.push(assigned_to);
        }

        if (branch_id) {
            whereClause += ' AND l.branch_id = ?';
            params.push(branch_id);
        }

        if (source) {
            whereClause += ' AND l.source = ?';
            params.push(source);
        }

        if (search) {
            whereClause += ' AND (l.name LIKE ? OR l.phone LIKE ? OR l.email LIKE ? OR l.company LIKE ? OR l.lead_number LIKE ?)';
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
        }

        if (date_from) {
            whereClause += ' AND l.created_at >= ?';
            params.push(date_from);
        }

        if (date_to) {
            whereClause += ' AND l.created_at <= ?';
            params.push(`${date_to} 23:59:59`);
        }

        // Get total count
        const [countRows] = await pool.query(
            `SELECT COUNT(*) as total FROM leads l${whereClause}`,
            params
        );
        const total = countRows[0].total;

        // Get leads with joined data
        const [rows] = await pool.query(
            `SELECT l.*,
                    u.full_name as assigned_to_name,
                    b.name as branch_name,
                    creator.full_name as created_by_name
             FROM leads l
             LEFT JOIN users u ON l.assigned_to = u.id
             LEFT JOIN branches b ON l.branch_id = b.id
             LEFT JOIN users creator ON l.created_by = creator.id
             ${whereClause}
             ORDER BY l.${sortColumn} ${sortDir}
             LIMIT ? OFFSET ?`,
            [...params, limitNum, offset]
        );

        res.json({
            success: true,
            data: rows,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: total,
                total_pages: Math.ceil(total / limitNum)
            }
        });

    } catch (error) {
        console.error('List leads error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve leads'
        });
    }
});

/**
 * GET /api/leads/stats
 * Dashboard stats for leads
 */
router.get('/stats', requirePermission('leads', 'view'), async (req, res) => {
    try {
        const { branch_id, assigned_to } = req.query;

        let whereClause = ' WHERE 1=1';
        const params = [];

        if (branch_id) {
            whereClause += ' AND branch_id = ?';
            params.push(branch_id);
        }

        if (assigned_to) {
            whereClause += ' AND assigned_to = ?';
            params.push(assigned_to);
        }

        const [rows] = await pool.query(
            `SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as new_leads,
                SUM(CASE WHEN status = 'contacted' THEN 1 ELSE 0 END) as contacted,
                SUM(CASE WHEN status = 'interested' THEN 1 ELSE 0 END) as interested,
                SUM(CASE WHEN status = 'quoted' THEN 1 ELSE 0 END) as quoted,
                SUM(CASE WHEN status = 'negotiating' THEN 1 ELSE 0 END) as negotiating,
                SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) as won,
                SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) as lost,
                SUM(CASE WHEN status = 'inactive' THEN 1 ELSE 0 END) as inactive,
                SUM(CASE WHEN priority = 'urgent' THEN 1 ELSE 0 END) as urgent,
                SUM(CASE WHEN priority = 'high' THEN 1 ELSE 0 END) as \`high_priority\`,
                SUM(CASE WHEN next_followup_date = CURDATE() THEN 1 ELSE 0 END) as followups_today,
                SUM(CASE WHEN next_followup_date < CURDATE() AND status NOT IN ('won','lost','inactive') THEN 1 ELSE 0 END) as overdue_followups
             FROM leads${whereClause}`,
            params
        );

        res.json({
            success: true,
            data: rows[0]
        });

    } catch (error) {
        console.error('Lead stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve lead statistics'
        });
    }
});

// ========================================
// AI SCORING ENDPOINTS (before /:id)
// ========================================

/**
 * GET /api/leads/scoring/dashboard
 * Score distribution, top leads, predictions, last run
 */
router.get('/scoring/dashboard', requirePermission('leads', 'view'), async (req, res) => {
    try {
        // Score distribution
        const [distribution] = await pool.query(`
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN lead_score >= 80 THEN 1 ELSE 0 END) as hot,
                SUM(CASE WHEN lead_score >= 50 AND lead_score < 80 THEN 1 ELSE 0 END) as warm,
                SUM(CASE WHEN lead_score > 0 AND lead_score < 50 THEN 1 ELSE 0 END) as cold,
                SUM(CASE WHEN lead_score IS NULL OR lead_score = 0 THEN 1 ELSE 0 END) as unscored,
                ROUND(AVG(lead_score), 1) as avg_score
            FROM leads
            WHERE status NOT IN ('won', 'lost', 'closed', 'inactive')
        `);

        // Top 20 scored leads
        const [topLeads] = await pool.query(`
            SELECT l.id, l.name, l.phone, l.email, l.status, l.source,
                   l.estimated_budget, l.lead_score, l.lead_score_updated_at,
                   l.next_followup_date, l.total_followups,
                   u.full_name as assigned_name, b.name as branch_name,
                   als.score_breakdown, als.ai_recommendation, als.next_action
            FROM leads l
            LEFT JOIN users u ON l.assigned_to = u.id
            LEFT JOIN branches b ON l.branch_id = b.id
            LEFT JOIN ai_lead_scores als ON l.id = als.lead_id
            WHERE l.status NOT IN ('won', 'lost', 'closed', 'inactive')
                AND l.lead_score IS NOT NULL
            ORDER BY l.lead_score DESC
            LIMIT 20
        `);

        // Recent predictions
        const [predictions] = await pool.query(`
            SELECT lcp.*, l.name as lead_name
            FROM lead_conversion_predictions lcp
            JOIN leads l ON lcp.lead_id = l.id
            ORDER BY lcp.predicted_at DESC
            LIMIT 10
        `);

        // Last scoring run
        const [lastRun] = await pool.query(`
            SELECT id, status, summary, duration_ms, created_at
            FROM ai_analysis_runs
            WHERE analysis_type = 'lead_scoring'
            ORDER BY created_at DESC LIMIT 1
        `);

        // Predicted conversions count (probability > 60%)
        const [conversionCount] = await pool.query(`
            SELECT COUNT(DISTINCT lead_id) as count
            FROM lead_conversion_predictions
            WHERE conversion_probability >= 60
        `);

        res.json({
            success: true,
            data: {
                distribution: distribution[0],
                topLeads,
                predictions,
                lastRun: lastRun[0] || null,
                predictedConversions: conversionCount[0].count
            }
        });
    } catch (error) {
        console.error('Scoring dashboard error:', error);
        res.status(500).json({ success: false, message: 'Failed to load scoring dashboard' });
    }
});

/**
 * POST /api/leads/scoring/nurture
 * Trigger WA nurture campaign by tier
 */
router.post('/scoring/nurture', requirePermission('leads', 'edit'), async (req, res) => {
    try {
        const { tier } = req.body; // hot, warm, cold
        if (!['hot', 'warm', 'cold'].includes(tier)) {
            return res.status(400).json({ success: false, message: 'Invalid tier. Must be hot, warm, or cold.' });
        }

        let scoreCondition;
        if (tier === 'hot') scoreCondition = 'lead_score >= 80';
        else if (tier === 'warm') scoreCondition = 'lead_score >= 50 AND lead_score < 80';
        else scoreCondition = 'lead_score > 0 AND lead_score < 50';

        const [leads] = await pool.query(`
            SELECT id FROM leads
            WHERE ${scoreCondition}
                AND status NOT IN ('won', 'lost', 'closed', 'inactive')
                AND phone IS NOT NULL AND phone != ''
        `);

        if (leads.length === 0) {
            return res.json({ success: true, message: `No ${tier} leads with phone numbers found.`, data: { populated: 0 } });
        }

        const leadIds = leads.map(l => l.id);
        const result = await leadManager.triggerNurtureCampaign(leadIds, tier, req.user.id);

        res.json({ success: true, message: `Nurture campaign created for ${result.populated} ${tier} leads`, data: result });
    } catch (error) {
        console.error('Nurture campaign error:', error);
        res.status(500).json({ success: false, message: 'Failed to create nurture campaign' });
    }
});

// ========================================
// STAFF OWN-LEAD ENDPOINTS (before /:id)
// ========================================

/**
 * GET /api/leads/my/stats
 * Personal lead stats for staff
 */
router.get('/my/stats', requirePermission('leads', 'own.view'), async (req, res) => {
    try {
        const userId = req.user.id;

        const [rows] = await pool.query(
            `SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as new_leads,
                SUM(CASE WHEN status NOT IN ('won', 'lost', 'inactive') THEN 1 ELSE 0 END) as active,
                SUM(CASE WHEN next_followup_date = CURDATE() THEN 1 ELSE 0 END) as followups_today,
                SUM(CASE WHEN next_followup_date < CURDATE() AND status NOT IN ('won', 'lost', 'inactive') THEN 1 ELSE 0 END) as overdue,
                SUM(CASE WHEN status = 'won' AND MONTH(converted_at) = MONTH(CURDATE()) AND YEAR(converted_at) = YEAR(CURDATE()) THEN 1 ELSE 0 END) as converted_this_month,
                SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) as total_converted,
                SUM(CASE WHEN DATE(created_at) = CURDATE() THEN 1 ELSE 0 END) as added_today
             FROM leads
             WHERE assigned_to = ?`,
            [userId]
        );

        const stats = rows[0];
        stats.conversion_rate = stats.total > 0
            ? parseFloat(((stats.total_converted / stats.total) * 100).toFixed(1))
            : 0;

        res.json({ success: true, data: stats });

    } catch (error) {
        console.error('Staff lead stats error:', error);
        res.status(500).json({ success: false, message: 'Failed to retrieve lead stats' });
    }
});

/**
 * GET /api/leads/my/today
 * Today's followups + overdue leads for staff
 */
router.get('/my/today', requirePermission('leads', 'own.view'), async (req, res) => {
    try {
        const userId = req.user.id;

        // Today's followups
        const [today] = await pool.query(
            `SELECT l.id, l.lead_number, l.name, l.phone, l.email, l.status, l.priority,
                    l.source, l.next_followup_date, l.total_followups, l.estimated_budget,
                    als.score as ai_score
             FROM leads l
             LEFT JOIN ai_lead_scores als ON l.id = als.lead_id
             WHERE l.assigned_to = ?
               AND l.next_followup_date = CURDATE()
               AND l.status NOT IN ('won', 'lost', 'inactive')
             ORDER BY l.priority DESC, l.next_followup_date ASC`,
            [userId]
        );

        // Overdue followups
        const [overdue] = await pool.query(
            `SELECT l.id, l.lead_number, l.name, l.phone, l.email, l.status, l.priority,
                    l.source, l.next_followup_date, l.total_followups, l.estimated_budget,
                    als.score as ai_score
             FROM leads l
             LEFT JOIN ai_lead_scores als ON l.id = als.lead_id
             WHERE l.assigned_to = ?
               AND l.next_followup_date < CURDATE()
               AND l.status NOT IN ('won', 'lost', 'inactive')
             ORDER BY l.next_followup_date ASC`,
            [userId]
        );

        res.json({
            success: true,
            data: {
                today,
                overdue,
                today_count: today.length,
                overdue_count: overdue.length
            }
        });

    } catch (error) {
        console.error('Staff today leads error:', error);
        res.status(500).json({ success: false, message: 'Failed to retrieve today\'s leads' });
    }
});

/**
 * GET /api/leads/my/list
 * Staff's own leads with filters and pagination
 */
router.get('/my/list', requirePermission('leads', 'own.view'), async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            status,
            priority,
            search,
            source,
            filter_tab = 'all',
            page = 1,
            limit = 25,
            sort_by = 'created_at',
            sort_order = 'DESC'
        } = req.query;

        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
        const offset = (pageNum - 1) * limitNum;

        const allowedSortColumns = [
            'created_at', 'updated_at', 'name', 'lead_number',
            'status', 'priority', 'estimated_budget', 'next_followup_date',
            'last_contact_date', 'total_followups'
        ];
        const sortColumn = allowedSortColumns.includes(sort_by) ? sort_by : 'created_at';
        const sortDir = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

        let whereClause = ' WHERE l.assigned_to = ?';
        const params = [userId];

        // Filter tab logic
        if (filter_tab === 'today') {
            whereClause += ' AND l.next_followup_date = CURDATE() AND l.status NOT IN (\'won\', \'lost\', \'inactive\')';
        } else if (filter_tab === 'overdue') {
            whereClause += ' AND l.next_followup_date < CURDATE() AND l.status NOT IN (\'won\', \'lost\', \'inactive\')';
        } else if (filter_tab === 'new') {
            whereClause += ' AND l.status = \'new\'';
        } else if (filter_tab === 'hot') {
            whereClause += ' AND l.lead_score >= 80 AND l.status NOT IN (\'won\', \'lost\', \'inactive\')';
        }

        if (status) {
            whereClause += ' AND l.status = ?';
            params.push(status);
        }

        if (priority) {
            whereClause += ' AND l.priority = ?';
            params.push(priority);
        }

        if (source) {
            whereClause += ' AND l.source = ?';
            params.push(source);
        }

        if (search) {
            whereClause += ' AND (l.name LIKE ? OR l.phone LIKE ? OR l.email LIKE ? OR l.company LIKE ? OR l.lead_number LIKE ?)';
            const searchTerm = `%${search}%`;
            params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);
        }

        // Get total count
        const [countRows] = await pool.query(
            `SELECT COUNT(*) as total FROM leads l${whereClause}`,
            params
        );
        const total = countRows[0].total;

        // Get leads with AI score
        const [rows] = await pool.query(
            `SELECT l.*,
                    b.name as branch_name,
                    als.score as ai_score,
                    als.ai_recommendation
             FROM leads l
             LEFT JOIN branches b ON l.branch_id = b.id
             LEFT JOIN ai_lead_scores als ON l.id = als.lead_id
             ${whereClause}
             ORDER BY l.${sortColumn} ${sortDir}
             LIMIT ? OFFSET ?`,
            [...params, limitNum, offset]
        );

        res.json({
            success: true,
            data: rows,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                total_pages: Math.ceil(total / limitNum)
            }
        });

    } catch (error) {
        console.error('Staff lead list error:', error);
        res.status(500).json({ success: false, message: 'Failed to retrieve leads' });
    }
});

/**
 * POST /api/leads/my/create
 * Staff creates a lead auto-assigned to self
 */
router.post('/my/create', requirePermission('leads', 'own.add'), async (req, res) => {
    try {
        const {
            name, phone, email, company, address, city, state, pincode,
            source, project_type, property_type, estimated_area_sqft,
            estimated_budget, preferred_brand, timeline, notes,
            priority, next_followup_date
        } = req.body;

        if (!name) {
            return res.status(400).json({ success: false, message: 'Lead name is required' });
        }

        const leadNumber = await generateLeadNumber();

        const [result] = await pool.query(
            `INSERT INTO leads
             (lead_number, name, phone, email, company, address, city, state, pincode,
              source, project_type, property_type, estimated_area_sqft,
              estimated_budget, preferred_brand, timeline, notes,
              status, priority, assigned_to, branch_id, next_followup_date, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?)`,
            [
                leadNumber, name, phone || null, email || null, company || null,
                address || null, city || null, state || null, pincode || null,
                source || 'walk_in', project_type || 'interior', property_type || 'house',
                estimated_area_sqft || null, estimated_budget || null,
                preferred_brand || null, timeline || null, notes || null,
                priority || 'medium', req.user.id, req.user.branch_id,
                next_followup_date || null, req.user.id
            ]
        );

        const [newLead] = await pool.query(
            'SELECT * FROM leads WHERE id = ?',
            [result.insertId]
        );

        res.status(201).json({
            success: true,
            message: 'Lead created successfully',
            data: newLead[0]
        });

    } catch (error) {
        console.error('Staff create lead error:', error);
        res.status(500).json({ success: false, message: 'Failed to create lead' });
    }
});

/**
 * PUT /api/leads/my/:id
 * Staff updates own lead
 */
router.put('/my/:id', requirePermission('leads', 'own.edit'), async (req, res) => {
    try {
        const leadId = req.params.id;

        const ownership = await checkLeadOwnership(leadId, req.user.id);
        if (!ownership.exists) {
            return res.status(404).json({ success: false, message: 'Lead not found' });
        }
        if (!ownership.isOwner) {
            return res.status(403).json({ success: false, message: 'You can only edit leads assigned to you' });
        }

        const {
            name, phone, email, company, address, city, state, pincode,
            source, priority, notes, project_type, property_type,
            estimated_area_sqft, estimated_budget, preferred_brand,
            timeline, next_followup_date
        } = req.body;

        await pool.query(
            `UPDATE leads SET
                name = COALESCE(?, name),
                phone = COALESCE(?, phone),
                email = COALESCE(?, email),
                company = COALESCE(?, company),
                address = COALESCE(?, address),
                city = COALESCE(?, city),
                state = COALESCE(?, state),
                pincode = COALESCE(?, pincode),
                source = COALESCE(?, source),
                priority = COALESCE(?, priority),
                notes = COALESCE(?, notes),
                project_type = COALESCE(?, project_type),
                property_type = COALESCE(?, property_type),
                estimated_area_sqft = COALESCE(?, estimated_area_sqft),
                estimated_budget = COALESCE(?, estimated_budget),
                preferred_brand = COALESCE(?, preferred_brand),
                timeline = COALESCE(?, timeline),
                next_followup_date = COALESCE(?, next_followup_date)
             WHERE id = ?`,
            [
                name || null, phone || null, email || null, company || null,
                address || null, city || null, state || null, pincode || null,
                source || null, priority || null, notes || null,
                project_type || null, property_type || null,
                estimated_area_sqft || null, estimated_budget || null,
                preferred_brand || null, timeline || null,
                next_followup_date || null, leadId
            ]
        );

        const [updated] = await pool.query(
            `SELECT l.*, b.name as branch_name
             FROM leads l
             LEFT JOIN branches b ON l.branch_id = b.id
             WHERE l.id = ?`,
            [leadId]
        );

        res.json({
            success: true,
            message: 'Lead updated successfully',
            data: updated[0]
        });

    } catch (error) {
        console.error('Staff update lead error:', error);
        res.status(500).json({ success: false, message: 'Failed to update lead' });
    }
});

/**
 * PATCH /api/leads/my/:id/status
 * Staff changes lead status (cannot set 'won' — use convert)
 */
router.patch('/my/:id/status', requirePermission('leads', 'own.edit'), async (req, res) => {
    try {
        const leadId = req.params.id;
        const { status, lost_reason } = req.body;

        const ownership = await checkLeadOwnership(leadId, req.user.id);
        if (!ownership.exists) {
            return res.status(404).json({ success: false, message: 'Lead not found' });
        }
        if (!ownership.isOwner) {
            return res.status(403).json({ success: false, message: 'You can only update leads assigned to you' });
        }

        if (!status) {
            return res.status(400).json({ success: false, message: 'Status is required' });
        }

        const validStatuses = ['new', 'contacted', 'interested', 'quoted', 'negotiating', 'lost'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: `Invalid status. Staff can set: ${validStatuses.join(', ')}`
            });
        }

        if (status === 'lost' && !lost_reason) {
            return res.status(400).json({
                success: false,
                message: 'Lost reason is required when marking a lead as lost'
            });
        }

        const updateFields = ['status = ?'];
        const updateParams = [status];

        if (status === 'lost' && lost_reason) {
            updateFields.push('lost_reason = ?');
            updateParams.push(lost_reason);
        }

        updateParams.push(leadId);

        await pool.query(
            `UPDATE leads SET ${updateFields.join(', ')} WHERE id = ?`,
            updateParams
        );

        const [updated] = await pool.query('SELECT * FROM leads WHERE id = ?', [leadId]);

        res.json({
            success: true,
            message: `Lead status updated to ${status}`,
            data: updated[0]
        });

    } catch (error) {
        console.error('Staff update lead status error:', error);
        res.status(500).json({ success: false, message: 'Failed to update lead status' });
    }
});

/**
 * POST /api/leads/my/:id/followup
 * Staff logs a followup on own lead
 */
router.post('/my/:id/followup', requirePermission('leads', 'own.edit'), async (req, res) => {
    try {
        const leadId = req.params.id;
        const userId = req.user.id;

        const ownership = await checkLeadOwnership(leadId, userId);
        if (!ownership.exists) {
            return res.status(404).json({ success: false, message: 'Lead not found' });
        }
        if (!ownership.isOwner) {
            return res.status(403).json({ success: false, message: 'You can only log followups on leads assigned to you' });
        }

        const { followup_type, notes, outcome, next_followup_date } = req.body;

        if (!followup_type || !notes) {
            return res.status(400).json({ success: false, message: 'Followup type and notes are required' });
        }

        const validTypes = ['call', 'visit', 'email', 'whatsapp', 'sms', 'meeting', 'other'];
        if (!validTypes.includes(followup_type)) {
            return res.status(400).json({
                success: false,
                message: `Invalid followup type. Must be one of: ${validTypes.join(', ')}`
            });
        }

        // Insert followup
        const [result] = await pool.query(
            `INSERT INTO lead_followups
             (lead_id, user_id, followup_type, notes, outcome, next_followup_date)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [leadId, userId, followup_type, notes, outcome || 'callback', next_followup_date || null]
        );

        // Get current lead data for status check
        const [leadData] = await pool.query(
            'SELECT total_followups, status FROM leads WHERE id = ?',
            [leadId]
        );

        const newTotal = (leadData[0].total_followups || 0) + 1;
        const today = new Date();
        const dateStr = today.getFullYear() + '-' +
            String(today.getMonth() + 1).padStart(2, '0') + '-' +
            String(today.getDate()).padStart(2, '0');

        const leadUpdateFields = [
            'total_followups = ?',
            'last_contact_date = ?'
        ];
        const leadUpdateParams = [newTotal, dateStr];

        if (next_followup_date) {
            leadUpdateFields.push('next_followup_date = ?');
            leadUpdateParams.push(next_followup_date);
        }

        // Auto-update status from 'new' to 'contacted' on first followup
        if (leadData[0].status === 'new') {
            leadUpdateFields.push('status = ?');
            leadUpdateParams.push('contacted');
        }

        leadUpdateParams.push(leadId);

        await pool.query(
            `UPDATE leads SET ${leadUpdateFields.join(', ')} WHERE id = ?`,
            leadUpdateParams
        );

        // Fetch the created followup
        const [newFollowup] = await pool.query(
            `SELECT f.*, u.full_name as user_name
             FROM lead_followups f
             LEFT JOIN users u ON f.user_id = u.id
             WHERE f.id = ?`,
            [result.insertId]
        );

        res.status(201).json({
            success: true,
            message: 'Followup added successfully',
            data: newFollowup[0]
        });

    } catch (error) {
        console.error('Staff add followup error:', error);
        res.status(500).json({ success: false, message: 'Failed to add followup' });
    }
});

/**
 * GET /api/leads/my/:id/followups
 * Staff views followup history for own lead
 */
router.get('/my/:id/followups', requirePermission('leads', 'own.view'), async (req, res) => {
    try {
        const leadId = req.params.id;

        const ownership = await checkLeadOwnership(leadId, req.user.id);
        if (!ownership.exists) {
            return res.status(404).json({ success: false, message: 'Lead not found' });
        }
        if (!ownership.isOwner) {
            return res.status(403).json({ success: false, message: 'You can only view followups on leads assigned to you' });
        }

        const [followups] = await pool.query(
            `SELECT f.*, u.full_name as user_name
             FROM lead_followups f
             LEFT JOIN users u ON f.user_id = u.id
             WHERE f.lead_id = ?
             ORDER BY f.created_at DESC
             LIMIT 50`,
            [leadId]
        );

        res.json({
            success: true,
            data: followups
        });

    } catch (error) {
        console.error('Staff get followups error:', error);
        res.status(500).json({ success: false, message: 'Failed to retrieve followups' });
    }
});

// ========================================
// PERFORMANCE LEADERBOARD ENDPOINTS (before /:id)
// ========================================

/**
 * GET /api/leads/performance/leaderboard
 * Lead performance leaderboard (Admin/Manager)
 */
router.get('/performance/leaderboard', requirePermission('leads', 'view'), async (req, res) => {
    try {
        const {
            date_from,
            date_to,
            branch_id
        } = req.query;

        // Default date range: current month
        const now = new Date();
        const defaultFrom = now.getFullYear() + '-' +
            String(now.getMonth() + 1).padStart(2, '0') + '-01';
        const defaultTo = now.getFullYear() + '-' +
            String(now.getMonth() + 1).padStart(2, '0') + '-' +
            String(now.getDate()).padStart(2, '0');

        const fromDate = date_from || defaultFrom;
        const toDate = date_to || defaultTo;

        let branchFilter = '';
        const params = [fromDate, toDate + ' 23:59:59'];

        // Manager auto-filtered to own branch
        if (req.user.role === 'manager') {
            branchFilter = ' AND l.branch_id = ?';
            params.push(req.user.branch_id);
        } else if (branch_id) {
            branchFilter = ' AND l.branch_id = ?';
            params.push(branch_id);
        }

        const [rows] = await pool.query(
            `SELECT
                u.id as user_id,
                u.full_name,
                u.role,
                b.name as branch_name,
                COUNT(l.id) as total_leads,
                SUM(CASE WHEN l.created_at >= ? AND l.created_at <= ? THEN 1 ELSE 0 END) as leads_created,
                SUM(CASE WHEN l.status = 'won' THEN 1 ELSE 0 END) as leads_won,
                SUM(CASE WHEN l.status NOT IN ('won', 'lost', 'inactive') THEN 1 ELSE 0 END) as active_leads,
                SUM(CASE WHEN l.next_followup_date < CURDATE() AND l.status NOT IN ('won', 'lost', 'inactive') THEN 1 ELSE 0 END) as overdue_count,
                (SELECT COUNT(*) FROM lead_followups lf
                 WHERE lf.user_id = u.id
                   AND lf.created_at >= ? AND lf.created_at <= ?) as total_followups,
                ROUND(
                    CASE WHEN COUNT(l.id) > 0
                        THEN (SUM(CASE WHEN l.status = 'won' THEN 1 ELSE 0 END) / COUNT(l.id)) * 100
                        ELSE 0
                    END, 1
                ) as conversion_rate,
                (SELECT ROUND(AVG(TIMESTAMPDIFF(HOUR, l2.created_at, lf2.created_at)), 1)
                 FROM leads l2
                 INNER JOIN lead_followups lf2 ON l2.id = lf2.lead_id
                    AND lf2.id = (SELECT MIN(lf3.id) FROM lead_followups lf3 WHERE lf3.lead_id = l2.id)
                 WHERE l2.assigned_to = u.id
                   AND l2.created_at >= ? AND l2.created_at <= ?
                ) as avg_response_hours
             FROM users u
             INNER JOIN leads l ON l.assigned_to = u.id
             LEFT JOIN branches b ON u.branch_id = b.id
             WHERE 1=1${branchFilter}
             GROUP BY u.id, u.full_name, u.role, b.name
             HAVING total_leads > 0
             ORDER BY conversion_rate DESC, total_followups DESC`,
            [...params, fromDate, toDate + ' 23:59:59', fromDate, toDate + ' 23:59:59']
        );

        res.json({
            success: true,
            data: rows,
            filters: {
                date_from: fromDate,
                date_to: toDate,
                branch_id: branch_id || null
            }
        });

    } catch (error) {
        console.error('Leaderboard error:', error);
        res.status(500).json({ success: false, message: 'Failed to retrieve leaderboard' });
    }
});

/**
 * GET /api/leads/performance/:userId
 * Specific staff lead performance detail (Admin/Manager)
 */
router.get('/performance/:userId', requirePermission('leads', 'view'), async (req, res) => {
    try {
        const targetUserId = req.params.userId;

        // Verify user exists
        const [users] = await pool.query(
            'SELECT id, full_name, role, branch_id FROM users WHERE id = ?',
            [targetUserId]
        );
        if (users.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Manager can only view staff in own branch
        if (req.user.role === 'manager' && users[0].branch_id !== req.user.branch_id) {
            return res.status(403).json({ success: false, message: 'Cannot view staff from another branch' });
        }

        // Status breakdown
        const [statusBreakdown] = await pool.query(
            `SELECT status, COUNT(*) as count
             FROM leads WHERE assigned_to = ?
             GROUP BY status`,
            [targetUserId]
        );

        // Source breakdown
        const [sourceBreakdown] = await pool.query(
            `SELECT source, COUNT(*) as count
             FROM leads WHERE assigned_to = ?
             GROUP BY source`,
            [targetUserId]
        );

        // Recent followups
        const [recentFollowups] = await pool.query(
            `SELECT f.*, l.name as lead_name, l.lead_number
             FROM lead_followups f
             JOIN leads l ON f.lead_id = l.id
             WHERE f.user_id = ?
             ORDER BY f.created_at DESC
             LIMIT 20`,
            [targetUserId]
        );

        // Monthly trend (last 6 months)
        const [monthlyTrend] = await pool.query(
            `SELECT
                DATE_FORMAT(created_at, '%Y-%m') as month,
                COUNT(*) as leads_created,
                SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) as leads_won,
                SUM(CASE WHEN status = 'lost' THEN 1 ELSE 0 END) as leads_lost
             FROM leads
             WHERE assigned_to = ?
               AND created_at >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
             GROUP BY DATE_FORMAT(created_at, '%Y-%m')
             ORDER BY month DESC`,
            [targetUserId]
        );

        res.json({
            success: true,
            data: {
                user: users[0],
                status_breakdown: statusBreakdown,
                source_breakdown: sourceBreakdown,
                recent_followups: recentFollowups,
                monthly_trend: monthlyTrend
            }
        });

    } catch (error) {
        console.error('Staff performance detail error:', error);
        res.status(500).json({ success: false, message: 'Failed to retrieve staff performance' });
    }
});

// ========================================
// SINGLE LEAD ENDPOINTS
// ========================================

/**
 * GET /api/leads/:id
 * Get single lead with followups
 */
router.get('/:id', requirePermission('leads', 'view'), async (req, res) => {
    try {
        const leadId = req.params.id;

        const [leads] = await pool.query(
            `SELECT l.*,
                    u.full_name as assigned_to_name,
                    b.name as branch_name,
                    creator.full_name as created_by_name,
                    c.name as customer_name
             FROM leads l
             LEFT JOIN users u ON l.assigned_to = u.id
             LEFT JOIN branches b ON l.branch_id = b.id
             LEFT JOIN users creator ON l.created_by = creator.id
             LEFT JOIN customers c ON l.customer_id = c.id
             WHERE l.id = ?`,
            [leadId]
        );

        if (leads.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Lead not found'
            });
        }

        // Get recent followups
        const [followups] = await pool.query(
            `SELECT f.*, u.full_name as user_name
             FROM lead_followups f
             LEFT JOIN users u ON f.user_id = u.id
             WHERE f.lead_id = ?
             ORDER BY f.created_at DESC
             LIMIT 10`,
            [leadId]
        );

        res.json({
            success: true,
            data: {
                ...leads[0],
                followups: followups
            }
        });

    } catch (error) {
        console.error('Get lead error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve lead'
        });
    }
});

/**
 * POST /api/leads
 * Create a new lead
 */
router.post('/', requirePermission('leads', 'add'), async (req, res) => {
    try {
        const {
            name, phone, email, company, address, city, state, pincode,
            source, project_type, property_type, estimated_area_sqft,
            estimated_budget, preferred_brand, timeline, notes,
            priority, assigned_to, branch_id, next_followup_date
        } = req.body;

        // Validation
        if (!name) {
            return res.status(400).json({
                success: false,
                message: 'Lead name is required'
            });
        }

        const leadNumber = await generateLeadNumber();
        const createdBy = req.user.id;
        const leadBranch = branch_id || req.user.branch_id;

        const [result] = await pool.query(
            `INSERT INTO leads
             (lead_number, name, phone, email, company, address, city, state, pincode,
              source, project_type, property_type, estimated_area_sqft,
              estimated_budget, preferred_brand, timeline, notes,
              status, priority, assigned_to, branch_id, next_followup_date, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?)`,
            [
                leadNumber, name, phone || null, email || null, company || null,
                address || null, city || null, state || null, pincode || null,
                source || 'walk_in', project_type || 'interior', property_type || 'house',
                estimated_area_sqft || null, estimated_budget || null,
                preferred_brand || null, timeline || null, notes || null,
                priority || 'medium', assigned_to || null, leadBranch || null,
                next_followup_date || null, createdBy
            ]
        );

        // Fetch the created lead
        const [newLead] = await pool.query(
            'SELECT * FROM leads WHERE id = ?',
            [result.insertId]
        );

        res.status(201).json({
            success: true,
            message: 'Lead created successfully',
            data: newLead[0]
        });

    } catch (error) {
        console.error('Create lead error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create lead'
        });
    }
});

/**
 * PUT /api/leads/:id
 * Update a lead
 */
router.put('/:id', requirePermission('leads', 'edit'), async (req, res) => {
    try {
        const leadId = req.params.id;
        const {
            name, phone, email, company, address, city, state, pincode,
            source, project_type, property_type, estimated_area_sqft,
            estimated_budget, preferred_brand, timeline, notes,
            priority, assigned_to, branch_id, next_followup_date, lost_reason
        } = req.body;

        // Check if lead exists
        const [existing] = await pool.query(
            'SELECT id FROM leads WHERE id = ?',
            [leadId]
        );

        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Lead not found'
            });
        }

        await pool.query(
            `UPDATE leads SET
                name = COALESCE(?, name),
                phone = COALESCE(?, phone),
                email = COALESCE(?, email),
                company = COALESCE(?, company),
                address = COALESCE(?, address),
                city = COALESCE(?, city),
                state = COALESCE(?, state),
                pincode = COALESCE(?, pincode),
                source = COALESCE(?, source),
                project_type = COALESCE(?, project_type),
                property_type = COALESCE(?, property_type),
                estimated_area_sqft = COALESCE(?, estimated_area_sqft),
                estimated_budget = COALESCE(?, estimated_budget),
                preferred_brand = COALESCE(?, preferred_brand),
                timeline = COALESCE(?, timeline),
                notes = COALESCE(?, notes),
                priority = COALESCE(?, priority),
                assigned_to = COALESCE(?, assigned_to),
                branch_id = COALESCE(?, branch_id),
                next_followup_date = COALESCE(?, next_followup_date),
                lost_reason = COALESCE(?, lost_reason)
             WHERE id = ?`,
            [
                name || null, phone || null, email || null, company || null,
                address || null, city || null, state || null, pincode || null,
                source || null, project_type || null, property_type || null,
                estimated_area_sqft || null, estimated_budget || null,
                preferred_brand || null, timeline || null, notes || null,
                priority || null, assigned_to || null, branch_id || null,
                next_followup_date || null, lost_reason || null,
                leadId
            ]
        );

        // Fetch updated lead
        const [updated] = await pool.query(
            `SELECT l.*, u.full_name as assigned_to_name, b.name as branch_name
             FROM leads l
             LEFT JOIN users u ON l.assigned_to = u.id
             LEFT JOIN branches b ON l.branch_id = b.id
             WHERE l.id = ?`,
            [leadId]
        );

        res.json({
            success: true,
            message: 'Lead updated successfully',
            data: updated[0]
        });

    } catch (error) {
        console.error('Update lead error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update lead'
        });
    }
});

/**
 * DELETE /api/leads/:id
 * Soft delete lead (set status to inactive)
 */
router.delete('/:id', requirePermission('leads', 'delete'), async (req, res) => {
    try {
        const leadId = req.params.id;

        const [existing] = await pool.query(
            'SELECT id, status FROM leads WHERE id = ?',
            [leadId]
        );

        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Lead not found'
            });
        }

        if (existing[0].status === 'inactive') {
            return res.status(400).json({
                success: false,
                message: 'Lead is already inactive'
            });
        }

        await pool.query(
            `UPDATE leads SET status = 'inactive' WHERE id = ?`,
            [leadId]
        );

        res.json({
            success: true,
            message: 'Lead deactivated successfully',
            data: { id: parseInt(leadId), status: 'inactive' }
        });

    } catch (error) {
        console.error('Delete lead error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to deactivate lead'
        });
    }
});

// ========================================
// STATUS & ASSIGNMENT ENDPOINTS
// ========================================

/**
 * PATCH /api/leads/:id/status
 * Update lead status
 */
router.patch('/:id/status', requirePermission('leads', 'edit'), async (req, res) => {
    try {
        const leadId = req.params.id;
        const { status, lost_reason } = req.body;

        if (!status) {
            return res.status(400).json({
                success: false,
                message: 'Status is required'
            });
        }

        const validStatuses = ['new', 'contacted', 'interested', 'quoted', 'negotiating', 'won', 'lost', 'inactive'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`
            });
        }

        const [existing] = await pool.query(
            'SELECT id, status FROM leads WHERE id = ?',
            [leadId]
        );

        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Lead not found'
            });
        }

        // If marking as lost, require a reason
        if (status === 'lost' && !lost_reason) {
            return res.status(400).json({
                success: false,
                message: 'Lost reason is required when marking a lead as lost'
            });
        }

        const updateFields = ['status = ?'];
        const updateParams = [status];

        if (status === 'lost' && lost_reason) {
            updateFields.push('lost_reason = ?');
            updateParams.push(lost_reason);
        }

        updateParams.push(leadId);

        await pool.query(
            `UPDATE leads SET ${updateFields.join(', ')} WHERE id = ?`,
            updateParams
        );

        const [updated] = await pool.query(
            'SELECT * FROM leads WHERE id = ?',
            [leadId]
        );

        res.json({
            success: true,
            message: `Lead status updated to ${status}`,
            data: updated[0]
        });

    } catch (error) {
        console.error('Update lead status error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update lead status'
        });
    }
});

/**
 * PATCH /api/leads/:id/assign
 * Assign lead to a staff member
 */
router.patch('/:id/assign', requirePermission('leads', 'edit'), async (req, res) => {
    try {
        const leadId = req.params.id;
        const { assigned_to } = req.body;

        if (!assigned_to) {
            return res.status(400).json({
                success: false,
                message: 'assigned_to (user ID) is required'
            });
        }

        // Verify lead exists
        const [existing] = await pool.query(
            'SELECT id FROM leads WHERE id = ?',
            [leadId]
        );

        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Lead not found'
            });
        }

        // Verify the assigned user exists
        const [user] = await pool.query(
            'SELECT id, full_name FROM users WHERE id = ? AND status = ?',
            [assigned_to, 'active']
        );

        if (user.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Assigned user not found or inactive'
            });
        }

        await pool.query(
            `UPDATE leads SET assigned_to = ? WHERE id = ?`,
            [assigned_to, leadId]
        );

        // Fetch lead details for notification
        const [leadDetails] = await pool.query('SELECT name, lead_number FROM leads WHERE id = ?', [leadId]);

        // Send notification to newly assigned staff
        try {
            await notificationService.send(parseInt(assigned_to), {
                type: 'lead_assigned',
                title: 'New Lead Assigned',
                body: `Lead "${leadDetails[0].name}" (${leadDetails[0].lead_number}) has been assigned to you`,
                data: { lead_id: parseInt(leadId), lead_number: leadDetails[0].lead_number }
            });
        } catch (notifErr) {
            console.error('Lead assignment notification error:', notifErr.message);
        }

        // Socket.io real-time notification
        if (io) {
            io.to(`user_${assigned_to}`).emit('lead_assigned', {
                lead_id: parseInt(leadId),
                lead_name: leadDetails[0].name,
                lead_number: leadDetails[0].lead_number,
                assigned_by: req.user.full_name
            });
        }

        res.json({
            success: true,
            message: `Lead assigned to ${user[0].full_name}`,
            data: {
                id: parseInt(leadId),
                assigned_to: parseInt(assigned_to),
                assigned_to_name: user[0].full_name
            }
        });

    } catch (error) {
        console.error('Assign lead error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to assign lead'
        });
    }
});

// ========================================
// FOLLOWUP ENDPOINTS
// ========================================

/**
 * POST /api/leads/:id/followup
 * Add a followup entry for a lead
 */
router.post('/:id/followup', requirePermission('leads', 'edit'), async (req, res) => {
    try {
        const leadId = req.params.id;
        const userId = req.user.id;
        const { followup_type, notes, outcome, next_followup_date } = req.body;

        // Validation
        if (!followup_type || !notes) {
            return res.status(400).json({
                success: false,
                message: 'Followup type and notes are required'
            });
        }

        const validTypes = ['call', 'visit', 'email', 'whatsapp', 'sms', 'meeting', 'other'];
        if (!validTypes.includes(followup_type)) {
            return res.status(400).json({
                success: false,
                message: `Invalid followup type. Must be one of: ${validTypes.join(', ')}`
            });
        }

        // Verify lead exists
        const [existing] = await pool.query(
            'SELECT id, total_followups FROM leads WHERE id = ?',
            [leadId]
        );

        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Lead not found'
            });
        }

        // Insert followup
        const [result] = await pool.query(
            `INSERT INTO lead_followups
             (lead_id, user_id, followup_type, notes, outcome, next_followup_date)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                leadId, userId, followup_type, notes,
                outcome || 'callback', next_followup_date || null
            ]
        );

        // Update lead: increment total_followups, set last_contact_date, update next_followup_date
        const today = new Date().toISOString().split('T')[0];
        const newTotal = (existing[0].total_followups || 0) + 1;

        const leadUpdateFields = [
            'total_followups = ?',
            'last_contact_date = ?'
        ];
        const leadUpdateParams = [newTotal, today];

        if (next_followup_date) {
            leadUpdateFields.push('next_followup_date = ?');
            leadUpdateParams.push(next_followup_date);
        }

        leadUpdateParams.push(leadId);

        await pool.query(
            `UPDATE leads SET ${leadUpdateFields.join(', ')} WHERE id = ?`,
            leadUpdateParams
        );

        // Fetch the created followup
        const [newFollowup] = await pool.query(
            `SELECT f.*, u.full_name as user_name
             FROM lead_followups f
             LEFT JOIN users u ON f.user_id = u.id
             WHERE f.id = ?`,
            [result.insertId]
        );

        res.status(201).json({
            success: true,
            message: 'Followup added successfully',
            data: newFollowup[0]
        });

    } catch (error) {
        console.error('Add followup error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to add followup'
        });
    }
});

/**
 * GET /api/leads/:id/followups
 * Get all followups for a lead
 */
router.get('/:id/followups', requirePermission('leads', 'view'), async (req, res) => {
    try {
        const leadId = req.params.id;
        const { page = 1, limit = 50 } = req.query;

        const pageNum = Math.max(1, parseInt(page));
        const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
        const offset = (pageNum - 1) * limitNum;

        // Verify lead exists
        const [existing] = await pool.query(
            'SELECT id, lead_number, name FROM leads WHERE id = ?',
            [leadId]
        );

        if (existing.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Lead not found'
            });
        }

        // Get total count
        const [countRows] = await pool.query(
            'SELECT COUNT(*) as total FROM lead_followups WHERE lead_id = ?',
            [leadId]
        );
        const total = countRows[0].total;

        // Get followups
        const [followups] = await pool.query(
            `SELECT f.*, u.full_name as user_name
             FROM lead_followups f
             LEFT JOIN users u ON f.user_id = u.id
             WHERE f.lead_id = ?
             ORDER BY f.created_at DESC
             LIMIT ? OFFSET ?`,
            [leadId, limitNum, offset]
        );

        res.json({
            success: true,
            lead: existing[0],
            data: followups,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: total,
                total_pages: Math.ceil(total / limitNum)
            }
        });

    } catch (error) {
        console.error('Get followups error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve followups'
        });
    }
});

// ========================================
// AI SCORE & PREDICTION PER-LEAD
// ========================================

/**
 * GET /api/leads/:id/score
 * Score + breakdown + prediction + follow-up suggestions
 */
router.get('/:id/score', requirePermission('leads', 'view'), async (req, res) => {
    try {
        const leadId = req.params.id;

        // Get lead with score
        const [leads] = await pool.query(`
            SELECT l.id, l.name, l.phone, l.status, l.source, l.estimated_budget,
                   l.lead_score, l.lead_score_updated_at, l.total_followups,
                   l.next_followup_date, l.created_at, l.updated_at,
                   u.full_name as assigned_name, b.name as branch_name,
                   als.score, als.score_breakdown, als.ai_recommendation, als.next_action, als.next_action_date
            FROM leads l
            LEFT JOIN users u ON l.assigned_to = u.id
            LEFT JOIN branches b ON l.branch_id = b.id
            LEFT JOIN ai_lead_scores als ON l.id = als.lead_id
            WHERE l.id = ?
        `, [leadId]);

        if (leads.length === 0) {
            return res.status(404).json({ success: false, message: 'Lead not found' });
        }

        const lead = leads[0];

        // Parse breakdown
        let breakdown = null;
        try { breakdown = lead.score_breakdown ? JSON.parse(lead.score_breakdown) : null; } catch(e) {}

        // Get latest prediction
        const [predictions] = await pool.query(`
            SELECT * FROM lead_conversion_predictions
            WHERE lead_id = ? ORDER BY predicted_at DESC LIMIT 1
        `, [leadId]);

        let prediction = predictions.length > 0 ? predictions[0] : null;
        if (prediction && prediction.factors_json) {
            try { prediction.factors = JSON.parse(prediction.factors_json); } catch(e) { prediction.factors = []; }
        }

        // Get follow-up suggestions (generated live)
        let suggestions = [];
        try {
            suggestions = await leadManager.generateFollowUpSuggestions(leadId);
        } catch (e) {
            console.error('Follow-up suggestions error:', e.message);
        }

        // Recent followups
        const [followups] = await pool.query(`
            SELECT f.followup_type, f.notes, f.outcome, f.created_at, u.full_name as user_name
            FROM lead_followups f
            LEFT JOIN users u ON f.user_id = u.id
            WHERE f.lead_id = ?
            ORDER BY f.created_at DESC LIMIT 5
        `, [leadId]);

        res.json({
            success: true,
            data: {
                lead: {
                    id: lead.id,
                    name: lead.name,
                    phone: lead.phone,
                    status: lead.status,
                    source: lead.source,
                    estimated_budget: lead.estimated_budget,
                    total_followups: lead.total_followups,
                    next_followup_date: lead.next_followup_date,
                    assigned_name: lead.assigned_name,
                    branch_name: lead.branch_name,
                    created_at: lead.created_at,
                    updated_at: lead.updated_at
                },
                score: lead.score || lead.lead_score || 0,
                score_updated_at: lead.lead_score_updated_at,
                breakdown,
                ai_recommendation: lead.ai_recommendation,
                next_action: lead.next_action,
                next_action_date: lead.next_action_date,
                prediction,
                suggestions,
                recentFollowups: followups
            }
        });
    } catch (error) {
        console.error('Get lead score error:', error);
        res.status(500).json({ success: false, message: 'Failed to get lead score details' });
    }
});

/**
 * POST /api/leads/:id/predict
 * Trigger conversion prediction for one lead
 */
router.post('/:id/predict', requirePermission('leads', 'edit'), async (req, res) => {
    try {
        const leadId = req.params.id;

        // Verify lead exists
        const [existing] = await pool.query('SELECT id FROM leads WHERE id = ?', [leadId]);
        if (existing.length === 0) {
            return res.status(404).json({ success: false, message: 'Lead not found' });
        }

        const prediction = await leadManager.predictConversion(leadId);

        res.json({
            success: true,
            message: 'Conversion prediction generated',
            data: prediction
        });
    } catch (error) {
        console.error('Predict conversion error:', error);
        res.status(500).json({ success: false, message: 'Failed to generate prediction' });
    }
});

// ========================================
// CONVERSION ENDPOINT
// ========================================

/**
 * POST /api/leads/:id/convert
 * Convert a lead to a customer
 */
router.post('/:id/convert', requirePermission('leads', 'convert'), async (req, res) => {
    const connection = await pool.getConnection();

    try {
        const leadId = req.params.id;

        await connection.beginTransaction();

        // Get the lead
        const [leads] = await connection.query(
            'SELECT * FROM leads WHERE id = ?',
            [leadId]
        );

        if (leads.length === 0) {
            await connection.rollback();
            connection.release();
            return res.status(404).json({
                success: false,
                message: 'Lead not found'
            });
        }

        const lead = leads[0];

        if (lead.customer_id) {
            await connection.rollback();
            connection.release();
            return res.status(400).json({
                success: false,
                message: 'Lead has already been converted to a customer',
                data: { customer_id: lead.customer_id }
            });
        }

        if (lead.status === 'inactive') {
            await connection.rollback();
            connection.release();
            return res.status(400).json({
                success: false,
                message: 'Cannot convert an inactive lead'
            });
        }

        // Create customer from lead data
        const [customerResult] = await connection.query(
            `INSERT INTO customers (name, phone, email, address, city, status)
             VALUES (?, ?, ?, ?, ?, 'approved')`,
            [
                lead.name,
                lead.phone || null,
                lead.email || null,
                lead.address || null,
                lead.city || null
            ]
        );

        const customerId = customerResult.insertId;
        const now = new Date();

        // Update lead with customer reference and won status
        await connection.query(
            `UPDATE leads SET customer_id = ?, converted_at = ?, status = 'won' WHERE id = ?`,
            [customerId, now, leadId]
        );

        // Add a conversion followup entry
        await connection.query(
            `INSERT INTO lead_followups (lead_id, user_id, followup_type, notes, outcome)
             VALUES (?, ?, 'other', 'Lead converted to customer', 'converted')`,
            [leadId, req.user.id]
        );

        // Update followup count
        await connection.query(
            `UPDATE leads SET total_followups = total_followups + 1, last_contact_date = CURDATE() WHERE id = ?`,
            [leadId]
        );

        await connection.commit();
        connection.release();

        // Fetch the created customer
        const [newCustomer] = await pool.query(
            'SELECT * FROM customers WHERE id = ?',
            [customerId]
        );

        res.status(201).json({
            success: true,
            message: 'Lead successfully converted to customer',
            data: {
                lead_id: parseInt(leadId),
                customer_id: customerId,
                customer: newCustomer[0],
                converted_at: now
            }
        });

    } catch (error) {
        await connection.rollback();
        connection.release();
        console.error('Convert lead error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to convert lead to customer'
        });
    }
});

module.exports = {
    router,
    setPool,
    setIO
};
