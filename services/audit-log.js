/**
 * Audit log helper.
 *
 * Usage:
 *   const audit = require('../services/audit-log');
 *   await audit.record(req, {
 *       action: 'estimate.update',
 *       entity_type: 'estimate',
 *       entity_id: estimateId,
 *       before: previousRow,
 *       after: newRow
 *   });
 *
 * Failures are swallowed (logged to console) so that a broken audit
 * sink never breaks the user-facing request.
 */
let pool = null;
function setPool(p) { pool = p; }

const SENSITIVE_KEYS = new Set([
    'password', 'password_hash', 'token', 'session_token', 'access_token',
    'refresh_token', 'otp', 'cf_otp', 'pan_number', 'aadhar_number'
]);

function redact(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    if (Array.isArray(obj)) return obj.map(redact);
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (SENSITIVE_KEYS.has(k.toLowerCase())) {
            out[k] = '[REDACTED]';
        } else if (v && typeof v === 'object') {
            out[k] = redact(v);
        } else {
            out[k] = v;
        }
    }
    return out;
}

function safeJSON(v) {
    if (v === null || v === undefined) return null;
    try {
        return JSON.stringify(redact(v));
    } catch (err) {
        return JSON.stringify({ _error: 'unserializable', message: err.message });
    }
}

async function record(req, { action, entity_type, entity_id, before, after }) {
    if (!pool) return;
    try {
        const userId = req && req.user ? req.user.id : null;
        const actorType = req && req.customer ? 'customer' : (userId ? 'staff' : 'system');
        await pool.query(
            `INSERT INTO audit_records
                (user_id, actor_type, action, entity_type, entity_id, before_json, after_json, ip, user_agent, request_url)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                userId,
                actorType,
                action,
                entity_type,
                entity_id != null ? String(entity_id).slice(0, 64) : null,
                safeJSON(before),
                safeJSON(after),
                req && req.ip ? String(req.ip).slice(0, 45) : null,
                req && typeof req.get === 'function' ? (req.get('User-Agent') || '').slice(0, 255) : null,
                req && req.originalUrl ? req.originalUrl.slice(0, 500) : null
            ]
        );
    } catch (err) {
        console.error('[audit-log] record failed:', err.message);
    }
}

async function query({ entity_type, entity_id, user_id, action, since, until, limit = 100, offset = 0 }) {
    if (!pool) return [];
    const conditions = [];
    const params = [];
    if (entity_type) { conditions.push('entity_type = ?'); params.push(entity_type); }
    if (entity_id) { conditions.push('entity_id = ?'); params.push(String(entity_id)); }
    if (user_id) { conditions.push('user_id = ?'); params.push(user_id); }
    if (action) { conditions.push('action = ?'); params.push(action); }
    if (since) { conditions.push('ts >= ?'); params.push(since); }
    if (until) { conditions.push('ts <= ?'); params.push(until); }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const safeLimit = Math.min(parseInt(limit) || 100, 500);
    const safeOffset = parseInt(offset) || 0;
    const [rows] = await pool.query(
        `SELECT id, ts, user_id, actor_type, action, entity_type, entity_id, before_json, after_json, ip, request_url
         FROM audit_records ${where}
         ORDER BY ts DESC
         LIMIT ? OFFSET ?`,
        [...params, safeLimit, safeOffset]
    );
    return rows;
}

module.exports = { setPool, record, query };
