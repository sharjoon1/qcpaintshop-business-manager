# Staff Lead Management System - Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable each staff member to manage their own leads with a mobile-first page, auto-filtering by assignment, notifications, and an admin leaderboard.

**Architecture:** New `staff-leads.html` page with dedicated staff-facing API endpoints. Existing `routes/leads.js` enhanced with role-based auto-filtering (`assigned_to` for staff, `branch_id` for manager, no filter for admin). Admin `admin-leads.html` gets a new "Staff Performance" leaderboard tab. Notifications via existing `notification-service.js` + Socket.io.

**Tech Stack:** Express.js, MySQL, Socket.io, Tailwind CSS, vanilla JS, existing notification-service.js

**Design Doc:** `docs/plans/2026-02-27-staff-lead-management-design.md`

---

## Task 1: Permission Migration

**Files:**
- Create: `migrations/migrate-staff-leads-permissions.js`

**Step 1: Write the migration file**

```javascript
/**
 * Migration: Add staff lead management permissions
 * Adds leads.own.view, leads.own.add, leads.own.edit permissions
 * and assigns them to the 'staff' role.
 *
 * Run: node migrations/migrate-staff-leads-permissions.js
 */

require('dotenv').config();
const mysql = require('mysql2/promise');

async function migrate() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'qc_business_manager',
        waitForConnections: true,
        connectionLimit: 5
    });

    console.log('Starting staff leads permissions migration...\n');

    try {
        // 1. Insert leads.own permissions
        console.log('[1/2] Adding leads.own permissions...');
        const perms = [
            ['leads', 'own.view', 'View Own Leads', 'View leads assigned to self'],
            ['leads', 'own.add', 'Add Own Leads', 'Create new leads (auto-assigned to self)'],
            ['leads', 'own.edit', 'Edit Own Leads', 'Update own leads, log followups, change status']
        ];

        let added = 0;
        for (const [module, action, displayName, description] of perms) {
            const [existing] = await pool.query(
                'SELECT id FROM permissions WHERE module = ? AND action = ?',
                [module, action]
            );
            if (existing.length === 0) {
                await pool.query(
                    'INSERT INTO permissions (module, action, display_name, description) VALUES (?, ?, ?, ?)',
                    [module, action, displayName, description]
                );
                console.log(`  -> Added ${module}.${action} (${displayName})`);
                added++;
            } else {
                console.log(`  -> ${module}.${action} already exists (id=${existing[0].id}), skipping`);
            }
        }
        console.log(`  -> ${added} permissions added`);

        // 2. Auto-assign to staff, manager, admin roles
        console.log('[2/2] Auto-assigning to staff/manager/admin roles...');
        const [roles] = await pool.query(
            "SELECT id, name FROM roles WHERE name IN ('admin', 'manager', 'staff', 'super_admin') AND status = 'active'"
        );
        const [permRows] = await pool.query(
            "SELECT id, module, action FROM permissions WHERE module = 'leads' AND action LIKE 'own.%'"
        );

        let assigned = 0;
        for (const role of roles) {
            for (const perm of permRows) {
                const [exists] = await pool.query(
                    'SELECT id FROM role_permissions WHERE role_id = ? AND permission_id = ?',
                    [role.id, perm.id]
                );
                if (exists.length === 0) {
                    await pool.query(
                        'INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)',
                        [role.id, perm.id]
                    );
                    console.log(`  -> Assigned ${perm.module}.${perm.action} to ${role.name}`);
                    assigned++;
                }
            }
        }
        console.log(`  -> ${assigned} role-permission mappings created`);

        console.log('\n=== Staff leads permissions migration completed ===');
    } catch (err) {
        console.error('Migration failed:', err.message);
        throw err;
    } finally {
        await pool.end();
    }
}

migrate().catch(err => {
    console.error(err);
    process.exit(1);
});
```

**Step 2: Run the migration**

Run: `node migrations/migrate-staff-leads-permissions.js`
Expected: 3 permissions added, mapped to staff/manager/admin roles

**Step 3: Commit**

```bash
git add migrations/migrate-staff-leads-permissions.js
git commit -m "feat: add staff lead management permissions (leads.own.view/add/edit)"
```

---

## Task 2: Backend API — Staff-specific Endpoints

**Files:**
- Modify: `routes/leads.js` (add new endpoints BEFORE `/:id` routes at line 357)

