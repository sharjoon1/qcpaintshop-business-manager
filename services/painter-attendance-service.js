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

module.exports = { haversineMeters, computeClaimPct, computeClaimableAp, setPool, loadConfig, findNearbyBranches };
