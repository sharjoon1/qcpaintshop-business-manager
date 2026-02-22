/**
 * WHATSAPP FOLLOWUP QUEUE PROCESSOR
 * Processes pending WhatsApp messages from whatsapp_followups table
 *
 * Features:
 *   - Processes pending messages every 5 minutes (via cron)
 *   - Dual-mode sending: per-branch session (whatsapp-web.js) or HTTP API fallback
 *   - Retry logic with max 3 attempts
 *   - Scheduled message support (send at specific time)
 *   - Template-based messages for payment reminders
 *
 * Usage:
 *   const whatsapp = require('../services/whatsapp-processor');
 *   whatsapp.setPool(pool);
 *   whatsapp.setSessionManager(sessionManager); // optional
 *   whatsapp.start();
 */

const cron = require('node-cron');
const https = require('https');
const http = require('http');

let pool;
let sessionManager; // whatsapp-session-manager instance (optional)
let processorJob = null;
let isRunning = false;
let isProcessing = false; // Prevent concurrent processing
let stats = { sent: 0, failed: 0, lastRun: null };

const MAX_RETRIES = 3;
const BATCH_SIZE = 10; // Process 10 messages per cycle

function setPool(dbPool) {
    pool = dbPool;
}

function setSessionManager(sm) {
    sessionManager = sm;
}

// ========================================
// MESSAGE TEMPLATES
// ========================================

const messageTemplates = {
    payment_reminder: (data) =>
        `Dear ${data.customer_name},\n\n` +
        `This is a friendly reminder that your invoice #${data.invoice_number || ''} ` +
        `of Rs.${formatAmount(data.amount)} is pending.\n\n` +
        `Due date: ${data.due_date || 'N/A'}\n\n` +
        `Please arrange the payment at your earliest convenience.\n\n` +
        `Thank you,\nQuality Colours`,

    overdue_notice: (data) =>
        `Dear ${data.customer_name},\n\n` +
        `Your invoice #${data.invoice_number || ''} of Rs.${formatAmount(data.amount)} ` +
        `is overdue.\n\n` +
        `Original due date: ${data.due_date || 'N/A'}\n` +
        `Outstanding amount: Rs.${formatAmount(data.balance || data.amount)}\n\n` +
        `Kindly settle this amount at the earliest.\n\n` +
        `Quality Colours\nContact: info@qcpaintshop.com`,

    thank_you: (data) =>
        `Dear ${data.customer_name},\n\n` +
        `Thank you for your payment of Rs.${formatAmount(data.amount)}.\n\n` +
        `We appreciate your business!\n\nQuality Colours`,

    followup: (data) =>
        `Dear ${data.customer_name},\n\n` +
        `We hope you are doing well. This is a follow-up regarding your recent inquiry.\n\n` +
        `Please let us know if you need any assistance.\n\n` +
        `Quality Colours\nPhone: ${data.shop_phone || ''}`,

    reorder_alert: (data) =>
        `⚠️ REORDER ALERT - ${data.severity?.toUpperCase() || 'LOW'}\n\n` +
        `Item: ${data.item_name || 'Unknown'}\n` +
        `Location: ${data.location_name || 'N/A'}\n` +
        `Current Stock: ${data.current_stock || 0}\n` +
        `Reorder Level: ${data.reorder_level || 0}\n` +
        `Reorder Qty: ${data.reorder_quantity || 0}\n\n` +
        `Please arrange restocking at the earliest.\n\n` +
        `Quality Colours - Inventory Alert`,

    custom: (data) => data.message_body || ''
};

function formatAmount(amount) {
    return parseFloat(amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 });
}

// ========================================
// QUEUE PROCESSING
// ========================================

/**
 * Process pending messages in the queue
 */
