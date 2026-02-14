const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/permissionMiddleware');
const notificationService = require('../services/notification-service');

let pool;
function setPool(dbPool) { pool = dbPool; }

// ========================================
// CONVERSATIONS
// ========================================

// GET /api/chat/conversations - List user's conversations
router.get('/conversations', requireAuth, async (req, res) => {
    try {
        const [conversations] = await pool.query(`
            SELECT c.*, cp.last_read_at,
                (SELECT COUNT(*) FROM chat_messages cm
                 WHERE cm.conversation_id = c.id
                 AND cm.created_at > COALESCE(cp.last_read_at, '1970-01-01')
                 AND cm.sender_id != ?) as unread_count,
                (SELECT cm2.content FROM chat_messages cm2
                 WHERE cm2.conversation_id = c.id
                 ORDER BY cm2.created_at DESC LIMIT 1) as last_message,
                (SELECT cm3.created_at FROM chat_messages cm3
                 WHERE cm3.conversation_id = c.id
                 ORDER BY cm3.created_at DESC LIMIT 1) as last_message_at,
                (SELECT cm4.sender_id FROM chat_messages cm4
                 WHERE cm4.conversation_id = c.id
                 ORDER BY cm4.created_at DESC LIMIT 1) as last_message_sender_id
            FROM chat_conversations c
            JOIN chat_participants cp ON cp.conversation_id = c.id AND cp.user_id = ?
            ORDER BY last_message_at DESC, c.updated_at DESC
        `, [req.user.id, req.user.id]);

        // Get participants for each conversation
        for (const conv of conversations) {
            const [participants] = await pool.query(`
                SELECT cp.user_id, cp.last_read_at, u.full_name, u.username, u.role
                FROM chat_participants cp
                JOIN users u ON u.id = cp.user_id
                WHERE cp.conversation_id = ?
            `, [conv.id]);
            conv.participants = participants;

            // For direct chats, set title to the other person's name
            if (conv.type === 'direct' && !conv.title) {
                const other = participants.find(p => p.user_id !== req.user.id);
                conv.title = other ? other.full_name : 'Unknown';
            }
        }

        res.json({ success: true, data: conversations });
    } catch (error) {
        console.error('Get conversations error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/chat/conversations - Create new conversation
router.post('/conversations', requireAuth, async (req, res) => {
    try {
        const { type, title, participant_ids } = req.body;

        if (!participant_ids || !Array.isArray(participant_ids) || participant_ids.length === 0) {
            return res.status(400).json({ success: false, message: 'participant_ids required' });
        }

        // For direct chats, check if conversation already exists
        if (type === 'direct' && participant_ids.length === 1) {
            const otherUserId = participant_ids[0];
            const [existing] = await pool.query(`
                SELECT c.id FROM chat_conversations c
                JOIN chat_participants cp1 ON cp1.conversation_id = c.id AND cp1.user_id = ?
                JOIN chat_participants cp2 ON cp2.conversation_id = c.id AND cp2.user_id = ?
                WHERE c.type = 'direct'
            `, [req.user.id, otherUserId]);

            if (existing.length > 0) {
                return res.json({ success: true, data: { id: existing[0].id, existing: true } });
            }
        }

        // Create conversation
        const [result] = await pool.query(
            `INSERT INTO chat_conversations (type, title, created_by) VALUES (?, ?, ?)`,
            [type || 'direct', title || null, req.user.id]
        );
        const conversationId = result.insertId;

        // Add creator as participant
        const allParticipants = [req.user.id, ...participant_ids.filter(id => id !== req.user.id)];
        for (const uid of allParticipants) {
            await pool.query(
                `INSERT INTO chat_participants (conversation_id, user_id) VALUES (?, ?)`,
                [conversationId, uid]
            );
        }

        res.json({ success: true, data: { id: conversationId } });
    } catch (error) {
        console.error('Create conversation error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// MESSAGES
// ========================================

// GET /api/chat/conversations/:id/messages
router.get('/conversations/:id/messages', requireAuth, async (req, res) => {
    try {
        const conversationId = req.params.id;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 50;
        const offset = (page - 1) * limit;

        // Verify user is participant
        const [membership] = await pool.query(
            'SELECT id FROM chat_participants WHERE conversation_id = ? AND user_id = ?',
            [conversationId, req.user.id]
        );
        if (membership.length === 0) {
            return res.status(403).json({ success: false, message: 'Not a participant' });
        }

        const [messages] = await pool.query(`
            SELECT m.*, u.full_name as sender_name, u.username as sender_username
            FROM chat_messages m
            JOIN users u ON u.id = m.sender_id
            WHERE m.conversation_id = ?
            ORDER BY m.created_at DESC
            LIMIT ? OFFSET ?
        `, [conversationId, limit, offset]);

        // Get read receipts for these messages
        if (messages.length > 0) {
            const messageIds = messages.map(m => m.id);
            const [receipts] = await pool.query(
                `SELECT rr.message_id, rr.user_id, rr.read_at, u.full_name
                 FROM chat_read_receipts rr
                 JOIN users u ON u.id = rr.user_id
                 WHERE rr.message_id IN (?)`,
                [messageIds]
            );

            const receiptMap = {};
            receipts.forEach(r => {
                if (!receiptMap[r.message_id]) receiptMap[r.message_id] = [];
                receiptMap[r.message_id].push(r);
            });

            messages.forEach(m => {
                m.read_by = receiptMap[m.id] || [];
            });
        }

        res.json({ success: true, data: messages.reverse() });
    } catch (error) {
        console.error('Get messages error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/chat/conversations/:id/messages - Send message
router.post('/conversations/:id/messages', requireAuth, async (req, res) => {
    try {
        const conversationId = req.params.id;
        const { content, message_type, file_url, file_name } = req.body;

        if (!content && !file_url) {
            return res.status(400).json({ success: false, message: 'content or file_url required' });
        }

        // Verify user is participant
        const [membership] = await pool.query(
            'SELECT id FROM chat_participants WHERE conversation_id = ? AND user_id = ?',
            [conversationId, req.user.id]
        );
        if (membership.length === 0) {
            return res.status(403).json({ success: false, message: 'Not a participant' });
        }

        // Insert message
        const [result] = await pool.query(
            `INSERT INTO chat_messages (conversation_id, sender_id, message_type, content, file_url, file_name) VALUES (?, ?, ?, ?, ?, ?)`,
            [conversationId, req.user.id, message_type || 'text', content || '', file_url || null, file_name || null]
        );

        // Update conversation timestamp
        await pool.query('UPDATE chat_conversations SET updated_at = NOW() WHERE id = ?', [conversationId]);

        // Auto-read own message
        await pool.query(
            'UPDATE chat_participants SET last_read_at = NOW() WHERE conversation_id = ? AND user_id = ?',
            [conversationId, req.user.id]
        );
        await pool.query(
            'INSERT INTO chat_read_receipts (message_id, user_id) VALUES (?, ?)',
            [result.insertId, req.user.id]
        );

        const message = {
            id: result.insertId,
            conversation_id: parseInt(conversationId),
            sender_id: req.user.id,
            sender_name: req.user.full_name,
            message_type: message_type || 'text',
            content: content || '',
            file_url: file_url || null,
            file_name: file_name || null,
            created_at: new Date(),
            read_by: [{ user_id: req.user.id, full_name: req.user.full_name }]
        };

        // Emit via Socket.io
        const io = req.app.get('io');
        if (io) {
            io.to(`conversation_${conversationId}`).emit('new_message', message);
        }

        // Send notifications to other participants
        const [participants] = await pool.query(
            'SELECT user_id FROM chat_participants WHERE conversation_id = ? AND user_id != ?',
            [conversationId, req.user.id]
        );

        for (const p of participants) {
            await notificationService.send(p.user_id, {
                type: 'chat_message',
                title: `Message from ${req.user.full_name}`,
                body: content ? (content.length > 100 ? content.substring(0, 100) + '...' : content) : 'Sent a file',
                data: { conversation_id: parseInt(conversationId), message_id: result.insertId }
            });
        }

        res.json({ success: true, data: message });
    } catch (error) {
        console.error('Send message error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// POST /api/chat/conversations/:id/read - Mark conversation as read
router.post('/conversations/:id/read', requireAuth, async (req, res) => {
    try {
        const conversationId = req.params.id;

        // Update last_read_at
        await pool.query(
            'UPDATE chat_participants SET last_read_at = NOW() WHERE conversation_id = ? AND user_id = ?',
            [conversationId, req.user.id]
        );

        // Insert read receipts for all unread messages
        await pool.query(`
            INSERT IGNORE INTO chat_read_receipts (message_id, user_id)
            SELECT m.id, ?
            FROM chat_messages m
            WHERE m.conversation_id = ?
            AND m.id NOT IN (SELECT rr.message_id FROM chat_read_receipts rr WHERE rr.user_id = ?)
        `, [req.user.id, conversationId, req.user.id]);

        // Emit read receipt via Socket.io
        const io = req.app.get('io');
        if (io) {
            io.to(`conversation_${conversationId}`).emit('message_read', {
                conversation_id: parseInt(conversationId),
                user_id: req.user.id,
                user_name: req.user.full_name,
                read_at: new Date()
            });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Mark read error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// GET /api/chat/users - List users available for chat
router.get('/users', requireAuth, async (req, res) => {
    try {
        const [users] = await pool.query(
            `SELECT id, username, full_name, role, email FROM users WHERE status = 'active' AND id != ? ORDER BY full_name`,
            [req.user.id]
        );
        res.json({ success: true, data: users });
    } catch (error) {
        console.error('Get chat users error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = { router, setPool };