**Context:** All new endpoints go between line 316 (end of nurture endpoint) and line 357 (start of `/:id` endpoint). Named routes MUST come before parameterized `/:id` routes in Express.

**Step 1: Add notification service import and io reference**

At the top of `routes/leads.js` (after line 9), add:

```javascript
const notificationService = require('../services/notification-service');

let io;

function setIO(socketIO) {
    io = socketIO;
}
```

Update the module.exports at the bottom (line 1167-1170) to include `setIO`:

```javascript
module.exports = {
    router,
    setPool,
    setIO
};
```

**Step 2: Add helper function for role-based filtering**

After the `generateLeadNumber()` function (around line 55), add:

```javascript
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
    // staff and all other roles: own leads only
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
```

**Step 3: Add `GET /api/leads/my/stats` endpoint**

Insert this BEFORE the `/:id` route (before line 357). Place it after the scoring/nurture endpoints:

```javascript
// ========================================
// STAFF-SPECIFIC ENDPOINTS (before /:id)
// ========================================

/**
 * GET /api/leads/my/stats
 * Personal lead statistics for the logged-in staff member
 */
router.get('/my/stats', requirePermission('leads', 'own.view'), async (req, res) => {
    try {
        const userId = req.user.id;

        const [rows] = await pool.query(
            `SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END) as new_leads,
                SUM(CASE WHEN status NOT IN ('won','lost','inactive') THEN 1 ELSE 0 END) as active_leads,
                SUM(CASE WHEN next_followup_date = CURDATE() THEN 1 ELSE 0 END) as followups_today,
                SUM(CASE WHEN next_followup_date < CURDATE() AND status NOT IN ('won','lost','inactive') THEN 1 ELSE 0 END) as overdue,
                SUM(CASE WHEN status = 'won' AND MONTH(converted_at) = MONTH(CURDATE()) AND YEAR(converted_at) = YEAR(CURDATE()) THEN 1 ELSE 0 END) as converted_this_month,
                SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) as total_converted,
                SUM(CASE WHEN DATE(created_at) = CURDATE() THEN 1 ELSE 0 END) as added_today
             FROM leads
             WHERE assigned_to = ?`,
            [userId]
        );

        const stats = rows[0];
        stats.conversion_rate = stats.total > 0
            ? Math.round((stats.total_converted / stats.total) * 100)
            : 0;

        res.json({ success: true, data: stats });
    } catch (error) {
        console.error('My lead stats error:', error);
        res.status(500).json({ success: false, message: 'Failed to retrieve stats' });
    }
});

/**
 * GET /api/leads/my/today
 * Today's follow-ups and overdue leads for logged-in staff
 */
router.get('/my/today', requirePermission('leads', 'own.view'), async (req, res) => {
    try {
        const userId = req.user.id;

        const [todayFollowups] = await pool.query(
            `SELECT l.*, als.score as ai_score
             FROM leads l
             LEFT JOIN ai_lead_scores als ON l.id = als.lead_id
             WHERE l.assigned_to = ?
               AND l.next_followup_date = CURDATE()
               AND l.status NOT IN ('won','lost','inactive')
             ORDER BY l.priority DESC, l.next_followup_date ASC`,
            [userId]
        );

        const [overdueLeads] = await pool.query(
            `SELECT l.*, als.score as ai_score
             FROM leads l
             LEFT JOIN ai_lead_scores als ON l.id = als.lead_id
             WHERE l.assigned_to = ?
               AND l.next_followup_date < CURDATE()
               AND l.status NOT IN ('won','lost','inactive')
             ORDER BY l.next_followup_date ASC`,
            [userId]
        );

        res.json({
            success: true,
            data: {
                today: todayFollowups,
                overdue: overdueLeads,
                today_count: todayFollowups.length,
                overdue_count: overdueLeads.length
            }
        });
    } catch (error) {
        console.error('My today leads error:', error);
        res.status(500).json({ success: false, message: 'Failed to retrieve today\'s leads' });
    }
});

/**
 * GET /api/leads/my/list
 * Staff's own leads with filters (mirrors GET / but auto-filtered)
 */
router.get('/my/list', requirePermission('leads', 'own.view'), async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            status, priority, search, source,
            filter_tab, // 'all', 'today', 'overdue', 'new', 'hot'
            page = 1, limit = 25,
            sort_by = 'created_at', sort_order = 'DESC'
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
            const s = `%${search}%`;
            params.push(s, s, s, s, s);
        }

        // Filter tabs
        if (filter_tab === 'today') {
            whereClause += ' AND l.next_followup_date = CURDATE() AND l.status NOT IN (\'won\',\'lost\',\'inactive\')';
        } else if (filter_tab === 'overdue') {
            whereClause += ' AND l.next_followup_date < CURDATE() AND l.status NOT IN (\'won\',\'lost\',\'inactive\')';
        } else if (filter_tab === 'new') {
            whereClause += ' AND l.status = \'new\'';
        } else if (filter_tab === 'hot') {
            whereClause += ' AND l.lead_score >= 80';
        }

        const [countRows] = await pool.query(
            `SELECT COUNT(*) as total FROM leads l${whereClause}`, params
        );
        const total = countRows[0].total;

        const [rows] = await pool.query(
            `SELECT l.*, als.score as ai_score, als.ai_recommendation
             FROM leads l
             LEFT JOIN ai_lead_scores als ON l.id = als.lead_id
             ${whereClause}
             ORDER BY l.${sortColumn} ${sortDir}
             LIMIT ? OFFSET ?`,
            [...params, limitNum, offset]
        );

        res.json({
            success: true,
            data: rows,
            pagination: { page: pageNum, limit: limitNum, total, total_pages: Math.ceil(total / limitNum) }
        });
    } catch (error) {
        console.error('My leads list error:', error);
        res.status(500).json({ success: false, message: 'Failed to retrieve leads' });
    }
});

/**
 * POST /api/leads/my/create
 * Staff creates a lead — auto-assigned to self
 */
router.post('/my/create', requirePermission('leads', 'own.add'), async (req, res) => {
    try {
        const userId = req.user.id;
        const {
            name, phone, email, company, address, city, state, pincode,
            source = 'walk_in', priority = 'medium', notes,
            project_type = 'interior', property_type = 'house',
            estimated_area_sqft, estimated_budget, preferred_brand, timeline
        } = req.body;

        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: 'Lead name is required' });
        }

        const lead_number = await generateLeadNumber();

        const [result] = await pool.query(
            `INSERT INTO leads (
                lead_number, name, phone, email, company, address, city, state, pincode,
                source, status, priority, notes, project_type, property_type,
                estimated_area_sqft, estimated_budget, preferred_brand, timeline,
                assigned_to, branch_id, created_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                lead_number, name.trim(), phone || null, email || null, company || null,
                address || null, city || null, state || null, pincode || null,
                source, priority, notes || null, project_type, property_type,
                estimated_area_sqft || null, estimated_budget || null,
                preferred_brand || null, timeline || null,
                userId, req.user.branch_id, userId
            ]
        );

        res.status(201).json({
            success: true,
            message: 'Lead created successfully',
            data: { id: result.insertId, lead_number, assigned_to: userId }
        });
    } catch (error) {
        console.error('Staff create lead error:', error);
        res.status(500).json({ success: false, message: 'Failed to create lead' });
    }
});

