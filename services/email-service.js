/**
 * SHARED EMAIL SERVICE
 * Provides branded email sending for all modules.
 *
 * Usage:
 *   const emailService = require('../services/email-service');
 *   await emailService.send('user@example.com', 'Subject', '<p>Body HTML</p>');
 */

const nodemailer = require('nodemailer');

function createTransporter() {
    if (!process.env.SMTP_HOST) return null;
    // Local loopback sendmail (SMTP_USER unset) won't accept AUTH. Drop the auth
    // block entirely in that case — passing an empty user/pass makes nodemailer
    // attempt CRAM-MD5 and fail with "Missing credentials".
    const cfg = {
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: parseInt(process.env.SMTP_PORT || '587') === 465 || process.env.SMTP_SECURE === 'true',
        // SVC-035: validate the SMTP server cert by default. Set SMTP_INSECURE_TLS=true
        // only for a self-signed/loopback relay (prod uses a 127.0.0.1 sendmail relay).
        tls: { rejectUnauthorized: process.env.SMTP_INSECURE_TLS !== 'true' },
    };
    if (process.env.SMTP_USER) {
        cfg.auth = { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD };
    }
    return nodemailer.createTransport(cfg);
}

function getMailFrom() {
    return `"${process.env.MAIL_FROM_NAME || 'Quality Colours'}" <${process.env.MAIL_FROM || process.env.SMTP_USER}>`;
}

/**
 * Send a branded email
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} bodyHtml - HTML content for the email body
 * @param {Array} attachments - Optional nodemailer attachments array
 * @returns {Promise<boolean>} true if sent, false if skipped/failed
 */
async function send(to, subject, bodyHtml, attachments) {
    const transporter = createTransporter();
    if (!transporter) {
        console.log('[Email] SMTP not configured, skipping email to:', to);
        return false;
    }
    try {
        await transporter.sendMail({
            from: getMailFrom(),
            to,
            subject,
            html: `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center;">
                        <h1 style="color: white; margin: 0; font-size: 24px;">Quality Colours</h1>
                        <p style="color: rgba(255,255,255,0.8); margin: 5px 0 0; font-size: 13px;">Business Manager</p>
                    </div>
                    <div style="background: #f9fafb; padding: 30px;">
                        ${bodyHtml}
                    </div>
                    <div style="background: #f3f4f6; padding: 15px; text-align: center; font-size: 12px; color: #9ca3af;">
                        Quality Colours Paint Shop &bull; Thanjavur, Tamil Nadu
                    </div>
                </div>
            `,
            attachments: attachments || []
        });
        return true;
    } catch (err) {
        console.error('[Email] Send error:', err.message);
        return false;
    }
}

module.exports = { send };
