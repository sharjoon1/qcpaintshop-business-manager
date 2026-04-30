# Admin FCM Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin composer that sends rich push notifications (image + custom MP3 sound) to filtered painter audiences, with a history log.

**Architecture:** New `admin_notifications` DB table + `routes/admin-notifications.js` (5 endpoints). FCM fan-out via upgraded `services/fcm-admin.js` (`sendToDevices` batch method). Android painter app gets a new `qc_admin_channel` with custom MP3 + offer tap routing. Admin UI adds a "Notifications" tab to `admin-painters.html`.

**Tech Stack:** Express.js, MariaDB, Firebase Admin SDK (`sendEachForMulticast`), Sharp (image resize), Multer (memory storage), Jetpack Compose, `QCFirebaseMessagingService.kt`

---

## File Map

| Action | File |
|---|---|
| Create | `migrations/migrate-admin-notifications.js` |
| Modify | `config/uploads.js` — add upload dir + `uploadAdminNotifImage` multer |
| Create | `routes/admin-notifications.js` — 5 endpoints |
| Modify | `services/fcm-admin.js` — add `sendToDevices()` |
| Modify | `server.js` — require + mount + setPool |
| Modify | `public/admin-painters.html` — Notifications tab |
| Create | `tests/unit/admin-notifications.test.js` |
| Copy | `app_notification.mp3` → Android `app/src/painter/res/raw/` |
| Modify | `app/src/main/java/com/qcpaintshop/act/fcm/QCFirebaseMessagingService.kt` |

---

## Task 1: DB Migration

**Files:**
- Create: `migrations/migrate-admin-notifications.js`
- Modify: `config/uploads.js`

- [ ] **Step 1: Create migration file**

```js
// migrations/migrate-admin-notifications.js
const mysql = require('mysql2/promise');
require('dotenv').config();
const fs = require('fs');

async function migrate() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
    });

    await connection.execute(`
        CREATE TABLE IF NOT EXISTS admin_notifications (
            id INT PRIMARY KEY AUTO_INCREMENT,
            title VARCHAR(200) NOT NULL,
            body TEXT NOT NULL,
            image_url VARCHAR(500) DEFAULT NULL,
            type ENUM('info','offer') NOT NULL DEFAULT 'info',
            offer_url VARCHAR(500) DEFAULT NULL,
            audience_type ENUM('all','branch','level','city','specific') NOT NULL DEFAULT 'all',
            audience_value JSON DEFAULT NULL,
            reach_count INT NOT NULL DEFAULT 0,
            sent_at DATETIME NOT NULL,
            created_by INT NOT NULL,
            INDEX idx_sent_at (sent_at),
            INDEX idx_type (type)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    const dir = 'public/uploads/admin-notif-images';
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    console.log('[migrate-admin-notifications] Done');
    await connection.end();
}

migrate().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Add upload dir to `config/uploads.js`**

In `config/uploads.js`, add `'public/uploads/admin-notif-images'` to the `uploadDirs` array (around line 34, after `'uploads/dpl-pdfs'`):

```js
    'uploads/dpl-pdfs',
    'public/uploads/admin-notif-images'
```

- [ ] **Step 3: Run migration**

```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/act.qcpaintshop.com"
node migrations/migrate-admin-notifications.js
```

Expected output: `[migrate-admin-notifications] Done`

- [ ] **Step 4: Verify table exists**

```bash
node -e "
const mysql = require('mysql2/promise');
require('dotenv').config();
mysql.createConnection({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME})
  .then(c => c.execute('DESCRIBE admin_notifications').then(([r])=>{ console.log(r.map(x=>x.Field).join(', ')); c.end(); }))
"
```

Expected: `id, title, body, image_url, type, offer_url, audience_type, audience_value, reach_count, sent_at, created_by`

- [ ] **Step 5: Commit**

```bash
git add migrations/migrate-admin-notifications.js config/uploads.js
git commit -m "feat(admin-notif): migration + upload dir"
```

---

## Task 2: FCM Service — `sendToDevices` Batch Method

**Files:**
- Modify: `services/fcm-admin.js`

- [ ] **Step 1: Write failing test**

Create `tests/unit/admin-notifications.test.js`:

```js
// tests/unit/admin-notifications.test.js
const { buildAudienceQuery } = require('../../routes/admin-notifications');

describe('buildAudienceQuery', () => {
    test('all: no extra WHERE clauses', () => {
        const { sql, params } = buildAudienceQuery('all', null);
        expect(sql).not.toContain('branch_id');
        expect(sql).not.toContain('current_level');
        expect(params).toHaveLength(0);
    });

    test('branch: adds branch_id IN filter', () => {
        const { sql, params } = buildAudienceQuery('branch', [1, 2]);
        expect(sql).toContain('p.branch_id IN (?)');
        expect(params).toEqual([[1, 2]]);
    });

    test('level: adds current_level IN filter', () => {
        const { sql, params } = buildAudienceQuery('level', ['bronze', 'silver']);
        expect(sql).toContain('p.current_level IN (?)');
        expect(params).toEqual([['bronze', 'silver']]);
    });

    test('city: adds city IN filter', () => {
        const { sql, params } = buildAudienceQuery('city', ['Chennai']);
        expect(sql).toContain('p.city IN (?)');
        expect(params).toEqual([['Chennai']]);
    });

    test('specific: adds painter id IN filter', () => {
        const { sql, params } = buildAudienceQuery('specific', [5, 10]);
        expect(sql).toContain('p.id IN (?)');
        expect(params).toEqual([[5, 10]]);
    });

    test('unknown audience type: no extra filter (safe fallback)', () => {
        const { sql, params } = buildAudienceQuery('unknown', [1]);
        expect(params).toHaveLength(0);
    });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/act.qcpaintshop.com"
npx jest tests/unit/admin-notifications.test.js --no-coverage 2>&1 | head -30
```

Expected: FAIL — `Cannot find module '../../routes/admin-notifications'`

- [ ] **Step 3: Add `sendToDevices` to `services/fcm-admin.js`**

Open `services/fcm-admin.js`. After the closing brace of `sendToDevice` (around line 101), add the new function before the `module.exports` line:

