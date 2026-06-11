/**
 * Painter Routes — painter auth middleware (A8a split).
 * requirePainterAuth / requirePainterSession moved verbatim from
 * routes/painters.js. Pool is injected via ./index.js setPool fan-out.
 */

let pool;
function setPool(p) { pool = p; }

// ═══════════════════════════════════════════
// PAINTER AUTH MIDDLEWARE
// ═══════════════════════════════════════════

async function requirePainterAuth(req, res, next) {
    const token = req.headers['x-painter-token'];
    if (!token) return res.status(401).json({ success: false, message: 'Painter authentication required' });

    try {
        const [sessions] = await pool.query(
            'SELECT ps.painter_id, p.status, p.full_name FROM painter_sessions ps JOIN painters p ON ps.painter_id = p.id WHERE ps.token_hash = LOWER(SHA2(?, 256)) AND ps.expires_at > NOW()',
            [token]
        );
        if (!sessions.length) return res.status(401).json({ success: false, message: 'Invalid or expired session' });
        if (sessions[0].status !== 'approved') return res.status(403).json({ success: false, message: `Account is ${sessions[0].status}` });

        req.painter = { id: sessions[0].painter_id, name: sessions[0].full_name };
        next();
    } catch (error) {
        console.error('Painter auth error:', error);
        res.status(500).json({ success: false, message: 'Authentication error' });
    }
}

// Accepts pending or approved painters. Used only by self-service
// endpoints that must work while awaiting approval.
async function requirePainterSession(req, res, next) {
    const token = req.headers['x-painter-token'];
    if (!token) return res.status(401).json({ success: false, message: 'Painter authentication required' });

    try {
        const [sessions] = await pool.query(
            'SELECT ps.painter_id, p.status, p.full_name FROM painter_sessions ps JOIN painters p ON ps.painter_id = p.id WHERE ps.token_hash = LOWER(SHA2(?, 256)) AND ps.expires_at > NOW()',
            [token]
        );
        if (!sessions.length) return res.status(401).json({ success: false, message: 'Invalid or expired session' });

        req.painter = { id: sessions[0].painter_id, name: sessions[0].full_name, status: sessions[0].status };
        next();
    } catch (error) {
        console.error('Painter session auth error:', error);
        res.status(500).json({ success: false, message: 'Authentication error' });
    }
}

module.exports = { setPool, requirePainterAuth, requirePainterSession };