/**
 * PUT /api/leads/my/:id
 * Staff updates their own lead
 */
router.put('/my/:id', requirePermission('leads', 'own.edit'), async (req, res) => {
    try {
        const leadId = req.params.id;
        const userId = req.user.id;

        const ownership = await checkLeadOwnership(leadId, userId);
        if (!ownership.exists) {
            return res.status(404).json({ success: false, message: 'Lead not found' });
        }
        if (!ownership.isOwner) {
            return res.status(403).json({ success: false, message: 'You can only edit your own leads' });
        }

        const allowedFields = [
            'name', 'phone', 'email', 'company', 'address', 'city', 'state', 'pincode',
            'source', 'priority', 'notes', 'project_type', 'property_type',
            'estimated_area_sqft', 'estimated_budget', 'preferred_brand', 'timeline',
            'next_followup_date'
        ];

        const updates = [];
        const values = [];

        for (const field of allowedFields) {
            if (req.body[field] !== undefined) {
                updates.push(`${field} = ?`);
                values.push(req.body[field]);
            }
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, message: 'No valid fields to update' });
        }

        values.push(leadId, userId);
        await pool.query(
            `UPDATE leads SET ${updates.join(', ')} WHERE id = ? AND assigned_to = ?`,
            values
        );

        res.json({ success: true, message: 'Lead updated' });
    } catch (error) {
        console.error('Staff update lead error:', error);
        res.status(500).json({ success: false, message: 'Failed to update lead' });
    }
});

