/**
 * PHOTO GALLERY & CLEANUP ROUTES
 * Admin endpoints for browsing uploaded photos and auto-cleanup cron.
 */

const express = require('express');
const router = express.Router();
const { requireAuth, requirePermission } = require('../middleware/permissionMiddleware');
const fs = require('fs');
const path = require('path');

let pool;
function setPool(p) { pool = p; }

// ── Photo categories with retention policies ────────────────────────────────
const PHOTO_CATEGORIES = [
    { key: 'clock-in',           label: 'Clock In',            dir: 'uploads/attendance/clock-in',        retention: 2, group: 'attendance' },
    { key: 'clock-out',          label: 'Clock Out',           dir: 'uploads/attendance/clock-out',       retention: 2, group: 'attendance' },
    { key: 'break',              label: 'Break',               dir: 'uploads/attendance/break',           retention: 2, group: 'attendance' },
    { key: 'painter-attendance', label: 'Painter Attendance',  dir: 'public/uploads/painter-attendance',  retention: 2, group: 'attendance' },
    { key: 'activity',           label: 'Activity',            dir: 'public/uploads/activity',            retention: 7, group: 'other' },
    { key: 'daily-tasks',        label: 'Daily Tasks',         dir: 'public/uploads/daily-tasks',         retention: 7, group: 'other' },
    { key: 'visualizations',     label: 'Visualizations',      dir: 'public/uploads/visualizations',      retention: 7, group: 'other' },
    { key: 'stock-check',        label: 'Stock Check',         dir: 'uploads/stock-check',                retention: 7, group: 'other' },
];

// Helper: get full dir path
const BASE = path.join(__dirname, '..');
function fullDir(dir) { return path.join(BASE, dir); }

// Helper: check if file is an image
function isImage(filename) {
    return /\.(jpg|jpeg|png|gif|webp)$/i.test(filename);
}

// Helper: parse user ID from filename patterns
// Patterns: {userId}_{type}_{timestamp}.jpg  OR  activity-{timestamp}-{rand}.jpg  OR  c_activity-{ts}.jpg
function parseUserId(filename) {
    const m = filename.match(/^(\d+)_/);
    return m ? parseInt(m[1]) : null;
}

// Helper: get file date from mtime
function getFileDate(filePath) {
    try {
        const stat = fs.statSync(filePath);
        return stat.mtime;
    } catch { return null; }
}

/**
 * GET /categories — List all photo categories with counts
 */
