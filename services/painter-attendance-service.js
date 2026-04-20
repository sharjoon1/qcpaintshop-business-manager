'use strict';

const EARTH_RADIUS_M = 6371000;

let pool = null;
function setPool(p) { pool = p; }

async function loadConfig() {
    const [rows] = await pool.query(
        "SELECT config_key, config_value FROM ai_config WHERE config_key LIKE 'painter_attendance_%'"
    );
    const map = {};
    rows.forEach(r => { map[r.config_key] = r.config_value; });
    return {
        enabled: map.painter_attendance_enabled === '1',
        pointsPerDay: parseInt(map.painter_attendance_points_per_day || '100', 10),
        rupeesPerPct: parseInt(map.painter_attendance_claim_rupees_per_pct || '1000', 10),
        maxPct: parseInt(map.painter_attendance_claim_max_pct || '100', 10),
        geofenceMeters: parseInt(map.painter_attendance_geofence_meters || '300', 10),
        claimWindowDays: parseInt(map.painter_attendance_claim_window_days || '7', 10),
        imageRetentionDays: parseInt(map.painter_attendance_image_retention_days || '8', 10)
    };
}

function toRad(deg) { return deg * Math.PI / 180; }

function haversineMeters(lat1, lng1, lat2, lng2) {
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(EARTH_RADIUS_M * c);
}

function computeClaimPct(rupeesBilled, cfg) {
    if (!rupeesBilled || rupeesBilled <= 0) return 0;
    const raw = Math.floor(rupeesBilled / cfg.rupeesPerPct);
    return Math.min(cfg.maxPct, raw);
}

function computeClaimableAp(totalAp, claimPct) {
    if (!totalAp || !claimPct) return 0;
    return Math.floor(totalAp * claimPct / 100);
}

async function findNearbyBranches(lat, lng, maxMeters = 1000) {
    const [rows] = await pool.query(
        "SELECT id, name, latitude, longitude FROM branches WHERE status='active' AND latitude IS NOT NULL AND longitude IS NOT NULL"
    );
    return rows
        .map(b => ({
            branch_id: b.id,
            name: b.name,
            latitude: Number(b.latitude),
            longitude: Number(b.longitude),
            distance_meters: haversineMeters(lat, lng, Number(b.latitude), Number(b.longitude))
        }))
        .filter(b => b.distance_meters <= maxMeters)
        .sort((a, b) => a.distance_meters - b.distance_meters);
}

async function recomputeMonthly(painterId, monthKey, connection = null) {
    const conn = connection || pool;
    const [rows] = await conn.query(
        `SELECT COUNT(*) AS cnt, COALESCE(SUM(points_awarded),0) AS ap
         FROM painter_attendance_checkins
         WHERE painter_id = ? AND month_key = ? AND status='approved'`,
        [painterId, monthKey]
    );
    const totalCheckins = rows[0].cnt;
    const totalAp = rows[0].ap;
    await conn.query(
        `INSERT INTO painter_attendance_monthly (painter_id, month_key, total_checkins, total_ap_earned)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE total_checkins = VALUES(total_checkins), total_ap_earned = VALUES(total_ap_earned)`,
        [painterId, monthKey, totalCheckins, totalAp]
    );
    return { totalCheckins, totalAp };
}

async function recordCheckin({ painterId, branchId, lat, lng, selfiePath, distanceMeters, pointsPerDay }) {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
        const monthKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;

        const [result] = await conn.query(
            `INSERT INTO painter_attendance_checkins
             (painter_id, branch_id, checkin_date, checkin_at, latitude, longitude, distance_meters, selfie_path, status, points_awarded)
             VALUES (?, ?, ?, NOW(), ?, ?, ?, ?, 'approved', ?)`,
            [painterId, branchId, dateStr, lat, lng, distanceMeters, selfiePath, pointsPerDay]
        );
        const checkinId = result.insertId;

        await conn.query(
            `INSERT INTO painter_attendance_ledger (painter_id, month_key, checkin_id, type, ap_delta, reason)
             VALUES (?, ?, ?, 'earn', ?, 'Check-in')`,
            [painterId, monthKey, checkinId, pointsPerDay]
        );

        await recomputeMonthly(painterId, monthKey, conn);
        await conn.commit();
        return { checkinId, monthKey };
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

const pointsEngine = require('./painter-points-engine');

async function claimMonth(painterId, monthKey) {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();

        const [rows] = await conn.query(
            'SELECT * FROM painter_attendance_monthly WHERE painter_id=? AND month_key=? FOR UPDATE',
            [painterId, monthKey]
        );
        if (rows.length === 0) throw { status: 400, code: 'NO_MONTH_ROW', message: 'No attendance record for that month' };
        const m = rows[0];

        if (m.claim_status !== 'available') {
            throw { status: 400, code: 'CLAIM_NOT_AVAILABLE', message: `Claim status is ${m.claim_status}` };
        }
        const now = new Date();
        if (m.claim_window_closes_at && new Date(m.claim_window_closes_at) < now) {
            throw { status: 400, code: 'CLAIM_WINDOW_CLOSED', message: 'Claim window has closed' };
        }
        if (m.claimable_ap <= 0) throw { status: 400, code: 'NO_CLAIMABLE_AP', message: 'Nothing to claim' };

        await conn.query(
            `INSERT INTO painter_attendance_ledger (painter_id, month_key, type, ap_delta, reason)
             VALUES (?, ?, 'claim', ?, 'Attendance AP claim')`,
            [painterId, monthKey, -m.claimable_ap]
        );

        await conn.query(
            `UPDATE painter_attendance_monthly
             SET claim_status='claimed', ap_claimed=?, claimed_at=NOW()
             WHERE id=?`,
            [m.claimable_ap, m.id]
        );

        await conn.commit();

        await pointsEngine.addPoints(
            painterId, 'regular', m.claimable_ap,
            'attendance_claim', m.id, 'attendance_monthly',
            `Attendance claim ${monthKey}`, null
        );

        return { claimed_ap: m.claimable_ap, month_key: monthKey };
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

module.exports = { haversineMeters, computeClaimPct, computeClaimableAp, setPool, loadConfig, findNearbyBranches, recordCheckin, recomputeMonthly, claimMonth };
