/**
 * SMS gateway client (Nettyfish RetailSMS).
 *
 * Sends via GET with all params (including credentials) in the URL query
 * string — Nettyfish's /api/mt/SendSMS reads them from the query, NOT from
 * a POST body. A 2026-05 change that switched this to POST (to keep creds
 * out of URL logs) broke every SMS with
 *   {"ErrorCode":"1","ErrorMessage":"login details cannot be blank"}
 * so it was reverted to the query-string form the gateway requires.
 *
 * Credential-log hygiene: only the gateway RESPONSE is logged (`[${label}]
 * gateway resp:`) — the request URL (which carries user/password) is never
 * logged here. Verified 2026-06-26: GET reaches auth (template validation);
 * POST body does not.
 *
 * Reads SMS_USER, SMS_PASSWORD, SMS_SENDER_ID from process.env. If
 * either of the first two is missing, the call is a no-op (returns
 * Promise.resolve(null)) — matches the prior "only send if configured"
 * behaviour so test envs without SMS creds don't error.
 */

const https = require('https');
const querystring = require('querystring');

const GATEWAY_HOST = 'retailsms.nettyfish.com';
const GATEWAY_PATH = '/api/mt/SendSMS';

/**
 * Send a single SMS.
 *
 * @param {object} opts
 * @param {string} opts.number  — destination phone, including country code (e.g. "9198765...")
 * @param {string} opts.text    — message body (must match a DLT-approved template)
 * @param {string} [opts.label] — short tag for logs (e.g. "Customer OTP", "Painter OTP")
 * @returns {Promise<string|null>} gateway response body, or null when creds missing
 */
function sendSms({ number, text, label = 'SMS' }) {
    return new Promise((resolve) => {
        if (!process.env.SMS_USER || !process.env.SMS_PASSWORD) {
            // Skip silently in environments without SMS creds (dev, test).
            resolve(null);
            return;
        }

        const qs = querystring.stringify({
            user:     process.env.SMS_USER,
            password: process.env.SMS_PASSWORD,
            senderid: process.env.SMS_SENDER_ID || 'QUALTQ',
            channel:  'Trans',
            DCS:      '0',
            flashsms: '0',
            number,
            text,
            route:    '4',
        });
        const url = `https://${GATEWAY_HOST}${GATEWAY_PATH}?${qs}`;

        https.get(url, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                console.log(`[${label}] gateway resp:`, data.slice(0, 200));
                resolve(data);
            });
        }).on('error', (err) => {
            console.error(`[${label}] gateway error:`, err.message);
            resolve(null);
        });
    });
}

module.exports = { sendSms };