async function processQueue() {
    if (!pool) return;
    if (isProcessing) {
        console.log('[WhatsApp] Already processing, skipping cycle');
        return;
    }

    isProcessing = true;
    stats.lastRun = new Date();

    try {
        // Load WhatsApp config (needed for HTTP API fallback)
        const [configRows] = await pool.query(
            `SELECT config_key, config_value FROM zoho_config WHERE config_key IN ('whatsapp_enabled', 'whatsapp_api_url', 'whatsapp_api_key')`
        );
        const config = {};
        configRows.forEach(r => { config[r.config_key] = r.config_value; });

        const hasHttpApi = !!(config.whatsapp_api_url && config.whatsapp_api_key);
        const hasSessionManager = !!(sessionManager);

        // Need whatsapp_enabled=true for HTTP API, OR session manager for local sessions
        if (config.whatsapp_enabled !== 'true' && !hasSessionManager) {
            isProcessing = false;
            return;
        }

        // Need at least one sending method
        if (!hasHttpApi && !hasSessionManager) {
            console.warn('[WhatsApp] No sending method available (no HTTP API and no session manager)');
            isProcessing = false;
            return;
        }

        // Fetch pending messages that are due
        const [messages] = await pool.query(`
            SELECT * FROM whatsapp_followups
            WHERE status = 'pending'
            AND (scheduled_at IS NULL OR scheduled_at <= NOW())
            AND retry_count < ?
            ORDER BY created_at ASC
            LIMIT ?
        `, [MAX_RETRIES, BATCH_SIZE]);

        if (messages.length === 0) {
            isProcessing = false;
            return;
        }

        console.log(`[WhatsApp] Processing ${messages.length} pending messages...`);

        for (const msg of messages) {
            try {
                // Mark as in-progress
                await pool.query(
                    `UPDATE whatsapp_followups SET status = 'pending', retry_count = retry_count WHERE id = ?`,
                    [msg.id]
                );

                // Build message body (apply template if needed)
                let body = msg.message_body;
                if (msg.message_type !== 'custom' && messageTemplates[msg.message_type]) {
                    body = messageTemplates[msg.message_type]({
                        customer_name: msg.customer_name || 'Customer',
                        amount: msg.amount,
                        invoice_number: msg.zoho_invoice_id || '',
                        due_date: '',
                        balance: msg.amount,
                        message_body: msg.message_body
                    });
                }

                // DUAL-MODE SENDING:
                // 1. If message has branch_id AND that branch has a connected session → use local session
                // 2. If no branch_id → try ANY connected session (single-branch setups)
                // 3. Otherwise → fallback to HTTP API
                let sent = false;

                if (sessionManager) {
                    let targetBranch = msg.branch_id;

                    // If no branch_id on message, try to find any connected session
                    // Note: use == null to allow branch_id = 0 (General WhatsApp)
                    if (targetBranch == null) {
                        const allStatus = sessionManager.getStatus();
                        const connected = allStatus.find(s => s.status === 'connected');
                        if (connected) targetBranch = connected.branch_id;
                    }

                    if (targetBranch != null && sessionManager.isConnected(targetBranch)) {
                        try {
                            sent = await sessionManager.sendMessage(targetBranch, msg.phone, body);
                            if (sent) {
                                console.log(`[WhatsApp] Sent via branch ${targetBranch} session to ${msg.phone} (ID: ${msg.id})`);
                            }
                        } catch (sessionErr) {
                            console.warn(`[WhatsApp] Branch ${targetBranch} session send failed, falling back to HTTP:`, sessionErr.message);
                            sent = false;
                        }
                    }
                }

                // Fallback to HTTP API if session send didn't work
                if (!sent && hasHttpApi) {
                    await sendWhatsAppMessage(
                        config.whatsapp_api_url,
                        config.whatsapp_api_key,
                        msg.phone,
                        body
                    );
                    sent = true;
                    console.log(`[WhatsApp] Sent via HTTP API to ${msg.phone} (ID: ${msg.id})`);
                }

                if (!sent) {
                    throw new Error('No available sending method (branch session disconnected and no HTTP API)');
                }

                // Mark as sent
                await pool.query(
                    `UPDATE whatsapp_followups SET status = 'sent', sent_at = NOW(), error_message = NULL WHERE id = ?`,
                    [msg.id]
                );

                // Also update collection_reminders if linked
                if (msg.id) {
                    await pool.query(
                        `UPDATE collection_reminders SET status = 'sent' WHERE whatsapp_queue_id = ? AND status = 'pending'`,
                        [msg.id]
                    ).catch(() => {}); // Non-critical
                }

                stats.sent++;

            } catch (sendError) {
                stats.failed++;
                const newRetry = (msg.retry_count || 0) + 1;
                const newStatus = newRetry >= MAX_RETRIES ? 'failed' : 'pending';

                await pool.query(
                    `UPDATE whatsapp_followups SET status = ?, retry_count = ?, error_message = ? WHERE id = ?`,
                    [newStatus, newRetry, sendError.message, msg.id]
                );

                console.error(`[WhatsApp] Failed to send to ${msg.phone} (attempt ${newRetry}/${MAX_RETRIES}):`, sendError.message);
            }

            // Small delay between messages to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        console.log(`[WhatsApp] Cycle complete. Sent: ${messages.length - stats.failed}, Failed: ${stats.failed}`);

    } catch (error) {
        console.error('[WhatsApp] Queue processing error:', error.message);
    } finally {
        isProcessing = false;
    }
}

/**
 * Send a WhatsApp message via Business API
 * Supports common WhatsApp API formats (WATI, Twilio, custom)
 */
function sendWhatsAppMessage(apiUrl, apiKey, phone, message) {
    return new Promise((resolve, reject) => {
        // Normalize phone number (add country code if missing)
        let normalizedPhone = phone.replace(/[^0-9+]/g, '');
        if (!normalizedPhone.startsWith('+') && !normalizedPhone.startsWith('91')) {
            normalizedPhone = '91' + normalizedPhone;
        }
        if (normalizedPhone.startsWith('+')) {
            normalizedPhone = normalizedPhone.substring(1);
        }

        const postData = JSON.stringify({
            // Common WhatsApp API payload format
            messaging_product: 'whatsapp',
            to: normalizedPhone,
            type: 'text',
            text: { body: message },
            // Alternative field names used by some providers
            phone: normalizedPhone,
            message: message,
            body: message
        });

        const urlObj = new URL(apiUrl);
        const isHttps = urlObj.protocol === 'https:';
        const httpModule = isHttps ? https : http;

        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || (isHttps ? 443 : 80),
            path: urlObj.pathname + urlObj.search,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(postData),
                'Authorization': `Bearer ${apiKey}`,
                'X-API-Key': apiKey
            }
        };

        const req = httpModule.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                if (res.statusCode >= 200 && res.statusCode < 300) {
                    resolve(data);
                } else {
                    reject(new Error(`WhatsApp API error ${res.statusCode}: ${data.substring(0, 200)}`));
                }
            });
        });

        req.on('error', reject);
        req.setTimeout(15000, () => {
            req.destroy();
            reject(new Error('WhatsApp API timeout'));
        });
        req.write(postData);
        req.end();
    });
}

