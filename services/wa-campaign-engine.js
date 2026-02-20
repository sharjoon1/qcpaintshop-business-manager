/**
 * WA CAMPAIGN ENGINE
 * Background singleton that executes WhatsApp marketing campaigns.
 * Uses setTimeout chain (not cron) for precise delay control.
 *
 * Anti-block features:
 *   - Spin text: [Hi|Hello|Hey] → random pick
 *   - Variable substitution: {name}, {company}, {city}, etc.
 *   - Invisible markers: zero-width spaces for unique messages
 *   - Rate limiting: hourly + daily caps via wa_sending_stats
 *   - Warm-up: gradual daily limit increase over 5 days
 *   - Random delays between messages (configurable min/max)
 *   - Auto-pause on consecutive failures
 *
 * Socket.io events emitted to 'wa_marketing_admin' room:
 *   wa_campaign_progress, wa_campaign_paused, wa_campaign_completed,
 *   wa_campaign_started, wa_campaign_failed
 */

let pool;
let io;
let sessionManager;

let running = false;
let currentTimeout = null;
let settings = {};

function setPool(p) { pool = p; }
function setIO(socketIO) { io = socketIO; }
function setSessionManager(sm) { sessionManager = sm; }

// ========================================
// SETTINGS
// ========================================

async function loadSettings() {
    if (!pool) return;
    try {
        const [rows] = await pool.query('SELECT `key`, value FROM wa_marketing_settings');
        settings = {};
        for (const row of rows) {
            settings[row.key] = row.value;
        }
    } catch (e) {
        console.error('[WA Campaign Engine] Failed to load settings:', e.message);
    }
}

function getSetting(key, defaultVal) {
    return settings[key] !== undefined ? settings[key] : String(defaultVal);
}

function getSettingInt(key, defaultVal) {
    return parseInt(getSetting(key, defaultVal)) || defaultVal;
}

// ========================================
// ANTI-BLOCK: SPIN TEXT
// ========================================

/**
 * Resolve spin text: "[Hi|Hello|Hey] {name}" → "Hello {name}"
 * Supports nested: "[Good [morning|evening]|Hi]"
 */
function resolveSpinText(text) {
    if (!text) return text;
    // Process from innermost brackets outward
    let result = text;
    let safety = 20;
    while (result.includes('[') && safety-- > 0) {
        result = result.replace(/\[([^\[\]]+)\]/g, (match, group) => {
            const options = group.split('|');
            return options[Math.floor(Math.random() * options.length)];
        });
    }
    return result;
}

// ========================================
// ANTI-BLOCK: VARIABLE SUBSTITUTION
// ========================================

/**
 * Replace {name}, {company}, {city}, {phone}, {source}, {status} with lead data
 */
function substituteVariables(text, lead) {
    if (!text || !lead) return text;
    return text
        .replace(/\{name\}/gi, lead.lead_name || lead.name || '')
        .replace(/\{company\}/gi, lead.company || '')
        .replace(/\{city\}/gi, lead.city || '')
        .replace(/\{phone\}/gi, lead.phone || '')
        .replace(/\{source\}/gi, lead.source || '')
        .replace(/\{status\}/gi, lead.status || '')
        .replace(/\{email\}/gi, lead.email || '')
        .replace(/\{branch\}/gi, lead.branch_name || '')
        .trim();
}

// ========================================
// ANTI-BLOCK: INVISIBLE MARKERS
// ========================================

/**
 * Append invisible zero-width characters to make each message unique
 */
function appendInvisibleMarker(text) {
    if (getSetting('invisible_markers_enabled', '1') !== '1') return text;
    // Convert timestamp to base36, then map each char to a zero-width char
    const marker = Date.now().toString(36);
    const zwChars = ['\u200B', '\u200C', '\u200D', '\uFEFF']; // ZWS, ZWNJ, ZWJ, BOM
    const invisible = marker.split('').map(c => {
        const idx = parseInt(c, 36) % zwChars.length;
        return zwChars[idx];
    }).join('');
    return text + invisible;
}

// ========================================
// RATE LIMITING
// ========================================