```js
/**
 * Send a push notification to multiple devices (batch, up to 500 tokens per call)
 * Uses FCM sendEachForMulticast for efficient batching.
 *
 * @param {string[]} tokens - Array of FCM tokens (max 500 per call)
 * @param {Object} opts
 * @param {string} opts.title
 * @param {string} opts.body
 * @param {string} [opts.imageUrl] - Publicly accessible HTTPS image URL (FCM big picture)
 * @param {string} [opts.type] - 'info' | 'offer'
 * @param {string} [opts.offerUrl] - URL to open when offer is tapped
 * @returns {Promise<{ successCount: number, failureCount: number, invalidTokens: string[] }>}
 */
async function sendToDevices(tokens, { title, body, imageUrl, type, offerUrl }) {
    if (!initialized || !tokens || tokens.length === 0) {
        return { successCount: 0, failureCount: 0, invalidTokens: [] };
    }

    const data = {
        type: type || 'info',
        offerUrl: offerUrl || '',
    };

    const message = {
        tokens,
        notification: {
            title,
            body,
            ...(imageUrl ? { imageUrl } : {}),
        },
        android: {
            priority: 'high',
            notification: {
                channelId: 'qc_admin_channel',
                sound: 'app_notification',
                notificationPriority: 'PRIORITY_HIGH',
                defaultVibrateTimings: true,
            },
        },
        data,
    };

    try {
        const result = await admin.messaging().sendEachForMulticast(message);
        const invalidTokens = [];
        result.responses.forEach((resp, idx) => {
            if (!resp.success) {
                const code = resp.error?.code || '';
                if (
                    code === 'messaging/registration-token-not-registered' ||
                    code === 'messaging/invalid-registration-token' ||
                    code === 'messaging/invalid-argument'
                ) {
                    invalidTokens.push(tokens[idx]);
                }
            }
        });
        console.log(`[FCM Admin] sendToDevices: ${result.successCount}/${tokens.length} sent`);
        return { successCount: result.successCount, failureCount: result.failureCount, invalidTokens };
    } catch (err) {
        console.error(`[FCM Admin] sendToDevices error: ${err.message}`);
        return { successCount: 0, failureCount: tokens.length, invalidTokens: [], error: err.message };
    }
}
```

Also update the `module.exports` line at the bottom:

```js
module.exports = { sendToDevice, sendToDevices, isInitialized: () => initialized };
```

- [ ] **Step 4: Commit FCM service change**

```bash
git add services/fcm-admin.js
git commit -m "feat(admin-notif): add sendToDevices batch method to fcm-admin"
```

---

## Task 3: Admin Notifications Route

**Files:**
- Create: `routes/admin-notifications.js`

- [ ] **Step 1: Create the route file**

```js
// routes/admin-notifications.js
'use strict';

const express = require('express');
const router = express.Router();
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const { requirePermission } = require('../middleware/permissionMiddleware');
const fcmAdmin = require('../services/fcm-admin');

let pool;
function setPool(p) { pool = p; }

const UPLOAD_DIR = 'public/uploads/admin-notif-images';
const BASE_URL = process.env.APP_BASE_URL || 'https://act.qcpaintshop.com';

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/')) cb(null, true);
        else cb(new Error('Only image files allowed'));
    },
});

/**
 * Pure function: build the audience WHERE extension + params for painter_fcm_tokens query.
 * Exported for unit testing.
 */
function buildAudienceQuery(audienceType, audienceValue) {
    let sql = `SELECT DISTINCT pft.fcm_token
               FROM painter_fcm_tokens pft
               JOIN painters p ON p.id = pft.painter_id
               WHERE p.status = 'active' AND pft.is_active = 1 AND pft.fcm_token IS NOT NULL`;
    const params = [];

    if (audienceType === 'branch' && Array.isArray(audienceValue) && audienceValue.length) {
        sql += ' AND p.branch_id IN (?)';
        params.push(audienceValue);
    } else if (audienceType === 'level' && Array.isArray(audienceValue) && audienceValue.length) {
        sql += ' AND p.current_level IN (?)';
        params.push(audienceValue);
    } else if (audienceType === 'city' && Array.isArray(audienceValue) && audienceValue.length) {
        sql += ' AND p.city IN (?)';
        params.push(audienceValue);
    } else if (audienceType === 'specific' && Array.isArray(audienceValue) && audienceValue.length) {
        sql += ' AND p.id IN (?)';
        params.push(audienceValue);
    }

    return { sql, params };
}

async function getTargetTokens(audienceType, audienceValue) {
    const { sql, params } = buildAudienceQuery(audienceType, audienceValue);
    const [rows] = await pool.query(sql, params);
    return rows; // [{ fcm_token }]
}

// POST /upload-image
router.post('/upload-image', requirePermission('painters', 'manage'), upload.single('image'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded' });

        const filename = `notif_${Date.now()}_${Math.round(Math.random() * 1e9)}.jpg`;
        const outPath = path.join(UPLOAD_DIR, filename);

        await sharp(req.file.buffer)
            .resize({ width: 1024, withoutEnlargement: true })
            .jpeg({ quality: 85 })
            .toFile(outPath);

        res.json({ success: true, imageUrl: `/uploads/admin-notif-images/${filename}` });
    } catch (err) {
        console.error('[admin-notifications] upload error:', err);
        res.status(500).json({ success: false, message: 'Upload failed' });
    }
});

// GET /audience-count  (must be before /:id)
router.get('/audience-count', requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const { audienceType = 'all' } = req.query;
        const audienceValue = req.query.audienceValue ? JSON.parse(req.query.audienceValue) : null;
        const tokens = await getTargetTokens(audienceType, audienceValue);
        res.json({ success: true, count: tokens.length });
    } catch (err) {
        console.error('[admin-notifications] audience-count error:', err);
        res.status(500).json({ success: false, message: 'Failed to count audience' });
    }
});

// GET / — history
router.get('/', requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, parseInt(req.query.limit) || 20);
        const offset = (page - 1) * limit;

        const [rows] = await pool.query(
            `SELECT id, title, type, audience_type, reach_count, sent_at
             FROM admin_notifications ORDER BY sent_at DESC LIMIT ? OFFSET ?`,
            [limit, offset]
        );
        const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM admin_notifications');

        res.json({ success: true, notifications: rows, total, page, limit });
    } catch (err) {
        console.error('[admin-notifications] list error:', err);
        res.status(500).json({ success: false, message: 'Failed to load history' });
    }
});

// POST / — send notification
router.post('/', requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const { title, body, imageUrl, type = 'info', offerUrl, audienceType = 'all', audienceValue } = req.body;

        if (!title?.trim()) return res.status(400).json({ success: false, message: 'Title is required' });
        if (!body?.trim()) return res.status(400).json({ success: false, message: 'Body is required' });
        if (type === 'offer' && !offerUrl?.trim()) {
            return res.status(400).json({ success: false, message: 'Offer URL is required for offer type' });
        }

        const tokenRows = await getTargetTokens(audienceType, audienceValue || null);
        const allTokens = tokenRows.map(r => r.fcm_token);

        let successCount = 0;
        const allInvalidTokens = [];

        if (allTokens.length > 0) {
            const fullImageUrl = imageUrl ? `${BASE_URL}${imageUrl}` : undefined;

            for (let i = 0; i < allTokens.length; i += 500) {
                const batch = allTokens.slice(i, i + 500);
                const result = await fcmAdmin.sendToDevices(batch, {
                    title,
                    body,
                    imageUrl: fullImageUrl,
                    type,
                    offerUrl: offerUrl || '',
                });
                successCount += result.successCount || 0;
                if (result.invalidTokens?.length) allInvalidTokens.push(...result.invalidTokens);
            }
        }

        const [insertResult] = await pool.query(
            `INSERT INTO admin_notifications (title, body, image_url, type, offer_url, audience_type, audience_value, reach_count, sent_at, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
            [
                title.trim(), body.trim(),
                imageUrl || null, type,
                offerUrl?.trim() || null,
                audienceType,
                audienceValue ? JSON.stringify(audienceValue) : null,
                allTokens.length,
                req.user.id,
            ]
        );

        if (allInvalidTokens.length > 0) {
            await pool.query('DELETE FROM painter_fcm_tokens WHERE fcm_token IN (?)', [allInvalidTokens]);
        }

        res.json({ success: true, reach: allTokens.length, id: insertResult.insertId });
    } catch (err) {
        console.error('[admin-notifications] send error:', err);
        res.status(500).json({ success: false, message: 'Failed to send notification' });
    }
});

