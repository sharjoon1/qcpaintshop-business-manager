/**
 * LEADS MODULE ROUTES
 * Handles lead management, followups, conversion, and assignment
 */

const express = require('express');
const router = express.Router();
const { requirePermission, requireAuth } = require('../middleware/permissionMiddleware');

// Database connection (imported from main app)
let pool;

function setPool(dbPool) {
    pool = dbPool;
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
    setPool
};
