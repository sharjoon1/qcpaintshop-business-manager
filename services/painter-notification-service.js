/**
 * PAINTER NOTIFICATION SERVICE
 * Handles FCM push notifications + in-app notifications for painters
 *
 * Uses:
 *   - painter_notifications table for in-app storage
 *   - painter_fcm_tokens table for device tokens
 *   - Socket.io rooms (painter_{id}) for real-time push
 *   - Firebase Cloud Messaging (legacy HTTP API) for push notifications
 *
 * Usage:
 *   const painterNotificationService = require('./services/painter-notification-service');
 *   painterNotificationService.setDependencies(pool, io);
 *   await painterNotificationService.sendToPainter(painterId, { type, title, title_ta, body, body_ta, data });
 */

const fcmAdmin = require('./fcm-admin');

let pool, io;

function setDependencies(p, socketIO) {
    pool = p;
    io = socketIO;
}

/**
 * Send a notification to a single painter
 * - Inserts into painter_notifications
 * - Emits via Socket.io to painter_{painterId} room
 * - Sends FCM push notification (async, non-blocking)
 *
 * @param {number} painterId
 * @param {Object} opts
 * @param {string} opts.type - Notification type (e.g. 'points_earned', 'estimate_approved', 'announcement')
 * @param {string} opts.title - Title in English
 * @param {string} [opts.title_ta] - Title in Tamil
 * @param {string} opts.body - Body in English
 * @param {string} [opts.body_ta] - Body in Tamil
 * @param {Object} [opts.data] - Additional JSON data
 * @returns {Object} The created notification object
 */