// GET /:id — notification detail
router.get('/:id', requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM admin_notifications WHERE id = ?', [req.params.id]);
        if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
        res.json({ success: true, notification: rows[0] });
    } catch (err) {
        console.error('[admin-notifications] get error:', err);
        res.status(500).json({ success: false, message: 'Failed to load notification' });
    }
});

module.exports = { router, setPool, buildAudienceQuery };
```

- [ ] **Step 2: Run tests — expect PASS**

```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/act.qcpaintshop.com"
npx jest tests/unit/admin-notifications.test.js --no-coverage
```

Expected: PASS — 6 tests passing

- [ ] **Step 3: Commit**

```bash
git add routes/admin-notifications.js tests/unit/admin-notifications.test.js
git commit -m "feat(admin-notif): route + audience query builder + unit tests"
```

---

## Task 4: Mount Route in `server.js`

**Files:**
- Modify: `server.js`

- [ ] **Step 1: Add require near other painter routes**

In `server.js`, find the line `const painterMarketingRoutes = require('./routes/painter-marketing');` (around line 64). Add after it:

```js
const adminNotificationsRoutes = require('./routes/admin-notifications');
```

- [ ] **Step 2: Add setPool call**

Find the block where `paintersRoutes.setPool(pool)` is called (search for `paintersRoutes.setPool`). Add after it:

```js
adminNotificationsRoutes.setPool(pool);
```

- [ ] **Step 3: Mount the router**

Find `app.use('/api/painters', paintersRoutes.router);` (line ~323). Add after it:

```js
app.use('/api/admin-notifications', adminNotificationsRoutes.router);
```

- [ ] **Step 4: Smoke test the route**

```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/act.qcpaintshop.com"
node -e "
const app = require('./server');
" 2>&1 | head -20
```

Expected: Server starts without error (or `[server] listening on port...`). No `Cannot find module` errors.

Actually just check for syntax errors:

```bash
node --check server.js && echo "OK"
```

Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat(admin-notif): mount /api/admin-notifications route"
```

---

## Task 5: Admin UI — Notifications Tab

**Files:**
- Modify: `public/admin-painters.html`

- [ ] **Step 1: Add tab button**

In `public/admin-painters.html`, find the tab buttons section. Look for:

```html
                <button class="tab-btn" onclick="switchTab('attendance')">Attendance</button>
```

Add after it:

```html
                <button class="tab-btn" onclick="switchTab('notifications')">🔔 Notifications</button>
```

- [ ] **Step 2: Add tab content panel**

Find the closing `</div>` of the last tab content panel (search for `id="tab-attendance"`). After the closing `</div>` of that panel, add:

