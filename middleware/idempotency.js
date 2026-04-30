/**
 * idempotent(scope) — Express middleware factory (U17).
 *
 * Behaviour:
 *  - Reads Idempotency-Key header (any opaque ASCII string, max 128 chars).
 *  - If absent, passes through (no caching). Backward-compatible.
 *  - If present, looks up scope+key in idempotency_records.
 *      - Hit and not expired → replays stored status+body, skips handler.
 *      - Miss → wraps res.json() / res.status() to capture the first
 *        successful (2xx/4xx) response and stores it. 5xx is NOT stored
 *        so transient errors can be retried.
 *  - 24h TTL.
 *
 * Storage key is SHA-256(scope + ':' + key) so different routes can use
 * the same client-supplied UUID without collision.
 */
const crypto = require('crypto');

let pool = null;
function setPool(p) { pool = p; }

const TTL_HOURS = 24;
const MAX_KEY_LEN = 128;

function hashKey(scope, key) {
    return crypto.createHash('sha256').update(`${scope}:${key}`).digest('hex');
}

function idempotent(scope) {
    if (!scope) throw new Error('idempotent(scope) requires a scope name');

    return async function (req, res, next) {
        if (!pool) return next();

        const rawKey = (req.headers['idempotency-key'] || '').toString().trim();
        if (!rawKey) return next();
        if (rawKey.length > MAX_KEY_LEN || !/^[\x20-\x7e]+$/.test(rawKey)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid Idempotency-Key header'
            });
        }

        const keyHash = hashKey(scope, rawKey);

        try {
            const [rows] = await pool.query(
                'SELECT response_status, response_body FROM idempotency_records WHERE key_hash = ? AND expires_at > NOW() LIMIT 1',
                [keyHash]
            );
            if (rows.length) {
                const stored = rows[0];
                let body = stored.response_body;
                try { body = JSON.parse(body); } catch (_) { /* keep raw */ }
                res.setHeader('Idempotent-Replay', 'true');
                return res.status(stored.response_status).json(body);
            }
        } catch (err) {
            console.error(`[idempotency:${scope}] lookup error:`, err.message);
            return next();
        }

        const userId = req.user?.id || req.painter?.id || req.customer?.id || null;
        const actorType = req.user ? 'user' : (req.painter ? 'painter' : (req.customer ? 'customer' : null));

        const originalJson = res.json.bind(res);
        res.json = (body) => {
            const status = res.statusCode || 200;
            if (status >= 200 && status < 500) {
                const expiresAt = new Date(Date.now() + TTL_HOURS * 3600 * 1000);
                const url = (req.originalUrl || req.url || '').slice(0, 512);
                pool.query(
                    `INSERT INTO idempotency_records
                     (key_hash, scope, user_id, actor_type, response_status, response_body, request_url, expires_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE response_status = VALUES(response_status), response_body = VALUES(response_body), expires_at = VALUES(expires_at)`,
                    [keyHash, scope, userId, actorType, status, JSON.stringify(body), url, expiresAt]
                ).catch(err => {
                    console.error(`[idempotency:${scope}] store error:`, err.message);
                });
            }
            return originalJson(body);
        };

        next();
    };
}

module.exports = { idempotent, setPool };
