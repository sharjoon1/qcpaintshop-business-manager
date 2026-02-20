/**
 * WHATSAPP SESSION MANAGER
 * Manages per-branch WhatsApp sessions using whatsapp-web.js
 *
 * Each branch can connect its own WhatsApp number by scanning a QR code.
 * Messages are routed to the correct branch session automatically.
 *
 * Usage:
 *   const wsm = require('./services/whatsapp-session-manager');
 *   wsm.setPool(pool);
 *   wsm.setIO(io);
 *   wsm.initializeSessions();
 */

const path = require('path');

// whatsapp-web.js is an optional dependency — server runs without it
let Client, LocalAuth;
try {
    const wwjs = require('whatsapp-web.js');
    Client = wwjs.Client;
    LocalAuth = wwjs.LocalAuth;
} catch (e) {
    console.warn('[WhatsApp Sessions] whatsapp-web.js not installed — session management disabled. Run: npm install whatsapp-web.js qrcode');
}

let pool;
let io;

// Map of branch_id → { client, status, qr, phoneNumber }
const sessions = new Map();

function setPool(p) { pool = p; }
function setIO(socketIO) { io = socketIO; }

// ========================================
// SESSION LIFECYCLE
// ========================================

/**
 * Connect a branch's WhatsApp session
 */
async function connectBranch(branchId, userId) {
    branchId = parseInt(branchId);

    if (!Client || !LocalAuth) {
        return { success: false, message: 'whatsapp-web.js not installed. Run: npm install whatsapp-web.js' };
    }

    // Already connected or connecting?
    const existing = sessions.get(branchId);
    if (existing && (existing.status === 'connected' || existing.status === 'connecting' || existing.status === 'qr_pending')) {
        return { success: false, message: `Session already ${existing.status}` };
    }

    // Update DB status
    await upsertSession(branchId, { status: 'connecting', created_by: userId, last_error: null });

    const sessionEntry = { client: null, status: 'connecting', qr: null, phoneNumber: null };
    sessions.set(branchId, sessionEntry);

    try {
        const client = new Client({
            authStrategy: new LocalAuth({
                clientId: `branch_${branchId}`,
                dataPath: path.join(process.cwd(), 'whatsapp-sessions')
            }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--single-process',
                    '--no-zygote'
                ]
            }
        });

        sessionEntry.client = client;

        // QR Code event
        client.on('qr', async (qr) => {
            console.log(`[WhatsApp Sessions] QR received for branch ${branchId}`);
            sessionEntry.qr = qr;
            sessionEntry.status = 'qr_pending';

            await upsertSession(branchId, { status: 'qr_pending' });

            // Emit to admin room via Socket.io
            if (io) {
                io.to('whatsapp_admin').emit('whatsapp_qr', {
                    branch_id: branchId,
                    qr: qr
                });
            }
        });

        // Ready event
        client.on('ready', async () => {
            const info = client.info;
            const phoneNumber = info?.wid?.user || '';
            console.log(`[WhatsApp Sessions] Branch ${branchId} connected: ${phoneNumber}`);

            sessionEntry.status = 'connected';
            sessionEntry.qr = null;
            sessionEntry.phoneNumber = phoneNumber;

            await upsertSession(branchId, {
                status: 'connected',
                phone_number: phoneNumber,
                connected_at: new Date(),
                last_error: null
            });

            if (io) {
                io.to('whatsapp_admin').emit('whatsapp_status', {
                    branch_id: branchId,
                    status: 'connected',
                    phone_number: phoneNumber
                });
            }
        });

        // Authenticated (session restored)
        client.on('authenticated', () => {
            console.log(`[WhatsApp Sessions] Branch ${branchId} authenticated`);
            sessionEntry.status = 'connecting';
        });

        // Auth failure
        client.on('auth_failure', async (msg) => {
            console.error(`[WhatsApp Sessions] Branch ${branchId} auth failure:`, msg);
            sessionEntry.status = 'failed';
            sessionEntry.qr = null;

            await upsertSession(branchId, { status: 'failed', last_error: String(msg) });

            if (io) {
                io.to('whatsapp_admin').emit('whatsapp_status', {
                    branch_id: branchId,
                    status: 'failed',
                    error: String(msg)
                });
            }
        });

        // Disconnected
        client.on('disconnected', async (reason) => {
            console.log(`[WhatsApp Sessions] Branch ${branchId} disconnected:`, reason);
            sessionEntry.status = 'disconnected';
            sessionEntry.qr = null;
            sessionEntry.phoneNumber = null;

            await upsertSession(branchId, {
                status: 'disconnected',
                disconnected_at: new Date(),
                last_error: String(reason)
            });

            if (io) {
                io.to('whatsapp_admin').emit('whatsapp_status', {
                    branch_id: branchId,
                    status: 'disconnected',
                    reason: String(reason)
                });
            }

            // Cleanup
            try { client.destroy(); } catch (e) {}
            sessions.delete(branchId);
        });

        // Initialize
        await client.initialize();

        return { success: true, message: 'Connecting... QR code will appear shortly.' };
    } catch (error) {
        console.error(`[WhatsApp Sessions] Failed to connect branch ${branchId}:`, error.message);
        sessionEntry.status = 'failed';
        await upsertSession(branchId, { status: 'failed', last_error: error.message });

        if (io) {
            io.to('whatsapp_admin').emit('whatsapp_status', {
                branch_id: branchId,
                status: 'failed',
                error: error.message
            });
        }

        return { success: false, message: error.message };
    }
}

/**
 * Disconnect a branch's WhatsApp session
 */
