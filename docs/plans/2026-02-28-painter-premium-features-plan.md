# Painter Premium Features Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add profile avatar, server-generated visiting card, color visualization system, and premium dashboard redesign to the painter app.

**Architecture:** Express.js backend with Sharp for image generation, multer for uploads, `qrcode` npm package for QR codes. New `painter-card-generator.js` service handles visiting card PNG creation. New `painter_visualization_requests` table stores visualization requests. Frontend is vanilla HTML/JS with Tailwind CSS.

**Tech Stack:** Express.js, Sharp, multer, qrcode (npm), MySQL, Tailwind CSS, vanilla JS

**Design doc:** `docs/plans/2026-02-28-painter-premium-features-design.md`

**Brand colors:** Primary #1B5E3B (green), Secondary #D4A24E (gold). NO purple anywhere.

---

### Task 1: Migration — visualization_requests table + upload dirs

**Files:**
- Create: `migrations/migrate-painter-premium.js`
- Modify: `config/uploads.js`

**Context:** The `painters` table already has `profile_photo VARCHAR(500)` column (unused). We need a new table for visualization requests and new upload directories.

**Step 1: Create migration file**

Create `migrations/migrate-painter-premium.js`:

```javascript
const mysql = require('mysql2/promise');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function migrate() {
    let pool;
    try {
        pool = mysql.createPool({
            host: process.env.DB_HOST || 'localhost',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'business_manager',
            port: process.env.DB_PORT || 3306
        });

        console.log('Starting painter premium features migration...');

        // 1. Create painter_visualization_requests table
        const [tables] = await pool.query(
            "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'painter_visualization_requests'"
        );
        if (tables.length === 0) {
            await pool.query(`
                CREATE TABLE painter_visualization_requests (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    painter_id INT NOT NULL,
                    photo_path VARCHAR(500) NOT NULL,
                    brand VARCHAR(100),
                    color_name VARCHAR(100),
                    color_code VARCHAR(50),
                    color_hex VARCHAR(7),
                    notes TEXT,
                    status ENUM('pending','in_progress','completed','rejected') DEFAULT 'pending',
                    visualization_path VARCHAR(500),
                    admin_notes TEXT,
                    processed_by INT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    completed_at TIMESTAMP NULL,
                    INDEX idx_painter (painter_id),
                    INDEX idx_status (status),
                    FOREIGN KEY (painter_id) REFERENCES painters(id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            console.log('Created painter_visualization_requests table');
        } else {
            console.log('painter_visualization_requests table already exists');
        }

        // 2. Add card_generated_at column to painters (for cache invalidation)
        const [cols] = await pool.query(
            "SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'painters' AND COLUMN_NAME = 'card_generated_at'"
        );
        if (cols.length === 0) {
            await pool.query("ALTER TABLE painters ADD COLUMN card_generated_at TIMESTAMP NULL");
            console.log('Added card_generated_at column to painters');
        } else {
            console.log('card_generated_at column already exists');
        }

        console.log('Migration complete!');
    } finally {
        if (pool) await pool.end();
        process.exit(0);
    }
}