```html
            <!-- Notifications Tab -->
            <div id="tab-notifications" class="tab-content">
                <div style="max-width:800px;margin:0 auto;">

                    <!-- Sub-tabs -->
                    <div style="display:flex;gap:0.5rem;margin-bottom:1.5rem;border-bottom:2px solid #e8ecf1;padding-bottom:0.75rem;">
                        <button class="tab-btn active" id="notif-compose-btn" onclick="switchNotifTab('compose')" style="font-size:0.8rem;">✏️ Compose</button>
                        <button class="tab-btn" id="notif-history-btn" onclick="switchNotifTab('history')" style="font-size:0.8rem;">📜 History</button>
                    </div>

                    <!-- Compose Panel -->
                    <div id="notif-panel-compose">
                        <div style="background:#fff;border-radius:12px;padding:1.5rem;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
                            <h3 style="margin:0 0 1.25rem;font-size:1rem;font-weight:700;color:#1e293b;">Send Notification to Painters</h3>

                            <!-- Title -->
                            <div style="margin-bottom:1rem;">
                                <label style="font-size:0.8rem;font-weight:600;color:#475569;display:block;margin-bottom:0.35rem;">Title *</label>
                                <input id="notif-title" type="text" placeholder="e.g. Special Offer for You!" maxlength="200"
                                    style="width:100%;padding:0.6rem 0.75rem;border:1px solid #e2e8f0;border-radius:8px;font-size:0.875rem;box-sizing:border-box;">
                            </div>

                            <!-- Body -->
                            <div style="margin-bottom:1rem;">
                                <label style="font-size:0.8rem;font-weight:600;color:#475569;display:block;margin-bottom:0.35rem;">Message *</label>
                                <textarea id="notif-body" rows="3" placeholder="Notification message body..."
                                    style="width:100%;padding:0.6rem 0.75rem;border:1px solid #e2e8f0;border-radius:8px;font-size:0.875rem;resize:vertical;box-sizing:border-box;"></textarea>
                            </div>

                            <!-- Type -->
                            <div style="margin-bottom:1rem;">
                                <label style="font-size:0.8rem;font-weight:600;color:#475569;display:block;margin-bottom:0.35rem;">Type</label>
                                <div style="display:flex;gap:0.5rem;">
                                    <button id="notif-type-info" onclick="setNotifType('info')"
                                        style="padding:0.45rem 1.2rem;border-radius:8px;border:2px solid #6366f1;background:#6366f1;color:#fff;font-size:0.8rem;font-weight:600;cursor:pointer;">
                                        ℹ️ Info
                                    </button>
                                    <button id="notif-type-offer" onclick="setNotifType('offer')"
                                        style="padding:0.45rem 1.2rem;border-radius:8px;border:2px solid #e2e8f0;background:#fff;color:#64748b;font-size:0.8rem;font-weight:600;cursor:pointer;">
                                        🎁 Offer
                                    </button>
                                </div>
                            </div>

                            <!-- Offer URL (shown only for offer type) -->
                            <div id="notif-offer-url-row" style="margin-bottom:1rem;display:none;">
                                <label style="font-size:0.8rem;font-weight:600;color:#475569;display:block;margin-bottom:0.35rem;">Offer Link URL *</label>
                                <input id="notif-offer-url" type="url" placeholder="https://act.qcpaintshop.com/painter-catalog.html"
                                    style="width:100%;padding:0.6rem 0.75rem;border:1px solid #e2e8f0;border-radius:8px;font-size:0.875rem;box-sizing:border-box;">
                            </div>

                            <!-- Image upload -->
                            <div style="margin-bottom:1rem;">
                                <label style="font-size:0.8rem;font-weight:600;color:#475569;display:block;margin-bottom:0.35rem;">Image (optional, max 2MB)</label>
                                <div style="display:flex;align-items:center;gap:0.75rem;">
                                    <label style="padding:0.45rem 1rem;border:1px dashed #94a3b8;border-radius:8px;cursor:pointer;font-size:0.8rem;color:#64748b;background:#f8fafc;">
                                        📷 Choose Image
                                        <input id="notif-image-input" type="file" accept="image/*" style="display:none;" onchange="handleNotifImageUpload(this)">
                                    </label>
                                    <span id="notif-image-status" style="font-size:0.8rem;color:#64748b;"></span>
                                </div>
                                <div id="notif-image-preview" style="margin-top:0.5rem;display:none;">
                                    <img id="notif-image-preview-img" style="max-height:120px;border-radius:8px;border:1px solid #e2e8f0;">
                                    <button onclick="clearNotifImage()" style="margin-left:0.5rem;padding:0.25rem 0.5rem;border:none;background:#fee2e2;color:#dc2626;border-radius:4px;font-size:0.75rem;cursor:pointer;">Remove</button>
                                </div>
                            </div>

                            <!-- Audience -->
                            <div style="margin-bottom:1.25rem;">
                                <label style="font-size:0.8rem;font-weight:600;color:#475569;display:block;margin-bottom:0.35rem;">Audience</label>
                                <select id="notif-audience-type" onchange="handleAudienceTypeChange()"
                                    style="width:100%;padding:0.6rem 0.75rem;border:1px solid #e2e8f0;border-radius:8px;font-size:0.875rem;margin-bottom:0.5rem;">
                                    <option value="all">All Active Painters</option>
                                    <option value="branch">By Branch</option>
                                    <option value="level">By Loyalty Level</option>
                                    <option value="city">By City</option>
                                    <option value="specific">Specific Painters</option>
                                </select>

                                <!-- Branch picker -->
                                <div id="notif-audience-branch" style="display:none;" class="notif-audience-picker">
                                    <div id="notif-branch-chips" style="display:flex;flex-wrap:wrap;gap:0.4rem;"></div>
                                </div>

                                <!-- Level picker -->
                                <div id="notif-audience-level" style="display:none;" class="notif-audience-picker">
                                    <div style="display:flex;flex-wrap:wrap;gap:0.4rem;">
                                        <label style="display:flex;align-items:center;gap:0.3rem;font-size:0.8rem;padding:0.3rem 0.7rem;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer;background:#fafbfd;">
                                            <input type="checkbox" value="bronze" class="notif-level-check"> Bronze
                                        </label>
                                        <label style="display:flex;align-items:center;gap:0.3rem;font-size:0.8rem;padding:0.3rem 0.7rem;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer;background:#fafbfd;">
                                            <input type="checkbox" value="silver" class="notif-level-check"> Silver
                                        </label>
                                        <label style="display:flex;align-items:center;gap:0.3rem;font-size:0.8rem;padding:0.3rem 0.7rem;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer;background:#fafbfd;">
                                            <input type="checkbox" value="gold" class="notif-level-check"> Gold
                                        </label>
                                        <label style="display:flex;align-items:center;gap:0.3rem;font-size:0.8rem;padding:0.3rem 0.7rem;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer;background:#fafbfd;">
                                            <input type="checkbox" value="platinum" class="notif-level-check"> Platinum
                                        </label>
                                    </div>
                                </div>

                                <!-- City input -->
                                <div id="notif-audience-city" style="display:none;" class="notif-audience-picker">
                                    <input id="notif-city-input" type="text" placeholder="Enter city name and press Enter"
                                        onkeydown="handleCityTagInput(event)"
                                        style="width:100%;padding:0.6rem 0.75rem;border:1px solid #e2e8f0;border-radius:8px;font-size:0.875rem;box-sizing:border-box;">
                                    <div id="notif-city-tags" style="display:flex;flex-wrap:wrap;gap:0.4rem;margin-top:0.5rem;"></div>
                                </div>

                                <!-- Specific painters search -->
                                <div id="notif-audience-specific" style="display:none;" class="notif-audience-picker">
                                    <input id="notif-painter-search" type="text" placeholder="Search painter by name or phone..."
                                        oninput="searchPaintersForNotif(this.value)"
                                        style="width:100%;padding:0.6rem 0.75rem;border:1px solid #e2e8f0;border-radius:8px;font-size:0.875rem;box-sizing:border-box;margin-bottom:0.5rem;">
                                    <div id="notif-painter-results" style="background:#fff;border:1px solid #e2e8f0;border-radius:8px;max-height:180px;overflow-y:auto;display:none;"></div>
                                    <div id="notif-selected-painters" style="display:flex;flex-wrap:wrap;gap:0.4rem;margin-top:0.5rem;"></div>
                                </div>
                            </div>

                            <!-- Send button -->
                            <button id="notif-send-btn" onclick="sendAdminNotification()"
                                style="width:100%;padding:0.75rem;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;border:none;border-radius:10px;font-size:0.95rem;font-weight:700;cursor:pointer;letter-spacing:0.3px;">
                                🚀 Send Notification
                            </button>
                            <p id="notif-send-result" style="text-align:center;margin-top:0.75rem;font-size:0.875rem;display:none;"></p>
                        </div>
                    </div>

                    <!-- History Panel -->
                    <div id="notif-panel-history" style="display:none;">
                        <div style="background:#fff;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,0.08);overflow:hidden;">
                            <table class="data-table" id="notif-history-table">
                                <thead>
                                    <tr>
                                        <th>Date</th>
                                        <th>Title</th>
                                        <th>Type</th>
                                        <th>Audience</th>
                                        <th>Reach</th>
                                        <th></th>
                                    </tr>
                                </thead>
                                <tbody id="notif-history-body">
                                    <tr><td colspan="6" style="text-align:center;padding:2rem;color:#94a3b8;">Loading...</td></tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    <!-- Detail Modal -->
                    <div id="notif-detail-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;align-items:center;justify-content:center;">
                        <div style="background:#fff;border-radius:16px;padding:1.5rem;max-width:520px;width:90%;max-height:80vh;overflow-y:auto;position:relative;">
                            <button onclick="closeNotifDetail()" style="position:absolute;top:1rem;right:1rem;border:none;background:none;font-size:1.2rem;cursor:pointer;color:#64748b;">✕</button>
                            <div id="notif-detail-content"></div>
                        </div>
                    </div>
                </div>
            </div>
```

