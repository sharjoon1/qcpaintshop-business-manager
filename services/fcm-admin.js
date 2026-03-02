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
 * @returns {Promise<{ success: boolean, messageId?: string, invalidToken?: boolean }>}
 */
async function sendToDevice(fcmToken, { title, body, data }) {
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
            notification: {
                channelId: 'qc_notifications',
                sound: 'default'
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

module.exports = { sendToDevice, isInitialized: () => initialized };