async function disconnectBranch(branchId) {
    branchId = parseInt(branchId);
    const session = sessions.get(branchId);

    if (!session || !session.client) {
        sessions.delete(branchId);
        await upsertSession(branchId, { status: 'disconnected', disconnected_at: new Date() });
        return { success: true, message: 'Session cleared' };
    }

    try {
        await session.client.logout();
    } catch (e) {
        console.log(`[WhatsApp Sessions] Logout error for branch ${branchId}:`, e.message);
    }

    try {
        await session.client.destroy();
    } catch (e) {
        console.log(`[WhatsApp Sessions] Destroy error for branch ${branchId}:`, e.message);
    }

    sessions.delete(branchId);
    await upsertSession(branchId, { status: 'disconnected', disconnected_at: new Date() });

    if (io) {
        io.to('whatsapp_admin').emit('whatsapp_status', {
            branch_id: branchId,
            status: 'disconnected'
        });
    }

    return { success: true, message: 'Disconnected' };
}

// ========================================
// MESSAGING
// ========================================

/**
 * Send a message via branch's WhatsApp session
 * @returns {boolean} true if sent successfully, false if no session available
 */
async function sendMessage(branchId, phone, message) {
    branchId = parseInt(branchId);
    const session = sessions.get(branchId);

    if (!session || session.status !== 'connected' || !session.client) {
        return false;
    }

    // Normalize phone: ensure 91XXXXXXXXXX@c.us format
    let normalized = phone.replace(/[^0-9+]/g, '');
    if (normalized.startsWith('+')) normalized = normalized.substring(1);
    if (!normalized.startsWith('91') && normalized.length === 10) {
        normalized = '91' + normalized;
    }
    const chatId = normalized + '@c.us';

    await session.client.sendMessage(chatId, message);
    return true;
}

// ========================================
// STATUS / INIT
// ========================================

/**
 * Get status of all branch sessions
 */
function getStatus() {
    const result = [];
    for (const [branchId, session] of sessions) {
        result.push({
            branch_id: branchId,
            status: session.status,
            phone_number: session.phoneNumber,
            has_qr: !!session.qr
        });
    }
    return result;
}

/**
 * Get QR code for a specific branch
 */
function getQRForBranch(branchId) {
    const session = sessions.get(parseInt(branchId));
    return session?.qr || null;
}

/**
 * Get session status for a specific branch
 */
function getBranchStatus(branchId) {
    const session = sessions.get(parseInt(branchId));
    if (!session) return { status: 'disconnected', phone_number: null, has_qr: false };
    return {
        status: session.status,
        phone_number: session.phoneNumber,
        has_qr: !!session.qr
    };
}

/**
 * Check if a branch has a connected session
 */
function isConnected(branchId) {
    const session = sessions.get(parseInt(branchId));
    return session?.status === 'connected';
}

/**
 * Initialize previously connected sessions on startup
 */
async function initializeSessions() {
    if (!pool) {
        console.log('[WhatsApp Sessions] No pool available, skipping initialization');
        return;
    }

    try {
        const [rows] = await pool.query(
            `SELECT ws.branch_id, ws.created_by, b.name as branch_name
             FROM whatsapp_sessions ws
             JOIN branches b ON ws.branch_id = b.id
             WHERE ws.status = 'connected'`
        );

        if (rows.length === 0) {
            console.log('[WhatsApp Sessions] No previously connected sessions to restore');
            return;
        }

        console.log(`[WhatsApp Sessions] Restoring ${rows.length} session(s)...`);

        for (let i = 0; i < rows.length; i++) {
            const row = rows[i];
            console.log(`[WhatsApp Sessions] Restoring ${row.branch_name} (branch ${row.branch_id})...`);

            // Stagger reconnections by 3 seconds each
            if (i > 0) {
                await new Promise(resolve => setTimeout(resolve, 3000));
            }

            connectBranch(row.branch_id, row.created_by).catch(err => {
                console.error(`[WhatsApp Sessions] Failed to restore branch ${row.branch_id}:`, err.message);
            });
        }
    } catch (error) {
        console.error('[WhatsApp Sessions] Initialization error:', error.message);
    }
}

// ========================================
// DB HELPERS
// ========================================

async function upsertSession(branchId, data) {
    if (!pool) return;

    try {
        // Check if session row exists
        const [existing] = await pool.query(
            'SELECT id FROM whatsapp_sessions WHERE branch_id = ?',
            [branchId]
        );

        if (existing.length > 0) {
            const updates = [];
            const params = [];
            for (const [key, val] of Object.entries(data)) {
                if (key === 'created_by') continue; // Don't update creator
                updates.push(`${key} = ?`);
                params.push(val);
            }
            if (updates.length > 0) {
                params.push(branchId);
                await pool.query(
                    `UPDATE whatsapp_sessions SET ${updates.join(', ')} WHERE branch_id = ?`,
                    params
                );
            }
        } else {
            await pool.query(
                `INSERT INTO whatsapp_sessions (branch_id, status, phone_number, connected_at, disconnected_at, last_error, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    branchId,
                    data.status || 'disconnected',
                    data.phone_number || null,
                    data.connected_at || null,
                    data.disconnected_at || null,
                    data.last_error || null,
                    data.created_by || null
                ]
            );
        }
    } catch (error) {
        console.error(`[WhatsApp Sessions] DB upsert error for branch ${branchId}:`, error.message);
    }
}

module.exports = {
    setPool,
    setIO,
    connectBranch,
    disconnectBranch,
    sendMessage,
    getStatus,
    getQRForBranch,
    getBranchStatus,
    isConnected,
    initializeSessions
};