- [ ] **Step 3: Add JavaScript for the Notifications tab**

Find the closing `</script>` tag in `admin-painters.html`. Just before it, add:

```js
// ===== NOTIFICATIONS TAB =====
let notifSelectedImageUrl = null;
let notifSelectedType = 'info';
let notifCityTags = [];
let notifSelectedPainterIds = [];
let notifBranches = [];

function switchNotifTab(tab) {
    document.getElementById('notif-panel-compose').style.display = tab === 'compose' ? 'block' : 'none';
    document.getElementById('notif-panel-history').style.display = tab === 'history' ? 'block' : 'none';
    document.getElementById('notif-compose-btn').classList.toggle('active', tab === 'compose');
    document.getElementById('notif-history-btn').classList.toggle('active', tab === 'history');
    if (tab === 'history') loadNotifHistory();
}

function setNotifType(type) {
    notifSelectedType = type;
    const infoBtn = document.getElementById('notif-type-info');
    const offerBtn = document.getElementById('notif-type-offer');
    const activeStyle = 'padding:0.45rem 1.2rem;border-radius:8px;border:2px solid #6366f1;background:#6366f1;color:#fff;font-size:0.8rem;font-weight:600;cursor:pointer;';
    const inactiveStyle = 'padding:0.45rem 1.2rem;border-radius:8px;border:2px solid #e2e8f0;background:#fff;color:#64748b;font-size:0.8rem;font-weight:600;cursor:pointer;';
    infoBtn.style.cssText = type === 'info' ? activeStyle : inactiveStyle;
    offerBtn.style.cssText = type === 'offer' ? activeStyle : inactiveStyle;
    document.getElementById('notif-offer-url-row').style.display = type === 'offer' ? 'block' : 'none';
}

function handleAudienceTypeChange() {
    const val = document.getElementById('notif-audience-type').value;
    document.querySelectorAll('.notif-audience-picker').forEach(el => el.style.display = 'none');
    if (val !== 'all') {
        document.getElementById('notif-audience-' + val).style.display = 'block';
    }
    if (val === 'branch' && notifBranches.length === 0) loadNotifBranches();
}

async function loadNotifBranches() {
    try {
        const r = await fetch('/api/branches', { headers: { Authorization: 'Bearer ' + localStorage.getItem('auth_token') } });
        const d = await r.json();
        notifBranches = d.branches || d || [];
        const container = document.getElementById('notif-branch-chips');
        container.innerHTML = notifBranches.map(b =>
            `<label style="display:flex;align-items:center;gap:0.3rem;font-size:0.8rem;padding:0.3rem 0.7rem;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer;background:#fafbfd;">
                <input type="checkbox" value="${b.id}" class="notif-branch-check"> ${esc(b.name)}
            </label>`
        ).join('');
    } catch {}
}

async function handleNotifImageUpload(input) {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
        alert('Image must be under 2MB');
        input.value = '';
        return;
    }
    const statusEl = document.getElementById('notif-image-status');
    statusEl.textContent = 'Uploading...';
    const formData = new FormData();
    formData.append('image', file);
    try {
        const r = await fetch('/api/admin-notifications/upload-image', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + localStorage.getItem('auth_token') },
            body: formData,
        });
        const d = await r.json();
        if (d.success) {
            notifSelectedImageUrl = d.imageUrl;
            statusEl.textContent = 'Uploaded ✓';
            document.getElementById('notif-image-preview').style.display = 'block';
            document.getElementById('notif-image-preview-img').src = d.imageUrl;
        } else {
            statusEl.textContent = 'Upload failed';
        }
    } catch {
        statusEl.textContent = 'Upload error';
    }
}

function clearNotifImage() {
    notifSelectedImageUrl = null;
    document.getElementById('notif-image-input').value = '';
    document.getElementById('notif-image-status').textContent = '';
    document.getElementById('notif-image-preview').style.display = 'none';
}

function handleCityTagInput(e) {
    if (e.key !== 'Enter') return;
    const val = e.target.value.trim();
    if (!val || notifCityTags.includes(val)) { e.target.value = ''; return; }
    notifCityTags.push(val);
    e.target.value = '';
    renderCityTags();
}

function renderCityTags() {
    document.getElementById('notif-city-tags').innerHTML = notifCityTags.map((c, i) =>
        `<span style="display:inline-flex;align-items:center;gap:0.3rem;padding:0.25rem 0.6rem;background:#e0e7ff;color:#4338ca;border-radius:999px;font-size:0.78rem;">
            ${esc(c)} <button onclick="removeCityTag(${i})" style="border:none;background:none;cursor:pointer;color:#6366f1;font-size:0.9rem;line-height:1;padding:0;">×</button>
        </span>`
    ).join('');
}

function removeCityTag(idx) { notifCityTags.splice(idx, 1); renderCityTags(); }

let painterSearchTimer = null;
function searchPaintersForNotif(q) {
    clearTimeout(painterSearchTimer);
    if (q.length < 2) { document.getElementById('notif-painter-results').style.display = 'none'; return; }
    painterSearchTimer = setTimeout(async () => {
        try {
            const r = await fetch('/api/painters?search=' + encodeURIComponent(q) + '&limit=10', {
                headers: { Authorization: 'Bearer ' + localStorage.getItem('auth_token') }
            });
            const d = await r.json();
            const painters = d.painters || d.data || [];
            const container = document.getElementById('notif-painter-results');
            if (!painters.length) { container.style.display = 'none'; return; }
            container.style.display = 'block';
            container.innerHTML = painters.map(p =>
                `<div onclick="selectNotifPainter(${p.id},'${esc(p.full_name)}')"
                    style="padding:0.6rem 0.75rem;cursor:pointer;font-size:0.85rem;border-bottom:1px solid #f1f5f9;"
                    onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
                    <strong>${esc(p.full_name)}</strong> <span style="color:#94a3b8;">${esc(p.phone||'')}</span>
                </div>`
            ).join('');
        } catch {}
    }, 300);
}

function selectNotifPainter(id, name) {
    if (notifSelectedPainterIds.find(p => p.id === id)) return;
    notifSelectedPainterIds.push({ id, name });
    document.getElementById('notif-painter-results').style.display = 'none';
    document.getElementById('notif-painter-search').value = '';
    renderSelectedPainters();
}

function renderSelectedPainters() {
    document.getElementById('notif-selected-painters').innerHTML = notifSelectedPainterIds.map((p, i) =>
        `<span style="display:inline-flex;align-items:center;gap:0.3rem;padding:0.25rem 0.6rem;background:#dcfce7;color:#166534;border-radius:999px;font-size:0.78rem;">
            ${esc(p.name)} <button onclick="removeNotifPainter(${i})" style="border:none;background:none;cursor:pointer;color:#16a34a;font-size:0.9rem;padding:0;">×</button>
        </span>`
    ).join('');
}

function removeNotifPainter(idx) { notifSelectedPainterIds.splice(idx, 1); renderSelectedPainters(); }

function getNotifAudienceValue() {
    const type = document.getElementById('notif-audience-type').value;
    if (type === 'all') return null;
    if (type === 'branch') return Array.from(document.querySelectorAll('.notif-branch-check:checked')).map(c => parseInt(c.value));
    if (type === 'level') return Array.from(document.querySelectorAll('.notif-level-check:checked')).map(c => c.value);
    if (type === 'city') return [...notifCityTags];
    if (type === 'specific') return notifSelectedPainterIds.map(p => p.id);
    return null;
}

async function sendAdminNotification() {
    const title = document.getElementById('notif-title').value.trim();
    const body = document.getElementById('notif-body').value.trim();
    const offerUrl = document.getElementById('notif-offer-url').value.trim();
    const audienceType = document.getElementById('notif-audience-type').value;
    const audienceValue = getNotifAudienceValue();

    if (!title) { alert('Title is required'); return; }
    if (!body) { alert('Message is required'); return; }
    if (notifSelectedType === 'offer' && !offerUrl) { alert('Offer URL is required'); return; }

    // Get audience count first
    const btn = document.getElementById('notif-send-btn');
    btn.disabled = true;
    btn.textContent = 'Checking audience...';

    try {
        const countParams = new URLSearchParams({ audienceType });
        if (audienceValue) countParams.set('audienceValue', JSON.stringify(audienceValue));
        const cntR = await fetch('/api/admin-notifications/audience-count?' + countParams, {
            headers: { Authorization: 'Bearer ' + localStorage.getItem('auth_token') }
        });
        const cntD = await cntR.json();
        const count = cntD.count || 0;

        if (count === 0) {
            alert('No painters found for the selected audience.');
            btn.disabled = false;
            btn.textContent = '🚀 Send Notification';
            return;
        }

        if (!confirm(`Send to ${count} painters?`)) {
            btn.disabled = false;
            btn.textContent = '🚀 Send Notification';
            return;
        }

        btn.textContent = 'Sending...';
        const r = await fetch('/api/admin-notifications', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer ' + localStorage.getItem('auth_token'),
            },
            body: JSON.stringify({
                title, body,
                imageUrl: notifSelectedImageUrl || undefined,
                type: notifSelectedType,
                offerUrl: notifSelectedType === 'offer' ? offerUrl : undefined,
                audienceType,
                audienceValue,
            }),
        });
        const d = await r.json();
        const resultEl = document.getElementById('notif-send-result');
        if (d.success) {
            resultEl.textContent = `✅ Sent to ${d.reach} painters!`;
            resultEl.style.color = '#16a34a';
            resultEl.style.display = 'block';
            // Reset form
            document.getElementById('notif-title').value = '';
            document.getElementById('notif-body').value = '';
            document.getElementById('notif-offer-url').value = '';
            clearNotifImage();
            notifCityTags = [];
            notifSelectedPainterIds = [];
        } else {
            resultEl.textContent = '❌ ' + (d.message || 'Send failed');
            resultEl.style.color = '#dc2626';
            resultEl.style.display = 'block';
        }
    } catch (err) {
        alert('Error: ' + err.message);
    } finally {
        btn.disabled = false;
        btn.textContent = '🚀 Send Notification';
    }
}

async function loadNotifHistory() {
    const tbody = document.getElementById('notif-history-body');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:#94a3b8;">Loading...</td></tr>';
    try {
        const r = await fetch('/api/admin-notifications?page=1&limit=20', {
            headers: { Authorization: 'Bearer ' + localStorage.getItem('auth_token') }
        });
        const d = await r.json();
        if (!d.notifications?.length) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:#94a3b8;">No notifications sent yet.</td></tr>';
            return;
        }
        tbody.innerHTML = d.notifications.map(n => `
            <tr>
                <td style="font-size:0.8rem;white-space:nowrap;">${new Date(n.sent_at).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</td>
                <td style="font-size:0.85rem;font-weight:500;">${esc(n.title)}</td>
                <td><span style="padding:0.2rem 0.6rem;border-radius:999px;font-size:0.75rem;background:${n.type==='offer'?'#fef9c3':'#e0e7ff'};color:${n.type==='offer'?'#92400e':'#3730a3'};">${n.type}</span></td>
                <td style="font-size:0.8rem;">${n.audience_type}</td>
                <td style="font-size:0.85rem;font-weight:600;">${n.reach_count}</td>
                <td><button onclick="viewNotifDetail(${n.id})" style="padding:0.25rem 0.6rem;border:1px solid #e2e8f0;border-radius:6px;background:#f8fafc;font-size:0.75rem;cursor:pointer;">View</button></td>
            </tr>
        `).join('');
    } catch {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:2rem;color:#ef4444;">Failed to load.</td></tr>';
    }
}

async function viewNotifDetail(id) {
    const modal = document.getElementById('notif-detail-modal');
    modal.style.display = 'flex';
    document.getElementById('notif-detail-content').innerHTML = '<div style="text-align:center;padding:2rem;color:#94a3b8;">Loading...</div>';
    try {
        const r = await fetch('/api/admin-notifications/' + id, {
            headers: { Authorization: 'Bearer ' + localStorage.getItem('auth_token') }
        });
        const d = await r.json();
        const n = d.notification;
        const audience = n.audience_value ? JSON.parse(typeof n.audience_value === 'string' ? n.audience_value : JSON.stringify(n.audience_value)) : null;
        document.getElementById('notif-detail-content').innerHTML = `
            <h3 style="margin:0 0 1rem;font-size:1rem;">${esc(n.title)}</h3>
            <p style="color:#475569;font-size:0.875rem;margin:0 0 1rem;">${esc(n.body)}</p>
            ${n.image_url ? `<img src="${n.image_url}" style="max-width:100%;border-radius:8px;margin-bottom:1rem;">` : ''}
            ${n.offer_url ? `<p style="font-size:0.8rem;"><strong>Offer URL:</strong> <a href="${esc(n.offer_url)}" target="_blank">${esc(n.offer_url)}</a></p>` : ''}
            <div style="display:flex;gap:1rem;flex-wrap:wrap;margin-bottom:0.75rem;">
                <div style="font-size:0.8rem;"><strong>Type:</strong> ${n.type}</div>
                <div style="font-size:0.8rem;"><strong>Audience:</strong> ${n.audience_type}</div>
                <div style="font-size:0.8rem;"><strong>Reach:</strong> ${n.reach_count} painters</div>
            </div>
            ${audience ? `<div style="font-size:0.8rem;color:#64748b;"><strong>Filter values:</strong> ${JSON.stringify(audience)}</div>` : ''}
            <div style="font-size:0.75rem;color:#94a3b8;margin-top:0.75rem;">${new Date(n.sent_at).toLocaleString('en-IN')}</div>
        `;
    } catch {
        document.getElementById('notif-detail-content').innerHTML = '<div style="color:#ef4444;">Failed to load details.</div>';
    }
}

function closeNotifDetail() {
    document.getElementById('notif-detail-modal').style.display = 'none';
}
// ===== END NOTIFICATIONS TAB =====
```

- [ ] **Step 4: Commit**

```bash
git add public/admin-painters.html
git commit -m "feat(admin-notif): Notifications tab in admin-painters UI"
```

---

## Task 6: Android — Custom Sound Channel + Offer Tap Routing

**Files:**
- Copy: `app_notification.mp3` → `app/src/painter/res/raw/app_notification.mp3`
- Modify: `app/src/main/java/com/qcpaintshop/act/fcm/QCFirebaseMessagingService.kt`

- [ ] **Step 1: Create raw resource directory and copy MP3**

```bash
mkdir -p "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android/app/src/painter/res/raw"
cp "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/app_notification.mp3" \
   "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android/app/src/painter/res/raw/app_notification.mp3"
```

Verify:
```bash
ls "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android/app/src/painter/res/raw/"
```
Expected: `app_notification.mp3`

- [ ] **Step 2: Update `QCFirebaseMessagingService.kt`**

Replace the full file content at `app/src/main/java/com/qcpaintshop/act/fcm/QCFirebaseMessagingService.kt` with:

```kotlin
package com.qcpaintshop.act.fcm

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.ContentResolver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.qcpaintshop.act.BuildConfig
import com.qcpaintshop.act.MainActivity
import com.qcpaintshop.act.R

class QCFirebaseMessagingService : FirebaseMessagingService() {

    companion object {
        private const val CHANNEL_ID = "qc_notifications"
        private const val CHANNEL_NAME = "QC Notifications"
        private const val GEO_CHANNEL_ID = "qc_geofence_alerts"
        private const val GEO_CHANNEL_NAME = "Geofence Alerts"
        private const val ADMIN_CHANNEL_ID = "qc_admin_channel"
        private const val ADMIN_CHANNEL_NAME = "QC Updates"

        private val GEOFENCE_TYPES = setOf(
            "geofence_exit_warning", "geo_auto_clockout", "location_off_warning",
            "geofence_exit_admin", "geo_auto_clockout_admin", "location_off_admin",
            "geofence_violation"
        )

        // Notification types sent by the admin notification composer
        private val ADMIN_NOTIFICATION_TYPES = setOf("info", "offer", "admin_notification")
    }

    override fun onNewToken(token: String) {
        super.onNewToken(token)
        getSharedPreferences("qc_prefs", MODE_PRIVATE)
            .edit()
            .putString("fcm_token", token)
            .apply()
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)

        val title = message.notification?.title ?: message.data["title"] ?: "Quality Colours"
        val body = message.notification?.body ?: message.data["body"] ?: ""
        val type = message.data["type"] ?: "notification"
        val conversationId = message.data["conversation_id"]
        val leadId = message.data["lead_id"]
        val estimateId = message.data["estimate_id"]
        val pdfUrl = message.data["pdf_url"]
        val offerUrl = message.data["offerUrl"]

        var deepLink = getDeepLinkPath(type, conversationId)
        if (leadId != null && deepLink.contains("leads")) {
            deepLink = "$deepLink?lead=$leadId"
        } else if (estimateId != null && deepLink.contains("estimates")) {
            deepLink = "$deepLink?id=$estimateId"
        } else if (pdfUrl != null) {
            deepLink = pdfUrl
        } else if (type == "offer" && !offerUrl.isNullOrEmpty()) {
            // Admin offer notification — tap opens the offer URL directly
            deepLink = offerUrl
        }

        showNotification(title, body, deepLink, type)
    }

    private fun getDeepLinkPath(type: String, conversationId: String?): String {
        val appType = BuildConfig.APP_TYPE

        if (appType == "painter") {
            return when (type) {
                "points_earned", "withdrawal_approved", "withdrawal_paid" -> "/painter-dashboard.html"
                "estimate_approved", "estimate_rejected", "estimate_shared" -> "/painter-dashboard.html"
                "new_offer" -> "/painter-catalog.html"
                "training_new" -> "/painter-training.html"
                "attendance_reminder" -> "/painter-attendance.html"
                "info", "admin_notification" -> "/painter-dashboard.html"
                "offer" -> "/painter-catalog.html" // fallback if offerUrl missing
                else -> "/painter-dashboard.html"
            }
        }

        return when (type) {
            "chat_message" -> if (conversationId != null) "/chat.html?conversation=$conversationId" else "/chat.html"
            "attendance_report", "clock_in", "clock_out", "break_start", "break_end",
            "break_exceeded", "outside_work_start", "outside_work_end",
            "prayer_start", "prayer_end", "geofence_violation",
            "geofence_exit_warning", "location_off_warning" -> "/staff/dashboard.html"
            "force_clockout", "geo_auto_clockout" -> "/staff/history.html"
            "admin_attendance_report", "geo_auto_clockout_admin", "reclockin_request",
            "geofence_exit_admin", "location_off_admin" -> "/admin-attendance.html"
            "permission_approved", "permission_rejected" -> "/staff/permission-request.html"
            "task_assigned", "task_completed" -> "/staff-daily-work.html"
            "lead_assigned", "lead_created", "lead_creation_alert",
            "lead_overdue_alert", "lead_followup_reminder" -> "/staff-leads.html"
            "stock_check_assigned" -> "/staff/stock-check.html"
            "stock_check_submitted" -> "/admin-stock-check.html"
            "salary_generated", "salary_paid", "advance_approved",
            "advance_rejected", "document" -> "/staff/dashboard.html"
            "incentive_earned", "incentive_approved", "incentive_rejected" -> "/staff-incentives.html"
            "incentive_request" -> "/admin-salary-incentives.html"
            "estimate_shared", "estimate_approved", "estimate_rejected" -> "/staff-estimates.html"
            "credit_limit_request_new", "credit_limit_request_resolved" -> "/admin-credit-limits.html"
            "system_alert" -> "/admin-system-health.html"
            "new_registration" -> "/admin-staff-registrations.html"
            "profile_updated" -> "/staff/dashboard.html"
            "admin_notice" -> "/staff/dashboard.html"
            else -> "/staff/dashboard.html"
        }
    }

    private fun showNotification(title: String, body: String, deepLinkPath: String, type: String) {
        createNotificationChannels()

        val fullUrl = if (deepLinkPath.startsWith("http")) deepLinkPath else "https://act.qcpaintshop.com$deepLinkPath"
        val intent = Intent(this, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            data = android.net.Uri.parse(fullUrl)
        }

        val pendingIntent = PendingIntent.getActivity(
            this, System.currentTimeMillis().toInt(), intent,
            PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_IMMUTABLE
        )

        val isGeofenceAlert = type in GEOFENCE_TYPES
        val isAdminNotification = type in ADMIN_NOTIFICATION_TYPES

        val channelId = when {
            isGeofenceAlert -> GEO_CHANNEL_ID
            isAdminNotification -> ADMIN_CHANNEL_ID
            else -> CHANNEL_ID
        }

        val defaultSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
        val alarmSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM) ?: defaultSound
        val customSoundUri = Uri.parse(
            ContentResolver.SCHEME_ANDROID_RESOURCE + "://" +
            packageName + "/" + R.raw.app_notification
        )

        val notificationSound = when {
            isGeofenceAlert -> alarmSound
            isAdminNotification -> customSoundUri
            else -> defaultSound
        }

        val builder = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setAutoCancel(true)
            .setSound(notificationSound)
            .setContentIntent(pendingIntent)
            .setPriority(if (isGeofenceAlert) NotificationCompat.PRIORITY_MAX else NotificationCompat.PRIORITY_HIGH)

        if (isGeofenceAlert) {
            builder.setVibrate(longArrayOf(0, 500, 200, 500, 200, 500))
            builder.setCategory(NotificationCompat.CATEGORY_ALARM)
        }

        val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        notificationManager.notify(System.currentTimeMillis().toInt(), builder.build())
    }

    private fun createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val notificationManager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

            // Delete old channel to reset cached sound/vibration settings
            try { notificationManager.deleteNotificationChannel(CHANNEL_ID) } catch (_: Exception) {}

            val audioAttributes = AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(AudioAttributes.USAGE_NOTIFICATION_EVENT)
                .build()

            // Standard notification channel
            val defaultSoundUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
            val channel = NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Notifications from Quality Colours"
                enableLights(true)
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 250, 100, 250)
                setSound(defaultSoundUri, audioAttributes)
                lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            }
            notificationManager.createNotificationChannel(channel)

            // Geofence alert channel — alarm-level urgency
            val alarmSound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM) ?: defaultSoundUri
            val alarmAudioAttributes = AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(AudioAttributes.USAGE_ALARM)
                .build()
            val geoChannel = NotificationChannel(
                GEO_CHANNEL_ID,
                GEO_CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Urgent alerts when you leave the branch area or turn off location"
                enableLights(true)
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 500, 200, 500, 200, 500)
                setSound(alarmSound, alarmAudioAttributes)
                setBypassDnd(true)
            }
            notificationManager.createNotificationChannel(geoChannel)

            // Admin notification channel — custom MP3 sound
            // NOTE: Do NOT delete this channel before recreating — Android caches channel sound
            // settings per user. Deleting would reset user's notification preferences.
            val customSoundUri = Uri.parse(
                ContentResolver.SCHEME_ANDROID_RESOURCE + "://" +
                packageName + "/" + R.raw.app_notification
            )
            val adminAudioAttributes = AudioAttributes.Builder()
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .build()
            val adminChannel = NotificationChannel(
                ADMIN_CHANNEL_ID,
                ADMIN_CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Offers and announcements from Quality Colours"
                enableLights(true)
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 250, 100, 250)
                setSound(customSoundUri, adminAudioAttributes)
                lockscreenVisibility = android.app.Notification.VISIBILITY_PUBLIC
            }
            notificationManager.createNotificationChannel(adminChannel)
        }
    }
}
```

- [ ] **Step 3: Verify the Kotlin file compiles**

```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android"
./gradlew :app:compileDebugKotlin --quiet 2>&1 | tail -20
```

Expected: BUILD SUCCESSFUL (no errors)

- [ ] **Step 4: Commit Android changes**

```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android"
git add app/src/painter/res/raw/app_notification.mp3
git add app/src/main/java/com/qcpaintshop/act/fcm/QCFirebaseMessagingService.kt
git commit -m "feat(android): qc_admin_channel with custom MP3 + offer tap routing"
```

---

## Task 7: Deploy + Build APK

**Files:**
- No new files — deploy backend, build Android

- [ ] **Step 1: Deploy backend to production**

```bash
ssh hetzner "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && npm install && pm2 restart business-manager"
```

Expected: `[PM2] Process business-manager restarted`

- [ ] **Step 2: Verify migration ran on production**

```bash
ssh hetzner "node /www/wwwroot/act.qcpaintshop.com/migrations/migrate-admin-notifications.js"
```

Expected: `[migrate-admin-notifications] Done`

- [ ] **Step 3: Build painter APK**

```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android"
./gradlew assemblePainterDebug 2>&1 | tail -10
```

Expected: `BUILD SUCCESSFUL` with APK at `app/build/outputs/apk/painter/debug/app-painter-debug.apk`

- [ ] **Step 4: Send APK via Telegram bot**

```bash
APK_PATH="D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/qcpaintshop-android/app/build/outputs/apk/painter/debug/app-painter-debug.apk"
curl -F "chat_id=930726256" \
     -F "document=@${APK_PATH}" \
     -F "caption=Admin FCM Notifications — custom sound + offer tap + audience filter" \
     "https://api.telegram.org/bot$(grep TELEGRAM_BOT_TOKEN D:/QUALITY\ COLOURS/DEVELOPMENT/qcpaintshop.com/act.qcpaintshop.com/.env | cut -d= -f2)/sendDocument"
```

- [ ] **Step 5: Commit final web changes**

```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/act.qcpaintshop.com"
git add -A
git status
git commit -m "feat(admin-notif): complete — migration, route, FCM batch, admin UI"
```