/**
 * PATCH /api/leads/my/:id/status
 * Staff changes status of their own lead
 */
router.patch('/my/:id/status', requirePermission('leads', 'own.edit'), async (req, res) => {
    try {
        const leadId = req.params.id;
        const userId = req.user.id;
        const { status, lost_reason } = req.body;

        const ownership = await checkLeadOwnership(leadId, userId);
        if (!ownership.exists) {
            return res.status(404).json({ success: false, message: 'Lead not found' });
        }
        if (!ownership.isOwner) {
            return res.status(403).json({ success: false, message: 'You can only update your own leads' });
        }

        const validStatuses = ['new', 'contacted', 'interested', 'quoted', 'negotiating', 'lost'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: `Invalid status. Staff can set: ${validStatuses.join(', ')}. Use convert endpoint for 'won'.`
            });
        }

        if (status === 'lost' && !lost_reason) {
            return res.status(400).json({ success: false, message: 'lost_reason is required when marking as lost' });
        }

        const updateFields = { status };
        if (status === 'lost') updateFields.lost_reason = lost_reason;

        await pool.query(
            `UPDATE leads SET status = ?, lost_reason = ? WHERE id = ? AND assigned_to = ?`,
            [status, lost_reason || null, leadId, userId]
        );

        res.json({ success: true, message: `Lead status updated to ${status}` });
    } catch (error) {
        console.error('Staff status update error:', error);
        res.status(500).json({ success: false, message: 'Failed to update status' });
    }
});

/**
 * POST /api/leads/my/:id/followup
 * Staff logs a followup on their own lead
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
            return res.status(403).json({ success: false, message: 'You can only add followups to your own leads' });
        }

        const { followup_type = 'call', notes, outcome = 'callback', next_followup_date } = req.body;

        if (!notes || !notes.trim()) {
            return res.status(400).json({ success: false, message: 'Followup notes are required' });
        }

        const validTypes = ['call', 'visit', 'email', 'whatsapp', 'sms', 'meeting', 'other'];
        if (!validTypes.includes(followup_type)) {
            return res.status(400).json({ success: false, message: `Invalid followup type. Valid: ${validTypes.join(', ')}` });
        }

        const [result] = await pool.query(
            `INSERT INTO lead_followups (lead_id, user_id, followup_type, notes, outcome, next_followup_date)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [leadId, userId, followup_type, notes.trim(), outcome, next_followup_date || null]
        );

        // Update lead's followup tracking
        await pool.query(
            `UPDATE leads SET
                total_followups = total_followups + 1,
                last_contact_date = CURDATE(),
                next_followup_date = ?
             WHERE id = ?`,
            [next_followup_date || null, leadId]
        );

        // Auto-update status from 'new' to 'contacted' on first followup
        await pool.query(
            `UPDATE leads SET status = 'contacted' WHERE id = ? AND status = 'new'`,
            [leadId]
        );

        res.status(201).json({
            success: true,
            message: 'Followup logged',
            data: { id: result.insertId }
        });
    } catch (error) {
        console.error('Staff followup error:', error);
        res.status(500).json({ success: false, message: 'Failed to log followup' });
    }
});

/**
 * GET /api/leads/my/:id/followups
 * Get followup history for staff's own lead
 */
router.get('/my/:id/followups', requirePermission('leads', 'own.view'), async (req, res) => {
    try {
        const leadId = req.params.id;
        const userId = req.user.id;

        const ownership = await checkLeadOwnership(leadId, userId);
        if (!ownership.exists) {
            return res.status(404).json({ success: false, message: 'Lead not found' });
        }
        if (!ownership.isOwner) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        const [followups] = await pool.query(
            `SELECT lf.*, u.full_name as user_name
             FROM lead_followups lf
             LEFT JOIN users u ON lf.user_id = u.id
             WHERE lf.lead_id = ?
             ORDER BY lf.created_at DESC
             LIMIT 50`,
            [leadId]
        );

        res.json({ success: true, data: followups });
    } catch (error) {
        console.error('Staff followups list error:', error);
        res.status(500).json({ success: false, message: 'Failed to retrieve followups' });
    }
});
```

**Step 4: Run server to test**

Run: `node server.js` (check for syntax errors)
Expected: Server starts without errors

**Step 5: Commit**

```bash
git add routes/leads.js
git commit -m "feat: add staff-specific lead API endpoints (my/stats, my/list, my/create, my/followup)"
```

---

## Task 3: Backend API — Performance Leaderboard Endpoints

**Files:**
- Modify: `routes/leads.js` (add performance endpoints before `/:id` routes)

**Step 1: Add leaderboard endpoints**

Insert these right after the staff endpoints added in Task 2, still BEFORE `/:id`:

```javascript
// ========================================
// PERFORMANCE / LEADERBOARD ENDPOINTS
// ========================================

