const express = require('express');
const router = express.Router();

/**
 * Live Location Tracker
 * ---------------------
 * Share a link (https://act.qcpaintshop.com/t/<code>) — when the recipient
 * opens it and allows location access, their live position streams here.
 * The owner watches it on track-admin.html (Leaflet map).
 *
 * Endpoints (all keyed by the share code; the code IS the access secret):
 *   POST /api/location-track/:code          — store a location point (public, from the tracked device)
 *   GET  /api/location-track/:code/latest   — latest point (for admin polling)
 *   GET  /api/location-track/:code/history  — recent points for the path line
 *   GET  /api/location-track/:code/info     — first/last seen, online status
 */

let pool;
function setPool(dbPool) { pool = dbPool; }

const CODE_RE = /^[A-Za-z0-9_-]{4,32}$/;
const MAX_HISTORY_POINTS = 500;       // points kept per code (rolling cleanup)
const ONLINE_WINDOW_MS = 60 * 1000;   // considered "live" if seen within 60s

function cleanCode(raw) {
    return String(raw || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
}

function isValidCoord(v, min, max) {
    return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
}

// Keep the table small — delete points beyond the newest N per code.
async function trimHistory(code) {
    try {
        await pool.query(
            `DELETE lt FROM location_tracks lt
             JOIN (
                SELECT id FROM location_tracks WHERE code = ?
                ORDER BY id DESC LIMIT 1 OFFSET ?
             ) keep ON 1 = 1
             WHERE lt.code = ? AND lt.id < keep.id`,
            [code, MAX_HISTORY_POINTS, code]
        );
    } catch { /* best effort */ }
}

// ── POST /api/location-track/:code — store a point ─────────────────────────
router.post('/:code', async (req, res) => {
    try {
        const code = cleanCode(req.params.code);
        if (!CODE_RE.test(code)) {
            return res.status(400).json({ success: false, message: 'Invalid track code' });
        }

        const { lat, lng, accuracy, speed, heading, battery, is_charging, device } = req.body || {};
        if (!isValidCoord(lat, -90, 90) || !isValidCoord(lng, -180, 180)) {
            return res.status(400).json({ success: false, message: 'Invalid coordinates' });
        }
        const acc = Number.isFinite(accuracy) ? Math.max(0, Math.min(100000, accuracy)) : null;

        const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim()
            || req.socket.remoteAddress || null;

        const [result] = await pool.query(
            `INSERT INTO location_tracks
                (code, lat, lng, accuracy, speed, heading, battery, is_charging, device, ip)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                code,
                lat.toFixed(7),
                lng.toFixed(7),
                acc,
                Number.isFinite(speed) ? speed : null,
                Number.isFinite(heading) ? heading : null,
                Number.isFinite(battery) ? Math.round(battery) : null,
                is_charging ? 1 : 0,
                String(device || '').slice(0, 255),
                ip,
            ]
        );

        // Rolling cleanup every ~50 inserts to keep history bounded
        if (result.insertId % 50 === 0) trimHistory(code);

        res.json({ success: true, id: result.insertId });
    } catch (err) {
        console.error('location-track POST error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to store location' });
    }
});

// ── GET /:code/latest ──────────────────────────────────────────────────────
router.get('/:code/latest', async (req, res) => {
    try {
        const code = cleanCode(req.params.code);
        if (!CODE_RE.test(code)) {
            return res.status(400).json({ success: false, message: 'Invalid track code' });
        }
        const [rows] = await pool.query(
            `SELECT lat, lng, accuracy, speed, heading, battery, is_charging, device, captured_at
             FROM location_tracks WHERE code = ? ORDER BY id DESC LIMIT 1`,
            [code]
        );
        if (rows.length === 0) {
            return res.json({ success: true, found: false });
        }
        res.json({ success: true, found: true, point: rows[0] });
    } catch (err) {
        console.error('location-track latest error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to load location' });
    }
});

// ── GET /:code/history ─────────────────────────────────────────────────────
router.get('/:code/history', async (req, res) => {
    try {
        const code = cleanCode(req.params.code);
        if (!CODE_RE.test(code)) {
            return res.status(400).json({ success: false, message: 'Invalid track code' });
        }
        const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
        const [rows] = await pool.query(
            `SELECT lat, lng, accuracy, captured_at
             FROM location_tracks WHERE code = ? ORDER BY id DESC LIMIT ?`,
            [code, limit]
        );
        res.json({ success: true, points: rows.reverse() });
    } catch (err) {
        console.error('location-track history error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to load history' });
    }
});

// ── GET /:code/info ────────────────────────────────────────────────────────
router.get('/:code/info', async (req, res) => {
    try {
        const code = cleanCode(req.params.code);
        if (!CODE_RE.test(code)) {
            return res.status(400).json({ success: false, message: 'Invalid track code' });
        }
        const [rows] = await pool.query(
            `SELECT MIN(captured_at) AS first_seen, MAX(captured_at) AS last_seen, COUNT(*) AS points
             FROM location_tracks WHERE code = ?`,
            [code]
        );
        const row = rows[0] || {};
        const lastSeen = row.last_seen ? new Date(row.last_seen).getTime() : 0;
        const online = lastSeen > 0 && (Date.now() - lastSeen) <= ONLINE_WINDOW_MS;
        res.json({ success: true, ...row, online });
    } catch (err) {
        console.error('location-track info error:', err.message);
        res.status(500).json({ success: false, message: 'Failed to load status' });
    }
});

module.exports = { router, setPool };
