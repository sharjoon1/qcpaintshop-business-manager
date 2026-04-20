/**
 * FCM ADMIN MODULE
 * Shared Firebase Admin SDK wrapper for sending push notifications via FCM HTTP v1 API
 *
 * Replaces the legacy FCM HTTP API (fcm.googleapis.com/fcm/send) which was
 * shut down by Google in June 2025.
 *
 * Usage:
 *   const fcmAdmin = require('./services/fcm-admin');
 *   const result = await fcmAdmin.sendToDevice(token, { title, body, data });
 *   if (result.invalidToken) { // remove stale token }
 */

const admin = require('firebase-admin');
const path = require('path');

let initialized = false;

// Self-initialize on require
(function init() {
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;

    if (!serviceAccountPath) {
        console.warn('[FCM Admin] FIREBASE_SERVICE_ACCOUNT_PATH not set — FCM push notifications disabled');
        return;
    }

    try {
        const resolvedPath = path.resolve(serviceAccountPath);
        const serviceAccount = require(resolvedPath);

        admin.initializeApp({
            credential: admin.credential.cert(serviceAccount)
        });

        initialized = true;
        console.log(`[FCM Admin] Firebase Admin SDK initialized (project: ${serviceAccount.project_id})`);
    } catch (err) {
        console.error(`[FCM Admin] Failed to initialize: ${err.message}`);
    }
})();

/**
 * Send a push notification to a single device via FCM v1 API
 *
 * @param {string} fcmToken - Device FCM registration token
 * @param {Object} opts
 * @param {string} opts.title - Notification title
 * @param {string} opts.body - Notification body
 * @param {Object} [opts.data] - Custom data payload (all values must be strings)
 * @param {number} [opts.ttlSeconds] - Time-to-live in seconds (0 = immediate delivery only, omit = no expiry)
 * @returns {Promise<{ success: boolean, messageId?: string, invalidToken?: boolean }>}
 */
async function sendToDevice(fcmToken, { title, body, data, ttlSeconds }) {
    if (!initialized) return { success: false };

    // FCM data values must all be strings
    const stringData = {};
    if (data) {
        for (const [key, value] of Object.entries(data)) {
            stringData[key] = typeof value === 'string' ? value : JSON.stringify(value);
        }
    }

    const message = {
        token: fcmToken,
        notification: { title, body },
        data: stringData,
        android: {
            priority: 'high',
            ...(ttlSeconds !== undefined ? { ttl: ttlSeconds * 1000 } : {}),
            notification: {
                channelId: 'qc_notifications',
                sound: 'default',
                defaultSound: true,
                defaultVibrateTimings: true,
                notificationPriority: 'PRIORITY_HIGH'
            }
        }
    };

    try {
        const messageId = await admin.messaging().send(message);
        console.log(`[FCM Admin] Sent to ${fcmToken.substring(0, 12)}... → ${messageId}`);
        return { success: true, messageId };
    } catch (err) {
        const code = err.code || '';
        // Token is invalid or unregistered — caller should remove it
        if (
            code === 'messaging/registration-token-not-registered' ||
            code === 'messaging/invalid-registration-token' ||
            code === 'messaging/invalid-argument'
        ) {
            console.log(`[FCM Admin] Invalid token ${fcmToken.substring(0, 12)}... (${code})`);
            return { success: false, invalidToken: true };
        }

        console.error(`[FCM Admin] Send error: ${err.message} (${code})`);
        return { success: false, error: err.message };
    }
}

/**
 * Send a push notification to multiple devices (batch, up to 500 tokens per call)
 * Uses FCM sendEachForMulticast for efficient batching.
 *
 * @param {string[]} tokens - Array of FCM tokens (max 500 per call)
 * @param {Object} opts
 * @param {string} opts.title
 * @param {string} opts.body
 * @param {string} [opts.imageUrl] - Publicly accessible HTTPS image URL (FCM big picture)
 * @param {string} [opts.type] - 'info' | 'offer'
 * @param {string} [opts.offerUrl] - URL to open when offer is tapped
 * @returns {Promise<{ successCount: number, failureCount: number, invalidTokens: string[] }>}
 */
async function sendToDevices(tokens, { title, body, imageUrl, type, offerUrl }) {
    if (!initialized || !tokens || tokens.length === 0) {
        return { successCount: 0, failureCount: 0, invalidTokens: [] };
    }

    if (tokens.length > 500) {
        console.error(`[FCM Admin] sendToDevices called with ${tokens.length} tokens — FCM cap is 500. Use batches of 500.`);
        return { successCount: 0, failureCount: tokens.length, invalidTokens: [], error: 'Token batch exceeds FCM limit of 500' };
    }

    const data = {
        type: type || 'info',
        offerUrl: offerUrl || '',
    };

    const message = {
        tokens,
        notification: {
            title,
            body,
            ...(imageUrl ? { imageUrl } : {}),
        },
        android: {
            priority: 'high',
            notification: {
                channelId: 'qc_admin_channel',
                sound: 'app_notification',
                notificationPriority: 'PRIORITY_HIGH',
                defaultVibrateTimings: true,
            },
        },
        data,
    };

    try {
        const result = await admin.messaging().sendEachForMulticast(message);
        const invalidTokens = [];
        result.responses.forEach((resp, idx) => {
            if (!resp.success) {
                const code = resp.error?.code || '';
                if (
                    code === 'messaging/registration-token-not-registered' ||
                    code === 'messaging/invalid-registration-token' ||
                    code === 'messaging/invalid-argument'
                ) {
                    invalidTokens.push(tokens[idx]);
                }
            }
        });
        console.log(`[FCM Admin] sendToDevices: ${result.successCount}/${tokens.length} sent`);
        return { successCount: result.successCount, failureCount: result.failureCount, invalidTokens };
    } catch (err) {
        console.error(`[FCM Admin] sendToDevices error: ${err.message}`);
        return { successCount: 0, failureCount: tokens.length, invalidTokens: [], error: err.message };
    }
}

module.exports = { sendToDevice, sendToDevices, isInitialized: () => initialized };
