'use strict';

const fs = require('fs').promises;
const path = require('path');

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
             (painter_id, branch_id, checkin_date, checkin_at, latitude, longitude, distance_meters, selfie_path, status, points_awarded, month_key)
             VALUES (?, ?, ?, NOW(), ?, ?, ?, ?, 'approved', ?, ?)`,
            [painterId, branchId, dateStr, lat, lng, distanceMeters, selfiePath, pointsPerDay, monthKey]
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

async function rejectCheckin(checkinId, reason, adminUserId) {
    const conn = await pool.getConnection();
    try {
        await conn.beginTransaction();
        const [rows] = await conn.query(
            'SELECT * FROM painter_attendance_checkins WHERE id=? FOR UPDATE',
            [checkinId]
        );
        if (rows.length === 0) throw { status: 404, code: 'NOT_FOUND', message: 'Check-in not found' };
        const c = rows[0];
        if (c.status === 'rejected') throw { status: 400, code: 'ALREADY_REJECTED', message: 'Already rejected' };

        await conn.query(
            'UPDATE painter_attendance_checkins SET status=?, rejected_at=NOW(), rejected_reason=?, rejected_by=? WHERE id=?',
            ['rejected', reason, adminUserId, checkinId]
        );
        await conn.query(
            `INSERT INTO painter_attendance_ledger (painter_id, month_key, checkin_id, type, ap_delta, reason, created_by)
             VALUES (?, ?, ?, 'clawback', ?, ?, ?)`,
            [c.painter_id, c.month_key, checkinId, -c.points_awarded, `Rejected: ${reason}`, adminUserId]
        );
        await recomputeMonthly(c.painter_id, c.month_key, conn);

        const [monthlyRows] = await conn.query(
            'SELECT claim_status, ap_claimed FROM painter_attendance_monthly WHERE painter_id=? AND month_key=?',
            [c.painter_id, c.month_key]
        );
        const mStatus = monthlyRows[0] && monthlyRows[0].claim_status;

        await conn.commit();

        if (mStatus === 'claimed') {
            // Use points-engine's getBalance() helper (reads painters.regular_points cached column)
            const balance = await pointsEngine.getBalance(c.painter_id);
            const currentBal = balance ? Number(balance.regular) : 0;
            if (currentBal >= c.points_awarded) {
                await pointsEngine.deductPoints(
                    c.painter_id, 'regular', c.points_awarded,
                    'attendance_clawback', checkinId, 'attendance_checkin',
                    `Clawback: ${reason}`, adminUserId
                );
            } else {
                await pointsEngine.queueClawback(c.painter_id, c.points_awarded, `Rejected: ${reason}`);
            }
        }

        return { checkinId, painter_id: c.painter_id, clawback: c.points_awarded };
    } catch (err) {
        await conn.rollback();
        throw err;
    } finally {
        conn.release();
    }
}

async function openMonthlyClaim(monthKey) {
    const cfg = await loadConfig();

    const [painters] = await pool.query(
        "SELECT DISTINCT painter_id FROM painter_attendance_monthly WHERE month_key=? AND total_ap_earned > 0 AND claim_status='pending'",
        [monthKey]
    );
    let opened = 0;
    for (const row of painters) {
        const painterId = row.painter_id;
        const [billingRows] = await pool.query(
            `SELECT COALESCE(SUM(total),0) AS billed
             FROM painter_estimates
             WHERE painter_id=? AND billing_type='customer'
               AND status IN ('pushed_to_zoho','payment_recorded')
               AND DATE_FORMAT(created_at, '%Y-%m')=?`,
            [painterId, monthKey]
        );
        const billed = Number(billingRows[0].billed);
        const [m] = await pool.query(
            'SELECT total_ap_earned FROM painter_attendance_monthly WHERE painter_id=? AND month_key=?',
            [painterId, monthKey]
        );
        const totalAp = m[0].total_ap_earned;
        const claimPct = computeClaimPct(billed, cfg);
        const claimable = computeClaimableAp(totalAp, claimPct);

        const opensAt = new Date();
        const closesAt = new Date(opensAt);
        closesAt.setDate(closesAt.getDate() + cfg.claimWindowDays);

        await pool.query(
            `UPDATE painter_attendance_monthly
             SET monthly_customer_billed=?, claim_pct=?, claimable_ap=?,
                 claim_status='available', claim_window_opens_at=?, claim_window_closes_at=?
             WHERE painter_id=? AND month_key=?`,
            [billed, claimPct, claimable, opensAt, closesAt, painterId, monthKey]
        );
        opened++;

        if (claimable > 0) {
            try {
                const painterNotif = require('./painter-notification-service');
                await painterNotif.sendToPainter(painterId, {
                    type: 'attendance_claim_window_open',
                    title: `Claim window open! ${claimable} AP available`,
                    title_ta: `கிளைம் விண்டோ திறந்தது! ${claimable} AP கிடைக்கும்`,
                    body: `Based on ₹${billed.toLocaleString('en-IN')} customer bills (${claimPct}%). Claim before ${closesAt.toLocaleDateString('en-IN')}.`,
                    body_ta: `₹${billed.toLocaleString('en-IN')} கஸ்டமர் பில் அடிப்படையில் (${claimPct}%). ${closesAt.toLocaleDateString('en-IN')}-க்கு முன் கிளைம் செய்யவும்.`,
                    data: { screen: 'attendance', month_key: monthKey }
                });
            } catch (e) {}
        }
    }
    return { opened };
}

async function recomputeClaimable(monthKey) {
    const cfg = await loadConfig();
    const [rows] = await pool.query(
        "SELECT painter_id, total_ap_earned FROM painter_attendance_monthly WHERE month_key=? AND claim_status='available'",
        [monthKey]
    );
    for (const row of rows) {
        const [billing] = await pool.query(
            `SELECT COALESCE(SUM(total),0) AS billed FROM painter_estimates
             WHERE painter_id=? AND billing_type='customer'
               AND status IN ('pushed_to_zoho','payment_recorded')
               AND DATE_FORMAT(created_at, '%Y-%m')=?`,
            [row.painter_id, monthKey]
        );
        const billed = Number(billing[0].billed);
        const claimPct = computeClaimPct(billed, cfg);
        const claimable = computeClaimableAp(row.total_ap_earned, claimPct);
        await pool.query(
            'UPDATE painter_attendance_monthly SET monthly_customer_billed=?, claim_pct=?, claimable_ap=? WHERE painter_id=? AND month_key=? AND claim_status="available"',
            [billed, claimPct, claimable, row.painter_id, monthKey]
        );
    }
}

async function remindUnclaimed(monthKey) {
    const [rows] = await pool.query(
        "SELECT painter_id, claimable_ap FROM painter_attendance_monthly WHERE month_key=? AND claim_status='available' AND claimable_ap > 0",
        [monthKey]
    );
    const painterNotif = require('./painter-notification-service');
    for (const r of rows) {
        try {
            await painterNotif.sendToPainter(r.painter_id, {
                type: 'attendance_claim_reminder',
                title: `⏰ Last day! ${r.claimable_ap} AP expires tomorrow`,
                title_ta: `⏰ கடைசி நாள்! ${r.claimable_ap} AP நாளை காலாவதி ஆகும்`,
                body: 'Open the app and tap Claim to convert to Regular points.',
                body_ta: 'ஆப் திறந்து Claim button அழுத்தவும்.',
                data: { screen: 'attendance', month_key: monthKey }
            });
        } catch (e) {}
    }
    return { reminded: rows.length };
}

async function forfeitAndPurge(monthKey, purgeMonthKey) {
    // Only forfeit windows that have actually CLOSED. A window opened late by
    // the M4 startup catch-up may still be open when the 8th-of-month cron (or
    // a catch-up forfeit) fires — cutting it short would eat the painter's AP;
    // claimMonth enforces closes_at, so leaving it open leaks nothing. The
    // month_key <= ? sweep also forfeits expired stragglers from earlier
    // months (e.g. a late window that was still open on its own forfeit day).
    // NULL closes_at (legacy rows) is treated as closed.
    const [unclaimed] = await pool.query(
        `SELECT id, painter_id, month_key FROM painter_attendance_monthly
         WHERE month_key <= ? AND claim_status='available'
           AND (claim_window_closes_at IS NULL OR claim_window_closes_at <= NOW())`,
        [monthKey]
    );
    for (const m of unclaimed) {
        await pool.query(
            `UPDATE painter_attendance_monthly SET claim_status='forfeited', forfeited_at=NOW() WHERE id=?`,
            [m.id]
        );
        await pool.query(
            `INSERT INTO painter_attendance_ledger (painter_id, month_key, type, ap_delta, reason)
             VALUES (?, ?, 'forfeit', 0, 'Claim window closed unclaimed')`,
            [m.painter_id, m.month_key]
        );
    }

    const uploadsRoot = path.join(__dirname, '..', 'public', 'uploads', 'painter-attendance');
    let purged = 0;
    try {
        const painterDirs = await fs.readdir(uploadsRoot);
        for (const pd of painterDirs) {
            const painterPath = path.join(uploadsRoot, pd);
            const stat = await fs.stat(painterPath).catch(() => null);
            if (!stat || !stat.isDirectory()) continue;
            const files = await fs.readdir(painterPath);
            for (const f of files) {
                if (f.startsWith(purgeMonthKey)) {
                    await fs.unlink(path.join(painterPath, f)).catch(() => {});
                    purged++;
                }
            }
        }
    } catch (err) {
        console.error('[attendance] purge failed:', err);
    }
    return { forfeited: unclaimed.length, purged };
}

module.exports = { haversineMeters, computeClaimPct, computeClaimableAp, setPool, loadConfig, findNearbyBranches, recordCheckin, recomputeMonthly, claimMonth, rejectCheckin, openMonthlyClaim, recomputeClaimable, remindUnclaimed, forfeitAndPurge };
