/**
 * WA CONTACTS ROUTES
 * WhatsApp contact and group management
 *
 * Endpoints:
 *   GET    /api/wa-contacts/                    - List contacts (paginated, searchable, filterable)
 *   POST   /api/wa-contacts/                    - Create contact manually
 *   PUT    /api/wa-contacts/:phone              - Update contact
 *   DELETE /api/wa-contacts/:phone              - Delete contact + group memberships
 *   POST   /api/wa-contacts/import              - Import from leads or customers
 *   GET    /api/wa-contacts/groups              - List all groups
 *   POST   /api/wa-contacts/groups              - Create group
 *   PUT    /api/wa-contacts/groups/:id          - Update group
 *   DELETE /api/wa-contacts/groups/:id          - Delete group (CASCADE)
 *   GET    /api/wa-contacts/groups/:id/members  - List group members
 *   POST   /api/wa-contacts/groups/:id/members  - Add members to group
 *   DELETE /api/wa-contacts/groups/:id/members  - Remove members from group
 */

const express = require('express');
const router = express.Router();
const { requireAuth, requirePermission } = require('../middleware/permissionMiddleware');

let pool;
function setPool(p) { pool = p; }

router.use(requireAuth);

const contactsPerm = requirePermission('whatsapp', 'contacts');
const managePerm = requirePermission('whatsapp', 'contacts_manage');

// ─── GROUPS (named routes BEFORE /:phone) ───────────────────────────

// GET /groups - List all groups
router.get('/groups', contactsPerm, async (req, res) => {
    try {
        const [groups] = await pool.query(`
            SELECT g.*, u.full_name AS created_by_name
            FROM wa_contact_groups g
            LEFT JOIN users u ON g.created_by = u.id
            ORDER BY g.name ASC
        `);
        res.json({ groups });
    } catch (err) {
        console.error('[WA Contacts] List groups error:', err.message);
        res.status(500).json({ error: 'Failed to load groups' });
    }
});

// POST /groups - Create group
router.post('/groups', managePerm, async (req, res) => {
    try {
        const { name, description, color } = req.body;
        if (!name) return res.status(400).json({ error: 'Group name is required' });

        const [result] = await pool.query(
            'INSERT INTO wa_contact_groups (name, description, color, created_by) VALUES (?, ?, ?, ?)',
            [name, description || null, color || '#6366F1', req.user.id]
        );
        res.json({ success: true, id: result.insertId });
    } catch (err) {
        console.error('[WA Contacts] Create group error:', err.message);
        res.status(500).json({ error: 'Failed to create group' });
    }
});

