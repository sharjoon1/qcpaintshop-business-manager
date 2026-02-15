/**
 * NOTIFICATION SERVICE
 * Handles in-app notifications, Socket.io real-time push, Web Push, and FCM
 *
 * Usage:
 *   const notificationService = require('./services/notification-service');
 *   notificationService.setPool(pool);
 *   notificationService.setIO(io);
 *   await notificationService.send(userId, { type: 'chat_message', title: 'New message', body: 'Hello', data: {} });
 */

const webPush = require('web-push');
const https = require('https');

let pool;
let io;

function setPool(dbPool) { pool = dbPool; }
function setIO(socketIO) { io = socketIO; }

// Configure Web Push if VAPID keys are set
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    webPush.setVapidDetails(
        `mailto:${process.env.VAPID_EMAIL || 'info@qcpaintshop.com'}`,
        process.env.VAPID_PUBLIC_KEY,
        process.env.VAPID_PRIVATE_KEY
    );
}

/**
 * Send notification to a user
 * @param {number} userId
 * @param {Object} opts - { type, title, body, data }
 */
async function send(userId, { type, title, body, data }) {
    try {
        // 1. Insert into DB
        const [result] = await pool.query(
            `INSERT INTO notifications (user_id, type, title, body, data) VALUES (?, ?, ?, ?, ?)`,
            [userId, type, title, body || null, data ? JSON.stringify(data) : null]
        );
        const notificationId = result.insertId;

        const notification = { id: notificationId, user_id: userId, type, title, body, data, is_read: 0, created_at: new Date() };

        // 2. Emit via Socket.io
        if (io) {
            io.to(`user_${userId}`).emit('notification', notification);
        }

        // 3. Send push notifications (async, don't block)
        sendPushNotifications(userId, { type, title, body, data }).catch(err => {
            console.error(`Push notification error for user ${userId}:`, err.message);
        });

        return notification;
    } catch (error) {
        console.error('Notification send error:', error);
        throw error;
    }
}

/**
 * Send to multiple users
 */
async function sendToMany(userIds, opts) {
    const results = [];
    for (const userId of userIds) {
        try {
            const r = await send(userId, opts);
            results.push(r);
        } catch (err) {
            console.error(`Failed to notify user ${userId}:`, err.message);
        }
    }
    return results;
}

/**
 * Send push notifications (Web Push + FCM)
 */
async function sendPushNotifications(userId, { type, title, body, data }) {
    const [subscriptions] = await pool.query(
        'SELECT * FROM push_subscriptions WHERE user_id = ?',
        [userId]
    );

    for (const sub of subscriptions) {
        try {
            if (sub.type === 'web' && sub.endpoint) {
                await sendWebPush(sub, { type, title, body, data });
            } else if (sub.type === 'fcm' && sub.fcm_token) {
                await sendFCM(sub.fcm_token, { type, title, body, data });
            }
        } catch (err) {
            // Remove invalid subscriptions
            if (err.statusCode === 410 || err.statusCode === 404) {
                await pool.query('DELETE FROM push_subscriptions WHERE id = ?', [sub.id]);
                console.log(`Removed stale push subscription ${sub.id}`);
            }
        }
    }
}

/**
 * Send Web Push notification
 */
async function sendWebPush(subscription, { title, body, data }) {
    if (!process.env.VAPID_PUBLIC_KEY) return;

    const pushSubscription = {
        endpoint: subscription.endpoint,
        keys: {
            p256dh: subscription.p256dh,
            auth: subscription.auth_key
        }
    };

    const payload = JSON.stringify({
        title,
        body,
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-72x72.png',
        data
    });

    await webPush.sendNotification(pushSubscription, payload, { TTL: 86400 });
}

/**
 * Send FCM notification via HTTP v1 API
 */
async function sendFCM(fcmToken, { title, body, data }) {
    const serverKey = process.env.FIREBASE_SERVER_KEY;
    if (!serverKey) return;

    const payload = JSON.stringify({
        to: fcmToken,
        data: { title, body, ...(data || {}), type: data?.type || 'notification' }
    });

    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: 'fcm.googleapis.com',
            path: '/fcm/send',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `key=${serverKey}`,
                'Content-Length': Buffer.byteLength(payload)
            }
        }, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(JSON.parse(body));
                } else {
                    const err = new Error(`FCM error: ${res.statusCode}`);
                    err.statusCode = res.statusCode;
                    reject(err);
                }
            });
        });
        req.on('error', reject);
        req.write(payload);
        req.end();
    });
}

module.exports = { setPool, setIO, send, sendToMany };