migrate().catch(err => { console.error('Migration failed:', err); process.exit(1); });
```

**Step 2: Add upload directories to config/uploads.js**

In `config/uploads.js`, add these to the `uploadDirs` array:

```javascript
'public/uploads/painter-cards',
'public/uploads/painter-visualizations'
```

Add new multer config for visualization uploads:

```javascript
// Painter visualization photo upload (10MB, memory storage for sharp compression)
const uploadPainterVisualization = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: imageFilter
});
```

Export `uploadPainterVisualization` alongside existing exports.

**Step 3: Run migration locally to verify**

```bash
cd "D:/QUALITY COLOURS/DEVELOPMENT/qcpaintshop.com/act.qcpaintshop.com"
node migrations/migrate-painter-premium.js
```

Expected: "Created painter_visualization_requests table", "Added card_generated_at column to painters", "Migration complete!"

**Step 4: Install qrcode package**

```bash
npm install qrcode
```

**Step 5: Commit**

```bash
git add migrations/migrate-painter-premium.js config/uploads.js package.json package-lock.json
git commit -m "feat: migration for painter premium features + qrcode dep"
```

---

### Task 2: Profile photo upload endpoint

**Files:**
- Modify: `routes/painters.js` (add profile-photo endpoint near line 312, after PUT /me)

**Context:**
- `uploadProfile` exists in `config/uploads.js` but is NOT imported in `routes/painters.js`
- `painters.profile_photo` column already exists
- Sharp is imported in `server.js` but NOT in `routes/painters.js` — import it
- The route file uses `router.put('/me', ...)` at line 299

**Step 1: Add imports at top of routes/painters.js**

At line 15, where existing imports are, add `uploadProfile` to the destructured import:

```javascript
const { uploadProductImage, uploadOfferBanner, uploadTraining, uploadPainterAttendance, uploadProfile } = require('../config/uploads');
const sharp = require('sharp');
```

**Step 2: Add profile photo upload endpoint**

Insert AFTER the `router.put('/me', ...)` block (after line 312):

```javascript
// Upload/update profile photo
router.put('/me/profile-photo', requirePainterAuth, uploadProfile.single('photo'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No photo uploaded' });

        const filename = `painter_${req.painter.id}.jpg`;
        const outputPath = `public/uploads/profiles/${filename}`;

        // Resize + compress with sharp
        await sharp(req.file.path)
            .resize(400, 400, { fit: 'cover' })
            .jpeg({ quality: 80 })
            .toFile(outputPath + '.tmp');

        // Replace original with processed version
        const fs = require('fs');
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        fs.renameSync(outputPath + '.tmp', outputPath);
        // Remove multer's original upload
        if (req.file.path !== outputPath) fs.unlinkSync(req.file.path);

        const photoUrl = `/uploads/profiles/${filename}?v=${Date.now()}`;
        await pool.query('UPDATE painters SET profile_photo = ?, card_generated_at = NULL WHERE id = ?', [photoUrl, req.painter.id]);

        res.json({ success: true, photo_url: photoUrl });
    } catch (error) {
        console.error('Profile photo upload error:', error);
        res.status(500).json({ success: false, message: 'Failed to upload photo' });
    }
});
```

**Step 3: Update PUT /me to invalidate card cache**

Modify the existing `PUT /me` query (line 302-306) to also set `card_generated_at = NULL` when profile fields change:

```javascript
router.put('/me', requirePainterAuth, async (req, res) => {
    try {
        const { email, address, city, district, pincode, experience_years, specialization } = req.body;
        await pool.query(
            `UPDATE painters SET email = COALESCE(?, email), address = COALESCE(?, address), city = COALESCE(?, city),
             district = COALESCE(?, district), pincode = COALESCE(?, pincode), experience_years = COALESCE(?, experience_years),
             specialization = COALESCE(?, specialization), card_generated_at = NULL WHERE id = ?`,
            [email, address, city, district, pincode, experience_years, specialization, req.painter.id]
        );
        res.json({ success: true, message: 'Profile updated' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update profile' });
    }
});
```

**Step 4: Update GET /me/dashboard to include profile_photo**

Modify the dashboard endpoint (line 384) to also select `profile_photo` and `full_name`:

```javascript
const [painter] = await pool.query('SELECT referral_code, profile_photo, full_name FROM painters WHERE id = ?', [req.painter.id]);

res.json({
    success: true,
    dashboard: {
        balance,
        referralCode: painter[0]?.referral_code,
        profilePhoto: painter[0]?.profile_photo,
        painterName: painter[0]?.full_name,
        referralCount: referralCount[0].count,
        recentTransactions: recentTxns,
        pendingWithdrawals: { count: pendingWithdrawals[0].count, total: parseFloat(pendingWithdrawals[0].total) }
    }
});
```

**Step 5: Test endpoint**

```bash
# Test with curl (will get 401 without real token, confirming route exists)
curl -s http://localhost:3001/api/painters/me/profile-photo -X PUT
```

**Step 6: Commit**

```bash
git add routes/painters.js
git commit -m "feat: painter profile photo upload + card cache invalidation"
```

---

### Task 3: Visiting card generator service

**Files:**
- Create: `services/painter-card-generator.js`

**Context:**
- Sharp is available for image compositing
- `qrcode` package installed in Task 1
- Cards saved to `public/uploads/painter-cards/painter_{id}.png`
- Card dimensions: 1050 x 600 px

**Step 1: Create the card generator service**

Create `services/painter-card-generator.js`:

```javascript
/**
 * Painter Visiting Card Generator
 * Generates a professional PNG business card using Sharp
 */
const sharp = require('sharp');
const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');

const CARD_WIDTH = 1050;
const CARD_HEIGHT = 600;
const PRIMARY = '#1B5E3B';
const SECONDARY = '#D4A24E';
const ORIGIN = process.env.APP_ORIGIN || 'https://act.qcpaintshop.com';

async function generateCard(painter) {
    const {
        id, full_name, phone, city, specialization,
        experience_years, referral_code, profile_photo
    } = painter;

    // 1. Generate QR code as PNG buffer
    const registerUrl = `${ORIGIN}/painter-register.html?ref=${referral_code}`;
    const qrBuffer = await QRCode.toBuffer(registerUrl, {
        width: 140,
        margin: 1,
        color: { dark: PRIMARY, light: '#FFFFFF' }
    });

    // 2. Load profile photo or create initials avatar
    let photoBuffer;
    try {
        const photoPath = profile_photo
            ? path.join(__dirname, '..', 'public', profile_photo.split('?')[0])
            : null;
        if (photoPath && fs.existsSync(photoPath)) {
            photoBuffer = await sharp(photoPath)
                .resize(120, 120, { fit: 'cover' })
                .png()
                .toBuffer();
        }
    } catch (e) { /* use initials fallback */ }

    if (!photoBuffer) {
        // Create initials circle
        const initial = (full_name || 'P').charAt(0).toUpperCase();
        const initialSvg = `<svg width="120" height="120"><circle cx="60" cy="60" r="60" fill="${SECONDARY}"/><text x="60" y="60" text-anchor="middle" dominant-baseline="central" font-family="Arial,sans-serif" font-size="52" font-weight="bold" fill="white">${initial}</text></svg>`;
        photoBuffer = await sharp(Buffer.from(initialSvg)).png().toBuffer();
    }

    // 3. Make photo circular with mask
    const circleMask = Buffer.from(`<svg width="120" height="120"><circle cx="60" cy="60" r="58" fill="white"/></svg>`);
    const circleMaskBuf = await sharp(circleMask).png().toBuffer();
    const circularPhoto = await sharp(photoBuffer)
        .resize(120, 120)
        .composite([{ input: circleMaskBuf, blend: 'dest-in' }])
        .png()
        .toBuffer();

    // Add white border ring around photo
    const photoRing = Buffer.from(`<svg width="130" height="130"><circle cx="65" cy="65" r="64" fill="none" stroke="white" stroke-width="3"/></svg>`);
    const photoRingBuf = await sharp(photoRing).png().toBuffer();

    // 4. Build SVG card layout
    const specLabel = (specialization || 'both')
        .replace('both', 'Interior & Exterior')
        .replace('interior', 'Interior')
        .replace('exterior', 'Exterior')
        .replace('industrial', 'Industrial')
        + ' Specialist';
    const expText = experience_years ? `${experience_years} years experience` : '';

    const escapeSvg = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const cardSvg = `
    <svg width="${CARD_WIDTH}" height="${CARD_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
        <defs>
            <linearGradient id="headerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:${PRIMARY}"/>
                <stop offset="100%" style="stop-color:${SECONDARY}"/>
            </linearGradient>
            <linearGradient id="footerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" style="stop-color:${PRIMARY}"/>
                <stop offset="100%" style="stop-color:#2D7A4F"/>
            </linearGradient>
        </defs>

        <!-- White background -->
        <rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" rx="20" fill="white"/>

        <!-- Header gradient bar -->
        <rect width="${CARD_WIDTH}" height="90" rx="20" fill="url(#headerGrad)"/>
        <rect y="20" width="${CARD_WIDTH}" height="70" fill="url(#headerGrad)"/>

        <!-- Header text -->
        <text x="40" y="42" font-family="Arial,sans-serif" font-size="24" font-weight="bold" fill="white">QC PAINTERS</text>
        <text x="${CARD_WIDTH - 40}" y="42" font-family="Arial,sans-serif" font-size="14" fill="white" text-anchor="end" opacity="0.9">Quality Colours</text>
        <text x="${CARD_WIDTH - 40}" y="62" font-family="Arial,sans-serif" font-size="11" fill="white" text-anchor="end" opacity="0.7">Your Trusted Paint Partner</text>

        <!-- Thin gold accent line -->
        <rect y="88" width="${CARD_WIDTH}" height="3" fill="${SECONDARY}"/>

        <!-- Name & details -->
        <text x="200" y="160" font-family="Arial,sans-serif" font-size="28" font-weight="bold" fill="#1a1a2e">${escapeSvg(full_name)}</text>
        <text x="200" y="190" font-family="Arial,sans-serif" font-size="16" fill="#64748b">${escapeSvg(specLabel)}</text>
        ${expText ? `<text x="200" y="215" font-family="Arial,sans-serif" font-size="14" fill="#94a3b8">${escapeSvg(expText)}</text>` : ''}

        <!-- Divider -->
        <line x1="200" y1="240" x2="650" y2="240" stroke="#e2e8f0" stroke-width="1"/>

        <!-- Phone -->
        <text x="216" y="275" font-family="Arial,sans-serif" font-size="16" fill="#334155">📞  ${escapeSvg(phone)}</text>

        <!-- City -->
        ${city ? `<text x="216" y="305" font-family="Arial,sans-serif" font-size="16" fill="#334155">📍  ${escapeSvg(city)}</text>` : ''}

        <!-- Referral code -->
        <text x="216" y="${city ? 345 : 315}" font-family="Arial,sans-serif" font-size="13" fill="#94a3b8">Referral Code</text>
        <text x="216" y="${city ? 370 : 340}" font-family="Arial,sans-serif" font-size="20" font-weight="bold" fill="${PRIMARY}" letter-spacing="2">${escapeSvg(referral_code)}</text>

        <!-- QR label -->
        <text x="${CARD_WIDTH - 120}" y="410" font-family="Arial,sans-serif" font-size="10" fill="#94a3b8" text-anchor="middle">Scan to Register</text>

        <!-- Footer -->
        <rect y="${CARD_HEIGHT - 50}" width="${CARD_WIDTH}" height="50" rx="0" fill="url(#footerGrad)"/>
        <rect y="${CARD_HEIGHT - 50}" width="${CARD_WIDTH}" height="30" fill="url(#footerGrad)"/>
        <rect x="0" y="${CARD_HEIGHT - 20}" width="${CARD_WIDTH}" height="20" rx="20" fill="url(#footerGrad)"/>
        <text x="${CARD_WIDTH / 2}" y="${CARD_HEIGHT - 18}" font-family="Arial,sans-serif" font-size="13" fill="white" text-anchor="middle" opacity="0.9">Quality Colours — Your Trusted Paint Partner</text>
    </svg>`;

    // 5. Composite everything
    const cardBase = await sharp(Buffer.from(cardSvg)).png().toBuffer();

    const outputPath = path.join(__dirname, '..', 'public', 'uploads', 'painter-cards', `painter_${id}.png`);

    await sharp(cardBase)
        .composite([
            // Profile photo (positioned in left area)
            { input: circularPhoto, top: 130, left: 50 },
            { input: photoRingBuf, top: 125, left: 45 },
            // QR code (positioned in right area)
            { input: qrBuffer, top: 250, left: CARD_WIDTH - 190 },
        ])
        .png({ quality: 90 })
        .toFile(outputPath);

    return `/uploads/painter-cards/painter_${id}.png?v=${Date.now()}`;
}

module.exports = { generateCard };
```

**Step 2: Commit**

```bash
git add services/painter-card-generator.js
git commit -m "feat: painter visiting card PNG generator service"
```

---

### Task 4: Visiting card endpoint

**Files:**
- Modify: `routes/painters.js`

**Context:** Add a GET endpoint that generates (or returns cached) visiting card PNG. Place it AFTER the `/me/profile-photo` endpoint added in Task 2.

**Step 1: Import card generator at top of routes/painters.js**

```javascript
const cardGenerator = require('../services/painter-card-generator');
```

**Step 2: Add visiting card endpoint**

Insert after the profile-photo endpoint:

```javascript
// Get/generate visiting card PNG
router.get('/me/visiting-card', requirePainterAuth, async (req, res) => {
    try {
        const [painters] = await pool.query(
            'SELECT id, full_name, phone, city, specialization, experience_years, referral_code, profile_photo, card_generated_at, updated_at FROM painters WHERE id = ?',
            [req.painter.id]
        );
        if (!painters.length) return res.status(404).json({ success: false, message: 'Painter not found' });

        const painter = painters[0];
        const cardPath = require('path').join(__dirname, '..', 'public', 'uploads', 'painter-cards', `painter_${painter.id}.png`);
        const fs = require('fs');

        // Check if card needs regeneration
        const needsRegen = !painter.card_generated_at
            || !fs.existsSync(cardPath)
            || (painter.updated_at && new Date(painter.updated_at) > new Date(painter.card_generated_at));

        if (needsRegen) {
            await cardGenerator.generateCard(painter);
            await pool.query('UPDATE painters SET card_generated_at = NOW() WHERE id = ?', [painter.id]);
        }

        // Return as image or JSON with URL based on Accept header
        if (req.query.format === 'url') {
            res.json({ success: true, url: `/uploads/painter-cards/painter_${painter.id}.png?v=${Date.now()}` });
        } else {
            res.sendFile(cardPath);
        }
    } catch (error) {
        console.error('Visiting card error:', error);
        res.status(500).json({ success: false, message: 'Failed to generate visiting card' });
    }
});
```

**Step 3: Test**

```bash
curl -s http://localhost:3001/api/painters/me/visiting-card -X GET
# Expected: 401 (no auth), confirming route exists
```

**Step 4: Commit**

```bash
git add routes/painters.js
git commit -m "feat: visiting card generation endpoint with caching"
```

---

### Task 5: Visualization request endpoints (painter side)

**Files:**
- Modify: `routes/painters.js`
- Modify: `config/uploads.js` (already done in Task 1)

**Context:** Painters submit photo + color info → stored in `painter_visualization_requests`. Import `uploadPainterVisualization` from config/uploads.

**Step 1: Add import**

Add `uploadPainterVisualization` to the destructured import from config/uploads.js:

```javascript
const { uploadProductImage, uploadOfferBanner, uploadTraining, uploadPainterAttendance, uploadProfile, uploadPainterVisualization } = require('../config/uploads');
```

**Step 2: Add visualization endpoints**

Place these BEFORE any `/:id` parameterized routes:

```javascript
// ═══════════════════════════════════════════
// PAINTER VISUALIZATION REQUESTS
// ═══════════════════════════════════════════

// Submit visualization request
router.post('/me/visualizations', requirePainterAuth, uploadPainterVisualization.single('photo'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'Photo is required' });

        const { brand, color_name, color_code, color_hex, notes } = req.body;

        // Save uploaded photo with sharp compression
        const filename = `viz-req-${req.painter.id}-${Date.now()}.jpg`;
        const outputPath = `public/uploads/painter-visualizations/${filename}`;
        await sharp(req.file.buffer)
            .resize(1200, 900, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 85 })
            .toFile(outputPath);

        const photoUrl = `/uploads/painter-visualizations/${filename}`;

        const [result] = await pool.query(
            `INSERT INTO painter_visualization_requests (painter_id, photo_path, brand, color_name, color_code, color_hex, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [req.painter.id, photoUrl, brand || null, color_name || null, color_code || null, color_hex || null, notes || null]
        );

        res.json({ success: true, id: result.insertId, message: 'Visualization request submitted' });
    } catch (error) {
        console.error('Visualization submit error:', error);
        res.status(500).json({ success: false, message: 'Failed to submit request' });
    }
});

// List my visualization requests
router.get('/me/visualizations', requirePainterAuth, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT id, photo_path, brand, color_name, color_hex, status, visualization_path, admin_notes, created_at, completed_at
             FROM painter_visualization_requests
             WHERE painter_id = ?
             ORDER BY created_at DESC`,
            [req.painter.id]
        );
        res.json({ success: true, visualizations: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to load visualizations' });
    }
});
```

**Step 3: Commit**

```bash
git add routes/painters.js
git commit -m "feat: painter visualization request submit + list endpoints"
```

---

### Task 6: Visualization admin endpoints

**Files:**
- Modify: `routes/painters.js`

**Context:** Admin endpoints to list, process, and complete visualization requests. These go in the admin section of routes/painters.js (after the existing admin endpoints, around line 1600+).

**Step 1: Add admin visualization endpoints**

Place these with other admin endpoints (after training/offers admin routes):

```javascript
// ═══════════════════════════════════════════
// ADMIN: VISUALIZATION REQUESTS
// ═══════════════════════════════════════════