router.get('/categories', requireAuth, async (req, res) => {
    try {
        const categories = PHOTO_CATEGORIES.map(cat => {
            const dir = fullDir(cat.dir);
            let count = 0, totalSize = 0;
            try {
                const files = fs.readdirSync(dir).filter(isImage);
                count = files.length;
                for (const f of files) {
                    try { totalSize += fs.statSync(path.join(dir, f)).size; } catch {}
                }
            } catch {}
            return {
                key: cat.key,
                label: cat.label,
                group: cat.group,
                retention: cat.retention,
                count,
                totalSizeMB: (totalSize / (1024 * 1024)).toFixed(1)
            };
        });
        res.json({ success: true, categories });
    } catch (err) {
        console.error('[Photos] GET /categories error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /list?category=clock-in&date=2026-03-09&page=1&limit=50
 * Returns photo list for a category, newest first
 */
router.get('/list', requireAuth, async (req, res) => {
    try {
        const { category, date, page = 1, limit = 60 } = req.query;
        const cat = PHOTO_CATEGORIES.find(c => c.key === category);
        if (!cat) return res.status(400).json({ success: false, error: 'Invalid category' });

        const dir = fullDir(cat.dir);
        let files = [];
        try {
            files = fs.readdirSync(dir).filter(isImage);
        } catch { /* dir may not exist */ }

        // Build file info
        let photos = [];
        for (const f of files) {
            const fp = path.join(dir, f);
            const stat = fs.statSync(fp);
            const mtime = stat.mtime;

            // Date filter
            if (date) {
                const fileDate = mtime.toISOString().split('T')[0];
                // Use local date for IST
                const localDate = new Date(mtime.getTime() + 5.5 * 60 * 60 * 1000).toISOString().split('T')[0];
                if (localDate !== date) continue;
            }

            // Build URL path for serving
            let urlPath;
            if (cat.dir.startsWith('public/')) {
                urlPath = '/' + cat.dir.replace('public/', '') + '/' + f;
            } else {
                urlPath = '/' + cat.dir + '/' + f;
            }

            photos.push({
                filename: f,
                url: urlPath,
                size: stat.size,
                sizeMB: (stat.size / (1024 * 1024)).toFixed(2),
                mtime: mtime.toISOString(),
                userId: parseUserId(f)
            });
        }

        // Sort newest first
        photos.sort((a, b) => new Date(b.mtime) - new Date(a.mtime));

        const total = photos.length;
        const offset = (parseInt(page) - 1) * parseInt(limit);
        photos = photos.slice(offset, offset + parseInt(limit));

        // Resolve user names if we have userIds
        const userIds = [...new Set(photos.map(p => p.userId).filter(Boolean))];
        let userMap = {};
        if (userIds.length > 0) {
            try {
                const [users] = await pool.query(
                    'SELECT id, full_name FROM users WHERE id IN (?)', [userIds]
                );
                for (const u of users) userMap[u.id] = u.full_name;
            } catch {}
        }

        for (const p of photos) {
            p.userName = p.userId ? (userMap[p.userId] || `User #${p.userId}`) : null;
        }

        res.json({ success: true, photos, total, page: parseInt(page), limit: parseInt(limit) });
    } catch (err) {
        console.error('[Photos] GET /list error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * DELETE /cleanup — Manual cleanup trigger (admin only)
 */
router.delete('/cleanup', requireAuth, requirePermission('system', 'manage'), async (req, res) => {
    try {
        const result = runCleanup();
        res.json({ success: true, ...result });
    } catch (err) {
        console.error('[Photos] DELETE /cleanup error:', err.message);
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * Run photo cleanup — deletes files older than retention period
 * Returns { deleted, errors, byCategory }
 */
function runCleanup() {
    const now = Date.now();
    let totalDeleted = 0;
    let totalErrors = 0;
    const byCategory = {};

    for (const cat of PHOTO_CATEGORIES) {
        const dir = fullDir(cat.dir);
        const maxAge = cat.retention * 24 * 60 * 60 * 1000; // days to ms
        let deleted = 0, errors = 0;

        try {
            const files = fs.readdirSync(dir).filter(isImage);
            for (const f of files) {
                const fp = path.join(dir, f);
                try {
                    const stat = fs.statSync(fp);
                    if (now - stat.mtime.getTime() > maxAge) {
                        fs.unlinkSync(fp);
                        deleted++;
                    }
                } catch (e) {
                    errors++;
                }
            }
        } catch { /* dir doesn't exist */ }

        byCategory[cat.key] = { deleted, errors, retention: cat.retention };
        totalDeleted += deleted;
        totalErrors += errors;
    }

    console.log(`[PhotoCleanup] Deleted ${totalDeleted} files (${totalErrors} errors)`);
    return { deleted: totalDeleted, errors: totalErrors, byCategory };
}

/**
 * Start daily cleanup cron (2 AM IST = 20:30 UTC previous day)
 */
function startCleanupCron() {
    // Run every hour, check if it's 2 AM IST
    setInterval(() => {
        const nowIST = new Date(Date.now() + 5.5 * 60 * 60 * 1000);
        if (nowIST.getUTCHours() === 2 && nowIST.getUTCMinutes() < 5) {
            console.log('[PhotoCleanup] Running scheduled cleanup at 2 AM IST');
            runCleanup();
        }
    }, 5 * 60 * 1000); // Check every 5 minutes

    console.log('[PhotoCleanup] Cleanup cron scheduled (daily 2 AM IST)');
}

module.exports = { router, setPool, startCleanupCron, runCleanup, PHOTO_CATEGORIES };
