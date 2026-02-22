/**
 * WHATSAPP CHAT ROUTES
 * Chat history viewer with conversations and messages
 *
 * Endpoints:
 *   GET    /api/whatsapp-chat/conversations              - List conversations
 *   GET    /api/whatsapp-chat/conversations/:phone/messages - Get messages for a conversation
 *   POST   /api/whatsapp-chat/conversations/:phone/send   - Send text reply
 *   POST   /api/whatsapp-chat/conversations/:phone/send-media - Send media reply
 *   PUT    /api/whatsapp-chat/conversations/:phone/read   - Mark messages as read
 *   PUT    /api/whatsapp-chat/contacts/:phone             - Update contact details
 *   GET    /api/whatsapp-chat/search                      - Search message bodies
 *   GET    /api/whatsapp-chat/stats                       - Chat stats
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const { requirePermission } = require('../middleware/permissionMiddleware');

let pool;
let sessionManager;
let io;

function setPool(p) { pool = p; }
function setSessionManager(sm) { sessionManager = sm; }
function setIO(socketIO) { io = socketIO; }

const perm = requirePermission('zoho', 'whatsapp_chat');

// Multer for media uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'uploads/whatsapp/'),
    filename: (req, file, cb) => {
        const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'chat-' + uniqueName + path.extname(file.originalname));
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 16 * 1024 * 1024 }, // 16MB
    fileFilter: (req, file, cb) => {
        cb(null, true); // Allow all file types for WhatsApp
    }
});

// ========================================
// LIST CONVERSATIONS
// ========================================
router.get('/conversations', perm, async (req, res) => {
    try {
        const { branch_id, search, page = 1, limit = 50 } = req.query;
        const offset = (parseInt(page) - 1) * parseInt(limit);
        const params = [];
        let where = 'WHERE 1=1';

        if (branch_id) {
            where += ' AND wc.branch_id = ?';
            params.push(parseInt(branch_id));
        }
        if (search) {
            where += ' AND (wc.phone_number LIKE ? OR wc.pushname LIKE ? OR wc.saved_name LIKE ?)';
            const s = `%${search}%`;
            params.push(s, s, s);
        }

        const [rows] = await pool.query(`
            SELECT wc.*,
                   b.name as branch_name,
                   (SELECT body FROM whatsapp_messages wm
                    WHERE wm.branch_id = wc.branch_id AND wm.phone_number = wc.phone_number
                    ORDER BY wm.timestamp DESC LIMIT 1) as last_message,
                   (SELECT message_type FROM whatsapp_messages wm
                    WHERE wm.branch_id = wc.branch_id AND wm.phone_number = wc.phone_number
                    ORDER BY wm.timestamp DESC LIMIT 1) as last_message_type,
                   (SELECT direction FROM whatsapp_messages wm
                    WHERE wm.branch_id = wc.branch_id AND wm.phone_number = wc.phone_number
                    ORDER BY wm.timestamp DESC LIMIT 1) as last_direction
            FROM whatsapp_contacts wc
            JOIN branches b ON wc.branch_id = b.id
            ${where}
            ORDER BY wc.is_pinned DESC, wc.last_message_at DESC
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), offset]);

        const [countResult] = await pool.query(
            `SELECT COUNT(*) as total FROM whatsapp_contacts wc ${where}`, params
        );

        res.json({
            conversations: rows,
            total: countResult[0].total,
            page: parseInt(page),
            limit: parseInt(limit)
        });
    } catch (err) {
        console.error('[WA Chat] List conversations error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// GET MESSAGES FOR A CONVERSATION
// ========================================
router.get('/conversations/:phone/messages', perm, async (req, res) => {
    try {
        const { phone } = req.params;
        const { branch_id, before_id, limit = 50 } = req.query;
        const params = [phone];
        let where = 'WHERE wm.phone_number = ?';

        if (branch_id) {
            where += ' AND wm.branch_id = ?';
            params.push(parseInt(branch_id));
        }
        if (before_id) {
            where += ' AND wm.id < ?';
            params.push(parseInt(before_id));
        }

        const [messages] = await pool.query(`
            SELECT wm.*, u.full_name as sent_by_name
            FROM whatsapp_messages wm
            LEFT JOIN users u ON wm.sent_by = u.id
            ${where}
            ORDER BY wm.timestamp DESC, wm.id DESC
            LIMIT ?
        `, [...params, parseInt(limit)]);

        // Return in chronological order
        messages.reverse();

        res.json({ messages, has_more: messages.length === parseInt(limit) });
    } catch (err) {
        console.error('[WA Chat] Get messages error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// SEND TEXT REPLY
// ========================================
router.post('/conversations/:phone/send', perm, async (req, res) => {
    try {
        const { phone } = req.params;
        const { branch_id, message } = req.body;

        if (!branch_id || !message) {
            return res.status(400).json({ error: 'branch_id and message are required' });
        }

        const result = await sessionManager.sendMessage(
            branch_id, phone, message,
            { source: 'admin_reply', sent_by: req.user.id }
        );

        if (!result) {
            return res.status(400).json({ error: 'WhatsApp session not connected for this branch' });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('[WA Chat] Send message error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// SEND MEDIA REPLY
// ========================================
router.post('/conversations/:phone/send-media', perm, upload.single('media'), async (req, res) => {
    try {
        const { phone } = req.params;
        const { branch_id, caption } = req.body;

        if (!branch_id || !req.file) {
            return res.status(400).json({ error: 'branch_id and media file are required' });
        }

        const mediaType = req.file.mimetype.startsWith('image/') ? 'image' : 'document';

        const result = await sessionManager.sendMedia(
            branch_id, phone,
            { type: mediaType, mediaPath: req.file.path, caption, filename: req.file.originalname },
            { source: 'admin_reply', sent_by: req.user.id }
        );

        if (!result) {
            return res.status(400).json({ error: 'WhatsApp session not connected for this branch' });
        }

        res.json({ success: true });
    } catch (err) {
        console.error('[WA Chat] Send media error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// MARK MESSAGES AS READ
// ========================================
router.put('/conversations/:phone/read', perm, async (req, res) => {
    try {
        const { phone } = req.params;
        const { branch_id } = req.body;

        if (!branch_id) {
            return res.status(400).json({ error: 'branch_id is required' });
        }

        await pool.query(
            `UPDATE whatsapp_messages SET is_read = 1
             WHERE branch_id = ? AND phone_number = ? AND direction = 'in' AND is_read = 0`,
            [parseInt(branch_id), phone]
        );

        await pool.query(
            `UPDATE whatsapp_contacts SET unread_count = 0
             WHERE branch_id = ? AND phone_number = ?`,
            [parseInt(branch_id), phone]
        );

        res.json({ success: true });
    } catch (err) {
        console.error('[WA Chat] Mark read error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// UPDATE CONTACT
// ========================================
router.put('/contacts/:phone', perm, async (req, res) => {
    try {
        const { phone } = req.params;
        const { branch_id, saved_name, is_pinned, is_muted } = req.body;

        if (!branch_id) {
            return res.status(400).json({ error: 'branch_id is required' });
        }

        const updates = [];
        const params = [];

        if (saved_name !== undefined) { updates.push('saved_name = ?'); params.push(saved_name); }
        if (is_pinned !== undefined) { updates.push('is_pinned = ?'); params.push(is_pinned ? 1 : 0); }
        if (is_muted !== undefined) { updates.push('is_muted = ?'); params.push(is_muted ? 1 : 0); }

        if (updates.length === 0) {
            return res.status(400).json({ error: 'No fields to update' });
        }

        params.push(parseInt(branch_id), phone);
        await pool.query(
            `UPDATE whatsapp_contacts SET ${updates.join(', ')} WHERE branch_id = ? AND phone_number = ?`,
            params
        );

        res.json({ success: true });
    } catch (err) {
        console.error('[WA Chat] Update contact error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// SEARCH MESSAGES
// ========================================
router.get('/search', perm, async (req, res) => {
    try {
        const { q, branch_id, page = 1, limit = 30 } = req.query;

        if (!q || q.length < 2) {
            return res.status(400).json({ error: 'Search query must be at least 2 characters' });
        }

        const offset = (parseInt(page) - 1) * parseInt(limit);
        const params = [`%${q}%`];
        let where = 'WHERE wm.body LIKE ?';

        if (branch_id) {
            where += ' AND wm.branch_id = ?';
            params.push(parseInt(branch_id));
        }

        const [messages] = await pool.query(`
            SELECT wm.*, wc.pushname, wc.saved_name, b.name as branch_name
            FROM whatsapp_messages wm
            LEFT JOIN whatsapp_contacts wc ON wm.branch_id = wc.branch_id AND wm.phone_number = wc.phone_number
            LEFT JOIN branches b ON wm.branch_id = b.id
            ${where}
            ORDER BY wm.timestamp DESC
            LIMIT ? OFFSET ?
        `, [...params, parseInt(limit), offset]);

        res.json({ messages, page: parseInt(page), limit: parseInt(limit) });
    } catch (err) {
        console.error('[WA Chat] Search error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// ========================================
// STATS
// ========================================
router.get('/stats', perm, async (req, res) => {
    try {
        const { branch_id } = req.query;
        const params = [];
        let branchFilter = '';

        if (branch_id) {
            branchFilter = 'AND branch_id = ?';
            params.push(parseInt(branch_id));
        }

        const [[{ total_conversations }]] = await pool.query(
            `SELECT COUNT(*) as total_conversations FROM whatsapp_contacts WHERE 1=1 ${branchFilter}`, params
        );

        const [[{ unread_count }]] = await pool.query(
            `SELECT COALESCE(SUM(unread_count), 0) as unread_count FROM whatsapp_contacts WHERE 1=1 ${branchFilter}`, params
        );

        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const [[{ messages_today }]] = await pool.query(
            `SELECT COUNT(*) as messages_today FROM whatsapp_messages WHERE timestamp >= ? ${branchFilter}`,
            [todayStart, ...params]
        );

        const [[{ incoming_today }]] = await pool.query(
            `SELECT COUNT(*) as incoming_today FROM whatsapp_messages WHERE timestamp >= ? AND direction = 'in' ${branchFilter}`,
            [todayStart, ...params]
        );

        res.json({ total_conversations, unread_count, messages_today, incoming_today });
    } catch (err) {
        console.error('[WA Chat] Stats error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = { router, setPool, setSessionManager, setIO };