async function getHourlySent(branchId) {
    const now = new Date();
    const [rows] = await pool.query(
        `SELECT COALESCE(SUM(messages_sent), 0) as count
         FROM wa_sending_stats
         WHERE branch_id = ? AND stat_date = CURDATE() AND stat_hour = ?`,
        [branchId, now.getHours()]
    );
    return rows[0].count;
}

async function getDailySent(branchId) {
    const [rows] = await pool.query(
        `SELECT COALESCE(SUM(messages_sent), 0) as count
         FROM wa_sending_stats
         WHERE branch_id = ? AND stat_date = CURDATE()`,
        [branchId]
    );
    return rows[0].count;
}

async function incrementSendingStat(branchId, failed = false) {
    const now = new Date();
    const col = failed ? 'messages_failed' : 'messages_sent';
    await pool.query(
        `INSERT INTO wa_sending_stats (branch_id, stat_date, stat_hour, ${col})
         VALUES (?, CURDATE(), ?, 1)
         ON DUPLICATE KEY UPDATE ${col} = ${col} + 1`,
        [branchId, now.getHours()]
    );
}

// ========================================
// WARM-UP
// ========================================

async function getWarmUpLimit(campaignId) {
    // Find how many days since campaign first started
    const [rows] = await pool.query(
        'SELECT DATEDIFF(CURDATE(), DATE(sending_started_at)) as days_active FROM wa_campaigns WHERE id = ?',
        [campaignId]
    );
    const daysActive = (rows[0]?.days_active || 0) + 1; // 1-based

    const warmupLimits = [
        getSettingInt('warmup_day1', 20),
        getSettingInt('warmup_day2', 50),
        getSettingInt('warmup_day3', 100),
        getSettingInt('warmup_day4', 150),
        getSettingInt('warmup_day5', 200)
    ];

    const idx = Math.min(daysActive - 1, warmupLimits.length - 1);
    return warmupLimits[idx];
}

// ========================================
// MESSAGE RESOLUTION
// ========================================

function resolveMessage(template, lead) {
    let msg = resolveSpinText(template);
    msg = substituteVariables(msg, lead);
    msg = appendInvisibleMarker(msg);
    return msg;
}

// ========================================
// CORE ENGINE LOOP
// ========================================

async function start() {
    if (running) return;
    running = true;
    console.log('[WA Campaign Engine] Started');
    await loadSettings();
    schedulePoll();
}

function stop() {
    running = false;
    if (currentTimeout) {
        clearTimeout(currentTimeout);
        currentTimeout = null;
    }
    console.log('[WA Campaign Engine] Stopped');
}

function isRunning() { return running; }

function schedulePoll() {
    if (!running) return;
    const interval = getSettingInt('engine_poll_interval', 30000);
    currentTimeout = setTimeout(() => pollAndProcess(), interval);
}

async function pollAndProcess() {
    if (!running) return;

    try {
        // Check for scheduled campaigns that should start
        await activateScheduledCampaigns();

        // Find next running campaign
        const [campaigns] = await pool.query(
            `SELECT * FROM wa_campaigns WHERE status = 'running' ORDER BY sending_started_at ASC LIMIT 1`
        );

        if (campaigns.length === 0) {
            schedulePoll();
            return;
        }

        const campaign = campaigns[0];
        await processCampaign(campaign);

    } catch (error) {
        console.error('[WA Campaign Engine] Poll error:', error.message);
    }

    schedulePoll();
}

async function activateScheduledCampaigns() {
    const [scheduled] = await pool.query(
        `SELECT id FROM wa_campaigns WHERE status = 'scheduled' AND scheduled_at <= NOW()`
    );
    for (const c of scheduled) {
        await pool.query(
            `UPDATE wa_campaigns SET status = 'running', sending_started_at = COALESCE(sending_started_at, NOW()) WHERE id = ?`,
            [c.id]
        );
        console.log(`[WA Campaign Engine] Auto-started scheduled campaign #${c.id}`);
        emitEvent('wa_campaign_started', { campaign_id: c.id });
    }
}