// PUT /groups/:id - Update group
router.put('/groups/:id', managePerm, async (req, res) => {
    try {
        const { name, description, color } = req.body;
        const groupId = Number(req.params.id);
        await pool.query(
            'UPDATE wa_contact_groups SET name = COALESCE(?, name), description = COALESCE(?, description), color = COALESCE(?, color) WHERE id = ?',
            [name || null, description !== undefined ? description : null, color || null, groupId]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('[WA Contacts] Update group error:', err.message);
        res.status(500).json({ error: 'Failed to update group' });
    }
});

// DELETE /groups/:id - Delete group (CASCADE deletes members)
router.delete('/groups/:id', managePerm, async (req, res) => {
    try {
        const groupId = Number(req.params.id);
        await pool.query('DELETE FROM wa_contact_groups WHERE id = ?', [groupId]);
        res.json({ success: true });
    } catch (err) {
        console.error('[WA Contacts] Delete group error:', err.message);
        res.status(500).json({ error: 'Failed to delete group' });
    }
});

// GET /groups/:id/members - List group members with contact info
router.get('/groups/:id/members', contactsPerm, async (req, res) => {
    try {
        const groupId = Number(req.params.id);
        const [members] = await pool.query(`
            SELECT m.id, m.phone, m.added_at,
                   wc.saved_name, wc.pushname, wc.profile_pic_url, wc.branch_id
            FROM wa_contact_group_members m
            LEFT JOIN whatsapp_contacts wc ON m.phone = wc.phone_number
            WHERE m.group_id = ?
            ORDER BY m.added_at DESC
        `, [groupId]);
        res.json({ members });
    } catch (err) {
        console.error('[WA Contacts] List group members error:', err.message);
        res.status(500).json({ error: 'Failed to load members' });
    }
});

// POST /groups/:id/members - Add members to group
router.post('/groups/:id/members', managePerm, async (req, res) => {
    try {
        const groupId = Number(req.params.id);
        const { phones } = req.body;
        if (!phones || !Array.isArray(phones) || phones.length === 0) {
            return res.status(400).json({ error: 'phones array is required' });
        }

        let added = 0;
        for (const phone of phones) {
            try {
                await pool.query(
                    'INSERT IGNORE INTO wa_contact_group_members (group_id, phone) VALUES (?, ?)',
                    [groupId, phone]
                );
                added++;
            } catch (e) { /* skip duplicates */ }
        }

        // Update member_count
        const [[{ cnt }]] = await pool.query(
            'SELECT COUNT(*) AS cnt FROM wa_contact_group_members WHERE group_id = ?',
            [groupId]
        );
        await pool.query('UPDATE wa_contact_groups SET member_count = ? WHERE id = ?', [cnt, groupId]);

        res.json({ success: true, added, member_count: cnt });
    } catch (err) {
        console.error('[WA Contacts] Add members error:', err.message);
        res.status(500).json({ error: 'Failed to add members' });
    }
});

// DELETE /groups/:id/members - Remove members from group
router.delete('/groups/:id/members', managePerm, async (req, res) => {
    try {
        const groupId = Number(req.params.id);
        const { phones } = req.body;
        if (!phones || !Array.isArray(phones) || phones.length === 0) {
            return res.status(400).json({ error: 'phones array is required' });
        }

        await pool.query(
            'DELETE FROM wa_contact_group_members WHERE group_id = ? AND phone IN (?)',
            [groupId, phones]
        );

        // Update member_count
        const [[{ cnt }]] = await pool.query(
            'SELECT COUNT(*) AS cnt FROM wa_contact_group_members WHERE group_id = ?',
            [groupId]
        );
        await pool.query('UPDATE wa_contact_groups SET member_count = ? WHERE id = ?', [cnt, groupId]);

        res.json({ success: true, member_count: cnt });
    } catch (err) {
        console.error('[WA Contacts] Remove members error:', err.message);
        res.status(500).json({ error: 'Failed to remove members' });
    }
});

// ─── IMPORT (named route before /:phone) ────────────────────────────

// POST /import - Import contacts from leads or customers
router.post('/import', managePerm, async (req, res) => {
    try {
        const { source, branch_id } = req.body;
        if (!source || !['leads', 'customers'].includes(source)) {
            return res.status(400).json({ error: 'source must be "leads" or "customers"' });
        }

        let imported = 0;
        let skipped = 0;

        if (source === 'leads') {
            let query = 'SELECT name, phone FROM leads WHERE phone IS NOT NULL AND phone != ""';
            const params = [];
            if (branch_id) {
                query += ' AND branch_id = ?';
                params.push(Number(branch_id));
            }
            const [leads] = await pool.query(query, params);

            for (const lead of leads) {
                try {
                    await pool.query(
                        `INSERT IGNORE INTO whatsapp_contacts (branch_id, phone_number, saved_name)
                         VALUES (?, ?, ?)`,
                        [lead.branch_id || branch_id || 1, lead.phone, lead.name]
                    );
                    imported++;
                } catch (e) { skipped++; }
            }
        } else {
            // customers from zoho_customers_map
            let query = 'SELECT zoho_contact_name, zoho_phone, branch_id FROM zoho_customers_map WHERE zoho_phone IS NOT NULL AND zoho_phone != ""';
            const params = [];
            if (branch_id) {
                query += ' AND branch_id = ?';
                params.push(Number(branch_id));
            }
            const [customers] = await pool.query(query, params);

            for (const cust of customers) {
                try {
                    await pool.query(
                        `INSERT IGNORE INTO whatsapp_contacts (branch_id, phone_number, saved_name)
                         VALUES (?, ?, ?)`,
                        [cust.branch_id || branch_id || 1, cust.zoho_phone, cust.zoho_contact_name]
                    );
                    imported++;
                } catch (e) { skipped++; }
            }
        }

        res.json({ success: true, imported, skipped });
    } catch (err) {
        console.error('[WA Contacts] Import error:', err.message);
        res.status(500).json({ error: 'Failed to import contacts' });
    }
});

// ─── CONTACTS CRUD ──────────────────────────────────────────────────

// GET / - List contacts (paginated, searchable, filterable by group)
router.get('/', contactsPerm, async (req, res) => {
    try {
        const page = Number(req.query.page) || 1;
        const limit = Number(req.query.limit) || 25;
        const offset = (page - 1) * limit;
        const search = req.query.search || '';
        const groupId = req.query.group_id ? Number(req.query.group_id) : null;

        let where = '1=1';
        const params = [];

        if (search) {
            where += ' AND (wc.saved_name LIKE ? OR wc.pushname LIKE ? OR wc.phone_number LIKE ?)';
            const s = `%${search}%`;
            params.push(s, s, s);
        }

        let joinGroup = '';
        if (groupId) {
            joinGroup = 'INNER JOIN wa_contact_group_members gm ON gm.phone = wc.phone_number AND gm.group_id = ?';
            params.unshift(groupId);
        }

        // Count
        const [[{ total }]] = await pool.query(
            `SELECT COUNT(DISTINCT wc.id) AS total
             FROM whatsapp_contacts wc
             ${joinGroup}
             WHERE ${where}`,
            params
        );

        // Fetch contacts
        const fetchParams = [...params, limit, offset];
        const [contacts] = await pool.query(
            `SELECT wc.id, wc.branch_id, wc.phone_number, wc.pushname, wc.saved_name,
                    wc.profile_pic_url, wc.last_message_at, wc.unread_count, wc.is_pinned, wc.is_muted,
                    GROUP_CONCAT(DISTINCT g.name ORDER BY g.name SEPARATOR ', ') AS group_names,
                    GROUP_CONCAT(DISTINCT g.id ORDER BY g.name SEPARATOR ',') AS group_ids
             FROM whatsapp_contacts wc
             ${joinGroup}
             LEFT JOIN wa_contact_group_members gm2 ON gm2.phone = wc.phone_number
             LEFT JOIN wa_contact_groups g ON g.id = gm2.group_id
             WHERE ${where}
             GROUP BY wc.id
             ORDER BY wc.last_message_at DESC, wc.saved_name ASC
             LIMIT ? OFFSET ?`,
            fetchParams
        );

        res.json({ contacts, total, page, limit });
    } catch (err) {
        console.error('[WA Contacts] List error:', err.message);
        res.status(500).json({ error: 'Failed to load contacts' });
    }
});

// POST / - Create contact manually
router.post('/', managePerm, async (req, res) => {
    try {
        const { phone, name, branch_id } = req.body;
        if (!phone) return res.status(400).json({ error: 'Phone is required' });

        const [result] = await pool.query(
            `INSERT INTO whatsapp_contacts (branch_id, phone_number, saved_name)
             VALUES (?, ?, ?)`,
            [branch_id || 1, phone, name || null]
        );
        res.json({ success: true, id: result.insertId });
    } catch (err) {
        if (err.code === 'ER_DUP_ENTRY') {
            return res.status(409).json({ error: 'Contact already exists' });
        }
        console.error('[WA Contacts] Create error:', err.message);
        res.status(500).json({ error: 'Failed to create contact' });
    }
});

// PUT /:phone - Update contact
router.put('/:phone', managePerm, async (req, res) => {
    try {
        const { saved_name } = req.body;
        await pool.query(
            'UPDATE whatsapp_contacts SET saved_name = ? WHERE phone_number = ?',
            [saved_name, req.params.phone]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('[WA Contacts] Update error:', err.message);
        res.status(500).json({ error: 'Failed to update contact' });
    }
});

// DELETE /:phone - Delete contact + remove from all groups
router.delete('/:phone', managePerm, async (req, res) => {
    try {
        const phone = req.params.phone;
        // Remove from all groups first
        await pool.query('DELETE FROM wa_contact_group_members WHERE phone = ?', [phone]);
        // Update affected group counts
        await pool.query(`
            UPDATE wa_contact_groups g
            SET member_count = (SELECT COUNT(*) FROM wa_contact_group_members WHERE group_id = g.id)
        `);
        // Delete the contact
        await pool.query('DELETE FROM whatsapp_contacts WHERE phone_number = ?', [phone]);
        res.json({ success: true });
    } catch (err) {
        console.error('[WA Contacts] Delete error:', err.message);
        res.status(500).json({ error: 'Failed to delete contact' });
    }
});

module.exports = { router, setPool };
