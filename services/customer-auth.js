/**
 * Customer auth session management.
 *
 * Replaces the localStorage-only "customer_logged_in=true" gate with
 * server-persisted, expirable, revocable tokens. Used by the
 * /api/customer/me/* endpoints.
 */
const crypto = require('crypto');

let pool = null;
function setPool(p) { pool = p; }

const SESSION_TTL_DAYS = 30;

function hash(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

async function createSession({ customerId, phone, ip, userAgent }) {
    if (!pool) throw new Error('customer-auth: pool not set');
    if (!phone) throw new Error('customer-auth: phone required');

    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hash(rawToken);
    const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

    await pool.query(
        `INSERT INTO customer_sessions (token_hash, customer_id, phone, expires_at, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [tokenHash, customerId || null, phone, expiresAt, ip || null, (userAgent || '').slice(0, 255)]
    );

    return rawToken;
}

async function resolveSession(token) {
    if (!pool || !token) return null;
    const [rows] = await pool.query(
        `SELECT customer_id, phone, expires_at FROM customer_sessions
         WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > NOW()
         LIMIT 1`,
        [hash(token)]
    );
    return rows.length ? rows[0] : null;
}

async function revoke(token) {
    if (!pool || !token) return;
    await pool.query(
        'UPDATE customer_sessions SET revoked_at = NOW() WHERE token_hash = ? AND revoked_at IS NULL',
        [hash(token)]
    );
}

async function revokeAllForPhone(phone) {
    if (!pool || !phone) return;
    await pool.query(
        'UPDATE customer_sessions SET revoked_at = NOW() WHERE phone = ? AND revoked_at IS NULL',
        [phone]
    );
}

module.exports = { setPool, createSession, resolveSession, revoke, revokeAllForPhone };
