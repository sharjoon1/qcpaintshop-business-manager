/**
 * WHATSAPP SESSIONS ROUTES
 * Per-branch WhatsApp session management
 *
 * Endpoints:
 *   GET    /api/zoho/whatsapp-sessions/                   - List all branch sessions
 *   POST   /api/zoho/whatsapp-sessions/:branchId/connect  - Start connection / QR
 *   POST   /api/zoho/whatsapp-sessions/:branchId/disconnect - Disconnect branch
 *   GET    /api/zoho/whatsapp-sessions/:branchId/qr       - Get current QR string
 *   GET    /api/zoho/whatsapp-sessions/:branchId/status   - Get branch status
 *   POST   /api/zoho/whatsapp-sessions/:branchId/test     - Send test message
 */

const express = require('express');
const router = express.Router();
const { requirePermission } = require('../middleware/permissionMiddleware');

let pool;
let sessionManager;

function setPool(p) { pool = p; }
function setSessionManager(sm) { sessionManager = sm; }

const perm = requirePermission('zoho', 'whatsapp_sessions');

// ========================================
// LIST ALL SESSIONS
// ========================================

router.get('/', perm, async (req, res) => {
    try {
        // Get all branches with their session status from DB
        const [branches] = await pool.query(`
            SELECT
                b.id as branch_id,
                b.name as branch_name,
                ws.status,
                ws.phone_number,
                ws.connected_at,
                ws.disconnected_at,
                ws.last_error,
                ws.session_name,
                ws.created_at,
                u.full_name as created_by_name
            FROM branches b
            LEFT JOIN whatsapp_sessions ws ON b.id = ws.branch_id
            LEFT JOIN users u ON ws.created_by = u.id
            WHERE b.status = 'active'
            ORDER BY b.name
        `);

        // Merge live session info
        const liveStatuses = sessionManager ? sessionManager.getStatus() : [];
        const liveMap = {};
        liveStatuses.forEach(s => { liveMap[s.branch_id] = s; });

        const result = branches.map(b => ({
            ...b,
            status: liveMap[b.branch_id]?.status || b.status || 'disconnected',
            has_qr: liveMap[b.branch_id]?.has_qr || false,
            live_phone: liveMap[b.branch_id]?.phone_number || null
        }));

        // Also get General WhatsApp session (branch_id = 0)
        let general = null;
        const [generalRows] = await pool.query(`
            SELECT ws.*, u.full_name as created_by_name
            FROM whatsapp_sessions ws
            LEFT JOIN users u ON ws.created_by = u.id
            WHERE ws.branch_id = 0
        `);
        if (generalRows.length > 0) {
            const g = generalRows[0];
            const live = liveMap[0];
            general = {
                branch_id: 0,
                branch_name: 'General WhatsApp',
                status: live?.status || g.status || 'disconnected',
                phone_number: live?.phone_number || g.phone_number,
                connected_at: g.connected_at,
                disconnected_at: g.disconnected_at,
                last_error: g.last_error,
                has_qr: live?.has_qr || false,
                created_at: g.created_at,
                created_by_name: g.created_by_name
            };
        } else {
            // No DB row yet — check live status
            const live = liveMap[0];
            general = {
                branch_id: 0,
                branch_name: 'General WhatsApp',
                status: live?.status || 'disconnected',
                phone_number: live?.phone_number || null,
                has_qr: live?.has_qr || false
            };
        }

        res.json({ success: true, data: result, general });
    } catch (error) {
        console.error('[WhatsApp Sessions] List error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// CONNECT
// ========================================

router.post('/:branchId/connect', perm, async (req, res) => {
    try {
        if (!sessionManager) {
            return res.status(503).json({ success: false, message: 'WhatsApp session manager not available' });
        }

        const result = await sessionManager.connectBranch(req.params.branchId, req.user.id);
        res.json(result);
    } catch (error) {
        console.error('[WhatsApp Sessions] Connect error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// DISCONNECT
// ========================================

router.post('/:branchId/disconnect', perm, async (req, res) => {
    try {
        if (!sessionManager) {
            return res.status(503).json({ success: false, message: 'WhatsApp session manager not available' });
        }

        const result = await sessionManager.disconnectBranch(req.params.branchId);
        res.json(result);
    } catch (error) {
        console.error('[WhatsApp Sessions] Disconnect error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// GET QR CODE
// ========================================

router.get('/:branchId/qr', perm, async (req, res) => {
    try {
        if (!sessionManager) {
            return res.json({ success: true, data: { qr: null } });
        }

        const qr = sessionManager.getQRForBranch(req.params.branchId);
        res.json({ success: true, data: { qr } });
    } catch (error) {
        console.error('[WhatsApp Sessions] QR error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// GET STATUS
// ========================================

router.get('/:branchId/status', perm, async (req, res) => {
    try {
        if (!sessionManager) {
            return res.json({ success: true, data: { status: 'disconnected', phone_number: null, has_qr: false } });
        }

        const status = sessionManager.getBranchStatus(req.params.branchId);
        res.json({ success: true, data: status });
    } catch (error) {
        console.error('[WhatsApp Sessions] Status error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ========================================
// TEST MESSAGE
// ========================================

router.post('/:branchId/test', perm, async (req, res) => {
    try {
        if (!sessionManager) {
            return res.status(503).json({ success: false, message: 'WhatsApp session manager not available' });
        }

        const { phone, message } = req.body;
        if (!phone) {
            return res.status(400).json({ success: false, message: 'phone is required' });
        }

        const testMsg = message || 'Test message from QC Paint Shop WhatsApp Integration';
        const sent = await sessionManager.sendMessage(req.params.branchId, phone, testMsg);

        if (sent) {
            res.json({ success: true, message: `Test message sent to ${phone}` });
        } else {
            res.status(400).json({ success: false, message: 'Branch session is not connected' });
        }
    } catch (error) {
        console.error('[WhatsApp Sessions] Test error:', error.message);
        res.status(500).json({ success: false, message: error.message });
    }
});

module.exports = { router, setPool, setSessionManager };