// ========================================
// AUTO OVERDUE REMINDERS
// ========================================

/**
 * Queue overdue invoice reminders automatically
 * Called by the scheduler daily
 */
async function queueOverdueReminders() {
    if (!pool) return;

    try {
        const [configRows] = await pool.query(
            `SELECT config_value FROM zoho_config WHERE config_key = 'overdue_reminder_days'`
        );
        const reminderDays = (configRows[0]?.config_value || '7,14,30').split(',').map(d => parseInt(d.trim()));

        for (const days of reminderDays) {
            // Find overdue invoices matching this reminder day
            const [overdueInvoices] = await pool.query(`
                SELECT zi.*, zcm.zoho_phone, zcm.branch_id
                FROM zoho_invoices zi
                LEFT JOIN zoho_customers_map zcm ON zi.zoho_customer_id = zcm.zoho_contact_id
                WHERE zi.status = 'overdue'
                AND zi.balance > 0
                AND DATEDIFF(CURDATE(), zi.due_date) = ?
                AND zcm.zoho_phone IS NOT NULL
                AND zcm.zoho_phone != ''
            `, [days]);

            for (const inv of overdueInvoices) {
                // Check if we already queued a reminder for this invoice today
                const [existing] = await pool.query(`
                    SELECT id FROM whatsapp_followups
                    WHERE zoho_invoice_id = ? AND message_type = 'overdue_notice'
                    AND DATE(created_at) = CURDATE()
                    LIMIT 1
                `, [inv.zoho_invoice_id]);

                if (existing.length === 0) {
                    const body = messageTemplates.overdue_notice({
                        customer_name: inv.customer_name,
                        invoice_number: inv.invoice_number,
                        amount: inv.total,
                        balance: inv.balance,
                        due_date: inv.due_date
                    });

                    await pool.query(`
                        INSERT INTO whatsapp_followups (
                            zoho_customer_id, zoho_invoice_id, customer_name,
                            phone, message_type, message_body, amount, status, branch_id
                        ) VALUES (?, ?, ?, ?, 'overdue_notice', ?, ?, 'pending', ?)
                    `, [
                        inv.zoho_customer_id, inv.zoho_invoice_id,
                        inv.customer_name, inv.zoho_phone || '',
                        body, inv.balance, inv.branch_id || null
                    ]);

                    console.log(`[WhatsApp] Queued overdue reminder for ${inv.customer_name} (${days} days overdue)`);
                }
            }
        }
    } catch (error) {
        console.error('[WhatsApp] Failed to queue overdue reminders:', error.message);
    }
}

// ========================================
// CRON MANAGEMENT
// ========================================

/**
 * Start the WhatsApp processor
 */
function start() {
    if (isRunning) return;

    // Process queue every 5 minutes
    processorJob = cron.schedule('*/5 * * * *', processQueue, {
        scheduled: true,
        timezone: 'Asia/Kolkata'
    });

    isRunning = true;
    console.log('[WhatsApp] Queue processor started (every 5 min)');
}

/**
 * Stop the processor
 */
function stop() {
    if (processorJob) {
        processorJob.stop();
        processorJob = null;
    }
    isRunning = false;
    console.log('[WhatsApp] Queue processor stopped');
}

/**
 * Get processor status
 */
function getStatus() {
    return {
        running: isRunning,
        processing: isProcessing,
        stats: { ...stats },
        last_run: stats.lastRun
    };
}

module.exports = {
    setPool,
    setSessionManager,
    start,
    stop,
    getStatus,
    processQueue,
    queueOverdueReminders
};