async function processCampaign(campaign) {
    const branchId = campaign.branch_id;

    // Check WhatsApp session
    if (!sessionManager || !sessionManager.isConnected(branchId)) {
        console.log(`[WA Campaign Engine] Branch ${branchId} not connected, pausing campaign #${campaign.id}`);
        await pauseCampaign(campaign.id, 'WhatsApp session disconnected');
        return;
    }

    // Check rate limits
    const hourlyLimit = campaign.hourly_limit || getSettingInt('hourly_limit', 30);
    const dailyLimit = campaign.daily_limit || getSettingInt('daily_limit', 200);

    const hourlySent = await getHourlySent(branchId);
    if (hourlySent >= hourlyLimit) {
        console.log(`[WA Campaign Engine] Hourly limit reached (${hourlySent}/${hourlyLimit}) for branch ${branchId}`);
        schedulePoll();
        return;
    }

    const dailySent = await getDailySent(branchId);
    if (dailySent >= dailyLimit) {
        console.log(`[WA Campaign Engine] Daily limit reached (${dailySent}/${dailyLimit}) for branch ${branchId}`);
        schedulePoll();
        return;
    }

    // Check warm-up limit
    if (campaign.warm_up_enabled) {
        const warmUpLimit = await getWarmUpLimit(campaign.id);
        if (dailySent >= warmUpLimit) {
            console.log(`[WA Campaign Engine] Warm-up limit reached (${dailySent}/${warmUpLimit}) for campaign #${campaign.id}`);
            schedulePoll();
            return;
        }
    }

    // Get next pending lead
    const [leads] = await pool.query(
        `SELECT wcl.*, l.company, l.city, l.email, l.source, l.status as lead_status, b.name as branch_name
         FROM wa_campaign_leads wcl
         LEFT JOIN leads l ON wcl.lead_id = l.id
         LEFT JOIN branches b ON ? = b.id
         WHERE wcl.campaign_id = ? AND wcl.status = 'pending'
         ORDER BY wcl.send_order ASC
         LIMIT 1`,
        [branchId, campaign.id]
    );

    if (leads.length === 0) {
        // Campaign complete
        await completeCampaign(campaign.id);
        return;
    }

    const lead = leads[0];
    let consecutiveFailures = 0;

    // Process this lead
    await sendToLead(campaign, lead, branchId);

    // Check for consecutive failures
    const [recentResults] = await pool.query(
        `SELECT status FROM wa_campaign_leads
         WHERE campaign_id = ? AND status IN ('sent','failed')
         ORDER BY updated_at DESC LIMIT ?`,
        [campaign.id, getSettingInt('max_consecutive_failures', 3)]
    );

    if (recentResults.length >= getSettingInt('max_consecutive_failures', 3)) {
        const allFailed = recentResults.every(r => r.status === 'failed');
        if (allFailed) {
            console.log(`[WA Campaign Engine] ${recentResults.length} consecutive failures — auto-pausing campaign #${campaign.id}`);
            await pauseCampaign(campaign.id, `Auto-paused: ${recentResults.length} consecutive failures`);
            return;
        }
    }

    // Random delay before next message
    const minDelay = (campaign.min_delay_seconds || getSettingInt('min_delay', 30)) * 1000;
    const maxDelay = (campaign.max_delay_seconds || getSettingInt('max_delay', 90)) * 1000;
    const delay = minDelay + Math.random() * (maxDelay - minDelay);

    // Short-circuit the poll interval — go directly to next message after delay
    if (running) {
        if (currentTimeout) clearTimeout(currentTimeout);
        currentTimeout = setTimeout(() => pollAndProcess(), delay);
    }
}

