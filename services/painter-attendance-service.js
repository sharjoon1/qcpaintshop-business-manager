'use strict';

const EARTH_RADIUS_M = 6371000;

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

module.exports = { haversineMeters, computeClaimPct, computeClaimableAp };