async function sendToPainter(painterId, { type, title, title_ta, body, body_ta, data }) {
    try {
        // 1. Insert into painter_notifications
        const [result] = await pool.query(
            `INSERT INTO painter_notifications (painter_id, type, title, title_ta, body, body_ta, data)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                painterId,
                type,
                title,
                title_ta || null,
                body || null,
                body_ta || null,
                data ? JSON.stringify(data) : null
            ]
        );
        const notificationId = result.insertId;

        const notification = {
            id: notificationId,
            painter_id: painterId,
            type,
            title,
            title_ta: title_ta || null,
            body: body || null,
            body_ta: body_ta || null,
            data: data || null,
            is_read: 0,
            created_at: new Date()
        };

        // 2. Emit via Socket.io to painter's room
        if (io) {
            io.to(`painter_${painterId}`).emit('painter_notification', notification);
        }

        // 3. Send FCM push notification (async, don't block)
        sendFCM(painterId, { title, body, type, data }).catch(err => {
            console.error(`[PainterNotification] FCM error for painter ${painterId}:`, err.message);
        });

        return notification;
    } catch (error) {
        console.error(`[PainterNotification] Send error for painter ${painterId}:`, error.message);
        throw error;
    }
}

/**
 * Send a notification to all approved painters
 *
 * @param {Object} opts - Same as sendToPainter opts
 * @returns {Array} Array of { painterId, success, notification?, error? }
 */
async function sendToAll({ type, title, title_ta, body, body_ta, data }) {
    const results = [];

    try {
        const [painters] = await pool.query(
            `SELECT id FROM painters WHERE status = 'approved'`
        );

        for (const painter of painters) {
            try {
                const notification = await sendToPainter(painter.id, {
                    type, title, title_ta, body, body_ta, data
                });
                results.push({ painterId: painter.id, success: true, notification });
            } catch (err) {
                console.error(`[PainterNotification] Failed for painter ${painter.id}:`, err.message);
                results.push({ painterId: painter.id, success: false, error: err.message });
            }
        }
    } catch (error) {
        console.error('[PainterNotification] sendToAll error:', error.message);
        throw error;
    }

    return results;
}

/**
 * Send FCM push notification to a painter's registered devices
 * - Fetches active FCM tokens for the painter
 * - Sends to each token via Firebase Admin SDK (v1 API)
 * - Deactivates tokens that are no longer valid
 *
 * @param {number} painterId
 * @param {Object} opts
 * @param {string} opts.title
 * @param {string} opts.body
 * @param {string} opts.type
 * @param {Object} [opts.data]
 * @private
 */
async function sendFCM(painterId, { title, body, type, data }) {
    const [tokens] = await pool.query(
        `SELECT id, fcm_token FROM painter_fcm_tokens WHERE painter_id = ? AND is_active = 1`,
        [painterId]
    );

    if (!tokens.length) return;

    for (const tokenRow of tokens) {
        try {
            const result = await fcmAdmin.sendToDevice(tokenRow.fcm_token, {
                title,
                body,
                data: { type: type || 'notification', ...(data || {}) }
            });

            if (result.invalidToken) {
                await pool.query(
                    `UPDATE painter_fcm_tokens SET is_active = 0 WHERE id = ?`,
                    [tokenRow.id]
                );
                console.log(`[PainterNotification] Deactivated stale FCM token ${tokenRow.id} for painter ${painterId}`);
            }
        } catch (err) {
            console.error(`[PainterNotification] FCM send error for token ${tokenRow.id}:`, err.message);
        }
    }
}

/**
 * Get notifications for a painter with pagination
 *
 * @param {number} painterId
 * @param {Object} [opts]
 * @param {number} [opts.limit=20] - Max notifications to return
 * @param {number} [opts.offset=0] - Offset for pagination
 * @param {boolean} [opts.unreadOnly=false] - Only return unread notifications
 * @returns {Object} { notifications, unreadCount }
 */
async function getNotifications(painterId, { limit = 20, offset = 0, unreadOnly = false } = {}) {
    try {
        // Build query with optional unread filter
        let query = `SELECT * FROM painter_notifications WHERE painter_id = ?`;
        const params = [painterId];

        if (unreadOnly) {
            query += ` AND is_read = 0`;
        }

        query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
        params.push(limit, offset);

        const [notifications] = await pool.query(query, params);

        // Parse JSON data field
        for (const n of notifications) {
            if (n.data && typeof n.data === 'string') {
                try { n.data = JSON.parse(n.data); } catch (e) { /* keep as string */ }
            }
        }

        // Get unread count
        const [countResult] = await pool.query(
            `SELECT COUNT(*) as unreadCount FROM painter_notifications WHERE painter_id = ? AND is_read = 0`,
            [painterId]
        );

        return {
            notifications,
            unreadCount: countResult[0].unreadCount
        };
    } catch (error) {
        console.error(`[PainterNotification] getNotifications error for painter ${painterId}:`, error.message);
        throw error;
    }
}

/**
 * Mark notification(s) as read
 *
 * @param {number} painterId
 * @param {number|string} notificationId - Specific notification ID, or 'all' to mark all as read
 * @returns {Object} { updated: number }
 */
async function markRead(painterId, notificationId) {
    try {
        let result;

        if (notificationId === 'all') {
            [result] = await pool.query(
                `UPDATE painter_notifications SET is_read = 1 WHERE painter_id = ? AND is_read = 0`,
                [painterId]
            );
        } else {
            [result] = await pool.query(
                `UPDATE painter_notifications SET is_read = 1 WHERE id = ? AND painter_id = ?`,
                [notificationId, painterId]
            );
        }

        return { updated: result.affectedRows };
    } catch (error) {
        console.error(`[PainterNotification] markRead error for painter ${painterId}:`, error.message);
        throw error;
    }
}

// ═══════════════════════════════════════════
// RETENTION NOTIFICATION HELPERS
// ═══════════════════════════════════════════

const RETENTION_NOTIFICATIONS = {
    streak_milestone: (days, points) => ({
        type: 'streak_milestone',
        title: `${days}-day streak! ${points} bonus points added!`,
        title_ta: `${days}-நாள் தொடர்! ${points} போனஸ் புள்ளிகள் சேர்க்கப்பட்டது!`,
        body: days >= 30 ? `Incredible! You've kept a ${days}-day streak. ${points} points added to your wallet!`
            : days >= 14 ? `2 week warrior! ${points} bonus points earned!`
            : days >= 7 ? `1 week streak! You're on fire! ${points} bonus points!`
            : `${days}-day streak! Keep going! ${points} bonus points!`,
        body_ta: `${days}-நாள் தொடர்! ${points} போனஸ் புள்ளிகள் உங்கள் வாலட்டில்!`,
        data: { screen: 'dashboard', streak: String(days), points: String(points) }
    }),

    streak_at_risk: (days) => ({
        type: 'streak_at_risk',
        title: `Your ${days}-day streak is at risk!`,
        title_ta: `உங்கள் ${days}-நாள் தொடர் ஆபத்தில்!`,
        body: 'Open the app to keep it alive',
        body_ta: 'அதை காப்பாற்ற ஆப்பை திறக்கவும்',
        data: { screen: 'dashboard', streak: String(days) }
    }),

    level_up: (newLevel, multiplier) => ({
        type: 'level_up',
        title: `You've reached ${newLevel.charAt(0).toUpperCase() + newLevel.slice(1)} level!`,
        title_ta: `நீங்கள் ${newLevel} நிலையை அடைந்தீர்கள்!`,
        body: `All earnings now get ${multiplier}x multiplier!`,
        body_ta: `அனைத்து வருமானமும் ${multiplier}x பெருக்கி பெறும்!`,
        data: { screen: 'dashboard', level: newLevel, multiplier: String(multiplier) }
    }),

    daily_bonus: (productName, multiplier) => ({
        type: 'daily_bonus',
        title: `Today's bonus: ${multiplier}x points on ${productName}!`,
        title_ta: `இன்றைய போனஸ்: ${productName} மீது ${multiplier}x புள்ளிகள்!`,
        body: 'Offer ends midnight. Open app for details.',
        body_ta: 'நள்ளிரவில் முடிவடையும். விவரங்களுக்கு ஆப்பை திறக்கவும்.',
        data: { screen: 'dashboard', type: 'daily_bonus' }
    })
};

function getRetentionNotification(type, ...args) {
    const builder = RETENTION_NOTIFICATIONS[type];
    if (!builder) throw new Error(`Unknown retention notification type: ${type}`);
    return builder(...args);
}

module.exports = {
    setDependencies,
    sendToPainter,
    sendToAll,
    getNotifications,
    markRead,
    getRetentionNotification
};