async function sendToLead(campaign, lead, branchId) {
    const leadId = lead.id;

    try {
        // Mark as sending
        await pool.query(
            'UPDATE wa_campaign_leads SET status = ? WHERE id = ?',
            ['sending', leadId]
        );

        // Resolve message
        const resolvedMessage = resolveMessage(campaign.message_body || '', {
            lead_name: lead.lead_name,
            name: lead.lead_name,
            company: lead.company,
            city: lead.city,
            email: lead.email,
            phone: lead.phone,
            source: lead.source,
            status: lead.lead_status,
            branch_name: lead.branch_name
        });

        // Simulate seen delay
        const seenMin = getSettingInt('seen_delay_min', 2) * 1000;
        const seenMax = getSettingInt('seen_delay_max', 5) * 1000;
        await sleep(seenMin + Math.random() * (seenMax - seenMin));

        // Simulate typing delay
        const typeMin = getSettingInt('typing_delay_min', 1) * 1000;
        const typeMax = getSettingInt('typing_delay_max', 3) * 1000;
        await sleep(typeMin + Math.random() * (typeMax - typeMin));

        // Send message based on type
        let sent = false;
        if (campaign.message_type === 'text' || !campaign.media_url) {
            sent = await sessionManager.sendMessage(branchId, lead.phone, resolvedMessage);
        } else {
            const mediaPath = campaign.media_url.startsWith('/')
                ? require('path').join(process.cwd(), campaign.media_url)
                : campaign.media_url;

            // Resolve caption with spin/variables too
            const resolvedCaption = campaign.media_caption
                ? resolveMessage(campaign.media_caption, { lead_name: lead.lead_name, name: lead.lead_name, company: lead.company, city: lead.city, phone: lead.phone })
                : undefined;

            sent = await sessionManager.sendMedia(branchId, lead.phone, {
                type: campaign.message_type,
                mediaPath,
                caption: resolvedCaption,
                filename: campaign.media_filename
            });
        }

        if (sent) {
            await pool.query(
                `UPDATE wa_campaign_leads SET status = 'sent', resolved_message = ?, sent_at = NOW() WHERE id = ?`,
                [resolvedMessage, leadId]
            );
            await pool.query(
                'UPDATE wa_campaigns SET sent_count = sent_count + 1 WHERE id = ?',
                [campaign.id]
            );
            await incrementSendingStat(branchId, false);

            emitEvent('wa_campaign_progress', {
                campaign_id: campaign.id,
                lead_id: leadId,
                status: 'sent',
                sent_count: campaign.sent_count + 1,
                total_leads: campaign.total_leads
            });
        } else {
            throw new Error('Session send returned false — session may be disconnected');
        }

    } catch (error) {
        console.error(`[WA Campaign Engine] Send failed for lead ${leadId}:`, error.message);

        await pool.query(
            `UPDATE wa_campaign_leads SET status = 'failed', error_message = ?, failed_at = NOW(),
             retry_count = retry_count + 1 WHERE id = ?`,
            [error.message.substring(0, 500), leadId]
        );
        await pool.query(
            'UPDATE wa_campaigns SET failed_count = failed_count + 1 WHERE id = ?',
            [campaign.id]
        );
        await incrementSendingStat(branchId, true);

        emitEvent('wa_campaign_progress', {
            campaign_id: campaign.id,
            lead_id: leadId,
            status: 'failed',
            error: error.message,
            failed_count: campaign.failed_count + 1,
            total_leads: campaign.total_leads
        });
    }
}

// ========================================
// CAMPAIGN STATE CHANGES
// ========================================

async function pauseCampaign(campaignId, reason) {
    await pool.query(
        "UPDATE wa_campaigns SET status = 'paused' WHERE id = ?",
        [campaignId]
    );
    emitEvent('wa_campaign_paused', { campaign_id: campaignId, reason });
}

async function completeCampaign(campaignId) {
    await pool.query(
        "UPDATE wa_campaigns SET status = 'completed', completed_at = NOW() WHERE id = ?",
        [campaignId]
    );

    const [campaign] = await pool.query('SELECT * FROM wa_campaigns WHERE id = ?', [campaignId]);
    emitEvent('wa_campaign_completed', {
        campaign_id: campaignId,
        sent_count: campaign[0]?.sent_count || 0,
        failed_count: campaign[0]?.failed_count || 0,
        total_leads: campaign[0]?.total_leads || 0
    });
    console.log(`[WA Campaign Engine] Campaign #${campaignId} completed`);
}

// ========================================
// HELPERS
// ========================================

function emitEvent(event, data) {
    if (io) {
        io.to('wa_marketing_admin').emit(event, data);
    }
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function getEngineStatus() {
    return {
        running,
        settings: { ...settings }
    };
}

module.exports = {
    setPool,
    setIO,
    setSessionManager,
    start,
    stop,
    isRunning,
    getEngineStatus,
    loadSettings,
    // Exported for use in routes
    resolveSpinText,
    substituteVariables,
    appendInvisibleMarker,
    resolveMessage
};
