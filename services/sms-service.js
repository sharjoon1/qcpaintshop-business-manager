/**
 * SMS gateway client (Nettyfish RetailSMS).
 *
 * Always POSTs — credentials must not appear in URL query strings so
 * they don't end up in access logs / proxy logs / browser history /
 * metric dashboards. Until 2026-05 the codebase had 5 copies of the
 * same `https.get(url-with-creds-in-query)` pattern; this is the one
 * place to call now.
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

        const body = querystring.stringify({
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

        const req = https.request({
            host:   GATEWAY_HOST,
            path:   GATEWAY_PATH,
            method: 'POST',
            headers: {
                'Content-Type':   'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(body),
            },
        }, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                console.log(`[${label}] gateway resp:`, data.slice(0, 200));
                resolve(data);
            });
        });

        req.on('error', (err) => {
            console.error(`[${label}] gateway error:`, err.message);
            resolve(null);
        });

        req.write(body);
        req.end();
    });
}

module.exports = { sendSms };