// List all visualization requests
router.get('/admin/visualizations', requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const status = req.query.status || '';
        let where = '';
        const params = [];
        if (status) {
            where = 'WHERE vr.status = ?';
            params.push(status);
        }
        const [rows] = await pool.query(
            `SELECT vr.*, p.full_name as painter_name, p.phone as painter_phone, p.city as painter_city
             FROM painter_visualization_requests vr
             JOIN painters p ON p.id = vr.painter_id
             ${where}
             ORDER BY FIELD(vr.status, 'pending', 'in_progress', 'completed', 'rejected'), vr.created_at DESC`,
            params
        );
        res.json({ success: true, visualizations: rows });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to load visualizations' });
    }
});

// Process visualization (upload result)
router.put('/admin/visualizations/:id', requirePermission('painters', 'manage'), async (req, res) => {
    try {
        const { status, admin_notes } = req.body;
        const updates = [];
        const params = [];

        if (status) { updates.push('status = ?'); params.push(status); }
        if (admin_notes !== undefined) { updates.push('admin_notes = ?'); params.push(admin_notes); }
        if (status === 'in_progress') { updates.push('processed_by = ?'); params.push(req.user.id); }
        if (status === 'completed') { updates.push('completed_at = NOW()'); }

        if (updates.length === 0) return res.status(400).json({ success: false, message: 'Nothing to update' });

        params.push(req.params.id);
        await pool.query(`UPDATE painter_visualization_requests SET ${updates.join(', ')} WHERE id = ?`, params);

        // Send notification to painter if completed or rejected
        if (status === 'completed' || status === 'rejected') {
            const [req_rows] = await pool.query('SELECT painter_id FROM painter_visualization_requests WHERE id = ?', [req.params.id]);
            if (req_rows.length) {
                try {
                    await painterNotificationService.send(pool, req_rows[0].painter_id, {
                        title: status === 'completed' ? 'Visualization Ready!' : 'Visualization Update',
                        body: status === 'completed'
                            ? 'Your color visualization is ready. Open the app to view and share it.'
                            : `Your visualization request was ${status}. ${admin_notes || ''}`,
                        type: 'visualization_' + status
                    });
                } catch (e) { console.error('Notification error:', e.message); }
            }
        }

        res.json({ success: true, message: 'Visualization request updated' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to update visualization' });
    }
});

// Upload visualization result image
router.post('/admin/visualizations/:id/upload-result', requirePermission('painters', 'manage'), uploadPainterVisualization.single('visualization'), async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'Visualization image required' });

        const filename = `viz-result-${req.params.id}-${Date.now()}.jpg`;
        const outputPath = `public/uploads/painter-visualizations/${filename}`;
        await sharp(req.file.buffer)
            .resize(1200, 900, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 90 })
            .toFile(outputPath);

        const vizUrl = `/uploads/painter-visualizations/${filename}`;
        await pool.query(
            'UPDATE painter_visualization_requests SET visualization_path = ?, status = ?, completed_at = NOW(), processed_by = ? WHERE id = ?',
            [vizUrl, 'completed', req.user.id, req.params.id]
        );

        // Notify painter
        const [req_rows] = await pool.query('SELECT painter_id FROM painter_visualization_requests WHERE id = ?', [req.params.id]);
        if (req_rows.length) {
            try {
                await painterNotificationService.send(pool, req_rows[0].painter_id, {
                    title: 'Visualization Ready!',
                    body: 'Your color visualization is ready. Open the app to view and share it.',
                    type: 'visualization_completed'
                });
            } catch (e) { console.error('Notification error:', e.message); }
        }

        res.json({ success: true, message: 'Visualization uploaded and completed', url: vizUrl });
    } catch (error) {
        console.error('Visualization upload error:', error);
        res.status(500).json({ success: false, message: 'Failed to upload visualization' });
    }
});
```

**Step 2: Commit**

```bash
git add routes/painters.js
git commit -m "feat: admin visualization management endpoints"
```

---

### Task 7: Painter profile page (painter-profile.html)

**Files:**
- Create: `public/painter-profile.html`

**Context:** New page accessible from dashboard. Uses same auth pattern as other painter pages. Brand colors: #1B5E3B primary, #D4A24E secondary. Loads profile from GET /api/painters/me, updates via PUT /api/painters/me, photo via PUT /api/painters/me/profile-photo.

**Step 1: Create the profile page**

Create `public/painter-profile.html` — a complete, standalone HTML page with:
- Green-gold gradient header with large circular avatar (camera overlay to change)
- File input hidden, triggered by tapping avatar
- Form fields: Full Name (read-only), Phone (read-only), Email, City, Experience Years, Specialization (dropdown), Address
- Save button (calls PUT /me)
- Bottom nav (same 5 tabs as dashboard, none active since this is a profile page)
- Mobile-first, max-width 480px, Tailwind CSS
- Auth check: read `painter_token` from localStorage, redirect to `/painter-login.html` if missing
- On load: fetch GET /api/painters/me → populate all fields
- Avatar upload: on file select → PUT /me/profile-photo with FormData → update avatar display
- Save: collect changed fields → PUT /me → show success toast

**Note for implementer:** Use the EXACT same header/nav HTML structure from `painter-dashboard.html`. Match the green/gold brand colors. Include `painter-i18n.js` script. The page should feel premium — smooth transitions, clean typography, subtle shadows.

**Step 2: Commit**

```bash
git add public/painter-profile.html
git commit -m "feat: painter profile page with avatar upload"
```

---

### Task 8: Dashboard redesign (painter-dashboard.html)

**Files:**
- Modify: `public/painter-dashboard.html`

**Context:** This is the main painter dashboard. Currently functional but needs premium upgrade. Keep ALL existing functionality (stats, offers carousel, estimates, transactions, referrals, withdrawals). ADD: avatar in header, visiting card section, visualization gallery, enhanced quick actions.

**Key changes:**

1. **Header**: Add circular avatar (left of name), tap to go to `/painter-profile.html`. Show initials circle if no photo. Show `profilePhoto` from dashboard API.

2. **Quick Actions**: Change from 4-column grid to 5-item horizontal scroll:
   - Estimate, Withdraw, Visiting Card, Refer, Visualize

3. **New Section: "My Visiting Card"** (after offers carousel):
   - Shows card thumbnail (from GET /me/visiting-card?format=url)
   - "Share Card" button (downloads PNG, triggers native share with image file)
   - "Download" button

4. **New Section: "My Visualizations"** (after visiting card):
   - Grid of completed visualizations (2 per row)
   - Pending requests with status badge
   - "Request New" button → opens simple modal (photo upload + color picker)
   - Empty state: "No visualizations yet. Request one!"

5. **Enhanced Referral Section**: Keep existing referral code box but add text: "Share with your visiting card attached"

6. **Remove ALL purple**: Already done in earlier commit, but verify no Tailwind purple- classes remain.

**Important:** Keep ALL existing JavaScript functions working (loadDashboard, shareReferral, showWithdrawModal, showTransactions, showReferrals, loadOffers, etc.). ADD new functions alongside.

**Note for implementer:** This is a large file (~600 lines). Read the ENTIRE file first. Do NOT break existing functionality. Test every section after changes.

**Step 1: Implement all dashboard changes**

**Step 2: Commit**

```bash
git add public/painter-dashboard.html
git commit -m "feat: premium dashboard redesign with visiting card + visualization gallery"
```

---

### Task 9: Admin painters — Visualization tab

**Files:**
- Modify: `public/admin-painters.html`

**Context:** Add Tab 9 "Visualizations" to admin-painters.html. Currently has 9 tabs (Painters, Points, Rates, Withdrawals, Reports, Estimates, Offers, Training, Catalog). Tab buttons are at lines 70-78.

**Step 1: Add tab button**

After the Catalog tab button:

```html
<button class="tab-btn" onclick="switchTab('visualizations')">🎨 Visualizations</button>
```

**Step 2: Add tab content**

Add a `<div id="tab-visualizations" class="tab-content">` section with:
- Filter bar: status dropdown (All/Pending/In Progress/Completed/Rejected)
- Stats row: Total requests, Pending count, Completed count
- Table: Painter Name, Photo thumbnail, Color (swatch + name), Status badge, Date, Actions
- Actions: "View" opens detail modal, "Upload Result" opens file upload, "Reject" with notes
- Detail modal: shows original photo (left), upload area for visualization result (right), color info, notes

**Step 3: Add JavaScript functions**

- `loadVisualizations()` — fetch GET /api/painters/admin/visualizations
- `viewVisualization(id)` — open detail modal
- `uploadVisualizationResult(id)` — POST file to /api/painters/admin/visualizations/:id/upload-result
- `updateVisualizationStatus(id, status, notes)` — PUT /api/painters/admin/visualizations/:id

**Step 4: Wire into switchTab()**

Add `case 'visualizations': loadVisualizations(); break;` to the switchTab function.

**Step 5: Commit**

```bash
git add public/admin-painters.html
git commit -m "feat: admin visualization management tab"
```

---

### Task 10: Deploy and verify

**Files:** None (deployment task)

**Step 1: Run migration on server**

```bash
ssh root@161.97.114.189 "cd /www/wwwroot/act.qcpaintshop.com && node migrations/migrate-painter-premium.js"
```

**Step 2: Deploy code**

```bash
ssh root@161.97.114.189 "cd /www/wwwroot/act.qcpaintshop.com && git pull origin master && npm install && pm2 restart business-manager"
```

**Step 3: Verify endpoints**

```bash
# Test visiting card endpoint exists
curl -s https://act.qcpaintshop.com/api/painters/me/visiting-card | head -50

