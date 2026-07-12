/**
 * WHATSAPP OPT-OUT SERVICE (CM3)
 *
 * Pure keyword/phone helpers + thin pool-backed registry functions for the
 * WhatsApp marketing opt-out (STOP/UNSUBSCRIBE) flow.
 *
 * Compliance layer: an inbound "STOP" text records a suppression row keyed by
 * the number's last-10-digit key; every marketing send (campaign engine,
 * instant-send, painter invite, painter marketing admin quick-send) is gated on
 * this registry at send time. Transactional messages (receipts, OTP, chat
 * replies, the opt-out confirmation itself) are never gated. "START" removes
 * the row (opt back in).
 *
 * Nothing here imports the session manager — it is imported BY the session
 * manager, engine, and routes, so it must stay dependency-free (only `pool` is
 * passed in) to avoid a require cycle.
 */

// Marketing message sources subject to opt-out suppression. Any other source
// (system receipts, OTP, chat, 'optout' confirmations, 'estimate', ...) passes.
const MARKETING_SOURCES = ['campaign', 'instant', 'painter_invite', 'painter_marketing_admin'];

// Exact single-word keywords (compared case-insensitively after trimming and
// stripping trailing punctuation). Multi-word bodies never match.
const STOP_WORDS = new Set(['STOP', 'UNSUBSCRIBE', 'OPTOUT', 'UNSUB']);
const START_WORDS = new Set(['START', 'RESUME', 'SUBSCRIBE']);

// Bilingual opt-out / opt-in confirmation replies. The Tamil line must NOT open
// with வணக்கம் (house rule) — kept as exported constants so tests lock the copy.
const OPT_OUT_REPLY_EN =
    'You have been unsubscribed from promotional WhatsApp messages. Reply START anytime to opt back in.';
const OPT_OUT_REPLY_TA =
    'விளம்பர WhatsApp செய்திகளிலிருந்து உங்களை நீக்கிவிட்டோம். மீண்டும் இணைய START என பதிலளிக்கவும்.';
const OPT_IN_REPLY_EN =
    'You are re-subscribed to Quality Colours updates. Reply STOP anytime to unsubscribe.';
const OPT_IN_REPLY_TA =
    'மீண்டும் Quality Colours புதுப்பிப்புகளுக்கு இணைந்தீர்கள். நீக்க STOP என பதிலளிக்கவும்.';
const OPT_OUT_REPLY = `${OPT_OUT_REPLY_EN}\n\n${OPT_OUT_REPLY_TA}`;
const OPT_IN_REPLY = `${OPT_IN_REPLY_EN}\n\n${OPT_IN_REPLY_TA}`;

/**
 * Detect a STOP/START keyword in an inbound message body.
 * @returns {'stop'|'start'|null}
 * Rules: case-insensitive, trimmed, trailing punctuation/whitespace stripped,
 * and it must be an EXACT single word — "stop by the shop" does NOT match.
 */
function detectKeyword(body) {
    if (body == null) return null;
    // Trim, then strip any trailing non-alphanumeric run ("STOP." / "stop!" → "STOP").
    const cleaned = String(body).trim().replace(/[^A-Za-z0-9]+$/, '');
    if (!cleaned) return null;
    // Any internal whitespace means it's a multi-word body — never a keyword.
    if (/\s/.test(cleaned)) return null;
    const upper = cleaned.toUpperCase();
    if (STOP_WORDS.has(upper)) return 'stop';
    if (START_WORDS.has(upper)) return 'start';
    return null;
}

/**
 * Canonical phone key: the last 10 digits. Returns null when fewer than 10
 * digits are present. Handles 10-digit, 91-prefixed 12-digit, and formatted
 * inputs (+91 98765 43210).
 */
function phoneKey(raw) {
    if (raw == null) return null;
    const digits = String(raw).replace(/\D/g, '');
    if (digits.length < 10) return null;
    return digits.slice(-10);
}

/** True when the number's phone key is in the opt-out registry. */
async function isOptedOut(pool, phone) {
    if (!pool) return false;
    const key = phoneKey(phone);
    if (!key) return false;
    const [rows] = await pool.query(
        'SELECT 1 FROM wa_opt_outs WHERE phone_key = ? LIMIT 1',
        [key]
    );
    return rows.length > 0;
}

/**
 * Record (or refresh) an opt-out for a number.
 * @param {object} opts { phone, source, rawFrom, branchId }
 * @returns {boolean} false when the phone can't be keyed / no pool.
 */
async function recordOptOut(pool, { phone, source, rawFrom, branchId } = {}) {
    if (!pool) return false;
    const key = phoneKey(phone);
    if (!key) return false;
    await pool.query(
        `INSERT INTO wa_opt_outs (phone_key, opted_out_at, source, raw_from, branch_id)
         VALUES (?, NOW(), ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            opted_out_at = NOW(),
            source = VALUES(source),
            raw_from = VALUES(raw_from),
            branch_id = VALUES(branch_id)`,
        [key, source || null, rawFrom || null, branchId != null ? branchId : null]
    );
    return true;
}

/** Remove an opt-out (opt back in). */
async function recordOptIn(pool, phone) {
    if (!pool) return false;
    const key = phoneKey(phone);
    if (!key) return false;
    await pool.query('DELETE FROM wa_opt_outs WHERE phone_key = ?', [key]);
    return true;
}

/**
 * Send-time gate used inside sendMessage/sendMedia. Throws an Error with
 * `code = 'OPTED_OUT'` when a MARKETING_SOURCES send targets an opted-out
 * number; a no-op otherwise (transactional sources always pass).
 */
async function assertSendAllowed(pool, phone, source) {
    if (!MARKETING_SOURCES.includes(source)) return;
    if (await isOptedOut(pool, phone)) {
        const err = new Error('Recipient has opted out of marketing WhatsApp messages');
        err.code = 'OPTED_OUT';
        throw err;
    }
}

module.exports = {
    MARKETING_SOURCES,
    STOP_WORDS,
    START_WORDS,
    OPT_OUT_REPLY,
    OPT_IN_REPLY,
    OPT_OUT_REPLY_EN,
    OPT_OUT_REPLY_TA,
    OPT_IN_REPLY_EN,
    OPT_IN_REPLY_TA,
    detectKeyword,
    phoneKey,
    isOptedOut,
    recordOptOut,
    recordOptIn,
    assertSendAllowed,
};