/**
 * GET /api/leads/performance/leaderboard
 * Admin/Manager: Staff performance ranking
 */
router.get('/performance/leaderboard', requirePermission('leads', 'view'), async (req, res) => {
    try {
        const { date_from, date_to, branch_id } = req.query;

        // Default: current month
        const now = new Date();
        const defaultFrom = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const defaultTo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        const from = date_from || defaultFrom;
        const to = date_to || defaultTo;

        let branchFilter = '';
        const params = [from, `${to} 23:59:59`, from, `${to} 23:59:59`, from, `${to} 23:59:59`];

        if (branch_id) {
            branchFilter = ' AND u.branch_id = ?';
            params.push(branch_id);
        } else if (req.user.role === 'manager') {
            branchFilter = ' AND u.branch_id = ?';
            params.push(req.user.branch_id);
        }

        const [rows] = await pool.query(
            `SELECT
                u.id as user_id,
                u.full_name,
                u.branch_id,
                b.name as branch_name,
                COUNT(DISTINCT l.id) as total_leads,
                SUM(CASE WHEN l.created_by = u.id AND l.created_at BETWEEN ? AND ? THEN 1 ELSE 0 END) as leads_created,
                SUM(CASE WHEN l.status = 'won' THEN 1 ELSE 0 END) as leads_won,
                SUM(CASE WHEN l.status NOT IN ('won','lost','inactive') THEN 1 ELSE 0 END) as active_leads,
                SUM(CASE WHEN l.next_followup_date < CURDATE() AND l.status NOT IN ('won','lost','inactive') THEN 1 ELSE 0 END) as overdue_count,
                (SELECT COUNT(*) FROM lead_followups lf WHERE lf.user_id = u.id AND lf.created_at BETWEEN ? AND ?) as total_followups,
                ROUND(
                    CASE WHEN COUNT(DISTINCT l.id) > 0
                    THEN (SUM(CASE WHEN l.status = 'won' THEN 1 ELSE 0 END) / COUNT(DISTINCT l.id)) * 100
                    ELSE 0 END, 1
                ) as conversion_rate,
                (SELECT ROUND(AVG(TIMESTAMPDIFF(HOUR, l2.created_at, lf2.created_at)), 1)
                 FROM leads l2
                 JOIN lead_followups lf2 ON l2.id = lf2.lead_id
                 WHERE l2.assigned_to = u.id
                   AND lf2.created_at BETWEEN ? AND ?
                   AND lf2.id = (SELECT MIN(id) FROM lead_followups WHERE lead_id = l2.id)
                ) as avg_response_hours
             FROM users u
             LEFT JOIN leads l ON l.assigned_to = u.id
             LEFT JOIN branches b ON u.branch_id = b.id
             WHERE u.status = 'active' AND u.role = 'staff'${branchFilter}
             GROUP BY u.id
             HAVING total_leads > 0
             ORDER BY conversion_rate DESC, total_followups DESC`,
            params
        );

        res.json({ success: true, data: rows, period: { from, to } });
    } catch (error) {
        console.error('Leaderboard error:', error);
        res.status(500).json({ success: false, message: 'Failed to load leaderboard' });
    }
});

/**
 * GET /api/leads/performance/:userId
 * Admin: Detailed performance for a specific staff member
 */