# Test visualization endpoint exists
curl -s https://act.qcpaintshop.com/api/painters/me/visualizations | head -50
```

**Step 4: Clean up debug logging**

Remove all `console.log('[ZohoSearch]')`, `[ZohoDropdown]`, `[ZohoDebounce]`, `[RenderPackSizes]`, `[EditProduct]`, `[AdminProducts]`, `[EventListener]` debug logs from `admin-products.html`. Remove the purple "Load" button from pack size rows.

**Step 5: Final commit**

```bash
git add -A
git commit -m "chore: clean up debug logging, deploy painter premium features"
```

---

## Execution Order & Dependencies

```
Task 1 (migration + deps) → all other tasks depend on this
Task 2 (profile photo endpoint) → Task 7 depends on this
Task 3 (card generator service) → Task 4 depends on this
Task 4 (card endpoint) → Task 8 depends on this
Task 5 (viz painter endpoints) → Task 8 depends on this
Task 6 (viz admin endpoints) → Task 9 depends on this
Task 7 (profile page) → independent after Task 2
Task 8 (dashboard redesign) → depends on Tasks 4, 5
Task 9 (admin viz tab) → depends on Task 6
Task 10 (deploy) → depends on all
```

**Parallel-safe groups:**
- After Task 1: Tasks 2, 3 can run in parallel
- After Task 2 + 3: Tasks 4, 5, 7 can run in parallel
- After Task 4 + 5: Task 8
- After Task 6: Task 9
