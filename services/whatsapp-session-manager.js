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
const fs = require('fs');

// whatsapp-web.js is an optional dependency — server runs without it
let Client, LocalAuth, MessageMedia;
try {
    const wwjs = require('whatsapp-web.js');
    Client = wwjs.Client;
    LocalAuth = wwjs.LocalAuth;
    MessageMedia = wwjs.MessageMedia;
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

        // Incoming message listener
        client.on('message', async (msg) => {
            try {
                // Skip group messages and status broadcasts
                if (msg.from.endsWith('@g.us') || msg.from === 'status@broadcast') return;

                const phone = msg.from.replace('@c.us', '');
                const contact = await msg.getContact();
                const pushname = contact?.pushname || contact?.name || '';

                // Determine message type
                let messageType = 'text';
                let mediaUrl = null;
                let mediaMime = null;
                let mediaFilename = null;
                let caption = null;

                if (msg.hasMedia) {
                    const media = await msg.downloadMedia();
                    if (media) {
                        // Determine type from mimetype
                        if (media.mimetype?.startsWith('image/')) messageType = 'image';
                        else if (media.mimetype?.startsWith('video/')) messageType = 'video';
                        else if (media.mimetype?.startsWith('audio/')) messageType = 'audio';
                        else messageType = 'document';

                        mediaMime = media.mimetype;
                        mediaFilename = media.filename || `${Date.now()}.${getExtFromMime(media.mimetype)}`;

                        // Save to uploads/whatsapp/
                        const uploadsDir = path.join(process.cwd(), 'uploads', 'whatsapp');
                        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
                        const safeName = `${Date.now()}-${Math.random().toString(36).substring(2, 8)}-${mediaFilename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
                        const filePath = path.join(uploadsDir, safeName);
                        fs.writeFileSync(filePath, Buffer.from(media.data, 'base64'));
                        mediaUrl = `/uploads/whatsapp/${safeName}`;
                    }
                } else if (msg.type === 'sticker') {
                    messageType = 'sticker';
                } else if (msg.type === 'location') {
                    messageType = 'location';
                } else if (msg.type === 'vcard' || msg.type === 'multi_vcard') {
                    messageType = 'contact';
                }

                if (msg.hasMedia && msg.body) {
                    caption = msg.body;
                }

                const now = new Date();

                // INSERT into whatsapp_messages
                if (pool) {
                    await pool.query(`
                        INSERT INTO whatsapp_messages (branch_id, phone_number, direction, message_type, body, media_url, media_mime_type, media_filename, caption, whatsapp_msg_id, status, sender_name, is_group, quoted_msg_id, timestamp, is_read, source)
                        VALUES (?, ?, 'in', ?, ?, ?, ?, ?, ?, ?, 'delivered', ?, 0, ?, ?, 0, 'incoming')
                    `, [
                        branchId, phone, messageType,
                        messageType === 'text' ? msg.body : null,
                        mediaUrl, mediaMime, mediaFilename, caption,
                        msg.id?._serialized || null,
                        pushname,
                        msg.hasQuotedMsg ? (await msg.getQuotedMessage())?.id?._serialized || null : null,
                        now
                    ]);

                    // UPSERT whatsapp_contacts
                    await pool.query(`
                        INSERT INTO whatsapp_contacts (branch_id, phone_number, pushname, last_message_at, unread_count)
                        VALUES (?, ?, ?, ?, 1)
                        ON DUPLICATE KEY UPDATE
                            pushname = COALESCE(VALUES(pushname), pushname),
                            last_message_at = VALUES(last_message_at),
                            unread_count = unread_count + 1
                    `, [branchId, phone, pushname, now]);
                }

                // Emit to Socket.io
                if (io) {
                    io.to('whatsapp_chat_admin').emit('whatsapp_message_incoming', {
                        branch_id: branchId,
                        phone_number: phone,
                        direction: 'in',
                        message_type: messageType,
                        body: messageType === 'text' ? msg.body : null,
                        media_url: mediaUrl,
                        media_mime_type: mediaMime,
                        media_filename: mediaFilename,
                        caption,
                        sender_name: pushname,
                        timestamp: now.toISOString(),
                        whatsapp_msg_id: msg.id?._serialized || null
                    });
                }

                console.log(`[WhatsApp Chat] Incoming from ${phone} (branch ${branchId}): ${messageType}`);
            } catch (err) {
                console.error(`[WhatsApp Chat] Error handling incoming message:`, err.message);
            }
        });

        // Message acknowledgement (delivery/read receipts)
        client.on('message_ack', async (msg, ack) => {
            try {
                if (!msg.id?._serialized || !pool) return;
                // ack: 0=pending, 1=sent(server), 2=delivered, 3=read, 4=played
                let status = null;
                if (ack === 1) status = 'sent';
                else if (ack === 2) status = 'delivered';
                else if (ack >= 3) status = 'read';
                if (!status) return;

                await pool.query(
                    `UPDATE whatsapp_messages SET status = ? WHERE whatsapp_msg_id = ?`,
                    [status, msg.id._serialized]
                );

                if (io) {
                    io.to('whatsapp_chat_admin').emit('whatsapp_message_status', {
                        whatsapp_msg_id: msg.id._serialized,
                        status,
                        branch_id: branchId
                    });
                }
            } catch (err) {
                console.error(`[WhatsApp Chat] Error handling message_ack:`, err.message);
            }
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
 * @param {object} [metadata] - Optional { source, sent_by } for chat recording
 * @returns {boolean} true if sent successfully, false if no session available
 */
async function sendMessage(branchId, phone, message, metadata = {}) {
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

    const sentMsg = await session.client.sendMessage(chatId, message);

    // Record outbound message
    await recordOutbound(branchId, normalized, {
        message_type: 'text',
        body: message,
        whatsapp_msg_id: sentMsg?.id?._serialized || null,
        source: metadata.source || 'system',
        sent_by: metadata.sent_by || null
    });

    return sentMsg || true;
}

/**
 * Send a media message via branch's WhatsApp session
 * @param {number} branchId
 * @param {string} phone
 * @param {object} options - { type: 'image'|'document', mediaPath, caption, filename }
 * @param {object} [metadata] - Optional { source, sent_by } for chat recording
 * @returns {boolean} true if sent successfully
 */
async function sendMedia(branchId, phone, options = {}, metadata = {}) {
    branchId = parseInt(branchId);
    const session = sessions.get(branchId);

    if (!session || session.status !== 'connected' || !session.client) {
        return false;
    }

    if (!MessageMedia) {
        console.error('[WhatsApp Sessions] MessageMedia not available');
        return false;
    }

    // Normalize phone: ensure 91XXXXXXXXXX@c.us format
    let normalized = phone.replace(/[^0-9+]/g, '');
    if (normalized.startsWith('+')) normalized = normalized.substring(1);
    if (!normalized.startsWith('91') && normalized.length === 10) {
        normalized = '91' + normalized;
    }
    const chatId = normalized + '@c.us';

    const media = MessageMedia.fromFilePath(options.mediaPath);
    if (options.filename) media.filename = options.filename;

    const sendOptions = {};
    if (options.caption) sendOptions.caption = options.caption;
    if (options.type === 'document') sendOptions.sendMediaAsDocument = true;

    const sentMsg = await session.client.sendMessage(chatId, media, sendOptions);

    // Record outbound media message
    const msgType = options.type === 'document' ? 'document' : 'image';
    await recordOutbound(branchId, normalized, {
        message_type: msgType,
        body: null,
        caption: options.caption || null,
        media_url: options.mediaPath ? `/uploads/whatsapp/${path.basename(options.mediaPath)}` : null,
        media_filename: options.filename || null,
        whatsapp_msg_id: sentMsg?.id?._serialized || null,
        source: metadata.source || 'system',
        sent_by: metadata.sent_by || null
    });

    return sentMsg || true;
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

// ========================================
// CHAT RECORDING HELPERS
// ========================================

/**
 * Record an outbound message into whatsapp_messages + update contact
 */
async function recordOutbound(branchId, phone, data) {
    if (!pool) return;
    try {
        const now = new Date();
        await pool.query(`
            INSERT INTO whatsapp_messages (branch_id, phone_number, direction, message_type, body, media_url, media_filename, caption, whatsapp_msg_id, status, timestamp, is_read, sent_by, source)
            VALUES (?, ?, 'out', ?, ?, ?, ?, ?, ?, 'sent', ?, 1, ?, ?)
        `, [
            branchId, phone, data.message_type || 'text',
            data.body || null, data.media_url || null, data.media_filename || null,
            data.caption || null, data.whatsapp_msg_id || null,
            now, data.sent_by || null, data.source || 'system'
        ]);

        await pool.query(`
            INSERT INTO whatsapp_contacts (branch_id, phone_number, last_message_at)
            VALUES (?, ?, ?)
            ON DUPLICATE KEY UPDATE last_message_at = VALUES(last_message_at)
        `, [branchId, phone, now]);

        // Emit to Socket.io
        if (io) {
            io.to('whatsapp_chat_admin').emit('whatsapp_message_sent', {
                branch_id: branchId,
                phone_number: phone,
                direction: 'out',
                message_type: data.message_type || 'text',
                body: data.body || null,
                media_url: data.media_url || null,
                caption: data.caption || null,
                timestamp: now.toISOString(),
                whatsapp_msg_id: data.whatsapp_msg_id || null,
                source: data.source || 'system'
            });
        }
    } catch (err) {
        console.error('[WhatsApp Chat] Error recording outbound:', err.message);
    }
}

function getExtFromMime(mimetype) {
    if (!mimetype) return 'bin';
    const map = {
        'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp',
        'video/mp4': 'mp4', 'video/3gpp': '3gp',
        'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a',
        'application/pdf': 'pdf',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx'
    };
    return map[mimetype] || mimetype.split('/')[1] || 'bin';
}

/**
 * Get the raw client instance for a branch (for typing indicators etc.)
 */
function getClient(branchId) {
    const session = sessions.get(parseInt(branchId));
    return session?.client || null;
}

module.exports = {
    setPool,
    setIO,
    connectBranch,
    disconnectBranch,
    sendMessage,
    sendMedia,
    getStatus,
    getQRForBranch,
    getBranchStatus,
    isConnected,
    initializeSessions,
    getClient
};