router.get('/performance/:userId', requirePermission('leads', 'view'), async (req, res) => {
    try {
        const targetUserId = req.params.userId;
        const { date_from, date_to } = req.query;

        const now = new Date();
        const from = date_from || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
        const to = date_to || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

        // User info
        const [userRows] = await pool.query(
            'SELECT id, full_name, branch_id FROM users WHERE id = ?', [targetUserId]
        );
        if (userRows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Lead breakdown by status
        const [statusBreakdown] = await pool.query(
            `SELECT status, COUNT(*) as count
             FROM leads WHERE assigned_to = ?
             GROUP BY status`,
            [targetUserId]
        );

        // Lead breakdown by source
        const [sourceBreakdown] = await pool.query(
            `SELECT source, COUNT(*) as count
             FROM leads WHERE assigned_to = ?
             GROUP BY source`,
            [targetUserId]
        );

        // Recent followups
        const [recentFollowups] = await pool.query(
            `SELECT lf.*, l.name as lead_name, l.lead_number
             FROM lead_followups lf
             JOIN leads l ON lf.lead_id = l.id
             WHERE lf.user_id = ?
             ORDER BY lf.created_at DESC LIMIT 20`,
            [targetUserId]
        );

        // Monthly trend (last 6 months)
        const [monthlyTrend] = await pool.query(
            `SELECT
                DATE_FORMAT(created_at, '%Y-%m') as month,
                COUNT(*) as leads_added,
                SUM(CASE WHEN status = 'won' THEN 1 ELSE 0 END) as converted
             FROM leads
             WHERE assigned_to = ? AND created_at >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
             GROUP BY month
             ORDER BY month`,
            [targetUserId]
        );

        res.json({
            success: true,
            data: {
                user: userRows[0],
                status_breakdown: statusBreakdown,
                source_breakdown: sourceBreakdown,
                recent_followups: recentFollowups,
                monthly_trend: monthlyTrend
            }
        });
    } catch (error) {
        console.error('Staff performance detail error:', error);
        res.status(500).json({ success: false, message: 'Failed to load performance data' });
    }
});
```

**Step 2: Commit**

```bash
git add routes/leads.js
git commit -m "feat: add lead performance leaderboard endpoints for admin"
```

---

## Task 4: Backend — Assignment Notifications

**Files:**
- Modify: `routes/leads.js` — enhance existing `PATCH /:id/assign` endpoint (line 697)
- Modify: `server.js` — wire `setIO` for leads routes

**Step 1: Enhance the assign endpoint with notifications**

In the existing `PATCH /:id/assign` handler (line 697), after the successful UPDATE query (line 738), add notification logic before `res.json()`:

```javascript
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
```

**Step 2: Wire setIO in server.js**

In `server.js`, find where `leadsRoutes.setPool(pool)` is called and add `leadsRoutes.setIO(io)` nearby. Search for `leadsRoutes.setPool` — it should be near other `setPool` calls. Add right after it:

```javascript
leadsRoutes.setIO(io);
```

Also add the notification service setPool/setIO if not already done for leads.

**Step 3: Commit**

```bash
git add routes/leads.js server.js
git commit -m "feat: add notifications when leads are assigned to staff"
```

---

## Task 5: Staff Sidebar Navigation Entry

**Files:**
- Modify: `public/components/staff-sidebar.html`

**Step 1: Add "My Leads" entry to staff sidebar**

Find the "My Work" section in the staff sidebar (`staff-sidebar.html`). Look for the section containing "My Estimates" and "My Requests". Add a "My Leads" entry BEFORE "My Estimates":

```html
    <a href="/staff-leads.html" class="qc-nav-item" data-page="my-leads">
        <span class="qc-nav-item-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg></span>
        <span class="qc-nav-item-text">My Leads</span>
        <span class="qc-nav-tooltip">My Leads</span>
    </a>
```

**Step 2: Add mobile quickbar entry (if applicable)**

If the mobile quickbar at the bottom of staff-sidebar.html has lead-related entries, add one. Otherwise, this is optional and can be added later.

**Step 3: Commit**

```bash
git add public/components/staff-sidebar.html
git commit -m "feat: add My Leads nav entry to staff sidebar"
```

---

## Task 6: Staff Leads Page — HTML + UI

**Files:**
- Create: `public/staff-leads.html`

**Step 1: Create the staff leads page**

Create `public/staff-leads.html` — a mobile-first lead management page. This is the largest file. Key sections:

1. **Head**: Standard meta tags, Tailwind CDN, design-system.css, auth-helper.js, nav-loader
2. **Body** (`data-page="my-leads"`):
   - Header gradient with "My Leads" title + "+ Add Lead" button
   - Stats cards row (scrollable on mobile): Total, New, Today's Follow-ups, Overdue, Converted
   - Filter tabs: All / Today / Overdue / New / Hot
   - Search bar
   - Lead cards container (rendered dynamically)
   - Pipeline view toggle (kanban columns)
3. **Modals**:
   - Add/Edit Lead modal (form with all lead fields)
   - Lead Detail slide-out panel (full info + followup history + add followup + status change)
   - Add Followup modal
4. **JavaScript** (inline at bottom):
   - `loadStats()` → `GET /api/leads/my/stats`
   - `loadLeads(filter)` → `GET /api/leads/my/list?filter_tab=xxx`
   - `saveLead()` → `POST /api/leads/my/create` or `PUT /api/leads/my/:id`
   - `viewLead(id)` → loads lead detail + followups into slide-out
   - `saveFollowup(leadId)` → `POST /api/leads/my/:id/followup`
   - `updateStatus(id, status)` → `PATCH /api/leads/my/:id/status`
   - `callLead(phone)` → `window.open('tel:' + phone)`
   - `whatsappLead(phone)` → `window.open('https://wa.me/91' + phone)`
   - Socket.io listener for `lead_assigned` event → toast notification + reload
   - 60-second auto-refresh

Use the @frontend-design skill when implementing this page for high-quality, polished design. Follow the brand colors: primary `#667eea`, gradient to `#764ba2`.

**Key mobile patterns to follow (from design-system.css):**
- Cards use `bg-white rounded-lg shadow p-4`
- Priority colors: high = red-500, medium = yellow-500, low = green-500
- Status badges: new = blue, contacted = yellow, interested = green, quoted = purple, negotiating = orange, won = emerald, lost = red
- Quick action buttons: small rounded buttons with icons
- Stats cards: horizontal scroll on mobile with `overflow-x-auto flex gap-4`

**Step 2: Commit**

```bash
git add public/staff-leads.html
git commit -m "feat: add staff leads page with full marketing toolkit UI"
```

---

## Task 7: Admin Leaderboard Tab

**Files:**
- Modify: `public/admin-leads.html`

**Step 1: Add "Staff Performance" tab**

In `admin-leads.html`, the page currently has no tabs. Add a tab system at the top (similar to admin-ai.html tab pattern):

- Tab 1: "Lead Management" (existing content)
- Tab 2: "Staff Performance" (new leaderboard)

The leaderboard tab content:
- Date range selector (this month default)
- Branch filter dropdown (admin only)
- Ranked table: Rank, Staff Name, Branch, Total Leads, Created, Won, Rate%, Follow-ups, Avg Response, Active, Overdue
- Click row → expand with `GET /api/leads/performance/:userId` detail (status breakdown, source breakdown, monthly trend, recent followups)

**JavaScript additions:**
- `loadLeaderboard()` → `GET /api/leads/performance/leaderboard?date_from=...&date_to=...`
- `viewStaffPerformance(userId)` → `GET /api/leads/performance/:userId`
- Tab switching logic

**Step 2: Commit**

```bash
git add public/admin-leads.html
git commit -m "feat: add staff performance leaderboard tab to admin leads page"
```

---

## Task 8: Followup Reminder Scheduler

**Files:**
- Create: `services/lead-reminder-scheduler.js`
- Modify: `server.js` (wire scheduler)

**Step 1: Create the reminder scheduler**

```javascript
/**
 * Lead Followup Reminder Scheduler
 * Sends daily reminders at 8 AM IST for staff with leads due today or overdue
 */

const cron = require('node-cron');

let pool, notificationService;

function init(dbPool, notifService) {
    pool = dbPool;
    notificationService = notifService;

    // 8 AM IST = 2:30 AM UTC
    cron.schedule('30 2 * * *', sendDailyReminders, { timezone: 'Asia/Kolkata' });
    console.log('[Lead Reminders] Scheduler initialized — runs at 8:00 AM IST daily');
}

async function sendDailyReminders() {
    try {
        console.log('[Lead Reminders] Running daily followup reminders...');

        // Get staff with followups due today
        const [staffToday] = await pool.query(
            `SELECT assigned_to, COUNT(*) as count
             FROM leads
             WHERE next_followup_date = CURDATE()
               AND status NOT IN ('won','lost','inactive')
               AND assigned_to IS NOT NULL
             GROUP BY assigned_to`
        );

        for (const row of staffToday) {
            await notificationService.send(row.assigned_to, {
                type: 'lead_followup_reminder',
                title: 'Lead Follow-ups Today',
                body: `You have ${row.count} lead follow-up${row.count > 1 ? 's' : ''} scheduled for today`,
                data: { count: row.count, type: 'today' }
            });
        }

        // Get staff with overdue followups
        const [staffOverdue] = await pool.query(
            `SELECT assigned_to, COUNT(*) as count
             FROM leads
             WHERE next_followup_date < CURDATE()
               AND status NOT IN ('won','lost','inactive')
               AND assigned_to IS NOT NULL
             GROUP BY assigned_to`
        );

        for (const row of staffOverdue) {
            await notificationService.send(row.assigned_to, {
                type: 'lead_overdue_reminder',
                title: 'Overdue Lead Follow-ups',
                body: `You have ${row.count} overdue lead follow-up${row.count > 1 ? 's' : ''}. Please follow up today.`,
                data: { count: row.count, type: 'overdue' }
            });
        }

        console.log(`[Lead Reminders] Sent reminders to ${staffToday.length} staff (today), ${staffOverdue.length} staff (overdue)`);
    } catch (error) {
        console.error('[Lead Reminders] Error:', error);
    }
}

module.exports = { init };
```

**Step 2: Wire in server.js**

In `server.js`, after the existing scheduler initializations (search for `cron.schedule` or scheduler requires), add:

```javascript
const leadReminderScheduler = require('./services/lead-reminder-scheduler');
// ... after pool and notificationService are initialized:
leadReminderScheduler.init(pool, notificationService);
```

**Step 3: Commit**

```bash
git add services/lead-reminder-scheduler.js server.js
git commit -m "feat: add daily lead followup reminder scheduler (8 AM IST)"
```

---

## Task 9: Server.js Wiring & Static Route

**Files:**
- Modify: `server.js` — ensure staff-leads.html is served correctly, wire setIO

**Step 1: Verify static file serving**

The Express app should already serve static files from `public/`. Verify that `staff-leads.html` would be accessible at `/staff-leads.html`. If there's explicit routing for staff pages, add:

```javascript
app.get('/staff-leads.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'staff-leads.html'));
});
```

However, if `express.static('public')` is already configured (check existing code), this is not needed.

**Step 2: Verify all wiring**

Check that:
1. `leadsRoutes.setIO(io)` is called after Socket.io is initialized
2. `notificationService` is imported in leads routes
3. The lead reminder scheduler is initialized after pool creation

**Step 3: Commit**

```bash
git add server.js
git commit -m "feat: wire staff leads page routing and socket.io integration"
```

---

## Task 10: Testing & Verification

**Step 1: Run the permission migration**

```bash
node migrations/migrate-staff-leads-permissions.js
```

Expected: 3 permissions added, assigned to staff/manager/admin roles

**Step 2: Start server and test endpoints**

```bash
node server.js
```

Test with curl or browser:
- `GET /api/leads/my/stats` (with staff auth token)
- `GET /api/leads/my/list` (with staff auth token)
- `GET /api/leads/my/today` (with staff auth token)
- `POST /api/leads/my/create` (with staff auth token, body: `{name: "Test Lead", phone: "9876543210"}`)
- `GET /api/leads/performance/leaderboard` (with admin auth token)

**Step 3: Test staff page**

1. Login as staff user
2. Navigate to `/staff-leads.html`
3. Verify: stats cards load, lead list shows only own leads, add lead works, followup logging works
4. Verify: WhatsApp and Call buttons work on mobile
5. Verify: pipeline view toggle works

**Step 4: Test admin leaderboard**

1. Login as admin
2. Navigate to `/admin-leads.html`
3. Click "Staff Performance" tab
4. Verify: leaderboard shows with correct metrics
5. Click a staff row → verify detail panel shows

**Step 5: Test notifications**

1. As admin, assign a lead to a staff member
2. Verify: staff receives in-app notification
3. Verify: Socket.io event fires

**Step 6: Final commit**

```bash
git add -A
git commit -m "feat: complete staff lead management system — verified and tested"
```

---

## Summary of Files

| Action | File | Description |
|--------|------|-------------|
| Create | `migrations/migrate-staff-leads-permissions.js` | Permission migration |
| Modify | `routes/leads.js` | Staff endpoints + leaderboard + notifications |
| Modify | `server.js` | Wire setIO, scheduler, static route |
| Create | `public/staff-leads.html` | Staff lead management page |
| Modify | `public/admin-leads.html` | Leaderboard tab |
| Modify | `public/components/staff-sidebar.html` | "My Leads" nav entry |
| Create | `services/lead-reminder-scheduler.js` | Daily followup reminders |

**Total: 3 new files, 4 modified files**
